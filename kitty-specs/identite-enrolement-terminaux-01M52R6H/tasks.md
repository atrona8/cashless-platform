# Tasks — Identité et enrôlement des terminaux

Mission `identite-enrolement-terminaux-01M52R6H` · branche `feat/identite-enrolement-terminaux` (planification et merge).
Sources : [spec.md](spec.md), [plan.md](plan.md), [research.md](research.md), [data-model.md](data-model.md),
[contracts/](contracts/), [quickstart.md](quickstart.md).

Le suivi d'avancement est **événementiel** (`spec-kitty agent tasks mark-status Txxx --status done`) : les lignes
`Txxx` ci-dessous sont des références, pas des cases à cocher.

Règle transverse (`CLAUDE.md`, C-011) : tout écart qui affaiblit la sécurité est soumis au porteur avant d'être codé ;
un renforcement se fait puis se consigne. Fichiers `.sql` générés du kit jamais modifiés à la main (C-002).

Numérotation des migrations retenue (ajustée par rapport au plan, sans changement de fond) : `0021` search_path
(OP-N59), `0022` S5 enrôlement et statut, `0023` jetons, nonces et garde de statut, `0024` `consume_tap` (OP-N50),
`0025` retrait de clé et demandes périmées (OP-N62). OP-N63 se lève par `post-roles.sql` (WP07) et `enroll_device`
(WP03) : pas de migration propre.

Fichiers partagés : `apps/api/src/devices/devices.module.ts` est créé par WP08 ; chaque lot de routes (WP14 à WP17) y
ajoute **une ligne** d'import (retouche hors carte autorisée, à consigner dans le compte rendu du lot).

## Subtask Index

