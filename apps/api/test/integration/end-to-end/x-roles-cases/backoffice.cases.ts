// Cas de la matrice x-roles : backoffice (mission routes-backoffice, WP10 ; interfaces.md §3, research D3).
import type { XRolesCase } from './registry';

export const cases: XRolesCase[] = [
  { operationId: 'getStaffProfile' },
  { operationId: 'listEventSales' },
  { operationId: 'getSale' },
  { operationId: 'listAnomalies' },
  { operationId: 'classifyAnomaly' },
  { operationId: 'searchMedia' },
  { operationId: 'getWalletOverview' },
  { operationId: 'searchCustomerByPhone' },
  { operationId: 'listPhoneModels' },
  { operationId: 'upsertPhoneModel' },
  { operationId: 'deletePhoneModel' },
];
