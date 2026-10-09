# Tasks — Identité, rôles et double validation

Mission `identite-roles-double-validation-01M4DNDN` · branche `feat/identite-roles` (planification et merge).
Sources : [spec.md](spec.md), [plan.md](plan.md), [research.md](research.md), [data-model.md](data-model.md),
[contracts/](contracts/), [quickstart.md](quickstart.md).

Le suivi d'avancement est **événementiel** (`spec-kitty agent tasks mark-status Txxx --status done`) : les lignes
`Txxx` ci-dessous sont des références, pas des cases à cocher.

## Subtask Index

| ID | Description | WP | Parallel |
|---|---|---|---|
| T001 | Tables `app_user` et `role_assignment`, contraintes | WP01 | |
| T002 | Gardes : immuabilité, portée du même prestataire, auto-attribution, dernier `PLATFORM_ADMIN`, pas de rétablissement | WP01 | |
| T003 | RLS forcée et fonction `identify_person` | WP01 | |
| T004 | Tests pgTAP `tests_identity.sql` | WP01 | |
| T005 | Table `audit_log`, déclencheur de chaînage, refus de modification | WP02 | |
| T006 | Ligne canonique et empreintes (`audit_row_canonical`) | WP02 | |
| T007 | Table `audit_seal` et `seal_audit` | WP02 | |
| T008 | `verify_audit_chain` | WP02 | |
| T009 | Tests pgTAP `tests_audit_log.sql` (dont altérations simulées) | WP02 | |
| T010 | Migration 0005 : `approval_request.result`, `approval_token_use` | WP03 | |
| T011 | `post-roles.sql` et rejeu par `migrate.ts` | WP03 | |
| T012 | Commande d'amorçage du premier `PLATFORM_ADMIN` | WP03 | |
| T013 | Tests pgTAP `tests_approvals.sql` (droits effectifs, jetons) | WP03 | |
| T014 | Configuration OIDC, dépendance `jose`, chargement ESM en test | WP04 | |
| T015 | Port `IdentityVerifier` et implémentation `jose` | WP04 | |
| T016 | Faux serveur d'identité de test | WP04 | [P] |
| T017 | Garde d'authentification globale et `Principal` | WP04 | |
| T018 | `TENANT_CONTEXT` de production et câblage | WP04 | |
| T019 | Tests d'authentification (401, 503, isolation) | WP04 | |
| T020 | `ScopeResolver` (chaînes de portées) | WP05 | |
| T021 | `@Roles` et `RolesGuard` | WP05 | |
| T022 | `AuditService` et `AuditModule` | WP05 | [P] |
| T023 | Origine et identifiant de requête des lignes d'audit | WP05 | |
| T024 | Tests rôles, portées, audit | WP05 | |
| T025 | Routes ajoutées à `openapi.yaml`, types régénérés | WP06 | |
| T026 | Service des personnes (créer, lister, consulter, désactiver) | WP06 | |
| T027 | Attribution et retrait de rôle (règles de §3.1) | WP06 | |
| T028 | Contrôleurs `/operators/{operator_id}/…` et `/platform-admins` | WP06 | |
| T029 | Tests d'intégration de la gestion des personnes | WP06 | |
| T030 | Problème « validé » enregistré dans la transaction | WP07 | [P] |
| T031 | Garde d'exécution `@Idempotent({ writes: true })` | WP07 | |
| T032 | Test d'architecture RISK-2 | WP07 | |
| T033 | Tests de l'extension d'idempotence | WP07 | |
| T034 | Registre des actions à deux | WP08 | |
| T035 | Création d'une demande (`202`) | WP08 | |
| T036 | Approbation : décision, exécution en point de sauvegarde, expiration | WP08 | |
| T037 | Refus avec note | WP08 | |
| T038 | Routes `/approval-requests` (liste, consultation, approbation, refus) | WP08 | |
| T039 | Action de démonstration et tests d'intégration | WP08 | |
| T040 | Empreinte `act_hash` de la requête canonique | WP09 | [P] |
| T041 | Vérification du jeton d'approbation | WP09 | |
| T042 | Garde `@RequiresOnsiteApproval`, consommation, audit | WP09 | |
| T043 | Route de démonstration et tests (dont concurrence) | WP09 | |
| T044 | Scénario de bout en bout (amorçage → approbation → audit vérifié) | WP10 | |
| T045 | Balayage d'isolation de toutes les nouvelles routes | WP10 | |
| T046 | Non-régression complète et répétition CI | WP10 | |
| T047 | Contradictions consignées (FR-017) et quickstart vérifié | WP10 | |

