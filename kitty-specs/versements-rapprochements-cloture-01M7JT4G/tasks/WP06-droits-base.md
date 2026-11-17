---
work_package_id: WP06
title: Droits de la base de la mission (post-roles.sql section 12)
dependencies: [WP02, WP03, WP04, WP05]
requirement_refs: [C-005, C-008, C-011, FR-024]
planning_base_branch: feat/versements-rapprochements-cloture
merge_target_branch: feat/versements-rapprochements-cloture
branch_strategy: Planning artifacts for this mission were generated on feat/versements-rapprochements-cloture. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/versements-rapprochements-cloture unless the human explicitly redirects the landing branch.
subtasks: [T024, T025, T026, T027]
phase: Phase 2 - Droits de la base
agent: claude
history:
- timestamp: '2026-11-17T12:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: packages/ledger-sql/post-roles.sql
create_intent:
- packages/ledger-sql/tests/tests_9b_rights.sql
execution_mode: code_change
model: sonnet
owned_files:
- packages/ledger-sql/post-roles.sql
- packages/ledger-sql/tests/tests_9b_rights.sql
- packages/ledger-sql/tests/tests_execute_grants.sql
- packages/ledger-sql/tests/tests_offline_rights.sql
- apps/api/test/support/db.ts
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP06 : Droits de la base de la mission (`post-roles.sql` section 12)

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role :
implementer / Agent : claude). Lis ensuite la fiche commune
`docs/passation-9b/fiche-implementation.md`, ce prompt, puis seulement :

- les notes de lane de WP02, WP03, WP04 et WP05, et leurs migrations `0083` à `0088` telles que
  fusionnées (**les signatures réelles font foi**, pas celles de ce prompt) ;
- `data-model.md` (« Tables existantes modifiées », « Fonctions SQL », invariants 6 et 7) ;
  `contracts/interfaces.md` ; `research.md` R-11 à R-13 ; `spec.md` C-005, C-011, FR-024 ;
- `post-roles.sql` : en-tête et section 0 (l. 1-165 : défaut des fonctions futures, `REVOKE` de
  `roles.sql`), sections 8g, 9f et 11 (l. 908-911, 1034-1081 : modèles directs) ;
- `roles.sql` (ce qu'il accorde à `cashless_app` : SELECT, INSERT, UPDATE sur toutes les tables et
  EXECUTE sur toutes les fonctions, que `post-roles.sql` doit reprendre) ;
- `tests/tests_execute_grants.sql` (listes figées par rôle, §1 à §4) et `tests/tests_offline_rights.sql`
  (modèle de suite de droits sous `SET ROLE`) ; `apps/api/test/support/db.ts` (rôles des tests Jest).

Priorité des sources (SPECIFICATION §0.3). Contradiction : tu la signales. `interfaces.md` fait foi.

## Objective

Poser et prouver tous les droits des objets de la mission dans une section 12 de `post-roles.sql` :
`cashless_app` lit les tables nouvelles ou modifiées et n'écrit que par les fonctions nommées ;
`cashless_maint` n'exécute que les `ops_*` et ne lit aucune table ; aucune fonction de déclencheur
n'est exécutable ; personne n'a `DELETE`. Mettre à jour les listes figées existantes pour qu'elles
nomment exactement les ajouts. Ce lot débloque toutes les routes (WP07 à WP13).

## Branch Strategy

- Branche de planification et de fusion : `feat/versements-rapprochements-cloture`.
- Worktree alloué par lane, calculé dans `lanes.json` ; base qui contient WP02 à WP05.
- Commande : `LC_ALL=C LANG=C spec-kitty agent action implement WP06 --agent claude --mission
  versements-rapprochements-cloture-01M7JT4G`.

## Périmètre et arbitrages

- Fichiers : uniquement ceux d'`owned_files`. Aucune migration : un objet mal défini par WP02 à WP05
  se signale à l'orchestrateur, il ne se corrige pas ici.
- **Moindre droit (règle 1)** : n'accorde rien qui ne soit appelé par une route ou un travailleur
  prévu. Un droit que tu crois nécessaire et qui n'est pas listé ci-dessous : décris-le (qui
  l'appelle, risque, options) et attends le porteur. Un droit retiré de plus (renforcement) se fait
  et se signale.
- `roles.sql` rend EXECUTE de **toutes** les fonctions à `cashless_app` : chaque fonction nouvelle
  qui ne lui est pas destinée (`ops_*`, fonctions de déclencheur, gardes, internes) doit lui être
  retirée **explicitement** dans la section 12, et la liste figée de `tests_execute_grants.sql` le
  prouve.
