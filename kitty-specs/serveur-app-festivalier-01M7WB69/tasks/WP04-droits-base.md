---
work_package_id: WP04
title: Droits de la base (post-roles.sql section 14), rôle cashless_claimadmin et environnements
dependencies: [WP01, WP02, WP03]
requirement_refs:
- FR-004
- C-004
planning_base_branch: feat/serveur-app-festivalier
merge_target_branch: feat/serveur-app-festivalier
branch_strategy: Planning artifacts for this mission were generated on feat/serveur-app-festivalier. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/serveur-app-festivalier unless the human explicitly redirects the landing branch.
subtasks: [T014, T015, T016, T017]
phase: Phase 1 - Base de données
agent: claude
history:
- timestamp: '2026-11-20T10:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: packages/ledger-sql/post-roles.sql
create_intent:
- packages/ledger-sql/tests/tests_10a_rights.sql
execution_mode: code_change
model: sonnet
owned_files:
- packages/ledger-sql/roles.sql
- packages/ledger-sql/post-roles.sql
- packages/ledger-sql/tests/tests_10a_rights.sql
- packages/ledger-sql/tests/tests_execute_grants.sql
- packages/ledger-sql/tests/tests_11a_rights.sql
- packages/ledger-sql/tests/tests_9b_rights.sql
- tools/dev-db/env.sh
- .github/workflows/ledger-tests.yml
- packages/ledger-sql/src/migrate.ts
- apps/gateway/test/support/disposable-databases.ts
- apps/api/test/support/db.ts
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP04 : Droits de la base, rôle `cashless_claimadmin`, environnements

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role :
implementer / Agent : claude). Lis ensuite la fiche commune
`docs/passation-10a/fiche-implementation.md`, ce prompt, puis seulement :

- les notes de lane de WP01, WP02 et WP03 et leurs migrations `0096` à `0099` **telles que
  fusionnées** (signatures réelles : elles font foi sur `interfaces.md`) ; `interfaces.md` (table «
  Base de données », paragraphe `EXECUTE` de `cashless_app`, rôle `cashless_claimadmin`) ; `plan.md`
  IC-01, IC-04, IC-06 et « Écarts de sécurité » ; `spec.md` FR-006, FR-007, NFR-002, NFR-003 ;
- `packages/ledger-sql/post-roles.sql` : l. 165-185 (retraits et `GRANT` de colonne sur `media`), l.
  186 (`REVOKE` de `register_personalized_media`), l. 241-252 (`claim_code`, `media_claim`), l.
  310-312 (`cashless_perso`), l. 424-447 (liste 4a de `cashless_app`), l. 650 (identification), l.
  776-800 (section 8b : création de `cashless_pin`, **modèle de création d'un rôle de processus**),
  l. 1045-1066 (section 10 : droits d'une table d'authentification), l. 1146-1203 (section 13,
  **modèle de la section 14**) ; `roles.sql` l. 1-30 (ce que `roles.sql` rend à `cashless_app`) ;
- `packages/ledger-sql/src/migrate.ts` l. 120-175 ; `tools/dev-db/env.sh` l. 38-66 ;
  `.github/workflows/ledger-tests.yml` l. 40-80 ;
  `apps/gateway/test/support/disposable-databases.ts` l. 72-160 ; `apps/api/test/support/db.ts` l.
  14-60 ;
- `tests/tests_11a_rights.sql` (modèle de suite : fixtures l. 1-60, listes exactes l. 61-100, `SET
  LOCAL ROLE` l. 149 et 202), `tests_11a_bounds.sql` l. 95-175 (surface exacte d'un rôle de
  processus), `tests_execute_grants.sql` l. 55-125 (liste de `cashless_app`), l. 205-218, l.
  300-312, l. 372-396, l. 405-415, l. 455-475.

Priorité des sources (SPECIFICATION §0.3). `interfaces.md` fait foi ; contradiction ou manque : tu
la signales, tu ne la tranches pas en silence.

## Objective

Poser et prouver **tous** les droits de la mission dans une section 14 de `post-roles.sql`, seul lot
qui l'écrit (hors les lignes de signatures corrigées par WP02) : `cashless_app` gagne exactement
quatre `EXECUTE` (`create_kyc_verification`, `revoke_kyc_verification`,
`wallet_pending_offline_notice`, `claim_key_version_max`), la table `otp_channel_attempt` reçoit ses
droits, et le rôle `cashless_claimadmin` apparaît avec **trois** `EXECUTE` et **aucun** droit de
table. **Ne rouvre jamais un droit pour faire passer un test.** WP05 à WP10 en dépendent.

## Context

- **Liste finale** (`interfaces.md`, fait foi) : `cashless_app` = liste d'avant (signatures
  versionnées déjà corrigées par WP02), plus les quatre ; **jamais** `reissue_claim_codes` ni
  `reissuable_media`. `cashless_perso` garde ses deux fonctions. `cashless_claimadmin` :
  `reissue_claim_codes(uuid, uuid, uuid[], bytea[], smallint)`, `reissuable_media(uuid, uuid,
  smallint)` et `claim_key_version_max()` seulement. Tout autre `EXECUTE` jugé nécessaire :
  décris-le (appelant, risque, options), ne le code pas (règle 1), continue.
