# Preuves de la mission 10a (`serveur-app-festivalier-01M7WB69`)

Écrit par WP11 le 23/11/2026, **d'après les notes de lane et les comptes rendus de relecture de WP01 à WP10 et les
messages de commit** : aucun test n'a été relancé pour ce document. Un résultat absent d'une note est écrit
« non établi ». La matrice d'acceptation (`kitty-specs/serveur-app-festivalier-01M7WB69/acceptance-matrix.json`) est
tenue par l'orchestrateur ; à ce jour elle contient encore les critères génériques (« pending ») : ce tableau en est la
source de commandes et de résultats. Chemins `apps/api/test/...` abrégés en `api/...`, `packages/ledger-sql/tests/...`
en `sql/...`.

Conventions. Jest : depuis `apps/api` de la lane, `SKIP_LATENCY=1 npx jest <chemin> --runInBand --forceExit` après
`export PGDATABASE=cashless_wpXX; source ../../tools/dev-db/env.sh`. pgTAP : depuis `packages/ledger-sql/` de la
lane, `pg_prove -d cashless_wpXX tests/<fichier>.sql`. Contrat : `node tools/contract-stability/check.mjs`. Hors passe
parallèle : `integration/cli/reissue-claim-codes.spec.ts` et `integration/media/claim-rotation.spec.ts` sont ignorés
quand `SKIP_LATENCY` est posé (`jest.config.cjs`) : les lancer sans cette variable, seuls.

## Exigences fonctionnelles

| ID | Lot | Test | Commande | Résultat | Mutation (contrôle retiré, test qui échoue) |
|---|---|---|---|---|---|
| FR-001 | WP01, WP05 | `sql/tests_kyc_functions.sql`, `api/integration/kyc/create.spec.ts` | `pg_prove -d cashless_wp01 tests/tests_kyc_functions.sql` ; `npx jest test/integration/kyc test/unit/errors/sqlstate-map.spec.ts --runInBand` | WP01 : 63/63 pgTAP à la relecture ; WP05 : 171 verts sur `cashless_wp05` (kyc + sqlstate-map), 230 à la relecture | WP05 (a) `exercisedRole` retiré : 2 tests ; (d) `agent_id` lu du corps : test 400 ; (e) `Idempotent` retiré : le rejeu échoue |
| FR-002 | WP01, WP05 | idem (`422 ACCOUNT_REQUIRED`, `CL060`) | idem | idem | WP01 (c1, c2, c4, c3) : portefeuille, révocation, client, identité sans filtre d'opérateur, tous détectés |
| FR-003 | WP01, WP05 | idem (`403`, `CL061`), `sql/tests_kyc_functions.sql` section 9 | idem | idem | WP01 (a) `CL061` retiré, (e) comparaison sans filtre client : échouent ; WP05 (b) `CL061` retiré : 3 tests |
| FR-004 | WP04 | `sql/tests_10a_rights.sql`, `sql/tests_execute_grants.sql` | `pg_prove -d cashless_wp04 tests/tests_10a_rights.sql` | 78 tests ; relecture : droits catalogue, rejeu x2 idempotent, 8 suites pgTAP, 2 Jest | WP04 (a) à (e) : échecs aux tests 4/6/20, 10/23, 44/58/65, 12/13/27-32, 4/6/7/20 |
| FR-005 | WP06 | `api/integration/kyc/revoke.spec.ts` | `npx jest test/integration/kyc/revoke.spec.ts --runInBand` | 12/12 sur `cashless_wp06` ; relecture : 26 tests kyc + 22 approval verts, `check.mjs` 0 refus | WP06 (a) contrôle `REVOKED` retiré : test 6 ; (b) `approvedBy` au lieu de `requestedBy` : 3 tests ; (c) `CASHIER` ajouté aux rôles : 2 ; (d) contrôle `target_id` retiré : test de falsification |
| FR-006 | WP01, WP06 | `api/integration/kyc/limits.spec.ts`, `revoke.spec.ts` (« plafonds après révocation »), `sql/tests_kyc_functions.sql` | `npx jest test/integration/kyc --runInBand` | verts (compris dans les 171 de WP05 et les 12/12 de WP06) | WP01 (b) expiration retirée : échec ; WP06 (commit `3bb7613b`) révocation non exécutée : 5 tests échouent |
| FR-007 | WP02, WP07 | `api/integration/media/claim-rotation.spec.ts`, `sql/tests_claim_key_version.sql` | `npx jest test/integration/media/claim-rotation.spec.ts --runInBand` (sans `SKIP_LATENCY`) ; `pg_prove -d cashless_wp02 tests/tests_claim_key_version.sql` | pgTAP : 125 ok (commit `24f594d7`) ; Jest : vert à la relecture de WP07 (nombre non noté : non établi) | WP02 (a) 19/21/23, (b) 28-30, (c) 33, (d) 36-38, (e) erreur `23505`, (f) 84 ; WP07 (a) retrait de `AND claim_key_version` de `confirm`, (b) `1` en dur à `claim_media`, (c) `assertClaimKeyVersion` retiré, (d) refus sans version, (e) `toUpperCase` retiré, (f) `1` en dur à `public_balance_lookup` : toutes échouent |
| FR-008 | WP02, WP08 | `api/integration/cli/reissue-claim-codes.spec.ts` (« SC-003 »), `sql/tests_claim_key_version.sql` | `npx jest test/integration/cli/reissue-claim-codes.spec.ts --runInBand` (sans `SKIP_LATENCY`) | 12/12 sur `cashless_wp08` | WP08 : fichier écrit après la base, `wx` retiré, mode `0644`, codes sur la sortie standard, UID permutés : tous détectés |
| FR-009 | WP02, WP09 | `api/integration/customer-app/me-10a.spec.ts`, `claim-rotation.spec.ts` (« numéro imprimé »), `sql/tests_claim_key_version.sql` | `npx jest test/integration/customer-app/me-10a.spec.ts --runInBand` | vert à la relecture de WP09 (nombre non noté : non établi) | WP09 `printed_number = null` : 2 tests échouent |
| FR-010 | WP03, WP09 | `sql/tests_pending_offline_notice.sql`, `me-10a.spec.ts` | `pg_prove -d cashless_wp03 tests/tests_pending_offline_notice.sql` | WP03 : suites 0048/0080/snapshots/definer_search_path et les deux suites WP03 vertes (293 tests au total sur `cashless_wp03`) | WP03 (a) `status<>REVOKED` retiré : test 9 ; (b) `>=` : test 6, sans `coalesce` : 2, 10, 13, 16 ; (c) `status<>CLOSED` retiré : test 12 ; cycle 2 : filtre de grand livre retiré : test 14, `scope_type` retiré : test 16 ; WP09 `notice = false` : 2 tests |
| FR-011 | WP10 | `api/unit/customer-auth/otp-chain.spec.ts`, `api/integration/customer-auth/otp-chain.spec.ts` | `npx jest test/unit/customer-auth --runInBand` ; `npx jest test/integration/customer-auth/otp-chain.spec.ts --runInBand` | unitaires 19/19 ; intégration 5/5 (50/50 sur le dossier `customer-auth` ; un échec isolé au premier passage, vert à la relance : instabilité consignée, OP-N166) | WP10 (a) confirmation sans effacement, (b) délais échangés, (d) borne retirée, (c), (e), (f), (h) retrait de `arm(entry, OTP_CODE_HARD_CAP_MS, …)` : 1 échec sur 19 |
| FR-012 | WP10 | `otp-chain.spec.ts` unitaire (4. canal SMS) et intégration (« canal SMS : aucun essai WhatsApp ») | idem | idem | non établie séparément |
| FR-013 | WP03, WP10 | `otp-chain.spec.ts` (5. même code aux trois étapes ; intégration « les bascules ne comptent pas dans les limites »), `sql/tests_otp_channel_attempt.sql` | idem ; `pg_prove -d cashless_wp03 tests/tests_otp_channel_attempt.sql` | idem ; pgTAP vert (nombre non noté : non établi) | WP03 (d) `NO FORCE RLS` : test 4 ; (e) `CHECK failed_reason` retiré : tests 12-17 et 21 |

