---
work_package_id: WP05
title: 'OP-N50 : consume_tap refuse une lecture de rattachement (migration 0024)'
dependencies: []
requirement_refs:
- FR-022
- NFR-010
planning_base_branch: feat/identite-enrolement-terminaux
merge_target_branch: feat/identite-enrolement-terminaux
branch_strategy: Planning artifacts for this mission were generated on feat/identite-enrolement-terminaux. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/identite-enrolement-terminaux unless the human explicitly redirects the landing branch.
subtasks:
- T021
- T022
- T023
- T024
phase: Phase 1 - Contrat et base
history:
- timestamp: '2026-10-19T13:30:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: packages/ledger-sql/migrations/0024_consume_tap_claim.sql
create_intent:
- packages/ledger-sql/migrations/0024_consume_tap_claim.sql
- packages/ledger-sql/tests/tests_consume_tap_claim.sql
execution_mode: code_change
owned_files:
- packages/ledger-sql/migrations/0024_consume_tap_claim.sql
- packages/ledger-sql/tests/tests_consume_tap_claim.sql
- packages/ledger-sql/tests/tests_media_claim_tap.sql
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP05 – OP-N50 : consume_tap refuse une lecture de rattachement (migration 0024)

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan`. Lis ensuite `README.md` (kit), `docs/SPECIFICATION.md` (sections citées ci-dessous), puis `kitty-specs/identite-enrolement-terminaux-01M52R6H/spec.md`, `plan.md`, `research.md`, `data-model.md` et les contrats cités. En cas de contradiction entre sources, applique la règle de priorité de SPECIFICATION §0.3 et **signale-la** ; ne modifie jamais un fichier `.sql` généré de `packages/ledger-sql/` (passe par les générateurs `gen_tests.py`, `gen_golden.py`).

## Objective

Lever OP-N50 (décision du porteur : en 5a) : une lecture de bracelet qui a servi à confirmer une demande de rattachement (`media_claim.confirmed_tap_id`) ne peut plus servir à une écriture par `consume_tap`.

## Context

Exigences : FR-022, NFR-010 ; `contracts/database-debts.md` ; `docs/POINTS_OUVERTS.md` OP-N50 ; ADR-101. `consume_tap(p_tap bigint, p_tx uuid)` est dans le schéma de référence (ligne ~1068) ; `consume_tap_for_claim` et `media_claim.confirmed_tap_id` viennent de la migration 0016 ; `tests/tests_media_claim_tap.sql` fige aujourd'hui la limite.

**Règle de sécurité du projet (`CLAUDE.md`, C-011, C-012)** : si un point de ce lot ne peut être tenu qu'en affaiblissant la sécurité (droit plus large, contrôle retiré ou reporté, secret plus exposé, faux gardé plus longtemps), **arrête-toi sur ce point et soumets-le au porteur avant de coder**, avec le risque et les options ; continue le reste. Un renforcement se fait, puis se consigne dans le compte rendu du lot.

## Branch Strategy

Planification et merge sur `feat/identite-enrolement-terminaux`. Dépendances : aucune. L'espace de travail (worktree) est attribué par lane calculée dans `lanes.json`. Commande : `spec-kitty agent action implement WP05 --agent claude --mission identite-enrolement-terminaux-01M52R6H`.

## Subtasks

### T021 — Analyse

Lis `consume_tap` (schéma de référence), `consume_tap_for_claim` (0016) et la suite de référence qui exerce `consume_tap`. Choisis la correction la plus locale qui ne touche aucun fichier généré : (a) `consume_tap_for_claim` marque la lecture consommée de la même façon que `consume_tap` (si le schéma a une colonne de consommation, `consume_tap` la refusera alors d'elle-même), ou (b) `CREATE OR REPLACE FUNCTION consume_tap` par migration avec une garde ajoutée. Préfère (a) si elle suffit. Note le choix et sa raison dans le compte rendu.

### T022 — Migration 0024

`migrations/0024_consume_tap_claim.sql` : la correction choisie ; `search_path = public, pg_temp` sur toute fonction `SECURITY DEFINER` créée ou remplacée ; commentaire d'en-tête (OP-N50, ADR-101, mission 5a).

### T023 — Tests

`tests/tests_consume_tap_claim.sql` : lecture confirmée → `consume_tap` refusé ; lecture ordinaire → accepté ; lecture déjà consommée → refusé comme avant. Dans `tests_media_claim_tap.sql`, remplace la borne qui figeait la limite par le test de refus (ou renvoie au nouveau fichier) et mets à jour le commentaire.

### T024 — Suites de référence

`reset-db`, toutes les suites pgTAP. Si la suite de référence exige le comportement actuel, arrête-toi : contradiction à signaler (§0.3) avant tout choix.

## Test Strategy

Tests demandés par la spec (pgTAP par contrainte et par refus, intégration HTTPS sur vraie base, isolation à deux prestataires, preuves de sécurité). Ordre de vérification : `npm run lint`, `npm run typecheck`, `npm run reset-db -w @cashless/ledger-sql`, `npm run test:pgtap -w @cashless/ledger-sql`, puis `npm run reset-db -w @cashless/ledger-sql && npm test -w @cashless/api -- --runInBand`. Ne jamais lancer pgTAP sur une base où Jest vient de tourner (rejouer `reset-db` entre les deux). Dans un worktree de lane, créer d'abord les liens `node_modules/@cashless/{api,contracts,ledger-sql,tag-format}` (worktrees sans `node_modules`). La base locale est en Docker : son horloge peut reculer ; aucun test ne compare l'heure de Node à `now()` de la base sans marge.

## Definition of Done

`reset-db` puis toutes les suites pgTAP vertes, suites de référence comprises. Chaque sous-tâche est marquée par `spec-kitty agent tasks mark-status Txxx --status done --mission identite-enrolement-terminaux-01M52R6H`. Le compte rendu du lot liste : écarts au plan (avec leur sens : renforcement ou non), retouches hors carte (avec une ligne de justification), points soumis au porteur, fichiers à faire relire par une personne (clés, droits de la base, cryptographie).

## Risks / Reviewer guidance

Le relecteur vérifie qu'aucun fichier généré n'est touché et qu'une lecture ne peut pas être consommée deux fois par aucun chemin.

## Compte rendu du lot WP05

- T021, option (b) : `consume_tap` remplacé par `CREATE OR REPLACE` (SECURITY DEFINER, `search_path = public, pg_temp`,
  compatible avec 0021) ; garde `CL022` après `assert_tenant` et après le contrôle « déjà utilisé ». L'option (a)
  aurait élargi les droits de `consume_tap_for_claim` (écriture sur `media_tap`).
- Renforcement hors prompt : verrou consultatif `media-tap-use:<tap>` pris par `consume_tap` et `consume_tap_for_claim`
  (qui reste SECURITY INVOKER) ; une écriture et une demande concurrentes ne peuvent plus utiliser la même lecture
  (course antérieure à la mission). Vérifié à la main à deux sessions ; pas de test à deux connexions (dblink absent).
- `openapi.yaml` (`TAP_UNUSABLE`) à compléter : reporté dans WP18.
- Fichiers à faire relire par une personne : `packages/ledger-sql/migrations/0024_consume_tap_claim.sql`.
