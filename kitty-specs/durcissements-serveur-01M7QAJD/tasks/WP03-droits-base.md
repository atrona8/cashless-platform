---
work_package_id: WP03
title: Droits de la base de la mission (post-roles.sql section 13) et rôle cashless_pin
dependencies: [WP01, WP02, WP04]
requirement_refs: [FR-006, NFR-003, C-005, C-008]
planning_base_branch: feat/durcissements-serveur
merge_target_branch: feat/durcissements-serveur
branch_strategy: Planning artifacts for this mission were generated on feat/durcissements-serveur. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/durcissements-serveur unless the human explicitly redirects the landing branch.
subtasks: [T010, T011, T012, T013, T014]
phase: Phase 1 - Base
agent: claude
history:
- timestamp: '2026-11-18T16:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: packages/ledger-sql/post-roles.sql
create_intent:
- packages/ledger-sql/tests/tests_11a_rights.sql
execution_mode: code_change
model: sonnet
owned_files:
- packages/ledger-sql/roles.sql
- packages/ledger-sql/post-roles.sql
- packages/ledger-sql/src/migrate.ts
- tools/dev-db/env.sh
- .github/workflows/ledger-tests.yml
- apps/api/test/support/db.ts
- apps/api/src/db/process-db.module.ts
- packages/ledger-sql/tests/tests_execute_grants.sql
- packages/ledger-sql/tests/tests_definer_trigger_writers.sql
- packages/ledger-sql/tests/tests_media_roles.sql
- packages/ledger-sql/tests/tests_media_api.sql
- packages/ledger-sql/tests/tests_media_reinstate.sql
- packages/ledger-sql/tests/tests_payment_rights.sql
- packages/ledger-sql/tests/tests_device_rights.sql
- packages/ledger-sql/tests/tests_edge_rights.sql
- packages/ledger-sql/tests/tests_cash_psp_rights.sql
- packages/ledger-sql/tests/tests_9b_rights.sql
- packages/ledger-sql/tests/tests_11a_rights.sql
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP03 : Droits de la base de la mission (`post-roles.sql` section 13) et rôle `cashless_pin`

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan`. Lis la fiche commune
`docs/passation-11a/fiche-implementation.md`, ce prompt, puis seulement :

- les notes de lane de WP01 et WP02 et leurs migrations `0090` à `0095` **telles que fusionnées** (signatures réelles) ;
  `interfaces.md` ; `plan.md` IC-02, IC-03, IC-04, IC-09 et « Écarts de sécurité » ; `spec.md` FR-006, NFR-003, C-005,
  C-008 ;
- `research/R-N60-lots-bracelets.md` §1, §4, §5.1 ; `research/R-N76-N79-pin-vendeurs.md` §1 (« Tests existants »), §2 («
  Création des rôles et droits »), §4 (« Rôle de base ») ; `research/R-9b-…md` §2.2, §2.3 ;
  `research/R-N64-N116-app-attest-passerelles.md` A1 et A3 point 4 ;
- `packages/ledger-sql/post-roles.sql` : sections 0-2 (l. 1-352), 4a (l. 400-520), 6a, 7c, 8b, 9e, 11, 12 (modèles) ;
  `roles.sql` ; `src/migrate.ts` l. 120-170 ; `tools/dev-db/env.sh` l. 30-75 ; `ledger-tests.yml` l. 40-75 ;
  `apps/api/test/support/db.ts` ; `apps/api/src/db/process-db.module.ts` ; `tests/tests_9b_rights.sql` (modèle de
  suite), `tests/_grants_for_tests.sql`, `tests/tests_execute_grants.sql` (listes figées).

Priorité des sources (SPECIFICATION §0.3). Contradiction : tu la signales. `interfaces.md` fait foi.

## Objective
Poser et prouver tous les droits de la mission dans une **section 13** de `post-roles.sql`, seul lot qui l'écrit :
`cashless_app` perd les écritures directes de `media_batch`, du statut de `media`, de l'`INSERT` libre de
`refund_request` et les deux fonctions du PIN, gagne trois `EXECUTE` étroits ; `cashless_pin` apparaît ; les listes
figées disent exactement cet état. **Ne rouvre jamais un droit pour faire passer un test.** WP05 à WP13 en dépendent.

## Context
- **Liste `EXECUTE` finale de `cashless_app`** (`interfaces.md`, fait foi) : liste d'avant **moins**
  `begin_vendor_pin_check(uuid,uuid)`, `open_vendor_session(uuid,uuid)`, `refund_deposit_for_session(uuid,uuid)`,
  **plus** `create_media_batch(…)`, `update_media_batch(uuid,jsonb,uuid)`,
  `advance_app_attest_counter(uuid,bytea,bigint)`, rien d'autre (`enroll_device` change de signature, 15 arguments :
  même droit, pas un ajout). Tout autre `EXECUTE` jugé nécessaire : décris-le (appelant, risque, options), ne le code
  pas (règle 1), continue.
- **Droits de table** : `media_batch` sans `INSERT` ni `UPDATE` ; `media` :
  `UPDATE (claim_code_used_at, claim_attempts)` seulement ; `refund_request` : `INSERT` sur les seize colonnes écrites
  par l'API (R-9b §2.2 point 1 :
  `operator_id, ledger_id, event_id, wallet_id, customer_id, requested_by, method, msisdn, iban, new_number, status,
  estimated_amount, fee, currency, hold_until, extra_check_required`
  ; **vérifie-les** dans `refund-backoffice-create.service.ts` l. 78-97 et `refund-requests.service.ts` l. 105-125,
  signale tout écart) ; `device_app_attest_key` : `SELECT` seul. NFR-003 : **aucun droit de table ou de colonne ajouté**
  à `cashless_app`.
- **Écarts déjà acceptés (18/11/2026)** : `refund_deposit(uuid, uuid)` gardée, exécutable par **personne** (test) ; un
  seul `EXECUTE` nouveau hors OP-N60 : `advance_app_attest_counter` (risque consigné : déni de service d'un compteur).
- **Pièges de séquence** : (1) `post-roles.sql` accorde des signatures que WP02 a retirées : l. 462 (ancienne
  `enroll_device`) et l. 711 (`refund_deposit_for_session(uuid, uuid)`) font échouer la série ; tu les corriges d'abord,
  sinon rien ne s'applique ; (2) les helpers `media_session_operator()`, `media_set_actor(…)` et les fonctions déjà
  listées en 4a (l. 426-446) **restent** accordés à `cashless_app` : retirer un `EXECUTE` hors de la liste de
  `interfaces.md` serait un écart à signaler, pas un ménage.
- **Dépendance** : l'entrée `'vendor-pin'` de `process-db.module.ts` lit `pinDatabaseUrl`, champ créé par **WP04**
  (`DATABASE_URL_PIN`). Sans WP04 dans ta lane, n'invente pas le champ : écris l'entrée en dernier, lance
  `npx tsc --noEmit -p apps/api` et, si elle ne compile pas, dis-le dans la note (WP04 fusionne d'abord).
- Retouches hors carte nommées (à lister dans la note) : `tools/dev-db/env.test.example` (`CASHLESS_PIN_PASSWORD`,
  `DATABASE_URL_PIN`) ; `docs/SERVICES-EXTERNES.md` l. ~57 (une ligne). Rien d'autre.

## Subtasks
### T010 : rôle `cashless_pin` (création, mots de passe, URL, CI, tests Jest)
- `post-roles.sql` section 13a : crée `cashless_pin` sur le modèle de 8b/9a
  (`CREATE ROLE … LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT` si absent, `ALTER ROLE` et quatre
  délais comme 8b, `REVOKE ALL` sur tables, séquences, routines, `GRANT USAGE ON SCHEMA public`, `REVOKE TEMPORARY`).
  `roles.sql` : touche-le seulement si tu y trouves une raison, et dis-le.
- `src/migrate.ts` : ajoute `['cashless_pin', report.postRoles ? process.env.CASHLESS_PIN_PASSWORD : undefined]` au
  tableau `passwords`. Mot de passe absent en production : le rôle reste sans mot de passe comme les autres rôles de
  processus du tableau ; **signale-le** (le refus des rôles edge, l. 140-145, est le modèle si le porteur le veut).
- `tools/dev-db/env.sh` : `CASHLESS_PIN_PASSWORD="${…:-cashless_pin_local}"` et `DATABASE_URL_PIN` avec le même motif
  que `DATABASE_URL_SNAPSIGN`. `ledger-tests.yml` : `CASHLESS_PIN_PASSWORD: cashless_pin_ci` et
  `DATABASE_URL_PIN: postgres://cashless_pin:cashless_pin_ci@localhost:5432/cashless_test` dans le bloc d'environnement
  du job `ledger` (l. 40-75 ; vérifie par `grep cashless_ .github/workflows/*.yml` qu'aucun autre job ne pose les
  rôles).
