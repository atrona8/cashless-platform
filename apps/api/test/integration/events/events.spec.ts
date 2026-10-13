// Intégration : événements (FR-009 à FR-011, FR-014, FR-015, FR-019, FR-020, NFR-004 ; US3 de la spec) — création
// avec grand livre et comptes, lecture, modification par qui de droit (à deux en LIVE), configuration résolue,
// atomicité, isolation à deux prestataires.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AuditService } from '../../../src/audit/audit.service';
import { CascadeService } from '../../../src/configuration/cascade.service';
import { createTestApp } from '../../support/app';
import { withOwner } from '../../support/db';
import { FakeIdp, type TestPerson } from '../../support/fake-idp';
import { createOperators, type Operators } from '../transverse/fixtures';

describe('événements', () => {
  let idp: FakeIdp;
  let app: INestApplication;
  let ops: Operators;
  let adminA: TestPerson; // OPERATOR_ADMIN de A
  let adminA2: TestPerson;
  let adminB: TestPerson; // OPERATOR_ADMIN de B
  let organizerAdmin: TestPerson; // ORGANIZER_ADMIN de a1
  let organizerAdmin2: TestPerson; // second ORGANIZER_ADMIN de a1
  let otherOrganizerAdmin: TestPerson; // ORGANIZER_ADMIN de a2
  let supervisor: TestPerson; // SUPERVISOR d'un événement (posé dans son test)
  let cashier: TestPerson;
  const ids = { a1: randomUUID(), a2: randomUUID(), third: randomUUID(), strict: randomUUID(), free: randomUUID(), contract: randomUUID(), contractA2: randomUUID() };

  beforeAll(async () => {
    idp = await FakeIdp.create();
    ops = await createOperators();
    await withOwner(async (db) => {
      await db.query(`INSERT INTO party (kind, legal_name) SELECT 'PLATFORM', 'Plateforme (test)' WHERE NOT EXISTS (SELECT 1 FROM party WHERE kind = 'PLATFORM')`);
      await db.query(
        `INSERT INTO party (id, kind, operator_id, legal_name, country_code) VALUES
           ($1, 'ORGANIZER', $4, 'Organisateur A1', 'SN'), ($2, 'ORGANIZER', $4, 'Organisateur A2', 'SN'), ($3, 'THIRD_PARTY', $4, 'Compte cantonné', 'SN')`,
        [ids.a1, ids.a2, ids.third, ops.a],
      );
      const version = `(1000000 + floor(random() * 1000000000))::int`;
      await db.query(`INSERT INTO jurisdiction_profile (id, country_code, version, valid_from, breakage_destination, min_refund_window_days) VALUES ($1, 'SN', ${version}, '2026-01-01', 'ORGANIZER', 90)`, [ids.strict]);
      await db.query(`INSERT INTO jurisdiction_profile (id, country_code, version, valid_from, breakage_destination) VALUES ($1, 'SN', ${version}, '2026-01-01', 'LEGAL_ACCOUNT')`, [ids.free]);
      await db.query(
        `INSERT INTO contract (id, operator_id, kind, counterparty_id, valid_from, offline_loss_bearer, cash_diff_bearer, breakage_organizer_bps) VALUES
           ($1, $3, 'OPERATOR_ORGANIZER', $4, '2026-01-01', 'ORGANIZER', 'ORGANIZER', 8000), ($2, $3, 'OPERATOR_ORGANIZER', $5, '2026-01-01', 'ORGANIZER', 'ORGANIZER', 8000)`,
        [ids.contract, ids.contractA2, ops.a, ids.a1, ids.a2],
      );
      // Maximum fixé par le prestataire pour cash_refund_single_max.
      await db.query(
        `INSERT INTO config_version (operator_id, scope_type, scope_id, version, valid_from, settings)
         VALUES ($1, 'OPERATOR', $1, 0, clock_timestamp() - interval '1 day', '{"cash_refund_single_max_cap":100000,"psp_fee_bearer":"OPERATOR"}')`,
        [ops.a],
      );
      const person = (operatorId: string, roles: Parameters<FakeIdp['createPerson']>[1]['roles']) => idp.createPerson(db, { operatorId, roles });
      adminA = await person(ops.a, [{ role: 'OPERATOR_ADMIN', scopeType: 'OPERATOR', scopeId: ops.a }]);
      adminA2 = await person(ops.a, [{ role: 'OPERATOR_ADMIN', scopeType: 'OPERATOR', scopeId: ops.a }]);
      adminB = await person(ops.b, [{ role: 'OPERATOR_ADMIN', scopeType: 'OPERATOR', scopeId: ops.b }]);
      organizerAdmin = await person(ops.a, [{ role: 'ORGANIZER_ADMIN', scopeType: 'ORGANIZER', scopeId: ids.a1 }]);
      organizerAdmin2 = await person(ops.a, [{ role: 'ORGANIZER_ADMIN', scopeType: 'ORGANIZER', scopeId: ids.a1 }]);
      otherOrganizerAdmin = await person(ops.a, [{ role: 'ORGANIZER_ADMIN', scopeType: 'ORGANIZER', scopeId: ids.a2 }]);
      cashier = await person(ops.a, [{ role: 'CASHIER', scopeType: 'ORGANIZER', scopeId: ids.a1 }]);
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
  const patch = (who: TestPerson, path: string, body: object = {}) => send('patch', who, path, body);
  const get = (who: TestPerson, path: string) => http().get(path).set('Authorization', `Bearer ${who.token}`);
  const problem = (res: request.Response) => JSON.parse(res.text) as { code?: string; detail?: string; violations?: Array<{ rule: string; field: string; limit: unknown; source: string }> };
  const rows = <T>(sql: string, params: unknown[] = []) => withOwner(async (db) => (await db.query(sql, params)).rows as T[]);
  const EVENTS = () => `/v1/operators/${ops.a}/events`;
  const base = (overrides: object = {}) => ({
    organizer_id: ids.a1, name: `Festival ${randomUUID()}`, currency: 'XOF', timezone: 'Africa/Dakar', jurisdiction_id: ids.free,
    funds_holder: 'ORGANIZER', starts_at: '2026-12-28T18:00:00Z', ends_at: '2026-12-31T06:00:00Z', ...overrides,
  });
  const newEvent = async (overrides: object = {}, who: TestPerson = organizerAdmin) => {
    const res = await post(who, EVENTS(), base(overrides));
    expect(res.status).toBe(201);
    return res.body as Record<string, unknown> & { event_id: string };
  };
  /** Passage en LIVE par la fonction de la base (la route de statut arrive avec les statuts). */
  const goLive = (eventId: string) =>
    withOwner(async (db) => {
      await db.query('BEGIN');
      await db.query(`SELECT set_config('app.operator_id', $1, true)`, [ops.a]);
      await db.query(`SELECT set_event_status($1, 'LIVE', $2)`, [eventId, adminA.userId]);
      await db.query('COMMIT');
    });

  describe('création (US3)', () => {
    it('événement complet : DRAFT, grand livre et comptes, version 1 de configuration, audit — une seule opération', async () => {
      const res = await post(organizerAdmin, EVENTS(), base({ name: 'Dakar Live', contract_id: ids.contract, operator_id: ops.b, status: 'LIVE' }));
      expect(res.status).toBe(201);
      const event = res.body;
      expect(res.headers.location).toBe(`${EVENTS()}/${event.event_id}`);
      expect(event).toMatchObject({
        operator_id: ops.a, organizer_id: ids.a1, name: 'Dakar Live', currency: 'XOF', timezone: 'Africa/Dakar', status: 'DRAFT',
        funds_holder: 'ORGANIZER', funds_holder_party_id: null, issuer: 'ORGANIZER', contract_id: ids.contract, jurisdiction_id: ids.free,
        identity_mode: 'ANONYMOUS_ALLOWED', activation_modes: ['DESK'], cash_refund_single_max: 50000, sync_deadline_hours: 72,
        heartbeat_seconds: 60, reversal_window_minutes: 15,
      });
      // Date limite de remboursement absente : fin + 30 jours, signalée provisoire.
      expect(event).toMatchObject({ refund_deadline: '2027-01-30T06:00:00.000Z', refund_deadline_source: 'PROVISIONAL_DEFAULT' });

      const [ledger] = await rows<{ id: string; currency: string; status: string; issuer_id: string; funds_holder_id: string }>(
        `SELECT id, currency::text, status, issuer_id, funds_holder_id FROM ledger WHERE scope_type = 'EVENT' AND scope_id = $1`,
        [event.event_id],
      );
      expect(ledger).toEqual({ id: event.ledger_id, currency: 'XOF', status: 'OPEN', issuer_id: ids.a1, funds_holder_id: ids.a1 });
      // Profil à compte légal : 28 comptes fixes + L-LEGAL-CASSE.
      expect(await rows('SELECT count(*)::int AS n FROM account WHERE ledger_id = $1', [ledger!.id])).toEqual([{ n: 29 }]);
      const [version] = await rows<{ id: string; version: number; settings: Record<string, unknown> }>(
        `SELECT id, version, settings FROM config_version WHERE scope_type = 'EVENT' AND scope_id = $1`,
        [event.event_id],
      );
      expect(version).toMatchObject({ id: event.config_version_id, version: 1, settings: { sync_deadline_hours: 72, cash_refund_single_max: 50000, issuer: 'ORGANIZER' } });
      expect(version!.settings).not.toHaveProperty('funds_holder');
      const audit = await rows(`SELECT action, actor_id, actor_role, operator_id FROM audit_log WHERE object_id = ANY($1::text[]) ORDER BY seq`, [[event.event_id, event.config_version_id]]);
      expect(audit).toEqual([
        { action: 'CONFIG_VERSION_CREATED', actor_id: organizerAdmin.userId, actor_role: 'ORGANIZER_ADMIN', operator_id: ops.a },
        { action: 'EVENT_CREATED', actor_id: organizerAdmin.userId, actor_role: 'ORGANIZER_ADMIN', operator_id: ops.a },
      ]);
    });

    it('sans détenteur des fonds : 422, il n’a pas de valeur par défaut', async () => {
      const { funds_holder: _omitted, ...body } = base();
      const res = await post(organizerAdmin, EVENTS(), body);
      expect(res.status).toBe(422);
      expect(problem(res).detail).toContain('funds_holder');
    });

    it('détenteur tiers : partie tierce exigée, titulaire des comptes d’argent ; émetteur prestataire', async () => {
      expect((await post(organizerAdmin, EVENTS(), base({ funds_holder: 'THIRD_PARTY' }))).status).toBe(422);
      expect((await post(organizerAdmin, EVENTS(), base({ funds_holder: 'ORGANIZER', funds_holder_party_id: ids.third }))).status).toBe(422);
      expect((await post(organizerAdmin, EVENTS(), base({ funds_holder: 'THIRD_PARTY', funds_holder_party_id: ids.a2 }))).status).toBe(422);
      const event = await newEvent({ funds_holder: 'THIRD_PARTY', funds_holder_party_id: ids.third, issuer: 'OPERATOR' });
      expect(await rows(`SELECT issuer_id, funds_holder_id FROM ledger WHERE id = $1`, [event.ledger_id])).toEqual([{ issuer_id: ops.a, funds_holder_id: ids.third }]);
    });

    it('date limite à 30 jours quand la loi en impose 90 : refusée, le message cite la règle et le profil', async () => {
      const [profile] = await rows<{ version: number }>('SELECT version FROM jurisdiction_profile WHERE id = $1', [ids.strict]);
      const body = base({ jurisdiction_id: ids.strict, refund_deadline: '2027-01-30T06:00:00Z' });
      const res = await post(organizerAdmin, EVENTS(), body);
      expect(res.status).toBe(422);
      expect(problem(res).code).toBe('VALIDATION_FAILED');
      expect(problem(res).detail).toContain('jurisdiction.min_refund_window_days');
      expect(problem(res).detail).toContain(`SN v${profile!.version}`);
      expect(problem(res).violations).toEqual([
        { field: 'refund_deadline', rule: 'jurisdiction.min_refund_window_days', requested: '2027-01-30T06:00:00.000Z', limit: '2027-03-31T06:00:00.000Z', source: `SN v${profile!.version}` },
      ]);
      const english = await send('post', organizerAdmin, EVENTS(), body, randomUUID(), 'en');
      expect(problem(english).detail).toContain('Refund deadline');
      expect((await post(organizerAdmin, EVENTS(), base({ jurisdiction_id: ids.strict, refund_deadline: '2027-03-31T06:00:00Z' }))).status).toBe(201);
    });

    it('maximum du prestataire dépassé : refusé en citant ce maximum ; bornes fixes ; références inconnues', async () => {
      const capped = await post(organizerAdmin, EVENTS(), base({ cash_refund_single_max: 150000 }));
      expect(capped.status).toBe(422);
      expect(problem(capped).violations).toMatchObject([{ field: 'cash_refund_single_max', rule: 'operator.cash_refund_single_max_cap', limit: 100000 }]);
      expect(problem(capped).violations![0]!.source).toMatch(/^OPERATOR v\d+$/);
      expect((await post(organizerAdmin, EVENTS(), base({ cash_refund_single_max: 100000 }))).status).toBe(201);
      expect(problem(await post(organizerAdmin, EVENTS(), base({ reversal_window_minutes: 61 }))).violations?.map((v) => v.rule)).toEqual(['catalog.range']);
      expect(problem(await post(organizerAdmin, EVENTS(), base({ ends_at: '2026-12-01T00:00:00Z' }))).violations?.map((v) => v.rule)).toEqual(['catalog.dates']);
      expect((await post(organizerAdmin, EVENTS(), base({ currency: 'GBP' }))).status).toBe(422);
      expect((await post(organizerAdmin, EVENTS(), base({ timezone: 'Mars/Olympus' }))).status).toBe(422);
      expect((await post(organizerAdmin, EVENTS(), base({ jurisdiction_id: randomUUID() }))).status).toBe(422);
      expect((await post(organizerAdmin, EVENTS(), base({ contract_id: ids.contractA2 }))).status).toBe(422);
      expect((await post(organizerAdmin, EVENTS(), { ...base(), organizer_id: 'x' })).status).toBe(400);
    });

    it('qui crée : ORGANIZER_ADMIN de l’organisateur ou OPERATOR_ADMIN ; un autre organisateur : 403', async () => {
      expect((await post(otherOrganizerAdmin, EVENTS(), base())).status).toBe(403);
      expect((await post(cashier, EVENTS(), base())).status).toBe(403);
      expect((await post(organizerAdmin, EVENTS(), base({ organizer_id: randomUUID() }))).status).toBe(404);
      const byOperator = await newEvent({}, adminA);
      expect(byOperator.organizer_id).toBe(ids.a1);
    });

    it('rejeu idempotent : même événement, un seul grand livre', async () => {
      const key = randomUUID();
      const body = base();
      const first = await post(organizerAdmin, EVENTS(), body, key);
      const replay = await post(organizerAdmin, EVENTS(), body, key);
      expect([first.status, replay.status, replay.headers['idempotency-replayed']]).toEqual([201, 201, 'true']);
      expect(replay.body).toEqual(first.body);
      expect(await rows('SELECT count(*)::int AS n FROM event WHERE name = $1', [body.name])).toEqual([{ n: 1 }]);
      expect(await rows(`SELECT count(*)::int AS n FROM ledger WHERE scope_id = $1`, [first.body.event_id])).toEqual([{ n: 1 }]);
    });

    it.each([
      ['après l’insertion et l’ouverture du grand livre (version de configuration)', () => jest.spyOn(app.get(CascadeService), 'writeVersion')],
      ['à la dernière étape (ligne d’audit)', () => jest.spyOn(app.get(AuditService), 'record')],
    ])('atomicité, panne %s : ni événement, ni grand livre, ni compte, ni version de configuration', async (_step, inject) => {
      const body = base();
      const orphans = () =>
        rows(
          `SELECT (SELECT count(*) FROM ledger l WHERE l.scope_type = 'EVENT' AND l.operator_id = $1 AND NOT EXISTS (SELECT 1 FROM event e WHERE e.id = l.scope_id))::int AS ledgers,
                  (SELECT count(*) FROM config_version c WHERE c.scope_type = 'EVENT' AND c.operator_id = $1 AND NOT EXISTS (SELECT 1 FROM event e WHERE e.id = c.scope_id))::int AS versions,
                  (SELECT count(*) FROM account a WHERE a.operator_id = $1 AND NOT EXISTS (SELECT 1 FROM ledger l WHERE l.id = a.ledger_id))::int AS accounts`,
          [ops.a],
        );
      const spy = inject().mockRejectedValueOnce(new Error('panne injectée'));
      const res = await post(organizerAdmin, EVENTS(), body);
      spy.mockRestore();
      expect(res.status).toBe(500);
      expect(await rows('SELECT count(*)::int AS n FROM event WHERE name = $1', [body.name])).toEqual([{ n: 0 }]);
      expect(await orphans()).toEqual([{ ledgers: 0, versions: 0, accounts: 0 }]);
    });
  });

  describe('lecture', () => {
    it('liste filtrée, lecture, portées : organisateur, superviseur de l’événement, autres rôles', async () => {
      const event = await newEvent();
      const other = await newEvent({ organizer_id: ids.a2 }, adminA);
      supervisor = await withOwner((db) => idp.createPerson(db, { operatorId: ops.a, roles: [{ role: 'SUPERVISOR', scopeType: 'EVENT', scopeId: event.event_id }] }));

      const all = await get(adminA, `${EVENTS()}?limit=200`);
      expect(all.body.data.map((e: { event_id: string }) => e.event_id)).toEqual(expect.arrayContaining([event.event_id, other.event_id]));
      const mine = await get(organizerAdmin, `${EVENTS()}?limit=200&status=DRAFT`);
      const mineIds = mine.body.data.map((e: { event_id: string }) => e.event_id);
      expect(mineIds).toContain(event.event_id);
      expect(mineIds).not.toContain(other.event_id);
      expect((await get(adminA, `${EVENTS()}?organizer_id=${ids.a2}&limit=200`)).body.data.every((e: { organizer_id: string }) => e.organizer_id === ids.a2)).toBe(true);
      expect((await get(supervisor, `${EVENTS()}?limit=200`)).body.data.map((e: { event_id: string }) => e.event_id)).toEqual([event.event_id]);

      expect((await get(organizerAdmin, `${EVENTS()}/${event.event_id}`)).body).toMatchObject({ event_id: event.event_id, ledger_id: event.ledger_id, config_version_id: event.config_version_id });
      expect((await get(supervisor, `${EVENTS()}/${event.event_id}`)).status).toBe(200);
      expect((await get(supervisor, `${EVENTS()}/${other.event_id}`)).status).toBe(403);
      expect((await get(otherOrganizerAdmin, `${EVENTS()}/${event.event_id}`)).status).toBe(403);
      expect((await get(cashier, `${EVENTS()}/${event.event_id}`)).status).toBe(403);
      expect((await get(adminA, `${EVENTS()}/${randomUUID()}`)).status).toBe(404);
      expect((await get(adminA, `${EVENTS()}?status=OUVERT`)).status).toBe(400);
    });
  });

  describe('modification', () => {
    it('DRAFT : immédiate, nouvelle version de configuration, audit avant / après', async () => {
      const event = await newEvent();
      const res = await patch(organizerAdmin, `${EVENTS()}/${event.event_id}`, { name: 'Renommé', cash_refund_single_max: 80000, refund_deadline: '2027-06-01T00:00:00Z' });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ name: 'Renommé', cash_refund_single_max: 80000, refund_deadline: '2027-06-01T00:00:00.000Z', refund_deadline_source: 'EXPLICIT', status: 'DRAFT' });
      expect(res.body.config_version_id).not.toBe(event.config_version_id);
      expect(await rows(`SELECT version, settings->>'cash_refund_single_max' AS max FROM config_version WHERE scope_type = 'EVENT' AND scope_id = $1 ORDER BY version`, [event.event_id])).toEqual([
        { version: 1, max: '50000' },
        { version: 2, max: '80000' },
      ]);
      expect(await rows(`SELECT before->>'name' AS before, after->>'name' AS after FROM audit_log WHERE object_id = $1 AND action = 'EVENT_UPDATED'`, [event.event_id])).toEqual([
        { before: event.name, after: 'Renommé' },
      ]);
    });

    it('qui règle quoi : réglage de terminal réservé au prestataire (403 pour l’organisateur), et réciproquement', async () => {
      const event = await newEvent();
      const path = `${EVENTS()}/${event.event_id}`;
      expect((await patch(organizerAdmin, path, { online_retries: 3 })).status).toBe(403);
      expect((await patch(organizerAdmin, path, { reversal_window_minutes: 30 })).status).toBe(200);
      expect((await patch(adminA, path, { online_retries: 3, heartbeat_seconds: 120 })).body).toMatchObject({ online_retries: 3, heartbeat_seconds: 120 });
      expect((await patch(adminA, path, { name: 'Par le prestataire' })).status).toBe(403);
      expect((await patch(otherOrganizerAdmin, path, { name: 'Intrus' })).status).toBe(403);
      // Clés de deux rôles dans la même requête : 403 tant qu'un des rôles manque.
      expect((await patch(organizerAdmin, path, { name: 'Mixte', online_retries: 1 })).status).toBe(403);
      expect((await get(adminA, path)).body).toMatchObject({ online_retries: 3, reversal_window_minutes: 30, name: event.name });
    });

    it('bornes : §9.8, maximum du prestataire, législation, délais liés ; statut et clés inconnues refusés', async () => {
      const event = await newEvent({ jurisdiction_id: ids.strict });
      const path = `${EVENTS()}/${event.event_id}`;
      const heartbeat = await patch(adminA, path, { heartbeat_seconds: 10 });
      expect(heartbeat.status).toBe(422);
      expect(problem(heartbeat).violations).toMatchObject([{ field: 'heartbeat_seconds', rule: 'catalog.range', limit: [30, 300] }]);
      expect(problem(await patch(organizerAdmin, path, { cash_refund_single_max: 150000 })).violations?.map((v) => v.rule)).toEqual(['operator.cash_refund_single_max_cap']);
      expect(problem(await patch(organizerAdmin, path, { refund_deadline: '2027-01-15T00:00:00Z' })).violations?.map((v) => v.rule)).toEqual(['jurisdiction.min_refund_window_days']);
      expect(problem(await patch(adminA, path, { online_connect_timeout_ms: 3000 })).violations?.map((v) => v.rule)).toEqual(['catalog.connect_lt_total']);
      expect((await patch(organizerAdmin, path, { status: 'LIVE' })).status).toBe(400);
      expect((await patch(organizerAdmin, path, { currency: 'EUR' })).status).toBe(400);
      expect((await patch(organizerAdmin, path, {})).status).toBe(400);
      expect(await rows('SELECT status, currency::text FROM event WHERE id = $1', [event.event_id])).toEqual([{ status: 'DRAFT', currency: 'XOF' }]);
    });

    it('LIVE : demande à deux, appliquée à l’approbation par une seconde personne du même rôle', async () => {
      const event = await newEvent();
      await goLive(event.event_id);
      const path = `${EVENTS()}/${event.event_id}`;
      const demand = await patch(organizerAdmin, path, { cash_refund_single_max: 60000 });
      expect(demand.status).toBe(202);
      expect(demand.body).toMatchObject({ action: 'EVENT_SETTINGS_CHANGE', status: 'PENDING', target_id: event.event_id, requested_by: organizerAdmin.userId });
      expect((await get(organizerAdmin, path)).body.cash_refund_single_max).toBe(50000);
      // Réglage du prestataire : autre action, autre rôle.
      const operatorDemand = await patch(adminA, path, { sync_deadline_hours: 48 });
      expect(operatorDemand.body).toMatchObject({ action: 'EVENT_OPERATOR_SETTINGS_CHANGE', status: 'PENDING' });
      // Détenteur des fonds et émetteur : plus après DRAFT.
      expect(problem(await patch(organizerAdmin, path, { issuer: 'OPERATOR' })).violations?.map((v) => v.rule)).toEqual(['catalog.draft_only']);

      const own = await post(organizerAdmin, `/v1/approval-requests/${demand.body.approval_request_id}/approve`);
      expect([own.status, problem(own).code]).toEqual([409, 'APPROVAL_INVALID']);
      expect((await post(otherOrganizerAdmin, `/v1/approval-requests/${demand.body.approval_request_id}/approve`)).status).toBe(403);
      const approved = await post(organizerAdmin2, `/v1/approval-requests/${demand.body.approval_request_id}/approve`);
      expect(approved.status).toBe(200);
      expect(approved.body).toMatchObject({ status: 'EXECUTED', result: { event_id: event.event_id, cash_refund_single_max: 60000 } });
      expect((await get(organizerAdmin, path)).body.cash_refund_single_max).toBe(60000);
      expect(await rows(`SELECT actor_id, approver_id FROM audit_log WHERE object_id = $1 AND action = 'EVENT_UPDATED'`, [event.event_id])).toEqual([
        { actor_id: organizerAdmin.userId, approver_id: organizerAdmin2.userId },
      ]);
      // La seconde demande datait d'avant ce changement : la configuration a changé, elle échoue sans rien modifier.
      const stale = await post(adminA2, `/v1/approval-requests/${operatorDemand.body.approval_request_id}/approve`);
      expect(stale.body).toMatchObject({ status: 'FAILED', failure_code: 'CONFLICT_STATE' });
      expect((await get(adminA, path)).body.sync_deadline_hours).toBe(72);
    });

    it('à partir de CLOSING : 409', async () => {
      const event = await newEvent();
      await withOwner(async (db) => {
        await db.query('BEGIN');
        await db.query(`SELECT set_config('app.operator_id', $1, true)`, [ops.a]);
        await db.query(`SELECT set_event_status($1, 'LIVE', $2)`, [event.event_id, adminA.userId]);
        await db.query(`SELECT set_event_status($1, 'CLOSING', $2)`, [event.event_id, adminA.userId]);
        await db.query('COMMIT');
      });
      const res = await patch(organizerAdmin, `${EVENTS()}/${event.event_id}`, { name: 'Trop tard' });
      expect([res.status, problem(res).code]).toEqual([409, 'CONFLICT_STATE']);
    });
  });

  describe('configuration résolue', () => {
    it('valeur, niveau et version d’origine ; à une date antérieure ; valeur provisoire signalée', async () => {
      const event = await newEvent();
      const path = `${EVENTS()}/${event.event_id}`;
      // Date de résolution « antérieure » : une milliseconde après la date d'effet de la version 1, lue dans la base
      // (jamais l'horloge du test, qui peut différer de celle de la base).
      const [v1] = await rows<{ valid_from: Date }>(`SELECT valid_from FROM config_version WHERE id = $1`, [event.config_version_id]);
      const between = new Date(v1!.valid_from.getTime() + 1).toISOString();
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect((await patch(adminA, path, { sync_deadline_hours: 24 })).status).toBe(200);

      // « Maintenant » se lit à l'horloge de la base, qui peut reculer de quelques dizaines de millisecondes quand
      // elle tourne dans une VM : la version tout juste écrite est attendue brièvement.
      let now = (await get(organizerAdmin, `${path}/config`)).body;
      for (let attempt = 0; attempt < 20 && now.sync_deadline_hours.version !== 2; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        now = (await get(organizerAdmin, `${path}/config`)).body;
      }
      expect(now.sync_deadline_hours).toMatchObject({ value: 24, level: 'EVENT', version: 2, provisional: false });
      expect(now.psp_fee_bearer).toMatchObject({ value: 'OPERATOR', level: 'OPERATOR' });
      expect(now.spend_order.level === null || now.spend_order.level === 'PLATFORM').toBe(true);
      expect(now.refund_deadline).toMatchObject({ value: '2027-01-30T06:00:00.000Z', provisional: true });
      expect(now).not.toHaveProperty('funds_holder');
      const earlier = (await get(organizerAdmin, `${path}/config?at=${encodeURIComponent(between)}`)).body;
      expect(earlier.sync_deadline_hours).toMatchObject({ value: 72, level: 'EVENT', version: 1, config_version_id: event.config_version_id });

      expect((await get(organizerAdmin, `${path}/config?at=hier`)).status).toBe(422);
      expect((await get(organizerAdmin, `${path}/config?participation_id=${randomUUID()}`)).status).toBe(404);
      expect((await get(otherOrganizerAdmin, `${path}/config`)).status).toBe(403);
    });
  });

  describe('isolation à deux prestataires', () => {
    it('le personnel de B ne lit ni ne modifie aucun événement de A', async () => {
      const event = await newEvent();
      for (const path of ['', `/${event.event_id}`, `/${event.event_id}/config`]) expect([path, (await get(adminB, `${EVENTS()}${path}`)).status]).toEqual([path, 404]);
      expect((await post(adminB, EVENTS(), base())).status).toBe(404);
      expect((await patch(adminB, `${EVENTS()}/${event.event_id}`, { sync_deadline_hours: 1 })).status).toBe(404);
      const fromB = `/v1/operators/${ops.b}/events`;
      expect((await get(adminB, `${fromB}/${event.event_id}`)).status).toBe(404);
      expect((await get(adminB, `${fromB}/${event.event_id}/config`)).status).toBe(404);
      expect((await patch(adminB, `${fromB}/${event.event_id}`, { sync_deadline_hours: 1 })).status).toBe(404);
      expect((await post(adminB, fromB, base())).status).toBe(404);
      expect((await get(adminB, `${fromB}?limit=200`)).body.data).toEqual([]);
      expect(await rows('SELECT sync_deadline_hours FROM event WHERE id = $1', [event.event_id])).toEqual([{ sync_deadline_hours: 72 }]);
    });
  });
});
