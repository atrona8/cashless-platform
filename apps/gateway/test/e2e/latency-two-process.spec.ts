// T114 / NFR-005, SC-004 : 1 000 paiements en série puis à concurrence 10, passerelle en processus
// enfant, central et relais à part, base locale réelle. Mesure du serveur seul : connexion TLS 1.3
// persistante, signature et jeton préparés hors mesure (voir `load-support.ts`). Cibles : p95 <=
// 200
// ms, p99 <= 500 ms ; le test échoue si moins de 1 000 observations. Les chiffres sont écrits par
// `report` (M8_E2E_REPORT).
import type {
  PayMedia,
  PayTerminal,
} from '../../../api/test/integration/payments/payments-fixtures';
import { TwoProcessBench } from '../support/two-process-bench';
import {
  activateEdge,
  KeepAliveClient,
  percentile,
  report,
  summarize,
} from '../support/load-support';

const P95_MS = 200;
const P99_MS = 500;
const SERIAL = 1_000;
const CONCURRENCY = 10;
const PER_TERMINAL = 100;

let bench: TwoProcessBench;
afterAll(async () => bench?.close());

describe('NFR-005 : latence des paiements sur la passerelle (deux processus)', () => {
  const tills: PayTerminal[] = [];
  const media: PayMedia[] = [];

  beforeAll(async () => {
    bench = await TwoProcessBench.start();
    const w = bench.world;
    for (let i = 0; i < CONCURRENCY; i += 1) tills.push(await w.terminal());
    // Un bracelet par terminal, assez de fonds pour 1 100 ventes d'un article.
    media.push(...(await w.media(CONCURRENCY, 5_000_000)));
    await activateEdge(
      bench,
      media.map((m) => m.walletId),
    );
  }, 300_000);

  const sale = (i: number) => {
    const w = bench.world;
    return w.catalogBody(tills[i]!, { tap: w.tap(media[i]!) }, [[1, 1]]);
  };

  it('1 000 paiements en série : p95 <= 200 ms, p99 <= 500 ms', async () => {
    // Le plafond horaire par terminal (500 000, sécurité de la passerelle, non modifiée) tient
    // 333 ventes de 1 500 : les 1 000 paiements, un à la fois, tournent sur les dix terminaux.
    const clients = tills.map((t) => new KeepAliveClient(bench, t));
    for (const [i, c] of clients.entries()) expect((await c.pay(sale(i))).status).toBe(201);
    const times: number[] = [];
    for (let n = 0; n < SERIAL; n += 1) {
      const i = n % CONCURRENCY;
      const res = await clients[i]!.pay(sale(i));
      if (res.status !== 201) throw new Error(`paiement ${n} : ${res.status} ${res.text}`);
      times.push(res.ms);
    }
    clients.forEach((c) => c.close());
    const s = summarize(times);
    report('NFR-005 série', { ...s, cibleP95: P95_MS, cibleP99: P99_MS });
    expect(times.length).toBeGreaterThanOrEqual(SERIAL);
    expect(s.p95).toBeLessThanOrEqual(P95_MS);
    expect(s.p99).toBeLessThanOrEqual(P99_MS);
  }, 900_000);

  it('1 000 paiements à concurrence 10 : p95 <= 200 ms, p99 <= 500 ms', async () => {
    const clients = tills.map((t) => new KeepAliveClient(bench, t));
    await Promise.all(clients.map((c, i) => c.pay(sale(i)))); // connexions chauffées
    const times: number[] = [];
    const started = Date.now();
    await Promise.all(
      clients.map(async (client, i) => {
        for (let n = 0; n < PER_TERMINAL; n += 1) {
          const res = await client.pay(sale(i));
          if (res.status !== 201) throw new Error(`paiement ${i}/${n} : ${res.status} ${res.text}`);
          times.push(res.ms);
        }
      }),
    );
    const elapsed = Date.now() - started;
    clients.forEach((c) => c.close());
    const s = summarize(times);
    report('NFR-005 concurrence 10', {
      ...s,
      debitParSeconde: Math.round((times.length * 1000) / elapsed),
      cibleP95: P95_MS,
      cibleP99: P99_MS,
    });
    expect(times.length).toBeGreaterThanOrEqual(SERIAL);
    expect(percentile(times, 95)).toBeLessThanOrEqual(P95_MS);
    expect(percentile(times, 99)).toBeLessThanOrEqual(P99_MS);
  }, 900_000);

  it('contrôle de sensibilité : la mesure voit un ralentissement de la base locale', async () => {
    // Une base locale ralentie doit se voir : la tête de chaîne est verrouillée 400 ms pendant
    // qu'un paiement part ; sa durée mesurée dépasse la cible, sinon la mesure ne prouve rien.
    const client = new KeepAliveClient(bench, tills[0]!);
    await client.pay(sale(0));
    const lock = await bench.edgeDb.pool.connect();
    const slow: number[] = [];
    try {
      await lock.query('BEGIN');
      await lock.query('SELECT 1 FROM edge_chain_head FOR UPDATE');
      const pending = client.pay(sale(0)).then((r) => [r]);
      await new Promise((r) => setTimeout(r, 400));
      await lock.query('COMMIT');
      for (const r of await pending) slow.push(r.ms);
    } finally {
      lock.release();
      client.close();
    }
    expect(Math.min(...slow)).toBeGreaterThan(P95_MS);
  }, 120_000);
});
