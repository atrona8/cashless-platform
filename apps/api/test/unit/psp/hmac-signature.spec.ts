import crypto from 'node:crypto';
import {
  computeSignature,
  parseSignatureHeader,
  verifyHmacSignature,
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
  adapter: null,
  notification: { current: CUR, previous: null, previousValidUntil: null, ...over },
});
const header = (secret: Secret, t = T, body = BODY) =>
  `t=${t},v1=${computeSignature(secret, t, body)}`;
const verify = (h: string | undefined, s = secrets(), body = BODY, now = NOW) =>
  verifyHmacSignature({ header: h, rawBody: body, secrets: s, now });

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
  ])('mal formé : %s', (_n, value) => expect(parseSignatureHeader(value)).toBeNull());

  it('plusieurs v1 et espaces tolérés', () => {
    expect(parseSignatureHeader('t=12, v1=AB12 , v1=cd34')).toEqual({
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
    const good = computeSignature(CUR, T, BODY);
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
