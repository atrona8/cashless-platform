// Cas d'isolement des modèles de téléphone (WP09 ; D9). Table de plateforme, sans prestataire : la
// liste est la même pour tout administrateur autorisé (aucun objet d'un prestataire n'y figure). Le
// personnel d'un autre prestataire (B) reçoit donc `200` sur la lecture si son rôle l'y autorise
// (`selfScoped`), et `403` pour un rôle sans droit (SUPERVISOR, CASHIER). L'écriture est réservée à
// la plateforme : `403` pour tout le personnel de B.
import type { BackofficeIsolationCase } from './registry';

const PATH = '/phone-models/isolation-fabricant/isolation-modele';
const BODY = { nfc_level: 'TOLERATED', measured_at: '2026-11-20' };

export const cases: BackofficeIsolationCase[] = [
  {
    operationId: 'listPhoneModels',
    method: 'GET',
    path: () => '/phone-models',
    selfScoped: true,
    note:
      'Table de plateforme : 200 pour OPERATOR_ADMIN et ORGANIZER_ADMIN (aucune donnée de ' +
      'prestataire), refusée aux autres rôles.',
  },
  {
    operationId: 'upsertPhoneModel',
    method: 'PUT',
    path: () => PATH,
    body: () => BODY,
  },
  {
    operationId: 'deletePhoneModel',
    method: 'DELETE',
    path: () => PATH,
  },
];
