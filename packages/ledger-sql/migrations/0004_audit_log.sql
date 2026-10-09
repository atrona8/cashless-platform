-- Migration 0004 : journal d'audit en ajout seul, chaîné ligne à ligne par prestataire, scellé périodiquement
-- (SPECIFICATION §13.3 ; décision du porteur du projet du 2026-10-08 ; contrat
-- kitty-specs/identite-roles-double-validation-01M4DNDN/contracts/audit-chain.md, qui fait foi pour le format).
-- La tâche planifiée de scellement et la copie hors de la base relèvent de la mission 9 (avec le grand livre).
-- Droits du rôle applicatif ajustés par post-roles.sql : INSERT et SELECT sur audit_log, rien d'autre.

-- Chaîne de la plateforme (lignes sans prestataire).
CREATE FUNCTION audit_platform_chain() RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT '00000000-0000-0000-0000-000000000000'::uuid
$$;

CREATE TABLE audit_log (
  id           bigserial PRIMARY KEY,
  operator_id  uuid REFERENCES party(id),                 -- NULL = plateforme
  chain_key    uuid NOT NULL,                             -- posé par le déclencheur
  seq          bigint NOT NULL,                           -- posé par le déclencheur, sans trou dans la chaîne
  occurred_at  timestamptz NOT NULL,                      -- posé par le déclencheur
  actor_id     uuid,                                      -- personne ; NULL pour une commande d'exploitation
  actor_role   text,
  action       text NOT NULL CHECK (length(action) > 0),
  object_type  text,
  object_id    text,
  before       jsonb,
  after        jsonb,
  approver_id  uuid,
  origin       text,
  request_id   uuid,
  prev_hash    bytea NOT NULL CHECK (octet_length(prev_hash) = 32),
  row_hash     bytea NOT NULL CHECK (octet_length(row_hash) = 32),
  CONSTRAINT audit_log_chain_seq_uniq UNIQUE (chain_key, seq)
);
CREATE INDEX audit_log_operator_time_idx ON audit_log (operator_id, occurred_at);

-- Point de départ d'une chaîne : SHA-256("CASHLESS/AUDIT/v1" ‖ chain_key sur 16 octets).
CREATE FUNCTION audit_chain_genesis(p_chain uuid) RETURNS bytea LANGUAGE sql IMMUTABLE AS $$
  SELECT sha256(convert_to('CASHLESS/AUDIT/v1', 'UTF8') || uuid_send(p_chain))
$$;

