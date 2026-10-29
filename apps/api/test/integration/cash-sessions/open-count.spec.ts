// Ouverture et comptage des sessions de caisse (mission 6, lot WP08, T037 et T038 ; FR-001, FR-002, FR-003 ;
// contracts/cash.md règles 1 à 3, R-04). HTTPS réel, trois preuves du terminal ET une personne.
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { parseCount } from '../../../src/cash-sessions/cash-sessions.dto';
import { contractViolations } from '../../support/contract-schema';
import { ownerRows } from '../../support/media-fixtures';
import { CashWorld } from './cash-session-fixtures';

jest.setTimeout(240_000);

describe('ouverture et comptage d’une session de caisse (WP08)', () => {
  let cw: CashWorld;
  beforeAll(async () => {
    cw = await CashWorld.create();
  });
  afterAll(async () => {
    await cw?.close();
  });
  const problem = (res: { status: number; body: Record<string, unknown> }) => [
    res.status,
    res.body.code,
  ];

  it('FR-001 : ouverture par le terminal ET le caissier → 201, forme du contrat, aucune écriture comptable', async () => {
    const t = await cw.terminal();
    const before = await cw.journalCount(cw.a.ledgerId);
    const postings = () =>
      ownerRows<{ n: number }>(
        `SELECT count(*)::int AS n FROM posting p JOIN account a ON a.id = p.account_id
          WHERE a.ledger_id = $1`,
        [cw.a.ledgerId],
      ).then((r) => r[0]!.n);
    const postingsBefore = await postings();
    const res = await cw.term(t, 'POST', '/cash-sessions', cw.w.cashierA);
    expect(res.status).toBe(201);
    expect(contractViolations('CashSession', res.body)).toEqual([]);
    expect(res.body).toMatchObject({
      status: 'OPEN',
      device_id: t.deviceId,
      opened_by: cw.w.cashierA.userId,
      last_count: null,
      expected_amount: null,
      difference: null,
      counted_amount: null,
      cash_close_transaction_id: null,
    });
    expect(await cw.journalCount(cw.a.ledgerId)).toBe(before);
    expect(await postings()).toBe(postingsBefore);
    // Le compte `A-CAISSE-<série>` est créé par la base à la première ouverture.
    expect(
      await ownerRows<{ id: string }>(
        `SELECT id FROM account WHERE ledger_id = $1 AND code = $2 AND purpose = 'CASH_DESK'`,
        [cw.a.ledgerId, `A-CAISSE-${t.serial}`],
      ),
    ).toEqual([{ id: res.body.cash_account_id }]);
    // Audit (FR-031).
    expect(
      await ownerRows(
        `SELECT actor_id FROM audit_log WHERE action = 'CASH_SESSION_OPENED' AND object_id = $1`,
        [res.body.cash_session_id],
      ),
    ).toEqual([{ actor_id: cw.w.cashierA.userId }]);
  });

  it('R-04 : sans jeton de personne 401, sans preuve de terminal 401, personne seule 401', async () => {
    const t = await cw.terminal();
    expect(problem(await cw.term(t, 'POST', '/cash-sessions', null))).toEqual([
      401,
      'UNAUTHENTICATED',
    ]);
    // Jeton de personne seul, dans Authorization puis dans X-Staff-Authorization : jamais une ouverture.
    expect((await cw.bo('POST', '/cash-sessions', cw.w.cashierA)).status).toBe(401);
    const staffOnly = await cw.bo('POST', '/cash-sessions', cw.w.cashierA, {}, randomUUID(), {
      'x-staff-authorization': `Bearer ${cw.w.cashierA.token}`,
    });
    expect(staffOnly.status).toBe(401);
    expect(
      await ownerRows('SELECT 1 FROM cash_session WHERE device_id = $1', [t.deviceId]),
    ).toEqual([]);
  });

  it('mode du terminal ≠ TOPUP_DESK → 422 DEVICE_MODE_NOT_ALLOWED', async () => {
    const t = await cw.terminal(cw.a, 'CATALOG_POS');
    expect(problem(await cw.term(t, 'POST', '/cash-sessions', cw.w.cashierA))).toEqual([
      422,
      'DEVICE_MODE_NOT_ALLOWED',
    ]);
  });

  it('événement hors service → 409 ; double ouverture (même terminal) → 409 ; rien de plus', async () => {
    const draft = await cw.draftEvent();
    const dt = await cw.terminal(draft);
    // Pas de rôle sur l'événement brouillon pour le caissier de A (portée EVENT) : refus avant la base.
    expect((await cw.term(dt, 'POST', '/cash-sessions', cw.w.cashierA)).status).toBe(403);
    const t = await cw.terminal();
    await cw.open(t, cw.w.cashierA);
    expect(problem(await cw.term(t, 'POST', '/cash-sessions', cw.w.cashierA))).toEqual([
      409,
      'CONFLICT_STATE',
    ]);
    expect(
      await ownerRows('SELECT 1 FROM cash_session WHERE device_id = $1', [t.deviceId]),
    ).toHaveLength(1);
  });

  it('événement non LIVE avec une personne de son organisateur → 409 (la base refuse)', async () => {
    const draft = await cw.draftEvent();
    const dt = await cw.terminal(draft);
    // Le SUPERVISOR de l'organisateur A couvre aussi l'événement brouillon.
    expect(problem(await cw.term(dt, 'POST', '/cash-sessions', cw.w.supervisorA))).toEqual([
      409,
      'CONFLICT_STATE',
    ]);
  });

  it('deux ouvertures simultanées de clés différentes : une seule gagne, l’autre 409', async () => {
    const t = await cw.terminal();
    const [x, y] = await Promise.all([
      cw.term(t, 'POST', '/cash-sessions', cw.w.cashierA, {}, t.seqKey()),
      cw.term(t, 'POST', '/cash-sessions', cw.w.cashierA, {}, t.seqKey()),
    ]);
    expect([x.status, y.status].sort()).toEqual([201, 409]);
  });

  it('rejeu de la clé : même réponse, une seule session ; clé mal formée → 422', async () => {
    const t = await cw.terminal();
    const key = t.seqKey();
    const first = await cw.term(t, 'POST', '/cash-sessions', cw.w.cashierA, {}, key);
    const again = await cw.term(t, 'POST', '/cash-sessions', cw.w.cashierA, {}, key);
    expect([first.status, again.status]).toEqual([201, 201]);
    expect(again.body).toEqual(first.body);
    expect(again.headers['idempotency-replayed']).toBe('true');
    expect(
      await ownerRows('SELECT 1 FROM cash_session WHERE device_id = $1', [t.deviceId]),
    ).toHaveLength(1);
    const t2 = await cw.terminal();
    expect((await cw.term(t2, 'POST', '/cash-sessions', cw.w.cashierA, {}, 'abc')).status).toBe(
      422,
    );
    expect(
      (await cw.term(t2, 'POST', '/cash-sessions', cw.w.cashierA, {}, `AUTRE-SERIE:0001`)).status,
    ).toBe(422);
  });

  it('le terminal décide de la caisse : device_id inconnu 422, cash_account_id d’une autre caisse 422', async () => {
    const t = await cw.terminal();
    const other = await cw.terminal();
    const otherSession = await cw.open(other, cw.w.cashierA);
    const otherAccount = (
      await cw.term(other, 'GET', `/cash-sessions/${otherSession}`, cw.w.cashierA)
    ).body.cash_account_id;
    expect(
      problem(
        await cw.term(t, 'POST', '/cash-sessions', cw.w.cashierA, { device_id: other.deviceId }),
      ),
    ).toEqual([422, 'VALIDATION_FAILED']);
    expect(
      problem(
        await cw.term(t, 'POST', '/cash-sessions', cw.w.cashierA, {
          cash_account_id: otherAccount,
        }),
      ),
    ).toEqual([422, 'VALIDATION_FAILED']);
    expect(
      problem(
        await cw.term(t, 'POST', '/cash-sessions', cw.w.cashierA, {
          cash_account_id: randomUUID(),
        }),
      ),
    ).toEqual([422, 'VALIDATION_FAILED']);
    expect(
      problem(await cw.term(t, 'POST', '/cash-sessions', cw.w.cashierA, { cash_account_id: 'x' })),
    ).toEqual([422, 'VALIDATION_FAILED']);
    expect(
      await ownerRows('SELECT 1 FROM cash_session WHERE device_id = $1', [t.deviceId]),
    ).toEqual([]);
  });

  it('droits : personne sans rôle de caisse 403 ; rôle sur un AUTRE événement du même prestataire 403 ; autre prestataire 404', async () => {
    const t = await cw.terminal();
    expect((await cw.term(t, 'POST', '/cash-sessions', cw.w.operatorAdminA)).status).toBe(403);
    // Acteur d'un autre événement du même prestataire : refus (contrôle côté API, la base ne le garantit pas partout).
    expect(problem(await cw.term(t, 'POST', '/cash-sessions', cw.cashierOfB))).toEqual([
      403,
      'FORBIDDEN',
    ]);
    expect(problem(await cw.term(t, 'POST', '/cash-sessions', cw.w.cashierB))).toEqual([
      404,
      'NOT_FOUND',
    ]);
    expect(
      await ownerRows('SELECT 1 FROM cash_session WHERE device_id = $1', [t.deviceId]),
    ).toEqual([]);
  });

  it('FR-002 : comptage → 200, réponse SANS théorique ni écart, numéros successifs, audit', async () => {
    const { t, id } = await cw.ready({ expected: 10_000, counted: null });
    const res = await cw.count(t, id, cw.w.cashierA, 9_500, { note: 'comptage du soir' });
    expect(res.status).toBe(200);
    expect(contractViolations('CashSession', res.body)).toEqual([]);
    expect(res.body).toMatchObject({
      status: 'OPEN',
      expected_amount: null,
      difference: null,
      last_count: { counted_amount: 9_500, counted_by: cw.w.cashierA.userId },
    });
    expect(JSON.stringify(res.body)).not.toContain('10000');
    // Un SUPERVISOR de l'événement peut compter aussi.
    const again = await cw.count(t, id, cw.supervisor, 9_400);
    expect(again.status).toBe(200);
    expect(again.body.expected_amount).toBeNull();
    expect((await cw.counts(id)).map((c) => [c.count_no, c.counted_amount])).toEqual([
      [1, '9500'],
      [2, '9400'],
    ]);
    expect(
      await ownerRows<{ after: { count_no: number; counted_amount: string } }>(
        `SELECT after FROM audit_log WHERE action = 'CASH_SESSION_COUNTED' AND object_id = $1
          ORDER BY seq`,
        [id],
      ),
    ).toHaveLength(2);
    // Comptage à 0 d'une caisse non vide : autorisé.
    expect((await cw.count(t, id, cw.w.cashierA, 0)).status).toBe(200);
  });

  it('comptage : montant négatif, décimal, chaîne, date absente, champ inconnu, note trop longue → 422 ; rien d’écrit', async () => {
    const { t, id } = await cw.ready({ expected: 0, counted: null });
    const bad = [
      { counted_amount: -1 },
      { counted_amount: 1.5 },
      { counted_amount: '500' },
      { counted_amount: 10 ** 17 },
      { counted_at: undefined },
      { counted_at: 'pas une date' },
      { device_id: t.deviceId },
      { note: 'x'.repeat(201) },
    ];
    for (const extra of bad) {
      const res = await cw.count(t, id, cw.w.cashierA, 100, extra);
      expect([res.status, res.body.code]).toEqual([422, 'VALIDATION_FAILED']);
    }
    expect(await cw.counts(id)).toEqual([]);
    // `-0` ne passe pas la validation (JSON ne le transporte pas : prouvé sur l’analyse du corps).
    expect(() =>
      parseCount({ counted_amount: -0, counted_at: new Date().toISOString() }),
    ).toThrow();
    expect(() =>
      parseCount({ counted_amount: 0, counted_at: new Date().toISOString() }),
    ).not.toThrow();
  });

  it('comptage : session d’un AUTRE terminal, inconnue ou mal formée → 404 neutre', async () => {
    const a = await cw.ready({ expected: 0, counted: null });
    const b = await cw.terminal();
    await cw.open(b, cw.w.cashierA);
    expect(problem(await cw.count(b, a.id, cw.w.cashierA, 100))).toEqual([404, 'NOT_FOUND']);
    expect(problem(await cw.count(a.t, randomUUID(), cw.w.cashierA, 100))).toEqual([
      404,
      'NOT_FOUND',
    ]);
    expect(problem(await cw.count(a.t, 'pas-un-uuid', cw.w.cashierA, 100))).toEqual([
      404,
      'NOT_FOUND',
    ]);
    expect(await cw.counts(a.id)).toEqual([]);
  });

  it('droits du comptage : sans rôle 403 ; rôle sur un autre événement 403 ; autre prestataire 404', async () => {
    const { t, id } = await cw.ready({ expected: 0, counted: null });
    expect((await cw.count(t, id, cw.w.operatorAdminA, 100)).status).toBe(403);
    expect(problem(await cw.count(t, id, cw.supervisorOfB, 100))).toEqual([403, 'FORBIDDEN']);
    expect(problem(await cw.count(t, id, cw.w.cashierB, 100))).toEqual([404, 'NOT_FOUND']);
    expect(await cw.counts(id)).toEqual([]);
  });

  it('au plus 10 comptages : le 11e → 409, session inchangée', async () => {
    const { t, id } = await cw.ready({ expected: 0, counted: null });
    for (let n = 1; n <= 10; n += 1)
      expect((await cw.count(t, id, cw.w.cashierA, n)).status).toBe(200);
    expect(problem(await cw.count(t, id, cw.w.cashierA, 11))).toEqual([409, 'CONFLICT_STATE']);
    expect(await cw.counts(id)).toHaveLength(10);
    expect((await cw.session(id)).status).toBe('OPEN');
  });

  it('deux comptages simultanés : numéros distincts, sans saut', async () => {
    const { t, id } = await cw.ready({ expected: 0, counted: null });
    const [x, y] = await Promise.all([
      cw.count(t, id, cw.w.cashierA, 100),
      cw.count(t, id, cw.supervisor, 200),
    ]);
    expect([x.status, y.status]).toEqual([200, 200]);
    expect((await cw.counts(id)).map((c) => c.count_no)).toEqual([1, 2]);
  });

  it('heure du comptage : celle de la base (counted_at du corps validé, non retenu)', async () => {
    const { t, id } = await cw.ready({ expected: 0, counted: null });
    const res = await cw.count(t, id, cw.w.cashierA, 100, { counted_at: '2020-01-01T00:00:00Z' });
    expect(res.status).toBe(200);
    expect(String((res.body.last_count as { counted_at: string }).counted_at)).not.toContain(
      '2020-01-01',
    );
  });
});
