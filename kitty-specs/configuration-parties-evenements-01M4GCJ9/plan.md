# Implementation Plan: Configuration, parties et événements

**Branch**: `feat/configuration-parties-evenements` | **Date**: 2026-10-09 | **Spec**: [spec.md](spec.md)
**Input**: `kitty-specs/configuration-parties-evenements-01M4GCJ9/spec.md`
**Base** : missions `fondations-grand-livre-01M4AY8M` (NestJS 11, `TenantTx`, idempotence, problem+json, moteur
d'écritures et port `ConfigResolver`, migrations, CI `ledger-tests`) et `identite-roles-double-validation-01M4DNDN`
(personnes, rôles et portées, `IdentityTenantContext`, audit chaîné, registre d'actions à deux, `post-roles.sql`).

## Summary

La mission branche l'API sur les tables d'organisation déjà présentes dans le schéma de référence et les durcit par
trois migrations : intégrité et immuabilité de la configuration (`0007`), ouverture du grand livre et des comptes
d'un événement et lecture des conditions de passage de statut (`0008`), portée plateforme pour l'idempotence et les
demandes d'approbation (`0009`). Un second rôle de base, `cashless_platform`, créé par `post-roles.sql` avec des
politiques RLS nominatives, sert seul les écritures de plateforme (prestataires, profils de législation, contrats
et règles de la plateforme) par un second pool et une `PlatformTx`. Côté API, un module `organization/` (prestataires,
organisateurs, commerçants, contrats), un module `events/` (événements, participations, points de vente, statuts) et
un module `configuration/` (catalogue des réglages, cascade versionnée, bornes, règles de frais, valeurs
provisoires, `SqlConfigResolver`) publient les routes back-office ajoutées au contrat ; huit actions à deux sont
enregistrées dans le registre de la mission 2. Preuve finale : la hiérarchie complète se construit par l'API, et le
scénario de référence se rejoue sur une configuration construite par l'API.

## Technical Context

**Language/Version**: TypeScript 5.9 (strict), Node 22 ; SQL PostgreSQL 17 (PL/pgSQL)
**Primary Dependencies**: NestJS 11, `pg` 8, `canonicalize` 5, `jose` 6 (existants) ; aucun ajout (research R-11)
**Storage**: PostgreSQL 17 ; migrations `0007_configuration.sql`, `0008_event_ledger.sql`, `0009_platform_scope.sql`
dans `packages/ledger-sql/migrations/` ; `post-roles.sql` étendu (rôle `cashless_platform`)
**Testing**: Jest 30 + SWC (unitaires, intégration sur la base locale, faux serveur d'identité de la mission 2) ;
pgTAP (`packages/ledger-sql/tests/tests_configuration.sql`, `tests_event_ledger.sql`, `tests_platform_scope.sql`)
**Target Platform**: API Linux (RDS en production) ; postes Windows 10 (cluster privé) et macOS (Docker,
research R-12) ; CI `ubuntu-24.04` + `postgres:17`
**Project Type**: monorepo npm workspaces (API et base ; aucune application cliente touchée)
**Performance Goals**: lectures et écritures de configuration p95 ≤ 200 ms ; création d'un événement avec grand
livre et comptes p95 ≤ 500 ms (NFR-003), mesurés par un test de charge léger en intégration
**Constraints**: statut seulement par `set_event_status` ; rien ne se modifie, tout se versionne ; prestataire déduit
de l'identité ; rôle plateforme sans droit sur le grand livre ; rôle applicatif sans droit sur les données de
plateforme ; `.sql` générés intouchables ; `roles.sql` (fichier du kit) non modifié ; aucun message SQL brut
**Scale/Scope**: 3 migrations, ~45 opérations ajoutées au contrat, 3 nouveaux modules NestJS, 8 actions à deux,
1 implémentation réelle du port `ConfigResolver`

## Charter Check

Pas de charte (`.kittify/charter/charter.md` absent) : section sans objet. Règles du projet appliquées : `CLAUDE.md`
(priorité SPECIFICATION §0.3, contradictions signalées — `research.md` X-1 à X-5 —, `.sql` générés intouchables).

## Project Structure

### Documentation (this mission)

```
kitty-specs/configuration-parties-evenements-01M4GCJ9/
├── spec.md
├── plan.md              # ce fichier
├── research.md          # décisions R-01 à R-12, contradictions X-1 à X-5
├── data-model.md        # migrations 0007-0009, cascade, invariants
├── quickstart.md        # base locale (Docker ou cluster privé), vérification, parcours
├── contracts/
│   ├── openapi-additions.md   # routes et schémas ajoutés à openapi.yaml
│   ├── platform-access.md     # rôle et pool de plateforme, ce que chaque rôle ne peut pas faire
│   ├── configuration.md       # cascade, bornes, qui règle quoi, actions à deux, immuabilité
│   └── event-lifecycle.md     # création, conditions, passages, modification
├── checklists/requirements.md
└── tasks.md             # créé par /spec-kitty.tasks
```

### Source Code (repository root)

```
packages/ledger-sql/
├── migrations/
│   ├── 0007_configuration.sql   # colonnes event / participation, currency_exponent, immuabilité, gardes de cohérence
│   ├── 0008_event_ledger.sql    # open_event_ledger, open_participation_account, event_transition_conditions
│   └── 0009_platform_scope.sql  # operator_id NULL (idempotence, approbations), actions, decide_approval_request
├── post-roles.sql               # + rôle cashless_platform, droits, politiques nominatives, retrait jurisdiction_profile
├── src/migrate.ts               # + mot de passe de cashless_platform
└── tests/
    ├── tests_configuration.sql
    ├── tests_event_ledger.sql
    └── tests_platform_scope.sql
packages/contracts/
├── openapi.yaml                 # + routes et schémas (contracts/openapi-additions.md)
└── generated/                   # régénéré
apps/api/src/
├── config/config.ts             # + DATABASE_URL_PLATFORM, DB_PLATFORM_POOL_SIZE
├── db/
│   ├── platform-tx.ts           # PlatformTx (second pool, jamais exporté hors des services de plateforme)
│   └── db.module.ts             # + pool plateforme
├── idempotency/                 # + option `platform` (réservation et enregistrement par PlatformTx)
├── approval/                    # + variante plateforme (demandes operator_id NULL)
├── configuration/
│   ├── configuration.module.ts
│   ├── settings-catalog.ts      # clés, niveaux, types, bornes fixes, rôle qui règle, stockage
│   ├── provisional-defaults.ts  # §17.2, « à confirmer », qui confirme
│   ├── bounds-validator.ts      # législation, maximums des niveaux supérieurs, messages FR/EN
│   ├── cascade.service.ts       # versions, résolution à une date, vue résolue
│   ├── fee-rules.service.ts     # création, remplacement, contrôles de portée
│   ├── jurisdiction.service.ts  # profils (plateforme)
│   ├── sql-config-resolver.ts   # port ConfigResolver de la mission 1
│   └── *.controller.ts / *.dto.ts
├── organization/
│   ├── organization.module.ts
│   ├── operators.*              # plateforme : prestataires, contrats PLATFORM_OPERATOR
│   ├── organizers.*             # organisateurs, contrats OPERATOR_ORGANIZER
│   └── merchants.*
└── events/
    ├── events.module.ts
    ├── events.*                 # création (grand livre), lecture, modification, configuration résolue
    ├── status.*                 # conditions, passages, action EVENT_GO_LIVE
    ├── participations.*         # participations (compte commerçant), points de vente
    └── approval-actions.ts      # définitions des actions à deux de la mission
apps/api/test/
├── unit/configuration/…         # catalogue, cascade, bornes, messages, résolveur
├── integration/organization/…   # plateforme, prestataires, organisateurs, commerçants, contrats, isolation
├── integration/events/…         # événements, participations, statuts, actions à deux, isolation
└── integration/end-to-end/configuration-journey.spec.ts (+ rejeu du scénario par SqlConfigResolver)
```

**Structure Decision**: trois modules NestJS nouveaux, à côté de ceux des missions 1 et 2 ; aucune réorganisation de
l'existant. Côté base, uniquement des migrations numérotées et `post-roles.sql`.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| Second rôle de base et second pool | Exigence de §2.2 retenue par le porteur (rôle distinct pour les tâches de plateforme) | `SECURITY DEFINER` (précédent de la mission 2) écarté par le porteur ; `BYPASSRLS` supprime le cloisonnement |
| `operator_id` NULL permis dans `api_idempotency` et `approval_request` | Clé d'idempotence (FR-021) et double validation (FR-019) au niveau plateforme | Tables parallèles (duplication des gardes et du code) |
| Remplacement de `decide_approval_request` (fonction du schéma de référence) par migration | Décision d'une demande de plateforme (pas de prestataire à vérifier) | Seconde fonction de décision (deux chemins à garder cohérents) ; les contrôles existants sont conservés à l'identique, tests de référence inchangés |
| Colonnes ajoutées à `event` et `merchant_participation` | Paramètres de §4.2 et droit de place de §12.1 sans colonne (X-4, X-5) | Les porter dans `config_version` seulement (les fonctions de la base et la clôture lisent les tables) |

## Implementation Concern Map

> Les préoccupations ne sont pas des work packages ; `/spec-kitty.tasks` les découpe.

### IC-01 — Intégrité de la configuration en base

- **Purpose**: Migration `0007` : colonnes `event.issuer`, `event.funds_holder_party_id`,
  `merchant_participation.pitch_fee`, `pitch_fee_reference` ; table `currency_exponent` ; déclencheurs d'immuabilité
  (contrats, versions, profils, règles), de cohérence (références d'événement, participation, portée des règles) et
  de bornes (`event_jurisdiction_bounds`).
- **Requirements**: FR-002, FR-007, FR-008, FR-009, FR-012, FR-014, FR-015, C-002, C-003, C-004.
- **Evidence**: `tests_configuration.sql`, une assertion par contrainte ; suites de référence vertes.

### IC-02 — Grand livre d'événement et conditions de passage

- **Purpose**: Migration `0008` : `open_event_ledger`, `open_participation_account`,
  `event_transition_conditions` ; droits d'exécution dans `post-roles.sql`.
- **Requirements**: FR-011, FR-012, FR-017, NFR-004.
- **Evidence**: `tests_event_ledger.sql` (comptes créés, attributs §5.2, `L-LEGAL-CASSE` conditionnel, idempotence
  du compte commerçant, conditions identiques aux refus de `set_event_status`).

### IC-03 — Rôle et portée plateforme

- **Purpose**: Migration `0009` et `post-roles.sql` : `cashless_platform`, politiques nominatives, retrait des droits
  du rôle applicatif sur `jurisdiction_profile`, `operator_id` NULL dans l'idempotence et les approbations, nouvelle
  `decide_approval_request`, actions ajoutées ; `migrate.ts` (mot de passe) ; CI (variables).
- **Requirements**: FR-001, FR-019, NFR-002, C-004.
- **Evidence**: `tests_platform_scope.sql` (chaque interdit des deux rôles ; décision d'une demande de plateforme) ;
  CI verte sur base neuve.

### IC-04 — Transaction, idempotence et approbations de plateforme dans l'API

- **Purpose**: `DATABASE_URL_PLATFORM`, second pool, `PlatformTx` ; option `platform` de `@Idempotent` ; variante
  plateforme d'`ApprovalService` et des routes `/approval-requests` ; test d'architecture (pool plateforme confiné).
- **Requirements**: FR-001, FR-019, FR-020, FR-021, C-005.
- **Evidence**: tests d'intégration : rejeu d'une écriture de plateforme, demande de plateforme approuvée par un
  second `PLATFORM_ADMIN`, refus par son auteur, invisibilité pour un prestataire.

### IC-05 — Catalogue, cascade, bornes et valeurs provisoires

- **Purpose**: `settings-catalog.ts`, `provisional-defaults.ts`, `bounds-validator.ts`, `cascade.service.ts` ;
  versions de configuration aux cinq niveaux ; configuration résolue avec origine ; messages FR/EN.
- **Requirements**: FR-003, FR-010, FR-014, FR-015, NFR-005, C-006.
- **Evidence**: unitaires (résolution, bornes, messages) ; intégration (refus cités, concurrence `409`).

### IC-06 — Plateforme : profils de législation, prestataires, contrats et règles de plateforme

- **Purpose**: routes de plateforme (contrat `openapi-additions.md`, section Plateforme) ; actions
  `JURISDICTION_LIMITS_CHANGE` et `PLATFORM_CONTRACT_VERSION`.
- **Requirements**: FR-002, FR-003, FR-004, FR-007, FR-008, FR-019, FR-020.

### IC-07 — Organisation d'un prestataire

- **Purpose**: configuration de niveau prestataire et organisateur, organisateurs, commerçants, contrats
  `OPERATOR_ORGANIZER` (action `CONTRACT_VERSION`), règles de frais `OPERATOR_CONTRACT`.
- **Requirements**: FR-005, FR-006, FR-007, FR-008, FR-020, NFR-001.

### IC-08 — Événements, participations, points de vente

- **Purpose**: création (grand livre), lecture, modification par qui de droit (actions `EVENT_SETTINGS_CHANGE`,
  `EVENT_OPERATOR_SETTINGS_CHANGE`), configuration résolue ; participations (compte commerçant, action
  `PARTICIPATION_CHANGE`), points de vente ; règles `EVENT` et `PARTICIPATION` (action `FEE_RULE_CHANGE`).
- **Requirements**: FR-009, FR-010, FR-011, FR-012, FR-013, FR-019, NFR-001, NFR-004.

### IC-09 — Statuts d'événement

- **Purpose**: conditions (base, configuration, externes), passages par `set_event_status`, action `EVENT_GO_LIVE`,
  audit des passages.
- **Requirements**: FR-017, FR-018, FR-019, C-001.

### IC-10 — Résolveur de configuration réel

- **Purpose**: `SqlConfigResolver` (port de la mission 1), fourni au `LedgerModule` ; `fee_rule_id` par ligne de
  frais, `config_version_id` par transaction.
- **Requirements**: FR-016, SC-004.
- **Evidence**: rejeu du scénario de référence sur une configuration construite par l'API, soldes identiques.

### IC-11 — Contrat d'API, preuves de bout en bout, CI et documentation

- **Purpose**: `openapi.yaml` (routes, schémas, `ApprovalAction`), types régénérés ; parcours de bout en bout ;
  isolation à deux prestataires sur toutes les routes ; mesure NFR-003 ; CI (variables du rôle plateforme) ;
  `docs/DECISIONS_ADR.md` (ADR-80 : rôle plateforme et coexistence avec la mission 2 ; ADR-81 : profils de
  législation gérés par la plateforme, X-1) ; `.github/CI.md` (mode Docker).
- **Requirements**: FR-021, NFR-001, NFR-003, NFR-006, SC-001 à SC-005, C-008.
