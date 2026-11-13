// T089 : `EdgeQueue.append` (NFR-004, B.7-1, B.7-2).
import { chainStep, edgeChainGenesis, edgeContentSha256 } from '@cashless/shared-rules';
import { EdgeQueue, QueueError } from '../../src/queue/edge-queue';
import {
  DEVICE_ID,
  head,
  makeQueueHarness,
  ops,
  purchase,
  SERIAL,
  type QueueHarness,
} from './_support/queue-harness';

let h: QueueHarness;
beforeEach(async () => {
  h = await makeQueueHarness();
});
afterEach(async () => {
  await h.close();
});

describe('append', () => {
  it('50 appels concurrents : numéros 1..50 continus, chaîne égale à la recomputation', async () => {
    await Promise.all(Array.from({ length: 50 }, (_, i) => h.addOp(purchase(i + 1), [])));
    const rows = await ops(h.db);
    expect(rows.map((r) => Number(r.edge_seq))).toEqual(
      Array.from({ length: 50 }, (_, i) => i + 1),
    );
    let previous = edgeChainGenesis(h.gatewayId);
    for (const row of rows) {
      const content = edgeContentSha256(row.operation);
      expect(Buffer.from(row.content_sha256).equals(content)).toBe(true);
      previous = chainStep(previous, content);
      expect(Buffer.from(row.chain_hash).equals(previous)).toBe(true);
      // EDGE_ONLINE : le chain_hash de l'opération envoyée est celui de la passerelle.
      expect(row.operation.chain_hash).toBe(previous.toString('hex'));
      expect(row.operation.edge_seq).toBe(Number(row.edge_seq));
    }
    const state = await head(h.db);
    expect(Number(state.last_edge_seq)).toBe(50);
    expect(Buffer.from(state.last_chain_hash).equals(previous)).toBe(true);
  });

  it('deux transactions concurrentes ne prennent jamais le même numéro', async () => {
    const a = await h.db.pool.connect();
    const b = await h.db.pool.connect();
    try {
      await a.query('BEGIN');
      await b.query('BEGIN');
      const first = h.queue.append(a, purchase(1), []);
      await first;
      // `b` attend le verrou de ligne de `a` : son append ne rend rien avant le COMMIT de `a`.
      let second: ReturnType<EdgeQueue['append']> | null = h.queue.append(b, purchase(2), []);
      let settled = false;
      void second.then(() => (settled = true));
      await new Promise((r) => setTimeout(r, 400));
      expect(settled).toBe(false);
      await a.query('COMMIT');
      const row = await second;
      second = null;
      expect(row.edgeSeq).toBe(2);
      await b.query('COMMIT');
    } finally {
      a.release();
      b.release();
    }
    expect((await ops(h.db)).map((r) => Number(r.edge_seq))).toEqual([1, 2]);
  });

  it('un ROLLBACK après append ne laisse aucun trou : le numéro est réutilisé', async () => {
    await h.addOp(purchase(1));
    await expect(
      h.tx.run(async (tx) => {
        const row = await h.queue.append(tx, purchase(2), []);
        expect(row.edgeSeq).toBe(2);
        throw new Error('échec après append');
      }),
    ).rejects.toThrow('échec après append');
    // Rien n'a été commité par append : ni opération, ni avance de la tête.
    expect((await ops(h.db)).length).toBe(1);
    expect(Number((await head(h.db)).last_edge_seq)).toBe(1);
    expect(await h.addOp(purchase(2))).toBe(2);
  });

  it('append n’ouvre ni ne commite aucune transaction', async () => {
    const seen: string[] = [];
    await h.tx.run(async (tx) => {
      const spy = {
        query: (text: string, values?: unknown[]) => {
          seen.push(text.trim().split(/\s+/)[0]!.toUpperCase());
          return tx.query(text, values);
        },
      } as typeof tx;
      await h.queue.append(spy, purchase(1), []);
    });
    expect(seen).not.toContain('BEGIN');
    expect(seen).not.toContain('COMMIT');
    expect(seen).not.toContain('ROLLBACK');
    expect(seen).not.toContain('SAVEPOINT');
  });

  it('modification ou suppression d’une ligne refusée par la base', async () => {
    await h.addOp(purchase(1));
    const pool = h.db.pool;
    await expect(pool.query("UPDATE edge_op SET device_serial = 'AUTRE'")).rejects.toThrow(
      /non modifiable/,
    );
    await expect(pool.query("UPDATE edge_op SET operation = '{}'::jsonb")).rejects.toThrow(
      /non modifiable/,
    );
    await expect(pool.query('DELETE FROM edge_op')).rejects.toThrow(/interdit/);
    await expect(pool.query('TRUNCATE edge_op CASCADE')).rejects.toThrow(/interdit/);
    expect((await ops(h.db)).length).toBe(1);
  });

  it('refus sans rien écrire : clé d’origine déjà présente, absente, mode incohérent', async () => {
    await h.addOp(purchase(1));
    await expect(h.addOp(purchase(1))).rejects.toMatchObject({ code: 'ORIGIN_KEY_EXISTS' });
    await expect(h.addOp({ ...purchase(2), originKey: '' })).rejects.toBeInstanceOf(QueueError);
    await expect(
      h.addOp({ ...purchase(3), authorizedMode: 'DEVICE_OFFLINE' }),
    ).rejects.toMatchObject({ code: 'INVALID_OPERATION' });
    await expect(
      h.addOp({
        ...purchase(4),
        operation: { ...purchase(4).operation, edge_seq: 99 },
      }),
    ).rejects.toMatchObject({ code: 'INVALID_OPERATION' });
    expect((await ops(h.db)).length).toBe(1);
    expect(Number((await head(h.db)).last_edge_seq)).toBe(1);
  });

  it('edge_seq ou delta hors des entiers sûrs : refus, rien d’écrit', async () => {
    await expect(
      h.addOp(purchase(1), [
        { walletId: 'a0000000-0000-4000-8000-000000000001', paidDelta: 2n ** 53n, promoDelta: 0n },
      ]),
    ).rejects.toMatchObject({ code: 'DELTA_OUT_OF_RANGE' });
    const writes: string[] = [];
    const stub = {
      query: async (text: string) => {
        writes.push(text);
        // La clé d'origine est lue avant le verrou de la tête (aucune ligne), puis la tête.
        if (text.includes('origin_key')) return { rows: [], rowCount: 0 };
        return {
          rows: [{ last_edge_seq: String(2n ** 53n - 1n), last_chain_hash: Buffer.alloc(32) }],
          rowCount: 1,
        };
      },
    } as never;
    await expect(h.queue.append(stub, purchase(1), [])).rejects.toMatchObject({
      code: 'SEQ_OUT_OF_RANGE',
    });
    expect(writes.some((w) => /^\s*(INSERT|UPDATE)/.test(w))).toBe(false);
    expect((await ops(h.db)).length).toBe(0);
  });

  it('VOID consomme son numéro ; DEVICE_OFFLINE exige un maillon de terminal et son lot', async () => {
    await h.addOp(purchase(1));
    const voidSeq = await h.addOp({
      ...purchase(2),
      type: 'VOID',
      operation: {
        seq: 2,
        type: 'VOID',
        occurred_at: '2026-12-12T08:02:00Z',
        void_reason: 'TERMINAL_ERROR',
      },
    });
    expect(voidSeq).toBe(2);
    await expect(
      h.addOp({ ...purchase(3), type: 'VOID', operation: { seq: 3, type: 'VOID' } }),
    ).rejects.toMatchObject({ code: 'INVALID_OPERATION' });
    const batchId = '3b9f0c52-7a1e-4d68-9c24-5e8a1f7b6d30';
    await h.db.pool.query(
      `INSERT INTO edge_device_batch (device_batch_id, device_id, header, signature)
       VALUES ($1, $2, '{}', '\\x01')`,
      [batchId, DEVICE_ID],
    );
    const offline = {
      ...purchase(3),
      authorizedMode: 'DEVICE_OFFLINE' as const,
      deviceBatchId: batchId,
    };
    await expect(h.addOp(offline)).rejects.toMatchObject({ code: 'INVALID_OPERATION' });
    const link = 'ab'.repeat(32);
    const seq = await h.addOp({
      ...offline,
      operation: { ...offline.operation, chain_hash: link },
    });
    expect(seq).toBe(3);
    const row = (await ops(h.db))[2]!;
    // Maillon du terminal dans l'opération, maillon de la passerelle dans la colonne.
    expect(row.operation.chain_hash).toBe(link);
    expect(Buffer.from(row.chain_hash).toString('hex')).not.toBe(link);
    expect(row.operation.device_batch_id).toBe(batchId);
    expect(SERIAL).toBe(row.device_serial);
  });

  it('deltas écrits avec l’opération', async () => {
    const wallet = 'a0000000-0000-4000-8000-000000000001';
    await h.addOp(purchase(1), [{ walletId: wallet, paidDelta: -100n, promoDelta: -20n }]);
    const { rows } = await h.db.pool.query('SELECT * FROM edge_op_delta');
    expect(rows).toHaveLength(1);
    expect([rows[0].paid_delta, rows[0].promo_delta]).toEqual(['-100', '-20']);
    await expect(
      h.addOp(purchase(2), [
        { walletId: wallet, paidDelta: 1n, promoDelta: 0n },
        { walletId: wallet, paidDelta: 1n, promoDelta: 0n },
      ]),
    ).rejects.toMatchObject({ code: 'INVALID_OPERATION' });
  });
});