-- Ligne canonique (UTF-8, champs séparés par « | », champ NULL omis avec son séparateur, comme concat_ws).
CREATE FUNCTION audit_row_canonical(r audit_log) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT concat_ws('|', r.chain_key::text, r.seq::text,
                   to_char(r.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'),
                   r.actor_id::text, r.actor_role, r.action, r.object_type, r.object_id,
                   r.before::text, r.after::text, r.approver_id::text, r.origin, r.request_id::text)
$$;

-- Chaînage : numéro et empreintes toujours posés ici (les valeurs fournies sont écrasées), sous un verrou de la
-- chaîne pris avant de lire la dernière ligne. SECURITY DEFINER : la chaîne plateforme est invisible sous RLS.
CREATE FUNCTION audit_log_chain() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE last audit_log%ROWTYPE;
BEGIN
  NEW.chain_key := coalesce(NEW.operator_id, audit_platform_chain());
  PERFORM pg_advisory_xact_lock(hashtextextended('audit-chain:' || NEW.chain_key, 0));
  SELECT * INTO last FROM audit_log WHERE chain_key = NEW.chain_key ORDER BY seq DESC LIMIT 1;
  NEW.seq := coalesce(last.seq, 0) + 1;
  NEW.occurred_at := clock_timestamp();
  NEW.prev_hash := coalesce(last.row_hash, audit_chain_genesis(NEW.chain_key));
  NEW.row_hash := sha256(NEW.prev_hash || convert_to(audit_row_canonical(NEW), 'UTF8'));
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION audit_log_chain() FROM PUBLIC;
CREATE TRIGGER audit_log_chain BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION audit_log_chain();

-- Ajout seul, pour tout rôle (propriétaire compris).
CREATE FUNCTION audit_log_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Journal d''audit en ajout seul' USING ERRCODE = 'CL001';
END $$;
CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_append_only();

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON audit_log
  USING (operator_id = current_setting('app.operator_id', true)::uuid)
  WITH CHECK (operator_id = current_setting('app.operator_id', true)::uuid);

-- Scellements : tête de chaîne périodiquement figée ; copiés hors de la base par la mission 9 (external_ref).
CREATE TABLE audit_seal (
  chain_key       uuid NOT NULL,
  operator_id     uuid REFERENCES party(id),              -- NULL = plateforme
  seal_no         int NOT NULL CHECK (seal_no >= 1),
  first_seq       bigint NOT NULL,
  last_seq        bigint NOT NULL,
  rows            int NOT NULL CHECK (rows >= 1),
  rows_sha256     bytea NOT NULL CHECK (octet_length(rows_sha256) = 32),
  prev_seal_hash  bytea NOT NULL CHECK (octet_length(prev_seal_hash) = 32),
  seal_hash       bytea NOT NULL CHECK (octet_length(seal_hash) = 32),
  sealed_at       timestamptz NOT NULL DEFAULT clock_timestamp(),
  external_ref    text,
  PRIMARY KEY (chain_key, seal_no),
  CHECK (last_seq >= first_seq)
);

-- Ajout seul ; seule external_ref passe de NULL à une valeur, une fois (comme ledger_seal_guard).
CREATE FUNCTION audit_seal_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.external_ref IS NOT NULL OR NEW.external_ref IS NULL
     OR (to_jsonb(NEW) - 'external_ref') <> (to_jsonb(OLD) - 'external_ref') THEN
    RAISE EXCEPTION 'Table audit_seal en ajout seul (external_ref : renseignée une seule fois)' USING ERRCODE = 'CL001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER audit_seal_append_only BEFORE UPDATE OR DELETE ON audit_seal
  FOR EACH ROW EXECUTE FUNCTION audit_seal_guard();

ALTER TABLE audit_seal ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_seal FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON audit_seal
  USING (operator_id = current_setting('app.operator_id', true)::uuid);

-- Empreinte des lignes d'une plage : SHA-256 de la concaténation des row_hash, dans l'ordre de seq.
CREATE FUNCTION audit_rows_sha256(p_chain uuid, p_first bigint, p_last bigint) RETURNS bytea
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT sha256(coalesce(string_agg(row_hash, ''::bytea ORDER BY seq), ''::bytea))
    FROM audit_log WHERE chain_key = p_chain AND seq BETWEEN p_first AND p_last
$$;

-- Scelle les lignes nouvelles d'une chaîne : de la dernière ligne scellée + 1 à la dernière ligne enregistrée
-- depuis plus de p_min_age (mêmes raisons que seal_ledger, §13.7). NULL s'il n'y a rien de nouveau.
-- Fonction d'exploitation : EXECUTE retiré au rôle applicatif par post-roles.sql.
CREATE FUNCTION seal_audit(p_chain uuid, p_min_age interval DEFAULT interval '5 minutes') RETURNS audit_seal
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE prev audit_seal%ROWTYPE; lo bigint; hi bigint; n int; rh bytea; ph bytea; sh bytea; op uuid;
        r audit_seal%ROWTYPE;
BEGIN
  IF p_min_age < interval '0' THEN RAISE EXCEPTION 'Délai négatif' USING ERRCODE = 'CL001'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('audit-seal:' || p_chain, 0));
  SELECT * INTO prev FROM audit_seal WHERE chain_key = p_chain ORDER BY seal_no DESC LIMIT 1;
  lo := coalesce(prev.last_seq, 0) + 1;
  SELECT max(seq) INTO hi FROM audit_log
   WHERE chain_key = p_chain AND seq >= lo AND occurred_at <= clock_timestamp() - p_min_age;
  IF hi IS NULL THEN RETURN NULL; END IF;
  SELECT count(*), min(operator_id::text)::uuid INTO n, op FROM audit_log WHERE chain_key = p_chain AND seq BETWEEN lo AND hi;
  rh := audit_rows_sha256(p_chain, lo, hi);
  ph := coalesce(prev.seal_hash, audit_chain_genesis(p_chain));
  sh := sha256(ph || uuid_send(p_chain) || int8send(lo) || int8send(hi) || rh);
  INSERT INTO audit_seal (chain_key, operator_id, seal_no, first_seq, last_seq, rows, rows_sha256, prev_seal_hash, seal_hash)
  VALUES (p_chain, op, coalesce(prev.seal_no, 0) + 1, lo, hi, n, rh, ph, sh)
  RETURNING * INTO r;
  RETURN r;
