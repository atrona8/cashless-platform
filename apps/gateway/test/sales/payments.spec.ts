// WP21 / T094 : createPayment, getPayment. Vraie base locale, vraie file, vraie autorité.
import { randomUUID } from 'node:crypto';
import { makeBench, type Bench } from './_support/harness';
import {
  balanceOf,
  keyOf,
  newTill,
  pay,
  queueState,
  tapAndPay,
  type Till,
} from './_support/helpers';
import type { Loose } from '../support/loose';

let b: Bench;
beforeAll(async () => {
  b = await makeBench({ failureFloorMs: 5 });
});
afterAll(async () => b.close());

describe('chemin heureux', () => {
  let till: Till;
  beforeAll(async () => {
    till = await newTill(b);
  });

  it('un paiement par bracelet : 201, entrée de file PURCHASE EDGE_ONLINE avec edge_decision', async () => {
    const bracelet = await b.newBracelet({ paid: 4_000, promo: 1_000 });
    const before = await queueState(b);
    const res = await tapAndPay(b, till, bracelet, 10, { amount: 500 });
    expect(res.status).toBe(201);
    expect(res.json).toMatchObject({
      type: 'PURCHASE',
      status: 'SUCCEEDED',
      amount: 500,
      currency: 'XOF',
      wallet_id: bracelet.walletId,
      media_id: bracelet.mediaId,
      channel: 'NFC',
      // PROMO_FIRST (défaut non répliqué) : les crédits offerts d'abord.
      balance_after: { spendable: 4_500, paid: 4_000, promo: 500 },
      vendor: { display_name: 'Awa' },
    });
    expect(res.json!.lines).toEqual([
      expect.objectContaining({
        label: 'Bière',
        quantity: 1,
        unit_price: 500,
        vat_rate_bps: 1800,
        line_total: 500,
        catalog_version: 4,
      }),
    ]);
    const after = await queueState(b);
    expect(after.head.last_edge_seq).toBe(before.head.last_edge_seq + 1);
    const [op] = await b.q<{
      type: string;
      authorized_mode: string;
      operation: Record<string, Loose>;
    }>('SELECT type, authorized_mode, operation FROM edge_op WHERE edge_seq = $1', [
      after.head.last_edge_seq,
    ]);
    expect(op).toMatchObject({ type: 'PURCHASE', authorized_mode: 'EDGE_ONLINE' });
    expect(op!.operation).toMatchObject({
      seq: till.seq,
      amount: 500,
      currency: 'XOF',
      vendor_session_id: till.sessionId,
      local_available_before: 5_000,
      edge_decision: { status: 'ACCEPTED', charged_to_wallet: 500, shortfall_amount: 0 },
      tap: { counter: 10, token_hash: bracelet.tokenHash, nfc_uid: bracelet.uid },
    });
    // Le tap_id local n'est jamais envoyé au central.
    expect(JSON.stringify(op!.operation)).not.toContain('tap_id');
    expect(await balanceOf(b, bracelet.walletId)).toBe(4_500);
    const deltas = await b.q(
      'SELECT paid_delta, promo_delta FROM edge_op_delta WHERE wallet_id = $1',
      [bracelet.walletId],
    );
    expect(deltas).toEqual([{ paid_delta: '0', promo_delta: '-500' }]);
  });

  it('lecture embarquée (tap) : un seul aller-retour, passage consommé', async () => {
    const bracelet = await b.newBracelet({ paid: 2_000 });
    const res = await pay(b, till, { tap: bracelet.tap(5), amount: 500 });
    expect(res.status).toBe(201);
    const taps = await b.q<{ consumed_by_edge_seq: string | null }>(
      'SELECT consumed_by_edge_seq FROM edge_tap WHERE token_hash = $1',
      [Buffer.from(bracelet.tokenHash, 'hex')],
    );
    expect(taps).toHaveLength(1);
    expect(taps[0]!.consumed_by_edge_seq).not.toBeNull();
  });

  it('getPayment : la vente du terminal ; 404 neutre pour un autre terminal ou un inconnu', async () => {
    const bracelet = await b.newBracelet();
    const res = await tapAndPay(b, till, bracelet, 3);
    const id = res.json!.transaction_id as string;
    const mine = await b.request(till.device, { path: `/v1/payments/${id}` });
    expect(mine.status).toBe(200);
    expect(mine.json).toEqual(res.json);
    const other = await newTill(b);
    const theirs = await b.request(other.device, { path: `/v1/payments/${id}` });
    expect(theirs.status).toBe(404);
    expect(theirs.json!.code).toBe('NOT_FOUND');
    expect((await b.request(till.device, { path: `/v1/payments/${randomUUID()}` })).status).toBe(
      404,
    );
    expect((await b.request(till.device, { path: '/v1/payments/pas-un-uuid' })).status).toBe(404);
  });
});

