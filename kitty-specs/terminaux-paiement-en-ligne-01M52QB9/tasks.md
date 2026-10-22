# Tasks — Encaissement en ligne

Mission `terminaux-paiement-en-ligne-01M52QB9` · branche `feat/terminaux-paiement-en-ligne` (planification et merge).
Sources : [spec.md](spec.md), [plan.md](plan.md), [research.md](research.md), [data-model.md](data-model.md),
[contracts/](contracts/), [quickstart.md](quickstart.md).

Le suivi d'avancement est **événementiel** (`spec-kitty agent tasks mark-status Txxx --status done`) : les lignes
`Txxx` ci-dessous sont des références, pas des cases à cocher.

Règles transverses :
- `CLAUDE.md` (C-009) : tout écart qui affaiblit la sécurité est soumis au porteur avant d'être codé ; un renforcement
  se fait puis se consigne. Fichiers `.sql` générés du kit jamais modifiés à la main (C-002).
- Pile : `docs/08-pile-logicielle.md` (Node 22, `argon2@0.44.0` épinglé) ; aucune autre dépendance sans la
  vérification décrite en tête de ce document.
- Ordre global des verrous (contracts/vendors.md) : **terminal → vendeur → session de vendeur → demande QR → bracelet
  → portefeuille**. Toute fonction et tout service de la mission le suivent.
- Matrice d'acceptation (`acceptance-matrix.json`) : tenue **au fil des lots** par l'orchestrateur (critère passé à
  `pass` avec sa preuve à chaque approbation de lot), pas à la fin.
- Tests : pgTAP et Jest lancés **en série** par l'orchestrateur (base partagée) ; un implémenteur peut valider son SQL
  sur un cluster PostgreSQL jetable du scratchpad.

Numérotation des migrations (celle du plan) : `0031` vendeurs, sessions et `set_device_status` ; `0032` catalogue et
lignes de vente ; `0033` paiement, annulation et approbation sur place pour un terminal ; `0034` demandes QR ; `0035`
OP-N74. `0028` reste libre.

Fichiers partagés : `apps/api/src/app.module.ts` reçoit **une ligne** d'import par module de routes (WP09 à WP13,
retouche hors carte autorisée, à consigner dans le compte rendu du lot). La matrice des preuves des routes de terminal
lit un registre de cas créé par WP08 ; chaque lot de routes possède son propre fichier de cas.

## Subtask Index

