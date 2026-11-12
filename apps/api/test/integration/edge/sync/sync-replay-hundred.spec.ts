// 100 rejeux d'un même lot, en série puis 10 en parallèle : une seule écriture par opération, mêmes
// réponses (WP13).
import type { Client } from 'pg';
import { seedEdgeWorld, type EdgeWorld } from '../../../support/edge-fixtures';
import {
  edgePost,
  makeBatch,
  openOwner,
  purchases,
  seedSite,
  startSyncEdge,
  TestCentral,
  TestTapProof,
  type Site,
  type SyncEdge,
} from './sync-support';

jest.setTimeout(300_000);

describe('rejeux d’un même lot', () => {
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

  const post = (site: Site, batch: unknown) => edgePost(edge.port, site.cert, batch);
  const written = async (site: Site): Promise<number> =>
    (
      await owner.query(
        `SELECT count(*)::int AS n FROM journal_transaction WHERE ledger_id = $1 AND source = 'EDGE_SYNC'`,
        [site.ledgerId],
      )
    ).rows[0].n;
  const answer = (reply: { json: Record<string, any> | null }) =>
    JSON.stringify({ results: reply.json?.results, acked: reply.json?.contiguous_acked_seq });

  it('100 rejeux en série : une écriture par opération, mêmes réponses', async () => {
    const site = await seedSite(owner, world, [[1, 1_000_000]]);
    const batch = makeBatch(site, purchases(site, 5, { amount: 700 }));
    const first = await post(site, batch);
    expect(first.status).toBe(200);
    const reference = answer(first);
    for (let i = 0; i < 100; i += 1) {
      const replay = await post(site, batch);
      expect(replay.status).toBe(200);
      expect(replay.headers['idempotency-replayed']).toBe('true');
      expect(answer(replay)).toBe(reference);
    }
    expect(await written(site)).toBe(5);
  });

  it('10 rejeux en parallèle : une écriture par opération, mêmes réponses', async () => {
    const site = await seedSite(owner, world, [[1, 1_000_000]]);
    const batch = makeBatch(site, purchases(site, 5, { amount: 700 }));
    const replies = await Promise.all(Array.from({ length: 10 }, () => post(site, batch)));
    for (const reply of replies) expect(reply.status).toBe(200);
    expect(new Set(replies.map(answer)).size).toBe(1);
    expect(await written(site)).toBe(5);
  });
});
