---
work_package_id: WP15
title: 'Activation, caution et consultation d''un bracelet'
dependencies:
- WP14
requirement_refs:
- FR-021
- FR-022
- FR-023
- FR-024
planning_base_branch: feat/bracelets-nfc
merge_target_branch: feat/bracelets-nfc
branch_strategy: Planning artifacts for this mission were generated on feat/bracelets-nfc. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/bracelets-nfc unless the human explicitly redirects the landing branch.
subtasks:
- T062
- T063
- T064
- T065
- T066
phase: 'Phase 4 - Bracelets'
history:
- timestamp: '2026-10-13T12:05:28Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: apps/api/src/media/lifecycle/
execution_mode: code_change
owned_files:
- apps/api/src/media/lifecycle/activation.controller.ts
- apps/api/src/media/lifecycle/activation.service.ts
- apps/api/src/media/lifecycle/deposit.controller.ts
- apps/api/src/media/lifecycle/deposit.service.ts
- apps/api/src/media/lifecycle/media-read.controller.ts
- apps/api/src/media/lifecycle/media-read.service.ts
- apps/api/src/media/lifecycle/lifecycle.dto.ts
- apps/api/src/media/lifecycle/counter-access.ts
- apps/api/src/media/lifecycle/lifecycle.module.ts
- apps/api/test/integration/media/activation.spec.ts
- apps/api/test/integration/media/deposit.spec.ts
create_intent:
- apps/api/src/media/lifecycle/activation.controller.ts
- apps/api/src/media/lifecycle/activation.service.ts
- apps/api/src/media/lifecycle/deposit.controller.ts
- apps/api/src/media/lifecycle/deposit.service.ts
- apps/api/src/media/lifecycle/media-read.controller.ts
- apps/api/src/media/lifecycle/media-read.service.ts
- apps/api/src/media/lifecycle/lifecycle.dto.ts
- apps/api/src/media/lifecycle/counter-access.ts
- apps/api/src/media/lifecycle/lifecycle.module.ts
- apps/api/test/integration/media/activation.spec.ts
- apps/api/test/integration/media/deposit.spec.ts
role: implementer
agent: claude
tags: []
tracker_refs: []
---

