---
work_package_id: WP08
title: 'Organisation d''un prestataire : configuration, organisateurs, commerçants, contrats'
dependencies:
- WP07
requirement_refs:
- FR-005
- FR-006
- FR-007
- FR-008
- FR-014
- FR-019
- FR-020
planning_base_branch: feat/configuration-parties-evenements
merge_target_branch: feat/configuration-parties-evenements
branch_strategy: Planning artifacts for this mission were generated on feat/configuration-parties-evenements. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/configuration-parties-evenements unless the human explicitly redirects the landing branch.
subtasks:
- T033
- T034
- T035
- T036
- T037
phase: 'Phase 3 - Routes'
history:
- timestamp: '2026-10-09T15:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: apps/api/src/organization/tenant/
create_intent:
- apps/api/test/integration/organization/tenant.spec.ts
execution_mode: code_change
owned_files:
- apps/api/src/organization/tenant/**
- apps/api/test/integration/organization/tenant*.spec.ts
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP08 – Organisation d'un prestataire : configuration, organisateurs, commerçants, contrats

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan`. Lis `kitty-specs/configuration-parties-evenements-01M4GCJ9/spec.md`, `plan.md`, `research.md`, `data-model.md`, `contracts/`, puis en particulier : `contracts/openapi-additions.md` (Organisation), `contracts/configuration.md` ; `research.md` R-03, R-05, R-09 ; `identity/users/*`, `identity/scope-resolver.ts`, `identity/roles.decorator.ts` ; services de WP06.

## Objective

Publier les routes d'organisation d'un prestataire : configuration de niveau prestataire et organisateur, organisateurs, commerçants, contrats `OPERATOR_ORGANIZER` (nouvelle version à deux) et règles de frais `OPERATOR_CONTRACT`.

## Context

Exigences : FR-005, FR-006, FR-007, FR-008, FR-014, FR-019, FR-020, NFR-001. Routes sous `/operators/{operator_id}/…` (prestataire contrôlé par `IdentityTenantContext`), écritures `bo:`, travail et audit dans `IdempotentTx.run`. Ce WP ajoute son module à `app.module.ts` (modification d'une ligne, hors liste de propriété, justifiée : chaîne de dépendances linéaire).

## Branch Strategy

Planification et merge sur `feat/configuration-parties-evenements`. Dépendances : WP07. L'espace de travail (worktree) est attribué par lane calculée dans `lanes.json`. Commande : `spec-kitty agent action implement WP08 --agent claude`.

## Subtasks

### T033 — Configuration prestataire et organisateur

- `…/config-versions` (niveau `OPERATOR`, `OPERATOR_ADMIN`) et `…/organizers/{id}/config-versions` (niveau
  `ORGANIZER`, `OPERATOR_ADMIN` ou `ORGANIZER_ADMIN` selon les clés du catalogue) ; bornes et rôle par clé par le
  validateur de WP06 ; audit.

### T034 — Organisateurs et commerçants

- Organisateurs : `OPERATOR_ADMIN` crée/modifie ; lecture aussi par `ORGANIZER_ADMIN` sur le sien (portée
  `ORGANIZER`) ; partie `ORGANIZER` rattachée au prestataire de la transaction.
- Commerçants : `OPERATOR_ADMIN` et `ORGANIZER_ADMIN` créent/modifient ; `MERCHANT_ADMIN` lit le sien ; aucune
  condition commerciale sur le commerçant (C du §3.1).

### T035 — Contrats `OPERATOR_ORGANIZER`

- Version 1 : champs obligatoires de §4.3 (`offline_loss_bearer`, `cash_diff_bearer`, `breakage_organizer_bps`),
  `operator_fee_basis` et `chargeback_bearer` avec leurs défauts ; champ manquant ⇒ `422` qui le nomme.
- Nouvelle version ⇒ action `CONTRACT_VERSION` (`OPERATOR_ADMIN`, portée prestataire) ; à l'exécution, insertion de
  la version n+1 si la version de référence est toujours la dernière.

### T036 — Règles de frais `OPERATOR_CONTRACT`

- Création, liste, remplacement (fermeture + nouvelle version dans une transaction) des règles du flux prestataire →
  organisateur (par ex. `ORG_FPREST → OPE_FRAIS` sur `TOPUP_AMOUNT`) ; `tax_code` contrôlé contre le profil de
  législation. Le service de règles est conçu pour être réutilisé par WP10 (portées `EVENT`, `PARTICIPATION`) :
  le placer dans `organization/tenant/fee-rules.service.ts` et l'exporter.

### T037 — Tests d'intégration

- US2 de la spec (scénarios 1 à 4) ; isolation à deux prestataires sur chaque route (lecture et écriture : `404`) ;
  `ORGANIZER_ADMIN` d'un autre organisateur refusé ; audit ; rejeu idempotent.

## Test Strategy

Tests demandés par la spec (pgTAP par contrainte, isolation à deux prestataires, intégration sur la base locale). Ordre de vérification : `npm run lint`, `npm run typecheck`, `npm run reset-db -w @cashless/ledger-sql`, `npm run test:pgtap -w @cashless/ledger-sql`, `npm run reset-db -w @cashless/ledger-sql && npm test`.

## Definition of Done

Routes conformes au contrat ; `lint`, `typecheck`, `npm test` verts.

## Risks / Reviewer guidance

Un `ORGANIZER_ADMIN` ne doit jamais régler une clé du prestataire (test dédié).
