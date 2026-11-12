// Formats des deux fichiers de l'inscription, figés par interfaces.md § 13.1 (aucun champ ajouté ici ; FORMATS.md n'est
// qu'un renvoi). Partagés avec la passerelle (WP16 : `apps/gateway/src/enrollment/enrollment.service.ts`, qui REFUSE
// tout champ inconnu : d'où l'absence de numéro de version dans le fichier d'enrôlement).
//
//  - Demande (produite par la passerelle) : JSON { serial, role, csr_pem, batch_public_key, snapshot_key_id,
//    snapshot_public_key, token_public_key, agreement_public_key, lan_url }. Clés publiques en SPKI DER encodé en
//    base64url (P-256), sauf `agreement_public_key` : point non compressé de 65 octets, base64url. Aucun secret.
//  - Enrôlement (produit par l'outil) : JSON { gateway_id, operator_id, event_id, ledger_id, serial, role, central_url,
//    central_ca_pem, device_ca_pem, client_cert_pem, lan_authority, site_order_keys: [{ holder, public_key } x 2] }.
//    Aucun secret. USAGE UNIQUE : la passerelle le consomme (`gateway enroll`) puis le supprime ; l'outil le crée en
//    0600, refuse d'écraser un fichier et n'affiche que son chemin.
import 'reflect-metadata';
import { createPublicKey, ECDH, X509Certificate, type KeyObject } from 'node:crypto';
import * as x509 from '@peculiar/x509';

export class FormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FormatError';
  }
}

export type GatewayRole = 'PRIMARY' | 'STANDBY';

export interface EnrollmentRequest {
  serial: string;
  role: GatewayRole;
  csrPem: string;
  /** SPKI DER P-256. */
  batchPublicKey: Buffer;
  snapshotKeyId: string;
  /** SPKI DER P-256. */
  snapshotPublicKey: Buffer;
  /** SPKI DER P-256 (validée, non portée par une fonction d'inscription : voir le rapport du lot). */
  tokenPublicKey: Buffer;
  /** Point non compressé, 65 octets. */
  agreementPublicKey: Buffer;
  lanUrl: string;
}

export interface SiteOrderKey {
  holder: string;
  public_key: string;
}

export interface EnrollmentFile {
  gateway_id: string;
  operator_id: string;
  event_id: string;
  ledger_id: string;
  serial: string;
  role: GatewayRole;
  central_url: string;
  central_ca_pem: string;
  device_ca_pem: string;
  client_cert_pem: string;
  lan_authority: string;
  site_order_keys: [SiteOrderKey, SiteOrderKey];
}

export const REQUEST_KEYS = [
  'serial',
  'role',
  'csr_pem',
  'batch_public_key',
  'snapshot_key_id',
  'snapshot_public_key',
  'token_public_key',
  'agreement_public_key',
  'lan_url',
] as const;

export const ENROLLMENT_KEYS = [
  'gateway_id',
  'operator_id',
  'event_id',
  'ledger_id',
  'serial',
  'role',
  'central_url',
  'central_ca_pem',
  'device_ca_pem',
  'client_cert_pem',
  'lan_authority',
  'site_order_keys',
] as const;

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BASE64URL = /^[A-Za-z0-9_-]+={0,2}$/;
const SPKI_P256_LENGTH = 91;
const P256_POINT_LENGTH = 65;

function exactKeys(value: unknown, keys: readonly string[], what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new FormatError(`${what} : objet JSON attendu`);
  const record = value as Record<string, unknown>;
  const missing = keys.filter((key) => !(key in record));
  const extra = Object.keys(record).filter((key) => !keys.includes(key));
  if (missing.length > 0) throw new FormatError(`${what} : champ manquant (${missing.join(', ')})`);
  if (extra.length > 0) throw new FormatError(`${what} : champ inconnu (${extra.join(', ')})`);
  return record;
}

function text(record: Record<string, unknown>, key: string, max: number): string {
  const value = record[key];
  if (typeof value !== 'string' || value.trim() === '' || value.length > max)
    throw new FormatError(`${key} : texte non vide de ${max} caractères au plus attendu`);
  return value;
}

/** Clé publique P-256 en SPKI DER (octets), ou refus. Les messages ne citent jamais la valeur. */
export function p256Spki(der: Buffer, what: string): Buffer {
  let key: KeyObject;
  try {
    key = createPublicKey({ key: der, format: 'der', type: 'spki' });
  } catch {
    throw new FormatError(`${what} : clé publique SPKI illisible`);
  }
  if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1')
    throw new FormatError(`${what} : clé ECDSA P-256 attendue`);
  if (der.length !== SPKI_P256_LENGTH)
    throw new FormatError(`${what} : SPKI P-256 de ${SPKI_P256_LENGTH} octets attendu`);
  return der;
}

function spkiField(record: Record<string, unknown>, key: string): Buffer {
  const value = text(record, key, 512);
  if (!BASE64URL.test(value)) throw new FormatError(`${key} : base64url attendu`);
  return p256Spki(Buffer.from(value, 'base64url'), key);
}

function agreementField(record: Record<string, unknown>): Buffer {
  const value = text(record, 'agreement_public_key', 512);
  if (!BASE64URL.test(value)) throw new FormatError('agreement_public_key : base64url attendu');
  const point = Buffer.from(value, 'base64url');
  if (point.length !== P256_POINT_LENGTH || point[0] !== 0x04)
    throw new FormatError(
      `agreement_public_key : point non compressé de ${P256_POINT_LENGTH} octets attendu`,
    );
  try {
    ECDH.convertKey(point, 'prime256v1'); // refuse un point hors de la courbe
  } catch {
    throw new FormatError('agreement_public_key : point hors de la courbe P-256');
  }
  return point;
}

