-- Dettes de base de la 9a (mission 9b, lot WP04 ; FR-018, FR-019 ; OP-N130, OP-N128).
-- Objet :
--   1. OP-N130 : déclencheur `refund_request_transition_guard` (BEFORE UPDATE) : seules les transitions du graphe
--      de data-model.md passent ; montant et frais ne changent qu'au passage REQUESTED -> PROCESSING ; colonnes
--      d'identité immuables ; sans changement de statut, seuls approval_request_id et updated_at bougent.
--   2. OP-N128 : `refund_deposit(media, compte, auteur, valideur)` et `refund_deposit_for_session(media, session,
--      auteur, valideur)` transmettent l'auteur et le valideur à post_transaction (DEPOSIT_REFUNDED porte
--      created_by et approved_by). Les anciennes signatures sont conservées et délèguent avec NULL, NULL
--      (une mission ultérieure les retirera quand WP11 aura basculé l'appel TypeScript).
-- Décision : « figés après PROCESSING » (et non après REQUESTED) : l'approbation recalcule montant et frais au
-- passage REQUESTED -> PROCESSING (research.md, contradiction 3).
-- Aucun GRANT ici (WP06, post-roles.sql). Aucune garde d'insertion nouvelle (proposition de renforcement : un
-- INSERT direct en PAID reste possible sous les CHECK existants).
-- Fonctions à faire relire : refund_request_transition_guard, refund_deposit (4 arguments),
-- refund_deposit_for_session (4 arguments).

-- 1. OP-N130 : graphe de transitions ---------------------------------------------------------------------------------
CREATE FUNCTION refund_request_transition_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  -- Identité immuable à tout UPDATE.
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.operator_id IS DISTINCT FROM OLD.operator_id
     OR NEW.ledger_id IS DISTINCT FROM OLD.ledger_id
     OR NEW.event_id IS DISTINCT FROM OLD.event_id
     OR NEW.wallet_id IS DISTINCT FROM OLD.wallet_id
     OR NEW.customer_id IS DISTINCT FROM OLD.customer_id
     OR NEW.requested_by IS DISTINCT FROM OLD.requested_by
     OR NEW.method IS DISTINCT FROM OLD.method
     OR NEW.msisdn IS DISTINCT FROM OLD.msisdn
     OR NEW.iban IS DISTINCT FROM OLD.iban
     OR NEW.new_number IS DISTINCT FROM OLD.new_number
     OR NEW.currency IS DISTINCT FROM OLD.currency
     OR NEW.hold_until IS DISTINCT FROM OLD.hold_until
     OR NEW.extra_check_required IS DISTINCT FROM OLD.extra_check_required
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Demande de remboursement : colonne d''identité immuable' USING ERRCODE = 'CL029';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT ((OLD.status, NEW.status) IN (
          ('AWAITING_HOLDER', 'REQUESTED'), ('AWAITING_HOLDER', 'BLOCKED'),
          ('REQUESTED', 'PROCESSING'), ('REQUESTED', 'REJECTED'),
          ('PROCESSING', 'PAID'), ('PROCESSING', 'FAILED'))) THEN
      RAISE EXCEPTION 'Demande de remboursement : transition % -> % interdite', OLD.status, NEW.status
        USING ERRCODE = 'CL029';
    END IF;
    IF OLD.status = 'AWAITING_HOLDER' AND NEW.status = 'REQUESTED' THEN
      -- Décision du titulaire (CONFIRM), ou promotion à l'échéance (décision nulle).
      IF NOT coalesce(NEW.holder_decision = 'CONFIRM'
                      OR (NEW.holder_decision IS NULL AND OLD.hold_until <= clock_timestamp()), false) THEN
        RAISE EXCEPTION 'Demande de remboursement : promotion avant l''échéance sans décision'
          USING ERRCODE = 'CL029';
      END IF;
    END IF;
    IF NOT (OLD.status = 'REQUESTED' AND NEW.status = 'PROCESSING')
       AND (NEW.estimated_amount IS DISTINCT FROM OLD.estimated_amount OR NEW.fee IS DISTINCT FROM OLD.fee) THEN
      RAISE EXCEPTION 'Demande de remboursement : montant et frais figés hors du passage à PROCESSING'
        USING ERRCODE = 'CL029';
    END IF;
    RETURN NEW;
  END IF;

  -- Sans changement de statut : seuls approval_request_id et updated_at peuvent changer ; un état terminal ne
  -- change plus du tout (une écriture identique reste permise).
  IF OLD.status IN ('PAID', 'FAILED', 'REJECTED', 'BLOCKED', 'CANCELLED') THEN
    IF NEW IS DISTINCT FROM OLD THEN
      RAISE EXCEPTION 'Demande de remboursement : état terminal %, aucune modification', OLD.status
        USING ERRCODE = 'CL029';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.estimated_amount, NEW.fee, NEW.holder_decision, NEW.holder_decided_at, NEW.approved_by,
      NEW.transaction_id, NEW.external_reference, NEW.failure_reason, NEW.reject_reason,
      NEW.reversal_transaction_id, NEW.confirmed_by, NEW.confirmed_at)
     IS DISTINCT FROM
     (OLD.estimated_amount, OLD.fee, OLD.holder_decision, OLD.holder_decided_at, OLD.approved_by,
      OLD.transaction_id, OLD.external_reference, OLD.failure_reason, OLD.reject_reason,
      OLD.reversal_transaction_id, OLD.confirmed_by, OLD.confirmed_at) THEN
    RAISE EXCEPTION 'Demande de remboursement : seul le lien d''approbation change sans changement de statut'
      USING ERRCODE = 'CL029';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION refund_request_transition_guard() FROM PUBLIC;
