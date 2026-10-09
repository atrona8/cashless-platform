// Bout en bout (SC-002 à SC-005, FR-007, NFR-004, NFR-007) : amorçage du premier PLATFORM_ADMIN → OPERATOR_ADMIN →
// ORGANIZER_ADMIN → action à deux au back-office (demande, refus de l'auteur, approbation) → jeton sur place
// utilisé une fois → chaînes d'audit vérifiées, puis scellées et vérifiées de nouveau.
import { randomUUID } from 'node:crypto';
import { Body, Controller, Inject, Module, Post, Req, type INestApplication } from '@nestjs/common';
import type { Request } from 'express';
import request from 'supertest';
import { bootstrapAdmin } from '../../../../../packages/ledger-sql/src/bootstrap-admin';
import { actHash } from '../../../src/approval/onsite/act-hash';
import { consumeOnsiteApproval, RequiresOnsiteApproval } from '../../../src/approval/onsite/onsite-approval';
import { AuditService } from '../../../src/audit/audit.service';
import { Idempotent, IdempotentTransaction, type IdempotentTx } from '../../../src/idempotency/idempotent.decorator';
import { createTestApp } from '../../support/app';
import { withOwner } from '../../support/db';
import { DemoApprovalModule } from '../../support/demo-approval-action';
import { FakeIdp } from '../../support/fake-idp';

const ONSITE_PATH = '/v1/__e2e/onsite';

@Controller('__e2e')
class OnsiteE2eController {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  @Post('onsite')
  @Idempotent({ scope: 'bo:' })
  @RequiresOnsiteApproval({
    operationId: 'refundCashDue',
    role: 'ORGANIZER_ADMIN',
    scope: (req) => ({ type: 'ORGANIZER', id: String((req.body as { organizer_id: string }).organizer_id) }),
  })
  onsite(@Req() req: Request, @Body() _body: { organizer_id: string }, @IdempotentTransaction() tx: IdempotentTx) {
    return tx.run(async (client) => ({ approved_by: await consumeOnsiteApproval(client, req, this.audit) }));
  }
}

@Module({ controllers: [OnsiteE2eController] })
class OnsiteE2eModule {}

