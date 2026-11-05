/* eslint-disable @typescript-eslint/no-explicit-any -- processeur du module remplacé le temps d'un essai */
// Concurrence des lots hors ligne (lot WP21, T089 ; NFR-001, NFR-011, NFR-013 ; FR-044), route réelle, vrai processeur :
//   - 100 rejeux simultanés d'un même lot : une écriture par opération, mêmes octets, connexions de l'API bornées ;
//   - 50 envois simultanés d'un même terminal : un seul traité, les 49 autres refusés `BATCH_IN_PROGRESS` ;
//   - pool de verrous de lots plein (`OFFLINE_BATCH_POOL_SIZE` réduit) : réponse définie en moins de 5 s, aucune écriture
//     partielle, aucune attente infinie.
// Suite lourde (jusqu'à 100 requêtes simultanées) : écartée de la passe parallèle (`SKIP_LATENCY`), lancée seule.
import 'reflect-metadata';
import { Client } from 'pg';
import { OFFLINE_OPERATION_PROCESSOR } from '../../../src/offline/batches/batch.types';
import { OWNER_URL } from '../../support/db';
import { ownerRows } from '../../support/media-fixtures';
import { settleClock, sleep } from '../../support/offline-dataset';
import { ProcessingWorld, type OfflineTerminal } from '../offline/processing-fixtures';

jest.setTimeout(600_000);

/** Remplace `process` du vrai processeur par un barrage (ouvert plus tard) ; rend l'ouverture et la remise en état. */
function gateProcessor(world: ProcessingWorld) {
  const proc: any = world.pw.api.app.get(OFFLINE_OPERATION_PROCESSOR, { strict: false });
  const original = proc.process.bind(proc);
  let open!: () => void;
  const gate = new Promise<void>((resolve) => (open = resolve));
  proc.process = async (ctx: unknown, op: unknown) => {
    await gate;
    return original(ctx, op);
  };
  return { open, restore: () => (proc.process = original) };
}

/** Plus grand nombre de connexions de la base du test observé pendant `fn`. */
async function peakConnections<T>(fn: () => Promise<T>): Promise<{ result: T; peak: number }> {
  const probe = new Client({ connectionString: OWNER_URL });
  await probe.connect();
  let peak = 0;
  let running = true;
  const loop = (async () => {
    while (running) {
      const { rows } = await probe.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database()',
      );
      peak = Math.max(peak, rows[0]!.n);
      await sleep(40);
    }
  })();
  try {
    return { result: await fn(), peak };
  } finally {
    running = false;
    await loop;
    await probe.end();
  }
}