- **Fait à signaler** : le rôle `cashless_pin` n'est **pas** dans `roles.sql` mais créé en section
  8b de `post-roles.sql` (l. 776-800) ; `roles.sql` n'a donc probablement rien à changer : dis-le si
  tu n'y touches pas. Le rôle `cashless_claimadmin` se crée en section 14 (décision
  `interfaces.md`).
- **Pièges de séquence** : (1) **WP02 a déjà commité** la correction des lignes de `post-roles.sql`
  qui nomment les signatures retirées (l. 186, 310-311, 427, 437, 439) : **ne les réécris pas**,
  vérifie seulement que `reset-db.sh` passe ; (2) `media_session_operator()`,
  `claim_session_operator()` et les helpers de la liste 4a **restent** accordés ; (3) `roles.sql`
  rend `SELECT, INSERT, UPDATE` sur toute table nouvelle : retire ce qui dépasse. (4) Le calcul des
  colonnes lisibles de `media` (l. 170-177) couvre `claim_key_version` et `printed_number` :
  prouve-le, n'ajoute rien.
- Retouches hors carte nommées : `tools/dev-db/env.test.example` (l. 16 et 22 :
  `CASHLESS_CLAIMADMIN_PASSWORD`, `DATABASE_URL_CLAIMADMIN`) ; `docs/SERVICES-EXTERNES.md` l. 57 (un
  mot) ; `.github/CI.md` seulement si tu y trouves la liste des rôles. Rien d'autre.

## Subtasks

### T014 : rôle `cashless_claimadmin` et section 14 de `post-roles.sql`

Après la section 13 (l. 1203), en-tête « 14. Serveur de l'app festivalier, mission 10a (WP04 ;
FR-006, FR-007, NFR-003). Rejouable. A FAIRE RELIRE PAR UNE PERSONNE ». Sous-sections :
- **14a création** : bloc `DO` calqué sur 8b (l. 776-800) pour `cashless_claimadmin` seul : `CREATE
  ROLE ... LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT` si absent, `ALTER ROLE`
  des quatre délais, `REVOKE ALL` sur tables, séquences, routines, `GRANT USAGE ON SCHEMA public`,
  `REVOKE TEMPORARY ON DATABASE`. Mot de passe hors fichier (`CASHLESS_CLAIMADMIN_PASSWORD`, T016).
- **14b signatures versionnées** : rien à écrire (WP02). Prouve par `tests_10a_rights.sql` que les
  droits de `cashless_app` et `cashless_perso` sur les cinq fonctions sont **ceux d'avant**.
- **14c `cashless_app`** : `GRANT EXECUTE ON FUNCTION create_kyc_verification(uuid, uuid, text,
  text, text, date, uuid), revoke_kyc_verification(uuid, uuid, text),
  wallet_pending_offline_notice(uuid), claim_key_version_max() TO cashless_app` (signatures
  réelles). `kyc_verification` : le `REVOKE INSERT, UPDATE` de la l. 650 **reste** (les fonctions
  `DEFINER` écrivent) ; mets à jour son commentaire (« FR-021 à FR-023 : fonctions accordées en
  section 14 »). `otp_channel_attempt` : `REVOKE UPDATE ... FROM cashless_app` puis `GRANT UPDATE
  (confirmed_at, failed_reason)` ; `REVOKE DELETE, TRUNCATE` redit ; `INSERT` et `SELECT` hérités de
  `roles.sql`.
