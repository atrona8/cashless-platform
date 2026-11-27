// Seul endroit qui autorise un service réel en production (décisions du porteur D3 et D6, 26/11/2026). La liste
// est dans le code : aucune variable d'environnement, aucun réglage, aucun fichier lu au démarrage ne la modifie.
//
// Elle commence VIDE : en production, un adaptateur réel qui n'y figure pas est refusé (PSP et coffre : indisponibles ;
// service de clés et copie des scellements : démarrage refusé, `UntriedInProductionError`).
//
// Pour y ajouter un service :
//   1. lancer la commande d'essai contre le vrai service (`npm run essai -w @cashless/api -- <service>`) ;
//   2. commiter son compte rendu, sans secret, dans `docs/essais/<service>.json` (forme : docs/essais/README.md) ;
//   3. ajouter le nom ci-dessous, dans la même PR, et mettre à jour `production-enabled.spec.ts` ;
//   4. faire relire la PR par une personne (l'agent qui écrit le code ne vaut pas relecture indépendante).
// `production-enabled.spec.ts` échoue si un service listé n'a pas de compte rendu réussi.
import type { ExternalService } from './services';

export const PRODUCTION_ENABLED_SERVICES: readonly ExternalService[] = [];

export function isEnabledInProduction(
  service: ExternalService,
  enabled: readonly ExternalService[] = PRODUCTION_ENABLED_SERVICES,
): boolean {
  return enabled.includes(service);
}
