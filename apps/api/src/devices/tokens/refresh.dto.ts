// Corps de `POST /v1/device-tokens/refresh` (openapi.yaml : DeviceTokenRefreshRequest ;
// contracts/device-tokens.md ; research R-07) et message de la preuve de possession.
//
// Preuve : signature ECDSA P-256 / SHA-256, au format brut `r ‖ s` (64 octets, `ieee-p1363`, même
// format que la signature des requêtes, R-04), en base64, de
// `"cashless-refresh-v1" ‖ 0x00 ‖ nonce ‖ 0x00 ‖ serial ‖ 0x00 ‖ refresh_token` (octets UTF-8).
// Aucun des trois champs ne peut contenir l'octet nul (jeux de caractères bornés ci-dessous) : le
// découpage du message est unique, et une signature faite pour un autre usage de la clé (requête
// RFC 9421, autre domaine) ne se rejoue pas ici.
import { invalid, objectBody } from '../../organization/platform/platform.dto';

/** Séparateur de domaine de la preuve (contrat). */
export const REFRESH_PROOF_DOMAIN = 'cashless-refresh-v1';
/** Signature ECDSA P-256 au format brut `r ‖ s`. */
export const P1363_SIGNATURE_LENGTH = 64;

const SERIAL = /^[A-Za-z0-9._-]{3,64}$/;
/** `drt_` puis 256 bits en base64url (43 caractères) : bornes larges, jeu de caractères strict. */
const REFRESH_TOKEN = /^[A-Za-z0-9_-]{16,128}$/;
/** Nonce du contrat (16 caractères au moins) : texte ASCII sans séparateur, 64 au plus. */
const NONCE = /^[A-Za-z0-9+/=_-]{16,64}$/;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export interface RefreshRequest {
  serial: string;
  refreshToken: string;
  /** Nonce tel que reçu (signé et consommé sous la forme de ses octets UTF-8). */
  nonce: string;
  /** Signature décodée (sa longueur est contrôlée à la vérification : refus 401, pas 400). */
  signature: Buffer;
}

function field(body: Record<string, unknown>, name: string, pattern: RegExp, rule: string): string {
  const value = body[name];
  if (value === undefined) throw invalid(`Champ obligatoire : ${name}.`);
  if (typeof value !== 'string' || !pattern.test(value)) throw invalid(`${name} : ${rule}.`);
  return value;
}

/** Forme du corps : 400 VALIDATION_FAILED. */
export function parseRefresh(raw: unknown): RefreshRequest {
  const body = objectBody(raw);
  const serial = field(body, 'serial', SERIAL, '3 à 64 caractères A-Z, a-z, 0-9, « . _ - »');
  const refreshToken = field(body, 'refresh_token', REFRESH_TOKEN, 'jeton de rafraîchissement');
  const nonce = field(body, 'nonce', NONCE, '16 à 64 caractères base64 ou base64url');
  const signature = field(body, 'signature', BASE64, 'base64 attendu');
  if (signature.length === 0 || signature.length > 256)
    throw invalid('signature : base64 attendu.');
  return { serial, refreshToken, nonce, signature: Buffer.from(signature, 'base64') };
}

/** Message signé par le terminal (séparateur de domaine, champs séparés par 0x00). */
export function refreshProofMessage(nonce: string, serial: string, refreshToken: string): Buffer {
  const zero = Buffer.from([0]);
  return Buffer.concat([
    Buffer.from(REFRESH_PROOF_DOMAIN, 'utf8'),
    zero,
    Buffer.from(nonce, 'utf8'),
    zero,
    Buffer.from(serial, 'utf8'),
    zero,
    Buffer.from(refreshToken, 'utf8'),
  ]);
}
