// Lots de bracelets (SPECIFICATION §7.7 ; contracts/openapi-additions.md) : formes d'entrée et de sortie, et textes
// des refus de règle, en français et en anglais (NFR-005). Chaque refus cite sa règle (`rule`), jamais un texte SQL.
import { ProblemException } from '../../errors/problem';
import type { Language } from '../../http/language';
import { amountField, enumField, intField, invalid, isUuid, nullableText, objectBody, textField } from '../../organization/platform/platform.dto';

export const BATCH_KINDS = ['PUBLIC', 'STAFF', 'VIP'] as const;
export const KEY_MODES = ['SHARED', 'DEDICATED'] as const;
export const REUSE_POLICIES = ['SINGLE_USE', 'PERSONAL', 'POOL'] as const;
export const DEPOSIT_MODES = ['FROM_BALANCE', 'SEPARATE'] as const;
export const BATCH_STATUSES = ['ORDERED', 'PERSONALIZED', 'DELIVERED', 'ACTIVE', 'SUSPENDED', 'CLOSED'] as const;
/** Statuts que la route de statut accepte ; `CLOSED` passe par la clôture. */
export const SETTABLE_STATUSES = ['PERSONALIZED', 'DELIVERED', 'ACTIVE', 'SUSPENDED'] as const;

export type BatchStatus = (typeof BATCH_STATUSES)[number];

export interface MediaBatchRow {
  id: string;
  operator_id: string;
  organizer_id: string;
  event_id: string | null;
  kind: (typeof BATCH_KINDS)[number];
  quantity: number;
  key_index: number;
  print_order_ref: string | null;
  status: BatchStatus;
  preload_promo_amount: bigint;
  deposit_amount: bigint;
  deposit_mode: (typeof DEPOSIT_MODES)[number] | null;
  key_mode: (typeof KEY_MODES)[number];
  reuse_policy: (typeof REUSE_POLICIES)[number];
  created_at: Date;
  claim_codes_issued_at: Date | null;
}

export const BATCH_COLUMNS =
  'id, operator_id, organizer_id, event_id, kind, quantity, key_index, print_order_ref, status, preload_promo_amount, deposit_amount, deposit_mode, key_mode, reuse_policy, created_at, claim_codes_issued_at';

export const batchDto = (row: MediaBatchRow) => ({
  batch_id: row.id,
  operator_id: row.operator_id,
  organizer_id: row.organizer_id,
  event_id: row.event_id,
  kind: row.kind,
  quantity: row.quantity,
  key_index: row.key_index,
  key_mode: row.key_mode,
  reuse_policy: row.reuse_policy,
  print_order_ref: row.print_order_ref,
  status: row.status,
  preload_promo_amount: Number(row.preload_promo_amount),
  deposit_amount: Number(row.deposit_amount),
  deposit_mode: row.deposit_mode,
  claim_codes_issued: row.claim_codes_issued_at !== null,
  created_at: row.created_at.toISOString(),
});

export interface BatchCreateInput {
  organizer_id: string;
  event_id: string | null;
  kind: (typeof BATCH_KINDS)[number];
  quantity: number;
  key_index: number;
  key_mode: (typeof KEY_MODES)[number];
  reuse_policy: (typeof REUSE_POLICIES)[number];
  print_order_ref: string | null;
  preload_promo_amount: string;
  deposit_amount: string;
  deposit_mode: (typeof DEPOSIT_MODES)[number] | null;
}

export function parseBatchCreate(raw: unknown): BatchCreateInput {
  const body = objectBody(raw);
  if (!isUuid(body.organizer_id)) throw invalid('organizer_id : identifiant attendu.');
  if (body.event_id !== undefined && body.event_id !== null && !isUuid(body.event_id)) throw invalid('event_id : identifiant attendu.');
  return {
    organizer_id: body.organizer_id,
    event_id: (body.event_id as string | null | undefined) ?? null,
    kind: enumField(body, 'kind', BATCH_KINDS, 'required')!,
    quantity: intField(body, 'quantity', 1, 1_000_000, 'required')!,
    key_index: intField(body, 'key_index', 0, 65535, 'required')!,
    key_mode: enumField(body, 'key_mode', KEY_MODES, 'optional') ?? 'SHARED',
    reuse_policy: enumField(body, 'reuse_policy', REUSE_POLICIES, 'optional') ?? 'SINGLE_USE',
    print_order_ref: textField(body, 'print_order_ref', 200, 'optional') ?? null,
    preload_promo_amount: amountField(body, 'preload_promo_amount', false) ?? '0',
    deposit_amount: amountField(body, 'deposit_amount', false) ?? '0',
    deposit_mode: enumField(body, 'deposit_mode', DEPOSIT_MODES, 'optional') ?? null,
  };
}

export const BATCH_UPDATE_KEYS = ['quantity', 'print_order_ref', 'preload_promo_amount', 'deposit_amount', 'deposit_mode', 'reuse_policy'] as const;
export type BatchChanges = Partial<Pick<BatchCreateInput, (typeof BATCH_UPDATE_KEYS)[number]>>;

