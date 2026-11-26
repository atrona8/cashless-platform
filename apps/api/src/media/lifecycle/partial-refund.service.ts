// Rendu partiel en espèces au guichet (mission 9c, WP05 ; FR-001 à FR-013, NFR-001, NFR-002 ; contrat
// `refundPartialCash`). Un montant choisi du solde payé est rendu en espèces depuis la caisse de la session ouverte du
// terminal ; le bracelet reste actif, les crédits offerts et la caution ne bougent pas. Permis seulement si le
// prestataire l'autorise (`cash_partial_refund_allowed`) ET si l'organisateur l'active (`cash_partial_refund_enabled`),
// les deux lus RÉSOLUS à chaque rendu. Seconde personne quand le cumul du jour UTC du portefeuille dépasse
// `event.cash_refund_single_max` (`partial-refund-threshold.ts`). Phase de l'événement : contrôlée par la matrice du
// moteur (`status-matrix.ts`), la même que celle du guichet de retour (`WALLET_REFUND`). Frais : ceux du moteur.
import { fee } from '@cashless/shared-rules';
import { Injectable } from '@nestjs/common';
import { AuditService } from '../../audit/audit.service';
import { CascadeService } from '../../configuration/cascade.service';
import { SqlConfigResolver } from '../../configuration/sql-config-resolver';
import type { TxClient } from '../../db/tenant-tx';
import { ProblemException } from '../../errors/problem';
import type { Language } from '../../http/language';
import { lockWalletPaidBalance } from '../../ledger/db/ledger-queries';
import { LedgerEngineService } from '../../ledger/ledger-engine.service';
import { requireCashSession, type CounterActor } from './counter-access';
import { counterRefusal } from './lifecycle.dto';
import { requireApprovalOverDailyCumul } from './partial-refund-threshold';
import { lockCounterMedia } from './release.service';

/** Réponse `201` (`PartialCashRefund`), montants en unités mineures. */
export interface PartialCashRefundResult {
  transaction_id: string;
  media_id: string;
  wallet_id: string;
  amount_debited: number;
  fee: number;
  cash_handed: number;
  paid_balance_after: number;
  day_cumulative: number;
  approved_by: string | null;
  cash_session_id: string;
}

interface WalletRow {
  wallet_id: string;
  status: string;
  debit_authority: string;
  single_max: bigint | null;
}

const disabled = (detail: string) =>
  new ProblemException('REFUND_NOT_ALLOWED', {
    detail,
    extensions: { reason: 'PARTIAL_CASH_REFUND_DISABLED' },
  });

interface RefundPolicy {
  open?: unknown;
  minimum_amount?: unknown;
  channels?: unknown;
}

@Injectable()
export class PartialRefundService {
  private readonly resolver: SqlConfigResolver;

  constructor(
    private readonly audit: AuditService,
    private readonly engine: LedgerEngineService,
    private readonly cascade: CascadeService,
  ) {
    // Le résolveur ne tient aucun état (même usage que l'éligibilité au remboursement).
    this.resolver = new SqlConfigResolver(cascade);
  }

