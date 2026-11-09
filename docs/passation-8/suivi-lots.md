# Suivi des lots, mission 8 (orchestrateur)

Notes à transmettre aux lots suivants.

## Depuis WP03 (7e347655)
- WP09 : ajouter `edge_reference_change` à `tests_offline_rights.sql` (liste figée) ; `migrate.ts` : `CASHLESS_EDGE_PASSWORD`, `CASHLESS_EDGEADMIN_PASSWORD` (à WP09, `interfaces.md` § 12) ; fonctions internes `edge_event_lock`, `edge_event_handover_open`, `edge_admin_audit` jamais accordées.
- WP15 : `revoke`, `rotate`, `swap`, `set_role`, `edge_register_snapshot_key` appellent `assert_tenant` : l'outil pose `app.operator_id` à chaque appel. Noms entérinés : alerte `EDGE_ROLE_CHANGED`, audit `EDGE_SNAPSHOT_KEY_REGISTERED`. Une seule clé de snapshot `ACTIVE` par passerelle ; rotation : à trancher si besoin.
- WP25 : concurrence réelle de deux `register` et envoi réel de `pg_notify('edge_alert')` à prouver.
- Relecture humaine : `0058` en entier.

## Depuis WP02 (292e3923, ca2b07c5)
- `verifyChain` reste dans l'API ; `request-signature.ts` non déplacé : WP19 tranche (adaptateur sur les mêmes vecteurs, ou déplacement à signaler).
- WP13, WP16 : partir de la lane-b ; liens `node_modules/@cashless/shared-rules`.
- Relecture humaine : `packages/shared-rules/src/edge-content.ts`, `edge-chain.ts`.
- `npm ci --ignore-scripts` dans le checkout principal après la fusion.

