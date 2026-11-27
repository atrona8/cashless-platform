// Intégration : litige à relire, rattaché à la recharge par `resolvePaymentReference` (mission 12b-1, lot WP03,
// cycle 2 ; décision du porteur du 26/11/2026). Faux PSP carte dont le litige est `confirmationRequired` et ne porte
// que le PaymentIntent. Aucun appel réseau.
import { randomUUID } from 'node:crypto';
import { FakePspAdapter } from '../../../src/psp/fake/fake-psp-adapter';
import { fakeEvents } from '../../../src/psp/fake/fake-notification-signer';
import type { PspVerification, VerifyNotificationInput } from '../../../src/psp/psp-adapter.port';
import { PspAdapterRegistry } from '../../../src/psp/psp-adapter-registry';
import { PSP_ADAPTERS } from '../../../src/psp/psp.tokens';
import { PSP_PROVIDERS } from '../../../src/psp/psp.types';
import { EventDispatcher } from '../../../src/webhooks/event-dispatcher';
import { decodeNormalized } from '../../../src/webhooks/normalized-codec';
import { ownerRows } from '../../support/media-fixtures';
import { closeBacklog, closePending, WebhookWorld } from '../webhooks/webhook-fixtures';

jest.setTimeout(90_000);

/** Faux STRIPE : un litige est « à relire » et ne désigne que le PaymentIntent (comme l'adaptateur réel). */
class DisputeByReadingAdapter extends FakePspAdapter {
  resolvePaymentReference = jest.fn(
    (
      _reference: string,
    ): Promise<{ merchantReference: string; providerPaymentRef: string } | null> =>
      Promise.resolve(null),
  );

  override verifyNotification(input: VerifyNotificationInput): PspVerification {
    const verdict = super.verifyNotification(input);
    if (!verdict.ok || verdict.kind !== 'NOTIFICATION' || verdict.notification.kind !== 'DISPUTE')
      return verdict;
    const { payment } = verdict.notification;
    return {
      ...verdict,
      confirmationRequired: true,
      notification: {
        ...verdict.notification,
        payment: { ...payment, merchantReference: null, providerPaymentRef: `pi_${randomUUID()}` },
      },
    };
  }
}

const stripe = new DisputeByReadingAdapter('STRIPE');
const registry = new PspAdapterRegistry(
  PSP_PROVIDERS.map((p) => (p === 'STRIPE' ? stripe : new FakePspAdapter(p))),
  true,
);

