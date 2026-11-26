// Cas de la matrice x-roles : catalog (mission routes-backoffice, WP10 ; interfaces.md §3, research D3).
import type { XRolesCase } from './registry';

export const cases: XRolesCase[] = [
  { operationId: 'getCatalog' },
  { operationId: 'createCatalogCategory' },
  { operationId: 'updateCatalogCategory' },
  { operationId: 'createCatalogItem' },
  { operationId: 'updateCatalogItem' },
  { operationId: 'getCatalogVersion' },
  { operationId: 'setCatalogPolicy', validBody: true },
];
