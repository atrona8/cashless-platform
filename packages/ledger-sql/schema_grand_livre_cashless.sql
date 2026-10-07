-- Modèle comptable cashless multi-tenant — PostgreSQL 17+ (ADR-55) — v2
-- Conventions : montants en unités mineures (bigint), signe + = débit, - = crédit.
-- Seule la fonction post_transaction() écrit dans le grand livre (rôle applicatif sans INSERT direct).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. Parties et hiérarchie ---------------------------------------------------
CREATE TYPE party_kind AS ENUM ('PLATFORM','OPERATOR','ORGANIZER','MERCHANT','CUSTOMER','THIRD_PARTY');  -- THIRD_PARTY : détenteur tiers des fonds (compte cantonné, établissement agréé)

CREATE TABLE party (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind          party_kind NOT NULL,
  operator_id   uuid REFERENCES party(id),          -- tenant ; NULL pour PLATFORM et OPERATOR
  parent_id     uuid REFERENCES party(id),          -- ex. organisateur d'un commerçant interne
  legal_name    text NOT NULL,
  country_code  char(2),
  tax_id        text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind IN ('PLATFORM','OPERATOR')) = (operator_id IS NULL))
);

CREATE TABLE jurisdiction_profile (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  country_code               char(2) NOT NULL,
  version                    int NOT NULL,
  valid_from                 date NOT NULL,
  min_refund_window_days     int,                  -- NULL = pas d'obligation
  breakage_destination       text NOT NULL CHECK (breakage_destination IN ('ORGANIZER','OPERATOR','LEGAL_ACCOUNT','NONE')),
  max_wallet_balance         bigint,               -- plafond de solde d'un client IDENTIFIÉ (NULL = aucun)
  kyc_threshold              bigint,
  unidentified_max_balance   bigint,               -- plafond de solde d'un client NON identifié
  unidentified_monthly_limit bigint,               -- total des recharges du mois, client non identifié (BCEAO : 200 000 FCFA, à confirmer)
  identified_monthly_limit   bigint,               -- total des recharges du mois, client identifié
  rules                      jsonb NOT NULL DEFAULT '{}',   -- taxes, arrondis, etc.
  -- Casse réversible (ADR-67) : années pendant lesquelles un festivalier peut encore être remboursé après la
  -- clôture (prescription OHADA de 5 ans par hypothèse) ; 0 = casse définitive à la date limite.
  late_claim_years           int NOT NULL DEFAULT 5 CHECK (late_claim_years BETWEEN 0 AND 10),
  UNIQUE (country_code, version)
);

CREATE TYPE event_status AS ENUM ('DRAFT','LIVE','CLOSING','RECONCILING','SETTLING','REFUND_WINDOW','CLOSED');

CREATE TABLE event (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id      uuid NOT NULL REFERENCES party(id),
  organizer_id     uuid NOT NULL REFERENCES party(id),
  name             text NOT NULL,
  currency         char(3) NOT NULL,
  timezone         text NOT NULL,
  status           event_status NOT NULL DEFAULT 'DRAFT',
  starts_at        timestamptz, ends_at timestamptz,
  refund_deadline  timestamptz,
  jurisdiction_id  uuid NOT NULL REFERENCES jurisdiction_profile(id),
  -- choix obligatoire à la création de l'événement (pas de valeur par défaut)
  funds_holder     text NOT NULL CHECK (funds_holder IN ('ORGANIZER','OPERATOR','THIRD_PARTY')),
  identity_mode    text NOT NULL DEFAULT 'ANONYMOUS_ALLOWED' CHECK (identity_mode IN ('ANONYMOUS_ALLOWED','ACCOUNT_REQUIRED')),
  -- Modes d'activation autorisés par l'organisateur (un ou plusieurs) :
  --   DESK : par le staff à l'entrée ou au guichet ; SELF_APP : par le festivalier dans l'app ;
  --   FIRST_TOPUP : automatiquement à la première recharge
  activation_modes text[] NOT NULL DEFAULT '{DESK}'
                   CHECK (cardinality(activation_modes) > 0
                          AND activation_modes <@ ARRAY['DESK','SELF_APP','FIRST_TOPUP']),
  -- Bracelet déclaré perdu puis retrouvé : END_OF_LIFE (retiré définitivement) ou REACTIVATE (remis en service)
  lost_media_policy text NOT NULL DEFAULT 'END_OF_LIFE' CHECK (lost_media_policy IN ('END_OF_LIFE','REACTIVATE')),
  -- Renvoi réseau d'une même lecture (ADR-50) : même terminal, bracelet, compteur et UID reçus dans ce délai
  -- = même lecture, pas une copie. 0 = désactivé. Borné à 10 min.
  tap_replay_window_seconds int NOT NULL DEFAULT 120 CHECK (tap_replay_window_seconds BETWEEN 0 AND 600),
  -- Remboursement en espèces au guichet (ADR-53) : une seule personne jusqu'à ce montant (unités mineures de la
  -- devise), seconde personne au-delà. Appliqué par l'API au guichet.
  cash_refund_single_max bigint NOT NULL DEFAULT 50000 CHECK (cash_refund_single_max >= 0),
  -- Date limite de synchronisation (ADR-73, Q2) : heures après la fin de l'événement (ends_at, ou à défaut le
  -- passage en CLOSING). Avant cette date, SETTLING exige que tous les terminaux aient tout remonté. Réglée par le prestataire.
  sync_deadline_hours int NOT NULL DEFAULT 72 CHECK (sync_deadline_hours BETWEEN 1 AND 720),
  -- Remboursement mobile money vers un numéro autre que le numéro vérifié (ADR-76, Q5) : code au nouveau numéro ;
  -- si un numéro vérifié existe, il approuve aussi, sinon attente de refund_new_number_hold_hours avec
  -- notification ; au-delà de refund_new_number_max, validation au guichet ou au back-office. Réglés par le prestataire.
  refund_new_number_max        bigint NOT NULL DEFAULT 50000 CHECK (refund_new_number_max >= 0),
  refund_new_number_hold_hours int    NOT NULL DEFAULT 48    CHECK (refund_new_number_hold_hours BETWEEN 0 AND 168),
  -- Protection contre les contestations carte (ADR-77) : plafond de recharge par carte et par jour (0 = carte
  -- refusée), seuil d'alerte du nombre de cartes différentes qui rechargent un même portefeuille.
  card_topup_daily_max_per_card bigint NOT NULL DEFAULT 100000 CHECK (card_topup_daily_max_per_card >= 0),
  card_alert_cards_per_wallet   int    NOT NULL DEFAULT 3      CHECK (card_alert_cards_per_wallet BETWEEN 2 AND 20),
  -- Réglages de fonctionnement des terminaux (ADR-61), envoyés dans DeviceConfig ; bornes imposées ici.
  -- Réglés par le prestataire, sauf reversal_window_minutes (organisateur).
  online_connect_timeout_ms int NOT NULL DEFAULT 2000 CHECK (online_connect_timeout_ms BETWEEN 1000 AND 5000),
  online_total_timeout_ms   int NOT NULL DEFAULT 3000 CHECK (online_total_timeout_ms BETWEEN 2000 AND 6000),
  online_retries            int NOT NULL DEFAULT 2    CHECK (online_retries BETWEEN 0 AND 3),
  pending_sync_seconds      int NOT NULL DEFAULT 30   CHECK (pending_sync_seconds BETWEEN 10 AND 300),
  reconcile_sync_seconds    int NOT NULL DEFAULT 300  CHECK (reconcile_sync_seconds BETWEEN 60 AND 1800),
  heartbeat_seconds         int NOT NULL DEFAULT 60   CHECK (heartbeat_seconds BETWEEN 30 AND 300),
  reversal_window_minutes   int NOT NULL DEFAULT 15   CHECK (reversal_window_minutes BETWEEN 0 AND 60),
  local_retention_days      int NOT NULL DEFAULT 7    CHECK (local_retention_days BETWEEN 7 AND 30),
  CHECK (online_connect_timeout_ms < online_total_timeout_ms),
  contract_id      uuid                                  -- contrat prestataire–organisateur applicable
);

-- Contrats : plateforme–prestataire et prestataire–organisateur (valeurs contractuelles, versionnées)
CREATE TABLE contract (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id             uuid NOT NULL REFERENCES party(id),
  kind                    text NOT NULL CHECK (kind IN ('PLATFORM_OPERATOR','OPERATOR_ORGANIZER')),
  counterparty_id         uuid NOT NULL REFERENCES party(id),
  version                 int NOT NULL DEFAULT 1,
  valid_from              timestamptz NOT NULL,
  platform_fee_mode       text CHECK (platform_fee_mode IN ('IN_POOL','INVOICED')),            -- PLATFORM_OPERATOR
  offline_loss_bearer     text CHECK (offline_loss_bearer IN ('ORGANIZER','OPERATOR')),        -- OPERATOR_ORGANIZER
  cash_diff_bearer        text CHECK (cash_diff_bearer IN ('ORGANIZER','OPERATOR')),
  breakage_organizer_bps  int CHECK (breakage_organizer_bps BETWEEN 0 AND 10000),             -- part de la casse ; le reste au prestataire
  -- Assiette des frais du prestataire assis sur les recharges (ADR-68) : brutes, ou nettes des remboursements
  operator_fee_basis      text NOT NULL DEFAULT 'GROSS' CHECK (operator_fee_basis IN ('GROSS','NET_OF_REFUNDS')),
  -- Contestations carte (ADR-77, Q6) : partie qui supporte la part non couverte par le solde du portefeuille
  chargeback_bearer       text NOT NULL DEFAULT 'ORGANIZER' CHECK (chargeback_bearer IN ('ORGANIZER','OPERATOR')),
  CHECK (kind <> 'OPERATOR_ORGANIZER' OR (offline_loss_bearer IS NOT NULL AND cash_diff_bearer IS NOT NULL AND breakage_organizer_bps IS NOT NULL)),
  CHECK (kind <> 'PLATFORM_OPERATOR' OR platform_fee_mode IS NOT NULL)
);

-- Configuration en cascade, versionnée (plateforme > prestataire > organisateur > événement > participation)
CREATE TABLE config_version (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id uuid REFERENCES party(id),
  scope_type  text NOT NULL CHECK (scope_type IN ('PLATFORM','OPERATOR','ORGANIZER','EVENT','PARTICIPATION')),
  scope_id    uuid NOT NULL,
  version     int NOT NULL,
  valid_from  timestamptz NOT NULL,
  settings    jsonb NOT NULL,          -- wallet_scope, spend_order, refund_policy, rounding, ... (funds_holder : colonne event.funds_holder, qui fait foi)
  UNIQUE (scope_type, scope_id, version)
);

CREATE TABLE merchant_participation (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id  uuid NOT NULL REFERENCES party(id),
  event_id     uuid NOT NULL REFERENCES event(id),
  merchant_id  uuid NOT NULL REFERENCES party(id),
  link_type    text NOT NULL CHECK (link_type IN ('INTERNAL','EXTERNAL')),
  payout_to    uuid NOT NULL REFERENCES party(id),  -- organisateur si INTERNAL
  -- Droit de place (ADR-40) : DEDUCT_OR_DEBT = déduit des ventes, le reste devient une dette du commerçant
  -- transférée à l'organisateur à la clôture ; PREPAID = payé d'avance hors système ; DEDUCT_CAPPED = déduit
  -- dans la limite des ventes, le reste est abandonné
  pitch_fee_mode text NOT NULL DEFAULT 'DEDUCT_OR_DEBT' CHECK (pitch_fee_mode IN ('DEDUCT_OR_DEBT','PREPAID','DEDUCT_CAPPED')),
  UNIQUE (event_id, merchant_id)
);

CREATE TABLE point_of_sale (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id      uuid NOT NULL REFERENCES party(id),
  participation_id uuid NOT NULL REFERENCES merchant_participation(id),
  name             text NOT NULL
);

CREATE TABLE device (                                  -- terminal Android ou iOS, sans MDM (ADR-69)
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id      uuid NOT NULL REFERENCES party(id),
  kind             text NOT NULL DEFAULT 'POS' CHECK (kind IN ('POS','TOPUP')),
  app_mode         text NOT NULL DEFAULT 'CATALOG_POS' CHECK (app_mode IN ('CATALOG_POS','KEYPAD_TPE','TOPUP_DESK')),  -- PAIRED_TPE : V2 (ADR-43), ajouté par migration
  os               text NOT NULL DEFAULT 'ANDROID' CHECK (os IN ('ANDROID','IOS')),
  nfc_enabled      boolean NOT NULL DEFAULT true,
  provided_by      text NOT NULL DEFAULT 'OPERATOR' CHECK (provided_by IN ('PLATFORM','OPERATOR','ORGANIZER','MERCHANT')),  -- désigne qui porte la perte d'une opération non conforme (ADR-58)
  CHECK (os = 'ANDROID' OR NOT nfc_enabled),           -- iOS : QR uniquement, jamais de NFC
  event_id         uuid REFERENCES event(id),          -- événement auquel le terminal est affecté
  pos_id           uuid REFERENCES point_of_sale(id),
  station_name     text,                               -- caisse de recharge
  serial           text NOT NULL,                      -- unique parmi les terminaux non révoqués (index device_serial_active)
  public_key       bytea,                              -- clé ECDSA P-256 générée dans l'Android Keystore (non exportable)
  status           text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUSPENDED','REVOKED')),
  last_seq         bigint NOT NULL DEFAULT 0,          -- plus grand numéro de séquence reçu (max_seen_seq)
  last_snapshot_version bigint,                       -- dernier snapshot hors ligne accusé
  last_seen_at     timestamptz,
  -- Numérotation et chaînage (sync_protocol §3) : tenus par record_device_seq et open_offline_batch
  contiguous_acked_seq bigint NOT NULL DEFAULT 0,      -- plus grand numéro N tel que 1..N ont tous un résultat final
  next_seq_floor   bigint NOT NULL DEFAULT 1 CHECK (next_seq_floor >= 1),  -- plancher servi dans la configuration
  last_chain_seq   bigint NOT NULL DEFAULT 0,          -- numéro auquel se rapporte last_chain_hash
  last_chain_hash  bytea CHECK (octet_length(last_chain_hash) = 32),  -- NULL : départ (0) ou inconnu après un trou levé
  agreement_public_key bytea CHECK (octet_length(agreement_public_key) = 65),  -- ECDH P-256, point non compressé
  cert_sha256      bytea CHECK (octet_length(cert_sha256) = 32),   -- empreinte du certificat client (mTLS)
  personal_phone   boolean NOT NULL DEFAULT false,     -- téléphone personnel d'un commerçant (mode KEYPAD_TPE)
  CHECK (contiguous_acked_seq <= last_seq)
);
-- Un ré-enrôlement réutilise le serial (sync_protocol §3.1) : unicité parmi les terminaux non révoqués
CREATE UNIQUE INDEX device_serial_active ON device (serial) WHERE status <> 'REVOKED';

-- 2. Règles de frais et de taxes ----------------------------------------------
CREATE TABLE fee_rule (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id            uuid REFERENCES party(id),
  scope_type             text NOT NULL CHECK (scope_type IN ('PLATFORM_CONTRACT','OPERATOR_CONTRACT','EVENT','PARTICIPATION')),
  scope_id               uuid NOT NULL,
  payer_purpose          text NOT NULL,          -- ex. 'ORG_FPREST'
  beneficiary_purpose    text NOT NULL,          -- ex. 'OPE_FRAIS'
  basis                  text NOT NULL CHECK (basis IN ('TOPUP_AMOUNT','SALE_AMOUNT','PER_MEDIA','PER_TERMINAL_DAY','PER_REFUND','FIXED','FEE_AMOUNT')),
  rate_bps               int NOT NULL DEFAULT 0, -- 1200 = 12 %
  fixed_amount           bigint NOT NULL DEFAULT 0,
  min_amount             bigint, max_amount bigint,
  tax_code               text,                   -- NULL = hors taxe ; sinon clé dans jurisdiction_profile.rules
  tax_inclusive          boolean NOT NULL DEFAULT true,  -- le montant calculé est TTC
  trigger                text NOT NULL CHECK (trigger IN ('REALTIME','CLOSING')),
  valid_from             timestamptz NOT NULL,
  valid_to               timestamptz,
  version                int NOT NULL DEFAULT 1
);

-- 3. Grand livre ---------------------------------------------------------------
CREATE TABLE ledger (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id     uuid NOT NULL REFERENCES party(id),
  scope_type      text NOT NULL CHECK (scope_type IN ('EVENT','ORGANIZER','OPERATOR_BILLING')),
  scope_id        uuid NOT NULL,
  currency        char(3) NOT NULL,
  issuer_id       uuid NOT NULL REFERENCES party(id),   -- doit les crédits aux festivaliers
  funds_holder_id uuid NOT NULL REFERENCES party(id),   -- titulaire des comptes A-*
  status          text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSING','LOCKED')),
  -- Qui a le droit de DÉBITER les portefeuilles : le serveur central, ou une passerelle locale isolée.
  debit_authority text NOT NULL DEFAULT 'CENTRAL' CHECK (debit_authority IN ('CENTRAL','EDGE')),
  edge_gateway_id uuid,                                  -- passerelle qui détient l'autorité (si EDGE)
  locked_until    timestamptz,                          -- aucune écriture datée avant (période close)
  authority_epoch int NOT NULL DEFAULT 0,               -- +1 à chaque bascule CENTRAL <-> EDGE (voir set_debit_authority)
  late_claims_until timestamptz,                         -- LOCKED : réclamations tardives acceptées jusqu'à cette date (ADR-67)
  UNIQUE (scope_type, scope_id, currency)
);

CREATE TABLE wallet (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id      uuid NOT NULL REFERENCES party(id),
  ledger_id        uuid NOT NULL REFERENCES ledger(id),
  customer_id      uuid REFERENCES party(id),            -- NULL = anonyme
  status           text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','BLOCKED','CLOSED')),
  -- Niveau d'identification : calculé, jamais stocké (wallet_kyc_level, ADR-54)
  last_activity_at timestamptz
);

-- Lots de bracelets : commande, personnalisation et validité par événement.
-- event_id NULL = lot réutilisable, valable pour tous les événements de l'organisateur.
CREATE TABLE media_batch (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id           uuid NOT NULL REFERENCES party(id),
  organizer_id          uuid NOT NULL REFERENCES party(id),
  event_id              uuid REFERENCES event(id),
  kind                  text NOT NULL CHECK (kind IN ('PUBLIC','STAFF','VIP')),   -- bracelets exclusivement cashless (ADR-41)
  quantity              int NOT NULL CHECK (quantity > 0),
  key_index             integer NOT NULL CHECK (key_index BETWEEN 0 AND 65535),
  print_order_ref       text,                              -- référence de la commande d'impression (couleur, logo, numérotation)
  status                text NOT NULL DEFAULT 'ORDERED'
                        CHECK (status IN ('ORDERED','PERSONALIZED','DELIVERED','ACTIVE','SUSPENDED','CLOSED')),
  -- Préchargement : crédits offerts posés sur chaque bracelet du lot à son activation (lots STAFF, VIP…)
  preload_promo_amount  bigint NOT NULL DEFAULT 0 CHECK (preload_promo_amount >= 0),
  -- Caution (option) : 0 = pas de caution. FROM_BALANCE = prélevée sur le solde du portefeuille (mode C) ;
  -- SEPARATE = payée à part, en espèces ou mobile money, et rendue de la même façon (mode D)
  deposit_amount        bigint NOT NULL DEFAULT 0 CHECK (deposit_amount >= 0),
  deposit_mode          text CHECK (deposit_mode IN ('FROM_BALANCE','SEPARATE')),
  -- Option « clé dédiée » : le lot est personnalisé avec une clé maître réservée à son événement,
  -- révocable à la fin de l'événement (voir retire_dedicated_key).
  key_mode              text NOT NULL DEFAULT 'SHARED' CHECK (key_mode IN ('SHARED','DEDICATED')),
  -- Réutilisation : SINGLE_USE (un événement, une personne), PERSONAL (une personne à vie),
  -- POOL (réattribuable à une autre personne après restitution ; identité réécrite à chaque réattribution)
  reuse_policy          text NOT NULL DEFAULT 'SINGLE_USE' CHECK (reuse_policy IN ('SINGLE_USE','PERSONAL','POOL')),
  created_at            timestamptz NOT NULL DEFAULT now(),
  CHECK (key_mode <> 'DEDICATED' OR event_id IS NOT NULL), -- une clé dédiée exige un lot réservé à un événement
  CHECK (key_mode <> 'DEDICATED' OR reuse_policy = 'SINGLE_USE'),  -- clé dédiée : usage unique
  CHECK ((deposit_amount = 0) = (deposit_mode IS NULL))    -- une caution a toujours un mode, et inversement
);

-- Support : MIFARE Ultralight EV1. Le tag ne porte AUCUN montant, seulement une identité opaque.
CREATE TABLE media (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id     uuid NOT NULL REFERENCES party(id),
  kind            text NOT NULL CHECK (kind IN ('NFC_TAG','CARD','QR')),
  chip_type       text NOT NULL DEFAULT 'MF0UL11',       -- MF0UL11 (48 o utilisateur) ou MF0UL21 (128 o)
  token_hash      bytea NOT NULL,                        -- SHA-256 de l'identité opaque de 16 octets (jamais stockée en clair)
  nfc_uid         bytea CHECK (nfc_uid IS NULL OR length(nfc_uid) = 7),  -- UID constructeur, lié à l'identité
  format_major    smallint NOT NULL DEFAULT 1,
  format_minor    smallint NOT NULL DEFAULT 0,
  key_index       integer NOT NULL DEFAULT 1 CHECK (key_index BETWEEN 0 AND 65535),  -- octets 2-3 de la page 4 (format B, big-endian)
  flags           smallint NOT NULL DEFAULT 0 CHECK (flags BETWEEN 0 AND 255),       -- octet 0 de la page 9
  signature_ok    boolean,                               -- signature d'originalité NXP vérifiée à la personnalisation
  originality_sig_sha256 bytea CHECK (octet_length(originality_sig_sha256) = 32),  -- SHA-256 de la signature lue à la personnalisation (ADR-59)
  wallet_id       uuid REFERENCES wallet(id),
  batch_id        uuid REFERENCES media_batch(id),       -- lot d'origine (validité par événement, préchargement)
  -- Caution du détenteur actuel : NONE, DUE (à prélever), HELD (détenue), puis REFUNDED ou FORFEITED
  deposit_status  text NOT NULL DEFAULT 'NONE' CHECK (deposit_status IN ('NONE','DUE','HELD','REFUNDED','FORFEITED')),
  deposit_held    bigint NOT NULL DEFAULT 0 CHECK (deposit_held >= 0),
  -- Cycle de vie : PERSONALIZED (en stock) -> ISSUED (remis) -> ACTIVE (rattaché à un portefeuille)
  --   -> SUSPENDED / REPLACED / BLACKLISTED / RELEASED (rendu) -> RETIRED / DESTROYED. Passages contrôlés par trigger.
  status          text NOT NULL DEFAULT 'PERSONALIZED'
                  CHECK (status IN ('PERSONALIZED','ISSUED','ACTIVE','SUSPENDED','REPLACED','BLACKLISTED','RELEASED','RETIRED','DESTROYED')),
  last_counter    bigint,                                -- plus grande valeur du compteur NFC vue
  personalized_at timestamptz,
  -- PWD||PACK dérivés une seule fois à la personnalisation, stockés chiffrés (chiffrement enveloppe) :
  -- nonce (12 o) || AES-256-GCM(PWD||PACK, 6 o) || tag GCM (16 o) = 34 octets.
  -- AAD = "CASHLESS/PWDPACK/v1" || media.id || operator_id || key_index (2 o) || nfc_uid  (lie le secret à CE bracelet)
  pwd_pack_enc    bytea CHECK (pwd_pack_enc IS NULL OR length(pwd_pack_enc) = 34),
  pwd_pack_dek_id uuid,                                  -- clé de données ayant chiffré pwd_pack_enc
  CHECK ((pwd_pack_enc IS NULL) = (pwd_pack_dek_id IS NULL)),
  CHECK (kind <> 'NFC_TAG' OR personalized_at IS NULL OR status IN ('RETIRED','REPLACED','DESTROYED') OR pwd_pack_enc IS NOT NULL),
  UNIQUE (operator_id, token_hash),
  UNIQUE (operator_id, nfc_uid)
);

-- Clés maîtres de diversification (clé HMAC_256 AWS KMS, une par prestataire et par index).
-- La clé ne sort jamais du KMS. PWD/PACK d'un tag = KDF NIST SP 800-108 en mode compteur (PRF HMAC-SHA256) :
--   GenerateMac(message = 00000001 || "CASHLESS/UL-EV1/PWD/v1" || 00 || operator_id || key_index (2 o) || UID || 00000030)
--   -> 6 premiers octets : 4 PWD + 2 PACK.
CREATE TABLE tag_key (
  operator_id  uuid NOT NULL REFERENCES party(id),
  key_index    integer NOT NULL CHECK (key_index BETWEEN 0 AND 65535),
  kms_key_ref  text NOT NULL,                             -- ex. arn / nom de clé HSM
  status       text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','DECRYPT_ONLY','RETIRED')),
  -- SHARED : clé commune aux lots du prestataire ; DEDICATED : clé réservée à UN événement (option par lot)
  scope        text NOT NULL DEFAULT 'SHARED' CHECK (scope IN ('SHARED','DEDICATED')),
  dedicated_event_id uuid REFERENCES event(id),
  kms_disabled_at    timestamptz,                         -- clé désactivée dans KMS après retrait
  created_at   timestamptz NOT NULL DEFAULT now(),
  CHECK ((scope = 'DEDICATED') = (dedicated_event_id IS NOT NULL)),
  PRIMARY KEY (operator_id, key_index)
);

-- Clés de données (DEK) qui chiffrent les PWD||PACK stockés. Une par prestataire, index de clé et version.
-- La DEK est générée par KMS GenerateDataKey (AES-256) sous une clé KMS de chiffrement symétrique DISTINCTE
-- de la clé HMAC de dérivation. Seule sa forme chiffrée est stockée ; elle n'existe en clair qu'en mémoire,
-- le temps de chiffrer à la personnalisation ou de construire un snapshot (1 seul appel KMS Decrypt).
CREATE TABLE tag_data_key (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id           uuid NOT NULL REFERENCES party(id),
  key_index             integer NOT NULL CHECK (key_index BETWEEN 0 AND 65535),
  version               int NOT NULL,
  wrapping_kms_key_ref  text NOT NULL,                  -- clé KMS SYMMETRIC_DEFAULT qui chiffre la DEK
  encrypted_dek         bytea NOT NULL,                 -- CiphertextBlob renvoyé par GenerateDataKey
  status                text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','DECRYPT_ONLY','RETIRED')),
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (operator_id, key_index, version),
  FOREIGN KEY (operator_id, key_index) REFERENCES tag_key(operator_id, key_index)
);
-- Une seule DEK active par (prestataire, index)
CREATE UNIQUE INDEX tag_data_key_one_active ON tag_data_key (operator_id, key_index) WHERE status = 'ACTIVE';

ALTER TABLE media ADD CONSTRAINT media_pwd_pack_dek_fk FOREIGN KEY (pwd_pack_dek_id) REFERENCES tag_data_key(id);

-- Journal des passages (un par transaction qui a lu le tag) : sert à détecter les clones.
-- Chaque passage incrémente le compteur 24 bits du tag (INCR_CNT) : deux passages avec la même valeur = deux puces.
CREATE TABLE media_tap (
  id             bigserial PRIMARY KEY,
  operator_id    uuid NOT NULL REFERENCES party(id),
  media_id       uuid NOT NULL REFERENCES media(id),
  counter        bigint NOT NULL CHECK (counter BETWEEN 0 AND 16777215),
  nfc_uid        bytea NOT NULL,
  occurred_at    timestamptz NOT NULL,
  device_id      uuid REFERENCES device(id),
  mode           text NOT NULL CHECK (mode IN ('ONLINE','OFFLINE')),
  transaction_id uuid,
  received_at    timestamptz NOT NULL DEFAULT clock_timestamp(),   -- heure de réception au serveur (délai de renvoi)
  UNIQUE (media_id, counter)
);
CREATE INDEX ON media_tap (media_id, occurred_at);

-- Snapshots envoyés aux terminaux pour autoriser hors ligne (signés par le serveur)
-- En-tête complet et contrôles : section 18 (trigger check_offline_snapshot).
CREATE TABLE offline_snapshot (
  id            bigserial PRIMARY KEY,
  operator_id   uuid NOT NULL REFERENCES party(id),
  ledger_id     uuid NOT NULL REFERENCES ledger(id),
  event_id      uuid NOT NULL REFERENCES event(id),
  kind          text NOT NULL CHECK (kind IN ('FULL','DELTA')),
  version       bigint NOT NULL CHECK (version >= 1),
  base_version  bigint,                                  -- DELTA : version à laquelle il s'applique
  generated_at  timestamptz NOT NULL DEFAULT now(),
  valid_until   timestamptz NOT NULL,
  entries       int NOT NULL,
  content_sha256 bytea NOT NULL CHECK (octet_length(content_sha256) = 32),
  authority_epoch int NOT NULL,
  key_id        text NOT NULL,                           -- clé de signature (snapshot_signing_key)
  header        jsonb NOT NULL,                          -- en-tête signé, tel qu'envoyé (SnapshotHeader)
  signature     bytea NOT NULL,                          -- signature de JCS(header) par la clé key_id
  UNIQUE (ledger_id, version),
  CHECK ((kind = 'DELTA') = (base_version IS NOT NULL)),
  CHECK (base_version IS NULL OR base_version < version),
  CHECK (valid_until > generated_at)
);

