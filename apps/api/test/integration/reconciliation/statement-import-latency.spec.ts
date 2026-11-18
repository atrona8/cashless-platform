// Mesure (mission 9b, WP09 ; NFR-003) : 10 000 lignes importées et rapprochées automatiquement en moins de 60 s.
// Suite isolée : écartée par SKIP_LATENCY.
import { randomUUID } from 'node:crypto';
import { withOwner } from '../../support/db';
import {
  createStatementWorld,
  csvFile,
  importStatement,
  type StatementWorld,
} from './statement-fixtures';

const latency = process.env.SKIP_LATENCY ? it.skip : it;

describe('NFR-003 : import de 10 000 lignes', () => {
  let s: StatementWorld;
  beforeAll(async () => {
    s = await createStatementWorld();
  });
  afterAll(async () => {
    await s.app.close();
  });

  latency(
    '10 000 lignes importées et rapprochées en moins de 60 s',
    async () => {
      const total = 10_000;
      await withOwner(async (db) => {
        await db.query(`SELECT set_config('app.operator_id', $1, false)`, [s.w.ops.a]);
        // Une transaction par recharge (psp_topup_one_tx), créées en masse.
        await db.query(
          `CREATE TEMP TABLE bulk_tx AS SELECT g, gen_random_uuid() AS id, gen_random_uuid() AS k
           FROM generate_series(0, $1::int - 1) g`,
          [total],
        );
        await db.query(
          `INSERT INTO journal_transaction (id, operator_id, ledger_id, type, idempotency_key, request_hash,
            occurred_at, source, created_by, approved_by)
         SELECT id, $1, $2, 'ADJUSTMENT', k, 'h', '2026-01-10 12:00+00', 'BACKOFFICE', $3, gen_random_uuid()
           FROM bulk_tx`,
          [s.w.ops.a, s.ledgerA, s.w.operatorAdminA.userId],
        );
        await db.query(
          `INSERT INTO posting (operator_id, ledger_id, transaction_id, line_no, account_id, amount)
         SELECT $1, $2, id, n, CASE n WHEN 1 THEN $3::uuid ELSE $4::uuid END, CASE n WHEN 1 THEN 1 ELSE -1 END
           FROM bulk_tx CROSS JOIN (VALUES (1), (2)) v(n)`,
          [s.w.ops.a, s.ledgerA, s.acct.wave, s.acct.liab],
        );
        await db.query('SET session_replication_role = replica');
        await db.query(
          `INSERT INTO psp_topup (psp_topup_id, operator_id, ledger_id, event_id, wallet_id, psp_configuration_id,
            method, provider, amount, currency, fee_amount, status, provider_payment_ref, expires_at,
            requested_by_kind, customer_id, topup_tx_id, succeeded_at)
         SELECT gen_random_uuid(), $1, $2, $3, $4, $5, 'WAVE', 'WAVE', 1, 'XOF', 0, 'SUCCEEDED', 'P-' || b.g,
                now() + interval '1 day', 'CUSTOMER', $6, b.id, now()
           FROM bulk_tx b`,
          [s.w.ops.a, s.ledgerA, s.w.ids.eventA, s.w.ids.walletA, randomUUID(), randomUUID()],
        );
        await db.query('RESET session_replication_role');
      });
      const rows: Array<[string, string, number]> = [];
      for (let n = 0; n < total; n += 1) rows.push([`P-${n}`, '2026-01-10', 1]);
      const started = Date.now();
      const res = await importStatement(s, s.w.operatorAdminA, csvFile(rows), {
        source: 'wave',
        closing: 1,
      });
      const seconds = (Date.now() - started) / 1000;
      console.log(`NFR-003 : ${total} lignes importées et rapprochées en ${seconds.toFixed(2)} s`);
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ lines_created: total, lines_matched: total });
      expect(seconds).toBeLessThan(60);
    },
    180_000,
  );
});
