// Passerelle muette (WP12, T055 ; FR-005, R-15). Travailleur du processus `maintenance` (rôle `cashless_maint`) : appelle
// `mark_edge_gateways_silent(seuil)`, qui fait passer `ACTIVE` à `ISOLATED` toute passerelle sans signe de vie depuis le
// seuil (audit, et alerte `EDGE_SILENT` si un handover est ouvert), puis remet `ACTIVE` celles qui reparlent. La
// fonction fait tout, déduplique (une passerelle `ISOLATED` n'est plus relue) et ne touche jamais une passerelle
// `REVOKED` : ce travailleur ne lit ni n'écrit aucune table. Code d'alerte non nul tant que le dernier passage a changé
// l'état d'une passerelle (comme `poller-alarms.ts`).
import { Injectable, Logger } from '@nestjs/common';
import { TenantTx } from '../../db/tenant-tx';
import { WorkerRegistry, type ProcessWorker } from '../../processes/worker';

/** Silence au-delà duquel une passerelle `ACTIVE` devient `ISOLATED` (constante, pas de clé de configuration). */
export const EDGE_SILENCE_THRESHOLD = '60 seconds';
/** Intervalle entre deux passages. */
export const EDGE_SILENCE_INTERVAL_MS = 15_000;
/** Code d'alerte : une passerelle a changé d'état de lien au dernier passage. */
export const ALARM_EDGE_SILENT = 5;

@Injectable()
export class EdgeSilenceWorker implements ProcessWorker {
  readonly name = 'edge-silence';
  private readonly log = new Logger(EdgeSilenceWorker.name);
  private nextRunAt = 0;
  private alarmCode = 0;

  constructor(
    registry: WorkerRegistry,
    private readonly tx: TenantTx,
  ) {
    registry.register(this);
  }

  /** Rend le nombre de passages d'état (dans les deux sens) ; rien avant la fin de l'intervalle. */
  async runOnce(now: number = Date.now()): Promise<number> {
    if (now < this.nextRunAt) return 0;
    this.nextRunAt = now + EDGE_SILENCE_INTERVAL_MS;
    const changed = await this.tx.withoutTenant(async (client) => {
      const { rows } = await client.query<{ n: number }>(
        'SELECT mark_edge_gateways_silent($1::interval) AS n',
        [EDGE_SILENCE_THRESHOLD],
      );
      return Number(rows[0]!.n);
    });
    this.alarmCode = changed > 0 ? ALARM_EDGE_SILENT : 0;
    if (changed > 0)
      this.log.warn(JSON.stringify({ event: 'edge.silence.changed', gateways: changed }));
    return changed;
  }

  alarm(): number {
    return this.alarmCode;
  }

  describe(): Promise<string[]> {
    return Promise.resolve([
      `${this.name} : passerelles ACTIVE muettes depuis plus de ${EDGE_SILENCE_THRESHOLD} (ISOLATED), ` +
        `toutes les ${EDGE_SILENCE_INTERVAL_MS / 1000} s`,
    ]);
  }
}
