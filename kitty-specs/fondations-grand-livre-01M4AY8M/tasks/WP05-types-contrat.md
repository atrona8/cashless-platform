---
work_package_id: WP05
title: Types générés depuis le contrat
dependencies:
- WP01
requirement_refs:
- FR-022
planning_base_branch: feat/fondations-grand-livre
merge_target_branch: feat/fondations-grand-livre
branch_strategy: Planning artifacts for this mission were generated on feat/fondations-grand-livre. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/fondations-grand-livre unless the human explicitly redirects the landing branch.
subtasks:
- T020
- T021
- T022
phase: Phase 2 - Base de données
history:
- timestamp: '2026-10-07T12:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: node-norris
authoritative_surface: packages/contracts/src/
create_intent:
- packages/contracts/generated/openapi.ts
- packages/contracts/scripts/generate.mjs
- packages/contracts/scripts/check.mjs
- packages/contracts/src/index.ts
execution_mode: code_change
owned_files:
- packages/contracts/generated/**
- packages/contracts/scripts/**
- packages/contracts/src/**
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP05 – Types générés depuis le contrat

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load node-norris`. Lis `research.md` §R-10 et le début de
`packages/contracts/openapi.yaml` (conventions, `components.schemas.ProblemCode`, `components.headers`).

## Objective

Générer les types TypeScript depuis `packages/contracts/openapi.yaml` (jamais écrits à la main), exposer
`ProblemCode` (type et liste des valeurs) au reste du dépôt, et fournir un contrôle « types à jour ».

## Context

- Exigences : FR-022, C-007. `openapi.yaml` n'est **pas** modifié par cette mission (C-009).
- Les `int64` sont générés en `number` : ne pas utiliser ces types pour des montants internes (montants internes en
  `bigint`) ; le documenter en tête de `src/index.ts`.

## Branch Strategy

Planification et merge sur `feat/fondations-grand-livre`. Commande : `spec-kitty agent action implement WP05 --agent claude`.

## Subtasks

### T020 — Génération

- `scripts/generate.mjs` : appelle l'API Node d'`openapi-typescript` (`openapiTS(new URL('../openapi.yaml', import.meta.url))`
  puis `astToString`) et écrit `generated/openapi.ts` avec un en-tête « fichier généré — ne pas modifier ».
- Options : `exportType: true`, `enum: false` (types littéraux) ; pas de transformation `int64` → `bigint` (laisser
  `number`, voir Context).
- Script npm `generate`. Le fichier généré est **commité**.

### T021 — Point d'entrée `src/index.ts`

- `export type { paths, components, operations } from '../generated/openapi'`.
- `export type ProblemCode = components['schemas']['ProblemCode']`.
- `export const PROBLEM_CODES: readonly ProblemCode[]` : **généré** aussi (pas de liste à la main) — le script de
  génération écrit en plus `generated/problem-codes.ts` en lisant l'`enum` de `ProblemCode` dans le YAML (petit
  parseur YAML : utiliser la sortie d'`openapi-typescript` ou parser le YAML avec le paquet `yaml` déjà tiré par
  `openapi-typescript` ; ne pas ajouter de dépendance).
- Ajouter aussi `generated/problem-statuses.ts` : statut HTTP de chaque code tiré de la description de `ProblemCode`
  (format `` - `CODE` (409, `CL0xx`) : … ``) ; pour `VALIDATION_FAILED` (400 ou 422) exporter les deux. Sert au test
  de cohérence de la table SQLSTATE (WP10).
- `package.json` : `"main": "src/index.ts"`, `"types": "src/index.ts"` (consommé en TS par les workspaces via SWC).

### T022 — Script `check`

- `scripts/check.mjs` : régénère en mémoire et compare octet à octet aux fichiers commités ; code de sortie 1 avec
  la liste des fichiers périmés. Script npm `check`.

## Definition of Done

- `npm run generate -w @cashless/contracts` puis `npm run check -w @cashless/contracts` : vert ;
  `git status` propre après génération.
- `PROBLEM_CODES` contient les 89 codes de l’énumération (compte du 2026-10-07).

## Risks / Reviewer guidance

- Vérifier qu'aucune valeur de `PROBLEM_CODES` n'est tapée à la main.
- Fins de ligne : écrire en `\n` pour éviter un faux écart sous Windows.
