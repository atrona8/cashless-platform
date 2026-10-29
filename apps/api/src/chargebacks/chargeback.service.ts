// Contestation d'un paiement par carte (mission 6, lot WP13, T065 et T066 ; FR-027 ; A14, A16 ; ADR-77). Appelé par
// `DisputeHandler` dans la transaction 2 de WP12 (jamais dans une autre) : recharge retrouvée et verrouillée par le
// contrat de WP11 (`PspTopupLookup.findForUpdate`, ordre : recharge, portefeuille, comptes), préconditions, puis
// `record_chargeback` (unicité par contestation, plafond sur le NET), écriture `CHARGEBACK`, rattachement et blocage
// du portefeuille, TOUT dans la même transaction (NFR-008). Grand livre `LOCKED` : rien n'est écrit au grand livre,
// la contestation est conservée `late` avec son anomalie `LATE_CHARGEBACK` ; l'écriture vient de l'approbation
// (`late-chargeback-action.ts`), sous la MÊME clé `psp:<configuration>:<contestation>`.
import { Injectable, Logger } from '@nestjs/common';
import { AuditService, type AuditContext } from '../audit/audit.service';
import type { TxClient } from '../db/tenant-tx';
import { isSqlError } from '../errors/sqlstate-map';
import { ProblemException } from '../errors/problem';
import { BuildError } from '../ledger/types';
import { readLedgerContext } from '../ledger/db/ledger-queries';
import { LedgerEngineService } from '../ledger/ledger-engine.service';
import type { NormalizedNotification } from '../psp/psp.types';
import { FEE_CHANNEL } from '../psp-configurations/psp-configurations.dto';
import { PspTopupLookup, type PspTopupRow } from '../topups/psp/psp-topup-lookup';
import { logPspAlert } from '../webhooks/psp-alert-log';
import type { DispatchOutcome, PspEventRef } from '../webhooks/event-dispatcher';

const SYSTEM: AuditContext = { actorId: null, actorRole: null, origin: 'psp', requestId: null };
const SAVEPOINT = 'chargeback_write';

/** Clé d'écriture du moteur : la même pour la voie normale et la voie tardive (une contestation = une écriture). */
export function chargebackKey(configurationId: string, disputeId: string): string {
  return `psp:${configurationId}:${disputeId}`;
}

export interface ChargebackWrite {
  chargebackId: string;
  disputeId: string;
  amount: bigint;
}

export interface ChargebackPosted {
  transactionId: string;
  replayed: boolean;
  walletBlocked: boolean;
  walletStatus: string;
}

@Injectable()
export class ChargebackService {
  private readonly log = new Logger('Chargeback');

  constructor(
    private readonly lookup: PspTopupLookup,
    private readonly engine: LedgerEngineService,
    private readonly audit: AuditService,
  ) {}

