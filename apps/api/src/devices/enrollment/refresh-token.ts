// Jeton de rafraîchissement d'un terminal (research R-07) : `drt_` suivi de 256 bits aléatoires en
// base64url. Seule son empreinte SHA-256 (des octets UTF-8 du jeton entier) va en base : pas de
// secret de hachage, l'entropie de 256 bits suffit. Le jeton en clair n'existe que dans la réponse.
import { createHash, randomBytes } from 'node:crypto';

export const REFRESH_TOKEN_PREFIX = 'drt_';

export function newRefreshToken(): string {
  return `${REFRESH_TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
}

export function refreshTokenHash(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}
