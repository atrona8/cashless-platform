// Traduction SQLSTATE → ProblemCode (SPECIFICATION §5.7, contracts/problem-mapping.md).
// Seuls le SQLSTATE et le nom de contrainte sont lus : jamais le texte du message SQL.
import type { ProblemCode } from '@cashless/contracts';

export interface MappedProblem {
  code: ProblemCode;
  status: number;
}

export const SQLSTATE_MAP: Readonly<Record<string, MappedProblem>> = {
  CL001: { code: 'VALIDATION_FAILED', status: 422 },
  CL002: { code: 'IDEMPOTENCY_KEY_REUSED', status: 409 },
  CL003: { code: 'LEDGER_LOCKED', status: 409 },
  CL004: { code: 'EVENT_CLOSING', status: 409 },
  CL005: { code: 'PERIOD_CLOSED', status: 409 },
  CL006: { code: 'DEBIT_AUTHORITY_EDGE', status: 409 },
  CL007: { code: 'INSUFFICIENT_FUNDS', status: 422 },
  CL008: { code: 'WALLET_LIMIT_EXCEEDED', status: 422 },
  CL009: { code: 'MONTHLY_TOPUP_LIMIT_EXCEEDED', status: 422 },
  CL010: { code: 'BATCH_IN_PROGRESS', status: 409 },
  CL011: { code: 'BATCH_TOO_LARGE', status: 413 },
  CL012: { code: 'SEQ_GAP_NOT_FOUND', status: 409 },
  CL013: { code: 'HANDOVER_INVALID_STATE', status: 409 },
  CL014: { code: 'EDGE_NOT_CAUGHT_UP', status: 409 },
  CL015: { code: 'STALE_AUTHORITY_EPOCH', status: 409 },
  CL016: { code: 'SEQ_OUT_OF_ORDER', status: 409 },
  CL017: { code: 'CHAIN_BROKEN', status: 409 },
  CL018: { code: 'EVENT_TRANSITION_INVALID', status: 409 },
  CL019: { code: 'CLOSING_CONDITION_NOT_MET', status: 409 },
  CL020: { code: 'MEDIA_STATE_INVALID', status: 409 },
  CL021: { code: 'SEQ_OUT_OF_RANGE', status: 409 },
  CL022: { code: 'TAP_UNUSABLE', status: 409 },
  CL023: { code: 'APPROVAL_INVALID', status: 409 },
  CL024: { code: 'LATE_CLAIM_INVALID', status: 409 },
  // Terminaux (mission 5a : migrations 0022, 0023 ; traduction par le lot WP12).
  CL025: { code: 'ENROLLMENT_CODE_INVALID', status: 422 },
  CL026: { code: 'ENROLLMENT_CODE_EXPIRED', status: 422 },
  CL027: { code: 'DEVICE_MODE_NOT_ALLOWED', status: 422 },
  CL028: { code: 'DEVICE_SERIAL_IN_USE', status: 409 },
  CL029: { code: 'CONFLICT_STATE', status: 409 },
  CL030: { code: 'DEVICE_SUSPENDED', status: 403 },
  // Mission 5b (lot WP08, T037 ; data-model « Codes d'erreur nouveaux » ; ADR-123 pour CL036, CL040).
  CL031: { code: 'ENROLLMENT_EVENT_CLOSED', status: 422 },
  CL032: { code: 'VENDOR_SESSION_INVALID', status: 409 },
  CL033: { code: 'VENDOR_PIN_INVALID', status: 401 },
  CL034: { code: 'SALE_LINES_INVALID', status: 422 },
  CL035: { code: 'ALREADY_REVERSED', status: 409 },
  // 422 du contrat (le data-model disait 403) : décision du porteur, ADR-123.
  CL036: { code: 'REVERSAL_NOT_ALLOWED', status: 422 },
  // `422 QR_TOKEN_INVALID` du QR client : traduit par la route (WP13), jamais ici (ADR-123).
  CL037: { code: 'PAYMENT_REQUEST_NOT_PENDING', status: 409 },
  CL038: { code: 'MEDIA_BLOCKED', status: 422 },
  CL039: { code: 'WALLET_BLOCKED', status: 422 },
  CL040: { code: 'REVERSAL_WINDOW_EXPIRED', status: 409 },
  P0002: { code: 'NOT_FOUND', status: 404 },
  // FR-024 : seul usage prévu en V1, le terminal révoqué (`open_offline_batch`,
  // `record_device_heartbeat`, `assert_device_active`). Le SQLSTATE seul ne distingue pas un refus
  // de politique RLS ni un droit refusé (aussi 42501) ; ils ne peuvent survenir qu'en cas de défaut
  // de l'API (toute requête passe par TenantTx).
  '42501': { code: 'DEVICE_REVOKED', status: 403 },
  P0001: { code: 'INTERNAL_ERROR', status: 500 },
};

/**
 * Contraintes CHECK « deux personnes distinctes » (anonymes dans le schéma : noms générés par PostgreSQL).
 * Nom → définition attendue ; un test d'intégration compare à pg_get_constraintdef (échec si renumérotées).
 */
export const DOUBLE_VALIDATION_CONSTRAINTS: Readonly<Record<string, string>> = {
  journal_transaction_check:
    "CHECK (((source <> 'BACKOFFICE'::text) OR ((created_by IS NOT NULL) AND (approved_by IS NOT NULL) AND (approved_by <> created_by))))",
  payout_check: 'CHECK ((approved_by <> initiated_by))',
  device_seq_registry_check2:
    "CHECK (((outcome <> 'WAIVED'::text) OR ((created_by IS NOT NULL) AND (approved_by IS NOT NULL) AND (approved_by <> created_by) AND (reason IS NOT NULL))))",
  debit_authority_handover_check4:
    "CHECK (((status <> 'FORCED'::text) OR (direction = 'TO_EDGE'::text) OR ((approved_by IS NOT NULL) AND (approved_by <> requested_by) AND (reason IS NOT NULL))))",
  approval_request_check: 'CHECK (((decided_by IS NULL) OR (decided_by <> requested_by)))',
};

/**
 * Violations d'unicité traduites, par nom de contrainte (A19) : liste fermée ; tout autre `23505`
 * reste `500` (une unicité inattendue est un défaut, pas un refus métier).
 */
export const UNIQUE_CONSTRAINTS: Readonly<Record<string, MappedProblem>> = {
  journal_transaction_reverses_once: { code: 'ALREADY_REVERSED', status: 409 },
};

const INTERNAL: MappedProblem = { code: 'INTERNAL_ERROR', status: 500 };

/** Une erreur `pg` porte un SQLSTATE de 5 caractères dans `code` (et parfois `constraint`). */
export function isSqlError(error: unknown): error is { code: string; constraint?: string } {
  return (
    typeof error === 'object' &&
    error !== null &&
    typeof (error as { code?: unknown }).code === 'string' &&
    /^[0-9A-Z]{5}$/.test((error as { code: string }).code)
  );
}

export function mapSqlState(sqlstate: string, constraint?: string): MappedProblem {
  if (sqlstate === '23514') {
    return constraint !== undefined && constraint in DOUBLE_VALIDATION_CONSTRAINTS
      ? { code: 'FORBIDDEN', status: 403 }
      : { code: 'VALIDATION_FAILED', status: 422 };
  }
  if (sqlstate === '23505')
    return (
      (constraint !== undefined && Object.hasOwn(UNIQUE_CONSTRAINTS, constraint)
        ? UNIQUE_CONSTRAINTS[constraint]
        : undefined) ?? INTERNAL
    );
  return SQLSTATE_MAP[sqlstate] ?? INTERNAL;
}
