---
work_package_id: WP01
title: "Contrat d'API et types : trois preuves, enrôlement, back-office des terminaux"
dependencies: []
requirement_refs:
- C-003
- C-008
- FR-026
planning_base_branch: feat/identite-enrolement-terminaux
merge_target_branch: feat/identite-enrolement-terminaux
branch_strategy: Planning artifacts for this mission were generated on feat/identite-enrolement-terminaux. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/identite-enrolement-terminaux unless the human explicitly redirects the landing branch.
subtasks:
- T001
- T002
- T003
- T004
- T005
phase: Phase 1 - Contrat et base
history:
- timestamp: '2026-10-19T13:30:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: node-norris
authoritative_surface: packages/contracts/
create_intent: []
execution_mode: code_change
owned_files:
- packages/contracts/openapi.yaml
- packages/contracts/generated/**
- packages/contracts/dart/**
- apps/api/src/http/messages.fr.json
- apps/api/src/http/messages.en.json
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP01 – Contrat d'API et types : trois preuves, enrôlement, back-office des terminaux

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load node-norris`. Lis ensuite `README.md` (kit), `docs/SPECIFICATION.md` (sections citées ci-dessous), puis `kitty-specs/identite-enrolement-terminaux-01M52R6H/spec.md`, `plan.md`, `research.md`, `data-model.md` et les contrats cités. En cas de contradiction entre sources, applique la règle de priorité de SPECIFICATION §0.3 et **signale-la** ; ne modifie jamais un fichier `.sql` généré de `packages/ledger-sql/` (passe par les générateurs `gen_tests.py`, `gen_golden.py`).

## Objective

Décrire au contrat (`packages/contracts/openapi.yaml`) tout ce que la mission sert, avant que le code ne le serve (C-008) : trois preuves exigées ensemble sur les routes de terminal, schémas d'enrôlement et de jeton durcis, six routes back-office des terminaux, codes d'erreur nouveaux ; régénérer les types TypeScript et Dart.

## Context

Exigences : FR-026, C-003, C-008 ; contrats `contracts/openapi-additions.md`, `contracts/device-authentication.md`, `contracts/enrollment.md`, `contracts/device-tokens.md`, `contracts/device-lifecycle.md` ; `research.md` R-02, R-04, R-07, R-08, R-16, R-17 ; ADR-107 (contradiction avec SPEC §10.3 : le contrat est mis à jour dans le sens le plus sûr). Modèle de style : les routes back-office ajoutées par la mission 4 (`/operators/{operator_id}/media-batches…`) et leurs schémas. Les codes de problème et les statuts sont générés depuis le contrat (`packages/contracts/generated/problem-codes.ts`, `problem-statuses.ts`).

**Règle de sécurité du projet (`CLAUDE.md`, C-011, C-012)** : si un point de ce lot ne peut être tenu qu'en affaiblissant la sécurité (droit plus large, contrôle retiré ou reporté, secret plus exposé, faux gardé plus longtemps), **arrête-toi sur ce point et soumets-le au porteur avant de coder**, avec le risque et les options ; continue le reste. Un renforcement se fait, puis se consigne dans le compte rendu du lot.

## Branch Strategy

Planification et merge sur `feat/identite-enrolement-terminaux`. Dépendances : aucune. L'espace de travail (worktree) est attribué par lane calculée dans `lanes.json`. Commande : `spec-kitty agent action implement WP01 --agent claude --mission identite-enrolement-terminaux-01M52R6H`.

## Subtasks

### T001 — Schéma `deviceSignature`, trois preuves sur les routes de terminal

- Ajoute sous `components.securitySchemes` un schéma `deviceSignature` (type `apiKey`, `in: header`, `name: Signature`) dont la description résume le profil de `research.md` R-04 : RFC 9421 restreint, `ecdsa-p256-sha256`, `keyid` = `device_id`, composants `@method`, `@authority`, `@path`, `@query`, `content-digest` (sha-256 seul), `x-request-id`, `idempotency-key` (routes d'écriture), paramètres `created`, `nonce`, `keyid`, `alg`, libellé `dev`.
- Toute opération de terminal (celles qui portent aujourd'hui `deviceMtls` et/ou `deviceToken` : `getDeviceConfig`, `postDeviceHeartbeat`, `getDeviceSeqStatus`, `/media/auth-keys`, `/taps`, opérations de guichet de la mission 4, etc.) reçoit **une seule entrée** : `security: [{ deviceMtls: [], deviceToken: [], deviceSignature: [] }]`. Deux entrées séparées voudraient dire « ou » : refuse ce motif. Recense les opérations par un script (`grep -n "deviceToken\|deviceMtls"`) et liste-les dans le compte rendu.
- `refreshDeviceToken` : `security: [{ deviceMtls: [] }]` (renforcement : la preuve de possession reste dans le corps).
- `enrollDevice` et les routes des personnes : inchangées.
- `info.description` : remplace « Un terminal utilise l'un OU l'autre ; en production, mTLS + jeton lié est RECOMMANDÉ » par l'exigence des trois preuves (citer ADR-107).
- En-têtes ajoutés aux routes de terminal (paramètres réutilisables `components.parameters`) : `Signature-Input`, `Signature`, `Content-Digest` (requis) ; `X-Request-Id` devient requis sur ces routes.

### T002 — Schémas d'enrôlement, de jeton et de code modifiés

- `DeviceEnrollmentRequest` : `csr_pem` requis ; ajoute `agreement_attestation_chain` (tableau base64, requis quand `os = ANDROID` : décris-le dans la description et par `if/then` JSON Schema si la version d'OpenAPI du fichier le permet) ; décris les défis de R-08 (Android : un par clé ; iOS : `clientDataHash`) et l'ordre (code scanné avant la génération des clés) ; Android 12 minimum.
- `DeviceEnrollmentResponse` : `certificate_pem` requis, `type: string` (plus `null`).
- Schéma de création de code (`createDeviceEnrollmentCode`, nom existant à garder) : ajoute `personal_phone` (boolean, **requis, sans défaut**, R-17) ; bornes de `expires_in_seconds` 300 à 604 800.
- `deviceToken` (description) : claims `sub`, `operator_id`, `serial`, `event_id`, `cnf.jkt`, `fid`, `typ = device+jwt`, `aud = cashless-device` ; rappelle que `operator_id` et `event_id` ne sont jamais crus.
- `refreshDeviceToken` : réponse `409` (échange en cours), grâce de 60 s pour le même terminal décrite (OP-N65, ADR-108), preuve de possession `"cashless-refresh-v1" ‖ 0x00 ‖ nonce ‖ 0x00 ‖ serial ‖ 0x00 ‖ refresh_token`.
- `enrollDevice` : réponse `429` (10 essais par code et par heure, 30 par adresse et par heure), `409 DEVICE_SERIAL_IN_USE`.

### T003 — Routes back-office des terminaux

Ajoute, tag « Terminaux », avec les conventions des routes back-office existantes (préfixe et portée par prestataire, pagination par curseur, `Idempotency-Key` sur les écritures, problem+json, `404` neutre pour l'objet d'un autre prestataire) : `listDevices` (`GET /devices`, filtres `event_id`, `pos_id`, `status`, `app_mode`), `getDevice` (`GET /devices/{device_id}`), `suspendDevice`, `reactivateDevice`, `revokeDevice` (`POST /devices/{device_id}/suspend|reactivate|revoke`, corps `DeviceStatusChangeRequest` avec `reason` requis), `listDeviceEnrollmentCodes` (`GET /device-enrollment-codes`). Schémas `Device` (sans aucune clé ni empreinte : statut, affectation, `os`, `app_mode`, `personal_phone`, version, niveau d'attestation, `last_seen_at`, `cert_not_after`), `DeviceStatusHistoryEntry`, `DevicePage`, `DeviceEnrollmentCodeSummary` (sans le code). Rôles : `OPERATOR_ADMIN`, `ORGANIZER_ADMIN`. Vérifie d'abord si un chemin `/devices/{device_id}/…` existe déjà (`seq-gaps`, `journal-imports`) et aligne le style.

### T004 — Codes d'erreur et messages

- Ajoute à l'énumération des codes du contrat : `DEVICE_SIGNATURE_INVALID` (401), `DEVICE_SERIAL_IN_USE` (409) ; vérifie que `CLOCK_SKEW_TOO_LARGE` (400), `ENROLLMENT_CODE_INVALID`, `ENROLLMENT_CODE_EXPIRED`, `ATTESTATION_FAILED`, `DEVICE_MODE_NOT_ALLOWED`, `DEVICE_SUSPENDED`, `DEVICE_REVOKED` existent avec le bon statut.
- Ajoute les messages correspondants dans `apps/api/src/http/messages.fr.json` et `messages.en.json` (même ton que les messages existants ; aucun message ne dit quelle preuve a échoué).

### T005 — Génération des types et contrôle

- `npm run generate` (racine) ; vérifie le diff de `packages/contracts/generated/` et des types Dart ; jamais d'édition à la main.
- Valide le fichier avec l'outil de validation déjà utilisé par le projet (voir `packages/contracts/package.json`).
- `npm run typecheck` doit rester vert : un code de problème renommé casserait l'API ; aucun ne doit l'être.

## Test Strategy

Tests demandés par la spec (pgTAP par contrainte et par refus, intégration HTTPS sur vraie base, isolation à deux prestataires, preuves de sécurité). Ordre de vérification : `npm run lint`, `npm run typecheck`, `npm run reset-db -w @cashless/ledger-sql`, `npm run test:pgtap -w @cashless/ledger-sql`, puis `npm run reset-db -w @cashless/ledger-sql && npm test -w @cashless/api -- --runInBand`. Ne jamais lancer pgTAP sur une base où Jest vient de tourner (rejouer `reset-db` entre les deux). Dans un worktree de lane, créer d'abord les liens `node_modules/@cashless/{api,contracts,ledger-sql,tag-format}` (worktrees sans `node_modules`). La base locale est en Docker : son horloge peut reculer ; aucun test ne compare l'heure de Node à `now()` de la base sans marge.

## Definition of Done

`npm run generate` sans écart après coup ; validation du contrat verte ; `npm run typecheck` et `npm run lint` verts. Chaque sous-tâche est marquée par `spec-kitty agent tasks mark-status Txxx --status done --mission identite-enrolement-terminaux-01M52R6H`. Le compte rendu du lot liste : écarts au plan (avec leur sens : renforcement ou non), retouches hors carte (avec une ligne de justification), points soumis au porteur, fichiers à faire relire par une personne (clés, droits de la base, cryptographie).

## Risks / Reviewer guidance

Le relecteur vérifie qu'aucune route de terminal n'a deux entrées `security`, que `enrollDevice` reste sans sécurité, que `Device` n'expose ni `public_key`, ni `agreement_public_key`, ni `cert_sha256`, et que la contradiction avec SPEC §10.3 est citée (ADR-107).
