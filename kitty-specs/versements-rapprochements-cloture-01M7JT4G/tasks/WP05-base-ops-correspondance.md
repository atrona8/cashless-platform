---
work_package_id: WP05
title: Base des fonctions d'exploitation et de la correspondance comptable
dependencies: []
requirement_refs: [FR-020, FR-021, FR-023, NFR-005, NFR-006, C-005, C-010, C-011]
planning_base_branch: feat/versements-rapprochements-cloture
merge_target_branch: feat/versements-rapprochements-cloture
branch_strategy: Planning artifacts for this mission were generated on feat/versements-rapprochements-cloture. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/versements-rapprochements-cloture unless the human explicitly redirects the landing branch.
base_branch: kitty/mission-versements-rapprochements-cloture-01M7JT4G
base_commit: 2dde9ed9f4a5c1b48903463e667f134088a01d2b
created_at: '2026-11-17T07:06:18.098739+00:00'
subtasks: [T020, T021, T022, T023]
phase: Phase 1 - Fondations
agent: claude
history:
- timestamp: '2026-11-17T12:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: packages/ledger-sql/
create_intent:
- packages/ledger-sql/migrations/0087_ops_functions.sql
- packages/ledger-sql/migrations/0088_account_mapping.sql
- packages/ledger-sql/tests/tests_ops_functions.sql
- packages/ledger-sql/tests/tests_account_mapping.sql
execution_mode: code_change
model: sonnet
owned_files:
- packages/ledger-sql/migrations/0087_ops_functions.sql
- packages/ledger-sql/migrations/0088_account_mapping.sql
- packages/ledger-sql/tests/tests_ops_functions.sql
- packages/ledger-sql/tests/tests_account_mapping.sql
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP05 : Base des fonctions d'exploitation et de la correspondance comptable

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role :
implementer / Agent : claude). Lis ensuite la fiche commune
`docs/passation-9b/fiche-implementation.md`, ce prompt, puis seulement :

