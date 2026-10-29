-- Migration 0041 : retrait de l'accès direct de `cashless_app` à take_deposit, refund_deposit et
-- refund_cash_due (mission recharges-caisses-psp, lot WP14 cycle 2 ; décision du porteur du
-- 29/10/2026 ; lève OP-N84, ADR-135 ; renforcement de la sécurité).
--
-- Dette levée. Les trois fonctions du schéma de référence prennent un compte d'argent choisi par
-- l'appelant : accordées à `cashless_app` (section 4 de post-roles.sql) elles permettaient de
-- désigner n'importe quel compte, caisse comprise, sans passer par la session (A8). Les variantes
-- `take_deposit_for_session`, `refund_deposit_for_session` et `refund_cash_due_for_session`
-- (0036) tirent le compte de la session ; il manquait seulement la caution prélevée sur le solde
-- (mode FROM_BALANCE) et le rendu d'une caution restée due, qui ne désignent aucun compte.
--
-- Fonctions ajoutées (SECURITY DEFINER, aucun paramètre de compte) :
--   take_deposit_from_balance(media)   -> take_deposit(media, NULL)
--   refund_deposit_from_balance(media) -> refund_deposit(media, NULL)
-- Le compte étant NULL, les fonctions du schéma refusent (CL001) toute caution payée à part
-- (SEPARATE) : seul le mode FROM_BALANCE (débit/crédit du portefeuille du détenteur) passe. Le droit
-- accordé est donc plus étroit que celui retiré. Aucun GRANT/REVOKE ici (convention des migrations) :
-- le retrait des trois signatures (section 4) et l'accord des deux nouvelles (section 7c) sont dans
-- post-roles.sql, rejoué après chaque migration.
--
-- Fonctions à faire relire par une personne : take_deposit_from_balance,
-- refund_deposit_from_balance (SECURITY DEFINER, droits d'exécution).

CREATE FUNCTION take_deposit_from_balance(p_media uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM assert_tenant(tenant_of_media(p_media));
  RETURN take_deposit(p_media, NULL);
END $$;
REVOKE ALL ON FUNCTION take_deposit_from_balance(uuid) FROM PUBLIC;

CREATE FUNCTION refund_deposit_from_balance(p_media uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM assert_tenant(tenant_of_media(p_media));
  PERFORM refund_deposit(p_media, NULL);
END $$;
REVOKE ALL ON FUNCTION refund_deposit_from_balance(uuid) FROM PUBLIC;