| ID | Description | WP | Parallel |
|---|---|---|---|
| T001 | Schéma `deviceSignature`, trois preuves sur les routes de terminal | WP01 | |
| T002 | Schémas d'enrôlement, de jeton et de code modifiés | WP01 | |
| T003 | Routes back-office des terminaux | WP01 | |
| T004 | Codes d'erreur et messages | WP01 | |
| T005 | Génération des types et contrôle | WP01 | |
| T006 | Migration 0021 : `search_path` des fonctions `SECURITY DEFINER` | WP02 | [P] |
| T007 | Suite `tests_definer_search_path.sql` | WP02 | |
| T008 | Borne §4 de `tests_definer_trigger_writers.sql` inversée | WP02 | |
| T009 | Suites de référence et rejouabilité | WP02 | |
| T010 | Tables S5, colonnes de `device`, index du `serial` par prestataire | WP03 | [P] |
| T011 | `create_device_enrollment_code` | WP03 | |
| T012 | `enroll_device` | WP03 | |
| T013 | `set_device_status`, `record_device_heartbeat` | WP03 | |
| T014 | Essais d'enrôlement (`device_enrollment_attempt`) | WP03 | |
| T015 | Suite `tests_device_enrollment.sql` | WP03 | |
| T016 | Rotation du jeton de rafraîchissement avec grâce | WP04 | |
| T017 | Révocation et contrôle d'une famille | WP04 | |
| T018 | `consume_device_nonce` et purge | WP04 | |
| T019 | `assert_device_active` | WP04 | |
| T020 | Suite `tests_device_tokens.sql` | WP04 | |
| T021 | Analyse de `consume_tap` et `consume_tap_for_claim` | WP05 | [P] |
| T022 | Migration 0024 | WP05 | |
| T023 | Tests : refus et borne inversée | WP05 | |
| T024 | Suites de référence | WP05 | |
| T025 | Migration 0025 : `retire_dedicated_key_for_job` | WP06 | [P] |
| T026 | Demande approuvée expirée refusée (`CL023`) | WP06 | |
| T027 | Appel de la personnalisation basculé | WP06 | |
| T028 | Suite `tests_tag_key_retire_guard.sql` | WP06 | |
| T029 | Générateur `gen_tests.py` (OP-N44) et régénération | WP07 | |
| T030 | `EXECUTE` rôle par rôle, droits par défaut | WP07 | |
| T031 | `TEMPORARY` retiré (OP-N59) | WP07 | |
| T032 | Droits sur `device` et les tables S5 (OP-N63) | WP07 | |
| T033 | Bornes inversées de `tests_tag_key_job_approval.sql` (§6, §7) et `tests_media_roles.sql` | WP07 | |
| T034 | Suites `tests_execute_grants.sql`, `tests_device_rights.sql` | WP07 | |
| T035 | Dépendances, `overrides`, `.npmrc` | WP08 | [P] |
| T036 | Réglages (`config.ts`) | WP08 | |
| T037 | Démarrage HTTPS avec certificat client | WP08 | |
| T038 | Jetons de ports et garde de production | WP08 | |
| T039 | Module `devices` et serveur HTTPS de test | WP08 | |
| T040 | Tests unitaires du socle | WP08 | |
| T041 | `DeviceCaPort` et son faux | WP09 | |
| T042 | `TokenSignerPort` et son faux | WP09 | |
| T043 | Service des jetons d'appareil | WP09 | |
| T044 | Module et refus en production | WP09 | |
| T045 | Tests unitaires | WP09 | |
| T046 | Port de vérification et défis d'enrôlement | WP10 | |
| T047 | Vérification de la chaîne Android | WP10 | |
| T048 | Contrôles de KeyDescription | WP10 | |
| T049 | Liste de révocation Google en cache | WP10 | |
| T050 | Chaînes de test Android | WP10 | |
| T051 | Tests unitaires Android | WP10 | |
| T052 | Vérification App Attest | WP11 | |
| T053 | Objets App Attest de test | WP11 | |
| T054 | Garde `appattestdevelop` et réglages iOS | WP11 | |
| T055 | Tests unitaires iOS | WP11 | |
| T056 | Profil de signature des requêtes | WP12 | |
| T057 | Magasin de nonces | WP12 | |
| T058 | `RealDeviceIdentity` (ordre des contrôles) | WP12 | |
| T059 | `DeviceGuard` (`allowSuspended`), annuaire, câblage des deux processus | WP12 | |
| T060 | Terminal de test | WP12 | |
| T061 | Borne iOS sur `/media/auth-keys` (OP-N64) | WP12 | |
| T062 | Tests unitaires et `media-port-swap` | WP12 | |
| T063 | Empreinte de requête à clé (OP-N54) | WP13 | [P] |
| T064 | Code d'enrôlement : génération, normalisation, empreinte | WP13 | |
| T065 | Tests unitaires | WP13 | |
| T066 | `POST /device-enrollment-codes` (route `transient`) | WP14 | |
| T067 | `GET /device-enrollment-codes` | WP14 | |
| T068 | `POST /device-enrollments` | WP14 | |
| T069 | Limites de débit et audit des refus | WP14 | |
| T070 | Tests d'intégration de l'enrôlement | WP14 | |
| T071 | Route `POST /device-tokens/refresh` | WP15 | |
| T072 | Preuve de possession et mTLS | WP15 | |
| T073 | Grâce, échange en cours, famille révoquée | WP15 | |
| T074 | Tests d'intégration du rafraîchissement | WP15 | |
| T075 | Liste et fiche des terminaux | WP16 | [P] |
| T076 | Suspension, réactivation, révocation | WP16 | |
| T077 | Portée de l'administrateur d'organisateur, audit | WP16 | |
| T078 | Tests d'intégration du back-office | WP16 | |
| T079 | Construction de `DeviceConfig` | WP17 | [P] |
| T080 | `GET /device/config` et ETag | WP17 | |
| T081 | `POST /device/heartbeat` | WP17 | |
| T082 | Tests d'intégration | WP17 | |
| T083 | Parcours complet et matrice des preuves | WP18 | |
| T084 | Isolation, secrets, latence | WP18 | |
| T085 | CI | WP18 | |
| T086 | Consignation des dettes et décisions | WP18 | |
| T087 | Fichiers à faire relire par une personne | WP18 | |

