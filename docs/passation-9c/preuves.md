# Preuves de la mission 9c (`remboursement-partiel-especes-01M84932`)

Écrit par WP06 le 23/11/2026, **d'après les notes de lane et les comptes rendus de relecture de WP01 à WP05 et les messages
de commit** : aucun test n'a été relancé pour ce document, hors le garde de consignation de WP06 (voir la fin). Un résultat
absent d'une note est écrit « non établi ». La matrice d'acceptation (`acceptance-matrix.json` de la mission) est tenue par
l'orchestrateur, qui ajoutera la **batterie complète** ; ce tableau en est la source de commandes et de résultats. Chemins
`apps/api/test/...` abrégés en `api/...`, `packages/ledger-sql/tests/...` en `sql/...`.

Conventions. Jest : depuis `apps/api` de la lane, `SKIP_LATENCY=1 npx jest <chemin> --runInBand --forceExit` après
`export PGDATABASE=cashless_wpXX; source ../../tools/dev-db/env.sh`. pgTAP : depuis `packages/ledger-sql/` de la lane,
`pg_prove -d cashless_wpXX tests/<fichier>.sql`. Contrat : `node tools/contract-stability/check.mjs`. **pgTAP en CI de la
PR** (décision du porteur du 23/11/2026) : le résultat de CI n'est pas établi à la date de ce document.

## Résultats par lot (repris des notes)

