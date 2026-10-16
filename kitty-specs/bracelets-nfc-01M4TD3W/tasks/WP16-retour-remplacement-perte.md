---
work_package_id: WP16
title: 'Guichet de retour : restitution, remplacement, perte, espèces dues'
dependencies:
- WP15
requirement_refs:
- FR-025
- FR-026
- FR-027
- FR-028
planning_base_branch: feat/bracelets-nfc
merge_target_branch: feat/bracelets-nfc
branch_strategy: Planning artifacts for this mission were generated on feat/bracelets-nfc. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/bracelets-nfc unless the human explicitly redirects the landing branch.
subtasks:
- T067
- T068
- T069
- T070
- T071
phase: 'Phase 4 - Bracelets'
history:
- timestamp: '2026-10-13T12:05:28Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: apps/api/src/media/lifecycle/
execution_mode: code_change
owned_files:
- apps/api/src/media/lifecycle/release.controller.ts
- apps/api/src/media/lifecycle/release.service.ts
- apps/api/src/media/lifecycle/replace.controller.ts
- apps/api/src/media/lifecycle/replace.service.ts
- apps/api/src/media/lifecycle/loss.controller.ts
- apps/api/src/media/lifecycle/loss.service.ts
- apps/api/src/media/lifecycle/cash-due.controller.ts
- apps/api/src/media/lifecycle/cash-due.service.ts
- apps/api/src/media/lifecycle/return.module.ts
- apps/api/test/integration/media/release.spec.ts
- apps/api/test/integration/media/replace.spec.ts
- apps/api/test/integration/media/cash-due.spec.ts
create_intent:
- apps/api/src/media/lifecycle/release.controller.ts
- apps/api/src/media/lifecycle/release.service.ts
- apps/api/src/media/lifecycle/replace.controller.ts
- apps/api/src/media/lifecycle/replace.service.ts
- apps/api/src/media/lifecycle/loss.controller.ts
- apps/api/src/media/lifecycle/loss.service.ts
- apps/api/src/media/lifecycle/cash-due.controller.ts
- apps/api/src/media/lifecycle/cash-due.service.ts
- apps/api/src/media/lifecycle/return.module.ts
- apps/api/test/integration/media/release.spec.ts
- apps/api/test/integration/media/replace.spec.ts
- apps/api/test/integration/media/cash-due.spec.ts
role: implementer
agent: claude
tags: []
tracker_refs: []
---

