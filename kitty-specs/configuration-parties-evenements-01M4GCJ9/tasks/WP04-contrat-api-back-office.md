---
work_package_id: WP04
title: 'Contrat d''API : routes et schémas back-office, types régénérés'
dependencies: []
requirement_refs:
- FR-021
planning_base_branch: feat/configuration-parties-evenements
merge_target_branch: feat/configuration-parties-evenements
branch_strategy: Planning artifacts for this mission were generated on feat/configuration-parties-evenements. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/configuration-parties-evenements unless the human explicitly redirects the landing branch.
subtasks:
- T014
- T015
- T016
- T017
phase: 'Phase 1 - Contrat'
history:
- timestamp: '2026-10-09T15:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: packages/contracts/
create_intent: []
execution_mode: code_change
owned_files:
- packages/contracts/openapi.yaml
- packages/contracts/generated/**
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP04 – Contrat d'API : routes et schémas back-office, types régénérés

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan`. Lis `kitty-specs/configuration-parties-evenements-01M4GCJ9/spec.md`, `plan.md`, `research.md`, `data-model.md`, `contracts/`, puis en particulier : `contracts/openapi-additions.md`, `contracts/configuration.md`, `contracts/event-lifecycle.md`, `research.md` R-03, R-09 ; `packages/contracts/openapi.yaml` (conventions, routes « Personnes » de la mission 2, `ApprovalAction`, `ProblemCode`, paramètres communs) ; `packages/contracts/scripts/` (génération et contrôle).

## Objective

Décrire dans `openapi.yaml` toutes les opérations et schémas de la mission avant leur implémentation (C-008), puis régénérer les types TypeScript.

## Context

Exigences : FR-021, C-008. Mêmes conventions que la mission 2 : `humanBearer`, problem+json, `X-Request-Id`, `Accept-Language`, `Idempotency-Key` sur toute écriture, pagination par curseur. Les routes sont rangées sous `paths:` (pas sous `webhooks:` — erreur corrigée en mission 2).

## Branch Strategy

Planification et merge sur `feat/configuration-parties-evenements`. Dépendances : aucune. L'espace de travail (worktree) est attribué par lane calculée dans `lanes.json`. Commande : `spec-kitty agent action implement WP04 --agent claude`.

## Subtasks

### T014 — Schémas

- Tous les schémas listés dans `contracts/openapi-additions.md` (« Schémas ajoutés »), avec descriptions françaises
  qui citent la SPECIFICATION ; montants en entiers (`integer`, `format: int64`), jamais `number`.
- `ResolvedConfigView` : objet dont chaque propriété est `{ value, level, version, config_version_id, provisional }`.
- `StatusCondition` : `met` `boolean` nullable ; `source` énuméré ; `owner_mission` facultatif.
- Extension `violations[]` du problème `VALIDATION_FAILED` décrite (`field`, `rule`, `requested`, `limit`,
  `source`) dans la description générale ou le schéma `Problem` (sans casser l'existant).

### T015 — Routes de plateforme

- Section « Plateforme » de `contracts/openapi-additions.md` : chemins, `operationId`, tags, réponses (`200`, `201`,
  `202` avec `ApprovalRequest`, `401`, `403`, `404`, `409`, `422`), `Idempotency-Key` requis sur les écritures,
  description qui précise « réservé à `PLATFORM_ADMIN` » et le rôle de base utilisé (sans détail interne inutile).

### T016 — Routes d'un prestataire

- Sections « Organisation » et « Événements » : préfixe `/operators/{operator_id}`, rôles exigés dans la
  description, réponses `202` des opérations à deux, `409 EVENT_TRANSITION_INVALID` / `CLOSING_CONDITION_NOT_MET`
  sur les passages de statut, paramètre `at` (date-heure) de la configuration résolue, paramètre `to` des
  conditions.

### T017 — `ApprovalAction`, génération et contrôle

- `ApprovalAction` : huit valeurs ajoutées (R-09) et description de correspondance action → opération complétée.
- `npm run generate` puis `npm run check -w @cashless/contracts` ; `npm run typecheck` vert (le code existant qui
  utilise `ApprovalAction` doit compiler).
- Compter les chemins ajoutés et l'écrire dans le message de commit (repris par la doc).

## Test Strategy

Tests demandés par la spec (pgTAP par contrainte, isolation à deux prestataires, intégration sur la base locale). Ordre de vérification : `npm run lint`, `npm run typecheck`, `npm run reset-db -w @cashless/ledger-sql`, `npm run test:pgtap -w @cashless/ledger-sql`, `npm run reset-db -w @cashless/ledger-sql && npm test`.

## Definition of Done

`npm run check -w @cashless/contracts`, `npm run lint`, `npm run typecheck` verts ; le contrat se valide (le script de génération échoue sur un schéma invalide).

## Risks / Reviewer guidance

Ce WP est le seul propriétaire de `openapi.yaml` : les WP suivants qui découvrent un manque l'ajoutent par une modification minime justifiée dans leur commit, plutôt que de diverger du contrat.
