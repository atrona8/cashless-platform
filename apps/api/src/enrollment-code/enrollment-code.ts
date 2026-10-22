// Code d'enrôlement d'un terminal (contracts/enrollment.md ; research R-13) : 12 caractères de
// l'alphabet de 32 sans ambiguïté du code de rattachement (ni 0, 1, I, O), soit 60 bits, affichés
// `XXXX-XXXX-XXXX`. La base ne garde que l'empreinte à clé du code normalisé : un code de 60 bits
// en SHA-256 simple se forcerait hors ligne pendant sa durée de validité si la base fuyait. La clé
// (`ENROLLMENT_CODE_HMAC_KEY`) vit hors de la base ; ni elle ni le code ne sont journalisés.
import { createHmac, randomInt } from 'node:crypto';
import { CLAIM_CODE_ALPHABET } from '@cashless/tag-format';

export const ENROLLMENT_CODE_ALPHABET = CLAIM_CODE_ALPHABET;
export const ENROLLMENT_CODE_LENGTH = 12;
/** Saisie la plus longue examinée (12 caractères, tirets et espaces compris largement). */
const MAX_INPUT_LENGTH = 64;
/** Taille minimale de la clé, comme les autres secrets HMAC du serveur. */
const MIN_KEY_LENGTH = 32;

/** Code mal formé : le message ne reprend jamais la saisie. */
export class EnrollmentCodeFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EnrollmentCodeFormatError';
  }
}

/** Tire un code : `crypto.randomInt` est uniforme sur [0, 32), donc sans biais. */
export function generateEnrollmentCode(): string {
  let code = '';
  for (let i = 0; i < ENROLLMENT_CODE_LENGTH; i += 1)
    code += ENROLLMENT_CODE_ALPHABET[randomInt(ENROLLMENT_CODE_ALPHABET.length)];
  return code;
}

/** Hors ASCII imprimable (espace exclue). */
const NON_ASCII = /[^\x21-\x7e]/;

/**
 * Saisie → 12 caractères : retire tirets et espaces, refuse tout caractère hors ASCII, PUIS met en
 * majuscules (ASCII seulement : `ſ` ou `ı` ne deviennent jamais `S` ou `I`), refuse tout le reste.
 */
export function normalizeEnrollmentCode(input: string): string {
  if (input.length > MAX_INPUT_LENGTH)
    throw new EnrollmentCodeFormatError('code d’enrôlement : saisie trop longue');
  const stripped = input.replace(/[\s-]/g, '');
  if (NON_ASCII.test(stripped))
    throw new EnrollmentCodeFormatError('code d’enrôlement : caractère non permis');
  const code = stripped.toUpperCase();
  if (code.length !== ENROLLMENT_CODE_LENGTH)
    throw new EnrollmentCodeFormatError('code d’enrôlement : 12 caractères attendus');
  for (const char of code) {
    if (!ENROLLMENT_CODE_ALPHABET.includes(char))
      throw new EnrollmentCodeFormatError('code d’enrôlement : caractère non permis');
  }
  return code;
}

export function formatEnrollmentCode(code: string): string {
  const normalized = normalizeEnrollmentCode(code);
  return `${normalized.slice(0, 4)}-${normalized.slice(4, 8)}-${normalized.slice(8)}`;
}

/** Empreinte (32 octets) du code normalisé ; une saisie mal formée lève avant tout calcul. */
export function enrollmentCodeHash(code: string, key: Buffer): Buffer {
  if (key.length < MIN_KEY_LENGTH)
    throw new Error(`Empreinte du code d’enrôlement : clé de ${MIN_KEY_LENGTH} octets au moins`);
  return createHmac('sha256', key).update(normalizeEnrollmentCode(code), 'ascii').digest();
}
