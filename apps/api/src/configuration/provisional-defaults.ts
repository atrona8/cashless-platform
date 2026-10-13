// Valeurs provisoires de SPECIFICATION §17.2 (research R-07, C-006) : codées, paramétrables, jamais présentées comme
// validées. Chacune porte la personne qui doit la confirmer. Une valeur saisie explicitement n'est plus provisoire.

export interface ProvisionalField {
  field: string;
  confirm_by: string;
}

const JURIST = 'juriste';
const ACCOUNTANT = 'expert-comptable';
const PROJECT_OWNER = 'porteur du projet';

/** Jours ajoutés à la fin de l'événement quand `refund_deadline` est absente (§4.2, §17.2). */
export const PROVISIONAL_REFUND_DAYS = 30;

/** Champs d'un profil de législation tels que l'API les reçoit (montants en unités mineures). */
export interface JurisdictionProfileInput {
  country_code: string;
  valid_from: string;
  min_refund_window_days?: number | null;
  breakage_destination?: string;
  max_wallet_balance?: number | string | null;
  kyc_threshold?: number | string | null;
  unidentified_max_balance?: number | string | null;
  unidentified_monthly_limit?: number | string | null;
  identified_monthly_limit?: number | string | null;
  late_claim_years?: number;
  rules?: Record<string, unknown>;
}

export interface CompletedJurisdictionProfile {
  country_code: string;
  valid_from: string;
  min_refund_window_days: number | null;
  breakage_destination: string;
  max_wallet_balance: number | string | null;
  kyc_threshold: number | string | null;
  unidentified_max_balance: number | string | null;
  unidentified_monthly_limit: number | string | null;
  identified_monthly_limit: number | string | null;
  late_claim_years: number;
  /** Contient `provisional` : la liste des champs restés à leur défaut provisoire. */
  rules: Record<string, unknown>;
}

interface ProvisionalValue {
  value: unknown;
  confirmBy: string;
}

/** Défauts provisoires communs à tout pays. */
const COMMON: Record<string, ProvisionalValue> = {
  // Destination de la casse : selon le profil (§4.2) ; à défaut l'organisateur, partage selon le contrat.
  breakage_destination: { value: 'ORGANIZER', confirmBy: JURIST },
};

/** Défauts provisoires par pays (ADR-48, OP-N3). Sénégal : plafonds mensuels, pas de plafond de solde. */
const BY_COUNTRY: Record<string, Record<string, ProvisionalValue>> = {
  SN: {
    unidentified_monthly_limit: { value: 200000, confirmBy: JURIST },
    identified_monthly_limit: { value: 2000000, confirmBy: JURIST },
    max_wallet_balance: { value: null, confirmBy: JURIST },
    unidentified_max_balance: { value: null, confirmBy: JURIST },
    // TVA 18 % TTC sur frais et commissions.
    'rules.taxes': { value: { VAT: { rate_bps: 1800, inclusive: true } }, confirmBy: ACCOUNTANT },
  },
};

/** Années de réclamation tardive : décidé (ADR-67), pas provisoire. */
const LATE_CLAIM_YEARS = 5;

/**
 * Complète un profil : un champ omis prend son défaut provisoire et son nom est consigné dans `rules.provisional`.
 * Un champ fourni, même `null`, est une saisie explicite.
 */
export function completeJurisdictionProfile(input: JurisdictionProfileInput): CompletedJurisdictionProfile {
  const defaults = { ...COMMON, ...(BY_COUNTRY[input.country_code] ?? {}) };
  const provisional: ProvisionalField[] = [];
  const given = input as unknown as Record<string, unknown>;
  const pick = <T>(field: string, fallback: T): T => {
    if (given[field] !== undefined) return given[field] as T;
    const provisionalDefault = defaults[field];
    if (!provisionalDefault) return fallback;
    provisional.push({ field, confirm_by: provisionalDefault.confirmBy });
    return provisionalDefault.value as T;
  };
  const { provisional: _previous, ...rules } = input.rules ?? {};
  if (rules.taxes === undefined && defaults['rules.taxes']) {
    rules.taxes = defaults['rules.taxes'].value;
    provisional.push({ field: 'rules.taxes', confirm_by: defaults['rules.taxes'].confirmBy });
  }
  const completed = {
    country_code: input.country_code,
    valid_from: input.valid_from,
    min_refund_window_days: pick<number | null>('min_refund_window_days', null),
    breakage_destination: pick<string>('breakage_destination', 'ORGANIZER'),
    max_wallet_balance: pick<number | string | null>('max_wallet_balance', null),
    kyc_threshold: pick<number | string | null>('kyc_threshold', null),
    unidentified_max_balance: pick<number | string | null>('unidentified_max_balance', null),
    unidentified_monthly_limit: pick<number | string | null>('unidentified_monthly_limit', null),
    identified_monthly_limit: pick<number | string | null>('identified_monthly_limit', null),
    late_claim_years: input.late_claim_years ?? LATE_CLAIM_YEARS,
  };
  return { ...completed, rules: { ...rules, provisional } };
}

/** Champs provisoires d'un profil enregistré (`rules.provisional`), pour `provisional_fields` des réponses. */
export function provisionalFields(rules: unknown): ProvisionalField[] {
  const list = (rules as { provisional?: unknown } | null)?.provisional;
  if (!Array.isArray(list)) return [];
  return list.filter(
    (item): item is ProvisionalField =>
      typeof item === 'object' && item !== null && typeof (item as ProvisionalField).field === 'string' && typeof (item as ProvisionalField).confirm_by === 'string',
  );
}

export type RefundDeadlineSource = 'EXPLICIT' | 'PROVISIONAL_DEFAULT';

/**
 * Date limite de remboursement en vigueur : celle de l'événement, sinon fin + 30 jours (provisoire, à confirmer par
 * le porteur du projet) ; `null` si l'événement n'a ni l'une ni l'autre.
 */
export function effectiveRefundDeadline(
  refundDeadline: Date | null,
  endsAt: Date | null,
): { value: Date; source: RefundDeadlineSource } | null {
  if (refundDeadline) return { value: refundDeadline, source: 'EXPLICIT' };
  if (!endsAt) return null;
  return { value: new Date(endsAt.getTime() + PROVISIONAL_REFUND_DAYS * 86_400_000), source: 'PROVISIONAL_DEFAULT' };
}

export const PROVISIONAL_CONFIRMERS = { JURIST, ACCOUNTANT, PROJECT_OWNER } as const;
