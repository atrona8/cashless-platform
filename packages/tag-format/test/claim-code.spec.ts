// Code de rattachement : alphabet, tirage, normalisation de la saisie (SPECIFICATION §7.8).
import { randomBytes } from 'node:crypto';
import {
  CLAIM_CODE_ALPHABET,
  TagFormatError,
  claimCodeUrl,
  formatClaimCode,
  generateClaimCode,
  normalizeClaimCode,
} from '../src';
import { vectors } from './vectors';

describe('code de rattachement', () => {
  it('alphabet de 32 caractères sans 0, 1, I ni O', () => {
    expect(CLAIM_CODE_ALPHABET).toBe(vectors.claim_code.alphabet);
    expect(new Set(CLAIM_CODE_ALPHABET).size).toBe(32);
    expect(/[01IO]/.test(CLAIM_CODE_ALPHABET)).toBe(false);
  });

  it.each(vectors.claim_code.inputs as { input: string; normalized: string; formatted: string }[])(
    'normalise « $input »',
    (sample) => {
      expect(normalizeClaimCode(sample.input)).toBe(sample.normalized);
      expect(formatClaimCode(sample.input)).toBe(sample.formatted);
    },
  );

  it.each(vectors.refusals.claim_code as string[])('refuse « %s »', (input) => {
    expect(() => normalizeClaimCode(input)).toThrow(TagFormatError);
  });

  it('tire 10 caractères de l’alphabet ; chaque caractère apparaît sur 10 000 tirages', () => {
    const seen = new Map<string, number>();
    for (let n = 0; n < 10_000; n += 1) {
      const code = generateClaimCode(randomBytes);
      expect(normalizeClaimCode(code)).toBe(code);
      for (const char of code) seen.set(char, (seen.get(char) ?? 0) + 1);
    }
    expect(seen.size).toBe(32);
    // 100 000 caractères sur 32 valeurs : 3 125 attendus chacun ; un biais grossier sortirait de ±15 %.
    for (const count of seen.values()) expect(Math.abs(count - 3125)).toBeLessThan(470);
  });

  it('le tirage ne dépend que des 5 bits de poids faible de chaque octet', () => {
    expect(generateClaimCode(() => Buffer.alloc(10, 0))).toBe('2222222222');
    expect(generateClaimCode(() => Buffer.alloc(10, 0xff))).toBe('ZZZZZZZZZZ');
    expect(generateClaimCode(() => Buffer.alloc(10, 0x20))).toBe('2222222222');
    expect(() => generateClaimCode(() => Buffer.alloc(9))).toThrow(TagFormatError);
  });

  it('URL du QR imprimé', () => {
    expect(claimCodeUrl('pay.example', 'k7qm-4xh9rt')).toBe('https://pay.example/c/K7QM4XH9RT');
  });
});
