// A29 : un lot abandonné ne se relit pas. Les résultats partiels sont appliqués, le reste repart
// sous un NOUVEAU batch_id depuis le premier numéro sans résultat ; jamais le même en boucle.
import {
  acceptAll,
  batches,
  head,
  makeQueueHarness,
  ops,
  type QueueHarness,
} from './_support/queue-harness';

let h: QueueHarness;
beforeEach(async () => {
  h = await makeQueueHarness();
});
afterEach(async () => {
  await h.close();
});

const sent = (): Array<Record<string, any>> =>
  h.central.requests.filter((r) => r.path === '/edge/sync-batches').map((r) => r.body as any);

function partial(request: Parameters<typeof acceptAll>[0], keep: number) {
  const reply = acceptAll(request, {}, { abandoned: true });
  (reply.body as any).results = (reply.body as any).results.slice(0, keep);
  return reply;
}

describe('lot abandonné', () => {
  it('nouveau batch_id, edge_seq_from = premier numéro sans résultat, puis fin normale', async () => {
    await h.add(6);
    h.central.script = (request, index) => (index === 0 ? partial(request, 3) : acceptAll(request));
    expect((await h.drain.runOnce()).sent).toBe(3);
    expect((await ops(h.db)).map((o) => o.central_status)).toEqual([
      'ACCEPTED',
      'ACCEPTED',
      'ACCEPTED',
      'SENT',
      'SENT',
      'SENT',
    ]);
    expect((await head(h.db)).acked_edge_seq).toBe('3');
    const [first] = await batches(h.db);
    expect([first!.status, first!.done_reason]).toEqual(['DONE', 'RESULTS']);

    expect((await h.drain.runOnce()).sent).toBe(3);
    const [one, two] = sent();
    expect(two!.batch_id).not.toBe(one!.batch_id);
    expect([two!.edge_seq_from, two!.edge_seq_to]).toEqual([4, 6]);
    expect(two!.prev_chain_hash).toBe(
      Buffer.from((await ops(h.db))[2]!.chain_hash).toString('hex'),
    );
    expect((await ops(h.db)).every((o) => o.central_status === 'ACCEPTED')).toBe(true);
    expect((await head(h.db)).acked_edge_seq).toBe('6');
  });

  it('abandon répété sans aucun résultat : un nouveau batch_id à chaque passe, jamais le même', async () => {
    await h.add(3);
    h.central.script = (request) => partial(request, 0);
    for (let i = 0; i < 5; i += 1) await h.drain.runOnce();
    const ids = sent().map((b) => b.batch_id);
    expect(ids).toHaveLength(5);
    expect(new Set(ids).size).toBe(5);
    expect(sent().every((b) => b.edge_seq_from === 1)).toBe(true);
    expect((await batches(h.db)).every((b) => b.status === 'DONE')).toBe(true);
    // Aucune opération perdue ni réécrite.
    expect((await ops(h.db)).map((o) => o.edge_seq)).toEqual(['1', '2', '3']);
  });
});
