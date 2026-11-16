// Intégration (mission 9a, WP04 ; FR-004, FR-005) : bloc `refund` de `GET /me/wallets`, même règle que la création.
import request from 'supertest';
import { withOwner } from '../../support/db';
import { contractViolations } from '../../support/contract-schema';
import {
  attachMedia,
  createRefundWorld,
  fundedCustomer,
  postRefund,
  setEvent,
  type FundedCustomer,
  type RefundWorld,
} from '../refunds/create-fixtures';

describe('GET /me/wallets : bloc refund', () => {
  let r: RefundWorld;
  const refundOf = async (c: FundedCustomer) => {
    const res = await request(r.app.getHttpServer()).get('/v1/me/wallets').set(c.customer.headers);
    expect(res.status).toBe(200);
    const wallet = res.body.data.find((x: { wallet_id: string }) => x.wallet_id === c.walletId);
    expect(contractViolations('Wallet', wallet)).toEqual([]);
    return wallet.refund as { eligible: boolean; deadline: string | null; fee?: number };
  };
  const created = (c: FundedCustomer) =>
    postRefund(r.app, c.customer, {
      wallet_id: c.walletId,
      destination: { method: 'WAVE' },
    });

  beforeAll(async () => {
    r = await createRefundWorld();
  });
  afterAll(async () => {
    await r.app.close();
  });
  afterEach(() => setEvent(r.w, "refund_deadline = now() + interval '10 days', ends_at = NULL"));

  it('éligible dans la fenêtre : vrai, date limite, frais ; la création en donne les mêmes valeurs', async () => {
    const c = await fundedCustomer(r.w, 10_000);
    const refund = await refundOf(c);
    expect(refund.eligible).toBe(true);
    expect(refund.fee).toBe(500);
    expect(Math.abs(Date.parse(refund.deadline!) - (Date.now() + 10 * 86_400_000))).toBeLessThan(
      60_000,
    );
    const res = await created(c);
    expect(res.status).toBe(201);
    expect(res.body.fee).toBe(refund.fee);
    expect(res.body.estimated_amount).toBe(10_000 - refund.fee!);
  });

  it('date limite EFFECTIVE : fin d’événement + 30 jours quand aucune date limite n’est posée', async () => {
    const c = await fundedCustomer(r.w);
    await setEvent(r.w, "refund_deadline = NULL, ends_at = '2026-12-01T00:00:00Z'");
    const refund = await refundOf(c);
    expect(refund.deadline).toBe('2026-12-31T00:00:00.000Z');
  });

  it('faux hors fenêtre, solde nul, bloqué, bracelet en liste noire : et la création refuse de même', async () => {
    const closed = await fundedCustomer(r.w);
    const zero = await fundedCustomer(r.w, 0);
    const blocked = await fundedCustomer(r.w);
    const black = await fundedCustomer(r.w);
    await withOwner((db) =>
      db.query("UPDATE wallet SET status = 'BLOCKED' WHERE id = $1", [blocked.walletId]),
    );
    await attachMedia(r.w, black.walletId, 'BLACKLISTED');
    for (const c of [zero, blocked, black]) {
      expect((await refundOf(c)).eligible).toBe(false);
      expect((await created(c)).status).toBe(422);
    }
    await setEvent(r.w, "refund_deadline = now() - interval '1 hour'");
    const refund = await refundOf(closed);
    expect(refund.eligible).toBe(false);
    expect(refund.deadline).not.toBeNull();
    expect(refund).not.toHaveProperty('fee');
    expect((await created(closed)).body.code).toBe('REFUND_WINDOW_CLOSED');
  });

  it('règle de frais absente : eligible false pour ce portefeuille, la liste répond 200', async () => {
    const bare = await createRefundWorld({ feeRule: false });
    try {
      const c = await fundedCustomer(bare.w);
      const res = await request(bare.app.getHttpServer())
        .get('/v1/me/wallets')
        .set(c.customer.headers);
      expect(res.status).toBe(200);
      expect(res.body.data[0].refund.eligible).toBe(false);
    } finally {
      await bare.app.close();
    }
  });
});
