-- Migration 0101 : classement des anomalies, modèles de téléphone, modèle du terminal (mission 11b
-- routes-backoffice, lot WP01 ; research D1, D4, D9 ; interfaces.md §2 ; FR-009, FR-010, FR-015 à FR-017).
-- AUCUNE écriture au grand livre. Les droits d'EXECUTE et de table sont posés par post-roles.sql §14 (rejoué après
-- chaque série par migrate.ts : tout GRANT ou REVOKE de ce fichier serait défait par le rejeu de roles.sql).
-- Fonctions à faire relire par une personne : classify_anomaly, set_device_model, upsert_phone_model.
-- Écart au texte d'interfaces.md : le search_path des fonctions DEFINER est `public, pg_temp` (pg_temp en DERNIER,
-- donc écarté de la recherche), comme les autres fonctions DEFINER et comme l'exige tests_definer_search_path.sql.
--
-- Erreurs (traduites par apps/api/src/errors/sqlstate-map.ts, lot WP07) :
--   CL066  anomalie introuvable ou d'un autre prestataire                -> 404 NOT_FOUND
--   CL067  type d'anomalie non classable                                 -> 422 VALIDATION_FAILED
--          (reason ANOMALY_KIND_NOT_CLASSIFIABLE)
--   CL068  anomalie déjà traitée (statut <> OPEN)                        -> 409 CONFLICT_STATE
--   CL069  motif vide ou de plus de 500 caractères                       -> 422 VALIDATION_FAILED

-- 1. Types classables (D1) : la liste est écrite UNE fois, ici ---------------------------------------------------
CREATE FUNCTION anomaly_classifiable(p_kind text) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(p_kind IN ('CASH_DIFF', 'CLOCK_SKEW', 'CARD_VELOCITY', 'IDEMPOTENCY_CONFLICT', 'CHAIN_BROKEN',
                    'COUNTER_DUPLICATE', 'COUNTER_TIME_INVERSION', 'UID_MISMATCH', 'RETIRED_IDENTITY',
                    'SIGNATURE_MISMATCH'), false)
$$;
REVOKE ALL ON FUNCTION anomaly_classifiable(text) FROM PUBLIC;

-- 2. Colonnes de classement -----------------------------------------------------------------------------------
ALTER TABLE anomaly
  ADD COLUMN classified_by uuid REFERENCES app_user(id),
  ADD COLUMN classified_at timestamptz,
  ADD COLUMN classification_reason text;
-- Les trois colonnes ensemble ou aucune ; motif de 1 à 500 caractères ; une anomalie classée est close SANS
-- écriture de résolution et d'un type classable (aucune anomalie d'argent n'est classable).
ALTER TABLE anomaly ADD CONSTRAINT anomaly_classification_chk CHECK (
  (classified_by IS NULL AND classified_at IS NULL AND classification_reason IS NULL)
  OR (classified_by IS NOT NULL AND classified_at IS NOT NULL
      AND classification_reason IS NOT NULL AND char_length(classification_reason) BETWEEN 1 AND 500
      AND status = 'RESOLVED' AND resolution_tx_id IS NULL AND anomaly_classifiable(kind)));

-- 3. classify_anomaly -------------------------------------------------------------------------------------------
CREATE FUNCTION classify_anomaly(p_anomaly uuid, p_reason text, p_actor uuid) RETURNS anomaly
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_operator uuid := nullif(current_setting('app.operator_id', true), '')::uuid;
  v_reason text := btrim(p_reason);
  a anomaly%ROWTYPE;