## Phase 1 — Base de données

### WP01 — Schéma d'identité

- **Goal** : personnes, attributions de rôle et `identify_person` en base, sous RLS forcée, testés par pgTAP.
- **Priority** : P1 · **Independent test** : `npm run test:pgtap -w @cashless/ledger-sql` (nouvelle suite verte).
- **Prompt** : [tasks/WP01-schema-identite.md](tasks/WP01-schema-identite.md) · ~280 lignes
- **Dependencies** : aucune

T001 Tables `app_user` et `role_assignment`, contraintes (WP01)
T002 Gardes : immuabilité, portée du même prestataire, auto-attribution, dernier `PLATFORM_ADMIN`, pas de rétablissement (WP01)
T003 RLS forcée et fonction `identify_person` (WP01)
T004 Tests pgTAP `tests_identity.sql` (WP01)

### WP02 — Journal d'audit chaîné et scellé

- **Goal** : `audit_log` en ajout seul, chaîné par prestataire, scellements et vérification.
- **Priority** : P1 · **Independent test** : pgTAP, altérations simulées détectées.
- **Prompt** : [tasks/WP02-journal-audit-chaine.md](tasks/WP02-journal-audit-chaine.md) · ~320 lignes
- **Dependencies** : WP01

T005 Table `audit_log`, déclencheur de chaînage, refus de modification (WP02)
T006 Ligne canonique et empreintes (`audit_row_canonical`) (WP02)
T007 Table `audit_seal` et `seal_audit` (WP02)
T008 `verify_audit_chain` (WP02)
T009 Tests pgTAP `tests_audit_log.sql` (dont altérations simulées) (WP02)

### WP03 — Approbations en base, droits « après rôles », amorçage

- **Goal** : colonne `result`, utilisations de jetons, `post-roles.sql` rejoué, commande d'amorçage.
- **Priority** : P1 · **Independent test** : pgTAP des droits effectifs ; amorçage idempotent.
- **Prompt** : [tasks/WP03-approbations-base-post-roles.md](tasks/WP03-approbations-base-post-roles.md) · ~300 lignes
- **Dependencies** : WP02

T010 Migration 0005 : `approval_request.result`, `approval_token_use` (WP03)
T011 `post-roles.sql` et rejeu par `migrate.ts` (WP03)
T012 Commande d'amorçage du premier `PLATFORM_ADMIN` (WP03)
T013 Tests pgTAP `tests_approvals.sql` (droits effectifs, jetons) (WP03)

## Phase 2 — Identité dans l'API

### WP04 — Authentification et contexte de prestataire

- **Goal** : jeton OIDC vérifié, personne et prestataire déduits de la base, refus systématique remplacé.
- **Priority** : P1 · **Independent test** : tests d'authentification (chaque refus `401`, `503`, isolation).
- **Prompt** : [tasks/WP04-authentification-oidc.md](tasks/WP04-authentification-oidc.md) · ~420 lignes
- **Dependencies** : WP01

T014 Configuration OIDC, dépendance `jose`, chargement ESM en test (WP04)
T015 Port `IdentityVerifier` et implémentation `jose` (WP04)
T016 Faux serveur d'identité de test (WP04)
T017 Garde d'authentification globale et `Principal` (WP04)
T018 `TENANT_CONTEXT` de production et câblage (WP04)
T019 Tests d'authentification (401, 503, isolation) (WP04)

### WP05 — Rôles, portées et service d'audit

- **Goal** : contrôle déclaratif des rôles par portée et écriture des lignes d'audit dans la transaction.
- **Priority** : P1 · **Independent test** : `403` hors portée, ligne d'audit chaînée par action.
- **Prompt** : [tasks/WP05-roles-portees-audit.md](tasks/WP05-roles-portees-audit.md) · ~330 lignes
- **Dependencies** : WP02, WP04

T020 `ScopeResolver` (chaînes de portées) (WP05)
T021 `@Roles` et `RolesGuard` (WP05)
T022 `AuditService` et `AuditModule` (WP05)
T023 Origine et identifiant de requête des lignes d'audit (WP05)
T024 Tests rôles, portées, audit (WP05)

