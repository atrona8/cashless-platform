// Messages des refus de configuration (NFR-005) : un texte par règle, en français et en anglais, choisi selon
// `Accept-Language` (http/language.ts). Chaque message cite la règle, la valeur demandée et la borne ; jamais de
// texte SQL.
import type { Language } from '../http/language';

/** Borne franchie (extension `violations[]` du problème VALIDATION_FAILED, contracts/configuration.md). */
export interface Violation {
  field: string;
  /** Identifiant stable de la règle. */
  rule: string;
  requested: unknown;
  limit: unknown;
  /** Origine de la borne : `catalog`, niveau et version de configuration, ou profil de législation (`SN v1`). */
  source: string;
}

type Template = (v: { field: string; requested: string; limit: string; source: string }) => string;

const TEMPLATES: Record<string, Record<Language, Template>> = {
  'catalog.unknown_key': {
    fr: (v) => `Réglage inconnu : ${v.field}.`,
    en: (v) => `Unknown setting: ${v.field}.`,
  },
  'catalog.level': {
    fr: (v) =>
      `Le réglage ${v.field} ne se règle pas au niveau ${v.requested} (niveaux permis : ${v.limit}).`,
    en: (v) =>
      `Setting ${v.field} cannot be set at level ${v.requested} (allowed levels: ${v.limit}).`,
  },
  'catalog.type': {
    fr: (v) => `${v.field} : valeur ${v.requested} invalide, ${v.limit} attendu.`,
    en: (v) => `${v.field}: invalid value ${v.requested}, expected ${v.limit}.`,
  },
  'catalog.enum': {
    fr: (v) => `${v.field} : valeur ${v.requested} refusée, valeurs permises : ${v.limit}.`,
    en: (v) => `${v.field}: value ${v.requested} rejected, allowed values: ${v.limit}.`,
  },
  'catalog.range': {
    fr: (v) => `${v.field} : ${v.requested} est hors des bornes ${v.limit}.`,
    en: (v) => `${v.field}: ${v.requested} is outside the range ${v.limit}.`,
  },
  'catalog.connect_lt_total': {
    fr: (v) =>
      `online_connect_timeout_ms (${v.requested}) doit être strictement inférieur à online_total_timeout_ms (${v.limit}).`,
    en: (v) =>
      `online_connect_timeout_ms (${v.requested}) must be strictly lower than online_total_timeout_ms (${v.limit}).`,
  },
  'catalog.dates': {
    fr: (v) =>
      `La fin de l'événement (${v.requested}) ne peut pas précéder son début (${v.limit}).`,
    en: (v) => `The event end (${v.requested}) cannot be earlier than its start (${v.limit}).`,
  },
  'catalog.draft_only': {
    fr: (v) =>
      `${v.field} ne se modifie que tant que l'événement est en préparation (statut ${v.limit}).`,
    en: (v) =>
      `${v.field} can only be changed while the event is being prepared (status ${v.limit}).`,
  },
  'catalog.mixed_roles': {
    fr: (v) =>
      `Cette modification mêle des réglages de deux rôles (${v.limit}) : faire deux demandes distinctes.`,
    en: (v) =>
      `This change mixes settings owned by two roles (${v.limit}): submit two separate requests.`,
  },
  'operator.cash_refund_single_max_cap': {
    fr: (v) =>
      `cash_refund_single_max : ${v.requested} dépasse le maximum fixé par le prestataire, ${v.limit} (${v.source}).`,
    en: (v) =>
      `cash_refund_single_max: ${v.requested} exceeds the maximum set by the operator, ${v.limit} (${v.source}).`,
  },
  'jurisdiction.min_refund_window_days': {
    fr: (v) =>
      `Date limite de remboursement ${v.requested} refusée : le profil de législation ${v.source} impose au plus tôt ${v.limit} (règle jurisdiction.min_refund_window_days).`,
    en: (v) =>
      `Refund deadline ${v.requested} rejected: jurisdiction profile ${v.source} requires ${v.limit} at the earliest (rule jurisdiction.min_refund_window_days).`,
  },
};

const FALLBACK: Record<Language, Template> = {
  fr: (v) => `${v.field} : ${v.requested} refusé par la règle, borne ${v.limit} (${v.source}).`,
  en: (v) => `${v.field}: ${v.requested} rejected by the rule, limit ${v.limit} (${v.source}).`,
};

function show(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value as string | number | boolean | bigint);
}

/** Message d'une violation ; il cite toujours l'identifiant de la règle. */
export function violationMessage(violation: Violation, language: Language): string {
  const template = TEMPLATES[violation.rule]?.[language] ?? FALLBACK[language];
  const text = template({
    field: violation.field,
    requested: show(violation.requested),
    limit: show(violation.limit),
    source: violation.source,
  });
  return text.includes(violation.rule) ? text : `${text} [${violation.rule}]`;
}

/** Règles qui ont un message propre (les autres prennent le message générique). */
export const MESSAGE_RULES: readonly string[] = Object.keys(TEMPLATES);
