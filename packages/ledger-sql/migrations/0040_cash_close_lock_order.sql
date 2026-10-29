-- Migration 0040 : interblocage fermeture de session / recharges espèces (mission
-- recharges-caisses-psp, lot WP14 cycle 2 ; décision du porteur du 29/10/2026 ; NFR-008).
--
-- Cause (journal PostgreSQL, deadlock_timeout 1 s). Une recharge espèces prend le terminal
-- FOR UPDATE en première instruction (ordre global des verrous : terminal en tête), puis le solde
-- de la caisse (post_transaction). `begin_cash_close` (0036) prenait la session puis le solde de la
-- caisse SANS le terminal, et la transaction de fermeture gardait ce solde jusqu'à
-- `finish_cash_close`, dont l'UPDATE de la session (déjà modifiée dans la même transaction) revérifie
-- la clé étrangère `cash_session.device_id` : FOR KEY SHARE sur le terminal, bloqué par le
-- FOR UPDATE d'une recharge qui, elle, attendait le solde tenu par la fermeture. Cycle :
-- recharge (terminal, attend solde) <-> fermeture (solde, attend terminal).
--
-- Correction. `begin_cash_close` verrouille le terminal de la session FOR NO KEY UPDATE avant la
-- session et le solde : ordre terminal -> session -> solde, celui de la recharge. Aucun droit
-- modifié (CREATE OR REPLACE conserve signature et droits). Renforce la cohérence, rien d'élargi.
--
-- Fonction à faire relire par une personne : begin_cash_close (SECURITY DEFINER, chemin de verrous).

CREATE OR REPLACE FUNCTION begin_cash_close(p_session uuid, p_closer uuid)
RETURNS TABLE (cash_session_id uuid, cash_account_id uuid, account_code text, ledger_id uuid,
               event_id uuid, device_id uuid, counted_amount bigint, expected_amount bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE
  v_operator uuid := nullif(current_setting('app.operator_id', true), '')::uuid;
  s cash_session%ROWTYPE;
  v_counted bigint;
  v_expected bigint;
  v_code text;
  v_device uuid;
BEGIN
  IF v_operator IS NULL OR p_session IS NULL THEN
    RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found';
  END IF;
  -- a0. Terminal de la session, verrouillé EN PREMIER (ordre global : terminal d'abord). Lecture de
  --     la session sans verrou pour connaître le terminal ; FOR NO KEY UPDATE exclut une recharge
  --     (qui prend le terminal FOR UPDATE en tête) sans gêner les clés étrangères des autres.
  SELECT cs.device_id INTO v_device FROM cash_session cs
   WHERE cs.cash_session_id = p_session AND cs.operator_id = v_operator;
  IF NOT FOUND THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  PERFORM 1 FROM device d WHERE d.id = v_device FOR NO KEY UPDATE;
  -- a. Session du prestataire, verrouillée.
  SELECT * INTO s FROM cash_session cs
   WHERE cs.cash_session_id = p_session AND cs.operator_id = v_operator FOR NO KEY UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  IF s.status <> 'OPEN' THEN
    RAISE EXCEPTION 'Session de caisse non ouverte' USING ERRCODE = 'CL029';
  END IF;
  -- b. Fermeur SUPERVISOR de l'événement.
  IF p_closer IS NULL
     OR NOT cash_actor_allowed(v_operator, s.event_id, p_closer, ARRAY['SUPERVISOR']) THEN
    RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found';
  END IF;
  -- c. Au moins un comptage ; le fermeur n'en a fait aucun ; le dernier est retenu.
  SELECT c.counted_amount INTO v_counted FROM cash_session_count c
   WHERE c.cash_session_id = s.cash_session_id ORDER BY c.count_no DESC LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Fermeture : aucun comptage' USING ERRCODE = 'CL029';
  END IF;
  IF EXISTS (SELECT 1 FROM cash_session_count c
              WHERE c.cash_session_id = s.cash_session_id AND c.counted_by = p_closer) THEN
    RAISE EXCEPTION 'Fermeture : le fermeur a compté cette session' USING ERRCODE = 'CL041';
  END IF;
  -- d. Théorique = solde de la caisse lu sous verrou (après la session, jamais avant).
  INSERT INTO account_balance (account_id, operator_id) VALUES (s.cash_account_id, v_operator)
  ON CONFLICT (account_id) DO NOTHING;
  SELECT b.balance INTO v_expected FROM account_balance b
   WHERE b.account_id = s.cash_account_id FOR UPDATE;
  -- e. Session -> CLOSING.
  UPDATE cash_session cs
     SET status = 'CLOSING', closed_by = p_closer, counted_amount = v_counted,
         expected_amount = v_expected
   WHERE cs.cash_session_id = s.cash_session_id AND cs.operator_id = v_operator;
  SELECT a.code INTO v_code FROM account a WHERE a.id = s.cash_account_id;
  RETURN QUERY SELECT s.cash_session_id, s.cash_account_id, v_code, s.ledger_id, s.event_id,
                      s.device_id, v_counted, v_expected;
END $$;

