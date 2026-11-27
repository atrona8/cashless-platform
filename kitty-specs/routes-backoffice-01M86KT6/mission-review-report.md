# Revue post-fusion : routes-backoffice-01M86KT6 (mission 11b)

**Relecteur** : Claude Opus 5.5 (agent distinct des implémenteurs et relecteurs de lots) | **Date** : 2026-11-26
**Baseline** : `2fec9662` | **Fusion** : `7a56d09b` | **HEAD** : `f35d1ab5` | **Lots** : WP01 à WP11 (tous `done`)
**Méthode** : lecture de spec/plan/ADR-235-236/OP-N185-198/fiche de passation, relecture du diff (migrations 0101-0102,
`post-roles.sql`, services anomalies, recherche, profil, modèles déclarés), relance de tests sur `cashless_review11b`.

## Verdict : PASS WITH NOTES

Aucun constat bloquant. Les écarts de sécurité ouverts sont tous consignés (OP + ADR) ; aucun écart non consigné trouvé.

## Portes (hors dépôt Spec Kitty : projet NestJS/Postgres, adaptées)
- Contrat : `node tools/contract-stability/check.mjs` -> 310 différences admises, 0 refusée ; `x-roles.test.mjs` 16/16.
- Architecture/production/contrats/consignation : `architecture.spec`, `production-guard.spec`, `unit/contracts`,
  `consignation.spec` verts. Aucun faux introduit (pas de composant simulé dans la mission).
- Jest `test/integration/backoffice` + gardes : 15 suites vertes, 302 tests (9 sautés dont la latence, `SKIP_LATENCY=1`).
- Isolation de bout en bout : `backoffice-isolation`, `media-isolation`, `device-auth-matrix` : 25 verts.
- pgTAP (pg_prove local retrouvé dans `docs/passation-9a/scripts/bin`) : `tests_backoffice_writes`,
  `tests_backoffice_read_views`, `tests_execute_grants`, `tests_offline_rights`, `tests_payment_rights`,
  `tests_definer_search_path`, `tests_default_acl` : 613 tests, PASS. (Le journal disait « pg_prove absent » : il l'est
  seulement du PATH par défaut.)
- `tsc --noEmit` et `prettier --check` sur les fichiers de la mission : propres (OP-N198 paraît déjà levé en pratique).
- Matrice `x-roles-matrix.spec.ts` (exclue du jest par défaut, jouée par un pas CI dédié) : relance lancée, non terminée
  (voir « Réserve de relance »).
- Registre de tickets (issue-matrix) : sans objet, aucun fichier ; la mission ne référence pas de ticket GitHub.

## Historique des lots
20 comptes rendus de relecture ; WP06 : 4 rebonds (planificateur, canal nul, CTE `reversedQuery`), WP11 : 3, WP04, WP05,
WP09, WP10 : 2. Les « force » du journal sont des retours en arrière (`approved/in_review -> planned`) et des notes de
transition, conformes au modèle ; aucun contournement d'arbitre ni auto-approbation relevé. Les constats de relecture
ont tous une trace (décisions du 25/11 de la fiche, OP-N191 à OP-N197, tests ajoutés pour OP-N194).

## Couverture FR/NFR/C
`acceptance-matrix.json` : 30 critères (FR-001..018, NFR-001..006, C-001..006), tous `pass`, `negative_invariants` vide.
Vérifié par relance : FR-001/002 (profil), FR-003/004 (`x-roles`, garde CI + matrice), FR-005..007 (ventes),
FR-008..010 (anomalies, classement par `classify_anomaly`, aucun `UPDATE anomaly` : `architecture.spec`), FR-011..014
(recherche), FR-015..017 (modèles et niveau NFC), C-002 (aucune écriture au grand livre : pgTAP et tests API).
Tests contraignants : les tests passent par les routes réelles (Nest + base), pas par des fixtures synthétiques ; les
mutations sont consignées dans les notes de lane.

## Écarts de sécurité : état (règle 4)
Tous consignés dans `docs/POINTS_OUVERTS.md` (§15) et `docs/DECISIONS_ADR.md` (ADR-235, ADR-236), reportés dans
`PRD.md` et `PROMPTS-A-ENVOYER.md`, gardés par `consignation.spec.ts` (présence des OP-N185 à OP-N198).

| Écart ouvert | Entrée | Nature | Test qui échoue si la limite s'élargit |
|---|---|---|---|
| 13 types d'anomalie non classables (argent) non traités | OP-N185 (bloque la prod, confirmé) | contrôle reporté à 11c | `anomalies-classification.spec.ts` (`it.each` refus) |
| `classify_anomaly` ne vérifie pas que `p_actor` appartient au prestataire (rôle app compromis) | OP-N196 | droit plus large (EXECUTE `cashless_app`) | auteur forgé ignoré (test API) ; pas de test de borne en base : assumé |
| Modèle de téléphone déclaré, non vérifié | OP-N186 | secret/attestation absent | `phone-models-devices.spec.ts` (C-003) |
| Débit de recherche par personne, pas par numéro ; audit sans numéro | OP-N189 | contrôle partiel | `search-rate-limit.spec.ts` |
| Matrice `x-roles` par échantillon ; 8 opérations sans `x-roles` | OP-N187, OP-N188 | couverture partielle | `x-roles.test.mjs` (liste explicite) |
| Droits nouveaux de `cashless_app` (SELECT 3 relations, EXECUTE 4 fonctions) | ADR-235 (nommés) | droit plus large décidé D5/D9 | `tests_execute_grants.sql`, `tests_offline_rights.sql` |
Renforcements faits puis consignés : retrait de `UPDATE (status, resolution_tx_id)` sur `anomaly` (D4), exclusion de
`PLATFORM_ADMIN` de `searchCustomerByPhone`, 3 rôles retirés de `x-roles`, `REVOKE` d'écriture sur les vues.