## Relecture de WP03 (approuvé)
- WP09 (`tests_edge_rights.sql`) : ajouter des cas inter-prestataires pour `rotate`, `swap`, `set_role`, `edge_register_snapshot_key` (retirer `assert_tenant` ne ferait aujourd'hui échouer aucun test) ; isolation réelle de `edge_reference_change` ; retrait des droits par défaut de `cashless_app` sur `edge_gateway` ET `edge_reference_change`.
- Mineurs consignés : `touch_edge_gateway` (passerelle inconnue sans effet, autre prestataire `no_data_found` : oracle faible) ; `register`/`rotate` 23505 sur empreinte prise (outil d'administration seul).
- Matrice d'acceptation : à tenir au fil des lots (orchestrateur), critères de WP03 : FR-002, FR-031 (partie base), FR-037 (partie base), C-009.

## Relecture de WP01 (approuvé, 628487f7)
- WP25 : brancher `check:stability` et `check-baseline-decision.mjs` en CI. Consigner une ligne réelle `Décision du porteur : 05/11/2026 ADR-nnn` pour la référence, avant la fusion. Resserrer `check-baseline-decision.mjs` : exiger la ligne dans le dernier commit qui touche la référence, ou ajoutée au fichier d'ADR par rapport à `main` (aujourd'hui toute ligne ancienne suffit).
- La liste blanche épingle le SHA-256 de chaque sous-arbre ajouté : toute retouche d'un schéma `Edge*` exige une décision du porteur sur `contract-baseline.json`.
- Relecture humaine : `tools/contract-stability/contract-baseline.json`, `check.mjs`.

## Depuis WP04 (f4896911)
- **WP08** : un journal `edge_reference_change` vide pour un grand livre fait REFUSER l'accord (échec fermé). Prévoir une reprise de l'existant ou une ligne d'amorce par grand livre, sinon aucun premier accord ne passe. Test obligatoire.
- WP09 : `fail_edge_grant`, `request_edge_release` du kit sans enveloppe : vérifier leurs droits ; `edge_grant_authority`, `fail_edge_release` à `cashless_app` ; `edge_stuck_handovers` au rôle de maintenance ; internes `edge_bind_gateway`, `edge_lock_handover` jamais accordées.
- WP11 : l'audit `EDGE_AUTHORITY_*` est à l'API ; `force_central_authority_approved` ne contrôle pas `gateway_confirmed_offline` : la route l'exige. `begin_cash_close` lève `CL029` sous `EDGE` : la réponse doit être `409 CONFLICT_STATE` sans changer le sens de `CL029` pour les autres cas.
- WP12 : handover étranger ou inconnu = `CL013`, message identique.
- WP25 : concurrence réelle sur les verrous, livraison réelle du `NOTIFY`, consigner `begin_cash_close` (comportement nouveau hors `/edge/*`, décision 6).
- Renforcements à consigner : `edge_complete_release` exige la même déclaration qu'au début du rendu ; accusé à position nulle refusé ; approbations inutilisables `42501`.
- Relecture humaine : `begin_cash_close`, `edge_grant_authority`, `force_central_authority_approved`, `edge_ack_handover`, `edge_complete_release`.

## Depuis WP05 (686dedae)
- WP09 : accorder à `cashless_edge` `edge_record_seq`, `edge_sync_batch_begin`, `edge_sync_batch_result`, `edge_sync_batch_finish` ; internes `edge_assert_session_gateway`, `edge_ledger_of_gateway` jamais accordées ; `tests_offline_rights.sql` : `edge_reference_change`, `edge_sync_batch`, `edge_sync_batch_result` ; T040 prouve la garde à connexion réelle.
- WP13 : `edge_sync_batch_finish('DONE')` exige un résultat par numéro, un lot partiel se clôt `ABANDONED` ; `begin` ne vérifie pas que `edge_seq_from` suit le registre : à contrôler en WP13.
- Orchestrateur : `apps/api/test/.../topup-cash-split.spec.ts` écrit en `EDGE_SYNC` : confirmer qu'il reste vert à la batterie.
- Toute migration ultérieure qui remplace `post_transaction` doit partir de `0060`, pas du schéma.
- Relecture humaine : `post_transaction` (garde), `edge_record_seq`, contrainte de registre remplacée.

## Relecture de WP04 (approuvé)
- **WP11, obligatoire** : `force_central_authority_approved` n'écrit pas `EXECUTED` et ne contrôle pas `expires_at`. Sûr seulement si elle est appelée par `definition.execute` du service d'approbation (`apps/api/src/approval/approval.service.ts:116-145`), qui contrôle l'expiration, exécute sous point de sauvegarde et passe à `EXECUTED`. L'enregistrer comme action `FORCE_CENTRAL_AUTHORITY` de ce service, aucun autre appelant, test de non-réutilisation sur un second cycle de bascule.
- **WP08, obligatoire** : amorce du journal par grand livre, voir notes de WP04.
- Mineurs consignés : `begin_cash_close` prend le verrou d'autorité partagé après le solde, alors que `post_transaction` prend l'autorité d'abord : cycle théorique, résolu par le détecteur (40P01, annulation propre), établi par lecture ; à regarder en relecture humaine. `begin_edge_release` rejoué avec une autre déclaration : `CL017` jusqu'à `fail_edge_release`. Accusé sur `TO_EDGE` `FAILED` ou `FORCED` : `CL013` plutôt que `CL015`.

## Relecture de WP16 (rejet n° 1, 06/11/2026)
- Bloquant : faux du port matériel sans persistance entre processus (`request` puis `enroll` : `KEY_MISMATCH` ; reprise
  après `SIGKILL` impossible). Correction : fichier de clés de développement (T072, `0600`, refusé en production).
- Renforcements demandés : contrôles du serveur et `evaluateProviderRules` aussi pour `request`/`enroll` en production ;
  secret de test : mot de passe vide ou trivial refusé.
- **À consigner (porteur)** : `edge_app`, propriétaire unique, peut `DISABLE TRIGGER`/`DROP` sur `edge_op`,
  `edge_audit`, `edge_authority` (plan : rôle unique) ; aucune entrée `POINTS_OUVERTS`/ADR.
- **WP20** : `enroll` exige que `client_cert_pem` porte la clé `batch` non exportable, alors que
  `GATEWAY_CENTRAL_CLIENT_KEY_FILE` (§ 8) suppose une clé privée en fichier : signer le handshake par le port, ou
  certificat distinct. Contradiction à soumettre au porteur.
- **WP17** : borner `observeCentral` (une date centrale lointaine fige `time_floor`) ; `epoch` et `highest_epoch_seen`
  peuvent reculer en `UPDATE` ; écouteur d'administration en boucle locale seulement en production.
- **WP15** : formats attendus par WP16 (pas de `FORMATS.md`) : clés en SPKI DER base64url, `agreement_public_key` en
  point brut de 65 octets, `site_order_keys` en PEM SPKI ou SPKI base64, P-256.
- **WP25** : bancs de reprise dépendants du fichier de clés de développement.

## Relecture de WP16 (approuvé au cycle 2, 06/11/2026, commits e8b31c8a, bc53b1ab)
- 134/134 Jest réels sur `cashless-platform-pg17` (5433). Les tests du cycle 2 de l'implémenteur avaient tourné sur la
  base de l'API du porteur (conflit de port, réglé : API du porteur sur 5434).
- Mineurs du fichier de clés de développement (`GATEWAY_DEV_KEY_FILE`, faux refusé en production), **soumis au
  porteur (consigner ou corriger)** : (1) `.tmp` à nom fixe, mode non forcé s'il existe, lien symbolique suivi →
  nom unique, `wx`, `fchmod 0600` ; (2) écritures concurrentes de deux processus : mise à jour perdue (pas de verrou) ;
  (3) `insideGitRepository` sans `realpath`.
- WP25 : fichier de clés dans un répertoire privé, jamais deux processus en parallèle sur le même fichier.
- WP20 : contradiction clé TLS client / clé `batch` toujours à soumettre au porteur.
- Nouveau réglage `GATEWAY_DEV_KEY_FILE` : complément de `interfaces.md` § 12.9 (non modifié).

## Relecture de WP06 (rejet n° 1, 06/11/2026, commit 64f88a9d)
- pgTAP réel (5433) : `tests_edge_post_transaction` 157/157 et suites voisines vertes ; la suite du grand livre complète
  reste à passer par l'orchestrateur.
- B1 (argent) : plafond horaire contourné par des `occurred_at` décroissants (4 000 000 perdus pour P_max 1 500 000).
- B2 (droits) : `edge_platform_setting` écrivable par `cashless_app` (droits par défaut + drapeau local posable).
- Renforcements demandés : `REVERSAL`/`VOID` bornés au cycle de la passerelle ; borne des montants de `p_fee_lines`.
- WP07 : réutiliser `edge_record_rejection` ; ordre des verrous événement, autorité, lignes, soldes.
- WP08 : `pack_delay_seconds` par `edge_setting_value`.
- WP09 : `edge_post_transaction` à `cashless_edge`, `set_edge_setting` à `cashless_edgeadmin` seul ; aucune aide, aucun
  droit sur la table.
- WP13 : l'API pose `tap.signature_verified`, `tap.pack_verified`, `device_batch_verified` (en écrasant le reçu) et
  fournit `p_fee_lines` du moteur central ; ordre des verrous avec `consume_tap`.
- WP25 : garder le test hostile décroissant comme test de borne.

## Correction de WP06 (cycle 2, commit a0ec9f2a)
- B1 : fenêtre horaire symétrique ]h−1 h ; h+1 h[ ; tests décroissant et mélangé ≤ P_max avec alerte.
- B2 : `REVOKE ALL` sur `edge_platform_setting`, mais `roles.sql`/`post-roles.sql` redonnent `arw` à `cashless_app`
  après les migrations ; parade : déclencheur qui refuse toute écriture hors propriétaire. **WP09 : retirer ce droit
  dans `post-roles.sql`**, avec un test.
- M1 : `REVERSAL` borné aux ventes `EDGE_SYNC` de la passerelle dans le cycle courant. M2 : frais bornés par les règles
  référencées ; recalcul exact à WP13.
- Relecture humaine : tout `0061`, surtout le déclencheur de B2 et la fenêtre de B1.

## Relecture de WP06 (approuvé au cycle 2, 06/11/2026)
- pgTAP réel : lot 177/177 ; batterie complète `packages/ledger-sql/tests` 56/57 fichiers, 4 897 tests. Seul échec :
  `tests_offline_rights` test 1 (liste figée des tables de `public`) : `edge_platform_setting`, `edge_reference_change`,
  `edge_sync_batch`, `edge_sync_batch_result` → **WP09** met la liste à jour.
- **WP09** : retirer `arw` de `cashless_app` sur `edge_platform_setting` dans `post-roles.sql` (test) ; vérifier l'ordre
  `roles.sql` (EXECUTE ON ALL FUNCTIONS à `cashless_app`) contre les `REVOKE` des lots de base.
- **Soumis au porteur (consigner ou corriger)** : (1) `ceiling_epoch` tronqué à la seconde, bornes ouvertes : deux ventes
  à 3 599,x s peuvent ne pas se voir ; (2) règle de frais citée contrôlée sur l'opérateur et le bénéficiaire seulement
  (ni portée, ni période, ni payeur) : une passerelle hostile cite la règle la plus généreuse de l'opérateur, perte
  bornée par cette règle ; taxe en sus refusée à tort.
- WP13 : `p_fee_lines` du moteur central (règle active, bonne portée, bonne période).
- WP25 : tests hostiles décroissant et mélangé ; cas de la seconde de bordure.

## Relecture de WP17 (approuvé, 06/11/2026, commit bfc7aa90)
- Jest réel : `test/authority` 94/94, `test/startup` 134/134. Aucune fenêtre de double autorité trouvée.
- **Renforcement à faire (WP25 ou lot suivant de la passerelle)** : déclencheur `BEFORE TRUNCATE` sur `edge_authority`
  (TRUNCATE puis INSERT remet `epoch` à 0 sous `edge_app`) ; même classe que `DISABLE TRIGGER` : **à consigner**, avec la
  limite STALE → GRANTED_PENDING → ACTIVE en UPDATE directs (la base ne prouve pas l'accusé).
- **Soumis au porteur** : (1) borne d'horloge de 24 h jugée trop large (un central à −23 h fige l'horloge, ordres de
  10 min valables des heures) : recommandation, n'adopter un recul que de quelques minutes ; (2) `REPLICATION_CATCH_UP`
  bouchon en échec fermé, non refusé au démarrage en production : recommandation, le refuser explicitement jusqu'à
  WP18, avec test ; (3) format des ordres à deux personnes (JSON plat, JCS, ES256 `r||s`, 10 min + 60 s, nonce
  unique) et détention des clés de site ; une même personne détenant deux clés n'est pas détectable.
- Mineurs : `s` haut accepté (ES256 malléable, sans effet, commentaire trompeur) ; contrôle `gateway_id` dans
  `localUnstale` et non dans `verifyTwoPersonOrder` (**WP24** doit le refaire) ; écouteur d'administration sans limite
  de débit sur les refus audités ; réponse du central non recoupée (mTLS suffit).
- Écarts à signaler aux contrats : `edge-0002`, `central_confirmed_epoch`, audits `SITE_ORDER_*`,
  `CLOCK_CENTRAL_OUT_OF_BOUNDS`, `REVOKED_SEEN`, `ACK_REFUSED_CLOCK` ; `assertCanDebit(requestEpoch, tx?)`.
- **WP18** : remplacer `unavailableCatchUp` par le service de réplication ; le curseur atteint le filigrane avant
  l'accusé.
- **WP20** : fournir `DRAIN_SIGNAL`, appeler `notifyQueueDrained` ; verser l'ordre local à l'audit du central au retour
  du lien (B.8).
- **WP21/WP22** : `assertCanDebit` avec le `tx` de l'opération ; `recover` avant `listen` ou refus tant qu'il n'a pas
  rendu la main.
- **WP16/WP25** : refuser en production l'absence de `centralUrl` ou du certificat (sinon `link_state` reste ISOLATED et
  la levée locale reste possible lien sain).

