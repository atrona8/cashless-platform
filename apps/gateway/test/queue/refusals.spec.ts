// T090 : refus du central. EDGE_NOT_CAUGHT_UP, SEQ_OUT_OF_ORDER, CHAIN_BROKEN, révocation, époque.
import {
  acceptAll,
  auditKinds,
  batches,
  makeQueueHarness,
  ops,
  type QueueHarness,
} from './_support/queue-harness';
import type { Loose } from '../support/loose';

let h: QueueHarness;
beforeEach(async () => {
  h = await makeQueueHarness();
});
afterEach(async () => {
  await h.close();
});

const sent = (): Array<Record<string, Loose>> =>
  h.central.requests.filter((r) => r.path === '/edge/sync-batches').map((r) => r.body as Loose);

describe('refus du central', () => {
  it('EDGE_NOT_CAUGHT_UP reprend depuis missing_edge_seqs, dans un nouveau lot', async () => {
    await h.add(5);
    h.central.script = (request, index) =>
      index === 0
        ? { status: 409, body: { code: 'EDGE_NOT_CAUGHT_UP', missing_edge_seqs: [3, 4] } }
        : acceptAll(request);
    expect((await h.drain.runOnce()).sent).toBe(0);
    expect((await batches(h.db))[0]!.done_reason).toBe('SUPERSEDED');
    expect((await ops(h.db)).map((o) => o.central_status)).toEqual(Array(5).fill('SENT'));
    // Le premier numéro sans résultat est 1 : le lot repart de là (3 y est compris), id neuf.
    await h.drain.runOnce();
    const [one, two] = sent();
    expect(two!.batch_id).not.toBe(one!.batch_id);
    expect(two!.edge_seq_from).toBe(1);
    expect((await ops(h.db)).every((o) => o.central_status === 'ACCEPTED')).toBe(true);
  });

  it('missing_edge_seqs signalés par le rendu : le lot repart du plus petit, résolus compris', async () => {
    await h.add(5);
    h.central.script = (request) => acceptAll(request);
    await h.drain.runOnce();
    h.drain.requestDrain({ missingEdgeSeqs: [4, 3] });
    h.central.script = (request) => acceptAll(request, {}, { missing_seqs: [] });
    await h.drain.runOnce();
    const second = sent()[1]!;
    expect([second.edge_seq_from, second.edge_seq_to]).toEqual([3, 5]);
    // Les opérations déjà ACCEPTED ne sont pas touchées (le central les rend en ACCEPTED/DUPLICATE).
    expect((await ops(h.db)).every((o) => o.central_status === 'ACCEPTED')).toBe(true);
  });

  it('SEQ_OUT_OF_ORDER reconstruit un lot neuf ; trois fois de suite arrête', async () => {
    await h.add(3);
    h.central.script = () => ({ status: 409, body: { code: 'SEQ_OUT_OF_ORDER' } });
    await h.drain.runOnce();
    await h.drain.runOnce();
    await h.drain.runOnce();
    const ids = sent().map((b) => b.batch_id);
    expect(new Set(ids).size).toBe(3);
    expect(await auditKinds(h.db)).toContain('DRAIN_HALTED');
    const before = sent().length;
    await h.drain.runOnce();
    expect(sent().length).toBe(before); // arrêté
  });

  it('CHAIN_BROKEN arrête le vidage, alerte, aucune réécriture de la file', async () => {
    await h.add(3);
    const snapshot = JSON.stringify(
      (await ops(h.db)).map((o) => [o.edge_seq, o.operation, o.content_sha256, o.chain_hash]),
    );
    h.central.script = () => ({ status: 409, body: { code: 'CHAIN_BROKEN' } });
    await h.drain.runOnce();
    const count = sent().length;
    await h.drain.runOnce();
    await h.drain.runOnce();
    expect(sent().length).toBe(count);
    const audit = await h.db.pool.query(
      "SELECT detail FROM edge_audit WHERE kind = 'DRAIN_HALTED'",
    );
    expect(audit.rows[0].detail.reason).toBe('CHAIN_BROKEN');
    expect(
      JSON.stringify(
        (await ops(h.db)).map((o) => [o.edge_seq, o.operation, o.content_sha256, o.chain_hash]),
      ),
    ).toBe(snapshot);
    // Après un redémarrage (nouvelle instance), l'arrêt persiste.
    const { DrainService } = await import('../../src/queue/drain.service');
    const fresh = new DrainService(h.tx, (h.drain as Loose).client, h.keystore, h.clock);
    await fresh.runOnce();
    expect(sent().length).toBe(count);
  });

  it('BATCH_SIGNATURE_INVALID arrête aussi (rien n’est re-signé)', async () => {
    await h.add(1);
    h.central.script = () => ({ status: 400, body: { code: 'BATCH_SIGNATURE_INVALID' } });
    await h.drain.runOnce();
    await h.drain.runOnce();
    expect(sent()).toHaveLength(1);
  });

  it('certificat refusé (401) : le crochet de révocation est appelé, le lot reste', async () => {
    await h.add(1);
    let revoked = 0;
    h.drain.bindHooks({ onCertificateRejected: async () => void (revoked += 1) });
    h.central.script = () => ({ status: 401, body: { code: 'UNAUTHENTICATED' } });
    await h.drain.runOnce();
    expect(revoked).toBe(1);
    expect((await batches(h.db))[0]!.status).toBe('SENT');
  });

  it('STALE_AUTHORITY_EPOCH : le lot reste, l’époque rendue par le central est signalée', async () => {
    await h.add(1);
    const seen: number[] = [];
    h.drain.bindHooks({ onCentralEpoch: async (epoch) => void seen.push(epoch) });
    h.central.script = () => ({
      status: 409,
      body: { code: 'STALE_AUTHORITY_EPOCH', authority_epoch: 7 },
    });
    await h.drain.runOnce();
    expect(seen).toEqual([7]);
    expect(await auditKinds(h.db)).toContain('DRAIN_REFUSED');
    expect((await ops(h.db))[0]!.central_status).toBe('SENT');
  });

  it('code inconnu du central : jamais pris pour un succès', async () => {
    await h.add(1);
    h.central.script = () => ({ status: 500, body: { code: 'BOUM' } });
    expect((await h.drain.runOnce()).sent).toBe(0);
    expect((await ops(h.db))[0]!.central_status).toBe('SENT');
  });
});
