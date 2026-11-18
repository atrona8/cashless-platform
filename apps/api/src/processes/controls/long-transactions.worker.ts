// Transactions longues (mission 9b, WP12 ; FR-023, C-011, R-13) : toutes les 10 secondes,
// `ops_long_transactions('60 seconds')`. Journal et alerte (code 11) avec `pid`, `usename`, `application_name` et la
// durée, JAMAIS le texte de la requête (la fonction ne le rend pas ; ce fichier ne lit pas non plus la colonne). Aucun
// arrêt de session : `transaction_timeout = 60 s` du rôle applicatif coupe déjà ; ce travailleur est un filet de
// détection. Si la base ne permet pas de lire la durée des autres sessions (propriétaire de la fonction hors
// `pg_read_all_stats`), la fonction le dit par une ligne de configuration, transformée ici en alerte plutôt qu'en
// liste vide silencieuse. Enregistré EN PREMIER dans le processus (cadence de 10 s dans une boucle de 5 s).
import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { TenantTx } from '../../db/tenant-tx';
import { ALARM_LONG_TRANSACTION, errorCode, type AlertItem } from '../ops-alerts';
import { WorkerRegistry } from '../worker';
import { CheckWorker } from './check-worker';

export const LONG_TRANSACTION_THRESHOLD = '60 seconds';
export const LONG_TRANSACTION_INTERVAL_MS = 10_000;

@Injectable()
export class LongTransactionsWorker extends CheckWorker {
  readonly name = 'long-transactions';
  protected readonly code = ALARM_LONG_TRANSACTION;
  protected readonly intervalMs = LONG_TRANSACTION_INTERVAL_MS;
  private threshold = LONG_TRANSACTION_THRESHOLD;

  constructor(registry: WorkerRegistry, tx: TenantTx, moduleRef: ModuleRef) {
    super(registry, tx, moduleRef);
  }

  /** Seuil de détection (tests seulement : la valeur de production est `LONG_TRANSACTION_THRESHOLD`). */
  useThreshold(interval: string): void {
    this.threshold = interval;
  }

  protected async collect(): Promise<AlertItem[]> {
    let rows: Array<{
      pid: number | null;
      usename: string;
      application_name: string;
      xact_seconds: string;
    }>;
    try {
      rows = await this.tx.withoutTenant(async (client) => {
        const { rows: found } = await client.query<(typeof rows)[number]>(
          'SELECT pid, usename, application_name, xact_seconds FROM ops_long_transactions($1::interval)',
          [this.threshold],
        );
        return found;
      });
    } catch (error) {
      return [{ key: 'run', detail: { worker: this.name, check: 'run', error: errorCode(error) } }];
    }
    return rows.map((row) =>
      row.pid === null
        ? {
            key: 'config',
            detail: { worker: this.name, check: 'config', missing: row.application_name },
          }
        : {
            key: String(row.pid),
            detail: {
              worker: this.name,
              pid: row.pid,
              usename: row.usename,
              application_name: row.application_name,
              xact_seconds: Number(row.xact_seconds),
            },
          },
    );
  }

  describe(): Promise<string[]> {
    return Promise.resolve([
      `${this.name} : transactions ouvertes depuis plus de ${this.threshold} (pid, rôle, application, ` +
        `durée ; jamais la requête), toutes les ${LONG_TRANSACTION_INTERVAL_MS / 1000} s`,
    ]);
  }
}
