// Intégration (mission 9b, WP09 ; FR-015, OP-N82) : `getLedgerReconciliation` et condition `PSP_RECONCILED`.
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { contractViolations } from '../../support/contract-schema';
import type { TestPerson } from '../../support/fake-idp';
import { withOwner } from '../../support/db';
import {
  createStatementWorld,
  csvFile,
  importStatement,
  lineRows,
  makeAnomaly,
  makePspTopup,
  makeTx,
  type StatementWorld,
} from './statement-fixtures';

describe('état du rapprochement (GET /ledgers/{id}/reconciliation)', () => {
  let s: StatementWorld;
  const admin = () => s.w.operatorAdminA;

  const state = (who: TestPerson | null, ledger = s.ledgerA) => {
    const req = request(s.app.getHttpServer()).get(`/v1/ledgers/${ledger}/reconciliation`);
    return who ? req.set('Authorization', `Bearer ${who.token}`) : req;
  };
  const of = async (account: string) => {
    const res = await state(admin());
    expect(res.status).toBe(200);
    const row = (res.body.data as Array<Record<string, unknown>>).find(
      (r) => r.account_id === account,
    );
    expect(row).toBeDefined();
    expect(contractViolations('AccountReconciliation', row)).toEqual([]);
    return row!;
  };
  const pspReconciled = () =>
    withOwner(async (db) => {
      await db.query(`SELECT set_config('app.operator_id', $1, false)`, [s.w.ops.a]);
      const { rows } = await db.query<{ met: boolean }>(
        `SELECT met FROM event_transition_conditions($1, 'SETTLING') WHERE code = 'PSP_RECONCILED'`,
        [s.w.ids.eventA],
      );
      return rows[0]!.met;
    });

  beforeAll(async () => {
    s = await createStatementWorld();
  });
  afterAll(async () => {
    await s.app.close();
  });

  it('un compte sans relevé ni mouvement est listé, jamais omis', async () => {
    const row = await of(s.acct.wave);
    expect(row).toMatchObject({ lines_total: 0, lines_unmatched: 0, ledger_balance: 0 });
    expect(row.statement_balance).toBeNull();
    expect(await pspReconciled()).toBe(true);
  });

  it('FR-015 : un compte avec mouvements mais sans relevé n’est pas rapproché', async () => {
    await withOwner(async (db) => {
      await db.query(`SELECT set_config('app.operator_id', $1, false)`, [s.w.ops.a]);
      await makeTx(db, s, s.acct.wave, 1000);
    });
    expect(await of(s.acct.wave)).toMatchObject({ reconciled: false, ledger_balance: 1000 });
    expect(await pspReconciled()).toBe(false);
  });

  it('une ligne non rapprochée, puis rapprochée à la main : rapproché si le solde concorde', async () => {
    const file = csvFile([['W-1', '2026-01-10', 1000]]);
    const imp = await importStatement(s, admin(), file, { closing: 1000, source: 'wave' });
    expect(imp.status).toBe(201);
    expect(imp.body.lines_matched).toBe(0);
    expect(await of(s.acct.wave)).toMatchObject({
      lines_total: 1,
      lines_unmatched: 1,
      statement_balance: 1000,
      statement_date: '2026-01-31',
      reconciled: false,
    });
    const tx = (
      await lineRows<{ transaction_id: string }>(
        'SELECT transaction_id FROM posting WHERE account_id = $1',
        [s.acct.wave],
      )
    )[0]!.transaction_id;
    const line = (
      await lineRows<{ id: string }>(
        "SELECT id::text FROM external_statement_line WHERE external_ref = 'W-1'",
      )
    )[0]!.id;
    const res = await request(s.app.getHttpServer())
      .post(`/v1/statement-lines/${line}/match`)
      .set('Authorization', `Bearer ${admin().token}`)
      .set('Idempotency-Key', randomUUID())
      .send({ transaction_id: tx });
    expect(res.status).toBe(200);
    expect(await of(s.acct.wave)).toMatchObject({ lines_unmatched: 0, reconciled: true });
    expect(await pspReconciled()).toBe(true);
  });

  it('un seul centime d’écart sur le solde du relevé : non rapproché ; le dernier relevé fait foi', async () => {
    await withOwner(async (db) => {
      await db.query(`SELECT set_config('app.operator_id', $1, false)`, [s.w.ops.a]);
      await makePspTopup(db, s, 'K-1', await makeTx(db, s, s.acct.carte, 700));
    });
    const first = await importStatement(s, admin(), csvFile([['K-1', '2026-01-10', 700]]), {
      account: s.acct.carte,
      source: 'carte',
      closing: 699,
    });
    expect(first.body).toMatchObject({ lines_created: 1, lines_matched: 1 });
    expect(await of(s.acct.carte)).toMatchObject({ lines_unmatched: 0, reconciled: false });
    expect(await pspReconciled()).toBe(false);
    // Nouveau relevé (autre contenu, donc autre empreinte), solde exact.
    const second = await importStatement(
      s,
      admin(),
      csvFile([['K-1', '2026-01-10', 700]]).replace('\r\n', '\r\n\r\n'),
      { account: s.acct.carte, source: 'carte', closing: 700, date: '2026-02-01' },
    );
    expect([second.status, second.body.lines_created]).toEqual([201, 0]);
    expect(await of(s.acct.carte)).toMatchObject({ statement_balance: 700, reconciled: true });
  });

  it('FR-015, OP-N82 : un paiement non crédité rapproché à son anomalie explique l’écart', async () => {
    const anomaly = await withOwner((db) => makeAnomaly(db, s, 'PSP_TOPUP_NOT_CREDITED'));
    const imp = await importStatement(s, admin(), csvFile([['NC-1', '2026-01-12', 800]]), {
      account: s.acct.om,
      source: 'om',
      closing: 800,
    });
    expect(imp.body).toMatchObject({ lines_created: 1, lines_matched: 0 });
    // Sans rapprochement : écart non expliqué.
    expect(await of(s.acct.om)).toMatchObject({ ledger_balance: 0, reconciled: false });
    const line = (
      await lineRows<{ id: string }>(
        "SELECT id::text FROM external_statement_line WHERE external_ref = 'NC-1'",
      )
    )[0]!.id;
    const res = await request(s.app.getHttpServer())
      .post(`/v1/statement-lines/${line}/match`)
      .set('Authorization', `Bearer ${admin().token}`)
      .set('Idempotency-Key', randomUUID())
      .send({ anomaly_id: anomaly });
    expect(res.status).toBe(200);
    expect(await of(s.acct.om)).toMatchObject({ lines_unmatched: 0, reconciled: true });
  });

  it('rôles et isolation : SUPERVISOR 200, CASHIER 403, autre prestataire 404, sans jeton 401', async () => {
    expect((await state(s.w.supervisorA)).status).toBe(200);
    expect((await state(s.w.cashierA)).status).toBe(403);
    expect((await state(s.operatorAdminB)).status).toBe(404);
    expect((await state(admin(), s.ledgerB)).status).toBe(404);
    expect((await state(null)).status).toBe(401);
  });
});
