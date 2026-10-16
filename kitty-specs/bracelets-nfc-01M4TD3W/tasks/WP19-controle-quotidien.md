---
work_package_id: WP19
title: 'Contrôle quotidien des mots de passe stockés'
dependencies:
- WP13
requirement_refs:
- FR-010
planning_base_branch: feat/bracelets-nfc
merge_target_branch: feat/bracelets-nfc
branch_strategy: Planning artifacts for this mission were generated on feat/bracelets-nfc. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/bracelets-nfc unless the human explicitly redirects the landing branch.
subtasks:
- T079
- T080
- T081
phase: 'Phase 5 - Exploitation et preuves'
history:
- timestamp: '2026-10-13T12:05:28Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: apps/api/src/media/daily-check/
execution_mode: code_change
owned_files:
- apps/api/src/media/daily-check/**
- apps/api/test/integration/media/daily-check.spec.ts
create_intent:
- apps/api/test/integration/media/daily-check.spec.ts
role: implementer
agent: claude
tags: []
tracker_refs: []
---

# Work Package Prompt: WP19 – Contrôle quotidien des mots de passe stockés

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan`. Lis ensuite `README.md` (kit), `docs/SPECIFICATION.md` (sections citées ci-dessous), puis `kitty-specs/bracelets-nfc-01M4TD3W/spec.md`, `plan.md`, `research.md`, `data-model.md` et les contrats cités. En cas de contradiction entre sources, applique la règle de priorité de SPECIFICATION §0.3 et **signale-la** ; ne modifie jamais un fichier `.sql` généré de `packages/ledger-sql/`.

## Objective

Recalculer chaque jour un échantillon de mots de passe par le service de clés, comparer aux valeurs stockées et alerter sur un écart.

## Context

Exigences : FR-010, NFR-003. Contrat : `contracts/key-services.md` (contrôle quotidien). SPECIFICATION §7.4. Servi par le processus `tag-check` (`createWorker('tag-check')`), rôle de base `cashless_tagcheck`, capacités `mac` et `decrypt`. Ajoute `DailyCheckModule` à `media-tag-check.module.ts` (retouche hors carte).

**Règle de sécurité du projet (`CLAUDE.md`, C-011)** : si un point de ce lot ne peut être tenu qu'en affaiblissant la sécurité (droit plus large, contrôle retiré ou reporté, secret plus exposé, faux gardé plus longtemps), **arrête-toi sur ce point et soumets-le au porteur avant de coder** ; continue le reste. Un renforcement se fait, puis se consigne.

## Branch Strategy

Planification et merge sur `feat/bracelets-nfc`. Dépendances : WP13. L'espace de travail (worktree) est attribué par lane calculée dans `lanes.json`. Commande : `spec-kitty agent action implement WP19 --agent claude --mission bracelets-nfc-01M4TD3W`.

## Subtasks

### T079 — Passage du contrôle

- `DailyCheckService.runOnce(operatorId)` : tire au plus 100 bracelets `NFC_TAG` personnalisés, non retirés, avec chiffré (tirage aléatoire en base) ; par clé de données rencontrée : un `decrypt` ; par bracelet : `generateMac` + `openPwdPack`, comparaison en temps constant ; tampons mis à zéro.
- Écrit `tag_key_check_run` (échantillon, écarts, statut). Un bracelet dont la clé est `RETIRED` est ignoré.

### T080 — Alerte sur un écart

- Un écart : statut `MISMATCH` et ligne d'audit nommant le bracelet (identifiant seulement). Aucune anomalie n'est ouverte : la liste des sortes d'anomalie est fermée (§12.2) et aucune ne correspond ; choix proposé au porteur le 13/10/2026 et consigné dans la spec. Ne détourne pas une sorte existante.
- Erreur du service de clés : statut `ERROR`, pas d'anomalie ; le passage suivant réessaie.

### T081 — Point d'entrée et tests

- `main.tag-check.ts --once` : parcourt les prestataires (liste lue sous le rôle `cashless_tagcheck` : vérifie que ses politiques le permettent, sinon c'est un point pour le WP06 à signaler) et rend un code de sortie non nul si un écart est trouvé.
- `daily-check.spec.ts` : 150 bracelets → 100 contrôlés, `OK` ; un chiffré altéré par jeu de test → `MISMATCH` et alerte ; panne KMS → `ERROR` ; compteurs du faux KMS ; isolation (un passage ne lit que son prestataire).

## Test Strategy

Tests demandés par la spec (pgTAP par contrainte, intégration HTTP sur vraie base, isolation à deux prestataires, preuves de sécurité). Ordre de vérification : `npm run lint`, `npm run typecheck`, `npm run reset-db -w @cashless/ledger-sql`, `npm run test:pgtap -w @cashless/ledger-sql`, puis `npm run reset-db -w @cashless/ledger-sql && npm test`. Ne jamais lancer pgTAP sur une base où Jest vient de tourner. Dans un worktree de lane, créer d'abord les liens `node_modules/@cashless/{api,contracts,ledger-sql,tag-format}`.

## Definition of Done

Lint, types et Jest verts ; un chiffré altéré est détecté ; aucun mot de passe en clair hors de la mémoire du processus. Chaque sous-tâche est marquée par `spec-kitty agent tasks mark-status Txxx --status done --mission bracelets-nfc-01M4TD3W`. Le compte rendu du lot liste : écarts au plan (avec leur sens : renforcement ou non), retouches hors carte, points soumis au porteur.

## Risks / Reviewer guidance

L'ordonnancement en production est hors mission (hypothèse de la spec) : livre une opération déclenchable et testée. **Règle de sécurité du projet (`CLAUDE.md`, C-011)** : si un point de ce lot ne peut être tenu qu'en affaiblissant la sécurité (droit plus large, contrôle retiré ou reporté, secret plus exposé, faux gardé plus longtemps), **arrête-toi sur ce point et soumets-le au porteur avant de coder** ; continue le reste. Un renforcement se fait, puis se consigne.