describe('parcours complet : identité, rôles, double validation, audit', () => {
  let idp: FakeIdp;
  let app: INestApplication;
  const operatorId = randomUUID();
  const organizerId = randomUUID();

  beforeAll(async () => {
    idp = await FakeIdp.create();
    await withOwner(async (db) => {
      await db.query(`INSERT INTO party (id, kind, legal_name, country_code) VALUES ($1, 'OPERATOR', 'Prestataire E2E', 'SN')`, [operatorId]);
      await db.query(`INSERT INTO party (id, kind, operator_id, legal_name, country_code) VALUES ($1, 'ORGANIZER', $2, 'Organisateur E2E', 'SN')`, [
        organizerId,
        operatorId,
      ]);
    });
    app = await createTestApp({ identity: idp, imports: [DemoApprovalModule, OnsiteE2eModule] });
  });

  afterAll(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const as = (token: string) => ({
    post: (path: string, body: object = {}, headers: Record<string, string> = {}) => {
      let req = http().post(path).set('Authorization', `Bearer ${token}`).set('Idempotency-Key', randomUUID());
      for (const [name, value] of Object.entries(headers)) req = req.set(name, value);
      return req.send(body);
    },
  });

  it('de l’amorçage à l’audit scellé', async () => {
    // 1. Amorçage (commande d'exploitation, rôle propriétaire) : idempotent.
    const adminSubject = `root-${randomUUID()}`;
    const boot = { issuer: idp.config.issuer, subject: adminSubject, name: 'Admin plateforme', email: 'root@e2e.test' };
    const created = await withOwner((db) => bootstrapAdmin(db, boot));
    expect(created.created).toBe(true);
    expect(await withOwner((db) => bootstrapAdmin(db, boot))).toEqual({ created: false, userId: created.userId });
    const admin = as(await idp.accessToken(adminSubject));

    // 2. Le PLATFORM_ADMIN crée un OPERATOR_ADMIN du prestataire.
    const person = async (by: ReturnType<typeof as>, name: string) => {
      const subject = `${name}-${randomUUID()}`;
      const res = await by.post(`/v1/operators/${operatorId}/users`, { issuer: idp.config.issuer, subject, display_name: name, email: `${name}@e2e.test` });
      expect(res.status).toBe(201);
      return { id: res.body.user_id as string, token: await idp.accessToken(subject), subject };
    };
    const opAdmin = await person(admin, 'operateur');
    expect((await admin.post(`/v1/operators/${operatorId}/users/${opAdmin.id}/role-assignments`, { role: 'OPERATOR_ADMIN', scope_type: 'OPERATOR', scope_id: operatorId })).status).toBe(201);

    // 3. L'OPERATOR_ADMIN crée deux ORGANIZER_ADMIN (rôle effectif dès la requête suivante : SC-004).
    const operator = as(opAdmin.token);
    const orgAdmin1 = await person(operator, 'organisateur1');
    const orgAdmin2 = await person(operator, 'organisateur2');
    for (const who of [orgAdmin1, orgAdmin2]) {
      const res = await operator.post(`/v1/operators/${operatorId}/users/${who.id}/role-assignments`, { role: 'ORGANIZER_ADMIN', scope_type: 'ORGANIZER', scope_id: organizerId });
      expect(res.status).toBe(201);
    }

    // 4. Action à deux : demande (202), l'auteur ne peut pas approuver (409), la seconde personne approuve (200).
    const note = `e2e-${randomUUID()}`;
    const demand = await as(orgAdmin1.token).post('/v1/__test/demo-adjustments', { organizer_id: organizerId, note });
    expect(demand.status).toBe(202);
    const id = demand.body.approval_request_id as string;
    expect((await as(orgAdmin1.token).post(`/v1/approval-requests/${id}/approve`, { approved_by: orgAdmin2.id })).status).toBe(409);
    const approved = await as(orgAdmin2.token).post(`/v1/approval-requests/${id}/approve`, { note: 'Vérifié' });
    expect(approved.status).toBe(200);
    expect(approved.body).toMatchObject({ status: 'EXECUTED', requested_by: orgAdmin1.id, decided_by: orgAdmin2.id, result: { done: true } });

    // 5. Jeton sur place : utilisé une fois, refusé la seconde.
    const payload = { organizer_id: organizerId };
    const approvalToken = await idp.approvalToken({ subject: orgAdmin2.subject, act: 'refundCashDue', actHash: actHash('POST', ONSITE_PATH, payload) });
    const first = await as(orgAdmin1.token).post(ONSITE_PATH, payload, { 'X-Approval-Token': approvalToken });
    expect(first.status).toBe(201);
    expect(first.body).toEqual({ approved_by: orgAdmin2.id });
    expect((await as(orgAdmin1.token).post(ONSITE_PATH, payload, { 'X-Approval-Token': approvalToken })).status).toBe(403);

    // 6. Audit : une ligne par action réussie (NFR-004), chaînes intactes, puis scellées et intactes (NFR-007).
    await withOwner(async (db) => {
      const { rows } = await db.query<{ action: string }>('SELECT action FROM audit_log WHERE chain_key = $1 ORDER BY seq', [operatorId]);
      expect(rows.map((r) => r.action)).toEqual([
        'USER_CREATED',
        'ROLE_GRANTED',
        'USER_CREATED',
        'USER_CREATED',
        'ROLE_GRANTED',
        'ROLE_GRANTED',
        'APPROVAL_REQUESTED',
        'APPROVAL_EXECUTED',
        'APPROVAL_TOKEN_USED',
      ]);
      const boots = await db.query(`SELECT 1 FROM audit_log WHERE action = 'PLATFORM_ADMIN_BOOTSTRAPPED' AND object_id = $1`, [created.userId]);
      expect(boots.rowCount).toBe(1);
      const problems = async (chain: string) => (await db.query('SELECT * FROM verify_audit_chain($1)', [chain])).rowCount;
      expect(await problems(operatorId)).toBe(0);
      expect(await problems('00000000-0000-0000-0000-000000000000')).toBe(0);
      const seal = await db.query<{ last_seq: string }>(`SELECT (seal_audit($1, interval '0')).last_seq::text AS last_seq`, [operatorId]);
      expect(seal.rows[0]?.last_seq).toBe('9');
      expect(await problems(operatorId)).toBe(0);
    });
  });
});
