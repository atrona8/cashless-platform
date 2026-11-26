// Entrées et sorties de `GET /anomalies` et `POST /anomalies/{anomaly_id}/classification` (mission 11b, WP07 ;
// contrat `Anomaly`, `AnomalyPage`, `AnomalyClassificationCreate`). Seuls les champs du schéma du contrat sortent :
// ni `detail` (jsonb libre), ni `operator_id`, ni `ledger_id`, ni `loss_bearer`, ni `batch_id`.
import { ProblemException } from '../errors/problem';
import { decodeCursor, encodeCursor } from '../identity/users/users.dto';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Liste fermée du contrat (`Anomaly.kind`, SPECIFICATION §12.2) : filtre `kind` seulement, jamais « classable ». */
export const ANOMALY_KINDS: readonly string[] = [
  'OFFLINE_SHORTFALL',
  'COUNTER_DUPLICATE',
  'COUNTER_TIME_INVERSION',
  'UID_MISMATCH',
  'RETIRED_IDENTITY',
  'SEQ_GAP',
  'CHAIN_BROKEN',
  'CLOCK_SKEW',
  'VOID_CONFLICT',
  'ONLINE_CONFIRMED_MISSING',
  'IDEMPOTENCY_CONFLICT',
  'NON_COMPLIANT_OPERATION',
  'PERIOD_CLOSED_OPERATION',
  'LATE_OFFLINE_SYNC',
  'SIGNATURE_MISMATCH',
  'CASH_TOPUP_OVER_LIMIT',
  'CASH_DIFF',
  'PSP_MISMATCH',
  'PSP_TOPUP_OVER_LIMIT',
  'EDGE_REPLAY_FAILED',
  'LATE_CHARGEBACK',
  'CARD_VELOCITY',
  'PSP_TOPUP_NOT_CREDITED',
];

export const invalid = (detail: string, extensions?: Record<string, unknown>): ProblemException =>
  new ProblemException('VALIDATION_FAILED', { status: 422, detail, extensions });

export interface AnomalyListQuery {
  eventId: string | null;
  kind: string | null;
  status: 'OPEN' | 'RESOLVED' | null;
  from: string | null;
  to: string | null;
  cursor: [string, string] | null;
  limit: number;
}

function single(name: string, raw: unknown): string | null {
  if (raw === undefined) return null;
  if (typeof raw !== 'string' || raw === '') throw invalid(`${name} : valeur unique attendue.`);
  return raw;
}

function instant(name: string, raw: string | null): string | null {
  if (raw === null) return null;
  const ms = Date.parse(raw);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(raw) || Number.isNaN(ms))
    throw invalid(`${name} : date-heure (RFC 3339) attendue.`);
  return new Date(ms).toISOString();
}

export function parseListQuery(query: Record<string, unknown>): AnomalyListQuery {
  const eventId = single('event_id', query.event_id);
  if (eventId !== null && !UUID.test(eventId)) throw invalid('event_id : UUID attendu.');
  const kind = single('kind', query.kind);
  if (kind !== null && !ANOMALY_KINDS.includes(kind)) throw invalid('kind : type inconnu.');
  const status = single('status', query.status);
  if (status !== null && status !== 'OPEN' && status !== 'RESOLVED')
    throw invalid('status : OPEN ou RESOLVED attendu.');
  const limitRaw = single('limit', query.limit);
  let limit = 50;
  if (limitRaw !== null) {
    limit = Number(limitRaw);
    if (!Number.isInteger(limit) || limit < 1 || limit > 200)
      throw invalid('limit : entier de 1 à 200 attendu.');
  }
  let cursor: [string, string] | null;
  try {
    cursor = decodeCursor(single('cursor', query.cursor) ?? undefined);
  } catch {
    throw invalid('cursor : curseur invalide.');
  }
  if (cursor !== null && Number.isNaN(Date.parse(cursor[0])))
    throw invalid('cursor : curseur invalide.');
  return {
    eventId,
    kind,
    status: status as AnomalyListQuery['status'],
    from: instant('from', single('from', query.from)),
    to: instant('to', single('to', query.to)),
    cursor,
    limit,
  };
}

/** Corps `{ reason }` : 1 à 500 caractères après suppression des espaces de bord ; rien d'autre n'est admis. */
export function parseClassification(body: unknown): { reason: string } {
  if (typeof body !== 'object' || body === null || Array.isArray(body))
    throw invalid('Corps attendu : objet { reason }.');
  const extra = Object.keys(body).filter((key) => key !== 'reason');
  if (extra.length > 0) throw invalid(`Champ inconnu : ${extra[0]}.`);
  const reason = (body as { reason?: unknown }).reason;
  if (typeof reason !== 'string') throw invalid('reason : texte de 1 à 500 caractères attendu.');
  const trimmed = reason.trim();
  if (trimmed.length < 1 || [...trimmed].length > 500)
    throw invalid('reason : texte de 1 à 500 caractères attendu.');
  return { reason: trimmed };
}

export function requireAnomalyId(raw: string): string {
  if (!UUID.test(raw)) throw new ProblemException('NOT_FOUND');
  return raw;
}

/** Ligne de `anomaly_overview` lue par le service (horodatages et montant en texte exact). */
export interface AnomalyRow {
  id: string;
  kind: string;
  status: 'OPEN' | 'RESOLVED';
  event_id: string | null;
  created_at: string;
  created_at_exact: string;
  ledger_id: string | null;
  amount: string;
  currency: string | null;
  media_id: string | null;
  device_id: string | null;
  transaction_id: string | null;
  classifiable: boolean;
  classified_by: string | null;
  classified_at: string | null;
  classification_reason: string | null;
}

export interface AnomalyDto {
  anomaly_id: string;
  kind: string;
  status: 'OPEN' | 'RESOLVED';
  event_id: string | null;
  created_at: string;
  amount: number | null;
  currency: string | null;
  media_id: string | null;
  device_id: string | null;
  transaction_id: string | null;
  classifiable: boolean;
  classification?: { reason: string; classified_by: string; classified_at: string };
}

/** Colonnes lues de `anomaly_overview` (horodatages en UTC, au format du contrat). */
export const ANOMALY_COLUMNS = `id, kind, status, event_id, ledger_id, amount::text AS amount, currency, media_id,
  device_id, transaction_id, classifiable, classified_by, classification_reason,
  to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at,
  created_at::text AS created_at_exact,
  to_char(classified_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS classified_at`;

export function anomalyDto(row: AnomalyRow): AnomalyDto {
  const dto: AnomalyDto = {
    anomaly_id: row.id,
    kind: row.kind,
    status: row.status,
    event_id: row.event_id,
    created_at: row.created_at,
    // Sans grand livre (signal de sécurité d'un bracelet sans portefeuille) : ni montant ni devise.
    amount: row.ledger_id === null ? null : Number(row.amount),
    currency: row.currency,
    media_id: row.media_id,
    device_id: row.device_id,
    transaction_id: row.transaction_id,
    classifiable: row.classifiable,
  };
  if (
    row.classified_by !== null &&
    row.classified_at !== null &&
    row.classification_reason !== null
  )
    dto.classification = {
      reason: row.classification_reason,
      classified_by: row.classified_by,
      classified_at: row.classified_at,
    };
  return dto;
}

export function pageOf(rows: AnomalyRow[], limit: number) {
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  return {
    data: page.map(anomalyDto),
    next_cursor: hasMore && last ? encodeCursor(last.created_at_exact, last.id) : null,
    has_more: hasMore,
  };
}
