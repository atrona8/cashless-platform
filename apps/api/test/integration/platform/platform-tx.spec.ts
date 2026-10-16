// Intégration : socle de plateforme de l'API (contrat platform-access, FR-001, FR-019 à FR-021) — second pool et
// PlatformTx, idempotence de niveau plateforme, demandes d'approbation de plateforme et leur audit. Route et action
// de démonstration, faux serveur d'identité.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PlatformTx } from '../../../src/db/platform-tx';
import { PlatformApprovalActions } from '../../../src/organization/platform/platform-approval-actions';
import { createTestApp } from '../../support/app';
import { withOwner } from '../../support/db';
import { DemoApprovalModule } from '../../support/demo-approval-action';
import { FakeIdp, type TestPerson } from '../../support/fake-idp';
import { createOperators, type Operators } from '../transverse/fixtures';
import { DemoPlatformModule } from './demo-platform';

describe('socle de plateforme', () => {
  let idp: FakeIdp;
  let app: INestApplication;
  let ops: Operators;
  const organizerA = randomUUID();
  let admin1: TestPerson; // PLATFORM_ADMIN
  let admin2: TestPerson; // PLATFORM_ADMIN
  let platformNoRole: TestPerson; // personne de la plateforme sans attribution
  let operatorAdmin: TestPerson; // OPERATOR_ADMIN de A
  let organizerAdmin1: TestPerson; // ORGANIZER_ADMIN de l'organisateur de A
  let organizerAdmin2: TestPerson;

  beforeAll(async () => {
    idp = await FakeIdp.create();
    ops = await createOperators();
    await withOwner(async (db) => {
      await db.query(
        `INSERT INTO party (kind, legal_name) SELECT 'PLATFORM', 'Plateforme (test)'
          WHERE NOT EXISTS (SELECT 1 FROM party WHERE kind = 'PLATFORM')`,
      );
      await db.query(
        `INSERT INTO party (id, kind, operator_id, legal_name, country_code) VALUES ($1, 'ORGANIZER', $2, 'Organisateur A', 'SN')`,
        [organizerA, ops.a],
      );
      const platformAdmin = () =>
        idp.createPerson(db, {
          operatorId: null,
          roles: [{ role: 'PLATFORM_ADMIN', scopeType: 'PLATFORM' }],
        });
      admin1 = await platformAdmin();
      admin2 = await platformAdmin();
      platformNoRole = await idp.createPerson(db, { operatorId: null });
      operatorAdmin = await idp.createPerson(db, {
        operatorId: ops.a,
        roles: [{ role: 'OPERATOR_ADMIN', scopeType: 'OPERATOR', scopeId: ops.a }],
      });
      const organizerAdmin = () =>
        idp.createPerson(db, {
          operatorId: ops.a,
          roles: [{ role: 'ORGANIZER_ADMIN', scopeType: 'ORGANIZER', scopeId: organizerA }],
        });
      organizerAdmin1 = await organizerAdmin();
      organizerAdmin2 = await organizerAdmin();
    });
    // Les actions de plateforme réelles ne sont pas enregistrées ici : l'action de démonstration prend leur place.
    app = await createTestApp({
      identity: idp,
      imports: [DemoPlatformModule, DemoApprovalModule],
      overrides: [{ provide: PlatformApprovalActions, useValue: {} }],
    });
  });

  afterAll(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const post = (who: TestPerson, path: string, body: object = {}, key: string = randomUUID()) =>
    http()
      .post(path)
      .set('Authorization', `Bearer ${who.token}`)
      .set('Idempotency-Key', key)
      .send(body);
  const get = (who: TestPerson, path: string) =>
    http().get(path).set('Authorization', `Bearer ${who.token}`);
  const code = (res: request.Response) => (JSON.parse(res.text) as { code?: string }).code;
  const one = <T>(sql: string, params: unknown[] = []) =>
    withOwner(async (db) => (await db.query(sql, params)).rows[0] as T);
  const witnesses = async (note: string) =>
    Number(
      (
        await one<{ n: number }>(
          `SELECT count(*)::int AS n FROM config_version WHERE scope_type = 'PLATFORM' AND settings->>'note' = $1`,
          [note],
        )
      ).n,
    );
  const demand = async (who: TestPerson, payload: object): Promise<string> => {
    const res = await post(who, '/v1/__test/platform-demands', payload);
    expect(res.status).toBe(202);
    return res.body.approval_request_id as string;
  };

  describe('PlatformTx', () => {
    it('s’exécute sous le rôle de la plateforme, sans prestataire', async () => {
      const row = await app.get(PlatformTx).run(async (client) => {
        const { rows } = await client.query<{
          role: string;
          session: string;
          scope: string;
          operator: string | null;
          platform: boolean;
        }>(
          `SELECT current_user AS role, session_user AS session, current_setting('app.scope', true) AS scope,
                  nullif(current_setting('app.operator_id', true), '') AS operator, platform_session() AS platform`,
        );
        return rows[0]!;
      });
      expect(row).toEqual({
        role: 'cashless_platform',
        session: 'cashless_platform',
        scope: 'platform',
        operator: null,
        platform: true,
      });
    });

    it('ne lit ni événement ni grand livre, et ne voit aucune partie d’un prestataire hors sa fiche', async () => {
      const tx = app.get(PlatformTx);
      await expect(
        tx.run((client) => client.query('SELECT 1 FROM event LIMIT 1')),
      ).rejects.toMatchObject({ code: '42501' });
      await expect(
        tx.run((client) => client.query('SELECT 1 FROM ledger LIMIT 1')),
      ).rejects.toMatchObject({ code: '42501' });
      const kinds = await tx.run(async (client) =>
        (await client.query<{ kind: string }>('SELECT DISTINCT kind FROM party')).rows.map(
          (r) => r.kind,
        ),
      );
      expect(kinds.sort()).toEqual(['OPERATOR', 'PLATFORM']);
    });

    it('annule tout sur erreur', async () => {
      const name = `Annulé ${randomUUID()}`;
      await expect(
        app.get(PlatformTx).run(async (client) => {
          await client.query(`INSERT INTO party (kind, legal_name) VALUES ('OPERATOR', $1)`, [
            name,
          ]);
          throw new Error('échec voulu');
        }),
      ).rejects.toThrow('échec voulu');
      expect(
        await one<{ n: number }>('SELECT count(*)::int AS n FROM party WHERE legal_name = $1', [
          name,
        ]),
      ).toEqual({ n: 0 });
    });
  });

  describe('idempotence de niveau plateforme', () => {
    it('écriture rejouée : même réponse, Idempotency-Replayed, une seule écriture, clé sans prestataire', async () => {
      const key = randomUUID();
      const body = { legal_name: `Prestataire ${randomUUID()}` };
      const first = await post(admin1, '/v1/__test/platform-operators', body, key);
      expect(first.status).toBe(201);
      expect(first.headers['idempotency-replayed']).toBeUndefined();
      const replay = await post(admin1, '/v1/__test/platform-operators', body, key);
      expect(replay.status).toBe(201);
      expect(replay.headers['idempotency-replayed']).toBe('true');
      expect(replay.body).toEqual(first.body);
      expect(
        await one('SELECT count(*)::int AS n FROM party WHERE legal_name = $1', [body.legal_name]),
      ).toEqual({ n: 1 });
      expect(
        await one(
          'SELECT operator_id, scope, status FROM api_idempotency WHERE idempotency_key = $1',
          [key],
        ),
      ).toEqual({
        operator_id: null,
        scope: 'plt:',
        status: 'COMPLETED',
      });
    });

    it('même clé, autre corps : 409 IDEMPOTENCY_KEY_REUSED, rien d’écrit', async () => {
      const key = randomUUID();
      const other = `Autre ${randomUUID()}`;
      expect(
        (
          await post(
            admin1,
            '/v1/__test/platform-operators',
            { legal_name: `P ${randomUUID()}` },
            key,
          )
        ).status,
      ).toBe(201);
      const reused = await post(
        admin1,
        '/v1/__test/platform-operators',
        { legal_name: other },
        key,
      );
      expect(reused.status).toBe(409);
      expect(code(reused)).toBe('IDEMPOTENCY_KEY_REUSED');
      expect(
        await one('SELECT count(*)::int AS n FROM party WHERE legal_name = $1', [other]),
      ).toEqual({ n: 0 });
    });

    it('la même clé sert à un prestataire sans se heurter à celle de la plateforme', async () => {
      const key = randomUUID();
      expect(
        (
          await post(
            admin1,
            '/v1/__test/platform-operators',
            { legal_name: `P ${randomUUID()}` },
            key,
          )
        ).status,
      ).toBe(201);
      const res = await post(
        organizerAdmin1,
        '/v1/__test/demo-adjustments',
        { organizer_id: organizerA, note: `n-${randomUUID()}` },
        key,
      );
      expect(res.status).toBe(202);
      const rows = await withOwner(
        async (db) =>
          (
            await db.query(
              'SELECT operator_id FROM api_idempotency WHERE idempotency_key = $1 ORDER BY operator_id NULLS FIRST',
              [key],
            )
          ).rows,
      );
      expect(rows).toEqual([{ operator_id: null }, { operator_id: ops.a }]);
    });

    it('route de plateforme : 403 pour le personnel d’un prestataire, avec ou sans garde de rôle', async () => {
      const name = `Refusé ${randomUUID()}`;
      const guarded = await post(operatorAdmin, '/v1/__test/platform-operators', {
        legal_name: name,
      });
      expect(guarded.status).toBe(403);
      const unguarded = await post(operatorAdmin, '/v1/__test/platform-unguarded');
      expect(unguarded.status).toBe(403);
      expect((await post(platformNoRole, '/v1/__test/platform-unguarded')).status).toBe(403);
      expect((await post(admin1, '/v1/__test/platform-unguarded')).status).toBe(201);
      expect(
        await one('SELECT count(*)::int AS n FROM party WHERE legal_name = $1', [name]),
      ).toEqual({ n: 0 });
    });

    it('sans clé : 400 IDEMPOTENCY_KEY_REQUIRED', async () => {
      const res = await http()
        .post('/v1/__test/platform-operators')
        .set('Authorization', `Bearer ${admin1.token}`)
        .send({ legal_name: 'X' });
      expect(res.status).toBe(400);
      expect(code(res)).toBe('IDEMPOTENCY_KEY_REQUIRED');
    });
  });

  describe('demandes d’approbation de niveau plateforme', () => {
    it('créée sans prestataire, avec sa ligne d’audit dans la chaîne de la plateforme', async () => {
      const id = await demand(admin1, { note: `créée-${randomUUID()}` });
      expect(
        await one(
          'SELECT operator_id, action, status, requested_by FROM approval_request WHERE id = $1',
          [id],
        ),
      ).toEqual({
        operator_id: null,
        action: 'PLATFORM_CONTRACT_VERSION',
        status: 'PENDING',
        requested_by: admin1.userId,
      });
      const audit = await one<{
        operator_id: string | null;
        actor_role: string;
        platform_chain: boolean;
      }>(
        `SELECT operator_id, actor_role, chain_key = audit_platform_chain() AS platform_chain
           FROM audit_log WHERE object_id = $1 AND action = 'APPROVAL_REQUESTED'`,
        [id],
      );
      expect(audit).toEqual({
        operator_id: null,
        actor_role: 'PLATFORM_ADMIN',
        platform_chain: true,
      });
    });

    it('refusée à son auteur (409 APPROVAL_INVALID), approuvée et exécutée par un second PLATFORM_ADMIN', async () => {
      const note = `exécutée-${randomUUID()}`;
      const id = await demand(admin1, { note });
      const own = await post(admin1, `/v1/approval-requests/${id}/approve`);
      expect(own.status).toBe(409);
      expect(code(own)).toBe('APPROVAL_INVALID');
      expect(await witnesses(note)).toBe(0);

      const approved = await post(admin2, `/v1/approval-requests/${id}/approve`, { note: 'Vu' });
      expect(approved.status).toBe(200);
      expect(approved.body).toMatchObject({
        status: 'EXECUTED',
        decided_by: admin2.userId,
        result: { done: true },
      });
      expect(await witnesses(note)).toBe(1);
      const audit = await one<{
        operator_id: string | null;
        approver_id: string;
        platform_chain: boolean;
      }>(
        `SELECT operator_id, approver_id, chain_key = audit_platform_chain() AS platform_chain
           FROM audit_log WHERE object_id = $1 AND action = 'APPROVAL_EXECUTED'`,
        [id],
      );
      expect(audit).toEqual({
        operator_id: null,
        approver_id: admin2.userId,
        platform_chain: true,
      });
      expect(
        await one(
          `SELECT operator_id, scope FROM api_idempotency WHERE response_body->>'approval_request_id' = $1 AND scope = 'plt:' AND response_status = 200`,
          [id],
        ),
      ).toEqual({
        operator_id: null,
        scope: 'plt:',
      });

      const again = await post(admin2, `/v1/approval-requests/${id}/approve`);
      expect(again.status).toBe(409);
      expect(await witnesses(note)).toBe(1);
    });

    it('exécution en échec : FAILED, ce qu’elle avait écrit est annulé', async () => {
      const note = `échec-${randomUUID()}`;
      const id = await demand(admin1, { note, fail: true });
      const res = await post(admin2, `/v1/approval-requests/${id}/approve`);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'FAILED', failure_code: 'VALIDATION_FAILED' });
      expect(await witnesses(note)).toBe(0);
    });

    it('refusée par un second PLATFORM_ADMIN, note obligatoire', async () => {
      const id = await demand(admin1, { note: `refusée-${randomUUID()}` });
      expect((await post(admin2, `/v1/approval-requests/${id}/reject`)).status).toBe(400);
      const rejected = await post(admin2, `/v1/approval-requests/${id}/reject`, {
        note: 'Pas maintenant',
      });
      expect(rejected.status).toBe(200);
      expect(rejected.body).toMatchObject({ status: 'REJECTED', decided_by: admin2.userId });
    });

    it('invisible et indécidable pour un OPERATOR_ADMIN', async () => {
      const note = `invisible-${randomUUID()}`;
      const id = await demand(admin1, { note });
      expect((await get(operatorAdmin, `/v1/approval-requests/${id}`)).status).toBe(404);
      const list = await get(operatorAdmin, '/v1/approval-requests?limit=200');
      expect(list.status).toBe(200);
      expect(
        (list.body.data as Array<{ approval_request_id: string }>).map(
          (r) => r.approval_request_id,
        ),
      ).not.toContain(id);
      expect((await post(operatorAdmin, `/v1/approval-requests/${id}/approve`)).status).toBe(404);
      expect(
        (await post(operatorAdmin, `/v1/approval-requests/${id}/reject`, { note: 'Intrus ici' }))
          .status,
      ).toBe(404);
      expect(await one('SELECT status FROM approval_request WHERE id = $1', [id])).toEqual({
        status: 'PENDING',
      });
      expect(await witnesses(note)).toBe(0);
    });

    it('un PLATFORM_ADMIN lit et liste les demandes de plateforme, jamais celles d’un prestataire', async () => {
      const id = await demand(admin1, { note: `listée-${randomUUID()}` });
      const tenantDemand = await post(organizerAdmin1, '/v1/__test/demo-adjustments', {
        organizer_id: organizerA,
        note: `t-${randomUUID()}`,
      });
      expect(tenantDemand.status).toBe(202);
      const tenantId = tenantDemand.body.approval_request_id as string;

      expect((await get(admin2, `/v1/approval-requests/${id}`)).body).toMatchObject({
        approval_request_id: id,
        status: 'PENDING',
      });
      const list = await get(admin2, '/v1/approval-requests?status=PENDING&limit=200');
      expect(list.status).toBe(200);
      const ids = (list.body.data as Array<{ approval_request_id: string }>).map(
        (r) => r.approval_request_id,
      );
      expect(ids).toContain(id);
      expect(ids).not.toContain(tenantId);
      const scopes = await withOwner(
        async (db) =>
          (
            await db.query(
              'SELECT DISTINCT operator_id FROM approval_request WHERE id = ANY($1::uuid[])',
              [ids],
            )
          ).rows,
      );
      expect(scopes).toEqual([{ operator_id: null }]);

      expect((await get(admin2, `/v1/approval-requests/${tenantId}`)).status).toBe(404);
      expect((await post(admin2, `/v1/approval-requests/${tenantId}/approve`)).status).toBe(404);
      // La demande du prestataire se décide toujours dans son prestataire (régression mission 2).
      const approved = await post(organizerAdmin2, `/v1/approval-requests/${tenantId}/approve`);
      expect(approved.status).toBe(200);
      expect(approved.body).toMatchObject({ status: 'EXECUTED' });
    });

    it('personne de la plateforme sans PLATFORM_ADMIN : 403 sur /approval-requests', async () => {
      const id = await demand(admin1, { note: `sans-rôle-${randomUUID()}` });
      expect((await get(platformNoRole, '/v1/approval-requests')).status).toBe(403);
      expect((await get(platformNoRole, `/v1/approval-requests/${id}`)).status).toBe(403);
      expect((await post(platformNoRole, `/v1/approval-requests/${id}/approve`)).status).toBe(403);
    });
  });
});