- `apps/api/test/support/db.ts` :
  `export const PIN_URL = roleUrl('DATABASE_URL_PIN', 'cashless_pin', 'CASHLESS_PIN_PASSWORD');`. `process-db.module.ts`
  : `'vendor-pin'` dans `KeyProcess` et `KEY_PROCESS_URL` (`{ field: 'pinDatabaseUrl', variable: 'DATABASE_URL_PIN' }`).
  Validation : `reset-db.sh` passe ; connexion `psql "$DATABASE_URL_PIN" -c 'select 1'`.

### T011 : section 13b, retraits
Après les `GRANT` de `roles.sql`, rejouable, commenté (qui appelait quoi, ADR, OP levée) :
- `REVOKE INSERT, UPDATE ON media_batch FROM cashless_app;` (SELECT intact). `REVOKE UPDATE ON media FROM cashless_app;`
  puis `GRANT UPDATE (claim_code_used_at, claim_attempts) ON media TO cashless_app;` (remplace `UPDATE (status…)` de la
  section 1, que le fichier rejoué en ordre ne doit pas rendre ensuite). **Ne retire pas** ces deux colonnes : sept
  requêtes `FOR UPDATE OF m` de l'API en dépendent (R-N60 §2).
- `REVOKE INSERT ON refund_request FROM cashless_app; GRANT INSERT (<seize colonnes>) ON refund_request TO
  cashless_app;`
  (`SELECT` et `UPDATE` par colonnes de la section 11 inchangés).
