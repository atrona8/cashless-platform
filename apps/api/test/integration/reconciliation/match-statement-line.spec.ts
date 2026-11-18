// Intégration (mission 9b, WP09 ; FR-014, FR-015, FR-024) : rapprochement automatique par les quatre tables sources
// et `matchStatementLine`.
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { contractViolations } from '../../support/contract-schema';
import { withOwner } from '../../support/db';
import type { TestPerson } from '../../support/fake-idp';
import {
  createStatementWorld,
  csvFile,
  importStatement,
  lineRows,
  makeAnomaly,
  makeChargeback,
  makePayout,
  makePspTopup,
  makeRefund,
  makeTx,
  type StatementWorld,
} from './statement-fixtures';

describe('rapprochement des lignes de relevé', () => {
  let s: StatementWorld;
  const admin = () => s.w.operatorAdminA;
  const tx: Record<string, string> = {};
  let topupId: string;

  const match = (
    who: TestPerson | null,
    id: string | number,
    body: unknown,
    key = randomUUID(),
  ) => {
    const req = request(s.app.getHttpServer())
      .post(`/v1/statement-lines/${id}/match`)
      .set('Idempotency-Key', key);
    return (who ? req.set('Authorization', `Bearer ${who.token}`) : req).send(body as object);
  };
  const lineOf = async (ref: string, source: string) =>
    (
      await lineRows<{
        id: string;
        matched_tx_id: string | null;
        matched_anomaly_id: string | null;
        matched_by: string | null;
      }>(
        'SELECT id::text, matched_tx_id, matched_anomaly_id, matched_by FROM external_statement_line WHERE external_ref = $1 AND source = $2',
        [ref, source],
      )
    )[0]!;

  beforeAll(async () => {
    s = await createStatementWorld();
    await withOwner(async (db) => {
      await db.query(`SELECT set_config('app.operator_id', $1, false)`, [s.w.ops.a]);
      tx.topup = await makeTx(db, s, s.acct.om, 1000);
      tx.chargeback = await makeTx(db, s, s.acct.om, -300);
      tx.refund = await makeTx(db, s, s.acct.om, -200);
      tx.payout = await makeTx(db, s, s.acct.om, -500);
      tx.free1 = await makeTx(db, s, s.acct.om, 10);
      tx.free2 = await makeTx(db, s, s.acct.om, 20);
      tx.free3 = await makeTx(db, s, s.acct.om, 30);
      tx.elsewhere = await makeTx(db, s, s.acct.bank, 77);
      topupId = await makePspTopup(db, s, 'PAY-1', tx.topup!);
      await makeChargeback(db, s, 'DSP-1', topupId, tx.chargeback!);
      await makeRefund(db, s, 'RF-1', tx.refund!);
      await makePayout(db, s, 'PO-1', tx.payout!);
    });
  });
  afterAll(async () => {
    await s.app.close();
  });

  it('FR-014 : les quatre sources automatiques ; signe et compte contrôlés', async () => {
    const file = csvFile([
      ['PAY-1', '2026-01-10', 1000],
      ['DSP-1', '2026-01-10', -300],
      ['RF-1', '2026-01-10', -200],
      ['PO-1', '2026-01-10', -500],
      ['LIBRE-1', '2026-01-10', 10],
      ['LIBRE-2', '2026-01-10', 20],
      ['LIBRE-3', '2026-01-10', 30],
      ['LIBRE-ANOMALIE', '2026-01-10', 1000],
    ]);
    const res = await importStatement(s, admin(), file, { account: s.acct.om, source: 'om' });
    expect(res.body).toMatchObject({ lines_created: 8, lines_matched: 4 });
    for (const [ref, key] of [
      ['PAY-1', 'topup'],
      ['DSP-1', 'chargeback'],
      ['RF-1', 'refund'],
      ['PO-1', 'payout'],
    ] as const) {
      const line = await lineOf(ref, 'om');
      expect([ref, line.matched_tx_id]).toEqual([ref, tx[key]]);
      expect(line.matched_by).toBe(admin().userId);
    }
    expect((await lineOf('LIBRE-1', 'om')).matched_tx_id).toBeNull();
  });

  it('la référence d’une transaction qui ne touche pas le compte n’est pas rapprochée', async () => {
    // PAY-1 existe sur le compte OM ; une ligne PAY-1 sur la banque ne se rapproche à rien.
    const res = await importStatement(s, admin(), csvFile([['PAY-1', '2026-01-10', 1000]]), {
      account: s.acct.bank,
      source: 'banque',
    });
    expect(res.body).toMatchObject({ lines_created: 1, lines_matched: 0 });
  });

  it('FR-014 : rapprochement manuel à une transaction, 200 StatementLine, audit', async () => {
    const line = await lineOf('LIBRE-1', 'om');
    const res = await match(s.w.organizerAdminA, line.id, { transaction_id: tx.free1 });
    expect(res.status).toBe(200);
    expect(contractViolations('StatementLine', res.body)).toEqual([]);
    expect(res.body).toMatchObject({
      statement_line_id: Number(line.id),
      matched: true,
      matched_transaction_id: tx.free1,
      matched_anomaly_id: null,
      matched_by: s.w.organizerAdminA.userId,
    });
    const audit = await lineRows<{ actor_id: string; after: Record<string, string> }>(
      "SELECT actor_id, after FROM audit_log WHERE action = 'STATEMENT_LINE_MATCHED' AND object_id = $1",
      [line.id],
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]!.actor_id).toBe(s.w.organizerAdminA.userId);
    expect(audit[0]!.after.transaction_id).toBe(tx.free1);
    expect(JSON.stringify(audit[0]!.after)).not.toContain('LIBRE-1');
  });

  it('refus : double rapprochement 409, rien ne se défait', async () => {
    const line = await lineOf('LIBRE-1', 'om');
    const again = await match(admin(), line.id, { transaction_id: tx.free2 });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('CONFLICT_STATE');
    expect((await lineOf('LIBRE-1', 'om')).matched_tx_id).toBe(tx.free1);
    // Une ligne rapprochée automatiquement non plus.
    const auto = await lineOf('PAY-1', 'om');
    expect((await match(admin(), auto.id, { transaction_id: tx.free2 })).status).toBe(409);
  });

  it('refus : transaction d’un autre compte ou grand livre, 422 ; deux cibles ou aucune, 400 ; champ étranger, 400', async () => {
    const line = await lineOf('LIBRE-2', 'om');
    expect((await match(admin(), line.id, { transaction_id: tx.elsewhere })).status).toBe(422);
    expect((await match(admin(), line.id, { transaction_id: randomUUID() })).status).toBe(422);
    expect((await match(admin(), line.id, { anomaly_id: randomUUID() })).status).toBe(422);
    const both = await match(admin(), line.id, {
      transaction_id: tx.free2,
      anomaly_id: randomUUID(),
    });
    expect(both.status).toBe(400);
    expect((await match(admin(), line.id, {})).status).toBe(400);
    expect((await match(admin(), line.id, { transaction_id: 'x' })).status).toBe(400);
    expect((await match(admin(), line.id, { transaction_id: tx.free2, note: 'x' })).status).toBe(
      400,
    );
    expect((await match(admin(), line.id, [])).status).toBe(400);
    // Anomalie d'un autre prestataire et anomalie de type non PSP.
    const other = await withOwner(async (db) => {
      await db.query(`SELECT set_config('app.operator_id', $1, false)`, [s.w.ops.b]);
      return makeAnomaly(db, s, 'PSP_MISMATCH', s.ledgerB);
    });
    expect((await match(admin(), line.id, { anomaly_id: other })).status).toBe(422);
    const cash = await withOwner((db) => makeAnomaly(db, s, 'CASH_DIFF'));
    expect((await match(admin(), line.id, { anomaly_id: cash })).status).toBe(422);
    expect((await lineOf('LIBRE-2', 'om')).matched_by).toBeNull();
  });

  it('FR-015 : rapprochement à une anomalie PSP ouverte', async () => {
    const anomaly = await withOwner((db) => makeAnomaly(db, s, 'PSP_TOPUP_NOT_CREDITED'));
    const line = await lineOf('LIBRE-ANOMALIE', 'om');
    const res = await match(admin(), line.id, { anomaly_id: anomaly });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      matched: true,
      matched_anomaly_id: anomaly,
      matched_transaction_id: null,
    });
  });

  it('isolation et rôles : autre prestataire 404, SUPERVISOR et CASHIER 403, autre organisateur 403, sans jeton 401', async () => {
    const line = await lineOf('LIBRE-3', 'om');
    const body = { transaction_id: tx.free3 };
    expect((await match(s.operatorAdminB, line.id, body)).status).toBe(404);
    for (const who of [s.w.supervisorA, s.w.cashierA, s.otherOrganizerAdmin])
      expect((await match(who, line.id, body)).status).toBe(403);
    expect((await match(null, line.id, body)).status).toBe(401);
    expect((await match(admin(), 999_999_999, body)).status).toBe(404);
    expect((await match(admin(), 'abc', body)).status).toBe(404);
    expect((await match(admin(), '0', body)).status).toBe(404);
    expect((await lineOf('LIBRE-3', 'om')).matched_by).toBeNull();
    // Le prestataire B ne rapproche pas non plus sa propre ligne à une transaction de A.
    const lineB = await importStatement(s, s.operatorAdminB, csvFile([['B-1', '2026-01-10', 1]]), {
      ledger: s.ledgerB,
      account: s.acct.waveB,
      source: 'b',
    });
    expect(lineB.status).toBe(201);
    const idB = (await lineOf('B-1', 'b')).id;
    expect((await match(s.operatorAdminB, idB, { transaction_id: tx.free3 })).status).toBe(422);
  });

  it('même clé d’idempotence : la réponse est rejouée, un seul rapprochement', async () => {
    const line = await lineOf('LIBRE-3', 'om');
    const key = randomUUID();
    const one = await match(admin(), line.id, { transaction_id: tx.free3 }, key);
    const two = await match(admin(), line.id, { transaction_id: tx.free3 }, key);
    expect([one.status, two.status]).toEqual([200, 200]);
    expect(two.body).toEqual(one.body);
    const audit = await lineRows<{ n: string }>(
      "SELECT count(*) AS n FROM audit_log WHERE action = 'STATEMENT_LINE_MATCHED' AND object_id = $1",
      [line.id],
    );
    expect(Number(audit[0]!.n)).toBe(1);
  });

  it('signe et montant : jamais de rapprochement automatique si le signe ou le montant diffère', async () => {
    // La base (WP02, migration 0083) compare le signe et le montant avant tout rapprochement automatique.
    await withOwner(async (db) => {
      await db.query(`SELECT set_config('app.operator_id', $1, false)`, [s.w.ops.a]);
      await makePspTopup(db, s, 'SIGNE-REF', await makeTx(db, s, s.acct.carte, 1000));
      await makePspTopup(db, s, 'MONTANT-REF', await makeTx(db, s, s.acct.carte, 1000));
    });
    const res = await importStatement(
      s,
      admin(),
      csvFile([
        ['SIGNE-REF', '2026-01-10', -1000],
        ['MONTANT-REF', '2026-01-10', 999],
      ]),
      { account: s.acct.carte, source: 'signe' },
    );
    expect(res.body).toMatchObject({ lines_created: 2, lines_matched: 0 });
    for (const ref of ['SIGNE-REF', 'MONTANT-REF']) {
      const line = await lineOf(ref, 'signe');
      expect([line.matched_tx_id, line.matched_anomaly_id]).toEqual([null, null]);
    }
  });
});
