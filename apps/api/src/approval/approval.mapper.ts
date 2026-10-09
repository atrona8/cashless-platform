// Ligne approval_request ↔ schéma ApprovalRequest du contrat (snake_case, `approval_request_id`).
// Une demande PENDING dont l'échéance est passée est présentée EXPIRED (sans écriture).

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

export function presentedStatus(row: ApprovalRequestRow, now: Date = new Date()): ApprovalRequestRow['status'] {
  return row.status === 'PENDING' && row.expires_at.getTime() < now.getTime() ? 'EXPIRED' : row.status;
}

export function approvalRequestDto(row: ApprovalRequestRow, now?: Date): ApprovalRequestDto {
  return {
    approval_request_id: row.id,
    action: row.action,
    target_id: row.target_id,
    payload: row.payload,
    requested_by: row.requested_by,
    requested_at: row.requested_at,
    expires_at: row.expires_at,
    status: presentedStatus(row, now),
    decided_by: row.decided_by,
    decided_at: row.decided_at,
    decision_note: row.decision_note,
    executed_tx_id: row.executed_tx_id,
    result: row.result ?? null,
    failure_code: row.failure_code,
    failure_reason: row.failure_reason,
  };
}
