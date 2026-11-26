// Cas de la matrice x-roles : configuration (mission routes-backoffice, WP10 ; interfaces.md §3, research D3).
import type { XRolesCase } from './registry';

export const cases: XRolesCase[] = [
  { operationId: 'listPlatformConfigVersions' },
  { operationId: 'createPlatformConfigVersion' },
  { operationId: 'listOperatorConfigVersions' },
  { operationId: 'createOperatorConfigVersion' },
  { operationId: 'listOrganizerConfigVersions' },
  { operationId: 'createOrganizerConfigVersion' },
  { operationId: 'getResolvedEventConfig' },
  { operationId: 'listFeeRules' },
  { operationId: 'createFeeRule' },
  { operationId: 'replaceFeeRule', validBody: true },
];
