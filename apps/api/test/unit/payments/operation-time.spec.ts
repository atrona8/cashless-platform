// Heure de l'opération et époque d'autorité (mission 5b, lot WP11, T051 ; A5, A27 ; §9.6). Bornes à ±120 s de
// l'heure de la base, inclusives ; l'heure de référence est un paramètre (jamais l'horloge de Node).
import { ProblemException } from '../../../src/errors/problem';
import {
  assertAuthorityEpoch,
  OCCURRED_AT_TOLERANCE_SECONDS,
  resolveOperationTime,
} from '../../../src/payments/operation-time';

const DB = new Date('2026-12-11T19:10:00.000Z');
const at = (ms: number) => new Date(DB.getTime() + ms);

describe('resolveOperationTime (±120 s)', () => {
  it('la tolérance est celle de §9.6', () => {
    expect(OCCURRED_AT_TOLERANCE_SECONDS).toBe(120);
  });

  it.each([
    ['même instant', 0],
    ['+119,999 s', 119_999],
    ['−119,999 s', -119_999],
    ['+120 s exactement', 120_000],
    ['−120 s exactement', -120_000],
  ])('%s → heure du terminal conservée, aucune anomalie', (_n, offset) => {
    const received = at(offset);
    expect(resolveOperationTime(received, DB)).toEqual({
      occurredAt: received,
      deviceOccurredAt: null,
      skewed: false,
    });
  });

  it.each([
    ['+120,001 s', 120_001],
    ['−120,001 s', -120_001],
    ['+1 h', 3_600_000],
    ['−1 jour', -86_400_000],
  ])('%s → heure de la base, heure reçue gardée, anomalie', (_n, offset) => {
    const received = at(offset);
    expect(resolveOperationTime(received, DB)).toEqual({
      occurredAt: DB,
      deviceOccurredAt: received,
      skewed: true,
    });
  });
});

describe('assertAuthorityEpoch (A27)', () => {
  const code = (fn: () => void): string => {
    try {
      fn();
    } catch (error) {
      return error instanceof ProblemException ? `${error.status} ${error.code}` : String(error);
    }
    return 'accepté';
  };

  it('époque égale à celle du grand livre : acceptée (espaces autour tolérés)', () => {
    expect(code(() => assertAuthorityEpoch('0', 0))).toBe('accepté');
    expect(code(() => assertAuthorityEpoch(' 12 ', 12))).toBe('accepté');
  });

  it('époque différente → 409 STALE_AUTHORITY_EPOCH, avec l’époque courante', () => {
    expect(code(() => assertAuthorityEpoch('3', 4))).toBe('409 STALE_AUTHORITY_EPOCH');
    try {
      assertAuthorityEpoch('3', 4);
    } catch (error) {
      expect((error as ProblemException).extensions).toEqual({ authority_epoch: 4 });
    }
  });

  it('en-tête absent, vide, négatif, fractionnaire ou non numérique → 422 (arbitrage : l’absence est refusée)', () => {
    for (const header of [undefined, '', '  ', '-1', '1.5', 'abc', '1e3', '0x10', '9'.repeat(16)])
      expect(code(() => assertAuthorityEpoch(header, 0))).toBe('422 VALIDATION_FAILED');
  });
});
