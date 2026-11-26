// Matrice des rôles autorisés, `x-roles` (mission routes-backoffice, WP10 ; FR-003, FR-004, SC-002, SC-003 ; D3).
// Prouve que les rôles déclarés par `x-roles` pour CHAQUE opération du contrat sont fidèles aux contrôles réels du
// serveur : un rôle déclaré n'est jamais refusé pour droit (`403 FORBIDDEN`), un rôle non déclaré l'est. La règle de
// choix des appels et la lecture des codes 403 sont en tête de `x-roles-cases/registry.ts`.
//
// Le spec lit `openapi.yaml` (source des rôles attendus ; `roles.json` ne sert qu'à citer le fichier:ligne du contrôle),
// joue tous les cas en série, accumule TOUS les écarts avant d'échouer, et vérifie que :
//   - chaque opération du contrat a un cas, chaque cas une opération du contrat ;
//   - chaque opération portant `x-roles` a des rôles du personnel joués, sinon une raison écrite (`external`) ;
//   - les opérations SANS `x-roles` sont exactement celles des doutes acceptés, et elles ne sont pas servies ;
//   - les 11 opérations de la mission sont servies et ont leur cas d'isolement.
// La suite est longue et partage la base : à lancer seule, en série (`jest.config.cjs`, `ledger-tests.yml`).
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { parse } from 'yaml';
import { bodyOf } from './x-roles-cases/schema-body';
import { MISSION_11B_OPERATIONS } from '../../support/mission-11b-operations';
import { loadCases as loadIsolationCases } from './backoffice-isolation-cases/registry';
import {
  loadCases,
  STAFF_ROLES,
  type CaseMethod,
  type PreparedCall,
  type StaffRole,
  type XRolesCase,
} from './x-roles-cases/registry';
import { createXRolesWorld, type XRolesWorld } from './x-roles-cases/world';

jest.setTimeout(900_000);

const ROOT = join(__dirname, '../../../../..');
const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;
const NON_STAFF = ['DEVICE', 'VENDOR', 'CUSTOMER', 'GATEWAY', 'PUBLIC'];

interface ContractOperation {
  operationId: string;
  method: CaseMethod;
  path: string;
  roles: string[] | undefined;
}

function contractOperations(): ContractOperation[] {
  const doc = parse(readFileSync(join(ROOT, 'packages/contracts/openapi.yaml'), 'utf8')) as {
    paths: Record<string, Record<string, { operationId?: string; 'x-roles'?: string[] }>>;
  };
  const out: ContractOperation[] = [];
  for (const [path, operations] of Object.entries(doc.paths))
    for (const method of METHODS) {
      const op = operations[method];
      if (op?.operationId)
        out.push({
          operationId: op.operationId,
          method: method.toUpperCase() as CaseMethod,
          path,
          roles: op['x-roles'],
        });
    }
  return out;
}

/** `source` (fichier:ligne du contrôle) et doute de chaque opération, d'après `roles.json` (WP04). */
function sourcesOf(): Record<string, { source?: string; doubt?: boolean }> {
  const table = JSON.parse(
    readFileSync(join(ROOT, 'tools/contract-stability/x-roles/roles.json'), 'utf8'),
  ) as { operations: Record<string, { source?: string; doubt?: boolean }> };
  return table.operations;
}

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

