// Réplication central -> passerelle (interfaces.md § 10, § 13.9). Seule écriture des tables
// répliquées (R). Trois curseurs (postings, journal de référence, edge_seq) avancés dans la
// transaction locale qui applique la page.
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { AUTHORITY } from '../authority/authority.service';
import type { ReplicationCatchUp } from '../authority/ports';
import type { CentralResponse, RequestOptions } from '../central-client/central-client';
import { GATEWAY_CLOCK, type GatewayClock } from '../clock/gateway-clock';
import { GatewayTx, type TxClient } from '../db/gateway-tx';
import { DeltaPurge } from './delta-purge';
import { readEffectiveBalance, type Balance } from './effective-balance';
import { replicationApplyHook } from '../testing/apply-hook';
import { applyPage } from './page-applier';
import { parseReplicationPage, ReplicationPageError } from './page-schema';

export const REPLICATION_FEED = Symbol('REPLICATION_FEED');
export const REPLICATION_OPTIONS = Symbol('REPLICATION_OPTIONS');

/** Le client du central (WP17) ; un faux serveur de flux en test. */
export interface ReplicationFeed {
  getEdgeReplicationFeed(
    params: { afterPostingId: number; limit?: number; afterChangeSeq?: number },
    options?: RequestOptions,
  ): Promise<CentralResponse<Record<string, unknown>>>;
}
export interface RolePort {
  onRoleChanged(role: 'PRIMARY' | 'STANDBY'): Promise<void>;
}
export interface ReplicationOptions {
  /** Intervalle de la boucle de fond ; porteur de NFR-008 (5 s au p95 pour un blocage). */
  intervalMs: number;
  pageLimit: number;
  /** Attente entre deux passes quand le rattrapage n'a pas encore atteint le filigrane. */
  catchUpRetryMs: number;
  catchUpMaxRetries: number;
}
export const DEFAULT_REPLICATION_OPTIONS: ReplicationOptions = {
  intervalMs: 1000,
  // Le central refuse `limit` > 200 (Limit du contrat, `replication-feed.controller.ts`) : 500 faisait
  // échouer toute passe contre le vrai central (trouvé par le banc WP25).
  pageLimit: 200,
  catchUpRetryMs: 200,
  catchUpMaxRetries: 25,
};

export class CatchUpIncompleteError extends Error {
  constructor(reached: bigint, watermark: bigint) {
    super(`rattrapage incomplet : curseur ${reached} < filigrane ${watermark}`);
    this.name = 'CatchUpIncompleteError';
  }
}

interface CursorState {
  posting: bigint;
  change: number;
  seqApplied: number;
}