export function parseBatchUpdate(raw: unknown): BatchChanges {
  const body = objectBody(raw);
  const unknown = Object.keys(body).filter((key) => !(BATCH_UPDATE_KEYS as readonly string[]).includes(key));
  if (unknown.length > 0) throw invalid(`Champ non modifiable ou inconnu : ${unknown.join(', ')}.`);
  if (Object.keys(body).length === 0) throw invalid('Au moins un champ à modifier.');
  const changes: BatchChanges = {};
  const quantity = intField(body, 'quantity', 1, 1_000_000, 'optional');
  if (quantity !== undefined) changes.quantity = quantity;
  const ref = nullableText(body, 'print_order_ref', 200);
  if (ref !== undefined) changes.print_order_ref = ref;
  const preload = amountField(body, 'preload_promo_amount', false);
  if (preload != null) changes.preload_promo_amount = preload;
  const deposit = amountField(body, 'deposit_amount', false);
  if (deposit != null) changes.deposit_amount = deposit;
  if (body.deposit_mode === null) changes.deposit_mode = null;
  else {
    const mode = enumField(body, 'deposit_mode', DEPOSIT_MODES, 'optional');
    if (mode !== undefined) changes.deposit_mode = mode;
  }
  const reuse = enumField(body, 'reuse_policy', REUSE_POLICIES, 'optional');
  if (reuse !== undefined) changes.reuse_policy = reuse;
  return changes;
}

export function parseStatusChange(raw: unknown): { status: (typeof SETTABLE_STATUSES)[number]; reason: string | null } {
  const body = objectBody(raw);
  if (body.status === 'CLOSED') throw invalid('status : un lot se clôt par sa route de clôture (…/closure), pas par un changement de statut.');
  return { status: enumField(body, 'status', SETTABLE_STATUSES, 'required')!, reason: textField(body, 'reason', 500, 'optional') ?? null };
}

// Refus de règle ------------------------------------------------------------------------------------------------------
type Vars = Record<string, string | number>;
const RULES: Record<string, Record<Language, (v: Vars) => string>> = {
  'batch.deposit_mode': {
    fr: () => 'Une caution a toujours un mode (FROM_BALANCE ou SEPARATE), et un mode suppose une caution : deposit_amount et deposit_mode vont ensemble.',
    en: () => 'A deposit always has a mode (FROM_BALANCE or SEPARATE), and a mode requires a deposit: deposit_amount and deposit_mode go together.',
  },
  'batch.dedicated_event': {
    fr: () => 'Un lot à clé dédiée est réservé à un événement : event_id est obligatoire.',
    en: () => 'A dedicated-key batch is reserved for one event: event_id is required.',
  },
  'batch.dedicated_single_use': {
    fr: () => 'Un lot à clé dédiée est à usage unique : reuse_policy doit valoir SINGLE_USE.',
    en: () => 'A dedicated-key batch is single use: reuse_policy must be SINGLE_USE.',
  },
  'batch.event_unknown': {
    fr: () => 'event_id : événement inconnu, ou qui n’appartient pas à cet organisateur.',
    en: () => 'event_id: unknown event, or event that does not belong to this organizer.',
  },
  'batch.key_unknown': {
    fr: (v) => `key_index : aucune clé d’index ${v.key_index} pour ce prestataire.`,
    en: (v) => `key_index: no key with index ${v.key_index} for this operator.`,
  },
  'batch.key_inactive': {
    fr: (v) => `key_index : la clé ${v.key_index} n’est plus active (${v.status}) ; elle ne personnalise plus de nouveau lot.`,
    en: (v) => `key_index: key ${v.key_index} is no longer active (${v.status}); it cannot personalize a new batch.`,
  },
  'batch.key_shared': {
    fr: (v) => `key_index : la clé ${v.key_index} est dédiée à un événement ; un lot à clé partagée ne peut pas l’utiliser.`,
    en: (v) => `key_index: key ${v.key_index} is dedicated to an event; a shared-key batch cannot use it.`,
  },
  'batch.key_dedicated': {
    fr: (v) => `key_index : la clé ${v.key_index} n’est pas la clé dédiée à l’événement du lot.`,
    en: (v) => `key_index: key ${v.key_index} is not the key dedicated to the batch's event.`,
  },
  'batch.suspend_reason': {
    fr: () => 'reason : un motif est obligatoire pour suspendre un lot.',
    en: () => 'reason: a reason is required to suspend a batch.',
  },
};

/** Refus 422 d'une règle des lots, dans la langue de la requête ; `rule` est l'identifiant stable de la règle. */
export function batchRefusal(rule: keyof typeof RULES & string, language: Language, vars: Vars = {}): ProblemException {
  return new ProblemException('VALIDATION_FAILED', { status: 422, detail: RULES[rule]![language](vars), extensions: { rule } });
}
