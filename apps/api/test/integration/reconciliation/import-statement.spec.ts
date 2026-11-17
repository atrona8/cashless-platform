// Intégration (mission 9b, WP09 ; FR-013, FR-024, SC-003) : `importAccountStatement`.
import { randomUUID } from 'node:crypto';
import { contractViolations } from '../../support/contract-schema';
import { withOwner } from '../../support/db';
import {
  createStatementWorld,
  csvFile,
  importStatement,
  lineRows,
  makePspTopup,
  makeTx,
  sha256,
  type StatementWorld,
} from './statement-fixtures';

describe('import d’un relevé (POST /ledgers/{id}/accounts/{id}/statements)', () => {
  let s: StatementWorld;
  const admin = () => s.w.operatorAdminA;
  const count = async (sql: string, params: unknown[] = []) =>
    Number((await lineRows<{ n: string }>(sql, params))[0]!.n);
  const lines = (account: string) =>
    count('SELECT count(*) AS n FROM external_statement_line WHERE account_id = $1', [account]);
  const imports = (account: string) =>
    count('SELECT count(*) AS n FROM statement_import WHERE account_id = $1', [account]);

  beforeAll(async () => {
    s = await createStatementWorld();
    // 8 recharges de la carte référencées C-1 à C-8 (1000 chacune).
    await withOwner(async (db) => {
      await db.query(`SELECT set_config('app.operator_id', $1, false)`, [s.w.ops.a]);
      for (let n = 1; n <= 8; n += 1)
        await makePspTopup(db, s, `C-${n}`, await makeTx(db, s, s.acct.carte, 1000));
    });
  });
  afterAll(async () => {
    await s.app.close();
  });

  it('FR-013, SC-003 : 10 lignes dont 8 connues, 8 rapprochées ; réimport et recouvrement sans doublon', async () => {
    const rows: Array<[string, string, number]> = [];
    for (let n = 1; n <= 8; n += 1) rows.push([`C-${n}`, '2026-01-10', 1000]);
    rows.push(['INCONNUE-1', '2026-01-11', 600], ['INCONNUE-2', '2026-01-11', 400]);
    const file = csvFile(rows);
    const first = await importStatement(s, admin(), file, {
      account: s.acct.carte,
      source: 'carte',
    });
    expect(first.status).toBe(201);
    expect(contractViolations('StatementImportResult', first.body)).toEqual([]);
    expect(first.body).toMatchObject({
      account_id: s.acct.carte,
      lines_created: 10,
      lines_matched: 8,
      lines_existing: 0,
    });
    expect(await lines(s.acct.carte)).toBe(10);

    // Même fichier, autre clé d'idempotence : aucune ligne de plus, `lines_created` à 0.
    const again = await importStatement(s, admin(), file, {
      account: s.acct.carte,
      source: 'carte',
    });
    expect(again.status).toBe(201);
    expect(again.body).toMatchObject({ lines_created: 0, lines_existing: 10 });
    expect(again.body.statement_import_id).toBe(first.body.statement_import_id);
    expect(await lines(s.acct.carte)).toBe(10);
    expect(await imports(s.acct.carte)).toBe(1);

    // Fichier qui en recoupe un autre : 1 ligne neuve, 3 déjà présentes.
    const overlap = csvFile([
      ['C-1', '2026-01-10', 1000],
      ['C-2', '2026-01-10', 1000],
      ['C-3', '2026-01-10', 1000],
      ['NEUVE-1', '2026-01-12', 5],
    ]);
    const over = await importStatement(s, admin(), overlap, {
      account: s.acct.carte,
      source: 'carte',
    });
    expect(over.body).toMatchObject({ lines_created: 1, lines_existing: 3 });
    expect(await lines(s.acct.carte)).toBe(11);
  });

  it('rejoue la même clé d’idempotence : même réponse, aucune écriture de plus', async () => {
    const key = randomUUID();
    const file = csvFile([['IDEM-1', '2026-01-12', 5]]);
    const one = await importStatement(s, admin(), file, { account: s.acct.om, key, source: 'om' });
    const two = await importStatement(s, admin(), file, { account: s.acct.om, key, source: 'om' });
    expect(two.status).toBe(201);
    expect(two.body).toEqual(one.body);
    expect(two.headers['idempotency-replayed']).toBe('true');
    expect(await lines(s.acct.om)).toBe(1);
  });

  it('caractère de contrôle dans une référence (NUL, tabulation) : 422, rejeu de la même clé aussi', async () => {
    const before = await lines(s.acct.wave);
    for (const bad of ['A\u0000B', 'A\u0001B', 'A\tB', 'A\u007fB']) {
      const key = randomUUID();
      const body = csvFile([[bad, '2026-01-10', 5]]);
      const one = await importStatement(s, admin(), body, { key });
      expect([bad, one.status, one.body.code]).toEqual([bad, 422, 'VALIDATION_FAILED']);
      const two = await importStatement(s, admin(), body, { key });
      expect([bad, two.status]).toEqual([bad, 422]);
    }
    expect(await lines(s.acct.wave)).toBe(before);
  });

  it('même fichier avec une autre source, date ou solde : 409 ; mêmes paramètres : réponse inchangée', async () => {
    const file = csvFile([['CHG-1', '2026-01-10', 5]]);
    const base = { account: s.acct.carte, source: 'chg', date: '2026-01-31', closing: 100 };
    const first = await importStatement(s, admin(), file, base);
    expect(first.status).toBe(201);
    const same = await importStatement(s, admin(), file, base);
    expect([same.status, same.body.statement_import_id]).toEqual([
      201,
      first.body.statement_import_id,
    ]);
    for (const change of [{ closing: 101 }, { date: '2026-02-01' }, { source: 'autre' }]) {
      const res = await importStatement(s, admin(), file, { ...base, ...change });
      expect([JSON.stringify(change), res.status, res.body.code]).toEqual([
        JSON.stringify(change),
        409,
        'CONFLICT_STATE',
      ]);
    }
    const kept = await lineRows<{ closing_balance: string; source: string }>(
      'SELECT closing_balance::text, source FROM statement_import WHERE account_id = $1 AND source = $2',
      [s.acct.carte, 'chg'],
    );
    expect(kept).toEqual([{ closing_balance: '100', source: 'chg' }]);
  });

  it('source avec caractère de contrôle : 400 (NUL, 0x01, tabulation), rien d’écrit', async () => {
    const before = await imports(s.acct.wave);
    for (const source of ['a\u0000b', 'a\u0001b', 'a\tb']) {
      const res = await importStatement(s, admin(), csvFile([['SRC-1', '2026-01-10', 5]]), {
        source,
      });
      expect([JSON.stringify(source), res.status]).toEqual([JSON.stringify(source), 400]);
    }
    expect(await imports(s.acct.wave)).toBe(before);
  });

  it('6 imports parallèles du même fichier avec 6 soldes : un seul solde retenu, les autres 409', async () => {
    const file = csvFile([['PAR-1', '2026-01-10', 7]]);
    const base = { account: s.acct.bank, source: 'par' };
    const res = await Promise.all(
      [1, 2, 3, 4, 5, 6].map((closing) => importStatement(s, admin(), file, { ...base, closing })),
    );
    const ok = res.filter((r) => r.status === 201);
    expect(ok).toHaveLength(1);
    expect(res.filter((r) => r.status === 409)).toHaveLength(5);
    const rows = await lineRows<{ closing_balance: string }>(
      "SELECT closing_balance::text FROM statement_import WHERE account_id = $1 AND source = 'par'",
      [s.acct.bank],
    );
    expect(rows).toHaveLength(1);
    const par = await lineRows<{ n: string }>(
      "SELECT count(*) AS n FROM external_statement_line WHERE account_id = $1 AND source = 'par'",
      [s.acct.bank],
    );
    expect(Number(par[0]!.n)).toBe(1);
  });

  it('FR-013 : refus du fichier entier, rien d’écrit', async () => {
    const before = { lines: await lines(s.acct.wave), imports: await imports(s.acct.wave) };
    const cases: Array<[string, string, number]> = [
      ['devise étrangère', csvFile([['R-1', '2026-01-10', 5, 'EUR']]), 422],
      [
        'en-tête faux',
        csvFile([['R-1', '2026-01-10', 5]], false).replace(/^/, 'ref;date;montant;dev\r\n'),
        422,
      ],
      ['sans en-tête', csvFile([['R-1', '2026-01-10', 5]], false), 422],
      ['date invalide', csvFile([['R-1', '2026-02-30', 5]]), 422],
      ['montant nul', csvFile([['R-1', '2026-01-10', 0]]), 422],
      ['montant non entier', csvFile([['R-1', '2026-01-10', '5.5']]), 422],
      ['référence vide', csvFile([['', '2026-01-10', 5]]), 422],
      [
        'une ligne mauvaise parmi de bonnes',
        csvFile([
          ['R-1', '2026-01-10', 5],
          ['R-2', 'x', 5],
        ]),
        422,
      ],
      [
        'mauvais séparateur',
        'external_ref,value_date,amount,currency\nR-1,2026-01-10,5,XOF\n',
        422,
      ],
      ['fichier sans ligne', 'external_ref;value_date;amount;currency\r\n', 422],
    ].map(([name, body, status]) => [name, body, status] as [string, string, number]);
    for (const [name, body, status] of cases) {
      const res = await importStatement(s, admin(), body);
      expect([name, res.status]).toEqual([name, status]);
      expect(res.body.code).toBe('VALIDATION_FAILED');
      // Jamais le contenu du fichier dans l'erreur.
      expect(JSON.stringify(res.body)).not.toContain('R-1');
    }
    expect(await lines(s.acct.wave)).toBe(before.lines);
    expect(await imports(s.acct.wave)).toBe(before.imports);
  });

  it('400 : paramètres absents ou mal formés, fichier de plus de 1 Mo, corps absent', async () => {
    const ok = csvFile([['P-1', '2026-01-10', 5]]);
    expect((await importStatement(s, admin(), ok, { date: '31/01/2026' })).status).toBe(400);
    expect((await importStatement(s, admin(), ok, { closing: 'abc' })).status).toBe(400);
    expect((await importStatement(s, admin(), ok, { closing: '1.5' })).status).toBe(400);
    expect((await importStatement(s, admin(), ok, { source: ' ' })).status).toBe(400);
    expect((await importStatement(s, admin(), '')).status).toBe(400);
    const big = csvFile(Array.from({ length: 60_000 }, (_, k) => [`BIG-${k}`, '2026-01-10', 1]));
    expect(big.length).toBeGreaterThan(1_048_576);
    const res = await importStatement(s, admin(), big);
    expect(res.status).toBe(400);
    expect(await lines(s.acct.wave)).toBe(0);
  });

  it('portée : compte d’un autre grand livre ou prestataire, compte non d’argent, caisse', async () => {
    const ok = csvFile([['S-1', '2026-01-10', 5]]);
    // Prestataire B sur le grand livre de A : introuvable.
    expect((await importStatement(s, s.operatorAdminB, ok)).status).toBe(404);
    // Personne de A, compte de B sous le grand livre de A : introuvable.
    expect((await importStatement(s, admin(), ok, { account: s.acct.waveB })).status).toBe(404);
    // Personne de A sur le grand livre de B : introuvable (isolation).
    expect(
      (await importStatement(s, admin(), ok, { ledger: s.ledgerB, account: s.acct.waveB })).status,
    ).toBe(404);
    // Compte de droits (CLAIM) et compte de caisse : refusés.
    expect((await importStatement(s, admin(), ok, { account: s.acct.liab })).status).toBe(422);
    expect((await importStatement(s, admin(), ok, { account: s.cashDesk })).status).toBe(422);
    expect((await importStatement(s, admin(), ok, { account: randomUUID() })).status).toBe(404);
    expect((await importStatement(s, admin(), ok, { ledger: 'pas-un-uuid' })).status).toBe(404);
    expect(await lines(s.acct.waveB)).toBe(0);
    expect(await lines(s.acct.liab)).toBe(0);
    expect(await lines(s.cashDesk)).toBe(0);
  });

  it('rôles : ORGANIZER_ADMIN de l’organisateur accepté ; SUPERVISOR, CASHIER, autre organisateur : 403 ; sans jeton : 401', async () => {
    const ok = (ref: string) => csvFile([[ref, '2026-01-10', 5]]);
    expect(
      (await importStatement(s, s.w.organizerAdminA, ok('ROLE-1'), { source: 'role' })).status,
    ).toBe(201);
    for (const who of [s.w.supervisorA, s.w.cashierA, s.otherOrganizerAdmin])
      expect((await importStatement(s, who, ok('ROLE-2'))).status).toBe(403);
    expect((await importStatement(s, null, ok('ROLE-2'))).status).toBe(401);
    expect(
      await count(
        "SELECT count(*) AS n FROM external_statement_line WHERE external_ref = 'ROLE-2'",
      ),
    ).toBe(0);
  });

  it('20 imports simultanés du même fichier : un seul jeu de lignes, aucun 500', async () => {
    const file = csvFile(Array.from({ length: 20 }, (_, k) => [`CON-${k}`, '2026-01-10', 7]));
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        importStatement(s, admin(), file, { account: s.acct.bank, source: 'banque' }),
      ),
    );
    expect(results.map((r) => r.status)).toEqual(Array(20).fill(201));
    expect(results.filter((r) => r.body.lines_created === 20)).toHaveLength(1);
    const own = await lineRows<{ n: string }>(
      "SELECT count(*) AS n FROM external_statement_line WHERE account_id = $1 AND source = 'banque'",
      [s.acct.bank],
    );
    expect(Number(own[0]!.n)).toBe(20);
    const imp = await lineRows<{ n: string }>(
      "SELECT count(*) AS n FROM statement_import WHERE account_id = $1 AND source = 'banque'",
      [s.acct.bank],
    );
    expect(Number(imp[0]!.n)).toBe(1);
  });

  it('lecture du fichier : BOM, CRLF, guillemets, formule : lus tels quels, jamais exécutés', async () => {
    const body =
      '﻿external_ref;value_date;amount;currency\r\n' +
      '"=1+1";2026-01-10;5;XOF\r\n' +
      '"a;b ""c""";2026-01-10;-5;XOF\r\n' +
      '"deux\nlignes";2026-01-10;5;XOF\r\n';
    const res = await importStatement(s, admin(), body, { account: s.acct.om, source: 'lecture' });
    // Une référence sur deux lignes est refusée : tout le fichier.
    expect(res.status).toBe(422);
    const good = body.replace('"deux\nlignes"', 'trois');
    const ok = await importStatement(s, admin(), good, { account: s.acct.om, source: 'lecture' });
    expect(ok.status).toBe(201);
    expect(ok.body.lines_created).toBe(3);
    const refs = (
      await lineRows<{ external_ref: string; amount: string }>(
        "SELECT external_ref, amount::text FROM external_statement_line WHERE source = 'lecture' ORDER BY id",
      )
    ).map((r) => [r.external_ref, r.amount]);
    expect(refs).toEqual([
      ['=1+1', '5'],
      ['a;b "c"', '-5'],
      ['trois', '5'],
    ]);
  });

  it('même (source, référence) sur un autre compte : accepté ; l’autre prestataire ne voit rien', async () => {
    const file = csvFile([['PARTAGE-1', '2026-01-10', 5]]);
    const a = await importStatement(s, admin(), file, { account: s.acct.wave, source: 'meme' });
    expect(a.body).toMatchObject({ lines_created: 1, lines_existing: 0 });
    const b = await importStatement(s, s.operatorAdminB, file, {
      ledger: s.ledgerB,
      account: s.acct.waveB,
      source: 'meme',
    });
    expect(b.status).toBe(201);
    expect(b.body).toMatchObject({ lines_created: 1, lines_existing: 0 });
    const c = await importStatement(s, admin(), file, { account: s.acct.om, source: 'meme' });
    expect(c.body).toMatchObject({ lines_created: 1, lines_existing: 0 });
  });

  it('FR-024 : une ligne d’audit par import, auteur correct, sans contenu du relevé', async () => {
    const file = csvFile([['AUDIT-SECRET-REF', '2026-01-10', 12345]]);
    const res = await importStatement(s, s.w.organizerAdminA, file, {
      account: s.acct.carte,
      source: 'audit',
    });
    expect(res.status).toBe(201);
    const audit = await lineRows<{
      actor_id: string;
      actor_role: string;
      after: Record<string, unknown>;
    }>(
      "SELECT actor_id, actor_role, after FROM audit_log WHERE action = 'STATEMENT_IMPORTED' AND object_id = $1",
      [res.body.statement_import_id],
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]!.actor_id).toBe(s.w.organizerAdminA.userId);
    expect(audit[0]!.actor_role).toBe('ORGANIZER_ADMIN');
    expect(audit[0]!.after).toMatchObject({
      account_id: s.acct.carte,
      file_sha256: sha256(file),
      lines_created: 1,
    });
    expect(JSON.stringify(audit[0]!.after)).not.toMatch(/AUDIT-SECRET-REF|12345/);
    const by = await lineRows<{ imported_by: string }>(
      'SELECT imported_by FROM statement_import WHERE id = $1',
      [res.body.statement_import_id],
    );
    expect(by[0]!.imported_by).toBe(s.w.organizerAdminA.userId);
  });
});
