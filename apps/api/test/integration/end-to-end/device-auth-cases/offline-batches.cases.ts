// Cas de la matrice des preuves pour les routes de lots hors ligne (mission 7, lot WP18, ajoutés
// au lot WP21 en correctif de matrice ; OP-N70) : `POST /offline-batches` et
// `GET /offline-batches/{}`, servies par `DeviceGuard` (`allowSuspended` : un terminal suspendu
// garde ses lots). Comme pour les autres lots, la matrice ne juge que les PREUVES : avec des
// preuves valides la route répond après la garde (`400` sur un corps vide, `404` sur un lot
// inconnu) ; un nonce consommé prouve que la garde réelle l'a servie. Le comportement métier est
// prouvé par `test/integration/offline/` et `offline-*.spec.ts`.
import { randomUUID } from 'node:crypto';
import type { CaseFile, RouteCase } from './registry';

// Les deux routes de snapshots (WP15, `@DeviceAuth()` sans `allowSuspended`) manquaient aussi
// à la matrice : même correctif, même fichier.
export const controllers: CaseFile['controllers'] = [
  'OfflineBatchesController',
  'OfflineSnapshotsController',
  // Partie D de WP21 : GET /device/seq-status (allowSuspended, répond 200 avec des preuves valides).
  'SeqStatusController',
];

export function cases(): Record<string, RouteCase> {
  const batchId = randomUUID();
  return {
    'POST /offline-batches': {
      server: 'api',
      path: () => '/offline-batches',
      body: () => ({}),
      idempotencyKey: () => batchId,
      headers: () => ({ 'x-authority-epoch': '0' }),
    },
    'GET /offline-batches/{}': {
      server: 'api',
      path: () => `/offline-batches/${batchId}`,
    },
    'GET /device/seq-status': { server: 'api', path: () => '/device/seq-status', ok: 200 },
    'GET /offline-snapshots/current': {
      server: 'api',
      path: () => '/offline-snapshots/current',
    },
    'POST /offline-snapshots/ack': {
      server: 'api',
      path: () => '/offline-snapshots/ack',
      body: () => ({}),
    },
  };
}
