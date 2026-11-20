# Tasks — Serveur de l'app festivalier (mission 10a)

Mission `serveur-app-festivalier-01M7WB69`, planification et fusion sur `feat/serveur-app-festivalier`. Références :
`spec.md`, `plan.md` (IC-01 à IC-07), `interfaces.md` (fait foi sur les noms et signatures), `data-model.md`,
`contracts/`, fiche commune `docs/passation-10a/fiche-implementation.md`.

Les lignes `Txxx` sont des références ; l'avancement s'enregistre par `spec-kitty agent tasks mark-status`.

## Subtask Index

| ID | Description | WP | Parallel |
|---|---|---|---|
| T001 | `create_kyc_verification` (DEFINER, règles §6.3 1 à 4, agent titulaire) | WP01 | |
| T002 | `revoke_kyc_verification` (VERIFIED → REVOKED, motif, déjà révoquée) | WP01 | |
| T003 | Codes `CL060` à `CL063` et en-tête de migration | WP01 | |
| T004 | pgTAP `tests_kyc_functions.sql` (règles, niveau calculé, expiration, isolation) | WP01 | |
| T005 | Test de borne C-005 (agent sans téléphone ou autre numéro : accepté) | WP01 | |
| T006 | Colonnes de version et `CHECK` de cohérence | WP02 | [P] |
| T007 | Fonctions versionnées (6) et retrait des anciennes signatures | WP02 | |
| T008 | `claim_key_version_max` et `reissue_claim_codes` | WP02 | |
| T009 | `media.printed_number`, unicité, `associate_claim_code` étendue | WP02 | |
| T010 | pgTAP `tests_claim_key_version.sql` (ancienne version absente, réémission, lots clos, numéro imprimé) | WP02 | |
| T011 | `wallet_pending_offline_notice` et index | WP03 | [P] |
| T012 | Table `otp_channel_attempt` (RLS forcée, sans code) | WP03 | [P] |
| T013 | pgTAP `tests_pending_offline_notice.sql` et `tests_otp_channel_attempt.sql` | WP03 | |
| T014 | Rôle `cashless_claimadmin` (`roles.sql`) et `post-roles.sql` §14 | WP04 | |
| T015 | Listes figées de droits (`tests_execute_grants` et suites de droits) mises à jour ; `tests_10a_rights.sql` | WP04 | |
| T016 | Rôle dans `tools/dev-db/env.sh`, workflow CI, `migrate.ts`, `disposable-databases.ts`, `test/support/db.ts` | WP04 | |
| T017 | Test de borne : `cashless_app` ne peut pas exécuter `reissue_claim_codes` ni écrire `kyc_verification` | WP04 | |
| T018 | `KycModule`, `KycController`, `KycService.create` (rôle et portée de l'agent) | WP05 | |
| T019 | Mappage `CL060` à `CL063` dans `errors/sqlstate-map.ts` | WP05 | |
| T020 | Audit de l'identification (sans `id_last4` en clair dans les journaux) | WP05 | |
| T021 | Intégration `kyc/create.spec.ts` (201, 422, 403, expirée, isolation, idempotence) | WP05 | |
| T022 | Intégration plafonds : recharge refusée avant, acceptée après identification (SC-001) | WP05 | |
| T023 | `kyc-revocation-action.ts` (`KYC_REVOCATION`, `guardDecision`, `execute`) | WP06 | |
| T024 | `KycRevocationController` (`202`, `409` à la demande) | WP06 | |
| T025 | Intégration `kyc/revoke.spec.ts` (deux personnes, auteur refusé, `FAILED` si déjà révoquée, niveau `NONE` après) | WP06 | |
| T026 | Contradiction §6.3 notée en tête du module | WP06 | |
| T027 | `config.ts` : `CLAIM_CODE_HMAC_KEY_VERSION`, délais OTP, tests de configuration | WP07 | |
| T028 | `ClaimHasher.keyVersion` ; refus de démarrage si version < `claim_key_version_max()` | WP07 | |
| T029 | `claims.service.ts` et consultation anonyme : signatures versionnées | WP07 | |
| T030 | `claim-codes.service.ts` : commande et import versionnés, 3e colonne `printed_number`, deux motifs nouveaux | WP07 | |
| T031 | `personalization.service.ts` : `register_personalized_media` versionnée | WP07 | |
| T032 | Intégration `media/claim-rotation.spec.ts` (code ancien refusé partout comme inconnu ; import accepté) | WP07 | |
| T033 | `cli/reissue-claim-codes.ts` (fichier 0600, refus d'écraser, stdout = nombre) | WP08 | |
| T034 | Connexion `DATABASE_URL_CLAIMADMIN`, codes de sortie | WP08 | |
| T035 | Intégration `cli/reissue-claim-codes.spec.ts` (rotation de bout en bout, lot clos, bracelet utilisé ignoré) | WP08 | |
| T036 | `docs/procedure-rotation-codes-rattachement.md` | WP08 | [P] |
| T037 | `me.service.ts` : `printed_number` lu en base | WP09 | |
| T038 | `me.service.ts` : `pending_offline_notice` par portefeuille | WP09 | |
| T039 | `openapi.yaml` (description du corps `text/csv`) et `contract-baseline.json` | WP09 | |
| T040 | Intégration `customer-app/me-10a.spec.ts` et mesure NFR-004 | WP09 | |
| T041 | `OtpProvider`, trois faux réglables, refus en production | WP10 | |
| T042 | `ChainedOtpSender` (ordre, délais, mémoire bornée, `close()`) | WP10 | |
| T043 | Canaux notés dans `otp_channel_attempt` ; bascules hors limites | WP10 | |
| T044 | Branchement module et `bootstrap.ts` (trois libellés) ; `production-refusals.spec.ts` COVERAGE | WP10 | |
| T045 | Unitaires `otp-chain.spec.ts` (horloge simulée, NFR-001) et intégration (code absent de la base et des journaux) | WP10 | |
| T046 | `POINTS_OUVERTS.md` (C-005, contradiction §6.3, OP-N47 levé) et `DECISIONS_ADR.md` | WP11 | |
| T047 | Reports dans `PROMPTS-A-ENVOYER.md` et `PRD.md` | WP11 | |
| T048 | Preuves : tableau FR/NFR/SC → test, commande, résultat (`docs/passation-10a/preuves.md`) | WP11 | |

## Phase 1 — Base de données

### WP01 — Base : fonctions KYC

- **Goal**: seule voie d'écriture des identifications, avec les règles §6.3 et la règle de l'agent titulaire.
- **Priority**: P1. **Independent test**: `pg_prove tests/tests_kyc_functions.sql`.
- **Subtasks**: T001, T002, T003, T004, T005.
- **Dependencies**: none.
- **Prompt**: `tasks/WP01-base-kyc.md` (~220 lignes).
- **Risks**: `wallet_kyc_level` et `check_wallet_limits` ne changent pas ; numéros comparés en E.164 exact.

### WP02 — Base : version du secret des codes, réémission, numéro imprimé

- **Goal**: chaque empreinte porte sa version ; une ancienne version compte comme absente ; réémission contrôlée.
- **Priority**: P2. **Independent test**: `pg_prove tests/tests_claim_key_version.sql` et les suites de codes existantes.
- **Subtasks**: T006, T007, T008, T009, T010.
- **Dependencies**: none.
- **Prompt**: `tasks/WP02-base-version-codes.md` (~250 lignes).
- **Risks**: six fonctions remplacées ; les suites pgTAP existantes qui les appellent passent à la nouvelle signature
  (retouches hors carte listées : `tests_media_claims.sql`, `tests_personalization*.sql`, etc.).

### WP03 — Base : avis hors ligne et canaux d'envoi

- **Goal**: calcul de l'avis de solde provisoire ; table des canaux essayés, sans code.
- **Priority**: P2. **Independent test**: les deux suites pgTAP nouvelles.
- **Subtasks**: T011, T012, T013.
- **Dependencies**: none.
- **Prompt**: `tasks/WP03-base-avis-canaux.md` (~170 lignes).

### WP04 — Droits de la base et environnements

- **Goal**: droits exacts des objets nouveaux ; rôle `cashless_claimadmin` partout où un rôle doit exister.
- **Priority**: P1. **Independent test**: suites de droits figées vertes ; `tests_10a_rights.sql`.
- **Subtasks**: T014, T015, T016, T017.
- **Dependencies**: WP01, WP02, WP03.
- **Prompt**: `tasks/WP04-droits-base.md` (~230 lignes).
- **Risks**: mot de passe du rôle absent en CI (piège de la PR #20) ; listes figées.

## Phase 2 — API

### WP05 — Identification au guichet (API)

- **Subtasks**: T018, T019, T020, T021, T022. **Dependencies**: WP04.
- **Prompt**: `tasks/WP05-kyc-identification.md` (~240 lignes).

### WP06 — Révocation à deux personnes

- **Subtasks**: T023, T024, T025, T026. **Dependencies**: WP05.
- **Prompt**: `tasks/WP06-kyc-revocation.md` (~200 lignes).

### WP07 — Codes versionnés côté API et configuration

- **Subtasks**: T027, T028, T029, T030, T031, T032. **Dependencies**: WP04.
- **Prompt**: `tasks/WP07-codes-versionnes-api.md` (~260 lignes).
- **Risks**: tout appelant des six fonctions doit passer la version ; l'adresse de consultation anonyme dérive du même
  secret (compteurs remis à zéro à la rotation, accepté).

### WP08 — Réémission et procédure de rotation

- **Subtasks**: T033, T034, T035, T036. **Dependencies**: WP07.
- **Prompt**: `tasks/WP08-reemission-procedure.md` (~210 lignes).
- **Risks**: le fichier produit contient des codes en clair : jamais journalisé, mode 0600.

### WP09 — `/me` complet et ajout au contrat

- **Subtasks**: T037, T038, T039, T040. **Dependencies**: WP04, WP07.
- **Prompt**: `tasks/WP09-me-complet.md` (~200 lignes).

### WP10 — Chaîne d'envoi des codes

- **Subtasks**: T041, T042, T043, T044, T045. **Dependencies**: WP04, WP07.
- **Prompt**: `tasks/WP10-chaine-envoi-codes.md` (~260 lignes).
- **Risks**: minuteries qui fuient ; code d'un titulaire (mission 9a) ; `X-Test-Otp-Code` inchangé.

## Phase 3 — Consignation

### WP11 — Preuves, consignation, documentation

- **Subtasks**: T046, T047, T048. **Dependencies**: WP01 à WP10.
- **Prompt**: `tasks/WP11-preuves-consignation.md` (~180 lignes).

## Parallélisme

WP01, WP02, WP03 en parallèle ; WP04 ensuite ; puis WP05, WP07 en parallèle ; WP06 après WP05 ; WP08, WP09, WP10
après WP07 ; WP11 en dernier. Plus court chemin vers un premier résultat utile (MVP) : WP01 → WP04 → WP05.
