// Déclencheur AUTOMATIQUE de la purge (T108). Elle part si, et seulement si :
//   - la réplication porte `event.status = CLOSED` (`edge_event_setting`) ;
//   - la file est vide et entièrement acquittée (`QUEUE_PROBE` : `acked_edge_seq = last_edge_seq`,
//     aucun lot non `DONE`) ;
//   - aucun delta de solde n'est actif (`edge_op_delta` vide).
// Tant que la file n'est pas acquittée : aucune purge, une alerte locale « purge en attente »
// (audit `PURGE_PENDING`, au plus une fois par `PENDING_ALERT_MS`) ; aucune perte.
import { Inject, Injectable, Logger } from '@nestjs/common';
import { QUEUE_PROBE, type QueueProbe } from '../authority/ports';
import { GatewayTx } from '../db/gateway-tx';
import { PurgeService } from './purge.service';

export const PURGE_CHECK_INTERVAL_MS = 5_000;
export const PENDING_ALERT_MS = 10 * 60 * 1000;

export type PurgeReadiness = 'NOT_CLOSED' | 'PENDING' | 'READY';

@Injectable()
export class PurgeTrigger {
  private readonly logger = new Logger('PurgeTrigger');
  private timer: NodeJS.Timeout | null = null;
  private busy = false;
  private lastPendingAlert = -Infinity;

  constructor(
    @Inject(GatewayTx) private readonly gatewayTx: GatewayTx,
    @Inject(QUEUE_PROBE) private readonly queue: QueueProbe,
    @Inject(PurgeService) private readonly purge: PurgeService,
  ) {}

  async readiness(): Promise<PurgeReadiness> {
    const closed = await this.gatewayTx.run(async (tx) => {
      const { rows } = await tx.query<{ status: string }>('SELECT status FROM edge_event_setting');
      return rows[0]?.status === 'CLOSED';
    });
    if (!closed) return 'NOT_CLOSED';
    if (!(await this.queue.isEmpty())) return 'PENDING';
    const deltas = await this.gatewayTx.run(async (tx) => {
      const { rows } = await tx.query<{ n: string }>('SELECT count(*) AS n FROM edge_op_delta');
      return Number(rows[0]?.n ?? 0);
    });
    return deltas === 0 ? 'READY' : 'PENDING';
  }

  /** Une évaluation : purge si prête, alerte si en attente. Rend l'état constaté. */
  async tick(now = Date.now()): Promise<PurgeReadiness> {
    if (this.purge.engaged) return 'NOT_CLOSED';
    const state = await this.readiness();
    if (state === 'READY') {
      await this.purge.execute({ trigger: 'AUTO' });
    } else if (state === 'PENDING' && now - this.lastPendingAlert >= PENDING_ALERT_MS) {
      this.lastPendingAlert = now;
      this.logger.warn('purge en attente : la file des décisions n’est pas entièrement acquittée');
      await this.gatewayTx.run((tx) =>
        tx.query(
          `INSERT INTO edge_audit (kind, actor, detail) VALUES ('PURGE_PENDING', 'gateway', '{}')`,
        ),
      );
    }
    return state;
  }

  start(intervalMs = PURGE_CHECK_INTERVAL_MS): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      if (this.busy) return;
      this.busy = true;
      this.tick()
        .catch((error: unknown) =>
          this.logger.error(`purge automatique : échec (${(error as Error).name})`),
        )
        .finally(() => {
          this.busy = false;
        });
    }, intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
