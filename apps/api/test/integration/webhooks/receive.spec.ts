// Intégration : réception des notifications (lot WP12, T060, T061 ; FR-014, FR-015 ; A2, A4, A13, A19).
// HTTPS réel, vraie base, faux PSP signeur de WP07, fixtures de WP11 réutilisées.
import { randomUUID } from 'node:crypto';
import { fakeEvents } from '../../../src/psp/fake/fake-notification-signer';
import { ownerRows } from '../../support/media-fixtures';
import { ageTopup, closeBacklog, startPoller, topupWithId, WebhookWorld } from './webhook-fixtures';

jest.setTimeout(60_000);

describe('réception des notifications de PSP', () => {
  let w: WebhookWorld;

  beforeAll(async () => {
    w = await WebhookWorld.create();
    await closeBacklog();
  }, 240_000);
  afterAll(async () => {
    await w.close();
  });

  const setStatus = (configId: string, status: 'ACTIVE' | 'SUSPENDED') =>
    ownerRows('UPDATE psp_configuration SET status = $2 WHERE psp_configuration_id = $1', [
      configId,
      status,
    ]);

  it('succès Wave : 200, un TOPUP, recharge SUCCEEDED, événement PROCESSED', async () => {
    const t = await w.p.topup({ method: 'WAVE' });
    const res = await w.post(w.event(t.row), { method: 'WAVE' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true, duplicate: false });
    expect((await w.p.read(t.row.topupId))?.status).toBe('SUCCEEDED');
    expect(await w.p.transactions(t.row.topupId)).toHaveLength(1);
    const events = await w.events(t.row.configurationId);
    expect(events.at(-1)).toMatchObject({ status: 'PROCESSED', outcome: 'CREDITED' });
  });

  it('succès Orange Money puis carte : un TOPUP chacun', async () => {
    const om = await w.p.topup({ method: 'ORANGE_MONEY' });
    expect((await w.post(w.event(om.row), { method: 'ORANGE_MONEY' })).status).toBe(200);
    expect((await w.p.read(om.row.topupId))?.status).toBe('SUCCEEDED');
    expect(await w.p.transactions(om.row.topupId)).toHaveLength(1);

    const card = await w.p.topup({ method: 'CARD' });
    expect((await w.post(w.event(card.row), { method: 'CARD' })).status).toBe(200);
    expect((await w.p.read(card.row.topupId))?.status).toBe('SUCCEEDED');
    expect(await w.p.transactions(card.row.topupId)).toHaveLength(1);
  });

  it('rejeu : duplicate true, une seule ligne psp_event, aucun second traitement', async () => {
    const t = await w.p.topup();
    const event = w.event(t.row, { id: `evt-dup-${randomUUID()}` });
    expect((await w.post(event)).body).toEqual({ received: true, duplicate: false });
    const again = await w.post(event);
    expect(again.status).toBe(200);
    expect(again.body).toEqual({ received: true, duplicate: true });
    const rows = await ownerRows(
      'SELECT 1 FROM psp_event WHERE psp_configuration_id = $1 AND provider_event_id = $2',
      [t.row.configurationId, event.id],
    );
    expect(rows).toHaveLength(1);
    expect(await w.p.transactions(t.row.topupId)).toHaveLength(1);
  });

  it('dix rejeux simultanés du même identifiant : une ligne, un TOPUP, un seul « duplicate: false »', async () => {
    const t = await w.p.topup();
    const event = w.event(t.row, { id: `evt-race-${randomUUID()}` });
    const results = await Promise.all(Array.from({ length: 10 }, () => w.post(event)));
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(results.filter((r) => r.body.duplicate === false)).toHaveLength(1);
    expect(await w.p.transactions(t.row.topupId)).toHaveLength(1);
    expect(await w.events(t.row.configurationId)).toEqual(
      expect.arrayContaining([expect.objectContaining({ provider_event_id: event.id })]),
    );
  });

  it('deux identifiants pour un même paiement : un seul TOPUP, le second est un doublon de paiement', async () => {
    const t = await w.p.topup();
    const a = w.event(t.row, { id: `evt-a-${randomUUID()}` });
    const b = w.event(t.row, { id: `evt-b-${randomUUID()}` });
    const [ra, rb] = await Promise.all([w.post(a), w.post(b)]);
    expect([ra.status, rb.status]).toEqual([200, 200]);
    expect(await w.p.transactions(t.row.topupId)).toHaveLength(1);
    const outcomes = (await w.events(t.row.configurationId))
      .filter((e) => [a.id, b.id].includes(e.provider_event_id))
      .map((e) => e.outcome)
      .sort();
    expect(outcomes).toEqual(['CREDITED', 'DUPLICATE_PAYMENT']);
  });

  it('nouvelle notification après SUCCEEDED : sans effet sur le grand livre', async () => {
    const t = await w.p.topup();
    await w.post(w.event(t.row));
    const failed = await w.post(w.event(t.row, { type: 'failed' }));
    expect(failed.status).toBe(200);
    expect((await w.p.read(t.row.topupId))?.status).toBe('SUCCEEDED');
    expect(await w.p.transactions(t.row.topupId)).toHaveLength(1);
  });

  it('configuration SUSPENDED : notification refusée (404), recharge PENDING encore suivie par le travailleur', async () => {
    const t = await w.p.topup({ method: 'ORANGE_MONEY' });
    const before = await w.footprint();
    await setStatus(t.row.configurationId, 'SUSPENDED');
    try {
      const res = await w.post(w.event(t.row), { method: 'ORANGE_MONEY' });
      expect(res.status).toBe(404);
      expect(await w.footprint()).toEqual(before);
      expect((await w.p.read(t.row.topupId))?.status).toBe('PENDING');

      // A15 : l'interrogation ne filtre pas sur le statut de la configuration.
      await ageTopup(t.row.topupId);
      const adapter = w.p.adapter('ORANGE_MONEY');
      const proc = await startPoller(w);
      try {
        // Le faux ne connaît la recharge que par `initiate` : on la lui apprend, payée.
        (adapter as unknown as { payments: Map<string, unknown> }).payments.set(t.row.topupId, {
          state: 'PAID',
          payment: {
            merchantReference: t.row.topupId,
            providerPaymentRef: 'pay-suspended-1',
            amount: t.row.amount,
            currency: t.row.currency,
            card: null,
          },
        });
        expect(await proc.poller.runOnce()).toBeGreaterThanOrEqual(1);
      } finally {
        await proc.close();
      }
      expect((await w.p.read(t.row.topupId))?.status).toBe('SUCCEEDED');
      expect(await w.p.transactions(t.row.topupId)).toHaveLength(1);
    } finally {
      await setStatus(t.row.configurationId, 'ACTIVE');
    }
  });

  it('notification avant la recharge (A2) : conservée UNMATCHED, reprise par le travailleur, un seul TOPUP', async () => {
    const topupId = randomUUID();
    const event = fakeEvents.succeeded({
      id: `evt-early-${randomUUID()}`,
      merchantReference: topupId,
      paymentId: `pay-early-${topupId.slice(0, 8)}`,
      amount: 10000,
      currency: 'XOF',
    });
    const res = await w.post(event);
    expect(res.status).toBe(200);
    const kept = (await w.events(w.p.configs.WAVE)).find((e) => e.provider_event_id === event.id);
    expect(kept).toMatchObject({ status: 'UNMATCHED', attempts: 0 });

    await topupWithId(w, topupId);
    const proc = await startPoller(w);
    try {
      expect(await proc.retry.runOnce()).toBeGreaterThanOrEqual(1);
      expect(await proc.retry.runOnce()).toBe(0);
    } finally {
      await proc.close();
    }
    expect((await w.p.read(topupId))?.status).toBe('SUCCEEDED');
    expect(await w.p.transactions(topupId)).toHaveLength(1);
    const after = (await w.events(w.p.configs.WAVE)).find((e) => e.provider_event_id === event.id);
    expect(after).toMatchObject({ status: 'PROCESSED', outcome: 'CREDITED' });
  });

  it('erreur injectée dans le processeur : 200, événement RETRY, aucune écriture au grand livre', async () => {
    const t = await w.p.topup();
    const spy = jest.spyOn(w.p.processor, 'process').mockRejectedValueOnce(new Error('boom'));
    try {
      const res = await w.post(w.event(t.row, { id: `evt-boom-${randomUUID()}` }));
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ received: true, duplicate: false });
    } finally {
      spy.mockRestore();
    }
    const stored = (await w.events(t.row.configurationId)).at(-1);
    expect(stored).toMatchObject({ status: 'RETRY', attempts: 1 });
    expect(await w.p.transactions(t.row.topupId)).toHaveLength(0);
    expect((await w.p.read(t.row.topupId))?.status).toBe('PENDING');
  });

  it('type inconnu du fournisseur : conservé, sans effet, 200', async () => {
    const t = await w.p.topup();
    const event = { ...w.event(t.row, { id: `evt-unk-${randomUUID()}` }), type: 'payout.created' };
    const res = await w.post(event);
    expect(res.status).toBe(200);
    expect((await w.events(t.row.configurationId)).at(-1)).toMatchObject({
      kind: 'UNKNOWN',
      status: 'PROCESSED',
      outcome: 'NO_EFFECT',
    });
    expect(await w.p.transactions(t.row.topupId)).toHaveLength(0);
  });

  it('contestation sans gestionnaire (avant WP13) : conservée RECEIVED, sans essai', async () => {
    const t = await w.p.topup({ method: 'CARD' });
    await w.post(w.event(t.row, { id: `evt-pay-${randomUUID()}` }), { method: 'CARD' });
    const dispute = fakeEvents.dispute({
      id: `evt-dispute-${randomUUID()}`,
      merchantReference: t.row.topupId,
      paymentId: `pay-${t.row.topupId.slice(0, 8)}`,
      amount: Number(t.row.amount),
      currency: t.row.currency,
      disputeId: `dp-${randomUUID()}`,
      disputeAmount: 1000,
    });
    const res = await w.post(dispute, { method: 'CARD' });
    expect(res.status).toBe(200);
    const kept = (await w.events(t.row.configurationId)).find(
      (e) => e.provider_event_id === dispute.id,
    );
    expect(kept).toMatchObject({ kind: 'DISPUTE', status: 'RECEIVED', attempts: 0 });
  });
});
