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

## Divers
- Issue-matrix : `#10` (ligne de la table de conflit, WP17) = `not-applicable`.

## État des lots
| Lot | Lane | État | Commit | Notes |
|---|---|---|---|---|
| WP02 | b | approved | 9a4bd1fc | 82/82 pgTAP ; relu, 3 mineurs consignés |
| WP01 | a | approved | ed1eaef0 | cycle 2 ; route getDeviceJournalImport, pwd_pack_sha256 précisé |
| WP03 | c | approved (cycle 2) | ab3c396b | 116/116 ; B1-B3, M1 corrigés |
| WP05 | e | approved | a09a117b | 167 assertions ; batterie pgTAP 3996 PASS ; gen_tests.py retouché (sortie du générateur identique) ; relu, 6 mineurs |
| WP17 | q | approved | b32e6592 | implémenteur interrompu ; 136 tests ; relu, 4 mineurs (voir « Pour WP19 ») |
| WP04 | d | approved | 1638f20e | 135 assertions ; CL054 à deux connexions ; relu, 3 mineurs, 10/13 mutants tués |
| WP06 | f | approved | 37655778 | 121/121 ; relu, mineurs (voir « Relecture de WP06 ») |
| WP07 | g | approved | a18c9599 | 109/109, aussi avec la vraie 0045 ; relu, 4/4 mutants tués |
| WP09 | i | approved | b71e2a2a | 88/88 Jest + processes.spec 24/24 ; relu, 3 mineurs, 2/2 mutants tués |
| WP10 | j | approved | 824c5fb1 | processus maintenance ; relu, 5/5 mutants tués, 3 mineurs ; batterie en cours |
| WP08 | h | approved (cycle 2) | c2ee1033 | rejet cycle 1 (verrous `device`) ; cycle 2 : `lock_device`, M1-M4 ; relu, 2/2 mutants tués ; pgTAP 4777 PASS, Jest vert hors connus |