### WP06 — Gestion des personnes et des rôles

- **Goal** : 7 routes ajoutées au contrat, règles « qui peut donner quoi », chaque action journalisée.
- **Priority** : P1 · **Independent test** : tests d'intégration à deux prestataires.
- **Prompt** : [tasks/WP06-gestion-personnes-roles.md](tasks/WP06-gestion-personnes-roles.md) · ~380 lignes
- **Dependencies** : WP03, WP05

T025 Routes ajoutées à `openapi.yaml`, types régénérés (WP06)
T026 Service des personnes (créer, lister, consulter, désactiver) (WP06)
T027 Attribution et retrait de rôle (règles de §3.1) (WP06)
T028 Contrôleurs `/operators/{operator_id}/…` et `/platform-admins` (WP06)
T029 Tests d'intégration de la gestion des personnes (WP06)

## Phase 3 — Double validation

### WP07 — Extensions de l'idempotence (problème validé, garde RISK-2)

- **Goal** : enregistrer une réponse d'erreur en validant le travail (demande expirée) ; détecter les routes
  idempotentes qui écrivent hors de `IdempotentTx`.
- **Priority** : P2 · **Independent test** : tests de l'extension et test d'architecture.
- **Prompt** : [tasks/WP07-idempotence-extensions.md](tasks/WP07-idempotence-extensions.md) · ~250 lignes
- **Dependencies** : aucune

T030 Problème « validé » enregistré dans la transaction (WP07)
T031 Garde d'exécution `@Idempotent({ writes: true })` (WP07)
T032 Test d'architecture RISK-2 (WP07)
T033 Tests de l'extension d'idempotence (WP07)

### WP08 — Demandes d'approbation au back-office

- **Goal** : registre d'actions, demande `202`, approbation avec exécution unique, refus, 4 routes.
- **Priority** : P1 · **Independent test** : action de démonstration de bout en bout.
- **Prompt** : [tasks/WP08-approbations-back-office.md](tasks/WP08-approbations-back-office.md) · ~460 lignes
- **Dependencies** : WP06, WP07

T034 Registre des actions à deux (WP08)
T035 Création d'une demande (`202`) (WP08)
T036 Approbation : décision, exécution en point de sauvegarde, expiration (WP08)
T037 Refus avec note (WP08)
T038 Routes `/approval-requests` (liste, consultation, approbation, refus) (WP08)
T039 Action de démonstration et tests d'intégration (WP08)

### WP09 — Jeton d'approbation sur place

- **Goal** : garde `X-Approval-Token` réutilisable, usage unique, lié à la requête.
- **Priority** : P2 · **Independent test** : route de démonstration, chaque refus, concurrence.
- **Prompt** : [tasks/WP09-jeton-approbation-sur-place.md](tasks/WP09-jeton-approbation-sur-place.md) · ~330 lignes
- **Dependencies** : WP08

T040 Empreinte `act_hash` de la requête canonique (WP09)
T041 Vérification du jeton d'approbation (WP09)
T042 Garde `@RequiresOnsiteApproval`, consommation, audit (WP09)
T043 Route de démonstration et tests (dont concurrence) (WP09)

## Phase 4 — Preuves

### WP10 — Preuves de bout en bout et non-régression

- **Goal** : parcours complet, balayage d'isolation, non-régression, contradictions consignées.
- **Priority** : P1 · **Independent test** : suite complète verte, répétition CI.
- **Prompt** : [tasks/WP10-preuves-bout-en-bout.md](tasks/WP10-preuves-bout-en-bout.md) · ~260 lignes
- **Dependencies** : WP09

T044 Scénario de bout en bout (amorçage → approbation → audit vérifié) (WP10)
T045 Balayage d'isolation de toutes les nouvelles routes (WP10)
T046 Non-régression complète et répétition CI (WP10)
T047 Contradictions consignées (FR-017) et quickstart vérifié (WP10)

## Parallélisme

- WP01 → WP02 → WP03 (base) en parallèle de WP04 (après WP01) et WP07 (indépendant).
- WP06, WP08, WP09 sont chaînés volontairement : chacun ajoute son module au module racine de l'API ; la chaîne
  évite des conflits de fusion sur ce fichier.

## MVP

WP01 + WP04 : une personne authentifiée agit dans son seul prestataire (débloque toutes les missions suivantes).
