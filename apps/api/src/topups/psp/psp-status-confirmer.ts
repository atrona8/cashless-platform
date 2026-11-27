// Relecture authentifiée du statut d'une recharge PSP (mission 12b-1, lot WP03 ; interfaces.md §5 ; FR-001, FR-006,
// NFR-005). Seule voie de crédit après un signal (ou une notification « à relire ») : le statut est lu chez le PSP
// avec les secrets du coffre, HORS de toute transaction (R-12), puis appliqué par `PspPaymentProcessor` (verrou de la
// recharge, clé d'écriture unique : un paiement n'est jamais crédité deux fois). Un montant ne vient JAMAIS d'un signal.
// Utilisé par le travailleur d'interrogation (filet de 2 minutes) et, hors requête, par la réception.
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { AuditContext } from '../../audit/audit.service';
import { TenantTx } from '../../db/tenant-tx';
import type { PspAdapterRegistry } from '../../psp/psp-adapter-registry';
import type { PspSecretStore, PspSecrets } from '../../psp/psp-secret-store.port';
import { PSP_ADAPTERS, PSP_SECRET_STORE } from '../../psp/psp.tokens';
import type { NormalizedNotification, PspProviderName } from '../../psp/psp.types';
import { errorReason, logPspAlert } from '../../webhooks/psp-alert-log';
import { PspPaymentProcessor } from './psp-payment-processor';
import type { PaymentOutcome } from './psp-payment-types';

const AUDIT: AuditContext = { actorId: null, actorRole: null, origin: 'psp', requestId: null };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Au plus une relecture par recharge et par intervalle (mémoire du processus). */
export const CONFIRM_MIN_INTERVAL_MS = 60_000;
/** Borne de la mémoire des relectures : les plus anciennes sont évincées. */
export const CONFIRM_MEMORY_MAX = 10_000;

export interface ConfirmableTopup {
  pspTopupId: string;
  operatorId: string;
  pspConfigurationId: string;
  provider: PspProviderName;
  providerPaymentRef: string | null;
}

export type ConfirmResult = 'APPLIED' | 'PENDING' | 'FAILED';

interface WebhookContext {
  provider: PspProviderName;
  holder_party_id: string;
  secret_ref: string;
  operator_id: string;
}

interface PendingRow {
  psp_topup_id: string;
  provider: PspProviderName;
  provider_payment_ref: string | null;
}

@Injectable()
export class PspStatusConfirmer {
  private readonly log = new Logger(PspStatusConfirmer.name);
  /** Recharge -> instant de la dernière relecture programmée (ordre d'insertion = ancienneté). */
  private readonly lastRun = new Map<string, number>();

  constructor(
    private readonly tx: TenantTx,
    private readonly processor: PspPaymentProcessor,
    @Inject(PSP_ADAPTERS) private readonly adapters: PspAdapterRegistry,
    @Inject(PSP_SECRET_STORE) private readonly secrets: PspSecretStore,
  ) {}

  /**
   * Lit le statut et l'applique ; une erreur (adaptateur, coffre) est journalisée sans secret et rend `FAILED` : la
   * recharge reste `PENDING`.
   */
  async confirm(topup: ConfirmableTopup): Promise<ConfirmResult> {
    try {
      return (await this.check(topup)).result;
    } catch (error) {
      logPspAlert(this.log, {
        event: 'psp.confirm.failed',
        severity: 'ERROR',
        reason: errorReason(error),
        psp_topup_id: topup.pspTopupId,
        psp_config_id: topup.pspConfigurationId,
      });
      return 'FAILED';
    }
  }

