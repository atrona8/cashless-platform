// Corps, réponses et pagination des routes de plateforme (contrat openapi.yaml, tags Plateforme et Configuration).
// Validation stricte des champs attendus : champ mal formé ou manquant ⇒ 400 ; un champ inconnu est ignoré, et un
// `operator_id` reçu dans un corps n'est jamais lu (le prestataire vient du chemin).
import { jsonValue } from '../../configuration/cascade.service';
import { ProblemException } from '../../errors/problem';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const invalid = (detail: string): ProblemException =>
  new ProblemException('VALIDATION_FAILED', { status: 400, detail });
export const unprocessable = (detail: string): ProblemException =>
  new ProblemException('VALIDATION_FAILED', { status: 422, detail });
export const conflict = (detail: string): ProblemException =>
  new ProblemException('CONFLICT_STATE', { status: 409, detail });
export const notFound = (): ProblemException => new ProblemException('NOT_FOUND');

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

export function requireUuid(value: string): string {
  if (!UUID.test(value)) throw notFound();
  return value;
}

export function objectBody(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
    throw invalid('Corps JSON attendu.');
  return raw as Record<string, unknown>;
}

type Presence = 'required' | 'optional';

export function textField(
  body: Record<string, unknown>,
  name: string,
  max: number,
  presence: Presence,
): string | undefined {
  const value = body[name];
  if (value === undefined) {
    if (presence === 'required') throw invalid(`Champ obligatoire : ${name}.`);
    return undefined;
  }
  if (typeof value !== 'string' || value.trim() === '' || value.length > max)
    throw invalid(`${name} : texte de 1 à ${max} caractères.`);
  return value.trim();
}

/** Texte facultatif qui peut être remis à `null`. */
export function nullableText(
  body: Record<string, unknown>,
  name: string,
  max: number,
  pattern?: RegExp,
): string | null | undefined {
  const value = body[name];
  if (value === undefined || value === null) return value as null | undefined;
  if (
    typeof value !== 'string' ||
    value.trim() === '' ||
    value.length > max ||
    (pattern && !pattern.test(value))
  ) {
    throw invalid(`${name} : valeur invalide.`);
  }
  return value.trim();
}

export function enumField<T extends string>(
  body: Record<string, unknown>,
  name: string,
  values: readonly T[],
  presence: Presence,
): T | undefined {
  const value = body[name];
  if (value === undefined) {
    if (presence === 'required') throw invalid(`Champ obligatoire : ${name}.`);
    return undefined;
  }
  if (typeof value !== 'string' || !values.includes(value as T))
    throw invalid(`${name} : valeurs permises ${values.join(', ')}.`);
  return value as T;
}

export function intField(
  body: Record<string, unknown>,
  name: string,
  min: number,
  max: number,
  presence: Presence,
): number | undefined {
  const value = body[name];
  if (value === undefined) {
    if (presence === 'required') throw invalid(`Champ obligatoire : ${name}.`);
    return undefined;
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max)
    throw invalid(`${name} : entier de ${min} à ${max}.`);
  return value;
}

/** Montant en unités mineures, ≥ 0 : entier (ou chaîne de chiffres), `null` permis si `nullable`. */
export function amountField(
  body: Record<string, unknown>,
  name: string,
  nullable: boolean,
): string | null | undefined {
  const value = body[name];
  if (value === undefined) return undefined;
  if (value === null) {
    if (!nullable) throw invalid(`${name} : montant attendu.`);
    return null;
  }
  const ok =
    (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) ||
    (typeof value === 'string' && /^\d{1,18}$/.test(value));
  if (!ok) throw invalid(`${name} : montant entier en unités mineures, positif ou nul.`);
  return String(value);
}

export function dateTimeField(
  body: Record<string, unknown>,
  name: string,
  presence: Presence,
): Date | undefined {
  const value = body[name];
  // Un champ facultatif à `null` vaut absent (corps déjà analysé, repris tel quel dans une demande d'approbation).
  if (value === undefined || (value === null && presence === 'optional')) {
    if (presence === 'required') throw invalid(`Champ obligatoire : ${name}.`);
    return undefined;
  }
  const time = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  if (Number.isNaN(time)) throw invalid(`${name} : date-heure ISO 8601 attendue.`);
  return new Date(time);
}

