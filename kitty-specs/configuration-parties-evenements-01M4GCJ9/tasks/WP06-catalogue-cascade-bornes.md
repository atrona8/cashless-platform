---
work_package_id: WP06
title: 'Catalogue des réglages, cascade versionnée, bornes et valeurs provisoires'
dependencies:
- WP01
- WP04
requirement_refs:
- FR-003
- FR-010
- FR-014
- FR-015
planning_base_branch: feat/configuration-parties-evenements
merge_target_branch: feat/configuration-parties-evenements
branch_strategy: Planning artifacts for this mission were generated on feat/configuration-parties-evenements. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/configuration-parties-evenements unless the human explicitly redirects the landing branch.
subtasks:
- T023
- T024
- T025
- T026
- T027
phase: 'Phase 2 - Socle API'
history:
- timestamp: '2026-10-09T15:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: apps/api/src/configuration/
create_intent:
- apps/api/src/configuration/settings-catalog.ts
- apps/api/src/configuration/provisional-defaults.ts
- apps/api/src/configuration/bounds-validator.ts
- apps/api/src/configuration/cascade.service.ts
- apps/api/src/configuration/messages.ts
- apps/api/src/configuration/configuration-core.module.ts
- apps/api/test/integration/configuration/cascade.spec.ts
execution_mode: code_change
owned_files:
- apps/api/src/configuration/settings-catalog.ts
- apps/api/src/configuration/provisional-defaults.ts
- apps/api/src/configuration/bounds-validator.ts
- apps/api/src/configuration/cascade.service.ts
- apps/api/src/configuration/messages.ts
- apps/api/src/configuration/configuration-core.module.ts
- apps/api/test/unit/configuration/**
- apps/api/test/integration/configuration/cascade.spec.ts
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP06 – Catalogue des réglages, cascade versionnée, bornes et valeurs provisoires

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan`. Lis `kitty-specs/configuration-parties-evenements-01M4GCJ9/spec.md`, `plan.md`, `research.md`, `data-model.md`, `contracts/`, puis en particulier : `research.md` R-05 à R-07 ; `data-model.md` (Cascade de configuration) ; `contracts/configuration.md` ; SPECIFICATION §4.1, §4.2, §9.8, §17.2 ; colonnes et CHECK d'`event` dans le schéma ; `apps/api/src/http/language.ts`, `errors/problem.ts`.

## Objective

Construire le cœur réutilisable de la configuration : ce qu'est chaque réglage, qui le règle, ses bornes, comment les niveaux se résolvent à une date, et comment un refus cite sa règle.

## Context

Exigences : FR-003, FR-010, FR-014, FR-015, NFR-005, C-006. Aucun contrôleur ici : les WP07 à WP10 s'appuient sur ces services. Le module `ConfigurationCoreModule` est global ou exporté pour eux.

## Branch Strategy

Planification et merge sur `feat/configuration-parties-evenements`. Dépendances : WP01, WP04. L'espace de travail (worktree) est attribué par lane calculée dans `lanes.json`. Commande : `spec-kitty agent action implement WP06 --agent claude`.

## Subtasks

### T023 — Catalogue des réglages

- `settings-catalog.ts` : un enregistrement par clé de §4.2 et §9.8 utile à la mission — clé, `storage`
  (`EVENT_COLUMN` + nom de colonne, ou `SETTINGS`), niveaux permis, type (énuméré, entier, montant bigint, durée,
  date, liste), bornes fixes (identiques aux CHECK du schéma), rôle qui règle (`ORGANIZER_ADMIN` ou
  `OPERATOR_ADMIN`, par niveau), défaut et sa nature (décidé / provisoire).
- Test unitaire qui compare les bornes du catalogue aux CHECK d'`event` (lecture de `information_schema` /
  `pg_constraint` en intégration, ou table attendue codée en test unitaire, au choix — documenter).

### T024 — Valeurs provisoires

- `provisional-defaults.ts` : Sénégal (`unidentified_monthly_limit` 200 000, `identified_monthly_limit` 2 000 000,
  `max_wallet_balance` NULL, `kyc_threshold` à préciser par la SPECIFICATION §6.3), TVA 18 % TTC (`rules.taxes`),
  `refund_deadline` = fin + 30 jours, destination de la casse ; pour chacune `confirm_by` (juriste,
  expert-comptable, porteur du projet) ; fonction qui complète un profil et produit `rules.provisional`.

### T025 — Cascade versionnée

- `cascade.service.ts` : `writeVersion(client, scope, settings, validFrom, actor)` (version n+1, contenu complet,
  `23505` ⇒ `409 CONFLICT_STATE`) ; `resolve(client, target, at)` : dernière version `valid_from ≤ at` par niveau
  (plateforme, prestataire, organisateur, événement, participation), fusion, chaque valeur avec
  `{ value, level, version, config_version_id, provisional }` ; pour l'événement, colonnes d'`event` +
  instantané de la version `EVENT`.
- Lecture du niveau plateforme par le rôle applicatif : `config_version` `operator_id` NULL est lisible
  (politique `tenant_read` existante).

### T026 — Bornes et messages

- `bounds-validator.ts` : ordre des contrôles de `contracts/configuration.md` ; entrée = modification demandée,
  configuration résolue, profil de législation ; sortie = liste de violations `{ field, rule, requested, limit,
  source }` ; levée d'un `ProblemException('VALIDATION_FAILED', { status: 422, detail, extensions: { violations } })`
  (étendre `ProblemException` si nécessaire, minimalement).
- Contrôle « qui règle quoi » : clé d'un autre rôle ⇒ `403 FORBIDDEN` ; mélange de rôles ⇒ `422`.
- `messages.ts` : textes FR et EN par `rule`, choisis selon `Accept-Language` (mécanisme existant de
  `http/language.ts`).

### T027 — Tests

- Unitaires : résolution (5 niveaux, valeur la plus précise, date antérieure), bornes fixes, maximum du prestataire,
  borne de législation, messages FR/EN, rôle par clé, mélange refusé.
- Intégration (`cascade.spec.ts`) sur la base : écriture de versions concurrentes (une seule réussit), résolution à
  une date antérieure, lecture du niveau plateforme.

## Test Strategy

Tests demandés par la spec (pgTAP par contrainte, isolation à deux prestataires, intégration sur la base locale). Ordre de vérification : `npm run lint`, `npm run typecheck`, `npm run reset-db -w @cashless/ledger-sql`, `npm run test:pgtap -w @cashless/ledger-sql`, `npm run reset-db -w @cashless/ledger-sql && npm test`.

## Definition of Done

`npm run lint`, `typecheck`, `npm test` verts ; couverture des règles de §4.2 et §9.8 utilisées par la mission.

## Risks / Reviewer guidance

Dupliquer une borne du schéma avec une valeur différente = refus incohérents : le test T023 compare les deux.
