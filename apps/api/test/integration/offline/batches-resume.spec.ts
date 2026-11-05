// Reprise, verrou et pool (lot WP18, T074 ; NFR-002, NFR-013) : coupure au milieu d'un lot, envois concurrents,
// pool plein, verrou relâché après une panne.
process.env.OFFLINE_BATCH_POOL_SIZE = '2';

import { ownerRows } from '../../support/media-fixtures';
import { batchRow, purchase, startBatchWorld, type BatchWorld } from '../../support/batches-world';
import type { TestTerminal } from '../../support/test-terminal';

jest.setTimeout(120_000);

describe('reprise et concurrence des lots', () => {
  let world: BatchWorld;
  const send = (t: TestTerminal, b: ReturnType<TestTerminal['buildBatch']>) =>
    t.submitBatch(world.api.baseUrl, world.api.tls.serverCaPem, b);
  const ledger = () => world.w.ids.ledgerA;
  const callsOf = (id: unknown) => world.fake.calls.filter((c) => c.batchId === id);

  beforeAll(async () => {
    world = await startBatchWorld();
  });
  afterAll(async () => {
    await world?.close();
    delete process.env.OFFLINE_BATCH_POOL_SIZE;
  });
  beforeEach(() => world.fake.reset());

  it('coupure à l’opération 251 sur 500 puis renvoi : 250 appels de plus, jamais 500, mêmes octets', async () => {
    const t = await world.enrolled();
    const b = t.buildBatch(
      Array.from({ length: 500 }, (_, i) => purchase(i)),
      { ledgerId: ledger() },
    );
    world.fake.reset({ failAt: 251n, failOnce: true });
    const cut = await send(t, b);
    expect(cut.status).toBe(500);
    expect((await batchRow(String(b.header.batch_id)))?.status).toBe('PROCESSING');
    expect(callsOf(b.header.batch_id)).toHaveLength(251);
    const done = await ownerRows<{ n: string }>(
      'SELECT count(*) AS n FROM offline_op_result WHERE batch_id = $1',
      [b.header.batch_id],
    );
    expect(Number(done[0]!.n)).toBe(250);
    const resumed = await send(t, b);
    expect(resumed.status).toBe(200);
    // 251 appels avant, 250 de plus (251 à 500) : chaque numéro 1..250 traité une seule fois.
    expect(callsOf(b.header.batch_id)).toHaveLength(251 + 250);
    const seen = callsOf(b.header.batch_id).map((c) => Number(c.seq));
    expect(seen.filter((s) => s <= 250)).toHaveLength(250);
    const reg = await ownerRows<{ n: string }>(
      'SELECT count(*) AS n FROM device_seq_registry WHERE device_id = $1',
      [t.deviceId],
    );
    expect(Number(reg[0]!.n)).toBe(500);
    // Mêmes octets que le résultat mémorisé relu par GET.
    const get = await t.request(world.api.baseUrl, world.api.tls.serverCaPem, {
      method: 'GET',
      path: `/offline-batches/${b.header.batch_id}`,
    });
    const results = (r: { body: Record<string, unknown> }) => JSON.stringify(r.body.results);
    expect(results(get)).toBe(results(resumed));
    const replay = await send(t, b);
    expect(replay.headers['idempotency-replayed']).toBe('true');
    expect(results(replay)).toBe(results(resumed));
  });

  it('verrou relâché après une panne : le lot suivant du terminal n’est pas bloqué', async () => {
    const t = await world.enrolled();
    const b1 = t.buildBatch([purchase(0), purchase(1)], { ledgerId: ledger() });
    world.fake.reset({ failAt: 2n, failOnce: true });
    expect((await send(t, b1)).status).toBe(500);
    // Même lot renvoyé : le verrou est libre, la reprise a lieu.
    expect((await send(t, b1)).status).toBe(200);
  });

  it('envois concurrents du même lot : un seul traite, les autres 409 BATCH_IN_PROGRESS ou 200 rejoué', async () => {
    const t = await world.enrolled();
    const b = t.buildBatch(
      Array.from({ length: 20 }, (_, i) => purchase(i)),
      { ledgerId: ledger() },
    );
    let open!: () => void;
    world.fake.reset({ gate: new Promise<void>((r) => (open = r)) });
    const first = send(t, b);
    await new Promise((r) => setTimeout(r, 500));
    const others = await Promise.all([1, 2].map(() => send(t, b)));
    for (const o of others) {
      expect([o.status, o.body.code]).toEqual([409, 'BATCH_IN_PROGRESS']);
      expect(o.headers['retry-after']).toBe('2');
    }
    open();
    expect((await first).status).toBe(200);
    expect(callsOf(b.header.batch_id)).toHaveLength(20);
  });

  it('deux lots d’un même terminal : le second est refusé tant que le premier est en cours', async () => {
    const t = await world.enrolled();
    const b1 = t.buildBatch([purchase(0)], { ledgerId: ledger() });
    const b2 = t.buildBatch([purchase(1)], { ledgerId: ledger() });
    let open!: () => void;
    world.fake.reset({ gate: new Promise<void>((r) => (open = r)) });
    const first = send(t, b1);
    await new Promise((r) => setTimeout(r, 500));
    const second = await send(t, b2);
    expect([second.status, second.body.code]).toEqual([409, 'BATCH_IN_PROGRESS']);
    open();
    expect((await first).status).toBe(200);
  });

  it('pool plein (2 verrous) : 503 + Retry-After 5, lot non ouvert, puis rétabli', async () => {
    const ts = await Promise.all([world.enrolled(), world.enrolled(), world.enrolled()]);
    const bs = ts.map((t) => t.buildBatch([purchase(0)], { ledgerId: ledger() }));
    let open!: () => void;
    world.fake.reset({ gate: new Promise<void>((r) => (open = r)) });
    const held = [send(ts[0]!, bs[0]!), send(ts[1]!, bs[1]!)];
    await new Promise((r) => setTimeout(r, 800));
    const started = Date.now();
    const full = await send(ts[2]!, bs[2]!);
    expect([full.status, full.body.code]).toEqual([503, 'SERVICE_UNAVAILABLE']);
    expect(full.headers['retry-after']).toBe('5');
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(await batchRow(String(bs[2]!.header.batch_id))).toBeUndefined();
    open();
    expect((await Promise.all(held)).map((r) => r.status)).toEqual([200, 200]);
    expect((await send(ts[2]!, bs[2]!)).status).toBe(200);
  });
});