/** Valide un fichier de demande. Refuse toute clé privée, tout champ inconnu, toute longueur incorrecte. */
export function parseRequestFile(raw: string): EnrollmentRequest {
  if (/PRIVATE KEY/.test(raw)) throw new FormatError('demande : clé privée interdite');
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new FormatError('demande : JSON illisible');
  }
  const record = exactKeys(json, REQUEST_KEYS, 'demande');
  const role = text(record, 'role', 16);
  if (role !== 'PRIMARY' && role !== 'STANDBY') throw new FormatError('role : PRIMARY ou STANDBY');
  const lanUrl = text(record, 'lan_url', 512);
  assertHttpsUrl(lanUrl, 'lan_url');
  return {
    serial: text(record, 'serial', 128),
    role,
    csrPem: text(record, 'csr_pem', 16384),
    batchPublicKey: spkiField(record, 'batch_public_key'),
    snapshotKeyId: text(record, 'snapshot_key_id', 128),
    snapshotPublicKey: spkiField(record, 'snapshot_public_key'),
    tokenPublicKey: spkiField(record, 'token_public_key'),
    agreementPublicKey: agreementField(record),
    lanUrl,
  };
}

export function assertHttpsUrl(value: string, what: string, allowHttp = false): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new FormatError(`${what} : URL illisible`);
  }
  if (url.protocol !== 'https:' && !(allowHttp && url.protocol === 'http:'))
    throw new FormatError(`${what} : https obligatoire`);
  if (url.username !== '' || url.password !== '')
    throw new FormatError(`${what} : aucun identifiant dans l'URL`);
  return url;
}

/** Hôte:port de `lan_url` (le port par défaut est écrit explicitement). */
export function lanAuthority(lanUrl: string): string {
  const url = assertHttpsUrl(lanUrl, 'lan_url');
  return `${url.hostname}:${url.port === '' ? '443' : url.port}`;
}

/** Vérifie la demande de certificat : P-256, auto-signée, et clé = clé de lot déclarée. */
export async function checkCsr(request: EnrollmentRequest): Promise<void> {
  let csr: x509.Pkcs10CertificateRequest;
  try {
    csr = new x509.Pkcs10CertificateRequest(request.csrPem);
  } catch {
    throw new FormatError('csr_pem : demande de certificat illisible');
  }
  p256Spki(Buffer.from(csr.publicKey.rawData), 'csr_pem (clé)');
  if (!(await csr.verify())) throw new FormatError('csr_pem : non signée par sa propre clé');
  if (!Buffer.from(csr.publicKey.rawData).equals(request.batchPublicKey))
    throw new FormatError('csr_pem : la clé du CSR diffère de batch_public_key');
}

/** Clé de site : PEM SPKI ou base64/base64url d'un SPKI DER, P-256 exigée. Rend le SPKI DER. */
export function parseSiteKey(value: string): Buffer {
  const trimmed = value.trim();
  let der: Buffer;
  try {
    der = trimmed.includes('BEGIN')
      ? (createPublicKey(trimmed).export({ type: 'spki', format: 'der' }) as Buffer)
      : Buffer.from(trimmed, 'base64');
  } catch {
    throw new FormatError('clé de site : clé publique illisible');
  }
  return p256Spki(der, 'clé de site');
}

export function buildEnrollmentFile(input: EnrollmentFile): EnrollmentFile {
  return exactKeys(input, ENROLLMENT_KEYS, 'enrôlement') as unknown as EnrollmentFile;
}

export function serializeEnrollment(file: EnrollmentFile): string {
  return `${JSON.stringify(buildEnrollmentFile(file), null, 2)}\n`;
}

/** Contrôle de forme du fichier d'enrôlement (champs exacts, UUID, certificats, deux clés de site distinctes). */
export function checkEnrollmentFile(raw: string): EnrollmentFile {
  if (/PRIVATE KEY/.test(raw)) throw new FormatError('enrôlement : clé privée interdite');
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new FormatError('enrôlement : JSON illisible');
  }
  const record = exactKeys(json, ENROLLMENT_KEYS, 'enrôlement');
  for (const key of ['gateway_id', 'operator_id', 'event_id', 'ledger_id'] as const)
    if (!UUID.test(text(record, key, 64))) throw new FormatError(`${key} : UUID attendu`);
  const role = text(record, 'role', 16);
  if (role !== 'PRIMARY' && role !== 'STANDBY') throw new FormatError('role : PRIMARY ou STANDBY');
  for (const key of ['central_ca_pem', 'device_ca_pem', 'client_cert_pem'] as const) {
    try {
      new X509Certificate(text(record, key, 65536));
    } catch {
      throw new FormatError(`${key} : certificat PEM illisible`);
    }
  }
  const keys = record.site_order_keys;
  if (!Array.isArray(keys) || keys.length !== 2)
    throw new FormatError('site_order_keys : exactement deux clés attendues');
  const parsed = keys.map((entry) => {
    const item = exactKeys(entry, ['holder', 'public_key'], 'site_order_keys[]');
    return {
      holder: text(item, 'holder', 200),
      key: parseSiteKey(text(item, 'public_key', 4096)),
    };
  });
  if (normalizeHolder(parsed[0]!.holder) === normalizeHolder(parsed[1]!.holder))
    throw new FormatError('site_order_keys : deux titulaires distincts exigés');
  if (parsed[0]!.key.equals(parsed[1]!.key))
    throw new FormatError('site_order_keys : deux clés distinctes exigées');
  text(record, 'serial', 128);
  text(record, 'central_url', 512);
  text(record, 'lan_authority', 300);
  return record as unknown as EnrollmentFile;
}

export function normalizeHolder(holder: string): string {
  return holder.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}