describe('idempotence', () => {
  it('100 rejeux de la même clé : une seule entrée, même réponse, aucun nouvel effet', async () => {
    const till = await newTill(b);
    const bracelet = await b.newBracelet({ paid: 10_000 });
    const first = await tapAndPay(b, till, bracelet, 1, { amount: 500 });
    expect(first.status).toBe(201);
    const key = keyOf(till, till.seq);
    const after = await queueState(b);
    const body = (
      await b.q<{ response: unknown }>(
        'SELECT response FROM edge_idempotency WHERE idempotency_key = $1',
        [key],
      )
    )[0]!;
    expect(body).toBeDefined();
    for (let i = 0; i < 100; i += 1) {
      const again = await pay(b, till, {
        key,
        body: {
          amount: 500,
          currency: 'XOF',
          occurred_at: new Date().toISOString(),
          vendor_session_id: till.sessionId,
          tap_id: 1,
        },
      });
      // Autre corps, même clé : IDEMPOTENCY_KEY_REUSED.
      expect(again.status).toBe(409);
      expect(again.json!.code).toBe('IDEMPOTENCY_KEY_REUSED');
    }
    expect(await queueState(b)).toEqual({ ...after, nonces: after.nonces });
    expect(await balanceOf(b, bracelet.walletId)).toBe(9_500);
  });

  it('même clé, même corps : même réponse (Idempotency-Replayed), une entrée, un seul débit', async () => {
    const till = await newTill(b);
    const bracelet = await b.newBracelet({ paid: 10_000 });
    const tap = await b.request(till.device, {
      method: 'POST',
      path: '/v1/taps',
      body: bracelet.tap(1),
    });
    const body = {
      amount: 500,
      currency: 'XOF',
      occurred_at: new Date().toISOString(),
      vendor_session_id: till.sessionId,
      tap_id: tap.json!.tap_id,
      lines: [{ product_id: till.productId, quantity: 1, unit_price: 500 }],
    };
    till.seq += 1;
    const key = keyOf(till, till.seq);
    const first = await pay(b, till, { key, body });
    expect(first.status).toBe(201);
    const before = await queueState(b);
    for (let i = 0; i < 100; i += 1) {
      const again = await pay(b, till, { key, body });
      expect(again.status).toBe(201);
      expect(again.json).toEqual(first.json);
      expect(again.headers['idempotency-replayed']).toBe('true');
    }
    const after = await queueState(b);
    expect(after.head).toEqual(before.head);
    expect(after.ops).toBe(before.ops);
    expect(await balanceOf(b, bracelet.walletId)).toBe(9_500);
  });

  it('deux requêtes simultanées de même clé : un seul effet', async () => {
    const till = await newTill(b);
    const bracelet = await b.newBracelet({ paid: 10_000 });
    const tap = await b.request(till.device, {
      method: 'POST',
      path: '/v1/taps',
      body: bracelet.tap(1),
    });
    const body = {
      amount: 500,
      currency: 'XOF',
      occurred_at: new Date().toISOString(),
      vendor_session_id: till.sessionId,
      tap_id: tap.json!.tap_id,
      lines: [{ product_id: till.productId, quantity: 1, unit_price: 500 }],
    };
    const key = keyOf(till, 1);
    const [r1, r2] = await Promise.all([pay(b, till, { key, body }), pay(b, till, { key, body })]);
    expect([r1.status, r2.status]).toEqual([201, 201]);
    expect(r1.json!.transaction_id).toBe(r2.json!.transaction_id);
    expect(await balanceOf(b, bracelet.walletId)).toBe(9_500);
    const ops = await b.q('SELECT 1 FROM edge_op WHERE origin_key = $1', [key]);
    expect(ops).toHaveLength(1);
  });
});

