// Cas de la matrice x-roles : organization (mission routes-backoffice, WP10 ; interfaces.md §3, research D3).
import type { XRolesCase } from './registry';

export const cases: XRolesCase[] = [
  { operationId: 'createPspConfiguration' },
  { operationId: 'listPspConfigurations' },
  { operationId: 'getPspConfiguration' },
  { operationId: 'listOrganizers' },
  { operationId: 'createOrganizer' },
  { operationId: 'getOrganizer' },
  { operationId: 'updateOrganizer' },
  { operationId: 'listOrganizerContracts' },
  { operationId: 'createOrganizerContract' },
  { operationId: 'createOrganizerContractVersion' },
  { operationId: 'listMerchants' },
  { operationId: 'createMerchant' },
  { operationId: 'getMerchant' },
  { operationId: 'updateMerchant' },
  { operationId: 'listAccountMappings' },
  { operationId: 'createAccountMappingVersion' },
  { operationId: 'exportAccounting' },
];
