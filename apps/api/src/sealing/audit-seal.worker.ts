// Scellement des chaînes du journal d'audit, plateforme comprise (mission 9b, WP12 ; FR-020, NFR-005, R-11). Même
// cycle que `ledger-seal.worker.ts` : `ops_audit_chains_to_seal`, `ops_seal_audit` (une transaction par chaîne),
// copie externe SIMULÉE jusqu'à la mission 12b, puis `ops_record_seal_copy` une fois. Échec : alarme 7 et alerte.
import { Inject, Injectable, Logger } from '@nestjs/common';
import { TenantTx } from '../db/tenant-tx';
import { ALARM_SEAL_FAILED, errorCode, OpsAlerts, type AlertItem } from '../processes/ops-alerts';
import { WorkerRegistry, type ProcessWorker } from '../processes/worker';
import { SEAL_COPY } from '../security/port-tokens';
import type { SealExternalCopy } from './seal-copy';
import { copyMissing, SEAL_INTERVAL_MS } from './seal-common';

@Injectable()
export class AuditSealWorker implements ProcessWorker {
  readonly name = 'audit-seal';
  private readonly log = new Logger(AuditSealWorker.name);
  private nextRunAt = 0;
  private alarmCode = 0;

  constructor(
    registry: WorkerRegistry,
    private readonly tx: TenantTx,
    private readonly alerts: OpsAlerts,
    @Inject(SEAL_COPY) private readonly copy: SealExternalCopy,
  ) {
    registry.register(this);
  }

  /** Rend le nombre de scellements écrits plus les copies posées ; 0 s'il n'y avait rien ou avant l'échéance. */
  async runOnce(now: number = Date.now()): Promise<number> {
    if (now < this.nextRunAt) return 0;
    this.nextRunAt = now + SEAL_INTERVAL_MS;
    const failures: AlertItem[] = [];
    let sealed = 0;
    try {
      const chains = await this.tx.withoutTenant(async (client) => {
        const { rows } = await client.query<{ chain_key: string }>(
          'SELECT chain_key FROM ops_audit_chains_to_seal()',
        );
        return rows.map((row) => row.chain_key);
      });
      for (const chain of chains) {
        try {
          const { rowCount } = await this.tx.withoutTenant((client) =>
            client.query('SELECT seal_no, seal_hash FROM ops_seal_audit($1::uuid)', [chain]),
          );
          sealed += rowCount ?? 0;
        } catch (error) {
          failures.push({
            key: `seal:${chain}`,
            detail: { worker: this.name, step: 'seal', chain_key: chain, error: errorCode(error) },
          });
        }
      }
      const copied = await copyMissing('AUDIT', this.tx, this.copy, this.name, this.log);
      failures.push(...copied.failures);
      sealed += copied.copied;
    } catch (error) {
      failures.push({
        key: 'run',
        detail: { worker: this.name, step: 'run', error: errorCode(error) },
      });
    }
    this.alarmCode = failures.length > 0 ? ALARM_SEAL_FAILED : 0;
    await this.alerts.sync(this.name, ALARM_SEAL_FAILED, failures, now);
    return sealed;
  }

  alarm(): number {
    return this.alarmCode;
  }

  describe(): Promise<string[]> {
    return Promise.resolve([
      `${this.name} : chaînes d'audit scellées (plateforme comprise) puis copiées, toutes les ` +
        `${SEAL_INTERVAL_MS / 60_000} min ; copie externe ${this.copy.isFake ? 'SIMULÉE' : 'réelle'}`,
    ]);
  }
}
