# Tasks — Configuration, parties et événements

Mission `configuration-parties-evenements-01M4GCJ9` · branche `feat/configuration-parties-evenements` (planification et merge).
Sources : [spec.md](spec.md), [plan.md](plan.md), [research.md](research.md), [data-model.md](data-model.md),
[contracts/](contracts/), [quickstart.md](quickstart.md).

Le suivi d'avancement est **événementiel** (`spec-kitty agent tasks mark-status Txxx --status done`) : les lignes
`Txxx` ci-dessous sont des références, pas des cases à cocher.

## Subtask Index

| ID | Description | WP | Parallel |
|---|---|---|---|
| T001 | Colonnes d'événement et de participation, table des devises | WP01 | |
| T002 | Gardes de cohérence des références | WP01 | |
| T003 | Immuabilité des objets versionnés | WP01 | |
| T004 | Borne de la législation sur l'événement | WP01 | |
| T005 | Tests pgTAP `tests/tests_configuration.sql` | WP01 | |
| T006 | `open_event_ledger(p_event uuid) RETURNS uuid` | WP02 | |
| T007 | `open_participation_account(p_participation uuid) RETURNS uuid` | WP02 | |
| T008 | `event_transition_conditions(p_event uuid, p_to event_status)` | WP02 | |
| T009 | Tests pgTAP `tests/tests_event_ledger.sql` | WP02 | |
| T010 | Migration `0009_platform_scope.sql` | WP03 | |
| T011 | `post-roles.sql` : rôle `cashless_platform`, droits, politiques | WP03 | |
| T012 | `migrate.ts`, CI, variables locales | WP03 | |
| T013 | Tests pgTAP `tests/tests_platform_scope.sql` | WP03 | |
| T014 | Schémas | WP04 | |
| T015 | Routes de plateforme | WP04 | |
| T016 | Routes d'un prestataire | WP04 | |
| T017 | `ApprovalAction`, génération et contrôle | WP04 | |
| T018 | Configuration et second pool | WP05 | |
| T019 | `PlatformTx` | WP05 | |
| T020 | Idempotence de plateforme | WP05 | |
| T021 | Approbations de plateforme | WP05 | |
| T022 | Tests | WP05 | |
| T023 | Catalogue des réglages | WP06 | |
| T024 | Valeurs provisoires | WP06 | |
| T025 | Cascade versionnée | WP06 | |
| T026 | Bornes et messages | WP06 | |
| T027 | Tests | WP06 | |
| T028 | Profils de législation | WP07 | |
| T029 | Prestataires | WP07 | |
| T030 | Contrats et règles de plateforme | WP07 | |
| T031 | Actions à deux de plateforme | WP07 | |
| T032 | Tests d'intégration | WP07 | |
| T033 | Configuration prestataire et organisateur | WP08 | |
| T034 | Organisateurs et commerçants | WP08 | |
| T035 | Contrats `OPERATOR_ORGANIZER` | WP08 | |
| T036 | Règles de frais `OPERATOR_CONTRACT` | WP08 | |
| T037 | Tests d'intégration | WP08 | |
| T038 | Création | WP09 | |
| T039 | Lecture et configuration résolue | WP09 | |
| T040 | Modification | WP09 | |
| T041 | Tests d'intégration | WP09 | |
| T042 | Participations | WP10 | |
| T043 | Points de vente | WP10 | |
| T044 | Règles de frais `EVENT` et `PARTICIPATION` | WP10 | |
| T045 | Actions et tests | WP10 | |
| T046 | Conditions | WP11 | |
| T047 | Passages | WP11 | |
| T048 | Action `EVENT_GO_LIVE` | WP11 | |
| T049 | Tests d'intégration | WP11 | |
| T050 | `SqlConfigResolver` | WP12 | |
| T051 | Fourniture au moteur | WP12 | |
| T052 | Rejeu du scénario sur une configuration construite par l'API | WP12 | |
| T053 | Tests unitaires et d'intégration du résolveur | WP12 | |
| T054 | Parcours de bout en bout | WP13 | |
| T055 | Balayage d'isolation | WP13 | |
| T056 | Latence (NFR-003) | WP13 | |
| T057 | Non-régression, CI et décisions | WP13 | |

## Ordre et parallélisme

