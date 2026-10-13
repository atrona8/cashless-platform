---
work_package_id: WP12
title: 'Résolveur de configuration réel et rejeu du scénario sur une configuration construite par l''API'
dependencies:
- WP11
requirement_refs:
- FR-016
planning_base_branch: feat/configuration-parties-evenements
merge_target_branch: feat/configuration-parties-evenements
branch_strategy: Planning artifacts for this mission were generated on feat/configuration-parties-evenements. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/configuration-parties-evenements unless the human explicitly redirects the landing branch.
subtasks:
- T050
- T051
- T052
- T053
phase: 'Phase 4 - Moteur'
history:
- timestamp: '2026-10-09T15:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: apps/api/src/configuration/sql-config-resolver.ts
create_intent:
- apps/api/src/configuration/sql-config-resolver.ts
- apps/api/src/configuration/config-resolver.module.ts
- apps/api/test/integration/configuration/sql-config-resolver.spec.ts
- apps/api/test/scenario/api-config-replay.spec.ts
- apps/api/test/scenario/api-config-fixture.ts
execution_mode: code_change
owned_files:
- apps/api/src/configuration/sql-config-resolver.ts
- apps/api/src/configuration/config-resolver.module.ts
- apps/api/test/integration/configuration/sql-config-resolver.spec.ts
- apps/api/test/scenario/api-config-replay.spec.ts
- apps/api/test/scenario/api-config-fixture.ts
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP12 – Résolveur de configuration réel et rejeu du scénario sur une configuration construite par l'API

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan`. Lis `kitty-specs/configuration-parties-evenements-01M4GCJ9/spec.md`, `plan.md`, `research.md`, `data-model.md`, `contracts/`, puis en particulier : `research.md` R-10 ; `apps/api/src/ledger/ports/config-resolver.ts`, `ledger/types.ts` (`ResolvedConfig`), `ledger/money/fee.ts` (`FeeRule`), `ledger/ledger.module.ts`, `ledger-engine.service.ts` ; `apps/api/test/scenario/*` (fixture, `scenario-config.ts`, `replay.spec.ts`) ; `test/unit/builders/support/scenario-lines.ts` ; `scenario_reference.json` (paramètres).

## Objective

Remplacer les fixtures du port `ConfigResolver` par une implémentation qui lit la configuration réelle, et prouver qu'elle redonne exactement la configuration du scénario de référence.

## Context

Exigences : FR-016, SC-004. Les constructeurs et le moteur ne changent pas ; seul le fournisseur du port change. Le rejeu par fixture de la mission 1 reste en place (il est la référence de comparaison).

## Branch Strategy

Planification et merge sur `feat/configuration-parties-evenements`. Dépendances : WP11. L'espace de travail (worktree) est attribué par lane calculée dans `lanes.json`. Commande : `spec-kitty agent action implement WP12 --agent claude`.

## Subtasks

### T050 — `SqlConfigResolver`

- `resolve({ ledgerId, eventId, occurredAt, participationId })` : événement du grand livre, configuration résolue à
  `occurredAt` (service de WP06), contrat en vigueur, profil de législation, règles valides à cette date ; construit
  `ResolvedConfig` : `parties`, `configVersionId` (version `EVENT` en vigueur), `taxBps` (`rules.taxes`),
  `commissions` (règles `PARTICIPATION`, clé = participation), `pspFees`, `activationFee`, `refundFee`,
  `operatorFees` (règles `OPERATOR_CONTRACT`), `platformFee` (`PLATFORM_CONTRACT`), `breakageOrganizerBps`,
  `pitchFees` (`merchant_participation.pitch_fee`), `spendOrder`, `pspFeeBearer`, porteurs du contrat,
  `breakageDestination` ; chaque `FeeRule` porte son `id` (pour `posting.fee_rule_id`).
- Règle absente alors qu'un constructeur en a besoin : erreur explicite (`VALIDATION_FAILED`, « règle de frais
  manquante : … »), jamais un zéro silencieux.

### T051 — Fourniture au moteur

- `ConfigResolverModule` fournit `CONFIG_RESOLVER` = `SqlConfigResolver` au `LedgerModule` dans l'application
  (`app.module.ts` : une ligne, justifiée) ; les tests du moteur qui injectent une fixture restent inchangés.

### T052 — Rejeu du scénario sur une configuration construite par l'API

- `api-config-fixture.ts` : construit **par les routes de l'API** (faux serveur d'identité, personnes amorcées) le
  profil, le prestataire, les contrats, l'organisateur, l'événement, les participations et les règles de frais
  équivalents aux paramètres de `scenario_reference.json` ; bracelets, portefeuilles et caisses restent posés comme
  dans la fixture de la mission 1 (missions futures).
- `api-config-replay.spec.ts` : rejoue les 48 transactions avec `SqlConfigResolver` ; soldes après T23 et en fin de
  clôture identiques au rejeu par fixture ; chaque ligne de frais a un `fee_rule_id` non nul ; chaque transaction a
  un `config_version_id` non nul ; second rejeu sans effet.

### T053 — Tests unitaires et d'intégration du résolveur

- Résolution à deux dates encadrant un remplacement de règle ; participation absente ; règle manquante ;
  `configVersionId` = version en vigueur à la date.

## Test Strategy

Tests demandés par la spec (pgTAP par contrainte, isolation à deux prestataires, intégration sur la base locale). Ordre de vérification : `npm run lint`, `npm run typecheck`, `npm run reset-db -w @cashless/ledger-sql`, `npm run test:pgtap -w @cashless/ledger-sql`, `npm run reset-db -w @cashless/ledger-sql && npm test`.

## Definition of Done

`npm test` vert, rejeu du scénario par fixture **et** par configuration construite par l'API, soldes identiques ; `lint`, `typecheck` verts.

## Risks / Reviewer guidance

Une différence d'une unité révèle une règle mal traduite (taux en points de base, TTC, minimum/maximum) : comparer règle par règle avec `scenarioConfig()` avant de chercher ailleurs. Ne jamais ajuster le scénario pour faire passer le test.
