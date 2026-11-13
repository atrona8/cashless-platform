-- edge-0001 : schéma de la base LOCALE de la passerelle (data-model.md partie B, interfaces.md § 9,
-- § 12.9, § 13.1).
-- Toute la série en une seule migration (les lots WP17 à WP24 n'en ajoutent une qu'en cas de besoin
-- signalé).
--
-- Rôle : un seul, `edge_app`, qui joue cette migration et possède les tables. Il n'est pas
-- SUPERUSER (vérifié ci-dessous).
-- Aucun GRANT : tout objet est fermé à PUBLIC. Pas de RLS (une passerelle = un prestataire, un
-- événement).
-- Aucun mot de passe en clair, aucune clé privée : les colis de mots de passe sont chiffrés
-- (`*_enc`, bytea).
--
-- Colonnes ajoutées à data-model.md B (signalées au compte rendu de WP16) :
--   edge_authority.handover_failed_epoch   (B.8 : RELEASING -> ACTIVE exige handover_failed_epoch =
-- epoch)
--   edge_clock.ack_refused                 (T073 : écart de plus de 24 h, l'accusé de bascule est
-- refusé)
--   edge_meta.central_ca_pem, device_ca_pem, client_cert_pem (fichier d'enrôlement, § 13.1 :
-- matière publique)
--   edge_site_order_key                    (§ 13.1 : parties publiques des deux clés d'ordres
-- locaux)

