-- Migration 0022 : enrôlement et statut des terminaux (S5 ; mission identite-enrolement-terminaux,
-- lot WP03 ; SPECIFICATION §8.1, §8.2, §14.2 S5 ; sync_protocol §3.1, §3.3 ; data-model « Terminal »,
-- « Code d'enrôlement », « Jeton de rafraîchissement », « Essais », « Historique », « Fonctions » ;
-- contracts/enrollment.md, contracts/device-lifecycle.md ; research R-11, R-16, R-17 ; ADR-109).
--
-- Contenu :
--   1. `device` : colonnes de l'enrôlement (version de l'app, attestation, fin du certificat, code
--      consommé, motif du dernier statut) ; `serial` unique PAR PRESTATAIRE parmi les terminaux non
--      révoqués (ADR-109, voir §1).
--   2. Tables S5 : `device_enrollment_code`, `device_refresh_token`, `device_status_history` (ajout
--      seul), `device_enrollment_attempt` (essais, purge à 24 h). RLS activée et forcée sur les quatre.
--   3. Fonctions SECURITY DEFINER, `search_path = public, pg_temp` (OP-N59), EXECUTE retiré à PUBLIC.
--      Les droits par rôle sont posés par `post-roles.sql` (lot WP07), jamais ici :
--        create_device_enrollment_code  émission d'un code (portée, mode, durée, auteur)
--        check_device_enrollment_code   lecture seule du code avant l'attestation (étapes 3 et 4 du
--                                       contrat) ; rend le prestataire, l'affectation et le mode
--        enroll_device                  enrôlement atomique (étape 9) ; seule écriture de `public_key`,
--                                       `agreement_public_key`, `cert_sha256` (OP-N63)
--        set_device_status              seule écriture de `status` ; REVOKED définitif
--        record_device_heartbeat        `last_seen_at`, `app_version`
--        record_enrollment_attempt      trace d'un essai (transaction distincte de l'enrôlement)
--        enrollment_attempts_exceeded   limites R-16 : 10 par code et par heure, 30 par adresse
--        purge_device_enrollment_attempts  purge des essais de plus de 24 h
--
-- Aucune de ces fonctions ne s'appuie sur la RLS (propriétaire superutilisateur sur le poste local, voir
-- 0019, 0020) : chaque lecture et chaque écriture nomment le prestataire, celui de la session
-- (`app.operator_id`) ou, pour l'enrôlement (route sans compte ni prestataire), celui du code.
-- Hypothèse sur le propriétaire (à revoir avec les droits du lot WP07) : les quatre tables S5 ont la
-- RLS FORCÉE, qui s'applique aussi au propriétaire des tables, donc aux fonctions SECURITY DEFINER qu'il
-- possède, sauf s'il ignore la RLS (superutilisateur ou BYPASSRLS). `enroll_device`,
-- `check_device_enrollment_code`, `record_enrollment_attempt`, `enrollment_attempts_exceeded` et
-- `purge_device_enrollment_attempts` lisent et écrivent ces tables SANS prestataire de session :
-- elles SUPPOSENT un propriétaire qui ignore la RLS (cas du poste local, même hypothèse que 0019 et
-- 0020). Avec un propriétaire soumis à la RLS, l'échec est fermé mais total : tout code paraît inconnu
-- (CL025), aucun enrôlement ne passe, l'écriture d'un essai est refusée par la clause WITH CHECK
-- (42501) et les limites R-16 ne voient aucun essai. Ce fichier ne change pas ce comportement ; le
-- choix du propriétaire (ou une politique dédiée) relève de WP07.
--
-- Erreurs (traduites par apps/api/src/errors/sqlstate-map.ts, lot WP12) :
--   CL001   paramètre invalide                                        -> 422 VALIDATION_FAILED (existant)
--   CL025   code d'enrôlement inconnu ou déjà utilisé (refus unique,
--           aucune distinction entre les deux, NFR-006)               -> 422 ENROLLMENT_CODE_INVALID
--   CL026   code d'enrôlement expiré                                  -> 422 ENROLLMENT_CODE_EXPIRED
--   CL027   mode refusé : PAIRED_TPE (V2), TOPUP_DESK sur iOS,
--           téléphone personnel hors KEYPAD_TPE                       -> 422 DEVICE_MODE_NOT_ALLOWED
--   CL028   `serial` déjà porté par un terminal non révoqué du même
--           prestataire                                               -> 409 DEVICE_SERIAL_IN_USE
--   CL029   transition de statut interdite (dont toute sortie de
--           REVOKED, définitif)                                       -> 409 CONFLICT_STATE
--   42501   terminal révoqué (battement de cœur) : même SQLSTATE que le schéma de référence
--           (`open_offline_batch`), déjà traduit en 403 DEVICE_REVOKED
--   P0002   objet introuvable, d'un autre prestataire ou hors du périmètre de l'auteur -> 404 (existant)