- **14d `cashless_claimadmin`** : `GRANT EXECUTE ON FUNCTION reissue_claim_codes(uuid, uuid, uuid[],
  bytea[], smallint), reissuable_media(uuid, uuid, smallint), claim_key_version_max() TO
  cashless_claimadmin` ; `REVOKE EXECUTE` de `reissue_claim_codes` et `reissuable_media` de `PUBLIC`
  et de **tous** les autres rôles `cashless_*` (dont `cashless_app`) ; `claim_key_version_max()` :
  de `PUBLIC` et des autres rôles, sauf `cashless_app`. Aucun `GRANT ... ON ALL`.
- Les fonctions de WP01 à WP03 sont `REVOKE ... FROM PUBLIC` dans leurs migrations ; redis-le ici
  pour qu'un oubli ailleurs ne les rende pas.
- Validation : `reset-db.sh` passe ; rejouer `post-roles.sql` deux fois donne les mêmes droits.

### T015 : listes figées et suites de droits existantes

Chaque liste élargie ou réduite est **nommée** et commentée « mission 10a, WP04 » (jamais remplacée
par un compte).
- `tests_execute_grants.sql` : l. 72, 74, 75, 88, 95 (signatures versionnées de `cashless_app`) ;
  ajoute les quatre fonctions nouvelles à la liste de `cashless_app` (l. 117-121, avec le
  commentaire) ; l. 214 (liste « non exécutable » : `register_personalized_media` à la signature
  nouvelle, plus `reissue_claim_codes(...)` et `reissuable_media(...)`) ; l. 306-309 (liste de
  `cashless_perso`) ; nouvelle liste figée de `cashless_claimadmin` (exactement trois fonctions)
  après l. 380 ; `cashless_claimadmin` dans les tableaux de rôles l. 61, 393, 413, 462 et la sonde
  de fonction future l. 472. Ne change **aucune** autre liste.
- `tests_11a_rights.sql` : `issue_claim_codes(uuid,bytea[])` l. 70 et 89 passe à la signature
  nouvelle (les douze signatures de la mission doivent toujours exister) ; `tests_9b_rights.sql` l.
  135 : ajoute `cashless_claimadmin` à la liste des rôles sans droit sur les objets de la 9b.
- Cherche les balayages de tables et de rôles qui échoueront par la seule présence de
  `cashless_claimadmin` ou d'`otp_channel_attempt` : `grep -ln "relkind =
  'r'\|table_privileges\|LIKE 'cashless" tests/*.sql` (`tests_11a_bounds.sql`,
  `tests_offline_rights.sql`, `tests_edge_rights.sql`, `tests_cash_psp_rights.sql`,
  `tests_definer_trigger_writers.sql`). Lance-les ; modifie **seulement** une liste qui nomme un
  objet de la mission et dont l'échec est l'effet attendu ; les autres suites ne sont pas à toi :
  signale-les.
- Les suites **fonctionnelles** de WP02 (`tests_media_claims.sql`, etc.) ne sont pas à toi.

### T016 : environnements (rôle présent partout où un rôle doit exister)

- `post-roles.sql` : voir T014. `packages/ledger-sql/src/migrate.ts` : ajoute, après l. 166,
  `['cashless_claimadmin', report.postRoles ? process.env.CASHLESS_CLAIMADMIN_PASSWORD :
  undefined]`. Mot de passe absent en production : le rôle reste sans mot de passe (comme
  `cashless_pin`) ; le refus des rôles de la passerelle (l. 140-145) est le modèle si le porteur le
  veut : **signale-le**.
- `tools/dev-db/env.sh` : `CASHLESS_CLAIMADMIN_PASSWORD="${...:-cashless_claimadmin_local}"` après
  l. 47 et `DATABASE_URL_CLAIMADMIN` (même motif que `DATABASE_URL_PIN`, l. 65).