// ------------------------------------------------------------------ Pagination

export interface Page<T> {
  data: T[];
  next_cursor: string | null;
  has_more: boolean;
}

export interface PageRequest {
  offset: number;
  limit: number;
}

/** Décalage maximal d'un curseur : au-delà, le curseur n'a pas pu être émis par une liste d'administration. */
const MAX_OFFSET = 100_000;

/** Curseur opaque : position dans la liste triée (listes d'administration, courtes et en ajout seul). */
export function pageRequest(cursor: string | undefined, rawLimit: string | undefined): PageRequest {
  let limit = 50;
  if (rawLimit !== undefined && rawLimit !== '') {
    limit = Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 200)
      throw invalid('limit : entier de 1 à 200 attendu.');
  }
  if (cursor === undefined || cursor === '') return { offset: 0, limit };
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    const offset = (value as { o?: unknown }).o;
    if (
      typeof offset === 'number' &&
      Number.isInteger(offset) &&
      offset >= 0 &&
      offset <= MAX_OFFSET
    )
      return { offset, limit };
  } catch {
    // illisible : refusé ci-dessous
  }
  throw invalid('cursor : curseur invalide.');
}

/** `rows` : `limit + 1` lignes lues à partir de `offset`. */
export function pageOf<R, T>(rows: R[], request: PageRequest, map: (row: R) => T): Page<T> {
  const hasMore = rows.length > request.limit;
  return {
    data: rows.slice(0, request.limit).map(map),
    next_cursor: hasMore
      ? Buffer.from(JSON.stringify({ o: request.offset + request.limit })).toString('base64url')
      : null,
    has_more: hasMore,
  };
}

// ------------------------------------------------------------------ Prestataires

export interface PartyRow {
  id: string;
  operator_id: string | null;
  legal_name: string;
  country_code: string | null;
  tax_id: string | null;
  created_at: Date;
}

export interface OperatorDto {
  operator_id: string;
  legal_name: string;
  country_code: string | null;
  tax_id: string | null;
  created_at: string;
}

export const operatorDto = (row: PartyRow): OperatorDto => ({
  operator_id: row.id,
  legal_name: row.legal_name,
  country_code: row.country_code,
  tax_id: row.tax_id,
  created_at: row.created_at.toISOString(),
});

export interface PartyFields {
  legal_name?: string;
  country_code?: string | null;
  tax_id?: string | null;
}

const COUNTRY = /^[A-Z]{2}$/;

export function parseOperatorCreate(
  raw: unknown,
): Required<Pick<PartyFields, 'legal_name'>> & { country_code: string; tax_id: string | null } {
  const body = objectBody(raw);
  const country = nullableText(body, 'country_code', 2, COUNTRY);
  if (!country) throw invalid('Champ obligatoire : country_code.');
  return {
    legal_name: textField(body, 'legal_name', 200, 'required')!,
    country_code: country,
    tax_id: nullableText(body, 'tax_id', 64) ?? null,
  };
}

/** Données descriptives d'une partie ; au moins une. */
export function parsePartyUpdate(raw: unknown): PartyFields {
  const body = objectBody(raw);
  const fields: PartyFields = {};
  const name = textField(body, 'legal_name', 200, 'optional');
  if (name !== undefined) fields.legal_name = name;
  const country = nullableText(body, 'country_code', 2, COUNTRY);
  if (country !== undefined) fields.country_code = country;
  const tax = nullableText(body, 'tax_id', 64);
  if (tax !== undefined) fields.tax_id = tax;
  if (Object.keys(fields).length === 0)
    throw invalid('Au moins un champ à modifier : legal_name, country_code, tax_id.');
  return fields;
}

// ------------------------------------------------------------------ Contrats

export interface ContractRow {
  id: string;
  operator_id: string;
  kind: 'PLATFORM_OPERATOR' | 'OPERATOR_ORGANIZER';
  counterparty_id: string;
  version: number;
  valid_from: Date;
  platform_fee_mode: string | null;
  offline_loss_bearer: string | null;
  cash_diff_bearer: string | null;
  breakage_organizer_bps: number | null;
  operator_fee_basis: string;
  chargeback_bearer: string;
}

