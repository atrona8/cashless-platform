# Implementation Plan: Fondations du grand livre et de l'API

**Branch**: `feat/fondations-grand-livre` | **Date**: 2026-10-07 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `kitty-specs/fondations-grand-livre-01M4AY8M/spec.md`

## Summary

Poser le socle du système cashless : monorepo npm workspaces, base PostgreSQL 17 créée par migrations à partir
du schéma de référence, suites pgTAP (400 + 64 + compléments S21) exécutées en local (cluster privé sans droits
admin) et en CI, squelette NestJS portant les garanties transverses (cloisonnement par prestataire, problem+json
par SQLSTATE, idempotence S21, `X-Request-Id`, `Accept-Language`), moteur d'écritures à 26 constructeurs purs en
`bigint`, et rejeu du scénario de référence par les constructeurs avec comparaison ligne à ligne.

Décisions de cadrage : `decisions/` (specify : outillage pgTAP, 26 constructeurs, npm workspaces, aucune route
métier ; plan : cluster PostgreSQL 17 privé). Choix techniques détaillés : [research.md](research.md).

## Technical Context

**Language/Version**: TypeScript 5.x (strict, `target` ES2022, `BigInt` natif), Node.js 22 LTS ; SQL PostgreSQL 17 (PL/pgSQL) ; Python 3.11 pour les générateurs existants (non modifiés sauf contradiction)
**Primary Dependencies**: NestJS 11 (`@nestjs/core`, `@nestjs/common`, `@nestjs/platform-express`), `pg` 8 (node-postgres, sans ORM), `openapi-typescript` 7 (génération des types), `canonicalize` (JCS RFC 8785) ; dev : Jest 29 + `@swc/jest`, `supertest`, ESLint
**Storage**: PostgreSQL 17 (AWS RDS en production) ; local : cluster privé sur le port 5433 ; CI : service `postgres:17` + `postgresql-17-pgtap`
**Testing**: pgTAP via `pg_prove` (suites de référence + `tests_api_idempotency.sql` écrit à la main) ; Jest : unitaires (calculs, 19 cas, 26 constructeurs, matrice des statuts, table SQLSTATE) et intégration contre une vraie base (garanties transverses, isolation, rejeu du scénario)
**Target Platform**: Serveur Linux (production AWS) ; développement Windows 10 (Git Bash), sans Docker
**Project Type**: Monorepo (API + packages partagés) — seuls `apps/api`, `packages/contracts`, `packages/ledger-sql` sont touchés
**Performance Goals**: Moteur : au plus 1 appel SQL d'écriture par commande (+ 1 lecture de soldes si répartition offerts/payés ou vente hors ligne) ; préparation du p95 « serveur seul » ≤ 200 ms (§15), mesuré par les missions qui publient `POST /payments`
**Constraints**: point d'écriture unique `post_transaction` ; RLS forcée et `set_config(…, true)` par transaction ; durées du rôle (`transaction_timeout` 60 s, `statement_timeout` 30 s, `idle_in_transaction_session_timeout` 10 s, `lock_timeout` 5 s) ; fonctions internes §13.1 jamais rendues ; aucun `.sql` généré modifié à la main ; aucun flottant ; outillage local sans admin ni Docker
**Scale/Scope**: 26 types de transaction, 19 cas normatifs, 48 transactions du scénario, ~25 SQLSTATE traduits, 1 table nouvelle (S21), 1 route publiée (santé)

### Supply-chain (dépendances ajoutées)

- Registre npm officiel uniquement ; versions **exactes** dans les `package.json` ; `package-lock.json` commité.
- `npm ci --ignore-scripts` en CI et dans le quickstart ; aucune dépendance retenue n'exige de script
  `install`/`postinstall` pour fonctionner (`@swc/core` fournit des binaires par paquet optionnel ; vérifié en
  WP de mise en place, sinon on retombe sur `ts-jest`).