- `.github/workflows/ledger-tests.yml` après l. 76 : `CASHLESS_CLAIMADMIN_PASSWORD:
  cashless_claimadmin_ci` et `DATABASE_URL_CLAIMADMIN:
  postgres://cashless_claimadmin:cashless_claimadmin_ci@localhost:5432/cashless_test` ; vérifie par
  `grep -n "CASHLESS_.*_PASSWORD" .github/workflows/*.yml` qu'aucun autre job ne pose les rôles
  (**piège de la PR #20** : mot de passe absent en CI, connexion refusée en `28P01`).
- `apps/gateway/test/support/disposable-databases.ts` : `claimadmin: string` dans `CentralUrls` (l.
  77-93), `claimadmin: url('cashless_claimadmin')` (l. 112), `'claimadmin'` dans la boucle des mots
  de passe de `centralEnv` (l. 120-133) et `DATABASE_URL_CLAIMADMIN: u.claimadmin` dans le retour.
- `apps/api/test/support/db.ts` après l. 59 : `export const CLAIMADMIN_URL = roleUrl(
  'DATABASE_URL_CLAIMADMIN', 'cashless_claimadmin', 'CASHLESS_CLAIMADMIN_PASSWORD');`.
- Validation : `reset-db.sh` ; `psql "$DATABASE_URL_CLAIMADMIN" -c 'select 1'` ; `npx tsc --noEmit
  -p apps/api/tsconfig.json` ; `npx eslint` sur les fichiers TypeScript touchés.

### T017 : `tests_10a_rights.sql` et tests de borne

Modèle `tests_11a_rights.sql` (`BEGIN`, `_grants_for_tests.sql`, `no_plan`, `SET LOCAL ROLE`,
`ROLLBACK`). Fixtures : deux prestataires, événement, grand livre, portefeuille avec client et
numéro vérifié, agent, lot `PUBLIC`, bracelet, défi `otp_challenge`.
- **Listes exactes** (`set_eq`, couples rôle-fonction sur tous les `cashless_*` et `PUBLIC`) : les
  trois fonctions de la mission exécutables par `cashless_app` seul ; `reissue_claim_codes`,
  `reissuable_media` par `cashless_claimadmin` seul ; `claim_key_version_max` par `cashless_app` et
  `cashless_claimadmin` ; les cinq fonctions versionnées par les rôles d'avant (API,
  personnalisation, API publique) ; aucune ancienne signature (`to_regprocedure` nul).
- **Borne de sécurité** : sous `SET ROLE cashless_app`, `reissue_claim_codes(...)` et
  `reissuable_media(...)` : `42501` ; `claim_key_version_max()` : contrôle positif ; `INSERT` et
  `UPDATE` de `kyc_verification` : `42501` ; `UPDATE media SET printed_number` ou
  `claim_key_version` : `42501` ; contrôles positifs : `create_kyc_verification` (appel aboutissant,
  ou `CL060`), `wallet_pending_offline_notice`, `SELECT` de `media.claim_key_version`, `INSERT INTO
  otp_channel_attempt`, `UPDATE ... SET confirmed_at`.
- **`otp_channel_attempt`** : `has_column_privilege('cashless_app', ..., 'UPDATE')` vrai pour
  exactement `confirmed_at` et `failed_reason` ; `UPDATE ... SET channel` : `42501` ; aucun
  `DELETE`, `TRUNCATE`.
- **`cashless_claimadmin`**, surface exacte (modèle `tests_11a_bounds.sql` l. 95-175) : aucun droit
  de table, de colonne, de séquence ; trois `EXECUTE` ; `USAGE` du schéma seul ; pas de `TEMPORARY`
  ; `rolcanlogin` et ni `rolsuper`, `rolcreaterole`, `rolcreatedb`, `rolbypassrls`, `rolreplication`
  ; membre d'aucun rôle ; sous `SET ROLE cashless_claimadmin` : les trois fonctions s'appellent sur
  la fixture, `SELECT` sur `media`, `claim_code`, `audit_log`, `party` : `42501`.
- Le test de borne de C-005 reste celui de WP01.

## Tests et preuves

Base `cashless_wp04`, depuis la lane ; `reset-db.sh` doit **réussir** :

