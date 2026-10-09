---
work_package_id: WP07
title: Extensions de l'idempotence (problème validé, garde RISK-2)
dependencies: []
requirement_refs:
- FR-015
planning_base_branch: feat/identite-roles
merge_target_branch: feat/identite-roles
branch_strategy: Planning artifacts for this mission were generated on feat/identite-roles. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/identite-roles unless the human explicitly redirects the landing branch.
subtasks:
- T030
- T031
- T032
- T033
phase: Phase 3 - Double validation
history:
- timestamp: '2026-10-08T13:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: node-norris
authoritative_surface: apps/api/src/idempotency/
create_intent:
- apps/api/test/unit/idempotency-guard.spec.ts
- apps/api/test/integration/transverse/committed-problem.spec.ts
execution_mode: code_change
owned_files:
- apps/api/src/idempotency/**
- apps/api/test/unit/idempotency-guard.spec.ts
- apps/api/test/integration/transverse/committed-problem.spec.ts
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP07 – Extensions de l'idempotence

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load node-norris`. Lis le code de la mission 1 :
`apps/api/src/idempotency/` (intercepteur, dépôt, décorateur), `src/errors/problem.ts`, `src/errors/problem.filter.ts`,
`test/integration/transverse/test-route.module.ts`, `idempotency.spec.ts` ; puis `research.md` R-08 (demande
expirée) et R-10 (RISK-2), et `kitty-specs/fondations-grand-livre-01M4AY8M/mission-review-report.md` (RISK-2).

## Objective

Deux extensions de l'idempotence de la mission 1 : (1) pouvoir répondre une erreur **et** valider le travail fait
(une demande d'approbation expirée doit rester `EXPIRED`) ; (2) détecter une route idempotente qui écrit hors de
`IdempotentTx` (RISK-2).

## Context

- Exigences : FR-015 ; support de FR-011 (expiration).
- Indépendant du reste de la mission (aucune dépendance).

## Branch Strategy

Planification et merge sur `feat/identite-roles`. Commande : `spec-kitty agent action implement WP07 --agent claude`.

## Subtasks

### T030 — Problème « validé »

- `CommittedProblem extends ProblemException` (ou option `{ commit: true }`) : levée **à l'intérieur** de
  `IdempotentTx.run`, elle ne fait pas annuler la transaction métier : `run` construit la réponse problème
  (`resolveProblem` + `problemBody`, même forme que le filtre), l'enregistre par `complete` dans la même
  transaction, valide (`COMMIT`), puis la réponse envoyée est ce problème (statut, `Content-Type:
  application/problem+json`). Rejeu : même réponse, `Idempotency-Replayed: true`.
- `TenantTx.run` ne doit pas annuler : soit `IdempotentTx.run` capture l'exception dans son `fn` interne et renvoie
  un marqueur, soit une API dédiée ; rester dans `src/idempotency/`.

### T031 — Garde d'exécution `writes`

- `@Idempotent({ scope, writes?: boolean })` ; si `writes: true` et que `IdempotentTx.run` n'a pas été appelé quand
  le contrôleur rend sa valeur : erreur 500 journalisée (`code` interne `IDEMPOTENT_ROUTE_WITHOUT_TX` dans le
  journal serveur, `INTERNAL_ERROR` côté client), la clé est relâchée (aucune réponse enregistrée).
- Défaut : `writes: true` pour toute route `@Idempotent` (les routes de cette mission écrivent toutes) ; les routes
  de test de la mission 1 qui n'écrivent pas déclarent `writes: false`.

### T032 — Test d'architecture RISK-2 (`test/unit/idempotency-guard.spec.ts`)

- Analyse textuelle de `apps/api/src/**/*.ts` : toute méthode précédée de `@Idempotent(` a un paramètre
  `@IdempotentTransaction()` ; aucun fichier de contrôleur qui utilise `@Idempotent` n'injecte `TenantTx`.
- Le test échoue en nommant le fichier et la méthode fautifs.

### T033 — Tests (`test/integration/transverse/committed-problem.spec.ts`)

- Route de test : écrit une ligne puis lève `CommittedProblem('APPROVAL_INVALID', 409)` → réponse `409`
  problem+json, la ligne **est** en base, la clé est `COMPLETED` avec la réponse `409` ; rejeu identique.
- Route `@Idempotent({ writes: true })` qui écrit par `TenantTx` sans `IdempotentTx` → `500`, rien d'enregistré pour
  la clé (réutilisable).
- Tous les tests de la mission 1 restent verts.

## Definition of Done

- Tests verts ; le test d'architecture passe sur le code actuel et échoue sur un contrôleur fautif (démontré par un
  fixture de texte dans le test).

## Risks / Reviewer guidance

- `CommittedProblem` ne doit jamais servir à valider un travail **partiel** : seulement quand l'état écrit est
  l'état voulu (ex. passage `EXPIRED`). Le documenter dans le code.
