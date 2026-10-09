// Intégration : jeton d'approbation sur place (FR-013, FR-014, NFR-003, contracts/approvals.md) — chaque ligne du
// tableau des refus, consommation unique dans la transaction métier, audit.
import { randomUUID } from 'node:crypto';
import { Body, Controller, Inject, Module, Post, Req, type INestApplication } from '@nestjs/common';
import type { Request } from 'express';
import request from 'supertest';
import { actHash } from '../../../src/approval/onsite/act-hash';
import { consumeOnsiteApproval, RequiresOnsiteApproval } from '../../../src/approval/onsite/onsite-approval';
import { AuditService } from '../../../src/audit/audit.service';
import { Idempotent, IdempotentTransaction, type IdempotentTx } from '../../../src/idempotency/idempotent.decorator';
import { createTestApp } from '../../support/app';
import { withOwner } from '../../support/db';
import { FakeIdp, type TestPerson } from '../../support/fake-idp';
import { createOperators, type Operators } from '../transverse/fixtures';

const PATH = '/v1/__test/onsite-refunds';

interface RefundBody {
  organizer_id: string;
  note: string;
  approved_by?: string;
}

/** Remboursement en espèces de démonstration : ligne témoin avec le valideur (jamais lu dans le corps). */
@Controller('__test')
class OnsiteRefundController {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  @Post('onsite-refunds')
  @Idempotent({ scope: 'bo:' })
  @RequiresOnsiteApproval({
    operationId: 'refundCashDue',
    role: 'SUPERVISOR',
    scope: (req) => ({ type: 'ORGANIZER', id: String((req.body as RefundBody).organizer_id) }),
  })
  refund(@Req() req: Request, @Body() body: RefundBody, @IdempotentTransaction() tx: IdempotentTx) {
    return tx.run(async (client) => {
      const approvedBy = await consumeOnsiteApproval(client, req, this.audit);
      await client.query(
        `INSERT INTO config_version (operator_id, scope_type, scope_id, version, valid_from, settings)
         VALUES (current_setting('app.operator_id')::uuid, 'ORGANIZER', $1,
                 1 + (SELECT count(*) FROM config_version WHERE scope_id = $1), now(),
                 jsonb_build_object('note', $2::text, 'approved_by', $3::text))`,
        [body.organizer_id, body.note, approvedBy],
      );
      return { approved_by: approvedBy };
    });
  }
}

@Module({ controllers: [OnsiteRefundController] })
class OnsiteTestModule {}

