---
work_package_id: WP18
title: 'Liste noire et sortie à deux'
dependencies:
- WP14
requirement_refs:
- FR-029
- FR-035
planning_base_branch: feat/bracelets-nfc
merge_target_branch: feat/bracelets-nfc
branch_strategy: Planning artifacts for this mission were generated on feat/bracelets-nfc. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/bracelets-nfc unless the human explicitly redirects the landing branch.
subtasks:
- T076
- T077
- T078
phase: 'Phase 4 - Bracelets'
history:
- timestamp: '2026-10-13T12:05:28Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: apps/api/src/media/blacklist/
execution_mode: code_change
owned_files:
- apps/api/src/media/blacklist/**
- apps/api/test/integration/media/blacklist.spec.ts
create_intent:
- apps/api/test/integration/media/blacklist.spec.ts
role: implementer
agent: claude
tags: []
tracker_refs: []
---

# Work Package Prompt: WP18 – Liste noire et sortie à deux

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan`. Lis ensuite `README.md` (kit), `docs/SPECIFICATION.md` (sections citées ci-dessous), puis `kitty-specs/bracelets-nfc-01M4TD3W/spec.md`, `plan.md`, `research.md`, `data-model.md` et les contrats cités. En cas de contradiction entre sources, applique la règle de priorité de SPECIFICATION §0.3 et **signale-la** ; ne modifie jamais un fichier `.sql` généré de `packages/ledger-sql/`.

## Objective

Permettre la mise en liste noire manuelle d'un bracelet et sa sortie après validation par une seconde personne.

## Context

Exigences : FR-029, FR-035, SC-007. Opérations `blacklistMedia`, `requestMediaReinstatement` (WP07). SPECIFICATION §3.2, §7.8. Fonctions : `blacklist_media` (WP05), `reinstate_media(bracelet, auteur, valideur, motif)` du schéma, qui refuse auteur = valideur. Précédent : actions à deux de la mission 3. Ajoute `BlacklistModule` à `media-public.module.ts` (retouche hors carte).

**Règle de sécurité du projet (`CLAUDE.md`, C-011)** : si un point de ce lot ne peut être tenu qu'en affaiblissant la sécurité (droit plus large, contrôle retiré ou reporté, secret plus exposé, faux gardé plus longtemps), **arrête-toi sur ce point et soumets-le au porteur avant de coder** ; continue le reste. Un renforcement se fait, puis se consigne.

## Branch Strategy

Planification et merge sur `feat/bracelets-nfc`. Dépendances : WP14. L'espace de travail (worktree) est attribué par lane calculée dans `lanes.json`. Commande : `spec-kitty agent action implement WP18 --agent claude --mission bracelets-nfc-01M4TD3W`.

## Subtasks

### T076 — Mise en liste noire

- `blacklistMedia` : `SUPERVISOR` sur l'événement ou l'organisateur du bracelet ; motif obligatoire ; `blacklist_media` ; audit ; passage non permis (bracelet déjà en fin de vie) → 409.

### T077 — Sortie à deux

- Action `MEDIA_REINSTATE` enregistrée au registre : la demande (`requestMediaReinstatement`, 202) ne change rien ; à l'approbation par une **autre** personne habilitée sur la même portée, `reinstate_media(bracelet, auteur, valideur, motif)`.
- Revalidation à l'exécution : bracelet toujours `BLACKLISTED` (remplacé ou retiré entre-temps → la demande passe `FAILED` avec le motif).
- Le refus de la base (auteur = valideur) reste la dernière barrière : teste-le directement aussi.

### T078 — Tests d'intégration

- `blacklist.spec.ts` : blocage manuel puis lecture → `BLOCKED` ; demande seule sans effet ; même personne refusée ; autre personne → `ACTIVE`, historique avec auteur, valideur, motif ; bracelet remplacé entre-temps ; rôles ; isolation.

## Test Strategy

Tests demandés par la spec (pgTAP par contrainte, intégration HTTP sur vraie base, isolation à deux prestataires, preuves de sécurité). Ordre de vérification : `npm run lint`, `npm run typecheck`, `npm run reset-db -w @cashless/ledger-sql`, `npm run test:pgtap -w @cashless/ledger-sql`, puis `npm run reset-db -w @cashless/ledger-sql && npm test`. Ne jamais lancer pgTAP sur une base où Jest vient de tourner. Dans un worktree de lane, créer d'abord les liens `node_modules/@cashless/{api,contracts,ledger-sql,tag-format}`.

## Definition of Done

Lint, types et Jest verts ; aucune sortie de liste noire avec une seule personne. Chaque sous-tâche est marquée par `spec-kitty agent tasks mark-status Txxx --status done --mission bracelets-nfc-01M4TD3W`. Le compte rendu du lot liste : écarts au plan (avec leur sens : renforcement ou non), retouches hors carte, points soumis au porteur.

## Risks / Reviewer guidance

Petit lot, mais c'est un contrôle à deux : ne laisse aucune route qui appelle `reinstate_media` hors de l'action approuvée. **Règle de sécurité du projet (`CLAUDE.md`, C-011)** : si un point de ce lot ne peut être tenu qu'en affaiblissant la sécurité (droit plus large, contrôle retiré ou reporté, secret plus exposé, faux gardé plus longtemps), **arrête-toi sur ce point et soumets-le au porteur avant de coder** ; continue le reste. Un renforcement se fait, puis se consigne.
