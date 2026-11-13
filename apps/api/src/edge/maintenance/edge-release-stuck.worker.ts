// Rendu bloqué (WP12, T055 ; R-30). Travailleur du processus `maintenance` (rôle `cashless_maint`) : lit
// `edge_stuck_handovers(10 minutes)` (handovers `TO_CENTRAL` en `RELEASING` depuis plus de 10 minutes, tous
// prestataires) et lève l'alerte `EDGE_RELEASE_STUCK` : une ligne de journal (identifiants, jamais d'empreinte), une
// seule fois par handover tant que le processus tourne, ET une entrée `audit_log` par `edge_log_release_stuck`
// (migration 0065, décision 37, ADR-173 : fonction SECURITY DEFINER, seule voie d'écriture d'audit de `cashless_maint`,
// idempotente, qui refuse un rendu non bloqué). Une panne de l'écriture d'audit est journalisée et reprise au passage
// suivant (la ligne d'alerte, elle, ne part qu'une fois). Code d'alerte non nul tant qu'un rendu bloqué est connu.
import { Injectable, Logger } from '@nestjs/common';
import { TenantTx } from '../../db/tenant-tx';
import { WorkerRegistry, type ProcessWorker } from '../../processes/worker';

/** Durée en `RELEASING` au-delà de laquelle un rendu est dit bloqué. */
export const EDGE_RELEASE_STUCK_AFTER = '10 minutes';
export const EDGE_RELEASE_STUCK_INTERVAL_MS = 30_000;
/** Code d'alerte : au moins un rendu bloqué. */
export const ALARM_EDGE_RELEASE_STUCK = 6;

interface StuckRow {
  id: string;
  edge_gateway_id: string;
  ledger_id: string;
}

@Injectable()
export class EdgeReleaseStuckWorker implements ProcessWorker {
  readonly name = 'edge-release-stuck';
  private readonly log = new Logger(EdgeReleaseStuckWorker.name);
  private readonly alerted = new Set<string>();
  private readonly audited = new Set<string>();
  private nextRunAt = 0;
  private alarmCode = 0;

  constructor(
    registry: WorkerRegistry,
    private readonly tx: TenantTx,
  ) {
    registry.register(this);
  }

  /** Rend le nombre de rendus bloqués NOUVELLEMENT alertés (0 : rien de neuf, le registre cesse de repasser). */
  async runOnce(now: number = Date.now()): Promise<number> {
    if (now < this.nextRunAt) return 0;
    this.nextRunAt = now + EDGE_RELEASE_STUCK_INTERVAL_MS;
    const stuck = await this.tx.withoutTenant(async (client) => {
      const { rows } = await client.query<StuckRow>(
        'SELECT id, edge_gateway_id, ledger_id FROM edge_stuck_handovers($1::interval)',
        [EDGE_RELEASE_STUCK_AFTER],
      );
      return rows;
    });
    const live = new Set(stuck.map((row) => row.id));
    for (const id of this.alerted) if (!live.has(id)) this.alerted.delete(id);
    for (const id of this.audited) if (!live.has(id)) this.audited.delete(id);
    let raised = 0;
    for (const row of stuck) {
      // La trace en base est reprise à chaque passage tant qu'elle a échoué ; l'alerte de journal ne part qu'une fois.
      if (!this.audited.has(row.id) && (await this.audit(row.id))) this.audited.add(row.id);
      if (this.alerted.has(row.id)) continue;
      this.alerted.add(row.id);
      raised += 1;
      this.log.error(
        JSON.stringify({
          event: 'edge.alert',
          alert: 'EDGE_RELEASE_STUCK',
          handover_id: row.id,
          gateway_id: row.edge_gateway_id,
          ledger_id: row.ledger_id,
        }),
      );
    }
    this.alarmCode = stuck.length > 0 ? ALARM_EDGE_RELEASE_STUCK : 0;
    return raised;
  }

  /** Trace en base (décision 37) ; faux si l'écriture a échoué (le handover sera repris au passage suivant). */
  private async audit(handoverId: string): Promise<boolean> {
    try {
      await this.tx.withoutTenant(async (client) => {
        await client.query('SELECT edge_log_release_stuck($1::uuid)', [handoverId]);
      });
      return true;
    } catch (error) {
      this.log.error(
        JSON.stringify({
          event: 'edge.alert.audit_failed',
          alert: 'EDGE_RELEASE_STUCK',
          handover_id: handoverId,
          code: (error as { code?: string }).code ?? 'UNKNOWN',
        }),
      );
      return false;
    }
  }

  alarm(): number {
    return this.alarmCode;
  }

  describe(): Promise<string[]> {
    return Promise.resolve([
      `${this.name} : rendus en RELEASING depuis plus de ${EDGE_RELEASE_STUCK_AFTER} ` +
        `(alerte EDGE_RELEASE_STUCK), toutes les ${EDGE_RELEASE_STUCK_INTERVAL_MS / 1000} s`,
    ]);
  }
}
