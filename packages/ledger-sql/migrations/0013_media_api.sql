-- Migration 0013 : fonctions d'appui de l'API des bracelets (SPECIFICATION §7.5, §7.7, §7.8 ; mission bracelets-nfc,
-- data-model « Migration 0013 »).
-- Ces fonctions n'ajoutent aucune règle métier : les passages de statut, la cohérence de la clé d'un lot et les traces
-- d'historique sont déjà tenus par les déclencheurs du schéma de référence (check_media_transition,
-- check_media_batch_key, check_batch_transition, log_media_status, log_batch_status). Elles regroupent les écritures
-- que fait l'API, pour que chaque rôle de base n'ait besoin que du droit d'exécuter la fonction qui le concerne, et
-- elles posent l'auteur et le motif que les déclencheurs d'historique lisent dans la session (app.user_id, app.reason).
-- SECURITY INVOKER partout : la RLS et les droits du rôle appelant s'appliquent. Aucune ne lit ni ne rend une colonne
-- secrète (`pwd_pack_enc`, `pwd_pack_dek_id`) ni l'empreinte de l'identité (`token_hash`).
-- Erreurs : CL020 (état qui ne permet pas l'action), CL001 (paramètre manquant). Un objet d'un autre prestataire
-- répond « introuvable ».

-- Prestataire de la session (même règle que claim_session_operator, migration 0010).
CREATE FUNCTION media_session_operator() RETURNS uuid LANGUAGE plpgsql STABLE AS $$
DECLARE v uuid := nullif(current_setting('app.operator_id', true), '')::uuid;
BEGIN
  IF v IS NULL THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  RETURN v;
END $$;

-- Auteur et motif lus par les déclencheurs d'historique (portée : la transaction).
CREATE FUNCTION media_set_actor(p_actor uuid, p_reason text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_actor IS NULL THEN RAISE EXCEPTION 'Auteur obligatoire' USING ERRCODE = 'CL001'; END IF;
  PERFORM set_config('app.user_id', p_actor::text, true);
  PERFORM set_config('app.reason', coalesce(p_reason, ''), true);
END $$;

-- 1. Enregistrement d'un bracelet personnalisé (§7.5, étape 4) ----------------------------------------------------------
-- L'identifiant du bracelet est fourni par l'appelant : il entre dans l'AAD du mot de passe chiffré, calculé avant
-- l'insertion. Refus : signature d'originalité invalide, lot qui n'est plus en préparation, quantité du lot atteinte,
-- clé du lot non active, clé de données qui n'est pas la version active de cet index. Un UID ou une identité déjà
-- connus lèvent une violation d'unicité (23505), que l'API traduit en conflit.
CREATE FUNCTION register_personalized_media(p_batch uuid, p_media_id uuid, p_token_hash bytea, p_uid bytea,
                                            p_sig_sha256 bytea, p_signature_ok boolean, p_pwd_pack_enc bytea, p_dek uuid,
                                            p_actor uuid)
RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE v_operator uuid := media_session_operator(); b_status text; b_quantity int; b_key_index int; v_count int;
BEGIN
  IF p_media_id IS NULL OR p_token_hash IS NULL OR octet_length(p_token_hash) <> 32 OR p_uid IS NULL OR octet_length(p_uid) <> 7
     OR p_sig_sha256 IS NULL OR p_pwd_pack_enc IS NULL OR p_dek IS NULL THEN
    RAISE EXCEPTION 'Bracelet personnalisé : identifiant, empreinte (32 o), UID (7 o), signature, chiffré et clé de données attendus'
      USING ERRCODE = 'CL001';
  END IF;
  -- Verrou du lot : deux postes ne dépassent pas ensemble la quantité commandée. Verrou consultatif et non verrou de
  -- ligne : le rôle de la personnalisation n'a aucun droit d'écriture sur media_batch, et n'en a pas besoin.
  PERFORM pg_advisory_xact_lock(hashtextextended('media-batch-registration:' || p_batch::text, 0));
  SELECT status, quantity, key_index INTO b_status, b_quantity, b_key_index
    FROM media_batch WHERE id = p_batch AND operator_id = v_operator;
  IF NOT FOUND THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  IF p_signature_ok IS NOT TRUE THEN
    RAISE EXCEPTION 'MEDIA_SIGNATURE_INVALID : signature d''originalité invalide, puce refusée' USING ERRCODE = 'CL020';
  END IF;
  IF b_status NOT IN ('ORDERED','PERSONALIZED') THEN
    RAISE EXCEPTION 'BATCH_NOT_IN_PREPARATION : le lot n''est plus en préparation (%)', b_status USING ERRCODE = 'CL020';
  END IF;
  SELECT count(*) INTO v_count FROM media WHERE batch_id = p_batch;
  IF v_count >= b_quantity THEN
    RAISE EXCEPTION 'BATCH_QUANTITY_REACHED : les % bracelets du lot sont déjà enregistrés', b_quantity USING ERRCODE = 'CL020';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM tag_key WHERE operator_id = v_operator AND key_index = b_key_index AND status = 'ACTIVE') THEN
    RAISE EXCEPTION 'TAG_KEY_NOT_ACTIVE : la clé du lot n''est pas active' USING ERRCODE = 'CL020';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM tag_data_key WHERE id = p_dek AND operator_id = v_operator AND key_index = b_key_index AND status = 'ACTIVE') THEN
    RAISE EXCEPTION 'TAG_DATA_KEY_NOT_ACTIVE : la clé de données n''est pas la version active de cet index' USING ERRCODE = 'CL020';
  END IF;
  PERFORM media_set_actor(p_actor, 'PERSONALIZATION');
  INSERT INTO media (id, operator_id, kind, token_hash, nfc_uid, key_index, signature_ok, originality_sig_sha256, batch_id,
                     status, personalized_at, pwd_pack_enc, pwd_pack_dek_id)
  VALUES (p_media_id, v_operator, 'NFC_TAG', p_token_hash, p_uid, b_key_index, true, p_sig_sha256, p_batch,
          'PERSONALIZED', clock_timestamp(), p_pwd_pack_enc, p_dek);
  RETURN p_media_id;