## Relecture de WP07 (rejet n° 1, 09/11/2026, commit 038f1d69)
- pgTAP réel (`cashless_wp07`) : lot 116/116, suites `tests_edge_*` et `tests_cash_sessions` vertes.
- B1 (argent, réglementaire) : `occurred_at` non borné dans 0062 ; `wallet_topup_headroom` dépend de la date :
  plafond mensuel contourné (4 × 5 000 → 15 000 crédités), dates 1999/2099 écrites au journal. Borner comme 0061.
- Mineurs : M1 aucun test d'autorité (non EDGE, sans handover, TO_CENTRAL RELEASING) ; M2 clé d'origine déjà au
  registre → 23505 après écriture (WP13/WP14) ; M3 `api_idempotency` sans filtre `scope`, `LIKE 'deposit:…'` ambigu ;
  M4 recharge sans plafond unitaire (9e11 accepté) : **soumis au porteur**.
- WP09 : n'accorder que les 3 fonctions `edge_*` publiques (jamais `edge_counter_op`, `edge_open_replay_failed`).
- WP12/WP13 : DUPLICATE/VOID/REJECTED+EDGE_REPLAY_FAILED ; seule la caution écrit en attente (S-ATTENTE).
- WP22/WP25 : la fermeture de caisse explique l'excédent par les anomalies `EDGE_REPLAY_FAILED`.
- Relecture humaine : `0062_edge_counter_ops.sql` en entier. Constats : `rapports/feedback/wp07-cycle1.md`.

