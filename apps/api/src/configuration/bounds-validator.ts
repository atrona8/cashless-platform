// Bornes d'une modification de configuration (SPECIFICATION §4.1, research R-06, contracts/configuration.md).
// Ordre des contrôles d'une valeur : type → bornes fixes du catalogue (= CHECK du schéma) → maximum fixé par un
// niveau supérieur (configuration résolue) → profil de législation de l'événement. Premier échec de chaque clé :
// une violation. Refus : 422 VALIDATION_FAILED, `detail` localisé qui cite la règle, extension `violations[]`.
// « Qui règle quoi » (FR-010) : une clé d'un autre rôle ⇒ 403 ; des clés de deux rôles ⇒ 422.
import { ProblemException } from '../errors/problem';
import type { Language } from '../http/language';
import { violationMessage, type Violation } from './messages';
import {
  REFUND_CHANNELS,
  regulatingRole,
  settingOf,
  type ConfigLevel,
  type ResolvedConfigView,
  type SettingDefinition,
  type SettingRole,
} from './settings-catalog';

/** Profil de législation de l'événement, pour ce que la mission borne. */
export interface JurisdictionBounds {
  country_code: string;
  version: number;
  min_refund_window_days: number | null;
}

export interface BoundsContext {
  level: ConfigLevel;
  /** Configuration résolue des niveaux supérieurs : porte les maximums (`cappedBy`). */
  resolved?: ResolvedConfigView;
  jurisdiction?: JurisdictionBounds;
  /** Valeurs en vigueur des champs liés entre eux (dates, délais) qui ne sont pas dans la modification. */
  current?: Record<string, unknown>;
  /** Statut de l'événement : les clés `draftOnly` ne changent qu'en `DRAFT`. */
  eventStatus?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CATALOG = 'catalog';

const isAmount = (value: unknown): value is number | string | bigint =>
  typeof value === 'bigint' ||
  (typeof value === 'number' && Number.isSafeInteger(value)) ||
  (typeof value === 'string' && /^-?\d{1,18}$/.test(value));

const toDate = (value: unknown): Date | null => {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value !== 'string' || value === '') return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : new Date(time);
};

function typeViolation(definition: SettingDefinition, value: unknown): Violation | undefined {
  const { key, type } = definition;
  const bad = (rule: string, limit: unknown): Violation => ({ field: key, rule, requested: value, limit, source: CATALOG });
  switch (type.kind) {
    case 'enum':
      return typeof value === 'string' && type.values.includes(value) ? undefined : bad('catalog.enum', type.values.join(', '));
    case 'enumSet': {
      const ok =
        Array.isArray(value) &&
        value.length > 0 &&
        new Set(value).size === value.length &&
        value.every((item) => typeof item === 'string' && type.values.includes(item));
      return ok ? undefined : bad('catalog.enum', type.values.join(', '));
    }
    case 'int':
      if (typeof value !== 'number' || !Number.isInteger(value)) return bad('catalog.type', 'integer');
      return value >= type.min && value <= type.max ? undefined : bad('catalog.range', [type.min, type.max]);
    case 'amount':
      if (!isAmount(value)) return bad('catalog.type', 'integer amount in minor units');
      return BigInt(value) >= 0n ? undefined : bad('catalog.range', '>= 0');
    case 'datetime':
      if (value === null) return type.nullable ? undefined : bad('catalog.type', 'date-time');
      return toDate(value) ? undefined : bad('catalog.type', 'date-time');
    case 'uuid':
      if (value === null) return type.nullable ? undefined : bad('catalog.type', 'uuid');
      return typeof value === 'string' && UUID.test(value) ? undefined : bad('catalog.type', 'uuid');
    case 'text':
      if (typeof value !== 'string' || value.trim() === '') return bad('catalog.type', 'text');
      return value.length <= type.maxLength ? undefined : bad('catalog.range', `<= ${type.maxLength} characters`);
    case 'refundPolicy': {
      const policy = (typeof value === 'object' && value !== null && !Array.isArray(value) ? value : null) as Record<string, unknown> | null;
      const amountOk = (field: string) => policy![field] === undefined || (isAmount(policy![field]) && BigInt(policy![field] as number) >= 0n);
      const ok =
        policy !== null &&
        typeof policy.open === 'boolean' &&
        amountOk('fee_amount') &&
        amountOk('minimum_amount') &&
        (policy.channels === undefined ||
          (Array.isArray(policy.channels) &&
            policy.channels.every((channel) => (REFUND_CHANNELS as readonly unknown[]).includes(channel)))) &&
        Object.keys(policy).every((field) => ['open', 'fee_amount', 'minimum_amount', 'channels'].includes(field));
      return ok ? undefined : bad('catalog.type', `{ open, fee_amount, minimum_amount, channels: ${REFUND_CHANNELS.join('|')} }`);
    }
  }
}