- Base : WP01 → WP02 → WP03. Contrat : WP04 (indépendant, en parallèle de la base).
- Socle API : WP05 (après WP03, WP04) et WP06 (après WP01, WP04) en parallèle.
- Routes : WP07 → WP08 → WP09 → WP10 → WP11 (chaîne linéaire : chacun ajoute son module à `app.module.ts` ou à `EventsModule`).
- Moteur : WP12 ; preuves : WP13.
- MVP : WP01 à WP09 (hiérarchie créable, événement avec grand livre).

## WP01 — Intégrité de la configuration en base (migration 0007)

**Prompt** : [tasks/WP01-integrite-configuration-base.md](tasks/WP01-integrite-configuration-base.md) · **Phase** : Phase 1 - Base de données · **Dépend de** : aucune · **Exigences** : FR-007, FR-008, FR-009, FR-012, FR-014, FR-015

Durcir en base les tables de configuration déjà présentes : colonnes manquantes (X-4, X-5), immuabilité des objets versionnés, cohérence des références et bornes de la législation, chaque contrainte prouvée par pgTAP.

Sous-tâches :

T001 Colonnes d'événement et de participation, table des devises (WP01)
T002 Gardes de cohérence des références (WP01)
T003 Immuabilité des objets versionnés (WP01)
T004 Borne de la législation sur l'événement (WP01)
T005 Tests pgTAP `tests/tests_configuration.sql` (WP01)

Risques : Le rejeu du scénario (`apps/api/test/scenario/fixture.ts`) crée ses objets en propriétaire : un déclencheur trop strict casse la suite de référence de la mission 1. Les déclencheurs doivent valider les données réelles du scénario. `scenario_reference_test.sql` est généré : ne jamais le modifier ; s'il casse, c'est la migration qu'il faut corriger.

## WP02 — Grand livre d'événement et conditions de passage (migration 0008)

**Prompt** : [tasks/WP02-grand-livre-evenement-conditions.md](tasks/WP02-grand-livre-evenement-conditions.md) · **Phase** : Phase 1 - Base de données · **Dépend de** : WP01 · **Exigences** : FR-011, FR-012, FR-017

Ouvrir en base le grand livre et les comptes d'un événement, le compte d'une participation, et exposer en lecture les conditions que `set_event_status` vérifie.

Sous-tâches :

T006 `open_event_ledger(p_event uuid) RETURNS uuid` (WP02)
T007 `open_participation_account(p_participation uuid) RETURNS uuid` (WP02)
T008 `event_transition_conditions(p_event uuid, p_to event_status)` (WP02)
T009 Tests pgTAP `tests/tests_event_ledger.sql` (WP02)

Risques : Une divergence entre `event_transition_conditions` et `set_event_status` tromperait le back-office : les tests croisés de T009 sont l'arbitre. `ledger` : `UPDATE` interdit au rôle applicatif — l'ouverture n'en fait pas.

## WP03 — Rôle et portée plateforme en base (migration 0009, post-roles)

**Prompt** : [tasks/WP03-role-portee-plateforme.md](tasks/WP03-role-portee-plateforme.md) · **Phase** : Phase 1 - Base de données · **Dépend de** : WP02 · **Exigences** : FR-001, FR-019

Créer le rôle de base de la plateforme et sa portée : politiques nominatives, droits, idempotence et demandes d'approbation de niveau plateforme, nouvelles actions, et retrait au rôle applicatif des écritures de plateforme.

Sous-tâches :

T010 Migration `0009_platform_scope.sql` (WP03)
T011 `post-roles.sql` : rôle `cashless_platform`, droits, politiques (WP03)
T012 `migrate.ts`, CI, variables locales (WP03)
T013 Tests pgTAP `tests/tests_platform_scope.sql` (WP03)

Risques : Une politique `TO cashless_platform` oubliée laisse le rôle sans accès (fail-closed, détecté par T013) ; une politique sans `TO` donnerait l'accès à `cashless_app` (faille) : chaque politique ajoutée est nominative. `SET LOCAL ROLE` dans pgTAP : le propriétaire doit être membre des deux rôles (GRANT dans la suite si besoin, dans la transaction annulée).

## WP04 — Contrat d'API : routes et schémas back-office, types régénérés

**Prompt** : [tasks/WP04-contrat-api-back-office.md](tasks/WP04-contrat-api-back-office.md) · **Phase** : Phase 1 - Contrat · **Dépend de** : aucune · **Exigences** : FR-021

Décrire dans `openapi.yaml` toutes les opérations et schémas de la mission avant leur implémentation (C-008), puis régénérer les types TypeScript.

