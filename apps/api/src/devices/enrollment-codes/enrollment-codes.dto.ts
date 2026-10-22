// Corps et réponses des codes d'enrôlement (openapi.yaml : EnrollmentCodeCreate, EnrollmentCode,
// DeviceEnrollmentCodeSummary ; contracts/enrollment.md). Champ mal formé ou manquant : 400 ;
// durée hors bornes : 422 VALIDATION_FAILED ; PAIRED_TPE, ou téléphone personnel hors KEYPAD_TPE :
// 422 DEVICE_MODE_NOT_ALLOWED (la base refait ces deux contrôles, CL027).
import { ProblemException } from '../../errors/problem';
import {
  enumField,
  invalid,
  isUuid,
  objectBody,
  unprocessable,
} from '../../organization/platform/platform.dto';

export const APP_MODES = ['CATALOG_POS', 'KEYPAD_TPE', 'TOPUP_DESK', 'PAIRED_TPE'] as const;
export type AppMode = (typeof APP_MODES)[number];
export const DEVICE_KINDS = ['POS', 'TOPUP'] as const;
export type DeviceKind = (typeof DEVICE_KINDS)[number];
const PROVIDERS = ['PLATFORM', 'OPERATOR', 'ORGANIZER', 'MERCHANT'] as const;

export const TTL = { min: 300, max: 604_800 } as const;

export interface EnrollmentCodeInput {
  eventId: string;
  posId: string | null;
  appMode: Exclude<AppMode, 'PAIRED_TPE'>;
  personalPhone: boolean;
  /** `null` : défaut de la base (24 h). */
  expiresInSeconds: number | null;
}

/** Sorte de terminal d'un mode : la caisse de recharge est un terminal TOPUP, tout autre un POS. */
export const kindOfMode = (mode: string | null): DeviceKind =>
  mode === 'TOPUP_DESK' ? 'TOPUP' : 'POS';

function uuidField(body: Record<string, unknown>, name: string, required: boolean): string | null {
  const value = body[name];
  if (value === undefined || (value === null && !required)) {
    if (required) throw invalid(`Champ obligatoire : ${name}.`);
    return null;
  }
  if (!isUuid(value)) throw invalid(`${name} : identifiant attendu.`);
  return value;
}

export function parseEnrollmentCodeCreate(raw: unknown): EnrollmentCodeInput {
  const body = objectBody(raw);
  // `event_id` validé avant toute requête à la base (tout terminal est affecté à un événement).
  const eventId = uuidField(body, 'event_id', true)!;
  const posId = uuidField(body, 'pos_id', false);
  const appMode = enumField(body, 'app_mode', APP_MODES, 'required')!;
  const kind = enumField(body, 'kind', DEVICE_KINDS, 'required')!;
  const personalPhone = body.personal_phone;
  if (typeof personalPhone !== 'boolean')
    throw invalid('Champ obligatoire : personal_phone (booléen, sans défaut).');
  // Champs du contrat sans colonne dans le schéma (0022) : vérifiés, non conservés.
  const station = body.station_name;
  if (station !== undefined && (typeof station !== 'string' || station.length > 200))
    throw invalid('station_name : texte de 200 caractères au plus.');
  enumField(body, 'provided_by', PROVIDERS, 'optional');
  let expiresInSeconds: number | null = null;
  const ttl = body.expires_in_seconds;
  if (ttl !== undefined && ttl !== null) {
    if (typeof ttl !== 'number' || !Number.isInteger(ttl))
      throw invalid('expires_in_seconds : entier attendu.');
    if (ttl < TTL.min || ttl > TTL.max)
      throw unprocessable(`expires_in_seconds : de ${TTL.min} à ${TTL.max} secondes.`);
    expiresInSeconds = ttl;
  }
  if (appMode === 'PAIRED_TPE')
    throw new ProblemException('DEVICE_MODE_NOT_ALLOWED', {
      detail: 'Mode PAIRED_TPE non disponible en V1.',
    });
  if (personalPhone && appMode !== 'KEYPAD_TPE')
    throw new ProblemException('DEVICE_MODE_NOT_ALLOWED', {
      detail: 'Téléphone personnel : mode KEYPAD_TPE seulement.',
    });
  if (kind !== kindOfMode(appMode))
    throw unprocessable(`kind : ${kindOfMode(appMode)} attendu pour le mode ${appMode}.`);
  return { eventId, posId, appMode, personalPhone, expiresInSeconds };
}

/** Ligne lue pour la liste : jamais `code_hash` (colonnes nommées une à une). */
export interface EnrollmentCodeRow {
  id: string;
  event_id: string;
  pos_id: string | null;
  app_mode: string | null;
  personal_phone: boolean;
  created_by: string;
  created_at: Date;
  expires_at: Date;
}

export const enrollmentCodeSummary = (row: EnrollmentCodeRow) => ({
  enrollment_code_id: row.id,
  event_id: row.event_id,
  pos_id: row.pos_id,
  // Pas de colonne dans le schéma (0022) : le nom de station n'est pas conservé.
  station_name: null,
  app_mode: row.app_mode,
  kind: kindOfMode(row.app_mode),
  personal_phone: row.personal_phone,
  created_by: row.created_by,
  created_at: row.created_at.toISOString(),
  expires_at: row.expires_at.toISOString(),
});
