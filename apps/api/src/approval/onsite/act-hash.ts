// Empreinte de la requête liée à un jeton d'approbation sur place (contracts/approvals.md, research R-09) :
//   act_hash = hex(SHA-256(METHOD "\n" PATH "\n" JCS(body ?? null)))
// PATH = chemin RÉEL avec le préfixe /v1, sans chaîne de requête (différent de l'empreinte S21, qui prend le
// gabarit de route). Corps en JSON canonique RFC 8785 ; corps absent = `null`.
import { createHash, timingSafeEqual } from 'node:crypto';
import canonicalize from 'canonicalize';
import type { Request } from 'express';

export function actHash(method: string, path: string, body: unknown): string {
  const canonical = canonicalize(body === undefined || body === '' ? null : body) ?? 'null';
  return createHash('sha256').update(`${method.toUpperCase()}\n${path}\n${canonical}`, 'utf8').digest('hex');
}

/** Corps reçu ; une requête sans corps (aucun octet) vaut `null`, même si l'analyseur a posé `{}`. */
function receivedBody(req: Request): unknown {
  const length = req.headers['content-length'];
  const empty = (length === undefined || length === '0') && req.headers['transfer-encoding'] === undefined;
  return empty ? null : (req.body as unknown);
}

export function requestActHash(req: Request): string {
  return actHash(req.method, req.originalUrl.split('?')[0]!, receivedBody(req));
}

/** Comparaison en temps constant de deux empreintes hexadécimales. */
export function sameHash(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}
