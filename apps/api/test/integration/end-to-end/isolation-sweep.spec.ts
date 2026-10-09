// Balayage d'isolation (SC-001, NFR-001) : chaque route ajoutée au contrat par la mission (chemins `/operators/…`,
// `/platform-admins`, `/approval-requests…`, lus dans openapi.yaml) est appelée par une personne du prestataire B
// sur les objets du prestataire A (jamais 2xx sur un objet de A), puis sans jeton (401). Une route du contrat sans
// cas dans ce fichier fait échouer le test.
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { parse } from 'yaml';
import { createTestApp } from '../../support/app';
import { withOwner } from '../../support/db';
import { DemoApprovalModule } from '../../support/demo-approval-action';
import { FakeIdp, type TestPerson } from '../../support/fake-idp';
import { createOperators, type Operators } from '../transverse/fixtures';

const CONTRACT = join(__dirname, '../../../../../packages/contracts/openapi.yaml');
const MISSION_PATHS = /^\/(operators\/|platform-admins$|approval-requests)/;

interface Route {
  method: 'get' | 'post';
  path: string;
  operationId: string;
}

/** Routes de la mission, lues dans le contrat (jamais une liste en dur). */
function missionRoutes(): Route[] {
  const contract = parse(readFileSync(CONTRACT, 'utf8')) as { paths: Record<string, Record<string, { operationId?: string }>> };
  return Object.entries(contract.paths)
    .filter(([path]) => MISSION_PATHS.test(path))
    .flatMap(([path, operations]) =>
      (['get', 'post'] as const)
        .filter((method) => operations[method])
        .map((method) => ({ method, path, operationId: operations[method]!.operationId! })),
    );
}

