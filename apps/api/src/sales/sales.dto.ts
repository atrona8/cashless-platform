// Ventes du back-office (mission routes-backoffice 11b, WP06 ; contrat `SaleSummary`, `SaleDetail`, `SalePage`).
// Validation des filtres et curseur opaque de pagination `(occurred_at, transaction_id)`. Un filtre ou un curseur
// mal formé est refusé en `422 VALIDATION_FAILED`. Aucune donnée du festivalier : ni portefeuille ni bracelet.
import { ProblemException } from '../errors/problem';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Instant ISO 8601 avec fuseau (le contrat : instants UTC). */
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;
/** Forme exacte du curseur : microsecondes, UTC (un `Date` JS perdrait le dernier chiffre : doublons). */
const CURSOR_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

/** Aller-retour : `2026-02-30` déborderait sur mars en JS (puis 22008 en base) ; le jour doit exister. */
function realCalendarDay(value: string): boolean {
  const [y, m, d] = [
    Number(value.slice(0, 4)),
    Number(value.slice(5, 7)),
    Number(value.slice(8, 10)),
  ];
  const back = new Date(Date.UTC(y, m - 1, d));
  return back.getUTCFullYear() === y && back.getUTCMonth() === m - 1 && back.getUTCDate() === d;
}

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 200;

const invalid = (detail: string): ProblemException =>
  new ProblemException('VALIDATION_FAILED', { status: 422, detail });

export interface SaleFilters {
  posId: string | null;
  merchantId: string | null;
  vendorId: string | null;
  from: string | null;
  to: string | null;
  status: 'VALID' | 'REVERSED' | null;
  limit: number;
  cursor: { occurredAt: string; transactionId: string } | null;
}

export interface SaleQuery {
  pos_id?: string;
  merchant_id?: string;
  vendor_id?: string;
  from?: string;
  to?: string;
  status?: string;
  cursor?: string;
  limit?: string;
}

const text = (value: unknown, name: string): string | null => {
  if (value === undefined || value === '') return null;
  if (typeof value !== 'string') throw invalid(`${name} : une seule valeur attendue.`);
  return value;
};

function uuid(value: unknown, name: string): string | null {
  const v = text(value, name);
  if (v === null) return null;
  if (!UUID.test(v)) throw invalid(`${name} : identifiant (uuid) attendu.`);
  return v.toLowerCase();
}

function instant(value: unknown, name: string): string | null {
  const v = text(value, name);
  if (v === null) return null;
  const parsed = Date.parse(v);
  if (!INSTANT.test(v) || Number.isNaN(parsed) || !realCalendarDay(v))
    throw invalid(`${name} : instant ISO 8601 attendu.`);
  return new Date(parsed).toISOString();
}

export function parseLimit(raw: unknown): number {
  const v = text(raw, 'limit');
  if (v === null) return DEFAULT_LIMIT;
  const limit = Number(v);
  if (!/^\d+$/.test(v) || !Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT)
    throw invalid(`limit : entier de 1 à ${MAX_LIMIT} attendu.`);
  return limit;
}

/** Curseur : `base64url(JSON [instant en microsecondes UTC, transaction_id])`, forme de `users.dto.ts`. */
export function encodeCursor(occurredAt: string, transactionId: string): string {
  return Buffer.from(JSON.stringify([occurredAt, transactionId])).toString('base64url');
}

export function decodeCursor(raw: unknown): SaleFilters['cursor'] {
  const v = text(raw, 'cursor');
  if (v === null) return null;
  try {
    const value: unknown = JSON.parse(Buffer.from(v, 'base64url').toString('utf8'));
    if (
      Array.isArray(value) &&
      value.length === 2 &&
      typeof value[0] === 'string' &&
      typeof value[1] === 'string' &&
      CURSOR_INSTANT.test(value[0]) &&
      !Number.isNaN(Date.parse(value[0])) &&
      realCalendarDay(value[0]) &&
      UUID.test(value[1])
    )
      return { occurredAt: value[0], transactionId: value[1].toLowerCase() };
  } catch {
    // illisible : refusé ci-dessous
  }
  throw invalid('cursor : curseur invalide.');
}

export function parseSaleQuery(query: SaleQuery): SaleFilters {
  const status = text(query.status, 'status');
  if (status !== null && status !== 'VALID' && status !== 'REVERSED')
    throw invalid('status : VALID ou REVERSED attendu.');
  return {
    posId: uuid(query.pos_id, 'pos_id'),
    merchantId: uuid(query.merchant_id, 'merchant_id'),
    vendorId: uuid(query.vendor_id, 'vendor_id'),
    from: instant(query.from, 'from'),
    to: instant(query.to, 'to'),
    status,
    limit: parseLimit(query.limit),
    cursor: decodeCursor(query.cursor),
  };
}

export const isUuid = (value: string): boolean => UUID.test(value);

/** Ligne de `sale_overview` lue par la liste et le détail (aucune colonne de portefeuille ni de bracelet). */
export interface SaleRow {
  transaction_id: string;
  event_id: string;
  occurred_at: Date;
  occurred_text: string;
  amount: string;
  currency: string;
  pos_id: string | null;
  merchant_id: string | null;
  vendor_id: string | null;
  device_id: string | null;
  source: string;
  channel: string;
  reversal_transaction_id: string | null;
}

export interface SaleLineRow {
  line_no: number;
  item_id: string | null;
  label_fr: string;
  label_en: string;
  quantity: number;
  unit_price: string;
  vat_rate_bps: number;
  line_total: string;
}

export interface SaleSummaryDto {
  transaction_id: string;
  event_id: string;
  occurred_at: string;
  amount: number;
  currency: string;
  pos_id: string | null;
  merchant_id: string | null;
  vendor_id: string | null;
  device_id: string | null;
  source: string;
  channel: string;
  status: 'VALID' | 'REVERSED';
  reversal_transaction_id: string | null;
}

/** Résumé : liste blanche de champs (jamais `SELECT *` rendu tel quel). */
export function toSummary(row: SaleRow): SaleSummaryDto {
  return {
    transaction_id: row.transaction_id,
    event_id: row.event_id,
    occurred_at: row.occurred_at.toISOString(),
    amount: Number(row.amount),
    currency: row.currency.trim(),
    pos_id: row.pos_id,
    merchant_id: row.merchant_id,
    vendor_id: row.vendor_id,
    device_id: row.device_id,
    source: row.source,
    channel: row.channel,
    status: row.reversal_transaction_id === null ? 'VALID' : 'REVERSED',
    reversal_transaction_id: row.reversal_transaction_id,
  };
}

export function toLine(row: SaleLineRow) {
  return {
    line_no: row.line_no,
    item_id: row.item_id,
    label_fr: row.label_fr,
    label_en: row.label_en,
    quantity: row.quantity,
    unit_price: Number(row.unit_price),
    vat_rate_bps: row.vat_rate_bps,
    line_total: Number(row.line_total),
  };
}
