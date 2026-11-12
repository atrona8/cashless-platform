-- Migration 0058 : inscription, identité et administration des passerelles locales
-- (mission passerelle-locale, lot WP03 ; FR-002, FR-031, FR-037, C-009 ; contracts/interfaces.md § 1, § 2,
-- § 7, § 12 et § 13 (font foi) ; data-model A.1, A.2 ; research R-05, R-06, R-07).
--
-- Contenu :
--   1. Rôles `cashless_edge` et `cashless_edgeadmin` (création seule : délais de session, droits et mots de passe
--      arrivent en WP09 / migrate.ts ; aucun GRANT ici).
--   2. Colonnes de `edge_gateway`, toutes NULLables ou à valeur par défaut ; `UNIQUE (cert_sha256)` hors REVOKED ;
--      DELETE refusé ; déclencheur qui pose `revoked_at` et rend `REVOKED` terminal.
--   3. Table `edge_reference_change` (vide ; ses déclencheurs et sa numérotation sont en 0063, WP08), interfaces.md § 12.2.
--   4. Fonctions : identify_edge_gateway, touch_edge_gateway, register_edge_gateway, revoke_edge_gateway,
--      rotate_edge_gateway_cert, swap_edge_gateway_roles, set_edge_gateway_role, edge_register_snapshot_key (§ 12.3).
--
-- Contraintes ECARTEES exprès (elles feraient échouer les suites générées du kit ou force_central_authority, A04) :
--   * pas d'index unique « une primaire par événement » : le kit insère deux PRIMARY du même événement
--     (tests_grand_livre_cashless.sql:499-500) ; l'unicité de la primaire non révoquée est contrôlée par
--     register_edge_gateway, swap_edge_gateway_roles et set_edge_gateway_role, sous le verrou de l'événement ;
--   * pas de CHECK (status <> 'REVOKED' OR revoked_at IS NOT NULL) : force_central_authority fait
--     UPDATE ... status = 'REVOKED' sans toucher revoked_at et n'est pas réécrite (C-003) ; le déclencheur pose la date ;
--   * aucune colonne ledger_id (le grand livre se résout par ledger.scope_type = 'EVENT', scope_id = event_id).
--
-- Ordre des verrous (C-012) : verrou consultatif transactionnel de l'ÉVÉNEMENT d'abord
-- (hashtextextended('edge-event:' || event_id, 0)), puis les lignes (FOR UPDATE). Les fonctions qui reçoivent une
-- passerelle lisent d'abord son événement sans verrou de ligne, prennent le verrou consultatif, puis relisent la
-- ligne FOR UPDATE. Les fonctions de handover (WP04) prennent leur propre verrou par grand livre, après celui-ci.
--
-- Exception à assert_tenant : identify_edge_gateway ne vérifie aucun prestataire (le prestataire est justement ce
-- qu'on cherche à partir de l'empreinte du certificat). Elle ne doit être accordée qu'à `cashless_edge` (WP09).
-- touch_edge_gateway ne vérifie le prestataire que si la session en porte un.
--
-- Alertes (interfaces.md § 12.7) : une ligne `audit_log` ET `pg_notify('edge_alert', <json>)`. Le JSON ne porte que
-- le nom de l'alerte et des identifiants (jamais de clé, d'empreinte complète ni de secret). Les noms
-- `EDGE_REGISTERED` (inscription) sont ceux de § 7 ; `EDGE_ROLE_CHANGED` (changement de rôle) et l'action d'audit
-- `EDGE_SNAPSHOT_KEY_REGISTERED` ne figurent pas à § 7 : signalés dans le compte rendu du lot.
--
-- Erreurs : no_data_found (objet inconnu, d'un autre prestataire, ou empreinte inconnue/révoquée : même message,
-- aucun oracle) ; CL001 paramètre incohérent ; CL013 handover ouvert pour l'événement ; 23505 second PRIMARY,
-- empreinte ou numéro de série déjà pris ; CL001 état de passerelle incompatible.
--
-- Aucun GRANT : tous les accords sont posés par WP09 (roles.sql / post-roles.sql). Retrait de l'écriture directe
-- de `cashless_app` sur `edge_gateway` : WP09 (interfaces.md § 12.12), la fenêtre n'existe que sur la branche.
-- Toutes les fonctions : SECURITY DEFINER, search_path = public, pg_temp, EXECUTE retiré à PUBLIC.
--
-- A faire relire par une personne (CLAUDE.md, règle 4) : ce fichier entier, surtout identify_edge_gateway (porte
-- d'entrée mTLS), register_edge_gateway et swap_edge_gateway_roles.

-- 1. Rôles ---------------------------------------------------------------------------------------------------
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['cashless_edge', 'cashless_edgeadmin'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT', r);
    END IF;
  END LOOP;
END $$;

-- 2. Colonnes, contraintes, déclencheurs de edge_gateway -------------------------------------------------------
ALTER TABLE edge_gateway ADD COLUMN registered_at timestamptz DEFAULT now();
ALTER TABLE edge_gateway ADD COLUMN registered_by_label text;
ALTER TABLE edge_gateway ADD COLUMN role_changed_at timestamptz;
ALTER TABLE edge_gateway ADD COLUMN revoked_at timestamptz;
ALTER TABLE edge_gateway ADD COLUMN revoke_reason text;
ALTER TABLE edge_gateway ADD COLUMN reference_applied_seq bigint NOT NULL DEFAULT 0;

-- Une empreinte de certificat identifie une seule passerelle non révoquée ; elle se libère à la révocation.
CREATE UNIQUE INDEX edge_gateway_cert_sha256_live ON edge_gateway (cert_sha256) WHERE status <> 'REVOKED';

-- Pas de suppression : une passerelle se révoque.
CREATE TRIGGER edge_gateway_no_delete BEFORE DELETE ON edge_gateway
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE FUNCTION edge_gateway_revoked_terminal() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF OLD.status = 'REVOKED' AND NEW.status IS DISTINCT FROM 'REVOKED' THEN
    RAISE EXCEPTION 'Passerelle révoquée : état terminal' USING ERRCODE = 'CL001';
  END IF;
  IF NEW.status = 'REVOKED' THEN
    NEW.revoked_at := coalesce(NEW.revoked_at, OLD.revoked_at, now());
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER edge_gateway_revoked_terminal BEFORE UPDATE OF status ON edge_gateway
  FOR EACH ROW EXECUTE FUNCTION edge_gateway_revoked_terminal();

-- 3. Journal des changements de référence (vide ici ; déclencheurs et numérotation en 0063) --------------------
CREATE TABLE edge_reference_change (
  ledger_id    uuid NOT NULL REFERENCES ledger(id),
  change_seq   bigint NOT NULL CHECK (change_seq >= 1),
  operator_id  uuid NOT NULL REFERENCES party(id),
  entity_kind  text NOT NULL CHECK (entity_kind IN ('WALLET_STATE','MEDIA','DEVICE','DEVICE_CONFIG','CASH_SESSION',
                 'VENDOR','VENDOR_SESSION','STAFF','CATALOG','EVENT','UNASSIGNED_MEDIA','GATEWAY')),
  entity_id    uuid NOT NULL,
  changed_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ledger_id, change_seq)
);
ALTER TABLE edge_reference_change ENABLE ROW LEVEL SECURITY;
ALTER TABLE edge_reference_change FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON edge_reference_change
  USING (operator_id = current_setting('app.operator_id', true)::uuid);

-- 4. Fonctions internes (non exposées) ------------------------------------------------------------------------
-- Verrou consultatif de l'événement (premier verrou de toute fonction d'administration).
CREATE FUNCTION edge_event_lock(p_event uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT pg_advisory_xact_lock(hashtextextended('edge-event:' || p_event::text, 0))
$$;

-- Un handover est-il ouvert pour le grand livre de l'événement ? (GRANTED, ACTIVE, RELEASE_REQUESTED, RELEASING)
CREATE FUNCTION edge_event_handover_open(p_event uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM debit_authority_handover h JOIN ledger l ON l.id = h.ledger_id
     WHERE l.scope_type = 'EVENT' AND l.scope_id = p_event
       AND h.status IN ('GRANTED','ACTIVE','RELEASE_REQUESTED','RELEASING'))
$$;

-- Audit + alerte. Le détail ne porte jamais de clé : au plus l'empreinte tronquée (8 premiers octets).
CREATE FUNCTION edge_admin_audit(p_operator uuid, p_action text, p_gateway uuid, p_label text,
                                 p_detail jsonb, p_alert text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO audit_log (operator_id, actor_id, actor_role, action, object_type, object_id, after, origin)
  VALUES (p_operator, NULL, session_user::text, p_action, 'EDGE_GATEWAY', p_gateway::text,
          coalesce(p_detail, '{}'::jsonb) || jsonb_build_object('label', p_label)
            || CASE WHEN p_alert IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('alert', p_alert) END,
          'edge-admin');
  IF p_alert IS NOT NULL THEN
    PERFORM pg_notify('edge_alert', jsonb_build_object('alert', p_alert, 'action', p_action,
                      'operator_id', p_operator, 'gateway_id', p_gateway)::text);
  END IF;
END $$;

-- 5. Identification et lien ----------------------------------------------------------------------------------
-- Porte d'entrée mTLS. Ne lit que. Empreinte inconnue, de longueur incorrecte ou passerelle REVOKED : exactement la
-- même erreur et le même message (aucun oracle sur l'existence ou l'état).
CREATE FUNCTION identify_edge_gateway(p_cert_sha256 bytea)
RETURNS TABLE (gateway_id uuid, operator_id uuid, event_id uuid, ledger_id uuid, role text, status text,
               lan_url text, public_key bytea)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF p_cert_sha256 IS NOT NULL AND octet_length(p_cert_sha256) = 32 THEN
    RETURN QUERY
    SELECT g.id, g.operator_id, g.event_id,
           (SELECT l.id FROM ledger l WHERE l.scope_type = 'EVENT' AND l.scope_id = g.event_id),
           g.role, g.status, g.lan_url, g.public_key
      FROM edge_gateway g
     WHERE g.cert_sha256 = p_cert_sha256 AND g.status <> 'REVOKED';
    IF FOUND THEN
      RETURN;
    END IF;
  END IF;
  RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found';
END $$;

CREATE FUNCTION touch_edge_gateway(p_gateway uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_op uuid;
BEGIN
  SELECT g.operator_id INTO v_op FROM edge_gateway g WHERE g.id = p_gateway;
  IF NOT FOUND THEN
    RETURN;                                           -- inconnue : sans effet, sans erreur révélatrice
  END IF;
  IF nullif(current_setting('app.operator_id', true), '') IS NOT NULL THEN
    PERFORM assert_tenant(v_op);
  END IF;
  UPDATE edge_gateway
     SET last_seen_at = now(),
         status = CASE WHEN status = 'ISOLATED' THEN 'CATCHING_UP' ELSE status END
   WHERE id = p_gateway AND status <> 'REVOKED';
END $$;

-- 6. Administration ------------------------------------------------------------------------------------------
CREATE FUNCTION register_edge_gateway(p_operator uuid, p_event uuid, p_serial text, p_role text,
                                      p_cert_sha256 bytea, p_public_key bytea, p_agreement_public_key bytea,
                                      p_lan_url text, p_registered_by_label text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id uuid;
BEGIN
  PERFORM assert_tenant(p_operator);
  IF p_event IS NULL OR tenant_of_event(p_event) IS DISTINCT FROM p_operator THEN
    RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found';
  END IF;
  PERFORM edge_event_lock(p_event);                   -- verrou de l'événement d'abord (C-012)
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
                               'cert_sha256_prefix', encode(substring(p_cert_sha256 FROM 1 FOR 8), 'hex')),
            'EDGE_REGISTERED');
  RETURN v_id;
END $$;

CREATE FUNCTION revoke_edge_gateway(p_gateway uuid, p_reason text, p_label text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE g edge_gateway%ROWTYPE;
BEGIN
  SELECT * INTO g FROM edge_gateway WHERE id = p_gateway;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found';
  END IF;
  PERFORM assert_tenant(g.operator_id);
  PERFORM edge_event_lock(g.event_id);
  SELECT * INTO g FROM edge_gateway WHERE id = p_gateway FOR UPDATE;
  IF coalesce(btrim(p_label), '') = '' OR coalesce(btrim(p_reason), '') = '' THEN
    RAISE EXCEPTION 'Révocation : motif et libellé obligatoires' USING ERRCODE = 'CL001';
  END IF;
  IF g.status = 'REVOKED' THEN
    RETURN;                                           -- idempotente
  END IF;
  IF edge_event_handover_open(g.event_id) THEN
    RAISE EXCEPTION 'Révocation refusée : un handover est ouvert pour cet événement (reprise forcée)'
      USING ERRCODE = 'CL013';
  END IF;
  UPDATE edge_gateway SET status = 'REVOKED', revoke_reason = p_reason WHERE id = p_gateway;
  PERFORM edge_admin_audit(g.operator_id, 'EDGE_GATEWAY_REVOKED', p_gateway, btrim(p_label),
            jsonb_build_object('event_id', g.event_id, 'reason', left(p_reason, 500)), NULL);
END $$;

CREATE FUNCTION rotate_edge_gateway_cert(p_gateway uuid, p_cert_sha256 bytea, p_label text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE g edge_gateway%ROWTYPE;
BEGIN
  SELECT * INTO g FROM edge_gateway WHERE id = p_gateway;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found';
  END IF;
  PERFORM assert_tenant(g.operator_id);
  PERFORM edge_event_lock(g.event_id);
  SELECT * INTO g FROM edge_gateway WHERE id = p_gateway FOR UPDATE;
  IF coalesce(btrim(p_label), '') = '' THEN
    RAISE EXCEPTION 'Rotation : libellé obligatoire' USING ERRCODE = 'CL001';
  END IF;
  IF p_cert_sha256 IS NULL OR octet_length(p_cert_sha256) <> 32 THEN
    RAISE EXCEPTION 'Rotation : empreinte de 32 octets exigée' USING ERRCODE = 'CL001';
  END IF;
  IF g.status = 'REVOKED' THEN
    RAISE EXCEPTION 'Rotation refusée : passerelle révoquée' USING ERRCODE = 'CL001';
  END IF;
  UPDATE edge_gateway SET cert_sha256 = p_cert_sha256 WHERE id = p_gateway;   -- l'ancienne empreinte cesse aussitôt
  PERFORM edge_admin_audit(g.operator_id, 'EDGE_CERT_ROTATED', p_gateway, btrim(p_label),
            jsonb_build_object('event_id', g.event_id,
                               'cert_sha256_prefix', encode(substring(p_cert_sha256 FROM 1 FOR 8), 'hex')), NULL);
END $$;

-- Echange atomique des rôles (A25) : une seule instruction UPDATE, jamais deux PRIMARY ni zéro entre les deux.
CREATE FUNCTION swap_edge_gateway_roles(p_old_primary uuid, p_new_primary uuid, p_label text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE o edge_gateway%ROWTYPE; n edge_gateway%ROWTYPE;
BEGIN
  SELECT * INTO o FROM edge_gateway WHERE id = p_old_primary;
  IF NOT FOUND OR p_new_primary IS NULL THEN
    RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found';
  END IF;
  PERFORM assert_tenant(o.operator_id);
  PERFORM edge_event_lock(o.event_id);
  IF coalesce(btrim(p_label), '') = '' THEN
    RAISE EXCEPTION 'Echange : libellé obligatoire' USING ERRCODE = 'CL001';
  END IF;
  -- verrous de ligne dans l'ordre des identifiants (pas d'interblocage entre deux échanges inverses)
  PERFORM 1 FROM edge_gateway WHERE id IN (p_old_primary, p_new_primary) ORDER BY id FOR UPDATE;
  SELECT * INTO o FROM edge_gateway WHERE id = p_old_primary;
  SELECT * INTO n FROM edge_gateway WHERE id = p_new_primary;
  IF NOT FOUND OR n.operator_id <> o.operator_id THEN
    RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found';
  END IF;
  IF p_old_primary = p_new_primary OR n.event_id <> o.event_id THEN
    RAISE EXCEPTION 'Echange : deux passerelles distinctes du même événement exigées' USING ERRCODE = 'CL001';
  END IF;
  IF o.status = 'REVOKED' OR n.status = 'REVOKED' THEN
    RAISE EXCEPTION 'Echange refusé : passerelle révoquée' USING ERRCODE = 'CL001';
  END IF;
  IF o.role <> 'PRIMARY' OR n.role <> 'STANDBY' THEN
    RAISE EXCEPTION 'Echange : l''ancienne doit être PRIMARY et la nouvelle STANDBY' USING ERRCODE = 'CL001';
  END IF;
  IF edge_event_handover_open(o.event_id) THEN
    RAISE EXCEPTION 'Echange refusé : un handover est ouvert pour cet événement' USING ERRCODE = 'CL013';
  END IF;
  UPDATE edge_gateway
     SET role = CASE WHEN id = p_old_primary THEN 'STANDBY' ELSE 'PRIMARY' END,
         role_changed_at = now()
   WHERE id IN (p_old_primary, p_new_primary);
  PERFORM edge_admin_audit(o.operator_id, 'EDGE_GATEWAY_ROLE_CHANGED', p_new_primary, btrim(p_label),
            jsonb_build_object('event_id', o.event_id, 'old_primary', p_old_primary,
                               'new_primary', p_new_primary, 'kind', 'SWAP'), 'EDGE_ROLE_CHANGED');
END $$;

-- Non accordée seule (WP09 ne la donne à aucun rôle) : réservée aux autres fonctions et au propriétaire.
CREATE FUNCTION set_edge_gateway_role(p_gateway uuid, p_role text, p_label text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE g edge_gateway%ROWTYPE;
BEGIN
  SELECT * INTO g FROM edge_gateway WHERE id = p_gateway;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found';
  END IF;
  PERFORM assert_tenant(g.operator_id);
  PERFORM edge_event_lock(g.event_id);
  SELECT * INTO g FROM edge_gateway WHERE id = p_gateway FOR UPDATE;
  IF coalesce(btrim(p_label), '') = '' THEN
    RAISE EXCEPTION 'Rôle : libellé obligatoire' USING ERRCODE = 'CL001';
  END IF;
  IF p_role IS NULL OR p_role NOT IN ('PRIMARY','STANDBY') THEN
    RAISE EXCEPTION 'Rôle : PRIMARY ou STANDBY' USING ERRCODE = 'CL001';
  END IF;
  IF g.status = 'REVOKED' THEN
    RAISE EXCEPTION 'Rôle refusé : passerelle révoquée' USING ERRCODE = 'CL001';
  END IF;
  IF edge_event_handover_open(g.event_id) THEN
    RAISE EXCEPTION 'Rôle refusé : un handover est ouvert pour cet événement' USING ERRCODE = 'CL013';
  END IF;
  IF p_role = 'PRIMARY' AND EXISTS (SELECT 1 FROM edge_gateway x WHERE x.event_id = g.event_id
                                     AND x.id <> g.id AND x.role = 'PRIMARY' AND x.status <> 'REVOKED') THEN
    RAISE EXCEPTION 'Rôle refusé : une autre passerelle PRIMARY non révoquée existe' USING ERRCODE = 'unique_violation';
  END IF;
  IF g.role = p_role THEN
    RETURN;                                           -- rien à changer : le délai des colis ne repart pas
  END IF;
  UPDATE edge_gateway SET role = p_role, role_changed_at = now() WHERE id = p_gateway;
  PERFORM edge_admin_audit(g.operator_id, 'EDGE_GATEWAY_ROLE_CHANGED', p_gateway, btrim(p_label),
            jsonb_build_object('event_id', g.event_id, 'old_role', g.role, 'new_role', p_role, 'kind', 'SET'),
            'EDGE_ROLE_CHANGED');
END $$;

-- Clé de signature des snapshots de la passerelle (owner = 'EDGE', interfaces.md § 12.3) ; accordée à
-- cashless_edgeadmin seul (WP09), appelée par l'outil (WP15). Une clé ACTIVE existante n'est jamais remplacée en
-- silence : le second appel échoue (index snapshot_signing_key_one_active).
CREATE FUNCTION edge_register_snapshot_key(p_gateway uuid, p_key_id text, p_public_key bytea, p_label text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE g edge_gateway%ROWTYPE;
BEGIN
  SELECT * INTO g FROM edge_gateway WHERE id = p_gateway;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found';
  END IF;
  PERFORM assert_tenant(g.operator_id);
  PERFORM edge_event_lock(g.event_id);
  SELECT * INTO g FROM edge_gateway WHERE id = p_gateway FOR UPDATE;
  IF coalesce(btrim(p_label), '') = '' THEN
    RAISE EXCEPTION 'Clé de snapshot : libellé obligatoire' USING ERRCODE = 'CL001';
  END IF;
  IF coalesce(btrim(p_key_id), '') = '' OR p_public_key IS NULL OR octet_length(p_public_key) = 0 THEN
    RAISE EXCEPTION 'Clé de snapshot : identifiant et clé publique obligatoires' USING ERRCODE = 'CL001';
  END IF;
  IF g.status = 'REVOKED' THEN
    RAISE EXCEPTION 'Clé de snapshot refusée : passerelle révoquée' USING ERRCODE = 'CL001';
  END IF;
  INSERT INTO snapshot_signing_key (key_id, operator_id, owner, edge_gateway_id, algorithm, public_key, status)
  VALUES (btrim(p_key_id), g.operator_id, 'EDGE', p_gateway, 'ECDSA_P256_SHA256', p_public_key, 'ACTIVE');
  PERFORM edge_admin_audit(g.operator_id, 'EDGE_SNAPSHOT_KEY_REGISTERED', p_gateway, btrim(p_label),
            jsonb_build_object('event_id', g.event_id, 'key_id', btrim(p_key_id)), NULL);
END $$;

-- 7. Droits : EXECUTE retiré à PUBLIC, aucun GRANT (WP09) -------------------------------------------------------
REVOKE ALL ON FUNCTION edge_event_lock(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION edge_event_handover_open(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION edge_admin_audit(uuid, text, uuid, text, jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION identify_edge_gateway(bytea) FROM PUBLIC;
REVOKE ALL ON FUNCTION touch_edge_gateway(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION register_edge_gateway(uuid, uuid, text, text, bytea, bytea, bytea, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION revoke_edge_gateway(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION rotate_edge_gateway_cert(uuid, bytea, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION swap_edge_gateway_roles(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION set_edge_gateway_role(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION edge_register_snapshot_key(uuid, text, bytea, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION edge_gateway_revoked_terminal() FROM PUBLIC;