## Constats (non bloquants)
- **N1 (MOYEN, documenté)** : OP-N196 ci-dessus. `classify_anomaly` est `SECURITY DEFINER`, exécutable par `cashless_app`
  qui pose aussi `app.operator_id` : une application compromise classe n'importe quelle anomalie classable de n'importe
  quel prestataire avec un auteur choisi. Accepté, levé par 11c. Le rôle (OPERATOR_ADMIN/ORGANIZER_ADMIN) n'est contrôlé
  que par l'API, pas par la base.
- **N2 (BAS)** : `anomaly` garde l'`INSERT` direct pour `cashless_app` (statu quo OP-N86) ; le CHECK
  `anomaly_classification_chk` n'impose rien à une ligne insérée sans colonnes de classement avec `status = 'RESOLVED'`.
  Le retrait de l'UPDATE (D4) ne ferme donc pas ce chemin ; préexistant, à rappeler à 11c.
- **N3 (BAS)** : `declare-device-model.ts` avale toute erreur (SAVEPOINT) : voulu (C-003), tracé par SQLSTATE sans la
  valeur ; un modèle jamais écrit ne se voit pas en base. Conforme à D2.
- **N4 (BAS)** : l'audit `STAFF_CUSTOMER_SEARCH` garde les `customer_ids` internes des résultats (pas le numéro) : permet
  de retrouver qui a consulté quel festivalier, sans le numéro. Cohérent avec D7 ; à citer au juriste (mission 10c).
- **N5 (BAS)** : `acceptance-matrix.json` : `mission_number` vide et notes résiduelles « Aucune preuve encore (lot non
  approuvé) » dans les critères passés ; `evidence` fait foi. Cosmétique.
- **N6 (BAS)** : NFR-001 non mesuré pour `listAnomalies`, `getWalletOverview`, `searchCustomerByPhone` (OP-N195) ; les
  tests de latence sont sautés sous `SKIP_LATENCY` et sous charge locale (voir la batterie du 26/11) ; à mesurer en 13.
- **N7 (BAS)** : pgTAP de la mission reste prouvé par la CI de la PR (résultat CI non établi par les notes) ; relancé ici
  en local, PASS.
- **N8 (info)** : `x-roles-matrix.spec.ts` n'est pas dans la passe jest par défaut ; il tourne par un pas CI dédié
  (`ledger-tests.yml` l. 293). Une perte de ce pas ne ferait pas échouer `npm test`.
- **N9 (corrigé après la revue, 26/11/2026)** : la CI de la PR #27 a échoué à la migration `0102` sur une base neuve
  (`role "cashless_app" does not exist`) : la migration accordait `SELECT` sur ses vues alors que les rôles ne sont
  créés que par `roles.sql`, après la série (convention de la `0033`). Invisible en local, où les rôles existent
  déjà dans le cluster. Correctif : `GRANT` retirés de la migration et posés dans `post-roles.sql` § 16 ; mêmes droits
  au final, vérifiés sur un cluster Postgres 17 neuf (`SELECT` oui, écriture non, `PUBLIC` rien). La revue s'est fiée
  à des bases déjà migrées : rejouer la série sur un cluster vierge avant de conclure.

## Fichiers à faire relire par une personne (règle 4)
1. `packages/ledger-sql/migrations/0101_anomaly_classification_phone_models.sql` (`classify_anomaly`, `set_device_model`,
   `upsert_phone_model`, `delete_phone_model` : fonctions `SECURITY DEFINER`).
2. `packages/ledger-sql/post-roles.sql` §15-§16 (droits de la base : REVOKE UPDATE sur `anomaly`, GRANT EXECUTE, vues).
3. `packages/ledger-sql/migrations/0102_backoffice_read_views.sql` (vues `security_invoker`, RLS).
4. `apps/api/src/search/search-scope.ts`, `search-rate-limit.ts`, `search.service.ts` (portée, numéro, débit, audit).
5. `apps/api/src/anomalies/anomalies.service.ts` et `anomaly-scope.guard.ts` (portée, auteur de session).
6. `apps/api/src/sales/sales.service.ts` (portée MERCHANT, `enable_sort = off`).
7. `docs/POINTS_OUVERTS.md` §15 et ADR-235/236 (consignation des écarts).
L'agent qui a écrit le code ne vaut pas relecture indépendante ; cette revue non plus pour les points 1 à 3.

**Relecture humaine faite par le porteur le 26/11/2026** (fichiers 1 à 7 ci-dessus), après la fusion des PR #26 et #27.

## Réserve de relance
La relance de `x-roles-matrix.spec.ts` (1 281 appels) n'était pas terminée à la remise du rapport (plus de 10 min sous charge
locale, aucun échec affiché) : son résultat n'est PAS établi par cette revue ; on s'appuie sur la preuve de WP10 et de la
batterie du 26/11 (5 verts) et sur le pas CI. Les cas `x-roles` de l'isolation (backoffice-isolation) sont verts.

## Retrospective Reminder
`retrospective.yaml` existe (écrit au terminus de la fusion). Reste : `spec-kitty retrospect summary` et
`spec-kitty agent retrospect synthesize --mission routes-backoffice-01M86KT6` (dry-run par défaut). Avant fusion de la PR :
reformatage 100 caractères (Prettier, déjà propre), `contract-baseline.json` et `COVERAGE` des faux vérifiés, et
`spec-kitty-docs-maintain` pour le jalon post-review (journal de `docs/06-docs-status.md`).
