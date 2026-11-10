// Intégration : lectures de l'app festivalier (`getMe`, `listMyWallets`, `listMyWalletTransactions`, `listMyMedia`)
// derrière le faux fournisseur d'identité du festivalier (en-têtes de test). Vraie base, RLS du prestataire.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from '../../support/app';
import { contractViolations } from '../../support/contract-schema';
import { withOwner } from '../../support/db';
import {
  createCustomerWallet,
  createTestCustomer,
  type TestCustomer,
} from '../../support/fake-customer';
import {
  activateMedia,
  createBatch,
  createMediaWorld,
  creditWallet,
  goLive,
  seedPersonalizedMedia,
  type MediaWorld,
} from '../../support/media-fixtures';
import { asOperator, seedPos } from '../vendors/vendor-fixtures';

describe('lectures de l’app festivalier (/me)', () => {
  let w: MediaWorld;
  let app: INestApplication;
  let awa: TestCustomer;
  let awaWallet: string;
  let awaMedia: string;
  let other: TestCustomer;
  let otherWallet: string;
  let customerB: TestCustomer;

  const get = (path: string, who: TestCustomer | null) => {
    const r = request(app.getHttpServer()).get(`/v1${path}`);
    return who ? r.set(who.headers) : r;
  };

  beforeAll(async () => {
    w = await createMediaWorld();
    await withOwner(async (db) => {
      await goLive(db, w.ops.a, w.ids.eventA, w.operatorAdminA.userId);
      awa = await createTestCustomer(db, w.ops.a);
      other = await createTestCustomer(db, w.ops.a);
      customerB = await createTestCustomer(db, w.ops.b);
      awaWallet = (
        await createCustomerWallet(db, {
          operatorId: w.ops.a,
          ledgerId: w.ids.ledgerA,
          customerId: awa.customerId,
        })
      ).walletId;
      otherWallet = (
        await createCustomerWallet(db, {
          operatorId: w.ops.a,
          ledgerId: w.ids.ledgerA,
          customerId: other.customerId,
          funds: 9_999,
        })
      ).walletId;
      for (const amount of [10_000, 5_000, 2_000])
        await creditWallet(db, {
          operatorId: w.ops.a,
          ledgerId: w.ids.ledgerA,
          walletId: awaWallet,
          amount,
        });
      // Une vente de 1 500 au comptoir d'un commerçant : mouvement négatif, libellé = commerçant.
      const pos = await seedPos(db, {
        operatorId: w.ops.a,
        eventId: w.ids.eventA,
        name: 'Bar du test',
      });
      await asOperator(db, w.ops.a, async () => {
        await db.query('SELECT open_participation_account($1)', [pos.participationId]);
        await db.query(
          `SELECT post_transaction($1, 'PURCHASE', $2, now(), 'ONLINE', jsonb_build_array(
             jsonb_build_object('account_id', (SELECT id FROM account WHERE wallet_id = $3 AND purpose = 'WALLET_PAID'),
                                'amount', 1500),
             jsonb_build_object('account_id', (SELECT id FROM account WHERE participation_id = $4 AND purpose = 'MERCHANT'),
                                'amount', -1500)))`,
          [w.ids.ledgerA, `test-purchase:${randomUUID()}`, awaWallet, pos.participationId],
        );
      });
      const batch = await createBatch(db, {
        operatorId: w.ops.a,
        organizerId: w.ids.organizerA,
        eventId: w.ids.eventA,
        status: 'ACTIVE',
      });
      const [m] = await seedPersonalizedMedia(db, {
        operatorId: w.ops.a,
        batchId: batch,
        kmsKeyRef: w.keyRef.a,
        count: 1,
      });
      awaMedia = m!.id;
      await activateMedia(db, {
        operatorId: w.ops.a,
        eventId: w.ids.eventA,
        walletId: awaWallet,
        mediaIds: [awaMedia],
      });
    });
    app = await createTestApp({ identity: w.idp });
  });

  afterAll(async () => {
    await app.close();
  });

  it.each(['/me', '/me/wallets', '/me/media', `/me/wallets/${randomUUID()}/transactions`])(
    '%s sans identité de festivalier : 401',
    async (path) => {
      const res = await get(path, null);
      expect(res.status).toBe(401);
    },
  );

  it('festivalier d’un autre prestataire annoncé chez A : 401', async () => {
    const res = await get('/me', null).set({
      ...customerB.headers,
      'x-test-operator-id': w.ops.a,
    });
    expect(res.status).toBe(401);
  });

  it('GET /me : profil conforme au contrat', async () => {
    const res = await get('/me', awa);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ customer_id: awa.customerId, kyc_level: 'NONE' });
    expect(contractViolations('CustomerProfile', res.body)).toEqual([]);
  });

  it('GET /me/wallets : son portefeuille seul, soldes et bracelet, conforme au contrat', async () => {
    const res = await get('/me/wallets', awa);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    const wallet = res.body.data[0];
    expect(wallet).toMatchObject({
      wallet_id: awaWallet,
      status: 'ACTIVE',
      currency: 'XOF',
      event: { event_id: w.ids.eventA, status: 'LIVE' },
      balance: { paid: 15_500, promo: 0, spendable: 15_500 },
      refund: { eligible: false },
    });
    expect(wallet.media).toEqual([
      expect.objectContaining({ media_id: awaMedia, status: 'ACTIVE', wallet_id: awaWallet }),
    ]);
    expect(contractViolations('Wallet', wallet)).toEqual([]);
    expect(JSON.stringify(res.body)).not.toContain(otherWallet);
  });

  it('GET /me/media : bracelets rattachés au compte', async () => {
    const res = await get('/me/media', awa);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([
      {
        media_id: awaMedia,
        printed_number: null,
        status: 'ACTIVE',
        deposit_status: 'NONE',
        wallet_id: awaWallet,
      },
    ]);
    expect(contractViolations('CustomerMedia', res.body.data[0])).toEqual([]);
    expect((await get('/me/media', other)).body.data).toEqual([]);
  });

  it('historique : signes, libellés, pagination par curseur sans doublon ni trou', async () => {
    const first = await get(`/me/wallets/${awaWallet}/transactions?limit=3`, awa);
    expect(first.status).toBe(200);
    expect(first.body.has_more).toBe(true);
    expect(first.body.data).toHaveLength(3);
    const second = await get(
      `/me/wallets/${awaWallet}/transactions?limit=3&cursor=${first.body.next_cursor}`,
      awa,
    );
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ has_more: false, next_cursor: null });
    const all = [...first.body.data, ...second.body.data];
    expect(new Set(all.map((m: { transaction_id: string }) => m.transaction_id)).size).toBe(4);
    expect(all.map((m: { amount: number }) => m.amount).sort((a, b) => a - b)).toEqual([
      -1500, 2000, 5000, 10_000,
    ]);
    const purchase = all.find((m: { type: string }) => m.type === 'PURCHASE');
    expect(purchase).toMatchObject({ amount: -1500, label: 'Bar du test', currency: 'XOF' });
    expect(all.find((m: { type: string }) => m.type === 'TOPUP').label).toBe('Recharge en ligne');
    for (const m of all) expect(contractViolations('WalletMovement', m)).toEqual([]);
  });

  it('historique du portefeuille d’un autre compte, inconnu ou mal formé : même 404', async () => {
    const bodies = [];
    for (const id of [otherWallet, randomUUID(), 'pas-un-uuid']) {
      const res = await get(`/me/wallets/${id}/transactions`, awa);
      expect(res.status).toBe(404);
      const { instance: _i, request_id: _r, ...body } = res.body;
      bodies.push(JSON.stringify(body));
    }
    expect(new Set(bodies).size).toBe(1);
  });

  it.each([
    ['limit=0', 400],
    ['limit=201', 400],
    ['cursor=xyz', 400],
    [`cursor=${Buffer.from('{"t":"2026-01-01","i":"x"}').toString('base64url')}`, 400],
  ])('paramètre invalide %s : %i', async (query, status) => {
    const res = await get(`/me/wallets/${awaWallet}/transactions?${query}`, awa);
    expect(res.status).toBe(status);
  });
});
