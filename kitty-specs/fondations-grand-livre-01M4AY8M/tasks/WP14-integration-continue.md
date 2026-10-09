---
work_package_id: WP14
title: Intégration continue
dependencies:
- WP04
- WP05
- WP11
- WP13
requirement_refs:
- FR-004
- FR-005
- FR-022
- FR-023
planning_base_branch: feat/fondations-grand-livre
merge_target_branch: feat/fondations-grand-livre
branch_strategy: Planning artifacts for this mission were generated on feat/fondations-grand-livre. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/fondations-grand-livre unless the human explicitly redirects the landing branch.
subtasks:
- T072
- T073
- T074
- T075
phase: Phase 5 - Preuve de bout en bout et CI
history:
- timestamp: '2026-10-07T12:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: .github/workflows/
create_intent:
- .github/CI.md
execution_mode: code_change
owned_files:
- .github/workflows/**
- .github/CI.md
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP14 – Intégration continue

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan`. Lis le `.github/workflows/ledger-tests.yml` du kit,
`quickstart.md`, et les scripts npm des trois workspaces.

## Objective

Réécrire le job CI pour qu'il vérifie à chaque commit tout ce que la mission livre, sous PostgreSQL 17, et le
répéter localement étape par étape (pas de remote : C-010).

## Context

- Exigences : FR-004, FR-005, FR-022, FR-023, NFR-007 (< 15 min), C-010.
- `ubuntu-24.04`, service `postgres:17`, pgTAP installé dans le conteneur (`postgresql-17-pgtap`), `pg_prove` par le
  paquet `libtap-parser-sourcehandler-pgtap-perl` (comme le kit).

## Branch Strategy

Planification et merge sur `feat/fondations-grand-livre`. Commande : `spec-kitty agent action implement WP14 --agent claude`.

## Subtasks

### T072 — `ledger-tests.yml`

Étapes, dans l'ordre (échec au premier rouge) :
1. `actions/checkout@v4`, `actions/setup-node@v4` (Node 22, cache npm), `actions/setup-python@v5` (3.11).
2. Installer pgTAP dans le conteneur et `pg_prove` sur le runner (repris du kit).
3. `npm ci --ignore-scripts`.
4. `npm run check:generated -w @cashless/ledger-sql` (générateurs pgTAP à jour).
5. `python packages/ledger-sql/moteur_ecritures_reference.py`.
6. `npm run check -w @cashless/contracts` (types à jour).
7. `npm run lint` et `npm run typecheck`.
8. Base : `createdb cashless_test` ; `npm run migrate -w @cashless/ledger-sql` (variables `DATABASE_URL_OWNER`,
   `CASHLESS_APP_PASSWORD`).
9. `npm run test:pgtap -w @cashless/ledger-sql` (400 + 64 + S21).
10. Base recréée, puis `npm test` (unitaires, intégration, scénario) avec `DATABASE_URL_APP`.
- Déclencheurs `push` et `pull_request` ; `concurrency` par branche ; `timeout-minutes: 20`.

### T073 — Répétition locale

- Exécuter localement chaque commande des étapes 3 à 10 sur le cluster privé (même ordre) et consigner le résultat
  (sortie résumée, durées) dans le rapport d'implémentation du WP. Valider la syntaxe YAML (analyse avec le paquet
  `yaml` de `node_modules`) et la présence de chaque script npm appelé.

### T074 — `.github/CI.md`

- Ce que fait chaque étape, comment la reproduire localement (renvoi vers `tools/dev-db/README.md` et
  `quickstart.md`), et l'état « non encore exécutée sur GitHub (pas de remote au 2026-10-07) ».

### T075 — Contrôle final des critères 1 à 3

- Sur base fraîche : 464 + S21 assertions vertes ; 19 cas verts ; rejeu exact et second rejeu nul. Rapporter les
  chiffres exacts (nombre d'assertions, de tests Jest) dans le rapport du WP.

## Definition of Done

- Workflow valide syntaxiquement, toutes les étapes vertes en répétition locale, documentation présente.

## Risks / Reviewer guidance

- Vérifier que la CI crée la base **par les migrations** (et non par le fichier brut).
- Vérifier `--ignore-scripts`.
