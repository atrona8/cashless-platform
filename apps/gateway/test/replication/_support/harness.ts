import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { GatewayTx } from '../../../src/db/gateway-tx';
import {
  ReplicationService,
  type ReplicationFeed,
} from '../../../src/replication/replication.service';
import { createTestDb, type TestDb } from '../../startup/_support/db';
import { enrolledFixture } from '../../startup/_support/fixture';

export type Json = Record<string, unknown>;

/** Faux serveur de flux : sert les pages scriptées, note les requêtes. */
export class FakeFeed implements ReplicationFeed {
  requests: Array<{ afterPostingId: number; afterChangeSeq?: number; limit?: number }> = [];
  queue: Array<Json | ((req: FakeFeed['requests'][number]) => Json | Promise<Json>)> = [];
  fallback: ((req: FakeFeed['requests'][number]) => Json) | null = null;
  async getEdgeReplicationFeed(params: FakeFeed['requests'][number]) {
    this.requests.push(params);
    const next = this.queue.shift();
    const body = next
      ? typeof next === 'function'
        ? await next(params)
        : next
      : this.fallback
        ? this.fallback(params)
        : (() => {
            throw new Error('aucune page scriptée');
          })();
    return { body, centralDate: null, status: 200 };
  }
}

export class Roles {
  calls: string[] = [];
  async onRoleChanged(role: 'PRIMARY' | 'STANDBY'): Promise<void> {
    this.calls.push(role);
  }
}

export interface Rep {
  db: TestDb;
  tx: GatewayTx;
  feed: FakeFeed;
  roles: Roles;
  svc: ReplicationService;
  ids: { ledger: string; gateway: string; event: string };
  /** Page minimale valide ; `over` écrase des champs de premier niveau. */
  page(over?: Json, ref?: Json): Json;
  close(): Promise<void>;
}

export async function makeRep(options: { role?: 'PRIMARY' | 'STANDBY' } = {}): Promise<Rep> {
  const db = await createTestDb();
  const fx = await enrolledFixture(db, { role: options.role ?? 'PRIMARY' });
  const tx = new GatewayTx(db.pool);
  const feed = new FakeFeed();
  const roles = new Roles();
  const clock = {
    now: () => new Date(),
    observeCentral: async () => undefined,
    skewAlert: () => false,
    refusesAck: () => false,
  };
  const svc = new ReplicationService(tx, feed, clock, roles, {
    intervalMs: 1000,
    pageLimit: 100,
    catchUpRetryMs: 5,
    catchUpMaxRetries: 3,
  });
  const ids = { ledger: fx.file.ledger_id, gateway: fx.file.gateway_id, event: fx.file.event_id };
  return {
    db,
    tx,
    feed,
    roles,
    svc,
    ids,
    page(over = {}, ref = {}) {
      return {
        ledger_id: ids.ledger,
        epoch: 1,
        from_posting_id: 0,
        to_posting_id: 0,
        wallets: [],
        media: [],
        has_more: false,
        edge_seq_applied: 0,
        reference: { from_change_seq: 0, to_change_seq: 0, has_more: false, ...ref },
        ...over,
      };
    },
    async close() {
      await db.drop();
    },
  };
}

export const uid = (): string => randomUUID();
export const hex = (n: number): string => n.toString(16).padStart(64, '0');

export async function q<T = Record<string, unknown>>(
  r: Rep,
  sql: string,
  p: unknown[] = [],
): Promise<T[]> {
  return (await r.db.pool.query(sql, p)).rows as T[];
}

export async function addOp(
  r: Rep,
  walletId: string,
  paid: number,
  promo = 0,
  status = 'SENT',
): Promise<number> {
  const head = (
    await q<{ last_edge_seq: string }>(r, 'SELECT last_edge_seq FROM edge_chain_head')
  )[0];
  const seq = Number(head?.last_edge_seq ?? 0) + 1;
  const hash = Buffer.alloc(32, seq % 250);
  await r.db.pool.query(
    `INSERT INTO edge_op (edge_seq, origin_key, type, authorized_mode, device_serial, device_id,
       operation, content_sha256, chain_hash, occurred_at, recorded_at)
     VALUES ($1, $2, 'PURCHASE', 'EDGE_ONLINE', 'T', gen_random_uuid(), '{}', $3, $3, now(), now())`,
    [seq, `o-${seq}-${Math.random()}`, hash],
  );
  await r.db.pool.query('UPDATE edge_chain_head SET last_edge_seq = $1', [seq]);
  await r.db.pool.query('INSERT INTO edge_op_delta VALUES ($1, $2, $3, $4)', [
    seq,
    walletId,
    paid,
    promo,
  ]);
  if (status !== 'SENT') {
    await r.db.pool.query('UPDATE edge_op SET central_status = $2 WHERE edge_seq = $1', [
      seq,
      status,
    ]);
  }
  return seq;
}
