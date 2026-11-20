-- Migration 0092 : garde d'insertion des demandes de remboursement (mission durcissements-serveur, lot WP02 ;
-- FR-010, FR-011 ; plan IC-04). Une demande née par l'API n'a que son état initial ; la base, et non le code,
-- en est juge. Aucun droit accordé ni retiré ici (WP03).
-- Fonction à faire relire : refund_request_insert_guard.

-- 1. Garde. Non DEFINER : `current_user` est le rôle de la session. Elle ne vise que les membres de
--    cashless_app ; le propriétaire (fixtures, outils) insère des états finals sans entrave.
CREATE FUNCTION refund_request_insert_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  -- pg_has_role rend vrai pour tout superutilisateur (membre implicite de tous les rôles) : on l'écarte, sinon
  -- le propriétaire des fixtures serait visé. Un superutilisateur peut de toute façon désactiver le déclencheur.
  IF NOT EXISTS (SELECT 1 FROM pg_roles r, pg_roles me
                  WHERE r.rolname = 'cashless_app' AND me.rolname = current_user AND NOT me.rolsuper
                    AND pg_has_role(current_user, r.oid, 'MEMBER')) THEN
    RETURN NEW;
  END IF;
  IF NEW.status NOT IN ('AWAITING_HOLDER', 'REQUESTED')
     OR NEW.holder_decision IS NOT NULL OR NEW.holder_decided_at IS NOT NULL
     OR NEW.approval_request_id IS NOT NULL OR NEW.approved_by IS NOT NULL
     OR NEW.transaction_id IS NOT NULL OR NEW.external_reference IS NOT NULL
     OR NEW.failure_reason IS NOT NULL OR NEW.reject_reason IS NOT NULL
     OR NEW.reversal_transaction_id IS NOT NULL OR NEW.confirmed_by IS NOT NULL
     OR NEW.confirmed_at IS NOT NULL THEN
    RAISE EXCEPTION 'Demande de remboursement : insertion refusée hors état initial' USING ERRCODE = 'CL057';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION refund_request_insert_guard() FROM PUBLIC;

CREATE TRIGGER refund_request_insert_guard BEFORE INSERT ON refund_request
  FOR EACH ROW EXECUTE FUNCTION refund_request_insert_guard();

-- 2. Retrait de la surcharge à deux arguments (aucun appelant TypeScript : ledger-queries.ts appelle la forme à
--    quatre arguments). refund_deposit(uuid, uuid) et la surcharge à quatre arguments restent.
DROP FUNCTION refund_deposit_for_session(uuid, uuid);