/** Violations d'une modification, dans l'ordre des clés reçues puis des règles croisées. */
export function findViolations(changes: Record<string, unknown>, context: BoundsContext): Violation[] {
  const violations: Violation[] = [];
  const failed = new Set<string>();
  const add = (violation: Violation) => {
    violations.push(violation);
    failed.add(violation.field);
  };

  for (const [key, value] of Object.entries(changes)) {
    const definition = settingOf(key);
    if (!definition) {
      add({ field: key, rule: 'catalog.unknown_key', requested: value, limit: null, source: CATALOG });
      continue;
    }
    if (!definition.levels.includes(context.level)) {
      add({ field: key, rule: 'catalog.level', requested: context.level, limit: definition.levels.join(', '), source: CATALOG });
      continue;
    }
    if (definition.draftOnly && context.eventStatus !== undefined && context.eventStatus !== 'DRAFT') {
      add({ field: key, rule: 'catalog.draft_only', requested: value, limit: 'DRAFT', source: CATALOG });
      continue;
    }
    const type = typeViolation(definition, value);
    if (type) {
      add(type);
      continue;
    }
    // Maximum fixé par un niveau supérieur.
    const cap = definition.cappedBy ? context.resolved?.[definition.cappedBy] : undefined;
    if (cap && cap.value !== null && cap.value !== undefined && isAmount(cap.value) && BigInt(value as number) > BigInt(cap.value)) {
      add({
        field: key,
        rule: `operator.${definition.cappedBy}`,
        requested: value,
        limit: cap.value,
        source: cap.level ? `${cap.level} v${cap.version}` : CATALOG,
      });
    }
  }

  // Règles croisées : sur l'état après modification, sans les clés déjà refusées.
  const merged = { ...(context.current ?? {}), ...changes };
  const touched = (...keys: string[]) => keys.some((key) => key in changes) && !keys.some((key) => failed.has(key));

  if (touched('online_connect_timeout_ms', 'online_total_timeout_ms')) {
    const connect = merged.online_connect_timeout_ms;
    const total = merged.online_total_timeout_ms;
    if (typeof connect === 'number' && typeof total === 'number' && connect >= total) {
      add({ field: 'online_connect_timeout_ms', rule: 'catalog.connect_lt_total', requested: connect, limit: total, source: CATALOG });
    }
  }
  const start = toDate(merged.starts_at);
  const end = toDate(merged.ends_at);
  if (touched('starts_at', 'ends_at') && start && end && end < start) {
    add({ field: 'ends_at', rule: 'catalog.dates', requested: end.toISOString(), limit: start.toISOString(), source: CATALOG });
  }
  const deadline = toDate(merged.refund_deadline);
  const minDays = context.jurisdiction?.min_refund_window_days;
  if (
    context.jurisdiction &&
    minDays !== null &&
    minDays !== undefined &&
    deadline &&
    end &&
    !failed.has('refund_deadline') &&
    !failed.has('ends_at')
  ) {
    const earliest = new Date(end.getTime() + minDays * 86_400_000);
    if (deadline < earliest) {
      add({
        field: 'refund_deadline',
        rule: 'jurisdiction.min_refund_window_days',
        requested: deadline.toISOString(),
        limit: earliest.toISOString(),
        source: `${context.jurisdiction.country_code} v${context.jurisdiction.version}`,
      });
    }
  }
  return violations;
}

/** Problème 422 d'un ensemble de violations : le détail est le message de la première, toutes sont jointes. */
export function boundsProblem(violations: Violation[], language: Language): ProblemException {
  return new ProblemException('VALIDATION_FAILED', {
    status: 422,
    detail: violationMessage(violations[0]!, language),
    extensions: { violations },
  });
}

/** Refuse la modification si une borne est franchie. */
export function assertWithinBounds(changes: Record<string, unknown>, context: BoundsContext, language: Language): void {
  const violations = findViolations(changes, context);
  if (violations.length > 0) throw boundsProblem(violations, language);
}

/**
 * « Qui règle quoi » : rend le rôle qui règle toutes les clés demandées. Une clé réglée par un rôle que la personne
 * ne tient pas sur la portée : 403, rien n'est modifié. Des clés de deux rôles : 422, deux demandes distinctes.
 * Les clés inconnues sont laissées au contrôle des bornes.
 */
export function assertSettableBy(
  keys: readonly string[],
  level: ConfigLevel,
  heldRoles: readonly SettingRole[],
  language: Language,
): SettingRole | undefined {
  const roles = new Set<SettingRole>();
  for (const key of keys) {
    const definition = settingOf(key);
    if (definition) roles.add(regulatingRole(definition, level));
  }
  for (const role of roles) {
    if (!heldRoles.includes(role)) throw new ProblemException('FORBIDDEN');
  }
  if (roles.size > 1) {
    const list = [...roles].sort().join(', ');
    throw boundsProblem(
      [{ field: keys.join(', '), rule: 'catalog.mixed_roles', requested: keys, limit: list, source: CATALOG }],
      language,
    );
  }
  return [...roles][0];
}
