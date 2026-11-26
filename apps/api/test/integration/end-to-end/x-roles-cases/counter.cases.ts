// Cas de la matrice x-roles : counter (mission routes-backoffice, WP10 ; interfaces.md §3, research D3).
import type { XRolesCase } from './registry';

export const cases: XRolesCase[] = [
  { operationId: 'openCashSession', device: true },
  {
    operationId: 'countCashSession',
    device: true,
    note: 'Le comptage est joué sur la session du SECOND terminal : un comptage réussi du SUPERVISOR rendrait ensuite sa clôture de la session principale impossible (« le fermeur ne compte pas », CL041).',
    validBody: true,
    prepare: (fx) => ({
      method: 'POST',
      path: `/cash-sessions/${fx.ids.other_cash_session_id}/counts`,
      terminal: 'other',
    }),
  },
  {
    operationId: 'closeCashSession',
    refusals: [404],
    note: 'Une personne sans rôle de caisse sur l’événement de la session reçoit 404 (cash-sessions.service.ts, session hors de sa vue) : le serveur masque l’existence.',
  },
  {
    operationId: 'getCashSession',
    refusals: [404],
    note: 'Session hors de la vue de la personne : 404 (cash-session-read.service.ts, get) ; le serveur masque l’existence.',
  },
  { operationId: 'listCashSessions' },
  { operationId: 'createKycVerification' },
  { operationId: 'revokeKycVerification' },
];
