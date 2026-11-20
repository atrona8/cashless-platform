// Mission 9b, WP14 (FR-024, preuve de bout en bout après consolidation) : ni `approval_request` exposé par l'API ni
// `audit_log` ne portent un IBAN ou un numéro de paiement en clair.
//   - Versements (WP08) : IBAN et numéro masqués dans la demande exposée et dans l'audit : le test passe.
//   - Remboursement `WALLET_REFUND` (9a) : le `result` d'une demande exécutée porte `destination.msisdn` en clair, dans
//     `GET /approval-requests` et dans la ligne `APPROVAL_EXECUTED` de l'audit (le masque de `approval.mapper.ts`
//     couvre `payload`, pas `result`). Défaut relevé par WP14 (OP-N147), corrigé (ADR-211) : `approvalRequestDto` masque aussi `result`.
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { ownerRows } from '../../support/media-fixtures';
import { PayoutWorld, IBAN, MSISDN } from '../payouts/payout-fixtures';
import { fundedCustomer } from '../refunds/create-fixtures';
import {
  call,
  createRefundWorld,
  createStaff,
  openRequest,
  proposeAndExecute,
  type RefundWorld,
  type Staff,
} from '../refunds/refund-flow-fixtures';

jest.setTimeout(600_000);

describe('versements : ni IBAN ni numéro en clair (WP08, FR-024)', () => {
  let p: PayoutWorld;
  beforeAll(async () => {
    p = await PayoutWorld.create();
  }, 300_000);
  afterAll(async () => p.close());

  it('demande exposée et audit d’un lot par virement et par Wave : valeurs masquées', async () => {
    const m1 = await p.merchant(10_000);
    const m2 = await p.merchant(10_000);
    const { id } = await p.batch([
      p.line(m1, 1_000, { method: 'BANK_TRANSFER', iban: IBAN, msisdn: undefined }),
      p.line(m2, 1_000),
    ]);
    const exposed = await p.bo('GET', '/approval-requests', p.organizerAdmin2);
    expect(exposed.status).toBe(200);
    const text = JSON.stringify(exposed.body);
    expect(text).toContain(id);
    expect(text).not.toContain(IBAN);
    expect(text).not.toContain(MSISDN);
    const audit = await ownerRows<{ n: number }>(
      `SELECT count(*)::int AS n FROM audit_log WHERE (before::text LIKE ANY($1) OR after::text LIKE ANY($1))
          AND (after->>'target_id' = $2 OR before->>'target_id' = $2 OR object_id = $2)`,
      [[`%${IBAN}%`, `%${MSISDN}%`], p.ledger],
    );
    expect(audit[0]!.n).toBe(0);
  });
});

describe('remboursement WALLET_REFUND : numéro dans le résultat de la demande (OP-N147)', () => {
  let r: RefundWorld;
  let s: Staff;
  beforeAll(async () => {
    r = await createRefundWorld();
    s = await createStaff(r.w);
  }, 300_000);
  afterAll(async () => r.app.close());

  it('OP-N147 : le résultat exposé et l’audit d’une demande exécutée ne portent pas le numéro ', async () => {
    const req = await openRequest(r.w, { funds: 25_000 });
    const done = await proposeAndExecute(r, s.adminA, s.adminB, req.id);
    expect(done.body.status).toBe('EXECUTED');
    const list = await request(r.app.getHttpServer())
      .get('/v1/approval-requests')
      .set('Authorization', `Bearer ${s.adminB.token}`)
      .set('X-Test', randomUUID());
    expect(list.status).toBe(200);
    expect(JSON.stringify(list.body)).not.toContain('+221770000099');
    const audit = await ownerRows<{ n: number }>(
      `SELECT count(*)::int AS n FROM audit_log WHERE after->>'target_id' = $1 AND after::text LIKE '%+221770000099%'`,
      [req.id],
    );
    expect(audit[0]!.n).toBe(0);
  });
});

describe('remboursement du back-office : aucun IBAN en clair en base (NFR-005, SC-003)', () => {
  let r: RefundWorld;
  let s: Staff;
  beforeAll(async () => {
    r = await createRefundWorld();
    s = await createStaff(r.w);
  }, 300_000);
  afterAll(async () => r.app.close());

  it('refund_request.iban chiffré ; audit_log et réponses sans IBAN ni fragment', async () => {
    const iban = 'FR1420041010050500013M02606';
    const fragment = '20041010050500';
    const c = await fundedCustomer(r.w, 25_000);
    const created = await call(
      r.app,
      s.adminA,
      '/refund-requests',
      {
        wallet_id: c.walletId,
        destination: { method: 'BANK_TRANSFER', iban },
        reason: 'Virement demandé par le festivalier au guichet',
      },
      randomUUID(),
    );
    expect(created.status).toBe(201);
    expect(JSON.stringify(created.body)).not.toContain(fragment);
    const stored = await ownerRows<{ iban: string }>(
      'SELECT iban FROM refund_request WHERE wallet_id = $1',
      [c.walletId],
    );
    expect(stored).toHaveLength(1);
    expect(stored[0]!.iban.startsWith('enc:v1:')).toBe(true);
    for (const table of ['refund_request', 'approval_request', 'audit_log']) {
      const [hit] = await ownerRows<{ n: number }>(
        `SELECT count(*)::int AS n FROM ${table} t WHERE to_jsonb(t)::text LIKE ANY($1)`,
        [[`%${iban}%`, `%${fragment}%`]],
      );
      expect([table, hit!.n]).toEqual([table, 0]);
    }
    const list = await request(r.app.getHttpServer())
      .get('/v1/approval-requests')
      .set('Authorization', `Bearer ${s.adminB.token}`)
      .set('X-Test', randomUUID());
    expect(JSON.stringify(list.body)).not.toContain(fragment);
  });
});
