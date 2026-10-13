// Catalogue des réglages (SPECIFICATION §4.2, §9.8 ; research R-05) : pour chaque clé, où elle est stockée, à quels
// niveaux de la cascade elle se règle, son type et ses bornes fixes, le rôle qui la règle et son défaut.
// Les bornes fixes sont celles des CHECK de la table `event` : un test d'intégration les compare une à une
// (test/integration/configuration/cascade.spec.ts, « catalogue et schéma »). Une borne ne se change qu'aux deux
// endroits, par une migration.

/** Niveaux de la cascade, du plus général au plus précis (§4.1). */
export const CONFIG_LEVELS = ['PLATFORM', 'OPERATOR', 'ORGANIZER', 'EVENT', 'PARTICIPATION'] as const;
export type ConfigLevel = (typeof CONFIG_LEVELS)[number];

/** Rôles qui règlent une configuration. */
export type SettingRole = 'PLATFORM_ADMIN' | 'OPERATOR_ADMIN' | 'ORGANIZER_ADMIN';

export type SettingType =
  | { kind: 'enum'; values: readonly string[] }
  | { kind: 'enumSet'; values: readonly string[] }
  /** Entier borné (durées, nombres). */
  | { kind: 'int'; min: number; max: number }
  /** Montant en unités mineures, ≥ 0 : entier ou chaîne de chiffres (jamais un flottant). */
  | { kind: 'amount' }
  | { kind: 'datetime'; nullable: boolean }
  | { kind: 'uuid'; nullable: boolean }
  | { kind: 'text'; maxLength: number }
  | { kind: 'refundPolicy' };

export interface SettingDefinition {
  key: string;
  /** Colonne de `event` (bornée aussi par la base), ou clé de `config_version.settings`. */
  storage: { kind: 'EVENT_COLUMN'; column: string } | { kind: 'SETTINGS' };
  /** Niveaux où la clé peut être écrite. */
  levels: readonly ConfigLevel[];
  type: SettingType;
  /** Rôle qui la règle aux niveaux organisateur, événement et participation (§4.2, §9.8, FR-010). */
  setBy: 'OPERATOR_ADMIN' | 'ORGANIZER_ADMIN';
  /** Valeur par défaut (celle du schéma pour une colonne) ; `undefined` : aucune. */
  default?: unknown;
  /** Défaut provisoire de §17.2 : à confirmer, et par qui. */
  provisional?: { confirmBy: string };
  /** Clé d'un niveau supérieur qui plafonne cette valeur. */
  cappedBy?: string;
  /** Fait partie de la configuration résolue (faux : attribut de l'événement, hors cascade). */
  resolved: boolean;
  /** Modifiable seulement tant que l'événement est `DRAFT`. */
  draftOnly?: boolean;
}

const column = (
  key: string,
  type: SettingType,
  setBy: SettingDefinition['setBy'],
  rest: Partial<Pick<SettingDefinition, 'default' | 'provisional' | 'cappedBy' | 'resolved' | 'draftOnly'>> = {},
): SettingDefinition => ({
  key,
  storage: { kind: 'EVENT_COLUMN', column: key },
  levels: ['EVENT'],
  type,
  setBy,
  resolved: true,
  ...rest,
});

const setting = (
  key: string,
  levels: readonly ConfigLevel[],
  type: SettingType,
  setBy: SettingDefinition['setBy'],
  rest: Partial<Pick<SettingDefinition, 'default' | 'provisional' | 'cappedBy'>> = {},
): SettingDefinition => ({ key, storage: { kind: 'SETTINGS' }, levels, type, setBy, resolved: true, ...rest });

const int = (min: number, max: number): SettingType => ({ kind: 'int', min, max });
const oneOf = (...values: string[]): SettingType => ({ kind: 'enum', values });

