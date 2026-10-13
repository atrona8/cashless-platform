---
work_package_id: WP07
title: 'Plateforme : profils de législation, prestataires, contrats et règles de plateforme'
dependencies:
- WP05
- WP06
requirement_refs:
- FR-002
- FR-003
- FR-004
- FR-007
- FR-008
- FR-019
- FR-020
planning_base_branch: feat/configuration-parties-evenements
merge_target_branch: feat/configuration-parties-evenements
branch_strategy: Planning artifacts for this mission were generated on feat/configuration-parties-evenements. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/configuration-parties-evenements unless the human explicitly redirects the landing branch.
subtasks:
- T028
- T029
- T030
- T031
- T032
phase: 'Phase 3 - Routes'
history:
- timestamp: '2026-10-09T15:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: apps/api/src/organization/platform/
create_intent:
- apps/api/src/configuration/jurisdiction.service.ts
- apps/api/src/configuration/platform-config.controller.ts
- apps/api/test/integration/organization/platform.spec.ts
execution_mode: code_change
owned_files:
- apps/api/src/organization/platform/**
- apps/api/src/configuration/jurisdiction.service.ts
- apps/api/src/configuration/platform-config.controller.ts
- apps/api/src/app.module.ts
- apps/api/test/integration/organization/platform*.spec.ts
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP07 – Plateforme : profils de législation, prestataires, contrats et règles de plateforme

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan`. Lis `kitty-specs/configuration-parties-evenements-01M4GCJ9/spec.md`, `plan.md`, `research.md`, `data-model.md`, `contracts/`, puis en particulier : `contracts/openapi-additions.md` (Plateforme), `contracts/platform-access.md`, `contracts/configuration.md` ; `research.md` R-01, R-02, R-07, R-09 ; `apps/api/src/identity/users/*` (style contrôleur/service/DTO, audit) ; `approval/action-registry.ts` ; services de WP05 et WP06.

## Objective

Publier les routes de plateforme : profils de législation (avec valeurs provisoires), prestataires, contrats `PLATFORM_OPERATOR`, versions de configuration `PLATFORM`, règles `PLATFORM_CONTRACT`, et les deux actions à deux de plateforme.

## Context

Exigences : FR-002, FR-003, FR-004, FR-007, FR-008, FR-019, FR-020. Toutes ces routes : `@Roles(['PLATFORM_ADMIN'])` sur `PLATFORM_CHAIN`, `@Idempotent({ scope: 'plt:', platform: true })` pour les écritures, `PlatformTx` pour les lectures. `app.module.ts` : ce WP l'étend (module de plateforme) ; les WP suivants l'étendent à leur tour dans l'ordre des dépendances.

## Branch Strategy

Planification et merge sur `feat/configuration-parties-evenements`. Dépendances : WP05, WP06. L'espace de travail (worktree) est attribué par lane calculée dans `lanes.json`. Commande : `spec-kitty agent action implement WP07 --agent claude`.

## Subtasks

### T028 — Profils de législation

- `jurisdiction.service.ts` : créer (version 1 par pays ; défauts provisoires complétés et tracés), lister,
  consulter (avec `provisional_fields`), nouvelle version : si un plafond réglementaire change
  (`max_wallet_balance`, `kyc_threshold`, `unidentified_max_balance`, `unidentified_monthly_limit`,
  `identified_monthly_limit`) ⇒ demande `JURISDICTION_LIMITS_CHANGE` (`202`), sinon `201`.
- Lecture des profils ouverte aussi aux prestataires (route de lecture servie par le rôle applicatif : le profil
  n'a pas de RLS et `cashless_app` garde SELECT).

### T029 — Prestataires

- `organization/platform/operators.*` : créer (partie `OPERATOR`, `operator_id` NULL), lister, consulter, modifier
  les données descriptives (raison sociale, pays, identifiant fiscal) ; audit de chaque écriture.

### T030 — Contrats et règles de plateforme

- Contrat `PLATFORM_OPERATOR` version 1 (`platform_fee_mode` obligatoire) ; nouvelle version ⇒
  `PLATFORM_CONTRACT_VERSION` (`202`), exécutée par l'insertion de la version n+1 (déclencheur de WP01).
- Règles `PLATFORM_CONTRACT` (redevance, `beneficiary_purpose` `PLT_REDEV`) : création et liste par contrat.
- Versions de configuration `PLATFORM` (`platform-config.controller.ts`) via le service de cascade.

### T031 — Actions à deux de plateforme

- Définitions `JURISDICTION_LIMITS_CHANGE` et `PLATFORM_CONTRACT_VERSION` (`requiredRole: PLATFORM_ADMIN`, portée
  plateforme, `platform: true`, `validate` strict, `execute` qui revérifie que la version de référence du payload est
  toujours la dernière, sinon `ProblemException CONFLICT_STATE` ⇒ `FAILED`) ; enregistrement par
  `registerApprovalActions(...)` dans le module de plateforme.

### T032 — Tests d'intégration

- Parcours US1 de la spec (scénarios 1 à 4) ; rejeu idempotent ; `OPERATOR_ADMIN` refusé `403` sur chaque route de
  plateforme ; profil lu par un `OPERATOR_ADMIN` ; valeurs provisoires signalées puis non provisoires après saisie
  explicite ; audit chaîne plateforme.

## Test Strategy

Tests demandés par la spec (pgTAP par contrainte, isolation à deux prestataires, intégration sur la base locale). Ordre de vérification : `npm run lint`, `npm run typecheck`, `npm run reset-db -w @cashless/ledger-sql`, `npm run test:pgtap -w @cashless/ledger-sql`, `npm run reset-db -w @cashless/ledger-sql && npm test`.

## Definition of Done

Routes conformes au contrat (réponses, codes) ; `lint`, `typecheck`, `npm test` verts.

## Risks / Reviewer guidance

Ne jamais utiliser le pool applicatif pour une écriture de plateforme (le test d'architecture de WP05 doit le prouver) ; ne jamais lire un `operator_id` dans le corps.
