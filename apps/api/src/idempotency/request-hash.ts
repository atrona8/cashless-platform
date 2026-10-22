// Empreinte d'une requête (contracts/idempotency.md, règle 3 ; OP-N54, ADR-99, research R-13 ; OP-N71,
// ADR-116) : HMAC-SHA256 hex, sous `IDEMPOTENCY_HMAC_KEY`, de
// METHOD + "\n" + chemin concret + "\n" + JCS(appelant) + "\n" + JCS(corps) (RFC 8785, paquet
// `canonicalize`). Le corps peut porter un secret (code imprimé, code d'enrôlement) : une empreinte
// sans clé le laisserait retrouver par essais si la base fuyait. La clé vit hors de la base et n'est
// jamais journalisée. Pas de préfixe `h1:` (R-13) : la contrainte `api_idempotency_hash_hex`
// (`^[0-9a-f]{64}$`, migration 0002) le refuserait ; le schéma prévaut (SPECIFICATION §0.3).
//
// Chemin concret (ADR-116) : paramètres de chemin compris, chaîne de requête exclue. La même clé sur
// un autre `:id` n'a pas la même empreinte : `IDEMPOTENCY_KEY_REUSED`, jamais la réponse de la
// première ressource. Appelant : la personne, le terminal et le festivalier authentifiés (lus sur
// ce que les gardes ont posé, jamais sur la requête) ; un autre appelant qui présente la même clé
// reçoit `IDEMPOTENCY_KEY_REUSED`, jamais une réponse qu'il n'a pas obtenue lui-même.
import { createHmac } from 'node:crypto';
import canonicalize from 'canonicalize';
import type { Request } from 'express';
import type { CustomerRequest } from '../customer-identity/customer-identity.port';
import type { DeviceRequest } from '../device-identity/device-identity.port';
import type { PrincipalRequest } from '../identity/principal';

/** Taille minimale de la clé, comme les autres secrets HMAC du serveur. */
const MIN_KEY_LENGTH = 32;

/**
 * Appelant authentifié auquel la clé est liée. Une route de guichet porte la personne ET le
 * terminal ; une requête sans appelant (route de test) donne `{}`.
 */
export interface RequestCaller {
  person?: string;
  device?: string;
  customer?: string;
}

/** Corps absent ou vide → `null` (même empreinte qu'un corps JSON `null`). */
function canonicalBody(body: unknown): string {
  const value = body === undefined || body === '' ? null : body;
  return canonicalize(value) ?? 'null';
}

export function requestHash(
  method: string,
  path: string,
  caller: RequestCaller,
  body: unknown,
  key: Buffer,
): string {
  if (key.length < MIN_KEY_LENGTH)
    throw new Error(`Empreinte de requête : clé de ${MIN_KEY_LENGTH} octets au moins`);
  return createHmac('sha256', key)
    .update(
      `${method.toUpperCase()}\n${path}\n${canonicalize(caller) ?? '{}'}\n${canonicalBody(body)}`,
      'utf8',
    )
    .digest('hex');
}

/** Chemin concret de la requête (ex. `/v1/devices/<id>/revoke`), sans la chaîne de requête. */
export function concretePath(req: Request): string {
  return `${req.baseUrl}${req.path}`;
}

/** Appelant posé par les gardes (personne, terminal, festivalier) ; rien de ce que la requête déclare. */
export function requestCaller(req: Request): RequestCaller {
  const caller: RequestCaller = {};
  const person = (req as PrincipalRequest).principal?.userId;
  const device = (req as DeviceRequest).device?.deviceId;
  const customer = (req as CustomerRequest).customer?.customerId;
  if (person !== undefined) caller.person = person;
  if (device !== undefined) caller.device = device;
  if (customer !== undefined) caller.customer = customer;
  return caller;
}

/** Chemin déclaré de la route (ex. `/v1/__test/notes/:id`) : journaux seulement, jamais l'empreinte. */
export function routeTemplate(req: Request): string {
  const declared = (req.route as { path?: unknown } | undefined)?.path;
  return `${req.baseUrl}${typeof declared === 'string' ? declared : req.path}`;
}
