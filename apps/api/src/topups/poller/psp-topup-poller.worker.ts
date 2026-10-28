// Interrogation des recharges PSP en attente (mission 6, lot WP12, T062 ; R-12, A15, A33). `psp_poll_candidates`
// (lecture neutre, tous prestataires) rend les recharges `PENDING` de plus de 2 minutes. Pour chacune : le statut est
// lu chez le PSP HORS de toute transaction, PUIS le processeur de WP11 prend le verrou de la recharge et applique,
// dans `TenantTx.run`. Une configuration SUSPENDED n'arrête pas l'interrogation de ses recharges (A15). En production
// avec un fournisseur indisponible : travailleur inactif (0, aucune erreur). Aucun secret, aucune référence de
// secret, aucun corps dans un journal.
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { AuditContext } from '../../audit/audit.service';
import { TenantTx } from '../../db/tenant-tx';
import { WorkerRegistry, type ProcessWorker } from '../../processes/worker';
import type { PspAdapter } from '../../psp/psp-adapter.port';
import type { PspAdapterRegistry } from '../../psp/psp-adapter-registry';
import type { PspSecretStore, PspSecrets } from '../../psp/psp-secret-store.port';
import { PSP_ADAPTERS, PSP_SECRET_STORE } from '../../psp/psp.tokens';
import type { NormalizedNotification, PspProviderName } from '../../psp/psp.types';
import { errorReason, logPspAlert } from '../../webhooks/psp-alert-log';
import { PspPaymentProcessor } from '../psp/psp-payment-processor';
import type { PaymentOutcome } from '../psp/psp-payment-types';
import { ALARM_POLL_FAILURE } from './poller-alarms';

/** Recharges lues par passage (borne de `psp_poll_candidates` : 500). */
export const POLL_BATCH = 100;

const AUDIT: AuditContext = { actorId: null, actorRole: null, origin: 'psp', requestId: null };

interface Candidate {
  psp_topup_id: string;
  operator_id: string;
  psp_configuration_id: string;
  provider: PspProviderName;
  method: string;
  provider_payment_ref: string | null;
  created_at: Date;
  expires_at: Date;
  expired: boolean;
}

interface WebhookContext {
  holder_party_id: string;
  secret_ref: string;
}

@Injectable()
export class PspTopupPollerWorker implements ProcessWorker {
  readonly name = 'psp-poller';
  private readonly log = new Logger(PspTopupPollerWorker.name);
  private alarmCode = 0;

  constructor(
    registry: WorkerRegistry,
    private readonly tx: TenantTx,
    private readonly processor: PspPaymentProcessor,
    @Inject(PSP_ADAPTERS) private readonly adapters: PspAdapterRegistry,
    @Inject(PSP_SECRET_STORE) private readonly secrets: PspSecretStore,
  ) {
    registry.register(this);
  }

  /** Fournisseur indisponible (production, OP-N81) : rien à interroger. */
  private get active(): boolean {
    return this.adapters.available;
  }

  private candidates(): Promise<Candidate[]> {
    return this.tx.withoutTenant(async (client) => {
      const { rows } = await client.query<Candidate>('SELECT * FROM psp_poll_candidates($1)', [
        POLL_BATCH,
      ]);
      return rows;
    });
  }

  /** Rend le nombre de recharges tranchées ; une recharge dont le PSP ne répond pas n'est pas comptée. */
  async runOnce(): Promise<number> {
    if (!this.active) return 0;
    let settled = 0;
    for (const candidate of await this.candidates()) {
      try {
        if (await this.poll(candidate)) settled += 1;
      } catch (error) {
        this.alarmCode = ALARM_POLL_FAILURE;
        logPspAlert(this.log, {
          event: 'psp.poll.failed',
          severity: 'ERROR',
          reason: errorReason(error),
          psp_topup_id: candidate.psp_topup_id,
          psp_config_id: candidate.psp_configuration_id,
        });
      }
    }
    return settled;
  }

