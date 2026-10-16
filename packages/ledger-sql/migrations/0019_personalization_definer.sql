-- Migration 0019 : la personnalisation n'écrit plus `media` que par ses fonctions (mission bracelets-nfc, lot 20,
-- cycle 7 ; relecture du cycle 6, constat 1 ; décision du porteur du 15/10/2026, option B ; ADR-94).
--
-- Avant : `register_personalized_media` et `associate_claim_code` (0013, 0010) s'exécutaient avec les droits de
-- l'appelant. Le rôle de la personnalisation gardait donc INSERT sur `media` (treize colonnes depuis le cycle 6),
-- UPDATE (claim_code_hash) sur `media` et UPDATE (media_id, associated_at) sur `claim_code`. Par un accès direct, il
-- contournait les contrôles des deux fonctions : bracelet planté dans un lot actif, dans le lot d'un autre
-- prestataire, avec la clé de données d'un autre prestataire, ou au-delà de la quantité commandée (relecture du
-- cycle 6, variantes V1 à V4) ; code de rattachement invalidé, déjà associé ou d'un autre lot posé sur un bracelet.
--
-- Après : les deux fonctions s'exécutent avec les droits du propriétaire ; EXECUTE est retiré à PUBLIC et accordé par
-- `post-roles.sql` aux seuls appelants légitimes (enregistrement : la personnalisation ; association : la
-- personnalisation et l'import du fichier de l'imprimeur par l'API). Ni l'un ni l'autre rôle ne garde de droit
-- d'écriture direct sur `media` (hors colonnes propres à l'API) ni sur l'association des codes.
--
-- Avec un propriétaire superutilisateur (poste local), ni la RLS ni les droits ne s'appliquent dans ces fonctions :
-- elles ne s'appuient sur la RLS pour AUCUN contrôle. Chaque lecture et chaque écriture nomme le prestataire de la
-- session (`app.operator_id`, posé par l'appelant comme pour toute requête d'un processus) :
--   - lot : même prestataire, statut ORDERED ou PERSONALIZED, verrouillé en partage jusqu'à la fin de la transaction
--     (un passage concurrent du lot à DELIVERED attend) ; quantité comptée sur TOUS les bracelets du lot, sous le
--     verrou consultatif du lot (deux postes ne dépassent pas ensemble la quantité) ;
--   - clé du lot : même prestataire, même index, ACTIVE ;
--   - clé de données : même prestataire, même index que le lot, ACTIVE ;
--   - code de rattachement : même prestataire, même lot que le bracelet, ni invalidé, ni déjà associé ; bracelet du
--     même prestataire, sans code.
--
-- search_path : `public, pg_temp`. Sans `pg_temp` nommé en dernier, PostgreSQL cherche les tables d'abord dans le
-- schéma temporaire de la session : un appelant qui a le droit TEMP (accordé à PUBLIC par défaut) masquerait
-- `media_batch`, `tag_key` ou `tag_data_key` par une table temporaire de son choix et ferait passer tous les contrôles.
-- C'est plus strict que `SET search_path = public` demandé (renforcement, consigné dans ADR-94 ; OP-N59 pour les
-- autres fonctions SECURITY DEFINER de la base). Les deux fonctions de déclencheur de 0018 reçoivent le même réglage.