## Depuis WP08 (9c1220f6, en relecture)
- Amorce : déclencheur `edge_ref_ledger` (grand livre neuf) et `edge_ref_backfill` (existant), testés.
- Garde « propriétaire seul » passée en déclencheur d'instruction (renforcement).
- **Casse 10 suites voisines** : (a) « pending trigger events » (déclencheurs du journal différés) dans `tests_catalog`,
  `tests_configuration`, `tests_enrollment_event_state`, `tests_offline_anomalies` ; (b) `tests_edge_gateway` 73 et
  `tests_edge_handover` supposent un journal vide (contredit par l'amorce) ; (c) inventaires
  `tests_definer_trigger_writers` 16, `tests_offline_rights` 1, `tests_payment_rights` 56, `tests_payments` 6.
- `devices[].token_family` à null : pas de colonne `edge_exposed` sur `device_refresh_token` (OP-N102, décision 11) :
  **à confirmer par le porteur**.
- WP09 : `deposit_edge_pwd_pack_key` à `cashless_tagkeys` ; liste des droits dans l'en-tête de 0063.
- WP25 : horizon non sûr (écriture en vol), refus hors REPEATABLE READ, concurrence du journal : deux connexions réelles.
- Relecture humaine : `edge_replication_page`, `deposit_edge_pwd_pack*`, `edge_ref_trigger`, déclencheurs des tables chaudes.

## Correction de WP07 (cycle 2, commit d72762ec)
- B1 : date bornée [début du cycle − 15 min ; maintenant + 15 min] pour la marge ET l'écriture (renforcement par rapport
  à 0061, qui écrit la date brute) ; date brute en métadonnée `origin_occurred_at` ; mutation vérifiée (106-111).
