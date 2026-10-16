---
work_package_id: WP02
title: 'Bibliothèque de format en Dart (`cashless_tag_format`)'
dependencies:
- WP01
requirement_refs:
- FR-001
- FR-002
- FR-003
- FR-004
- FR-005
planning_base_branch: feat/bracelets-nfc
merge_target_branch: feat/bracelets-nfc
branch_strategy: Planning artifacts for this mission were generated on feat/bracelets-nfc. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/bracelets-nfc unless the human explicitly redirects the landing branch.
subtasks:
- T007
- T008
- T009
phase: 'Phase 1 - Socle'
history:
- timestamp: '2026-10-13T12:05:28Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: packages/tag-format/dart/
execution_mode: code_change
owned_files:
- packages/tag-format/dart/**
role: implementer
agent: claude
tags: []
tracker_refs: []
---

# Work Package Prompt: WP02 – Bibliothèque de format en Dart (`cashless_tag_format`)

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan`. Lis ensuite `README.md` (kit), `docs/SPECIFICATION.md` (sections citées ci-dessous), puis `kitty-specs/bracelets-nfc-01M4TD3W/spec.md`, `plan.md`, `research.md`, `data-model.md` et les contrats cités. En cas de contradiction entre sources, applique la règle de priorité de SPECIFICATION §0.3 et **signale-la** ; ne modifie jamais un fichier `.sql` généré de `packages/ledger-sql/`.

## Objective

Livrer la même bibliothèque en Dart 3.8 et prouver qu'elle rend les mêmes octets que la version TypeScript.

## Context

Exigences : FR-001 à FR-005, NFR-001, SC-001. Contrat : `contracts/tag-format.md`. Recherche : R-11 (dépendances). SDK : `dart --version` doit rendre 3.8.x (installé sur le poste le 13/10/2026). L'enveloppe pour un appareil n'est **pas** portée ici (mission 12).

**Règle de sécurité du projet (`CLAUDE.md`, C-011)** : si un point de ce lot ne peut être tenu qu'en affaiblissant la sécurité (droit plus large, contrôle retiré ou reporté, secret plus exposé, faux gardé plus longtemps), **arrête-toi sur ce point et soumets-le au porteur avant de coder** ; continue le reste. Un renforcement se fait, puis se consigne.

## Branch Strategy

Planification et merge sur `feat/bracelets-nfc`. Dépendances : WP01. L'espace de travail (worktree) est attribué par lane calculée dans `lanes.json`. Commande : `spec-kitty agent action implement WP02 --agent claude --mission bracelets-nfc-01M4TD3W`.

## Subtasks

### T007 — Paquet Dart

- `dart/pubspec.yaml` (`name: cashless_tag_format`, `environment: sdk: ^3.8.0`), `analysis_options.yaml` (lints recommandés), `pubspec.lock` commité.
- Dépendances : `pointycastle` (AES-GCM, HMAC, SHA-256) et `test` (dev) seulement, versions épinglées. Vérifie l'éditeur sur pub.dev et note la version retenue dans le compte rendu (chaîne d'approvisionnement, R-11). Aucune autre dépendance sans le signaler.

### T008 — Format, dérivation, enveloppe, code

- `lib/format_b.dart`, `lib/kdf.dart`, `lib/envelope.dart`, `lib/claim_code.dart`, `lib/cashless_tag_format.dart` (exports) : mêmes fonctions, mêmes refus (`TagFormatException` avec `code` identique aux codes TypeScript) que WP01.
- CRC-32/ISO-HDLC écrit à la main (table de 256 entrées, polynôme réfléchi `0xEDB88320`), contrôlé par `123456789` → `CBF43926`.
- Entrées et sorties en `Uint8List` ; aucune journalisation.

### T009 — Tests sur les mêmes vecteurs

- `test/*_test.dart` lisent `../vectors/vectors.json` et `../vectors/cross-impl.json` (produits par WP01) : tous les vecteurs du kit, tous les refus, et les 1 000 entrées croisées doivent rendre des octets identiques.
- `dart analyze` sans avertissement, `dart format --set-exit-if-changed .` propre.
- Ajoute `dart/README.md` court : commandes de test et rappel que les vecteurs viennent du paquet parent.

## Test Strategy

Tests demandés par la spec (pgTAP par contrainte, intégration HTTP sur vraie base, isolation à deux prestataires, preuves de sécurité). Ordre de vérification : `npm run lint`, `npm run typecheck`, `npm run reset-db -w @cashless/ledger-sql`, `npm run test:pgtap -w @cashless/ledger-sql`, puis `npm run reset-db -w @cashless/ledger-sql && npm test`. Ne jamais lancer pgTAP sur une base où Jest vient de tourner. Dans un worktree de lane, créer d'abord les liens `node_modules/@cashless/{api,contracts,ledger-sql,tag-format}`.

## Definition of Done

`dart pub get --enforce-lockfile && dart analyze && dart test` verts dans `packages/tag-format/dart` ; 100 % des vecteurs et des entrées croisées identiques. Chaque sous-tâche est marquée par `spec-kitty agent tasks mark-status Txxx --status done --mission bracelets-nfc-01M4TD3W`. Le compte rendu du lot liste : écarts au plan (avec leur sens : renforcement ou non), retouches hors carte, points soumis au porteur.

## Risks / Reviewer guidance

Un écart d'un octet avec TypeScript rend les bracelets illisibles par les apps : le test croisé est la preuve, ne le contourne pas.
