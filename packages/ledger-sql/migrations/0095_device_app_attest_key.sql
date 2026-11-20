-- Migration 0095 : clé App Attest d'un iPhone et son compteur (mission durcissements-serveur, lot WP02 ;
-- FR-020 ; plan IC-09 ; research R-N64 A3). Table dédiée (pas de colonne sur `device`), `enroll_device` reprise
-- avec deux arguments optionnels, `advance_app_attest_counter` pour faire avancer le compteur de façon atomique.
-- Aucun GRANT ni REVOKE hors `FROM PUBLIC` : les droits sont à WP03.
-- Fonctions à faire relire : enroll_device (reprise de 0035), advance_app_attest_counter.

-- 1. Table ----------------------------------------------------------------------------------------------------
CREATE TABLE device_app_attest_key (
  device_id   uuid PRIMARY KEY REFERENCES device(id),
  operator_id uuid NOT NULL REFERENCES party(id),
  key_id      bytea NOT NULL UNIQUE CHECK (octet_length(key_id) = 32),
  public_key  bytea NOT NULL,
  counter     bigint NOT NULL DEFAULT 0 CHECK (counter >= 0 AND counter <= 4294967295),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE device_app_attest_key ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_app_attest_key FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON device_app_attest_key
  USING (operator_id = current_setting('app.operator_id', true)::uuid);

-- 2. Enrôlement : nouvelle signature à 15 arguments, l'ancienne (13) est retirée (sinon appel ambigu) ---------
DROP FUNCTION enroll_device(bytea, text, text, text, bytea, bytea, bytea, timestamptz, text, text, bytea,
                            timestamptz, uuid);

CREATE FUNCTION enroll_device(p_code_hash bytea, p_serial text, p_os text, p_app_version text,
                                         p_public_key bytea, p_agreement_key bytea, p_cert_sha256 bytea,
                                         p_cert_not_after timestamptz, p_attestation_kind text,
                                         p_security_level text, p_refresh_hash bytea,
                                         p_refresh_expires timestamptz, p_device_id uuid DEFAULT NULL,
                                         p_app_attest_key_id bytea DEFAULT NULL,
                                         p_app_attest_public_key bytea DEFAULT NULL)
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

  -- App Attest : les deux arguments ensemble, pour un iPhone seulement ; sinon aucun.
  IF (p_app_attest_key_id IS NULL) <> (p_app_attest_public_key IS NULL) THEN
    RAISE EXCEPTION 'Enrôlement : identifiant et clé publique App Attest vont ensemble'
      USING ERRCODE = 'CL001';
  END IF;
  IF p_app_attest_key_id IS NOT NULL
     AND (p_os IS DISTINCT FROM 'IOS' OR p_attestation_kind IS DISTINCT FROM 'IOS_APP_ATTEST'
          OR octet_length(p_app_attest_key_id) <> 32 OR octet_length(p_app_attest_public_key) = 0) THEN
    RAISE EXCEPTION 'Enrôlement : clé App Attest invalide ou hors iOS' USING ERRCODE = 'CL001';
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
  -- 6b. Clé App Attest et son compteur (même transaction : un échec annule l'enrôlement).
  IF p_app_attest_key_id IS NOT NULL THEN
    INSERT INTO device_app_attest_key (device_id, operator_id, key_id, public_key)
    VALUES (v_id, c.operator_id, p_app_attest_key_id, p_app_attest_public_key);
  END IF;
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
                                     bytea, timestamptz, uuid, bytea, bytea) FROM PUBLIC;

-- 3. Compteur App Attest : un seul UPDATE conditionnel. Le verrou de ligne sérialise deux assertions de même
--    compteur : une seule rend vrai. Ne pas le remplacer par SELECT puis UPDATE.
CREATE FUNCTION advance_app_attest_counter(p_device uuid, p_key_id bytea, p_counter bigint)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_session uuid := nullif(current_setting('app.operator_id', true), '')::uuid;
  v_status text;
BEGIN
  IF v_session IS NULL THEN
    RAISE EXCEPTION 'App Attest : prestataire de session absent' USING ERRCODE = 'CL059';
  END IF;
  IF p_counter IS NULL OR p_counter < 0 OR p_counter > 4294967295 THEN
    RAISE EXCEPTION 'App Attest : compteur hors plage' USING ERRCODE = 'CL059';
  END IF;
  SELECT d.status INTO v_status FROM device d WHERE d.id = p_device AND d.operator_id = v_session;
  IF NOT FOUND OR v_status = 'REVOKED' THEN
    RAISE EXCEPTION 'App Attest : appareil refusé' USING ERRCODE = 'CL059';
  END IF;
  UPDATE device_app_attest_key k SET counter = p_counter, updated_at = now()
    FROM device d
   WHERE k.device_id = p_device AND k.key_id = p_key_id AND k.counter < p_counter
     AND k.operator_id = v_session AND d.id = k.device_id AND d.status <> 'REVOKED';
  RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION advance_app_attest_counter(uuid, bytea, bigint) FROM PUBLIC;
