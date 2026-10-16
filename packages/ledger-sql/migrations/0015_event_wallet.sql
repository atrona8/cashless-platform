-- Migration 0015 — ouverture d'un portefeuille au grand livre d'un événement (mission bracelets-nfc, lot 15).
-- SPECIFICATION §5.2 : « les comptes DOIVENT être créés à la demande (… activation d'un portefeuille …) ». Le schéma
-- de référence n'a pas de fonction pour cela ; l'activation d'un bracelet au guichet en a besoin quand le festivalier
-- n'a pas encore de portefeuille. Crée le portefeuille (anonyme, ou d'un compte festivalier) et ses deux comptes :
-- crédits payés `L-WAL-<id>-P` et crédits offerts `L-WAL-<id>-X`, créditeurs, jamais négatifs, jamais « chauds ».
-- SECURITY INVOKER : les politiques du rôle appelant s'appliquent (prestataire de la session).
CREATE FUNCTION open_event_wallet(p_event uuid, p_customer uuid DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE v_operator uuid := media_session_operator(); v_ledger uuid; v_wallet uuid;
BEGIN
  SELECT l.id INTO v_ledger
    FROM event e JOIN ledger l ON l.scope_type = 'EVENT' AND l.scope_id = e.id
   WHERE e.id = p_event AND e.operator_id = v_operator;
  IF NOT FOUND THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  IF p_customer IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM party WHERE id = p_customer AND kind = 'CUSTOMER' AND operator_id = v_operator) THEN
    RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found';
  END IF;
  INSERT INTO wallet (operator_id, ledger_id, customer_id) VALUES (v_operator, v_ledger, p_customer) RETURNING id INTO v_wallet;
  INSERT INTO account (operator_id, ledger_id, code, family, purpose, wallet_id, normal_side, allow_negative, hot) VALUES
    (v_operator, v_ledger, 'L-WAL-' || v_wallet || '-P', 'CLAIM', 'WALLET_PAID',  v_wallet, 'C', false, false),
    (v_operator, v_ledger, 'L-WAL-' || v_wallet || '-X', 'CLAIM', 'WALLET_PROMO', v_wallet, 'C', false, false);
  RETURN v_wallet;
END $$;
