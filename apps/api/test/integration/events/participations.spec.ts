// Intégration : participations et points de vente (FR-012, FR-013, FR-019, FR-020, NFR-004 ; US4 de la spec) —
// inscription d'un commerçant avec son compte dans le grand livre, droit de place, points de vente, modification à
// deux pendant LIVE, isolation à deux prestataires.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AuditService } from '../../../src/audit/audit.service';
import { ParticipationsService } from '../../../src/events/participations/participations.service';
import { createTestApp } from '../../support/app';
import { withOwner } from '../../support/db';
import { FakeIdp, type TestPerson } from '../../support/fake-idp';
import { createOperators, type Operators } from '../transverse/fixtures';

describe('participations et points de vente', () => {
  let idp: FakeIdp;
  let app: INestApplication;
  let ops: Operators;
  let adminA: TestPerson;
  let adminB: TestPerson;
  let organizerAdmin: TestPerson;
  let organizerAdmin2: TestPerson;
  let otherOrganizerAdmin: TestPerson;
  let merchantAdmin: TestPerson; // MERCHANT_ADMIN de m1
  const ids = {
    a1: randomUUID(),
    a2: randomUUID(),
    m1: randomUUID(),
    m2: randomUUID(),
    m3: randomUUID(),
    mB: randomUUID(),
    profile: randomUUID(),
  };

  beforeAll(async () => {
    idp = await FakeIdp.create();
    ops = await createOperators();
    await withOwner(async (db) => {
      await db.query(
        `INSERT INTO party (kind, legal_name) SELECT 'PLATFORM', 'Plateforme (test)' WHERE NOT EXISTS (SELECT 1 FROM party WHERE kind = 'PLATFORM')`,
      );
      await db.query(
        `INSERT INTO party (id, kind, operator_id, legal_name) VALUES
           ($1, 'ORGANIZER', $7, 'Organisateur A1'), ($2, 'ORGANIZER', $7, 'Organisateur A2'),
           ($3, 'MERCHANT', $7, 'Bar'), ($4, 'MERCHANT', $7, 'Food truck'), ($5, 'MERCHANT', $7, 'Tee-shirts'), ($6, 'MERCHANT', $8, 'Commerçant de B')`,
        [ids.a1, ids.a2, ids.m1, ids.m2, ids.m3, ids.mB, ops.a, ops.b],
      );
      await db.query(
        `INSERT INTO jurisdiction_profile (id, country_code, version, valid_from, breakage_destination) VALUES ($1, 'SN', (1000000 + floor(random() * 1000000000))::int, '2026-01-01', 'ORGANIZER')`,
        [ids.profile],
      );
      const person = (operatorId: string, roles: Parameters<FakeIdp['createPerson']>[1]['roles']) =>
        idp.createPerson(db, { operatorId, roles });
      adminA = await person(ops.a, [
        { role: 'OPERATOR_ADMIN', scopeType: 'OPERATOR', scopeId: ops.a },
      ]);
      adminB = await person(ops.b, [
        { role: 'OPERATOR_ADMIN', scopeType: 'OPERATOR', scopeId: ops.b },
      ]);
      organizerAdmin = await person(ops.a, [
        { role: 'ORGANIZER_ADMIN', scopeType: 'ORGANIZER', scopeId: ids.a1 },
      ]);
      organizerAdmin2 = await person(ops.a, [
        { role: 'ORGANIZER_ADMIN', scopeType: 'ORGANIZER', scopeId: ids.a1 },
      ]);
      otherOrganizerAdmin = await person(ops.a, [
        { role: 'ORGANIZER_ADMIN', scopeType: 'ORGANIZER', scopeId: ids.a2 },
      ]);
      merchantAdmin = await person(ops.a, [
        { role: 'MERCHANT_ADMIN', scopeType: 'MERCHANT', scopeId: ids.m1 },
      ]);
    });
    app = await createTestApp({ identity: idp });
  });

  afterAll(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const send = (
    method: 'post' | 'patch',
    who: TestPerson,
    path: string,
    body: object = {},
    key: string = randomUUID(),
  ) =>
    http()
      [method](path)
      .set('Authorization', `Bearer ${who.token}`)
      .set('Idempotency-Key', key)
      .send(body);
  const post = (who: TestPerson, path: string, body: object = {}, key?: string) =>
    send('post', who, path, body, key);
  const patch = (who: TestPerson, path: string, body: object = {}) =>
    send('patch', who, path, body);
  const get = (who: TestPerson, path: string) =>
    http().get(path).set('Authorization', `Bearer ${who.token}`);
  const problem = (res: request.Response) =>
    JSON.parse(res.text) as { code?: string; detail?: string };
  const rows = <T>(sql: string, params: unknown[] = []) =>
    withOwner(async (db) => (await db.query(sql, params)).rows as T[]);
  const A = () => `/v1/operators/${ops.a}`;
  const newEvent = async () => {
    const res = await post(organizerAdmin, `${A()}/events`, {
      organizer_id: ids.a1,
      name: `Festival ${randomUUID()}`,
      currency: 'XOF',
      timezone: 'Africa/Dakar',
      jurisdiction_id: ids.profile,
      funds_holder: 'ORGANIZER',
    });
    expect(res.status).toBe(201);
    return res.body as { event_id: string; ledger_id: string };
  };
  const setStatus = (eventId: string, ...statuses: string[]) =>
    withOwner(async (db) => {
      await db.query('BEGIN');
      await db.query(`SELECT set_config('app.operator_id', $1, true)`, [ops.a]);
      for (const status of statuses)
        await db.query(`SELECT set_event_status($1, $2::event_status, $3)`, [
          eventId,
          status,
          adminA.userId,
        ]);
      await db.query('COMMIT');
    });
  const join = async (eventId: string, merchantId: string, overrides: object = {}) => {
    const res = await post(organizerAdmin, `${A()}/events/${eventId}/participations`, {
      merchant_id: merchantId,
      link_type: 'EXTERNAL',
      ...overrides,
    });
    expect(res.status).toBe(201);
    return res.body as { participation_id: string; account_id: string };
  };

  describe('inscription (US4)', () => {
    it('EXTERNAL : droit de place par défaut, compte commerçant chaud dans le grand livre, versements au commerçant', async () => {
      const event = await newEvent();
      const res = await post(organizerAdmin, `${A()}/events/${event.event_id}/participations`, {
        merchant_id: ids.m1,
        link_type: 'EXTERNAL',
        operator_id: ops.b,
      });
      expect(res.status).toBe(201);
      expect(res.headers.location).toBe(`${A()}/participations/${res.body.participation_id}`);
      expect(res.body).toMatchObject({
        operator_id: ops.a,
        event_id: event.event_id,
        merchant_id: ids.m1,
        link_type: 'EXTERNAL',
        payout_to: ids.m1,
        pitch_fee_mode: 'DEDUCT_OR_DEBT',
        pitch_fee: 0,
        pitch_fee_reference: null,
      });
      const account = await rows(
        `SELECT ledger_id, code, family::text, purpose, owner_party_id, normal_side::text, hot, allow_negative FROM account WHERE id = $1`,
        [res.body.account_id],
      );
      expect(account).toEqual([
        {
          ledger_id: event.ledger_id,
          code: `L-MCH-${res.body.participation_id}`,
          family: 'CLAIM',
          purpose: 'MERCHANT',
          owner_party_id: ids.m1,
          normal_side: 'C',
          hot: true,
          allow_negative: true,
        },
      ]);
      expect(
        await rows(
          `SELECT action, actor_id, actor_role, operator_id FROM audit_log WHERE object_id = $1`,
          [res.body.participation_id],
        ),
      ).toEqual([
        {
          action: 'PARTICIPATION_CREATED',
          actor_id: organizerAdmin.userId,
          actor_role: 'ORGANIZER_ADMIN',
          operator_id: ops.a,
        },
      ]);
    });

    it('INTERNAL : versements à l’organisateur ; aucune condition n’est portée par le commerçant', async () => {
      const event = await newEvent();
      const res = await post(organizerAdmin, `${A()}/events/${event.event_id}/participations`, {
        merchant_id: ids.m2,
        link_type: 'INTERNAL',
        pitch_fee_mode: 'DEDUCT_CAPPED',
        pitch_fee: 75000,
      });
      expect(res.body).toMatchObject({
        link_type: 'INTERNAL',
        payout_to: ids.a1,
        pitch_fee_mode: 'DEDUCT_CAPPED',
        pitch_fee: 75000,
      });
      expect(Object.keys((await get(adminA, `${A()}/merchants/${ids.m2}`)).body).sort()).toEqual([
        'country_code',
        'created_at',
        'legal_name',
        'merchant_id',
        'operator_id',
        'tax_id',
      ]);
    });

    it('commerçant déjà inscrit : 409 ; commerçant inconnu ou d’un autre prestataire : 422 ; corps invalide : 400', async () => {
      const event = await newEvent();
      await join(event.event_id, ids.m1);
      const again = await post(organizerAdmin, `${A()}/events/${event.event_id}/participations`, {
        merchant_id: ids.m1,
        link_type: 'INTERNAL',
      });
      expect([again.status, problem(again).code]).toEqual([409, 'CONFLICT_STATE']);
      const path = `${A()}/events/${event.event_id}/participations`;
      expect(
        (await post(organizerAdmin, path, { merchant_id: ids.mB, link_type: 'EXTERNAL' })).status,
      ).toBe(422);
      expect(
        (await post(organizerAdmin, path, { merchant_id: ids.a2, link_type: 'EXTERNAL' })).status,
      ).toBe(422);
      expect((await post(organizerAdmin, path, { merchant_id: ids.m2 })).status).toBe(400);
      expect(
        (
          await post(organizerAdmin, path, {
            merchant_id: ids.m2,
            link_type: 'EXTERNAL',
            pitch_fee: -1,
          })
        ).status,
      ).toBe(400);
      expect(
        await rows('SELECT count(*)::int AS n FROM merchant_participation WHERE event_id = $1', [
          event.event_id,
        ]),
      ).toEqual([{ n: 1 }]);
    });

    it('droit de place payé d’avance : référence du paiement obligatoire', async () => {
      const event = await newEvent();
      const path = `${A()}/events/${event.event_id}/participations`;
      const missing = await post(organizerAdmin, path, {
        merchant_id: ids.m3,
        link_type: 'EXTERNAL',
        pitch_fee_mode: 'PREPAID',
        pitch_fee: 50000,
      });
      expect(missing.status).toBe(422);
      expect(problem(missing).detail).toContain('pitch_fee_reference');
      const ok = await post(organizerAdmin, path, {
        merchant_id: ids.m3,
        link_type: 'EXTERNAL',
        pitch_fee_mode: 'PREPAID',
        pitch_fee: 50000,
        pitch_fee_reference: 'VIR-2026-001',
      });
      expect(ok.body).toMatchObject({
        pitch_fee_mode: 'PREPAID',
        pitch_fee: 50000,
        pitch_fee_reference: 'VIR-2026-001',
      });
    });

    it('réservée à l’ORGANIZER_ADMIN de l’organisateur de l’événement', async () => {
      const event = await newEvent();
      const path = `${A()}/events/${event.event_id}/participations`;
      const body = { merchant_id: ids.m1, link_type: 'EXTERNAL' };
      expect((await post(otherOrganizerAdmin, path, body)).status).toBe(403);
      expect((await post(adminA, path, body)).status).toBe(403);
      expect((await post(merchantAdmin, path, body)).status).toBe(403);
      expect(
        (await post(organizerAdmin, `${A()}/events/${randomUUID()}/participations`, body)).status,
      ).toBe(404);
    });

    it('rejeu idempotent : une participation, un compte', async () => {
      const event = await newEvent();
      const key = randomUUID();
      const body = { merchant_id: ids.m1, link_type: 'EXTERNAL' };
      const first = await post(
        organizerAdmin,
        `${A()}/events/${event.event_id}/participations`,
        body,
        key,
      );
      const replay = await post(
        organizerAdmin,
        `${A()}/events/${event.event_id}/participations`,
        body,
        key,
      );
      expect([first.status, replay.status, replay.headers['idempotency-replayed']]).toEqual([
        201,
        201,
        'true',
      ]);
      expect(replay.body).toEqual(first.body);
      expect(
        await rows(
          `SELECT count(*)::int AS n FROM account WHERE ledger_id = $1 AND purpose = 'MERCHANT'`,
          [event.ledger_id],
        ),
      ).toEqual([{ n: 1 }]);
    });

    it.each([
      [
        'après l’insertion et l’ouverture du compte (relecture)',
        () => jest.spyOn(app.get(ParticipationsService), 'row'),
      ],
      ['à la dernière étape (ligne d’audit)', () => jest.spyOn(app.get(AuditService), 'record')],
    ])(
      'atomicité (NFR-004), panne %s : ni participation, ni compte commerçant',
      async (_step, inject) => {
        const event = await newEvent();
        const spy = inject().mockRejectedValueOnce(new Error('panne injectée'));
        const res = await post(organizerAdmin, `${A()}/events/${event.event_id}/participations`, {
          merchant_id: ids.m1,
          link_type: 'EXTERNAL',
        });
        spy.mockRestore();
        expect(res.status).toBe(500);
        expect(
          await rows('SELECT count(*)::int AS n FROM merchant_participation WHERE event_id = $1', [
            event.event_id,
          ]),
        ).toEqual([{ n: 0 }]);
        expect(
          await rows(
            `SELECT count(*)::int AS n FROM account WHERE ledger_id = $1 AND purpose = 'MERCHANT'`,
            [event.ledger_id],
          ),
        ).toEqual([{ n: 0 }]);
        // La même inscription réussit ensuite : rien n'est resté de la tentative.
        expect(
          (
            await post(organizerAdmin, `${A()}/events/${event.event_id}/participations`, {
              merchant_id: ids.m1,
              link_type: 'EXTERNAL',
            })
          ).status,
        ).toBe(201);
      },
    );
  });

  describe('lecture et modification', () => {
    it('lecture : comme l’événement ; le MERCHANT_ADMIN ne voit que la participation de son commerçant', async () => {
      const event = await newEvent();
      const mine = await join(event.event_id, ids.m1);
      const other = await join(event.event_id, ids.m2);
      const all = await get(organizerAdmin, `${A()}/events/${event.event_id}/participations`);
      expect(
        all.body.data.map((p: { participation_id: string }) => p.participation_id).sort(),
      ).toEqual([mine.participation_id, other.participation_id].sort());
      expect(
        (await get(merchantAdmin, `${A()}/events/${event.event_id}/participations`)).body.data.map(
          (p: { participation_id: string }) => p.participation_id,
        ),
      ).toEqual([mine.participation_id]);
      expect(
        (await get(merchantAdmin, `${A()}/participations/${mine.participation_id}`)).status,
      ).toBe(200);
      expect(
        (await get(merchantAdmin, `${A()}/participations/${other.participation_id}`)).status,
      ).toBe(403);
      expect(
        (await get(otherOrganizerAdmin, `${A()}/participations/${mine.participation_id}`)).status,
      ).toBe(403);
      expect(
        (await get(otherOrganizerAdmin, `${A()}/events/${event.event_id}/participations`)).status,
      ).toBe(403);
      expect(
        (await get(adminA, `${A()}/participations/${mine.participation_id}`)).body,
      ).toMatchObject({ participation_id: mine.participation_id, account_id: mine.account_id });
      expect((await get(adminA, `${A()}/participations/${randomUUID()}`)).status).toBe(404);
    });

    it('DRAFT : droit de place modifié immédiatement, audit avant / après ; événement, commerçant et type immuables', async () => {
      const event = await newEvent();
      const participation = await join(event.event_id, ids.m1);
      const path = `${A()}/participations/${participation.participation_id}`;
      const updated = await patch(organizerAdmin, path, {
        pitch_fee: 40000,
        pitch_fee_mode: 'DEDUCT_CAPPED',
      });
      expect(updated.status).toBe(200);
      expect(updated.body).toMatchObject({
        pitch_fee: 40000,
        pitch_fee_mode: 'DEDUCT_CAPPED',
        link_type: 'EXTERNAL',
        merchant_id: ids.m1,
      });
      expect(
        await rows(
          `SELECT before->>'pitch_fee' AS before, after->>'pitch_fee' AS after FROM audit_log WHERE object_id = $1 AND action = 'PARTICIPATION_UPDATED'`,
          [participation.participation_id],
        ),
      ).toEqual([{ before: '0', after: '40000' }]);
      expect((await patch(organizerAdmin, path, { pitch_fee_mode: 'PREPAID' })).status).toBe(422);
      expect((await patch(organizerAdmin, path, { link_type: 'INTERNAL' })).status).toBe(400);
      expect((await patch(organizerAdmin, path, {})).status).toBe(400);
      expect((await patch(otherOrganizerAdmin, path, { pitch_fee: 1 })).status).toBe(403);
    });

    it('LIVE : inscription et modification à deux personnes, appliquées à l’approbation', async () => {
      const event = await newEvent();
      const existing = await join(event.event_id, ids.m1);
      await setStatus(event.event_id, 'LIVE');

      const demand = await post(organizerAdmin, `${A()}/events/${event.event_id}/participations`, {
        merchant_id: ids.m2,
        link_type: 'INTERNAL',
      });
      expect(demand.status).toBe(202);
      expect(demand.body).toMatchObject({
        action: 'PARTICIPATION_CHANGE',
        status: 'PENDING',
        target_id: event.event_id,
      });
      expect(
        await rows('SELECT count(*)::int AS n FROM merchant_participation WHERE event_id = $1', [
          event.event_id,
        ]),
      ).toEqual([{ n: 1 }]);
      // Refus immédiats, avant toute demande.
      expect(
        (
          await post(organizerAdmin, `${A()}/events/${event.event_id}/participations`, {
            merchant_id: ids.m1,
            link_type: 'EXTERNAL',
          })
        ).status,
      ).toBe(409);

      const own = await post(
        organizerAdmin,
        `/v1/approval-requests/${demand.body.approval_request_id}/approve`,
      );
      expect([own.status, problem(own).code]).toEqual([409, 'APPROVAL_INVALID']);
      const approved = await post(
        organizerAdmin2,
        `/v1/approval-requests/${demand.body.approval_request_id}/approve`,
      );
      expect(approved.body).toMatchObject({
        status: 'EXECUTED',
        result: { merchant_id: ids.m2, link_type: 'INTERNAL', payout_to: ids.a1 },
      });
      expect(
        await rows(`SELECT count(*)::int AS n FROM account WHERE participation_id = $1`, [
          approved.body.result.participation_id,
        ]),
      ).toEqual([{ n: 1 }]);
      expect(
        await rows(
          `SELECT actor_id, approver_id FROM audit_log WHERE object_id = $1 AND action = 'PARTICIPATION_CREATED'`,
          [approved.body.result.participation_id],
        ),
      ).toEqual([{ actor_id: organizerAdmin.userId, approver_id: organizerAdmin2.userId }]);

      const change = await patch(
        organizerAdmin,
        `${A()}/participations/${existing.participation_id}`,
        { pitch_fee: 20000 },
      );
      expect(change.status).toBe(202);
      expect(
        (await get(organizerAdmin, `${A()}/participations/${existing.participation_id}`)).body
          .pitch_fee,
      ).toBe(0);
      const applied = await post(
        organizerAdmin2,
        `/v1/approval-requests/${change.body.approval_request_id}/approve`,
      );
      expect(applied.body).toMatchObject({
        status: 'EXECUTED',
        result: { participation_id: existing.participation_id, pitch_fee: 20000 },
      });
    });

    it('après LIVE et jusqu’à CLOSED : plus d’inscription ni de modification (409)', async () => {
      const event = await newEvent();
      const participation = await join(event.event_id, ids.m1);
      await setStatus(
        event.event_id,
        'LIVE',
        'CLOSING',
        'RECONCILING',
        'SETTLING',
        'REFUND_WINDOW',
        'CLOSED',
      );
      const refused = await post(organizerAdmin, `${A()}/events/${event.event_id}/participations`, {
        merchant_id: ids.m2,
        link_type: 'EXTERNAL',
      });
      expect([refused.status, problem(refused).code]).toEqual([409, 'CONFLICT_STATE']);
      expect(
        (
          await patch(organizerAdmin, `${A()}/participations/${participation.participation_id}`, {
            pitch_fee: 1,
          })
        ).status,
      ).toBe(409);
      expect(
        (
          await post(
            organizerAdmin,
            `${A()}/participations/${participation.participation_id}/points-of-sale`,
            { name: 'Trop tard' },
          )
        ).status,
      ).toBe(409);
    });
  });

  describe('points de vente', () => {
    it('création, liste, consultation, renommage, audit', async () => {
      const event = await newEvent();
      const participation = await join(event.event_id, ids.m1);
      const base = `${A()}/participations/${participation.participation_id}/points-of-sale`;
      const created = await post(organizerAdmin, base, { name: 'Stand 1' });
      expect(created.status).toBe(201);
      expect(created.headers.location).toBe(`${A()}/points-of-sale/${created.body.pos_id}`);
      expect(created.body).toMatchObject({
        operator_id: ops.a,
        participation_id: participation.participation_id,
        name: 'Stand 1',
      });
      await post(organizerAdmin, base, { name: 'Stand 2' });
      expect(
        (await get(organizerAdmin, base)).body.data.map((p: { name: string }) => p.name),
      ).toEqual(['Stand 1', 'Stand 2']);
      const renamed = await patch(organizerAdmin, `${A()}/points-of-sale/${created.body.pos_id}`, {
        name: 'Stand principal',
      });
      expect(renamed.body).toMatchObject({
        pos_id: created.body.pos_id,
        name: 'Stand principal',
        participation_id: participation.participation_id,
      });
      expect(
        (await get(merchantAdmin, `${A()}/points-of-sale/${created.body.pos_id}`)).body.name,
      ).toBe('Stand principal');
      expect(
        await rows(`SELECT action FROM audit_log WHERE object_id = $1 ORDER BY seq`, [
          created.body.pos_id,
        ]),
      ).toEqual([{ action: 'POINT_OF_SALE_CREATED' }, { action: 'POINT_OF_SALE_RENAMED' }]);
      expect((await post(organizerAdmin, base, { name: '  ' })).status).toBe(400);
      expect((await post(otherOrganizerAdmin, base, { name: 'Intrus' })).status).toBe(403);
      expect(
        (
          await patch(merchantAdmin, `${A()}/points-of-sale/${created.body.pos_id}`, {
            name: 'Intrus',
          })
        ).status,
      ).toBe(403);
      expect(
        (await get(otherOrganizerAdmin, `${A()}/points-of-sale/${created.body.pos_id}`)).status,
      ).toBe(403);
    });
  });

  describe('isolation à deux prestataires', () => {
    it('le personnel de B ne lit ni ne modifie aucune participation ni aucun point de vente de A', async () => {
      const event = await newEvent();
      const participation = await join(event.event_id, ids.m1);
      const pos = (
        await post(
          organizerAdmin,
          `${A()}/participations/${participation.participation_id}/points-of-sale`,
          { name: 'Stand' },
        )
      ).body.pos_id as string;
      for (const root of [A(), `/v1/operators/${ops.b}`]) {
        for (const path of [
          `/events/${event.event_id}/participations`,
          `/participations/${participation.participation_id}`,
          `/participations/${participation.participation_id}/points-of-sale`,
          `/points-of-sale/${pos}`,
        ]) {
          expect([root === A(), path, (await get(adminB, `${root}${path}`)).status]).toEqual([
            root === A(),
            path,
            404,
          ]);
        }
        expect(
          (
            await post(adminB, `${root}/events/${event.event_id}/participations`, {
              merchant_id: ids.mB,
              link_type: 'EXTERNAL',
            })
          ).status,
        ).not.toBe(201);
        expect(
          (
            await patch(adminB, `${root}/participations/${participation.participation_id}`, {
              pitch_fee: 1,
            })
          ).status,
        ).not.toBe(200);
        expect(
          (await patch(adminB, `${root}/points-of-sale/${pos}`, { name: 'Volé' })).status,
        ).not.toBe(200);
      }
      expect(await rows('SELECT name FROM point_of_sale WHERE id = $1', [pos])).toEqual([
        { name: 'Stand' },
      ]);
      expect(
        await rows('SELECT count(*)::int AS n FROM merchant_participation WHERE event_id = $1', [
          event.event_id,
        ]),
      ).toEqual([{ n: 1 }]);
    });
  });
});
