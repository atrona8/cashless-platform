---
work_package_id: WP09
title: Quatre processus et commande d'administration des clés
dependencies:
- WP06
- WP08
requirement_refs:
- FR-006
- FR-018
planning_base_branch: feat/bracelets-nfc
merge_target_branch: feat/bracelets-nfc
branch_strategy: Planning artifacts for this mission were generated on feat/bracelets-nfc. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/bracelets-nfc unless the human explicitly redirects the landing branch.
subtasks:
- T035
- T036
- T037
- T038
phase: Phase 2 - Socle API
history:
- timestamp: '2026-10-13T12:05:28Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: apps/api/src/processes/
create_intent: []
execution_mode: code_change
owned_files:
- apps/api/src/processes/**
- apps/api/src/main.ts
- apps/api/src/main.tag-keys.ts
- apps/api/src/main.personalization.ts
- apps/api/src/main.tag-check.ts
- apps/api/src/main.key-admin.ts
- apps/api/src/app.module.ts
- apps/api/src/db/**
- apps/api/src/media/media-public.module.ts
- apps/api/src/media/media-tag-keys.module.ts
- apps/api/src/media/media-personalization.module.ts
- apps/api/src/media/media-tag-check.module.ts
- apps/api/src/media/media-key-admin.module.ts
- apps/api/test/unit/architecture.spec.ts
- apps/api/test/unit/processes.spec.ts
- apps/api/test/support/app.ts
- apps/api/test/support/db.ts
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP09 – Quatre processus et commande d'administration des clés

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan`. Lis ensuite `README.md` (kit), `docs/SPECIFICATION.md` (sections citées ci-dessous), puis `kitty-specs/bracelets-nfc-01M4TD3W/spec.md`, `plan.md`, `research.md`, `data-model.md` et les contrats cités. En cas de contradiction entre sources, applique la règle de priorité de SPECIFICATION §0.3 et **signale-la** ; ne modifie jamais un fichier `.sql` généré de `packages/ledger-sql/`.

## Objective

Donner à chaque service son point d'entrée, son module racine, son rôle de base et ses seules capacités de clés.

## Context

Exigences : NFR-005, NFR-010, décisions de plan 1 et 6. Recherche : R-01, R-04. Contrat : `contracts/key-services.md`. Précédent : `PlatformTx` et le second pool de la mission 3 (`src/db/`). `apps/api/package.json` appartient au WP08 : l'ajout des scripts de démarrage ici est une retouche hors carte, à noter en une ligne.

**Règle de sécurité du projet (`CLAUDE.md`, C-011)** : si un point de ce lot ne peut être tenu qu'en affaiblissant la sécurité (droit plus large, contrôle retiré ou reporté, secret plus exposé, faux gardé plus longtemps), **arrête-toi sur ce point et soumets-le au porteur avant de coder** ; continue le reste. Un renforcement se fait, puis se consigne.

## Branch Strategy

Planification et merge sur `feat/bracelets-nfc`. Dépendances : WP06, WP08. L'espace de travail (worktree) est attribué par lane calculée dans `lanes.json`. Commande : `spec-kitty agent action implement WP09 --agent claude --mission bracelets-nfc-01M4TD3W`.

## Subtasks

### T035 — Pools et transactions par rôle

- `src/db/` : un pool et une transaction cloisonnée par rôle (`TagKeysTx`, `PersoTx`, `TagCheckTx`, `KeyAdminTx`), chacun posant `app.operator_id` comme `TenantTx` ; un module de base par processus n'ouvre **que** son pool (l'API publique n'ouvre jamais le pool des clés).
- `test/support/db.ts` : URL des nouveaux rôles pour les tests.

### T036 — Modules racines et points d'entrée

- `src/processes/{public,tag-keys,personalization,tag-check,key-admin}.module.ts` ; `app.module.ts` devient ou réexporte le module public (les tests existants continuent de passer).
- Agrégateurs vides `src/media/media-{public,tag-keys,personalization,tag-check,key-admin}.module.ts`, importés par le module racine correspondant : les lots suivants y ajoutent leur module de fonctionnalité (une ligne, retouche hors carte annoncée dans chaque lot).
- `main.tag-keys.ts`, `main.personalization.ts` (serveurs HTTP, mêmes filtres, intercepteurs et préfixe que `main.ts`), `main.tag-check.ts` et `main.key-admin.ts` (contextes applicatifs sans serveur, options `--once` / `--list`). Chaque `main` appelle la garde de production du WP08.
- Capacités : public → aucune ; tag-keys → `decrypt` ; personalization → `mac`, `dataKey` ; tag-check → `mac`, `decrypt` ; key-admin → `keyAdmin`.

### T037 — Application de test par processus

- `test/support/app.ts` : `createTestApp({ process: 'public' | 'tag-keys' | 'personalization' })` et `createWorker('tag-check' | 'key-admin')`, partageant un même faux KMS quand un test l'exige (clés créées par un processus, lues par un autre).

### T038 — Tests d'architecture

- `test/unit/architecture.spec.ts` (étendu) : par analyse statique des imports, aucun fichier atteignable depuis `processes/public.module.ts` n'importe `kms/kms.ports`, `kms/fake-kms` ni un pool autre que celui de l'API ; `KeyAdminPort` n'est atteignable que depuis `key-admin` ; `MacPort` que depuis `personalization` et `tag-check`.
- `test/unit/processes.spec.ts` : chaque module racine se compile et démarre ; chaque `main` refuse de démarrer en production avec un faux.

## Test Strategy

Tests demandés par la spec (pgTAP par contrainte, intégration HTTP sur vraie base, isolation à deux prestataires, preuves de sécurité). Ordre de vérification : `npm run lint`, `npm run typecheck`, `npm run reset-db -w @cashless/ledger-sql`, `npm run test:pgtap -w @cashless/ledger-sql`, puis `npm run reset-db -w @cashless/ledger-sql && npm test`. Ne jamais lancer pgTAP sur une base où Jest vient de tourner. Dans un worktree de lane, créer d'abord les liens `node_modules/@cashless/{api,contracts,ledger-sql,tag-format}`.

## Definition of Done

Les cinq points d'entrée démarrent hors production ; les tests d'architecture échouent si un port de clé devient atteignable depuis l'API publique (prouve-le en cassant volontairement puis en rétablissant). Chaque sous-tâche est marquée par `spec-kitty agent tasks mark-status Txxx --status done --mission bracelets-nfc-01M4TD3W`. Le compte rendu du lot liste : écarts au plan (avec leur sens : renforcement ou non), retouches hors carte, points soumis au porteur.

## Risks / Reviewer guidance

Le test d'architecture est la preuve de NFR-005 : un test qui passe toujours ne prouve rien, vérifie qu'il échoue quand on viole la règle. **Règle de sécurité du projet (`CLAUDE.md`, C-011)** : si un point de ce lot ne peut être tenu qu'en affaiblissant la sécurité (droit plus large, contrôle retiré ou reporté, secret plus exposé, faux gardé plus longtemps), **arrête-toi sur ce point et soumets-le au porteur avant de coder** ; continue le reste. Un renforcement se fait, puis se consigne.
