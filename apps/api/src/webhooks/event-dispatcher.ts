// Traitement d'une notification conservée (mission 6, lot WP12, T061 ; A2, A4, A13, A19). UN seul code pour la
// réception et pour les reprises du travailleur. Une transaction par événement : verrou consultatif de l'événement,
// aiguillage, puis `mark_psp_event`, ensemble (tout ou rien). Une exception est attrapée : la transaction est
// annulée puis une troisième, courte, marque l'événement `RETRY` (`attempts` + 1). Aucun appel réseau ici.
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { AuditService, type AuditContext } from '../audit/audit.service';
import { TenantTx, type TxClient } from '../db/tenant-tx';
import { isSqlError } from '../errors/sqlstate-map';
import type { NormalizedNotification } from '../psp/psp.types';
import type { PaymentOutcome, PaymentResult } from '../topups/psp/psp-payment-types';
import { PspPaymentProcessor } from '../topups/psp/psp-payment-processor';
import { errorReason, logPspAlert } from './psp-alert-log';

/** Couture des contestations (WP13 y branche son gestionnaire ; facultatif avant). */
export const PSP_DISPUTE_HANDLER = Symbol('PSP_DISPUTE_HANDLER');

/** Événement conservé (`psp_event`), tel que le lisent la réception et le travailleur de reprise. */
export interface PspEventRef {
  pspEventId: string;
  operatorId: string;
  configurationId: string;
  receivedAt: Date;
}

export interface DispatchOutcome {
  /** `KEPT` : conservé tel quel, ni traité ni compté comme un essai (contestation sans gestionnaire). */
  disposition: 'PROCESSED' | 'UNMATCHED' | 'KEPT';
  outcome: PaymentResult | 'CHARGEBACK' | null;
  topupId: string | null;
  payment: PaymentOutcome | null;
}

export interface DisputeHandler {
  handle(
    client: TxClient,
    event: PspEventRef,
    notification: NormalizedNotification,
  ): Promise<DispatchOutcome>;
}

export type EventResult = 'PROCESSED' | 'UNMATCHED' | 'RETRY' | 'KEPT';

const AUDIT: AuditContext = { actorId: null, actorRole: null, origin: 'psp', requestId: null };

@Injectable()
export class EventDispatcher {
  private readonly log = new Logger('PspEvent');

  constructor(
    private readonly tx: TenantTx,
    private readonly processor: PspPaymentProcessor,
    private readonly audit: AuditService,
    @Optional() @Inject(PSP_DISPUTE_HANDLER) private readonly disputes?: DisputeHandler,
  ) {}

  /** Aiguillage dans la transaction de l'appelant (aucune écriture de l'événement ici). */
  async dispatch(
    client: TxClient,
    event: PspEventRef,
    notification: NormalizedNotification,
  ): Promise<DispatchOutcome> {
    switch (notification.kind) {
      case 'PAYMENT_SUCCEEDED':
      case 'PAYMENT_FAILED':
      case 'PAYMENT_CANCELLED': {
        const payment = await this.processor.process(client, {
          configurationId: event.configurationId,
          origin: 'NOTIFICATION',
          receivedAt: event.receivedAt,
          pspEventId: event.pspEventId,
          notification,
        });
        if (payment.disposition === 'UNMATCHED')
          return { disposition: 'UNMATCHED', outcome: null, topupId: null, payment };
        return {
          disposition: 'PROCESSED',
          outcome: payment.outcome ?? 'NO_EFFECT',
          topupId: payment.topupId,
          payment,
        };
      }
      case 'DISPUTE':
        if (this.disputes === undefined)
          return { disposition: 'KEPT', outcome: null, topupId: null, payment: null };
        return this.disputes.handle(client, event, notification);
      default:
        // Type inconnu du fournisseur : conservé, sans effet, signalé.
        logPspAlert(this.log, {
          event: 'psp.event.unknown_type',
          severity: 'WARN',
          reason: 'UNKNOWN_KIND',
          psp_event_id: event.pspEventId,
          psp_config_id: event.configurationId,
        });
        return { disposition: 'PROCESSED', outcome: 'NO_EFFECT', topupId: null, payment: null };
    }
  }

