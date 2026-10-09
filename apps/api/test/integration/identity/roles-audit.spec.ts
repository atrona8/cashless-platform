// Intégration : `@Roles` sur une portée de chemin (FR-005) et lignes d'audit écrites dans la transaction de
// l'action (FR-008, NFR-004), avec le faux serveur d'identité.
import { randomUUID } from 'node:crypto';
import { Controller, Get, HttpCode, Inject, Module, Param, Post, Query, Req, type INestApplication } from '@nestjs/common';
import type { Request } from 'express';
import request from 'supertest';
import { auditContext } from '../../../src/audit/audit-context';
import { AuditService } from '../../../src/audit/audit.service';
import { TenantTx } from '../../../src/db/tenant-tx';
import { Roles } from '../../../src/identity/roles.decorator';
import { TENANT_CONTEXT, type TenantContextProvider } from '../../../src/tenancy/tenant-context';
import { createTestApp } from '../../support/app';
import { withOwner } from '../../support/db';
import { FakeIdp, type TestPerson } from '../../support/fake-idp';
import { createOperators, type Operators } from '../transverse/fixtures';

const organizerOfPath = (req: Request) => ({ type: 'ORGANIZER' as const, id: String(req.params.organizer_id) });

@Controller('__roles')
class RolesTestController {
  constructor(
    private readonly tx: TenantTx,
    private readonly audit: AuditService,
    @Inject(TENANT_CONTEXT) private readonly tenant: TenantContextProvider,
  ) {}

  @Get('organizers/:organizer_id')
  @Roles(['ORGANIZER_ADMIN', 'OPERATOR_ADMIN'], organizerOfPath)
  read(@Req() req: Request, @Param('organizer_id') organizerId: string) {
    return { organizerId, exercisedRole: auditContext(req).actorRole };
  }

