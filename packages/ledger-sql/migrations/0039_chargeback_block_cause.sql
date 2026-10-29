-- Migration 0039 : le blocage par contestation ne s'attribue que le blocage qu'il a posé (mission
-- recharges-caisses-psp, lot WP14 ; décision du porteur du 29/10/2026 ; défaut de 0038 relevé par la
-- relecture de WP13 ; renforcement de la sécurité, ADR-134 ; CLAUDE.md règle 1).
--
-- Défaut corrigé. `block_wallet_after_chargeback` (0038) posait `psp_chargeback.wallet_blocked` même
-- quand le portefeuille était DÉJÀ `BLOCKED` pour une autre cause (perte, fraude, décision
-- manuelle). `unblock_wallet` se fonde sur ce marqueur pour remettre le portefeuille `ACTIVE` ; une
-- contestation à solde insuffisant arrivée sur un portefeuille bloqué pour une autre raison
-- ouvrait donc la voie du déblocage « contestation » (deux ORGANIZER_ADMIN) vers un portefeuille
-- que la contestation n'avait pas bloqué.
--
-- Correction. Le marqueur n'est posé que si le blocage vient de la contestation :
--   - portefeuille `ACTIVE` : bloqué ici, marqueur posé (comme avant) ;
--   - portefeuille déjà `BLOCKED` : marqueur posé seulement si une autre contestation du même
--     portefeuille porte déjà un marqueur non levé (blocage déjà dû à une contestation) ou si cette
--     contestation est déjà marquée (rejeu) ; sinon aucun marqueur : la contestation reste
--     enregistrée, son écriture CHARGEBACK aussi, mais `unblock_wallet` refuse (CL029, « non bloqué
--     par une contestation ») et le portefeuille reste `BLOCKED`.
--   - `CLOSED` : CL044, inchangé.
-- `unblock_wallet` est inchangée. Même signature, mêmes droits (CREATE OR REPLACE les conserve).
--
-- Limite résiduelle (consignée : OP-N83, ADR-134) : `wallet.status` ne porte pas la cause. Un
-- portefeuille bloqué PAR une contestation puis aussi pour une autre cause se remet `ACTIVE` par
-- le déblocage « contestation » (deux ORGANIZER_ADMIN). Levée : mission qui introduira la cause du
-- blocage sur le portefeuille.
--
-- Pourquoi une migration nouvelle plutôt qu'une retouche de 0038 : `ops.schema_migrations`
-- vérifie la somme de contrôle de chaque migration appliquée (migrate.ts) ; modifier 0038
-- ferait échouer toute base qui l'a déjà appliquée (bases de lots, `cashless_test`).
--
-- Fonction à faire relire par une personne : block_wallet_after_chargeback (SECURITY DEFINER).

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
    UPDATE wallet SET status = 'BLOCKED' WHERE id = p_wallet;
    v_by_chargeback := true;
  ELSE
    -- Déjà BLOCKED : dû à une contestation seulement si l'une d'elles porte déjà le marqueur.
    v_by_chargeback := cb.wallet_blocked OR EXISTS (
      SELECT 1 FROM psp_chargeback c JOIN psp_topup t ON t.psp_topup_id = c.psp_topup_id
       WHERE t.wallet_id = p_wallet AND t.operator_id = v_operator
         AND c.wallet_blocked AND c.unblocked_by_request IS NULL
         AND c.psp_chargeback_id <> cb.psp_chargeback_id);
  END IF;
  IF v_by_chargeback THEN
    UPDATE psp_chargeback SET wallet_blocked = true, blocked_at = coalesce(blocked_at, clock_timestamp())
     WHERE psp_chargeback_id = cb.psp_chargeback_id;
  END IF;
END $$;
REVOKE ALL ON FUNCTION block_wallet_after_chargeback(uuid, uuid) FROM PUBLIC;