# Work Package Prompt: WP16 – Guichet de retour : restitution, remplacement, perte, espèces dues

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan`. Lis ensuite `README.md` (kit), `docs/SPECIFICATION.md` (sections citées ci-dessous), puis `kitty-specs/bracelets-nfc-01M4TD3W/spec.md`, `plan.md`, `research.md`, `data-model.md` et les contrats cités. En cas de contradiction entre sources, applique la règle de priorité de SPECIFICATION §0.3 et **signale-la** ; ne modifie jamais un fichier `.sql` généré de `packages/ledger-sql/`.

## Objective

Servir la restitution (et la réattribution d'un lot réattribuable), le remplacement, la perte et le bracelet retrouvé, et le rendu des espèces dues.

## Context

Exigences : FR-025 à FR-028. Contrat : `contracts/media-lifecycle.md` ; opérations `releaseMedia`, `replaceMedia`, espèces dues de `openapi.yaml` (servies telles quelles), `reportMediaLost`, `recoverMedia` (ajoutées au WP07). SPECIFICATION §7.8, §7.9, §8.5. Fonctions du schéma : `release_media`, `reassign_pool_media`, `replace_media`, `recover_media`, `refund_cash_due` ; `suspend_media` (WP05). Jeton d'approbation sur place : mécanisme de la mission 2. Ajoute `ReturnModule` à `media-public.module.ts` (retouche hors carte).

**Règle de sécurité du projet (`CLAUDE.md`, C-011)** : si un point de ce lot ne peut être tenu qu'en affaiblissant la sécurité (droit plus large, contrôle retiré ou reporté, secret plus exposé, faux gardé plus longtemps), **arrête-toi sur ce point et soumets-le au porteur avant de coder** ; continue le reste. Un renforcement se fait, puis se consigne.

## Branch Strategy

Planification et merge sur `feat/bracelets-nfc`. Dépendances : WP15. L'espace de travail (worktree) est attribué par lane calculée dans `lanes.json`. Commande : `spec-kitty agent action implement WP16 --agent claude --mission bracelets-nfc-01M4TD3W`.

## Subtasks

### T067 — Restitution et réattribution

- `releaseMedia` : `release_media` ; le refus `CL020` (portefeuille non soldé, caution détenue, espèces dues) est traduit en 409 qui **nomme ce qui reste à faire** (lis le message de la fonction ; si elle ne distingue pas les cas, détermine-les par lecture avant l'appel, sans réécrire la règle).
- L'API n'enchaîne pas le guichet de retour à la place de l'agent (étapes 2 et 3 de §7.9 : mission 9).
- Lot `POOL` : réattribution par `reassign_pool_media(bracelet, empreinte de la nouvelle identité)` exposée selon le contrat existant (lis `releaseMedia` et ses options) ; l'ancienne identité présentée ensuite → `CLONE_SUSPECTED` et anomalie `RETIRED_IDENTITY` (test).

### T068 — Remplacement

- `replaceMedia` : lecture du **nouveau** bracelet (embarquée ou `tap_id`) ; `replace_media(ancien, nouveau)` ; refus `CL020` traduits en 409 avec la règle (nouveau non neuf, déjà rattaché, sous caution, autre organisateur, mode de caution différent avec caution détenue).
- Vérifie par test : portefeuilles repris sans écriture comptable ni préchargement ; caution `HELD` ou `DUE` passée au nouveau ; ancien `REPLACED`.

### T069 — Perte et bracelet retrouvé

- `reportMediaLost` → `suspend_media` (motif) ; `recoverMedia` → `recover_media` : `ACTIVE` si `lost_media_policy = REACTIVATE`, `RETIRED` si `END_OF_LIFE` (réglage de l'événement, mission 3).
- Rôles `CASHIER` et `SUPERVISOR` ; audit et historique avec auteur et motif.

### T070 — Espèces dues

- Route `…/cash-due-refunds` : `refund_cash_due(bracelet, compte de caisse, clé, auteur, valideur)` ; au-delà de `event.cash_refund_single_max`, **jeton d'approbation sur place** d'une seconde personne exigé (mécanisme de la mission 2 : jeton consommé dans la transaction métier) ; `approved_by` du corps ignoré (ADR-74).
- La base contrôle déjà auteur ≠ valideur : ne double pas la règle, traduis son refus.

### T071 — Tests d'intégration

- `release.spec.ts`, `replace.spec.ts`, `cash-due.spec.ts` : chaque scénario d'acceptation des US 6 de la spec, chaque refus, idempotence, rôles, isolation à deux prestataires, équilibre du grand livre ; espèces dues créées par jeu de test (anomalie `CASH_TOPUP_OVER_LIMIT` et écriture `L-ESP-A-RENDRE` selon le schéma).

## Test Strategy

Tests demandés par la spec (pgTAP par contrainte, intégration HTTP sur vraie base, isolation à deux prestataires, preuves de sécurité). Ordre de vérification : `npm run lint`, `npm run typecheck`, `npm run reset-db -w @cashless/ledger-sql`, `npm run test:pgtap -w @cashless/ledger-sql`, puis `npm run reset-db -w @cashless/ledger-sql && npm test`. Ne jamais lancer pgTAP sur une base où Jest vient de tourner. Dans un worktree de lane, créer d'abord les liens `node_modules/@cashless/{api,contracts,ledger-sql,tag-format}`.

## Definition of Done

Lint, types et Jest verts ; les refus nomment ce qui reste à faire ; la caution suit le bracelet remplacé ; aucune règle du schéma réécrite. Chaque sous-tâche est marquée par `spec-kitty agent tasks mark-status Txxx --status done --mission bracelets-nfc-01M4TD3W`. Le compte rendu du lot liste : écarts au plan (avec leur sens : renforcement ou non), retouches hors carte, points soumis au porteur.

## Risks / Reviewer guidance

Créer une situation « espèces dues » sans la mission 6 demande un jeu de test fidèle au schéma : lis `refund_cash_due` et `anomaly_cash_due_guard` avant. **Règle de sécurité du projet (`CLAUDE.md`, C-011)** : si un point de ce lot ne peut être tenu qu'en affaiblissant la sécurité (droit plus large, contrôle retiré ou reporté, secret plus exposé, faux gardé plus longtemps), **arrête-toi sur ce point et soumets-le au porteur avant de coder** ; continue le reste. Un renforcement se fait, puis se consigne.