-- 1. Enregistrement d'un bracelet personnalisé (§7.5, étape 4) ---------------------------------------------------------
CREATE OR REPLACE FUNCTION register_personalized_media(p_batch uuid, p_media_id uuid, p_token_hash bytea, p_uid bytea,
                                                       p_sig_sha256 bytea, p_signature_ok boolean, p_pwd_pack_enc bytea,
                                                       p_dek uuid, p_actor uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_operator uuid := media_session_operator(); b_status text; b_quantity int; b_key_index int; v_count int;
BEGIN
  IF p_media_id IS NULL OR p_token_hash IS NULL OR octet_length(p_token_hash) <> 32 OR p_uid IS NULL OR octet_length(p_uid) <> 7
     OR p_sig_sha256 IS NULL OR p_pwd_pack_enc IS NULL OR p_dek IS NULL THEN
    RAISE EXCEPTION 'Bracelet personnalisé : identifiant, empreinte (32 o), UID (7 o), signature, chiffré et clé de données attendus'
      USING ERRCODE = 'CL001';
  END IF;
  -- Verrou consultatif du lot : deux postes ne dépassent pas ensemble la quantité commandée.
  PERFORM pg_advisory_xact_lock(hashtextextended('media-batch-registration:' || p_batch::text, 0));
  -- Lot du prestataire de la session (contrôle explicite : la RLS ne s'applique pas ici). FOR SHARE : le lot ne
  -- change ni de statut ni de quantité avant la fin de la transaction.
  SELECT status, quantity, key_index INTO b_status, b_quantity, b_key_index
    FROM media_batch WHERE id = p_batch AND operator_id = v_operator FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  IF p_signature_ok IS NOT TRUE THEN
    RAISE EXCEPTION 'MEDIA_SIGNATURE_INVALID : signature d''originalité invalide, puce refusée' USING ERRCODE = 'CL020';
  END IF;
  IF b_status NOT IN ('ORDERED','PERSONALIZED') THEN
    RAISE EXCEPTION 'BATCH_NOT_IN_PREPARATION : le lot n''est plus en préparation (%)', b_status USING ERRCODE = 'CL020';
  END IF;
  -- Tous les bracelets du lot, quel que soit le prestataire qui les porte (aucun filtre de RLS ici).
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
  -- Toutes les autres colonnes prennent leur défaut : sans portefeuille, sans caution, sans code.
  INSERT INTO media (id, operator_id, kind, token_hash, nfc_uid, key_index, signature_ok, originality_sig_sha256, batch_id,
                     status, personalized_at, pwd_pack_enc, pwd_pack_dek_id)
  VALUES (p_media_id, v_operator, 'NFC_TAG', p_token_hash, p_uid, b_key_index, true, p_sig_sha256, p_batch,
          'PERSONALIZED', clock_timestamp(), p_pwd_pack_enc, p_dek);
  RETURN p_media_id;
END $$;
REVOKE ALL ON FUNCTION register_personalized_media(uuid, uuid, bytea, bytea, bytea, boolean, bytea, uuid, uuid) FROM PUBLIC;

-- 2. Association d'un code de rattachement à une puce (0010) -------------------------------------------------------------
CREATE OR REPLACE FUNCTION associate_claim_code(p_hash bytea, p_media uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_operator uuid := claim_session_operator(); c claim_code%ROWTYPE; m_batch uuid; m_hash bytea;
BEGIN
  -- Bracelet et code du prestataire de la session (contrôles explicites : la RLS ne s'applique pas ici).
  SELECT batch_id, claim_code_hash INTO m_batch, m_hash FROM media WHERE id = p_media AND operator_id = v_operator FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  SELECT * INTO c FROM claim_code WHERE operator_id = v_operator AND code_hash = p_hash FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CLAIM_CODE_UNKNOWN : code inconnu' USING ERRCODE = 'CL020';
  ELSIF c.invalidated_at IS NOT NULL THEN
    RAISE EXCEPTION 'CLAIM_CODE_INVALIDATED : code invalidé à la clôture du lot' USING ERRCODE = 'CL020';
  ELSIF c.media_id IS NOT NULL THEN
    RAISE EXCEPTION 'CLAIM_CODE_ALREADY_ASSOCIATED : code déjà associé à un bracelet' USING ERRCODE = 'CL020';
  ELSIF m_batch IS DISTINCT FROM c.batch_id THEN
    RAISE EXCEPTION 'CLAIM_CODE_OTHER_BATCH : ce code appartient à un autre lot' USING ERRCODE = 'CL020';
  ELSIF m_hash IS NOT NULL THEN
    RAISE EXCEPTION 'MEDIA_ALREADY_HAS_CODE : ce bracelet porte déjà un code' USING ERRCODE = 'CL020';
  END IF;
  UPDATE claim_code SET media_id = p_media, associated_at = clock_timestamp() WHERE id = c.id AND operator_id = v_operator;
  UPDATE media SET claim_code_hash = p_hash WHERE id = p_media AND operator_id = v_operator;
END $$;
REVOKE ALL ON FUNCTION associate_claim_code(bytea, uuid) FROM PUBLIC;

-- 3. Fonctions de déclencheur de 0018 : même réglage de search_path (renforcement) ---------------------------------------
ALTER FUNCTION log_media_status() SET search_path = public, pg_temp;
ALTER FUNCTION log_batch_status() SET search_path = public, pg_temp;
