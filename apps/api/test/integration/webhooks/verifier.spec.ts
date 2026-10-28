// Unitaire : vérification d'une notification (lot WP12, T060 point 3, T064 ; R-10, A23). Sans base : l'adaptateur
// est le faux de WP07 (le schéma HMAC réel) ou un adaptateur qui MENT, pour prouver que le vérificateur de ce lot ne
// fait pas confiance à l'adaptateur sur l'horodatage et l'échéance du secret précédent.
import crypto from 'node:crypto';
import { FakePspAdapter } from '../../../src/psp/fake/fake-psp-adapter';
import { fakeEvents, signFakeNotification } from '../../../src/psp/fake/fake-notification-signer';
import type { PspAdapter, PspVerification } from '../../../src/psp/psp-adapter.port';
import type { PspSecrets } from '../../../src/psp/psp-secret-store.port';
import { Secret } from '../../../src/psp/secret';
import { verifyWebhook } from '../../../src/webhooks/webhook-verifier';

const CURRENT = 'secret-courant-0123456789';
const PREVIOUS = 'secret-precedent-0123456789';
const NOW = new Date('2026-10-28T12:00:00Z');
const adapter = new FakePspAdapter('WAVE');

const secrets = (
  previousValidUntil: Date | null = new Date(NOW.getTime() + 60_000),
): PspSecrets => ({
  adapter: null,
  notification: {
    current: Secret.of(CURRENT),
    previous: previousValidUntil === null ? null : Secret.of(PREVIOUS),
    previousValidUntil,
  },
});

const event = fakeEvents.succeeded({
  id: 'evt-1',
  merchantReference: null,
  paymentId: 'pay-1',
  amount: 1000,
  currency: 'XOF',
});

function signed(secret: string, offsetSeconds = 0) {
  return signFakeNotification({
    provider: 'WAVE',
    secret,
    event,
    timestamp: Math.floor(NOW.getTime() / 1000) + offsetSeconds,
  });
}

const verify = (s: ReturnType<typeof signed>, secretSet = secrets(), now = NOW) =>
  verifyWebhook({ adapter, rawBody: s.rawBody, headers: s.headers, secrets: secretSet, now });

