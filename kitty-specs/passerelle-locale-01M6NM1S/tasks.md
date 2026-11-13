# Tasks: Passerelle locale de site

**Mission** : `passerelle-locale-01M6NM1S` · **Branche** : `feat/passerelle-locale` (planification et fusion)
**Sources** : `spec.md`, `plan.md`, `research.md`, `research-adversarial.md`, `data-model.md`, `contracts/interfaces.md` (**noms et signatures figés**),
`contracts/replication-page-additions.yaml`, `contracts/edge-routes.md`, `contracts/gateway-served-operations.md`, `contracts/contract-stability-check.md`.

Règles communes : priorité des sources (SPECIFICATION §0.3), contradiction signalée ; aucun `.sql` généré modifié ; aucun écart qui affaiblit la sécurité sans accord du
porteur (règle 1 de `CLAUDE.md`) ; aucun faux en production, prouvé par un démarrage réel ; lignes de 100 caractères ; contrat stable : seul WP01 touche `openapi.yaml` ; tests en série
par l'orchestrateur (base partagée) ; `GRANT` par WP09 seulement. Fichiers sans propriétaire unique : `contracts/interfaces.md` § 11.

## Subtask Index

| ID | Description | WP | Parallel |
|---|---|---|---|
| T001 | Appliquer `replication-page-additions.yaml` à `openapi.yaml` | WP01 | |
| T002 | Régénérer types TypeScript et Dart ; `npm run check -w @cashless/contracts` | WP01 | |
| T003 | `tools/contract-stability/check.mjs` et `contract-baseline.json` | WP01 | |
| T004 | Tests T1 à T14 et témoin positif | WP01 | |
| T005 | Créer `packages/shared-rules`, workspace, test d'architecture | WP02 | |
| T006 | Déplacer `ledger/money`, `chained-content`, `offline/rules`, part pure de `batch-chain` | WP02 | |
| T007 | `edgeContent`, `edgeContentSha256`, `edgeChainGenesis`, `chainStep`, `batchSigningPayload`, `nodeEnv`, `effectiveBalance` | WP02 | |
| T008 | Générateur de vecteurs indépendant et `vectors.json` (cas a à j) | WP02 | |
| T009 | Suite unitaire de l'API verte sans autre changement que les imports | WP02 | |
| T010 | 0058 : rôles, colonnes `edge_gateway`, déclencheur `REVOKED` | WP03 | |
| T011 | `identify_edge_gateway`, `touch_edge_gateway` | WP03 | |
| T012 | `register`, `revoke`, `rotate`, `swap`, `set_role`, `edge_register_snapshot_key` ; verrou par événement ; audit et alerte | WP03 | |
| T013 | `tests_edge_gateway.sql`, deux `register` simultanés | WP03 | |
| T014 | 0059 : colonnes du handover, `pg_notify` | WP04 | |
| T015 | `edge_grant_authority` (filigrane de référence, refus si caisse `CLOSING`), `get_debit_authority`, `get_current_edge_handover` | WP04 | |
| T016 | `edge_ack_handover` idempotent, `reference_applied_seq` | WP04 | |
| T017 | `begin_edge_release`, `edge_complete_release` (compte par cycle), `fail_edge_release` | WP04 | |
| T018 | `force_central_authority_approved` ; `begin_cash_close` refusé sous `EDGE` | WP04 | |
| T019 | `tests_edge_handover.sql` : cycles 1 et 2, A13, A05, A17, reprise forcée | WP04 | |
| T020 | 0060 : `edge_sync_batch`, résultats, un lot en vol, `VOID` au registre | WP05 | |
| T021 | `edge_record_seq` : refuse `REVOKED`, sans handover, `STANDBY` | WP05 | |
| T022 | Garde `EDGE_SYNC` de `post_transaction` sur `session_user` | WP05 | |
| T023 | `tests_edge_sync.sql` : idempotence, ordre, chaîne, garde | WP05 | |
| T024 | 0061 : `edge_platform_setting`, `set_edge_setting`, construction des lignes, liste blanche, comptes attendus | WP06 | |
| T025 | Verrou de compte, rognage, `S-ATTENTE`, anomalie, `CL007` traitée | WP06 | |
| T026 | Plafonds par vente et par terminal et par heure ; alerte | WP06 | |
| T027 | `REVERSAL` borné (A08), `DUPLICATE` | WP06 | |
| T028 | `tests_edge_post_transaction.sql`, y compris tentatives hors périmètre | WP06 | |
| T029 | 0062 : `edge_activate_media` (A24) | WP07 | |
| T030 | `edge_take_deposit`, compte de caisse lu en base, repli `EDGE_REPLAY_FAILED` | WP07 | |
| T031 | `edge_topup_cash` : deux parts, anomalie `CASH_TOPUP_OVER_LIMIT`, jamais rejetée pour un plafond | WP07 | |
| T032 | `tests_edge_counter_ops.sql`, garde ADR-132, session fermée | WP07 | |
| T033 | 0063 : `edge_pwd_pack_key`, `edge_pwd_pack`, dépôts | WP08 | |
| T034 | `edge_reference_change`, déclencheurs, numérotation sous verrou | WP08 | |
| T035 | `edge_replication_page` : horizon A18, `edge_seq_applied`, `device_seq_acked`, délai des colis | WP08 | |
| T036 | `edge_staff_token_audit`, `edge_record_staff_token_audit`, `mark_edge_gateways_silent` | WP08 | |
| T037 | `tests_edge_replication.sql`, cloisonnement, écriture hors d'ordre | WP08 | |
| T038 | `roles.sql`, `post-roles.sql` : retrait sur `edge_gateway`, droits nommés de chaque rôle | WP09 | |
| T039 | `tests_execute_grants.sql`, `tests_offline_rights.sql`, liste figée de `cashless_edge` | WP09 | |
| T040 | Test à connexion réelle sous `cashless_app` : `EDGE_SYNC` refusée | WP09 | |
| T041 | Non-régression des suites générées, sans modification | WP09 | |
| T042 | `main.edge.ts`, `edge.module`, `DenyUnmarkedRoutesGuard`, un pool, script | WP10 | |
| T043 | Écouteur TLS du processus `edge`, seconde autorité ; port `EDGE_CA`, faux refusé en production | WP10 | |
| T044 | Garde `EdgeMtlsGuard` : empreinte, `REVOKED`, `app.gateway_id` ; certificat de terminal refusé | WP10 | |
| T045 | `getCurrentEdgeHandover` : attente longue, `LISTEN/NOTIFY`, repli 2 s | WP10 | |
| T046 | Tests du processus, démarrage réel | WP10 | |
| T047 | `POST` et `GET debit-authority` humains ; audit ; rôles | WP11 | |
| T048 | Reprise forcée à deux, `FORCE_CENTRAL_AUTHORITY` | WP11 | |
| T049 | 409 de débit complétés selon le contrat ; `X-Authority-Epoch` sans changer un code | WP11 | |
| T050 | Refus de chaque chemin de débit, chemin par chemin ; crédits acceptés | WP11 | |
| T051 | `edge_base_url` et époque en configuration et au battement de cœur, vérifiés | WP11 | |
| T052 | `ackEdgeHandover` | WP12 | |
| T053 | `releaseEdgeHandover` : `RELEASING` commité avant vérification | WP12 | |
| T054 | `getEdgeReplicationFeed`, `after_change_seq`, formes du contrat | WP12 | |
| T055 | Travailleur de maintenance : silence, rendu bloqué, alertes | WP12 | |
| T056 | Tests de routes et de cloisonnement | WP12 | |
| T057 | `submitEdgeSyncBatch` : corps 1 Mio, signature, idempotence, un lot en vol | WP13 | |
| T058 | Recalcul de `content_sha256` et chaîne ; ordre | WP13 | |
| T059 | Écrivain : envoi vers l'enveloppe par type ; frais et commissions recalculés | WP13 | |
| T060 | Preuve du bracelet au rejeu, vérifiée par le processus des clés | WP13 | |
| T061 | Lots de terminal relayés : signature et chaîne d'origine | WP13 | |
| T062 | `staff_token_audit` ; lot abandonné ; tests | WP13 | |
| T063 | `ONLINE_REF` inconnue : `EDGE_REPLAY_FAILED`, sans bruit sur les opérations déjà rejouées | WP14 | |
| T064 | Journal après reprise forcée : `DUPLICATE`, `TOPUP_CASH`, anomalie avec montant | WP14 | |
| T065 | Tests de rejeu, aucune double écriture, aucune perte silencieuse | WP14 | |
| T066 | `tools/edge-admin` : inscrire, révoquer, tourner, échanger | WP15 | |
| T067 | Fichier d'enrôlement, certificat par `EDGE_CA`, sans secret en journal | WP15 | |
| T068 | Dépôt des colis par le processus des clés ; canari | WP15 | |
| T069 | Tests de l'outil, de l'alerte et du délai de 30 min | WP15 | |
| T070 | `apps/gateway` : paquet, configuration, `nodeEnv`, démarrage, test d'architecture | WP16 | |
| T071 | `edge-0001` : toutes les tables, un seul rôle | WP16 | |
| T072 | `GatewayTx`, port `HARDWARE_KEYSTORE`, faux | WP16 | |
| T073 | `GatewayClock` (A14) | WP16 | |
| T074 | Garde de démarrage, chaque refus prouvé en réel ; points d'arrêt | WP16 | |
| T075 | Client du central en mTLS, ses erreurs | WP17 | |
| T076 | Machine à états, table de transitions, persistance avant action | WP17 | |
| T077 | Canal de contrôle, accusé idempotent, reprise après arrêt | WP17 | |
| T078 | `observeEpoch` (A12), levée locale à deux personnes | WP17 | |
| T079 | Tests de la machine à états, dont les quatre cas de redémarrage | WP17 | |
| T080 | `ReplicationService` : application d'une page, curseurs dans la transaction | WP18 | |
| T081 | Entités de référence, `pwd_pack_key` | WP18 | |
| T082 | Solde effectif, purge des deltas (A26) | WP18 | |
| T083 | Tests : crédit, blocage en 5 s, reprise, double comptage | WP18 | |
| T084 | `DeviceProofsGuard` : trois preuves, `@authority`, nonces | WP19 | |
| T085 | Jetons de la passerelle : clé propre, `kid`, `refreshDeviceToken` sans rotation | WP19 | |
| T086 | `getDeviceConfig`, `postDeviceHeartbeat`, `getDeviceSeqStatus` | WP19 | |
| T087 | Idempotence locale, schémas du contrat | WP19 | |
| T088 | Tests, dont le refus au central des jetons de la passerelle | WP19 | |
| T089 | `EdgeQueue.append`, numéro et chaîne dans la transaction de l'opération | WP20 | |
| T090 | `DrainService` : un lot en vol, signature, renvoi à l'identique, lot abandonné | WP20 | |
| T091 | Résultats, accusés, audit de tolérance, rendu final | WP20 | |
| T092 | Tests : vecteurs, arrêts, `EDGE_NOT_CAUGHT_UP` | WP20 | |
| T093 | `createTap`, `edge_tap` locale | WP21 | |
| T094 | `createPayment`, `getPayment` : règles partagées, autorité, file | WP21 | |
| T095 | `reversePayment` | WP21 | |
| T096 | Refus des opérations indisponibles, codes figés | WP21 | |
| T097 | Scénarios de référence communs ; latence NFR-005 | WP21 | |
| T098 | `StaffTokenGuard` : sept conditions, ordre, audit | WP22 | |
| T099 | `createCashTopup` : session répliquée seulement | WP22 | |
| T100 | `activateMedia` sans frais sur solde | WP22 | |
| T101 | `takeDeposit` en espèces, `FROM_BALANCE` refusé | WP22 | |
| T102 | Tests de bornes de la tolérance (12 h + 1 s, `exp` avant bascule, autre personne) | WP22 | |
| T103 | `submitOfflineBatch`, `getOfflineBatchResult` : règles de la mission 7, autorité inversée | WP23 | |
| T104 | `TOPUP_CASH` d'un lot de terminal rejeté ; relais en file | WP23 | |
| T105 | Snapshots locaux signés par la clé propre, service et accusé | WP23 | |
| T106 | `getMediaAuthKey` : colis rescellé pour le terminal | WP23 | |
| T107 | Tests : lots, blocage répliqué, canari | WP23 | |
| T108 | Purge automatique et manuelle à deux, test canari | WP24 | |
| T109 | `STANDBY` : refus de tout débit, promotion par handover normal | WP24 | |
| T110 | `Dockerfile`, `docker-compose.site.yml`, images épinglées, contrôle ; ligne de pile | WP24 | |
| T111 | `docs/procedure-site-passerelle.md` | WP24 | |
| T112 | Relais TCP coupable, deux processus, deux bases | WP25 | |
| T113 | Parcours SC-001 de bout en bout, soldes égaux | WP25 | |
| T114 | NFR-001 (§13-4), NFR-002 (§13-5), NFR-005, NFR-006, NFR-007 | WP25 | |
| T115 | NFR-003, NFR-004 aux points d'arrêt, reprise forcée SC-005 | WP25 | |
| T116 | NFR-009 à NFR-013 : démarrages réels, canari, cloisonnement, stabilité | WP25 | |
| T117 | Étapes CI, contrôle de stabilité, `CODEOWNERS` ; consignation finale | WP25 | |
| T118 | Enrôlement de la passerelle : demande, chargement, suppression du fichier | WP16 | |
| T119 | Écouteur d'administration local, ordres signés, `LOCAL_UNSTALE` | WP17 | |

