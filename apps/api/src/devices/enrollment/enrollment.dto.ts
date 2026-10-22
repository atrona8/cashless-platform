// Corps de `POST /v1/device-enrollments` (openapi.yaml : DeviceEnrollmentRequest ;
// contracts/enrollment.md, étapes 1 et 2). Étape 1 : forme du corps (400 VALIDATION_FAILED).
// Étape 2 : clés P-256 (422 VALIDATION_FAILED).
//
// Format des clés publiques (relecture WP11, écrit au contrat) : `signing_public_key` et
// `agreement_public_key` sont des SubjectPublicKeyInfo DER CANONIQUES (point non compressé,
// 91 octets), en base64. Le serveur réencode chaque clé lue et exige les mêmes octets : une seule
// forme existe, la même sur Android et iOS. Les défis d'attestation (R-08) hachent ces octets TELS
// QUE REÇUS ; la base garde le SPKI de signature (`device.public_key`) et, pour la clé d'accord, le
// point non compressé de 65 octets qu'il contient (`device.agreement_public_key`, data-model ;
// lu par l'enveloppe des mots de passe de bracelet), tiré de ces mêmes octets.
import { createPublicKey } from 'node:crypto';
import type { AttestationOs } from '../../attestation/attestation.port';
import {
  EnrollmentCodeFormatError,
  normalizeEnrollmentCode,
} from '../../enrollment-code/enrollment-code';
import { invalid, objectBody, unprocessable } from '../../organization/platform/platform.dto';

const SERIAL = /^[A-Za-z0-9._-]{3,64}$/;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
/** SPKI DER d'une clé P-256 au point non compressé. */
export const P256_SPKI_LENGTH = 91;
/** Bornes des preuves reçues (taille d'une requête sans compte). */
const MAX_CHAIN_LENGTH = 10;
const MAX_CERTIFICATE_BYTES = 16 * 1024;
const MAX_CSR_LENGTH = 8 * 1024;
const MAX_CODE_INPUT = 64;

export interface EnrollmentRequest {
  /** Code normalisé ; `null` si la saisie est mal formée (refus de l'étape 3, comme un inconnu). */
  code: string | null;
  serial: string;
  os: AttestationOs;
  appVersion: string;
  signingSpki: Buffer;
  agreementSpki: Buffer;
  keyAttestationChain: Buffer[];
  agreementAttestationChain: Buffer[] | null;
  csrPem: string;
}

/** Code normalisé de la saisie, ou `null` (absente, pas un texte, mal formée). Ne lève jamais. */
export function enrollmentCodeOf(raw: unknown): string | null {
  const value =
    typeof raw === 'object' && raw !== null && !Array.isArray(raw)
      ? (raw as Record<string, unknown>).enrollment_code
      : undefined;
  if (typeof value !== 'string') return null;
  try {
    return normalizeEnrollmentCode(value);
  } catch (error) {
    if (error instanceof EnrollmentCodeFormatError) return null;
    throw error;
  }
}

function text(body: Record<string, unknown>, name: string, max: number): string {
  const value = body[name];
  if (value === undefined) throw invalid(`Champ obligatoire : ${name}.`);
  if (typeof value !== 'string' || value.length === 0 || value.length > max)
    throw invalid(`${name} : texte de 1 à ${max} caractères.`);
  return value;
}

function base64(value: unknown, name: string, maxBytes: number): Buffer {
  if (typeof value !== 'string' || value.length === 0 || !BASE64.test(value))
    throw invalid(`${name} : base64 attendu.`);
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length > maxBytes) throw invalid(`${name} : ${maxBytes} octets au plus.`);
  return bytes;
}

function chain(body: Record<string, unknown>, name: string): Buffer[] {
  const value = body[name];
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_CHAIN_LENGTH)
    throw invalid(`${name} : liste de 1 à ${MAX_CHAIN_LENGTH} éléments en base64.`);
  return value.map((item, index) => base64(item, `${name}[${index}]`, MAX_CERTIFICATE_BYTES));
}

/** Étape 1 : forme du corps. */
export function parseEnrollment(raw: unknown): EnrollmentRequest {
  const body = objectBody(raw);
  text(body, 'enrollment_code', MAX_CODE_INPUT);
  const serial = text(body, 'serial', 64);
  if (!SERIAL.test(serial)) throw invalid('serial : 3 à 64 caractères A-Z, a-z, 0-9, « . _ - ».');
  const os = body.os;
  if (os !== 'ANDROID' && os !== 'IOS') throw invalid('os : ANDROID ou IOS.');
  const appVersion = text(body, 'app_version', 64);
  const signingSpki = base64(body.signing_public_key, 'signing_public_key', 256);
  const agreementSpki = base64(body.agreement_public_key, 'agreement_public_key', 256);
  const keyAttestationChain = chain(body, 'key_attestation_chain');
  // Android : la chaîne de la clé d'accord est obligatoire ; iOS : sans objet (non lue).
  const agreementAttestationChain =
    os === 'ANDROID' ? chain(body, 'agreement_attestation_chain') : null;
  const csrPem = text(body, 'csr_pem', MAX_CSR_LENGTH);
  return {
    code: enrollmentCodeOf(body),
    serial,
    os,
    appVersion,
    signingSpki,
    agreementSpki,
    keyAttestationChain,
    agreementAttestationChain,
    csrPem,
  };
}

/** Point non compressé (65 octets) d'une clé P-256 valide en SPKI canonique ; sinon 422. */
export function p256Point(spki: Buffer, name: string): Buffer {
  let canonical: Buffer;
  try {
    // OpenSSL refuse un point hors de la courbe au décodage.
    const key = createPublicKey({ key: spki, format: 'der', type: 'spki' });
    if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1')
      throw new Error('pas une clé P-256');
    canonical = key.export({ format: 'der', type: 'spki' });
  } catch {
    throw unprocessable(`${name} : clé publique EC P-256 (SPKI DER) attendue.`);
  }
  if (spki.length !== P256_SPKI_LENGTH || !canonical.equals(spki))
    throw unprocessable(`${name} : SPKI DER canonique attendu (point non compressé, 91 octets).`);
  // SPKI canonique : en-tête fixe de 26 octets, puis la BIT STRING du point (0x04 ‖ x ‖ y).
  const point = spki.subarray(P256_SPKI_LENGTH - 65);
  if (point[0] !== 0x04) throw unprocessable(`${name} : point non compressé attendu.`);
  return Buffer.from(point);
}

/** Étape 2 : clés de signature et d'accord, P-256, canoniques et distinctes. */
export function checkKeys(input: EnrollmentRequest): { agreementPoint: Buffer } {
  p256Point(input.signingSpki, 'signing_public_key');
  const agreementPoint = p256Point(input.agreementSpki, 'agreement_public_key');
  if (input.signingSpki.equals(input.agreementSpki))
    throw unprocessable('Clés de signature et d’accord : deux clés distinctes attendues.');
  return { agreementPoint };
}
