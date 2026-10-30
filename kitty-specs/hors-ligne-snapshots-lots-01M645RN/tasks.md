# Tasks: Hors ligne : snapshots et lots

**Mission** : `hors-ligne-snapshots-lots-01M645RN` · **Branche** : `feat/hors-ligne-snapshots-lots` (planification et
fusion)
**Sources** : `spec.md`, `plan.md`, `research.md` (**R-30 fait foi**), `research-adversarial.md`, `data-model.md`,
`contracts/interfaces.md` (**noms et signatures figés**), `contracts/snapshots.md`, `contracts/batches.md`,
`contracts/compliance.md`, `contracts/database-rights.md`, `contracts/openapi-additions.md`.

Règles communes à tous les lots : priorité des sources (SPECIFICATION §0.3) et contradiction signalée ; aucun `.sql`
généré modifié ; aucun écart qui affaiblit la sécurité sans accord du porteur (règle 1 de `CLAUDE.md`) ; aucun faux
en production ; lignes de 100 caractères ; tests en série par l'orchestrateur (base partagée) ; un lot de base pose
ses fonctions avec `REVOKE ALL … FROM PUBLIC` et ses tests s'exécutent sous le propriétaire, les `GRANT` arrivent par
WP08. Fichiers sans propriétaire unique, retouchés hors carte avec une ligne dans le rapport : `apps/api/src/audit/
audit.service.ts` (valeurs d'`AuditAction`), `apps/api/src/config/config.ts` (clés listées en interfaces § 8),
`apps/api/package.json` (scripts `start:*`), `apps/api/jest.config.cjs` (liste `SKIP_LATENCY`),
`apps/api/src/app.module.ts` (import des modules `offline/*`). Aucune recharge
espèces hors ligne (décision du porteur du 30/10/2026).

## Subtask Index

| ID | Description | WP | Parallel |
|---|---|---|---|
| T001 | Opérations ajoutées : plafond, politiques à trois portées, risque ; schémas `OfflinePolicyLevel*`, `OfflineRisk` | WP01 | |
| T002 | Corrections : signatures DER, `WrappedKey` A256GCM + `iv`, `pwd_pack_sha256`, `removed_token_hashes`, chaîne de versions, `X-Snapshot-Latest`, `304`, codes et statuts des lots, `maximum` des numéros, `TOPUP_CASH` | WP01 | |
| T003 | Codes et raisons : `OfflineRejectReason` (`ONLINE_NOT_EXECUTED`…), détails `SNAPSHOTS_UNAVAILABLE` ; messages fr/en ; `sqlstate-map.ts` CL045 à CL054 | WP01 | |
| T004 | Régénérer les types TS et Dart ; `npm run check -w @cashless/contracts` | WP01 | |
| T005 | 0043 : CHECK `cash_topup_offline`, déclencheur de portée, `log_offline_policy` DEFINER | WP02 | |
| T006 | `set_offline_policy`, `clear_offline_policy`, `offline_policy_level` | WP02 | |
| T007 | `offline_max_exposure` (risque maximal) | WP02 | |
| T008 | Suite `tests_offline_policy.sql` (héritage, plafond, `capped`, historique sous `cashless_app`, OP-N58) | WP02 | |
| T009 | 0044 : tables `offline_snapshot_draft`, `_entry`, `_state`, `_media_log` (RLS), colonne `content_key_wrapped` | WP03 | |
| T010 | `offline_snapshot_targets`, `offline_snapshot_source`, `offline_snapshot_source_delta` (recouvrement 5 s) | WP03 | |
| T011 | `save_offline_snapshot_draft`, `append_…_entries`, `seal_…_draft`, `discard_…_draft` | WP03 | |
| T012 | `publish_offline_snapshot` (empreinte recalculée, version max + 1, OP-N57), `offline_snapshot_drafts_ready`, `offline_snapshot_draft_content`, `purge_offline_snapshot_content` | WP03 | |
| T013 | Suite `tests_offline_snapshots.sql` (concurrence de version, version plantée, DELTA, purge) | WP03 | |
| T014 | 0045 : table `offline_snapshot_key` (empreinte de clé d'accord), borne de deux clés de signature | WP04 | |
| T015 | `offline_snapshot_keys_to_wrap`, `wrap_offline_snapshot_key` | WP04 | |
| T016 | `offline_snapshot_for_device` (éligibilité, choix FULL/pas suivant, CL050/CL051), `snapshot_public_keys` | WP04 | |
| T017 | `rotate_snapshot_signing_key` | WP04 | |
| T018 | Suite `tests_offline_snapshot_keys.sql` (terminal suspendu ou révoqué, clé changée, troisième clé) | WP04 | |
| T019 | 0046 : `open_offline_batch` complétée, `offline_batch` (`IMPORT`, `size_bytes`, `import_id`), `offline_batch_state` | WP05 | |
| T020 | `offline_batch_retry`, `record_offline_retry`, `complete_offline_batch` remplacée (ADR-139) | WP05 | |
| T021 | `offline_op_result`, `record_offline_op_result`, `offline_op_results`, `offline_batch_retries_open`, `check_seq_gap_waivable` | WP05 | |
| T022 | Import : `device_journal_import`, `create_…`, `begin_…`, `open_imported_batch`, `finish_…`, `device_journal_import_view` | WP05 | |
| T023 | Suite `tests_offline_batches.sql` (clôture sans trace refusée, import rejoué, débordement) | WP05 | |
| T024 | 0047 : colonnes d'anomalie, `open_offline_anomaly`, `reduce_offline_shortfall` | WP06 | [P] |
| T025 | `mark_seq_gap_alerted`, `offline_seq_gaps_to_alert`, `offline_retries_to_alert` | WP06 | |
| T026 | `wallet_status_history` (déclencheur, ligne de départ), `offline_block_time` | WP06 | |
| T027 | Suite `tests_offline_anomalies.sql` | WP06 | |
| T028 | 0048 : `offline_snapshot_ack`, `ack_offline_snapshot`, `offline_snapshot_ack_floor`, `offline_snapshot_meta` | WP07 | [P] |
| T029 | `offline_media_state_at`, `offline_config_in_force`, `device_status_at`, `device_revoked_at` | WP07 | |
| T030 | `assert_vendor_session_at`, `record_sale_attribution_at`, `set_device_station_name` | WP07 | |
| T031 | `offline_device_exposure` (R-30.3) | WP07 | |
| T032 | Suite `tests_offline_device_vendor.sql` | WP07 | |
| T033 | `post-roles.sql` : rôles `cashless_snapcontent`, `cashless_snapsign`, `cashless_maint` ; accords de la mission | WP08 | |
| T034 | Retraits : OP-N57, OP-N58, OP-N69 (`UPDATE ON device`), OP-N75, `anomaly`, `snapshot_signing_key`, tables nouvelles | WP08 | |
| T035 | OP-N68 : défaut global ; `tests/_grants_for_tests.sql` ; 41 suites adaptées | WP08 | |
| T036 | `tests_execute_grants.sql` (listes figées, §4 inversé), `tests_device_rights.sql`, `tests_definer_trigger_writers.sql`, `tests_device_purge_window.sql` | WP08 | |
| T037 | `tests_offline_rights.sql` (test générique des tables 0043+, borne de chaque dette) | WP08 | |
| T038 | `SignPort`, capacité `sign`, `ECC_NIST_P256` ; `KmsModule.forCapabilities` | WP09 | [P] |
| T039 | Faux déterministe (graine + référence), signature DER, clé publique SPKI | WP09 | |
| T040 | Garde de production (`createKms`, `assertProcessIsSafe`) et tests | WP09 | |
| T041 | `key-admin` : création de la clé ECC et `rotate_snapshot_signing_key` | WP09 | |
| T042 | Processus `maintenance` : entrée, module, pool `DATABASE_URL_MAINT`, `--once`/`--list` | WP10 | [P] |
| T043 | `DevicePurgeWorker` déplacé hors de l'API publique ; `architecture.spec.ts` | WP10 | |
| T044 | Configuration et tests (`config.spec.ts`, refus en production sans URL) | WP10 | |
| T045 | Processus `snapshot-content` : entrée, module, pool `DATABASE_URL_SNAPCONTENT`, ports `Decrypt`+`DataKey` | WP11 | |
| T046 | Détection et cadence : curseurs, bloquant ≤ 5 s, 60 s, maintien à `valid_until/3`, FULL horaire ou > 20 % | WP11 | |
| T047 | Construction : différences avec l'état, en-tête, `content_sha256` (JCS), brouillon par paquets | WP11 | |
| T048 | Purge du contenu, alarmes, délais hors transaction | WP11 | |
| T049 | AAD de snapshot dans `@cashless/tag-format` et vecteurs fixes | WP12 | [P] |
| T050 | Chiffrement des mots de passe sous `K_v`, `pwd_pack_sha256`, effacement mémoire | WP12 | |
| T051 | Enveloppes par terminal (`offline_snapshot_keys_to_wrap`, `wrap_…`), terminal devenu éligible | WP12 | |
| T052 | Tests : balayage avec canari (aucun mot de passe en clair), enveloppe ouvrable par `TestTerminal` | WP12 | |
| T053 | Processus `snapshot-signer` : entrée, module, pool `DATABASE_URL_SNAPSIGN`, `SignPort` seul | WP13 | |
| T054 | Vérification du brouillon (empreinte recalculée), signature, publication, rejet d'un brouillon faux | WP13 | |
| T055 | Travailleur `seq-gap-age` : trous et `RETRY` de plus de 24 h, alarme 2 | WP13 | |
| T056 | Tests : clé absente (alarme 3), brouillon altéré, alerte unique | WP13 | |
| T057 | Module `offline/policy/` : routes du plafond et des trois portées (rôles, `404` neutre, `409` version, `422` espèces) | WP14 | |
| T058 | `getEventOfflineRisk` et risque dans la réponse des `PUT` | WP14 | |
| T059 | Audit `OFFLINE_POLICY_SET`/`CLEARED` ; tests d'intégration et d'isolation | WP14 | |
| T060 | `getOfflineSnapshot` (chaîne, `ETag`, `304`, `X-Snapshot-Latest`, gzip, `403`/`409`) | WP15 | |
| T061 | `ackOfflineSnapshot` | WP15 | |
| T062 | Configuration servie : `snapshot_keys`, `offline_enabled` faux sans clé ; battement : `latest_snapshot_version`, `sync_requested` | WP15 | |
| T063 | Tests (terminal suspendu, révoqué, clé d'accord changée, rattrapage > 5 pas) | WP15 | |
| T064 | `chainedContent`, vecteurs de lot (Python, hors code testé), vecteurs 5b inchangés | WP16 | [P] |
| T065 | `deviceKey`, `MAX_DEVICE_SEQ = 2^53−1`, `Number(seq)` retirés (registre, recharge, annulation, configuration) | WP16 | |
| T066 | `DeviceSeqRegistry.record` et `lookup` | WP16 | |
| T067 | `AnomalyWriter` ; chemin `CLOCK_SKEW` en ligne passé par `open_offline_anomaly` | WP16 | |
| T068 | `resolveOfflineTime`, `detectInversions` | WP17 | [P] |
| T069 | `conflictOutcome` (table §7.3) | WP17 | |
| T070 | `checkCompliance`, `checkPeriod`, `lossBearer` | WP17 | |
| T071 | Tests unitaires par table (dont −100 s, +2 h, −2 h, `blockTime` inconnu) | WP17 | |
| T072 | Contrôleur `POST /offline-batches`, corps brut ≤ 1 Mio, `raw-json.ts` | WP18 | |
| T073 | Contrôles d'entrée 3 à 9 (série, grand livre, époque, signature DER, continuité, empreintes et chaîne, autorité) | WP18 | |
| T074 | Pool des verrous de lot, `open_offline_batch`, boucle sur le processeur (interface WP19), reprise, `ABANDONED`, `complete_offline_batch` | WP18 | |
| T075 | `GET /offline-batches/{batch_id}` (`200`, `202` + `Retry-After`, `404`), audit des lots reçus et refusés | WP18 | |
| T076 | `TestTerminal` : `signBatch`, `chainHash`, constructeur de journal ; tests d'intégration de réception | WP18 | |
| T077 | Processeur : registre, doublons, `VOID`, `ONLINE_REF`, `TOPUP_CASH` rejeté, `CONFIRMED` (R-30.1) | WP19 | |
| T078 | Lecture des entrées de conformité et période ; anomalies `NON_COMPLIANT_OPERATION`, `PERIOD_CLOSED_OPERATION`, `LATE_OFFLINE_SYNC`, `CLOCK_SKEW` | WP19 | |
| T079 | `registerOffline`, table de conflit, moteur (`coveredCap`, `shortfall`), `OFFLINE_SHORTFALL`, `consume_tap` | WP19 | |
| T080 | Annulation hors ligne (`reverses_seq`/`reverses_transaction_id`, `reduce_offline_shortfall`) ; session de vendeur datée | WP19 | |
| T081 | `CL007` : `SAVEPOINT`, trois reprises, `record_offline_retry` ; résultat écrit (`record_offline_op_result`) | WP19 | |
| T082 | Tests d'intégration du processeur ; transaction 22 identique au scénario | WP19 | |
| T083 | `WAIVE_SEQ_GAP` : route, pré-contrôle, action d'approbation, exécution | WP20 | |
| T084 | Import : route (vérification immédiate, synthèse, empreinte), action `DEVICE_JOURNAL_IMPORT` | WP20 | |
| T085 | Travailleur `journal-import` (reprise, revérification, `APPLIED`/`FAILED`) | WP20 | |
| T086 | Tests (même personne refusée, trou absent, import rejoué, opération après révocation) | WP20 | |
| T087 | Parcours complet et tests minimaux §13 (1, 2, 3, 6, 7) | WP21 | |
| T088 | Isolation, balayage des secrets avec canari, garde de production (processus et `403`) | WP21 | |
| T089 | Concurrence (100 rejeux, 50 lots, pool plein) et mesures (lot 500, FULL 50 000, DELTA, 5 s) ; jeu SQL de 50 000 bracelets | WP21 | |
| T090 | CI (`SKIP_LATENCY`, suites seules), quickstart vérifié | WP21 | |
| T091 | Consignation : OP-N57/58/68/69/75 levés avec leurs tests, OP-N89/OP-N90 tenus, matrice d'acceptation | WP21 | |

## Phase 1 — Contrat et base de données

### WP01 — Contrat d'API, types et codes (`WP01-contrat-api-types.md`)

- **Goal** : contrat à jour avant le code ; types régénérés. **Priority** : P1. **Independent test** : `npm run check
  -w @cashless/contracts` vert ; diff des types attendu.
- **Subtasks** :
T001 Opérations ajoutées (WP01)
T002 Corrections des opérations et schémas existants (WP01)
T003 Codes, raisons, messages, SQLSTATE (WP01)
T004 Types TS et Dart régénérés (WP01)
- **Dependencies** : aucune. **Risks** : cohérence TS/Dart ; codes d'erreur sans message.

### WP02 — Base : politique hors ligne (`WP02-base-politique.md`)

- **Goal** : écriture contrôlée des politiques, historique par la base (OP-N58), espèces hors ligne interdites, risque.
- **Subtasks** :
T005 Contrainte, portée, historique DEFINER (WP02)
T006 Fonctions d'écriture et de lecture (WP02)
T007 Risque maximal (WP02)
T008 Suite pgTAP (WP02)
- **Dependencies** : aucune. **Risks** : lignes existantes avec espèces vraies ; RLS du DEFINER.

### WP03 — Base : snapshots, brouillon et publication (`WP03-base-snapshots-publication.md`)

- **Goal** : version calculée par la base (OP-N57), contenu et journal par version, brouillon non signé publié par le
  signataire.
- **Subtasks** :
T009 Tables (WP03)
T010 Sources complète et incrémentale (WP03)
T011 Brouillon (WP03)
T012 Publication, lectures du signataire, purge (WP03)
T013 Suite pgTAP (WP03)
- **Dependencies** : aucune. **Risks** : verrou avant le maximum ; volume ; la base ne recalcule pas JCS (le `jsonb`
  de PostgreSQL n'est pas canonique RFC 8785) : elle vérifie l'en-tête contre le brouillon, le signataire (WP13)
  recalcule l'empreinte.

### WP04 — Base : enveloppes, lecture du terminal, clés de signature (`WP04-base-enveloppes-cles.md`)

- **Subtasks** :
T014 Table des enveloppes, borne de deux clés (WP04)
T015 Enveloppes à faire et inscription (WP04)
T016 Lecture pour le terminal (WP04)
T017 Rotation des clés (WP04)
T018 Suite pgTAP (WP04)
- **Dependencies** : WP03. **Risks** : terminal suspendu ou révoqué ; clé d'accord changée.

### WP05 — Base : lots, registre, trace `RETRY`, import (`WP05-base-lots-import.md`)

- **Subtasks** :
T019 `open_offline_batch` complétée, colonnes, état (WP05)
T020 Trace `RETRY` et clôture (WP05)
T021 Résultats d'opération, pré-contrôle de levée (WP05)
T022 Import de journal (WP05)
T023 Suite pgTAP (WP05)
- **Dependencies** : aucune. **Risks** : `complete_offline_batch` (relecture humaine) ; import une seule fois.

### WP06 — Base : anomalies et historique du portefeuille (`WP06-base-anomalies.md`)

- **Subtasks** :
T024 Colonnes, ouverture, réduction (WP06)
T025 Alertes (WP06)
T026 Historique du portefeuille, heure de blocage (WP06)
T027 Suite pgTAP (WP06)
- **Dependencies** : WP05 (`offline_batch_retry`, lu par `offline_retries_to_alert`). **Risks** : déclencheur
  sur une table chaude ; idempotence sur rejeu.

### WP07 — Base : terminal, vendeur et configuration datés (`WP07-base-terminal-vendeur.md`)

- **Subtasks** :
T028 Accusés et méta de snapshot (WP07)
T029 États datés (WP07)
T030 Vendeur daté, nom de station (WP07)
T031 Exposition (WP07)
T032 Suite pgTAP (WP07)
- **Dependencies** : WP03 (tables de snapshot), WP05 (`offline_batch` complété). **Risks** : ordre des verrous.

### WP08 — Droits de la base et dettes héritées (`WP08-droits-base.md`)

- **Subtasks** :
T033 Rôles nouveaux et accords (WP08)
T034 Retraits (WP08)
T035 Défaut global et suites pgTAP (WP08)
T036 Tests de droits existants (WP08)
T037 Test générique et bornes (WP08)
- **Dependencies** : WP02 à WP07. **Risks** : 41 suites ; relecture humaine de `post-roles.sql`.

## Phase 2 — Ports et processus

### WP09 — Port de signature et faux (`WP09-port-signature.md`)

T038 Port et capacité (WP09)
T039 Faux (WP09)
T040 Garde de production (WP09)
T041 Création et rotation par `key-admin` (WP09)
- **Dependencies** : WP04 (rotation). **Risks** : même clé vue par deux processus.

### WP10 — Processus de maintenance (`WP10-processus-maintenance.md`)

T042 Processus (WP10)
T043 Déplacement du travailleur (WP10)
T044 Configuration et tests (WP10)
- **Dependencies** : WP08 (rôle). **Risks** : API publique sans purge.

### WP11 — Processus `snapshot-content` : cadence et brouillon (`WP11-snapshot-content-cadence.md`)

T045 Processus (WP11)
T046 Détection et cadence (WP11)
T047 Construction et brouillon (WP11)
T048 Purge, alarmes, délais (WP11)
- **Dependencies** : WP03, WP06, WP08, WP09. **Risks** : 5 s et 30 s ; transactions courtes.

### WP12 — Processus `snapshot-content` : chiffrement et enveloppes (`WP12-snapshot-content-chiffrement.md`)

T049 AAD et vecteurs (WP12)
T050 Chiffrement (WP12)
T051 Enveloppes (WP12)
T052 Tests de secret (WP12)
- **Dependencies** : WP04, WP11. **Risks** : relecture humaine (cryptographie).

### WP13 — Processus `snapshot-signer` et alertes (`WP13-snapshot-signer.md`)

T053 Processus (WP13)
T054 Vérification, signature, publication (WP13)
T055 Alertes (WP13)
T056 Tests (WP13)
- **Dependencies** : WP03, WP06, WP08, WP09. **Risks** : ne jamais signer un brouillon non vérifié.

## Phase 3 — API

### WP14 — Politique hors ligne (API) (`WP14-api-politique.md`)

T057 Routes (WP14)
T058 Risque (WP14)
T059 Audit et tests (WP14)
- **Dependencies** : WP01, WP02, WP08.

### WP15 — Service des snapshots et configuration servie (`WP15-api-snapshots.md`)

T060 Lecture (WP15)
T061 Accusé (WP15)
T062 Configuration et battement (WP15)
T063 Tests (WP15)
- **Dependencies** : WP01, WP04, WP07, WP08.

### WP16 — Registre, empreintes, numéros, anomalies (`WP16-registre-empreintes.md`)

T064 Empreinte et vecteurs (WP16)
T065 Clé et numéros (WP16)
T066 Registre (WP16)
T067 Écrivain d'anomalies (WP16)
- **Dependencies** : WP06, WP08. **Risks** : vecteurs 5b identiques.

### WP17 — Règles pures (`WP17-regles-pures.md`)

T068 Temps (WP17)
T069 Table de conflit (WP17)
T070 Conformité, période, porteur (WP17)
T071 Tests unitaires (WP17)
- **Dependencies** : WP01 (types). Parallélisable avec tout le reste.

### WP18 — Réception des lots (`WP18-reception-lots.md`)

T072 Contrôleur et lecture brute (WP18)
T073 Contrôles d'entrée (WP18)
T074 Ouverture, boucle, reprise, clôture (WP18)
T075 Lecture du résultat, audit (WP18)
T076 Terminal de test et tests (WP18)
- **Dependencies** : WP01, WP05, WP08, WP16. **Risks** : reprise sans double traitement ; pool.

### WP19 — Traitement des opérations (`WP19-traitement-operations.md`)

T077 Registre, doublons, opérations sans effet, espèces rejetées (WP19)
T078 Conformité, période, anomalies (WP19)
T079 Passage, conflit, écriture (WP19)
T080 Annulation, vendeur (WP19)
T081 `CL007` et résultats (WP19)
T082 Tests (WP19)
- **Dependencies** : WP06, WP07, WP16, WP17, WP18. **Risks** : transaction 22 ; ordre des verrous.

### WP20 — Trous et import du journal (`WP20-trous-import.md`)

T083 Levée de trou (WP20)
T084 Demande d'import (WP20)
T085 Travailleur d'import (WP20)
T086 Tests (WP20)
- **Dependencies** : WP05, WP19.

## Phase 4 — Preuves

### WP21 — Preuves de bout en bout, CI et consignation (`WP21-preuves-ci-consignation.md`)

T087 Parcours et §13 (WP21)
T088 Isolation, secrets, garde (WP21)
T089 Concurrence et mesures (WP21)
T090 CI et quickstart (WP21)
T091 Consignation (WP21)
- **Dependencies** : tous les autres.

## Parallélisme

Phase 1 : WP01, WP02, WP03, WP05 en parallèle ; WP04 après WP03 ; WP06 après WP05 ; WP07 après WP03 et WP05 ; WP08 en fin de
phase. WP09 et WP17 démarrent dès WP04 et WP01. Phase 2 et 3 : WP11/WP13 en parallèle, WP14/WP15/WP16 en parallèle.
MVP : WP01 à WP08 (la base et les dettes de droits levées sont livrables seules).
