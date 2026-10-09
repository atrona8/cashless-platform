---
work_package_id: WP13
title: 'Preuves de bout en bout, isolation, performance, CI et décisions'
dependencies:
- WP12
requirement_refs:
- FR-020
- FR-021
planning_base_branch: feat/configuration-parties-evenements
merge_target_branch: feat/configuration-parties-evenements
branch_strategy: Planning artifacts for this mission were generated on feat/configuration-parties-evenements. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/configuration-parties-evenements unless the human explicitly redirects the landing branch.
subtasks:
- T054
- T055
- T056
- T057
phase: 'Phase 5 - Preuves'
history:
- timestamp: '2026-10-09T15:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: apps/api/test/integration/end-to-end/
create_intent:
- apps/api/test/integration/end-to-end/configuration-journey.spec.ts
- apps/api/test/integration/end-to-end/configuration-isolation.spec.ts
- apps/api/test/integration/end-to-end/configuration-latency.spec.ts
execution_mode: code_change
owned_files:
- apps/api/test/integration/end-to-end/configuration-journey.spec.ts
- apps/api/test/integration/end-to-end/configuration-isolation.spec.ts
- apps/api/test/integration/end-to-end/configuration-latency.spec.ts
- docs/DECISIONS_ADR.md
- .github/CI.md
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP13 – Preuves de bout en bout, isolation, performance, CI et décisions

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan`. Lis `kitty-specs/configuration-parties-evenements-01M4GCJ9/spec.md`, `plan.md`, `research.md`, `data-model.md`, `contracts/`, puis en particulier : `spec.md` (Success Criteria, NFR) ; `quickstart.md` ; `test/integration/end-to-end/identity-journey.spec.ts` (mission 2) ; `.github/CI.md` ; `docs/DECISIONS_ADR.md` (format, ADR-78, ADR-79).

## Objective

Prouver la mission de bout en bout, balayer l'isolation sur toutes les routes, mesurer la latence, répéter la CI et consigner les décisions.

## Context

Exigences : SC-001 à SC-005, NFR-001, NFR-003, NFR-006, FR-020, FR-021 ; contradictions X-1 à X-5 de `research.md`.

## Branch Strategy

Planification et merge sur `feat/configuration-parties-evenements`. Dépendances : WP12. L'espace de travail (worktree) est attribué par lane calculée dans `lanes.json`. Commande : `spec-kitty agent action implement WP13 --agent claude`.

## Subtasks

### T054 — Parcours de bout en bout

- `configuration-journey.spec.ts` : étapes 1 à 5 de `quickstart.md` (plateforme → prestataire → organisateur →
  événement → participations → `LIVE` à deux → modification à deux pendant `LIVE`), avec vérification de l'audit
  (chaînes plateforme et prestataire vérifiées par `verify_audit_chain`).

### T055 — Balayage d'isolation

- `configuration-isolation.spec.ts` : pour **chaque** opération ajoutée au contrat par la mission (liste lue dans
  `openapi.yaml` par `operationId`, pour qu'un oubli fasse échouer le test), un appel par un `OPERATOR_ADMIN` d'un
  second prestataire sur les objets du premier ⇒ `404` (ou `403` pour les routes de plateforme).

### T056 — Latence (NFR-003)

- `configuration-latency.spec.ts` : base peuplée (100 événements, 1 000 participations), 200 lectures et 50
  écritures de configuration ⇒ p95 ≤ 200 ms ; 30 créations d'événement ⇒ p95 ≤ 500 ms ; mesures écrites dans la
  sortie du test et reportées dans `.github/CI.md`.

### T057 — Non-régression, CI et décisions

- Répétition complète de la CI en local (ordre de `.github/CI.md`), durées et compteurs consignés dans
  `.github/CI.md` (section datée, mode Docker sur macOS documenté).
- `docs/DECISIONS_ADR.md` : ADR-80 (rôle de base de plateforme, coexistence avec `create_platform_admin`), ADR-81
  (profils de législation gérés par la plateforme, X-1), mention de X-3 à X-5.
- `quickstart.md` de la mission vérifié (commandes rejouées) ; écarts remontés dans le rapport du WP (le fichier de
  planification est mis à jour à la review, hors propriété du WP).

## Test Strategy

Tests demandés par la spec (pgTAP par contrainte, isolation à deux prestataires, intégration sur la base locale). Ordre de vérification : `npm run lint`, `npm run typecheck`, `npm run reset-db -w @cashless/ledger-sql`, `npm run test:pgtap -w @cashless/ledger-sql`, `npm run reset-db -w @cashless/ledger-sql && npm test`.

## Definition of Done

Toute la CI verte en local ; documents à jour ; aucune régression des suites des missions 1 et 2.

## Risks / Reviewer guidance

Le balayage d'isolation doit être piloté par le contrat, pas par une liste écrite à la main.
