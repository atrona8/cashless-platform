# Prompts à envoyer — Cashless Platform (V1)

La documentation se met à jour automatiquement après `/spec-kitty.plan` et `/spec-kitty.review` grâce au skill
`spec-kitty-docs-maintain` installé dans ce projet — rien à faire de plus pour ça tant que ces missions sont
pilotées via les slash-commands. Si tu pilotes une mission autrement (boucle CLI bas niveau, autre skill
d'orchestration), invoque `spec-kitty-docs-maintain` toi-même après le plan et après la review — voir `CLAUDE.md`
pour la procédure.

**Avant de commencer.**
- Syntaxe vérifiée le 07/10/2026 sur Spec Kitty 3.2.7 (`~/.claude/commands/spec-kitty.*.md`, `spec-kitty --help`).
- Le slug indiqué pour chaque mission est **proposé** : le slug réel est celui que renvoie `/spec-kitty.specify`
  (`mission create`). Remplace-le dans les commandes suivantes de la mission s'il diffère.
- `/spec-kitty.review` s'applique à un work package (`WP##`) ; la boucle `spec-kitty next` enchaîne implémentation
  et review des WP. Lance `/spec-kitty.review` à la main pour un WP en attente de review si besoin.
- Le dépôt n'a pas encore de remote : `spec-kitty merge` sans `--push` tant qu'aucun remote n'est configuré.
- Chaque mission lit d'abord `README.md` (kit), `docs/SPECIFICATION.md`, `PRD.md` ; la règle de priorité de
  SPECIFICATION §0.3 s'applique, et les fichiers `.sql` générés ne se modifient jamais à la main.

---

## Mission 1 — Fondations du grand livre et de l'API

- [ ] /spec-kitty.specify Fondations du système cashless (SPECIFICATION §2, §5, §10.1-10.2, §13.1, §14.2 S21, §16 critères 1 à 3). Mettre en place le monorepo imposé (§2.1, npm/pnpm workspaces), la CI (`.github/workflows/ledger-tests.yml` : schéma, `roles.sql`, `pg_prove` sur les 400 + 64 assertions sous PostgreSQL 17) et l'outillage local (pgTAP absent du PostgreSQL 17 Windows actuel ; Docker absent). Mettre en place les migrations de `packages/ledger-sql` à partir du schéma de référence. Créer le squelette NestJS de `apps/api` : connexion au rôle `cashless_app`, `set_config('app.operator_id', …, true)` en début de chaque transaction, traduction SQLSTATE → `ProblemCode` en problem+json (RFC 9457) sans message SQL brut, magasin d'idempotence applicatif (S21 : `Idempotency-Key`, `Idempotency-Replayed`, `IDEMPOTENCY_KEY_REUSED`, `IDEMPOTENCY_KEY_IN_PROGRESS`), `X-Request-Id`, `Accept-Language`. Écrire le moteur d'écritures (§5.4) : un constructeur par type de transaction, seul appelant de `post_transaction`, calculs en `bigint` (§5.5) avec les 19 cas normatifs en tests TypeScript (identiques à `moteur_ecritures_reference.py`), refus des types non acceptés selon le statut de l'événement (§12.1). Rejouer `scenario_reference.json` par les constructeurs dans un test d'intégration : soldes exacts après la transaction 23 et en fin de clôture, second rejeu sans aucune nouvelle transaction. Types TypeScript générés depuis `openapi.yaml`, jamais écrits à la main.
- [ ] /spec-kitty.plan Stack imposée : NestJS (TypeScript), PostgreSQL 17 minimum (AWS RDS en production), entiers `bigint` sans flottant. Contraintes : point d'écriture unique `post_transaction` (le rôle applicatif n'a aucun INSERT/UPDATE/DELETE sur `journal_transaction`, `posting`, `account_balance`) ; RLS forcée, `set_config` de portée transaction (jamais `SET` de session, pool de connexions) ; rôle applicatif avec `transaction_timeout = 60s`, `statement_timeout = 30s`, `idle_in_transaction_session_timeout = 10s` ; fonctions internes jamais rendues au rôle applicatif (§13.1) ; schéma de référence = point de départ des migrations, tests pgTAP toujours verts ; générateurs `gen_tests.py`/`gen_golden.py` modifiés, jamais les `.sql` générés. Environnement local : Windows 10, Node 22, PostgreSQL 17 sans pgTAP, pas de Docker. Latence cible serveur seul p95 ≤ 200 ms (§15).
- [ ] /spec-kitty.tasks
- [ ] spec-kitty next --agent claude --mission fondations-grand-livre
- [ ] /spec-kitty.review --mission fondations-grand-livre
- [ ] /spec-kitty.accept --mission fondations-grand-livre
- [ ] spec-kitty merge --mission fondations-grand-livre

