-- 0090 : une attribution de vente ne désigne que le vendeur de sa session (OP-N79, mission 11a, WP01).
-- Avant : sale_attribution_session_fk (0033) lie (session, terminal, prestataire) mais rien ne liait
-- vendor_id à la session : seule la couche API le garantissait. Désormais la base refuse
-- (vendor_session_id = S, vendor_id = V) quand S appartient à un autre vendeur.
-- sale_attribution_session_fk est conservée (approval_token_use imite sa cible). Les attributions de
-- back-office (vendeur et session nuls, CHECK « tout ou rien ») échappent à la clé composite
-- (MATCH SIMPLE). Aucun GRANT, aucun REVOKE.

DO $$
DECLARE v_bad bigint;
BEGIN
  SELECT count(*) INTO v_bad
    FROM sale_attribution a JOIN vendor_session s ON s.id = a.vendor_session_id
   WHERE a.vendor_id IS DISTINCT FROM s.vendor_id;
  IF v_bad <> 0 THEN
    RAISE EXCEPTION '0090 : % attributions incohérentes', v_bad USING ERRCODE = 'CL001';
  END IF;
END $$;

ALTER TABLE vendor_session
  ADD CONSTRAINT vendor_session_id_vendor_key UNIQUE (id, vendor_id);

ALTER TABLE sale_attribution
  ADD CONSTRAINT sale_attribution_session_vendor_fk FOREIGN KEY (vendor_session_id, vendor_id)
  REFERENCES vendor_session (id, vendor_id);
