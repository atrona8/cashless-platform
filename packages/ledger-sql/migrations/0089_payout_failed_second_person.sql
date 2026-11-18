-- Mission 9b, décision 18 (17/11/2026, revue post-fusion RISK-1) : seconde personne pour PAYOUT_FAILED.
-- Un échec recrédite le droit : il est écrit par une personne distincte du préparateur (payout.initiated_by) et du
-- valideur (payout.approved_by) du lot, sinon CL041 (403 FORBIDDEN côté API). Elle est le valideur de la transaction
-- BACKOFFICE ; l'auteur est le préparateur. CONFIRMED reste à une personne (inchangé). Renforcement, amende FR-012.
-- 0085 est fusionnée : la fonction est redéfinie ici (mêmes signature, propriétaire et droits ; CREATE OR REPLACE).
-- Fonction à faire relire : settle_payout.

CREATE OR REPLACE FUNCTION settle_payout(p_payout uuid, p_outcome text, p_ref text, p_reason text, p_actor uuid)
RETURNS payout LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  po payout%ROWTYPE;
  lg ledger%ROWTYPE;
  v_ref text := nullif(btrim(coalesce(p_ref, '')), '');
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_pending uuid; v_credit uuid; v_money text; v_tx uuid; v_approver uuid; v_author uuid; v_event uuid;
BEGIN
  SELECT * INTO po FROM payout WHERE id = p_payout;
  IF NOT FOUND THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  PERFORM assert_tenant(po.operator_id);
  -- Décision 18 : un échec recrédite le droit ; il est écrit par une personne qui n'a ni préparé ni validé le lot.
  IF p_outcome = 'FAILED' AND p_actor IN (po.initiated_by, po.approved_by) THEN
    RAISE EXCEPTION 'Un échec ne peut être déclaré par la personne qui a préparé ou validé le lot'
      USING ERRCODE = 'CL041';
  END IF;
  IF p_outcome IS NULL OR p_outcome NOT IN ('CONFIRMED', 'FAILED') OR p_actor IS NULL THEN
    RAISE EXCEPTION 'Règlement : résultat et acteur requis (CONFIRMED ou FAILED)' USING ERRCODE = 'CL001';
  END IF;
  IF p_outcome = 'CONFIRMED' AND v_ref IS NULL THEN
    RAISE EXCEPTION 'Règlement confirmé : référence externe requise' USING ERRCODE = 'CL001';
  END IF;
  IF p_outcome = 'FAILED' AND v_reason IS NULL THEN
    RAISE EXCEPTION 'Règlement échoué : motif requis' USING ERRCODE = 'CL001';
  END IF;

  -- Verrous : autorité (partagé), compte recrédité, puis ligne payout
  PERFORM pg_advisory_xact_lock_shared(hashtextextended('debit-authority:' || po.ledger_id, 0));
  IF p_outcome = 'FAILED' AND po.origin_account_id IS NOT NULL THEN
    PERFORM 1 FROM account WHERE id = po.origin_account_id FOR NO KEY UPDATE;
  END IF;
  SELECT * INTO po FROM payout WHERE id = p_payout FOR UPDATE;

  IF po.status <> 'INITIATED' THEN
    IF po.status = p_outcome AND (
         (p_outcome = 'CONFIRMED' AND po.external_ref IS NOT DISTINCT FROM v_ref)
         OR (p_outcome = 'FAILED' AND po.failure_reason IS NOT DISTINCT FROM v_reason)) THEN
      RETURN po;                                   -- rejeu identique
    END IF;
    RAISE EXCEPTION 'Versement déjà réglé (%) : un autre résultat est refusé', po.status USING ERRCODE = 'CL029';
  END IF;

  SELECT * INTO lg FROM ledger WHERE id = po.ledger_id;
  SELECT id INTO v_pending FROM account
   WHERE ledger_id = po.ledger_id AND code = 'L-VERS-ENCOURS' AND is_active;
  IF v_pending IS NULL THEN
    RAISE EXCEPTION 'Compte des versements en cours absent du grand livre' USING ERRCODE = 'CL001';
  END IF;
  IF p_outcome = 'CONFIRMED' THEN
    v_money := CASE po.method WHEN 'BANK_TRANSFER' THEN 'A-BANQUE' WHEN 'WAVE' THEN 'A-PSP-WAVE'
                              WHEN 'ORANGE_MONEY' THEN 'A-PSP-OM' END;
    SELECT id INTO v_credit FROM account
     WHERE ledger_id = po.ledger_id AND code = v_money AND is_active;
    IF v_credit IS NULL THEN
      RAISE EXCEPTION 'Compte d''argent du moyen absent du grand livre' USING ERRCODE = 'CL001';
    END IF;
  ELSE
    v_credit := po.origin_account_id;
    IF v_credit IS NULL THEN
      RAISE EXCEPTION 'Versement sans compte d''origine : recrédit impossible' USING ERRCODE = 'CL001';
    END IF;
  END IF;

  -- Deux personnes distinctes exigées par journal_transaction (BACKOFFICE).
  --   CONFIRMED : acteur + valideur du lot (l'initiateur si l'acteur est le valideur), comme en 0085.
  --   FAILED (décision 18) : le valideur réel est l'acteur (tiers au lot) ; l'auteur est le préparateur du lot, dont
  --   l'écriture d'origine est annulée.
  IF p_outcome = 'FAILED' THEN
    v_author := po.initiated_by; v_approver := p_actor;
  ELSE
    v_author := p_actor;
    v_approver := CASE WHEN p_actor = po.approved_by THEN po.initiated_by ELSE po.approved_by END;
  END IF;
  v_event := CASE WHEN lg.scope_type = 'EVENT' THEN lg.scope_id END;
  v_tx := post_transaction(po.ledger_id, CASE p_outcome WHEN 'CONFIRMED' THEN 'PAYOUT_CONFIRMED' ELSE 'PAYOUT_FAILED' END,
                           'payout:' || po.id || ':settle', clock_timestamp(), 'BACKOFFICE',
                           jsonb_build_array(
                             jsonb_build_object('account_id', v_pending, 'amount', po.amount,
                               'memo', CASE p_outcome WHEN 'CONFIRMED' THEN 'Versement confirmé'
                                                      ELSE 'Versement échoué' END),
                             jsonb_build_object('account_id', v_credit, 'amount', -po.amount,
                               'memo', CASE p_outcome WHEN 'CONFIRMED' THEN 'Versement confirmé'
                                                      ELSE 'Échec : montant recrédité au bénéficiaire' END)),
                           v_event, NULL, v_author, v_approver, NULL, NULL, NULL,
                           jsonb_build_object('payout_id', po.id));
  UPDATE payout SET status = p_outcome, external_ref = v_ref,
                    failure_reason = CASE p_outcome WHEN 'FAILED' THEN v_reason END,
                    settled_at = clock_timestamp(), settled_tx_id = v_tx,
                    confirmed_by = p_actor, confirmed_at = clock_timestamp()
   WHERE id = po.id
  RETURNING * INTO po;
  RETURN po;
END $$;
REVOKE ALL ON FUNCTION settle_payout(uuid, text, text, text, uuid) FROM PUBLIC;
