// Empreinte d'une requête (contracts/idempotency.md, règle 3) :
// SHA-256 hex de METHOD + "\n" + modèle de route + "\n" + JCS(corps) (RFC 8785, paquet `canonicalize`).
import { createHash } from 'node:crypto';
import canonicalize from 'canonicalize';
import type { Request } from 'express';

/** Corps absent ou vide → `null` (même empreinte qu'un corps JSON `null`). */
function canonicalBody(body: unknown): string {
  const value = body === undefined || body === '' ? null : body;
  return canonicalize(value) ?? 'null';
}

export function requestHash(method: string, routeTemplate: string, body: unknown): string {
  return createHash('sha256')
    .update(`${method.toUpperCase()}\n${routeTemplate}\n${canonicalBody(body)}`, 'utf8')
    .digest('hex');
}

/** Chemin déclaré de la route (ex. `/v1/__test/notes/:id`), jamais l'URL concrète. */
export function routeTemplate(req: Request): string {
  const declared = (req.route as { path?: unknown } | undefined)?.path;
  return `${req.baseUrl}${typeof declared === 'string' ? declared : req.path}`;
}
