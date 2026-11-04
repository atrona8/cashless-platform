# Suivi des lots — mission 7 (orchestrateur)

Notes à transmettre aux lots suivants (à reprendre dans les prompts d'arbitrage).

## Pour WP08 (droits)
- `tests_definer_trigger_writers.sql` : test 22 (attend `log_offline_policy` INVOKER) et test 16 (liste exacte des
  fonctions de déclencheur DEFINER : ajouter `offline_policy:log_offline_policy` et
  `offline_policy:offline_policy_scope_guard`) à mettre à jour (WP02, `9a4bd1fc`).
- Relecture humaine : ajouter `offline_policy_scope_guard` (contrôle de portée en DEFINER, 0043).

- Accorder à `cashless_snapcontent` : `offline_snapshot_state_hashes`, `offline_snapshot_entry_sha256` (WP03).
- Ne JAMAIS accorder les fonctions internes de 0044 : `offline_snapshot_add_entries`,
  `offline_snapshot_draft_locked`, `offline_snapshot_source_rows`, `offline_snapshot_item_ok` (DEFINER sans garde
  propre). `tests_execute_grants.sql` doit le prouver.
- Tables nouvelles : retirer INSERT, UPDATE, DELETE, TRUNCATE à `cashless_app` (déjà au prompt) ; jusque-là
  `offline_snapshot_entry.pwd_pack_enc` lui est lisible et écrivable (constat M3 de la relecture de WP03).
- Retirer à `cashless_app` l'EXECUTE de `open_offline_batch_core` (INVOKER, `p_allow_revoked`), comme
  `advance_device_chain` ; ne jamais accorder `offline_snapshot_header_ok` (interne, WP03 cycle 2).
- Listes déjà retouchées par WP05 : `tests_media_roles.sql` (signature à 10 paramètres),
  `tests_definer_trigger_writers.sql` (`device_seq_registry:close_offline_batch_retry`) : fusion à surveiller avec
  les retouches de WP02 sur la même liste.
- Relecture humaine (WP05) : `complete_offline_batch`, `record_offline_retry` + `close_offline_batch_retry`,
  `open_imported_batch` + `open_offline_batch_core`, `begin_device_journal_import`,
  `device_journal_imports_processing`.
- Relecture humaine (WP03) : `0044` (`publish_`, `save_`, `source_rows`, `draft_content`, `drafts_ready`).

## Pour WP11 (contenu)
- Au démarrage : jeter (`discard_offline_snapshot_draft`) un brouillon `OPEN|READY` laissé par un passage planté,
  sinon le grand livre est bloqué (un seul brouillon ouvert par grand livre, CL048).
- `save_` pose lui-même `format`, `operator_id`, `ledger_id`, `event_id`, `currency`, `version`, `base_version`,
  `authority_epoch`, `key_id` ; le producteur fournit `kind`, `generated_at`, `valid_until` (ISO avec fuseau),
  `entries`, `removed`, `content_sha256`. Entrée : onze clés exactes ; `pwd_pack_sha256` = SHA-256 de `pwd_pack_enc`
  (34 octets) ou null. Retiré : `entry` nul. `last_counter` seul ne déclenche pas de `DELTA`.

## Pour WP15 (snapshots API)
- `OfflinePolicy.cash_topup_offline` reste `boolean` au contrat (littéral `false` casserait
  `device-config.service.ts:238`) : WP15 sert toujours `false`.
- `snapshot_keys[].not_after` requis et nullable (null = clé `ACTIVE`). `DEVICE_SUSPENDED` : `403` (R-30.9).
- `WrappedKey` : `iv` = nonce, `wrapped_key` = chiffré ‖ tag (lecture de `sealForRecipient`, à confirmer par WP12).

## Pour WP20
- Servir aussi `getDeviceJournalImport` (ajout du 30/10, `interfaces.md` § 10).
- `DeviceJournalImportResult.status` requis (`PROCESSING|APPLIED|FAILED`), `results` vide tant que `PROCESSING`.

## Pour WP20 (suite, WP05)
- `batches` : 1 à 20 objets `{batch_id (uuid texte), seq_from (1..2^53−1)}`, sans doublon. Pas de
  `approval_request_id`. Approbateur ≠ demandeur (contrainte). `begin_` abandonne d'abord les lots PROCESSING de plus
  de 15 min du terminal. Aucune transition PENDING→REJECTED en base ; `finish(APPLIED)` ne vérifie pas que les lots
  sont COMPLETED : le travailleur doit le vérifier avant d'appeler `finish`.

## Pour WP20 et WP08 (issu de la relecture de WP05, 30/10 après-midi)
- WP20 : `p_actor`/`p_approver` ne sont PAS contrôlés en base comme membres du prestataire (approbateur d'un autre
  prestataire accepté, reproduit) : l'API DOIT le vérifier (même prestataire, rôle d'approbation) avant
  `create_`/`begin_`, et un test d'intégration le prouver.
- WP20 : normaliser chaque `batch_id` en minuscules avant `create_device_journal_import` : un uuid en majuscules
  passe la création mais `open_imported_batch` ne le retrouve jamais (CL001, import bloqué).
- Renvoi d'un lot déjà reçu : `open_imported_batch` rend la ligne d'un autre import, la voie ordinaire peut rendre un
  lot `IMPORT` (sans effet financier, registre unique) ; le travailleur de WP20 ne doit pas en déduire l'état.
- WP08 : `cashless_app` a `arw` par défaut sur `device_journal_import`, `offline_batch_retry`, `offline_op_result`
  (trace RETRY ou `approved_by` forgeables) : retirer INSERT/UPDATE/DELETE/TRUNCATE ; `open_offline_batch_core` sans
  EXECUTE pour `cashless_app` (ACL actuelle : `postgres` seul).
- `device_journal_imports_processing` suppose un propriétaire qui ignore la RLS (documenté en tête de 0046).

## Issu de WP04 (0045, implémentation 1638f20e)
- WP08 : ne jamais accorder `offline_snapshot_envelope_ok`, `snapshot_signing_key_cap` ; à `cashless_snapcontent` :
  `offline_snapshot_keys_to_wrap`, `wrap_offline_snapshot_key` ; à `cashless_app` : `offline_snapshot_for_device`,
  `snapshot_public_keys` ; à `cashless_keyadmin` : `rotate_snapshot_signing_key`, retirer son INSERT direct sur
  `snapshot_signing_key` ; aucune écriture directe de `cashless_app` sur `offline_snapshot_key`.
- WP11/WP13 : `offline_snapshot_for_device` rend `{"entries":[…],"removed_token_hashes":[…]}`, `pwd_pack_enc` en
  base64 dans chaque entrée : confirmer que c'est la forme couverte par `content_sha256`.
