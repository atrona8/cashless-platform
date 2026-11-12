// Corps des requêtes servies par ce lot : mêmes bornes que le central (openapi.yaml :
// DeviceTokenRefreshRequest, HeartbeatRequest). Une erreur de forme est `400 VALIDATION_FAILED`.
import { ProblemException } from '../device-proofs/problem';

export const REFRESH_PROOF_DOMAIN = 'cashless-refresh-v1';
export const P1363_SIGNATURE_LENGTH = 64;

const SERIAL = /^[A-Za-z0-9._-]{3,64}$/;
const REFRESH_TOKEN = /^[A-Za-z0-9_-]{16,128}$/;
const NONCE = /^[A-Za-z0-9+/=_-]{16,64}$/;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

const invalid = (detail: string): ProblemException =>
  new ProblemException('VALIDATION_FAILED', { status: 400, detail });

function objectBody(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
    throw invalid('Corps JSON (objet) attendu.');
  return raw as Record<string, unknown>;
}

function textField(body: Record<string, unknown>, name: string, pattern: RegExp): string {
  const value = body[name];
  if (value === undefined) throw invalid(`Champ obligatoire : ${name}.`);
  if (typeof value !== 'string' || !pattern.test(value)) throw invalid(`${name} : format invalide.`);
  return value;
}

function intField(
  body: Record<string, unknown>,
  name: string,
  min: number,
  max: number,
  required: boolean,
): number | undefined {
  const value = body[name];
  if (value === undefined) {
    if (required) throw invalid(`Champ obligatoire : ${name}.`);
    return undefined;
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max)
    throw invalid(`${name} : entier de ${min} à ${max} attendu.`);
  return value;
}

export interface RefreshRequest {
  serial: string;
  refreshToken: string;
  nonce: string;
  signature: Buffer;
}

export function parseRefresh(raw: unknown): RefreshRequest {
  const body = objectBody(raw);
  const serial = textField(body, 'serial', SERIAL);
  const refreshToken = textField(body, 'refresh_token', REFRESH_TOKEN);
  const nonce = textField(body, 'nonce', NONCE);
  const signature = textField(body, 'signature', BASE64);
  if (signature.length === 0 || signature.length > 256) throw invalid('signature : base64 attendu.');
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

export interface HeartbeatInput {
  deviceTime: Date;
  lastLocalSeq: number;
  pendingOperations: number;
  snapshotVersion: number | null;
  appVersion: string | null;
}

export function parseHeartbeat(raw: unknown): HeartbeatInput {
  const body = objectBody(raw);
  const time = body.device_time;
  if (typeof time !== 'string' || !DATE_TIME.test(time) || Number.isNaN(Date.parse(time)))
    throw invalid('device_time : date-heure attendue.');
  const lastLocalSeq = intField(body, 'last_local_seq', 0, Number.MAX_SAFE_INTEGER, true)!;
  const pendingOperations = intField(body, 'pending_operations', 0, Number.MAX_SAFE_INTEGER, true)!;
  const snapshotVersion =
    body.snapshot_version === null || body.snapshot_version === undefined
      ? null
      : intField(body, 'snapshot_version', 0, Number.MAX_SAFE_INTEGER, true)!;
  intField(body, 'pending_exposure', 0, Number.MAX_SAFE_INTEGER, false);
  intField(body, 'battery_percent', 0, 100, false);
  const app = body.app_version;
  if (app !== undefined && (typeof app !== 'string' || app.length > 64))
    throw invalid('app_version : texte de 64 caractères au plus.');
  return {
    deviceTime: new Date(time),
    lastLocalSeq,
    pendingOperations,
    snapshotVersion,
    appVersion: app ?? null,
  };
}
