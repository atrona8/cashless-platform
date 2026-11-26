# Relecture WP10, cycle 1 : à corriger

## Bloquant (décision du porteur du 25/11, après la livraison du lot)
Aligner `x-roles` sur le code pour les 3 dérives consignées, au lieu de les garder dans `knownDrifts` :
- retirer CASHIER de `listCashSessions`, OPERATOR_ADMIN de `setOrganizerOfflinePolicy` et de `setEventOfflinePolicy` dans `packages/contracts/openapi.yaml` ;
- recalculer les empreintes de `contract-baseline.json` et les types générés ;
- vider `knownDrifts` des cas (counter.cases.ts, offline.cases.ts) ;
- le test doit échouer si une dérive réapparaît (la matrice le fait déjà dès que `knownDrifts` est vide : rôle déclaré refusé pour droit).
Vérifier ensuite : roles.json/x-roles.test.mjs, contract-additions-9b, contract-baseline, la matrice.

## Constats de la relecture (rien d'autre de bloquant)
- Matrice rejouée : 1281 appels, 5 tests verts. Mutations rouges : retrait de SUPERVISOR dans la garde de closeCashSession (rôle déclaré refusé), élargissement à CASHIER/MERCHANT_ADMIN (rôle non déclaré non refusé), exemption x-roles élargie à tout `paths` (contract-additions-9b rouge).
- Aucune dérive inverse (rôle non déclaré admis).
- Suites contracts, architecture, production-guard, consignation, backoffice-isolation : 155 verts ; x-roles.test.mjs 16 verts ; eslint et tsc propres.