describe('litige à relire (Stripe) : rattaché à la recharge par la relecture', () => {
  let w: WebhookWorld;

  beforeAll(async () => {
    w = await WebhookWorld.create([{ provide: PSP_ADAPTERS, useValue: registry }]);
    await closeBacklog();
    await closePending();
  }, 240_000);
  afterAll(async () => {
    await w.close();
  });
  beforeEach(() => stripe.resolvePaymentReference.mockReset());

  const chargebacks = (topupId: string) =>
    ownerRows<{ n: number }>(
      'SELECT count(*)::int AS n FROM psp_chargeback WHERE psp_topup_id = $1',
      [topupId],
    ).then((rows) => rows[0]!.n);
  const until = async (condition: () => Promise<boolean> | boolean, ms = 8000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await condition()) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error('condition non atteinte');
  };

  async function creditedTopup() {
    const t = await w.p.topup({ method: 'CARD' });
    expect(
      (await w.post(w.event(t.row, { id: `evt-${randomUUID()}` }), { method: 'CARD' })).status,
    ).toBe(200);
    expect((await w.p.read(t.row.topupId))?.status).toBe('SUCCEEDED');
    return t.row;
  }
  const dispute = (t: { topupId: string; amount: bigint; currency: string }) =>
    fakeEvents.dispute({
      id: `evt-dp-${randomUUID()}`,
      merchantReference: t.topupId,
      paymentId: `pay-${t.topupId.slice(0, 8)}`,
      amount: Number(t.amount),
      currency: t.currency,
      disputeId: `dp-${randomUUID()}`,
      disputeAmount: 1000,
    });

  /** Dernier événement du litige : état en base. */
  const lastEvent = async (configId: string) => (await w.events(configId)).at(-1)!;

  /** Rejoue l'événement comme le fait la reprise (`EventDispatcher.apply`, notification relue de la base). */
  async function retry(configId: string, eventId: string, expireUnmatched = false) {
    const [row] = await ownerRows<{ normalized: unknown; received_at: Date; operator_id: string }>(
      'SELECT normalized, received_at, operator_id FROM psp_event WHERE psp_event_id = $1',
      [eventId],
    );
    const dispatcher = w.p.sw.api.app.get(EventDispatcher, { strict: false });
    return dispatcher.apply(
      {
        pspEventId: eventId,
        operatorId: row!.operator_id,
        configurationId: configId,
        receivedAt: row!.received_at,
      },
      decodeNormalized(row!.normalized)!,
      { expireUnmatched },
    );
  }

  it('résolution trouvée : rien d’écrit avant la relecture, puis litige enregistré et événement traité', async () => {
    const row = await creditedTopup();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    stripe.resolvePaymentReference.mockImplementation(async () => {
      await gate;
      return { merchantReference: row.topupId, providerPaymentRef: `cs_${randomUUID()}` };
    });
    const before = await w.footprint();
    const res = await w.post(dispute(row), { method: 'CARD' });
    expect(res.status).toBe(200);
    const after = await w.footprint();
    expect(after.journal_transaction).toBe(before.journal_transaction);
    expect(after.posting).toBe(before.posting);
    expect(await chargebacks(row.topupId)).toBe(0);
    expect(await lastEvent(row.configurationId)).toMatchObject({ kind: 'DISPUTE' });
    await until(() => stripe.resolvePaymentReference.mock.calls.length === 1);
    expect(stripe.resolvePaymentReference.mock.calls[0]![0]).toMatch(/^pi_/);
    release();
    await until(async () => (await chargebacks(row.topupId)) === 1);
    expect(await lastEvent(row.configurationId)).toMatchObject({
      status: 'PROCESSED',
      outcome: 'CHARGEBACK',
    });
  });

  it('non rattaché (résolution `null`) : UNMATCHED, jamais traité, aucune écriture', async () => {
    const row = await creditedTopup();
    stripe.resolvePaymentReference.mockResolvedValue(null);
    const before = await w.footprint();
    expect((await w.post(dispute(row), { method: 'CARD' })).status).toBe(200);
    await until(async () => (await lastEvent(row.configurationId)).status === 'UNMATCHED');
    expect(await chargebacks(row.topupId)).toBe(0);
    const after = await w.footprint();
    expect(after.journal_transaction).toBe(before.journal_transaction);
    expect(after.posting).toBe(before.posting);
  });

  it('adaptateur sans `resolvePaymentReference` : UNMATCHED', async () => {
    const row = await creditedTopup();
    const saved = stripe.resolvePaymentReference;
    (stripe as { resolvePaymentReference?: unknown }).resolvePaymentReference = undefined;
    try {
      expect((await w.post(dispute(row), { method: 'CARD' })).status).toBe(200);
      await until(async () => (await lastEvent(row.configurationId)).status === 'UNMATCHED');
      expect(await chargebacks(row.topupId)).toBe(0);
    } finally {
      stripe.resolvePaymentReference = saved;
    }
  });

  it('erreur de résolution : UNMATCHED, journal sans secret', async () => {
    const row = await creditedTopup();
    stripe.resolvePaymentReference.mockRejectedValue(new Error('cle-secrete-xyz'));
    const lines: string[] = [];
    const { Logger } = await import('@nestjs/common');
    jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(((m: unknown) => lines.push(String(m))) as never);
    expect((await w.post(dispute(row), { method: 'CARD' })).status).toBe(200);
    await until(async () => (await lastEvent(row.configurationId)).status === 'UNMATCHED');
    expect(lines.join('\n')).toContain('psp.dispute.confirm_failed');
    expect(lines.join('\n')).not.toContain('cle-secrete-xyz');
    expect(await chargebacks(row.topupId)).toBe(0);
    jest.restoreAllMocks();
  });

  it('non rattaché après 24 h : anomalie UNMATCHED_EXPIRED, une seule fois', async () => {
    const row = await creditedTopup();
    stripe.resolvePaymentReference.mockResolvedValue(null);
    const d = dispute(row);
    await w.post(d, { method: 'CARD' });
    await until(async () => (await lastEvent(row.configurationId)).status === 'UNMATCHED');
    const { psp_event_id: eventId } = await lastEvent(row.configurationId);
    const anomalies = () =>
      ownerRows<{ n: number }>(
        `SELECT count(*)::int AS n FROM audit_log WHERE action = 'PSP_TOPUP_NOT_CREDITED'
          AND object_type = 'psp_dispute' AND object_id = $1`,
        [`${row.configurationId}:${(d.dispute as { id: string }).id}`],
      ).then((r) => r[0]!.n);
    expect(await anomalies()).toBe(0);
    // Reprise avant 24 h : toujours UNMATCHED. Après 24 h : anomalie, une fois.
    await retry(row.configurationId, eventId);
    expect(await anomalies()).toBe(0);
    await retry(row.configurationId, eventId, true);
    await retry(row.configurationId, eventId, true);
    expect(await anomalies()).toBe(1);
    expect(await chargebacks(row.topupId)).toBe(0);
  });

  it('rattaché à une tentative suivante : répartiteur appelé une seule fois', async () => {
    const row = await creditedTopup();
    stripe.resolvePaymentReference.mockResolvedValueOnce(null);
    await w.post(dispute(row), { method: 'CARD' });
    await until(async () => (await lastEvent(row.configurationId)).status === 'UNMATCHED');
    const { psp_event_id: eventId } = await lastEvent(row.configurationId);
    expect(await chargebacks(row.topupId)).toBe(0);
    // Le PSP sait maintenant (la borne d'une minute est écoulée).
    stripe.resolvePaymentReference.mockResolvedValue({
      merchantReference: row.topupId,
      providerPaymentRef: `cs_${randomUUID()}`,
    });
    const realNow = Date.now();
    jest.spyOn(Date, 'now').mockImplementation(() => realNow + 61_000);
    expect(await retry(row.configurationId, eventId)).toBe('PROCESSED');
    expect(await retry(row.configurationId, eventId)).toBe('PROCESSED');
    jest.restoreAllMocks();
    expect(await chargebacks(row.topupId)).toBe(1);
    expect(stripe.resolvePaymentReference).toHaveBeenCalledTimes(2);
  });
});
