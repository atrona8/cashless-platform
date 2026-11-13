-- Migration 0067 : lecture étroite des bracelets à sceller pour une passerelle (mission passerelle-locale, lot WP15,
-- T068 ; décision 41 du porteur du 10/11/2026, ADR-183). Le travailleur de colis (cashless_tagkeys) n'a aucun droit sur
-- media_batch, media_assignment ni wallet : il ne peut pas lister les bracelets d'un événement. Cette fonction en rend
-- le strict nécessaire pour UNE passerelle désignée du prestataire courant, JAMAIS un secret en clair (le chiffré
-- `pwd_pack_enc` est déjà lisible par ce rôle sur `media`, post-roles.sql §2a ; la clé de données reste au service de clés).
--
--   edge_media_to_pack(p_gateway uuid, p_limit int)
--     -> (ledger_id, media_id, operator_id, nfc_uid, key_index, media_version, pwd_pack_enc, pwd_pack_dek_id)
--
--   * Passerelle du prestataire courant (assert_tenant), PRIMARY, non révoquée, délai de colis écoulé (mêmes conditions
--     que edge_gateways_awaiting_pack) ; sinon rien n'est rendu. Une STANDBY n'est jamais servie.
--   * Bracelets : mêmes que ceux de deposit_edge_pwd_pack (lot de l'événement, ou rattaché à un portefeuille de son grand
--     livre), avec chiffré et UID, SANS colis de la clé d'accord courante à une version égale ou plus récente.
--   * `media_version` : aucune colonne ne la porte ; elle est dérivée = millisecondes de `personalized_at` * 65536 +
--     `key_index` (croît à toute re-personnalisation et à tout changement d'index de clé ; borne : deux
--     re-personnalisations dans la même milliseconde avec le même index ne se distinguent pas).
--   * Si rien n'est à sceller mais que la passerelle est éligible : UNE ligne dont seul `ledger_id` est renseigné (le
--     travailleur en a besoin pour sceller la clé de contenu avant tout colis).
--   * REVOKE ALL FROM PUBLIC ; EXECUTE à cashless_tagkeys seul (post-roles.sql §9f).
SET CONSTRAINTS ALL IMMEDIATE;

CREATE FUNCTION edge_media_to_pack(p_gateway uuid, p_limit int)
RETURNS TABLE (ledger_id uuid, media_id uuid, operator_id uuid, nfc_uid bytea, key_index int,
               media_version bigint, pwd_pack_enc bytea, pwd_pack_dek_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE g edge_gateway%ROWTYPE; v_delay bigint; v_ledger uuid; v_n bigint;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 1000 THEN
    RAISE EXCEPTION 'Colis : limite entre 1 et 1000' USING ERRCODE = 'CL001';
  END IF;
  SELECT * INTO g FROM edge_gateway WHERE id = p_gateway;
  IF NOT FOUND THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  PERFORM assert_tenant(g.operator_id);
  v_delay := coalesce(edge_setting_value('pack_delay_seconds', 'XOF'), 1800);
  IF g.role <> 'PRIMARY' OR g.status = 'REVOKED' OR g.agreement_public_key IS NULL
     OR coalesce(g.role_changed_at, g.registered_at) + make_interval(secs => v_delay) > clock_timestamp() THEN
    RETURN;
  END IF;
  v_ledger := edge_ref_event_ledger(g.event_id);
  IF v_ledger IS NULL THEN RETURN; END IF;
  RETURN QUERY
  SELECT v_ledger, m.id, m.operator_id, m.nfc_uid, m.key_index,
         (floor(extract(epoch FROM coalesce(m.personalized_at, 'epoch'::timestamptz)) * 1000)::bigint * 65536
          + m.key_index)::bigint,
         m.pwd_pack_enc, m.pwd_pack_dek_id
    FROM media m
   WHERE m.operator_id = g.operator_id AND m.pwd_pack_enc IS NOT NULL AND m.pwd_pack_dek_id IS NOT NULL
     AND m.nfc_uid IS NOT NULL
     AND (EXISTS (SELECT 1 FROM media_batch b WHERE b.id = m.batch_id AND b.event_id = g.event_id)
          OR EXISTS (SELECT 1 FROM media_assignment ma JOIN wallet w ON w.id = ma.wallet_id
                      WHERE ma.media_id = m.id AND ma.released_at IS NULL AND w.ledger_id = v_ledger))
     AND NOT EXISTS (SELECT 1 FROM edge_pwd_pack p
                      WHERE p.gateway_id = g.id AND p.media_id = m.id
                        AND p.agreement_key_sha256 = sha256(g.agreement_public_key)
                        AND p.media_version >= (floor(extract(epoch FROM coalesce(m.personalized_at, 'epoch'::timestamptz))
                                                      * 1000)::bigint * 65536 + m.key_index))
   ORDER BY m.id LIMIT p_limit;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN
    RETURN QUERY SELECT v_ledger, NULL::uuid, NULL::uuid, NULL::bytea, NULL::int, NULL::bigint, NULL::bytea, NULL::uuid;
  END IF;
END $$;
REVOKE ALL ON FUNCTION edge_media_to_pack(uuid, int) FROM PUBLIC;
