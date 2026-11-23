-- 0096 : fonctions d'identification (KYC) du festivalier, seule voie d'écriture de kyc_verification
-- (mission 10a, WP01). SECURITY DEFINER étroites : compte au numéro vérifié (CL060), agent qui n'est
-- pas titulaire (CL061), pièce non expirée, quatre derniers caractères seulement (CL062).
-- Cette migration n'accorde ni ne retire aucun droit (WP04 pose les EXECUTE) ; seuls les REVOKE
-- ... FROM PUBLIC des fonctions nouvelles. Le propriétaire ignore la RLS : chaque lecture ou écriture
-- nomme le prestataire de session ; un objet d'un autre prestataire répond no_data_found.
-- Codes : CL060 compte exigé (portefeuille sans client, ou client sans numéro vérifié) ; CL061 agent
-- titulaire du compte ; CL062 donnée de pièce, forme de l'appel ou motif invalide ; CL063
-- identification déjà révoquée. CL001 : auteur absent. Aucun message ne contient numéro, identifiant
-- d'agent ni chiffres de pièce.
-- Limite consignée C-005 : l'agent titulaire est détecté par égalité exacte de app_user.phone et de
-- customer_identity.phone ; un agent sans numéro ou avec un autre numéro n'est pas détecté (WP11).
-- À faire relire par une personne : create_kyc_verification, revoke_kyc_verification.

-- 1. create_kyc_verification ------------------------------------------------------------------------
-- Un et un seul de p_wallet, p_customer. Avec p_wallet : verrou du portefeuille, client du portefeuille.
-- Avec p_customer : wallet_id NULL dans la ligne. Ordre des contrôles testé.
CREATE FUNCTION create_kyc_verification(p_wallet uuid, p_customer uuid, p_id_type text,
                                        p_id_country text, p_id_last4 text, p_id_expires_on date,
                                        p_agent uuid) RETURNS kyc_verification
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_operator uuid := nullif(current_setting('app.operator_id', true), '')::uuid;
  v_customer uuid; v_phone text; v_agent_phone text;
  w wallet%ROWTYPE; r kyc_verification%ROWTYPE;
BEGIN
  IF v_operator IS NULL THEN
    RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found';
  END IF;
  IF (p_wallet IS NULL) = (p_customer IS NULL) THEN
    RAISE EXCEPTION 'Identification : un portefeuille ou un client, l''un des deux seulement'
      USING ERRCODE = 'CL062';
  END IF;
  IF p_wallet IS NOT NULL THEN
    SELECT * INTO w FROM wallet WHERE id = p_wallet AND operator_id = v_operator FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found';
    END IF;
    v_customer := w.customer_id;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM party WHERE id = p_customer AND kind = 'CUSTOMER'
                      AND operator_id = v_operator) THEN
      RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found';
    END IF;
    v_customer := p_customer;
  END IF;
  IF v_customer IS NULL THEN
    RAISE EXCEPTION 'Identification : compte festivalier exigé' USING ERRCODE = 'CL060';
  END IF;
  SELECT phone INTO v_phone FROM customer_identity
   WHERE customer_id = v_customer AND operator_id = v_operator;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Identification : compte festivalier exigé' USING ERRCODE = 'CL060';
  END IF;
  IF p_agent IS NULL THEN
    RAISE EXCEPTION 'Identification : agent absent' USING ERRCODE = 'CL001';
  END IF;
  -- Agent du prestataire de session, ou personne de la plateforme (operator_id NULL).
  SELECT phone INTO v_agent_phone FROM app_user
   WHERE id = p_agent AND (operator_id = v_operator OR operator_id IS NULL);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_agent_phone IS NOT NULL AND v_agent_phone = v_phone THEN
    RAISE EXCEPTION 'Identification : l''agent ne peut pas identifier son propre compte'
      USING ERRCODE = 'CL061';
  END IF;
  IF p_id_type IS NULL OR p_id_type NOT IN ('NATIONAL_ID','PASSPORT','RESIDENCE_PERMIT',
                                            'DRIVING_LICENCE','OTHER')
     OR p_id_country IS NULL OR p_id_country !~ '^[A-Z]{2}$'
     OR p_id_last4 IS NULL OR upper(p_id_last4) !~ '^[0-9A-Z]{1,4}$'
     OR p_id_expires_on IS NULL OR p_id_expires_on < current_date THEN
    RAISE EXCEPTION 'Identification : pièce invalide ou expirée' USING ERRCODE = 'CL062';
  END IF;
  INSERT INTO kyc_verification (operator_id, customer_id, wallet_id, method, agent_id, id_type,
                                id_country, id_last4, id_expires_on)
  VALUES (v_operator, v_customer, p_wallet, 'DESK', p_agent, p_id_type, p_id_country,
          upper(p_id_last4), p_id_expires_on)
  RETURNING * INTO r;
  RETURN r;
END $$;
REVOKE ALL ON FUNCTION create_kyc_verification(uuid, uuid, text, text, text, date, uuid)
  FROM PUBLIC;

-- 2. revoke_kyc_verification ------------------------------------------------------------------------
-- VERIFIED -> REVOKED ; seules status, revoked_at, revoked_by, revoked_reason changent (déclencheur
-- d'ajout seul). p_by est l'auteur de la demande ; le valideur est au journal d'audit de l'API.
CREATE FUNCTION revoke_kyc_verification(p_id uuid, p_by uuid, p_reason text)
RETURNS kyc_verification
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_operator uuid := nullif(current_setting('app.operator_id', true), '')::uuid;
  r kyc_verification%ROWTYPE;
BEGIN
  IF v_operator IS NULL THEN
    RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found';
  END IF;
  IF p_by IS NULL THEN
    RAISE EXCEPTION 'Révocation : auteur absent' USING ERRCODE = 'CL001';
  END IF;
  SELECT * INTO r FROM kyc_verification
   WHERE id = p_id AND operator_id = v_operator FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) < 10 THEN
    RAISE EXCEPTION 'Révocation : motif de 10 caractères au moins exigé' USING ERRCODE = 'CL062';
  END IF;
  IF r.status = 'REVOKED' THEN
    RAISE EXCEPTION 'Révocation : identification déjà révoquée' USING ERRCODE = 'CL063';
  END IF;
  UPDATE kyc_verification
     SET status = 'REVOKED', revoked_at = clock_timestamp(), revoked_by = p_by,
         revoked_reason = btrim(p_reason)
   WHERE id = p_id AND operator_id = v_operator
  RETURNING * INTO r;
  RETURN r;
END $$;
REVOKE ALL ON FUNCTION revoke_kyc_verification(uuid, uuid, text) FROM PUBLIC;
