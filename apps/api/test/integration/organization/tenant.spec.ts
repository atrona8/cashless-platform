// Intégration : organisation d'un prestataire (FR-005 à FR-008, FR-014, FR-019, FR-020, NFR-001 ; US2 de la spec) —
// configuration des niveaux prestataire et organisateur, organisateurs, commerçants, contrats prestataire–organisateur
// (nouvelle version à deux), règles de frais du flux prestataire → organisateur. Isolation à deux prestataires.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from '../../support/app';
import { withOwner } from '../../support/db';
import { FakeIdp, type TestPerson } from '../../support/fake-idp';
import { createOperators, type Operators } from '../transverse/fixtures';

describe('organisation d’un prestataire', () => {
  let idp: FakeIdp;
  let app: INestApplication;
  let ops: Operators;
  let platformAdmin: TestPerson;
  let adminA: TestPerson; // OPERATOR_ADMIN de A
  let adminA2: TestPerson; // second OPERATOR_ADMIN de A
  let adminB: TestPerson; // OPERATOR_ADMIN de B
  let organizerAdmin: TestPerson; // ORGANIZER_ADMIN de l'organisateur a1
  let otherOrganizerAdmin: TestPerson; // ORGANIZER_ADMIN de l'organisateur a2
  let merchantAdmin: TestPerson; // MERCHANT_ADMIN du commerçant m1
  let cashier: TestPerson;
  const ids = { a1: randomUUID(), a2: randomUUID(), b1: randomUUID(), m1: randomUUID(), m2: randomUUID() };

  beforeAll(async () => {
    idp = await FakeIdp.create();
    ops = await createOperators();
    await withOwner(async (db) => {
      await db.query(
        `INSERT INTO party (id, kind, operator_id, legal_name, country_code) VALUES
           ($1, 'ORGANIZER', $6, 'Organisateur A1', 'SN'), ($2, 'ORGANIZER', $6, 'Organisateur A2', 'SN'),
           ($3, 'ORGANIZER', $7, 'Organisateur B1', 'CI'), ($4, 'MERCHANT', $6, 'Commerçant M1', 'SN'), ($5, 'MERCHANT', $6, 'Commerçant M2', 'SN')`,
        [ids.a1, ids.a2, ids.b1, ids.m1, ids.m2, ops.a, ops.b],
      );
      // Le contrôle de tax_code lit le dernier profil du pays du prestataire. D'autres suites publient des profils
      // « SN » en parallèle : le prestataire A reçoit un pays réservé à cette suite (ZZ, usage privé ISO 3166), dont
      // le profil porte la taxe VAT.
      await db.query(`UPDATE party SET country_code = 'ZZ' WHERE id = $1`, [ops.a]);
      await db.query(
        `INSERT INTO jurisdiction_profile (country_code, version, valid_from, breakage_destination, rules)
         VALUES ('ZZ', (1000000 + floor(random() * 1000000000))::int, '2026-01-01', 'ORGANIZER',
                 '{"taxes":{"VAT":{"rate_bps":1800,"inclusive":true}}}')`,
      );
      const person = (operatorId: string | null, role: Parameters<FakeIdp['createPerson']>[1]['roles']) => idp.createPerson(db, { operatorId, roles: role });
      platformAdmin = await person(null, [{ role: 'PLATFORM_ADMIN', scopeType: 'PLATFORM' }]);
      adminA = await person(ops.a, [{ role: 'OPERATOR_ADMIN', scopeType: 'OPERATOR', scopeId: ops.a }]);
      adminA2 = await person(ops.a, [{ role: 'OPERATOR_ADMIN', scopeType: 'OPERATOR', scopeId: ops.a }]);
      adminB = await person(ops.b, [{ role: 'OPERATOR_ADMIN', scopeType: 'OPERATOR', scopeId: ops.b }]);
      organizerAdmin = await person(ops.a, [{ role: 'ORGANIZER_ADMIN', scopeType: 'ORGANIZER', scopeId: ids.a1 }]);
      otherOrganizerAdmin = await person(ops.a, [{ role: 'ORGANIZER_ADMIN', scopeType: 'ORGANIZER', scopeId: ids.a2 }]);
      merchantAdmin = await person(ops.a, [{ role: 'MERCHANT_ADMIN', scopeType: 'MERCHANT', scopeId: ids.m1 }]);
      cashier = await person(ops.a, [{ role: 'CASHIER', scopeType: 'ORGANIZER', scopeId: ids.a1 }]);
    });
    app = await createTestApp({ identity: idp });
  });

  afterAll(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const send = (method: 'post' | 'patch', who: TestPerson, path: string, body: object = {}, key: string = randomUUID()) =>
    http()[method](path).set('Authorization', `Bearer ${who.token}`).set('Idempotency-Key', key).send(body);
  const post = (who: TestPerson, path: string, body: object = {}, key?: string) => send('post', who, path, body, key);
  const patch = (who: TestPerson, path: string, body: object = {}) => send('patch', who, path, body);
  const get = (who: TestPerson, path: string) => http().get(path).set('Authorization', `Bearer ${who.token}`);
  const problem = (res: request.Response) => JSON.parse(res.text) as { code?: string; detail?: string; violations?: Array<{ rule: string; field: string }> };
  const rows = <T>(sql: string, params: unknown[] = []) => withOwner(async (db) => (await db.query(sql, params)).rows as T[]);
  const A = () => `/v1/operators/${ops.a}`;
  const B = () => `/v1/operators/${ops.b}`;
  const terms = { valid_from: '2026-01-01T00:00:00Z', offline_loss_bearer: 'ORGANIZER', cash_diff_bearer: 'OPERATOR', breakage_organizer_bps: 8000 };
  const newOrganizer = async () => {
    const res = await post(adminA, `${A()}/organizers`, { legal_name: `Organisateur ${randomUUID()}`, country_code: 'SN' });
    expect(res.status).toBe(201);
    return res.body.organizer_id as string;
  };
  const newContract = async (organizerId: string) => {
    const res = await post(adminA, `${A()}/organizers/${organizerId}/contracts`, terms);
    expect(res.status).toBe(201);
    return res.body.contract_id as string;
  };
  const feeRule = (contractId: string, overrides: object = {}) => ({
    scope_type: 'OPERATOR_CONTRACT', scope_id: contractId, payer_purpose: 'ORG_FPREST', beneficiary_purpose: 'OPE_FRAIS',
    basis: 'TOPUP_AMOUNT', rate_bps: 200, tax_code: 'VAT', trigger: 'CLOSING', ...overrides,
  });

  describe('US2 : le prestataire ouvre un organisateur et fixe ses conditions', () => {
    it('organisateur, contrat, configuration du prestataire, règle de frais prestataire → organisateur', async () => {
      const created = await post(adminA, `${A()}/organizers`, { legal_name: 'Festival du Fleuve', country_code: 'SN', tax_id: 'SN-777', operator_id: ops.b });
      expect(created.status).toBe(201);
      const organizerId = created.body.organizer_id as string;
      expect(created.headers.location).toBe(`${A()}/organizers/${organizerId}`);
      expect(created.body).toMatchObject({ operator_id: ops.a, legal_name: 'Festival du Fleuve', tax_id: 'SN-777' });
      expect(await rows('SELECT kind, operator_id FROM party WHERE id = $1', [organizerId])).toEqual([{ kind: 'ORGANIZER', operator_id: ops.a }]);

      const contract = await post(adminA, `${A()}/organizers/${organizerId}/contracts`, terms);
      expect(contract.status).toBe(201);
      expect(contract.body).toMatchObject({
        operator_id: ops.a, kind: 'OPERATOR_ORGANIZER', counterparty_id: organizerId, version: 1, offline_loss_bearer: 'ORGANIZER',
        cash_diff_bearer: 'OPERATOR', breakage_organizer_bps: 8000, operator_fee_basis: 'GROSS', chargeback_bearer: 'ORGANIZER', platform_fee_mode: null,
      });

      const config = await post(adminA, `${A()}/config-versions`, { settings: { cash_refund_single_max_cap: 40000, psp_fee_bearer: 'OPERATOR' } });
      expect(config.status).toBe(201);
      expect(config.body).toMatchObject({ operator_id: ops.a, scope_type: 'OPERATOR', scope_id: ops.a, settings: { cash_refund_single_max_cap: 40000 } });

      const rule = await post(adminA, `${A()}/fee-rules`, feeRule(contract.body.contract_id));
      expect(rule.status).toBe(201);
      expect(rule.body).toMatchObject({ operator_id: ops.a, scope_type: 'OPERATOR_CONTRACT', rate_bps: 200, tax_code: 'VAT', valid_to: null, version: 1 });

      const audit = await rows<{ action: string }>(
        `SELECT action FROM audit_log WHERE operator_id = $1 AND object_id = ANY($2::text[]) ORDER BY seq`,
        [ops.a, [organizerId, contract.body.contract_id, config.body.config_version_id, rule.body.fee_rule_id]],
      );
      expect(audit.map((a) => a.action)).toEqual(['ORGANIZER_CREATED', 'CONTRACT_CREATED', 'CONFIG_VERSION_CREATED', 'FEE_RULE_CREATED']);
      expect(await rows(`SELECT actor_id, actor_role FROM audit_log WHERE object_id = $1`, [organizerId])).toEqual([{ actor_id: adminA.userId, actor_role: 'OPERATOR_ADMIN' }]);
    });

    it('rejeu idempotent : même réponse, un seul organisateur', async () => {
      const key = randomUUID();
      const body = { legal_name: `Rejoué ${randomUUID()}` };
      const first = await post(adminA, `${A()}/organizers`, body, key);
      const replay = await post(adminA, `${A()}/organizers`, body, key);
      expect([first.status, replay.status, replay.headers['idempotency-replayed']]).toEqual([201, 201, 'true']);
      expect(replay.body).toEqual(first.body);
      expect(await rows('SELECT count(*)::int AS n FROM party WHERE legal_name = $1', [body.legal_name])).toEqual([{ n: 1 }]);
    });
  });

  describe('organisateurs', () => {
    it('OPERATOR_ADMIN : liste complète, lecture, modification avec audit', async () => {
      const list = await get(adminA, `${A()}/organizers?limit=200`);
      const listed = list.body.data.map((o: { organizer_id: string }) => o.organizer_id);
      expect(listed).toEqual(expect.arrayContaining([ids.a1, ids.a2]));
      expect(listed).not.toContain(ids.b1);
      const updated = await patch(adminA, `${A()}/organizers/${ids.a2}`, { legal_name: 'Organisateur A2 bis' });
      expect(updated.status).toBe(200);
      expect(updated.body).toMatchObject({ organizer_id: ids.a2, legal_name: 'Organisateur A2 bis', country_code: 'SN' });
      expect(await rows(`SELECT before->>'legal_name' AS before, after->>'legal_name' AS after FROM audit_log WHERE object_id = $1 AND action = 'ORGANIZER_UPDATED'`, [ids.a2])).toEqual([
        { before: 'Organisateur A2', after: 'Organisateur A2 bis' },
      ]);
      expect((await post(adminA, `${A()}/organizers`, {})).status).toBe(400);
    });

    it('ORGANIZER_ADMIN : ne voit que le sien, ne crée ni ne modifie', async () => {
      const list = await get(organizerAdmin, `${A()}/organizers`);
      expect(list.body.data.map((o: { organizer_id: string }) => o.organizer_id)).toEqual([ids.a1]);
      expect((await get(organizerAdmin, `${A()}/organizers/${ids.a1}`)).status).toBe(200);
      expect((await get(organizerAdmin, `${A()}/organizers/${ids.a2}`)).status).toBe(403);
      expect((await post(organizerAdmin, `${A()}/organizers`, { legal_name: 'Intrus' })).status).toBe(403);
      expect((await patch(organizerAdmin, `${A()}/organizers/${ids.a1}`, { legal_name: 'Intrus' })).status).toBe(403);
      expect((await get(cashier, `${A()}/organizers`)).status).toBe(403);
    });

    it('PLATFORM_ADMIN : supervise la lecture de n’importe quel prestataire', async () => {
      expect((await get(platformAdmin, `${B()}/organizers/${ids.b1}`)).body).toMatchObject({ organizer_id: ids.b1, operator_id: ops.b });
    });
  });

  describe('commerçants', () => {
    it('créés et modifiés par OPERATOR_ADMIN et ORGANIZER_ADMIN, sans condition commerciale', async () => {
      const byOrganizer = await post(organizerAdmin, `${A()}/merchants`, { legal_name: 'Bar du Port', country_code: 'SN' });
      expect(byOrganizer.status).toBe(201);
      expect(Object.keys(byOrganizer.body).sort()).toEqual(['country_code', 'created_at', 'legal_name', 'merchant_id', 'operator_id', 'tax_id']);
      expect((await post(adminA, `${A()}/merchants`, { legal_name: 'Food truck' })).status).toBe(201);
      const updated = await patch(organizerAdmin, `${A()}/merchants/${byOrganizer.body.merchant_id}`, { tax_id: 'SN-555' });
      expect(updated.body).toMatchObject({ legal_name: 'Bar du Port', tax_id: 'SN-555' });
      expect(await rows(`SELECT action FROM audit_log WHERE object_id = $1 ORDER BY seq`, [byOrganizer.body.merchant_id])).toEqual([
        { action: 'MERCHANT_CREATED' },
        { action: 'MERCHANT_UPDATED' },
      ]);
      const list = await get(organizerAdmin, `${A()}/merchants?limit=200`);
      expect(list.body.data.map((m: { merchant_id: string }) => m.merchant_id)).toEqual(expect.arrayContaining([ids.m1, ids.m2, byOrganizer.body.merchant_id]));
    });

    it('MERCHANT_ADMIN : lit le sien seulement, n’écrit rien', async () => {
      expect((await get(merchantAdmin, `${A()}/merchants`)).body.data.map((m: { merchant_id: string }) => m.merchant_id)).toEqual([ids.m1]);
      expect((await get(merchantAdmin, `${A()}/merchants/${ids.m1}`)).status).toBe(200);
      expect((await get(merchantAdmin, `${A()}/merchants/${ids.m2}`)).status).toBe(403);
      expect((await post(merchantAdmin, `${A()}/merchants`, { legal_name: 'Intrus' })).status).toBe(403);
      expect((await patch(merchantAdmin, `${A()}/merchants/${ids.m1}`, { legal_name: 'Intrus' })).status).toBe(403);
    });
  });

  describe('contrats prestataire–organisateur', () => {
    it('champ obligatoire manquant : 422 qui le nomme ; second contrat : 409 ; valeur mal formée : 400', async () => {
      const organizerId = await newOrganizer();
      const { breakage_organizer_bps: _omitted, ...incomplete } = terms;
      const missing = await post(adminA, `${A()}/organizers/${organizerId}/contracts`, incomplete);
      expect(missing.status).toBe(422);
      expect(problem(missing).detail).toContain('breakage_organizer_bps');
      expect((await post(adminA, `${A()}/organizers/${organizerId}/contracts`, { ...terms, breakage_organizer_bps: 10001 })).status).toBe(400);
      await newContract(organizerId);
      const second = await post(adminA, `${A()}/organizers/${organizerId}/contracts`, terms);
      expect([second.status, problem(second).code]).toEqual([409, 'CONFLICT_STATE']);
      expect((await post(organizerAdmin, `${A()}/organizers/${ids.a1}/contracts`, terms)).status).toBe(403);
    });

    it('nouvelle version : demande à deux, exécutée par un second OPERATOR_ADMIN ; la version 1 reste intacte', async () => {
      const organizerId = await newOrganizer();
      const contractId = await newContract(organizerId);
      const demand = await post(adminA, `${A()}/contracts/${contractId}/versions`, { valid_from: '2026-06-01T00:00:00Z', breakage_organizer_bps: 7000, offline_loss_bearer: 'OPERATOR' });
      expect(demand.status).toBe(202);
      expect(demand.body).toMatchObject({ action: 'CONTRACT_VERSION', status: 'PENDING', target_id: contractId, requested_by: adminA.userId });
      expect(await rows('SELECT count(*)::int AS n FROM contract WHERE counterparty_id = $1', [organizerId])).toEqual([{ n: 1 }]);

      const own = await post(adminA, `/v1/approval-requests/${demand.body.approval_request_id}/approve`);
      expect([own.status, problem(own).code]).toEqual([409, 'APPROVAL_INVALID']);
      expect((await post(organizerAdmin, `/v1/approval-requests/${demand.body.approval_request_id}/approve`)).status).toBe(403);
      const approved = await post(adminA2, `/v1/approval-requests/${demand.body.approval_request_id}/approve`);
      expect(approved.status).toBe(200);
      expect(approved.body).toMatchObject({
        status: 'EXECUTED',
        result: { version: 2, breakage_organizer_bps: 7000, offline_loss_bearer: 'OPERATOR', cash_diff_bearer: 'OPERATOR', operator_fee_basis: 'GROSS' },
      });
      const list = await get(adminA, `${A()}/organizers/${organizerId}/contracts`);
      expect(list.body.data.map((c: { version: number; breakage_organizer_bps: number }) => [c.version, c.breakage_organizer_bps])).toEqual([[2, 7000], [1, 8000]]);
      expect(await rows(`SELECT actor_id, approver_id FROM audit_log WHERE object_id = $1 AND action = 'CONTRACT_CREATED'`, [approved.body.result.contract_id])).toEqual([
        { actor_id: adminA.userId, approver_id: adminA2.userId },
      ]);
      const stale = await post(adminA, `${A()}/contracts/${contractId}/versions`, { valid_from: '2026-07-01T00:00:00Z' });
      expect([stale.status, problem(stale).code]).toEqual([409, 'CONFLICT_STATE']);
    });

    it('lecture par l’ORGANIZER_ADMIN de l’organisateur seulement', async () => {
      await withOwner((db) =>
        db.query(
          `INSERT INTO contract (operator_id, kind, counterparty_id, valid_from, offline_loss_bearer, cash_diff_bearer, breakage_organizer_bps)
           VALUES ($1, 'OPERATOR_ORGANIZER', $2, '2026-01-01', 'ORGANIZER', 'ORGANIZER', 8000)`,
          [ops.a, ids.a1],
        ),
      );
      expect((await get(organizerAdmin, `${A()}/organizers/${ids.a1}/contracts`)).body.data).toHaveLength(1);
      expect((await get(otherOrganizerAdmin, `${A()}/organizers/${ids.a1}/contracts`)).status).toBe(403);
    });
  });

  describe('configuration des niveaux prestataire et organisateur', () => {
    it('prestataire : versions successives, hors bornes refusé avec la règle citée', async () => {
      const first = await post(adminA, `${A()}/config-versions`, { settings: { spend_order: 'PAID_FIRST' } });
      const second = await post(adminA, `${A()}/config-versions`, { settings: { spend_order: 'PAID_FIRST', cash_refund_single_max_cap: 30000 } });
      expect(second.body.version).toBe(first.body.version + 1);
      const list = await get(adminA, `${A()}/config-versions?limit=1`);
      expect(list.body).toMatchObject({ has_more: true });
      expect(list.body.data[0].version).toBe(second.body.version);
      const refused = await post(adminA, `${A()}/config-versions`, { settings: { cash_refund_single_max_cap: -5, sync_deadline_hours: 72 } });
      expect(refused.status).toBe(422);
      expect(problem(refused).violations?.map((v) => `${v.field}:${v.rule}`)).toEqual(['cash_refund_single_max_cap:catalog.range', 'sync_deadline_hours:catalog.level']);
      expect((await post(adminA, `${A()}/config-versions`, {})).status).toBe(400);
    });

    it('un ORGANIZER_ADMIN ne règle jamais une clé du prestataire', async () => {
      const before = await rows(`SELECT count(*)::int AS n FROM config_version WHERE scope_type = 'OPERATOR' AND scope_id = $1`, [ops.a]);
      expect((await post(organizerAdmin, `${A()}/config-versions`, { settings: { cash_refund_single_max_cap: 999999 } })).status).toBe(403);
      // Glissée dans la configuration de son organisateur, la clé reste celle du prestataire : 403, rien n'est écrit.
      const level = await post(organizerAdmin, `${A()}/organizers/${ids.a1}/config-versions`, { settings: { cash_refund_single_max_cap: 999999 } });
      expect(level.status).toBe(403);
      expect(await rows(`SELECT count(*)::int AS n FROM config_version WHERE scope_type = 'ORGANIZER' AND scope_id = $1`, [ids.a1])).toEqual([{ n: 0 }]);
      expect(await rows(`SELECT count(*)::int AS n FROM config_version WHERE scope_type = 'OPERATOR' AND scope_id = $1`, [ops.a])).toEqual(before);
    });

    it('organisateur : réglé par son ORGANIZER_ADMIN ; un autre organisateur ou le prestataire : 403', async () => {
      const created = await post(organizerAdmin, `${A()}/organizers/${ids.a1}/config-versions`, { settings: { psp_fee_bearer: 'CUSTOMER', wallet_scope: 'EVENT' } });
      expect(created.status).toBe(201);
      expect(created.body).toMatchObject({ scope_type: 'ORGANIZER', scope_id: ids.a1, version: 1, operator_id: ops.a });
      expect((await get(organizerAdmin, `${A()}/organizers/${ids.a1}/config-versions`)).body.data).toHaveLength(1);
      expect((await post(otherOrganizerAdmin, `${A()}/organizers/${ids.a1}/config-versions`, { settings: { psp_fee_bearer: 'OPERATOR' } })).status).toBe(403);
      // Clés de l'organisateur : le prestataire ne les règle pas à sa place (FR-010).
      expect((await post(adminA, `${A()}/organizers/${ids.a1}/config-versions`, { settings: { psp_fee_bearer: 'OPERATOR', wallet_scope: 'EVENT' } })).status).toBe(403);
      const scope = await post(organizerAdmin, `${A()}/organizers/${ids.a1}/config-versions`, { settings: { wallet_scope: 'ORGANIZER' } });
      expect(scope.status).toBe(422);
      expect(problem(scope).detail).toContain('wallet_scope');
    });
  });

  describe('règles de frais prestataire → organisateur', () => {
    it('création, doublon en vigueur refusé, remplacement : l’ancienne est fermée, la nouvelle prend la version 2', async () => {
      const contractId = await newContract(await newOrganizer());
      const created = await post(adminA, `${A()}/fee-rules`, feeRule(contractId, { valid_from: '2026-01-01T00:00:00Z' }));
      expect(created.status).toBe(201);
      const duplicate = await post(adminA, `${A()}/fee-rules`, feeRule(contractId, { rate_bps: 300 }));
      expect([duplicate.status, problem(duplicate).code]).toEqual([409, 'CONFLICT_STATE']);

      const replaced = await post(adminA, `${A()}/fee-rules/${created.body.fee_rule_id}/replacements`, feeRule(contractId, { rate_bps: 300, valid_from: '2026-06-01T00:00:00Z' }));
      expect(replaced.status).toBe(201);
      expect(replaced.body).toMatchObject({ rate_bps: 300, version: 2, valid_from: '2026-06-01T00:00:00.000Z', valid_to: null });
      const list = await get(adminA, `${A()}/fee-rules?scope_type=OPERATOR_CONTRACT&scope_id=${contractId}`);
      expect(list.body.data.map((r: { version: number; valid_to: string | null; rate_bps: number }) => [r.version, r.rate_bps, r.valid_to])).toEqual([
        [2, 300, null],
        [1, 200, '2026-06-01T00:00:00.000Z'],
      ]);
      expect(await rows(`SELECT action, before->>'valid_to' IS NOT NULL AS closed FROM audit_log WHERE object_id = $1`, [replaced.body.fee_rule_id])).toEqual([
        { action: 'FEE_RULE_REPLACED', closed: true },
      ]);
      // Règle déjà fermée : 409 ; autre assiette : 422 ; date d'effet antérieure : 422.
      const closed = await post(adminA, `${A()}/fee-rules/${created.body.fee_rule_id}/replacements`, feeRule(contractId, { rate_bps: 400 }));
      expect([closed.status, problem(closed).code]).toEqual([409, 'CONFLICT_STATE']);
      expect((await post(adminA, `${A()}/fee-rules/${replaced.body.fee_rule_id}/replacements`, feeRule(contractId, { basis: 'FIXED' }))).status).toBe(422);
      expect((await post(adminA, `${A()}/fee-rules/${replaced.body.fee_rule_id}/replacements`, feeRule(contractId, { valid_from: '2026-03-01T00:00:00Z' }))).status).toBe(422);
    });

    it('taxe inconnue du profil, portée de plateforme, contrat d’un autre type ou inconnu : refusés', async () => {
      const contractId = await newContract(await newOrganizer());
      expect((await post(adminA, `${A()}/fee-rules`, feeRule(contractId, { tax_code: 'TAXE_INCONNUE' }))).status).toBe(422);
      expect((await post(adminA, `${A()}/fee-rules`, feeRule(contractId, { scope_type: 'PLATFORM_CONTRACT' }))).status).toBe(403);
      expect((await post(adminA, `${A()}/fee-rules`, feeRule(randomUUID()))).status).toBe(422);
      expect((await post(adminA, `${A()}/fee-rules`, feeRule(contractId, { tax_code: null }))).status).toBe(201);
    });

    it('réglées par l’OPERATOR_ADMIN seul ; l’ORGANIZER_ADMIN ne voit que celles de son organisateur', async () => {
      const [mine] = await rows<{ id: string }>(`SELECT id FROM contract WHERE counterparty_id = $1 AND kind = 'OPERATOR_ORGANIZER' ORDER BY version DESC LIMIT 1`, [ids.a1]);
      const contractOfA1 = mine?.id ?? (await newContractFor(ids.a1));
      const rule = await post(adminA, `${A()}/fee-rules`, feeRule(contractOfA1, { basis: 'PER_MEDIA', fixed_amount: 100, rate_bps: 0 }));
      expect(rule.status).toBe(201);
      expect((await post(organizerAdmin, `${A()}/fee-rules`, feeRule(contractOfA1, { basis: 'PER_REFUND' }))).status).toBe(403);
      expect((await post(organizerAdmin, `${A()}/fee-rules/${rule.body.fee_rule_id}/replacements`, feeRule(contractOfA1, { basis: 'PER_MEDIA' }))).status).toBe(403);
      const seen = await get(organizerAdmin, `${A()}/fee-rules?limit=200`);
      expect(seen.body.data.map((r: { fee_rule_id: string }) => r.fee_rule_id)).toContain(rule.body.fee_rule_id);
      const scopes = new Set(seen.body.data.map((r: { scope_id: string }) => r.scope_id));
      expect([...scopes]).toEqual([contractOfA1]);
      expect((await get(otherOrganizerAdmin, `${A()}/fee-rules?limit=200`)).body.data.map((r: { fee_rule_id: string }) => r.fee_rule_id)).not.toContain(rule.body.fee_rule_id);
      expect((await get(adminA, `${A()}/fee-rules?scope_type=AUTRE`)).status).toBe(400);
    });
    const newContractFor = (organizerId: string) => newContract(organizerId);
  });

  describe('isolation à deux prestataires', () => {
    it('lecture et écriture par le personnel de B sur le prestataire A : 404 partout, rien n’est écrit', async () => {
      const organizerId = await newOrganizer();
      const contractId = await newContract(organizerId);
      const ruleId = (await post(adminA, `${A()}/fee-rules`, feeRule(contractId))).body.fee_rule_id as string;
      const reads = [
        '/config-versions', '/organizers', `/organizers/${organizerId}`, `/organizers/${organizerId}/config-versions`,
        `/organizers/${organizerId}/contracts`, '/merchants', `/merchants/${ids.m1}`, '/fee-rules',
      ];
      for (const path of reads) expect([path, (await get(adminB, `${A()}${path}`)).status]).toEqual([path, 404]);
      const writes: Array<['post' | 'patch', string, object]> = [
        ['post', '/config-versions', { settings: { spend_order: 'PAID_FIRST' } }],
        ['post', '/organizers', { legal_name: 'Intrus de B' }],
        ['patch', `/organizers/${organizerId}`, { legal_name: 'Intrus de B' }],
        ['post', `/organizers/${organizerId}/config-versions`, { settings: {} }],
        ['post', `/organizers/${organizerId}/contracts`, terms],
        ['post', `/contracts/${contractId}/versions`, { valid_from: '2026-06-01T00:00:00Z' }],
        ['post', '/merchants', { legal_name: 'Intrus de B' }],
        ['patch', `/merchants/${ids.m1}`, { legal_name: 'Intrus de B' }],
        ['post', '/fee-rules', feeRule(contractId, { basis: 'PER_REFUND' })],
        ['post', `/fee-rules/${ruleId}/replacements`, feeRule(contractId)],
      ];
      for (const [method, path, body] of writes) expect([path, (await send(method, adminB, `${A()}${path}`, body)).status]).toEqual([path, 404]);
      expect(await rows(`SELECT count(*)::int AS n FROM party WHERE legal_name = 'Intrus de B'`)).toEqual([{ n: 0 }]);
    });

    it('depuis son propre prestataire, B ne peut viser aucun objet de A', async () => {
      const organizerId = await newOrganizer();
      const contractId = await newContract(organizerId);
      const ruleId = (await post(adminA, `${A()}/fee-rules`, feeRule(contractId))).body.fee_rule_id as string;
      expect((await get(adminB, `${B()}/organizers/${organizerId}`)).status).toBe(404);
      expect((await patch(adminB, `${B()}/organizers/${organizerId}`, { legal_name: 'Volé' })).status).toBe(404);
      expect((await get(adminB, `${B()}/organizers/${organizerId}/contracts`)).status).toBe(404);
      expect((await post(adminB, `${B()}/organizers/${organizerId}/contracts`, terms)).status).toBe(404);
      expect((await post(adminB, `${B()}/contracts/${contractId}/versions`, { valid_from: '2026-06-01T00:00:00Z' })).status).toBe(404);
      expect((await get(adminB, `${B()}/merchants/${ids.m1}`)).status).toBe(404);
      expect((await post(adminB, `${B()}/fee-rules`, feeRule(contractId, { basis: 'PER_REFUND' }))).status).toBe(422);
      expect((await post(adminB, `${B()}/fee-rules/${ruleId}/replacements`, feeRule(contractId))).status).toBe(404);
      const seen = await get(adminB, `${B()}/fee-rules?limit=200`);
      expect(seen.body.data.map((r: { fee_rule_id: string }) => r.fee_rule_id)).not.toContain(ruleId);
      expect(await rows('SELECT legal_name FROM party WHERE id = $1', [organizerId])).not.toEqual([{ legal_name: 'Volé' }]);
    });
  });
});
