// Latence des routes de ventes sur 200 000 ventes (mission routes-backoffice 11b, WP06 ; NFR-001) : p95 < 500 ms,
// mesuré sur la ROUTE (HTTP, jeton, portée, requête), 50 appels par scénario. Insertion en masse en test seulement.
// Écartée de la passe parallèle (`SKIP_LATENCY=1`), lancée seule :
//   PGDATABASE=cashless_wp06 … npx jest test/integration/backoffice/sales-latency.spec.ts --runInBand --forceExit
// Plans d'exécution (`EXPLAIN (ANALYZE, BUFFERS)` des trois requêtes) écrits sur la sortie standard.
import { performance } from 'node:perf_hooks';
import type { INestApplication } from '@nestjs/common';
import { Client } from 'pg';
import request from 'supertest';
import { createTestApp } from '../../support/app';
import { APP_URL, withOwner } from '../../support/db';
import type { TestPerson } from '../../support/fake-idp';
import { createMediaWorld, type MediaWorld } from '../../support/media-fixtures';
import { seedSales, type SalesFixture } from './sales-seed';

jest.setTimeout(900_000);
const latency = process.env.SKIP_LATENCY ? it.skip : it;
const CALLS = 50;
const LIMIT_MS = 500;

const p95 = (ms: number[]): number =>
  [...ms].sort((a, b) => a - b)[Math.ceil(ms.length * 0.95) - 1]!;

describe('latence des ventes (200 000)', () => {
  let w: MediaWorld;
  let app: INestApplication;
  let fx: SalesFixture;
  let merchantAdmin: TestPerson;
  let deepCursor: string;
  const report: string[] = [];

  beforeAll(async () => {
    if (process.env.SKIP_LATENCY) return;
    w = await createMediaWorld();
    await withOwner(async (db) => {
      fx = await seedSales(db, w, { count: 200_000, perSecond: 3 });
      // 2 % d'annulations (le cas le plus lent au niveau SQL : filtre « annulées »).
      await db.query(
        `INSERT INTO journal_transaction (id, operator_id, ledger_id, event_id, type, idempotency_key,
                request_hash, occurred_at, recorded_at, source, device_id, reverses_id)
         SELECT gen_random_uuid(), operator_id, ledger_id, event_id, 'REVERSAL', 'perfrev:' || id::text, 'h',
                occurred_at + interval '1 minute', now(), 'ONLINE', device_id, id
           FROM (SELECT * FROM journal_transaction WHERE event_id = $1 AND type = 'PURCHASE'
                  ORDER BY id LIMIT 4000) s`,
        [fx.eventId],
      );
      await db.query('ANALYZE');
      merchantAdmin = await w.idp.createPerson(db, {
        operatorId: w.ops.a,
        roles: [{ role: 'MERCHANT_ADMIN', scopeType: 'MERCHANT', scopeId: fx.merchants[0] }],
      });
    });
    app = await createTestApp({ identity: w.idp });
    const deep = await request(app.getHttpServer())
      .get(`/v1/events/${fx.eventId}/sales?limit=200&from=2026-06-02T00:00:00Z`)
      .set('Authorization', `Bearer ${w.operatorAdminA.token}`);
    deepCursor = deep.body.next_cursor as string;
  });

  afterAll(async () => {
    await app?.close();
    for (const line of report) console.info(line);
  });

  async function measure(label: string, call: (i: number) => request.Test): Promise<void> {
    const times: number[] = [];
    for (let i = 0; i < CALLS; i++) {
      const t = performance.now();
      const res = await call(i);
      times.push(performance.now() - t);
      expect([label, res.status]).toEqual([label, 200]);
    }
    const value = p95(times);
    report.push(`[latence] ${label} : p95 = ${value.toFixed(1)} ms sur ${CALLS} appels`);
    expect(value).toBeLessThan(LIMIT_MS);
  }

  const get = (path: string, person: () => TestPerson) =>
    request(app.getHttpServer()).get(`/v1${path}`).set('Authorization', `Bearer ${person().token}`);
  const admin = () => w.operatorAdminA;

  latency('liste : première page', () =>
    measure('page 1', () => get(`/events/${fx.eventId}/sales`, admin)),
  );
  latency('liste : page profonde par curseur', () =>
    measure('page profonde', () =>
      get(`/events/${fx.eventId}/sales?limit=50&cursor=${encodeURIComponent(deepCursor)}`, admin),
    ),
  );
  latency('liste : filtre commerçant', () =>
    measure('filtre merchant_id', () =>
      get(`/events/${fx.eventId}/sales?merchant_id=${fx.merchants[0]}`, admin),
    ),
  );
  latency('liste : filtre point de vente', () =>
    measure('filtre pos_id', () => get(`/events/${fx.eventId}/sales?pos_id=${fx.pos[1]}`, admin)),
  );
  latency('liste : filtre annulées', () =>
    measure('filtre status=REVERSED', () =>
      get(`/events/${fx.eventId}/sales?status=REVERSED`, admin),
    ),
  );
  latency('liste : MERCHANT_ADMIN', () =>
    measure('MERCHANT_ADMIN', () => get(`/events/${fx.eventId}/sales`, () => merchantAdmin)),
  );
  latency('détail : 50 ventes', () =>
    measure('détail', (i) => get(`/sales/${fx.sales[i * 3989]}`, admin)),
  );

  latency('plans d’exécution des requêtes de liste (sous la RLS du prestataire)', async () => {
    const client = new Client({ connectionString: APP_URL });
    await client.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.operator_id', $1, true)", [w.ops.a]);
      // Le 4e champ : requête servie avec `SET LOCAL enable_sort = off` (filtre dérivé, voir le service).
      const queries: Array<[string, string, unknown[], boolean]> = [
        [
          'page 1',
          `SELECT * FROM sale_overview WHERE event_id = $1 ORDER BY occurred_at DESC, transaction_id DESC LIMIT 51`,
          [fx.eventId],
          false,
        ],
        [
          'filtre merchant_id',
          `SELECT * FROM sale_overview WHERE event_id = $1 AND merchant_id = $2
            ORDER BY occurred_at DESC, transaction_id DESC LIMIT 51`,
          [fx.eventId, fx.merchants[0]],
          true,
        ],
        [
          'filtre pos_id',
          `SELECT * FROM sale_overview WHERE event_id = $1 AND pos_id = $2
            ORDER BY occurred_at DESC, transaction_id DESC LIMIT 51`,
          [fx.eventId, fx.pos[1]],
          true,
        ],
        [
          'filtre annulées',
          `SELECT * FROM sale_overview WHERE event_id = $1 AND reversal_transaction_id IS NOT NULL
            ORDER BY occurred_at DESC, transaction_id DESC LIMIT 51`,
          [fx.eventId],
          false,
        ],
      ];
      for (const [label, sql, params, noSort] of queries) {
        if (noSort) await client.query('SET LOCAL enable_sort = off');
        const { rows } = await client.query<Record<string, string>>(
          `EXPLAIN (ANALYZE, BUFFERS) ${sql}`,
          params,
        );
        const plan = rows.map((r) => r['QUERY PLAN']).join('\n');
        report.push(`[plan] ${label}\n${plan}`);
        expect(plan).not.toMatch(/Seq Scan on journal_transaction/);
        if (noSort) expect(plan).toMatch(/journal_transaction_sales_idx/);
      }
      await client.query('ROLLBACK');
    } finally {
      await client.end();
    }
  });
});
