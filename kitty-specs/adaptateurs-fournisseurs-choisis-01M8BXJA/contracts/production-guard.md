# Contrat — garde de production, sélection, essais (IC-08)

1. `apps/api/src/external-services/production-enabled.ts` est le **seul** endroit qui autorise un service réel en
   production. Il commence vide. L'ajout d'un service se fait par une PR relue qui joint le compte rendu de son essai
   (D6), et le compte rendu est commité dans `docs/essais/<service>.json`. Un test échoue si un service listé n'a pas
   de compte rendu réussi, si un nom est inconnu, ou si un service hors périmètre est listé (règle 3 du porteur).
2. Chaque fabrique (PSP, coffre, KMS, copie des scellements) lit son réglage (`fake` | `real`) :
   - hors production : `fake` par défaut, `real` permis (bac à sable, préproduction) ;
   - production : réglage absent = `real` ; `fake` posé explicitement → `FakeInProductionError` ; `real` hors liste :
     PSP → fournisseur absent du registre (503/404) et coffre → indisponible, démarrage permis (comportement actuel) ;
     KMS et copie des scellements → `UntriedInProductionError` nommant le service (refus de démarrer, comme le faux
     aujourd'hui).
3. `assertNoFakeInProduction` reconnaît aussi un adaptateur `isTried === false` (même refus, autre message).
4. `production-refusals.spec.ts` : `COVERAGE` complété (Wave, PayDunya, Stripe, coffre, KMS, copie des scellements,
   réels non essayés).
5. Commande d'essai : `npm run essai -w @cashless/api -- <service> [--sandbox]` ; refusée si `NODE_ENV=production` ;
   lit les identifiants par les mêmes réglages que le processus ; rend un compte rendu JSON sans secret et un code de
   sortie 0 / 1.