  /**
   * Traite l'événement (transaction propre), le marque, puis la caution due après le COMMIT. `expireUnmatched` : la
   * fenêtre de 24 h est écoulée, une recharge toujours introuvable devient un écart (jamais avant : A2).
   */
  async apply(
    event: PspEventRef,
    notification: NormalizedNotification,
    options: { expireUnmatched?: boolean } = {},
  ): Promise<EventResult> {
    let result: DispatchOutcome | 'ALREADY_PROCESSED';
    try {
      result = await this.tx.run(event.operatorId, async (client) => {
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
          `psp-event:${event.pspEventId}`,
        ]);
        const state = await client.query<{ status: string }>(
          'SELECT status FROM psp_event WHERE psp_event_id = $1',
          [event.pspEventId],
        );
        const status = state.rows[0]?.status;
        if (status === undefined) throw new Error('événement PSP introuvable');
        if (status === 'PROCESSED') return 'ALREADY_PROCESSED' as const;
        let outcome = await this.dispatch(client, event, notification);
        if (outcome.disposition === 'UNMATCHED' && options.expireUnmatched === true)
          outcome = await this.expireUnmatched(client, event, notification);
        if (outcome.disposition === 'KEPT') return outcome;
        // Déjà `UNMATCHED` et toujours introuvable : aucune écriture de plus.
        if (outcome.disposition === 'UNMATCHED' && status === 'UNMATCHED') return outcome;
        await client.query('SELECT mark_psp_event($1, $2, $3, $4)', [
          event.pspEventId,
          outcome.disposition,
          outcome.disposition === 'PROCESSED' ? outcome.outcome : null,
          outcome.disposition === 'PROCESSED' ? outcome.topupId : null,
        ]);
        return outcome;
      });
    } catch (error) {
      await this.markRetry(event, error);
      return 'RETRY';
    }
    if (result === 'ALREADY_PROCESSED') return 'PROCESSED';
    if (result.payment !== null && result.disposition === 'PROCESSED')
      await this.processor.afterCommit(event.operatorId, result.payment, AUDIT);
    return result.disposition;
  }

  /** Troisième transaction : l'erreur est journalisée sans donnée sensible, jamais relancée. */
  async markRetry(event: PspEventRef, error: unknown): Promise<void> {
    logPspAlert(this.log, {
      event: 'psp.event.processing_failed',
      severity: 'ERROR',
      reason: errorReason(error),
      sqlstate: isSqlError(error) ? error.code : null,
      psp_event_id: event.pspEventId,
      psp_config_id: event.configurationId,
    });
    try {
      await this.tx.run(event.operatorId, (client) =>
        client.query('SELECT mark_psp_event($1, $2)', [event.pspEventId, 'RETRY']),
      );
    } catch (markError) {
      logPspAlert(this.log, {
        event: 'psp.event.mark_retry_failed',
        severity: 'ERROR',
        reason: errorReason(markError),
        psp_event_id: event.pspEventId,
      });
    }
  }

  /**
   * Fenêtre de 24 h écoulée sans recharge correspondante. Un succès est de l'argent reçu qui ne correspond à rien :
   * anomalie `PSP_MISMATCH` UNE fois par paiement (même clé d'audit que `PspPaymentProcessor`) ; une contestation
   * de même (`expireUnmatchedDispute`). Les autres natures n'ont aucun effet. Aucune recharge, donc aucun grand livre : l'anomalie est sans montant ni grand livre (le
   * montant à rendre est dans la ligne d'audit et dans `psp_event.normalized`, lacune signalée au porteur).
   */
  private async expireUnmatched(
    client: TxClient,
    event: PspEventRef,
    notification: NormalizedNotification,
  ): Promise<DispatchOutcome> {
    if (notification.kind === 'PAYMENT_SUCCEEDED') {
      const key = `${event.configurationId}:${notification.payment.providerPaymentRef}`;
      const seen = await client.query(
        `SELECT 1 FROM audit_log
          WHERE operator_id = $1 AND action = 'PSP_TOPUP_NOT_CREDITED'
            AND object_type = 'psp_payment' AND object_id = $2 LIMIT 1`,
        [event.operatorId, key],
      );
      if (seen.rowCount === 0) {
        await client.query(
          `INSERT INTO anomaly (operator_id, ledger_id, kind, amount, status)
           VALUES ($1, NULL, 'PSP_MISMATCH', 0, 'OPEN')`,
          [event.operatorId],
        );
        await this.audit.record(client, {
          ...AUDIT,
          operatorId: event.operatorId,
          action: 'PSP_TOPUP_NOT_CREDITED',
          objectType: 'psp_payment',
          objectId: key,
          after: {
            reason: 'UNMATCHED_EXPIRED',
            psp_event_id: event.pspEventId,
            amount: notification.payment.amount,
            currency: notification.payment.currency,
          },
        });
      }
      logPspAlert(this.log, {
        event: 'psp.event.unmatched_expired',
        severity: 'ERROR',
        reason: 'PSP_MISMATCH',
        psp_event_id: event.pspEventId,
        psp_config_id: event.configurationId,
      });
      return { disposition: 'PROCESSED', outcome: 'MISMATCH', topupId: null, payment: null };
    }
    if (notification.kind === 'DISPUTE')
      return this.expireUnmatchedDispute(client, event, notification);
    return { disposition: 'PROCESSED', outcome: 'NO_EFFECT', topupId: null, payment: null };
  }

  /**
   * Contestation toujours introuvable après 24 h : même anomalie `PSP_MISMATCH` UNE fois par contestation, avec la
   * même clé d'audit que `ChargebackService.mismatch` (`psp_dispute` / `<configuration>:<contestation>`), donc une
   * seule anomalie quel que soit le chemin qui la voit en premier. Le montant contesté est dans l'audit.
   */
  private async expireUnmatchedDispute(
    client: TxClient,
    event: PspEventRef,
    notification: NormalizedNotification,
  ): Promise<DispatchOutcome> {
    const disputeId = notification.dispute?.providerDisputeId ?? notification.notificationId;
    const key = `${event.configurationId}:${disputeId}`;
    const seen = await client.query(
      `SELECT 1 FROM audit_log
        WHERE operator_id = $1 AND action = 'PSP_TOPUP_NOT_CREDITED'
          AND object_type = 'psp_dispute' AND object_id = $2 LIMIT 1`,
      [event.operatorId, key],
    );
    if (seen.rowCount === 0) {
      // Sans grand livre (recharge introuvable), la contrainte `anomaly_check` impose un montant nul : le montant
      // contesté est dans la ligne d'audit et dans `psp_event.normalized` (même lacune que pour un paiement).
      const amount = notification.dispute !== null ? notification.dispute.amount : 0n;
      await client.query(
        `INSERT INTO anomaly (operator_id, ledger_id, kind, amount, status)
         VALUES ($1, NULL, 'PSP_MISMATCH', 0, 'OPEN')`,
        [event.operatorId],
      );
      await this.audit.record(client, {
        ...AUDIT,
        operatorId: event.operatorId,
        action: 'PSP_TOPUP_NOT_CREDITED',
        objectType: 'psp_dispute',
        objectId: key,
        after: {
          reason: 'UNMATCHED_EXPIRED',
          psp_event_id: event.pspEventId,
          amount,
          currency: notification.payment.currency,
        },
      });
    }
    logPspAlert(this.log, {
      event: 'psp.event.unmatched_expired',
      severity: 'ERROR',
      reason: 'PSP_MISMATCH',
      psp_event_id: event.pspEventId,
      psp_config_id: event.configurationId,
    });
    return { disposition: 'PROCESSED', outcome: 'MISMATCH', topupId: null, payment: null };
  }
}
