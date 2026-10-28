// Traitement d'un paiement PSP (mission 6, lot WP11, T056 à T058 ; FR-012, FR-013, FR-016, FR-017, FR-018,
// FR-024 à FR-026 ; C-009, C-010 ; research R-11 corrigé par R-20 ; A2, A3, A4, A11, A12, A13, A20, A31, A33).
// Appelé par WP12 (réception, interrogation) dans LA TRANSACTION DE L'APPELANT : aucune transaction ouverte ici,
// aucun appel au PSP. Première instruction : la recherche sous verrou de la recharge (ordre : recharge,
// portefeuille, comptes). Un seul crédit par paiement ; jamais d'écriture partielle ; tout paiement non
// créditable ouvre UNE anomalie portant l'argent à rendre.
//
// Tableau des états (data-model, R-20 fait foi) :
//   PAYMENT_FAILED    : aucun effet (la recharge reste PENDING ; seule `settleUnpaid` finalise) ;
//   PAYMENT_CANCELLED : PENDING -> CANCELLED (annulation confirmée par le PSP), sinon aucun effet ;
//   PAYMENT_SUCCEEDED : SUCCEEDED -> doublon (aucune écriture, caution reprise) ; PENDING, FAILED, EXPIRED,
//                       CANCELLED -> contrôles puis crédit (un succès tardif crédite s'il est recevable).
// Contrôles dans l'ordre, le premier qui échoue décide : (a) paiement qui ne se rapproche pas EXACTEMENT de la
// recharge (autre paiement, montant, devise, référence marchande) : MISMATCH, rien au grand livre ; (b)
// portefeuille non actif ; (c) matrice des statuts ; (d) carte ; (e) plafonds, décidés par le moteur et la base
// dans un SAVEPOINT (les frais ne sont pas précalculés ici : la base tranche).
//
// Aucune donnée du coffre ni référence de secret ici ; l'empreinte de carte n'est jamais journalisée.
import { Injectable, Logger } from '@nestjs/common';
import { AuditService, type AuditAction, type AuditContext } from '../../audit/audit.service';
import type { TxClient } from '../../db/tenant-tx';
import { resolveProblem } from '../../errors/problem.filter';
import { LedgerEngineService } from '../../ledger/ledger-engine.service';
import { readLedgerContext } from '../../ledger/db/ledger-queries';
import { isAccepted } from '../../ledger/status-matrix';
import { DepositService } from '../../media/lifecycle/deposit.service';
import type { NormalizedPayment } from '../../psp/psp.types';
import { FEE_CHANNEL } from '../../psp-configurations/psp-configurations.dto';
import { CardChecks, type CardVelocity } from './card-checks';
import type { PaymentInput, PaymentOutcome, PaymentResult, UnpaidInput } from './psp-payment-types';
import {
  CardDailyLimit,
  classifyRefusal,
  FeesExceedAmount,
  type AnomalyKind,
  type FailureReason,
  type Refusal,
} from './psp-refusals';
import { PspTopupLookup, type PspTopupRow } from './psp-topup-lookup';

/** Préfixe de la clé d'écriture par moyen (data-model « Correspondances » ; `psp_key_prefix` de la base). */
const KEY_PREFIX = { WAVE: 'wave', ORANGE_MONEY: 'om', CARD: 'psp' } as const;
const SAVEPOINT = 'psp_credit';

/** Référence de paiement utilisable comme élément de clé : 1 à 200 caractères, sans blanc (comme la base). */
function usableRef(ref: string): boolean {
  return ref.length >= 1 && ref.length <= 200 && !/\s/.test(ref);
}

@Injectable()
export class PspPaymentProcessor {
  private readonly log = new Logger(PspPaymentProcessor.name);

  constructor(
    private readonly lookup: PspTopupLookup,
    private readonly engine: LedgerEngineService,
    private readonly audit: AuditService,
    private readonly cards: CardChecks,
    private readonly deposits: DepositService,
  ) {}

  // ------------------------------------------------------------------------------ traitement

