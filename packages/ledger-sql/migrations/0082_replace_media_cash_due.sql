-- Mission remboursements (9a), WP02, FR-018 (OP-N55) : `replace_media` fait suivre au bracelet neuf les espèces dues
-- encore ouvertes de l'ancien (anomalies CASH_TOPUP_OVER_LIMIT au statut OPEN, même prestataire). Sans cela,
-- `refund_cash_due(ancien)` rendrait la somme à un bracelet sans portefeuille, et le neuf ne verrait rien.
--
-- Corps de `replace_media` identique à `schema_grand_livre_cashless.sql` (l. 1399-1441), avec deux différences :
--   1. `SET search_path = public, pg_temp` (règle de 0021 : un CREATE OR REPLACE efface le réglage) ;
--   2. une seule instruction ajoutée (UPDATE anomaly), avec les autres mises à jour du bracelet neuf.
-- `status` n'est pas touché : `anomaly_cash_due_guard` (BEFORE UPDATE OF status) ne se déclenche pas et reste le
-- seul chemin de clôture. Aucune écriture comptable : `L-ESP-A-RENDRE` ne bouge pas. Aucun GRANT : CREATE OR REPLACE
-- garde les droits existants. Aucune fonction nouvelle.
-- Verrou : `replace_media` et `refund_cash_due` prennent le même verrou de ligne du bracelet (FOR UPDATE sur media).
CREATE OR REPLACE FUNCTION replace_media(p_old uuid, p_new uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE o media%ROWTYPE; n media%ROWTYPE; bo media_batch%ROWTYPE; bn media_batch%ROWTYPE;
BEGIN
  PERFORM assert_tenant(tenant_of_media(p_old)); PERFORM assert_tenant(tenant_of_media(p_new));   -- cloisonnement : l'objet doit appartenir au prestataire de la session
  SELECT * INTO o FROM media WHERE id = p_old FOR UPDATE;
  SELECT * INTO n FROM media WHERE id = p_new FOR UPDATE;
  IF o.wallet_id IS NULL THEN RAISE EXCEPTION 'L''ancien bracelet n''a pas de portefeuille' USING ERRCODE = 'CL020'; END IF;
  -- Contrôles d'état (revue 2, M5) : on remplace un bracelet en service ou déclaré perdu, par un bracelet neuf
  IF o.status NOT IN ('ACTIVE','SUSPENDED') THEN
    RAISE EXCEPTION 'Remplacement impossible : ancien bracelet %', o.status USING ERRCODE = 'CL020';
  END IF;
  IF n.status NOT IN ('PERSONALIZED','ISSUED') OR n.wallet_id IS NOT NULL OR n.deposit_status <> 'NONE' THEN
    RAISE EXCEPTION 'Le bracelet de remplacement doit être neuf (état %)', n.status USING ERRCODE = 'CL020';
  END IF;
  SELECT * INTO bo FROM media_batch WHERE id = o.batch_id;
  SELECT * INTO bn FROM media_batch WHERE id = n.batch_id;
  IF bn.organizer_id IS DISTINCT FROM bo.organizer_id THEN
    RAISE EXCEPTION 'Le bracelet de remplacement doit appartenir au même organisateur' USING ERRCODE = 'CL020';
  END IF;
  -- La caution suit le détenteur (DB-B2) : elle passe au nouveau bracelet, sinon elle ne pourrait plus être
  -- rendue ni acquise (l'ancien bracelet n'a plus de portefeuille). Même mode exigé pour la rendre correctement.
  IF o.deposit_status = 'HELD' AND bn.deposit_mode IS DISTINCT FROM bo.deposit_mode THEN
    RAISE EXCEPTION 'Caution détenue : le bracelet de remplacement doit venir d''un lot de même mode de caution'
      USING ERRCODE = 'CL020';
  END IF;
  IF o.deposit_status IN ('HELD','DUE') THEN
    UPDATE media SET deposit_status = o.deposit_status, deposit_held = o.deposit_held WHERE id = p_new;
    UPDATE media SET deposit_status = 'NONE', deposit_held = 0 WHERE id = p_old;
  END IF;
  UPDATE media SET status = 'REPLACED', wallet_id = NULL WHERE id = p_old;
  -- Pas d'activation : ni contrôle du mode d'activation, ni préchargement, ni écriture comptable (SPEC §6.1, §7.8)
  IF n.status = 'PERSONALIZED' THEN UPDATE media SET status = 'ISSUED' WHERE id = p_new; END IF;
  UPDATE media SET wallet_id = o.wallet_id, status = 'ACTIVE' WHERE id = p_new;
  -- Espèces dues encore ouvertes (OP-N55) : elles suivent le détenteur. Ni RESOLVED, ni une autre nature, ni un autre prestataire.
  UPDATE anomaly SET media_id = p_new
   WHERE media_id = p_old AND kind = 'CASH_TOPUP_OVER_LIMIT' AND status = 'OPEN' AND operator_id = o.operator_id;
  INSERT INTO media_assignment (operator_id, media_id, wallet_id, currency, token_hash)
  SELECT operator_id, id, o.wallet_id, wallet_currency(o.wallet_id), token_hash FROM media WHERE id = p_new;
  -- Les portefeuilles des autres devises suivent aussi le nouveau bracelet
  INSERT INTO media_assignment (operator_id, media_id, wallet_id, currency, token_hash)
  SELECT a.operator_id, p_new, a.wallet_id, a.currency, (SELECT token_hash FROM media WHERE id = p_new)
    FROM media_assignment a WHERE a.media_id = p_old AND a.released_at IS NULL AND a.wallet_id <> o.wallet_id;
  UPDATE media_assignment SET released_at = now(), release_reason = 'REPLACED'
   WHERE media_id = p_old AND released_at IS NULL;
END $$;