@Injectable()
export class ReplicationService implements ReplicationCatchUp {
  private readonly logger = new Logger('ReplicationService');
  readonly purge: DeltaPurge;
  private readonly options: ReplicationOptions;
  private passId = 0;
  private inPass = false;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    @Inject(GatewayTx) private readonly gatewayTx: GatewayTx,
    @Inject(REPLICATION_FEED) private readonly feed: ReplicationFeed,
    @Inject(GATEWAY_CLOCK) private readonly clock: GatewayClock,
    @Inject(AUTHORITY) private readonly roles: RolePort,
    @Optional() @Inject(REPLICATION_OPTIONS) options?: Partial<ReplicationOptions>,
    // Instance partagée avec `DELTA_PURGE` (module) : la file l'obtient sans dépendre de ce service,
    // ce qui rompt le cycle d'injection réplication -> autorité -> file -> réplication.
    @Optional() @Inject(DeltaPurge) purge?: DeltaPurge,
  ) {
    this.options = { ...DEFAULT_REPLICATION_OPTIONS, ...options };
    this.purge = purge ?? new DeltaPurge();
    this.purge.passesStarted = () => this.passId;
  }

  get intervalMs(): number {
    return this.options.intervalMs;
  }

  /** Une page. `hasMore` : l'un des deux curseurs a une suite (boucler sans attendre). */
  pullOnce(): Promise<{ hasMore: boolean }> {
    return this.exclusive(() => this.pull());
  }

  /**
   * Revient quand `last_replicated_posting_id >= watermark` ET que le central a reçu une requête
   * portant le curseur de référence FINAL (page vide, A03) : il consigne alors
   * `reference_applied_seq`, que `edge_ack_handover` exige avant l'accusé.
   */
  async catchUpTo(watermark: bigint): Promise<void> {
    await this.exclusive(async () => {
      let stalls = 0;
      for (let guard = 0; guard < 100_000; guard += 1) {
        const before = await this.readCursor();
        const { hasMore } = await this.pull();
        const after = await this.readCursor();
        if (after.posting < watermark) {
          if (hasMore) continue;
          stalls += 1; // l'horizon du central n'a pas encore atteint le filigrane
          if (stalls > this.options.catchUpMaxRetries) {
            throw new CatchUpIncompleteError(after.posting, watermark);
          }
          await new Promise((r) => setTimeout(r, this.options.catchUpRetryMs));
          continue;
        }
        // Filigrane atteint : la dernière requête doit avoir porté le curseur de référence final.
        if (!hasMore && after.change === before.change) return;
      }
      throw new CatchUpIncompleteError((await this.readCursor()).posting, watermark);
    });
  }

  effectiveBalance(tx: TxClient, walletId: string): Promise<Balance> {
    return readEffectiveBalance(tx, walletId);
  }

  // ----- interne --------------------------------------------------------------------------

  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.catch(() => undefined);
    return run;
  }

  private async readCursor(): Promise<CursorState> {
    return this.gatewayTx.run(async (tx) => {
      const { rows } = await tx.query<{ p: string; c: string; s: string }>(
        `SELECT last_replicated_posting_id AS p, last_change_seq AS c, last_edge_seq_applied AS s
           FROM edge_replication_cursor`,
      );
      return {
        posting: BigInt(rows[0]?.p ?? '0'),
        change: Number(rows[0]?.c ?? 0),
        seqApplied: Number(rows[0]?.s ?? 0),
      };
    });
  }

  private async pull(): Promise<{ hasMore: boolean }> {
    if (!this.inPass) {
      this.inPass = true;
      this.passId += 1;
    }
    const passId = this.passId;
    // Reprise : on repart toujours du curseur persisté.
    const cursor = await this.readCursor();
    const response = await this.feed.getEdgeReplicationFeed({
      afterPostingId: Number(cursor.posting),
      afterChangeSeq: cursor.change,
      limit: this.options.pageLimit,
    });
    let cancelled: number[] = [];
    let outcome;
    try {
      const page = parseReplicationPage(response.body);
      outcome = await this.gatewayTx.run(async (tx) => {
        const result = await applyPage(tx, page, {
          now: this.clock.now(),
          purge: this.purge,
          afterStep: replicationApplyHook(),
        });
        if (result.finalPage) cancelled = await this.purge.onPassCompleted(tx, passId);
        return result;
      });
    } catch (error) {
      if (error instanceof ReplicationPageError) await this.alertRefused(error);
      throw error;
    }
    this.purge.forget(cancelled);
    if (outcome.finalPage) this.inPass = false;
    // Le rôle lu dans `reference.gateway.role` est transmis à chaque page qui le porte (A25).
    if (outcome.roleServed) await this.roles.onRoleChanged(outcome.role);
    return { hasMore: !outcome.finalPage };
  }

  /** Relit le rôle persisté et le transmet (reprise après un arrêt entre la page et la promotion). */
  async syncRole(): Promise<void> {
    const role = await this.gatewayTx.run(async (tx) => {
      const { rows } = await tx.query<{ role: 'PRIMARY' | 'STANDBY' }>(
        'SELECT role FROM edge_meta',
      );
      return rows[0]?.role;
    });
    if (role) await this.roles.onRoleChanged(role);
  }

  private async alertRefused(error: ReplicationPageError): Promise<void> {
    this.logger.warn(`page refusée (${error.kind}) : ${error.message}`);
    try {
      await this.gatewayTx.run(async (tx) => {
        const detail = JSON.stringify({ kind: error.kind, reason: error.message });
        await tx.query(
          `INSERT INTO edge_audit (kind, actor, detail) VALUES ('REPLICATION_PAGE_REFUSED', 'replication', $1)`,
          [detail],
        );
        if (error.kind === 'FOREIGN') {
          await tx.query(`SELECT pg_notify('edge_alert', $1)`, [
            JSON.stringify({ alert: 'REPLICATION_FOREIGN_PAGE', reason: error.message }),
          ]);
        }
      });
    } catch {
      // l'alerte ne masque pas la cause
    }
  }
}
