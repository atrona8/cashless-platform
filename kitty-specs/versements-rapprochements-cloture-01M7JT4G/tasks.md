# Tasks: Versements, rapprochements et clôture

**Mission** : `versements-rapprochements-cloture-01M7JT4G` · **Branche** : `feat/versements-rapprochements-cloture`
(planification et fusion)
**Sources** : `spec.md`, `plan.md` (IC-00 à IC-10), `research.md` (R-01 à R-16), `data-model.md`,
`contracts/contract-additions.md` (**validé par le porteur le 17/11/2026 : fait foi pour le contrat**),
`contracts/interfaces.md` (**noms, propriétaires, codes d'alarme, ordre des verrous : fait foi**). Fiche commune des
agents : `docs/passation-9b/fiche-implementation.md` ; décisions du porteur : `docs/passation-9b/contexte-9b.md`.

## Règles communes

- **Sources** : priorité de SPECIFICATION §0.3 ; toute contradiction est signalée.
- **Base** :
  - aucun `.sql` généré modifié, et le schéma de référence n'est pas touché (migrations `0083`+ seulement) ;
  - **seul WP06 écrit `post-roles.sql`** : les lots de migration (WP02 à WP05) testent leurs objets en propriétaire.
    WP06 pose ensuite tous les droits et les teste.
- **Sécurité et contrat** :
  - aucun écart qui affaiblit la sécurité sans accord du porteur (règle 1 de `CLAUDE.md`) ;
  - le contrat est exactement `contract-additions.md` : rien d'autre n'est ajouté, rien d'existant n'est modifié ;
  - paiement manuel.
- **Code** : lignes de 100 caractères ; aucune dépendance nouvelle.
- **Tests** : en série par l'orchestrateur, sur la base partagée.
- **`apps/api/src/app.module.ts`** est possédé par WP07. Les autres lots qui ajoutent un module y font une seule ligne
  d'import, hors carte, signalée dans leur note de lane (union à la consolidation).

## Subtask Index

| ID | Description | WP | Parallel |
|---|---|---|---|
| T001 | `openapi.yaml` : 20 opérations, schémas, valeurs `StatusCondition.code`, `PAYOUT_EXCEEDS_ENTITLEMENT` | WP01 | |
| T002 | Régénération TS et Dart ; `npm run check -w @cashless/contracts` | WP01 | |
| T003 | Test de non-régression du contrat : aucun `operationId`, chemin, champ ni valeur d'enum existant modifié | WP01 | |
| T004 | `sqlstate-map.ts` : `CL055` → `PAYOUT_EXCEEDS_ENTITLEMENT` | WP01 | [P] |
| T005 | `common/csv.ts` (écriture RFC 4180, lecture, anti-injection) et tests unitaires | WP01 | [P] |
| T006 | `common/iban.ts` (`isValidIban`, `normalizeIban`, masquage) et tests unitaires | WP01 | [P] |
| T007 | 0083 : `statement_import`, colonnes d'`external_statement_line`, garde de portée | WP02 | |
| T008 | 0083 : `import_statement_lines` (dédoublonnage, rapprochement automatique par tables sources) | WP02 | |
| T009 | 0083 : `match_statement_line`, `account_reconciliation` (anomalies PSP représentées) | WP02 | |
| T010 | 0084 : `closing_step`, `record_closing_step` | WP02 | |
| T011 | 0084 : `set_event_status` et `event_transition_conditions` redéfinies (4 conditions) | WP02 | |
| T012 | pgTAP `tests_statements.sql`, `tests_closing_conditions.sql` (dont égalité des deux copies) | WP02 | |
| T013 | 0085 : colonnes de `payout`, CHECK, déclencheur de transition | WP03 | |
| T014 | 0085 : `create_payout_batch` (verrous, borne `CL055`, `PAYOUT_INITIATED`, lignes) | WP03 | |
| T015 | 0085 : `settle_payout` (`PAYOUT_CONFIRMED` / `PAYOUT_FAILED`, une fois) | WP03 | |
| T016 | pgTAP `tests_payouts.sql` (borne, cumul des en cours, transitions, deux personnes) | WP03 | |
| T017 | 0086 : `refund_request_transition_guard` (graphe, montant figé après `PROCESSING`) | WP04 | [P] |
| T018 | 0086 : `refund_deposit_for_session(…, p_actor, p_approver)` et `refund_deposit` qui transmet | WP04 | [P] |
| T019 | pgTAP `tests_refund_transitions.sql` (chaque transition interdite, promotion permise) | WP04 | |
| T020 | 0087 : `ops_ledgers_to_seal`, `ops_seal_ledger`, `ops_audit_chains_to_seal`, `ops_seal_audit`, `ops_record_seal_copy`, `ops_seals_since`, `ops_verify_ledger_seals`, `ops_verify_audit_chain` | WP05 | |
| T021 | 0087 : `ops_ledger_controls`, `ops_overdue_payouts`, `ops_unmatched_statements`, `ops_new_open_anomalies`, `ops_raise_alert`, `ops_long_transactions` | WP05 | |
| T022 | 0088 : `account_mapping`, `create_account_mapping_version` | WP05 | [P] |
| T023 | pgTAP `tests_ops_functions.sql`, `tests_account_mapping.sql` | WP05 | |
| T024 | `post-roles.sql` section 12 : droits de `cashless_app` (tables en lecture, fonctions nommées) | WP06 | |
| T025 | `post-roles.sql` section 12 : `cashless_maint` (fonctions `ops_*` seules) ; propriétaire de `ops_long_transactions` | WP06 | |
| T026 | pgTAP `tests_9b_rights.sql` : liste exacte des droits par rôle, échoue si elle s'élargit | WP06 | |
| T027 | Listes figées des suites de droits existantes (`tests_execute_grants`, `tests_offline_rights`…) | WP06 | |
| T028 | Module `closing` : contrôleur des routes 1 à 4, service, verrou par (événement, étape), état lu avant calcul | WP07 | |
| T029 | Calculateurs `PITCH_FEES` (avec transfert de dette), `OPERATOR_FEE` (assiettes), `PLATFORM_FEE` | WP07 | |
| T030 | Calculateurs `OPERATOR_FEE_REGULARIZATION` (R-04), `BREAKAGE` (destination `OPERATOR` : contradiction 4), `DEPOSIT_FORFEIT`, `PROMO_EXPIRY` | WP07 | |
| T031 | Exécution : moteur, clés `closing:<event>:<step>[:<id>]`, `record_closing_step`, audit | WP07 | |
| T032 | Relevé des soldes restants (route 4, JSON et CSV) | WP07 | |
| T033 | `status.service.ts` et `status-messages.ts` : nouveaux codes, `PSP_RECONCILED` calculée | WP07 | |
| T034 | Tests d'intégration : aperçu sans écriture, ordre, rejeu, 50 exécutions concurrentes | WP07 | |
| T035 | `EntitlementService` et route 5 (droits nets moins versements en cours) | WP08 | |
| T036 | Action `PAYOUT` (rôle selon le bénéficiaire, charge figée, `create_payout_batch`, `onClosed`) et route 6 | WP08 | |
| T037 | Routes 7 (liste) et 8 (export CSV du lot, non rejoué, IBAN rendu seulement ici) | WP08 | |
| T038 | Route 9 `confirmPayout` (`settle_payout`) | WP08 | |
| T039 | Tests d'intégration : borne, auteur ≠ valideur, rôles, export, confirmation, échec recrédité | WP08 | |
| T040 | Route 10 `importAccountStatement` (CSV, devise, compte, empreinte, réimport) | WP09 | |
| T041 | Routes 11 (lignes), 12 (rapprochement manuel), 13 (état par compte) | WP09 | |
| T042 | Tests d'intégration et mesure NFR-003 (10 000 lignes < 60 s, `SKIP_LATENCY`) | WP09 | |
| T043 | `moneyAccountFor` : `BANK_TRANSFER` → `A-BANQUE` ; `CASH` → caisse ouverte de la personne | WP10 | |
| T044 | Action `LATE_CLAIM` et route `postLateClaim` (contrat existant) | WP10 | |
| T045 | Action `ADJUSTMENT` et route 14 `postLateAdjustment` | WP10 | |
| T046 | Tests d'intégration : bornes `check_late_claim`, échéance, deux personnes, preuve du droit | WP10 | |
| T047 | Route 15 `createRefundRequest` (back-office, IBAN, `requested_by`) ; l'app garde son refus de `BANK_TRANSFER` | WP11 | |
| T048 | OP-N124 : vérification du code scindée (essais comptés à part, consommation dans la transaction de la décision) | WP11 | |
| T049 | OP-N126 : recrédit d'un `FAILED` borné par le rapprochement ou un second valideur | WP11 | |
| T050 | OP-N128 : `release.service.ts` passe le valideur ; cumul sous verrou des portefeuilles | WP11 | |
| T051 | Tests de borne inversés (`journey-limits`, `journey`, `create-refund-request`) et tests nouveaux | WP11 | |
| T052 | Port `SealExternalCopy`, `FakeSealCopy`, fabrique, jeton, `assertProcessIsSafe`, test de garde | WP12 | |
| T053 | Travailleurs `ledger-seal`, `audit-seal` (5 min), `seal-verify` (quotidien, « copie simulée ») | WP12 | |
| T054 | `OpsAlerts` ; boucle continue qui lit `alarm()` (`bootstrap.ts`) | WP12 | |
| T055 | Travailleurs `ledger-controls`, `payout-overdue`, `statement-unmatched`, `open-anomalies` | WP12 | |
| T056 | Travailleur `long-transactions` (10 s, sans texte de requête) | WP12 | |
| T057 | Tests : chaque contrôle échoue et lève son alerte (SC-005) ; altération détectée (SC-004) | WP12 | |
| T058 | Route 16 `getPartyStatement` (périmètre par partie, JSON et CSV) | WP13 | |
| T059 | Route 17 `getMyWalletStatement` (CSV) | WP13 | |
| T060 | Routes 18 `account-mappings` et 19 `exportAccounting` (non mappés signalés) | WP13 | |
| T061 | Tests d'intégration et mesure NFR-004 | WP13 | |
| T062 | Scénario de référence de bout en bout `closing-journey.spec.ts` (SC-001, NFR-002) | WP14 | |
| T063 | Concurrence (NFR-001) et invariants de clôture | WP14 | |
| T064 | Consignation : OP et ADR des écarts acceptés (copie simulée, alertes), ADR des renforcements, levées OP-N123 à N130, SPECIFICATION §3.2 amendée, PRD, PROMPTS | WP14 | |
| T065 | Note aux équipes clientes (`REPONSE-ENDPOINTS-BACKOFFICE-9B.md`) | WP14 | |

## Phase 1 — Fondations (en parallèle)

### WP01 — Contrat et utilitaires communs

- **Goal** : écrire exactement `contract-additions.md` dans `openapi.yaml`, régénérer les types, poser `CL055`, et livrer
  `csv.ts` et `iban.ts` partagés.
- **Priority** : P1 (bloque toutes les routes).
- **Independent test** : `npm run check -w @cashless/contracts` vert ; test de non-régression du contrat ; tests
  unitaires CSV et IBAN.
- **Dependencies** : none.
- **Requirement refs** : C-002, FR-011, FR-013, FR-017, FR-022, FR-023.
- **Owned files** : `packages/contracts/openapi.yaml`, `packages/contracts/generated/**`, `packages/contracts/dart/**`,
  `apps/api/src/errors/sqlstate-map.ts`, `apps/api/src/common/csv.ts`, `apps/api/src/common/iban.ts`,
  `apps/api/test/unit/common/csv.spec.ts`, `apps/api/test/unit/common/iban.spec.ts`,
  `apps/api/test/unit/contracts/contract-additions-9b.spec.ts`.
- **Risks** :
  - modèle `oneOf` de `$ref` : la génération Dart casse ;
  - un champ existant modifié par mégarde, que le test de non-régression doit attraper ;
  - injection de formules dans un CSV (`=`, `+`, `-`, `@`).

T001 `openapi.yaml` : opérations, schémas, enum, code (WP01)
T002 Régénération TS et Dart (WP01)
T003 Test de non-régression du contrat (WP01)
T004 `sqlstate-map.ts` : `CL055` (WP01)
T005 `common/csv.ts` (WP01)
T006 `common/iban.ts` (WP01)

### WP02 — Base : relevés, rapprochement, conditions de passage, étapes de clôture

- **Goal** : migrations `0083` (relevés) et `0084` (étapes et conditions).
- **Priority** : P1.
- **Independent test** : `tests_statements.sql` et `tests_closing_conditions.sql` passent en propriétaire ; les deux
  copies des conditions rendent les mêmes codes.
- **Dependencies** : none.
- **Requirement refs** : FR-001, FR-002, FR-004, FR-008, FR-013, FR-014, FR-015, C-004.
- **Owned files** : `packages/ledger-sql/migrations/0083_statements.sql`,
  `packages/ledger-sql/migrations/0084_closing_conditions_steps.sql`, `packages/ledger-sql/tests/tests_statements.sql`,
  `packages/ledger-sql/tests/tests_closing_conditions.sql`.
- **Risks** :
  - garder l'ordre des verrous de `set_event_status` ;
  - `UNIQUE (source, external_ref)` existante conservée ;
  - à faire relire par une personne.

T007 0083 : `statement_import`, colonnes, garde (WP02)
T008 0083 : `import_statement_lines` (WP02)
T009 0083 : `match_statement_line`, `account_reconciliation` (WP02)
T010 0084 : `closing_step`, `record_closing_step` (WP02)
T011 0084 : conditions redéfinies (WP02)
T012 pgTAP (WP02)

### WP03 — Base : versements

- **Goal** : migration `0085` : `payout` étendue et fermée, `create_payout_batch` avec la borne du droit net,
  `settle_payout`.
- **Priority** : P1.
- **Independent test** : `tests_payouts.sql` : 40 000 pour 39 225 refusé (`CL055`) ; deux lots qui cumulent au-delà
  refusés ; une ligne change de statut une fois.
- **Dependencies** : none.
- **Requirement refs** : FR-009, FR-010, FR-012, NFR-001.
- **Owned files** : `packages/ledger-sql/migrations/0085_payouts.sql`, `packages/ledger-sql/tests/tests_payouts.sql`.
- **Risks** :
  - ordre des verrous des comptes d'un bénéficiaire ;
  - droit net multi-comptes (`party_position`) ;
  - bénéficiaire `LEGAL` (compte sans titulaire) ;
  - à faire relire par une personne.

T013 0085 : colonnes, CHECK, déclencheur (WP03)
T014 0085 : `create_payout_batch` (WP03)
T015 0085 : `settle_payout` (WP03)
T016 pgTAP (WP03)

### WP04 — Base : dettes de la 9a (OP-N130, OP-N128)

- **Goal** : migration `0086` : déclencheur de transitions de `refund_request` ; `refund_deposit_for_session` avec
  valideur.
- **Priority** : P2.
- **Independent test** : `tests_refund_transitions.sql` : chaque transition interdite refusée ; promotion permise ;
  montant figé après `PROCESSING`.
- **Dependencies** : none.
- **Requirement refs** : FR-018, FR-019.
- **Owned files** : `packages/ledger-sql/migrations/0086_refund_debts.sql`,
  `packages/ledger-sql/tests/tests_refund_transitions.sql`.
- **Risks** :
  - ne pas casser le passage `REQUESTED` → `PROCESSING` de `wallet-refund-action.ts` (montant recalculé) ;
  - ancienne signature de `refund_deposit_for_session` gardée tant que WP11 ne l'a pas remplacée.

T017 0086 : déclencheur (WP04)
T018 0086 : `refund_deposit_for_session` avec valideur (WP04)
T019 pgTAP (WP04)

### WP05 — Base : fonctions d'exploitation et correspondance comptable

- **Goal** : migrations `0087` (`ops_*`) et `0088` (`account_mapping`).
- **Priority** : P2.
- **Independent test** : `tests_ops_functions.sql` : chaque fonction rend seulement les écarts ;
  `ops_long_transactions` ne rend jamais `query` ; `tests_account_mapping.sql` : versions en ajout seul.
- **Dependencies** : none.
- **Requirement refs** : FR-020, FR-021, FR-023, NFR-005, NFR-006, C-005, C-010, C-011.
- **Owned files** : `packages/ledger-sql/migrations/0087_ops_functions.sql`,
  `packages/ledger-sql/migrations/0088_account_mapping.sql`, `packages/ledger-sql/tests/tests_ops_functions.sql`,
  `packages/ledger-sql/tests/tests_account_mapping.sql`.
- **Risks** :
  - fonctions sans `assert_tenant` : elles ne rendent que des agrégats ou des identifiants ;
  - `SET search_path = public, pg_temp` ;
  - à faire relire par une personne.

T020 0087 : scellement et copie (WP05)
T021 0087 : contrôles, alertes, transactions longues (WP05)
T022 0088 : `account_mapping` (WP05)
T023 pgTAP (WP05)

## Phase 2 — Droits de la base

### WP06 — Droits de la mission (`post-roles.sql` section 12)

- **Goal** : poser et tester tous les droits des objets de WP02 à WP05.
- **Priority** : P1 (bloque toutes les routes).
- **Independent test** : `tests_9b_rights.sql` : liste exacte des droits par rôle ; `cashless_app` sans `UPDATE` ni
  `DELETE` sur `payout`, `external_statement_line`, `closing_step`, `statement_import`, `account_mapping` ;
  `cashless_maint` sans lecture de table.
- **Dependencies** : WP02, WP03, WP04, WP05.
- **Requirement refs** : C-005, C-008, FR-024.
- **Owned files** : `packages/ledger-sql/post-roles.sql`, `packages/ledger-sql/tests/tests_9b_rights.sql`,
  `packages/ledger-sql/tests/tests_execute_grants.sql`, `packages/ledger-sql/tests/tests_offline_rights.sql`,
  `apps/api/test/support/db.ts`.
- **Risks** :
  - les droits retirés à `cashless_app` sur `payout` et `external_statement_line` cassent un usage existant (il n'y en
    a aucun selon la recherche : à vérifier) ;
  - à faire relire par une personne.

T024 Droits de `cashless_app` (WP06)
T025 Droits de `cashless_maint` et propriétaire (WP06)
T026 pgTAP des droits (WP06)
T027 Listes figées (WP06)

## Phase 3 — Services et routes (en parallèle après WP01 et WP06)

### WP07 — Étapes de clôture et conditions de passage (API)

- **Goal** : routes 1 à 4, sept calculateurs, exécution une seule fois, textes des conditions.
- **Priority** : P1.
- **Independent test** : sur le scénario de référence, aperçu puis exécution des trois étapes de `SETTLING` : valeurs
  du scénario (25 000, 6 000, 1 017) ; rejeu sans effet ; étape hors ordre `409 CLOSING_CONDITION_NOT_MET`.
- **Dependencies** : WP01, WP06.
- **Requirement refs** : FR-001, FR-002, FR-003, FR-004, FR-005, FR-006, FR-007, FR-008, FR-024, NFR-001, NFR-004.
- **Owned files** : `apps/api/src/closing/**`, `apps/api/src/events/status/status.service.ts`,
  `apps/api/src/events/status/status-messages.ts`, `apps/api/src/ledger/types.ts`, `apps/api/src/app.module.ts`,
  `apps/api/test/integration/closing/**`, `apps/api/test/unit/closing/**`.
- **Risks** :
  - assiettes des frais à recouper avec le scénario ;
  - régularisation non linéaire ;
  - `forfeit_deposit` un support à la fois ;
  - grand livre à portée `ORGANIZER`.

T028 Module, routes, service, verrou (WP07)
T029 Calculateurs de `SETTLING` (WP07)
T030 Calculateurs de `REFUND_WINDOW` (WP07)
T031 Exécution et audit (WP07)
T032 Soldes restants (WP07)
T033 Conditions de passage (WP07)
T034 Tests (WP07)

### WP08 — Versements (API)

- **Goal** : routes 5 à 9 et action `PAYOUT`.
- **Priority** : P1.
- **Independent test** : lot préparé par une personne et validé par une autre ; `409 PAYOUT_EXCEEDS_ENTITLEMENT` au-delà
  du droit net ; export CSV ; confirmation et échec.
- **Dependencies** : WP01, WP06.
- **Requirement refs** : FR-009, FR-010, FR-011, FR-012, FR-024, NFR-001, NFR-004.
- **Owned files** : `apps/api/src/payouts/**`, `apps/api/test/integration/payouts/**`, `apps/api/test/unit/payouts/**`.
- **Risks** :
  - droit relu sous verrou à l'exécution ;
  - IBAN et numéro masqués hors du CSV ;
  - rôle selon le bénéficiaire testé par une liste figée.

T035 Droits nets (WP08)
T036 Action `PAYOUT` et route 6 (WP08)
T037 Liste et export (WP08)
T038 Confirmation (WP08)
T039 Tests (WP08)

### WP09 — Import et rapprochement des relevés (API)

- **Goal** : routes 10 à 13.
- **Priority** : P1.
- **Independent test** : relevé de 10 lignes dont 8 rapprochées automatiquement ; réimport sans doublon ; devise
  étrangère refusée ; `PSP_RECONCILED` remplie quand tout est rapproché et que les soldes concordent.
- **Dependencies** : WP01, WP06.
- **Requirement refs** : FR-013, FR-014, FR-015, FR-024, NFR-003.
- **Owned files** : `apps/api/src/reconciliation/**`, `apps/api/test/integration/reconciliation/**`.
- **Risks** :
  - signe des montants (entrée et sortie) fixé par le format ;
  - performance de l'import.

T040 Import (WP09)
T041 Lignes, rapprochement manuel, état (WP09)
T042 Tests et mesure (WP09)

### WP10 — Réclamations tardives (API)

- **Goal** : `postLateClaim` (contrat existant) et `postLateAdjustment`, à deux.
- **Priority** : P2.
- **Independent test** : après `LOCKED`, annulation de casse puis remboursement à deux ; annulation au-delà de la casse
  refusée ; échéance dépassée refusée.
- **Dependencies** : WP01, WP06.
- **Requirement refs** : FR-016, FR-024.
- **Owned files** : `apps/api/src/late-claims/**`, `apps/api/src/ledger/builders/festival/refund.ts`,
  `apps/api/test/integration/late-claims/**`.
- **Risks** :
  - deux écritures sous un point de sauvegarde ;
  - `CASH` sans caisse refusé ;
  - preuve du droit.

T043 `moneyAccountFor` (WP10)
T044 `LATE_CLAIM` (WP10)
T045 `ADJUSTMENT` (WP10)
T046 Tests (WP10)

### WP11 — Remboursement du back-office et limites de la 9a (API)

- **Goal** : OP-N123 (route 15), OP-N124, OP-N126, OP-N128 côté TypeScript ; tests de borne inversés.
- **Priority** : P2.
- **Independent test** : demande `BANK_TRANSFER` créée, approuvée par une autre personne, confirmée ; code du titulaire
  utilisable après une décision refusée ; `DEPOSIT_REFUNDED` porte `approved_by`.
- **Dependencies** : WP01, WP04, WP06, WP09, WP10.
- **Requirement refs** : FR-017, FR-018, FR-019.
- **Owned files** : `apps/api/src/refunds/**`, `apps/api/src/customer-auth/customer-auth.service.ts`,
  `apps/api/src/media/lifecycle/release.service.ts`, `apps/api/test/integration/refunds/**`,
  `apps/api/test/integration/customer-auth/**`.
- **Risks** :
  - fichiers sensibles de la 9a, à faire relire de nouveau ;
  - chaque levée met à jour son OP et son ADR (fait par WP14, à partir de la note de lane).

T047 Route 15 (WP11)
T048 OP-N124 (WP11)
T049 OP-N126 (WP11)
T050 OP-N128 (WP11)
T051 Tests (WP11)

### WP12 — Scellement, contrôles permanents, alertes (processus `maintenance`)

- **Goal** : port et faux de copie externe ; travailleurs ; alertes ; transactions longues.
- **Priority** : P2.
- **Independent test** : `main.maintenance.ts --once` scelle, « copie » (simulée), contrôle ; une altération lève le
  code 8 ; le faux est refusé en production.
- **Dependencies** : WP06.
- **Requirement refs** : FR-020, FR-021, NFR-005, NFR-006, C-005, C-006, C-010, C-011.
- **Owned files** : `apps/api/src/sealing/**`, `apps/api/src/processes/bootstrap.ts`,
  `apps/api/src/processes/maintenance.module.ts`, `apps/api/src/processes/ops-alerts.ts`,
  `apps/api/src/processes/controls/**`, `apps/api/src/kms/production-guard.ts`, `apps/api/src/security/port-tokens.ts`,
  `apps/api/test/unit/production-guard.spec.ts`, `apps/api/test/integration/sealing/**`,
  `apps/api/test/integration/controls/**`.
- **Risks** :
  - travailleurs en série dans une boucle ;
  - coût des contrôles ;
  - « copie simulée » jamais présentée comme « conforme ».

T052 Port, faux, garde (WP12)
T053 Scellement et vérification (WP12)
T054 Alertes (WP12)
T055 Contrôles (WP12)
T056 Transactions longues (WP12)
T057 Tests (WP12)

### WP13 — Relevés des parties et export comptable

- **Goal** : routes 16 à 19.
- **Priority** : P3.
- **Independent test** : relevé d'un commerçant limité à son périmètre ; export qui signale les types non mappés.
- **Dependencies** : WP01, WP06, WP07.
- **Requirement refs** : FR-022, FR-023, FR-024, NFR-004, C-007.
- **Owned files** : `apps/api/src/statements/**`, `apps/api/test/integration/statements/**`.
- **Risks** :
  - périmètre de `MERCHANT_ADMIN` ;
  - aucun jeu SYSCOHADA définitif.

T058 Relevé d'une partie (WP13)
T059 Relevé du festivalier (WP13)
T060 Correspondance et export (WP13)
T061 Tests (WP13)

## Phase 4 — Preuves

### WP14 — Preuves, consignation et note aux équipes clientes

- **Goal** :
  - scénario de bout en bout ;
  - concurrence ;
  - consignation : OP, ADR, SPECIFICATION §3.2, PRD, PROMPTS, `POINTS_OUVERTS` ;
  - note aux équipes clientes.
- **Priority** : P1 (bloque l'acceptation).
- **Independent test** : `closing-journey.spec.ts` retrouve `expected.after_closing` ; chaque écart accepté a OP, ADR,
  test et report.
- **Dependencies** : WP07, WP08, WP09, WP10, WP11, WP12, WP13.
- **Requirement refs** : NFR-001, NFR-002, SC-001, SC-002, SC-003, SC-004, SC-005, SC-006, C-008.
- **Owned files** : `apps/api/test/scenario/closing-journey.spec.ts`,
  `apps/api/test/integration/invariants-cloture/**`, `docs/POINTS_OUVERTS.md`, `docs/DECISIONS_ADR.md`,
  `docs/SPECIFICATION.md`, `PRD.md`, `PROMPTS-A-ENVOYER.md`, `docs/REPONSE-ENDPOINTS-BACKOFFICE-9B.md`.
- **Risks** : une limite non consignée est un constat bloquant à la revue post-fusion.

T062 Scénario de bout en bout (WP14)
T063 Concurrence et invariants (WP14)
T064 Consignation (WP14)
T065 Note aux équipes clientes (WP14)

## Parallélisme

- **Phase 1** : WP01 à WP05 en parallèle (fichiers disjoints).
- **Phase 2** : WP06 seul.
- **Phase 3** :
  - WP07, WP08, WP09, WP10 et WP12 en parallèle ;
  - WP11 après WP09 et WP10 ;
  - WP13 après WP07.
- **Phase 4** : WP14 en dernier.

MVP : WP01 + WP02 + WP03 + WP06 + WP07 + WP08 (clore et verser).
