// Corps, requêtes et réponses des demandes de remboursement (mission 9a, WP04 ; contrat `RefundRequest*`).
// Lecture stricte : tout champ inconnu est refusé en `400` (aucun champ ne se pose de l'extérieur). La réponse sort
// d'UN mapper : jamais `requested_by`, `confirmed_by`, `operator_id` ni l'IBAN.
import type { components } from '@cashless/contracts';
import { isValidIban, normalizeIban } from '../common/iban';
import { ProblemException } from '../errors/problem';
import { isUuid, objectBody } from '../organization/platform/platform.dto';

type RefundRequestCreate = components['schemas']['RefundRequestCreate'];
export type RefundRequest = components['schemas']['RefundRequest'];
export type RefundRequestCreateInput = RefundRequestCreate;

const invalid = (detail: string) =>
  new ProblemException('VALIDATION_FAILED', { status: 400, detail });
const MSISDN = /^\+[1-9][0-9]{6,14}$/;
const CODE = /^[0-9]{6}$/;
const STATUSES = [
  'AWAITING_HOLDER',
  'REQUESTED',
  'PROCESSING',
  'PAID',
  'FAILED',
  'REJECTED',
  'CANCELLED',
  'BLOCKED',
] as const;
export type RefundStatus = (typeof STATUSES)[number];

function only(body: Record<string, unknown>, allowed: readonly string[], where: string): void {
  const unknown = Object.keys(body).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) throw invalid(`${where} : champ inconnu (${unknown.join(', ')}).`);
}

export function parseRefundRequestCreate(raw: unknown): RefundRequestCreate {
  const body = objectBody(raw);
  only(body, ['wallet_id', 'destination'], 'corps');
  if (!isUuid(body.wallet_id)) throw invalid('wallet_id : identifiant attendu.');
  const dest = objectBody(body.destination);
  only(dest, ['method', 'msisdn', 'new_number_otp', 'iban'], 'destination');
  if (dest.method !== 'WAVE' && dest.method !== 'ORANGE_MONEY' && dest.method !== 'BANK_TRANSFER')
    throw invalid('destination.method : WAVE, ORANGE_MONEY ou BANK_TRANSFER attendu.');
  const destination: RefundRequestCreate['destination'] = { method: dest.method };
  if (dest.msisdn !== undefined) {
    if (typeof dest.msisdn !== 'string' || !MSISDN.test(dest.msisdn))
      throw invalid('destination.msisdn : numéro au format international attendu.');
    destination.msisdn = dest.msisdn;
  }
  if (dest.iban !== undefined) {
    if (typeof dest.iban !== 'string' || dest.iban.length === 0 || dest.iban.length > 64)
      throw invalid('destination.iban : texte attendu.');
    destination.iban = dest.iban;
  }
  if (dest.new_number_otp !== undefined) {
    const otp = objectBody(dest.new_number_otp);
    only(otp, ['otp_request_id', 'code'], 'new_number_otp');
    const id = otp.otp_request_id;
    if (typeof id !== 'string' || id.length === 0 || id.length > 64)
      throw invalid('new_number_otp.otp_request_id : texte de 1 à 64 caractères attendu.');
    if (typeof otp.code !== 'string' || !CODE.test(otp.code))
      throw invalid('new_number_otp.code : 6 chiffres attendus.');
    destination.new_number_otp = { otp_request_id: id, code: otp.code };
  }
  return { wallet_id: body.wallet_id, destination };
}

export interface RefundBackofficeCreateInput {
  walletId: string;
  method: 'WAVE' | 'ORANGE_MONEY' | 'BANK_TRANSFER';
  msisdn: string | null;
  /** IBAN normalisé (`normalizeIban`), jamais la saisie brute. */
  iban: string | null;
  reason: string;
}

const invalid422 = (detail: string) =>
  new ProblemException('VALIDATION_FAILED', { status: 422, detail });

