// Cas de la matrice x-roles : psp-webhooks (mission routes-backoffice, WP10 ; interfaces.md §3, research D3).
import type { XRolesCase } from './registry';

export const cases: XRolesCase[] = [
  {
    operationId: 'receivePspWebhook',
    external:
      'GATEWAY seulement : aucun rôle du personnel déclaré ; le personnel est seulement refusé (sonde).',
  },
];
