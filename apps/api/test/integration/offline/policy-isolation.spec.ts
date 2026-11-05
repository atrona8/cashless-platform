// Balayage d'isolation des routes de politique hors ligne (lot WP14 ; NFR-001, NFR-009). Les routes
// sont lues dans openapi.yaml (jamais listées en dur) : une route du contrat sans cas ici fait
// échouer le test. Chaque route est appelée par une personne du prestataire B, puis par un
// ORGANIZER_ADMIN d'un autre organisateur du même prestataire, sur les objets de A : jamais 2xx
// (sauf la lecture du plafond, permise au prestataire), puis sans jeton.
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { parse } from 'yaml';
import { createTestApp } from '../../support/app';
import { withOwner } from '../../support/db';
import { FakeIdp, type TestPerson } from '../../support/fake-idp';
import { ownerRows } from '../../support/media-fixtures';
import { createOperators, type Operators } from '../transverse/fixtures';

jest.setTimeout(120_000);
const CONTRACT = join(__dirname, '../../../../../packages/contracts/openapi.yaml');
const MISSION_PATHS = /\/(offline-ceiling|offline-policy|offline-risk)$/;

interface Route {
  method: 'get' | 'put';
  path: string;
  operationId: string;
}

function missionRoutes(): Route[] {
  const contract = parse(readFileSync(CONTRACT, 'utf8')) as {
    paths: Record<string, Record<string, { operationId?: string }>>;
  };
  return Object.entries(contract.paths)
    .filter(([path]) => MISSION_PATHS.test(path))
    .flatMap(([path, operations]) =>
      Object.keys(operations)
        .filter((method): method is 'get' | 'put' => ['get', 'put'].includes(method))
        .map((method) => ({ method, path, operationId: operations[method]!.operationId! })),
    );
}

