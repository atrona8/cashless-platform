---
work_package_id: WP06
title: Rôles de base des processus et retraits à l'API publique (`post-roles.sql`)
dependencies:
- WP05
requirement_refs:
- FR-006
- FR-016
- FR-018
planning_base_branch: feat/bracelets-nfc
merge_target_branch: feat/bracelets-nfc
branch_strategy: Planning artifacts for this mission were generated on feat/bracelets-nfc. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/bracelets-nfc unless the human explicitly redirects the landing branch.
subtasks:
- T022
- T023
- T024
- T025
phase: Phase 1 - Socle
history:
- timestamp: '2026-10-13T12:05:28Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: packages/ledger-sql/post-roles.sql
create_intent: []
execution_mode: code_change
owned_files:
- packages/ledger-sql/post-roles.sql
- packages/ledger-sql/src/migrate.ts
- packages/ledger-sql/tests/tests_media_roles.sql
- tools/dev-db/env.sh
- tools/dev-db/env.test.example
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP06 – Rôles de base des processus et retraits à l'API publique (`post-roles.sql`)

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan`. Lis ensuite `README.md` (kit), `docs/SPECIFICATION.md` (sections citées ci-dessous), puis `kitty-specs/bracelets-nfc-01M4TD3W/spec.md`, `plan.md`, `research.md`, `data-model.md` et les contrats cités. En cas de contradiction entre sources, applique la règle de priorité de SPECIFICATION §0.3 et **signale-la** ; ne modifie jamais un fichier `.sql` généré de `packages/ledger-sql/`.

## Objective

Créer les quatre rôles de base des processus des clés et retirer à `cashless_app` la lecture des secrets chiffrés.

## Context

Exigences : NFR-004, NFR-005, décision de plan 2. Recherche : R-02 (à lire en entier). Modèle : `data-model.md` (rôles de base). Précédent à suivre pas à pas : le rôle `cashless_platform` de la mission 3 dans `post-roles.sql`, `src/migrate.ts` et `tests/tests_platform_scope.sql`. `roles.sql` est un fichier du kit : **jamais modifié** ; il redonne tous les droits à `cashless_app` à chaque rejeu, donc tout retrait se fait dans `post-roles.sql`, appliqué après.

**Règle de sécurité du projet (`CLAUDE.md`, C-011)** : si un point de ce lot ne peut être tenu qu'en affaiblissant la sécurité (droit plus large, contrôle retiré ou reporté, secret plus exposé, faux gardé plus longtemps), **arrête-toi sur ce point et soumets-le au porteur avant de coder** ; continue le reste. Un renforcement se fait, puis se consigne.

## Branch Strategy

Planification et merge sur `feat/bracelets-nfc`. Dépendances : WP05. L'espace de travail (worktree) est attribué par lane calculée dans `lanes.json`. Commande : `spec-kitty agent action implement WP06 --agent claude --mission bracelets-nfc-01M4TD3W`.

## Subtasks

### T022 — Rôles et mots de passe

- Rôles `cashless_tagkeys`, `cashless_perso`, `cashless_tagcheck`, `cashless_keyadmin` : `LOGIN`, `NOBYPASSRLS`, sans héritage ; création idempotente ; mots de passe par `migrate.ts` à partir de `CASHLESS_TAGKEYS_PASSWORD`, `CASHLESS_PERSO_PASSWORD`, `CASHLESS_TAGCHECK_PASSWORD`, `CASHLESS_KEYADMIN_PASSWORD` (obligatoires en production, valeurs locales par défaut ailleurs, comme pour `cashless_platform`).
- `tools/dev-db/env.sh` et `env.test.example` : variables et URL `DATABASE_URL_TAGKEYS`, `_PERSO`, `_TAGCHECK`, `_KEYADMIN`.

### T023 — Droits de chaque rôle

- Droits remis à zéro puis accordés un par un, selon le tableau de `data-model.md`. Par table : politique permissive et politique **restrictive** bornant le rôle à ce tableau (modèle `platform_read` / `_bound`).
- Aucun des quatre rôles n'a de droit sur `journal_transaction`, `posting`, `account_balance` ; ils écrivent dans `audit_log` par la fonction de la mission 2.
- `EXECUTE` : accordé seulement sur les fonctions utiles à chaque rôle ; note la limite connue (ADR-80 : `EXECUTE` hérité de `PUBLIC` sur les fonctions du schéma de référence) et teste que les politiques RLS l'empêchent d'agir hors de son périmètre.

### T024 — Retraits à `cashless_app`

- `REVOKE SELECT, INSERT, UPDATE ON media FROM cashless_app` puis `GRANT SELECT (colonnes non secrètes)` et `GRANT UPDATE (colonnes non secrètes)` : tout sauf `pwd_pack_enc`, `pwd_pack_dek_id`. La liste des colonnes est **générée** dans le script à partir du catalogue (toutes les colonnes moins les secrètes), pour qu'une colonne ajoutée plus tard ne soit pas oubliée.
- `tag_data_key` : `SELECT` sans `encrypted_dek` ; pas d'`INSERT` ni d'`UPDATE`. `tag_key` : pas d'`INSERT` ; `REVOKE ALL ON offline_snapshot_rows FROM cashless_app`.
- Vérifie que rien dans `apps/api` (missions 1 à 3) ne lit ces colonnes ni ne fait `SELECT *` sur `media` : `grep`, puis la suite Jest complète. Si un test de **référence** exigeait l'accès de `cashless_app`, il prime (§0.3) : arrête-toi et soumets la limite au porteur (C-011).

### T025 — Tests pgTAP

- `tests/tests_media_roles.sql`, avec `SET LOCAL SESSION AUTHORIZATION` par rôle : `cashless_app` ne lit ni `pwd_pack_enc` ni `encrypted_dek` ni la vue de snapshot, et n'insère pas dans `media` ; chaque rôle des clés lit et écrit exactement son tableau ; aucun n'atteint le grand livre ; isolation par prestataire pour chacun.
- Rejoue deux fois migrations et rôles sur la même base : idempotent.

## Test Strategy

Tests demandés par la spec (pgTAP par contrainte, intégration HTTP sur vraie base, isolation à deux prestataires, preuves de sécurité). Ordre de vérification : `npm run lint`, `npm run typecheck`, `npm run reset-db -w @cashless/ledger-sql`, `npm run test:pgtap -w @cashless/ledger-sql`, puis `npm run reset-db -w @cashless/ledger-sql && npm test`. Ne jamais lancer pgTAP sur une base où Jest vient de tourner. Dans un worktree de lane, créer d'abord les liens `node_modules/@cashless/{api,contracts,ledger-sql,tag-format}`.

## Definition of Done

pgTAP vert sur base neuve et sur base rejouée ; Jest des missions 1 à 3 vert ; connexion réelle réussie sous chacun des quatre rôles. Chaque sous-tâche est marquée par `spec-kitty agent tasks mark-status Txxx --status done --mission bracelets-nfc-01M4TD3W`. Le compte rendu du lot liste : écarts au plan (avec leur sens : renforcement ou non), retouches hors carte, points soumis au porteur.

## Risks / Reviewer guidance

C'est le lot le plus sensible côté base : relis chaque `GRANT`. Un droit de trop sur `cashless_app` annule la seconde barrière ; un droit de trop sur `cashless_perso` ouvre le grand livre à un poste d'atelier.
