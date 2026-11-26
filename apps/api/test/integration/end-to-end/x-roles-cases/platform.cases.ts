// Cas de la matrice x-roles : platform (mission routes-backoffice, WP10 ; interfaces.md §3, research D3).
import type { XRolesCase } from './registry';

export const cases: XRolesCase[] = [
  { operationId: 'listJurisdictionProfiles' },
  { operationId: 'createJurisdictionProfile' },
  { operationId: 'getJurisdictionProfile' },
  { operationId: 'createJurisdictionProfileVersion' },
  { operationId: 'listOperators' },
  { operationId: 'createOperator' },
  { operationId: 'getOperator' },
  { operationId: 'updateOperator' },
  { operationId: 'listPlatformContracts' },
  { operationId: 'createPlatformContract' },
  { operationId: 'createPlatformContractVersion' },
  { operationId: 'listPlatformFeeRules' },
  { operationId: 'createPlatformFeeRule' },
];
