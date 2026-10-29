-- Migration 0042 : le déblocage par contestation ne lève jamais un blocage qui a aussi une autre
-- cause, quel que soit l'ordre des événements (mission recharges-caisses-psp, lot WP14 cycle 2 ;
-- décision du porteur du 29/10/2026 ; lève la limite résiduelle d'OP-N83 ; ADR-134 ; renforcement).
--
-- Limite de 0039. Elle évitait seulement « autre cause PUIS contestation ». Dans l'ordre inverse
-- (contestation PUIS perte, fraude, décision manuelle), l'autre cause ne laissait aucune trace :
-- `wallet.status` valait déjà BLOCKED, et le déblocage « contestation » remettait ACTIVE un
-- portefeuille encore bloqué pour l'autre cause.
--
-- Correction. `wallet.other_block` (boolean, faux par défaut) dit qu'une cause autre que la
-- contestation est active. Un déclencheur BEFORE INSERT OR UPDATE OF status le tient :
--   - toute écriture de BLOCKED (même sur un portefeuille déjà BLOCKED), insertion comprise, qui
--     n'annonce pas l'origine « contestation » (`app.wallet_block_origin`, posé localement par
--     `block_wallet_after_chargeback` autour de son seul UPDATE) pose `other_block` : un futur
--     chemin de blocage (perte, fraude) est pris en compte sans être modifié ;
--   - le retour à ACTIVE le remet à faux (le blocage a été levé par quelqu'un).
-- `unblock_wallet` refuse (CL029) si `other_block`. `block_wallet_after_chargeback` ne marque une
-- contestation sur un portefeuille déjà BLOCKED que si `other_block` est faux. Aucun droit élargi :
-- aucune fonction ni table nouvelle exécutable ou écrivable par `cashless_app` (le déclencheur est
-- SECURITY INVOKER, la colonne n'est écrite que par lui).
--
-- Limite (consignée : OP-N83) : un chemin qui lèverait SEULEMENT son blocage en écrivant ACTIVE alors
-- qu'une contestation reste marquée remet le portefeuille ACTIVE (comportement antérieur, voulu :
-- il s'agit d'un déblocage par une personne habilitée de l'autre cause).
--
-- Fonctions à faire relire par une personne : block_wallet_after_chargeback, unblock_wallet,
-- wallet_block_cause_guard (blocage de portefeuille, SECURITY DEFINER pour les deux premières).

ALTER TABLE wallet ADD COLUMN other_block boolean NOT NULL DEFAULT false;
-- Les portefeuilles déjà BLOCKED sans marqueur de contestation non levé le sont pour une autre cause.
UPDATE wallet w SET other_block = true
 WHERE w.status = 'BLOCKED' AND NOT EXISTS (
   SELECT 1 FROM psp_chargeback c JOIN psp_topup t ON t.psp_topup_id = c.psp_topup_id
    WHERE t.wallet_id = w.id AND c.wallet_blocked AND c.unblocked_by_request IS NULL);

CREATE FUNCTION wallet_block_cause_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'BLOCKED' THEN
    IF coalesce(current_setting('app.wallet_block_origin', true), '') <> 'CHARGEBACK' THEN
      NEW.other_block := true;
    END IF;
  ELSIF NEW.status = 'ACTIVE' THEN
    NEW.other_block := false;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION wallet_block_cause_guard() FROM PUBLIC;
CREATE TRIGGER wallet_block_cause BEFORE INSERT OR UPDATE OF status ON wallet
  FOR EACH ROW EXECUTE FUNCTION wallet_block_cause_guard();

CREATE OR REPLACE FUNCTION block_wallet_after_chargeback(p_wallet uuid, p_chargeback uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE
  v_operator uuid := psp_session_operator();
  cb psp_chargeback%ROWTYPE;
  w wallet%ROWTYPE;
  v_by_chargeback boolean;
BEGIN
  IF p_wallet IS NULL OR p_chargeback IS NULL THEN
    RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found';
  END IF;
  SELECT * INTO cb FROM psp_chargeback c
   WHERE c.psp_chargeback_id = p_chargeback AND c.operator_id = v_operator FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  IF NOT EXISTS (SELECT 1 FROM psp_topup t WHERE t.psp_topup_id = cb.psp_topup_id
                    AND t.wallet_id = p_wallet AND t.operator_id = v_operator) THEN
    RAISE EXCEPTION 'Contestation d''un autre portefeuille' USING ERRCODE = 'CL044';
  END IF;
  SELECT * INTO w FROM wallet x WHERE x.id = p_wallet AND x.operator_id = v_operator FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  IF w.status = 'CLOSED' THEN
    RAISE EXCEPTION 'Portefeuille clos : blocage impossible' USING ERRCODE = 'CL044';
  END IF;
  IF w.status = 'ACTIVE' THEN
    -- Origine annoncée au déclencheur de cause : ce blocage est celui de la contestation.
    PERFORM set_config('app.wallet_block_origin', 'CHARGEBACK', true);
    UPDATE wallet SET status = 'BLOCKED' WHERE id = p_wallet;
    PERFORM set_config('app.wallet_block_origin', '', true);
    v_by_chargeback := true;
  ELSE
    -- Déjà BLOCKED : dû à une contestation seulement si aucune autre cause n'est active ET si l'une
    -- des contestations porte déjà le marqueur non levé (la contestation elle-même, ou une autre).
    v_by_chargeback := NOT w.other_block AND (cb.wallet_blocked OR EXISTS (
      SELECT 1 FROM psp_chargeback c JOIN psp_topup t ON t.psp_topup_id = c.psp_topup_id
       WHERE t.wallet_id = p_wallet AND t.operator_id = v_operator
         AND c.wallet_blocked AND c.unblocked_by_request IS NULL
         AND c.psp_chargeback_id <> cb.psp_chargeback_id));
  END IF;
  IF v_by_chargeback THEN
    UPDATE psp_chargeback SET wallet_blocked = true, blocked_at = coalesce(blocked_at, clock_timestamp())
     WHERE psp_chargeback_id = cb.psp_chargeback_id;
  END IF;
END $$;
REVOKE ALL ON FUNCTION block_wallet_after_chargeback(uuid, uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION unblock_wallet(p_wallet uuid, p_request uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE
  v_operator uuid := psp_session_operator();
  r approval_request%ROWTYPE;
  w wallet%ROWTYPE;
  v_organizer uuid;
  v_latest timestamptz;
BEGIN
  IF p_wallet IS NULL OR p_request IS NULL THEN
    RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found';
  END IF;
  SELECT * INTO r FROM approval_request a WHERE a.id = p_request AND a.operator_id = v_operator
    FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  SELECT * INTO w FROM wallet x WHERE x.id = p_wallet AND x.operator_id = v_operator FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  SELECT e.organizer_id INTO v_organizer FROM ledger l JOIN event e ON e.id = l.scope_id
   WHERE l.id = w.ledger_id AND l.scope_type = 'EVENT' AND e.operator_id = v_operator;
  IF v_organizer IS NULL THEN
    RAISE EXCEPTION 'Déblocage : portefeuille hors d''un événement' USING ERRCODE = 'CL023';
  END IF;
  IF r.action <> 'WALLET_UNBLOCK' OR r.status <> 'APPROVED'
     OR r.payload ->> 'wallet_id' IS DISTINCT FROM p_wallet::text
     OR r.decided_by IS NULL OR r.decided_by = r.requested_by
     OR r.decided_at IS NULL THEN
    RAISE EXCEPTION 'Déblocage : demande absente, non approuvée, sans rapport ou décidée par son auteur'
      USING ERRCODE = 'CL023';
  END IF;
  IF NOT psp_organizer_admin(v_operator, v_organizer, r.requested_by)
     OR NOT psp_organizer_admin(v_operator, v_organizer, r.decided_by) THEN
    RAISE EXCEPTION 'Déblocage : auteur et valideur, deux ORGANIZER_ADMIN actifs de l''organisateur'
      USING ERRCODE = 'CL023';
  END IF;
  SELECT max(c.blocked_at) INTO v_latest FROM psp_chargeback c
    JOIN psp_topup t ON t.psp_topup_id = c.psp_topup_id
   WHERE t.wallet_id = p_wallet AND c.wallet_blocked AND c.unblocked_by_request IS NULL;
  IF w.status <> 'BLOCKED' OR v_latest IS NULL THEN
    RAISE EXCEPTION 'Déblocage : portefeuille non bloqué par une contestation' USING ERRCODE = 'CL029';
  END IF;
  IF w.other_block THEN
    RAISE EXCEPTION 'Déblocage : portefeuille aussi bloqué pour une autre cause' USING ERRCODE = 'CL029';
  END IF;
  IF r.decided_at <= v_latest THEN
    RAISE EXCEPTION 'Déblocage : demande antérieure au dernier blocage' USING ERRCODE = 'CL029';
  END IF;
  UPDATE wallet SET status = 'ACTIVE' WHERE id = p_wallet;
  UPDATE psp_chargeback c SET unblocked_by_request = p_request
   WHERE c.wallet_blocked AND c.unblocked_by_request IS NULL
     AND c.psp_topup_id IN (SELECT t.psp_topup_id FROM psp_topup t WHERE t.wallet_id = p_wallet);
END $$;
REVOKE ALL ON FUNCTION unblock_wallet(uuid, uuid) FROM PUBLIC;
