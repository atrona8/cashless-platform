// Éléments communs des ventes de la passerelle (WP21) : bornes, lecture des corps, correspondance
// des refus d'autorité, heure d'une opération. Aucune règle de calcul ici : montants, partage entre
// crédits offerts et payés viennent de `@cashless/shared-rules`.
import { randomUUID } from 'node:crypto';
import type { AuthorityRefusal } from '../../authority/authority.service';
import type { TxClient } from '../../db/gateway-tx';
import { ProblemException } from '../../device-proofs/problem';
import { deviceKey } from '../../device/device-key';

/** Plafond par vente au rejeu (décision 13 du porteur, 05/11/2026), en unités mineures. */
export const SALE_CEILING = 50_000n;
/** Plafond par terminal et par heure glissante (décision 13). */
export const TERMINAL_HOURLY_CEILING = 500_000n;
/**
 * Ordre de dépense (décision 45, ADR-185) : répliqué dans `edge_terms.spend_order`. Absent (`null`) : inconnu, et la
 * passerelle refuse les ventes dont la répartition dépend de l'ordre (aucun défaut supposé).
 */
export type SpendOrder = 'PROMO_FIRST' | 'PAID_FIRST';
/** Tolérance de l'heure d'une opération de terminal (identique au central, SPECIFICATION §9.6). */
export const OCCURRED_AT_TOLERANCE_MS = 120_000;
export const DEFAULT_TAP_WINDOW_SECONDS = 120;
export const DEFAULT_REVERSAL_WINDOW_MINUTES = 15;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX32 = /^[0-9a-f]{64}$/;
const NFC_UID = /^[0-9a-f]{14}$/;
const CURRENCY = /^[A-Z]{3}$/;
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{8,128}$/;
const EPOCH = /^[0-9]{1,15}$/;

export const invalid = (detail: string, status = 400): ProblemException =>
  new ProblemException('VALIDATION_FAILED', { status, detail });

export const isUuid = (value: unknown): value is string =>
  typeof value === 'string' && UUID.test(value);

export function objectBody(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
    throw invalid('Corps JSON (objet) attendu.');
  return raw as Record<string, unknown>;
}

export function dateTimeField(body: Record<string, unknown>, name: string): Date {
  const value = body[name];
  if (typeof value !== 'string' || !DATE_TIME.test(value) || Number.isNaN(Date.parse(value)))
    throw invalid(`${name} : date-heure attendue.`);
  return new Date(value);
}

/** Entier sûr de `min` à `max`, sinon `400` (un entier au-delà de 2^53 - 1 n'est pas exact). */
export function intField(
  body: Record<string, unknown>,
  name: string,
  min: number,
  max = Number.MAX_SAFE_INTEGER,
): number {
  const value = body[name];
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max)
    throw invalid(`${name} : entier de ${min} à ${max} attendu.`);
  return value;
}

/** Un reçu `TapInput` (openapi.yaml) : seuls les champs du contrat sont gardés. */
export interface TapReading {
  nfcUid: Buffer;
  tokenHash: Buffer;
  counter: number;
  originalitySignature: Buffer | null;
  occurredAt: Date;
  /** Objet de l'opération (`tap`), tel que le central le rejoue : champs du contrat seulement. */
  wire: Record<string, unknown>;
}

export function parseTapReading(raw: unknown, label = 'tap'): TapReading {
  const body = objectBody(raw);
  const uid = body.nfc_uid;
  const hash = body.token_hash;
  const signature = body.originality_signature;
  if (typeof uid !== 'string' || !NFC_UID.test(uid)) throw invalid(`${label}.nfc_uid : invalide.`);
  if (typeof hash !== 'string' || !HEX32.test(hash))
    throw invalid(`${label}.token_hash : invalide.`);
  const counter = intField(body, 'counter', 0, 16_777_215);
  const keyIndex = intField(body, 'key_index', 0, 65_535);
  if (typeof body.pack_verified !== 'boolean') throw invalid(`${label}.pack_verified : booléen.`);
  if (body.pack_verified !== true)
    throw invalid(`${label}.pack_verified : le PACK doit être vérifié.`, 422);
  if (signature !== undefined && (typeof signature !== 'string' || !HEX32.test(signature)))
    throw invalid(`${label}.originality_signature : 64 caractères hexadécimaux attendus.`);
  const occurredAt = dateTimeField(body, 'occurred_at');
  const wire: Record<string, unknown> = {
    nfc_uid: uid,
    token_hash: hash,
    counter,
    key_index: keyIndex,
    pack_verified: true,
    ...(signature === undefined ? {} : { originality_signature: signature }),
    occurred_at: body.occurred_at,
  };
  for (const name of ['format_major', 'format_minor']) {
    if (body[name] !== undefined) wire[name] = intField(body, name, 0, 255);
  }
  return {
    nfcUid: Buffer.from(uid, 'hex'),
    tokenHash: Buffer.from(hash, 'hex'),
    counter,
    originalitySignature: signature === undefined ? null : Buffer.from(signature as string, 'hex'),
    occurredAt,
    wire,
  };
}

/** `<serial>:<seq>` : le serial est celui du terminal authentifié, seq >= 1 (openapi.yaml). */
export function parseIdempotencyKey(
  header: string | undefined,
  serial: string,
): { key: string; seq: number } {
  if (header === undefined || header.trim() === '')
    throw new ProblemException('IDEMPOTENCY_KEY_REQUIRED');
  const key = header.trim();
  if (!IDEMPOTENCY_KEY.test(key)) throw invalid('Idempotency-Key : format invalide.', 422);
  const cut = key.lastIndexOf(':');
  const seqText = cut < 0 ? '' : key.slice(cut + 1);
  if (cut < 0 || key.slice(0, cut) !== serial || !/^[0-9]{1,15}$/.test(seqText))
    throw invalid('Idempotency-Key : <serial du terminal>:<seq> attendu.', 422);
  const seq = Number(seqText);
  if (seq < 1) throw invalid('Idempotency-Key : seq >= 1 attendu.', 422);
  // Clé canonique (décision 52) : `<serial>:<seq>` sur 4 chiffres au moins, la forme du central.
  return { key: deviceKey(serial, seq), seq };
}

