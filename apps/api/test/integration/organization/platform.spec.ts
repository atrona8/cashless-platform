// Intégration : routes de plateforme (FR-002, FR-003, FR-004, FR-007, FR-008, FR-019, FR-020 ; US1 de la spec) —
// profils de législation et valeurs provisoires, prestataires, contrat et redevances de plateforme, configuration
// de niveau plateforme, actions à deux de plateforme. Faux serveur d'identité, vraie base, vrai rôle plateforme.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from '../../support/app';
import { withOwner } from '../../support/db';
import { FakeIdp, type TestPerson } from '../../support/fake-idp';
import { createOperators, type Operators } from '../transverse/fixtures';

describe('routes de plateforme', () => {
  let idp: FakeIdp;
  let app: INestApplication;
  let ops: Operators;
  let admin1: TestPerson; // PLATFORM_ADMIN
  let admin2: TestPerson; // PLATFORM_ADMIN
  let operatorAdminA: TestPerson;
  let operatorAdminB: TestPerson;
  let organizerAdminA: TestPerson;
  let cashierA: TestPerson;
  const organizerA = randomUUID();
  const countries: string[] = [];

  beforeAll(async () => {
    idp = await FakeIdp.create();
    ops = await createOperators();
    await withOwner(async (db) => {
      await db.query(`INSERT INTO party (kind, legal_name) SELECT 'PLATFORM', 'Plateforme (test)' WHERE NOT EXISTS (SELECT 1 FROM party WHERE kind = 'PLATFORM')`);
      await db.query(`INSERT INTO party (id, kind, operator_id, legal_name, country_code) VALUES ($1, 'ORGANIZER', $2, 'Organisateur A', 'SN')`, [organizerA, ops.a]);
      const platformAdmin = () => idp.createPerson(db, { operatorId: null, roles: [{ role: 'PLATFORM_ADMIN', scopeType: 'PLATFORM' }] });
      admin1 = await platformAdmin();
      admin2 = await platformAdmin();
      const operatorAdmin = (operatorId: string) =>
        idp.createPerson(db, { operatorId, roles: [{ role: 'OPERATOR_ADMIN', scopeType: 'OPERATOR', scopeId: operatorId }] });
      operatorAdminA = await operatorAdmin(ops.a);
      operatorAdminB = await operatorAdmin(ops.b);
      organizerAdminA = await idp.createPerson(db, { operatorId: ops.a, roles: [{ role: 'ORGANIZER_ADMIN', scopeType: 'ORGANIZER', scopeId: organizerA }] });
      cashierA = await idp.createPerson(db, { operatorId: ops.a, roles: [{ role: 'CASHIER', scopeType: 'ORGANIZER', scopeId: organizerA }] });
      // Codes pays réservés à l'usage privé (ISO 3166 : XA à XZ, QM à QZ), sans profil existant : un par test.
      const used = new Set((await db.query<{ country_code: string }>('SELECT DISTINCT country_code FROM jurisdiction_profile')).rows.map((r) => r.country_code));
      for (const first of ['X', 'Q']) {
        for (const second of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
          const code = first + second;
          if ((first === 'X' || second >= 'M') && !used.has(code)) countries.push(code);
        }
      }
      countries.sort(() => Math.random() - 0.5);
    });
    app = await createTestApp({ identity: idp });
  });

  afterAll(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const send = (method: 'post' | 'patch', who: TestPerson | null, path: string, body: object = {}, key: string = randomUUID()) => {
    let req = http()[method](path).set('Idempotency-Key', key);
    if (who) req = req.set('Authorization', `Bearer ${who.token}`);
    return req.send(body);
  };
  const post = (who: TestPerson | null, path: string, body: object = {}, key?: string) => send('post', who, path, body, key);
  const patch = (who: TestPerson | null, path: string, body: object = {}, key?: string) => send('patch', who, path, body, key);
  const get = (who: TestPerson | null, path: string) => {
    const req = http().get(path);
    return who ? req.set('Authorization', `Bearer ${who.token}`) : req;
  };
  const problem = (res: request.Response) => JSON.parse(res.text) as { code?: string; detail?: string; violations?: Array<{ rule: string; field: string }> };
  const rows = <T>(sql: string, params: unknown[] = []) => withOwner(async (db) => (await db.query(sql, params)).rows as T[]);
  const country = () => countries.pop()!;
  const newOperator = async (name = `Prestataire ${randomUUID()}`) => {
    const res = await post(admin1, '/v1/operators', { legal_name: name, country_code: 'SN' });
    expect(res.status).toBe(201);
    return res.body.operator_id as string;
  };
  const newContract = async (operatorId: string) => {
    const res = await post(admin1, `/v1/operators/${operatorId}/platform-contracts`, { valid_from: '2026-01-01T00:00:00Z', platform_fee_mode: 'IN_POOL' });
    expect(res.status).toBe(201);
    return res.body.contract_id as string;
  };

  describe('profils de législation', () => {
    it('création : version 1, champs omis provisoires et signalés, champs saisis non provisoires', async () => {
      const code = country();
      const res = await post(admin1, '/v1/jurisdiction-profiles', {
        country_code: code,
        valid_from: '2026-01-01',
        min_refund_window_days: 90,
        unidentified_monthly_limit: 150000,
        rules: { taxes: { VAT: { rate_bps: 1800, inclusive: true } } },
      });
      expect(res.status).toBe(201);
      expect(res.headers.location).toBe(`/v1/jurisdiction-profiles/${res.body.profile_id}`);
      expect(res.body).toMatchObject({
        country_code: code,
        version: 1,
        valid_from: '2026-01-01',
        min_refund_window_days: 90,
        unidentified_monthly_limit: 150000,
        identified_monthly_limit: null,
        breakage_destination: 'ORGANIZER',
        late_claim_years: 5,
        rules: { taxes: { VAT: { rate_bps: 1800, inclusive: true } } },
        provisional_fields: [{ field: 'breakage_destination', confirm_by: 'juriste' }],
      });
      expect(res.body.rules.provisional).toBeUndefined();
      const audit = await rows(
        `SELECT operator_id, actor_id, actor_role, action, chain_key = audit_platform_chain() AS platform_chain FROM audit_log WHERE object_id = $1`,
        [res.body.profile_id],
      );
      expect(audit).toEqual([{ operator_id: null, actor_id: admin1.userId, actor_role: 'PLATFORM_ADMIN', action: 'JURISDICTION_PROFILE_CREATED', platform_chain: true }]);
    });

    it('Sénégal : défauts provisoires de §17.2, jamais présentés comme validés', async () => {
      const existing = await rows(`SELECT 1 FROM jurisdiction_profile WHERE country_code = 'SN' LIMIT 1`);
      const res = await post(admin1, '/v1/jurisdiction-profiles', { country_code: 'SN', valid_from: '2026-01-01' });
      if (existing.length > 0) {
        // Une autre suite a déjà posé un profil du Sénégal : la création est alors un conflit (cas couvert plus bas).
        expect([res.status, problem(res).code]).toEqual([409, 'CONFLICT_STATE']);
        return;
      }
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ unidentified_monthly_limit: 200000, identified_monthly_limit: 2000000, max_wallet_balance: null });
      expect(res.body.provisional_fields).toEqual(
        expect.arrayContaining([
          { field: 'unidentified_monthly_limit', confirm_by: 'juriste' },
          { field: 'identified_monthly_limit', confirm_by: 'juriste' },
          { field: 'rules.taxes', confirm_by: 'expert-comptable' },
        ]),
      );
    });

    it('second profil du même pays : 409 ; corps invalide : 400', async () => {
      const code = country();
      expect((await post(admin1, '/v1/jurisdiction-profiles', { country_code: code, valid_from: '2026-01-01' })).status).toBe(201);
      const again = await post(admin1, '/v1/jurisdiction-profiles', { country_code: code, valid_from: '2026-06-01' });
      expect([again.status, problem(again).code]).toEqual([409, 'CONFLICT_STATE']);
      expect((await post(admin1, '/v1/jurisdiction-profiles', { valid_from: '2026-01-01' })).status).toBe(400);
      expect((await post(admin1, '/v1/jurisdiction-profiles', { country_code: country(), valid_from: 'demain' })).status).toBe(400);
      expect((await post(admin1, '/v1/jurisdiction-profiles', { country_code: country(), valid_from: '2026-01-01', max_wallet_balance: 10.5 })).status).toBe(400);
    });

    it('nouvelle version sans changement de plafond : 201, version 2, la version 1 reste intacte', async () => {
      const code = country();
      const v1 = (await post(admin1, '/v1/jurisdiction-profiles', { country_code: code, valid_from: '2026-01-01', breakage_destination: 'ORGANIZER' })).body;
      const res = await post(admin1, `/v1/jurisdiction-profiles/${v1.profile_id}/versions`, {
        valid_from: '2026-07-01',
        breakage_destination: 'LEGAL_ACCOUNT',
        min_refund_window_days: 60,
      });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ country_code: code, version: 2, breakage_destination: 'LEGAL_ACCOUNT', min_refund_window_days: 60, provisional_fields: [] });
      expect((await get(admin1, `/v1/jurisdiction-profiles/${v1.profile_id}`)).body).toMatchObject({ version: 1, breakage_destination: 'ORGANIZER', min_refund_window_days: null });
      // La version 1 n'est plus la dernière : 409 ; date d'effet antérieure : 422.
      const stale = await post(admin1, `/v1/jurisdiction-profiles/${v1.profile_id}/versions`, { valid_from: '2026-08-01' });
      expect([stale.status, problem(stale).code]).toEqual([409, 'CONFLICT_STATE']);
      const early = await post(admin1, `/v1/jurisdiction-profiles/${res.body.profile_id}/versions`, { valid_from: '2026-03-01', breakage_destination: 'LEGAL_ACCOUNT' });
      expect(early.status).toBe(422);
    });

    it('nouvelle version qui change un plafond réglementaire : 202, exécutée par un second PLATFORM_ADMIN', async () => {
      const code = country();
      const v1 = (await post(admin1, '/v1/jurisdiction-profiles', { country_code: code, valid_from: '2026-01-01', breakage_destination: 'NONE', unidentified_monthly_limit: 200000 })).body;
      const res = await post(admin1, `/v1/jurisdiction-profiles/${v1.profile_id}/versions`, {
        valid_from: '2026-09-01',
        breakage_destination: 'NONE',
        unidentified_monthly_limit: 300000,
      });
      expect(res.status).toBe(202);
      expect(res.body).toMatchObject({ action: 'JURISDICTION_LIMITS_CHANGE', status: 'PENDING', target_id: v1.profile_id, requested_by: admin1.userId });
      expect(res.headers.location).toBe(`/v1/approval-requests/${res.body.approval_request_id}`);
      expect(await rows('SELECT version FROM jurisdiction_profile WHERE country_code = $1', [code])).toEqual([{ version: 1 }]);
      expect(await rows('SELECT operator_id FROM approval_request WHERE id = $1', [res.body.approval_request_id])).toEqual([{ operator_id: null }]);

      const own = await post(admin1, `/v1/approval-requests/${res.body.approval_request_id}/approve`);
      expect([own.status, problem(own).code]).toEqual([409, 'APPROVAL_INVALID']);
      const approved = await post(admin2, `/v1/approval-requests/${res.body.approval_request_id}/approve`);
      expect(approved.status).toBe(200);
      expect(approved.body).toMatchObject({ status: 'EXECUTED', result: { country_code: code, version: 2, unidentified_monthly_limit: 300000 } });
      const audit = await rows(`SELECT actor_id, approver_id FROM audit_log WHERE object_id = $1 AND action = 'JURISDICTION_PROFILE_CREATED'`, [approved.body.result.profile_id]);
      expect(audit).toEqual([{ actor_id: admin1.userId, approver_id: admin2.userId }]);
    });

    it('demande devenue caduque (une autre version publiée entre-temps) : FAILED, rien d’écrit', async () => {
      const code = country();
      const v1 = (await post(admin1, '/v1/jurisdiction-profiles', { country_code: code, valid_from: '2026-01-01', breakage_destination: 'NONE' })).body;
      const demand = await post(admin1, `/v1/jurisdiction-profiles/${v1.profile_id}/versions`, { valid_from: '2026-09-01', breakage_destination: 'NONE', kyc_threshold: 500000 });
      expect(demand.status).toBe(202);
      expect((await post(admin1, `/v1/jurisdiction-profiles/${v1.profile_id}/versions`, { valid_from: '2026-02-01', breakage_destination: 'ORGANIZER' })).status).toBe(201);
      const approved = await post(admin2, `/v1/approval-requests/${demand.body.approval_request_id}/approve`);
      expect(approved.status).toBe(200);
      expect(approved.body).toMatchObject({ status: 'FAILED', failure_code: 'CONFLICT_STATE' });
      expect(await rows('SELECT version FROM jurisdiction_profile WHERE country_code = $1 ORDER BY version', [code])).toEqual([{ version: 1 }, { version: 2 }]);
    });

    it('lecture ouverte au personnel d’un prestataire (OPERATOR_ADMIN, ORGANIZER_ADMIN), pas aux autres rôles', async () => {
      const code = country();
      const created = (await post(admin1, '/v1/jurisdiction-profiles', { country_code: code, valid_from: '2026-01-01' })).body;
      for (const who of [admin1, operatorAdminA, organizerAdminA]) {
        const list = await get(who, `/v1/jurisdiction-profiles?country_code=${code}`);
        expect(list.status).toBe(200);
        expect(list.body).toMatchObject({ has_more: false, next_cursor: null });
        expect(list.body.data.map((p: { profile_id: string }) => p.profile_id)).toEqual([created.profile_id]);
        expect((await get(who, `/v1/jurisdiction-profiles/${created.profile_id}`)).body.country_code).toBe(code);
      }
      expect((await get(cashierA, '/v1/jurisdiction-profiles')).status).toBe(403);
      expect((await get(admin1, `/v1/jurisdiction-profiles/${randomUUID()}`)).status).toBe(404);
      expect((await get(admin1, '/v1/jurisdiction-profiles?country_code=sn')).status).toBe(400);
    });

    it('liste paginée par curseur', async () => {
      const first = await get(admin1, '/v1/jurisdiction-profiles?limit=2');
      expect(first.status).toBe(200);
      expect(first.body.data).toHaveLength(2);
      expect(first.body.has_more).toBe(true);
      const second = await get(admin1, `/v1/jurisdiction-profiles?limit=2&cursor=${first.body.next_cursor}`);
      expect(second.status).toBe(200);
      const ids = [...first.body.data, ...second.body.data].map((p: { profile_id: string }) => p.profile_id);
      expect(new Set(ids).size).toBe(ids.length);
      expect((await get(admin1, '/v1/jurisdiction-profiles?cursor=pas-un-curseur')).status).toBe(400);
      const farAway = Buffer.from(JSON.stringify({ o: 100_001 })).toString('base64url');
      expect((await get(admin1, `/v1/jurisdiction-profiles?cursor=${farAway}`)).status).toBe(400);
      expect((await get(admin1, '/v1/jurisdiction-profiles?limit=0')).status).toBe(400);
    });
  });

  describe('prestataires', () => {
    it('US1 : la plateforme ouvre un prestataire, son contrat, et nomme son premier administrateur', async () => {
      const created = await post(admin1, '/v1/operators', { legal_name: 'Cashless Dakar SARL', country_code: 'SN', tax_id: 'SN-123', operator_id: ops.a });
      expect(created.status).toBe(201);
      const operatorId = created.body.operator_id as string;
      expect(operatorId).not.toBe(ops.a);
      expect(created.headers.location).toBe(`/v1/operators/${operatorId}`);
      expect(created.body).toMatchObject({ legal_name: 'Cashless Dakar SARL', country_code: 'SN', tax_id: 'SN-123' });
      expect(await rows('SELECT kind, operator_id FROM party WHERE id = $1', [operatorId])).toEqual([{ kind: 'OPERATOR', operator_id: null }]);

      const contract = await post(admin1, `/v1/operators/${operatorId}/platform-contracts`, { valid_from: '2026-01-01T00:00:00Z', platform_fee_mode: 'IN_POOL' });
      expect(contract.status).toBe(201);
      expect(contract.body).toMatchObject({ operator_id: operatorId, kind: 'PLATFORM_OPERATOR', version: 1, platform_fee_mode: 'IN_POOL', offline_loss_bearer: null });

      // Premier administrateur du prestataire : routes « Personnes » de la mission 2, par le PLATFORM_ADMIN.
      const user = await post(admin1, `/v1/operators/${operatorId}/users`, {
        issuer: idp.config.issuer,
        subject: `premier-${randomUUID()}`,
        display_name: 'Premier administrateur',
        email: 'admin@cashless-dakar.test',
      });
      expect(user.status).toBe(201);
      const grant = await post(admin1, `/v1/operators/${operatorId}/users/${user.body.user_id}/role-assignments`, {
        role: 'OPERATOR_ADMIN',
        scope_type: 'OPERATOR',
        scope_id: operatorId,
      });
      expect(grant.status).toBe(201);

      const audit = await rows<{ action: string; operator_id: string | null }>(
        `SELECT action, operator_id FROM audit_log WHERE object_id = ANY($1::text[]) ORDER BY seq`,
        [[operatorId, contract.body.contract_id]],
      );
      expect(audit).toEqual([{ action: 'OPERATOR_CREATED', operator_id: null }, { action: 'CONTRACT_CREATED', operator_id: null }]);
    });

    it('écriture rejouée : même réponse, un seul prestataire ; même clé, autre corps : 409', async () => {
      const key = randomUUID();
      const body = { legal_name: `Rejoué ${randomUUID()}`, country_code: 'CI' };
      const first = await post(admin1, '/v1/operators', body, key);
      const replay = await post(admin1, '/v1/operators', body, key);
      expect([first.status, replay.status]).toEqual([201, 201]);
      expect(replay.headers['idempotency-replayed']).toBe('true');
      expect(replay.body).toEqual(first.body);
      expect(await rows('SELECT count(*)::int AS n FROM party WHERE legal_name = $1', [body.legal_name])).toEqual([{ n: 1 }]);
      const reused = await post(admin1, '/v1/operators', { ...body, legal_name: 'Autre' }, key);
      expect([reused.status, problem(reused).code]).toEqual([409, 'IDEMPOTENCY_KEY_REUSED']);
      expect(await rows('SELECT operator_id, scope FROM api_idempotency WHERE idempotency_key = $1', [key])).toEqual([{ operator_id: null, scope: 'plt:' }]);
    });

    it('lecture et modification des données descriptives, avec audit avant / après', async () => {
      const operatorId = await newOperator('Avant');
      const updated = await patch(admin1, `/v1/operators/${operatorId}`, { legal_name: 'Après', tax_id: null });
      expect(updated.status).toBe(200);
      expect(updated.body).toMatchObject({ operator_id: operatorId, legal_name: 'Après', country_code: 'SN', tax_id: null });
      expect((await get(admin1, `/v1/operators/${operatorId}`)).body.legal_name).toBe('Après');
      const audit = await rows(`SELECT before->>'legal_name' AS before, after->>'legal_name' AS after FROM audit_log WHERE object_id = $1 AND action = 'OPERATOR_UPDATED'`, [operatorId]);
      expect(audit).toEqual([{ before: 'Avant', after: 'Après' }]);
      expect((await patch(admin1, `/v1/operators/${operatorId}`, {})).status).toBe(400);
      expect((await patch(admin1, `/v1/operators/${operatorId}`, { kind: 'ORGANIZER' })).status).toBe(400);
      expect((await patch(admin1, `/v1/operators/${randomUUID()}`, { legal_name: 'X' })).status).toBe(404);
      const list = await get(admin1, '/v1/operators?limit=200');
      expect(list.body.data.map((o: { operator_id: string }) => o.operator_id)).toEqual(expect.arrayContaining([operatorId, ops.a, ops.b]));
    });

    it('un OPERATOR_ADMIN lit sa fiche, jamais celle d’un autre', async () => {
      expect((await get(operatorAdminA, `/v1/operators/${ops.a}`)).body).toMatchObject({ operator_id: ops.a });
      expect((await get(operatorAdminA, `/v1/operators/${ops.b}`)).status).toBe(404);
      expect((await get(operatorAdminB, `/v1/operators/${ops.a}`)).status).toBe(404);
      expect((await get(organizerAdminA, `/v1/operators/${ops.a}`)).status).toBe(403);
    });
  });

  describe('contrat plateforme–prestataire', () => {
    it('version 1 unique ; nouvelle version à deux personnes, numérotée par la base, la version 1 intacte', async () => {
      const operatorId = await newOperator();
      const contractId = await newContract(operatorId);
      const second = await post(admin1, `/v1/operators/${operatorId}/platform-contracts`, { valid_from: '2026-02-01T00:00:00Z', platform_fee_mode: 'INVOICED' });
      expect([second.status, problem(second).code]).toEqual([409, 'CONFLICT_STATE']);
      expect((await post(admin1, `/v1/operators/${operatorId}/platform-contracts`, { valid_from: '2026-02-01T00:00:00Z' })).status).toBe(400);

      const demand = await post(admin1, `/v1/operators/${operatorId}/platform-contracts/${contractId}/versions`, { valid_from: '2026-06-01T00:00:00Z', platform_fee_mode: 'INVOICED' });
      expect(demand.status).toBe(202);
      expect(demand.body).toMatchObject({ action: 'PLATFORM_CONTRACT_VERSION', status: 'PENDING', target_id: contractId });
      expect(await rows(`SELECT count(*)::int AS n FROM contract WHERE operator_id = $1`, [operatorId])).toEqual([{ n: 1 }]);
      const approved = await post(admin2, `/v1/approval-requests/${demand.body.approval_request_id}/approve`, { note: 'Conforme' });
      expect(approved.status).toBe(200);
      expect(approved.body).toMatchObject({ status: 'EXECUTED', result: { operator_id: operatorId, version: 2, platform_fee_mode: 'INVOICED' } });

      const list = await get(admin1, `/v1/operators/${operatorId}/platform-contracts`);
      expect(list.body.data.map((c: { version: number; platform_fee_mode: string }) => [c.version, c.platform_fee_mode])).toEqual([[2, 'INVOICED'], [1, 'IN_POOL']]);
      // L'ancienne version n'est plus la référence : 409 immédiat.
      const stale = await post(admin1, `/v1/operators/${operatorId}/platform-contracts/${contractId}/versions`, { valid_from: '2026-07-01T00:00:00Z' });
      expect([stale.status, problem(stale).code]).toEqual([409, 'CONFLICT_STATE']);
    });

    it('nouvelle version : champs d’un autre type de contrat refusés ; date d’effet antérieure : demande FAILED', async () => {
      const operatorId = await newOperator();
      const contractId = await newContract(operatorId);
      const wrong = await post(admin1, `/v1/operators/${operatorId}/platform-contracts/${contractId}/versions`, { valid_from: '2026-06-01T00:00:00Z', breakage_organizer_bps: 5000 });
      expect(wrong.status).toBe(422);
      const early = await post(admin1, `/v1/operators/${operatorId}/platform-contracts/${contractId}/versions`, { valid_from: '2025-06-01T00:00:00Z' });
      expect(early.status).toBe(202);
      const approved = await post(admin2, `/v1/approval-requests/${early.body.approval_request_id}/approve`);
      expect(approved.body).toMatchObject({ status: 'FAILED', failure_code: 'VALIDATION_FAILED' });
      expect(await rows(`SELECT count(*)::int AS n FROM contract WHERE operator_id = $1`, [operatorId])).toEqual([{ n: 1 }]);
    });

    it('le prestataire lit son contrat avec la plateforme, pas celui d’un autre', async () => {
      await withOwner((db) =>
        db.query(
          `INSERT INTO contract (operator_id, kind, counterparty_id, valid_from, platform_fee_mode)
           SELECT $1, 'PLATFORM_OPERATOR', (SELECT id FROM party WHERE kind = 'PLATFORM' ORDER BY created_at, id LIMIT 1), '2026-01-01', 'IN_POOL'
            WHERE NOT EXISTS (SELECT 1 FROM contract WHERE operator_id = $1 AND kind = 'PLATFORM_OPERATOR')`,
          [ops.a],
        ),
      );
      const own = await get(operatorAdminA, `/v1/operators/${ops.a}/platform-contracts`);
      expect(own.status).toBe(200);
      expect(own.body.data).toHaveLength(1);
      expect((await get(operatorAdminB, `/v1/operators/${ops.a}/platform-contracts`)).status).toBe(404);
      expect((await get(organizerAdminA, `/v1/operators/${ops.a}/platform-contracts`)).status).toBe(403);
    });
  });

  describe('redevances de plateforme', () => {
    const rule = (contractId: string, overrides: object = {}) => ({
      scope_type: 'PLATFORM_CONTRACT',
      scope_id: contractId,
      payer_purpose: 'OPE_REDEV',
      beneficiary_purpose: 'PLT_REDEV',
      basis: 'FEE_AMOUNT',
      rate_bps: 1000,
      trigger: 'CLOSING',
      ...overrides,
    });

    it('création sur le contrat du prestataire, liste, doublon en vigueur refusé', async () => {
      const operatorId = await newOperator();
      const contractId = await newContract(operatorId);
      const created = await post(admin1, `/v1/operators/${operatorId}/platform-fee-rules`, rule(contractId, { min_amount: 100, max_amount: 5000 }));
      expect(created.status).toBe(201);
      expect(created.body).toMatchObject({
        operator_id: operatorId, scope_type: 'PLATFORM_CONTRACT', scope_id: contractId, rate_bps: 1000, fixed_amount: 0,
        min_amount: 100, max_amount: 5000, tax_code: null, tax_inclusive: true, valid_to: null, version: 1,
      });
      const duplicate = await post(admin1, `/v1/operators/${operatorId}/platform-fee-rules`, rule(contractId, { rate_bps: 900 }));
      expect([duplicate.status, problem(duplicate).code]).toEqual([409, 'CONFLICT_STATE']);
      const list = await get(admin1, `/v1/operators/${operatorId}/platform-fee-rules`);
      expect(list.body.data.map((r: { fee_rule_id: string }) => r.fee_rule_id)).toEqual([created.body.fee_rule_id]);
      expect(await rows(`SELECT action, operator_id FROM audit_log WHERE object_id = $1`, [created.body.fee_rule_id])).toEqual([{ action: 'FEE_RULE_CREATED', operator_id: null }]);
    });

    it('portée, comptes, contrat ou taxe incohérents : 422 ; corps mal formé : 400', async () => {
      const operatorId = await newOperator();
      const contractId = await newContract(operatorId);
      const otherContract = await newContract(await newOperator());
      const path = `/v1/operators/${operatorId}/platform-fee-rules`;
      expect((await post(admin1, path, rule(contractId, { scope_type: 'EVENT' }))).status).toBe(422);
      expect((await post(admin1, path, rule(contractId, { beneficiary_purpose: 'OPE_FRAIS' }))).status).toBe(422);
      expect((await post(admin1, path, rule(otherContract))).status).toBe(422);
      expect((await post(admin1, path, rule(contractId, { tax_code: 'TAXE_INCONNUE' }))).status).toBe(422);
      expect((await post(admin1, path, rule(contractId, { min_amount: 500, max_amount: 100 }))).status).toBe(422);
      expect((await post(admin1, path, rule(contractId, { rate_bps: 10001 }))).status).toBe(400);
      expect((await post(admin1, path, rule(contractId, { fixed_amount: 1.5 }))).status).toBe(400);
      expect((await post(admin1, path, { ...rule(contractId), scope_id: 'x' })).status).toBe(400);
      expect(await rows('SELECT count(*)::int AS n FROM fee_rule WHERE operator_id = $1', [operatorId])).toEqual([{ n: 0 }]);
    });
  });

  describe('configuration de niveau plateforme', () => {
    it('chaque écriture crée la version suivante ; hors bornes : 422 avec la règle citée, en français ou en anglais', async () => {
      // Le niveau plateforme est unique : d'autres suites y écrivent en parallèle. Une écriture concurrente répond
      // 409 (à refaire) et les numéros de cette suite ne sont pas forcément consécutifs.
      const write = async (settings: object) => {
        for (let attempt = 0; attempt < 10; attempt += 1) {
          const res = await post(admin1, '/v1/platform/config-versions', { settings });
          if (res.status !== 409) return res;
          expect(problem(res).code).toBe('CONFLICT_STATE');
        }
        throw new Error('niveau plateforme : dix conflits de suite');
      };
      const first = await write({ spend_order: 'PAID_FIRST' });
      expect(first.status).toBe(201);
      expect(first.body).toMatchObject({ operator_id: null, scope_type: 'PLATFORM', settings: { spend_order: 'PAID_FIRST' } });
      const second = await write({ spend_order: 'PROMO_FIRST' });
      expect(second.status).toBe(201);
      expect(second.body.version).toBeGreaterThan(first.body.version);
      const list = await get(admin1, '/v1/platform/config-versions?limit=200');
      const versions = list.body.data.map((v: { version: number }) => v.version) as number[];
      expect(versions).toEqual([...versions].sort((x, y) => y - x));
      expect(versions).toEqual(expect.arrayContaining([second.body.version, first.body.version]));
      expect(await rows(`SELECT action, operator_id FROM audit_log WHERE object_id = $1`, [second.body.config_version_id])).toEqual([{ action: 'CONFIG_VERSION_CREATED', operator_id: null }]);

      const refused = await post(admin1, '/v1/platform/config-versions', { settings: { spend_order: 'ALEATOIRE', psp_fee_bearer: 'CUSTOMER' } });
      expect(refused.status).toBe(422);
      expect(problem(refused).code).toBe('VALIDATION_FAILED');
      expect(problem(refused).detail).toContain('spend_order');
      expect(problem(refused).violations?.map((v) => `${v.field}:${v.rule}`)).toEqual(['spend_order:catalog.enum', 'psp_fee_bearer:catalog.level']);
      const english = await http().post('/v1/platform/config-versions').set('Authorization', `Bearer ${admin1.token}`).set('Idempotency-Key', randomUUID())
        .set('Accept-Language', 'en').send({ settings: { spend_order: 'ALEATOIRE' } });
      expect(problem(english).detail).toContain('allowed values');
      expect((await post(admin1, '/v1/platform/config-versions', { settings: 'x' })).status).toBe(400);
    });
  });

  describe('réservé à PLATFORM_ADMIN', () => {
    it('chaque écriture et chaque lecture de plateforme : 403 pour un OPERATOR_ADMIN, 401 sans jeton', async () => {
      const operatorId = await newOperator();
      const contractId = await newContract(operatorId);
      const profileId = (await post(admin1, '/v1/jurisdiction-profiles', { country_code: country(), valid_from: '2026-01-01' })).body.profile_id as string;
      const writes: Array<['post' | 'patch', string, object]> = [
        ['post', '/v1/jurisdiction-profiles', { country_code: country(), valid_from: '2026-01-01' }],
        ['post', `/v1/jurisdiction-profiles/${profileId}/versions`, { valid_from: '2026-06-01' }],
        ['post', '/v1/operators', { legal_name: 'Intrus', country_code: 'SN' }],
        ['patch', `/v1/operators/${ops.a}`, { legal_name: 'Intrus' }],
        ['post', `/v1/operators/${ops.a}/platform-contracts`, { valid_from: '2026-01-01T00:00:00Z', platform_fee_mode: 'INVOICED' }],
        ['post', `/v1/operators/${operatorId}/platform-contracts/${contractId}/versions`, { valid_from: '2026-06-01T00:00:00Z' }],
        ['post', '/v1/platform/config-versions', { settings: { spend_order: 'PAID_FIRST' } }],
        ['post', `/v1/operators/${ops.a}/platform-fee-rules`, { scope_type: 'PLATFORM_CONTRACT', scope_id: contractId, payer_purpose: 'OPE_REDEV', beneficiary_purpose: 'PLT_REDEV', basis: 'FEE_AMOUNT', trigger: 'CLOSING' }],
      ];
      for (const [method, path, body] of writes) {
        expect([path, (await send(method, operatorAdminA, path, body)).status]).toEqual([path, 403]);
        expect([path, (await send(method, null, path, body)).status]).toEqual([path, 401]);
      }
      for (const path of ['/v1/operators', '/v1/platform/config-versions']) {
        expect([path, (await get(operatorAdminA, path)).status]).toEqual([path, 403]);
        expect([path, (await get(null, path)).status]).toEqual([path, 401]);
      }
      // Rien n'a été écrit par ces tentatives.
      expect(await rows(`SELECT legal_name FROM party WHERE id = $1`, [ops.a])).toEqual([{ legal_name: 'Prestataire A (test)' }]);
      expect(await rows(`SELECT count(*)::int AS n FROM party WHERE legal_name = 'Intrus'`)).toEqual([{ n: 0 }]);
    });
  });
});
