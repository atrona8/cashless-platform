---
work_package_id: WP01
title: 'Intégrité de la configuration en base (migration 0007)'
dependencies: []
requirement_refs:
- FR-007
- FR-008
- FR-009
- FR-012
- FR-014
- FR-015
planning_base_branch: feat/configuration-parties-evenements
merge_target_branch: feat/configuration-parties-evenements
branch_strategy: Planning artifacts for this mission were generated on feat/configuration-parties-evenements. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/configuration-parties-evenements unless the human explicitly redirects the landing branch.
subtasks:
- T001
- T002
- T003
- T004
- T005
phase: 'Phase 1 - Base de données'
history:
- timestamp: '2026-10-09T15:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: packages/ledger-sql/migrations/0007_configuration.sql
create_intent:
- packages/ledger-sql/migrations/0007_configuration.sql
- packages/ledger-sql/tests/tests_configuration.sql
execution_mode: code_change
owned_files:
- packages/ledger-sql/migrations/0007_configuration.sql
- packages/ledger-sql/tests/tests_configuration.sql
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP01 – Intégrité de la configuration en base (migration 0007)

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan`. Lis `kitty-specs/configuration-parties-evenements-01M4GCJ9/spec.md`, `plan.md`, `research.md`, `data-model.md`, `contracts/`, puis en particulier : `research.md` R-04 à R-06, X-4, X-5 ; `data-model.md` (Migration 0007, Immuabilité, Cohérence `fee_rule`) ; le schéma de référence (tables `party`, `event`, `contract`, `config_version`, `merchant_participation`, `point_of_sale`, `fee_rule`, `jurisdiction_profile`, politiques RLS de la section 15/16) ; `packages/ledger-sql/migrations/0003_identity.sql` (style des gardes et des codes d'erreur).

## Objective

Durcir en base les tables de configuration déjà présentes : colonnes manquantes (X-4, X-5), immuabilité des objets versionnés, cohérence des références et bornes de la législation, chaque contrainte prouvée par pgTAP.

## Context

Exigences : FR-007, FR-008, FR-009, FR-012, FR-014, FR-015 (partie base), C-002, C-003, C-004. Ne jamais modifier le schéma de référence ni les `.sql` générés : uniquement la migration `0007`. Aucun nom de rôle dans la migration (une base neuve n'a pas encore `cashless_app` à ce stade).

## Branch Strategy

Planification et merge sur `feat/configuration-parties-evenements`. Dépendances : aucune. L'espace de travail (worktree) est attribué par lane calculée dans `lanes.json`. Commande : `spec-kitty agent action implement WP01 --agent claude`.

## Subtasks

### T001 — Colonnes d'événement et de participation, table des devises

- `event.issuer text NOT NULL DEFAULT 'ORGANIZER' CHECK (issuer IN ('ORGANIZER','OPERATOR'))`.
- `event.funds_holder_party_id uuid REFERENCES party(id)` +
  `CHECK ((funds_holder = 'THIRD_PARTY') = (funds_holder_party_id IS NOT NULL))`.
- `merchant_participation.pitch_fee bigint NOT NULL DEFAULT 0 CHECK (pitch_fee >= 0)`,
  `pitch_fee_reference text`, `CHECK (pitch_fee_mode <> 'PREPAID' OR pitch_fee = 0 OR pitch_fee_reference IS NOT NULL)`.
- Table `currency_exponent (code char(3) PRIMARY KEY CHECK (code ~ '^[A-Z]{3}$'), exponent smallint NOT NULL CHECK
  (exponent BETWEEN 0 AND 4))` remplie avec XOF 0, XAF 0, EUR 2, USD 2 ; lisible de tous (pas de RLS : donnée de
  référence) ; écriture réservée au propriétaire (droits posés par WP03 dans `post-roles.sql`).
- Les colonnes ajoutées sont nommées dans le commentaire de tête de la migration avec la contradiction X-4 / X-5.

### T002 — Gardes de cohérence des références

- Déclencheur `event_references_guard` (BEFORE INSERT OR UPDATE OF organizer_id, contract_id, funds_holder_party_id,
  jurisdiction_id, currency) : organisateur = partie `ORGANIZER` du même `operator_id` ; `contract_id` NULL ou contrat
  `OPERATOR_ORGANIZER` dont `counterparty_id` = organisateur et `operator_id` identique ; `funds_holder_party_id` =
  partie `THIRD_PARTY` du même prestataire ; `currency` présente dans `currency_exponent`. Erreur `CL001` avec un
  message court et neutre (pas de donnée d'un autre prestataire).
- Déclencheur `participation_guard` (BEFORE INSERT OR UPDATE) : commerçant = partie `MERCHANT` du même prestataire ;
  événement non `CLOSED` ; `payout_to` = organisateur de l'événement si `INTERNAL`, = commerçant si `EXTERNAL`
  (le déclencheur **pose** `payout_to` à l'insertion si absent, et refuse une valeur incohérente).
- `point_of_sale` : `participation_id`, `operator_id` immuables (seul `name` change) ; `operator_id` = celui de la
  participation.
- `fee_rule` : `scope_id` cohérent avec `scope_type` (contrat du bon type, événement, participation), même
  `operator_id` que l'objet (NULL seulement pour `PLATFORM_CONTRACT`… attention : une règle `PLATFORM_CONTRACT` a
  l'`operator_id` du prestataire du contrat — voir `data-model.md`) ; `rate_bps BETWEEN 0 AND 10000`, montants ≥ 0,
  `min_amount <= max_amount`.

### T003 — Immuabilité des objets versionnés

- `contract`, `config_version`, `jurisdiction_profile` : déclencheur BEFORE UPDATE OR DELETE qui refuse toujours
  (`CL001`, « … ne se modifie pas : créer une nouvelle version »).
- `contract` : `UNIQUE (operator_id, kind, counterparty_id, version)` ; à l'insertion, `version` = 1 s'il n'existe
  aucun contrat de ce triplet, sinon = max + 1, et `valid_from >=` celle de la version précédente (déclencheur).
- `config_version` : à l'insertion, `version` = max + 1 pour `(scope_type, scope_id)` (1 si aucune) ; `valid_from`
  ≥ celle de la précédente.
- `fee_rule` : DELETE refusé ; UPDATE permis seulement de `valid_to` NULL → date ≥ `valid_from` (toute autre colonne
  modifiée ou `valid_to` déjà posé : refus) ; `UNIQUE (scope_type, scope_id, payer_purpose, beneficiary_purpose,
  basis, version)`.

### T004 — Borne de la législation sur l'événement

- Déclencheur `event_jurisdiction_bounds` (BEFORE INSERT OR UPDATE OF refund_deadline, ends_at, starts_at,
  jurisdiction_id) : `ends_at >= starts_at` si les deux sont posés ; si `refund_deadline` et `ends_at` sont posés et
  que le profil a `min_refund_window_days`, `refund_deadline >= ends_at + min_refund_window_days`. Erreur `CL001`,
  message qui nomme la règle (`jurisdiction.min_refund_window_days`) sans texte SQL.
- Ne pas toucher `event_status_guard` (statut seulement par `set_event_status`).

### T005 — Tests pgTAP `tests/tests_configuration.sql`

- Une assertion (au moins) par contrainte et par déclencheur de T001-T004, positive et négative, exécutées sous le
  rôle `cashless_app` quand c'est lui qui écrira (avec `set_config('app.operator_id', …, true)`) et sous le
  propriétaire pour la mise en place.
- Commence par `BEGIN; SELECT plan(n);` et finit par `SELECT * FROM finish(); ROLLBACK;` (style des suites de la
  mission 2). Les parties et l'événement de test sont créés par le propriétaire en tête de suite.
- La suite de référence (400) et le scénario (64) restent verts : lancer `npm run test:pgtap -w @cashless/ledger-sql`
  sur une base remise à zéro.

## Test Strategy

Tests demandés par la spec (pgTAP par contrainte, isolation à deux prestataires, intégration sur la base locale). Ordre de vérification : `npm run lint`, `npm run typecheck`, `npm run reset-db -w @cashless/ledger-sql`, `npm run test:pgtap -w @cashless/ledger-sql`, `npm run reset-db -w @cashless/ledger-sql && npm test`.

## Definition of Done

`npm run reset-db -w @cashless/ledger-sql` applique `0007` ; `npm run test:pgtap -w @cashless/ledger-sql` vert (suites existantes + `tests_configuration.sql`) ; `npm test` reste vert (le rejeu du scénario insère `event` et `merchant_participation` par fixture : vérifier qu'il passe les nouveaux déclencheurs, adapter la fixture **seulement** si une donnée de la fixture est réellement incohérente, et le signaler).

## Risks / Reviewer guidance

Le rejeu du scénario (`apps/api/test/scenario/fixture.ts`) crée ses objets en propriétaire : un déclencheur trop strict casse la suite de référence de la mission 1. Les déclencheurs doivent valider les données réelles du scénario. `scenario_reference_test.sql` est généré : ne jamais le modifier ; s'il casse, c'est la migration qu'il faut corriger.
