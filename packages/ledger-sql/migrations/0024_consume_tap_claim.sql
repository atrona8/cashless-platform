-- Migration 0024 : une lecture qui a confirmé une demande de rattachement ne sert plus à une
-- écriture (OP-N50, ADR-90, ADR-101 ; mission 5a, identite-enrolement-terminaux, lot WP05 ;
-- décision du porteur du 19/10/2026 : levée en 5a).
--
-- Avant : `consume_tap` (schéma de référence) ignorait `media_claim.confirmed_tap_id` (migration
-- 0016) ; une lecture liée à une demande confirmée servait encore à une écriture pendant la
-- fenêtre.
--
-- Choix (T021) : garde ajoutée à `consume_tap` par `CREATE OR REPLACE` (option b). L'option a (la
-- demande marque la lecture comme le fait une écriture) ne suffit pas : la seule marque de
-- consommation de `media_tap` est `transaction_id`, l'identifiant d'une écriture ; y écrire pour
-- une demande fausserait `register_tap` (une lecture « utilisée » devient copie suspectée hors de
-- la fenêtre de renvoi), et `consume_tap_for_claim` (SECURITY INVOKER) n'a pas le droit d'écrire
-- `media_tap` : il faudrait l'élargir.
--
-- Concurrence : les deux fonctions prennent le même verrou consultatif de transaction par lecture
-- avant de la lire. Sans lui, deux transactions concurrentes (une écriture, une demande) voyaient
-- chacune la lecture libre et la consommaient toutes deux (lecture non engagée de l'autre). En
-- READ COMMITTED, la seconde attend la fin de la première, puis relit l'état engagé et refuse.
-- `consume_tap_for_claim` reste SECURITY INVOKER, corps inchangé hors le verrou (droits conservés).
--
-- `consume_tap` : SECURITY DEFINER, `search_path = public, pg_temp` (OP-N59 : un `CREATE OR
-- REPLACE` efface le réglage posé par 0021). Le corps est celui du schéma de référence, plus le
-- verrou et la garde. RLS : `media_claim` a FORCE ROW LEVEL SECURITY ; la garde vient après
-- `assert_tenant`, donc `app.operator_id` est celui de la lecture, et la demande qui l'a confirmée
-- est du même prestataire (`consume_tap_for_claim` l'exige).

CREATE OR REPLACE FUNCTION consume_tap(p_tap bigint, p_tx uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE t media_tap%ROWTYPE; win int; tx journal_transaction%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('media-tap-use:' || p_tap::text, 0));
  SELECT * INTO t FROM media_tap WHERE id = p_tap FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  PERFORM assert_tenant(t.operator_id);
  SELECT * INTO tx FROM journal_transaction WHERE id = p_tx;
  IF NOT FOUND OR tx.operator_id <> t.operator_id THEN
    RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found';
  END IF;
  IF tx.media_id IS NOT NULL AND tx.media_id <> t.media_id THEN
    RAISE EXCEPTION 'Le passage % ne concerne pas le bracelet de l''écriture', p_tap USING ERRCODE = 'CL001';
  END IF;
  IF t.transaction_id = p_tx THEN RETURN; END IF;                    -- rejeu de la même écriture
  IF t.transaction_id IS NOT NULL THEN
    RAISE EXCEPTION 'Passage % déjà utilisé par une autre écriture', p_tap USING ERRCODE = 'CL022';
  END IF;
  -- OP-N50 : une lecture qui a confirmé une demande de rattachement est déjà consommée.
  IF EXISTS (SELECT 1 FROM media_claim WHERE confirmed_tap_id = p_tap) THEN
    RAISE EXCEPTION 'Passage % déjà utilisé par une demande de rattachement', p_tap
      USING ERRCODE = 'CL022';
  END IF;
  -- Une écriture EN LIGNE doit suivre son passage de moins de tap_replay_window_seconds (120 s par
  -- défaut) ; une opération de lot hors ligne consomme son passage quel que soit le délai.
  IF tx.source = 'ONLINE' THEN
    SELECT coalesce((SELECT e.tap_replay_window_seconds FROM device d JOIN event e ON e.id = d.event_id
                      WHERE d.id = t.device_id), 120)
      INTO win;
    IF t.received_at < clock_timestamp() - make_interval(secs => greatest(win, 1)) THEN
      RAISE EXCEPTION 'Passage % expiré', p_tap USING ERRCODE = 'CL022';
    END IF;
  END IF;
  UPDATE media_tap SET transaction_id = p_tx WHERE id = p_tap;
END $$;

CREATE OR REPLACE FUNCTION consume_tap_for_claim(p_tap bigint, p_claim uuid) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE v_operator uuid := claim_session_operator();
        t_media uuid; t_tx uuid; t_received timestamptz; t_device uuid; c_media uuid; c_status text;
        c_tap bigint; win int;
BEGIN
  SELECT media_id, status, confirmed_tap_id INTO c_media, c_status, c_tap
    FROM media_claim WHERE id = p_claim AND operator_id = v_operator FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  -- Même verrou que `consume_tap` (migration 0024), pris avant de lire la lecture.
  PERFORM pg_advisory_xact_lock(hashtextextended('media-tap-use:' || p_tap::text, 0));
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
  SELECT coalesce((SELECT e.tap_replay_window_seconds FROM device d JOIN event e ON e.id = d.event_id
                    WHERE d.id = t_device), 120)
    INTO win;
  IF t_received < clock_timestamp() - make_interval(secs => greatest(win, 1)) THEN
    RAISE EXCEPTION 'Lecture % expirée', p_tap USING ERRCODE = 'CL022';
  END IF;
  UPDATE media_claim SET confirmed_tap_id = p_tap WHERE id = p_claim;
END $$;
