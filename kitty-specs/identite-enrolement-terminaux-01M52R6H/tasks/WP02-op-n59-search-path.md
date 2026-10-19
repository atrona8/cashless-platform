---
work_package_id: WP02
title: 'OP-N59 : search_path des fonctions privilégiées (migration 0021)'
dependencies: []
requirement_refs:
- C-002
- FR-020
- NFR-010
planning_base_branch: feat/identite-enrolement-terminaux
merge_target_branch: feat/identite-enrolement-terminaux
branch_strategy: Planning artifacts for this mission were generated on feat/identite-enrolement-terminaux. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/identite-enrolement-terminaux unless the human explicitly redirects the landing branch.
subtasks:
- T006
- T007
- T008
- T009
phase: Phase 1 - Contrat et base
history:
- timestamp: '2026-10-19T13:30:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: packages/ledger-sql/migrations/0021_definer_search_path.sql
create_intent:
- packages/ledger-sql/migrations/0021_definer_search_path.sql
- packages/ledger-sql/tests/tests_definer_search_path.sql
execution_mode: code_change
owned_files:
- packages/ledger-sql/migrations/0021_definer_search_path.sql
- packages/ledger-sql/tests/tests_definer_search_path.sql
- packages/ledger-sql/tests/tests_definer_trigger_writers.sql
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP02 – OP-N59 : search_path des fonctions privilégiées (migration 0021)

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan`. Lis ensuite `README.md` (kit), `docs/SPECIFICATION.md` (sections citées ci-dessous), puis `kitty-specs/identite-enrolement-terminaux-01M52R6H/spec.md`, `plan.md`, `research.md`, `data-model.md` et les contrats cités. En cas de contradiction entre sources, applique la règle de priorité de SPECIFICATION §0.3 et **signale-la** ; ne modifie jamais un fichier `.sql` généré de `packages/ledger-sql/` (passe par les générateurs `gen_tests.py`, `gen_golden.py`).

## Objective

Lever la partie « fonctions » d'OP-N59 (bloque la production, ADR-96) : toute fonction `SECURITY DEFINER` du schéma `public` fixe `search_path = public, pg_temp`, pour qu'une table temporaire de l'appelant ne puisse plus masquer une table de la base. Le retrait du droit `TEMPORARY` (seconde barrière) est fait par WP07 dans `post-roles.sql`.

## Context

Exigences : FR-020, NFR-010 ; `contracts/database-debts.md` ; `research.md` R-11 ; `docs/POINTS_OUVERTS.md` OP-N59 ; ADR-96. Les `tenant_of_*` (`tenant_of_ledger`, `tenant_of_media`, `tenant_of_wallet`, `tenant_of_batch`, `tenant_of_event`, `tenant_of_device`, `tenant_of_gateway`, schéma de référence) fixent `SET search_path = public` sans `pg_temp`. La section 4 de `tests/tests_definer_trigger_writers.sql` fige aujourd'hui « au plus 77 ».

**Règle de sécurité du projet (`CLAUDE.md`, C-011, C-012)** : si un point de ce lot ne peut être tenu qu'en affaiblissant la sécurité (droit plus large, contrôle retiré ou reporté, secret plus exposé, faux gardé plus longtemps), **arrête-toi sur ce point et soumets-le au porteur avant de coder**, avec le risque et les options ; continue le reste. Un renforcement se fait, puis se consigne dans le compte rendu du lot.

## Branch Strategy

Planification et merge sur `feat/identite-enrolement-terminaux`. Dépendances : aucune. L'espace de travail (worktree) est attribué par lane calculée dans `lanes.json`. Commande : `spec-kitty agent action implement WP02 --agent claude --mission identite-enrolement-terminaux-01M52R6H`.

## Subtasks

### T006 — Migration 0021

- `migrations/0021_definer_search_path.sql` : bloc `DO` qui parcourt `pg_proc` (`pronamespace = 'public'::regnamespace AND prosecdef`) et exécute, pour chaque fonction, `ALTER FUNCTION <regprocedure> SET search_path = public, pg_temp` (`format('%s', p.oid::regprocedure)`). Ne touche pas aux fonctions des extensions (`pg_depend` avec `deptype = 'e'` : exclues).
- Commentaire d'en-tête : OP-N59, ADR-96, pourquoi `pg_temp` en **dernier** (sinon il est cherché en premier implicitement), et le rappel que toute migration future qui crée ou remplace une fonction `SECURITY DEFINER` doit fixer `search_path` elle-même (un `CREATE OR REPLACE` efface le réglage).
- Migration rejouable (le runner l'applique une seule fois ; le bloc lui-même est idempotent).

### T007 — Suite `tests_definer_search_path.sql`

- pgTAP écrit à la main, sur le modèle des suites existantes (en-tête « Lancer : … »).
- Pour chaque `tenant_of_*` : sous un rôle de test qui peut créer une table temporaire (rôle de test de la suite, pas un rôle `cashless_*`, puisque WP07 leur retire `TEMPORARY`), crée `pg_temp.<table lue>` avec une ligne qui renverrait un autre prestataire, appelle la fonction, et vérifie qu'elle rend le prestataire réel.
- Contrôle de catalogue : 0 fonction `SECURITY DEFINER` de `public` (hors extensions) dont `proconfig` ne contient pas un `search_path` finissant par `pg_temp`. Ce test doit tourner **après** toutes les migrations et `post-roles.sql` (il est dans `tests/`, lancé après `reset-db`).

### T008 — Borne §4 inversée

Dans `tests_definer_trigger_writers.sql` section 4 : remplace « au plus 77 » par « 0 » et réécris le commentaire (OP-N59 levée par la mission 5a, migration 0021). Garde intactes les assertions OP-N60 de la même section.

### T009 — Suites de référence et rejouabilité

`reset-db` puis toutes les suites pgTAP, dont `tests_grand_livre_cashless.sql` et `scenario_reference_test.sql`. Si une suite de référence vérifie la valeur exacte de `proconfig` d'une fonction, la contradiction est signalée au porteur (§0.3) avant tout choix.

## Test Strategy

Tests demandés par la spec (pgTAP par contrainte et par refus, intégration HTTPS sur vraie base, isolation à deux prestataires, preuves de sécurité). Ordre de vérification : `npm run lint`, `npm run typecheck`, `npm run reset-db -w @cashless/ledger-sql`, `npm run test:pgtap -w @cashless/ledger-sql`, puis `npm run reset-db -w @cashless/ledger-sql && npm test -w @cashless/api -- --runInBand`. Ne jamais lancer pgTAP sur une base où Jest vient de tourner (rejouer `reset-db` entre les deux). Dans un worktree de lane, créer d'abord les liens `node_modules/@cashless/{api,contracts,ledger-sql,tag-format}` (worktrees sans `node_modules`). La base locale est en Docker : son horloge peut reculer ; aucun test ne compare l'heure de Node à `now()` de la base sans marge.

## Definition of Done

`npm run reset-db -w @cashless/ledger-sql && npm run test:pgtap -w @cashless/ledger-sql` vert, suites de référence comprises. Chaque sous-tâche est marquée par `spec-kitty agent tasks mark-status Txxx --status done --mission identite-enrolement-terminaux-01M52R6H`. Le compte rendu du lot liste : écarts au plan (avec leur sens : renforcement ou non), retouches hors carte (avec une ligne de justification), points soumis au porteur, fichiers à faire relire par une personne (clés, droits de la base, cryptographie).

## Risks / Reviewer guidance

Le relecteur vérifie que la migration n'a pas une liste figée (une fonction oubliée), que les fonctions d'extension sont exclues, et que le test de catalogue échouerait si une fonction future oubliait `pg_temp`.
