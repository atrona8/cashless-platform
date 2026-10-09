---
work_package_id: WP03
title: 'Rôle et portée plateforme en base (migration 0009, post-roles)'
dependencies:
- WP02
requirement_refs:
- FR-001
- FR-019
planning_base_branch: feat/configuration-parties-evenements
merge_target_branch: feat/configuration-parties-evenements
branch_strategy: Planning artifacts for this mission were generated on feat/configuration-parties-evenements. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/configuration-parties-evenements unless the human explicitly redirects the landing branch.
subtasks:
- T010
- T011
- T012
- T013
phase: 'Phase 1 - Base de données'
history:
- timestamp: '2026-10-09T15:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: packages/ledger-sql/post-roles.sql
create_intent:
- packages/ledger-sql/migrations/0009_platform_scope.sql
- packages/ledger-sql/tests/tests_platform_scope.sql
execution_mode: code_change
owned_files:
- packages/ledger-sql/migrations/0009_platform_scope.sql
- packages/ledger-sql/post-roles.sql
- packages/ledger-sql/src/migrate.ts
- packages/ledger-sql/tests/tests_platform_scope.sql
- .github/workflows/ledger-tests.yml
- tools/dev-db/env.sh
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP03 – Rôle et portée plateforme en base (migration 0009, post-roles)

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan`. Lis `kitty-specs/configuration-parties-evenements-01M4GCJ9/spec.md`, `plan.md`, `research.md`, `data-model.md`, `contracts/`, puis en particulier : `research.md` R-01, R-02, R-09, X-3 ; `contracts/platform-access.md` ; `data-model.md` (Migration 0009) ; `packages/ledger-sql/roles.sql`, `post-roles.sql`, `src/migrate.ts` (mot de passe de `cashless_app`) ; migrations `0002` (api_idempotency) et `0005` (approvals) ; `approval_request` et `decide_approval_request` du schéma ; commit `1680391` (aucune migration ne nomme un rôle).

## Objective

Créer le rôle de base de la plateforme et sa portée : politiques nominatives, droits, idempotence et demandes d'approbation de niveau plateforme, nouvelles actions, et retrait au rôle applicatif des écritures de plateforme.

## Context

Exigences : FR-001, FR-019 (base), NFR-002, C-004. `roles.sql` (fichier du kit) n'est jamais modifié. Tout ce qui nomme `cashless_app` ou `cashless_platform` va dans `post-roles.sql` (idempotent).

## Branch Strategy

Planification et merge sur `feat/configuration-parties-evenements`. Dépendances : WP02. L'espace de travail (worktree) est attribué par lane calculée dans `lanes.json`. Commande : `spec-kitty agent action implement WP03 --agent claude`.

## Subtasks

### T010 — Migration `0009_platform_scope.sql`

- `api_idempotency.operator_id` DROP NOT NULL ; contrainte `api_idempotency_uniq` remplacée par
  `UNIQUE NULLS NOT DISTINCT (operator_id, scope, idempotency_key)`. La garde `api_idempotency_guard` reste valable.
- `approval_request.operator_id` DROP NOT NULL ; liste fermée `action` étendue (contrainte CHECK remplacée) avec
  `EVENT_GO_LIVE`, `EVENT_SETTINGS_CHANGE`, `EVENT_OPERATOR_SETTINGS_CHANGE`, `PARTICIPATION_CHANGE`,
  `FEE_RULE_CHANGE`, `CONTRACT_VERSION`, `PLATFORM_CONTRACT_VERSION`, `JURISDICTION_LIMITS_CHANGE` ;
  `CHECK (operator_id IS NOT NULL OR action IN ('PLATFORM_CONTRACT_VERSION','JURISDICTION_LIMITS_CHANGE'))`.
- Fonction interne `platform_session() RETURNS boolean` (`STABLE`, `SECURITY INVOKER`) :
  `pg_has_role(session_user, coalesce(nullif(current_setting('app.platform_role', true), ''), 'cashless_platform'),
  'MEMBER')` protégé par `EXISTS (SELECT 1 FROM pg_roles WHERE rolname = …)` (sur une base sans le rôle : false).
- `CREATE OR REPLACE FUNCTION decide_approval_request(...)` (même signature, même corps) : seule la ligne
  `PERFORM assert_tenant(r.operator_id)` devient « si `r.operator_id` IS NULL : `platform_session()` exigée (sinon
  `no_data_found`) ; sinon `assert_tenant` ». Commentaire de tête : contrôles inchangés, raison du remplacement.
- Politique RLS existante d'`approval_request` et d'`api_idempotency` : inchangées (NULL n'égale jamais le
  prestataire de session : invisible pour `cashless_app`).

### T011 — `post-roles.sql` : rôle `cashless_platform`, droits, politiques

- Création idempotente (`DO $$ … IF NOT EXISTS … CREATE ROLE cashless_platform LOGIN NOSUPERUSER NOCREATEDB
  NOCREATEROLE NOBYPASSRLS`) ; mêmes durées que `cashless_app` (`statement_timeout`, `idle_in_transaction…`,
  `lock_timeout`, `transaction_timeout` si ≥ 17).
- `GRANT USAGE ON SCHEMA public` ; `SELECT` sur `party`, `jurisdiction_profile`, `contract`, `config_version`,
  `fee_rule`, `audit_log`, `approval_request`, `api_idempotency`, `app_user`, `role_assignment`, `currency_exponent` ;
  `INSERT` sur `party`, `jurisdiction_profile`, `contract`, `config_version`, `fee_rule`, `audit_log`,
  `approval_request`, `api_idempotency` ; `UPDATE (legal_name, country_code, tax_id) ON party` ;
  `UPDATE (valid_to) ON fee_rule` ; `UPDATE (status, executed_tx_id, failure_code, failure_reason, result) ON
  approval_request` ; `UPDATE` sur `api_idempotency` ; `USAGE, SELECT` sur les séquences utiles (`audit_log`) ;
  `EXECUTE` sur `decide_approval_request` et `platform_session`. Rien d'autre (vérifié par T013).
- Politiques `TO cashless_platform` (DROP POLICY IF EXISTS puis CREATE) : `party` (SELECT : `kind IN
  ('PLATFORM','OPERATOR')` ; INSERT/UPDATE : `kind = 'OPERATOR' AND operator_id IS NULL`) ; `contract`
  (`kind = 'PLATFORM_OPERATOR'`) ; `config_version` (`scope_type = 'PLATFORM' AND operator_id IS NULL`) ;
  `fee_rule` (`scope_type = 'PLATFORM_CONTRACT'`) ; `audit_log`, `approval_request`, `api_idempotency`
  (`operator_id IS NULL`). `app_user`/`role_assignment` : lecture des personnes de la plateforme seulement
  (`operator_id IS NULL`, et attributions de ces personnes) — nécessaire au contrôle du valideur.
- Rôle applicatif : `REVOKE INSERT, UPDATE ON jurisdiction_profile, currency_exponent FROM cashless_app` (X-3) ;
  `GRANT EXECUTE ON FUNCTION open_event_ledger(uuid), open_participation_account(uuid),
  event_transition_conditions(uuid, event_status) TO cashless_app` ; `REVOKE EXECUTE ON FUNCTION platform_session()
  FROM cashless_app, PUBLIC` si nécessaire (la fonction peut rester appelable : elle ne révèle rien — décider et
  commenter).

### T012 — `migrate.ts`, CI, variables locales

- `migrate.ts` : après `post-roles.sql`, poser le mot de passe de `cashless_platform` depuis
  `CASHLESS_PLATFORM_PASSWORD` exactement comme celui de `cashless_app` (même mécanisme, même journalisation).
- `.github/workflows/ledger-tests.yml` : `CASHLESS_PLATFORM_PASSWORD: cashless_platform_ci`, `DATABASE_URL_PLATFORM:
  postgres://cashless_platform:cashless_platform_ci@localhost:5432/cashless_test`.
