// Intégration (mission 10a, WP05 ; SC-001) : la recharge refusée avant l'identification est acceptée après.
import { randomUUID } from 'node:crypto';
import { withOwner } from '../../support/db';
import { createCashWorld, type CashWorld } from '../../support/cash-fixtures';
import { createTestCustomer } from '../../support/fake-customer';
import { freshPhone } from '../../support/customer-auth';
import { ownerRows as rows } from '../../support/media-fixtures';
import { call } from '../refunds/refund-flow-fixtures';

jest.setTimeout(300_000);

describe('plafonds des non-identifiés et identification au guichet (SC-001)', () => {
  let c: CashWorld;
  beforeAll(async () => {
    c = await createCashWorld();
  });
  afterAll(async () => {
    await c.close();
  });

  it('recharge de 5 000 : 422 WALLET_LIMIT_EXCEEDED avant, 201 après l’identification par le caissier', async () => {
    const m = await c.fresh(c.batches.plain);
    const { walletId, status } = await c.activate(m);
    expect(status).toBe(201);
    await withOwner(async (db) => {
      const customer = await createTestCustomer(db, c.w.ops.a);
      await db.query(
        'INSERT INTO customer_identity (customer_id, operator_id, phone) VALUES ($1, $2, $3)',
        [customer.customerId, c.w.ops.a, freshPhone()],
      );
      await db.query('UPDATE wallet SET customer_id = $2 WHERE id = $1', [
        walletId,
        customer.customerId,
      ]);
    });
    const restore = await c.setCaps({ maxBalance: 1000, monthly: null });
    try {
      const before = await c.counts();
      const refused = await c.topup(c.topupBody(m, 5000));
      expect(refused.status).toBe(422);
      expect(refused.body.code).toBe('WALLET_LIMIT_EXCEEDED');
      expect(await c.counts()).toEqual(before);
      const kyc = await call(
        c.app,
        c.w.cashierA,
        '/kyc-verifications',
        {
          wallet_id: walletId,
          id_type: 'NATIONAL_ID',
          id_country: 'SN',
          id_last4: '4821',
          id_expires_on: '2031-05-31',
        },
        randomUUID(),
      );
      expect(kyc.status).toBe(201);
      expect(
        await rows('SELECT 1 FROM kyc_verification WHERE wallet_id = $1 AND status = $2', [
          walletId,
          'VERIFIED',
        ]),
      ).toHaveLength(1);
      const accepted = await c.topup(c.topupBody(m, 5000));
      expect(accepted.status).toBe(201);
      expect((await c.counts()).journal).toBe(before.journal + 1);
    } finally {
      await restore();
    }
  });
});
