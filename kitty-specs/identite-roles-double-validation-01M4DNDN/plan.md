# Implementation Plan: Identité, rôles et double validation

**Branch**: `feat/identite-roles` | **Date**: 2026-10-08 | **Spec**: [spec.md](spec.md)
**Input**: `kitty-specs/identite-roles-double-validation-01M4DNDN/spec.md`
**Base** : mission `fondations-grand-livre-01M4AY8M` (NestJS 11, `TenantTx`, `IdempotencyModule`, problem+json,
migrations `packages/ledger-sql`, CI `ledger-tests`).

## Summary

L'API reconnaît les personnes par un jeton d'accès OIDC (vérifié avec `jose` et les clés publiques du serveur
d'identité, mises en cache), retrouve la personne, son prestataire et ses rôles par une fonction de la base
(`identify_person`), et remplace le fournisseur de contexte « refus systématique » de la mission 1. Des gardes
déclaratives contrôlent rôle et portée par route. Trois migrations ajoutent personnes, attributions, journal
d'audit chaîné et scellé, utilisations de jetons d'approbation, et la colonne `result` des demandes d'approbation ;
un nouveau fichier « après rôles » retire au rôle applicatif ce que `roles.sql` lui rend trop largement. Les routes
`/approval-requests` et de gestion des personnes sont publiées ; le mécanisme d'action à deux est un registre
générique où les missions suivantes branchent leurs actions ; le jeton d'approbation sur place est vérifié par une
garde réutilisable. Un faux serveur d'identité (clés générées en mémoire) sert tous les tests.

## Technical Context

**Language/Version**: TypeScript 5.9 (strict), Node 22 ; SQL PostgreSQL 17 (PL/pgSQL)
**Primary Dependencies**: NestJS 11, `pg` 8, `canonicalize` 5 (existants) ; **ajout** `jose` 6.2.12 (vérification
JWT/JWKS, signature des jetons du faux serveur d'identité)
**Storage**: PostgreSQL 17, migrations `0003`-`0005` dans `packages/ledger-sql/migrations/`, fichier
`packages/ledger-sql/post-roles.sql` rejoué après `roles.sql`
**Testing**: Jest 30 + SWC (unitaires, intégration sur la base locale), pgTAP (`packages/ledger-sql/tests/`)
**Target Platform**: API Linux (RDS en production) ; postes Windows 10 et CI `ubuntu-24.04`
**Project Type**: monorepo npm workspaces (API seule touchée côté applicatif)
**Performance Goals**: vérification d'un jeton ≤ 5 ms au p95 (clés en cache) ; `identify_person` en une requête
**Constraints**: valideur jamais pris dans la requête ; contraintes « valideur ≠ auteur » intactes ; aucune fonction
interne rendue au rôle applicatif ; aucun mot de passe dans l'API ; aucun service externe dans les tests
**Scale/Scope**: 3 migrations, ~11 routes (4 existantes au contrat, 7 ajoutées), 2 nouveaux modules NestJS
(`identity/`, `approval/`), extension de `audit/`

### Supply-chain (dépendance ajoutée)

| Paquet | Version | Contrôles | Décision |
|---|---|---|---|
| `jose` | 6.2.12 (exacte) | registre npm officiel ; mainteneur unique connu (panva, dépôt `github.com/panva/jose`) ; **aucune dépendance** ; **aucun script d'installation** ; publiée le 2026-09-05 (33 jours, au-delà du délai de prudence) ; intégrité `sha512-9NiFmJEex0…` ; ESM seul | Acceptée, épinglée ; chargée comme `canonicalize` (require(esm) en Node 22, exception `transformIgnorePatterns` en test) ; `npm ci --ignore-scripts` en CI |

Passe adversariale : `research.md` R-11.

## Charter Check

Pas de charte (`.kittify/charter/charter.md` absent) : section sans objet. Les règles du projet appliquées sont
celles de `CLAUDE.md` (priorité SPECIFICATION §0.3, `.sql` générés intouchables).

## Project Structure

### Documentation (this mission)

```
kitty-specs/identite-roles-double-validation-01M4DNDN/
├── spec.md
├── plan.md              # ce fichier
├── research.md          # décisions R-01 à R-12
├── data-model.md        # tables, fonctions, invariants
├── quickstart.md        # parcours local de bout en bout
├── contracts/
│   ├── identity.md          # jeton d'accès, résolution de la personne, rôles et portées
│   ├── approvals.md         # demandes d'approbation, registre d'actions, jeton sur place
│   ├── audit-chain.md       # chaîne d'empreintes, scellement, vérification
│   └── openapi-additions.md # routes ajoutées à openapi.yaml (gestion des personnes et des rôles)
├── checklists/requirements.md
└── tasks.md             # créé par /spec-kitty.tasks
```

### Source Code (repository root)

```
packages/ledger-sql/
├── migrations/
│   ├── 0003_identity.sql             # app_user, role_assignment, identify_person, garde des attributions
│   ├── 0004_audit_log.sql            # audit_log chaîné, audit_seal, seal_audit, verify_audit_chain
│   └── 0005_approvals.sql            # approval_request.result, approval_token_use
├── post-roles.sql                    # REVOKE/GRANT rejoués après roles.sql (nouveau)
├── src/migrate.ts                    # + rejeu de post-roles.sql ; + commande d'amorçage (bootstrap-admin)
└── tests/
    ├── tests_identity.sql
    ├── tests_audit_log.sql
    └── tests_approvals.sql
packages/contracts/
├── openapi.yaml                      # + routes /operators/{operator_id}/users…, role-assignments
└── generated/                        # régénéré
apps/api/src/
├── identity/
│   ├── identity.module.ts
│   ├── oidc-verifier.ts              # port IdentityVerifier + implémentation jose (JWKS distant en cache)
│   ├── authentication.guard.ts       # jeton d'accès → Principal (identify_person)
│   ├── principal.ts                  # Principal, rôles, portées
│   ├── roles.decorator.ts            # @Roles(...rôles, { scope }) + RolesGuard
│   ├── scope-resolver.ts             # chaîne de portées d'un objet (opérateur ⊃ organisateur ⊃ événement ; commerçant)
│   ├── identity-tenant-context.ts    # TENANT_CONTEXT de production
│   └── users/                        # contrôleur et service de gestion des personnes et rôles
├── approval/
│   ├── approval.module.ts
│   ├── action-registry.ts            # registre des actions à deux (ApprovalAction → définition)
│   ├── approval.service.ts           # créer (202), décider, exécuter (SAVEPOINT), refuser
│   ├── approval.controller.ts        # 4 routes /approval-requests
│   └── onsite-approval.guard.ts      # @RequiresOnsiteApproval({ operationId, role }) : X-Approval-Token
├── audit/
│   └── audit.service.ts              # écrit audit_log avec le client de la transaction
└── idempotency/                      # + test d'architecture RISK-2 ; + ProblemException « validée »
apps/api/test/
├── support/fake-idp.ts               # faux serveur d'identité (clés, jetons valides et défectueux)
├── unit/…                            # vérifieur, act_hash, registre, portées
└── integration/identity/…            # authentification, isolation, gestion, approbations, jeton sur place, audit
```

**Structure Decision**: deux nouveaux modules (`identity/`, `approval/`) et un module `audit/` dans `apps/api/src/`,
à côté de ceux de la mission 1 ; aucune réorganisation de l'existant. Côté base, uniquement des migrations
numérotées et un fichier `post-roles.sql` ; `roles.sql` (fichier du kit) n'est pas modifié.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| Nouveau fichier `post-roles.sql` et modification de `migrate.ts` (mission 1) | `roles.sql`, rejoué après chaque série, rend `INSERT, UPDATE` et `EXECUTE` sur tout : il faut retirer ensuite `UPDATE` sur `audit_log`, `INSERT/UPDATE` sur `audit_seal`, `EXECUTE` sur les fonctions de scellement et de vérification, et accorder `UPDATE (result)` sur `approval_request` | Modifier `roles.sql` (fichier normatif du kit) ; compter seulement sur des déclencheurs (les droits resteraient affichés à tort) |
| Colonne `approval_request.result` ajoutée par migration | Le contrat renvoie `result` ; le schéma ne l'a pas (contradiction consignée R-02) | Ne pas renvoyer `result` (contrat non respecté) |
| Chaînage par ligne du journal d'audit (verrou par chaîne) | Choix du porteur du projet ; volume faible (actions d'administration), donc pas d'enjeu de débit, contrairement au grand livre (ADR-46) | Scellement périodique seul (une altération entre deux scellements ne serait pas détectée) |

## Implementation Concern Map

> Les préoccupations ne sont pas des work packages ; `/spec-kitty.tasks` les découpe.

### IC-01 — Schéma d'identité

- **Purpose**: Migration `0003` : `app_user`, `role_assignment` (portée, objet, auteur, retrait), garde (pas de
  modification d'identité ni de rétablissement d'une attribution retirée, dernier `PLATFORM_ADMIN`), fonction
  `identify_person(issuer, subject)` SECURITY DEFINER ; tests pgTAP par contrainte, RLS et isolation.
- **Relevant requirements**: FR-001, FR-004, FR-006 (règles en base), NFR-001, C-003, C-008
- **Affected surfaces**: `packages/ledger-sql/migrations/0003_identity.sql`, `packages/ledger-sql/tests/tests_identity.sql`
- **Sequencing/depends-on**: aucune
- **Risks**: lignes plateforme (`operator_id` NULL) invisibles sous RLS par construction : seule `identify_person` les lit.

### IC-02 — Journal d'audit chaîné et scellé

- **Purpose**: Migration `0004` : `audit_log` (chaîne par prestataire ou plateforme, numéro sans trou, empreintes,
  déclencheur de chaînage sous verrou consultatif de la chaîne, refus de `UPDATE`/`DELETE`), `audit_seal`,
  `seal_audit(chaîne)`, `verify_audit_chain(chaîne)` ; pgTAP : ajout seul, altérations détectées.
- **Relevant requirements**: FR-002, FR-018, FR-019, NFR-004, NFR-007
- **Affected surfaces**: `packages/ledger-sql/migrations/0004_audit_log.sql`, `packages/ledger-sql/tests/tests_audit_log.sql`
- **Sequencing/depends-on**: IC-01 (acteurs)
- **Risks**: format canonique de ligne à figer (contrat `audit-chain.md`) ; la tâche planifiée et la copie externe
  sont hors mission (mission 9).

### IC-03 — Approbations en base et droits « après rôles »

- **Purpose**: Migration `0005` : `approval_request.result`, `approval_token_use` (jti, opération, sujet,
  expiration ; insertion = consommation) ; `post-roles.sql` + rejeu par `migrate.ts` ; pgTAP des droits.
- **Relevant requirements**: FR-011, FR-014, C-002, C-008
- **Affected surfaces**: `packages/ledger-sql/migrations/0005_approvals.sql`, `packages/ledger-sql/post-roles.sql`,
  `packages/ledger-sql/src/migrate.ts`, `packages/ledger-sql/tests/tests_approvals.sql`
- **Sequencing/depends-on**: IC-02 (droits d'`audit_seal`)
- **Risks**: oublier un objet dans `post-roles.sql` ; un test pgTAP vérifie les droits effectifs après migration.

### IC-04 — Authentification et contexte de prestataire

- **Purpose**: Module `identity/` : port `IdentityVerifier` (jose, JWKS distant en cache, émetteur, audience,
  tolérance d'horloge 10 s), garde d'authentification globale (routes publiques explicites : santé), `Principal`,
  `TENANT_CONTEXT` de production remplaçant le refus systématique ; faux serveur d'identité de test ; configuration
  (`OIDC_ISSUER`, `OIDC_AUDIENCE`, `OIDC_JWKS_URI`, `OIDC_APPROVAL_AUDIENCE`).
- **Relevant requirements**: FR-003, FR-004, FR-016, NFR-002, NFR-005, C-004, C-005
- **Affected surfaces**: `apps/api/src/identity/`, `apps/api/src/app.module.ts`, `apps/api/src/config/config.ts`,
  `apps/api/test/support/fake-idp.ts`, `apps/api/test/support/app.ts`
- **Sequencing/depends-on**: IC-01
- **Risks**: les tests de la mission 1 utilisent l'en-tête de test : garder ce fournisseur pour eux, les nouveaux
  tests passent par de vrais jetons.

### IC-05 — Rôles, portées et gestion des personnes

- **Purpose**: `@Roles` + `RolesGuard` + `ScopeResolver` ; routes de gestion des personnes et des rôles ajoutées à
  `openapi.yaml` (types régénérés) ; règles « qui peut donner quoi », pas d'auto-attribution ; commande d'amorçage
  du premier `PLATFORM_ADMIN` ; chaque action journalisée.
- **Relevant requirements**: FR-005, FR-006, FR-007, FR-008, C-006
- **Affected surfaces**: `apps/api/src/identity/users/`, `apps/api/src/identity/roles.decorator.ts`,
  `apps/api/src/identity/scope-resolver.ts`, `packages/contracts/openapi.yaml`, `packages/contracts/generated/`,
  `packages/ledger-sql/src/bootstrap-admin.ts`
- **Sequencing/depends-on**: IC-04, IC-06 (service d'audit)
- **Risks**: portée d'un `PLATFORM_ADMIN` (aucun prestataire) : uniquement par l'objet du chemin.

### IC-06 — Service d'audit applicatif

- **Purpose**: `AuditService.record(client, entrée)` dans la transaction de l'action (acteur, rôle exercé, action,
  objet, avant, après, valideur, origine = IP ou terminal, `X-Request-Id`).
- **Relevant requirements**: FR-002, FR-008, NFR-004
- **Affected surfaces**: `apps/api/src/audit/`
- **Sequencing/depends-on**: IC-02
- **Risks**: oublier une action ; chaque test d'intégration vérifie la ligne d'audit attendue.

### IC-07 — Demandes d'approbation et registre d'actions

- **Purpose**: Registre générique (`ApprovalAction` → rôle exigé, portée, exécuteur), `ApprovalService` (création
  `202`, décision + exécution unique dans la même transaction avec `SAVEPOINT`, refus avec note, `EXPIRED` validé
  avant de répondre `409`), 4 routes `/approval-requests` (liste filtrée et paginée par curseur), `approved_by` des
  corps ignoré ; action de démonstration dans les tests.
- **Relevant requirements**: FR-009, FR-010, FR-011, FR-012, FR-013, C-001, C-002
- **Affected surfaces**: `apps/api/src/approval/`, `apps/api/src/idempotency/` (problème « validé » enregistré
  dans la transaction)
- **Sequencing/depends-on**: IC-03, IC-05, IC-06
- **Risks**: une exécution qui échoue ne doit laisser ni écriture partielle ni demande `APPROVED` orpheline.

### IC-08 — Jeton d'approbation sur place

- **Purpose**: `@RequiresOnsiteApproval({ operationId, role })` : `X-Approval-Token` obligatoire, vérification
  (signature, audience d'approbation, expiration, `act`, `act_hash` de la requête canonique, `sub` ≠ appelant, rôle
  du sujet sur la portée), consommation atomique du `jti` dans `approval_token_use`, valideur exposé au contrôleur ;
  ligne d'audit ; route de démonstration dans les tests.
- **Relevant requirements**: FR-014, FR-013, NFR-003
- **Affected surfaces**: `apps/api/src/approval/onsite-approval.guard.ts`, `apps/api/src/approval/act-hash.ts`
- **Sequencing/depends-on**: IC-03, IC-04
- **Risks**: consommer le jeton hors de la transaction métier : la consommation se fait dans `IdempotentTx`.

### IC-09 — Garde de la transaction idempotente (RISK-2)

- **Purpose**: Test d'architecture : toute méthode de contrôleur `@Idempotent` reçoit `@IdempotentTransaction()` et
  n'injecte pas `TenantTx` pour écrire ; garde d'exécution qui refuse (500 journalisé) une route `@Idempotent` dont
  la réponse n'a pas été enregistrée par `IdempotentTx.run` quand le contrôleur déclare `writes: true`.
- **Relevant requirements**: FR-015
- **Affected surfaces**: `apps/api/src/idempotency/`, `apps/api/test/unit/architecture.spec.ts`
- **Sequencing/depends-on**: aucune
- **Risks**: faux positifs sur des routes en lecture ; la règle vise les routes `@Idempotent` seulement.

### IC-10 — Preuves de bout en bout, CI et documentation

- **Purpose**: Tests d'intégration à deux prestataires sur toutes les nouvelles routes, scénario complet d'une
  action à deux (demande, refus de l'auteur, approbation, exécution, audit), jeton sur place concurrent ; CI
  inchangée dans sa forme (nouvelles suites pgTAP et Jest prises automatiquement) ; `research.md` mis à jour des
  contradictions (FR-017) ; non-régression de la mission 1.
- **Relevant requirements**: SC-001 à SC-005, NFR-001 à NFR-007, FR-017
- **Affected surfaces**: `apps/api/test/integration/identity/`, `kitty-specs/identite-roles-double-validation-01M4DNDN/research.md`
- **Sequencing/depends-on**: IC-01 à IC-09
- **Risks**: durée de la suite ; rester sous NFR-007 de la mission 1 (pipeline < 15 min).
