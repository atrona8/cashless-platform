-- Migration 0043 : politique hors ligne contrôlée (mission hors-ligne-snapshots-lots, lot WP02 ;
-- spec FR-001 à FR-005, FR-027, FR-039, NFR-014 ; contracts/interfaces.md §1 et §2 ;
-- research R-02, R-03, R-20 (OP-N58), R-30.2 ; data-model « offline_policy »).
--
-- Contenu :
--   1. Données : les lignes `cash_topup_offline = true` sont remises à `false` (la contrainte
--      suivante refuserait la migration). Puis CHECK `offline_policy_cash_topup_off` : aucune
--      recharge espèces hors ligne (décision du porteur, 30/10/2026, R-02).
--      L'UPDATE passe par les déclencheurs existants : la version monte et l'historique garde la
--      trace du changement. `offline_policy_history` n'est pas touchée (immuable).
--      Contradiction signalée (R-02) : sync_protocol.md §5.4/§7.5 prévoit cette recharge ; la
--      décision du porteur l'emporte.
--   2. Déclencheur `offline_policy_scope` (BEFORE INSERT OR UPDATE, DEFINER) : contrôle de portée,
--      CL045. La portée (type, identifiant, prestataire) ne change plus après création.
--   3. `log_offline_policy` devient SECURITY DEFINER (OP-N58) : l'historique est écrit par la base
--      sous ses propres droits ; corps inchangé. (Les retraits de droits à `cashless_app` : WP08.)
--   4. Fonctions SECURITY DEFINER, `search_path = public, pg_temp` (règle de 0021), EXECUTE retiré
--      à PUBLIC. AUCUN GRANT et aucun REVOKE de table ici (WP08).
--        offline_policy_scope_operator  INTERNE : prestataire d'une portée, NULL si inconnue
--        offline_policy_actor_check     INTERNE : personne ACTIVE du prestataire
--        set_offline_policy             seul chemin d'écriture (crée ou remplace, version attendue)
--        clear_offline_policy           suppression avec version attendue
--        offline_policy_level           lecture d'un niveau (STABLE, NULL si aucun)
--        offline_max_exposure           risque maximal d'un événement (STABLE)
--
-- Hypothèse sur le propriétaire (comme 0022 et 0036) : les tables ont FORCE ROW LEVEL SECURITY et
-- le propriétaire des fonctions ignore la RLS (superutilisateur sur le poste local) ; aucune
-- fonction ne s'appuie donc sur la RLS : chaque lecture et écriture nomme `operator_id` (celui de
-- la portée) après le contrôle de prestataire.
--
-- Notes de comportement :
--   * `set_offline_policy` remplace TOUS les niveaux de la ligne : une clé absente ou nulle de
--     `p_values` remet la colonne à NULL (hérite). Une écriture sans changement de valeur monte
--     quand même la version (le déclencheur `bump_offline_policy_version` est inconditionnel).
--   * `clear_offline_policy` : la ligne d'historique `deleted` reprend `updated_by` de l'état
--     supprimé (un DELETE ne porte pas d'acteur) ; l'acteur est seulement contrôlé.
--
-- Erreurs (traduites par apps/api/src/errors/sqlstate-map.ts, lot WP01) :
--   CL001   valeur invalide (clé inconnue, montant négatif ou non entier, âge hors 0..86400,
--           type de portée inconnu)                                        -> 422 VALIDATION_FAILED
--   CL045   portée invalide : inconnue, d'un autre prestataire, OPERATOR_CEILING différent du
--           prestataire, portée modifiée                                   -> 404 NOT_FOUND
--   CL046   version attendue différente (ou absente sur ligne existante)   -> 409 CONFLICT_STATE
--   CL047   cash_topup_offline vrai                                        -> 422 VALIDATION_FAILED
--   P0002   acteur absent, d'un autre prestataire ou non ACTIVE ; événement d'un autre prestataire
--           (offline_max_exposure, via assert_tenant)                      -> 404

-- 1. Données et contrainte espèces ---------------------------------------------------------------
-- Remise à false AVANT la contrainte : pas de recharge espèces hors ligne (R-02, porteur 30/10/2026).
UPDATE offline_policy SET cash_topup_offline = false WHERE cash_topup_offline;
ALTER TABLE offline_policy
  ADD CONSTRAINT offline_policy_cash_topup_off CHECK (cash_topup_offline IS NOT TRUE);

-- 2. Fonctions internes ---------------------------------------------------------------------------
-- Prestataire d'une portée ; NULL si le type est inconnu ou l'objet n'existe pas (ou, pour
-- OPERATOR_CEILING, si l'identifiant n'est pas un prestataire). INTERNE : jamais accordée.
CREATE FUNCTION offline_policy_scope_operator(p_scope_type text, p_scope_id uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT CASE p_scope_type
    WHEN 'OPERATOR_CEILING' THEN (SELECT id FROM party WHERE id = p_scope_id AND kind = 'OPERATOR')
    WHEN 'ORGANIZER' THEN (SELECT operator_id FROM party WHERE id = p_scope_id AND kind = 'ORGANIZER')
    WHEN 'EVENT'     THEN (SELECT operator_id FROM event WHERE id = p_scope_id)
    WHEN 'DEVICE'    THEN (SELECT operator_id FROM device WHERE id = p_scope_id)
  END
$$;
REVOKE ALL ON FUNCTION offline_policy_scope_operator(text, uuid) FROM PUBLIC;

-- Personne ACTIVE du prestataire (motif de cash_actor_allowed ; les rôles restent contrôlés par
-- l'API, WP14). Absente, d'un autre prestataire ou non ACTIVE : P0002. INTERNE : jamais accordée.
CREATE FUNCTION offline_policy_actor_check(p_operator uuid, p_actor uuid) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF p_actor IS NULL OR NOT EXISTS (SELECT 1 FROM app_user u
       WHERE u.id = p_actor AND u.operator_id = p_operator AND u.status = 'ACTIVE') THEN
    RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found';
  END IF;
END $$;
REVOKE ALL ON FUNCTION offline_policy_actor_check(uuid, uuid) FROM PUBLIC;

-- 3. Déclencheur de portée ------------------------------------------------------------------------
CREATE FUNCTION offline_policy_scope_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.scope_type IS DISTINCT FROM OLD.scope_type
       OR NEW.scope_id IS DISTINCT FROM OLD.scope_id
       OR NEW.operator_id IS DISTINCT FROM OLD.operator_id) THEN
    RAISE EXCEPTION 'La portée d''une politique ne change pas' USING ERRCODE = 'CL045';
  END IF;
  IF NEW.scope_type = 'OPERATOR_CEILING' AND NEW.scope_id IS DISTINCT FROM NEW.operator_id THEN
    RAISE EXCEPTION 'Plafond : la portée est le prestataire' USING ERRCODE = 'CL045';
  END IF;
  IF offline_policy_scope_operator(NEW.scope_type, NEW.scope_id) IS DISTINCT FROM NEW.operator_id THEN
    RAISE EXCEPTION 'Portée de politique invalide' USING ERRCODE = 'CL045';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION offline_policy_scope_guard() FROM PUBLIC;
-- Nom < offline_policy_version : la portée est contrôlée avant la montée de version.
CREATE TRIGGER offline_policy_scope BEFORE INSERT OR UPDATE ON offline_policy
  FOR EACH ROW EXECUTE FUNCTION offline_policy_scope_guard();

-- 4. Historique sous les droits de la base (OP-N58) ----------------------------------------------
-- Corps identique à schema_grand_livre_cashless.sql S:2396 ; CREATE OR REPLACE efface les
-- réglages : DEFINER et search_path sont reposés. La version vient de la ligne verrouillée.
CREATE OR REPLACE FUNCTION log_offline_policy() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE p offline_policy%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN p := OLD; ELSE p := NEW; END IF;
  INSERT INTO offline_policy_history (operator_id, policy_id, scope_type, scope_id, version, deleted, offline_enabled,
         max_per_sale, max_per_media_per_device, max_total_per_device, max_snapshot_age, cash_topup_offline, updated_by)
  VALUES (p.operator_id, p.id, p.scope_type, p.scope_id,
          CASE WHEN TG_OP = 'DELETE' THEN p.version + 1 ELSE p.version END, TG_OP = 'DELETE', p.offline_enabled,
          p.max_per_sale, p.max_per_media_per_device, p.max_total_per_device, p.max_snapshot_age, p.cash_topup_offline, p.updated_by);
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION log_offline_policy() FROM PUBLIC;

-- 5. Écriture ---------------------------------------------------------------------------------------
CREATE FUNCTION set_offline_policy(p_scope_type text, p_scope_id uuid, p_values jsonb,
                                   p_expected_version int, p_actor uuid)
RETURNS offline_policy
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_session  uuid := nullif(current_setting('app.operator_id', true), '')::uuid;
  v_operator uuid;
  v_key      text;
  v_en       boolean;
  v_ps       bigint;
  v_pm       bigint;
  v_pt       bigint;
  v_age      interval;
  v_cash     boolean;
  r          offline_policy%ROWTYPE;
  n          numeric;
BEGIN
  IF p_scope_type IS NULL OR p_scope_type NOT IN ('OPERATOR_CEILING','ORGANIZER','EVENT','DEVICE')
     OR p_values IS NULL OR jsonb_typeof(p_values) <> 'object' THEN
    RAISE EXCEPTION 'Politique invalide' USING ERRCODE = 'CL001';
  END IF;
  v_operator := offline_policy_scope_operator(p_scope_type, p_scope_id);
  IF v_session IS NULL OR v_operator IS NULL OR v_operator IS DISTINCT FROM v_session
     OR (p_scope_type = 'OPERATOR_CEILING' AND p_scope_id IS DISTINCT FROM v_session) THEN
    RAISE EXCEPTION 'Portée de politique invalide' USING ERRCODE = 'CL045';
  END IF;
  PERFORM offline_policy_actor_check(v_operator, p_actor);

  FOR v_key IN SELECT jsonb_object_keys(p_values) LOOP
    IF v_key NOT IN ('offline_enabled','max_per_sale','max_per_media_per_device',
                     'max_total_per_device','max_snapshot_age_seconds','cash_topup_offline') THEN
      RAISE EXCEPTION 'Clé de politique inconnue : %', v_key USING ERRCODE = 'CL001';
    END IF;
  END LOOP;
  -- Booléens
  FOR v_key IN SELECT unnest(ARRAY['offline_enabled','cash_topup_offline']) LOOP
    IF p_values -> v_key IS NOT NULL AND jsonb_typeof(p_values -> v_key) NOT IN ('boolean','null') THEN
      RAISE EXCEPTION 'Booléen attendu : %', v_key USING ERRCODE = 'CL001';
    END IF;
  END LOOP;
  -- Nombres entiers >= 0 (âge : 0 à 86400)
  FOR v_key IN SELECT unnest(ARRAY['max_per_sale','max_per_media_per_device','max_total_per_device',
                                   'max_snapshot_age_seconds']) LOOP
    IF p_values -> v_key IS NOT NULL AND jsonb_typeof(p_values -> v_key) <> 'null' THEN
      IF jsonb_typeof(p_values -> v_key) <> 'number' THEN
        RAISE EXCEPTION 'Entier attendu : %', v_key USING ERRCODE = 'CL001';
      END IF;
      n := (p_values ->> v_key)::numeric;
      IF n < 0 OR n <> trunc(n) OR n > 9223372036854775807
         OR (v_key = 'max_snapshot_age_seconds' AND n > 86400) THEN
        RAISE EXCEPTION 'Valeur hors bornes : %', v_key USING ERRCODE = 'CL001';
      END IF;
    END IF;
  END LOOP;
  v_en   := (p_values ->> 'offline_enabled')::boolean;
  v_cash := (p_values ->> 'cash_topup_offline')::boolean;
  IF v_cash IS TRUE THEN
    RAISE EXCEPTION 'Recharge espèces hors ligne interdite' USING ERRCODE = 'CL047';
  END IF;
  v_ps  := (p_values ->> 'max_per_sale')::bigint;
  v_pm  := (p_values ->> 'max_per_media_per_device')::bigint;
  v_pt  := (p_values ->> 'max_total_per_device')::bigint;
  v_age := make_interval(secs => (p_values ->> 'max_snapshot_age_seconds')::numeric);

  SELECT * INTO r FROM offline_policy
   WHERE scope_type = p_scope_type AND scope_id = p_scope_id AND operator_id = v_operator
     FOR UPDATE;
  IF NOT FOUND THEN
    IF p_expected_version IS NOT NULL THEN
      RAISE EXCEPTION 'Version attendue sur une politique absente' USING ERRCODE = 'CL046';
    END IF;
    BEGIN
      INSERT INTO offline_policy (operator_id, scope_type, scope_id, offline_enabled, max_per_sale,
             max_per_media_per_device, max_total_per_device, max_snapshot_age, cash_topup_offline,
             updated_by)
      VALUES (v_operator, p_scope_type, p_scope_id, v_en, v_ps, v_pm, v_pt, v_age, v_cash, p_actor)
      RETURNING * INTO r;
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'Politique créée entre-temps' USING ERRCODE = 'CL046';
    END;
  ELSE
    IF p_expected_version IS DISTINCT FROM r.version THEN
      RAISE EXCEPTION 'Version de politique différente' USING ERRCODE = 'CL046';
    END IF;
    UPDATE offline_policy SET offline_enabled = v_en, max_per_sale = v_ps,
           max_per_media_per_device = v_pm, max_total_per_device = v_pt, max_snapshot_age = v_age,
           cash_topup_offline = v_cash, updated_by = p_actor
     WHERE id = r.id
     RETURNING * INTO r;
  END IF;
  RETURN r;
END $$;
REVOKE ALL ON FUNCTION set_offline_policy(text, uuid, jsonb, int, uuid) FROM PUBLIC;

CREATE FUNCTION clear_offline_policy(p_scope_type text, p_scope_id uuid, p_expected_version int,
                                     p_actor uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_session  uuid := nullif(current_setting('app.operator_id', true), '')::uuid;
  v_operator uuid;
  r          offline_policy%ROWTYPE;
BEGIN
  IF p_scope_type IS NULL OR p_scope_type NOT IN ('OPERATOR_CEILING','ORGANIZER','EVENT','DEVICE') THEN
    RAISE EXCEPTION 'Type de portée invalide' USING ERRCODE = 'CL001';
  END IF;
  v_operator := offline_policy_scope_operator(p_scope_type, p_scope_id);
  IF v_session IS NULL OR v_operator IS NULL OR v_operator IS DISTINCT FROM v_session THEN
    RAISE EXCEPTION 'Portée de politique invalide' USING ERRCODE = 'CL045';
  END IF;
  PERFORM offline_policy_actor_check(v_operator, p_actor);
  SELECT * INTO r FROM offline_policy
   WHERE scope_type = p_scope_type AND scope_id = p_scope_id AND operator_id = v_operator
     FOR UPDATE;
  IF NOT FOUND THEN
    IF p_expected_version IS NOT NULL THEN
      RAISE EXCEPTION 'Version attendue sur une politique absente' USING ERRCODE = 'CL046';
    END IF;
    RETURN;
  END IF;
  IF p_expected_version IS DISTINCT FROM r.version THEN
    RAISE EXCEPTION 'Version de politique différente' USING ERRCODE = 'CL046';
  END IF;
  DELETE FROM offline_policy WHERE id = r.id;
END $$;
REVOKE ALL ON FUNCTION clear_offline_policy(text, uuid, int, uuid) FROM PUBLIC;

-- 6. Lecture ------------------------------------------------------------------------------------------
-- Niveau exact d'une portée (sans héritage). NULL si aucune ligne. Portée inconnue ou d'un autre
-- prestataire : CL045.
CREATE FUNCTION offline_policy_level(p_scope_type text, p_scope_id uuid) RETURNS offline_policy
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_session  uuid := nullif(current_setting('app.operator_id', true), '')::uuid;
  v_operator uuid := offline_policy_scope_operator(p_scope_type, p_scope_id);
  r          offline_policy%ROWTYPE;
BEGIN
  IF v_session IS NULL OR v_operator IS NULL OR v_operator IS DISTINCT FROM v_session THEN
    RAISE EXCEPTION 'Portée de politique invalide' USING ERRCODE = 'CL045';
  END IF;
  SELECT * INTO r FROM offline_policy
   WHERE scope_type = p_scope_type AND scope_id = p_scope_id AND operator_id = v_operator;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN r;
END $$;
REVOKE ALL ON FUNCTION offline_policy_level(text, uuid) FROM PUBLIC;

-- 7. Risque maximal d'un événement (R-03) --------------------------------------------------------
-- Terminaux de l'événement, non révoqués, hors téléphone personnel, dont la politique effective
-- autorise le hors ligne. Valeurs et `capped` : ceux de effective_offline_policy (plafond du
-- prestataire appliqué). La somme est faite par l'API. Événement d'un autre prestataire : refus
-- d'assert_tenant (P0002, 404).
CREATE FUNCTION offline_max_exposure(p_event uuid)
RETURNS TABLE (device_id uuid, serial text, max_total_per_device bigint, capped boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE v_operator uuid := tenant_of_event(p_event);
BEGIN
  PERFORM assert_tenant(v_operator);
  RETURN QUERY
    SELECT d.id, d.serial, p.max_total_per_device, p.capped
      FROM device d
      CROSS JOIN LATERAL effective_offline_policy(d.id) p
     WHERE d.event_id = p_event AND d.operator_id = v_operator
       AND d.status <> 'REVOKED' AND NOT d.personal_phone AND p.offline_enabled
     ORDER BY d.serial, d.id;
END $$;
REVOKE ALL ON FUNCTION offline_max_exposure(uuid) FROM PUBLIC;
