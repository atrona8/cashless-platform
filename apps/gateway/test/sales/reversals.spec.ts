// WP21 / T095 : reversePayment. Annulation par le vendeur de la vente, jamais plus que la vente.
import { randomUUID } from 'node:crypto';
import { makeBench, type Bench } from './_support/harness';
import { balanceOf, newTill, queueState, reverse, tapAndPay, type Till } from './_support/helpers';

let b: Bench;
beforeAll(async () => {
  b = await makeBench({ failureFloorMs: 5 });
});
afterAll(async () => b.close());

async function sold(till: Till, amount = 500, counter = 1) {
  const bracelet = await b.newBracelet({ paid: 5_000 });
  const sale = await tapAndPay(b, till, bracelet, counter, { amount });
  expect(sale.status).toBe(201);
  return { bracelet, id: sale.json!.transaction_id as string };
}

describe('annulation par le vendeur', () => {
  it('rend exactement la vente d’origine : REVERSAL EDGE_ONLINE, reverses_seq, delta positif', async () => {
    const till = await newTill(b);
    const { bracelet, id } = await sold(till);
    expect(await balanceOf(b, bracelet.walletId)).toBe(4_500);
    const before = await queueState(b);
    // Le montant du corps ne compte jamais (A08) : celui de la vente fait foi.
    const res = await reverse(b, till, id, {
      body: {
        reason: 'INPUT_ERROR',
        amount: 99_999,
        occurred_at: new Date().toISOString(),
        vendor_session_id: till.sessionId,
      },
    });
    expect(res.status).toBe(201);
    expect(res.json).toMatchObject({ type: 'REVERSAL', reverses_id: id, amount: 500 });
    const after = await queueState(b);
    expect(after.head.last_edge_seq).toBe(before.head.last_edge_seq + 1);
    const [op] = await b.q<{
      type: string;
      authorized_mode: string;
      operation: Record<string, any>;
    }>('SELECT type, authorized_mode, operation FROM edge_op WHERE edge_seq = $1', [
      after.head.last_edge_seq,
    ]);
    expect(op).toMatchObject({ type: 'REVERSAL', authorized_mode: 'EDGE_ONLINE' });
    expect(op!.operation).toMatchObject({ amount: 500, reverses_seq: 1 });
    expect(await balanceOf(b, bracelet.walletId)).toBe(5_000);
    const deltas = await b.q<{ d: string }>(
      `SELECT (paid_delta + promo_delta)::text AS d FROM edge_op_delta WHERE edge_seq = $1`,
      [after.head.last_edge_seq],
    );
    expect(deltas.map((r) => Number(r.d))).toEqual([500]);
  });

  it('seconde annulation de la même vente : ALREADY_REVERSED, numéro consommé (VOID)', async () => {
    const till = await newTill(b);
    const { bracelet, id } = await sold(till);
    expect((await reverse(b, till, id)).status).toBe(201);
    const before = await queueState(b);
    const again = await reverse(b, till, id);
    expect(again.status).toBe(409);
    expect(again.json!.code).toBe('ALREADY_REVERSED');
    const after = await queueState(b);
    expect(after.voids).toBe(before.voids + 1);
    expect(await balanceOf(b, bracelet.walletId)).toBe(5_000);
  });

  it('deux annulations simultanées de la même vente : un seul effet', async () => {
    const till = await newTill(b);
    const { bracelet, id } = await sold(till);
    const [r1, r2] = await Promise.all([reverse(b, till, id), reverse(b, till, id)]);
    expect([r1.status, r2.status].sort()).toEqual([201, 409]);
    expect(await balanceOf(b, bracelet.walletId)).toBe(5_000);
  });

  it('hors fenêtre (15 min) : REVERSAL_WINDOW_EXPIRED, rien n’est rendu', async () => {
    const till = await newTill(b);
    const { bracelet, id } = await sold(till);
    b.clock.advance(16 * 60_000);
    try {
      const res = await reverse(b, till, id);
      expect(res.status).toBe(409);
      expect(res.json!.code).toBe('REVERSAL_WINDOW_EXPIRED');
      expect(await balanceOf(b, bracelet.walletId)).toBe(4_500);
    } finally {
      b.clock.advance(-16 * 60_000);
    }
  });

  it('horloge reculée de 2 h après la vente : REVERSAL_WINDOW_EXPIRED, VOID, rien rendu', async () => {
    // Session valide 1 jour. La vente est faite 2 h « dans le futur » de la passerelle, puis
    // l'horloge revient : preuves et jeton restent valides (clés créées avant), seule la garde
    // `elapsedMs < 0` peut refuser.
    const device = await b.newDevice();
    const { vendorId, sessionId } = await b.newVendorSession(device, {
      expiresInMs: 24 * 3_600_000,
    });
    const till: Till = {
      device,
      vendorId,
      sessionId,
      productId: await b.newProduct(device, 500),
      seq: 0,
    };
    // Échauffement à l'heure réelle : crée les clés de la passerelle avant tout saut.
    expect((await reverse(b, till, randomUUID())).status).toBe(404);
    b.clock.advance(2 * 3_600_000);
    let bracelet, id: string;
    try {
      ({ bracelet, id } = await sold(till));
    } finally {
      b.clock.advance(-2 * 3_600_000);
    }
    const before = await queueState(b);
    const res = await reverse(b, till, id);
    expect(res.status).toBe(409);
    expect(res.json!.code).toBe('REVERSAL_WINDOW_EXPIRED');
    expect(await balanceOf(b, bracelet.walletId)).toBe(4_500);
    const after = await queueState(b);
    expect(after.voids).toBe(before.voids + 1);
    expect(after.ops).toBe(before.ops + 1);
  });

  it('vente inconnue : 404 ; vente d’un autre terminal : REVERSAL_NOT_ALLOWED exact', async () => {
    const till = await newTill(b);
    const { id } = await sold(till);
    expect((await reverse(b, till, randomUUID())).status).toBe(404);
    // Même vendeur (identifiant), mais une session ouverte sur un autre terminal.
    const otherDevice = await b.newDevice();
    const otherSessionId = randomUUID();
    await b.q(
      `INSERT INTO edge_vendor_session (vendor_session_id, vendor_id, device_id, expires_at)
       VALUES ($1, $2, $3, now() + interval '1 hour')`,
      [otherSessionId, till.vendorId, otherDevice.deviceId],
    );
    const other: Till = {
      device: otherDevice,
      vendorId: till.vendorId,
      sessionId: otherSessionId,
      productId: till.productId,
      seq: 0,
    };
    const theirs = await reverse(b, other, id);
    expect(theirs.status).toBe(422);
    expect(theirs.json!.code).toBe('REVERSAL_NOT_ALLOWED');
    // Un autre vendeur sur le même terminal.
    const second = await b.newVendorSession(till.device);
    const res = await reverse(b, till, id, { vendorSession: second.sessionId });
    expect(res.status).toBe(422);
    expect(res.json!.code).toBe('REVERSAL_NOT_ALLOWED');
  });

  it('session de vendeur expirée : 409 VENDOR_SESSION_INVALID, VOID consommé, rien rendu', async () => {
    const till = await newTill(b);
    const { bracelet, id } = await sold(till);
    const expired = await b.newVendorSession(till.device, { expiresInMs: -60_000 });
    const before = await queueState(b);
    const res = await reverse(b, till, id, { vendorSession: expired.sessionId });
    expect(res.status).toBe(409);
    expect(res.json!.code).toBe('VENDOR_SESSION_INVALID');
    expect((await queueState(b)).voids).toBe(before.voids + 1);
    expect(await balanceOf(b, bracelet.walletId)).toBe(4_500);
  });

  it('session de vendeur absente ou invalide : VOID ou 409 VENDOR_SESSION_INVALID', async () => {
    const till = await newTill(b);
    const { id } = await sold(till);
    const none = await reverse(b, till, id, { vendorSession: null });
    expect(none.status).toBe(409);
    expect(none.json!.code).toBe('VENDOR_SESSION_INVALID');
    const closed = await b.newVendorSession(till.device, { closed: true });
    const res = await reverse(b, till, id, { vendorSession: closed.sessionId });
    expect(res.json!.code).toBe('VENDOR_SESSION_INVALID');
  });
});