## Mission 2 — Identité, rôles et double validation

- [ ] /spec-kitty.specify Identité des personnes, rôles et double validation (SPECIFICATION §3.2, §10.3, §13.3, §14.2 S1 et S3, ADR-74). Tables `app_user` et `role_assignment` (rôles `PLATFORM_ADMIN`, `OPERATOR_ADMIN`, `ORGANIZER_ADMIN`, `SUPERVISOR`, `CASHIER`, `MERCHANT_ADMIN`, `VENDOR`, `CUSTOMER`, avec portée plateforme, prestataire, organisateur, événement, commerçant) ; journal d'audit en ajout seul (`audit_log` : acteur, rôle, action, objet, avant, après, valideur, date, origine) pour toute action d'administration et toute action à deux. Authentification par JWT court et jeton de rafraîchissement ; le prestataire est toujours déduit de l'identité. Jeton d'approbation sur place au guichet (`X-Approval-Token` : 5 min, usage unique par `jti`, `act` = operationId, `act_hash` = SHA-256 de la requête canonique JCS, `sub` ≠ appelant, rôle vérifié ; `403 APPROVAL_REQUIRED` / `APPROVAL_INVALID`). Demande puis approbation au back-office (`approval_request` déjà au schéma, `decide_approval_request`, `202 Accepted`, `/approval-requests` liste, consultation, approbation avec exécution unique, refus avec note ; `409 APPROVAL_INVALID` sur `CL023`) ; un `approved_by` reçu dans un corps est ignoré. Le mécanisme d'exécution des actions est générique : chaque mission suivante y branche ses actions (`PAYOUT`, `WAIVE_SEQ_GAP`, etc.).
- [ ] /spec-kitty.plan Serveur d'identité OIDC derrière une interface (authentification renforcée pour le jeton d'approbation), faux fournisseur pour les tests. Migrations avec RLS forcée, `operator_id` et tests pgTAP par contrainte (§14.2). Rôles et valideur ≠ auteur déjà imposés par la base pour plusieurs actions : ne pas affaiblir ces contraintes. Test de cloisonnement entre prestataires dès cette mission.
- [ ] /spec-kitty.tasks
- [ ] spec-kitty next --agent claude --mission identite-roles-double-validation
- [ ] /spec-kitty.review --mission identite-roles-double-validation
- [ ] /spec-kitty.accept --mission identite-roles-double-validation
- [ ] spec-kitty merge --mission identite-roles-double-validation

## Mission 3 — Configuration, parties et événements

