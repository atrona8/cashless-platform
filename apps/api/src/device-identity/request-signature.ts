// Signature des requêtes de terminal (research R-04, contracts/device-authentication.md « Base de
// signature ») : profil restreint de RFC 9421 (HTTP Message Signatures), ECDSA P-256 / SHA-256.
// - un seul libellé, `dev` ; toute autre signature est ignorée ;
// - composants couverts, dans cet ordre et tous obligatoires : `@method`, `@authority`, `@path`,
//   `@query`, `content-digest`, `x-request-id`, et `idempotency-key` quand la requête porte
//   `Idempotency-Key` (route d'écriture) ; aucun paramètre de composant ;
// - paramètres exactement `created`, `nonce`, `keyid`, `alg` ; `expires` (et tout autre) refusé ;
// - `Content-Digest` (RFC 9530) : `sha-256` seul, sur les octets bruts du corps (corps vide
// compris) ;
// - signature au format brut `r ‖ s` (64 octets, `ieee-p1363`). Les champs structurés (RFC 8941)
// sont analysés par `structured-headers`, jamais à la main. `signRequest` est le geste symétrique,
// pour le terminal de test : la vérification ne s'appuie pas sur lui (base de signature fixée sur
// un exemple écrit à la main, request-signature.spec.ts). Toute erreur est une
// `SignatureProfileError` : sa raison va au journal technique, jamais au client.
import { createHash, sign, timingSafeEqual, verify, type KeyObject } from 'node:crypto';
import {
  parseDictionary,
  serializeDictionary,
  serializeInnerList,
  type BareItem,
  type InnerList,
  type Item,
  type Parameters,
} from 'structured-headers';

export const SIGNATURE_LABEL = 'dev';
export const SIGNATURE_ALG = 'ecdsa-p256-sha256';
/** Composants d'une lecture (sans `Idempotency-Key`), dans l'ordre imposé. */
export const READ_COMPONENTS = [
  '@method',
  '@authority',
  '@path',
  '@query',
  'content-digest',
  'x-request-id',
] as const;
/** Composants d'une écriture (requête qui porte `Idempotency-Key`). */
export const WRITE_COMPONENTS = [...READ_COMPONENTS, 'idempotency-key'] as const;
const PARAMETERS = ['created', 'nonce', 'keyid', 'alg'] as const;
/** Bornes du nonce : 128 bits au moins (R-04), 64 octets au plus (`device_request_nonce`). */
const NONCE_MIN_BYTES = 16;
const NONCE_MAX_BYTES = 64;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

/** Signature refusée ; `reason` est interne (journal technique), jamais renvoyée au client. */
export class SignatureProfileError extends Error {
  constructor(readonly reason: string) {
    super(`Signature de requête refusée : ${reason}`);
    this.name = 'SignatureProfileError';
  }
}

const refuse = (reason: string): never => {
  throw new SignatureProfileError(reason);
};

/** Ce que couvre la signature, lu de la requête telle que reçue. */
export interface SignedRequestParts {
  method: string;
  /** `@authority` normalisé (`normalizeAuthority`). */
  authority: string;
  /** Chemin absolu, sans la requête. */
  path: string;
  /** Chaîne de requête brute, sans le `?` (vide s'il n'y en a pas). */
  query: string;
  contentDigest: string;
  requestId: string;
  /** `null` : lecture ; sinon la clé d'idempotence, composant obligatoire. */
  idempotencyKey: string | null;
}

export interface SignatureParams {
  /** Secondes Unix. */
  created: number;
  /** Nonce en base64url, tel que signé. */
  nonce: string;
  keyid: string;
}

/** Signature vérifiée : ce qui sert ensuite au contrôle du rejeu. */
export interface VerifiedSignature {
  created: Date;
  nonce: Buffer;
  keyid: string;
}

/** Valeur de `Content-Digest` pour ces octets : `sha-256=:<base64>:`. */
export function contentDigest(body: Buffer): string {
  return serializeDictionary(
    new Map([['sha-256', [createHash('sha256').update(body).digest(), new Map()] as Item]]),
  );
}

function parseOrRefuse(header: string, what: string): Map<string, Item | InnerList> {
  try {
    return parseDictionary(header);
  } catch {
    return refuse(`${what} illisible`);
  }
}

/** `Content-Digest` : un seul membre, `sha-256`, égal au SHA-256 des octets bruts du corps. */
export function verifyContentDigest(header: string | undefined, body: Buffer): void {
  if (!header) refuse('Content-Digest absent');
  const digest = parseOrRefuse(header!, 'Content-Digest');
  if (digest.size !== 1 || !digest.has('sha-256')) refuse('Content-Digest : sha-256 seul admis');
  const [value, params] = digest.get('sha-256')!;
  if (!(value instanceof ArrayBuffer) || (params as Parameters).size !== 0)
    refuse('Content-Digest : séquence d’octets sans paramètre attendue');
  const given = Buffer.from(value as ArrayBuffer);
  const expected = createHash('sha256').update(body).digest();
  if (given.length !== expected.length || !timingSafeEqual(given, expected))
    refuse('Content-Digest différent du corps reçu');
}

