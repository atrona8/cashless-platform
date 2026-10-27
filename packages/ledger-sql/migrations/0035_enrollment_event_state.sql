-- Migration 0035 : enrôlement et état de l'événement (OP-N74 ; mission
-- terminaux-paiement-en-ligne, lot WP06 ; FR-024 ; research R-09 ; plan IC-08 ; décision du
-- porteur DM-01M5HKDXSTFR5JS88GZ4B2EA5J ; ADR-117 pour la trace des refus).
--
-- Contenu :
--   1. `create_device_enrollment_code` (même signature, corps de 0022 §3a à l'identique) : après le
--      contrôle de l'auteur, l'état de l'événement est relu sous verrou FOR SHARE (sérialisé avec
--      `set_event_status`, qui prend l'événement FOR NO KEY UPDATE) ; refus CL031 pour un événement
--      CLOSED (tout mode) et, dès CLOSING, pour les modes CATALOG_POS et KEYPAD_TPE.
--   2. `enroll_device` (même signature, corps de 0022 §3c à l'identique) : entre le contrôle du
--      mode (étape 3) et le verrou du `serial` (étape 4), même refus d'après l'événement du code
--      (FOR SHARE, pris après le verrou du code), puis contrôle du point de vente du code : il
--      existe, appartient au prestataire du code et à l'événement du code ; sinon CL031 (le « point
--      de vente supprimé » de FR-024 : aucune suppression n'existe en base, R-09).
--   3. Trace des refus (ADR-117, arbitrage de l'orchestrateur) : la valeur d'essai `EVENT_CLOSED`
--      est admise par la contrainte de `device_enrollment_attempt.result` et par
--      `record_enrollment_attempt` (corps de 0027 §2 à l'identique, liste élargie à cette seule
--      valeur). « Sans rien écrire » (FR-024) : ni terminal, ni code, ni jeton, ni historique ;
--      l'essai et l'audit du refus restent écrits, hors de la transaction annulée, par l'API.
--
-- États : DRAFT, LIVE permis ; CLOSING, RECONCILING, SETTLING, REFUND_WINDOW refusés pour
-- CATALOG_POS et KEYPAD_TPE, permis pour TOPUP_DESK ; CLOSED refusé pour tout mode. Mode effectif :
-- celui du code, NULL valant CATALOG_POS (même règle que `enroll_device`).
--
-- Erreur nouvelle (traduite par apps/api/src/errors/sqlstate-map.ts, lot WP08) :
--   CL031   événement clos, ou en clôture pour une caisse ; point de vente du code
--           inexistant ou hors de l'événement du code              -> 422 ENROLLMENT_EVENT_CLOSED
--
-- `check_device_enrollment_code` (lecture avant l'attestation) est laissée telle quelle (hors du
-- plan) : le refus pour état de l'événement arrive donc après l'attestation.
-- Droits : CREATE OR REPLACE garde les droits existants ; REVOKE … FROM PUBLIC rejoué ; aucun
-- GRANT.

-- 1. Émission d'un code ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION create_device_enrollment_code(p_code_hash bytea, p_event uuid, p_pos uuid,
                                                         p_mode text, p_personal_phone boolean,
                                                         p_ttl_seconds int, p_actor uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_operator uuid := nullif(current_setting('app.operator_id', true), '')::uuid;
  v_ttl int := coalesce(p_ttl_seconds, 86400);
  v_pos_event uuid;
  v_id uuid;
  v_status event_status;
BEGIN
  IF v_operator IS NULL THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  -- PAIRED_TPE (V2, ADR-43) : refus nommé avant toute contrainte de la table.
  IF p_mode = 'PAIRED_TPE' THEN
    RAISE EXCEPTION 'Mode PAIRED_TPE non disponible' USING ERRCODE = 'CL027';
  END IF;
  IF p_event IS NULL THEN
    RAISE EXCEPTION 'Code d''enrôlement : événement obligatoire' USING ERRCODE = 'CL001';
  END IF;
  IF p_mode IS NOT NULL AND p_mode NOT IN ('CATALOG_POS','KEYPAD_TPE','TOPUP_DESK') THEN
    RAISE EXCEPTION 'Code d''enrôlement : mode inconnu' USING ERRCODE = 'CL001';
  END IF;
  IF p_personal_phone IS NULL THEN
    RAISE EXCEPTION 'Code d''enrôlement : téléphone personnel à choisir (sans défaut)' USING ERRCODE = 'CL001';
  END IF;
  IF p_personal_phone AND p_mode IS DISTINCT FROM 'KEYPAD_TPE' THEN
    RAISE EXCEPTION 'Téléphone personnel : mode KEYPAD_TPE seulement' USING ERRCODE = 'CL027';
  END IF;
  IF v_ttl < 300 OR v_ttl > 604800 THEN
    RAISE EXCEPTION 'Code d''enrôlement : durée hors bornes (300 à 604800 s)' USING ERRCODE = 'CL001';
  END IF;
  IF p_code_hash IS NULL OR octet_length(p_code_hash) <> 32 THEN
    RAISE EXCEPTION 'Code d''enrôlement : empreinte de 32 octets attendue' USING ERRCODE = 'CL001';
  END IF;
  -- Événement du prestataire de la session.
  PERFORM 1 FROM event WHERE id = p_event AND operator_id = v_operator;
  IF NOT FOUND THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  -- Point de vente du prestataire, et de cet événement.
  IF p_pos IS NOT NULL THEN
    SELECT mp.event_id INTO v_pos_event
      FROM point_of_sale p JOIN merchant_participation mp ON mp.id = p.participation_id
     WHERE p.id = p_pos AND p.operator_id = v_operator AND mp.operator_id = v_operator;
    IF NOT FOUND THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
    IF v_pos_event IS DISTINCT FROM p_event THEN
      RAISE EXCEPTION 'Code d''enrôlement : le point de vente n''appartient pas à l''événement'
        USING ERRCODE = 'CL001';
    END IF;
  END IF;
  -- Auteur : OPERATOR_ADMIN du prestataire ou ORGANIZER_ADMIN de l'organisateur de l'événement
  -- (renforcement : la base revérifie la portée contrôlée par l'API). Hors périmètre : introuvable.
  IF p_actor IS NULL OR NOT device_admin_allowed(v_operator, p_event, p_actor) THEN
    RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found';
  END IF;
  -- OP-N74 : état de l'événement, relu APRÈS l'auteur (un auteur hors périmètre reçoit P0002 et
  -- n'apprend pas l'état) et sous verrou FOR SHARE : une clôture concurrente (set_event_status, FOR
  -- NO KEY UPDATE) attend la fin de cette transaction, ou est vue si elle a été validée avant.
  SELECT e.status INTO v_status FROM event e
   WHERE e.id = p_event AND e.operator_id = v_operator FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  IF v_status = 'CLOSED'
     OR (v_status IN ('CLOSING','RECONCILING','SETTLING','REFUND_WINDOW')
         AND coalesce(p_mode, 'CATALOG_POS') IN ('CATALOG_POS','KEYPAD_TPE')) THEN
    RAISE EXCEPTION 'Code d''enrôlement : événement % pour le mode %', v_status,
      coalesce(p_mode, 'CATALOG_POS') USING ERRCODE = 'CL031';
  END IF;
  INSERT INTO device_enrollment_code (operator_id, code_hash, event_id, pos_id, app_mode, personal_phone,
                                      created_by, created_at, expires_at)
  VALUES (v_operator, p_code_hash, p_event, p_pos, p_mode, p_personal_phone, p_actor, now(),
          now() + make_interval(secs => v_ttl))
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION create_device_enrollment_code(bytea, uuid, uuid, text, boolean, int, uuid) FROM PUBLIC;

-- 2. Enrôlement -----------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION enroll_device(p_code_hash bytea, p_serial text, p_os text, p_app_version text,
                                         p_public_key bytea, p_agreement_key bytea, p_cert_sha256 bytea,
                                         p_cert_not_after timestamptz, p_attestation_kind text,
                                         p_security_level text, p_refresh_hash bytea,
                                         p_refresh_expires timestamptz, p_device_id uuid DEFAULT NULL)
RETURNS TABLE (device_id uuid, next_seq bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE
  v_session uuid := nullif(current_setting('app.operator_id', true), '')::uuid;
  c device_enrollment_code%ROWTYPE;
  v_mode text;
  v_id uuid := coalesce(p_device_id, gen_random_uuid());
  v_next bigint;
  v_constraint text;
  v_status event_status;
BEGIN
  -- Paramètres (déjà validés par l'API ; revérifiés ici, la base est la dernière barrière).
  IF p_serial IS NULL OR length(p_serial) NOT BETWEEN 1 AND 64 THEN
    RAISE EXCEPTION 'Enrôlement : serial invalide' USING ERRCODE = 'CL001';
  END IF;
  IF p_os IS NULL OR p_os NOT IN ('ANDROID','IOS') THEN
    RAISE EXCEPTION 'Enrôlement : système inconnu' USING ERRCODE = 'CL001';
  END IF;
  IF p_app_version IS NULL OR length(p_app_version) NOT BETWEEN 1 AND 64 THEN
    RAISE EXCEPTION 'Enrôlement : version de l''application invalide' USING ERRCODE = 'CL001';
  END IF;
  IF p_public_key IS NULL OR octet_length(p_public_key) NOT BETWEEN 64 AND 200
     OR p_agreement_key IS NULL OR octet_length(p_agreement_key) <> 65
     OR p_cert_sha256 IS NULL OR octet_length(p_cert_sha256) <> 32 THEN
    RAISE EXCEPTION 'Enrôlement : clés ou empreinte du certificat invalides' USING ERRCODE = 'CL001';
  END IF;
  IF p_cert_not_after IS NULL OR p_cert_not_after <= now() THEN
    RAISE EXCEPTION 'Enrôlement : certificat sans validité' USING ERRCODE = 'CL001';
  END IF;
  -- coalesce : un paramètre NULL rend la condition fausse (jamais NULL, qui laisserait passer).
  IF NOT coalesce((p_os = 'ANDROID' AND p_attestation_kind = 'ANDROID_KEY_ATTESTATION'
                   AND p_security_level IN ('TRUSTED_ENVIRONMENT','STRONGBOX'))
                  OR (p_os = 'IOS' AND p_attestation_kind = 'IOS_APP_ATTEST' AND p_security_level IS NULL),
                  false) THEN
    RAISE EXCEPTION 'Enrôlement : attestation incohérente avec le système' USING ERRCODE = 'CL001';
  END IF;
  IF p_refresh_hash IS NULL OR octet_length(p_refresh_hash) <> 32
     OR p_refresh_expires IS NULL OR p_refresh_expires <= now() THEN
    RAISE EXCEPTION 'Enrôlement : jeton de rafraîchissement invalide' USING ERRCODE = 'CL001';
  END IF;

  -- 1. Code verrouillé : deux enrôlements concurrents sur le même code, un seul gagnant (NFR-008).
  --    Inconnu, utilisé ou d'un autre prestataire que la session : un seul refus (NFR-006).
  IF p_code_hash IS NOT NULL AND octet_length(p_code_hash) = 32 THEN
    SELECT * INTO c FROM device_enrollment_code WHERE code_hash = p_code_hash FOR UPDATE;
  END IF;
  IF c.id IS NULL OR c.used_at IS NOT NULL
     OR (v_session IS NOT NULL AND v_session IS DISTINCT FROM c.operator_id) THEN
    RAISE EXCEPTION 'Code d''enrôlement invalide' USING ERRCODE = 'CL025';
  END IF;
  -- 2. Expiration.
  IF c.expires_at <= now() THEN
    RAISE EXCEPTION 'Code d''enrôlement expiré' USING ERRCODE = 'CL026';
  END IF;
  -- 3. Mode : celui du code (PAIRED_TPE impossible dans la table).
  v_mode := coalesce(c.app_mode, 'CATALOG_POS');
  IF (p_os = 'IOS' AND v_mode = 'TOPUP_DESK') OR (c.personal_phone AND v_mode <> 'KEYPAD_TPE') THEN
    RAISE EXCEPTION 'Mode % refusé pour ce terminal', v_mode USING ERRCODE = 'CL027';
  END IF;
  -- 3a. OP-N74 : événement du code, sous verrou FOR SHARE (ordre fixe : code, puis événement), pour
  --     qu'une clôture concurrente (set_event_status, FOR NO KEY UPDATE) ne passe pas entre la
  --     lecture et l'écriture. Événement introuvable dans le prestataire du code : refus fermé.
  SELECT e.status INTO v_status FROM event e
   WHERE e.id = c.event_id AND e.operator_id = c.operator_id FOR SHARE;
  IF NOT FOUND OR v_status = 'CLOSED'
     OR (v_status IN ('CLOSING','RECONCILING','SETTLING','REFUND_WINDOW')
         AND v_mode IN ('CATALOG_POS','KEYPAD_TPE')) THEN
    RAISE EXCEPTION 'Enrôlement : événement % pour le mode %', v_status, v_mode
      USING ERRCODE = 'CL031';
  END IF;
  -- 3b. Point de vente du code (relu : contrôlé à l'émission, il a pu changer depuis) : il existe,
  --     appartient au prestataire du code et à l'événement du code.
  IF c.pos_id IS NOT NULL THEN
    PERFORM 1 FROM point_of_sale p JOIN merchant_participation mp ON mp.id = p.participation_id
     WHERE p.id = c.pos_id AND p.operator_id = c.operator_id AND mp.operator_id = c.operator_id
       AND mp.event_id = c.event_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Enrôlement : point de vente hors de l''événement du code'
        USING ERRCODE = 'CL031';
    END IF;
  END IF;
  -- 4. serial : un seul terminal non révoqué par serial DANS LE PRESTATAIRE (ADR-109). Verrou
  --    consultatif du couple : deux enrôlements concurrents d'un même serial (codes différents) sont
  --    sérialisés, le second voit le premier et reçoit CL028 ; next_seq est calculé sous ce verrou.
  PERFORM pg_advisory_xact_lock(hashtextextended('device-serial:' || c.operator_id::text || ':' || p_serial, 0));
  IF EXISTS (SELECT 1 FROM device d WHERE d.operator_id = c.operator_id AND d.serial = p_serial
                AND d.status <> 'REVOKED') THEN
    RAISE EXCEPTION 'Serial déjà porté par un terminal actif' USING ERRCODE = 'CL028';
  END IF;
  -- 5. next_seq = max_seen_seq + 1 pour ce serial, dans ce prestataire seulement (sync_protocol §3.1-5).
  SELECT coalesce(max(d.last_seq), 0) + 1 INTO v_next
    FROM device d WHERE d.operator_id = c.operator_id AND d.serial = p_serial;
  -- 6. Terminal. Les numéros d'avant next_seq ne sont pas des trous de CE terminal : registre continu
  --    jusqu'à next_seq - 1 (sinon device_missing_seqs les listerait et la borne max_seq_jump bloquerait
  --    un ré-enrôlement au-delà de 10 000). La chaîne repart de l'origine (sync_protocol §3.3).
  BEGIN
    INSERT INTO device (id, operator_id, kind, app_mode, os, nfc_enabled, event_id, pos_id, serial,
                        public_key, agreement_public_key, cert_sha256, cert_not_after, status, personal_phone,
                        last_seq, contiguous_acked_seq, next_seq_floor, last_chain_seq, last_chain_hash,
                        app_version, attestation_kind, attestation_security_level, enrolled_at,
                        enrollment_code_id)
    VALUES (v_id, c.operator_id, CASE WHEN v_mode = 'TOPUP_DESK' THEN 'TOPUP' ELSE 'POS' END, v_mode, p_os,
            p_os = 'ANDROID', c.event_id, c.pos_id, p_serial,
            p_public_key, p_agreement_key, p_cert_sha256, p_cert_not_after, 'ACTIVE', c.personal_phone,
            v_next - 1, v_next - 1, v_next, v_next - 1, device_chain_genesis(v_id),
            p_app_version, p_attestation_kind, p_security_level, now(), c.id);
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
    IF v_constraint = 'device_serial_active' THEN
      RAISE EXCEPTION 'Serial déjà porté par un terminal actif' USING ERRCODE = 'CL028';
    END IF;
    RAISE;
  END;
  -- 7. Code consommé (seulement ici : un enrôlement refusé plus haut ne le consomme pas).
  UPDATE device_enrollment_code SET used_at = now(), device_id = v_id WHERE id = c.id;
  -- 8. Familles encore vivantes des terminaux révoqués de ce serial : révoquées (REENROLLED).
  UPDATE device_refresh_token t SET revoked_at = now(), revoked_reason = 'REENROLLED'
    FROM device d
   WHERE t.device_id = d.id AND t.operator_id = c.operator_id AND t.revoked_at IS NULL
     AND d.operator_id = c.operator_id AND d.serial = p_serial AND d.status = 'REVOKED';
  -- 9. Nouvelle famille et premier jeton.
  INSERT INTO device_refresh_token (operator_id, device_id, family_id, token_hash, expires_at)
  VALUES (c.operator_id, v_id, gen_random_uuid(), p_refresh_hash, p_refresh_expires);
  -- 10. Historique.
  INSERT INTO device_status_history (operator_id, device_id, from_status, to_status, reason, actor_id)
  VALUES (c.operator_id, v_id, NULL, 'ACTIVE', 'ENROLLED', NULL);
  RETURN QUERY SELECT v_id, v_next;
END $$;
REVOKE ALL ON FUNCTION enroll_device(bytea, text, text, text, bytea, bytea, bytea, timestamptz, text, text,
                                     bytea, timestamptz, uuid) FROM PUBLIC;

-- 3. Trace du refus (ADR-117) : valeur d'essai EVENT_CLOSED ---------------------------------------
ALTER TABLE device_enrollment_attempt DROP CONSTRAINT device_enrollment_attempt_result;
ALTER TABLE device_enrollment_attempt ADD CONSTRAINT device_enrollment_attempt_result
  CHECK (result IN ('ENROLLED','CODE_INVALID','CODE_EXPIRED','MODE_NOT_ALLOWED',
                    'ATTESTATION_FAILED','SERIAL_IN_USE','VALIDATION_FAILED','RATE_LIMITED',
                    'EVENT_CLOSED'));

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
                         'RATE_LIMITED','EVENT_CLOSED') THEN
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