END $$;

-- Vérifie une chaîne (lignes depuis p_since) et tous ses scellements ; une ligne par anomalie, aucune si intègre.
-- Fonction d'exploitation : EXECUTE retiré au rôle applicatif par post-roles.sql.
CREATE FUNCTION verify_audit_chain(p_chain uuid, p_since timestamptz DEFAULT '-infinity')
RETURNS TABLE (seq bigint, problem text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE l audit_log%ROWTYPE; s audit_seal%ROWTYPE; expected_seq bigint; expected_prev bytea; ph bytea; rh bytea; n int;
BEGIN
  -- Point de départ : la ligne qui précède la période vérifiée (sinon la genèse).
  SELECT x.seq, x.row_hash INTO expected_seq, expected_prev FROM audit_log x
   WHERE x.chain_key = p_chain AND x.occurred_at < p_since ORDER BY x.seq DESC LIMIT 1;
  expected_seq := coalesce(expected_seq, 0) + 1;
  expected_prev := coalesce(expected_prev, audit_chain_genesis(p_chain));
  FOR l IN SELECT * FROM audit_log x WHERE x.chain_key = p_chain AND x.seq >= expected_seq ORDER BY x.seq LOOP
    IF l.seq <> expected_seq THEN
      seq := expected_seq; problem := format('lignes manquantes : %s à %s', expected_seq, l.seq - 1); RETURN NEXT;
    END IF;
    IF l.prev_hash <> expected_prev THEN
      seq := l.seq; problem := 'chaînage rompu (prev_hash)'; RETURN NEXT;
    END IF;
    IF l.row_hash <> sha256(l.prev_hash || convert_to(audit_row_canonical(l), 'UTF8')) THEN
      seq := l.seq; problem := 'ligne modifiée (row_hash)'; RETURN NEXT;
    END IF;
    expected_seq := l.seq + 1;
    expected_prev := l.row_hash;
  END LOOP;
  ph := audit_chain_genesis(p_chain);
  FOR s IN SELECT * FROM audit_seal x WHERE x.chain_key = p_chain ORDER BY x.seal_no LOOP
    rh := audit_rows_sha256(p_chain, s.first_seq, s.last_seq);
    SELECT count(*) INTO n FROM audit_log x WHERE x.chain_key = p_chain AND x.seq BETWEEN s.first_seq AND s.last_seq;
    IF s.prev_seal_hash <> ph THEN
      seq := s.first_seq; problem := format('scellement %s : chaînage rompu', s.seal_no); RETURN NEXT;
    END IF;
    IF rh <> s.rows_sha256 OR n <> s.rows THEN
      seq := s.first_seq; problem := format('scellement %s : lignes scellées modifiées', s.seal_no); RETURN NEXT;
    END IF;
    IF s.seal_hash <> sha256(s.prev_seal_hash || uuid_send(p_chain) || int8send(s.first_seq) || int8send(s.last_seq) || s.rows_sha256) THEN
      seq := s.first_seq; problem := format('scellement %s : empreinte falsifiée', s.seal_no); RETURN NEXT;
    END IF;
    ph := s.seal_hash;
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION audit_rows_sha256(uuid, bigint, bigint), seal_audit(uuid, interval),
  verify_audit_chain(uuid, timestamptz) FROM PUBLIC;