/**
 * `@authority` (RFC 9421 §2.2.3) : hôte en minuscules, port par défaut de HTTPS retiré. Refus d'une
 * valeur qui n'est pas un hôte (informations d'utilisateur, espaces, chemin).
 */
export function normalizeAuthority(host: string | undefined): string {
  const value = (host ?? '').trim().toLowerCase();
  if (!/^(\[[0-9a-f:.]+\]|[a-z0-9.-]+)(:[0-9]{1,5})?$/.test(value)) refuse('Host invalide');
  return value.endsWith(':443') ? value.slice(0, -4) : value;
}

/**
 * `@authority` servie par ce déploiement (`DEVICE_REQUEST_AUTHORITIES`) : égalité exacte, ou même
 * hôte pour une entrée `host:*` (hors production seulement, config.ts). Une requête signée pour une
 * autre autorité (passerelle locale, autre déploiement) est refusée même si sa signature est
 * valide.
 */
export function authorityAllowed(authority: string, allowed: readonly string[]): boolean {
  return allowed.some((entry) => {
    if (!entry.endsWith(':*')) return entry === authority;
    const host = entry.slice(0, -2);
    return authority === host || authority.startsWith(`${host}:`);
  });
}

/** Valeur d'un champ couvert : présent une seule fois, espaces de bord retirés. */
function headerValue(raw: string | string[] | undefined, name: string): string {
  if (raw === undefined) return refuse(`${name} absent`);
  if (Array.isArray(raw)) return refuse(`${name} répété`);
  const value = raw.trim();
  if (value === '') refuse(`${name} vide`);
  return value;
}

/** Requête minimale lue par la vérification (sous-ensemble d'`express.Request`). */
export interface SignableRequest {
  method: string;
  originalUrl: string;
  headers: Record<string, string | string[] | undefined>;
}

/** Parties couvertes, lues de la requête reçue (`originalUrl` : préfixe global compris). */
export function requestParts(req: SignableRequest): SignedRequestParts {
  const target = req.originalUrl;
  const mark = target.indexOf('?');
  const path = mark === -1 ? target : target.slice(0, mark);
  if (!path.startsWith('/')) refuse('chemin non absolu');
  const requestId = headerValue(req.headers['x-request-id'], 'X-Request-Id');
  if (!UUID.test(requestId)) refuse('X-Request-Id : UUID attendu');
  const idempotency = req.headers['idempotency-key'];
  return {
    method: req.method.toUpperCase(),
    authority: normalizeAuthority(headerValue(req.headers.host, 'Host')),
    path,
    query: mark === -1 ? '' : target.slice(mark + 1),
    contentDigest: headerValue(req.headers['content-digest'], 'Content-Digest'),
    requestId,
    idempotencyKey: idempotency === undefined ? null : headerValue(idempotency, 'Idempotency-Key'),
  };
}

function componentsFor(parts: SignedRequestParts): readonly string[] {
  return parts.idempotencyKey === null ? READ_COMPONENTS : WRITE_COMPONENTS;
}

function componentValue(parts: SignedRequestParts, component: string): string {
  switch (component) {
    case '@method':
      return parts.method;
    case '@authority':
      return parts.authority;
    case '@path':
      return parts.path;
    case '@query':
      return `?${parts.query}`;
    case 'content-digest':
      return parts.contentDigest;
    case 'x-request-id':
      return parts.requestId;
    case 'idempotency-key':
      return parts.idempotencyKey ?? refuse('idempotency-key sans Idempotency-Key');
    default:
      return refuse(`composant inconnu ${component}`);
  }
}

/** `Signature-Input` d'un terminal : liste des composants et paramètres, dans l'ordre du profil. */
export function signatureParamsList(
  components: readonly string[],
  params: SignatureParams,
): InnerList {
  return [
    components.map((component): Item => [component, new Map()]),
    new Map<string, BareItem>([
      ['created', params.created],
      ['nonce', params.nonce],
      ['keyid', params.keyid],
      ['alg', SIGNATURE_ALG],
    ]),
  ];
}

