-- Migration 0026 : la lecture d'une demande de rattachement ne s'écrit plus que par
-- `consume_tap_for_claim` (mission 5a, identite-enrolement-terminaux, lot WP07 ; relecture de WP05
-- du 20/10/2026 ; OP-N50, ADR-90, ADR-101).
--
-- Avant : défaut antérieur à la mission (0016). `post-roles.sql` accordait à `cashless_app`
-- UPDATE (confirmed_tap_id) sur `media_claim` : une session de l'API liait directement une lecture
-- à une demande confirmée, sans `consume_tap_for_claim`, donc sans le verrou `media-tap-use:`, sans
-- la fenêtre de renvoi et sans le contrôle « lecture déjà utilisée ». Une lecture déjà consommée
-- par une écriture pouvait encore être liée à une demande.
--
-- Après :
--   1. `consume_tap_for_claim` : SECURITY DEFINER, `search_path = public, pg_temp` (OP-N59),
--   EXECUTE
--      retiré à PUBLIC (accordé à `cashless_app` par `post-roles.sql`). Corps de 0024 à
--      l'identique : chaque lecture nomme le prestataire de la session (claim_session_operator,
--      qui refuse une session sans prestataire), elle ne s'appuie pas sur la RLS. `post-roles.sql`
--      retire à `cashless_app` UPDATE (confirmed_tap_id), que cette fonction écrit seule.
--   2. `consume_tap` : corps de 0024, plus le prestataire de la lecture dans la garde OP-N50
--      (défense en profondeur) : une demande d'un autre prestataire ne compte pas, la fonction
--      ignorant la RLS sous un propriétaire qui l'ignore (hypothèse de 0019, 0020, 0022).

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
  IF EXISTS (SELECT 1 FROM media_claim WHERE confirmed_tap_id = p_tap AND operator_id = t.operator_id) THEN
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
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
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
REVOKE ALL ON FUNCTION consume_tap_for_claim(bigint, uuid) FROM PUBLIC;
