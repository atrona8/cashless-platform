// Cas de la matrice x-roles : terminals (mission routes-backoffice, WP10 ; interfaces.md §3, research D3).
import type { XRolesCase } from './registry';

export const cases: XRolesCase[] = [
  { operationId: 'createDeviceEnrollmentCode' },
  { operationId: 'listDeviceEnrollmentCodes' },
  {
    operationId: 'enrollDevice',
    external:
      'PUBLIC seulement : aucun rôle du personnel déclaré ; le personnel est seulement refusé (sonde).',
  },
  {
    operationId: 'refreshDeviceToken',
    external:
      'DEVICE seulement : aucun rôle du personnel déclaré ; le personnel est seulement refusé (sonde).',
  },
  {
    operationId: 'getDeviceConfig',
    external:
      'DEVICE seulement : aucun rôle du personnel déclaré ; le personnel est seulement refusé (sonde).',
  },
  {
    operationId: 'postDeviceHeartbeat',
    external:
      'DEVICE seulement : aucun rôle du personnel déclaré ; le personnel est seulement refusé (sonde).',
  },
  { operationId: 'listDevices' },
  { operationId: 'getDevice' },
  { operationId: 'suspendDevice' },
  { operationId: 'reactivateDevice' },
  { operationId: 'revokeDevice' },
];
