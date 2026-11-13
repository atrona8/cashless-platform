// Canal de contrôle (T077 ; research R-17, data-model.md B.8).
//
// Boucle `getCurrentEdgeHandover?wait=25` relancée AUSSITÔT (le réveil immédiat est côté central) ;
// aucun `sleep` de sondage. Chaque changement passe par `AuthorityService`, qui PERSISTE d'abord
// puis agit. Les étapes qui suivent sont pilotées par l'ÉTAT lu en base (jamais par un événement
// retenu en mémoire) : un redémarrage les reprend, une opération reçue deux fois a le même effet.
//   - `GRANTED_PENDING` : rattrapage (`REPLICATION_CATCH_UP`), puis accusé, puis `ACTIVE` ;
//   - `RELEASING` : signal au vidage, file vide et acquittée, puis rendu, puis `RELEASED`/`ARMED`.
// Lien : `ISOLATED` après 25 s sans échange réussi, `CATCHING_UP` au retour tant que la file n'est
// pas vide, `CONNECTED` ensuite. Le lien n'accorde et ne retire aucun droit.
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { GATEWAY_CLOCK, type GatewayClock } from '../clock/gateway-clock';
import { CentralClient } from '../central-client/central-client';
import { CentralError } from '../central-client/central-errors';
import { GatewayTx } from '../db/gateway-tx';
import { AuthorityService } from './authority.service';
import {
  DRAIN_SIGNAL,
  QUEUE_PROBE,
  REPLICATION_CATCH_UP,
  unavailableCatchUp,
  type DrainSignal,
  type QueueProbe,
  type ReplicationCatchUp,
} from './ports';

export const LINK_ISOLATED_AFTER_MS = 25_000;
export const BACKOFF_START_MS = 250;
export const BACKOFF_CEILING_MS = 5_000;
export const RETRY_SOON_MS = 1_000;
export const LONG_POLL_SECONDS = 25;

interface ChainHead {
  last_edge_seq: string;
  last_chain_hash: Buffer;
  acked_edge_seq: string;
  acked_chain_hash: Buffer | null;
}

@Injectable()
export class ControlChannel {
  private readonly logger = new Logger('ControlChannel');
  /** Source de temps du lien (surchargeable par un test). */
  timeSource: () => number = () => performance.now();
  private stopped = true;
  private loopDone: Promise<void> = Promise.resolve();
  private pollAbort: AbortController | null = null;
  private wakePending = false;
  private sleeper: { timer: NodeJS.Timeout; resolve: () => void } | null = null;
  private retryTimer: NodeJS.Timeout | null = null;
  private lastSuccessMs: number;
  private drainRequestedFor = '';
  private releaseBlockedFor = '';

  constructor(
    @Inject(AuthorityService) private readonly authority: AuthorityService,
    @Inject(CentralClient) private readonly client: CentralClient,
    @Inject(GATEWAY_CLOCK) private readonly clock: GatewayClock,
    @Inject(GatewayTx) private readonly gatewayTx: GatewayTx,
    @Inject(QUEUE_PROBE) private readonly probe: QueueProbe,
    @Optional() @Inject(REPLICATION_CATCH_UP) catchUp?: ReplicationCatchUp,
    @Optional() @Inject(DRAIN_SIGNAL) private readonly drain?: DrainSignal,
  ) {
    this.catchUp = catchUp ?? unavailableCatchUp;
    this.lastSuccessMs = this.timeSource();
  }

