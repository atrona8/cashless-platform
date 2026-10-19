---
work_package_id: WP14
title: "Routes : codes d'enrôlement et enrôlement"
dependencies:
- WP01
- WP03
- WP07
- WP09
- WP10
- WP11
- WP12
- WP13
requirement_refs:
- FR-001
- FR-002
- FR-003
- FR-004
- FR-005
- FR-006
- FR-007
- FR-009
- FR-025
- NFR-005
- NFR-006
- NFR-008
planning_base_branch: feat/identite-enrolement-terminaux
merge_target_branch: feat/identite-enrolement-terminaux
branch_strategy: Planning artifacts for this mission were generated on feat/identite-enrolement-terminaux. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/identite-enrolement-terminaux unless the human explicitly redirects the landing branch.
subtasks:
- T066
- T067
- T068
- T069
- T070
phase: Phase 3 - Routes
history:
- timestamp: '2026-10-19T13:30:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: node-norris
authoritative_surface: apps/api/src/devices/enrollment/
create_intent:
- apps/api/test/integration/devices/enrollment-codes.spec.ts
- apps/api/test/integration/devices/enrollment.spec.ts
execution_mode: code_change
owned_files:
- apps/api/src/devices/enrollment-codes/**
- apps/api/src/devices/enrollment/**
- apps/api/test/integration/devices/enrollment-codes.spec.ts
- apps/api/test/integration/devices/enrollment.spec.ts
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP14 – Routes : codes d'enrôlement et enrôlement

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load node-norris`. Lis ensuite `README.md` (kit), `docs/SPECIFICATION.md` (sections citées ci-dessous), puis `kitty-specs/identite-enrolement-terminaux-01M52R6H/spec.md`, `plan.md`, `research.md`, `data-model.md` et les contrats cités. En cas de contradiction entre sources, applique la règle de priorité de SPECIFICATION §0.3 et **signale-la** ; ne modifie jamais un fichier `.sql` généré de `packages/ledger-sql/` (passe par les générateurs `gen_tests.py`, `gen_golden.py`).

## Objective

Servir `createDeviceEnrollmentCode`, `listDeviceEnrollmentCodes` et `enrollDevice` selon `contracts/enrollment.md` : code affiché une seule fois et jamais conservé, enrôlement atomique qui ne consomme le code qu'en cas de succès, attestation des deux plateformes, certificat et jetons, limites de débit.

## Context

Exigences : FR-001 à FR-009, FR-025, NFR-005, NFR-006, NFR-008 ; `contracts/enrollment.md` (ordre des étapes 1 à 10) ; `research.md` R-08, R-09, R-16, R-17 ; fonctions de base `create_device_enrollment_code`, `enroll_device`, `record_enrollment_attempt`, `enrollment_attempts_exceeded` (WP03) ; ports `DeviceCaPort`, `DeviceTokenService` (WP09), `AttestationVerifier` (WP10, WP11), `enrollment-code.ts` (WP13), terminal de test (WP12). Idempotence : option `transient` du décorateur `@Idempotent` (mission 1) pour la création de code. Les `CL` nouveaux de WP03, WP04 et WP06 sont traduits par `errors/sqlstate-map.ts` (WP12). Enregistre les modules par **une ligne** dans `devices/devices.module.ts` (retouche hors carte autorisée).

**Règle de sécurité du projet (`CLAUDE.md`, C-011, C-012)** : si un point de ce lot ne peut être tenu qu'en affaiblissant la sécurité (droit plus large, contrôle retiré ou reporté, secret plus exposé, faux gardé plus longtemps), **arrête-toi sur ce point et soumets-le au porteur avant de coder**, avec le risque et les options ; continue le reste. Un renforcement se fait, puis se consigne dans le compte rendu du lot.

## Branch Strategy

Planification et merge sur `feat/identite-enrolement-terminaux`. Dépendances : WP01, WP03, WP07, WP09, WP10, WP11, WP12, WP13. L'espace de travail (worktree) est attribué par lane calculée dans `lanes.json`. Commande : `spec-kitty agent action implement WP14 --agent claude --mission identite-enrolement-terminaux-01M52R6H`.

## Subtasks

### T066 — Création d'un code

`POST /v1/device-enrollment-codes` : `event_id` obligatoire (validé avant la base) ; rôles `OPERATOR_ADMIN` (prestataire) ou `ORGANIZER_ADMIN` (ses événements ; sinon `404`) ; `@Idempotent({ transient: true })` ; génère le code (WP13), appelle `create_device_enrollment_code` avec l'empreinte ; répond le code formaté et `expires_at` ; audit `DEVICE_ENROLLMENT_CODE_CREATED` sans le code. Vérifie qu'un rejeu de la même clé ne rend jamais le code.

### T067 — Liste des codes

`GET /v1/device-enrollment-codes` : codes non expirés et non utilisés du périmètre, sans le code ni son empreinte ; pagination par curseur.

### T068 — Enrôlement

Étapes 1 à 10 de `contracts/enrollment.md`. Les étapes 1 à 8 ne consomment rien ; l'étape 9 (`enroll_device`) est la seule écriture ; un certificat émis pour un enrôlement qui échoue n'est jamais accepté (son empreinte n'est enregistrée nulle part). Réponse `201` conforme au contrat. Refus traduits : `ENROLLMENT_CODE_INVALID` (même corps et temps comparable pour inconnu et utilisé : fais tout le travail coûteux — vérification d'attestation comprise — avant de répondre, ou égalise), `ENROLLMENT_CODE_EXPIRED`, `ATTESTATION_FAILED`, `DEVICE_MODE_NOT_ALLOWED`, `DEVICE_SERIAL_IN_USE`.

### T069 — Limites et audit des refus

Avant l'étape 3 : `enrollment_attempts_exceeded(code_hash, req.ip)` → `429` ; après chaque essai, `record_enrollment_attempt` et la ligne d'audit `DEVICE_ENROLLED` / `DEVICE_ENROLLMENT_REFUSED` dans une transaction **séparée** (un refus annulé laisse sa trace). `req.ip` est l'adresse de connexion (`TRUST_PROXY_HOPS = 0` en production, WP08).

### T070 — Tests d'intégration (HTTPS)

Nominal Android et iOS ; code inconnu / utilisé / expiré ; attestation refusée → code encore utilisable ; Android 11 (`attestationVersion` < 100) refusé ; clé importée refusée ; 20 enrôlements simultanés sur un code → exactement 1 `201` ; même `serial` dans deux prestataires → deux terminaux, aucune réponse ne révèle l'autre ; même `serial` actif dans le même prestataire → `409` ; code inconnu, utilisé ou expiré avec un `serial` actif du prestataire → toujours le refus du code (`422`), jamais `409` : le contrôle du `serial` ne précède jamais celui du code, sinon un tiers sans code sonde les numéros de série (décision du porteur du 19/10/2026, relecture WP01) ; ré-enrôlement après révocation → `next_seq` attendu ; 11e essai d'un code → `429` ; rejeu de la création de code → jamais le code ; aucun code ni jeton en clair dans la base, l'audit, le registre d'idempotence et les journaux ; écart de temps médian < 20 ms entre code inconnu et utilisé (200 essais chacun, NFR-006) ; isolation à deux prestataires.

## Test Strategy

Tests demandés par la spec (pgTAP par contrainte et par refus, intégration HTTPS sur vraie base, isolation à deux prestataires, preuves de sécurité). Ordre de vérification : `npm run lint`, `npm run typecheck`, `npm run reset-db -w @cashless/ledger-sql`, `npm run test:pgtap -w @cashless/ledger-sql`, puis `npm run reset-db -w @cashless/ledger-sql && npm test -w @cashless/api -- --runInBand`. Ne jamais lancer pgTAP sur une base où Jest vient de tourner (rejouer `reset-db` entre les deux). Dans un worktree de lane, créer d'abord les liens `node_modules/@cashless/{api,contracts,ledger-sql,tag-format}` (worktrees sans `node_modules`). La base locale est en Docker : son horloge peut reculer ; aucun test ne compare l'heure de Node à `now()` de la base sans marge.

## Definition of Done

Tests d'intégration verts ; suite complète de l'API verte. Chaque sous-tâche est marquée par `spec-kitty agent tasks mark-status Txxx --status done --mission identite-enrolement-terminaux-01M52R6H`. Le compte rendu du lot liste : écarts au plan (avec leur sens : renforcement ou non), retouches hors carte (avec une ligne de justification), points soumis au porteur, fichiers à faire relire par une personne (clés, droits de la base, cryptographie).

## Risks / Reviewer guidance

Le relecteur vérifie que le code n'est consommé qu'en cas de succès, que le registre d'idempotence ne garde jamais le code, et que l'ordre des étapes est celui du contrat.
