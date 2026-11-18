// Intégration (mission 9b, WP09 ; FR-013) : `listStatementLines`.
import request from 'supertest';
import { contractViolations } from '../../support/contract-schema';
import type { TestPerson } from '../../support/fake-idp';
import {
  createStatementWorld,
  csvFile,
  importStatement,
  type StatementWorld,
} from './statement-fixtures';

describe('lignes de relevé (GET /ledgers/{id}/statement-lines)', () => {
  let s: StatementWorld;
  const admin = () => s.w.operatorAdminA;
  const list = (who: TestPerson | null, query = '', ledger = s.ledgerA) => {
    const req = request(s.app.getHttpServer()).get(`/v1/ledgers/${ledger}/statement-lines${query}`);
    return who ? req.set('Authorization', `Bearer ${who.token}`) : req;
  };

  beforeAll(async () => {
    s = await createStatementWorld();
    const rows: Array<[string, string, number]> = [];
    for (let n = 1; n <= 7; n += 1) rows.push([`L-${n}`, `2026-01-${10 + (n % 3)}`, 100 + n]);
    expect((await importStatement(s, admin(), csvFile(rows), { source: 'wave' })).status).toBe(201);
    expect(
      (
        await importStatement(s, admin(), csvFile([['M-1', '2026-01-10', 5]]), {
          account: s.acct.om,
          source: 'om',
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await importStatement(s, s.operatorAdminB, csvFile([['L-1', '2026-01-10', 9]]), {
          ledger: s.ledgerB,
          account: s.acct.waveB,
          source: 'wave',
        })
      ).status,
    ).toBe(201);
  });
  afterAll(async () => {
    await s.app.close();
  });

  it('page contractuelle, filtre par compte, tri stable par date de valeur puis id', async () => {
    const all = await list(admin());
    expect(all.status).toBe(200);
    expect(all.body.data).toHaveLength(8);
    for (const line of all.body.data) expect(contractViolations('StatementLine', line)).toEqual([]);
    const keys = all.body.data.map((l: { value_date: string; statement_line_id: number }) => [
      l.value_date,
      l.statement_line_id,
    ]);
    expect(keys).toEqual(
      [...keys].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1])),
    );
    const om = await list(admin(), `?account_id=${s.acct.om}`);
    expect(om.body.data.map((l: { external_ref: string }) => l.external_ref)).toEqual(['M-1']);
  });

  it('pagination par curseur : aucune ligne perdue ni répétée', async () => {
    const seen: number[] = [];
    let cursor = '';
    for (let guard = 0; guard < 10; guard += 1) {
      const page = await list(admin(), `?limit=3${cursor}`);
      expect(page.status).toBe(200);
      seen.push(...page.body.data.map((l: { statement_line_id: number }) => l.statement_line_id));
      if (!page.body.has_more) break;
      cursor = `&cursor=${page.body.next_cursor}`;
    }
    expect(seen).toHaveLength(8);
    expect(new Set(seen).size).toBe(8);
  });

  it('filtre matched strict : true, false ; autre valeur 400', async () => {
    expect((await list(admin(), '?matched=false')).body.data).toHaveLength(8);
    expect((await list(admin(), '?matched=true')).body.data).toHaveLength(0);
    expect((await list(admin(), '?matched=1')).status).toBe(400);
    expect((await list(admin(), '?matched=oui')).status).toBe(400);
    expect((await list(admin(), '?account_id=x')).status).toBe(400);
    expect((await list(admin(), '?cursor=zzz')).status).toBe(400);
  });

  it('isolation et rôles : B ne voit rien de A, SUPERVISOR et CASHIER 403, sans jeton 401', async () => {
    expect((await list(s.operatorAdminB)).status).toBe(404);
    const own = await list(s.operatorAdminB, '', s.ledgerB);
    expect(own.body.data.map((l: { external_ref: string }) => l.external_ref)).toEqual(['L-1']);
    expect((await list(admin(), '', s.ledgerB)).status).toBe(404);
    for (const who of [s.w.supervisorA, s.w.cashierA]) expect((await list(who)).status).toBe(403);
    expect((await list(null)).status).toBe(401);
  });
});
