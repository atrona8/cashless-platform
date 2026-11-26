// Cas de la matrice x-roles : payment-intents (mission routes-backoffice, WP10 ; interfaces.md §3, research D3).
import type { XRolesCase } from './registry';

export const cases: XRolesCase[] = [
  {
    operationId: 'createPaymentIntent',
    external: 'Sans route dans apps/api/src (DOUBTS_ACCEPTED) : x-roles absent, rien à jouer.',
  },
  {
    operationId: 'getPaymentIntent',
    external: 'Sans route dans apps/api/src (DOUBTS_ACCEPTED) : x-roles absent, rien à jouer.',
  },
  {
    operationId: 'capturePaymentIntent',
    external: 'Sans route dans apps/api/src (DOUBTS_ACCEPTED) : x-roles absent, rien à jouer.',
  },
  {
    operationId: 'cancelPaymentIntent',
    external: 'Sans route dans apps/api/src (DOUBTS_ACCEPTED) : x-roles absent, rien à jouer.',
  },
  {
    operationId: 'listDevicePaymentIntents',
    external: 'Sans route dans apps/api/src (DOUBTS_ACCEPTED) : x-roles absent, rien à jouer.',
  },
];