- M1 : tests d'autorité ; `TO_CENTRAL` `RELEASING` accepté par le contrôle d'autorité (vidange) : à confirmer en relecture.
- M3 : `api_idempotency` filtré sur `scope` ; caution par clé exacte.
- M2 (WP13/WP14) et M4 (porteur) non traités.

## Depuis WP18 (af36ea41, en relecture)
- Bouchon `unavailableCatchUp` retiré ; `REPLICATION_CATCH_UP` fourni par `ReplicationModule` ; la garde de démarrage
  refuse en production un fournisseur absent ou bouchon (`production-guard.spec.ts`).
- **Migrations de la passerelle** : `edge-0002` (WP17), `edge-0003_replication_columns` (WP18, colonnes reçues du flux,
  `edge_media.media_id` nullable) : acceptée sous réserve de la relecture (décision 29). Prochain numéro : `edge-0004`,
  à demander à l'orchestrateur (aucun lot ne le prend d'office).
- Contradictions signalées : `media_id` NOT NULL (data-model B.3) absent du flux ; champs du flux sans colonne
  d'`edge-0001` ; `usable_on_edge` dérivé (session OPEN ouverte avant `activated_at`, R-24, restrictif).
- **WP23** : `pwd_pack_key` en une ligne `current` ; colis et clé en JSON UTF-8 dans des `bytea`.
- `GATEWAY_REPLICATION_INTERVAL_MS` (200-2000, défaut 1000) : complément de `interfaces.md` § 12.9.
- Relecture humaine : `page-applier.ts`, `delta-purge.ts`, `pwd-pack-key.ts`, `edge-0003_replication_columns.sql`.

## Relecture de WP07 (approuvé au cycle 2, 09/11/2026)
- 127/127 ; voisines vertes ; mutation de la borne : 106-111 en échec. `RELEASING` accepté : conforme (vidange, FR-022/023).
- Mineurs consignés : pas de test au bord exact des 15 min ; cycle à cheval sur deux mois (identique à 0061).

## Relecture de WP08 (rejet n° 1, 09/11/2026) — constats : `rapports/feedback/wp08-cycle1.md`
- 48/58 suites vertes. Bloquant : 7 suites cassées à corriger par WP08 (hors carte) ; `tests_offline_rights` à WP09.
- Majeur : mode différé de production non testé (toute la suite en IMMEDIATE) : test à deux connexions (dblink).
- `migrate.ts` passe toutes les migrations en une transaction : règle DDL de la décision 28.
- WP09 : `roles.sql` redonne `arw` à `cashless_app` sur les 5 tables et la vue `edge_device_seq_acked` ; retirer le
  SELECT sur `edge_pwd_pack`, `edge_pwd_pack_key`, `edge_staff_token_audit` ; `deposit_edge_pwd_pack_key` à
  `cashless_tagkeys`.