| Lot | Commande | Résultat | Source |
|---|---|---|---|
| WP01 | `pg_prove -d cashless_wp01 tests/tests_cash_partial_refund.sql` | suites de droits (`execute_grants`, 9b, 10a, 11a) vertes, mutations des tests 3 à 8 (note de lane). Relecture de WP01, rapportée par l'orchestrateur : `tests_execute_grants` + `tests_cash_partial_refund` verts, 147 tests ; ce chiffre ne figure pas dans les notes de lane. Nombre de tests du fichier seul : non établi (`no_plan()`) | note de lane WP01 ; relecture WP01 rapportée par l'orchestrateur |
| WP02 | `node tools/contract-stability/check.mjs` ; `npx jest test/unit/contracts` | 84 admises, 0 refus ; 15/15 (`node --test` 42/0, d'après la note) | note WP02 |
| WP03 | `npx jest test/integration/configuration/partial-refund-settings.spec.ts` | 8/8 ; 97/97 avec cascade, events, architecture, contracts (note de lane). Relecture de WP03, rapportée par l'orchestrateur : 30/30 avec `cascade`, absent des notes de lane | note de lane WP03 ; relecture WP03 rapportée par l'orchestrateur |
| WP04 | `npx jest test/integration/media/partial-refund-threshold.spec.ts` | 11/11 sur `cashless_wp04` | note WP04 |
| WP05 | `npx jest test/integration/media/partial-cash-refund.spec.ts` ; `partial-cash-refund-concurrency.spec.ts` | 16/16 ; 3/3 sur `cashless_wp05` | note WP05 |
| Gardes transverses (WP05) | `architecture.spec.ts`, `production-guard.spec.ts`, `test/unit/contracts`, `invariants-cloture/consignation.spec.ts` | 147 tests verts | note WP05, confirmé à la relecture |

## Gardes transverses complétées au cycle 2 de WP05

La batterie du code intégré a trouvé trois gardes transverses sans cas pour `refundPartialCash`. Elles ont été complétées
**sans tolérance générale** (commit `cfa11861`, approbation de WP05 au cycle 2). Comptes rapportés par l'orchestrateur :
`device-auth-matrix` 13/13, `media-isolation` 6/6 (passé à 48 cas), `media-port-swap` 19/19, `claim-code-order` 18/18
lancé seul. Ces chiffres ne figurent pas dans les notes de lane de WP01 à WP05.

## Exigences fonctionnelles

| ID | Lot | Test | Résultat | Mutation (contrôle retiré, test qui échoue) |
|---|---|---|---|---|
| FR-001 | WP05 | `api/integration/media/partial-cash-refund.spec.ts` US1 (« solde 20 000, rendu de 5 000 avec 200 de frais », « tout le solde payé peut être rendu », `tap_id` ou `tap`) | 16/16 | seuil, réglage, politique et solde retirés : détectés (note WP05) |
| FR-002 | WP05 | idem, US1 (bracelet actif après le rendu) | 16/16 ; « paiement suivant accepté » : **test absent** (OP-N180), bracelet ACTIVE et solde relus seulement | non établie séparément |
| FR-003 | WP05 | idem, US1 (crédits offerts et caution intacts) | 16/16 | crédits offerts débités (PROMO_EXPIRY ajouté) : échec US1 |
| FR-004 | WP03 | `api/integration/configuration/partial-refund-settings.spec.ts` (« qui règle quoi », défauts) | 8/8 | M2 `cash_partial_refund_allowed` défaut `true` : 3 échecs ; M4 `setBy` `OPERATOR_ADMIN` retiré : 5 échecs |
| FR-005 | WP03, WP01 | `partial-refund-settings.spec.ts` (règle croisée, `LIVE` à deux personnes, autorisation retirée), `sql/tests_cash_partial_refund.sql` (colonne, défaut `false`, `NOT NULL`) | 8/8 ; pgTAP de WP01 : suites vertes, nombre de tests non établi | M1 règle croisée retirée : 2 échecs ; M3 défaut `true` : échec du test des défauts du catalogue ; WP01 défaut `true` : tests 4 et 5, nullable : tests 3 et 6 |
| FR-006 | WP05 | `partial-cash-refund.spec.ts` US2 (`422 REFUND_NOT_ALLOWED`, `reason` `PARTIAL_CASH_REFUND_DISABLED`) | 16/16 | autorisation du prestataire ignorée, activation ignorée, politique fermée ou sans CASH : détectées (note WP05) |
| FR-007 | WP04, WP05 | `api/integration/media/partial-refund-threshold.spec.ts` ; `partial-cash-refund.spec.ts` US3 (deux rendus, seuil exact, deux bracelets du même portefeuille) | 11/11 ; 16/16 | WP04 : `>=` au lieu de `>` 2 échecs ; marque ignorée 1 ; filtre portefeuille retiré 2 ; jour non borné 1 ; filtre grand livre retiré 1. WP05 : marque `partial_cash_refund` absente 4 échecs ; seuil `<=` devenu `<` détecté ; jeton non passé au seuil détecté |
| FR-008 | WP05 | `partial-cash-refund.spec.ts` US1 (200 de frais, espèces nettes) ; montant inférieur ou égal aux frais : `422 AMOUNT_OUT_OF_RANGE` | 16/16 | frais `>=` montant (`>` au lieu de `>=`) : détectée |
| FR-009 | WP05 | idem, US1 (bracelet anonyme) | 16/16 | non établie séparément |
| FR-010 | WP05 | `partial-cash-refund.spec.ts` SC-004 (comptage juste ferme sans écart) | 16/16 | non établie séparément |
| FR-011 | WP05 | idem, « rejeu de la même clé : même réponse, une seule sortie d'espèces » | 16/16 | non établie séparément |
| FR-012 | WP05 | idem, « pendant EDGE : 409 DEBIT_AUTHORITY_EDGE ; rien d'écrit » | 16/16 | EDGE retiré (test d'ordre sans session) : détecté ; la base refuse aussi (note WP05) |
| FR-013 | WP03, WP05 | réglages : `partial-refund-settings.spec.ts` (circuit `EVENT_SETTINGS_CHANGE` existant) ; rendu : valeur d'audit `MEDIA_PARTIAL_CASH_REFUNDED` (`audit.service.ts`) | 8/8 pour les réglages ; **non établi** : aucune note ne cite un test qui lit l'écriture d'audit d'un rendu partiel | non établie |

## Exigences non fonctionnelles

