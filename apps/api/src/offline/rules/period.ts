// Contrôles de période (contracts/compliance.md § Période). Premier échec seulement.
import type { OperationType } from './types';

export interface PeriodInput {
  occurredAt: Date;
  lockedUntil: Date | null;
  ledgerStatus: string;
  eventStatus: string;
  type: OperationType;
}

export type PeriodResult =
  | { ok: true }
  | {
      ok: false;
      reason: 'PERIOD_CLOSED' | 'LEDGER_LOCKED' | 'SYNC_DEADLINE_PASSED';
      anomaly: 'PERIOD_CLOSED_OPERATION' | 'LATE_OFFLINE_SYNC';
    };

// Statuts qui acceptent encore une vente ; tout autre (SETTLING, REFUND_WINDOW, CLOSED, inconnu)
// refuse.
const SALES_OPEN: ReadonlySet<string> = new Set(['DRAFT', 'LIVE', 'CLOSING', 'RECONCILING']);

export function checkPeriod(i: PeriodInput): PeriodResult {
  if (i.lockedUntil !== null && i.occurredAt.getTime() <= i.lockedUntil.getTime()) {
    return { ok: false, reason: 'PERIOD_CLOSED', anomaly: 'PERIOD_CLOSED_OPERATION' };
  }
  if (i.ledgerStatus === 'LOCKED') {
    return { ok: false, reason: 'LEDGER_LOCKED', anomaly: 'PERIOD_CLOSED_OPERATION' };
  }
  if ((i.type === 'PURCHASE' || i.type === 'REVERSAL') && !SALES_OPEN.has(i.eventStatus)) {
    return { ok: false, reason: 'SYNC_DEADLINE_PASSED', anomaly: 'LATE_OFFLINE_SYNC' };
  }
  return { ok: true };
}
