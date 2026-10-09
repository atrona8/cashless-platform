---
work_package_id: WP09
title: 'Événements : création avec grand livre, lecture, modification, configuration résolue'
dependencies:
- WP02
- WP08
requirement_refs:
- FR-009
- FR-010
- FR-011
- FR-014
- FR-015
- FR-019
- FR-020
planning_base_branch: feat/configuration-parties-evenements
merge_target_branch: feat/configuration-parties-evenements
branch_strategy: Planning artifacts for this mission were generated on feat/configuration-parties-evenements. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/configuration-parties-evenements unless the human explicitly redirects the landing branch.
subtasks:
- T038
- T039
- T040
- T041
phase: 'Phase 3 - Routes'
history:
- timestamp: '2026-10-09T15:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: apps/api/src/events/
create_intent:
- apps/api/src/events/events.module.ts
- apps/api/src/events/event-approval-actions.ts
- apps/api/test/integration/events/events.spec.ts
execution_mode: code_change
owned_files:
- apps/api/src/events/events.*
- apps/api/src/events/events.module.ts
- apps/api/src/events/event-approval-actions.ts
- apps/api/test/integration/events/events*.spec.ts
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP09 – Événements : création avec grand livre, lecture, modification, configuration résolue

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan`. Lis `kitty-specs/configuration-parties-evenements-01M4GCJ9/spec.md`, `plan.md`, `research.md`, `data-model.md`, `contracts/`, puis en particulier : `contracts/event-lifecycle.md`, `contracts/configuration.md`, `contracts/openapi-additions.md` (Événements) ; `research.md` R-04, R-05, R-06, R-09 ; `data-model.md` (Migration 0007, 0008).

## Objective

Créer un événement avec son grand livre et ses comptes, le lire, le modifier par qui de droit (à deux pendant `LIVE`) et exposer sa configuration résolue.

## Context

Exigences : FR-009, FR-010, FR-011, FR-014, FR-015, FR-019, FR-020, NFR-004. Le module `EventsModule` est ajouté à `app.module.ts` (une ligne, justifiée). Les participations (WP10) et les statuts (WP11) étendent ce module par leurs propres fichiers.

## Branch Strategy

Planification et merge sur `feat/configuration-parties-evenements`. Dépendances : WP02, WP08. L'espace de travail (worktree) est attribué par lane calculée dans `lanes.json`. Commande : `spec-kitty agent action implement WP09 --agent claude`.

## Subtasks

### T038 — Création

- `POST …/events` : `ORGANIZER_ADMIN` sur l'organisateur visé (ou `OPERATOR_ADMIN`) ; validation (détenteur des
  fonds obligatoire, tiers si `THIRD_PARTY`, devise connue, dates, profil, contrat de l'organisateur) ; bornes ;
  `INSERT event` (`DRAFT`), `open_event_ledger`, version `EVENT` 1 (instantané), audit — une transaction
  (`IdempotentTx.run`). `refund_deadline` absente : renvoyée calculée avec `refund_deadline_source`.

### T039 — Lecture et configuration résolue

- `GET …/events`, `GET …/events/{id}` (avec `ledger_id`) ; lecture aussi par `SUPERVISOR` de l'événement.
- `GET …/events/{id}/config?at=` : vue résolue de WP06.

### T040 — Modification

- `PATCH …/events/{id}` : clé `status` refusée (`422`) ; rôle par clé (catalogue) ; `DRAFT` ⇒ immédiat (colonnes +
  nouvelle version + audit) ; `LIVE` ⇒ `EVENT_SETTINGS_CHANGE` ou `EVENT_OPERATOR_SETTINGS_CHANGE` (`202`) ; à partir
  de `CLOSING` ⇒ `409 CONFLICT_STATE`.
- `event-approval-actions.ts` : ces deux actions (validation stricte, exécution qui revérifie la version de
  référence et les bornes, puis applique).

### T041 — Tests d'intégration

- US3 de la spec (scénarios 1 à 6) ; atomicité (NFR-004) : erreur injectée après `INSERT event` ⇒ ni événement ni
  grand livre ; isolation à deux prestataires ; modification à deux pendant `LIVE` (l'événement est passé `LIVE` par
  `set_event_status` en fixture propriétaire, la route de statut arrivant en WP11) ; configuration résolue à une
  date antérieure.

## Test Strategy

Tests demandés par la spec (pgTAP par contrainte, isolation à deux prestataires, intégration sur la base locale). Ordre de vérification : `npm run lint`, `npm run typecheck`, `npm run reset-db -w @cashless/ledger-sql`, `npm run test:pgtap -w @cashless/ledger-sql`, `npm run reset-db -w @cashless/ledger-sql && npm test`.

## Definition of Done

Routes conformes ; `lint`, `typecheck`, `npm test` verts.

## Risks / Reviewer guidance

`open_event_ledger` doit être appelée dans la même transaction que l'insertion : jamais de second appel hors `IdempotentTx.run`.
