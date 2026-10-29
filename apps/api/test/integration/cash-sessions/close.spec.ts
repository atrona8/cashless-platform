// Fermeture des sessions de caisse (mission 6, lot WP08, T039 ; FR-003, FR-029, FR-031 ; contracts/cash.md règles
// 4 à 6, 9). HTTPS réel, vraie base `cashless_wp08`. Le théorique est posé par une écriture réelle `TOPUP_CASH`
// (garde de caisse de la base comprise), jamais par un UPDATE de solde.
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { contractViolations } from '../../support/contract-schema';
import { withOwner } from '../../support/db';
import { ownerRows } from '../../support/media-fixtures';
import { CashWorld } from './cash-session-fixtures';

jest.setTimeout(240_000);

describe('fermeture d’une session de caisse (WP08)', () => {
  let cw: CashWorld;
  beforeAll(async () => {
    cw = await CashWorld.create();
  });
  afterAll(async () => {
    await cw?.close();
  });

  const row = (id: string) => cw.session(id);
  const closeTx = async (ledgerId: string, id: string) =>
    (await cw.transactionsOf(ledgerId, 'CASH_CLOSE')).filter(
      (t) => t.idempotency_key === `cash-close:${id}`,
    );
  const anomalyOf = (id: unknown) =>
    ownerRows<{ kind: string; amount: string; device_id: string; status: string }>(
      'SELECT kind, amount::text, device_id, status FROM anomaly WHERE id = $1',
      [id],
    );

  it('back-office, compté = théorique : caisse à 0, transit augmenté, CASH_CLOSE cash-close:<id>, aucune anomalie', async () => {
    const { t, id } = await cw.ready({ expected: 10_000, counted: 10_000 });
    const transit = await cw.balance(cw.a.ledgerId, 'A-TRANSIT');
    expect(await cw.deskBalance(t)).toBe(10_000);
    const res = await cw.closeBo(id, cw.supervisor);
    expect(res.status).toBe(200);
    expect(contractViolations('CashSession', res.body)).toEqual([]);
    expect(res.body).toMatchObject({
      status: 'CLOSED',
      closed_by: cw.supervisor.userId,
      counted_amount: 10_000,
      expected_amount: 10_000,
      difference: 0,
      cash_diff_anomaly_id: null,
    });
    const [tx] = await closeTx(cw.a.ledgerId, id);
    expect(tx).toBeDefined();
    expect(res.body.cash_close_transaction_id).toBe(tx!.id);
    expect(tx).toMatchObject({ source: 'ONLINE', created_by: cw.supervisor.userId });
    expect(await cw.deskBalance(t)).toBe(0);
    expect(await cw.balance(cw.a.ledgerId, 'A-TRANSIT')).toBe(transit + 10_000);
    expect(await row(id)).toMatchObject({ status: 'CLOSED', close_tx_id: tx!.id });
    expect(
      await ownerRows(
        `SELECT actor_id FROM audit_log WHERE action = 'CASH_SESSION_CLOSED' AND object_id = $1`,
        [id],
      ),
    ).toEqual([{ actor_id: cw.supervisor.userId }]);
  });

  it('au terminal (trois preuves + SUPERVISOR) : mêmes écritures, la caisse du terminal à 0', async () => {
    const { t, id } = await cw.ready({ expected: 4_000, counted: 4_000 });
    const res = await cw.closeTerm(t, id, cw.supervisor);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('CLOSED');
    const [tx] = await closeTx(cw.a.ledgerId, id);
    expect(tx).toBeDefined();
    expect(
      await ownerRows<{ device_id: string }>(
        'SELECT device_id FROM journal_transaction WHERE id = $1',
        [tx!.id],
      ),
    ).toEqual([{ device_id: t.deviceId }]);
    expect(await cw.deskBalance(t)).toBe(0);
  });

  it('manque, payeur ORGANIZER (événement A) : anomalie CASH_DIFF, écart aux pertes de l’organisateur', async () => {
    const { t, id } = await cw.ready({ expected: 10_000, counted: 9_000 });
    const res = await cw.closeBo(id, cw.supervisor);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      counted_amount: 9_000,
      expected_amount: 10_000,
      difference: -1_000,
    });
    expect(await anomalyOf(res.body.cash_diff_anomaly_id)).toEqual([
      { kind: 'CASH_DIFF', amount: '1000', device_id: t.deviceId, status: 'OPEN' },
    ]);
    const lines = await cw.lines(String(res.body.cash_close_transaction_id));
    const loss = lines.find((l) => l.code.includes('PERTES'));
    expect(loss!.code).toMatch(/ORG/);
    expect(Number(loss!.amount)).toBe(1_000);
    expect(await cw.deskBalance(t)).toBe(0);
  });

  it('surplus, payeur OPERATOR (événement B) : écart positif, pertes de l’opérateur au crédit', async () => {
    const t = await cw.terminal(cw.b);
    const { id } = await cw.ready({
      expected: 2_000,
      counted: 2_500,
      ev: cw.b,
      terminal: t,
      opener: cw.cashierOfB,
      counter: cw.cashierOfB,
    });
    const res = await cw.closeBo(id, cw.supervisorOfB);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ difference: 500 });
    const lines = await cw.lines(String(res.body.cash_close_transaction_id));
    const loss = lines.find((l) => l.code.includes('PERTES'));
    expect(loss!.code).toMatch(/OPE/);
    expect(Number(loss!.amount)).toBe(-500);
    expect((await anomalyOf(res.body.cash_diff_anomaly_id))[0]!.amount).toBe('500');
  });

  it('théorique 0 et compté > 0 (surplus seul) ; théorique > 0 et compté 0 (tout en manque)', async () => {
    const surplus = await cw.ready({ expected: 0, counted: 700 });
    const a = await cw.closeBo(surplus.id, cw.supervisor);
    expect(a.status).toBe(200);
    expect(a.body).toMatchObject({ expected_amount: 0, counted_amount: 700, difference: 700 });
    const missing = await cw.ready({ expected: 900, counted: 0 });
    const b = await cw.closeBo(missing.id, cw.supervisor);
    expect(b.status).toBe(200);
    expect(b.body).toMatchObject({ expected_amount: 900, counted_amount: 0, difference: -900 });
    expect(await cw.deskBalance(missing.t)).toBe(0);
  });

  it('théorique et compté nuls : session fermée sans transaction ni anomalie', async () => {
    const { id } = await cw.ready({ expected: 0, counted: 0 });
    const res = await cw.closeBo(id, cw.supervisor);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'CLOSED',
      cash_close_transaction_id: null,
      cash_diff_anomaly_id: null,
      difference: 0,
    });
    expect(await closeTx(cw.a.ledgerId, id)).toHaveLength(0);
    expect(await row(id)).toMatchObject({ status: 'CLOSED', close_tx_id: null });
  });

  it('aucun comptage : 409, la session reste ouverte', async () => {
    const { id } = await cw.ready({ expected: 1_000, counted: null });
    const res = await cw.closeBo(id, cw.supervisor);
    expect([res.status, res.body.code]).toEqual([409, 'CONFLICT_STATE']);
    expect((await row(id)).status).toBe('OPEN');
    expect(await closeTx(cw.a.ledgerId, id)).toHaveLength(0);
  });

  it('fermeur = compteur : 403, session OPEN, rien d’écrit ; compté par deux, fermé par un troisième', async () => {
    const { t, id } = await cw.ready({ expected: 3_000, counted: null });
    // Un SUPERVISOR compte (au terminal), puis tente de fermer : refusé aux deux chemins.
    expect((await cw.count(t, id, cw.supervisor, 3_000)).status).toBe(200);
    for (const res of [
      await cw.closeBo(id, cw.supervisor),
      await cw.closeTerm(t, id, cw.supervisor),
    ]) {
      expect([res.status, res.body.code]).toEqual([403, 'FORBIDDEN']);
    }
    expect(await row(id)).toMatchObject({ status: 'OPEN', closed_by: null });
    expect(await closeTx(cw.a.ledgerId, id)).toHaveLength(0);
    // Deux compteurs : ni l'un ni l'autre ne ferme ; un troisième ferme.
    expect((await cw.count(t, id, cw.supervisor2, 3_000)).status).toBe(200);
    expect((await cw.closeBo(id, cw.supervisor2)).status).toBe(403);
    expect((await cw.closeBo(id, cw.supervisor)).status).toBe(403);
    const done = await cw.closeBo(id, cw.supervisor3);
    expect(done.status).toBe(200);
    expect(done.body.closed_by).toBe(cw.supervisor3.userId);
  });

  it('ORGANIZER_ADMIN et CASHIER refusés (403), OPERATOR_ADMIN sans rôle de caisse (404) : session intacte', async () => {
    const { id } = await cw.ready({ expected: 1_500, counted: 1_500 });
    for (const who of [cw.w.organizerAdminA, cw.cashier2, cw.w.cashierA]) {
      const res = await cw.closeBo(id, who);
      expect([res.status, res.body.code]).toEqual([403, 'FORBIDDEN']);
    }
    expect((await cw.closeBo(id, cw.w.operatorAdminA)).status).toBe(404);
    expect(await row(id)).toMatchObject({ status: 'OPEN', closed_by: null });
    expect(await closeTx(cw.a.ledgerId, id)).toHaveLength(0);
    // Un tiers SUPERVISOR qui n'a rien compté le peut.
    expect((await cw.closeBo(id, cw.supervisor2)).status).toBe(200);
  });

  it('SUPERVISOR d’un autre événement : 404 ; autre prestataire : 404 ; session inconnue ou mal formée : 404', async () => {
    const { id } = await cw.ready({ expected: 800, counted: 800 });
    expect((await cw.closeBo(id, cw.supervisorOfB)).status).toBe(404);
    expect((await cw.closeBo(id, cw.supervisorOp2)).status).toBe(404);
    expect((await cw.closeBo(randomUUID(), cw.supervisor)).status).toBe(404);
    expect((await cw.closeBo('pas-un-uuid', cw.supervisor)).status).toBe(404);
    expect((await row(id)).status).toBe('OPEN');
  });

  it('session d’un AUTRE terminal : 404 ; sans X-Staff-Authorization, marqueur de terminal seul ou jeton de guichet seul : 401', async () => {
    const { id } = await cw.ready({ expected: 800, counted: 800 });
    const other = await cw.terminal();
    expect((await cw.closeTerm(other, id, cw.supervisor)).status).toBe(404);
    expect((await cw.term(other, 'POST', `/cash-sessions/${id}/close`, null)).status).toBe(401);
    // Marqueur de terminal sans preuves valides + jeton de personne dans Authorization : pas de repli.
    const mixed = await cw.bo(
      'POST',
      `/cash-sessions/${id}/close`,
      cw.supervisor,
      undefined,
      randomUUID(),
      { signature: 'sig1=:AAAA:', 'signature-input': 'sig1=("@method")' },
    );
    expect(mixed.status).toBe(401);
    const staff = await cw.bo(
      'POST',
      `/cash-sessions/${id}/close`,
      cw.supervisor,
      undefined,
      randomUUID(),
      { 'x-staff-authorization': `Bearer ${cw.supervisor.token}` },
    );
    expect(staff.status).toBe(401);
    expect((await row(id)).status).toBe('OPEN');
  });

  it('terminal révoqué : le terminal ne ferme plus, le back-office oui', async () => {
    const { t, id } = await cw.ready({ expected: 1_200, counted: 1_200 });
    await withOwner((db) => t.setStatus(db, 'REVOKED'));
    const res = await cw.closeTerm(t, id, cw.supervisor);
    expect(res.status).toBeGreaterThanOrEqual(401);
    expect((await row(id)).status).toBe('OPEN');
    const bo = await cw.closeBo(id, cw.supervisor);
    expect(bo.status).toBe(200);
    expect(await cw.deskBalance(t)).toBe(0);
  });

  it('rejeu de la même clé : même réponse, un seul CASH_CLOSE ; nouvelle clé sur session fermée : 409 ; clé réutilisée ailleurs : refusée', async () => {
    const { id } = await cw.ready({ expected: 2_200, counted: 2_000 });
    const key = randomUUID();
    const first = await cw.closeBo(id, cw.supervisor, key);
    const again = await cw.closeBo(id, cw.supervisor, key);
    expect([first.status, again.status]).toEqual([200, 200]);
    expect(again.body).toEqual(first.body);
    expect(again.headers['idempotency-replayed']).toBe('true');
    expect(await closeTx(cw.a.ledgerId, id)).toHaveLength(1);
    const fresh = await cw.closeBo(id, cw.supervisor2);
    expect([fresh.status, fresh.body.code]).toEqual([409, 'CONFLICT_STATE']);
    expect(await closeTx(cw.a.ledgerId, id)).toHaveLength(1);
    // Même clé, autre session : contenu différent.
    const other = await cw.ready({ expected: 100, counted: 100 });
    const reused = await cw.closeBo(other.id, cw.supervisor, key);
    expect(reused.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect((await row(other.id)).status).toBe('OPEN');
  });

  it('valeurs lues sous verrou : un corps de client (théorique, compté, compte) est sans effet', async () => {
    const { t, id } = await cw.ready({ expected: 5_000, counted: 4_000 });
    const res = await cw.bo('POST', `/cash-sessions/${id}/close`, cw.supervisor, {
      expected_amount: 1,
      counted_amount: 5_000,
      cash_account_id: randomUUID(),
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      expected_amount: 5_000,
      counted_amount: 4_000,
      difference: -1_000,
    });
    expect(await cw.deskBalance(t)).toBe(0);
  });

  it('atomicité : un échec après l’écriture du moteur annule tout (session OPEN, jamais CLOSING, aucune transaction)', async () => {
    const { t, id } = await cw.ready({ expected: 6_000, counted: 6_000 });
    const journal = await cw.journalCount(cw.a.ledgerId);
    const original = cw.engine.execute.bind(cw.engine);
    const spy = jest.spyOn(cw.engine, 'execute').mockImplementationOnce(async (client, command) => {
      await original(client, command);
      throw new Error('échec injecté après l’écriture');
    });
    const res = await cw.closeBo(id, cw.supervisor);
    spy.mockRestore();
    expect(res.status).toBe(500);
    expect(await row(id)).toMatchObject({ status: 'OPEN', closed_by: null, expected_amount: null });
    expect(await closeTx(cw.a.ledgerId, id)).toHaveLength(0);
    expect(await cw.journalCount(cw.a.ledgerId)).toBe(journal);
    expect(await cw.deskBalance(t)).toBe(6_000);
    // La fermeture reste possible ensuite.
    expect((await cw.closeBo(id, cw.supervisor)).status).toBe(200);
  });

  it('après fermeture, une écriture d’espèces sur la caisse est refusée par la garde de la base', async () => {
    const { t, id } = await cw.ready({ expected: 1_000, counted: 1_000 });
    expect((await cw.closeBo(id, cw.supervisor)).status).toBe(200);
    const error = (await cw.topupCash(t, 500).then(
      () => undefined,
      (e: unknown) => e,
    )) as { sqlstate?: string; code?: string; cause?: { code?: string } } | undefined;
    expect(error).toBeDefined();
    expect(error!.sqlstate ?? error!.cause?.code ?? error!.code).toBe('CL029');
    expect(await cw.deskBalance(t)).toBe(0);
  });

  it('grand livre CLOSING : la fermeture reste autorisée', async () => {
    const ev = await withOwner((db) => cw.newEvent(db));
    const closer = await withOwner((db) =>
      cw.w.idp.createPerson(db, {
        operatorId: cw.w.ops.a,
        roles: [{ role: 'SUPERVISOR', scopeType: 'EVENT', scopeId: ev.eventId }],
      }),
    );
    const t = await cw.terminal(ev);
    const id = await cw.open(t, cw.w.supervisorA);
    await cw.seedCash(t, 1_000, ev);
    expect((await cw.count(t, id, cw.w.supervisorA, 1_000)).status).toBe(200);
    await withOwner(async (db) => {
      await db.query(`SELECT set_config('app.operator_id', $1, false)`, [cw.w.ops.a]);
      await db.query(`SELECT set_event_status($1, 'CLOSING', $2)`, [
        ev.eventId,
        cw.w.operatorAdminA.userId,
      ]);
    });
    const res = await cw.closeBo(id, closer);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('CLOSED');
  });
});
