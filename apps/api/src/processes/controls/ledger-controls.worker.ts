// Contrôles permanents des grands livres (mission 9b, WP12 ; FR-021, §12.2, R-12). Deux horloges internes :
// `FAST` toutes les 5 minutes (somme nulle, droits = argent), `SLOW` toutes les heures (cache de soldes, comptes
// chauds du bon côté), sur les grands livres `OPEN` et `CLOSING` (filtre de `ops_ledger_controls`). Les écarts de
// l'horloge lente restent connus entre deux passages (alarme et déduplication stables). Alarme 9.
import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { TenantTx } from '../../db/tenant-tx';
import { ALARM_LEDGER_CONTROLS, type AlertItem } from '../ops-alerts';
import { WorkerRegistry } from '../worker';
import { CheckWorker } from './check-worker';

export const LEDGER_FAST_INTERVAL_MS = 300_000;
export const LEDGER_SLOW_INTERVAL_MS = 3_600_000;

interface ControlRow {
  ledger_id: string;
  operator_id: string;
  control: string;
  detail_count: bigint | number | string;
}

@Injectable()
export class LedgerControlsWorker extends CheckWorker {
  readonly name = 'ledger-controls';
  protected readonly code = ALARM_LEDGER_CONTROLS;
  protected readonly intervalMs = LEDGER_FAST_INTERVAL_MS;
  private nextSlowAt = 0;
  private slowItems: AlertItem[] = [];

  constructor(registry: WorkerRegistry, tx: TenantTx, moduleRef: ModuleRef) {
    super(registry, tx, moduleRef);
  }

  protected async collect(now: number): Promise<AlertItem[]> {
    const fast = await this.scope('FAST');
    if (now >= this.nextSlowAt) {
      this.slowItems = await this.scope('SLOW');
      this.nextSlowAt = now + LEDGER_SLOW_INTERVAL_MS;
    }
    return [...fast, ...this.slowItems];
  }

  private async scope(scope: 'FAST' | 'SLOW'): Promise<AlertItem[]> {
    const rows = await this.tx.withoutTenant(async (client) => {
      const { rows: found } = await client.query<ControlRow>(
        'SELECT ledger_id, operator_id, control, detail_count FROM ops_ledger_controls($1)',
        [scope],
      );
      return found;
    });
    return rows.map((row) => ({
      key: `${row.ledger_id}:${row.control}`,
      detail: {
        worker: this.name,
        control: row.control,
        ledger_id: row.ledger_id,
        operator_id: row.operator_id,
        detail_count: Number(row.detail_count),
      },
    }));
  }

  describe(): Promise<string[]> {
    return Promise.resolve([
      `${this.name} : somme nulle et droits = argent toutes les ${LEDGER_FAST_INTERVAL_MS / 60_000} min, ` +
        `cache de soldes et comptes chauds toutes les ${LEDGER_SLOW_INTERVAL_MS / 3_600_000} h ` +
        '(grands livres OPEN et CLOSING)',
    ]);
  }
}
