// Cas de la matrice x-roles : events (mission routes-backoffice, WP10 ; interfaces.md §3, research D3).
import type { XRolesCase } from './registry';

export const cases: XRolesCase[] = [
  { operationId: 'getEventPspSelections' },
  { operationId: 'setEventPspSelection' },
  { operationId: 'listEvents' },
  { operationId: 'createEvent' },
  { operationId: 'getEvent' },
  { operationId: 'updateEvent' },
  { operationId: 'getEventStatusConditions' },
  { operationId: 'transitionEventStatus' },
  { operationId: 'listParticipations' },
  { operationId: 'createParticipation' },
  { operationId: 'getParticipation' },
  { operationId: 'updateParticipation' },
  { operationId: 'listPointsOfSale' },
  { operationId: 'createPointOfSale' },
  { operationId: 'getPointOfSale' },
  { operationId: 'renamePointOfSale' },
  { operationId: 'listEventClosingSteps' },
  { operationId: 'previewEventClosingStep' },
  { operationId: 'executeEventClosingStep' },
  { operationId: 'getEventRemainingBalances' },
  {
    operationId: 'getPartyStatement',
    note: 'Les rôles admis dépendent de la nature de partie (party-statement-scope.ts, STATEMENT_ROLES) : PLATFORM_ADMIN lit PLATFORM, MERCHANT_ADMIN lit MERCHANT (son commerçant), les autres ORGANIZER.',
    prepare: (fx, role) => {
      const kind =
        role === 'PLATFORM_ADMIN'
          ? 'PLATFORM'
          : role === 'MERCHANT_ADMIN'
            ? 'MERCHANT'
            : 'ORGANIZER';
      const party =
        kind === 'MERCHANT'
          ? `?party_id=${fx.ids.merchant_id}`
          : kind === 'ORGANIZER'
            ? `?party_id=${fx.ids.organizer_id}`
            : '';
      return {
        method: 'GET',
        path: `/operators/${fx.ids.operator_id}/events/${fx.ids.event_id}/statements/${kind}${party}`,
      };
    },
  },
];
