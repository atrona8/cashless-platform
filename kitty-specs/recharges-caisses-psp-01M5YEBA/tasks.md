# Tasks: Recharges, caisses et PSP

**Mission** : `recharges-caisses-psp-01M5YEBA` · **Branche** : `feat/recharges-caisses-psp` (planification et fusion)
**Sources** : `spec.md`, `plan.md`, `research.md` (**R-20 fait foi**), `research-adversarial.md`, `data-model.md`,
`contracts/cash.md`, `contracts/psp.md`, `contracts/database-rights.md`, `contracts/openapi-additions.md`.

Règles communes à tous les lots : priorité des sources (SPECIFICATION §0.3) et contradiction signalée ; aucun `.sql`
généré modifié ; aucun écart qui affaiblit la sécurité sans accord du porteur (règle 1 de `CLAUDE.md`) ; aucun faux
en production ; lignes de 100 caractères ; tests en série par l'orchestrateur (base partagée).

`AuditAction` (`apps/api/src/audit/audit.service.ts`) n'a pas de propriétaire : chaque lot qui ajoute des
valeurs le fait par une retouche hors carte d'une ligne par valeur, en fin d'union ; l'orchestrateur
résout les conflits de fusion. Les lots concernés (WP08, WP09, WP10, WP11, WP13) listent leurs valeurs.
Les fichiers `*.cases.ts` de la matrice d'authentification des terminaux sont dans
`apps/api/test/integration/end-to-end/device-auth-cases/` (WP08, WP09, WP11).
Routes de demande d'approbation figées par WP01 : `requestCashDeposit` (`POST
/ledgers/{ledger_id}/cash-deposits/approval-requests`), `requestWalletUnblock` (`POST
/wallets/{wallet_id}/unblock/approval-requests`), `requestLateChargeback` (`POST
/chargebacks/{chargeback_id}/approval-requests`), `requestPspConfigurationChange` (`POST
/psp-configurations/{psp_config_id}/approval-requests`).

## Subtask Index

| ID | Description | WP | Parallel |
|---|---|---|---|
| T001 | Corriger les opérations existantes (sessions, recharge PSP, notifications, caution, espèces dues, libération) | WP01 | |
| T002 | Ajouter les opérations (sessions, configurations, choix d'événement, annulation de recharge) | WP01 | [P] |
| T003 | Schémas, codes d'erreur, `ApprovalAction`, statuts et motifs | WP01 | |
| T004 | Régénérer les types TypeScript et Dart ; `npm run check -w @cashless/contracts` | WP01 | |
| T005 | Tables `cash_session`, `cash_session_count`, `cash_session_tx`, `cash_desk` | WP02 | |
| T006 | `open_cash_session` (création de `A-CAISSE-<série>`), `count_cash_session` | WP02 | |
| T007 | `begin_cash_close`, `finish_cash_close` (état `CLOSING`, verrou du solde) | WP02 | |
| T008 | Gardes : `posting_cash_desk_guard`, `account_purpose_guard` | WP02 | |
| T009 | `attach_cash_tx`, `open_cash_due_anomaly`, variantes `…_for_session` | WP02 | |
| T010 | Suite `tests_cash_sessions.sql` (dont concurrence fermeture/recharge, suites de référence vertes) | WP02 | |
| T011 | Table `psp_configuration` (contraintes, `secret_ref` lié au titulaire, versions) | WP03 | |
| T012 | Table `event_psp_selection` et déclencheur du titulaire | WP03 | |
| T013 | `resolve_psp_configuration`, `psp_webhook_context`, `psp_configuration_secret_ref` | WP03 | |
| T014 | Comptes `A-PSP-*` (nouveaux grands livres et existants), portée de frais `PSP_CONFIGURATION` | WP03 | |
| T015 | `create_psp_configuration`, `activate_psp_configuration` (approbation, version, frais, agrément), `set_event_psp_selection` | WP03 | |
| T016 | Suite `tests_psp_configurations.sql` | WP03 | |
| T017 | Tables `psp_topup`, `psp_event`, `psp_webhook_rejection` | WP04 | |
| T018 | `create_psp_topup`, `mark_psp_topup_initiated`, `cancel_psp_topup`, `expire_psp_topups`, `psp_poll_candidates` | WP04 | |
| T019 | `record_psp_event`, `complete_psp_topup`, `fail_psp_topup`, `complete_card_topup` (verrou consultatif), `record_webhook_rejection` | WP04 | |
| T020 | `psp_chargeback`, `record_chargeback`, `block_wallet_after_chargeback`, `unblock_wallet` | WP04 | |
| T021 | Extensions : anomalie `PSP_TOPUP_NOT_CREDITED`, actions `WALLET_UNBLOCK` et `CASH_DEPOSIT` | WP04 | |
| T022 | Suite `tests_psp_topups.sql` | WP04 | |
| T023 | `post-roles.sql` : droits des nouvelles tables (colonnes `secret_ref`, `body`) et fonctions | WP05 | |
| T024 | `tests_execute_grants.sql` : liste figée | WP05 | |
| T025 | `tests_cash_psp_rights.sql` (aucune écriture directe, aucune création de caisse ou de compte PSP) | WP05 | |
| T026 | Isolation RLS des nouvelles tables entre prestataires (pgTAP) | WP05 | |
| T027 | Moteur : découpage `TOPUP_CASH` limité à `OFFLINE_SYNC`/`EDGE_SYNC` | WP06 | |
| T028 | Moteur : anomalie `CASH_TOPUP_OVER_LIMIT` dans la transaction du découpage | WP06 | |
| T029 | `buildCashClose` : théorique nul accepté | WP06 | [P] |
| T030 | Tests du moteur (cas en ligne refusé, hors ligne découpé avec anomalie, fermetures) | WP06 | |
| T031 | Port `PspAdapter` et type normalisé (notification et statut) | WP07 | |
| T032 | Faux par fournisseur et outil de notification signée pour les tests | WP07 | |
| T033 | Port `PspSecretStore`, faux coffre, échéance du secret précédent, contrôle du titulaire | WP07 | |
| T034 | Production : fournisseur « indisponible », garde `assertProcessIsSafe` | WP07 | |
| T035 | Codes SQLSTATE et problèmes ; câblage des modules | WP07 | |
| T036 | Tests unitaires (garde de production, signature, normalisation, coffre) | WP07 | |
| T037 | Ouverture de session (terminal + personne) | WP08 | |
| T038 | Comptage et lecture à l'aveugle | WP08 | |
| T039 | Fermeture (`begin_cash_close`, `CASH_CLOSE`, `CASH_DIFF`, `finish_cash_close`, idempotence) | WP08 | |
| T040 | Liste et lecture des sessions (droits par rôle) | WP08 | [P] |
| T041 | Action d'approbation `CASH_DEPOSIT` | WP08 | |
| T042 | Tests d'intégration des sessions et du dépôt | WP08 | |
| T043 | `counter-access.ts` : session ouverte du terminal | WP09 | |
| T044 | Recharge espèces `createCashTopup` | WP09 | |
| T045 | Caution, espèces dues, libération par les variantes `…_for_session` ; `cash_session_id` servi | WP09 | |
| T046 | Caution due après chaque crédit payé (transaction distincte) | WP09 | |
| T047 | Adapter les tests de la mission 4 (session ouverte) ; OP-N49 levé | WP09 | |
| T048 | Tests d'intégration du guichet | WP09 | |
| T049 | Routes de configuration (création, liste, lecture, `secret_ref` réservé) | WP10 | |
| T050 | Action `PSP_CONFIGURATION` (activation, suspension, réactivation, version) | WP10 | |
| T051 | Choix par événement et action `EVENT_PSP_SELECTION` | WP10 | |
| T052 | Résolveur de frais par configuration (convention d'ADR-82 §3 retirée) | WP10 | |
| T053 | Tests d'intégration des configurations | WP10 | |
| T054 | Demande de recharge (guichet et festivalier), bornes, appel de l'adaptateur après validation | WP11 | |
| T055 | Consultation et annulation d'une recharge | WP11 | |
| T056 | Traitement d'un paiement (tableau des états, verrou de ligne, refus définitifs) | WP11 | |
| T057 | Carte : 3-D Secure, empreinte, plafond par carte, `CARD_VELOCITY` | WP11 | |
| T058 | Caution due après un crédit PSP (aussi sur le chemin doublon) | WP11 | |
| T059 | Tests d'intégration des recharges | WP11 | |
| T060 | Réception : corps brut, taille, configuration, signature, horodatage, compteur des refus | WP12 | |
| T061 | Conservation puis traitement (`RECEIVED`, `UNMATCHED`, `RETRY`) | WP12 | |
| T062 | Processus `psp-poller` : reprises, interrogation, expiration | WP12 | |
| T063 | Purge des corps, alertes et codes de sortie | WP12 | |
| T064 | Tests (notifications refusées, rejeux, reprises, travailleur) | WP12 | |
| T065 | Contestation : `record_chargeback`, `CHARGEBACK`, blocage | WP13 | |
| T066 | Contestation tardive : `LATE_CHARGEBACK` et approbation | WP13 | |
| T067 | Déblocage : action `WALLET_UNBLOCK` | WP13 | |
| T068 | Tests des contestations | WP13 | |
| T069 | Parcours complet de bout en bout | WP14 | |
| T070 | Isolation route par route et balayage des secrets avec canari | WP14 | [P] |
| T071 | Concurrence (100 rejeux, notifications mêlées, plafond carte, fermeture pendant recharge) | WP14 | [P] |
| T072 | Latence (NFR-006, NFR-009) et CI | WP14 | |
| T073 | Consignation : OP-N49 levé, ADR, points ouverts, documents, matrice d'acceptation | WP14 | |
| T074 | Liste des fichiers à faire relire par une personne | WP14 | |

## Phase 1 — Contrat et base de données

### WP01 — Contrat d'API et types (`tasks/WP01-contrat-api-types.md`)

- **Goal** : `openapi.yaml` conforme à `contracts/openapi-additions.md` et à R-20 ; types régénérés. Priorité P1.
- **Independent test** : `npm run check -w @cashless/contracts` vert ; diff du contrat relu contre openapi-additions.md.
- **Subtasks** : T001 T002 T003 T004
- **Dependencies** : none
- **Owned files** : `packages/contracts/**`, `apps/api/src/http/messages.fr.json`, `apps/api/src/http/messages.en.json`
- **Risks** : cohérence TS/Dart générés ; codes d'erreur stables (RFC 9457). ~300 lignes.

### WP02 — Base : sessions de caisse et gardes (migration 0036) (`tasks/WP02-base-sessions-caisse.md`)

- **Goal** : caisses, sessions, comptages, fermeture, gardes en base (R-01 à R-03, R-20). P1.
- **Independent test** : `pg_prove tests/tests_cash_sessions.sql` vert ; suites de référence générées vertes.
- **Subtasks** : T005 T006 T007 T008 T009 T010
- **Dependencies** : none
- **Owned files** : `packages/ledger-sql/migrations/0036_cash_sessions.sql`, `packages/ledger-sql/tests/tests_cash_sessions.sql`
- **Risks** : garde limitée aux caisses inscrites ; lecture sans verrou ; ordre des verrous ; `current_user` dans
  `account_purpose_guard`. ~450 lignes.

### WP03 — Base : configurations PSP (migration 0037) (`tasks/WP03-base-configurations-psp.md`)

- **Goal** : configurations, choix par événement, résolution, comptes `A-PSP-*`, frais par configuration (R-07, R-13, R-20). P1.
- **Independent test** : `pg_prove tests/tests_psp_configurations.sql` vert.
- **Subtasks** : T011 T012 T013 T014 T015 T016
- **Dependencies** : none
- **Owned files** : `packages/ledger-sql/migrations/0037_psp_configurations.sql`, `packages/ledger-sql/tests/tests_psp_configurations.sql`
- **Risks** : `open_psp_accounts` étroite (décision du porteur du 27/10, `open_event_ledger` inchangée) ; comptes des grands livres existants ;
  titulaire contrôlé à l'écriture et à la résolution. ~450 lignes.

### WP04 — Base : recharges PSP, notifications, contestations (migration 0038) (`tasks/WP04-base-recharges-psp.md`)

- **Goal** : recharges, notifications conservées, contestations, blocage, extensions de listes (R-11, R-14, R-20). P1.
- **Independent test** : `pg_prove tests/tests_psp_topups.sql` vert.
- **Subtasks** : T017 T018 T019 T020 T021 T022
- **Dependencies** : WP03
- **Owned files** : `packages/ledger-sql/migrations/0038_psp_topups.sql`, `packages/ledger-sql/tests/tests_psp_topups.sql`
- **Risks** : unicités ; `CHECK` statut/crédit ; plafond cumulé des contestations ; verrou consultatif par carte ;
  transitions du tableau de data-model.md. ~480 lignes.

### WP05 — Droits de la base (`tasks/WP05-droits-base.md`)

- **Goal** : `cashless_app` n'écrit que par fonctions ; listes figées ; isolation (C-004, NFR-005). P1.
- **Independent test** : `tests_execute_grants.sql`, `tests_cash_psp_rights.sql` verts ; batterie complète verte.
- **Subtasks** : T023 T024 T025 T026
- **Dependencies** : WP02, WP03, WP04
- **Owned files** : `packages/ledger-sql/post-roles.sql`, `packages/ledger-sql/tests/tests_execute_grants.sql`, `packages/ledger-sql/tests/tests_cash_psp_rights.sql`
- **Risks** : droits par colonne (`secret_ref`, `body`) ; fichier sensible (relecture humaine). ~300 lignes.

## Phase 2 — Socle applicatif

### WP06 — Moteur : découpage hors ligne et fermeture à théorique nul (`tasks/WP06-moteur-especes.md`)

- **Goal** : correction du découpage `TOPUP_CASH` et de `buildCashClose` (R-05, R-03). P1.
- **Independent test** : tests du moteur verts ; recharge en ligne au-delà du plafond refusée.
- **Subtasks** : T027 T028 T029 T030
- **Dependencies** : WP02
- **Owned files** : `apps/api/src/ledger/ledger-engine.service.ts`, `apps/api/src/ledger/builders/closing/cash.ts`, `apps/api/test/integration/engine/topup-cash-split.spec.ts`, `apps/api/test/unit/builders/closing/closing-builders.spec.ts`
- **Risks** : vecteurs du moteur existants ; anomalie dans la même transaction. ~250 lignes.

### WP07 — Ports PSP, faux et garde de production (`tasks/WP07-ports-psp-faux.md`)

- **Goal** : interface commune, faux par fournisseur, coffre, production sans faux (R-08, R-09, R-20 A5, A10, A11, A23). P1.
- **Independent test** : `production-guard.spec.ts` (faux refusés ; processus public démarre en production) ; tests unitaires du port.
- **Subtasks** : T031 T032 T033 T034 T035 T036
- **Dependencies** : WP01
- **Owned files** : `apps/api/src/psp/**`, `apps/api/src/processes/bootstrap.ts`, `apps/api/src/processes/public.module.ts`, `apps/api/src/app.module.ts`, `apps/api/src/errors/sqlstate-map.ts`, `apps/api/test/unit/psp/**`, `apps/api/test/unit/production-guard.spec.ts`
- **Risks** : aucun faux construit en production ; secrets jamais journalisés ; comparaison à temps constant. ~450 lignes.

## Phase 3 — Caisses et espèces

### WP08 — Sessions de caisse (API) et dépôt en banque (`tasks/WP08-sessions-caisse-api.md`)

- **Goal** : routes de session, fermeture, lecture à l'aveugle, action `CASH_DEPOSIT` (FR-001 à FR-003, FR-029). P1.
- **Independent test** : `integration/cash-sessions/*.spec.ts` verts.
- **Subtasks** : T037 T038 T039 T040 T041 T042
- **Dependencies** : WP01, WP05, WP06, WP07
- **Owned files** : `apps/api/src/cash-sessions/**`, `apps/api/test/integration/cash-sessions/**`, `apps/api/test/integration/end-to-end/device-auth-cases/cash-sessions.cases.ts`
- **Risks** : comptage à l'aveugle ; fermeur sans comptage ; idempotence de la fermeture. ~420 lignes.

### WP09 — Recharge espèces et guichet des bracelets (`tasks/WP09-recharge-especes-guichet.md`)

- **Goal** : recharge espèces, espèces de caution et dues par la session, caution due ensuite ; OP-N49 levé (FR-004 à FR-008). P1.
- **Independent test** : `integration/topups/cash-topup.spec.ts` et tests du guichet verts.
- **Subtasks** : T043 T044 T045 T046 T047 T048
- **Dependencies** : WP08
- **Owned files** : `apps/api/src/topups/cash/**`, `apps/api/src/media/lifecycle/**`, `apps/api/test/integration/topups/cash-*.spec.ts`, `apps/api/test/integration/media/deposit.spec.ts`, `apps/api/test/integration/media/cash-due.spec.ts`, `apps/api/test/integration/media/release.spec.ts`, `apps/api/test/integration/end-to-end/device-auth-cases/cash-topup.cases.ts`
- **Risks** : régressions de la mission 4 ; aucune route ne passe de compte de caisse. ~450 lignes.

## Phase 4 — PSP

### WP10 — Configurations PSP (API) (`tasks/WP10-configurations-psp-api.md`)

- **Goal** : configurations, choix par événement, actions d'approbation, frais par configuration (FR-009 à FR-011, FR-023). P1.
- **Independent test** : `integration/psp-configurations/*.spec.ts` verts.
- **Subtasks** : T049 T050 T051 T052 T053
- **Dependencies** : WP01, WP05, WP07
- **Owned files** : `apps/api/src/psp-configurations/**`, `apps/api/src/configuration/sql-config-resolver.ts`, `apps/api/test/integration/psp-configurations/**`, `apps/api/src/ledger/ports/config-resolver.ts`, `apps/api/test/scenario/api-config-fixture.ts`
- **Risks** : cloisonnement ; `secret_ref` réservé à l'`OPERATOR_ADMIN` ; approbation liée à la version. ~380 lignes.

### WP11 — Recharges PSP : demande et traitement d'un paiement (`tasks/WP11-recharges-psp.md`)

- **Goal** : demande, consultation, annulation ; traitement R-11/R-20 ; carte ; caution due (FR-012, FR-013, FR-016 à FR-018, FR-024 à FR-026). P1.
- **Independent test** : `integration/topups/psp-*.spec.ts` verts (faux PSP).
- **Subtasks** : T054 T055 T056 T057 T058 T059
- **Dependencies** : WP07, WP09, WP10
- **Owned files** : `apps/api/src/topups/psp/**`, `apps/api/test/integration/topups/psp-*.spec.ts`, `apps/api/test/integration/end-to-end/device-auth-cases/psp-topups.cases.ts`, `apps/api/test/integration/topups/psp-fixtures.ts`
- **Risks** : aucun appel réseau sous verrou ; refus définitifs ; tableau des états ; jour UTC. ~500 lignes.

### WP12 — Notifications et travailleur `psp-poller` (`tasks/WP12-notifications-poller.md`)

- **Goal** : réception sûre, conservation puis traitement, reprises, interrogation, expiration, purge (FR-014, FR-015, FR-019, NFR-002, NFR-006). P1.
- **Independent test** : `integration/webhooks/*.spec.ts` et tests du travailleur verts.
- **Subtasks** : T060 T061 T062 T063 T064
- **Dependencies** : WP11
- **Owned files** : `apps/api/src/webhooks/**`, `apps/api/src/topups/poller/**`, `apps/api/src/main.psp-poller.ts`, `apps/api/src/processes/psp-poller.module.ts`, `apps/api/test/integration/webhooks/**`, `apps/api/test/integration/topups/poller-*.spec.ts`
- **Risks** : route publique ; corps brut ; compteur borné ; alertes. ~450 lignes.

### WP13 — Contestations et déblocage (`tasks/WP13-contestations.md`)

- **Goal** : `CHARGEBACK`, blocage, contestation tardive à deux, déblocage à deux (FR-027, FR-028). P2.
- **Independent test** : `integration/chargebacks/*.spec.ts` verts.
- **Subtasks** : T065 T066 T067 T068
- **Dependencies** : WP12
- **Owned files** : `apps/api/src/chargebacks/**`, `apps/api/test/integration/chargebacks/**`
- **Risks** : précondition sur la recharge d'origine ; plafond net ; bornes `check_late_claim`. ~350 lignes.

## Phase 5 — Preuves et consignation

### WP14 — Preuves de bout en bout, CI et consignation (`tasks/WP14-preuves-ci-consignation.md`)

- **Goal** : SC-001 à SC-008 prouvés ; CI ; consignation et documents (NFR-001, NFR-007, NFR-008, NFR-010). P1.
- **Independent test** : suites `end-to-end/` vertes ; CI verte.
- **Subtasks** : T069 T070 T071 T072 T073 T074
- **Dependencies** : WP08, WP09, WP10, WP11, WP12, WP13
- **Owned files** : `apps/api/test/integration/end-to-end/topup-*.spec.ts`, `apps/api/test/integration/end-to-end/cash-*.spec.ts`, `apps/api/test/integration/end-to-end/psp-*.spec.ts`, `.github/workflows/**`, `docs/POINTS_OUVERTS.md`, `docs/DECISIONS_ADR.md`
- **Risks** : base partagée ; horloge Docker ; matrice d'acceptation tenue au fil des lots. ~400 lignes.

## Parallélisme

- Démarrage : WP01, WP02, WP03 en parallèle ; WP04 après WP03 ; WP06 après WP02 ; WP07 après WP01.
- WP05 après WP02 à WP04 ; WP08 et WP10 en parallèle ensuite ; WP09 après WP08 ; WP11 après WP09 et WP10 ;
  WP12 puis WP13 ; WP14 ferme la mission.
- MVP : WP01, WP02, WP05, WP06, WP07, WP08, WP09 (caisses et espèces, OP-N49 levé, utilisable en production).
