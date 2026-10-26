# WP07 « Droits de la base » : compte rendu d'implémentation (reprise du 26/10/2026)

Lane : `.worktrees/terminaux-paiement-en-ligne-01M52QB9-lane-g`. Commit : `2d665284`
(`feat(WP07): droits de la base de l'encaissement en ligne`). T028 à T031 marquées `done`.

## Reprise
Le travail non commité de l'implémenteur interrompu le 23/10 a été gardé et relu contre le prompt et
`contracts/database-rights.md`. Corrections apportées :
- `tests_payment_rights.sql` ne passait pas (3 échecs + 1 erreur de syntaxe qui arrêtait la suite avant
  la borne OP-N76) :
  - le relevé des vues comptait les vues de pgTAP (`pg_all_foreign_keys`, `tap_funky`) : vues des
    extensions écartées (`pg_depend`, `deptype = 'e'`) ;
  - `cancel_payment_request` était appelé avec le terminal ET l'empreinte (CL001 « exactement un ») :
    appel par le terminal d'origine seul (`NULL` pour l'empreinte) ;
  - borne OP-N76 : `array_agg(DISTINCT … ORDER BY 1)` invalide, réécrite en sous-requête.
- Renforcement du test : les rôles comparés en 1c sont relevés dans `pg_roles` (`cashless\_%` hors
  `cashless_app`, plus `PUBLIC`) au lieu d'une liste en dur, avec un témoin. Un rôle ajouté plus tard est
  donc couvert d'office.
- Lignes de plus de 100 caractères corrigées dans les parties nouvelles.
- Un échec de la batterie complète, hors carte : voir plus bas (`tests_tag_key_job_approval.sql`).

## Ce qui est livré
- `post-roles.sql` §4a : fonctions de 0031 à 0034 accordées nommément, signatures relevées dans `pg_proc`
  (vendeurs ×7, catalogue ×8 dont `check_sale_lines`, paiement ×5 dont `record_device_seq` accordée pour la
  première fois, QR ×7 dont `payment_request_for_token(uuid, bytea)`). `consume_tap(bigint, uuid)` est
  inchangée. `set_device_status`, `create_device_enrollment_code`, `enroll_device`,
  `purge_device_enrollment_attempts` et `record_enrollment_attempt` sont remplacées à signature égale,
  sans ancienne signature restante. Les fonctions accordées sont toutes en `SECURITY DEFINER`
  avec `search_path = public, pg_temp` (vérifié dans `pg_proc`). Aucune n'exige donc l'`EXECUTE` d'une
  autre fonction.
- §4b : `UPDATE` de `device` réduit à `station_name`, `last_seen_at`, `last_snapshot_version`,
  `next_seq_floor` (A12).
- §6 (nouvelle) : 6a vendeurs (A20 : `REVOKE SELECT` sur la table, puis `GRANT SELECT` calculé sans
  `pin_hash`, `failed_attempts`, `locked_at` ; `vendor_public` sans `INSERT`/`UPDATE` ; `vendor_session`,
  `vendor_pin_check`), 6b catalogue (6 tables), 6c `sale_line`, `sale_attribution` (report de la relecture
  WP04, constat 1) et `approval_token_use` (`INSERT` gardé), 6d `payment_request` (`SELECT` calculé sans
  `nonce_hash`) et `payment_request_detail`, 6e `kyc_verification`.
- Fonctions internes non accordées et listées dans les refus de `tests_execute_grants.sql` :
  `vendor_admin_allowed`, `catalog_admin_allowed`, `catalog_lock_pos`, `catalog_bump_version`,
  `catalog_label`.
- Purge des essais de PIN : WP02 n'a ajouté aucune fonction de purge pour `vendor_pin_check`. Rien n'est
  accordé ; à signaler pour la suite (la table grossit sans purge).

## Écarts au plan (sens)
Tous vont dans le sens d'un renforcement, ou sont des arbitrages déjà pris :
- `device` sans `app_mode`, `nfc_enabled`, `event_id`, `pos_id`, `personal_phone` (A12) : renforcement.
- `kyc_verification` sans `INSERT`/`UPDATE` : renforcement.
- `payment_request` sans écriture ni lecture de `nonce_hash` : renforcement.
- Vue `vendor_public` sans `INSERT`/`UPDATE` : renforcement. C'est la seule vue créée par la mission ; le
  test échoue si une nouvelle vue apparaît.
