---
work_package_id: WP10
title: Preuves de bout en bout et non-régression
dependencies:
- WP09
requirement_refs:
- FR-007
- FR-017
planning_base_branch: feat/identite-roles
merge_target_branch: feat/identite-roles
branch_strategy: Planning artifacts for this mission were generated on feat/identite-roles. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/identite-roles unless the human explicitly redirects the landing branch.
subtasks:
- T044
- T045
- T046
- T047
phase: Phase 4 - Preuves
history:
- timestamp: '2026-10-08T13:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: node-norris
authoritative_surface: apps/api/test/integration/end-to-end/
create_intent:
- apps/api/test/integration/end-to-end/identity-journey.spec.ts
- apps/api/test/integration/end-to-end/isolation-sweep.spec.ts
execution_mode: code_change
owned_files:
- apps/api/test/integration/end-to-end/**
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP10 – Preuves de bout en bout et non-régression

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load node-norris`. Lis `spec.md` (Success Criteria, NFR), `quickstart.md`,
`.github/CI.md`, le code et les tests de WP01 à WP09.

## Objective

Prouver la mission de bout en bout (SC-001 à SC-005), balayer l'isolation de toutes les nouvelles routes, vérifier la
non-régression de la mission 1 et la CI, et consigner les contradictions (FR-017).

## Context

- Exigences : FR-017, FR-007 (amorçage de bout en bout), SC-001 à SC-005, NFR-001, NFR-004, NFR-006, NFR-007.

## Branch Strategy

Planification et merge sur `feat/identite-roles`. Commande : `spec-kitty agent action implement WP10 --agent claude`.

## Subtasks

### T044 — Parcours complet (`identity-journey.spec.ts`)

- `bootstrap-admin` (appelé comme processus ou par sa fonction exportée) → `PLATFORM_ADMIN` ; il crée un
  `OPERATOR_ADMIN` (via `/operators/{op}/users` + `role-assignments`) ; celui-ci crée un `ORGANIZER_ADMIN` ; une
  demande de démonstration est créée (`202`), refusée à l'auteur (`409`), approuvée par une seconde personne
  (`200 EXECUTED`) ; un jeton sur place est utilisé une fois ; à la fin, `verify_audit_chain` (rôle propriétaire)
  sur la chaîne du prestataire et sur celle de la plateforme → 0 anomalie ; nombre de lignes d'audit = nombre
  d'actions réussies (NFR-004) ; `seal_audit(chaîne, '0')` puis `verify_audit_chain` → 0 anomalie.

### T045 — Balayage d'isolation (`isolation-sweep.spec.ts`)

- Pour chaque nouvelle route (liste construite depuis `openapi.yaml` : chemins `/operators/…`, `/platform-admins`,
  `/approval-requests…`) : une personne du prestataire B ne lit ni ne modifie un objet du prestataire A (`404` ou
  `403`, jamais `200`) ; personne sans jeton → `401` (SC-001, NFR-001). Le test échoue si une route du contrat
  ajoutée par la mission n'est pas couverte.

### T046 — Non-régression et CI

- `npm test` complet (mission 1 incluse, rejeu du scénario) vert ; `test:pgtap` vert (anciennes et nouvelles
  suites) ; répétition locale des étapes du job `ledger-tests` (script de `.github/CI.md`) avec durée < 15 min ;
  noter les chiffres (assertions, tests) dans le commit.

### T047 — Contradictions et quickstart

- Ajouter à `kitty-specs/identite-roles-double-validation-01M4DNDN/research.md` (hors carte : fichier de mission,
  justifié par FR-017) une section « Contradictions constatées à l'implémentation » : R-02 (`result`), R-03
  (`sub` / UUID), toute autre constatée par WP01-WP09.
- Dérouler `quickstart.md` ; corriger les écarts de commandes (hors carte si nécessaire, signalé).

## Definition of Done

- Tous les tests verts, durée CI < 15 min, contradictions consignées.

## Risks / Reviewer guidance

- Le balayage doit dériver la liste des routes du contrat (pas une liste en dur oubliable).
