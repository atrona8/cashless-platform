---
work_package_id: WP12
title: 'Lots : création, cycle de vie, codes à la commande, inventaire, clôture'
dependencies:
- WP03
- WP05
- WP07
- WP09
requirement_refs:
- FR-011
- FR-012
- FR-013
- FR-014
- FR-015
- FR-017
planning_base_branch: feat/bracelets-nfc
merge_target_branch: feat/bracelets-nfc
branch_strategy: Planning artifacts for this mission were generated on feat/bracelets-nfc. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/bracelets-nfc unless the human explicitly redirects the landing branch.
subtasks:
- T047
- T048
- T049
- T050
- T051
- T052
phase: 'Phase 3 - Clés et lots'
history:
- timestamp: '2026-10-13T12:05:28Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: apps/api/src/media/batches/
execution_mode: code_change
owned_files:
- apps/api/src/media/batches/**
- apps/api/test/integration/media/batches.spec.ts
- apps/api/test/integration/media/claim-code-order.spec.ts
create_intent:
- apps/api/test/integration/media/batches.spec.ts
- apps/api/test/integration/media/claim-code-order.spec.ts
role: implementer
agent: claude
tags: []
tracker_refs: []
---

# Work Package Prompt: WP12 – Lots : création, cycle de vie, codes à la commande, inventaire, clôture

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan`. Lis ensuite `README.md` (kit), `docs/SPECIFICATION.md` (sections citées ci-dessous), puis `kitty-specs/bracelets-nfc-01M4TD3W/spec.md`, `plan.md`, `research.md`, `data-model.md` et les contrats cités. En cas de contradiction entre sources, applique la règle de priorité de SPECIFICATION §0.3 et **signale-la** ; ne modifie jamais un fichier `.sql` généré de `packages/ledger-sql/`.

## Objective

Permettre à un administrateur d'organisateur de commander un lot, d'obtenir une fois le fichier de commande, de faire avancer le lot, de lire son inventaire et de le clore.

## Context

Exigences : FR-011 à FR-015, FR-017 (import), NFR-002, NFR-008. Contrats : `contracts/openapi-additions.md`, `contracts/claim-codes.md`. SPECIFICATION §7.7. Fonctions : `set_media_batch_status`, `issue_claim_codes`, `associate_claim_code` (WP03, WP05), `close_batch`, `forfeit_batch_deposits`, `preload_batch`, vue `batch_inventory` (schéma). Accès : helpers de la mission 3 (`tenant-access`, `canReadEvent`). Ajoute `BatchesModule` à `media-public.module.ts` (retouche hors carte).

**Règle de sécurité du projet (`CLAUDE.md`, C-011)** : si un point de ce lot ne peut être tenu qu'en affaiblissant la sécurité (droit plus large, contrôle retiré ou reporté, secret plus exposé, faux gardé plus longtemps), **arrête-toi sur ce point et soumets-le au porteur avant de coder** ; continue le reste. Un renforcement se fait, puis se consigne.

## Branch Strategy

Planification et merge sur `feat/bracelets-nfc`. Dépendances : WP03, WP05, WP07, WP09. L'espace de travail (worktree) est attribué par lane calculée dans `lanes.json`. Commande : `spec-kitty agent action implement WP12 --agent claude --mission bracelets-nfc-01M4TD3W`.

## Subtasks

### T047 — Création, lecture, modification

- `createMediaBatch` (`ORGANIZER_ADMIN` de l'organisateur) : type, quantité, index de clé (clé `ACTIVE` du prestataire ; clé dédiée ⇒ lot de son événement, usage unique), événement ou non, crédits offerts, caution et mode, politique de réutilisation, référence de commande. Les refus de la base (CHECK, `check_media_batch_key`) sont traduits en 422 avec la règle citée, en français et en anglais.
- `listMediaBatches`, `getMediaBatch` : lecteurs de l'organisateur et `OPERATOR_ADMIN` ; `updateMediaBatch` : lot `ORDERED` seulement, sinon 409.
- Audit de chaque écriture dans la transaction.

### T048 — Cycle de vie et inventaire

- `setMediaBatchStatus` → `set_media_batch_status` ; passage non prévu → 409 avec les passages permis ; motif obligatoire pour `SUSPENDED` ; `CLOSED` renvoyé vers la route de clôture.
- `getMediaBatchInventory` → vue `batch_inventory`, tous les compteurs de §7.7.

### T049 — Fichier de commande

- `issueClaimCodeOrder` : lot `PUBLIC`, une seule fois (`409` ensuite) ; tire `quantity` codes (`generateClaimCode` de WP01 avec `randomBytes`), calcule leurs empreintes (`claimCodeHash`, WP08), appelle `issue_claim_codes`, rend `text/csv` (`rang,code,url`).
- La route est marquée « jamais rejouée » : sa réponse n'est **pas** conservée par le registre d'idempotence (utilise l'option existante de l'intercepteur ou ajoute-la proprement, avec un test) ; les codes ne passent par aucun journal ni par l'audit (l'audit note seulement le nombre de codes).
- Collision d'empreinte dans le lot ou avec un code existant : retirage du code concerné.

### T050 — Import des associations

- `importClaimCodeAssociations` : fichier `code,uid` de l'imprimeur ; par ligne : normalise le code, empreinte, retrouve le bracelet par UID dans le lot, `associate_claim_code` ; réponse : lignes acceptées et lignes refusées avec leur motif, sans jamais renvoyer un code en clair (numéro de ligne seulement).
- Une ligne en erreur n'annule pas les autres (point de reprise par ligne).

### T051 — Clôture et rattrapage

- `closeMediaBatch` : appelle `forfeit_batch_deposits(lot, 500)` tant qu'il reste des cautions, puis `close_batch`, puis `invalidate_unassociated_codes` ; une requête traite au plus un nombre borné de tranches et rend `{ remaining }` pour que l'appelant relance ; idempotente.
- `catchUpBatchPreload` : `preload_batch(lot, 500)` ; rend le nombre traité.

### T052 — Tests d'intégration

- `batches.spec.ts` : création et refus (caution sans mode, clé dédiée sans événement, clé inactive), passages, inventaire, clôture d'un lot de 600 bracelets à caution détenue (jeu de test en base), rattrapage du préchargement, rôles, isolation à deux prestataires, audit.
- `claim-code-order.spec.ts` : CSV de `quantity` lignes au bon alphabet ; seconde demande 409 ; **aucun code en clair en base** (recherche de chaque code du CSV dans toutes les colonnes texte et bytea des tables de la mission, dans `audit_log` et dans `api_idempotency`) ; lot `STAFF` → aucun code ; import avec lignes fausses.

## Test Strategy

Tests demandés par la spec (pgTAP par contrainte, intégration HTTP sur vraie base, isolation à deux prestataires, preuves de sécurité). Ordre de vérification : `npm run lint`, `npm run typecheck`, `npm run reset-db -w @cashless/ledger-sql`, `npm run test:pgtap -w @cashless/ledger-sql`, puis `npm run reset-db -w @cashless/ledger-sql && npm test`. Ne jamais lancer pgTAP sur une base où Jest vient de tourner. Dans un worktree de lane, créer d'abord les liens `node_modules/@cashless/{api,contracts,ledger-sql,tag-format}`.

## Definition of Done

Lint, types et Jest verts ; aucun code de rattachement en clair au repos ; clôture d'un gros lot menée au bout par relances. Chaque sous-tâche est marquée par `spec-kitty agent tasks mark-status Txxx --status done --mission bracelets-nfc-01M4TD3W`. Le compte rendu du lot liste : écarts au plan (avec leur sens : renforcement ou non), retouches hors carte, points soumis au porteur.

## Risks / Reviewer guidance

Le fichier de commande est le seul moment où les codes existent en clair côté serveur : toute conservation (idempotence, journal, audit) est une fuite. **Règle de sécurité du projet (`CLAUDE.md`, C-011)** : si un point de ce lot ne peut être tenu qu'en affaiblissant la sécurité (droit plus large, contrôle retiré ou reporté, secret plus exposé, faux gardé plus longtemps), **arrête-toi sur ce point et soumets-le au porteur avant de coder** ; continue le reste. Un renforcement se fait, puis se consigne.
