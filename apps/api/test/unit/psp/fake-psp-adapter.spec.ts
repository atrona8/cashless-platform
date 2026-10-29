import { fakeEvents, signFakeNotification } from '../../../src/psp/fake/fake-notification-signer';
import { FakePspAdapter } from '../../../src/psp/fake/fake-psp-adapter';
import { PspProviderError } from '../../../src/psp/psp-errors';
import type { PspSecrets } from '../../../src/psp/psp-secret-store.port';
import {
  PROVIDER_METHOD,
  PSP_PROVIDERS,
  providerFromPathSegment,
} from '../../../src/psp/psp.types';
import { Secret } from '../../../src/psp/secret';

const SECRET = 'secret-de-test';
const secrets: PspSecrets = {
  adapter: null,
  notification: { current: Secret.of(SECRET), previous: null, previousValidUntil: null },
};
const NOW = new Date();
const base = {
  id: 'evt1',
  merchantReference: 'top1',
  paymentId: 'pay1',
  amount: 5000,
  currency: 'XOF',
};
const request = (provider: (typeof PSP_PROVIDERS)[number]) => ({
  pspTopupId: 'top1',
  method: PROVIDER_METHOD[provider],
  amount: 5000n,
  currency: 'XOF',
  payerMsisdn: null,
  returnUrl: null,
  notificationUrl: 'https://api.example/n',
});
const verify = (adapter: FakePspAdapter, signed: ReturnType<typeof signFakeNotification>) =>
  adapter.verifyNotification({
    rawBody: signed.rawBody,
    headers: signed.headers,
    secrets,
    now: NOW,
  });

afterEach(() => jest.restoreAllMocks());

describe.each(PSP_PROVIDERS)('faux %s', (provider) => {
  const adapter = new FakePspAdapter(provider);

  it.each([
    ['succeeded', 'PAYMENT_SUCCEEDED'],
    ['failed', 'PAYMENT_FAILED'],
    ['cancelled', 'PAYMENT_CANCELLED'],
  ] as const)('%s', (name, kind) => {
    const signed = signFakeNotification({
      provider,
      secret: SECRET,
      event: fakeEvents[name](base),
    });
    const result = verify(adapter, signed);
    expect(result).toMatchObject({ ok: true, notification: { kind, notificationId: 'evt1' } });
  });

  it('contestation', () => {
    const event = fakeEvents.dispute({
      ...base,
      merchantReference: null,
      disputeId: 'dp1',
      disputeAmount: 1000,
    });
    const result = verify(adapter, signFakeNotification({ provider, secret: SECRET, event }));
    expect(result).toMatchObject({
      ok: true,
      notification: {
        kind: 'DISPUTE',
        dispute: { providerDisputeId: 'dp1', amount: 1000n },
        payment: { merchantReference: null },
      },
    });
  });

  it('type inconnu -> UNKNOWN', () => {
    const event = { ...fakeEvents.succeeded(base), type: 'refund.created' };
    const result = verify(adapter, signFakeNotification({ provider, secret: SECRET, event }));
    expect(result).toMatchObject({ ok: true, notification: { kind: 'UNKNOWN' } });
  });
});

describe('en-têtes', () => {
  it('deux noms d’en-tête, recherche insensible à la casse, premier en-tête pris', () => {
    const wave = signFakeNotification({
      provider: 'WAVE',
      secret: SECRET,
      event: fakeEvents.succeeded(base),
    });
    const stripe = signFakeNotification({
      provider: 'STRIPE',
      secret: SECRET,
      event: fakeEvents.succeeded(base),
    });
    expect(wave.headerName).toBe('wave-signature');
    for (const p of ['ORANGE_MONEY', 'PAYDUNYA', 'STRIPE'] as const)
      expect(signFakeNotification({ provider: p, secret: SECRET, event: {} }).headerName).toBe(
        'x-webhook-signature',
      );
    const w = new FakePspAdapter('WAVE');
    const upper = { 'Wave-Signature': wave.headers['wave-signature'] };
    expect(
      w.verifyNotification({ rawBody: wave.rawBody, headers: upper, secrets, now: NOW }).ok,
    ).toBe(true);
    // Mauvais nom d'en-tête pour le fournisseur : absent.
    expect(
      w.verifyNotification({ rawBody: stripe.rawBody, headers: stripe.headers, secrets, now: NOW }),
    ).toEqual({
      ok: false,
      reason: 'SIGNATURE_MISSING',
    });
    const first = new FakePspAdapter('STRIPE').verifyNotification({
      rawBody: stripe.rawBody,
      headers: {
        'x-webhook-signature': [stripe.headers['x-webhook-signature'] ?? '', 't=1,v1=00'],
      },
      secrets,
      now: NOW,
    });
    expect(first.ok).toBe(true);
  });
});