- `REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON device_app_attest_key FROM cashless_app;` (+ `PUBLIC` et les autres rôles
  `cashless_*` : aucun droit). `GRANT SELECT` reste hérité de `roles.sql`.
- `REVOKE EXECUTE ON FUNCTION begin_vendor_pin_check(uuid, uuid), open_vendor_session(uuid, uuid) FROM cashless_app;` et
  **retire-les de la liste 4a** (l. 485-489, sinon 4a les rend avant). Corrige aussi l. 462 (`enroll_device` à 15
  arguments) et l. 711 (retire `refund_deposit_for_session(uuid, uuid)`).
- Ajoute `cashless_pin` aux listes de rôles des `REVOKE` existantes (l. 580-583, 1091, 1116, 1131).

### T012 : section 13c, `EXECUTE` ajoutés, `cashless_pin`, fonctions à personne
- `GRANT EXECUTE ON FUNCTION create_media_batch(<types réels>), update_media_batch(uuid, jsonb, uuid),
  advance_app_attest_counter(uuid, bytea, bigint) TO cashless_app;`
  (signatures lues dans les migrations fusionnées).
- `cashless_pin` :
  `GRANT EXECUTE ON FUNCTION begin_vendor_pin_check(uuid, uuid), open_vendor_session(uuid, uuid) TO cashless_pin;` +
  `GRANT SELECT, INSERT ON audit_log` et `USAGE, SELECT ON SEQUENCE audit_log_id_seq` (audits `VENDOR_SESSION_OPENED`,
  `VENDOR_PIN_FAILED`, `VENDOR_LOCKED`). `create_vendor` et `set_vendor_pin` restent à `cashless_app` : le processus ne
  fait que **hacher** (`interfaces.md`, route `hash`). Vérifie ce qu'exige `AuditService.record` et que la RLS
  d'`audit_log` s'applique à ce rôle comme à `cashless_tagkeys` ; sinon copie `keyadmin_snapshot_key_audit_insert` (l.
  ~924) limitée aux trois actions. Aucun droit sur `vendor`, `vendor_session`, `vendor_pin_check`.
