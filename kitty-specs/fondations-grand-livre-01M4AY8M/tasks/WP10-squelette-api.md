---
work_package_id: WP10
title: Squelette NestJS et garanties transverses
dependencies:
- WP03
- WP05
requirement_refs:
- FR-006
- FR-007
- FR-008
- FR-010
- FR-011
- FR-012
planning_base_branch: feat/fondations-grand-livre
merge_target_branch: feat/fondations-grand-livre
branch_strategy: Planning artifacts were generated on feat/fondations-grand-livre; completed changes must merge back into feat/fondations-grand-livre.
subtasks:
- T047
- T048
- T049
- T050
- T051
- T052
- T053
phase: Phase 4 - API
history:
- timestamp: '2026-10-07T12:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: node-norris
authoritative_surface: apps/api/src/http/
create_intent:
- apps/api/src/main.ts
- apps/api/src/app.module.ts
- apps/api/src/config/config.ts
- apps/api/src/db/db.module.ts
- apps/api/src/db/tenant-tx.ts
- apps/api/src/tenancy/tenant-context.ts
- apps/api/src/http/request-id.middleware.ts
- apps/api/src/http/language.ts
- apps/api/src/http/messages.fr.json
- apps/api/src/http/messages.en.json
- apps/api/src/errors/problem.ts
- apps/api/src/errors/sqlstate-map.ts
- apps/api/src/errors/problem.filter.ts
- apps/api/src/health/health.controller.ts
- apps/api/test/support/db.ts
- apps/api/test/support/app.ts
- apps/api/test/unit/errors/sqlstate-map.spec.ts
- apps/api/test/unit/architecture.spec.ts
- apps/api/test/integration/health.spec.ts
execution_mode: code_change
owned_files:
- apps/api/src/main.ts
- apps/api/src/app.module.ts
- apps/api/src/config/**
- apps/api/src/db/**
- apps/api/src/tenancy/**
- apps/api/src/http/**
- apps/api/src/errors/**
- apps/api/src/health/**
- apps/api/test/support/**
- apps/api/test/unit/errors/**
- apps/api/test/unit/architecture.spec.ts
- apps/api/test/integration/health.spec.ts
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP10 – Squelette NestJS et garanties transverses

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load node-norris`. Lis SPECIFICATION §2.2 (règles 3 et 4), §5.7, §10.1, §13.1 ;
`contracts/problem-mapping.md` ; `research.md` §R-03, §R-04.

## Objective

Monter l'application NestJS et toutes les garanties transverses **hors idempotence** (WP11) : accès base cloisonné,
contexte de prestataire, identifiant de requête, langue, erreurs problem+json, santé.

## Context

- Exigences : FR-006, FR-007, FR-008, FR-010, FR-011, FR-012, NFR-004, NFR-008, C-009.
- Aucune route métier. Préfixe global `/v1`. La route de santé est **hors contrat** (noté dans `docs/07`).
- Variables : `DATABASE_URL_APP` (rôle `cashless_app`), `PORT`, `PROBLEM_TYPE_BASE` (défaut
  `https://errors.cashless/`).

## Branch Strategy

Planification et merge sur `feat/fondations-grand-livre`. Commande : `spec-kitty agent action implement WP10 --agent claude`.

## Subtasks

### T047 — Amorçage (`main.ts`, `app.module.ts`, `config/config.ts`)

- `NestFactory.create(AppModule, { bufferLogs: true })`, `setGlobalPrefix('v1')`, `enableShutdownHooks()`.
- `config.ts` : lecture typée des variables, valeurs par défaut locales (5433), erreur claire si
  `DATABASE_URL_APP` manque en production. Pas de `@nestjs/config` (pas de dépendance ajoutée).
- `AppModule` importe `DbModule`, `HealthModule` ; enregistre le middleware `X-Request-Id`, le filtre global.

### T048 — Accès base (`db/`)

- `db.module.ts` : un `Pool` `pg` (taille paramétrable, défaut 10), fourni sous un jeton **non exporté** hors du
  module ; `pg.types.setTypeParser(20, (v) => BigInt(v))` (int8) ; `numeric` (1700) laissé en chaîne.
- `tenant-tx.ts` : `TenantTx` service avec `run<T>(operatorId: string, fn: (client) => Promise<T>): Promise<T>` :
  `BEGIN` → `SELECT set_config('app.operator_id', $1, true)` → `fn` → `COMMIT` ; `ROLLBACK` sur erreur puis
  relance ; `client.release()` dans `finally`. Valider `operatorId` (UUID) avant usage.
- Aucune autre API d'accès : pas de `query` hors transaction.

### T049 — `TenantContext` (`tenancy/tenant-context.ts`)

- Port `TenantContextProvider { current(req): { operatorId: string } }` + jeton. Implémentation par défaut :
  **refus** (`UNAUTHENTICATED`, 401) tant que l'authentification réelle (mission 2) n'existe pas.
- Implémentation de test (dans `test/support/app.ts`) : lit l'en-tête `X-Test-Operator-Id` ; jamais enregistrée
  dans `AppModule` de production.

### T050 — `X-Request-Id` et journal structuré (`http/request-id.middleware.ts`)

- Accepte un `X-Request-Id` entrant s'il est un UUID, sinon en génère un (`crypto.randomUUID()`) ; le pose sur la
  requête et la réponse. Journal JSON une ligne par requête (`requestId`, méthode, route, statut, durée ms).

### T051 — `Accept-Language` (`http/language.ts`, `messages.{fr,en}.json`)

- `pickLanguage(header): 'fr' | 'en'` (défaut `fr`, poids `q` respectés, `en-US` → `en`).
- Catalogues : `title` et `detail` par `ProblemCode` pour **tous** les codes de `PROBLEM_CODES` (test : aucun code
  sans message dans les deux langues).

### T052 — Erreurs (`errors/`)

- `problem.ts` : `ProblemException(code, { status?, detail?, params? })`.
- `sqlstate-map.ts` : table de `contracts/problem-mapping.md` (SQLSTATE → code, statut) ; `23514` : nom de
  contrainte → `FORBIDDEN` si c'est la contrainte de double validation de `journal_transaction`, sinon
  `VALIDATION_FAILED` — retrouver le nom généré par `pg_get_constraintdef` (test d'intégration de WP11 le vérifie).
- `problem.filter.ts` : filtre global ; `ProblemException` → réponse ; erreur `pg` (`err.code` à 5 caractères) →
  table ; `HttpException` Nest (404 route, 400 corps invalide) → `NOT_FOUND` / `VALIDATION_FAILED` ; tout le reste
  → `INTERNAL_ERROR` 500. Corps `application/problem+json` (`type`, `title`, `status`, `detail`, `code`,
  `instance` = `X-Request-Id`). **Jamais** `err.message` d'une erreur SQL dans la réponse ; le journaliser côté
  serveur avec `requestId`.
- Tests unitaires `sqlstate-map.spec.ts` : chaque ligne de la table ; statuts HTTP comparés à
  `generated/problem-statuses.ts` (WP05) ; un SQLSTATE inconnu → `INTERNAL_ERROR`.

### T053 — Santé et outillage de test d'intégration

- `health/health.controller.ts` : `GET /v1/health` → `200 { status: 'ok', db: 'ok' }` si `SELECT 1` réussit dans
  `TenantTx`… sans prestataire : utiliser un `SELECT 1` hors RLS via un client du pool en transaction lecture seule
  (exception documentée à la règle « pas de requête hors `run` » : `TenantTx.ping()`), sinon `503
  SERVICE_UNAVAILABLE`.
- `test/support/db.ts` : connexions propriétaire et applicative depuis `.env.test` / variables ; `resetDatabase()`
  appelle `packages/ledger-sql/scripts/reset-db.sh` ou recrée la base de test.
- `test/support/app.ts` : fabrique d'application de test (`Test.createTestingModule`, fournisseur de prestataire de
  test, modules additionnels injectables).
- `test/unit/architecture.spec.ts` : aucun fichier de `src/` hors `db/` n'importe `pg` ni le jeton du pool
  (analyse textuelle des imports).
- `test/integration/health.spec.ts` : 200 avec base ; `X-Request-Id` renvoyé et généré ; 404 d'une route inconnue en
  problem+json, `Accept-Language: en` → titre anglais.

## Definition of Done

- `npm test -w @cashless/api` vert (unitaires + intégration santé) avec le cluster local démarré.
- `npm run start -w @cashless/api` démarre et répond sur `/v1/health`.

## Risks / Reviewer guidance

- Aucun chemin où une erreur SQL brute atteint le client (relire le filtre).
- `set_config(…, true)` uniquement ; rechercher `SET app.` dans `src/` : 0 occurrence.