describe('normalisation et cohérence avec getStatus', () => {
  const adapter = new FakePspAdapter('STRIPE');

  it.each([
    ['3-D Secure réussi', { fingerprint: 'fp1', threeDs: 'SUCCEEDED' }, 'fp1', 'SUCCEEDED'],
    ['sans 3-D Secure', { fingerprint: 'fp1' }, 'fp1', 'NOT_PERFORMED'],
    ['sans empreinte', { threeDs: 'SUCCEEDED' }, null, 'SUCCEEDED'],
    ['3-D Secure échoué', { fingerprint: 'fp1', threeDs: 'FAILED' }, 'fp1', 'FAILED'],
    ['valeur inconnue', { fingerprint: 'fp1', threeDs: 'MAYBE' }, 'fp1', 'NOT_PERFORMED'],
  ])('carte : %s', (_n, card, fingerprint, threeDs) => {
    const signed = signFakeNotification({
      provider: 'STRIPE',
      secret: SECRET,
      event: fakeEvents.succeeded({ ...base, card }),
    });
    const result = verify(adapter, signed);
    expect(result).toMatchObject({
      ok: true,
      notification: { payment: { card: { fingerprint, threeDs } } },
    });
  });

  it('carte absente -> null', () => {
    const signed = signFakeNotification({
      provider: 'STRIPE',
      secret: SECRET,
      event: fakeEvents.succeeded(base),
    });
    expect(verify(adapter, signed)).toMatchObject({
      ok: true,
      notification: { payment: { card: null } },
    });
  });

  it('initiate + notification + getStatus donnent le même NormalizedPayment', async () => {
    const a = new FakePspAdapter('PAYDUNYA');
    const init = await a.initiate(request('PAYDUNYA'), secrets);
    expect(init.action).toMatchObject({ kind: 'REDIRECT' });
    expect((init.action as { url: string }).url).toMatch(/^https:\/\/fake-psp\.invalid\//);
    expect(a.initiated).toHaveLength(1);
    expect(Object.keys(a.initiated[0] ?? {})).not.toContain('secrets');
    const card = { fingerprint: 'fp9', threeDs: 'SUCCEEDED' };
    a.setStatus('top1', 'PAID', { card });
    const signed = signFakeNotification({
      provider: 'PAYDUNYA',
      secret: SECRET,
      event: fakeEvents.succeeded({ ...base, paymentId: init.providerPaymentRef, card }),
    });
    const notified = verify(a, signed);
    const status = await a.getStatus(
      { merchantReference: 'top1', providerPaymentRef: null },
      secrets,
    );
    expect(status.state).toBe('PAID');
    expect(notified.ok && notified.notification.payment).toEqual(status.payment);
  });

  it('référence inconnue -> UNKNOWN', async () => {
    expect(
      await adapter.getStatus({ merchantReference: 'zz', providerPaymentRef: null }, secrets),
    ).toEqual({
      state: 'UNKNOWN',
      payment: null,
    });
  });
});

describe('refus', () => {
  const adapter = new FakePspAdapter('WAVE');
  const sign = (event: Record<string, unknown>, rawBody?: Buffer) =>
    signFakeNotification({ provider: 'WAVE', secret: SECRET, event, rawBody });

  it('JSON invalide après bonne signature -> BODY_MALFORMED', () => {
    const raw = Buffer.from('pas du json');
    const t = Math.floor(Date.now() / 1000);
    const { computeSignature } = jest.requireActual('../../../src/psp/hmac-signature');
    const header = `t=${t},v1=${computeSignature(Secret.of(SECRET), t, raw)}`;
    expect(
      adapter.verifyNotification({
        rawBody: raw,
        headers: { 'wave-signature': header },
        secrets,
        now: NOW,
      }),
    ).toEqual({
      ok: false,
      reason: 'BODY_MALFORMED',
    });
  });

  it.each([
    ['montant négatif', { ...fakeEvents.succeeded(base), amount: -1 }],
    ['montant nul', { ...fakeEvents.succeeded(base), amount: 0 }],
    ['montant décimal', { ...fakeEvents.succeeded(base), amount: 1.5 }],
    ['montant hors plage', { ...fakeEvents.succeeded(base), amount: 2 ** 60 }],
    ['montant en chaîne', { ...fakeEvents.succeeded(base), amount: '5000' }],
    ['devise absente', { ...fakeEvents.succeeded(base), currency: undefined }],
    ['id absent', { ...fakeEvents.succeeded(base), id: undefined }],
    ['pas un objet', [1, 2] as unknown as Record<string, unknown>],
    ['contestation sans bloc', { ...fakeEvents.succeeded(base), type: 'dispute.created' }],
  ])('%s -> BODY_MALFORMED', (_n, event) => {
    expect(verify(adapter, sign(event))).toEqual({ ok: false, reason: 'BODY_MALFORMED' });
  });

  it('corps vide signé -> BODY_MALFORMED', () => {
    const t = Math.floor(Date.now() / 1000);
    const { computeSignature } = jest.requireActual('../../../src/psp/hmac-signature');
    const header = `t=${t},v1=${computeSignature(Secret.of(SECRET), t, Buffer.alloc(0))}`;
    expect(
      adapter.verifyNotification({
        rawBody: Buffer.alloc(0),
        headers: { 'wave-signature': header },
        secrets,
        now: NOW,
      }),
    ).toEqual({ ok: false, reason: 'BODY_MALFORMED' });
  });

  it('octet changé, mauvais secret, horodatage hors tolérance : refus', () => {
    const altered = sign(fakeEvents.succeeded(base), Buffer.from('{"id":"x"}'));
    expect(verify(adapter, altered)).toEqual({ ok: false, reason: 'SIGNATURE_INVALID' });
    const wrong = signFakeNotification({
      provider: 'WAVE',
      secret: 'autre',
      event: fakeEvents.succeeded(base),
    });
    expect(verify(adapter, wrong)).toEqual({ ok: false, reason: 'SIGNATURE_INVALID' });
    const old = signFakeNotification({
      provider: 'WAVE',
      secret: SECRET,
      event: fakeEvents.succeeded(base),
      timestamp: Math.floor(Date.now() / 1000) - 400,
    });
    expect(verify(adapter, old)).toEqual({ ok: false, reason: 'TIMESTAMP_OUT_OF_TOLERANCE' });
  });

  it('le JSON n’est pas lu avant la signature', () => {
    const spy = jest.spyOn(JSON, 'parse');
    const wrong = signFakeNotification({
      provider: 'WAVE',
      secret: 'autre',
      event: fakeEvents.succeeded(base),
    });
    const old = signFakeNotification({
      provider: 'WAVE',
      secret: SECRET,
      event: fakeEvents.succeeded(base),
      timestamp: 1,
    });
    verify(adapter, wrong);
    verify(adapter, old);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('pilotage', () => {
  it('failNextInitiate, cancel, acceptCancel, reset, moyen incompatible', async () => {
    const a = new FakePspAdapter('WAVE');
    a.failNextInitiate('UNAVAILABLE');
    await expect(a.initiate(request('WAVE'), secrets)).rejects.toMatchObject({
      kind: 'UNAVAILABLE',
    });
    a.failNextInitiate('REJECTED');
    await expect(a.initiate(request('WAVE'), secrets)).rejects.toBeInstanceOf(PspProviderError);
    await expect(a.initiate({ ...request('WAVE'), method: 'CARD' }, secrets)).rejects.toMatchObject(
      {
        kind: 'REJECTED',
      },
    );
    await a.initiate(request('WAVE'), secrets);
    const q = { merchantReference: 'top1', providerPaymentRef: null };
    a.acceptCancel(false);
    expect(await a.cancel(q, secrets)).toEqual({ cancelled: false });
    a.acceptCancel(true);
    expect(await a.cancel(q, secrets)).toEqual({ cancelled: true });
    expect((await a.getStatus(q, secrets)).state).toBe('CANCELLED');
    expect(await a.readStatement({ from: NOW, to: NOW }, secrets)).toEqual([]);
    a.reset();
    expect(a.initiated).toHaveLength(0);
    expect((await a.getStatus(q, secrets)).state).toBe('UNKNOWN');
  });

  it('segments de chemin', () => {
    expect(providerFromPathSegment('orange-money')).toBe('ORANGE_MONEY');
    expect(providerFromPathSegment('nope')).toBeNull();
  });
});
