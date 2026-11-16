// Concurrence de la mission 9a (WP07 ; NFR-001, NFR-002, NFR-003) : jamais deux remboursements, jamais un 500.
// Lots bornés par la taille du pool de connexions ; Jest en `--runInBand`.
import { randomUUID } from 'node:crypto';
import { ownerRows as rows } from '../../support/media-fixtures';
import { fundedCustomer, postRefund } from './create-fixtures';
import {
  call,
  confirm,
  countOfType,
  createRefundWorld,
  createStaff,
  executeApproval,
  openRequest,
  paidBalance,
  proposeApproval,
  proposeAndExecute,
  requestState,
  type RefundWorld,
  type Staff,
} from './refund-flow-fixtures';
import { expectRefundInvariants } from './refund-invariants';

jest.setTimeout(300_000);

describe('concurrence des remboursements', () => {
  let r: RefundWorld;
  let s: Staff;
  const ledger = () => r.w.ids.ledgerA;

  beforeAll(async () => {
    r = await createRefundWorld();
    s = await createStaff(r.w);
  });
  afterAll(async () => {
    await r.app.close();
  });

  it('NFR-001 : 100 exécutions simultanées de la même approbation : un WALLET_REFUND, un succès, aucun 500', async () => {
    const req = await openRequest(r.w, { funds: 25_000 });
    const proposed = await proposeApproval(r, s.adminA, req.id);
    const before = await countOfType(ledger(), 'WALLET_REFUND');
    const results = await Promise.all(
      Array.from({ length: 100 }, () =>
        executeApproval(r, s.adminB, proposed.body.approval_request_id),
      ),
    );
    expect(results.filter((x) => x.status >= 500)).toHaveLength(0);
    expect(results.filter((x) => x.status === 200 && x.body.status === 'EXECUTED')).toHaveLength(1);
    expect(await countOfType(ledger(), 'WALLET_REFUND')).toBe(before + 1);
    expect((await requestState(req.id)).status).toBe('PROCESSING');
    expect(await paidBalance(req.walletId)).toBe(0);
    await expectRefundInvariants({
      ledgerId: ledger(),
      walletId: req.walletId,
      initialPaid: 25_000,
      refundedPaid: 25_000,
    });
  });

  it('NFR-001 : 100 rejeux de la même clé d’idempotence : une approbation, réponses identiques ou 409', async () => {
    const req = await openRequest(r.w);
    const key = randomUUID();
    const results = await Promise.all(
      Array.from({ length: 100 }, () =>
        call(r.app, s.adminA, `/refund-requests/${req.id}/approve`, {}, key),
      ),
    );
    expect(results.filter((x) => x.status >= 500)).toHaveLength(0);
    const ok = results.filter((x) => x.status === 202);
    expect(new Set(ok.map((x) => x.body.approval_request_id)).size).toBe(1);
    expect(results.filter((x) => x.status !== 202).every((x) => x.status === 409)).toBe(true);
    const [n] = await rows<{ n: number }>(
      'SELECT count(*)::int AS n FROM approval_request WHERE target_id = $1',
      [req.id],
    );
    expect(n!.n).toBe(1);
    // Une même clé de grand livre jamais écrite deux fois : une exécution, un WALLET_REFUND.
    const before = await countOfType(ledger(), 'WALLET_REFUND');
    await Promise.all(
      Array.from({ length: 20 }, () =>
        executeApproval(r, s.adminB, ok[0]!.body.approval_request_id),
      ),
    );
    expect(await countOfType(ledger(), 'WALLET_REFUND')).toBe(before + 1);
  });

  it('NFR-001 : 100 confirmations FAILED simultanées : un seul REVERSAL, solde payé rendu une fois', async () => {
    const req = await openRequest(r.w, { funds: 25_000 });
    expect((await proposeAndExecute(r, s.adminA, s.adminB, req.id)).body.status).toBe('EXECUTED');
    const before = await countOfType(ledger(), 'REVERSAL');
    const results = await Promise.all(
      Array.from({ length: 100 }, (_, i) =>
        confirm(r, i % 2 ? s.adminC : s.orgAdmin, req.id, {
          outcome: 'FAILED',
          failure_reason: 'Course.',
        }),
      ),
    );
    expect(results.filter((x) => x.status >= 500)).toHaveLength(0);
    expect(results.filter((x) => x.status === 200)).toHaveLength(1);
    expect(await countOfType(ledger(), 'REVERSAL')).toBe(before + 1);
    expect((await requestState(req.id)).status).toBe('FAILED');
    await expectRefundInvariants({
      ledgerId: ledger(),
      walletId: req.walletId,
      initialPaid: 25_000,
      refundedPaid: 0,
    });
  });

  it('NFR-002 : 50 créations simultanées sur le même portefeuille : un 201, 49 409 REFUND_ALREADY_OPEN, une ligne ouverte', async () => {
    const c = await fundedCustomer(r.w, 10_000);
    const body = { wallet_id: c.walletId, destination: { method: 'WAVE' } };
    const all = await Promise.all(
      Array.from({ length: 50 }, () => postRefund(r.app, c.customer, body)),
    );
    expect(all.filter((x) => x.status === 201)).toHaveLength(1);
    const conflicts = all.filter((x) => x.status === 409);
    expect(conflicts).toHaveLength(49);
    expect(conflicts.every((x) => x.body.code === 'REFUND_ALREADY_OPEN')).toBe(true);
    const [open] = await rows<{ n: number }>(
      `SELECT count(*) FILTER (WHERE status IN ('AWAITING_HOLDER','REQUESTED','PROCESSING'))::int AS n
         FROM refund_request WHERE wallet_id = $1`,
      [c.walletId],
    );
    expect(open!.n).toBeLessThanOrEqual(1);
    // Aucun portefeuille de la base n'a plus d'une demande ouverte.
    const [multi] = await rows<{ n: number }>(
      `SELECT count(*)::int AS n FROM (SELECT wallet_id FROM refund_request
         WHERE status IN ('AWAITING_HOLDER','REQUESTED','PROCESSING') GROUP BY wallet_id HAVING count(*) > 1) x`,
    );
    expect(multi!.n).toBe(0);
  });

  it('NFR-003 : après les parcours payé, échoué, refusé : somme nulle, comptes en cache = recalcul', async () => {
    const paid = await openRequest(r.w, { funds: 12_000 });
    await proposeAndExecute(r, s.adminA, s.adminB, paid.id);
    await confirm(r, s.adminC, paid.id, { outcome: 'PAID', external_reference: 'C-1' });
    const refused = await openRequest(r.w, { funds: 12_000 });
    await call(r.app, s.adminA, `/refund-requests/${refused.id}/reject`, { reason: 'Non.' });
    await expectRefundInvariants({
      ledgerId: ledger(),
      walletId: paid.walletId,
      initialPaid: 12_000,
      refundedPaid: 12_000,
    });
    expect(await paidBalance(refused.walletId)).toBe(12_000);
  });
});
