// Anomalies ouvertes (mission 9b, WP12 ; FR-021, §12.2) : contrôle continu, toutes les 5 minutes, alerte sur une
// anomalie NOUVELLE seulement (`ops_new_open_anomalies`) : une anomalie déjà signalée ne relève pas l'alerte au
// passage suivant. La mémoire des anomalies vues est celle du processus : après un redémarrage, les anomalies encore
// ouvertes sont signalées une fois de plus (on sur-alerte plutôt que de taire). Le code d'alarme (10) vaut pour le
// passage qui a trouvé une anomalie nouvelle, puis redescend à 0.
import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { TenantTx } from '../../db/tenant-tx';
import { ALARM_OPS_CONTROLS, type AlertItem } from '../ops-alerts';
import { WorkerRegistry } from '../worker';
import { CheckWorker } from './check-worker';

export const OPEN_ANOMALIES_INTERVAL_MS = 300_000;
/** Recul sur la date de création de la dernière anomalie vue (les écritures concurrentes ne sont jamais ratées). */
const SINCE_MARGIN_MS = 60_000;

@Injectable()
export class OpenAnomaliesWorker extends CheckWorker {
  readonly name = 'open-anomalies';
  protected readonly code = ALARM_OPS_CONTROLS;
  protected readonly intervalMs = OPEN_ANOMALIES_INTERVAL_MS;
  private readonly seen = new Set<string>();
  private since: Date | null = null;

  constructor(registry: WorkerRegistry, tx: TenantTx, moduleRef: ModuleRef) {
    super(registry, tx, moduleRef);
  }

  protected async collect(): Promise<AlertItem[]> {
    const rows = await this.tx.withoutTenant(async (client) => {
      const { rows: found } = await client.query<{
        anomaly_id: string;
        operator_id: string;
        ledger_id: string;
        kind: string;
        created_at: Date;
      }>(
        'SELECT anomaly_id, operator_id, ledger_id, kind, created_at FROM ops_new_open_anomalies($1::timestamptz)',
        [this.since === null ? '-infinity' : this.since.toISOString()],
      );
      return found;
    });
    const fresh = rows.filter((row) => !this.seen.has(row.anomaly_id));
    for (const row of rows) {
      this.seen.add(row.anomaly_id);
      const from = new Date(row.created_at.getTime() - SINCE_MARGIN_MS);
      if (this.since === null || from > this.since) this.since = from;
    }
    return fresh.map((row) => ({
      key: row.anomaly_id,
      detail: {
        worker: this.name,
        anomaly_id: row.anomaly_id,
        operator_id: row.operator_id,
        ledger_id: row.ledger_id,
        kind: row.kind,
        created_at: row.created_at.toISOString(),
      },
    }));
  }

  describe(): Promise<string[]> {
    return Promise.resolve([
      `${this.name} : anomalies OPEN nouvelles, toutes les ${OPEN_ANOMALIES_INTERVAL_MS / 60_000} min ` +
        '(alerte sur une anomalie nouvelle seulement)',
    ]);
  }
}