- `refund_deposit(uuid, uuid)` : `REVOKE EXECUTE … FROM PUBLIC` et de **tous** les rôles `cashless_*` (décision 2).
  `register_edge_gateway` : la liste 9e s'applique (mêmes arguments) ; vérifie qu'elle reste à `cashless_edgeadmin` seul
  après le `DROP` de `0094`. `refund_request_insert_guard()` : à personne, comme 12b. Aucun `GRANT … ON ALL`.

### T013 : listes figées et suites de droits existantes
Chaque liste élargie ou réduite est **nommée** et commentée « mission 11a, WP03 » (jamais remplacée par un compte).
- `tests_execute_grants.sql` : liste de `cashless_app` = état d'`interfaces.md` ; ligne 82 (signature d'`enroll_device`)
  ; ligne 136 (retrait de `refund_deposit_for_session(uuid,uuid)`) ; nouvelle liste figée de `cashless_pin` (exactement
  deux fonctions) ; `cashless_pin` dans les listes de rôles des boucles ; `refund_request_insert_guard()` dans « aucun
  rôle » ; `register_edge_gateway` (l. 369) inchangée.
- `tests_definer_trigger_writers.sql` : section 4 (l. 239-253) : plus aucune entrée `INSERT`/`UPDATE` pour `media_batch`
  (le test échoue si un droit ou une colonne réapparaît) ; chaîne des écrivains (l. 199-201) :
  `cashless_app:media:UPDATE: claim_attempts,claim_code_used_at` ; test « aucune fonction `DEFINER` sans `pg_temp` »
  doit passer avec les nouvelles fonctions ; titres : OP-N60 « levée ». Garde le test `DELETE`/`TRUNCATE`.
- `tests_media_roles.sql` l. 92-94 : colonnes `claim_attempts`, `claim_code_used_at` ; libellé « deux colonnes ».
  `tests_media_api.sql` l. 44-46 : fonctions `INVOKER` 8 → 6 et assertion `prosecdef` pour les cinq fonctions de WP01.