DO $$
BEGIN
  IF (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'edge-0001 : le rôle de la base locale ne doit pas être SUPERUSER';
  END IF;
END $$;

ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- ---------------------------------------------------------------------------------------------------------------
-- Déclencheurs génériques
-- ---------------------------------------------------------------------------------------------------------------
CREATE FUNCTION edge_forbid_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% interdit sur %', TG_OP, TG_TABLE_NAME USING ERRCODE = 'restrict_violation';
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- B.1 Identité et autorité
-- ---------------------------------------------------------------------------------------------------------------
CREATE TABLE edge_meta (
  id              boolean PRIMARY KEY DEFAULT true CHECK (id),
  gateway_id      uuid NOT NULL,
  operator_id     uuid NOT NULL,
  event_id        uuid NOT NULL,
  ledger_id       uuid NOT NULL,
  serial          text NOT NULL CHECK (serial <> ''),
  role            text NOT NULL CHECK (role IN ('PRIMARY', 'STANDBY')),
  central_url     text NOT NULL,
  lan_authority   text NOT NULL,
  central_ca_pem  text NOT NULL,
  device_ca_pem   text NOT NULL,
  client_cert_pem text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION edge_meta_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'DELETE interdit sur edge_meta' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.gateway_id IS DISTINCT FROM OLD.gateway_id OR NEW.operator_id IS DISTINCT FROM OLD.operator_id
     OR NEW.event_id IS DISTINCT FROM OLD.event_id OR NEW.ledger_id IS DISTINCT FROM OLD.ledger_id
     OR NEW.serial IS DISTINCT FROM OLD.serial THEN
    RAISE EXCEPTION 'identité de la passerelle immuable (edge_meta)' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER edge_meta_guard BEFORE UPDATE OR DELETE ON edge_meta
  FOR EACH ROW EXECUTE FUNCTION edge_meta_guard();

-- Parties publiques des deux clés d'ordres locaux à deux personnes (§ 12.13, § 13.1) : zéro ou
-- exactement deux.
CREATE TABLE edge_site_order_key (
  holder     text PRIMARY KEY CHECK (holder <> ''),
  public_key text NOT NULL UNIQUE CHECK (public_key <> '')
);
CREATE FUNCTION edge_site_order_key_count() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT count(*) FROM edge_site_order_key) NOT IN (0, 2) THEN
    RAISE EXCEPTION 'edge_site_order_key : exactement deux clés de site attendues'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER edge_site_order_key_count AFTER INSERT OR UPDATE OR DELETE ON edge_site_order_key
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION edge_site_order_key_count();

CREATE TABLE edge_authority (
  id                     boolean PRIMARY KEY DEFAULT true CHECK (id),
  state                  text NOT NULL CHECK (state IN ('STANDBY', 'ARMED', 'GRANTED_PENDING', 'ACTIVE',
                                                        'RELEASING', 'RELEASED', 'STALE', 'REVOKED')),
  link_state             text NOT NULL DEFAULT 'ISOLATED' CHECK (link_state IN ('CONNECTED', 'ISOLATED', 'CATCHING_UP')),
  epoch                  bigint NOT NULL DEFAULT 0 CHECK (epoch >= 0),
  handover_id            uuid,
  watermark_posting_id   bigint,
  activated_at           timestamptz,
  edge_seq_at_activation bigint,
  token_tolerance_until  timestamptz,
  releasing_since        timestamptz,
  highest_epoch_seen     bigint NOT NULL DEFAULT 0 CHECK (highest_epoch_seen >= 0),
  unconfirmed_epoch_seen bigint,
  handover_failed_epoch  bigint,
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE edge_authority_transition (
  from_state text NOT NULL,
  to_state   text NOT NULL,
  PRIMARY KEY (from_state, to_state)
);
-- Machine à états de data-model.md B.8, ni plus ni moins.
INSERT INTO edge_authority_transition (from_state, to_state) VALUES
  ('STANDBY', 'ARMED'),
  ('ARMED', 'GRANTED_PENDING'),
  ('GRANTED_PENDING', 'ACTIVE'),
  ('GRANTED_PENDING', 'ARMED'),
  ('ACTIVE', 'RELEASING'),
  ('ACTIVE', 'STALE'),
  ('STALE', 'ACTIVE'),
  ('RELEASING', 'RELEASED'),
  ('RELEASING', 'ACTIVE'),
  ('STALE', 'GRANTED_PENDING'),
  ('RELEASED', 'ARMED'),
  ('ACTIVE', 'REVOKED'),
  ('ARMED', 'REVOKED');
CREATE TRIGGER edge_authority_transition_frozen
  BEFORE INSERT OR UPDATE OR DELETE ON edge_authority_transition
  FOR EACH STATEMENT EXECUTE FUNCTION edge_forbid_change();
CREATE TRIGGER edge_authority_transition_no_truncate
  BEFORE TRUNCATE ON edge_authority_transition
  FOR EACH STATEMENT EXECUTE FUNCTION edge_forbid_change();

CREATE FUNCTION edge_authority_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.state NOT IN ('STANDBY', 'ARMED') THEN
      RAISE EXCEPTION 'edge_authority : état initial % interdit (STANDBY ou ARMED)', NEW.state
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'DELETE interdit sur edge_authority' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.state IS DISTINCT FROM OLD.state THEN
    IF NOT EXISTS (SELECT 1 FROM edge_authority_transition t
                    WHERE t.from_state = OLD.state AND t.to_state = NEW.state) THEN
      RAISE EXCEPTION 'edge_authority : transition % -> % absente de la table', OLD.state, NEW.state
        USING ERRCODE = 'restrict_violation';
    END IF;
    -- Invariant B.7-4 : RELEASING ne retourne à ACTIVE que sur échec du handover signalé pour la
    -- même époque.
    IF OLD.state = 'RELEASING' AND NEW.state = 'ACTIVE'
       AND NEW.handover_failed_epoch IS DISTINCT FROM NEW.epoch THEN
      RAISE EXCEPTION 'edge_authority : RELEASING -> ACTIVE exige handover_failed_epoch = epoch'
        USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER edge_authority_guard BEFORE INSERT OR UPDATE OR DELETE ON edge_authority
  FOR EACH ROW EXECUTE FUNCTION edge_authority_guard();

-- A14 : le plafond d'heure ne décroît jamais ; la valeur monotone n'est pas persistée.
CREATE TABLE edge_clock (
  id                boolean PRIMARY KEY DEFAULT true CHECK (id),
  time_floor        timestamptz NOT NULL,
  central_offset_ms bigint,
  boot_id           uuid,
  boot_system_time  timestamptz,
  skew_alert        boolean NOT NULL DEFAULT false,
  ack_refused       boolean NOT NULL DEFAULT false
);
INSERT INTO edge_clock (time_floor) VALUES ('1970-01-01T00:00:00Z');
CREATE FUNCTION edge_clock_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR NEW.time_floor < OLD.time_floor THEN
    RAISE EXCEPTION 'edge_clock : le plafond d''heure ne décroît jamais' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER edge_clock_guard BEFORE UPDATE OR DELETE ON edge_clock
  FOR EACH ROW EXECUTE FUNCTION edge_clock_guard();

-- ---------------------------------------------------------------------------------------------------------------
-- B.2 File des décisions
-- ---------------------------------------------------------------------------------------------------------------
-- Une seule ligne, créée à l'enrôlement avec `last_chain_hash = edge_chain_genesis(gateway_id)`
-- calculée par le code
-- partagé (@cashless/shared-rules), jamais en SQL.
CREATE TABLE edge_chain_head (
  id              boolean PRIMARY KEY DEFAULT true CHECK (id),
  last_edge_seq   bigint NOT NULL DEFAULT 0 CHECK (last_edge_seq >= 0),
  last_chain_hash bytea NOT NULL CHECK (octet_length(last_chain_hash) = 32),
  acked_edge_seq  bigint NOT NULL DEFAULT 0 CHECK (acked_edge_seq >= 0),
  acked_chain_hash bytea CHECK (acked_chain_hash IS NULL OR octet_length(acked_chain_hash) = 32),
  CHECK (acked_edge_seq <= last_edge_seq)
);
CREATE FUNCTION edge_chain_head_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR NEW.last_edge_seq < OLD.last_edge_seq OR NEW.acked_edge_seq < OLD.acked_edge_seq THEN
    RAISE EXCEPTION 'edge_chain_head : les numéros ne reculent jamais' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER edge_chain_head_guard BEFORE UPDATE OR DELETE ON edge_chain_head
  FOR EACH ROW EXECUTE FUNCTION edge_chain_head_guard();

CREATE TABLE edge_device_batch (
  device_batch_id  uuid PRIMARY KEY,
  device_id        uuid NOT NULL,
  header           jsonb NOT NULL,
  signature        bytea NOT NULL,
  received_at      timestamptz NOT NULL DEFAULT now(),
  relayed_in_batch uuid
);

CREATE TABLE edge_outgoing_batch (
  batch_id      uuid PRIMARY KEY,
  edge_seq_from bigint NOT NULL CHECK (edge_seq_from >= 1),
  edge_seq_to   bigint NOT NULL,
  epoch         bigint NOT NULL,
  body_sha256   bytea NOT NULL CHECK (octet_length(body_sha256) = 32),
  status        text NOT NULL CHECK (status IN ('PREPARED', 'SENT', 'DONE')),
  sent_at       timestamptz,
  CHECK (edge_seq_to >= edge_seq_from)
);
-- B.7-7 : un seul lot non DONE à la fois.
CREATE UNIQUE INDEX edge_outgoing_batch_one_in_flight ON edge_outgoing_batch ((true)) WHERE status <> 'DONE';

CREATE TABLE edge_op (
  edge_seq              bigint PRIMARY KEY CHECK (edge_seq >= 1),
  origin_key            text NOT NULL UNIQUE CHECK (origin_key <> ''),
  type                  text NOT NULL CHECK (type IN ('PURCHASE', 'REVERSAL', 'TOPUP_CASH', 'VOID', 'ONLINE_REF',
                                                      'ACTIVATION', 'DEPOSIT_CASH')),
  authorized_mode       text NOT NULL CHECK (authorized_mode IN ('EDGE_ONLINE', 'DEVICE_OFFLINE')),
  device_serial         text NOT NULL,
  device_id             uuid NOT NULL,
  device_batch_id       uuid REFERENCES edge_device_batch (device_batch_id),
  operation             jsonb NOT NULL,
  content_sha256        bytea NOT NULL CHECK (octet_length(content_sha256) = 32),
  chain_hash            bytea NOT NULL CHECK (octet_length(chain_hash) = 32),
  occurred_at           timestamptz NOT NULL,
  recorded_at           timestamptz NOT NULL,
  central_status        text NOT NULL DEFAULT 'PENDING' CHECK (central_status IN (
                          'PENDING', 'SENT', 'ACCEPTED', 'ACCEPTED_WITH_SHORTFALL', 'DUPLICATE', 'REJECTED', 'VOID')),
  central_transaction_id text,
  central_reason        text,
  central_detail        jsonb,
  sent_batch_id         uuid REFERENCES edge_outgoing_batch (batch_id),
  CHECK ((authorized_mode = 'DEVICE_OFFLINE') = (device_batch_id IS NOT NULL))
);
CREATE INDEX edge_op_status_seq ON edge_op (central_status, edge_seq);

-- Continuité (B.7-2) : le numéro suivant est exactement max + 1 ; une opération naît PENDING ;
-- seuls `central_*` et
-- `sent_batch_id` changent ensuite ; rien ne supprime ni ne vide.
CREATE FUNCTION edge_op_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  mutable text[] := ARRAY['central_status', 'central_transaction_id', 'central_reason', 'central_detail',
                          'sent_batch_id'];
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.edge_seq <> COALESCE((SELECT max(edge_seq) FROM edge_op), 0) + 1 THEN
      RAISE EXCEPTION 'edge_op : edge_seq doit suivre sans trou le plus grand numéro' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.central_status <> 'PENDING' OR NEW.sent_batch_id IS NOT NULL THEN
      RAISE EXCEPTION 'edge_op : une opération naît PENDING et non envoyée' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF (to_jsonb(NEW) - mutable) IS DISTINCT FROM (to_jsonb(OLD) - mutable) THEN
      RAISE EXCEPTION 'edge_op : champ de contenu non modifiable (edge_seq %)', OLD.edge_seq
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION '% interdit sur edge_op', TG_OP USING ERRCODE = 'restrict_violation';
END $$;
CREATE TRIGGER edge_op_guard BEFORE INSERT OR UPDATE OR DELETE ON edge_op
  FOR EACH ROW EXECUTE FUNCTION edge_op_guard();
CREATE TRIGGER edge_op_no_truncate BEFORE TRUNCATE ON edge_op
  FOR EACH STATEMENT EXECUTE FUNCTION edge_forbid_change();

-- Purge par issue du central (A26) : les deltas se suppriment, jamais l'opération.
CREATE TABLE edge_op_delta (
  edge_seq    bigint NOT NULL REFERENCES edge_op (edge_seq),
  wallet_id   uuid NOT NULL,
  paid_delta  bigint NOT NULL,
  promo_delta bigint NOT NULL,
  PRIMARY KEY (edge_seq, wallet_id)
);
CREATE INDEX edge_op_delta_wallet ON edge_op_delta (wallet_id, edge_seq);

-- ---------------------------------------------------------------------------------------------------------------
-- B.3 Soldes et bracelets (copie répliquée, R)
-- ---------------------------------------------------------------------------------------------------------------
CREATE TABLE edge_wallet (
  wallet_id        uuid PRIMARY KEY,
  status           text NOT NULL,
  central_paid     bigint NOT NULL CHECK (central_paid >= 0),
  central_promo    bigint NOT NULL CHECK (central_promo >= 0),
  applied_edge_seq bigint NOT NULL DEFAULT 0,
  last_posting_id  bigint
);

CREATE TABLE edge_media (
  token_hash        bytea PRIMARY KEY CHECK (octet_length(token_hash) = 32),
  media_id          uuid NOT NULL,
  wallet_id         uuid,
  status            text NOT NULL,
  batch_id          uuid,
  batch_status      text,
  uid               bytea,
  counter_last      bigint NOT NULL DEFAULT 0,
  signature_key_ref text,
  -- Colis chiffré sous la clé de contenu `edge_pwd_pack_key`, scellée pour la clé d'accord de la
  -- passerelle.
  pwd_pack_enc      bytea,
  version           bigint NOT NULL DEFAULT 0
);
CREATE INDEX edge_media_media ON edge_media (media_id);
CREATE INDEX edge_media_wallet ON edge_media (wallet_id);

CREATE TABLE edge_tap (
  tap_id               bigserial PRIMARY KEY,
  token_hash           bytea NOT NULL,
  device_id            uuid NOT NULL,
  counter              bigint NOT NULL,
  result               text NOT NULL,
  consumed_by_edge_seq bigint,
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE edge_replication_cursor (
  id                        boolean PRIMARY KEY DEFAULT true CHECK (id),
  last_replicated_posting_id bigint NOT NULL DEFAULT 0,
  last_change_seq           bigint NOT NULL DEFAULT 0,
  last_edge_seq_applied     bigint NOT NULL DEFAULT 0,
  last_applied_at           timestamptz
);
INSERT INTO edge_replication_cursor DEFAULT VALUES;

-- ---------------------------------------------------------------------------------------------------------------
-- B.4 État de service (R) : chaque entité est remplacée en entier quand `reference` la porte
-- ---------------------------------------------------------------------------------------------------------------
CREATE TABLE edge_cash_session (
  cash_session_id uuid PRIMARY KEY,
  device_id       uuid NOT NULL,
  cash_account_id uuid NOT NULL,
  opened_by_iss   text NOT NULL,
  opened_by_sub   text NOT NULL,
  opened_at       timestamptz NOT NULL,
  status          text NOT NULL,
  usable_on_edge  boolean NOT NULL DEFAULT false,
  closed_at       timestamptz
);
CREATE TABLE edge_vendor_session (
  vendor_session_id uuid PRIMARY KEY,
  vendor_id         uuid NOT NULL,
  device_id         uuid NOT NULL,
  expires_at        timestamptz NOT NULL,
  closed_at         timestamptz
);
CREATE TABLE edge_vendor (
  vendor_id    uuid PRIMARY KEY,
  display_name text NOT NULL,
  status       text NOT NULL,
  blocked      boolean NOT NULL DEFAULT false
);
CREATE TABLE edge_device (
  device_id            uuid PRIMARY KEY,
  serial               text NOT NULL UNIQUE,
  kind                 text NOT NULL,
  app_mode             text,
  status               text NOT NULL,
  public_key           bytea,
  cert_sha256          bytea CHECK (cert_sha256 IS NULL OR octet_length(cert_sha256) = 32),
  agreement_public_key bytea,
  station_id           uuid,
  pos_id               uuid
);
CREATE TABLE edge_device_token_family (
  fid                          uuid PRIMARY KEY,
  device_id                    uuid NOT NULL,
  status                       text NOT NULL,
  -- Empreinte du jeton de rafraîchissement courant (décision 11 : renouvellement sans rotation),
  -- jamais le jeton.
  refresh_token_sha256_current bytea CHECK (refresh_token_sha256_current IS NULL
                                            OR octet_length(refresh_token_sha256_current) = 32)
);
-- Copie tenue par la passerelle (WP22) tant que le serveur d'identité est joignable ; pas répliquée
-- par le central.
CREATE TABLE edge_identity_key (
  kid    text PRIMARY KEY,
  jwk    jsonb NOT NULL,
  issuer text NOT NULL
);
CREATE TABLE edge_staff (
  iss    text NOT NULL,
  sub    text NOT NULL,
  status text NOT NULL,
  roles  text[] NOT NULL DEFAULT '{}',
  PRIMARY KEY (iss, sub)
);
CREATE TABLE edge_catalog_item (
  pos_id  uuid NOT NULL,
  item_id uuid NOT NULL,
  version bigint NOT NULL DEFAULT 0,
  price   bigint NOT NULL CHECK (price >= 0),
  lines   jsonb NOT NULL DEFAULT '[]',
  PRIMARY KEY (pos_id, item_id)
);
CREATE TABLE edge_event_setting (
  id                 boolean PRIMARY KEY DEFAULT true CHECK (id),
  status             text NOT NULL,
  currency           text NOT NULL,
  minor_units        integer NOT NULL,
  timezone           text NOT NULL,
  activation_modes   text[] NOT NULL DEFAULT '{}',
  terminal_settings  jsonb NOT NULL DEFAULT '{}',
  config_id          text,
  offline_policy     jsonb NOT NULL DEFAULT '{}',
  policy_in_force    jsonb NOT NULL DEFAULT '[]'
);
CREATE TABLE edge_wallet_limit (
  wallet_id         uuid PRIMARY KEY,
  topup_month_paid  bigint NOT NULL DEFAULT 0,
  limits            jsonb NOT NULL DEFAULT '{}'
);
CREATE TABLE edge_wallet_state (
  wallet_id           uuid PRIMARY KEY,
  status              text NOT NULL,
  identification_tier text,
  change_seq          bigint NOT NULL DEFAULT 0
);
-- Magasin de la clé de contenu des colis de mots de passe : toujours SCELLÉE pour la clé d'accord
-- de la passerelle.
CREATE TABLE edge_pwd_pack_key (
  key_id     text PRIMARY KEY,
  sealed_key bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------------------------------------------
-- B.5 Preuves de requête et idempotence (L)
-- ---------------------------------------------------------------------------------------------------------------
CREATE TABLE edge_device_nonce (
  device_id  uuid NOT NULL,
  nonce      text NOT NULL,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (device_id, nonce)
);
CREATE INDEX edge_device_nonce_expiry ON edge_device_nonce (expires_at);
CREATE TABLE edge_idempotency (
  device_id       uuid NOT NULL,
  idempotency_key text NOT NULL,
  request_sha256  bytea NOT NULL CHECK (octet_length(request_sha256) = 32),
  status_code     integer NOT NULL,
  response        jsonb,
  edge_seq        bigint REFERENCES edge_op (edge_seq),
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (device_id, idempotency_key)
);
CREATE TABLE edge_device_seq (
  device_id            uuid PRIMARY KEY,
  contiguous_local_seq bigint NOT NULL DEFAULT 0,
  last_chain_hash      bytea,
  central_acked_seq    bigint NOT NULL DEFAULT 0,
  central_acked_at     timestamptz,
  acked_known          boolean NOT NULL DEFAULT false
);

-- ---------------------------------------------------------------------------------------------------------------
-- B.6 Jetons, audit, snapshots (L)
-- ---------------------------------------------------------------------------------------------------------------
-- La clé privée n'est PAS en base : port matériel (HARDWARE_KEYSTORE).
CREATE TABLE edge_token_key (
  kid        text PRIMARY KEY,
  public_jwk jsonb NOT NULL,
  status     text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  rotated_at timestamptz
);

-- Journal append-only chaîné. `prev_hash` et `row_hash` sont calculés par le déclencheur (jamais
-- par l'appelant) :
-- row_hash = SHA-256(prev_hash || id || at || kind || actor || device_id || edge_seq || detail).
CREATE TABLE edge_audit (
  id            bigserial PRIMARY KEY,
  at            timestamptz NOT NULL DEFAULT now(),
  kind          text NOT NULL CHECK (kind <> ''),
  actor         text,
  device_id     uuid,
  edge_seq      bigint,
  detail        jsonb NOT NULL DEFAULT '{}',
  sent_in_batch uuid,
  prev_hash     bytea NOT NULL,
  row_hash      bytea NOT NULL
);
CREATE FUNCTION edge_audit_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  previous bytea;
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM pg_advisory_xact_lock(hashtext('edge_audit_chain'));
    SELECT row_hash INTO previous FROM edge_audit ORDER BY id DESC LIMIT 1;
    NEW.prev_hash := COALESCE(previous, '\x0000000000000000000000000000000000000000000000000000000000000000'::bytea);
    NEW.row_hash := sha256(NEW.prev_hash || convert_to(concat_ws('|', NEW.id, extract(epoch FROM NEW.at),
      NEW.kind, NEW.actor, NEW.device_id, NEW.edge_seq, NEW.detail), 'UTF8'));
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    -- Seule colonne qui change : `sent_in_batch`, une fois (NULL vers une valeur).
    IF (to_jsonb(NEW) - 'sent_in_batch') IS DISTINCT FROM (to_jsonb(OLD) - 'sent_in_batch')
       OR OLD.sent_in_batch IS NOT NULL THEN
      RAISE EXCEPTION 'edge_audit : journal en ajout seul' USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION '% interdit sur edge_audit', TG_OP USING ERRCODE = 'restrict_violation';
END $$;
CREATE TRIGGER edge_audit_guard BEFORE INSERT OR UPDATE OR DELETE ON edge_audit
  FOR EACH ROW EXECUTE FUNCTION edge_audit_guard();
CREATE TRIGGER edge_audit_no_truncate BEFORE TRUNCATE ON edge_audit
  FOR EACH STATEMENT EXECUTE FUNCTION edge_forbid_change();

CREATE TABLE edge_snapshot (
  version        bigint PRIMARY KEY,
  kind           text NOT NULL CHECK (kind IN ('FULL', 'DELTA')),
  base_version   bigint,
  header         jsonb NOT NULL,
  signature      bytea NOT NULL,
  signing_kid    text NOT NULL,
  content_sha256 bytea NOT NULL CHECK (octet_length(content_sha256) = 32),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE edge_snapshot_entry (
  version      bigint NOT NULL,
  token_hash   bytea NOT NULL CHECK (octet_length(token_hash) = 32),
  entry        jsonb NOT NULL,
  pwd_pack_enc bytea,
  removed      boolean NOT NULL DEFAULT false,
  PRIMARY KEY (version, token_hash)
);
CREATE TABLE edge_snapshot_key (
  version   bigint NOT NULL,
  device_id uuid NOT NULL,
  envelope  jsonb NOT NULL,
  PRIMARY KEY (version, device_id)
);
CREATE TABLE edge_snapshot_ack (
  device_id uuid NOT NULL,
  version   bigint NOT NULL,
  acked_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (device_id, version)
);

-- ---------------------------------------------------------------------------------------------------------------
-- Droits : tout est fermé à PUBLIC ; `edge_app` (propriétaire) est le seul rôle qui touche ces
-- objets.
-- ---------------------------------------------------------------------------------------------------------------
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