  /** Traite une notification `DISPUTE` (transaction de l'appelant). */
  async apply(
    client: TxClient,
    event: PspEventRef,
    notification: NormalizedNotification,
  ): Promise<DispatchOutcome> {
    const payment = notification.payment;
    const dispute = notification.dispute;
    const topup = await this.lookup.findForUpdate(client, {
      configurationId: event.configurationId,
      merchantRef: payment.merchantReference,
      providerRef: payment.providerPaymentRef,
    });
    if (topup === null)
      return { disposition: 'UNMATCHED', outcome: null, topupId: null, payment: null };
    if (dispute === null || dispute.providerDisputeId.length === 0 || dispute.amount <= 0n)
      return this.mismatch(client, event, topup, notification, 'INVALID_DISPUTE');
    if (topup.configurationId !== event.configurationId)
      return this.mismatch(client, event, topup, notification, 'OTHER_CONFIGURATION');
    if (topup.method !== 'CARD')
      return this.mismatch(client, event, topup, notification, 'NOT_CARD');
    if (topup.status !== 'SUCCEEDED' || topup.topupTxId === null)
      return this.mismatch(client, event, topup, notification, 'NOT_CREDITED');
    if (payment.currency !== topup.currency)
      return this.mismatch(client, event, topup, notification, 'CURRENCY');

    const context = await readLedgerContext(client, topup.ledgerId, topup.eventId, undefined);
    if (context === undefined) throw new Error('grand livre de la recharge introuvable');
    const late = context.ledgerStatus === 'LOCKED';

    await client.query(`SAVEPOINT ${SAVEPOINT}`);
    let recorded: { psp_chargeback_id: string; duplicate: boolean };
    try {
      const { rows } = await client.query<{ psp_chargeback_id: string; duplicate: boolean }>(
        'SELECT * FROM record_chargeback($1, $2, $3, $4)',
        [topup.topupId, dispute.providerDisputeId, dispute.amount.toString(), late],
      );
      recorded = rows[0]!;
    } catch (error) {
      await client.query(`ROLLBACK TO SAVEPOINT ${SAVEPOINT}`);
      const reason = isSqlError(error) ? RECORD_REFUSALS[error.code] : undefined;
      if (reason === undefined) throw error;
      return this.mismatch(client, event, topup, notification, reason);
    }
    if (recorded.duplicate) {
      await client.query(`RELEASE SAVEPOINT ${SAVEPOINT}`);
      return this.duplicate(client, event, topup, recorded.psp_chargeback_id, dispute.amount);
    }
    const write: ChargebackWrite = {
      chargebackId: recorded.psp_chargeback_id,
      disputeId: dispute.providerDisputeId,
      amount: dispute.amount,
    };
    if (late) {
      await client.query(`RELEASE SAVEPOINT ${SAVEPOINT}`);
      await this.record(client, topup, 'CHARGEBACK_RECORDED', write, { late: true, tx: null });
      return this.done(topup);
    }
    let posted: ChargebackPosted;
    try {
      posted = await this.post(client, topup, write, {
        source: 'PSP_WEBHOOK',
        occurredAt: event.receivedAt,
        metadata: { psp_event_id: event.pspEventId },
      });
    } catch (error) {
      // Refus définitif et métier du moteur (événement hors période, compte inactif…) : rien n'a été écrit, l'écart
      // est signalé pour décision humaine. Toute autre erreur est inattendue : transaction annulée, événement RETRY.
      if (!(error instanceof ProblemException || error instanceof BuildError)) throw error;
      await client.query(`ROLLBACK TO SAVEPOINT ${SAVEPOINT}`);
      return this.mismatch(client, event, topup, notification, 'ENGINE_REFUSED');
    }
    await client.query(`RELEASE SAVEPOINT ${SAVEPOINT}`);
    await this.record(client, topup, 'CHARGEBACK_RECORDED', write, {
      late: false,
      tx: posted.transactionId,
      blocked: posted.walletBlocked,
      wallet_status: posted.walletStatus,
    });
    return this.done(topup);
  }

  /**
   * Écriture `CHARGEBACK` rattachée à la contestation, puis blocage du portefeuille si son solde payé n'a pas couvert
   * le montant (le reste est allé aux pertes du payeur du contrat). Le blocage se décide sur les lignes réellement
   * écrites sous le verrou des comptes (jamais sur une lecture antérieure) : il ne peut ni être omis ni précéder
   * l'écriture. Appelé par la voie normale (`PSP_WEBHOOK`) et par la voie tardive (`BACKOFFICE`, deux personnes).
   */
  async post(
    client: TxClient,
    topup: PspTopupRow,
    cb: ChargebackWrite,
    options: {
      source: 'PSP_WEBHOOK' | 'BACKOFFICE';
      occurredAt: Date;
      createdBy?: string;
      approvedBy?: string;
      metadata?: Record<string, unknown>;
    },
  ): Promise<ChargebackPosted> {
    const written = await this.engine.execute(client, {
      type: 'CHARGEBACK',
      source: options.source,
      idempotencyKey: chargebackKey(topup.configurationId, cb.disputeId),
      occurredAt: options.occurredAt,
      ledgerId: topup.ledgerId,
      eventId: topup.eventId,
      currency: topup.currency,
      ...(options.createdBy !== undefined ? { createdBy: options.createdBy } : {}),
      ...(options.approvedBy !== undefined ? { approvedBy: options.approvedBy } : {}),
      payload: { walletId: topup.walletId, channel: FEE_CHANNEL.CARD, amount: cb.amount },
      metadata: {
        psp_topup_id: topup.topupId,
        psp_configuration_id: topup.configurationId,
        dispute_id: cb.disputeId,
        ...options.metadata,
      },
    });
    if (written.transactionId === null) throw new Error('contestation : aucune transaction écrite');
    await client.query('SELECT attach_chargeback_tx($1, $2)', [
      cb.chargebackId,
      written.transactionId,
    ]);
    const debited = await client.query<{ debited: string }>(
      `SELECT coalesce(sum(p.amount) FILTER (WHERE p.amount > 0), 0)::text AS debited
         FROM posting p JOIN account a ON a.id = p.account_id
        WHERE p.transaction_id = $1 AND a.purpose = 'WALLET_PAID' AND a.wallet_id = $2`,
      [written.transactionId, topup.walletId],
    );
    const wallet = await client.query<{ status: string }>(
      'SELECT status FROM wallet WHERE id = $1',
      [topup.walletId],
    );
    const walletStatus = wallet.rows[0]?.status ?? 'UNKNOWN';
    const shortfall = BigInt(debited.rows[0]!.debited) < cb.amount;
    // Un portefeuille clos ne peut plus payer : il n'y a rien à bloquer (la base le refuse).
    const block = shortfall && walletStatus !== 'CLOSED';
    if (block)
      await client.query('SELECT block_wallet_after_chargeback($1, $2)', [
        topup.walletId,
        cb.chargebackId,
      ]);
    return {
      transactionId: written.transactionId,
      replayed: written.replayed,
      walletBlocked: block,
      walletStatus: block ? 'BLOCKED' : walletStatus,
    };
  }

