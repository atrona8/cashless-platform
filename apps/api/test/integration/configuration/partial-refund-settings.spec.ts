// Intégration : réglages du rendu partiel en espèces (FR-004, FR-005, FR-013, NFR-003) — le prestataire autorise
// (`cash_partial_refund_allowed`, niveau prestataire), l'organisateur active (`cash_partial_refund_enabled`, colonne
// de l'événement), refusés par défaut, règle croisée `operator.cash_partial_refund_allowed`, deux personnes en LIVE.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from '../../support/app';
import { withOwner } from '../../support/db';
import { FakeIdp, type TestPerson } from '../../support/fake-idp';
import { createOperators, type Operators } from '../transverse/fixtures';

describe('réglages du rendu partiel en espèces', () => {
  let idp: FakeIdp;
  let app: INestApplication;
  let ops: Operators;
  let adminA: TestPerson; // OPERATOR_ADMIN de A
  let adminB: TestPerson; // OPERATOR_ADMIN de B (autre prestataire)
  let orgAdmin: TestPerson; // ORGANIZER_ADMIN de a1
  let orgAdmin2: TestPerson;
  const ids = { a1: randomUUID(), free: randomUUID() };

  beforeAll(async () => {
    idp = await FakeIdp.create();
    ops = await createOperators();
    await withOwner(async (db) => {
      await db.query(
        `INSERT INTO party (kind, legal_name) SELECT 'PLATFORM', 'Plateforme (test)' WHERE NOT EXISTS (SELECT 1 FROM party WHERE kind = 'PLATFORM')`,
      );
      await db.query(
        `INSERT INTO party (id, kind, operator_id, legal_name, country_code) VALUES ($1, 'ORGANIZER', $2, 'Organisateur A1', 'SN')`,
        [ids.a1, ops.a],
      );
      await db.query(
        `INSERT INTO jurisdiction_profile (id, country_code, version, valid_from, breakage_destination)
         VALUES ($1, 'SN', (1000000 + floor(random() * 1000000000))::int, '2026-01-01', 'LEGAL_ACCOUNT')`,
        [ids.free],
      );
      const person = (operatorId: string, roles: Parameters<FakeIdp['createPerson']>[1]['roles']) =>
        idp.createPerson(db, { operatorId, roles });
      adminA = await person(ops.a, [
        { role: 'OPERATOR_ADMIN', scopeType: 'OPERATOR', scopeId: ops.a },
      ]);
      adminB = await person(ops.b, [
        { role: 'OPERATOR_ADMIN', scopeType: 'OPERATOR', scopeId: ops.b },
      ]);
      orgAdmin = await person(ops.a, [
        { role: 'ORGANIZER_ADMIN', scopeType: 'ORGANIZER', scopeId: ids.a1 },
      ]);
      orgAdmin2 = await person(ops.a, [
        { role: 'ORGANIZER_ADMIN', scopeType: 'ORGANIZER', scopeId: ids.a1 },
      ]);
    });
    app = await createTestApp({ identity: idp });
  });

  afterAll(async () => {
    await app.close();
  });

  const send = (method: 'post' | 'patch', who: TestPerson, path: string, body: object = {}) =>
    request(app.getHttpServer())
      [method](path)
      .set('Authorization', `Bearer ${who.token}`)
      .set('Idempotency-Key', randomUUID())
      .send(body);
  const get = (who: TestPerson, path: string) =>
    request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${who.token}`);
  const problem = (res: request.Response) =>
    JSON.parse(res.text) as {
      code?: string;
      violations?: Array<{ rule: string; field: string; requested: unknown; limit: unknown }>;
    };
  const eventsA = () => `/v1/operators/${ops.a}/events`;
  const operatorConfig = (who: TestPerson, operator: string, settings: object) =>
    send('post', who, `/v1/operators/${operator}/config-versions`, { settings });
  const authorize = (value: boolean) =>
    operatorConfig(adminA, ops.a, { cash_partial_refund_allowed: value });
  const newEvent = async (extra: object = {}) => {
    const res = await send('post', orgAdmin, eventsA(), {
      organizer_id: ids.a1,
      name: `Festival ${randomUUID()}`,
      currency: 'XOF',
      timezone: 'Africa/Dakar',
      jurisdiction_id: ids.free,
      funds_holder: 'ORGANIZER',
      starts_at: '2026-12-28T18:00:00Z',
      ends_at: '2026-12-31T06:00:00Z',
      ...extra,
    });
    expect(res.status).toBe(201);
    return res.body as { event_id: string; cash_partial_refund_enabled: boolean };
  };
  const goLive = (eventId: string) =>
    withOwner(async (db) => {
      await db.query('BEGIN');
      await db.query(`SELECT set_config('app.operator_id', $1, true)`, [ops.a]);
      await db.query(`SELECT set_event_status($1, 'LIVE', $2)`, [eventId, adminA.userId]);
      await db.query('COMMIT');
    });
  const enabledInDb = async (eventId: string) =>
    withOwner(
      async (db) =>
        (
          await db.query<{ v: boolean }>(
            'SELECT cash_partial_refund_enabled AS v FROM event WHERE id = $1',
            [eventId],
          )
        ).rows[0]!.v,
    );

  it('défauts : événement neuf désactivé, autorisation du prestataire refusée', async () => {
    const event = await newEvent();
    expect(event.cash_partial_refund_enabled).toBe(false);
    expect(await enabledInDb(event.event_id)).toBe(false);
    const config = await get(orgAdmin, `${eventsA()}/${event.event_id}/config`);
    expect(config.status).toBe(200);
    expect(config.body.cash_partial_refund_allowed.value).toBe(false);
    expect(config.body.cash_partial_refund_enabled.value).toBe(false);
  });

  it('la création ne peut pas activer le réglage (champ ignoré, défaut conservé)', async () => {
    const event = await newEvent({ cash_partial_refund_enabled: true });
    expect(event.cash_partial_refund_enabled).toBe(false);
    expect(await enabledInDb(event.event_id)).toBe(false);
  });

  it('sans autorisation du prestataire : 422 operator.cash_partial_refund_allowed, rien ne change', async () => {
    const event = await newEvent();
    const res = await send('patch', orgAdmin, `${eventsA()}/${event.event_id}`, {
      cash_partial_refund_enabled: true,
    });
    expect(res.status).toBe(422);
    expect(problem(res).code).toBe('VALIDATION_FAILED');
    expect(problem(res).violations).toEqual([
      expect.objectContaining({
        field: 'cash_partial_refund_enabled',
        rule: 'operator.cash_partial_refund_allowed',
        requested: true,
        limit: false,
      }),
    ]);
    expect(await enabledInDb(event.event_id)).toBe(false);
    // Désactiver reste toujours permis.
    const off = await send('patch', orgAdmin, `${eventsA()}/${event.event_id}`, {
      cash_partial_refund_enabled: false,
    });
    expect(off.status).toBe(200);
  });

  it('qui règle quoi : le prestataire ne règle pas l’activation, l’organisateur ne s’autorise pas', async () => {
    const event = await newEvent();
    const path = `${eventsA()}/${event.event_id}`;
    expect((await send('patch', adminA, path, { cash_partial_refund_enabled: true })).status).toBe(
      403,
    );
    // L'organisateur ne peut ni écrire au niveau prestataire, ni poser la clé à son niveau.
    expect(
      (await operatorConfig(orgAdmin, ops.a, { cash_partial_refund_allowed: true })).status,
    ).toBe(403);
    const organizerLevel = await send(
      'post',
      orgAdmin,
      `/v1/operators/${ops.a}/organizers/${ids.a1}/config-versions`,
      { settings: { cash_partial_refund_allowed: true } },
    );
    expect(organizerLevel.status).toBe(403);

    // Un booléen strict : ni chaîne ni entier.
    for (const bad of ['true', 1]) {
      const res = await operatorConfig(adminA, ops.a, { cash_partial_refund_allowed: bad });
      expect([res.status, problem(res).violations?.[0]?.rule]).toEqual([422, 'catalog.type']);
    }
    const config = await get(orgAdmin, `${eventsA()}/${event.event_id}/config`);
    expect(config.body.cash_partial_refund_allowed.value).toBe(false);
  });

  it('le prestataire autorise, puis l’organisateur active (DRAFT) : 200', async () => {
    const authorized = await authorize(true);
    expect(authorized.status).toBe(201);
    const event = await newEvent();
    const res = await send('patch', orgAdmin, `${eventsA()}/${event.event_id}`, {
      cash_partial_refund_enabled: true,
    });
    expect(res.status).toBe(200);
    expect(res.body.cash_partial_refund_enabled).toBe(true);
    expect(await enabledInDb(event.event_id)).toBe(true);
    const read = await get(orgAdmin, `${eventsA()}/${event.event_id}`);
    expect(read.body.cash_partial_refund_enabled).toBe(true);
    const config = await get(orgAdmin, `${eventsA()}/${event.event_id}/config`);
    expect(config.body.cash_partial_refund_allowed.value).toBe(true);
    expect(config.body.cash_partial_refund_enabled.value).toBe(true);
    // Ligne d'audit existante : la clé y figure.
    const audit = await withOwner(
      async (db) =>
        (
          await db.query<{ after: Record<string, unknown> }>(
            `SELECT after FROM audit_log WHERE object_id = $1 AND action = 'EVENT_UPDATED'`,
            [event.event_id],
          )
        ).rows,
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]!.after.cash_partial_refund_enabled).toBe(true);
  });

  it('LIVE : demande à deux personnes (202), appliquée par une autre personne', async () => {
    expect((await authorize(true)).status).toBe(201);
    const event = await newEvent();
    await goLive(event.event_id);
    const path = `${eventsA()}/${event.event_id}`;
    const demand = await send('patch', orgAdmin, path, { cash_partial_refund_enabled: true });
    expect(demand.status).toBe(202);
    expect(demand.body).toMatchObject({ action: 'EVENT_SETTINGS_CHANGE', status: 'PENDING' });
    expect(await enabledInDb(event.event_id)).toBe(false);
    const own = await send(
      'post',
      orgAdmin,
      `/v1/approval-requests/${demand.body.approval_request_id}/approve`,
    );
    expect(own.status).toBe(409);
    expect(await enabledInDb(event.event_id)).toBe(false);
    const approved = await send(
      'post',
      orgAdmin2,
      `/v1/approval-requests/${demand.body.approval_request_id}/approve`,
    );
    expect(approved.status).toBe(200);
    expect(approved.body.status).toBe('EXECUTED');
    expect(await enabledInDb(event.event_id)).toBe(true);
  });

  it('LIVE : autorisation retirée entre la demande et l’approbation, rien n’est activé', async () => {
    expect((await authorize(true)).status).toBe(201);
    const event = await newEvent();
    await goLive(event.event_id);
    const demand = await send('patch', orgAdmin, `${eventsA()}/${event.event_id}`, {
      cash_partial_refund_enabled: true,
    });
    expect(demand.status).toBe(202);
    expect((await authorize(false)).status).toBe(201);
    const approved = await send(
      'post',
      orgAdmin2,
      `/v1/approval-requests/${demand.body.approval_request_id}/approve`,
    );
    expect(approved.body).toMatchObject({
      status: 'FAILED',
      failure_code: 'VALIDATION_FAILED',
      result: null,
    });
    expect(approved.body.failure_reason).toContain('operator.cash_partial_refund_allowed');
    expect(await enabledInDb(event.event_id)).toBe(false);
    // Autorisation retirée : une nouvelle activation est refusée, la désactivation reste permise.
    const again = await send('patch', orgAdmin, `${eventsA()}/${event.event_id}`, {
      cash_partial_refund_enabled: true,
    });
    expect([again.status, problem(again).violations?.[0]?.rule]).toEqual([
      422,
      'operator.cash_partial_refund_allowed',
    ]);
  });

  it('isolation : un autre prestataire ne voit ni ne modifie rien (NFR-003)', async () => {
    expect((await authorize(true)).status).toBe(201);
    const event = await newEvent();
    const path = `${eventsA()}/${event.event_id}`;
    expect((await get(adminB, path)).status).toBeGreaterThanOrEqual(403);
    expect(
      (await send('patch', adminB, path, { cash_partial_refund_enabled: true })).status,
    ).toBeGreaterThanOrEqual(403);
    expect(
      (await operatorConfig(adminB, ops.a, { cash_partial_refund_allowed: false })).status,
    ).toBeGreaterThanOrEqual(403);
    expect(await enabledInDb(event.event_id)).toBe(false);
    // L'autorisation de A ne vaut pas pour B : son résolu reste refusé.
    const own = await get(adminB, `/v1/operators/${ops.b}/config-versions`);
    expect(JSON.stringify(own.body)).not.toContain('cash_partial_refund_allowed":true');
  });
});