Sous-tâches :

T014 Schémas (WP04)
T015 Routes de plateforme (WP04)
T016 Routes d'un prestataire (WP04)
T017 `ApprovalAction`, génération et contrôle (WP04)

Risques : Ce WP est le seul propriétaire de `openapi.yaml` : les WP suivants qui découvrent un manque l'ajoutent par une modification minime justifiée dans leur commit, plutôt que de diverger du contrat.

## WP05 — Transaction, idempotence et approbations de plateforme dans l'API

**Prompt** : [tasks/WP05-transaction-plateforme-api.md](tasks/WP05-transaction-plateforme-api.md) · **Phase** : Phase 2 - Socle API · **Dépend de** : WP03, WP04 · **Exigences** : FR-001, FR-019, FR-020, FR-021

Donner à l'API son accès de plateforme : second pool, `PlatformTx`, idempotence et demandes d'approbation de niveau plateforme, sans affaiblir le confinement du pool applicatif.

Sous-tâches :

T018 Configuration et second pool (WP05)
T019 `PlatformTx` (WP05)
T020 Idempotence de plateforme (WP05)
T021 Approbations de plateforme (WP05)
T022 Tests (WP05)

Risques : Ne pas laisser l'intercepteur choisir la transaction plateforme sur un indice de la requête : seule l'option déclarative de la route en décide. Une personne de plateforme sur `/operators/{id}/…` reste servie par la transaction du prestataire du chemin (comportement de la mission 2).

## WP06 — Catalogue des réglages, cascade versionnée, bornes et valeurs provisoires

**Prompt** : [tasks/WP06-catalogue-cascade-bornes.md](tasks/WP06-catalogue-cascade-bornes.md) · **Phase** : Phase 2 - Socle API · **Dépend de** : WP01, WP04 · **Exigences** : FR-003, FR-010, FR-014, FR-015

Construire le cœur réutilisable de la configuration : ce qu'est chaque réglage, qui le règle, ses bornes, comment les niveaux se résolvent à une date, et comment un refus cite sa règle.

Sous-tâches :

T023 Catalogue des réglages (WP06)
T024 Valeurs provisoires (WP06)
T025 Cascade versionnée (WP06)
T026 Bornes et messages (WP06)
T027 Tests (WP06)

Risques : Dupliquer une borne du schéma avec une valeur différente = refus incohérents : le test T023 compare les deux.

## WP07 — Plateforme : profils de législation, prestataires, contrats et règles de plateforme

**Prompt** : [tasks/WP07-routes-plateforme.md](tasks/WP07-routes-plateforme.md) · **Phase** : Phase 3 - Routes · **Dépend de** : WP05, WP06 · **Exigences** : FR-002, FR-003, FR-004, FR-007, FR-008, FR-019, FR-020

Publier les routes de plateforme : profils de législation (avec valeurs provisoires), prestataires, contrats `PLATFORM_OPERATOR`, versions de configuration `PLATFORM`, règles `PLATFORM_CONTRACT`, et les deux actions à deux de plateforme.

Sous-tâches :

T028 Profils de législation (WP07)
T029 Prestataires (WP07)
T030 Contrats et règles de plateforme (WP07)
T031 Actions à deux de plateforme (WP07)
T032 Tests d'intégration (WP07)

