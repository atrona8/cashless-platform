// Cas de la matrice x-roles : customer-app (mission routes-backoffice, WP10 ; interfaces.md §3, research D3).
import type { XRolesCase } from './registry';

export const cases: XRolesCase[] = [
  {
    operationId: 'requestCustomerOtp',
    external:
      'PUBLIC seulement : aucun rôle du personnel déclaré ; le personnel est seulement refusé (sonde).',
  },
  {
    operationId: 'exchangeCustomerOtp',
    external:
      'PUBLIC seulement : aucun rôle du personnel déclaré ; le personnel est seulement refusé (sonde).',
  },
  {
    operationId: 'refreshCustomerToken',
    external:
      'PUBLIC seulement : aucun rôle du personnel déclaré ; le personnel est seulement refusé (sonde).',
  },
  {
    operationId: 'getMe',
    external:
      'CUSTOMER seulement : aucun rôle du personnel déclaré ; le personnel est seulement refusé (sonde).',
  },
  {
    operationId: 'listMyWallets',
    external:
      'CUSTOMER seulement : aucun rôle du personnel déclaré ; le personnel est seulement refusé (sonde).',
  },
  {
    operationId: 'listMyWalletTransactions',
    external:
      'CUSTOMER seulement : aucun rôle du personnel déclaré ; le personnel est seulement refusé (sonde).',
  },
  {
    operationId: 'lookupBalanceByClaimCode',
    external:
      'PUBLIC seulement : aucun rôle du personnel déclaré ; le personnel est seulement refusé (sonde).',
  },
  {
    operationId: 'listMyMedia',
    external:
      'CUSTOMER seulement : aucun rôle du personnel déclaré ; le personnel est seulement refusé (sonde).',
  },
  {
    operationId: 'claimMedia',
    external:
      'CUSTOMER seulement : aucun rôle du personnel déclaré ; le personnel est seulement refusé (sonde).',
  },
  {
    operationId: 'reportMyMediaLost',
    external:
      'CUSTOMER seulement : aucun rôle du personnel déclaré ; le personnel est seulement refusé (sonde).',
  },
  {
    operationId: 'createCustomerQrToken',
    external:
      'CUSTOMER seulement : aucun rôle du personnel déclaré ; le personnel est seulement refusé (sonde).',
  },
  {
    operationId: 'createMyRefundRequest',
    external:
      'CUSTOMER seulement : aucun rôle du personnel déclaré ; le personnel est seulement refusé (sonde).',
  },
  {
    operationId: 'listMyRefundRequests',
    external:
      'CUSTOMER seulement : aucun rôle du personnel déclaré ; le personnel est seulement refusé (sonde).',
  },
  {
    operationId: 'decideRefundRequestAsHolder',
    external:
      'PUBLIC seulement : aucun rôle du personnel déclaré ; le personnel est seulement refusé (sonde).',
  },
  {
    operationId: 'getMyWalletStatement',
    external:
      'CUSTOMER seulement : aucun rôle du personnel déclaré ; le personnel est seulement refusé (sonde).',
  },
];
