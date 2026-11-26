# Preuves de la mission 11b (`routes-backoffice-01M86KT6`)

Écrit par WP11 le 25/11/2026, **d'après les notes de lane de WP01 à WP10 (journal d'états de la mission, `status.events.jsonl`,
cité « note WPxx »), les comptes rendus de relecture (`tasks/WPxx-*/review-cycle-N.md`, cité « relecture WPxx ») et les
décisions du porteur** : aucun test de lot n'a été relancé pour ce document. Seuls les gardes du §« Relancé par WP11 » l'ont été.
Un chiffre qu'aucune note n'établit est écrit « non établi ». La matrice d'acceptation (`acceptance-matrix.json` de la mission)
est tenue par l'orchestrateur, qui ajoutera la **batterie complète** ; ce tableau en est la source de commandes et de résultats.
Chemins `apps/api/test/...` abrégés en `api/...`, `packages/ledger-sql/tests/...` en `sql/...`, `api/.../backoffice/` en `bo/`.

Conventions. Jest : depuis `apps/api` de la lane, `SKIP_LATENCY=1 npx jest <chemin> --runInBand --forceExit` après
`export PGDATABASE=cashless_wpXX; source ../../tools/dev-db/env.sh` (toutes les `DATABASE_URL_*` vers la base du lot). pgTAP :
depuis `packages/ledger-sql/` de la lane, `pg_prove -d cashless_wpXX tests/<fichier>.sql`. Contrat : `node
tools/contract-stability/check.mjs`. **pgTAP en CI de la PR** (décision du porteur) : le résultat de CI n'est pas établi à la date
de ce document. Les mesures de latence sont lancées **sans** `SKIP_LATENCY`.

## Résultats par lot (repris des notes)

