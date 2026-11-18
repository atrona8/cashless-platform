// Scellement des grands livres (mission 9b, WP12 ; FR-020, NFR-005, R-11). Travailleur du processus `maintenance`
// (rôle `cashless_maint`, aucune lecture de table). Toutes les 5 minutes : liste (`ops_ledgers_to_seal`, tous statuts,
// `LOCKED` compris), scelle (`ops_seal_ledger`, une transaction par grand livre), copie à l'extérieur, puis pose la
// référence (`ops_record_seal_copy`, une fois). Ordre : sceller, copier, enregistrer. Une copie qui échoue ne bloque
// pas le scellement suivant ; elle est reprise au passage d'après (`ops_seals_since`). Échec : alarme 7 et alerte.
// La copie est SIMULÉE jusqu'à la mission 12b (décision du porteur, C-006).
import { Inject, Injectable, Logger } from '@nestjs/common';
import { TenantTx } from '../db/tenant-tx';
import { ALARM_SEAL_FAILED, errorCode, OpsAlerts, type AlertItem } from '../processes/ops-alerts';
import { WorkerRegistry, type ProcessWorker } from '../processes/worker';
import { SEAL_COPY } from '../security/port-tokens';
import type { SealExternalCopy } from './seal-copy';
import { copyMissing, SEAL_INTERVAL_MS } from './seal-common';

@Injectable()
export class LedgerSealWorker implements ProcessWorker {
  readonly name = 'ledger-seal';
  private readonly log = new Logger(LedgerSealWorker.name);
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
      const ledgers = await this.tx.withoutTenant(async (client) => {
        const { rows } = await client.query<{ ledger_id: string }>(
          'SELECT ledger_id FROM ops_ledgers_to_seal()',
        );
        return rows.map((row) => row.ledger_id);
      });
      for (const ledger of ledgers) {
        try {
          const { rowCount } = await this.tx.withoutTenant((client) =>
            client.query('SELECT seal_no, seal_hash FROM ops_seal_ledger($1::uuid)', [ledger]),
          );
          sealed += rowCount ?? 0;
        } catch (error) {
          failures.push({
            key: `seal:${ledger}`,
            detail: { worker: this.name, step: 'seal', ledger_id: ledger, error: errorCode(error) },
          });
        }
      }
      const copied = await copyMissing('LEDGER', this.tx, this.copy, this.name, this.log);
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
      `${this.name} : grands livres scellés (tous statuts) puis copiés, toutes les ` +
        `${SEAL_INTERVAL_MS / 60_000} min ; copie externe ${this.copy.isFake ? 'SIMULÉE' : 'réelle'}`,
    ]);
  }
}
