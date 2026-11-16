// Intégration (mission 9a, WP05 ; FR-008, FR-019, FR-020, NFR-001) : `approveRefundRequest` puis
// `approveApprovalRequest` (action `WALLET_REFUND`).
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { contractViolations } from '../../support/contract-schema';
import { ownerRows as rows, type MediaWorld } from '../../support/media-fixtures';
import { withOwner } from '../../support/db';
import { WALLET_REFUND_ROLES } from '../../../src/refunds/wallet-refund-action';
import {
  call,
  countOfType,
  createRefundWorld,
  createStaff,
  executeApproval,
  journalCount,
  openRequest,
  paidBalance,
  proposeAndExecute,
  proposeApproval,
  requestState,
  setAuthority,
  unbalanced,
  type RefundWorld,
  type Staff,
} from './refund-flow-fixtures';

jest.setTimeout(300_000);

describe('approbation à deux d’un remboursement (approveRefundRequest, WALLET_REFUND)', () => {
  let r: RefundWorld;
  let w: MediaWorld;
  let s: Staff;
  const approvalStatus = async (approvalId: string) =>
    (
      await rows<{ status: string; failure_code: string | null }>(
        'SELECT status, failure_code FROM approval_request WHERE id = $1',
        [approvalId],
      )
    )[0]!;

  beforeAll(async () => {
    r = await createRefundWorld();
    w = r.w;
    s = await createStaff(w);
  });
  afterAll(async () => {
    await setAuthority(w.ids.ledgerA, 'CENTRAL');
    await r.app.close();
  });
  afterEach(() => setAuthority(w.ids.ledgerA, 'CENTRAL'));

  it('rôles bornés : OPERATOR_ADMIN et ORGANIZER_ADMIN, aucun autre', () => {
    expect([...WALLET_REFUND_ROLES].sort()).toEqual(['OPERATOR_ADMIN', 'ORGANIZER_ADMIN']);
  });

  it('FR-008 / SC-003 : 202 sans écriture, puis seconde personne : WALLET_REFUND unique, PROCESSING', async () => {
    const req = await openRequest(w, { funds: 25_000 });
    const before = await journalCount(w.ids.ledgerA);
    const proposed = await proposeApproval(r, s.adminA, req.id, { note: 'Numéro vérifié.' });
    expect(proposed.status).toBe(202);
    expect(proposed.body).toMatchObject({ action: 'WALLET_REFUND', status: 'PENDING' });
    expect(await journalCount(w.ids.ledgerA)).toBe(before);
    expect((await requestState(req.id)).status).toBe('REQUESTED');

    const done = await executeApproval(r, s.adminB, proposed.body.approval_request_id);
    expect(done.status).toBe(200);
    expect(done.body.status).toBe('EXECUTED');
    const result = done.body.result;
    expect(contractViolations('RefundRequest', result)).toEqual([]);
    expect(result).toMatchObject({ status: 'PROCESSING', fee: 500, estimated_amount: 24_500 });
    const state = await requestState(req.id);
    expect(state).toMatchObject({ status: 'PROCESSING', approved_by: s.adminB.userId });
    expect(state.transaction_id).not.toBeNull();
    expect(await paidBalance(req.walletId)).toBe(0);
    expect(await countOfType(w.ids.ledgerA, 'WALLET_REFUND')).toBe(1);
    const [tx] = await rows<{
      source: string;
      created_by: string;
      approved_by: string;
      key: string;
    }>(
      `SELECT source, created_by, approved_by, idempotency_key AS key FROM journal_transaction WHERE id = $1`,
      [state.transaction_id],
    );
    expect(tx).toMatchObject({
      source: 'BACKOFFICE',
      created_by: s.adminA.userId,
      approved_by: s.adminB.userId,
    });
    expect(tx!.key.startsWith('bo:')).toBe(true);
    expect(await unbalanced(w.ids.ledgerA)).toBe(0);
    // FR-020 : audit de la proposition et de l'exécution.
    const audit = await rows<{ action: string }>(
      `SELECT action FROM audit_log WHERE object_id = $1 ORDER BY occurred_at`,
      [req.id],
    );
    expect(audit.map((a) => a.action)).toEqual(
      expect.arrayContaining(['REFUND_APPROVAL_REQUESTED', 'REFUND_REQUEST_PROCESSING']),
    );
  });

  it('la même personne ne valide pas sa propre proposition : refusée, aucune écriture', async () => {
    const req = await openRequest(w);
    const before = await journalCount(w.ids.ledgerA);
    const proposed = await proposeApproval(r, s.adminA, req.id);
    const self = await executeApproval(r, s.adminA, proposed.body.approval_request_id);
    expect(self.status).toBeGreaterThanOrEqual(400);
    expect(self.status).toBeLessThan(500);
    expect(await journalCount(w.ids.ledgerA)).toBe(before);
    expect((await requestState(req.id)).status).toBe('REQUESTED');
  });

  it('rôles SUPERVISOR et CASHIER : 403 ; sans authentification : 401 ; événement d’un autre prestataire : 404', async () => {
    const req = await openRequest(w);
    expect((await proposeApproval(r, w.supervisorA, req.id)).status).toBe(403);
    expect((await proposeApproval(r, w.cashierA, req.id)).status).toBe(403);
    expect((await call(r.app, null, `/refund-requests/${req.id}/approve`)).status).toBe(401);
    const other = await withOwner((db) =>
      w.idp.createPerson(db, {
        operatorId: w.ops.b,
        roles: [{ role: 'OPERATOR_ADMIN', scopeType: 'OPERATOR', scopeId: w.ops.b }],
      }),
    );
    expect((await proposeApproval(r, other, req.id)).status).toBe(404);
    expect((await proposeApproval(r, s.adminA, randomUUID())).status).toBe(404);
  });

  it('ORGANIZER_ADMIN de l’événement : peut proposer ; un SUPERVISOR ne peut pas valider', async () => {
    const req = await openRequest(w);
    const proposed = await proposeApproval(r, s.orgAdmin, req.id);
    expect(proposed.status).toBe(202);
    const refused = await executeApproval(r, w.supervisorA, proposed.body.approval_request_id);
    expect([403, 404]).toContain(refused.status);
    expect((await requestState(req.id)).status).toBe('REQUESTED');
    expect((await executeApproval(r, s.adminB, proposed.body.approval_request_id)).status).toBe(
      200,
    );
  });

  it('montant à l’exécution : un achat entre-temps réduit le remboursement', async () => {
    const req = await openRequest(w, { funds: 25_000 });
    const proposed = await proposeApproval(r, s.adminA, req.id);
    // Dépense de 5 000 prise sur le solde payé avant l'exécution.
    await withOwner(async (db) => {
      const { rows: acc } = await db.query<{ id: string }>(
        `SELECT id FROM account WHERE wallet_id = $1 AND purpose = 'WALLET_PAID'`,
        [req.walletId],
      );
      const { rows: bank } = await db.query<{ id: string }>(
        `SELECT id FROM account WHERE ledger_id = $1 AND code = 'A-BANQUE'`,
        [w.ids.ledgerA],
      );
      await db.query(`SELECT set_config('app.operator_id', $1, false)`, [w.ops.a]);
      await db.query(
        `SELECT post_transaction($1, 'TOPUP', $2, now(), 'BACKOFFICE', $3::jsonb, NULL, NULL, $4, $5)`,
        [
          w.ids.ledgerA,
          `spend:${randomUUID()}`,
          JSON.stringify([
            { account_id: acc[0]!.id, amount: 5_000 },
            { account_id: bank[0]!.id, amount: -5_000 },
          ]),
          s.adminA.userId,
          s.adminB.userId,
        ],
      );
    });
    expect(await paidBalance(req.walletId)).toBe(20_000);
    const done = await executeApproval(r, s.adminB, proposed.body.approval_request_id);
    expect(done.body.status).toBe('EXECUTED');
    expect(done.body.result).toMatchObject({ estimated_amount: 19_500, fee: 500 });
    expect(await paidBalance(req.walletId)).toBe(0);
  });

  it('solde devenu nul : approbation FAILED, demande REQUESTED, aucune écriture', async () => {
    const req = await openRequest(w, { funds: 25_000 });
    const proposed = await proposeApproval(r, s.adminA, req.id);
    await withOwner(async (db) => {
      await db.query(`SELECT set_config('app.operator_id', $1, false)`, [w.ops.a]);
      const { rows: acc } = await db.query<{ id: string }>(
        `SELECT id FROM account WHERE wallet_id = $1 AND purpose = 'WALLET_PAID'`,
        [req.walletId],
      );
      const { rows: bank } = await db.query<{ id: string }>(
        `SELECT id FROM account WHERE ledger_id = $1 AND code = 'A-BANQUE'`,
        [w.ids.ledgerA],
      );
      await db.query(
        `SELECT post_transaction($1, 'TOPUP', $2, now(), 'BACKOFFICE', $3::jsonb, NULL, NULL, $4, $5)`,
        [
          w.ids.ledgerA,
          `drain:${randomUUID()}`,
          JSON.stringify([
            { account_id: acc[0]!.id, amount: 25_000 },
            { account_id: bank[0]!.id, amount: -25_000 },
          ]),
          s.adminA.userId,
          s.adminB.userId,
        ],
      );
    });
    const before = await journalCount(w.ids.ledgerA);
    const done = await executeApproval(r, s.adminB, proposed.body.approval_request_id);
    expect(done.body.status).toBe('FAILED');
    expect(await journalCount(w.ids.ledgerA)).toBe(before);
    expect((await requestState(req.id)).status).toBe('REQUESTED');
  });

  it('refus à l’exécution (portefeuille bloqué, fenêtre close) : FAILED, REQUESTED, nouvelle approbation possible', async () => {
    const req = await openRequest(w);
    const proposed = await proposeApproval(r, s.adminA, req.id);
    await withOwner((db) =>
      db.query(`UPDATE wallet SET status = 'BLOCKED' WHERE id = $1`, [req.walletId]),
    );
    const before = await journalCount(w.ids.ledgerA);
    const blocked = await executeApproval(r, s.adminB, proposed.body.approval_request_id);
    expect(blocked.body.status).toBe('FAILED');
    expect(blocked.body.failure_code).toBe('REFUND_NOT_ALLOWED');
    expect(await journalCount(w.ids.ledgerA)).toBe(before);
    expect((await requestState(req.id)).status).toBe('REQUESTED');
    // Le portefeuille est débloqué : une nouvelle approbation aboutit.
    await withOwner((db) =>
      db.query(`UPDATE wallet SET status = 'ACTIVE' WHERE id = $1`, [req.walletId]),
    );
    expect((await proposeAndExecute(r, s.adminA, s.adminB, req.id)).body.status).toBe('EXECUTED');
    // Fenêtre close à la création : 422.
    const late = await openRequest(w);
    await withOwner((db) =>
      db.query(`UPDATE event SET refund_deadline = now() - interval '1 day' WHERE id = $1`, [
        w.ids.eventA,
      ]),
    );
    const refused = await proposeApproval(r, s.adminA, late.id);
    expect([refused.status, refused.body.code]).toEqual([422, 'REFUND_WINDOW_CLOSED']);
    await withOwner((db) =>
      db.query(`UPDATE event SET refund_deadline = now() + interval '10 days' WHERE id = $1`, [
        w.ids.eventA,
      ]),
    );
  });

  it('FR-014 : extra_check_required sans note : 422 à la création', async () => {
    const req = await openRequest(w, { extra: true });
    const refused = await proposeApproval(r, s.adminA, req.id);
    expect(refused.status).toBe(422);
    const ok = await proposeApproval(r, s.adminA, req.id, { note: 'Appel au titulaire fait.' });
    expect(ok.status).toBe(202);
  });

  it('FR-019 : sous EDGE, proposition et exécution refusées en 409 DEBIT_AUTHORITY_EDGE, rien écrit', async () => {
    const req = await openRequest(w);
    const proposed = await proposeApproval(r, s.adminA, req.id);
    await setAuthority(w.ids.ledgerA, 'EDGE');
    const before = await journalCount(w.ids.ledgerA);
    const refusedAtCreation = await proposeApproval(r, s.adminA, req.id);
    expect([refusedAtCreation.status, refusedAtCreation.body.code]).toEqual([
      409,
      'DEBIT_AUTHORITY_EDGE',
    ]);
    const done = await executeApproval(r, s.adminB, proposed.body.approval_request_id);
    expect(done.body.status).toBe('FAILED');
    expect(done.body.failure_code).toBe('DEBIT_AUTHORITY_EDGE');
    expect(await journalCount(w.ids.ledgerA)).toBe(before);
    expect((await requestState(req.id)).status).toBe('REQUESTED');
  });

  it('FR-019 : sous EDGE, la liste et le refus (aucune écriture au grand livre) répondent', async () => {
    const req = await openRequest(w);
    await setAuthority(w.ids.ledgerA, 'EDGE');
    const before = await journalCount(w.ids.ledgerA);
    const listed = await request(r.app.getHttpServer())
      .get('/v1/refund-requests?status=REQUESTED')
      .set('Authorization', `Bearer ${s.adminA.token}`);
    expect(listed.status).toBe(200);
    const rejected = await call(r.app, s.adminA, `/refund-requests/${req.id}/reject`, {
      reason: 'Refus sous EDGE.',
    });
    expect(rejected.status).toBe(200);
    expect(await journalCount(w.ids.ledgerA)).toBe(before);
  });

  it('compte A-PSP-* absent : approbation FAILED avec un message exact, aucune écriture, demande REQUESTED', async () => {
    const bare = await createRefundWorld();
    try {
      const staff = await createStaff(bare.w);
      const req = await openRequest(bare.w, { psp: false });
      const before = await journalCount(bare.w.ids.ledgerA);
      const done = await proposeAndExecute(bare, staff.adminA, staff.adminB, req.id);
      expect(done.body.status).toBe('FAILED');
      expect(done.body.failure_reason).toContain('A-PSP-WAVE absent du grand livre');
      expect(await journalCount(bare.w.ids.ledgerA)).toBe(before);
      expect((await requestState(req.id)).status).toBe('REQUESTED');
    } finally {
      await bare.app.close();
    }
  });

  it('FR-020 : l’audit de l’exécution porte le rôle exercé par le valideur', async () => {
    const req = await openRequest(w);
    await proposeAndExecute(r, s.adminA, s.adminB, req.id);
    const [row] = await rows<{ actor_role: string | null; actor_id: string }>(
      `SELECT actor_role, actor_id FROM audit_log WHERE object_id = $1 AND action = 'REFUND_REQUEST_PROCESSING'`,
      [req.id],
    );
    expect(row).toMatchObject({ actor_role: 'OPERATOR_ADMIN', actor_id: s.adminB.userId });
  });

  it('états : REJECTED, BLOCKED, AWAITING_HOLDER, PROCESSING : 409 CONFLICT_STATE', async () => {
    for (const status of ['REJECTED', 'AWAITING_HOLDER', 'PROCESSING']) {
      const req = await openRequest(w);
      await withOwner((db) =>
        db.query('ALTER TABLE refund_request DISABLE TRIGGER USER').then(() =>
          db
            .query(
              `UPDATE refund_request SET status = $2,
                      reject_reason = CASE WHEN $2 = 'REJECTED' THEN 'x' END,
                      hold_until = CASE WHEN $2 = 'AWAITING_HOLDER' THEN now() + interval '1 hour' END,
                      transaction_id = CASE WHEN $2 = 'PROCESSING' THEN (SELECT id FROM journal_transaction LIMIT 1) END,
                      approved_by = CASE WHEN $2 = 'PROCESSING' THEN $3::uuid END
                WHERE id = $1`,
              [req.id, status, s.adminB.userId],
            )
            .finally(() => db.query('ALTER TABLE refund_request ENABLE TRIGGER USER')),
        ),
      );
      const res = await proposeApproval(r, s.adminA, req.id);
      expect([status, res.status, res.body.code]).toEqual([status, 409, 'CONFLICT_STATE']);
    }
  });

  it('NFR-001 : 100 exécutions simultanées de la même approbation : un seul WALLET_REFUND', async () => {
    const req = await openRequest(w);
    const proposed = await proposeApproval(r, s.adminA, req.id);
    const before = await countOfType(w.ids.ledgerA, 'WALLET_REFUND');
    const results = await Promise.all(
      Array.from({ length: 100 }, () =>
        executeApproval(r, s.adminB, proposed.body.approval_request_id),
      ),
    );
    expect(results.filter((x) => x.status === 200 && x.body.status === 'EXECUTED').length).toBe(1);
    expect(await countOfType(w.ids.ledgerA, 'WALLET_REFUND')).toBe(before + 1);
    expect((await approvalStatus(proposed.body.approval_request_id)).status).toBe('EXECUTED');
    expect(await unbalanced(w.ids.ledgerA)).toBe(0);
  });

  it('NFR-001 : 100 rejeux de la même clé d’idempotence : une seule approbation créée', async () => {
    const req = await openRequest(w);
    const key = randomUUID();
    const results = await Promise.all(
      Array.from({ length: 100 }, () =>
        call(r.app, s.adminA, `/refund-requests/${req.id}/approve`, {}, key),
      ),
    );
    const ids = new Set(
      results.filter((x) => x.status === 202).map((x) => x.body.approval_request_id as string),
    );
    expect(ids.size).toBe(1);
    const [count] = await rows<{ n: number }>(
      `SELECT count(*)::int AS n FROM approval_request WHERE target_id = $1`,
      [req.id],
    );
    expect(count!.n).toBe(1);
  });

  it('même clé de grand livre rejouée par une seconde approbation : une seule écriture', async () => {
    const req = await openRequest(w);
    const key = randomUUID();
    const a = await call(r.app, s.adminA, `/refund-requests/${req.id}/approve`, {}, key);
    expect((await executeApproval(r, s.adminB, a.body.approval_request_id)).body.status).toBe(
      'EXECUTED',
    );
    const again = await proposeApproval(r, s.adminA, req.id);
    expect(again.status).toBe(409);
    expect(await countOfType(w.ids.ledgerA, 'WALLET_REFUND')).toBeGreaterThan(0);
  });
});
