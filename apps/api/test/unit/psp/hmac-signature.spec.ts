import crypto from 'node:crypto';
import {
  computeSignature,
  FAKE_SCHEME,
  parseSignatureHeader,
  STRIPE_SCHEME,
  verifyHmacSignature,
  WAVE_SCHEME,
  type HmacScheme,
  WEBHOOK_TOLERANCE_SECONDS,
} from '../../../src/psp/hmac-signature';
import type { PspSecrets } from '../../../src/psp/psp-secret-store.port';
import { Secret } from '../../../src/psp/secret';

const NOW = new Date('2026-10-27T12:00:00Z');
const T = Math.floor(NOW.getTime() / 1000);
const BODY = Buffer.from('{"a":1}');
const CUR = Secret.of('secret-courant');
const PREV = Secret.of('secret-precedent');

const secrets = (over: Partial<PspSecrets['notification']> = {}): PspSecrets => ({
  credentials: { provider: 'FAKE', key: null },
  notification: { current: CUR, previous: null, previousValidUntil: null, ...over },
});
const header = (secret: Secret, t = T, body = BODY, scheme: HmacScheme = FAKE_SCHEME) =>
  `t=${t},v1=${computeSignature(secret, t, body, scheme)}`;
const verify = (
  h: string | undefined,
  s = secrets(),
  body = BODY,
  now = NOW,
  scheme: HmacScheme = FAKE_SCHEME,
) => verifyHmacSignature({ header: h, rawBody: body, secrets: s, now, scheme });

afterEach(() => jest.restoreAllMocks());

describe('parseSignatureHeader', () => {
  it.each([
    ['sans t', 'v1=abcd'],
    ['t non entier', 't=12.5,v1=abcd'],
    ['t négatif', 't=-1,v1=abcd'],
    ['sans v1', 't=12'],
    ['hex invalide', 't=12,v1=zz'],
    ['hex impair', 't=12,v1=abc'],
    ['clé inconnue', 't=12,v1=abcd,v2=abcd'],
    ['sans égal', 't=12,v1'],
    ['t répété', 't=12,t=13,v1=abcd'],
  ])('mal formé : %s', (_n, value) => expect(parseSignatureHeader(value, FAKE_SCHEME)).toBeNull());

  it('plusieurs v1 et espaces tolérés', () => {
    expect(parseSignatureHeader('t=12, v1=AB12 , v1=cd34', FAKE_SCHEME)).toEqual({
      timestamp: 12,
      signatures: ['ab12', 'cd34'],
    });
  });
});

