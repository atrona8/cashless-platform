---
work_package_id: WP16
title: 'Routes : back-office des terminaux (liste, fiche, suspension, réactivation, révocation)'
dependencies:
- WP01
- WP03
- WP04
- WP07
- WP12
requirement_refs:
- FR-015
- FR-016
- FR-017
- FR-025
- NFR-003
- NFR-007
planning_base_branch: feat/identite-enrolement-terminaux
merge_target_branch: feat/identite-enrolement-terminaux
branch_strategy: Planning artifacts for this mission were generated on feat/identite-enrolement-terminaux. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/identite-enrolement-terminaux unless the human explicitly redirects the landing branch.
subtasks:
- T075
- T076
- T077
- T078
phase: Phase 3 - Routes
history:
- timestamp: '2026-10-19T13:30:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: node-norris
authoritative_surface: apps/api/src/devices/admin/
create_intent:
- apps/api/test/integration/devices/admin.spec.ts
execution_mode: code_change
owned_files:
- apps/api/src/devices/admin/**
- apps/api/test/integration/devices/admin.spec.ts
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP16 – Routes : back-office des terminaux (liste, fiche, suspension, réactivation, révocation)

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load node-norris`. Lis ensuite `README.md` (kit), `docs/SPECIFICATION.md` (sections citées ci-dessous), puis `kitty-specs/identite-enrolement-terminaux-01M52R6H/spec.md`, `plan.md`, `research.md`, `data-model.md` et les contrats cités. En cas de contradiction entre sources, applique la règle de priorité de SPECIFICATION §0.3 et **signale-la** ; ne modifie jamais un fichier `.sql` généré de `packages/ledger-sql/` (passe par les générateurs `gen_tests.py`, `gen_golden.py`).

## Objective

Servir les six routes back-office ajoutées au contrat (`listDevices`, `getDevice`, `suspendDevice`, `reactivateDevice`, `revokeDevice` ; `listDeviceEnrollmentCodes` est servie par WP14) avec effet immédiat sur les requêtes du terminal.

## Context

Exigences : FR-015, FR-016, FR-017, FR-025, NFR-003, NFR-007 ; `contracts/device-lifecycle.md` ; `research.md` R-14 ; hypothèse A2 (une personne suffit) ; fonction `set_device_status` (WP03), garde et terminal de test (WP12). Enregistre le module par une ligne dans `devices/devices.module.ts`.

**Règle de sécurité du projet (`CLAUDE.md`, C-011, C-012)** : si un point de ce lot ne peut être tenu qu'en affaiblissant la sécurité (droit plus large, contrôle retiré ou reporté, secret plus exposé, faux gardé plus longtemps), **arrête-toi sur ce point et soumets-le au porteur avant de coder**, avec le risque et les options ; continue le reste. Un renforcement se fait, puis se consigne dans le compte rendu du lot.

## Branch Strategy

Planification et merge sur `feat/identite-enrolement-terminaux`. Dépendances : WP01, WP03, WP04, WP07, WP12. L'espace de travail (worktree) est attribué par lane calculée dans `lanes.json`. Commande : `spec-kitty agent action implement WP16 --agent claude --mission identite-enrolement-terminaux-01M52R6H`.

## Subtasks

### T075 — Liste et fiche

Filtres `event_id`, `pos_id`, `status`, `app_mode`, pagination par curseur ; fiche avec historique des statuts ; jamais `public_key`, `agreement_public_key`, `cert_sha256` (test qui recherche ces champs dans la réponse).

### T076 — Transitions

`suspend`, `reactivate`, `revoke` : `Idempotency-Key`, `reason` requis ; `set_device_status` ; transition interdite → `409 CONFLICT_STATE` ; révocation : familles révoquées dans la même transaction (fait par la fonction).

### T077 — Portée et audit

`OPERATOR_ADMIN` : tout le prestataire ; `ORGANIZER_ADMIN` : terminaux affectés à ses événements, sinon `404` ; ligne d'audit par transition (acteur, rôle, motif, avant, après).

### T078 — Tests d'intégration

Chaque route et chaque refus ; suspendu : `POST /taps` et `/media/auth-keys` → `403 DEVICE_SUSPENDED` (le cas « configuration et battement de cœur permis » est testé par WP17) ; révoqué : `403 DEVICE_REVOKED` dès la requête suivante avec un jeton encore valide (NFR-003) ; révocation **pendant** une requête en cours (requête retenue par un verrou ou un point d'arrêt de test) : aucune écriture acceptée après la révocation (R-14) ; `REVOKED` → `reactivate` refusé ; isolation à deux prestataires et entre deux organisateurs.

## Test Strategy

Tests demandés par la spec (pgTAP par contrainte et par refus, intégration HTTPS sur vraie base, isolation à deux prestataires, preuves de sécurité). Ordre de vérification : `npm run lint`, `npm run typecheck`, `npm run reset-db -w @cashless/ledger-sql`, `npm run test:pgtap -w @cashless/ledger-sql`, puis `npm run reset-db -w @cashless/ledger-sql && npm test -w @cashless/api -- --runInBand`. Ne jamais lancer pgTAP sur une base où Jest vient de tourner (rejouer `reset-db` entre les deux). Dans un worktree de lane, créer d'abord les liens `node_modules/@cashless/{api,contracts,ledger-sql,tag-format}` (worktrees sans `node_modules`). La base locale est en Docker : son horloge peut reculer ; aucun test ne compare l'heure de Node à `now()` de la base sans marge.

## Definition of Done

Tests d'intégration verts ; suite complète de l'API verte. Chaque sous-tâche est marquée par `spec-kitty agent tasks mark-status Txxx --status done --mission identite-enrolement-terminaux-01M52R6H`. Le compte rendu du lot liste : écarts au plan (avec leur sens : renforcement ou non), retouches hors carte (avec une ligne de justification), points soumis au porteur, fichiers à faire relire par une personne (clés, droits de la base, cryptographie).

## Risks / Reviewer guidance

Le relecteur vérifie l'effet immédiat (aucun cache de statut) et qu'aucune réponse n'expose une clé ou une empreinte.