- `sale_attribution` sans `INSERT`/`UPDATE` (relecture WP04, constat 1) : renforcement.
- `check_sale_lines` et `payment_request_for_token(uuid, bytea)` sont accordées en plus de la liste du
  contrat (arbitrages du 22/10 et de la relecture WP05). Aucune autre fonction hors contrat.
- Durcissement « `vendor_id` dans la clé composite de `vendor_session` » (report WP04) : **non fait**. Il
  faudrait retoucher 0033, déjà fusionnée, ce qui est hors carte. Le retrait de l'`INSERT` direct sur
  `sale_attribution` ferme déjà le chemin d'attaque décrit ; la retouche du schéma est laissée à la
  décision de l'orchestrateur ou du porteur (défense en profondeur seulement).

## Retouches hors carte
- `tests/tests_payments.sql` : cas demandés par la relecture WP04 (constats 2 et 3). Il s'agit d'une
  session expirée → CL036 avec témoin, et d'un valideur `ORGANIZER_ADMIN` / `CASHIER` en
  `SUPERVISOR_DEVICE` → CL036. Écrits par l'implémenteur précédent et gardés.
- `tests/tests_tag_key_job_approval.sql` §7 : la liste exacte des colonnes de `device` modifiables suit A12.
  Sans cette mise à jour, le test 60 échouait sur la batterie complète.
- `contracts/database-rights.md` n'est **pas** modifié (il ne m'appartient pas). À aligner par
  l'orchestrateur : ajouter `check_sale_lines(uuid, jsonb, bigint)` et `payment_request_for_token(uuid, bytea)`
  à la liste « Fonctions accordées » (report de la relecture WP05).

## Résultat du grep des usages (`apps/api/src`, hors `*.spec.ts`)
Le grep ne trouve aucune occurrence pour :
- `UPDATE device` (aucune écriture directe de `device`) ;
- `kyc_verification` ;
- `INSERT INTO|UPDATE payment_request` et `nonce_hash` ;
- `INSERT INTO|UPDATE` sur `vendor*`, `catalog_*`, `point_of_sale_catalog_policy`, `device_catalog_served`,
  `sale_line`, `sale_attribution`, `payment_request_detail` ;
- `pin_hash|failed_attempts|locked_at`.

## Points soumis au porteur / à l'orchestrateur
1. **Incident sur la base partagée** : mon premier lancement de Jest a tourné sur **`cashless_test`**, et non
   sur `cashless_wp07`. La cause : `apps/api/test/support/db.ts` et `config.ts` visent `cashless_test` en dur,
   sauf si les `DATABASE_URL_*` sont posées, et `PGDATABASE` ne suffit pas pour Jest. Ce lancement a écrit des
   données de test dans `cashless_test` (1705 tests verts, mais sans valeur de preuve : droits de la base
   partagée). **L'orchestrateur doit lancer `reset-db` sur `cashless_test` avant son prochain pgTAP.** Le Jest
   probant a été relancé sur `cashless_wp07` avec `DATABASE_URL`, `DATABASE_URL_OWNER`, `_APP`, `_PLATFORM`,
   `_TAGKEYS`, `_PERSO`, `_TAGCHECK`, `_KEYADMIN` pointant `cashless_wp07`. La fiche de contexte gagnerait à
   le dire.
2. Aucun écart qui affaiblit la sécurité n'a été codé ni n'est en attente.
3. `vendor_pin_check` n'a pas de fonction de purge (rien accordé). C'est une dette à nommer si la mission ne
   la traite pas.
4. Durcissement de la clé composite de `vendor_session` : voir les écarts au plan (non fait, hors carte).

## Fichier à faire relire par une personne
`packages/ledger-sql/post-roles.sql` (§4a, §4b, §6 : droits de la base).

