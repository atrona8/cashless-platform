-- Migration 0012 : travaux de clé et comptes rendus du contrôle quotidien (SPECIFICATION §3.2, §7.3, §7.4, §7.7 ;
-- mission bracelets-nfc, data-model « Migration 0012 », research R-04, contracts/key-services.md).
-- Pourquoi une table de travaux : l'API publique n'a aucun droit sur le service de clés. Une action de clé approuvée à
-- deux y inscrit un travail ; le processus qui a le droit l'exécute (commande d'administration : création et
-- désactivation d'une clé du KMS ; personnalisation : nouvelle clé de données, retrait ; clés de bracelet :
-- rechiffrement). Un travail ne porte jamais de secret.
-- Aucun nom de rôle ici : droits et politiques par rôle de base sont posés par post-roles.sql.

-- 1. Travaux de clé ------------------------------------------------------------------------------------------------------
CREATE TABLE tag_key_job (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id         uuid NOT NULL REFERENCES party(id),
  key_index           integer NOT NULL CONSTRAINT tag_key_job_key_index CHECK (key_index BETWEEN 0 AND 65535),
  kind                text NOT NULL
                      CONSTRAINT tag_key_job_kind CHECK (kind IN ('CREATE_KEY','ROTATE_DEK','REENCRYPT','RETIRE_KEY','DISABLE_KMS_KEY')),
  status              text NOT NULL DEFAULT 'PENDING'
                      CONSTRAINT tag_key_job_status CHECK (status IN ('PENDING','RUNNING','DONE','FAILED')),
  payload             jsonb NOT NULL DEFAULT '{}',
  progress            jsonb NOT NULL DEFAULT '{}',
  attempts            int NOT NULL DEFAULT 0 CONSTRAINT tag_key_job_attempts CHECK (attempts >= 0),
  last_error          text,
  approval_request_id uuid REFERENCES approval_request(id),
  parent_job_id       uuid REFERENCES tag_key_job(id),   -- travail qui a créé celui-ci (rotation → rechiffrement…)
  created_at          timestamptz NOT NULL DEFAULT clock_timestamp(),
  started_at          timestamptz,
  locked_until        timestamptz,                        -- un travail RUNNING au-delà de cette date peut être repris
  finished_at         timestamptz,
  -- Garde-fou : aucun champ dont le nom annonce un secret. Un travail décrit quoi faire, il ne transporte rien.
  CONSTRAINT tag_key_job_no_secret CHECK (
    NOT (payload ?| ARRAY['plaintext','dek','data_key','pwd','pack','pwd_pack','secret','private_key','password'])
    AND NOT (progress ?| ARRAY['plaintext','dek','data_key','pwd','pack','pwd_pack','secret','private_key','password'])),
  CONSTRAINT tag_key_job_objects CHECK (jsonb_typeof(payload) = 'object' AND jsonb_typeof(progress) = 'object'),
  CONSTRAINT tag_key_job_finished CHECK ((status = 'DONE') = (finished_at IS NOT NULL)),
  CONSTRAINT tag_key_job_running CHECK (status <> 'RUNNING' OR (started_at IS NOT NULL AND locked_until IS NOT NULL))
);
-- Un seul travail non terminé par (prestataire, index, sorte) : une seconde demande attend la fin de la première.
CREATE UNIQUE INDEX tag_key_job_one_open ON tag_key_job (operator_id, key_index, kind) WHERE status <> 'DONE';
CREATE INDEX tag_key_job_queue_idx ON tag_key_job (kind, created_at) WHERE status IN ('PENDING','RUNNING');

