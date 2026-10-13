---
work_package_id: WP10
title: "Clés : demandes à deux, suivi et commande d'administration"
dependencies:
- WP04
- WP07
- WP09
requirement_refs:
- FR-007
- FR-009
- FR-035
planning_base_branch: feat/bracelets-nfc
merge_target_branch: feat/bracelets-nfc
branch_strategy: Planning artifacts for this mission were generated on feat/bracelets-nfc. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/bracelets-nfc unless the human explicitly redirects the landing branch.
subtasks:
- T039
- T040
- T041
- T042
phase: Phase 3 - Clés et lots
history:
- timestamp: '2026-10-13T12:05:28Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: apps/api/src/media/keys/
create_intent: []
execution_mode: code_change
owned_files:
- apps/api/src/media/keys/keys.controller.ts
- apps/api/src/media/keys/keys.service.ts
- apps/api/src/media/keys/keys.dto.ts
- apps/api/src/media/keys/key-approval-actions.ts
- apps/api/src/media/keys/key-admin.worker.ts
- apps/api/src/media/keys/keys-public.module.ts
- apps/api/src/media/keys/keys-admin.module.ts
- apps/api/test/integration/media/keys.spec.ts
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP10 – Clés : demandes à deux, suivi et commande d'administration

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan`. Lis ensuite `README.md` (kit), `docs/SPECIFICATION.md` (sections citées ci-dessous), puis `kitty-specs/bracelets-nfc-01M4TD3W/spec.md`, `plan.md`, `research.md`, `data-model.md` et les contrats cités. En cas de contradiction entre sources, applique la règle de priorité de SPECIFICATION §0.3 et **signale-la** ; ne modifie jamais un fichier `.sql` généré de `packages/ledger-sql/`.

## Objective

Permettre à un administrateur de prestataire de demander une clé, une rotation ou un retrait (à deux), d'en suivre l'avancement, et à l'exploitant de créer et de désactiver une clé par la commande d'administration.

## Context

Exigences : FR-007, FR-009 (partie désactivation), FR-035, SC-007. Contrat : `contracts/key-services.md` (travaux), `contracts/openapi-additions.md`. Précédent : les actions à deux de la mission 3 (`events/event-approval-actions.ts`, registre `ApprovalActionRegistry`). Ajoute `KeysPublicModule` à `media-public.module.ts` et `KeysAdminModule` à `media-key-admin.module.ts` (retouches hors carte, une ligne chacune).

**Règle de sécurité du projet (`CLAUDE.md`, C-011)** : si un point de ce lot ne peut être tenu qu'en affaiblissant la sécurité (droit plus large, contrôle retiré ou reporté, secret plus exposé, faux gardé plus longtemps), **arrête-toi sur ce point et soumets-le au porteur avant de coder** ; continue le reste. Un renforcement se fait, puis se consigne.

## Branch Strategy

Planification et merge sur `feat/bracelets-nfc`. Dépendances : WP04, WP07, WP09. L'espace de travail (worktree) est attribué par lane calculée dans `lanes.json`. Commande : `spec-kitty agent action implement WP10 --agent claude --mission bracelets-nfc-01M4TD3W`.

## Subtasks

### T039 — Lecture des clés et des travaux (API publique)

- `listTagKeys`, `getTagKey`, `listTagKeyJobs`, `listTagKeyCheckRuns` : rôle `OPERATOR_ADMIN` du prestataire du chemin ; la référence KMS n'est rendue que tronquée (suffixe) ; jamais `encrypted_dek`.
- Un travail `CREATE_KEY` ou `DISABLE_KMS_KEY` en attente est rendu avec `awaiting: 'KEY_ADMIN_COMMAND'` pour que l'administrateur sache qu'une intervention de l'exploitant est requise.

### T040 — Actions à deux

- `TAG_KEY_CREATE` (portée partagée ou dédiée à un événement du prestataire), `TAG_DEK_ROTATE`, `TAG_KEY_RETIRE` : routes `requestTagKey`, `requestDekRotation`, `requestTagKeyRetirement` → `202`. À l'approbation, l'action **insère un travail** (`CREATE_KEY`, `ROTATE_DEK`, `RETIRE_KEY`) et une ligne d'audit avec auteur et valideur ; elle n'appelle aucun service de clés.
- Contrôles à la demande **et** à l'exécution : index libre (prochain index du prestataire), événement du prestataire pour une clé dédiée, clé active pour une rotation, clé dédiée dont tous les lots sont `CLOSED` pour un retrait (sinon 409 avec la règle citée).

### T041 — Commande d'administration

- `key-admin.worker.ts` : `runOnce()` prend les travaux `CREATE_KEY` et `DISABLE_KMS_KEY`. `CREATE_KEY` : `KeyAdminPort.createKey('HMAC_256')`, désigne la clé d'emballage (`TAG_WRAPPING_KEY_REF` de la configuration ou création), insère `tag_key` ; pour une clé partagée, l'ancienne clé `ACTIVE` partagée passe en `DECRYPT_ONLY` ; crée le travail `CREATE_DEK`. `DISABLE_KMS_KEY` : `disableKey`, pose `kms_disabled_at`.
- Rejouable : un travail repris après une panne ne crée pas deux clés (la référence créée est écrite dans `progress` avant l'insertion de `tag_key`) ; un échec passe le travail en `FAILED` avec l'erreur, relançable.
- `--list` affiche les travaux en attente sans rien exécuter.

### T042 — Tests d'intégration

- `keys.spec.ts` : demande refusée à une seule personne, approuvée par une autre → travail ; commande → clé `ACTIVE` sans clé de données (non utilisable) ; panne injectée entre création KMS et insertion → relance sans doublon ; retrait refusé si un lot n'est pas clos ; isolation à deux prestataires ; audit avec auteur et valideur.

## Test Strategy

Tests demandés par la spec (pgTAP par contrainte, intégration HTTP sur vraie base, isolation à deux prestataires, preuves de sécurité). Ordre de vérification : `npm run lint`, `npm run typecheck`, `npm run reset-db -w @cashless/ledger-sql`, `npm run test:pgtap -w @cashless/ledger-sql`, puis `npm run reset-db -w @cashless/ledger-sql && npm test`. Ne jamais lancer pgTAP sur une base où Jest vient de tourner. Dans un worktree de lane, créer d'abord les liens `node_modules/@cashless/{api,contracts,ledger-sql,tag-format}`.

## Definition of Done

Lint, types et Jest verts ; aucune création ni désactivation de clé possible depuis l'API publique (le port n'y est pas injectable) ; aucune action de clé avec une seule personne. Chaque sous-tâche est marquée par `spec-kitty agent tasks mark-status Txxx --status done --mission bracelets-nfc-01M4TD3W`. Le compte rendu du lot liste : écarts au plan (avec leur sens : renforcement ou non), retouches hors carte, points soumis au porteur.

## Risks / Reviewer guidance

La commande d'administration est le seul détenteur de `KeyAdminPort` (décision du porteur n° 6) : n'ajoute aucun raccourci dans un autre processus. **Règle de sécurité du projet (`CLAUDE.md`, C-011)** : si un point de ce lot ne peut être tenu qu'en affaiblissant la sécurité (droit plus large, contrôle retiré ou reporté, secret plus exposé, faux gardé plus longtemps), **arrête-toi sur ce point et soumets-le au porteur avant de coder** ; continue le reste. Un renforcement se fait, puis se consigne.
