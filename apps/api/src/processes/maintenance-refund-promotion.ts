// Promotion des demandes de remboursement échues (mission 9a, WP03 ; FR-013). Travailleur du processus `maintenance`
// (rôle `cashless_maint`) : appelle `promote_due_refund_requests()`, qui passe `AWAITING_HOLDER` à `REQUESTED` quand
// `hold_until` est échu, à l'horloge de la base, sans décision du titulaire. Idempotent ; ne lit ni n'écrit aucune
// table directement.
import { Injectable, Module } from '@nestjs/common';
import { TenantTx } from '../db/tenant-tx';
import { WorkerRegistry, type ProcessWorker } from './worker';

export const REFUND_PROMOTION_INTERVAL_MS = 60_000;

@Injectable()
export class RefundPromotionWorker implements ProcessWorker {
  readonly name = 'refund-promotion';
  private nextRunAt = 0;

  constructor(
    registry: WorkerRegistry,
    private readonly tx: TenantTx,
  ) {
    registry.register(this);
  }

  /** Rend le nombre de demandes promues ; rien avant la fin de l'intervalle. */
  async runOnce(now: number = Date.now()): Promise<number> {
    if (now < this.nextRunAt) return 0;
    this.nextRunAt = now + REFUND_PROMOTION_INTERVAL_MS;
    return this.tx.withoutTenant(async (client) => {
      const { rows } = await client.query<{ n: number }>(
        'SELECT promote_due_refund_requests() AS n',
      );
      return Number(rows[0]!.n);
    });
  }

  alarm(): number {
    return 0;
  }

  describe(): Promise<string[]> {
    return Promise.resolve([
      `${this.name} : demandes de remboursement AWAITING_HOLDER échues passées à REQUESTED, ` +
        `toutes les ${REFUND_PROMOTION_INTERVAL_MS / 1000} s`,
    ]);
  }
}

@Module({ providers: [RefundPromotionWorker] })
export class RefundPromotionMaintenanceModule {}