- Node 22 = LTS active ; NestJS 11, `pg` 8, Jest 29 sont les versions majeures maintenues.
- pgTAP et `pg_prove` : sources officielles (release GitHub `theory/pgtap`, CPAN `TAP::Parser::SourceHandler::pgTAP`),
  version épinglée et somme SHA-256 vérifiée par le script local.
- Passe adversariale : les dispositions sont dans [research.md](research.md) §R-11.

## Charter Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Aucune charte de projet (`.kittify/charter/charter.yaml` absent) : contrôle **ignoré**. Les règles qui en tiennent
lieu sont les sources normatives (`README.md`, `docs/SPECIFICATION.md`, règle de priorité §0.3) et les directives
intégrées de Spec Kitty (intégrité d'architecture, documentation des décisions, fidélité à la spécification,
localité du changement). Re-vérification après conception : aucune violation.

## Project Structure

### Documentation (this mission)

```
kitty-specs/fondations-grand-livre-01M4AY8M/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── engine-command.md          # Commande d'écriture, contexte, sortie des constructeurs
│   ├── problem-mapping.md         # Table SQLSTATE -> ProblemCode / statut HTTP
│   ├── idempotency.md             # Protocole S21 (réserver, exécuter, enregistrer)
│   └── status-type-matrix.md      # Statut d'événement / grand livre -> types acceptés
├── decisions/
└── tasks.md                       # (/spec-kitty.tasks)
```

### Source Code (repository root)

```
package.json                       # npm workspaces : apps/*, packages/*
tsconfig.base.json
.github/workflows/ledger-tests.yml # réécrit : migrations, pgTAP, générateurs, tests TS, types générés
tools/dev-db/                      # script du cluster privé (bash, Git Bash) + README
│   ├── setup.sh                   #   copie PG17 -> %LOCALAPPDATA%\cashless-pg17, pgTAP, pg_prove, initdb :5433
│   ├── start.sh / stop.sh
│   └── reset-db.sh                #   recrée la base de test par les migrations
packages/ledger-sql/
├── (fichiers de référence inchangés)
├── migrations/
│   ├── 0001_schema_reference.sql  #   \i ../schema_grand_livre_cashless.sql (pas de copie)
│   └── 0002_api_idempotency.sql   #   S21
├── tests/tests_api_idempotency.sql  # pgTAP écrit à la main (S21)
├── src/migrate.ts                 #   exécuteur : schema_migrations, somme de contrôle, puis roles.sql
└── package.json                   #   @cashless/ledger-sql : scripts migrate, test:pgtap
packages/contracts/
├── openapi.yaml                   #   inchangé
├── generated/openapi.ts           #   généré (openapi-typescript), commité
└── package.json                   #   @cashless/contracts : script generate, check
apps/api/
├── src/
│   ├── main.ts / app.module.ts
│   ├── db/                        #   pool, withTenantTx, parseurs int8 -> BigInt
│   ├── tenancy/                   #   TenantContext (port) + fournisseur de test
│   ├── http/                      #   X-Request-Id, Accept-Language, filtre problem+json, i18n fr/en
│   ├── errors/                    #   table SQLSTATE -> ProblemCode
│   ├── idempotency/               #   intercepteur + dépôt S21
│   ├── health/                    #   GET /v1/health (seule route publiée)
│   └── ledger/
│       ├── money/                 #   arrondi, frais, taxe extraite, partage (bigint purs)
│       ├── builders/              #   26 constructeurs purs, un fichier par type
│       ├── status-matrix.ts       #   types acceptés par statut
│       ├── config-resolver.ts     #   port ConfigResolver (+ fixture de test)
│       └── ledger-engine.service.ts
└── test/
    ├── unit/                      #   19 cas, constructeurs, matrice, SQLSTATE
    ├── integration/               #   garanties transverses (route de test non publiée), isolation, timeouts
    └── scenario/                  #   fixture + rejeu du scénario de référence
```

