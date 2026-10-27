// Jetons des demandes de paiement QR (mission 5b, lot WP13, T061 ; FR-018, FR-019, NFR-008 ;
// contracts/qr-payments.md « Jetons »).
//
// - QR commerçant : 16 octets (128 bits) de `randomBytes`, en base64url (22 caractères) ;
// - QR client : 12 caractères base32 (60 bits), chacun tiré de 5 bits d'un octet aléatoire
//   (`octet & 31` : 32 divise 256, donc aucun biais de tirage) ;
// - l'empreinte (`nonce_hash`) est le SHA-256 des octets UTF-8 du jeton TEL QUE REÇU : c'est
//   `qrTokenHash` de WP11, réutilisée sans modification, de sorte qu'un jeton donne la même empreinte
//   à la création (ce lot) et à l'encaissement par le terminal (WP11).
// Le jeton n'a AUCUN autre usage : il n'est ni journalisé, ni audité, ni gardé (seule l'empreinte part
// en base) ; il est rendu une seule fois, dans la réponse de création.
import { randomBytes } from 'node:crypto';
import { qrTokenHash } from '../payments/qr-token-hash';

/** Alphabet base32 du QR client : chiffres et lettres sans I, L, O, U (lisibles à l'écran). */
export const CUSTOMER_TOKEN_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const CUSTOMER_TOKEN_LENGTH = 12;
export const MERCHANT_TOKEN_BYTES = 16;

/** Jeton du QR commerçant : 128 bits aléatoires en base64url. */
export function newMerchantToken(): string {
  return randomBytes(MERCHANT_TOKEN_BYTES).toString('base64url');
}

/** Jeton du QR client : 12 caractères base32 (60 bits), tirage sans biais. */
export function newCustomerToken(): string {
  const bytes = randomBytes(CUSTOMER_TOKEN_LENGTH);
  let token = '';
  for (const byte of bytes) token += CUSTOMER_TOKEN_ALPHABET[byte & 31];
  return token;
}

/** `nonce_hash` : SHA-256 (32 octets) du jeton. */
export const nonceHash: (token: string) => Buffer = qrTokenHash;
