# Tasks — Adaptateurs conformes aux documentations des fournisseurs choisis (mission 12b-1)

Mission `adaptateurs-fournisseurs-choisis-01M8BXJA`, planification et fusion sur `feat/adaptateurs-fournisseurs-choisis`.
Références : `spec.md`, `plan.md` (IC-01 à IC-10, D1 à D9), `interfaces.md` (fait foi sur les noms, signatures,
réglages et propriétaires), `research.md` (sources et correspondances R-01 à R-14), `data-model.md`, `contracts/`,
fiche commune `docs/passation-12b-1/fiche-implementation.md`.

Les lignes `Txxx` sont des références ; l'avancement s'enregistre par `spec-kitty agent tasks mark-status`.

## Subtask Index

| ID | Description | WP | Parallel |
|---|---|---|---|
| T001 | Dépendances `axios` et SDK AWS épinglées, script `essai` | WP01 | |
| T002 | Clés de configuration de la mission (`interfaces.md` §2) | WP01 | [P] |
| T003 | Client HTTP sortant `PspHttpClient` (délai, nouveaux essais bornés, journal sans secret) | WP01 | |
| T004 | Faux serveur HTTP générique et garde « aucun réseau » en test | WP01 | [P] |
| T005 | Tests du client et de la garde, mutations | WP01 | |
| T006 | Types : verdicts `NOTIFICATION`/`SIGNAL`, relevé `PspStatement` | WP02 | |
| T007 | Identifiants par fournisseur (`PspCredentials`) | WP02 | |
| T008 | Signature HMAC paramétrée (`HmacScheme` : séparateur, entrées inconnues) | WP02 | |
| T009 | Faux adaptés, `FakeSignalPspAdapter` | WP02 | |
| T010 | Tests et mutations du port et de la signature | WP02 | |
| T011 | Vérifieur : tolérance seulement pour un verdict horodaté ; signal sans montant | WP03 | |
| T012 | Réception : corps en formulaire (PayDunya seul), conservation d'un signal sans effet | WP03 | |
| T013 | `PspStatusConfirmer` extrait du travailleur d'interrogation | WP03 | |
| T014 | Relecture asynchrone après réponse, une par recharge et par minute | WP03 | |
| T015 | Tests de bout en bout du signal et de la notification à relire | WP03 | |
| T016 | `receivePspWebhook` : contenu `application/x-www-form-urlencoded` | WP04 | [P] |
| T017 | Description par fournisseur (Wave, Stripe, PayDunya) | WP04 | |
| T018 | `contract-baseline.json`, types générés, test de gel | WP04 | |
| T019 | Wave : création de session, reprise par `client_reference` | WP05 | |
| T020 | Wave : notification `Wave-Signature` | WP05 | |
| T021 | Wave : statut et annulation (`expire`) | WP05 | |
| T022 | Wave : relevé `GET /v1/transactions` paginé | WP05 | |
| T023 | Wave : faux serveur et tests sur les exemples documentés | WP05 | |
| T024 | PayDunya : facture `checkout-invoice/create` | WP06 | |
| T025 | PayDunya : IPN en formulaire → `SIGNAL` | WP06 | |
| T026 | PayDunya : confirmation → statut, carte sans preuve 3-D Secure | WP06 | |
| T027 | PayDunya : annulation et relevé non documentés | WP06 | |
| T028 | PayDunya : faux serveur, tests et test de borne D2 | WP06 | |
| T029 | Stripe : Checkout Session (formulaire, `Idempotency-Key`, 3-D Secure) | WP07 | |
| T030 | Stripe : notification `Stripe-Signature` (`v0`, entrées inconnues, à relire) | WP07 | |
| T031 | Stripe : statut par session, PaymentIntent et `latest_charge` | WP07 | |
| T032 | Stripe : annulation et relevé `balance_transactions` | WP07 | |
| T033 | Stripe : faux serveur et tests | WP07 | |
| T034 | Secrets Manager : lecture et forme JSON par fournisseur | WP08 | |
| T035 | Secrets Manager : rotation (`AWSPREVIOUS`, échéance) | WP08 | |
| T036 | Secrets Manager : refus, erreurs neutres, cache 60 s | WP08 | |
| T037 | Secrets Manager : faux serveur et tests | WP08 | |
| T038 | KMS : les cinq ports sur `KMSClient` | WP09 | |
| T039 | KMS : bornes (4 096 octets), mise à zéro, erreurs sans identifiant | WP09 | |
| T040 | KMS : `forCapabilities` (un processus, ses seuls ports) | WP09 | |
| T041 | S3 Object Lock : écriture verrouillée, `If-None-Match`, relecture | WP09 | |
| T042 | KMS et S3 : faux serveurs et tests | WP09 | |
| T043 | Services externes et liste `PRODUCTION_ENABLED_SERVICES`, test de borne | WP10 | |
| T044 | Sélection `fake`/`real` dans les fabriques PSP, coffre, KMS, copie | WP10 | |
| T045 | Garde : non essayé refusé en production, message nommant le service | WP10 | |
| T046 | Architecture : aucun client AWS dans le processus public, faux bornés | WP10 | |
| T047 | `COVERAGE` des refus en production, `docs/essais/README.md` | WP10 | |
| T048 | Commande d'essai : cadre, refus en production, compte rendu sans secret | WP11 | |
| T049 | Essais des trois PSP | WP11 | [P] |
| T050 | Essais Secrets Manager, KMS, S3 | WP11 | [P] |
| T051 | Tests de la commande contre les faux serveurs | WP11 | |
| T052 | Attestation Android : comparaison à la documentation de Google | WP12 | [P] |
| T053 | Apple App Attest : comparaison à la documentation d'Apple | WP12 | [P] |
| T054 | Correctifs seulement en cas d'écart, compte rendu de comparaison | WP12 | |
| T055 | OP et ADR des écarts D2 et D7, et des points « à confirmer à l'essai » | WP13 | |
| T056 | Libellés « 12b » précisés (12b-1 / 12b) | WP13 | |
| T057 | `SERVICES-EXTERNES.md` : paramètres à poser par service | WP13 | |
| T058 | PRD, PROMPTS, garde de consignation | WP13 | |
| T059 | Preuves et note aux équipes | WP13 | |

