// Balayage d'isolation de la mission configuration-parties-evenements (SC-003, NFR-001, NFR-002) : CHAQUE opération
// que la mission a ajoutée au contrat (lue dans openapi.yaml par ses tags, jamais une liste écrite à la main) est
// appelée par le personnel d'un second prestataire sur les objets du premier — jamais de succès, rien ne fuit, rien
// n'est modifié — puis sans jeton (401). Une opération du contrat sans cas dans ce fichier fait échouer le test.
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { parse } from 'yaml';
import { createApiConfigFixture, type ApiConfigFixture } from '../../scenario/api-config-fixture';
import { createTestApp } from '../../support/app';
import { withOwner } from '../../support/db';
import { FakeIdp, type TestPerson } from '../../support/fake-idp';
import { createOperators, type Operators } from '../transverse/fixtures';

const CONTRACT = join(__dirname, '../../../../../packages/contracts/openapi.yaml');
const MISSION_TAGS = ['Plateforme', 'Organisation', 'Événements', 'Configuration'];
type Method = 'get' | 'post' | 'patch';

interface Route {
  method: Method;
  path: string;
  operationId: string;
}

/** Opérations de la mission, lues dans le contrat. */
function missionRoutes(): Route[] {
  const contract = parse(readFileSync(CONTRACT, 'utf8')) as {
    paths: Record<string, Record<string, { operationId: string; tags: string[] }>>;
  };
  return Object.entries(contract.paths).flatMap(([path, operations]) =>
    (['get', 'post', 'patch'] as const)
      .filter((method) => operations[method] && MISSION_TAGS.includes(operations[method]!.tags[0]!))
      // Configurations PSP (mission 6, WP10) : leur balayage est dans test/integration/psp-configurations/isolation.
      .filter((method) => !/PspConfiguration|PspSelection/.test(operations[method]!.operationId))
      .map((method) => ({ method, path, operationId: operations[method]!.operationId })),
  );
}

/** Opérations réservées à PLATFORM_ADMIN : refusées (403) à tout le personnel d'un prestataire. */
const PLATFORM_ONLY = [
  'createJurisdictionProfile',
  'createJurisdictionProfileVersion',
  'listOperators',
  'createOperator',
  'updateOperator',
  'createPlatformContract',
  'createPlatformContractVersion',
  'listPlatformConfigVersions',
  'createPlatformConfigVersion',
  'createPlatformFeeRule',
];
/** Données de référence sans prestataire, lisibles par tout administrateur : les profils de législation. */
const SHARED_READS = ['listJurisdictionProfiles', 'getJurisdictionProfile'];

jest.setTimeout(180_000);