  async refund(
    client: TxClient,
    actor: CounterActor,
    mediaId: string,
    amount: bigint,
    idempotencyKey: string,
    language: Language,
    approve: ((client: TxClient) => Promise<string>) | null,
  ): Promise<PartialCashRefundResult> {
    // Verrou du bracelet d'abord (ordre : bracelet, puis portefeuille).
    await lockCounterMedia(client, actor, mediaId);
    const media = await client.query<{ status: string }>('SELECT status FROM media WHERE id = $1', [
      mediaId,
    ]);
    const mediaStatus = media.rows[0]!.status;
    if (mediaStatus !== 'ACTIVE')
      throw counterRefusal('release.media_blocked', language, 'MEDIA_STATE_INVALID', 409, {
        media_status: mediaStatus,
      });

    const wallet = await this.wallet(client, actor, mediaId);
    // Pendant que la passerelle a l'autorité, le solde central n'est pas sûr : avant toute écriture.
    if (wallet.debit_authority === 'EDGE') throw new ProblemException('DEBIT_AUTHORITY_EDGE');
    if (wallet.status !== 'ACTIVE') throw new ProblemException('WALLET_BLOCKED', { status: 422 });

    const now = new Date();
    const policy = await this.assertAllowed(client, actor, now);
    const session = requireCashSession(actor, language);

    // Solde payé verrouillé AVANT la lecture du cumul et du solde (ADR-195) : une dépense ou un rendu concurrent
    // est attendu, puis le cumul et le solde lus sont les réels.
    await lockWalletPaidBalance(client, {
      occurredAt: now,
      payload: { walletId: wallet.wallet_id },
    });
    const paid = await this.paidBalance(client, wallet.wallet_id);
    if (amount <= 0n) throw new ProblemException('AMOUNT_OUT_OF_RANGE');
    if (amount > paid) throw new ProblemException('INSUFFICIENT_FUNDS');
    const minimum = BigInt(typeof policy.minimum_amount === 'number' ? policy.minimum_amount : 0);
    if (amount < minimum) throw new ProblemException('AMOUNT_OUT_OF_RANGE');
    const config = await this.resolver.resolve({
      ledgerId: actor.ledgerId,
      eventId: actor.eventId,
      occurredAt: now,
      client,
    });
    // Le constructeur du grand livre refuserait des frais >= au montant : même refus, avant d'écrire.
    if (fee(amount, config.refundFee) >= amount) throw new ProblemException('AMOUNT_OUT_OF_RANGE');

    const { dayTotal, approvedBy } = await requireApprovalOverDailyCumul(
      client,
      {
        walletId: wallet.wallet_id,
        amount,
        limit: BigInt(wallet.single_max ?? 0),
        now,
        ledgerId: actor.ledgerId,
      },
      approve,
    );

    const refund = await this.engine.execute(client, {
      source: 'ONLINE',
      ledgerId: actor.ledgerId,
      eventId: actor.eventId,
      currency: actor.currency,
      mediaId,
      createdBy: actor.userId,
      occurredAt: now,
      type: 'WALLET_REFUND',
      idempotencyKey: `partial-refund:${mediaId}:${idempotencyKey}`,
      deviceId: actor.device.deviceId,
      ...(approvedBy ? { approvedBy } : {}),
      payload: { walletId: wallet.wallet_id, amount, moneyAccount: session.code },
      // `'true'` en chaîne : le cumul du jour lit `metadata->>'partial_cash_refund' = 'true'`.
      metadata: { cash_session_id: session.id, partial_cash_refund: 'true', media_id: mediaId },
    });
    const transactionId = refund.transactionId;
    if (!transactionId) throw new Error('rendu partiel : remboursement du solde non écrit');
    await client.query('SELECT attach_cash_tx($1, $2)', [session.id, transactionId]);

    // Espèces réellement sorties de la caisse : le montant net des frais, lu sur la ligne de la caisse.
    const out = await client.query<{ out: bigint }>(
      `SELECT coalesce(abs(sum(p.amount)), 0)::bigint AS out FROM posting p
        JOIN account a ON a.id = p.account_id WHERE p.transaction_id = $1 AND a.code = $2`,
      [transactionId, session.code],
    );
    const cash = BigInt(out.rows[0]!.out);
    const after = await this.paidBalance(client, wallet.wallet_id);
    const result: PartialCashRefundResult = {
      transaction_id: transactionId,
      media_id: mediaId,
      wallet_id: wallet.wallet_id,
      amount_debited: Number(amount),
      fee: Number(amount - cash),
      cash_handed: Number(cash),
      paid_balance_after: Number(after),
      day_cumulative: Number(dayTotal + amount),
      approved_by: approvedBy,
      cash_session_id: session.id,
    };
    await this.audit.record(client, {
      ...actor.audit,
      operatorId: actor.operatorId,
      action: 'MEDIA_PARTIAL_CASH_REFUNDED',
      objectType: 'media',
      objectId: mediaId,
      approverId: approvedBy,
      after: {
        transaction_id: transactionId,
        wallet_id: wallet.wallet_id,
        amount_debited: result.amount_debited,
        fee: result.fee,
        cash_handed: result.cash_handed,
        device_id: actor.device.deviceId,
        cash_session_id: session.id,
      },
    });
    return result;
  }

  /** Portefeuille actif du bracelet dans le grand livre du terminal ; aucun : le bracelet sert un autre événement. */
  private async wallet(client: TxClient, actor: CounterActor, mediaId: string): Promise<WalletRow> {
    const { rows } = await client.query<WalletRow>(
      `SELECT ma.wallet_id, w.status, l.debit_authority, e.cash_refund_single_max AS single_max
         FROM media_assignment ma JOIN wallet w ON w.id = ma.wallet_id JOIN ledger l ON l.id = w.ledger_id
         LEFT JOIN event e ON l.scope_type = 'EVENT' AND e.id = l.scope_id
        WHERE ma.media_id = $1 AND ma.released_at IS NULL AND w.ledger_id = $2 AND ma.currency = $3
        ORDER BY ma.wallet_id LIMIT 1`,
      [mediaId, actor.ledgerId, actor.currency],
    );
    if (!rows[0])
      throw new ProblemException('MEDIA_STATE_INVALID', {
        status: 409,
        detail:
          'Ce bracelet n’a pas de portefeuille dans le grand livre de l’événement de ce terminal.',
      });
    return rows[0];
  }

  /**
   * Les deux réglages RÉSOLUS à cet instant (autorisation du prestataire ET activation de l'événement) et la
   * politique de remboursement (ouverte, canal `CASH`). Retirer l'autorisation ne désactive pas les événements déjà
   * activés : le rendu est donc refusé ici, à chaque appel. Renvoie la politique résolue.
   */
  private async assertAllowed(
    client: TxClient,
    actor: CounterActor,
    now: Date,
  ): Promise<RefundPolicy> {
    const view = await this.cascade.resolveForEvent(client, actor.eventId, now);
    if (view.cash_partial_refund_allowed?.value !== true)
      throw disabled('Le rendu partiel en espèces n’est pas autorisé par le prestataire.');
    if (view.cash_partial_refund_enabled?.value !== true)
      throw disabled('Le rendu partiel en espèces n’est pas activé pour cet événement.');
    const raw = view.refund_policy?.value;
    const policy: RefundPolicy =
      typeof raw === 'object' && raw !== null ? (raw as RefundPolicy) : {};
    if (
      policy.open !== true ||
      !Array.isArray(policy.channels) ||
      !policy.channels.includes('CASH')
    )
      throw disabled(
        'La politique de remboursement de cet événement ne permet pas le rendu en espèces.',
      );
    return policy;
  }

  private async paidBalance(client: TxClient, walletId: string): Promise<bigint> {
    const { rows } = await client.query<{ paid: bigint }>(
      `SELECT coalesce(-sum(ab.balance), 0)::bigint AS paid FROM account a
         JOIN account_balance ab ON ab.account_id = a.id
        WHERE a.wallet_id = $1 AND a.purpose = 'WALLET_PAID'`,
      [walletId],
    );
    return BigInt(rows[0]!.paid);
  }
}
