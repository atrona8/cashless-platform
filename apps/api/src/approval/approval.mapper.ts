// Ligne approval_request ↔ schéma ApprovalRequest du contrat (snake_case, `approval_request_id`).
// Une demande PENDING dont l'échéance est passée est présentée EXPIRED (sans écriture).
import { maskIban } from '../common/iban';

export interface ApprovalRequestRow {
  id: string;
  operator_id: string;
  action: string;
  target_id: string | null;
  payload: Record<string, unknown>;
  requested_by: string;
  requested_at: Date;
  expires_at: Date;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED' | 'EXECUTED' | 'FAILED';
  decided_by: string | null;
  decided_at: Date | null;
  decision_note: string | null;
  executed_tx_id: string | null;
  failure_code: string | null;
  failure_reason: string | null;
  result: unknown;
}

export interface ApprovalRequestDto {
  approval_request_id: string;
  action: string;
  target_id: string | null;
  payload: Record<string, unknown>;
  requested_by: string;
  requested_at: Date;
  expires_at: Date;
  status: ApprovalRequestRow['status'];
  decided_by: string | null;
  decided_at: Date | null;
  decision_note: string | null;
  executed_tx_id: string | null;
  result: unknown;
  failure_code: string | null;
  failure_reason: string | null;
}

export function presentedStatus(
  row: ApprovalRequestRow,
  now: Date = new Date(),
): ApprovalRequestRow['status'] {
  return row.status === 'PENDING' && row.expires_at.getTime() < now.getTime()
    ? 'EXPIRED'
    : row.status;
}

const REDACTED = '[masqué]';

/** Numéro réduit à ses 3 derniers chiffres (`+221770000002` → `*********002`). */
function maskMsisdn(value: string): string {
  const digits = value.replace(/\D/g, '');
  return `${'*'.repeat(Math.max(value.length - 3, 0))}${digits.slice(-3)}`;
}

/**
 * Charge d'une action avec les données de paiement masquées (récursif, toute action) : `iban`
 * et `msisdn` (3 derniers chiffres). Un `iban` en enveloppe `enc:v1:` rend la valeur de la clé
 * sœur `iban_mask` (chaîne), sinon `[masqué]` : jamais l'enveloppe. Un `iban` en clair (ancienne
 * ligne) passe par `maskIban`. Pur : aucun coffre. Les routes d'approbation et l'audit (qui
 * recopie ce DTO) ne portent donc jamais une destination en clair ni chiffrée.
 */
export function maskPaymentData(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(maskPaymentData);
  if (typeof value !== 'object' || value === null) return value;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === 'iban' && typeof item === 'string')
      out[key] = item.startsWith('enc:v1:')
        ? typeof (value as Record<string, unknown>).iban_mask === 'string'
          ? (value as Record<string, unknown>).iban_mask
          : REDACTED
        : maskIban(item);
    else if (key === 'msisdn' && typeof item === 'string') out[key] = maskMsisdn(item);
    else out[key] = maskPaymentData(item);
  }
  return out;
}

export function approvalRequestDto(row: ApprovalRequestRow, now?: Date): ApprovalRequestDto {
  return {
    approval_request_id: row.id,
    action: row.action,
    target_id: row.target_id,
    payload: maskPaymentData(row.payload) as Record<string, unknown>,
    requested_by: row.requested_by,
    requested_at: row.requested_at,
    expires_at: row.expires_at,
    status: presentedStatus(row, now),
    decided_by: row.decided_by,
    decided_at: row.decided_at,
    decision_note: row.decision_note,
    executed_tx_id: row.executed_tx_id,
    result: maskPaymentData(row.result ?? null),
    failure_code: row.failure_code,
    failure_reason: row.failure_reason,
  };
}
