-- Comptes des festivaliers par numéro vérifié par code à usage unique (`requestCustomerOtp`, `exchangeCustomerOtp`,
-- `refreshCustomerToken` ; SPECIFICATION §8.5, ADR-66). Servi en avance sur la mission 10a, hors Spec Kitty, à la
-- demande du porteur (10/11/2026). Numéro 0080 : les numéros 0058 à 0067 sont pris par la mission 8 (passerelle).
--
-- Aucun code ni jeton en clair : le code est gardé en empreinte HMAC (secret hors base), le jeton de renouvellement
-- en SHA-256 (256 bits d'aléa). Toute table porte `operator_id`, RLS ENABLE + FORCE. Les trois lectures qui
-- précèdent la connaissance du prestataire (code public, défi, jeton de renouvellement) passent par des fonctions
-- SECURITY DEFINER qui ne rendent que l'identifiant du prestataire. Droits : post-roles.sql, section 10.

-- 1. Code public du prestataire (`operator_code` de l'app multi-prestataires) ---------------------------------------
CREATE TABLE operator_public_code (
  operator_id uuid PRIMARY KEY REFERENCES party(id),
  code        text NOT NULL UNIQUE CHECK (code ~ '^[a-z0-9][a-z0-9-]{1,40}$'),
  created_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE operator_public_code ENABLE ROW LEVEL SECURITY;
ALTER TABLE operator_public_code FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON operator_public_code
  USING (operator_id = current_setting('app.operator_id', true)::uuid)
  WITH CHECK (operator_id = current_setting('app.operator_id', true)::uuid);

-- 2. Numéro vérifié d'un compte festivalier (un numéro = un compte par prestataire) ---------------------------------
CREATE TABLE customer_identity (
  customer_id uuid PRIMARY KEY REFERENCES party(id),
  operator_id uuid NOT NULL REFERENCES party(id),
  phone       text NOT NULL CHECK (phone ~ '^\+[1-9][0-9]{6,14}$'),
  verified_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (operator_id, phone)
);
ALTER TABLE customer_identity ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_identity FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON customer_identity
  USING (operator_id = current_setting('app.operator_id', true)::uuid)
  WITH CHECK (operator_id = current_setting('app.operator_id', true)::uuid);

-- 3. Défi : un code à 6 chiffres, 5 essais au plus, valable `expires_at` ----------------------------------------------
CREATE TABLE otp_challenge (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id    uuid NOT NULL REFERENCES party(id),
  phone          text NOT NULL CHECK (phone ~ '^\+[1-9][0-9]{6,14}$'),
  channel        text NOT NULL CHECK (channel IN ('AUTO', 'SMS', 'WHATSAPP')),
  code_hash      bytea NOT NULL CHECK (octet_length(code_hash) = 32),
  -- Référence HMAC de l'adresse appelante (jamais l'adresse en clair) : limite par adresse.
  client_ref     text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at     timestamptz NOT NULL,
  attempts       integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  consumed_at    timestamptz,
  invalidated_at timestamptz,
  CHECK (consumed_at IS NULL OR invalidated_at IS NULL)
);
CREATE INDEX otp_challenge_phone_idx ON otp_challenge (operator_id, phone, created_at);
CREATE INDEX otp_challenge_client_idx ON otp_challenge (operator_id, client_ref, created_at);
ALTER TABLE otp_challenge ENABLE ROW LEVEL SECURITY;
ALTER TABLE otp_challenge FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON otp_challenge
  USING (operator_id = current_setting('app.operator_id', true)::uuid)
  WITH CHECK (operator_id = current_setting('app.operator_id', true)::uuid);

-- 4. Numéro bloqué après 5 essais faux sur un code -------------------------------------------------------------------
CREATE TABLE otp_phone_block (
  operator_id   uuid NOT NULL REFERENCES party(id),
  phone         text NOT NULL,
  blocked_until timestamptz NOT NULL,
  PRIMARY KEY (operator_id, phone)
);
ALTER TABLE otp_phone_block ENABLE ROW LEVEL SECURITY;
ALTER TABLE otp_phone_block FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON otp_phone_block
  USING (operator_id = current_setting('app.operator_id', true)::uuid)
  WITH CHECK (operator_id = current_setting('app.operator_id', true)::uuid);

-- 5. Jetons de renouvellement : usage unique, rotation par famille, réemploi = famille révoquée ----------------------
CREATE TABLE customer_refresh_token (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id uuid NOT NULL REFERENCES party(id),
  customer_id uuid NOT NULL REFERENCES party(id),
  family_id   uuid NOT NULL,
  token_hash  bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
  created_at  timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  revoked_at  timestamptz
);
CREATE INDEX customer_refresh_token_family_idx ON customer_refresh_token (family_id);
ALTER TABLE customer_refresh_token ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_refresh_token FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON customer_refresh_token
  USING (operator_id = current_setting('app.operator_id', true)::uuid)
  WITH CHECK (operator_id = current_setting('app.operator_id', true)::uuid);

-- 6. Lectures hors prestataire : ne rendent que l'identifiant du prestataire ----------------------------------------
CREATE FUNCTION operator_by_public_code(p_code text) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT operator_id FROM operator_public_code WHERE code = lower(p_code)
$$;
CREATE FUNCTION otp_challenge_operator(p_challenge uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT operator_id FROM otp_challenge WHERE id = p_challenge
$$;
CREATE FUNCTION customer_refresh_operator(p_hash bytea) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT operator_id FROM customer_refresh_token WHERE token_hash = p_hash
$$;
REVOKE ALL ON FUNCTION operator_by_public_code(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION otp_challenge_operator(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION customer_refresh_operator(bytea) FROM PUBLIC;
