-- Migration 0072 : un colis ou une clé de colis ne se dépose qu'une fois le délai de garde écoulé (mission
-- passerelle-locale, lot WP25, session B7 ; défaut C, décision 16 inchangée : 30 minutes, ni raccourci ni contourné).
-- Défaut : `edge_replication_page` ne sert les colis qu'à une PRIMARY non révoquée dont le délai est écoulé
-- (inscription ou promotion + `pack_delay_seconds`), mais `deposit_edge_pwd_pack*` acceptait un dépôt avant ce
-- terme. Un tel dépôt émettait (0071) dans le flux à un moment où la page ne rendait pas le colis ; la fin du délai
-- n'émet rien (aucun événement de base ne la marque), donc une passerelle qui avait copié le flux dans l'intervalle
-- ne recevait jamais ce colis sans relecture complète. Correction : les deux fonctions de dépôt refusent (CL001)
-- tant que la passerelle n'est pas une PRIMARY dont le délai est écoulé, les mêmes conditions que la page et que
-- `edge_media_to_pack`. Ainsi tout dépôt qui réussit tombe dans la fenêtre où la page le sert, et l'émission de 0071
-- le porte à la passerelle ; le travailleur de colis, qui n'agit déjà qu'après le délai, n'est pas changé.
-- Renforcement seulement (un refus de plus) : aucun droit nouveau. CREATE OR REPLACE, mêmes signatures et mêmes
-- droits (REVOKE ALL FROM PUBLIC répété, aucun GRANT). A faire relire par une personne : les deux fonctions.
-- Reste (non traité) : une PRIMARY promue de nouveau garde ses colis déjà déposés ; son délai repart sans émission.

