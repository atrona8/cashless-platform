-- WP25, T113 : `usable_on_edge` réévalué à CHAQUE activation (A05, R-24). Le déclencheur de edge-0003
-- ne partait que lorsque `activated_at` passait de NULL à une valeur : au second cycle (la valeur
-- reste posée entre deux cycles, elle passe d'une date à une autre), une session de caisse ouverte
-- avant la seconde bascule restait inutilisable (`409 NO_REPLICATED_CASH_SESSION`). Même règle
-- qu'au premier cycle : seules les sessions OUVERTES et ouvertes avant la bascule deviennent
-- utilisables ; une session ouverte après n'est jamais relevée. Aucun droit nouveau.
DROP TRIGGER edge_cash_session_activation ON edge_authority;
CREATE TRIGGER edge_cash_session_activation AFTER UPDATE OF activated_at ON edge_authority
  FOR EACH ROW WHEN (NEW.activated_at IS NOT NULL AND OLD.activated_at IS DISTINCT FROM NEW.activated_at)
  EXECUTE FUNCTION edge_cash_session_activation();
