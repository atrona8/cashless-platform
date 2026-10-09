// Intégration : authentification par jeton OIDC (faux serveur d'identité) et prestataire de la transaction
// (contracts/identity.md, FR-003, FR-004, NFR-002 : chaque défaut refusé).
import { randomUUID } from 'node:crypto';
import { Controller, Get, Inject, Module, Req, type INestApplication } from '@nestjs/common';
import type { Request } from 'express';
import request from 'supertest';
import { TenantTx } from '../../../src/db/tenant-tx';
import { IdentityError } from '../../../src/identity/oidc-verifier';
import { requestPrincipal } from '../../../src/identity/principal';
import { TENANT_CONTEXT, type TenantContextProvider } from '../../../src/tenancy/tenant-context';
import { createTestApp } from '../../support/app';
import { withOwner } from '../../support/db';
import { DEFECTIVE_KINDS, FakeIdp, type TestPerson } from '../../support/fake-idp';
import { createOperators, type Operators } from '../transverse/fixtures';

/** Route de test : personne authentifiée et prestataires des personnes visibles sous RLS. */
@Controller('__auth')
class WhoAmIController {
  constructor(
    private readonly tx: TenantTx,
    @Inject(TENANT_CONTEXT) private readonly tenant: TenantContextProvider,
  ) {}

  @Get('me')
  me(@Req() req: Request) {
    return this.read(req);
  }

  @Get('operators/:operator_id/me')
  meIn(@Req() req: Request) {
    return this.read(req);
  }

  private read(req: Request) {
    const principal = requestPrincipal(req);
    const { operatorId } = this.tenant.current(req);
    return this.tx.run(operatorId, async (client) => {
      const { rows } = await client.query<{ operator_id: string }>('SELECT DISTINCT operator_id FROM app_user');
      return { userId: principal.userId, operatorId, visibleOperators: rows.map((row) => row.operator_id) };
    });
  }
}

@Module({ controllers: [WhoAmIController] })
class WhoAmIModule {}

describe('authentification OIDC et prestataire de la transaction', () => {
  let idp: FakeIdp;
  let app: INestApplication;
  let ops: Operators;
  let alice: TestPerson; // prestataire A
  let bruno: TestPerson; // prestataire B
  let admin: TestPerson; // plateforme
  let disabled: TestPerson;

  beforeAll(async () => {
    idp = await FakeIdp.create();
    ops = await createOperators();
    await withOwner(async (db) => {
      alice = await idp.createPerson(db, {
        operatorId: ops.a,
        roles: [{ role: 'OPERATOR_ADMIN', scopeType: 'OPERATOR', scopeId: ops.a }],
      });
      bruno = await idp.createPerson(db, {
        operatorId: ops.b,
        roles: [{ role: 'OPERATOR_ADMIN', scopeType: 'OPERATOR', scopeId: ops.b }],
      });
      admin = await idp.createPerson(db, { operatorId: null, roles: [{ role: 'PLATFORM_ADMIN', scopeType: 'PLATFORM' }] });
      disabled = await idp.createPerson(db, { operatorId: ops.a, status: 'DISABLED' });
    });
    app = await createTestApp({ identity: idp, imports: [WhoAmIModule] });
  });

  afterAll(async () => {
    await app.close();
  });

  const get = (path: string, token?: string) => {
    const req = request(app.getHttpServer()).get(path);
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
  };

  it('santé sans jeton : 200 (seule route publique)', async () => {
    expect((await get('/v1/health')).status).toBe(200);
  });

  it('sans jeton : 401 UNAUTHENTICATED problem+json', async () => {
    const res = await get('/v1/__auth/me');
    expect(res.status).toBe(401);
    expect(res.headers['content-type']).toMatch(/^application\/problem\+json/);
    expect(JSON.parse(res.text)).toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('en-tête Authorization sans schéma Bearer : 401', async () => {
    const res = await request(app.getHttpServer()).get('/v1/__auth/me').set('Authorization', `Basic ${alice.token}`);
    expect(res.status).toBe(401);
  });

  it.each(DEFECTIVE_KINDS)('jeton défectueux « %s » : 401', async (kind) => {
    const res = await get('/v1/__auth/me', await idp.defective(kind, alice.subject));
    expect(res.status).toBe(401);
  });

  it('personne inconnue : 401', async () => {
    expect((await get('/v1/__auth/me', await idp.accessToken(`inconnu-${randomUUID()}`))).status).toBe(401);
  });

  it('personne désactivée : 401', async () => {
    expect((await get('/v1/__auth/me', disabled.token)).status).toBe(401);
  });

  it('claim operator_id différent du prestataire de la personne : 401 ; égal : 200', async () => {
    expect((await get('/v1/__auth/me', await idp.accessToken(alice.subject, { operator_id: ops.b }))).status).toBe(401);
    expect((await get('/v1/__auth/me', await idp.accessToken(alice.subject, { operator_id: ops.a }))).status).toBe(200);
  });

  it('rôles annoncés par le jeton ignorés : la personne de A reste dans A', async () => {
    const token = await idp.accessToken(alice.subject, { roles: ['PLATFORM_ADMIN'] });
    expect((await get(`/v1/__auth/operators/${ops.b}/me`, token)).status).toBe(404);
  });

  it('deux personnes de deux prestataires : chacune ne voit que le sien (RLS)', async () => {
    const a = await get('/v1/__auth/me', alice.token);
    const b = await get('/v1/__auth/me', bruno.token);
    expect(a.status).toBe(200);
    expect(a.body).toEqual({ userId: alice.userId, operatorId: ops.a, visibleOperators: [ops.a] });
    expect(b.body).toEqual({ userId: bruno.userId, operatorId: ops.b, visibleOperators: [ops.b] });
  });

  it('/operators/{le sien}/… : 200 ; /operators/{autre}/… : 404 comme un prestataire inexistant', async () => {
    expect((await get(`/v1/__auth/operators/${ops.a}/me`, alice.token)).status).toBe(200);
    const foreign = await get(`/v1/__auth/operators/${ops.b}/me`, alice.token);
    const missing = await get(`/v1/__auth/operators/${randomUUID()}/me`, alice.token);
    expect(foreign.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(JSON.parse(foreign.text).code).toBe(JSON.parse(missing.text).code);
  });

  it('PLATFORM_ADMIN : prestataire du chemin ; route sans prestataire : 403', async () => {
    const res = await get(`/v1/__auth/operators/${ops.b}/me`, admin.token);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ userId: admin.userId, operatorId: ops.b, visibleOperators: [ops.b] });
    expect((await get('/v1/__auth/me', admin.token)).status).toBe(403);
  });

  describe('clés publiques injoignables', () => {
    let down: INestApplication;

    beforeAll(async () => {
      const unavailable = () => Promise.reject(new IdentityError('UNAVAILABLE'));
      down = await createTestApp({
        identity: { verifier: () => ({ verifyAccess: unavailable, verifyApproval: unavailable }) },
        imports: [WhoAmIModule],
      });
    });

    afterAll(async () => {
      await down.close();
    });

    it('503 SERVICE_UNAVAILABLE, jamais d’acceptation', async () => {
      const res = await request(down.getHttpServer()).get('/v1/__auth/me').set('Authorization', `Bearer ${alice.token}`);
      expect(res.status).toBe(503);
      expect(JSON.parse(res.text)).toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
    });
  });
});