  /** `true` si la recharge a été tranchée (crédit, refus définitif, échec, expiration, annulation). */
  private async poll(candidate: Candidate): Promise<boolean> {
    const adapter: PspAdapter = this.adapters.forProvider(candidate.provider);
    const secrets = await this.secretsOf(candidate);
    // Hors transaction : AUCUN appel au PSP sous verrou (R-12).
    const status = await adapter.getStatus(
      {
        merchantReference: candidate.psp_topup_id,
        providerPaymentRef: candidate.provider_payment_ref,
      },
      secrets,
    );
    const base = { configurationId: candidate.psp_configuration_id, receivedAt: new Date() };

    if (status.state === 'PAID' || status.state === 'CANCELLED') {
      // Payé : même chemin que la notification (clé d'écriture portée par WP11). Annulé chez le PSP : annulation
      // confirmée. Sans détail de paiement, on ne devine rien.
      if (status.payment === null) throw new Error('statut du PSP sans paiement');
      const notification: NormalizedNotification = {
        notificationId: `poll:${candidate.psp_topup_id}`,
        kind: status.state === 'PAID' ? 'PAYMENT_SUCCEEDED' : 'PAYMENT_CANCELLED',
        payment: status.payment,
        dispute: null,
      };
      const outcome = await this.tx.run(candidate.operator_id, (client) =>
        this.processor.process(client, {
          ...base,
          origin: 'POLL',
          pspEventId: null,
          notification,
        }),
      );
      await this.processor.afterCommit(candidate.operator_id, outcome, AUDIT);
      return settledByPayment(outcome, status.state);
    }
    if (status.state === 'FAILED') {
      const outcome = await this.settle(candidate, 'FAILED');
      return outcome.outcome === 'NOT_CREDITED';
    }
    // Toujours en attente (ou inconnu du PSP) : seule l'échéance, relue APRÈS le statut, tranche.
    if (candidate.expired) {
      const outcome = await this.settle(candidate, 'EXPIRED');
      return outcome.outcome === 'NOT_CREDITED';
    }
    return false;
  }

  private settle(candidate: Candidate, verdict: 'FAILED' | 'EXPIRED'): Promise<PaymentOutcome> {
    return this.tx.run(candidate.operator_id, (client) =>
      this.processor.settleUnpaid(client, {
        configurationId: candidate.psp_configuration_id,
        topupId: candidate.psp_topup_id,
        verdict,
        observedAt: new Date(),
      }),
    );
  }

  /** Secrets du coffre, par la référence de la configuration (lecture neutre, jamais journalisée). */
  private async secretsOf(candidate: Candidate): Promise<PspSecrets> {
    const context = await this.tx.withoutTenant(async (client) => {
      const { rows } = await client.query<WebhookContext>(
        'SELECT holder_party_id, secret_ref FROM psp_webhook_context($1)',
        [candidate.psp_configuration_id],
      );
      return rows[0] ?? null;
    });
    if (context === null) throw new Error('configuration PSP introuvable');
    return this.secrets.get({
      configurationId: candidate.psp_configuration_id,
      holderPartyId: context.holder_party_id,
      secretRef: context.secret_ref,
    });
  }

  alarm(): number {
    return this.alarmCode;
  }

  async describe(): Promise<string[]> {
    if (!this.active) return [`${this.name} : inactif (fournisseur PSP indisponible)`];
    return (await this.candidates()).map(
      (c) =>
        `${this.name} : recharge ${c.psp_topup_id} (${c.provider}, ${c.method}) à interroger` +
        `${c.expired ? ', échéance dépassée' : ''}`,
    );
  }
}

function settledByPayment(outcome: PaymentOutcome, state: 'PAID' | 'CANCELLED'): boolean {
  return (
    outcome.disposition === 'PROCESSED' &&
    (state === 'CANCELLED' || outcome.outcome !== 'NO_EFFECT')
  );
}
