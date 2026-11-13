// Ordres locaux à deux personnes (interfaces.md § 12.13 et § 13.3, décision du porteur du
// 05/11/2026). Réutilisé par la purge (WP24).
//
// FORMAT (choix de ce lot, § 12.13 ne fixe que le principe ; signalé au porteur) :
//   ordre   = objet JSON plat, `{ kind, gateway_id, issued_at, nonce, ... }` (champs propres au
//             type : `epoch` pour `LOCAL_UNSTALE`) ; valeurs chaîne/nombre/booléen seulement ;
//   signé   = JCS (RFC 8785, paquet `canonicalize`) de l'ordre, octets UTF-8 ;
//   signature = ES256 (ECDSA P-256 + SHA-256), forme brute r||s de 64 octets en base64url, comme un
//             JWS ; `signatures = [{ holder, signature }, { holder, signature }]` ;
//   clés    = les DEUX clés publiques nominatives du fichier d'enrôlement (`edge_site_order_key`),
//             retrouvées par `holder`. Seules les parties publiques sont sur la passerelle.
// Règles : exactement deux signatures, de deux responsables DISTINCTS portant deux clés DISTINCTES,
// chacune valide ; ordre valable 10 minutes sur l'horloge de la passerelle (60 s de tolérance vers
// le futur) ; nonce à usage unique, consigné dans `edge_audit` (`SITE_ORDER_ACCEPTED`, index
// unique : même sous concurrence). L'audit ne retient que les identifiants des clés, jamais une
// signature ni une clé.
import { createHash, createPublicKey, verify, type KeyObject } from 'node:crypto';
import canonicalize from 'canonicalize';
import type { TxClient } from '../db/gateway-tx';

export const ORDER_VALIDITY_MS = 10 * 60 * 1000;
export const ORDER_FUTURE_TOLERANCE_MS = 60 * 1000;
export const SITE_ORDER_KINDS = ['LOCAL_UNSTALE', 'PURGE'] as const;
export type SiteOrderKind = (typeof SITE_ORDER_KINDS)[number];

export type SiteOrderErrorCode =
  | 'MALFORMED'
  | 'KIND_MISMATCH'
  | 'SIGNATURE_COUNT'
  | 'SAME_SIGNER'
  | 'UNKNOWN_HOLDER'
  | 'BAD_SIGNATURE'
  | 'EXPIRED'
  | 'FROM_THE_FUTURE'
  | 'NONCE_REPLAYED'
  | 'NO_SITE_KEYS'
  | 'WRONG_GATEWAY'
  | 'REFUSED';

export class SiteOrderError extends Error {
  constructor(
    readonly code: SiteOrderErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'SiteOrderError';
  }
}

export interface OrderSignature {
  holder: string;
  signature: string;
}
export interface SiteKeyRow {
  holder: string;
  public_key: string;
}
export type OrderPayload = Record<string, string | number | boolean>;

export interface VerifiedOrder {
  holders: [string, string];
  /** Identifiant d'une clé : 16 premiers caractères hexadécimaux du SHA-256 de son SPKI. */
  keyIds: [string, string];
  orderSha256: string;
}

const NONCE = /^[A-Za-z0-9_-]{16,128}$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const SIGNATURE_BYTES = 64;

function fail(code: SiteOrderErrorCode, message: string): never {
  throw new SiteOrderError(code, message);
}

/** Octets signés : JCS de l'ordre. */
export function orderBytes(payload: OrderPayload): Buffer {
  const canonical = canonicalize(payload);
  if (canonical === undefined) fail('MALFORMED', 'ordre non canonicalisable');
  return Buffer.from(canonical, 'utf8');
}

export function keyObject(publicKey: string): KeyObject {
  const key = publicKey.includes('BEGIN')
    ? createPublicKey(publicKey)
    : createPublicKey({ key: Buffer.from(publicKey, 'base64'), format: 'der', type: 'spki' });
  if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') {
    throw new Error('clé de site : P-256 attendue');
  }
  return key;
}

export function keyId(key: KeyObject): string {
  return createHash('sha256')
    .update(key.export({ type: 'spki', format: 'der' }))
    .digest('hex')
    .slice(0, 16);
}

export async function loadSiteOrderKeys(tx: TxClient): Promise<SiteKeyRow[]> {
  const { rows } = await tx.query<SiteKeyRow>(
    'SELECT holder, public_key FROM edge_site_order_key ORDER BY holder',
  );
  return rows;
}

/** Forme de l'ordre (champs communs) ; rend l'ordre typé. */
export function parseOrderPayload(value: unknown): OrderPayload {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail('MALFORMED', 'ordre : objet attendu');
  }
  const out: OrderPayload = {};
  for (const [name, item] of Object.entries(value)) {
    if (typeof item !== 'string' && typeof item !== 'number' && typeof item !== 'boolean') {
      return fail('MALFORMED', `ordre : valeur non admise (${name.slice(0, 32)})`);
    }
    if (typeof item === 'number' && !Number.isSafeInteger(item)) {
      return fail('MALFORMED', `ordre : entier sûr attendu (${name.slice(0, 32)})`);
    }
    if (typeof item === 'string' && item.length > 512) {
      return fail('MALFORMED', `ordre : texte trop long (${name.slice(0, 32)})`);
    }
    out[name] = item;
  }
  for (const required of ['kind', 'gateway_id', 'issued_at', 'nonce']) {
    if (typeof out[required] !== 'string') return fail('MALFORMED', `ordre : ${required} manquant`);
  }
  if (!ISO_UTC.test(out.issued_at as string) || Number.isNaN(Date.parse(out.issued_at as string))) {
    return fail('MALFORMED', 'ordre : issued_at (ISO 8601 UTC) illisible');
  }
  if (!NONCE.test(out.nonce as string)) return fail('MALFORMED', 'ordre : nonce illisible');
  return out;
}

