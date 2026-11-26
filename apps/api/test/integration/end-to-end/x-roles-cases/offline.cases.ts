// Cas de la matrice x-roles : offline (mission routes-backoffice, WP10 ; interfaces.md §3, research D3).
import type { XRolesCase } from './registry';

export const cases: XRolesCase[] = [
  {
    operationId: 'getDeviceSeqStatus',
    external:
      'DEVICE seulement : aucun rôle du personnel déclaré ; le personnel est seulement refusé (sonde).',
  },
  { operationId: 'getEventDeviceSyncStatus' },
  { operationId: 'waiveSeqGap' },
  { operationId: 'importDeviceJournal' },
  { operationId: 'getDeviceJournalImport' },
  { operationId: 'getOfflineCeiling' },
  { operationId: 'setOfflineCeiling' },
  { operationId: 'getOrganizerOfflinePolicy' },
  { operationId: 'setOrganizerOfflinePolicy' },
  { operationId: 'getEventOfflinePolicy' },
  { operationId: 'setEventOfflinePolicy' },
  { operationId: 'getDeviceOfflinePolicy' },
  {
    operationId: 'setDeviceOfflinePolicy',
    note: 'OPERATOR_ADMIN n’écrit que la coupure (`offline_enabled: false` seul, write = CUT) : son corps est celui de la coupure.',
    prepare: (fx, role) => ({
      method: 'PUT',
      path: `/devices/${fx.ids.device_id}/offline-policy`,
      body: role === 'OPERATOR_ADMIN' ? { offline_enabled: false } : {},
    }),
  },
  { operationId: 'getEventOfflineRisk' },
  {
    operationId: 'getOfflineSnapshot',
    external:
      'DEVICE seulement : aucun rôle du personnel déclaré ; le personnel est seulement refusé (sonde).',
  },
  {
    operationId: 'ackOfflineSnapshot',
    external:
      'DEVICE seulement : aucun rôle du personnel déclaré ; le personnel est seulement refusé (sonde).',
  },
  {
    operationId: 'submitOfflineBatch',
    external:
      'DEVICE seulement : aucun rôle du personnel déclaré ; le personnel est seulement refusé (sonde).',
  },
  {
    operationId: 'getOfflineBatchResult',
    external:
      'DEVICE seulement : aucun rôle du personnel déclaré ; le personnel est seulement refusé (sonde).',
  },
];