BEGIN
  IF v_reason IS NULL OR char_length(v_reason) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'Classement : motif de 1 à 500 caractères requis' USING ERRCODE = 'CL069';
  END IF;
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'Classement : auteur requis' USING ERRCODE = 'CL001';
  END IF;
  -- Prestataire de la session (équivalent de la RLS de l'appelant) : sans session, rien n'est visible.
  SELECT * INTO a FROM anomaly WHERE id = p_anomaly AND operator_id = v_operator FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Anomalie introuvable' USING ERRCODE = 'CL066';
  END IF;
  IF NOT anomaly_classifiable(a.kind) THEN
    RAISE EXCEPTION 'Anomalie de type % : non classable', a.kind USING ERRCODE = 'CL067';
  END IF;
  IF a.status <> 'OPEN' THEN
    RAISE EXCEPTION 'Anomalie déjà traitée' USING ERRCODE = 'CL068';
  END IF;
  -- resolution_tx_id n'est jamais écrit ; aucune ligne journal_transaction ni posting.
  UPDATE anomaly SET status = 'RESOLVED', classified_by = p_actor, classified_at = now(),
                     classification_reason = v_reason
   WHERE id = a.id RETURNING * INTO a;
  RETURN a;
END $$;
REVOKE ALL ON FUNCTION classify_anomaly(uuid, text, uuid) FROM PUBLIC;

-- 4. Modèles de téléphone (D9) : table de plateforme, sans prestataire ni donnée personnelle ------------------
CREATE FUNCTION normalize_phone_model(p text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT lower(btrim(regexp_replace(p, '\s+', ' ', 'g')))
$$;
REVOKE ALL ON FUNCTION normalize_phone_model(text) FROM PUBLIC;

CREATE TABLE phone_model (
  manufacturer text NOT NULL,
  model        text NOT NULL,
  nfc_level    text NOT NULL CHECK (nfc_level IN ('RECOMMENDED', 'TOLERATED')),
  measured_at  date NOT NULL,
  updated_by   uuid NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (manufacturer, model),
  CHECK (char_length(manufacturer) BETWEEN 1 AND 100 AND manufacturer = normalize_phone_model(manufacturer)),
  CHECK (char_length(model) BETWEEN 1 AND 100 AND model = normalize_phone_model(model))
);

CREATE FUNCTION upsert_phone_model(p_manufacturer text, p_model text, p_level text, p_measured date,
                                   p_actor uuid) RETURNS phone_model
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_manufacturer text := normalize_phone_model(p_manufacturer);
  v_model text := normalize_phone_model(p_model);
  r phone_model%ROWTYPE;
BEGIN
  IF v_manufacturer IS NULL OR char_length(v_manufacturer) NOT BETWEEN 1 AND 100
     OR v_model IS NULL OR char_length(v_model) NOT BETWEEN 1 AND 100
     OR p_level IS NULL OR p_level NOT IN ('RECOMMENDED', 'TOLERATED')
     OR p_measured IS NULL OR p_actor IS NULL THEN
    RAISE EXCEPTION 'Modèle de téléphone invalide' USING ERRCODE = 'CL001';
  END IF;
  INSERT INTO phone_model AS m (manufacturer, model, nfc_level, measured_at, updated_by)
  VALUES (v_manufacturer, v_model, p_level, p_measured, p_actor)
  ON CONFLICT (manufacturer, model) DO UPDATE
    SET nfc_level = EXCLUDED.nfc_level, measured_at = EXCLUDED.measured_at,
        updated_by = EXCLUDED.updated_by, updated_at = now()
  RETURNING m.* INTO r;
  RETURN r;
END $$;
REVOKE ALL ON FUNCTION upsert_phone_model(text, text, text, date, uuid) FROM PUBLIC;

CREATE FUNCTION delete_phone_model(p_manufacturer text, p_model text, p_actor uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_count integer;
BEGIN
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'Modèle de téléphone : auteur requis' USING ERRCODE = 'CL001';
  END IF;
  DELETE FROM phone_model
   WHERE manufacturer = normalize_phone_model(p_manufacturer) AND model = normalize_phone_model(p_model);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count > 0;
END $$;
REVOKE ALL ON FUNCTION delete_phone_model(text, text, uuid) FROM PUBLIC;

-- 5. Modèle déclaré par le terminal -----------------------------------------------------------------------------
-- Constat (preuve dans la note de lane) : enroll_device (15 arguments, 0095) et record_device_heartbeat (0022)
-- sont des fonctions DEFINER, et cashless_app n'a aucun UPDATE de colonne sur manufacturer ni model. Les changer de
-- signature casserait des suites existantes hors de la carte du lot (tests_device_app_attest.sql : « 15 arguments »,
-- « une seule signature » ; tests_device_enrollment.sql et tests_enrollment_event_state.sql : signature explicite).
-- On ajoute donc une fonction étroite, appelée par l'API dans la même transaction que l'enrôlement ou le signal de
-- vie ; les corps de enroll_device et record_device_heartbeat ne sont pas touchés.
ALTER TABLE device
  ADD COLUMN manufacturer text,
  ADD COLUMN model text,
  ADD CONSTRAINT device_manufacturer_chk CHECK (
    manufacturer IS NULL
    OR (char_length(manufacturer) BETWEEN 1 AND 100 AND manufacturer = normalize_phone_model(manufacturer))),
  ADD CONSTRAINT device_model_chk CHECK (
    model IS NULL OR (char_length(model) BETWEEN 1 AND 100 AND model = normalize_phone_model(model)));

-- Une valeur absente (NULL) n'efface pas la valeur connue. Terminal du prestataire de la session seulement.
CREATE FUNCTION set_device_model(p_device uuid, p_manufacturer text, p_model text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_operator uuid := nullif(current_setting('app.operator_id', true), '')::uuid;
  v_manufacturer text := normalize_phone_model(p_manufacturer);
  v_model text := normalize_phone_model(p_model);
  v_status text;
BEGIN
  IF v_operator IS NULL OR p_device IS NULL THEN
    RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found';
  END IF;
  IF (p_manufacturer IS NOT NULL AND char_length(v_manufacturer) NOT BETWEEN 1 AND 100)
     OR (p_model IS NOT NULL AND char_length(v_model) NOT BETWEEN 1 AND 100) THEN
    RAISE EXCEPTION 'Modèle du terminal invalide' USING ERRCODE = 'CL001';
  END IF;
  SELECT status INTO v_status FROM device WHERE id = p_device AND operator_id = v_operator FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  IF v_status = 'REVOKED' THEN
    RAISE EXCEPTION 'Terminal révoqué' USING ERRCODE = 'insufficient_privilege';
  END IF;
  UPDATE device SET manufacturer = coalesce(v_manufacturer, manufacturer), model = coalesce(v_model, model)
   WHERE id = p_device AND operator_id = v_operator;
END $$;
REVOKE ALL ON FUNCTION set_device_model(uuid, text, text) FROM PUBLIC;

-- 6. Limite de débit de la recherche par numéro (D8) : « 20 dernières 60 s » d'un auteur ---------------------
CREATE INDEX IF NOT EXISTS audit_log_actor_action_time_idx ON audit_log (actor_id, action, occurred_at);