- `tools/dev-db/env.sh` : mêmes variables avec les valeurs locales (`cashless_platform_local`), surchargeables.

### T013 — Tests pgTAP `tests/tests_platform_scope.sql`

- Droits effectifs (`has_table_privilege`, `has_column_privilege`, `has_function_privilege`) des deux rôles, en
  particulier : `cashless_platform` sans INSERT/UPDATE/DELETE sur `journal_transaction`, `posting`,
  `account_balance`, `ledger`, `account`, `event` ; `cashless_app` sans INSERT/UPDATE sur `jurisdiction_profile`.
- Sous `SET LOCAL ROLE cashless_app` + prestataire : création d'un prestataire refusée ; version `PLATFORM`,
  contrat `PLATFORM_OPERATOR`, règle `PLATFORM_CONTRACT` refusés.
- Sous `SET LOCAL ROLE cashless_platform` : création d'un prestataire acceptée ; création d'un organisateur, d'un
  événement, d'une version `OPERATOR` refusées ; lignes d'un prestataire (événements, personnes du prestataire)
  invisibles.
- Idempotence : deux clés identiques `operator_id` NULL ⇒ unicité violée ; même clé pour deux prestataires distincts
  ⇒ acceptée.
- Approbations : demande plateforme `operator_id` NULL avec une action de prestataire ⇒ refus ; décision d'une
  demande plateforme sous `cashless_app` ⇒ refusée ; sous `cashless_platform` ⇒ acceptée, auteur ≠ valideur toujours
  exigé ; décision d'une demande de prestataire inchangée (régression).

## Test Strategy

Tests demandés par la spec (pgTAP par contrainte, isolation à deux prestataires, intégration sur la base locale). Ordre de vérification : `npm run lint`, `npm run typecheck`, `npm run reset-db -w @cashless/ledger-sql`, `npm run test:pgtap -w @cashless/ledger-sql`, `npm run reset-db -w @cashless/ledger-sql && npm test`.

## Definition of Done

`reset-db` crée `cashless_platform` et pose ses droits ; `test:pgtap` vert ; CI mise à jour ; `npm test` vert. Un `reset-db` rejoué deux fois de suite sur la même base reste sans erreur (idempotence de `post-roles.sql`).

## Risks / Reviewer guidance

Une politique `TO cashless_platform` oubliée laisse le rôle sans accès (fail-closed, détecté par T013) ; une politique sans `TO` donnerait l'accès à `cashless_app` (faille) : chaque politique ajoutée est nominative. `SET LOCAL ROLE` dans pgTAP : le propriétaire doit être membre des deux rôles (GRANT dans la suite si besoin, dans la transaction annulée).