## Phase 1 : contrat et code partagé

## Work Package WP01 : Contrat, ajouts sous `/edge/*` et contrôle de stabilité (Priority: P1)
Prompt : `tasks/WP01-contrat-stabilite.md`. Goal : les seuls ajouts admis sont au contrat, et toute autre différence fait échouer le contrôle. Independent test : T1 à T14.
T001 Appliquer les ajouts (WP01)
T002 Régénérer les types (WP01)
T003 Outil et référence (WP01)
T004 Tests et témoin positif (WP01)
Dependencies : aucune. Risks : un ajout touche un schéma partagé : l'outil doit le refuser.

## Work Package WP02 : Paquet `@cashless/shared-rules` et vecteurs (Priority: P1)
Prompt : `tasks/WP02-shared-rules.md`. Goal : un seul code de règles pour les deux côtés. Independent test : suite unitaire de l'API inchangée, vecteurs.
T005 Paquet et garde (WP02)
T006 Déplacements (WP02)
T007 Fonctions nouvelles (WP02)
T008 Vecteurs (WP02)
T009 Non-régression (WP02)
Dependencies : aucune. Risks : régression de l'API par déplacement ; à faire tôt, avant que d'autres lots n'importent ces chemins.

## Phase 2 : base du central

## Work Package WP03 : Inscription et identité des passerelles (migration 0058) (Priority: P1)
Prompt : `tasks/WP03-base-edge-gateway.md`. Goal : passerelle inscrite, identifiée, révocable, sans contrainte qui casse le kit. Independent test : `tests_edge_gateway.sql`.
T010 Rôles, colonnes, table `edge_reference_change` (WP03)
T011 Identification (WP03)
T012 Administration (WP03)
T013 Tests (WP03)
Dependencies : aucune. Risks : A04, contraintes incompatibles avec les suites générées.