- WP15 : `agreement_key_sha256` (hex) ajouté à l'enveloppe rendue, pour l'ETag ; `not_after` null = clé ACTIVE.
- `snapshot_public_keys` : clés du prestataire s'il a sa propre CENTRAL ACTIVE, sinon celles de la plateforme ; les
  snapshots déjà signés par la plateforme ne sont plus vérifiables ensuite (à juger en relecture).
- Relecture (approuvé) : limite `snapshot_public_keys` confirmée, à consigner (OP/ADR par WP21) pour la mission des
  clés par prestataire (parade : servir la clé plateforme tant qu'un snapshot qu'elle a signé est servable).
- WP09 : `rotate_snapshot_signing_key` ne contrôle que la longueur (91 octets), pas l'en-tête SPKI P-256 (26 octets
  fixes) : l'API doit valider la clé publique ; la rotation n'est pas auditée en base (`p_actor` ni stocké ni vérifié) :
  l'audit est à faire côté API (WP09).
- Mutants survivants (mineurs, WP08 ou WP21 peuvent ajouter le test) : grand livre LOCKED non testé
  (`wrap_` et `offline_snapshot_for_device`), filtre `draft.status = 'PUBLISHED'` non testé.
- `offline_snapshot_keys_to_wrap` (DEFINER, rend `content_key_wrapped` de tous les prestataires) : à
  `cashless_snapcontent` SEULEMENT.
- Contradiction de documentation : `data-model.md` place ces objets en 0044, `interfaces.md` en 0045 (suivi : 0045).

## Issu de WP06 (0047, implémentation 37655778)
- WP08 : `open_offline_anomaly` à `cashless_app` (WP16 remplace l'INSERT direct de `CLOCK_SKEW`,
  `payments.service.ts:186`) ; `reduce_offline_shortfall` à l'appelant de l'annulation ; `mark_seq_gap_alerted`,
  `mark_offline_retry_alerted`, `offline_seq_gaps_to_alert`, `offline_retries_to_alert` à `cashless_snapsign`
  SEULEMENT ; `offline_block_time` au traitement des lots ; retirer à `cashless_app` l'INSERT direct sur `anomaly`
  et INSERT/UPDATE/DELETE/TRUNCATE sur `wallet_status_history` ; `tests_definer_trigger_writers` test 16 : ajouter
  `wallet:log_wallet_status` deux fois (AFTER UPDATE et AFTER INSERT, avec WHEN).
- WP19 : `offline_block_time` rend NULL si aucun état bloquant n'est en vigueur à `p_before` ; or WP17 traite
  `blockTime` null comme un manque entier : WP19 doit distinguer « pas bloqué » de « inconnu » (à trancher en
  relecture de WP06).
- WP13/WP16 : l'identifiant d'anomalie est un uuid. Idempotence par (kind, device, seq, tx), NULL égaux : fournir
  un numéro ou une transaction pour obtenir des lignes distinctes.

## Issu de WP07 (0048, implémentation a18c9599)
- WP08 : `offline_snapshot_ack` : retirer INSERT/UPDATE/DELETE/TRUNCATE à `cashless_app` ; accorder à `cashless_app`
  les 7 lectures (`offline_snapshot_ack_floor`, `offline_snapshot_meta`, `offline_media_state_at`,
  `offline_config_in_force`, `device_status_at`, `device_revoked_at`, `offline_device_exposure`) et les 4 écritures
  (`ack_offline_snapshot`, `assert_vendor_session_at`, `record_sale_attribution_at`, `set_device_station_name`) ;
  retirer l'UPDATE direct de `cashless_app` sur `device` ; mettre à jour `tests_execute_grants` et
  `tests_definer_trigger_writers`.
- Retouche hors carte : 0048 ajoute `offline_snapshot.published_at` sur la table de WP03.
- WP07 lit `offline_snapshot_key` (0045) sans dépendre de WP04 : à relancer après fusion.
- Exposition : le canal EDGE est compté comme non acquitté (plus strict ; à confirmer par le porteur).

## Décisions du porteur du 30/10 (après-midi, WP09)
- `KeyAdminPort` élargi d'un `publicKey(ref)` en lecture seule ; `key-admin` ne reçoit toujours pas `sign`.
  ADR à rédiger (WP21) ; WP10 : `architecture.spec.ts` (`SIGN_PORT`, capacité `sign`, `snapshot-signer` = ['sign'],
  `key-admin` = ['keyAdmin']).
- Rotation de la clé de signature : passage explicite `--once` avec `SNAPSHOT_KEY_ROTATE_ACTOR=<uuid>`, sinon rien ;
  pas d'approbation à deux personnes (à consigner en point ouvert par WP21).

- WP09 (implémentation) : reprise sans seconde clé par une ligne d'audit `SNAPSHOT_SIGNING_KEY_CREATED` posée avant
  la rotation (aucune table de travaux) ; WP08 : `cashless_keyadmin` doit pouvoir lire cette ligne d'audit ;
  `AuditAction` + `SNAPSHOT_SIGNING_KEY_ROTATED`, `SNAPSHOT_SIGNING_KEY_CREATED` (retouche hors carte).

## WP08 — décisions du porteur du 30/10 (soir) et dettes à consigner par WP21
- `INSERT ON anomaly` GARDÉ pour `cashless_app` (écart au plan : le plan croyait `payments.service` seul appelant ;
  6 autres sites de la mission 6 : `psp-payment-processor.ts` ×2, `event-dispatcher.ts` ×2, `chargeback.service.ts`,
  `reversal.service.ts`). Statu quo d'OP-N86/ADR-136, levé en mission 13. WP21 : ADR (écart au plan, risque,
  condition de levée), mise à jour d'OP-N86, report dans PROMPTS-A-ENVOYER.md et PRD.md (mission 13). WP16 retire
  toujours l'INSERT `CLOCK_SKEW` de `payments.service.ts`.
- `SELECT` de `cashless_keyadmin` sur 5 colonnes de `snapshot_signing_key` (sans `public_key`) ACCEPTÉ, borné par
  test ; WP21 : ADR.
- Régression trouvée : `tests_grand_livre_cashless.sql` 214-217 et 222 échouent dès la fusion de 0044/0045
  (WP03/WP04) ; corrigé par WP08 dans `gen_tests.py` (retouche hors carte).