- [ ] /spec-kitty.specify Configuration et organisation des parties (SPECIFICATION §3.1, §4, §5.6, §12.1, §10.4). Gestion des prestataires (plateforme), organisateurs, commerçants et participations (`INTERNAL`/`EXTERNAL`, commission, droit de place et `pitch_fee_mode`), points de vente, événements (devise, `funds_holder` obligatoire, `issuer`, `identity_mode`, `activation_modes`, réglages des terminaux bornés §9.8, `cash_refund_single_max`, `refund_deadline`, `sync_deadline_hours`, plafonds carte, remboursement vers un autre numéro). Cascade de configuration versionnée plateforme → prestataire → organisateur → événement → participation, bornée par le profil de législation (refus à l'enregistrement avec un message qui cite la règle). Contrats versionnés `PLATFORM_OPERATOR` et `OPERATOR_ORGANIZER`. Règles de frais `fee_rule` pour les quatre flux. Création des grands livres et des comptes à la demande (§5.2). Passage des statuts d'événement par `set_event_status` uniquement, avec affichage des conditions et de leur état. Ajouter au contrat `openapi.yaml` les endpoints back-office correspondants (§10.4), puis régénérer les types.
- [ ] /spec-kitty.plan Les tâches de niveau plateforme (prestataires, profils de législation) utilisent un rôle de base distinct (§2.2). Valeurs par défaut provisoires (§17.2) codées et paramétrables, jamais présentées comme validées (plafonds Sénégal, TVA 18 %). Chaque transaction enregistre `config_version_id`, chaque ligne de frais `fee_rule_id`. Un contrat ne se modifie pas : nouvelle version.
- [ ] /spec-kitty.tasks
- [ ] spec-kitty next --agent claude --mission configuration-parties-evenements
- [ ] /spec-kitty.review --mission configuration-parties-evenements
- [ ] /spec-kitty.accept --mission configuration-parties-evenements
- [ ] spec-kitty merge --mission configuration-parties-evenements

## Mission 4 — Bracelets NFC (format, clés, lots, cycle de vie)

- [ ] /spec-kitty.specify Bracelets NFC côté serveur et bibliothèques de format (SPECIFICATION §7, §6.1, §6.4, §14.2 S19, ADR-36, ADR-56, ADR-57, ADR-59). `packages/tag-format` en TypeScript et en Dart : format B 1.0 (28 octets, CRC-32/ISO-HDLC, majeur inconnu refusé), message de dérivation SP 800-108, AAD et chiffrement AES-256-GCM de PWD‖PACK, code de rattachement (10 caractères, alphabet de 32) ; les deux implémentations reproduisent `vecteurs_test_bracelet.py`. Ports KMS (GenerateMac, GenerateDataKey, Decrypt) avec faux pour les tests. Service des clés de bracelet (`POST /media/auth-keys`, un seul Decrypt de DEK, effacement en mémoire), service de personnalisation (enregistrement `token_hash`, UID, signature d'originalité et son empreinte, chiffré, lot), contrôle quotidien sur 100 bracelets, rotation de DEK, `tag_key` et `retire_dedicated_key` puis désactivation KMS. Lots (`media_batch` : kind, clé partagée ou dédiée, préchargement, caution, réutilisation, cycle de vie, inventaire). Codes de rattachement générés à la commande, empreinte seule conservée, association à la personnalisation, limites d'essais, demandes en attente pour un bracelet approvisionné (`media_claim`, confirmation au guichet). `POST /taps` (`register_tap`, effets de sécurité validés dans une transaction séparée), activation, consultation, caution et rendu, restitution, remplacement (la caution suit le bracelet), espèces dues (`refund_cash_due`), liste noire et `reinstate_media` à deux.
- [ ] /spec-kitty.plan Rôles IAM séparés (§3.2, §13.2) : l'API publique n'a ni `kms:Decrypt` ni `kms:GenerateMac`. Les fonctions SQL des bracelets, lots et cautions font les règles ; NestJS les appelle sans les réimplémenter (§2.2). Mots de passe déchiffrés en mémoire seulement, puis effacés. Types Dart générés depuis `openapi.yaml`. Le code de lecture NFC du terminal n'est PAS dans cette mission.
- [ ] /spec-kitty.tasks
- [ ] spec-kitty next --agent claude --mission bracelets-nfc
- [ ] /spec-kitty.review --mission bracelets-nfc
- [ ] /spec-kitty.accept --mission bracelets-nfc
- [ ] spec-kitty merge --mission bracelets-nfc

## Mission 5 — Terminaux et paiement en ligne

- [ ] /spec-kitty.specify API des terminaux et encaissement en ligne (SPECIFICATION §8.1 à §8.3, §6.3, §7.6, §9.8, §14.2 S2, S5, S18, S24). Codes d'enrôlement à usage unique (portée événement, point de vente, mode ; `PAIRED_TPE` refusé `422 DEVICE_MODE_NOT_ALLOWED`), enrôlement avec clés ECDSA et ECDH P-256, unicité du `serial` parmi les terminaux non révoqués, rafraîchissement du jeton, révocation, configuration servie (`DeviceConfig`, `config_id`, `terminal_settings`), battement de cœur. Vendeurs avec code PIN (argon2id), vente attribuée au vendeur. Paiement en un seul aller-retour (`POST /payments` : `register_tap`, `post_transaction`, `consume_tap` dans la même transaction SQL), parcours en deux temps avec `tap_id`, refus `WALLET_BLOCKED`, annulation dans la fenêtre du terminal, numérotation `<serial>:<seq>`. Catalogue par point de vente (catégories, articles TTC, taux par article, libellés FR/EN) et `sale_line` copiée dans la transaction de la vente. Paiement par QR commerçant et QR client (60 s, nonce haché, toujours en ligne). Identification au guichet (`kyc_verification`, révocation à deux).
- [ ] /spec-kitty.plan Latence serveur seul p95 ≤ 200 ms, p99 ≤ 500 ms ; un seul aller-retour pour le paiement ; requêtes des terminaux signées par la clé du Keystore. Téléphone personnel : en ligne seulement. iOS : QR uniquement. Terminal `SUSPENDED` : envoie ses lots mais n'autorise plus ; `REVOKED` : refusé (`DEVICE_REVOKED`).
- [ ] /spec-kitty.tasks
- [ ] spec-kitty next --agent claude --mission terminaux-paiement-en-ligne
- [ ] /spec-kitty.review --mission terminaux-paiement-en-ligne
- [ ] /spec-kitty.accept --mission terminaux-paiement-en-ligne
- [ ] spec-kitty merge --mission terminaux-paiement-en-ligne

## Mission 6 — Recharges, caisses et PSP

- [ ] /spec-kitty.specify Encaissement de l'argent réel (SPECIFICATION §8.5, §11.1, §11.2, §5.3, §14.2 S14, S20, S26, S26b, ADR-63, ADR-70, ADR-72, ADR-77). Sessions de caisse (`cash_session` : ouverture, comptage, fermeture `CASH_CLOSE` avec écart au payeur du contrat, anomalie `CASH_DIFF`, dépôt `CASH_DEPOSIT`). Recharge en espèces (`TOPUP_CASH`, marge de recharge `wallet_topup_headroom`, découpage vers `L-ESP-A-RENDRE` hors ligne). Prise de caution due après chaque crédit (`take_deposit`, transaction distincte). Configurations PSP par organisateur et par moyen (S26, activation à deux, au plus une par défaut) et choix par événement (S26b, titulaire = détenteur des fonds, sinon `PSP_NOT_CONFIGURED`). Interface commune d'adaptateur PSP (initier, vérifier un webhook, interroger un statut, lire un relevé) ; adaptateurs Wave, Orange Money, PayDunya, Stripe, avec faux PSP tant que les accès de test manquent. Demande de recharge (`POST /topups/psp`), webhook signé stocké brut puis traité de façon idempotente (`TOPUP` et frais PSP au payeur `psp_fee_bearer`), interrogation planifiée puis `EXPIRED`, anomalies `PSP_MISMATCH` et `PSP_TOPUP_OVER_LIMIT`. Carte : 3-D Secure obligatoire, plafond par carte et par jour (`422 CARD_DAILY_LIMIT`), anomalie `CARD_VELOCITY`, contestations (`CHARGEBACK`, portefeuille bloqué, payeur selon `chargeback_bearer`).
- [ ] /spec-kitty.plan Secrets PSP dans AWS Secrets Manager, rattachés au détenteur des fonds, jamais partagés. Webhook inconnu ou invalide conservé et signalé, jamais ignoré. Clé d'idempotence des webhooks `<psp>:<id>`. Les taux PSP sont des `fee_rule` par configuration. Adaptateurs réels codés derrière l'interface, activés seulement après vérification des accès de test (action 11 de POINTS_OUVERTS).
- [ ] /spec-kitty.tasks
- [ ] spec-kitty next --agent claude --mission recharges-caisses-psp
- [ ] /spec-kitty.review --mission recharges-caisses-psp
- [ ] /spec-kitty.accept --mission recharges-caisses-psp
- [ ] spec-kitty merge --mission recharges-caisses-psp

## Mission 7 — Hors ligne (snapshots et lots)

- [ ] /spec-kitty.specify Fonctionnement hors ligne côté serveur (SPECIFICATION §9.1 à §9.6, `docs/sync_protocol.md` normatif, §14.1 S4 à S11). Politique hors ligne (`offline_policy` par organisateur, événement, terminal ; plafonds du prestataire ; `effective_offline_policy` ; affichage du risque maximal). Snapshots signés (en-tête JCS, ECDSA P-256 par KMS, `FULL`/`DELTA`, version croissante, nouvelle version en 60 s si changement et en 5 s après un blocage, mots de passe chiffrés par une clé de contenu enveloppée ECDH-ES P-256 par terminal, aucun envoi à un terminal révoqué). Lots (`POST /offline-batches` : numéros continus, 500 opérations et 1 Mio maximum, un lot en vol, signé et chaîné, traitement opération par opération dans l'ordre des seq, statuts `ACCEPTED`, `DUPLICATE`, `ACCEPTED_WITH_SHORTFALL`, `REJECTED`), registre des numéros, trous `SEQ_GAP` et levée à deux (`waiveSeqGap`), borne `CL021`, lot abandonné après 15 min. Conflits (§9.6 : part non couverte en `S-ATTENTE`, anomalies `OFFLINE_SHORTFALL`, `NON_COMPLIANT_OPERATION` avec porteur de la perte selon `provided_by`, `CLOCK_SKEW`, `SIGNATURE_MISMATCH`), contrôles de conformité sur la configuration détenue (`policy_in_force`), synchronisations tardives (`SYNC_DEADLINE_PASSED`, `LATE_OFFLINE_SYNC`). Import du journal d'un terminal révoqué (à deux).
- [ ] /spec-kitty.plan Les fonctions S6 à S13 du schéma de référence existent avec leurs tests : les appeler, ne pas les réécrire, les compléter par migration sans affaiblir les contrôles. Algorithme de signature dans l'en-tête (OP-N13 : vérifier Ed25519 dans KMS, défaut ECDSA P-256). Tests minimaux de `sync_protocol.md` §13 côté serveur (rejeu de lots, panne au milieu d'un lot, horloges faussées, bracelet bloqué pendant un isolement).
- [ ] /spec-kitty.tasks
- [ ] spec-kitty next --agent claude --mission hors-ligne-snapshots-lots
- [ ] /spec-kitty.review --mission hors-ligne-snapshots-lots
- [ ] /spec-kitty.accept --mission hors-ligne-snapshots-lots
- [ ] spec-kitty merge --mission hors-ligne-snapshots-lots

## Mission 8 — Passerelle locale

- [ ] /spec-kitty.specify Passerelle locale de site (SPECIFICATION §9.7, `docs/sync_protocol.md` §8 et §9, §14.1 S12 et S13, ADR-52). `apps/gateway` réutilise les modules de l'API, avec sa base PostgreSQL locale. Flux de réplication des soldes et des mots de passe de l'événement ; bascule d'autorité de débit par les seules fonctions du schéma (`grant_edge_authority`, `ack_edge_handover`, `fail_edge_grant`, `request_edge_release`, `complete_edge_release`, `force_central_authority` à deux) ; `X-Authority-Epoch` et arrêt des débits sur époque supérieure (`STALE_AUTHORITY_EPOCH`) ; refus des débits centraux pendant `EDGE` (`DEBIT_AUTHORITY_EDGE`). Opérations servies par la passerelle (`x-edge-available` : ventes, annulations, recharges espèces, activation sans frais sur solde, caution en espèces) et refusées (prélèvements sur solde, remboursements, restitutions, QR). Retour : vidage de la file `POST /edge/sync-batches` (`EDGE_SYNC`, `origin_key`, `origin_occurred_at`, `origin_mode`), chaîne calculée par le central, anomalie `EDGE_REPLAY_FAILED`. Snapshots signés par la clé propre de la passerelle. Seconde passerelle `STANDBY` qui ne débite pas sans promotion.
- [ ] /spec-kitty.plan NestJS empaqueté en Docker (à prévoir pour le site ; Docker absent de la machine de développement actuelle). mTLS avec certificat propre, disque chiffré, révocation à distance, pas de clé maître. L'application n'appelle jamais `set_debit_authority`. Ordre de verrouillage : verrous consultatifs puis lignes. Tests de bascule sous charge (`sync_protocol.md` §13).
- [ ] /spec-kitty.tasks
- [ ] spec-kitty next --agent claude --mission passerelle-locale
- [ ] /spec-kitty.review --mission passerelle-locale
- [ ] /spec-kitty.accept --mission passerelle-locale
- [ ] spec-kitty merge --mission passerelle-locale

## Mission 9 — Remboursements, versements et clôture

- [ ] /spec-kitty.specify Remboursements, versements, rapprochements et clôture d'un événement (SPECIFICATION §8.5, §11.3, §11.4, §12, §13.7, §14.2 S16 et S22, ADR-49, ADR-53, ADR-67, ADR-73, ADR-75, ADR-76). Demandes de remboursement (`refund_request` : Wave, Orange Money, virement ; approbation à deux qui écrit `WALLET_REFUND` ; confirmation ou échec avec `REVERSAL` ; autre numéro avec code au nouveau numéro, accord ou attente du numéro vérifié, vérification d'identité au-delà du seuil) ; remboursement en espèces au guichet avec jeton d'approbation au-delà du seuil ; guichet de retour dans l'ordre imposé (§7.9). Versements manuels (droit net `party_position`, lot préparé et validé à deux, `PAYOUT_INITIATED`, export CSV, `PAYOUT_CONFIRMED`/`FAILED`, alerte à 48 h). Rapprochement des relevés (`external_statement_line`). Clôture : droits de place selon `pitch_fee_mode`, transfert de dette, frais du prestataire et redevance (régularisation `NET_OF_REFUNDS`), casse partagée, cautions acquises, expiration des crédits offerts, `set_event_status` jusqu'à `CLOSED`, clôture avec soldes restants, `lock_settled_ledger`. Réclamations tardives (`BREAKAGE_REVERSAL`, `ADJUSTMENT`, `WALLET_REFUND`, `LATE_CHARGEBACK`) à deux, bornées par `check_late_claim`. Scellement toutes les 5 min avec copie S3 Object Lock et vérification quotidienne, surveillance des transactions de plus de 60 s, contrôles permanents §12.2 avec alertes. Relevés (commerçant, festivalier, organisateur, prestataire, plateforme) et export comptable par `account_mapping` configurable.
- [ ] /spec-kitty.plan Ordre de clôture de référence du scénario (§12.1). Les tâches d'exploitation (scellement, exports) utilisent un rôle distinct qui n'écrit pas au grand livre. Correspondance SYSCOHADA indicative, à faire valider (OP-N3) : configurable, jamais codée en dur. Copie des scellements sous un compte AWS distinct.
- [ ] /spec-kitty.tasks
- [ ] spec-kitty next --agent claude --mission remboursements-versements-cloture
- [ ] /spec-kitty.review --mission remboursements-versements-cloture
- [ ] /spec-kitty.accept --mission remboursements-versements-cloture
- [ ] spec-kitty merge --mission remboursements-versements-cloture

## Mission 10 — App festivalier

- [ ] /spec-kitty.specify App festivalier Flutter, Android et iOS (SPECIFICATION §8.5 « App festivalier », §7.8, §8.3, §14.2 S17, ADR-42, ADR-57, ADR-64, ADR-66). Côté serveur : comptes par numéro E.164 vérifié par code à usage unique (`customer_identity`, `otp_challenge`), port `OtpSender` avec chaîne WhatsApp puis SMS principal puis SMS de repli (bascules à 10 s et 20 s, faux fournisseurs), limites (`429 OTP_RATE_LIMITED`), `/me` et ses portefeuilles et historiques. Côté app : connexion, solde et historique, recharge en ligne, paiement par QR commerçant (confirmation par PIN ou biométrie) et QR client à usage unique (60 s, jamais préchargé), rattachement par QR ou code imprimé (demande en attente avec code de confirmation si le bracelet contient de l'argent), déclaration de perte (suspension immédiate, proposition de payer par QR), demande de remboursement, consultation anonyme du solde par code (`POST /public/balance-lookups`, lecture seule). L'app ne lit jamais la puce. Interfaces en français et en anglais.
- [ ] /spec-kitty.plan Flutter, types Dart générés depuis `openapi.yaml`. Pas de connexion Google ou Apple. Pas de portail web. Fournisseurs OTP réels à choisir sur devis (action 10 de POINTS_OUVERTS) : adaptateurs derrière le port seulement.
- [ ] /spec-kitty.tasks
- [ ] spec-kitty next --agent claude --mission app-festivalier
- [ ] /spec-kitty.review --mission app-festivalier
- [ ] /spec-kitty.accept --mission app-festivalier
- [ ] spec-kitty merge --mission app-festivalier

## Mission 11 — Back-office web

- [ ] /spec-kitty.specify Back-office Next.js (SPECIFICATION §1.2, §3.2, §7.7, §9.3, §11, §12, §15 « Lecture NFC »). Interfaces plateforme (prestataires, contrats, redevance, supervision), prestataire (organisateurs, contrats, index de clés, plafonds maximaux, profils de législation, configurations PSP), organisateur (événements, commerçants, catalogues, terminaux et codes d'enrôlement, politique hors ligne avec affichage du risque maximal, clôture avec liste des conditions et leur état, versements, relevés, exports, relevé des soldes restants), commerçant (ventes par article et par taux, relevés, vendeurs, catalogue si autorisé). Demandes d'approbation : liste, consultation, approbation, refus. Inventaire des lots, anomalies, remboursements. Liste des modèles de téléphone avec leur niveau NFC et signalement des terminaux « tolérés » ou non testés. Interfaces en français et en anglais.
- [ ] /spec-kitty.plan React / Next.js, types TypeScript générés depuis `openapi.yaml`. Les contrôles de clôture non calculables par la base (caisses comptées, PSP rapprochés, terminaux remontés) sont faits avant l'appel. Cloisonnement : un utilisateur d'un prestataire ne voit rien d'un autre.
- [ ] /spec-kitty.tasks
- [ ] spec-kitty next --agent claude --mission back-office
- [ ] /spec-kitty.review --mission back-office
- [ ] /spec-kitty.accept --mission back-office
- [ ] spec-kitty merge --mission back-office

## Mission 12 — App terminal

> **Condition préalable** : validation de la puce sur de vrais bracelets et campagne de mesure NFC faites
> (actions 1 et 2 de `POINTS_OUVERTS.md` §7, ADR-39). Ne pas lancer cette mission avant.

- [ ] /spec-kitty.specify App terminal Flutter (SPECIFICATION §7.6, §8.1, §8.2, §9.3 à §9.5, `docs/sync_protocol.md`, résultats du banc `tools/nfc-bench`). Modes `CATALOG_POS`, `KEYPAD_TPE`, `TOPUP_DESK` ; enrôlement par QR, clés ECDSA et ECDH dans l'Android Keystore (StrongBox si disponible) ou la Secure Enclave ; connexion des vendeurs par PIN ; épinglage d'écran. Lecture NFC Android en mode lecteur (`NfcA.transceive`) : page 4, `READ_SIG` à chaque passage, PWD/PACK depuis le snapshot ou `/media/auth-keys`, `PWD_AUTH`, `FAST_READ`, CRC, `INCR_CNT`/`READ_CNT` sur le compteur 2, effacement des mots de passe. Paiement en ligne en un aller-retour avec repli hors ligne après 3 s ; règle d'autorisation hors ligne dans l'ordre imposé (§9.3), journal SQLCipher (WAL, `synchronous = FULL`, fsync avant succès), compteur `seq` commun, snapshots vérifiés et deltas, lots signés et chaînés, exposition par bracelet et par terminal, bascule vers la passerelle. QR (iOS : QR uniquement). Guichet : recharges, cautions, restitutions, remplacements, remboursements, jeton d'approbation de la seconde personne. Vecteurs du format B produits et vérifiés par l'app.
- [ ] /spec-kitty.plan Flutter, Android et iOS ; `packages/tag-format` en Dart ; réglages de lecture par modèle de téléphone issus du banc. Aucune clé maître sur le terminal. Hors ligne jamais pour : QR, recharge PSP, remboursement, activation, caution, restitution, remplacement. Un refus en ligne est définitif. Latence NFC p95 ≤ 300 ms.
- [ ] /spec-kitty.tasks
- [ ] spec-kitty next --agent claude --mission app-terminal
- [ ] /spec-kitty.review --mission app-terminal
- [ ] /spec-kitty.accept --mission app-terminal
- [ ] spec-kitty merge --mission app-terminal

## Mission 13 — Recette V1

- [ ] /spec-kitty.specify Recette de la V1 selon les critères d'acceptation (SPECIFICATION §15, §16). Test de charge à deux fois la cible (400 terminaux, 100 ventes par seconde sur le site, 40 sur un stand, 30 minutes) sans interblocage, sans écart dans `balance_drift`, latence serveur seul p95 ≤ 200 ms et p99 ≤ 500 ms. Test de coupure : 10 terminaux hors ligne pendant 30 minutes puis synchronisation, zéro doublon, anomalies ouvertes, `S-ATTENTE` = somme des dépassements. Tests minimaux de `sync_protocol.md` §13 de bout en bout. Test automatisé de cloisonnement entre prestataires sur toutes les routes de l'API. Vérification que les deux suites pgTAP, les 19 cas du moteur, le scénario de référence et les vecteurs du format B passent partout. Rapport de recette.
- [ ] /spec-kitty.plan Environnement de charge proche de la production (PostgreSQL 17 RDS, région provisoire `eu-west-3`). Outils de charge au choix de la mission, justifiés. Le test d'intrusion externe (ADR-44) reste à mener par l'auditeur avant le pilote : hors de cette mission.
- [ ] /spec-kitty.tasks
- [ ] spec-kitty next --agent claude --mission recette-v1
- [ ] /spec-kitty.review --mission recette-v1
- [ ] /spec-kitty.accept --mission recette-v1
- [ ] spec-kitty merge --mission recette-v1

---

## Modèle — mission non prévue dans le découpage initial

> Quand un nouveau besoin fonctionnel est décidé en cours de route plutôt que planifié ici dès l'origine, ajoute
> une entrée ici **et** enrichis la section correspondante de `PRD.md` dans le même geste, avant ou au moment du
> `/spec-kitty.specify` — pas après coup. Le skill `spec-kitty-docs-maintain` doit normalement te le rappeler le
> moment venu, mais ne compte pas uniquement là-dessus.

## Mission N — [nom de la mission]

- [ ] /spec-kitty.specify [besoin concret, sections de SPECIFICATION et ADR concernées]
- [ ] /spec-kitty.plan [contraintes techniques concrètes tirées de PRD.md et SPECIFICATION]
- [ ] /spec-kitty.tasks
- [ ] spec-kitty next --agent claude --mission [slug réel]
- [ ] /spec-kitty.review --mission [slug réel]
- [ ] /spec-kitty.accept --mission [slug réel]
- [ ] spec-kitty merge --mission [slug réel]