## Work Package WP04 : Bascule, rendu et reprise (migration 0059) (Priority: P1)
Prompt : `tasks/WP04-base-handover.md`. Goal : enveloppes liées à la passerelle, fonctions manquantes, compte par cycle. Independent test : `tests_edge_handover.sql`, deux cycles.
T014 Colonnes et notification (WP04)
T015 Accord et lectures (WP04)
T016 Accusé (WP04)
T017 Rendu (WP04)
T018 Reprise et caisse (WP04)
T019 Tests (WP04)
Dependencies : WP03. Risks : `force_central_authority` jamais modifiée ; `begin_cash_close` : relecture humaine.

## Work Package WP05 : Registre, lots et garde `EDGE_SYNC` (migration 0060) (Priority: P1)
Prompt : `tasks/WP05-base-registre-lots.md`. Goal : idempotence des lots, numéros contrôlés, `EDGE_SYNC` retirée à `cashless_app`. Independent test : `tests_edge_sync.sql`.
T020 Tables (WP05)
T021 `edge_record_seq` (WP05)
T022 Garde (WP05)
T023 Tests (WP05)
Dependencies : WP03. Risks : le test du kit appelle `post_transaction` en `EDGE_SYNC` sous le propriétaire : il doit rester vert.

## Work Package WP06 : Enveloppe `edge_post_transaction` et bornes (migration 0061) (Priority: P1)
Prompt : `tasks/WP06-base-post-transaction.md`. Goal : une passerelle compromise ne fait écrire que ce que les bornes permettent. Independent test : tentatives hors périmètre refusées.
T024 Lignes et comptes (WP06)
T025 Verrou et rognage (WP06)
T026 Plafonds (WP06)
T027 Annulation (WP06)
T028 Tests (WP06)
Dependencies : WP04, WP05. Risks : création d'argent (A08), concurrence (A06). Relecture humaine.