const DEFINITIONS: readonly SettingDefinition[] = [
  // --- Attributs de l'événement (organisateur) : hors cascade, soumis à « qui règle quoi » et aux bornes.
  column('name', { kind: 'text', maxLength: 200 }, 'ORGANIZER_ADMIN', { resolved: false }),
  column('starts_at', { kind: 'datetime', nullable: true }, 'ORGANIZER_ADMIN', { resolved: false }),
  column('ends_at', { kind: 'datetime', nullable: true }, 'ORGANIZER_ADMIN', { resolved: false }),
  column('jurisdiction_id', { kind: 'uuid', nullable: false }, 'ORGANIZER_ADMIN', { resolved: false }),
  column('contract_id', { kind: 'uuid', nullable: true }, 'ORGANIZER_ADMIN', { resolved: false }),
  // Détenteur des fonds : colonne qui fait foi, obligatoire, sans défaut, jamais dans la cascade (§4.4, C-003).
  column('funds_holder', oneOf('ORGANIZER', 'OPERATOR', 'THIRD_PARTY'), 'ORGANIZER_ADMIN', { resolved: false, draftOnly: true }),
  column('funds_holder_party_id', { kind: 'uuid', nullable: true }, 'ORGANIZER_ADMIN', { resolved: false, draftOnly: true }),

  // --- Réglages de l'événement portés par ses colonnes, réglés par l'organisateur (§4.2).
  column('issuer', oneOf('ORGANIZER', 'OPERATOR'), 'ORGANIZER_ADMIN', { default: 'ORGANIZER', draftOnly: true }),
  column('identity_mode', oneOf('ANONYMOUS_ALLOWED', 'ACCOUNT_REQUIRED'), 'ORGANIZER_ADMIN', { default: 'ANONYMOUS_ALLOWED' }),
  column('activation_modes', { kind: 'enumSet', values: ['DESK', 'SELF_APP', 'FIRST_TOPUP'] }, 'ORGANIZER_ADMIN', { default: ['DESK'] }),
  column('lost_media_policy', oneOf('END_OF_LIFE', 'REACTIVATE'), 'ORGANIZER_ADMIN', { default: 'END_OF_LIFE' }),
  column('cash_refund_single_max', { kind: 'amount' }, 'ORGANIZER_ADMIN', { default: 50000, cappedBy: 'cash_refund_single_max_cap' }),
  // Absente : fin de l'événement + 30 jours, valeur provisoire (§17.2) ; bornée par le profil de législation.
  column('refund_deadline', { kind: 'datetime', nullable: true }, 'ORGANIZER_ADMIN', { provisional: { confirmBy: 'porteur du projet' } }),
  column('reversal_window_minutes', int(0, 60), 'ORGANIZER_ADMIN', { default: 15 }),

  // --- Réglages de l'événement réglés par le prestataire (§4.2, §9.8, ADR-61, ADR-73, ADR-76, ADR-77).
  column('tap_replay_window_seconds', int(0, 600), 'OPERATOR_ADMIN', { default: 120 }),
  column('sync_deadline_hours', int(1, 720), 'OPERATOR_ADMIN', { default: 72 }),
  column('refund_new_number_max', { kind: 'amount' }, 'OPERATOR_ADMIN', { default: 50000 }),
  column('refund_new_number_hold_hours', int(0, 168), 'OPERATOR_ADMIN', { default: 48 }),
  column('card_topup_daily_max_per_card', { kind: 'amount' }, 'OPERATOR_ADMIN', { default: 100000 }),
  column('card_alert_cards_per_wallet', int(2, 20), 'OPERATOR_ADMIN', { default: 3 }),
  column('online_connect_timeout_ms', int(1000, 5000), 'OPERATOR_ADMIN', { default: 2000 }),
  column('online_total_timeout_ms', int(2000, 6000), 'OPERATOR_ADMIN', { default: 3000 }),
  column('online_retries', int(0, 3), 'OPERATOR_ADMIN', { default: 2 }),
  column('pending_sync_seconds', int(10, 300), 'OPERATOR_ADMIN', { default: 30 }),
  column('reconcile_sync_seconds', int(60, 1800), 'OPERATOR_ADMIN', { default: 300 }),
  column('heartbeat_seconds', int(30, 300), 'OPERATOR_ADMIN', { default: 60 }),
  column('local_retention_days', int(7, 30), 'OPERATOR_ADMIN', { default: 7 }),

  // --- Réglages de la cascade (config_version.settings).
  // Seul `EVENT` est accepté dans cette mission : le grand livre partagé par organisateur est hors périmètre (C-007).
  setting('wallet_scope', ['ORGANIZER', 'EVENT'], oneOf('EVENT'), 'ORGANIZER_ADMIN', { default: 'EVENT' }),
  setting('spend_order', ['PLATFORM', 'OPERATOR', 'ORGANIZER', 'EVENT'], oneOf('PROMO_FIRST', 'PAID_FIRST'), 'ORGANIZER_ADMIN', {
    default: 'PROMO_FIRST',
  }),
  setting('psp_fee_bearer', ['OPERATOR', 'ORGANIZER', 'EVENT'], oneOf('ORGANIZER', 'OPERATOR', 'CUSTOMER'), 'ORGANIZER_ADMIN', {
    default: 'ORGANIZER',
  }),
  setting('refund_policy', ['OPERATOR', 'ORGANIZER', 'EVENT'], { kind: 'refundPolicy' }, 'ORGANIZER_ADMIN', {
    default: { open: true, fee_amount: 0, minimum_amount: 0, channels: ['CASH', 'MOBILE_MONEY'] },
  }),
  // Maximum fixé par le prestataire pour `cash_refund_single_max` des événements (§4.2).
  setting('cash_refund_single_max_cap', ['OPERATOR'], { kind: 'amount' }, 'OPERATOR_ADMIN'),
];

export const SETTINGS_CATALOG: ReadonlyMap<string, SettingDefinition> = new Map(DEFINITIONS.map((d) => [d.key, d]));

export const REFUND_CHANNELS = ['CASH', 'MOBILE_MONEY', 'BANK'] as const;

export function settingOf(key: string): SettingDefinition | undefined {
  return SETTINGS_CATALOG.get(key);
}

/** Clés de la configuration résolue, dans l'ordre du catalogue. */
export function resolvedKeys(): SettingDefinition[] {
  return DEFINITIONS.filter((d) => d.resolved);
}

/** Clés portées par une colonne de `event`. */
export function eventColumnKeys(): SettingDefinition[] {
  return DEFINITIONS.filter((d) => d.storage.kind === 'EVENT_COLUMN');
}

/**
 * Rôle qui règle une clé à un niveau : la plateforme et le prestataire règlent leur propre niveau ; en dessous,
 * le rôle désigné par le catalogue.
 */
export function regulatingRole(definition: SettingDefinition, level: ConfigLevel): SettingRole {
  if (level === 'PLATFORM') return 'PLATFORM_ADMIN';
  if (level === 'OPERATOR') return 'OPERATOR_ADMIN';
  return definition.setBy;
}

/** Valeur résolue d'une clé : d'où elle vient (niveau, version) et si elle est provisoire. */
export interface ResolvedValue {
  value: unknown;
  /** Niveau qui définit la valeur ; `null` : défaut du catalogue. */
  level: ConfigLevel | null;
  version: number | null;
  config_version_id: string | null;
  provisional: boolean;
}

/** Configuration résolue à une date : une entrée par clé du catalogue (schéma `ResolvedConfigView` du contrat). */
export type ResolvedConfigView = Record<string, ResolvedValue>;