- WP13 : rejeu sur 40001 (`reference_applied_seq`) et 23505 (REPEATABLE READ).
- Relecture humaine : `edge_ref_ctx_enter` (modifie `app.operator_id`), drapeau `app.edge_journal_write`.

## Relecture de WP18 (rejet n° 1, 09/11/2026) — constats : `rapports/feedback/wp18-cycle1.md`
- Jest réel 264/264, `tsc` propre. Atomicité page + curseurs, `catchUpTo` et filigrane : sans défaut.
- B1 (argent) : `delta-purge.ts` purge sur le curseur global, une page non finale surestime un solde (1000 lu, 600 vrai) ;
  même défaut dans `onOpResult`. B2 (aucun faux en production) : garde muette si `catchUp` est absent de l'appel.
- Mineurs : canari tautologique (M1) ; colis et clé scellée gardés après PRIMARY → STANDBY (M2, purge au cycle 2,
  renforcement) ; `usable_on_edge` vrai si `activated_at` NULL (M3) ; `media_id` NULL (M4) ; horizon qui saute devant (M5) ;
  `kyc_verified` absent (M6) ; `applyHook` public (M7).
- WP20 : `onOpResult` corrigé avant appel. WP21 : `media_id NULL` non utilisable. WP24 : réutiliser la purge au
  changement de rôle de WP18.

## Correction de WP08 (cycle 2, commit 0ba00816)
- 58/59 suites vertes sur `cashless_wp08` (seule `tests_offline_rights`, WP09) ; `tests_psp_configurations` instable
  (horloge) une fois. Nouveau `tests_edge_replication_deferred.sql` : mode différé prouvé à trois connexions réelles.
- Retouches hors carte de tests : `SET CONSTRAINTS ALL IMMEDIATE` (4 suites), amorce dans `tests_edge_gateway` et
  `tests_edge_handover` (`session_replication_role=replica`), listes `tests_definer_trigger_writers`, `tests_payments`,
  `tests_payment_rights`.
- Décision 23 : `edge_exposed` ajouté, `token_family` rendu aux PRIMARY seulement. Rien ne le pose à true :
  **fonction confiée à WP09 (`0064`), appel par l'API confié à WP12** (prompts mis à jour).
- WP09 : `cashless_app` garde `arw` sur la vue `edge_device_seq_acked` (à fermer).
- Relecture humaine : branche `device_refresh_token` d'`edge_ref_trigger`, rendu `token_family`.

## Correction de WP18 (cycle 2, commit 1ee50af4)
- Jest 276/276, `tsc` propre. B1 : purge par portefeuille, globale seulement à la page finale (sous-estimation
  possible pendant une passe, jamais surestimation) ; mutation : 2 échecs. B2 : `catchUp` obligatoire, test par
  `assertRuntimeSafe`, mutation : 1 échec.
- M2 : `purgeKeyMaterial(tx)` (`src/replication/pwd-pack-key.ts`) à la perte de PRIMARY : **WP24 la réutilise**.
- M3 : déclencheur `edge_cash_session_activation` (edge-0003). M4 : CHECK `media_id`. M6 : `kyc_verified` absent = faux.
  M7 : point d'arrêt dans `src/testing/apply-hook.ts`, inerte en production. M5 : signalé (WP25).
- WP21 : `media_id IS NULL` non utilisable.

## Relecture de WP08 (approuvé au cycle 2, 09/11/2026)
- 58/59 suites (seule `tests_offline_rights`, WP09) ; mode différé prouvé (8 tests, 3 connexions) ; nettoyage vérifié,
  batterie rejouée après la suite identique. Garde `kitty-specs` levé par `align-lane.sh h`, sans `--force`.
- Détails : en-tête de 0063, deux lignes > 100 car. ; `tests_payments` 6 exclut `edge_ref_trigger` partout (borné par
  `tests_definer_trigger_writers`).

## Relecture de WP18 (approuvé au cycle 2, 09/11/2026)
- Jest 276/276, `tsc` propre ; trois mutations (purge globale, `onOpResult` global, `catchUp` retiré) échouent.
- Mineurs consignés : `apply-hook.ts` compare `NODE_ENV === 'production'` au lieu de `nodeEnv()` de shared-rules
  (**WP24** : aligner) ; B1 suppose l'horizon `to_posting_id` complet (M5, **WP25**) ; delta ACCEPTED tardif sous-estimé
  jusqu'à la page finale suivante.