describe('politique hors ligne : balayage d’isolation (WP14)', () => {
  let idp: FakeIdp;
  let app: INestApplication;
  let ops: Operators;
  const a = {
    org: randomUUID(),
    otherOrg: randomUUID(),
    event: randomUUID(),
    device: randomUUID(),
  };
  const orgB = randomUUID();
  let ownerA: TestPerson; // ORGANIZER_ADMIN de l'organisateur de A, pour poser un état à protéger
  let operatorB: TestPerson;
  let organizerB: TestPerson;
  let otherOrganizerA: TestPerson; // même prestataire, autre organisateur

  /** Corps valides : le refus vient de l'isolation, pas de la validation. */
  const bodies: Record<string, object> = {
    getOfflineCeiling: {},
    setOfflineCeiling: { version: 1, max_per_sale: 1 },
    getOrganizerOfflinePolicy: {},
    setOrganizerOfflinePolicy: { version: 1, max_per_sale: 1 },
    getEventOfflinePolicy: {},
    setEventOfflinePolicy: { version: 1, max_per_sale: 1 },
    getDeviceOfflinePolicy: {},
    setDeviceOfflinePolicy: { version: 1, max_per_sale: 1 },
    getEventOfflineRisk: {},
  };

  beforeAll(async () => {
    idp = await FakeIdp.create();
    ops = await createOperators();
    await withOwner(async (db) => {
      await db.query(
        `INSERT INTO party (id, kind, operator_id, legal_name, country_code) VALUES
           ($1, 'ORGANIZER', $4, 'Org A', 'SN'), ($2, 'ORGANIZER', $4, 'Autre org A', 'SN'),
           ($3, 'ORGANIZER', $5, 'Org B', 'SN')`,
        [a.org, a.otherOrg, orgB, ops.a, ops.b],
      );
      const profile = randomUUID();
      await db.query(
        `INSERT INTO jurisdiction_profile (id, country_code, version, valid_from, breakage_destination)
         VALUES ($1, 'SN', (1000000 + floor(random() * 1000000000))::int, '2026-01-01', 'ORGANIZER')`,
        [profile],
      );
      await db.query(
        `INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone, jurisdiction_id,
                            funds_holder)
         VALUES ($1, $2, $3, 'Événement A', 'XOF', 'Africa/Dakar', $4, 'ORGANIZER')`,
        [a.event, ops.a, a.org, profile],
      );
      await db.query(
        `INSERT INTO device (id, operator_id, kind, event_id, serial) VALUES ($1, $2, 'POS', $3, $4)`,
        [a.device, ops.a, a.event, `S-${randomUUID()}`],
      );
      const person = (
        operatorId: string,
        role: 'OPERATOR_ADMIN' | 'ORGANIZER_ADMIN',
        scope: string,
      ) =>
        idp.createPerson(db, {
          operatorId,
          roles: [
            {
              role,
              scopeType: role === 'OPERATOR_ADMIN' ? 'OPERATOR' : 'ORGANIZER',
              scopeId: scope,
            },
          ],
        });
      ownerA = await person(ops.a, 'ORGANIZER_ADMIN', a.org);
      otherOrganizerA = await person(ops.a, 'ORGANIZER_ADMIN', a.otherOrg);
      operatorB = await person(ops.b, 'OPERATOR_ADMIN', ops.b);
      organizerB = await person(ops.b, 'ORGANIZER_ADMIN', orgB);
    });
    app = await createTestApp({ identity: idp });
    // État initial de A, posé par l'API : il doit rester intact.
    for (const path of [
      `/organizers/${a.org}/offline-policy`,
      `/events/${a.event}/offline-policy`,
      `/devices/${a.device}/offline-policy`,
    ]) {
      const res = await request(app.getHttpServer())
        .put(`/v1${path}`)
        .set('Authorization', `Bearer ${ownerA.token}`)
        .set('Idempotency-Key', randomUUID())
        .send({ max_per_sale: 500, offline_enabled: true });
      expect(res.status).toBe(200);
    }
  });
  afterAll(async () => {
    await app?.close();
  });

  const url = (path: string) =>
    `/v1${path
      .replace('{operator_id}', ops.a)
      .replace('{organizer_id}', a.org)
      .replace('{event_id}', a.event)
      .replace('{device_id}', a.device)}`;
  const call = (route: Route, token?: string) => {
    let req =
      route.method === 'get'
        ? request(app.getHttpServer()).get(url(route.path))
        : request(app.getHttpServer()).put(url(route.path));
    if (token) req = req.set('Authorization', `Bearer ${token}`);
    req = req.set('Idempotency-Key', randomUUID());
    return route.method === 'get' ? req : req.send(bodies[route.operationId]!);
  };
  const state = () =>
    ownerRows(
      `SELECT scope_type, scope_id, version, max_per_sale, offline_enabled FROM offline_policy
        WHERE operator_id = $1 ORDER BY scope_type, scope_id`,
      [ops.a],
    );
  const history = () =>
    ownerRows<{ n: number }>(
      'SELECT count(*)::int AS n FROM offline_policy_history WHERE operator_id = $1',
      [ops.a],
    ).then((r) => r[0]!.n);
  const audits = () =>
    ownerRows<{ n: number }>(
      `SELECT count(*)::int AS n FROM audit_log
        WHERE operator_id = $1 AND action LIKE 'OFFLINE_POLICY_%'`,
      [ops.a],
    ).then((r) => r[0]!.n);

  it('le contrat déclare les neuf routes, et chacune a un cas dans ce balayage', () => {
    const routes = missionRoutes();
    expect(routes.map((r) => r.operationId).sort()).toEqual(Object.keys(bodies).sort());
    expect(routes).toHaveLength(9);
    expect(
      routes
        .filter((route) => !(route.operationId in bodies))
        .map((r) => `${r.method.toUpperCase()} ${r.path}`),
    ).toEqual([]);
  });

  it('sans jeton : 401 sur chaque route', async () => {
    for (const route of missionRoutes()) {
      const res = await call(route);
      expect({ route: route.operationId, status: res.status }).toEqual({
        route: route.operationId,
        status: 401,
      });
    }
  });

  it.each([
    ['OPERATOR_ADMIN de B', () => operatorB],
    ['ORGANIZER_ADMIN de B', () => organizerB],
    ['ORGANIZER_ADMIN d’un autre organisateur de A', () => otherOrganizerA],
  ])('%s : jamais 2xx sur un objet de A, rien ne fuit, rien ne change', async (_label, who) => {
    const before = { state: await state(), history: await history(), audits: await audits() };
    for (const route of missionRoutes()) {
      const res = await call(route, who().token);
      const label = route.operationId;
      // Un ORGANIZER_ADMIN du prestataire A lit son plafond (contrat) ; il ne l'écrit pas.
      if (who() === otherOrganizerA && route.operationId === 'getOfflineCeiling') {
        expect({ label, status: res.status }).toEqual({ label, status: 200 });
        continue;
      }
      const expected =
        route.operationId === 'setOfflineCeiling' && who() === otherOrganizerA ? 403 : 404;
      expect({ label, status: res.status }).toEqual({ label, status: expected });
      for (const secret of [a.org, a.event, a.device]) {
        expect(JSON.stringify(res.body)).not.toContain(secret);
      }
    }
    expect({ state: await state(), history: await history(), audits: await audits() }).toEqual(
      before,
    );
  });
});
