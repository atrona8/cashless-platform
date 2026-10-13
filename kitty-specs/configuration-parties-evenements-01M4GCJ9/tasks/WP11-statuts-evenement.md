---
work_package_id: WP11
title: 'Statuts d''événement : conditions visibles, passages, LIVE à deux'
dependencies:
- WP10
requirement_refs:
- FR-017
- FR-018
- FR-019
- FR-020
planning_base_branch: feat/configuration-parties-evenements
merge_target_branch: feat/configuration-parties-evenements
branch_strategy: Planning artifacts for this mission were generated on feat/configuration-parties-evenements. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/configuration-parties-evenements unless the human explicitly redirects the landing branch.
subtasks:
- T046
- T047
- T048
- T049
phase: 'Phase 3 - Routes'
history:
- timestamp: '2026-10-09T15:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: apps/api/src/events/status/
create_intent:
- apps/api/test/integration/events/status.spec.ts
execution_mode: code_change
owned_files:
- apps/api/src/events/status/**
- apps/api/test/integration/events/status*.spec.ts
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP11 – Statuts d'événement : conditions visibles, passages, LIVE à deux

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan`. Lis `kitty-specs/configuration-parties-evenements-01M4GCJ9/spec.md`, `plan.md`, `research.md`, `data-model.md`, `contracts/`, puis en particulier : `contracts/event-lifecycle.md` ; `research.md` R-08 ; `data-model.md` (`event_transition_conditions`) ; SPECIFICATION §12.1 ; `errors/sqlstate-map.ts` (CL018, CL019).

## Objective

Exposer les conditions de passage et leur état, appliquer les passages par `set_event_status`, et faire passer `LIVE` par une demande à deux.

## Context

Exigences : FR-017, FR-018, FR-019, FR-020, C-001. Sous-module importé par `EventsModule`.

## Branch Strategy

Planification et merge sur `feat/configuration-parties-evenements`. Dépendances : WP10. L'espace de travail (worktree) est attribué par lane calculée dans `lanes.json`. Commande : `spec-kitty agent action implement WP11 --agent claude`.

## Subtasks

### T046 — Conditions

- `GET …/events/{id}/status-conditions?to=` (défaut : statut suivant) : conditions `DATABASE`
  (`event_transition_conditions`), `CONFIGURATION` pour `LIVE` (`FUNDS_HOLDER_SET`, `CONTRACT_IN_FORCE`,
  `JURISDICTION_SET`, `LEDGER_OPEN`), `EXTERNAL` (`met = null`, mission responsable) ; `detail` traduit par `code`.

### T047 — Passages

- `POST …/events/{id}/status-transitions` `{ to }` : `LIVE` ⇒ conditions de configuration remplies (sinon `409
  CLOSING_CONDITION_NOT_MET` qui nomme la condition) puis demande `EVENT_GO_LIVE` (`202`) ; autres ⇒
  `set_event_status(événement, to, personne)` ; `CL018`/`CL019` traduits sans texte SQL (le `detail` du `CL019`
  nomme la condition à partir d'un appel préalable à `event_transition_conditions`, pas du message SQL) ; audit
  `EVENT_STATUS_CHANGED`.

### T048 — Action `EVENT_GO_LIVE`

- Payload : statut visé, `config_version_id` en vigueur ; exécution : version toujours la dernière et conditions
  toujours remplies, sinon `FAILED` ; `set_event_status` avec l'auteur de la demande ; audit avec valideur.

### T049 — Tests d'intégration

- US5 de la spec (1 à 5) ; conditions identiques aux refus de la base pour au moins deux statuts ; demande `LIVE`
  approuvée après un changement de configuration ⇒ `FAILED` ; isolation.

## Test Strategy

Tests demandés par la spec (pgTAP par contrainte, isolation à deux prestataires, intégration sur la base locale). Ordre de vérification : `npm run lint`, `npm run typecheck`, `npm run reset-db -w @cashless/ledger-sql`, `npm run test:pgtap -w @cashless/ledger-sql`, `npm run reset-db -w @cashless/ledger-sql && npm test`.

## Definition of Done

Routes conformes ; `lint`, `typecheck`, `npm test` verts.

## Risks / Reviewer guidance

Aucun chemin ne doit écrire `event.status` directement (le déclencheur refuserait de toute façon : test).