## Work Package WP07 : Opérations de guichet en `EDGE_SYNC` (migration 0062) (Priority: P1)
Prompt : `tasks/WP07-base-guichet.md`. Goal : activation, caution et recharge rejouées sans perdre une trace. Independent test : `tests_edge_counter_ops.sql`.
T029 Activation (WP07)
T030 Caution (WP07)
T031 Recharge (WP07)
T032 Tests (WP07)
Dependencies : WP06. Risks : garde de caisse ; plafond réglementaire dépassé temporairement (OP-N108).

## Work Package WP08 : Réplication côté base (migration 0063) (Priority: P1)
Prompt : `tasks/WP08-base-replication.md`. Goal : un flux sans trou, sans double comptage, cloisonné. Independent test : `tests_edge_replication.sql`.
T033 Colis (WP08)
T034 Journal des changements (WP08)
T035 Page de flux (WP08)
T036 Audit et silence (WP08)
T037 Tests (WP08)
Dependencies : WP03, WP04, WP05, WP06. Risks : déclencheurs sur des tables à fort trafic ; fuite entre événements.

## Work Package WP09 : Droits de la base et non-régression du kit (Priority: P1)
Prompt : `tasks/WP09-droits.md`. Goal : chaque rôle a exactement ses droits, et le kit passe sans modification. Independent test : listes figées, connexion réelle.
T038 Rôles et droits (WP09)
T039 Listes figées (WP09)
T040 Connexion réelle (WP09)
T041 Suites générées (WP09)
Dependencies : WP03, WP04, WP05, WP06, WP07, WP08. Risks : relecture humaine.

