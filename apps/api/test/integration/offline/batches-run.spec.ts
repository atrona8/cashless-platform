// Boucle du lot (lot WP18, T074) : 500 opérations dans l'ordre, TOPUP_CASH jamais exécuté, trace RETRY, réponse.
import { ownerRows } from '../../support/media-fixtures';
import {
  batchRow,
  countRows,
  purchase,
  startBatchWorld,
  type BatchWorld,
} from '../../support/batches-world';
import type { TestTerminal } from '../../support/test-terminal';

jest.setTimeout(120_000);

describe('boucle de traitement d’un lot', () => {
  let world: BatchWorld;
  let t: TestTerminal;
  const submit = (b: ReturnType<TestTerminal['buildBatch']>) =>
    t.submitBatch(world.api.baseUrl, world.api.tls.serverCaPem, b);
  const ledgerId = () => world.w.ids.ledgerA;

  beforeAll(async () => {
    world = await startBatchWorld();
  });
  afterAll(async () => {
    await world?.close();
  });
  beforeEach(async () => {
    world.fake.reset();
    t = await world.enrolled();
  });

  it('500 opérations traitées dans l’ordre des numéros, lot COMPLETED', async () => {
    const b = t.buildBatch(
      Array.from({ length: 500 }, (_, i) => purchase(i)),
      { ledgerId: ledgerId() },
    );
    const res = await submit(b);
    expect(res.status).toBe(200);
    expect(world.fake.calls.map((c) => Number(c.seq))).toEqual(
      Array.from({ length: 500 }, (_, i) => i + 1),
    );
    const results = res.body.results as Array<{ seq: number }>;
    expect(results.map((r) => r.seq)).toEqual(world.fake.calls.map((c) => Number(c.seq)));
    expect(res.body.contiguous_acked_seq).toBe(500);
    expect(res.body.missing_seqs).toEqual([]);
    expect(res.body.abandoned).toBe(false);
    expect((await batchRow(String(b.header.batch_id)))?.status).toBe('COMPLETED');
    expect(res.headers['idempotency-replayed']).toBeUndefined();
  });

  it('renvoi d’un lot COMPLETED : 200 rejoué, mêmes octets, aucun nouvel appel', async () => {
    const b = t.buildBatch([purchase(0), purchase(1)], { ledgerId: ledgerId() });
    const first = await submit(b);
    const callsOf = () => world.fake.calls.filter((c) => c.batchId === b.header.batch_id).length;
    const calls = callsOf();
    const again = await submit(b);
    expect(again.status).toBe(200);
    expect(again.headers['idempotency-replayed']).toBe('true');
    expect(callsOf()).toBe(calls);
    const strip = (r: typeof first) => JSON.stringify((r.body as { results: unknown }).results);
    expect(strip(again)).toBe(strip(first));
  });

  it('TOPUP_CASH : transmis au processeur, rejeté, aucune écriture comptable', async () => {
    const b = t.buildBatch(
      [
        {
          type: 'TOPUP_CASH',
          occurred_at: new Date().toISOString(),
          amount: 5000,
          currency: 'XOF',
        },
      ],
      { ledgerId: ledgerId() },
    );
    const res = await submit(b);
    const [r] = res.body.results as Array<Record<string, unknown>>;
    expect([r!.status, r!.reject_reason, r!.effect]).toEqual([
      'REJECTED',
      'OFFLINE_NOT_ALLOWED',
      'NONE',
    ]);
    const tx = await ownerRows<{ n: string }>(
      `SELECT count(*) AS n FROM journal_transaction WHERE device_id = $1`,
      [t.deviceId],
    );
    expect(Number(tx[0]!.n)).toBe(0);
  });

  it('INSUFFICIENT_FUNDS_RETRY : trace RETRY, lot clos, numéro dans missing_seqs, retryable', async () => {
    world.fake.reset({ retrySeqs: [2n] });
    const b = t.buildBatch([purchase(0), purchase(1), purchase(2)], { ledgerId: ledgerId() });
    const res = await submit(b);
    expect(res.status).toBe(200);
    const results = res.body.results as Array<Record<string, unknown>>;
    expect(results.find((r) => r.seq === 2)).toMatchObject({
      reject_reason: 'INSUFFICIENT_FUNDS_RETRY',
      retryable: true,
    });
    expect(results.filter((r) => r.retryable === true)).toHaveLength(1);
    expect(await countRows('offline_batch_retry', String(b.header.batch_id))).toBe(1);
    expect(res.body.contiguous_acked_seq).toBe(1);
    expect(res.body.missing_seqs).toContain(2);
    expect((await batchRow(String(b.header.batch_id)))?.status).toBe('COMPLETED');
  });

  it('réponse conforme au contrat', async () => {
    const { contractViolations } = await import('../../support/contract-schema');
    const res = await submit(t.buildBatch([purchase(0)], { ledgerId: ledgerId() }));
    expect(contractViolations('OfflineBatchResult', res.body)).toEqual([]);
  });

  it('trou avant le lot : traité quand même, missing_seqs rendu', async () => {
    const b = t.buildBatch([purchase(0), purchase(1)], { ledgerId: ledgerId(), fromSeq: 4 });
    const res = await submit(b);
    expect(res.status).toBe(200);
    expect(res.body.missing_seqs).toEqual([1, 2, 3]);
    expect(res.body.contiguous_acked_seq).toBe(0);
  });

  it('lot abandonné pendant le traitement (processeur factice) : arrêt après l’opération 2, abandoned: true', async () => {
    const b = t.buildBatch(
      Array.from({ length: 5 }, (_, i) => purchase(i)),
      { ledgerId: ledgerId() },
    );
    const real = world.fake.process.bind(world.fake);
    const spy = jest.spyOn(world.fake, 'process').mockImplementation(async (ctx, op) => {
      const result = await real(ctx, op);
      if (op.seq === 2n)
        await ownerRows(
          `UPDATE offline_batch SET status = 'REJECTED', reject_reason = 'ABANDONED'
            WHERE id = $1 AND status = 'PROCESSING'`,
          [ctx.batchId],
        );
      return result;
    });
    let res: Awaited<ReturnType<typeof submit>>;
    try {
      res = await submit(b);
    } finally {
      spy.mockRestore();
    }
    expect(res.status).toBe(200);
    expect(res.body.abandoned).toBe(true);
    expect((res.body.results as Array<{ seq: number }>).map((r) => r.seq)).toEqual([1, 2]);
    const batchId = String(b.header.batch_id);
    expect(await batchRow(batchId)).toMatchObject({ status: 'REJECTED' });
    const stored = await ownerRows<{ seq: string }>(
      'SELECT seq::text FROM offline_op_result WHERE batch_id = $1 ORDER BY seq',
      [batchId],
    );
    expect(stored.map((r) => r.seq)).toEqual(['1', '2']);
    const registry = await ownerRows<{ seq: string }>(
      'SELECT seq::text FROM device_seq_registry WHERE device_id = $1 ORDER BY seq',
      [t.deviceId],
    );
    expect(registry.map((r) => r.seq)).toEqual(['1', '2']);
  });
});