describe('X-Approval-Token et autorité', () => {
  it('jeton d’approbation présenté : 403 APPROVAL_INVALID, rien d’écrit, aucun numéro', async () => {
    const till = await newTill(b);
    const { bracelet, id } = await sold(till);
    const before = await queueState(b);
    const res = await reverse(b, till, id, { headers: { 'x-approval-token': 'abc.def.ghi' } });
    expect(res.status).toBe(403);
    expect(res.json!.code).toBe('APPROVAL_INVALID');
    const after = await queueState(b);
    expect(after.head).toEqual(before.head);
    expect(after.ops).toBe(before.ops);
    expect(after.idempotency).toBe(before.idempotency);
    expect(await balanceOf(b, bracelet.walletId)).toBe(4_500);
  });

  it('époque périmée ou hors ACTIVE : refus avant toute écriture, aucun numéro', async () => {
    const till = await newTill(b);
    const { id } = await sold(till);
    const before = await queueState(b);
    const stale = await reverse(b, till, id, { epoch: 2 });
    expect(stale.json!.code).toBe('STALE_AUTHORITY_EPOCH');
    const missing = await reverse(b, till, id, { epoch: null });
    expect(missing.status).toBeGreaterThanOrEqual(400);
    await b.setAuthority({ state: 'RELEASING' });
    try {
      const moving = await reverse(b, till, id);
      expect(moving.json!.code).toBe('DEBIT_AUTHORITY_MOVING');
    } finally {
      await b.setAuthority({ state: 'ACTIVE' });
    }
    const after = await queueState(b);
    expect(after.head).toEqual(before.head);
    expect(after.ops).toBe(before.ops);
  });
});
