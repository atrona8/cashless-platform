-- Migration 0027 : essais et audit des refus d'enrôlement (mission identite-enrolement-terminaux,
-- reprise du lot WP14 ; ADR-117 ; contracts/enrollment.md « Limites » et « Audit » ; data-model
-- « Essais d'enrôlement » ; research R-16, mise à jour du 21/10/2026).
--
-- Contenu :
--   1. `device_enrollment_attempt` garde l'empreinte HMAC de TOUT code bien formé, connu ou non
--      (contrainte `known_code` remplacée : un prestataire exige une empreinte, l'inverse n'est
--      plus vrai). La limite par code vaut donc pour un code inconnu comme pour un code
--      existant : plus d'oracle « 429 pour un code existant, 422 pour un code inconnu »
--      (NFR-006).
--   2. `record_enrollment_attempt` (même signature, droits conservés) : empreinte gardée telle
--      quelle ; prestataire rattaché si le code existe.
--   3. `enrollment_attempts_exceeded` (même signature) : seuls les REFUS comptent, pour l'adresse
--      (un parc derrière un NAT n'est pas bloqué par ses réussites) comme pour le code (un code
--      utilisé et un code inconnu atteignent la limite au même essai, aucun oracle).
--   4. `record_enrollment_refusal` (nouvelle, SECURITY DEFINER) : écrit l'essai ET la ligne
--      d'audit `DEVICE_ENROLLMENT_REFUSED` dans la même transaction (hors de celle de
--      l'enrôlement), pour tout refus : chaîne du prestataire du code s'il est connu en base
--      (même expiré ou utilisé), sinon chaîne de la plateforme (`operator_id` NULL). Au-delà
--      d'une limite, un seul essai et un seul audit `RATE_LIMITED` par adresse (ou par code) et
--      par fenêtre d'une heure ; les suivants n'écrivent rien (rend false).
--
-- Mêmes hypothèses que 0022 : sans prestataire de session, propriétaire qui ignore la RLS
-- (tests_device_rights.sql §6). EXECUTE accordé à cashless_app par post-roles.sql §4a.

-- 1. Essais : empreinte de tout code bien formé ---------------------------------------------------
ALTER TABLE device_enrollment_attempt DROP CONSTRAINT device_enrollment_attempt_known_code;
ALTER TABLE device_enrollment_attempt ADD CONSTRAINT device_enrollment_attempt_operator_code
  CHECK (operator_id IS NULL OR code_hash IS NOT NULL);

-- 2. Trace d'un essai -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION record_enrollment_attempt(p_code_hash bytea, p_address inet,
                                                     p_result text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_operator uuid; v_hash bytea;
BEGIN
  IF p_address IS NULL THEN
    RAISE EXCEPTION 'Essai d''enrôlement : adresse obligatoire' USING ERRCODE = 'CL001';
  END IF;
  IF p_result IS NULL
     OR p_result NOT IN ('ENROLLED','CODE_INVALID','CODE_EXPIRED','MODE_NOT_ALLOWED',
                         'ATTESTATION_FAILED','SERIAL_IN_USE','VALIDATION_FAILED',
                         'RATE_LIMITED') THEN
    RAISE EXCEPTION 'Essai d''enrôlement : résultat inconnu' USING ERRCODE = 'CL001';
  END IF;
  -- Empreinte à clé (HMAC, clé hors base) : la garder pour un code inconnu ne révèle rien.
  IF p_code_hash IS NOT NULL AND octet_length(p_code_hash) = 32 THEN
    v_hash := p_code_hash;
    SELECT c.operator_id INTO v_operator
      FROM device_enrollment_code c WHERE c.code_hash = p_code_hash;
  END IF;
  INSERT INTO device_enrollment_attempt (operator_id, code_hash, address, result)
  VALUES (v_operator, v_hash, p_address, p_result);
  -- Purge au fil de l'eau, par lots bornés (la fonction de purge reste disponible pour un travail).
  DELETE FROM device_enrollment_attempt
   WHERE id IN (SELECT a.id FROM device_enrollment_attempt a
                 WHERE a.at < clock_timestamp() - interval '24 hours' ORDER BY a.at LIMIT 500);
END $$;
REVOKE ALL ON FUNCTION record_enrollment_attempt(bytea, inet, text) FROM PUBLIC;

