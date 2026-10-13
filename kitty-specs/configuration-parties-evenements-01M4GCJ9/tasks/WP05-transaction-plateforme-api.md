---
work_package_id: WP05
title: 'Transaction, idempotence et approbations de plateforme dans l''API'
dependencies:
- WP03
- WP04
requirement_refs:
- FR-001
- FR-019
- FR-020
- FR-021
planning_base_branch: feat/configuration-parties-evenements
merge_target_branch: feat/configuration-parties-evenements
branch_strategy: Planning artifacts for this mission were generated on feat/configuration-parties-evenements. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/configuration-parties-evenements unless the human explicitly redirects the landing branch.
subtasks:
- T018
- T019
- T020
- T021
- T022
phase: 'Phase 2 - Socle API'
history:
- timestamp: '2026-10-09T15:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: apps/api/src/db/
create_intent:
- apps/api/src/db/platform-tx.ts
- apps/api/test/unit/config.spec.ts
- apps/api/test/integration/platform/platform-tx.spec.ts
execution_mode: code_change
owned_files:
- apps/api/src/config/config.ts
- apps/api/test/unit/config.spec.ts
- apps/api/src/db/**
- apps/api/src/idempotency/**
- apps/api/src/approval/**
- apps/api/test/unit/architecture.spec.ts
- apps/api/test/support/db.ts
- apps/api/test/support/app.ts
- apps/api/test/integration/platform/**
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP05 – Transaction, idempotence et approbations de plateforme dans l'API

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan`. Lis `kitty-specs/configuration-parties-evenements-01M4GCJ9/spec.md`, `plan.md`, `research.md`, `data-model.md`, `contracts/`, puis en particulier : `contracts/platform-access.md` ; `research.md` R-01, R-02 ; `apps/api/src/db/tenant-tx.ts`, `db.module.ts`, `config/config.ts`, `idempotency/` (intercepteur, dépôt, décorateur), `approval/` (service, contrôleur, registre), `identity/identity-tenant-context.ts`, `test/support/*`, `test/unit/architecture.spec.ts`.

## Objective

Donner à l'API son accès de plateforme : second pool, `PlatformTx`, idempotence et demandes d'approbation de niveau plateforme, sans affaiblir le confinement du pool applicatif.

## Context

Exigences : FR-001, FR-019, FR-020 (audit de plateforme), FR-021, C-005. Les routes de plateforme elles-mêmes arrivent en WP07 ; ici, le socle et ses tests (avec une route de test si nécessaire).

## Branch Strategy

Planification et merge sur `feat/configuration-parties-evenements`. Dépendances : WP03, WP04. L'espace de travail (worktree) est attribué par lane calculée dans `lanes.json`. Commande : `spec-kitty agent action implement WP05 --agent claude`.

## Subtasks

### T018 — Configuration et second pool

- `AppConfig.platformDatabaseUrl` (`DATABASE_URL_PLATFORM`, obligatoire en production, défaut local du contrat),
  `platformPoolSize` (`DB_PLATFORM_POOL_SIZE`, défaut 2) ; tests de `loadConfig`.
- `db.module.ts` : jeton `PG_PLATFORM_POOL`, fermeture à l'arrêt, `PlatformTx` exporté.

### T019 — `PlatformTx`

- `run(fn)` : `BEGIN` → `set_config('app.scope','platform', true)` → `fn(client)` → `COMMIT` ; ROLLBACK sur erreur.
  Jamais d'`app.operator_id`. Commentaire de tête : règles de `contracts/platform-access.md`.
- Test d'architecture : `PG_PLATFORM_POOL` et `PlatformTx` importés seulement par `db/`, `idempotency/`,
  `approval/` et les fichiers de plateforme désignés (`organization/platform/**`,
  `configuration/jurisdiction*`, `configuration/platform-*`).

### T020 — Idempotence de plateforme

- `IdempotentOptions.platform?: boolean` : réservation, complétion et relâche de la clé par `PlatformTx` avec
  `operator_id` NULL ; `IdempotentTx.run` ouvre la transaction plateforme ; le tenant n'est pas résolu.
- `IdempotencyRepository` paramétré par la transaction (cloisonnée ou plateforme) ; aucun changement de
  comportement pour les routes existantes (tests de la mission 1 et 2 verts).

### T021 — Approbations de plateforme

- `ApprovalService` : création d'une demande `operator_id` NULL dans la transaction plateforme pour les actions
  déclarées `platform: true` dans leur définition (`ApprovalActionDefinition.platform?: boolean`) ; approbation et
  refus par la transaction plateforme quand la personne n'a pas de prestataire et que la demande est de plateforme.
- `ApprovalController` : pour une personne de la plateforme (prestataire NULL) **hors** préfixe `/operators/…`,
  liste, consultation, approbation, refus des demandes de plateforme (transaction plateforme) au lieu du `403`
  actuel ; inchangé pour les autres.
- Audit : ligne `operator_id` NULL (chaîne plateforme) dans la même transaction.

### T022 — Tests

- Unitaires : configuration, option `platform` de l'intercepteur.
- Intégration (`test/integration/platform/`) avec une route et une action de démonstration enregistrées seulement en
  test (comme `demo-approval-action.ts`) : rejeu d'une écriture de plateforme (`Idempotency-Replayed`) ; même clé
  réutilisée avec un autre corps ⇒ `409 IDEMPOTENCY_KEY_REUSED` ; demande de plateforme approuvée par un second
  `PLATFORM_ADMIN` (`EXECUTED`), refusée à son auteur (`409 APPROVAL_INVALID`), invisible pour un
  `OPERATOR_ADMIN` ; ligne d'audit dans la chaîne plateforme.
- `test/support/db.ts` et `app.ts` : pool plateforme et nettoyage des données de test.

## Test Strategy

Tests demandés par la spec (pgTAP par contrainte, isolation à deux prestataires, intégration sur la base locale). Ordre de vérification : `npm run lint`, `npm run typecheck`, `npm run reset-db -w @cashless/ledger-sql`, `npm run test:pgtap -w @cashless/ledger-sql`, `npm run reset-db -w @cashless/ledger-sql && npm test`.

## Definition of Done

`npm run lint`, `typecheck`, `npm test` verts (toutes les suites existantes comprises) ; test d'architecture étendu vert.

## Risks / Reviewer guidance

Ne pas laisser l'intercepteur choisir la transaction plateforme sur un indice de la requête : seule l'option déclarative de la route en décide. Une personne de plateforme sur `/operators/{id}/…` reste servie par la transaction du prestataire du chemin (comportement de la mission 2).
