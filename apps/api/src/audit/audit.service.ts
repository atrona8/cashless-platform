// Journal d'audit (SPECIFICATION §13.3, FR-008) : une ligne par action d'administration, écrite avec le client de
// la transaction de l'action (jamais une transaction séparée) — si l'action est annulée, sa ligne l'est aussi.
// Le chaînage (seq, prev_hash, row_hash, occurred_at) est posé par la base (migration 0004).
import { Injectable } from '@nestjs/common';
import type { TxClient } from '../db/tenant-tx';

/** Actions auditées ; les missions suivantes étendent cette union. */
export type AuditAction =
  | 'USER_CREATED'
  | 'USER_DISABLED'
  | 'ROLE_GRANTED'
  | 'ROLE_REVOKED'
  | 'PLATFORM_ADMIN_CREATED'
  | 'APPROVAL_REQUESTED'
  | 'APPROVAL_EXECUTED'
  | 'APPROVAL_FAILED'
  | 'APPROVAL_REJECTED'
  | 'APPROVAL_TOKEN_USED';

/** Qui agit, avec quel rôle, d'où, pour quelle requête (voir `auditContext`). */
export interface AuditContext {
  actorId: string | null;
  actorRole: string | null;
  origin: string | null;
  requestId: string | null;
}

export interface AuditEntry extends AuditContext {
  /** Chaîne du prestataire (celui de la transaction) ; NULL = chaîne de la plateforme. */
  operatorId: string | null;
  action: AuditAction;
  objectType?: string;
  objectId?: string;
  before?: unknown;
  after?: unknown;
  approverId?: string | null;
}

/** JSON des états avant/après : les bigint (montants) passent en texte, jamais par un flottant. */
export function auditJson(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  return JSON.stringify(value, (_key, item: unknown) => (typeof item === 'bigint' ? item.toString() : item));
}

@Injectable()
export class AuditService {
  async record(client: TxClient, entry: AuditEntry): Promise<void> {
    await client.query(
      `INSERT INTO audit_log (operator_id, actor_id, actor_role, action, object_type, object_id, before, after,
                              approver_id, origin, request_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10, $11)`,
      [
        entry.operatorId,
        entry.actorId,
        entry.actorRole,
        entry.action,
        entry.objectType ?? null,
        entry.objectId ?? null,
        auditJson(entry.before),
        auditJson(entry.after),
        entry.approverId ?? null,
        entry.origin,
        entry.requestId || null,
      ],
    );
  }
}
