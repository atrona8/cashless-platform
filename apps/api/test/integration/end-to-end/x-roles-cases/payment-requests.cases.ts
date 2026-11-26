// Cas de la matrice x-roles : payment-requests (mission routes-backoffice, WP10 ; interfaces.md §3, research D3).
import type { XRolesCase } from './registry';

export const cases: XRolesCase[] = [
  {
    operationId: 'createPaymentRequest',
    external:
      'VENDOR/DEVICE seulement : aucun rôle du personnel déclaré ; le personnel est seulement refusé (sonde).',
  },
  {
    operationId: 'getPaymentRequest',
    external:
      'CUSTOMER/DEVICE seulement : aucun rôle du personnel déclaré ; le personnel est seulement refusé (sonde).',
  },
  {
    operationId: 'payPaymentRequest',
    external:
      'CUSTOMER seulement : aucun rôle du personnel déclaré ; le personnel est seulement refusé (sonde).',
  },
  {
    operationId: 'cancelPaymentRequest',
    external:
      'CUSTOMER/DEVICE seulement : aucun rôle du personnel déclaré ; le personnel est seulement refusé (sonde).',
  },
];