```bash
export PGHOST=127.0.0.1 PGPORT=5433 PGUSER=postgres PGDATABASE=cashless_wp04
R=/Users/xaamga/Documents/omar_sylla_work/cashless/cashless-platform
export PATH=$R/docs/passation-9a/scripts/bin:/Library/PostgreSQL/18/bin:$PATH
bash packages/ledger-sql/scripts/reset-db.sh && cd packages/ledger-sql
pg_prove -d cashless_wp04 tests/tests_10a_rights.sql tests/tests_11a_rights.sql \
  tests/tests_11a_bounds.sql tests/tests_9b_rights.sql tests/tests_execute_grants.sql \
  tests/tests_definer_trigger_writers.sql tests/tests_media_roles.sql tests/tests_media_claims.sql \
  tests/tests_personalization_definer.sql tests/tests_kyc_functions.sql \
  tests/tests_claim_key_version.sql tests/tests_pending_offline_notice.sql \
  tests/tests_otp_channel_attempt.sql tests/tests_default_acl.sql tests/tests_customer_auth.sql
```

Non-régression des environnements : `SKIP_LATENCY=1 npx jest test/unit/processes.spec.ts --runInBand
--forceExit` depuis `apps/api` et `npx jest test/integration/transverse/migrate-rights.spec.ts
--runInBand --forceExit` (après `source ../../tools/dev-db/env.sh` avec `PGDATABASE=cashless_wp04`).

## Branch Strategy

- Planification et fusion : `feat/serveur-app-festivalier`. Worktree de lane calculé par
  `lanes.json`.
- Commande : `LC_ALL=C LANG=C spec-kitty agent action implement WP04 --agent claude --mission
  serveur-app-festivalier-01M7WB69`.

## Definition of Done

- [ ] Section 14 : `cashless_claimadmin`, quatre `EXECUTE` ajoutés à `cashless_app`, droits de
      `otp_channel_attempt`, `reissue_claim_codes`, `reissuable_media` et `claim_key_version_max` à
      `cashless_claimadmin` ; lignes de signatures de WP02 intactes ; aucun droit de table ou de
      colonne ajouté à `cashless_app` (NFR-003) hors les deux colonnes de `otp_channel_attempt`.
- [ ] Rôle présent dans `migrate.ts`, `env.sh`, workflow, `disposable-databases.ts`, `db.ts`.
- [ ] `tests_10a_rights.sql` vert, listes exactes ; suites de droits existantes et suites de WP01 à
      WP03 vertes après `post-roles.sql` rejoué (deux fois).
- [ ] **Mutations vérifiées**, rejouées dans une transaction de test puis rétablies, identifiant du
      test qui échoue noté : (a) `GRANT EXECUTE ON reissue_claim_codes(...) TO cashless_app` ; (b)
      `GRANT INSERT ON kyc_verification TO cashless_app` ; (c) `GRANT SELECT ON media TO
      cashless_claimadmin` ; (d) `GRANT UPDATE ON otp_channel_attempt TO cashless_app` (table
      entière) ; (e) `GRANT EXECUTE ON reissue_claim_codes(...) TO PUBLIC`.
- [ ] Note de lane : droits finaux par rôle, les trois faits du Context, retouches hors carte, mot
      de passe en production, mutations.

## Risks

- Un droit rouvert pour qu'un test passe : interdit. Prouve l'état final par
  `has_function_privilege` et `has_table_privilege` (le fichier est rejoué dans l'ordre).
- Mot de passe du rôle absent en CI (PR #20) : le test de connexion Jest échoue en `28P01`, pas en
  SQL.
- Liste figée remplacée par un compte : refus ; nomme chaque fonction.

## Ce que le relecteur doit casser

- Sous `cashless_app` : exécuter `reissue_claim_codes`, `reissuable_media` ; écrire
  `kyc_verification`, `media.printed_number`, `media.claim_key_version` ; `UPDATE
  otp_channel_attempt SET channel`, `DELETE`.
- Sous `cashless_claimadmin` : lire une table, exécuter une autre fonction, `INSERT` d'audit, créer
  un objet, `TEMPORARY`. `PUBLIC` ou un autre `cashless_*` qui exécute une fonction de la mission ;
  fonction de déclencheur exécutable ; un `EXECUTE` de plus que la liste d'`interfaces.md`.
- Rejouer `post-roles.sql` deux fois ; liste figée élargie sans commentaire ; mutation notée mais
  jamais exécutée ; écart de sécurité non signalé ; variable d'environnement oubliée dans un
  fichier.

## Fichiers à faire relire par une personne

`post-roles.sql` (section 14), `src/migrate.ts` (mots de passe de rôles),
`tests/tests_10a_rights.sql` (listes attendues et surface de `cashless_claimadmin`).
