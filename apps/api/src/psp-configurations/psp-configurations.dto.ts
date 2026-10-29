// Corps et réponses des configurations PSP (mission 6, lot WP10, T049 ; contrat `PspConfiguration`,
// `PspConfigurationCreate`). Les constantes exportées sont reprises par WP11 et WP14.
//
// `secret_ref` est une RÉFÉRENCE du coffre (`psp/<titulaire>/<nom>`), jamais un secret. Une valeur refusée
// n'est JAMAIS recopiée dans le message d'erreur : elle peut être un vrai secret collé par erreur.
import type { Role } from '../identity/principal';
import {
  dateTimeField,
  isUuid,
  objectBody,
  unprocessable,
} from '../organization/platform/platform.dto';

export const PSP_METHODS = ['WAVE', 'ORANGE_MONEY', 'CARD'] as const;
export type PspMethod = (typeof PSP_METHODS)[number];
export const PSP_PROVIDERS = ['WAVE', 'ORANGE_MONEY', 'PAYDUNYA', 'STRIPE'] as const;
export type PspProviderName = (typeof PSP_PROVIDERS)[number];
/** Fournisseurs admis par moyen (la base le refuse aussi : `psp_configuration_method_provider`). */
export const METHOD_PROVIDERS: Readonly<Record<PspMethod, readonly PspProviderName[]>> = {
  WAVE: ['WAVE'],
  ORANGE_MONEY: ['ORANGE_MONEY'],
  CARD: ['PAYDUNYA', 'STRIPE'],
};

/** Canal des frais lu par `buildTopup` (`config.pspFees[canal]`) d'après le moyen de la configuration. */
export const FEE_CHANNEL: Readonly<Record<PspMethod, string>> = {
  WAVE: 'WAVE',
  ORANGE_MONEY: 'OM',
  CARD: 'CARTE',
};

const FIELDS = new Set([
  'method',
  'provider',
  'holder_party_id',
  'secret_ref',
  'is_default',
  'valid_from',
  'valid_until',
]);

const SECRET_REF = /^psp\/([0-9a-f-]{36})\/([A-Za-z0-9._-]{1,100})$/;
/** Message unique : jamais d'écho de la valeur reçue. */
const SECRET_REF_REFUSED =
  'secret_ref : référence de coffre invalide (forme psp/<titulaire>/<nom>, jamais un secret).';
const SECRET_PREFIXES = ['sk_', 'pk_', 'whsec_'];

/** La valeur ressemble-t-elle à un secret ? (≥ 24 caractères d'alphabet de clé sans `/`, préfixes connus) */
function looksLikeSecret(value: string): boolean {
  if (/^(Bearer |-----BEGIN)/.test(value)) return true;
  if (SECRET_PREFIXES.some((prefix) => value.startsWith(prefix))) return true;
  return value.length >= 24 && /^[A-Za-z0-9+=_-]+$/.test(value);
}

/**
 * Référence de secrets valide pour ce titulaire, sinon 422 générique. Le segment du titulaire est celui de
 * `holder_party_id` (en minuscules) ; le nom ne commence pas par un point et ne ressemble pas à un secret.
 */
export function assertSecretRef(value: unknown, holderPartyId: string): string {
  if (typeof value !== 'string') throw unprocessable(SECRET_REF_REFUSED);
  const match = SECRET_REF.exec(value);
  if (!match) throw unprocessable(SECRET_REF_REFUSED);
  const [, holder, name] = match as unknown as [string, string, string];
  if (holder !== holderPartyId.toLowerCase() || name.startsWith('.') || looksLikeSecret(name))
    throw unprocessable(SECRET_REF_REFUSED);
  return value;
}

export interface PspConfigurationCreate {
  method: PspMethod;
  provider: PspProviderName;
  holder_party_id: string;
  secret_ref: string;
  is_default: boolean;
  valid_from: Date | null;
  valid_until: Date | null;
}