describe('verifyHmacSignature', () => {
  it('en-tête absent ou mal formé', () => {
    expect(verify(undefined)).toEqual({ ok: false, reason: 'SIGNATURE_MISSING' });
    expect(verify('')).toEqual({ ok: false, reason: 'SIGNATURE_MISSING' });
    expect(verify('garbage')).toEqual({ ok: false, reason: 'SIGNATURE_MALFORMED' });
  });

  it('secret courant accepté', () => {
    expect(verify(header(CUR))).toEqual({
      ok: true,
      signedAt: new Date(T * 1000),
      secretUsed: 'current',
    });
  });

  it('précédent accepté avant son échéance (inclus), refusé après', () => {
    const live = secrets({ previous: PREV, previousValidUntil: new Date(NOW.getTime()) });
    expect(verify(header(PREV), live)).toMatchObject({ ok: true, secretUsed: 'previous' });
    const expired = secrets({ previous: PREV, previousValidUntil: new Date(NOW.getTime() - 1) });
    expect(verify(header(PREV), expired)).toEqual({ ok: false, reason: 'SIGNATURE_INVALID' });
  });

  it('précédent sans échéance : jamais accepté', () => {
    const s = secrets({ previous: PREV, previousValidUntil: null });
    expect(verify(header(PREV), s)).toEqual({ ok: false, reason: 'SIGNATURE_INVALID' });
  });

  it('signature fausse, secret inconnu, octet du corps modifié', () => {
    expect(verify(header(Secret.of('autre')))).toEqual({ ok: false, reason: 'SIGNATURE_INVALID' });
    expect(verify(header(CUR), secrets(), Buffer.from('{"a":2}'))).toEqual({
      ok: false,
      reason: 'SIGNATURE_INVALID',
    });
  });

  it.each([
    [-300, true],
    [300, true],
    [-301, false],
    [301, false],
  ])('écart d’horodatage %i s : accepté=%s', (delta, accepted) => {
    const t = T + delta;
    const result = verify(header(CUR, t));
    if (accepted) expect(result).toMatchObject({ ok: true });
    else expect(result).toEqual({ ok: false, reason: 'TIMESTAMP_OUT_OF_TOLERANCE' });
    expect(WEBHOOK_TOLERANCE_SECONDS).toBe(300);
  });

  it('signature fausse ET horodatage faux : SIGNATURE_INVALID', () => {
    expect(verify(header(Secret.of('autre'), T + 10_000))).toEqual({
      ok: false,
      reason: 'SIGNATURE_INVALID',
    });
  });

  it('plusieurs v1 dont un bon ; longueur fausse refusée', () => {
    const good = computeSignature(CUR, T, BODY, FAKE_SCHEME);
    expect(verify(`t=${T},v1=00ff,v1=${good}`)).toMatchObject({ ok: true });
    expect(verify(`t=${T},v1=${good}00`)).toEqual({ ok: false, reason: 'SIGNATURE_INVALID' });
    expect(verify(`t=${T},v1=00`)).toEqual({ ok: false, reason: 'SIGNATURE_INVALID' });
  });

  it('les deux secrets sont évalués même si le courant correspond (pas de sortie anticipée)', () => {
    const spy = jest.spyOn(crypto, 'timingSafeEqual');
    verify(header(CUR));
    expect(spy.mock.calls.length).toBeGreaterThanOrEqual(2);
    spy.mockClear();
    // Précédent absent : le secret factice est tout de même évalué.
    verify(header(CUR), secrets({ previous: null }));
    expect(spy.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('longueur différente : comparaison à un tampon de remplissage, sans exception', () => {
    const spy = jest.spyOn(crypto, 'timingSafeEqual');
    expect(verify(`t=${T},v1=00`)).toMatchObject({ ok: false });
    expect(spy).toHaveBeenCalled();
    for (const [a, b] of spy.mock.calls) expect(a.byteLength).toBe(b.byteLength);
  });
});

describe('schémas de signature', () => {
  const SCHEMES: [string, HmacScheme][] = [
    ['faux', FAKE_SCHEME],
    ['Wave', WAVE_SCHEME],
    ['Stripe', STRIPE_SCHEME],
  ];

  it('les trois schémas sont ceux de interfaces.md §4', () => {
    expect(FAKE_SCHEME).toEqual({
      separator: '.',
      allowUnknownEntries: false,
      toleranceSeconds: 300,
    });
    expect(WAVE_SCHEME).toEqual({
      separator: '',
      allowUnknownEntries: false,
      toleranceSeconds: 300,
    });
    expect(STRIPE_SCHEME).toEqual({
      separator: '.',
      allowUnknownEntries: true,
      toleranceSeconds: 300,
    });
  });

  it('vecteurs calculés : HMAC-SHA256 de t, séparateur puis corps', () => {
    const hmac = (prefix: string) =>
      crypto.createHmac('sha256', 'secret-courant').update(prefix).update(BODY).digest('hex');
    expect(computeSignature(CUR, T, BODY, FAKE_SCHEME)).toBe(hmac(`${T}.`));
    expect(computeSignature(CUR, T, BODY, STRIPE_SCHEME)).toBe(hmac(`${T}.`));
    expect(computeSignature(CUR, T, BODY, WAVE_SCHEME)).toBe(hmac(`${T}`));
    expect(computeSignature(CUR, T, BODY, WAVE_SCHEME)).not.toBe(
      computeSignature(CUR, T, BODY, FAKE_SCHEME),
    );
  });

  it.each(SCHEMES)('%s : sa propre signature est acceptée', (_n, scheme) => {
    expect(verify(header(CUR, T, BODY, scheme), secrets(), BODY, NOW, scheme)).toMatchObject({
      ok: true,
      secretUsed: 'current',
    });
  });

  it('Wave (sans point) refuse la signature du faux/Stripe (avec point), et inversement', () => {
    expect(verify(header(CUR, T, BODY, FAKE_SCHEME), secrets(), BODY, NOW, WAVE_SCHEME)).toEqual({
      ok: false,
      reason: 'SIGNATURE_INVALID',
    });
    expect(verify(header(CUR, T, BODY, WAVE_SCHEME), secrets(), BODY, NOW, FAKE_SCHEME)).toEqual({
      ok: false,
      reason: 'SIGNATURE_INVALID',
    });
    expect(verify(header(CUR, T, BODY, WAVE_SCHEME), secrets(), BODY, NOW, STRIPE_SCHEME)).toEqual({
      ok: false,
      reason: 'SIGNATURE_INVALID',
    });
  });

  describe('entrées inconnues', () => {
    const sig = computeSignature(CUR, T, BODY, STRIPE_SCHEME);
    const withExtras = `t=${T},v1=${sig},v0=${'ab'.repeat(32)},secret=x`;

    it('Stripe : v0 et clés inconnues ignorées', () => {
      expect(verify(withExtras, secrets(), BODY, NOW, STRIPE_SCHEME)).toMatchObject({ ok: true });
    });

    it.each([
      ['Wave', WAVE_SCHEME],
      ['faux', FAKE_SCHEME],
    ])('%s : le même en-tête est refusé', (_n, scheme) => {
      const own = `t=${T},v1=${computeSignature(CUR, T, BODY, scheme)},v0=ab,secret=x`;
      expect(verify(own, secrets(), BODY, NOW, scheme)).toEqual({
        ok: false,
        reason: 'SIGNATURE_MALFORMED',
      });
    });

    it('Stripe : t dupliqué, t absent, v1 absent, v1 non hexadécimal restent refusés', () => {
      for (const h of [
        `t=${T},t=${T},v1=${sig}`,
        `v1=${sig},v0=ab`,
        `t=${T},v0=ab`,
        `t=${T},v1=zz,v0=ab`,
      ])
        expect(verify(h, secrets(), BODY, NOW, STRIPE_SCHEME)).toEqual({
          ok: false,
          reason: 'SIGNATURE_MALFORMED',
        });
    });
  });

  describe.each(SCHEMES)('rotation, délai et deux secrets : %s', (_n, scheme) => {
    const h = (secret: Secret, t = T) => header(secret, t, BODY, scheme);
    const run = (header: string, s = secrets()) => verify(header, s, BODY, NOW, scheme);

    it('deux v1, l’un du secret précédent : valide avant échéance, refusé après', () => {
      const two = `${h(PREV)},v1=${computeSignature(Secret.of('autre'), T, BODY, scheme)}`;
      const live = secrets({ previous: PREV, previousValidUntil: new Date(NOW.getTime() + 1000) });
      expect(run(two, live)).toMatchObject({ ok: true, secretUsed: 'previous' });
      const expired = secrets({ previous: PREV, previousValidUntil: new Date(NOW.getTime() - 1) });
      expect(run(two, expired)).toEqual({ ok: false, reason: 'SIGNATURE_INVALID' });
    });

    it('hors délai (301 s) refusé, 300 s accepté', () => {
      expect(run(h(CUR, T + 301))).toEqual({ ok: false, reason: 'TIMESTAMP_OUT_OF_TOLERANCE' });
      expect(run(h(CUR, T - 300))).toMatchObject({ ok: true });
    });

    it('v1 absent refusé', () => {
      expect(run(`t=${T}`)).toEqual({ ok: false, reason: 'SIGNATURE_MALFORMED' });
    });

    it('les deux calculs ont lieu (espion sur la signature)', () => {
      const signed = h(CUR);
      const spy = jest.spyOn(crypto, 'createHmac');
      run(signed);
      expect(spy).toHaveBeenCalledTimes(2);
    });
  });

  it('la tolérance est celle du schéma', () => {
    const tight: HmacScheme = { ...FAKE_SCHEME, toleranceSeconds: 10 };
    expect(verify(header(CUR, T + 11), secrets(), BODY, NOW, tight)).toEqual({
      ok: false,
      reason: 'TIMESTAMP_OUT_OF_TOLERANCE',
    });
  });
});