**Structure Decision**: monorepo §2.1 réduit aux trois dossiers utiles ; aucun dossier V2 ; `tools/dev-db/` est un
outil de poste, comme `tools/nfc-bench/`. La route de test des garanties transverses n'existe que dans le module de
test (`test/integration`), jamais dans `AppModule` de production.

```mermaid
flowchart LR
  subgraph API["apps/api (NestJS)"]
    MW["X-Request-Id · Accept-Language"] --> IDEM["Intercepteur d'idempotence (S21)"]
    IDEM --> CTRL["Contrôleurs (missions suivantes)"]
    CTRL --> ENG["LedgerEngine : matrice des statuts → constructeur pur → post_transaction"]
    ENG --> TX["withTenantTx : BEGIN · set_config(app.operator_id, …, true)"]
    FILT["Filtre problem+json (SQLSTATE → ProblemCode)"]
  end
  TX -->|cashless_app| DB[("PostgreSQL 17 : schéma de référence + migrations, RLS forcée")]
  ENG -. "5 types délégués" .-> FN["take_deposit · refund_deposit · forfeit_deposit · refund_cash_due · preload_media"]
  FN --> DB
```

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Cluster PostgreSQL privé copié dans le profil | Les suites font `CREATE EXTENSION pgtap` ; `share/extension` de Program Files est en lecture seule sans admin | Charger `pgtap.sql` à la main ne crée pas l'extension (l'instruction des suites échoue) ; modifier les `.sql` générés est interdit |
| Exécuteur de migrations maison | ~100 lignes, SQL pur, rejoue `roles.sql` après chaque série | Les outils existants (node-pg-migrate, etc.) ajoutent un DSL et des dépendances sans gain pour des fichiers SQL bruts |

## Implementation Concern Map

> Les préoccupations ne sont pas des work packages ; `/spec-kitty.tasks` les découpe.

### IC-01 — Monorepo et outillage TypeScript

- **Purpose**: Racine npm workspaces, `tsconfig` strict partagé, ESLint, Jest/SWC, scripts racine (`test`, `lint`, `generate`).
- **Relevant requirements**: FR-001, C-005, C-008
- **Affected surfaces**: `package.json`, `tsconfig.base.json`, `apps/api/package.json`, `packages/*/package.json`
- **Sequencing/depends-on**: none
- **Risks**: binaire `@swc/core` sous `--ignore-scripts` (repli `ts-jest`).

### IC-02 — Base locale et migrations

- **Purpose**: Cluster PostgreSQL 17 privé avec pgTAP et `pg_prove`, exécuteur de migrations, migration 0001 (schéma de référence) + `roles.sql`, recréation de la base de test.
- **Relevant requirements**: FR-002, FR-003, NFR-003, NFR-006, C-002, C-006
- **Affected surfaces**: `tools/dev-db/`, `packages/ledger-sql/migrations/`, `packages/ledger-sql/src/migrate.ts`
- **Sequencing/depends-on**: IC-01
- **Risks**: relocalisation des binaires PostgreSQL Windows (vérifier `pg_config --sharedir` depuis la copie) ; `pg_prove` dans le Perl de Git Bash (dépendance CPAN `TAP::Parser::SourceHandler::pgTAP`, pur Perl) ; pgTAP doit être « construit » sans make (substitutions de `pgtap.sql.in` faites par le script).

### IC-03 — CI

- **Purpose**: Réécrire `ledger-tests.yml` : générateurs + `git diff`, moteur Python de référence, base par migrations, `pg_prove` sur les trois fichiers, `npm ci --ignore-scripts`, lint, tests TS (unitaires + intégration + scénario), contrôle des types générés.
- **Relevant requirements**: FR-004, FR-005, FR-022, FR-023, NFR-007, C-010
- **Affected surfaces**: `.github/workflows/ledger-tests.yml`
- **Sequencing/depends-on**: IC-02 (et IC-05/IC-07 pour les étapes TS)
- **Risks**: pas de remote : validation locale en rejouant les étapes du job ; exécution réelle à la création du remote.

