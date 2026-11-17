// Corps, pages et réponses des routes de versement (contrat openapi.yaml, `Payout*` ; mission 9b,
// lot WP08).
// Lecture stricte : champ inconnu refusé. Le contrat range les refus de forme du lot en `422
// VALIDATION_FAILED`
// (`PayoutConfirm`, `PayoutLine`) ; un corps qui n'est pas un objet JSON reste `400`.
import type { CsvColumn } from '../common/csv';
import { ProblemException } from '../errors/problem';
import { invalid, isUuid, objectBody, unprocessable } from '../organization/platform/platform.dto';
import type { BatchLineInput } from './payout-action';
import type { PartyEntitlement } from './entitlements';

const LINE_KEYS = new Set([
  'beneficiary_party_id',
  'amount',
  'currency',
  'method',
  'msisdn',
  'iban',
]);
const METHODS = ['BANK_TRANSFER', 'WAVE', 'ORANGE_MONEY', 'CASH'];
const STATUSES = ['INITIATED', 'CONFIRMED', 'FAILED'];
const MSISDN = /^\+[1-9][0-9]{6,14}$/;

/** Corps de `requestPayoutBatch` : `{ lines: PayoutLine[] }` (contrat `PayoutBatchRequest`). */
export function parseBatchBody(raw: unknown): BatchLineInput[] {
  const body = objectBody(raw);
  const foreign = Object.keys(body).filter((key) => key !== 'lines');
  if (foreign.length > 0) throw unprocessable(`Champ inconnu : ${foreign.join(', ')}.`);
  if (!Array.isArray(body.lines) || body.lines.length === 0)
    throw unprocessable('lines : au moins un versement attendu.');
  return body.lines.map((item: unknown, index): BatchLineInput => {
    const where = `lines[${index}]`;
    if (typeof item !== 'object' || item === null || Array.isArray(item))
      throw unprocessable(`${where} : objet attendu.`);
    const l = item as Record<string, unknown>;
    const unknown = Object.keys(l).filter((key) => !LINE_KEYS.has(key));
    if (unknown.length > 0)
      throw unprocessable(`${where} : champ inconnu (${unknown.join(', ')}).`);
    if (!isUuid(l.beneficiary_party_id))
      throw unprocessable(`${where}.beneficiary_party_id : identifiant attendu.`);
    if (typeof l.amount !== 'number' || !Number.isSafeInteger(l.amount) || l.amount <= 0)
      throw unprocessable(`${where}.amount : entier strictement positif attendu.`);
    if (typeof l.currency !== 'string' || !/^[A-Z]{3}$/.test(l.currency))
      throw unprocessable(`${where}.currency : code de devise attendu.`);
    if (typeof l.method !== 'string' || !METHODS.includes(l.method))
      throw unprocessable(`${where}.method : valeur inconnue.`);
    // CASH n'a aucun compte d'argent de sortie : refusé dès la demande (la base le refuse aussi,
    // CL047).
    if (l.method === 'CASH') throw unprocessable(`${where}.method : CASH n’est pas admis.`);
    if (l.msisdn !== undefined && (typeof l.msisdn !== 'string' || !MSISDN.test(l.msisdn)))
      throw unprocessable(`${where}.msisdn : numéro international (+…) attendu.`);
    if (l.iban !== undefined && typeof l.iban !== 'string')
      throw unprocessable(`${where}.iban : texte attendu.`);
    return {
      beneficiaryPartyId: l.beneficiary_party_id,
      amount: l.amount,
      currency: l.currency,
      method: l.method,
      ...(l.msisdn !== undefined ? { msisdn: l.msisdn as string } : {}),
      ...(l.iban !== undefined ? { iban: l.iban as string } : {}),
    };
  });
}

export type ConfirmInput =
  | { outcome: 'CONFIRMED'; externalReference: string }
  | { outcome: 'FAILED'; failureReason: string };

/**
 * Corps de `confirmPayout` : `CONFIRMED` + `external_reference`, ou `FAILED` + `failure_reason` ;
 * sinon `422`. */
export function parseConfirmBody(raw: unknown): ConfirmInput {
  const body = objectBody(raw);
  const foreign = Object.keys(body).filter(
    (k) => !['outcome', 'external_reference', 'failure_reason'].includes(k),
  );
  if (foreign.length > 0) throw unprocessable(`Champ inconnu : ${foreign.join(', ')}.`);
  const text = (value: unknown, name: string, min: number, max: number): string => {
    const t = typeof value === 'string' ? value.trim() : '';
    if (t.length < min || t.length > max)
      throw unprocessable(`${name} : texte de ${min} à ${max} caractères attendu.`);
    return t;
  };
  if (body.outcome === 'CONFIRMED') {
    if (body.failure_reason !== undefined)
      throw unprocessable('failure_reason : interdit pour CONFIRMED.');
    return {
      outcome: 'CONFIRMED',
      externalReference: text(body.external_reference, 'external_reference', 1, 128),
    };
  }
  if (body.outcome === 'FAILED') {
    if (body.external_reference !== undefined)
      throw unprocessable('external_reference : interdit pour FAILED.');
    return {
      outcome: 'FAILED',
      failureReason: text(body.failure_reason, 'failure_reason', 3, 500),
    };
  }
  throw unprocessable('outcome : CONFIRMED ou FAILED attendu.');
}