- **Ancienne signature** `refund_deposit_for_session(uuid, uuid)` : elle garde ses droits actuels
  (WP11 bascule l'appel ; une mission ultérieure la retire). Nouvelle signature à quatre arguments :
  `cashless_app`.
- **`pg_read_all_stats` (C-011, R-13)** : aucun rôle `cashless_*` n'en devient membre. Le propriétaire
  de `ops_long_transactions` est le rôle qui joue les migrations : superutilisateur en local, donc
  rien à faire ici. Un `GRANT pg_read_all_stats TO <propriétaire>` n'est **pas** écrit dans
  `post-roles.sql` : c'est un réglage de déploiement (WP14 le consigne). Écris-le dans ta note.
- Lignes de 100 caractères ; commentaires en tête de chaque bloc qui disent qui appelle quoi.

## Subtasks

### T024 : section 12, `cashless_app`

En tête : `-- 12. Versements, rapprochements et clôture (migrations 0083 à 0088 ; mission 9b, WP06).`
- **Tables, lecture seule** : `REVOKE ALL` puis `GRANT SELECT` sur `closing_step`, `statement_import`,
  `account_mapping`, `payout`, `external_statement_line`. Aucun `INSERT`, `UPDATE`, `DELETE`,
  `TRUNCATE` (écriture par fonctions DEFINER seulement). Vérifie d'abord qu'aucun code de
  `apps/api/src` n'écrit `payout` ni `external_statement_line` (recherche faite au plan : aucun) et
  dis-le dans la note.
- **Fonctions accordées** (signatures réelles des migrations) : `set_event_status` et
  `event_transition_conditions` (redéfinies : vérifie que le droit existant survit au `CREATE OR
  REPLACE`, ou qu'il est reposé), `record_closing_step`, `create_payout_batch`, `settle_payout`,
  `import_statement_lines`, `match_statement_line`, `account_reconciliation`,
  `refund_deposit_for_session` à quatre arguments, `refund_deposit` à quatre arguments (seulement si
  le code TypeScript l'appelle directement : sinon retirée), `create_account_mapping_version`.
- **Fonctions retirées à `cashless_app`** : tous les `ops_*`, toutes les fonctions de déclencheur et
  gardes de `0083` à `0088` (dont `refund_request_transition_guard` et celles de `payout`,
  `statement_import`, `external_statement_line`, `closing_step`, `account_mapping`), toute fonction
  interne non appelée par l'API. Une fonction de déclencheur n'est exécutable par **aucun** rôle.

### T025 : section 12, `cashless_maint` et propriétaire

- `GRANT EXECUTE` à `cashless_maint` sur les **quatorze** `ops_*` de `0087` (dont
  `ops_verify_audit_chain`, ajoutée par WP05) et sur rien d'autre de la mission.
- Aucune lecture de table pour `cashless_maint` (ni `SELECT`, ni `pg_read_all_stats`, ni
  `pg_signal_backend`).
- Aucun autre rôle `cashless_*` (`platform`, `tagkeys`, `perso`, `tagcheck`, `keyadmin`,
  `snapcontent`, `snapsign`, `edge`, `edgeadmin`) n'obtient un droit sur un objet de la mission.

### T026 : pgTAP `tests_9b_rights.sql`

Sur le modèle de `tests_offline_rights.sql` (BEGIN, `_grants_for_tests.sql`, `no_plan`) :
- **listes exactes** : pour chaque rôle `cashless_*`, l'ensemble des fonctions de `0083` à `0088`
  qu'il exécute est égal à la liste attendue (`set_eq` sur `regprocedure`) : la suite échoue si une
  fonction s'ajoute ; idem pour les privilèges de table (`table_privs_are` ou catalogue) sur les cinq
  tables ;
- **sous `SET ROLE cashless_app`** : `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE` refusés (`42501`) sur
  chacune des cinq tables ; un appel de `ops_seal_ledger` refusé ; les fonctions accordées
  s'appellent (au moins `account_reconciliation` et `record_closing_step` sur une fixture) ;
- **sous `SET ROLE cashless_maint`** : `SELECT` refusé sur `posting`, `payout`, `audit_log`,
  `ledger_seal`, `external_statement_line`, `anomaly` ; chaque `ops_*` s'appelle et rend un résultat
  correct sur une fixture à deux prestataires (le contrôle d'une somme non nulle y est vu) : la
  preuve que les fonctions marchent **sous le rôle réel**, RLS comprise ;
- `pg_read_all_stats`, `pg_signal_backend` : aucun rôle `cashless_*` n'en est membre
  (`pg_auth_members`) ;
- aucune fonction de déclencheur de la mission exécutable par un rôle quelconque, PUBLIC compris ;
- tests de sécurité de RLS : `cashless_app` avec `app.operator_id` du prestataire A ne voit aucune
  ligne de B dans les cinq tables.

### T027 : listes figées existantes

- `tests_execute_grants.sql` : ajoute à la liste de `cashless_app` et à celle de `cashless_maint`
  exactement les fonctions de T024 et T025 ; ajoute les fonctions de déclencheur et internes à la
  liste « exécutables par aucun rôle ». Commentaire : mission 9b, WP06.
- `tests_offline_rights.sql` : seulement si une de ses listes compte les fonctions de `public` et
  casse ; même règle (ajout exact, commenté).
- **Retouches hors carte nommées (suites de la 9a cassées par WP04, déclencheur OP-N130 et
  surcharge de `refund_deposit_for_session`)** : `tests/tests_cash_sessions.sql` tests 9 et 10
  (comptes de fonctions par nom : la surcharge à quatre arguments en ajoute une ; compter par
  signature ou relever le compte, avec commentaire) ; `tests/tests_refund_requests.sql` l. 192
  (fixture qui force `REQUESTED` → `CANCELLED`, désormais refusé : créer la fixture directement
  dans l'état voulu par `INSERT`, sans désactiver le déclencheur). Chacune listée dans la note de
  lane. Ne touche pas aux Jest de `test/integration/refunds/` (WP11).
- **Autre liste figée hors carte nommée** : `tests/tests_definer_trigger_writers.sql` (test 16, qui voit
  les nouvelles tables et gardes de `0083` à `0088`) : ajout exact et commenté, comme ci-dessus.
- `apps/api/test/support/db.ts` : seulement si les tests Jest ont besoin d'un rôle nouveau ou d'un
  droit de fixture (par exemple insérer un `payout` en propriétaire). Sinon, ne le touche pas et dis-le.

## Tests et preuves

Depuis la lane (`cd <lane> || exit 1`), base `cashless_wp06`, serveur 5433 (`docker ps`) :

```bash
export PGHOST=127.0.0.1 PGPORT=5433 PGUSER=postgres PGDATABASE=cashless_wp06
R=/Users/xaamga/Documents/omar_sylla_work/cashless/cashless-platform
export PATH=$R/docs/passation-9a/scripts/bin:/Library/PostgreSQL/18/bin:$PATH
bash packages/ledger-sql/scripts/reset-db.sh
cd packages/ledger-sql
pg_prove -d cashless_wp06 tests/tests_9b_rights.sql tests/tests_execute_grants.sql \
  tests/tests_offline_rights.sql tests/tests_cash_psp_rights.sql tests/tests_payment_rights.sql \
  tests/tests_device_rights.sql tests/tests_edge_rights.sql tests/tests_definer_search_path.sql
pg_prove -d cashless_wp06 tests/tests_statements.sql tests/tests_closing_conditions.sql \
  tests/tests_payouts.sql tests/tests_refund_transitions.sql tests/tests_ops_functions.sql \
  tests/tests_account_mapping.sql tests/tests_refund_requests.sql
```

Puis un Jest ciblé qui touche `payout` ou `external_statement_line` (s'il en existe un, sinon dis-le)
selon la fiche commune.

## Definition of Done

- [ ] Section 12 de `post-roles.sql` : lecture seule des cinq tables pour `cashless_app`, fonctions
      nommées, retraits explicites ; `ops_*` à `cashless_maint` seul ; aucun DELETE.
- [ ] `tests_9b_rights.sql` vert, avec listes exactes qui échouent si elles s'élargissent, et appels
      réels sous `cashless_maint`.
- [ ] Suites de droits existantes vertes avec leurs listes mises à jour ; suites des lots WP02 à WP05
      toujours vertes après `post-roles.sql`.
- [ ] Note de lane : liste finale des droits par rôle, réglage `pg_read_all_stats` de déploiement,
      `db.ts` touché ou non.

## Ce que le relecteur doit casser

- Une écriture directe par `cashless_app` sur une des cinq tables (y compris `UPDATE` d'une seule
  colonne) ; un `DELETE` ou `TRUNCATE` resté de `roles.sql`.
- Un `ops_*` exécutable par `cashless_app` ; une fonction de déclencheur exécutable ; un droit
  accordé à un rôle `cashless_*` hors de `app` et `maint`.
- `cashless_maint` qui lit une table, ou un `ops_*` qui échoue sous `cashless_maint` (RLS) alors
  qu'il passe en propriétaire.
- `set_event_status` redéfinie qui a perdu son droit (route de statut cassée) ou l'a rendu à PUBLIC.
- Une liste figée élargie sans commentaire, ou un test qui compte au lieu de nommer.

## Fichiers à faire relire par une personne

- `packages/ledger-sql/post-roles.sql`, section 12 (droits de la base).
- `packages/ledger-sql/tests/tests_9b_rights.sql` : les listes attendues.