-- 2. Comptes rendus du contrôle quotidien (§7.4) --------------------------------------------------------------------------
CREATE TABLE tag_key_check_run (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id uuid NOT NULL REFERENCES party(id),
  started_at  timestamptz NOT NULL DEFAULT clock_timestamp(),
  finished_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  sampled     int NOT NULL CONSTRAINT tag_key_check_run_sampled CHECK (sampled BETWEEN 0 AND 100),
  mismatches  int NOT NULL CONSTRAINT tag_key_check_run_mismatches CHECK (mismatches >= 0),
  status      text NOT NULL CONSTRAINT tag_key_check_run_status CHECK (status IN ('OK','MISMATCH','ERROR')),
  detail      text,                                       -- message court ; jamais de secret ni d'identité de bracelet
  CONSTRAINT tag_key_check_run_consistent CHECK (mismatches <= sampled AND (status = 'MISMATCH') = (mismatches > 0))
);
CREATE INDEX tag_key_check_run_operator_idx ON tag_key_check_run (operator_id, started_at DESC);
CREATE TRIGGER tag_key_check_run_immutable BEFORE UPDATE OR DELETE ON tag_key_check_run
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tag_key_job','tag_key_check_run'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
                     USING (operator_id = current_setting('app.operator_id', true)::uuid)$p$, t);
  END LOOP;
END $$;

-- 3. File d'attente ---------------------------------------------------------------------------------------------------------
-- Prend le plus ancien travail en attente parmi les sortes données, ou un travail RUNNING dont le délai est passé
-- (processus mort en cours de route). SKIP LOCKED : deux processus ne prennent jamais le même travail.
-- SECURITY INVOKER : un processus ne prend que les travaux que ses politiques lui montrent.
CREATE FUNCTION claim_tag_key_job(p_kinds text[], p_lock_seconds int DEFAULT 600) RETURNS SETOF tag_key_job
LANGUAGE plpgsql AS $$
DECLARE v_id uuid;
BEGIN
  IF p_lock_seconds IS NULL OR p_lock_seconds NOT BETWEEN 1 AND 3600 THEN
    RAISE EXCEPTION 'Durée de verrou hors bornes (1 à 3600 s)' USING ERRCODE = 'CL001';
  END IF;
  SELECT j.id INTO v_id FROM tag_key_job j
   WHERE j.kind = ANY (p_kinds)
     AND (j.status = 'PENDING' OR (j.status = 'RUNNING' AND j.locked_until <= clock_timestamp()))
   ORDER BY j.created_at, j.id
   FOR UPDATE SKIP LOCKED LIMIT 1;
  IF v_id IS NULL THEN RETURN; END IF;
  RETURN QUERY
    UPDATE tag_key_job SET status = 'RUNNING', attempts = attempts + 1, last_error = NULL,
           started_at = clock_timestamp(), locked_until = clock_timestamp() + make_interval(secs => p_lock_seconds)
     WHERE id = v_id RETURNING *;
END $$;

-- Clôt un travail pris (DONE ou FAILED), ou en enregistre l'avancement sans le clore (statut RUNNING : le verrou est
-- prolongé). Seul un travail RUNNING se clôt.
CREATE FUNCTION finish_tag_key_job(p_job uuid, p_status text, p_error text DEFAULT NULL, p_progress jsonb DEFAULT NULL,
                                   p_lock_seconds int DEFAULT 600) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF p_status NOT IN ('RUNNING','DONE','FAILED') THEN
    RAISE EXCEPTION 'Statut de clôture invalide' USING ERRCODE = 'CL001';
  END IF;
  UPDATE tag_key_job
     SET status = p_status,
         last_error = CASE WHEN p_status = 'FAILED' THEN left(coalesce(p_error, 'échec'), 500) END,
         progress = coalesce(p_progress, progress),
         finished_at = CASE WHEN p_status = 'DONE' THEN clock_timestamp() END,
         locked_until = CASE WHEN p_status = 'RUNNING' THEN clock_timestamp() + make_interval(secs => p_lock_seconds) END
   WHERE id = p_job AND status = 'RUNNING';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Travail introuvable ou non pris' USING ERRCODE = 'CL020';
  END IF;
END $$;

-- Relance un travail en échec (FAILED → PENDING).
CREATE FUNCTION retry_tag_key_job(p_job uuid) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE tag_key_job SET status = 'PENDING', locked_until = NULL WHERE id = p_job AND status = 'FAILED';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Travail introuvable ou non en échec' USING ERRCODE = 'CL020';
  END IF;
END $$;
