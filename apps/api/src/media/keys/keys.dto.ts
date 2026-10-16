// Clés de bracelet vues du back-office (contrat openapi.yaml : TagKey, TagKeyDetail, TagKeyJob, TagKeyCheckRun,
// TagKeyRequest). La référence d'une clé dans le service de clés n'est rendue que tronquée ; aucune clé de données
// chiffrée n'est lue par l'API publique (elle n'en a pas le droit, post-roles.sql).
import { enumField, isUuid, objectBody, unprocessable } from '../../organization/platform/platform.dto';

export interface TagKeyRow {
  operator_id: string;
  key_index: number;
  kms_key_ref: string;
  status: 'ACTIVE' | 'DECRYPT_ONLY' | 'RETIRED';
  scope: 'SHARED' | 'DEDICATED';
  dedicated_event_id: string | null;
  kms_disabled_at: Date | null;
  created_at: Date;
}

export const TAG_KEY_COLUMNS = 'operator_id, key_index, kms_key_ref, status, scope, dedicated_event_id, kms_disabled_at, created_at';

export const tagKeyDto = (row: TagKeyRow) => ({
  operator_id: row.operator_id,
  key_index: row.key_index,
  status: row.status,
  scope: row.scope,
  dedicated_event_id: row.dedicated_event_id,
  // Six derniers caractères : assez pour reconnaître une clé, pas assez pour la désigner dans le service de clés.
  kms_key_ref_suffix: row.kms_key_ref.slice(-6),
  kms_disabled_at: row.kms_disabled_at?.toISOString() ?? null,
  created_at: row.created_at.toISOString(),
});

export type TagKeyJobKind = 'CREATE_KEY' | 'ROTATE_DEK' | 'REENCRYPT' | 'RETIRE_KEY' | 'DISABLE_KMS_KEY';

export interface TagKeyJobRow {
  id: string;
  operator_id: string;
  key_index: number;
  kind: TagKeyJobKind;
  status: 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED';
  payload: Record<string, unknown>;
  progress: Record<string, unknown>;
  attempts: number;
  last_error: string | null;
  approval_request_id: string | null;
  parent_job_id: string | null;
  created_at: Date;
  finished_at: Date | null;
}

export const TAG_KEY_JOB_COLUMNS =
  'id, operator_id, key_index, kind, status, payload, progress, attempts, last_error, approval_request_id, parent_job_id, created_at, finished_at';

/**
 * Requête de prise d'un travail : toute la file (processus en service) ou, si `operators` est donné, les seuls
 * travaux de ces prestataires (exploitation ciblée ; suites de tests qui partagent une base).
 */
export const claimJobQuery = (kinds: readonly TagKeyJobKind[], operators?: readonly string[]): { text: string; values: unknown[] } =>
  operators
    ? { text: `SELECT ${TAG_KEY_JOB_COLUMNS} FROM claim_tag_key_job_for($1::uuid[], $2::text[])`, values: [operators, kinds] }
    : { text: `SELECT ${TAG_KEY_JOB_COLUMNS} FROM claim_tag_key_job($1::text[])`, values: [kinds] };

/** Sortes de travaux que seule la commande d'administration des clés exécute (décision du porteur n° 6). */
export const KEY_ADMIN_KINDS: readonly TagKeyJobKind[] = ['CREATE_KEY', 'DISABLE_KMS_KEY'];

export const tagKeyJobDto = (row: TagKeyJobRow) => ({
  job_id: row.id,
  operator_id: row.operator_id,
  key_index: row.key_index,
  kind: row.kind,
  status: row.status,
  awaiting: row.status !== 'DONE' && KEY_ADMIN_KINDS.includes(row.kind) ? ('KEY_ADMIN_COMMAND' as const) : null,
  attempts: row.attempts,
  last_error: row.last_error,
  // Compteurs seulement : la référence de clé notée pendant une création reste interne.
  progress: Object.fromEntries(Object.entries(row.progress).filter(([, value]) => typeof value === 'number')),
  approval_request_id: row.approval_request_id,
  created_at: row.created_at.toISOString(),
  finished_at: row.finished_at?.toISOString() ?? null,
});

export interface TagKeyCheckRunRow {
  id: string;
  operator_id: string;
  started_at: Date;
  finished_at: Date;
  sampled: number;
  mismatches: number;
  status: 'OK' | 'MISMATCH' | 'ERROR';
  detail: string | null;
}

export const tagKeyCheckRunDto = (row: TagKeyCheckRunRow) => ({
  run_id: row.id,
  operator_id: row.operator_id,
  started_at: row.started_at.toISOString(),
  finished_at: row.finished_at.toISOString(),
  sampled: row.sampled,
  mismatches: row.mismatches,
  status: row.status,
  detail: row.detail,
});

export interface TagKeyRequestInput {
  scope: 'SHARED' | 'DEDICATED';
  dedicated_event_id: string | null;
}

export function parseTagKeyRequest(raw: unknown): TagKeyRequestInput {
  const body = raw === undefined || raw === null ? {} : objectBody(raw);
  const scope = enumField(body, 'scope', ['SHARED', 'DEDICATED'] as const, 'optional') ?? 'SHARED';
  const event = body.dedicated_event_id;
  if (scope === 'DEDICATED' && !isUuid(event)) throw unprocessable('dedicated_event_id : événement obligatoire pour une clé dédiée.');
  if (scope === 'SHARED' && event !== undefined && event !== null) throw unprocessable('dedicated_event_id : interdit pour une clé partagée.');
  return { scope, dedicated_event_id: scope === 'DEDICATED' ? (event as string) : null };
}

export function parseKeyIndex(raw: string): number {
  const value = Number(raw);
  if (!/^[0-9]{1,5}$/.test(raw) || value > 65535) throw unprocessable('key_index : entier de 0 à 65535 attendu.');
  return value;
}