export function parseCreatePspConfiguration(raw: unknown): PspConfigurationCreate {
  const body = objectBody(raw);
  const foreign = Object.keys(body).filter((key) => !FIELDS.has(key));
  if (foreign.length > 0) throw unprocessable(`Champ inconnu : ${foreign.join(', ')}.`);
  const method = body.method;
  if (typeof method !== 'string' || !(PSP_METHODS as readonly string[]).includes(method))
    throw unprocessable(`method : valeurs permises ${PSP_METHODS.join(', ')}.`);
  const provider = body.provider;
  if (typeof provider !== 'string' || !(PSP_PROVIDERS as readonly string[]).includes(provider))
    throw unprocessable(`provider : valeurs permises ${PSP_PROVIDERS.join(', ')}.`);
  if (!METHOD_PROVIDERS[method as PspMethod].includes(provider as PspProviderName))
    throw unprocessable('provider : incompatible avec le moyen de paiement.');
  if (!isUuid(body.holder_party_id)) throw unprocessable('holder_party_id : identifiant attendu.');
  const secretRef = assertSecretRef(body.secret_ref, body.holder_party_id);
  if (body.is_default !== undefined && typeof body.is_default !== 'boolean')
    throw unprocessable('is_default : booléen attendu.');
  const validFrom = dateOrNull(body, 'valid_from');
  const validUntil = dateOrNull(body, 'valid_until');
  if (validFrom && validUntil && validUntil <= validFrom)
    throw unprocessable('valid_until doit être postérieure à valid_from.');
  return {
    method: method as PspMethod,
    provider: provider as PspProviderName,
    holder_party_id: body.holder_party_id,
    secret_ref: secretRef,
    is_default: body.is_default === true,
    valid_from: validFrom,
    valid_until: validUntil,
  };
}

function dateOrNull(body: Record<string, unknown>, name: string): Date | null {
  try {
    return dateTimeField(body, name, 'optional') ?? null;
  } catch {
    throw unprocessable(`${name} : date-heure ISO 8601 attendue.`);
  }
}

/** Colonnes lues (jamais `SELECT *`, jamais `secret_ref` : la base refuse sa lecture directe). */
export const CONFIG_COLUMNS = `psp_configuration_id, organizer_id, method, provider, holder_party_id,
  compliance_ref, status, is_default, valid_from, valid_until, version, created_by, approved_by,
  created_at`;

export interface PspConfigurationRow {
  psp_configuration_id: string;
  organizer_id: string;
  method: PspMethod;
  provider: PspProviderName;
  holder_party_id: string;
  compliance_ref: string | null;
  status: 'DRAFT' | 'ACTIVE' | 'SUSPENDED';
  is_default: boolean;
  valid_from: Date;
  valid_until: Date | null;
  version: number;
  created_by: string;
  approved_by: string | null;
  created_at: Date;
}

const iso = (value: Date | null): string | null => (value ? value.toISOString() : null);

/**
 * Forme du contrat. Le seul point où `secret_ref` peut entrer dans une réponse : il n'est ajouté QUE pour
 * l'`OPERATOR_ADMIN` ; pour tout autre rôle la propriété est absente (pas `null`).
 */
export function toDto(row: PspConfigurationRow, role: Role, secretRef?: string | null) {
  return {
    psp_config_id: row.psp_configuration_id,
    organizer_id: row.organizer_id,
    method: row.method,
    provider: row.provider,
    holder_party_id: row.holder_party_id,
    ...(role === 'OPERATOR_ADMIN' ? { secret_ref: secretRef ?? null } : {}),
    compliance_ref: row.compliance_ref,
    status: row.status,
    is_default: row.is_default,
    valid_from: iso(row.valid_from),
    valid_until: iso(row.valid_until),
    version: row.version,
    created_by: row.created_by,
    approved_by: row.approved_by,
    created_at: iso(row.created_at),
  };
}
export type PspConfigurationDto = ReturnType<typeof toDto>;

export interface ChangeRequestInput {
  status: 'ACTIVE' | 'SUSPENDED';
  compliance_ref?: string;
}

/** Corps de `requestPspConfigurationChange` : `{status, compliance_ref}` ; référence obligatoire pour ACTIVE. */
export function parseChangeRequest(raw: unknown): ChangeRequestInput {
  const body = objectBody(raw);
  const foreign = Object.keys(body).filter((key) => key !== 'status' && key !== 'compliance_ref');
  if (foreign.length > 0) throw unprocessable(`Champ inconnu : ${foreign.join(', ')}.`);
  const status = body.status ?? 'ACTIVE';
  if (status !== 'ACTIVE' && status !== 'SUSPENDED')
    throw unprocessable('status : valeurs permises ACTIVE, SUSPENDED.');
  const ref = body.compliance_ref;
  if (status === 'SUSPENDED') {
    if (ref !== undefined) throw unprocessable('compliance_ref : réservé à la demande ACTIVE.');
    return { status };
  }
  if (typeof ref !== 'string' || ref.trim() === '' || ref.trim().length > 200)
    throw unprocessable('compliance_ref : référence de conformité de 1 à 200 caractères requise.');
  return { status, compliance_ref: ref.trim() };
}