CREATE TYPE account_family AS ENUM ('ASSET','CLAIM','SUSPENSE');

CREATE TABLE account (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id      uuid NOT NULL REFERENCES party(id),
  ledger_id        uuid NOT NULL REFERENCES ledger(id),
  code             text NOT NULL,                        -- ex. L-WAL-<id>-P
  family           account_family NOT NULL,
  purpose          text NOT NULL,                        -- PSP, BANK, WALLET_PAID, MERCHANT, ORG_COM, ORG_TAX, PAYOUT_PENDING...
  owner_party_id   uuid REFERENCES party(id),
  wallet_id        uuid REFERENCES wallet(id),
  participation_id uuid REFERENCES merchant_participation(id),
  normal_side      char(1) NOT NULL CHECK (normal_side IN ('D','C')),
  allow_negative   boolean NOT NULL DEFAULT false,       -- solde du côté opposé autorisé ?
  is_active        boolean NOT NULL DEFAULT true,
  -- Compte "chaud" (commission, taxe, PSP : touché par presque toutes les transactions) :
  -- pas de solde en cache ni de verrou, sinon toutes les ventes s'attendent sur la même ligne.
  -- Son solde se calcule à la lecture ; interdit si le compte ne doit jamais changer de côté.
  hot              boolean NOT NULL DEFAULT false,
  CHECK (NOT hot OR allow_negative OR family = 'ASSET' OR purpose LIKE 'ORG_%' OR purpose LIKE 'OPE_%' OR purpose LIKE 'PLT_%'),
  CHECK (NOT (hot AND purpose IN ('WALLET_PAID','WALLET_PROMO'))),
  UNIQUE (ledger_id, code),
  UNIQUE (ledger_id, id)
);

-- Comptes commerçants chauds par défaut (ADR-62) : aucune attente entre ventes simultanées d'un même stand.
-- Un compte MERCHANT peut être passé froid ensuite par UPDATE (décision explicite).
CREATE FUNCTION merchant_account_hot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- un compte chaud n'a pas de contrôle de sens en ligne : il doit accepter le côté opposé (contrainte du compte)
  IF NEW.purpose = 'MERCHANT' THEN NEW.hot := true; NEW.allow_negative := true; END IF;
  -- Comptes de casse : une annulation de casse après versement les rend débiteurs (le bénéficiaire doit rembourser, ADR-67)
  IF NEW.purpose IN ('ORG_CASSE','OPE_CASSE','LEGAL_BREAKAGE') THEN NEW.allow_negative := true; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER account_merchant_hot BEFORE INSERT ON account FOR EACH ROW EXECUTE FUNCTION merchant_account_hot();

-- Passage chaud <-> froid (revue 2, DB-I8) : un compte chaud n'a pas de solde en cache. En devenant froid, son
-- cache est recalculé depuis les lignes ; en devenant chaud, le cache périmé est supprimé.
CREATE FUNCTION account_hot_switch() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.hot AND NOT OLD.hot THEN
    DELETE FROM account_balance WHERE account_id = NEW.id;
  ELSIF OLD.hot AND NOT NEW.hot THEN
    INSERT INTO account_balance (account_id, operator_id, balance, last_posting_id)
    SELECT NEW.id, NEW.operator_id, coalesce(sum(amount), 0), coalesce(max(id), 0) FROM posting WHERE account_id = NEW.id
    ON CONFLICT (account_id) DO UPDATE SET balance = EXCLUDED.balance, last_posting_id = EXCLUDED.last_posting_id;
  END IF;
  RETURN NEW;
END $$;

CREATE TABLE journal_transaction (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id       uuid NOT NULL REFERENCES party(id),
  ledger_id         uuid NOT NULL REFERENCES ledger(id),
  event_id          uuid REFERENCES event(id),          -- dimension d'analyse, indispensable si wallet_scope = ORGANIZER
  type              text NOT NULL CHECK (type IN (         -- liste fermée : voir SPECIFICATION.md, « Types de transaction »
                      'TOPUP','TOPUP_CASH','PROMO_CREDIT','PROMO_EXPIRY','ACTIVATION_FEE',
                      'DEPOSIT_TAKEN','DEPOSIT_REFUNDED','DEPOSIT_FORFEITED','PURCHASE','REVERSAL',
                      'PITCH_FEE','OPERATOR_FEE','PLATFORM_FEE','ANOMALY_RESOLUTION','CASH_CLOSE',
                      'CASH_DEPOSIT','PSP_SETTLEMENT','CHARGEBACK','WALLET_REFUND','BREAKAGE',
                      'PAYOUT_INITIATED','PAYOUT_CONFIRMED','PAYOUT_FAILED','ADJUSTMENT',
                      'MERCHANT_DEBT_TRANSFER','BREAKAGE_REVERSAL')),
  idempotency_key   text NOT NULL,                      -- ex. device_serial:seq, id PSP
  request_hash      text NOT NULL,                      -- empreinte du contenu : une clé rejouée avec un autre contenu est refusée
  occurred_at       timestamptz NOT NULL,               -- heure réelle (terminal)
  recorded_at       timestamptz NOT NULL DEFAULT clock_timestamp(),
  source            text NOT NULL CHECK (source IN ('ONLINE','OFFLINE_SYNC','EDGE_SYNC','PSP_WEBHOOK','BATCH','BACKOFFICE')),
  device_id         uuid REFERENCES device(id),
  media_id          uuid REFERENCES media(id),
  reverses_id       uuid REFERENCES journal_transaction(id),
  config_version_id uuid REFERENCES config_version(id),
  created_by        uuid,
  approved_by       uuid,                               -- saisie manuelle : validation par une 2e personne
  metadata          jsonb NOT NULL DEFAULT '{}',
  UNIQUE (ledger_id, idempotency_key),
  UNIQUE (ledger_id, id),
  CHECK (source <> 'BACKOFFICE' OR (created_by IS NOT NULL AND approved_by IS NOT NULL AND approved_by <> created_by)),
  CHECK ((type = 'REVERSAL') = (reverses_id IS NOT NULL)),           -- une contre-passation désigne toujours l'original
  CHECK (type NOT IN ('ADJUSTMENT','ANOMALY_RESOLUTION','BREAKAGE_REVERSAL') OR source = 'BACKOFFICE')   -- manuelle et validée à deux
);
CREATE INDEX ON journal_transaction (ledger_id, occurred_at);
CREATE INDEX ON journal_transaction (event_id, type);

CREATE TABLE posting (
  id              bigserial PRIMARY KEY,
  operator_id     uuid NOT NULL,
  ledger_id       uuid NOT NULL,
  transaction_id  uuid NOT NULL,
  line_no         smallint NOT NULL,
  account_id      uuid NOT NULL,
  amount          bigint NOT NULL CHECK (amount <> 0),  -- + débit / - crédit
  fee_rule_id     uuid REFERENCES fee_rule(id),
  memo            text,
  UNIQUE (transaction_id, line_no),
  -- les clés composites garantissent que compte et transaction sont dans le même grand livre
  FOREIGN KEY (ledger_id, transaction_id) REFERENCES journal_transaction(ledger_id, id),
  FOREIGN KEY (ledger_id, account_id)     REFERENCES account(ledger_id, id)
);
CREATE INDEX ON posting (account_id, id);

CREATE TABLE account_balance (
  account_id       uuid PRIMARY KEY REFERENCES account(id),
  operator_id      uuid NOT NULL,
  balance          bigint NOT NULL DEFAULT 0,           -- somme signée des lignes
  last_posting_id  bigint NOT NULL DEFAULT 0
);
CREATE TRIGGER account_hot_switch AFTER UPDATE OF hot ON account FOR EACH ROW EXECUTE FUNCTION account_hot_switch();

-- 4. Invariants ----------------------------------------------------------------
-- 4a. Immuabilité
CREATE FUNCTION forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Table % en ajout seul : utiliser une contre-passation', TG_TABLE_NAME; END $$;
CREATE TRIGGER posting_immutable BEFORE UPDATE OR DELETE ON posting
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER tx_immutable BEFORE UPDATE OR DELETE ON journal_transaction
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- 4b. Filet de sécurité : transaction équilibrée au COMMIT, même en cas d'écriture hors fonction
CREATE FUNCTION check_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s bigint; n int;
BEGIN
  SELECT coalesce(sum(amount),0), count(*) INTO s, n FROM posting WHERE transaction_id = NEW.transaction_id;
  IF s <> 0 OR n < 2 THEN
    RAISE EXCEPTION 'Transaction % déséquilibrée (somme %, % lignes)', NEW.transaction_id, s, n USING ERRCODE = 'CL001';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER posting_balanced AFTER INSERT ON posting
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_balanced();

-- 4c. Point d'entrée unique du grand livre
--   p_lines : [{"account_id":..., "amount": +débit/-crédit, "memo":..., "fee_rule_id":...}, ...]
CREATE FUNCTION post_transaction(p_ledger uuid, p_type text, p_key text, p_occurred timestamptz,
                                 p_source text, p_lines jsonb, p_event uuid DEFAULT NULL,
                                 p_reverses uuid DEFAULT NULL, p_created_by uuid DEFAULT NULL,
                                 p_approved_by uuid DEFAULT NULL, p_config_version uuid DEFAULT NULL,
                                 p_device uuid DEFAULT NULL, p_media uuid DEFAULT NULL,
                                 p_metadata jsonb DEFAULT '{}')
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
-- Codes SQLSTATE propres (traduits un à un en ProblemCode par l'API, voir SPECIFICATION §5.7) :
--   CL001 VALIDATION_FAILED   CL002 IDEMPOTENCY_KEY_REUSED   CL003 LEDGER_LOCKED   CL004 EVENT_CLOSING
--   CL005 PERIOD_CLOSED       CL006 DEBIT_AUTHORITY_EDGE     CL007 INSUFFICIENT_FUNDS
--   CL008 WALLET_LIMIT_EXCEEDED (check_wallet_limits)        CL009 MONTHLY_TOPUP_LIMIT_EXCEEDED
DECLARE
  tx uuid; lg ledger%ROWTYPE; h text; existing_hash text;
  n int; s bigint; bad text; r record;
BEGIN
  PERFORM assert_tenant(tenant_of_ledger(p_ledger));   -- cloisonnement : l'objet doit appartenir au prestataire de la session
  -- 1. Validation du contenu (avant tout verrou)
  SELECT count(*), coalesce(sum((l->>'amount')::bigint),0),
         bool_or((l->>'amount')::bigint = 0)::text
    INTO n, s, bad FROM jsonb_array_elements(p_lines) l;
  IF n < 2 OR s <> 0 OR bad = 'true' THEN
    RAISE EXCEPTION 'Lignes invalides : % lignes, somme %, montant nul : %', n, s, bad USING ERRCODE = 'CL001';
  END IF;
  -- Empreinte de la requête (revue 2, M7) : tout ce qui change le sens de l'écriture, pas seulement les lignes
  h := encode(sha256(convert_to(concat_ws('|', p_type, p_event, p_reverses, p_device, p_media, p_lines::text), 'UTF8')), 'hex');
  -- Verrou PARTAGÉ d'autorité de débit (en mémoire, compatible entre écritures concurrentes) :
  -- une bascule CENTRAL <-> EDGE (verrou exclusif) attend la fin des écritures en vol, et aucune ne démarre pendant.
  PERFORM pg_advisory_xact_lock_shared(hashtextextended('debit-authority:' || p_ledger, 0));

  -- 2. Idempotence, sûre en concurrence
  SELECT * INTO lg FROM ledger WHERE id = p_ledger;
  IF NOT FOUND THEN RAISE EXCEPTION 'Grand livre inconnu' USING ERRCODE = 'no_data_found'; END IF;
  INSERT INTO journal_transaction (operator_id, ledger_id, event_id, type, idempotency_key, request_hash,
                                   occurred_at, source, reverses_id, created_by, approved_by,
                                   config_version_id, device_id, media_id, metadata)
       VALUES (lg.operator_id, p_ledger, p_event, p_type, p_key, h,
               p_occurred, p_source, p_reverses, p_created_by, p_approved_by,
               p_config_version, p_device, p_media, coalesce(p_metadata, '{}'))
  ON CONFLICT (ledger_id, idempotency_key) DO NOTHING
  RETURNING id INTO tx;
  IF tx IS NULL THEN
    SELECT id, request_hash INTO tx, existing_hash
      FROM journal_transaction WHERE ledger_id = p_ledger AND idempotency_key = p_key;
    IF existing_hash <> h THEN
      RAISE EXCEPTION 'Clé % déjà utilisée avec un contenu différent', p_key USING ERRCODE = 'CL002';
    END IF;
    RETURN tx;                                      -- rejeu identique : on renvoie l'existant
  END IF;

  -- 3. État du grand livre et période
  -- Grand livre verrouillé : seules les réclamations tardives (casse réversible, ADR-67) sont acceptées, en
  -- back-office, jusqu'à late_claims_until : annulation de casse, apport du bénéficiaire, remboursement.
  IF lg.status = 'LOCKED' AND NOT (p_source = 'BACKOFFICE' AND p_type IN ('BREAKAGE_REVERSAL','ADJUSTMENT','WALLET_REFUND','CHARGEBACK')
                                   AND lg.late_claims_until IS NOT NULL AND clock_timestamp() <= lg.late_claims_until) THEN
    RAISE EXCEPTION 'Grand livre verrouillé' USING ERRCODE = 'CL003';
  END IF;
  IF lg.status = 'CLOSING' AND p_source = 'ONLINE' AND p_type IN ('TOPUP','TOPUP_CASH','PURCHASE') THEN
    RAISE EXCEPTION 'Événement en clôture : % refusé', p_type USING ERRCODE = 'CL004';
  END IF;
  IF lg.locked_until IS NOT NULL AND p_occurred <= lg.locked_until THEN
    RAISE EXCEPTION 'Période close jusqu''au %', lg.locked_until USING ERRCODE = 'CL005';
  END IF;
  -- Passerelle locale isolée : elle seule débite les portefeuilles ; le central n'accepte que les crédits
  IF lg.debit_authority = 'EDGE' AND p_source <> 'EDGE_SYNC' AND EXISTS (
       SELECT 1 FROM jsonb_array_elements(p_lines) l JOIN account a ON a.id = (l->>'account_id')::uuid
        WHERE (l->>'amount')::bigint > 0 AND a.purpose IN ('WALLET_PAID','WALLET_PROMO')) THEN
    RAISE EXCEPTION 'Débit de portefeuille refusé : autorité détenue par la passerelle locale' USING ERRCODE = 'CL006';
  END IF;

  -- 3b. Tous les comptes doivent appartenir au grand livre et être actifs
  SELECT string_agg(l->>'account_id', ', ') INTO bad
    FROM jsonb_array_elements(p_lines) l
    LEFT JOIN account a ON a.id = (l->>'account_id')::uuid AND a.ledger_id = p_ledger AND a.is_active
   WHERE a.id IS NULL;
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'Compte inconnu, inactif ou d''un autre grand livre : %', bad USING ERRCODE = 'CL001'; END IF;

  -- 3c. Annulation de casse et réclamations tardives : bornes (ADR-75, Q4). CL024 LATE_CLAIM_INVALID.
  IF p_type = 'BREAKAGE_REVERSAL' OR (lg.status = 'LOCKED' AND p_type IN ('ADJUSTMENT','WALLET_REFUND','CHARGEBACK')) THEN
    PERFORM check_late_claim(lg, p_type, p_lines);
  END IF;

  -- 4. Verrouillage des soldes dans un ordre stable (évite les interblocages)
  --    (les comptes "hot" sont exclus : ni cache, ni verrou)
  INSERT INTO account_balance (account_id, operator_id)
       SELECT DISTINCT a.id, lg.operator_id
         FROM jsonb_array_elements(p_lines) l JOIN account a ON a.id = (l->>'account_id')::uuid
        WHERE NOT a.hot
  ON CONFLICT (account_id) DO NOTHING;
  PERFORM 1 FROM account_balance
    WHERE account_id IN (SELECT (l->>'account_id')::uuid FROM jsonb_array_elements(p_lines) l)
    ORDER BY account_id FOR UPDATE;

  -- 5. Lignes, dans l'ordre fourni
  INSERT INTO posting (operator_id, ledger_id, transaction_id, line_no, account_id, amount, fee_rule_id, memo)
       SELECT lg.operator_id, p_ledger, tx, ord, (l->>'account_id')::uuid, (l->>'amount')::bigint,
              (l->>'fee_rule_id')::uuid, l->>'memo'
         FROM jsonb_array_elements(p_lines) WITH ORDINALITY AS t(l, ord);

  -- 6. Soldes en cache mis à jour par compte (montant agrégé) puis contrôle du sens
  FOR r IN
    WITH d AS (SELECT account_id, sum(amount) AS delta, max(id) AS last_id
                 FROM posting WHERE transaction_id = tx GROUP BY account_id)
    UPDATE account_balance ab SET balance = ab.balance + d.delta, last_posting_id = d.last_id
      FROM d WHERE ab.account_id = d.account_id
    RETURNING ab.account_id, ab.balance
  LOOP
    PERFORM 1 FROM account a
      WHERE a.id = r.account_id
        AND (a.allow_negative OR (a.normal_side = 'D' AND r.balance >= 0) OR (a.normal_side = 'C' AND r.balance <= 0));
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Solde interdit sur % (solde %)',
        (SELECT code FROM account WHERE id = r.account_id), r.balance USING ERRCODE = 'CL007';
    END IF;
  END LOOP;
  -- 7. Plafonds réglementaires sur les portefeuilles crédités (profil de législation du grand livre)
  PERFORM check_wallet_limits(p_ledger, tx, p_type, p_occurred);
  RETURN tx;
END $$;

-- Bornes des réclamations tardives (ADR-75, Q4), appelée par post_transaction avant toute écriture.
--  * BREAKAGE_REVERSAL (tout statut) : crédite UN portefeuille (WALLET_PAID) et débite seulement des comptes de
--    casse ; il faut une casse antérieure sur ce portefeuille ; le total annulé ne dépasse jamais la casse prise ;
--    chaque compte de casse est débité dans la proportion de la casse d'origine, à 1 unité près (arrondis).
--  * ADJUSTMENT sur grand livre LOCKED : seulement l'apport d'un bénéficiaire (débit d'un compte d'argent, crédit
--    de son compte de casse), au plus ce qui a été annulé sur ce compte de casse depuis le verrouillage.
--  * CHARGEBACK sur grand livre LOCKED (ADR-77) : compte PSP crédité, portefeuille et/ou compte de pertes débités ;
--    l'apport du payeur (ADJUSTMENT) ne dépasse pas ce qui a été débité sur son compte de pertes depuis le verrouillage.
--  * WALLET_REFUND sur grand livre LOCKED : seulement portefeuille (débit) vers compte d'argent (crédit) ; le
--    solde du portefeuille borne le montant (contrôle de sens habituel).
CREATE FUNCTION check_late_claim(lg ledger, p_type text, p_lines jsonb) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE casse text[] := ARRAY['ORG_CASSE','OPE_CASSE','LEGAL_BREAKAGE']; nw int; nbad int; wacc uuid; r bigint;
        taken bigint; rev bigint; tot bigint; c record;
BEGIN
  IF p_type = 'BREAKAGE_REVERSAL' THEN
    SELECT count(*) FILTER (WHERE x.purpose = 'WALLET_PAID' AND x.amt < 0),
           count(*) FILTER (WHERE NOT ((x.purpose = 'WALLET_PAID' AND x.amt < 0) OR (x.purpose = ANY (casse) AND x.amt > 0))),
           (array_agg(x.id) FILTER (WHERE x.purpose = 'WALLET_PAID' AND x.amt < 0))[1],
           coalesce(-sum(x.amt) FILTER (WHERE x.purpose = 'WALLET_PAID'), 0)
      INTO nw, nbad, wacc, r
      FROM (SELECT a.id, a.purpose, sum((l->>'amount')::bigint) AS amt
              FROM jsonb_array_elements(p_lines) l JOIN account a ON a.id = (l->>'account_id')::uuid
             GROUP BY a.id, a.purpose) x;
    IF nw <> 1 OR nbad > 0 THEN
      RAISE EXCEPTION 'Annulation de casse : un portefeuille crédité, des comptes de casse débités, rien d''autre'
        USING ERRCODE = 'CL024';
    END IF;
    -- casse prise sur ce portefeuille, et déjà annulée
    SELECT coalesce(sum(p.amount) FILTER (WHERE t.type = 'BREAKAGE' AND p.amount > 0), 0),
           coalesce(-sum(p.amount) FILTER (WHERE t.type = 'BREAKAGE_REVERSAL'), 0)
      INTO taken, rev
      FROM posting p JOIN journal_transaction t ON t.id = p.transaction_id WHERE p.account_id = wacc;
    IF taken = 0 OR rev + r > taken THEN
      RAISE EXCEPTION 'Annulation de casse de % : casse prise %, déjà annulée %', r, taken, rev USING ERRCODE = 'CL024';
    END IF;
    -- proportions de la casse d'origine (transactions BREAKAGE qui ont débité ce portefeuille)
    SELECT -sum(p.amount) INTO tot FROM posting p JOIN account a ON a.id = p.account_id AND a.purpose = ANY (casse)
     WHERE p.amount < 0 AND p.transaction_id IN (SELECT p2.transaction_id FROM posting p2 JOIN journal_transaction t2
                                                  ON t2.id = p2.transaction_id AND t2.type = 'BREAKAGE' WHERE p2.account_id = wacc);
    FOR c IN
      WITH orig AS (SELECT p.account_id, -sum(p.amount) AS credit FROM posting p
                      JOIN account a ON a.id = p.account_id AND a.purpose = ANY (casse)
                     WHERE p.amount < 0 AND p.transaction_id IN (SELECT p2.transaction_id FROM posting p2
                             JOIN journal_transaction t2 ON t2.id = p2.transaction_id AND t2.type = 'BREAKAGE'
                            WHERE p2.account_id = wacc)
                     GROUP BY p.account_id),
           cur AS (SELECT (l->>'account_id')::uuid AS account_id, sum((l->>'amount')::bigint) AS debit
                     FROM jsonb_array_elements(p_lines) l GROUP BY 1)
      SELECT coalesce(o.account_id, cu.account_id) AS account_id, coalesce(o.credit, 0) AS credit, coalesce(cu.debit, 0) AS debit
        FROM orig o FULL JOIN (SELECT * FROM cur WHERE account_id <> wacc) cu ON cu.account_id = o.account_id
    LOOP
      IF abs(c.debit - round(r::numeric * c.credit / nullif(tot, 0))) > 1 THEN
        RAISE EXCEPTION 'Annulation de casse : répartition différente de la casse d''origine (compte %)', c.account_id
          USING ERRCODE = 'CL024';
      END IF;
    END LOOP;
  ELSIF p_type = 'ADJUSTMENT' THEN                          -- grand livre LOCKED
    -- apport d'un bénéficiaire de la casse (ADR-75) ou de la partie qui supporte une contestation tardive (ADR-77)
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_lines) l JOIN account a ON a.id = (l->>'account_id')::uuid
                WHERE NOT ((a.family = 'ASSET' AND (l->>'amount')::bigint > 0)
                           OR (a.purpose = ANY (casse || ARRAY['ORG_PERTES','OPE_PERTES']) AND (l->>'amount')::bigint < 0))) THEN
      RAISE EXCEPTION 'Grand livre verrouillé : un ajustement ne sert qu''à l''apport d''un bénéficiaire de la casse ou du payeur d''une contestation'
        USING ERRCODE = 'CL024';
    END IF;
    FOR c IN SELECT (l->>'account_id')::uuid AS account_id, -sum((l->>'amount')::bigint) AS credit, a.purpose
               FROM jsonb_array_elements(p_lines) l JOIN account a ON a.id = (l->>'account_id')::uuid
              WHERE a.purpose = ANY (casse || ARRAY['ORG_PERTES','OPE_PERTES']) GROUP BY 1, 3 LOOP
      IF c.credit + coalesce((SELECT -sum(p.amount) FROM posting p JOIN journal_transaction t ON t.id = p.transaction_id
                               WHERE p.account_id = c.account_id AND t.type = 'ADJUSTMENT' AND t.recorded_at > lg.locked_until), 0)
         > coalesce((SELECT sum(p.amount) FROM posting p JOIN journal_transaction t ON t.id = p.transaction_id
                      WHERE p.account_id = c.account_id
                        AND t.type = CASE WHEN c.purpose = ANY (casse) THEN 'BREAKAGE_REVERSAL' ELSE 'CHARGEBACK' END
                        AND (c.purpose = ANY (casse) OR t.recorded_at > lg.locked_until)), 0) THEN
        RAISE EXCEPTION 'Apport supérieur à ce qui a été débité après le verrouillage sur le compte %', c.account_id USING ERRCODE = 'CL024';
      END IF;
    END LOOP;
  ELSIF p_type = 'CHARGEBACK' THEN                          -- grand livre LOCKED (ADR-77)
    -- crédit d'un compte PSP ; débit du portefeuille (dans la limite de son solde, contrôle de sens habituel) et/ou
    -- du compte de pertes de la partie qui supporte les contestations ; rien d'autre
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_lines) l JOIN account a ON a.id = (l->>'account_id')::uuid
                WHERE NOT ((a.family = 'ASSET' AND a.purpose = 'PSP' AND (l->>'amount')::bigint < 0)
                           OR (a.purpose IN ('WALLET_PAID','ORG_PERTES','OPE_PERTES') AND (l->>'amount')::bigint > 0))) THEN
      RAISE EXCEPTION 'Contestation tardive : compte PSP crédité, portefeuille ou compte de pertes débités, rien d''autre'
        USING ERRCODE = 'CL024';
    END IF;
  ELSIF p_type = 'WALLET_REFUND' THEN                       -- grand livre LOCKED
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_lines) l JOIN account a ON a.id = (l->>'account_id')::uuid
                WHERE NOT ((a.purpose = 'WALLET_PAID' AND (l->>'amount')::bigint > 0)
                           OR (a.family = 'ASSET' AND (l->>'amount')::bigint < 0))) THEN
      RAISE EXCEPTION 'Grand livre verrouillé : remboursement d''un portefeuille vers un compte d''argent seulement'
        USING ERRCODE = 'CL024';
    END IF;
  END IF;
END $$;

-- 4d. Passerelle locale (optionnelle) --------------------------------------------
CREATE TABLE edge_gateway (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id  uuid NOT NULL REFERENCES party(id),
  event_id     uuid NOT NULL REFERENCES event(id),
  serial       text NOT NULL UNIQUE,
  role         text NOT NULL DEFAULT 'PRIMARY' CHECK (role IN ('PRIMARY','STANDBY')),
  public_key   bytea,
  status       text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ISOLATED','CATCHING_UP','REVOKED')),
  last_replicated_posting_id bigint,                      -- dernière ligne centrale reçue
  last_seen_at timestamptz,
  -- Numérotation des décisions de la passerelle (sync_protocol §9.5) : tenue par record_edge_seq
  contiguous_edge_seq bigint NOT NULL DEFAULT 0,
  last_chain_hash bytea CHECK (octet_length(last_chain_hash) = 32),   -- NULL : départ
  agreement_public_key bytea CHECK (octet_length(agreement_public_key) = 65),  -- ECDH P-256
  cert_sha256  bytea CHECK (octet_length(cert_sha256) = 32),
  lan_url      text                                        -- URL servie aux terminaux sur le réseau local
);

-- 4e. Politique hors ligne, configurable par l'organisateur -------------------------
-- Portées : ORGANIZER (règle générale), EVENT, DEVICE (un terminal de point de vente ou de recharge).
-- Un champ NULL = hérite du niveau au-dessus. OPERATOR_CEILING = plafonds maximaux imposés par le prestataire.
CREATE TABLE offline_policy (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id               uuid NOT NULL REFERENCES party(id),
  scope_type                text NOT NULL CHECK (scope_type IN ('OPERATOR_CEILING','ORGANIZER','EVENT','DEVICE')),
  scope_id                  uuid NOT NULL,
  offline_enabled           boolean,
  max_per_sale              bigint CHECK (max_per_sale >= 0),
  max_per_media_per_device  bigint CHECK (max_per_media_per_device >= 0),
  max_total_per_device      bigint CHECK (max_total_per_device >= 0),   -- exposition totale d'un terminal isolé
  max_snapshot_age          interval,
  cash_topup_offline        boolean,
  updated_by                uuid,
  updated_at                timestamptz NOT NULL DEFAULT now(),
  version                   int NOT NULL DEFAULT 1,       -- +1 à chaque modification (historique : offline_policy_history)
  UNIQUE (scope_type, scope_id)
);

