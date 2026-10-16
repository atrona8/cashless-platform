// Intégration : règles de frais d'événement (FR-008, FR-019, FR-020 ; US4 scénario 4, US6) — portées EVENT et
// PARTICIPATION réglées par l'ORGANIZER_ADMIN, commission portée par la participation, règle jamais modifiée mais
// remplacée, opération à deux pendant LIVE, remplacement d'une redevance de plateforme par un PLATFORM_ADMIN.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from '../../support/app';
import { withOwner } from '../../support/db';
import { FakeIdp, type TestPerson } from '../../support/fake-idp';
import { createOperators, type Operators } from '../transverse/fixtures';

describe('règles de frais d’événement', () => {
  let idp: FakeIdp;
  let app: INestApplication;
  let ops: Operators;
  let platformAdmin: TestPerson;
  let adminA: TestPerson;
  let adminB: TestPerson;
  let organizerAdmin: TestPerson;
  let organizerAdmin2: TestPerson;
  let otherOrganizerAdmin: TestPerson;
  const ids = {
    a1: randomUUID(),
    a2: randomUUID(),
    m1: randomUUID(),
    m2: randomUUID(),
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
           ($1, 'ORGANIZER', $5, 'Organisateur A1'), ($2, 'ORGANIZER', $5, 'Organisateur A2'), ($3, 'MERCHANT', $5, 'Bar'), ($4, 'MERCHANT', $5, 'Food truck')`,
        [ids.a1, ids.a2, ids.m1, ids.m2, ops.a],
      );
      // Profil de l'événement : ses taxes font foi pour les règles de l'événement.
      await db.query(
        `INSERT INTO jurisdiction_profile (id, country_code, version, valid_from, breakage_destination, rules)
         VALUES ($1, 'SN', (1000000 + floor(random() * 1000000000))::int, '2026-01-01', 'ORGANIZER', '{"taxes":{"TVA_EVT":{"rate_bps":1800,"inclusive":true}}}')`,
        [ids.profile],
      );
      const person = (
        operatorId: string | null,
        roles: Parameters<FakeIdp['createPerson']>[1]['roles'],
      ) => idp.createPerson(db, { operatorId, roles });
      platformAdmin = await person(null, [{ role: 'PLATFORM_ADMIN', scopeType: 'PLATFORM' }]);
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
    });
    app = await createTestApp({ identity: idp });
  });

  afterAll(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const post = (who: TestPerson, path: string, body: object = {}, key: string = randomUUID()) =>
    http()
      .post(path)
      .set('Authorization', `Bearer ${who.token}`)
      .set('Idempotency-Key', key)
      .send(body);
  const get = (who: TestPerson, path: string) =>
    http().get(path).set('Authorization', `Bearer ${who.token}`);
  const problem = (res: request.Response) =>
    JSON.parse(res.text) as { code?: string; detail?: string };
  const rows = <T>(sql: string, params: unknown[] = []) =>
    withOwner(async (db) => (await db.query(sql, params)).rows as T[]);
  const RULES = () => `/v1/operators/${ops.a}/fee-rules`;
  const newEvent = async () => {
    const res = await post(organizerAdmin, `/v1/operators/${ops.a}/events`, {
      organizer_id: ids.a1,
      name: `Festival ${randomUUID()}`,
      currency: 'XOF',
      timezone: 'Africa/Dakar',
      jurisdiction_id: ids.profile,
      funds_holder: 'ORGANIZER',
    });
    expect(res.status).toBe(201);
    return res.body.event_id as string;
  };
  const join = async (eventId: string, merchantId: string) => {
    const res = await post(
      organizerAdmin,
      `/v1/operators/${ops.a}/events/${eventId}/participations`,
      { merchant_id: merchantId, link_type: 'EXTERNAL' },
    );
    expect(res.status).toBe(201);
    return res.body.participation_id as string;
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
  /** Commission d'un commerçant : règle de la participation, MERCHANT → ORG_COM sur le montant des ventes. */
  const commission = (participationId: string, overrides: object = {}) => ({
    scope_type: 'PARTICIPATION',
    scope_id: participationId,
    payer_purpose: 'MERCHANT',
    beneficiary_purpose: 'ORG_COM',
    basis: 'SALE_AMOUNT',
    rate_bps: 1200,
    tax_code: 'TVA_EVT',
    trigger: 'REALTIME',
    ...overrides,
  });
  /** Frais festivalier de l'événement : frais d'activation. */
  const activationFee = (eventId: string, overrides: object = {}) => ({
    scope_type: 'EVENT',
    scope_id: eventId,
    payer_purpose: 'WALLET_PAID',
    beneficiary_purpose: 'ORG_FFEST',
    basis: 'PER_MEDIA',
    fixed_amount: 500,
    trigger: 'REALTIME',
    ...overrides,
  });

  it('commission : règle de la participation, créée par l’ORGANIZER_ADMIN, taxe du profil de l’événement', async () => {
    const eventId = await newEvent();
    const participationId = await join(eventId, ids.m1);
    const created = await post(organizerAdmin, RULES(), commission(participationId));
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      operator_id: ops.a,
      scope_type: 'PARTICIPATION',
      scope_id: participationId,
      payer_purpose: 'MERCHANT',
      beneficiary_purpose: 'ORG_COM',
      basis: 'SALE_AMOUNT',
      rate_bps: 1200,
      tax_code: 'TVA_EVT',
      valid_to: null,
      version: 1,
    });
    expect(
      await rows(`SELECT action, actor_role FROM audit_log WHERE object_id = $1`, [
        created.body.fee_rule_id,
      ]),
    ).toEqual([{ action: 'FEE_RULE_CREATED', actor_role: 'ORGANIZER_ADMIN' }]);
    // La taxe doit être celle du profil de l'événement, pas une autre.
    expect(
      (
        await post(
          organizerAdmin,
          RULES(),
          commission(await join(eventId, ids.m2), { tax_code: 'VAT' }),
        )
      ).status,
    ).toBe(422);
    // Les conditions restent sur la participation : la fiche du commerçant n'en porte aucune.
    expect(
      Object.keys((await get(adminA, `/v1/operators/${ops.a}/merchants/${ids.m1}`)).body),
    ).not.toContain('rate_bps');
  });

  it('frais d’événement ; qui règle quoi selon la portée', async () => {
    const eventId = await newEvent();
    const participationId = await join(eventId, ids.m1);
    expect((await post(organizerAdmin, RULES(), activationFee(eventId))).status).toBe(201);
    // Portées de l'événement : pas le prestataire, pas un autre organisateur.
    expect((await post(adminA, RULES(), commission(participationId))).status).toBe(403);
    expect((await post(otherOrganizerAdmin, RULES(), commission(participationId))).status).toBe(
      403,
    );
    expect(
      (await post(otherOrganizerAdmin, RULES(), activationFee(eventId, { basis: 'PER_REFUND' })))
        .status,
    ).toBe(403);
    expect((await post(organizerAdmin, RULES(), activationFee(randomUUID()))).status).toBe(422);
    expect((await post(organizerAdmin, RULES(), commission(eventId))).status).toBe(422);
    const mine = await get(organizerAdmin, `${RULES()}?scope_type=EVENT&scope_id=${eventId}`);
    expect(mine.body.data).toHaveLength(1);
    expect(
      (await get(otherOrganizerAdmin, `${RULES()}?scope_type=EVENT&scope_id=${eventId}`)).body.data,
    ).toEqual([]);
    expect(
      (await get(adminA, `${RULES()}?scope_type=EVENT&scope_id=${eventId}`)).body.data,
    ).toHaveLength(1);
  });

  it('une règle ne se modifie jamais : elle se remplace (ancienne fermée, version 2), et reste en base', async () => {
    const eventId = await newEvent();
    const participationId = await join(eventId, ids.m1);
    const first = (
      await post(
        organizerAdmin,
        RULES(),
        commission(participationId, { valid_from: '2026-01-01T00:00:00Z' }),
      )
    ).body;
    const replaced = await post(
      organizerAdmin,
      `${RULES()}/${first.fee_rule_id}/replacements`,
      commission(participationId, { rate_bps: 1500, valid_from: '2026-06-01T00:00:00Z' }),
    );
    expect(replaced.status).toBe(201);
    expect(replaced.body).toMatchObject({ rate_bps: 1500, version: 2, valid_to: null });
    expect(
      await rows(
        `SELECT version, rate_bps, valid_to IS NOT NULL AS closed FROM fee_rule WHERE scope_id = $1 ORDER BY version`,
        [participationId],
      ),
    ).toEqual([
      { version: 1, rate_bps: 1200, closed: true },
      { version: 2, rate_bps: 1500, closed: false },
    ]);
    expect(
      (
        await post(
          otherOrganizerAdmin,
          `${RULES()}/${replaced.body.fee_rule_id}/replacements`,
          commission(participationId, { rate_bps: 1 }),
        )
      ).status,
    ).toBe(403);
  });

  it('LIVE : création et remplacement à deux personnes ; la règle en vigueur ne change qu’à l’approbation', async () => {
    const eventId = await newEvent();
    const participationId = await join(eventId, ids.m1);
    const current = (await post(organizerAdmin, RULES(), commission(participationId))).body;
    await setStatus(eventId, 'LIVE');

    const demand = await post(
      organizerAdmin,
      `${RULES()}/${current.fee_rule_id}/replacements`,
      commission(participationId, { rate_bps: 1000 }),
    );
    expect(demand.status).toBe(202);
    expect(demand.body).toMatchObject({
      action: 'FEE_RULE_CHANGE',
      status: 'PENDING',
      target_id: eventId,
    });
    expect(
      await rows(
        `SELECT count(*)::int AS n, bool_and(valid_to IS NULL) AS open FROM fee_rule WHERE scope_id = $1`,
        [participationId],
      ),
    ).toEqual([{ n: 1, open: true }]);

    const own = await post(
      organizerAdmin,
      `/v1/approval-requests/${demand.body.approval_request_id}/approve`,
    );
    expect([own.status, problem(own).code]).toEqual([409, 'APPROVAL_INVALID']);
    expect(
      (await post(adminA, `/v1/approval-requests/${demand.body.approval_request_id}/approve`))
        .status,
    ).toBe(403);
    const approved = await post(
      organizerAdmin2,
      `/v1/approval-requests/${demand.body.approval_request_id}/approve`,
    );
    expect(approved.body).toMatchObject({
      status: 'EXECUTED',
      result: { rate_bps: 1000, version: 2, valid_to: null },
    });
    expect(
      await rows(
        `SELECT actor_id, approver_id FROM audit_log WHERE object_id = $1 AND action = 'FEE_RULE_REPLACED'`,
        [approved.body.result.fee_rule_id],
      ),
    ).toEqual([{ actor_id: organizerAdmin.userId, approver_id: organizerAdmin2.userId }]);

    const creation = await post(organizerAdmin, RULES(), activationFee(eventId));
    expect(creation.status).toBe(202);
    expect(
      (
        await post(
          organizerAdmin2,
          `/v1/approval-requests/${creation.body.approval_request_id}/approve`,
        )
      ).body,
    ).toMatchObject({ status: 'EXECUTED', result: { scope_type: 'EVENT', fixed_amount: 500 } });
    // Demande devenue caduque : la règle visée a déjà été remplacée.
    const stale = await post(
      organizerAdmin,
      `${RULES()}/${current.fee_rule_id}/replacements`,
      commission(participationId, { rate_bps: 900 }),
    );
    expect(stale.status).toBe(202);
    expect(
      (
        await post(
          organizerAdmin2,
          `/v1/approval-requests/${stale.body.approval_request_id}/approve`,
        )
      ).body,
    ).toMatchObject({ status: 'FAILED', failure_code: 'CONFLICT_STATE' });
  });

  it('après LIVE : plus de création ni de remplacement (409)', async () => {
    const eventId = await newEvent();
    const rule = (await post(organizerAdmin, RULES(), activationFee(eventId))).body;
    await setStatus(eventId, 'LIVE', 'CLOSING');
    expect(
      (await post(organizerAdmin, RULES(), activationFee(eventId, { basis: 'PER_REFUND' }))).status,
    ).toBe(409);
    expect(
      (
        await post(
          organizerAdmin,
          `${RULES()}/${rule.fee_rule_id}/replacements`,
          activationFee(eventId, { fixed_amount: 600 }),
        )
      ).status,
    ).toBe(409);
  });

  it('redevance de plateforme : remplacée par un PLATFORM_ADMIN seul, dans la chaîne d’audit de la plateforme', async () => {
    const [contract] = await rows<{ id: string }>(
      `INSERT INTO contract (operator_id, kind, counterparty_id, valid_from, platform_fee_mode)
       VALUES ($1, 'PLATFORM_OPERATOR', (SELECT id FROM party WHERE kind = 'PLATFORM' ORDER BY created_at, id LIMIT 1), '2026-01-01', 'IN_POOL') RETURNING id`,
      [ops.a],
    );
    const royalty = {
      scope_type: 'PLATFORM_CONTRACT',
      scope_id: contract!.id,
      payer_purpose: 'OPE_REDEV',
      beneficiary_purpose: 'PLT_REDEV',
      basis: 'FEE_AMOUNT',
      rate_bps: 1000,
      trigger: 'CLOSING',
      valid_from: '2026-01-01T00:00:00Z',
    };
    const created = await post(platformAdmin, `/v1/operators/${ops.a}/platform-fee-rules`, royalty);
    expect(created.status).toBe(201);
    // Le prestataire lit sa redevance mais ne la remplace pas.
    expect(
      (
        await post(adminA, `${RULES()}/${created.body.fee_rule_id}/replacements`, {
          ...royalty,
          rate_bps: 1,
        })
      ).status,
    ).toBe(403);
    const replaced = await post(
      platformAdmin,
      `${RULES()}/${created.body.fee_rule_id}/replacements`,
      { ...royalty, rate_bps: 800, valid_from: '2026-06-01T00:00:00Z' },
    );
    expect(replaced.status).toBe(201);
    expect(replaced.body).toMatchObject({
      operator_id: ops.a,
      scope_type: 'PLATFORM_CONTRACT',
      rate_bps: 800,
      version: 2,
    });
    expect(
      await rows(
        `SELECT operator_id, actor_role, chain_key = audit_platform_chain() AS platform_chain FROM audit_log WHERE object_id = $1`,
        [replaced.body.fee_rule_id],
      ),
    ).toEqual([{ operator_id: null, actor_role: 'PLATFORM_ADMIN', platform_chain: true }]);
    expect(
      await rows(
        `SELECT operator_id, scope FROM api_idempotency WHERE response_body->>'fee_rule_id' = $1`,
        [replaced.body.fee_rule_id],
      ),
    ).toEqual([{ operator_id: null, scope: 'plt:' }]);
    // Une règle d'un prestataire est invisible de la transaction de la plateforme : 404.
    const eventRule = (await post(organizerAdmin, RULES(), activationFee(await newEvent()))).body;
    expect(
      (
        await post(
          platformAdmin,
          `${RULES()}/${eventRule.fee_rule_id}/replacements`,
          activationFee(eventRule.scope_id),
        )
      ).status,
    ).toBe(404);
    // Et la redevance d'un prestataire ne se remplace pas par le chemin d'un autre.
    expect(
      (
        await post(
          platformAdmin,
          `/v1/operators/${ops.b}/fee-rules/${replaced.body.fee_rule_id}/replacements`,
          royalty,
        )
      ).status,
    ).toBe(404);
  });

  it('isolation : le personnel de B ne voit ni ne touche aucune règle de A', async () => {
    const eventId = await newEvent();
    const rule = (await post(organizerAdmin, RULES(), activationFee(eventId))).body;
    expect((await get(adminB, RULES())).status).toBe(404);
    expect(
      (await post(adminB, RULES(), activationFee(eventId, { basis: 'PER_REFUND' }))).status,
    ).toBe(404);
    expect(
      (await post(adminB, `${RULES()}/${rule.fee_rule_id}/replacements`, activationFee(eventId)))
        .status,
    ).toBe(404);
    const fromB = `/v1/operators/${ops.b}/fee-rules`;
    expect(
      (await get(adminB, `${fromB}?limit=200`)).body.data.map(
        (r: { fee_rule_id: string }) => r.fee_rule_id,
      ),
    ).not.toContain(rule.fee_rule_id);
    expect(
      (await post(adminB, `${fromB}/${rule.fee_rule_id}/replacements`, activationFee(eventId)))
        .status,
    ).toBe(404);
    // Depuis son propre prestataire, l'événement de A n'existe pas pour B : portée introuvable.
    expect(
      (await post(adminB, fromB, activationFee(eventId, { basis: 'PER_REFUND' }))).status,
    ).toBe(422);
    expect(await rows('SELECT valid_to FROM fee_rule WHERE id = $1', [rule.fee_rule_id])).toEqual([
      { valid_to: null },
    ]);
  });
});