  async process(client: TxClient, input: PaymentInput): Promise<PaymentOutcome> {
    const { notification } = input;
    const payment = notification.payment;
    const topup = await this.lookup.findForUpdate(client, {
      configurationId: input.configurationId,
      merchantRef: payment.merchantReference,
      providerRef: payment.providerPaymentRef,
    });
    if (topup === null) {
      const { rows } = await client.query<{ operator_id: string }>(
        "SELECT current_setting('app.operator_id', true) AS operator_id",
      );
      return {
        disposition: 'UNMATCHED',
        outcome: null,
        topupId: null,
        walletId: null,
        operatorId: rows[0]!.operator_id,
        depositDue: false,
      };
    }
    switch (notification.kind) {
      case 'PAYMENT_SUCCEEDED':
        return this.succeeded(client, topup, input, payment);
      case 'PAYMENT_CANCELLED':
        if (topup.status === 'PENDING') {
          await client.query('SELECT cancel_psp_topup($1)', [topup.topupId]);
          await this.record(client, topup, 'PSP_TOPUP_CANCELLED', 'psp_topup', topup.topupId, {
            topup_id: topup.topupId,
            origin: input.origin,
          });
        }
        return this.done(topup, 'NO_EFFECT');
      default:
        // PAYMENT_FAILED : la recharge reste PENDING (le paiement peut être repris chez le PSP) ;
        // DISPUTE est à WP13 ; UNKNOWN n'a aucun effet.
        return this.done(topup, 'NO_EFFECT');
    }
  }

  /** Échec confirmé par l'interrogation, ou échéance dépassée, sous le même verrou. */
  async settleUnpaid(client: TxClient, input: UnpaidInput): Promise<PaymentOutcome> {
    const topup = await this.lookup.findForUpdate(client, {
      configurationId: input.configurationId,
      merchantRef: input.topupId,
    });
    if (topup === null) {
      const { rows } = await client.query<{ operator_id: string }>(
        "SELECT current_setting('app.operator_id', true) AS operator_id",
      );
      return {
        disposition: 'UNMATCHED',
        outcome: null,
        topupId: null,
        walletId: null,
        operatorId: rows[0]!.operator_id,
        depositDue: false,
      };
    }
    // Relu sous le verrou : seule une recharge encore PENDING se finalise ; rien n'a été payé.
    if (topup.status !== 'PENDING') return this.done(topup, 'NO_EFFECT');
    if (input.verdict === 'FAILED') {
      await client.query('SELECT fail_psp_topup($1, $2, false)', [topup.topupId, 'PSP_FAILED']);
    } else {
      const { rows } = await client.query<{ n: number }>(
        'SELECT expire_psp_topups($1::uuid[]) AS n',
        [[topup.topupId]],
      );
      if (rows[0]!.n !== 1) return this.done(topup, 'NO_EFFECT');
    }
    await this.record(client, topup, 'PSP_TOPUP_NOT_CREDITED', 'psp_topup', topup.topupId, {
      topup_id: topup.topupId,
      reason: input.verdict === 'FAILED' ? 'PSP_FAILED' : 'EXPIRED',
      paid: false,
    });
    return this.done(topup, 'NOT_CREDITED');
  }

  /**
   * Caution due du bracelet du portefeuille, APRÈS le COMMIT de la transaction qui a appelé `process` (transaction
   * distincte). Erreur : journal sans donnée personnelle, jamais relancée ; la caution reste `DUE`.
   */
  async afterCommit(
    operatorId: string,
    outcome: PaymentOutcome,
    audit: AuditContext,
  ): Promise<void> {
    if (!outcome.depositDue || outcome.walletId === null) return;
    try {
      await this.deposits.takeDueDepositForWallet(operatorId, outcome.walletId, audit);
    } catch (error) {
      const problem = resolveProblem(error);
      this.log.warn(
        `caution due non prise (recharge PSP) : wallet_id=${outcome.walletId} code=${problem.code}`,
      );
    }
  }

  // ------------------------------------------------------------------------------ succès d'un paiement

