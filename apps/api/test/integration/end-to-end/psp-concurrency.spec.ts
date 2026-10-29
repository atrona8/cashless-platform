// Concurrence des notifications et des recharges PSP, par la vraie route HTTP (mission 6, lot WP14, T071 ;
// NFR-001, NFR-008, SC-003). Ordre des verrous : recharge -> portefeuille -> comptes (caisse -> session côté espèces).
// Chaque cas compte les écritures EXACTES et vérifie l'absence d'écriture partielle (grand livre en équilibre).
// Les requêtes sont signées d'avance puis lancées ensemble (`Promise.all` sur des requêtes déjà émises). Lancé en
// série avec le reste, jamais en parallèle d'une autre suite.
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { fakeEvents, signFakeNotification } from '../../../src/psp/fake/fake-notification-signer';
import { ledgerIsSound, ownerRows } from '../../support/media-fixtures';
import { ChargebackWorld } from '../chargebacks/chargeback-fixtures';
import { registerPayment } from '../webhooks/poll-fixtures';
import {
  ageTopup,
  closeBacklog,
  startPoller,
  type PollerProcess,
} from '../webhooks/webhook-fixtures';

jest.setTimeout(600_000);

describe('NFR-001, SC-003 : concurrence des notifications et des recharges PSP', () => {
  let c: ChargebackWorld;
  let poller: PollerProcess;
  const p = () => c.p;
  const pay = (topup: { providerPaymentRef: string | null; topupId: string }, amount: number) =>
    fakeEvents.succeeded({
      id: `evt-${randomUUID()}`,
      merchantReference: topup.topupId,
      paymentId: topup.providerPaymentRef ?? `pay-${topup.topupId.slice(0, 8)}`,
      amount,
      currency: 'XOF',
    });
  /** Corps et en-têtes signés d'avance (secret courant de la configuration). */
  const signed = async (event: ReturnType<typeof pay>, method: 'WAVE' | 'CARD' = 'WAVE') => {
    const s = signFakeNotification({
      provider: method === 'CARD' ? 'STRIPE' : 'WAVE',
      secret: await c.w.secretOf(method),
      event,
    });
    return { body: s.rawBody.toString('utf8'), headers: s.headers };
  };
  const send = (
    s: { body: string; headers: Record<string, string> },
    method: 'WAVE' | 'CARD' = 'WAVE',
  ) => c.w.raw(s.body, s.headers, { method });

  beforeAll(async () => {
    c = await ChargebackWorld.create();
    await closeBacklog();
    poller = await startPoller(c.w);
  }, 300_000);
  afterAll(async () => {
    await poller?.close();
    await c?.close();
  });
  afterEach(async () => {
    expect(await ledgerIsSound(p().ev.ledgerId)).toEqual({ unbalanced: 0, drift: 0 });
  });

  it('100 rejeux concurrents de la même notification : 1 psp_event, 1 TOPUP, 99 duplicate, crédité une fois', async () => {
    const t = await p().topup({ amount: 12_000 });
    const event = pay({ ...t.row, providerPaymentRef: `pay-${randomUUID()}` }, 12_000);
    const s = await signed(event);
    const results = await Promise.all(Array.from({ length: 100 }, () => send(s)));
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(results.filter((r) => r.body.duplicate === true)).toHaveLength(99);
    expect(
      await ownerRows(`SELECT 1 FROM psp_event WHERE provider_event_id = $1`, [event.id]),
    ).toHaveLength(1);
    expect(await p().transactions(t.row.topupId)).toHaveLength(1);
    const row = (await p().read(t.row.topupId))!;
    expect(row.status).toBe('SUCCEEDED');
    expect(await p().paidBalance(t.walletId)).toBe(Number(row.amount - row.feeAmount!));
  });

  it('100 notifications d’identifiants distincts pour le même paiement + interrogation : 1 TOPUP, 1 SUCCEEDED', async () => {
    const t = await p().topup({ amount: 9_000 });
    const ref = await registerPayment(c.w, t.row, 'PAID');
    await ageTopup(t.row.topupId);
    const batch = await Promise.all(
      Array.from({ length: 100 }, () => signed(pay({ ...t.row, providerPaymentRef: ref }, 9_000))),
    );
    const runs = await Promise.all([
      ...batch.map((s) => send(s)),
      poller.poller.runOnce().then(() => null),
    ]);
    expect(runs.filter((r) => r !== null).every((r) => r!.status === 200)).toBe(true);
    expect(await p().transactions(t.row.topupId)).toHaveLength(1);
    expect(await p().read(t.row.topupId)).toMatchObject({ status: 'SUCCEEDED' });
  });

  it('notification mêlée à l’annulation (cancelPspTopup pendant le succès) : un seul état final cohérent', async () => {
    const terminal = await c.cw.terminal();
    await c.cw.open(terminal, c.cw.w.cashierA);
    const wallet = await p().wallet();
    const created = await c.cw.term(
      terminal,
      'POST',
      '/topups/psp',
      c.cw.w.cashierA,
      p().body(wallet.walletId, { amount: 8000 }),
    );
    expect(created.status).toBe(201);
    const row = (await p().read(String(created.body.topup_id)))!;
    const s = await signed(pay(row, 8000));
    const [notified, cancelled] = await Promise.all([
      send(s),
      c.cw.term(terminal, 'POST', `/topups/psp/${row.topupId}/cancel`, c.cw.w.cashierA, {}),
    ]);
    expect(notified.status).toBe(200);
    expect([200, 409]).toContain(cancelled.status);
    const txs = await p().transactions(row.topupId);
    const after = (await p().read(row.topupId))!;
    // Un succès authentifié crédite quel que soit l'ordre (R-20) : état final SUCCEEDED, un seul TOPUP.
    expect(after.status).toBe('SUCCEEDED');
    expect(txs).toHaveLength(1);
    expect(await p().paidBalance(wallet.walletId)).toBe(Number(after.amount - after.feeAmount!));
  });

  it('plafond par carte : deux recharges de la même empreinte qui dépassent ensemble le jour : une créditée, une anomalie', async () => {
    await ownerRows('UPDATE event SET card_topup_daily_max_per_card = $2 WHERE id = $1', [
      p().ev.eventId,
      30_000,
    ]);
    const fingerprint = `fp-${randomUUID()}`;
    const a = await p().topup({ method: 'CARD', amount: 20_000 });
    const b = await p().topup({ method: 'CARD', amount: 20_000 });
    const card = { fingerprint, threeDs: 'SUCCEEDED' };
    const sa = await signed(c.w.event(a.row, { card }), 'CARD');
    const sb = await signed(c.w.event(b.row, { card }), 'CARD');
    const [ra, rb] = await Promise.all([send(sa, 'CARD'), send(sb, 'CARD')]);
    expect([ra.status, rb.status]).toEqual([200, 200]);
    const states = [
      (await p().read(a.row.topupId))!.status,
      (await p().read(b.row.topupId))!.status,
    ].sort();
    expect(states).toEqual(['FAILED', 'SUCCEEDED']);
    const failed = (await p().read(a.row.topupId))!.status === 'FAILED' ? a.row : b.row;
    expect(await p().transactions(failed.topupId)).toEqual([]);
    expect((await p().read(failed.topupId))!.anomalyId).not.toBeNull();
  });

  it('contestation : 20 notifications DISPUTE identiques par la route : 1 CHARGEBACK', async () => {
    const credited = await c.credited({ amount: 10_000 });
    const disputeId = c.disputeId();
    const event = fakeEvents.dispute({
      id: `evt-dp-${randomUUID()}`,
      merchantReference: credited.row.topupId,
      paymentId: `pay-${credited.row.topupId.slice(0, 8)}`,
      amount: Number(credited.row.amount),
      currency: credited.row.currency,
      disputeId,
      disputeAmount: 1000,
    });
    const s = await signed(event, 'CARD');
    const results = await Promise.all(Array.from({ length: 20 }, () => send(s, 'CARD')));
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(await c.chargebackTxs(credited.row.configurationId, disputeId)).toHaveLength(1);
    expect(await c.chargebacks(credited.row.topupId)).toHaveLength(1);
  });
});
