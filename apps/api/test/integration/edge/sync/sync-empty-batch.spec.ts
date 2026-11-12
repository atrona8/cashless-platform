// Lot de la passerelle sans opération (WP25 partie A2 ; décision 50, ADR-187, OP-N119) : accepté seulement s'il
// porte des `local_orders` ; `edge_seq` et la chaîne ne bougent pas ; signature, époque et idempotence contrôlées.
import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { seedEdgeWorld, type EdgeWorld } from '../../../support/edge-fixtures';
import {
  edgePost,
  makeBatch,
  openOwner,
  purchases,
  resign,
  seedSite,
  startSyncEdge,
  TestCentral,
  TestTapProof,
  type Site,
  type SyncEdge,
} from './sync-support';

jest.setTimeout(120_000);

describe('lot sans opération portant un ordre local', () => {
  let owner: Client;
  let world: EdgeWorld;
  let edge: SyncEdge;

  beforeAll(async () => {
    owner = await openOwner();
    world = await seedEdgeWorld(owner);
    edge = await startSyncEdge(new TestCentral(owner), new TestTapProof(owner), owner);
  });
  afterAll(async () => {
    await edge?.close();
    await owner?.end();
  });

  const post = (site: Site, batch: unknown, options = {}) =>
    edgePost(edge.port, site.cert, batch, options);
  const order = (site: Site) => ({
    type: 'PURGE',
    gateway_id: site.gatewayId,
    holders: ['Awa Diop', 'Moussa Ba'],
    at: new Date().toISOString(),
    order_sha256: randomUUID().replace(/-/g, '').repeat(2),
  });
  const one = async <T>(sql: string, args: unknown[]): Promise<T> =>
    (await owner.query(sql, args)).rows[0] as T;
  const cursor = async (site: Site) =>
    (
      await one<{ c: bigint; h: Buffer | null }>(
        `SELECT contiguous_edge_seq AS c, last_chain_hash AS h FROM edge_gateway WHERE id = $1`,
        [site.gatewayId],
      )
    ).c;
  const batches = async (site: Site) =>
    (
      await one<{ n: number }>(
        `SELECT count(*)::int AS n FROM edge_sync_batch WHERE gateway_id = $1`,
        [site.gatewayId],
      )
    ).n;
  const orderAudits = async (site: Site) =>
    (
      await one<{ n: number }>(
        `SELECT count(*)::int AS n FROM audit_log
          WHERE action = 'EDGE_LOCAL_ORDER_RECORDED' AND object_id = $1`,
        [site.gatewayId],
      )
    ).n;

  it('sans aucune opération avant : accepté et accusé, ordre à l’audit, rien d’autre ne bouge', async () => {
    const site = await seedSite(owner, world);
    const batch = makeBatch(site, [], { extra: { local_orders: [order(site)] } });
    expect(batch.edge_seq_from).toBe(1);
    expect(batch.edge_seq_to).toBe(0);
    const reply = await post(site, batch);
    expect(reply.status).toBe(200);
    expect(reply.json?.results).toEqual([]);
    expect(reply.json?.contiguous_acked_seq).toBe(0);
    expect(await cursor(site)).toBe(0n);
    expect(await orderAudits(site)).toBe(1);
    const row = await one<{ status: string; f: string; t: string }>(
      `SELECT status, edge_seq_from::text AS f, edge_seq_to::text AS t FROM edge_sync_batch
        WHERE batch_id = $1`,
      [batch.batch_id],
    );
    expect(row).toEqual({ status: 'DONE', f: '1', t: '0' });
    const { rows } = await owner.query(
      `SELECT count(*)::int AS n FROM journal_transaction
        WHERE ledger_id = $1 AND source = 'EDGE_SYNC'`,
      [site.ledgerId],
    );
    expect(rows[0].n).toBe(0);
  });

  it('après des opérations : numéro suivant et chaîne inchangés, renvoi idempotent (un seul audit)', async () => {
    const site = await seedSite(owner, world);
    expect((await post(site, makeBatch(site, purchases(site, 2)))).status).toBe(200);
    const before = await one<{ h: Buffer }>(
      `SELECT last_chain_hash AS h FROM edge_gateway WHERE id = $1`,
      [site.gatewayId],
    );
    const batch = makeBatch(site, [], {
      keepState: true,
      extra: { local_orders: [order(site)] },
    });
    expect(batch.edge_seq_from).toBe(3);
    expect(batch.edge_seq_to).toBe(2);
    expect(batch.prev_chain_hash).toBe(batch.last_chain_hash);
    const first = await post(site, batch);
    const again = await post(site, batch);
    expect(first.status).toBe(200);
    expect(again.status).toBe(200);
    expect(again.json?.results).toEqual([]);
    expect(await cursor(site)).toBe(2n);
    expect(await orderAudits(site)).toBe(1);
    expect(await batches(site)).toBe(2);
    const after = await one<{ h: Buffer }>(
      `SELECT last_chain_hash AS h FROM edge_gateway WHERE id = $1`,
      [site.gatewayId],
    );
    expect(after.h.equals(before.h)).toBe(true);
  });

  it('même batch_id avec un contenu différent : refusé, un seul lot', async () => {
    const site = await seedSite(owner, world);
    const batchId = randomUUID();
    const a = makeBatch(site, [], { batchId, extra: { local_orders: [order(site)] } });
    expect((await post(site, a)).status).toBe(200);
    const b = makeBatch(site, [], { batchId, extra: { local_orders: [order(site)] } });
    const reply = await post(site, b);
    expect(reply.status).toBeGreaterThanOrEqual(400);
    expect(await batches(site)).toBe(1);
    expect(await orderAudits(site)).toBe(1);
  });

  it('lot vide SANS local_orders : 422 nommé, rien d’écrit (ni lot ni audit)', async () => {
    const site = await seedSite(owner, world);
    for (const extra of [{}, { local_orders: [] }]) {
      const reply = await post(site, makeBatch(site, [], { extra }));
      expect(reply.status).toBe(422);
      expect(reply.json?.code).toBe('VALIDATION_FAILED');
      expect(reply.json?.detail).toContain('EMPTY_BATCH_WITHOUT_LOCAL_ORDERS');
    }
    expect(await batches(site)).toBe(0);
    expect(await orderAudits(site)).toBe(0);
  });

  it('époque fausse : 409 STALE_AUTHORITY_EPOCH, aucun lot ni audit', async () => {
    const site = await seedSite(owner, world);
    const reply = await post(
      site,
      makeBatch(site, [], { epoch: 9, extra: { local_orders: [order(site)] } }),
    );
    expect(reply.status).toBe(409);
    expect(reply.json?.code).toBe('STALE_AUTHORITY_EPOCH');
    expect(await batches(site)).toBe(0);
    expect(await orderAudits(site)).toBe(0);
  });

  it('numéro de départ faux ou chaîne fausse : 409, aucun lot ni audit', async () => {
    const site = await seedSite(owner, world);
    expect((await post(site, makeBatch(site, purchases(site, 1)))).status).toBe(200);
    const ahead = makeBatch(site, [], {
      keepState: true,
      patch: { edge_seq_from: 5, edge_seq_to: 4 },
      extra: { local_orders: [order(site)] },
    });
    expect((await post(site, ahead)).json?.code).toBe('SEQ_OUT_OF_ORDER');
    const behind = makeBatch(site, [], {
      keepState: true,
      patch: { edge_seq_from: 1, edge_seq_to: 0 },
      extra: { local_orders: [order(site)] },
    });
    expect((await post(site, behind)).json?.code).toBe('SEQ_OUT_OF_ORDER');
    const wrong = 'ab'.repeat(32);
    const forged = makeBatch(site, [], {
      keepState: true,
      patch: { prev_chain_hash: wrong, last_chain_hash: wrong },
      extra: { local_orders: [order(site)] },
    });
    expect((await post(site, forged)).json?.code).toBe('CHAIN_BROKEN');
    expect(await batches(site)).toBe(1);
    expect(await orderAudits(site)).toBe(0);
  });

  it('signature fausse ou Idempotency-Key différente : refusé, aucun audit', async () => {
    const site = await seedSite(owner, world);
    const batch = makeBatch(site, [], { extra: { local_orders: [order(site)] } });
    const bad = { ...batch, local_orders: [order(site)] }; // contenu changé, signature d'avant
    expect((await post(site, bad)).json?.code).toBe('BATCH_SIGNATURE_INVALID');
    const reply = await post(site, batch, { idempotencyKey: randomUUID() });
    expect(reply.status).toBe(422);
    expect(await orderAudits(site)).toBe(0);
    expect(await batches(site)).toBe(0);
    resign(site, batch);
  });
});
