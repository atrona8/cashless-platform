// Cas de la matrice x-roles : payments (mission routes-backoffice, WP10 ; interfaces.md §3, research D3).
import type { XRolesCase } from './registry';

export const cases: XRolesCase[] = [
  {
    operationId: 'createPayment',
    external:
      'VENDOR/DEVICE seulement : aucun rôle du personnel déclaré ; le personnel est seulement refusé (sonde).',
  },
  {
    operationId: 'getPayment',
    refusals: [404],
    note: 'La lecture d’une vente est réservée à READ_ROLES ; hors de ces rôles, 404 : le serveur masque l’existence (payment-read.service.ts, row).',
  },
  { operationId: 'reversePayment' },
];