/** `X-Authority-Epoch` obligatoire sur un débit (comme le central, A27). */
export function parseAuthorityEpoch(header: string | undefined): number {
  if (header === undefined || header.trim() === '')
    throw invalid('X-Authority-Epoch : en-tête obligatoire sur une opération de débit.', 422);
  if (!EPOCH.test(header.trim())) throw invalid('X-Authority-Epoch : entier positif ou nul.', 422);
  return Number(header.trim());
}

/** Refus d'autorité de WP17 -> réponse du contrat (interfaces.md § 7). */
export function authorityProblem(refusal: AuthorityRefusal): ProblemException {
  const extensions = { authority_epoch: refusal.authorityEpoch };
  switch (refusal.code) {
    case 'DEBIT_AUTHORITY_MOVING':
      return new ProblemException('DEBIT_AUTHORITY_MOVING', {
        extensions: { ...extensions, retryable: true },
      });
    case 'STALE_AUTHORITY_EPOCH':
      return new ProblemException('STALE_AUTHORITY_EPOCH', {
        extensions: { ...extensions, retryable: false },
      });
    case 'CONFLICT_STATE':
      return new ProblemException('CONFLICT_STATE', {
        detail: refusal.detail ?? 'GATEWAY_NOT_AUTHORITY',
        extensions: { ...extensions, retryable: false },
      });
  }
}

export interface OperationTime {
  occurredAt: Date;
  /** Heure reçue quand elle a été écartée (hors tolérance), sinon `null`. */
  deviceOccurredAt: Date | null;
}

/** Bornée à ±120 s de l'horloge de la passerelle (jamais l'horloge de Node ni de la base). */
export function resolveOperationTime(received: Date, now: Date): OperationTime {
  const gap = Math.abs(received.getTime() - now.getTime());
  return gap > OCCURRED_AT_TOLERANCE_MS
    ? { occurredAt: now, deviceOccurredAt: received }
    : { occurredAt: received, deviceOccurredAt: null };
}

/** Refus final conservé au registre d'idempotence (rejoué à l'identique). */
export interface StoredRefusal {
  refusal: true;
  code: string;
  status: number;
  detail?: string;
  extensions?: Record<string, unknown>;
}

/** Un refus final : `retryable: false` (la même clé rend le même refus). */
export function finalRefusal(problem: ProblemException): ProblemException {
  return new ProblemException(problem.code, {
    status: problem.status,
    ...(problem.detail === undefined ? {} : { detail: problem.detail }),
    extensions: { retryable: false, ...problem.extensions },
  });
}

export function storeRefusal(problem: ProblemException): StoredRefusal {
  return {
    refusal: true,
    code: problem.code,
    status: problem.status,
    ...(problem.detail === undefined ? {} : { detail: problem.detail }),
    extensions: problem.extensions ?? { retryable: false },
  };
}

export function restoreRefusal(stored: StoredRefusal): ProblemException {
  return new ProblemException(stored.code as ProblemException['code'], {
    status: stored.status,
    ...(stored.detail === undefined ? {} : { detail: stored.detail }),
    ...(stored.extensions === undefined ? {} : { extensions: stored.extensions }),
  });
}

export const newTransactionId = (): string => randomUUID();

export function iso(date: Date): string {
  return date.toISOString();
}

/**
 * Lectures et passages : servis dans tous les états d'autorité sauf `REVOKED` (gateway-served-
 * operations.md, « Lectures »). Une passerelle non enrôlée ne sert rien.
 */
export async function assertNotRevoked(tx: TxClient): Promise<void> {
  const { rows } = await tx.query<{ state: string; highest: string }>(
    'SELECT state, highest_epoch_seen AS highest FROM edge_authority',
  );
  const row = rows[0];
  if (!row || row.state === 'REVOKED')
    throw new ProblemException('STALE_AUTHORITY_EPOCH', {
      extensions: { authority_epoch: Number(row?.highest ?? 0), retryable: false },
    });
}

export interface EventSettings {
  status: string;
  currency: string;
  tapReplayWindowSeconds: number;
  reversalWindowMinutes: number;
  /** `edge_terms.spend_order` répliqué ; `null` : inconnu (échec fermé). */
  spendOrder: SpendOrder | null;
}

export async function readEventSettings(tx: TxClient): Promise<EventSettings | null> {
  const { rows } = await tx.query<{
    status: string;
    currency: string;
    terminal_settings: Record<string, unknown>;
    edge_terms: Record<string, unknown> | null;
  }>('SELECT status, currency, terminal_settings, edge_terms FROM edge_event_setting');
  const row = rows[0];
  if (!row) return null;
  const positive = (value: unknown, fallback: number): number =>
    typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : fallback;
  const order = row.edge_terms?.spend_order;
  return {
    status: row.status,
    currency: row.currency.trim(),
    spendOrder: order === 'PROMO_FIRST' || order === 'PAID_FIRST' ? order : null,
    tapReplayWindowSeconds: positive(
      row.terminal_settings.tap_replay_window_seconds,
      DEFAULT_TAP_WINDOW_SECONDS,
    ),
    reversalWindowMinutes: positive(
      row.terminal_settings.reversal_window_minutes,
      DEFAULT_REVERSAL_WINDOW_MINUTES,
    ),
  };
}