| ID | Lot | Test | Résultat | Mutation |
|---|---|---|---|---|
| NFR-001 | WP05 | `partial-cash-refund-concurrency.spec.ts` (latence) | p95 de 126 à 128 ms sur 50 rendus (p50 103, max 149), seuil 300 ms ; mesuré sur `cashless_wp05`, **non établi** sur un autre environnement | sans objet |
| NFR-002 | WP05 | `partial-cash-refund-concurrency.spec.ts` (deux tests de concurrence) | 3/3 : 20 envois de 1 000 sur un solde de 10 000 : exactement 10 rendus, somme rendue 10 000, cumul 10 000, 10 écritures ; 20 envois sur 2 bracelets du même portefeuille, maximum 5 000 : exactement 5 passent, 15 `403 APPROVAL_REQUIRED`, cumul 5 000 | verrou `lockWalletPaidBalance` retiré : détecté **4 fois sur 5** seulement (relecture), voir OP-N181 |
| NFR-003 | WP03, WP05 | `partial-refund-settings.spec.ts` (« isolation : un autre prestataire ne voit ni ne modifie rien ») ; `partial-cash-refund.spec.ts` (personne d'un autre prestataire : 404) ; `partial-refund-threshold.spec.ts` (autre portefeuille, autre grand livre exclus) | verts | non établie séparément |
| NFR-004 | WP01 | `sql/tests_cash_partial_refund.sql` (aucun droit de colonne ni de table ajouté), `sql/tests_execute_grants.sql` | suites de droits vertes (note WP01) ; 147 tests rapportés par l'orchestrateur pour la relecture de WP01, absents des notes de lane | `GRANT DELETE` sur `event` : échec du test 8 |

## Critères de réussite

| ID | Preuve | Résultat |
|---|---|---|
| SC-001 | `partial-cash-refund.spec.ts` US1 | vert pour le rendu et le bracelet gardé actif ; « paiement suivant avec le même bracelet » : **non établi** (OP-N180). « En un seul passage » : non établi hors test |
| SC-002 | `partial-cash-refund.spec.ts` US2 (« prestataire n'autorise pas ; événement non activé ; autorisation retirée après l'activation ») : aucune écriture | vert (16/16) |
| SC-003 | `partial-cash-refund.spec.ts` US3 (fractionnement, deux bracelets) ; `partial-refund-threshold.spec.ts` ; concurrence sur deux bracelets | vert (16/16, 11/11, 3/3) |
| SC-004 | `partial-cash-refund.spec.ts` SC-004 | vert (16/16) ; les « 0 écart sur un scénario de recette » relèvent de la mission 13 : non établi hors test |

## Contraintes

| ID | Preuve | Résultat |
|---|---|---|
| C-001 | `node tools/contract-stability/check.mjs` ; `api/unit/contracts/contract-additions-9b.spec.ts` ; `tools/contract-stability/check.test.mjs` | 84 admises, 0 refus ; 15/15 ; mutation : `PARTIAL_CASH_REFUND_DISABLED` ajouté à `ProblemCode.enum` : 2 tests de gel et `check.mjs` refusent ; relecture : opération fantôme, schéma fantôme, `required` : échecs |
| C-002 | aucune retouche de `release.service.ts` ni de `release.controller.ts` ; `partial-refund-threshold.spec.ts` (un `WALLET_REFUND` sans la marque est exclu du cumul) | **non établi par un test dédié** du guichet de retour inchangé ; gardes transverses 147 verts |
| C-003 | `git diff` de `docs/SPECIFICATION.md` : §8.5 et §17 amendés, ADR-233 ; ligne de version inchangée (« 1.2 — 2 octobre 2026 ») | établi par lecture du diff, aucun test |
| C-004 | notes de WP01 à WP05 et relectures : aucun écart qui affaiblit la sécurité ; renforcements consignés (ADR-233, ADR-234) | « aucun écart affaiblissant » affirmé par la note de WP05 ; **non établi** pour WP01 à WP04 par une phrase équivalente dans leurs notes |
| C-005 | route sans canal autre que `CASH` ; `partial-cash-refund.spec.ts` (politique sans canal `CASH` refusée) | **non établi par un test dédié** « ni mobile money, ni carte, ni virement » |

## Garde de consignation de WP06

`SKIP_LATENCY=1 npx jest test/integration/invariants-cloture/consignation.spec.ts --runInBand` : 57/57 verts sur
`cashless_wp06` (le 23/11/2026, relancé par WP06).
