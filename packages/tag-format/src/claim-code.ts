// Code de rattachement imprimé sur un bracelet (SPECIFICATION §7.8, ADR-36, ADR-56) : 10 caractères d'un alphabet de
// 32 sans ambiguïté (ni 0, 1, I, O), soit 50 bits, affichés en deux groupes (`K7QM-4XH9RT`).
// L'empreinte à clé du code n'est pas ici : elle dépend d'un secret du serveur.
import { TagFormatError } from './errors';

export const CLAIM_CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
export const CLAIM_CODE_LENGTH = 10;

/**
 * Tire un code avec la source d'aléa fournie (`crypto.randomBytes` en production). Chaque caractère prend les 5 bits
 * de poids faible d'un octet : 256 est un multiple de 32, le tirage est donc sans biais et sans rejet.
 */
export function generateClaimCode(randomBytes: (size: number) => Uint8Array): string {
  const bytes = randomBytes(CLAIM_CODE_LENGTH);
  if (bytes.length !== CLAIM_CODE_LENGTH)
    throw new TagFormatError('BAD_LENGTH', 'source d’aléa : 10 octets attendus');
  let code = '';
  for (const byte of bytes) code += CLAIM_CODE_ALPHABET[byte & 0x1f];
  return code;
}

/** Saisie → 10 caractères : retire tirets et espaces, met en majuscules, refuse tout le reste. */
export function normalizeClaimCode(input: string): string {
  const code = input.replace(/[\s-]/g, '').toUpperCase();
  if (code.length !== CLAIM_CODE_LENGTH)
    throw new TagFormatError('BAD_CLAIM_CODE', 'code de rattachement : 10 caractères attendus');
  for (const char of code) {
    if (!CLAIM_CODE_ALPHABET.includes(char))
      throw new TagFormatError('BAD_CLAIM_CODE', 'code de rattachement : caractère non permis');
  }
  return code;
}

export function formatClaimCode(code: string): string {
  const normalized = normalizeClaimCode(code);
  return `${normalized.slice(0, 4)}-${normalized.slice(4)}`;
}

/** Contenu du QR imprimé : `https://<domaine>/c/<code>`. */
export function claimCodeUrl(domain: string, code: string): string {
  return `https://${domain}/c/${normalizeClaimCode(code)}`;
}