  /** Audit d'une contestation traitée (FR-031) : auteur = système/PSP, terminal néant. */
  record(
    client: TxClient,
    topup: PspTopupRow,
    action: 'CHARGEBACK_RECORDED',
    cb: ChargebackWrite,
    after: Record<string, unknown>,
    context: AuditContext = SYSTEM,
    approverId?: string,
  ): Promise<void> {
    return this.audit.record(client, {
      ...context,
      operatorId: topup.operatorId,
      action,
      objectType: 'psp_chargeback',
      objectId: cb.chargebackId,
      ...(approverId !== undefined ? { approverId } : {}),
      after: {
        topup_id: topup.topupId,
        dispute_id: cb.disputeId,
        amount: cb.amount,
        currency: topup.currency,
        ...after,
      },
    });
  }

  /** Doublon : aucune écriture ; un montant différent est ignoré et signalé, jamais appliqué. */
  private async duplicate(
    client: TxClient,
    event: PspEventRef,
    topup: PspTopupRow,
    chargebackId: string,
    amount: bigint,
  ): Promise<DispatchOutcome> {
    const { rows } = await client.query<{ amount: string }>(
      'SELECT amount::text AS amount FROM psp_chargeback WHERE psp_chargeback_id = $1',
      [chargebackId],
    );
    if (rows[0] !== undefined && BigInt(rows[0].amount) !== amount)
      logPspAlert(this.log, {
        event: 'psp.chargeback.amount_differs',
        severity: 'WARN',
        reason: 'DUPLICATE_DIFFERENT_AMOUNT',
        psp_event_id: event.pspEventId,
        psp_config_id: event.configurationId,
      });
    return {
      disposition: 'PROCESSED',
      outcome: 'NO_EFFECT',
      topupId: topup.topupId,
      payment: null,
    };
  }

  private done(topup: PspTopupRow): DispatchOutcome {
    return {
      disposition: 'PROCESSED',
      outcome: 'CHARGEBACK',
      topupId: topup.topupId,
      payment: null,
    };
  }

  /**
   * Contestation qui ne peut pas s'écrire : aucune écriture au grand livre, anomalie `PSP_MISMATCH` UNE fois par
   * contestation (clé d'audit), événement `PROCESSED` avec `outcome = MISMATCH`. Jamais `UNMATCHED` ici.
   */
  private async mismatch(
    client: TxClient,
    event: PspEventRef,
    topup: PspTopupRow,
    notification: NormalizedNotification,
    reason: string,
  ): Promise<DispatchOutcome> {
    const disputeId = notification.dispute?.providerDisputeId ?? notification.notificationId;
    const key = `${event.configurationId}:${disputeId}`;
    const seen = await client.query(
      `SELECT 1 FROM audit_log
        WHERE operator_id = $1 AND action = 'PSP_TOPUP_NOT_CREDITED'
          AND object_type = 'psp_dispute' AND object_id = $2 LIMIT 1`,
      [topup.operatorId, key],
    );
    if (seen.rowCount === 0) {
      const amount =
        notification.dispute !== null && notification.dispute.amount > 0n
          ? notification.dispute.amount
          : 0n;
      await client.query(
        `INSERT INTO anomaly (operator_id, ledger_id, kind, amount, status)
         VALUES ($1, $2, 'PSP_MISMATCH', $3, 'OPEN')`,
        [topup.operatorId, topup.ledgerId, amount.toString()],
      );
      await this.audit.record(client, {
        ...SYSTEM,
        operatorId: topup.operatorId,
        action: 'PSP_TOPUP_NOT_CREDITED',
        objectType: 'psp_dispute',
        objectId: key,
        after: { topup_id: topup.topupId, reason, amount, currency: notification.payment.currency },
      });
    }
    logPspAlert(this.log, {
      event: 'psp.chargeback.mismatch',
      severity: 'ERROR',
      reason,
      psp_event_id: event.pspEventId,
      psp_config_id: event.configurationId,
    });
    return {
      disposition: 'PROCESSED',
      outcome: 'MISMATCH',
      topupId: topup.topupId,
      payment: null,
    };
  }
}

/** Refus de `record_chargeback` qui deviennent un écart (aucune écriture) ; le reste repart (RETRY). */
const RECORD_REFUSALS: Readonly<Record<string, string>> = {
  CL043: 'OVER_REMAINING',
  CL044: 'NOT_ELIGIBLE',
  CL029: 'DISPUTE_ID_REUSED',
};
