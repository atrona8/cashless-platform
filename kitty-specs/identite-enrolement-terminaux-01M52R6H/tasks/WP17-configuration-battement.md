---
work_package_id: WP17
title: 'Routes : configuration servie et battement de cœur'
dependencies:
- WP12
- WP14
requirement_refs:
- FR-018
- FR-019
- NFR-009
planning_base_branch: feat/identite-enrolement-terminaux
merge_target_branch: feat/identite-enrolement-terminaux
branch_strategy: Planning artifacts for this mission were generated on feat/identite-enrolement-terminaux. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/identite-enrolement-terminaux unless the human explicitly redirects the landing branch.
subtasks:
- T079
- T080
- T081
- T082
phase: Phase 3 - Routes
history:
- timestamp: '2026-10-19T13:30:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: node-norris
authoritative_surface: apps/api/src/devices/config/
create_intent:
- apps/api/test/integration/devices/config.spec.ts
- apps/api/test/integration/devices/heartbeat.spec.ts
execution_mode: code_change
owned_files:
- apps/api/src/devices/config/**
- apps/api/src/devices/heartbeat/**
- apps/api/test/integration/devices/config.spec.ts
- apps/api/test/integration/devices/heartbeat.spec.ts
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP17 – Routes : configuration servie et battement de cœur

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load node-norris`. Lis ensuite `README.md` (kit), `docs/SPECIFICATION.md` (sections citées ci-dessous), puis `kitty-specs/identite-enrolement-terminaux-01M52R6H/spec.md`, `plan.md`, `research.md`, `data-model.md` et les contrats cités. En cas de contradiction entre sources, applique la règle de priorité de SPECIFICATION §0.3 et **signale-la** ; ne modifie jamais un fichier `.sql` généré de `packages/ledger-sql/` (passe par les générateurs `gen_tests.py`, `gen_golden.py`).

## Objective

Servir `getDeviceConfig` (schéma `DeviceConfig` du contrat, `config_id`, ETag) et `postDeviceHeartbeat` (dernière présence, sans numéro de séquence), permis aussi à un terminal suspendu.

## Context

Exigences : FR-018, FR-019, NFR-009 ; `contracts/device-lifecycle.md` ; `research.md` R-10 (contenu minimal des parties des missions suivantes), R-14 (`allowSuspended`) ; schéma `DeviceConfig` et `terminal_settings` du contrat ; réglages de l'événement et `effective_offline_policy(terminal)` (mission 3, schéma) ; `record_device_heartbeat` (WP03). Enregistre les modules par une ligne chacun dans `devices/devices.module.ts`.

**Règle de sécurité du projet (`CLAUDE.md`, C-011, C-012)** : si un point de ce lot ne peut être tenu qu'en affaiblissant la sécurité (droit plus large, contrôle retiré ou reporté, secret plus exposé, faux gardé plus longtemps), **arrête-toi sur ce point et soumets-le au porteur avant de coder**, avec le risque et les options ; continue le reste. Un renforcement se fait, puis se consigne dans le compte rendu du lot.

## Branch Strategy

Planification et merge sur `feat/identite-enrolement-terminaux`. Dépendances : WP12, WP14. L'espace de travail (worktree) est attribué par lane calculée dans `lanes.json`. Commande : `spec-kitty agent action implement WP17 --agent claude --mission identite-enrolement-terminaux-01M52R6H`.

## Subtasks

### T079 — Construction

Affectation, mode, `terminal_settings` de l'événement, `offline_policy` = `effective_offline_policy` (téléphone personnel : `offline_enabled = false`), `seq.next_seq_floor`, `server_time`, `clock_tolerance_seconds` ; `snapshot_keys = []`, `debit_authority = CENTRAL` d'époque 0, catalogue vide ou absent selon ce que le schéma permet (R-10 : jamais de valeur inventée). `config_id` = empreinte SHA-256 du contenu canonique (JCS) hors `server_time`.

### T080 — Route et ETag

`GET /v1/device/config` avec `@DeviceAuth({ allowSuspended: true })` ; `ETag` = `config_id` ; `If-None-Match` égal → `304`.

### T081 — Battement de cœur

`POST /v1/device/heartbeat` avec `@DeviceAuth({ allowSuspended: true })` ; `record_device_heartbeat` ; réponse `server_time`, `config_etag`, `debit_authority`, `snapshot_version` NULL ; aucun numéro de séquence consommé.

### T082 — Tests d'intégration

Configuration conforme au schéma (validation par les types générés) ; `304` ; changement d'un réglage de l'événement → nouvel ETag ; téléphone personnel sans hors ligne ; battement de cœur → `last_seen_at` ; terminal suspendu par `set_device_status` (WP03) : configuration et battement de cœur permis ; révoqué refusé ; p95 ≤ 200 ms sur 200 appels (NFR-009, mesure indicative en local).

## Test Strategy

Tests demandés par la spec (pgTAP par contrainte et par refus, intégration HTTPS sur vraie base, isolation à deux prestataires, preuves de sécurité). Ordre de vérification : `npm run lint`, `npm run typecheck`, `npm run reset-db -w @cashless/ledger-sql`, `npm run test:pgtap -w @cashless/ledger-sql`, puis `npm run reset-db -w @cashless/ledger-sql && npm test -w @cashless/api -- --runInBand`. Ne jamais lancer pgTAP sur une base où Jest vient de tourner (rejouer `reset-db` entre les deux). Dans un worktree de lane, créer d'abord les liens `node_modules/@cashless/{api,contracts,ledger-sql,tag-format}` (worktrees sans `node_modules`). La base locale est en Docker : son horloge peut reculer ; aucun test ne compare l'heure de Node à `now()` de la base sans marge.

## Definition of Done

Tests d'intégration verts ; suite complète de l'API verte. Chaque sous-tâche est marquée par `spec-kitty agent tasks mark-status Txxx --status done --mission identite-enrolement-terminaux-01M52R6H`. Le compte rendu du lot liste : écarts au plan (avec leur sens : renforcement ou non), retouches hors carte (avec une ligne de justification), points soumis au porteur, fichiers à faire relire par une personne (clés, droits de la base, cryptographie).
## Reports des relectures (20/10/2026)

- Relecture WP07 : toute fonction de la base qu'appelle ta route s'accorde à son rôle dans la section 4a de
  `post-roles.sql`, et les listes figées de `tests_execute_grants.sql` se mettent à jour dans le même commit (sinon
  42501 ou test rouge). Une migration s'exécute désormais dans la transaction de `migrate.ts` : pas de
  `CREATE INDEX CONCURRENTLY`, pas d'`ALTER TYPE … ADD VALUE` utilisée dans la même série.


## Risks / Reviewer guidance

Le relecteur vérifie qu'aucun contenu des missions suivantes n'est inventé et que l'ETag ne change pas d'un appel à l'autre sans changement réel.
