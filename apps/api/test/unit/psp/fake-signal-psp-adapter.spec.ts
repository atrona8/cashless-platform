import {
  FakeSignalPspAdapter,
  fakeSignalHeaderValue,
} from '../../../src/psp/fake/fake-signal-psp-adapter';
import type { PspSecrets } from '../../../src/psp/psp-secret-store.port';
import { Secret } from '../../../src/psp/secret';

const KEY = 'cle-de-notification';
const secrets: PspSecrets = {
  credentials: { provider: 'FAKE', key: null },
  notification: { current: Secret.of(KEY), previous: null, previousValidUntil: null },
};
const body = Buffer.from(
  JSON.stringify({ id: 'n1', merchantReference: 'top1', paymentId: 'pay1' }),
);
const verify = (headers: Record<string, string>, raw = body) =>
  new FakeSignalPspAdapter().verifyNotification({
    rawBody: raw,
    contentType: 'json',
    headers,
    secrets,
    now: new Date(),
  });

describe('faux « signal »', () => {
  it('en-tête sha512 de la clé courante : SIGNAL sans montant', () => {
    const result = verify({ 'X-Fake-Signal': fakeSignalHeaderValue(KEY) });
    expect(result).toEqual({
      ok: true,
      kind: 'SIGNAL',
      notificationId: 'n1',
      reference: { merchantReference: 'top1', providerPaymentRef: 'pay1' },
      secretUsed: 'current',
    });
  });

  it('en-tête absent, mal formé, faux : refus avant lecture du corps', () => {
    expect(verify({})).toEqual({ ok: false, reason: 'SIGNATURE_MISSING' });
    expect(verify({ 'x-fake-signal': 'zz' }, Buffer.from('pas du json'))).toEqual({
      ok: false,
      reason: 'SIGNATURE_MALFORMED',
    });
    expect(verify({ 'x-fake-signal': fakeSignalHeaderValue('autre') })).toEqual({
      ok: false,
      reason: 'SIGNATURE_INVALID',
    });
  });

  it('corps illisible ou sans identifiant : BODY_MALFORMED', () => {
    const headers = { 'x-fake-signal': fakeSignalHeaderValue(KEY) };
    expect(verify(headers, Buffer.from('{'))).toEqual({ ok: false, reason: 'BODY_MALFORMED' });
    expect(verify(headers, Buffer.from('{"id":"n1"}'))).toEqual({
      ok: false,
      reason: 'BODY_MALFORMED',
    });
  });

  it('getStatus rend l’état programmé, UNKNOWN sinon', async () => {
    const a = new FakeSignalPspAdapter();
    const q = { merchantReference: 'top1', providerPaymentRef: null };
    expect((await a.getStatus(q, secrets)).state).toBe('UNKNOWN');
    a.setStatus('top1', { state: 'PAID', payment: null });
    expect((await a.getStatus(q, secrets)).state).toBe('PAID');
    expect(await a.readStatement({ from: new Date(), to: new Date() }, secrets)).toEqual({
      supported: false,
    });
  });
});
