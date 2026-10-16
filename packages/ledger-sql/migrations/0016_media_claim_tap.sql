-- Migration 0016 : lecture du bracelet consommée par la confirmation d'une demande de rattachement (mission
-- bracelets-nfc, lot 17 ; décision du porteur du 14/10/2026). `consume_tap` relie une lecture à une écriture
-- comptable ; un rattachement n'en fait aucune (ADR-57 : sans mouvement d'argent). La lecture présentée au guichet est
-- donc consommée par la demande confirmée : une lecture ne confirme qu'une demande, jamais une lecture déjà consommée
-- par une écriture, toujours une lecture récente (fenêtre de l'événement, comme `consume_tap`) du bracelet de la demande.
-- Limite connue : `consume_tap` (schéma de référence) ignore cette colonne ; une lecture qui a confirmé une demande peut
-- encore servir à une écriture pendant la fenêtre.
-- SECURITY INVOKER : RLS et droits du rôle appelant. Le rôle de l'API ne modifie pas `media_tap` : la demande est
-- verrouillée, et l'index unique empêche deux demandes de partager une lecture.

ALTER TABLE media_claim ADD COLUMN confirmed_tap_id bigint REFERENCES media_tap(id);
CREATE UNIQUE INDEX media_claim_confirmed_tap_key ON media_claim (confirmed_tap_id) WHERE confirmed_tap_id IS NOT NULL;

CREATE FUNCTION consume_tap_for_claim(p_tap bigint, p_claim uuid) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE v_operator uuid := claim_session_operator();
        t_media uuid; t_tx uuid; t_received timestamptz; t_device uuid; c_media uuid; c_status text; c_tap bigint; win int;
BEGIN
  SELECT media_id, status, confirmed_tap_id INTO c_media, c_status, c_tap
    FROM media_claim WHERE id = p_claim AND operator_id = v_operator FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  SELECT media_id, transaction_id, received_at, device_id INTO t_media, t_tx, t_received, t_device
    FROM media_tap WHERE id = p_tap AND operator_id = v_operator;
  IF NOT FOUND THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  IF c_tap = p_tap THEN RETURN; END IF;                                   -- rejeu
  IF c_status <> 'CONFIRMED' OR c_tap IS NOT NULL THEN
    RAISE EXCEPTION 'Demande non confirmée, ou déjà liée à une lecture' USING ERRCODE = 'CL020';
  END IF;
  IF t_media IS DISTINCT FROM c_media THEN
    RAISE EXCEPTION 'La lecture % ne concerne pas le bracelet de la demande', p_tap USING ERRCODE = 'CL001';
  END IF;
  IF t_tx IS NOT NULL OR EXISTS (SELECT 1 FROM media_claim WHERE confirmed_tap_id = p_tap) THEN
    RAISE EXCEPTION 'Lecture % déjà utilisée', p_tap USING ERRCODE = 'CL022';
  END IF;
  SELECT coalesce((SELECT e.tap_replay_window_seconds FROM device d JOIN event e ON e.id = d.event_id WHERE d.id = t_device), 120)
    INTO win;
  IF t_received < clock_timestamp() - make_interval(secs => greatest(win, 1)) THEN
    RAISE EXCEPTION 'Lecture % expirée', p_tap USING ERRCODE = 'CL022';
  END IF;
  UPDATE media_claim SET confirmed_tap_id = p_tap WHERE id = p_claim;
END $$;
