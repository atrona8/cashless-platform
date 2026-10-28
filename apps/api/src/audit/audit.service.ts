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
  | 'APPROVAL_TOKEN_USED'
  // Mission configuration-parties-evenements
  | 'CONFIG_VERSION_CREATED'
  | 'JURISDICTION_PROFILE_CREATED'
  | 'OPERATOR_CREATED'
  | 'OPERATOR_UPDATED'
  | 'ORGANIZER_CREATED'
  | 'ORGANIZER_UPDATED'
  | 'MERCHANT_CREATED'
  | 'MERCHANT_UPDATED'
  | 'CONTRACT_CREATED'
  | 'FEE_RULE_CREATED'
  | 'FEE_RULE_REPLACED'
  | 'EVENT_CREATED'
  | 'EVENT_UPDATED'
  | 'EVENT_STATUS_CHANGED'
  | 'PARTICIPATION_CREATED'
  | 'PARTICIPATION_UPDATED'
  | 'POINT_OF_SALE_CREATED'
  | 'POINT_OF_SALE_RENAMED'
  // Mission bracelets-nfc
  | 'TAG_KEY_CREATED'
  | 'TAG_KEY_KMS_DISABLED'
  | 'TAG_DEK_ROTATED'
  | 'TAG_DEK_REENCRYPTED'
  | 'TAG_KEY_RETIRED'
  | 'TAG_KEY_JOB_REFUSED'
  | 'MEDIA_BATCH_CREATED'
  | 'MEDIA_BATCH_UPDATED'
  | 'MEDIA_BATCH_STATUS_CHANGED'
  | 'MEDIA_BATCH_CLOSURE'
  | 'MEDIA_BATCH_PRELOAD_CAUGHT_UP'
  | 'CLAIM_CODES_ISSUED'
  | 'CLAIM_CODES_ASSOCIATED'
  | 'MEDIA_PERSONALIZED'
  | 'CLAIM_CODE_ASSOCIATED'
  | 'CLAIM_CODE_ASSOCIATION_REFUSED'
  | 'MEDIA_BLACKLISTED'
  | 'MEDIA_REINSTATED'
  | 'MEDIA_PASSWORD_MISMATCH'
  | 'MEDIA_ACTIVATED'
  | 'MEDIA_DEPOSIT_TAKEN'
  | 'MEDIA_DEPOSIT_REFUNDED'
  | 'MEDIA_RELEASED'
  | 'MEDIA_REASSIGNED'
  | 'MEDIA_REPLACED'
  | 'MEDIA_REPORTED_LOST'
  | 'MEDIA_RECOVERED'
  | 'MEDIA_CASH_DUE_REFUNDED'
  | 'MEDIA_CLAIMED'
  | 'MEDIA_CLAIM_PENDING'
  | 'MEDIA_CLAIM_BLOCKED'
  | 'MEDIA_CLAIM_CONFIRMED'
  | 'MEDIA_SELF_ACTIVATED'
  // Mission identite-enrolement-terminaux (lot WP14)
  | 'DEVICE_ENROLLMENT_CODE_CREATED'
  | 'DEVICE_ENROLLED'
  | 'DEVICE_ENROLLMENT_REFUSED'
  // Lot WP15 : réutilisation d'un jeton de rafraîchissement (famille révoquée)
  | 'DEVICE_TOKEN_REUSE'
  // Mission identite-enrolement-terminaux, lot WP16 : transitions de statut d'un terminal
  | 'DEVICE_SUSPENDED'
  | 'DEVICE_REACTIVATED'
  | 'DEVICE_REVOKED'
  // Mission 5b (lot WP09) : vendeurs et sessions de vendeur
  | 'VENDOR_CREATED'
  | 'VENDOR_PIN_CHANGED'
  | 'VENDOR_DISABLED'
  | 'VENDOR_REACTIVATED'
  | 'VENDOR_PIN_FAILED'
  | 'VENDOR_LOCKED'
  | 'VENDOR_SESSION_OPENED'
  | 'VENDOR_SESSION_CLOSED'
  // Mission terminaux-paiement-en-ligne, lot WP10 : catalogue d'un point de vente
  | 'CATALOG_CATEGORY_CREATED'
  | 'CATALOG_CATEGORY_UPDATED'
  | 'CATALOG_ITEM_CREATED'
  | 'CATALOG_ITEM_UPDATED'
  | 'CATALOG_POLICY_SET'
  // Mission 6, lot WP10 : configurations PSP et choix par événement
  | 'PSP_CONFIGURATION_CREATED'
  | 'PSP_CONFIGURATION_STATUS_CHANGED'
  | 'EVENT_PSP_SELECTION_CHANGED'
  // Mission 6 (lot WP08) : sessions de caisse et dépôt en banque
  | 'CASH_SESSION_OPENED'
  | 'CASH_SESSION_COUNTED'
  | 'CASH_SESSION_CLOSED'
  | 'CASH_DEPOSIT_REQUESTED'
  | 'CASH_TOPUP'
  // Mission 6 (lot WP11) : recharges PSP
  | 'PSP_TOPUP_REQUESTED'
  | 'PSP_TOPUP_CANCELLED'
  | 'PSP_TOPUP_CREDITED'
  | 'PSP_TOPUP_NOT_CREDITED';

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
  return JSON.stringify(value, (_key, item: unknown) =>
    typeof item === 'bigint' ? item.toString() : item,
  );
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
