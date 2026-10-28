// Lecture et liste des sessions de caisse (mission 6, lot WP08, T040 ; FR-002, FR-003 ; contracts/cash.md règles 3, 9).
// `getCashSession` (terminal + personne, ou personne seule) et `listCashSessions` (personne seule). HTTPS réel.
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { contractViolations } from '../../support/contract-schema';
import { withOwner } from '../../support/db';
import { CashWorld, type WorldEvent } from './cash-session-fixtures';

jest.setTimeout(240_000);

describe('lecture et liste des sessions de caisse (WP08)', () => {
  let cw: CashWorld;
  beforeAll(async () => {
    cw = await CashWorld.create();
  });
  afterAll(async () => {
    await cw?.close();
  });

  const listOf = (ev: WorldEvent, who = cw.supervisor, query = '') =>
    cw.bo('GET', `/events/${ev.eventId}/cash-sessions${query}`, who);

  it('CASHIER : sa session (terminal ou jeton seul), jamais le théorique ni l’écart, même fermée', async () => {
    const { t, id } = await cw.ready({ expected: 5_000, counted: 4_500 });
    for (const res of [
      await cw.term(t, 'GET', `/cash-sessions/${id}`, cw.w.cashierA),
      await cw.bo('GET', `/cash-sessions/${id}`, cw.w.cashierA),
    ]) {
      expect(res.status).toBe(200);
      expect(contractViolations('CashSession', res.body)).toEqual([]);
      expect(res.body).toMatchObject({
        cash_session_id: id,
        status: 'OPEN',
        expected_amount: null,
        difference: null,
      });
    }
    expect((await cw.closeBo(id, cw.supervisor)).status).toBe(200);
    const closed = await cw.bo('GET', `/cash-sessions/${id}`, cw.w.cashierA);
    expect(closed.body).toMatchObject({
      status: 'CLOSED',
      counted_amount: 4_500,
      expected_amount: null,
      difference: null,
    });
  });

  it('CASHIER : la session d’un AUTRE caissier ou d’un autre terminal est un 404, identique à une session inconnue', async () => {
    const { t, id } = await cw.ready({ expected: 0, counted: null });
    const mine = await cw.bo('GET', `/cash-sessions/${id}`, cw.w.cashierA);
    expect(mine.status).toBe(200);
    const unknown = await cw.bo('GET', `/cash-sessions/${randomUUID()}`, cw.cashier2);
    const foreign = await cw.bo('GET', `/cash-sessions/${id}`, cw.cashier2);
    expect(foreign.status).toBe(404);
    expect([foreign.status, foreign.body.code, foreign.body.title]).toEqual([
      unknown.status,
      unknown.body.code,
      unknown.body.title,
    ]);
    // Au terminal : l'autre caissier sur le même terminal, puis le même caissier sur un autre terminal.
    expect((await cw.term(t, 'GET', `/cash-sessions/${id}`, cw.cashier2)).status).toBe(404);
    const otherTerminal = await cw.terminal();
    expect(
      (await cw.term(otherTerminal, 'GET', `/cash-sessions/${id}`, cw.w.cashierA)).status,
    ).toBe(404);
    // Inconnue ou mal formée.
    expect((await cw.bo('GET', '/cash-sessions/pas-un-uuid', cw.w.cashierA)).status).toBe(404);
  });

  it('SUPERVISOR : toutes les sessions de l’événement ; expected_amount et difference après fermeture seulement', async () => {
    const { t, id } = await cw.ready({ expected: 8_000, counted: 7_500 });
    const open = await cw.bo('GET', `/cash-sessions/${id}`, cw.supervisor);
    expect(open.status).toBe(200);
    expect(open.body).toMatchObject({ status: 'OPEN', expected_amount: null, difference: null });
    // Au terminal, un SUPERVISOR lit aussi la session d'un autre terminal de son événement.
    const other = await cw.terminal();
    expect((await cw.term(other, 'GET', `/cash-sessions/${id}`, cw.supervisor)).status).toBe(200);
    expect((await cw.closeTerm(t, id, cw.supervisor)).status).toBe(200);
    const closed = await cw.bo('GET', `/cash-sessions/${id}`, cw.supervisor);
    expect(closed.body).toMatchObject({
      status: 'CLOSED',
      expected_amount: 8_000,
      counted_amount: 7_500,
      difference: -500,
    });
    expect(contractViolations('CashSession', closed.body)).toEqual([]);
    // ORGANIZER_ADMIN : même vue de gestion.
    const admin = await cw.bo('GET', `/cash-sessions/${id}`, cw.w.organizerAdminA);
    expect(admin.body).toMatchObject({ expected_amount: 8_000, difference: -500 });
  });

  it('OPERATOR_ADMIN seul : aucune vue (404 en lecture, 403 en liste) ; autre événement ou autre prestataire : 404', async () => {
    const { id } = await cw.ready({ expected: 0, counted: null });
    expect((await cw.bo('GET', `/cash-sessions/${id}`, cw.w.operatorAdminA)).status).toBe(404);
    expect((await listOf(cw.a, cw.w.operatorAdminA)).status).toBe(403);
    expect((await cw.bo('GET', `/cash-sessions/${id}`, cw.supervisorOfB)).status).toBe(404);
    expect((await cw.bo('GET', `/cash-sessions/${id}`, cw.cashierOfB)).status).toBe(404);
    expect((await cw.bo('GET', `/cash-sessions/${id}`, cw.supervisorOp2)).status).toBe(404);
  });

  it('sans preuve : jeton de guichet seul 401, marqueur de terminal sans jeton de guichet 401, rien sans jeton 401', async () => {
    const { t, id } = await cw.ready({ expected: 0, counted: null });
    expect((await cw.term(t, 'GET', `/cash-sessions/${id}`, null)).status).toBe(401);
    const staff = await cw.bo('GET', `/cash-sessions/${id}`, cw.w.cashierA, undefined, null, {
      'x-staff-authorization': `Bearer ${cw.w.cashierA.token}`,
    });
    expect(staff.status).toBe(401);
    const signed = await cw.bo('GET', `/cash-sessions/${id}`, cw.w.cashierA, undefined, null, {
      signature: 'sig1=:AAAA:',
      'signature-input': 'sig1=("@method")',
    });
    expect(signed.status).toBe(401);
  });

  describe('liste', () => {
    let ev: WorldEvent;
    const ids: string[] = [];
    beforeAll(async () => {
      ev = await withOwner((db) => cw.newEvent(db));
      // Trois sessions de l'événement, ouvertes l'une après l'autre ; la première est fermée.
      for (let i = 0; i < 3; i += 1) {
        const t = await cw.terminal(ev);
        ids.push(await cw.open(t, cw.w.supervisorA));
        if (i === 0) {
          await cw.seedCash(t, 1_000, ev);
          expect((await cw.count(t, ids[0]!, cw.w.supervisorA, 900)).status).toBe(200);
          const closer = await withOwner((db) =>
            cw.w.idp.createPerson(db, {
              operatorId: cw.w.ops.a,
              roles: [{ role: 'SUPERVISOR', scopeType: 'EVENT', scopeId: ev.eventId }],
            }),
          );
          expect((await cw.closeBo(ids[0]!, closer)).status).toBe(200);
        }
      }
    });

    it('SUPERVISOR et ORGANIZER_ADMIN : {data, next_cursor, has_more}, tri décroissant, valeurs de gestion', async () => {
      for (const who of [cw.w.supervisorA, cw.w.organizerAdminA]) {
        const res = await listOf(ev, who);
        expect(res.status).toBe(200);
        expect(Object.keys(res.body).sort()).toEqual(['data', 'has_more', 'next_cursor']);
        const data = res.body.data as Array<Record<string, unknown>>;
        expect(data.map((s) => s.cash_session_id)).toEqual([...ids].reverse());
        for (const item of data) expect(contractViolations('CashSession', item)).toEqual([]);
        const closed = data.find((s) => s.cash_session_id === ids[0])!;
        expect(closed).toMatchObject({
          status: 'CLOSED',
          expected_amount: 1_000,
          difference: -100,
        });
        for (const item of data.filter((s) => s.status === 'OPEN'))
          expect(item).toMatchObject({ expected_amount: null, difference: null });
        expect(res.body).toMatchObject({ has_more: false, next_cursor: null });
      }
    });

    it('filtre status, pagination par curseur, limites, curseur falsifié', async () => {
      const open = await listOf(ev, cw.w.supervisorA, '?status=OPEN');
      expect((open.body.data as unknown[]).length).toBe(2);
      const closed = await listOf(ev, cw.w.supervisorA, '?status=CLOSED');
      expect(
        (closed.body.data as Array<{ cash_session_id: string }>).map((s) => s.cash_session_id),
      ).toEqual([ids[0]]);
      expect((await listOf(ev, cw.w.supervisorA, '?status=CLOSING')).status).toBe(422);
      const first = await listOf(ev, cw.w.supervisorA, '?limit=2');
      expect(first.body).toMatchObject({ has_more: true });
      expect((first.body.data as unknown[]).length).toBe(2);
      const cursor = encodeURIComponent(String(first.body.next_cursor));
      const second = await listOf(ev, cw.w.supervisorA, `?limit=2&cursor=${cursor}`);
      expect(
        (second.body.data as Array<{ cash_session_id: string }>).map((s) => s.cash_session_id),
      ).toEqual([ids[0]]);
      expect(second.body).toMatchObject({ has_more: false, next_cursor: null });
      for (const bad of ['?limit=0', '?limit=201', '?limit=abc', '?cursor=%25%25', '?cursor=e30']) {
        const res = await listOf(ev, cw.w.supervisorA, bad);
        expect([bad, res.status >= 400 && res.status < 500]).toEqual([bad, true]);
      }
      const forged = Buffer.from(JSON.stringify({ o: -5 })).toString('base64url');
      expect((await listOf(ev, cw.w.supervisorA, `?cursor=${forged}`)).status).toBe(400);
    });

    it('CASHIER 403 ; liste vide ; événement inconnu, mal formé ou d’un autre prestataire 404', async () => {
      expect((await listOf(ev, cw.w.cashierA)).status).toBe(403);
      expect((await listOf(cw.a, cw.cashier2)).status).toBe(403);
      // Événement B : aucune session ouverte dans ce fichier.
      const empty = await listOf(cw.b, cw.supervisorOfB);
      expect(empty.status).toBe(200);
      expect(empty.body).toEqual({ data: [], next_cursor: null, has_more: false });
      expect(
        (await cw.bo('GET', `/events/${randomUUID()}/cash-sessions`, cw.supervisor)).status,
      ).toBe(404);
      expect((await cw.bo('GET', '/events/pas-un-uuid/cash-sessions', cw.supervisor)).status).toBe(
        404,
      );
      expect((await listOf(ev, cw.supervisorOp2)).status).toBe(404);
      // Un SUPERVISOR d'un autre événement du même prestataire : pas de rôle ici.
      expect((await listOf(ev, cw.supervisorOfB)).status).toBe(403);
      // Sans jeton, ou avec un jeton de guichet : 401.
      const staff = await cw.bo(
        'GET',
        `/events/${ev.eventId}/cash-sessions`,
        cw.supervisor,
        undefined,
        null,
        {
          'x-staff-authorization': `Bearer ${cw.supervisor.token}`,
        },
      );
      expect(staff.status).toBe(401);
    });
  });
});