### IC-04 — Table d'idempotence S21

- **Purpose**: Migration 0002 `api_idempotency` (RLS forcée, `operator_id`, contraintes) et ses tests pgTAP.
- **Relevant requirements**: FR-009, NFR-003
- **Affected surfaces**: `packages/ledger-sql/migrations/0002_api_idempotency.sql`, `packages/ledger-sql/tests/tests_api_idempotency.sql`
- **Sequencing/depends-on**: IC-02
- **Risks**: `roles.sql` donne `INSERT, UPDATE` sur toutes les tables : la ligne est modifiable par l'application, c'est voulu (statut, réponse) ; aucune suppression (purge par une tâche future, hors mission).

### IC-05 — Squelette API et garanties transverses

- **Purpose**: Application NestJS, pool `pg` en `cashless_app`, `withTenantTx`, port `TenantContext`, `X-Request-Id`, `Accept-Language` + catalogue fr/en, filtre problem+json + table SQLSTATE, intercepteur d'idempotence, route de santé ; tests d'intégration via une route de test non publiée.
- **Relevant requirements**: FR-006, FR-007, FR-008, FR-009, FR-010, FR-011, FR-012, NFR-004, NFR-005, NFR-008, C-009
- **Affected surfaces**: `apps/api/src/{db,tenancy,http,errors,idempotency,health}`, `apps/api/test/integration`
- **Sequencing/depends-on**: IC-01, IC-04, IC-07 (types `ProblemCode`)
- **Risks**: fuite de contexte de prestataire entre connexions du pool (test dédié) ; requête concurrente sur la même clé (test à deux connexions) ; exception non SQL jamais exposée.

### IC-06 — Moteur d'écritures

- **Purpose**: Calculs `bigint` purs, 19 cas normatifs, 26 constructeurs purs, matrice des statuts, port `ConfigResolver`, service moteur (validation, délégation des 5 types SQL, appel de `post_transaction`, résultat nouveau / rejoué).
- **Relevant requirements**: FR-013 à FR-019, NFR-001, C-001, C-004
- **Affected surfaces**: `apps/api/src/ledger/`, `apps/api/test/unit`
- **Sequencing/depends-on**: IC-01 (calculs et constructeurs) ; IC-05 pour le service (accès base)
- **Risks**: arrondi « moitié s'éloignant de zéro » en division entière de `bigint` négatifs ; taxe extraite par regroupement (bénéficiaire, taux) ; aucune conversion `Number` d'un montant (règle ESLint + test).

### IC-07 — Types générés depuis le contrat

- **Purpose**: `openapi-typescript` sur `packages/contracts/openapi.yaml` → `generated/openapi.ts`, export `ProblemCode`, contrôle « à jour » en CI.
- **Relevant requirements**: FR-022, C-007
- **Affected surfaces**: `packages/contracts/`
- **Sequencing/depends-on**: IC-01
- **Risks**: `int64` du contrat généré en `number` : imposer `bigint` côté montants dans le code de l'API (options de génération ou transformation documentée).

### IC-08 — Rejeu du scénario de référence

- **Purpose**: Fixture (rôle propriétaire) depuis `scenario_reference.json` + bracelets/lots pour les cautions ; table des 48 commandes métier ; comparaison ligne à ligne constructeur ↔ JSON ; passages de statut ; soldes après T23 et en fin de clôture ; second rejeu = 0 transaction.
- **Relevant requirements**: FR-020, FR-021, FR-024, NFR-001, NFR-002
- **Affected surfaces**: `apps/api/test/scenario/`
- **Sequencing/depends-on**: IC-05, IC-06
- **Risks**: (1) cautions : clé et date imposées par `take_deposit` ≠ JSON (contradiction R-07) ; (2) l'ordre du scénario doit respecter la matrice des statuts et les conditions de passage (vérification précoce, R-08) ; (3) paramètres du JSON en décimaux (`0.12`) à convertir en points de base sans flottant (conversion par chaîne).
