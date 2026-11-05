-- 0050 : annulation d'un import de journal resté PENDING (mission hors-ligne-snapshots-lots, WP20, cycle 2 ;
-- décision du porteur du 03/11/2026 ; relecture de WP20, constat « import bloqué en PENDING »).
--
-- Problème : create_device_journal_import laisse l'import à PENDING jusqu'à l'approbation de la demande à deux
-- personnes. Si la demande est REJETÉE ou ÉCHUE, l'import restait PENDING pour toujours et l'index d'unicité
-- device_journal_import_active (un import PENDING|PROCESSING par terminal) interdisait toute nouvelle demande.
--
-- cancel_device_journal_import(p_import, p_actor, p_reason) RETURNS void
--   - p_reason : 'REJECTED' (demande rejetée), 'EXPIRED' (demande échue) ou 'FAILED' (demande approuvée dont
--     l'exécution a échoué avant begin_device_journal_import : le point de sauvegarde annule begin_ et l'import
--     resterait PENDING lui aussi), rien d'autre (CL001) ; p_actor non nul
--     (CL001) ; la base ne contrôle PAS p_actor (note de WP05) : l'API le renseigne, il est consigné dans le
--     résultat ;
--   - prestataire : assert_tenant sur le prestataire de l'import (comme les autres fonctions d'import) ;
--   - la demande d'approbation DEVICE_JOURNAL_IMPORT de cet import doit être réellement fermée (REJECTED, EXPIRED,
--     FAILED ou PENDING échue) : sinon CL001 ; on ne peut donc pas annuler un import dont la demande est encore valable ;
--   - import PENDING -> REJECTED (statut prévu pour ce passage par le garde de 0046 ; PENDING -> FAILED est interdit
--     par ce garde et par la contrainte device_journal_import_approved, qui exige un approbateur). `result` porte
--     le motif et l'acteur ; applied_at reste NULL (contrainte device_journal_import_final). L'index d'unicité est
--     libéré (il ne couvre que PENDING|PROCESSING) ;
--   - idempotente : un import déjà REJECTED est laissé tel quel, sans erreur ;
--   - PROCESSING, APPLIED ou FAILED : CL053 (rien n'est modifié).
-- Ordre des verrous comme begin_device_journal_import : terminal d'abord, puis import.
-- Droits : REVOKE ALL FROM PUBLIC ici ; EXECUTE à cashless_app seul (post-roles.sql 8d).
CREATE FUNCTION cancel_device_journal_import(p_import uuid, p_actor uuid, p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_dev uuid; v_op uuid; i device_journal_import%ROWTYPE;
BEGIN
  SELECT device_id, operator_id INTO v_dev, v_op FROM device_journal_import WHERE id = p_import;
  PERFORM assert_tenant(v_op);
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'Annulation d''import : acteur obligatoire' USING ERRCODE = 'CL001';
  END IF;
  IF p_reason IS NULL OR p_reason NOT IN ('REJECTED','EXPIRED','FAILED') THEN
    RAISE EXCEPTION 'Annulation d''import : motif REJECTED, EXPIRED ou FAILED, pas %', p_reason USING ERRCODE = 'CL001';
  END IF;
  PERFORM 1 FROM device WHERE id = v_dev FOR UPDATE;                      -- terminal d'abord
  SELECT * INTO i FROM device_journal_import WHERE id = p_import FOR UPDATE;
  IF i.status = 'REJECTED' THEN
    RETURN;                                                                -- idempotent
  END IF;
  IF i.status <> 'PENDING' THEN
    RAISE EXCEPTION 'Import % en état % : annulation refusée', p_import, i.status USING ERRCODE = 'CL053';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM approval_request r
                  WHERE r.action = 'DEVICE_JOURNAL_IMPORT' AND r.target_id = p_import
                    AND r.operator_id = i.operator_id
                    AND (r.status IN ('REJECTED','EXPIRED','FAILED')
                         OR (r.status = 'PENDING' AND r.expires_at < clock_timestamp()))) THEN
    RAISE EXCEPTION 'Import % : sa demande d''approbation est encore valable', p_import USING ERRCODE = 'CL001';
  END IF;
  UPDATE device_journal_import
     SET status = 'REJECTED',
         result = jsonb_build_object('device_id', i.device_id, 'status', 'REJECTED', 'results', '[]'::jsonb,
                                     'reason', p_reason, 'cancelled_by', p_actor)
   WHERE id = p_import;
END $$;
REVOKE ALL ON FUNCTION cancel_device_journal_import(uuid, uuid, text) FROM PUBLIC;