-- 1. Terminal --------------------------------------------------------------------------------------
ALTER TABLE device ADD COLUMN app_version text
  CONSTRAINT device_app_version CHECK (app_version IS NULL OR length(app_version) BETWEEN 1 AND 64);
ALTER TABLE device ADD COLUMN attestation_kind text
  CONSTRAINT device_attestation_kind
  CHECK (attestation_kind IS NULL OR attestation_kind IN ('ANDROID_KEY_ATTESTATION','IOS_APP_ATTEST'));
ALTER TABLE device ADD COLUMN attestation_security_level text
  CONSTRAINT device_attestation_security_level
  CHECK (attestation_security_level IS NULL
         OR attestation_security_level IN ('TRUSTED_ENVIRONMENT','STRONGBOX'));
ALTER TABLE device ADD COLUMN cert_not_after timestamptz;
ALTER TABLE device ADD COLUMN enrolled_at timestamptz;
ALTER TABLE device ADD COLUMN enrollment_code_id uuid;   -- clé étrangère posée après la création du code
ALTER TABLE device ADD COLUMN status_reason text
  CONSTRAINT device_status_reason CHECK (status_reason IS NULL OR length(status_reason) BETWEEN 1 AND 500);
-- Attestation cohérente avec le système : Android -> attestation de clé (niveau TEE ou StrongBox
-- obligatoire), iOS -> App Attest (aucun niveau). Les terminaux d'avant la mission n'ont aucune
-- attestation (colonnes NULL) : la contrainte les laisse passer.
ALTER TABLE device ADD CONSTRAINT device_attestation_os CHECK (
  attestation_kind IS NULL
  OR (os = 'ANDROID' AND attestation_kind = 'ANDROID_KEY_ATTESTATION' AND attestation_security_level IS NOT NULL)
  OR (os = 'IOS' AND attestation_kind = 'IOS_APP_ATTEST' AND attestation_security_level IS NULL));
ALTER TABLE device ADD CONSTRAINT device_attestation_level_kind
  CHECK (attestation_security_level IS NULL OR attestation_kind IS NOT NULL);
-- Un terminal enrôlé par la mission porte ses clés, son certificat et l'empreinte de celui-ci.
ALTER TABLE device ADD CONSTRAINT device_enrolled_keys CHECK (
  enrollment_code_id IS NULL
  OR (public_key IS NOT NULL AND agreement_public_key IS NOT NULL AND cert_sha256 IS NOT NULL
      AND cert_not_after IS NOT NULL AND enrolled_at IS NOT NULL AND attestation_kind IS NOT NULL));
-- iOS : jamais de caisse de recharge (data-model, invariants du terminal ; la contrainte existante
-- interdit déjà le NFC). Renforcement : tenu par la table et pas seulement par enroll_device.
ALTER TABLE device ADD CONSTRAINT device_ios_no_topup_desk CHECK (os <> 'IOS' OR app_mode <> 'TOPUP_DESK');
-- Une seule ligne de terminal par code consommé.
CREATE UNIQUE INDEX device_enrollment_code_once ON device (enrollment_code_id)
  WHERE enrollment_code_id IS NOT NULL;

-- `serial` unique dans le prestataire (ADR-109, décision du porteur ; research, constat n° 3) : écart
-- au schéma de référence, qui l'imposait tous prestataires confondus. Avec l'unicité globale, un
-- prestataire bloquait le `serial` d'un autre et apprenait son existence par le refus. Renforcement
-- du cloisonnement. Le nom de l'index est conservé : le test de référence « serial déjà utilisé par
-- un terminal actif refusé » (même prestataire) attend `%device_serial_active%`.
DROP INDEX device_serial_active;
CREATE UNIQUE INDEX device_serial_active ON device (operator_id, serial) WHERE status <> 'REVOKED';
-- Calcul de next_seq : tous les terminaux d'un serial dans un prestataire, révoqués compris.
CREATE INDEX device_operator_serial_idx ON device (operator_id, serial);