## Phase 3 : API du central

## Work Package WP10 : Processus `edge`, identité mTLS et canal de contrôle (Priority: P1)
Prompt : `tasks/WP10-processus-edge.md`. Goal : un processus à part, avec sa propre autorité de certificats. Independent test : un certificat de terminal est refusé sur `/edge/*`, et l'inverse.
T042 Processus (WP10)
T043 Écouteur et autorité (WP10)
T044 Garde (WP10)
T045 Attente longue (WP10)
T046 Tests (WP10)
Dependencies : WP09. Risks : deux autorités ; NFR-007.

## Work Package WP11 : Autorité de débit côté humains et refus de débit (Priority: P1)
Prompt : `tasks/WP11-debit-authority.md`. Goal : bascule, rendu et reprise demandés par les routes du contrat, et tout débit central refusé sous `EDGE`. Independent test : chemin par chemin.
T047 Routes (WP11)
T048 Reprise forcée (WP11)
T049 Codes (WP11)
T050 Chemins (WP11)
T051 Autorité vue par les terminaux (WP11)
Dependencies : WP09. Risks : aucun comportement ne change pour un client en `CENTRAL`.

## Work Package WP12 : Accusé, rendu et flux de réplication (Priority: P1)
Prompt : `tasks/WP12-routes-edge.md`. Goal : les routes de pilotage de la passerelle. Independent test : `RELEASING` conservé quand la vérification échoue.
T052 Accusé (WP12)
T053 Rendu (WP12)
T054 Flux (WP12)
T055 Maintenance (WP12)
T056 Tests (WP12)
Dependencies : WP10. Risks : codes non déclarés au contrat, voir `edge-routes.md`.