  private async succeeded(
    client: TxClient,
    topup: PspTopupRow,
    input: PaymentInput,
    payment: NormalizedPayment,
  ): Promise<PaymentOutcome> {
    if (topup.status === 'SUCCEEDED') {
      // Même paiement : doublon (aucune écriture ; la caution due est reprise, A33). Autre paiement : à rendre.
      if (topup.providerPaymentRef === payment.providerPaymentRef)
        return this.done(topup, 'DUPLICATE_PAYMENT', true);
      return this.mismatch(client, topup, input, payment);
    }
    // (a) le paiement doit se rapprocher EXACTEMENT de la recharge.
    if (
      !usableRef(payment.providerPaymentRef) ||
      (topup.providerPaymentRef !== null &&
        topup.providerPaymentRef !== payment.providerPaymentRef) ||
      (payment.merchantReference !== null && payment.merchantReference !== topup.topupId) ||
      payment.amount !== topup.amount ||
      payment.currency !== topup.currency
    )
      return this.mismatch(client, topup, input, payment);
    // (b) portefeuille.
    const wallet = await client.query<{ status: string }>(
      'SELECT status FROM wallet WHERE id = $1',
      [topup.walletId],
    );
    if (wallet.rows[0]?.status !== 'ACTIVE')
      return this.refuse(client, topup, input, payment, {
        reason: 'WALLET_BLOCKED',
        anomalyKind: 'PSP_TOPUP_NOT_CREDITED',
      });
    // (c) matrice des statuts (événement, grand livre).
    const context = await readLedgerContext(client, topup.ledgerId, topup.eventId, undefined);
    const accepted =
      context !== undefined &&
      context.eventStatus !== null &&
      isAccepted({
        eventStatus: context.eventStatus,
        ledgerStatus: context.ledgerStatus,
        type: 'TOPUP',
        source: 'PSP_WEBHOOK',
      }).ok;
    if (!accepted)
      return this.refuse(client, topup, input, payment, {
        reason: 'LEDGER_STATUS',
        anomalyKind: 'PSP_TOPUP_NOT_CREDITED',
      });
    // (d) carte : 3-D Secure, empreinte, plafond du jour.
    let card: { fingerprint: string; velocity: CardVelocity } | null = null;
    if (topup.method === 'CARD') {
      const verdict = await this.cards.check(client, topup, payment.card, input.receivedAt);
      if (!verdict.ok)
        return this.refuse(
          client,
          topup,
          input,
          payment,
          { reason: verdict.reason, anomalyKind: verdict.anomalyKind },
          verdict.fingerprint,
          verdict.threeDs,
        );
      card = {
        fingerprint: verdict.fingerprint,
        velocity: await this.cards.velocity(client, topup, verdict.fingerprint, input.receivedAt),
      };
    }
    // (e) le crédit, dans un SAVEPOINT : un refus définitif ne laisse rien au grand livre.
    return this.credit(client, topup, input, payment, card);
  }