/** Base de signature (RFC 9421 §2.5) : une ligne par composant, puis `@signature-params`. */
export function signatureBase(parts: SignedRequestParts, list: InnerList): string {
  const lines = list[0].map(([component]) => {
    const name = component as string;
    const value = componentValue(parts, name);
    if (/[\r\n]/.test(value)) refuse(`${name} : fin de ligne interdite`);
    return `"${name}": ${value}`;
  });
  lines.push(`"@signature-params": ${serializeInnerList(list)}`);
  return lines.join('\n');
}

/** Paramètres du profil, lus d'une liste reçue : exactement ceux de R-04, `expires` refusé. */
function readParams(params: Parameters): SignatureParams {
  if (params.has('expires')) refuse('paramètre expires refusé');
  const keys = [...params.keys()];
  if (keys.length !== PARAMETERS.length || keys.some((key, i) => key !== PARAMETERS[i]))
    refuse(`paramètres attendus : ${PARAMETERS.join(', ')}, dans cet ordre`);
  const created = params.get('created');
  const nonce = params.get('nonce');
  const keyid = params.get('keyid');
  if (typeof created !== 'number' || !Number.isSafeInteger(created) || created <= 0)
    refuse('created : entier positif attendu');
  if (typeof nonce !== 'string' || !BASE64URL.test(nonce)) refuse('nonce : base64url attendu');
  if (typeof keyid !== 'string' || keyid === '') refuse('keyid absent');
  if (params.get('alg') !== SIGNATURE_ALG) refuse(`alg : ${SIGNATURE_ALG} attendu`);
  return { created: created as number, nonce: nonce as string, keyid: keyid as string };
}

/**
 * Vérifie la signature `dev` de la requête avec la clé publique du terminal (SPKI DER, P-256) :
 * composants exacts, `keyid` = terminal, ECDSA `ieee-p1363`. Rend `created` et le nonce décodé.
 */
export function verifyRequestSignature(
  parts: SignedRequestParts,
  headers: { signatureInput: string | undefined; signature: string | undefined },
  expectedKeyId: string,
  publicKey: KeyObject,
): VerifiedSignature {
  if (!headers.signatureInput || !headers.signature) refuse('Signature-Input ou Signature absent');
  const input = parseOrRefuse(headers.signatureInput!, 'Signature-Input').get(SIGNATURE_LABEL);
  const signed = parseOrRefuse(headers.signature!, 'Signature').get(SIGNATURE_LABEL);
  if (!input || !signed) refuse(`libellé ${SIGNATURE_LABEL} absent`);
  const [items, params] = input as InnerList;
  if (!Array.isArray(items)) refuse('Signature-Input : liste de composants attendue');
  const expected = componentsFor(parts);
  if (
    items.length !== expected.length ||
    items.some(([name, p], i) => name !== expected[i] || (p as Parameters).size !== 0)
  )
    refuse(`composants attendus : ${expected.join(' ')}`);
  const read = readParams(params);
  if (read.keyid !== expectedKeyId) refuse('keyid différent du terminal du jeton');
  const nonce = Buffer.from(read.nonce, 'base64url');
  if (nonce.length < NONCE_MIN_BYTES || nonce.length > NONCE_MAX_BYTES)
    refuse('nonce : 16 à 64 octets attendus');
  const [value, signatureParams] = signed as Item;
  if (!(value instanceof ArrayBuffer) || (signatureParams as Parameters).size !== 0)
    refuse('Signature : séquence d’octets sans paramètre attendue');
  const signature = Buffer.from(value as ArrayBuffer);
  if (signature.length !== 64) refuse('signature : r ‖ s de 64 octets attendu');
  // La base est reconstruite à partir des composants et paramètres reçus, resérialisés.
  const base = signatureBase(parts, [items, params]);
  let valid: boolean;
  try {
    valid = verify(
      'sha256',
      Buffer.from(base, 'utf8'),
      { key: publicKey, dsaEncoding: 'ieee-p1363' },
      signature,
    );
  } catch {
    valid = false;
  }
  if (!valid) refuse('signature ECDSA invalide');
  return { created: new Date(read.created * 1000), nonce, keyid: read.keyid };
}

/** En-têtes de signature d'une requête (terminal de test ; geste symétrique de la vérification). */
export function signRequest(
  parts: SignedRequestParts,
  params: SignatureParams,
  privateKey: KeyObject,
  components: readonly string[] = componentsFor(parts),
): { signatureInput: string; signature: string } {
  const list = signatureParamsList(components, params);
  const base = signatureBase(parts, list);
  const signature = sign('sha256', Buffer.from(base, 'utf8'), {
    key: privateKey,
    dsaEncoding: 'ieee-p1363',
  });
  return {
    signatureInput: serializeDictionary(new Map([[SIGNATURE_LABEL, list]])),
    signature: serializeDictionary(new Map([[SIGNATURE_LABEL, [signature, new Map()] as Item]])),
  };
}
