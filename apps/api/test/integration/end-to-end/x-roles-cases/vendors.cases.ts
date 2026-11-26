// Cas de la matrice x-roles : vendors (mission routes-backoffice, WP10 ; interfaces.md §3, research D3).
import type { XRolesCase } from './registry';

export const cases: XRolesCase[] = [
  { operationId: 'listVendors' },
  { operationId: 'createVendor' },
  { operationId: 'getVendor' },
  { operationId: 'setVendorPin' },
  { operationId: 'setVendorStatus' },
  {
    operationId: 'listTerminalVendors',
    external:
      'DEVICE seulement : aucun rôle du personnel déclaré ; le personnel est seulement refusé (sonde).',
  },
  {
    operationId: 'openVendorSession',
    external:
      'VENDOR/DEVICE seulement : aucun rôle du personnel déclaré ; le personnel est seulement refusé (sonde).',
  },
  {
    operationId: 'closeVendorSession',
    external:
      'DEVICE seulement : aucun rôle du personnel déclaré ; le personnel est seulement refusé (sonde).',
  },
];
