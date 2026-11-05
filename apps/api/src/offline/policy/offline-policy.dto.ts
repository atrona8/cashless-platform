// Corps et vues de la politique hors ligne (mission hors-ligne-snapshots-lots, lot WP14 ; contrat
// openapi.yaml : OfflinePolicyLevel, OfflinePolicyLevelUpdate, OfflinePolicyLevelView,
// OfflineRisk). Validation stricte AVANT tout appel SQL : liste fermée de champs (422), entiers
// sûrs (un décimal donnerait 22P02 en base, pas CL001), `cash_topup_offline` jamais vrai (R-02,
// décision du porteur).
import { objectBody, unprocessable } from '../../organization/platform/platform.dto';

export type PolicyScope = 'OPERATOR_CEILING' | 'ORGANIZER' | 'EVENT' | 'DEVICE';

export const AMOUNT_KEYS = [
  'max_per_sale',
  'max_per_media_per_device',
  'max_total_per_device',
] as const;
export const POLICY_KEYS = [
  'offline_enabled',
  ...AMOUNT_KEYS,
  'max_snapshot_age_seconds',
  'cash_topup_offline',
] as const;
export const MAX_SNAPSHOT_AGE_SECONDS = 86_400;

export type PolicyKey = (typeof POLICY_KEYS)[number];
/** Valeurs d'un niveau telles que les attend `set_offline_policy` (clé absente = hérite). */
export type PolicyValues = Partial<Record<PolicyKey, boolean | number | null>>;

export interface PolicyUpdate {
  /** Clés de politique présentes dans le corps (nulle = hérite). */
  values: PolicyValues;
  /** Version attendue ; `null` = création. */
  version: number | null;
}

export function parseUpdate(raw: unknown): PolicyUpdate {
  let body: Record<string, unknown>;
  try {
    body = objectBody(raw);
  } catch {
    throw unprocessable('Corps JSON (objet) attendu.');
  }
  const allowed = new Set<string>([...POLICY_KEYS, 'version']);
  const foreign = Object.keys(body).filter((key) => !allowed.has(key));
  if (foreign.length > 0) throw unprocessable(`Champ inconnu : ${foreign.join(', ')}.`);
  const values: PolicyValues = {};
  for (const key of POLICY_KEYS) {
    if (!(key in body)) continue;
    const value = body[key];
    if (key === 'cash_topup_offline') {
      if (value !== false) {
        throw unprocessable('cash_topup_offline : seule la valeur false est admise.');
      }
      values[key] = false;
    } else if (key === 'offline_enabled') {
      if (value !== null && typeof value !== 'boolean')
        throw unprocessable('offline_enabled : booléen ou null attendu.');
      values[key] = value;
    } else if (value === null) {
      values[key] = null;
    } else {
      const max = key === 'max_snapshot_age_seconds' ? MAX_SNAPSHOT_AGE_SECONDS : undefined;
      if (
        typeof value !== 'number' ||
        !Number.isSafeInteger(value) ||
        value < 0 ||
        (max !== undefined && value > max)
      )
        throw unprocessable(
          `${key} : entier de 0 à ${max ?? Number.MAX_SAFE_INTEGER} (ou null) attendu.`,
        );
      values[key] = value;
    }
  }
  let version: number | null = null;
  if ('version' in body && body.version !== null) {
    const v = body.version;
    if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0 || v > 2_147_483_647)
      throw unprocessable('version : entier positif ou null attendu.');
    version = v;
  }
  return { values, version };
}

/**
 * Niveau d'une portée tel que rendu (`policy` : cinq valeurs nulles = hérite ; espèces toujours
 * false).
 */
export interface LevelPolicy {
  offline_enabled: boolean | null;
  max_per_sale: number | null;
  max_per_media_per_device: number | null;
  max_total_per_device: number | null;
  max_snapshot_age_seconds: number | null;
  cash_topup_offline: false;
}

export interface EffectivePolicy {
  offline_enabled: boolean;
  max_per_sale: number;
  max_per_media_per_device: number;
  max_total_per_device: number;
  max_snapshot_age_seconds: number;
  cash_topup_offline: false;
  capped: boolean;
}

export interface RiskDevice {
  device_id: string;
  serial: string;
  max_total_per_device: number;
  capped: boolean;
}

export interface OfflineRisk {
  event_id: string;
  currency: string;
  max_total_risk: number;
  offline_devices: number;
  devices: RiskDevice[];
  computed_at: string;
}

export interface LevelView {
  level: PolicyScope;
  scope_id: string;
  policy: LevelPolicy;
  version: number;
  updated_at: string | null;
  updated_by: string | null;
  effective?: EffectivePolicy;
  risk?: OfflineRisk;
}
