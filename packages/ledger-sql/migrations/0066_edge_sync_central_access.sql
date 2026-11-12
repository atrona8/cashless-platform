-- Migration 0066 : accès étroits du central pour la réception des lots de passerelle
-- (mission passerelle-locale, lot WP13, correction ; décisions du porteur 38 et 39 ; ADR-174).
--
-- Le rôle `cashless_edge` n'a AUCUN droit de table (WP09, post-roles.sql 9d). La réception d'un lot a pourtant besoin
-- de cinq lectures ou écritures que les enveloppes `edge_*` ne donnent pas, et le COMMIT d'une écriture comptable
-- exécute `check_balanced` sous le rôle de la connexion. Rien de tout cela n'est réglé par un droit de table :
--
--   1. check_balanced() (décision 38) : SECURITY DEFINER, search_path = public, pg_temp. Le déclencheur de contrainte
--      différé `posting_balanced` lit `posting` au COMMIT ; sous `cashless_edge` il échouait (« permission denied for
--      table posting »). Plutôt qu'un droit de lecture sur `posting`, la fonction s'exécute sous le propriétaire.
--      Elle ne rend rien, ne prend aucun paramètre et ne lit que les lignes de la transaction du déclencheur.
--      EXECUTE reste retiré à PUBLIC (un déclencheur ne demande pas EXECUTE au moment où il se déclenche).
--   2. Fonctions étroites (décision 39), toutes SECURITY DEFINER, search_path = public, pg_temp, EXECUTE retiré à
--      PUBLIC, accordé à `cashless_edge` SEUL (post-roles.sql 9d), chacune liée à la passerelle de la session :
--        edge_sync_cursor(gateway)                curseur du registre (dernier numéro contigu, dernière chaîne)
--        edge_sync_device_key(gateway, serial)    clé publique et état d'un terminal de l'événement de la passerelle
--        edge_sync_results(gateway, batch)        résultats mémorisés d'UN lot de CETTE passerelle
--        edge_fee_config(gateway, serial, date)   règle de commission en vigueur, taux de taxe, trois comptes
--        edge_sync_audit(gateway, action, batch, detail)   trois actions d'audit seulement
--        edge_tap_proof(gateway, token, uid, signature)    vrai/faux : empreinte de la signature de passage
--      La dernière n'est PAS dans la liste de la décision 39 : elle est le même besoin (le central pose
--      `tap.signature_verified`, jamais la passerelle) ; elle ne rend qu'un booléen. A SOUMETTRE AU PORTEUR (compte
--      rendu de WP13) ; elle se retire en supprimant cette seule section et sa ligne dans post-roles.sql 9d.
--
-- Chaque fonction : p_gateway doit être la passerelle de la session (app.gateway_id, posé par la garde mTLS), non
-- révoquée, du prestataire de la session (edge_bind_gateway : 42501 sinon, même message). Aucune ne rend une ligne
-- d'un autre prestataire, d'une autre passerelle ni d'un autre événement.
-- A faire relire par une personne (CLAUDE.md, règle 4) : edge_tap_proof (oracle booléen sur une empreinte),
-- edge_sync_audit (écriture de l'audit), check_balanced (fonction du grand livre passée DEFINER).

-- 1. check_balanced ---------------------------------------------------------------------------------------------
ALTER FUNCTION check_balanced() SECURITY DEFINER SET search_path = public, pg_temp;
REVOKE ALL ON FUNCTION check_balanced() FROM PUBLIC;

-- 2a. Curseur du registre ---------------------------------------------------------------------------------------
CREATE FUNCTION edge_sync_cursor(p_gateway uuid)
RETURNS TABLE (contiguous_edge_seq bigint, last_chain_hash bytea)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE g edge_gateway%ROWTYPE;
BEGIN
  g := edge_bind_gateway(p_gateway, false);
  RETURN QUERY SELECT g.contiguous_edge_seq, g.last_chain_hash;
END $$;
REVOKE ALL ON FUNCTION edge_sync_cursor(uuid) FROM PUBLIC;

-- 2b. Clé publique d'un terminal de l'événement de la passerelle (jamais d'un autre événement) -------------------
CREATE FUNCTION edge_sync_device_key(p_gateway uuid, p_serial text)
RETURNS TABLE (device_id uuid, public_key bytea, status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE g edge_gateway%ROWTYPE;
BEGIN
  g := edge_bind_gateway(p_gateway, false);
  RETURN QUERY
    SELECT d.id, d.public_key, d.status::text
      FROM device d
     WHERE d.serial = p_serial AND d.event_id = g.event_id AND d.operator_id = g.operator_id
     ORDER BY (d.status <> 'REVOKED') DESC, d.id
     LIMIT 1;
END $$;
REVOKE ALL ON FUNCTION edge_sync_device_key(uuid, text) FROM PUBLIC;

-- 2c. Résultats mémorisés d'un lot de CETTE passerelle ------------------------------------------------------------
CREATE FUNCTION edge_sync_results(p_gateway uuid, p_batch uuid)
RETURNS TABLE (edge_seq bigint, outcome text, reason text, detail text, transaction_id uuid, retryable boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE g edge_gateway%ROWTYPE;
BEGIN
  g := edge_bind_gateway(p_gateway, false);
  RETURN QUERY
    SELECT r.edge_seq, r.outcome, r.reason, r.detail, r.transaction_id, r.retryable
      FROM edge_sync_batch_result r
      JOIN edge_sync_batch b ON b.batch_id = r.batch_id
     WHERE r.batch_id = p_batch AND b.gateway_id = p_gateway AND b.operator_id = g.operator_id
     ORDER BY r.edge_seq;
END $$;
REVOKE ALL ON FUNCTION edge_sync_results(uuid, uuid) FROM PUBLIC;

-- 2d. Configuration des frais d'une vente --------------------------------------------------------------------------
-- Règle de commission du point de vente du terminal (portée PARTICIPATION, bénéficiaire ORG_COM, assiette
-- SALE_AMOUNT) en vigueur à la date de la vente (valid_from <= date < valid_to, version la plus haute), taux de taxe du
-- profil de législation (la taxe unique du profil, ou VAT s'il en porte plusieurs, comme SqlConfigResolver), comptes
-- du commerçant, de la commission et de la taxe DANS LE GRAND LIVRE DE LA PASSERELLE. Aucune ligne : terminal ou
-- point de vente inconnus, ou aucune règle (aucun frais). Le calcul reste dans `@cashless/shared-rules` (API).
CREATE FUNCTION edge_fee_config(p_gateway uuid, p_serial text, p_at timestamptz)
RETURNS TABLE (participation_id uuid, rule_id uuid, rate_bps integer, fixed_amount bigint, min_amount bigint,
               max_amount bigint, tax_bps integer, merchant_account_id uuid, org_com_account_id uuid,
               org_tax_account_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE g edge_gateway%ROWTYPE; ev event%ROWTYPE; lg uuid; v_part uuid; fr fee_rule%ROWTYPE;
        v_taxes jsonb; v_tax jsonb; v_bps integer := 0; v_n integer;
        v_merchant uuid; v_com uuid; v_taxacc uuid;
BEGIN
  g := edge_bind_gateway(p_gateway, false);
  IF p_serial IS NULL OR p_at IS NULL THEN
    RAISE EXCEPTION 'Configuration des frais : terminal et date exigés' USING ERRCODE = 'CL001';
  END IF;
  lg := edge_ledger_of_gateway(p_gateway);
  SELECT pos.participation_id INTO v_part
    FROM device d JOIN point_of_sale pos ON pos.id = d.pos_id
   WHERE d.serial = p_serial AND d.event_id = g.event_id AND d.operator_id = g.operator_id
   ORDER BY (d.status <> 'REVOKED') DESC, d.id LIMIT 1;
  IF lg IS NULL OR v_part IS NULL THEN RETURN; END IF;
  SELECT * INTO ev FROM event WHERE id = g.event_id AND operator_id = g.operator_id;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT f.* INTO fr FROM fee_rule f
   WHERE f.scope_type = 'PARTICIPATION' AND f.scope_id = v_part
     AND f.beneficiary_purpose = 'ORG_COM' AND f.basis = 'SALE_AMOUNT'
     AND f.valid_from <= p_at AND (f.valid_to IS NULL OR f.valid_to > p_at)
   ORDER BY f.version DESC, f.valid_from DESC, f.id LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT jp.rules -> 'taxes' INTO v_taxes FROM jurisdiction_profile jp WHERE jp.id = ev.jurisdiction_id;
  IF v_taxes IS NOT NULL AND jsonb_typeof(v_taxes) = 'object' THEN
    SELECT count(*) INTO v_n FROM jsonb_object_keys(v_taxes);
    IF v_n = 1 THEN SELECT e.value INTO v_tax FROM jsonb_each(v_taxes) e;
    ELSIF v_n > 1 THEN v_tax := v_taxes -> 'VAT';
      IF v_tax IS NULL THEN
        RAISE EXCEPTION 'Configuration : plusieurs taxes au profil de législation, aucune nommée VAT'
          USING ERRCODE = 'CL001';
      END IF;
    END IF;
  END IF;
  IF v_tax IS NOT NULL THEN
    IF jsonb_typeof(v_tax -> 'rate_bps') IS DISTINCT FROM 'number'
       OR (v_tax ->> 'rate_bps') !~ '^[0-9]{1,5}$' THEN
      RAISE EXCEPTION 'Configuration : taux de taxe du profil de législation invalide' USING ERRCODE = 'CL001';
    END IF;
    v_bps := (v_tax ->> 'rate_bps')::integer;
  END IF;
  SELECT a.id INTO v_merchant FROM account a
   WHERE a.ledger_id = lg AND a.purpose = 'MERCHANT' AND a.participation_id = v_part;
  SELECT a.id INTO v_com FROM account a
   WHERE a.ledger_id = lg AND a.purpose = 'ORG_COM' AND a.owner_party_id = ev.organizer_id;
  SELECT a.id INTO v_taxacc FROM account a
   WHERE a.ledger_id = lg AND a.purpose = 'ORG_TAX' AND a.owner_party_id = ev.organizer_id;
  RETURN QUERY SELECT v_part, fr.id, fr.rate_bps, fr.fixed_amount, fr.min_amount, fr.max_amount, v_bps,
                      v_merchant, v_com, v_taxacc;
EXCEPTION WHEN too_many_rows THEN
  RAISE EXCEPTION 'Configuration : compte de frais ambigu' USING ERRCODE = 'CL001';
END $$;
REVOKE ALL ON FUNCTION edge_fee_config(uuid, text, timestamptz) FROM PUBLIC;

-- 2e. Audit : trois actions, rien d'autre -------------------------------------------------------------------------
-- Alertes de chaîne et de signature (avant l'ouverture du lot) et ordres locaux versés. Un ordre local déjà audité
-- (même lot, même `order_sha256`) n'est pas répété (reprise d'un lot interrompu). Taille du détail bornée.
CREATE FUNCTION edge_sync_audit(p_gateway uuid, p_action text, p_batch uuid, p_detail jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE g edge_gateway%ROWTYPE; v_sha text;
BEGIN
  g := edge_bind_gateway(p_gateway, false);
  IF p_action IS NULL OR p_action NOT IN ('EDGE_CHAIN_BROKEN', 'EDGE_BATCH_SIGNATURE_INVALID',
                                          'EDGE_LOCAL_ORDER_RECORDED') THEN
    RAISE EXCEPTION 'Audit de réception : action inconnue' USING ERRCODE = 'CL001';
  END IF;
  IF p_batch IS NULL OR p_detail IS NULL OR jsonb_typeof(p_detail) <> 'object'
     OR pg_column_size(p_detail) > 8192 THEN
    RAISE EXCEPTION 'Audit de réception : lot et détail (objet de 8 Kio au plus) exigés' USING ERRCODE = 'CL001';
  END IF;
  v_sha := p_detail ->> 'order_sha256';
  IF p_action = 'EDGE_LOCAL_ORDER_RECORDED' AND v_sha IS NOT NULL AND EXISTS (
       SELECT 1 FROM audit_log a
        WHERE a.operator_id = g.operator_id AND a.action = p_action AND a.object_id = p_gateway::text
          AND a.after ->> 'batch_id' = p_batch::text AND a.after #>> '{detail,order_sha256}' = v_sha) THEN
    RETURN;
  END IF;
  INSERT INTO audit_log (operator_id, actor_id, actor_role, action, object_type, object_id, after, origin)
  VALUES (g.operator_id, NULL, session_user::text, p_action, 'EDGE_GATEWAY', p_gateway::text,
          jsonb_build_object('batch_id', p_batch, 'detail', p_detail), 'edge');
END $$;
REVOKE ALL ON FUNCTION edge_sync_audit(uuid, text, uuid, jsonb) FROM PUBLIC;

-- 2f. Preuve du bracelet (A SOUMETTRE AU PORTEUR : hors liste de la décision 39) ----------------------------------
-- Vrai seulement si l'empreinte SHA-256 de la signature reçue est celle enregistrée à la personnalisation
-- (`media.originality_sig_sha256`, même règle que `register_tap`) pour ce bracelet (token_hash ET UID) d'un
-- portefeuille DU GRAND LIVRE DE LA PASSERELLE. Booléen seul : aucune empreinte, aucun identifiant n'est rendu.
CREATE FUNCTION edge_tap_proof(p_gateway uuid, p_token_hash bytea, p_nfc_uid bytea, p_signature bytea)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE g edge_gateway%ROWTYPE; lg uuid;
BEGIN
  g := edge_bind_gateway(p_gateway, false);
  IF p_token_hash IS NULL OR octet_length(p_token_hash) <> 32 OR p_nfc_uid IS NULL OR octet_length(p_nfc_uid) <> 7
     OR p_signature IS NULL OR octet_length(p_signature) > 1024 THEN
    RETURN false;
  END IF;
  lg := edge_ledger_of_gateway(p_gateway);
  RETURN coalesce((SELECT m.originality_sig_sha256 IS NOT NULL AND m.originality_sig_sha256 = sha256(p_signature)
                     FROM media m JOIN wallet w ON w.id = m.wallet_id
                    WHERE m.token_hash = p_token_hash AND m.nfc_uid = p_nfc_uid
                      AND m.operator_id = g.operator_id AND w.ledger_id = lg), false);
END $$;
REVOKE ALL ON FUNCTION edge_tap_proof(uuid, bytea, bytea, bytea) FROM PUBLIC;