Risques : Ne jamais utiliser le pool applicatif pour une écriture de plateforme (le test d'architecture de WP05 doit le prouver) ; ne jamais lire un `operator_id` dans le corps.

## WP08 — Organisation d'un prestataire : configuration, organisateurs, commerçants, contrats

**Prompt** : [tasks/WP08-organisation-prestataire.md](tasks/WP08-organisation-prestataire.md) · **Phase** : Phase 3 - Routes · **Dépend de** : WP07 · **Exigences** : FR-005, FR-006, FR-007, FR-008, FR-014, FR-019, FR-020

Publier les routes d'organisation d'un prestataire : configuration de niveau prestataire et organisateur, organisateurs, commerçants, contrats `OPERATOR_ORGANIZER` (nouvelle version à deux) et règles de frais `OPERATOR_CONTRACT`.

Sous-tâches :

T033 Configuration prestataire et organisateur (WP08)
T034 Organisateurs et commerçants (WP08)
T035 Contrats `OPERATOR_ORGANIZER` (WP08)
T036 Règles de frais `OPERATOR_CONTRACT` (WP08)
T037 Tests d'intégration (WP08)

Risques : Un `ORGANIZER_ADMIN` ne doit jamais régler une clé du prestataire (test dédié).

## WP09 — Événements : création avec grand livre, lecture, modification, configuration résolue

**Prompt** : [tasks/WP09-evenements.md](tasks/WP09-evenements.md) · **Phase** : Phase 3 - Routes · **Dépend de** : WP02, WP08 · **Exigences** : FR-009, FR-010, FR-011, FR-014, FR-015, FR-019, FR-020

Créer un événement avec son grand livre et ses comptes, le lire, le modifier par qui de droit (à deux pendant `LIVE`) et exposer sa configuration résolue.

Sous-tâches :

T038 Création (WP09)
T039 Lecture et configuration résolue (WP09)
T040 Modification (WP09)
T041 Tests d'intégration (WP09)

Risques : `open_event_ledger` doit être appelée dans la même transaction que l'insertion : jamais de second appel hors `IdempotentTx.run`.

## WP10 — Participations, points de vente et règles de frais d'événement

**Prompt** : [tasks/WP10-participations-points-de-vente-frais.md](tasks/WP10-participations-points-de-vente-frais.md) · **Phase** : Phase 3 - Routes · **Dépend de** : WP09 · **Exigences** : FR-008, FR-012, FR-013, FR-019, FR-020

Inscrire les commerçants aux événements (compte commerçant créé), gérer leurs points de vente, et régler les frais de portée `EVENT` et `PARTICIPATION`, à deux pendant `LIVE`.

Sous-tâches :

T042 Participations (WP10)
T043 Points de vente (WP10)
T044 Règles de frais `EVENT` et `PARTICIPATION` (WP10)
T045 Actions et tests (WP10)

Risques : La commission est portée par la participation (règle `PARTICIPATION`), jamais par le commerçant.

## WP11 — Statuts d'événement : conditions visibles, passages, LIVE à deux

**Prompt** : [tasks/WP11-statuts-evenement.md](tasks/WP11-statuts-evenement.md) · **Phase** : Phase 3 - Routes · **Dépend de** : WP10 · **Exigences** : FR-017, FR-018, FR-019, FR-020

Exposer les conditions de passage et leur état, appliquer les passages par `set_event_status`, et faire passer `LIVE` par une demande à deux.

Sous-tâches :

T046 Conditions (WP11)
T047 Passages (WP11)
T048 Action `EVENT_GO_LIVE` (WP11)
T049 Tests d'intégration (WP11)

Risques : Aucun chemin ne doit écrire `event.status` directement (le déclencheur refuserait de toute façon : test).

## WP12 — Résolveur de configuration réel et rejeu du scénario sur une configuration construite par l'API

**Prompt** : [tasks/WP12-resolveur-configuration-sql.md](tasks/WP12-resolveur-configuration-sql.md) · **Phase** : Phase 4 - Moteur · **Dépend de** : WP11 · **Exigences** : FR-016

Remplacer les fixtures du port `ConfigResolver` par une implémentation qui lit la configuration réelle, et prouver qu'elle redonne exactement la configuration du scénario de référence.

Sous-tâches :

T050 `SqlConfigResolver` (WP12)
T051 Fourniture au moteur (WP12)
T052 Rejeu du scénario sur une configuration construite par l'API (WP12)
T053 Tests unitaires et d'intégration du résolveur (WP12)

Risques : Une différence d'une unité révèle une règle mal traduite (taux en points de base, TTC, minimum/maximum) : comparer règle par règle avec `scenarioConfig()` avant de chercher ailleurs. Ne jamais ajuster le scénario pour faire passer le test.

## WP13 — Preuves de bout en bout, isolation, performance, CI et décisions

**Prompt** : [tasks/WP13-preuves-bout-en-bout-ci-docs.md](tasks/WP13-preuves-bout-en-bout-ci-docs.md) · **Phase** : Phase 5 - Preuves · **Dépend de** : WP12 · **Exigences** : FR-020, FR-021

Prouver la mission de bout en bout, balayer l'isolation sur toutes les routes, mesurer la latence, répéter la CI et consigner les décisions.

Sous-tâches :

T054 Parcours de bout en bout (WP13)
T055 Balayage d'isolation (WP13)
T056 Latence (NFR-003) (WP13)
T057 Non-régression, CI et décisions (WP13)

Risques : Le balayage d'isolation doit être piloté par le contrat, pas par une liste écrite à la main.