## Exigences non fonctionnelles

| ID | Lot | Test | Commande | Résultat | Mutation |
|---|---|---|---|---|---|
| NFR-001 | WP10 | `otp-chain.spec.ts` unitaire (2. SMS principal à 10 000 ms, repli à +20 000 ms) et intégration (« 202 immédiat, trois essais, un code ») | `npx jest test/unit/customer-auth --runInBand` | **minuteries simulées seulement** : SMS principal à 10 000 ms, repli à +20 000 ms, plafond à 35 000 ms ; **aucune mesure réelle** (faux fournisseurs) : mesure réelle non établie, reportée en 12b et 13 | WP10 (b) délais échangés : échoue |
| NFR-002 | WP07, WP08, WP10 | `claim-rotation.spec.ts` (« NFR-002 : aucun code en clair dans l'audit, l'idempotence ni les tables »), `reissue-claim-codes.spec.ts` (« aucun code ailleurs que dans le fichier »), `otp-chain.spec.ts` unitaire 9 et 10 | idem | verts à la relecture de WP07, WP08, WP10 | WP07 : mutation audit échoue ; WP08 : codes sur la sortie standard (4 tests) |
| NFR-003 | WP01 | `sql/tests_kyc_functions.sql`, `create.spec.ts` (ligne lue en base) | idem | **non établie par un test dédié** « 0 champ supplémentaire » : la fonction n'écrit que type, pays, 4 derniers caractères, expiration (colonnes de la table existante) ; à confirmer par la revue | non établie |
| NFR-004 | WP09 | `api/integration/customer-app/me-10a.spec.ts` (« NFR-004 : p95 de getMe et listMyWallets < … ms », 5 portefeuilles) | `npx jest test/integration/customer-app/me-10a.spec.ts --runInBand` | p95 : `getMe` 24 ms, `listMyWallets` 51 ms (implémentation) ; 26 ms et 73 ms (relecture) ; seuil 300 ms | EXPLAIN WP03 : 2 000 accusés, index only scan `offline_batch`, 0,07 ms |
| NFR-005 | WP10 | `api/unit/customer-auth/otp-chain.spec.ts` (11. les trois faux refusent), `apps/gateway/test/e2e/production-refusals.spec.ts`, `api/unit/production-guard.spec.ts` | `npx jest -c test/e2e/jest.e2e.config.cjs production-refusals` depuis `apps/gateway` | refus en production 35/35 (relecture de WP10, `cashless_wp10`) ; libellés exacts de `bootstrap.ts` vérifiés | WP10 : trois fabriques et libellés gardés dans `bootstrap.ts` et `COVERAGE` |