- Relecture humaine : `delta-purge.ts`, `pwd-pack-key.ts`, `startup-guard.ts`, `bootstrap.ts`, déclencheur d'`edge-0003`.

## Depuis WP09 (95462f42, en relecture)
- §9 de `post-roles.sql` : `cashless_edge` (17 fonctions, vue), `cashless_edgeadmin` (6), retraits de `cashless_app`,
  internes jamais accordées (test figé) ; `0064` (décisions 21, 23, 25) accepté par le garde de périmètre.
- `topup-cash-split.spec.ts` (cas `EDGE_SYNC` sous `cashless_app`, refusé par la garde de 0060) : adaptation confiée à
  WP09 (T041), en cours.
- Droits au-delà de data-model A.1 : `deposit_edge_pwd_pack_key`, `edge_sync_batch_finish`, `edge_gateways_awaiting_pack`.
- **WP10** : `DATABASE_URL_EDGE`, `DATABASE_URL_EDGEADMIN` dans `test/support/db.ts` ; `migrate.ts` :
  `CASHLESS_EDGE_PASSWORD`, `CASHLESS_EDGEADMIN_PASSWORD` (CI : WP25).

## Depuis WP19 (d7038235, en relecture)
- `request-signature.ts` : adaptateur propre à la passerelle, parité prouvée avec le central. `edge-0005` entérinée.
- Contradictions : `IDEMPOTENCY_KEY_REUSED` 409 (contrat) contre 422 (prompt) ; `TokenResponse.refresh_token` = jeton
  présenté à l'identique (décision 11). `structured-headers`, `yaml` déclarés (déjà au lockfile).
- **WP23** : jetons facultatifs `LOCAL_SNAPSHOT_STATE`, `GATEWAY_SNAPSHOT_KEYS` (sinon `offline_enabled` false).

## Depuis WP20 (6d6077d8, en relecture)
- Décisions 19 (TRUNCATE refusé, plus `edge_chain_head`, `edge_outgoing_batch`), 20, 24 faites.
- **Décision 22 non faisable sans dépendance** : `GATEWAY_CENTRAL_CLIENT_KEY_FILE` reste : **soumis au porteur**.
- `LOCAL_UNSTALE` non versable au central (aucun champ dans `EdgeStaffTokenAudit`) : **soumis au porteur**.
- WP18 doit fournir `DELTA_PURGE` à l'intégration (repli : n'annule que REJECTED/VOID). **WP22** : forme de `detail`
  de `STAFF_TOKEN_TOLERATED` (`staff-audit-feed.ts`).

## Relecture de WP20 (rejet n° 1, 09/11/2026) — constats : `rapports/feedback/wp20-cycle1.md`
- 306/306, `tsc` propre ; file, vidage, résultats, points d'arrêt, `edge-0004`, décisions 19, 20, 24 : sans défaut.
- Bloquant : durcissement de la clé TLS (décision 32) absent de `config.ts`/`central-client.ts`.
- Mineurs : `withLock` (verrou périmé repris deux fois) ; `DELTA_PURGE` facultatif, oubli silencieux à l'intégration ;
  décision 20 : un central en avance (< 24 h) relève `time_floor`, le central juste est ensuite refusé (limite).

## Relecture de WP19 (approuvé, 09/11/2026)
- 306/306, `tsc` propre ; mutations des preuves et des jetons tuées (deux survivants équivalents). Garde `kitty-specs`
  levé par `align-lane.sh s`, sans `--force`.
- ETag = SHA-256 JCS hors `server_time` (comme le central, au lieu de `config_id` du prompt) : écart signalé, accepté.
- Mineurs : plancher de 60 ms des refus (oracle de temps sous charge) ; lignes > 100 car. (Prettier à la fusion).
- **WP21, WP22, WP23** : appeler `consumeOrThrow` (mode `operation`) pour le contrôle d'horloge de `created`.
- Relecture humaine : `device-proofs.guard.ts`, `request-signature.ts`, `device-token.service.ts`, `refresh.service.ts`.

## Correction de WP20 (cycle 2, commit 88b008d0)
- Décision 32 : `src/config/client-key-file.ts` (droits, propriétaire, lien symbolique, répertoire ; clé publique comparée
  aux 4 usages du port ; canari) ; contrôle refait dans `loadTrust`.
