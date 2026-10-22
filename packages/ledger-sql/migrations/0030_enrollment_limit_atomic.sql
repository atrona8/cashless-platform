-- Migration 0030 : limites d'enrôlement atomiques, limite par adresse agrégée par /64 en IPv6,
-- limite franchie nommée dans la trace (mission identite-enrolement-terminaux, lot WP18 ; ADR-117,
-- relecture de WP14 cycle 2 : N-a, N-b, N-c ; contracts/enrollment.md « Limites »).
--
-- Avant (0027) : la limite était lue avant l'enrôlement (`enrollment_attempts_exceeded`), dans une
-- transaction, et le refus écrit après (`record_enrollment_refusal`), dans une autre. Une rafale de
-- K requêtes simultanées sur un code fuité passait toute le contrôle et écrivait K essais et K
-- lignes d'audit dans la chaîne du prestataire (N-b). La limite par adresse valait par adresse
-- IPv6 complète : un client qui dispose d'un /64 (cas courant) changeait d'adresse à chaque essai
-- (N-c). La trace RATE_LIMITED ne disait pas quelle limite avait été franchie (N-a).
--
-- Après (mêmes signatures, mêmes droits : post-roles.sql §4a inchangé) :
--   1. `enrollment_address_key(inet)` (nouvelle, IMMUTABLE, interne : aucun rôle ne l'exécute) :
--      clé de la limite par adresse. IPv4 : l'adresse ; IPv4 en notation IPv6 (::ffff:a.b.c.d) :
--      l'adresse IPv4 (sinon tous les clients IPv4 d'un serveur double pile partageraient un même
--      /64) ; IPv6 : son /64. Colonne générée `device_enrollment_attempt.address_key` (même
--      expression) et index (address_key, at), qui remplace (address, at). L'adresse complète
--      reste dans l'essai et dans l'audit.
--   2. `enrollment_attempts_exceeded` : limite de l'adresse comptée sur sa clé.
--   3. `record_enrollment_refusal` : verrous consultatifs de l'adresse (sa clé) puis du code pris
--      AVANT le contrôle, pour tout refus (et non plus pour les seuls RATE_LIMITED) ; contrôle et
--      écriture dans la même transaction. Un refus qui arrive alors qu'une limite est déjà
--      atteinte (requêtes simultanées passées toutes par le contrôle préalable) s'écrit comme le
--      franchissement de cette limite : un seul essai et un seul audit RATE_LIMITED par fenêtre,
--      puis plus rien. Une rafale de K requêtes simultanées écrit donc au plus 10 refus du code
--      (30 de l'adresse) et une trace RATE_LIMITED, quel que soit K. La réponse HTTP de ces
--      requêtes reste celle de leur refus (elle est déjà décidée) ; l'audit garde ce refus
--      (`refusal`).
--   4. Trace RATE_LIMITED : `limit` = `code`, `address`, ou `code,address` si les deux limites sont
--      franchies par le même essai.
--
-- Limite résiduelle (consignée, ADR-117) : chaque refus prend désormais le verrou de sa clé
-- d'adresse et, pour un code inconnu, celui de la chaîne d'audit de la plateforme ; une rafale de
-- codes inconnus depuis de nombreuses clés d'adresse (botnet, nombreux /64) reste sérialisée sur
-- cette chaîne et n'est bornée que par 30 refus par clé et par heure. Une limite de débit en amont
-- (répartiteur) reste nécessaire.
--
-- Mêmes hypothèses que 0022 et 0027 : sans prestataire de session, propriétaire qui ignore la RLS.

-- 1. Clé de la limite par adresse -----------------------------------------------------------------
CREATE FUNCTION enrollment_address_key(p_address inet) RETURNS inet
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE SET search_path = pg_catalog, pg_temp AS $$
  SELECT CASE
           WHEN family(p_address) = 4 THEN set_masklen(p_address, 32)
           WHEN p_address <<= '::ffff:0.0.0.0/96'::inet
             THEN '0.0.0.0'::inet + (p_address - '::ffff:0.0.0.0'::inet)
           ELSE network(set_masklen(p_address, 64))::inet
         END
$$;
REVOKE ALL ON FUNCTION enrollment_address_key(inet) FROM PUBLIC;

-- Même expression que la fonction, écrite avec les seules fonctions du catalogue : une colonne
-- générée s'évalue avec les droits de qui écrit, et la fonction n'est accordée à aucun rôle
-- (tests/tests_enrollment_limits.sql vérifie que les deux donnent la même clé).
ALTER TABLE device_enrollment_attempt
  ADD COLUMN address_key inet GENERATED ALWAYS AS (
    CASE
      WHEN family(address) = 4 THEN set_masklen(address, 32)
      WHEN address <<= '::ffff:0.0.0.0/96'::inet
        THEN '0.0.0.0'::inet + (address - '::ffff:0.0.0.0'::inet)
      ELSE network(set_masklen(address, 64))::inet
    END) STORED;
CREATE INDEX device_enrollment_attempt_address_key_idx
  ON device_enrollment_attempt (address_key, at);
DROP INDEX device_enrollment_attempt_address_idx;

-- 2. Limites : 10 refus du code, 30 refus de la clé d'adresse, dans l'heure -----------------------
CREATE OR REPLACE FUNCTION enrollment_attempts_exceeded(p_code_hash bytea, p_address inet)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT (p_code_hash IS NOT NULL
          AND (SELECT count(*) FROM device_enrollment_attempt a
                WHERE a.code_hash = p_code_hash AND a.result NOT IN ('ENROLLED','RATE_LIMITED')
                  AND a.at > clock_timestamp() - interval '1 hour') >= 10)
      OR (p_address IS NOT NULL
          AND (SELECT count(*) FROM device_enrollment_attempt a
                WHERE a.address_key = enrollment_address_key(p_address)
                  AND a.result NOT IN ('ENROLLED','RATE_LIMITED')
                  AND a.at > clock_timestamp() - interval '1 hour') >= 30)
$$;
REVOKE ALL ON FUNCTION enrollment_attempts_exceeded(bytea, inet) FROM PUBLIC;

-- 3. Refus : verrous, contrôle et écriture ensemble -----------------------------------------------
-- Rend true si l'essai et l'audit sont écrits, false si rien ne l'est (limite déjà tracée dans la
-- fenêtre, ou 429 sans limite franchie).
CREATE OR REPLACE FUNCTION record_enrollment_refusal(p_code_hash bytea, p_address inet,
                                                     p_result text, p_reason text,
                                                     p_serial text, p_os text, p_origin text,
                                                     p_request_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_hash bytea;
  v_key inet;
  v_operator uuid;
  v_code uuid;
  v_since timestamptz;
  v_code_over boolean := false;
  v_address_over boolean;
  v_code_new boolean := false;
  v_address_new boolean := false;
  v_result text := p_result;
  v_limit text;
BEGIN
  IF p_result IS NULL OR p_result = 'ENROLLED' THEN
    RAISE EXCEPTION 'Refus d''enrôlement : résultat de refus attendu' USING ERRCODE = 'CL001';
  END IF;
  IF p_address IS NULL THEN
    RAISE EXCEPTION 'Essai d''enrôlement : adresse obligatoire' USING ERRCODE = 'CL001';
  END IF;
  IF p_code_hash IS NOT NULL AND octet_length(p_code_hash) = 32 THEN
    v_hash := p_code_hash;
  END IF;
  v_key := enrollment_address_key(p_address);
  -- Verrous AVANT le contrôle (N-b), dans un ordre fixe (adresse, code) : deux refus simultanés
  -- du même code ou de la même clé d'adresse se voient l'un l'autre.
  PERFORM pg_advisory_xact_lock(hashtextextended('enrollment-limit:' || v_key::text, 0));
  IF v_hash IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(
      hashtextextended('enrollment-limit:' || encode(v_hash, 'hex'), 0));
  END IF;
  v_since := clock_timestamp() - interval '1 hour';
  IF v_hash IS NOT NULL THEN
    v_code_over :=
      (SELECT count(*) FROM device_enrollment_attempt a
        WHERE a.code_hash = v_hash AND a.result NOT IN ('ENROLLED','RATE_LIMITED')
          AND a.at > v_since) >= 10;
  END IF;
  v_address_over :=
    (SELECT count(*) FROM device_enrollment_attempt a
      WHERE a.address_key = v_key AND a.result NOT IN ('ENROLLED','RATE_LIMITED')
        AND a.at > v_since) >= 30;
  IF p_result = 'RATE_LIMITED' OR v_code_over OR v_address_over THEN
    -- Une trace par limite franchie et par fenêtre (N3) ; au-delà, rien.
    v_code_new := v_code_over
      AND NOT EXISTS (SELECT 1 FROM device_enrollment_attempt a
                       WHERE a.code_hash = v_hash AND a.result = 'RATE_LIMITED'
                         AND a.at > v_since);
    v_address_new := v_address_over
      AND NOT EXISTS (SELECT 1 FROM device_enrollment_attempt a
                       WHERE a.address_key = v_key AND a.result = 'RATE_LIMITED'
                         AND a.at > v_since);
    IF NOT (v_code_new OR v_address_new) THEN
      RETURN false;
    END IF;
    v_result := 'RATE_LIMITED';
    v_limit := CASE WHEN v_code_new AND v_address_new THEN 'code,address'
                    WHEN v_code_new THEN 'code' ELSE 'address' END;
  END IF;
  -- Contrôle du résultat, purge au fil de l'eau.
  PERFORM record_enrollment_attempt(v_hash, p_address, v_result);
  IF v_hash IS NOT NULL THEN
    SELECT c.operator_id, c.id INTO v_operator, v_code
      FROM device_enrollment_code c WHERE c.code_hash = v_hash;
  END IF;
  INSERT INTO audit_log (operator_id, actor_id, actor_role, action, object_type, object_id, after,
                         origin, request_id)
  VALUES (v_operator, NULL, NULL, 'DEVICE_ENROLLMENT_REFUSED', 'device_enrollment', NULL,
          jsonb_build_object('result', v_result, 'reason', left(p_reason, 200),
                             'address', host(p_address), 'serial', left(p_serial, 64),
                             'os', left(p_os, 16), 'enrollment_code_id', v_code)
          || CASE WHEN v_limit IS NULL THEN '{}'::jsonb
                  ELSE jsonb_build_object('limit', v_limit) END
          -- Refus d'une requête simultanée, écrit comme le franchissement de la limite.
          || CASE WHEN v_result = p_result THEN '{}'::jsonb
                  ELSE jsonb_build_object('refusal', p_result) END,
          left(p_origin, 200), p_request_id);
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION record_enrollment_refusal(bytea, inet, text, text, text, text, text, uuid)
  FROM PUBLIC;