END $$;

-- 2. Statut d'un lot (§7.7) ---------------------------------------------------------------------------------------------
-- Les passages permis sont ceux de media_batch_transition (déclencheur). La clôture ne passe pas par ici : close_batch
-- retire les bracelets et acquiert les cautions.
CREATE FUNCTION set_media_batch_status(p_batch uuid, p_to text, p_reason text, p_actor uuid) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE v_operator uuid := media_session_operator(); b_status text;
BEGIN
  SELECT status INTO b_status FROM media_batch WHERE id = p_batch AND operator_id = v_operator FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  IF p_to = 'CLOSED' THEN
    RAISE EXCEPTION 'BATCH_CLOSE_VIA_CLOSURE : un lot se clôt par sa clôture (cautions, retrait des bracelets)' USING ERRCODE = 'CL020';
  END IF;
  IF p_to = 'SUSPENDED' AND coalesce(btrim(p_reason), '') = '' THEN
    RAISE EXCEPTION 'Motif obligatoire pour suspendre un lot' USING ERRCODE = 'CL001';
  END IF;
  IF p_to = b_status THEN RETURN b_status; END IF;
  PERFORM media_set_actor(p_actor, p_reason);
  UPDATE media_batch SET status = p_to WHERE id = p_batch;
  RETURN p_to;
END $$;

-- 3. Blocage manuel et perte déclarée (§7.8) -----------------------------------------------------------------------------
CREATE FUNCTION media_set_status(p_media uuid, p_to text, p_reason text, p_actor uuid) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE v_operator uuid := media_session_operator(); m_status text;
BEGIN
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

-- Mise en liste noire décidée par une personne (fraude suspectée). La sortie passe par reinstate_media, à deux.
CREATE FUNCTION blacklist_media(p_media uuid, p_reason text, p_actor uuid) RETURNS text
LANGUAGE sql AS $$ SELECT media_set_status(p_media, 'BLACKLISTED', p_reason, p_actor) $$;

-- Perte déclarée : le bracelet est suspendu. Retrouvé : recover_media (schéma), selon le réglage de l'événement.
CREATE FUNCTION suspend_media(p_media uuid, p_reason text, p_actor uuid) RETURNS text
LANGUAGE sql AS $$ SELECT media_set_status(p_media, 'SUSPENDED', p_reason, p_actor) $$;

-- 4. Lectures sans colonne secrète ----------------------------------------------------------------------------------------
-- Résumé d'un bracelet : état, lot, caution, portefeuilles rattachés et leur solde disponible. Jamais l'identité, son
-- empreinte, le mot de passe chiffré ni l'empreinte du code de rattachement.
CREATE FUNCTION media_summary(p_media uuid)
RETURNS TABLE (media_id uuid, status text, kind text, key_index integer, personalized_at timestamptz,
               batch_id uuid, batch_kind text, batch_status text, organizer_id uuid, event_id uuid, reuse_policy text,
               deposit_status text, deposit_held bigint, deposit_amount bigint, deposit_mode text,
               has_claim_code boolean, claim_code_used_at timestamptz, wallets jsonb)
LANGUAGE sql STABLE AS $$
  SELECT m.id, m.status, m.kind, m.key_index, m.personalized_at,
         b.id, b.kind, b.status, b.organizer_id, b.event_id, b.reuse_policy,
         m.deposit_status, m.deposit_held, b.deposit_amount, b.deposit_mode,
         m.claim_code_hash IS NOT NULL, m.claim_code_used_at,
         coalesce((SELECT jsonb_agg(jsonb_build_object('wallet_id', ma.wallet_id, 'currency', ma.currency,
                                                       'spendable', wallet_spendable(ma.wallet_id),
                                                       'attached_to_account', w.customer_id IS NOT NULL,
                                                       'wallet_status', w.status) ORDER BY ma.currency)
                     FROM media_assignment ma JOIN wallet w ON w.id = ma.wallet_id
                    WHERE ma.media_id = m.id AND ma.released_at IS NULL), '[]'::jsonb)
    FROM media m LEFT JOIN media_batch b ON b.id = m.batch_id
   WHERE m.id = p_media AND m.operator_id = media_session_operator()
$$;

-- Historique des statuts d'un bracelet (raison, auteur, valideur, date).
CREATE FUNCTION media_status_log(p_media uuid)
RETURNS TABLE (from_status text, to_status text, reason text, actor_id uuid, approved_by uuid, device_id uuid, at timestamptz)
LANGUAGE sql STABLE AS $$
  SELECT h.from_status, h.to_status, h.reason, h.actor_id, h.approved_by, h.device_id, h.at
    FROM media_status_history h
   WHERE h.media_id = p_media AND h.operator_id = media_session_operator()
   ORDER BY h.at, h.id
$$;