export function parseStatusFilter(raw: string | undefined): string | undefined {
  if (raw === undefined || raw === '') return undefined;
  if (!STATUSES.includes(raw)) throw invalid('status : INITIATED, CONFIRMED ou FAILED attendu.');
  return raw;
}

export function parseBatchFilter(raw: string | undefined): string | undefined {
  if (raw === undefined || raw === '') return undefined;
  if (!isUuid(raw)) throw invalid('approval_request_id : identifiant attendu.');
  return raw;
}

export function parsePageLimit(raw: string | undefined): number {
  if (raw === undefined || raw === '') return 50;
  const limit = Number(raw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 200)
    throw invalid('limit : entier de 1 à 200 attendu.');
  return limit;
}

/** Curseur opaque : `[valeur, identifiant]` en base64url ; illisible : `400`. */
export function encodeCursor(position: [string | null, string]): string {
  return Buffer.from(JSON.stringify(position)).toString('base64url');
}

export function decodeCursor(
  raw: string | undefined,
  withTime: boolean,
): [string | null, string] | null {
  if (raw === undefined || raw === '') return null;
  try {
    if (raw.length <= 512) {
      const value: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
      if (Array.isArray(value) && value.length === 2 && isUuid(value[1])) {
        if (withTime && typeof value[0] === 'string' && !Number.isNaN(Date.parse(value[0])))
          return [value[0], value[1]];
        if (!withTime && value[0] === null) return [null, value[1]];
      }
    }
  } catch {
    // illisible : refusé ci-dessous
  }
  throw invalid('cursor : curseur invalide.');
}

const asNumber = (value: bigint | string): number => {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new ProblemException('INTERNAL_ERROR');
  return n;
};

/**
 * `PayoutEntitlement` du contrat : `available` = droit net courant (déjà net des versements en
 * cours). */
export function entitlementDto(e: PartyEntitlement) {
  return {
    party_id: e.partyId,
    party_kind: e.partyKind,
    currency: e.currency,
    net_claim: asNumber(e.netClaim),
    pending_payouts: asNumber(e.inProgress),
    available: asNumber(e.available),
  };
}

export interface PayoutRow {
  id: string;
  ledger_id: string;
  approval_request_id: string;
  beneficiary_id: string;
  amount: string;
  currency: string;
  method: string;
  status: string;
  external_ref: string | null;
  failure_reason: string | null;
  initiated_at: Date;
  initiated_by: string;
  approved_by: string;
  confirmed_by: string | null;
  confirmed_at: Date | null;
  initiated_tx_id: string | null;
  settled_tx_id: string | null;
}

/**
 * Colonnes d'un versement SANS destination : l'IBAN et le numéro ne sont jamais sélectionnés pour
 * une lecture. */
export const PAYOUT_COLUMNS = `po.id, po.ledger_id, po.approval_request_id, po.beneficiary_id, po.amount::text AS amount,
  trim(l.currency) AS currency, po.method, po.status, po.external_ref, po.failure_reason, po.initiated_at,
  po.initiated_by, po.approved_by, po.confirmed_by, po.confirmed_at, po.initiated_tx_id, po.settled_tx_id`;

/** `Payout` du contrat : jamais l'IBAN ni le numéro. */
export function payoutDto(row: PayoutRow) {
  return {
    payout_id: row.id,
    ledger_id: row.ledger_id,
    approval_request_id: row.approval_request_id,
    beneficiary_party_id: row.beneficiary_id,
    amount: asNumber(row.amount),
    currency: row.currency,
    method: row.method,
    status: row.status,
    external_reference: row.external_ref,
    failure_reason: row.failure_reason,
    initiated_at: row.initiated_at,
    initiated_by: row.initiated_by,
    approved_by: row.approved_by,
    confirmed_by: row.confirmed_by,
    confirmed_at: row.confirmed_at,
    initiated_transaction_id: row.initiated_tx_id,
    settled_transaction_id: row.settled_tx_id,
  };
}

/** Colonnes du CSV de paiement (contrat `exportPayoutBatch`). */
export const EXPORT_COLUMNS: readonly CsvColumn[] = [
  { key: 'beneficiary', header: 'beneficiary', kind: 'text' },
  { key: 'method', header: 'method', kind: 'text' },
  { key: 'destination', header: 'destination', kind: 'text' },
  { key: 'amount', header: 'amount', kind: 'number' },
  { key: 'currency', header: 'currency', kind: 'text' },
  { key: 'reference', header: 'reference', kind: 'text' },
];