  /**
   * Comme `confirm`, mais l'erreur remonte (le travailleur d'interrogation y lit son alarme) et le détail de
   * l'issue est rendu : `settled` vaut vrai si la recharge a été tranchée (crédit, refus, annulation, échéance).
   * `expired` : la recharge est échue ; si le PSP ne la dit ni payée ni annulée ni échouée, l'échéance, relue APRÈS
   * le statut, la tranche.
   */
  async check(
    topup: ConfirmableTopup,
    options: { expired?: boolean } = {},
  ): Promise<{ result: 'APPLIED' | 'PENDING'; settled: boolean }> {
    const adapter = this.adapters.forProvider(topup.provider);
    const secrets = await this.secretsOf(topup);
    // Hors transaction : AUCUN appel au PSP sous verrou (R-12).
    const status = await adapter.getStatus(
      { merchantReference: topup.pspTopupId, providerPaymentRef: topup.providerPaymentRef },
      secrets,
    );
    const base = { configurationId: topup.pspConfigurationId, receivedAt: new Date() };

    if (status.state === 'PAID' || status.state === 'CANCELLED') {
      // Payé : même chemin que la notification (clé d'écriture portée par WP11). Annulé chez le PSP : annulation
      // confirmée. Sans détail de paiement, on ne devine rien.
      if (status.payment === null) throw new Error('statut du PSP sans paiement');
      const notification: NormalizedNotification = {
        notificationId: `poll:${topup.pspTopupId}`,
        kind: status.state === 'PAID' ? 'PAYMENT_SUCCEEDED' : 'PAYMENT_CANCELLED',
        payment: status.payment,
        dispute: null,
      };
      const outcome = await this.tx.run(topup.operatorId, (client) =>
        this.processor.process(client, {
          ...base,
          origin: 'POLL',
          pspEventId: null,
          notification,
        }),
      );
      await this.processor.afterCommit(topup.operatorId, outcome, AUDIT);
      return { result: 'APPLIED', settled: settledByPayment(outcome, status.state) };
    }
    if (status.state === 'FAILED') {
      const outcome = await this.settle(topup, 'FAILED');
      return { result: 'APPLIED', settled: outcome.outcome === 'NOT_CREDITED' };
    }
    if (options.expired === true) {
      const outcome = await this.settle(topup, 'EXPIRED');
      return { result: 'APPLIED', settled: outcome.outcome === 'NOT_CREDITED' };
    }
    return { result: 'PENDING', settled: false };
  }

  /**
   * Programme, APRÈS la réponse (`setImmediate`, jamais dans la requête), la relecture de la recharge désignée par un
   * signal. Rien si la recharge est inconnue, d'une autre configuration ou déjà tranchée. Au plus une relecture par
   * recharge et par minute, quelle que soit la référence employée pour la désigner.
   */
  scheduleConfirmation(
    merchantReference: string | null,
    configurationId: string,
    providerPaymentRef: string | null = null,
  ): void {
    setImmediate(() => {
      this.confirmScheduled(merchantReference, configurationId, providerPaymentRef).catch(
        (error: unknown) =>
          logPspAlert(this.log, {
            event: 'psp.signal.confirm_error',
            severity: 'ERROR',
            reason: errorReason(error),
            psp_config_id: configurationId,
          }),
      );
    });
  }

  private async confirmScheduled(
    merchantReference: string | null,
    configurationId: string,
    providerPaymentRef: string | null,
  ): Promise<void> {
    const context = await this.contextOf(configurationId);
    if (context === null) return this.unmatched(configurationId);
    const operatorId = context.operator_id;
    const row = await this.tx.run(operatorId, async (client) => {
      const byId =
        merchantReference !== null && UUID.test(merchantReference) ? merchantReference : null;
      const { rows } = await client.query<PendingRow>(
        `SELECT psp_topup_id, provider, provider_payment_ref FROM psp_topup
          WHERE psp_configuration_id = $1 AND status = 'PENDING'
            AND (psp_topup_id = $2::uuid OR ($3::text IS NOT NULL AND provider_payment_ref = $3))
          ORDER BY (psp_topup_id = $2::uuid) DESC NULLS LAST LIMIT 1`,
        [configurationId, byId, providerPaymentRef],
      );
      return rows[0] ?? null;
    });
    if (row === null) return this.unmatched(configurationId);
    if (!this.allow(row.psp_topup_id)) return;
    const result = await this.confirm({
      pspTopupId: row.psp_topup_id,
      operatorId,
      pspConfigurationId: configurationId,
      provider: row.provider,
      providerPaymentRef: row.provider_payment_ref,
    });
    // Un échec (réseau, coffre) ne bloque pas la relecture suivante : la borne ne reste posée qu'après une
    // relecture aboutie (`APPLIED` ou `PENDING`).
    if (result === 'FAILED') this.lastRun.delete(row.psp_topup_id);
  }