| Lot | Commande | Résultat | Source |
|---|---|---|---|
| WP01 (`b0268aa2`, `81e4f2d2`) | `pg_prove -d cashless_wp01 tests/tests_backoffice_writes.sql` | 68 tests verts ; relecture : relancé sur `cashless_wp01r` avec `tests_execute_grants`, `tests_offline_rights`, `tests_definer_search_path`, `tests_definer_trigger_writers`, `tests_default_acl` et 12 suites des fonctions qui clôturent une anomalie, verts | note WP01, relecture WP01 |
| WP02 (`997c8a2e`) | `pg_prove -d cashless_wp02 tests/tests_backoffice_read_views.sql` | 42 tests, relancés par le relecteur, verts, avec les gardes de droits | note WP02, matrice d'acceptation |
| WP03 (`8515ada6`) | `node tools/contract-stability/check.mjs` ; `node --test tools/contract-stability` ; `npx jest test/unit/contracts` | 116 admises, 0 refus ; 42/42 ; 16/16 | note WP03 |
| WP04 | idem, après `x-roles` | 310 admises (`check.test.mjs` « T11 bis » 116 → 310) ; 226 opérations annotées, 8 sans `x-roles` ; état final de `contract-baseline.json` : 310 admises = 84 d'avant + 226 nouvelles (32 de WP03 : 10 chemins, 18 schémas, 4 propriétés ; 194 extensions `x-roles`) ; empreintes recalculées : 20 des 84 entrées d'avant et 11 des 32 de WP03 (comparaison des commits `9645bbd6`, `8515ada6` et de la lane k par script ; les notes de lane de WP04 donnent « 31 » puis « 32 remplacées » à des états intermédiaires) | notes WP04 (cycles 1 et 2) |
| WP05 (`bb997480`) | `npx jest test/integration/backoffice/staff-profile.spec.ts test/integration/end-to-end/backoffice-isolation.spec.ts` | `staff-profile.spec.ts` : 14 tests ; `media-isolation.spec.ts` : 48 tests inchangés ; verts | relecture WP05 (cycle 1), note WP05 |
| WP06 (`b9d8ac16`) | `npx jest test/integration/backoffice/sales.spec.ts` ; `sales-pagination.spec.ts` ; `PGDATABASE=cashless_wp06 npx jest test/integration/backoffice/sales-latency.spec.ts --runInBand --forceExit` | `sales.spec.ts` 16/16 ; `sales-latency.spec.ts` 8/8, deux fois | relecture WP06 (cycle 3), note WP06 (cycle 3) |
| WP07 (`ff942a71`) | `npx jest test/integration/backoffice/anomalies*.spec.ts` | 37 tests verts sur `cashless_wp07r`, gardes transverses vertes | relecture WP07 (note d'approbation) |
| WP08 (`3a21cc8c`) | `npx jest test/integration/backoffice/search*.spec.ts test/unit/config` | 172 tests verts (lot et configuration) sur `cashless_wp08` | relecture WP08 (note d'approbation) |
| WP09 (`4cdf30a2`) | `npx jest test/integration/backoffice/phone-models*.spec.ts` et gardes | cycle 1 : 300 tests verts (gardes comprises) ; cycle 2 : 96 tests verts, diff limité aux trois points | notes d'approbation WP09 (cycles 1 et 2) |
| WP10 (`f89e9407`) | `npx jest test/integration/end-to-end/x-roles-matrix.spec.ts --runInBand` | 5 tests verts ; 1 281 appels en série, ~25 s, sur `cashless_wp10` ; `test/unit/contracts` 17 ; `node --test` 53 ; `check.mjs` 0 refusée | notes WP10 (cycle 1 et 2) |
| Gardes transverses (relectures) | `architecture.spec.ts`, `production-guard.spec.ts`, `test/unit/contracts`, `consignation.spec.ts`, `backoffice-isolation.spec.ts`, `media-isolation.spec.ts`, `device-auth-matrix.spec.ts` | verts à chaque relecture (par ex. WP06 cycle 3 : 6 suites, 160 tests ; WP10 cycle 1 : 155 tests) | relectures WP06, WP08, WP10 |

## Par exigence

| Exigence | Test | Base et résultat | Mutation (relecture ou note) | Source |
|---|---|---|---|---|
| FR-001, FR-002 (profil, réservé au personnel) | `bo/staff-profile.spec.ts` ; jeton festivalier et jeton terminal refusés (garde globale, 401) | `cashless_wp05` ; verts | `WHERE id = $1` remplacé par une autre ligne du même prestataire : 2 échecs ; forme neutre de la détection des routes servies : 1 échec | note WP05 (cycle 2) |
| FR-003 (`x-roles` sur chaque opération) | `tools/contract-stability/x-roles/x-roles.test.mjs`, ajouté à `check:stability` et à `ledger-tests.yml` | 226 annotées, 8 sans (`DOUBTS_ACCEPTED`, OP-N188) ; `node --test` 53 | retrait de `x-roles`, ADMIN, tableau vide, doublon, rôles de `upsertPhoneModel`, valeur modifiée, entrée de référence retirée : toutes échouent | notes WP04, WP10 |
| FR-004 (rôles déclarés fidèles) | `end-to-end/x-roles-matrix.spec.ts` | 1 281 appels, 186 opérations jouées, 7 rôles du personnel ; 3 dérives alignées sur le code ; aucune dérive inverse | rôle retiré de la garde de `closeCashSession` : rouge ; garde élargie à `CASHIER` ou `MERCHANT_ADMIN` : rouge ; `CASHIER` remis dans `listCashSessions` : rouge ; exemption `x-roles` élargie à tout `paths` : `contract-additions-9b.spec.ts` rouge | notes WP10 (cycle 1 et 2), relecture WP10 |
| FR-005, FR-006, FR-007 (ventes) | `bo/sales.spec.ts`, `sales-pagination.spec.ts` | 16/16 ; commerçant limité à ses ventes (test « commerçant : ne voit que ses ventes ») | portée retirée : le test du commerçant échoue ; curseur `>` : 4 échecs ; curseur en ms : 3 échecs ; filtre `channel IS NOT NULL` retiré : 6 rouges ; détail non attribué : 1 rouge ; `<` en `<=` du chemin rapide : 2 rouges | notes WP06, relectures WP06 (cycles 3, 4) |
| FR-008, FR-009, FR-010 (anomalies, classement) | `bo/anomalies.spec.ts`, `anomalies-classification.spec.ts`, `anomalies-concurrency.spec.ts` ; `sql/tests_backoffice_writes.sql` | 37 tests ; 68 pgTAP ; dix classements simultanés : un 200, neuf 409 | portée retirée : 5 échecs ; `CL067` retiré : 3 ; `UPDATE` direct : 20 ; auteur lu d'un en-tête : 1 ; audit retiré : 13 ; garde retirée : balayage échoue ; `REVOKE` retiré de `post-roles.sql` : 4 échecs pgTAP | note WP07, relecture WP01 |
| FR-011, FR-012 (recherche bracelet, portefeuille) | `bo/search.spec.ts` | verts (172 tests du lot) | portée festivalier retirée : 2 rouges ; portée bracelet retirée : 1 rouge | relecture WP08 |
| FR-013, FR-014 (recherche par numéro, débit, audit) | `bo/search-customer.spec.ts`, `search-rate-limit.spec.ts` | 21e recherche : `429` avec `Retry-After` ; `PLATFORM_ADMIN`, `CASHIER`, `VENDOR`, `MERCHANT_ADMIN` : 403 sans ligne d'audit ; `PLATFORM_ADMIN` rattaché à un prestataire : 403 sans audit (ajouté le 25/11 ; `PLATFORM_ADMIN` ajouté à `CUSTOMER_ROLES` : rouge) | numéro en audit : rouge ; audit retiré : 4 rouges ; seuil `>` au lieu de `>=` ; comptage hors auteur ; E.164 relâché (préfixe) ; `CASHIER` admis : toutes détectées | note WP08, relecture WP08 |
| FR-015, FR-016 (modèles, niveau NFC) | `bo/phone-models.spec.ts`, `phone-models-devices.spec.ts` ; `sql/tests_backoffice_writes.sql` | verts (96 au cycle 2) | écriture directe : 5 échecs ; valeur invalide refusée : 2 ; jointure sans normalisation : 1 ; `reader(['OPERATOR_ADMIN'])` au `PUT` : 1 ; `throw` dans le `catch` de `declareDeviceModel` : 1 ; `warn` retiré : 1 | notes WP09 (cycles 1 et 2) |
| FR-017 (cloisonnement), NFR-003, SC-003 | `end-to-end/backoffice-isolation.spec.ts` (registre `backoffice-isolation-cases/`, un cas par opération) | verts ; 11 opérations servies avec cas | cas retiré : le balayage échoue (WP05, WP06, WP07, WP09, WP08) ; liste des ventes sans filtre : aucun identifiant de A dans le `404` (`sales.spec.ts`, « hors portée : 404 », ajouté le 25/11 : détail d'erreur qui rend un identifiant de A : rouge) ; chemin rapide `REVERSED` : `sales-pagination.spec.ts`, « deux événements du même prestataire » (retrait de `t.event_id = $1` de la CTE : rouge) ; OP-N194 levé | notes WP05 à WP09 |
| FR-018 (traçabilité) | `ANOMALY_CLASSIFIED`, `PHONE_MODEL_UPSERTED`, `PHONE_MODEL_DELETED`, `STAFF_CUSTOMER_SEARCH` testés dans `anomalies-classification.spec.ts`, `phone-models.spec.ts`, `search-customer.spec.ts` (« SC-004 : chaque recherche laisse une trace, sans le numéro, même à 0 résultat ») | verts | audit retiré : 13 rouges (WP07), 4 rouges (WP08) | notes WP07, WP08 |
| NFR-001 (500 ms p95 sur 200 000 ventes) | `bo/sales-latency.spec.ts` ; `bo/search.spec.ts` (« NFR-001 : p95 < 500 ms sur la recherche d'un bracelet avec 200 000 bracelets ») | **Ventes** (route HTTP, 200 000 ventes, 50 appels, base remise à zéro avant chaque passage) : `REVERSED` 35,6 / 37,6 / 40,7 ms sur trois passages (charge machine 5,3 / 5,1 / 4,6), autres scénarios au plus 52,6 ms ; la relecture a mesuré 37,6 ms (charge 2,2) puis **160 ms** à un deuxième passage (charge 2,5, autres sondes aussi multipliées par 3) : sous 500 ms mais variable. **Recherche** : `searchMedia` p95 30 ms sur 200 000 bracelets. **Vues** (WP02, SQL, 200 000 ventes) : page 1 de 297 à 7 ms, annulées de 603 à 305 ms avant le chemin rapide. **Non établi** : `listAnomalies`, `getWalletOverview`, `searchCustomerByPhone` (OP-N195) | index retiré : Seq Scan, annulées 603 ms > 500 (note WP02) ; mesures `docs/passation-11b/mesures-wp02/` | notes WP02, WP06 (cycle 3), WP08, relecture WP06 (cycle 3) |
| NFR-002 (pages bornées, 1 000 ventes) | `bo/sales-pagination.spec.ts`, « 1 000 ventes à limit=200 : 0 écart (NFR-002) » ; « limit=7 : 120 ventes parcourues sans doublon ni oubli » | verts | curseur `>` : 4 échecs ; curseur en ms : 3 échecs | note WP06, relecture WP06 |
| NFR-004 (débit de la recherche par numéro) | `bo/search-rate-limit.spec.ts` | 20 passent, la 21e rend 429 ; une autre personne passe | seuil `>` au lieu de `>=` : détectée | note WP08 |
| NFR-005 (aucun droit élargi sans décision) | `sql/tests_execute_grants.sql`, `tests_offline_rights.sql`, `tests_payment_rights.sql`, `tests_definer_search_path.sql` ; `bo/phone-models.spec.ts` (« cashless_app : ni INSERT, ni UPDATE, ni DELETE sur phone_model ») ; `bo/anomalies-classification.spec.ts` (bloc « D4 ») | verts. **Droits nouveaux nommés dans ADR-235** : ils existent (`EXECUTE`, `SELECT`), décidés par D5 et D9 | `REVOKE` de `post-roles.sql` retiré : 4 échecs ; `s16` retiré : tests de droits échouent | notes WP01, WP02, relecture WP01 |
| NFR-006 (minimisation) | `bo/search-customer.spec.ts` « NFR-006 » ; `bo/sales.spec.ts` « minimisation » ; `anomalies.spec.ts` « seuls les champs du contrat sortent » | verts | numéro en audit : détecté (note WP08) ; clé `wallet_id` ajoutée à `SaleSummary` : 2 échecs ; courriel renvoyé : 2 échecs | notes WP05, WP06, WP08 |
| SC-001 (parcours complet par le contrat) | les 11 opérations servies, `x-process: public`, toutes dans le registre d'isolement | non joué de bout en bout par un seul test : **non établi** comme parcours unique ; chaque étape est couverte par les lignes ci-dessus | — | — |
| SC-002 (100 % `x-roles`, fidélité) | `x-roles.test.mjs`, `x-roles-matrix.spec.ts` | 226 opérations annotées ; 8 `DOUBTS_ACCEPTED` sans `x-roles` (décision du porteur) ; total d'opérations du contrat : non établi par les notes | retrait d'un rôle d'une garde : rouge | notes WP04, WP10 |
| SC-004 (grand livre inchangé, 100 % des recherches tracées) | `bo/anomalies-classification.spec.ts` (compte les écritures du grand livre de A avant et après le classement) ; `bo/sales.spec.ts` « aucune écriture : les ventes et leurs postings sont inchangés » ; `search-customer.spec.ts` | verts | `UPDATE` direct et audit retirés : rouges (WP07) | note WP07 |
| C-001 (contrat stable) | `node tools/contract-stability/check.mjs` ; `api/unit/contracts/contract-additions-9b.spec.ts` | 310 admises, 0 refusée ; `contracts` 17/17 (WP10) | `device_model` obligatoire sur `HeartbeatRequest` : `check.mjs` refuse (code 2) et 2 échecs Jest ; opération non listée : 4 tests de gel échouent ; `x-process` modifié sur une opération existante : échoue ; `x-roles` dans un paramètre, une réponse ou un schéma : refusé | notes WP03, WP04, WP10 |
| C-002 (pas d'écriture d'argent) | `anomalies-classification.spec.ts` (grand livre inchangé, `it.each(['OFFLINE_SHORTFALL', 'PSP_TOPUP_NOT_CREDITED', 'CASH_TOPUP_OVER_LIMIT'])` refusés) | verts ; `classify_anomaly` n'écrit rien (`resolution_tx_id` jamais touché) | `CL067` retiré : 3 échecs | note WP07, relecture WP01 |
| C-003 (aucun refus d'enrôlement) | `bo/phone-models-devices.spec.ts` (« C-003 : valeur inconnue, mal formée ou énorme : toujours enrôlé, jamais 4xx » ; « le niveau NFC n'empêche ni l'enrôlement ni l'usage ») | verts ; `set_device_model` sous `SAVEPOINT` | `throw` dans le `catch` : 1 échec | note WP09 |
| C-004 (écart de sécurité soumis) | décisions du porteur des 24 et 25/11/2026 (ADR-235) ; points soumis : nom de la plateforme (WP05), canal nul (WP06), dérives `x-roles` (WP10) | tous tranchés avant d'être codés | — | notes WP05, WP06, WP10 |
| C-005 (liste fermée des anomalies) | `sql/tests_backoffice_writes.sql` (`anomaly_classifiable`) ; `SPECIFICATION.md` §12.2 | aucun type ajouté ni retiré de la base ; le tableau passe de 22 à 23 lignes pour rejoindre le schéma (`PSP_TOPUP_NOT_CREDITED`) | — | `0038_psp_topups.sql` (CHECK), WP11 |
| C-006 (pas d'écran) | revue du diff de la mission | aucun fichier d'écran | — | `git diff --name-only` |

## Relancé par WP11 (25/11/2026, lane k, base `cashless_wp11`, remise à zéro avant et après)

Variables : `PGHOST=127.0.0.1 PGPORT=5433 PGDATABASE=cashless_wp11`, puis `source ../../tools/dev-db/env.sh` (toutes les
`DATABASE_URL_*` vers `cashless_wp11`, vérifié par `env | grep DATABASE_URL`).

| Commande | Résultat |
|---|---|
| `SKIP_LATENCY=1 npx jest test/integration/invariants-cloture/consignation.spec.ts --runInBand --forceExit` (depuis `apps/api`) | 57 tests verts |
| `SKIP_LATENCY=1 npx jest test/unit/architecture.spec.ts test/unit/production-guard.spec.ts test/unit/contracts --runInBand --forceExit` | 3 suites, 92 tests verts |
| `node tools/contract-stability/check.mjs` | 310 différences, 310 admises, 0 refusée |

`consignation.spec.ts` garde la mission 9b (OP-N131 à OP-N149, ADR-197 à ADR-214) : il vérifie ici que **les tests cités
dans les fiches du §15 existent** (sa vérification d'existence couvre les fiches de `## 10.` à la fin de `POINTS_OUVERTS.md` et
d'`ADR-197` à la fin de `DECISIONS_ADR.md`), et, depuis le 25/11/2026 (OP-N194 levé), que chaque OP-N185 à OP-N198 a sa ligne de tableau, sa fiche du §15, sa reprise par ADR-236 et son report dans `PRD.md` et `PROMPTS-A-ENVOYER.md`.

## Fichiers à faire relire par une personne

Liste complète et motifs : `docs/POINTS_OUVERTS.md` §15. En tête : `packages/ledger-sql/post-roles.sql` § 15 et § 16 ;
`packages/ledger-sql/migrations/0101_anomaly_classification_phone_models.sql` et `0102_backoffice_read_views.sql` ;
`apps/api/src/search/search-scope.ts`, `search-rate-limit.ts`, `search.service.ts` ; `apps/api/src/anomalies/anomalies.service.ts` ;
`apps/api/src/devices/phone-models/phone-models.service.ts` ; `tools/contract-stability/x-roles/roles.json`.

## Écarts et points ouverts de la mission

OP-N185 à OP-N198 (ADR-236) : voir `docs/POINTS_OUVERTS.md` §15. **Ce document n'établit pas** : la CI de la PR (pgTAP), la
batterie complète de l'orchestrateur, la latence d'`listAnomalies`, de `getWalletOverview` et de `searchCustomerByPhone`, et un
parcours unique SC-001.

## Correctif d'intégration du cycle 3 (26/11/2026, batterie de l'orchestrateur sur la lane k)

La batterie complète a trouvé trois défauts causés par la 11b, que les suites des lots ne lançaient pas. Corrigés sans rendre aucun droit ni affaiblir un contrôle.

| Défaut | Correction | Preuve (base `cashless_wp11`, remise à zéro) |
|---|---|---|
| `42501` sur `anomaly` : D4 retire `UPDATE` à `cashless_app`, or `cash-due.service.ts` lisait `anomaly ... FOR UPDATE` (un verrou de ligne exige `UPDATE`) | `FOR UPDATE` retiré de cette lecture. Le bracelet est déjà verrouillé par `lockCounterMedia` ; `refund_cash_due` (`SECURITY DEFINER`) reprend ce verrou, puis verrouille et re-somme les anomalies `OPEN` (`schema_grand_livre_cashless.sql`). Le seuil de seconde personne est tenu par la base : au-delà de `cash_refund_single_max`, `refund_cash_due` exige un valideur différent de l'auteur. Aucun autre verrou ni écriture sur `anomaly` dans `apps/api/src` (grep) | `cash-due` 6, `release-chaining` 15, `refunds/journey` 12, `topups/cash-desk-guard` 4, `cash-due-after-replace` 1 : verts |
| Garde | `architecture.spec.ts`, « aucun verrou ni UPDATE/DELETE direct sur la table anomaly dans src/ » | mutations : `FOR UPDATE` remis dans `cash-due.service.ts` : rouge ; `UPDATE anomaly` dans un fichier ajouté : rouge ; annulées |
| `payment-isolation.spec.ts` (5b) ramassait `getSale` et `listEventSales` | opérations de `MISSION_11B_OPERATIONS` écartées de `missionOperations()` ; le test « chaque opération a un cas, aucun cas orphelin » est inchangé | 5 verts |
| `configuration-isolation.spec.ts` ramassait des opérations 11b (`bodies[...] is not a function`) | même exclusion dans `missionRoutes()` | 5 verts |

Gardes relancées : architecture, production-guard, contracts, consignation, backoffice-isolation, media-isolation : 195 verts ; `x-roles-matrix.spec.ts` (sans `SKIP_LATENCY`) : 5 verts ; eslint, tsc, prettier propres. Les opérations de la 11b restent couvertes par `backoffice-isolation.spec.ts`.
