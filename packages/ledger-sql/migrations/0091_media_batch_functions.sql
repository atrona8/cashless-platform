-- 0091 : écritures des lots de bracelets et du statut d'un bracelet par fonctions SECURITY DEFINER
-- étroites (OP-N60, partie base ; mission 11a, WP01). Cette migration n'accorde ni ne retire aucun
-- droit (WP03 reprend post-roles.sql) ; seuls les REVOKE ... FROM PUBLIC des fonctions nouvelles.
-- Le propriétaire ignore la RLS : chaque lecture ou écriture nomme le prestataire de session.
-- Code d'erreur nouveau : CL056 (modification de lot hors liste blanche).

-- 1. create_media_batch -----------------------------------------------------------------------------
-- Aucun paramètre de statut : le défaut ORDERED s'applique, un lot ACTIVE ou CLOSED est inexprimable.
-- Les CHECK, check_batch_key et les déclencheurs de media_batch restent juges des valeurs : leurs
-- SQLSTATE sortent inchangés. Auteur de la ligne d'historique -> ORDERED : p_actor (media_set_actor).
CREATE FUNCTION create_media_batch(p_organizer uuid, p_event uuid, p_kind text, p_quantity int,
                                   p_key_index int, p_print_order_ref text,
                                   p_preload_promo_amount bigint, p_deposit_amount bigint,
                                   p_deposit_mode text, p_key_mode text, p_reuse_policy text,
                                   p_actor uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_operator uuid := media_session_operator(); v_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM party WHERE id = p_organizer AND kind = 'ORGANIZER'
                    AND operator_id = v_operator) THEN
    RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found';
  END IF;
  IF p_event IS NOT NULL AND NOT EXISTS (SELECT 1 FROM event WHERE id = p_event
                    AND operator_id = v_operator AND organizer_id = p_organizer) THEN
    RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found';
  END IF;
  PERFORM media_set_actor(p_actor, 'Création du lot');
  INSERT INTO media_batch (operator_id, organizer_id, event_id, kind, quantity, key_index,
                           print_order_ref, preload_promo_amount, deposit_amount, deposit_mode,
                           key_mode, reuse_policy)
  VALUES (v_operator, p_organizer, p_event, p_kind, p_quantity, p_key_index, p_print_order_ref,
          p_preload_promo_amount, p_deposit_amount, p_deposit_mode, p_key_mode, p_reuse_policy)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION create_media_batch(uuid, uuid, text, int, int, text, bigint, bigint, text,
                                          text, text, uuid) FROM PUBLIC;

-- 2. update_media_batch -----------------------------------------------------------------------------
-- Liste blanche exacte ; clé présente avec null JSON = NULL en base ; clé absente = inchangée.
CREATE FUNCTION update_media_batch(p_batch uuid, p_changes jsonb, p_actor uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_operator uuid := media_session_operator();
  v_allowed text[] := ARRAY['quantity','print_order_ref','preload_promo_amount','deposit_amount',
                            'deposit_mode','reuse_policy'];
  v_key text;
  b media_batch%ROWTYPE;
BEGIN
  IF p_changes IS NULL OR jsonb_typeof(p_changes) <> 'object' OR p_changes = '{}'::jsonb THEN
    RAISE EXCEPTION 'Modification de lot : objet de changements attendu' USING ERRCODE = 'CL056';
  END IF;
  FOR v_key IN SELECT jsonb_object_keys(p_changes) LOOP
    IF NOT (v_key = ANY (v_allowed)) THEN
      RAISE EXCEPTION 'Modification de lot : champ non modifiable (%)', v_key
        USING ERRCODE = 'CL056';
    END IF;
  END LOOP;
  SELECT * INTO b FROM media_batch WHERE id = p_batch AND operator_id = v_operator FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  IF b.status <> 'ORDERED' THEN
    RAISE EXCEPTION 'BATCH_NOT_ORDERED : le lot n''est plus modifiable' USING ERRCODE = 'CL020';
  END IF;
  IF p_changes ? 'quantity' AND b.claim_codes_issued_at IS NOT NULL THEN
    RAISE EXCEPTION 'CLAIM_CODES_ALREADY_ISSUED : la quantité ne change plus après les codes'
      USING ERRCODE = 'CL020';
  END IF;
  PERFORM media_set_actor(p_actor, 'Modification du lot');
  UPDATE media_batch SET
    quantity = CASE WHEN p_changes ? 'quantity' THEN (p_changes->>'quantity')::int
                    ELSE quantity END,
    print_order_ref = CASE WHEN p_changes ? 'print_order_ref' THEN p_changes->>'print_order_ref'
                           ELSE print_order_ref END,
    preload_promo_amount = CASE WHEN p_changes ? 'preload_promo_amount'
                                THEN (p_changes->>'preload_promo_amount')::bigint
                                ELSE preload_promo_amount END,
    deposit_amount = CASE WHEN p_changes ? 'deposit_amount'
                          THEN (p_changes->>'deposit_amount')::bigint ELSE deposit_amount END,
    deposit_mode = CASE WHEN p_changes ? 'deposit_mode' THEN p_changes->>'deposit_mode'
                        ELSE deposit_mode END,
    reuse_policy = CASE WHEN p_changes ? 'reuse_policy' THEN p_changes->>'reuse_policy'
                        ELSE reuse_policy END
   WHERE id = p_batch AND operator_id = v_operator;
END $$;
REVOKE ALL ON FUNCTION update_media_batch(uuid, jsonb, uuid) FROM PUBLIC;

-- 3. Fonctions existantes passées en DEFINER ---------------------------------------------------------
-- Corps inchangés : leurs lectures filtrent déjà par media_session_operator() / claim_session_operator().
ALTER FUNCTION set_media_batch_status(uuid, text, text, uuid)
  SECURITY DEFINER SET search_path = public, pg_temp;
ALTER FUNCTION issue_claim_codes(uuid, bytea[])
  SECURITY DEFINER SET search_path = public, pg_temp;

-- media_set_status : corps de 0013 + limite de destination (SUSPENDED, BLACKLISTED). La sortie de
-- liste noire passe par reinstate_media ; RETIRED, DESTROYED et ACTIVE ne passent pas ici.
CREATE OR REPLACE FUNCTION media_set_status(p_media uuid, p_to text, p_reason text, p_actor uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_operator uuid := media_session_operator(); m_status text;
BEGIN
  IF p_to IS NULL OR p_to NOT IN ('SUSPENDED', 'BLACKLISTED') THEN
    RAISE EXCEPTION 'Statut de bracelet non permis par cette fonction : %', p_to
      USING ERRCODE = 'CL020';
  END IF;
  SELECT status INTO m_status FROM media WHERE id = p_media AND operator_id = v_operator FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  IF coalesce(btrim(p_reason), '') = '' THEN
    RAISE EXCEPTION 'Motif obligatoire' USING ERRCODE = 'CL001';
  END IF;
  IF p_to = m_status THEN RETURN m_status; END IF;
  PERFORM media_set_actor(p_actor, p_reason);
  UPDATE media SET status = p_to WHERE id = p_media;
  RETURN p_to;
END $$;