- `contracts/interfaces.md` (lignes `ops_*`, `account_mapping`, codes d'alarme) ; `research.md` R-11,
  R-12, R-13, R-14 ; `data-model.md` (`account_mapping`, « Fonctions SQL », invariant 7) ; `spec.md`
  FR-020, FR-021, FR-023, C-005, C-010, C-011 ;
- `schema_grand_livre_cashless.sql` : `seal_ledger`, `ledgers_to_seal`, `verify_ledger_seals` et
  `ledger_seal` (l. 2780-2870), vues de contrôle (l. 934-960), `anomaly` (l. 842-878), `payout`
  (l. 824-840), `assert_tenant` et `tenant_of_ledger` (l. 1706-1716) ;
- `migrations/0004_audit_log.sql` (`audit_log`, `audit_seal`, `audit_platform_chain`, `seal_audit`,
  `verify_audit_chain`) ;
- `migrations/0063_edge_replication.sql` l. 835-863 (`mark_edge_gateways_silent` : le modèle d'une
  fonction d'exploitation sans `assert_tenant`) ;
- `tests/tests_refund_requests.sql` (modèle de suite pgTAP et fixtures).

Priorité des sources (SPECIFICATION §0.3). Contradiction : tu la signales. `interfaces.md` fait foi.

## Objective

Donner au processus `maintenance` (rôle `cashless_maint`, **aucune lecture de table**) des fonctions
étroites qui scellent, copient, vérifient, contrôlent et lèvent des alertes (migration `0087`), et
poser la table versionnée `account_mapping` de l'export comptable (migration `0088`). Aucun droit
accordé : WP06 pose les GRANT. WP12 écrit les travailleurs, WP13 les routes de correspondance.

## Branch Strategy

- Branche de planification et de fusion : `feat/versements-rapprochements-cloture`.
- Worktree alloué par lane, calculé dans `lanes.json`.
- Commande : `LC_ALL=C LANG=C spec-kitty agent action implement WP05 --agent claude --mission
  versements-rapprochements-cloture-01M7JT4G`.

## Périmètre et arbitrages

- Fichiers : uniquement ceux d'`owned_files`. Jamais un `.sql` généré ni le schéma de référence.
  **Aucun GRANT.** `REVOKE ALL ON FUNCTION … FROM PUBLIC` sur chaque fonction nouvelle.
- Toute fonction `ops_*` : `SECURITY DEFINER`, `SET search_path = public, pg_temp`, **sans**
  `assert_tenant` (elle traverse les prestataires), et **ne rend que des identifiants, des compteurs,
  des durées ou des empreintes** : jamais un montant de portefeuille, un numéro, un IBAN, un nom, ni
  le texte d'une requête. Chaque colonne rendue est justifiée en commentaire.
- **Ne duplique pas les algorithmes** de scellement et de vérification : réutilise `seal_ledger`,
  `seal_audit`, `verify_ledger_seals`, `verify_audit_chain`. Celles qui appellent `assert_tenant`
  s'appellent après `set_config('app.operator_id', <prestataire de l'objet>, true)` ; restaure la
  valeur précédente avant de rendre la main (une boucle sur plusieurs prestataires ne doit jamais
  garder le contexte d'un autre). Les tables sous RLS `FORCE` sont lues de la même façon, prestataire
  par prestataire, pour que la fonction marche aussi avec un propriétaire non superutilisateur.
- **Ajout au plan (renforce, à signaler)** : `ops_verify_audit_chain` n'est pas dans la liste de
  `research.md` R-11, mais FR-020 exige la vérification quotidienne des **deux** chaînes et WP12 en a
  besoin. Tu l'ajoutes ; écris-le dans la note de lane.
- **C-011** : `ops_long_transactions` lit `pg_stat_activity`. Sans appartenance du propriétaire à
  `pg_read_all_stats`, les sessions des autres rôles n'y montrent pas leur durée : la fonction rend
  alors une ligne de configuration (`pid` nul, `usename` = `'?config'`) que WP12 transforme en alerte,
  au lieu d'une liste vide silencieuse. Aucun rôle `cashless_*` ne devient membre de
  `pg_read_all_stats` (WP06 l'affirme par un test).
- `account_mapping` : aucun jeu SYSCOHADA (OP-N3, C-007). Les comptes de l'exemple de §12.3
  n'apparaissent que dans les fixtures, marqués « indicatif ».

## Subtasks

### T020 : 0087, scellement, copie et vérification

Signatures figées (WP12 les appelle telles quelles ; un changement se signale) :
- `ops_ledgers_to_seal() RETURNS TABLE (ledger_id uuid, operator_id uuid, unsealed_postings bigint)` :
  tous statuts, `LOCKED` compris (réclamations tardives).
- `ops_seal_ledger(p_ledger uuid) RETURNS TABLE (seal_no int, seal_hash bytea)` : `seal_ledger` avec
  `p_lag` = 5 min, `0` si le grand livre est `LOCKED` ; aucune ligne s'il n'y a rien à sceller.
- `ops_audit_chains_to_seal() RETURNS TABLE (chain_key uuid, operator_id uuid, unsealed_rows bigint)`
  : chaîne de la plateforme comprise (`audit_platform_chain()`, `operator_id` nul).
- `ops_seal_audit(p_chain uuid) RETURNS TABLE (seal_no int, seal_hash bytea)`.
- `ops_record_seal_copy(p_kind text, p_id uuid, p_seal_no int, p_external_ref text) RETURNS boolean`
  : `p_kind` ∈ `LEDGER`, `AUDIT` (sinon `CL001`) ; pose `external_ref` une fois (les gardes
  `ledger_seal_guard` et `audit_seal_guard` le permettent). Même référence déjà posée : `false`, sans
  erreur (rejeu). Référence différente déjà posée : erreur (`CL029`). Scellement inconnu : `P0002`.
- `ops_seals_since(p_window interval) RETURNS TABLE (kind text, id uuid, seal_no int, seal_hash
  bytea, sealed_at timestamptz, external_ref text)` : scellements des deux chaînes créés depuis
  `p_window` (`NULL` = tous, pour la vérification quotidienne), triés.
- `ops_verify_ledger_seals(p_ledger uuid, p_from_seal int DEFAULT 1) RETURNS TABLE (seal_no int, ok
  boolean, seal_hash bytea, external_ref text)` : `verify_ledger_seals` plus la référence externe.
- `ops_verify_audit_chain(p_chain uuid, p_since timestamptz DEFAULT '-infinity') RETURNS TABLE (seq
  bigint, problem text)` : `verify_audit_chain`. Aucune ligne si la chaîne est intègre.

### T021 : 0087, contrôles, alertes, transactions longues

Chaque contrôle ne rend **que les écarts** (aucune ligne = tout va bien) :
- `ops_ledger_controls(p_scope text) RETURNS TABLE (ledger_id uuid, operator_id uuid, control text,
  detail_count bigint)` : grands livres `OPEN` et `CLOSING` seulement. `p_scope = 'FAST'` (5 min) :
  `SUM_ZERO` (`ledger_invariant.must_be_zero <> 0`), `CLAIMS_EQUAL_MONEY`
  (`money_held <> total_claims`). `p_scope = 'SLOW'` (horaire) : `BALANCE_CACHE` (`balance_drift`),
  `HOT_ACCOUNT_SIDE` (`hot_account_side_check`). Autre valeur : `CL001`.
- `ops_overdue_payouts(p_age interval) RETURNS TABLE (payout_id uuid, ledger_id uuid, operator_id
  uuid, initiated_at timestamptz)` : `INITIATED` depuis plus de `p_age` (48 h côté travailleur).
- `ops_unmatched_statements(p_age interval) RETURNS TABLE (account_id uuid, ledger_id uuid,
  operator_id uuid, unmatched bigint, oldest timestamptz)` : lignes de relevé non rapprochées
  (colonnes de rapprochement de `external_statement_line` : celles de WP02 si sa migration `0083` est
  connue, sinon `matched_tx_id` existant ; dis lesquelles tu lis). Plus vieilles que `p_age`.
- `ops_new_open_anomalies(p_since timestamptz) RETURNS TABLE (anomaly_id uuid, operator_id uuid,
  ledger_id uuid, kind text, created_at timestamptz)` : `status = 'OPEN'` et `created_at > p_since`
  (une anomalie déjà signalée ne revient pas).
- `ops_raise_alert(p_code int, p_detail jsonb) RETURNS bigint` : une ligne `audit_log` de la
  plateforme (`operator_id` nul, `action = 'OPS_ALERT'`, `object_type = 'ops_alarm'`, `object_id` =
  code, `after` = détail, `origin = 'maintenance'`), puis `pg_notify('ops_alert', …)` avec seulement
  le code et l'identifiant de la ligne d'audit. Rend cet identifiant. Code hors 7 à 11 : `CL001`.
  Détail : objet JSON de 4 ko au plus, refusé (`CL001`) s'il contient une clé `query`, `iban`,
  `msisdn`, `phone`, `token`, `secret` à n'importe quelle profondeur.
- `ops_long_transactions(p_max interval) RETURNS TABLE (pid int, usename text, application_name
  text, xact_seconds numeric)` : sessions de la base courante dont `now() - xact_start > p_max`, hors
  la session appelante. **Jamais `query`**, ni `client_addr`. Ligne de configuration si la
  visibilité manque (voir arbitrages).

### T022 : 0088, `account_mapping` et `create_account_mapping_version`

- Table selon `data-model.md` : `operator_id`, `entity_party_id`, `version` (int ≥ 1), `valid_from`,
  `purpose`, `transaction_type` (nul = tous), `debit_account`, `credit_account` (texte non vide,
  32 car. au plus), `created_by`, `created_at`. PK (`operator_id`, `entity_party_id`, `version`,
  `purpose`, `transaction_type`) : `transaction_type` nul dans une PK est impossible ; utilise une
  valeur sentinelle `'*'` (CHECK) ou un index unique avec `coalesce`, et dis lequel.
- RLS `tenant_isolation` ENABLE + FORCE ; garde de portée à l'insertion (`entity_party_id` est le
  prestataire ou une partie de ce prestataire) ; ajout seul (déclencheur qui refuse `UPDATE` et
  `DELETE`, et `TRUNCATE` comme les tables de 0063).
- `create_account_mapping_version(p_operator uuid, p_entity uuid, p_valid_from timestamptz, p_lines
  jsonb, p_actor uuid) RETURNS int` : DEFINER, `assert_tenant(p_operator)`, `search_path` figé. Verrou
  consultatif par (prestataire, entité) ; version = précédente + 1 ; `p_valid_from` strictement
  postérieur à celui de la version précédente (`CL001` sinon) ; au moins une ligne ; doublon
  (`purpose`, type) dans le lot : `CL001` ; `p_actor` obligatoire. Rend le numéro de version.
- Lecture : par `SELECT` (droit posé par WP06). Pas de fonction de lecture.

### T023 : pgTAP

`tests_ops_functions.sql` (propriétaire, `BEGIN … ROLLBACK`, `no_plan`) :
- chaque `ops_*` existe avec sa signature exacte, est DEFINER, a `search_path = public, pg_temp`,
  n'est pas exécutable par PUBLIC ;
- scellement : deux prestataires, `ops_seal_ledger` puis `ops_record_seal_copy` ; rejeu même
  référence `false` ; autre référence refusée ; contexte `app.operator_id` rétabli après l'appel ;
  `ops_seals_since(NULL)` rend les deux chaînes, plateforme comprise ;
- altération : une ligne `posting` modifiée (en désactivant le déclencheur dans la transaction de
  test) rend `ok = false` ; une ligne d'audit altérée rend un `problem` (SC-004) ;
- contrôles : chaque contrôle rend zéro ligne sur des données saines, puis une ligne après
  l'injection d'un écart (somme non nulle, cache faux, compte chaud du mauvais sens, versement de
  49 h, ligne de relevé ancienne non rapprochée, anomalie nouvelle) ; un grand livre `LOCKED` est
  ignoré par `ops_ledger_controls` ;
- alerte : ligne `OPS_ALERT` écrite, chaîne de la plateforme, notification émise (`LISTEN` dans la
  suite), détail interdit refusé, code hors bornes refusé ;
- `ops_long_transactions` : le résultat n'a aucune colonne `query` (catalogue) ;
- aucune colonne rendue par un `ops_*` ne s'appelle `amount`, `balance`, `iban`, `msisdn`, `query`
  (test sur `pg_proc.proargnames`) : il échoue si la liste s'élargit.

`tests_account_mapping.sql` : version 1 puis 2 ; `valid_from` non croissant refusé ; doublon refusé ;
`UPDATE`, `DELETE`, `TRUNCATE` refusés ; isolation entre prestataires (RLS et `assert_tenant`) ; entité
d'un autre prestataire refusée.

## Tests et preuves

Depuis la lane (`cd <lane> || exit 1`), base `cashless_wp05`, serveur 5433 (`docker ps`) :

```bash
export PGHOST=127.0.0.1 PGPORT=5433 PGUSER=postgres PGDATABASE=cashless_wp05
R=/Users/xaamga/Documents/omar_sylla_work/cashless/cashless-platform
export PATH=$R/docs/passation-9a/scripts/bin:/Library/PostgreSQL/18/bin:$PATH
bash packages/ledger-sql/scripts/reset-db.sh
cd packages/ledger-sql
pg_prove -d cashless_wp05 tests/tests_ops_functions.sql tests/tests_account_mapping.sql \
  tests/tests_definer_search_path.sql
pg_prove -d cashless_wp05 tests_grand_livre_cashless.sql scenario_reference_test.sql
```

`tests_execute_grants.sql` et `tests_offline_rights.sql` peuvent échouer sur les nouveaux objets tant
que WP06 n'est pas fusionné : normal, ne les touche pas, cite les assertions dans le compte rendu.

## Definition of Done

- [ ] `0087` : huit fonctions de scellement et de vérification, six de contrôle et d'alerte, aux
      signatures ci-dessus ; DEFINER, `search_path` figé, `REVOKE … FROM PUBLIC`, aucun GRANT.
- [ ] `0088` : `account_mapping` sous RLS, en ajout seul, gardée ; `create_account_mapping_version`.
- [ ] Les deux suites vertes ; suites générées et `tests_definer_search_path.sql` vertes.
- [ ] Note de lane : signatures réelles, colonnes de rapprochement lues, choix de la PK,
      `ops_verify_audit_chain` ajoutée, comportement sans `pg_read_all_stats`.

## Ce que le relecteur doit casser

- Un `ops_*` qui rend un montant, un numéro, un IBAN, un nom ou un texte de requête ; un détail
  d'alerte qui laisse passer une clé interdite imbriquée.
- Un `ops_*` qui laisse `app.operator_id` posé après lui (appel suivant dans la même transaction) ou
  qui ne voit rien sous RLS `FORCE` avec un propriétaire non superutilisateur.
- Un contrôle qui ne détecte pas l'écart injecté, ou qui le signale sur un grand livre `LOCKED` ;
  une anomalie déjà vue rendue de nouveau.
- `ops_record_seal_copy` qui réécrit une référence ; `ops_seal_ledger` qui scelle un `LOCKED` avec
  5 min de retard.
- `account_mapping` modifiable ou supprimable ; version qui saute ou recule ; mappage d'une entité
  d'un autre prestataire.
- Un GRANT introduit ; une fonction exécutable par PUBLIC ; un `.sql` généré modifié.

## Fichiers à faire relire par une personne

- `packages/ledger-sql/migrations/0087_ops_functions.sql` : changement de contexte de prestataire,
  colonnes rendues, `ops_raise_alert`, `ops_long_transactions`.
- `packages/ledger-sql/migrations/0088_account_mapping.sql` : garde et ajout seul.
