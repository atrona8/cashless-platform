---
work_package_id: WP04
title: Table d'idempotence S21
dependencies:
- WP03
requirement_refs:
- FR-009
planning_base_branch: feat/fondations-grand-livre
merge_target_branch: feat/fondations-grand-livre
branch_strategy: Planning artifacts were generated on feat/fondations-grand-livre; completed changes must merge back into feat/fondations-grand-livre.
subtasks:
- T016
- T017
- T018
- T019
phase: Phase 2 - Base de données
history:
- timestamp: '2026-10-07T12:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: packages/ledger-sql/tests/
create_intent:
- packages/ledger-sql/migrations/0002_api_idempotency.sql
- packages/ledger-sql/tests/tests_api_idempotency.sql
execution_mode: code_change
owned_files:
- packages/ledger-sql/migrations/0002_api_idempotency.sql
- packages/ledger-sql/tests/**
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP04 – Table d'idempotence S21

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan`. Lis `data-model.md` (`api_idempotency`),
`contracts/idempotency.md`, SPECIFICATION §14.2 (S21) et la manière dont le schéma pose la RLS
(`schema_grand_livre_cashless.sql`, blocs `CREATE POLICY tenant_isolation`, `FORCE ROW LEVEL SECURITY`).

## Objective

Ajouter par migration la table `api_idempotency` (contenu minimal S21 : clé, portée, empreinte, statut, réponse,
expiration), avec RLS forcée, `operator_id`, et un test pgTAP par contrainte (§14.2).

## Context

- Exigences : FR-009 (partie base), NFR-003.
- `roles.sql` (rejoué après chaque série) donne `SELECT, INSERT, UPDATE` sur toutes les tables de `public` et retire
  `DELETE` : c'est le régime voulu.

## Branch Strategy

Planification et merge sur `feat/fondations-grand-livre`. Commande : `spec-kitty agent action implement WP04 --agent claude`.

## Subtasks

### T016 — Migration `0002_api_idempotency.sql`

Colonnes exactement selon `data-model.md`. Contraintes nommées (noms explicites, testables) :
- `api_idempotency_uniq UNIQUE (operator_id, scope, idempotency_key)` ;
- `api_idempotency_key_len CHECK (length(idempotency_key) BETWEEN 1 AND 255)` ;
- `api_idempotency_scope_nonempty CHECK (length(scope) > 0)` ;
- `api_idempotency_hash_hex CHECK (request_hash ~ '^[0-9a-f]{64}$')` ;
- `api_idempotency_status CHECK (status IN ('IN_PROGRESS','COMPLETED'))` ;
- `api_idempotency_in_progress CHECK (status <> 'IN_PROGRESS' OR lease_until IS NOT NULL)` ;
- `api_idempotency_completed CHECK (status <> 'COMPLETED' OR (response_status BETWEEN 200 AND 599 AND completed_at IS NOT NULL))` ;
- `api_idempotency_expiry CHECK (expires_at > created_at)`.
Index sur `expires_at` (purge future).

### T017 — Garde d'immuabilité et RLS forcée

- Déclencheur `BEFORE UPDATE` `api_idempotency_guard` : refuse (SQLSTATE `CL001`, message court) toute modification
  de `operator_id`, `scope`, `idempotency_key`, `request_hash`, `created_at`, et tout passage `COMPLETED →
  IN_PROGRESS`. Fonction en `SECURITY INVOKER`, `search_path` fixé.
- `ALTER TABLE … ENABLE ROW LEVEL SECURITY; ALTER TABLE … FORCE ROW LEVEL SECURITY;` politique
  `tenant_isolation` `USING (operator_id = current_setting('app.operator_id', true)::uuid) WITH CHECK (même
  expression)`.

### T018 — Tests pgTAP `tests/tests_api_idempotency.sql`

Écrits à la main (ce n'est pas un fichier généré). Structure : `BEGIN; CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(N); … SELECT * FROM finish(); ROLLBACK;`. Fixture minimale : deux parties `OPERATOR` (A, B).
Assertions (au moins) :
1. `has_table`, `col_not_null` des colonnes obligatoires ;
2. chaque `CHECK` refusé par `throws_ok(…, '23514')` avec une valeur fautive ;
3. unicité : seconde insertion même `(operator_id, scope, key)` → `23505` ; même clé autre prestataire → OK ;
4. garde : modification de `request_hash` → `CL001` ; `COMPLETED → IN_PROGRESS` → `CL001` ; `IN_PROGRESS →
   COMPLETED` avec réponse → OK ;
5. RLS : `relrowsecurity` et `relforcerowsecurity` vrais ; sous `SET LOCAL ROLE cashless_app` avec
   `set_config('app.operator_id', A, true)` : la ligne de B est invisible, `UPDATE` de la ligne de B touche 0 ligne,
   `INSERT` avec `operator_id` = B refusé (`42501`, `WITH CHECK`) ;
6. droits : `has_table_privilege('cashless_app','api_idempotency','DELETE') = false`.

### T019 — Intégration à `test:pgtap`

- Vérifier que `scripts/test-pgtap.sh` (WP03) prend `tests/*.sql` ; rien à changer si le glob est déjà là.
- `reset-db.sh && npm run test:pgtap -w @cashless/ledger-sql` : 464 + N assertions OK.

## Definition of Done

- Migration appliquée par l'exécuteur ; `roles.sql` rejoué ; suites de référence toujours vertes ; nouvelle suite
  verte.

## Risks / Reviewer guidance

- Les rôles changés par `SET LOCAL ROLE` doivent rester dans la transaction du test.
- Vérifier que `WITH CHECK` empêche d'écrire une ligne d'un autre prestataire.
