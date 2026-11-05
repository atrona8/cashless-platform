// `exactSeq` (WP15, R-14) : un numéro de séquence lu en texte n'est exposé que s'il est exact (0 à 2^53-1).
import { exactSeq } from '../../src/devices/config/device-config.service';

describe('exactSeq', () => {
  it('accepte 0 et 2^53-1 sans perte', () => {
    expect(exactSeq('0', 'seq')).toBe(0);
    expect(exactSeq('9007199254740991', 'seq')).toBe(Number.MAX_SAFE_INTEGER);
  });
  it('refuse 2^53, un bigint supérieur et un négatif (jamais arrondis)', () => {
    expect(() => exactSeq('9007199254740992', 'seq')).toThrow(/seq/);
    expect(() => exactSeq('9223372036854775807', 'seq')).toThrow();
    expect(() => exactSeq('-1', 'seq')).toThrow();
  });
});