  private async credit(
    client: TxClient,
    topup: PspTopupRow,
    input: PaymentInput,
    payment: NormalizedPayment,
    card: { fingerprint: string; velocity: CardVelocity } | null,
  ): Promise<PaymentOutcome> {
    await client.query(`SAVEPOINT ${SAVEPOINT}`);
    try {
      const written = await this.engine.execute(client, {
        type: 'TOPUP',
        source: 'PSP_WEBHOOK',
        idempotencyKey: `${KEY_PREFIX[topup.method]}:${topup.configurationId}:${payment.providerPaymentRef}`,
        occurredAt: input.receivedAt,
        ledgerId: topup.ledgerId,
        eventId: topup.eventId,
        currency: topup.currency,
        payload: {
          walletId: topup.walletId,
          channel: FEE_CHANNEL[topup.method],
          amount: topup.amount,
        },
        metadata: {
          psp_topup_id: topup.topupId,
          psp_configuration_id: topup.configurationId,
          psp_event_id: input.pspEventId,
        },
      });
      // Une écriture rejouée sur une recharge non créditée n'est pas un cas connu : l'erreur remonte.
      if (written.replayed || written.transactionId === null)
        throw new Error('recharge PSP : écriture déjà présente pour une recharge non créditée');
      const net = await client.query<{ net: string }>(
        `SELECT coalesce(-sum(p.amount), 0)::text AS net
           FROM posting p JOIN account a ON a.id = p.account_id
          WHERE p.transaction_id = $1 AND a.purpose = 'WALLET_PAID' AND a.wallet_id = $2`,
        [written.transactionId, topup.walletId],
      );
      const credited = BigInt(net.rows[0]!.net);
      // Frais = brut moins le net crédité au portefeuille (nul si l'organisateur les porte).
      if (credited <= 0n || credited > topup.amount) throw new FeesExceedAmount();
      const fee = topup.amount - credited;
      if (card === null) {
        await client.query('SELECT complete_psp_topup($1, $2, $3, $4)', [
          topup.topupId,
          written.transactionId,
          fee.toString(),
          payment.providerPaymentRef,
        ]);
      } else {
        try {
          await client.query('SELECT complete_card_topup($1, $2, $3, $4, $5, $6)', [
            topup.topupId,
            written.transactionId,
            fee.toString(),
            card.fingerprint,
            'SUCCEEDED',
            payment.providerPaymentRef,
          ]);
        } catch (error) {
          // La base refuse un dépassement du plafond de la carte par CL029 (même verrou, même contrôle).
          if (resolveProblem(error).code === 'CONFLICT_STATE') throw new CardDailyLimit();
          throw error;
        }
      }
      await client.query(`RELEASE SAVEPOINT ${SAVEPOINT}`);
      await this.record(client, topup, 'PSP_TOPUP_CREDITED', 'psp_topup', topup.topupId, {
        topup_id: topup.topupId,
        transaction_id: written.transactionId,
        amount: topup.amount,
        fee_amount: fee,
        origin: input.origin,
      });
      if (card !== null) await this.velocity(client, topup, card.velocity);
      return this.done(topup, 'CREDITED', true);
    } catch (error) {
      const code = resolveProblem(error).code;
      const refusal = classifyRefusal(error, code);
      // CL029 (CONFLICT_STATE) : plafond de carte, mais aussi « anomalie déjà résolue » (psp_complete_core).
      const conflict = error instanceof CardDailyLimit || code === 'CONFLICT_STATE';
      if (refusal === null && !conflict) throw error;
      await client.query(`ROLLBACK TO SAVEPOINT ${SAVEPOINT}`);
      await client.query(`RELEASE SAVEPOINT ${SAVEPOINT}`);
      // Anomalie fermée à la main : décision humaine déjà prise, aucun crédit, aucun nouveau refus, jamais de
      // reprise en boucle (le PSP rejoue le succès). Contrôlé AVANT le classement du plafond de carte.
      if (conflict && (await this.anomalyResolved(client, topup))) {
        this.log.warn(`succès tardif ignoré, anomalie déjà résolue : topup_id=${topup.topupId}`);
        return this.done(topup, 'NO_EFFECT');
      }
      if (refusal === null) throw error;
      return this.refuse(
        client,
        topup,
        input,
        payment,
        refusal,
        card?.fingerprint ?? null,
        card === null ? null : 'SUCCEEDED',
      );
    }
  }

  /** L'anomalie liée à la recharge existe et n'est plus ouverte (fermée par une personne). */
  private async anomalyResolved(client: TxClient, topup: PspTopupRow): Promise<boolean> {
    if (topup.anomalyId === null) return false;
    const { rows } = await client.query<{ status: string }>(
      'SELECT status FROM anomaly WHERE id = $1',
      [topup.anomalyId],
    );
    return rows[0] !== undefined && rows[0].status !== 'OPEN';
  }

  // ------------------------------------------------------------------------------ refus, écarts, vélocité

