-- Migration 0094 : register_edge_gateway rend le grand livre de l'événement (mission durcissements-serveur,
-- lot WP02 ; FR-018 ; plan IC-08). Le type de retour change : CREATE OR REPLACE interdit (42P13), donc DROP puis
-- CREATE, mêmes neuf arguments que 0058. Aucun droit nouveau (post-roles.sql § 9e les rend, WP03).
-- Fonction à faire relire : register_edge_gateway.
DROP FUNCTION register_edge_gateway(uuid, uuid, text, text, bytea, bytea, bytea, text, text);

CREATE FUNCTION register_edge_gateway(p_operator uuid, p_event uuid, p_serial text, p_role text,
                                      p_cert_sha256 bytea, p_public_key bytea, p_agreement_public_key bytea,
                                      p_lan_url text, p_registered_by_label text)
RETURNS TABLE (gateway_id uuid, ledger_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE v_id uuid; v_ledger uuid; v_n int;
BEGIN
  PERFORM assert_tenant(p_operator);
  IF p_event IS NULL OR tenant_of_event(p_event) IS DISTINCT FROM p_operator THEN
    RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found';
  END IF;
  PERFORM edge_event_lock(p_event);                   -- verrou de l'événement d'abord (C-012)
  -- Grand livre de l'événement, sous le verrou : un seul, sinon rien n'est écrit (CL058).
  SELECT count(*), min(l.id::text)::uuid INTO v_n, v_ledger FROM ledger l
   WHERE l.scope_type = 'EVENT' AND l.scope_id = p_event AND l.operator_id = p_operator;
  IF v_n = 0 THEN
    RAISE EXCEPTION 'Inscription : grand livre de l''événement introuvable' USING ERRCODE = 'CL058';
  ELSIF v_n > 1 THEN
    RAISE EXCEPTION 'Inscription : grand livre de l''événement ambigu (plusieurs devises)'
      USING ERRCODE = 'CL058';
  END IF;
  IF coalesce(btrim(p_registered_by_label), '') = '' THEN
    RAISE EXCEPTION 'Inscription : libellé de l''opérateur obligatoire' USING ERRCODE = 'CL001';
  END IF;
  IF coalesce(btrim(p_serial), '') = '' THEN
    RAISE EXCEPTION 'Inscription : numéro de série obligatoire' USING ERRCODE = 'CL001';
  END IF;
  IF p_role IS NULL OR p_role NOT IN ('PRIMARY','STANDBY') THEN
    RAISE EXCEPTION 'Inscription : rôle PRIMARY ou STANDBY' USING ERRCODE = 'CL001';
  END IF;
  IF p_cert_sha256 IS NULL OR octet_length(p_cert_sha256) <> 32 THEN
    RAISE EXCEPTION 'Inscription : empreinte de 32 octets exigée' USING ERRCODE = 'CL001';
  END IF;
  IF p_agreement_public_key IS NULL OR octet_length(p_agreement_public_key) <> 65 THEN
    RAISE EXCEPTION 'Inscription : clé d''accord de 65 octets exigée' USING ERRCODE = 'CL001';
  END IF;
  IF p_public_key IS NULL OR octet_length(p_public_key) = 0 THEN
    RAISE EXCEPTION 'Inscription : clé publique de signature des lots exigée' USING ERRCODE = 'CL001';
  END IF;
  IF p_role = 'PRIMARY' AND EXISTS (SELECT 1 FROM edge_gateway g
                                     WHERE g.event_id = p_event AND g.role = 'PRIMARY' AND g.status <> 'REVOKED') THEN
    RAISE EXCEPTION 'Inscription : une passerelle PRIMARY non révoquée existe déjà pour cet événement'
      USING ERRCODE = 'unique_violation';
  END IF;
  INSERT INTO edge_gateway (operator_id, event_id, serial, role, status, public_key, agreement_public_key,
                            cert_sha256, lan_url, registered_at, registered_by_label, role_changed_at)
  VALUES (p_operator, p_event, btrim(p_serial), p_role, 'ACTIVE', p_public_key, p_agreement_public_key,
          p_cert_sha256, p_lan_url, now(), btrim(p_registered_by_label), now())
  RETURNING id INTO v_id;
  PERFORM edge_admin_audit(p_operator, 'EDGE_GATEWAY_REGISTERED', v_id, btrim(p_registered_by_label),
            jsonb_build_object('event_id', p_event, 'serial', btrim(p_serial), 'role', p_role,
                               'ledger_id', v_ledger,
                               'cert_sha256_prefix',
                               encode(substring(p_cert_sha256 FROM 1 FOR 8), 'hex')),
            'EDGE_REGISTERED');
  RETURN QUERY SELECT v_id, v_ledger;
END $$;
REVOKE ALL ON FUNCTION register_edge_gateway(uuid, uuid, text, text, bytea, bytea, bytea, text, text) FROM PUBLIC;

