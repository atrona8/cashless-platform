---
work_package_id: WP13
title: "OP-N54 : empreinte de requête à clé ; empreinte du code d'enrôlement"
dependencies:
- WP08
requirement_refs:
- FR-001
- FR-023
- NFR-005
planning_base_branch: feat/identite-enrolement-terminaux
merge_target_branch: feat/identite-enrolement-terminaux
branch_strategy: Planning artifacts for this mission were generated on feat/identite-enrolement-terminaux. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/identite-enrolement-terminaux unless the human explicitly redirects the landing branch.
subtasks:
- T063
- T064
- T065
phase: Phase 2 - Socle applicatif
history:
- timestamp: '2026-10-19T13:30:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: node-norris
authoritative_surface: apps/api/src/idempotency/request-hash.ts
create_intent:
- apps/api/src/enrollment-code/enrollment-code.ts
- apps/api/test/unit/idempotency/request-hash.spec.ts
- apps/api/test/unit/enrollment-code.spec.ts
execution_mode: code_change
owned_files:
- apps/api/src/idempotency/request-hash.ts
- apps/api/src/enrollment-code/enrollment-code.ts
- apps/api/test/unit/idempotency/request-hash.spec.ts
- apps/api/test/unit/enrollment-code.spec.ts
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP13 – OP-N54 : empreinte de requête à clé ; empreinte du code d'enrôlement

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load node-norris`. Lis ensuite `README.md` (kit), `docs/SPECIFICATION.md` (sections citées ci-dessous), puis `kitty-specs/identite-enrolement-terminaux-01M52R6H/spec.md`, `plan.md`, `research.md`, `data-model.md` et les contrats cités. En cas de contradiction entre sources, applique la règle de priorité de SPECIFICATION §0.3 et **signale-la** ; ne modifie jamais un fichier `.sql` généré de `packages/ledger-sql/` (passe par les générateurs `gen_tests.py`, `gen_golden.py`).

## Objective

Lever OP-N54 (ADR-99) : l'empreinte enregistrée au registre d'idempotence ne se recalcule plus à partir de la requête seule ; fournir la génération, la normalisation et l'empreinte à clé des codes d'enrôlement.

## Context

Exigences : FR-001, FR-023, NFR-005 ; `research.md` R-13 ; `contracts/enrollment.md` (format du code) ; OP-N54, ADR-99. `idempotency/request-hash.ts` (SHA-256 de `METHOD\nroute\nJCS(corps)`) ; réglages `idempotencyHmacKey`, `enrollmentCodeHmacKey` (WP08). Modèle : le code de rattachement de `@cashless/tag-format` (alphabet de 32 sans ambiguïté, normalisation) — réutilise l'alphabet s'il est exporté plutôt que d'en recopier un.

**Règle de sécurité du projet (`CLAUDE.md`, C-011, C-012)** : si un point de ce lot ne peut être tenu qu'en affaiblissant la sécurité (droit plus large, contrôle retiré ou reporté, secret plus exposé, faux gardé plus longtemps), **arrête-toi sur ce point et soumets-le au porteur avant de coder**, avec le risque et les options ; continue le reste. Un renforcement se fait, puis se consigne dans le compte rendu du lot.

## Branch Strategy

Planification et merge sur `feat/identite-enrolement-terminaux`. Dépendances : WP08. L'espace de travail (worktree) est attribué par lane calculée dans `lanes.json`. Commande : `spec-kitty agent action implement WP13 --agent claude --mission identite-enrolement-terminaux-01M52R6H`.

## Subtasks

### T063 — Empreinte à clé

`requestHash(method, route, body, key)` → `HMAC-SHA256(key, METHOD ‖ '\n' ‖ route ‖ '\n' ‖ JCS(corps))` en hexadécimal sur 64 caractères, sans préfixe (contrainte de 0002 ; décision du porteur du 20/10/2026) ; l'intercepteur passe `config.idempotencyHmacKey` (retouche d'une ligne dans `idempotency.interceptor.ts`, hors carte, à consigner). `request_hash` de `journal_transaction` (schéma de référence) n'est pas concerné.

### T064 — Code d'enrôlement

`enrollment-code/enrollment-code.ts` : `generateEnrollmentCode()` (60 bits, 12 caractères de l'alphabet de 32, `crypto.randomInt`), `formatEnrollmentCode` (`XXXX-XXXX-XXXX`), `normalizeEnrollmentCode` (tirets, espaces, casse ; caractère interdit → refus), `enrollmentCodeHash(code, key)` (HMAC-SHA256 du code normalisé).

### T065 — Tests

Empreinte non recalculable sans la clé ; deux clés → deux empreintes ; même requête → même empreinte ; corps réordonné → même empreinte (JCS). Code : longueur, alphabet, normalisation, refus d'un caractère interdit, empreinte stable.

## Test Strategy

Tests demandés par la spec (pgTAP par contrainte et par refus, intégration HTTPS sur vraie base, isolation à deux prestataires, preuves de sécurité). Ordre de vérification : `npm run lint`, `npm run typecheck`, `npm run reset-db -w @cashless/ledger-sql`, `npm run test:pgtap -w @cashless/ledger-sql`, puis `npm run reset-db -w @cashless/ledger-sql && npm test -w @cashless/api -- --runInBand`. Ne jamais lancer pgTAP sur une base où Jest vient de tourner (rejouer `reset-db` entre les deux). Dans un worktree de lane, créer d'abord les liens `node_modules/@cashless/{api,contracts,ledger-sql,tag-format}` (worktrees sans `node_modules`). La base locale est en Docker : son horloge peut reculer ; aucun test ne compare l'heure de Node à `now()` de la base sans marge.

## Definition of Done

Tests unitaires verts et suite d'idempotence existante verte (`test/unit/idempotency-guard.spec.ts`, intégrations `transverse`). Chaque sous-tâche est marquée par `spec-kitty agent tasks mark-status Txxx --status done --mission identite-enrolement-terminaux-01M52R6H`. Le compte rendu du lot liste : écarts au plan (avec leur sens : renforcement ou non), retouches hors carte (avec une ligne de justification), points soumis au porteur, fichiers à faire relire par une personne (clés, droits de la base, cryptographie).

## Risks / Reviewer guidance

Le relecteur vérifie qu'aucune empreinte sans clé ne reste au registre et que la clé n'est jamais journalisée.

## Compte rendu du lot WP13

Écarts au plan
- Format de l'empreinte : hexadécimal 64 sans préfixe `h1:` (contrainte de 0002, §0.3) ; décision du porteur du
  20/10/2026, documents corrigés (research.md R-13, contracts/database-debts.md, ce prompt).
- Renforcement : `requestHash` et `enrollmentCodeHash` refusent une clé de moins de 32 octets ; `normalizeEnrollmentCode`
  refuse une saisie de plus de 64 caractères avant tout traitement ; aucun message ne reprend la clé ni la saisie.

Retouches hors carte : `idempotency.interceptor.ts` (une ligne, prévue) ; `test/integration/transverse/idempotency.spec.ts`
(nouvelle signature).

Point pour la mise en production : les lignes `api_idempotency` écrites avant le déploiement gardent une empreinte sans
clé ; à purger avant la mise en production (reporté dans WP18).

Fichiers à faire relire par une personne : `apps/api/src/idempotency/request-hash.ts`,
`apps/api/src/enrollment-code/enrollment-code.ts`.
