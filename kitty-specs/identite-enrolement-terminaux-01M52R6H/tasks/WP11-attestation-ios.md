---
work_package_id: WP11
title: Attestation iOS (App Attest) et limite consignée
dependencies:
- WP10
requirement_refs:
- FR-006
planning_base_branch: feat/identite-enrolement-terminaux
merge_target_branch: feat/identite-enrolement-terminaux
branch_strategy: Planning artifacts for this mission were generated on feat/identite-enrolement-terminaux. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/identite-enrolement-terminaux unless the human explicitly redirects the landing branch.
subtasks:
- T052
- T053
- T054
- T055
phase: Phase 2 - Socle applicatif
history:
- timestamp: '2026-10-19T13:30:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: node-norris
authoritative_surface: apps/api/src/attestation/ios-app-attest.ts
create_intent:
- apps/api/src/attestation/ios-app-attest.ts
- apps/api/test/support/attestation/ios.ts
- apps/api/test/unit/attestation/ios.spec.ts
execution_mode: code_change
owned_files:
- apps/api/src/attestation/ios-app-attest.ts
- apps/api/test/support/attestation/ios.ts
- apps/api/test/unit/attestation/ios.spec.ts
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP11 – Attestation iOS (App Attest) et limite consignée

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load node-norris`. Lis ensuite `README.md` (kit), `docs/SPECIFICATION.md` (sections citées ci-dessous), puis `kitty-specs/identite-enrolement-terminaux-01M52R6H/spec.md`, `plan.md`, `research.md`, `data-model.md` et les contrats cités. En cas de contradiction entre sources, applique la règle de priorité de SPECIFICATION §0.3 et **signale-la** ; ne modifie jamais un fichier `.sql` généré de `packages/ledger-sql/` (passe par les générateurs `gen_tests.py`, `gen_golden.py`).

## Objective

Vérifier l'objet App Attest d'un iPhone à l'enrôlement selon la procédure d'Apple, en liant les clés publiques du terminal à l'instance attestée (limite acceptée : la clé de signature iOS n'est pas attestée, OP-N64, ADR-106).

## Context

Exigences : FR-006 ; décision du porteur `DM-01M59SD0YNWKK8R4EKT2T7THJK` ; `research.md` R-06, R-08 ; ADR-106, OP-N64. `cbor2` (WP08) pour décoder l'objet d'attestation ; port et défis de WP10 (`attestation.port.ts`, `enrollment-challenge.ts`) ; le module d'attestation (`attestation.module.ts`, WP10) doit router `os = IOS` vers cette classe : la retouche d'une ligne dans ce module est une retouche hors carte autorisée, à consigner.

**Règle de sécurité du projet (`CLAUDE.md`, C-011, C-012)** : si un point de ce lot ne peut être tenu qu'en affaiblissant la sécurité (droit plus large, contrôle retiré ou reporté, secret plus exposé, faux gardé plus longtemps), **arrête-toi sur ce point et soumets-le au porteur avant de coder**, avec le risque et les options ; continue le reste. Un renforcement se fait, puis se consigne dans le compte rendu du lot.

## Branch Strategy

Planification et merge sur `feat/identite-enrolement-terminaux`. Dépendances : WP10. L'espace de travail (worktree) est attribué par lane calculée dans `lanes.json`. Commande : `spec-kitty agent action implement WP11 --agent claude --mission identite-enrolement-terminaux-01M52R6H`.

## Subtasks

### T052 — Vérification App Attest

Selon la procédure d'Apple : CBOR → `fmt = apple-appattest`, `attStmt.x5c`, `authData` ; chaîne `x5c` jusqu'à `iosAppAttestRoot` (même chaînage explicite que WP10) ; `nonce = SHA-256(authData ‖ clientDataHash)` égal à l'extension `1.2.840.113635.100.8.2` de la feuille ; `clientDataHash = iosClientDataHash(code, serial, signingSpki, agreementSpki)` ; `rpIdHash = SHA-256(teamId + '.' + bundleId)` ; compteur = 0 ; `aaguid` = `appattest` (production) ou `appattestdevelop` (seulement si le réglage le permet hors production) ; `credentialId` = SHA-256 de la clé publique attestée (feuille). Rend `{ kind: 'IOS_APP_ATTEST', securityLevel: null }`.

### T053 — Objets de test

`test/support/attestation/ios.ts` : racine de test, feuille avec l'extension de nonce, `authData` construit (rpIdHash, flags, compteur, aaguid, credentialId), encodage CBOR ; paramétrable pour chaque cas de refus.

### T054 — Garde et réglages

`appattestdevelop` refusé en production (le réglage `iosAppAttestEnvironment` est déjà contrôlé par WP08 : vérifie l'effet au niveau du vérificateur). Commentaire d'en-tête du fichier : limite OP-N64 (ce qui est prouvé, ce qui ne l'est pas), ADR-106.

### T055 — Tests unitaires

Cas nominal ; un refus par contrôle (format, chaîne, racine inconnue, nonce faux, clientDataHash d'autres clés, rpIdHash d'une autre app, compteur ≠ 0, aaguid de développement en production, credentialId faux).

## Test Strategy

Tests demandés par la spec (pgTAP par contrainte et par refus, intégration HTTPS sur vraie base, isolation à deux prestataires, preuves de sécurité). Ordre de vérification : `npm run lint`, `npm run typecheck`, `npm run reset-db -w @cashless/ledger-sql`, `npm run test:pgtap -w @cashless/ledger-sql`, puis `npm run reset-db -w @cashless/ledger-sql && npm test -w @cashless/api -- --runInBand`. Ne jamais lancer pgTAP sur une base où Jest vient de tourner (rejouer `reset-db` entre les deux). Dans un worktree de lane, créer d'abord les liens `node_modules/@cashless/{api,contracts,ledger-sql,tag-format}` (worktrees sans `node_modules`). La base locale est en Docker : son horloge peut reculer ; aucun test ne compare l'heure de Node à `now()` de la base sans marge.

## Definition of Done

Tests unitaires verts ; `npm run typecheck` et `npm run lint` verts. Chaque sous-tâche est marquée par `spec-kitty agent tasks mark-status Txxx --status done --mission identite-enrolement-terminaux-01M52R6H`. Le compte rendu du lot liste : écarts au plan (avec leur sens : renforcement ou non), retouches hors carte (avec une ligne de justification), points soumis au porteur, fichiers à faire relire par une personne (clés, droits de la base, cryptographie).

## Risks / Reviewer guidance

Fichier à faire relire par une personne : `ios-app-attest.ts`. Le relecteur vérifie que le défi couvre bien les deux clés publiques (seule protection contre la substitution de clés, R-06).
