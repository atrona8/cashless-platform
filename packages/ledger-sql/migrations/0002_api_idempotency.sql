-- Migration 0002 : registre d'idempotence de l'API (SPECIFICATION §14.2, S21 ; data-model `api_idempotency`).
-- Contenu minimal : clé, portée, empreinte, statut, réponse rejouée, expiration. RLS activée et forcée, comme les
-- tables du schéma de référence ; aucun DELETE pour cashless_app (roles.sql, rejoué après la série).

CREATE TABLE api_idempotency (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id      uuid NOT NULL REFERENCES party(id),
  scope            text NOT NULL,
  idempotency_key  text NOT NULL,
  request_hash     text NOT NULL,
  status           text NOT NULL,
  lease_until      timestamptz,
  response_status  smallint,
  response_body    jsonb,
  response_headers jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  completed_at     timestamptz,
  expires_at       timestamptz NOT NULL,
  CONSTRAINT api_idempotency_uniq UNIQUE (operator_id, scope, idempotency_key),
  CONSTRAINT api_idempotency_key_len CHECK (length(idempotency_key) BETWEEN 1 AND 255),
  CONSTRAINT api_idempotency_scope_nonempty CHECK (length(scope) > 0),
  CONSTRAINT api_idempotency_hash_hex CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT api_idempotency_status CHECK (status IN ('IN_PROGRESS','COMPLETED')),
  CONSTRAINT api_idempotency_in_progress CHECK (status <> 'IN_PROGRESS' OR lease_until IS NOT NULL),
  -- IS NOT NULL explicite : un CHECK laisse passer NULL, et « NULL BETWEEN 200 AND 599 » vaut NULL.
  CONSTRAINT api_idempotency_completed CHECK (status <> 'COMPLETED'
    OR (response_status IS NOT NULL AND response_status BETWEEN 200 AND 599 AND completed_at IS NOT NULL)),
  CONSTRAINT api_idempotency_expiry CHECK (expires_at > created_at)
);

-- Purge future des entrées expirées
CREATE INDEX api_idempotency_expires_at_idx ON api_idempotency (expires_at);

-- Garde : l'identité de la requête est immuable et COMPLETED ne revient pas à IN_PROGRESS.
-- (IN_PROGRESS → IN_PROGRESS reste permis : reprise d'un bail expiré.)
CREATE FUNCTION api_idempotency_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
  IF NEW.operator_id IS DISTINCT FROM OLD.operator_id OR NEW.scope IS DISTINCT FROM OLD.scope
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key OR NEW.request_hash IS DISTINCT FROM OLD.request_hash
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Idempotence : identité de la requête immuable' USING ERRCODE = 'CL001';
  END IF;
  IF OLD.status = 'COMPLETED' AND NEW.status = 'IN_PROGRESS' THEN
    RAISE EXCEPTION 'Idempotence : retour à IN_PROGRESS interdit' USING ERRCODE = 'CL001';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION api_idempotency_guard() FROM PUBLIC;

CREATE TRIGGER api_idempotency_guard BEFORE UPDATE ON api_idempotency
  FOR EACH ROW EXECUTE FUNCTION api_idempotency_guard();

ALTER TABLE api_idempotency ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_idempotency FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON api_idempotency
  USING (operator_id = current_setting('app.operator_id', true)::uuid)
  WITH CHECK (operator_id = current_setting('app.operator_id', true)::uuid);
