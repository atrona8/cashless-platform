// Intégration : statuts d'un événement (FR-017, FR-018, FR-019, FR-020, C-001 ; US5 de la spec) — conditions de
// passage visibles, mise en service à deux personnes, passages par `set_event_status` seulement, refus nommés,
// cohérence avec les refus de la base, isolation à deux prestataires.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from '../../support/app';
import { withOwner } from '../../support/db';
import { FakeIdp, type TestPerson } from '../../support/fake-idp';
import { createOperators, type Operators } from '../transverse/fixtures';

interface Condition {
  code: string;
  met: boolean | null;
  detail: string;
  source: string;
  owner_mission?: string;
}

describe('statuts d’un événement', () => {
  let idp: FakeIdp;
  let app: INestApplication;
  let ops: Operators;
  let adminA: TestPerson;
  let adminB: TestPerson;
  let organizerAdmin: TestPerson;
  let organizerAdmin2: TestPerson;
  let otherOrganizerAdmin: TestPerson;
  let supervisor: TestPerson;
  const ids = { a1: randomUUID(), a2: randomUUID(), profile: randomUUID(), contract: randomUUID() };

  beforeAll(async () => {
    idp = await FakeIdp.create();
    ops = await createOperators();
    await withOwner(async (db) => {
      await db.query(`INSERT INTO party (kind, legal_name) SELECT 'PLATFORM', 'Plateforme (test)' WHERE NOT EXISTS (SELECT 1 FROM party WHERE kind = 'PLATFORM')`);
      await db.query(`INSERT INTO party (id, kind, operator_id, legal_name) VALUES ($1, 'ORGANIZER', $3, 'Organisateur A1'), ($2, 'ORGANIZER', $3, 'Organisateur A2')`, [ids.a1, ids.a2, ops.a]);
      await db.query(
        `INSERT INTO jurisdiction_profile (id, country_code, version, valid_from, breakage_destination) VALUES ($1, 'SN', (1000000 + floor(random() * 1000000000))::int, '2026-01-01', 'ORGANIZER')`,
        [ids.profile],
      );
      await db.query(
        `INSERT INTO contract (id, operator_id, kind, counterparty_id, valid_from, offline_loss_bearer, cash_diff_bearer, breakage_organizer_bps)
         VALUES ($1, $2, 'OPERATOR_ORGANIZER', $3, '2026-01-01', 'ORGANIZER', 'ORGANIZER', 8000)`,
        [ids.contract, ops.a, ids.a1],
      );
      const person = (operatorId: string, roles: Parameters<FakeIdp['createPerson']>[1]['roles']) => idp.createPerson(db, { operatorId, roles });
      adminA = await person(ops.a, [{ role: 'OPERATOR_ADMIN', scopeType: 'OPERATOR', scopeId: ops.a }]);
      adminB = await person(ops.b, [{ role: 'OPERATOR_ADMIN', scopeType: 'OPERATOR', scopeId: ops.b }]);
      organizerAdmin = await person(ops.a, [{ role: 'ORGANIZER_ADMIN', scopeType: 'ORGANIZER', scopeId: ids.a1 }]);
      organizerAdmin2 = await person(ops.a, [{ role: 'ORGANIZER_ADMIN', scopeType: 'ORGANIZER', scopeId: ids.a1 }]);
      otherOrganizerAdmin = await person(ops.a, [{ role: 'ORGANIZER_ADMIN', scopeType: 'ORGANIZER', scopeId: ids.a2 }]);
      supervisor = await person(ops.a, [{ role: 'SUPERVISOR', scopeType: 'ORGANIZER', scopeId: ids.a1 }]);
    });
    app = await createTestApp({ identity: idp });
  });

  afterAll(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const send = (method: 'post' | 'patch', who: TestPerson, path: string, body: object = {}, key: string = randomUUID(), language?: string) => {
    let req = http()[method](path).set('Authorization', `Bearer ${who.token}`).set('Idempotency-Key', key);
    if (language) req = req.set('Accept-Language', language);
    return req.send(body);
  };
  const post = (who: TestPerson, path: string, body: object = {}, key?: string) => send('post', who, path, body, key);
  const get = (who: TestPerson, path: string, language?: string) => {
    const req = http().get(path).set('Authorization', `Bearer ${who.token}`);
    return language ? req.set('Accept-Language', language) : req;
  };
  const problem = (res: request.Response) => JSON.parse(res.text) as { code?: string; detail?: string; conditions?: Condition[] };
  const rows = <T>(sql: string, params: unknown[] = []) => withOwner(async (db) => (await db.query(sql, params)).rows as T[]);
  const EVENTS = () => `/v1/operators/${ops.a}/events`;
  const newEvent = async (overrides: object = {}) => {
    const res = await post(organizerAdmin, EVENTS(), {
      organizer_id: ids.a1, name: `Festival ${randomUUID()}`, currency: 'XOF', timezone: 'Africa/Dakar', jurisdiction_id: ids.profile,
      funds_holder: 'ORGANIZER', contract_id: ids.contract, ...overrides,
    });
    expect(res.status).toBe(201);
    return res.body.event_id as string;
  };
  const transition = (who: TestPerson, eventId: string, to: string, key?: string) => post(who, `${EVENTS()}/${eventId}/status-transitions`, { to }, key);
  const conditions = async (who: TestPerson, eventId: string, to?: string, language?: string) => {
    const res = await get(who, `${EVENTS()}/${eventId}/status-conditions${to ? `?to=${to}` : ''}`, language);
    expect(res.status).toBe(200);
    return res.body as Condition[];
  };
  const unmet = (list: Condition[]) => list.filter((c) => c.met === false).map((c) => c.code);
  /** Mise en service par la route : demande puis approbation par une seconde personne. */
  const goLive = async (eventId: string) => {
    const demand = await transition(organizerAdmin, eventId, 'LIVE');
    expect(demand.status).toBe(202);
    const approved = await post(organizerAdmin2, `/v1/approval-requests/${demand.body.approval_request_id}/approve`);
    expect(approved.body.status).toBe('EXECUTED');
  };
  /** Refus de la base elle-même pour ce passage (SQLSTATE), sans rien valider. */
  const databaseRefusal = (eventId: string, to: string) =>
    withOwner(async (db) => {
      await db.query('BEGIN');
      try {
        await db.query(`SELECT set_config('app.operator_id', $1, true)`, [ops.a]);
        await db.query(`SELECT set_event_status($1, $2::event_status, $3)`, [eventId, to, adminA.userId]);
        return null;
      } catch (error) {
        return (error as { code?: string }).code ?? 'ERREUR';
      } finally {
        await db.query('ROLLBACK');
      }
    });

  describe('conditions de passage', () => {
    it('DRAFT sans contrat : la condition « contrat en vigueur » est non remplie, avec sa raison', async () => {
      const eventId = await newEvent({ contract_id: null });
      const list = await conditions(organizerAdmin, eventId);
      expect(list.map((c) => [c.code, c.source])).toEqual([
        ['TRANSITION_ALLOWED', 'DATABASE'],
        ['FUNDS_HOLDER_SET', 'CONFIGURATION'],
        ['CONTRACT_IN_FORCE', 'CONFIGURATION'],
        ['JURISDICTION_SET', 'CONFIGURATION'],
        ['LEDGER_OPEN', 'CONFIGURATION'],
      ]);
      expect(unmet(list)).toEqual(['CONTRACT_IN_FORCE']);
      expect(list.find((c) => c.code === 'CONTRACT_IN_FORCE')!.detail).toContain('Aucun contrat');
      expect((await conditions(organizerAdmin, eventId, 'LIVE', 'en')).find((c) => c.code === 'CONTRACT_IN_FORCE')!.detail).toContain('No operator–organizer contract');
      expect(unmet(await conditions(organizerAdmin, await newEvent()))).toEqual([]);
    });

    it('statut visé explicite : conditions de la base et conditions externes nommées, sans les calculer', async () => {
      const eventId = await newEvent();
      const settling = await conditions(supervisor, eventId, 'SETTLING');
      expect(settling.filter((c) => c.source === 'DATABASE').map((c) => c.code)).toEqual(['TRANSITION_ALLOWED', 'DEVICES_CAUGHT_UP', 'DEBIT_AUTHORITY_CENTRAL', 'SUSPENSE_ZERO']);
      expect(settling.filter((c) => c.source === 'EXTERNAL')).toEqual([
        { code: 'CASH_DESKS_COUNTED', met: null, detail: expect.stringContaining('Caisses'), source: 'EXTERNAL', owner_mission: 'Recharges, caisses et PSP' },
        { code: 'PSP_RECONCILED', met: null, detail: expect.any(String), source: 'EXTERNAL', owner_mission: 'Recharges, caisses et PSP' },
      ]);
      // Depuis DRAFT, SETTLING n'est pas le passage suivant.
      expect(unmet(settling)).toEqual(['TRANSITION_ALLOWED']);
      expect((await conditions(supervisor, eventId, 'RECONCILING')).filter((c) => c.source === 'EXTERNAL').map((c) => c.owner_mission)).toEqual(['Terminaux']);
      expect((await get(organizerAdmin, `${EVENTS()}/${eventId}/status-conditions?to=FINI`)).status).toBe(400);
      expect((await get(otherOrganizerAdmin, `${EVENTS()}/${eventId}/status-conditions`)).status).toBe(403);
    });
  });

  describe('mise en service (DRAFT → LIVE)', () => {
    it('événement complet : 202, puis LIVE à l’approbation par une seconde personne ; l’historique garde l’auteur', async () => {
      const eventId = await newEvent();
      const demand = await transition(organizerAdmin, eventId, 'LIVE');
      expect(demand.status).toBe(202);
      expect(demand.body).toMatchObject({ action: 'EVENT_GO_LIVE', status: 'PENDING', target_id: eventId, requested_by: organizerAdmin.userId });
      expect(demand.headers.location).toBe(`/v1/approval-requests/${demand.body.approval_request_id}`);
      expect(await rows('SELECT status FROM event WHERE id = $1', [eventId])).toEqual([{ status: 'DRAFT' }]);

      const own = await post(organizerAdmin, `/v1/approval-requests/${demand.body.approval_request_id}/approve`);
      expect([own.status, problem(own).code]).toEqual([409, 'APPROVAL_INVALID']);
      expect((await post(adminA, `/v1/approval-requests/${demand.body.approval_request_id}/approve`)).status).toBe(403);
      const approved = await post(organizerAdmin2, `/v1/approval-requests/${demand.body.approval_request_id}/approve`);
      expect(approved.status).toBe(200);
      expect(approved.body).toMatchObject({ status: 'EXECUTED', result: { event_id: eventId, status: 'LIVE' } });
      expect(await rows('SELECT from_status, to_status, actor_id FROM event_status_history WHERE event_id = $1', [eventId])).toEqual([
        { from_status: 'DRAFT', to_status: 'LIVE', actor_id: organizerAdmin.userId },
      ]);
      expect(await rows(`SELECT actor_id, approver_id, before->>'status' AS before, after->>'status' AS after FROM audit_log WHERE object_id = $1 AND action = 'EVENT_STATUS_CHANGED'`, [eventId])).toEqual([
        { actor_id: organizerAdmin.userId, approver_id: organizerAdmin2.userId, before: 'DRAFT', after: 'LIVE' },
      ]);
      expect(await rows(`SELECT status FROM ledger WHERE scope_type = 'EVENT' AND scope_id = $1`, [eventId])).toEqual([{ status: 'OPEN' }]);
    });

    it('condition de configuration non remplie : 409 CLOSING_CONDITION_NOT_MET, la condition est nommée', async () => {
      const eventId = await newEvent({ contract_id: null });
      const res = await transition(organizerAdmin, eventId, 'LIVE');
      expect([res.status, problem(res).code]).toEqual([409, 'CLOSING_CONDITION_NOT_MET']);
      expect(problem(res).detail).toContain('CONTRACT_IN_FORCE');
      expect(problem(res).conditions?.map((c) => c.code)).toEqual(['CONTRACT_IN_FORCE']);
      const english = await send('post', organizerAdmin, `${EVENTS()}/${eventId}/status-transitions`, { to: 'LIVE' }, randomUUID(), 'en');
      expect(problem(english).detail).toContain('No operator–organizer contract');
      expect(await rows('SELECT count(*)::int AS n FROM approval_request WHERE target_id = $1', [eventId])).toEqual([{ n: 0 }]);
    });

    it('configuration modifiée entre la demande et l’approbation : la demande passe FAILED, l’événement reste DRAFT', async () => {
      const eventId = await newEvent();
      const demand = await transition(organizerAdmin, eventId, 'LIVE');
      expect(demand.status).toBe(202);
      expect((await send('patch', organizerAdmin, `${EVENTS()}/${eventId}`, { cash_refund_single_max: 10000 })).status).toBe(200);
      const approved = await post(organizerAdmin2, `/v1/approval-requests/${demand.body.approval_request_id}/approve`);
      expect(approved.body).toMatchObject({ status: 'FAILED', failure_code: 'CONFLICT_STATE' });
      expect(await rows('SELECT status FROM event WHERE id = $1', [eventId])).toEqual([{ status: 'DRAFT' }]);
      expect(await rows('SELECT count(*)::int AS n FROM event_status_history WHERE event_id = $1', [eventId])).toEqual([{ n: 0 }]);
    });

    it('réservée aux ORGANIZER_ADMIN de l’organisateur', async () => {
      const eventId = await newEvent();
      expect((await transition(adminA, eventId, 'LIVE')).status).toBe(403);
      expect((await transition(otherOrganizerAdmin, eventId, 'LIVE')).status).toBe(403);
      expect((await transition(supervisor, eventId, 'LIVE')).status).toBe(403);
    });
  });

  describe('passages suivants', () => {
    it('aucun retour en arrière ni saut : 409 EVENT_TRANSITION_INVALID ; passage suivant immédiat, audité, rejouable', async () => {
      const eventId = await newEvent();
      await goLive(eventId);
      for (const to of ['DRAFT', 'LIVE', 'SETTLING', 'CLOSED']) {
        const res = await transition(organizerAdmin, eventId, to);
        expect([to, res.status, problem(res).code]).toEqual([to, 409, 'EVENT_TRANSITION_INVALID']);
        expect(await databaseRefusal(eventId, to)).toBe('CL018');
      }
      const key = randomUUID();
      const closing = await transition(organizerAdmin, eventId, 'CLOSING', key);
      expect(closing.status).toBe(200);
      expect(closing.body).toMatchObject({ event_id: eventId, status: 'CLOSING' });
      const replay = await transition(organizerAdmin, eventId, 'CLOSING', key);
      expect([replay.status, replay.headers['idempotency-replayed']]).toEqual([200, 'true']);
      expect(await rows(`SELECT to_status, actor_id FROM event_status_history WHERE event_id = $1 ORDER BY id`, [eventId])).toEqual([
        { to_status: 'LIVE', actor_id: organizerAdmin.userId },
        { to_status: 'CLOSING', actor_id: organizerAdmin.userId },
      ]);
      expect(await rows(`SELECT actor_id, actor_role, approver_id FROM audit_log WHERE object_id = $1 AND action = 'EVENT_STATUS_CHANGED' AND after->>'status' = 'CLOSING'`, [eventId])).toEqual([
        { actor_id: organizerAdmin.userId, actor_role: 'ORGANIZER_ADMIN', approver_id: null },
      ]);
      // Le prestataire applique aussi les passages qui suivent la mise en service.
      expect((await transition(adminA, eventId, 'RECONCILING')).body).toMatchObject({ status: 'RECONCILING' });
      expect((await transition(otherOrganizerAdmin, eventId, 'SETTLING')).status).toBe(403);
      expect((await transition(organizerAdmin, eventId, 'TERMINE')).status).toBe(422);
      expect((await post(organizerAdmin, `${EVENTS()}/${eventId}/status-transitions`, {})).status).toBe(400);
    });

    it('condition de la base non remplie : refus qui nomme la condition, identique au refus de la base (deux statuts)', async () => {
      const eventId = await newEvent();
      await goLive(eventId);
      expect((await transition(organizerAdmin, eventId, 'CLOSING')).status).toBe(200);

      // Vers RECONCILING : une passerelle détient encore l'autorité de débit.
      await rows(`UPDATE ledger SET debit_authority = 'EDGE', edge_gateway_id = $2 WHERE scope_type = 'EVENT' AND scope_id = $1`, [eventId, randomUUID()]);
      expect(unmet(await conditions(organizerAdmin, eventId))).toEqual(['DEBIT_AUTHORITY_CENTRAL']);
      const reconciling = await transition(organizerAdmin, eventId, 'RECONCILING');
      expect([reconciling.status, problem(reconciling).code]).toEqual([409, 'CLOSING_CONDITION_NOT_MET']);
      expect(problem(reconciling).detail).toContain('DEBIT_AUTHORITY_CENTRAL');
      expect(problem(reconciling).detail).not.toMatch(/SQL|select|constraint/i);
      expect(await databaseRefusal(eventId, 'RECONCILING')).toBe('CL019');
      await rows(`UPDATE ledger SET debit_authority = 'CENTRAL', edge_gateway_id = NULL WHERE scope_type = 'EVENT' AND scope_id = $1`, [eventId]);
      expect(await databaseRefusal(eventId, 'RECONCILING')).toBeNull();
      expect((await transition(organizerAdmin, eventId, 'RECONCILING')).status).toBe(200);

      // Vers SETTLING : un terminal de l'événement n'a pas tout remonté avant la date limite.
      const [device] = await rows<{ id: string }>(`INSERT INTO device (operator_id, kind, event_id, serial) VALUES ($1, 'POS', $2, $3) RETURNING id`, [ops.a, eventId, `TPE-${randomUUID()}`]);
      expect(unmet(await conditions(organizerAdmin, eventId))).toEqual(['DEVICES_CAUGHT_UP']);
      const settling = await transition(organizerAdmin, eventId, 'SETTLING');
      expect([settling.status, problem(settling).code]).toEqual([409, 'CLOSING_CONDITION_NOT_MET']);
      expect(problem(settling).conditions?.map((c) => c.code)).toEqual(['DEVICES_CAUGHT_UP']);
      expect(await databaseRefusal(eventId, 'SETTLING')).toBe('CL019');
      expect(await rows('SELECT status FROM event WHERE id = $1', [eventId])).toEqual([{ status: 'RECONCILING' }]);
      await rows(`UPDATE device SET last_seen_at = clock_timestamp() WHERE id = $1`, [device!.id]);
      expect(unmet(await conditions(organizerAdmin, eventId))).toEqual([]);
      expect((await transition(organizerAdmin, eventId, 'SETTLING')).body).toMatchObject({ status: 'SETTLING' });
    });

    it('jusqu’à CLOSED : le grand livre soldé est verrouillé ; plus aucun passage ensuite', async () => {
      const eventId = await newEvent();
      await goLive(eventId);
      for (const to of ['CLOSING', 'RECONCILING', 'SETTLING', 'REFUND_WINDOW', 'CLOSED']) {
        expect([to, (await transition(organizerAdmin, eventId, to)).status]).toEqual([to, 200]);
      }
      expect(await rows(`SELECT status FROM ledger WHERE scope_type = 'EVENT' AND scope_id = $1`, [eventId])).toEqual([{ status: 'LOCKED' }]);
      expect(await conditions(organizerAdmin, eventId)).toEqual([]);
      expect((await transition(organizerAdmin, eventId, 'CLOSED')).status).toBe(409);
    });
  });

  describe('le statut ne change que par la route de passage', () => {
    it('une modification ordinaire de l’événement ne change pas le statut ; la base refuse toute écriture directe', async () => {
      const eventId = await newEvent();
      expect((await send('patch', organizerAdmin, `${EVENTS()}/${eventId}`, { status: 'LIVE' })).status).toBe(400);
      expect((await send('patch', organizerAdmin, `${EVENTS()}/${eventId}`, { name: 'Autre nom', status: 'LIVE' })).status).toBe(400);
      const direct = await withOwner(async (db) => {
        try {
          await db.query(`UPDATE event SET status = 'LIVE' WHERE id = $1`, [eventId]);
          return null;
        } catch (error) {
          return (error as { code?: string }).code;
        }
      });
      expect(direct).toBe('CL018');
      expect(await rows('SELECT status FROM event WHERE id = $1', [eventId])).toEqual([{ status: 'DRAFT' }]);
    });
  });

  describe('isolation à deux prestataires', () => {
    it('le personnel de B ne lit aucune condition et n’applique aucun passage sur un événement de A', async () => {
      const eventId = await newEvent();
      for (const root of [EVENTS(), `/v1/operators/${ops.b}/events`]) {
        expect((await get(adminB, `${root}/${eventId}/status-conditions`)).status).toBe(404);
        expect((await post(adminB, `${root}/${eventId}/status-transitions`, { to: 'LIVE' })).status).toBe(404);
      }
      expect(await rows('SELECT status FROM event WHERE id = $1', [eventId])).toEqual([{ status: 'DRAFT' }]);
    });
  });
});