describe('solde et concurrence', () => {
  it('deux paiements simultanés sur un solde qui n’en permet qu’un : un 201, un INSUFFICIENT_FUNDS', async () => {
    const till = await newTill(b);
    const other = await newTill(b);
    const bracelet = await b.newBracelet({ paid: 500 });
    const t1 = await b.request(till.device, {
      method: 'POST',
      path: '/v1/taps',
      body: bracelet.tap(1),
    });
    const t2 = await b.request(other.device, {
      method: 'POST',
      path: '/v1/taps',
      body: bracelet.tap(2),
    });
    const [r1, r2] = await Promise.all([
      pay(b, till, { tapId: t1.json!.tap_id as number }),
      pay(b, other, { tapId: t2.json!.tap_id as number }),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([201, 422]);
    const refused = r1.status === 422 ? r1 : r2;
    expect(refused.json).toMatchObject({ code: 'INSUFFICIENT_FUNDS', available_balance: 0 });
    expect(await balanceOf(b, bracelet.walletId)).toBe(0);
  });

  it('INSUFFICIENT_FUNDS : 422 avec le solde disponible, numéro consommé par un VOID sans trou', async () => {
    const till = await newTill(b);
    const bracelet = await b.newBracelet({ paid: 300 });
    const tap = await b.request(till.device, {
      method: 'POST',
      path: '/v1/taps',
      body: bracelet.tap(1),
    });
    const body = {
      amount: 500,
      currency: 'XOF',
      occurred_at: new Date().toISOString(),
      vendor_session_id: till.sessionId,
      tap_id: tap.json!.tap_id,
      lines: [{ product_id: till.productId, quantity: 1, unit_price: 500 }],
    };
    const key = keyOf(till, 1);
    const before = await queueState(b);
    const res = await pay(b, till, { key, body });
    expect(res.status).toBe(422);
    expect(res.json).toMatchObject({
      code: 'INSUFFICIENT_FUNDS',
      available_balance: 300,
      currency: 'XOF',
      retryable: false,
    });
    const after = await queueState(b);
    expect(after.head.last_edge_seq).toBe(before.head.last_edge_seq + 1);
    expect(after.voids).toBe(before.voids + 1);
    const [op] = await b.q<{ type: string; operation: Record<string, unknown> }>(
      'SELECT type, operation FROM edge_op WHERE edge_seq = $1',
      [after.head.last_edge_seq],
    );
    expect(op).toMatchObject({
      type: 'VOID',
      operation: { seq: 1, void_reason: 'ONLINE_REJECTED' },
    });
    expect(await balanceOf(b, bracelet.walletId)).toBe(300);
    // Rejeu de la même clé : même refus, aucune nouvelle entrée.
    const replay = await pay(b, till, { key, body });
    expect(replay.status).toBe(422);
    expect(replay.json).toMatchObject({ code: 'INSUFFICIENT_FUNDS', available_balance: 300 });
    expect((await queueState(b)).head).toEqual(after.head);
  });

  it('la suite des numéros reste continue au registre : paiements acceptés et refusés', async () => {
    const till = await newTill(b);
    const bracelet = await b.newBracelet({ paid: 1_000 });
    await tapAndPay(b, till, bracelet, 1, { amount: 500 });
    await tapAndPay(b, till, bracelet, 2, { amount: 500 });
    await tapAndPay(b, till, bracelet, 3, { amount: 500 }); // refusé : solde épuisé
    const seqs = (
      await b.q<{ seq: number }>(
        `SELECT (operation ->> 'seq')::int AS seq FROM edge_op WHERE device_id = $1 ORDER BY edge_seq`,
        [till.device.deviceId],
      )
    ).map((r) => r.seq);
    expect(seqs).toEqual([1, 2, 3]);
    const edge = (
      await b.q<{ edge_seq: string }>('SELECT edge_seq FROM edge_op ORDER BY edge_seq')
    ).map((r) => Number(r.edge_seq));
    edge.forEach((n, i) => expect(n).toBe(i + 1));
  });
});

describe('plafonds de la décision 13', () => {
  /** Un terminal dont la session de vendeur survit aux sauts d'horloge du test. */
  async function longTill(): Promise<Till> {
    const device = await b.newDevice();
    const { vendorId, sessionId } = await b.newVendorSession(device, {
      expiresInMs: 24 * 3_600_000,
    });
    return { device, vendorId, sessionId, productId: await b.newProduct(device, 50_000), seq: 0 };
  }

  const line = (productId: string, price: number) => [
    { product_id: productId, quantity: 1, unit_price: price },
  ];

  it('par vente : 50 000 accepté, 50 001 refusé EDGE_SALE_CEILING, seul un VOID est écrit', async () => {
    const till = await newTill(b, 50_000);
    const dearer = await b.newProduct(till.device, 50_001);
    const bracelet = await b.newBracelet({ paid: 900_000 });
    const ok = await tapAndPay(b, till, bracelet, 1, { amount: 50_000 });
    expect(ok.status).toBe(201);
    const before = await queueState(b);
    const balance = await balanceOf(b, bracelet.walletId);
    const res = await tapAndPay(b, till, bracelet, 2, {
      amount: 50_001,
      lines: line(dearer, 50_001),
    });
    expect(res.status).toBe(422);
    expect(res.json!.code).toBe('AMOUNT_OUT_OF_RANGE');
    expect(String(res.json!.detail)).toContain('EDGE_SALE_CEILING');
    const after = await queueState(b);
    expect(after.voids).toBe(before.voids + 1);
    expect(after.head.last_edge_seq).toBe(before.head.last_edge_seq + 1);
    expect(await balanceOf(b, bracelet.walletId)).toBe(balance);
    expect(
      await b.q(`SELECT 1 FROM edge_op WHERE edge_seq > $1 AND type <> 'VOID'`, [
        before.head.last_edge_seq,
      ]),
    ).toHaveLength(0);
  });

  it('horaire du terminal : 500 000 sur une heure glissante, au-delà EDGE_HOURLY_CEILING', async () => {
    const till = await longTill();
    const other = await longTill();
    const cheap = await b.newProduct(till.device, 1);
    const bracelet = await b.newBracelet({ paid: 2_000_000 });
    let counter = 0;
    for (let i = 0; i < 10; i += 1) {
      counter += 1;
      const r = await tapAndPay(b, till, bracelet, counter, { amount: 50_000 });
      expect(r.status).toBe(201);
    }
    const before = await queueState(b);
    const balance = await balanceOf(b, bracelet.walletId);
    counter += 1;
    const res = await tapAndPay(b, till, bracelet, counter, {
      amount: 1,
      lines: line(cheap, 1),
    });
    expect(res.status).toBe(422);
    expect(res.json!.code).toBe('AMOUNT_OUT_OF_RANGE');
    expect(String(res.json!.detail)).toContain('EDGE_HOURLY_CEILING');
    const after = await queueState(b);
    expect(after.voids).toBe(before.voids + 1);
    expect(await balanceOf(b, bracelet.walletId)).toBe(balance);
    // Un autre terminal n'est pas compté.
    counter += 1;
    const elsewhere = await tapAndPay(b, other, bracelet, counter, { amount: 50_000 });
    expect(elsewhere.status).toBe(201);
    // Hors de l'heure glissante, les ventes ne comptent plus.
    b.clock.advance(61 * 60_000);
    try {
      counter += 1;
      const later = await tapAndPay(b, till, bracelet, counter, { amount: 50_000 });
      expect(later.status).toBe(201);
    } finally {
      b.clock.advance(-61 * 60_000);
    }
  });
});

describe('session de vendeur expirée', () => {
  it('createPayment : 409 VENDOR_SESSION_INVALID, VOID consommé, solde intact', async () => {
    const device = await b.newDevice();
    const session = await b.newVendorSession(device, { expiresInMs: -60_000 });
    const till: Till = {
      device,
      vendorId: session.vendorId,
      sessionId: session.sessionId,
      productId: await b.newProduct(device, 500),
      seq: 0,
    };
    const bracelet = await b.newBracelet({ paid: 5_000 });
    const before = await queueState(b);
    const res = await tapAndPay(b, till, bracelet, 1, { amount: 500 });
    expect(res.status).toBe(409);
    expect(res.json!.code).toBe('VENDOR_SESSION_INVALID');
    expect((await queueState(b)).voids).toBe(before.voids + 1);
    expect(await balanceOf(b, bracelet.walletId)).toBe(5_000);
  });
});
