// Relevés non rapprochés (mission 9b, WP12 ; FR-021, §12.2) : lignes de relevé sans transaction ni anomalie, plus
// vieilles que 24 heures, une fois par jour (`ops_unmatched_statements`). Une alerte par compte (identifiants, nombre
// de lignes, date la plus ancienne : jamais de libellé, de montant ni de numéro). Alarme 10.
import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { TenantTx } from '../../db/tenant-tx';
import { ALARM_OPS_CONTROLS, type AlertItem } from '../ops-alerts';
import { WorkerRegistry } from '../worker';
import { CheckWorker } from './check-worker';

export const STATEMENT_UNMATCHED_AGE = '24 hours';
export const STATEMENT_UNMATCHED_INTERVAL_MS = 86_400_000;

@Injectable()
export class StatementUnmatchedWorker extends CheckWorker {
  readonly name = 'statement-unmatched';
  protected readonly code = ALARM_OPS_CONTROLS;
  protected readonly intervalMs = STATEMENT_UNMATCHED_INTERVAL_MS;

  constructor(registry: WorkerRegistry, tx: TenantTx, moduleRef: ModuleRef) {
    super(registry, tx, moduleRef);
  }

  protected async collect(): Promise<AlertItem[]> {
    const rows = await this.tx.withoutTenant(async (client) => {
      const { rows: found } = await client.query<{
        account_id: string;
        ledger_id: string;
        operator_id: string;
        unmatched: bigint | number | string;
        oldest: Date;
      }>(
        'SELECT account_id, ledger_id, operator_id, unmatched, oldest FROM ops_unmatched_statements($1::interval)',
        [STATEMENT_UNMATCHED_AGE],
      );
      return found;
    });
    return rows.map((row) => ({
      key: row.account_id,
      detail: {
        worker: this.name,
        account_id: row.account_id,
        ledger_id: row.ledger_id,
        operator_id: row.operator_id,
        unmatched: Number(row.unmatched),
        oldest: row.oldest.toISOString(),
      },
    }));
  }

  describe(): Promise<string[]> {
    return Promise.resolve([
      `${this.name} : lignes de relevé non rapprochées depuis plus de ${STATEMENT_UNMATCHED_AGE}, ` +
        'une fois par jour',
    ]);
  }
}
