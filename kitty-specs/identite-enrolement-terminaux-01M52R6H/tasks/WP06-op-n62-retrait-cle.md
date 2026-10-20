---
work_package_id: WP06
title: "OP-N62 : retrait d'une clé dédiée et demandes approuvées périmées (migration 0025)"
dependencies: []
requirement_refs:
- C-010
- FR-024
planning_base_branch: feat/identite-enrolement-terminaux
merge_target_branch: feat/identite-enrolement-terminaux
branch_strategy: Planning artifacts for this mission were generated on feat/identite-enrolement-terminaux. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/identite-enrolement-terminaux unless the human explicitly redirects the landing branch.
subtasks:
- T025
- T026
- T027
- T028
phase: Phase 1 - Contrat et base
history:
- timestamp: '2026-10-19T13:30:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: packages/ledger-sql/migrations/0025_tag_key_retire_guard.sql
create_intent:
- packages/ledger-sql/migrations/0025_tag_key_retire_guard.sql
- packages/ledger-sql/tests/tests_tag_key_retire_guard.sql
execution_mode: code_change
owned_files:
- packages/ledger-sql/migrations/0025_tag_key_retire_guard.sql
- packages/ledger-sql/tests/tests_tag_key_retire_guard.sql
- apps/api/src/media/keys/dek.worker.ts
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP06 – OP-N62 : retrait d'une clé dédiée et demandes approuvées périmées (migration 0025)

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan`. Lis ensuite `README.md` (kit), `docs/SPECIFICATION.md` (sections citées ci-dessous), puis `kitty-specs/identite-enrolement-terminaux-01M52R6H/spec.md`, `plan.md`, `research.md`, `data-model.md` et les contrats cités. En cas de contradiction entre sources, applique la règle de priorité de SPECIFICATION §0.3 et **signale-la** ; ne modifie jamais un fichier `.sql` généré de `packages/ledger-sql/` (passe par les générateurs `gen_tests.py`, `gen_golden.py`).

## Objective

Lever OP-N62 (ADR-102) : le retrait d'une clé dédiée n'est plus possible sans un travail `RETIRE_KEY` en cours issu d'une demande exécutée, et une demande de clé approuvée mais expirée est refusée.

## Context

Exigences : FR-024, C-010 ; `contracts/database-debts.md` ; `research.md` R-11 ; `docs/POINTS_OUVERTS.md` OP-N62 ; ADR-102. Migration 0020 (`enqueue_tag_key_job`, `enqueue_tag_key_child_job`, droits de `retire_dedicated_key`). Appel actuel : `apps/api/src/media/keys/dek.worker.ts` (~ligne 101, `SELECT retire_dedicated_key($1, $2)`). **Ne rouvre pas `INSERT` sur `tag_key_job`.** Les droits d'exécution par rôle sont posés par WP07 (`post-roles.sql`) : indique-lui dans le compte rendu que `retire_dedicated_key` ne doit plus être accordée à `cashless_perso` et que `retire_dedicated_key_for_job` doit l'être. Les bornes de `tests_tag_key_job_approval.sql` (§6, §7) sont inversées par WP07.

**Règle de sécurité du projet (`CLAUDE.md`, C-011, C-012)** : si un point de ce lot ne peut être tenu qu'en affaiblissant la sécurité (droit plus large, contrôle retiré ou reporté, secret plus exposé, faux gardé plus longtemps), **arrête-toi sur ce point et soumets-le au porteur avant de coder**, avec le risque et les options ; continue le reste. Un renforcement se fait, puis se consigne dans le compte rendu du lot.

## Branch Strategy

Planification et merge sur `feat/identite-enrolement-terminaux`. Dépendances : aucune. L'espace de travail (worktree) est attribué par lane calculée dans `lanes.json`. Commande : `spec-kitty agent action implement WP06 --agent claude --mission identite-enrolement-terminaux-01M52R6H`.

## Subtasks

### T025 — `retire_dedicated_key_for_job`

`retire_dedicated_key_for_job(p_job uuid) RETURNS …` (`SECURITY DEFINER`, `search_path = public, pg_temp`) : le travail existe, est de sorte `RETIRE_KEY`, en `RUNNING`, issu d'une demande d'approbation `EXECUTED` du même prestataire et de la même clé ; sinon refus (`CL` nommé) ; puis appelle `retire_dedicated_key` avec les paramètres du travail. `REVOKE ALL … FROM PUBLIC`.

### T026 — Demande expirée refusée

`CREATE OR REPLACE` de `enqueue_tag_key_job` (et de `enqueue_tag_key_child_job` si elle lit la même demande) : une demande `APPROVED` dont `expires_at < now()` est refusée avec `CL023`. Reprends le corps de 0020 à l'identique hors cette garde ; conserve `search_path = public, pg_temp`.

### T027 — Appel de la personnalisation

Dans `dek.worker.ts`, remplace `retire_dedicated_key($1, $2)` par `retire_dedicated_key_for_job($1)` (identifiant du travail) ; adapte les tests d'intégration existants qui couvrent le retrait si besoin (fichiers de `test/integration/media/` : retouche hors carte autorisée, à consigner).

### T028 — Suite `tests_tag_key_retire_guard.sql`

Appel direct sans travail refusé ; travail d'une autre sorte, d'un autre prestataire, non `RUNNING`, ou dont la demande n'est pas `EXECUTED` → refusé ; chemin nominal accepté ; demande approuvée expirée → `CL023` ; demande approuvée non expirée → accepté.

## Test Strategy

Tests demandés par la spec (pgTAP par contrainte et par refus, intégration HTTPS sur vraie base, isolation à deux prestataires, preuves de sécurité). Ordre de vérification : `npm run lint`, `npm run typecheck`, `npm run reset-db -w @cashless/ledger-sql`, `npm run test:pgtap -w @cashless/ledger-sql`, puis `npm run reset-db -w @cashless/ledger-sql && npm test -w @cashless/api -- --runInBand`. Ne jamais lancer pgTAP sur une base où Jest vient de tourner (rejouer `reset-db` entre les deux). Dans un worktree de lane, créer d'abord les liens `node_modules/@cashless/{api,contracts,ledger-sql,tag-format}` (worktrees sans `node_modules`). La base locale est en Docker : son horloge peut reculer ; aucun test ne compare l'heure de Node à `now()` de la base sans marge.

## Definition of Done

`reset-db` puis toutes les suites pgTAP vertes ; tests d'intégration des clés (`test/integration/media/keys.spec.ts`, `data-keys.spec.ts`) verts. Chaque sous-tâche est marquée par `spec-kitty agent tasks mark-status Txxx --status done --mission identite-enrolement-terminaux-01M52R6H`. Le compte rendu du lot liste : écarts au plan (avec leur sens : renforcement ou non), retouches hors carte (avec une ligne de justification), points soumis au porteur, fichiers à faire relire par une personne (clés, droits de la base, cryptographie).

## Risks / Reviewer guidance

Le relecteur vérifie que `INSERT` sur `tag_key_job` reste fermé et que le corps recopié d'`enqueue_tag_key_job` ne diffère de 0020 que par la garde d'expiration.

## Compte rendu du lot WP06

Écarts au plan
- Renforcement : la garde d'expiration lit `clock_timestamp()` et non `now()` (même référence que le défaut de
  `expires_at` et que `approval.service.ts`) ; une demande qui périme pendant une transaction longue est refusée.
- Renforcement : les contrôles de la demande sont délégués à `tag_key_job_refusal` (0020), qui vérifie aussi le
  résultat, l'index, l'auteur et le valideur.
- Neutre : `enqueue_tag_key_child_job` inchangée (elle n'accepte qu'une demande EXECUTED, déjà consommée à temps).

Retouches hors carte (`post-roles.sql`, fichier de WP07)
- `GRANT EXECUTE` de `retire_dedicated_key_for_job` à `cashless_perso` (sans elle, le travailleur échouait en 42501
  avant WP07) ; `REVOKE` de cette fonction à `cashless_app` (accordée par `roles.sql`, détecté par le test).

Limite connue jusqu'à WP07 : `cashless_perso` garde l'EXECUTE direct sur `retire_dedicated_key` (OP-N62, comme prévu au
plan, non élargie) ; `tests_tag_key_job_approval.sql` s'arrête au §6 (ancienne borne), WP07 l'inverse.

Fichiers à faire relire par une personne : `packages/ledger-sql/migrations/0025_tag_key_retire_guard.sql`,
`packages/ledger-sql/post-roles.sql`.
