// Versements en retard (mission 9b, WP12 ; FR-021, §12.2) : `INITIATED` depuis plus de 48 heures, une fois par jour
// (`ops_overdue_payouts`, heure de la base). Une alerte par versement (identifiants et date, jamais de montant ni de
// coordonnées bancaires). Alarme 10.
import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { TenantTx } from '../../db/tenant-tx';
import { ALARM_OPS_CONTROLS, type AlertItem } from '../ops-alerts';
import { WorkerRegistry } from '../worker';
import { CheckWorker } from './check-worker';

export const PAYOUT_OVERDUE_AGE = '48 hours';
export const PAYOUT_OVERDUE_INTERVAL_MS = 86_400_000;

@Injectable()
export class PayoutOverdueWorker extends CheckWorker {
  readonly name = 'payout-overdue';
  protected readonly code = ALARM_OPS_CONTROLS;
  protected readonly intervalMs = PAYOUT_OVERDUE_INTERVAL_MS;

  constructor(registry: WorkerRegistry, tx: TenantTx, moduleRef: ModuleRef) {
    super(registry, tx, moduleRef);
  }

  protected async collect(): Promise<AlertItem[]> {
    const rows = await this.tx.withoutTenant(async (client) => {
      const { rows: found } = await client.query<{
        payout_id: string;
        ledger_id: string;
        operator_id: string;
        initiated_at: Date;
      }>(
        'SELECT payout_id, ledger_id, operator_id, initiated_at FROM ops_overdue_payouts($1::interval)',
        [PAYOUT_OVERDUE_AGE],
      );
      return found;
    });
    return rows.map((row) => ({
      key: row.payout_id,
      detail: {
        worker: this.name,
        payout_id: row.payout_id,
        ledger_id: row.ledger_id,
        operator_id: row.operator_id,
        initiated_at: row.initiated_at.toISOString(),
      },
    }));
  }

  describe(): Promise<string[]> {
    return Promise.resolve([
      `${this.name} : versements INITIATED depuis plus de ${PAYOUT_OVERDUE_AGE}, une fois par jour`,
    ]);
  }
}
