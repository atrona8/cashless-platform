# Tasks: Remboursements des festivaliers

**Mission** : `remboursements-01M7AG5V` · **Branche** : `feat/remboursements` (planification et fusion)
**Sources** : `spec.md`, `plan.md`, `research.md` (R-01 à R-12), `data-model.md`, `contracts/served-operations.md`,
`contracts/interfaces.md` (**répartition des fichiers et noms figés : fait foi**). Fiche commune des agents :
`docs/passation-9a/fiche-implementation.md` ; décisions du porteur : `docs/passation-9a/contexte-9a.md`.

Règles communes : priorité des sources (SPECIFICATION §0.3), contradiction signalée ; aucun `.sql` généré modifié ;
aucun écart qui affaiblit la sécurité sans accord du porteur (règle 1 de `CLAUDE.md`) ; contrat stable (aucune route,
aucun champ, aucun code d'erreur ajouté) ; paiement manuel ; lignes de 100 caractères ; tests en série par
l'orchestrateur (base partagée) ; seul WP01 accorde des droits de base.

## Subtask Index

| ID | Description | WP | Parallel |
|---|---|---|---|
| T001 | 0081 : table `refund_request` (colonnes, CHECK, index unique partiel, RLS) | WP01 | |
| T002 | 0081 : colonnes `purpose` et `subject_id` d'`otp_challenge` | WP01 | |
| T003 | 0081 : `refund_request_operator`, `promote_due_refund_requests` (SECURITY DEFINER) | WP01 | |
| T004 | `post-roles.sql` section 11 : droits de `cashless_app` et `cashless_maint` | WP01 | |
| T005 | `tests_refund_requests.sql` : RLS, une ouverte, CHECK, fonctions, droits | WP01 | |
| T006 | Listes figées des suites de droits ; suites générées intactes | WP01 | |
| T007 | Moteur : `checkStatus` reçoit le type contre-passé ; `REVERSAL` d'un `WALLET_REFUND` accepté | WP02 | [P] |
| T008 | `status-matrix.ts` miroir et tests unitaires | WP02 | [P] |
| T009 | 0082 : `replace_media` réattribue les espèces dues ouvertes | WP02 | [P] |
| T010 | Tests du moteur : positifs, négatifs, contre-passation unique, `LOCKED` inchangé | WP02 | |
| T011 | `tests_replace_cash_due.sql` : rendues une fois et une seule | WP02 | |
| T012 | `verifyChallenge` / `issueChallenge` extraits d'`exchangeIn`, un code vivant par (numéro, usage) | WP03 | |
| T013 | `refunds/destination.ts` : `resolveDestination` | WP03 | |
| T014 | `holder-challenge.service.ts` : `startHolderChallenge` | WP03 | |
| T015 | `holder-decision.controller.ts` : `decideRefundRequestAsHolder` (public) | WP03 | |
| T016 | Processus `maintenance` : promotion des demandes échues chaque minute | WP03 | |
| T017 | Tests : vérification, réemploi refusé, connexion préservée, décision, échéance | WP03 | |
| T018 | `RefundsModule`, DTO, import dans `app.module.ts` | WP04 | |
| T019 | `refund-eligibility.ts` : fenêtre effective, statut, blocages (R-04), solde payé, frais | WP04 | |
| T020 | `createMyRefundRequest` (idempotence, 409 une ouverte, destination, titulaire) | WP04 | |
| T021 | `listMyRefundRequests`, `listRefundRequests` (pagination, filtres, promotion, isolation) | WP04 | |
| T022 | `rejectRefundRequest` | WP04 | |
| T023 | `GET /me/wallets` : `refund.eligible`, date limite effective, `fee` | WP04 | |
| T024 | Tests d'intégration de création, listes, refus, `/me/wallets` | WP04 | |
| T025 | Constructeur `refund.ts` : compte d'argent par canal | WP05 | |
| T026 | `wallet-refund-action.ts` : demande, validation, exécution | WP05 | |
| T027 | `approveRefundRequest` (202 ; note exigée si `extra_check_required`) | WP05 | |
| T028 | `confirmRefundRequest` (`PAID` sans écriture, `FAILED` + `REVERSAL`, garde `EDGE`) | WP05 | |
| T029 | `debit-paths.ts` et `debit-paths-refused.spec.ts` | WP05 | |
| T030 | Tests : deux personnes, montant à l'exécution, idempotence, recrédit, `EDGE` | WP05 | |
| T031 | Moteur : session de caisse et terminal pour un `WALLET_REFUND` en espèces | WP06 | |
| T032 | `release.service.ts` : enchaînement §7.9 dans une transaction | WP06 | |
| T033 | Jeton sur place `releaseMedia` au-delà de `cash_refund_single_max` | WP06 | |
| T034 | Réponse (`*_transaction_id`, `cash_to_hand_back`) ; `release.no_chaining` retiré | WP06 | |
| T035 | Tests du guichet de retour | WP06 | |
| T036 | Parcours de bout en bout (SC-001 à SC-005) | WP07 | |
| T037 | Concurrence : NFR-001, NFR-002, NFR-003 | WP07 | [P] |
| T038 | Mesures NFR-004 (suite isolée), preuve NFR-005 | WP07 | [P] |
| T039 | Consignation : ADR-189, OP-N51/N55 et ADR-100 levés, OP-N123, PRD, PROMPTS | WP07 | [P] |
| T040 | Note pour l'app festivalier : remboursements servis | WP07 | [P] |
| T041 | `acceptance-matrix.json` complète, suites `SKIP_LATENCY` lancées | WP07 | |

## Phase 1 — Base

### WP01 — Base des demandes de remboursement

**Prompt** : `tasks/WP01-base-demandes.md` · **Priorité** : P1 · **Dépendances** : aucune · **~220 lignes**

- **But** : table `refund_request` (S16), isolation, une demande ouverte par portefeuille, fonctions pour la route
  publique et la maintenance, droits ; colonnes d'usage des codes à usage unique.
- **Test indépendant** : `pg_prove tests/tests_refund_requests.sql` et les suites de droits passent ; les suites
  générées passent sans modification.
- **Subtasks** :
T001 0081 : table `refund_request` (colonnes, CHECK, index unique partiel, RLS) (WP01)
T002 0081 : colonnes `purpose` et `subject_id` d'`otp_challenge` (WP01)
T003 0081 : `refund_request_operator`, `promote_due_refund_requests` (WP01)
T004 `post-roles.sql` section 11 (WP01)
T005 `tests_refund_requests.sql` (WP01)
T006 Listes figées des suites de droits (WP01)
- **Risques** : listes figées ; droits par colonne ; SECURITY DEFINER à faire relire par une personne.

### WP02 — Garde du `REVERSAL` et espèces dues d'un bracelet remplacé

**Prompt** : `tasks/WP02-garde-reversal-especes-dues.md` · **Priorité** : P1 · **Dépendances** : aucune · **~220 lignes**

- **But** : le moteur accepte le `REVERSAL` d'un `WALLET_REFUND` de source back-office partout où `WALLET_REFUND`
  l'est (décision 5) et rien d'autre (`post_transaction` inchangée) ; `replace_media` fait suivre les espèces dues (OP-N55).
- **Test indépendant** : `tests_replace_cash_due.sql`, `status-matrix-refund-reversal.spec.ts`,
  `refund-reversal-matrix.spec.ts`.
- **Subtasks** :
T007 Moteur : `checkStatus` et `REVERSAL` d'un `WALLET_REFUND` (WP02)
T008 `status-matrix.ts` miroir et tests unitaires (WP02)
T009 0082 : `replace_media` réattribue les espèces dues ouvertes (WP02)
T010 Tests du moteur (WP02)
T011 `tests_replace_cash_due.sql` (WP02)
- **Risques** : aucun autre `REVERSAL` élargi ; `replace_media` à faire relire.

## Phase 2 — Parcours festivalier

### WP03 — Codes du titulaire et destination

**Prompt** : `tasks/WP03-codes-titulaire-destination.md` · **Priorité** : P2 · **Dépendances** : WP01 · **~240 lignes**

- **But** : vérifier un code sans émettre de jetons, résoudre la destination (numéro vérifié ou autre numéro avec
  code), défi du titulaire lié à la demande, décision du titulaire, échéance.
- **Test indépendant** : `test/integration/customer-auth/verify-challenge.spec.ts`, `test/integration/refunds/holder*.spec.ts`.
- **Subtasks** :
T012 `verifyChallenge` / `issueChallenge` (WP03)
T013 `refunds/destination.ts` (WP03)
T014 `holder-challenge.service.ts` (WP03)
T015 `holder-decision.controller.ts` (WP03)
T016 Promotion des demandes échues par la maintenance (WP03)
T017 Tests (WP03)
- **Risques** : ne rien changer au comportement observable de la connexion ; réponses uniformes sur la route publique.

### WP04 — Création, éligibilité, listes et refus

**Prompt** : `tasks/WP04-creation-listes-refus.md` · **Priorité** : P1 · **Dépendances** : WP01, WP03 · **~250 lignes**

- **But** : servir `createMyRefundRequest`, `listMyRefundRequests`, `listRefundRequests`, `rejectRefundRequest`, et
  compléter `GET /me/wallets`.
- **Test indépendant** : `test/integration/refunds/{create,list,reject}*.spec.ts`, `me-refund.spec.ts`.
- **Subtasks** :
T018 `RefundsModule`, DTO, import (WP04)
T019 `refund-eligibility.ts` (WP04)
T020 `createMyRefundRequest` (WP04)
T021 Listes (WP04)
T022 `rejectRefundRequest` (WP04)
T023 `GET /me/wallets` complété (WP04)
T024 Tests (WP04)
- **Risques** : 409 sur violation de l'index unique (concurrence) ; date limite effective ; isolation (`404`).

## Phase 3 — Back-office et guichet

### WP05 — Approbation à deux et confirmation du paiement

**Prompt** : `tasks/WP05-approbation-confirmation.md` · **Priorité** : P1 · **Dépendances** : WP02, WP04 · **~250 lignes**

- **But** : action `WALLET_REFUND` (écriture à l'exécution), `approveRefundRequest`, `confirmRefundRequest`,
  classement de l'autorité de débit.
- **Test indépendant** : `test/integration/refunds/{approve,confirm}*.spec.ts`, `debit-paths-refused.spec.ts`.
- **Subtasks** :
T025 Compte d'argent par canal (WP05)
T026 `wallet-refund-action.ts` (WP05)
T027 `approveRefundRequest` (WP05)
T028 `confirmRefundRequest` (WP05)
T029 Autorité de débit (WP05)
T030 Tests (WP05)
- **Risques** : double écriture ; valideur = auteur ; garde `EDGE` du `REVERSAL` côté API.

### WP06 — Guichet de retour enchaîné

**Prompt** : `tasks/WP06-guichet-retour.md` · **Priorité** : P2 · **Dépendances** : WP02 · **~230 lignes**

- **But** : `releaseMedia` avec `settle_balance` / `refund_deposit_by` dans l'ordre §7.9, tout ou rien, jeton au-delà
  du seuil (OP-N51, ADR-91).
- **Test indépendant** : `test/integration/media/release-chaining*.spec.ts` et les suites `media/lifecycle` existantes.
- **Subtasks** :
T031 Moteur : session de caisse d'un `WALLET_REFUND` en espèces (WP06)
T032 Enchaînement §7.9 (WP06)
T033 Jeton sur place (WP06)
T034 Réponse ; refus provisoire retiré (WP06)
T035 Tests (WP06)
- **Risques** : `posting_cash_desk_guard` ; jeton lié au corps exact ; comportement sans `settle_balance` inchangé.

## Phase 4 — Preuves

### WP07 — Preuves, mesures et consignation

**Prompt** : `tasks/WP07-preuves-consignation.md` · **Priorité** : P2 · **Dépendances** : WP05, WP06 · **~200 lignes**

- **But** : parcours de bout en bout, concurrence, mesures, dettes et décisions consignées, note pour l'app, matrice
  d'acceptation.
- **Test indépendant** : `test/integration/refunds/{journey,concurrency}*.spec.ts`, `refund-latency.spec.ts`.
- **Subtasks** :
T036 Parcours de bout en bout (WP07)
T037 Concurrence (WP07)
T038 Mesures (WP07)
T039 Consignation (WP07)
T040 Note pour l'app festivalier (WP07)
T041 Matrice d'acceptation (WP07)
- **Risques** : suites `SKIP_LATENCY` à lancer avant l'`accept`.

## Parallélisme

WP01 et WP02 en parallèle ; puis WP03 et WP06 en parallèle (WP06 ne dépend que de WP02) ; WP04 ; WP05 ; WP07.
MVP pour l'app festivalier : WP01, WP03, WP04 (création et suivi des demandes).