describe('NFR-001, NFR-013 : rejeux et envois concurrents (pool de verrous de 20)', () => {
  let world: ProcessingWorld;
  beforeAll(async () => {
    world = await ProcessingWorld.create();
  });
  afterAll(async () => {
    await world?.close();
  });
  const prepare = async (funds = 100_000) => {
    const t = await world.terminal();
    const media = await world.pw.media(1, funds);
    await settleClock();
    const version = await world.snapshot(t, media);
    return { t, m: media[0]!, version };
  };
  const send = (t: OfflineTerminal, batch: ReturnType<OfflineTerminal['t']['buildBatch']>) =>
    t.t.submitBatch(world.pw.api.baseUrl, world.pw.api.tls.serverCaPem, batch);

  it('100 rejeux simultanés du même lot : une écriture par opération, mêmes octets, connexions ≤ 100 (NFR-001)', async () => {
    const { t, m, version } = await prepare();
    const ops = [1000, 2000, 3000, 4000, 5000].map((a) => world.sale(t, m, a, version));
    const first = await world.submit(t, ops);
    const reference = JSON.stringify(first.body.results);
    const { result: burst, peak } = await peakConnections(() =>
      Promise.all(Array.from({ length: 100 }, () => send(t, first.batch))),
    );
    const statuses = burst.map((r) => r.status);
    // Réponses définies seulement : rejeu identique, lot en cours, pool de verrous plein.
    expect(statuses.every((s) => s === 200 || s === 409 || s === 503)).toBe(true);
    for (const r of burst.filter((x) => x.status === 200))
      expect(JSON.stringify(r.body.results)).toBe(reference);
    expect(burst.filter((x) => x.status === 200).length).toBeGreaterThan(0);
    process.stdout.write(
      `CONCURRENCE rejeux 100 : ${JSON.stringify({
        '200': statuses.filter((s) => s === 200).length,
        '409': statuses.filter((s) => s === 409).length,
        '503': statuses.filter((s) => s === 503).length,
        connexions_max: peak,
      })}\n`,
    );
    expect(peak).toBeLessThanOrEqual(100);
    const written = await world.txRows(t.t.deviceId);
    expect(written).toHaveLength(5);
    expect(await world.pw.registry(t.t.deviceId)).toHaveLength(5);
    expect(await world.spendable(m.walletId)).toBe(85_000);
    const results = await ownerRows<{ n: number }>(
      'SELECT count(*)::int AS n FROM offline_op_result WHERE batch_id = $1',
      [first.batch.header.batch_id],
    );
    expect(results[0]!.n).toBe(5);
  });

  it('50 envois simultanés d’un même terminal : un seul traité, les 49 autres BATCH_IN_PROGRESS (NFR-013)', async () => {
    const { t, m, version } = await prepare();
    // 50 lots distincts qui commencent au même numéro, de la même pointe de chaîne : ils se disputent le terminal.
    const saved = { next: t.t.nextBatchSeq, tip: t.t.chainTip };
    const batches = Array.from({ length: 50 }, () => {
      t.t.nextBatchSeq = saved.next;
      t.t.chainTip = saved.tip;
      return t.t.buildBatch([world.sale(t, m, 1000, version)], { ledgerId: world.ledgerId });
    });
    const gate = gateProcessor(world);
    const answers: Array<{ i: number; status: number; code: unknown }> = [];
    const pending = batches.map((b, i) =>
      send(t, b).then((r) => {
        answers.push({ i, status: r.status, code: r.body.code });
        return r;
      }),
    );
    try {
      const deadline = Date.now() + 60_000;
      while (answers.length < 49 && Date.now() < deadline) await sleep(100);
    } finally {
      gate.open();
    }
    const all = await Promise.all(pending);
    gate.restore();
    const refused = all.filter((r) => r.status !== 200);
    process.stdout.write(
      `CONCURRENCE 50 envois : ${JSON.stringify(
        Object.fromEntries(
          [...new Set(all.map((r) => `${r.status}${r.body.code ? ` ${r.body.code}` : ''}`))].map(
            (k) => [
              k,
              all.filter((r) => `${r.status}${r.body.code ? ` ${r.body.code}` : ''}` === k).length,
            ],
          ),
        ),
      )}\n`,
    );
    expect(all.filter((r) => r.status === 200)).toHaveLength(1);
    expect(refused).toHaveLength(49);
    for (const r of refused) expect([r.status, r.body.code]).toEqual([409, 'BATCH_IN_PROGRESS']);
    expect(await world.txRows(t.t.deviceId)).toHaveLength(1);
    expect(await world.pw.registry(t.t.deviceId)).toHaveLength(1);
  });
});

describe('NFR-011 : pool de verrous de lots plein (OFFLINE_BATCH_POOL_SIZE = 2)', () => {
  let world: ProcessingWorld;
  beforeAll(async () => {
    process.env.OFFLINE_BATCH_POOL_SIZE = '2';
    try {
      world = await ProcessingWorld.create();
    } finally {
      delete process.env.OFFLINE_BATCH_POOL_SIZE;
    }
  });
  afterAll(async () => {
    await world?.close();
  });

  it('troisième lot : 503 + Retry-After en moins de 5 s, lot non ouvert, aucune écriture partielle ; rétabli ensuite', async () => {
    const seller = async () => {
      const t = await world.terminal();
      const media = await world.pw.media(1, 50_000);
      await settleClock();
      return { t, m: media[0]!, version: await world.snapshot(t, media) };
    };
    const [s1, s2, s3] = [await seller(), await seller(), await seller()];
    const batchOf = (s: Awaited<ReturnType<typeof seller>>) =>
      s.t.t.buildBatch([world.sale(s.t, s.m, 1000, s.version)], { ledgerId: world.ledgerId });
    const [b1, b2, b3] = [batchOf(s1), batchOf(s2), batchOf(s3)];
    const send = (s: typeof s1, b: typeof b1) =>
      s.t.t.submitBatch(world.pw.api.baseUrl, world.pw.api.tls.serverCaPem, b);
    const gate = gateProcessor(world);
    const held = [send(s1, b1), send(s2, b2)];
    await sleep(1500);
    const started = Date.now();
    const full = await send(s3, b3);
    const waited = Date.now() - started;
    expect([full.status, full.body.code]).toEqual([503, 'SERVICE_UNAVAILABLE']);
    expect(full.headers['retry-after']).toBe('5');
    expect(waited).toBeLessThan(5_000);
    // Rien d'ouvert ni d'écrit pour le lot refusé : tout ou rien.
    expect(
      await ownerRows('SELECT 1 FROM offline_batch WHERE id = $1', [b3.header.batch_id]),
    ).toHaveLength(0);
    expect(await world.txRows(s3.t.t.deviceId)).toHaveLength(0);
    expect(await world.pw.registry(s3.t.t.deviceId)).toHaveLength(0);
    gate.open();
    expect((await Promise.all(held)).map((r) => r.status)).toEqual([200, 200]);
    gate.restore();
    const retry = await send(s3, b3);
    expect(retry.status).toBe(200);
    expect(await world.txRows(s3.t.t.deviceId)).toHaveLength(1);
  });
});