## Phase 1 — Contrat et base de données

### WP01 — Contrat d'API et types (`tasks/WP01-contrat-api-types.md`)

- **Goal** : décrire au contrat tout ce que la mission sert (C-008) ; trois preuves ensemble.
- **Priority** : P1, à faire en premier. **Dependencies** : aucune. **Estimated prompt** : ~110 lignes.
- **Independent test** : `npm run generate` sans écart ; `openapi.yaml` valide ; les routes de terminal ont une seule entrée `security`.
- Subtasks : T001, T002, T003, T004, T005.
- Risques : deux entrées `security` voudraient dire « ou » ; ne pas retirer `CLOCK_SKEW_TOO_LARGE`.

### WP02 — OP-N59 : `search_path` des fonctions privilégiées (`tasks/WP02-op-n59-search-path.md`)

- **Goal** : aucune table temporaire ne masque une table lue par une fonction `SECURITY DEFINER`.
- **Priority** : P1 (bloque la production). **Dependencies** : aucune. **Estimated prompt** : ~100 lignes.
- Subtasks : T006, T007, T008, T009.

### WP03 — S5 : enrôlement et statut (migration 0022) (`tasks/WP03-s5-enrolement-statut.md`)

- **Goal** : tables S5, `serial` par prestataire, fonctions d'émission de code, d'enrôlement, de statut, de battement de cœur, d'essais.
- **Priority** : P1. **Dependencies** : aucune. **Estimated prompt** : ~140 lignes.
- Subtasks : T010, T011, T012, T013, T014, T015.
- Risques : `PAIRED_TPE` absent du `CHECK` ; `next_seq` borné au prestataire ; concurrence sur le code.

### WP04 — Jetons, nonces et garde de statut (migration 0023) (`tasks/WP04-jetons-nonces-garde.md`)

- **Goal** : rotation à grâce de 60 s, familles, nonces à l'heure de la base, revérification du statut dans la transaction métier.
- **Priority** : P1. **Dependencies** : WP03. **Estimated prompt** : ~120 lignes.
- Subtasks : T016, T017, T018, T019, T020.

### WP05 — OP-N50 : `consume_tap` et lecture de rattachement (migration 0024) (`tasks/WP05-op-n50-consume-tap.md`)

- **Goal** : une lecture qui a confirmé un rattachement ne sert plus à une écriture.
- **Priority** : P2. **Dependencies** : aucune. **Estimated prompt** : ~90 lignes.
- Subtasks : T021, T022, T023, T024.

### WP06 — OP-N62 : retrait de clé et demandes périmées (migration 0025) (`tasks/WP06-op-n62-retrait-cle.md`)

- **Goal** : retrait d'une clé dédiée seulement par un travail `RETIRE_KEY` en cours ; demande approuvée expirée refusée.
- **Priority** : P2. **Dependencies** : aucune. **Estimated prompt** : ~100 lignes.
- Subtasks : T025, T026, T027, T028.

### WP07 — Droits de la base : OP-N44, OP-N59, OP-N63 (`tasks/WP07-droits-base.md`)

- **Goal** : `EXECUTE` rôle par rôle, `TEMPORARY` retiré, aucune écriture directe de l'API sur les terminaux et les tables S5.
- **Priority** : P1 (bloque la production). **Dependencies** : WP02, WP03, WP04, WP05, WP06. **Estimated prompt** : ~140 lignes.
- Subtasks : T029, T030, T031, T032, T033, T034.
- Risques : `roles.sql` (kit) redonne tout à chaque rejeu ; une fonction oubliée casse une route.

## Phase 2 — Socle applicatif

### WP08 — Socle : dépendances, réglages, HTTPS, garde de production (`tasks/WP08-socle-https-config.md`)

