---
work_package_id: WP11
title: 'Clés de données : création, rotation, rechiffrement, retrait'
dependencies:
- WP10
requirement_refs:
- FR-007
- FR-008
- FR-009
planning_base_branch: feat/bracelets-nfc
merge_target_branch: feat/bracelets-nfc
branch_strategy: Planning artifacts for this mission were generated on feat/bracelets-nfc. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/bracelets-nfc unless the human explicitly redirects the landing branch.
subtasks:
- T043
- T044
- T045
- T046
phase: 'Phase 3 - Clés et lots'
history:
- timestamp: '2026-10-13T12:05:28Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: apps/api/src/media/keys/
execution_mode: code_change
owned_files:
- apps/api/src/media/keys/dek.worker.ts
- apps/api/src/media/keys/reencrypt.worker.ts
- apps/api/src/media/keys/dek-cache.ts
- apps/api/src/media/keys/data-key.repository.ts
- apps/api/src/media/keys/keys-personalization.module.ts
- apps/api/src/media/keys/keys-tag-keys.module.ts
- apps/api/test/integration/media/data-keys.spec.ts
- apps/api/test/unit/media/dek-cache.spec.ts
create_intent:
- apps/api/src/media/keys/dek.worker.ts
- apps/api/src/media/keys/reencrypt.worker.ts
- apps/api/src/media/keys/dek-cache.ts
- apps/api/src/media/keys/data-key.repository.ts
- apps/api/src/media/keys/keys-personalization.module.ts
- apps/api/src/media/keys/keys-tag-keys.module.ts
- apps/api/test/integration/media/data-keys.spec.ts
- apps/api/test/unit/media/dek-cache.spec.ts
role: implementer
agent: claude
tags: []
tracker_refs: []
---

