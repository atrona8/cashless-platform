---
work_package_id: WP03
title: Migrations et suites pgTAP de référence
dependencies:
- WP01
- WP02
requirement_refs:
- FR-002
- FR-005
planning_base_branch: feat/fondations-grand-livre
merge_target_branch: feat/fondations-grand-livre
branch_strategy: Planning artifacts for this mission were generated on feat/fondations-grand-livre. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/fondations-grand-livre unless the human explicitly redirects the landing branch.
subtasks:
- T011
- T012
- T013
- T014
- T015
phase: Phase 2 - Base de données
history:
- timestamp: '2026-10-07T12:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: packages/ledger-sql/src/
create_intent:
- packages/ledger-sql/src/migrate.ts
- packages/ledger-sql/scripts/reset-db.sh
- packages/ledger-sql/scripts/test-pgtap.sh
- packages/ledger-sql/scripts/check-generated.sh
- packages/ledger-sql/migrations/0001_schema_reference.sql
execution_mode: code_change
owned_files:
- packages/ledger-sql/src/**
- packages/ledger-sql/scripts/**
- packages/ledger-sql/migrations/0001_schema_reference.sql
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP03 – Migrations et suites pgTAP de référence

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan`. Lis `README.md`, `packages/ledger-sql/roles.sql`,
`research.md` §R-02, `data-model.md` (`ops.schema_migrations`).

## Objective

Créer la base par des migrations versionnées dont la première reprend le schéma de référence **sans copie**, puis
`roles.sql`, et faire passer les 400 + 64 assertions pgTAP sur cette base, en local.

## Context

- Exigences : FR-002, FR-005 (garde des fichiers générés, utilisée aussi par la CI en WP14), NFR-003, C-002.
- **Ne jamais modifier** `schema_grand_livre_cashless.sql`, `tests_grand_livre_cashless.sql`,
  `scenario_reference_test.sql`, `roles.sql`, `gen_*.py`, `scenario_reference.json`.
- Les suites pgTAP s'exécutent avec le rôle propriétaire (`postgres` sur le cluster privé), comme dans la CI
  d'origine ; elles ouvrent leur propre `BEGIN` et finissent par `ROLLBACK` (à vérifier en lisant la fin des fichiers).

## Branch Strategy

Planification et merge sur `feat/fondations-grand-livre`. Commande : `spec-kitty agent action implement WP03 --agent claude`.

## Subtasks

### T011 — Exécuteur de migrations (`packages/ledger-sql/src/migrate.ts`)

- Connexion : `DATABASE_URL_OWNER` (jamais `cashless_app`).
- `CREATE SCHEMA IF NOT EXISTS ops` ; `ops.schema_migrations (version text PRIMARY KEY, checksum text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now())`.
- Lister `migrations/*.sql` triés ; pour chacune : contenu **effectif** (voir T012 pour l'inclusion), SHA-256 ;
  si appliquée et somme différente → erreur et arrêt ; sinon, exécuter dans une transaction (`BEGIN … COMMIT`) et
  insérer la ligne.
- Après la série (même si rien n'a été appliqué) : exécuter `roles.sql` (T013).
- Sortie : liste des migrations appliquées / ignorées ; code de sortie ≠ 0 en cas d'échec.
- Script npm : `"migrate": "tsx src/migrate.ts"`.

### T012 — Migration 0001 (schéma de référence)

- `migrations/0001_schema_reference.sql` contient une **directive** unique, interprétée par l'exécuteur :
  `-- @include ../schema_grand_livre_cashless.sql` (chemin relatif au fichier). L'exécuteur remplace la directive
  par le contenu du fichier inclus avant de calculer la somme et d'exécuter. Ainsi le schéma normatif n'est pas
  dupliqué et toute modification du schéma est détectée (somme changée).
- Vérifier que le schéma s'exécute dans une transaction (aucun `CONCURRENTLY`/`VACUUM` : vérifié en research R-02).

### T013 — Rejeu de `roles.sql` et mot de passe local

- L'exécuteur lit `roles.sql` et l'exécute tel quel après la série.
- Mot de passe : en local seulement, si `CASHLESS_APP_PASSWORD` est défini, `ALTER ROLE cashless_app PASSWORD …`
  (`roles.sql` ne fixe pas de mot de passe, volontairement). En CI, la variable est aussi définie.
- `REVOKE ALL ON SCHEMA ops FROM PUBLIC` (aucun accès de `cashless_app` à `ops`).

### T014 — `scripts/reset-db.sh` et `scripts/test-pgtap.sh`

- `reset-db.sh` : source `tools/dev-db/env.sh` si présent ; `dropdb --if-exists cashless_test` ;
  `createdb cashless_test` ; `npm run migrate -w @cashless/ledger-sql`.
- `test-pgtap.sh` : `pg_prove -d cashless_test packages/ledger-sql/tests_grand_livre_cashless.sql
  packages/ledger-sql/scenario_reference_test.sql packages/ledger-sql/tests/*.sql` (le glob `tests/*.sql` est vide
  tant que WP04 n'est pas fait : le gérer sans erreur). Script npm `test:pgtap`.
- **Attention** : les deux suites de référence insèrent des données (fixtures) ; elles doivent tourner sur une base
  sans données métier. Si une suite ne fait pas `ROLLBACK`, recréer la base entre les deux (`reset-db.sh`).

### T015 — Contrôle des fichiers générés (`scripts/check-generated.sh`)

- `cd packages/ledger-sql && python gen_tests.py && python gen_golden.py && git diff --exit-code
  tests_grand_livre_cashless.sql scenario_reference_test.sql`. Sous Windows, vérifier que les fins de ligne ne
  produisent pas de faux écart (`.gitattributes` du kit) ; `python3` absent sous Windows : utiliser `python`.
- Script npm `check:generated`.

## Definition of Done

- `reset-db.sh` puis `test:pgtap` : **464 assertions OK** (400 + 64) sur le cluster privé.
- Second `npm run migrate` : rien d'appliqué, `roles.sql` rejoué sans erreur.
- `check:generated` vert.
- Signaler (FR-024) toute différence de comportement entre base créée par migrations et base créée par le fichier
  brut (il ne doit y en avoir aucune).

## Risks / Reviewer guidance

- Vérifier qu'aucun fichier normatif n'a été modifié (`git diff --stat` sur `packages/ledger-sql/*.sql|*.py|*.json`).
- `ops.schema_migrations` hors de `public` : vérifier `has_schema_privilege('cashless_app','ops','USAGE') = false`.
