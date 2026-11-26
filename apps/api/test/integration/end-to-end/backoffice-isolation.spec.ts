// Balayage d'isolement de la mission routes-backoffice (11b, WP05 ; interfaces.md §5, NFR-006, SC-003). Les 11
// opérations de `MISSION_11B_OPERATIONS` (liste figée, recoupée avec le contrat) sont appelées sur les objets du
// prestataire A par le personnel d'un AUTRE prestataire (B) : 403 ou 404, jamais un succès, aucune donnée de A dans
// la réponse, rien de modifié chez A ; puis sans jeton (401), avec un festivalier (refus) et avec un terminal
// (refus). Une opération SERVIE par l'application (route inscrite dans Nest, lue dans la table des routes) sans cas
// du registre fait échouer le test ; une opération pas encore servie est sautée et NOMMÉE dans la sortie.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { parse } from 'yaml';
import { createTestApp } from '../../support/app';
import { withOwner } from '../../support/db';
import { createTestCustomer, type TestCustomer } from '../../support/fake-customer';
import { createTestDevice, type TestDevice } from '../../support/fake-device';
import type { TestPerson } from '../../support/fake-idp';
import { createMediaWorld, ownerRows, type MediaWorld } from '../../support/media-fixtures';
import { MISSION_11B_OPERATIONS } from '../../support/mission-11b-operations';
import {
  loadCases,
  type BackofficeFixture,
  type BackofficeIsolationCase,
} from './backoffice-isolation-cases/registry';

jest.setTimeout(300_000);

const CONTRACT = join(__dirname, '../../../../../packages/contracts/openapi.yaml');
const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

interface ContractRoute {
  method: string;
  path: string;
}

/** Route du contrat de chaque opération de la mission (`GET /staff/me`). */
function contractRoutes(): Map<string, ContractRoute> {
  const contract = parse(readFileSync(CONTRACT, 'utf8')) as {
    paths: Record<string, Record<string, { operationId?: string }>>;
  };
  const out = new Map<string, ContractRoute>();
  for (const [path, operations] of Object.entries(contract.paths))
    for (const method of METHODS) {
      const id = operations[method]?.operationId;
      if (id) out.set(id, { method: method.toUpperCase(), path });
    }
  return out;
}

/** Forme comparable d'un chemin : `{x}` et `:x` deviennent `{}`. */
const shape = (path: string): string => path.replace(/\{[^}]+\}|:[A-Za-z_]+/g, '{}');

interface RouteLayer {
  route?: { path: string; methods: Record<string, boolean> };
}

/** Routes inscrites dans Nest (table de l'application Express), préfixe `/v1` retiré. */
function servedRoutes(app: INestApplication): Set<string> {
  const express = app.getHttpAdapter().getInstance() as {
    router?: { stack: RouteLayer[] };
    _router?: { stack: RouteLayer[] };
  };
  const stack = express.router?.stack ?? express._router?.stack ?? [];
  const out = new Set<string>();
  for (const layer of stack)
    if (layer.route)
      for (const method of Object.keys(layer.route.methods))
        out.add(`${method.toUpperCase()} ${shape(layer.route.path.replace(/^\/v1(?=\/)/, ''))}`);
  return out;
}