export function parseSignatures(value: unknown): OrderSignature[] {
  if (!Array.isArray(value) || value.length > 8)
    return fail('SIGNATURE_COUNT', 'signatures : liste attendue');
  return value.map((entry) => {
    if (
      typeof entry !== 'object' ||
      entry === null ||
      typeof (entry as OrderSignature).holder !== 'string' ||
      typeof (entry as OrderSignature).signature !== 'string' ||
      (entry as OrderSignature).holder === '' ||
      (entry as OrderSignature).signature.length > 256
    ) {
      return fail('MALFORMED', 'signatures : { holder, signature } attendu');
    }
    return {
      holder: (entry as OrderSignature).holder,
      signature: (entry as OrderSignature).signature,
    };
  });
}

/**
 * Vérification générique d'un ordre à deux personnes (LOCAL_UNSTALE, PURGE). `keys` : les clés
 * enregistrées (`loadSiteOrderKeys`) ; `now` : horloge de la passerelle. Ne consomme PAS le nonce
 * (`consumeOrderNonce`, dans la transaction qui applique l'effet). Lève `SiteOrderError`.
 * `expectedGatewayId` (WP24, facultatif pour rester compatible) : si fourni, l'ordre doit viser
 * cette
 * passerelle (`WRONG_GATEWAY`), contrôlé APRÈS les signatures : un ordre falsifié reste
 * `BAD_SIGNATURE`.
 */
export function verifyTwoPersonOrder(
  kind: SiteOrderKind,
  payload: OrderPayload,
  signatures: OrderSignature[],
  keys: SiteKeyRow[],
  now: Date,
  expectedGatewayId?: string,
): VerifiedOrder {
  const order = parseOrderPayload(payload);
  if (order.kind !== kind) fail('KIND_MISMATCH', 'ordre : type différent de celui attendu');
  if (keys.length !== 2) fail('NO_SITE_KEYS', 'ordres locaux : deux clés de site attendues');
  if (signatures.length !== 2) fail('SIGNATURE_COUNT', 'ordre : exactement deux signatures');
  const [first, second] = signatures as [OrderSignature, OrderSignature];
  if (first.holder === second.holder)
    fail('SAME_SIGNER', 'ordre : deux signatures du même responsable');

  const data = orderBytes(order);
  const ids: string[] = [];
  for (const entry of [first, second]) {
    const registered = keys.find((key) => key.holder === entry.holder);
    if (!registered) fail('UNKNOWN_HOLDER', 'ordre : responsable inconnu');
    let key: KeyObject;
    try {
      key = keyObject(registered.public_key);
    } catch {
      return fail('NO_SITE_KEYS', 'ordres locaux : clé de site illisible');
    }
    const raw = Buffer.from(entry.signature, 'base64url');
    // Re-encodage identique exigé : une signature « malléable » sous une autre forme est refusée.
    if (raw.length !== SIGNATURE_BYTES || raw.toString('base64url') !== entry.signature) {
      fail('BAD_SIGNATURE', 'ordre : signature illisible');
    }
    let ok = false;
    try {
      ok = verify('sha256', data, { key, dsaEncoding: 'ieee-p1363' }, raw);
    } catch {
      ok = false;
    }
    if (!ok) fail('BAD_SIGNATURE', 'ordre : signature invalide');
    ids.push(keyId(key));
  }
  if (ids[0] === ids[1]) fail('SAME_SIGNER', 'ordre : deux signatures de la même clé');

  if (expectedGatewayId !== undefined && order.gateway_id !== expectedGatewayId) {
    fail('WRONG_GATEWAY', 'ordre : autre passerelle');
  }

  const age = now.getTime() - Date.parse(order.issued_at as string);
  if (age > ORDER_VALIDITY_MS) fail('EXPIRED', 'ordre : périmé (10 minutes)');
  if (age < -ORDER_FUTURE_TOLERANCE_MS) fail('FROM_THE_FUTURE', 'ordre : daté du futur');

  return {
    holders: [first.holder, second.holder],
    keyIds: [ids[0]!, ids[1]!],
    orderSha256: createHash('sha256').update(data).digest('hex'),
  };
}

/**
 * Consigne le nonce (usage unique) dans la transaction de l'effet. Un nonce déjà vu lève
 * `NONCE_REPLAYED`. `detail` ne contient que des identifiants (jamais une signature).
 */
export async function consumeOrderNonce(
  tx: TxClient,
  order: OrderPayload,
  verified: VerifiedOrder,
): Promise<void> {
  const nonce = order.nonce as string;
  const seen = await tx.query(
    `SELECT 1 FROM edge_audit WHERE kind = 'SITE_ORDER_ACCEPTED' AND detail ->> 'nonce' = $1`,
    [nonce],
  );
  if (seen.rows.length > 0) fail('NONCE_REPLAYED', 'ordre : nonce déjà utilisé');
  await tx.query(
    `INSERT INTO edge_audit (kind, actor, detail) VALUES ('SITE_ORDER_ACCEPTED', $1, $2)`,
    [
      verified.holders.join('+'),
      JSON.stringify({
        nonce,
        order_kind: order.kind,
        order_sha256: verified.orderSha256,
        issued_at: order.issued_at,
        holders: verified.holders,
        key_ids: verified.keyIds,
      }),
    ],
  );
}