  private readonly catchUp: ReplicationCatchUp;

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.lastSuccessMs = this.timeSource();
    this.loopDone = this.loop();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.pollAbort?.abort();
    if (this.sleeper) {
      clearTimeout(this.sleeper.timer);
      this.sleeper.resolve();
    }
    if (this.retryTimer) clearTimeout(this.retryTimer);
    await this.loopDone;
  }

  /** Interrompt l'attente longue en cours : la boucle relit aussitôt (ex. file vidée par WP20). */
  wake(): void {
    this.wakePending = true;
    this.pollAbort?.abort();
  }

  /** WP20 appelle ceci quand la file est vide et acquittée. */
  notifyQueueDrained(): void {
    this.wake();
  }

  private async loop(): Promise<void> {
    let backoff = BACKOFF_START_MS;
    while (!this.stopped) {
      try {
        await this.runOnce(this.wakePending ? 0 : LONG_POLL_SECONDS);
        backoff = BACKOFF_START_MS;
      } catch (error) {
        if (this.stopped) break;
        await this.onFailure(error);
        if ((await this.authority.state()).state === 'REVOKED') {
          this.logger.error('passerelle révoquée : canal de contrôle arrêté');
          break;
        }
        await this.sleep(backoff);
        backoff = Math.min(backoff * 2, BACKOFF_CEILING_MS);
      }
    }
  }

  private async onFailure(error: unknown): Promise<void> {
    if (error instanceof CentralError && error.isCertificateRejected) {
      await this.authority.markRevoked();
      return;
    }
    if (this.timeSource() - this.lastSuccessMs >= LINK_ISOLATED_AFTER_MS) {
      await this.authority.setLinkState('ISOLATED').catch(() => undefined);
    }
    if (!(error instanceof CentralError)) {
      this.logger.error(`canal de contrôle : ${error instanceof Error ? error.message : 'erreur'}`);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.sleeper = null;
        resolve();
      }, ms);
      timer.unref();
      this.sleeper = { timer, resolve };
    });
  }

  /** Une passe : lecture (attente longue `wait`), état, puis les étapes pilotées par l'état. */
  async runOnce(wait: number): Promise<void> {
    this.wakePending = false;
    const abort = new AbortController();
    this.pollAbort = abort;
    let res: Awaited<ReturnType<CentralClient['getCurrentEdgeHandover']>>;
    try {
      res = await this.client.getCurrentEdgeHandover(wait, { signal: abort.signal });
    } catch (error) {
      if (error instanceof CentralError && error.code === 'ABORTED' && !this.stopped) return;
      throw error;
    } finally {
      this.pollAbort = null;
    }
    this.lastSuccessMs = this.timeSource();
    await this.authority.setLinkState((await this.probe.isEmpty()) ? 'CONNECTED' : 'CATCHING_UP');
    await this.authority.handleCentralState(res.body, res.centralDate ?? this.clock.now());
    await this.ackStep();
    await this.releaseStep();
  }

  // ----- accusé (GRANTED_PENDING) -------------------------------------------------------------

  async ackStep(): Promise<void> {
    const row = await this.authority.state();
    if (row.state !== 'GRANTED_PENDING' || row.handoverId === null) return;
    if (row.watermarkPostingId === null) return;
    // A14 : horloge incohérente (plus de 24 h d'écart au central) : l'accusé ne part pas.
    if (this.clock.refusesAck()) {
      await this.authority.abandonGrant('horloge incohérente avec le central');
      return;
    }
    try {
      await this.catchUp.catchUpTo(row.watermarkPostingId);
    } catch (error) {
      this.logger.warn(
        `rattrapage impossible, accusé non envoyé (${error instanceof Error ? error.name : '?'})`,
      );
      this.retrySoon();
      return;
    }
    const reached = await this.replicatedPosting();
    if (reached < row.watermarkPostingId) {
      this.retrySoon();
      return;
    }
    if (this.clock.refusesAck()) {
      await this.authority.abandonGrant('horloge incohérente avec le central');
      return;
    }
    try {
      const res = await this.client.ackEdgeHandover(row.handoverId, {
        epoch: row.epoch,
        replicated_posting_id: Number(reached),
      });
      await this.authority.markActive({
        handoverId: row.handoverId,
        epoch: row.epoch,
        centralTime: res.centralDate ?? this.clock.now(),
        edgeSeqAtActivation: res.body.handover?.edge_seq_at_activation ?? null,
      });
    } catch (error) {
      if (!(error instanceof CentralError) || error.isLinkFailure) throw error;
      if (error.isCertificateRejected) {
        await this.authority.markRevoked();
      } else if (error.code === 'EDGE_NOT_CAUGHT_UP') {
        this.retrySoon(); // le rattrapage reprend à la passe suivante
      } else {
        this.wake(); // le central a changé d'avis : relire l'état, il décide
      }
    }
  }

  // ----- rendu (RELEASING) --------------------------------------------------------------------

  async releaseStep(): Promise<void> {
    const row = await this.authority.state();
    if (row.state !== 'RELEASING' || row.handoverId === null) return;
    if (this.drainRequestedFor !== row.handoverId) {
      this.drainRequestedFor = row.handoverId;
      await this.drain?.requestDrain();
    }
    if (this.releaseBlockedFor === row.handoverId) return; // chaîne rompue : examen manuel
    const head = await this.chainHead();
    const same =
      head.acked_edge_seq === head.last_edge_seq &&
      (head.last_edge_seq === '0' ||
        (head.acked_chain_hash !== null && head.acked_chain_hash.equals(head.last_chain_hash)));
    if (!same || !(await this.probe.isEmpty())) return; // file non vide ou non acquittée
    const operations = BigInt(head.last_edge_seq) - (row.edgeSeqAtActivation ?? 0n);
    if (operations < 0n) {
      this.releaseBlockedFor = row.handoverId;
      this.logger.error('rendu bloqué : numérotation antérieure à l’activation');
      return;
    }
    try {
      await this.client.releaseEdgeHandover(row.handoverId, {
        epoch: row.epoch,
        final_edge_seq: Number(head.last_edge_seq),
        last_chain_hash: head.last_chain_hash.toString('hex'),
        operations_count: Number(operations),
      });
      await this.authority.markReleased();
    } catch (error) {
      if (!(error instanceof CentralError) || error.isLinkFailure) throw error;
      if (error.isCertificateRejected) {
        await this.authority.markRevoked();
      } else if (error.code === 'EDGE_NOT_CAUGHT_UP') {
        await this.drain?.requestDrain({ missingEdgeSeqs: error.details.missingEdgeSeqs ?? [] });
        this.retrySoon();
      } else if (error.code === 'CHAIN_BROKEN') {
        this.releaseBlockedFor = row.handoverId;
        this.logger.error('rendu refusé : chaîne rompue (examen manuel), alerte');
        await this.gatewayTx.run((tx) =>
          tx.query(
            `INSERT INTO edge_audit (kind, actor, detail)
             VALUES ('RELEASE_CHAIN_BROKEN', 'gateway', $1)`,
            [JSON.stringify({ handover: row.handoverId, final_edge_seq: head.last_edge_seq })],
          ),
        );
      } else {
        this.wake();
      }
    }
  }

  // ----- aides ----------------------------------------------------------------------------------

  /** Relance dans 1 s (rattrapage ou vidage en cours) : jamais une boucle chaude. */
  private retrySoon(): void {
    if (this.retryTimer || this.stopped) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.wake();
    }, RETRY_SOON_MS);
    this.retryTimer.unref();
  }

  private async replicatedPosting(): Promise<bigint> {
    return this.gatewayTx.run(async (tx) => {
      const { rows } = await tx.query<{ last_replicated_posting_id: string }>(
        'SELECT last_replicated_posting_id FROM edge_replication_cursor',
      );
      return BigInt(rows[0]?.last_replicated_posting_id ?? '0');
    });
  }

  private async chainHead(): Promise<ChainHead> {
    return this.gatewayTx.run(async (tx) => {
      const { rows } = await tx.query<ChainHead>(
        `SELECT last_edge_seq, last_chain_hash, acked_edge_seq, acked_chain_hash
           FROM edge_chain_head`,
      );
      if (!rows[0]) throw new Error('edge_chain_head : ligne absente (passerelle non enrôlée)');
      return rows[0];
    });
  }
}