# Work Package Prompt: WP15 – Activation, caution et consultation d'un bracelet

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan`. Lis ensuite `README.md` (kit), `docs/SPECIFICATION.md` (sections citées ci-dessous), puis `kitty-specs/bracelets-nfc-01M4TD3W/spec.md`, `plan.md`, `research.md`, `data-model.md` et les contrats cités. En cas de contradiction entre sources, applique la règle de priorité de SPECIFICATION §0.3 et **signale-la** ; ne modifie jamais un fichier `.sql` généré de `packages/ledger-sql/`.

## Objective

Servir l'activation d'un bracelet au guichet, la prise et le rendu de la caution, et la consultation d'un bracelet.

## Context

Exigences : FR-021 à FR-024. Contrat : `contracts/media-lifecycle.md` ; opérations `activateMedia`, `getMedia`, caution et rendu de `openapi.yaml` (servies telles quelles : lis leurs descriptions). SPECIFICATION §7.8, §7.9, §6.1. Fonctions du schéma : `activate_media`, `preload_media`, `take_deposit`, `refund_deposit`. Ajoute `LifecycleModule` à `media-public.module.ts` (retouche hors carte).

**Règle de sécurité du projet (`CLAUDE.md`, C-011)** : si un point de ce lot ne peut être tenu qu'en affaiblissant la sécurité (droit plus large, contrôle retiré ou reporté, secret plus exposé, faux gardé plus longtemps), **arrête-toi sur ce point et soumets-le au porteur avant de coder** ; continue le reste. Un renforcement se fait, puis se consigne.

## Branch Strategy

Planification et merge sur `feat/bracelets-nfc`. Dépendances : WP14. L'espace de travail (worktree) est attribué par lane calculée dans `lanes.json`. Commande : `spec-kitty agent action implement WP15 --agent claude --mission bracelets-nfc-01M4TD3W`.

## Subtasks

### T062 — Accès au guichet

- `counter-access.ts` : une route de guichet exige un terminal (`@Device()`) **et** une personne (`CASHIER` ou `SUPERVISOR` sur l'événement du terminal ou son organisateur) ; rend l'auteur pour l'audit. Les routes de consultation back-office (`listMedia`, `getMediaAdmin`) acceptent une personne seule, lectrice de l'organisateur.

### T063 — Activation

- `activateMedia` : lecture par `tap_id` ou lecture embarquée (`TapService`, WP14 ; le bracelet doit répondre `NOT_ACTIVATED`) ; canal permis par `event.activation_modes` (sinon `422 ACTIVATION_MODE_NOT_ALLOWED`) ; lot non réservé ⇒ événement du terminal passé à `activate_media`.
- Portefeuille absent : création d'un portefeuille anonyme au grand livre de l'événement avec ses comptes payé et offert (cherche la fonction du schéma ou de la mission 3 qui ouvre un portefeuille ; si aucune n'existe, ajoute-la dans une **retouche hors carte de la migration 0013** annoncée, avec son test). `identity_mode = ACCOUNT_REQUIRED` sans `customer_id` : refus.
- Même transaction : `activate_media` (qui précharge), `consume_tap`. Puis caution (T suivant). Idempotence par `Idempotency-Key` (`serial:seq`).

### T064 — Caution

- Lot avec caution : `FROM_BALANCE` → `take_deposit` ; solde payé insuffisant → reste `DUE` (réponse 201 avec `deposit_status: DUE`). `SEPARATE` → `deposit_payment.method` obligatoire ; **`CASH` seulement** dans cette mission, tout autre moyen → 422 citant la règle (C-007) ; compte d'argent de la caisse selon le plan de comptes de l'événement.
- Route de prise de caution due (`POST /media/{id}/deposit`) : `take_deposit` dans une transaction **distincte** ; c'est le service que les missions de recharge appelleront (`DepositService.takeDueDeposit(mediaId)`, exporté).
- Rendu (`…/deposit/refund`) : `refund_deposit`, une seule fois (rejeu idempotent).

### T065 — Consultation

- `getMedia` (terminal) et `getMediaAdmin`, `listMedia` (back-office, filtres lot et statut, pagination) : `media_summary` et `media_status_log` ; jamais `token_hash`, mot de passe, ni empreinte du code.

### T066 — Tests d'intégration

- `activation.spec.ts` : portefeuille anonyme créé ; mode non permis ; compte obligatoire ; crédits offerts posés une seule fois malgré le rejeu ; lot non réservé sans événement ; bracelet déjà actif ; pendant `EDGE` → `409 DEBIT_AUTHORITY_EDGE` selon la règle du contrat ; rôles ; isolation.
- `deposit.spec.ts` : `FROM_BALANCE` suffisant et insuffisant (`DUE`), prise de la caution due après un crédit payé (crédit simulé par le moteur d'écritures de la mission 1), `SEPARATE` en espèces, moyen refusé, rendu une seule fois ; équilibre du grand livre vérifié après chaque cas.

## Test Strategy

Tests demandés par la spec (pgTAP par contrainte, intégration HTTP sur vraie base, isolation à deux prestataires, preuves de sécurité). Ordre de vérification : `npm run lint`, `npm run typecheck`, `npm run reset-db -w @cashless/ledger-sql`, `npm run test:pgtap -w @cashless/ledger-sql`, puis `npm run reset-db -w @cashless/ledger-sql && npm test`. Ne jamais lancer pgTAP sur une base où Jest vient de tourner. Dans un worktree de lane, créer d'abord les liens `node_modules/@cashless/{api,contracts,ledger-sql,tag-format}`.

## Definition of Done

Lint, types et Jest verts ; aucune règle de `activate_media` ou de `take_deposit` réécrite dans l'API ; grand livre équilibré après chaque test. Chaque sous-tâche est marquée par `spec-kitty agent tasks mark-status Txxx --status done --mission bracelets-nfc-01M4TD3W`. Le compte rendu du lot liste : écarts au plan (avec leur sens : renforcement ou non), retouches hors carte, points soumis au porteur.

## Risks / Reviewer guidance

L'ouverture d'un portefeuille anonyme touche au plan de comptes : réutilise ce qui existe, ne crée pas un second chemin. **Règle de sécurité du projet (`CLAUDE.md`, C-011)** : si un point de ce lot ne peut être tenu qu'en affaiblissant la sécurité (droit plus large, contrôle retiré ou reporté, secret plus exposé, faux gardé plus longtemps), **arrête-toi sur ce point et soumets-le au porteur avant de coder** ; continue le reste. Un renforcement se fait, puis se consigne.