export const contractDto = (row: ContractRow) => ({
  contract_id: row.id,
  operator_id: row.operator_id,
  kind: row.kind,
  counterparty_id: row.counterparty_id,
  version: row.version,
  valid_from: row.valid_from.toISOString(),
  platform_fee_mode: row.platform_fee_mode,
  offline_loss_bearer: row.offline_loss_bearer,
  cash_diff_bearer: row.cash_diff_bearer,
  breakage_organizer_bps: row.breakage_organizer_bps,
  operator_fee_basis: row.operator_fee_basis,
  chargeback_bearer: row.chargeback_bearer,
});
export type ContractDto = ReturnType<typeof contractDto>;

const FEE_MODES = ['IN_POOL', 'INVOICED'] as const;

export interface PlatformContractInput {
  valid_from: string;
  platform_fee_mode: (typeof FEE_MODES)[number];
}

export function parsePlatformContractCreate(raw: unknown): PlatformContractInput {
  const body = objectBody(raw);
  return {
    valid_from: dateTimeField(body, 'valid_from', 'required')!.toISOString(),
    platform_fee_mode: enumField(body, 'platform_fee_mode', FEE_MODES, 'required')!,
  };
}

/** Nouvelle version d'un contrat plateforme : seuls ses champs sont acceptés ; un champ omis reprend la version précédente. */
export function parsePlatformContractVersion(raw: unknown): {
  valid_from: string;
  platform_fee_mode?: (typeof FEE_MODES)[number];
} {
  const body = objectBody(raw);
  for (const field of [
    'offline_loss_bearer',
    'cash_diff_bearer',
    'breakage_organizer_bps',
    'operator_fee_basis',
    'chargeback_bearer',
  ]) {
    if (body[field] !== undefined)
      throw unprocessable(
        `${field} : champ d'un contrat prestataire–organisateur, refusé pour un contrat de plateforme.`,
      );
  }
  return {
    valid_from: dateTimeField(body, 'valid_from', 'required')!.toISOString(),
    platform_fee_mode: enumField(body, 'platform_fee_mode', FEE_MODES, 'optional'),
  };
}

// ------------------------------------------------------------------ Règles de frais

export interface FeeRuleRow {
  id: string;
  operator_id: string | null;
  scope_type: string;
  scope_id: string;
  payer_purpose: string;
  beneficiary_purpose: string;
  basis: string;
  rate_bps: number;
  fixed_amount: bigint;
  min_amount: bigint | null;
  max_amount: bigint | null;
  tax_code: string | null;
  tax_inclusive: boolean;
  trigger: string;
  valid_from: Date;
  valid_to: Date | null;
  version: number;
}

export const feeRuleDto = (row: FeeRuleRow) => ({
  fee_rule_id: row.id,
  operator_id: row.operator_id,
  scope_type: row.scope_type,
  scope_id: row.scope_id,
  payer_purpose: row.payer_purpose,
  beneficiary_purpose: row.beneficiary_purpose,
  basis: row.basis,
  rate_bps: row.rate_bps,
  fixed_amount: jsonValue(row.fixed_amount),
  min_amount: jsonValue(row.min_amount),
  max_amount: jsonValue(row.max_amount),
  tax_code: row.tax_code,
  tax_inclusive: row.tax_inclusive,
  trigger: row.trigger,
  valid_from: row.valid_from.toISOString(),
  valid_to: row.valid_to ? row.valid_to.toISOString() : null,
  version: row.version,
});
export type FeeRuleDto = ReturnType<typeof feeRuleDto>;

export const FEE_SCOPES = [
  'PLATFORM_CONTRACT',
  'OPERATOR_CONTRACT',
  'EVENT',
  'PARTICIPATION',
] as const;
const FEE_BASES = [
  'TOPUP_AMOUNT',
  'SALE_AMOUNT',
  'PER_MEDIA',
  'PER_TERMINAL_DAY',
  'PER_REFUND',
  'FIXED',
  'FEE_AMOUNT',
] as const;
const FEE_TRIGGERS = ['REALTIME', 'CLOSING'] as const;