  /** Recharge `FAILED` (ou inchangée si déjà finalisée) et UNE anomalie portant l'argent à rendre. */
  private async refuse(
    client: TxClient,
    topup: PspTopupRow,
    input: PaymentInput,
    payment: NormalizedPayment,
    refusal: Refusal,
    fingerprint: string | null = null,
    threeDs: string | null = null,
  ): Promise<PaymentOutcome> {
    const isCard = topup.method === 'CARD';
    await client.query('SELECT fail_psp_topup($1, $2, true, $3, $4, $5)', [
      topup.topupId,
      refusal.reason,
      refusal.anomalyKind,
      isCard ? fingerprint : null,
      isCard ? threeDs : null,
    ]);
    // Une seule ligne d'audit par paiement : l'anomalie est celle de la recharge (rejeu : la même).
    if (topup.anomalyId === null)
      await this.record(client, topup, 'PSP_TOPUP_NOT_CREDITED', 'psp_topup', topup.topupId, {
        topup_id: topup.topupId,
        reason: refusal.reason,
        anomaly_kind: refusal.anomalyKind,
        amount: payment.amount,
        currency: payment.currency,
        origin: input.origin,
      });
    return this.done(topup, 'NOT_CREDITED');
  }

  /** Paiement qui ne correspond pas : anomalie `PSP_MISMATCH` UNE fois par paiement, rien au grand livre. */
  private async mismatch(
    client: TxClient,
    topup: PspTopupRow,
    input: PaymentInput,
    payment: NormalizedPayment,
  ): Promise<PaymentOutcome> {
    const key = `${input.configurationId}:${payment.providerPaymentRef}`;
    const seen = await client.query(
      `SELECT 1 FROM audit_log
        WHERE operator_id = $1 AND action = 'PSP_TOPUP_NOT_CREDITED'
          AND object_type = 'psp_payment' AND object_id = $2 LIMIT 1`,
      [topup.operatorId, key],
    );
    if (seen.rowCount === 0) {
      const toReturn = payment.amount > 0n ? payment.amount : 0n;
      await client.query(
        `INSERT INTO anomaly (operator_id, ledger_id, kind, amount, status)
         VALUES ($1, $2, 'PSP_MISMATCH', $3, 'OPEN')`,
        [topup.operatorId, topup.ledgerId, toReturn.toString()],
      );
      await this.record(client, topup, 'PSP_TOPUP_NOT_CREDITED', 'psp_payment', key, {
        topup_id: topup.topupId,
        reason: 'MISMATCH',
        amount: payment.amount,
        currency: payment.currency,
        origin: input.origin,
      });
    }
    return this.done(topup, 'MISMATCH');
  }

  /** `CARD_VELOCITY` (FR-026) : empreinte nouvelle qui atteint le seuil du portefeuille, montant 0. */
  private async velocity(
    client: TxClient,
    topup: PspTopupRow,
    velocity: CardVelocity,
  ): Promise<void> {
    if (!velocity.isNew || velocity.distinctCards < velocity.alertThreshold) return;
    await client.query(
      `INSERT INTO anomaly (operator_id, ledger_id, kind, amount, status)
       VALUES ($1, $2, 'CARD_VELOCITY', 0, 'OPEN')`,
      [topup.operatorId, topup.ledgerId],
    );
  }

  private done(topup: PspTopupRow, outcome: PaymentResult, depositDue = false): PaymentOutcome {
    return {
      disposition: 'PROCESSED',
      outcome,
      topupId: topup.topupId,
      walletId: topup.walletId,
      operatorId: topup.operatorId,
      depositDue,
    };
  }

  private record(
    client: TxClient,
    topup: PspTopupRow,
    action: AuditAction,
    objectType: string,
    objectId: string,
    after: Record<string, unknown>,
  ): Promise<void> {
    return this.audit.record(client, {
      operatorId: topup.operatorId,
      actorId: null,
      actorRole: null,
      origin: 'psp',
      requestId: null,
      action,
      objectType,
      objectId,
      after,
    });
  }
}

export type { AnomalyKind, FailureReason };
