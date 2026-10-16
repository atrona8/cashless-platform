-- Migration 0014 — prise d'un travail de clé limitée à des prestataires donnés (mission bracelets-nfc, lot 11).
-- `claim_tag_key_job` (0012) prend le plus ancien travail, tous prestataires confondus : c'est ce que fait un
-- processus en service. Cette variante ne prend que les travaux des prestataires nommés : exploitation ciblée
-- (« ne traiter que ce prestataire »), et tests qui partagent une base sans se prendre leurs travaux.
-- Elle RESTREINT la précédente et n'ouvre aucun droit : SECURITY INVOKER, mêmes politiques, même verrou.
CREATE FUNCTION claim_tag_key_job_for(p_operators uuid[], p_kinds text[], p_lock_seconds int DEFAULT 600) RETURNS SETOF tag_key_job
LANGUAGE plpgsql AS $$
DECLARE v_id uuid;
BEGIN
  IF p_operators IS NULL THEN
    RAISE EXCEPTION 'Liste de prestataires manquante' USING ERRCODE = 'CL001';
  END IF;
  IF p_lock_seconds IS NULL OR p_lock_seconds NOT BETWEEN 1 AND 3600 THEN
    RAISE EXCEPTION 'Durée de verrou hors bornes (1 à 3600 s)' USING ERRCODE = 'CL001';
  END IF;
  SELECT j.id INTO v_id FROM tag_key_job j
   WHERE j.kind = ANY (p_kinds) AND j.operator_id = ANY (p_operators)
     AND (j.status = 'PENDING' OR (j.status = 'RUNNING' AND j.locked_until <= clock_timestamp()))
   ORDER BY j.created_at, j.id
   FOR UPDATE SKIP LOCKED LIMIT 1;
  IF v_id IS NULL THEN RETURN; END IF;
  RETURN QUERY
    UPDATE tag_key_job SET status = 'RUNNING', attempts = attempts + 1, last_error = NULL,
           started_at = clock_timestamp(), locked_until = clock_timestamp() + make_interval(secs => p_lock_seconds)
     WHERE id = v_id RETURNING *;
END $$;