-- 3. Limites : 10 refus du code, 30 refus de l'adresse, dans l'heure ------------------------------
-- Ni ENROLLED (une réussite consomme un code émis par un administrateur) ni RATE_LIMITED (sinon un
-- blocage s'entretiendrait lui-même) ne comptent.
CREATE OR REPLACE FUNCTION enrollment_attempts_exceeded(p_code_hash bytea, p_address inet)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT (p_code_hash IS NOT NULL
          AND (SELECT count(*) FROM device_enrollment_attempt a
                WHERE a.code_hash = p_code_hash AND a.result NOT IN ('ENROLLED','RATE_LIMITED')
                  AND a.at > clock_timestamp() - interval '1 hour') >= 10)
      OR (p_address IS NOT NULL
          AND (SELECT count(*) FROM device_enrollment_attempt a
                WHERE a.address = p_address AND a.result NOT IN ('ENROLLED','RATE_LIMITED')
                  AND a.at > clock_timestamp() - interval '1 hour') >= 30)
$$;
REVOKE ALL ON FUNCTION enrollment_attempts_exceeded(bytea, inet) FROM PUBLIC;

-- 4. Refus : essai et audit ensemble --------------------------------------------------------------
-- Appelée par l'API dans une transaction distincte de l'enrôlement annulé. Rend true si l'essai et
-- l'audit sont écrits, false pour un RATE_LIMITED déjà tracé dans la fenêtre. L'audit ne porte ni
-- code ni empreinte : résultat, raison interne (200 caractères), adresse, `serial` et système
-- annoncés, et l'identifiant du code s'il est connu (le prestataire sait quel code a fui).
-- Origine et requête : contexte d'audit (FR-008), comme create_platform_admin (0006).
CREATE FUNCTION record_enrollment_refusal(p_code_hash bytea, p_address inet, p_result text,
                                          p_reason text, p_serial text, p_os text, p_origin text,
                                          p_request_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_hash bytea;
  v_operator uuid;
  v_code uuid;
  v_since timestamptz := clock_timestamp() - interval '1 hour';
  v_code_new boolean := false;
  v_address_new boolean := false;
BEGIN
  IF p_result IS NULL OR p_result = 'ENROLLED' THEN
    RAISE EXCEPTION 'Refus d''enrôlement : résultat de refus attendu' USING ERRCODE = 'CL001';
  END IF;
  IF p_code_hash IS NOT NULL AND octet_length(p_code_hash) = 32 THEN
    v_hash := p_code_hash;
  END IF;
  IF p_result = 'RATE_LIMITED' AND p_address IS NOT NULL THEN
    -- Une trace par limite franchie et par fenêtre ; verrous pris dans un ordre fixe (adresse,
    -- code) pour que deux 429 simultanés n'écrivent pas deux fois.
    PERFORM pg_advisory_xact_lock(hashtextextended('enrollment-limit:' || host(p_address), 0));
    IF v_hash IS NOT NULL THEN
      PERFORM pg_advisory_xact_lock(
        hashtextextended('enrollment-limit:' || encode(v_hash, 'hex'), 0));
      v_code_new :=
        (SELECT count(*) FROM device_enrollment_attempt a
          WHERE a.code_hash = v_hash AND a.result NOT IN ('ENROLLED','RATE_LIMITED')
            AND a.at > v_since) >= 10
        AND NOT EXISTS (SELECT 1 FROM device_enrollment_attempt a
                         WHERE a.code_hash = v_hash AND a.result = 'RATE_LIMITED'
                           AND a.at > v_since);
    END IF;
    v_address_new :=
      (SELECT count(*) FROM device_enrollment_attempt a
        WHERE a.address = p_address AND a.result NOT IN ('ENROLLED','RATE_LIMITED')
          AND a.at > v_since) >= 30
      AND NOT EXISTS (SELECT 1 FROM device_enrollment_attempt a
                       WHERE a.address = p_address AND a.result = 'RATE_LIMITED'
                         AND a.at > v_since);
    IF NOT (v_code_new OR v_address_new) THEN
      RETURN false;
    END IF;
  END IF;
  -- Contrôle de l'adresse et du résultat, purge au fil de l'eau.
  PERFORM record_enrollment_attempt(v_hash, p_address, p_result);
  IF v_hash IS NOT NULL THEN
    SELECT c.operator_id, c.id INTO v_operator, v_code
      FROM device_enrollment_code c WHERE c.code_hash = v_hash;
  END IF;
  INSERT INTO audit_log (operator_id, actor_id, actor_role, action, object_type, object_id, after,
                         origin, request_id)
  VALUES (v_operator, NULL, NULL, 'DEVICE_ENROLLMENT_REFUSED', 'device_enrollment', NULL,
          jsonb_build_object('result', p_result, 'reason', left(p_reason, 200),
                             'address', host(p_address), 'serial', left(p_serial, 64),
                             'os', left(p_os, 16), 'enrollment_code_id', v_code),
          left(p_origin, 200), p_request_id);
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION record_enrollment_refusal(bytea, inet, text, text, text, text, text, uuid)
  FROM PUBLIC;