describe('vérification des notifications', () => {
  afterEach(() => jest.restoreAllMocks());

  it('signature avec le secret courant : acceptée', () => {
    const verdict = verify(signed(CURRENT));
    expect(verdict).toMatchObject({ ok: true, secretUsed: 'current' });
  });

  it('signature avec le secret précédent dans sa fenêtre : acceptée', () => {
    expect(verify(signed(PREVIOUS))).toMatchObject({ ok: true, secretUsed: 'previous' });
  });

  it('signature avec le secret précédent hors fenêtre : refusée', () => {
    const expired = secrets(new Date(NOW.getTime() - 1000));
    expect(verify(signed(PREVIOUS), expired)).toEqual({ ok: false, reason: 'SIGNATURE_INVALID' });
  });

  it('signature d’une autre longueur, en-tête absent ou mal formé : refus avec le bon motif', () => {
    const good = signed(CURRENT);
    const header = Object.keys(good.headers)[0]!;
    const ts = Math.floor(NOW.getTime() / 1000);
    expect(verify({ ...good, headers: { [header]: `t=${ts},v1=abcd` } })).toEqual({
      ok: false,
      reason: 'SIGNATURE_INVALID',
    });
    expect(verify({ ...good, headers: {} })).toEqual({ ok: false, reason: 'SIGNATURE_MISSING' });
    expect(verify({ ...good, headers: { [header]: 'n-importe-quoi' } })).toEqual({
      ok: false,
      reason: 'SIGNATURE_MALFORMED',
    });
  });

  it('corps modifié d’un octet : refusé', () => {
    const good = signed(CURRENT);
    const body = Buffer.from(good.rawBody);
    body[body.length - 2] = body[body.length - 2]! ^ 1;
    expect(verify({ ...good, rawBody: body })).toEqual({ ok: false, reason: 'SIGNATURE_INVALID' });
  });

  it('horodatage : +300 s accepté, ±301 s refusé', () => {
    expect(verify(signed(CURRENT, 300)).ok).toBe(true);
    expect(verify(signed(CURRENT, -300)).ok).toBe(true);
    expect(verify(signed(CURRENT, 301))).toEqual({
      ok: false,
      reason: 'TIMESTAMP_OUT_OF_TOLERANCE',
    });
    expect(verify(signed(CURRENT, -301))).toEqual({
      ok: false,
      reason: 'TIMESTAMP_OUT_OF_TOLERANCE',
    });
  });

  it('temps constant par construction : les deux secrets sont comparés même si le premier correspond', () => {
    const spy = jest.spyOn(crypto, 'timingSafeEqual');
    expect(verify(signed(CURRENT)).ok).toBe(true);
    // Une signature reçue : une comparaison avec le secret courant ET une avec le précédent.
    expect(spy).toHaveBeenCalledTimes(2);
    spy.mockClear();
    // Aucun secret précédent : un secret factice est évalué quand même.
    expect(verify(signed(CURRENT), secrets(null)).ok).toBe(true);
    expect(spy).toHaveBeenCalledTimes(2);
    spy.mockClear();
    // Signature fausse : toujours deux comparaisons, jamais de sortie anticipée.
    expect(verify(signed('autre')).ok).toBe(false);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  describe('l’adaptateur n’est pas cru sur parole', () => {
    const lying = (verdict: PspVerification): Pick<PspAdapter, 'verifyNotification'> => ({
      verifyNotification: () => verdict,
    });
    const notification = adapter.verifyNotification({
      rawBody: signed(CURRENT).rawBody,
      headers: signed(CURRENT).headers,
      secrets: secrets(),
      now: NOW,
    });
    const base = notification.ok ? notification.notification : (null as never);
    const call = (verdict: PspVerification, secretSet = secrets()) =>
      verifyWebhook({
        adapter: lying(verdict),
        rawBody: Buffer.from('{}'),
        headers: {},
        secrets: secretSet,
        now: NOW,
      });

    it('horodatage hors tolérance malgré un « ok » de l’adaptateur', () => {
      const stale = new Date(NOW.getTime() - 3600_000);
      expect(
        call({ ok: true, notification: base, signedAt: stale, secretUsed: 'current' }),
      ).toEqual({ ok: false, reason: 'TIMESTAMP_OUT_OF_TOLERANCE' });
    });

    it('secret précédent échu malgré un « ok » de l’adaptateur', () => {
      const expired = secrets(new Date(NOW.getTime() - 1));
      expect(
        call({ ok: true, notification: base, signedAt: NOW, secretUsed: 'previous' }, expired),
      ).toEqual({ ok: false, reason: 'SIGNATURE_INVALID' });
    });

    it('identifiant de notification vide ou trop long : corps illisible', () => {
      for (const id of ['', 'x'.repeat(201)])
        expect(
          call({
            ok: true,
            notification: { ...base, notificationId: id },
            signedAt: NOW,
            secretUsed: 'current',
          }),
        ).toEqual({ ok: false, reason: 'BODY_MALFORMED' });
    });

    it('un adaptateur qui lève une exception est un refus, jamais une exception', () => {
      const throwing: Pick<PspAdapter, 'verifyNotification'> = {
        verifyNotification: () => {
          throw new Error('valeur secrète dans le message');
        },
      };
      const verdict = verifyWebhook({
        adapter: throwing,
        rawBody: Buffer.from('{}'),
        headers: {},
        secrets: secrets(),
        now: NOW,
      });
      expect(verdict).toEqual({ ok: false, reason: 'SIGNATURE_INVALID' });
      expect(JSON.stringify(verdict)).not.toContain('secrète');
    });
  });
});
