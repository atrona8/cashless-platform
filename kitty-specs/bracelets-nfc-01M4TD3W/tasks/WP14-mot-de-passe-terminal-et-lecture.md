---
work_package_id: WP14
title: Mot de passe pour un terminal et lecture d'un bracelet
dependencies:
- WP13
requirement_refs:
- FR-018
- FR-019
- FR-020
planning_base_branch: feat/bracelets-nfc
merge_target_branch: feat/bracelets-nfc
branch_strategy: Planning artifacts for this mission were generated on feat/bracelets-nfc. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/bracelets-nfc unless the human explicitly redirects the landing branch.
subtasks:
- T058
- T059
- T060
- T061
phase: Phase 4 - Bracelets
history:
- timestamp: '2026-10-13T12:05:28Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: apps/api/src/media/taps/
create_intent:
- apps/api/test/integration/media/auth-keys.spec.ts
- apps/api/test/integration/media/taps.spec.ts
execution_mode: code_change
owned_files:
- apps/api/src/media/auth-keys/**
- apps/api/src/media/taps/**
- apps/api/test/integration/media/auth-keys.spec.ts
- apps/api/test/integration/media/taps.spec.ts
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP14 – Mot de passe pour un terminal et lecture d'un bracelet

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan`. Lis ensuite `README.md` (kit), `docs/SPECIFICATION.md` (sections citées ci-dessous), puis `kitty-specs/bracelets-nfc-01M4TD3W/spec.md`, `plan.md`, `research.md`, `data-model.md` et les contrats cités. En cas de contradiction entre sources, applique la règle de priorité de SPECIFICATION §0.3 et **signale-la** ; ne modifie jamais un fichier `.sql` généré de `packages/ledger-sql/`.

## Objective

Servir `POST /media/auth-keys` (processus des clés) et `POST /taps` (API publique), et rendre durables les effets de sécurité d'une lecture suspecte.

## Context

Exigences : FR-018, FR-019, FR-020, NFR-003, SC-003. Contrat : `contracts/media-lifecycle.md` (à lire en entier), opérations `getMediaAuthKey` et `createTap` de `openapi.yaml` (servies telles quelles). Recherche : R-05, R-08, R-09. SPECIFICATION §7.6. Ajoute `AuthKeysModule` à `media-tag-keys.module.ts` et `TapsModule` à `media-public.module.ts` (retouches hors carte).

**Règle de sécurité du projet (`CLAUDE.md`, C-011)** : si un point de ce lot ne peut être tenu qu'en affaiblissant la sécurité (droit plus large, contrôle retiré ou reporté, secret plus exposé, faux gardé plus longtemps), **arrête-toi sur ce point et soumets-le au porteur avant de coder** ; continue le reste. Un renforcement se fait, puis se consigne.

## Branch Strategy

Planification et merge sur `feat/bracelets-nfc`. Dépendances : WP13. L'espace de travail (worktree) est attribué par lane calculée dans `lanes.json`. Commande : `spec-kitty agent action implement WP14 --agent claude --mission bracelets-nfc-01M4TD3W`.

## Subtasks

### T058 — Demande de mot de passe

- Processus des clés, garde `@Device()` : cherche le bracelet par (prestataire du terminal, UID), vérifie l'index ; clé de données par `DekCache` (WP11) → au plus un `decrypt` ; `openPwdPack` ; `sealForRecipient(agreementPublicKey du terminal, PWD‖PACK, deviceAad)` ; mise à zéro du mot de passe dans un `finally`.
- Bracelet inconnu, d'un autre prestataire, sans chiffré, d'une clé `RETIRED`, ou index différent : `404 MEDIA_UNKNOWN` après un **délai constant** (durée cible fixe couvrant le chemin nominal, attendue même en cas d'échec rapide) et sans appel au service de clés.
- Terminal sans clé d'accord enregistrée : 409 explicite. Service de clés indisponible : 503.

### T059 — Lecture

- `createTap` (API publique, `@Device()`) : `register_tap(prestataire, token_hash, uid, compteur, occurred_at, terminal, 'ONLINE', signature)` dans sa propre transaction validée ; rend `result` tel quel en 200, `tap_id` quand il existe, et pour `OK` le bracelet (`media_summary`) et le solde disponible.
- Service réutilisable `TapService.registerEmbedded(client, tap)` pour les opérations qui embarquent la lecture (WP15, WP16, WP17) et `TapService.consume(client, tapId, transactionId)`.

### T060 — Effets de sécurité durables

- `TapService.withEmbeddedTap(fn)` : ouvre la transaction, `register_tap` ; si `UID_MISMATCH`, `SIGNATURE_MISMATCH` ou `CLONE_SUSPECTED` : annule, **rejoue `register_tap` seul dans une transaction validée**, puis lève l'erreur `MEDIA_*`. Tout autre résultat défavorable : annule et lève l'erreur `MEDIA_*` correspondante (table de `contracts/media-lifecycle.md`).
- Si l'opération échoue **après** une lecture `OK` (solde, règle métier), tout est annulé et la même lecture reste utilisable (test).

### T061 — Tests d'intégration

- `auth-keys.spec.ts` : le terminal factice ouvre l'enveloppe et retrouve le mot de passe du vecteur ; compteur `decrypt` = 1 puis 0 dans la fenêtre du cache, 1 par demande avec `TAG_DEK_CACHE_SECONDS=0` ; inconnu et autre prestataire indistinguables (statut, corps, durée à ±20 ms sur 50 essais) ; aucun appel KMS pour un inconnu.
- `taps.spec.ts` : chaque résultat de §7.6 (table statut → résultat), renvoi de la même lecture par le même terminal (même `tap_id`, sans anomalie), compteur rejoué par un autre terminal → liste noire + anomalie `COUNTER_DUPLICATE`, UID différent, signature différente, signature absente (`SIGNATURE_MISSING`, ni liste noire ni anomalie), lot suspendu, autre événement ; lecture suspecte embarquée dans une opération qui échoue → liste noire **persistée**.

## Test Strategy

Tests demandés par la spec (pgTAP par contrainte, intégration HTTP sur vraie base, isolation à deux prestataires, preuves de sécurité). Ordre de vérification : `npm run lint`, `npm run typecheck`, `npm run reset-db -w @cashless/ledger-sql`, `npm run test:pgtap -w @cashless/ledger-sql`, puis `npm run reset-db -w @cashless/ledger-sql && npm test`. Ne jamais lancer pgTAP sur une base où Jest vient de tourner. Dans un worktree de lane, créer d'abord les liens `node_modules/@cashless/{api,contracts,ledger-sql,tag-format}`.

## Definition of Done

Lint, types et Jest verts ; 100 % des lectures copiées testées mettent le bracelet en liste noire, y compris quand l'opération échoue ; un seul déchiffrement au plus par demande. Chaque sous-tâche est marquée par `spec-kitty agent tasks mark-status Txxx --status done --mission bracelets-nfc-01M4TD3W`. Le compte rendu du lot liste : écarts au plan (avec leur sens : renforcement ou non), retouches hors carte, points soumis au porteur.

## Risks / Reviewer guidance

Le délai constant et l'indistinction protègent contre l'énumération des bracelets ; la seconde transaction de `register_tap` est ce qui rend la détection de copie réelle. **Règle de sécurité du projet (`CLAUDE.md`, C-011)** : si un point de ce lot ne peut être tenu qu'en affaiblissant la sécurité (droit plus large, contrôle retiré ou reporté, secret plus exposé, faux gardé plus longtemps), **arrête-toi sur ce point et soumets-le au porteur avant de coder** ; continue le reste. Un renforcement se fait, puis se consigne.
