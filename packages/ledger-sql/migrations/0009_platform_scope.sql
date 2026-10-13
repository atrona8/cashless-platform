-- Migration 0009 : portée plateforme (SPECIFICATION §2.2 ; mission configuration-parties-evenements, data-model
-- « Migration 0009 », research R-01, R-02, R-09).
-- Une ligne sans prestataire (operator_id NULL) est une ligne de niveau plateforme : idempotence de l'API et
-- demandes d'approbation deviennent utilisables par le rôle de base de la plateforme. Les politiques RLS existantes
-- ne changent pas (NULL n'égale jamais le prestataire de la session : ces lignes restent invisibles du rôle
-- applicatif). Le rôle de la plateforme, ses droits et ses politiques nominatives sont posés par post-roles.sql :
-- aucune migration ne nomme un rôle dans une instruction (une base neuve ne l'a pas encore).

-- 1. Idempotence de niveau plateforme ----------------------------------------------------------------------------
-- NULLS NOT DISTINCT : deux clés identiques de niveau plateforme se heurtent comme deux clés d'un même prestataire.
ALTER TABLE api_idempotency ALTER COLUMN operator_id DROP NOT NULL;
ALTER TABLE api_idempotency DROP CONSTRAINT api_idempotency_uniq;
ALTER TABLE api_idempotency ADD CONSTRAINT api_idempotency_uniq
  UNIQUE NULLS NOT DISTINCT (operator_id, scope, idempotency_key);

-- 2. Demandes d'approbation : actions de la mission (R-09) et niveau plateforme ------------------------------------
ALTER TABLE approval_request ALTER COLUMN operator_id DROP NOT NULL;
ALTER TABLE approval_request DROP CONSTRAINT approval_request_action_check;
ALTER TABLE approval_request ADD CONSTRAINT approval_request_action_check CHECK (action IN (
  'LATE_CLAIM','ADJUSTMENT','ANOMALY_RESOLUTION','WAIVE_SEQ_GAP','FORCE_CENTRAL_AUTHORITY','REINSTATE_MEDIA','PAYOUT',
  'DEVICE_JOURNAL_IMPORT','KYC_REVOCATION','PSP_CONFIGURATION','EVENT_PSP_SELECTION','WALLET_REFUND','LATE_CHARGEBACK',
  'EVENT_GO_LIVE','EVENT_SETTINGS_CHANGE','EVENT_OPERATOR_SETTINGS_CHANGE','PARTICIPATION_CHANGE','FEE_RULE_CHANGE',
  'CONTRACT_VERSION','PLATFORM_CONTRACT_VERSION','JURISDICTION_LIMITS_CHANGE'));
-- Les deux actions de plateforme n'ont jamais de prestataire ; toutes les autres en ont toujours un.
ALTER TABLE approval_request ADD CONSTRAINT approval_request_platform_scope
  CHECK ((operator_id IS NULL) = (action IN ('PLATFORM_CONTRACT_VERSION','JURISDICTION_LIMITS_CHANGE')));

-- 3. Session du rôle de la plateforme ------------------------------------------------------------------------------
-- Vrai si la session a été ouverte par le rôle cashless_platform (ou un de ses membres). session_user, et non
-- current_user : la fonction est appelée depuis decide_approval_request (SECURITY DEFINER), où current_user est le
-- propriétaire. Le rôle est cherché par son nom à l'exécution (sur une base sans ce rôle : faux), sans dépendance
-- à la création.
-- Écart consigné avec le data-model, qui prévoyait un nom de rôle lu dans le réglage app.platform_role : un réglage
-- de session est modifiable par toute session, y compris celle du rôle applicatif, qui aurait pu s'y désigner
-- lui-même. Le nom est donc fixe.
CREATE FUNCTION platform_session() RETURNS boolean
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM pg_roles r
                  WHERE r.rolname = 'cashless_platform' AND pg_has_role(session_user, r.oid, 'MEMBER'))
$$;

-- 4. Décision d'une demande ---------------------------------------------------------------------------------------
-- Remplace la fonction du schéma de référence, même signature. Seul le contrôle de cloisonnement change : une
-- demande de niveau plateforme (operator_id NULL) exige une session du rôle de la plateforme ; une demande de
-- prestataire exige toujours son prestataire (assert_tenant). Tous les autres contrôles sont inchangés : demande
-- en attente, expiration, valideur différent de l'auteur.
--   CL023 APPROVAL_INVALID   demande expirée, déjà décidée, ou décidée par son auteur
CREATE OR REPLACE FUNCTION decide_approval_request(p_id uuid, p_approver uuid, p_approve boolean, p_note text DEFAULT NULL)
RETURNS approval_request
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r approval_request%ROWTYPE;
BEGIN
  SELECT * INTO r FROM approval_request WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  IF r.operator_id IS NULL THEN
    IF NOT platform_session() THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  ELSE
    PERFORM assert_tenant(r.operator_id);
  END IF;
  IF r.status <> 'PENDING' THEN RAISE EXCEPTION 'Demande déjà %', r.status USING ERRCODE = 'CL023'; END IF;
  IF clock_timestamp() > r.expires_at THEN
    UPDATE approval_request SET status = 'EXPIRED' WHERE id = p_id;
    RETURN NULL;                                          -- la mise à l'état EXPIRED est gardée ; l'API répond 409
  END IF;
  IF p_approver IS NULL OR p_approver = r.requested_by THEN
    RAISE EXCEPTION 'La demande doit être décidée par une autre personne que son auteur' USING ERRCODE = 'CL023';
  END IF;
  UPDATE approval_request SET status = CASE WHEN p_approve THEN 'APPROVED' ELSE 'REJECTED' END,
         decided_by = p_approver, decided_at = clock_timestamp(), decision_note = p_note
   WHERE id = p_id RETURNING * INTO r;
  RETURN r;
END $$;