- `tests_media_reinstate.sql` (l. 77-218, sous `cashless_app`) : les `UPDATE media[_batch] SET status` directs attendus
  `CL020` deviennent `42501` ; les poses d'épisode (l. ~135, 194, 204) passent par `media_set_status(…,'BLACKLISTED',
  'motif',acteur)` et `set_media_batch_status` ; garde `BLACKLISTED→ACTIVE` refusé `CL020` par `media_set_status` ;
  `->ORDERED:-` (l. ~206) devient `->ORDERED:<acteur>` (auteur posé par `create_media_batch`).
- `tests_payment_rights.sql` : l. 316-323 (`begin_vendor_pin_check`, `open_vendor_session` sous `cashless_app` :
  `lives_ok` devient refus `42501`) et l. 373-402 « borne d'OP-N76 » : seul `cashless_pin` exécute (droits déclarés,
  héritage compris, `PUBLIC` non), renommé « levée d'OP-N76 » ; la fixture propriétaire (l. 112-115) reste ; vérifie que
  la fixture `vb`/`sb` (l. 135-137) respecte la nouvelle clé composite.
- `tests_device_rights.sql` : `device_app_attest_key` (aucun `INSERT`/`UPDATE`/`DELETE` pour `cashless_app`) ;
  `tests_edge_rights.sql` l. 193, 235 (forme de retour) ; `tests_cash_psp_rights.sql` l. 329, 347-352
  (`refund_deposit_for_session(uuid,uuid)` n'existe plus, `refund_deposit(uuid,uuid)` reste à personne) ;
  `tests_9b_rights.sql` : listes de rôles avec `cashless_pin`, quatre arguments toujours accordé.

### T014 : `tests_11a_rights.sql`
Modèle `tests_9b_rights.sql` (`BEGIN`, `_grants_for_tests.sql`, `no_plan`, `SET LOCAL ROLE`, `ROLLBACK`).
- **Listes exactes** (`set_eq`) : fonctions de la mission exécutables par `cashless_app` (trois ajouts, `enroll_device`
  à 15 arguments) ; par `cashless_pin` (exactement `begin_vendor_pin_check`, `open_vendor_session`) ; par aucun autre
  rôle `cashless_*` ni `PUBLIC` ; `refund_deposit(uuid,uuid)` et `refund_request_insert_guard()` : par personne.
- **Sous `SET ROLE cashless_app`**, refus `42501` : `INSERT INTO media_batch` (`ORDERED`, `ACTIVE`, `CLOSED`) ;
  `UPDATE media_batch SET status|quantity|key_index|organizer_id|event_id` ; `SELECT … FROM media_batch FOR UPDATE` ;
  `UPDATE media SET status` ; `INSERT INTO refund_request` avec `approved_by` ou `external_reference` ; écriture de
  `device_app_attest_key` ; appel des deux fonctions du PIN ; `has_column_privilege` vrai pour exactement les seize
  colonnes d'`INSERT`, faux pour les autres. Contrôles positifs : `create_media_batch`,
  `media_set_status(…, 'BLACKLISTED',…)`, `advance_app_attest_counter`,
  `UPDATE media SET claim_attempts = claim_attempts`.
- **Sous `SET ROLE cashless_pin`** : les deux fonctions s'appellent sur une fixture ; `SELECT` sur `vendor`,
  `vendor_session`, `vendor_pin_check`, `media`, `journal_transaction` refusé ; `INSERT INTO audit_log` d'une action
  `VENDOR_PIN_FAILED` accepté, d'une autre refusé si tu as posé la politique.
- **Mutations (NFR-004), à rejouer et noter** : (a) `GRANT INSERT ON media_batch TO cashless_app` ; (b)
  `GRANT EXECUTE ON FUNCTION begin_vendor_pin_check(uuid,uuid) TO cashless_app` ; (c)
  `GRANT UPDATE (status) ON media TO cashless_app` ; (d)
  `GRANT INSERT (status, approved_by) ON refund_request TO cashless_app` : chacune dans une transaction de test doit
  faire échouer au moins un test de la suite ; note l'identifiant du test qui échoue.

## Tests et preuves
Base `cashless_wp03`, serveur 5433, depuis la lane ; `reset-db.sh` doit **réussir** :

```bash
export PGHOST=127.0.0.1 PGPORT=5433 PGUSER=postgres PGDATABASE=cashless_wp03
R=/Users/xaamga/Documents/omar_sylla_work/cashless/cashless-platform
export PATH=$R/docs/passation-9a/scripts/bin:/Library/PostgreSQL/18/bin:$PATH
bash packages/ledger-sql/scripts/reset-db.sh && cd packages/ledger-sql
pg_prove -d cashless_wp03 tests/tests_11a_rights.sql tests/tests_9b_rights.sql tests/tests_execute_grants.sql \
  tests/tests_definer_trigger_writers.sql tests/tests_media_roles.sql tests/tests_media_api.sql \
  tests/tests_media_reinstate.sql tests/tests_payment_rights.sql tests/tests_device_rights.sql \
  tests/tests_edge_rights.sql tests/tests_cash_psp_rights.sql tests/tests_offline_rights.sql \
  tests/tests_definer_search_path.sql tests/tests_vendor_session_key.sql tests/tests_media_batch_functions.sql \
  tests/tests_refund_insert_guard.sql tests/tests_iban_sealed.sql tests/tests_device_app_attest.sql \
  tests/tests_edge_gateway.sql tests/tests_refund_transitions.sql tests/tests_cash_sessions.sql