export interface FeeRuleInput {
  scope_type: (typeof FEE_SCOPES)[number];
  scope_id: string;
  payer_purpose: string;
  beneficiary_purpose: string;
  basis: (typeof FEE_BASES)[number];
  rate_bps: number;
  fixed_amount: string;
  min_amount: string | null;
  max_amount: string | null;
  tax_code: string | null;
  tax_inclusive: boolean;
  trigger: (typeof FEE_TRIGGERS)[number];
  valid_from: string | null;
}

export function parseFeeRuleCreate(raw: unknown): FeeRuleInput {
  const body = objectBody(raw);
  if (!isUuid(body.scope_id)) throw invalid('scope_id : identifiant attendu.');
  const taxInclusive = body.tax_inclusive;
  if (taxInclusive !== undefined && typeof taxInclusive !== 'boolean')
    throw invalid('tax_inclusive : booléen attendu.');
  const min = amountField(body, 'min_amount', true) ?? null;
  const max = amountField(body, 'max_amount', true) ?? null;
  if (min !== null && max !== null && BigInt(min) > BigInt(max))
    throw unprocessable('min_amount ne peut pas dépasser max_amount.');
  return {
    scope_type: enumField(body, 'scope_type', FEE_SCOPES, 'required')!,
    scope_id: body.scope_id,
    payer_purpose: textField(body, 'payer_purpose', 64, 'required')!,
    beneficiary_purpose: textField(body, 'beneficiary_purpose', 64, 'required')!,
    basis: enumField(body, 'basis', FEE_BASES, 'required')!,
    rate_bps: intField(body, 'rate_bps', 0, 10000, 'optional') ?? 0,
    fixed_amount: amountField(body, 'fixed_amount', false) ?? '0',
    min_amount: min,
    max_amount: max,
    tax_code: nullableText(body, 'tax_code', 64) ?? null,
    tax_inclusive: taxInclusive ?? true,
    trigger: enumField(body, 'trigger', FEE_TRIGGERS, 'required')!,
    valid_from: dateTimeField(body, 'valid_from', 'optional')?.toISOString() ?? null,
  };
}

// ------------------------------------------------------------------ Profils de législation

const BREAKAGE = ['ORGANIZER', 'OPERATOR', 'LEGAL_ACCOUNT', 'NONE'] as const;

export interface JurisdictionBody {
  country_code?: string;
  valid_from: string;
  min_refund_window_days?: number | null;
  breakage_destination?: string;
  max_wallet_balance?: string | null;
  kyc_threshold?: string | null;
  unidentified_max_balance?: string | null;
  unidentified_monthly_limit?: string | null;
  identified_monthly_limit?: string | null;
  late_claim_years?: number;
  rules?: Record<string, unknown>;
}

/** Corps `JurisdictionProfileCreate` : un champ absent reste absent (il prendra son défaut provisoire). */
export function parseJurisdictionProfile(raw: unknown, countryRequired: boolean): JurisdictionBody {
  const body = objectBody(raw);
  const validFrom = body.valid_from;
  if (
    typeof validFrom !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(validFrom) ||
    Number.isNaN(Date.parse(validFrom))
  ) {
    throw invalid('valid_from : date AAAA-MM-JJ attendue.');
  }
  const parsed: JurisdictionBody = { valid_from: validFrom };
  const country = nullableText(body, 'country_code', 2, COUNTRY);
  if (countryRequired && !country) throw invalid('Champ obligatoire : country_code.');
  if (country) parsed.country_code = country;
  if (body.min_refund_window_days !== undefined) {
    parsed.min_refund_window_days =
      body.min_refund_window_days === null
        ? null
        : intField(body, 'min_refund_window_days', 0, 3650, 'required')!;
  }
  const breakage = enumField(body, 'breakage_destination', BREAKAGE, 'optional');
  if (breakage !== undefined) parsed.breakage_destination = breakage;
  for (const field of [
    'max_wallet_balance',
    'kyc_threshold',
    'unidentified_max_balance',
    'unidentified_monthly_limit',
    'identified_monthly_limit',
  ] as const) {
    const amount = amountField(body, field, true);
    if (amount !== undefined) parsed[field] = amount;
  }
  const years = intField(body, 'late_claim_years', 0, 10, 'optional');
  if (years !== undefined) parsed.late_claim_years = years;
  if (body.rules !== undefined) parsed.rules = objectBody(body.rules);
  return parsed;
}