  /**
   * Litige Stripe : la notification (authentifiée) ne porte que le PaymentIntent. L'adaptateur retrouve la session
   * et la référence marchande (`resolvePaymentReference`, appel au PSP HORS transaction). Rend le litige normalisé,
   * référence remplie, ou `null` (adaptateur sans la méthode, aucune résolution, erreur, borne d'une résolution par
   * litige et par minute) : l'appelant (`EventDispatcher`) le laisse alors `UNMATCHED`, retenté puis anomalie à 24 h.
   * Une erreur est journalisée sans secret et ne pose pas la borne.
   */
  async resolveDispute(
    configurationId: string,
    notification: NormalizedNotification,
  ): Promise<NormalizedNotification | null> {
    if (notification.dispute === null) return null;
    const key = `dispute:${configurationId}:${notification.dispute.providerDisputeId}`;
    if (!this.allow(key)) return null;
    try {
      const context = await this.contextOf(configurationId);
      if (context === null) return null;
      const provider = context.provider;
      const adapter = this.adapters.forProvider(provider);
      if (adapter.resolvePaymentReference === undefined) return null;
      const secrets = await this.secrets.get({
        provider,
        configurationId,
        holderPartyId: context.holder_party_id,
        secretRef: context.secret_ref,
      });
      const resolved = await adapter.resolvePaymentReference(
        notification.payment.providerPaymentRef,
        secrets,
      );
      if (resolved === null) return null;
      return {
        ...notification,
        payment: {
          ...notification.payment,
          merchantReference: resolved.merchantReference,
          providerPaymentRef: resolved.providerPaymentRef,
        },
      };
    } catch (error) {
      this.lastRun.delete(key);
      logPspAlert(this.log, {
        event: 'psp.dispute.confirm_failed',
        severity: 'ERROR',
        reason: errorReason(error),
        psp_config_id: configurationId,
      });
      return null;
    }
  }

  private unmatched(configurationId: string): void {
    // Jamais la référence reçue en entier : elle vient d'un tiers.
    logPspAlert(this.log, {
      event: 'psp.signal.unmatched',
      severity: 'WARN',
      reason: 'NO_PENDING_TOPUP',
      psp_config_id: configurationId,
    });
  }

  /** Vrai (et date la relecture) si aucune n'a eu lieu pour cette recharge depuis moins d'une minute. */
  private allow(topupId: string): boolean {
    const now = Date.now();
    const last = this.lastRun.get(topupId);
    if (last !== undefined && now - last < CONFIRM_MIN_INTERVAL_MS) return false;
    this.lastRun.delete(topupId);
    this.lastRun.set(topupId, now);
    while (this.lastRun.size > CONFIRM_MEMORY_MAX) {
      const oldest = this.lastRun.keys().next();
      if (oldest.done === true) break;
      this.lastRun.delete(oldest.value);
    }
    return true;
  }

  private settle(topup: ConfirmableTopup, verdict: 'FAILED' | 'EXPIRED'): Promise<PaymentOutcome> {
    return this.tx.run(topup.operatorId, (client) =>
      this.processor.settleUnpaid(client, {
        configurationId: topup.pspConfigurationId,
        topupId: topup.pspTopupId,
        verdict,
        observedAt: new Date(),
      }),
    );
  }

  private contextOf(configurationId: string): Promise<WebhookContext | null> {
    return this.tx.withoutTenant(async (client) => {
      const { rows } = await client.query<WebhookContext>(
        'SELECT operator_id, provider, holder_party_id, secret_ref FROM psp_webhook_context($1)',
        [configurationId],
      );
      return rows[0] ?? null;
    });
  }

  /** Secrets du coffre, par la référence de la configuration (lecture neutre, jamais journalisée). */
  private async secretsOf(topup: ConfirmableTopup): Promise<PspSecrets> {
    const context = await this.contextOf(topup.pspConfigurationId);
    if (context === null) throw new Error('configuration PSP introuvable');
    return this.secrets.get({
      provider: topup.provider,
      configurationId: topup.pspConfigurationId,
      holderPartyId: context.holder_party_id,
      secretRef: context.secret_ref,
    });
  }
}

function settledByPayment(outcome: PaymentOutcome, state: 'PAID' | 'CANCELLED'): boolean {
  return (
    outcome.disposition === 'PROCESSED' &&
    (state === 'CANCELLED' || outcome.outcome !== 'NO_EFFECT')
  );
}