## Critères couverts et preuves (`tests/tests_payment_rights.sql`, sauf mention)
| Critère | Preuve (nom du cas) |
|---|---|
| NFR-002 (empreinte du PIN illisible) | « cashless_app : colonnes lisibles de vendor, liste exacte » ; « NFR-002, NFR-008 : aucun rôle cashless_* ni PUBLIC ne lit vendor.pin_hash ni payment_request.nonce_hash » ; refus `SELECT pin_hash FROM vendor`, `SELECT * FROM vendor`, `SELECT v FROM vendor v` |
| NFR-008 (`nonce_hash` illisible) | « colonnes lisibles de payment_request, liste exacte » ; refus `SELECT nonce_hash …`, `SELECT * …`, `… WHERE nonce_hash = …` |
| NFR-007 (isolation) | « NFR-007 : sous A, aucune table de la mission ne montre une ligne de B » (le cas « données : chaque table de la mission a au moins une ligne de B » prouve que l'ensemble testé n'est pas vide) ; « NFR-007 : vendor_public (droits du propriétaire) ne montre aucune ligne de B » ; « … sans prestataire de session : aucune ligne » |
| C-008 (kyc) | « aucune colonne INSERT/UPDATE sur kyc_verification » ; refus `INSERT INTO kyc_verification`, `UPDATE kyc_verification` |
| FR-024 / FR-015 (réaffectation directe retirée) | `tests_device_rights.sql` : « colonnes de device modifiables, liste exacte (A12 …) », refus `42501` par colonne, « A12 : … dans la liste refusée », témoin `station_name` ; `tests_tag_key_job_approval.sql` test 60 |
| C-010 (borne OP-N76) | « OP-N76, ADR-121 : … accordée à cashless_app seul (droits déclarés …) » ; « … seul cashless_app (hors superutilisateurs et propriétaire) exécute …, héritage compris » ; « OP-N76 : PUBLIC n'exécute pas … » |
| Liste figée des fonctions | `tests_execute_grants.sql` « cashless_app : liste exacte des fonctions exécutables » (listes des autres rôles inchangées) |
| Chemins légitimes | §3 : `create_vendor`, `begin_vendor_pin_check` puis `open_vendor_session`, `assert_vendor_session`, `create_catalog_category` / `create_catalog_item` (2 versions), `record_device_catalog_served`, `create_merchant_payment_request`, `payment_request_for_token`, `cancel_payment_request`, `record_device_seq`, `assert_wallet_payable` |
| Idempotence | §6 « rejeu roles.sql puis post-roles.sql : … inchangées » ; rejeu double à la main (ci-dessous) |

FR-021 à FR-023 : reportées à la mission 10, « Deferred » (seule la préparation est livrée).

Mutants vérifiés sur `post-roles.sql` (chaque mutant est tué) : sans `REVOKE … sale_attribution` (8 échecs) ;
sans `REVOKE … vendor_public` (9) ; `nonce_hash` accordé (6) ; sans `REVOKE … kyc_verification` (6) ;
`pos_id` remis dans l'`UPDATE` de `device` (3, `tests_device_rights.sql`).

## Definition of Done (base `cashless_wp07`, en série)
| Étape | Commande | Résultat |
|---|---|---|
| Lint | `npm run lint` | vert |
| Typecheck | `npm run typecheck` | vert |
| Reset | `PGDATABASE=cashless_wp07 bash packages/ledger-sql/scripts/reset-db.sh` | OK (0031 à 0035, roles, post-roles) |
| Rejeu double | `psql -f roles.sql -f post-roles.sql` ×2 | OK ×2 |
| pgTAP complet | `bash scripts/test-pgtap.sh` | **39 fichiers, 2931 tests, PASS** (dont `tests_payment_rights.sql` 138, `tests_execute_grants`, `tests_device_rights`, `tests_definer_trigger_writers`, `tests_payments`) |
| Générés | `npm run check:generated -w @cashless/ledger-sql` | « suites pgTAP à jour » ; `gen_tests.py` et `tests_grand_livre_cashless.sql` inchangés |
| Jest | `reset-db` puis `SKIP_LATENCY=1 npx jest --runInBand` (`DATABASE_URL_*` → `cashless_wp07`) | **101 suites, 1705 passés, 6 ignorés, 0 échec** |

`node_modules` de la lane : copie `cp -cR` de celui de lane-h, avec les liens `@cashless/*`. Non commité
(ignoré par git). La base `cashless_wp07` est supprimée.
