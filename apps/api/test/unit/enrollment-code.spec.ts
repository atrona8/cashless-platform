// Code d'enrôlement (contracts/enrollment.md, research R-13) : tirage, présentation, normalisation
// et empreinte à clé du code normalisé.
import { createHash, createHmac } from 'node:crypto';
import { CLAIM_CODE_ALPHABET } from '@cashless/tag-format';
import {
  ENROLLMENT_CODE_ALPHABET,
  EnrollmentCodeFormatError,
  enrollmentCodeHash,
  formatEnrollmentCode,
  generateEnrollmentCode,
  normalizeEnrollmentCode,
} from '../../src/enrollment-code/enrollment-code';

const KEY_A = Buffer.alloc(32, 0xa5);
const KEY_B = Buffer.alloc(32, 0x5a);
const CODE = 'K7QM4XH9RTAB';

describe('code d’enrôlement', () => {
  it('reprend l’alphabet de 32 sans ambiguïté du code de rattachement', () => {
    expect(ENROLLMENT_CODE_ALPHABET).toBe(CLAIM_CODE_ALPHABET);
    expect(ENROLLMENT_CODE_ALPHABET).toHaveLength(32);
    expect(ENROLLMENT_CODE_ALPHABET).not.toMatch(/[01IO]/);
  });

  it('tire 12 caractères de l’alphabet (60 bits), tous les caractères étant atteints', () => {
    const seen = new Set<string>();
    const codes = new Set<string>();
    for (let i = 0; i < 1000; i += 1) {
      const code = generateEnrollmentCode();
      expect(code).toMatch(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{12}$/);
      codes.add(code);
      for (const char of code) seen.add(char);
    }
    expect(codes.size).toBe(1000);
    expect(seen.size).toBe(32);
  });

  it('se présente en `XXXX-XXXX-XXXX`', () => {
    expect(formatEnrollmentCode(CODE)).toBe('K7QM-4XH9-RTAB');
    expect(formatEnrollmentCode('k7qm 4xh9 rtab')).toBe('K7QM-4XH9-RTAB');
  });

  it('le code `ſ` en fin de saisie n’a jamais l’empreinte du code en `S`', () => {
    expect(() => enrollmentCodeHash('K7QM-4XH9-RTAſ', KEY_A)).toThrow(EnrollmentCodeFormatError);
    expect(enrollmentCodeHash('K7QM-4XH9-RTAS', KEY_A)).toHaveLength(32);
  });

  it('normalise tirets, espaces et casse', () => {
    expect(normalizeEnrollmentCode('k7qm-4xh9-rtab')).toBe(CODE);
    expect(normalizeEnrollmentCode(' K7QM 4XH9\tRTAB ')).toBe(CODE);
    expect(normalizeEnrollmentCode(CODE)).toBe(CODE);
  });

  it.each([
    ['zéro', 'K7QM-4XH9-RTA0'],
    ['un', 'K7QM-4XH9-RTA1'],
    ['I', 'K7QM-4XH9-RTAI'],
    ['O', 'K7QM-4XH9-RTAO'],
    ['ponctuation', 'K7QM-4XH9-RTA!'],
    ['soulignement', 'K7QM_4XH9_RTAB'],
    ['lettre accentuée', 'K7QM-4XH9-RTAÉ'],
    // Majuscule Unicode de `ſ` : `S`, de `ı` : `I` ; refusés avant toute mise en majuscules.
    ['s long (ſ)', 'K7QM-4XH9-RTAſ'],
    ['i sans point (ı)', 'K7QM-4XH9-RTAı'],
    ['chiffre pleine chasse', 'K7QM-4XH9-RTA７'],
  ])('refuse un caractère interdit (%s)', (_label, input) => {
    expect(() => normalizeEnrollmentCode(input)).toThrow(EnrollmentCodeFormatError);
    expect(() => normalizeEnrollmentCode(input)).toThrow(/caractère non permis|12 caractères/);
  });

  it('refuse une longueur autre que 12 et une saisie démesurée, sans reprendre la saisie', () => {
    expect(() => normalizeEnrollmentCode('K7QM-4XH9-RTA')).toThrow(/12 caractères/);
    expect(() => normalizeEnrollmentCode('K7QM-4XH9-RTABC')).toThrow(/12 caractères/);
    expect(() => normalizeEnrollmentCode('')).toThrow(/12 caractères/);
    expect(() => normalizeEnrollmentCode(`${CODE}${' '.repeat(60)}`)).toThrow(/trop longue/);
    expect.assertions(5);
    try {
      normalizeEnrollmentCode('K7QM-4XH9-RTA0');
    } catch (error) {
      expect(String(error)).not.toContain('K7QM');
    }
  });

  it('empreinte : HMAC-SHA256 du code normalisé, stable, liée à la clé', () => {
    const hash = enrollmentCodeHash(CODE, KEY_A);
    expect(hash).toHaveLength(32);
    expect(hash.equals(createHmac('sha256', KEY_A).update(CODE, 'ascii').digest())).toBe(true);
    expect(hash.equals(createHash('sha256').update(CODE, 'ascii').digest())).toBe(false);
    expect(enrollmentCodeHash('k7qm-4xh9-rtab', KEY_A).equals(hash)).toBe(true);
    expect(enrollmentCodeHash(CODE, KEY_A).equals(hash)).toBe(true);
    expect(enrollmentCodeHash(CODE, KEY_B).equals(hash)).toBe(false);
  });

  it('empreinte : refuse une saisie mal formée et une clé de moins de 32 octets', () => {
    expect(() => enrollmentCodeHash('K7QM-4XH9-RTA0', KEY_A)).toThrow(EnrollmentCodeFormatError);
    expect(() => enrollmentCodeHash(CODE, Buffer.alloc(31, 1))).toThrow(/32 octets/);
    expect(() => enrollmentCodeHash(CODE, Buffer.alloc(0))).toThrow(/32 octets/);
  });
});
