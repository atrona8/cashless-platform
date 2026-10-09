// Intégration : double validation au back-office (FR-009 à FR-013, SC-002, SC-005, contracts/approvals.md) avec
// l'action de démonstration et le faux serveur d'identité.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from '../../support/app';
import { withOwner } from '../../support/db';
import { DemoApprovalModule } from '../../support/demo-approval-action';
import { FakeIdp, type TestPerson } from '../../support/fake-idp';
import { createOperators, type Operators } from '../transverse/fixtures';

describe('demandes d’approbation au back-office', () => {
  let idp: FakeIdp;
  let app: INestApplication;
  let ops: Operators;
  const org = { a1: randomUUID(), a2: randomUUID(), b1: randomUUID() };
  let author: TestPerson; // ORGANIZER_ADMIN de a1
  let approver: TestPerson; // ORGANIZER_ADMIN de a1
  let otherOrganizer: TestPerson; // ORGANIZER_ADMIN de a2
  let noRole: TestPerson; // CASHIER de a1
  let authorB: TestPerson; // ORGANIZER_ADMIN de b1 (autre prestataire)

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
      const admin = (operatorId: string, organizerId: string) =>
        idp.createPerson(db, { operatorId, roles: [{ role: 'ORGANIZER_ADMIN', scopeType: 'ORGANIZER', scopeId: organizerId }] });
      author = await admin(ops.a, org.a1);
      approver = await admin(ops.a, org.a1);
      otherOrganizer = await admin(ops.a, org.a2);
      authorB = await admin(ops.b, org.b1);
      noRole = await idp.createPerson(db, { operatorId: ops.a, roles: [{ role: 'CASHIER', scopeType: 'ORGANIZER', scopeId: org.a1 }] });
    });
    app = await createTestApp({ identity: idp, imports: [DemoApprovalModule] });
  });

  afterAll(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const post = (who: TestPerson, path: string, body: object = {}, key: string = randomUUID()) =>
    http().post(path).set('Authorization', `Bearer ${who.token}`).set('Idempotency-Key', key).send(body);
  const get = (who: TestPerson, path: string) => http().get(path).set('Authorization', `Bearer ${who.token}`);
  const code = (res: request.Response) => (JSON.parse(res.text) as { code?: string }).code;

  const demand = async (who: TestPerson, payload: object): Promise<string> => {
    const res = await post(who, '/v1/__test/demo-adjustments', payload);
    expect(res.status).toBe(202);
    return res.body.approval_request_id as string;
  };
  const witnesses = (note: string) =>
    withOwner(async (db) => (await db.query(`SELECT 1 FROM config_version WHERE settings->>'note' = $1`, [note])).rowCount);
  const audit = (id: string) =>
    withOwner(async (db) => {
      const { rows } = await db.query<{ action: string; actor_id: string; approver_id: string | null; actor_role: string }>(
        `SELECT action, actor_id, approver_id, actor_role FROM audit_log WHERE object_id = $1 ORDER BY seq`,
        [id],
      );
      return rows;
    });
  const statusInDb = (id: string) =>
    withOwner(async (db) => (await db.query<{ status: string }>('SELECT status FROM approval_request WHERE id = $1', [id])).rows[0]?.status);

  it('parcours complet : 202 → auteur 409 → sans rôle 403 → autre organisateur 403 → valideur 200 EXECUTED, exécution unique', async () => {
    const note = `ok-${randomUUID()}`;
    const created = await post(author, '/v1/__test/demo-adjustments', { organizer_id: org.a1, note });
    expect(created.status).toBe(202);
    expect(created.headers.location).toBe(`/v1/approval-requests/${created.body.approval_request_id}`);
    expect(created.body).toMatchObject({ action: 'ADJUSTMENT', status: 'PENDING', requested_by: author.userId, decided_by: null, result: null });
    const id = created.body.approval_request_id as string;
    expect(await witnesses(note)).toBe(0);

    const self = await post(author, `/v1/approval-requests/${id}/approve`);
    expect(self.status).toBe(409);
    expect(code(self)).toBe('APPROVAL_INVALID');
    expect((await post(noRole, `/v1/approval-requests/${id}/approve`)).status).toBe(403);
    expect((await post(otherOrganizer, `/v1/approval-requests/${id}/approve`)).status).toBe(403);

    const key = randomUUID();
    const approved = await post(approver, `/v1/approval-requests/${id}/approve`, { note: 'Vu', approved_by: author.userId, decided_by: author.userId }, key);
    expect(approved.status).toBe(200);
    expect(approved.body).toMatchObject({
      approval_request_id: id,
      status: 'EXECUTED',
      decided_by: approver.userId,
      decision_note: 'Vu',
      result: { done: true },
      failure_code: null,
    });
    expect(await witnesses(note)).toBe(1);

    // Rejeu avec la même clé : même réponse, aucune seconde exécution.
    const replay = await post(approver, `/v1/approval-requests/${id}/approve`, { note: 'Vu', approved_by: author.userId, decided_by: author.userId }, key);
    expect(replay.headers['idempotency-replayed']).toBe('true');
    expect(replay.body).toEqual(approved.body);
    expect(await witnesses(note)).toBe(1);
    // Nouvelle clé : la demande est déjà décidée.
    expect((await post(approver, `/v1/approval-requests/${id}/approve`)).status).toBe(409);

    expect(await audit(id)).toEqual([
      { action: 'APPROVAL_REQUESTED', actor_id: author.userId, approver_id: null, actor_role: 'ORGANIZER_ADMIN' },
      { action: 'APPROVAL_EXECUTED', actor_id: approver.userId, approver_id: approver.userId, actor_role: 'ORGANIZER_ADMIN' },
    ]);
  });

  it('échec de l’exécution : FAILED, ligne témoin annulée (point de sauvegarde), audit APPROVAL_FAILED', async () => {
    const note = `fail-${randomUUID()}`;
    const id = await demand(author, { organizer_id: org.a1, note, fail: true });
    const res = await post(approver, `/v1/approval-requests/${id}/approve`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'FAILED', failure_code: 'VALIDATION_FAILED', failure_reason: 'Échec de démonstration.', result: null });
    expect(await witnesses(note)).toBe(0);
    expect((await audit(id)).map((r) => r.action)).toEqual(['APPROVAL_REQUESTED', 'APPROVAL_FAILED']);
  });

  it('refus : note absente 400 ; avec note REJECTED, audit APPROVAL_REJECTED, rien exécuté', async () => {
    const note = `rej-${randomUUID()}`;
    const id = await demand(author, { organizer_id: org.a1, note });
    const missing = await post(approver, `/v1/approval-requests/${id}/reject`, {});
    expect(missing.status).toBe(400);
    expect(code(missing)).toBe('VALIDATION_FAILED');
    expect((await post(otherOrganizer, `/v1/approval-requests/${id}/reject`, { note: 'Pas d’accord' })).status).toBe(403);
    const res = await post(approver, `/v1/approval-requests/${id}/reject`, { note: 'Montant non justifié' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'REJECTED', decided_by: approver.userId, decision_note: 'Montant non justifié' });
    expect(await witnesses(note)).toBe(0);
    expect((await audit(id)).map((r) => r.action)).toEqual(['APPROVAL_REQUESTED', 'APPROVAL_REJECTED']);
    expect((await post(approver, `/v1/approval-requests/${id}/approve`)).status).toBe(409);
  });

  it('demande expirée : 409 APPROVAL_INVALID et EXPIRED validé en base ; présentée EXPIRED avant décision', async () => {
    const id = await demand(author, { organizer_id: org.a1, note: `exp-${randomUUID()}` });
    await withOwner(async (db) => {
      await db.query('ALTER TABLE approval_request DISABLE TRIGGER approval_request_guard');
      try {
        await db.query(`UPDATE approval_request SET requested_at = now() - interval '2 days', expires_at = now() - interval '1 day' WHERE id = $1`, [id]);
      } finally {
        await db.query('ALTER TABLE approval_request ENABLE TRIGGER approval_request_guard');
      }
    });
    const shown = await get(approver, `/v1/approval-requests/${id}`);
    expect(shown.body.status).toBe('EXPIRED');
    expect(await statusInDb(id)).toBe('PENDING');
    const key = randomUUID();
    const res = await post(approver, `/v1/approval-requests/${id}/approve`, {}, key);
    expect(res.status).toBe(409);
    expect(code(res)).toBe('APPROVAL_INVALID');
    expect(await statusInDb(id)).toBe('EXPIRED');
    const replay = await post(approver, `/v1/approval-requests/${id}/approve`, {}, key);
    expect(replay.status).toBe(409);
    expect(replay.headers['idempotency-replayed']).toBe('true');
  });

  it('création : action non autorisée pour l’auteur 403 ; paramètres invalides 422', async () => {
    expect((await post(noRole, '/v1/__test/demo-adjustments', { organizer_id: org.a1, note: 'x' })).status).toBe(403);
    expect((await post(otherOrganizer, '/v1/__test/demo-adjustments', { organizer_id: org.a1, note: 'x' })).status).toBe(403);
    expect((await post(author, '/v1/__test/demo-adjustments', { organizer_id: org.a1 })).status).toBe(422);
  });

  it('liste filtrée, paginée, restreinte au rôle et au prestataire ; consultation 404 hors droit', async () => {
    const mine = [await demand(author, { organizer_id: org.a1, note: `l1-${randomUUID()}` }), await demand(author, { organizer_id: org.a1, note: `l2-${randomUUID()}` })];
    const otherId = await demand(otherOrganizer, { organizer_id: org.a2, note: `l3-${randomUUID()}` });
    const idB = await demand(authorB, { organizer_id: org.b1, note: `l4-${randomUUID()}` });

    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const path: string = `/v1/approval-requests?status=PENDING&action=ADJUSTMENT&limit=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      const page = await get(approver, path);
      expect(page.status).toBe(200);
      expect(page.body.data.length).toBeLessThanOrEqual(1);
      seen.push(...page.body.data.map((r: { approval_request_id: string }) => r.approval_request_id));
      cursor = page.body.next_cursor;
    } while (cursor);
    expect(seen).toEqual(expect.arrayContaining(mine));
    expect(seen).not.toContain(otherId);
    expect(seen).not.toContain(idB);
    expect(new Set(seen).size).toBe(seen.length);

    expect((await get(approver, `/v1/approval-requests/${otherId}`)).status).toBe(404);
    expect((await get(approver, `/v1/approval-requests/${idB}`)).status).toBe(404);
    expect((await post(approver, `/v1/approval-requests/${idB}/approve`)).status).toBe(404);
    expect((await get(noRole, `/v1/approval-requests?limit=200`)).body.data).toEqual([]);
    expect((await get(approver, '/v1/approval-requests?status=INCONNU')).status).toBe(400);
  });

  it('aucune demande APPROVED ne reste en base (état de passage)', async () => {
    const count = await withOwner(async (db) => (await db.query(`SELECT 1 FROM approval_request WHERE status = 'APPROVED' AND operator_id = ANY($1::uuid[])`, [[ops.a, ops.b]])).rowCount);
    expect(count).toBe(0);
  });
});