CREATE OR REPLACE FUNCTION deposit_edge_pwd_pack_key(p_gateway uuid, p_agreement_key_sha256 bytea, p_wrapped jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE g edge_gateway%ROWTYPE; old edge_pwd_pack_key%ROWTYPE; v_gone uuid[];
BEGIN
  SELECT * INTO g FROM edge_gateway WHERE id = p_gateway;
  IF NOT FOUND THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  PERFORM assert_tenant(g.operator_id);
  SELECT * INTO g FROM edge_gateway WHERE id = p_gateway FOR SHARE;
  IF g.status = 'REVOKED' THEN
    RAISE EXCEPTION 'Clé de colis : passerelle révoquée' USING ERRCODE = 'CL001';
  END IF;
  IF g.role <> 'PRIMARY'
     OR coalesce(g.role_changed_at, g.registered_at)
        + make_interval(secs => coalesce(edge_setting_value('pack_delay_seconds', 'XOF'), 1800)) > clock_timestamp() THEN
    RAISE EXCEPTION '%', 'Colis : délai de garde non écoulé ou passerelle non principale' USING ERRCODE = 'CL001';
  END IF;
  IF p_agreement_key_sha256 IS NULL OR octet_length(p_agreement_key_sha256) <> 32 THEN
    RAISE EXCEPTION 'Clé de colis : empreinte de 32 octets exigée' USING ERRCODE = 'CL001';
  END IF;
  IF g.agreement_public_key IS NULL OR p_agreement_key_sha256 <> sha256(g.agreement_public_key) THEN
    RAISE EXCEPTION 'Clé de colis : empreinte différente de la clé d''accord de la passerelle' USING ERRCODE = 'CL001';
  END IF;
  IF p_wrapped IS NULL OR jsonb_typeof(p_wrapped) <> 'object'
     OR p_wrapped ->> 'alg' IS DISTINCT FROM 'ECDH-ES+HKDF-SHA256+A256GCM'
     OR coalesce(jsonb_typeof(p_wrapped -> 'epk'), '') <> 'string' OR coalesce(jsonb_typeof(p_wrapped -> 'iv'), '') <> 'string'
     OR coalesce(jsonb_typeof(p_wrapped -> 'wrapped_key'), '') <> 'string'
     OR length(p_wrapped::text) > 4096 THEN
    RAISE EXCEPTION 'Clé de colis : enveloppe invalide' USING ERRCODE = 'CL001';
  END IF;
  SELECT * INTO old FROM edge_pwd_pack_key WHERE gateway_id = p_gateway FOR UPDATE;
  IF FOUND THEN
    IF old.agreement_key_sha256 = p_agreement_key_sha256 THEN
      IF old.wrapped_key = p_wrapped THEN RETURN; END IF;                       -- rejeu identique
      RAISE EXCEPTION 'Clé de colis : une clé de contenu existe déjà pour cette clé d''accord' USING ERRCODE = 'CL002';
    END IF;
    -- Clé d'accord changée : l'ancienne clé de contenu et ses colis ne sont plus servis.
    WITH gone AS (DELETE FROM edge_pwd_pack WHERE gateway_id = p_gateway RETURNING media_id)
    SELECT coalesce(array_agg(media_id), ARRAY[]::uuid[]) INTO v_gone FROM gone;
    UPDATE edge_pwd_pack_key SET agreement_key_sha256 = p_agreement_key_sha256, wrapped_key = p_wrapped,
           created_at = clock_timestamp() WHERE gateway_id = p_gateway;
    PERFORM edge_ref_emit_media_set(v_gone);        -- les colis retirés sortent du flux
    RETURN;
  END IF;
  INSERT INTO edge_pwd_pack_key (gateway_id, operator_id, agreement_key_sha256, wrapped_key)
  VALUES (p_gateway, g.operator_id, p_agreement_key_sha256, p_wrapped);
END $$;

CREATE OR REPLACE FUNCTION deposit_edge_pwd_pack(p_gateway uuid, p_media uuid, p_pack bytea,
                                                  p_pack_sha256 bytea, p_media_version bigint)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE g edge_gateway%ROWTYPE; k edge_pwd_pack_key%ROWTYPE; m media%ROWTYPE; v_ok boolean; v_n bigint;
BEGIN
  SELECT * INTO g FROM edge_gateway WHERE id = p_gateway;
  IF NOT FOUND THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  PERFORM assert_tenant(g.operator_id);
  SELECT * INTO g FROM edge_gateway WHERE id = p_gateway FOR SHARE;
  IF g.status = 'REVOKED' THEN
    RAISE EXCEPTION 'Colis : passerelle révoquée' USING ERRCODE = 'CL001';
  END IF;
  IF g.role <> 'PRIMARY'
     OR coalesce(g.role_changed_at, g.registered_at)
        + make_interval(secs => coalesce(edge_setting_value('pack_delay_seconds', 'XOF'), 1800)) > clock_timestamp() THEN
    RAISE EXCEPTION '%', 'Colis : délai de garde non écoulé ou passerelle non principale' USING ERRCODE = 'CL001';
  END IF;
  SELECT * INTO m FROM media WHERE id = p_media;
  IF NOT FOUND OR m.operator_id <> g.operator_id THEN
    RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found';
  END IF;
  -- Le bracelet doit être du MEME événement : lot de l'événement, ou rattaché à un portefeuille de son grand livre.
  SELECT EXISTS (SELECT 1 FROM media_batch b WHERE b.id = m.batch_id AND b.event_id = g.event_id)
      OR EXISTS (SELECT 1 FROM media_assignment ma JOIN wallet w ON w.id = ma.wallet_id
                  WHERE ma.media_id = m.id AND ma.released_at IS NULL AND w.ledger_id = edge_ref_event_ledger(g.event_id))
    INTO v_ok;
  IF NOT v_ok THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  IF p_pack IS NULL OR octet_length(p_pack) < 28 OR octet_length(p_pack) > 256 THEN
    RAISE EXCEPTION 'Colis : longueur invalide' USING ERRCODE = 'CL001';
  END IF;
  IF p_pack_sha256 IS NULL OR octet_length(p_pack_sha256) <> 32 THEN
    RAISE EXCEPTION 'Colis : empreinte de 32 octets exigée' USING ERRCODE = 'CL001';
  END IF;
  IF sha256(p_pack) <> p_pack_sha256 THEN
    RAISE EXCEPTION 'Colis : empreinte différente du contenu' USING ERRCODE = 'CL001';
  END IF;
  IF p_media_version IS NULL OR p_media_version < 0 THEN
    RAISE EXCEPTION 'Colis : version invalide' USING ERRCODE = 'CL001';
  END IF;
  SELECT * INTO k FROM edge_pwd_pack_key WHERE gateway_id = p_gateway;
  IF NOT FOUND OR g.agreement_public_key IS NULL OR k.agreement_key_sha256 <> sha256(g.agreement_public_key) THEN
    RAISE EXCEPTION 'Colis : clé de contenu absente ou périmée pour cette passerelle' USING ERRCODE = 'CL001';
  END IF;
  INSERT INTO edge_pwd_pack (gateway_id, media_id, operator_id, pwd_pack_enc, pwd_pack_sha256, media_version,
                             agreement_key_sha256)
  VALUES (p_gateway, p_media, g.operator_id, p_pack, p_pack_sha256, p_media_version, k.agreement_key_sha256)
  ON CONFLICT (gateway_id, media_id) DO UPDATE
     SET pwd_pack_enc = EXCLUDED.pwd_pack_enc, pwd_pack_sha256 = EXCLUDED.pwd_pack_sha256,
         media_version = EXCLUDED.media_version, agreement_key_sha256 = EXCLUDED.agreement_key_sha256,
         created_at = clock_timestamp()
   WHERE EXCLUDED.media_version > edge_pwd_pack.media_version
      OR edge_pwd_pack.agreement_key_sha256 <> EXCLUDED.agreement_key_sha256;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n > 0 THEN PERFORM edge_ref_emit_media_set(ARRAY[p_media]); END IF;   -- nouvelle ligne de flux
END $$;

REVOKE ALL ON FUNCTION deposit_edge_pwd_pack_key(uuid, bytea, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION deposit_edge_pwd_pack(uuid, uuid, bytea, bytea, bigint) FROM PUBLIC;