- WP10 : `device-purge` doit passer à `DATABASE_URL_MAINT` (plus de purge ni d'`UPDATE device` pour `cashless_app`).
- Fonctions accordées sans appelant encore (`effective_offline_policy`, `policy_in_force`, `device_missing_seqs`,
  `waive_seq_gap`, et la plupart de WP14-WP20) ; `reduce_offline_shortfall` à tout `cashless_app`.
- Retouches hors carte de WP08 : `scripts/test-pgtap.sh`, `src/migrate.ts`, `tools/dev-db/env.sh`,
  `.github/workflows/ledger-tests.yml`, 4 assertions de WP02-WP05 (« aucun GRANT ») restreintes.

## Relecture de WP09 (approuvé)
- Acteur de rotation non vérifié comme personne existante (uuid valide inconnu accepté ; aucune table de personnes) :
  à consigner (OP, WP21).
- `pendingRef` adopte la dernière ligne d'audit `SNAPSHOT_SIGNING_KEY_CREATED` sans filtrer l'origine : demandé à
  WP08 (0049) de réserver l'écriture de ces actions à `cashless_keyadmin` ; filtre d'origine côté code à ajouter si
  WP08 ne peut pas (lot à désigner).
- Arrêt entre `createKey` et l'audit : clé orpheline dans le KMS (une seule adoptée) ; à consigner.
- Preuve réelle « faux interdit en production » pour `snapshot-signer` : à WP13 (processus créé là).
- Mutants tués : garde `SIGN_PORT`, contrôle de courbe.

## Relecture de WP06 (approuvé) — pour WP19, WP16, WP08
- WP19 : convertir `-infinity` de `offline_block_time` en `'UNKNOWN'` (le driver `pg` ne rend pas une date
  utilisable) ; choisir `p_before` = `occurredAt + tolMs` (trop tard : un 2e blocage masque le 1er et couvre à tort ;
  trop tôt : manque entier injuste) et le tester.
- WP16/WP08 : `reduce_offline_shortfall` ne vérifie pas que `p_reversal_tx` annule `p_original_tx` : n'accorder qu'à
  l'appelant de l'annulation, passer la vraie annulation.
- Tests manquants (WP08 ou WP21) : même (kind, device, seq) avec des tx distinctes (mutant survivant) ; ligne de
  départ de la migration réelle (`other_block`, date de contestation) ; concurrence (prouvée à la main seulement).
- Deux `SIGNATURE_MISMATCH` sans terminal, numéro ni tx fusionnent : l'appelant doit renseigner un des trois.

## Relecture de WP07 (approuvé) — pour WP19
- `offline_device_exposure` joint `journal_transaction.device_id = registre.device_id` : une vente dont
  `device_id` est NULL (permis par `post_transaction`) sortirait du total sans erreur (lu, non reproduit). WP19 doit
  garantir `device_id` renseigné à l'écriture d'une vente hors ligne et le tester, OU la condition est retirée
  (correction de 0048, à décider avant WP19).
- `published_at` ajouté : lignes antérieures datées de la migration (sans effet avant production).

## Retouche hors carte à surveiller à la fusion
- WP05 a modifié `gen_tests.py` et régénéré `tests_grand_livre_cashless.sql` (grand livre L rattaché à l'événement
  EV ; passerelle sur EVL).

## Pour WP14 (API politique)
- `set_offline_policy` : remplacement complet (clé absente = hérite). Acteur invalide : P0002 (404). Portée d'un autre
  prestataire : CL045 ; `offline_max_exposure` sur un événement étranger : P0002.
- Exclusivité de deux `PUT` concurrents : prouvée à deux connexions psql par le relecteur de WP02 (CL046 au second).
- Mineurs de WP02 couverts par l'API : valeurs entières validées avant l'appel (un décimal `5.0` donne 22P02 en
  base, pas CL001) ; la ligne d'historique `deleted` porte le dernier modificateur : l'audit
  `OFFLINE_POLICY_CLEARED` de WP14 porte l'acteur réel de la suppression.

## Pour WP19 (traitement, issu de la relecture de WP17)
- `checkCompliance` : sous-motif `OFFLINE_DISABLED` et statut de terminal inconnu traité comme `DEVICE_REVOKED`,
  absents de `contracts/compliance.md` (plus strict, à connaître).
- Choix prudents figés par tests : états RETIRED/REPLACED/RELEASED/BATCH_INACTIVE = blocage inconnu ; blocage daté
  au plus tard à la génération du snapshot = manque entier. À reprendre dans le rapport de mission.
- `types.ts` : `OperationType`/`TapResult` du contrat sont des alias de `OfflineOperationType`/`TapResultCode`.

## WP08 cycle 2 (02/11)
- B1 : fonction DEFINER de verrou de terminal dans 0049 (renforce), appelée par `device-seq-registry.ts`,
  `cash-topup.service.ts`, `device-config.service.ts` (retouches hors carte, fichiers de WP16/WP15) ; ajout au
  contrat (nom absent d'`interfaces.md`) à reporter par WP21.
- M4 (porteur, 02/11) : RESTREINDRE : `cashless_app` ne lit plus `offline_snapshot.content_key_wrapped`
  (SELECT par colonne). WP15 : ne jamais sélectionner cette colonne ni `SELECT *`.
- Cycle 2 (`c2ee1033`) : `lock_device(uuid, text)` appelé aussi par `payments.service.ts` et `reversal.service.ts`
  (`FOR UPDATE OF d`) ; 3 specs à matchers SQL retouchées. Batterie orchestrateur (`cashless_test`) : pgTAP 51
  fichiers / 4777 PASS ; Jest 162 suites vertes, 5 en échec : `config.spec.ts:270` (pour WP15, ci-dessous),
  `media-port-swap` (purge, WP10), `claim-code-order` et `migrate-lock` (instables connues), `personalization`
  (délai sous charge, verte seule 44/44).
- WP15 : `devices/config.spec.ts:270` (« téléphone personnel : jamais hors ligne ») insère `cash_topup_offline: true`,
  refusé par la contrainte de 0043 (décision du porteur) : réécrire le test avec un autre réglage hors ligne.

## Issu de WP16 (implémentation, 02/11)
- `reduce_offline_shortfall` câblé dans `offline/anomalies/anomaly-writer.ts` sans appelant : l'annulation
  (`reversal.service.ts`, hors carte) doit l'appeler avec la vraie transaction d'annulation : WP19 (ou lot désigné
  par l'orchestrateur) ; sinon dette à consigner par WP21.
- 6 `INSERT INTO anomaly` restent hors carte (statu quo du porteur du 30/10, mission 13), dont
  `reversal.service.ts:212` (CLOCK_SKEW).
- `Number(seq)` hors carte : `payment-request.service.ts:452,464`, `enrollment.service.ts:204` (exacts depuis
  `MAX_DEVICE_SEQ = 2^53−1`) ; `device-config.service.ts` : WP15.
- `chained-content.ts` et `test/fixtures/offline-vectors/vectors.json` font référence pour WP18 et WP19.

## Relecture de WP10 (approuvé, 02/11)
- 5/5 mutants tués (`architecture.spec.ts`). Mineurs : (1) en production, `DATABASE_URL_MAINT` pointant vers le rôle
  propriétaire n'est pas refusé au démarrage (la purge réussirait) : contrôle du rôle au démarrage à décider (porteur)
  ou consigner (WP21) ; (2) WP13 : rendre obligatoires dans `architecture.spec.ts` les racines et `main.*.ts` de
  `snapshot-signer` (aujourd'hui « si le fichier existe ») ; WP11 de même pour `snapshot-content` ; (3) test
  « sign seulement depuis snapshot-signer » vacueux tant que `SIGN_PORT` n'existe pas (WP13).

## Relecture de WP16 (approuvé, 02/11) — pour WP18, WP19
- `gen_vectors.py` trie les clés par point de code, JCS par unités UTF-16 : WP18/WP19 n'ajoutent aucun vecteur à
  nom de propriété hors BMP (emoji) sans corriger le générateur.
- `AnomalyInput.detail` est `unknown` : WP19 ne passe aucun texte libre venu du terminal dans `detail`.
- Pas de test d'intégration réel de `lookup` (dont isolation entre prestataires) ni d'`openAnomaly` : WP18/WP19 les
  couvrent par le bout en bout.

## WP11 rejeté (cycle 1, 02/11) et WP03 rouvert (décision du porteur)
- WP11 (a) : `mem.reserved` levé seulement à la publication : brouillon READY jeté par le signataire = plus aucun
  `save_` (0 version en 12 passages). Cycle 2 : lever la réservation après délai, test d'intégration ; mineurs :
  ligne `OWNED_FIELD_MISMATCH` et appel de purge sans test, pas de temporisation sur échec répété.
- Trous de 0044 (b), porteur 02/11 : WP03 rouvert (cycle 3) : fonction de jet des brouillons OPEN/READY d'un grand
  livre, empreinte d'état indépendante du chiffré du mot de passe, plafond `max_snapshot_age` dans
  `offline_snapshot_targets`. WP11 cycle 2 après approbation de WP03 : refusionner lane-c dans lane-k, GRANT de la
  nouvelle fonction à `cashless_snapcontent` dans `post-roles.sql` (+ tests de droits), adopter le plafond. WP12
  attend. WP21 : reporter les ajouts au contrat.
- WP15 : `pwd_pack_enc` de `offline_snapshot_for_device` = blob base64 de 34 octets (nonce 12, chiffré 6, tag 16) :
  le découper en `EncryptedBlob {nonce, ciphertext, tag}` (openapi prime).
- WP13 (implémenté, be9d8e0f) : `verifyDraft` refuse aussi un en-tête périmé et un entier non sûr (renforce) ;
  `architecture.spec.ts` de lane-m complété (fusion avec la version de WP10 à la consolidation) ; conflit possible
  `SNAPSHOT_POLL_SECONDS` dans `config.ts` avec WP11.

## Décision du porteur du 02/11 (WP13, clé de signature)
- `cashless_snapsign` reçoit l'EXECUTE de `snapshot_public_keys` (lecture seule de clés publiques) : le signataire
  vérifie sa signature contre la clé publique du `key_id` de l'en-tête et refuse de publier sinon. Droit élargi
  accepté par le porteur : WP21 rédige l'ADR (risque, raison) ; test de droits qui borne (aucun droit de table sur
  `snapshot_signing_key`).
- WP03 cycle 3 (6500ff5c) : `discard_open_offline_snapshot_drafts(p_ledger uuid) RETURNS int` ;
  `offline_snapshot_targets()` + `max_snapshot_age interval` (plus petit plafond des terminaux, défaut 15 min) ;
  `offline_snapshot_entry_sha256` ignore `pwd_pack_sha256`. APPROUVÉ (relu, 5 mutants tués ; aucun chemin où le mot
  de passe change sans `key_index`/`nfc_uid`/`status`). pgTAP complet de lane-c : seuls 215-217, 222 de
  `tests_grand_livre_cashless.sql` (régression connue, corrigée par WP08 dans lane-h). À reporter au contrat par WP21.

## Relecture de WP13 (approuvé, 02/11) — pour WP21
- 7 mutants tués ; survivant : recherche par `key_id` contre premier élément de `snapshot_public_keys` (rattrapé par
  `publish_` : défense en profondeur ; test à ajouter : en-tête au `key_id` RETIRED signé par l'ACTIVE).
- Seuil de 24 h des trous testé à 23 h et 25 h seulement (SQL : strictement supérieur).
- ADR de WP21 : une `SNAPSHOT_SIGNING_KEY_REF` erronée fait jeter chaque brouillon READY (alarme 3), le producteur
  régénère ; `publish_` ne recompare que les comptes, l'immuabilité d'un READY repose sur 0044/WP08.
- Relecture humaine : `header-signer.ts`, `draft-verifier.ts`, `post-roles.sql` § 8f, `config.ts` (référence de clé).

## WP11 rejeté au cycle 2 (02/11)
- Régression du cycle 2 : jet mutuel des brouillons entre instances (60 s, aucun verrou), signataire lent jeté avant
  son alarme de 5 min ; mutants survivants (backoff, conversion d'interval, délai). Cycle 3 : verrou consultatif par
  grand livre, délai des orphelins 10 min configurable (> 300 s), tests à deux instances.
- WP21 : la CI doit remettre la base à zéro avant pgTAP (les suites WP11 laissent des brouillons READY committés :
  `tests_offline_rights.sql` test 87 faux sinon).

## Issu de WP18 (implémentation a5c19b68, 02/11) — pour WP19, WP21
- WP19 : `BatchContext`, `ParsedOperation`, `OperationResult`, jeton `OFFLINE_OPERATION_PROCESSOR` dans
  `offline/batches/batch.types.ts` (forme d'`interfaces.md` § 8) ; `UnavailableOperationProcessor` par défaut (lot
  laissé `PROCESSING`, 500) jusqu'au branchement de WP19 ; faux processeur interdit en production.
- Corps de `POST /offline-batches` lu jusqu'à 4 Mio, `413 BATCH_TOO_LARGE` au-delà de 1 Mio.
- Préexistant, hors mission : un corps de plus de 100 ko sur les autres routes donne `500` au lieu de `400/413` :
  à consigner (WP21, point ouvert).
- Contradictions de documentation : ordre des contrôles `batches.md` contre R-10 ; migration de
  `complete_offline_batch` (0045 dans R-11, 0046 dans `interfaces.md`).

## Règle de tests (02/11, issue de WP13)
- Un processus de fond (signataire, contenu, travailleurs de WP18-WP20) traite toute la base : ses tests créent leur
  propre prestataire/grand livre et n'affirment rien de global (`runOnce`, compteurs, alarmes) ; preuve exigée en
  `--maxWorkers=3`.

## Divers
- Issue-matrix : `#10` (ligne de la table de conflit, WP17) = `not-applicable`.

## Reprise du 03/11
- Session du 02/11 interrompue pendant les relectures de WP11 (cycle 3) et WP15 (cycle 2) : relectures relancées.
- colima redémarré (3 Gio) ; `pg_prove` = lanceur Docker `docs/passation-5b/scripts/pg_prove-docker` lié dans le
  `bin` du scratchpad de la session (chemin mis à jour dans la fiche d'implémentation).
- WP19 : lane-s créée, lanes f, g, p, q, r fusionnées par `merge-deps.sh` (l'auto-fusion de lane-q échouait sur
  `kitty-specs/`) ; implémentation lancée. Arbitrages donnés : `device_id` garanti par WP19 (0048 inchangée) ;
  `reduce_offline_shortfall` appelé depuis `reversal.service.ts` (hors carte) par WP19, sinon dette WP21.
- WP14 : dépendances approuvées, à lancer quand une relecture se libère (mémoire du poste).

## Relecture de WP15 cycle 2 (approuvé, 03/11) — pour WP19, WP21
- `snapshot_keys` vient de `snapshot_public_keys($operatorId)` : toute suite qui crée des clés les met en
  `operator_id` de son prestataire ; `offline_enabled` est faux sans clé ACTIVE.
- Mineurs : tests « sans clé ACTIVE » font `return` si une clé de plateforme existe (vacueux dans ce cas) ; une ligne
  SQL de `snapshots-seed.ts` > 100 car. (Prettier à la fusion) ; pas de test croisé entre prestataires dans
  `snapshots.spec` (isolation par la fonction SQL et la RLS) : à couvrir par WP21.
- Relecture humaine : `offline-snapshots.service.ts` (lecture de l'enveloppe, découpe de `pwd_pack_enc`),
  `snapshot-etag.ts`.

## Relecture de WP11 cycle 3 (approuvé, 03/11) — pour WP12, WP13, WP21
- Verrou consultatif de session par grand livre (`apps/api/src/db/advisory-session.ts`) ; délai d'orphelin
  `SNAPSHOT_ORPHAN_DISCARD_SECONDS` = 600 s, config refuse ≤ 300 s ; aucun droit de base ajouté.
- WP21 : consigner (ADR + POINTS_OUVERTS) le verrou et le délai de 10 min, et la limite connue : au démarrage, le
  balayage jette un brouillon READY tout juste scellé par l'instance précédente (le signataire l'écarte par
  DRAFT_NOT_READY). CI : `reset-db` avant pgTAP (rappel).
- Signataire : tolérer DRAFT_NOT_READY après redémarrage de snapshot-content ; alarme à 5 min inchangée.
- Mineur : `releaseExcept` dans `runOnce` sans try/catch (une panne de base remonte à l'appelant).
- Relecture humaine : `snapshot-draft.repository.ts`, `advisory-session.ts`, `snapshot-content.worker.ts`.
- Fiche corrigée : `pg_prove` se lance depuis `packages/ledger-sql/` avec `tests/<fichier>.sql`.

## Issu de WP14 (implémentation 01dc40c6, 03/11) — à trancher en relecture, pour WP21
- Contradictions : le prompt annonce onze `operationId`, le contrat en déclare 9 ; « policy nulle » pour un niveau
  absent alors que le schéma exige un objet (rendu : 5 valeurs null, `cash_topup_offline: false`, `version: 0`).
- `OPERATOR_ADMIN` peut couper un terminal (`{offline_enabled:false, version}` seul) ; l'API relit le niveau puis
  appelle `set_offline_policy` : base contractuelle et course lecture/écriture à vérifier par le relecteur.
- Renforcement : `cash_topup_offline: null` refusé (422) en plus de `true`.
- Retouches hors carte : `app.module.ts`, `audit.service.ts` (`OFFLINE_POLICY_SET`, `OFFLINE_POLICY_CLEARED`).

## Relecture de WP14 (approuvé, 03/11) — pour WP21
- Contradictions tranchées par `openapi.yaml` : 9 routes (le « onze » du prompt est faux, à corriger au rapport) ;
  niveau absent conforme (« policy nulle et version 0 ») ; coupure par `OPERATOR_ADMIN` prévue au contrat
  (`setDeviceOfflinePolicy`), bornée à `offline_enabled:false`, montants en 403 ; course fermée par la `version`
  (FOR UPDATE + CL046), lue dans le code, non reproduite.
- Mineurs : refus au-dessus de 2^53−1 alors que le contrat dit int64 (plus strict) ; terminal sans événement :
  seul `OPERATOR_ADMIN` le lit ou le coupe (à confirmer côté produit) ; pas de test de course coupure contre `PUT`
  organisateur (WP21 peut l'ajouter).

## Issu de WP12 (implémentation 149599fe, 03/11) — pour la relecture, WP21
- `WrappedKey` : `iv` = nonce (base64), `wrapped_key` = base64(chiffré ‖ tag 16) ; confirmé par un vecteur Python
  indépendant. `pwd_pack_enc` 34 octets (12/6/16), hex dans le brouillon, base64 servi ; `pwd_pack_sha256` sur les
  octets bruts. Version connue avant chiffrement par `expectedVersion` (WP03 non rouvert).
- **À trancher (sécurité ?)** : entrée publiée SANS mot de passe si le `pwd_pack_enc` ne s'ouvre pas
  (`PWD_DEK_RETIRED|MISSING`, `PWD_OPEN_FAILED`, `PWD_INCOMPLETE_ROW`), non rejouée par DELTA (FULL suivant ≤ 1 h).
  Soumise au relecteur ; au porteur si c'est un affaiblissement.
- Limites pour WP21 (OP/ADR) : `content_key_wrapped` sans référence de la clé d'emballage (rotation = anciennes
  versions inouvrables) ; clé d'accord invalide en tête de `offline_snapshot_keys_to_wrap` (au-delà de 500, affame
  les suivantes) ; `DekCache` jusqu'à `tagDekCacheSeconds`.
- Retouches hors carte dans les fichiers de WP11 (`entry-encryptor.ts`, `snapshot-builder.ts`, worker, repository :
  colonne `media_id`, module) et `build-diff.spec.ts` ; supports de tests `snapshot-crypto-fixtures.ts`,
  `snapshot-secrets-db.ts`.
- Incident : un passage de `secrets-sweep` a visé `cashless_test` (variables non exportées) : remettre
  `cashless_test` à zéro avant la batterie de l'orchestrateur.
- Relecture humaine : `device-envelope.ts` (tag-format), `crypto/snapshot-entry-encryptor.ts`,
  `crypto/snapshot-key-wrapper.ts`, `crypto/device-wrapping.worker.ts`, `crypto/device-wrapping.repository.ts`.

## Relecture de WP12 (approuvé, 03/11) — pour WP21
- Entrée sans mot de passe : échec FERMÉ, pas un affaiblissement : `sync_protocol.md` § 6, contrôle 3, le terminal
  refuse un bracelet dont le PWD est absent du snapshot ; `pwd_pack_enc` nul prévu par `contracts/snapshots.md`
  et `data-model.md`, demandé par T050. Coût : disponibilité (bracelet refusé hors ligne ≤ 1 h). Échouer toute la
  version retarderait les blocages (§ 4.2-1).
- AAD conformes à R-08 (`SNAPKEY` : ledger, version, device ; `SNAPPWD` : ledger, version, token_hash, nfc_uid).
- WP21 : OP/ADR pour l'entrée sans mot de passe, `content_key_wrapped` sans référence de clé, file d'enveloppes
  (> 500 invalides, risque faible : point P-256 validé à l'enrôlement) ; alarme (pas seulement un journal ERROR) et
  seuil sur les entrées `skipped` ; test d'effacement de `pwdPack` (mutant `zeroize(pwdPack)` survivant).
- `openapi.yaml` (`WrappedKey` A256GCM avec `iv`) vient de WP01 (lane-a) : présent dans lane-o (WP15), absent de
  lane-l (WP12 ne dépend pas de lane-a) : réglé à la consolidation.
- Relecture humaine : voir « Issu de WP12 ».

## Issu de WP19 (implémentation 603848fa, 03/11) — pour la relecture, WP20, WP21
- Moteur touché : `ledger-engine.service.ts` (`EngineResult.shortfall`), `money/spend.ts` (`coveredCap`, dans
  l'empreinte de commande), `purchase.ts` ; `tap.service.ts` (`registerOffline`). Relecture humaine : ces lignes.
- Hors carte : `offline-batches.module.ts` (vrai processeur sur `OFFLINE_OPERATION_PROCESSOR`,
  `UnavailableOperationProcessor` retiré) ; `reversal.service.ts` (`reduce_offline_shortfall` avec la vraie
  annulation, testé) ; `test/scenario/commands.ts` (étape 22, `coveredCap: 6000n`).
- Écarts à classer en relecture : vente hors catalogue (`CL034`) écrite sans lignes (`CATALOG_MISMATCH`) ;
  inversions de dates non ouvertes en `CLOCK_SKEW` (`BatchContext` sans la liste : WP18) ; `config_id` inconnu =
  `OFFLINE_NOT_ALLOWED` (WP17) contre `POLICY_LIMIT_EXCEEDED` (§ 7.2) ; `REVERSAL` sans `tap` rejeté
  (`PACK_NOT_VERIFIED`, à trancher avec le porteur) ; `detail = {codes:[…]}`.
- Dettes : annulation back-office (`sale-reversal-action.ts`) sans `reduce_offline_shortfall` ; non testés :
  `WRONG_EVENT` (conflit), `NOT_ACTIVATED`, canal `IMPORT` (code présent).

## Décisions du porteur du 03/11 (relecture de WP19) — pour WP21 (ADR, rapport)
- Inversions de dates (FR-025) : branchées via WP18 (liste ajoutée à `BatchContext`, retouche hors carte d'un lot
  approuvé) et anomalie `CLOCK_SKEW` ouverte par WP19 ; pas de dette.
- Annulation hors ligne : suit le contrat (exemple `openapi.yaml`, seq 88) : sans tap re-présenté, devise du grand
  livre, bracelet de la vente visée, cible limitée au même terminal.
- Classés neutres par le relecteur, à consigner (ADR + POINTS_OUVERTS) par WP21 : vente hors catalogue écrite sans
  lignes (`CATALOG_MISMATCH`) ; `config_id` inconnu = `OFFLINE_NOT_ALLOWED` + `POLICY_LIMIT_EXCEEDED` en détail
  (§ 7.2 de `sync_protocol.md` à signaler) ; annulation back-office sans `reduce_offline_shortfall` (perte
  surestimée). WP21 : tests `WRONG_EVENT` (conflit), `NOT_ACTIVATED` ; WP20 : canal IMPORT de bout en bout
  (`approver()` lève si l'import n'a pas d'approbateur).
- Chemin en ligne du moteur relu strictement inchangé. Relecture humaine : `ledger-engine.service.ts` (somme
  SUSPENSE), `money/spend.ts`, `purchase.ts`, `offline-sale.writer.ts` (SAVEPOINT/CL007), `shortfall-reduction.ts`
  et son appel dans `reversal.service.ts`, `compliance-input.reader.ts`.

## WP19 cycle 2 (implémentation d65390e2, 03/11)
- B1 corrigé (annulation seq 88 acceptée ; cible introuvable sans tap = `REVERSAL_TARGET_NOT_FOUND`, faits
  « favorables » posés pour les contrôles 6 à 9) ; `BatchContext.inversions` + `BatchOpening` (hors carte WP18 :
  `batch.types.ts`, `batch-runner.ts`, `offline-batches.service.ts` ; `batch-runner` importe `TOLERANCE_MS` de
  `processing/`) ; anomalie `CLOCK_SKEW` `DATE_INVERSION` ; tests M6, M7.
- Contradiction de contrat : exemples `openapi.yaml` seq 87/88 sans `vendor_session_id`, exigé par le processeur
  (plus strict) : corriger l'exemple ou décider (WP21 / rapport).
- Non traité : test `TOPUP_CASH` qui ne distingue pas l'arrêt anticipé de `checkCompliance` (mineur, WP21).

## Relecture de WP19 cycle 2 (approuvé, 03/11)
- **Contradiction de contrat à trancher** : `contracts/compliance.md` (l. 2) et R-30 exigent la session de vendeur
  (sinon `OFFLINE_NOT_ALLOWED`/`VENDOR_SESSION`), mais le schéma `OfflineOperation` d'`openapi.yaml` n'a AUCUN champ
  `vendor_session_id` (ni l'exemple seq 87/88) ; `sync_protocol.md` muet. Un terminal qui suit `openapi.yaml` voit
  toutes ses opérations rejetées. **Décision du porteur (03/11) : corriger via WP21** (retouche hors carte de
  `packages/contracts/openapi.yaml` de WP01) : `vendor_session_id` (uuid) dans `OfflineOperation`, requis pour
  `PURCHASE` et `REVERSAL`, exemples seq 87/88 et types générés (`packages/contracts/src`, `dart`) mis à jour ; code
  de WP19 inchangé ; signaler la contradiction au rapport de mission.
- Mineurs : `TOLERANCE_MS` exporté par `compliance-input.reader.ts` (le placer dans `rules/`) ; test `TOPUP_CASH`
  (reliquat) ; annulation d'une vente sans bracelet rejetée `MEDIA_NOT_IN_SNAPSHOT` (plus strict, sans effet hors
  ligne).

## Issu de WP20 (implémentation 1b824251, 03/11) — pour la relecture, WP21
- Défaut de WP19 corrigé hors carte : `offline-sale.writer.ts` passait `approverId` à
  `record_sale_attribution_at` (refusé hors annulation, CL001 : tout import de vente échouait) ; passe `null`,
  l'approbateur reste `approved_by` de l'écriture.
- Limite de corps de l'import : 21 037 056 octets (20 lots de 1 Mio + 64 Kio) puis 413 ; lu seulement avec un en-tête
  `Authorization` (sinon limite globale de 100 ko). À juger en relecture (déni de service).
- **Trou de base (WP05)** : demande rejetée/expirée ou `begin_` en échec (CL053, CL010) laisse l'import PENDING ;
  l'index d'unicité bloque alors tout nouvel import du terminal. Aucune fonction de sortie. Non contourné.
- Contradictions : `CHAIN_BROKEN` 409 (catalogue) contre 400 (prompt) ; 422 sur `{seq}` > 2^53−1, 400 sur un
  numéro de lot (FR-033 contre R-14) ; approbation rend PROCESSING (R-30.10) contre `openapi.yaml`.
- Hors carte : `app.module.ts`, `audit.service.ts` (4 actions), `batch-body.ts`, `offline-batches.module.ts`,
  `test/integration/offline/journal-world.ts`.
- Relecture humaine : `journal-import.action.ts`, `journal-import.worker.ts`, `journal-verify.ts`,
  `journal-body.ts`, `offline-sale.writer.ts` (ligne corrigée).

## Décisions du porteur du 03/11 (relecture de WP20) — pour WP21 (ADR, contrat)
- Import bloqué en PENDING (trou de 0046) : corrigé dans WP20 cycle 2 par la migration
  `0050_device_journal_import_cancel.sql` (hors plan : 0043-0049 seulement), EXECUTE à `cashless_app` dans
  `post-roles.sql` ; appel au rejet et à l'expiration. WP21 : reporter au contrat (`interfaces.md`), ADR.
  Relecture humaine : 0050 et le § ajouté de `post-roles.sql`.
- Corps lu avant le jeton : corrigé sur l'import ET sur `POST /offline-batches` (WP18) : jeton (et rôle pour
  l'import) vérifié avant la lecture.
- Restent pour WP21 : 500 `INTERNAL_ERROR` au lieu de 413 au-delà de la limite globale de 100 ko (défaut ancien) ;
  contradictions tranchées par le relecteur (`CHAIN_BROKEN` 409, 422/400 pour seq > 2^53−1, PROCESSING selon
  R-30.10) à noter au rapport.

## WP20 cycle 2 (implémentation 8aabe5ae, 03/11) — pour la relecture, WP21
- 0050 : `cancel_device_journal_import(p_import, p_actor, p_reason)` DEFINER, idempotente, `assert_tenant` ;
  passe PENDING → **REJECTED** (pas FAILED : garde de 0046 et contrainte `device_journal_import_approved`) ; refuse
  si la demande est encore valable (CL001) ou l'import non PENDING (CL053). Appelée au rejet, à l'expiration, à
  l'échec avant `begin_` ; une nouvelle demande libère un import dont la demande a expiré.
- Identité avant lecture du corps : `offline/batches/body-gate.ts` ; `preAuthenticate` (preuves 1 à 4 sans nonce)
  ajouté à `authentication.guard.ts` et `device-identity/*` (hors carte, relecture humaine).
- Hors carte aussi : `approval/action-registry.ts` (crochet `onClosed`), `approval.service.ts`, `audit.service.ts`
  (`DEVICE_JOURNAL_IMPORT_CANCELLED`).
- WP21 : consigner les limites de 0050 (REJECTED, pas d'annulation tant que la demande est valable) ; instabilité
  observée de `processing-reversal-clock` (ordre de lignes, horloge Docker).
- Relecture humaine : 0050, `post-roles.sql` (1 ligne), tests de droits, `real-device-identity.ts`,
  `authentication.guard.ts`, `body-gate.ts`.

## Relecture de WP20 cycle 2 (approuvé, 03/11) — pour WP21
- `preAuthenticate` ne remplace jamais la garde complète (nonce, signature, rejeu toujours exécutés ensuite) ; corps
  jamais lu en cas d'échec, erreur du filtre fermée ; 0050 bornée (prestataire, demande approuvée refusée).
- **À corriger avant la fusion** : `test/integration/end-to-end/device-auth-matrix.spec.ts` échoue (2 tests) :
  `POST /offline-batches` et `GET /offline-batches/{id}` (WP18) absents de la matrice des routes de terminal (OP-N70).
- Mineurs : `gatedBody` lit sans filtre si l'identité n'a pas de `preAuthenticate` (pas fermé par principe ; test de
  présence du filtre en configuration réelle) ; consigner REJECTED au lieu de FAILED (écart au libellé du porteur).

## WP21 lancé (04/11)
- Réclamé par l'orchestrateur (lane-u, déjà à jour des lanes a à t). Trois implémenteurs en parallèle dans la lane :
  A = T087 + T089 (`cashless_wp21`), B = T088 + correctif de `device-auth-matrix.spec.ts` (routes de WP18 absentes
  de la matrice, hors carte, renforce ; `cashless_wp21b`), C = T090 + T091 (`cashless_wp21c`) ; `jest.config.cjs`
  à C. `mark-status` et `move-task` par l'orchestrateur une fois les trois parts réunies.

## WP21 parts B et C rendues (04/11) et décisions du porteur
- B (`56dfe639`, `cace1dce`, `da6f8160`) : isolation, secrets (canari), production ; matrice des routes de terminal
  13/13 (routes de WP18 et snapshots ajoutées) ; `production-guard.spec.ts` complété (`RefusingEntryEncryptor`,
  `FakeOperationProcessor`). 61/61 sur `cashless_wp21b`. Lignes > 100 car. (Prettier à la fusion).
- C (`a7e6b0ba`, `4c255e7a`) : CI, `SKIP_LATENCY`, levées N57 N58 N68 N69 N75 (pg_prove vert), ADR-141 à 147,
  OP-N92 à N95, ADR-137 corrigé. Matrice : scratchpad de la session 8b13eab6 (`wp21-acceptance-matrix.md`).
- Décisions du porteur (04/11) :
  - OP-N95(3) : **refuser au démarrage** en production un `DATABASE_URL_MAINT` vers le propriétaire ou un
    superutilisateur, avec test (renforcement, WP21).
  - `GET /device/seq-status` et `GET /events/{event_id}/device-sync-status` (contrat, non servies) : **servies dans
    la mission 7** (WP21, hors carte), avec cas d'isolation.
  - 403 au lieu du 404 neutre pour une personne d'un autre prestataire : vérifier l'absence de fuite d'existence,
    puis décider.
  - OP-N93(a) (clés publiques par prestataire) : **confirmé en 12b**.
- Reste à WP21 : FR-042 (`vendor_session_id` au contrat), test FR-018 (`VOID_CONFLICT`), tests de borne d'OP-N95(1)(4),
  N93(a)(c), N94(1)(3) ; `GET /devices/{id}/journal-imports/{import_id}` en 404 pour son superviseur (à examiner) ;
  `interfaces.md` et `quickstart.md` (orchestrateur, sur feat).

## WP21 part D (04/11) et décisions du porteur
- D : `969dd3b5` (`vendor_session_id` au contrat, FR-042), `8f394474` (`GET /device/seq-status` servie, sans droit
  ajouté). Import PENDING en 404 : voulu (PENDING jamais exposé), pas un défaut de WP20.
- Décisions du porteur (04/11) : `GET /events/{event_id}/device-sync-status` servie par une **enveloppe DEFINER
  étroite** (migration 0051, lecture seule, bornée au prestataire, EXECUTE à `cashless_app` sur elle seule ;
  `event_sync_deadline` reste retirée) : droit élargi accepté, ADR + OP + test de droits + relecture humaine ;
  rôles = ceux de `getEventOfflineRisk`, 404 neutre pour un autre prestataire, contrat complété ;
  `seq-status` servie au terminal SUSPENDU (comme les lots) : gardé, à consigner et préciser au contrat.

## État des lots
| Lot | Lane | État | Commit | Notes |
|---|---|---|---|---|
| WP21 | u | in_progress | — | lancé le 04/11, trois parts (A, B, C) |
| WP19 | s | approved (cycle 2) | d65390e2 | relu le 03/11 : 4 mutants tués (M6, M7a, M7b, M10), 139/139 maxWorkers=3 ; rejet cycle 1 (03/11) : B1 annulation, inversions CLOCK_SKEW (porteur), tests M6/M7 ; constats `rapports/WP19-review-cycle-1.md` |
| WP20 | t | approved (cycle 2) | 8aabe5ae | relu le 03/11 : 7 mutants tués, 130/130 maxWorkers=3 ×2, pgTAP vert ; rejet cycle 1 (03/11) : 4 mutants survivants, import PENDING bloqué, corps lu avant le jeton ; `rapports/WP20-review-cycle-1.md` |
| WP12 | l | approved | 3528e30d | relu le 03/11 : 92/92 maxWorkers=3 ×2, 8/9 mutants tués, 0 bloquant |
| WP14 | n | approved | 01dc40c6 | relu le 03/11 : 19/19 maxWorkers=3 ×2, 7 mutants tués, 0 bloquant |
| WP02 | b | approved | 9a4bd1fc | 82/82 pgTAP ; relu, 3 mineurs consignés |
| WP01 | a | approved | ed1eaef0 | cycle 2 ; route getDeviceJournalImport, pwd_pack_sha256 précisé |
| WP18 | r | approved | a5c19b68 | relu le 02/11 : 46/46 (maxWorkers=3 et runInBand), 6 mutants tués, 0 bloquant ; mineurs perdus avec la session (non consignés au fichier de relecture) |
| WP15 | o | approved (cycle 2) | b4ca0427 | relu le 03/11 : 5 constats du cycle 1 levés, 5 mutants tués (1 équivalent), maxWorkers=3 ×2 vert ; rejet cycle 1 : tests à effet global sur les clés (4/4 échecs en parallèle), preuve « téléphone » vacueuse ; API conforme (4 mutants tués) |
| WP11 | k | approved (cycle 3) | dc7d041c | relu le 03/11 : 8 mutants tués, 62/62 en maxWorkers=3 ×2 ; rejet cycle 1 (réservation), cycle 2 (jet mutuel entre instances) |
| WP13 | m | approved | 42828a6d | relu, 7 mutants tués, 4 mineurs ; décision porteur clé publique ; pgTAP 4780 PASS ; Jest : 2 suites du signataire dépendaient de l'isolation (corrigé par `42828a6d`, tests seulement, vert en `--maxWorkers=3`) ; reste config:270 (WP15) |
| WP03 | c | approved (cycle 3) | 6500ff5c | rouvert le 02/11 (trous de 0044) ; 145/145 ; relu |
| WP05 | e | approved | a09a117b | 167 assertions ; batterie pgTAP 3996 PASS ; gen_tests.py retouché (sortie du générateur identique) ; relu, 6 mineurs |
| WP17 | q | approved | b32e6592 | implémenteur interrompu ; 136 tests ; relu, 4 mineurs (voir « Pour WP19 ») |
| WP04 | d | approved | 1638f20e | 135 assertions ; CL054 à deux connexions ; relu, 3 mineurs, 10/13 mutants tués |
| WP06 | f | approved | 37655778 | 121/121 ; relu, mineurs (voir « Relecture de WP06 ») |
| WP07 | g | approved | a18c9599 | 109/109, aussi avec la vraie 0045 ; relu, 4/4 mutants tués |
| WP09 | i | approved | b71e2a2a | 88/88 Jest + processes.spec 24/24 ; relu, 3 mineurs, 2/2 mutants tués |
| WP16 | p | approved | 5b393ff5 | relu, 4/5 mutants tués (5e équivalent) ; 3 mineurs ; pgTAP 4777 PASS, Jest 167 vertes hors attendus (purge WP10, config:270 WP15) |
| WP10 | j | approved | 824c5fb1 | relu, 5/5 mutants tués, 3 mineurs ; pgTAP 4777 PASS ; Jest 165 vertes, échecs connus (config:270 WP15, claim-code-order, personalization) + `migrate-rights` (« tuple concurrently updated », GRANT concurrents des agents ; verte seule 2/2) |
| WP08 | h | approved (cycle 2) | c2ee1033 | rejet cycle 1 (verrous `device`) ; cycle 2 : `lock_device`, M1-M4 ; relu, 2/2 mutants tués ; pgTAP 4777 PASS, Jest vert hors connus |
