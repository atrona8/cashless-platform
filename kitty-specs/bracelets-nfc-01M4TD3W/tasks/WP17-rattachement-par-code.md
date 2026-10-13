---
work_package_id: WP17
title: Rattachement par code, demande en attente et consultation anonyme
dependencies:
- WP16
requirement_refs:
- FR-030
- FR-031
- FR-032
- FR-033
planning_base_branch: feat/bracelets-nfc
merge_target_branch: feat/bracelets-nfc
branch_strategy: Planning artifacts for this mission were generated on feat/bracelets-nfc. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/bracelets-nfc unless the human explicitly redirects the landing branch.
subtasks:
- T072
- T073
- T074
- T075
phase: Phase 4 - Bracelets
history:
- timestamp: '2026-10-13T12:05:28Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: apps/api/src/media/claims/
create_intent: []
execution_mode: code_change
owned_files:
- apps/api/src/media/claims/**
- apps/api/test/integration/media/claims.spec.ts
- apps/api/test/integration/media/claims-timing.spec.ts
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP17 – Rattachement par code, demande en attente et consultation anonyme

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan`. Lis ensuite `README.md` (kit), `docs/SPECIFICATION.md` (sections citées ci-dessous), puis `kitty-specs/bracelets-nfc-01M4TD3W/spec.md`, `plan.md`, `research.md`, `data-model.md` et les contrats cités. En cas de contradiction entre sources, applique la règle de priorité de SPECIFICATION §0.3 et **signale-la** ; ne modifie jamais un fichier `.sql` généré de `packages/ledger-sql/`.

## Objective

Servir le rattachement d'un bracelet par le festivalier, la demande en attente confirmée au guichet, les limites d'essais et la consultation anonyme du solde.

## Context

Exigences : FR-030 à FR-033, NFR-007, SC-006. Contrat : `contracts/claim-codes.md` (à lire en entier) ; opérations `claimMedia`, `confirmMediaClaim`, `lookupBalanceByClaimCode`, `listMyMedia`, `reportMyMediaLost` de `openapi.yaml` (servies telles quelles : lis leurs descriptions et sécurités). Fonctions : `claim_media`, `confirm_media_claim`, `claim_balance_lookup` (WP03). Ajoute `ClaimsModule` à `media-public.module.ts` (retouche hors carte).

**Règle de sécurité du projet (`CLAUDE.md`, C-011)** : si un point de ce lot ne peut être tenu qu'en affaiblissant la sécurité (droit plus large, contrôle retiré ou reporté, secret plus exposé, faux gardé plus longtemps), **arrête-toi sur ce point et soumets-le au porteur avant de coder** ; continue le reste. Un renforcement se fait, puis se consigne.

## Branch Strategy

Planification et merge sur `feat/bracelets-nfc`. Dépendances : WP16. L'espace de travail (worktree) est attribué par lane calculée dans `lanes.json`. Commande : `spec-kitty agent action implement WP17 --agent claude --mission bracelets-nfc-01M4TD3W`.

## Subtasks

### T072 — Rattachement par le festivalier

- `claimMedia` (`@Customer()`) : `normalizeClaimCode` (mal formé → 400 sans recherche ni essai compté), `claimCodeHash`, tire le code de confirmation à 6 chiffres et son empreinte **avant** l'appel (pour que les deux chemins fassent le même travail), `claim_media(...)`.
- `ATTACHED` → 200 ; `PENDING` → 202 avec identifiant, code de confirmation (rendu **une fois**, jamais stocké en clair) et expiration ; `REFUSED` → un seul refus (même statut, même corps, quel que soit le motif) ; `BLOCKED` → 429 avec `Retry-After`, anomalie ou ligne d'audit d'alerte.
- `listMyMedia`, `reportMyMediaLost` : si leur contrat tient dans le périmètre (bracelets du compte, suspension), sers-les ; sinon documente pourquoi elles restent à la mission 10 et signale-le.

### T073 — Confirmation au guichet

- `confirmMediaClaim` (terminal + agent, `counter-access` du WP15) : lecture du bracelet (embarquée ou `tap_id`), `confirmationHash(claimId, digits)`, `confirm_media_claim(...)` ; refus : autre bracelet, demande expirée, 5 essais atteints, mauvais code (compte un essai).
- Succès : une seule transaction (rattachement sans écriture comptable, code consommé, autres demandes annulées, `consume_tap`), audit avec terminal et agent.

### T074 — Consultation anonyme

- `lookupBalanceByClaimCode` (publique, sans identité ; `deviceRef` tiré de l'en-tête prévu au contrat ou, à défaut, d'une empreinte de l'adresse et de l'agent utilisateur — signale le choix) : solde et 10 derniers mouvements, aucune donnée personnelle ; mêmes limites par appareil ; même refus pour inconnu, utilisé, rattaché.

### T075 — Indistinction et tests

- `claims.spec.ts` : chaque scénario d'acceptation de l'US 7, limites (5 par heure et par compte, 20 par jour et par appareil), 4e demande, expiration, lot `POOL`, tiers qui connaît seulement le code d'un bracelet approvisionné → aucun rattachement sans lecture au guichet (SC-006), isolation.
- `claims-timing.spec.ts` (NFR-007) : 200 essais de code inconnu et 200 de code utilisé → même statut, même corps, écart des médianes < 20 ms ; lancé seul, hors de la passe parallèle (même mécanisme que la latence : variable `SKIP_LATENCY`).

## Test Strategy

Tests demandés par la spec (pgTAP par contrainte, intégration HTTP sur vraie base, isolation à deux prestataires, preuves de sécurité). Ordre de vérification : `npm run lint`, `npm run typecheck`, `npm run reset-db -w @cashless/ledger-sql`, `npm run test:pgtap -w @cashless/ledger-sql`, puis `npm run reset-db -w @cashless/ledger-sql && npm test`. Ne jamais lancer pgTAP sur une base où Jest vient de tourner. Dans un worktree de lane, créer d'abord les liens `node_modules/@cashless/{api,contracts,ledger-sql,tag-format}`.

## Definition of Done

Lint, types et Jest verts ; réponses indistinguables prouvées ; aucun code de confirmation en clair au repos. Chaque sous-tâche est marquée par `spec-kitty agent tasks mark-status Txxx --status done --mission bracelets-nfc-01M4TD3W`. Le compte rendu du lot liste : écarts au plan (avec leur sens : renforcement ou non), retouches hors carte, points soumis au porteur.

## Risks / Reviewer guidance

Toute différence observable entre « inconnu » et « utilisé » (statut, corps, temps, en-tête) permet l'énumération des codes. **Règle de sécurité du projet (`CLAUDE.md`, C-011)** : si un point de ce lot ne peut être tenu qu'en affaiblissant la sécurité (droit plus large, contrôle retiré ou reporté, secret plus exposé, faux gardé plus longtemps), **arrête-toi sur ce point et soumets-le au porteur avant de coder** ; continue le reste. Un renforcement se fait, puis se consigne.