- **Goal** : processus HTTP en TLS 1.3 avec certificat client demandé, réglages de la mission, garde étendue.
- **Priority** : P1. **Dependencies** : aucune. **Estimated prompt** : ~140 lignes.
- Subtasks : T035, T036, T037, T038, T039, T040.

### WP09 — Autorité des terminaux et signataire des jetons (`tasks/WP09-autorite-signataire.md`)

- **Priority** : P1. **Dependencies** : WP08. **Estimated prompt** : ~120 lignes.
- Subtasks : T041, T042, T043, T044, T045.

### WP10 — Attestation Android (`tasks/WP10-attestation-android.md`)

- **Priority** : P1. **Dependencies** : WP08. **Estimated prompt** : ~150 lignes.
- Subtasks : T046, T047, T048, T049, T050, T051.

### WP11 — Attestation iOS (App Attest) (`tasks/WP11-attestation-ios.md`)

- **Priority** : P1. **Dependencies** : WP10. **Estimated prompt** : ~100 lignes.
- Subtasks : T052, T053, T054, T055.

### WP12 — Identité réelle du terminal (`tasks/WP12-identite-reelle.md`)

- **Goal** : trois preuves vérifiées derrière `DeviceIdentityPort`, sans changer les routes de la mission 4 (SC-007).
- **Priority** : P1 (OP-N42, bloque la production). **Dependencies** : WP04, WP07, WP08, WP09. **Estimated prompt** : ~170 lignes.
- Subtasks : T056, T057, T058, T059, T060, T061, T062.

### WP13 — OP-N54 et empreinte du code d'enrôlement (`tasks/WP13-op-n54-empreintes.md`)

- **Priority** : P2. **Dependencies** : WP08. **Estimated prompt** : ~80 lignes.
- Subtasks : T063, T064, T065.

## Phase 3 — Routes

### WP14 — Codes et enrôlement (`tasks/WP14-codes-enrolement.md`)

- **Priority** : P1. **Dependencies** : WP01, WP03, WP07, WP09, WP10, WP11, WP12, WP13. **Estimated prompt** : ~150 lignes.
- Subtasks : T066, T067, T068, T069, T070.

### WP15 — Rafraîchissement des jetons (`tasks/WP15-rafraichissement.md`)

- **Priority** : P1. **Dependencies** : WP04, WP09, WP12, WP14. **Estimated prompt** : ~110 lignes.
- Subtasks : T071, T072, T073, T074.

### WP16 — Back-office des terminaux (`tasks/WP16-back-office-terminaux.md`)

- **Priority** : P1. **Dependencies** : WP01, WP03, WP04, WP07, WP12. **Estimated prompt** : ~110 lignes.
- Subtasks : T075, T076, T077, T078.

### WP17 — Configuration et battement de cœur (`tasks/WP17-configuration-battement.md`)

- **Priority** : P2. **Dependencies** : WP12, WP14. **Estimated prompt** : ~100 lignes.
- Subtasks : T079, T080, T081, T082.

## Phase 4 — Preuves et consignation

### WP18 — Preuves de bout en bout, CI, consignation (`tasks/WP18-preuves-ci-consignation.md`)

- **Priority** : P1. **Dependencies** : WP01 à WP17. **Estimated prompt** : ~130 lignes.
- Subtasks : T083, T084, T085, T086, T087.

## Parallélisme

- Démarrables tout de suite : WP01, WP02, WP03, WP05, WP06, WP08.
- Après WP08 : WP09, WP10, WP13 en parallèle ; WP11 après WP10.
- WP07 attend les cinq lots de base ; WP12 attend WP04, WP07, WP08, WP09.
- WP14 à WP17 : routes, en parallèle dès leurs dépendances satisfaites (WP15 et WP17 après WP14).
- Tests en série par l'agent principal : la base locale est partagée.

## MVP

WP01 à WP04, WP07, WP08, WP09, WP12 : l'identité réelle du terminal levant OP-N42, OP-N59 et OP-N63 (les deux dettes
qui bloquent la production), prouvée sur les routes de la mission 4.