describe('balayage d’isolation des routes de configuration', () => {
  let idp: FakeIdp;
  let app: INestApplication;
  let fx: ApiConfigFixture; // prestataire A, construit par l'API
  let others: Operators; // prestataire B = others.a
  let intruderOperator: TestPerson; // OPERATOR_ADMIN de B
  let intruderOrganizer: TestPerson; // ORGANIZER_ADMIN d'un organisateur de B
  let posId: string;
  const routes = missionRoutes();

  const INTRUS = 'Intrus du balayage';
  const feeRule = () => ({
    scope_type: 'EVENT',
    scope_id: fx.eventId,
    payer_purpose: 'WALLET_PAID',
    beneficiary_purpose: 'ORG_FFEST',
    basis: 'PER_TERMINAL_DAY',
    fixed_amount: 1,
    trigger: 'CLOSING',
  });
  /** Corps valides par opération d'écriture : le refus vient de l'isolation, pas de la validation. */
  const bodies: Record<string, () => object> = {
    createJurisdictionProfile: () => ({ country_code: 'XX', valid_from: '2026-01-01' }),
    createJurisdictionProfileVersion: () => ({ valid_from: '2030-01-01' }),
    createOperator: () => ({ legal_name: INTRUS, country_code: 'SN' }),
    updateOperator: () => ({ legal_name: INTRUS }),
    createPlatformContract: () => ({
      valid_from: '2026-01-01T00:00:00Z',
      platform_fee_mode: 'INVOICED',
    }),
    createPlatformContractVersion: () => ({ valid_from: '2030-01-01T00:00:00Z' }),
    createPlatformConfigVersion: () => ({ settings: { spend_order: 'PAID_FIRST' } }),
    createPlatformFeeRule: () => ({
      scope_type: 'PLATFORM_CONTRACT',
      scope_id: fx.platformContractId,
      payer_purpose: 'OPE_REDEV',
      beneficiary_purpose: 'PLT_REDEV',
      basis: 'FIXED',
      fixed_amount: 1,
      trigger: 'CLOSING',
    }),
    createOperatorConfigVersion: () => ({ settings: { spend_order: 'PAID_FIRST' } }),
    createOrganizer: () => ({ legal_name: INTRUS }),
    updateOrganizer: () => ({ legal_name: INTRUS }),
    createOrganizerConfigVersion: () => ({ settings: { psp_fee_bearer: 'CUSTOMER' } }),
    createOrganizerContract: () => ({
      valid_from: '2026-01-01T00:00:00Z',
      offline_loss_bearer: 'OPERATOR',
      cash_diff_bearer: 'OPERATOR',
      breakage_organizer_bps: 1,
    }),
    createOrganizerContractVersion: () => ({
      valid_from: '2030-01-01T00:00:00Z',
      breakage_organizer_bps: 1,
    }),
    createMerchant: () => ({ legal_name: INTRUS }),
    updateMerchant: () => ({ legal_name: INTRUS }),
    createEvent: () => ({
      organizer_id: fx.parties.ORG,
      name: INTRUS,
      currency: 'XOF',
      timezone: 'Africa/Dakar',
      jurisdiction_id: fx.jurisdictionId,
      funds_holder: 'ORGANIZER',
    }),
    updateEvent: () => ({ name: INTRUS }),
    transitionEventStatus: () => ({ to: 'LIVE' }),
    createParticipation: () => ({ merchant_id: fx.parties.BAR, link_type: 'EXTERNAL' }),
    updateParticipation: () => ({ pitch_fee: 1 }),
    createPointOfSale: () => ({ name: INTRUS }),
    renamePointOfSale: () => ({ name: INTRUS }),
    createFeeRule: feeRule,
    replaceFeeRule: () => ({
      scope_type: 'PARTICIPATION',
      scope_id: fx.participations.FOOD,
      payer_purpose: 'MERCHANT',
      beneficiary_purpose: 'ORG_COM',
      basis: 'SALE_AMOUNT',
      rate_bps: 1,
      trigger: 'REALTIME',
    }),
  };

  beforeAll(async () => {
    idp = await FakeIdp.create();
    app = await createTestApp({ identity: idp });
    fx = await createApiConfigFixture(app, idp);
    const pos = await request(app.getHttpServer())
      .post(
        `/v1/operators/${fx.parties.OPE}/participations/${fx.participations.FOOD}/points-of-sale`,
      )
      .set('Authorization', `Bearer ${fx.people.organizerAdmin.token}`)
      .set('Idempotency-Key', randomUUID())
      .send({ name: 'Stand du balayage' });
    posId = pos.body.pos_id as string;
    others = await createOperators();
    const organizerB = randomUUID();
    await withOwner(async (db) => {
      await db.query(
        `INSERT INTO party (id, kind, operator_id, legal_name) VALUES ($1, 'ORGANIZER', $2, 'Organisateur de B')`,
        [organizerB, others.a],
      );
      intruderOperator = await idp.createPerson(db, {
        operatorId: others.a,
        roles: [{ role: 'OPERATOR_ADMIN', scopeType: 'OPERATOR', scopeId: others.a }],
      });
      intruderOrganizer = await idp.createPerson(db, {
        operatorId: others.a,
        roles: [{ role: 'ORGANIZER_ADMIN', scopeType: 'ORGANIZER', scopeId: organizerB }],
      });
    });
  });

  afterAll(async () => {
    await app.close();
  });

  /** Chemin d'une opération sur les objets du prestataire A, depuis le prestataire `root`. */
  const url = (route: Route, root: string): string =>
    `/v1${route.path
      .replace('{operator_id}', root)
      .replace('{profile_id}', fx.jurisdictionId)
      .replace(
        '{contract_id}',
        route.operationId === 'createPlatformContractVersion'
          ? fx.platformContractId
          : fx.contractId,
      )
      .replace('{organizer_id}', fx.parties.ORG)
      .replace('{merchant_id}', fx.parties.FOOD)
      .replace('{event_id}', fx.eventId)
      .replace('{participation_id}', fx.participations.FOOD)
      .replace('{pos_id}', posId)
      .replace('{fee_rule_id}', fx.commissionRules.FOOD)}`;
  const call = (route: Route, root: string, token?: string) => {
    let req = request(app.getHttpServer())[route.method](url(route, root));
    if (token) req = req.set('Authorization', `Bearer ${token}`);
    if (route.method === 'get') return req;
    return req.set('Idempotency-Key', randomUUID()).send(bodies[route.operationId]!());
  };
  /** État des données du prestataire A (et des données de plateforme qui le concernent). */
  const snapshot = () =>
    withOwner(
      async (db) =>
        (
          await db.query(
            `SELECT (SELECT count(*)::int FROM party WHERE operator_id = $1 OR id = $1) AS parties,
                  (SELECT string_agg(legal_name, '|' ORDER BY id) FROM party WHERE operator_id = $1 OR id = $1) AS names,
                  (SELECT count(*)::int FROM event WHERE operator_id = $1) AS events,
                  (SELECT name || ':' || status FROM event WHERE id = $2) AS event,
                  (SELECT count(*)::int FROM merchant_participation WHERE operator_id = $1) AS participations,
                  (SELECT string_agg(pitch_fee::text, '|' ORDER BY id) FROM merchant_participation WHERE operator_id = $1) AS pitch_fees,
                  (SELECT string_agg(name, '|' ORDER BY id) FROM point_of_sale WHERE operator_id = $1) AS points_of_sale,
                  (SELECT count(*)::int FROM contract WHERE operator_id = $1) AS contracts,
                  (SELECT count(*)::int FROM fee_rule WHERE operator_id = $1) AS fee_rules,
                  (SELECT count(*)::int FROM fee_rule WHERE operator_id = $1 AND valid_to IS NOT NULL) AS closed_fee_rules,
                  (SELECT count(*)::int FROM config_version WHERE operator_id = $1) AS config_versions,
                  (SELECT count(*)::int FROM approval_request WHERE operator_id = $1) AS approval_requests,
                  (SELECT count(*)::int FROM jurisdiction_profile WHERE country_code = (SELECT country_code FROM jurisdiction_profile WHERE id = $3)) AS profile_versions,
                  (SELECT count(*)::int FROM party WHERE legal_name = $4) AS intruder_parties,
                  (SELECT count(*)::int FROM event WHERE name = $4) AS intruder_events`,
            [fx.parties.OPE, fx.eventId, fx.jurisdictionId, INTRUS],
          )
        ).rows[0] as Record<string, unknown>,
    );

  it('le contrat déclare les 48 opérations de la mission, et chaque écriture a un cas dans ce balayage', () => {
    expect(routes).toHaveLength(48);
    expect(new Set(routes.map((route) => route.operationId)).size).toBe(48);
    expect(
      routes
        .filter((route) => route.method !== 'get' && !(route.operationId in bodies))
        .map((route) => route.operationId),
    ).toEqual([]);
    for (const operationId of [...PLATFORM_ONLY, ...SHARED_READS])
      expect(routes.map((route) => route.operationId)).toContain(operationId);
  });

  it('sans jeton : 401 sur chaque opération', async () => {
    for (const route of routes) {
      const res = await call(route, fx.parties.OPE);
      expect({ operation: route.operationId, status: res.status }).toEqual({
        operation: route.operationId,
        status: 401,
      });
    }
  });

  it.each([
    ['OPERATOR_ADMIN', () => intruderOperator],
    ['ORGANIZER_ADMIN', () => intruderOrganizer],
  ])(
    '%s d’un autre prestataire, sur le prestataire A : 404 (403 pour la plateforme), rien ne fuit, rien ne change',
    async (_role, who) => {
      const before = await snapshot();
      for (const route of routes) {
        const res = await call(route, fx.parties.OPE, who().token);
        const expected = PLATFORM_ONLY.includes(route.operationId)
          ? 403
          : SHARED_READS.includes(route.operationId)
            ? 200
            : 404;
        expect({ operation: route.operationId, status: res.status }).toEqual({
          operation: route.operationId,
          status: expected,
        });
        if (expected !== 200) {
          // Aucun identifiant ni nom d'un objet de A dans un refus.
          for (const secret of [
            fx.parties.ORG,
            fx.parties.FOOD,
            fx.eventId,
            fx.contractId,
            fx.commissionRules.FOOD,
            'Stand du balayage',
          ])
            expect(res.text).not.toContain(secret);
        }
      }
      expect(await snapshot()).toEqual(before);
    },
  );

  it('depuis son propre prestataire, B ne peut viser aucun objet de A (jamais de succès sur un objet de A)', async () => {
    const before = await snapshot();
    const objectParam =
      /\{(profile_id|contract_id|organizer_id|merchant_id|event_id|participation_id|pos_id|fee_rule_id)\}/;
    const targeted = routes.filter(
      (route) =>
        objectParam.test(route.path) &&
        !PLATFORM_ONLY.includes(route.operationId) &&
        !SHARED_READS.includes(route.operationId),
    );
    expect(targeted.length).toBeGreaterThan(20);
    for (const route of targeted) {
      const res = await call(route, others.a, intruderOperator.token);
      expect({
        operation: route.operationId,
        refused: res.status >= 400,
        status: res.status,
      }).toEqual({ operation: route.operationId, refused: true, status: res.status });
      expect([403, 404, 409, 422]).toContain(res.status);
    }
    // Écritures de collection dont le corps désigne un objet de A : l'organisateur ou la portée sont introuvables.
    for (const [operationId, status] of [
      ['createEvent', 404],
      ['createFeeRule', 422],
    ] as const) {
      const route = routes.find((r) => r.operationId === operationId)!;
      expect({
        operationId,
        status: (await call(route, others.a, intruderOperator.token)).status,
      }).toEqual({ operationId, status });
    }
    // Listes de B : aucun objet de A.
    for (const route of routes.filter(
      (r) => r.method === 'get' && !objectParam.test(r.path) && r.path.includes('{operator_id}'),
    )) {
      const res = await call(route, others.a, intruderOperator.token);
      for (const secret of [
        fx.parties.ORG,
        fx.parties.FOOD,
        fx.eventId,
        fx.contractId,
        fx.commissionRules.FOOD,
      ])
        expect({ operation: route.operationId, leaked: res.text.includes(secret) }).toEqual({
          operation: route.operationId,
          leaked: false,
        });
    }
    expect(await snapshot()).toEqual(before);
  });
});
