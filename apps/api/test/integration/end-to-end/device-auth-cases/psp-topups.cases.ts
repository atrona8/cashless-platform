// Cas de la matrice des preuves pour les routes de recharge PSP (mission 6, lot WP11, T054, T055 ; C-003 ;
// OP-N70) : `POST /topups/psp`, `GET /topups/psp/{}` et `POST /topups/psp/{}/cancel`, servies par la garde
// composée `PspTopupCallerGuard` (chemin terminal : trois preuves ET `X-Staff-Authorization`, sans repli sur le
// festivalier ni sur la personne seule). Comme pour les sessions de caisse, la matrice ne juge que les PREUVES :
// avec des preuves valides la route répond après la garde (`422 DEVICE_MODE_NOT_ALLOWED` à la demande, `404` sur
// une recharge inconnue) ; un nonce consommé prouve que la garde réelle l'a servie. Le comportement métier est
// prouvé en HTTPS réel par `test/integration/topups/psp-*.spec.ts`.
import { randomUUID } from 'node:crypto';
import type { CaseFile, RouteCase } from './registry';

export const controllers: CaseFile['controllers'] = ['PspTopupsController'];

export function cases(): Record<string, RouteCase> {
  const topupId = randomUUID();
  return {
    'POST /topups/psp': {
      server: 'api',
      counter: true,
      exclusive: 'psp',
      path: () => '/topups/psp',
      body: () => ({
        wallet_id: randomUUID(),
        amount: 1000,
        currency: 'XOF',
        provider: 'WAVE',
      }),
      idempotencyKey: (c, who) => c.seqKey(who),
    },
    'GET /topups/psp/{}': {
      server: 'api',
      counter: true,
      exclusive: 'psp',
      path: () => `/topups/psp/${topupId}`,
    },
    'POST /topups/psp/{}/cancel': {
      server: 'api',
      counter: true,
      exclusive: 'psp',
      path: () => `/topups/psp/${topupId}/cancel`,
      idempotencyKey: (c, who) => c.seqKey(who),
    },
  };
}