  /** Écrit une note et son audit dans la même transaction ; `fail=1` : échec après l'audit. */
  @Post('organizers/:organizer_id/notes')
  @HttpCode(201)
  @Roles(['ORGANIZER_ADMIN'], organizerOfPath)
  write(@Req() req: Request, @Param('organizer_id') organizerId: string, @Query('fail') fail?: string) {
    const { operatorId } = this.tenant.current(req);
    return this.tx.run(operatorId, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO config_version (operator_id, scope_type, scope_id, version, valid_from, settings)
         VALUES ($1, 'ORGANIZER', $2, 1 + (SELECT count(*) FROM config_version WHERE scope_id = $2), now(), '{}')
         RETURNING id`,
        [operatorId, organizerId],
      );
      await this.audit.record(client, {
        ...auditContext(req),
        operatorId,
        action: 'ROLE_GRANTED',
        objectType: 'config_version',
        objectId: rows[0]!.id,
        after: { organizerId, amount: 10n },
      });
      if (fail === '1') throw new Error('panne simulée après audit');
      return { id: rows[0]!.id };
    });
  }
}

@Module({ controllers: [RolesTestController] })
class RolesTestModule {}

describe('rôles, portées et audit', () => {
  let idp: FakeIdp;
  let app: INestApplication;
  let ops: Operators;
  const org = { a1: randomUUID(), a2: randomUUID(), b1: randomUUID() };
  let admin1: TestPerson; // ORGANIZER_ADMIN de a1
  let admin2: TestPerson; // ORGANIZER_ADMIN de a2 (même prestataire)
  let adminB: TestPerson; // ORGANIZER_ADMIN de b1 (autre prestataire)
  let operatorAdmin: TestPerson; // OPERATOR_ADMIN de A
  let revoked: TestPerson; // ORGANIZER_ADMIN de a1, retiré

  beforeAll(async () => {
    idp = await FakeIdp.create();
    ops = await createOperators();
    await withOwner(async (db) => {
      await db.query(
        `INSERT INTO party (id, kind, operator_id, legal_name, country_code) VALUES
           ($1, 'ORGANIZER', $4, 'Organisateur A1', 'SN'), ($2, 'ORGANIZER', $4, 'Organisateur A2', 'SN'),
           ($3, 'ORGANIZER', $5, 'Organisateur B1', 'CI')`,
        [org.a1, org.a2, org.b1, ops.a, ops.b],
      );
      const organizerAdmin = (operatorId: string, organizerId: string) =>
        idp.createPerson(db, { operatorId, roles: [{ role: 'ORGANIZER_ADMIN', scopeType: 'ORGANIZER', scopeId: organizerId }] });
      admin1 = await organizerAdmin(ops.a, org.a1);
      admin2 = await organizerAdmin(ops.a, org.a2);
      adminB = await organizerAdmin(ops.b, org.b1);
      revoked = await organizerAdmin(ops.a, org.a1);
      operatorAdmin = await idp.createPerson(db, {
        operatorId: ops.a,
        roles: [{ role: 'OPERATOR_ADMIN', scopeType: 'OPERATOR', scopeId: ops.a }],
      });
      await db.query(
        `UPDATE role_assignment SET revoked_at = clock_timestamp(), revoked_by = $2 WHERE user_id = $1`,
        [revoked.userId, operatorAdmin.userId],
      );
    });
    app = await createTestApp({ identity: idp, imports: [RolesTestModule] });
  });

  afterAll(async () => {
    await app.close();
  });

  const get = (person: TestPerson, organizerId: string) =>
    request(app.getHttpServer()).get(`/v1/__roles/organizers/${organizerId}`).set('Authorization', `Bearer ${person.token}`);

  it('administrateur de cet organisateur : 200', async () => {
    expect((await get(admin1, org.a1)).status).toBe(200);
  });

  it('administrateur d’un autre organisateur du même prestataire : 403 FORBIDDEN', async () => {
    const res = await get(admin2, org.a1);
    expect(res.status).toBe(403);
    expect(JSON.parse(res.text).code).toBe('FORBIDDEN');
  });

  it('organisateur d’un autre prestataire : 404, comme un organisateur inexistant', async () => {
    expect((await get(adminB, org.a1)).status).toBe(404);
    expect((await get(adminB, randomUUID())).status).toBe(404);
  });

  it('OPERATOR_ADMIN du prestataire : 200 par englobement (portée prestataire ⊃ organisateur)', async () => {
    const res = await get(operatorAdmin, org.a1);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ organizerId: org.a1, exercisedRole: 'OPERATOR_ADMIN' });
    expect((await get(admin1, org.a1)).body.exercisedRole).toBe('ORGANIZER_ADMIN');
  });

  it('rôle non demandé par la route : 403 (OPERATOR_ADMIN sur une route ORGANIZER_ADMIN seul)', async () => {
    const res = await request(app.getHttpServer())
      .post(`/v1/__roles/organizers/${org.a1}/notes`)
      .set('Authorization', `Bearer ${operatorAdmin.token}`);
    expect(res.status).toBe(403);
  });

  it('attribution retirée : 403', async () => {
    expect((await get(revoked, org.a1)).status).toBe(403);
  });

  const auditRows = (requestId: string) =>
    withOwner(async (db) => {
      const { rows } = await db.query<{
        actor_id: string;
        actor_role: string;
        action: string;
        request_id: string;
        origin: string | null;
        after: Record<string, unknown>;
        seq: string;
        prev_hash: Buffer;
        prev_row_hash: Buffer | null;
      }>(
        `SELECT l.actor_id, l.actor_role, l.action, l.request_id, l.origin, l.after, l.seq::text, l.prev_hash,
                (SELECT p.row_hash FROM audit_log p WHERE p.chain_key = l.chain_key AND p.seq = l.seq - 1) AS prev_row_hash
           FROM audit_log l WHERE l.request_id = $1`,
        [requestId],
      );
      return rows;
    });

  it('action réussie : une ligne d’audit (acteur, rôle exercé, X-Request-Id, origine), chaînée', async () => {
    const requestId = randomUUID();
    const res = await request(app.getHttpServer())
      .post(`/v1/__roles/organizers/${org.a1}/notes`)
      .set('Authorization', `Bearer ${admin1.token}`)
      .set('X-Request-Id', requestId);
    expect(res.status).toBe(201);
    const rows = await auditRows(requestId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actor_id: admin1.userId,
      actor_role: 'ORGANIZER_ADMIN',
      action: 'ROLE_GRANTED',
      request_id: requestId,
      after: { organizerId: org.a1, amount: '10' },
    });
    expect(rows[0]!.origin).toEqual(expect.any(String));
    // Seconde action : chaînée sur la première.
    const second = randomUUID();
    await request(app.getHttpServer())
      .post(`/v1/__roles/organizers/${org.a1}/notes`)
      .set('Authorization', `Bearer ${admin1.token}`)
      .set('X-Request-Id', second);
    const [next] = await auditRows(second);
    expect(Number(next!.seq)).toBeGreaterThan(Number(rows[0]!.seq));
    expect(next!.prev_hash.equals(next!.prev_row_hash!)).toBe(true);
  });

  it('action en échec : aucune ligne d’audit (même transaction)', async () => {
    const requestId = randomUUID();
    const stderr = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const res = await request(app.getHttpServer())
        .post(`/v1/__roles/organizers/${org.a1}/notes?fail=1`)
        .set('Authorization', `Bearer ${admin1.token}`)
        .set('X-Request-Id', requestId);
      expect(res.status).toBe(500);
    } finally {
      stderr.mockRestore();
    }
    expect(await auditRows(requestId)).toHaveLength(0);
  });

  it('accès refusé : aucune ligne d’audit', async () => {
    const requestId = randomUUID();
    const res = await request(app.getHttpServer())
      .post(`/v1/__roles/organizers/${org.a1}/notes`)
      .set('Authorization', `Bearer ${admin2.token}`)
      .set('X-Request-Id', requestId);
    expect(res.status).toBe(403);
    expect(await auditRows(requestId)).toHaveLength(0);
  });
});
