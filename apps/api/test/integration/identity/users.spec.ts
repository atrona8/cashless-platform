// Intégration : routes « Personnes » (FR-006, FR-008, contrat openapi.yaml) avec le faux serveur d'identité —
// règles d'attribution (positif et négatif), auto-attribution, doublons, isolation, audit exact, rejeu idempotent.
import { randomInt, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from '../../support/app';
import { withOwner } from '../../support/db';
import { FakeIdp, type TestPerson } from '../../support/fake-idp';
import { createOperators, type Operators } from '../transverse/fixtures';

describe('gestion des personnes et des rôles', () => {
  let idp: FakeIdp;
  let app: INestApplication;
  let ops: Operators;
  const ids = { org1: randomUUID(), org2: randomUUID(), event1: randomUUID(), event2: randomUUID(), merchant1: randomUUID(), merchant2: randomUUID() };
  let platform: TestPerson;
  let opAdminA: TestPerson;
  let opAdminB: TestPerson;
  let orgAdmin1: TestPerson; // ORGANIZER_ADMIN de org1 (event1, merchant1 participe à event1)
  let cashier: TestPerson; // CASHIER sur event1, sans droit d'administration

  beforeAll(async () => {
    idp = await FakeIdp.create();
    ops = await createOperators();
    await withOwner(async (db) => {
      const jurisdiction = randomUUID();
      await db.query(
        `INSERT INTO jurisdiction_profile (id, country_code, version, valid_from, breakage_destination)
         VALUES ($1, 'SN', $2, '2026-01-01', 'ORGANIZER')`,
        [jurisdiction, randomInt(1_000_000, 2_000_000_000)],
      );
      await db.query(
        `INSERT INTO party (id, kind, operator_id, legal_name, country_code) VALUES
           ($1, 'ORGANIZER', $5, 'Organisateur 1', 'SN'), ($2, 'ORGANIZER', $5, 'Organisateur 2', 'SN'),
           ($3, 'MERCHANT', $5, 'Commerçant 1', 'SN'), ($4, 'MERCHANT', $5, 'Commerçant 2', 'SN')`,
        [ids.org1, ids.org2, ids.merchant1, ids.merchant2, ops.a],
      );
      await db.query(
        `INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone, jurisdiction_id, funds_holder) VALUES
           ($1, $3, $4, 'Festival 1', 'XOF', 'Africa/Dakar', $6, 'ORGANIZER'),
           ($2, $3, $5, 'Festival 2', 'XOF', 'Africa/Dakar', $6, 'ORGANIZER')`,
        [ids.event1, ids.event2, ops.a, ids.org1, ids.org2, jurisdiction],
      );
      await db.query(
        `INSERT INTO merchant_participation (operator_id, event_id, merchant_id, link_type, payout_to)
         VALUES ($1, $2, $3, 'EXTERNAL', $3)`,
        [ops.a, ids.event1, ids.merchant1],
      );
      // Administrateur de la plateforme existant (amorcé) : on ne retire jamais le dernier.
      platform = await idp.createPerson(db, { operatorId: null, roles: [{ role: 'PLATFORM_ADMIN', scopeType: 'PLATFORM' }] });
      opAdminA = await idp.createPerson(db, { operatorId: ops.a, roles: [{ role: 'OPERATOR_ADMIN', scopeType: 'OPERATOR', scopeId: ops.a }] });
      opAdminB = await idp.createPerson(db, { operatorId: ops.b, roles: [{ role: 'OPERATOR_ADMIN', scopeType: 'OPERATOR', scopeId: ops.b }] });
      orgAdmin1 = await idp.createPerson(db, { operatorId: ops.a, roles: [{ role: 'ORGANIZER_ADMIN', scopeType: 'ORGANIZER', scopeId: ids.org1 }] });
      cashier = await idp.createPerson(db, { operatorId: ops.a, roles: [{ role: 'CASHIER', scopeType: 'EVENT', scopeId: ids.event1 }] });
    });
    app = await createTestApp({ identity: idp });
  });

  afterAll(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const base = (operatorId: string) => `/v1/operators/${operatorId}`;
  const post = (who: TestPerson, path: string, body: object = {}, key: string = randomUUID()) =>
    http().post(path).set('Authorization', `Bearer ${who.token}`).set('Idempotency-Key', key).set('X-Request-Id', randomUUID()).send(body);
  const get = (who: TestPerson, path: string) => http().get(path).set('Authorization', `Bearer ${who.token}`);
  const code = (res: request.Response) => (JSON.parse(res.text) as { code?: string }).code;

  const auditOf = (requestId: string) =>
    withOwner(async (db) => {
      const { rows } = await db.query<{ action: string; actor_id: string; actor_role: string; object_id: string; operator_id: string | null }>(
        'SELECT action, actor_id, actor_role, object_id, operator_id FROM audit_log WHERE request_id = $1',
        [requestId],
      );
      return rows;
    });

  let seq = 0;
  /** Crée une personne de A par l'administrateur du prestataire ; rend son identifiant. */
  const newUser = async (operatorId = ops.a, by = opAdminA): Promise<string> => {
    seq += 1;
    const res = await post(by, `${base(operatorId)}/users`, {
      issuer: idp.config.issuer,
      subject: `staff-${randomUUID()}`,
      display_name: `Personne ${seq}`,
      email: `p${seq}@test.local`,
    });
    expect(res.status).toBe(201);
    return res.body.user_id as string;
  };
  const grant = (who: TestPerson, userId: string, role: string, scopeType: string, scopeId: string | null, operatorId = ops.a) =>
    post(who, `${base(operatorId)}/users/${userId}/role-assignments`, { role, scope_type: scopeType, scope_id: scopeId });

  describe('createUser', () => {
    it('201, Location, corps du contrat, une ligne d’audit USER_CREATED exacte', async () => {
      const requestId = randomUUID();
      const subject = `staff-${randomUUID()}`;
      const res = await http()
        .post(`${base(ops.a)}/users`)
        .set('Authorization', `Bearer ${opAdminA.token}`)
        .set('Idempotency-Key', randomUUID())
        .set('X-Request-Id', requestId)
        .send({ issuer: idp.config.issuer, subject, display_name: 'Awa', phone: '+221770000001', approved_by: randomUUID(), extra: 1 });
      expect(res.status).toBe(201);
      expect(res.headers.location).toBe(`/v1/operators/${ops.a}/users/${res.body.user_id}`);
      expect(res.body).toMatchObject({
        operator_id: ops.a,
        issuer: idp.config.issuer,
        subject,
        email: null,
        phone: '+221770000001',
        display_name: 'Awa',
        status: 'ACTIVE',
        disabled_at: null,
        role_assignments: [],
      });
      expect(await auditOf(requestId)).toEqual([
        { action: 'USER_CREATED', actor_id: opAdminA.userId, actor_role: 'OPERATOR_ADMIN', object_id: res.body.user_id, operator_id: ops.a },
      ]);
    });

    it('rejeu idempotent : même réponse, une seule personne', async () => {
      const key = randomUUID();
      const body = { issuer: idp.config.issuer, subject: `staff-${randomUUID()}`, display_name: 'Rejeu', email: 'r@test.local' };
      const first = await post(opAdminA, `${base(ops.a)}/users`, body, key);
      const replay = await post(opAdminA, `${base(ops.a)}/users`, body, key);
      expect(replay.status).toBe(201);
      expect(replay.headers['idempotency-replayed']).toBe('true');
      expect(replay.body).toEqual(first.body);
      const count = await withOwner(async (db) => (await db.query('SELECT 1 FROM app_user WHERE subject = $1', [body.subject])).rowCount);
      expect(count).toBe(1);
    });

    it('(émetteur, sujet) déjà connu, même dans un autre prestataire : 409 CONFLICT_STATE', async () => {
      const res = await post(opAdminA, `${base(ops.a)}/users`, { issuer: idp.config.issuer, subject: opAdminB.subject, display_name: 'X', email: 'x@test.local' });
      expect(res.status).toBe(409);
      expect(code(res)).toBe('CONFLICT_STATE');
    });

    it('corps invalide (ni e-mail ni téléphone, sujet absent) : 400 VALIDATION_FAILED, aucun audit', async () => {
      const res = await post(opAdminA, `${base(ops.a)}/users`, { issuer: idp.config.issuer, subject: 's', display_name: 'X' });
      expect(res.status).toBe(400);
      expect((await post(opAdminA, `${base(ops.a)}/users`, { issuer: 'i', display_name: 'X', email: 'e@x' })).status).toBe(400);
    });

    it('sans rôle d’administration (CASHIER) : 403 ; autre prestataire : 404', async () => {
      const body = { issuer: idp.config.issuer, subject: `s-${randomUUID()}`, display_name: 'X', email: 'x@test.local' };
      expect((await post(cashier, `${base(ops.a)}/users`, body)).status).toBe(403);
      expect((await post(opAdminB, `${base(ops.a)}/users`, body)).status).toBe(404);
    });

    it('PLATFORM_ADMIN : agit dans le prestataire du chemin', async () => {
      const res = await post(platform, `${base(ops.b)}/users`, { issuer: idp.config.issuer, subject: `s-${randomUUID()}`, display_name: 'B', email: 'b@test.local' });
      expect(res.status).toBe(201);
      expect(res.body.operator_id).toBe(ops.b);
    });
  });

  describe('listUsers et getUser', () => {
    it('OPERATOR_ADMIN : toutes les personnes de son prestataire, paginées par curseur', async () => {
      await newUser();
      await newUser();
      const first = await get(opAdminA, `${base(ops.a)}/users?limit=2`);
      expect(first.status).toBe(200);
      expect(first.body.data).toHaveLength(2);
      expect(first.body.has_more).toBe(true);
      const all: string[] = first.body.data.map((u: { user_id: string }) => u.user_id);
      let cursor: string | null = first.body.next_cursor;
      while (cursor) {
        const page = await get(opAdminA, `${base(ops.a)}/users?limit=2&cursor=${encodeURIComponent(cursor)}`);
        all.push(...page.body.data.map((u: { user_id: string }) => u.user_id));
        cursor = page.body.next_cursor;
      }
      expect(new Set(all).size).toBe(all.length);
      expect(all).toEqual(expect.arrayContaining([opAdminA.userId, orgAdmin1.userId, cashier.userId]));
      expect(all).not.toContain(opAdminB.userId);
    });

    it('ORGANIZER_ADMIN : seulement les personnes de son organisateur ou créées par lui', async () => {
      const res = await get(orgAdmin1, `${base(ops.a)}/users?limit=200`);
      const seen = res.body.data.map((u: { user_id: string }) => u.user_id);
      expect(seen).toEqual(expect.arrayContaining([orgAdmin1.userId, cashier.userId]));
      expect(seen).not.toContain(opAdminA.userId);
      expect((await get(orgAdmin1, `${base(ops.a)}/users/${opAdminA.userId}`)).status).toBe(404);
    });

    it('getUser : attributions actives ; autre prestataire : 404 ; curseur ou limite invalide : 400', async () => {
      const res = await get(opAdminA, `${base(ops.a)}/users/${cashier.userId}`);
      expect(res.status).toBe(200);
      expect(res.body.role_assignments).toEqual([expect.objectContaining({ role: 'CASHIER', scope_type: 'EVENT', scope_id: ids.event1, revoked_at: null })]);
      expect((await get(opAdminB, `${base(ops.a)}/users/${cashier.userId}`)).status).toBe(404);
      expect((await get(opAdminB, `${base(ops.b)}/users/${cashier.userId}`)).status).toBe(404);
      expect((await get(opAdminA, `${base(ops.a)}/users?cursor=zzz`)).status).toBe(400);
      expect((await get(opAdminA, `${base(ops.a)}/users?limit=500`)).status).toBe(400);
    });
  });

  describe('grantRole : qui peut attribuer quoi', () => {
    it('OPERATOR_ADMIN → ORGANIZER_ADMIN : 201, Location, audit ROLE_GRANTED exact', async () => {
      const userId = await newUser();
      const requestId = randomUUID();
      const res = await http()
        .post(`${base(ops.a)}/users/${userId}/role-assignments`)
        .set('Authorization', `Bearer ${opAdminA.token}`)
        .set('Idempotency-Key', randomUUID())
        .set('X-Request-Id', requestId)
        .send({ role: 'ORGANIZER_ADMIN', scope_type: 'ORGANIZER', scope_id: ids.org1, approved_by: randomUUID() });
      expect(res.status).toBe(201);
      expect(res.headers.location).toBe(`/v1/operators/${ops.a}/users/${userId}`);
      expect(res.body).toMatchObject({ role: 'ORGANIZER_ADMIN', scope_type: 'ORGANIZER', scope_id: ids.org1, granted_by: opAdminA.userId, revoked_at: null });
      expect(await auditOf(requestId)).toEqual([
        { action: 'ROLE_GRANTED', actor_id: opAdminA.userId, actor_role: 'OPERATOR_ADMIN', object_id: res.body.assignment_id, operator_id: ops.a },
      ]);
    });

    it('PLATFORM_ADMIN → OPERATOR_ADMIN : 201 ; PLATFORM_ADMIN → CASHIER : 403', async () => {
      const userId = await newUser();
      expect((await grant(platform, userId, 'OPERATOR_ADMIN', 'OPERATOR', ops.a)).status).toBe(201);
      expect((await grant(platform, userId, 'CASHIER', 'EVENT', ids.event1)).status).toBe(403);
    });

    it('ORGANIZER_ADMIN → CASHIER / SUPERVISOR sur ses événements : 201 ; sur un autre organisateur : 403', async () => {
      const userId = await newUser();
      expect((await grant(orgAdmin1, userId, 'CASHIER', 'EVENT', ids.event1)).status).toBe(201);
      expect((await grant(orgAdmin1, userId, 'SUPERVISOR', 'ORGANIZER', ids.org1)).status).toBe(201);
      expect((await grant(orgAdmin1, userId, 'CASHIER', 'EVENT', ids.event2)).status).toBe(403);
    });

    it('ORGANIZER_ADMIN → MERCHANT_ADMIN : commerçant participant 201 ; non participant 403', async () => {
      const userId = await newUser();
      expect((await grant(orgAdmin1, userId, 'MERCHANT_ADMIN', 'MERCHANT', ids.merchant1)).status).toBe(201);
      expect((await grant(orgAdmin1, userId, 'MERCHANT_ADMIN', 'MERCHANT', ids.merchant2)).status).toBe(403);
    });

    it('escalade : ORGANIZER_ADMIN ne donne ni OPERATOR_ADMIN ni ORGANIZER_ADMIN (403, aucun audit)', async () => {
      const userId = await newUser();
      const res = await grant(orgAdmin1, userId, 'OPERATOR_ADMIN', 'OPERATOR', ops.a);
      expect(res.status).toBe(403);
      expect(await auditOf(res.headers['x-request-id'] as string)).toEqual([]);
      expect((await grant(orgAdmin1, userId, 'ORGANIZER_ADMIN', 'ORGANIZER', ids.org1)).status).toBe(403);
    });

    it('sans rôle d’administration (CASHIER) : 403', async () => {
      const userId = await newUser();
      expect((await grant(cashier, userId, 'CASHIER', 'EVENT', ids.event1)).status).toBe(403);
    });

    it('auto-attribution : 403', async () => {
      const res = await grant(opAdminA, opAdminA.userId, 'ORGANIZER_ADMIN', 'ORGANIZER', ids.org1);
      expect(res.status).toBe(403);
      expect(code(res)).toBe('FORBIDDEN');
    });

    it('rôle et portée incompatibles, VENDOR, CUSTOMER : 422 VALIDATION_FAILED', async () => {
      const userId = await newUser();
      expect((await grant(opAdminA, userId, 'CASHIER', 'MERCHANT', ids.merchant1)).status).toBe(422);
      expect((await grant(opAdminA, userId, 'VENDOR', 'MERCHANT', ids.merchant1)).status).toBe(422);
      expect((await grant(opAdminA, userId, 'CUSTOMER', 'OPERATOR', ops.a)).status).toBe(422);
      expect((await grant(opAdminA, userId, 'PLATFORM_ADMIN', 'PLATFORM', null)).status).toBe(422);
    });

    it('attribution active identique : 409 CONFLICT_STATE', async () => {
      const userId = await newUser();
      expect((await grant(opAdminA, userId, 'CASHIER', 'EVENT', ids.event1)).status).toBe(201);
      const again = await grant(opAdminA, userId, 'CASHIER', 'EVENT', ids.event1);
      expect(again.status).toBe(409);
      expect(code(again)).toBe('CONFLICT_STATE');
    });

    it('objet de portée d’un autre prestataire : 404 ; personne d’un autre prestataire : 404', async () => {
      const userB = await newUser(ops.b, opAdminB);
      expect((await grant(opAdminB, userB, 'ORGANIZER_ADMIN', 'ORGANIZER', ids.org1, ops.b)).status).toBe(404);
      expect((await grant(opAdminA, userB, 'CASHIER', 'EVENT', ids.event1)).status).toBe(404);
    });
  });

  describe('revokeRole et disableUser', () => {
    it('retrait par qui peut attribuer : 200, audit ROLE_REVOKED ; déjà retirée : 409', async () => {
      const userId = await newUser();
      const granted = await grant(orgAdmin1, userId, 'CASHIER', 'EVENT', ids.event1);
      const requestId = randomUUID();
      const res = await http()
        .post(`${base(ops.a)}/role-assignments/${granted.body.assignment_id}/revoke`)
        .set('Authorization', `Bearer ${orgAdmin1.token}`)
        .set('Idempotency-Key', randomUUID())
        .set('X-Request-Id', requestId);
      expect(res.status).toBe(200);
      expect(res.body.revoked_at).not.toBeNull();
      expect(await auditOf(requestId)).toEqual([
        { action: 'ROLE_REVOKED', actor_id: orgAdmin1.userId, actor_role: 'ORGANIZER_ADMIN', object_id: granted.body.assignment_id, operator_id: ops.a },
      ]);
      const again = await post(orgAdmin1, `${base(ops.a)}/role-assignments/${granted.body.assignment_id}/revoke`);
      expect(again.status).toBe(409);
    });

    it('retrait sans le droit d’attribuer ce rôle : 403 ; sa propre attribution : 403 ; autre prestataire : 404', async () => {
      const userId = await newUser();
      const granted = await grant(opAdminA, userId, 'ORGANIZER_ADMIN', 'ORGANIZER', ids.org1);
      expect((await post(orgAdmin1, `${base(ops.a)}/role-assignments/${granted.body.assignment_id}/revoke`)).status).toBe(403);
      const own = await get(opAdminA, `${base(ops.a)}/users/${opAdminA.userId}`);
      expect((await post(opAdminA, `${base(ops.a)}/role-assignments/${own.body.role_assignments[0].assignment_id}/revoke`)).status).toBe(403);
      expect((await post(opAdminB, `${base(ops.b)}/role-assignments/${granted.body.assignment_id}/revoke`)).status).toBe(404);
    });

    it('désactivation : 200, audit USER_DISABLED, la personne ne s’authentifie plus ; déjà désactivée : 409', async () => {
      const subject = `staff-${randomUUID()}`;
      const created = await post(opAdminA, `${base(ops.a)}/users`, { issuer: idp.config.issuer, subject, display_name: 'Partante', email: 'p@test.local' });
      const userId = created.body.user_id as string;
      await grant(opAdminA, userId, 'CASHIER', 'EVENT', ids.event1);
      const token = await idp.accessToken(subject);
      expect((await http().get(`${base(ops.a)}/users`).set('Authorization', `Bearer ${token}`)).status).toBe(403);
      const requestId = randomUUID();
      const res = await http()
        .post(`${base(ops.a)}/users/${userId}/disable`)
        .set('Authorization', `Bearer ${opAdminA.token}`)
        .set('Idempotency-Key', randomUUID())
        .set('X-Request-Id', requestId);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'DISABLED', disabled_at: expect.any(String) });
      expect(await auditOf(requestId)).toEqual([
        { action: 'USER_DISABLED', actor_id: opAdminA.userId, actor_role: 'OPERATOR_ADMIN', object_id: userId, operator_id: ops.a },
      ]);
      expect((await http().get(`${base(ops.a)}/users`).set('Authorization', `Bearer ${token}`)).status).toBe(401);
      expect((await post(opAdminA, `${base(ops.a)}/users/${userId}/disable`)).status).toBe(409);
      expect((await grant(opAdminA, userId, 'SUPERVISOR', 'EVENT', ids.event1)).status).toBe(409);
    });

    it('désactivation par un ORGANIZER_ADMIN : 403 ; autre prestataire : 404', async () => {
      const userId = await newUser();
      expect((await post(orgAdmin1, `${base(ops.a)}/users/${userId}/disable`)).status).toBe(403);
      expect((await post(opAdminB, `${base(ops.b)}/users/${userId}/disable`)).status).toBe(404);
    });

    it('administrateur de la plateforme : hors de portée des routes d’un prestataire (404)', async () => {
      expect((await post(opAdminA, `${base(ops.a)}/users/${platform.userId}/disable`)).status).toBe(404);
      expect((await post(platform, `${base(ops.a)}/users/${platform.userId}/disable`)).status).toBe(404);
    });
  });

  describe('createPlatformAdmin', () => {
    it('PLATFORM_ADMIN : 201, personne de la plateforme, audit PLATFORM_ADMIN_CREATED ; doublon 409', async () => {
      const requestId = randomUUID();
      const body = { issuer: idp.config.issuer, subject: `root-${randomUUID()}`, display_name: 'Second admin', email: 'root2@test.local' };
      const res = await http().post('/v1/platform-admins').set('Authorization', `Bearer ${platform.token}`).set('X-Request-Id', requestId).send(body);
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ operator_id: null, subject: body.subject, status: 'ACTIVE' });
      expect(res.body.role_assignments).toEqual([expect.objectContaining({ role: 'PLATFORM_ADMIN', scope_type: 'PLATFORM', granted_by: platform.userId })]);
      expect(await auditOf(requestId)).toEqual([
        { action: 'PLATFORM_ADMIN_CREATED', actor_id: platform.userId, actor_role: 'PLATFORM_ADMIN', object_id: res.body.user_id, operator_id: null },
      ]);
      // Le nouvel administrateur s'authentifie et agit sur un prestataire.
      const token = await idp.accessToken(body.subject);
      expect((await http().get(`${base(ops.a)}/users`).set('Authorization', `Bearer ${token}`)).status).toBe(200);
      const again = await http().post('/v1/platform-admins').set('Authorization', `Bearer ${platform.token}`).send(body);
      expect(again.status).toBe(409);
    });

    it('OPERATOR_ADMIN : 403, rien créé', async () => {
      const subject = `root-${randomUUID()}`;
      const res = await http()
        .post('/v1/platform-admins')
        .set('Authorization', `Bearer ${opAdminA.token}`)
        .send({ issuer: idp.config.issuer, subject, display_name: 'Intrus', email: 'i@test.local' });
      expect(res.status).toBe(403);
      const count = await withOwner(async (db) => (await db.query('SELECT 1 FROM app_user WHERE subject = $1', [subject])).rowCount);
      expect(count).toBe(0);
    });
  });
});