describe('balayage d’isolation des routes de la mission', () => {
  let idp: FakeIdp;
  let app: INestApplication;
  let ops: Operators;
  const organizerA = randomUUID();
  const organizerB = randomUUID();
  let authorA: TestPerson;
  let intruderOperator: TestPerson; // OPERATOR_ADMIN de B
  let intruderOrganizer: TestPerson; // ORGANIZER_ADMIN de B
  const objects = { user: '', assignment: '', approval: '' };

  /** Corps valides par opération : le refus vient de l'isolation, pas de la validation. */
  const bodies: Record<string, () => object> = {
    listUsers: () => ({}),
    createUser: () => ({ issuer: idp.config.issuer, subject: `intrus-${randomUUID()}`, display_name: 'Intrus', email: 'intrus@test.local' }),
    getUser: () => ({}),
    disableUser: () => ({}),
    grantRole: () => ({ role: 'CASHIER', scope_type: 'ORGANIZER', scope_id: organizerA }),
    revokeRole: () => ({}),
    createPlatformAdmin: () => ({ issuer: idp.config.issuer, subject: `intrus-${randomUUID()}`, display_name: 'Intrus', email: 'intrus@test.local' }),
    listApprovalRequests: () => ({}),
    getApprovalRequest: () => ({}),
    approveApprovalRequest: () => ({ note: 'Intrus' }),
    rejectApprovalRequest: () => ({ note: 'Refus par un intrus' }),
  };

  beforeAll(async () => {
    idp = await FakeIdp.create();
    ops = await createOperators();
    await withOwner(async (db) => {
      await db.query(
        `INSERT INTO party (id, kind, operator_id, legal_name, country_code) VALUES
           ($1, 'ORGANIZER', $3, 'Org A', 'SN'), ($2, 'ORGANIZER', $4, 'Org B', 'CI')`,
        [organizerA, organizerB, ops.a, ops.b],
      );
      authorA = await idp.createPerson(db, { operatorId: ops.a, roles: [{ role: 'ORGANIZER_ADMIN', scopeType: 'ORGANIZER', scopeId: organizerA }] });
      intruderOperator = await idp.createPerson(db, { operatorId: ops.b, roles: [{ role: 'OPERATOR_ADMIN', scopeType: 'OPERATOR', scopeId: ops.b }] });
      intruderOrganizer = await idp.createPerson(db, { operatorId: ops.b, roles: [{ role: 'ORGANIZER_ADMIN', scopeType: 'ORGANIZER', scopeId: organizerB }] });
      objects.user = authorA.userId;
      const { rows } = await db.query<{ id: string }>('SELECT id FROM role_assignment WHERE user_id = $1', [authorA.userId]);
      objects.assignment = rows[0]!.id;
    });
    app = await createTestApp({ identity: idp, imports: [DemoApprovalModule] });
    const demand = await request(app.getHttpServer())
      .post('/v1/__test/demo-adjustments')
      .set('Authorization', `Bearer ${authorA.token}`)
      .set('Idempotency-Key', randomUUID())
      .send({ organizer_id: organizerA, note: `balayage-${randomUUID()}` });
    expect(demand.status).toBe(202);
    objects.approval = demand.body.approval_request_id;
  });

  afterAll(async () => {
    await app.close();
  });

  const url = (path: string) =>
    `/v1${path
      .replace('{operator_id}', ops.a)
      .replace('{user_id}', objects.user)
      .replace('{assignment_id}', objects.assignment)
      .replace('{approval_request_id}', objects.approval)}`;
  const call = (route: Route, token?: string) => {
    let req = route.method === 'get' ? request(app.getHttpServer()).get(url(route.path)) : request(app.getHttpServer()).post(url(route.path));
    if (token) req = req.set('Authorization', `Bearer ${token}`);
    req = req.set('Idempotency-Key', randomUUID());
    return route.method === 'get' ? req : req.send(bodies[route.operationId]!());
  };

  it('le contrat déclare les routes attendues, et chacune a un cas dans ce balayage', () => {
    const routes = missionRoutes();
    expect(routes.length).toBeGreaterThanOrEqual(11);
    expect(routes.filter((route) => !(route.operationId in bodies)).map((r) => `${r.method.toUpperCase()} ${r.path}`)).toEqual([]);
  });

  it('sans jeton : 401 sur chaque route', async () => {
    for (const route of missionRoutes()) {
      const res = await call(route);
      expect({ route: `${route.method} ${route.path}`, status: res.status }).toEqual({ route: `${route.method} ${route.path}`, status: 401 });
    }
  });

  it.each([
    ['OPERATOR_ADMIN de B', () => intruderOperator],
    ['ORGANIZER_ADMIN de B', () => intruderOrganizer],
  ])('%s : jamais 2xx sur un objet de A, et rien ne fuit', async (_label, who) => {
    for (const route of missionRoutes()) {
      const res = await call(route, who().token);
      const label = `${route.method.toUpperCase()} ${route.path}`;
      if (route.operationId === 'listApprovalRequests') {
        // Route sans objet de A : la liste de B ne contient aucune demande de A.
        expect({ label, status: res.status }).toEqual({ label, status: 200 });
        expect(res.body.data.map((r: { approval_request_id: string }) => r.approval_request_id)).not.toContain(objects.approval);
        continue;
      }
      expect({ label, refused: [403, 404].includes(res.status) }).toEqual({ label, refused: true });
    }
  });

  it('après le balayage, les objets de A sont intacts', async () => {
    await withOwner(async (db) => {
      const user = await db.query<{ status: string }>('SELECT status FROM app_user WHERE id = $1', [objects.user]);
      const assignment = await db.query<{ revoked_at: Date | null }>('SELECT revoked_at FROM role_assignment WHERE id = $1', [objects.assignment]);
      const approval = await db.query<{ status: string }>('SELECT status FROM approval_request WHERE id = $1', [objects.approval]);
      const intruders = await db.query(`SELECT 1 FROM app_user WHERE display_name = 'Intrus'`);
      expect(user.rows[0]?.status).toBe('ACTIVE');
      expect(assignment.rows[0]?.revoked_at).toBeNull();
      expect(approval.rows[0]?.status).toBe('PENDING');
      expect(intruders.rowCount).toBe(0);
    });
  });
});
