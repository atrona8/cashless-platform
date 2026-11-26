// Cas de la matrice x-roles : outbound-webhooks (mission routes-backoffice, WP10 ; interfaces.md §3, research D3).
import type { XRolesCase } from './registry';

export const cases: XRolesCase[] = [
  {
    operationId: 'createWebhookEndpoint',
    external: 'Sans route dans apps/api/src (DOUBTS_ACCEPTED) : x-roles absent, rien à jouer.',
  },
  {
    operationId: 'listWebhookEndpoints',
    external: 'Sans route dans apps/api/src (DOUBTS_ACCEPTED) : x-roles absent, rien à jouer.',
  },
  {
    operationId: 'deleteWebhookEndpoint',
    external: 'Sans route dans apps/api/src (DOUBTS_ACCEPTED) : x-roles absent, rien à jouer.',
  },
];
