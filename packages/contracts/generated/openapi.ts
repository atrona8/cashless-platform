// Fichier généré par packages/contracts/scripts/generate.mjs depuis openapi.yaml — ne pas modifier.
// Régénérer : npm run generate -w @cashless/contracts

export type paths = {
    "/device-enrollment-codes": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Créer un code d'enrôlement à usage unique
         * @description Réservé à `OPERATOR_ADMIN` / `ORGANIZER_ADMIN`. Pas de MDM (ADR-69) : le code est affiché en QR dans le
         *     back-office et scanné par l'app du terminal, ou saisi à la main. Usage unique, durée de vie courte (défaut 24 h), lié au prestataire et
         *     optionnellement à un événement, un point de vente et un mode d'application.
         *     `app_mode = PAIRED_TPE` (V2, ADR-43) est refusé en V1 : `422 DEVICE_MODE_NOT_ALLOWED`.
         */
        post: operations["createDeviceEnrollmentCode"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/device-enrollments": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Enrôler un terminal (code à usage unique → identité d'appareil)
         * @description Le terminal génère dans l'Android Keystore (StrongBox si disponible) une clé de signature ECDSA P-256
         *     non exportable et une clé d'accord ECDH P-256 (chiffrement des PWD/PACK et du snapshot), puis envoie
         *     les clés publiques, la chaîne d'attestation de clé et un CSR. Le serveur vérifie le code (usage unique),
         *     l'attestation (clé dans le matériel sécurisé, bootloader verrouillé, application signée et intacte), crée ou met à jour
         *     `device` (serial, public_key, status ACTIVE), et renvoie un certificat client
         *     (mTLS), un jeton d'appareil et un jeton de rafraîchissement.
         *     `next_seq` indique le premier numéro de séquence utilisable (jamais inférieur à `device.last_seq + 1`,
         *     voir sync_protocol.md §3).
         *     Pas de MDM (ADR-69) : un téléphone personnel (`device.personal_phone = true`) n'a jamais le hors ligne
         *     (`offline_enabled = false` dans sa politique effective).
         *     Refus : code inconnu ou déjà utilisé (`422 ENROLLMENT_CODE_INVALID`), expiré (`422 ENROLLMENT_CODE_EXPIRED`),
         *     attestation non conforme (`422 ATTESTATION_FAILED`), mode d'application `PAIRED_TPE` (V2, ADR-43)
         *     ou non permis pour ce type de terminal (`422 DEVICE_MODE_NOT_ALLOWED`).
         */
        post: operations["enrollDevice"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/device-tokens/refresh": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Rafraîchir le jeton d'appareil
         * @description Le terminal présente son jeton de rafraîchissement ET une preuve de possession : signature ECDSA P-256
         *     (clé Keystore) de `nonce || serial || refresh_token`. Le jeton de rafraîchissement est à rotation
         *     (usage unique) ; la réutilisation d'un jeton déjà consommé révoque toute la famille (vol présumé).
         *     Un appareil `SUSPENDED` ou `REVOKED` reçoit `403 DEVICE_SUSPENDED` / `DEVICE_REVOKED`.
         */
        post: operations["refreshDeviceToken"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/device/config": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Configuration du terminal
         * @description Configuration complète du terminal appelant : affectation (événement, devise, point de vente,
         *     station), mode d'application, catalogue, politique hors ligne effective (`effective_offline_policy`),
         *     clés publiques de vérification du snapshot (ECDSA P-256 par défaut), autorité de débit courante et époque,
         *     heure serveur (pour la correction d'horloge). Supporte `If-None-Match` (ETag).
         */
        get: operations["getDeviceConfig"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/device/heartbeat": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Battement de cœur du terminal
         * @description Envoyé toutes les `heartbeat_seconds` (réglage de l'événement, défaut 60 s) quand le réseau est
         *     disponible. Met à jour `device.last_seen_at`,
         *     informe le serveur de la file d'attente locale (opérations non acquittées) et renvoie l'heure serveur,
         *     l'ETag de configuration, l'autorité de débit et la dernière version de snapshot disponible.
         */
        post: operations["postDeviceHeartbeat"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/device/seq-status": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * État des séquences du terminal vu par le serveur
         * @description Renvoie le plus grand numéro de séquence reçu sans trou (`contiguous_acked_seq`), le plus grand reçu
         *     (`max_seen_seq`) et la liste des trous connus. Utilisé à la reprise après coupure
         *     (sync_protocol.md §6).
         */
        get: operations["getDeviceSeqStatus"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/events/{event_id}/device-sync-status": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Remontée des terminaux d'un événement avant le règlement (back-office)
         * @description Renvoie, pour chaque terminal de l'événement, s'il est à jour (`event_device_sync_status`, ADR-73) et la
         *     date limite de synchronisation (`event_sync_deadline` : fin de l'événement, ou passage en `CLOSING`,
         *     plus `event.sync_deadline_hours`, 72 h par défaut). Avant cette date, le passage à `SETTLING` est refusé
         *     (`409 CLOSING_CONDITION_NOT_MET`, `CL019`) tant qu'un terminal n'est pas à jour ; après, il est permis et
         *     les opérations arrivées ensuite suivent la règle des synchronisations tardives (ADR-49).
         *     Raisons : `NOT_SEEN_SINCE_CLOSING`, `SEQ_GAP`, `BATCH_IN_PROGRESS`. Exclus : terminaux révoqués et
         *     téléphones personnels.
         */
        get: operations["getEventDeviceSyncStatus"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/devices/{device_id}/seq-gaps/{seq}/waive": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Lever un trou de séquence (back-office, deux personnes)
         * @description Clôt un trou de séquence dont le terminal a définitivement perdu l'opération (stockage détruit).
         *     Exige `SUPERVISOR`. Opération à deux personnes du back-office (ADR-74, SPECIFICATION §3.2) : l'appel crée une demande
         *     d'approbation (action `WAIVE_SEQ_GAP`) et répond `202` avec la demande `PENDING` ; rien n'est exécuté.
         *     Une seconde personne `SUPERVISOR` (≠ appelant) l'approuve par `approveApprovalRequest`, qui exécute
         *     l'action une seule fois avec elle comme valideur et renvoie le `SeqStatus` dans `result`.
         *     À l'exécution, l'anomalie `SEQ_GAP` est passée `RESOLVED` ; aucune écriture comptable n'est produite.
         *     Un numéro qui n'est pas un trou connu (déjà reçu, ou au-delà de `max_seen_seq`) est refusé :
         *     `409 SEQ_GAP_NOT_FOUND` (SQLSTATE `CL012`). Un numéro couvert par un lot encore en cours de traitement est
         *     refusé : `409 BATCH_IN_PROGRESS` (`CL010`). Ces contrôles sont faits à la création de la demande, puis de
         *     nouveau à l'exécution (la demande passe alors `FAILED`, avec le code dans `failure_code`).
         */
        post: operations["waiveSeqGap"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/devices/{device_id}/journal-imports": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Importer le journal d'un terminal révoqué (back-office, deux personnes)
         * @description Un terminal `REVOKED` ne peut plus envoyer de lots. Ses opérations non acquittées restent dues au
         *     commerçant (I4). Pas de MDM (ADR-69) : un superviseur exporte le journal depuis l'application du
         *     terminal (écran superviseur) ; l'export a le format des lots (`OfflineBatch`) et reste signé par la clé
         *     Keystore du terminal. Sans export possible (appareil perdu ou détruit), les numéros deviennent des trous
         *     levés par `waiveSeqGap`.
         *     L'API vérifie la signature de chaque lot avec `device.public_key`, recalcule la chaîne depuis le dernier
         *     `chain_hash` accepté, puis traite chaque opération selon sync_protocol.md §7.1 (`record_device_seq`,
         *     `post_transaction`, source `OFFLINE_SYNC`). `open_offline_batch` refuse un terminal révoqué : l'import
         *     ne l'utilise pas. Une opération datée après la révocation est rejetée (`OFFLINE_NOT_ALLOWED`, anomalie
         *     `NON_COMPLIANT_OPERATION`).
         *     Exige `SUPERVISOR`. Opération à deux personnes du back-office (ADR-74, SPECIFICATION §3.2) : l'appel crée une demande
         *     d'approbation (action `DEVICE_JOURNAL_IMPORT`) et répond `202` avec la demande `PENDING` ; rien n'est exécuté.
         *     Une seconde personne `SUPERVISOR` (≠ appelant) l'approuve par `approveApprovalRequest`, qui exécute
         *     l'action une seule fois avec elle comme valideur et renvoie le `DeviceJournalImportResult` dans `result`.
         *     Le serveur vérifie les signatures et la chaîne dès la création de la demande (refus immédiat), puis
         *     traite les lots à l'exécution. Terminal non `REVOKED` : `409 CONFLICT_STATE` (il envoie ses
         *     lots lui-même, sync_protocol.md §11 cas 33).
         */
        post: operations["importDeviceJournal"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/media/auth-keys": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Obtenir le PWD/PACK chiffré d'un bracelet (avant PWD_AUTH)
         * @description Le terminal lit l'UID (7 octets) et l'index de clé (page 4, octets 2-3, format B) puis demande le
         *     PWD||PACK du tag. Le serveur retrouve `media` par `(operator_id, nfc_uid)`, déchiffre `pwd_pack_enc`
         *     avec la DEK (`tag_data_key`, un seul Decrypt KMS mis en cache mémoire) et le re-chiffre pour ce
         *     terminal : ECDH-ES P-256 (clé d'accord de l'appareil) + HKDF-SHA256 + AES-256-GCM,
         *     AAD = `"CASHLESS/PWDPACK/DEV/v1" || device_id || nfc_uid`. Le PWD n'est jamais transmis en clair et
         *     n'est jamais persisté par le terminal hors du snapshot chiffré.
         *     Pour un UID inconnu, le serveur renvoie `404 MEDIA_UNKNOWN` après un délai constant.
         */
        post: operations["getMediaAuthKey"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/taps": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Enregistrer une lecture de bracelet (register_tap)
         * @description Après PWD_AUTH (PACK vérifié), le terminal exécute INCR_CNT puis READ_CNT, lit l'identité opaque de
         *     16 octets, et envoie `token_hash = sha256(identité)`, l'UID et le compteur. Le serveur appelle
         *     `register_tap(..., p_mode => 'ONLINE')` et renvoie son résultat, le bracelet et le solde disponible
         *     si `result = OK`.
         *     Le terminal lit aussi la signature d'originalité (`READ_SIG`) et l'envoie dans `originality_signature`.
         *     Le `tap_id` renvoyé (entier, `media_tap.id`) sert à UNE opération (paiement, recharge, activation, caution,
         *     restitution, rendu d'espèces) sur le MÊME terminal. L'écriture le consomme par `consume_tap`, qui relie
         *     `media_tap.transaction_id` à l'écriture. Une écriture en ligne doit suivre la lecture de moins de
         *     `tap_replay_window_seconds` (défaut 120 s) ; au-delà, ou si le passage a déjà servi à une autre écriture :
         *     `409 TAP_UNUSABLE` (`CL022`). Une opération peut aussi embarquer directement la lecture (`tap`) : le
         *     serveur appelle alors `register_tap` lui-même (un seul aller-retour).
         *     Une même lecture (même terminal, même UID, même compteur) jamais utilisée pour une écriture est réutilisée,
         *     quel que soit le délai. Déjà utilisée : un renvoi réseau reçu dans `tap_replay_window_seconds` (ADR-50)
         *     reçoit le même résultat, sans anomalie ; au-delà, ou depuis un autre terminal, c'est une copie suspectée
         *     (`CLONE_SUSPECTED`).
         *     Codes : `OK`, `UNKNOWN`, `BLOCKED`, `UID_MISMATCH`, `SIGNATURE_MISMATCH`, `SIGNATURE_MISSING`,
         *     `CLONE_SUSPECTED`, `RETIRED`, `REPLACED`, `NOT_ACTIVATED`, `RELEASED`, `BATCH_INACTIVE`, `WRONG_EVENT`.
         *     `SIGNATURE_MISMATCH` : signature lue différente de celle de la personnalisation, bracelet mis en liste
         *     noire. `SIGNATURE_MISSING` : signature absente alors que la puce en a une enregistrée ; le terminal DOIT
         *     relire le bracelet (pas de liste noire, `tap_id` nul). Un résultat autre que `OK` est une
         *     réponse 200 (information métier), pas une erreur HTTP.
         */
        post: operations["createTap"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/media/activations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Activer un bracelet (DESK, FIRST_TOPUP) et encaisser la caution
         * @description Remise + rattachement d'un bracelet à un portefeuille (`activate_media`). Le canal doit figurer dans
         *     `event.activation_modes` (sinon `422 ACTIVATION_MODE_NOT_ALLOWED`). Si `wallet_id` est absent, un
         *     portefeuille anonyme est créé dans le grand livre de l'événement (refusé si
         *     `identity_mode = ACCOUNT_REQUIRED` sans `customer_id`). Si le lot prévoit une caution, elle est
         *     encaissée par `take_deposit` : mode `FROM_BALANCE` (prélevée sur le solde, peut rester `DUE`) ou
         *     `SEPARATE` (payée à part : `deposit_payment.method` obligatoire). Idempotency-Key = `serial:seq`.
         *     Pendant `EDGE` (passerelle), servie seulement sans frais d'activation prélevés sur le solde et, si le lot
         *     prévoit une caution, en mode `SEPARATE` espèces ; sinon `409 DEBIT_AUTHORITY_EDGE` (ADR-52,
         *     sync_protocol.md §9.6).
         */
        post: operations["activateMedia"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/media/{media_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Consulter un bracelet (staff) */
        get: operations["getMedia"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/media/{media_id}/deposit": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Encaisser la caution (take_deposit)
         * @description Transaction `DEPOSIT_TAKEN`. Mode `FROM_BALANCE` : prélevée sur `WALLET_PAID` si le solde suffit,
         *     sinon statut `DUE` (prélevée à la prochaine recharge). Mode `SEPARATE` : `payment.method` obligatoire
         *     (`CASH` → compte `CASH_DESK` de la station). Idempotent : si déjà `HELD`, renvoie l'état courant.
         *     Pendant `EDGE` (passerelle) : seul le mode `SEPARATE` avec `payment.method = CASH` est servi ;
         *     `FROM_BALANCE` → `409 DEBIT_AUTHORITY_EDGE` (ADR-52).
         */
        post: operations["takeDeposit"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/media/{media_id}/deposit/refund": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Rendre la caution (refund_deposit)
         * @description Transaction `DEPOSIT_REFUNDED`. Mode `FROM_BALANCE` : recréditée sur le portefeuille. Mode `SEPARATE` :
         *     rendue par `payment.method` (espèces à la station, mobile money). Exige une lecture du bracelet
         *     (`tap_id` ou `tap`) : on ne rend pas une caution sans le bracelet physique.
         */
        post: operations["refundDeposit"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/media/{media_id}/release": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Restitution du bracelet (release_media)
         * @description Le bracelet rendu est libéré (`RELEASED`) ; l'argent ne suit jamais le bracelet. Préconditions
         *     vérifiées par `release_media` : caution non `HELD` (`409 DEPOSIT_OUTSTANDING`), aucune espèce due au
         *     détenteur (anomalie `CASH_TOPUP_OVER_LIMIT` ouverte : `409 MEDIA_STATE_INVALID`, `CL020` ; les rendre
         *     d'abord par `refundCashDue`) et portefeuilles soldés (`409 BALANCE_OUTSTANDING`). L'API contrôle ces
         *     préconditions avant l'appel et renvoie le code précis ; un autre refus `CL020` de la base donne
         *     `409 MEDIA_STATE_INVALID`.
         *     Cette opération ne rend que des **espèces**, depuis la caisse de la session `cash_session_id`. Elle ne
         *     rembourse rien par carte ni vers un numéro mobile money saisi au guichet. Le solde payé se rembourse
         *     autrement par les opérations prévues : demande de remboursement (`createMyRefundRequest`, numéro vérifié
         *     du titulaire, ou un autre numéro aux conditions d'ADR-76, puis `approveRefundRequest`). Une caution `SEPARATE` payée par mobile money se rend par `refundDeposit`.
         *     Si `settle_balance` est fourni, le serveur enchaîne dans l'ordre imposé
         *     par SPECIFICATION §7.9 : `refund_deposit` (`DEPOSIT_REFUNDED`, si la caution est `HELD`) → expiration
         *     des crédits offerts restants du portefeuille (`PROMO_EXPIRY`, clé
         *     `promo-expiry:<wallet_id>:<n° de rattachement>`) → remboursement du solde payé en espèces (`WALLET_REFUND`,
         *     frais de remboursement éventuels) → `release_media` (exige un solde nul). Chaque étape a sa propre
         *     écriture ; la requête est idempotente dans son ensemble. Sans `settle_balance`, un solde offert non nul
         *     est aussi refusé (`409 BALANCE_OUTSTANDING`).
         *     Espèces rendues au-delà de `event.cash_refund_single_max` (ADR-53) : seconde personne obligatoire, par
         *     jeton d'approbation sur place (en-tête `X-Approval-Token`, ADR-74) ; sans jeton `403 APPROVAL_REQUIRED`,
         *     jeton refusé `403 APPROVAL_INVALID`. Le valideur écrit est le `sub` du jeton.
         *     Indisponible pendant `EDGE` (`409 DEBIT_AUTHORITY_EDGE`, sync_protocol.md §9.6).
         */
        post: operations["releaseMedia"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/media/{media_id}/replace": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Remplacer un bracelet perdu ou abîmé (replace_media)
         * @description L'ancien bracelet passe `REPLACED` ; le nouveau (lu par `tap_id`) reprend le même portefeuille et les
         *     portefeuilles des autres devises. Même organisateur obligatoire. Rôle `SUPERVISOR` ou `CASHIER`.
         *     Une caution `HELD` ou `DUE` passe au nouveau bracelet ; il doit alors venir d'un lot de même mode de
         *     caution. L'ancien bracelet doit être `ACTIVE` ou `SUSPENDED` ; le nouveau doit être neuf (`PERSONALIZED`
         *     ou `ISSUED`, sans portefeuille ni caution). Sinon : `409 MEDIA_STATE_INVALID` (`CL020`).
         */
        post: operations["replaceMedia"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/media/{media_id}/cash-due-refunds": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Rendre au guichet les espèces dues à un détenteur (refund_cash_due)
         * @description Rend en espèces la somme due au détenteur après une recharge espèces hors ligne au-delà d'un plafond
         *     (ADR-63, anomalies `CASH_TOPUP_OVER_LIMIT` ouvertes du bracelet). Appelle `refund_cash_due`.
         *     - Le montant est calculé par le serveur : somme des anomalies `CASH_TOPUP_OVER_LIMIT` OUVERTES de ce
         *       bracelet. La requête n'a pas de champ montant ; la réponse donne le montant à remettre.
         *     - Espèces uniquement : le compte de caisse est celui de la session de caisse `cash_session_id`, qui DOIT
         *       être ouverte (`409 CONFLICT_STATE` sinon) et du même grand livre.
         *     - Bracelet présenté : lecture `tap_id` ou `tap`, consommée par `consume_tap` (`409 TAP_UNUSABLE`).
         *     - Au-delà de `event.cash_refund_single_max` (ADR-53) : seconde personne obligatoire, par jeton
         *       d'approbation sur place (en-tête `X-Approval-Token`, ADR-74) ; sans jeton `403 APPROVAL_REQUIRED`,
         *       jeton refusé (expiré, déjà utilisé, autre action, même personne) `403 APPROVAL_INVALID`. Le valideur
         *       transmis à `refund_cash_due` est le `sub` du jeton.
         *     - Écriture `WALLET_REFUND` (débit `L-ESP-A-RENDRE`, crédit caisse), source `ONLINE` ; les anomalies sont
         *       closes. Idempotency-Key = `serial:seq` ; un rejeu renvoie le même résultat.
         *     - Rien n'est dû : `409 MEDIA_STATE_INVALID` (`CL020`).
         *     Rôle `CASHIER` ou `SUPERVISOR`. Servie par le central, y compris pendant `EDGE` (aucun débit de
         *     portefeuille). À appeler avant `releaseMedia`, qui refuse tant que des espèces sont dues.
         */
        post: operations["refundCashDue"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/payments": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Payer (PURCHASE) par bracelet ou QR client
         * @description Débit du portefeuille (`WALLET_PROMO` puis `WALLET_PAID` selon `spend_order`) au profit du commerçant
         *     du point de vente du terminal, frais et commissions calculés par les `fee_rule` REALTIME.
         *     Écriture par `post_transaction(type => 'PURCHASE', source => 'ONLINE', key => Idempotency-Key)`.
         *     Moyen : `tap_id` (lecture déjà enregistrée), `tap` (lecture embarquée) ou `customer_qr_token`
         *     (QR affiché par l'app client). `payment_intent_id` (terminal `PAIRED_TPE`, intention d'un POS tiers)
         *     est **V2 (ADR-43)** : refusé en V1 (`422 DEVICE_MODE_NOT_ALLOWED`).
         *     Refus typiques : `INSUFFICIENT_FUNDS` (avec le solde disponible), `MEDIA_BLOCKED`,
         *     `DEBIT_AUTHORITY_EDGE` (le terminal DOIT alors passer par la passerelle), `EVENT_CLOSING`.
         *     `409 DEBIT_AUTHORITY_MOVING` (bascule d'autorité en cours) n'est PAS un refus définitif : le terminal
         *     garde la même clé et, si sa politique le permet, peut passer hors ligne (sync_protocol.md §5.1, §9.3).
         *     Objectifs (ADR-60, SPECIFICATION §15) : serveur seul p95 ≤ 200 ms et p99 ≤ 500 ms ; réseau + serveur
         *     p95 ≤ 800 ms et p99 ≤ 1,5 s (un seul aller-retour, lecture intégrée `tap`) ; au-delà de
         *     `online_total_timeout_ms` (défaut 3 s) sans réponse, le terminal applique sync_protocol.md §5.1 (bascule
         *     hors ligne avec la MÊME clé).
         *     Résultats de lecture qui refusent l'écriture : `422 MEDIA_SIGNATURE_MISMATCH`, `422 MEDIA_SIGNATURE_MISSING`
         *     (relire le bracelet), et les autres codes `MEDIA_*` ; passage inutilisable : `409 TAP_UNUSABLE`.
         */
        post: operations["createPayment"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/payments/{transaction_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Consulter un paiement */
        get: operations["getPayment"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/payments/{transaction_id}/reversal": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Annuler un paiement (REVERSAL)
         * @description Contre-passation TOTALE de la transaction (`reverses_id`), lignes opposées, type `REVERSAL`.
         *     Autorisée depuis le terminal d'origine dans la fenêtre `reversal_window_minutes` (défaut 15 min) ; au-delà, rôle
         *     `SUPERVISOR`. Une transaction ne peut être annulée qu'une fois (`409 ALREADY_REVERSED`).
         *     Le remboursement partiel n'existe pas : annuler puis rejouer le bon montant.
         *     Idempotency-Key = `serial:seq` (nouveau numéro, ex. `TPE-BAR-01:0004`).
         */
        post: operations["reversePayment"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/topups/cash": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Recharge en espèces en caisse (TOPUP_CASH)
         * @description Réservé aux terminaux `TOPUP_DESK` (ou staff `CASHIER`). Débit du compte `CASH_DESK` de la station,
         *     crédit `WALLET_PAID`. Plafonds réglementaires appliqués par `check_wallet_limits`
         *     (`WALLET_LIMIT_EXCEEDED`, `MONTHLY_TOPUP_LIMIT_EXCEEDED`). Si une caution `DUE` existe, elle est
         *     prélevée juste après (transaction `DEPOSIT_TAKEN` distincte, renvoyée dans `deposit`).
         *     Autorisé même si `debit_authority = EDGE` (crédit).
         */
        post: operations["createCashTopup"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/topups/psp": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Initier une recharge PSP (Wave, Orange Money, carte)
         * @description Crée une recharge `PENDING` et une session chez le PSP. AUCUNE écriture comptable ici : la
         *     transaction `TOPUP` n'est écrite qu'à la réception du webhook de succès (source `PSP_WEBHOOK`,
         *     clé `wave:<id du paiement>`, `om:<id du paiement>`, ou `psp:<psp_config_id>:<id du paiement>` pour un PSP
         *     carte, voir `receivePspWebhook`). La recharge enregistre la configuration PSP utilisée (`psp_config_id`).
         *     Appelable par l'app client (`CUSTOMER`, sur ses
         *     portefeuilles) ou par un terminal `TOPUP_DESK` (paiement mobile money du festivalier au guichet).
         *     Plafonds réglementaires pré-vérifiés (refus anticipé), puis revérifiés à l'écriture.
         */
        post: operations["initiatePspTopup"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/topups/psp/{topup_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Suivre une recharge PSP */
        get: operations["getPspTopup"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/cash-sessions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Ouvrir une session de caisse
         * @description Une caisse d'espèces (`CASH_DESK`, `A-CAISSE-<n>`) fonctionne par session (SPECIFICATION §11.2) :
         *     ouverture par un agent, opérations, comptage, fermeture. Les opérations en espèces du guichet
         *     (`createCashTopup`, `releaseMedia`, `refundCashDue`) désignent la session ouverte. Une seule session
         *     ouverte par compte de caisse (`409 CONFLICT_STATE` sinon). Aucune écriture comptable à l'ouverture.
         *     La table des sessions est un complément de schéma à créer (SPECIFICATION §14.2). Rôle `CASHIER` ou
         *     `SUPERVISOR`.
         */
        post: operations["openCashSession"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/cash-sessions/{cash_session_id}/counts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Enregistrer un comptage de la caisse
         * @description Comptage à l'aveugle : l'agent saisit le montant compté ; le montant théorique ne lui est pas montré.
         *     Plusieurs comptages sont possibles ; la fermeture utilise le dernier. Aucune écriture comptable.
         *     Session non `OPEN` : `409 CONFLICT_STATE`.
         */
        post: operations["countCashSession"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/cash-sessions/{cash_session_id}/close": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Fermer une session de caisse (CASH_CLOSE)
         * @description Exige un comptage (`409 CONFLICT_STATE` sinon). Écrit `CASH_CLOSE` : le compté passe en `A-TRANSIT` ; un
         *     manque est porté au compte de pertes du payeur désigné par `contract.cash_diff_bearer`, un surplus en
         *     sens inverse (SPECIFICATION §5.3, §11.2). Un écart non nul ouvre une anomalie `CASH_DIFF`. La session
         *     passe `CLOSED` ; plus aucune opération en espèces ne peut la désigner. Rôle `SUPERVISOR`.
         *     Clé d'écriture `bo:<Idempotency-Key>`.
         */
        post: operations["closeCashSession"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/kyc-verifications": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Identifier un festivalier au guichet (KYC)
         * @description ADR-38, ADR-54, SPECIFICATION §6.3. L'agent (`CASHIER` ou `ORGANIZER_ADMIN`) contrôle une pièce
         *     d'identité et saisit : type, pays, 4 derniers caractères du numéro, date d'expiration. Écrit une ligne
         *     `kyc_verification` (méthode `DESK`, ajout seul). Le niveau `VERIFIED` est ensuite calculé à chaque usage.
         *     Le festivalier DOIT avoir un compte : portefeuille anonyme sans client → `422 ACCOUNT_REQUIRED`. Un agent
         *     ne peut pas identifier un client dont il est titulaire (`403 FORBIDDEN`).
         */
        post: operations["createKycVerification"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/kyc-verifications/{kyc_verification_id}/revoke": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Révoquer une identification (deux personnes)
         * @description Seule modification permise d'une identification (`VERIFIED` → `REVOKED`, avec auteur et motif). Les
         *     plafonds non identifiés s'appliquent aux opérations suivantes de tous les portefeuilles du client.
         *     Rôle `OPERATOR_ADMIN` ou `ORGANIZER_ADMIN`. Opération à deux personnes du back-office (ADR-74, SPECIFICATION §3.2) : l'appel crée une demande
         *     d'approbation (action `KYC_REVOCATION`) et répond `202` avec la demande `PENDING` ; rien n'est exécuté.
         *     Une seconde personne `OPERATOR_ADMIN` ou `ORGANIZER_ADMIN` (≠ appelant) l'approuve par `approveApprovalRequest`, qui exécute
         *     l'action une seule fois avec elle comme valideur et renvoie la `KycVerification` dans `result`.
         *     `revoked_by` = auteur de la demande ; le valideur est tracé au journal d'audit. Déjà révoquée :
         *     `409 CONFLICT_STATE` (à la création de la demande, ou demande `FAILED` à l'exécution).
         */
        post: operations["revokeKycVerification"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/webhooks/{provider}/{psp_config_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Webhook entrant d'un PSP
         * @description Point d'entrée des notifications Wave (`wave`), Orange Money (`orange-money`) et des PSP carte
         *     configurés pour l'organisateur (ADR-70) : agrégateur local (`paydunya`, …) ou PSP international
         *     (`stripe`, …). Une URL par configuration PSP (`psp_config_id`, S26) : c'est l'URL déclarée chez le PSP.
         *     La configuration donne le prestataire et le secret AVANT toute lecture du corps.
         *     Les configurations appartiennent à l'organisateur ; chaque événement en retient une par moyen (S26b,
         *     sinon celle par défaut de l'organisateur), dont le titulaire est le détenteur des fonds de l'événement (ADR-72).
         *     1. Configuration inconnue, inactive, ou d'un autre `provider` → `404 NOT_FOUND` (réponse neutre), rien
         *        n'est écrit. Sinon, vérification de signature avec le secret de CETTE configuration, sur le corps
         *        BRUT (HMAC-SHA256, comparaison à temps constant), et de l'horodatage (tolérance 5 min) ; échec →
         *        `401 WEBHOOK_SIGNATURE_INVALID`, rien n'est écrit. L'en-tête dépend du PSP (Wave :
         *        `Wave-Signature: t=…,v1=…` ; autres : `X-Webhook-Signature`) ; un adaptateur par PSP normalise.
         *     2. Le tenant est celui de la configuration. La recharge référencée DOIT avoir été initiée avec cette
         *        même configuration ; sinon aucune écriture, anomalie `PSP_MISMATCH`, `200`.
         *     3. Idempotence de la réception : clé `psp:<psp_config_id>:<provider_event_id>` (identifiant de la
         *        notification chez le PSP), mémorisée avec le corps brut. Un rejeu renvoie `200` avec
         *        `duplicate: true`. La transaction `TOPUP` est écrite avec `source = PSP_WEBHOOK` et une clé par
         *        paiement : `wave:<id du paiement>`, `om:<id du paiement>`, ou `psp:<psp_config_id>:<id du paiement>`
         *        pour un PSP carte (sans ambiguïté entre deux configurations). Deux notifications d'un même paiement
         *        n'écrivent donc qu'une fois.
         *     4. Succès → `TOPUP` (+ frais PSP selon le payeur configuré). Échec / expiration → recharge `FAILED`
         *        / `EXPIRED`, aucune écriture. Montant ou devise différents de la recharge initiée → aucune
         *        écriture, anomalie `PSP_MISMATCH`, `200` (le PSP ne doit pas réessayer).
         *     5. Si le plafond réglementaire est dépassé à l'écriture, l'argent est reçu mais non crédité :
         *        recharge `FAILED` + anomalie `PSP_TOPUP_OVER_LIMIT` + remboursement au payeur (processus back-office).
         *     6. Contestations carte (chargeback, ADR-77) : avant le verrouillage, écriture `CHARGEBACK` (source
         *        `PSP_WEBHOOK`) : compte PSP crédité, portefeuille débité jusqu'à son solde (puis bloqué), le reste au
         *        compte de pertes de la partie désignée par `contract.chargeback_bearer` (organisateur par défaut).
         *        Après le verrouillage : aucune écriture directe ; anomalie `LATE_CHARGEBACK` et demande d'approbation
         *        (action `LATE_CHARGEBACK`, ADR-74), écrite à l'approbation dans le grand livre verrouillé (bornes ADR-77).
         *     7. Recharge carte : 3-D Secure obligatoire ; plafond par carte et par jour
         *        (`event.card_topup_daily_max_per_card`, `422 CARD_DAILY_LIMIT` à l'initiation) ; anomalie
         *        `CARD_VELOCITY` au-delà de `event.card_alert_cards_per_wallet` cartes sur un même portefeuille.
         *     Réponse rapide (< 2 s) ; le traitement lourd est asynchrone après persistance de l'événement brut.
         */
        post: operations["receivePspWebhook"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/offline-snapshots/current": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Snapshot hors ligne signé (complet ou delta)
         * @description Liste `token_hash → solde disponible` (vue `offline_snapshot_rows`) du grand livre de l'événement du
         *     terminal, signée par le serveur (ECDSA P-256 par défaut, `ECDSA_P256_SHA256` ; algorithme donné par `key_id`) (`offline_snapshot`). Chaque entrée porte en plus le PWD||PACK
         *     chiffré pour CE terminal (enveloppe `pwd_pack_key`). Avec `since_version`, le serveur renvoie un
         *     `DELTA` (entrées modifiées + retirées depuis cette version) s'il en dispose, sinon un `FULL`.
         *     Le terminal DOIT vérifier la signature, la chaîne de version (`base_version`) et la fraîcheur
         *     (sync_protocol.md §4) avant usage, puis accuser réception (`ackOfflineSnapshot`).
         *     Si `offline_enabled = false` pour ce terminal : `403 OFFLINE_NOT_ALLOWED`. Un tel terminal (dont tout
         *     téléphone personnel) n'a pas besoin du snapshot : il obtient le PWD par `POST /media/auth-keys` et
         *     travaille toujours en ligne. Chaque entrée porte `originality_sig_sha256` (ADR-59).
         *     Après un blocage ou une déclaration de perte, le serveur DOIT publier un nouveau snapshot (delta) en
         *     5 s au plus (SPECIFICATION §8.5, sync_protocol.md §4.2).
         */
        get: operations["getOfflineSnapshot"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/offline-snapshots/ack": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Accuser réception et application d'un snapshot
         * @description Met à jour `device.last_snapshot_version` après vérification de signature et application.
         */
        post: operations["ackOfflineSnapshot"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/offline-batches": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Synchroniser un lot d'opérations hors ligne
         * @description Normatif : sync_protocol.md §6 et §7. Résumé :
         *     - Un seul lot en vol par terminal (`409 BATCH_IN_PROGRESS` sinon). `Idempotency-Key` = `header.batch_id`
         *       (exception à la règle `<serial>:<seq>` : c'est la clé du lot ; chaque opération garde la sienne).
         *       Un lot resté en traitement plus de 15 min est abandonné à l'ouverture du lot suivant (sync_protocol.md
         *       §6.2-6).
         *     - Bornes : un lot dont le dernier numéro dépasse `contiguous_acked_seq + 10 000` (`max_seq_jump`) est
         *       refusé en entier, sans anomalie : `409 SEQ_OUT_OF_RANGE` (`CL021`).
         *     - Numéros CONTINUS : `seq_from` = plus petit numéro non acquitté du journal local, puis +1 sans trou jusqu'à
         *       `seq_to` (`count = seq_to − seq_from + 1`). Le lot contient TOUTES les entrées du journal, y compris
         *       celles confirmées en ligne (`online_status = CONFIRMED`, réponse `DUPLICATE`) et les numéros sans
         *       effet (`VOID`, `ONLINE_REF`). Entrées chaînées par `chain_hash` ; en-tête signé par la clé de
         *       l'appareil (ECDSA P-256). Signature invalide : `400 BATCH_SIGNATURE_INVALID`, lot non traité.
         *       `header.prev_chain_hash` différent du dernier `chain_hash` accepté : `409 CHAIN_BROKEN`, lot
         *       enregistré `REJECTED` avec une anomalie `CHAIN_BROKEN` (examen manuel).
         *     - Toute opération autorisée hors ligne (`OFFLINE_AUTHORIZED`) porte `config_id` et `snapshot_version`
         *       (champs d'état, hors `content_sha256`). Bracelet absent du snapshot : `REJECTED`,
         *       `reject_reason = MEDIA_NOT_IN_SNAPSHOT`.
         *     - Chaque opération est écrite avec `source = OFFLINE_SYNC` et `idempotency_key = <serial>:<seq>`.
         *     - Résultat par opération : `ACCEPTED`, `DUPLICATE` (déjà écrite, y compris en ligne),
         *       `ACCEPTED_WITH_SHORTFALL` (solde insuffisant ou bracelet bloqué : la part non couverte va au compte
         *       d'attente `SUSPENSE`, le commerçant est garanti, anomalie `OFFLINE_SHORTFALL`), `REJECTED` (+ raison).
         *     - Un trou À L'INTÉRIEUR du lot le rend invalide (`400 SEQ_OUT_OF_ORDER`). Un lot qui commence
         *       après `contiguous_acked_seq + 1` est traité (le commerçant reste garanti), les numéros manquants
         *       sont signalés dans `missing_seqs` et ouvrent une anomalie `SEQ_GAP` ; le terminal DOIT les renvoyer
         *       s'il les a, sinon ils se lèvent par `waiveSeqGap` (sync_protocol.md §6.3).
         *     - Synchronisation tardive (événement en `SETTLING` ou au-delà, sync_protocol.md §7.5) : une vente et son
         *       annulation sont `REJECTED` (`SYNC_DEADLINE_PASSED`) ; une recharge en espèces est écrite avec une
         *       anomalie `LATE_OFFLINE_SYNC`, jamais refusée pour ce motif (l'argent a changé de main).
         *     - Si `debit_authority = EDGE` sur le central, le lot entier est refusé par
         *       `409 DEBIT_AUTHORITY_EDGE` : il DOIT être envoyé, inchangé (même `batch_id`), à la passerelle.
         *       Pendant une bascule (`RELEASING`), la passerelle refuse les nouveaux lots par
         *       `409 DEBIT_AUTHORITY_MOVING` : ce n'est pas un refus définitif, le terminal renvoie le même lot à
         *       l'autorité suivante (sync_protocol.md §9.3).
         *     Taille max : 500 opérations ou 1 Mio.
         */
        post: operations["submitOfflineBatch"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/offline-batches/{batch_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Relire le résultat d'un lot (reprise après coupure pendant la réponse)
         * @description Résultat mémorisé du lot. Un lot abandonné (traitement interrompu plus de 15 min) répond `200` avec
         *     `abandoned: true` et les résultats des seules opérations traitées : le terminal construit un nouveau lot
         *     (nouveau `batch_id`) à partir de son plus petit numéro non `ACKED` (sync_protocol.md §6.2-6).
         */
        get: operations["getOfflineBatchResult"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/payment-intents": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Créer une intention de paiement (POS tiers)
         * @description Le POS tiers crée une intention avec le montant ; le festivalier paie ensuite sur le terminal
         *     appairé (`PAIRED_TPE`, par bracelet) ou en scannant le QR renvoyé (`qr_payload`, flux MERCHANT_QR).
         *     `capture_method = AUTOMATIC` : la vente (`PURCHASE`) est écrite dès l'autorisation.
         *     `capture_method = MANUAL` : les fonds sont RÉSERVÉS (pas d'écriture) jusqu'à `capture` (écriture
         *     `PURCHASE` d'un montant ≤ autorisé) ou `cancel` / expiration (libération).
         *     **V1 : `MANUAL` n'est pas disponible** (ADR-37, modifiée par ADR-43) ; la création avec
         *     `capture_method = MANUAL` renvoie `422 VALIDATION_FAILED`.
         */
        post: operations["createPaymentIntent"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/payment-intents/{payment_intent_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Consulter une intention de paiement */
        get: operations["getPaymentIntent"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/payment-intents/{payment_intent_id}/capture": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Capturer une intention autorisée (MANUAL)
         * @description Écrit la vente `PURCHASE` pour `amount_to_capture` (≤ montant autorisé, défaut : totalité) et libère
         *     le reliquat. Uniquement depuis `AUTHORIZED` ; sinon `409 PAYMENT_INTENT_INVALID_STATE`.
         *     Refusée si `debit_authority = EDGE` et que la capture n'est pas faite via la passerelle.
         */
        post: operations["capturePaymentIntent"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/payment-intents/{payment_intent_id}/cancel": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Annuler une intention
         * @description Depuis `REQUIRES_PAYMENT` ou `AUTHORIZED` (libère la réserve) → `CANCELLED`. Depuis `SUCCEEDED`,
         *     l'annulation écrit une contre-passation `REVERSAL` si la fenêtre d'annulation n'est pas dépassée
         *     (sinon `409 REVERSAL_WINDOW_EXPIRED`).
         */
        post: operations["cancelPaymentIntent"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/device/payment-intents": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Intentions en attente pour le terminal appairé (PAIRED_TPE)
         * @description Long-polling (`wait` secondes, max 25) : renvoie dès qu'une intention `REQUIRES_PAYMENT` est
         *     adressée à ce terminal. Le terminal la paie ensuite par `POST /payments` avec `payment_intent_id`.
         */
        get: operations["listDevicePaymentIntents"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/webhook-endpoints": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Lister les abonnements */
        get: operations["listWebhookEndpoints"];
        put?: never;
        /**
         * Abonner une URL aux webhooks sortants
         * @description Le secret de signature est renvoyé une seule fois. Livraison au moins une fois, réessais exponentiels
         *     pendant 72 h ; le destinataire DOIT dédoublonner par `event_id`.
         */
        post: operations["createWebhookEndpoint"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/webhook-endpoints/{webhook_endpoint_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Supprimer un abonnement */
        delete: operations["deleteWebhookEndpoint"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/payment-requests": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Créer un QR commerçant (MERCHANT_QR)
         * @description Le terminal (souvent iOS, sans NFC) crée une `payment_request` `MERCHANT_QR` et affiche `qr_payload`.
         *     Le jeton (128 bits, aléatoire) n'est stocké que haché (`nonce_hash = sha256(token)`) ; durée de vie
         *     60 s par défaut. Toujours en ligne : jamais de QR hors ligne. Idempotency-Key = `serial:seq` ; la
         *     vente résultante reprend cette clé.
         */
        post: operations["createPaymentRequest"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/payment-requests/{payment_request_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Consulter une demande de paiement
         * @description Le terminal l'interroge (ou long-polling `wait`) jusqu'à `CONFIRMED` / `EXPIRED` / `CANCELLED`.
         *     L'app client l'appelle après scan pour afficher montant et commerçant avant confirmation
         *     (ne renvoie jamais le jeton).
         */
        get: operations["getPaymentRequest"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/payment-requests/{payment_request_id}/pay": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Payer un QR commerçant depuis l'app client
         * @description Le client présente le jeton lu dans le QR (preuve de présence) et choisit son portefeuille.
         *     Vérifications : `sha256(token) = nonce_hash`, statut `PENDING`, non expiré, portefeuille du client,
         *     devise de l'événement. Écrit `PURCHASE` (source `ONLINE`, clé = celle de la création de la demande)
         *     et passe la demande `CONFIRMED` dans la même transaction SQL.
         */
        post: operations["payPaymentRequest"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/payment-requests/{payment_request_id}/cancel": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Annuler une demande en attente
         * @description Passe la demande `PENDING` en `CANCELLED`. Une demande qui n'est plus `PENDING` est refusée
         *     (`409 PAYMENT_REQUEST_NOT_PENDING`).
         */
        post: operations["cancelPaymentRequest"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/customer-auth/otp": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Demander un code à usage unique (SMS / WhatsApp)
         * @description Protection contre les abus (valeurs par défaut, réglables par la plateforme) : au plus 3 envois par
         *     numéro sur 15 min glissantes, et 10 demandes par adresse IP et par heure. Au-delà : `429 OTP_RATE_LIMITED`
         *     avec `Retry-After`. Un numéro bloqué après trop d'essais faux (voir `exchangeCustomerOtp`) reçoit aussi
         *     `429 OTP_RATE_LIMITED` jusqu'à la fin du blocage. La réponse `202` reste identique que le numéro soit
         *     connu ou non.
         */
        post: operations["requestCustomerOtp"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/customer-auth/token": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Échanger le code contre des jetons
         * @description Crée le compte client (`party` CUSTOMER) au premier passage. Au plus 5 essais par code : au 5ᵉ essai
         *     faux, le code est invalidé et le numéro est bloqué 30 min (`429 OTP_RATE_LIMITED`, `Retry-After`).
         *     Code faux, expiré ou déjà utilisé : `422 OTP_INVALID`.
         */
        post: operations["exchangeCustomerOtp"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/customer-auth/refresh": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Rafraîchir les jetons du client */
        post: operations["refreshCustomerToken"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/me": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Profil du client */
        get: operations["getMe"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/me/wallets": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Portefeuilles du client et soldes */
        get: operations["listMyWallets"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/me/wallets/{wallet_id}/transactions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Historique du portefeuille (pagination par curseur)
         * @description Mouvements du point de vue du client : `amount` négatif = dépense, positif = crédit. Les opérations
         *     hors ligne apparaissent à leur synchronisation, datées de `occurred_at` (heure réelle) ; la part d'une
         *     vente passée au compte d'attente n'apparaît jamais comme une dette du client.
         */
        get: operations["listMyWalletTransactions"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/public/balance-lookups": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Consulter le solde d'un bracelet anonyme par son code imprimé (sans compte)
         * @description Lecture seule, sans authentification (ADR-42). Le festivalier scanne le QR ou saisit le code imprimé
         *     sur un bracelet qui n'est rattaché à aucun compte. Renvoie le solde disponible et les 10 derniers
         *     mouvements. Refusé (réponse identique à un code inconnu, `NOT_FOUND`) si le bracelet est rattaché à
         *     un compte : il faut alors se connecter. Ne consomme pas le code (il reste valable pour le rattachement).
         *     Limites : 20 consultations par code et par heure, 60 par adresse IP et par heure (`429 RATE_LIMITED`).
         */
        post: operations["lookupBalanceByClaimCode"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/me/media": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Bracelets rattachés au client */
        get: operations["listMyMedia"];
        put?: never;
        /**
         * Rattacher un bracelet à son compte (SELF_APP)
         * @description Le client scanne le QR imprimé sur le bracelet ou saisit le code de 10 caractères imprimé dessous
         *     (ADR-36). L'app festivalier ne lit PAS la puce : elle n'obtient jamais le mot de passe d'un bracelet
         *     (ADR-42). Le code sert une seule fois. Si le bracelet est `ISSUED` / `PERSONALIZED`,
         *     il est activé (`activate_media(..., 'SELF_APP')`, mode requis dans `activation_modes`) sur un
         *     portefeuille du client ; s'il est déjà `ACTIVE` sur un portefeuille ANONYME, ce portefeuille est
         *     rattaché au client (`wallet.customer_id`) sans mouvement d'argent.
         *     Code inconnu ou déjà utilisé : même réponse `422 MEDIA_CLAIM_INVALID` (pas d'énumération possible).
         *     Limites (SPECIFICATION §7.8) : au plus 5 essais par compte et par heure, et 20 par appareil et par
         *     jour ; au-delà, blocage temporaire (`429 RATE_LIMITED`) et alerte.
         *     **Bracelet déjà approvisionné** (ADR-57) : si le portefeuille anonyme du bracelet a un solde disponible
         *     non nul, le rattachement n'est PAS fait : réponse `202` avec une demande en attente
         *     (`MediaClaimPending`) et un code de confirmation à 6 chiffres affiché dans l'app, valable 24 h. Le code
         *     imprimé n'est pas consommé ; plusieurs demandes en attente peuvent coexister (3 au plus par bracelet).
         *     La demande est confirmée au guichet par `confirmMediaClaim` (lecture du bracelet par un terminal, code
         *     imprimé et code de confirmation) ; le code imprimé est alors consommé et les autres demandes annulées.
         *     Risque résiduel (ADR-57) : un bracelet à solde nul est rattaché sans passage au guichet. Un tiers qui a vu
         *     le code imprimé peut donc le rattacher à son compte avant le porteur ; les recharges faites ensuite par le
         *     porteur vont alors à un portefeuille que ce tiers contrôle. Risque accepté et documenté.
         */
        post: operations["claimMedia"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/media/claims/confirmations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Confirmer au guichet le rattachement d'un bracelet approvisionné (ADR-57)
         * @description Le festivalier présente son bracelet et l'app affiche le code de confirmation. Le guichet ne connaît pas
         *     `claim_id` : le terminal lit le bracelet (`tap_id` valide), l'agent scanne ou saisit le code imprimé
         *     (`claim_code`) et saisit le code de confirmation. Le serveur retrouve les demandes en attente par
         *     `claim_code` ; le bracelet lu DOIT être celui du code, et le code de confirmation désigne la demande. Le portefeuille
         *     anonyme est alors rattaché au client (`wallet.customer_id`), sans mouvement d'argent ; le code imprimé
         *     est consommé et les autres demandes en attente pour ce bracelet sont annulées. Code de confirmation
         *     faux, demande expirée ou bracelet différent : `422 MEDIA_CLAIM_INVALID` (au plus 5 essais par demande).
         *     Indisponible pendant `EDGE` (rattachement au central uniquement).
         */
        post: operations["confirmMediaClaim"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/me/media/{media_id}/report-lost": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Déclarer un bracelet perdu (→ SUSPENDED)
         * @description Le bracelet passe `SUSPENDED` immédiatement ; le serveur DOIT publier un nouveau snapshot (delta) en
         *     5 s au plus, qui le propage aux terminaux (SPECIFICATION §8.5, sync_protocol.md §4.2). Les
         *     ventes hors ligne postérieures à la déclaration, faites avec un snapshot antérieur, ne sont PAS
         *     imputées au client (compte d'attente, voir sync_protocol.md §7.3). Un bracelet déjà `SUSPENDED`
         *     renvoie l'état courant.
         */
        post: operations["reportMyMediaLost"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/me/customer-qr-tokens": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Générer un QR client à usage unique (CUSTOMER_QR)
         * @description Crée une `payment_request` `CUSTOMER_QR` (montant nul, fixé par le terminal au scan), jeton court
         *     (12 caractères base32, 60 bits) affiché en QR, durée de vie 60 s, usage unique.
         *     Le terminal le présente dans `POST /payments` (`customer_qr_token`). Toujours en ligne, des deux côtés :
         *     l'app NE DOIT PAS précharger de jetons (ADR-64) ; sans réseau, le festivalier paie avec son bracelet.
         */
        post: operations["createCustomerQrToken"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/me/refund-requests": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Mes demandes de remboursement */
        get: operations["listMyRefundRequests"];
        put?: never;
        /**
         * Demander le remboursement du solde
         * @description Possible pendant la fenêtre de remboursement (`event.refund_deadline`, minimum légal
         *     `jurisdiction_profile.min_refund_window_days`). Le montant remboursé est le solde `paid` au moment du
         *     traitement, moins les frais de remboursement (`fee_rule` PER_REFUND) ; les crédits offerts (promo)
         *     ne sont jamais remboursés. Une seule demande ouverte par portefeuille (`409 REFUND_ALREADY_OPEN`).
         *     Hors de la fenêtre : `422 REFUND_WINDOW_CLOSED` ; portefeuille non remboursable (solde payé nul,
         *     destination non vérifiée…) : `422 REFUND_NOT_ALLOWED`. Traitement manuel en V1 (SPECIFICATION §8.5,
         *     §11.4) : voir `approveRefundRequest` puis `confirmRefundRequest`.
         *     Destination mobile money (ADR-76) : le numéro vérifié du titulaire, ou un AUTRE numéro aux conditions
         *     suivantes. (1) Un code à usage unique envoyé au nouveau numéro (`requestCustomerOtp`) est joint à la
         *     demande (`destination.new_number_otp`), sinon `422 REFUND_NOT_ALLOWED`. (2) Si le titulaire a un numéro
         *     vérifié, un code lui est aussi envoyé avec un lien de décision (`decideRefundRequestAsHolder`) : la
         *     demande est `AWAITING_HOLDER` ; confirmée, elle passe `REQUESTED` ; bloquée, `BLOCKED` ; sans réponse,
         *     elle passe `REQUESTED` à `hold_until` = création + `event.refund_new_number_hold_hours` (48 h par défaut).
         *     Bracelet anonyme (pas de numéro vérifié) : `REQUESTED` directement. (3) Au-delà de
         *     `event.refund_new_number_max` (50 000 par défaut), `extra_check_required = true` : l'approbation exige une
         *     vérification d'identité au guichet (bracelet présenté, pièce) ou par le back-office, notée dans la décision.
         *     Demande créée par le back-office (virement bancaire, par exemple) : opération à ajouter, non décrite ici.
         */
        post: operations["createMyRefundRequest"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/refund-requests": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Lister les demandes de remboursement (back-office) */
        get: operations["listRefundRequests"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/refund-requests/{refund_request_id}/holder-decision": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Le titulaire confirme ou bloque un remboursement vers un autre numéro (ADR-76)
         * @description Lien reçu sur le numéro vérifié du titulaire, avec un code à usage unique. `CONFIRM` : la demande passe
         *     `REQUESTED`. `BLOCK` : elle passe `BLOCKED` (finale) et une alerte est levée pour le back-office.
         *     Seulement depuis `AWAITING_HOLDER` avant `hold_until` (`409 CONFLICT_STATE` sinon). Code faux ou expiré :
         *     `422 OTP_INVALID` ; protection contre les abus comme `requestCustomerOtp`.
         */
        post: operations["decideRefundRequestAsHolder"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/refund-requests/{refund_request_id}/approve": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Proposer l'approbation d'un remboursement (demande d'approbation WALLET_REFUND)
         * @description Remboursement manuel en V1 (SPECIFICATION §8.5, §11.4) : demande → approbation à deux → paiement
         *     hors système → confirmation (`confirmRefundRequest`). Aucun virement n'est déclenché par l'API.
         *     Opération à deux personnes du back-office (ADR-74, SPECIFICATION §3.2) : l'appel crée une demande
         *     d'approbation (action `WALLET_REFUND`) et répond `202` avec la demande `PENDING` ; rien n'est exécuté.
         *     Une seconde personne du back-office (≠ appelant) l'approuve par `approveApprovalRequest`, qui exécute
         *     l'action une seule fois avec elle comme valideur et renvoie la `RefundRequest` dans `result`.
         *     L'appelant est l'auteur ; le valideur DOIT être différent de l'appelant et de la personne qui a saisi la
         *     demande de remboursement (`409 APPROVAL_INVALID` ou `403 FORBIDDEN` sinon). La demande de remboursement
         *     reste `REQUESTED` jusqu'à l'exécution.
         *     À l'exécution : transaction `WALLET_REFUND` (source `BACKOFFICE`, `created_by` = auteur,
         *     `approved_by` = valideur ; sortie du solde `paid` vers le compte d'argent du moyen de
         *     paiement, frais de remboursement éventuels), avec la clé `bo:<Idempotency-Key>` (clé de l'appel qui a
         *     créé la demande d'approbation). La demande de remboursement passe `REQUESTED` → `PROCESSING` ; elle est
         *     ensuite exportée pour paiement hors système.
         *     Refus (à la création, puis de nouveau à l'exécution : demande `FAILED`) : demande qui n'est pas
         *     `REQUESTED` (`409 CONFLICT_STATE`) ; `debit_authority = EDGE` (`409 DEBIT_AUTHORITY_EDGE`) ; fenêtre
         *     close (`422 REFUND_WINDOW_CLOSED`).
         */
        post: operations["approveRefundRequest"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/refund-requests/{refund_request_id}/confirm": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Enregistrer le résultat du paiement hors système (PAID ou FAILED)
         * @description Après le paiement hors système, une personne du back-office enregistre le résultat (SPECIFICATION
         *     §11.4, étape 5, même circuit que les versements) :
         *     - `outcome = PAID` : la demande passe `PROCESSING` → `PAID` ; `external_reference` (référence Wave,
         *       Orange Money…) est obligatoire. Aucune nouvelle écriture : l'argent est sorti par `WALLET_REFUND`.
         *     - `outcome = FAILED` : la demande passe `PROCESSING` → `FAILED` ; `failure_reason` est obligatoire.
         *       L'écriture `WALLET_REFUND` est contre-passée (`REVERSAL`, clé `bo:<Idempotency-Key>`) : le solde
         *       payé est recrédité au portefeuille ; le festivalier peut faire une nouvelle demande.
         *     Refus : demande qui n'est pas `PROCESSING` (`409 CONFLICT_STATE`) ; `debit_authority = EDGE` pour
         *     un échec (`409 DEBIT_AUTHORITY_EDGE`).
         */
        post: operations["confirmRefundRequest"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/refund-requests/{refund_request_id}/reject": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Refuser une demande de remboursement
         * @description Depuis `REQUESTED` seulement (`409 CONFLICT_STATE` sinon) ; la demande passe `REJECTED`, sans
         *     écriture. Clé d'idempotence au préfixe `bo:`.
         */
        post: operations["rejectRefundRequest"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/ledgers/{ledger_id}/late-claims": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Réclamation tardive après la casse (back-office, deux personnes)
         * @description Casse réversible (ADR-67). Un festivalier réclame son solde après la casse, sur un grand livre `LOCKED`,
         *     jusqu'à `ledger.late_claims_until`. Il prouve son droit par le bracelet (`tap_id` lu par un terminal) ou
         *     par son compte (portefeuille rattaché à un client).
         *     Opération à deux personnes du back-office (ADR-74, SPECIFICATION §3.2) : l'appel crée une demande
         *     d'approbation (action `LATE_CLAIM`) et répond `202` avec la demande `PENDING` ; rien n'est exécuté.
         *     Une seconde personne du back-office (≠ appelant) l'approuve par `approveApprovalRequest`, qui exécute
         *     l'action une seule fois avec elle comme valideur et renvoie le `LateClaimResult` dans `result`.
         *     À l'exécution, le serveur écrit, en source `BACKOFFICE`, `created_by` = auteur de la demande et
         *     `approved_by` = valideur :
         *     1. `BREAKAGE_REVERSAL` : débit de chaque bénéficiaire de la casse, en proportion de sa part de la casse
         *        initiale (ou du compte légal), crédit du portefeuille payé ; clé `bo:<Idempotency-Key>:reversal` ;
         *     2. `WALLET_REFUND` : le détenteur des fonds paie le festivalier, hors système, comme pour
         *        `approveRefundRequest` ; clé `bo:<Idempotency-Key>:refund`.
         *     Chaque bénéficiaire rapporte ensuite sa part par une écriture `ADJUSTMENT` (hors de cette opération).
         *     Refus (à la création, puis de nouveau à l'exécution : demande `FAILED`) : grand livre non `LOCKED`
         *     (`409 CONFLICT_STATE` : utiliser le circuit normal de remboursement) ; `late_claims_until` dépassée ou
         *     nulle (`409 LEDGER_LOCKED`, `CL003`) ; `debit_authority = EDGE` (`409 DEBIT_AUTHORITY_EDGE`).
         *     Bornes contrôlées par la base (ADR-75, `409 LATE_CLAIM_INVALID`, `CL024`) : un seul portefeuille crédité,
         *     comptes de casse débités au prorata de la casse d'origine (± 1), total annulé ≤ casse prise sur ce
         *     portefeuille ; l'apport d'un bénéficiaire (`ADJUSTMENT`) ne dépasse pas ce qui a été annulé sur son compte de
         *     casse ; le remboursement va d'un portefeuille vers un compte d'argent. Destination mobile money vers un
         *     numéro autre que le numéro vérifié : conditions d'ADR-76 (voir `createMyRefundRequest`).
         */
        post: operations["postLateClaim"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/approval-requests": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Lister les demandes d'approbation (back-office)
         * @description Demandes du prestataire de la session (RLS), les plus récentes d'abord. Une demande `PENDING` dont
         *     `expires_at` est dépassée est renvoyée `EXPIRED`. Rôles back-office ; chaque personne voit les demandes
         *     des actions qu'elle peut lancer ou approuver.
         */
        get: operations["listApprovalRequests"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/approval-requests/{approval_request_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Consulter une demande d'approbation */
        get: operations["getApprovalRequest"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/approval-requests/{approval_request_id}/approve": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Approuver une demande et exécuter l'action (seconde personne)
         * @description Appelée par la seconde personne, connectée avec sa propre session (ADR-74). Le valideur est le `sub` de
         *     SA session ; aucun valideur n'est accepté dans le corps.
         *     1. Rôle : celui exigé par l'action (SPECIFICATION §3.2 ; ex. `SUPERVISOR` pour `WAIVE_SEQ_GAP`,
         *        `OPERATOR_ADMIN` pour `FORCE_CENTRAL_AUTHORITY`), sur la même portée ; sinon `403 FORBIDDEN`.
         *     2. Le serveur appelle `decide_approval_request(id, sub, true, note)` : demande expirée, déjà décidée, ou
         *        décidée par son auteur → `409 APPROVAL_INVALID` (`CL023`). Une demande expirée passe `EXPIRED`.
         *     3. Il exécute alors l'action une seule fois, avec les paramètres figés de la demande, l'auteur
         *        `requested_by` et le valideur `decided_by`. La demande passe `EXECUTED` (résultat dans `result`,
         *        transaction dans `executed_tx_id`) ou `FAILED` (code et raison dans `failure_code`,
         *        `failure_reason`). Une demande `FAILED` ne se rejoue pas : l'auteur en crée une nouvelle.
         *     La réponse est `200` dans les deux cas (`EXECUTED` ou `FAILED`) : la décision a été prise. Un rejeu avec
         *     la même clé d'idempotence renvoie la même réponse.
         */
        post: operations["approveApprovalRequest"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/approval-requests/{approval_request_id}/reject": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Refuser une demande d'approbation (seconde personne)
         * @description Appelée par une seconde personne connectée, avec le rôle exigé par l'action (sinon `403 FORBIDDEN`).
         *     Le serveur appelle `decide_approval_request(id, sub, false, note)` ; la demande passe `REJECTED` et
         *     rien n'est exécuté. Note obligatoire. Demande expirée, déjà décidée, ou refusée par son auteur :
         *     `409 APPROVAL_INVALID` (`CL023`). L'auteur qui veut retirer sa demande la laisse expirer.
         */
        post: operations["rejectApprovalRequest"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/ledgers/{ledger_id}/debit-authority": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Autorité de débit courante d'un grand livre */
        get: operations["getDebitAuthority"];
        put?: never;
        /**
         * Demander une bascule d'autorité de débit (CENTRAL ↔ EDGE)
         * @description Rôle `OPERATOR_ADMIN`. Séquence normative : sync_protocol.md §9.
         *     - `target = EDGE` : le central passe `debit_authority = EDGE` (époque +1) sous verrou exclusif,
         *       puis la passerelle rattrape la réplication jusqu'au filigrane avant de débiter.
         *     - `target = CENTRAL` : la passerelle cesse de débiter, vide sa file (`EDGE_SYNC`), puis libère
         *       (`releaseEdgeHandover`) ; le central rebascule seulement après vérification.
         *     - `force = true` (passerelle perdue) : exige la confirmation que la passerelle est hors service
         *       (`gateway_confirmed_offline = true`) et deux personnes (ADR-74) : l'appel crée une demande
         *       d'approbation (action `FORCE_CENTRAL_AUTHORITY`) et répond `202` avec l'`ApprovalRequest` `PENDING`.
         *       Une seconde personne `OPERATOR_ADMIN` (≠ appelant) l'approuve par `approveApprovalRequest`, qui appelle
         *       `force_central_authority` avec elle comme valideur et renvoie le `DebitAuthorityState` dans `result` ;
         *       la passerelle est révoquée.
         *     Une demande incompatible avec l'état courant (bascule déjà en cours, cible déjà en place, handover
         *     dans un état qui ne permet pas l'action) est refusée : `409 HANDOVER_INVALID_STATE` (`CL013`).
         *     Seules les fonctions de bascule (`grant_edge_authority`, `request_edge_release`,
         *     `force_central_authority`…) changent l'autorité ; `set_debit_authority` est interne.
         */
        post: operations["requestDebitAuthorityChange"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/edge/handovers/current": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Canal de contrôle de la passerelle (long-polling)
         * @description La passerelle interroge en continu (long-polling `wait` ≤ 25 s) ; sert aussi de battement de cœur
         *     (`edge_gateway.last_seen_at`). Renvoie la bascule en cours la concernant, ou `handover: null`.
         */
        get: operations["getCurrentEdgeHandover"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/edge/handovers/{handover_id}/ack": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * La passerelle confirme avoir pris l'autorité (TO_EDGE)
         * @description Envoyé quand la passerelle a appliqué la réplication jusqu'à `central_watermark_posting_id`.
         *     La passerelle NE DOIT débiter qu'après la réponse 200 de cet appel (`ack_edge_handover`).
         *     Refus : handover qui n'est pas `GRANTED` (`409 HANDOVER_INVALID_STATE`, `CL013`) ; filigrane non
         *     atteint (`409 EDGE_NOT_CAUGHT_UP`, `CL014`) ; époque différente (`409 STALE_AUTHORITY_EPOCH`, `CL015`).
         */
        post: operations["ackEdgeHandover"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/edge/handovers/{handover_id}/release": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * La passerelle rend l'autorité (TO_CENTRAL)
         * @description Envoyé après arrêt des débits locaux et envoi de toutes les opérations (`final_edge_seq`). À la
         *     réception de la demande, AVANT toute vérification, l'API passe le handover en `RELEASING`
         *     (sync_protocol.md §9.3, étape 5). Le central vérifie ensuite la continuité 1..final_edge_seq et la
         *     chaîne de hachage, puis rebascule `CENTRAL` (époque +1, `complete_edge_release`).
         *     Refus : opérations manquantes, `409 EDGE_NOT_CAUGHT_UP` (`CL014`) avec `missing_edge_seqs` (la
         *     passerelle reprend la vidange) ; chaîne différente de celle recalculée par le central,
         *     `409 CHAIN_BROKEN` (`CL017`, alerte, examen manuel) ; handover ni `RELEASE_REQUESTED` ni `RELEASING`,
         *     `409 HANDOVER_INVALID_STATE` (`CL013`) ; époque différente, `409 STALE_AUTHORITY_EPOCH` (`CL015`).
         */
        post: operations["releaseEdgeHandover"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/edge/replication-feed": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Flux de réplication central → passerelle
         * @description Changements depuis `after_posting_id` : soldes des portefeuilles modifiés (crédits centraux :
         *     recharges PSP, espèces en ligne, contre-passations), changements de statut des bracelets et des lots,
         *     nouveaux bracelets et PWD/PACK (chiffrés pour la clé d'accord de la passerelle). La passerelle
         *     mémorise `last_replicated_posting_id`.
         */
        get: operations["getEdgeReplicationFeed"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/edge/sync-batches": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Resynchronisation passerelle → central (EDGE_SYNC)
         * @description Même structure que `submitOfflineBatch`, numérotée par `edge_seq` (séquence propre à la passerelle).
         *     Chaque opération conserve la clé d'origine du terminal (`<serial>:<seq>`) : une opération déjà reçue
         *     directement du terminal est `DUPLICATE`. Écriture avec `source = EDGE_SYNC`, seule source autorisée
         *     à débiter un portefeuille quand `debit_authority = EDGE`. Un lot dont `epoch` n'est pas l'époque
         *     d'autorité de la passerelle est refusé (`409 STALE_AUTHORITY_EPOCH`), sauf pendant la vidange
         *     `RELEASING` de cette même époque.
         *     `Idempotency-Key` = `batch_id` du lot. Au plus 500 opérations et 1 Mio (`413 BATCH_TOO_LARGE` sinon).
         *     Refus :
         *     - `edge_seq_from` différent du suivant attendu : `409 SEQ_OUT_OF_ORDER` (`CL016`) ;
         *     - chaîne de la passerelle (`prev_chain_hash`, `last_chain_hash`) différente de celle recalculée par le
         *       central, ou chaîne d'un lot de terminal relayé rompue : `409 CHAIN_BROKEN` (`CL017`), alerte et
         *       examen manuel ;
         *     - signature de la passerelle, ou signature d'origine d'un lot de terminal relayé (`device_batches`),
         *       invalide : `400 BATCH_SIGNATURE_INVALID`, lot non traité.
         *     Une opération relayée d'un lot hors ligne de terminal (`DEVICE_OFFLINE`) ne porte pas de signature
         *     propre : la passerelle relaie tels quels l'en-tête et la signature du lot d'origine
         *     (sync_protocol.md §9.5).
         *     Chaque écriture `EDGE_SYNC` porte dans `metadata` : `origin_key` (clé d'origine `<serial>:<seq>`),
         *     `origin_occurred_at` (heure de l'opération) et `origin_mode` (`ONLINE_EDGE` pour `EDGE_ONLINE`,
         *     `OFFLINE` pour `DEVICE_OFFLINE`).
         *     Rejeu impossible d'une `ACTIVATION` ou d'un `DEPOSIT_CASH` : résultat `REJECTED`
         *     (`EDGE_REPLAY_FAILED`, `detail` = code de l'échec, sans `transaction_id`), anomalie `EDGE_REPLAY_FAILED` ; les espèces
         *     encaissées vont au compte d'attente (`SUSPENSE`) pour résolution (sync_protocol.md §9.6).
         */
        post: operations["submitEdgeSyncBatch"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
};
export type webhooks = {
    paymentIntentSucceeded: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * payment_intent.succeeded (sortant)
         * @description Envoyé au POS tiers quand la vente est écrite. En-tête `X-Cashless-Signature: t=<unix>,v1=<hex>` où
         *     `v1 = HMAC-SHA256(secret, t + "." + corps_brut)`. Répondre 2xx en moins de 5 s ; dédoublonner par
         *     `event_id`.
         */
        post: operations["onPaymentIntentSucceeded"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    paymentIntentAuthorized: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** payment_intent.authorized (sortant, capture MANUAL) */
        post: operations["onPaymentIntentAuthorized"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    paymentIntentCancelled: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** payment_intent.cancelled / payment_intent.expired / payment_intent.failed (sortant) */
        post: operations["onPaymentIntentCancelled"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    paymentIntentReversed: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** payment_intent.reversed (sortant) */
        post: operations["onPaymentIntentReversed"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/operators/{operator_id}/users": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Lister les personnes du personnel d'un prestataire
         * @description Personnes du prestataire du chemin, triées par date de création. Rôles : `PLATFORM_ADMIN`,
         *     `OPERATOR_ADMIN` du prestataire, `ORGANIZER_ADMIN` (limité aux personnes qui ont une attribution sur son
         *     organisateur ou ses événements, et à celles qu'il a créées).
         */
        get: operations["listUsers"];
        put?: never;
        /**
         * Créer une personne du personnel
         * @description Enregistre une personne connue du serveur d'identité (émetteur et sujet du jeton) dans le prestataire du
         *     chemin, sans rôle ; les rôles sont donnés ensuite par `grantRole`. (Émetteur, sujet) déjà connu :
         *     `409 CONFLICT_STATE`. Journalisé (`USER_CREATED`). Rôles : comme `listUsers`.
         */
        post: operations["createUser"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/operators/{operator_id}/users/{user_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Consulter une personne et ses attributions actives */
        get: operations["getUser"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/operators/{operator_id}/users/{user_id}/disable": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Désactiver une personne
         * @description Définitif : la personne ne peut plus s'authentifier (`401` dès la requête suivante) ; ses attributions sont
         *     conservées pour l'historique. Désactiver le dernier `PLATFORM_ADMIN` : `403 FORBIDDEN`. Déjà désactivée :
         *     `409 CONFLICT_STATE`. Journalisé (`USER_DISABLED`). Rôles : `PLATFORM_ADMIN`, `OPERATOR_ADMIN`.
         */
        post: operations["disableUser"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/operators/{operator_id}/users/{user_id}/role-assignments": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Attribuer un rôle sur une portée
         * @description Qui peut attribuer quoi : `PLATFORM_ADMIN` → `OPERATOR_ADMIN` (prestataire) ; `OPERATOR_ADMIN` →
         *     `OPERATOR_ADMIN`, `ORGANIZER_ADMIN`, `SUPERVISOR`, `CASHIER`, `MERCHANT_ADMIN` dans son prestataire ;
         *     `ORGANIZER_ADMIN` → `SUPERVISOR`, `CASHIER` sur son organisateur ou ses événements, `MERCHANT_ADMIN` sur les
         *     commerçants qui participent à ses événements. Jamais à soi-même (`403`). Droit insuffisant : `403`. Rôle et
         *     portée incompatibles, `VENDOR` ou `CUSTOMER` : `422 VALIDATION_FAILED`. Attribution active identique :
         *     `409 CONFLICT_STATE`. `PLATFORM_ADMIN` se donne par `createPlatformAdmin`. Journalisé (`ROLE_GRANTED`).
         */
        post: operations["grantRole"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/operators/{operator_id}/role-assignments/{assignment_id}/revoke": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Retirer une attribution de rôle
         * @description Même droit que pour attribuer ce rôle sur cette portée ; jamais sa propre attribution (`403`). Déjà retirée :
         *     `409 CONFLICT_STATE`. Retirer le dernier `PLATFORM_ADMIN` : `403 FORBIDDEN`. Journalisé (`ROLE_REVOKED`).
         */
        post: operations["revokeRole"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/platform-admins": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Créer un administrateur de la plateforme
         * @description Crée une personne de la plateforme (sans prestataire) et son attribution `PLATFORM_ADMIN`. Réservé à un
         *     `PLATFORM_ADMIN`, vérifié en base sur l'attribution active de l'appelant. Le premier administrateur est
         *     créé par la commande d'amorçage (`bootstrap-admin`), hors API. (Émetteur, sujet) déjà connu :
         *     `409 CONFLICT_STATE`. Journalisé (`PLATFORM_ADMIN_CREATED`). Sans `Idempotency-Key` : une personne de la
         *     plateforme n'a pas de prestataire, auquel toute clé d'idempotence est rattachée ; un rejeu est sans effet,
         *     puisque (émetteur, sujet) est unique (`409 CONFLICT_STATE`).
         */
        post: operations["createPlatformAdmin"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
};
export type components = {
    schemas: {
        /** @description RFC 9457 Problem Details, avec extensions stables. */
        Problem: {
            /**
             * Format: uri
             * @description `https://docs.cashless.test/problems/<code>`
             */
            type: string;
            title: string;
            status: number;
            detail?: string;
            instance?: string;
            code: components["schemas"]["ProblemCode"];
            /** Format: uuid */
            request_id: string;
            /** @description `true` si réessayer à l'identique (même clé d'idempotence) peut réussir. */
            retryable?: boolean;
            errors?: {
                /** @description JSON Pointer (RFC 6901) vers le champ fautif. */
                pointer: string;
                message: string;
            }[];
        } & {
            [key: string]: unknown;
        };
        /**
         * @description Codes métier stables (ne jamais renommer ; en ajouter est une évolution compatible). La traduction
         *     SQLSTATE → code suit SPECIFICATION §5.7 (jamais le texte du message SQL). Sens de chaque code :
         *     - `VALIDATION_FAILED` (400, ou 422 pour une valeur bien formée mais non prise en charge) : requête ou donnée invalide, y compris tout refus `CL001` de la base.
         *     - `UNAUTHENTICATED` (401) : jeton ou certificat absent, expiré ou invalide.
         *     - `FORBIDDEN` (403) : rôle insuffisant (y compris le valideur d'une demande d'approbation), ou refus de la
         *       base faute de seconde personne distincte de l'auteur (`23514`).
         *     - `APPROVAL_REQUIRED` (403) : opération de guichet qui exige une seconde personne, sans en-tête
         *       `X-Approval-Token` (ADR-74).
         *     - `APPROVAL_INVALID` : seconde validation refusée (ADR-74). Règle : `403` pour un jeton d'approbation sur
         *       place (invalide, expiré, déjà utilisé, d'une autre action ou de la même personne que l'appelant, rôle
         *       du valideur insuffisant) ; `409` (`CL023`) pour une demande d'approbation du back-office (expirée, déjà
         *       décidée, ou décidée par son auteur). 403 = la preuve jointe à la requête ne vaut rien ; 409 = l'état
         *       de la demande enregistrée ne permet plus la décision.
         *     - `NOT_FOUND` (404) : objet inexistant ou d'un autre prestataire (réponse neutre).
         *     - `RATE_LIMITED` (429) : trop de requêtes ou d'essais ; voir `Retry-After`.
         *     - `INTERNAL_ERROR` (500) : erreur interne ; réessayer avec la même clé d'idempotence.
         *     - `SERVICE_UNAVAILABLE` (503) : service momentanément indisponible ; réessayer avec la même clé.
         *     - `IDEMPOTENCY_KEY_REQUIRED` (400) : écriture sans en-tête `Idempotency-Key`.
         *     - `IDEMPOTENCY_KEY_REUSED` (409, `CL002`) : même clé, contenu différent.
         *     - `IDEMPOTENCY_KEY_IN_PROGRESS` (409) : requête concurrente avec la même clé encore en cours.
         *     - `ENROLLMENT_CODE_INVALID` (422) : code d'enrôlement inconnu ou déjà utilisé.
         *     - `ENROLLMENT_CODE_EXPIRED` (422) : code d'enrôlement expiré.
         *     - `ATTESTATION_FAILED` (422) : attestation de clé Android non conforme (clé hors du matériel sécurisé,
         *       bootloader déverrouillé, application non signée ou modifiée). Pas de MDM (ADR-69).
         *     - `REFRESH_TOKEN_INVALID` (401) : jeton de rafraîchissement inconnu, déjà consommé (la famille est
         *       révoquée) ou preuve de possession invalide.
         *     - `DEVICE_SUSPENDED` (403) : terminal suspendu.
         *     - `DEVICE_REVOKED` (403) : terminal révoqué (SQLSTATE `42501`).
         *     - `DEVICE_NOT_ASSIGNED` (409) : terminal sans affectation (événement, point de vente) pour cette action.
         *     - `DEVICE_MODE_NOT_ALLOWED` (422) : mode d'application non permis ; en V1, tout usage de `PAIRED_TPE`
         *       ou de `payment_intent_id` (V2, ADR-43).
         *     - `CLOCK_SKEW_TOO_LARGE` (400) : horloge du terminal hors de la tolérance (`clock_tolerance_seconds`).
         *     - `CURRENCY_MISMATCH` (422) : devise différente de celle de l'événement.
         *     - `AMOUNT_OUT_OF_RANGE` (422) : montant hors des bornes permises pour l'opération.
         *     - `INSUFFICIENT_FUNDS` (422, `CL007`) : solde disponible insuffisant (refus en ligne définitif).
         *     - `WALLET_BLOCKED` (422) : portefeuille bloqué ou clos.
         *     - `WALLET_LIMIT_EXCEEDED` (422, `CL008`) : plafond de solde dépassé.
         *     - `MONTHLY_TOPUP_LIMIT_EXCEEDED` (422, `CL009`) : plafond mensuel de recharge dépassé.
         *     - `MEDIA_UNKNOWN` (404) : UID ou bracelet inconnu (chemin en ligne ; dans un lot :
         *       `MEDIA_NOT_IN_SNAPSHOT`).
         *     - `MEDIA_BLOCKED` (422) : bracelet `SUSPENDED` ou `BLACKLISTED`.
         *     - `MEDIA_NOT_ACTIVATED` (422) : bracelet `PERSONALIZED` ou `ISSUED`, pas encore rattaché.
         *     - `MEDIA_RETIRED` (422) : bracelet `RETIRED` ou `DESTROYED`.
         *     - `MEDIA_REPLACED` (422) : bracelet remplacé par un autre.
         *     - `MEDIA_RELEASED` (422) : bracelet restitué.
         *     - `MEDIA_UID_MISMATCH` (422) : identité lue incohérente avec l'UID enregistré.
         *     - `MEDIA_CLONE_SUSPECTED` (422) : compteur déjà vu ou identité retirée ; bracelet mis en liste noire.
         *     - `MEDIA_SIGNATURE_MISMATCH` (422) : signature d'originalité différente de celle de la personnalisation
         *       (résultat `SIGNATURE_MISMATCH`) ; bracelet mis en liste noire (ADR-59).
         *     - `MEDIA_SIGNATURE_MISSING` (422) : signature d'originalité absente alors que la puce en a une enregistrée
         *       (résultat `SIGNATURE_MISSING`) ; relire le bracelet. Pas de liste noire.
         *     - `MEDIA_STATE_INVALID` (409, `CL020`) : bracelet ou lot dans un état qui ne permet pas l'action
         *       (remplacement, restitution avec espèces dues, rendu d'espèces sans somme due, lot, caution).
         *     - `MEDIA_WRONG_EVENT` (422) : bracelet d'un lot d'un autre événement.
         *     - `MEDIA_BATCH_INACTIVE` (422) : lot du bracelet non `ACTIVE`.
         *     - `MEDIA_CLAIM_INVALID` (422) : code de rattachement inconnu ou déjà utilisé (réponse identique).
         *     - `TAP_EXPIRED` (422) : `tap_id` au-delà de `tap_replay_window_seconds` (défaut 120 s), contrôle de l'API
         *       avant écriture ; relire le bracelet.
         *     - `TAP_ALREADY_USED` (409) : `tap_id` déjà consommé par une autre opération, ou présenté par un autre
         *       terminal (contrôle de l'API avant écriture).
         *     - `TAP_UNUSABLE` (409, `CL022`) : refus de `consume_tap` : passage déjà utilisé par une autre écriture, ou
         *       écriture en ligne plus de `tap_replay_window_seconds` après la lecture ; relire le bracelet.
         *     - `ACTIVATION_MODE_NOT_ALLOWED` (422) : mode d'activation absent de `event.activation_modes`.
         *     - `ACCOUNT_REQUIRED` (422) : `identity_mode = ACCOUNT_REQUIRED` et aucun compte client fourni.
         *     - `DEPOSIT_OUTSTANDING` (409) : caution encore `HELD` ; la rendre avant la restitution.
         *     - `BALANCE_OUTSTANDING` (409) : portefeuille non soldé ; restitution impossible.
         *     - `DEPOSIT_PAYMENT_REQUIRED` (422) : caution `SEPARATE` sans moyen de paiement (`deposit_payment`).
         *     - `EVENT_CLOSING` (409, `CL004`) : grand livre en clôture ; recharges et ventes en ligne refusées.
         *     - `LEDGER_LOCKED` (409, `CL003`) : grand livre verrouillé.
         *     - `PERIOD_CLOSED` (409, `CL005`) : date dans une période close.
         *     - `DEBIT_AUTHORITY_EDGE` (409, `CL006`) : débits autorisés par la passerelle ; rejouer la même requête
         *       (même clé) vers `edge_base_url`. Pas un refus.
         *     - `DEBIT_AUTHORITY_MOVING` (409) : bascule d'autorité en cours (passerelle en `RELEASING`). Pas un
         *       refus définitif : garder la même clé, passer hors ligne si la politique le permet, puis rejouer vers
         *       la nouvelle autorité (sync_protocol.md §5.1, §9.3).
         *     - `STALE_AUTHORITY_EPOCH` (409, `CL015`) : époque d'autorité périmée ; l'émetteur cesse de débiter.
         *     - `HANDOVER_INVALID_STATE` (409, `CL013`) : action de bascule impossible dans l'état du handover.
         *     - `EDGE_NOT_CAUGHT_UP` (409, `CL014`) : passerelle en retard (filigrane non atteint, `edge_seq` manquants).
         *     - `REVERSAL_NOT_ALLOWED` (422) : transaction non annulable (type, auteur ou terminal différent).
         *     - `REVERSAL_WINDOW_EXPIRED` (409) : délai d'annulation dépassé.
         *     - `ALREADY_REVERSED` (409) : transaction déjà annulée.
         *     - `OFFLINE_NOT_ALLOWED` (403) : hors ligne désactivé pour ce terminal (seul nom de ce refus).
         *     - `SNAPSHOT_VERSION_UNKNOWN` (409) : version de snapshot inconnue pour ce grand livre ; demander un FULL.
         *     - `BATCH_IN_PROGRESS` (409, `CL010`) : un lot est déjà en cours pour ce terminal ; attendre son résultat.
         *     - `BATCH_TOO_LARGE` (413, `CL011`) : lot vide ou de plus de 500 opérations ou 1 Mio.
         *     - `BATCH_SIGNATURE_INVALID` (400) : signature de l'en-tête du lot invalide ; lot non traité.
         *     - `CHAIN_BROKEN` (409, `CL017`) : chaîne de hachage rompue (terminal ou passerelle) ; alerte, examen manuel.
         *     - `SEQ_OUT_OF_ORDER` (400 pour un lot de terminal non continu ; 409, `CL016`, pour un `edge_seq`
         *       qui n'est pas le suivant attendu).
         *     - `SEQ_GAP_NOT_FOUND` (409, `CL012`) : le numéro à lever n'est pas un trou connu.
         *     - `SEQ_OUT_OF_RANGE` (409, `CL021`) : numéro ou lot au-delà de `contiguous_acked_seq + 10 000`
         *       (`max_seq_jump`) ; refusé sans anomalie.
         *     - `PAYMENT_REQUEST_EXPIRED` (409) : demande de paiement QR expirée.
         *     - `PAYMENT_REQUEST_NOT_PENDING` (409) : demande de paiement QR déjà payée, annulée ou expirée.
         *     - `QR_TOKEN_INVALID` (422) : jeton de QR client inconnu, expiré ou déjà utilisé.
         *     - `PAYMENT_INTENT_INVALID_STATE` (409, V2) : intention dans un état qui ne permet pas l'action.
         *     - `PAYMENT_INTENT_EXPIRED` (409, V2) : intention expirée.
         *     - `PSP_UNAVAILABLE` (503) : PSP injoignable ; réessayer avec la même clé.
         *     - `PSP_NOT_CONFIGURED` (409) : aucune configuration PSP valide pour ce moyen et cet événement (S26b ou défaut de l'organisateur, titulaire = détenteur des fonds, ADR-72).
         *     - `PSP_REJECTED` (422) : paiement refusé par le PSP.
         *     - `WEBHOOK_SIGNATURE_INVALID` (401) : signature HMAC du webhook entrant invalide.
         *     - `WEBHOOK_TIMESTAMP_OUT_OF_TOLERANCE` (401) : horodatage du webhook hors tolérance (rejeu suspect).
         *     - `REFUND_NOT_ALLOWED` (422) : remboursement impossible (solde payé nul, destination non vérifiée…).
         *     - `REFUND_WINDOW_CLOSED` (422) : fenêtre de remboursement close.
         *     - `REFUND_ALREADY_OPEN` (409) : une demande de remboursement est déjà ouverte pour ce portefeuille.
         *     - `OTP_INVALID` (422) : code à usage unique faux, expiré ou déjà utilisé.
         *     - `CARD_DAILY_LIMIT` (422) : plafond de recharge par carte et par jour atteint (ADR-77).
         *     - `OTP_RATE_LIMITED` (429) : trop de demandes ou d'essais de code à usage unique (défauts : 3 envois par
         *       numéro sur 15 min, 10 demandes par IP et par heure, 5 essais par code puis blocage du numéro 30 min).
         *     - `CONFLICT_STATE` (409) : objet dans un état qui ne permet pas l'action (ex. demande de
         *       remboursement qui n'est pas `REQUESTED` à l'approbation).
         *     - `EVENT_TRANSITION_INVALID` (409, `CL018`) : passage de statut d'événement non prévu (ADR-51).
         *     - `CLOSING_CONDITION_NOT_MET` (409, `CL019`) : condition de clôture calculable non remplie ; le détail nomme la condition (ADR-51).
         * @enum {string}
         */
        ProblemCode: "VALIDATION_FAILED" | "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND" | "RATE_LIMITED" | "INTERNAL_ERROR" | "SERVICE_UNAVAILABLE" | "IDEMPOTENCY_KEY_REQUIRED" | "IDEMPOTENCY_KEY_REUSED" | "IDEMPOTENCY_KEY_IN_PROGRESS" | "ENROLLMENT_CODE_INVALID" | "ENROLLMENT_CODE_EXPIRED" | "ATTESTATION_FAILED" | "REFRESH_TOKEN_INVALID" | "DEVICE_SUSPENDED" | "DEVICE_REVOKED" | "DEVICE_NOT_ASSIGNED" | "DEVICE_MODE_NOT_ALLOWED" | "CLOCK_SKEW_TOO_LARGE" | "CURRENCY_MISMATCH" | "AMOUNT_OUT_OF_RANGE" | "INSUFFICIENT_FUNDS" | "WALLET_BLOCKED" | "WALLET_LIMIT_EXCEEDED" | "MONTHLY_TOPUP_LIMIT_EXCEEDED" | "MEDIA_UNKNOWN" | "MEDIA_BLOCKED" | "MEDIA_NOT_ACTIVATED" | "MEDIA_RETIRED" | "MEDIA_REPLACED" | "MEDIA_RELEASED" | "MEDIA_UID_MISMATCH" | "MEDIA_CLONE_SUSPECTED" | "MEDIA_SIGNATURE_MISMATCH" | "MEDIA_SIGNATURE_MISSING" | "MEDIA_STATE_INVALID" | "MEDIA_WRONG_EVENT" | "MEDIA_BATCH_INACTIVE" | "MEDIA_CLAIM_INVALID" | "TAP_EXPIRED" | "TAP_ALREADY_USED" | "TAP_UNUSABLE" | "ACTIVATION_MODE_NOT_ALLOWED" | "ACCOUNT_REQUIRED" | "DEPOSIT_OUTSTANDING" | "BALANCE_OUTSTANDING" | "DEPOSIT_PAYMENT_REQUIRED" | "EVENT_CLOSING" | "LEDGER_LOCKED" | "PERIOD_CLOSED" | "DEBIT_AUTHORITY_EDGE" | "DEBIT_AUTHORITY_MOVING" | "STALE_AUTHORITY_EPOCH" | "HANDOVER_INVALID_STATE" | "EDGE_NOT_CAUGHT_UP" | "REVERSAL_NOT_ALLOWED" | "REVERSAL_WINDOW_EXPIRED" | "ALREADY_REVERSED" | "OFFLINE_NOT_ALLOWED" | "SNAPSHOT_VERSION_UNKNOWN" | "BATCH_IN_PROGRESS" | "BATCH_TOO_LARGE" | "BATCH_SIGNATURE_INVALID" | "CHAIN_BROKEN" | "SEQ_OUT_OF_ORDER" | "SEQ_GAP_NOT_FOUND" | "SEQ_OUT_OF_RANGE" | "PAYMENT_REQUEST_EXPIRED" | "PAYMENT_REQUEST_NOT_PENDING" | "QR_TOKEN_INVALID" | "PAYMENT_INTENT_INVALID_STATE" | "PAYMENT_INTENT_EXPIRED" | "PSP_UNAVAILABLE" | "PSP_NOT_CONFIGURED" | "PSP_REJECTED" | "WEBHOOK_SIGNATURE_INVALID" | "WEBHOOK_TIMESTAMP_OUT_OF_TOLERANCE" | "REFUND_NOT_ALLOWED" | "REFUND_WINDOW_CLOSED" | "REFUND_ALREADY_OPEN" | "OTP_INVALID" | "OTP_RATE_LIMITED" | "CONFLICT_STATE" | "EVENT_TRANSITION_INVALID" | "CLOSING_CONDITION_NOT_MET" | "APPROVAL_REQUIRED" | "APPROVAL_INVALID" | "LATE_CLAIM_INVALID" | "CARD_DAILY_LIMIT";
        PageMeta: {
            next_cursor: string | null;
            has_more: boolean;
        };
        /**
         * Format: int64
         * @description Montant strictement positif en unités mineures de la devise.
         */
        Amount: number;
        /**
         * Format: int64
         * @description Montant signé en unités mineures.
         */
        SignedAmount: number;
        /**
         * @description Code ISO 4217 (devise unique de l'événement).
         * @example XOF
         */
        Currency: string;
        /** @description 32 octets en hexadécimal minuscule. */
        Hex32: string;
        /** @description UID constructeur 7 octets en hexadécimal minuscule. */
        NfcUid: string;
        /** Format: date-time */
        Timestamp: string;
        /**
         * @description Liste fermée des types du grand livre (contrainte CHECK de journal_transaction.type ; voir SPECIFICATION.md).
         * @enum {string}
         */
        TransactionType: "TOPUP" | "TOPUP_CASH" | "PROMO_CREDIT" | "PROMO_EXPIRY" | "ACTIVATION_FEE" | "DEPOSIT_TAKEN" | "DEPOSIT_REFUNDED" | "DEPOSIT_FORFEITED" | "PURCHASE" | "REVERSAL" | "PITCH_FEE" | "OPERATOR_FEE" | "PLATFORM_FEE" | "ANOMALY_RESOLUTION" | "CASH_CLOSE" | "CASH_DEPOSIT" | "PSP_SETTLEMENT" | "CHARGEBACK" | "WALLET_REFUND" | "BREAKAGE" | "PAYOUT_INITIATED" | "PAYOUT_CONFIRMED" | "PAYOUT_FAILED" | "ADJUSTMENT" | "MERCHANT_DEBT_TRANSFER" | "BREAKAGE_REVERSAL";
        /** @enum {string} */
        TransactionSource: "ONLINE" | "OFFLINE_SYNC" | "EDGE_SYNC" | "PSP_WEBHOOK" | "BATCH" | "BACKOFFICE";
        Balance: {
            /**
             * Format: int64
             * @description Solde disponible = paid + promo (wallet_spendable).
             */
            spendable: number;
            /**
             * Format: int64
             * @description Crédits payés (WALLET_PAID), remboursables.
             */
            paid: number;
            /**
             * Format: int64
             * @description Crédits offerts (WALLET_PROMO), non remboursables.
             */
            promo: number;
        };
        /**
         * @description Mode d'application du terminal. `PAIRED_TPE` (TPE associé à une caisse tierce) est **V2 (ADR-43)** :
         *     valeur conservée pour la compatibilité future, mais toute création de code d'enrôlement ou tout
         *     enrôlement avec cette valeur est refusé en V1 (`422 DEVICE_MODE_NOT_ALLOWED`) ; la base ne l'accepte pas.
         * @enum {string}
         */
        DeviceAppMode: "CATALOG_POS" | "KEYPAD_TPE" | "TOPUP_DESK" | "PAIRED_TPE";
        /** @enum {string} */
        DeviceKind: "POS" | "TOPUP";
        /** @enum {string} */
        DeviceStatus: "ACTIVE" | "SUSPENDED" | "REVOKED";
        EnrollmentCodeCreate: {
            /** Format: uuid */
            event_id?: string;
            /** Format: uuid */
            pos_id?: string;
            station_name?: string;
            app_mode: components["schemas"]["DeviceAppMode"];
            kind: components["schemas"]["DeviceKind"];
            /**
             * @description Qui fournit le terminal ; désigne qui porte la perte d'une opération non conforme (ADR-58).
             * @default OPERATOR
             * @enum {string}
             */
            provided_by: "PLATFORM" | "OPERATOR" | "ORGANIZER" | "MERCHANT";
            /** @default 86400 */
            expires_in_seconds: number;
        };
        EnrollmentCode: {
            /** Format: uuid */
            enrollment_code_id: string;
            code: string;
            expires_at: components["schemas"]["Timestamp"];
            app_mode: components["schemas"]["DeviceAppMode"];
        };
        DeviceEnrollmentRequest: {
            enrollment_code: string;
            /** @description Numéro de série logique du terminal (préfixe des clés d'idempotence). */
            serial: string;
            /** @enum {string} */
            os: "ANDROID" | "IOS";
            app_version: string;
            /** @description Clé publique ECDSA P-256 (SubjectPublicKeyInfo DER) → `device.public_key`. */
            signing_public_key: string;
            /** @description Clé publique ECDH P-256 (SPKI DER) pour le chiffrement des PWD/PACK. */
            agreement_public_key: string;
            /** @description Chaîne d'attestation Android Key Attestation (iOS : App Attest). */
            key_attestation_chain: string[];
            /** @description CSR PKCS#10 signé par la clé de signature (pour obtenir un certificat mTLS). */
            csr_pem?: string;
        };
        DeviceEnrollmentResponse: {
            /** Format: uuid */
            device_id: string;
            serial: string;
            certificate_pem?: string | null;
            access_token: string;
            /** @constant */
            token_type: "Bearer";
            expires_in: number;
            refresh_token: string;
            /** Format: int64 */
            next_seq: number;
            server_time: components["schemas"]["Timestamp"];
        };
        DeviceTokenRefreshRequest: {
            serial: string;
            refresh_token: string;
            nonce: string;
            signature: string;
        };
        TokenResponse: {
            access_token: string;
            /** @constant */
            token_type: "Bearer";
            expires_in: number;
            refresh_token: string;
        };
        /** @description Politique hors ligne EFFECTIVE (effective_offline_policy) ; 0 = interdit. */
        OfflinePolicy: {
            offline_enabled: boolean;
            /** Format: int64 */
            max_per_sale: number;
            /** Format: int64 */
            max_per_media_per_device: number;
            /** Format: int64 */
            max_total_per_device: number;
            /**
             * @description Âge maximal du snapshot pour autoriser hors ligne (paramètre `max_snapshot_age`, défaut 900 s =
             *     15 min). Au-delà, le terminal refuse toute nouvelle opération hors ligne (sync_protocol.md §4.3).
             * @default 900
             */
            max_snapshot_age_seconds: number;
            cash_topup_offline: boolean;
            /** @description Vrai si le plafond prestataire a réduit une valeur demandée. */
            capped: boolean;
        };
        DebitAuthority: {
            /** Format: uuid */
            ledger_id: string;
            /** @enum {string} */
            authority: "CENTRAL" | "EDGE";
            /**
             * Format: int64
             * @description Époque d'autorité, incrémentée à chaque bascule (jeton d'exclusion).
             */
            epoch: number;
            /** Format: uuid */
            edge_gateway_id: string | null;
            /** Format: uri */
            edge_base_url: string | null;
        };
        CatalogItem: {
            /** Format: uuid */
            product_id: string;
            name: string;
            unit_price: components["schemas"]["Amount"];
            category?: string;
            vat_rate_bps?: number;
        };
        DeviceConfig: {
            /** @description Réglages de fonctionnement de l'événement (ADR-61, SPECIFICATION §9.8), bornés par la base. */
            terminal_settings: {
                /** @default 2000 */
                online_connect_timeout_ms: number;
                /** @default 3000 */
                online_total_timeout_ms: number;
                /** @default 2 */
                online_retries: number;
                /** @default 30 */
                pending_sync_seconds: number;
                /** @default 300 */
                reconcile_sync_seconds: number;
                /** @default 60 */
                heartbeat_seconds: number;
                /** @default 15 */
                reversal_window_minutes: number;
                /** @default 7 */
                local_retention_days: number;
                /** @default 120 */
                tap_replay_window_seconds: number;
            };
            /**
             * Format: int64
             * @description Identifiant de la configuration servie (`device_config_served.id`), stable tant que la politique
             *     effective, l'époque et le plancher de séquence ne changent pas. Le terminal le recopie dans chaque
             *     opération qu'il autorise hors ligne (`OfflineOperation.config_id`, champ d'état non chaîné, comme
             *     `snapshot_version`) : le serveur contrôle les plafonds de CETTE configuration (sync_protocol.md §7.2).
             */
            config_id: number;
            device: {
                /** Format: uuid */
                device_id: string;
                serial: string;
                kind: components["schemas"]["DeviceKind"];
                app_mode: components["schemas"]["DeviceAppMode"];
                /** @enum {string} */
                os: "ANDROID" | "IOS";
                nfc_enabled: boolean;
                status: components["schemas"]["DeviceStatus"];
                station_name?: string | null;
            };
            event: {
                /** Format: uuid */
                event_id: string;
                name: string;
                currency: components["schemas"]["Currency"];
                minor_units: number;
                timezone: string;
                /** @enum {string} */
                status: "DRAFT" | "LIVE" | "CLOSING" | "RECONCILING" | "SETTLING" | "REFUND_WINDOW" | "CLOSED";
                activation_modes: ("DESK" | "SELF_APP" | "FIRST_TOPUP")[];
            };
            pos?: {
                /** Format: uuid */
                pos_id?: string;
                name?: string;
                merchant_name?: string;
            } | null;
            /** @description Présent pour CATALOG_POS ; absent (null) pour KEYPAD_TPE / TOPUP_DESK. */
            catalog?: {
                version?: number;
                items?: components["schemas"]["CatalogItem"][];
            } | null;
            offline_policy: components["schemas"]["OfflinePolicy"];
            /**
             * @description Clés publiques valides pour vérifier les snapshots (rotation par `key_id`), au plus deux par
             *     signataire : le central (clé dans le KMS/HSM) et chaque passerelle (clé propre, hors KMS, dans son
             *     stockage matériel, `key_id` distinct) — sync_protocol.md §4.1.
             */
            snapshot_keys: {
                key_id: string;
                /**
                 * @description `ECDSA_P256_SHA256` par défaut ; Ed25519 si le KMS le permet (POINTS_OUVERTS OP-N13).
                 * @enum {string}
                 */
                algorithm: "ECDSA_P256_SHA256" | "Ed25519";
                public_key: string;
                not_after?: components["schemas"]["Timestamp"];
            }[];
            debit_authority: components["schemas"]["DebitAuthority"];
            seq: {
                /**
                 * Format: int64
                 * @description Le terminal DOIT utiliser seq ≥ max(local + 1, next_seq_floor).
                 */
                next_seq_floor: number;
                /** Format: int64 */
                contiguous_acked_seq: number;
            };
            server_time: components["schemas"]["Timestamp"];
            /** @default 120 */
            clock_tolerance_seconds: number;
        };
        HeartbeatRequest: {
            device_time: components["schemas"]["Timestamp"];
            /** Format: int64 */
            snapshot_version?: number | null;
            /** Format: int64 */
            last_local_seq: number;
            pending_operations: number;
            /**
             * Format: int64
             * @description Somme des débits hors ligne non acquittés.
             */
            pending_exposure?: number;
            battery_percent?: number;
            app_version?: string;
        };
        HeartbeatResponse: {
            server_time: components["schemas"]["Timestamp"];
            config_etag: string;
            /** Format: int64 */
            latest_snapshot_version: number | null;
            debit_authority: components["schemas"]["DebitAuthority"];
            /** @description Le serveur demande l'envoi immédiat des opérations en attente. */
            sync_requested: boolean;
        };
        SeqStatus: {
            device_serial: string;
            /** Format: int64 */
            contiguous_acked_seq: number;
            /** Format: int64 */
            max_seen_seq: number;
            missing_seqs: number[];
            /** Format: int64 */
            next_seq_floor: number;
        };
        /**
         * @description Résultat de `register_tap` (champ `result`). `SIGNATURE_MISSING` n'existe qu'en ligne : hors ligne, une
         *     signature absente ouvre une anomalie `SIGNATURE_MISMATCH` et l'opération est gardée.
         * @enum {string}
         */
        TapResultCode: "OK" | "UNKNOWN" | "BLOCKED" | "UID_MISMATCH" | "SIGNATURE_MISMATCH" | "SIGNATURE_MISSING" | "CLONE_SUSPECTED" | "RETIRED" | "REPLACED" | "NOT_ACTIVATED" | "RELEASED" | "BATCH_INACTIVE" | "WRONG_EVENT";
        /** @enum {string} */
        MediaStatus: "PERSONALIZED" | "ISSUED" | "ACTIVE" | "SUSPENDED" | "REPLACED" | "BLACKLISTED" | "RELEASED" | "RETIRED" | "DESTROYED";
        /** @enum {string} */
        DepositStatus: "NONE" | "DUE" | "HELD" | "REFUNDED" | "FORFEITED";
        /** @enum {string} */
        WalletStatus: "ACTIVE" | "BLOCKED" | "CLOSED";
        /** @description Lecture d'un bracelet MIFARE Ultralight EV1 (format B). */
        TapInput: {
            nfc_uid: components["schemas"]["NfcUid"];
            token_hash: components["schemas"]["Hex32"];
            /** @description Valeur du compteur 24 bits lue par READ_CNT après INCR_CNT. */
            counter: number;
            key_index: number;
            /** @default 1 */
            format_major: number;
            /** @default 0 */
            format_minor: number;
            /** @description Le PACK renvoyé par le tag après PWD_AUTH correspond au PACK attendu. DOIT être true. */
            pack_verified: boolean;
            /**
             * @description Signature d'originalité NXP (READ_SIG, 32 octets), lue à chaque passage et vérifiée par le terminal
             *     (ADR-59). Le terminal DOIT l'envoyer. Le serveur la compare à celle de la personnalisation : différente
             *     → `SIGNATURE_MISMATCH` ; absente alors que la puce en a une → `SIGNATURE_MISSING` en ligne, anomalie
             *     `SIGNATURE_MISMATCH` hors ligne (opération gardée).
             */
            originality_signature?: string;
            occurred_at: components["schemas"]["Timestamp"];
        };
        MediaAuthKeyRequest: {
            nfc_uid: components["schemas"]["NfcUid"];
            key_index: number;
        };
        EncryptedBlob: {
            alg?: string;
            /** @description Clé publique éphémère ECDH (point non compressé, base64url). */
            epk?: string;
            nonce: string;
            ciphertext: string;
            tag: string;
        };
        /**
         * @description Clé de contenu AES-256 (propre au snapshot) enveloppée pour la clé d'accord ECDH P-256 du terminal
         *     (ECDH-ES + HKDF-SHA256 + AES Key Wrap). Elle déchiffre les `pwd_pack_enc` des entrées.
         */
        WrappedKey: {
            /** @constant */
            alg: "ECDH-ES+HKDF-SHA256+A256KW";
            /** @description Clé publique éphémère (base64url). */
            epk: string;
            wrapped_key: string;
        };
        MediaAuthKey: {
            nfc_uid: components["schemas"]["NfcUid"];
            key_index: number;
            enc: components["schemas"]["EncryptedBlob"];
            /** @description Durée pendant laquelle le terminal peut garder le PWD en mémoire vive. */
            ttl_seconds: number;
        };
        WalletSummary: {
            /** Format: uuid */
            wallet_id: string;
            status: components["schemas"]["WalletStatus"];
            currency: components["schemas"]["Currency"];
            /** Format: int64 */
            spendable: number;
            /** Format: int64 */
            paid: number;
            /** Format: int64 */
            promo: number;
        };
        TapResponse: {
            /**
             * Format: int64
             * @description media_tap.id ; null si la lecture n'a pas été enregistrée (UNKNOWN, RETIRED…).
             */
            tap_id: number | null;
            result: components["schemas"]["TapResultCode"];
            /** Format: date-time */
            tap_expires_at: string | null;
            media: null | {
                /** Format: uuid */
                media_id: string;
                status: components["schemas"]["MediaStatus"];
                /** @enum {string} */
                batch_kind?: "PUBLIC" | "STAFF" | "VIP";
                deposit_status: components["schemas"]["DepositStatus"];
                /** Format: int64 */
                deposit_held?: number;
            };
            wallet: null | components["schemas"]["WalletSummary"];
        };
        Media: {
            /** Format: uuid */
            media_id: string;
            /** @enum {string} */
            kind: "NFC_TAG" | "CARD" | "QR";
            chip_type?: string;
            nfc_uid?: components["schemas"]["NfcUid"] | null;
            key_index: number;
            status: components["schemas"]["MediaStatus"];
            /** Format: uuid */
            batch_id?: string | null;
            /** @enum {string} */
            batch_kind?: "PUBLIC" | "STAFF" | "VIP";
            deposit_status: components["schemas"]["DepositStatus"];
            /** Format: int64 */
            deposit_held?: number;
            wallet_ids?: string[];
            /** Format: int64 */
            last_counter?: number | null;
        };
        /**
         * @description Moyen d'encaissement / de restitution hors portefeuille. Pour un remboursement : jamais `CARD` en V1 ;
         *     mobile money vers un numéro autre que le numéro vérifié du titulaire : conditions d'ADR-76.
         */
        MoneyMovement: {
            /** @enum {string} */
            method: "CASH" | "WAVE" | "ORANGE_MONEY" | "CARD";
            msisdn?: string;
        };
        MediaActivationRequest: {
            /** Format: int64 */
            tap_id: number;
            /**
             * @description SELF_APP passe par POST /me/media.
             * @enum {string}
             */
            channel: "DESK" | "FIRST_TOPUP";
            /** Format: uuid */
            wallet_id?: string | null;
            /** Format: uuid */
            customer_id?: string | null;
            deposit_payment?: components["schemas"]["MoneyMovement"] | null;
            occurred_at: components["schemas"]["Timestamp"];
        };
        DepositState: {
            status: components["schemas"]["DepositStatus"];
            /** Format: int64 */
            amount: number;
            /** @enum {string|null} */
            mode?: "FROM_BALANCE" | "SEPARATE" | null;
            /** Format: uuid */
            transaction_id?: string | null;
        };
        MediaActivationResponse: {
            /** Format: uuid */
            media_id: string;
            media_status: components["schemas"]["MediaStatus"];
            wallet: components["schemas"]["WalletSummary"];
            deposit: components["schemas"]["DepositState"];
        };
        DepositRequest: {
            /** Format: int64 */
            tap_id?: number;
            tap?: components["schemas"]["TapInput"];
            payment?: components["schemas"]["MoneyMovement"];
        };
        /** @description Espèces uniquement (voir `releaseMedia`). */
        MediaReleaseRequest: {
            /** Format: int64 */
            tap_id?: number;
            tap?: components["schemas"]["TapInput"];
            /**
             * Format: uuid
             * @description Session de caisse ouverte ; obligatoire si des espèces sont rendues.
             */
            cash_session_id?: string;
            refund_deposit_by?: components["schemas"]["CashMovement"];
            settle_balance?: components["schemas"]["CashMovement"];
        };
        MediaReleaseResponse: {
            /** Format: uuid */
            media_id: string;
            media_status: components["schemas"]["MediaStatus"];
            /** Format: uuid */
            deposit_refund_transaction_id?: string | null;
            /**
             * Format: uuid
             * @description Transaction `PROMO_EXPIRY` des crédits offerts restants (null s'il n'y en avait pas).
             */
            promo_expiry_transaction_id?: string | null;
            /**
             * Format: uuid
             * @description Transaction `WALLET_REFUND` du solde payé (null si le solde payé était nul).
             */
            balance_refund_transaction_id?: string | null;
            /**
             * Format: int64
             * @description Montant total en espèces à remettre au festivalier.
             */
            cash_to_hand_back?: number;
        };
        SaleLine: {
            /** Format: uuid */
            product_id?: string;
            label?: string;
            quantity: number;
            unit_price: components["schemas"]["Amount"];
        };
        /**
         * @description Exactement un moyen parmi `tap_id`, `tap`, `customer_qr_token`, `payment_intent_id`. Si `lines`
         *     est présent, `amount` DOIT être égal à Σ quantity × unit_price.
         *     `payment_intent_id` est V2 (ADR-43) : en V1, le serveur le refuse (`422 DEVICE_MODE_NOT_ALLOWED`).
         */
        PaymentRequestBody: {
            amount: components["schemas"]["Amount"];
            currency: components["schemas"]["Currency"];
            occurred_at: components["schemas"]["Timestamp"];
            /** Format: int64 */
            tap_id?: number;
            tap?: components["schemas"]["TapInput"];
            customer_qr_token?: string;
            /** @description **V2 (ADR-43)** — intention d'un POS tiers présentée par un terminal `PAIRED_TPE`. Refusé en V1 (`422 DEVICE_MODE_NOT_ALLOWED`). */
            payment_intent_id?: string;
            lines?: components["schemas"]["SaleLine"][];
        } & (unknown | unknown | unknown | unknown);
        PaymentResult: {
            /** Format: uuid */
            transaction_id: string;
            idempotency_key: string;
            type: components["schemas"]["TransactionType"];
            /** @enum {string} */
            status: "SUCCEEDED";
            /** Format: uuid */
            reverses_id?: string | null;
            amount: components["schemas"]["Amount"];
            currency: components["schemas"]["Currency"];
            occurred_at: components["schemas"]["Timestamp"];
            recorded_at: components["schemas"]["Timestamp"];
            /** Format: uuid */
            media_id?: string | null;
            /** Format: uuid */
            wallet_id?: string;
            balance_after: components["schemas"]["Balance"];
            receipt_number?: string;
        };
        ReversalRequest: {
            /** @enum {string} */
            reason: "INPUT_ERROR" | "CUSTOMER_CANCELLED" | "PRODUCT_UNAVAILABLE" | "DUPLICATE" | "OTHER";
            comment?: string;
            occurred_at: components["schemas"]["Timestamp"];
            /** @description Preuve de validation superviseur au-delà de la fenêtre (jeton court signé). */
            supervisor_pin_proof?: string;
        };
        CashTopupRequest: {
            amount: components["schemas"]["Amount"];
            currency: components["schemas"]["Currency"];
            occurred_at: components["schemas"]["Timestamp"];
            /** Format: int64 */
            tap_id?: number;
            tap?: components["schemas"]["TapInput"];
            /**
             * Format: int64
             * @description Espèces remises (pour calcul du rendu, informatif).
             */
            cash_tendered?: number;
            /**
             * Format: uuid
             * @description Session de caisse ouverte de la station ; une recharge `TOPUP_CASH` est rattachée à une session (SPECIFICATION §5.3).
             */
            cash_session_id?: string;
        } & (unknown | unknown);
        TopupResult: {
            /** Format: uuid */
            transaction_id: string;
            idempotency_key: string;
            /** @enum {string} */
            type: "TOPUP_CASH" | "TOPUP";
            /** @enum {string} */
            status: "SUCCEEDED";
            amount: components["schemas"]["Amount"];
            currency: components["schemas"]["Currency"];
            /** Format: uuid */
            wallet_id: string;
            balance_after: components["schemas"]["Balance"];
            deposit?: components["schemas"]["DepositState"] | null;
        };
        /**
         * @description Moyen de paiement choisi par le payeur (ADR-70). WAVE et ORANGE_MONEY : intégrations directes. CARD :
         *     traité par le PSP carte que le prestataire a configuré pour l'organisateur (agrégateur local comme
         *     PayDunya, ou PSP international comme Stripe) ; refusé (`422 VALIDATION_FAILED`) si l'organisateur n'a
         *     aucun PSP carte actif.
         * @enum {string}
         */
        PspProvider: "WAVE" | "ORANGE_MONEY" | "CARD";
        PspTopupRequest: {
            /** Format: uuid */
            wallet_id?: string;
            /**
             * Format: int64
             * @description Au guichet (TOPUP_DESK) à la place de wallet_id.
             */
            tap_id?: number;
            amount: components["schemas"]["Amount"];
            currency: components["schemas"]["Currency"];
            provider: components["schemas"]["PspProvider"];
            payer_msisdn?: string;
            /** Format: uri */
            return_url?: string;
        };
        PspTopup: {
            /** Format: uuid */
            topup_id: string;
            /** @enum {string} */
            status: "PENDING" | "SUCCEEDED" | "FAILED" | "EXPIRED" | "CANCELLED";
            provider: components["schemas"]["PspProvider"];
            /**
             * Format: uuid
             * @description Configuration PSP (S26) utilisée ; son URL de webhook est `/webhooks/{provider}/{psp_config_id}`.
             */
            psp_config_id?: string;
            provider_reference?: string | null;
            amount: components["schemas"]["Amount"];
            currency: components["schemas"]["Currency"];
            /** Format: uuid */
            wallet_id: string;
            /** Format: uri */
            checkout_url?: string | null;
            expires_at?: components["schemas"]["Timestamp"];
            /** Format: uuid */
            transaction_id?: string | null;
            failure_reason?: string;
        };
        /** @description Corps natif du PSP (non normalisé) ; seuls `id` et `type` sont exigés ici. */
        PspWebhookEvent: {
            id: string;
            type: string;
            data?: {
                [key: string]: unknown;
            };
        } & {
            [key: string]: unknown;
        };
        /**
         * @description Entrée du contenu (vue `offline_snapshot_rows`, sync_protocol.md §4.1) : une par rattachement ouvert.
         *     Le terminal applique les mêmes règles que le serveur : statut du bracelet, du lot et du portefeuille,
         *     événement du lot, compteur strictement supérieur à `last_counter`. Environ 120 octets par entrée
         *     (≈ 6 Mo pour 50 000 bracelets).
         */
        SnapshotEntry: {
            /**
             * @description SHA-256 de la signature d'originalité enregistrée à la personnalisation (`media.originality_sig_sha256`) ;
             *     le terminal hors ligne compare la signature lue (ADR-59, sync_protocol.md §5.2-4). Null si aucune
             *     signature n'est enregistrée.
             */
            originality_sig_sha256: components["schemas"]["Hex32"] | null;
            token_hash: components["schemas"]["Hex32"];
            nfc_uid: components["schemas"]["NfcUid"] | null;
            key_index: number;
            status: components["schemas"]["MediaStatus"];
            /** Format: uuid */
            batch_event_id: string | null;
            /** @enum {string|null} */
            batch_status: "ORDERED" | "PERSONALIZED" | "DELIVERED" | "ACTIVE" | "SUSPENDED" | "CLOSED" | null;
            /** @description Statut du portefeuille rattaché ; hors ligne, une vente n'est autorisée que si `ACTIVE`. */
            wallet_status: components["schemas"]["WalletStatus"];
            /** Format: int64 */
            spendable: number;
            /** Format: int64 */
            last_counter: number | null;
            /** @description PWD||PACK chiffré (AES-256-GCM, clé de contenu `pwd_pack_key`) ; null si le bracelet n'est pas utilisable. */
            pwd_pack_enc: components["schemas"]["EncryptedBlob"] | null;
        };
        /**
         * @description Partie signée. Signature (algorithme de la clé `key_id`, `ECDSA_P256_SHA256` par défaut) sur la
         *     sérialisation canonique JSON (RFC 8785, JCS) de cet objet entier (sync_protocol.md §4.1).
         *     `content_sha256` = SHA-256 de la sérialisation JCS de `{entries, removed_token_hashes}` (sans les
         *     champs chiffrés `pwd_pack_enc`, propres à chaque terminal). Un snapshot produit par la passerelle est
         *     signé par une clé propre à la passerelle (hors KMS, stockage matériel), de `key_id` distinct.
         */
        SnapshotHeader: {
            /** @constant */
            format: "CASHLESS-SNAPSHOT/v1";
            /** @enum {string} */
            kind: "FULL" | "DELTA";
            /** Format: uuid */
            operator_id: string;
            /** Format: uuid */
            ledger_id: string;
            /** Format: uuid */
            event_id: string;
            currency: components["schemas"]["Currency"];
            /** Format: int64 */
            version: number;
            /**
             * Format: int64
             * @description Pour un DELTA, version à laquelle il s'applique ; `null` pour un FULL.
             */
            base_version: number | null;
            generated_at: components["schemas"]["Timestamp"];
            valid_until: components["schemas"]["Timestamp"];
            /** @description Nombre d'entrées du contenu. */
            entries: number;
            /** @description Nombre de retraits (`removed_token_hashes`) ; 0 pour un FULL. */
            removed: number;
            content_sha256: components["schemas"]["Hex32"];
            /** Format: int64 */
            authority_epoch: number;
            key_id: string;
        };
        OfflineSnapshot: {
            header: components["schemas"]["SnapshotHeader"];
            signature: string;
            pwd_pack_key?: components["schemas"]["WrappedKey"];
            entries: components["schemas"]["SnapshotEntry"][];
            removed_token_hashes?: components["schemas"]["Hex32"][];
        };
        /**
         * @description PURCHASE (vente), REVERSAL (annulation d'une vente), TOPUP_CASH (si `cash_topup_offline`),
         *     VOID (numéro consommé sans effet comptable : abandon, refus en ligne), ONLINE_REF (référence à une
         *     opération exclusivement en ligne — activation, caution, restitution, QR… — identifiée par son
         *     `online_operation` et son `content_sha256`). Le lot couvre TOUS les numéros, y compris ceux déjà
         *     confirmés en ligne (sync_protocol.md §6.1 et §3.4).
         *     ACTIVATION et DEPOSIT_CASH : uniquement dans un lot de la passerelle (`EdgeSyncOperation`, `authorized_mode =
         *     EDGE_ONLINE`), pour une activation ou une caution en espèces faite au guichet pendant `EDGE` (ADR-52) ;
         *     détail dans `edge_guichet`. Un terminal NE DOIT PAS les utiliser dans ses propres lots.
         * @enum {string}
         */
        OfflineOperationType: "PURCHASE" | "REVERSAL" | "TOPUP_CASH" | "VOID" | "ONLINE_REF" | "ACTIVATION" | "DEPOSIT_CASH";
        OfflineOperation: {
            /** Format: int64 */
            seq: number;
            type: components["schemas"]["OfflineOperationType"];
            occurred_at: components["schemas"]["Timestamp"];
            amount?: components["schemas"]["Amount"];
            currency?: components["schemas"]["Currency"];
            tap?: components["schemas"]["TapInput"];
            /**
             * Format: int64
             * @description Version du snapshot utilisé pour autoriser (champ d'état, hors `content_sha256`).
             */
            snapshot_version?: number;
            /**
             * Format: int64
             * @description `DeviceConfig.config_id` de la configuration détenue au moment de l'autorisation. Champ d'ÉTAT
             *     (comme `snapshot_version`), non chaîné : il n'entre pas dans `content_sha256`, car il est posé au
             *     passage hors ligne d'une entrée créée en ligne (sync_protocol.md §3.3). Obligatoire pour une
             *     opération autorisée hors ligne ; absent sinon. Une opération `online_status = CONFIRMED` sans
             *     `config_id` est exemptée des contrôles de conformité (sync_protocol.md §7.2, §7.3).
             */
            config_id?: number;
            /**
             * Format: int64
             * @description Solde disponible calculé localement avant l'opération (contrôle).
             */
            local_available_before?: number;
            /**
             * @description Issue de la tentative en ligne faite avec la même clé : jamais tentée, confirmée (réponse 2xx),
             *     inconnue (délai dépassé / coupure), refusée (réponse 4xx métier).
             * @enum {string}
             */
            online_status?: "NOT_ATTEMPTED" | "CONFIRMED" | "UNKNOWN" | "REJECTED";
            /**
             * Format: int64
             * @description `tap_id` reçu de `POST /taps` pour la lecture embarquée dans `tap`, s'il a été reçu. Champ d'état (non
             *     chaîné). Le serveur réutilise cette lecture si elle est du même terminal, du même bracelet, du même
             *     compteur et n'a servi à aucune écriture : pas de fausse copie quand le lot arrive après le délai de
             *     renvoi (ADR-50).
             */
            online_tap_id?: number | null;
            /**
             * Format: uuid
             * @description transaction_id reçu en ligne (si CONFIRMED).
             */
            online_transaction_id?: string | null;
            /** @description Pour ONLINE_REF, operationId de l'appel en ligne (ex. activateMedia). */
            online_operation?: string;
            content_sha256?: components["schemas"]["Hex32"];
            /**
             * Format: int64
             * @description Pour REVERSAL, seq de la vente annulée (du même terminal).
             */
            reverses_seq?: number;
            /**
             * Format: uuid
             * @description Pour REVERSAL d'une vente écrite en ligne.
             */
            reverses_transaction_id?: string;
            reason?: string;
            /** @enum {string} */
            void_reason?: "ABORTED_BY_OPERATOR" | "ONLINE_REJECTED" | "NFC_READ_FAILED" | "APP_CRASH_RECOVERY";
            lines?: components["schemas"]["SaleLine"][];
            clock?: {
                /**
                 * Format: int64
                 * @description Horloge monotone depuis le démarrage.
                 */
                monotonic_ms?: number;
                boot_id?: string;
                /**
                 * Format: int64
                 * @description Décalage estimé (heure serveur − heure terminal) lors du dernier contact.
                 */
                offset_ms?: number;
            };
            chain_hash: components["schemas"]["Hex32"];
        };
        OfflineBatchHeader: {
            /** Format: uuid */
            batch_id: string;
            device_serial: string;
            /** Format: uuid */
            ledger_id: string;
            /** Format: int64 */
            authority_epoch: number;
            /** Format: int64 */
            seq_from: number;
            /** Format: int64 */
            seq_to: number;
            count: number;
            created_at: components["schemas"]["Timestamp"];
            device_time_at_send?: components["schemas"]["Timestamp"];
            prev_chain_hash: components["schemas"]["Hex32"];
            last_chain_hash: components["schemas"]["Hex32"];
        };
        OfflineBatch: {
            header: components["schemas"]["OfflineBatchHeader"];
            operations: components["schemas"]["OfflineOperation"][];
            /** @description ECDSA P-256 (clé Keystore) sur JCS(header). */
            signature: string;
        };
        /** @enum {string} */
        OfflineOperationStatus: "ACCEPTED" | "DUPLICATE" | "ACCEPTED_WITH_SHORTFALL" | "REJECTED";
        /**
         * @description Raison de rejet d'une opération de lot (sync_protocol.md §7.1, §7.2, §7.3). `MEDIA_NOT_IN_SNAPSHOT` :
         *     bracelet absent du snapshot utilisé, ou inconnu / non activé au serveur (`MEDIA_UNKNOWN` est réservé au
         *     chemin en ligne). `INSUFFICIENT_FUNDS_RETRY` : 4ᵉ `CL007` consécutif (débits concurrents) ; rien
         *     n'est écrit, `retryable = true`, le terminal renvoie l'opération dans un lot ultérieur.
         *     `SYNC_DEADLINE_PASSED` : synchronisation reçue alors que l'événement est en `SETTLING` ou au-delà (ADR-49) ;
         *     rien n'est écrit, `retryable = false` ; le commerçant reste garanti par une écriture du back-office.
         *     `PERIOD_CLOSED` et `LEDGER_LOCKED` ne sont pas des fautes du terminal (traitement manuel).
         *     `EDGE_REPLAY_FAILED` : lot de passerelle seulement ; rejeu impossible d'une `ACTIVATION` ou d'un
         *     `DEPOSIT_CASH` (`detail` donne le code de l'échec ; sync_protocol.md §9.6).
         *     `SEQ_OUT_OF_RANGE` n'est pas une raison par opération : le lot entier est refusé (`409`).
         * @enum {string}
         */
        OfflineRejectReason: "IDEMPOTENCY_KEY_REUSED" | "MALFORMED_OPERATION" | "CURRENCY_MISMATCH" | "OFFLINE_NOT_ALLOWED" | "POLICY_LIMIT_EXCEEDED" | "SNAPSHOT_TOO_OLD" | "SNAPSHOT_VERSION_UNKNOWN" | "MEDIA_NOT_IN_SNAPSHOT" | "MEDIA_BLOCKED_IN_SNAPSHOT" | "MEDIA_WRONG_EVENT" | "PACK_NOT_VERIFIED" | "REVERSAL_TARGET_NOT_FOUND" | "ALREADY_REVERSED" | "PERIOD_CLOSED" | "LEDGER_LOCKED" | "WALLET_LIMIT_EXCEEDED" | "INSUFFICIENT_FUNDS_RETRY" | "SYNC_DEADLINE_PASSED" | "EDGE_REPLAY_FAILED";
        /** @enum {string} */
        ShortfallReason: "INSUFFICIENT_FUNDS" | "MEDIA_BLOCKED_AFTER_SNAPSHOT" | "MEDIA_CLONE_SUSPECTED" | "MEDIA_UID_MISMATCH" | "MEDIA_SIGNATURE_MISMATCH" | "WALLET_BLOCKED";
        OfflineOperationResult: {
            /** Format: int64 */
            seq: number;
            idempotency_key: string;
            status: components["schemas"]["OfflineOperationStatus"];
            /** Format: uuid */
            transaction_id?: string | null;
            /**
             * @description NONE pour VOID, ONLINE_REF non exécuté, REJECTED.
             * @enum {string}
             */
            effect?: "LEDGER_WRITTEN" | "NONE";
            /** Format: int64 */
            charged_to_wallet?: number;
            /** Format: int64 */
            shortfall_amount?: number;
            shortfall_reason?: components["schemas"]["ShortfallReason"];
            /** Format: uuid */
            anomaly_id?: string;
            tap_result?: components["schemas"]["TapResultCode"];
            reject_reason?: components["schemas"]["OfflineRejectReason"];
            retryable?: boolean;
            detail?: string;
        };
        OfflineBatchResult: {
            /** Format: uuid */
            batch_id: string;
            processed_at: components["schemas"]["Timestamp"];
            results: components["schemas"]["OfflineOperationResult"][];
            /** Format: int64 */
            contiguous_acked_seq: number;
            missing_seqs: number[];
            /** Format: int64 */
            next_snapshot_version?: number | null;
            /**
             * @description Vrai si le lot a été abandonné (traitement interrompu plus de 15 min) : `results` ne contient que les
             *     opérations traitées ; renvoyer les autres dans un nouveau lot (sync_protocol.md §6.2-6).
             * @default false
             */
            abandoned: boolean;
            server_time: components["schemas"]["Timestamp"];
        };
        EdgeSyncOperation: components["schemas"]["OfflineOperation"] & {
            /** Format: int64 */
            edge_seq: number;
            device_serial: string;
            /**
             * @description Autorisée en direct par la passerelle, ou relayée d'un lot hors ligne de terminal.
             * @enum {string}
             */
            authorized_mode: "EDGE_ONLINE" | "DEVICE_OFFLINE";
            /**
             * Format: uuid
             * @description Obligatoire si `authorized_mode = DEVICE_OFFLINE` : `header.batch_id` du lot d'origine du
             *     terminal, dont l'en-tête et la signature sont relayés dans `EdgeSyncBatch.device_batches`.
             *     Il n'y a pas de signature par opération : le terminal signe l'en-tête de son lot.
             */
            device_batch_id?: string;
            /**
             * @description Obligatoire pour `type = ACTIVATION` ou `DEPOSIT_CASH` (ADR-52). Le central rejoue `activate_media`
             *     (avec `event_id`) ou `take_deposit` (mode `SEPARATE`, espèces de la station `cash_desk_account_id`).
             *     Rejeu impossible : `REJECTED` / `EDGE_REPLAY_FAILED` et espèces au compte d'attente (sync_protocol.md §9.6).
             */
            edge_guichet?: {
                /** Format: uuid */
                media_id: string;
                /**
                 * Format: uuid
                 * @description ACTIVATION — portefeuille rattaché (créé par la passerelle s'il est anonyme).
                 */
                wallet_id?: string;
                /** Format: uuid */
                event_id?: string;
                /** @enum {string} */
                channel?: "DESK";
                /**
                 * Format: int64
                 * @description DEPOSIT_CASH — montant de la caution encaissée en espèces.
                 */
                deposit_amount?: number;
                /** Format: uuid */
                cash_desk_account_id?: string;
            };
            /**
             * @description Décision de la passerelle (autorité) : le central écrit ces montants tels quels
             *     (répartition portefeuille / compte d'attente) et recalcule seulement frais et commissions.
             */
            edge_decision?: {
                status: components["schemas"]["OfflineOperationStatus"];
                /** Format: int64 */
                charged_to_wallet: number;
                /** Format: int64 */
                shortfall_amount: number;
                shortfall_reason?: components["schemas"]["ShortfallReason"];
                reject_reason?: components["schemas"]["OfflineRejectReason"];
            };
        };
        /**
         * @description Lot EDGE_SYNC (sync_protocol.md §9.5). `batch_id` est la clé d'idempotence du lot. Les opérations
         *     relayées d'un lot hors ligne de terminal (`DEVICE_OFFLINE`) sont accompagnées de l'en-tête et de la
         *     signature d'ORIGINE de ce lot (`device_batches`) : le central vérifie la signature avec
         *     `device.public_key` (`BATCH_SIGNATURE_INVALID` sinon) et recalcule la chaîne du terminal jusqu'à
         *     `header.last_chain_hash` (`CHAIN_BROKEN` sinon).
         * @example {
         *       "batch_id": "7e8f9a0b-1c2d-4e3f-8a4b-5c6d7e8f9a0b",
         *       "edge_gateway_id": "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d",
         *       "ledger_id": "2c9a1f0e-3b4d-4e5f-8a7b-6c5d4e3f2a1b",
         *       "epoch": 5,
         *       "edge_seq_from": 4210,
         *       "edge_seq_to": 4212,
         *       "prev_chain_hash": "1b4f0e9851971998e732078544c96b36c3d01cedf7caa332359d6f1d83567014",
         *       "last_chain_hash": "60303ae22b998861bce3b28f33eec1be758a213c86c93c076dbe9f558c11c752",
         *       "operations": [
         *         {
         *           "edge_seq": 4210,
         *           "device_serial": "TPE-BAR-01",
         *           "authorized_mode": "EDGE_ONLINE",
         *           "seq": 131,
         *           "type": "PURCHASE",
         *           "occurred_at": "2026-12-12T21:00:00Z",
         *           "amount": 3000,
         *           "currency": "XOF",
         *           "tap": {
         *             "nfc_uid": "04a1b2c3d4e5f6",
         *             "token_hash": "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
         *             "counter": 430,
         *             "key_index": 1,
         *             "pack_verified": true,
         *             "originality_signature": "3a7f0c9e5b2d4a6f8e1c3b5d7f9a0c2e4b6d8f0a1c3e5b7d9f0a2c4e6b8d0f1a",
         *             "occurred_at": "2026-12-12T20:59:59Z"
         *           },
         *           "edge_decision": {
         *             "status": "ACCEPTED",
         *             "charged_to_wallet": 3000,
         *             "shortfall_amount": 0
         *           },
         *           "chain_hash": "fd61a03af4f77d870fc21e05e7e80678095c92d808cfb3b5c279ee04c74aca13"
         *         },
         *         {
         *           "edge_seq": 4211,
         *           "device_serial": "TPE-BAR-01",
         *           "authorized_mode": "EDGE_ONLINE",
         *           "seq": 132,
         *           "type": "VOID",
         *           "occurred_at": "2026-12-12T21:01:00Z",
         *           "void_reason": "ONLINE_REJECTED",
         *           "edge_decision": {
         *             "status": "ACCEPTED",
         *             "charged_to_wallet": 0,
         *             "shortfall_amount": 0
         *           },
         *           "chain_hash": "60303ae22b998861bce3b28f33eec1be758a213c86c93c076dbe9f558c11c752"
         *         },
         *         {
         *           "edge_seq": 4212,
         *           "device_serial": "TPE-FOOD-02",
         *           "authorized_mode": "DEVICE_OFFLINE",
         *           "device_batch_id": "5d6e7f80-91a2-4b3c-8d4e-5f6a7b8c9d0e",
         *           "seq": 87,
         *           "type": "PURCHASE",
         *           "occurred_at": "2026-12-12T21:30:00Z",
         *           "amount": 9000,
         *           "currency": "XOF",
         *           "snapshot_version": 1532,
         *           "config_id": 48213,
         *           "online_status": "NOT_ATTEMPTED",
         *           "local_available_before": 9000,
         *           "tap": {
         *             "nfc_uid": "04b1c2d3e4f5a6",
         *             "token_hash": "2c26b46b68ffc68ff99b453c1d30413413422d706483bfa0f98a5e886266e7ae",
         *             "counter": 77,
         *             "key_index": 1,
         *             "pack_verified": true,
         *             "originality_signature": "9b2e4c6a8d0f1e3c5a7b9d1f3e5c7a9b1d3f5e7c9a1b3d5f7e9c1a3b5d7f9e1c",
         *             "occurred_at": "2026-12-12T21:29:58Z"
         *           },
         *           "edge_decision": {
         *             "status": "ACCEPTED_WITH_SHORTFALL",
         *             "charged_to_wallet": 6000,
         *             "shortfall_amount": 3000,
         *             "shortfall_reason": "INSUFFICIENT_FUNDS"
         *           },
         *           "chain_hash": "8a7b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b"
         *         }
         *       ],
         *       "device_batches": [
         *         {
         *           "header": {
         *             "batch_id": "5d6e7f80-91a2-4b3c-8d4e-5f6a7b8c9d0e",
         *             "device_serial": "TPE-FOOD-02",
         *             "ledger_id": "2c9a1f0e-3b4d-4e5f-8a7b-6c5d4e3f2a1b",
         *             "authority_epoch": 5,
         *             "seq_from": 87,
         *             "seq_to": 87,
         *             "count": 1,
         *             "created_at": "2026-12-12T21:41:05Z",
         *             "prev_chain_hash": "fd61a03af4f77d870fc21e05e7e80678095c92d808cfb3b5c279ee04c74aca13",
         *             "last_chain_hash": "8a7b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b"
         *           },
         *           "signature": "MEUCIQCq2...base64"
         *         }
         *       ],
         *       "signature": "MEUCIQD...base64"
         *     }
         */
        EdgeSyncBatch: {
            /** Format: uuid */
            batch_id: string;
            /** Format: uuid */
            edge_gateway_id: string;
            /** Format: uuid */
            ledger_id: string;
            /** Format: int64 */
            epoch: number;
            /** Format: int64 */
            edge_seq_from: number;
            /** Format: int64 */
            edge_seq_to: number;
            prev_chain_hash: components["schemas"]["Hex32"];
            last_chain_hash: components["schemas"]["Hex32"];
            /** @description Au plus 500 opérations et 1 Mio par lot, dans l'ordre des `edge_seq`. */
            operations: components["schemas"]["EdgeSyncOperation"][];
            /**
             * @description En-têtes et signatures d'origine des lots de terminaux relayés (une entrée par `device_batch_id`
             *     référencé par une opération `DEVICE_OFFLINE` du lot) ; absent ou vide s'il n'y en a pas.
             */
            device_batches?: {
                header: components["schemas"]["OfflineBatchHeader"];
                /** @description Signature d'origine du terminal (ECDSA P-256) sur JCS(header), relayée telle quelle. */
                signature: string;
            }[];
            signature: string;
        };
        DebitAuthorityChangeRequest: {
            /** @enum {string} */
            target: "EDGE" | "CENTRAL";
            /** Format: uuid */
            edge_gateway_id?: string;
            reason: string;
            /**
             * @description `true` : reprise forcée, à deux personnes ; crée une demande d'approbation `FORCE_CENTRAL_AUTHORITY` (ADR-74).
             * @default false
             */
            force: boolean;
            /** @description Obligatoire (true) si force = true. */
            gateway_confirmed_offline?: boolean;
        };
        Handover: {
            handover_id: string;
            /** @enum {string} */
            direction: "TO_EDGE" | "TO_CENTRAL";
            /**
             * @description TO_EDGE : GRANTED → ACTIVE. TO_CENTRAL : RELEASE_REQUESTED → RELEASING → COMPLETED.
             *     `RELEASING` est posé par l'API à la réception de `POST /edge/handovers/{handover_id}/release`,
             *     avant toute vérification (sync_protocol.md §9.3, étape 5).
             *     FORCED : reprise forcée par le central. FAILED : abandon.
             * @enum {string}
             */
            state: "GRANTED" | "ACTIVE" | "RELEASE_REQUESTED" | "RELEASING" | "COMPLETED" | "FORCED" | "FAILED";
            /** Format: int64 */
            epoch: number;
            /** Format: int64 */
            central_watermark_posting_id?: number;
            /** Format: int64 */
            final_edge_seq?: number;
            missing_edge_seqs?: number[];
            requested_at: components["schemas"]["Timestamp"];
            completed_at?: components["schemas"]["Timestamp"];
        };
        DebitAuthorityState: components["schemas"]["DebitAuthority"] & {
            handover: components["schemas"]["Handover"] | null;
        };
        ReplicationPage: {
            /** Format: uuid */
            ledger_id: string;
            /** Format: int64 */
            epoch: number;
            /** Format: int64 */
            from_posting_id: number;
            /** Format: int64 */
            to_posting_id: number;
            wallets: {
                /** Format: uuid */
                wallet_id: string;
                status: components["schemas"]["WalletStatus"];
                /** Format: int64 */
                paid: number;
                /** Format: int64 */
                promo: number;
            }[];
            media: components["schemas"]["SnapshotEntry"][];
            has_more: boolean;
        };
        /** @description Rendu en espèces depuis la caisse de la session de caisse indiquée par la requête. */
        CashMovement: {
            /** @constant */
            method: "CASH";
        };
        /** @description Pas de champ montant. Le serveur le calcule (anomalies `CASH_TOPUP_OVER_LIMIT` ouvertes du bracelet). */
        CashDueRefundRequest: {
            /** Format: int64 */
            tap_id?: number;
            tap?: components["schemas"]["TapInput"];
            /**
             * Format: uuid
             * @description Session de caisse ouverte ; son compte `CASH_DESK` est crédité.
             */
            cash_session_id: string;
        } & (unknown | unknown);
        CashDueRefundResult: {
            /**
             * Format: uuid
             * @description Transaction `WALLET_REFUND` (débit `L-ESP-A-RENDRE`, crédit caisse).
             */
            transaction_id: string;
            idempotency_key: string;
            /** Format: uuid */
            media_id: string;
            amount: components["schemas"]["Amount"];
            currency: components["schemas"]["Currency"];
            resolved_anomaly_ids: string[];
            /**
             * Format: uuid
             * @description Valideur (`sub` du jeton d'approbation sur place), ou null sous le plafond.
             */
            approved_by?: string | null;
        };
        /** @description Session de caisse (objet de l'application ; table à créer, SPECIFICATION §14.2). */
        CashSession: {
            /** Format: uuid */
            cash_session_id: string;
            /** Format: uuid */
            cash_account_id: string;
            /** Format: uuid */
            device_id?: string | null;
            /** @enum {string} */
            status: "OPEN" | "CLOSED";
            /** Format: uuid */
            opened_by: string;
            opened_at: components["schemas"]["Timestamp"];
            last_count?: null | {
                /** Format: int64 */
                counted_amount: number;
                counted_at: components["schemas"]["Timestamp"];
                /** Format: uuid */
                counted_by: string;
            };
            /** Format: date-time */
            closed_at?: string | null;
            /** Format: uuid */
            cash_close_transaction_id?: string | null;
            /**
             * Format: int64
             * @description Compté − théorique à la fermeture (négatif = manque) ; renvoyé seulement après fermeture.
             */
            difference?: number | null;
            /** Format: uuid */
            cash_diff_anomaly_id?: string | null;
        };
        KycVerificationCreate: {
            /** Format: uuid */
            customer_id?: string;
            /**
             * Format: uuid
             * @description Portefeuille présenté au guichet ; son client est identifié.
             */
            wallet_id?: string;
            /** @enum {string} */
            id_type: "NATIONAL_ID" | "PASSPORT" | "RESIDENCE_PERMIT" | "DRIVING_LICENCE" | "OTHER";
            id_country: string;
            /** @description 4 derniers caractères du numéro seulement. */
            id_last4: string;
            /** Format: date */
            id_expires_on: string;
        } & (unknown | unknown);
        KycVerification: {
            /** Format: uuid */
            kyc_verification_id: string;
            /** Format: uuid */
            customer_id: string;
            /** Format: uuid */
            wallet_id?: string | null;
            /**
             * @description `ONLINE` réservé (V2).
             * @enum {string}
             */
            method: "DESK" | "ONLINE";
            /** Format: uuid */
            agent_id: string;
            id_type: string;
            id_country: string;
            id_last4: string;
            /** Format: date */
            id_expires_on: string;
            /** @enum {string} */
            status: "VERIFIED" | "REVOKED";
            verified_at: components["schemas"]["Timestamp"];
            /** Format: date-time */
            revoked_at?: string | null;
            /** Format: uuid */
            revoked_by?: string | null;
            revoked_reason?: string | null;
        };
        LateClaimRequest: {
            /** Format: uuid */
            wallet_id: string;
            amount: components["schemas"]["Amount"];
            currency: components["schemas"]["Currency"];
            proof: {
                /** @enum {string} */
                kind: "MEDIA_TAP" | "CUSTOMER_ACCOUNT";
                /**
                 * Format: int64
                 * @description Obligatoire si `kind = MEDIA_TAP`.
                 */
                tap_id?: number;
            };
            destination: {
                /** @enum {string} */
                method: "CASH" | "WAVE" | "ORANGE_MONEY" | "BANK_TRANSFER";
                msisdn?: string;
                iban?: string;
            };
            reason: string;
        };
        LateClaimResult: {
            /** Format: uuid */
            ledger_id: string;
            /** Format: uuid */
            wallet_id: string;
            amount: components["schemas"]["Amount"];
            currency: components["schemas"]["Currency"];
            /** Format: uuid */
            breakage_reversal_transaction_id: string;
            /** Format: uuid */
            wallet_refund_transaction_id: string;
            /**
             * Format: uuid
             * @description Valideur (`decided_by` de la demande d'approbation).
             */
            approved_by: string;
        };
        DeviceJournalImport: {
            /** @description Lots exportés par l'application du terminal, dans l'ordre des numéros, signatures d'origine. */
            batches: components["schemas"]["OfflineBatch"][];
            reason: string;
        };
        /** @description Résultat de `importDeviceJournal`, renvoyé dans `ApprovalRequest.result` à l'exécution. */
        DeviceJournalImportResult: {
            /** Format: uuid */
            device_id: string;
            results: components["schemas"]["OfflineBatchResult"][];
        };
        /**
         * @description Action d'une demande d'approbation (`approval_request.action`, liste fermée du schéma). Correspondance :
         *     `WAIVE_SEQ_GAP` → `waiveSeqGap` ; `DEVICE_JOURNAL_IMPORT` → `importDeviceJournal` ; `KYC_REVOCATION` →
         *     `revokeKycVerification` ; `WALLET_REFUND` → `approveRefundRequest` ; `LATE_CLAIM` → `postLateClaim` ;
         *     `FORCE_CENTRAL_AUTHORITY` → `requestDebitAuthorityChange` (`force = true`). `ADJUSTMENT`,
         *     `ANOMALY_RESOLUTION`, `REINSTATE_MEDIA`, `PAYOUT`, `PSP_CONFIGURATION`, `EVENT_PSP_SELECTION` : opérations
         *     du back-office à ajouter au contrat (SPECIFICATION §10.4), qui suivent le même flux.
         * @enum {string}
         */
        ApprovalAction: "LATE_CLAIM" | "ADJUSTMENT" | "ANOMALY_RESOLUTION" | "WAIVE_SEQ_GAP" | "FORCE_CENTRAL_AUTHORITY" | "REINSTATE_MEDIA" | "PAYOUT" | "DEVICE_JOURNAL_IMPORT" | "KYC_REVOCATION" | "PSP_CONFIGURATION" | "EVENT_PSP_SELECTION" | "WALLET_REFUND" | "LATE_CHARGEBACK";
        /**
         * @description `PENDING` → `APPROVED` | `REJECTED` | `EXPIRED` ; `APPROVED` → `EXECUTED` | `FAILED` (garde de la base).
         *     `APPROVED` est un état de passage : `approveApprovalRequest` exécute l'action dans la foulée.
         * @enum {string}
         */
        ApprovalRequestStatus: "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED" | "EXECUTED" | "FAILED";
        /**
         * @description Demande d'approbation du back-office (`approval_request`, schéma section 18h). Le contenu (`action`,
         *     `target_id`, `payload`, auteur, dates) est figé à la création. `payload` contient les paramètres exacts de
         *     l'opération (chemin et corps), et la clé d'idempotence de l'appel qui a créé la demande, réutilisée pour
         *     les écritures de l'exécution : l'action n'est écrite qu'une fois.
         */
        ApprovalRequest: {
            /** Format: uuid */
            approval_request_id: string;
            action: components["schemas"]["ApprovalAction"];
            /**
             * Format: uuid
             * @description Objet visé (terminal, identification, grand livre, demande de remboursement…).
             */
            target_id?: string | null;
            /** @description Paramètres exacts de l'action, figés. */
            payload: {
                [key: string]: unknown;
            };
            /**
             * Format: uuid
             * @description Auteur (`sub` de la session qui a créé la demande).
             */
            requested_by: string;
            /** Format: date-time */
            requested_at: string;
            /**
             * Format: date-time
             * @description `requested_at` + 24 h.
             */
            expires_at: string;
            status: components["schemas"]["ApprovalRequestStatus"];
            /**
             * Format: uuid
             * @description Valideur (`sub` de la session de la seconde personne), toujours ≠ `requested_by`.
             */
            decided_by?: string | null;
            /** Format: date-time */
            decided_at?: string | null;
            decision_note?: string | null;
            /**
             * Format: uuid
             * @description Transaction écrite par l'exécution, s'il y en a une.
             */
            executed_tx_id?: string | null;
            /**
             * @description Si `EXECUTED` : réponse de l'opération exécutée (`SeqStatus`, `DeviceJournalImportResult`,
             *     `KycVerification`, `RefundRequest`, `LateClaimResult`, `DebitAuthorityState` selon l'action).
             */
            result?: {
                [key: string]: unknown;
            } | null;
            /** @description Si `FAILED` : code du refus à l'exécution. */
            failure_code?: components["schemas"]["ProblemCode"] | null;
            /** @description Si `FAILED` : raison lisible. */
            failure_reason?: string | null;
        };
        ApprovalDecision: {
            note?: string;
        };
        ApprovalRejection: {
            note: string;
        };
        /** @enum {string} */
        PaymentIntentStatus: "REQUIRES_PAYMENT" | "AUTHORIZED" | "SUCCEEDED" | "CANCELLED" | "EXPIRED" | "FAILED";
        PaymentIntentCreate: {
            amount: components["schemas"]["Amount"];
            currency: components["schemas"]["Currency"];
            /** Format: uuid */
            pos_id: string;
            /**
             * Format: uuid
             * @description Terminal PAIRED_TPE qui présentera l'intention ; absent = paiement par QR seulement.
             */
            device_id?: string;
            /**
             * @default AUTOMATIC
             * @enum {string}
             */
            capture_method: "AUTOMATIC" | "MANUAL";
            external_reference?: string;
            /** @default 300 */
            expires_in_seconds: number;
            metadata?: {
                [key: string]: string;
            };
        };
        PaymentIntent: {
            payment_intent_id: string;
            status: components["schemas"]["PaymentIntentStatus"];
            amount: components["schemas"]["Amount"];
            /** Format: int64 */
            amount_capturable?: number;
            /** Format: int64 */
            amount_captured?: number;
            currency: components["schemas"]["Currency"];
            /** @enum {string} */
            capture_method: "AUTOMATIC" | "MANUAL";
            /** Format: uuid */
            pos_id: string;
            /** Format: uuid */
            device_id?: string | null;
            external_reference?: string | null;
            qr_payload?: string | null;
            /** Format: uuid */
            transaction_id?: string | null;
            created_at: components["schemas"]["Timestamp"];
            expires_at: components["schemas"]["Timestamp"];
            metadata?: {
                [key: string]: string;
            };
        };
        /** @enum {string} */
        OutboundEventType: "payment_intent.authorized" | "payment_intent.succeeded" | "payment_intent.cancelled" | "payment_intent.expired" | "payment_intent.failed" | "payment_intent.reversed";
        OutboundEvent: {
            event_id: string;
            type: components["schemas"]["OutboundEventType"];
            created_at: components["schemas"]["Timestamp"];
            data: components["schemas"]["PaymentIntent"];
        };
        WebhookEndpoint: {
            webhook_endpoint_id: string;
            /** Format: uri */
            url: string;
            events: components["schemas"]["OutboundEventType"][];
            /** @description Renvoyé uniquement à la création. */
            secret?: string;
            created_at: components["schemas"]["Timestamp"];
        };
        PaymentRequestObject: {
            /** Format: uuid */
            payment_request_id: string;
            /** @enum {string} */
            direction: "MERCHANT_QR" | "CUSTOMER_QR";
            /** @enum {string} */
            status: "PENDING" | "CONFIRMED" | "EXPIRED" | "CANCELLED";
            /** Format: int64 */
            amount?: number | null;
            currency: components["schemas"]["Currency"];
            merchant_name?: string | null;
            /** @description Renvoyé uniquement à la création (contient le jeton). */
            qr_payload?: string | null;
            expires_at: components["schemas"]["Timestamp"];
            /** Format: uuid */
            transaction_id?: string | null;
        };
        CustomerProfile: {
            /** Format: uuid */
            customer_id: string;
            phone: string;
            display_name?: string | null;
            /**
             * @description Calculé à la lecture (ADR-54) — VERIFIED tant que le client a une identification non révoquée et une pièce non expirée.
             * @enum {string}
             */
            kyc_level: "NONE" | "VERIFIED";
        };
        CustomerMedia: {
            /** Format: uuid */
            media_id: string;
            printed_number?: string | null;
            status: components["schemas"]["MediaStatus"];
            deposit_status: components["schemas"]["DepositStatus"];
            /** Format: uuid */
            wallet_id?: string | null;
        };
        Wallet: {
            /** Format: uuid */
            wallet_id: string;
            status: components["schemas"]["WalletStatus"];
            /**
             * @description Calculé à la lecture (ADR-54) — VERIFIED tant que le client a une identification non révoquée et une pièce non expirée.
             * @enum {string}
             */
            kyc_level: "NONE" | "VERIFIED";
            currency: components["schemas"]["Currency"];
            event: {
                /** Format: uuid */
                event_id: string;
                name: string;
                status: string;
            };
            balance: components["schemas"]["Balance"];
            balance_as_of: components["schemas"]["Timestamp"];
            /** @description Des terminaux hors ligne peuvent encore remonter des achats (solde provisoire). */
            pending_offline_notice?: boolean;
            media: components["schemas"]["CustomerMedia"][];
            refund: {
                eligible: boolean;
                /** Format: date-time */
                deadline?: string | null;
                /** Format: int64 */
                fee?: number;
            };
        };
        WalletMovement: {
            /** Format: uuid */
            transaction_id: string;
            type: components["schemas"]["TransactionType"];
            source: components["schemas"]["TransactionSource"];
            occurred_at: components["schemas"]["Timestamp"];
            amount: components["schemas"]["SignedAmount"];
            currency: components["schemas"]["Currency"];
            label: string;
            /** Format: uuid */
            reverses_id?: string | null;
            /** Format: uuid */
            reversed_by_id?: string | null;
        };
        /** @description Demande de rattachement en attente de confirmation au guichet (ADR-57). */
        MediaClaimPending: {
            /** Format: uuid */
            claim_id: string;
            /** @enum {string} */
            status: "PENDING_DESK_CONFIRMATION";
            /** @description À montrer à l'agent du guichet ; n'est renvoyé qu'au compte demandeur. */
            confirmation_code: string;
            expires_at: components["schemas"]["Timestamp"];
        };
        MediaClaimRequest: {
            /**
             * @description Code imprimé (10 caractères de l'alphabet 23456789ABCDEFGHJKLMNPQRSTUVWXYZ) ; tirets, espaces et casse ignorés.
             * @example K7QM-4XH9RT
             */
            claim_code: string;
            /**
             * Format: uuid
             * @description Portefeuille existant du client à utiliser (sinon créé).
             */
            wallet_id?: string;
        };
        /**
         * @description Traitement manuel en V1 : `REQUESTED` → `PROCESSING` (approuvée par une seconde personne,
         *     `WALLET_REFUND` écrite, paiement hors système en cours) → `PAID` (confirmé) ou `FAILED` (échec
         *     enregistré, `WALLET_REFUND` contre-passée). `REQUESTED` → `REJECTED` (refus du back-office).
         *     `CANCELLED` : demande retirée avant approbation.
         *     Autre numéro (ADR-76) : `AWAITING_HOLDER` (le titulaire a reçu un code ; confirmation, blocage, ou passage
         *     automatique à `REQUESTED` à `hold_until`) ; `BLOCKED` (bloquée par le titulaire, finale).
         * @enum {string}
         */
        RefundRequestStatus: "AWAITING_HOLDER" | "REQUESTED" | "PROCESSING" | "PAID" | "FAILED" | "REJECTED" | "CANCELLED" | "BLOCKED";
        RefundRequestCreate: {
            /** Format: uuid */
            wallet_id: string;
            /**
             * @description Canaux de remboursement (ADR-53) : `WAVE` et `ORANGE_MONEY` vers le numéro vérifié du titulaire, ou un
             *     autre numéro avec `new_number_otp` (ADR-76) ;
             *     `BANK_TRANSFER` (avec `iban`) réservé aux demandes créées par le back-office. Le remboursement par carte
             *     n'existe pas en V1. Le remboursement en espèces se fait au guichet (pas de demande).
             */
            destination: {
                /** @enum {string} */
                method: "WAVE" | "ORANGE_MONEY" | "BANK_TRANSFER";
                msisdn?: string;
                /** @description Obligatoire si `msisdn` n'est pas le numéro vérifié du titulaire (ADR-76). */
                new_number_otp?: {
                    otp_request_id: string;
                    code: string;
                };
                iban?: string;
            };
        };
        RefundRequest: {
            refund_request_id: string;
            /** Format: uuid */
            wallet_id: string;
            status: components["schemas"]["RefundRequestStatus"];
            /** Format: int64 */
            estimated_amount?: number;
            /** Format: int64 */
            fee?: number;
            currency: components["schemas"]["Currency"];
            destination: {
                method?: string;
                msisdn?: string;
                iban?: string;
            };
            /**
             * Format: uuid
             * @description Transaction `WALLET_REFUND` écrite à l'approbation.
             */
            transaction_id?: string | null;
            /**
             * Format: uuid
             * @description Seconde personne ayant approuvé (≠ auteur).
             */
            approved_by?: string | null;
            /** @description Destination différente du numéro vérifié du titulaire (ADR-76). */
            new_number?: boolean;
            /**
             * Format: date-time
             * @description Fin de l'attente de la décision du titulaire (`AWAITING_HOLDER`).
             */
            hold_until?: string | null;
            /** @description Montant au-delà de `event.refund_new_number_max` vers un autre numéro : vérification d'identité exigée avant approbation. */
            extra_check_required?: boolean;
            /** @description Référence du paiement hors système (renseignée à la confirmation `PAID`). */
            external_reference?: string | null;
            failure_reason?: string | null;
            /**
             * Format: uuid
             * @description Contre-passation (`REVERSAL`) de `WALLET_REFUND` si le paiement a échoué.
             */
            reversal_transaction_id?: string | null;
            created_at: components["schemas"]["Timestamp"];
            reject_reason?: string;
        };
        /**
         * @description Rôles du personnel (SPECIFICATION §3.2). `VENDOR` et `CUSTOMER` existent mais ne sont pas attribuables par
         *     `grantRole` dans cette version.
         * @enum {string}
         */
        StaffRole: "PLATFORM_ADMIN" | "OPERATOR_ADMIN" | "ORGANIZER_ADMIN" | "SUPERVISOR" | "CASHIER" | "MERCHANT_ADMIN" | "VENDOR" | "CUSTOMER";
        /**
         * @description Portée d'une attribution. Englobement : `PLATFORM` ⊃ `OPERATOR` ⊃ `ORGANIZER` ⊃ `EVENT` ; `OPERATOR` ⊃
         *     `MERCHANT` ; un événement englobe les commerçants qui y participent.
         * @enum {string}
         */
        RoleScopeType: "PLATFORM" | "OPERATOR" | "ORGANIZER" | "EVENT" | "MERCHANT";
        /**
         * @example {
         *       "assignment_id": "2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f",
         *       "role": "CASHIER",
         *       "scope_type": "EVENT",
         *       "scope_id": "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d",
         *       "granted_by": "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
         *       "granted_at": "2026-12-10T08:30:00Z",
         *       "revoked_at": null
         *     }
         */
        RoleAssignment: {
            /** Format: uuid */
            assignment_id: string;
            role: components["schemas"]["StaffRole"];
            scope_type: components["schemas"]["RoleScopeType"];
            /**
             * Format: uuid
             * @description Objet de la portée ; `null` pour `PLATFORM`.
             */
            scope_id: string | null;
            /**
             * Format: uuid
             * @description Personne qui a attribué le rôle ; `null` pour l'amorçage.
             */
            granted_by: string | null;
            granted_at: components["schemas"]["Timestamp"];
            /** Format: date-time */
            revoked_at: string | null;
        };
        /**
         * @description Un champ `approved_by` ou tout autre champ inconnu est ignoré.
         * @example {
         *       "role": "CASHIER",
         *       "scope_type": "EVENT",
         *       "scope_id": "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d"
         *     }
         */
        RoleGrant: {
            role: components["schemas"]["StaffRole"];
            scope_type: components["schemas"]["RoleScopeType"];
            /** Format: uuid */
            scope_id?: string | null;
        };
        /**
         * @description Personne connue du serveur d'identité : `issuer` et `subject` sont les claims `iss` et `sub` de ses jetons.
         *     `email` ou `phone` (E.164) obligatoire. Tout champ inconnu est ignoré.
         * @example {
         *       "issuer": "https://id.cashless.test",
         *       "subject": "6f1c2b8e-3d4a-4f5b-8c9d-0e1f2a3b4c5d",
         *       "display_name": "Awa Ndiaye",
         *       "email": "awa.ndiaye@festival.test"
         *     }
         */
        StaffUserCreate: {
            issuer: string;
            subject: string;
            display_name: string;
            /** Format: email */
            email?: string;
            phone?: string;
        };
        /**
         * @example {
         *       "user_id": "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
         *       "operator_id": "7c0e1a52-0000-4000-8000-000000000001",
         *       "issuer": "https://id.cashless.test",
         *       "subject": "6f1c2b8e-3d4a-4f5b-8c9d-0e1f2a3b4c5d",
         *       "email": "awa.ndiaye@festival.test",
         *       "phone": null,
         *       "display_name": "Awa Ndiaye",
         *       "status": "ACTIVE",
         *       "created_at": "2026-12-10T08:00:00Z",
         *       "disabled_at": null,
         *       "role_assignments": [
         *         {
         *           "assignment_id": "2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f",
         *           "role": "CASHIER",
         *           "scope_type": "EVENT",
         *           "scope_id": "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d",
         *           "granted_by": "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
         *           "granted_at": "2026-12-10T08:30:00Z",
         *           "revoked_at": null
         *         }
         *       ]
         *     }
         */
        StaffUser: {
            /** Format: uuid */
            user_id: string;
            /**
             * Format: uuid
             * @description Prestataire ; `null` pour une personne de la plateforme.
             */
            operator_id: string | null;
            issuer: string;
            subject: string;
            email?: string | null;
            phone?: string | null;
            display_name: string;
            /** @enum {string} */
            status: "ACTIVE" | "DISABLED";
            created_at: components["schemas"]["Timestamp"];
            /** Format: date-time */
            disabled_at: string | null;
            /** @description Attributions actives. */
            role_assignments: components["schemas"]["RoleAssignment"][];
        };
    };
    responses: {
        /** @description Requête invalide (`VALIDATION_FAILED`, `IDEMPOTENCY_KEY_REQUIRED`…). */
        BadRequest: {
            headers: {
                "X-Request-Id": components["headers"]["X-Request-Id"];
                [name: string]: unknown;
            };
            content: {
                /**
                 * @example {
                 *       "type": "https://docs.cashless.test/problems/VALIDATION_FAILED",
                 *       "title": "Requête invalide",
                 *       "status": 400,
                 *       "code": "VALIDATION_FAILED",
                 *       "detail": "amount : doit être un entier strictement positif",
                 *       "instance": "/v1/payments",
                 *       "request_id": "0f1e2d3c-4b5a-4987-8a6b-5c4d3e2f1a0b",
                 *       "retryable": false,
                 *       "errors": [
                 *         {
                 *           "pointer": "/amount",
                 *           "message": "doit être un entier strictement positif"
                 *         }
                 *       ]
                 *     }
                 */
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /** @description Authentification absente ou invalide (`UNAUTHENTICATED`, `WEBHOOK_SIGNATURE_INVALID`). */
        Unauthorized: {
            headers: {
                "X-Request-Id": components["headers"]["X-Request-Id"];
                [name: string]: unknown;
            };
            content: {
                /**
                 * @example {
                 *       "type": "https://docs.cashless.test/problems/UNAUTHENTICATED",
                 *       "title": "Authentification requise",
                 *       "status": 401,
                 *       "code": "UNAUTHENTICATED",
                 *       "request_id": "0f1e2d3c-4b5a-4987-8a6b-5c4d3e2f1a0b",
                 *       "retryable": false
                 *     }
                 */
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /**
         * @description Droits insuffisants ou appareil inactif (`FORBIDDEN`, `DEVICE_SUSPENDED`, `OFFLINE_NOT_ALLOWED`…), ou
         *     jeton d'approbation sur place absent (`APPROVAL_REQUIRED`) ou refusé (`APPROVAL_INVALID`).
         */
        Forbidden: {
            headers: {
                "X-Request-Id": components["headers"]["X-Request-Id"];
                [name: string]: unknown;
            };
            content: {
                /**
                 * @example {
                 *       "type": "https://docs.cashless.test/problems/DEVICE_SUSPENDED",
                 *       "title": "Terminal suspendu",
                 *       "status": 403,
                 *       "code": "DEVICE_SUSPENDED",
                 *       "request_id": "0f1e2d3c-4b5a-4987-8a6b-5c4d3e2f1a0b",
                 *       "retryable": false
                 *     }
                 */
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /** @description Objet introuvable (ou appartenant à un autre prestataire — réponse neutre). */
        NotFound: {
            headers: {
                "X-Request-Id": components["headers"]["X-Request-Id"];
                [name: string]: unknown;
            };
            content: {
                /**
                 * @example {
                 *       "type": "https://docs.cashless.test/problems/NOT_FOUND",
                 *       "title": "Objet introuvable",
                 *       "status": 404,
                 *       "code": "NOT_FOUND",
                 *       "request_id": "0f1e2d3c-4b5a-4987-8a6b-5c4d3e2f1a0b",
                 *       "retryable": false
                 *     }
                 */
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /**
         * @description Conflit d'état ou d'idempotence (`IDEMPOTENCY_KEY_REUSED`, `DEBIT_AUTHORITY_EDGE`,
         *     `DEBIT_AUTHORITY_MOVING`, `HANDOVER_INVALID_STATE`, `CHAIN_BROKEN`, `ALREADY_REVERSED`,
         *     `MEDIA_STATE_INVALID`, `SEQ_OUT_OF_RANGE`, `TAP_UNUSABLE`, `APPROVAL_INVALID` pour une demande
         *     d'approbation expirée ou déjà décidée, `LATE_CLAIM_INVALID` pour une réclamation tardive hors bornes…).
         *     `DEBIT_AUTHORITY_EDGE` et `DEBIT_AUTHORITY_MOVING` ne sont pas des refus définitifs : rejouer la même
         *     requête, avec la même clé, vers l'autorité indiquée ou suivante (sync_protocol.md §5.1, §9).
         */
        Conflict: {
            headers: {
                "X-Request-Id": components["headers"]["X-Request-Id"];
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /**
         * @description Opération à deux personnes du back-office (ADR-74) : demande d'approbation créée (`PENDING`), rien n'est
         *     encore exécuté. Une seconde personne l'approuve (`approveApprovalRequest`) ou la refuse
         *     (`rejectApprovalRequest`) avant `expires_at` (24 h). Un rejeu avec la même clé d'idempotence renvoie la
         *     même demande.
         */
        ApprovalRequestAccepted: {
            headers: {
                "X-Request-Id": components["headers"]["X-Request-Id"];
                "Idempotency-Replayed": components["headers"]["Idempotency-Replayed"];
                /** @description `/v1/approval-requests/{approval_request_id}` */
                Location?: string;
                [name: string]: unknown;
            };
            content: {
                /**
                 * @example {
                 *       "approval_request_id": "4b5c6d7e-8f90-4a1b-9c2d-3e4f5a6b7c8d",
                 *       "action": "WAIVE_SEQ_GAP",
                 *       "target_id": "7c0e1a52-0000-4000-8000-000000000002",
                 *       "payload": {
                 *         "device_id": "7c0e1a52-0000-4000-8000-000000000002",
                 *         "seq": 87,
                 *         "reason": "Terminal réinitialisé en usine après chute, journal local perdu."
                 *       },
                 *       "requested_by": "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
                 *       "requested_at": "2026-12-13T09:00:00Z",
                 *       "expires_at": "2026-12-14T09:00:00Z",
                 *       "status": "PENDING",
                 *       "decided_by": null,
                 *       "decided_at": null,
                 *       "decision_note": null,
                 *       "executed_tx_id": null,
                 *       "result": null,
                 *       "failure_code": null,
                 *       "failure_reason": null
                 *     }
                 */
                "application/json": components["schemas"]["ApprovalRequest"];
            };
        };
        /** @description Règle métier non satisfaite (`INSUFFICIENT_FUNDS`, `MEDIA_BLOCKED`, `WALLET_LIMIT_EXCEEDED`…). */
        Unprocessable: {
            headers: {
                "X-Request-Id": components["headers"]["X-Request-Id"];
                [name: string]: unknown;
            };
            content: {
                /**
                 * @example {
                 *       "type": "https://docs.cashless.test/problems/INSUFFICIENT_FUNDS",
                 *       "title": "Solde insuffisant",
                 *       "status": 422,
                 *       "code": "INSUFFICIENT_FUNDS",
                 *       "detail": "Solde disponible 3000 XOF, montant demandé 6000 XOF.",
                 *       "request_id": "0f1e2d3c-4b5a-4987-8a6b-5c4d3e2f1a0b",
                 *       "retryable": false,
                 *       "available_balance": 3000,
                 *       "currency": "XOF"
                 *     }
                 */
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /** @description Lot trop volumineux (`BATCH_TOO_LARGE`) ; le découper. */
        PayloadTooLarge: {
            headers: {
                "X-Request-Id": components["headers"]["X-Request-Id"];
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /** @description Trop de requêtes (`RATE_LIMITED`, `OTP_RATE_LIMITED`). */
        TooManyRequests: {
            headers: {
                "X-Request-Id": components["headers"]["X-Request-Id"];
                "Retry-After": components["headers"]["Retry-After"];
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /** @description Service ou PSP indisponible (`SERVICE_UNAVAILABLE`, `PSP_UNAVAILABLE`) ; réessayer avec la MÊME clé. */
        ServiceUnavailable: {
            headers: {
                "X-Request-Id": components["headers"]["X-Request-Id"];
                "Retry-After": components["headers"]["Retry-After"];
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
    };
    parameters: {
        /**
         * @description Jeton d'approbation sur place (guichet, ADR-74, SPECIFICATION §3.2). La seconde personne saisit son code
         *     personnel sur le même terminal ; le serveur d'identité (OIDC, authentification renforcée) délivre un JWT
         *     signé, valable 5 min, à usage unique (`jti` mémorisé jusqu'à l'expiration), lié à l'action :
         *     `sub` = valideur, `act` = operationId, `act_hash` = SHA-256 (hex) de la requête canonique
         *     (méthode, chemin, corps en JSON canonique JCS, RFC 8785 ; le jeton n'en fait pas partie).
         *     Le serveur vérifie signature, expiration, `jti` non réutilisé, `act` et `act_hash`, `sub` ≠ appelant et
         *     rôle du valideur ; le valideur transmis à la base est le `sub`. Obligatoire seulement quand l'opération
         *     l'exige (au-delà de `event.cash_refund_single_max`) : absent → `403 APPROVAL_REQUIRED` ; refusé
         *     (invalide, expiré, déjà utilisé, autre action, même personne) → `403 APPROVAL_INVALID`. Envoyé sans
         *     nécessité, il est vérifié puis consommé de la même façon.
         */
        ApprovalToken: string;
        ApprovalRequestId: string;
        /** @description Prestataire visé ; celui de la personne, sauf pour un `PLATFORM_ADMIN` (sinon `404`). */
        OperatorId: string;
        UserId: string;
        AssignmentId: string;
        /**
         * @description Clé d'idempotence. Terminaux : `<device_serial>:<seq>` (seq ≥ 1, au moins 4 chiffres). Autres : UUID.
         *     Conservée au moins 30 jours (terminaux : pour toujours, c'est la clé du grand livre).
         */
        IdempotencyKey: string;
        /**
         * @description Époque d'autorité de débit connue du terminal. DOIT être envoyée sur toute opération de débit.
         *     Si elle diffère de l'époque courante du serveur qui répond, celui-ci refuse le débit
         *     (`409 STALE_AUTHORITY_EPOCH` ou `DEBIT_AUTHORITY_EDGE`) et renvoie l'époque courante.
         */
        AuthorityEpoch: number;
        /** @description Identifiant de corrélation fourni par le client. */
        RequestId: string;
        /** @description Curseur opaque renvoyé par la page précédente (`next_cursor`). */
        Cursor: string;
        Limit: number;
        MediaId: string;
        WalletId: string;
        DeviceId: string;
        TransactionId: string;
        LedgerId: string;
        PaymentIntentId: string;
        PaymentRequestId: string;
        RefundRequestId: string;
        CashSessionId: string;
        KycVerificationId: string;
        HandoverId: string;
        /**
         * @description Langue des messages lisibles (`title`, `detail` des erreurs, libellés). Valeurs `fr` ou `en` ;
         *     défaut `fr` (en-tête absent ou sans langue prise en charge). Sans effet sur les codes stables.
         */
        AcceptLanguage: string;
        OutboundSignature: string;
    };
    requestBodies: never;
    headers: {
        /** @description Identifiant de corrélation (repris de la requête, sinon généré). */
        "X-Request-Id": string;
        /** @description `true` si la réponse est celle mémorisée pour une requête antérieure de même clé. */
        "Idempotency-Replayed": boolean;
        /** @description Version de la ressource. */
        ETag: string;
        /** @description Secondes avant de réessayer. */
        "Retry-After": number;
    };
    pathItems: never;
};
export type $defs = Record<string, never>;
export interface operations {
    createDeviceEnrollmentCode: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Clé d'idempotence. Terminaux : `<device_serial>:<seq>` (seq ≥ 1, au moins 4 chiffres). Autres : UUID.
                 *     Conservée au moins 30 jours (terminaux : pour toujours, c'est la clé du grand livre).
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                /** @description Identifiant de corrélation fourni par le client. */
                "X-Request-Id"?: components["parameters"]["RequestId"];
                /**
                 * @description Langue des messages lisibles (`title`, `detail` des erreurs, libellés). Valeurs `fr` ou `en` ;
                 *     défaut `fr` (en-tête absent ou sans langue prise en charge). Sans effet sur les codes stables.
                 */
                "Accept-Language"?: components["parameters"]["AcceptLanguage"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "event_id": "7b1e4a52-8f0c-4c1d-9d3e-2a6b0f1c9e11",
                 *       "pos_id": "0c6f0d7e-11aa-4b8b-9c3e-5d2f1a7b8c90",
                 *       "app_mode": "CATALOG_POS",
                 *       "kind": "POS",
                 *       "expires_in_seconds": 86400
                 *     }
                 */
                "application/json": components["schemas"]["EnrollmentCodeCreate"];
            };
        };
        responses: {
            /** @description Code créé (affiché une seule fois). */
            201: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "enrollment_code_id": "5a0c2c1e-0b9d-4b1e-8f7f-3f0e8d1d2c33",
                     *       "code": "K7PQ-4XZM-9RTA",
                     *       "expires_at": "2026-12-10T08:00:00Z",
                     *       "app_mode": "CATALOG_POS"
                     *     }
                     */
                    "application/json": components["schemas"]["EnrollmentCode"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            422: components["responses"]["Unprocessable"];
        };
    };
    enrollDevice: {
        parameters: {
            query?: never;
            header?: {
                /** @description Identifiant de corrélation fourni par le client. */
                "X-Request-Id"?: components["parameters"]["RequestId"];
                /**
                 * @description Langue des messages lisibles (`title`, `detail` des erreurs, libellés). Valeurs `fr` ou `en` ;
                 *     défaut `fr` (en-tête absent ou sans langue prise en charge). Sans effet sur les codes stables.
                 */
                "Accept-Language"?: components["parameters"]["AcceptLanguage"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "enrollment_code": "K7PQ-4XZM-9RTA",
                 *       "serial": "TPE-FOOD-02",
                 *       "os": "ANDROID",
                 *       "app_version": "1.4.2",
                 *       "signing_public_key": "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE4Zm2Lq9c0kqg8n1dXo3f0cC1mW3Qq1l3Zt6m2xY3fQ9m8u0X4bP0dL2c7aQ5eR9tY1uI3oP5aS7dF9gH1jK3lA==",
                 *       "agreement_public_key": "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEq1l3Zt6m2xY3fQ9m8u0X4bP0dL2c7aQ5eR9tY1uI3oP5aS7dF9gH1jK3lA4Zm2Lq9c0kqg8n1dXo3f0cC1mW3Q==",
                 *       "key_attestation_chain": [
                 *         "MIIC...leaf",
                 *         "MIIC...intermediate"
                 *       ],
                 *       "csr_pem": "-----BEGIN CERTIFICATE REQUEST-----\nMIIB...\n-----END CERTIFICATE REQUEST-----"
                 *     }
                 */
                "application/json": components["schemas"]["DeviceEnrollmentRequest"];
            };
        };
        responses: {
            /** @description Terminal enrôlé. */
            201: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "device_id": "3f7d2c10-6a55-4b6e-9d0e-1c2b3a4d5e6f",
                     *       "serial": "TPE-FOOD-02",
                     *       "certificate_pem": "-----BEGIN CERTIFICATE-----\nMIIC...\n-----END CERTIFICATE-----",
                     *       "access_token": "eyJhbGciOiJFUzI1NiIsImtpZCI6ImRldi0yMDI2In0.eyJzdWIiOiIzZjdkMmMxMCJ9.sig",
                     *       "token_type": "Bearer",
                     *       "expires_in": 900,
                     *       "refresh_token": "drt_2wq0mXn9vBv4c1s8u7yT",
                     *       "next_seq": 1,
                     *       "server_time": "2026-12-09T08:12:03Z"
                     *     }
                     */
                    "application/json": components["schemas"]["DeviceEnrollmentResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    refreshDeviceToken: {
        parameters: {
            query?: never;
            header?: {
                /** @description Identifiant de corrélation fourni par le client. */
                "X-Request-Id"?: components["parameters"]["RequestId"];
                /**
                 * @description Langue des messages lisibles (`title`, `detail` des erreurs, libellés). Valeurs `fr` ou `en` ;
                 *     défaut `fr` (en-tête absent ou sans langue prise en charge). Sans effet sur les codes stables.
                 */
                "Accept-Language"?: components["parameters"]["AcceptLanguage"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "serial": "TPE-FOOD-02",
                 *       "refresh_token": "drt_2wq0mXn9vBv4c1s8u7yT",
                 *       "nonce": "6f1c2b8e9a0d4e7f",
                 *       "signature": "MEUCIQDx...base64"
                 *     }
                 */
                "application/json": components["schemas"]["DeviceTokenRefreshRequest"];
            };
        };
        responses: {
            /** @description Nouveau jeton. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "access_token": "eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiIzZjdkIn0.sig",
                     *       "token_type": "Bearer",
                     *       "expires_in": 900,
                     *       "refresh_token": "drt_9pL0aQ2wE4rT6yU8iO1p"
                     *     }
                     */
                    "application/json": components["schemas"]["TokenResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
        };
    };
    getDeviceConfig: {
        parameters: {
            query?: never;
            header?: {
                /** @description Identifiant de corrélation fourni par le client. */
                "X-Request-Id"?: components["parameters"]["RequestId"];
                /**
                 * @description Langue des messages lisibles (`title`, `detail` des erreurs, libellés). Valeurs `fr` ou `en` ;
                 *     défaut `fr` (en-tête absent ou sans langue prise en charge). Sans effet sur les codes stables.
                 */
                "Accept-Language"?: components["parameters"]["AcceptLanguage"];
                /** @description ETag de la dernière configuration reçue. */
                "If-None-Match"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Configuration. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    ETag: components["headers"]["ETag"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "config_id": 48213,
                     *       "terminal_settings": {
                     *         "online_connect_timeout_ms": 2000,
                     *         "online_total_timeout_ms": 3000,
                     *         "online_retries": 2,
                     *         "pending_sync_seconds": 30,
                     *         "reconcile_sync_seconds": 300,
                     *         "heartbeat_seconds": 60,
                     *         "reversal_window_minutes": 15,
                     *         "local_retention_days": 7,
                     *         "tap_replay_window_seconds": 120
                     *       },
                     *       "device": {
                     *         "device_id": "3f7d2c10-6a55-4b6e-9d0e-1c2b3a4d5e6f",
                     *         "serial": "TPE-FOOD-02",
                     *         "kind": "POS",
                     *         "app_mode": "CATALOG_POS",
                     *         "os": "ANDROID",
                     *         "nfc_enabled": true,
                     *         "status": "ACTIVE",
                     *         "station_name": null
                     *       },
                     *       "event": {
                     *         "event_id": "7b1e4a52-8f0c-4c1d-9d3e-2a6b0f1c9e11",
                     *         "name": "Festival Sons 2026",
                     *         "currency": "XOF",
                     *         "minor_units": 0,
                     *         "timezone": "Africa/Dakar",
                     *         "status": "LIVE",
                     *         "activation_modes": [
                     *           "DESK",
                     *           "SELF_APP"
                     *         ]
                     *       },
                     *       "pos": {
                     *         "pos_id": "0c6f0d7e-11aa-4b8b-9c3e-5d2f1a7b8c90",
                     *         "name": "Food truck — comptoir 2",
                     *         "merchant_name": "Food truck"
                     *       },
                     *       "catalog": {
                     *         "version": 12,
                     *         "items": [
                     *           {
                     *             "product_id": "9d1b7a4c-2e3f-4a5b-8c6d-7e8f9a0b1c2d",
                     *             "name": "Thiéboudienne",
                     *             "unit_price": 3000,
                     *             "category": "Plats",
                     *             "vat_rate_bps": 1800
                     *           },
                     *           {
                     *             "product_id": "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
                     *             "name": "Bissap 33 cl",
                     *             "unit_price": 1000,
                     *             "category": "Boissons",
                     *             "vat_rate_bps": 1800
                     *           }
                     *         ]
                     *       },
                     *       "offline_policy": {
                     *         "offline_enabled": true,
                     *         "max_per_sale": 15000,
                     *         "max_per_media_per_device": 20000,
                     *         "max_total_per_device": 300000,
                     *         "max_snapshot_age_seconds": 900,
                     *         "cash_topup_offline": false,
                     *         "capped": false
                     *       },
                     *       "snapshot_keys": [
                     *         {
                     *           "key_id": "snap-2026-01",
                     *           "algorithm": "ECDSA_P256_SHA256",
                     *           "public_key": "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE7vN2kq9Lr0c1mW3Qq1l3Zt6m2xY3fQ9m8u0X4bP0dL2c7aQ5eR9tY1uI3oP5aS7dF9gH1jK3lA4Zm2Lq9c0kqg==",
                     *           "not_after": "2027-06-30T00:00:00Z"
                     *         }
                     *       ],
                     *       "debit_authority": {
                     *         "ledger_id": "2c9a1f0e-3b4d-4e5f-8a7b-6c5d4e3f2a1b",
                     *         "authority": "CENTRAL",
                     *         "epoch": 4,
                     *         "edge_gateway_id": null,
                     *         "edge_base_url": null
                     *       },
                     *       "seq": {
                     *         "next_seq_floor": 88,
                     *         "contiguous_acked_seq": 87
                     *       },
                     *       "server_time": "2026-12-13T21:00:00Z",
                     *       "clock_tolerance_seconds": 120
                     *     }
                     */
                    "application/json": components["schemas"]["DeviceConfig"];
                };
            };
            /** @description Configuration inchangée. */
            304: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
        };
    };
    postDeviceHeartbeat: {
        parameters: {
            query?: never;
            header?: {
                /** @description Identifiant de corrélation fourni par le client. */
                "X-Request-Id"?: components["parameters"]["RequestId"];
                /**
                 * @description Langue des messages lisibles (`title`, `detail` des erreurs, libellés). Valeurs `fr` ou `en` ;
                 *     défaut `fr` (en-tête absent ou sans langue prise en charge). Sans effet sur les codes stables.
                 */
                "Accept-Language"?: components["parameters"]["AcceptLanguage"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "device_time": "2026-12-13T21:00:01Z",
                 *       "snapshot_version": 1532,
                 *       "last_local_seq": 91,
                 *       "pending_operations": 4,
                 *       "pending_exposure": 12500,
                 *       "battery_percent": 64,
                 *       "app_version": "1.4.2"
                 *     }
                 */
                "application/json": components["schemas"]["HeartbeatRequest"];
            };
        };
        responses: {
            /** @description Accusé. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "server_time": "2026-12-13T21:00:00Z",
                     *       "config_etag": "\"cfg-7f3a\"",
                     *       "latest_snapshot_version": 1534,
                     *       "debit_authority": {
                     *         "ledger_id": "2c9a1f0e-3b4d-4e5f-8a7b-6c5d4e3f2a1b",
                     *         "authority": "CENTRAL",
                     *         "epoch": 4,
                     *         "edge_gateway_id": null,
                     *         "edge_base_url": null
                     *       },
                     *       "sync_requested": true
                     *     }
                     */
                    "application/json": components["schemas"]["HeartbeatResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
        };
    };
    getDeviceSeqStatus: {
        parameters: {
            query?: never;
            header?: {
                /** @description Identifiant de corrélation fourni par le client. */
                "X-Request-Id"?: components["parameters"]["RequestId"];
                /**
                 * @description Langue des messages lisibles (`title`, `detail` des erreurs, libellés). Valeurs `fr` ou `en` ;
                 *     défaut `fr` (en-tête absent ou sans langue prise en charge). Sans effet sur les codes stables.
                 */
                "Accept-Language"?: components["parameters"]["AcceptLanguage"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description État des séquences. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "device_serial": "TPE-FOOD-02",
                     *       "contiguous_acked_seq": 85,
                     *       "max_seen_seq": 91,
                     *       "missing_seqs": [
                     *         86
                     *       ],
                     *       "next_seq_floor": 92
                     *     }
                     */
                    "application/json": components["schemas"]["SeqStatus"];
                };
            };
            401: components["responses"]["Unauthorized"];
        };
    };
    getEventDeviceSyncStatus: {
        parameters: {
            query?: never;
            header?: {
                /** @description Identifiant de corrélation fourni par le client. */
                "X-Request-Id"?: components["parameters"]["RequestId"];
            };
            path: {
                event_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description État de remontée. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "sync_deadline": "2026-07-14T02:00:00Z",
                     *       "devices": [
                     *         {
                     *           "device_id": "7c0e1a52-0000-4000-8000-000000000001",
                     *           "serial": "TPE-BAR-01",
                     *           "caught_up": true,
                     *           "reason": null
                     *         },
                     *         {
                     *           "device_id": "7c0e1a52-0000-4000-8000-000000000002",
                     *           "serial": "TPE-FOOD-02",
                     *           "caught_up": false,
                     *           "reason": "NOT_SEEN_SINCE_CLOSING"
                     *         }
                     *       ]
                     *     }
                     */
                    "application/json": {
                        /** Format: date-time */
                        sync_deadline: string | null;
                        devices: {
                            /** Format: uuid */
                            device_id: string;
                            serial: string;
                            caught_up: boolean;
                            /** @enum {string|null} */
                            reason?: "NOT_SEEN_SINCE_CLOSING" | "SEQ_GAP" | "BATCH_IN_PROGRESS" | null;
                        }[];
                    };
                };
            };
            401: components["responses"]["Unauthorized"];
        };
    };
    waiveSeqGap: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Clé d'idempotence. Terminaux : `<device_serial>:<seq>` (seq ≥ 1, au moins 4 chiffres). Autres : UUID.
                 *     Conservée au moins 30 jours (terminaux : pour toujours, c'est la clé du grand livre).
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                /** @description Identifiant de corrélation fourni par le client. */
                "X-Request-Id"?: components["parameters"]["RequestId"];
                /**
                 * @description Langue des messages lisibles (`title`, `detail` des erreurs, libellés). Valeurs `fr` ou `en` ;
                 *     défaut `fr` (en-tête absent ou sans langue prise en charge). Sans effet sur les codes stables.
                 */
                "Accept-Language"?: components["parameters"]["AcceptLanguage"];
            };
            path: {
                device_id: components["parameters"]["DeviceId"];
                seq: number;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "reason": "Terminal réinitialisé en usine après chute, journal local perdu."
                 *     }
                 */
                "application/json": {
                    reason: string;
                };
            };
        };
        responses: {
            202: components["responses"]["ApprovalRequestAccepted"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
        };
    };
    importDeviceJournal: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Clé d'idempotence. Terminaux : `<device_serial>:<seq>` (seq ≥ 1, au moins 4 chiffres). Autres : UUID.
                 *     Conservée au moins 30 jours (terminaux : pour toujours, c'est la clé du grand livre).
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                /** @description Identifiant de corrélation fourni par le client. */
                "X-Request-Id"?: components["parameters"]["RequestId"];
                /**
                 * @description Langue des messages lisibles (`title`, `detail` des erreurs, libellés). Valeurs `fr` ou `en` ;
                 *     défaut `fr` (en-tête absent ou sans langue prise en charge). Sans effet sur les codes stables.
                 */
                "Accept-Language"?: components["parameters"]["AcceptLanguage"];
            };
            path: {
                device_id: components["parameters"]["DeviceId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["DeviceJournalImport"];
            };
        };
        responses: {
            202: components["responses"]["ApprovalRequestAccepted"];
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            413: components["responses"]["PayloadTooLarge"];
        };
    };
    getMediaAuthKey: {
        parameters: {
            query?: never;
            header?: {
                /** @description Identifiant de corrélation fourni par le client. */
                "X-Request-Id"?: components["parameters"]["RequestId"];
                /**
                 * @description Langue des messages lisibles (`title`, `detail` des erreurs, libellés). Valeurs `fr` ou `en` ;
                 *     défaut `fr` (en-tête absent ou sans langue prise en charge). Sans effet sur les codes stables.
                 */
                "Accept-Language"?: components["parameters"]["AcceptLanguage"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "nfc_uid": "04a1b2c3d4e5f6",
                 *       "key_index": 1
                 *     }
                 */
                "application/json": components["schemas"]["MediaAuthKeyRequest"];
            };
        };
        responses: {
            /** @description PWD||PACK chiffré pour ce terminal. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "nfc_uid": "04a1b2c3d4e5f6",
                     *       "key_index": 1,
                     *       "enc": {
                     *         "alg": "ECDH-ES+HKDF-SHA256+A256GCM",
                     *         "epk": "BGx1...base64url",
                     *         "nonce": "3q2+7w0AAAABAAAA",
                     *         "ciphertext": "V2hhdGV2ZXI",
                     *         "tag": "pQ1u9hV0Wm6o3vXcZ8r1Tg"
                     *       },
                     *       "ttl_seconds": 60
                     *     }
                     */
                    "application/json": components["schemas"]["MediaAuthKey"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            404: components["responses"]["NotFound"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    createTap: {
        parameters: {
            query?: never;
            header?: {
                /** @description Identifiant de corrélation fourni par le client. */
                "X-Request-Id"?: components["parameters"]["RequestId"];
                /**
                 * @description Langue des messages lisibles (`title`, `detail` des erreurs, libellés). Valeurs `fr` ou `en` ;
                 *     défaut `fr` (en-tête absent ou sans langue prise en charge). Sans effet sur les codes stables.
                 */
                "Accept-Language"?: components["parameters"]["AcceptLanguage"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "nfc_uid": "04a1b2c3d4e5f6",
                 *       "token_hash": "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
                 *       "counter": 412,
                 *       "key_index": 1,
                 *       "format_major": 1,
                 *       "format_minor": 0,
                 *       "pack_verified": true,
                 *       "originality_signature": "3a7f0c9e5b2d4a6f8e1c3b5d7f9a0c2e4b6d8f0a1c3e5b7d9f0a2c4e6b8d0f1a",
                 *       "occurred_at": "2026-12-11T19:09:58Z"
                 *     }
                 */
                "application/json": components["schemas"]["TapInput"];
            };
        };
        responses: {
            /** @description Résultat de la lecture. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TapResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
        };
    };
    activateMedia: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Clé d'idempotence. Terminaux : `<device_serial>:<seq>` (seq ≥ 1, au moins 4 chiffres). Autres : UUID.
                 *     Conservée au moins 30 jours (terminaux : pour toujours, c'est la clé du grand livre).
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                /** @description Identifiant de corrélation fourni par le client. */
                "X-Request-Id"?: components["parameters"]["RequestId"];
                /**
                 * @description Langue des messages lisibles (`title`, `detail` des erreurs, libellés). Valeurs `fr` ou `en` ;
                 *     défaut `fr` (en-tête absent ou sans langue prise en charge). Sans effet sur les codes stables.
                 */
                "Accept-Language"?: components["parameters"]["AcceptLanguage"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "tap_id": 918270,
                 *       "channel": "DESK",
                 *       "wallet_id": null,
                 *       "customer_id": null,
                 *       "deposit_payment": {
                 *         "method": "CASH"
                 *       },
                 *       "occurred_at": "2026-12-11T18:03:00Z"
                 *     }
                 */
                "application/json": components["schemas"]["MediaActivationRequest"];
            };
        };
        responses: {
            /** @description Bracelet activé. */
            201: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    "Idempotency-Replayed": components["headers"]["Idempotency-Replayed"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "media_id": "1d2e3f40-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
                     *       "media_status": "ACTIVE",
                     *       "wallet": {
                     *         "wallet_id": "a1b2c3d4-e5f6-4789-8abc-def012345678",
                     *         "status": "ACTIVE",
                     *         "currency": "XOF",
                     *         "spendable": 0,
                     *         "paid": 0,
                     *         "promo": 0
                     *       },
                     *       "deposit": {
                     *         "status": "HELD",
                     *         "amount": 2000,
                     *         "mode": "SEPARATE",
                     *         "transaction_id": "5b6c7d8e-9f0a-4b1c-8d2e-3f4a5b6c7d8e"
                     *       }
                     *     }
                     */
                    "application/json": components["schemas"]["MediaActivationResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
        };
    };
    getMedia: {
        parameters: {
            query?: never;
            header?: {
                /** @description Identifiant de corrélation fourni par le client. */
                "X-Request-Id"?: components["parameters"]["RequestId"];
                /**
                 * @description Langue des messages lisibles (`title`, `detail` des erreurs, libellés). Valeurs `fr` ou `en` ;
                 *     défaut `fr` (en-tête absent ou sans langue prise en charge). Sans effet sur les codes stables.
                 */
                "Accept-Language"?: components["parameters"]["AcceptLanguage"];
            };
            path: {
                media_id: components["parameters"]["MediaId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Bracelet. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "media_id": "1d2e3f40-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
                     *       "kind": "NFC_TAG",
                     *       "chip_type": "MF0UL11",
                     *       "nfc_uid": "04a1b2c3d4e5f6",
                     *       "key_index": 1,
                     *       "status": "ACTIVE",
                     *       "batch_id": "44d1e2f3-a4b5-4c6d-8e7f-9a0b1c2d3e4f",
                     *       "batch_kind": "PUBLIC",
                     *       "deposit_status": "HELD",
                     *       "deposit_held": 2000,
                     *       "wallet_ids": [
                     *         "a1b2c3d4-e5f6-4789-8abc-def012345678"
                     *       ],
                     *       "last_counter": 412
                     *     }
                     */
                    "application/json": components["schemas"]["Media"];
                };
            };
            401: components["responses"]["Unauthorized"];
            404: components["responses"]["NotFound"];
        };
    };
    takeDeposit: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Clé d'idempotence. Terminaux : `<device_serial>:<seq>` (seq ≥ 1, au moins 4 chiffres). Autres : UUID.
                 *     Conservée au moins 30 jours (terminaux : pour toujours, c'est la clé du grand livre).
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                /** @description Identifiant de corrélation fourni par le client. */
                "X-Request-Id"?: components["parameters"]["RequestId"];
                /**
                 * @description Langue des messages lisibles (`title`, `detail` des erreurs, libellés). Valeurs `fr` ou `en` ;
                 *     défaut `fr` (en-tête absent ou sans langue prise en charge). Sans effet sur les codes stables.
                 */
                "Accept-Language"?: components["parameters"]["AcceptLanguage"];
            };
            path: {
                media_id: components["parameters"]["MediaId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "tap_id": 918271,
                 *       "payment": {
                 *         "method": "CASH"
                 *       }
                 *     }
                 */
                "application/json": components["schemas"]["DepositRequest"];
            };
        };
        responses: {
            /** @description État de la caution. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    "Idempotency-Replayed": components["headers"]["Idempotency-Replayed"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "status": "HELD",
                     *       "amount": 2000,
                     *       "mode": "FROM_BALANCE",
                     *       "transaction_id": "7c8d9e0f-1a2b-4c3d-9e4f-5a6b7c8d9e0f"
                     *     }
                     */
                    "application/json": components["schemas"]["DepositState"];
                };
            };
            401: components["responses"]["Unauthorized"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
        };
    };
    refundDeposit: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Clé d'idempotence. Terminaux : `<device_serial>:<seq>` (seq ≥ 1, au moins 4 chiffres). Autres : UUID.
                 *     Conservée au moins 30 jours (terminaux : pour toujours, c'est la clé du grand livre).
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                /** @description Identifiant de corrélation fourni par le client. */
                "X-Request-Id"?: components["parameters"]["RequestId"];
                /**
                 * @description Langue des messages lisibles (`title`, `detail` des erreurs, libellés). Valeurs `fr` ou `en` ;
                 *     défaut `fr` (en-tête absent ou sans langue prise en charge). Sans effet sur les codes stables.
                 */
                "Accept-Language"?: components["parameters"]["AcceptLanguage"];
            };
            path: {
                media_id: components["parameters"]["MediaId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "tap_id": 918300,
                 *       "payment": {
                 *         "method": "CASH"
                 *       }
                 *     }
                 */
                "application/json": components["schemas"]["DepositRequest"];
            };
        };
        responses: {
            /** @description Caution rendue. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    "Idempotency-Replayed": components["headers"]["Idempotency-Replayed"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "status": "REFUNDED",
                     *       "amount": 2000,
                     *       "mode": "SEPARATE",
                     *       "transaction_id": "8d9e0f1a-2b3c-4d4e-8f5a-6b7c8d9e0f1a"
                     *     }
                     */
                    "application/json": components["schemas"]["DepositState"];
                };
            };
            401: components["responses"]["Unauthorized"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
        };
    };
    releaseMedia: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Clé d'idempotence. Terminaux : `<device_serial>:<seq>` (seq ≥ 1, au moins 4 chiffres). Autres : UUID.
                 *     Conservée au moins 30 jours (terminaux : pour toujours, c'est la clé du grand livre).
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                /**
                 * @description Jeton d'approbation sur place (guichet, ADR-74, SPECIFICATION §3.2). La seconde personne saisit son code
                 *     personnel sur le même terminal ; le serveur d'identité (OIDC, authentification renforcée) délivre un JWT
                 *     signé, valable 5 min, à usage unique (`jti` mémorisé jusqu'à l'expiration), lié à l'action :
                 *     `sub` = valideur, `act` = operationId, `act_hash` = SHA-256 (hex) de la requête canonique
                 *     (méthode, chemin, corps en JSON canonique JCS, RFC 8785 ; le jeton n'en fait pas partie).
                 *     Le serveur vérifie signature, expiration, `jti` non réutilisé, `act` et `act_hash`, `sub` ≠ appelant et
                 *     rôle du valideur ; le valideur transmis à la base est le `sub`. Obligatoire seulement quand l'opération
                 *     l'exige (au-delà de `event.cash_refund_single_max`) : absent → `403 APPROVAL_REQUIRED` ; refusé
                 *     (invalide, expiré, déjà utilisé, autre action, même personne) → `403 APPROVAL_INVALID`. Envoyé sans
                 *     nécessité, il est vérifié puis consommé de la même façon.
                 */
                "X-Approval-Token"?: components["parameters"]["ApprovalToken"];
                /** @description Identifiant de corrélation fourni par le client. */
                "X-Request-Id"?: components["parameters"]["RequestId"];
                /**
                 * @description Langue des messages lisibles (`title`, `detail` des erreurs, libellés). Valeurs `fr` ou `en` ;
                 *     défaut `fr` (en-tête absent ou sans langue prise en charge). Sans effet sur les codes stables.
                 */
                "Accept-Language"?: components["parameters"]["AcceptLanguage"];
            };
            path: {
                media_id: components["parameters"]["MediaId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "tap_id": 918301,
                 *       "cash_session_id": "0d4e5f6a-7b8c-4d9e-8f0a-1b2c3d4e5f6a",
                 *       "refund_deposit_by": {
                 *         "method": "CASH"
                 *       },
                 *       "settle_balance": {
                 *         "method": "CASH"
                 *       }
                 *     }
                 */
                "application/json": components["schemas"]["MediaReleaseRequest"];
            };
        };
        responses: {
            /** @description Bracelet restitué. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    "Idempotency-Replayed": components["headers"]["Idempotency-Replayed"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "media_id": "1d2e3f40-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
                     *       "media_status": "RELEASED",
                     *       "deposit_refund_transaction_id": "8d9e0f1a-2b3c-4d4e-8f5a-6b7c8d9e0f1a",
                     *       "promo_expiry_transaction_id": null,
                     *       "balance_refund_transaction_id": "9e0f1a2b-3c4d-4e5f-9a6b-7c8d9e0f1a2b",
                     *       "cash_to_hand_back": 3500
                     *     }
                     */
                    "application/json": components["schemas"]["MediaReleaseResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
        };
    };
    replaceMedia: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Clé d'idempotence. Terminaux : `<device_serial>:<seq>` (seq ≥ 1, au moins 4 chiffres). Autres : UUID.
                 *     Conservée au moins 30 jours (terminaux : pour toujours, c'est la clé du grand livre).
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                /** @description Identifiant de corrélation fourni par le client. */
                "X-Request-Id"?: components["parameters"]["RequestId"];
                /**
                 * @description Langue des messages lisibles (`title`, `detail` des erreurs, libellés). Valeurs `fr` ou `en` ;
                 *     défaut `fr` (en-tête absent ou sans langue prise en charge). Sans effet sur les codes stables.
                 */
                "Accept-Language"?: components["parameters"]["AcceptLanguage"];
            };
            path: {
                media_id: components["parameters"]["MediaId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "new_media_tap_id": 918410,
                 *       "reason": "Bracelet déchiré, identité vérifiée sur pièce."
                 *     }
                 */
                "application/json": {
                    /** Format: int64 */
                    new_media_tap_id: number;
                    reason: string;
                };
            };
        };
        responses: {
            /** @description Remplacement effectué. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "old_media_id": "1d2e3f40-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
                     *       "new_media_id": "2e3f4051-6b7c-4d8e-9fa0-1b2c3d4e5f60",
                     *       "wallet_id": "a1b2c3d4-e5f6-4789-8abc-def012345678"
                     *     }
                     */
                    "application/json": {
                        /** Format: uuid */
                        old_media_id: string;
                        /** Format: uuid */
                        new_media_id: string;
                        /** Format: uuid */
                        wallet_id: string;
                    };
                };
            };
            401: components["responses"]["Unauthorized"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
        };
    };
    refundCashDue: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Clé d'idempotence. Terminaux : `<device_serial>:<seq>` (seq ≥ 1, au moins 4 chiffres). Autres : UUID.
                 *     Conservée au moins 30 jours (terminaux : pour toujours, c'est la clé du grand livre).
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                /**
                 * @description Jeton d'approbation sur place (guichet, ADR-74, SPECIFICATION §3.2). La seconde personne saisit son code
                 *     personnel sur le même terminal ; le serveur d'identité (OIDC, authentification renforcée) délivre un JWT
                 *     signé, valable 5 min, à usage unique (`jti` mémorisé jusqu'à l'expiration), lié à l'action :
                 *     `sub` = valideur, `act` = operationId, `act_hash` = SHA-256 (hex) de la requête canonique
                 *     (méthode, chemin, corps en JSON canonique JCS, RFC 8785 ; le jeton n'en fait pas partie).
                 *     Le serveur vérifie signature, expiration, `jti` non réutilisé, `act` et `act_hash`, `sub` ≠ appelant et
                 *     rôle du valideur ; le valideur transmis à la base est le `sub`. Obligatoire seulement quand l'opération
                 *     l'exige (au-delà de `event.cash_refund_single_max`) : absent → `403 APPROVAL_REQUIRED` ; refusé
                 *     (invalide, expiré, déjà utilisé, autre action, même personne) → `403 APPROVAL_INVALID`. Envoyé sans
                 *     nécessité, il est vérifié puis consommé de la même façon.
                 */
                "X-Approval-Token"?: components["parameters"]["ApprovalToken"];
                /** @description Identifiant de corrélation fourni par le client. */
                "X-Request-Id"?: components["parameters"]["RequestId"];
                /**
                 * @description Langue des messages lisibles (`title`, `detail` des erreurs, libellés). Valeurs `fr` ou `en` ;
                 *     défaut `fr` (en-tête absent ou sans langue prise en charge). Sans effet sur les codes stables.
                 */
                "Accept-Language"?: components["parameters"]["AcceptLanguage"];
            };
            path: {
                media_id: components["parameters"]["MediaId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "tap_id": 918520,
                 *       "cash_session_id": "0d4e5f6a-7b8c-4d9e-8f0a-1b2c3d4e5f6a"
                 *     }
                 */
                "application/json": components["schemas"]["CashDueRefundRequest"];
            };
        };
        responses: {
            /** @description Espèces rendues ; remettre `amount` au détenteur. */
            201: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    "Idempotency-Replayed": components["headers"]["Idempotency-Replayed"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "transaction_id": "5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d",
                     *       "idempotency_key": "C1-TPE:0042",
                     *       "media_id": "1d2e3f40-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
                     *       "amount": 7000,
                     *       "currency": "XOF",
                     *       "resolved_anomaly_ids": [
                     *         "e2f3a4b5-c6d7-4e8f-9a0b-1c2d3e4f5a6b"
                     *       ],
                     *       "approved_by": null
                     *     }
                     */
                    "application/json": components["schemas"]["CashDueRefundResult"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
        };
    };
    createPayment: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Époque d'autorité de débit connue du terminal. DOIT être envoyée sur toute opération de débit.
                 *     Si elle diffère de l'époque courante du serveur qui répond, celui-ci refuse le débit
                 *     (`409 STALE_AUTHORITY_EPOCH` ou `DEBIT_AUTHORITY_EDGE`) et renvoie l'époque courante.
                 */
                "X-Authority-Epoch"?: components["parameters"]["AuthorityEpoch"];
                /**
                 * @description Clé d'idempotence. Terminaux : `<device_serial>:<seq>` (seq ≥ 1, au moins 4 chiffres). Autres : UUID.
                 *     Conservée au moins 30 jours (terminaux : pour toujours, c'est la clé du grand livre).
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                /** @description Identifiant de corrélation fourni par le client. */
                "X-Request-Id"?: components["parameters"]["RequestId"];
                /**
                 * @description Langue des messages lisibles (`title`, `detail` des erreurs, libellés). Valeurs `fr` ou `en` ;
                 *     défaut `fr` (en-tête absent ou sans langue prise en charge). Sans effet sur les codes stables.
                 */
                "Accept-Language"?: components["parameters"]["AcceptLanguage"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PaymentRequestBody"];
            };
        };
        responses: {
            /** @description Paiement accepté. */
            201: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    "Idempotency-Replayed": components["headers"]["Idempotency-Replayed"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "transaction_id": "3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f",
                     *       "idempotency_key": "TPE-FOOD-01:0001",
                     *       "type": "PURCHASE",
                     *       "status": "SUCCEEDED",
                     *       "amount": 6000,
                     *       "currency": "XOF",
                     *       "occurred_at": "2026-12-11T19:10:00Z",
                     *       "recorded_at": "2026-12-11T19:10:00.412Z",
                     *       "media_id": "1d2e3f40-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
                     *       "wallet_id": "a1b2c3d4-e5f6-4789-8abc-def012345678",
                     *       "balance_after": {
                     *         "spendable": 13000,
                     *         "paid": 13000,
                     *         "promo": 0
                     *       },
                     *       "receipt_number": "FOOD-01-000001"
                     *     }
                     */
                    "application/json": components["schemas"]["PaymentResult"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    getPayment: {
        parameters: {
            query?: never;
            header?: {
                /** @description Identifiant de corrélation fourni par le client. */
                "X-Request-Id"?: components["parameters"]["RequestId"];
                /**
                 * @description Langue des messages lisibles (`title`, `detail` des erreurs, libellés). Valeurs `fr` ou `en` ;
                 *     défaut `fr` (en-tête absent ou sans langue prise en charge). Sans effet sur les codes stables.
                 */
                "Accept-Language"?: components["parameters"]["AcceptLanguage"];
            };
            path: {
                transaction_id: components["parameters"]["TransactionId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Paiement. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PaymentResult"];
                };
            };
            401: components["responses"]["Unauthorized"];
            404: components["responses"]["NotFound"];
        };
    };
    reversePayment: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Époque d'autorité de débit connue du terminal. DOIT être envoyée sur toute opération de débit.
                 *     Si elle diffère de l'époque courante du serveur qui répond, celui-ci refuse le débit
                 *     (`409 STALE_AUTHORITY_EPOCH` ou `DEBIT_AUTHORITY_EDGE`) et renvoie l'époque courante.
                 */
                "X-Authority-Epoch"?: components["parameters"]["AuthorityEpoch"];
                /**
                 * @description Clé d'idempotence. Terminaux : `<device_serial>:<seq>` (seq ≥ 1, au moins 4 chiffres). Autres : UUID.
                 *     Conservée au moins 30 jours (terminaux : pour toujours, c'est la clé du grand livre).
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                /** @description Identifiant de corrélation fourni par le client. */
                "X-Request-Id"?: components["parameters"]["RequestId"];
                /**
                 * @description Langue des messages lisibles (`title`, `detail` des erreurs, libellés). Valeurs `fr` ou `en` ;
                 *     défaut `fr` (en-tête absent ou sans langue prise en charge). Sans effet sur les codes stables.
                 */
                "Accept-Language"?: components["parameters"]["AcceptLanguage"];
            };
            path: {
                transaction_id: components["parameters"]["TransactionId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "reason": "INPUT_ERROR",
                 *       "comment": "Erreur de saisie, 6000 au lieu de 3000",
                 *       "occurred_at": "2026-12-12T19:03:00Z"
                 *     }
                 */
                "application/json": components["schemas"]["ReversalRequest"];
            };
        };
        responses: {
            /** @description Annulation enregistrée. */
            201: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    "Idempotency-Replayed": components["headers"]["Idempotency-Replayed"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "transaction_id": "4d5e6f7a-8b9c-4d0e-9f1a-2b3c4d5e6f7a",
                     *       "idempotency_key": "TPE-BAR-01:0004",
                     *       "type": "REVERSAL",
                     *       "status": "SUCCEEDED",
                     *       "reverses_id": "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e",
                     *       "amount": 6000,
                     *       "currency": "XOF",
                     *       "occurred_at": "2026-12-12T19:03:00Z",
                     *       "recorded_at": "2026-12-12T19:03:00.210Z",
                     *       "media_id": "1d2e3f40-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
                     *       "wallet_id": "b2c3d4e5-f6a7-4890-9bcd-ef0123456789",
                     *       "balance_after": {
                     *         "spendable": 10000,
                     *         "paid": 10000,
                     *         "promo": 0
                     *       },
                     *       "receipt_number": "BAR-01-000004"
                     *     }
                     */
                    "application/json": components["schemas"]["PaymentResult"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
        };
    };
    createCashTopup: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Époque d'autorité de débit connue du terminal. DOIT être envoyée sur toute opération de débit.
                 *     Si elle diffère de l'époque courante du serveur qui répond, celui-ci refuse le débit
                 *     (`409 STALE_AUTHORITY_EPOCH` ou `DEBIT_AUTHORITY_EDGE`) et renvoie l'époque courante.
                 */
                "X-Authority-Epoch"?: components["parameters"]["AuthorityEpoch"];
                /**
                 * @description Clé d'idempotence. Terminaux : `<device_serial>:<seq>` (seq ≥ 1, au moins 4 chiffres). Autres : UUID.
                 *     Conservée au moins 30 jours (terminaux : pour toujours, c'est la clé du grand livre).
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                /** @description Identifiant de corrélation fourni par le client. */
                "X-Request-Id"?: components["parameters"]["RequestId"];
                /**
                 * @description Langue des messages lisibles (`title`, `detail` des erreurs, libellés). Valeurs `fr` ou `en` ;
                 *     défaut `fr` (en-tête absent ou sans langue prise en charge). Sans effet sur les codes stables.
                 */
                "Accept-Language"?: components["parameters"]["AcceptLanguage"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "amount": 10000,
                 *       "currency": "XOF",
                 *       "occurred_at": "2026-12-11T18:02:00Z",
                 *       "tap_id": 918200,
                 *       "cash_tendered": 10000
                 *     }
                 */
                "application/json": components["schemas"]["CashTopupRequest"];
            };
        };
        responses: {
            /** @description Recharge enregistrée. */
            201: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    "Idempotency-Replayed": components["headers"]["Idempotency-Replayed"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "transaction_id": "6f7a8b9c-0d1e-4f2a-8b3c-4d5e6f7a8b9c",
                     *       "idempotency_key": "C1-TPE:0001",
                     *       "type": "TOPUP_CASH",
                     *       "status": "SUCCEEDED",
                     *       "amount": 10000,
                     *       "currency": "XOF",
                     *       "wallet_id": "b2c3d4e5-f6a7-4890-9bcd-ef0123456789",
                     *       "balance_after": {
                     *         "spendable": 10000,
                     *         "paid": 10000,
                     *         "promo": 0
                     *       },
                     *       "deposit": null
                     *     }
                     */
                    "application/json": components["schemas"]["TopupResult"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
        };
    };
    initiatePspTopup: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Clé d'idempotence. Terminaux : `<device_serial>:<seq>` (seq ≥ 1, au moins 4 chiffres). Autres : UUID.
                 *     Conservée au moins 30 jours (terminaux : pour toujours, c'est la clé du grand livre).
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                /** @description Identifiant de corrélation fourni par le client. */
                "X-Request-Id"?: components["parameters"]["RequestId"];
                /**
                 * @description Langue des messages lisibles (`title`, `detail` des erreurs, libellés). Valeurs `fr` ou `en` ;
                 *     défaut `fr` (en-tête absent ou sans langue prise en charge). Sans effet sur les codes stables.
                 */
                "Accept-Language"?: components["parameters"]["AcceptLanguage"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "wallet_id": "a1b2c3d4-e5f6-4789-8abc-def012345678",
                 *       "amount": 20000,
                 *       "currency": "XOF",
                 *       "provider": "WAVE",
                 *       "payer_msisdn": "+221770000001",
                 *       "return_url": "cashless://topups/return"
                 *     }
                 */
                "application/json": components["schemas"]["PspTopupRequest"];
            };
        };
        responses: {
            /** @description Recharge initiée. */
            201: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    "Idempotency-Replayed": components["headers"]["Idempotency-Replayed"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "topup_id": "0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d",
                     *       "status": "PENDING",
                     *       "provider": "WAVE",
                     *       "provider_reference": "WV-88121",
                     *       "amount": 20000,
                     *       "currency": "XOF",
                     *       "wallet_id": "a1b2c3d4-e5f6-4789-8abc-def012345678",
                     *       "checkout_url": "https://pay.wave.test/c/cos-18qz",
                     *       "expires_at": "2026-12-01T10:27:00Z",
                     *       "transaction_id": null
                     *     }
                     */
                    "application/json": components["schemas"]["PspTopup"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            404: components["responses"]["NotFound"];
            422: components["responses"]["Unprocessable"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    getPspTopup: {
        parameters: {
            query?: never;
            header?: {
                /** @description Identifiant de corrélation fourni par le client. */
                "X-Request-Id"?: components["parameters"]["RequestId"];
                /**
                 * @description Langue des messages lisibles (`title`, `detail` des erreurs, libellés). Valeurs `fr` ou `en` ;
                 *     défaut `fr` (en-tête absent ou sans langue prise en charge). Sans effet sur les codes stables.
                 */
                "Accept-Language"?: components["parameters"]["AcceptLanguage"];
            };
            path: {
                topup_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Recharge. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "topup_id": "0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d",
                     *       "status": "SUCCEEDED",
                     *       "provider": "WAVE",
                     *       "provider_reference": "WV-88121",
                     *       "amount": 20000,
                     *       "currency": "XOF",
                     *       "wallet_id": "a1b2c3d4-e5f6-4789-8abc-def012345678",
                     *       "checkout_url": null,
                     *       "expires_at": "2026-12-01T10:27:00Z",
                     *       "transaction_id": "1f2a3b4c-5d6e-4f7a-8b9c-0d1e2f3a4b5c"
                     *     }
                     */
                    "application/json": components["schemas"]["PspTopup"];
                };
            };
            401: components["responses"]["Unauthorized"];
            404: components["responses"]["NotFound"];
        };
    };
    openCashSession: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Clé d'idempotence. Terminaux : `<device_serial>:<seq>` (seq ≥ 1, au moins 4 chiffres). Autres : UUID.
                 *     Conservée au moins 30 jours (terminaux : pour toujours, c'est la clé du grand livre).
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                /** @description Identifiant de corrélation fourni par le client. */
                "X-Request-Id"?: components["parameters"]["RequestId"];
                /**
                 * @description Langue des messages lisibles (`title`, `detail` des erreurs, libellés). Valeurs `fr` ou `en` ;
                 *     défaut `fr` (en-tête absent ou sans langue prise en charge). Sans effet sur les codes stables.
                 */
                "Accept-Language"?: components["parameters"]["AcceptLanguage"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "cash_account_id": "3b4c5d6e-7f80-4a91-8b2c-3d4e5f607182",
                 *       "device_id": "3f7d2c10-6a55-4b6e-9d0e-1c2b3a4d5e6f"
                 *     }
                 */
                "application/json": {
                    /**
                     * Format: uuid
                     * @description Compte `CASH_DESK` de la caisse (même grand livre que l'événement).
                     */
                    cash_account_id: string;
                    /**
                     * Format: uuid
                     * @description Terminal `TOPUP_DESK` de la caisse, s'il y en a un.
                     */
                    device_id?: string;
                };
            };
        };
        responses: {
            /** @description Session ouverte. */
            201: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    "Idempotency-Replayed": components["headers"]["Idempotency-Replayed"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "cash_session_id": "0d4e5f6a-7b8c-4d9e-8f0a-1b2c3d4e5f6a",
                     *       "cash_account_id": "3b4c5d6e-7f80-4a91-8b2c-3d4e5f607182",
                     *       "device_id": "3f7d2c10-6a55-4b6e-9d0e-1c2b3a4d5e6f",
                     *       "status": "OPEN",
                     *       "opened_by": "7a6b5c4d-3e2f-4a1b-9c8d-7e6f5a4b3c2d",
                     *       "opened_at": "2026-12-11T16:00:00Z",
                     *       "last_count": null,
                     *       "closed_at": null,
                     *       "cash_close_transaction_id": null,
                     *       "difference": null
                     *     }
                     */
                    "application/json": components["schemas"]["CashSession"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            409: components["responses"]["Conflict"];
        };
    };
    countCashSession: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Clé d'idempotence. Terminaux : `<device_serial>:<seq>` (seq ≥ 1, au moins 4 chiffres). Autres : UUID.
                 *     Conservée au moins 30 jours (terminaux : pour toujours, c'est la clé du grand livre).
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                /** @description Identifiant de corrélation fourni par le client. */
                "X-Request-Id"?: components["parameters"]["RequestId"];
                /**
                 * @description Langue des messages lisibles (`title`, `detail` des erreurs, libellés). Valeurs `fr` ou `en` ;
                 *     défaut `fr` (en-tête absent ou sans langue prise en charge). Sans effet sur les codes stables.
                 */
                "Accept-Language"?: components["parameters"]["AcceptLanguage"];
            };
            path: {
                cash_session_id: components["parameters"]["CashSessionId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "counted_amount": 412000,
                 *       "counted_at": "2026-12-12T02:10:00Z"
                 *     }
                 */
                "application/json": {
                    /** Format: int64 */
                    counted_amount: number;
                    counted_at: components["schemas"]["Timestamp"];
                    note?: string;
                };
            };
        };
        responses: {
            /** @description Comptage enregistré. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    "Idempotency-Replayed": components["headers"]["Idempotency-Replayed"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CashSession"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
        };
    };
    closeCashSession: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Clé d'idempotence. Terminaux : `<device_serial>:<seq>` (seq ≥ 1, au moins 4 chiffres). Autres : UUID.
                 *     Conservée au moins 30 jours (terminaux : pour toujours, c'est la clé du grand livre).
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                /** @description Identifiant de corrélation fourni par le client. */
                "X-Request-Id"?: components["parameters"]["RequestId"];
                /**
                 * @description Langue des messages lisibles (`title`, `detail` des erreurs, libellés). Valeurs `fr` ou `en` ;
                 *     défaut `fr` (en-tête absent ou sans langue prise en charge). Sans effet sur les codes stables.
                 */
                "Accept-Language"?: components["parameters"]["AcceptLanguage"];
            };
            path: {
                cash_session_id: components["parameters"]["CashSessionId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Session fermée. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    "Idempotency-Replayed": components["headers"]["Idempotency-Replayed"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CashSession"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
        };
    };
    createKycVerification: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Clé d'idempotence. Terminaux : `<device_serial>:<seq>` (seq ≥ 1, au moins 4 chiffres). Autres : UUID.
                 *     Conservée au moins 30 jours (terminaux : pour toujours, c'est la clé du grand livre).
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                /** @description Identifiant de corrélation fourni par le client. */
                "X-Request-Id"?: components["parameters"]["RequestId"];
                /**
                 * @description Langue des messages lisibles (`title`, `detail` des erreurs, libellés). Valeurs `fr` ou `en` ;
                 *     défaut `fr` (en-tête absent ou sans langue prise en charge). Sans effet sur les codes stables.
                 */
                "Accept-Language"?: components["parameters"]["AcceptLanguage"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "wallet_id": "a1b2c3d4-e5f6-4789-8abc-def012345678",
                 *       "id_type": "NATIONAL_ID",
                 *       "id_country": "SN",
                 *       "id_last4": "4821",
                 *       "id_expires_on": "2031-05-31"
                 *     }
                 */
                "application/json": components["schemas"]["KycVerificationCreate"];
            };
        };
        responses: {
            /** @description Identification enregistrée. */
            201: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    "Idempotency-Replayed": components["headers"]["Idempotency-Replayed"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["KycVerification"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            422: components["responses"]["Unprocessable"];
        };
    };
    revokeKycVerification: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Clé d'idempotence. Terminaux : `<device_serial>:<seq>` (seq ≥ 1, au moins 4 chiffres). Autres : UUID.
                 *     Conservée au moins 30 jours (terminaux : pour toujours, c'est la clé du grand livre).
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                /** @description Identifiant de corrélation fourni par le client. */
                "X-Request-Id"?: components["parameters"]["RequestId"];
                /**
                 * @description Langue des messages lisibles (`title`, `detail` des erreurs, libellés). Valeurs `fr` ou `en` ;
                 *     défaut `fr` (en-tête absent ou sans langue prise en charge). Sans effet sur les codes stables.
                 */
                "Accept-Language"?: components["parameters"]["AcceptLanguage"];
            };
            path: {
                kyc_verification_id: components["parameters"]["KycVerificationId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "reason": "Pièce présentée signalée comme volée."
                 *     }
                 */
                "application/json": {
                    reason: string;
                };
            };
        };
        responses: {
            202: components["responses"]["ApprovalRequestAccepted"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
        };
    };
    receivePspWebhook: {
        parameters: {
            query?: never;
            header?: {
                /** @description Identifiant de corrélation fourni par le client. */
                "X-Request-Id"?: components["parameters"]["RequestId"];
                /**
                 * @description Langue des messages lisibles (`title`, `detail` des erreurs, libellés). Valeurs `fr` ou `en` ;
                 *     défaut `fr` (en-tête absent ou sans langue prise en charge). Sans effet sur les codes stables.
                 */
                "Accept-Language"?: components["parameters"]["AcceptLanguage"];
            };
            path: {
                provider: "wave" | "orange-money" | "paydunya" | "stripe";
                /** @description Identifiant de la configuration PSP (S26) qui a déclaré cette URL au PSP. */
                psp_config_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "id": "AE_ijzo7oGgrlM6",
                 *       "type": "checkout.session.completed",
                 *       "data": {
                 *         "id": "cos-18qz",
                 *         "client_reference": "0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d",
                 *         "amount": "20000",
                 *         "currency": "XOF",
                 *         "payment_status": "succeeded",
                 *         "transaction_id": "WV-88121",
                 *         "when_completed": "2026-12-01T10:12:00Z"
                 *       }
                 *     }
                 */
                "application/json": components["schemas"]["PspWebhookEvent"];
            };
        };
        responses: {
            /** @description Événement reçu (traité ou doublon). */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "received": true,
                     *       "duplicate": false
                     *     }
                     */
                    "application/json": {
                        received: boolean;
                        duplicate: boolean;
                    };
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            404: components["responses"]["NotFound"];
        };
    };
    getOfflineSnapshot: {
        parameters: {
            query?: {
                /** @description Dernière version appliquée par le terminal (delta demandé). */
                since_version?: number;
            };
            header?: {
                "Accept-Encoding"?: string;
                /** @description Identifiant de corrélation fourni par le client. */
                "X-Request-Id"?: components["parameters"]["RequestId"];
                /**
                 * @description Langue des messages lisibles (`title`, `detail` des erreurs, libellés). Valeurs `fr` ou `en` ;
                 *     défaut `fr` (en-tête absent ou sans langue prise en charge). Sans effet sur les codes stables.
                 */
                "Accept-Language"?: components["parameters"]["AcceptLanguage"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Snapshot. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "header": {
                     *         "format": "CASHLESS-SNAPSHOT/v1",
                     *         "kind": "DELTA",
                     *         "operator_id": "00000000-0000-0000-0000-00000000a002",
                     *         "ledger_id": "2c9a1f0e-3b4d-4e5f-8a7b-6c5d4e3f2a1b",
                     *         "event_id": "7b1e4a52-8f0c-4c1d-9d3e-2a6b0f1c9e11",
                     *         "currency": "XOF",
                     *         "version": 1534,
                     *         "base_version": 1532,
                     *         "generated_at": "2026-12-13T20:59:30Z",
                     *         "valid_until": "2026-12-13T21:14:30Z",
                     *         "entries": 2,
                     *         "removed": 1,
                     *         "content_sha256": "5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8",
                     *         "authority_epoch": 4,
                     *         "key_id": "snap-2026-01"
                     *       },
                     *       "signature": "3q2+7w0AAAABAAAAq3n6k5Yl2m1Zc0vW7x8y9z0a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6",
                     *       "pwd_pack_key": {
                     *         "alg": "ECDH-ES+HKDF-SHA256+A256KW",
                     *         "epk": "BGx1...base64url",
                     *         "wrapped_key": "2b3c...base64url"
                     *       },
                     *       "entries": [
                     *         {
                     *           "token_hash": "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
                     *           "nfc_uid": "04a1b2c3d4e5f6",
                     *           "key_index": 1,
                     *           "originality_sig_sha256": "d4735e3a265e16eee03f59718b9b5d03019c07d8b6c51f90da3a666eec13ab35",
                     *           "status": "ACTIVE",
                     *           "batch_event_id": "7b1e4a52-8f0c-4c1d-9d3e-2a6b0f1c9e11",
                     *           "batch_status": "ACTIVE",
                     *           "wallet_status": "ACTIVE",
                     *           "spendable": 3000,
                     *           "last_counter": 415,
                     *           "pwd_pack_enc": {
                     *             "nonce": "AAECAwQFBgcICQoL",
                     *             "ciphertext": "0Q9f3a",
                     *             "tag": "pQ1u9hV0Wm6o3vXcZ8r1Tg"
                     *           }
                     *         },
                     *         {
                     *           "token_hash": "2c26b46b68ffc68ff99b453c1d30413413422d706483bfa0f98a5e886266e7ae",
                     *           "nfc_uid": "04c1d2e3f4a5b6",
                     *           "key_index": 1,
                     *           "originality_sig_sha256": "4e07408562bedb8b60ce05c1decfe3ad16b72230967de01f640b7e4729b49fce",
                     *           "status": "BLACKLISTED",
                     *           "batch_event_id": "7b1e4a52-8f0c-4c1d-9d3e-2a6b0f1c9e11",
                     *           "batch_status": "ACTIVE",
                     *           "wallet_status": "ACTIVE",
                     *           "spendable": 0,
                     *           "last_counter": 88,
                     *           "pwd_pack_enc": null
                     *         }
                     *       ],
                     *       "removed_token_hashes": [
                     *         "fcde2b2edba56bf408601fb721fe9b5c338d10ee429ea04fae5511b68fbf8fb9"
                     *       ]
                     *     }
                     */
                    "application/json": components["schemas"]["OfflineSnapshot"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            409: components["responses"]["Conflict"];
        };
    };
    ackOfflineSnapshot: {
        parameters: {
            query?: never;
            header?: {
                /** @description Identifiant de corrélation fourni par le client. */
                "X-Request-Id"?: components["parameters"]["RequestId"];
                /**
                 * @description Langue des messages lisibles (`title`, `detail` des erreurs, libellés). Valeurs `fr` ou `en` ;
                 *     défaut `fr` (en-tête absent ou sans langue prise en charge). Sans effet sur les codes stables.
                 */
                "Accept-Language"?: components["parameters"]["AcceptLanguage"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "version": 1534,
                 *       "content_sha256": "5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8"
                 *     }
                 */
                "application/json": {
                    /** Format: int64 */
                    version: number;
                    content_sha256: components["schemas"]["Hex32"];
                };
            };
        };
        responses: {
            /** @description Accusé enregistré. */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            401: components["responses"]["Unauthorized"];
            409: components["responses"]["Conflict"];
        };
    };
    submitOfflineBatch: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Époque d'autorité de débit connue du terminal. DOIT être envoyée sur toute opération de débit.
                 *     Si elle diffère de l'époque courante du serveur qui répond, celui-ci refuse le débit
                 *     (`409 STALE_AUTHORITY_EPOCH` ou `DEBIT_AUTHORITY_EDGE`) et renvoie l'époque courante.
                 */
                "X-Authority-Epoch"?: components["parameters"]["AuthorityEpoch"];
                /**
                 * @description Clé d'idempotence. Terminaux : `<device_serial>:<seq>` (seq ≥ 1, au moins 4 chiffres). Autres : UUID.
                 *     Conservée au moins 30 jours (terminaux : pour toujours, c'est la clé du grand livre).
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                /** @description Identifiant de corrélation fourni par le client. */
                "X-Request-Id"?: components["parameters"]["RequestId"];
                /**
                 * @description Langue des messages lisibles (`title`, `detail` des erreurs, libellés). Valeurs `fr` ou `en` ;
                 *     défaut `fr` (en-tête absent ou sans langue prise en charge). Sans effet sur les codes stables.
                 */
                "Accept-Language"?: components["parameters"]["AcceptLanguage"];
                /** @description Numéro de série du terminal ; DOIT être égal à `header.device_serial` et au sujet du jeton. */
                "X-Device-Serial": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "header": {
                 *         "batch_id": "5d6e7f80-91a2-4b3c-8d4e-5f6a7b8c9d0e",
                 *         "device_serial": "TPE-FOOD-02",
                 *         "ledger_id": "2c9a1f0e-3b4d-4e5f-8a7b-6c5d4e3f2a1b",
                 *         "authority_epoch": 4,
                 *         "seq_from": 86,
                 *         "seq_to": 88,
                 *         "count": 3,
                 *         "created_at": "2026-12-13T21:41:05Z",
                 *         "device_time_at_send": "2026-12-13T21:41:05Z",
                 *         "prev_chain_hash": "1b4f0e9851971998e732078544c96b36c3d01cedf7caa332359d6f1d83567014",
                 *         "last_chain_hash": "60303ae22b998861bce3b28f33eec1be758a213c86c93c076dbe9f558c11c752"
                 *       },
                 *       "operations": [
                 *         {
                 *           "seq": 86,
                 *           "type": "VOID",
                 *           "occurred_at": "2026-12-13T21:20:11Z",
                 *           "void_reason": "ABORTED_BY_OPERATOR",
                 *           "chain_hash": "fd61a03af4f77d870fc21e05e7e80678095c92d808cfb3b5c279ee04c74aca13"
                 *         },
                 *         {
                 *           "seq": 87,
                 *           "type": "PURCHASE",
                 *           "occurred_at": "2026-12-13T21:30:00Z",
                 *           "amount": 9000,
                 *           "currency": "XOF",
                 *           "snapshot_version": 1532,
                 *           "config_id": 48213,
                 *           "online_status": "NOT_ATTEMPTED",
                 *           "tap": {
                 *             "nfc_uid": "04b1c2d3e4f5a6",
                 *             "token_hash": "2c26b46b68ffc68ff99b453c1d30413413422d706483bfa0f98a5e886266e7ae",
                 *             "counter": 77,
                 *             "key_index": 1,
                 *             "pack_verified": true,
                 *             "originality_signature": "9b2e4c6a8d0f1e3c5a7b9d1f3e5c7a9b1d3f5e7c9a1b3d5f7e9c1a3b5d7f9e1c",
                 *             "occurred_at": "2026-12-13T21:29:58Z"
                 *           },
                 *           "local_available_before": 9000,
                 *           "lines": [
                 *             {
                 *               "product_id": "9d1b7a4c-2e3f-4a5b-8c6d-7e8f9a0b1c2d",
                 *               "quantity": 3,
                 *               "unit_price": 3000
                 *             }
                 *           ],
                 *           "clock": {
                 *             "monotonic_ms": 81234567,
                 *             "offset_ms": -850
                 *           },
                 *           "chain_hash": "8a7b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b"
                 *         },
                 *         {
                 *           "seq": 88,
                 *           "type": "REVERSAL",
                 *           "occurred_at": "2026-12-13T21:31:10Z",
                 *           "snapshot_version": 1532,
                 *           "config_id": 48213,
                 *           "online_status": "NOT_ATTEMPTED",
                 *           "reverses_seq": 85,
                 *           "reason": "INPUT_ERROR",
                 *           "chain_hash": "60303ae22b998861bce3b28f33eec1be758a213c86c93c076dbe9f558c11c752"
                 *         }
                 *       ],
                 *       "signature": "MEUCIQCq2...base64"
                 *     }
                 */
                "application/json": components["schemas"]["OfflineBatch"];
            };
        };
        responses: {
            /** @description Lot traité ; résultat par opération. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    "Idempotency-Replayed": components["headers"]["Idempotency-Replayed"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "batch_id": "5d6e7f80-91a2-4b3c-8d4e-5f6a7b8c9d0e",
                     *       "processed_at": "2026-12-13T21:41:06Z",
                     *       "results": [
                     *         {
                     *           "seq": 86,
                     *           "idempotency_key": "TPE-FOOD-02:0086",
                     *           "status": "ACCEPTED",
                     *           "transaction_id": null,
                     *           "effect": "NONE"
                     *         },
                     *         {
                     *           "seq": 87,
                     *           "idempotency_key": "TPE-FOOD-02:0087",
                     *           "status": "ACCEPTED_WITH_SHORTFALL",
                     *           "transaction_id": "0b1c2d3e-4f5a-4b6c-9d7e-8f9a0b1c2d3e",
                     *           "effect": "LEDGER_WRITTEN",
                     *           "charged_to_wallet": 6000,
                     *           "shortfall_amount": 3000,
                     *           "shortfall_reason": "INSUFFICIENT_FUNDS",
                     *           "anomaly_id": "e1f2a3b4-c5d6-4e7f-8a9b-0c1d2e3f4a5b",
                     *           "tap_result": "OK"
                     *         },
                     *         {
                     *           "seq": 88,
                     *           "idempotency_key": "TPE-FOOD-02:0088",
                     *           "status": "REJECTED",
                     *           "effect": "NONE",
                     *           "reject_reason": "REVERSAL_TARGET_NOT_FOUND",
                     *           "retryable": false,
                     *           "detail": "La séquence 85 n'est pas une vente de ce terminal."
                     *         }
                     *       ],
                     *       "contiguous_acked_seq": 88,
                     *       "missing_seqs": [],
                     *       "next_snapshot_version": 1536,
                     *       "server_time": "2026-12-13T21:41:06Z"
                     *     }
                     */
                    "application/json": components["schemas"]["OfflineBatchResult"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            409: components["responses"]["Conflict"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["Unprocessable"];
        };
    };
    getOfflineBatchResult: {
        parameters: {
            query?: never;
            header?: {
                /** @description Identifiant de corrélation fourni par le client. */
                "X-Request-Id"?: components["parameters"]["RequestId"];
                /**
                 * @description Langue des messages lisibles (`title`, `detail` des erreurs, libellés). Valeurs `fr` ou `en` ;
                 *     défaut `fr` (en-tête absent ou sans langue prise en charge). Sans effet sur les codes stables.
                 */
                "Accept-Language"?: components["parameters"]["AcceptLanguage"];
            };
            path: {
                batch_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Résultat mémorisé. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OfflineBatchResult"];
                };
            };
            /** @description Lot encore en cours de traitement ; réessayer après `Retry-After`. */
            202: {
                headers: {
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content?: never;
            };
            401: components["responses"]["Unauthorized"];
            404: components["responses"]["NotFound"];
        };
    };
    createPaymentIntent: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Clé d'idempotence. Terminaux : `<device_serial>:<seq>` (seq ≥ 1, au moins 4 chiffres). Autres : UUID.
                 *     Conservée au moins 30 jours (terminaux : pour toujours, c'est la clé du grand livre).
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                /** @description Identifiant de corrélation fourni par le client. */
                "X-Request-Id"?: components["parameters"]["RequestId"];
                /**
                 * @description Langue des messages lisibles (`title`, `detail` des erreurs, libellés). Valeurs `fr` ou `en` ;
                 *     défaut `fr` (en-tête absent ou sans langue prise en charge). Sans effet sur les codes stables.
                 */
                "Accept-Language"?: components["parameters"]["AcceptLanguage"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "amount": 7500,
                 *       "currency": "XOF",
                 *       "pos_id": "0c6f0d7e-11aa-4b8b-9c3e-5d2f1a7b8c90",
                 *       "device_id": "3f7d2c10-6a55-4b6e-9d0e-1c2b3a4d5e6f",
                 *       "capture_method": "AUTOMATIC",
                 *       "external_reference": "POSX-TCK-000981",
                 *       "expires_in_seconds": 300,
                 *       "metadata": {
                 *         "table": "12"
                 *       }
                 *     }
                 */
                "application/json": components["schemas"]["PaymentIntentCreate"];
            };
        };
        responses: {
            /** @description Intention créée. */
            201: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    "Idempotency-Replayed": components["headers"]["Idempotency-Replayed"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "payment_intent_id": "pi_7Hq2xN4mR8",
                     *       "status": "REQUIRES_PAYMENT",
                     *       "amount": 7500,
                     *       "amount_capturable": 0,
                     *       "amount_captured": 0,
                     *       "currency": "XOF",
                     *       "capture_method": "AUTOMATIC",
                     *       "pos_id": "0c6f0d7e-11aa-4b8b-9c3e-5d2f1a7b8c90",
                     *       "device_id": "3f7d2c10-6a55-4b6e-9d0e-1c2b3a4d5e6f",
                     *       "external_reference": "POSX-TCK-000981",
                     *       "qr_payload": "https://pay.cashless.test/pi/pi_7Hq2xN4mR8#t=Q2YH7KJ4MZ",
                     *       "transaction_id": null,
                     *       "created_at": "2026-12-12T20:00:00Z",
                     *       "expires_at": "2026-12-12T20:05:00Z",
                     *       "metadata": {
                     *         "table": "12"
                     *       }
                     *     }
                     */
                    "application/json": components["schemas"]["PaymentIntent"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            422: components["responses"]["Unprocessable"];
        };
    };
    getPaymentIntent: {
        parameters: {
            query?: never;
            header?: {
                /** @description Identifiant de corrélation fourni par le client. */
                "X-Request-Id"?: components["parameters"]["RequestId"];
                /**
                 * @description Langue des messages lisibles (`title`, `detail` des erreurs, libellés). Valeurs `fr` ou `en` ;
                 *     défaut `fr` (en-tête absent ou sans langue prise en charge). Sans effet sur les codes stables.
                 */
                "Accept-Language"?: components["parameters"]["AcceptLanguage"];
            };
            path: {
                payment_intent_id: components["parameters"]["PaymentIntentId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Intention. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PaymentIntent"];
                };
            };
            401: components["responses"]["Unauthorized"];
            404: components["responses"]["NotFound"];
        };
    };
    capturePaymentIntent: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Clé d'idempotence. Terminaux : `<device_serial>:<seq>` (seq ≥ 1, au moins 4 chiffres). Autres : UUID.
                 *     Conservée au moins 30 jours (terminaux : pour toujours, c'est la clé du grand livre).
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                /** @description Identifiant de corrélation fourni par le client. */
                "X-Request-Id"?: components["parameters"]["RequestId"];
                /**
                 * @description Langue des messages lisibles (`title`, `detail` des erreurs, libellés). Valeurs `fr` ou `en` ;
                 *     défaut `fr` (en-tête absent ou sans langue prise en charge). Sans effet sur les codes stables.
                 */
                "Accept-Language"?: components["parameters"]["AcceptLanguage"];
            };
            path: {
                payment_intent_id: components["parameters"]["PaymentIntentId"];
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                /**
                 * @example {
                 *       "amount_to_capture": 7000
                 *     }
                 */
                "application/json": {
                    amount_to_capture?: components["schemas"]["Amount"];
                };
            };
        };
        responses: {
            /** @description Intention capturée. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    "Idempotency-Replayed": components["headers"]["Idempotency-Replayed"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PaymentIntent"];
                };
            };
            401: components["responses"]["Unauthorized"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
        };
    };
    cancelPaymentIntent: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Clé d'idempotence. Terminaux : `<device_serial>:<seq>` (seq ≥ 1, au moins 4 chiffres). Autres : UUID.
                 *     Conservée au moins 30 jours (terminaux : pour toujours, c'est la clé du grand livre).
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                /** @description Identifiant de corrélation fourni par le client. */
                "X-Request-Id"?: components["parameters"]["RequestId"];
                /**
                 * @description Langue des messages lisibles (`title`, `detail` des erreurs, libellés). Valeurs `fr` ou `en` ;
                 *     défaut `fr` (en-tête absent ou sans langue prise en charge). Sans effet sur les codes stables.
                 */
                "Accept-Language"?: components["parameters"]["AcceptLanguage"];
            };
            path: {
                payment_intent_id: components["parameters"]["PaymentIntentId"];
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                /**
                 * @example {
                 *       "reason": "ABANDONED"
                 *     }
                 */
                "application/json": {
                    /** @enum {string} */
                    reason?: "REQUESTED_BY_CUSTOMER" | "DUPLICATE" | "ABANDONED" | "INPUT_ERROR";
                };
            };
        };
        responses: {
            /** @description Intention annulée. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    "Idempotency-Replayed": components["headers"]["Idempotency-Replayed"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PaymentIntent"];
                };
            };
            401: components["responses"]["Unauthorized"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
        };
    };
    listDevicePaymentIntents: {
        parameters: {
            query?: {
                wait?: number;
            };
            header?: {
                /** @description Identifiant de corrélation fourni par le client. */
                "X-Request-Id"?: components["parameters"]["RequestId"];
                /**
                 * @description Langue des messages lisibles (`title`, `detail` des erreurs, libellés). Valeurs `fr` ou `en` ;
                 *     défaut `fr` (en-tête absent ou sans langue prise en charge). Sans effet sur les codes stables.
                 */
                "Accept-Language"?: components["parameters"]["AcceptLanguage"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Intentions en attente (liste éventuellement vide). */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["PaymentIntent"][];
                    };
                };
            };
            401: components["responses"]["Unauthorized"];
        };
    };
    listWebhookEndpoints: {
        parameters: {
            query?: {
                /** @description Curseur opaque renvoyé par la page précédente (`next_cursor`). */
                cursor?: components["parameters"]["Cursor"];
                limit?: components["parameters"]["Limit"];
            };
            header?: {
                /** @description Identifiant de corrélation fourni par le client. */
                "X-Request-Id"?: components["parameters"]["RequestId"];
                /**
                 * @description Langue des messages lisibles (`title`, `detail` des erreurs, libellés). Valeurs `fr` ou `en` ;
                 *     défaut `fr` (en-tête absent ou sans langue prise en charge). Sans effet sur les codes stables.
                 */
                "Accept-Language"?: components["parameters"]["AcceptLanguage"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Abonnements. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PageMeta"] & {
                        data: components["schemas"]["WebhookEndpoint"][];
                    };
                };
            };
            401: components["responses"]["Unauthorized"];
        };
    };
    createWebhookEndpoint: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Clé d'idempotence. Terminaux : `<device_serial>:<seq>` (seq ≥ 1, au moins 4 chiffres). Autres : UUID.
                 *     Conservée au moins 30 jours (terminaux : pour toujours, c'est la clé du grand livre).
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                /** @description Identifiant de corrélation fourni par le client. */
                "X-Request-Id"?: components["parameters"]["RequestId"];
                /**
                 * @description Langue des messages lisibles (`title`, `detail` des erreurs, libellés). Valeurs `fr` ou `en` ;
                 *     défaut `fr` (en-tête absent ou sans langue prise en charge). Sans effet sur les codes stables.
                 */
                "Accept-Language"?: components["parameters"]["AcceptLanguage"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "url": "https://posx.test/hooks/cashless",
                 *       "events": [
                 *         "payment_intent.succeeded",
                 *         "payment_intent.cancelled"
                 *       ]
                 *     }
                 */
                "application/json": {
                    /** Format: uri */
                    url: string;
                    events: components["schemas"]["OutboundEventType"][];
                };
            };
        };
        responses: {
            /** @description Abonnement créé. */
            201: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "webhook_endpoint_id": "we_5Tg8",
                     *       "url": "https://posx.test/hooks/cashless",
                     *       "events": [
                     *         "payment_intent.succeeded",
                     *         "payment_intent.cancelled"
                     *       ],
                     *       "secret": "whsec_3kP0...",
                     *       "created_at": "2026-12-01T09:00:00Z"
                     *     }
                     */
                    "application/json": components["schemas"]["WebhookEndpoint"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
        };
    };
    deleteWebhookEndpoint: {
        parameters: {
            query?: never;
            header?: {
                /** @description Identifiant de corrélation fourni par le client. */
                "X-Request-Id"?: components["parameters"]["RequestId"];
                /**
                 * @description Langue des messages lisibles (`title`, `detail` des erreurs, libellés). Valeurs `fr` ou `en` ;
                 *     défaut `fr` (en-tête absent ou sans langue prise en charge). Sans effet sur les codes stables.
                 */
                "Accept-Language"?: components["parameters"]["AcceptLanguage"];
            };
            path: {
                webhook_endpoint_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Supprimé. */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            401: components["responses"]["Unauthorized"];
            404: components["responses"]["NotFound"];
        };
    };
    createPaymentRequest: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Clé d'idempotence. Terminaux : `<device_serial>:<seq>` (seq ≥ 1, au moins 4 chiffres). Autres : UUID.
                 *     Conservée au moins 30 jours (terminaux : pour toujours, c'est la clé du grand livre).
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                /** @description Identifiant de corrélation fourni par le client. */
                "X-Request-Id"?: components["parameters"]["RequestId"];
                /**
                 * @description Langue des messages lisibles (`title`, `detail` des erreurs, libellés). Valeurs `fr` ou `en` ;
                 *     défaut `fr` (en-tête absent ou sans langue prise en charge). Sans effet sur les codes stables.
                 */
                "Accept-Language"?: components["parameters"]["AcceptLanguage"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "amount": 4000,
                 *       "currency": "XOF",
                 *       "ttl_seconds": 60
                 *     }
                 */
                "application/json": {
                    amount: components["schemas"]["Amount"];
                    currency: components["schemas"]["Currency"];
                    /** @default 60 */
                    ttl_seconds?: number;
                    lines?: components["schemas"]["SaleLine"][];
                };
            };
        };
        responses: {
            /** @description Demande créée. */
            201: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    "Idempotency-Replayed": components["headers"]["Idempotency-Replayed"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "payment_request_id": "6a7b8c9d-0e1f-4a2b-8c3d-4e5f6a7b8c9d",
                     *       "direction": "MERCHANT_QR",
                     *       "status": "PENDING",
                     *       "amount": 4000,
                     *       "currency": "XOF",
                     *       "merchant_name": "Bar de l'organisateur",
                     *       "qr_payload": "https://pay.cashless.test/r/6a7b8c9d-0e1f-4a2b-8c3d-4e5f6a7b8c9d#t=H4K9M2QX7TPB3NZ8",
                     *       "expires_at": "2026-12-11T20:06:00Z",
                     *       "transaction_id": null
                     *     }
                     */
                    "application/json": components["schemas"]["PaymentRequestObject"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            409: components["responses"]["Conflict"];
        };
    };
    getPaymentRequest: {
        parameters: {
            query?: {
                wait?: number;
            };
            header?: {
                /** @description Identifiant de corrélation fourni par le client. */
                "X-Request-Id"?: components["parameters"]["RequestId"];
                /**
                 * @description Langue des messages lisibles (`title`, `detail` des erreurs, libellés). Valeurs `fr` ou `en` ;
                 *     défaut `fr` (en-tête absent ou sans langue prise en charge). Sans effet sur les codes stables.
                 */
                "Accept-Language"?: components["parameters"]["AcceptLanguage"];
            };
            path: {
                payment_request_id: components["parameters"]["PaymentRequestId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Demande. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "payment_request_id": "6a7b8c9d-0e1f-4a2b-8c3d-4e5f6a7b8c9d",
                     *       "direction": "MERCHANT_QR",
                     *       "status": "CONFIRMED",
                     *       "amount": 4000,
                     *       "currency": "XOF",
                     *       "merchant_name": "Bar de l'organisateur",
                     *       "qr_payload": null,
                     *       "expires_at": "2026-12-11T20:06:00Z",
                     *       "transaction_id": "7b8c9d0e-1f2a-4b3c-9d4e-5f6a7b8c9d0e"
                     *     }
                     */
                    "application/json": components["schemas"]["PaymentRequestObject"];
                };
            };
            401: components["responses"]["Unauthorized"];
            404: components["responses"]["NotFound"];
        };
    };
    payPaymentRequest: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Clé d'idempotence. Terminaux : `<device_serial>:<seq>` (seq ≥ 1, au moins 4 chiffres). Autres : UUID.
                 *     Conservée au moins 30 jours (terminaux : pour toujours, c'est la clé du grand livre).
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                /** @description Identifiant de corrélation fourni par le client. */
                "X-Request-Id"?: components["parameters"]["RequestId"];
                /**
                 * @description Langue des messages lisibles (`title`, `detail` des erreurs, libellés). Valeurs `fr` ou `en` ;
                 *     défaut `fr` (en-tête absent ou sans langue prise en charge). Sans effet sur les codes stables.
                 */
                "Accept-Language"?: components["parameters"]["AcceptLanguage"];
            };
            path: {
                payment_request_id: components["parameters"]["PaymentRequestId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "token": "H4K9M2QX7TPB3NZ8",
                 *       "wallet_id": "a1b2c3d4-e5f6-4789-8abc-def012345678"
                 *     }
                 */
                "application/json": {
                    token: string;
                    /** Format: uuid */
                    wallet_id: string;
                };
            };
        };
        responses: {
            /** @description Paiement effectué. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    "Idempotency-Replayed": components["headers"]["Idempotency-Replayed"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PaymentResult"];
                };
            };
            401: components["responses"]["Unauthorized"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
        };
    };
    cancelPaymentRequest: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Clé d'idempotence. Terminaux : `<device_serial>:<seq>` (seq ≥ 1, au moins 4 chiffres). Autres : UUID.
                 *     Conservée au moins 30 jours (terminaux : pour toujours, c'est la clé du grand livre).
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                /** @description Identifiant de corrélation fourni par le client. */
                "X-Request-Id"?: components["parameters"]["RequestId"];
                /**
                 * @description Langue des messages lisibles (`title`, `detail` des erreurs, libellés). Valeurs `fr` ou `en` ;
                 *     défaut `fr` (en-tête absent ou sans langue prise en charge). Sans effet sur les codes stables.
                 */
                "Accept-Language"?: components["parameters"]["AcceptLanguage"];
            };
            path: {
                payment_request_id: components["parameters"]["PaymentRequestId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Demande annulée. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    "Idempotency-Replayed": components["headers"]["Idempotency-Replayed"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PaymentRequestObject"];
                };
            };
            401: components["responses"]["Unauthorized"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
        };
    };
    requestCustomerOtp: {
        parameters: {
            query?: never;
            header?: {
                /** @description Identifiant de corrélation fourni par le client. */
                "X-Request-Id"?: components["parameters"]["RequestId"];
                /**
                 * @description Langue des messages lisibles (`title`, `detail` des erreurs, libellés). Valeurs `fr` ou `en` ;
                 *     défaut `fr` (en-tête absent ou sans langue prise en charge). Sans effet sur les codes stables.
                 */
                "Accept-Language"?: components["parameters"]["AcceptLanguage"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "phone": "+221770000001",
                 *       "operator_code": "presta-sn",
                 *       "channel": "SMS"
                 *     }
                 */
                "application/json": {
                    phone: string;
                    /** @description Code public du prestataire (l'app est multi-prestataires ; fixe le tenant). */
                    operator_code: string;
                    /**
                     * @description ADR-66. `AUTO` (défaut) : WhatsApp d'abord ; si la livraison WhatsApp n'est pas confirmée dans
                     *     `otp_whatsapp_timeout_seconds` (défaut 10 s) ou si le numéro n'a pas WhatsApp, le même code part par
                     *     SMS (fournisseur principal, puis fournisseur de repli si la livraison n'est pas confirmée dans
                     *     `otp_sms_failover_seconds`, défaut 20 s). `SMS` : SMS directement (bouton « Recevoir par SMS »
                     *     de l'app, toujours proposé). `WHATSAPP` : WhatsApp seulement. Un seul code valide par défi,
                     *     quel que soit le nombre de canaux utilisés.
                     * @default AUTO
                     * @enum {string}
                     */
                    channel?: "AUTO" | "SMS" | "WHATSAPP";
                };
            };
        };
        responses: {
            /** @description Code envoyé (réponse identique que le numéro soit connu ou non). */
            202: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "otp_request_id": "otp_4mZ7",
                     *       "expires_in": 300
                     *     }
                     */
                    "application/json": {
                        otp_request_id: string;
                        expires_in: number;
                    };
                };
            };
            400: components["responses"]["BadRequest"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    exchangeCustomerOtp: {
        parameters: {
            query?: never;
            header?: {
                /** @description Identifiant de corrélation fourni par le client. */
                "X-Request-Id"?: components["parameters"]["RequestId"];
                /**
                 * @description Langue des messages lisibles (`title`, `detail` des erreurs, libellés). Valeurs `fr` ou `en` ;
                 *     défaut `fr` (en-tête absent ou sans langue prise en charge). Sans effet sur les codes stables.
                 */
                "Accept-Language"?: components["parameters"]["AcceptLanguage"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "otp_request_id": "otp_4mZ7",
                 *       "code": "482913"
                 *     }
                 */
                "application/json": {
                    otp_request_id: string;
                    code: string;
                };
            };
        };
        responses: {
            /** @description Jetons. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "access_token": "eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiJjdXN0In0.sig",
                     *       "token_type": "Bearer",
                     *       "expires_in": 900,
                     *       "refresh_token": "crt_Lk29dmQ0"
                     *     }
                     */
                    "application/json": components["schemas"]["TokenResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            422: components["responses"]["Unprocessable"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    refreshCustomerToken: {
        parameters: {
            query?: never;
            header?: {
                /** @description Identifiant de corrélation fourni par le client. */
                "X-Request-Id"?: components["parameters"]["RequestId"];
                /**
                 * @description Langue des messages lisibles (`title`, `detail` des erreurs, libellés). Valeurs `fr` ou `en` ;
                 *     défaut `fr` (en-tête absent ou sans langue prise en charge). Sans effet sur les codes stables.
                 */
                "Accept-Language"?: components["parameters"]["AcceptLanguage"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "refresh_token": "crt_Lk29dmQ0"
                 *     }
                 */
                "application/json": {
                    refresh_token: string;
                };
            };
        };
        responses: {
            /** @description Jetons. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TokenResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
        };
    };
    getMe: {
        parameters: {
            query?: never;
            header?: {
                /** @description Identifiant de corrélation fourni par le client. */
                "X-Request-Id"?: components["parameters"]["RequestId"];
                /**
                 * @description Langue des messages lisibles (`title`, `detail` des erreurs, libellés). Valeurs `fr` ou `en` ;
                 *     défaut `fr` (en-tête absent ou sans langue prise en charge). Sans effet sur les codes stables.
                 */
                "Accept-Language"?: components["parameters"]["AcceptLanguage"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Profil. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "customer_id": "c0ffee00-1234-4abc-8def-0123456789ab",
                     *       "phone": "+221770000001",
                     *       "display_name": "Awa",
                     *       "kyc_level": "NONE"
                     *     }
                     */
                    "application/json": components["schemas"]["CustomerProfile"];
                };
            };
            401: components["responses"]["Unauthorized"];
        };
    };
    listMyWallets: {
        parameters: {
            query?: never;
            header?: {
                /** @description Identifiant de corrélation fourni par le client. */
                "X-Request-Id"?: components["parameters"]["RequestId"];
                /**
                 * @description Langue des messages lisibles (`title`, `detail` des erreurs, libellés). Valeurs `fr` ou `en` ;
                 *     défaut `fr` (en-tête absent ou sans langue prise en charge). Sans effet sur les codes stables.
                 */
                "Accept-Language"?: components["parameters"]["AcceptLanguage"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Portefeuilles. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "data": [
                     *         {
                     *           "wallet_id": "a1b2c3d4-e5f6-4789-8abc-def012345678",
                     *           "status": "ACTIVE",
                     *           "kyc_level": "NONE",
                     *           "currency": "XOF",
                     *           "event": {
                     *             "event_id": "7b1e4a52-8f0c-4c1d-9d3e-2a6b0f1c9e11",
                     *             "name": "Festival Sons 2026",
                     *             "status": "LIVE"
                     *           },
                     *           "balance": {
                     *             "spendable": 9000,
                     *             "paid": 9000,
                     *             "promo": 0
                     *           },
                     *           "balance_as_of": "2026-12-11T20:05:01Z",
                     *           "pending_offline_notice": true,
                     *           "media": [
                     *             {
                     *               "media_id": "1d2e3f40-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
                     *               "status": "ACTIVE",
                     *               "deposit_status": "NONE"
                     *             }
                     *           ],
                     *           "refund": {
                     *             "eligible": false,
                     *             "deadline": "2027-02-14T23:59:59Z",
                     *             "fee": 500
                     *           }
                     *         }
                     *       ]
                     *     }
                     */
                    "application/json": {
                        data: components["schemas"]["Wallet"][];
                    };
                };
            };
            401: components["responses"]["Unauthorized"];
        };
    };
    listMyWalletTransactions: {
        parameters: {
            query?: {
                /** @description Curseur opaque renvoyé par la page précédente (`next_cursor`). */
                cursor?: components["parameters"]["Cursor"];
                limit?: components["parameters"]["Limit"];
            };
            header?: {
                /** @description Identifiant de corrélation fourni par le client. */
                "X-Request-Id"?: components["parameters"]["RequestId"];
                /**
                 * @description Langue des messages lisibles (`title`, `detail` des erreurs, libellés). Valeurs `fr` ou `en` ;
                 *     défaut `fr` (en-tête absent ou sans langue prise en charge). Sans effet sur les codes stables.
                 */
                "Accept-Language"?: components["parameters"]["AcceptLanguage"];
            };
            path: {
                wallet_id: components["parameters"]["WalletId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Page d'historique. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "data": [
                     *         {
                     *           "transaction_id": "3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f",
                     *           "type": "PURCHASE",
                     *           "source": "ONLINE",
                     *           "occurred_at": "2026-12-11T19:10:00Z",
                     *           "amount": -6000,
                     *           "currency": "XOF",
                     *           "label": "Food truck",
                     *           "reverses_id": null,
                     *           "reversed_by_id": null
                     *         },
                     *         {
                     *           "transaction_id": "1f2a3b4c-5d6e-4f7a-8b9c-0d1e2f3a4b5c",
                     *           "type": "TOPUP",
                     *           "source": "PSP_WEBHOOK",
                     *           "occurred_at": "2026-12-01T10:12:00Z",
                     *           "amount": 20000,
                     *           "currency": "XOF",
                     *           "label": "Recharge Wave",
                     *           "reverses_id": null,
                     *           "reversed_by_id": null
                     *         }
                     *       ],
                     *       "next_cursor": "eyJvIjoiMjAyNi0xMi0wMVQxMDoxMjowMFoiLCJpIjoiMWYyYSJ9",
                     *       "has_more": true
                     *     }
                     */
                    "application/json": components["schemas"]["PageMeta"] & {
                        data: components["schemas"]["WalletMovement"][];
                    };
                };
            };
            401: components["responses"]["Unauthorized"];
            404: components["responses"]["NotFound"];
        };
    };
    lookupBalanceByClaimCode: {
        parameters: {
            query?: never;
            header?: {
                /** @description Identifiant de corrélation fourni par le client. */
                "X-Request-Id"?: components["parameters"]["RequestId"];
                /**
                 * @description Langue des messages lisibles (`title`, `detail` des erreurs, libellés). Valeurs `fr` ou `en` ;
                 *     défaut `fr` (en-tête absent ou sans langue prise en charge). Sans effet sur les codes stables.
                 */
                "Accept-Language"?: components["parameters"]["AcceptLanguage"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "claim_code": "K7QM-4XH9RT"
                 *     }
                 */
                "application/json": {
                    claim_code: string;
                };
            };
        };
        responses: {
            /** @description Solde et derniers mouvements. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        currency: string;
                        balance: components["schemas"]["Balance"];
                        media_status?: components["schemas"]["MediaStatus"];
                        recent: components["schemas"]["WalletMovement"][];
                    };
                };
            };
            400: components["responses"]["BadRequest"];
            404: components["responses"]["NotFound"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    listMyMedia: {
        parameters: {
            query?: never;
            header?: {
                /** @description Identifiant de corrélation fourni par le client. */
                "X-Request-Id"?: components["parameters"]["RequestId"];
                /**
                 * @description Langue des messages lisibles (`title`, `detail` des erreurs, libellés). Valeurs `fr` ou `en` ;
                 *     défaut `fr` (en-tête absent ou sans langue prise en charge). Sans effet sur les codes stables.
                 */
                "Accept-Language"?: components["parameters"]["AcceptLanguage"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Bracelets. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["CustomerMedia"][];
                    };
                };
            };
            401: components["responses"]["Unauthorized"];
        };
    };
    claimMedia: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Clé d'idempotence. Terminaux : `<device_serial>:<seq>` (seq ≥ 1, au moins 4 chiffres). Autres : UUID.
                 *     Conservée au moins 30 jours (terminaux : pour toujours, c'est la clé du grand livre).
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                /** @description Identifiant de corrélation fourni par le client. */
                "X-Request-Id"?: components["parameters"]["RequestId"];
                /**
                 * @description Langue des messages lisibles (`title`, `detail` des erreurs, libellés). Valeurs `fr` ou `en` ;
                 *     défaut `fr` (en-tête absent ou sans langue prise en charge). Sans effet sur les codes stables.
                 */
                "Accept-Language"?: components["parameters"]["AcceptLanguage"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "claim_code": "K7QM-4XH9RT"
                 *     }
                 */
                "application/json": components["schemas"]["MediaClaimRequest"];
            };
        };
        responses: {
            /** @description Bracelet rattaché. */
            201: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    "Idempotency-Replayed": components["headers"]["Idempotency-Replayed"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "media_id": "1d2e3f40-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
                     *       "printed_number": "FS26-004812",
                     *       "status": "ACTIVE",
                     *       "deposit_status": "NONE",
                     *       "wallet_id": "a1b2c3d4-e5f6-4789-8abc-def012345678"
                     *     }
                     */
                    "application/json": components["schemas"]["CustomerMedia"];
                };
            };
            /** @description Bracelet déjà approvisionné — rattachement en attente de confirmation au guichet (ADR-57). */
            202: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "claim_id": "6f1e2d3c-4b5a-4968-8776-655443322110",
                     *       "status": "PENDING_DESK_CONFIRMATION",
                     *       "confirmation_code": "482915",
                     *       "expires_at": "2026-12-12T18:40:00Z"
                     *     }
                     */
                    "application/json": components["schemas"]["MediaClaimPending"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    confirmMediaClaim: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Clé d'idempotence. Terminaux : `<device_serial>:<seq>` (seq ≥ 1, au moins 4 chiffres). Autres : UUID.
                 *     Conservée au moins 30 jours (terminaux : pour toujours, c'est la clé du grand livre).
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                /** @description Identifiant de corrélation fourni par le client. */
                "X-Request-Id"?: components["parameters"]["RequestId"];
                /**
                 * @description Langue des messages lisibles (`title`, `detail` des erreurs, libellés). Valeurs `fr` ou `en` ;
                 *     défaut `fr` (en-tête absent ou sans langue prise en charge). Sans effet sur les codes stables.
                 */
                "Accept-Language"?: components["parameters"]["AcceptLanguage"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "tap_id": 918455,
                 *       "claim_code": "K7QM-4XH9RT",
                 *       "confirmation_code": "482915"
                 *     }
                 */
                "application/json": {
                    /**
                     * Format: int64
                     * @description Lecture du bracelet par le terminal du guichet (`POST /taps`).
                     */
                    tap_id: number;
                    /** @description Code imprimé sur le bracelet ; tirets, espaces et casse ignorés. */
                    claim_code: string;
                    confirmation_code: string;
                };
            };
        };
        responses: {
            /** @description Rattachement confirmé. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    "Idempotency-Replayed": components["headers"]["Idempotency-Replayed"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CustomerMedia"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
        };
    };
    reportMyMediaLost: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Clé d'idempotence. Terminaux : `<device_serial>:<seq>` (seq ≥ 1, au moins 4 chiffres). Autres : UUID.
                 *     Conservée au moins 30 jours (terminaux : pour toujours, c'est la clé du grand livre).
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                /** @description Identifiant de corrélation fourni par le client. */
                "X-Request-Id"?: components["parameters"]["RequestId"];
                /**
                 * @description Langue des messages lisibles (`title`, `detail` des erreurs, libellés). Valeurs `fr` ou `en` ;
                 *     défaut `fr` (en-tête absent ou sans langue prise en charge). Sans effet sur les codes stables.
                 */
                "Accept-Language"?: components["parameters"]["AcceptLanguage"];
            };
            path: {
                media_id: components["parameters"]["MediaId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Bracelet suspendu. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    "Idempotency-Replayed": components["headers"]["Idempotency-Replayed"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CustomerMedia"];
                };
            };
            401: components["responses"]["Unauthorized"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
        };
    };
    createCustomerQrToken: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Clé d'idempotence. Terminaux : `<device_serial>:<seq>` (seq ≥ 1, au moins 4 chiffres). Autres : UUID.
                 *     Conservée au moins 30 jours (terminaux : pour toujours, c'est la clé du grand livre).
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                /** @description Identifiant de corrélation fourni par le client. */
                "X-Request-Id"?: components["parameters"]["RequestId"];
                /**
                 * @description Langue des messages lisibles (`title`, `detail` des erreurs, libellés). Valeurs `fr` ou `en` ;
                 *     défaut `fr` (en-tête absent ou sans langue prise en charge). Sans effet sur les codes stables.
                 */
                "Accept-Language"?: components["parameters"]["AcceptLanguage"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "wallet_id": "a1b2c3d4-e5f6-4789-8abc-def012345678"
                 *     }
                 */
                "application/json": {
                    /** Format: uuid */
                    wallet_id: string;
                };
            };
        };
        responses: {
            /** @description Jeton créé. */
            201: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "payment_request_id": "8c9d0e1f-2a3b-4c4d-8e5f-6a7b8c9d0e1f",
                     *       "token": "CQ7M2K9XQ4TP",
                     *       "qr_payload": "CSHL1:CQ7M2K9XQ4TP",
                     *       "expires_at": "2026-12-11T20:06:00Z"
                     *     }
                     */
                    "application/json": {
                        /** Format: uuid */
                        payment_request_id: string;
                        token: string;
                        qr_payload: string;
                        /** Format: date-time */
                        expires_at: string;
                    };
                };
            };
            401: components["responses"]["Unauthorized"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
        };
    };
    listMyRefundRequests: {
        parameters: {
            query?: {
                /** @description Curseur opaque renvoyé par la page précédente (`next_cursor`). */
                cursor?: components["parameters"]["Cursor"];
                limit?: components["parameters"]["Limit"];
            };
            header?: {
                /** @description Identifiant de corrélation fourni par le client. */
                "X-Request-Id"?: components["parameters"]["RequestId"];
                /**
                 * @description Langue des messages lisibles (`title`, `detail` des erreurs, libellés). Valeurs `fr` ou `en` ;
                 *     défaut `fr` (en-tête absent ou sans langue prise en charge). Sans effet sur les codes stables.
                 */
                "Accept-Language"?: components["parameters"]["AcceptLanguage"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Demandes. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PageMeta"] & {
                        data: components["schemas"]["RefundRequest"][];
                    };
                };
            };
            401: components["responses"]["Unauthorized"];
        };
    };
    createMyRefundRequest: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Clé d'idempotence. Terminaux : `<device_serial>:<seq>` (seq ≥ 1, au moins 4 chiffres). Autres : UUID.
                 *     Conservée au moins 30 jours (terminaux : pour toujours, c'est la clé du grand livre).
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                /** @description Identifiant de corrélation fourni par le client. */
                "X-Request-Id"?: components["parameters"]["RequestId"];
                /**
                 * @description Langue des messages lisibles (`title`, `detail` des erreurs, libellés). Valeurs `fr` ou `en` ;
                 *     défaut `fr` (en-tête absent ou sans langue prise en charge). Sans effet sur les codes stables.
                 */
                "Accept-Language"?: components["parameters"]["AcceptLanguage"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "wallet_id": "b2c3d4e5-f6a7-4890-9bcd-ef0123456789",
                 *       "destination": {
                 *         "method": "WAVE",
                 *         "msisdn": "+221770000002"
                 *       }
                 *     }
                 */
                "application/json": components["schemas"]["RefundRequestCreate"];
            };
        };
        responses: {
            /** @description Demande enregistrée. */
            201: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    "Idempotency-Replayed": components["headers"]["Idempotency-Replayed"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "refund_request_id": "RF-0001",
                     *       "wallet_id": "b2c3d4e5-f6a7-4890-9bcd-ef0123456789",
                     *       "status": "REQUESTED",
                     *       "estimated_amount": 1500,
                     *       "fee": 500,
                     *       "currency": "XOF",
                     *       "destination": {
                     *         "method": "WAVE",
                     *         "msisdn": "+221770000002"
                     *       },
                     *       "transaction_id": null,
                     *       "created_at": "2026-12-20T09:00:00Z"
                     *     }
                     */
                    "application/json": components["schemas"]["RefundRequest"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
        };
    };
    listRefundRequests: {
        parameters: {
            query?: {
                status?: components["schemas"]["RefundRequestStatus"];
                event_id?: string;
                /** @description Curseur opaque renvoyé par la page précédente (`next_cursor`). */
                cursor?: components["parameters"]["Cursor"];
                limit?: components["parameters"]["Limit"];
            };
            header?: {
                /** @description Identifiant de corrélation fourni par le client. */
                "X-Request-Id"?: components["parameters"]["RequestId"];
                /**
                 * @description Langue des messages lisibles (`title`, `detail` des erreurs, libellés). Valeurs `fr` ou `en` ;
                 *     défaut `fr` (en-tête absent ou sans langue prise en charge). Sans effet sur les codes stables.
                 */
                "Accept-Language"?: components["parameters"]["AcceptLanguage"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Demandes. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PageMeta"] & {
                        data: components["schemas"]["RefundRequest"][];
                    };
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
        };
    };
    decideRefundRequestAsHolder: {
        parameters: {
            query?: never;
            header?: {
                /** @description Identifiant de corrélation fourni par le client. */
                "X-Request-Id"?: components["parameters"]["RequestId"];
                /**
                 * @description Langue des messages lisibles (`title`, `detail` des erreurs, libellés). Valeurs `fr` ou `en` ;
                 *     défaut `fr` (en-tête absent ou sans langue prise en charge). Sans effet sur les codes stables.
                 */
                "Accept-Language"?: components["parameters"]["AcceptLanguage"];
            };
            path: {
                refund_request_id: components["parameters"]["RefundRequestId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "decision": "BLOCK",
                 *       "otp_request_id": "otp_01J9ZQ",
                 *       "code": "482913"
                 *     }
                 */
                "application/json": {
                    /** @enum {string} */
                    decision: "CONFIRM" | "BLOCK";
                    otp_request_id: string;
                    code: string;
                };
            };
        };
        responses: {
            /** @description Décision enregistrée. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RefundRequest"];
                };
            };
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
        };
    };
    approveRefundRequest: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Clé d'idempotence. Terminaux : `<device_serial>:<seq>` (seq ≥ 1, au moins 4 chiffres). Autres : UUID.
                 *     Conservée au moins 30 jours (terminaux : pour toujours, c'est la clé du grand livre).
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                /** @description Identifiant de corrélation fourni par le client. */
                "X-Request-Id"?: components["parameters"]["RequestId"];
                /**
                 * @description Langue des messages lisibles (`title`, `detail` des erreurs, libellés). Valeurs `fr` ou `en` ;
                 *     défaut `fr` (en-tête absent ou sans langue prise en charge). Sans effet sur les codes stables.
                 */
                "Accept-Language"?: components["parameters"]["AcceptLanguage"];
            };
            path: {
                refund_request_id: components["parameters"]["RefundRequestId"];
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                /**
                 * @example {
                 *       "note": "Numéro Wave vérifié par code à usage unique."
                 *     }
                 */
                "application/json": {
                    /** @description Note de l'auteur, gardée dans la demande d'approbation. */
                    note?: string;
                };
            };
        };
        responses: {
            202: components["responses"]["ApprovalRequestAccepted"];
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
        };
    };
    confirmRefundRequest: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Clé d'idempotence. Terminaux : `<device_serial>:<seq>` (seq ≥ 1, au moins 4 chiffres). Autres : UUID.
                 *     Conservée au moins 30 jours (terminaux : pour toujours, c'est la clé du grand livre).
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                /** @description Identifiant de corrélation fourni par le client. */
                "X-Request-Id"?: components["parameters"]["RequestId"];
                /**
                 * @description Langue des messages lisibles (`title`, `detail` des erreurs, libellés). Valeurs `fr` ou `en` ;
                 *     défaut `fr` (en-tête absent ou sans langue prise en charge). Sans effet sur les codes stables.
                 */
                "Accept-Language"?: components["parameters"]["AcceptLanguage"];
            };
            path: {
                refund_request_id: components["parameters"]["RefundRequestId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @enum {string} */
                    outcome: "PAID" | "FAILED";
                    /** @description Obligatoire si `outcome = PAID`. */
                    external_reference?: string;
                    /** @description Obligatoire si `outcome = FAILED`. */
                    failure_reason?: string;
                } & ({
                    /** @constant */
                    outcome?: "PAID";
                } | {
                    /** @constant */
                    outcome?: "FAILED";
                });
            };
        };
        responses: {
            /** @description Résultat enregistré. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    "Idempotency-Replayed": components["headers"]["Idempotency-Replayed"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "refund_request_id": "RF-0001",
                     *       "wallet_id": "b2c3d4e5-f6a7-4890-9bcd-ef0123456789",
                     *       "status": "PAID",
                     *       "estimated_amount": 1500,
                     *       "fee": 500,
                     *       "currency": "XOF",
                     *       "destination": {
                     *         "method": "WAVE",
                     *         "msisdn": "+221770000002"
                     *       },
                     *       "transaction_id": "2a3b4c5d-6e7f-4a8b-9c0d-1e2f3a4b5c6d",
                     *       "approved_by": "6e5d4c3b-2a19-4f8e-9d7c-6b5a49382716",
                     *       "external_reference": "WAVE-TX-88213407",
                     *       "created_at": "2026-12-20T09:00:00Z"
                     *     }
                     */
                    "application/json": components["schemas"]["RefundRequest"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
        };
    };
    rejectRefundRequest: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Clé d'idempotence. Terminaux : `<device_serial>:<seq>` (seq ≥ 1, au moins 4 chiffres). Autres : UUID.
                 *     Conservée au moins 30 jours (terminaux : pour toujours, c'est la clé du grand livre).
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                /** @description Identifiant de corrélation fourni par le client. */
                "X-Request-Id"?: components["parameters"]["RequestId"];
                /**
                 * @description Langue des messages lisibles (`title`, `detail` des erreurs, libellés). Valeurs `fr` ou `en` ;
                 *     défaut `fr` (en-tête absent ou sans langue prise en charge). Sans effet sur les codes stables.
                 */
                "Accept-Language"?: components["parameters"]["AcceptLanguage"];
            };
            path: {
                refund_request_id: components["parameters"]["RefundRequestId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "reason": "Numéro mobile money invalide, demande à refaire."
                 *     }
                 */
                "application/json": {
                    reason: string;
                };
            };
        };
        responses: {
            /** @description Demande refusée. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    "Idempotency-Replayed": components["headers"]["Idempotency-Replayed"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RefundRequest"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
        };
    };
    postLateClaim: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Clé d'idempotence. Terminaux : `<device_serial>:<seq>` (seq ≥ 1, au moins 4 chiffres). Autres : UUID.
                 *     Conservée au moins 30 jours (terminaux : pour toujours, c'est la clé du grand livre).
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                /** @description Identifiant de corrélation fourni par le client. */
                "X-Request-Id"?: components["parameters"]["RequestId"];
                /**
                 * @description Langue des messages lisibles (`title`, `detail` des erreurs, libellés). Valeurs `fr` ou `en` ;
                 *     défaut `fr` (en-tête absent ou sans langue prise en charge). Sans effet sur les codes stables.
                 */
                "Accept-Language"?: components["parameters"]["AcceptLanguage"];
            };
            path: {
                ledger_id: components["parameters"]["LedgerId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "wallet_id": "b2c3d4e5-f6a7-4890-9bcd-ef0123456789",
                 *       "amount": 4500,
                 *       "currency": "XOF",
                 *       "proof": {
                 *         "kind": "MEDIA_TAP",
                 *         "tap_id": 918777
                 *       },
                 *       "destination": {
                 *         "method": "WAVE",
                 *         "msisdn": "+221770000002"
                 *       },
                 *       "reason": "Festivalier absent pendant la fenêtre de remboursement, bracelet présenté."
                 *     }
                 */
                "application/json": components["schemas"]["LateClaimRequest"];
            };
        };
        responses: {
            202: components["responses"]["ApprovalRequestAccepted"];
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
        };
    };
    listApprovalRequests: {
        parameters: {
            query?: {
                status?: components["schemas"]["ApprovalRequestStatus"];
                action?: components["schemas"]["ApprovalAction"];
                /** @description Curseur opaque renvoyé par la page précédente (`next_cursor`). */
                cursor?: components["parameters"]["Cursor"];
                limit?: components["parameters"]["Limit"];
            };
            header?: {
                /** @description Identifiant de corrélation fourni par le client. */
                "X-Request-Id"?: components["parameters"]["RequestId"];
                /**
                 * @description Langue des messages lisibles (`title`, `detail` des erreurs, libellés). Valeurs `fr` ou `en` ;
                 *     défaut `fr` (en-tête absent ou sans langue prise en charge). Sans effet sur les codes stables.
                 */
                "Accept-Language"?: components["parameters"]["AcceptLanguage"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Page de demandes. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["ApprovalRequest"][];
                        next_cursor?: string | null;
                        has_more: boolean;
                    };
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
        };
    };
    getApprovalRequest: {
        parameters: {
            query?: never;
            header?: {
                /** @description Identifiant de corrélation fourni par le client. */
                "X-Request-Id"?: components["parameters"]["RequestId"];
                /**
                 * @description Langue des messages lisibles (`title`, `detail` des erreurs, libellés). Valeurs `fr` ou `en` ;
                 *     défaut `fr` (en-tête absent ou sans langue prise en charge). Sans effet sur les codes stables.
                 */
                "Accept-Language"?: components["parameters"]["AcceptLanguage"];
            };
            path: {
                approval_request_id: components["parameters"]["ApprovalRequestId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Demande. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApprovalRequest"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    approveApprovalRequest: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Clé d'idempotence. Terminaux : `<device_serial>:<seq>` (seq ≥ 1, au moins 4 chiffres). Autres : UUID.
                 *     Conservée au moins 30 jours (terminaux : pour toujours, c'est la clé du grand livre).
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                /** @description Identifiant de corrélation fourni par le client. */
                "X-Request-Id"?: components["parameters"]["RequestId"];
                /**
                 * @description Langue des messages lisibles (`title`, `detail` des erreurs, libellés). Valeurs `fr` ou `en` ;
                 *     défaut `fr` (en-tête absent ou sans langue prise en charge). Sans effet sur les codes stables.
                 */
                "Accept-Language"?: components["parameters"]["AcceptLanguage"];
            };
            path: {
                approval_request_id: components["parameters"]["ApprovalRequestId"];
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                /**
                 * @example {
                 *       "note": "Trou vérifié sur le terminal, journal perdu confirmé."
                 *     }
                 */
                "application/json": components["schemas"]["ApprovalDecision"];
            };
        };
        responses: {
            /** @description Demande décidée et exécutée (`EXECUTED`), ou exécution refusée (`FAILED`). */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    "Idempotency-Replayed": components["headers"]["Idempotency-Replayed"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "approval_request_id": "4b5c6d7e-8f90-4a1b-9c2d-3e4f5a6b7c8d",
                     *       "action": "WAIVE_SEQ_GAP",
                     *       "target_id": "7c0e1a52-0000-4000-8000-000000000002",
                     *       "payload": {
                     *         "device_id": "7c0e1a52-0000-4000-8000-000000000002",
                     *         "seq": 87,
                     *         "reason": "Terminal réinitialisé en usine après chute, journal local perdu."
                     *       },
                     *       "requested_by": "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
                     *       "requested_at": "2026-12-13T09:00:00Z",
                     *       "expires_at": "2026-12-14T09:00:00Z",
                     *       "status": "EXECUTED",
                     *       "decided_by": "6e5d4c3b-2a19-4f8e-9d7c-6b5a49382716",
                     *       "decided_at": "2026-12-13T09:20:00Z",
                     *       "decision_note": "Trou vérifié sur le terminal, journal perdu confirmé.",
                     *       "executed_tx_id": null,
                     *       "result": {
                     *         "device_id": "7c0e1a52-0000-4000-8000-000000000002"
                     *       },
                     *       "failure_code": null,
                     *       "failure_reason": null
                     *     }
                     */
                    "application/json": components["schemas"]["ApprovalRequest"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
        };
    };
    rejectApprovalRequest: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Clé d'idempotence. Terminaux : `<device_serial>:<seq>` (seq ≥ 1, au moins 4 chiffres). Autres : UUID.
                 *     Conservée au moins 30 jours (terminaux : pour toujours, c'est la clé du grand livre).
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                /** @description Identifiant de corrélation fourni par le client. */
                "X-Request-Id"?: components["parameters"]["RequestId"];
                /**
                 * @description Langue des messages lisibles (`title`, `detail` des erreurs, libellés). Valeurs `fr` ou `en` ;
                 *     défaut `fr` (en-tête absent ou sans langue prise en charge). Sans effet sur les codes stables.
                 */
                "Accept-Language"?: components["parameters"]["AcceptLanguage"];
            };
            path: {
                approval_request_id: components["parameters"]["ApprovalRequestId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "note": "Le terminal a été retrouvé ; renvoyer les lots au lieu de lever le trou."
                 *     }
                 */
                "application/json": components["schemas"]["ApprovalRejection"];
            };
        };
        responses: {
            /** @description Demande refusée (`REJECTED`). */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    "Idempotency-Replayed": components["headers"]["Idempotency-Replayed"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApprovalRequest"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
        };
    };
    getDebitAuthority: {
        parameters: {
            query?: never;
            header?: {
                /** @description Identifiant de corrélation fourni par le client. */
                "X-Request-Id"?: components["parameters"]["RequestId"];
                /**
                 * @description Langue des messages lisibles (`title`, `detail` des erreurs, libellés). Valeurs `fr` ou `en` ;
                 *     défaut `fr` (en-tête absent ou sans langue prise en charge). Sans effet sur les codes stables.
                 */
                "Accept-Language"?: components["parameters"]["AcceptLanguage"];
            };
            path: {
                ledger_id: components["parameters"]["LedgerId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description État de l'autorité. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "ledger_id": "2c9a1f0e-3b4d-4e5f-8a7b-6c5d4e3f2a1b",
                     *       "authority": "EDGE",
                     *       "epoch": 5,
                     *       "edge_gateway_id": "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d",
                     *       "edge_base_url": "https://edge.local:8443/v1",
                     *       "handover": null
                     *     }
                     */
                    "application/json": components["schemas"]["DebitAuthorityState"];
                };
            };
            401: components["responses"]["Unauthorized"];
            404: components["responses"]["NotFound"];
        };
    };
    requestDebitAuthorityChange: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Clé d'idempotence. Terminaux : `<device_serial>:<seq>` (seq ≥ 1, au moins 4 chiffres). Autres : UUID.
                 *     Conservée au moins 30 jours (terminaux : pour toujours, c'est la clé du grand livre).
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                /** @description Identifiant de corrélation fourni par le client. */
                "X-Request-Id"?: components["parameters"]["RequestId"];
                /**
                 * @description Langue des messages lisibles (`title`, `detail` des erreurs, libellés). Valeurs `fr` ou `en` ;
                 *     défaut `fr` (en-tête absent ou sans langue prise en charge). Sans effet sur les codes stables.
                 */
                "Accept-Language"?: components["parameters"]["AcceptLanguage"];
            };
            path: {
                ledger_id: components["parameters"]["LedgerId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "target": "EDGE",
                 *       "edge_gateway_id": "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d",
                 *       "reason": "Liaison satellite instable, passage sur la passerelle du site."
                 *     }
                 */
                "application/json": components["schemas"]["DebitAuthorityChangeRequest"];
            };
        };
        responses: {
            /**
             * @description `force = false` : bascule engagée, réponse `DebitAuthorityState` ; suivre `handover.state`.
             *     `force = true` : demande d'approbation créée, réponse `ApprovalRequest` (`FORCE_CENTRAL_AUTHORITY`,
             *     `PENDING`) ; rien n'est encore exécuté.
             */
            202: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    "Idempotency-Replayed": components["headers"]["Idempotency-Replayed"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "ledger_id": "2c9a1f0e-3b4d-4e5f-8a7b-6c5d4e3f2a1b",
                     *       "authority": "EDGE",
                     *       "epoch": 5,
                     *       "edge_gateway_id": "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d",
                     *       "edge_base_url": "https://edge.local:8443/v1",
                     *       "handover": {
                     *         "handover_id": "ho_31",
                     *         "direction": "TO_EDGE",
                     *         "state": "GRANTED",
                     *         "epoch": 5,
                     *         "central_watermark_posting_id": 1048576,
                     *         "requested_at": "2026-12-12T18:00:00Z"
                     *       }
                     *     }
                     */
                    "application/json": components["schemas"]["DebitAuthorityState"] | components["schemas"]["ApprovalRequest"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
        };
    };
    getCurrentEdgeHandover: {
        parameters: {
            query?: {
                wait?: number;
            };
            header?: {
                /** @description Identifiant de corrélation fourni par le client. */
                "X-Request-Id"?: components["parameters"]["RequestId"];
                /**
                 * @description Langue des messages lisibles (`title`, `detail` des erreurs, libellés). Valeurs `fr` ou `en` ;
                 *     défaut `fr` (en-tête absent ou sans langue prise en charge). Sans effet sur les codes stables.
                 */
                "Accept-Language"?: components["parameters"]["AcceptLanguage"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description État. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DebitAuthorityState"];
                };
            };
            401: components["responses"]["Unauthorized"];
        };
    };
    ackEdgeHandover: {
        parameters: {
            query?: never;
            header?: {
                /** @description Identifiant de corrélation fourni par le client. */
                "X-Request-Id"?: components["parameters"]["RequestId"];
                /**
                 * @description Langue des messages lisibles (`title`, `detail` des erreurs, libellés). Valeurs `fr` ou `en` ;
                 *     défaut `fr` (en-tête absent ou sans langue prise en charge). Sans effet sur les codes stables.
                 */
                "Accept-Language"?: components["parameters"]["AcceptLanguage"];
            };
            path: {
                handover_id: components["parameters"]["HandoverId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "epoch": 5,
                 *       "replicated_posting_id": 1048576
                 *     }
                 */
                "application/json": {
                    /** Format: int64 */
                    epoch: number;
                    /** Format: int64 */
                    replicated_posting_id: number;
                };
            };
        };
        responses: {
            /** @description Autorité active sur la passerelle. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DebitAuthorityState"];
                };
            };
            401: components["responses"]["Unauthorized"];
            409: components["responses"]["Conflict"];
        };
    };
    releaseEdgeHandover: {
        parameters: {
            query?: never;
            header?: {
                /** @description Identifiant de corrélation fourni par le client. */
                "X-Request-Id"?: components["parameters"]["RequestId"];
                /**
                 * @description Langue des messages lisibles (`title`, `detail` des erreurs, libellés). Valeurs `fr` ou `en` ;
                 *     défaut `fr` (en-tête absent ou sans langue prise en charge). Sans effet sur les codes stables.
                 */
                "Accept-Language"?: components["parameters"]["AcceptLanguage"];
            };
            path: {
                handover_id: components["parameters"]["HandoverId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "epoch": 5,
                 *       "final_edge_seq": 4211,
                 *       "last_chain_hash": "60303ae22b998861bce3b28f33eec1be758a213c86c93c076dbe9f558c11c752",
                 *       "operations_count": 4211
                 *     }
                 */
                "application/json": {
                    /** Format: int64 */
                    epoch: number;
                    /** Format: int64 */
                    final_edge_seq: number;
                    last_chain_hash: components["schemas"]["Hex32"];
                    /** Format: int64 */
                    operations_count: number;
                };
            };
        };
        responses: {
            /** @description Autorité rendue au central. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DebitAuthorityState"];
                };
            };
            401: components["responses"]["Unauthorized"];
            409: components["responses"]["Conflict"];
        };
    };
    getEdgeReplicationFeed: {
        parameters: {
            query: {
                after_posting_id: number;
                limit?: components["parameters"]["Limit"];
            };
            header?: {
                /** @description Identifiant de corrélation fourni par le client. */
                "X-Request-Id"?: components["parameters"]["RequestId"];
                /**
                 * @description Langue des messages lisibles (`title`, `detail` des erreurs, libellés). Valeurs `fr` ou `en` ;
                 *     défaut `fr` (en-tête absent ou sans langue prise en charge). Sans effet sur les codes stables.
                 */
                "Accept-Language"?: components["parameters"]["AcceptLanguage"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Page du flux. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "ledger_id": "2c9a1f0e-3b4d-4e5f-8a7b-6c5d4e3f2a1b",
                     *       "epoch": 5,
                     *       "from_posting_id": 1048500,
                     *       "to_posting_id": 1048576,
                     *       "wallets": [
                     *         {
                     *           "wallet_id": "a1b2c3d4-e5f6-4789-8abc-def012345678",
                     *           "status": "ACTIVE",
                     *           "paid": 29000,
                     *           "promo": 0
                     *         }
                     *       ],
                     *       "media": [],
                     *       "has_more": false
                     *     }
                     */
                    "application/json": components["schemas"]["ReplicationPage"];
                };
            };
            401: components["responses"]["Unauthorized"];
            409: components["responses"]["Conflict"];
        };
    };
    submitEdgeSyncBatch: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Clé d'idempotence. Terminaux : `<device_serial>:<seq>` (seq ≥ 1, au moins 4 chiffres). Autres : UUID.
                 *     Conservée au moins 30 jours (terminaux : pour toujours, c'est la clé du grand livre).
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                /** @description Identifiant de corrélation fourni par le client. */
                "X-Request-Id"?: components["parameters"]["RequestId"];
                /**
                 * @description Langue des messages lisibles (`title`, `detail` des erreurs, libellés). Valeurs `fr` ou `en` ;
                 *     défaut `fr` (en-tête absent ou sans langue prise en charge). Sans effet sur les codes stables.
                 */
                "Accept-Language"?: components["parameters"]["AcceptLanguage"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["EdgeSyncBatch"];
            };
        };
        responses: {
            /** @description Résultat par opération. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OfflineBatchResult"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            409: components["responses"]["Conflict"];
            413: components["responses"]["PayloadTooLarge"];
        };
    };
    onPaymentIntentSucceeded: {
        parameters: {
            query?: never;
            header: {
                "X-Cashless-Signature": components["parameters"]["OutboundSignature"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "event_id": "evt_9Kd2",
                 *       "type": "payment_intent.succeeded",
                 *       "created_at": "2026-12-12T20:01:12Z",
                 *       "data": {
                 *         "payment_intent_id": "pi_7Hq2xN4mR8",
                 *         "status": "SUCCEEDED",
                 *         "amount": 7500,
                 *         "amount_capturable": 0,
                 *         "amount_captured": 7500,
                 *         "currency": "XOF",
                 *         "capture_method": "AUTOMATIC",
                 *         "pos_id": "0c6f0d7e-11aa-4b8b-9c3e-5d2f1a7b8c90",
                 *         "device_id": "3f7d2c10-6a55-4b6e-9d0e-1c2b3a4d5e6f",
                 *         "external_reference": "POSX-TCK-000981",
                 *         "qr_payload": null,
                 *         "transaction_id": "5e6f7a8b-9c0d-4e1f-8a2b-3c4d5e6f7a8b",
                 *         "created_at": "2026-12-12T20:00:00Z",
                 *         "expires_at": "2026-12-12T20:05:00Z"
                 *       }
                 *     }
                 */
                "application/json": components["schemas"]["OutboundEvent"];
            };
        };
        responses: {
            /** @description Reçu. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    onPaymentIntentAuthorized: {
        parameters: {
            query?: never;
            header: {
                "X-Cashless-Signature": components["parameters"]["OutboundSignature"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["OutboundEvent"];
            };
        };
        responses: {
            /** @description Reçu. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    onPaymentIntentCancelled: {
        parameters: {
            query?: never;
            header: {
                "X-Cashless-Signature": components["parameters"]["OutboundSignature"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["OutboundEvent"];
            };
        };
        responses: {
            /** @description Reçu. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    onPaymentIntentReversed: {
        parameters: {
            query?: never;
            header: {
                "X-Cashless-Signature": components["parameters"]["OutboundSignature"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["OutboundEvent"];
            };
        };
        responses: {
            /** @description Reçu. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    listUsers: {
        parameters: {
            query?: {
                /** @description Curseur opaque renvoyé par la page précédente (`next_cursor`). */
                cursor?: components["parameters"]["Cursor"];
                limit?: components["parameters"]["Limit"];
            };
            header?: {
                /** @description Identifiant de corrélation fourni par le client. */
                "X-Request-Id"?: components["parameters"]["RequestId"];
                /**
                 * @description Langue des messages lisibles (`title`, `detail` des erreurs, libellés). Valeurs `fr` ou `en` ;
                 *     défaut `fr` (en-tête absent ou sans langue prise en charge). Sans effet sur les codes stables.
                 */
                "Accept-Language"?: components["parameters"]["AcceptLanguage"];
            };
            path: {
                /** @description Prestataire visé ; celui de la personne, sauf pour un `PLATFORM_ADMIN` (sinon `404`). */
                operator_id: components["parameters"]["OperatorId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Page de personnes. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["StaffUser"][];
                        next_cursor?: string | null;
                        has_more: boolean;
                    };
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    createUser: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Clé d'idempotence. Terminaux : `<device_serial>:<seq>` (seq ≥ 1, au moins 4 chiffres). Autres : UUID.
                 *     Conservée au moins 30 jours (terminaux : pour toujours, c'est la clé du grand livre).
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                /** @description Identifiant de corrélation fourni par le client. */
                "X-Request-Id"?: components["parameters"]["RequestId"];
                /**
                 * @description Langue des messages lisibles (`title`, `detail` des erreurs, libellés). Valeurs `fr` ou `en` ;
                 *     défaut `fr` (en-tête absent ou sans langue prise en charge). Sans effet sur les codes stables.
                 */
                "Accept-Language"?: components["parameters"]["AcceptLanguage"];
            };
            path: {
                /** @description Prestataire visé ; celui de la personne, sauf pour un `PLATFORM_ADMIN` (sinon `404`). */
                operator_id: components["parameters"]["OperatorId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["StaffUserCreate"];
            };
        };
        responses: {
            /** @description Personne créée. */
            201: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    "Idempotency-Replayed": components["headers"]["Idempotency-Replayed"];
                    /** @description `/v1/operators/{operator_id}/users/{user_id}` */
                    Location?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["StaffUser"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
        };
    };
    getUser: {
        parameters: {
            query?: never;
            header?: {
                /** @description Identifiant de corrélation fourni par le client. */
                "X-Request-Id"?: components["parameters"]["RequestId"];
                /**
                 * @description Langue des messages lisibles (`title`, `detail` des erreurs, libellés). Valeurs `fr` ou `en` ;
                 *     défaut `fr` (en-tête absent ou sans langue prise en charge). Sans effet sur les codes stables.
                 */
                "Accept-Language"?: components["parameters"]["AcceptLanguage"];
            };
            path: {
                /** @description Prestataire visé ; celui de la personne, sauf pour un `PLATFORM_ADMIN` (sinon `404`). */
                operator_id: components["parameters"]["OperatorId"];
                user_id: components["parameters"]["UserId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Personne. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["StaffUser"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    disableUser: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Clé d'idempotence. Terminaux : `<device_serial>:<seq>` (seq ≥ 1, au moins 4 chiffres). Autres : UUID.
                 *     Conservée au moins 30 jours (terminaux : pour toujours, c'est la clé du grand livre).
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                /** @description Identifiant de corrélation fourni par le client. */
                "X-Request-Id"?: components["parameters"]["RequestId"];
                /**
                 * @description Langue des messages lisibles (`title`, `detail` des erreurs, libellés). Valeurs `fr` ou `en` ;
                 *     défaut `fr` (en-tête absent ou sans langue prise en charge). Sans effet sur les codes stables.
                 */
                "Accept-Language"?: components["parameters"]["AcceptLanguage"];
            };
            path: {
                /** @description Prestataire visé ; celui de la personne, sauf pour un `PLATFORM_ADMIN` (sinon `404`). */
                operator_id: components["parameters"]["OperatorId"];
                user_id: components["parameters"]["UserId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Personne désactivée. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    "Idempotency-Replayed": components["headers"]["Idempotency-Replayed"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["StaffUser"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
        };
    };
    grantRole: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Clé d'idempotence. Terminaux : `<device_serial>:<seq>` (seq ≥ 1, au moins 4 chiffres). Autres : UUID.
                 *     Conservée au moins 30 jours (terminaux : pour toujours, c'est la clé du grand livre).
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                /** @description Identifiant de corrélation fourni par le client. */
                "X-Request-Id"?: components["parameters"]["RequestId"];
                /**
                 * @description Langue des messages lisibles (`title`, `detail` des erreurs, libellés). Valeurs `fr` ou `en` ;
                 *     défaut `fr` (en-tête absent ou sans langue prise en charge). Sans effet sur les codes stables.
                 */
                "Accept-Language"?: components["parameters"]["AcceptLanguage"];
            };
            path: {
                /** @description Prestataire visé ; celui de la personne, sauf pour un `PLATFORM_ADMIN` (sinon `404`). */
                operator_id: components["parameters"]["OperatorId"];
                user_id: components["parameters"]["UserId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RoleGrant"];
            };
        };
        responses: {
            /** @description Attribution créée. */
            201: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    "Idempotency-Replayed": components["headers"]["Idempotency-Replayed"];
                    /** @description `/v1/operators/{operator_id}/users/{user_id}` */
                    Location?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RoleAssignment"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Unprocessable"];
        };
    };
    revokeRole: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Clé d'idempotence. Terminaux : `<device_serial>:<seq>` (seq ≥ 1, au moins 4 chiffres). Autres : UUID.
                 *     Conservée au moins 30 jours (terminaux : pour toujours, c'est la clé du grand livre).
                 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                /** @description Identifiant de corrélation fourni par le client. */
                "X-Request-Id"?: components["parameters"]["RequestId"];
                /**
                 * @description Langue des messages lisibles (`title`, `detail` des erreurs, libellés). Valeurs `fr` ou `en` ;
                 *     défaut `fr` (en-tête absent ou sans langue prise en charge). Sans effet sur les codes stables.
                 */
                "Accept-Language"?: components["parameters"]["AcceptLanguage"];
            };
            path: {
                /** @description Prestataire visé ; celui de la personne, sauf pour un `PLATFORM_ADMIN` (sinon `404`). */
                operator_id: components["parameters"]["OperatorId"];
                assignment_id: components["parameters"]["AssignmentId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Attribution retirée. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    "Idempotency-Replayed": components["headers"]["Idempotency-Replayed"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RoleAssignment"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
        };
    };
    createPlatformAdmin: {
        parameters: {
            query?: never;
            header?: {
                /** @description Identifiant de corrélation fourni par le client. */
                "X-Request-Id"?: components["parameters"]["RequestId"];
                /**
                 * @description Langue des messages lisibles (`title`, `detail` des erreurs, libellés). Valeurs `fr` ou `en` ;
                 *     défaut `fr` (en-tête absent ou sans langue prise en charge). Sans effet sur les codes stables.
                 */
                "Accept-Language"?: components["parameters"]["AcceptLanguage"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["StaffUserCreate"];
            };
        };
        responses: {
            /** @description Administrateur de la plateforme créé. */
            201: {
                headers: {
                    "X-Request-Id": components["headers"]["X-Request-Id"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["StaffUser"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            409: components["responses"]["Conflict"];
        };
    };
}