describe('balayage d’isolement des routes du back-office (mission 11b)', () => {
  let w: MediaWorld;
  let app: INestApplication;
  let operatorAdminB: TestPerson;
  let organizerAdminB: TestPerson;
  let supervisorB: TestPerson;
  let customerB: TestCustomer;
  let deviceB: TestDevice;
  let fx: BackofficeFixture;
  const registry = loadCases();
  const contract = contractRoutes();
  let served: Set<string>;
  const nameA = `NOM-SECRET-A-${Date.now().toString(36)}`;

  const isServed = (operationId: string): boolean => {
    const route = contract.get(operationId);
    return route !== undefined && served.has(`${route.method} ${shape(route.path)}`);
  };
  /** Détection de la mission : même règle pour toute opération du contrat, paramètres de chemin compris. */
  const servedAnywhere = isServed;
  const servedOperations = () => MISSION_11B_OPERATIONS.filter(isServed);

  beforeAll(async () => {
    w = await createMediaWorld();
    fx = { w, data: {}, secrets: [] };
    await withOwner(async (db) => {
      const person = (roles: Parameters<MediaWorld['idp']['createPerson']>[1]['roles']) =>
        w.idp.createPerson(db, { operatorId: w.ops.b, roles });
      operatorAdminB = await person([
        { role: 'OPERATOR_ADMIN', scopeType: 'OPERATOR', scopeId: w.ops.b },
      ]);
      organizerAdminB = await person([
        { role: 'ORGANIZER_ADMIN', scopeType: 'ORGANIZER', scopeId: w.ids.organizerB },
      ]);
      supervisorB = await person([
        { role: 'SUPERVISOR', scopeType: 'ORGANIZER', scopeId: w.ids.organizerB },
      ]);
      customerB = await createTestCustomer(db, w.ops.b);
      deviceB = await createTestDevice(db, { operatorId: w.ops.b });
      // Nom affiché reconnaissable des personnes de A : il ne doit jamais apparaître chez B.
      await db.query(`UPDATE app_user SET display_name = $2 WHERE operator_id = $1`, [
        w.ops.a,
        nameA,
      ]);
    });
    fx.secrets.push(
      nameA,
      w.ops.a,
      w.operatorAdminA.userId,
      w.organizerAdminA.userId,
      w.supervisorA.userId,
      w.cashierA.userId,
    );
    app = await createTestApp({ identity: w.idp });
    served = servedRoutes(app);
    for (const id of servedOperations()) await registry.cases[id]?.prepare?.(fx);
  });

  afterAll(async () => {
    await app?.close();
  });

  const send = (c: BackofficeIsolationCase, headers: Record<string, string>) => {
    const method = c.method.toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete';
    const req = request(app.getHttpServer())
      [method](`/v1${c.path(fx)}`)
      .set(headers);
    return c.method === 'GET' || c.method === 'DELETE' ? req : req.send(c.body?.(fx) ?? {});
  };
  const bearer = (person: TestPerson) => ({ Authorization: `Bearer ${person.token}` });
  const leaks = (text: string) => fx.secrets.filter((secret) => text.includes(secret));

  /** Ce qui, chez A, ne doit pas bouger pendant le balayage. */
  const stateA = async () =>
    (
      await ownerRows<Record<string, string>>(
        `SELECT (SELECT count(*) FROM audit_log WHERE operator_id = $1)::text AS audits,
                (SELECT count(*) FROM journal_transaction WHERE operator_id = $1)::text AS tx,
                (SELECT count(*) FROM app_user WHERE operator_id = $1)::text AS people,
                (SELECT count(*) FROM role_assignment r JOIN app_user u ON u.id = r.user_id
                  WHERE u.operator_id = $1 AND r.revoked_at IS NULL)::text AS roles`,
        [w.ops.a],
      )
    )[0]!;

  it('garde : 11 opérations, toutes déclarées dans le contrat, aucun cas orphelin', () => {
    expect(MISSION_11B_OPERATIONS).toHaveLength(11);
    expect(new Set(MISSION_11B_OPERATIONS).size).toBe(11);
    expect(MISSION_11B_OPERATIONS.filter((id) => !contract.has(id))).toEqual([]);
    expect(
      Object.keys(registry.cases).filter((id) => !MISSION_11B_OPERATIONS.includes(id)),
    ).toEqual([]);
    for (const [id, c] of Object.entries(registry.cases)) expect(c.operationId).toBe(id);
  });

  it('chaque opération servie a un cas ; les autres sont sautées et nommées', () => {
    const missing: string[] = [];
    for (const id of MISSION_11B_OPERATIONS) {
      if (!isServed(id)) {
        console.info(`skipped: ${id} (route non servie)`);
        continue;
      }
      if (!(id in registry.cases)) missing.push(id);
    }
    expect(missing).toEqual([]);
    // Le profil du personnel est servi par ce lot : sa détection ne doit pas être laxiste.
    expect(servedOperations()).toContain('getStaffProfile');
  });

  it('détection des routes servies : routes déjà servies à paramètre de chemin comptées servies', () => {
    for (const id of ['getMediaAdmin', 'getMediaBatch', 'getPayment']) {
      expect(contract.get(id)!.path).toMatch(/\{[^}]+\}/);
      expect({ id, served: servedAnywhere(id) }).toEqual({ id, served: true });
    }
  });

  it('personnel de B (OPERATOR_ADMIN, ORGANIZER_ADMIN, SUPERVISOR, CASHIER) : refus, jamais de donnée de A', async () => {
    const before = await stateA();
    const problems: string[] = [];
    let calls = 0;
    const callers: Array<[string, TestPerson]> = [
      ['OPERATOR_ADMIN de B', operatorAdminB],
      ['ORGANIZER_ADMIN de B', organizerAdminB],
      ['SUPERVISOR de B', supervisorB],
      ['CASHIER de B', w.cashierB],
    ];
    for (const id of servedOperations()) {
      const c = registry.cases[id];
      if (!c) continue;
      for (const [label, person] of callers) {
        const res = await send(c, bearer(person));
        calls += 1;
        const refused = res.status === 403 || res.status === 404;
        const allowed = c.selfScoped === true && res.status === 200;
        if (!refused && !allowed) problems.push(`${id} par ${label} : ${res.status}`);
        for (const secret of leaks(res.text)) problems.push(`${id} par ${label} : fuite ${secret}`);
      }
    }
    expect(problems).toEqual([]);
    expect(calls).toBeGreaterThan(0);
    expect(await stateA()).toEqual(before);
  });

  it('sans jeton : 401 ; festivalier de B : refus ; terminal de B : refus', async () => {
    const before = await stateA();
    const problems: string[] = [];
    for (const id of servedOperations()) {
      const c = registry.cases[id];
      if (!c) continue;
      const none = await send(c, {});
      if (none.status !== 401) problems.push(`${id} sans jeton : ${none.status}`);
      for (const [label, headers] of [
        ['festivalier de B', customerB.headers],
        ['terminal de B', deviceB.headers],
      ] as const) {
        const res = await send(c, headers);
        if (![401, 403].includes(res.status)) problems.push(`${id} par ${label} : ${res.status}`);
        for (const secret of leaks(res.text)) problems.push(`${id} par ${label} : fuite ${secret}`);
      }
    }
    expect(problems).toEqual([]);
    expect(await stateA()).toEqual(before);
  });

  it('témoin : le personnel de A atteint ses propres données (les refus viennent de l’isolement)', async () => {
    const c = registry.cases.getStaffProfile!;
    const res = await send(c, bearer(w.operatorAdminA));
    expect(res.status).toBe(200);
    expect(res.text).toContain(nameA);
    expect(res.text).toContain(w.ops.a);
  });
});