## Work Package WP13 : Réception `EDGE_SYNC` (Priority: P1)
Prompt : `tasks/WP13-reception-sync.md`. Goal : rejeu dans l'ordre, sans double écriture. Independent test : 100 rejeux, une écriture.
T057 Réception (WP13)
T058 Chaîne (WP13)
T059 Écrivain (WP13)
T060 Preuve du bracelet (WP13)
T061 Lots relayés (WP13)
T062 Audit et abandon (WP13)
Dependencies : WP02, WP10. Risks : corps de 1 Mio (OP-N95) ; clés au seul processus prévu.

## Work Package WP14 : Reprise forcée et journal des terminaux (Priority: P2)
Prompt : `tasks/WP14-journal-reprise.md`. Goal : une passerelle perdue ne laisse aucune perte silencieuse. Independent test : journal renvoyé, opérations déjà rejouées sans anomalie.
T063 Références inconnues (WP14)
T064 Journal (WP14)
T065 Tests (WP14)
Dependencies : WP11, WP13. Risks : code de la mission 7, à étendre sans changer son contrat.

## Work Package WP15 : Outil d'inscription et colis (Priority: P2)
Prompt : `tasks/WP15-edge-admin.md`. Goal : inscrire une passerelle hors API publique, avec alerte et délai. Independent test : aucun colis avant 30 min, ni à une `STANDBY`.
T066 Outil (WP15)
T067 Enrôlement (WP15)
T068 Colis (WP15)
T069 Tests (WP15)
Dependencies : WP09, WP10. Risks : écart accepté OP-N105 ; un secret dans un journal.

## Phase 4 : passerelle

## Work Package WP16 : Socle de la passerelle (Priority: P1)
Prompt : `tasks/WP16-socle-passerelle.md`. Goal : application, base, clés, horloge, garde de démarrage. Independent test : chaque faux refusé par un démarrage réel.
T070 Paquet (WP16)
T071 Migrations (WP16)
T072 Transaction et clés (WP16)
T073 Horloge (WP16)
T074 Garde et points d'arrêt (WP16)
T118 Enrôlement (WP16)
Dependencies : WP01, WP02. Risks : le défaut de démarrage de la mission 4 : prouver avec le vrai `NestFactory`.

## Work Package WP17 : Autorité sur la passerelle (Priority: P1)
Prompt : `tasks/WP17-autorite-passerelle.md`. Goal : une seule autorité, même après un redémarrage. Independent test : quatre cas de redémarrage, époque forgée.
T075 Client (WP17)
T076 Machine à états (WP17)
T077 Canal et accusé (WP17)
T078 Époques (WP17)
T079 Tests (WP17)
T119 Administration locale (WP17)
Dependencies : WP16. Risks : écart OP-N110.