-- Politique effective d'un terminal : DEVICE > EVENT > ORGANIZER > valeurs par défaut,
-- puis bornée par le plafond du prestataire. Par défaut, le hors ligne est DÉSACTIVÉ.
CREATE FUNCTION effective_offline_policy(p_device uuid)
RETURNS TABLE (offline_enabled boolean, max_per_sale bigint, max_per_media_per_device bigint,
               max_total_per_device bigint, max_snapshot_age interval, cash_topup_offline boolean,
               capped boolean)
LANGUAGE sql STABLE AS $$
  WITH d AS (SELECT dv.id, dv.operator_id, dv.event_id, e.organizer_id
               FROM device dv JOIN event e ON e.id = dv.event_id WHERE dv.id = p_device),
  lv AS (
    SELECT p.*, CASE p.scope_type WHEN 'DEVICE' THEN 1 WHEN 'EVENT' THEN 2 WHEN 'ORGANIZER' THEN 3 END AS prio
      FROM offline_policy p, d
     WHERE (p.scope_type = 'DEVICE' AND p.scope_id = d.id)
        OR (p.scope_type = 'EVENT' AND p.scope_id = d.event_id)
        OR (p.scope_type = 'ORGANIZER' AND p.scope_id = d.organizer_id)),
  pick AS (
    SELECT
      coalesce((SELECT offline_enabled FROM lv WHERE offline_enabled IS NOT NULL ORDER BY prio LIMIT 1), false) AS en,
      coalesce((SELECT max_per_sale FROM lv WHERE max_per_sale IS NOT NULL ORDER BY prio LIMIT 1), 0) AS ps,
      coalesce((SELECT max_per_media_per_device FROM lv WHERE max_per_media_per_device IS NOT NULL ORDER BY prio LIMIT 1), 0) AS pm,
      coalesce((SELECT max_total_per_device FROM lv WHERE max_total_per_device IS NOT NULL ORDER BY prio LIMIT 1), 0) AS pt,
      coalesce((SELECT max_snapshot_age FROM lv WHERE max_snapshot_age IS NOT NULL ORDER BY prio LIMIT 1), interval '15 minutes') AS age,
      coalesce((SELECT cash_topup_offline FROM lv WHERE cash_topup_offline IS NOT NULL ORDER BY prio LIMIT 1), false) AS cash),
  cap AS (SELECT c.* FROM offline_policy c, d WHERE c.scope_type = 'OPERATOR_CEILING' AND c.scope_id = d.operator_id)
  -- téléphone personnel d'un vendeur (OP-N7) : jamais de hors ligne ni de recharge espèces hors ligne
  SELECT pick.en AND coalesce((SELECT offline_enabled FROM cap), true)
         AND NOT coalesce((SELECT personal_phone FROM device WHERE id = p_device), false),
         least(pick.ps, coalesce((SELECT max_per_sale FROM cap), pick.ps)),
         least(pick.pm, coalesce((SELECT max_per_media_per_device FROM cap), pick.pm)),
         least(pick.pt, coalesce((SELECT max_total_per_device FROM cap), pick.pt)),
         least(pick.age, coalesce((SELECT max_snapshot_age FROM cap), pick.age)),
         pick.cash AND coalesce((SELECT cash_topup_offline FROM cap), true)
         AND NOT coalesce((SELECT personal_phone FROM device WHERE id = p_device), false),
         (pick.ps > coalesce((SELECT max_per_sale FROM cap), pick.ps)
          OR pick.pm > coalesce((SELECT max_per_media_per_device FROM cap), pick.pm)
          OR pick.pt > coalesce((SELECT max_total_per_device FROM cap), pick.pt))
  FROM pick
$$;

-- 4f. Paiement par QR (terminaux iOS, ou sans bracelet), toujours en ligne ------------
-- MERCHANT_QR : le terminal affiche un QR dynamique, le festivalier le scanne et confirme dans l'app.
-- CUSTOMER_QR : l'app festivalier affiche un QR à usage unique, le terminal le scanne.
CREATE TABLE payment_request (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id   uuid NOT NULL REFERENCES party(id),
  event_id      uuid NOT NULL REFERENCES event(id),
  direction     text NOT NULL CHECK (direction IN ('MERCHANT_QR','CUSTOMER_QR')),
  device_id     uuid REFERENCES device(id),
  wallet_id     uuid REFERENCES wallet(id),
  amount        bigint CHECK (amount > 0),
  currency      char(3) NOT NULL,
  nonce_hash    bytea NOT NULL UNIQUE,                  -- SHA-256 du jeton contenu dans le QR
  expires_at    timestamptz NOT NULL,                   -- durée de vie courte (ex. 60 s)
  status        text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','CONFIRMED','EXPIRED','CANCELLED')),
  transaction_id uuid
);

-- 5. Règlements, anomalies, rapprochements --------------------------------------
-- Versement en deux temps : PAYOUT_INITIATED (droit -> compte "versements en cours")
-- puis PAYOUT_CONFIRMED (en cours -> banque) ou PAYOUT_FAILED (en cours -> droit).
CREATE TABLE payout (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id      uuid NOT NULL REFERENCES party(id),
  ledger_id        uuid NOT NULL REFERENCES ledger(id),
  beneficiary_id   uuid NOT NULL REFERENCES party(id),
  amount           bigint NOT NULL CHECK (amount > 0),
  method           text NOT NULL CHECK (method IN ('BANK_TRANSFER','WAVE','ORANGE_MONEY','CASH')),
  status           text NOT NULL CHECK (status IN ('INITIATED','CONFIRMED','FAILED')),
  external_ref     text,
  initiated_at     timestamptz NOT NULL DEFAULT now(),  -- alerte si INITIATED depuis plus de 48 h (SPEC §11.4)
  initiated_by     uuid NOT NULL,
  approved_by      uuid NOT NULL,                       -- seconde personne
  settled_at       timestamptz,
  CHECK (approved_by <> initiated_by),
  initiated_tx_id  uuid REFERENCES journal_transaction(id),
  settled_tx_id    uuid REFERENCES journal_transaction(id)
);

CREATE TABLE anomaly (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id      uuid NOT NULL REFERENCES party(id),
  ledger_id        uuid REFERENCES ledger(id),        -- NULL permis pour une anomalie de sécurité sans montant (bracelet sans portefeuille)
  kind             text NOT NULL CHECK (kind IN (     -- liste fermée : SPECIFICATION §12.2
                     'OFFLINE_SHORTFALL','COUNTER_DUPLICATE','COUNTER_TIME_INVERSION','UID_MISMATCH','RETIRED_IDENTITY',
                     'SEQ_GAP','CHAIN_BROKEN','CLOCK_SKEW','VOID_CONFLICT','ONLINE_CONFIRMED_MISSING','IDEMPOTENCY_CONFLICT',
                     'NON_COMPLIANT_OPERATION','PERIOD_CLOSED_OPERATION','LATE_OFFLINE_SYNC','SIGNATURE_MISMATCH',
                     'CASH_TOPUP_OVER_LIMIT','CASH_DIFF',
                     -- revue 2 : écart PSP / grand livre, recharge carte ou mobile au-delà d'un plafond, rejeu EDGE impossible
                     'PSP_MISMATCH','PSP_TOPUP_OVER_LIMIT','EDGE_REPLAY_FAILED',
                     -- ADR-77 : contestation reçue après le verrouillage ; plusieurs cartes sur un même portefeuille
                     'LATE_CHARGEBACK','CARD_VELOCITY')),
  media_id         uuid REFERENCES media(id),
  device_id        uuid REFERENCES device(id),        -- SEQ_GAP, CHAIN_BROKEN : terminal concerné
  seq              bigint,                            -- SEQ_GAP : numéro manquant
  created_at       timestamptz NOT NULL DEFAULT now(),
  transaction_id   uuid REFERENCES journal_transaction(id),
  amount           bigint NOT NULL,
  status           text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','RESOLVED')),
  resolution_tx_id uuid REFERENCES journal_transaction(id),
  CHECK (amount = 0 OR ledger_id IS NOT NULL),
  -- espèces dues à un détenteur : toujours rattachées à son bracelet, avec le montant dû (revue 2)
  CHECK (kind <> 'CASH_TOPUP_OVER_LIMIT' OR (media_id IS NOT NULL AND amount > 0))
);
-- Une anomalie d'espèces dues ne se clôt que par une écriture qui débite L-ESP-A-RENDRE (rendu au guichet,
-- refund_cash_due, ou passage en casse) : l'application ne peut pas la clore à la main (revue 2).
CREATE FUNCTION anomaly_cash_due_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.kind = 'CASH_TOPUP_OVER_LIMIT' AND NEW.status = 'RESOLVED' AND OLD.status = 'OPEN'
     AND NOT EXISTS (SELECT 1 FROM posting p JOIN account a ON a.id = p.account_id
                      WHERE p.transaction_id = NEW.resolution_tx_id AND a.purpose = 'CUSTOMER_CASH_DUE' AND p.amount > 0) THEN
    RAISE EXCEPTION 'Espèces dues : clôture seulement par une écriture qui débite L-ESP-A-RENDRE' USING ERRCODE = 'CL020';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER anomaly_cash_due_guard BEFORE UPDATE OF status ON anomaly FOR EACH ROW EXECUTE FUNCTION anomaly_cash_due_guard();

CREATE TABLE external_statement_line (      -- relevés PSP / banque / mobile money
  id              bigserial PRIMARY KEY,
  operator_id     uuid NOT NULL REFERENCES party(id),
  ledger_id       uuid NOT NULL REFERENCES ledger(id),
  account_id      uuid NOT NULL REFERENCES account(id),   -- compte A-* rapproché
  source          text NOT NULL,
  external_ref    text NOT NULL,
  value_date      date NOT NULL,
  amount          bigint NOT NULL,
  matched_tx_id   uuid REFERENCES journal_transaction(id),
  UNIQUE (source, external_ref)
);

-- 6. Sécurité : isolation multi-tenant et droits -------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['event','config_version','merchant_participation','point_of_sale','device','fee_rule',
                           'ledger','wallet','media','account','journal_transaction','posting','account_balance',
                           'payout','anomaly','external_statement_line','media_tap','offline_snapshot','tag_key','edge_gateway','offline_policy','contract','payment_request','tag_data_key','media_batch']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
                     USING (operator_id = current_setting('app.operator_id', true)::uuid)$p$, t);
  END LOOP;
END $$;

-- Rôle applicatif : défini dans roles.sql (revue 2), à exécuter après ce fichier. L'application lit, écrit les
-- données de référence, mais n'écrit dans le grand livre et les registres que par les fonctions. Durées de
-- transaction OBLIGATOIRES en production (ADR-55) : réglées dans roles.sql.

-- 7. Vues de contrôle ---------------------------------------------------------
CREATE VIEW trial_balance AS
SELECT a.ledger_id, a.code, a.family, a.purpose, a.owner_party_id,
       coalesce(sum(p.amount) FILTER (WHERE p.amount > 0), 0)  AS total_debit,
       coalesce(-sum(p.amount) FILTER (WHERE p.amount < 0), 0) AS total_credit,
       coalesce(sum(p.amount), 0)                              AS signed_balance
FROM account a LEFT JOIN posting p ON p.account_id = a.id
GROUP BY a.id;

-- Balance à une date : même calcul filtré sur occurred_at
CREATE FUNCTION trial_balance_at(p_ledger uuid, p_at timestamptz)
RETURNS TABLE (code text, signed_balance bigint) LANGUAGE sql STABLE AS $$
  -- le filtre de date est dans la jointure : un compte sans mouvement avant p_at reste listé, à 0
  SELECT a.code, coalesce(sum(p.amount),0)::bigint
    FROM account a
    LEFT JOIN (posting p JOIN journal_transaction t ON t.id = p.transaction_id AND t.occurred_at <= p_at)
           ON p.account_id = a.id
   WHERE a.ledger_id = p_ledger
   GROUP BY a.code
$$;

-- Droit net de chaque partie (somme de ses sous-comptes)
CREATE VIEW party_position AS
SELECT ledger_id, owner_party_id, -sum(signed_balance) AS net_claim
FROM trial_balance WHERE family = 'CLAIM' AND owner_party_id IS NOT NULL
GROUP BY ledger_id, owner_party_id;

-- Actif = droits  <=>  somme de tous les comptes du grand livre = 0
CREATE VIEW ledger_invariant AS
SELECT ledger_id,
       sum(signed_balance) FILTER (WHERE family = 'ASSET')    AS money_held,
       -sum(signed_balance) FILTER (WHERE family <> 'ASSET')  AS total_claims,
       sum(signed_balance)                                    AS must_be_zero
FROM trial_balance GROUP BY ledger_id;

-- Comptes "hot" : contrôle périodique du sens (pas de contrôle en ligne)
CREATE VIEW hot_account_side_check AS
SELECT tb.* FROM trial_balance tb JOIN account a ON a.ledger_id = tb.ledger_id AND a.code = tb.code
WHERE a.hot AND NOT a.allow_negative
  AND ((a.normal_side = 'D' AND tb.signed_balance < 0) OR (a.normal_side = 'C' AND tb.signed_balance > 0));

-- Le solde en cache doit toujours être égal au recalcul
CREATE VIEW balance_drift AS
SELECT ab.account_id, ab.balance, coalesce(sum(p.amount),0) AS recomputed
FROM account_balance ab LEFT JOIN posting p ON p.account_id = ab.account_id
GROUP BY ab.account_id, ab.balance
HAVING ab.balance <> coalesce(sum(p.amount),0);