```

Les Jest d'API qui écrivent un lot ou un statut en direct sous `cashless_app` échouent tant que WP05 n'a pas fusionné :
note la liste. Non-régression du pool : `SKIP_LATENCY=1 npx jest test/unit/processes.spec.ts --runInBand --forceExit`.

## Branch Strategy
`feat/durcissements-serveur` ; lane par `lanes.json`. `LC_ALL=C LANG=C spec-kitty agent action implement WP03 --agent
claude --mission durcissements-serveur-01M7QAJD`.

## Definition of Done
- [ ] Section 13 : `cashless_pin`, retraits, trois `EXECUTE` ajoutés, trois retirés, `refund_deposit(uuid,uuid)` à
      personne ; l. 462 et 711 corrigées ; aucun droit de table ou de colonne ajouté à `cashless_app` (NFR-003).
- [ ] `cashless_pin` : mot de passe (`migrate.ts`), `env.sh`, workflow, `PIN_URL`, entrée `vendor-pin` du pool.
- [ ] `tests_11a_rights.sql` vert, listes exactes, quatre mutations rejouées et notées ; suites de droits existantes et
      suites de WP01 et WP02 vertes après `post-roles.sql`.
- [ ] Note de lane : droits finaux par rôle, Jest en attente de WP05, retouches hors carte, mot de passe en production,
      compilation de `process-db.module.ts` vis-à-vis de WP04.

## Risks
- Un droit rouvert pour qu'un test passe : interdit. Prouve l'état final par `has_function_privilege` et
  `has_table_privilege` (le fichier est rejoué dans l'ordre), et l'`INSERT` d'audit sous `SET ROLE cashless_pin` (RLS
  de `audit_log` : l'échec serait silencieux pour WP06). Mot de passe absent en production : voir T010.

## Ce que le relecteur doit casser
- Sous `cashless_app` : insérer un lot `CLOSED`, `UPDATE media_batch SET quantity`, `SELECT … FOR UPDATE` sur un lot,
  `UPDATE media SET status`, insérer une demande `PAID`, écrire `device_app_attest_key`, exécuter
  `begin_vendor_pin_check`, `open_vendor_session`, `refund_deposit_for_session(uuid,uuid)`, `refund_deposit(uuid,uuid)`.
- Sous `cashless_pin` : lire `vendor`/`pin_hash`, toute table hors `audit_log`, exécuter `create_vendor`,
  `set_vendor_pin`, `enroll_device`. `PUBLIC` ou un autre rôle `cashless_*` qui exécute une fonction de la mission ;
  fonction de déclencheur exécutable ; un `EXECUTE` de plus que la liste d'`interfaces.md`.
- Rejouer `post-roles.sql` deux fois (droits identiques ?) ; liste figée élargie sans commentaire ; test qui compte au
  lieu de nommer ; mutation notée mais jamais exécutée ; écart de sécurité non signalé.

## Fichiers à faire relire par une personne
`post-roles.sql` (section 13 et lignes corrigées), `roles.sql` (si modifié), `src/migrate.ts` (mots de passe de rôles),
`tests/tests_11a_rights.sql` (listes attendues).