CREATE TRIGGER refund_request_transition_guard BEFORE UPDATE ON refund_request
  FOR EACH ROW EXECUTE FUNCTION refund_request_transition_guard();

-- 2. OP-N128 : auteur et valideur jusqu'à post_transaction -------------------------------------------------------------
-- Corps de refund_deposit d'origine (schéma de référence), avec created_by / approved_by transmis.
CREATE FUNCTION refund_deposit(p_media uuid, p_money_account uuid, p_actor uuid, p_approver uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE d record; n int; credit_acc uuid;
BEGIN
  PERFORM assert_tenant(tenant_of_media(p_media));
  IF p_approver IS NOT NULL AND (p_actor IS NULL OR p_actor = p_approver) THEN
    RAISE EXCEPTION 'Rendu de caution : auteur obligatoire et distinct du valideur' USING ERRCODE = 'CL001';
  END IF;
  SELECT * INTO d FROM deposit_accounts(p_media);
  IF (d.m).deposit_status <> 'HELD' THEN
    IF (d.m).deposit_status = 'DUE' THEN UPDATE media SET deposit_status = 'NONE' WHERE id = p_media; END IF;
    RETURN;
  END IF;
  IF (d.b).deposit_mode = 'FROM_BALANCE' THEN credit_acc := d.acc_wallet;
  ELSE
    IF p_money_account IS NULL THEN
      RAISE EXCEPTION 'Caution payée à part : compte de remboursement requis' USING ERRCODE = 'CL001';
    END IF;
    credit_acc := p_money_account;
  END IF;
  SELECT count(*) INTO n FROM media_assignment WHERE media_id = p_media;
  PERFORM post_transaction(d.lg, 'DEPOSIT_REFUNDED', 'deposit-refund:' || p_media || ':' || n, now(), 'ONLINE',
    jsonb_build_array(
      jsonb_build_object('account_id', d.acc_deposit, 'amount', (d.m).deposit_held, 'memo', 'Rendu caution'),
      jsonb_build_object('account_id', credit_acc, 'amount', -(d.m).deposit_held, 'memo', 'Rendu caution')),
    p_created_by => p_actor, p_approved_by => p_approver);
  UPDATE media SET deposit_status = 'REFUNDED', deposit_held = 0 WHERE id = p_media;
END $$;
REVOKE ALL ON FUNCTION refund_deposit(uuid, uuid, uuid, uuid) FROM PUBLIC;

-- Ancienne signature : un seul corps, celle-ci délègue (même signature, mêmes droits conservés).
CREATE OR REPLACE FUNCTION refund_deposit(p_media uuid, p_money_account uuid DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM refund_deposit(p_media, p_money_account, NULL::uuid, NULL::uuid);
END $$;

CREATE FUNCTION refund_deposit_for_session(p_media uuid, p_session uuid, p_actor uuid, p_approver uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  s cash_session%ROWTYPE;
  v_ledger uuid;
  n int;
BEGIN
  PERFORM assert_tenant(tenant_of_media(p_media));
  SELECT w.ledger_id INTO v_ledger FROM media m JOIN wallet w ON w.id = m.wallet_id
   WHERE m.id = p_media;
  s := cash_session_usable(p_session, v_ledger);
  PERFORM refund_deposit(p_media, s.cash_account_id, p_actor, p_approver);
  SELECT count(*) INTO n FROM media_assignment WHERE media_id = p_media;
  PERFORM cash_session_attach_own(s, 'deposit-refund:' || p_media || ':' || n);
END $$;
REVOKE ALL ON FUNCTION refund_deposit_for_session(uuid, uuid, uuid, uuid) FROM PUBLIC;

-- Ancienne signature (0036) conservée : délègue avec auteur et valideur nuls.
CREATE OR REPLACE FUNCTION refund_deposit_for_session(p_media uuid, p_session uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM refund_deposit_for_session(p_media, p_session, NULL::uuid, NULL::uuid);
END $$;