# Work Package Prompt: WP11 – Clés de données : création, rotation, rechiffrement, retrait

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan`. Lis ensuite `README.md` (kit), `docs/SPECIFICATION.md` (sections citées ci-dessous), puis `kitty-specs/bracelets-nfc-01M4TD3W/spec.md`, `plan.md`, `research.md`, `data-model.md` et les contrats cités. En cas de contradiction entre sources, applique la règle de priorité de SPECIFICATION §0.3 et **signale-la** ; ne modifie jamais un fichier `.sql` généré de `packages/ledger-sql/`.

## Objective

Fournir à la personnalisation une clé de données de session, et exécuter dans les processus qui en ont le droit la rotation avec rechiffrement par tranches et le retrait d'une clé dédiée.

## Context

Exigences : FR-007, FR-008, FR-009, NFR-003, NFR-008. Contrat : `contracts/key-services.md` (travaux, cache). Recherche : R-04, R-05. Ajoute `KeysPersonalizationModule` à `media-personalization.module.ts` et `KeysTagKeysModule` à `media-tag-keys.module.ts` (retouches hors carte).

**Règle de sécurité du projet (`CLAUDE.md`, C-011)** : si un point de ce lot ne peut être tenu qu'en affaiblissant la sécurité (droit plus large, contrôle retiré ou reporté, secret plus exposé, faux gardé plus longtemps), **arrête-toi sur ce point et soumets-le au porteur avant de coder** ; continue le reste. Un renforcement se fait, puis se consigne.

## Branch Strategy

Planification et merge sur `feat/bracelets-nfc`. Dépendances : WP10. L'espace de travail (worktree) est attribué par lane calculée dans `lanes.json`. Commande : `spec-kitty agent action implement WP11 --agent claude --mission bracelets-nfc-01M4TD3W`.

## Subtasks

### T043 — Clé de données de session, rotation, retrait (processus de personnalisation)

- **Décision du porteur n° 7 (13/10/2026)** : la personnalisation n'a pas le droit `decrypt` ; elle scelle les mots de passe sous une **clé de données de session**. `session-data-key.ts` (dans `data-key.repository.ts` ou un fichier voisin du lot) : `SessionDataKeyProvider.get(operatorId, keyIndex)` → au premier appel, ou après expiration, `DataKeyPort.generateDataKey`, insère une nouvelle version `ACTIVE` et passe la précédente en `DECRYPT_ONLY` dans la même transaction (l'index unique « une seule active » l'impose), garde le clair en mémoire.
- Durée : le clair est effacé (tampon à zéro) après `tagDekCacheSeconds` sans utilisation (300 s au plus), à l'arrêt du processus, et dès que la version n'est plus `ACTIVE` en base (une autre instance a ouvert une session, ou une rotation a eu lieu) : dans ce cas le fournisseur ouvre une nouvelle version et l'appelant réessaie une fois. Une seule génération en vol par (prestataire, index).
- `dek.worker.ts` : `ROTATE_DEK` → nouvelle version `ACTIVE` (clair mis à zéro aussitôt : il ne sert pas ici), toutes les autres versions non retirées en `DECRYPT_ONLY`, puis travail `REENCRYPT` qui ramène tous les bracelets de l'index sous la nouvelle version. La rotation sert aussi à résorber les versions de session accumulées.
- `RETIRE_KEY` → `retire_dedicated_key(prestataire, index)` (fonction du schéma : clé et clé de données `RETIRED`, mots de passe effacés, bracelets retirés), puis crée `DISABLE_KMS_KEY`.

### T044 — Rechiffrement par tranches (processus des clés)

- `reencrypt.worker.ts` : par tranche de 500 bracelets sous l'ancienne version : un `decrypt` par clé de données (ancienne et nouvelle) pour toute la tranche, ouverture, scellement avec un nonce neuf et la même AAD, écriture de `pwd_pack_enc` et `pwd_pack_dek_id` ; `progress` mis à jour à chaque tranche.
- Quand plus aucun bracelet ne référence l'ancienne version : elle passe en `RETIRED`. Interrompu, le travail reprend sans perte (la tranche est une transaction).
- Tampons mis à zéro dans un `finally` ; rien de secret dans `progress` ni dans les journaux.

### T045 — Cache court de la clé de données

- `dek-cache.ts` : entrée par (prestataire, index, version), durée `tagDekCacheSeconds` (0 = aucun cache), tampon mis à zéro à l'expiration, à l'éviction et à `onModuleDestroy` ; une seule promesse de déchiffrement en vol par entrée (pas de rafale d'appels KMS).
- Utilisé **uniquement** par le processus des clés de bracelet (WP14). Avec la clé de session de la personnalisation (ci-dessus), ce sont les deux seuls endroits où une clé de données en clair survit à une requête ; le rechiffrement et le contrôle quotidien ne gardent rien.
- `test/unit/media/dek-cache.spec.ts` (horloge simulée) : expiration, mise à zéro vérifiée sur le tampon, 0 = toujours un appel, arrêt du module.

### T046 — Tests d'intégration

- `data-keys.spec.ts` : première session → version 1 `ACTIVE` ; expiration puis nouvelle session → version 2, version 1 `DECRYPT_ONLY`, bracelets de la version 1 toujours lisibles par le processus des clés ; deux fournisseurs concurrents sur le même index → aucun bracelet scellé sous une version non active ; tampon de session à zéro après expiration et à l'arrêt ; rotation sur 1 200 bracelets personnalisés (insérés par jeu de test avec le faux KMS) → trois tranches, tous relisibles avec la nouvelle version, ancienne `RETIRED` ; interruption simulée au milieu puis reprise ; retrait d'une clé dédiée : mots de passe effacés, travail de désactivation créé ; compteur du faux KMS : 2 `decrypt` par tranche au plus.

## Test Strategy

Tests demandés par la spec (pgTAP par contrainte, intégration HTTP sur vraie base, isolation à deux prestataires, preuves de sécurité). Ordre de vérification : `npm run lint`, `npm run typecheck`, `npm run reset-db -w @cashless/ledger-sql`, `npm run test:pgtap -w @cashless/ledger-sql`, puis `npm run reset-db -w @cashless/ledger-sql && npm test`. Ne jamais lancer pgTAP sur une base où Jest vient de tourner. Dans un worktree de lane, créer d'abord les liens `node_modules/@cashless/{api,contracts,ledger-sql,tag-format}`.

## Definition of Done

Lint, types et Jest verts ; après rotation, 100 % des mots de passe se déchiffrent sous la nouvelle version et aucun sous l'ancienne ; aucun clair ne survit à un travail (tampons à zéro vérifiés). Chaque sous-tâche est marquée par `spec-kitty agent tasks mark-status Txxx --status done --mission bracelets-nfc-01M4TD3W`. Le compte rendu du lot liste : écarts au plan (avec leur sens : renforcement ou non), retouches hors carte, points soumis au porteur.

## Risks / Reviewer guidance

Un rechiffrement qui perd un mot de passe rend un bracelet illisible à jamais : la tranche doit être atomique et vérifiée avant validation (rouvrir ce qu'on vient de sceller). **Règle de sécurité du projet (`CLAUDE.md`, C-011)** : si un point de ce lot ne peut être tenu qu'en affaiblissant la sécurité (droit plus large, contrôle retiré ou reporté, secret plus exposé, faux gardé plus longtemps), **arrête-toi sur ce point et soumets-le au porteur avant de coder** ; continue le reste. Un renforcement se fait, puis se consigne.
