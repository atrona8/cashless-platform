-- Migration 0005 : double validation (SPECIFICATION §6.5 ; mission identite-roles-double-validation, data-model
-- `approval_request.result`, `approval_token_use` ; research R-02, R-09).
-- Droits du rôle applicatif ajustés par post-roles.sql : UPDATE (result) sur approval_request ; INSERT et SELECT
-- seulement sur approval_token_use. Erreurs métier : CL001 (VALIDATION_FAILED).

-- Résultat de l'action exécutée (contradiction openapi.yaml / schéma consignée en R-02) : écrit par l'API au
-- passage APPROVED -> EXECUTED ; approval_request_guard n'est pas modifié (il ne contrôle pas cette colonne).
ALTER TABLE approval_request ADD COLUMN result jsonb;
ALTER TABLE approval_request ADD CONSTRAINT approval_request_result_executed
  CHECK (result IS NULL OR status = 'EXECUTED');

-- Jetons d'approbation sur place déjà consommés : insertion = consommation (ON CONFLICT (jti) DO NOTHING).
CREATE TABLE approval_token_use (
  jti           text PRIMARY KEY CHECK (length(jti) > 0),
  operator_id   uuid NOT NULL REFERENCES party(id),
  operation_id  text NOT NULL CHECK (length(operation_id) > 0),  -- claim `act`
  approver_id   uuid NOT NULL,                                   -- personne du `sub` du jeton
  caller_id     uuid NOT NULL,                                   -- personne qui appelle l'opération
  used_at       timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at    timestamptz NOT NULL,
  CONSTRAINT approval_token_use_distinct_people CHECK (approver_id <> caller_id),
  CONSTRAINT approval_token_use_not_expired CHECK (expires_at > used_at)
);
-- Purge future des lignes expirées (comme S21).
CREATE INDEX approval_token_use_expires_idx ON approval_token_use (expires_at);

-- Ajout seul, pour tout rôle (propriétaire compris).
CREATE FUNCTION approval_token_use_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Utilisations de jetons d''approbation en ajout seul' USING ERRCODE = 'CL001';
END $$;
CREATE TRIGGER approval_token_use_append_only BEFORE UPDATE OR DELETE ON approval_token_use
  FOR EACH ROW EXECUTE FUNCTION approval_token_use_append_only();

ALTER TABLE approval_token_use ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_token_use FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON approval_token_use
  USING (operator_id = current_setting('app.operator_id', true)::uuid)
  WITH CHECK (operator_id = current_setting('app.operator_id', true)::uuid);