| ID | Description | WP | Parallel |
|---|---|---|---|
| T001 | Routes et schémas des vendeurs et des sessions de vendeur | WP01 | |
| T002 | Routes et schémas du catalogue | WP01 | |
| T003 | Compléments des paiements, de l'annulation et des QR | WP01 | |
| T004 | Codes d'erreur, action `SALE_REVERSAL`, refus `ENROLLMENT_EVENT_CLOSED` | WP01 | |
| T005 | `x-process`, génération des types TypeScript et Dart, contrôles du contrat | WP01 | |
| T006 | Tables `vendor`, `vendor_pin_check`, `vendor_session`, vue `vendor_public` | WP02 | [P] |
| T007 | `create_vendor`, `set_vendor_pin`, `set_vendor_status` | WP02 | |
| T008 | `begin_vendor_pin_check`, `open_vendor_session`, `close_vendor_session`, `assert_vendor_session` | WP02 | |
| T009 | `set_device_status` remplacée : fermeture des sessions | WP02 | |
| T010 | Suite `tests_vendors.sql` | WP02 | |
| T011 | Tables du catalogue, des versions, de la politique, des versions servies, `sale_line` | WP03 | [P] |
| T012 | Fonctions d'écriture du catalogue (version suivante, verrou, délégation) | WP03 | |
| T013 | `record_device_catalog_served` et lecture d'une version | WP03 | |
| T014 | `record_sale_lines` | WP03 | |
| T015 | Suite `tests_catalog.sql` | WP03 | |
| T016 | `sale_attribution` et `record_sale_attribution` | WP04 | |
| T017 | `assert_tap_payable`, `consume_tap` remplacée, `assert_wallet_payable` | WP04 | |
| T018 | Index `journal_transaction_reverses_once`, `assert_reversible` | WP04 | |
| T019 | `approval_token_use` (appelant terminal), action `SALE_REVERSAL` | WP04 | |
| T020 | Suite `tests_payments.sql` | WP04 | |
| T021 | `payment_request_detail` | WP05 | |
| T022 | `create_merchant_payment_request`, `create_customer_qr_token` | WP05 | |
| T023 | Verrouillage, confirmation, annulation des demandes | WP05 | |
| T024 | Suite `tests_payment_requests.sql` | WP05 | |
| T025 | `create_device_enrollment_code` remplacée (état de l'événement, mode) | WP06 | [P] |
| T026 | `enroll_device` remplacée (contrôles de 0022 gardés, état relu) | WP06 | |
| T027 | Suite `tests_enrollment_event_state.sql` et non-régression de 0022 | WP06 | |
| T028 | Retraits de droits à `cashless_app` | WP07 | |
| T029 | Fonctions accordées, `record_device_seq`, liste figée | WP07 | |
| T030 | Tests de droits : listes exactes, refus, chemins légitimes | WP07 | |
| T031 | Bornes d'OP-N76 et `tests_device_rights.sql` | WP07 | |
| T032 | Dépendance `argon2@0.44.0` et test des empreintes des binaires | WP08 | [P] |
| T033 | `VENDOR_PIN_SECRET`, vecteur argon2 au démarrage, garde de production | WP08 | |
| T034 | `DeviceContext` enrichi | WP08 | |
| T035 | Idempotence d'une route de terminal (prestataire, `serial`, refus non définitifs) | WP08 | |
| T036 | Garde exclusive « terminal ou personne » | WP08 | |
| T037 | Traduction des codes d'erreur et masquage des journaux | WP08 | |
| T038 | Registre de cas de la matrice des preuves | WP08 | |
| T039 | Back-office des vendeurs | WP09 | |
| T040 | Liste des vendeurs pour le terminal | WP09 | |
| T041 | Ouverture de session « compter d'abord » | WP09 | |
| T042 | Fermeture de session et service de garde de session | WP09 | |
| T043 | Tests des vendeurs et cas de la matrice | WP09 | |
| T044 | Back-office du catalogue et versions | WP10 | |
| T045 | Politique de délégation au commerçant | WP10 | |
| T046 | Catalogue servi dans la configuration | WP10 | |
| T047 | Tests du catalogue | WP10 | |
| T048 | Module des paiements et `createPayment` (lecture embarquée) | WP11 | |
| T049 | Paiement par `tap_id` | WP11 | |
| T050 | Paiement par QR client | WP11 | |
| T051 | Heure de l'opération et époque d'autorité | WP11 | |
| T052 | Registre des numéros : réussites, refus, refus non définitifs | WP11 | |
| T053 | `getPayment` | WP11 | |
| T054 | Tests des paiements et cas de la matrice | WP11 | |
| T055 | Annulation par le vendeur depuis le terminal | WP12 | |
| T056 | Jeton sur place pour un appelant terminal | WP12 | |
| T057 | Annulation par le `SUPERVISOR` au terminal | WP12 | |
| T058 | Action `SALE_REVERSAL` au back-office | WP12 | |
| T059 | Tests de l'annulation | WP12 | |
| T060 | Cas de la matrice (annulation) | WP12 | |
| T061 | Demande QR commerçant côté terminal | WP13 | |
| T062 | Paiement, consultation et annulation côté festivalier | WP13 | |
| T063 | QR client côté festivalier | WP13 | |
| T064 | Tests des QR | WP13 | |
| T065 | Cas de la matrice (QR) | WP13 | |
| T066 | Parcours complet (SC-001) | WP14 | |
| T067 | Isolation (NFR-007) | WP14 | [P] |
| T068 | Secrets (NFR-002, NFR-008) | WP14 | [P] |
| T069 | Latence (NFR-001) et CI | WP14 | |
| T070 | Concurrence transverse (NFR-005) | WP14 | |
| T071 | Consignation (points ouverts, ADR, PROMPTS, PRD) | WP14 | |
| T072 | Liste des fichiers à faire relire par une personne | WP14 | |

## Phase 1 — Contrat et base de données

### WP01 — Contrat d'API et types (`tasks/WP01-contrat-api-types.md`)

- **Goal** : décrire au contrat toutes les routes et compléments de la mission avant qu'elles soient servies ;
  régénérer les types.
- **Priority** : P1. **Dependencies** : aucune. **Estimated prompt** : ~150 lignes.
- Subtasks :
  T001 Routes et schémas des vendeurs et des sessions de vendeur (WP01)
  T002 Routes et schémas du catalogue (WP01)
  T003 Compléments des paiements, de l'annulation et des QR (WP01)
  T004 Codes d'erreur, action `SALE_REVERSAL`, refus `ENROLLMENT_EVENT_CLOSED` (WP01)
  T005 `x-process`, génération des types TypeScript et Dart, contrôles du contrat (WP01)
- Risques : `x-process` ne se pose que sur les opérations servies, au lot qui les sert (WP09 à WP13) — ici seulement les
  descriptions ; `supervisor_pin_proof` refusé ; jetons jamais rejoués.

### WP02 — Vendeurs, sessions et `set_device_status` (migration 0031) (`tasks/WP02-base-vendeurs-sessions.md`)

- **Goal** : tables et fonctions S2 ; essai de PIN compté d'abord ; sessions fermées par la base.
- **Priority** : P1. **Dependencies** : aucune. **Estimated prompt** : ~170 lignes.
- Subtasks :
  T006 Tables `vendor`, `vendor_pin_check`, `vendor_session`, vue `vendor_public` (WP02)
  T007 `create_vendor`, `set_vendor_pin`, `set_vendor_status` (WP02)
  T008 `begin_vendor_pin_check`, `open_vendor_session`, `close_vendor_session`, `assert_vendor_session` (WP02)
  T009 `set_device_status` remplacée : fermeture des sessions (WP02)
  T010 Suite `tests_vendors.sql` (WP02)
- Risques : compteur jamais au-delà de 5 ; ordre global des verrous ; `set_device_status` garde tous ses contrôles.

### WP03 — Catalogue versionné et lignes de vente (migration 0032) (`tasks/WP03-base-catalogue.md`)

- **Goal** : catalogue par point de vente, versions immuables, versions servies, lignes de vente contrôlées.
- **Priority** : P1. **Dependencies** : aucune. **Estimated prompt** : ~150 lignes.
- Subtasks :
  T011 Tables du catalogue, des versions, de la politique, des versions servies, `sale_line` (WP03)
  T012 Fonctions d'écriture du catalogue (version suivante, verrou, délégation) (WP03)
  T013 `record_device_catalog_served` et lecture d'une version (WP03)
  T014 `record_sale_lines` (WP03)
  T015 Suite `tests_catalog.sql` (WP03)
- Risques : versions admises = courante et **dernière** servie (A2) ; une version par vente ; versions concurrentes.

### WP04 — Paiement, annulation, approbation sur place (migration 0033) (`tasks/WP04-base-paiement-annulation.md`)

- **Goal** : attribution par la session, lecture payable, portefeuille payable, annulation unique et contrôlée, appelant
  terminal pour le jeton sur place.
- **Priority** : P1. **Dependencies** : WP02, WP03. **Estimated prompt** : ~170 lignes.
- Subtasks :
  T016 `sale_attribution` et `record_sale_attribution` (WP04)
  T017 `assert_tap_payable`, `consume_tap` remplacée, `assert_wallet_payable` (WP04)
  T018 Index `journal_transaction_reverses_once`, `assert_reversible` (WP04)
  T019 `approval_token_use` (appelant terminal), action `SALE_REVERSAL` (WP04)
  T020 Suite `tests_payments.sql` (WP04)
- Risques : `consume_tap` remplacée garde 0026 (verrou consultatif, idempotence, rattachement) ; fenêtre sur
  `recorded_at` ; aucun scénario du kit n'annule deux fois une vente (à vérifier).

### WP05 — Demandes de paiement QR (migration 0034) (`tasks/WP05-base-demandes-qr.md`)

- **Goal** : création, verrouillage, confirmation, annulation des demandes QR par la base.
- **Priority** : P2. **Dependencies** : WP04. **Estimated prompt** : ~140 lignes.
- Subtasks :
  T021 `payment_request_detail` (WP05)
  T022 `create_merchant_payment_request`, `create_customer_qr_token` (WP05)
  T023 Verrouillage, confirmation, annulation des demandes (WP05)
  T024 Suite `tests_payment_requests.sql` (WP05)
- Risques : ordre des verrous (terminal avant la demande) ; confirmation liée à la vente exacte.

### WP06 — OP-N74 : enrôlement et état de l'événement (migration 0035) (`tasks/WP06-base-op-n74.md`)

- **Goal** : refus selon l'état de l'événement et le mode, sans rien écrire.
- **Priority** : P1. **Dependencies** : aucune. **Estimated prompt** : ~110 lignes.
- Subtasks :
  T025 `create_device_enrollment_code` remplacée (état de l'événement, mode) (WP06)
  T026 `enroll_device` remplacée (contrôles de 0022 gardés, état relu) (WP06)
  T027 Suite `tests_enrollment_event_state.sql` et non-régression de 0022 (WP06)
- Risques : fonctions remplacées en entier ; `tests_device_enrollment.sql` et suites de la 5a doivent rester vertes.

### WP07 — Droits de la base (`tasks/WP07-droits-base.md`)

- **Goal** : retraits et accords nommés de `post-roles.sql` pour toute la mission, prouvés par listes exactes.
- **Priority** : P1. **Dependencies** : WP02, WP03, WP04, WP05, WP06. **Estimated prompt** : ~150 lignes.
- Subtasks :
  T028 Retraits de droits à `cashless_app` (WP07)
  T029 Fonctions accordées, `record_device_seq`, liste figée (WP07)
  T030 Tests de droits : listes exactes, refus, chemins légitimes (WP07)
  T031 Bornes d'OP-N76 et `tests_device_rights.sql` (WP07)
- Risques : `REVOKE` de table puis `GRANT` par colonne (A20) ; colonnes de `device` retirées (A12).

## Phase 2 — Socle applicatif

### WP08 — Socle : argon2, secret, contexte du terminal, idempotence, garde, erreurs (`tasks/WP08-socle-applicatif.md`)

- **Goal** : tout ce dont les lots de routes ont besoin et qu'aucun ne doit écrire seul.
- **Priority** : P1. **Dependencies** : WP01. **Estimated prompt** : ~200 lignes.
- Subtasks :
  T032 Dépendance `argon2@0.44.0` et test des empreintes des binaires (WP08)
  T033 `VENDOR_PIN_SECRET`, vecteur argon2 au démarrage, garde de production (WP08)
  T034 `DeviceContext` enrichi (WP08)
  T035 Idempotence d'une route de terminal (prestataire, `serial`, refus non définitifs) (WP08)
  T036 Garde exclusive « terminal ou personne » (WP08)
  T037 Traduction des codes d'erreur et masquage des journaux (WP08)
  T038 Registre de cas de la matrice des preuves (WP08)
- Risques : l'extension d'`IdentityTenantContext` ne doit pas ouvrir une route de personne à un terminal ; aucune
  garde « l'un ou l'autre » avec repli.

## Phase 3 — Routes

### WP09 — Vendeurs : back-office et sessions (`tasks/WP09-vendeurs-sessions.md`)

- **Goal** : routes des vendeurs, ouverture et fermeture de session, service de garde de session.
- **Priority** : P1. **Dependencies** : WP07, WP08. **Estimated prompt** : ~170 lignes.
- Subtasks :
  T039 Back-office des vendeurs (WP09)
  T040 Liste des vendeurs pour le terminal (WP09)
  T041 Ouverture de session « compter d'abord » (WP09)
  T042 Fermeture de session et service de garde de session (WP09)
  T043 Tests des vendeurs et cas de la matrice (WP09)
- Risques : réponse neutre (NFR-004) ; empreinte factice ; un essai à la fois par terminal (`429`).

### WP10 — Catalogue : back-office et configuration servie (`tasks/WP10-catalogue.md`)

- **Goal** : routes du catalogue, délégation, catalogue et version dans `DeviceConfig`.
- **Priority** : P1. **Dependencies** : WP07, WP08. **Estimated prompt** : ~130 lignes.
- Subtasks :
  T044 Back-office du catalogue et versions (WP10)
  T045 Politique de délégation au commerçant (WP10)
  T046 Catalogue servi dans la configuration (WP10)
  T047 Tests du catalogue (WP10)
- Risques : `config_id` inchangé, ETag changé ; `device_catalog_served` écrit à chaque nouvelle version servie.

### WP11 — Paiement par bracelet (`tasks/WP11-paiement-bracelet.md`)

- **Goal** : `createPayment` (trois moyens), `getPayment`, registre des numéros, heure bornée.
- **Priority** : P1. **Dependencies** : WP09, WP10. **Estimated prompt** : ~200 lignes.
- Subtasks :
  T048 Module des paiements et `createPayment` (lecture embarquée) (WP11)
  T049 Paiement par `tap_id` (WP11)
  T050 Paiement par QR client (WP11)
  T051 Heure de l'opération et époque d'autorité (WP11)
  T052 Registre des numéros : réussites, refus, refus non définitifs (WP11)
  T053 `getPayment` (WP11)
  T054 Tests des paiements et cas de la matrice (WP11)
- Risques : ordre des verrous ; tout ou rien ; latence (NFR-001).

### WP12 — Annulation (`tasks/WP12-annulation.md`)

- **Goal** : annulation par le vendeur, par le `SUPERVISOR` au terminal (jeton sur place) et au back-office (à deux).
- **Priority** : P1. **Dependencies** : WP11. **Estimated prompt** : ~180 lignes.
- Subtasks :
  T055 Annulation par le vendeur depuis le terminal (WP12)
  T056 Jeton sur place pour un appelant terminal (WP12)
  T057 Annulation par le `SUPERVISOR` au terminal (WP12)
  T058 Action `SALE_REVERSAL` au back-office (WP12)
  T059 Tests de l'annulation (WP12)
  T060 Cas de la matrice (annulation) (WP12)
- Risques : la variante de la garde ne relâche aucun contrôle (décision du porteur) ; source `BACKOFFICE` à deux.

### WP13 — Paiement par QR (`tasks/WP13-paiement-qr.md`)

- **Goal** : demandes QR côté terminal et côté festivalier, QR client.
- **Priority** : P2. **Dependencies** : WP11. **Estimated prompt** : ~160 lignes.
- Subtasks :
  T061 Demande QR commerçant côté terminal (WP13)
  T062 Paiement, consultation et annulation côté festivalier (WP13)
  T063 QR client côté festivalier (WP13)
  T064 Tests des QR (WP13)
  T065 Cas de la matrice (QR) (WP13)
- Risques : aucun jeton dans `api_idempotency` (`transient`) ; même refus pour tous les cas d'échec.

## Phase 4 — Preuves et consignation

### WP14 — Preuves de bout en bout, CI, consignation (`tasks/WP14-preuves-ci-consignation.md`)

- **Goal** : parcours complet, isolation, secrets, latence, concurrence, CI, consignation, liste de relecture humaine.
- **Priority** : P1. **Dependencies** : WP09, WP10, WP11, WP12, WP13. **Estimated prompt** : ~190 lignes.
- Subtasks :
  T066 Parcours complet (SC-001) (WP14)
  T067 Isolation (NFR-007) (WP14)
  T068 Secrets (NFR-002, NFR-008) (WP14)
  T069 Latence (NFR-001) et CI (WP14)
  T070 Concurrence transverse (NFR-005) (WP14)
  T071 Consignation (points ouverts, ADR, PROMPTS, PRD) (WP14)
  T072 Liste des fichiers à faire relire par une personne (WP14)
- Risques : mesures en série seulement ; consignation au fil de la mission vérifiée, pas reconstituée à la fin.

## Parallélisme

- Sans dépendance : WP01, WP02, WP03, WP06 (base et contrat en parallèle).
- WP04 après WP02 et WP03 ; WP05 après WP04 ; WP07 après les cinq lots de base.
- WP08 après WP01 ; WP09 et WP10 en parallèle après WP07 et WP08.
- WP11 après WP09 et WP10 ; WP12 et WP13 en parallèle après WP11 ; WP14 ferme la mission.

## MVP

WP01 à WP04, WP07, WP08, WP09, WP10, WP11 : vendre par bracelet avec un vendeur et un catalogue. WP12 (annulation) suit
de près ; WP13 (QR) et WP06 (OP-N74) complètent.

Exigences reportées (spec.md, statut « Deferred ») : FR-021 à FR-023, identification au guichet, mission 10 ; la 5b ne
fait que retirer les écritures directes dans `kyc_verification` (WP07).

## Arbitrages à la génération des lots (22/10/2026)

Détail dans la section « Arbitrages de l'orchestrateur » de chaque lot. Tous dans le sens le plus strict ou de pure
répartition ; aucun écart qui affaiblit la sécurité, donc rien à soumettre au porteur à ce stade.
- Aucun `x-process` sur les opérations de la 5b (`media-isolation.spec.ts`) ; tags `Vendeurs` et `Catalogue`.
- Clé UUID (`transient`) pour l'ouverture et la fermeture de session ; jeton du festivalier en en-tête dédié.
- SQLSTATE `CL038` `MEDIA_BLOCKED`, `CL039` `WALLET_BLOCKED` (en plus de `CL031` à `CL037`).
- Renforcements : approbation du `SUPERVISOR` prouvée en base (`assert_reversible`) ; annulation en `LIVE`/`CLOSING`
  seulement ; confirmation d'une demande QR avec l'empreinte du jeton ; `check_sale_lines` sans écriture ; libellé de
  catégorie copié dans la version ; refus d'enrôlement pour état de l'événement audité ; `INSERT`/`UPDATE` retirés sur
  les vues ; `X-Authority-Epoch` exigé sur les routes de paiement ; essai de PIN unique par terminal tenu en base.
- Annulation dans `apps/api/src/reversals/` (et non `payments/`) ; `SALE_REVERSAL` par `SUPERVISOR` ou
  `ORGANIZER_ADMIN` (contrat).
- Retouches hors carte autorisées : `app.module.ts` (une ligne par module), `audit/audit.service.ts` (ajout d'actions),
  `approval/approval.service.ts` (une ligne, WP12), `devices/enrollment/enrollment.service.ts` (WP06).
- FR-021 à FR-023 rattachés à WP07 pour le seul contrôle de couverture : ils restent reportés à la mission 10.