-- 2. Tables S5 -------------------------------------------------------------------------------------
-- Code d'enrôlement : l'empreinte seule (HMAC-SHA256 à clé hors base, research R-13), jamais le code.
CREATE TABLE device_enrollment_code (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id    uuid NOT NULL REFERENCES party(id),
  code_hash      bytea NOT NULL
                 CONSTRAINT device_enrollment_code_hash CHECK (octet_length(code_hash) = 32),
  event_id       uuid NOT NULL REFERENCES event(id),          -- obligatoire (analyse U1, 19/10/2026)
  pos_id         uuid REFERENCES point_of_sale(id),
  app_mode       text CONSTRAINT device_enrollment_code_app_mode
                 CHECK (app_mode IS NULL OR app_mode IN ('CATALOG_POS','KEYPAD_TPE','TOPUP_DESK')),
  personal_phone boolean NOT NULL,                            -- sans défaut : choisi à l'émission (R-17)
  created_by     uuid NOT NULL REFERENCES app_user(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz NOT NULL,
  used_at        timestamptz,
  device_id      uuid REFERENCES device(id),
  CONSTRAINT device_enrollment_code_hash_key UNIQUE (code_hash),  -- tous prestataires (route sans compte)
  CONSTRAINT device_enrollment_code_personal_phone
    CHECK (NOT personal_phone OR app_mode IS NOT DISTINCT FROM 'KEYPAD_TPE'),  -- NULL : refusé
  CONSTRAINT device_enrollment_code_ttl
    CHECK (expires_at >= created_at + interval '300 seconds'
           AND expires_at <= created_at + interval '604800 seconds'),
  CONSTRAINT device_enrollment_code_use CHECK ((used_at IS NULL) = (device_id IS NULL))
);
CREATE UNIQUE INDEX device_enrollment_code_device_key ON device_enrollment_code (device_id)
  WHERE device_id IS NOT NULL;
CREATE INDEX device_enrollment_code_open_idx ON device_enrollment_code (operator_id, event_id, expires_at)
  WHERE used_at IS NULL;
ALTER TABLE device ADD CONSTRAINT device_enrollment_code_fk
  FOREIGN KEY (enrollment_code_id) REFERENCES device_enrollment_code(id);

-- Jetons de rafraîchissement : l'empreinte SHA-256 seule ; une famille par enrôlement. La rotation, la
-- grâce de 60 s et la révocation d'une famille sont tenues par le lot WP04 (migration 0023).
CREATE TABLE device_refresh_token (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id    uuid NOT NULL REFERENCES party(id),
  device_id      uuid NOT NULL REFERENCES device(id),
  family_id      uuid NOT NULL,
  token_hash     bytea NOT NULL
                 CONSTRAINT device_refresh_token_hash CHECK (octet_length(token_hash) = 32),
  created_at     timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz NOT NULL,
  consumed_at    timestamptz,
  revoked_at     timestamptz,
  revoked_reason text CONSTRAINT device_refresh_token_revoked_reason
                 CHECK (revoked_reason IS NULL
                        OR revoked_reason IN ('REUSE','DEVICE_REVOKED','REENROLLED','GRACE_REPLACED')),
  successor_id   uuid REFERENCES device_refresh_token(id),
  grace_used_at  timestamptz,
  CONSTRAINT device_refresh_token_hash_key UNIQUE (token_hash),
  CONSTRAINT device_refresh_token_expiry CHECK (expires_at > created_at),
  CONSTRAINT device_refresh_token_revocation CHECK ((revoked_at IS NULL) = (revoked_reason IS NULL)),
  CONSTRAINT device_refresh_token_successor CHECK (successor_id IS NULL OR consumed_at IS NOT NULL),
  CONSTRAINT device_refresh_token_grace CHECK (grace_used_at IS NULL OR consumed_at IS NOT NULL),
  CONSTRAINT device_refresh_token_not_self CHECK (successor_id IS NULL OR successor_id <> id)
);
-- Au plus un jeton vivant (ni consommé ni révoqué) par famille.
CREATE UNIQUE INDEX device_refresh_token_one_live ON device_refresh_token (family_id)
  WHERE consumed_at IS NULL AND revoked_at IS NULL;
CREATE INDEX device_refresh_token_device_idx ON device_refresh_token (device_id) WHERE revoked_at IS NULL;
CREATE INDEX device_refresh_token_family_idx ON device_refresh_token (family_id);

-- Historique des statuts : ajout seul, écrit par enroll_device (NULL -> ACTIVE) et set_device_status.
CREATE TABLE device_status_history (
  id          bigserial PRIMARY KEY,
  operator_id uuid NOT NULL REFERENCES party(id),
  device_id   uuid NOT NULL REFERENCES device(id),
  from_status text CONSTRAINT device_status_history_from
              CHECK (from_status IS NULL OR from_status IN ('ACTIVE','SUSPENDED','REVOKED')),
  to_status   text NOT NULL CONSTRAINT device_status_history_to
              CHECK (to_status IN ('ACTIVE','SUSPENDED','REVOKED')),
  reason      text NOT NULL CONSTRAINT device_status_history_reason
              CHECK (length(reason) BETWEEN 1 AND 500),
  actor_id    uuid REFERENCES app_user(id),                 -- NULL : enrôlement (aucune personne)
  at          timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT device_status_history_change CHECK (from_status IS DISTINCT FROM to_status),
  CONSTRAINT device_status_history_origin CHECK (from_status IS NOT NULL OR to_status = 'ACTIVE'),
  CONSTRAINT device_status_history_final CHECK (from_status IS DISTINCT FROM 'REVOKED'),
  CONSTRAINT device_status_history_actor CHECK (from_status IS NULL OR actor_id IS NOT NULL)
);
CREATE INDEX device_status_history_device_idx ON device_status_history (device_id, at);
CREATE TRIGGER device_status_history_immutable BEFORE UPDATE OR DELETE ON device_status_history
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- Essais d'enrôlement (R-16) : écrits hors de la transaction d'enrôlement (un refus annulé laisse sa
-- trace), purgés à 24 h. Code inconnu : ni prestataire ni empreinte (data-model).
CREATE TABLE device_enrollment_attempt (
  id          bigserial PRIMARY KEY,
  operator_id uuid REFERENCES party(id),
  code_hash   bytea CONSTRAINT device_enrollment_attempt_code_hash
              CHECK (code_hash IS NULL OR octet_length(code_hash) = 32),
  address     inet NOT NULL,
  at          timestamptz NOT NULL DEFAULT clock_timestamp(),
  result      text NOT NULL CONSTRAINT device_enrollment_attempt_result
              CHECK (result IN ('ENROLLED','CODE_INVALID','CODE_EXPIRED','MODE_NOT_ALLOWED',
                                'ATTESTATION_FAILED','SERIAL_IN_USE','VALIDATION_FAILED','RATE_LIMITED')),
  CONSTRAINT device_enrollment_attempt_known_code CHECK ((operator_id IS NULL) = (code_hash IS NULL))
);
CREATE INDEX device_enrollment_attempt_code_idx ON device_enrollment_attempt (code_hash, at)
  WHERE code_hash IS NOT NULL;
CREATE INDEX device_enrollment_attempt_address_idx ON device_enrollment_attempt (address, at);
CREATE INDEX device_enrollment_attempt_at_idx ON device_enrollment_attempt (at);
-- Ajout seul, sauf la purge (DELETE par purge_device_enrollment_attempts).
CREATE TRIGGER device_enrollment_attempt_immutable BEFORE UPDATE ON device_enrollment_attempt
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- RLS activée et forcée sur les quatre tables, même politique que les tables du schéma.
-- `device_enrollment_attempt` : choix de la politique commune plutôt qu'une table hors RLS. Une ligne
-- d'un code inconnu (operator_id NULL) n'est visible d'AUCUN rôle soumis à la RLS ; une ligne d'un code
-- connu n'est visible que de son prestataire. Les seules lectures et écritures prévues passent par les
-- fonctions SECURITY DEFINER ci-dessous, qui nomment le code ou l'adresse. Aucune table de la mission
-- n'échappe ainsi au cloisonnement, et un droit SELECT accordé par erreur ne révèle rien d'un autre
-- prestataire ni les adresses des essais sur codes inconnus.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['device_enrollment_code','device_refresh_token','device_status_history',
                           'device_enrollment_attempt'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
                     USING (operator_id = current_setting('app.operator_id', true)::uuid)
                     WITH CHECK (operator_id = current_setting('app.operator_id', true)::uuid)$p$, t);
  END LOOP;
END $$;

-- 3. Fonctions -------------------------------------------------------------------------------------
-- Auteur autorisé sur un événement : personne ACTIVE du prestataire, OPERATOR_ADMIN du prestataire ou
-- ORGANIZER_ADMIN de l'organisateur de l'événement (attribution non retirée). Interne : appelée par les
-- fonctions DEFINER de ce fichier seulement.
CREATE FUNCTION device_admin_allowed(p_operator uuid, p_event uuid, p_actor uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM app_user u
      JOIN role_assignment a ON a.user_id = u.id AND a.revoked_at IS NULL
     WHERE u.id = p_actor AND u.operator_id = p_operator AND u.status = 'ACTIVE'
       AND a.operator_id = p_operator
       AND ((a.role = 'OPERATOR_ADMIN' AND a.scope_type = 'OPERATOR' AND a.scope_id = p_operator)
            OR (a.role = 'ORGANIZER_ADMIN' AND a.scope_type = 'ORGANIZER' AND p_event IS NOT NULL
                AND a.scope_id = (SELECT e.organizer_id FROM event e
                                   WHERE e.id = p_event AND e.operator_id = p_operator))))
$$;
REVOKE ALL ON FUNCTION device_admin_allowed(uuid, uuid, uuid) FROM PUBLIC;

-- 3a. Émission d'un code ---------------------------------------------------------------------------
-- p_ttl_seconds NULL : 24 h (contrat). Rend l'identifiant du code ; le code en clair n'existe que dans la
-- réponse de l'API (route transient).
CREATE FUNCTION create_device_enrollment_code(p_code_hash bytea, p_event uuid, p_pos uuid, p_mode text,
                                              p_personal_phone boolean, p_ttl_seconds int, p_actor uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_operator uuid := nullif(current_setting('app.operator_id', true), '')::uuid;
  v_ttl int := coalesce(p_ttl_seconds, 86400);
  v_pos_event uuid;
  v_id uuid;
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
  INSERT INTO device_enrollment_code (operator_id, code_hash, event_id, pos_id, app_mode, personal_phone,
                                      created_by, created_at, expires_at)
  VALUES (v_operator, p_code_hash, p_event, p_pos, p_mode, p_personal_phone, p_actor, now(),
          now() + make_interval(secs => v_ttl))
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION create_device_enrollment_code(bytea, uuid, uuid, text, boolean, int, uuid) FROM PUBLIC;

-- 3b. Lecture du code avant l'attestation (contrat, étapes 3 et 4) ----------------------------------
-- Route sans compte : la session n'a pas de prestataire ; s'il y en a un et qu'il diffère de celui du
-- code, le code est traité comme inconnu. Aucun verrou, aucune écriture : enroll_device refait tous les
-- contrôles sous verrou. Rend le prestataire (sujet du certificat, O=) et l'affectation.
CREATE FUNCTION check_device_enrollment_code(p_code_hash bytea, p_os text)
RETURNS TABLE (operator_id uuid, event_id uuid, pos_id uuid, app_mode text, personal_phone boolean,
               expires_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE
  v_session uuid := nullif(current_setting('app.operator_id', true), '')::uuid;
  c device_enrollment_code%ROWTYPE;
  v_mode text;
BEGIN
  IF p_os IS NULL OR p_os NOT IN ('ANDROID','IOS') THEN
    RAISE EXCEPTION 'Enrôlement : système inconnu' USING ERRCODE = 'CL001';
  END IF;
  IF p_code_hash IS NOT NULL AND octet_length(p_code_hash) = 32 THEN
    SELECT * INTO c FROM device_enrollment_code WHERE code_hash = p_code_hash;
  END IF;
  IF c.id IS NULL OR c.used_at IS NOT NULL
     OR (v_session IS NOT NULL AND v_session IS DISTINCT FROM c.operator_id) THEN
    RAISE EXCEPTION 'Code d''enrôlement invalide' USING ERRCODE = 'CL025';
  END IF;
  IF c.expires_at <= now() THEN
    RAISE EXCEPTION 'Code d''enrôlement expiré' USING ERRCODE = 'CL026';
  END IF;
  v_mode := coalesce(c.app_mode, 'CATALOG_POS');
  IF (p_os = 'IOS' AND v_mode = 'TOPUP_DESK') OR (c.personal_phone AND v_mode <> 'KEYPAD_TPE') THEN
    RAISE EXCEPTION 'Mode % refusé pour ce terminal', v_mode USING ERRCODE = 'CL027';
  END IF;
  RETURN QUERY SELECT c.operator_id, c.event_id, c.pos_id, v_mode, c.personal_phone, c.expires_at;
END $$;
REVOKE ALL ON FUNCTION check_device_enrollment_code(bytea, text) FROM PUBLIC;

-- 3c. Enrôlement (contrat, étape 9), en une transaction ---------------------------------------------
-- Signature de data-model, plus p_device_id (facultatif) : le certificat porte CN=<device_id> et il est
-- émis AVANT cet appel (étape 8) ; l'API tire donc l'identifiant et le passe ici. NULL : tiré ici.
-- Rend device_id et next_seq.
CREATE FUNCTION enroll_device(p_code_hash bytea, p_serial text, p_os text, p_app_version text,
                              p_public_key bytea, p_agreement_key bytea, p_cert_sha256 bytea,
                              p_cert_not_after timestamptz, p_attestation_kind text, p_security_level text,
                              p_refresh_hash bytea, p_refresh_expires timestamptz,
                              p_device_id uuid DEFAULT NULL)
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

-- 3d. Statut (seule écriture permise de `status`) ----------------------------------------------------
-- ACTIVE <-> SUSPENDED ; ACTIVE, SUSPENDED -> REVOKED ; REVOKED définitif. Motif obligatoire. Vers
-- REVOKED : toutes les familles de jetons du terminal révoquées dans la même transaction.
CREATE FUNCTION set_device_status(p_device uuid, p_to text, p_reason text, p_actor uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_operator uuid := nullif(current_setting('app.operator_id', true), '')::uuid;
  d device%ROWTYPE;
BEGIN
  IF v_operator IS NULL OR p_device IS NULL THEN
    RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found';
  END IF;
  IF p_to IS NULL OR p_to NOT IN ('ACTIVE','SUSPENDED','REVOKED') THEN
    RAISE EXCEPTION 'Statut de terminal inconnu' USING ERRCODE = 'CL001';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) = 0 OR length(p_reason) > 500 THEN
    RAISE EXCEPTION 'Motif obligatoire (1 à 500 caractères)' USING ERRCODE = 'CL001';
  END IF;
  SELECT * INTO d FROM device WHERE id = p_device AND operator_id = v_operator FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  IF p_actor IS NULL OR NOT device_admin_allowed(v_operator, d.event_id, p_actor) THEN
    RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found';
  END IF;
  IF NOT ((d.status = 'ACTIVE' AND p_to IN ('SUSPENDED','REVOKED'))
          OR (d.status = 'SUSPENDED' AND p_to IN ('ACTIVE','REVOKED'))) THEN
    RAISE EXCEPTION 'Transition de statut interdite : % -> %', d.status, p_to USING ERRCODE = 'CL029';
  END IF;
  UPDATE device SET status = p_to, status_reason = p_reason WHERE id = d.id;
  IF p_to = 'REVOKED' THEN
    UPDATE device_refresh_token SET revoked_at = now(), revoked_reason = 'DEVICE_REVOKED'
     WHERE device_id = d.id AND operator_id = v_operator AND revoked_at IS NULL;
  END IF;
  INSERT INTO device_status_history (operator_id, device_id, from_status, to_status, reason, actor_id)
  VALUES (v_operator, d.id, d.status, p_to, p_reason, p_actor);
END $$;
REVOKE ALL ON FUNCTION set_device_status(uuid, text, text, uuid) FROM PUBLIC;

-- 3e. Battement de cœur ------------------------------------------------------------------------------
-- p_device_time : heure annoncée par le terminal, non conservée (l'API la compare à server_time).
-- Terminal révoqué : 42501, comme le schéma de référence (403 DEVICE_REVOKED). SUSPENDED accepté.
CREATE FUNCTION record_device_heartbeat(p_device uuid, p_app_version text, p_device_time timestamptz)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_operator uuid := nullif(current_setting('app.operator_id', true), '')::uuid;
  v_status text;
BEGIN
  IF v_operator IS NULL OR p_device IS NULL THEN
    RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found';
  END IF;
  IF p_app_version IS NOT NULL AND length(p_app_version) NOT BETWEEN 1 AND 64 THEN
    RAISE EXCEPTION 'Version de l''application invalide' USING ERRCODE = 'CL001';
  END IF;
  SELECT status INTO v_status FROM device WHERE id = p_device AND operator_id = v_operator FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  IF v_status = 'REVOKED' THEN
    RAISE EXCEPTION 'Terminal révoqué' USING ERRCODE = 'insufficient_privilege';
  END IF;
  UPDATE device SET last_seen_at = now(), app_version = coalesce(p_app_version, app_version)
   WHERE id = p_device AND operator_id = v_operator;
END $$;
REVOKE ALL ON FUNCTION record_device_heartbeat(uuid, text, timestamptz) FROM PUBLIC;

-- 3f. Essais d'enrôlement (R-16) -------------------------------------------------------------------
-- Appelées par l'API dans une transaction distincte de l'enrôlement. Sans prestataire de session.
-- Un code connu (utilisé ou non) : ligne rattachée à son prestataire et à son empreinte ; un code
-- inconnu : ni l'un ni l'autre (data-model). Les essais RATE_LIMITED ne comptent pas dans les limites
-- (sinon un blocage s'entretiendrait lui-même, comme claim_attempt en 0010).
CREATE FUNCTION record_enrollment_attempt(p_code_hash bytea, p_address inet, p_result text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_operator uuid; v_hash bytea;
BEGIN
  IF p_address IS NULL THEN
    RAISE EXCEPTION 'Essai d''enrôlement : adresse obligatoire' USING ERRCODE = 'CL001';
  END IF;
  IF p_result IS NULL OR p_result NOT IN ('ENROLLED','CODE_INVALID','CODE_EXPIRED','MODE_NOT_ALLOWED',
                                          'ATTESTATION_FAILED','SERIAL_IN_USE','VALIDATION_FAILED',
                                          'RATE_LIMITED') THEN
    RAISE EXCEPTION 'Essai d''enrôlement : résultat inconnu' USING ERRCODE = 'CL001';
  END IF;
  IF p_code_hash IS NOT NULL AND octet_length(p_code_hash) = 32 THEN
    SELECT c.operator_id, c.code_hash INTO v_operator, v_hash
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

-- Vrai si un nouvel essai dépasserait une limite : 10 essais du code dans l'heure, ou 30 de l'adresse.
CREATE FUNCTION enrollment_attempts_exceeded(p_code_hash bytea, p_address inet) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT (p_code_hash IS NOT NULL
          AND (SELECT count(*) FROM device_enrollment_attempt a
                WHERE a.code_hash = p_code_hash AND a.result <> 'RATE_LIMITED'
                  AND a.at > clock_timestamp() - interval '1 hour') >= 10)
      OR (p_address IS NOT NULL
          AND (SELECT count(*) FROM device_enrollment_attempt a
                WHERE a.address = p_address AND a.result <> 'RATE_LIMITED'
                  AND a.at > clock_timestamp() - interval '1 hour') >= 30)
$$;
REVOKE ALL ON FUNCTION enrollment_attempts_exceeded(bytea, inet) FROM PUBLIC;

-- Purge des essais de plus de 24 h ; rend le nombre de lignes retirées.
CREATE FUNCTION purge_device_enrollment_attempts() RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n bigint;
BEGIN
  DELETE FROM device_enrollment_attempt WHERE at < clock_timestamp() - interval '24 hours';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION purge_device_enrollment_attempts() FROM PUBLIC;