describe('jeton d’approbation sur place', () => {
  let idp: FakeIdp;
  let otherIdp: FakeIdp; // même émetteur, autre clé : signature invalide
  let app: INestApplication;
  let ops: Operators;
  const organizer = randomUUID();
  const organizerB = randomUUID();
  let cashier: TestPerson; // appelant
  let supervisor: TestPerson; // valideur correct
  let cashier2: TestPerson; // sans le rôle SUPERVISOR
  let supervisorB: TestPerson; // autre prestataire
  let disabledSupervisor: TestPerson;

  beforeAll(async () => {
    idp = await FakeIdp.create();
    otherIdp = await FakeIdp.create();
    ops = await createOperators();
    await withOwner(async (db) => {
      await db.query(
        `INSERT INTO party (id, kind, operator_id, legal_name, country_code) VALUES
           ($1, 'ORGANIZER', $3, 'Org A', 'SN'), ($2, 'ORGANIZER', $4, 'Org B', 'CI')`,
        [organizer, organizerB, ops.a, ops.b],
      );
      const make = (operatorId: string, scopeId: string, role: 'CASHIER' | 'SUPERVISOR', status?: 'ACTIVE' | 'DISABLED') =>
        idp.createPerson(db, { operatorId, status, roles: [{ role, scopeType: 'ORGANIZER', scopeId }] });
      cashier = await make(ops.a, organizer, 'CASHIER');
      supervisor = await make(ops.a, organizer, 'SUPERVISOR');
      cashier2 = await make(ops.a, organizer, 'CASHIER');
      supervisorB = await make(ops.b, organizerB, 'SUPERVISOR');
      disabledSupervisor = await make(ops.a, organizer, 'SUPERVISOR', 'DISABLED');
    });
    app = await createTestApp({ identity: idp, imports: [OnsiteTestModule] });
  });

  afterAll(async () => {
    await app.close();
  });

  const body = (note = `refund-${randomUUID()}`): RefundBody => ({ organizer_id: organizer, note });
  const tokenFor = (who: TestPerson, payload: object, overrides: { act?: string; jti?: string; ttlSeconds?: number; issuer?: FakeIdp } = {}) =>
    (overrides.issuer ?? idp).approvalToken({
      subject: who.subject,
      act: overrides.act ?? 'refundCashDue',
      actHash: actHash('POST', PATH, payload),
      jti: overrides.jti,
      ttlSeconds: overrides.ttlSeconds,
    });
  const send = (payload: object, token?: string, key: string = randomUUID()) => {
    const req = request(app.getHttpServer()).post(PATH).set('Authorization', `Bearer ${cashier.token}`).set('Idempotency-Key', key);
    return (token ? req.set('X-Approval-Token', token) : req).send(payload);
  };
  const code = (res: request.Response) => (JSON.parse(res.text) as { code?: string }).code;
  const uses = (jti: string) =>
    withOwner(async (db) => (await db.query('SELECT 1 FROM approval_token_use WHERE jti = $1', [jti])).rowCount);
  const witnesses = (note: string) =>
    withOwner(async (db) => {
      const { rows } = await db.query<{ approved_by: string }>(`SELECT settings->>'approved_by' AS approved_by FROM config_version WHERE settings->>'note' = $1`, [note]);
      return rows;
    });

  it('sans jeton : 403 APPROVAL_REQUIRED', async () => {
    const res = await send(body());
    expect(res.status).toBe(403);
    expect(code(res)).toBe('APPROVAL_REQUIRED');
  });

  it('jeton valide : 201, valideur = sujet du jeton (approved_by du corps ignoré), consommation et audit uniques', async () => {
    const jti = randomUUID();
    const payload = { ...body(), approved_by: cashier.userId };
    const res = await send(payload, await tokenFor(supervisor, payload, { jti }));
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ approved_by: supervisor.userId });
    expect(await witnesses(payload.note)).toEqual([{ approved_by: supervisor.userId }]);
    expect(await uses(jti)).toBe(1);
    const auditRows = await withOwner(async (db) => {
      const { rows } = await db.query<{ actor_id: string; approver_id: string }>(
        `SELECT actor_id, approver_id FROM audit_log WHERE action = 'APPROVAL_TOKEN_USED' AND object_id = $1`,
        [jti],
      );
      return rows;
    });
    expect(auditRows).toEqual([{ actor_id: cashier.userId, approver_id: supervisor.userId }]);
  });

  it('même jeton rejoué avec une autre clé d’idempotence : 403 APPROVAL_INVALID, rien d’écrit', async () => {
    const jti = randomUUID();
    const payload = body();
    const token = await tokenFor(supervisor, payload, { jti });
    expect((await send(payload, token)).status).toBe(201);
    const replay = await send(payload, token);
    expect(replay.status).toBe(403);
    expect(code(replay)).toBe('APPROVAL_INVALID');
    expect(await witnesses(payload.note)).toHaveLength(1);
    expect(await uses(jti)).toBe(1);
  });

  it('même clé d’idempotence : rejeu de la réponse, pas de seconde consommation', async () => {
    const jti = randomUUID();
    const payload = body();
    const token = await tokenFor(supervisor, payload, { jti });
    const key = randomUUID();
    expect((await send(payload, token, key)).status).toBe(201);
    const replay = await send(payload, token, key);
    expect(replay.status).toBe(201);
    expect(replay.headers['idempotency-replayed']).toBe('true');
    expect(await uses(jti)).toBe(1);
  });

  const refusals: Array<[string, (payload: RefundBody, jti: string) => Promise<string>]> = [
    ['expiré', (p, jti) => tokenFor(supervisor, p, { jti, ttlSeconds: -60 })],
    ['mal signé (autre clé)', (p, jti) => tokenFor(supervisor, p, { jti, issuer: otherIdp })],
    ['autre audience (jeton d’accès)', () => idp.accessToken(supervisor.subject)],
    ['autre act', (p, jti) => tokenFor(supervisor, p, { jti, act: 'releaseMedia' })],
    ['corps modifié (act_hash)', (p, jti) => tokenFor(supervisor, { ...p, note: `${p.note}-autre` }, { jti })],
    ['émis pour l’appelant', (p, jti) => tokenFor(cashier, p, { jti })],
    ['sujet sans le rôle', (p, jti) => tokenFor(cashier2, p, { jti })],
    ['sujet d’un autre prestataire', (p, jti) => tokenFor(supervisorB, p, { jti })],
    ['sujet désactivé', (p, jti) => tokenFor(disabledSupervisor, p, { jti })],
    ['sujet inconnu', (p, jti) => idp.approvalToken({ subject: `inconnu-${randomUUID()}`, act: 'refundCashDue', actHash: actHash('POST', PATH, p), jti })],
  ];

  it.each(refusals)('jeton %s : 403 APPROVAL_INVALID, aucune consommation', async (_label, make) => {
    const jti = randomUUID();
    const payload = body();
    const res = await send(payload, await make(payload, jti));
    expect(res.status).toBe(403);
    expect(code(res)).toBe('APPROVAL_INVALID');
    expect(await uses(jti)).toBe(0);
    expect(await witnesses(payload.note)).toHaveLength(0);
  });

  it('deux requêtes simultanées avec le même jeton : exactement une réussit (NFR-003)', async () => {
    const jti = randomUUID();
    const payload = body();
    const token = await tokenFor(supervisor, payload, { jti });
    const results = await Promise.all([send(payload, token), send(payload, token), send(payload, token)]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([201, 403, 403]);
    expect(await uses(jti)).toBe(1);
    expect(await witnesses(payload.note)).toHaveLength(1);
  });
});
