---
work_package_id: WP01
title: Schéma d'identité
dependencies: []
requirement_refs:
- FR-001
- FR-004
planning_base_branch: feat/identite-roles
merge_target_branch: feat/identite-roles
branch_strategy: Planning artifacts for this mission were generated on feat/identite-roles. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/identite-roles unless the human explicitly redirects the landing branch.
subtasks:
- T001
- T002
- T003
- T004
phase: Phase 1 - Base de données
history:
- timestamp: '2026-10-08T13:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: packages/ledger-sql/migrations/0003_identity.sql
create_intent:
- packages/ledger-sql/migrations/0003_identity.sql
- packages/ledger-sql/tests/tests_identity.sql
execution_mode: code_change
owned_files:
- packages/ledger-sql/migrations/0003_identity.sql
- packages/ledger-sql/tests/tests_identity.sql
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP01 – Schéma d'identité

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan`. Lis ensuite `data-model.md` (`app_user`,
`role_assignment`, `identify_person`), `contracts/identity.md`, `research.md` R-03 à R-06, SPECIFICATION §3.1, §3.2,
§14.2 (S1), et dans `packages/ledger-sql/schema_grand_livre_cashless.sql` : la forme des politiques
`tenant_isolation`, `assert_tenant`, les tables `party` (kind `PLATFORM`/`OPERATOR`/`ORGANIZER`/`MERCHANT`),
`event`, `merchant_participation`. Modèle de migration et de test : `0002_api_idempotency.sql` et
`tests/tests_api_idempotency.sql` (mission 1).

## Objective

Créer par la migration `0003_identity.sql` les personnes (`app_user`) et les attributions de rôle
(`role_assignment`), avec RLS forcée, gardes d'intégrité et la fonction `identify_person`, le tout testé par pgTAP
contrainte par contrainte.

## Context

- Exigences : FR-001, FR-004 (base), NFR-001, C-003, C-008.
- Une personne de la plateforme a `operator_id` NULL : invisible sous RLS (politique `operator_id =
  current_setting('app.operator_id', true)::uuid`), lue seulement par `identify_person`.
- `roles.sql` est rejoué après la série : `cashless_app` reçoit `SELECT, INSERT, UPDATE` sur les nouvelles tables
  (voulu ici) ; aucune suppression (déjà retirée). Les fonctions sont `EXECUTE` pour tous : `identify_person` est
  une fonction d'API, c'est voulu.
- Le fichier `post-roles.sql` (WP03) n'existe pas encore ; ne pas en dépendre.

## Branch Strategy

Planification et merge sur `feat/identite-roles`. Commande : `spec-kitty agent action implement WP01 --agent claude`.
Les worktrees sont attribués par lane (`lanes.json`).

## Subtasks

### T001 — Tables

- `app_user` : colonnes de `data-model.md` ; `CHECK (status IN ('ACTIVE','DISABLED'))` ; `CHECK ((status =
  'DISABLED') = (disabled_at IS NOT NULL))` ; `CHECK (email IS NOT NULL OR phone IS NOT NULL)` ; `phone ~
  '^\+[1-9][0-9]{6,14}$'` si présent ; `UNIQUE (issuer, subject)` ; `operator_id` → `party(id)` ; déclencheur ou
  contrôle : si `operator_id` non NULL, la partie est de type `OPERATOR`.
- `role_assignment` : colonnes de `data-model.md` ; `role` dans la liste fermée de §3.2 ; `scope_type` dans
  (`PLATFORM`, `OPERATOR`, `ORGANIZER`, `EVENT`, `MERCHANT`) ; `CHECK ((scope_type = 'PLATFORM') = (scope_id IS
  NULL))` ; compatibilité rôle ↔ portée (table de `data-model.md`) en `CHECK` ; `CHECK (granted_by IS NULL OR
  granted_by <> user_id)` ; `CHECK ((revoked_at IS NULL) = (revoked_by IS NULL))` ; index unique partiel « une
  attribution active par (personne, rôle, type de portée, objet) » (`WHERE revoked_at IS NULL`, `coalesce(scope_id,
  '00000000-…')`).
- `operator_id` de l'attribution = `operator_id` de la personne (déclencheur, T002).

### T002 — Gardes (déclencheurs `SECURITY INVOKER`, `search_path` fixé)

- `app_user` BEFORE UPDATE : `id`, `operator_id`, `issuer`, `subject`, `created_by`, `created_at` immuables ;
  `DISABLED → ACTIVE` refusé ; BEFORE DELETE : refus. Code `CL001` (`VALIDATION_FAILED`).
- `role_assignment` BEFORE INSERT : `operator_id` aligné sur la personne ; objet de portée existant et du même
  prestataire (`party.operator_id` pour `ORGANIZER`/`MERCHANT`, `event.operator_id` pour `EVENT`, `party.id` pour
  `OPERATOR`) ; personne `ACTIVE`. BEFORE UPDATE : seules `revoked_at`/`revoked_by` peuvent passer de NULL à une
  valeur, une fois ; retrait du dernier `PLATFORM_ADMIN` actif refusé (`CL001` avec message explicite ; l'API le
  traduira `403`, voir WP06). BEFORE DELETE : refus.
- Code d'erreur : `CL001` partout (déjà traduit `VALIDATION_FAILED` par la mission 1). Ne pas inventer de SQLSTATE.

### T003 — RLS et `identify_person`

- `ENABLE` + `FORCE ROW LEVEL SECURITY` ; politique `tenant_isolation` `USING` et `WITH CHECK` sur `operator_id`
  (même forme que `api_idempotency`).
- `identify_person(p_issuer text, p_subject text) RETURNS TABLE (user_id uuid, operator_id uuid, status text,
  assignments jsonb)` `LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public` : personne par `(issuer,
  subject)` ; `assignments` = `jsonb_agg({role, scope_type, scope_id})` des attributions actives (tableau vide sinon).
  Aucune autre information.
- `REVOKE ALL … FROM PUBLIC` puis `GRANT EXECUTE … TO cashless_app` dans la migration (roles.sql le rendra de toute
  façon).

### T004 — Tests pgTAP (`packages/ledger-sql/tests/tests_identity.sql`)

Structure de `tests_api_idempotency.sql` (`BEGIN; … SELECT plan(n); … ROLLBACK;`, fixture minimale de parties en
rôle propriétaire). Couvrir : chaque `CHECK` (un cas refusé par contrainte), unicité `(issuer, subject)`, une seule
attribution active, compatibilité rôle ↔ portée, objet d'un autre prestataire refusé, auto-attribution refusée,
immuabilité, `DISABLED → ACTIVE` refusé, rétablissement refusé, suppression refusée, dernier `PLATFORM_ADMIN`
non retirable (mais retirable s'il en reste un autre), RLS (sous `SET ROLE cashless_app` + `set_config` d'un autre
prestataire : 0 ligne visible, insertion refusée), `relforcerowsecurity`, `identify_person` (personne connue, rôles
actifs seulement, inconnue → 0 ligne, appelable par `cashless_app` sans `set_config`).

## Definition of Done

- `npm run reset-db -w @cashless/ledger-sql` applique `0003` ; `npm run test:pgtap -w @cashless/ledger-sql` vert
  (suites de référence intactes + nouvelle suite).
- Aucun fichier `.sql` généré modifié ; `npm run check:generated -w @cashless/ledger-sql` vert.

## Risks / Reviewer guidance

- La compatibilité rôle ↔ portée et « même prestataire » sont des règles de sécurité : un test par cas.
- `identify_person` ne doit rien exposer d'autre que la personne demandée.