## Critères de réussite

| ID | Preuve | Résultat |
|---|---|---|
| SC-001 | `integration/kyc/limits.spec.ts` : recharge de 5 000, `422 WALLET_LIMIT_EXCEEDED` avant, `201` après l'identification par le caissier | vert (WP05) ; les « 100 % des essais de recette » relèvent de la mission 13 : non établi hors test |
| SC-002 | `sql/tests_kyc_functions.sql` (portefeuille anonyme, agent titulaire : rien d'écrit), `create.spec.ts` (« rien d'écrit ») | vert (WP01, WP05) |
| SC-003 | `reissue-claim-codes.spec.ts` « SC-003 : rotation, ancien code refusé, réémission, import du fichier, nouveau code accepté » ; `claim-rotation.spec.ts` | 12/12 (WP08) ; mutation UID permutés : échec du test SC-003 |
| SC-004 | `me-10a.spec.ts` « pending_offline_notice : faux, vrai après un accusé sans lot, faux après la remontée (SC-004) » et « GET /me/media et /me/wallets : numéro imprimé » | vert (WP09) |
| SC-005 | `otp-chain.spec.ts` intégration « WhatsApp et SMS principal muets, repli qui confirme » | 5/5 (WP10) ; délais en minuteries simulées (voir NFR-001) |

## Contraintes

| ID | Preuve | Résultat |
|---|---|---|
| C-001 | `node tools/contract-stability/check.mjs` (quatre entrées de `contract-baseline.json`, ADR-225) ; `tools/contract-stability/check.test.mjs` | 0 refus (WP05, WP06, WP09) ; `check.test.mjs` 71 à 75 ; mutation : empreinte de description modifiée, le pointeur est refusé |
| C-002 | `revoke.spec.ts` (« l'auteur ne valide pas sa demande ») ; OP-N164 ; ADR-227 | vert ; SPECIFICATION §6.3 point 5 amendé le 23/11/2026 (décision du porteur), OP-N164 levé |
| C-003 | `integration/customer-auth/otp-chain.spec.ts` (« un fournisseur non factice : aucun en-tête X-Test-Otp-Code »), `production-refusals.spec.ts` | 5/5, 35/35 |
| C-004 | OP-N163 à OP-N169, ADR-225 à ADR-231, reports dans `PROMPTS-A-ENVOYER.md` et `PRD.md` | consignés par WP11 |
| C-005 | `sql/tests_kyc_functions.sql` section 9 (agent sans numéro accepté, autre numéro accepté, numéro du client refusé, client d'un autre prestataire accepté), `create.spec.ts` (« limite C-005 : agent sans numéro, 201 ») | verts (WP01, WP05) ; échouent si la règle s'élargit ou se resserre |
| C-006 | aucun test (plafonds du Sénégal provisoires, §6.5, ADR-48) | sans objet pour le code ; non présentés comme validés |
| C-007 | aucun `.sql` généré de `packages/ledger-sql/` modifié : seuls `post-roles.sql` et `src/migrate.ts` (écrits à la main) changent en dehors de `migrations/` et `tests/` | vérifié par `git diff --name-only` contre `main` (WP11) |

## Preuves non établies, à signaler

- Nombre exact de cas de `claim-rotation.spec.ts` et de `me-10a.spec.ts` ; d'assertions de `tests_pending_offline_notice.sql`,
  `tests_otp_channel_attempt.sql` : les notes ne les donnent pas.
- **NFR-001 et SC-005 en conditions réelles** : minuteries simulées seulement ; passe réelle en mission 12b puis 13.
- **NFR-003** : pas de test dédié.
- **Disque plein (`ENOSPC`) et `COMMIT` d'issue incertaine** de `reissue-claim-codes` : traités par le code, jamais
  exercés (OP-N167). Course `CL065` : non testée (OP-N169).
- Batterie finale de l'orchestrateur et matrice d'acceptation : non disponibles pour ce document.
