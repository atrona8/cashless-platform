// WP25 partie A2 (décision 50, ADR-187, OP-N119) : lot sortant SANS opération, seulement des ordres locaux.
// Représentation : edge_seq_from = dernier numéro + 1, edge_seq_to = from - 1, chaîne inchangée.
import { edgeChainGenesis } from '@cashless/shared-rules';
import {
  acceptAll,
  auditKinds,
  batches,
  head,
  makeQueueHarness,
  ops,
  verifyBatchSignature,
  type QueueHarness,
} from './_support/queue-harness';

jest.setTimeout(30_000);

let h: QueueHarness;
beforeEach(async () => {
  h = await makeQueueHarness();
});
afterEach(async () => {
  await h.close();
});

const SHA = 'ab'.repeat(32);
const submissions = (): Array<Record<string, any>> =>
  h.central.requests.filter((r) => r.path === '/edge/sync-batches').map((r) => r.body as any);
const addOrder = (sha = SHA, kind = 'PURGE') =>
  h.db.pool.query(
    `INSERT INTO edge_audit (kind, actor, detail) VALUES ('SITE_ORDER_ACCEPTED', 'gateway', $1)`,
    [
      JSON.stringify({
        order_kind: kind,
        holders: ['Responsable A', 'Responsable B'],
        order_sha256: sha,
      }),
    ],
  );
const pendingOrders = async (): Promise<number> =>
  Number(
    (
      await h.db.pool.query(
        `SELECT count(*) AS n FROM edge_audit
          WHERE kind = 'SITE_ORDER_ACCEPTED' AND sent_in_batch IS NULL`,
      )
    ).rows[0].n,
  );

describe('lot d’ordres seuls', () => {
  it('file vide, ordre à verser : lot sans opération, chaîne de la genèse, signé, accusé', async () => {
    await addOrder();
    h.central.script = (request) => acceptAll(request);
    expect((await h.drain.runOnce()).empty).toBe(true);
    const [body] = submissions();
    expect(submissions()).toHaveLength(1);
    expect(body).toMatchObject({
      edge_seq_from: 1,
      edge_seq_to: 0,
      operations: [],
      edge_gateway_id: h.gatewayId,
    });
    expect(body!.local_orders).toHaveLength(1);
    expect(body!.local_orders[0]).toMatchObject({ type: 'PURGE', order_sha256: SHA });
    const genesis = edgeChainGenesis(h.gatewayId).toString('hex');
    expect([body!.prev_chain_hash, body!.last_chain_hash]).toEqual([genesis, genesis]);
    expect(verifyBatchSignature(body!, await h.keystore.publicKey('batch'))).toBe(true);
    // Accusé : l'ordre est versé, le lot clos, edge_seq et chaîne inchangés.
    expect(await pendingOrders()).toBe(0);
    expect((await batches(h.db)).map((b) => b.status)).toEqual(['DONE']);
    expect(await head(h.db)).toMatchObject({ last_edge_seq: '0', acked_edge_seq: '0' });
    expect(await ops(h.db)).toEqual([]);
  });

  it('après des opérations acquittées : numéro suivant, chaîne du dernier maillon', async () => {
    await h.add(2);
    h.central.script = (request) => acceptAll(request);
    await h.drain.runOnce();
    const last = (await head(h.db)).last_chain_hash as Buffer;
    await addOrder();
    await h.drain.runOnce();
    const second = submissions()[1]!;
    expect([second.edge_seq_from, second.edge_seq_to, second.operations]).toEqual([3, 2, []]);
    expect([second.prev_chain_hash, second.last_chain_hash]).toEqual([
      last.toString('hex'),
      last.toString('hex'),
    ]);
    expect(await pendingOrders()).toBe(0);
    expect(await head(h.db)).toMatchObject({ last_edge_seq: '2', acked_edge_seq: '2' });
  });

  it('aucun ordre à verser : aucun lot vide n’est jamais envoyé', async () => {
    h.central.script = (request) => acceptAll(request);
    await h.drain.runOnce();
    await h.drain.runOnce();
    expect(submissions()).toHaveLength(0);
    expect(await batches(h.db)).toEqual([]);
    // Ordre déjà versé : rien non plus.
    await addOrder();
    await h.drain.runOnce();
    await h.drain.runOnce();
    expect(submissions()).toHaveLength(1);
  });

  it('ordre mal formé (non versable) : aucun lot', async () => {
    await h.db.pool.query(
      `INSERT INTO edge_audit (kind, actor, detail) VALUES ('SITE_ORDER_ACCEPTED', 'x', $1)`,
      [JSON.stringify({ order_kind: 'PURGE', holders: ['seul'], order_sha256: 'zz' })],
    );
    await h.drain.runOnce();
    expect(submissions()).toHaveLength(0);
  });

  it('lien coupé : le même lot repart à l’identique, aucun ordre perdu', async () => {
    await addOrder();
    h.central.script = () => ({ destroy: true });
    await h.drain.runOnce();
    h.central.script = (request) => acceptAll(request);
    await h.drain.runOnce();
    const [first, again] = submissions();
    expect(again).toEqual(first);
    expect(await pendingOrders()).toBe(0);
  });

  it('refus du central : lot clos sans bloquer les ventes, ordre gardé, pas de boucle (60 s)', async () => {
    await addOrder();
    h.central.script = () => ({ status: 409, body: { code: 'STALE_AUTHORITY_EPOCH' } });
    await h.drain.runOnce();
    expect(submissions()).toHaveLength(1);
    expect((await batches(h.db))[0]).toMatchObject({ status: 'DONE', done_reason: 'SUPERSEDED' });
    expect(await pendingOrders()).toBe(1);
    expect(await auditKinds(h.db)).toContain('DRAIN_ORDERS_ONLY_REFUSED');
    // Pas de nouvelle tentative immédiate ; une vente repart aussitôt (l'ordre l'accompagne).
    await h.drain.runOnce();
    expect(submissions()).toHaveLength(1);
    await h.add(1);
    h.central.script = (request) => acceptAll(request);
    await h.drain.runOnce();
    expect(submissions()).toHaveLength(2);
    expect(submissions()[1]).toMatchObject({ edge_seq_from: 1, edge_seq_to: 1 });
    expect(submissions()[1]!.local_orders).toHaveLength(1);
    expect(await pendingOrders()).toBe(0);
  });

  it('refus puis délai écoulé : nouvelle tentative, sous un lot neuf', async () => {
    await addOrder();
    h.central.script = () => ({ status: 409, body: { code: 'SEQ_OUT_OF_ORDER' } });
    await h.drain.runOnce();
    h.clock.advance(61_000);
    h.central.script = (request) => acceptAll(request);
    await h.drain.runOnce();
    const [one, two] = submissions();
    expect(two!.batch_id).not.toBe(one!.batch_id);
    expect(await pendingOrders()).toBe(0);
  });
});
