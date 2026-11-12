import { createHash } from 'node:crypto';
import canonicalize from 'canonicalize';

/**
 * SHA-256 de la forme canonique (RFC 8785) des champs fournis ; les champs `undefined` sont omis (« champs
 * absents = omis »). Aucun champ d'état ne doit être passé par l'appelant.
 */
export function contentSha256(fields: Record<string, unknown>): Buffer {
  const present = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
  const canonical = canonicalize(present);
  if (canonical === undefined) throw new Error('content_sha256 : forme canonique impossible');
  return createHash('sha256').update(canonical, 'utf8').digest();
}
