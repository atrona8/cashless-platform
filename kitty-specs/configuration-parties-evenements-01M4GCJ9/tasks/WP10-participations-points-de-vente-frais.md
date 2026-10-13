---
work_package_id: WP10
title: 'Participations, points de vente et règles de frais d''événement'
dependencies:
- WP09
requirement_refs:
- FR-008
- FR-012
- FR-013
- FR-019
- FR-020
planning_base_branch: feat/configuration-parties-evenements
merge_target_branch: feat/configuration-parties-evenements
branch_strategy: Planning artifacts for this mission were generated on feat/configuration-parties-evenements. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/configuration-parties-evenements unless the human explicitly redirects the landing branch.
subtasks:
- T042
- T043
- T044
- T045
phase: 'Phase 3 - Routes'
history:
- timestamp: '2026-10-09T15:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: apps/api/src/events/participations/
create_intent:
- apps/api/test/integration/events/participations.spec.ts
- apps/api/test/integration/events/fee-rules.spec.ts
execution_mode: code_change
owned_files:
- apps/api/src/events/participations/**
- apps/api/test/integration/events/participations*.spec.ts
- apps/api/test/integration/events/fee-rules*.spec.ts
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP10 – Participations, points de vente et règles de frais d'événement

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan`. Lis `kitty-specs/configuration-parties-evenements-01M4GCJ9/spec.md`, `plan.md`, `research.md`, `data-model.md`, `contracts/`, puis en particulier : `contracts/openapi-additions.md` (Événements : participations, points de vente, règles de frais) ; `research.md` R-04, R-09 ; `data-model.md` (`merchant_participation`, `point_of_sale`, `fee_rule`) ; service de règles de WP08.

## Objective

Inscrire les commerçants aux événements (compte commerçant créé), gérer leurs points de vente, et régler les frais de portée `EVENT` et `PARTICIPATION`, à deux pendant `LIVE`.

## Context

Exigences : FR-008, FR-012, FR-013, FR-019, FR-020. Fichiers rangés sous `events/participations/` ; le sous-module est importé par `EventsModule` (modification d'une ligne, justifiée).

## Branch Strategy

Planification et merge sur `feat/configuration-parties-evenements`. Dépendances : WP09. L'espace de travail (worktree) est attribué par lane calculée dans `lanes.json`. Commande : `spec-kitty agent action implement WP10 --agent claude`.

## Subtasks

### T042 — Participations

- `POST …/events/{id}/participations` : commerçant du prestataire, type, droit de place et mode, référence si
  `PREPAID` ; `INSERT` puis `open_participation_account` dans la transaction ; `409` si déjà inscrit ; audit.
- Lecture (+ `MERCHANT_ADMIN` du commerçant) ; `PATCH` (`DRAFT` immédiat, `LIVE` ⇒ `PARTICIPATION_CHANGE`).

### T043 — Points de vente

- Création, liste, consultation, renommage ; portée de l'événement de la participation.

### T044 — Règles de frais `EVENT` et `PARTICIPATION`

- `GET/POST …/fee-rules`, `POST …/fee-rules/{id}/replacements` : portée dans le corps (`OPERATOR_CONTRACT`
  délégué au service de WP08, `EVENT`, `PARTICIPATION`) ; commission d'un commerçant = règle `PARTICIPATION`
  (`MERCHANT → ORG_COM`, `SALE_AMOUNT`) ; événement `LIVE` ⇒ `FEE_RULE_CHANGE` (`202`).

### T045 — Actions et tests

- Définitions `PARTICIPATION_CHANGE`, `FEE_RULE_CHANGE`.
- Intégration : US4 de la spec (1 à 4) ; compte `L-MCH-*` chaud et négatif permis ; règle jamais modifiée, remplacée ;
  `202` pendant `LIVE` puis nouvelle version ; isolation à deux prestataires ; participation sur événement `CLOSED`
  refusée.

## Test Strategy

Tests demandés par la spec (pgTAP par contrainte, isolation à deux prestataires, intégration sur la base locale). Ordre de vérification : `npm run lint`, `npm run typecheck`, `npm run reset-db -w @cashless/ledger-sql`, `npm run test:pgtap -w @cashless/ledger-sql`, `npm run reset-db -w @cashless/ledger-sql && npm test`.

## Definition of Done

Routes conformes ; `lint`, `typecheck`, `npm test` verts.

## Risks / Reviewer guidance

La commission est portée par la participation (règle `PARTICIPATION`), jamais par le commerçant.
