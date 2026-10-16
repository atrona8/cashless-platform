---
work_package_id: WP07
title: 'Contrat d''API : routes back-office des bracelets, types TypeScript et Dart'
dependencies: []
requirement_refs:
- FR-036
planning_base_branch: feat/bracelets-nfc
merge_target_branch: feat/bracelets-nfc
branch_strategy: Planning artifacts for this mission were generated on feat/bracelets-nfc. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/bracelets-nfc unless the human explicitly redirects the landing branch.
subtasks:
- T026
- T027
- T028
- T029
phase: 'Phase 1 - Socle'
history:
- timestamp: '2026-10-13T12:05:28Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: packages/contracts/openapi.yaml
execution_mode: code_change
owned_files:
- packages/contracts/openapi.yaml
- packages/contracts/generated/**
- packages/contracts/dart/**
- packages/contracts/package.json
- packages/contracts/scripts/**
role: implementer
agent: claude
tags: []
tracker_refs: []
---

# Work Package Prompt: WP07 – Contrat d'API : routes back-office des bracelets, types TypeScript et Dart

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan`. Lis ensuite `README.md` (kit), `docs/SPECIFICATION.md` (sections citées ci-dessous), puis `kitty-specs/bracelets-nfc-01M4TD3W/spec.md`, `plan.md`, `research.md`, `data-model.md` et les contrats cités. En cas de contradiction entre sources, applique la règle de priorité de SPECIFICATION §0.3 et **signale-la** ; ne modifie jamais un fichier `.sql` généré de `packages/ledger-sql/`.

## Objective

Décrire au contrat les routes manquantes de la mission et régénérer les types, en TypeScript et en Dart.

## Context

Exigences : FR-036, C-008. Contrat de conception : `contracts/openapi-additions.md` (liste des opérations), `contracts/claim-codes.md`, `contracts/key-services.md`. Recherche : R-10 (types Dart). Précédent : le WP04 de la mission 3 (48 opérations ajoutées, mêmes conventions). **Aucune route existante n'est modifiée** ; une contradiction relevée est signalée (§0.3).

**Règle de sécurité du projet (`CLAUDE.md`, C-011)** : si un point de ce lot ne peut être tenu qu'en affaiblissant la sécurité (droit plus large, contrôle retiré ou reporté, secret plus exposé, faux gardé plus longtemps), **arrête-toi sur ce point et soumets-le au porteur avant de coder** ; continue le reste. Un renforcement se fait, puis se consigne.

## Branch Strategy

Planification et merge sur `feat/bracelets-nfc`. Dépendances : aucune. L'espace de travail (worktree) est attribué par lane calculée dans `lanes.json`. Commande : `spec-kitty agent action implement WP07 --agent claude --mission bracelets-nfc-01M4TD3W`.

## Subtasks

### T026 — Schémas

- `TagKey`, `TagDataKeyVersion`, `TagKeyJob`, `TagKeyCheckRun`, `MediaBatch`, `MediaBatchCreate`, `MediaBatchUpdate`, `MediaBatchStatusChange`, `MediaBatchInventory`, `ClaimCodeAssociationResult`, `MediaAdmin`, `MediaStatusEntry`, `MediaPersonalizationRequest`, `MediaPersonalizationResponse`, `SealedSecret` (réutilise la forme de `MediaAuthKeyResponse` si elle convient), `BlacklistRequest`, `ReasonRequest`.
- Aucun schéma ne porte `token_hash`, `pwd_pack_enc`, une clé de données ou un code en clair, sauf `MediaPersonalizationRequest` (empreinte de l'identité, signature) et la réponse CSV du fichier de commande.
- Rôle `PERSONALIZER` ajouté à l'énumération des rôles ; `ApprovalAction` étendue des quatre actions.

### T027 — Routes des clés et des lots

- Les 17 opérations « tag-keys », « tag-key-jobs », « tag-key-check-runs » et « media-batches » de `contracts/openapi-additions.md`, sous `/operators/{operator_id}/…`, tag « Bracelets » ou un tag « Lots et clés » cohérent avec l'existant.
- Conventions : `problem+json`, `Idempotency-Key` sur toute écriture, `X-Request-Id`, `Accept-Language`, pagination par curseur, `202` avec `ApprovalRequest` pour une action à deux.
- `issueClaimCodeOrder` : `200 text/csv`, `409` si déjà émis ; description : jamais rejouée, jamais journalisée.

### T028 — Routes des bracelets et du poste

- `listMedia`, `getMediaAdmin`, `blacklistMedia`, `requestMediaReinstatement`, `reportMediaLost`, `recoverMedia`, `registerPersonalizedMedia`, `associateClaimCode`.
- Extension `x-process` (`public`, `tag-keys`, `personalization`) sur **toutes** les opérations de la mission, y compris les existantes servies ici (`getMediaAuthKey` → `tag-keys`). C'est le seul ajout fait à une opération existante ; note-le dans le compte rendu.

### T029 — Génération et contrôle

- Régénère les types TypeScript (`npm run generate -w @cashless/contracts`) ; `npm run check -w @cashless/contracts` vert.
- Types Dart : script `generate:dart` (outil Dart épinglé, R-10) vers `packages/contracts/dart/` ; fais d'abord un essai sur le contrat complet (OpenAPI 3.1). Si l'outil échoue, applique le repli de R-10 et **signale-le** ; n'écris aucun type à la main.
- `check` étendu : régénérer les types Dart puis comparer, comme pour TypeScript ; ignoré avec un message si `dart` est absent du poste, obligatoire en CI (WP20).

## Test Strategy

Tests demandés par la spec (pgTAP par contrainte, intégration HTTP sur vraie base, isolation à deux prestataires, preuves de sécurité). Ordre de vérification : `npm run lint`, `npm run typecheck`, `npm run reset-db -w @cashless/ledger-sql`, `npm run test:pgtap -w @cashless/ledger-sql`, puis `npm run reset-db -w @cashless/ledger-sql && npm test`. Ne jamais lancer pgTAP sur une base où Jest vient de tourner. Dans un worktree de lane, créer d'abord les liens `node_modules/@cashless/{api,contracts,ledger-sql,tag-format}`.

## Definition of Done

`npm run check -w @cashless/contracts` vert ; le contrat valide en OpenAPI 3.1 ; types Dart générés et analysables (`dart analyze`). Chaque sous-tâche est marquée par `spec-kitty agent tasks mark-status Txxx --status done --mission bracelets-nfc-01M4TD3W`. Le compte rendu du lot liste : écarts au plan (avec leur sens : renforcement ou non), retouches hors carte, points soumis au porteur.

## Risks / Reviewer guidance

Le balayage d'isolation de la mission 3 sélectionne ses routes par tags : vérifie que les nouvelles routes n'y entrent pas par accident (sinon elles y échoueront tant qu'elles ne sont pas servies).