- `DELTA_PURGE` obligatoire en production (`deltaPurgeProvided`) ; `child-main.ts` simule WP18 par `defineProperty` :
  **à retirer à l'intégration de WP18**.
- Verrou du faux port à jeton (`pid:jeton`, reprise sérialisée par `.break`).
- Retouches hors carte confirmées par l'orchestrateur : `bootstrap.ts`, `startup-guard.ts`, `fake-hardware-keystore.ts`.
- Limite de la décision 20 (central en avance relève `time_floor`) : consignée ici, à reprendre en WP25.

## Relecture de WP09 (approuvé, 09/11/2026)
- 62/62 pgTAP, Jest 7/7 et 9/9 ; ACL identiques après deux `migrate` ; droits vérifiés par `SET ROLE` réel ;
  mutations de droits et d'`assert_tenant` tuées. Garde levé par `align-lane.sh i`, sans `--force`.
- Mineurs, **WP25** : borne haute (+3 600 s) de la fenêtre non testée ; échec fermé si le réglage de plafond de recharge
  est absent non testé ; repli `ceiling_epoch` de 0061 non testé.
- **WP10, obligatoire** : `migrate.ts` pose `CASHLESS_EDGE_PASSWORD`, `CASHLESS_EDGEADMIN_PASSWORD` (sinon rôles `LOGIN`
  sans mot de passe en production : refus au démarrage si absents en production, test) ; `DATABASE_URL_EDGE`,
  `DATABASE_URL_EDGEADMIN` dans `test/support/db.ts`. CI : WP25.
- Relecture humaine : `post-roles.sql` §9, `0064_edge_fixes.sql`.

## Relecture de WP20 (rejet n° 2, 09/11/2026) — constats : `rapports/feedback/wp20-cycle2.md`
- 338/338, `tsc` propre ; contrôles de la décision 32 et règle `DELTA_PURGE` : mutations tuées sur les fonctions pures.
- Bloquants : (1) câblage de `bootstrap.ts` non prouvé (`child-main.ts` force `hasDeltaPurge`, aucun processus réel avec
  clé client égale à une clé du port) ; (2) TOCTOU : contrôle par `lstat`, lecture par chemin (attendu : `O_NOFOLLOW`,
  `fstat` et lecture sur le même descripteur).
- Mineurs : mutants survivants (propriétaire du fichier et du répertoire, `isFile`, contrôle de `loadTrust`) ;
  `withLockForTest` exporté sans condition.

## Depuis WP10 (91dbf7dd, en relecture)
- `EdgeMtlsGuard`, `@EdgeAuth()`, `assertOwnGateway` ; `getCurrentEdgeHandover` (attente longue, NFR-007 < 1,5 s) ;
  lecture `edgeMtls` de `getDebitAuthority` (T045 bis, `edge/control/`). `migrate.ts` pose les mots de passe
  `cashless_edge`/`cashless_edgeadmin` (refus en production s'ils manquent) ; `db.ts` : `EDGE_URL`, `EDGEADMIN_URL`.
- Hors carte non demandées : `tools/dev-db/env.sh`, `db/notify-listener.ts` (LISTEN unique), `architecture.spec.ts`.
- **WP17 (côté passerelle), à confirmer** : `wait > 0` compare à l'état lu à l'entrée (premier appel non immédiat ;
  `wait=0` l'est) ; fin d'attente = `200` avec l'état courant, jamais `204`.
- Faux `EDGE_CA` en mémoire seulement, refusé par `assertProcessIsSafe` (OP-N100).
- Relecture humaine : `main.edge.ts`, `edge-mtls.guard.ts`, `edge-identity.service.ts`, `edge-gateway.ts`, `bootstrap.ts`
  (écouteur `edge`), `migrate.ts` (mots de passe).

## Relecture de WP10 (rejet n° 1, 09/11/2026) — constats : `rapports/feedback/wp10-cycle1.md`
- 62/63 edge, 235/235 non-régression, `tsc` propre ; mTLS, isolation, faux `EDGE_CA`, `migrate.ts` : sans défaut.
- Bloquant : attente abandonnée avant l'armement de `close` non détectée (1 à 5 écouteurs résiduels sur 50).
- Mineurs : attentes simultanées non bornées par passerelle ; aucun test n'énumère les routes du processus edge
  (**WP12 et suivants** : à couvrir) ; `/v1/health` publique sur l'écouteur edge (info).
