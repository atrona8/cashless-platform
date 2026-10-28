// Cas de la matrice des preuves pour les routes de session de caisse (mission 6, lot WP08, T042 ; C-003 ;
// OP-N70) : `POST /cash-sessions` et `POST /cash-sessions/{}/counts` (terminal ET personne, `@CounterAuth`),
// `POST /cash-sessions/{}/close` et `GET /cash-sessions/{}` (garde exclusive `TerminalOrPersonGuard`, chemin
// terminal : trois preuves ET `X-Staff-Authorization`, sans repli sur la personne seule).
//
// Pas d'amorçage : le terminal de la matrice est partagé avec les cas des paiements (mode d'application que
// l'on ne change pas), et la matrice ne juge que les PREUVES. Avec des preuves valides la route répond après
// la garde (`422 DEVICE_MODE_NOT_ALLOWED` à l'ouverture et au comptage, `404` sur une session inconnue) : un
// nonce consommé prouve que la garde réelle l'a servie. Le comportement métier (ouverture, comptage,
// fermeture, lecture) est prouvé en HTTPS réel par `test/integration/cash-sessions/*.spec.ts`.
import { randomUUID } from 'node:crypto';
import type { CaseFile, RouteCase } from './registry';

export const controllers: CaseFile['controllers'] = ['CashSessionsController'];

export function cases(): Record<string, RouteCase> {
  const sessionId = randomUUID();
  return {
    'POST /cash-sessions': {
      server: 'api',
      counter: true,
      path: () => '/cash-sessions',
      body: () => ({}),
      idempotencyKey: (c, who) => c.seqKey(who),
    },
    'POST /cash-sessions/{}/counts': {
      server: 'api',
      counter: true,
      path: () => `/cash-sessions/${sessionId}/counts`,
      body: () => ({ counted_amount: 1000, counted_at: new Date().toISOString() }),
      idempotencyKey: (c, who) => c.seqKey(who),
    },
    'POST /cash-sessions/{}/close': {
      server: 'api',
      counter: true,
      exclusive: 'person',
      path: () => `/cash-sessions/${sessionId}/close`,
      idempotencyKey: (c, who) => c.seqKey(who),
    },
    'GET /cash-sessions/{}': {
      server: 'api',
      counter: true,
      exclusive: 'person',
      path: () => `/cash-sessions/${sessionId}`,
    },
  };
}
