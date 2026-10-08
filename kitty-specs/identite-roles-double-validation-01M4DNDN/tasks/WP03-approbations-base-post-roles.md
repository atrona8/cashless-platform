---
work_package_id: WP03
title: Approbations en base, droits « après rôles », amorçage
dependencies:
- WP02
requirement_refs:
- FR-007
- FR-011
- FR-014
planning_base_branch: feat/identite-roles
merge_target_branch: feat/identite-roles
branch_strategy: Planning artifacts for this mission were generated on feat/identite-roles. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/identite-roles unless the human explicitly redirects the landing branch.
subtasks:
- T010
- T011
- T012
- T013
phase: Phase 1 - Base de données
history:
- timestamp: '2026-10-08T13:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: packages/ledger-sql/post-roles.sql
create_intent:
- packages/ledger-sql/migrations/0005_approvals.sql
- packages/ledger-sql/post-roles.sql
- packages/ledger-sql/src/bootstrap-admin.ts
- packages/ledger-sql/tests/tests_approvals.sql
execution_mode: code_change
owned_files:
- packages/ledger-sql/migrations/0005_approvals.sql
- packages/ledger-sql/post-roles.sql
- packages/ledger-sql/src/migrate.ts
- packages/ledger-sql/src/bootstrap-admin.ts
- packages/ledger-sql/package.json
- packages/ledger-sql/tests/tests_approvals.sql
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP03 – Approbations en base, droits « après rôles », amorçage

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan`. Lis `research.md` R-02, R-07, R-09, `data-model.md`
(`approval_request.result`, `approval_token_use`), `contracts/identity.md` (Amorçage), `plan.md` (Complexity
Tracking), `packages/ledger-sql/roles.sql` et `packages/ledger-sql/src/migrate.ts` (mission 1 : série puis rejeu de
`roles.sql`), la table `approval_request`, `approval_request_guard`, `decide_approval_request` du schéma.

## Objective

Compléter la base pour la double validation (colonne `result`, utilisations de jetons d'approbation), introduire
`post-roles.sql` rejoué après `roles.sql` pour poser les droits justes, et livrer la commande d'amorçage du premier
`PLATFORM_ADMIN`.

## Context

- Exigences : FR-007, FR-011 (base), FR-014 (base), C-002, C-008.
- Contradiction contrat / schéma sur `result` : décidée en R-02 (colonne ajoutée), à consigner (FR-017, WP10).
- Ne jamais modifier `roles.sql` (fichier du kit).

## Branch Strategy

Planification et merge sur `feat/identite-roles`. Commande : `spec-kitty agent action implement WP03 --agent claude`.

## Subtasks

### T010 — Migration `0005_approvals.sql`

- `ALTER TABLE approval_request ADD COLUMN result jsonb` ; `CHECK (result IS NULL OR status = 'EXECUTED')`.
  Vérifier que `approval_request_guard` laisse passer l'écriture de `result` au passage `APPROVED → EXECUTED`
  (il ne contrôle pas cette colonne) ; un test le prouve.
- `approval_token_use` (colonnes de `data-model.md`) : `CHECK (approver_id <> caller_id)`, `CHECK (expires_at >
  used_at)` ; garde ajout seul (UPDATE/DELETE refusés, `CL001`) ; RLS forcée sur `operator_id` ; index sur
  `expires_at` (purge future).

### T011 — `post-roles.sql` et rejeu

- `packages/ledger-sql/post-roles.sql`, idempotent, exécuté par le propriétaire **après** `roles.sql` :
  - `REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM cashless_app` ;
  - `REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON audit_seal FROM cashless_app` ;
  - `REVOKE UPDATE, DELETE, TRUNCATE ON approval_token_use FROM cashless_app` ;
  - `REVOKE EXECUTE ON FUNCTION seal_audit(uuid, interval), verify_audit_chain(uuid, timestamptz),
    audit_chain_genesis(uuid), audit_row_canonical(audit_log) FROM cashless_app` (et de `PUBLIC`) ;
  - `GRANT UPDATE (result) ON approval_request TO cashless_app`.
- `migrate.ts` : après le rejeu de `roles.sql`, rejouer `post-roles.sql` s'il existe (même client, même transaction
  que le rejeu de `roles.sql` si la mission 1 le fait ainsi ; sinon sa propre transaction) ; journaliser
  `[migrate] post-roles.sql rejoué`. Les tests unitaires éventuels de `migrate.ts` restent verts.

### T012 — Amorçage (`src/bootstrap-admin.ts`, script `bootstrap-admin`)

- Rôle propriétaire (`DATABASE_URL_OWNER`). Arguments : `--issuer`, `--subject`, `--name`, `--email` ou `--phone`.
- Une transaction : si une personne `(issuer, subject)` existe avec une attribution `PLATFORM_ADMIN` active → message
  « déjà présent », code 0, rien d'écrit ; sinon créer la personne (`operator_id` NULL, `created_by` NULL) et
  l'attribution (`granted_by` NULL), puis une ligne `audit_log` (`action = 'PLATFORM_ADMIN_BOOTSTRAPPED'`,
  `actor_id` NULL, `origin = 'bootstrap-admin'`, `after` = la personne et l'attribution).
- Script npm `"bootstrap-admin": "tsx src/bootstrap-admin.ts"` dans `packages/ledger-sql/package.json`.

### T013 — Tests pgTAP (`tests/tests_approvals.sql`)

- `result` : refusé hors `EXECUTED` ; écrit au passage `APPROVED → EXECUTED` par `cashless_app`.
- `approval_token_use` : contraintes, ajout seul, RLS, insertion `ON CONFLICT (jti) DO NOTHING` = 0 ligne la
  seconde fois.
- Droits effectifs après `post-roles.sql` (`has_table_privilege`, `has_function_privilege`, `has_column_privilege`
  pour `cashless_app`) : `audit_log` (INSERT oui, UPDATE non), `audit_seal` (INSERT non), fonctions de scellement
  (EXECUTE non), `approval_request.result` (UPDATE oui), `identify_person` (EXECUTE oui), `decide_approval_request`
  (EXECUTE oui).
- Amorçage : couvert par un test d'intégration en WP10 ; ici, vérifier seulement que la base l'autorise (personne
  plateforme + attribution sans `granted_by`).

## Definition of Done

- `reset-db` applique `0003`-`0005` puis `roles.sql` puis `post-roles.sql` ; `test:pgtap` vert ;
  `npm run bootstrap-admin` idempotent (lancé deux fois sur la base locale : une personne, une ligne d'audit).

## Risks / Reviewer guidance

- Un droit oublié dans `post-roles.sql` = faille silencieuse : les tests de droits effectifs sont l'arbitre.
- `migrate.ts` est un fichier de la mission 1 : modification minimale, justifiée dans le commit.
