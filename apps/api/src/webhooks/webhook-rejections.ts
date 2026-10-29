// Refus de notification (mission 6, lot WP12, T060 point 5 ; NFR-002, A22). Un refus n'écrit AUCUNE ligne au grand
// livre ni au registre brut : seulement (a) le compteur durable `psp_webhook_rejection` (sans corps), (b) un journal
// de sécurité `psp.webhook.rejected` (empreinte SHA-256 du corps, jamais le corps) et (c) une alerte d'exploitation
// bornée. `record` ne lève jamais : un compteur en panne ne doit pas ouvrir la route.
import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { TenantTx } from '../db/tenant-tx';
import { errorReason, logPspAlert } from './psp-alert-log';

export const WEBHOOK_REJECTION_REASONS = [
  'BODY_TOO_LARGE',
  'UNKNOWN_CONFIG',
  'CONFIG_NOT_ACTIVE',
  'PROVIDER_MISMATCH',
  'SECRET_UNAVAILABLE',
  'SIGNATURE_MISSING',
  'SIGNATURE_MALFORMED',
  'SIGNATURE_INVALID',
  'TIMESTAMP_OUT_OF_TOLERANCE',
  'BODY_MALFORMED',
] as const;
export type WebhookRejectionReason = (typeof WEBHOOK_REJECTION_REASONS)[number];

/** Seuil par minute et par (motif, configuration) qui déclenche l'alerte (avec la première occurrence). */
export const WEBHOOK_ALERT_THRESHOLD = 100;
/** Bornes de la mémoire du limiteur (un attaquant choisit les identifiants de configuration). */
const MAX_TRACKED = 10_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface RejectionContext {
  provider: string;
  /** Identifiant de configuration tel que reçu dans l'URL. */
  configId: string;
  size: number;
  rawBody: Buffer;
  ip: string | undefined;
}

@Injectable()
export class WebhookRejections {
  private readonly log = new Logger('PspWebhook');
  private minute = -1;
  private readonly seen = new Map<string, number>();
  private readonly alerted = new Set<string>();

  constructor(private readonly tx: TenantTx) {}

  async record(reason: WebhookRejectionReason, ctx: RejectionContext): Promise<void> {
    const configId = UUID.test(ctx.configId) ? ctx.configId.toLowerCase() : null;
    try {
      await this.tx.withoutTenant((client) =>
        client.query('SELECT record_webhook_rejection($1, $2)', [configId, reason]),
      );
    } catch (error) {
      this.log.error(
        JSON.stringify({
          event: 'psp.webhook.counter_failed',
          severity: 'ERROR',
          reason: errorReason(error),
          rejection: reason,
        }),
      );
    }
    try {
      // Journal d'abord : l'empreinte du corps, jamais le corps.
      logPspAlert(this.log, {
        event: 'psp.webhook.rejected',
        severity: 'WARN',
        reason,
        provider: ctx.provider.slice(0, 40),
        psp_config_id: ctx.configId.slice(0, 64),
        size: ctx.size,
        body_sha256: createHash('sha256').update(ctx.rawBody).digest('hex'),
        ip: ctx.ip ?? null,
      });
      this.alert(reason, ctx);
    } catch (error) {
      // Un journal en panne ne change pas la réponse.
      process.stderr.write(`psp.webhook.log_failed ${errorReason(error)}\n`);
    }
  }

  /** Au plus une alerte par minute et par motif ; première occurrence du couple ou seuil atteint. */
  private alert(reason: WebhookRejectionReason, ctx: RejectionContext): void {
    const minute = Math.floor(Date.now() / 60_000);
    if (minute !== this.minute) {
      this.minute = minute;
      this.seen.clear();
      this.alerted.clear();
    }
    const pair = `${reason}|${ctx.configId.slice(0, 64)}`;
    if (!this.seen.has(pair) && this.seen.size >= MAX_TRACKED) return;
    const count = (this.seen.get(pair) ?? 0) + 1;
    this.seen.set(pair, count);
    if (count !== 1 && count !== WEBHOOK_ALERT_THRESHOLD) return;
    if (this.alerted.has(reason)) return;
    this.alerted.add(reason);
    logPspAlert(this.log, {
      event: 'psp.webhook.alert',
      severity: 'ERROR',
      reason,
      psp_config_id: ctx.configId.slice(0, 64),
      count,
    });
  }
}
