// Socle des contrôles permanents (mission 9b, WP12 ; FR-021, SPECIFICATION §12.2) : un travailleur par contrôle, qui
// appelle une fonction `ops_*` ne rendant que les écarts (aucune lecture de table), lève une alerte par écart (sans
// répétition à chaque passage, `OpsAlerts.sync`) et garde son code d'alarme tant qu'un écart subsiste ; il redescend à
// 0 quand le contrôle repasse. Un contrôle qui ÉCHOUE (base injoignable, fonction refusée) est lui-même un écart : il
// n'est jamais silencieux. `runOnce` rend le nombre d'écarts observés (0 : rien, ou avant l'échéance).
import type { ModuleRef } from '@nestjs/core';
import type { TenantTx } from '../../db/tenant-tx';
import { errorCode, OpsAlerts, type AlertItem } from '../ops-alerts';
import type { ProcessWorker, WorkerRegistry } from '../worker';

export abstract class CheckWorker implements ProcessWorker {
  abstract readonly name: string;
  protected abstract readonly code: number;
  protected abstract readonly intervalMs: number;
  protected nextRunAt = 0;
  private alarmCode = 0;

  constructor(
    registry: WorkerRegistry,
    protected readonly tx: TenantTx,
    private readonly moduleRef: ModuleRef,
  ) {
    registry.register(this);
  }

  /**
   * Résolu à l'usage, pas à la construction : un travailleur ne dépend que du registre et de la base pour
   * s'enregistrer, donc `long-transactions` passe en tête de la boucle (le fournisseur d'alertes se construit après).
   */
  protected get alerts(): OpsAlerts {
    return this.moduleRef.get(OpsAlerts, { strict: false });
  }

  /** Écarts du contrôle à l'instant `now`, au format des alertes (clé stable, détail sans donnée sensible). */
  protected abstract collect(now: number): Promise<AlertItem[]>;

  abstract describe(): Promise<string[]>;

  async runOnce(now: number = Date.now()): Promise<number> {
    if (now < this.nextRunAt) return 0;
    this.nextRunAt = now + this.intervalMs;
    let items: AlertItem[];
    try {
      items = await this.collect(now);
    } catch (error) {
      items = [
        { key: 'run', detail: { worker: this.name, check: 'run', error: errorCode(error) } },
      ];
    }
    this.alarmCode = items.length > 0 ? this.code : 0;
    await this.alerts.sync(this.name, this.code, items, now);
    return items.length;
  }

  alarm(): number {
    return this.alarmCode;
  }
}