-- 9. Supports NFC : passage, clones, snapshot hors ligne ---------------------------
-- À appeler pour chaque lecture de tag (en ligne, ou à la synchro d'une transaction hors ligne).
-- Renvoie 'OK', 'UNKNOWN', 'NOT_ACTIVATED', 'BLOCKED', 'REPLACED', 'RELEASED', 'RETIRED', 'BATCH_INACTIVE', 'WRONG_EVENT',
-- 'UID_MISMATCH', 'SIGNATURE_MISMATCH', 'SIGNATURE_MISSING' ou 'CLONE_SUSPECTED' (SPECIFICATION §7.6), avec le tap_id.
CREATE FUNCTION register_tap(p_operator uuid, p_token_hash bytea, p_uid bytea, p_counter bigint,
                             p_occurred timestamptz, p_device uuid, p_mode text, p_tx uuid DEFAULT NULL,
                             p_online_tap bigint DEFAULT NULL, p_signature bytea DEFAULT NULL)
-- Renvoie le résultat ET l'identifiant du passage (tap_id, revue 2 DB-I3) : un tap_id ne sert qu'à UNE écriture
-- (consume_tap). tap_id est NULL quand aucun passage n'est enregistré (refus avant trace).
RETURNS TABLE (result text, tap_id bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE m media%ROWTYPE; lg uuid; b media_batch%ROWTYPE; dev_event uuid; dev_org uuid; prev media_tap%ROWTYPE; win int;
        new_tap bigint;
BEGIN
  PERFORM assert_tenant(p_operator);   -- cloisonnement : l'objet doit appartenir au prestataire de la session
  IF p_device IS NOT NULL AND tenant_of_device(p_device) IS DISTINCT FROM p_operator THEN   -- revue 2, M2
    RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found';
  END IF;
  SELECT * INTO m FROM media WHERE operator_id = p_operator AND token_hash = p_token_hash FOR UPDATE;
  IF NOT FOUND THEN
    -- Identité d'un ancien détenteur (bracelet POOL réattribué depuis) : c'est une copie
    SELECT m2.* INTO m FROM media_identity_history h JOIN media m2 ON m2.id = h.media_id
     WHERE h.operator_id = p_operator AND h.token_hash = p_token_hash;
    IF FOUND THEN
      INSERT INTO anomaly (operator_id, ledger_id, kind, media_id, amount)
           VALUES (p_operator, (SELECT ledger_id FROM wallet WHERE id = m.wallet_id), 'RETIRED_IDENTITY', m.id, 0);
      RETURN QUERY SELECT 'CLONE_SUSPECTED'::text, NULL::bigint; RETURN;
    END IF;
    RETURN QUERY SELECT 'UNKNOWN'::text, NULL::bigint; RETURN;
  END IF;
  IF m.status IN ('RETIRED','DESTROYED') THEN RETURN QUERY SELECT 'RETIRED'::text, NULL::bigint; RETURN; END IF;
  IF m.status = 'REPLACED' THEN RETURN QUERY SELECT 'REPLACED'::text, NULL::bigint; RETURN; END IF;
  IF m.status IN ('PERSONALIZED','ISSUED') THEN RETURN QUERY SELECT 'NOT_ACTIVATED'::text, NULL::bigint; RETURN; END IF;
  IF m.status = 'RELEASED' THEN RETURN QUERY SELECT 'RELEASED'::text, NULL::bigint; RETURN; END IF;
  SELECT ledger_id INTO lg FROM wallet WHERE id = m.wallet_id;
  IF m.nfc_uid IS NOT NULL AND m.nfc_uid <> p_uid THEN
    INSERT INTO anomaly (operator_id, ledger_id, kind, media_id, amount) VALUES (p_operator, lg, 'UID_MISMATCH', m.id, 0);
    UPDATE media SET status = 'BLACKLISTED' WHERE id = m.id;
    RETURN QUERY SELECT 'UID_MISMATCH'::text, NULL::bigint; RETURN;
  END IF;
  -- Signature d'originalité lue à chaque passage (ADR-59) : le terminal vérifie qu'elle est valide pour l'UID
  -- (clé publique NXP) ; le serveur vérifie que c'est celle de la puce personnalisée. Une autre signature
  -- valide = une autre puce qui se fait passer pour ce bracelet.
  -- Signature absente alors que la puce en a une enregistrée (revue 2, DB-I1) : en ligne, le terminal doit
  -- relire (SIGNATURE_MISSING, sans liste noire) ; hors ligne, l'opération déjà faite est gardée avec une anomalie.
  IF p_signature IS NULL AND m.originality_sig_sha256 IS NOT NULL THEN
    IF p_mode = 'ONLINE' THEN RETURN QUERY SELECT 'SIGNATURE_MISSING'::text, NULL::bigint; RETURN; END IF;
    INSERT INTO anomaly (operator_id, ledger_id, kind, media_id, amount) VALUES (p_operator, lg, 'SIGNATURE_MISMATCH', m.id, 0);
  END IF;
  IF p_signature IS NOT NULL AND m.originality_sig_sha256 IS NOT NULL AND sha256(p_signature) <> m.originality_sig_sha256 THEN
    INSERT INTO anomaly (operator_id, ledger_id, kind, media_id, amount) VALUES (p_operator, lg, 'SIGNATURE_MISMATCH', m.id, 0);
    UPDATE media SET status = 'BLACKLISTED' WHERE id = m.id;
    RETURN QUERY SELECT 'SIGNATURE_MISMATCH'::text, NULL::bigint; RETURN;
  END IF;
  -- Validité du lot : actif, et utilisable par l'événement du terminal (avant toute trace du passage)
  IF m.batch_id IS NOT NULL THEN
    SELECT * INTO b FROM media_batch WHERE id = m.batch_id;
    IF b.status <> 'ACTIVE' THEN RETURN QUERY SELECT 'BATCH_INACTIVE'::text, NULL::bigint; RETURN; END IF;
    IF p_device IS NOT NULL THEN
      SELECT d.event_id, e.organizer_id INTO dev_event, dev_org
        FROM device d JOIN event e ON e.id = d.event_id WHERE d.id = p_device;
      IF dev_org IS DISTINCT FROM b.organizer_id
         OR (b.event_id IS NOT NULL AND b.event_id IS DISTINCT FROM dev_event) THEN
        RETURN QUERY SELECT 'WRONG_EVENT'::text, NULL::bigint; RETURN;
      END IF;
    END IF;
  END IF;
  -- Lecture déjà enregistrée en ligne, citée par une opération de lot (ADR-50, précision) : même bracelet,
  -- même compteur, même UID, même terminal, et jamais utilisée pour une écriture -> réutilisée, quel que soit le délai.
  -- Sinon, on poursuit comme une lecture nouvelle (et le même compteur sera une copie suspectée).
  IF p_online_tap IS NOT NULL THEN
    SELECT * INTO prev FROM media_tap WHERE id = p_online_tap;
    IF FOUND AND prev.media_id = m.id AND prev.counter = p_counter AND prev.nfc_uid = p_uid
       AND p_device IS NOT NULL AND prev.device_id = p_device AND prev.transaction_id IS NULL THEN
      RETURN QUERY SELECT CASE WHEN m.status = 'ACTIVE' THEN 'OK' ELSE 'BLOCKED' END::text, prev.id; RETURN;
    END IF;
  END IF;
  -- Même lecture reçue une seconde fois (même terminal, même compteur, même UID) :
  --  * jamais utilisée pour une écriture : c'est la même lecture, réutilisée quel que soit le délai (revue 2,
  --    DB-I2 : un lot hors ligne qui ne cite pas online_tap_id ne doit pas mettre le bracelet en liste noire) ;
  --    consume_tap garantit qu'elle ne servira qu'à une seule écriture ;
  --  * déjà utilisée : renvoi réseau accepté dans tap_replay_window_seconds (ADR-50), sinon copie suspectée.
  SELECT * INTO prev FROM media_tap WHERE media_id = m.id AND counter = p_counter;
  IF FOUND AND p_device IS NOT NULL AND prev.device_id = p_device AND prev.nfc_uid = p_uid THEN
    SELECT coalesce((SELECT e.tap_replay_window_seconds FROM device d JOIN event e ON e.id = d.event_id WHERE d.id = p_device), 120)
      INTO win;
    IF prev.transaction_id IS NULL OR prev.received_at >= clock_timestamp() - make_interval(secs => win) THEN
      RETURN QUERY SELECT CASE WHEN m.status = 'ACTIVE' THEN 'OK' ELSE 'BLOCKED' END::text, prev.id; RETURN;
    END IF;
  END IF;
  BEGIN
    INSERT INTO media_tap (operator_id, media_id, counter, nfc_uid, occurred_at, device_id, mode, transaction_id)
         VALUES (p_operator, m.id, p_counter, p_uid, p_occurred, p_device, p_mode, p_tx)
      RETURNING id INTO new_tap;
  EXCEPTION WHEN unique_violation THEN
    -- même valeur de compteur déjà vue : deux puces répondent pour la même identité
    INSERT INTO anomaly (operator_id, ledger_id, kind, media_id, amount) VALUES (p_operator, lg, 'COUNTER_DUPLICATE', m.id, 0);
    UPDATE media SET status = 'BLACKLISTED' WHERE id = m.id;
    RETURN QUERY SELECT 'CLONE_SUSPECTED'::text, NULL::bigint; RETURN;
  END;
  UPDATE media SET last_counter = greatest(coalesce(last_counter, -1), p_counter) WHERE id = m.id;
  RETURN QUERY SELECT CASE WHEN m.status = 'ACTIVE' THEN 'OK' ELSE 'BLOCKED' END::text, new_tap;
END $$;

-- Inversions temporelles : un passage plus récent avec un compteur plus petit (clone probable,
-- ou horloge de terminal fausse). Les passages hors ligne arrivent en retard : on compare occurred_at, pas l'ordre d'arrivée.
-- Consommation d'un passage par UNE écriture (revue 2, DB-I3). Idempotente pour la même écriture ;
-- un passage déjà consommé par une autre écriture, ou trop ancien, est refusé (CL022 TAP_UNUSABLE).
CREATE FUNCTION consume_tap(p_tap bigint, p_tx uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t media_tap%ROWTYPE; win int; tx journal_transaction%ROWTYPE;
BEGIN
  SELECT * INTO t FROM media_tap WHERE id = p_tap FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  PERFORM assert_tenant(t.operator_id);
  SELECT * INTO tx FROM journal_transaction WHERE id = p_tx;
  IF NOT FOUND OR tx.operator_id <> t.operator_id THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  IF tx.media_id IS NOT NULL AND tx.media_id <> t.media_id THEN
    RAISE EXCEPTION 'Le passage % ne concerne pas le bracelet de l''écriture', p_tap USING ERRCODE = 'CL001';
  END IF;
  IF t.transaction_id = p_tx THEN RETURN; END IF;                    -- rejeu de la même écriture
  IF t.transaction_id IS NOT NULL THEN
    RAISE EXCEPTION 'Passage % déjà utilisé par une autre écriture', p_tap USING ERRCODE = 'CL022';
  END IF;
  -- Une écriture EN LIGNE doit suivre son passage de moins de tap_replay_window_seconds (120 s par défaut) ;
  -- une opération de lot hors ligne consomme son passage quel que soit le délai de synchronisation.
  IF tx.source = 'ONLINE' THEN
    SELECT coalesce((SELECT e.tap_replay_window_seconds FROM device d JOIN event e ON e.id = d.event_id WHERE d.id = t.device_id), 120)
      INTO win;
    IF t.received_at < clock_timestamp() - make_interval(secs => greatest(win, 1)) THEN
      RAISE EXCEPTION 'Passage % expiré', p_tap USING ERRCODE = 'CL022';
    END IF;
  END IF;
  UPDATE media_tap SET transaction_id = p_tx WHERE id = p_tap;
END $$;

CREATE VIEW counter_time_inversion AS
SELECT a.media_id, a.counter AS earlier_counter, a.occurred_at AS earlier_at,
       b.counter AS later_counter, b.occurred_at AS later_at, a.device_id AS device_a, b.device_id AS device_b
FROM media_tap a JOIN media_tap b ON b.media_id = a.media_id
 AND b.occurred_at > a.occurred_at + interval '2 minutes'   -- tolérance d'horloge
 AND b.counter < a.counter;

-- Contenu d'un snapshot hors ligne : ce qu'un terminal a le droit de savoir, rien de plus
-- Contenu d'un snapshot : vue offline_snapshot_rows, section 18 (elle suit media_assignment, défini plus bas).
-- NB : le serveur ajoute à chaque entrée le PWD/PACK dérivé par le KMS. Les terminaux ne détiennent jamais la clé maître.

-- 10. Préchargement d'un lot (crédits offerts staff / VIP) ------------------------------
-- Préchargement d'UN bracelet : une transaction PROMO_CREDIT par bracelet et par rattachement,
-- clé preload:<bracelet>:<n° de rattachement>. Idempotent. Appelé par activate_media et par preload_batch.
CREATE FUNCTION preload_media(p_media uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE m media%ROWTYPE; b media_batch%ROWTYPE; lg uuid; n int; org_promo uuid; acc_promo uuid;
BEGIN
  PERFORM assert_tenant(tenant_of_media(p_media));   -- cloisonnement : l'objet doit appartenir au prestataire de la session
  SELECT * INTO m FROM media WHERE id = p_media;
  SELECT * INTO b FROM media_batch WHERE id = m.batch_id;
  IF NOT FOUND OR b.preload_promo_amount = 0 THEN RETURN NULL; END IF;
  IF m.wallet_id IS NULL OR m.status <> 'ACTIVE' THEN RAISE EXCEPTION 'Bracelet non actif : préchargement impossible' USING ERRCODE = 'CL020'; END IF;
  SELECT ledger_id INTO lg FROM wallet WHERE id = m.wallet_id;
  SELECT id INTO acc_promo FROM account WHERE wallet_id = m.wallet_id AND purpose = 'WALLET_PROMO';
  SELECT id INTO org_promo FROM account WHERE ledger_id = lg AND purpose = 'ORG_PROMO' AND owner_party_id = b.organizer_id;
  IF acc_promo IS NULL OR org_promo IS NULL THEN RAISE EXCEPTION 'Compte WALLET_PROMO ou ORG_PROMO introuvable' USING ERRCODE = 'CL001'; END IF;
  SELECT count(*) INTO n FROM media_assignment WHERE media_id = p_media;
  RETURN post_transaction(lg, 'PROMO_CREDIT', 'preload:' || p_media || ':' || n, now(), 'BATCH',
    jsonb_build_array(
      jsonb_build_object('account_id', acc_promo, 'amount', -b.preload_promo_amount, 'memo', 'Préchargement du lot'),
      jsonb_build_object('account_id', org_promo, 'amount', b.preload_promo_amount, 'memo', 'Financement du préchargement')),
    b.event_id, NULL, NULL, NULL, NULL, NULL, p_media);
END $$;

-- Rattrapage d'un lot : précharge tous les bracelets actifs du lot qui ne l'ont pas encore été. Renvoie leur nombre.
-- Par tranches (revue 2, DB-I17) : au plus p_limit bracelets par appel ; l'appelant relance jusqu'à 0.
CREATE FUNCTION preload_batch(p_batch uuid, p_limit int DEFAULT 500) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b media_batch%ROWTYPE; r record; k int := 0;
BEGIN
  PERFORM assert_tenant(tenant_of_batch(p_batch));   -- cloisonnement : l'objet doit appartenir au prestataire de la session
  SELECT * INTO b FROM media_batch WHERE id = p_batch FOR UPDATE;
  IF b.preload_promo_amount = 0 THEN RAISE EXCEPTION 'Lot sans préchargement' USING ERRCODE = 'CL020'; END IF;
  FOR r IN SELECT m.id, (SELECT count(*) FROM media_assignment a WHERE a.media_id = m.id) AS n, w.ledger_id
             FROM media m JOIN wallet w ON w.id = m.wallet_id
            WHERE m.batch_id = p_batch AND m.status = 'ACTIVE' ORDER BY m.id LOOP
    IF NOT EXISTS (SELECT 1 FROM journal_transaction t
                    WHERE t.ledger_id = r.ledger_id AND t.idempotency_key = 'preload:' || r.id || ':' || r.n) THEN
      PERFORM preload_media(r.id);
      k := k + 1;                                       -- seuls les bracelets qui ne l'avaient pas encore été
      EXIT WHEN k >= p_limit;
    END IF;
  END LOOP;
  RETURN k;
END $$;

-- 11. Clé dédiée par événement : cohérence et retrait -----------------------------------
-- Le mode du lot doit correspondre à la clé : lot SHARED -> clé SHARED ; lot DEDICATED -> clé DEDICATED de SON événement.
CREATE FUNCTION check_batch_key() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE k tag_key%ROWTYPE;
BEGIN
  SELECT * INTO k FROM tag_key WHERE operator_id = NEW.operator_id AND key_index = NEW.key_index;
  IF NOT FOUND THEN RAISE EXCEPTION 'Index de clé % inconnu pour ce prestataire', NEW.key_index USING ERRCODE = 'CL020'; END IF;
  IF k.status <> 'ACTIVE' AND NEW.status IN ('ORDERED','PERSONALIZED') THEN
    RAISE EXCEPTION 'Clé % non active : impossible de personnaliser un nouveau lot', NEW.key_index USING ERRCODE = 'CL020';
  END IF;
  IF NEW.key_mode = 'SHARED' AND k.scope <> 'SHARED' THEN
    RAISE EXCEPTION 'Lot partagé : la clé % est dédiée à un événement', NEW.key_index USING ERRCODE = 'CL020';
  END IF;
  IF NEW.key_mode = 'DEDICATED' AND (k.scope <> 'DEDICATED' OR k.dedicated_event_id IS DISTINCT FROM NEW.event_id) THEN
    RAISE EXCEPTION 'Lot à clé dédiée : la clé % n''est pas dédiée à l''événement du lot', NEW.key_index USING ERRCODE = 'CL020';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER media_batch_key BEFORE INSERT OR UPDATE OF key_index, key_mode, event_id, status ON media_batch
  FOR EACH ROW EXECUTE FUNCTION check_batch_key();

-- Un bracelet porte l'index de clé de son lot
CREATE FUNCTION check_media_batch_key() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.batch_id IS NOT NULL AND NEW.key_index <> (SELECT key_index FROM media_batch WHERE id = NEW.batch_id) THEN
    RAISE EXCEPTION 'Le bracelet doit utiliser l''index de clé de son lot' USING ERRCODE = 'CL020';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER media_key_matches_batch BEFORE INSERT OR UPDATE OF batch_id, key_index ON media
  FOR EACH ROW EXECUTE FUNCTION check_media_batch_key();

-- Retrait d'une clé dédiée après l'événement : tous les lots doivent être CLOSED.
-- Effets : clé et DEK retirées, mots de passe stockés effacés, bracelets RETIRED (plus personne ne peut les lire).
-- La désactivation de la clé dans AWS KMS (DisableKey puis ScheduleKeyDeletion) est faite par l'application,
-- qui renseigne ensuite tag_key.kms_disabled_at.
CREATE FUNCTION retire_dedicated_key(p_operator uuid, p_key_index integer) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE k tag_key%ROWTYPE; n integer;
BEGIN
  PERFORM assert_tenant(p_operator);   -- cloisonnement : l'objet doit appartenir au prestataire de la session
  SELECT * INTO k FROM tag_key WHERE operator_id = p_operator AND key_index = p_key_index FOR UPDATE;
  IF NOT FOUND OR k.scope <> 'DEDICATED' THEN RAISE EXCEPTION 'Seule une clé dédiée peut être retirée ainsi' USING ERRCODE = 'CL020'; END IF;
  IF EXISTS (SELECT 1 FROM media_batch WHERE operator_id = p_operator AND key_index = p_key_index AND status <> 'CLOSED') THEN
    RAISE EXCEPTION 'Tous les lots de la clé % doivent être clos avant son retrait', p_key_index USING ERRCODE = 'CL020';
  END IF;
  UPDATE media SET status = 'RETIRED'
   WHERE operator_id = p_operator AND key_index = p_key_index
     AND status NOT IN ('RETIRED','REPLACED','DESTROYED');
  GET DIAGNOSTICS n = ROW_COUNT;
  UPDATE media SET pwd_pack_enc = NULL, pwd_pack_dek_id = NULL
   WHERE operator_id = p_operator AND key_index = p_key_index;
  UPDATE tag_data_key SET status = 'RETIRED' WHERE operator_id = p_operator AND key_index = p_key_index;
  UPDATE tag_key SET status = 'RETIRED' WHERE operator_id = p_operator AND key_index = p_key_index;
  RETURN n;
END $$;

-- 12. Cycle de vie des bracelets ------------------------------------------------------
-- Historique des rattachements bracelet -> portefeuille (un bracelet POOL peut en avoir plusieurs)
CREATE TABLE media_assignment (
  id             bigserial PRIMARY KEY,
  operator_id    uuid NOT NULL REFERENCES party(id),
  media_id       uuid NOT NULL REFERENCES media(id),
  wallet_id      uuid NOT NULL REFERENCES wallet(id),
  currency       char(3) NOT NULL,                      -- devise du portefeuille (un bracelet peut avoir un portefeuille par devise)
  token_hash     bytea NOT NULL,                        -- identité du bracelet pendant ce rattachement
  assigned_at    timestamptz NOT NULL DEFAULT now(),
  released_at    timestamptz,
  release_reason text CHECK (release_reason IN ('RETURNED','REPLACED','BLACKLISTED','LOT_CLOSED','RETIRED'))
);
CREATE UNIQUE INDEX media_assignment_one_open ON media_assignment (media_id, currency) WHERE released_at IS NULL;

-- Anciennes identités d'un bracelet POOL (réécrites à chaque réattribution) : toute utilisation = copie
CREATE TABLE media_identity_history (
  operator_id  uuid NOT NULL REFERENCES party(id),
  token_hash   bytea NOT NULL,
  media_id     uuid NOT NULL REFERENCES media(id),
  retired_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (operator_id, token_hash)
);

-- Historique de chaque changement de statut (qui, quand, pourquoi, validé par qui)
CREATE TABLE media_status_history (
  id           bigserial PRIMARY KEY,
  operator_id  uuid NOT NULL,
  media_id     uuid NOT NULL REFERENCES media(id),
  from_status  text,
  to_status    text NOT NULL,
  reason       text,
  actor_id     uuid,
  approved_by  uuid,
  device_id    uuid,
  at           timestamptz NOT NULL DEFAULT clock_timestamp()
);

-- Passages autorisés
CREATE TABLE media_transition (
  from_status text NOT NULL,
  to_status   text NOT NULL,
  PRIMARY KEY (from_status, to_status)
);
INSERT INTO media_transition VALUES
 ('PERSONALIZED','ISSUED'), ('PERSONALIZED','BLACKLISTED'), ('PERSONALIZED','RETIRED'), ('PERSONALIZED','DESTROYED'),
 ('ISSUED','ACTIVE'), ('ISSUED','RELEASED'), ('ISSUED','BLACKLISTED'), ('ISSUED','RETIRED'), ('ISSUED','DESTROYED'),
 ('ACTIVE','SUSPENDED'), ('ACTIVE','REPLACED'), ('ACTIVE','BLACKLISTED'), ('ACTIVE','RELEASED'), ('ACTIVE','RETIRED'),
 ('SUSPENDED','ACTIVE'), ('SUSPENDED','REPLACED'), ('SUSPENDED','BLACKLISTED'), ('SUSPENDED','RETIRED'),
 ('BLACKLISTED','ACTIVE'), ('BLACKLISTED','RETIRED'), ('BLACKLISTED','DESTROYED'),
 ('RELEASED','ISSUED'), ('RELEASED','RETIRED'), ('RELEASED','DESTROYED');
-- REPLACED, RETIRED, DESTROYED : états finaux.

CREATE FUNCTION check_media_transition() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE pol text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status NOT IN ('PERSONALIZED','ISSUED','ACTIVE') THEN
      RAISE EXCEPTION 'Un bracelet naît PERSONALIZED, ISSUED ou ACTIVE (reprise de données), pas %', NEW.status USING ERRCODE = 'CL020';
    END IF;
    IF NEW.status = 'ACTIVE' AND NEW.wallet_id IS NULL THEN
      RAISE EXCEPTION 'Un bracelet ACTIVE doit être rattaché à un portefeuille' USING ERRCODE = 'CL020';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;
  IF NOT EXISTS (SELECT 1 FROM media_transition WHERE from_status = OLD.status AND to_status = NEW.status) THEN
    RAISE EXCEPTION 'Passage interdit : % -> %', OLD.status, NEW.status USING ERRCODE = 'CL020';
  END IF;
  SELECT reuse_policy INTO pol FROM media_batch WHERE id = NEW.batch_id;
  -- Seul un bracelet POOL peut être remis à une autre personne
  IF OLD.status = 'RELEASED' AND NEW.status = 'ISSUED' AND coalesce(pol, 'SINGLE_USE') <> 'POOL' THEN
    RAISE EXCEPTION 'Réattribution interdite : lot %', coalesce(pol, 'sans lot') USING ERRCODE = 'CL020';
  END IF;
  -- Bracelet perdu puis retrouvé : dépend de la politique de l'événement (défaut : fin de vie)
  IF OLD.status = 'SUSPENDED' AND NEW.status = 'ACTIVE'
     AND coalesce((SELECT lost_media_policy FROM event WHERE id = media_event(NEW.id)), 'END_OF_LIFE') <> 'REACTIVATE' THEN
    RAISE EXCEPTION 'Politique de l''événement : un bracelet perdu retrouvé passe en fin de vie' USING ERRCODE = 'CL020';
  END IF;
  -- Sortie de liste noire : validation par une seconde personne obligatoire
  IF OLD.status = 'BLACKLISTED' AND NEW.status = 'ACTIVE'
     AND (nullif(current_setting('app.approved_by', true), '') IS NULL
          OR current_setting('app.approved_by', true) = coalesce(current_setting('app.user_id', true), '')) THEN
    RAISE EXCEPTION 'Sortie de liste noire : validation par une seconde personne requise' USING ERRCODE = 'CL020';
  END IF;
  IF NEW.status = 'ACTIVE' AND NEW.wallet_id IS NULL THEN
    RAISE EXCEPTION 'Un bracelet ACTIVE doit être rattaché à un portefeuille' USING ERRCODE = 'CL020';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER media_transition_check BEFORE INSERT OR UPDATE OF status ON media
  FOR EACH ROW EXECUTE FUNCTION check_media_transition();

CREATE FUNCTION log_media_status() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status = OLD.status THEN RETURN NULL; END IF;
  INSERT INTO media_status_history (operator_id, media_id, from_status, to_status, reason, actor_id, approved_by)
  VALUES (NEW.operator_id, NEW.id, CASE WHEN TG_OP = 'UPDATE' THEN OLD.status END, NEW.status,
          nullif(current_setting('app.reason', true), ''),
          nullif(current_setting('app.user_id', true), '')::uuid,
          nullif(current_setting('app.approved_by', true), '')::uuid);
  IF TG_OP = 'INSERT' AND NEW.wallet_id IS NOT NULL THEN
    INSERT INTO media_assignment (operator_id, media_id, wallet_id, currency, token_hash)
    VALUES (NEW.operator_id, NEW.id, NEW.wallet_id, wallet_currency(NEW.wallet_id), NEW.token_hash);
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER media_status_log AFTER INSERT OR UPDATE OF status ON media
  FOR EACH ROW EXECUTE FUNCTION log_media_status();

-- Solde disponible d'un portefeuille (crédits payés + offerts)
CREATE FUNCTION wallet_spendable(p_wallet uuid) RETURNS bigint LANGUAGE sql STABLE AS $$
  SELECT coalesce(-sum(ab.balance), 0)::bigint
    FROM account a JOIN account_balance ab ON ab.account_id = a.id
   WHERE a.wallet_id = p_wallet AND a.purpose IN ('WALLET_PAID','WALLET_PROMO')
$$;

-- Remise + rattachement au portefeuille (distribution à l'entrée, au guichet, ou via l'app)
-- Événement d'un bracelet : celui de son lot, sinon celui du grand livre de son portefeuille
CREATE FUNCTION media_event(p_media uuid) RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT coalesce(
    (SELECT b.event_id FROM media m JOIN media_batch b ON b.id = m.batch_id WHERE m.id = p_media),
    (SELECT e.id FROM media m JOIN wallet w ON w.id = m.wallet_id JOIN ledger l ON l.id = w.ledger_id
       JOIN event e ON l.scope_type = 'EVENT' AND e.id = l.scope_id WHERE m.id = p_media))
$$;

CREATE FUNCTION activate_media(p_media uuid, p_wallet uuid, p_channel text DEFAULT 'DESK', p_event uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE m media%ROWTYPE; ev event%ROWTYPE;
BEGIN
  PERFORM assert_tenant(tenant_of_media(p_media)); PERFORM assert_tenant(tenant_of_wallet(p_wallet));   -- cloisonnement : l'objet doit appartenir au prestataire de la session
  SELECT * INTO m FROM media WHERE id = p_media FOR UPDATE;
  -- Le mode d'activation doit être autorisé par l'événement (lot réutilisable : l'API DOIT passer p_event)
  IF p_event IS NULL AND m.batch_id IS NOT NULL
     AND (SELECT event_id FROM media_batch WHERE id = m.batch_id) IS NULL THEN
    RAISE EXCEPTION 'Lot réutilisable : l''événement d''activation est obligatoire' USING ERRCODE = 'CL001';
  END IF;
  SELECT * INTO ev FROM event WHERE id = coalesce(p_event, media_event(p_media));
  IF FOUND AND NOT (p_channel = ANY (ev.activation_modes)) THEN
    RAISE EXCEPTION 'Mode d''activation % non autorisé pour l''événement %', p_channel, ev.name USING ERRCODE = 'CL020';
  END IF;
  IF m.status = 'PERSONALIZED' THEN UPDATE media SET status = 'ISSUED' WHERE id = p_media; END IF;
  UPDATE media SET wallet_id = p_wallet, status = 'ACTIVE' WHERE id = p_media;
  SELECT * INTO m FROM media WHERE id = p_media;
  INSERT INTO media_assignment (operator_id, media_id, wallet_id, currency, token_hash)
  VALUES (m.operator_id, m.id, p_wallet, wallet_currency(p_wallet), m.token_hash);
  PERFORM preload_media(p_media);   -- crédits offerts du lot, s'il en prévoit (sans effet sinon)
END $$;

-- Restitution : le portefeuille doit être soldé (remboursé ou passé en casse), l'argent ne suit jamais le bracelet
CREATE FUNCTION release_media(p_media uuid, p_reason text DEFAULT 'RETURNED') RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE m media%ROWTYPE; bal bigint;
BEGIN
  PERFORM assert_tenant(tenant_of_media(p_media));   -- cloisonnement : l'objet doit appartenir au prestataire de la session
  SELECT * INTO m FROM media WHERE id = p_media FOR UPDATE;
  IF m.deposit_status = 'HELD' THEN
    RAISE EXCEPTION 'Restitution refusée : caution de % à rendre d''abord (refund_deposit)', m.deposit_held USING ERRCODE = 'CL020';
  END IF;
  -- Espèces encore dues au détenteur (recharge hors ligne au-delà du plafond, ADR-63) : à rendre d'abord (DB-I11)
  IF EXISTS (SELECT 1 FROM anomaly WHERE media_id = p_media AND kind = 'CASH_TOPUP_OVER_LIMIT' AND status = 'OPEN') THEN
    RAISE EXCEPTION 'Restitution refusée : espèces dues au détenteur à rendre d''abord (refund_cash_due)' USING ERRCODE = 'CL020';
  END IF;
  -- Soldes verrouillés pendant le contrôle (revue 2, M3) : aucune recharge ne peut passer entre le contrôle et la libération
  PERFORM 1 FROM account_balance ab JOIN account a ON a.id = ab.account_id
    JOIN media_assignment ma ON ma.wallet_id = a.wallet_id AND ma.media_id = p_media AND ma.released_at IS NULL
   ORDER BY ab.account_id FOR UPDATE OF ab;
  -- Tous les portefeuilles rattachés (un par devise) doivent être soldés
  SELECT sum(wallet_spendable(wallet_id)) INTO bal FROM media_assignment WHERE media_id = p_media AND released_at IS NULL;
  IF coalesce(bal, 0) <> 0 THEN RAISE EXCEPTION 'Restitution refusée : solde de % à rembourser ou passer en casse', bal USING ERRCODE = 'CL020'; END IF;
  UPDATE media_assignment SET released_at = now(), release_reason = p_reason
   WHERE media_id = p_media AND released_at IS NULL;
  UPDATE media SET wallet_id = NULL, status = 'RELEASED' WHERE id = p_media;
END $$;

-- Réattribution d'un bracelet POOL : nouvelle identité écrite dans le bracelet (pages 5-8 non verrouillées),
-- l'ancienne rejoint l'historique : toute copie faite par l'ancien détenteur devient inutilisable.
CREATE FUNCTION reassign_pool_media(p_media uuid, p_new_token_hash bytea) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE m media%ROWTYPE;
BEGIN
  PERFORM assert_tenant(tenant_of_media(p_media));   -- cloisonnement : l'objet doit appartenir au prestataire de la session
  SELECT * INTO m FROM media WHERE id = p_media FOR UPDATE;
  IF m.status <> 'RELEASED' THEN RAISE EXCEPTION 'Seul un bracelet rendu peut être réattribué' USING ERRCODE = 'CL020'; END IF;
  INSERT INTO media_identity_history (operator_id, token_hash, media_id) VALUES (m.operator_id, m.token_hash, m.id);
  UPDATE media SET token_hash = p_new_token_hash, status = 'ISSUED' WHERE id = p_media;   -- le trigger vérifie POOL
END $$;

-- Remplacement (perte, bracelet abîmé) : l'ancien passe REPLACED, le nouveau reprend le MÊME portefeuille
CREATE FUNCTION replace_media(p_old uuid, p_new uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o media%ROWTYPE; n media%ROWTYPE; bo media_batch%ROWTYPE; bn media_batch%ROWTYPE;
BEGIN
  PERFORM assert_tenant(tenant_of_media(p_old)); PERFORM assert_tenant(tenant_of_media(p_new));   -- cloisonnement : l'objet doit appartenir au prestataire de la session
  SELECT * INTO o FROM media WHERE id = p_old FOR UPDATE;
  SELECT * INTO n FROM media WHERE id = p_new FOR UPDATE;
  IF o.wallet_id IS NULL THEN RAISE EXCEPTION 'L''ancien bracelet n''a pas de portefeuille' USING ERRCODE = 'CL020'; END IF;
  -- Contrôles d'état (revue 2, M5) : on remplace un bracelet en service ou déclaré perdu, par un bracelet neuf
  IF o.status NOT IN ('ACTIVE','SUSPENDED') THEN
    RAISE EXCEPTION 'Remplacement impossible : ancien bracelet %', o.status USING ERRCODE = 'CL020';
  END IF;
  IF n.status NOT IN ('PERSONALIZED','ISSUED') OR n.wallet_id IS NOT NULL OR n.deposit_status <> 'NONE' THEN
    RAISE EXCEPTION 'Le bracelet de remplacement doit être neuf (état %)', n.status USING ERRCODE = 'CL020';
  END IF;
  SELECT * INTO bo FROM media_batch WHERE id = o.batch_id;
  SELECT * INTO bn FROM media_batch WHERE id = n.batch_id;
  IF bn.organizer_id IS DISTINCT FROM bo.organizer_id THEN
    RAISE EXCEPTION 'Le bracelet de remplacement doit appartenir au même organisateur' USING ERRCODE = 'CL020';
  END IF;
  -- La caution suit le détenteur (DB-B2) : elle passe au nouveau bracelet, sinon elle ne pourrait plus être
  -- rendue ni acquise (l'ancien bracelet n'a plus de portefeuille). Même mode exigé pour la rendre correctement.
  IF o.deposit_status = 'HELD' AND bn.deposit_mode IS DISTINCT FROM bo.deposit_mode THEN
    RAISE EXCEPTION 'Caution détenue : le bracelet de remplacement doit venir d''un lot de même mode de caution'
      USING ERRCODE = 'CL020';
  END IF;
  IF o.deposit_status IN ('HELD','DUE') THEN
    UPDATE media SET deposit_status = o.deposit_status, deposit_held = o.deposit_held WHERE id = p_new;
    UPDATE media SET deposit_status = 'NONE', deposit_held = 0 WHERE id = p_old;
  END IF;
  UPDATE media SET status = 'REPLACED', wallet_id = NULL WHERE id = p_old;
  -- Pas d'activation : ni contrôle du mode d'activation, ni préchargement, ni écriture comptable (SPEC §6.1, §7.8)
  IF n.status = 'PERSONALIZED' THEN UPDATE media SET status = 'ISSUED' WHERE id = p_new; END IF;
  UPDATE media SET wallet_id = o.wallet_id, status = 'ACTIVE' WHERE id = p_new;
  INSERT INTO media_assignment (operator_id, media_id, wallet_id, currency, token_hash)
  SELECT operator_id, id, o.wallet_id, wallet_currency(o.wallet_id), token_hash FROM media WHERE id = p_new;
  -- Les portefeuilles des autres devises suivent aussi le nouveau bracelet
  INSERT INTO media_assignment (operator_id, media_id, wallet_id, currency, token_hash)
  SELECT a.operator_id, p_new, a.wallet_id, a.currency, (SELECT token_hash FROM media WHERE id = p_new)
    FROM media_assignment a WHERE a.media_id = p_old AND a.released_at IS NULL AND a.wallet_id <> o.wallet_id;
  UPDATE media_assignment SET released_at = now(), release_reason = 'REPLACED'
   WHERE media_id = p_old AND released_at IS NULL;
END $$;

-- Sortie de liste noire après enquête, validée par une seconde personne
CREATE FUNCTION reinstate_media(p_media uuid, p_actor uuid, p_approver uuid, p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM assert_tenant(tenant_of_media(p_media));   -- cloisonnement : l'objet doit appartenir au prestataire de la session
  PERFORM set_config('app.user_id', p_actor::text, true);
  PERFORM set_config('app.approved_by', coalesce(p_approver::text, ''), true);
  PERFORM set_config('app.reason', p_reason, true);
  UPDATE media SET status = 'ACTIVE' WHERE id = p_media;
END $$;

-- Clôture d'un lot : ses bracelets encore en circulation sont retirés (les portefeuilles restent
-- remboursables via l'app ou le code de récupération)
-- Cautions acquises par tranches (revue 2, DB-I17) : au plus p_limit par appel ; renvoie le nombre restant.
CREATE FUNCTION forfeit_batch_deposits(p_batch uuid, p_limit int DEFAULT 500) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record;
BEGIN
  PERFORM assert_tenant(tenant_of_batch(p_batch));
  FOR r IN SELECT id FROM media WHERE batch_id = p_batch AND deposit_status = 'HELD' ORDER BY id LIMIT p_limit LOOP
    PERFORM forfeit_deposit(r.id);
  END LOOP;
  RETURN (SELECT count(*) FROM media WHERE batch_id = p_batch AND deposit_status = 'HELD');
END $$;

CREATE FUNCTION close_batch(p_batch uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer; r record;
BEGIN
  PERFORM assert_tenant(tenant_of_batch(p_batch));   -- cloisonnement : l'objet doit appartenir au prestataire de la session
  PERFORM 1 FROM media_batch WHERE id = p_batch FOR UPDATE;
  -- Gros lot : acquérir d'abord les cautions par tranches (forfeit_batch_deposits), pour garder des transactions courtes
  IF (SELECT count(*) FROM media WHERE batch_id = p_batch AND deposit_status = 'HELD') > 500 THEN
    RAISE EXCEPTION 'Plus de 500 cautions à acquérir : appeler forfeit_batch_deposits jusqu''à 0, puis close_batch'
      USING ERRCODE = 'CL020';
  END IF;
  -- Cautions des bracelets jamais rendus : acquises à l'organisateur (sous réserve de la loi du pays)
  FOR r IN SELECT id FROM media WHERE batch_id = p_batch AND deposit_status = 'HELD' LOOP
    PERFORM forfeit_deposit(r.id);
  END LOOP;
  UPDATE media_assignment SET released_at = now(), release_reason = 'LOT_CLOSED'
   WHERE released_at IS NULL AND media_id IN (SELECT id FROM media WHERE batch_id = p_batch);
  UPDATE media SET status = 'RETIRED'
   WHERE batch_id = p_batch AND status NOT IN ('RETIRED','REPLACED','DESTROYED');
  GET DIAGNOSTICS n = ROW_COUNT;
  UPDATE media_batch SET status = 'CLOSED' WHERE id = p_batch;
  RETURN n;
END $$;

-- Inventaire par lot : commandé, puis répartition par statut
CREATE VIEW batch_inventory AS
SELECT b.id AS batch_id, b.kind, b.reuse_policy, b.quantity AS ordered,
       count(m.id) AS registered,
       count(m.id) FILTER (WHERE m.status = 'PERSONALIZED') AS in_stock,
       count(m.id) FILTER (WHERE m.status = 'ISSUED')       AS issued,
       count(m.id) FILTER (WHERE m.status = 'ACTIVE')       AS active,
       count(m.id) FILTER (WHERE m.status = 'SUSPENDED')    AS suspended,
       count(m.id) FILTER (WHERE m.status = 'BLACKLISTED')  AS blacklisted,
       count(m.id) FILTER (WHERE m.status = 'REPLACED')     AS replaced,
       count(m.id) FILTER (WHERE m.status = 'RELEASED')     AS returned,
       count(m.id) FILTER (WHERE m.status IN ('RETIRED','DESTROYED')) AS end_of_life,
       b.quantity - count(m.id) AS missing_from_registry
FROM media_batch b LEFT JOIN media m ON m.batch_id = b.id
GROUP BY b.id;

-- Isolation multi-tenant des tables du cycle de vie (déclarées après le bloc RLS principal)
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['media_assignment','media_identity_history','media_status_history'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
                     USING (operator_id = current_setting('app.operator_id', true)::uuid)$p$, t);
  END LOOP;
END $$;

-- Bracelet déclaré perdu puis retrouvé : applique la politique de l'événement
CREATE FUNCTION recover_media(p_media uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE m media%ROWTYPE; pol text;
BEGIN
  PERFORM assert_tenant(tenant_of_media(p_media));   -- cloisonnement : l'objet doit appartenir au prestataire de la session
  SELECT * INTO m FROM media WHERE id = p_media FOR UPDATE;
  IF m.status <> 'SUSPENDED' THEN RAISE EXCEPTION 'Seul un bracelet suspendu peut être retrouvé (statut %)', m.status USING ERRCODE = 'CL020'; END IF;
  pol := coalesce((SELECT lost_media_policy FROM event WHERE id = media_event(p_media)), 'END_OF_LIFE');
  IF pol = 'REACTIVATE' THEN
    UPDATE media SET status = 'ACTIVE' WHERE id = p_media;
    RETURN 'ACTIVE';
  END IF;
  UPDATE media_assignment SET released_at = now(), release_reason = 'RETIRED'
   WHERE media_id = p_media AND released_at IS NULL;
  UPDATE media SET status = 'RETIRED' WHERE id = p_media;
  RETURN 'RETIRED';
END $$;

-- 13. Cycle de vie des lots -------------------------------------------------------------
CREATE TABLE media_batch_transition (from_status text, to_status text, PRIMARY KEY (from_status, to_status));
INSERT INTO media_batch_transition VALUES
 ('ORDERED','PERSONALIZED'), ('ORDERED','CLOSED'),
 ('PERSONALIZED','DELIVERED'), ('PERSONALIZED','CLOSED'),
 ('DELIVERED','ACTIVE'), ('DELIVERED','CLOSED'),
 ('ACTIVE','SUSPENDED'), ('ACTIVE','CLOSED'),
 ('SUSPENDED','ACTIVE'), ('SUSPENDED','CLOSED');

CREATE TABLE media_batch_status_history (
  id           bigserial PRIMARY KEY,
  operator_id  uuid NOT NULL,
  batch_id     uuid NOT NULL REFERENCES media_batch(id),
  from_status  text, to_status text NOT NULL,
  reason       text, actor_id uuid,
  at           timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE FUNCTION check_batch_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status <> OLD.status
     AND NOT EXISTS (SELECT 1 FROM media_batch_transition WHERE from_status = OLD.status AND to_status = NEW.status) THEN
    RAISE EXCEPTION 'Passage de lot interdit : % -> %', OLD.status, NEW.status USING ERRCODE = 'CL020';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER media_batch_transition_check BEFORE UPDATE OF status ON media_batch
  FOR EACH ROW EXECUTE FUNCTION check_batch_transition();

CREATE FUNCTION log_batch_status() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status = OLD.status THEN RETURN NULL; END IF;
  INSERT INTO media_batch_status_history (operator_id, batch_id, from_status, to_status, reason, actor_id)
  VALUES (NEW.operator_id, NEW.id, CASE WHEN TG_OP = 'UPDATE' THEN OLD.status END, NEW.status,
          nullif(current_setting('app.reason', true), ''), nullif(current_setting('app.user_id', true), '')::uuid);
  RETURN NULL;
END $$;
CREATE TRIGGER media_batch_status_log AFTER INSERT OR UPDATE OF status ON media_batch
  FOR EACH ROW EXECUTE FUNCTION log_batch_status();

-- 14. Caution (option par lot, mode C ou D au choix de l'organisateur) --------------------
-- Comptes : ORG_DEPOSIT (cautions détenues = dette envers les détenteurs, créditeur),
--           ORG_DEPOSIT_FORFEIT (cautions acquises, produit de l'organisateur).
CREATE FUNCTION deposit_accounts(p_media uuid, OUT m media, OUT b media_batch, OUT lg uuid,
                                 OUT acc_deposit uuid, OUT acc_wallet uuid)
LANGUAGE plpgsql AS $$
BEGIN
  SELECT * INTO m FROM media WHERE id = p_media;
  SELECT * INTO b FROM media_batch WHERE id = m.batch_id;
  SELECT ledger_id INTO lg FROM wallet WHERE id = m.wallet_id;
  SELECT id INTO acc_deposit FROM account WHERE ledger_id = lg AND purpose = 'ORG_DEPOSIT' AND owner_party_id = b.organizer_id;
  SELECT id INTO acc_wallet FROM account WHERE wallet_id = m.wallet_id AND purpose = 'WALLET_PAID';
  IF acc_deposit IS NULL THEN RAISE EXCEPTION 'Compte ORG_DEPOSIT introuvable dans le grand livre' USING ERRCODE = 'CL001'; END IF;
END $$;

-- Encaissement de la caution. Mode C : prélevée sur le solde (si le solde ne suffit pas encore, la caution
-- reste DUE et sera prélevée à la prochaine recharge). Mode D : payée à part sur p_money_account (caisse, PSP).
CREATE FUNCTION take_deposit(p_media uuid, p_money_account uuid DEFAULT NULL) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d record; n int; debit_acc uuid;
BEGIN
  PERFORM assert_tenant(tenant_of_media(p_media));   -- cloisonnement : l'objet doit appartenir au prestataire de la session
  SELECT * INTO d FROM deposit_accounts(p_media);
  IF (d.b).deposit_amount = 0 THEN RETURN 'NONE'; END IF;
  IF (d.m).deposit_status = 'HELD' THEN RETURN 'HELD'; END IF;
  IF (d.b).deposit_mode = 'FROM_BALANCE' THEN
    -- seul le solde PAYÉ peut financer une caution (les crédits offerts ne sont pas de l'argent du détenteur)
    IF coalesce(-(SELECT balance FROM account_balance WHERE account_id = d.acc_wallet), 0) < (d.b).deposit_amount THEN
      UPDATE media SET deposit_status = 'DUE' WHERE id = p_media;
      RETURN 'DUE';
    END IF;
    debit_acc := d.acc_wallet;
  ELSE
    IF p_money_account IS NULL THEN RAISE EXCEPTION 'Caution payée à part : compte d''encaissement requis' USING ERRCODE = 'CL001'; END IF;
    debit_acc := p_money_account;
  END IF;
  SELECT count(*) INTO n FROM media_assignment WHERE media_id = p_media;
  PERFORM post_transaction(d.lg, 'DEPOSIT_TAKEN', 'deposit:' || p_media || ':' || n, now(), 'ONLINE',
    jsonb_build_array(
      jsonb_build_object('account_id', debit_acc, 'amount', (d.b).deposit_amount, 'memo', 'Caution bracelet'),
      jsonb_build_object('account_id', d.acc_deposit, 'amount', -(d.b).deposit_amount, 'memo', 'Caution bracelet')));
  UPDATE media SET deposit_status = 'HELD', deposit_held = (d.b).deposit_amount WHERE id = p_media;
  RETURN 'HELD';
END $$;

-- Retour du bracelet : mode C, la caution est recréditée sur le portefeuille (puis remboursée avec le solde) ;
-- mode D, elle est rendue sur p_money_account (espèces au guichet, mobile money).
CREATE FUNCTION refund_deposit(p_media uuid, p_money_account uuid DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d record; n int; credit_acc uuid;
BEGIN
  PERFORM assert_tenant(tenant_of_media(p_media));   -- cloisonnement : l'objet doit appartenir au prestataire de la session
  SELECT * INTO d FROM deposit_accounts(p_media);
  IF (d.m).deposit_status <> 'HELD' THEN
    IF (d.m).deposit_status = 'DUE' THEN UPDATE media SET deposit_status = 'NONE' WHERE id = p_media; END IF;
    RETURN;
  END IF;
  IF (d.b).deposit_mode = 'FROM_BALANCE' THEN credit_acc := d.acc_wallet;
  ELSE
    IF p_money_account IS NULL THEN RAISE EXCEPTION 'Caution payée à part : compte de remboursement requis' USING ERRCODE = 'CL001'; END IF;
    credit_acc := p_money_account;
  END IF;
  SELECT count(*) INTO n FROM media_assignment WHERE media_id = p_media;
  PERFORM post_transaction(d.lg, 'DEPOSIT_REFUNDED', 'deposit-refund:' || p_media || ':' || n, now(), 'ONLINE',
    jsonb_build_array(
      jsonb_build_object('account_id', d.acc_deposit, 'amount', (d.m).deposit_held, 'memo', 'Rendu caution'),
      jsonb_build_object('account_id', credit_acc, 'amount', -(d.m).deposit_held, 'memo', 'Rendu caution')));
  UPDATE media SET deposit_status = 'REFUNDED', deposit_held = 0 WHERE id = p_media;
END $$;

-- Bracelet jamais rendu à la clôture du lot : la caution devient un produit de l'organisateur
CREATE FUNCTION forfeit_deposit(p_media uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d record; acc_forfeit uuid; n int;
BEGIN
  PERFORM assert_tenant(tenant_of_media(p_media));   -- cloisonnement : l'objet doit appartenir au prestataire de la session
  SELECT * INTO d FROM deposit_accounts(p_media);
  IF (d.m).deposit_status <> 'HELD' THEN RETURN; END IF;
  SELECT count(*) INTO n FROM media_assignment WHERE media_id = p_media;   -- bracelet POOL : une clé par détenteur (M4)
  SELECT id INTO acc_forfeit FROM account WHERE ledger_id = d.lg AND purpose = 'ORG_DEPOSIT_FORFEIT'
     AND owner_party_id = (d.b).organizer_id;
  IF acc_forfeit IS NULL THEN RAISE EXCEPTION 'Compte ORG_DEPOSIT_FORFEIT introuvable' USING ERRCODE = 'CL001'; END IF;
  PERFORM post_transaction(d.lg, 'DEPOSIT_FORFEITED', 'deposit-forfeit:' || p_media || ':' || n, now(), 'BATCH',
    jsonb_build_array(
      jsonb_build_object('account_id', d.acc_deposit, 'amount', (d.m).deposit_held, 'memo', 'Caution acquise'),
      jsonb_build_object('account_id', acc_forfeit, 'amount', -(d.m).deposit_held, 'memo', 'Caution acquise')));
  UPDATE media SET deposit_status = 'FORFEITED', deposit_held = 0 WHERE id = p_media;
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['media_batch_status_history'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
                     USING (operator_id = current_setting('app.operator_id', true)::uuid)$p$, t);
  END LOOP;
END $$;
-- Lignes de niveau plateforme (operator_id NULL) : lisibles par tous les prestataires, jamais modifiables par eux.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['config_version','fee_rule'] LOOP
    EXECUTE format('DROP POLICY tenant_isolation ON %I', t);
    EXECUTE format($p$CREATE POLICY tenant_read ON %I FOR SELECT
                     USING (operator_id IS NULL OR operator_id = current_setting('app.operator_id', true)::uuid)$p$, t);
    EXECUTE format($p$CREATE POLICY tenant_write ON %I FOR ALL
                     USING (operator_id = current_setting('app.operator_id', true)::uuid)
                     WITH CHECK (operator_id = current_setting('app.operator_id', true)::uuid)$p$, t);
  END LOOP;
END $$;
-- Parties : un prestataire voit les siennes, sa propre fiche et la plateforme. Les autres prestataires sont invisibles.
ALTER TABLE party ENABLE ROW LEVEL SECURITY;
ALTER TABLE party FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_read ON party FOR SELECT
  USING (operator_id = current_setting('app.operator_id', true)::uuid
         OR id = current_setting('app.operator_id', true)::uuid
         OR kind = 'PLATFORM');
CREATE POLICY tenant_write ON party FOR ALL
  USING (operator_id = current_setting('app.operator_id', true)::uuid)
  WITH CHECK (operator_id = current_setting('app.operator_id', true)::uuid);

-- 16. Cloisonnement des fonctions privilégiées ---------------------------------------------
-- Les fonctions SECURITY DEFINER contournent la Row Level Security : chacune vérifie donc d'abord que
-- l'objet manipulé appartient au prestataire de la session (app.operator_id). Sinon : erreur neutre,
-- identique à « n'existe pas », pour ne rien révéler (ni existence, ni solde) d'un autre prestataire.
CREATE FUNCTION assert_tenant(p_operator uuid) RETURNS void
LANGUAGE plpgsql STABLE AS $$
BEGIN
  IF p_operator IS NULL
     OR p_operator IS DISTINCT FROM nullif(current_setting('app.operator_id', true), '')::uuid THEN
    RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found';
  END IF;
END $$;
CREATE FUNCTION tenant_of_ledger(p uuid) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
  $$ SELECT operator_id FROM ledger WHERE id = p $$;
CREATE FUNCTION tenant_of_media(p uuid) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
  $$ SELECT operator_id FROM media WHERE id = p $$;
CREATE FUNCTION tenant_of_wallet(p uuid) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
  $$ SELECT operator_id FROM wallet WHERE id = p $$;
CREATE FUNCTION tenant_of_batch(p uuid) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
  $$ SELECT operator_id FROM media_batch WHERE id = p $$;
CREATE FUNCTION tenant_of_event(p uuid) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
  $$ SELECT operator_id FROM event WHERE id = p $$;

-- Les vues s'exécutent avec les droits de l'appelant : la Row Level Security s'y applique aussi
ALTER VIEW trial_balance          SET (security_invoker = true);
ALTER VIEW party_position         SET (security_invoker = true);
ALTER VIEW ledger_invariant       SET (security_invoker = true);
ALTER VIEW hot_account_side_check SET (security_invoker = true);
ALTER VIEW balance_drift          SET (security_invoker = true);
ALTER VIEW counter_time_inversion SET (security_invoker = true);
ALTER VIEW batch_inventory        SET (security_invoker = true);

-- 16b. Identification du festivalier (S24, ADR-38, ADR-54) -----------------------------------------
-- Le niveau d'identification est porté par le CLIENT et calculé à chaque usage : VERIFIED tant qu'il existe une
-- identification non révoquée dont la pièce n'est pas expirée. Rien n'est stocké sur le portefeuille.
CREATE TABLE kyc_verification (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id    uuid NOT NULL REFERENCES party(id),
  customer_id    uuid NOT NULL REFERENCES party(id),
  wallet_id      uuid REFERENCES wallet(id),            -- portefeuille présenté au guichet (information)
  method         text NOT NULL DEFAULT 'DESK' CHECK (method IN ('DESK','ONLINE')),   -- ONLINE : réservé (V2)
  agent_id       uuid NOT NULL,                         -- CASHIER ou ORGANIZER_ADMIN (DESK) ; l'API refuse un agent titulaire
  id_type        text NOT NULL CHECK (id_type IN ('NATIONAL_ID','PASSPORT','RESIDENCE_PERMIT','DRIVING_LICENCE','OTHER')),
  id_country     char(2) NOT NULL,
  id_last4       text NOT NULL CHECK (id_last4 ~ '^[0-9A-Z]{1,4}$'),   -- 4 derniers caractères seulement
  id_expires_on  date NOT NULL,
  status         text NOT NULL DEFAULT 'VERIFIED' CHECK (status IN ('VERIFIED','REVOKED')),
  verified_at    timestamptz NOT NULL DEFAULT now(),
  revoked_at     timestamptz,
  revoked_by     uuid,
  revoked_reason text,
  CHECK ((status = 'REVOKED') = (revoked_at IS NOT NULL AND revoked_by IS NOT NULL AND revoked_reason IS NOT NULL))
);
CREATE INDEX ON kyc_verification (customer_id) WHERE status = 'VERIFIED';
-- Ajout seul ; seule la révocation (VERIFIED -> REVOKED, avec auteur et motif) est permise.
CREATE FUNCTION kyc_verification_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.status <> 'VERIFIED' OR NEW.status <> 'REVOKED'
     OR (to_jsonb(NEW) - ARRAY['status','revoked_at','revoked_by','revoked_reason'])
        <> (to_jsonb(OLD) - ARRAY['status','revoked_at','revoked_by','revoked_reason']) THEN
    RAISE EXCEPTION 'Table kyc_verification en ajout seul : seule la révocation est permise';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER kyc_verification_append_only BEFORE UPDATE OR DELETE ON kyc_verification
  FOR EACH ROW EXECUTE FUNCTION kyc_verification_guard();

CREATE FUNCTION customer_kyc_level(p_customer uuid, p_on date DEFAULT current_date) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN EXISTS (SELECT 1 FROM kyc_verification k
                            WHERE k.customer_id = p_customer AND k.id_expires_on >= p_on
                              -- niveau À LA DATE p_on (revue 2, M1) : vérifié avant, pas encore révoqué à cette date
                              AND k.verified_at::date <= p_on
                              AND (k.status = 'VERIFIED' OR k.revoked_at::date > p_on)
                              AND k.operator_id = nullif(current_setting('app.operator_id', true), '')::uuid)
              THEN 'VERIFIED' ELSE 'NONE' END
$$;
-- Portefeuille anonyme (sans client) : NONE
CREATE FUNCTION wallet_kyc_level(p_wallet uuid, p_on date DEFAULT current_date) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((SELECT customer_kyc_level(w.customer_id, p_on) FROM wallet w
                    WHERE w.id = p_wallet AND w.customer_id IS NOT NULL), 'NONE')
$$;
ALTER TABLE kyc_verification ENABLE ROW LEVEL SECURITY;
ALTER TABLE kyc_verification FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON kyc_verification USING (operator_id = current_setting('app.operator_id', true)::uuid);

-- 17. Plafonds réglementaires et multi-devises ------------------------------------------------
CREATE FUNCTION wallet_currency(p_wallet uuid) RETURNS char(3) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
  $$ SELECT l.currency FROM wallet w JOIN ledger l ON l.id = w.ledger_id WHERE w.id = p_wallet $$;

-- Profil de législation d'un grand livre : celui de l'événement, sinon la dernière version du pays de l'émetteur
CREATE FUNCTION ledger_jurisdiction(p_ledger uuid) RETURNS jurisdiction_profile
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT j.* FROM jurisdiction_profile j
   WHERE j.id = (SELECT e.jurisdiction_id FROM ledger l JOIN event e ON l.scope_type = 'EVENT' AND e.id = l.scope_id
                  WHERE l.id = p_ledger)
  UNION ALL
  SELECT * FROM (SELECT j.* FROM ledger l JOIN party p ON p.id = l.issuer_id
                   JOIN jurisdiction_profile j ON j.country_code = p.country_code
                  WHERE l.id = p_ledger ORDER BY j.version DESC LIMIT 1) x
  LIMIT 1
$$;

-- Appelée par post_transaction : solde maximal et total mensuel des recharges, selon l'identification du titulaire.
-- Mois calendaire UTC. Seules les recharges (TOPUP, TOPUP_CASH) comptent dans le total mensuel.
CREATE FUNCTION check_wallet_limits(p_ledger uuid, p_tx uuid, p_type text, p_occurred timestamptz) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE j jurisdiction_profile; r record; cap bigint; mcap bigint; month_total bigint;
BEGIN
  j := ledger_jurisdiction(p_ledger);
  IF j.id IS NULL THEN RETURN; END IF;
  FOR r IN
    SELECT a.id AS account_id, w.id AS wallet_id, wallet_kyc_level(w.id, p_occurred::date) AS kyc_level, -ab.balance AS paid_balance
      FROM posting p JOIN account a ON a.id = p.account_id AND a.purpose = 'WALLET_PAID'
      JOIN wallet w ON w.id = a.wallet_id JOIN account_balance ab ON ab.account_id = a.id
     WHERE p.transaction_id = p_tx
     GROUP BY a.id, w.id, ab.balance
    HAVING sum(p.amount) < 0                                   -- portefeuille crédité par cette transaction
  LOOP
    cap  := CASE r.kyc_level WHEN 'VERIFIED' THEN j.max_wallet_balance ELSE j.unidentified_max_balance END;
    mcap := CASE r.kyc_level WHEN 'VERIFIED' THEN j.identified_monthly_limit ELSE j.unidentified_monthly_limit END;
    -- plafond de solde : seulement pour les apports d'argent nouveau (une annulation ou une caution rendue restitue un solde)
    IF cap IS NOT NULL AND p_type IN ('TOPUP','TOPUP_CASH','ADJUSTMENT') AND r.paid_balance > cap THEN
      RAISE EXCEPTION 'Plafond de solde dépassé (% > %, identification %)', r.paid_balance, cap, r.kyc_level
        USING ERRCODE = 'CL008';
    END IF;
    IF mcap IS NOT NULL AND p_type IN ('TOPUP','TOPUP_CASH') THEN
      SELECT coalesce(-sum(p.amount), 0) INTO month_total
        FROM posting p JOIN journal_transaction t ON t.id = p.transaction_id
       WHERE p.account_id = r.account_id AND p.amount < 0 AND t.type IN ('TOPUP','TOPUP_CASH')
         AND date_trunc('month', t.occurred_at AT TIME ZONE 'UTC') = date_trunc('month', p_occurred AT TIME ZONE 'UTC');
      IF month_total > mcap THEN
        RAISE EXCEPTION 'Plafond mensuel de recharge dépassé (% > %, identification %)', month_total, mcap, r.kyc_level
          USING ERRCODE = 'CL009';
      END IF;
    END IF;
  END LOOP;
END $$;

-- Marge de recharge d'un portefeuille (ADR-63) : montant maximal qu'une recharge peut encore créditer à la date
-- donnée, au regard du plafond de solde et du plafond mensuel (NULL = aucun plafond). Sert à découper une recharge
-- en espèces hors ligne qui dépasse un plafond : le portefeuille reçoit la marge, le reste va en CUSTOMER_CASH_DUE.
-- Revue 2 (DB-I10) : verrouille le solde du portefeuille jusqu'à la fin de la transaction, pour que la marge
-- calculée reste vraie jusqu'à l'écriture découpée qui suit (appeler dans la MÊME transaction).
-- p_occurred est obligatoire : c'est la date de l'opération (hors ligne : date corrigée), pas la date de réception.
CREATE FUNCTION wallet_topup_headroom(p_wallet uuid, p_occurred timestamptz) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE w wallet%ROWTYPE; j jurisdiction_profile; acc uuid; lvl text; cap bigint; mcap bigint; bal bigint; mtot bigint;
        h bigint := NULL;
BEGIN
  PERFORM assert_tenant(tenant_of_wallet(p_wallet));
  SELECT * INTO w FROM wallet WHERE id = p_wallet;
  j := ledger_jurisdiction(w.ledger_id);
  IF j.id IS NULL THEN RETURN NULL; END IF;
  SELECT id INTO acc FROM account WHERE wallet_id = p_wallet AND purpose = 'WALLET_PAID';
  INSERT INTO account_balance (account_id, operator_id) VALUES (acc, w.operator_id) ON CONFLICT (account_id) DO NOTHING;
  PERFORM 1 FROM account_balance WHERE account_id = acc FOR UPDATE;
  lvl := wallet_kyc_level(p_wallet, p_occurred::date);
  cap  := CASE lvl WHEN 'VERIFIED' THEN j.max_wallet_balance ELSE j.unidentified_max_balance END;
  mcap := CASE lvl WHEN 'VERIFIED' THEN j.identified_monthly_limit ELSE j.unidentified_monthly_limit END;
  SELECT coalesce(-sum(amount), 0) INTO bal FROM posting WHERE account_id = acc;
  IF cap IS NOT NULL THEN h := greatest(cap - bal, 0); END IF;
  IF mcap IS NOT NULL THEN
    SELECT coalesce(-sum(p.amount), 0) INTO mtot
      FROM posting p JOIN journal_transaction t ON t.id = p.transaction_id
     WHERE p.account_id = acc AND p.amount < 0 AND t.type IN ('TOPUP','TOPUP_CASH')
       AND date_trunc('month', t.occurred_at AT TIME ZONE 'UTC') = date_trunc('month', p_occurred AT TIME ZONE 'UTC');
    h := least(coalesce(h, greatest(mcap - mtot, 0)), greatest(mcap - mtot, 0));
  END IF;
  RETURN h;
END $$;

-- Rendu au guichet des espèces dues à un détenteur (revue 2, API-B2 / DB-I11, ADR-63).
-- Le montant est celui des anomalies CASH_TOPUP_OVER_LIMIT OUVERTES du bracelet (jamais un montant libre) : le
-- compte L-ESP-A-RENDRE est commun, ce contrôle par bracelet empêche de rendre à l'un ce qui est dû à un autre.
-- Paiement en ESPÈCES uniquement (compte de caisse). Au-delà de event.cash_refund_single_max : seconde personne.
-- Écriture WALLET_REFUND : débit L-ESP-A-RENDRE (CUSTOMER_CASH_DUE), crédit caisse ; anomalies closes.
CREATE FUNCTION refund_cash_due(p_media uuid, p_cash_account uuid, p_key text, p_actor uuid,
                                p_approver uuid DEFAULT NULL, p_device uuid DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE amt bigint; lg uuid; due uuid; cash account%ROWTYPE; lim bigint; tx uuid; n int;
BEGIN
  PERFORM assert_tenant(tenant_of_media(p_media));
  IF p_actor IS NULL THEN RAISE EXCEPTION 'Auteur obligatoire' USING ERRCODE = 'CL001'; END IF;
  PERFORM 1 FROM media WHERE id = p_media FOR UPDATE;
  -- rejeu de la même demande : même clé, même résultat
  SELECT t.id INTO tx FROM journal_transaction t JOIN anomaly a ON a.resolution_tx_id = t.id
   WHERE a.media_id = p_media AND t.idempotency_key = p_key LIMIT 1;
  IF tx IS NOT NULL THEN RETURN tx; END IF;
  SELECT count(*), coalesce(sum(amount), 0), min(ledger_id::text)::uuid INTO n, amt, lg
    FROM (SELECT amount, ledger_id FROM anomaly
           WHERE media_id = p_media AND kind = 'CASH_TOPUP_OVER_LIMIT' AND status = 'OPEN' FOR UPDATE) x;
  IF amt <= 0 THEN RAISE EXCEPTION 'Aucune somme en espèces due pour ce bracelet' USING ERRCODE = 'CL020'; END IF;
  SELECT id INTO due FROM account WHERE ledger_id = lg AND purpose = 'CUSTOMER_CASH_DUE';
  SELECT * INTO cash FROM account WHERE id = p_cash_account;
  IF due IS NULL OR cash.ledger_id IS DISTINCT FROM lg OR cash.family <> 'ASSET' OR cash.purpose <> 'CASH_DESK' THEN
    RAISE EXCEPTION 'Rendu en espèces : compte de caisse du même grand livre requis' USING ERRCODE = 'CL001';
  END IF;
  SELECT e.cash_refund_single_max INTO lim FROM ledger l JOIN event e ON e.id = l.scope_id AND l.scope_type = 'EVENT' WHERE l.id = lg;
  IF amt > coalesce(lim, 0) AND (p_approver IS NULL OR p_approver = p_actor) THEN
    RAISE EXCEPTION 'Rendu de % au-delà de % : seconde personne obligatoire', amt, coalesce(lim, 0) USING ERRCODE = 'check_violation';
  END IF;
  tx := post_transaction(lg, 'WALLET_REFUND', p_key, clock_timestamp(), 'ONLINE',
          jsonb_build_array(jsonb_build_object('account_id', due, 'amount', amt, 'memo', 'Espèces dues rendues au guichet'),
                            jsonb_build_object('account_id', p_cash_account, 'amount', -amt, 'memo', 'Espèces dues rendues au guichet')),
          NULL, NULL, p_actor, CASE WHEN amt > coalesce(lim, 0) THEN p_approver END, NULL, p_device, p_media);
  UPDATE anomaly SET status = 'RESOLVED', resolution_tx_id = tx
   WHERE media_id = p_media AND kind = 'CASH_TOPUP_OVER_LIMIT' AND status = 'OPEN';
  RETURN tx;
END $$;

-- Rattacher un portefeuille d'une AUTRE devise à un bracelet déjà actif (organisateur multi-devises)
CREATE FUNCTION attach_wallet(p_media uuid, p_wallet uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE m media%ROWTYPE;
BEGIN
  PERFORM assert_tenant(tenant_of_media(p_media)); PERFORM assert_tenant(tenant_of_wallet(p_wallet));
  SELECT * INTO m FROM media WHERE id = p_media FOR UPDATE;
  IF m.status <> 'ACTIVE' THEN RAISE EXCEPTION 'Le bracelet doit être actif' USING ERRCODE = 'CL020'; END IF;
  INSERT INTO media_assignment (operator_id, media_id, wallet_id, currency, token_hash)
  VALUES (m.operator_id, m.id, p_wallet, wallet_currency(p_wallet), m.token_hash);   -- l'index unique refuse une 2e devise identique
END $$;

-- Portefeuille à débiter pour un paiement : celui de la devise de l'événement du terminal
CREATE FUNCTION media_wallet(p_media uuid, p_currency char(3)) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT wallet_id FROM media_assignment
   WHERE media_id = p_media AND currency = p_currency AND released_at IS NULL
     AND operator_id = nullif(current_setting('app.operator_id', true), '')::uuid
$$;

-- 17b. Bascule de l'autorité de débit (passerelle locale) ------------------------------------
-- Verrou EXCLUSIF : attend les écritures en vol (verrou partagé pris par post_transaction), puis bascule.
-- Retourne la nouvelle époque ; les terminaux et la passerelle rejettent toute réponse d'une époque plus ancienne.
CREATE FUNCTION set_debit_authority(p_ledger uuid, p_authority text, p_gateway uuid DEFAULT NULL) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE e int;
BEGIN
  PERFORM assert_tenant(tenant_of_ledger(p_ledger));
  IF p_authority NOT IN ('CENTRAL','EDGE') OR (p_authority = 'EDGE') <> (p_gateway IS NOT NULL) THEN
    RAISE EXCEPTION 'Autorité invalide : EDGE exige une passerelle, CENTRAL n''en prend pas';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('debit-authority:' || p_ledger, 0));
  UPDATE ledger SET debit_authority = p_authority, edge_gateway_id = p_gateway, authority_epoch = authority_epoch + 1
   WHERE id = p_ledger RETURNING authority_epoch INTO e;
  RETURN e;
END $$;

-- =====================================================================================================
-- 18. Compléments critiques : numérotation des terminaux, lots hors ligne, snapshots signés, politiques
--     servies, bascule vers la passerelle, registre de la passerelle, scellement du journal.
--     Normatif (ADR-47). Référence : sync_protocol.md §3, §4, §6, §7, §9 ; SPECIFICATION §9, §13.7, §14.
--     Encodage des identifiants dans les empreintes : les 16 octets bruts de l'UUID (uuid_send).
-- =====================================================================================================

-- 18a. Codes d'erreur de cette section (traduits en ProblemCode par l'API, SPECIFICATION §5.7)
--   CL010 BATCH_IN_PROGRESS    un lot est déjà en cours de traitement pour ce terminal
--   CL011 BATCH_TOO_LARGE      lot vide ou de plus de 500 opérations
--   CL012 SEQ_GAP_NOT_FOUND    levée d'un numéro qui n'est pas un trou
--   CL013 HANDOVER_INVALID_STATE  bascule dans un état qui ne permet pas l'action
--   CL014 EDGE_NOT_CAUGHT_UP   passerelle en retard (filigrane non atteint, edge_seq manquants)
--   CL015 STALE_AUTHORITY_EPOCH  époque d'autorité différente de l'époque courante
--   CL016 SEQ_OUT_OF_ORDER     edge_seq qui n'est pas le suivant attendu
--   CL017 CHAIN_BROKEN         empreinte de chaîne différente de celle calculée par le central
--   CL020 MEDIA_STATE_INVALID  bracelet ou lot dans un état qui ne permet pas l'action (remplacement, lot...)
--   CL021 SEQ_OUT_OF_RANGE     numéro de séquence trop loin devant le dernier numéro continu (max_seq_jump)
--   CL022 TAP_UNUSABLE         passage déjà utilisé par une autre écriture, ou expiré (consume_tap)
--   CL023 APPROVAL_INVALID     demande d'approbation expirée, déjà décidée, décidée par son auteur (18h)
--   CL024 LATE_CLAIM_INVALID   annulation de casse ou réclamation tardive hors bornes (check_late_claim, ADR-75)

CREATE FUNCTION chain_step(p_prev bytea, p_content bytea) RETURNS bytea
LANGUAGE sql IMMUTABLE STRICT AS $$ SELECT sha256(p_prev || p_content) $$;
-- Départ de la chaîne d'un terminal : chain_hash(0) = SHA-256("CASHLESS/CHAIN/v1" ‖ device_id)
CREATE FUNCTION device_chain_genesis(p_device uuid) RETURNS bytea
LANGUAGE sql IMMUTABLE STRICT AS $$ SELECT sha256(convert_to('CASHLESS/CHAIN/v1', 'UTF8') || uuid_send(p_device)) $$;
-- Départ de la chaîne d'une passerelle : SHA-256("CASHLESS/EDGE-CHAIN/v1" ‖ gateway_id)
CREATE FUNCTION edge_chain_genesis(p_gateway uuid) RETURNS bytea
LANGUAGE sql IMMUTABLE STRICT AS $$ SELECT sha256(convert_to('CASHLESS/EDGE-CHAIN/v1', 'UTF8') || uuid_send(p_gateway)) $$;

CREATE FUNCTION tenant_of_device(p uuid) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
  $$ SELECT operator_id FROM device WHERE id = p $$;
CREATE FUNCTION tenant_of_gateway(p uuid) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
  $$ SELECT operator_id FROM edge_gateway WHERE id = p $$;

-- Saut maximal accepté entre le dernier numéro continu d'un terminal et un numéro reçu (revue 2, DB-B3).
-- Au-delà : terminal défaillant ou message forgé ; sans borne, un seul numéro énorme créerait un milliard
-- d'anomalies SEQ_GAP. Valeur de plateforme, modifiable ici.
CREATE FUNCTION max_seq_jump() RETURNS bigint LANGUAGE sql IMMUTABLE AS $$ SELECT 10000::bigint $$;

-- Une seule anomalie SEQ_GAP par numéro manquant
CREATE UNIQUE INDEX anomaly_seq_gap_once ON anomaly (device_id, seq) WHERE kind = 'SEQ_GAP';

-- 18b. Registre des numéros de séquence (S6) ------------------------------------------------------------
-- Source de vérité de l'idempotence des lots et des trous. Écrit dans la MÊME transaction SQL que l'écriture
-- comptable éventuelle, pour toute réponse finale portant une clé <serial>:<seq> (en ligne, lot, passerelle).
CREATE TABLE device_seq_registry (
  operator_id    uuid NOT NULL REFERENCES party(id),
  device_id      uuid NOT NULL REFERENCES device(id),
  seq            bigint NOT NULL CHECK (seq >= 1),
  content_sha256 bytea CHECK (octet_length(content_sha256) = 32),   -- H(JCS(champs chaînés)), sync_protocol §3.3
  outcome        text NOT NULL CHECK (outcome IN ('ACCEPTED','ACCEPTED_WITH_SHORTFALL','DUPLICATE','REJECTED','VOID','WAIVED')),
  reason         text,                                  -- raison du rejet (§7.2) ou de la levée
  transaction_id uuid REFERENCES journal_transaction(id),
  channel        text NOT NULL CHECK (channel IN ('ONLINE','BATCH','EDGE','WAIVER')),
  batch_id       uuid,                                  -- lot hors ligne d'origine (channel BATCH)
  created_by     uuid,                                  -- WAIVED : superviseur
  approved_by    uuid,                                  -- WAIVED : seconde personne
  recorded_at    timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (device_id, seq),
  CHECK ((outcome = 'WAIVED') = (channel = 'WAIVER')),
  CHECK ((outcome = 'WAIVED') = (content_sha256 IS NULL)),
  CHECK (outcome <> 'WAIVED' OR (created_by IS NOT NULL AND approved_by IS NOT NULL
                                 AND approved_by <> created_by AND reason IS NOT NULL)),
  CHECK (outcome <> 'REJECTED' OR reason IS NOT NULL),
  CHECK (outcome NOT IN ('ACCEPTED_WITH_SHORTFALL','DUPLICATE') OR transaction_id IS NOT NULL),
  CHECK (outcome NOT IN ('REJECTED','VOID','WAIVED') OR transaction_id IS NULL)
);
CREATE TRIGGER device_seq_registry_immutable BEFORE UPDATE OR DELETE ON device_seq_registry
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- Fait avancer contiguous_acked_seq jusqu'à la fin de la plage continue (appelant : verrou sur le terminal)
CREATE FUNCTION advance_device_seq(p_device uuid) RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE c bigint; n bigint;
BEGIN
  SELECT contiguous_acked_seq INTO c FROM device WHERE id = p_device;
  IF NOT EXISTS (SELECT 1 FROM device_seq_registry WHERE device_id = p_device AND seq = c + 1) THEN RETURN c; END IF;
  -- fin de la plage qui commence en c+1 : premier numéro > c sans successeur
  SELECT min(r.seq) INTO n FROM device_seq_registry r
   WHERE r.device_id = p_device AND r.seq > c
     AND NOT EXISTS (SELECT 1 FROM device_seq_registry r2 WHERE r2.device_id = p_device AND r2.seq = r.seq + 1);
  UPDATE device SET contiguous_acked_seq = n WHERE id = p_device;
  RETURN n;
END $$;

-- Enregistre le résultat final d'un numéro. Idempotent : même numéro et même contenu -> résultat mémorisé
-- (replayed = true) ; même numéro, autre contenu -> CL002. Renvoie aussi contiguous_acked_seq à jour.
CREATE FUNCTION record_device_seq(p_device uuid, p_seq bigint, p_content bytea, p_outcome text, p_channel text,
                                  p_tx uuid DEFAULT NULL, p_reason text DEFAULT NULL, p_batch uuid DEFAULT NULL)
RETURNS TABLE (replayed boolean, outcome text, reason text, transaction_id uuid, contiguous_acked_seq bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE d device%ROWTYPE; r device_seq_registry%ROWTYPE;
BEGIN
  PERFORM assert_tenant(tenant_of_device(p_device));
  SELECT * INTO d FROM device WHERE id = p_device FOR UPDATE;      -- sérialise les écritures d'un même terminal
  SELECT * INTO r FROM device_seq_registry WHERE device_id = p_device AND seq = p_seq;
  IF FOUND THEN
    IF r.content_sha256 IS DISTINCT FROM p_content THEN
      RAISE EXCEPTION 'Numéro % du terminal % déjà enregistré avec un contenu différent', p_seq, d.serial
        USING ERRCODE = 'CL002';
    END IF;
    RETURN QUERY SELECT true, r.outcome, r.reason, r.transaction_id, d.contiguous_acked_seq;
    RETURN;
  END IF;
  IF p_outcome = 'WAIVED' OR p_channel = 'WAIVER' THEN
    RAISE EXCEPTION 'Un trou se lève uniquement par waive_seq_gap' USING ERRCODE = 'CL001';
  END IF;
  IF p_seq > d.contiguous_acked_seq + max_seq_jump() THEN
    RAISE EXCEPTION 'Numéro % du terminal % hors plage (dernier continu %, saut max %)', p_seq, d.serial,
      d.contiguous_acked_seq, max_seq_jump() USING ERRCODE = 'CL021';
  END IF;
  IF p_tx IS NOT NULL THEN
    PERFORM assert_tenant((SELECT t.operator_id FROM journal_transaction t WHERE t.id = p_tx));
  END IF;
  INSERT INTO device_seq_registry (operator_id, device_id, seq, content_sha256, outcome, reason, transaction_id, channel, batch_id)
  VALUES (d.operator_id, p_device, p_seq, p_content, p_outcome, p_reason, p_tx, p_channel, p_batch);
  UPDATE device SET last_seq = greatest(last_seq, p_seq), last_seen_at = now() WHERE id = p_device;
  -- numéro renvoyé après avoir été signalé manquant : l'anomalie SEQ_GAP est close
  UPDATE anomaly SET status = 'RESOLVED' WHERE device_id = p_device AND seq = p_seq AND kind = 'SEQ_GAP' AND status = 'OPEN';
  RETURN QUERY SELECT false, p_outcome, p_reason, p_tx, advance_device_seq(p_device);
END $$;

-- Numéros manquants entre contiguous_acked_seq et le plus grand numéro reçu (réponse missing_seqs)
CREATE FUNCTION device_missing_seqs(p_device uuid, p_limit int DEFAULT 1000) RETURNS SETOF bigint
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM assert_tenant(tenant_of_device(p_device));
  RETURN QUERY
    SELECT s FROM device d, generate_series(d.contiguous_acked_seq + 1, d.last_seq) s
     WHERE d.id = p_device
       AND NOT EXISTS (SELECT 1 FROM device_seq_registry r WHERE r.device_id = d.id AND r.seq = s)
     ORDER BY s LIMIT p_limit;
END $$;

-- Levée d'un numéro définitivement perdu : deux personnes (contrainte du registre), clôt l'anomalie SEQ_GAP
CREATE FUNCTION waive_seq_gap(p_device uuid, p_seq bigint, p_actor uuid, p_approver uuid, p_reason text)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d device%ROWTYPE; c bigint;
BEGIN
  PERFORM assert_tenant(tenant_of_device(p_device));
  SELECT * INTO d FROM device WHERE id = p_device FOR UPDATE;
  IF p_seq <= d.contiguous_acked_seq OR p_seq > d.last_seq
     OR EXISTS (SELECT 1 FROM device_seq_registry WHERE device_id = p_device AND seq = p_seq) THEN
    RAISE EXCEPTION 'Le numéro % du terminal % n''est pas un trou', p_seq, d.serial USING ERRCODE = 'CL012';
  END IF;
  -- Un lot en cours de traitement couvre ce numéro : il va peut-être arriver (revue 2, DB-I12)
  IF EXISTS (SELECT 1 FROM offline_batch WHERE device_id = p_device AND status = 'PROCESSING'
               AND p_seq BETWEEN seq_from AND seq_to) THEN
    RAISE EXCEPTION 'Numéro % en cours de traitement dans un lot' , p_seq USING ERRCODE = 'CL010';
  END IF;
  INSERT INTO device_seq_registry (operator_id, device_id, seq, outcome, reason, channel, created_by, approved_by)
  VALUES (d.operator_id, p_device, p_seq, 'WAIVED', p_reason, 'WAIVER', p_actor, p_approver);
  UPDATE anomaly SET status = 'RESOLVED' WHERE device_id = p_device AND seq = p_seq AND kind = 'SEQ_GAP' AND status = 'OPEN';
  c := advance_device_seq(p_device);
  PERFORM advance_device_chain(p_device);
  RETURN c;
END $$;

-- 18c. Lots hors ligne (S7) ------------------------------------------------------------------------------
-- Un lot = numéros continus seq_from..seq_to d'un terminal, signé et chaîné. Un seul lot en cours par terminal.
-- Chaîne (sync_protocol §3.3) : chain(n) = SHA-256(chain(n-1) ‖ content_sha256(n)), chain(0) = device_chain_genesis.
-- chain_status : VERIFIED (prev_chain_hash = dernière empreinte connue du central), PENDING (un lot antérieur
-- manque encore : vérifié à son arrivée), RESENT (numéros tous déjà couverts : contenu contrôlé op par op par
-- le registre ; un lot qui chevauche le curseur est vérifié au point de raccord), UNVERIFIABLE (suit un numéro levé par waive_seq_gap), BROKEN (rupture : anomalie CHAIN_BROKEN).
CREATE TABLE offline_batch (
  id              uuid PRIMARY KEY,                     -- batch_id choisi par le terminal (idempotence du POST)
  operator_id     uuid NOT NULL REFERENCES party(id),
  device_id       uuid NOT NULL REFERENCES device(id),
  ledger_id       uuid NOT NULL REFERENCES ledger(id),
  received_via    text NOT NULL DEFAULT 'CENTRAL' CHECK (received_via IN ('CENTRAL','EDGE')),
  seq_from        bigint NOT NULL CHECK (seq_from >= 1),
  seq_to          bigint NOT NULL,
  op_hashes       bytea[] NOT NULL,                     -- content_sha256 des opérations, dans l'ordre des seq
  prev_chain_hash bytea NOT NULL CHECK (octet_length(prev_chain_hash) = 32),
  last_chain_hash bytea NOT NULL CHECK (octet_length(last_chain_hash) = 32),
  signature       bytea NOT NULL,                       -- signature du terminal sur JCS(header), vérifiée par l'API
  status          text NOT NULL DEFAULT 'PROCESSING' CHECK (status IN ('PROCESSING','COMPLETED','REJECTED')),
  reject_reason   text,
  chain_status    text NOT NULL CHECK (chain_status IN ('VERIFIED','PENDING','RESENT','UNVERIFIABLE','BROKEN')),
  missing_seqs    bigint[] NOT NULL DEFAULT '{}',       -- trous constatés avant seq_from à l'ouverture
  results         jsonb,                                -- résultats mémorisés (GET /offline-batches/{id})
  received_at     timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at    timestamptz,
  CHECK (seq_to = seq_from + cardinality(op_hashes) - 1),
  CHECK (cardinality(op_hashes) BETWEEN 1 AND 500),
  CHECK ((status = 'REJECTED') = (reject_reason IS NOT NULL)),
  CHECK ((status = 'COMPLETED') = (completed_at IS NOT NULL AND results IS NOT NULL))
);
CREATE UNIQUE INDEX offline_batch_one_in_flight ON offline_batch (device_id) WHERE status = 'PROCESSING';
CREATE INDEX ON offline_batch (device_id, seq_from);
ALTER TABLE device_seq_registry ADD FOREIGN KEY (batch_id) REFERENCES offline_batch(id);

-- Rattrape la chaîne : tant qu'un lot déjà reçu commence juste après le curseur, le vérifier et avancer.
-- Un numéro levé juste après le curseur rend la suite invérifiable (empreinte inconnue).
CREATE FUNCTION advance_device_chain(p_device uuid) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE d device%ROWTYPE; b offline_batch%ROWTYPE; w bigint;
BEGIN
  SELECT * INTO d FROM device WHERE id = p_device;
  LOOP
    SELECT * INTO b FROM offline_batch
     WHERE device_id = p_device AND chain_status = 'PENDING' AND seq_from = d.last_chain_seq + 1 LIMIT 1;
    IF FOUND THEN
      IF d.last_chain_hash IS NOT NULL AND d.last_chain_hash <> b.prev_chain_hash THEN
        UPDATE offline_batch SET chain_status = 'BROKEN' WHERE id = b.id;
        INSERT INTO anomaly (operator_id, ledger_id, kind, device_id, seq, amount)
        VALUES (d.operator_id, b.ledger_id, 'CHAIN_BROKEN', p_device, b.seq_from, 0);
      ELSE
        UPDATE offline_batch SET chain_status = CASE WHEN d.last_chain_hash IS NULL THEN 'UNVERIFIABLE' ELSE 'VERIFIED' END
         WHERE id = b.id;
      END IF;
      d.last_chain_seq := b.seq_to; d.last_chain_hash := b.last_chain_hash;
      CONTINUE;
    END IF;
    SELECT max(seq) INTO w FROM device_seq_registry
     WHERE device_id = p_device AND outcome = 'WAIVED' AND seq = d.last_chain_seq + 1;
    IF w IS NOT NULL THEN
      d.last_chain_seq := w; d.last_chain_hash := NULL;
      CONTINUE;
    END IF;
    EXIT;
  END LOOP;
  UPDATE device SET last_chain_seq = d.last_chain_seq, last_chain_hash = d.last_chain_hash WHERE id = p_device;
END $$;

-- Ouverture d'un lot, avant le traitement des opérations (chacune : record_device_seq, dans sa transaction).
-- Idempotente sur batch_id. Chaîne rompue -> lot REJECTED (CHAIN_BROKEN) + anomalie, sans erreur SQL :
-- l'API répond 409 CHAIN_BROKEN et le lot n'est pas traité. Trous avant seq_from -> anomalies SEQ_GAP.
CREATE FUNCTION open_offline_batch(p_batch uuid, p_device uuid, p_ledger uuid, p_seq_from bigint,
                                   p_prev_chain_hash bytea, p_op_hashes bytea[], p_last_chain_hash bytea,
                                   p_signature bytea, p_via text DEFAULT 'CENTRAL')
RETURNS offline_batch
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d device%ROWTYPE; b offline_batch%ROWTYPE; hs bytea[]; expected bytea; cs text; miss bigint[]; n int; i int; k bigint;
BEGIN
  PERFORM assert_tenant(tenant_of_device(p_device));
  PERFORM assert_tenant(tenant_of_ledger(p_ledger));
  SELECT * INTO d FROM device WHERE id = p_device FOR UPDATE;
  IF d.status = 'REVOKED' THEN RAISE EXCEPTION 'Terminal révoqué' USING ERRCODE = 'insufficient_privilege'; END IF;
  SELECT * INTO b FROM offline_batch WHERE id = p_batch;
  IF FOUND THEN
    IF b.device_id <> p_device OR b.seq_from <> p_seq_from OR b.op_hashes <> p_op_hashes
       OR b.prev_chain_hash <> p_prev_chain_hash THEN
      RAISE EXCEPTION 'Lot % déjà reçu avec un contenu différent', p_batch USING ERRCODE = 'CL002';
    END IF;
    RETURN b;                                            -- renvoi du même lot
  END IF;
  n := coalesce(cardinality(p_op_hashes), 0);
  IF n < 1 OR n > 500 THEN RAISE EXCEPTION 'Lot de % opérations (1 à 500)', n USING ERRCODE = 'CL011'; END IF;
  IF p_seq_from + n - 1 > d.contiguous_acked_seq + max_seq_jump() THEN                 -- revue 2, DB-B3
    RAISE EXCEPTION 'Lot hors plage : numéros %..% (dernier continu %, saut max %)', p_seq_from, p_seq_from + n - 1,
      d.contiguous_acked_seq, max_seq_jump() USING ERRCODE = 'CL021';
  END IF;
  -- Lot resté en cours plus de 15 min (traitement interrompu, terminal parti) : abandonné pour ne pas bloquer
  -- le terminal (revue 2, M8). Ses numéros déjà enregistrés restent ; les autres deviennent des trous à renvoyer.
  UPDATE offline_batch SET status = 'REJECTED', reject_reason = 'ABANDONED'
   WHERE device_id = p_device AND status = 'PROCESSING' AND received_at < clock_timestamp() - interval '15 minutes';
  IF EXISTS (SELECT 1 FROM offline_batch WHERE device_id = p_device AND status = 'PROCESSING') THEN
    RAISE EXCEPTION 'Un lot est déjà en cours pour le terminal %', d.serial USING ERRCODE = 'CL010';
  END IF;
  -- cohérence interne : la chaîne recalculée depuis prev_chain_hash doit aboutir à last_chain_hash.
  -- hs[k+1] = empreinte de chaîne après les k premières opérations (hs[1] = prev_chain_hash).
  hs := ARRAY[p_prev_chain_hash];
  FOR i IN 1..n LOOP
    IF octet_length(p_op_hashes[i]) IS DISTINCT FROM 32 THEN
      RAISE EXCEPTION 'Empreinte d''opération invalide (rang %)', i USING ERRCODE = 'CL001';
    END IF;
    hs := array_append(hs, chain_step(hs[i], p_op_hashes[i]));
  END LOOP;
  -- raccord avec le curseur du central : k = nombre d'opérations du lot déjà couvertes par la chaîne connue
  k := d.last_chain_seq - p_seq_from + 1;
  IF hs[n + 1] <> p_last_chain_hash THEN
    cs := 'BROKEN';
  ELSIF k < 0 THEN
    cs := 'PENDING';                                     -- un lot antérieur manque encore
  ELSIF k >= n THEN
    cs := 'RESENT';                                      -- tout est déjà couvert
  ELSE
    expected := CASE WHEN d.last_chain_hash IS NOT NULL THEN d.last_chain_hash
                     WHEN d.last_chain_seq = 0 THEN device_chain_genesis(p_device) END;
    cs := CASE WHEN expected IS NULL THEN 'UNVERIFIABLE' WHEN expected = hs[k + 1] THEN 'VERIFIED' ELSE 'BROKEN' END;
  END IF;

  IF cs = 'BROKEN' THEN
    INSERT INTO offline_batch (id, operator_id, device_id, ledger_id, received_via, seq_from, seq_to, op_hashes,
                               prev_chain_hash, last_chain_hash, signature, status, reject_reason, chain_status)
    VALUES (p_batch, d.operator_id, p_device, p_ledger, p_via, p_seq_from, p_seq_from + n - 1, p_op_hashes,
            p_prev_chain_hash, p_last_chain_hash, p_signature, 'REJECTED', 'CHAIN_BROKEN', 'BROKEN')
    RETURNING * INTO b;
    INSERT INTO anomaly (operator_id, ledger_id, kind, device_id, seq, amount)
    VALUES (d.operator_id, p_ledger, 'CHAIN_BROKEN', p_device, p_seq_from, 0);
    RETURN b;
  END IF;

  -- numéros manquants avant le lot : le lot est traité quand même (I4), une anomalie par numéro
  SELECT coalesce(array_agg(s ORDER BY s), '{}') INTO miss
    FROM generate_series(d.contiguous_acked_seq + 1, p_seq_from - 1) s
   WHERE NOT EXISTS (SELECT 1 FROM device_seq_registry r WHERE r.device_id = p_device AND r.seq = s);
  INSERT INTO anomaly (operator_id, ledger_id, kind, device_id, seq, amount)
  SELECT d.operator_id, p_ledger, 'SEQ_GAP', p_device, s, 0 FROM unnest(miss) s
  ON CONFLICT (device_id, seq) WHERE kind = 'SEQ_GAP' DO NOTHING;

  INSERT INTO offline_batch (id, operator_id, device_id, ledger_id, received_via, seq_from, seq_to, op_hashes,
                             prev_chain_hash, last_chain_hash, signature, chain_status, missing_seqs)
  VALUES (p_batch, d.operator_id, p_device, p_ledger, p_via, p_seq_from, p_seq_from + n - 1, p_op_hashes,
          p_prev_chain_hash, p_last_chain_hash, p_signature, cs, miss)
  RETURNING * INTO b;
  IF cs IN ('VERIFIED','UNVERIFIABLE') THEN
    UPDATE device SET last_chain_seq = b.seq_to, last_chain_hash = p_last_chain_hash WHERE id = p_device;
    PERFORM advance_device_chain(p_device);
  END IF;
  RETURN b;
END $$;

-- Clôture : chaque numéro du lot DOIT avoir un résultat final au registre (invariant I2)
CREATE FUNCTION complete_offline_batch(p_batch uuid, p_results jsonb) RETURNS offline_batch
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b offline_batch%ROWTYPE; k bigint;
BEGIN
  PERFORM assert_tenant((SELECT operator_id FROM offline_batch WHERE id = p_batch));
  SELECT * INTO b FROM offline_batch WHERE id = p_batch FOR UPDATE;
  IF b.status = 'COMPLETED' THEN RETURN b; END IF;
  IF b.status <> 'PROCESSING' THEN RAISE EXCEPTION 'Lot % rejeté', p_batch USING ERRCODE = 'CL001'; END IF;
  SELECT min(s) INTO k FROM generate_series(b.seq_from, b.seq_to) s
   WHERE NOT EXISTS (SELECT 1 FROM device_seq_registry r WHERE r.device_id = b.device_id AND r.seq = s);
  IF k IS NOT NULL THEN
    RAISE EXCEPTION 'Lot % incomplet : numéro % sans résultat final', p_batch, k USING ERRCODE = 'CL001';
  END IF;
  UPDATE offline_batch SET status = 'COMPLETED', results = p_results, completed_at = clock_timestamp()
   WHERE id = p_batch RETURNING * INTO b;
  RETURN b;
END $$;

-- 18d. Snapshots signés (S8, S9) ------------------------------------------------------------------------
-- Clés de signature des snapshots. CENTRAL : clé du KMS, operator_id NULL (plateforme, lisible par tous) ou
-- propre à un prestataire. EDGE : clé d'une passerelle (dans son TPM), key_id distinct (sync_protocol §9.4).
CREATE TABLE snapshot_signing_key (
  key_id          text PRIMARY KEY,
  operator_id     uuid REFERENCES party(id),
  owner           text NOT NULL CHECK (owner IN ('CENTRAL','EDGE')),
  edge_gateway_id uuid REFERENCES edge_gateway(id),
  algorithm       text NOT NULL CHECK (algorithm IN ('ECDSA_P256_SHA256','Ed25519')),   -- choix : OP-N13
  public_key      bytea NOT NULL,
  kms_key_ref     text,                                   -- CENTRAL : référence KMS ; la clé privée n'en sort jamais
  status          text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('PENDING','ACTIVE','RETIRED','REVOKED')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  retired_at      timestamptz,
  CHECK ((owner = 'EDGE') = (edge_gateway_id IS NOT NULL)),
  CHECK (owner = 'CENTRAL' OR operator_id IS NOT NULL),
  CHECK (owner = 'EDGE' OR kms_key_ref IS NOT NULL)
);
-- une seule clé ACTIVE par signataire (central de la plateforme, central d'un prestataire, chaque passerelle)
CREATE UNIQUE INDEX snapshot_signing_key_one_active ON snapshot_signing_key
  (owner, coalesce(operator_id, '00000000-0000-0000-0000-000000000000'), coalesce(edge_gateway_id, '00000000-0000-0000-0000-000000000000'))
  WHERE status = 'ACTIVE';
ALTER TABLE offline_snapshot ADD FOREIGN KEY (key_id) REFERENCES snapshot_signing_key(key_id);

-- Contrôles d'un snapshot enregistré : version strictement croissante par grand livre, DELTA sur une version
-- connue, époque d'autorité courante, clé centrale ACTIVE, en-tête signé identique aux colonnes.
CREATE FUNCTION check_offline_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE lg ledger%ROWTYPE; k snapshot_signing_key%ROWTYPE; h jsonb := NEW.header;
BEGIN
  SELECT * INTO lg FROM ledger WHERE id = NEW.ledger_id;
  IF NEW.operator_id <> lg.operator_id THEN RAISE EXCEPTION 'Snapshot : prestataire incohérent' USING ERRCODE = 'CL001'; END IF;
  IF NEW.version <= coalesce((SELECT max(version) FROM offline_snapshot WHERE ledger_id = NEW.ledger_id), 0) THEN
    RAISE EXCEPTION 'Snapshot : version % non croissante pour ce grand livre', NEW.version USING ERRCODE = 'CL001';
  END IF;
  IF NEW.kind = 'DELTA' AND NOT EXISTS (SELECT 1 FROM offline_snapshot WHERE ledger_id = NEW.ledger_id AND version = NEW.base_version) THEN
    RAISE EXCEPTION 'Snapshot : version de base % inconnue', NEW.base_version USING ERRCODE = 'CL001';
  END IF;
  IF NEW.authority_epoch <> lg.authority_epoch THEN
    RAISE EXCEPTION 'Snapshot : époque % différente de l''époque courante %', NEW.authority_epoch, lg.authority_epoch
      USING ERRCODE = 'CL015';
  END IF;
  SELECT * INTO k FROM snapshot_signing_key WHERE key_id = NEW.key_id;
  IF k.status IS DISTINCT FROM 'ACTIVE' OR k.owner <> 'CENTRAL'
     OR (k.operator_id IS NOT NULL AND k.operator_id <> NEW.operator_id) THEN
    RAISE EXCEPTION 'Snapshot : clé de signature % non utilisable', NEW.key_id USING ERRCODE = 'CL001';
  END IF;
  IF h->>'format' IS DISTINCT FROM 'CASHLESS-SNAPSHOT/v1'
     OR h->>'kind' IS DISTINCT FROM NEW.kind
     OR (h->>'operator_id')::uuid IS DISTINCT FROM NEW.operator_id
     OR (h->>'ledger_id')::uuid IS DISTINCT FROM NEW.ledger_id
     OR (h->>'event_id')::uuid IS DISTINCT FROM NEW.event_id
     OR h->>'currency' IS DISTINCT FROM lg.currency::text
     OR (h->>'version')::bigint IS DISTINCT FROM NEW.version
     OR (h->>'base_version')::bigint IS DISTINCT FROM NEW.base_version
     OR (h->>'generated_at')::timestamptz IS DISTINCT FROM NEW.generated_at
     OR (h->>'valid_until')::timestamptz IS DISTINCT FROM NEW.valid_until
     OR (h->>'entries')::int IS DISTINCT FROM NEW.entries
     OR h->>'content_sha256' IS DISTINCT FROM encode(NEW.content_sha256, 'hex')
     OR (h->>'authority_epoch')::int IS DISTINCT FROM NEW.authority_epoch
     OR h->>'key_id' IS DISTINCT FROM NEW.key_id THEN
    RAISE EXCEPTION 'Snapshot : en-tête signé différent des colonnes' USING ERRCODE = 'CL001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER offline_snapshot_check BEFORE INSERT ON offline_snapshot
  FOR EACH ROW EXECUTE FUNCTION check_offline_snapshot();
CREATE TRIGGER offline_snapshot_immutable BEFORE UPDATE OR DELETE ON offline_snapshot
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- Contenu d'un snapshot hors ligne (S9) : ce qu'un terminal a le droit de savoir, rien de plus.
-- Le terminal applique les mêmes règles que le serveur : statut du bracelet, du lot et du portefeuille,
-- compteur strictement supérieur à last_counter, événement du lot.
-- Une ligne par rattachement ouvert (media_assignment) : un bracelet à deux portefeuilles (XOF, EUR)
-- figure dans le snapshot de chacun des deux grands livres, avec le solde de la devise concernée.
CREATE VIEW offline_snapshot_rows AS
SELECT m.operator_id, w.ledger_id, ma.currency, m.id AS media_id, m.token_hash, m.nfc_uid, m.key_index, m.status,
       mb.event_id AS batch_event_id, mb.status AS batch_status,   -- le terminal applique la même règle de validité hors ligne
       w.id AS wallet_id, w.status AS wallet_status,
       coalesce((SELECT -sum(ab.balance) FROM account a JOIN account_balance ab ON ab.account_id = a.id
                  WHERE a.wallet_id = w.id AND a.purpose IN ('WALLET_PAID','WALLET_PROMO')), 0) AS spendable,
       (SELECT max(t.counter) FROM media_tap t WHERE t.media_id = m.id) AS last_counter,   -- NULL : jamais lu
       m.pwd_pack_enc, m.pwd_pack_dek_id,                    -- rechiffrés pour le snapshot par le serveur (§9.4)
       m.originality_sig_sha256                              -- contrôle hors ligne de la signature lue (ADR-59)
FROM media_assignment ma
JOIN media m ON m.id = ma.media_id
JOIN wallet w ON w.id = ma.wallet_id
LEFT JOIN media_batch mb ON mb.id = m.batch_id
WHERE ma.released_at IS NULL;
ALTER VIEW offline_snapshot_rows SET (security_invoker = true);

-- 18e. Historique des politiques hors ligne et configurations servies (S10) ------------------------------
-- Une baisse de plafond ne rend pas fautive une opération faite avant que le terminal ne la reçoive :
-- le contrôle « plafonds en vigueur » (sync_protocol §7.2) se fait sur la configuration DÉTENUE par le terminal.
CREATE TABLE offline_policy_history (
  id                        bigserial PRIMARY KEY,
  operator_id               uuid NOT NULL REFERENCES party(id),
  policy_id                 uuid NOT NULL,
  scope_type                text NOT NULL,
  scope_id                  uuid NOT NULL,
  version                   int NOT NULL,
  deleted                   boolean NOT NULL DEFAULT false,
  offline_enabled           boolean,
  max_per_sale              bigint,
  max_per_media_per_device  bigint,
  max_total_per_device      bigint,
  max_snapshot_age          interval,
  cash_topup_offline        boolean,
  updated_by                uuid,
  valid_from                timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (policy_id, version)
);
CREATE TRIGGER offline_policy_history_immutable BEFORE UPDATE OR DELETE ON offline_policy_history
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE FUNCTION bump_offline_policy_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.version := OLD.version + 1;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER offline_policy_version BEFORE UPDATE ON offline_policy
  FOR EACH ROW EXECUTE FUNCTION bump_offline_policy_version();

CREATE FUNCTION log_offline_policy() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p offline_policy%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN p := OLD; ELSE p := NEW; END IF;
  INSERT INTO offline_policy_history (operator_id, policy_id, scope_type, scope_id, version, deleted, offline_enabled,
         max_per_sale, max_per_media_per_device, max_total_per_device, max_snapshot_age, cash_topup_offline, updated_by)
  VALUES (p.operator_id, p.id, p.scope_type, p.scope_id,
          CASE WHEN TG_OP = 'DELETE' THEN p.version + 1 ELSE p.version END, TG_OP = 'DELETE', p.offline_enabled,
          p.max_per_sale, p.max_per_media_per_device, p.max_total_per_device, p.max_snapshot_age, p.cash_topup_offline, p.updated_by);
  RETURN NULL;
END $$;
CREATE TRIGGER offline_policy_log AFTER INSERT OR UPDATE OR DELETE ON offline_policy
  FOR EACH ROW EXECUTE FUNCTION log_offline_policy();

-- Configuration servie à un terminal : politique effective figée, époque, plancher de séquence.
-- Le terminal renvoie config_id avec chaque opération hors ligne (sync_protocol §3.3, champ chaîné).
CREATE TABLE device_config_served (
  id                bigserial PRIMARY KEY,
  operator_id       uuid NOT NULL REFERENCES party(id),
  device_id         uuid NOT NULL REFERENCES device(id),
  config_version_id uuid REFERENCES config_version(id),
  policy            jsonb NOT NULL,                     -- sortie de effective_offline_policy, figée
  policy_sha256     bytea NOT NULL,
  authority_epoch   int NOT NULL,
  next_seq_floor    bigint NOT NULL,
  terminal_settings jsonb NOT NULL DEFAULT '{}',        -- réglages de l'événement servis (ADR-61)
  served_at         timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX ON device_config_served (device_id, id);
CREATE TRIGGER device_config_served_immutable BEFORE UPDATE OR DELETE ON device_config_served
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- Enregistre la configuration servie. Si rien n'a changé depuis la dernière (politique, époque, plancher,
-- version de configuration), renvoie la même ligne : config_id reste stable d'un battement de cœur à l'autre.
CREATE FUNCTION record_config_served(p_device uuid, p_config_version uuid DEFAULT NULL) RETURNS device_config_served
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d device%ROWTYPE; pol jsonb; ep int; last device_config_served%ROWTYPE; r device_config_served%ROWTYPE; ts jsonb;
BEGIN
  PERFORM assert_tenant(tenant_of_device(p_device));
  SELECT * INTO d FROM device WHERE id = p_device;
  SELECT coalesce((SELECT jsonb_build_object(
           'online_connect_timeout_ms', e.online_connect_timeout_ms, 'online_total_timeout_ms', e.online_total_timeout_ms,
           'online_retries', e.online_retries, 'pending_sync_seconds', e.pending_sync_seconds,
           'reconcile_sync_seconds', e.reconcile_sync_seconds, 'heartbeat_seconds', e.heartbeat_seconds,
           'reversal_window_minutes', e.reversal_window_minutes, 'local_retention_days', e.local_retention_days,
           'tap_replay_window_seconds', e.tap_replay_window_seconds)
         FROM event e WHERE e.id = d.event_id), '{}') INTO ts;
  SELECT to_jsonb(e) INTO pol FROM effective_offline_policy(p_device) e;
  SELECT coalesce(max(l.authority_epoch), 0) INTO ep
    FROM ledger l JOIN event ev ON ev.id = d.event_id
   WHERE (l.scope_type = 'EVENT' AND l.scope_id = ev.id) OR (l.scope_type = 'ORGANIZER' AND l.scope_id = ev.organizer_id);
  SELECT * INTO last FROM device_config_served WHERE device_id = p_device ORDER BY id DESC LIMIT 1;
  IF FOUND AND last.policy = pol AND last.authority_epoch = ep AND last.next_seq_floor = d.next_seq_floor
     AND last.config_version_id IS NOT DISTINCT FROM p_config_version AND last.terminal_settings = ts THEN
    RETURN last;
  END IF;
  INSERT INTO device_config_served (operator_id, device_id, config_version_id, policy, policy_sha256, authority_epoch, next_seq_floor, terminal_settings)
  VALUES (d.operator_id, p_device, p_config_version, pol, sha256(convert_to(pol::text, 'UTF8')), ep, d.next_seq_floor, ts)
  RETURNING * INTO r;
  RETURN r;
END $$;

-- Politique détenue par le terminal pour une opération : celle de la configuration config_id qu'il déclare.
-- Une configuration d'un autre terminal, ou inconnue -> P0002 (l'opération est rejetée : SNAPSHOT/POLICY inconnue).
CREATE FUNCTION policy_in_force(p_device uuid, p_config_id bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE pol jsonb;
BEGIN
  PERFORM assert_tenant(tenant_of_device(p_device));
  SELECT policy INTO pol FROM device_config_served WHERE id = p_config_id AND device_id = p_device;
  IF pol IS NULL THEN RAISE EXCEPTION 'Configuration inconnue pour ce terminal' USING ERRCODE = 'no_data_found'; END IF;
  RETURN pol;
END $$;

-- 18f. Bascule de l'autorité de débit vers la passerelle et retour (S12) ---------------------------------
-- TO_EDGE    : GRANTED -> ACTIVE (accusé de la passerelle, filigrane atteint) -> COMPLETED (rendue) | FORCED
--              GRANTED -> FAILED (la passerelle n'a jamais accusé : elle n'a donc jamais débité)
-- TO_CENTRAL : RELEASE_REQUESTED -> RELEASING -> COMPLETED ; RELEASE_REQUESTED|RELEASING -> FORCED | FAILED ;
--              ou créée directement FORCED (reprise forcée, deux personnes, passerelle révoquée)
-- Seules ces fonctions changent l'autorité ; l'application NE DOIT PAS appeler set_debit_authority directement.
CREATE TABLE debit_authority_handover (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id          uuid NOT NULL REFERENCES party(id),
  ledger_id            uuid NOT NULL REFERENCES ledger(id),
  edge_gateway_id      uuid NOT NULL REFERENCES edge_gateway(id),
  direction            text NOT NULL CHECK (direction IN ('TO_EDGE','TO_CENTRAL')),
  edge_handover_id     uuid REFERENCES debit_authority_handover(id),   -- TO_CENTRAL : la bascule TO_EDGE qu'elle clôt
  status               text NOT NULL CHECK (status IN ('GRANTED','ACTIVE','RELEASE_REQUESTED','RELEASING','COMPLETED','FORCED','FAILED')),
  epoch                int NOT NULL,                      -- TO_EDGE : époque accordée ; TO_CENTRAL : époque de la passerelle, puis époque du retour
  watermark_posting_id bigint,                            -- TO_EDGE : W = max(posting.id) du grand livre au moment de la bascule
  final_edge_seq       bigint,                            -- TO_CENTRAL : dernier edge_seq déclaré par la passerelle
  last_chain_hash      bytea,                             -- TO_CENTRAL : empreinte de chaîne déclarée
  requested_by         uuid NOT NULL,
  approved_by          uuid,                              -- FORCED : seconde personne
  reason               text,
  requested_at         timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  completed_at         timestamptz,
  CHECK ((direction = 'TO_EDGE') = (watermark_posting_id IS NOT NULL)),
  CHECK ((direction = 'TO_CENTRAL') = (edge_handover_id IS NOT NULL) OR (direction = 'TO_CENTRAL' AND status = 'FORCED')),
  CHECK (direction = 'TO_EDGE' OR status IN ('RELEASE_REQUESTED','RELEASING','COMPLETED','FORCED','FAILED')),
  CHECK (direction = 'TO_CENTRAL' OR status IN ('GRANTED','ACTIVE','COMPLETED','FORCED','FAILED')),
  CHECK (status <> 'FORCED' OR direction = 'TO_EDGE'
         OR (approved_by IS NOT NULL AND approved_by <> requested_by AND reason IS NOT NULL))
);
CREATE UNIQUE INDEX handover_one_open ON debit_authority_handover (ledger_id, direction)
  WHERE status IN ('GRANTED','ACTIVE','RELEASE_REQUESTED','RELEASING');

CREATE TABLE handover_transition (direction text, from_status text, to_status text, PRIMARY KEY (direction, from_status, to_status));
INSERT INTO handover_transition VALUES
 ('TO_EDGE','GRANTED','ACTIVE'), ('TO_EDGE','GRANTED','FAILED'), ('TO_EDGE','GRANTED','FORCED'),
 ('TO_EDGE','ACTIVE','COMPLETED'), ('TO_EDGE','ACTIVE','FORCED'),
 ('TO_CENTRAL','RELEASE_REQUESTED','RELEASING'), ('TO_CENTRAL','RELEASE_REQUESTED','COMPLETED'),
 ('TO_CENTRAL','RELEASING','COMPLETED'), ('TO_CENTRAL','RELEASE_REQUESTED','FORCED'), ('TO_CENTRAL','RELEASING','FORCED'),
 ('TO_CENTRAL','RELEASE_REQUESTED','FAILED'), ('TO_CENTRAL','RELEASING','FAILED');

CREATE FUNCTION check_handover_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id <> OLD.id OR NEW.ledger_id <> OLD.ledger_id OR NEW.direction <> OLD.direction
     OR NEW.edge_gateway_id <> OLD.edge_gateway_id OR NEW.requested_by <> OLD.requested_by THEN
    RAISE EXCEPTION 'Bascule : identité non modifiable' USING ERRCODE = 'CL013';
  END IF;
  IF NEW.status <> OLD.status AND NOT EXISTS (SELECT 1 FROM handover_transition
       WHERE direction = NEW.direction AND from_status = OLD.status AND to_status = NEW.status) THEN
    RAISE EXCEPTION 'Bascule % : passage % -> % interdit', NEW.direction, OLD.status, NEW.status USING ERRCODE = 'CL013';
  END IF;
  NEW.updated_at := now();
  IF NEW.status IN ('COMPLETED','FORCED','FAILED') THEN NEW.completed_at := coalesce(NEW.completed_at, now()); END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER handover_transition_check BEFORE UPDATE ON debit_authority_handover
  FOR EACH ROW EXECUTE FUNCTION check_handover_transition();
CREATE TRIGGER handover_no_delete BEFORE DELETE ON debit_authority_handover
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- Étape 2 (sync_protocol §9.2) : époque +1, filigrane W, GRANTED. Dès le COMMIT, le central refuse les débits.
CREATE FUNCTION grant_edge_authority(p_ledger uuid, p_gateway uuid, p_actor uuid) RETURNS debit_authority_handover
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE lg ledger%ROWTYPE; g edge_gateway%ROWTYPE; e int; w bigint; h debit_authority_handover%ROWTYPE;
BEGIN
  PERFORM assert_tenant(tenant_of_ledger(p_ledger));
  PERFORM assert_tenant(tenant_of_gateway(p_gateway));
  -- Ordre de verrouillage unique (évite les interblocages avec post_transaction) : verrou d'autorité
  -- exclusif d'abord, puis la ligne en NO KEY UPDATE (compatible avec le KEY SHARE des clés étrangères).
  PERFORM pg_advisory_xact_lock(hashtextextended('debit-authority:' || p_ledger, 0));
  SELECT * INTO lg FROM ledger WHERE id = p_ledger FOR NO KEY UPDATE;
  SELECT * INTO g FROM edge_gateway WHERE id = p_gateway;
  IF g.status <> 'ACTIVE' OR g.role <> 'PRIMARY' THEN
    RAISE EXCEPTION 'Passerelle % non éligible (statut %, rôle %)', g.serial, g.status, g.role USING ERRCODE = 'CL013';
  END IF;
  IF lg.scope_type = 'EVENT' AND lg.scope_id <> g.event_id THEN
    RAISE EXCEPTION 'Passerelle d''un autre événement' USING ERRCODE = 'CL013';
  END IF;
  IF lg.debit_authority <> 'CENTRAL' OR EXISTS (SELECT 1 FROM debit_authority_handover
       WHERE ledger_id = p_ledger AND status IN ('GRANTED','ACTIVE','RELEASE_REQUESTED','RELEASING')) THEN
    RAISE EXCEPTION 'Une bascule est déjà en cours pour ce grand livre' USING ERRCODE = 'CL013';
  END IF;
  e := set_debit_authority(p_ledger, 'EDGE', p_gateway);          -- verrou exclusif : attend les écritures en vol
  SELECT coalesce(max(id), 0) INTO w FROM posting WHERE ledger_id = p_ledger;
  INSERT INTO debit_authority_handover (operator_id, ledger_id, edge_gateway_id, direction, status, epoch,
                                        watermark_posting_id, requested_by)
  VALUES (lg.operator_id, p_ledger, p_gateway, 'TO_EDGE', 'GRANTED', e, w, p_actor)
  RETURNING * INTO h;
  RETURN h;
END $$;

-- Étapes 4-5 : la passerelle accuse l'époque et prouve qu'elle a répliqué jusqu'au filigrane -> ACTIVE.
-- Elle ne débite qu'après la réponse de succès.
CREATE FUNCTION ack_edge_handover(p_handover uuid, p_epoch int, p_replicated_posting_id bigint) RETURNS debit_authority_handover
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE h debit_authority_handover%ROWTYPE; cur int;
BEGIN
  PERFORM assert_tenant((SELECT operator_id FROM debit_authority_handover WHERE id = p_handover));
  SELECT * INTO h FROM debit_authority_handover WHERE id = p_handover FOR UPDATE;
  IF h.direction <> 'TO_EDGE' OR h.status <> 'GRANTED' THEN
    RAISE EXCEPTION 'Bascule % dans l''état %', p_handover, h.status USING ERRCODE = 'CL013';
  END IF;
  SELECT authority_epoch INTO cur FROM ledger WHERE id = h.ledger_id;
  IF p_epoch <> h.epoch OR cur <> h.epoch THEN
    RAISE EXCEPTION 'Époque % ≠ époque courante %', p_epoch, cur USING ERRCODE = 'CL015';
  END IF;
  IF p_replicated_posting_id < h.watermark_posting_id THEN
    RAISE EXCEPTION 'Réplication en retard (% < filigrane %)', p_replicated_posting_id, h.watermark_posting_id
      USING ERRCODE = 'CL014';
  END IF;
  UPDATE edge_gateway SET last_replicated_posting_id = p_replicated_posting_id, last_seen_at = now() WHERE id = h.edge_gateway_id;
  UPDATE debit_authority_handover SET status = 'ACTIVE' WHERE id = p_handover RETURNING * INTO h;
  RETURN h;
END $$;

-- La passerelle n'a jamais accusé (GRANTED) : abandon, retour immédiat au central (une personne suffit).
CREATE FUNCTION fail_edge_grant(p_handover uuid, p_actor uuid, p_reason text) RETURNS debit_authority_handover
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE h debit_authority_handover%ROWTYPE;
BEGIN
  PERFORM assert_tenant((SELECT operator_id FROM debit_authority_handover WHERE id = p_handover));
  SELECT * INTO h FROM debit_authority_handover WHERE id = p_handover FOR UPDATE;
  IF h.direction <> 'TO_EDGE' OR h.status <> 'GRANTED' THEN
    RAISE EXCEPTION 'Bascule % dans l''état %', p_handover, h.status USING ERRCODE = 'CL013';
  END IF;
  PERFORM set_debit_authority(h.ledger_id, 'CENTRAL');
  UPDATE debit_authority_handover SET status = 'FAILED', reason = p_reason WHERE id = p_handover RETURNING * INTO h;
  RETURN h;
END $$;

-- Retour, étape 1 (sync_protocol §9.3) : demande de retour ; le grand livre reste EDGE pendant la vidange.
CREATE FUNCTION request_edge_release(p_ledger uuid, p_actor uuid) RETURNS debit_authority_handover
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE te debit_authority_handover%ROWTYPE; h debit_authority_handover%ROWTYPE;
BEGIN
  PERFORM assert_tenant(tenant_of_ledger(p_ledger));
  SELECT * INTO te FROM debit_authority_handover
   WHERE ledger_id = p_ledger AND direction = 'TO_EDGE' AND status = 'ACTIVE' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Aucune autorité de passerelle active' USING ERRCODE = 'CL013'; END IF;
  IF EXISTS (SELECT 1 FROM debit_authority_handover WHERE ledger_id = p_ledger AND direction = 'TO_CENTRAL'
               AND status IN ('RELEASE_REQUESTED','RELEASING')) THEN
    RAISE EXCEPTION 'Retour déjà demandé' USING ERRCODE = 'CL013';
  END IF;
  INSERT INTO debit_authority_handover (operator_id, ledger_id, edge_gateway_id, direction, edge_handover_id, status, epoch, requested_by)
  VALUES (te.operator_id, p_ledger, te.edge_gateway_id, 'TO_CENTRAL', te.id, 'RELEASE_REQUESTED', te.epoch, p_actor)
  RETURNING * INTO h;
  RETURN h;
END $$;

-- Retour, étapes 4-5 : la passerelle déclare final_edge_seq et sa dernière empreinte de chaîne. Le central
-- exige que toutes ses opérations 1..final_edge_seq soient reçues (continuité tenue par record_edge_seq) et que
-- l'empreinte qu'il a calculée soit la même ; puis rebascule CENTRAL (époque +1).
CREATE FUNCTION complete_edge_release(p_handover uuid, p_epoch int, p_final_edge_seq bigint, p_last_chain_hash bytea)
RETURNS debit_authority_handover
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE h debit_authority_handover%ROWTYPE; g edge_gateway%ROWTYPE; cur int; e int;
BEGIN
  PERFORM assert_tenant((SELECT operator_id FROM debit_authority_handover WHERE id = p_handover));
  SELECT * INTO h FROM debit_authority_handover WHERE id = p_handover FOR UPDATE;
  IF h.direction <> 'TO_CENTRAL' OR h.status NOT IN ('RELEASE_REQUESTED','RELEASING') THEN
    RAISE EXCEPTION 'Bascule % dans l''état %', p_handover, h.status USING ERRCODE = 'CL013';
  END IF;
  SELECT authority_epoch INTO cur FROM ledger WHERE id = h.ledger_id;
  IF p_epoch <> h.epoch OR cur <> h.epoch THEN
    RAISE EXCEPTION 'Époque % ≠ époque courante %', p_epoch, cur USING ERRCODE = 'CL015';
  END IF;
  SELECT * INTO g FROM edge_gateway WHERE id = h.edge_gateway_id FOR UPDATE;
  IF g.contiguous_edge_seq < p_final_edge_seq THEN
    RAISE EXCEPTION 'Passerelle en retard : edge_seq % à % manquants', g.contiguous_edge_seq + 1, p_final_edge_seq
      USING ERRCODE = 'CL014';
  END IF;
  IF g.contiguous_edge_seq > p_final_edge_seq
     OR coalesce(g.last_chain_hash, edge_chain_genesis(g.id)) <> p_last_chain_hash THEN
    RAISE EXCEPTION 'Chaîne de la passerelle différente de celle calculée par le central' USING ERRCODE = 'CL017';
  END IF;
  e := set_debit_authority(h.ledger_id, 'CENTRAL');
  UPDATE debit_authority_handover SET status = 'COMPLETED' WHERE id = h.edge_handover_id;
  UPDATE debit_authority_handover SET status = 'COMPLETED', epoch = e, final_edge_seq = p_final_edge_seq,
         last_chain_hash = p_last_chain_hash
   WHERE id = p_handover RETURNING * INTO h;
  RETURN h;
END $$;

-- Reprise forcée (passerelle perdue, constat physique) : deux personnes, passerelle révoquée, CENTRAL (époque +1).
CREATE FUNCTION force_central_authority(p_ledger uuid, p_actor uuid, p_approver uuid, p_reason text)
RETURNS debit_authority_handover
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE lg ledger%ROWTYPE; te debit_authority_handover%ROWTYPE; h debit_authority_handover%ROWTYPE; e int;
BEGIN
  PERFORM assert_tenant(tenant_of_ledger(p_ledger));
  IF p_actor IS NULL OR p_approver IS NULL OR p_approver = p_actor OR coalesce(p_reason, '') = '' THEN
    RAISE EXCEPTION 'Reprise forcée : deux personnes distinctes et un motif sont obligatoires' USING ERRCODE = 'check_violation';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('debit-authority:' || p_ledger, 0));   -- même ordre que ci-dessus
  SELECT * INTO lg FROM ledger WHERE id = p_ledger FOR NO KEY UPDATE;
  IF lg.debit_authority <> 'EDGE' THEN
    RAISE EXCEPTION 'Le grand livre n''est pas sous l''autorité d''une passerelle' USING ERRCODE = 'CL013';
  END IF;
  SELECT * INTO te FROM debit_authority_handover
   WHERE ledger_id = p_ledger AND direction = 'TO_EDGE' AND status IN ('GRANTED','ACTIVE') FOR UPDATE;
  UPDATE edge_gateway SET status = 'REVOKED' WHERE id = lg.edge_gateway_id;
  e := set_debit_authority(p_ledger, 'CENTRAL');
  UPDATE debit_authority_handover SET status = 'FORCED' WHERE id = te.id;
  SELECT * INTO h FROM debit_authority_handover
   WHERE ledger_id = p_ledger AND direction = 'TO_CENTRAL' AND status IN ('RELEASE_REQUESTED','RELEASING') FOR UPDATE;
  IF FOUND THEN
    UPDATE debit_authority_handover SET status = 'FORCED', epoch = e, approved_by = p_approver,
           reason = p_reason || ' (reprise forcée par ' || p_actor || ')'
     WHERE id = h.id RETURNING * INTO h;
  ELSE
    INSERT INTO debit_authority_handover (operator_id, ledger_id, edge_gateway_id, direction, edge_handover_id, status,
                                          epoch, requested_by, approved_by, reason, completed_at)
    VALUES (lg.operator_id, p_ledger, lg.edge_gateway_id, 'TO_CENTRAL', te.id, 'FORCED', e, p_actor, p_approver, p_reason, now())
    RETURNING * INTO h;
  END IF;
  RETURN h;
END $$;

-- 18g. Registre des décisions de la passerelle (S13) ----------------------------------------------------
-- Chaque opération décidée par la passerelle porte un edge_seq continu ; le central les reçoit dans l'ordre
-- (EDGE_SYNC), recalcule la chaîne et la compare à celle que la passerelle déclare au retour.
CREATE TABLE edge_sync_registry (
  operator_id    uuid NOT NULL REFERENCES party(id),
  gateway_id     uuid NOT NULL REFERENCES edge_gateway(id),
  edge_seq       bigint NOT NULL CHECK (edge_seq >= 1),
  origin_key     text NOT NULL,                          -- clé d'origine du terminal <serial>:<seq>
  content_sha256 bytea NOT NULL CHECK (octet_length(content_sha256) = 32),
  chain_hash     bytea NOT NULL CHECK (octet_length(chain_hash) = 32),   -- calculée par le central
  outcome        text NOT NULL CHECK (outcome IN ('ACCEPTED','ACCEPTED_WITH_SHORTFALL','DUPLICATE','REJECTED')),
  reason         text,
  transaction_id uuid REFERENCES journal_transaction(id),
  recorded_at    timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (gateway_id, edge_seq),
  UNIQUE (gateway_id, origin_key),
  CHECK (outcome <> 'REJECTED' OR (reason IS NOT NULL AND transaction_id IS NULL)),
  CHECK (outcome NOT IN ('ACCEPTED_WITH_SHORTFALL','DUPLICATE') OR transaction_id IS NOT NULL)
);
CREATE TRIGGER edge_sync_registry_immutable BEFORE UPDATE OR DELETE ON edge_sync_registry
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE FUNCTION record_edge_seq(p_gateway uuid, p_edge_seq bigint, p_origin_key text, p_content bytea,
                                p_outcome text, p_tx uuid DEFAULT NULL, p_reason text DEFAULT NULL)
RETURNS TABLE (replayed boolean, outcome text, transaction_id uuid, chain_hash bytea)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE g edge_gateway%ROWTYPE; r edge_sync_registry%ROWTYPE; h bytea;
BEGIN
  PERFORM assert_tenant(tenant_of_gateway(p_gateway));
  SELECT * INTO g FROM edge_gateway WHERE id = p_gateway FOR UPDATE;
  SELECT * INTO r FROM edge_sync_registry WHERE gateway_id = p_gateway AND edge_seq = p_edge_seq;
  IF FOUND THEN
    IF r.content_sha256 <> p_content OR r.origin_key <> p_origin_key THEN
      RAISE EXCEPTION 'edge_seq % déjà reçu avec un contenu différent', p_edge_seq USING ERRCODE = 'CL002';
    END IF;
    RETURN QUERY SELECT true, r.outcome, r.transaction_id, r.chain_hash;
    RETURN;
  END IF;
  IF p_edge_seq <> g.contiguous_edge_seq + 1 THEN
    RAISE EXCEPTION 'edge_seq % reçu, % attendu', p_edge_seq, g.contiguous_edge_seq + 1 USING ERRCODE = 'CL016';
  END IF;
  IF p_tx IS NOT NULL THEN
    PERFORM assert_tenant((SELECT t.operator_id FROM journal_transaction t WHERE t.id = p_tx));
  END IF;
  h := chain_step(coalesce(g.last_chain_hash, edge_chain_genesis(p_gateway)), p_content);
  INSERT INTO edge_sync_registry (operator_id, gateway_id, edge_seq, origin_key, content_sha256, chain_hash,
                                  outcome, reason, transaction_id)
  VALUES (g.operator_id, p_gateway, p_edge_seq, p_origin_key, p_content, h, p_outcome, p_reason, p_tx);
  UPDATE edge_gateway SET contiguous_edge_seq = p_edge_seq, last_chain_hash = h, last_seen_at = now() WHERE id = p_gateway;
  RETURN QUERY SELECT false, p_outcome, p_tx, h;
END $$;

-- 18h. Scellement du journal (S25, SPECIFICATION §13.7, ADR-46) -------------------------------------------
-- Ligne canonique d'une écriture (UTF-8, champs séparés par « | », terminée par « \n ») :
--   posting.id | transaction_id | line_no | account_id | amount | type | idempotency_key | request_hash |
--   occurred_at (UTC, AAAA-MM-JJTHH:MI:SS.US, 6 décimales)
-- lines_sha256 = SHA-256 de la concaténation des lignes canoniques de la période, dans l'ordre de posting.id.
-- seal_hash    = SHA-256(prev_seal_hash ‖ ledger_id ‖ int8(first_posting_id) ‖ int8(last_posting_id) ‖ lines_sha256)
--   (int8 : 8 octets gros-boutiste ; ledger_id : 16 octets) ; prev du premier scellement = ledger_seal_genesis.
CREATE FUNCTION ledger_seal_genesis(p_ledger uuid) RETURNS bytea
LANGUAGE sql IMMUTABLE STRICT AS $$ SELECT sha256(convert_to('CASHLESS/SEAL/v1', 'UTF8') || uuid_send(p_ledger)) $$;

CREATE FUNCTION ledger_lines_sha256(p_ledger uuid, p_first bigint, p_last bigint) RETURNS bytea
LANGUAGE sql STABLE AS $$
  SELECT sha256(convert_to(coalesce(string_agg(
           concat_ws('|', p.id, p.transaction_id, p.line_no, p.account_id, p.amount, p.memo, t.type, t.idempotency_key,
                     t.request_hash, to_char(t.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'),
                     -- revue 2 (DB-I16) : qui, d'où, pour quoi — modifier l'auteur ou la source d'une écriture scellée est détecté
                     t.source, t.event_id, t.reverses_id, t.created_by, t.approved_by, t.device_id, t.media_id,
                     t.config_version_id, t.metadata::text) || E'\n',
           '' ORDER BY p.id), ''), 'UTF8'))
    FROM posting p JOIN journal_transaction t ON t.id = p.transaction_id
   WHERE p.ledger_id = p_ledger AND p.id BETWEEN p_first AND p_last
$$;

CREATE TABLE ledger_seal (
  operator_id      uuid NOT NULL REFERENCES party(id),
  ledger_id        uuid NOT NULL REFERENCES ledger(id),
  seal_no          int NOT NULL CHECK (seal_no >= 1),
  first_posting_id bigint NOT NULL,                   -- borne basse (incluse) : dernier posting scellé + 1
  last_posting_id  bigint NOT NULL,                   -- borne haute (incluse)
  postings         int NOT NULL CHECK (postings >= 1),
  lines_sha256     bytea NOT NULL CHECK (octet_length(lines_sha256) = 32),
  prev_seal_hash   bytea NOT NULL CHECK (octet_length(prev_seal_hash) = 32),
  seal_hash        bytea NOT NULL CHECK (octet_length(seal_hash) = 32),
  sealed_at        timestamptz NOT NULL DEFAULT clock_timestamp(),
  external_ref     text,                              -- clé de l'objet S3 Object Lock (renseignée une fois, après copie)
  PRIMARY KEY (ledger_id, seal_no),
  CHECK (last_posting_id >= first_posting_id)
);
-- Ajout seul ; seule external_ref peut passer de NULL à une valeur, une fois.
CREATE FUNCTION ledger_seal_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.external_ref IS NOT NULL OR NEW.external_ref IS NULL
     OR (to_jsonb(NEW) - 'external_ref') <> (to_jsonb(OLD) - 'external_ref') THEN
    RAISE EXCEPTION 'Table ledger_seal en ajout seul (external_ref : renseignée une seule fois)';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER ledger_seal_append_only BEFORE UPDATE OR DELETE ON ledger_seal
  FOR EACH ROW EXECUTE FUNCTION ledger_seal_guard();

-- Scelle les écritures nouvelles d'un grand livre. Plage : du dernier posting scellé + 1 jusqu'à
-- W = max(posting.id) des transactions enregistrées avant clock_timestamp() - p_lag. Avec une durée de
-- transaction bornée à D (60 s, SPECIFICATION §13.7), toute écriture d'id ≤ W est validée dès que p_lag ≥ 2 D :
-- le délai par défaut (5 min) garantit qu'aucune écriture n'apparaîtra plus tard sous W. Un p_lag trop court
-- ne perd rien en silence : l'écriture tardive rend verify_ledger_seals en écart (alerte).
-- Renvoie le scellement créé, ou NULL s'il n'y a rien de nouveau. Grand livre LOCKED : p_lag = 0 (scellement final).
CREATE FUNCTION seal_ledger(p_ledger uuid, p_lag interval DEFAULT interval '5 minutes') RETURNS ledger_seal
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE lg ledger%ROWTYPE; prev ledger_seal%ROWTYPE; lo bigint; hi bigint; n int; lh bytea; sh bytea; ph bytea;
        r ledger_seal%ROWTYPE;
BEGIN
  PERFORM assert_tenant(tenant_of_ledger(p_ledger));
  IF p_lag < interval '0' THEN RAISE EXCEPTION 'Délai négatif' USING ERRCODE = 'CL001'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('ledger-seal:' || p_ledger, 0));   -- un scellement à la fois
  SELECT * INTO lg FROM ledger WHERE id = p_ledger;
  SELECT * INTO prev FROM ledger_seal WHERE ledger_id = p_ledger ORDER BY seal_no DESC LIMIT 1;
  lo := coalesce(prev.last_posting_id, 0) + 1;
  SELECT max(p.id) INTO hi FROM posting p JOIN journal_transaction t ON t.id = p.transaction_id
   WHERE p.ledger_id = p_ledger AND p.id >= lo AND t.recorded_at < clock_timestamp() - p_lag;
  IF hi IS NULL THEN RETURN NULL; END IF;
  SELECT count(*) INTO n FROM posting WHERE ledger_id = p_ledger AND id BETWEEN lo AND hi;
  lh := ledger_lines_sha256(p_ledger, lo, hi);
  ph := coalesce(prev.seal_hash, ledger_seal_genesis(p_ledger));
  sh := sha256(ph || uuid_send(p_ledger) || int8send(lo) || int8send(hi) || lh);
  INSERT INTO ledger_seal (operator_id, ledger_id, seal_no, first_posting_id, last_posting_id, postings,
                           lines_sha256, prev_seal_hash, seal_hash)
  VALUES (lg.operator_id, p_ledger, coalesce(prev.seal_no, 0) + 1, lo, hi, n, lh, ph, sh)
  RETURNING * INTO r;
  RETURN r;
END $$;

-- Grands livres à sceller (revue 2, M9) : lignes postérieures au dernier scellement, QUEL QUE SOIT le statut
-- (un grand livre LOCKED reçoit encore des réclamations tardives, qui doivent être scellées comme le reste).
-- La tâche de scellement parcourt cette vue toutes les 5 minutes.
CREATE VIEW ledgers_to_seal AS
SELECT l.id AS ledger_id, l.status, count(p.id) AS unsealed_postings, min(p.id) AS first_unsealed_posting_id
  FROM ledger l JOIN posting p ON p.ledger_id = l.id
 WHERE p.id > coalesce((SELECT max(s.last_posting_id) FROM ledger_seal s WHERE s.ledger_id = l.id), 0)
 GROUP BY l.id, l.status;
ALTER VIEW ledgers_to_seal SET (security_invoker = true);

-- Recalcule chaque scellement (depuis p_from_seal) et le compare à la base : lignes modifiées, supprimées ou
-- ajoutées dans une plage scellée, ou chaîne rompue -> ok = false. La tâche quotidienne compare en plus
-- seal_hash aux copies externes (S3 Object Lock).
CREATE FUNCTION verify_ledger_seals(p_ledger uuid, p_from_seal int DEFAULT 1)
RETURNS TABLE (seal_no int, ok boolean, stored_seal_hash bytea, recomputed_seal_hash bytea, stored_postings int, actual_postings int)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE s ledger_seal%ROWTYPE; ph bytea; lh bytea; sh bytea; n int;
BEGIN
  PERFORM assert_tenant(tenant_of_ledger(p_ledger));
  SELECT x.seal_hash INTO ph FROM ledger_seal x WHERE x.ledger_id = p_ledger AND x.seal_no = p_from_seal - 1;
  ph := coalesce(ph, ledger_seal_genesis(p_ledger));
  FOR s IN SELECT * FROM ledger_seal x WHERE x.ledger_id = p_ledger AND x.seal_no >= p_from_seal ORDER BY x.seal_no LOOP
    lh := ledger_lines_sha256(p_ledger, s.first_posting_id, s.last_posting_id);
    sh := sha256(ph || uuid_send(p_ledger) || int8send(s.first_posting_id) || int8send(s.last_posting_id) || lh);
    SELECT count(*) INTO n FROM posting WHERE ledger_id = p_ledger AND id BETWEEN s.first_posting_id AND s.last_posting_id;
    seal_no := s.seal_no; ok := (sh = s.seal_hash AND s.prev_seal_hash = ph AND n = s.postings);
    stored_seal_hash := s.seal_hash; recomputed_seal_hash := sh; stored_postings := s.postings; actual_postings := n;
    RETURN NEXT;
    ph := s.seal_hash;          -- on enchaîne sur l'empreinte stockée (copie externe comparée à part)
  END LOOP;
END $$;

-- 18i. Cloisonnement des tables de cette section -----------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['device_seq_registry','offline_batch','offline_policy_history','device_config_served',
                           'debit_authority_handover','edge_sync_registry','ledger_seal'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
                     USING (operator_id = current_setting('app.operator_id', true)::uuid)$p$, t);
  END LOOP;
END $$;
-- Clés de signature : les clés de la plateforme (operator_id NULL) sont lisibles par tous, jamais modifiables par eux.
ALTER TABLE snapshot_signing_key ENABLE ROW LEVEL SECURITY;
ALTER TABLE snapshot_signing_key FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_read ON snapshot_signing_key FOR SELECT
  USING (operator_id IS NULL OR operator_id = current_setting('app.operator_id', true)::uuid);
CREATE POLICY tenant_write ON snapshot_signing_key FOR ALL
  USING (operator_id = current_setting('app.operator_id', true)::uuid)
  WITH CHECK (operator_id = current_setting('app.operator_id', true)::uuid);

-- 18j. Fonctions internes : jamais appelables directement par l'application ------------------------------
-- Elles sont appelées par les fonctions SECURITY DEFINER (exécutées avec les droits du propriétaire).
-- set_debit_authority : seules les fonctions de bascule (18f) changent l'autorité de débit.
-- tenant_of_* : révèleraient le prestataire propriétaire de n'importe quel objet.
REVOKE EXECUTE ON FUNCTION
  set_debit_authority(uuid, text, uuid), advance_device_seq(uuid), advance_device_chain(uuid), deposit_accounts(uuid),
  check_wallet_limits(uuid, uuid, text, timestamptz), check_late_claim(ledger, text, jsonb), wallet_currency(uuid), ledger_jurisdiction(uuid),
  tenant_of_ledger(uuid), tenant_of_media(uuid), tenant_of_wallet(uuid), tenant_of_batch(uuid), tenant_of_event(uuid),
  tenant_of_device(uuid), tenant_of_gateway(uuid)
FROM PUBLIC;

-- 18h. Demandes d'approbation du back-office (ADR-74, Q3) ----------------------------------------------
-- Au back-office, une action à deux personnes est d'abord une DEMANDE (action et paramètres exacts, figés),
-- puis une APPROBATION par une seconde personne connectée : l'API prend le valideur de sa session, jamais du
-- corps de la requête. L'action est exécutée une seule fois, avec ce valideur. Expiration : 24 h.
-- (Au guichet, la seconde personne valide sur place par un jeton d'approbation de 5 min : voir SPEC §3.2.)
CREATE TABLE approval_request (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id    uuid NOT NULL REFERENCES party(id),
  action         text NOT NULL CHECK (action IN ('LATE_CLAIM','ADJUSTMENT','ANOMALY_RESOLUTION','WAIVE_SEQ_GAP',
                   'FORCE_CENTRAL_AUTHORITY','REINSTATE_MEDIA','PAYOUT','DEVICE_JOURNAL_IMPORT','KYC_REVOCATION',
                   'PSP_CONFIGURATION','EVENT_PSP_SELECTION','WALLET_REFUND','LATE_CHARGEBACK')),
  target_id      uuid,                                  -- objet visé (grand livre, terminal, bracelet...)
  payload        jsonb NOT NULL,                        -- paramètres exacts de l'action
  requested_by   uuid NOT NULL,
  requested_at   timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at     timestamptz NOT NULL DEFAULT clock_timestamp() + interval '24 hours',
  status         text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED','EXPIRED','EXECUTED','FAILED')),
  decided_by     uuid,
  decided_at     timestamptz,
  decision_note  text,
  executed_tx_id uuid REFERENCES journal_transaction(id),
  failure_code   text,                                  -- ProblemCode de l'échec (FAILED)
  failure_reason text,
  CHECK (decided_by IS NULL OR decided_by <> requested_by),
  CHECK ((status IN ('APPROVED','REJECTED','EXECUTED','FAILED')) = (decided_by IS NOT NULL AND decided_at IS NOT NULL))
);
CREATE INDEX ON approval_request (operator_id, status, requested_at);
ALTER TABLE approval_request ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_request FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON approval_request USING (operator_id = current_setting('app.operator_id', true)::uuid);

-- Passages permis : PENDING -> APPROVED | REJECTED | EXPIRED ; APPROVED -> EXECUTED | FAILED. Contenu figé.
CREATE FUNCTION approval_request_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Demande d''approbation : suppression interdite' USING ERRCODE = 'CL023'; END IF;
  IF (NEW.action, NEW.target_id, NEW.payload, NEW.requested_by, NEW.requested_at, NEW.expires_at, NEW.operator_id)
     IS DISTINCT FROM (OLD.action, OLD.target_id, OLD.payload, OLD.requested_by, OLD.requested_at, OLD.expires_at, OLD.operator_id)
     OR NOT ((OLD.status = 'PENDING' AND NEW.status IN ('APPROVED','REJECTED','EXPIRED'))
             OR (OLD.status = 'APPROVED' AND NEW.status IN ('EXECUTED','FAILED')
                 AND NEW.decided_by = OLD.decided_by AND NEW.decided_at = OLD.decided_at)) THEN
    RAISE EXCEPTION 'Demande d''approbation : passage % -> % ou modification interdits', OLD.status, NEW.status USING ERRCODE = 'CL023';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER approval_request_guard BEFORE UPDATE OR DELETE ON approval_request
  FOR EACH ROW EXECUTE FUNCTION approval_request_guard();

-- Décision de la seconde personne. Refus si : déjà décidée, expirée (passée EXPIRED), même personne que le demandeur.
--   CL023 APPROVAL_INVALID   demande expirée, déjà décidée, ou décidée par son auteur
CREATE FUNCTION decide_approval_request(p_id uuid, p_approver uuid, p_approve boolean, p_note text DEFAULT NULL)
RETURNS approval_request
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r approval_request%ROWTYPE;
BEGIN
  SELECT * INTO r FROM approval_request WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  PERFORM assert_tenant(r.operator_id);
  IF r.status <> 'PENDING' THEN RAISE EXCEPTION 'Demande déjà %', r.status USING ERRCODE = 'CL023'; END IF;
  IF clock_timestamp() > r.expires_at THEN
    UPDATE approval_request SET status = 'EXPIRED' WHERE id = p_id;
    RETURN NULL;                                          -- la mise à l'état EXPIRED est gardée ; l'API répond 409
  END IF;
  IF p_approver IS NULL OR p_approver = r.requested_by THEN
    RAISE EXCEPTION 'La demande doit être décidée par une autre personne que son auteur' USING ERRCODE = 'CL023';
  END IF;
  UPDATE approval_request SET status = CASE WHEN p_approve THEN 'APPROVED' ELSE 'REJECTED' END,
         decided_by = p_approver, decided_at = clock_timestamp(), decision_note = p_note
   WHERE id = p_id RETURNING * INTO r;
  RETURN r;
END $$;

-- 19. Statut de l'événement et statut du grand livre (ADR-51, SPECIFICATION §12.1) ---------------------------
-- set_event_status est le SEUL moyen de changer event.status. Dans la même transaction : contrôle du passage,
-- contrôle des conditions de clôture que la base sait calculer, statut des grands livres de l'événement
-- (portée EVENT) et historique. Les autres conditions (caisses comptées, PSP rapprochés, terminaux remontés)
-- restent contrôlées par le back-office avant l'appel.
--   CL018 EVENT_TRANSITION_INVALID       passage non prévu, ou changement de statut hors de set_event_status
--   CL019 CLOSING_CONDITION_NOT_MET      condition de clôture calculable non remplie (le message la nomme)
CREATE TABLE event_status_transition (from_status event_status, to_status event_status, PRIMARY KEY (from_status, to_status));
INSERT INTO event_status_transition VALUES
 ('DRAFT','LIVE'), ('LIVE','CLOSING'), ('CLOSING','RECONCILING'), ('RECONCILING','SETTLING'),
 ('SETTLING','REFUND_WINDOW'), ('REFUND_WINDOW','CLOSED');

CREATE TABLE event_status_history (
  id          bigserial PRIMARY KEY,
  operator_id uuid NOT NULL REFERENCES party(id),
  event_id    uuid NOT NULL REFERENCES event(id),
  from_status event_status NOT NULL,
  to_status   event_status NOT NULL,
  actor_id    uuid NOT NULL,
  remaining   bigint,                          -- CLOSED : total des soldes restants (0 = grand livre verrouillé)
  changed_at  timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER event_status_history_immutable BEFORE UPDATE OR DELETE ON event_status_history
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE FUNCTION guard_event_status() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Le marqueur seul ne suffit pas (l'application peut appeler set_config) : il faut aussi s'exécuter sous le
  -- rôle propriétaire de la table, ce qui n'est le cas que dans set_event_status (SECURITY DEFINER) (DB-I15).
  IF NEW.status IS DISTINCT FROM OLD.status
     AND (coalesce(current_setting('app.event_status_change', true), '') <> 'on'
          OR current_user <> (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid = TG_RELID)) THEN
    RAISE EXCEPTION 'Le statut d''un événement ne change que par set_event_status' USING ERRCODE = 'CL018';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER event_status_guard BEFORE UPDATE OF status ON event
  FOR EACH ROW EXECUTE FUNCTION guard_event_status();

-- Solde signé des comptes d'un grand livre ayant ces usages (lignes, pas de cache : comptes chauds compris)
CREATE FUNCTION ledger_purpose_balance(p_ledger uuid, p_purposes text[]) RETURNS bigint
LANGUAGE sql STABLE AS $$
  SELECT coalesce(sum(p.amount), 0)::bigint FROM posting p JOIN account a ON a.id = p.account_id
   WHERE p.ledger_id = p_ledger AND a.purpose = ANY (p_purposes)
$$;

-- Nombre de positions non soldées d'un grand livre (DB-B1, revue 2).
-- Les comptes d'une même partie se compensent (commission due par l'organisateur, versement reçu...) :
-- on contrôle le droit NET de chaque partie, et compte par compte seulement les comptes sans titulaire
-- (attente, versements en cours, portefeuilles, espèces à rendre). Les usages de p_keep sont tolérés.
CREATE FUNCTION ledger_unsettled(p_ledger uuid, p_keep text[] DEFAULT '{}') RETURNS int
LANGUAGE sql STABLE AS $$
  WITH b AS (
    SELECT a.owner_party_id AS o, coalesce(sum(p.amount), 0) AS bal
      FROM account a LEFT JOIN posting p ON p.account_id = a.id
     WHERE a.ledger_id = p_ledger AND a.family <> 'ASSET' AND a.purpose <> ALL (p_keep)
     GROUP BY a.id, a.owner_party_id)
  SELECT ((SELECT count(*) FROM b WHERE o IS NULL AND bal <> 0)
        + (SELECT count(*) FROM (SELECT o FROM b WHERE o IS NOT NULL GROUP BY o HAVING sum(bal) <> 0) x))::int
$$;

-- Verrouille un grand livre clos dont toutes les positions sont soldées, et pose le scellement final.
-- Idempotente (déjà LOCKED : rien), exige l'état CLOSING et, pour un événement, le statut CLOSED (DB-I5).
CREATE FUNCTION lock_settled_ledger(p_ledger uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n int; lg ledger%ROWTYPE; yrs int;
BEGIN
  PERFORM assert_tenant(tenant_of_ledger(p_ledger));
  PERFORM pg_advisory_xact_lock(hashtextextended('debit-authority:' || p_ledger, 0));
  SELECT * INTO lg FROM ledger WHERE id = p_ledger FOR NO KEY UPDATE;
  IF lg.status = 'LOCKED' THEN RETURN; END IF;
  IF lg.status <> 'CLOSING' OR (lg.scope_type = 'EVENT'
       AND (SELECT status FROM event WHERE id = lg.scope_id) IS DISTINCT FROM 'CLOSED') THEN
    RAISE EXCEPTION 'Verrouillage impossible : grand livre % (événement non clos)', lg.status USING ERRCODE = 'CL019';
  END IF;
  n := ledger_unsettled(p_ledger);
  IF n > 0 THEN
    RAISE EXCEPTION 'Verrouillage impossible : % position(s) non soldée(s)', n USING ERRCODE = 'CL019';
  END IF;
  yrs := coalesce((ledger_jurisdiction(p_ledger)).late_claim_years, 5);
  UPDATE ledger SET status = 'LOCKED', locked_until = greatest(coalesce(locked_until, clock_timestamp()), clock_timestamp()),
         late_claims_until = CASE WHEN yrs > 0 THEN clock_timestamp() + make_interval(years => yrs) END
   WHERE id = p_ledger;
  PERFORM seal_ledger(p_ledger, interval '0');           -- scellement final (§13.7)
END $$;

-- Date limite de synchronisation d'un événement (ADR-73) : fin de l'événement (ou passage en CLOSING) + sync_deadline_hours.
-- NULL tant que l'événement n'a ni fin prévue ni passage en CLOSING.
CREATE FUNCTION event_sync_deadline(p_event uuid) RETURNS timestamptz
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(e.ends_at, (SELECT max(h.changed_at) FROM event_status_history h
                               WHERE h.event_id = e.id AND h.to_status = 'CLOSING'))
         + make_interval(hours => e.sync_deadline_hours)
    FROM event e WHERE e.id = p_event
$$;

-- État de remontée des terminaux d'un événement (ADR-73), pour le back-office et pour SETTLING.
-- Un terminal est « à jour » s'il s'est manifesté après le passage en CLOSING, sans trou de numéros, sans lot
-- en cours ni anomalie SEQ_GAP ouverte. Exclus : terminaux révoqués (journal importé à part) et téléphones
-- personnels (jamais hors ligne).
CREATE FUNCTION event_device_sync_status(p_event uuid)
RETURNS TABLE (device_id uuid, serial text, caught_up boolean, reason text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE closing_at timestamptz;
BEGIN
  PERFORM assert_tenant(tenant_of_event(p_event));
  SELECT max(h.changed_at) INTO closing_at FROM event_status_history h WHERE h.event_id = p_event AND h.to_status = 'CLOSING';
  RETURN QUERY
  SELECT d.id, d.serial, r.reason IS NULL, r.reason
    FROM device d
    CROSS JOIN LATERAL (SELECT CASE
        WHEN closing_at IS NULL OR d.last_seen_at IS NULL OR d.last_seen_at < closing_at THEN 'NOT_SEEN_SINCE_CLOSING'
        WHEN d.contiguous_acked_seq < d.last_seq THEN 'SEQ_GAP'
        WHEN EXISTS (SELECT 1 FROM offline_batch b WHERE b.device_id = d.id AND b.status = 'PROCESSING') THEN 'BATCH_IN_PROGRESS'
        WHEN EXISTS (SELECT 1 FROM anomaly a WHERE a.device_id = d.id AND a.kind = 'SEQ_GAP' AND a.status = 'OPEN') THEN 'SEQ_GAP'
        END AS reason) r
   WHERE d.event_id = p_event AND d.status <> 'REVOKED' AND NOT d.personal_phone;
END $$;

CREATE FUNCTION set_event_status(p_event uuid, p_status event_status, p_actor uuid) RETURNS event_status
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE ev event%ROWTYPE; l ledger%ROWTYPE; lg uuid; dest text; v bigint; rem bigint := 0; total_rem bigint := 0;
        keep text[]; to_lock uuid[] := '{}';
BEGIN
  PERFORM assert_tenant(tenant_of_event(p_event));
  IF p_actor IS NULL THEN RAISE EXCEPTION 'Auteur obligatoire' USING ERRCODE = 'CL001'; END IF;
  -- NO KEY UPDATE : compatible avec le KEY SHARE que prennent les écritures (clé étrangère event_id)
  SELECT * INTO ev FROM event WHERE id = p_event FOR NO KEY UPDATE;
  IF NOT EXISTS (SELECT 1 FROM event_status_transition WHERE from_status = ev.status AND to_status = p_status) THEN
    RAISE EXCEPTION 'Passage % -> % non prévu', ev.status, p_status USING ERRCODE = 'CL018';
  END IF;
  -- Date limite de synchronisation (ADR-73) : avant elle, tous les terminaux doivent avoir tout remonté
  IF p_status = 'SETTLING' AND clock_timestamp() < coalesce(event_sync_deadline(p_event), 'infinity') THEN
    SELECT count(*) INTO v FROM event_device_sync_status(p_event) x WHERE NOT x.caught_up;
    IF v > 0 THEN
      RAISE EXCEPTION '% terminal(aux) pas encore à jour avant la date limite de synchronisation (%)', v,
        event_sync_deadline(p_event) USING ERRCODE = 'CL019';
    END IF;
  END IF;
  -- Ordre de verrouillage unique : verrous d'autorité exclusifs (les écritures en vol se terminent), puis les lignes.
  PERFORM pg_advisory_xact_lock(hashtextextended('debit-authority:' || id, 0))
     FROM (SELECT id FROM ledger WHERE scope_type = 'EVENT' AND scope_id = p_event ORDER BY id) x;
  FOR l IN SELECT * FROM ledger WHERE scope_type = 'EVENT' AND scope_id = p_event ORDER BY id FOR NO KEY UPDATE LOOP
    lg := l.id; rem := 0;
    -- À partir du rapprochement, plus aucune passerelle ne doit détenir l'autorité de débit (DB-I14)
    IF p_status IN ('RECONCILING','SETTLING','REFUND_WINDOW','CLOSED') AND l.debit_authority <> 'CENTRAL' THEN
      RAISE EXCEPTION 'Autorité de débit encore détenue par une passerelle : la rendre au central d''abord' USING ERRCODE = 'CL019';
    END IF;
    IF p_status IN ('SETTLING','REFUND_WINDOW','CLOSED') THEN
      v := ledger_purpose_balance(lg, ARRAY['SUSPENSE']);
      IF v <> 0 THEN RAISE EXCEPTION 'Compte d''attente non soldé (%)', v USING ERRCODE = 'CL019'; END IF;
    END IF;
    IF p_status IN ('REFUND_WINDOW','CLOSED') THEN
      SELECT count(*) INTO v FROM party_position pp JOIN party p ON p.id = pp.owner_party_id
       WHERE pp.ledger_id = lg AND p.kind IN ('MERCHANT','OPERATOR','PLATFORM') AND pp.net_claim <> 0;
      IF v > 0 THEN
        RAISE EXCEPTION '% commerçant(s), prestataire ou plateforme avec un droit net non nul', v USING ERRCODE = 'CL019';
      END IF;
      v := ledger_purpose_balance(lg, ARRAY['PAYOUT_PENDING']);
      IF v <> 0 THEN RAISE EXCEPTION 'Versements initiés non confirmés (%)', -v USING ERRCODE = 'CL019'; END IF;
    END IF;
    IF p_status = 'CLOSED' THEN
      dest := (ledger_jurisdiction(lg)).breakage_destination;
      -- seuls peuvent rester dus : le compte légal, et les soldes des festivaliers si la casse est NONE.
      -- Toutes les autres positions doivent être soldées, par partie (droit net) ou par compte sans titulaire.
      keep := CASE WHEN dest = 'NONE' THEN ARRAY['LEGAL_BREAKAGE','WALLET_PAID','CUSTOMER_CASH_DUE'] ELSE ARRAY['LEGAL_BREAKAGE'] END;
      v := ledger_unsettled(lg, keep);
      IF v > 0 THEN
        RAISE EXCEPTION '% position(s) non soldée(s) hors soldes restants autorisés', v USING ERRCODE = 'CL019';
      END IF;
      rem := -ledger_purpose_balance(lg, keep);
      total_rem := total_rem + rem;
      IF ledger_unsettled(lg) = 0 THEN
        to_lock := to_lock || lg;
      ELSE                                   -- soldes restants : seuls remboursements et versement au compte légal
        UPDATE ledger SET status = 'CLOSING', locked_until = clock_timestamp() WHERE id = lg;
      END IF;
    ELSIF p_status IN ('CLOSING','RECONCILING','SETTLING','REFUND_WINDOW') THEN
      UPDATE ledger SET status = 'CLOSING' WHERE id = lg;
    END IF;
  END LOOP;
  PERFORM set_config('app.event_status_change', 'on', true);
  UPDATE event SET status = p_status WHERE id = p_event;
  PERFORM set_config('app.event_status_change', '', true);
  FOREACH lg IN ARRAY to_lock LOOP
    UPDATE ledger SET status = 'CLOSING' WHERE id = lg AND status <> 'CLOSING';
    PERFORM lock_settled_ledger(lg);
  END LOOP;
  INSERT INTO event_status_history (operator_id, event_id, from_status, to_status, actor_id, remaining)
  VALUES (ev.operator_id, p_event, ev.status, p_status, p_actor, CASE WHEN p_status = 'CLOSED' THEN total_rem END);
  RETURN p_status;
END $$;

ALTER TABLE event_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_status_history FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON event_status_history USING (operator_id = current_setting('app.operator_id', true)::uuid);
REVOKE EXECUTE ON FUNCTION ledger_purpose_balance(uuid, text[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION ledger_unsettled(uuid, text[]) FROM PUBLIC;
