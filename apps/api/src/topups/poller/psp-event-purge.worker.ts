// Purge des corps bruts des notifications (mission 6, lot WP12, T063 ; A24) : le corps (octets, données du payeur)
// des événements de plus de 400 jours est vidé par la fonction de la base, les métadonnées sont gardées. Au plus un
// passage par `PSP_PURGE_INTERVAL_SECONDS` (60 à 86 400, 3 600 par défaut ; valeur invalide : démarrage refusé).
// Fonction neutre (sans prestataire de session) : `TenantTx.withoutTenant`, rôle `cashless_app`.
import { Injectable, Logger } from '@nestjs/common';
import { TenantTx } from '../../db/tenant-tx';
import { WorkerRegistry, type ProcessWorker } from '../../processes/worker';
import { errorReason, logPspAlert } from '../../webhooks/psp-alert-log';
import { ALARM_PURGE_FAILED } from './poller-alarms';

/** Âge (jours) au-delà duquel un corps brut est vidé. */
export const PSP_EVENT_BODY_RETENTION_DAYS = 400;
const INTERVAL = { min: 60, max: 86_400, fallback: 3600 };

/** `PSP_PURGE_INTERVAL_SECONDS` : entier de 60 à 86 400, 3 600 par défaut. */
export function pspPurgeIntervalSeconds(raw: string | undefined): number {
  if (raw === undefined || raw === '') return INTERVAL.fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < INTERVAL.min || parsed > INTERVAL.max)
    throw new Error(
      `PSP_PURGE_INTERVAL_SECONDS : entier de ${INTERVAL.min} à ${INTERVAL.max} attendu ` +
        `(reçu « ${raw} »)`,
    );
  return parsed;
}

@Injectable()
export class PspEventPurgeWorker implements ProcessWorker {
  readonly name = 'psp-event-purge';
  readonly intervalSeconds = pspPurgeIntervalSeconds(process.env.PSP_PURGE_INTERVAL_SECONDS);
  private readonly log = new Logger(PspEventPurgeWorker.name);
  private nextRunAt = 0;
  private alarmCode = 0;

  constructor(
    registry: WorkerRegistry,
    private readonly tx: TenantTx,
  ) {
    registry.register(this);
  }

  /** Un passage si l'intervalle est écoulé ; rend le nombre de corps vidés. Une panne fixe le code 4. */
  async runOnce(now: number = Date.now()): Promise<number> {
    if (now < this.nextRunAt) return 0;
    this.nextRunAt = now + this.intervalSeconds * 1000;
    try {
      const purged = await this.tx.withoutTenant(async (client) => {
        const { rows } = await client.query<{ n: string }>(
          'SELECT purge_psp_event_bodies($1)::text AS n',
          [PSP_EVENT_BODY_RETENTION_DAYS],
        );
        return Number(rows[0]!.n);
      });
      return purged;
    } catch (error) {
      this.alarmCode = ALARM_PURGE_FAILED;
      logPspAlert(this.log, {
        event: 'psp.purge.failed',
        severity: 'ERROR',
        reason: errorReason(error),
      });
      return 0;
    }
  }

  alarm(): number {
    return this.alarmCode;
  }

  describe(): Promise<string[]> {
    return Promise.resolve([
      `${this.name} : corps bruts des notifications de plus de ${PSP_EVENT_BODY_RETENTION_DAYS} ` +
        `jours, toutes les ${this.intervalSeconds} s`,
    ]);
  }
}
