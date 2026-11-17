// NFR-004 : 95 % des relevés d'une partie répondent en moins de 1 s sur un événement de 100 000 transactions.
// Suite ISOLÉE : écartée sous SKIP_LATENCY, à lancer seule (`npx jest test/integration/statements/statement-latency`).
// Semis en masse par le propriétaire de la base (`session_replication_role = 'replica'` le temps du semis, puis ANALYZE) :
// 100 000 ventes de cinq écritures (portefeuille, commerçant, commission TTC, commission HT, taxe), comme T10 du scénario.
import { randomUUID } from 'node:crypto';
import { withOwner } from '../../support/db';
import { createTestApp } from '../../support/app';
import { FakeIdp } from '../../support/fake-idp';
import { createApiConfigFixture, type ApiConfigFixture } from '../../scenario/api-config-fixture';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';

const TRANSACTIONS = 100_000;
const CONCURRENT = 20;
const P95_BUDGET_MS = 1000;
const suite = process.env.SKIP_LATENCY ? describe.skip : describe;

jest.setTimeout(1_800_000);

function percentile(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)]!;
}

suite('NFR-004 : relevés d’une partie sur 100 000 transactions', () => {
  let app: INestApplication;
  let fx: ApiConfigFixture;

  beforeAll(async () => {
    const idp = await FakeIdp.create();
    app = await createTestApp({ identity: idp });
    fx = await createApiConfigFixture(app, idp);
    await withOwner(async (db) => {
      const q = (text: string, values: unknown[] = []) => db.query(text, values);
      await q(`SET session_replication_role = 'replica'`);
      try {
        const acc = async (code: string) =>
          (
            await q(`SELECT id FROM account WHERE ledger_id = $1 AND code = $2`, [
              fx.ledgerId,
              code,
            ])
          ).rows[0].id as string;
        const merchants = ['FOOD', 'TEE', 'BAR'] as const;
        const mch = await Promise.all(
          merchants.map(async (m) => acc(`L-MCH-${fx.participations[m]}`)),
        );
        const [wallet, com, tax] = await Promise.all([
          acc('L-WAL-W01-P'),
          acc('L-ORG-COM'),
          acc('L-ORG-TVA'),
        ]);
        await q(
          `CREATE TEMP TABLE seed AS
             SELECT g, gen_random_uuid() AS id, g % 3 AS m FROM generate_series(1, $1::int) g`,
          [TRANSACTIONS],
        );
        await q(
          `INSERT INTO journal_transaction (id, operator_id, ledger_id, event_id, type, idempotency_key,
                                            request_hash, occurred_at, source)
           SELECT id, $1, $2, $3, 'PURCHASE', 'latency:' || g, 'h', '2026-12-01'::timestamptz + g * interval '1 second', 'ONLINE'
             FROM seed`,
          [fx.parties.OPE, fx.ledgerId, fx.eventId],
        );
        const lines = `(1, 6000, 0), (2, -6000, 1), (3, 720, 1), (4, -610, 2), (5, -110, 3)`;
        await q(
          `INSERT INTO posting (operator_id, ledger_id, transaction_id, line_no, account_id, amount, memo)
           SELECT $1, $2, s.id, l.n,
                  (ARRAY[$3::uuid, ($4::uuid[])[s.m + 1], $5::uuid, $6::uuid])[l.k + 1], l.a, 'latence'
             FROM seed s CROSS JOIN (VALUES ${lines}) AS l(n, a, k)`,
          [fx.parties.OPE, fx.ledgerId, wallet, mch, com, tax],
        );
      } finally {
        await q(`SET session_replication_role = 'origin'`);
      }
      await q('ANALYZE posting');
      await q('ANALYZE journal_transaction');
      await q('ANALYZE account');
      await q('ANALYZE merchant_participation');
    });
  });
  afterAll(async () => app.close());

  const get = (kind: string, query: string, token: string) =>
    request(app.getHttpServer())
      .get(`/v1/operators/${fx.parties.OPE}/events/${fx.eventId}/statements/${kind}?${query}`)
      .set('Authorization', `Bearer ${token}`);

  it(`${CONCURRENT} relevés simultanés par partie : p95 sous ${P95_BUDGET_MS} ms`, async () => {
    const cases = [
      ['ORGANIZER', `party_id=${fx.parties.ORG}&limit=50`, fx.people.organizerAdmin.token],
      ['OPERATOR', 'limit=50', fx.people.operatorAdmin.token],
      ['PLATFORM', 'limit=50', fx.people.platformAdmin.token],
      ['MERCHANT', `party_id=${fx.parties.FOOD}&limit=50`, fx.people.operatorAdmin.token],
    ] as const;
    const all: number[] = [];
    const report: string[] = [];
    const p95s: number[] = [];
    for (const [kind, query, token] of cases) {
      // Premier appel isolé : plan et caches chauds, vérifie la forme.
      const warm = await get(kind, query, token);
      expect(warm.status).toBe(200);
      const times = await Promise.all(
        Array.from({ length: CONCURRENT }, async () => {
          const started = performance.now();
          const res = await get(kind, query, token);
          const elapsed = performance.now() - started;
          expect(res.status).toBe(200);
          return elapsed;
        }),
      );
      const sorted = [...times].sort((a, b) => a - b);
      all.push(...sorted);
      p95s.push(percentile(sorted, 0.95));
      report.push(
        `${kind.padEnd(9)} min ${sorted[0]!.toFixed(0)} ms, médiane ${percentile(sorted, 0.5).toFixed(0)} ms, ` +
          `p95 ${percentile(sorted, 0.95).toFixed(0)} ms, max ${sorted[sorted.length - 1]!.toFixed(0)} ms`,
      );
    }
    const sortedAll = all.sort((a, b) => a - b);
    // eslint-disable-next-line no-console
    console.log(
      `NFR-004 (${TRANSACTIONS} transactions, ${CONCURRENT} simultanés par partie)\n${report.join('\n')}\n` +
        `TOUTES    min ${sortedAll[0]!.toFixed(0)} ms, médiane ${percentile(sortedAll, 0.5).toFixed(0)} ms, ` +
        `p95 ${percentile(sortedAll, 0.95).toFixed(0)} ms, max ${sortedAll[sortedAll.length - 1]!.toFixed(0)} ms`,
    );
    for (const p95 of p95s) expect(p95).toBeLessThan(P95_BUDGET_MS);
    expect(percentile(sortedAll, 0.95)).toBeLessThan(P95_BUDGET_MS);
    void randomUUID;
  });
});
