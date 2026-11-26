// Cas de la matrice x-roles : refunds (mission routes-backoffice, WP10 ; interfaces.md §3, research D3).
import type { XRolesCase } from './registry';

export const cases: XRolesCase[] = [
  { operationId: 'listRefundRequests' },
  { operationId: 'createRefundRequest' },
  { operationId: 'approveRefundRequest' },
  { operationId: 'confirmRefundRequest' },
  { operationId: 'rejectRefundRequest' },
  { operationId: 'postLateClaim' },
  { operationId: 'listPayoutEntitlements' },
  { operationId: 'requestPayoutBatch' },
  { operationId: 'listPayouts' },
  { operationId: 'exportPayoutBatch' },
  { operationId: 'confirmPayout' },
  { operationId: 'importAccountStatement' },
  { operationId: 'listStatementLines' },
  { operationId: 'matchStatementLine' },
  { operationId: 'getLedgerReconciliation' },
  { operationId: 'postLateAdjustment' },
];