## Phase 1 — Fondations

### WP01 — Socle : dépendances, configuration, client HTTP, garde réseau
Prompt : `tasks/WP01-socle.md`. Priorité P1. Dépendances : aucune.
T001 Dépendances `axios` et SDK AWS épinglées, script `essai` (WP01)
T002 Clés de configuration de la mission (WP01)
T003 Client HTTP sortant `PspHttpClient` (WP01)
T004 Faux serveur HTTP générique et garde « aucun réseau » en test (WP01)
T005 Tests du client et de la garde, mutations (WP01)
Esquisse : installer et épingler ; config ; client ; outils de test. Risque : dépendance mal épinglée, lockfile.

### WP02 — Port PSP révisé et signature paramétrée
Prompt : `tasks/WP02-port-psp.md`. Priorité P1. Dépendances : aucune.
T006 Types : verdicts, relevé (WP02)
T007 Identifiants par fournisseur (WP02)
T008 Signature HMAC paramétrée (WP02)
T009 Faux adaptés, `FakeSignalPspAdapter` (WP02)
T010 Tests et mutations (WP02)
Risque : casser les tests existants des faux ; le faux garde son schéma.

### WP04 — Contrat de `receivePspWebhook` (D9)
Prompt : `tasks/WP04-contrat.md`. Priorité P2. Dépendances : aucune.
T016 Contenu en formulaire (WP04)
T017 Description par fournisseur (WP04)
T018 Base de stabilité, types générés, test de gel (WP04)

## Phase 2 — Réception et adaptateurs

### WP03 — Réception, signal et relecture
Prompt : `tasks/WP03-reception-relecture.md`. Priorité P1. Dépendances : WP02.
T011 Vérifieur (WP03)
T012 Réception en formulaire, conservation d'un signal (WP03)
T013 `PspStatusConfirmer` (WP03)
T014 Relecture asynchrone bornée (WP03)
T015 Tests de bout en bout (WP03)
Risque : crédit sur un signal ; appel réseau pendant la réception ; double crédit (NFR-005).

### WP05 — Adaptateur Wave
Prompt : `tasks/WP05-wave.md`. Priorité P1. Dépendances : WP01, WP02.
T019 T020 T021 T022 T023 (WP05)

### WP06 — Adaptateur PayDunya
Prompt : `tasks/WP06-paydunya.md`. Priorité P1. Dépendances : WP01, WP02.
T024 T025 T026 T027 T028 (WP06)

### WP07 — Adaptateur Stripe
Prompt : `tasks/WP07-stripe.md`. Priorité P2. Dépendances : WP01, WP02.
T029 T030 T031 T032 T033 (WP07)

### WP08 — Coffre AWS Secrets Manager
Prompt : `tasks/WP08-secrets-manager.md`. Priorité P1. Dépendances : WP01, WP02.
T034 T035 T036 T037 (WP08)

### WP09 — AWS KMS et S3 Object Lock
Prompt : `tasks/WP09-kms-s3.md`. Priorité P2. Dépendances : WP01.
T038 T039 T040 T041 T042 (WP09)

### WP12 — Attestations Android et Apple
Prompt : `tasks/WP12-attestations.md`. Priorité P3. Dépendances : aucune.
T052 T053 T054 (WP12)

## Phase 3 — Garde, essais, consignation

### WP10 — Garde de production et sélection
Prompt : `tasks/WP10-garde-selection.md`. Priorité P1. Dépendances : WP03, WP05, WP06, WP07, WP08, WP09.
T043 T044 T045 T046 T047 (WP10)

### WP11 — Commandes d'essai
Prompt : `tasks/WP11-essais.md`. Priorité P1. Dépendances : WP10.
T048 T049 T050 T051 (WP11)

### WP13 — Consignation et preuves
Prompt : `tasks/WP13-consignation.md`. Priorité P1. Dépendances : WP04, WP11, WP12.
T055 T056 T057 T058 T059 (WP13)

## Parallélisme

WP01, WP02, WP04 et WP12 démarrent ensemble ; puis WP03, WP05 à WP09 en parallèle ; puis WP10, WP11, WP13.
MVP : WP01 + WP02 + WP03 + WP05 (Wave de bout en bout, encore refusé en production).
