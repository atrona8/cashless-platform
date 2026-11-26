// Cas d'isolement de `getStaffProfile` (WP05). La route ne désigne aucun objet : la personne de B reçoit son
// propre profil, sans aucune donnée de A (le balayage le vérifie : identifiants, nom affiché de A).
import type { BackofficeIsolationCase } from './registry';

export const cases: BackofficeIsolationCase[] = [
  {
    operationId: 'getStaffProfile',
    method: 'GET',
    path: () => '/staff/me',
    selfScoped: true,
    note: 'Route sans objet : 200 avec le seul profil de la personne appelante (jamais celui d’une personne de A).',
  },
];