## Work Package WP18 : Réplication sur la passerelle (Priority: P1)
Prompt : `tasks/WP18-replication-passerelle.md`. Goal : un solde effectif juste. Independent test : aucun double comptage, blocage appliqué en 5 s.
T080 Application (WP18)
T081 Références (WP18)
T082 Soldes (WP18)
T083 Tests (WP18)
Dependencies : WP17. Risks : A26.

## Work Package WP19 : Preuves du terminal et jetons (Priority: P1)
Prompt : `tasks/WP19-preuves-jetons.md`. Goal : authentifier sans le central. Independent test : jeton de la passerelle refusé au central.
T084 Preuves (WP19)
T085 Jetons (WP19)
T086 Lectures du terminal (WP19)
T087 Idempotence (WP19)
T088 Tests (WP19)
Dependencies : WP18. Risks : écarts OP-N101 et OP-N102. Relecture humaine.

## Work Package WP20 : File et vidage (Priority: P1)
Prompt : `tasks/WP20-file-vidage.md`. Goal : aucun numéro perdu, aucune réponse sans écriture. Independent test : arrêts aux points prévus.
T089 File (WP20)
T090 Vidage (WP20)
T091 Résultats et rendu (WP20)
T092 Tests (WP20)
Dependencies : WP17. Risks : A05, A29.

## Work Package WP21 : Ventes sur la passerelle (Priority: P1)
Prompt : `tasks/WP21-ventes.md`. Goal : mêmes formats et mêmes erreurs qu'au central. Independent test : scénarios de référence, schémas du contrat.
T093 Passages (WP21)
T094 Paiement (WP21)
T095 Annulation (WP21)
T096 Refus (WP21)
T097 Conformité et latence (WP21)
Dependencies : WP18, WP19, WP20. Risks : divergence de règles.

## Work Package WP22 : Guichet sur la passerelle (Priority: P1)
Prompt : `tasks/WP22-guichet.md`. Goal : recharges, activations et cautions, sous session répliquée. Independent test : bornes de la tolérance.
T098 Tolérance (WP22)
T099 Recharge (WP22)
T100 Activation (WP22)
T101 Caution (WP22)
T102 Tests (WP22)
Dependencies : WP18, WP19, WP20. Risks : écart OP-N103. Relecture humaine.

## Work Package WP23 : Lots hors ligne, snapshots et clés de bracelet (Priority: P2)
Prompt : `tasks/WP23-lots-snapshots.md`. Goal : terminaux isolés et passerelle cohabitent. Independent test : lot relayé puis rejeu direct, un seul effet.
T103 Lots (WP23)
T104 Relais (WP23)
T105 Snapshots (WP23)
T106 Clés (WP23)
T107 Tests (WP23)
Dependencies : WP18, WP19, WP20. Risks : mots de passe en clair ; code de la mission 7 lié à la base centrale.

## Work Package WP24 : Purge, secours, image et procédure (Priority: P2)
Prompt : `tasks/WP24-purge-image.md`. Goal : ne rien laisser sur le site, et déployer simplement. Independent test : canari après purge, `STANDBY` sans débit.
T108 Purge (WP24)
T109 Secours (WP24)
T110 Image (WP24)
T111 Procédure (WP24)
Dependencies : WP21, WP22, WP23. Risks : écart OP-N106 ; images à contrôler (DIRECTIVE_051).

## Phase 5 : preuves

## Work Package WP25 : Preuves de bout en bout, CI et consignation (Priority: P1)
Prompt : `tasks/WP25-preuves.md`. Goal : prouver l'exclusion et l'absence de perte, et fermer la mission. Independent test : la batterie complète, en CI.
T112 Banc (WP25)
T113 Parcours (WP25)
T114 Charge (WP25)
T115 Pannes (WP25)
T116 Sécurité (WP25)
T117 CI et consignation (WP25)
Dependencies : WP11, WP12, WP13, WP14, WP15, WP24. Risks : durée et mémoire de la CI.