/** Corps de `createRefundRequest` (`RefundRequestBackofficeCreate`) : strict, champ inconnu en `422`. */
export function parseRefundRequestBackofficeCreate(raw: unknown): RefundBackofficeCreateInput {
  const body = objectBody(raw);
  const bad = (where: string, allowed: readonly string[], o: Record<string, unknown>) => {
    const unknown = Object.keys(o).filter((key) => !allowed.includes(key));
    if (unknown.length > 0) throw invalid422(`${where} : champ inconnu (${unknown.join(', ')}).`);
  };
  bad('corps', ['wallet_id', 'destination', 'reason'], body);
  if (!isUuid(body.wallet_id)) throw invalid422('wallet_id : identifiant attendu.');
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (reason.length < 10 || reason.length > 2000)
    throw invalid422('reason : texte de 10 à 2000 caractères attendu.');
  const dest = objectBody(body.destination);
  bad('destination', ['method', 'msisdn', 'iban'], dest);
  const method = dest.method;
  if (method !== 'WAVE' && method !== 'ORANGE_MONEY' && method !== 'BANK_TRANSFER')
    throw invalid422('destination.method : WAVE, ORANGE_MONEY ou BANK_TRANSFER attendu.');
  if (method === 'BANK_TRANSFER') {
    if (dest.msisdn !== undefined)
      throw invalid422('destination.msisdn : interdit pour un virement.');
    if (typeof dest.iban !== 'string' || dest.iban.length === 0 || dest.iban.length > 64)
      throw invalid422('destination.iban : IBAN attendu.');
    if (!isValidIban(dest.iban)) throw invalid422('destination.iban : IBAN invalide.');
    return {
      walletId: body.wallet_id,
      method,
      msisdn: null,
      iban: normalizeIban(dest.iban),
      reason,
    };
  }
  if (dest.iban !== undefined) throw invalid422('destination.iban : réservé au virement.');
  if (typeof dest.msisdn !== 'string' || !MSISDN.test(dest.msisdn))
    throw invalid422('destination.msisdn : numéro au format international attendu.');
  return { walletId: body.wallet_id, method, msisdn: dest.msisdn, iban: null, reason };
}

export function parseRejectBody(raw: unknown): { reason: string } {
  const body = objectBody(raw);
  only(body, ['reason'], 'corps');
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (reason.length === 0 || reason.length > 2000)
    throw invalid('reason : texte de 1 à 2000 caractères attendu.');
  return { reason };
}

export function parseStatusFilter(raw: unknown): RefundStatus | null {
  if (raw === undefined || raw === '') return null;
  if (typeof raw !== 'string' || !(STATUSES as readonly string[]).includes(raw))
    throw invalid('status : valeur hors énumération.');
  return raw as RefundStatus;
}

export function parseEventFilter(raw: unknown): string | null {
  if (raw === undefined || raw === '') return null;
  if (!isUuid(raw)) throw invalid('event_id : identifiant attendu.');
  return raw;
}

/** Colonnes lues, dans l'ordre attendu par `toRefundRequest` (alias `r`). */
export const REFUND_COLUMNS = `r.id, r.event_id, r.wallet_id, r.status, r.estimated_amount::text, r.fee::text,
  r.currency, r.method, r.msisdn, r.transaction_id, r.approved_by, r.new_number, r.hold_until,
  r.extra_check_required, r.external_reference, r.failure_reason, r.reversal_transaction_id, r.created_at,
  r.reject_reason`;

export interface RefundRow {
  id: string;
  event_id: string;
  wallet_id: string;
  status: RefundStatus;
  estimated_amount: string;
  fee: string;
  currency: string;
  method: string;
  msisdn: string | null;
  transaction_id: string | null;
  approved_by: string | null;
  new_number: boolean;
  hold_until: Date | null;
  extra_check_required: boolean;
  external_reference: string | null;
  failure_reason: string | null;
  reversal_transaction_id: string | null;
  created_at: Date;
  reject_reason: string | null;
}

export function toRefundRequest(row: RefundRow): RefundRequest {
  return {
    refund_request_id: row.id,
    wallet_id: row.wallet_id,
    status: row.status,
    estimated_amount: Number(row.estimated_amount),
    fee: Number(row.fee),
    currency: row.currency.trim() as RefundRequest['currency'],
    destination: { method: row.method, ...(row.msisdn ? { msisdn: row.msisdn } : {}) },
    transaction_id: row.transaction_id,
    approved_by: row.approved_by,
    new_number: row.new_number,
    hold_until: row.hold_until ? row.hold_until.toISOString() : null,
    extra_check_required: row.extra_check_required,
    external_reference: row.external_reference,
    failure_reason: row.failure_reason,
    reversal_transaction_id: row.reversal_transaction_id,
    created_at: row.created_at.toISOString(),
    ...(row.reject_reason ? { reject_reason: row.reject_reason } : {}),
  };
}

/** Curseur de page (`created_at` à la milliseconde, `id`) : même forme que celui des mouvements de `/me`. */
export function encodeCursor(row: RefundRow): string {
  return Buffer.from(JSON.stringify({ t: row.created_at.toISOString(), i: row.id })).toString(
    'base64url',
  );
}
