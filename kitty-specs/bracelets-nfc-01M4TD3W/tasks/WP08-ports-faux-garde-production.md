---
work_package_id: WP08
title: Ports (clés, terminal, festivalier), faux et garde de production
dependencies:
- WP01
requirement_refs:
- FR-006
- FR-034
planning_base_branch: feat/bracelets-nfc
merge_target_branch: feat/bracelets-nfc
branch_strategy: Planning artifacts for this mission were generated on feat/bracelets-nfc. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/bracelets-nfc unless the human explicitly redirects the landing branch.
subtasks:
- T030
- T031
- T032
- T033
- T034
phase: Phase 2 - Socle API
history:
- timestamp: '2026-10-13T12:05:28Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: apps/api/src/kms/
create_intent: []
execution_mode: code_change
owned_files:
- apps/api/src/kms/**
- apps/api/src/device-identity/**
- apps/api/src/customer-identity/**
- apps/api/src/config/config.ts
- apps/api/package.json
- apps/api/test/unit/kms/**
- apps/api/test/unit/production-guard.spec.ts
- apps/api/test/unit/config.spec.ts
- apps/api/test/support/fake-device.ts
- apps/api/test/support/fake-customer.ts
- docs/POINTS_OUVERTS.md
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP08 – Ports (clés, terminal, festivalier), faux et garde de production

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan`. Lis ensuite `README.md` (kit), `docs/SPECIFICATION.md` (sections citées ci-dessous), puis `kitty-specs/bracelets-nfc-01M4TD3W/spec.md`, `plan.md`, `research.md`, `data-model.md` et les contrats cités. En cas de contradiction entre sources, applique la règle de priorité de SPECIFICATION §0.3 et **signale-la** ; ne modifie jamais un fichier `.sql` généré de `packages/ledger-sql/`.

## Objective

Isoler le service de clés, l'identité du terminal et celle du festivalier derrière des ports, fournir les faux de test, et interdire tout faux en production.

## Context

Exigences : FR-006, FR-034, NFR-003, NFR-005, NFR-010, C-004, C-005, C-012, SC-008. Contrats : `contracts/key-services.md`, `contracts/identity-ports.md`. Recherche : R-03, R-06, R-07. Précédent : le faux serveur d'identité de la mission 2 (`test/support/fake-idp.ts`, `config.ts`).

**Règle de sécurité du projet (`CLAUDE.md`, C-011)** : si un point de ce lot ne peut être tenu qu'en affaiblissant la sécurité (droit plus large, contrôle retiré ou reporté, secret plus exposé, faux gardé plus longtemps), **arrête-toi sur ce point et soumets-le au porteur avant de coder** ; continue le reste. Un renforcement se fait, puis se consigne.

## Branch Strategy

Planification et merge sur `feat/bracelets-nfc`. Dépendances : WP01. L'espace de travail (worktree) est attribué par lane calculée dans `lanes.json`. Commande : `spec-kitty agent action implement WP08 --agent claude --mission bracelets-nfc-01M4TD3W`.

## Subtasks

### T030 — Ports de clés et faux KMS

- `src/kms/kms.ports.ts` : `MacPort`, `DataKeyPort`, `DecryptPort`, `KeyAdminPort`, chacun avec son jeton d'injection. Aucun type commun qui les réunit.
- `src/kms/fake-kms.ts` : clés en mémoire par référence ; `generateMac` = HMAC-SHA256 ; clé de dérivation de test `00..1f` et clé de données `10..2f` chargeables pour rejouer les vecteurs du kit ; `generateDataKey` rend un clair de 32 octets et un chiffré opaque ; compteur d'appels par opération ; pannes injectables (`failNext('decrypt')`).
- `src/kms/kms.module.ts` : `KmsModule.forCapabilities(['mac','decrypt'])` n'exporte que les ports demandés. Un port non demandé n'est pas injectable (test).
- `src/kms/zeroize.ts` : `zeroize(buf)` et `withSecret(buf, fn)` qui met à zéro dans un `finally`.

### T031 — Identité du terminal

- `src/device-identity/device-identity.port.ts` : `identify(req)` → `{ deviceId, operatorId, eventId, posId, agreementPublicKey }` ; `device.guard.ts` + décorateur `@Device()` ; le garde vérifie en base que le terminal existe, est `ACTIVE` et appartient au prestataire (`REVOKED` → `DEVICE_REVOKED`), puis pose le contexte de prestataire de la requête (même mécanisme que `IdentityTenantContext`).
- `fake-device-identity.ts` (lit `X-Test-Device-Id`) ; `test/support/fake-device.ts` : crée un terminal en base avec une paire ECDH P-256 et sait ouvrir une enveloppe (`openForRecipient` de WP01).

### T032 — Identité du festivalier et empreinte des codes

- `src/customer-identity/` : port, garde `@Customer()`, faux (`X-Test-Customer-Id`, `X-Test-Customer-Device`) ; `test/support/fake-customer.ts`.
- `src/kms/claim-hash.ts` : `claimCodeHash(code)` et `confirmationHash(claimId, digits)` (HMAC-SHA256 avec `CLAIM_CODE_HMAC_KEY`, préfixes de `contracts/claim-codes.md`). Ce fichier est le seul à lire ce secret.

### T033 — Configuration et garde de production

- `config.ts` : `claimCodeHmacKey` (≥ 32 octets, obligatoire en production, valeur de test fixe ailleurs), `tagDekCacheSeconds` (0 à 300, défaut 300 ; hors bornes = refus de démarrer), URL de base des quatre nouveaux rôles (obligatoires en production pour le processus qui s'en sert).
- `src/kms/production-guard.ts` : `assertNoFakeInProduction(config, providers)` appelée au démarrage de **chaque** processus ; échoue en nommant le faux. Aucun réglage ne la désactive.
- `test/unit/production-guard.spec.ts` : un test par faux (KMS, terminal, festivalier) → démarrage refusé en production ; démarrage accepté hors production.
- `apps/api/package.json` : dépendance `@cashless/tag-format`.

### T034 — Dettes de sécurité consignées

- `docs/POINTS_OUVERTS.md` : une entrée par dette (faux KMS, faux terminal, requêtes de terminal non signées, faux festivalier) avec risque, garde, mission de levée, condition de levée (tableau de `contracts/identity-ports.md`) ; plus l'aiguillage par chemin devant les processus (R-01) et la vérification de la signature d'originalité par le serveur (R-12 f).
- Les ADR correspondants sont écrits au WP20 ; cite ici leurs numéros prévus s'ils sont déjà connus, sinon « ADR à venir (WP20) ».

## Test Strategy

Tests demandés par la spec (pgTAP par contrainte, intégration HTTP sur vraie base, isolation à deux prestataires, preuves de sécurité). Ordre de vérification : `npm run lint`, `npm run typecheck`, `npm run reset-db -w @cashless/ledger-sql`, `npm run test:pgtap -w @cashless/ledger-sql`, puis `npm run reset-db -w @cashless/ledger-sql && npm test`. Ne jamais lancer pgTAP sur une base où Jest vient de tourner. Dans un worktree de lane, créer d'abord les liens `node_modules/@cashless/{api,contracts,ledger-sql,tag-format}`.

## Definition of Done

Lint, types et Jest verts ; un faux en production fait échouer le démarrage (3 tests) ; un port non demandé n'est pas injectable ; les quatre dettes sont dans `docs/POINTS_OUVERTS.md`. Chaque sous-tâche est marquée par `spec-kitty agent tasks mark-status Txxx --status done --mission bracelets-nfc-01M4TD3W`. Le compte rendu du lot liste : écarts au plan (avec leur sens : renforcement ou non), retouches hors carte, points soumis au porteur.

## Risks / Reviewer guidance

Le faux KMS contient des clés de test : il ne doit être importé que par des modules de test et par le câblage hors production. La garde est la seule barrière : ne lui ajoute aucune échappatoire. **Règle de sécurité du projet (`CLAUDE.md`, C-011)** : si un point de ce lot ne peut être tenu qu'en affaiblissant la sécurité (droit plus large, contrôle retiré ou reporté, secret plus exposé, faux gardé plus longtemps), **arrête-toi sur ce point et soumets-le au porteur avant de coder** ; continue le reste. Un renforcement se fait, puis se consigne.