describe('x-roles : les rôles déclarés sont les rôles réellement admis (FR-003, FR-004, SC-002)', () => {
  const contractDoc = parse(
    readFileSync(join(ROOT, 'packages/contracts/openapi.yaml'), 'utf8'),
  ) as Parameters<typeof bodyOf>[0];
  const operations = contractOperations();
  const sources = sourcesOf();
  const registry = loadCases();
  let world: XRolesWorld;
  let servedApi: Set<string>;
  let servedPersonalization: Set<string>;
  /** Appels joués et preuves faibles, repris par WP11 (durée, nombre d'appels). */
  const stats = {
    calls: 0,
    probes: 0,
    weak: [] as string[],
    partial: [] as string[],
    unplayable: [] as string[],
  };

  beforeAll(async () => {
    world = await createXRolesWorld();
    servedApi = servedRoutes(world.api);
    servedPersonalization = servedRoutes(world.personalization.app);
  });
  afterAll(async () => {
    await world?.close();
  });

  const isServed = (op: ContractOperation, c: XRolesCase): boolean =>
    (c.server === 'personalization' ? servedPersonalization : servedApi).has(
      `${op.method} ${shape(op.path)}`,
    );

  /** Appel par défaut : chemin du contrat, paramètres tirés de `fx.ids`, corps `{}`. */
  const defaultCall = (op: ContractOperation, c?: XRolesCase): PreparedCall => ({
    method: op.method,
    path: op.path.replace(/\{([a-z_]+)\}/g, (_, name: string) => world.ids[name] ?? randomUUID()),
    body: c?.validBody ? bodyOf(contractDoc, op.path, op.method) : {},
  });

  const send = async (
    c: XRolesCase,
    call: PreparedCall,
    token: string | null,
    role?: StaffRole,
  ): Promise<{ status: number; code: string | undefined; detail?: string; body?: unknown }> => {
    const app = c.server === 'personalization' ? world.personalization.app : world.api;
    const method = call.method.toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete';
    let req = request(app.getHttpServer())[method](`/v1${call.path}`);
    const write = call.method !== 'GET';
    const person = token === null ? {} : { Authorization: `Bearer ${token}` };
    const viaDevice = typeof c.device === 'function' ? c.device(role!) : c.device === true;
    if (viaDevice) {
      const terminal = call.terminal === 'other' ? world.cash.other : world.cash.device;
      req = req
        .set(terminal.headers)
        .set(token === null ? {} : { 'X-Staff-Authorization': `Bearer ${token}` })
        .set('Idempotency-Key', world.cash.seqKey(terminal));
    } else {
      req = req.set(person);
      if (write) req = req.set('Idempotency-Key', randomUUID());
    }
    req = req.set(call.headers ?? {});
    const res =
      call.method === 'GET' || call.method === 'DELETE'
        ? await req
        : await req.send(call.body ?? {});
    stats.calls += 1;
    const body = res.body as { code?: string; detail?: string } | undefined;
    return { status: res.status, code: body?.code, detail: body?.detail, body: res.body };
  };

  /** Refus POUR DROIT : `403 FORBIDDEN` du catalogue (corps lu), ou un statut que le cas déclare avec sa raison. */
  const refusedForRight = (c: XRolesCase, r: { status: number; code?: string }): boolean =>
    (r.status === 403 && r.code === 'FORBIDDEN') || (c.refusals ?? []).includes(r.status);

  it('chaque opération du contrat a un cas, chaque cas une opération du contrat', () => {
    const ids = new Set(operations.map((o) => o.operationId));
    const missing = operations
      .filter((o) => !registry.cases[o.operationId])
      .map((o) => o.operationId);
    const orphan = Object.keys(registry.cases).filter((id) => !ids.has(id));
    expect({ missing, orphan }).toEqual({ missing: [], orphan: [] });
  });

  it('x-roles : présent sur toute opération, sauf les doutes acceptés, qui ne sont pas servis', () => {
    const problems: string[] = [];
    for (const op of operations) {
      const c = registry.cases[op.operationId];
      if (!c) continue;
      const doubt = sources[op.operationId]?.doubt === true;
      if (doubt) {
        if (op.roles !== undefined) problems.push(`${op.operationId} : douteuse mais annotée`);
        if (isServed(op, c))
          problems.push(
            `${op.operationId} : servie par l'application, à sortir des doutes (DOUBTS_ACCEPTED)`,
          );
        if (!c.external)
          problems.push(`${op.operationId} : douteuse, le cas doit porter \`external\``);
        continue;
      }
      if (!Array.isArray(op.roles) || op.roles.length === 0)
        problems.push(`${op.operationId} : x-roles absent ou vide`);
      const staff = (op.roles ?? []).filter((r) => (STAFF_ROLES as readonly string[]).includes(r));
      if (staff.length === 0 && !c.external)
        problems.push(
          `${op.operationId} : aucun rôle du personnel déclaré, raison (\`external\`) absente`,
        );
      if (staff.length > 0 && c.external)
        problems.push(
          `${op.operationId} : rôles du personnel déclarés mais cas marqué \`external\``,
        );
      if (staff.length > 0 && !isServed(op, c))
        problems.push(`${op.operationId} : rôles du personnel déclarés, route non servie`);
    }
    expect(problems).toEqual([]);
  });

  it('les 11 opérations de la mission sont servies et ont leur cas d’isolement', () => {
    const isolation = loadIsolationCases();
    const problems: string[] = [];
    for (const id of MISSION_11B_OPERATIONS) {
      const op = operations.find((o) => o.operationId === id);
      const c = registry.cases[id];
      if (!op || !c) problems.push(`${id} : absente du contrat ou sans cas x-roles`);
      else if (!isServed(op, c)) problems.push(`${id} : non servie par l'application`);
      if (!isolation.cases[id]) problems.push(`${id} : sans cas dans backoffice-isolation-cases`);
    }
    expect(problems).toEqual([]);
  });

  it('chaque rôle du personnel : déclaré, jamais refusé pour droit ; non déclaré, refusé', async () => {
    const problems: string[] = [];
    for (const op of operations) {
      const c = registry.cases[op.operationId];
      if (!c || c.external || !op.roles) continue;
      if (c.unplayable) {
        stats.unplayable.push(op.operationId);
        continue;
      }
      const where = `${op.operationId} (${op.method} ${op.path}) [${sources[op.operationId]?.source ?? '?'}]`;
      let declaredReached = false;
      for (const role of STAFF_ROLES) {
        const declared = op.roles.includes(role);
        const call = c.prepare ? await c.prepare(world, role) : defaultCall(op, c);
        if (c.prepare && call.body === undefined && c.validBody)
          call.body = bodyOf(contractDoc, op.path, op.method);
        const r = await send(c, call, world.people[role].token, role);
        if (declared && c.conditionalRoles?.includes(role)) continue;
        if (declared) {
          if (r.status === 403 && r.code === 'FORBIDDEN')
            problems.push(
              `${where} : rôle déclaré ${role} refusé pour droit (403 FORBIDDEN ${r.detail ?? ''})`,
            );
          else if (r.status === 401 || r.status >= 500)
            problems.push(`${where} : rôle déclaré ${role} : ${r.status} ${r.code ?? ''}`);
          else if (r.status < 300) declaredReached = true;
        } else if (c.emptyForUndeclared) {
          const items = (r.body as { data?: unknown[] } | undefined)?.data;
          if (r.status !== 200 || !Array.isArray(items) || items.length !== 0)
            problems.push(
              `${where} : rôle NON déclaré ${role} : liste vide attendue (obtenu ${r.status})`,
            );
        } else if (c.partial !== undefined) {
          if (r.status < 400 || r.status >= 500)
            problems.push(
              `${where} : rôle NON déclaré ${role} réussi ou en erreur serveur (${r.status}), preuve partielle`,
            );
          else stats.partial.push(`${op.operationId}:${role}`);
        } else if (!refusedForRight(c, r)) {
          problems.push(
            `${where} : rôle NON déclaré ${role} non refusé (obtenu ${r.status} ${r.code ?? ''} ${r.detail ?? ''})`,
          );
        }
      }
      if (!declaredReached) stats.weak.push(op.operationId);
    }
    console.info(
      `x-roles : ${stats.calls} appels joués ; ${stats.weak.length} opérations dont aucun rôle déclaré n'a abouti (2xx) : ${stats.weak.join(', ')} ; non jouables : ${stats.unplayable.join(', ')} ; preuves partielles : ${[...new Set(stats.partial.map((p) => p.split(':')[0]))].join(', ')}`,
    );
    expect(problems).toEqual([]);
  });

  it('routes sans rôle du personnel : le personnel n’y réussit jamais (sonde)', async () => {
    const problems: string[] = [];
    for (const op of operations) {
      const c = registry.cases[op.operationId];
      if (!c?.external || !op.roles || op.roles.includes('PUBLIC')) continue;
      if (!isServed(op, c)) continue;
      const staffOnly = op.roles.every((r) => NON_STAFF.includes(r));
      if (!staffOnly) continue;
      for (const role of ['OPERATOR_ADMIN', 'CASHIER'] as StaffRole[]) {
        const r = await send({ ...c, device: false }, defaultCall(op), world.people[role].token);
        stats.probes += 1;
        if (r.status < 400 || r.status >= 500)
          problems.push(
            `${op.operationId} : ${role} non refusé sur une route sans rôle du personnel (${r.status})`,
          );
      }
    }
    expect(problems).toEqual([]);
  });
});
