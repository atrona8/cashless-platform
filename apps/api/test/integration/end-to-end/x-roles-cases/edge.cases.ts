// Cas de la matrice x-roles : edge (mission routes-backoffice, WP10 ; interfaces.md §3, research D3).
import type { XRolesCase } from './registry';

export const cases: XRolesCase[] = [
  { operationId: 'getDebitAuthority' },
  { operationId: 'requestDebitAuthorityChange' },
  {
    operationId: 'getCurrentEdgeHandover',
    external:
      'GATEWAY seulement : aucun rôle du personnel déclaré ; le personnel est seulement refusé (sonde).',
  },
  {
    operationId: 'ackEdgeHandover',
    external:
      'GATEWAY seulement : aucun rôle du personnel déclaré ; le personnel est seulement refusé (sonde).',
  },
  {
    operationId: 'releaseEdgeHandover',
    external:
      'GATEWAY seulement : aucun rôle du personnel déclaré ; le personnel est seulement refusé (sonde).',
  },
  {
    operationId: 'getEdgeReplicationFeed',
    external:
      'GATEWAY seulement : aucun rôle du personnel déclaré ; le personnel est seulement refusé (sonde).',
  },
  {
    operationId: 'submitEdgeSyncBatch',
    external:
      'GATEWAY seulement : aucun rôle du personnel déclaré ; le personnel est seulement refusé (sonde).',
  },
];
