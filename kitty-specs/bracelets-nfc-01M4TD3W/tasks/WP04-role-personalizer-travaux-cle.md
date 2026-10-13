---
work_package_id: WP04
title: Rôle PERSONALIZER, actions à deux et travaux de clé (migrations 0011 et 0012)
dependencies:
- WP03
requirement_refs:
- FR-007
- FR-008
- FR-009
- FR-010
- FR-029
planning_base_branch: feat/bracelets-nfc
merge_target_branch: feat/bracelets-nfc
branch_strategy: Planning artifacts for this mission were generated on feat/bracelets-nfc. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/bracelets-nfc unless the human explicitly redirects the landing branch.
subtasks:
- T014
- T015
- T016
- T017
phase: Phase 1 - Socle
history:
- timestamp: '2026-10-13T12:05:28Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: packages/ledger-sql/migrations/0011_personalizer_role.sql
create_intent: []
execution_mode: code_change
owned_files:
- packages/ledger-sql/migrations/0011_personalizer_role.sql
- packages/ledger-sql/migrations/0012_tag_key_jobs.sql
- packages/ledger-sql/tests/tests_personalizer_role.sql
- packages/ledger-sql/tests/tests_tag_key_jobs.sql
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP04 – Rôle PERSONALIZER, actions à deux et travaux de clé (migrations 0011 et 0012)

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan`. Lis ensuite `README.md` (kit), `docs/SPECIFICATION.md` (sections citées ci-dessous), puis `kitty-specs/bracelets-nfc-01M4TD3W/spec.md`, `plan.md`, `research.md`, `data-model.md` et les contrats cités. En cas de contradiction entre sources, applique la règle de priorité de SPECIFICATION §0.3 et **signale-la** ; ne modifie jamais un fichier `.sql` généré de `packages/ledger-sql/`.

## Objective

Ajouter le rôle humain `PERSONALIZER`, les quatre actions à deux de la mission, la table des travaux de clé et celle des comptes rendus du contrôle quotidien.

## Context

Exigences : FR-007 à FR-010, FR-029, FR-035. Modèle : `data-model.md` (migrations 0011, 0012). Contrat : `contracts/key-services.md`. Précédents : `0003_identity.sql` (contrainte des rôles), `0009_platform_scope.sql` (remplacement de la contrainte des actions), `tests/tests_approvals.sql`.

**Règle de sécurité du projet (`CLAUDE.md`, C-011)** : si un point de ce lot ne peut être tenu qu'en affaiblissant la sécurité (droit plus large, contrôle retiré ou reporté, secret plus exposé, faux gardé plus longtemps), **arrête-toi sur ce point et soumets-le au porteur avant de coder** ; continue le reste. Un renforcement se fait, puis se consigne.

## Branch Strategy

Planification et merge sur `feat/bracelets-nfc`. Dépendances : WP03. L'espace de travail (worktree) est attribué par lane calculée dans `lanes.json`. Commande : `spec-kitty agent action implement WP04 --agent claude --mission bracelets-nfc-01M4TD3W`.

## Subtasks

### T014 — Rôle PERSONALIZER (0011)

- Remplace `role_assignment_role` pour ajouter `PERSONALIZER` ; étends `role_assignment_role_scope` : portée `OPERATOR` seulement.
- Relis toutes les fonctions et politiques de la mission 2 qui énumèrent les rôles (`identify_person`, gardes d'attribution) : un `OPERATOR_ADMIN` peut attribuer et retirer `PERSONALIZER` dans son prestataire, personne d'autre.
- Tests : attribution permise et refusée, portée refusée hors `OPERATOR`, isolation.

### T015 — Actions à deux (0011)

- Remplace `approval_request_action_check` en ajoutant `TAG_KEY_CREATE`, `TAG_DEK_ROTATE`, `TAG_KEY_RETIRE`, `MEDIA_REINSTATE` ; la contrainte d'équivalence « portée plateforme ⇔ `operator_id` NULL » de `0009` reste vraie : ces quatre actions ont toujours un prestataire.
- Tests : chaque action insérable avec un prestataire, refusée sans.

### T016 — Travaux de clé et comptes rendus (0012)

- `tag_key_job` selon `data-model.md` : sortes `CREATE_KEY`, `CREATE_DEK`, `ROTATE_DEK`, `REENCRYPT`, `RETIRE_KEY`, `DISABLE_KMS_KEY` ; états `PENDING`, `RUNNING`, `DONE`, `FAILED` ; index unique partiel « un seul travail non terminé par (prestataire, index, sorte) » ; `payload` et `progress` jsonb avec un CHECK qui refuse les clés `plaintext`, `dek`, `pwd`, `secret` (garde-fou contre un secret écrit par erreur).
- `claim_tag_key_job(p_kinds text[]) RETURNS tag_key_job` (`FOR UPDATE SKIP LOCKED`, passe en `RUNNING`, incrémente `attempts`), `finish_tag_key_job(p_job, p_status, p_error, p_progress)`.
- `tag_key_check_run` : prestataire, début, fin, échantillon, écarts, statut `OK`, `MISMATCH`, `ERROR`.
- RLS sur les deux tables ; les politiques par rôle de base viennent au WP06.

### T017 — Tests pgTAP

- `tests_personalizer_role.sql` et `tests_tag_key_jobs.sql` : contraintes, unicité partielle, prise concurrente d'un travail (deux sessions), garde-fou sur les clés de `payload`, isolation.

## Test Strategy

Tests demandés par la spec (pgTAP par contrainte, intégration HTTP sur vraie base, isolation à deux prestataires, preuves de sécurité). Ordre de vérification : `npm run lint`, `npm run typecheck`, `npm run reset-db -w @cashless/ledger-sql`, `npm run test:pgtap -w @cashless/ledger-sql`, puis `npm run reset-db -w @cashless/ledger-sql && npm test`. Ne jamais lancer pgTAP sur une base où Jest vient de tourner. Dans un worktree de lane, créer d'abord les liens `node_modules/@cashless/{api,contracts,ledger-sql,tag-format}`.

## Definition of Done

pgTAP vert, suites de référence et suites des missions 2 et 3 comprises (`tests_identity.sql`, `tests_approvals.sql`, `tests_platform_scope.sql`). Chaque sous-tâche est marquée par `spec-kitty agent tasks mark-status Txxx --status done --mission bracelets-nfc-01M4TD3W`. Le compte rendu du lot liste : écarts au plan (avec leur sens : renforcement ou non), retouches hors carte, points soumis au porteur.

## Risks / Reviewer guidance

Élargir la contrainte des rôles sans relire les fonctions de la mission 2 laisserait `PERSONALIZER` inattribuable ou attribuable par n'importe qui.
