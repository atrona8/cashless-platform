// Intégration (mission 9a, WP04 ; FR-010, FR-020) : `rejectRefundRequest`.
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { contractViolations } from '../../support/contract-schema';
import { withOwner } from '../../support/db';
import { ownerRows as rows, type MediaWorld } from '../../support/media-fixtures';
import type { TestPerson } from '../../support/fake-idp';
import { createRefundWorld, fundedCustomer, type RefundWorld } from './create-fixtures';
import { createHolder, insertRequest, type Holder } from './holder-fixtures';

describe('refus d’une demande de remboursement (POST /refund-requests/{id}/reject)', () => {
  let r: RefundWorld;
  let w: MediaWorld;
  let holder: Holder;
  let otherOrganizerAdmin: TestPerson;
  let operatorAdminB: TestPerson;

  const reject = (
    who: TestPerson | null,
    id: string,
    body: unknown = { reason: 'Numéro invalide.' },
    key: string = randomUUID(),
  ) => {
    const req = request(r.app.getHttpServer())
      .post(`/v1/refund-requests/${id}/reject`)
      .set('Idempotency-Key', key);
    return (who ? req.set('Authorization', `Bearer ${who.token}`) : req).send(body as object);
  };
  const open = async (status: 'REQUESTED' | 'AWAITING_HOLDER' = 'REQUESTED') =>
    (await withOwner((db) => insertRequest(db, w, holder, { status }))).id;
  const state = async (id: string) =>
    (
      await rows<{ status: string; reject_reason: string | null }>(
        'SELECT status, reject_reason FROM refund_request WHERE id = $1',
        [id],
      )
    )[0]!;
  const journal = async () =>
    (
      await rows<{ n: number }>(
        'SELECT count(*)::int AS n FROM journal_transaction WHERE ledger_id = $1',
        [w.ids.ledgerA],
      )
    )[0]!.n;

  beforeAll(async () => {
    r = await createRefundWorld();
    w = r.w;
    await withOwner(async (db) => {
      const org = randomUUID();
      await db.query(
        "INSERT INTO party (id, kind, operator_id, legal_name, country_code) VALUES ($1, 'ORGANIZER', $2, 'Autre organisateur', 'SN')",
        [org, w.ops.a],
      );
      otherOrganizerAdmin = await w.idp.createPerson(db, {
        operatorId: w.ops.a,
        roles: [{ role: 'ORGANIZER_ADMIN', scopeType: 'ORGANIZER', scopeId: org }],
      });
      operatorAdminB = await w.idp.createPerson(db, {
        operatorId: w.ops.b,
        roles: [{ role: 'OPERATOR_ADMIN', scopeType: 'OPERATOR', scopeId: w.ops.b }],
      });
      holder = await createHolder(db, w);
    });
  });
  afterAll(async () => {
    await r.app.close();
  });

  it('FR-010, FR-020 : REQUESTED refusée, motif posé, aucune écriture au grand livre, audit', async () => {
    const id = await open();
    const before = await journal();
    const res = await reject(w.operatorAdminA, id, { reason: '  Numéro mobile money invalide.  ' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      refund_request_id: id,
      status: 'REJECTED',
      reject_reason: 'Numéro mobile money invalide.',
    });
    expect(contractViolations('RefundRequest', res.body)).toEqual([]);
    expect(await state(id)).toEqual({
      status: 'REJECTED',
      reject_reason: 'Numéro mobile money invalide.',
    });
    expect(await journal()).toBe(before);
    const audit = await rows<{ actor_id: string; actor_role: string }>(
      "SELECT actor_id, actor_role FROM audit_log WHERE action = 'REFUND_REQUEST_REJECTED' AND object_id = $1",
      [id],
    );
    expect(audit).toEqual([{ actor_id: w.operatorAdminA.userId, actor_role: 'OPERATOR_ADMIN' }]);
  });

  it('rejeu avec la même clé : même réponse, un seul audit ; organisateur de l’événement : permis', async () => {
    const id = await open();
    const key = randomUUID();
    const first = await reject(w.organizerAdminA, id, { reason: 'Doublon.' }, key);
    const again = await reject(w.organizerAdminA, id, { reason: 'Doublon.' }, key);
    expect([first.status, again.status]).toEqual([200, 200]);
    expect(again.body).toEqual(first.body);
    const audit = await rows(
      "SELECT 1 FROM audit_log WHERE action = 'REFUND_REQUEST_REJECTED' AND object_id = $1",
      [id],
    );
    expect(audit).toHaveLength(1);
  });

  it('FR-010 : refuser deux fois, PROCESSING, AWAITING_HOLDER : 409 CONFLICT_STATE sans écriture', async () => {
    const id = await open();
    expect((await reject(w.operatorAdminA, id)).status).toBe(200);
    const twice = await reject(w.operatorAdminA, id, { reason: 'Encore.' });
    expect([twice.status, twice.body.code]).toEqual([409, 'CONFLICT_STATE']);
    expect((await state(id)).reject_reason).toBe('Numéro invalide.');

    await fundedCustomer(w, 1_000); // une écriture au grand livre, pour la clé étrangère
    const processing = await open();
    await withOwner(async (db) => {
      const tx = await db.query<{ id: string }>(
        'SELECT id FROM journal_transaction WHERE ledger_id = $1 LIMIT 1',
        [w.ids.ledgerA],
      );
      await db.query(
        "UPDATE refund_request SET status = 'PROCESSING', transaction_id = $2, approved_by = $3 WHERE id = $1",
        [processing, tx.rows[0]!.id, randomUUID()],
      );
    });
    const awaiting = await open('AWAITING_HOLDER');
    for (const target of [processing, awaiting]) {
      const res = await reject(w.operatorAdminA, target);
      expect([res.status, res.body.code]).toEqual([409, 'CONFLICT_STATE']);
    }
    expect((await state(processing)).status).toBe('PROCESSING');
    expect((await state(awaiting)).status).toBe('AWAITING_HOLDER');
  });

  it('FR-010 : motif absent, vide, trop long ou champ inconnu : 400, sans écriture', async () => {
    const id = await open();
    for (const body of [
      {},
      { reason: '' },
      { reason: '   ' },
      { reason: 'x'.repeat(2001) },
      { reason: 3 },
    ]) {
      expect((await reject(w.operatorAdminA, id, body)).status).toBe(400);
    }
    expect((await reject(w.operatorAdminA, id, { reason: 'ok', status: 'PAID' })).status).toBe(400);
    expect((await state(id)).status).toBe('REQUESTED');
  });

  it('isolation : autre prestataire, autre organisateur, inconnue, mal formée : 404 ; CASHIER 403 ; sans jeton 401', async () => {
    const id = await open();
    for (const target of [id, randomUUID(), 'pas-un-uuid']) {
      expect((await reject(operatorAdminB, target)).status).toBe(404);
      expect((await reject(otherOrganizerAdmin, target)).status).toBe(404);
    }
    expect((await reject(w.cashierA, id)).status).toBe(403);
    expect((await reject(null, id)).status).toBe(401);
    expect((await state(id)).status).toBe('REQUESTED');
  });
});
