// Corps et réponses des routes d'événement (contrat openapi.yaml : Event, EventCreate, EventUpdate). Les valeurs des
// réglages sont contrôlées par le catalogue (bornes-validator) : ici, seule la forme du corps et les champs
// structurels (organisateur, devise, fuseau).
import { jsonValue } from '../configuration/cascade.service';
import { effectiveRefundDeadline } from '../configuration/provisional-defaults';
import { eventColumnKeys } from '../configuration/settings-catalog';
import { invalid, isUuid, objectBody, unprocessable } from '../organization/platform/platform.dto';

/** Clés d'`EventCreate` réglables à la création (toutes réglées par l'organisateur) en plus des champs structurels. */
const CREATE_KEYS = [
  'name', 'starts_at', 'ends_at', 'refund_deadline', 'jurisdiction_id', 'contract_id', 'funds_holder', 'funds_holder_party_id',
  'issuer', 'identity_mode', 'activation_modes', 'lost_media_policy', 'cash_refund_single_max', 'reversal_window_minutes',
] as const;

/** Clés d'`EventUpdate` : toutes les colonnes de réglage du catalogue. */
export const UPDATE_KEYS: readonly string[] = eventColumnKeys().map((definition) => definition.key);

export interface EventCreateInput {
  organizer_id: string;
  currency: string;
  timezone: string;
  /** Réglages et attributs portés par des colonnes, tels que reçus (contrôlés ensuite par le catalogue). */
  values: Record<string, unknown>;
}

function validTimezone(value: unknown): value is string {
  if (typeof value !== 'string' || value === '') return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export function parseEventCreate(raw: unknown): EventCreateInput {
  const body = objectBody(raw);
  if (!isUuid(body.organizer_id)) throw invalid('organizer_id : identifiant attendu.');
  if (typeof body.currency !== 'string' || !/^[A-Z]{3}$/.test(body.currency)) throw invalid('currency : code ISO 4217 attendu.');
  if (!validTimezone(body.timezone)) throw unprocessable('timezone : fuseau IANA attendu (par exemple Africa/Dakar).');
  // §4.4 : le détenteur des fonds est un choix obligatoire, sans valeur par défaut.
  if (body.funds_holder === undefined || body.funds_holder === null) {
    throw unprocessable('funds_holder : choix obligatoire (ORGANIZER, OPERATOR ou THIRD_PARTY), sans valeur par défaut.');
  }
  for (const required of ['name', 'jurisdiction_id'] as const) {
    if (body[required] === undefined) throw invalid(`Champ obligatoire : ${required}.`);
  }
  const values: Record<string, unknown> = {};
  for (const key of CREATE_KEYS) if (body[key] !== undefined) values[key] = body[key];
  return { organizer_id: body.organizer_id, currency: body.currency, timezone: body.timezone, values };
}

/** Modification : au moins une clé, toutes connues ; `status` ne se modifie que par `transitionEventStatus`. */
export function parseEventUpdate(raw: unknown): Record<string, unknown> {
  const body = objectBody(raw);
  if ('status' in body) throw invalid('status : le statut ne se modifie pas ici (transitionEventStatus).');
  const unknown = Object.keys(body).filter((key) => !UPDATE_KEYS.includes(key));
  if (unknown.length > 0) throw invalid(`Champ non modifiable ou inconnu : ${unknown.join(', ')}.`);
  if (Object.keys(body).length === 0) throw invalid('Au moins un champ à modifier.');
  return body;
}

export type EventRow = Record<string, unknown> & {
  id: string;
  operator_id: string;
  organizer_id: string;
  status: string;
  jurisdiction_id: string;
  contract_id: string | null;
  starts_at: Date | null;
  ends_at: Date | null;
  refund_deadline: Date | null;
};

const READ_ONLY = ['operator_id', 'organizer_id', 'currency', 'timezone', 'status'] as const;

/** Événement tel que le contrat le décrit ; `refund_deadline` absente : rendue calculée, avec sa source. */
export function eventDto(row: EventRow, ledgerId: string | null, configVersionId: string | null): Record<string, unknown> {
  const deadline = effectiveRefundDeadline(row.refund_deadline, row.ends_at);
  const dto: Record<string, unknown> = { event_id: row.id };
  for (const key of READ_ONLY) dto[key] = typeof row[key] === 'string' ? (row[key] as string).trim() : row[key];
  for (const key of UPDATE_KEYS) dto[key] = jsonValue(row[key]);
  dto.refund_deadline = deadline ? deadline.value.toISOString() : null;
  dto.refund_deadline_source = deadline ? deadline.source : null;
  dto.ledger_id = ledgerId;
  dto.config_version_id = configVersionId;
  return dto;
}

/** Valeurs courantes des colonnes de réglage, sous leur forme JSON (dates ISO, montants entiers). */
export function currentValues(row: EventRow): Record<string, unknown> {
  return Object.fromEntries(UPDATE_KEYS.map((key) => [key, jsonValue(row[key])]));
}
