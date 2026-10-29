-- Migration 0037 : configurations de prestataire de paiement, choix par événement, résolution
-- revérifiée, comptes A-PSP-* et portée de frais PSP_CONFIGURATION (mission recharges-caisses-psp,
-- lot WP03 ; spec FR-009, FR-010, FR-011, FR-023, C-004 ; data-model « psp_configuration »,
-- « event_psp_selection » ; research R-07, R-08, R-13, R-20 ; research-adversarial A9, A10, A15,
-- A18, A30, A34 ; contracts/psp.md règles 1 à 6 ; ADR-77 pour les comptes A-PSP-*).
--
-- Contenu :
--   1. Table `psp_configuration` : UNE RÉFÉRENCE de secrets (`secret_ref`), jamais un secret. Le
--      segment titulaire de la référence est celui du détenteur des fonds (A10). Une modification
--      est une NOUVELLE ligne (`supersedes_id`, `version`), jamais un UPDATE de la référence.
--      Colonnes ajoutées au data-model : supersedes_id, activated_at, last_request_id,
--      last_decided_at, created_at (versions et non-rejeu des demandes d'approbation, A15, A30).
--      RLS activée et forcée. Déclencheur d'immuabilité et de transition de statut.
--   2. Table `event_psp_selection` + déclencheur `event_psp_selection_guard` (même organisateur,
--      ACTIVE, même moyen, titulaire = ledger.funds_holder_id) ; RLS activée et forcée.
--   3. Fonctions SECURITY DEFINER, `search_path = public, pg_temp` (règle de 0021), EXECUTE retiré à
--      PUBLIC. AUCUN GRANT/REVOKE de table ici : les accords et les retraits sont posés par le lot
--      WP05 (post-roles.sql).
--        psp_operator_admin           INTERNE (jamais accordée) : OPERATOR_ADMIN actif du prestataire
--        psp_organizer_admin          INTERNE (jamais accordée) : ORGANIZER_ADMIN actif de l'organisateur
--        psp_account_code             INTERNE : moyen -> code de compte A-PSP-*
--        create_psp_configuration     création d'un brouillon ou d'une nouvelle version
--        activate_psp_configuration   applique le statut demandé par la demande PSP_CONFIGURATION
--                                     approuvée : ACTIVE (activation, réactivation) ou SUSPENDED
--        set_event_psp_selection      choix de l'événement (DRAFT direct ; LIVE à deux personnes)
--        resolve_psp_configuration    résolution revérifiée à chaque recharge ; ne rend PAS secret_ref
--        psp_configuration_secret_ref porte du coffre (WP07) : prestataire de session obligatoire
--        psp_webhook_context          lecture NEUTRE par identifiant pour la route publique des
--                                     notifications (A9) ; rend secret_ref ; seule autre porte
--        open_psp_accounts            crée les trois comptes A-PSP-* d'un grand livre (décision du
--                                     porteur du 27/10/2026) ; open_event_ledger est INCHANGÉE
--        assert_no_legacy_psp_fee_rules  contrôle de migration (convention PSP:<canal> retirée)
--   4. Comptes A-PSP-WAVE, A-PSP-OM, A-PSP-CARTE pour les grands livres d'événement EXISTANTS
--      (idempotent) ; les nouveaux les reçoivent par open_psp_accounts (set_event_psp_selection, et
--      create_psp_topup du lot WP04 en filet).
--   5. Portée de frais `PSP_CONFIGURATION` : contrainte de fee_rule remplacée, fee_rule_guard
--      remplacée (corps de 0007 + une branche).
--
-- Hypothèse sur le propriétaire (à faire relire par une personne) : comme 0019, 0020 et 0022,
-- aucune fonction ne s'appuie sur la RLS pour se protéger : chaque lecture et chaque écriture
-- nomme le prestataire de la session (`app.operator_id`, absent : P0002). `psp_webhook_context`
-- (sans prestataire de session) et les fonctions DEFINER supposent un propriétaire qui IGNORE la
-- RLS (superutilisateur du poste local). Avec un propriétaire soumis à la RLS, l'échec est FERMÉ :
-- aucune ligne n'est lue ni écrite.
--
-- Erreurs (traduites par apps/api/src/errors/sqlstate-map.ts ; CL042 est à ajouter par le lot WP07) :
--   CL001   paramètre invalide, contrainte violée (jamais d'écho de secret_ref) -> 422 VALIDATION_FAILED
--   CL023   demande d'approbation absente de la règle, rejouée, d'une autre version -> 409 APPROVAL_INVALID
--   CL029   état incompatible (transition, règle de frais, défaut déjà pris)       -> 409 CONFLICT_STATE
--   CL042   NOUVEAU : aucune configuration utilisable pour (événement, moyen)       -> 409 PSP_NOT_CONFIGURED
--   P0002   objet introuvable, d'un autre prestataire ou hors du périmètre          -> 404

-- 1. Configurations -------------------------------------------------------------------------------
CREATE TABLE psp_configuration (
  psp_configuration_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id     uuid NOT NULL REFERENCES party(id),
  organizer_id    uuid NOT NULL REFERENCES party(id),
  method          text NOT NULL CONSTRAINT psp_configuration_method
                  CHECK (method IN ('WAVE','ORANGE_MONEY','CARD')),
  provider        text NOT NULL CONSTRAINT psp_configuration_provider
                  CHECK (provider IN ('WAVE','ORANGE_MONEY','PAYDUNYA','STRIPE')),
  holder_party_id uuid NOT NULL REFERENCES party(id),
  secret_ref      text NOT NULL,
  compliance_ref  text,
  status          text NOT NULL DEFAULT 'DRAFT' CONSTRAINT psp_configuration_status
                  CHECK (status IN ('DRAFT','ACTIVE','SUSPENDED')),
  is_default      boolean NOT NULL DEFAULT false,
  valid_from      timestamptz NOT NULL,
  valid_until     timestamptz,
  version         int NOT NULL DEFAULT 1,
  created_by      uuid NOT NULL REFERENCES app_user(id),
  approved_by     uuid REFERENCES app_user(id),
  supersedes_id   uuid REFERENCES psp_configuration(psp_configuration_id),
  activated_at    timestamptz,
  last_request_id uuid,
  last_decided_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT psp_configuration_method_provider CHECK (
    (method, provider) IN (('WAVE','WAVE'), ('ORANGE_MONEY','ORANGE_MONEY'),
                           ('CARD','PAYDUNYA'), ('CARD','STRIPE'))),
  -- A10 : la référence est liée au titulaire. Seuls des caractères de nom : jamais un secret.
  CONSTRAINT psp_configuration_secret_ref_holder
    CHECK (secret_ref LIKE 'psp/' || holder_party_id::text || '/%'),
  CONSTRAINT psp_configuration_secret_ref_format
    CHECK (secret_ref ~ '^psp/[0-9a-f-]{36}/[A-Za-z0-9._-]{1,100}$'),
  CONSTRAINT psp_configuration_validity CHECK (valid_until IS NULL OR valid_until > valid_from),
  CONSTRAINT psp_configuration_two_persons CHECK (approved_by IS NULL OR approved_by <> created_by),
  CONSTRAINT psp_configuration_activated CHECK (
    status = 'DRAFT' OR (approved_by IS NOT NULL AND compliance_ref IS NOT NULL
                         AND btrim(compliance_ref) <> '' AND length(compliance_ref) <= 200)),
  CONSTRAINT psp_configuration_version CHECK (version >= 1)
);
-- FR-010 : un seul défaut actif par (organisateur, moyen).
CREATE UNIQUE INDEX psp_configuration_default_active ON psp_configuration (organizer_id, method)
  WHERE is_default AND status = 'ACTIVE';
CREATE UNIQUE INDEX psp_configuration_one_successor ON psp_configuration (supersedes_id)
  WHERE supersedes_id IS NOT NULL;
CREATE INDEX psp_configuration_operator_idx ON psp_configuration (operator_id, organizer_id, method);

-- Seules les colonnes de cycle de vie changent ; la référence de secrets, le titulaire,
-- l'organisateur, le moyen, le fournisseur, les dates et la version sont figés (une modification
-- est une nouvelle ligne). Transitions : DRAFT -> ACTIVE, ACTIVE -> SUSPENDED, SUSPENDED -> ACTIVE.
CREATE FUNCTION psp_configuration_immutable() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Configuration PSP : suppression interdite (une recharge peut s''y référer)'
      USING ERRCODE = 'CL001';
  END IF;
  IF (to_jsonb(NEW) - ARRAY['status','is_default','approved_by','compliance_ref','activated_at',
                            'last_request_id','last_decided_at'])
     IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['status','is_default','approved_by','compliance_ref','activated_at',
                            'last_request_id','last_decided_at']) THEN
    RAISE EXCEPTION 'Configuration PSP : ne se modifie pas (créer une nouvelle version)'
      USING ERRCODE = 'CL001';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status
     AND (OLD.status, NEW.status) NOT IN (('DRAFT','ACTIVE'), ('ACTIVE','SUSPENDED'),
                                          ('SUSPENDED','ACTIVE')) THEN
    RAISE EXCEPTION 'Configuration PSP : passage % -> % interdit', OLD.status, NEW.status
      USING ERRCODE = 'CL001';
  END IF;
  IF OLD.status <> 'DRAFT' AND NEW.compliance_ref IS DISTINCT FROM OLD.compliance_ref THEN
    RAISE EXCEPTION 'Configuration PSP : référence de conformité figée après activation'
      USING ERRCODE = 'CL001';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION psp_configuration_immutable() FROM PUBLIC;
CREATE TRIGGER psp_configuration_immutable BEFORE UPDATE OR DELETE ON psp_configuration
  FOR EACH ROW EXECUTE FUNCTION psp_configuration_immutable();

-- 2. Choix par événement --------------------------------------------------------------------------
CREATE TABLE event_psp_selection (
  event_id             uuid NOT NULL REFERENCES event(id),
  method               text NOT NULL CONSTRAINT event_psp_selection_method
                       CHECK (method IN ('WAVE','ORANGE_MONEY','CARD')),
  psp_configuration_id uuid NOT NULL REFERENCES psp_configuration(psp_configuration_id),
  selected_by          uuid NOT NULL REFERENCES app_user(id),
  approved_by          uuid REFERENCES app_user(id),
  selected_at          timestamptz NOT NULL DEFAULT clock_timestamp(),
  request_id           uuid,
  operator_id          uuid NOT NULL REFERENCES party(id),
  PRIMARY KEY (event_id, method),
  CONSTRAINT event_psp_selection_two_persons CHECK (approved_by IS NULL OR approved_by <> selected_by)
);
CREATE INDEX event_psp_selection_request_idx ON event_psp_selection (request_id)
  WHERE request_id IS NOT NULL;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['psp_configuration','event_psp_selection'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
                     USING (operator_id = current_setting('app.operator_id', true)::uuid)
                     WITH CHECK (operator_id = current_setting('app.operator_id', true)::uuid)$p$,
                   t);
  END LOOP;
END $$;

-- La base garantit prestataire, organisateur, moyen, statut et titulaire quelle que soit l'API
-- (C-004). Rejouée à chaque insertion ou mise à jour du choix (la suspension ultérieure de la
-- configuration est revérifiée par resolve_psp_configuration, pas ici).
CREATE FUNCTION event_psp_selection_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE ev event%ROWTYPE; c psp_configuration%ROWTYPE; v_holder uuid;
BEGIN
  SELECT * INTO ev FROM event e WHERE e.id = NEW.event_id AND e.operator_id = NEW.operator_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Choix PSP : événement inconnu pour ce prestataire' USING ERRCODE = 'CL001';
  END IF;
  SELECT l.funds_holder_id INTO v_holder FROM ledger l
   WHERE l.scope_type = 'EVENT' AND l.scope_id = NEW.event_id AND l.operator_id = NEW.operator_id;
  IF v_holder IS NULL THEN
    RAISE EXCEPTION 'Choix PSP : grand livre de l''événement non ouvert' USING ERRCODE = 'CL001';
  END IF;
  SELECT * INTO c FROM psp_configuration p
   WHERE p.psp_configuration_id = NEW.psp_configuration_id AND p.operator_id = NEW.operator_id;
  IF NOT FOUND OR c.organizer_id <> ev.organizer_id OR c.status <> 'ACTIVE'
     OR c.method <> NEW.method OR c.holder_party_id <> v_holder THEN
    RAISE EXCEPTION 'Choix PSP : configuration inutilisable pour cet événement et ce moyen'
      USING ERRCODE = 'CL001';
  END IF;
  IF ev.status = 'LIVE' AND NEW.approved_by IS NULL THEN
    RAISE EXCEPTION 'Choix PSP : événement en direct, seconde personne obligatoire'
      USING ERRCODE = 'CL001';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION event_psp_selection_guard() FROM PUBLIC;
CREATE TRIGGER event_psp_selection_guard BEFORE INSERT OR UPDATE ON event_psp_selection
  FOR EACH ROW EXECUTE FUNCTION event_psp_selection_guard();

-- 3. Fonctions internes ---------------------------------------------------------------------------
-- Auteur OPERATOR_ADMIN actif du prestataire (attribution non retirée). INTERNE : jamais accordée.
CREATE FUNCTION psp_operator_admin(p_operator uuid, p_actor uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM app_user u
      JOIN role_assignment a ON a.user_id = u.id AND a.revoked_at IS NULL
     WHERE u.id = p_actor AND u.operator_id = p_operator AND u.status = 'ACTIVE'
       AND a.operator_id = p_operator AND a.role = 'OPERATOR_ADMIN'
       AND a.scope_type = 'OPERATOR' AND a.scope_id = p_operator)
$$;
REVOKE ALL ON FUNCTION psp_operator_admin(uuid, uuid) FROM PUBLIC;

-- Auteur ORGANIZER_ADMIN actif de l'organisateur. INTERNE : jamais accordée.
CREATE FUNCTION psp_organizer_admin(p_operator uuid, p_organizer uuid, p_actor uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM app_user u
      JOIN role_assignment a ON a.user_id = u.id AND a.revoked_at IS NULL
     WHERE u.id = p_actor AND u.operator_id = p_operator AND u.status = 'ACTIVE'
       AND a.operator_id = p_operator AND a.role = 'ORGANIZER_ADMIN'
       AND a.scope_type = 'ORGANIZER' AND a.scope_id = p_organizer)
$$;
REVOKE ALL ON FUNCTION psp_organizer_admin(uuid, uuid, uuid) FROM PUBLIC;

-- 3a. Création ------------------------------------------------------------------------------------
-- Brouillon (version 1) ou nouvelle version d'une configuration (p_supersedes). Toute violation de
-- contrainte donne un CL001 lisible qui nomme la contrainte, sans écho de secret_ref.
CREATE FUNCTION create_psp_configuration(
  p_organizer uuid, p_method text, p_provider text, p_holder uuid, p_secret_ref text,
  p_is_default boolean, p_valid_from timestamptz, p_valid_until timestamptz, p_actor uuid,
  p_supersedes uuid DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_operator uuid := nullif(current_setting('app.operator_id', true), '')::uuid;
  prev psp_configuration%ROWTYPE;
  v_version int := 1;
  v_id uuid;
  v_constraint text;
BEGIN
  IF v_operator IS NULL OR p_actor IS NULL OR NOT psp_operator_admin(v_operator, p_actor) THEN
    RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM party WHERE id = p_organizer AND kind = 'ORGANIZER'
                    AND operator_id = v_operator)
     OR NOT EXISTS (SELECT 1 FROM party WHERE id = p_holder
                       AND (id = v_operator OR operator_id = v_operator)) THEN
    RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found';
  END IF;
  IF p_supersedes IS NOT NULL THEN
    SELECT * INTO prev FROM psp_configuration
     WHERE psp_configuration_id = p_supersedes AND operator_id = v_operator FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
    IF prev.organizer_id <> p_organizer OR prev.method <> p_method THEN
      RAISE EXCEPTION 'Configuration PSP : la version suivante garde organisateur et moyen'
        USING ERRCODE = 'CL001';
    END IF;
    IF EXISTS (SELECT 1 FROM psp_configuration WHERE supersedes_id = p_supersedes) THEN
      RAISE EXCEPTION 'Configuration PSP : cette version a déjà une suivante' USING ERRCODE = 'CL029';
    END IF;
    v_version := prev.version + 1;
  END IF;
  BEGIN
    INSERT INTO psp_configuration (operator_id, organizer_id, method, provider, holder_party_id,
                                   secret_ref, is_default, valid_from, valid_until, version,
                                   created_by, supersedes_id)
    VALUES (v_operator, p_organizer, p_method, p_provider, p_holder, p_secret_ref,
            coalesce(p_is_default, false), p_valid_from, p_valid_until, v_version, p_actor,
            p_supersedes)
    RETURNING psp_configuration_id INTO v_id;
  EXCEPTION
    WHEN check_violation OR not_null_violation THEN
      GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
      RAISE EXCEPTION 'Configuration PSP : valeurs invalides (%)', coalesce(v_constraint, 'champ obligatoire')
        USING ERRCODE = 'CL001';
  END;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION create_psp_configuration(uuid, text, text, uuid, text, boolean, timestamptz,
                                                timestamptz, uuid, uuid) FROM PUBLIC;

-- 3b. Activation, suspension, réactivation (modèle enqueue_tag_key_job) ----------------------------
-- La demande PSP_CONFIGURATION APPROUVÉE porte la version (payload.version) et le statut visé
-- (payload.status : ACTIVE, absent = ACTIVE, ou SUSPENDED). Elle ne sert qu'une fois : sa décision
-- doit être strictement postérieure à la dernière décision appliquée à la configuration, et ne peut
-- pas être la dernière demande appliquée (A15, A30). Ces deux contrôles de la base ne remplacent
-- pas l'état EXECUTED de la demande, noté par l'API.
CREATE FUNCTION activate_psp_configuration(p_config uuid, p_request uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_operator uuid := nullif(current_setting('app.operator_id', true), '')::uuid;
  c psp_configuration%ROWTYPE;
  r approval_request%ROWTYPE;
  prev psp_configuration%ROWTYPE;
  v_target text;
  v_compliance text;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF v_operator IS NULL OR p_config IS NULL OR p_request IS NULL THEN
    RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found';
  END IF;
  SELECT * INTO c FROM psp_configuration
   WHERE psp_configuration_id = p_config AND operator_id = v_operator FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  SELECT * INTO r FROM approval_request WHERE id = p_request AND operator_id = v_operator FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;

  -- Demande : action, statut, objet, version, statut visé, deux personnes distinctes.
  IF r.action <> 'PSP_CONFIGURATION' OR r.status <> 'APPROVED' OR r.target_id IS DISTINCT FROM c.psp_configuration_id
     OR r.payload ->> 'psp_configuration_id' IS DISTINCT FROM c.psp_configuration_id::text
     OR r.payload ->> 'version' IS DISTINCT FROM c.version::text THEN
    RAISE EXCEPTION 'Configuration PSP : demande sans rapport avec cette version' USING ERRCODE = 'CL023';
  END IF;
  v_target := coalesce(r.payload ->> 'status', 'ACTIVE');
  IF v_target NOT IN ('ACTIVE','SUSPENDED') THEN
    RAISE EXCEPTION 'Configuration PSP : statut visé invalide' USING ERRCODE = 'CL023';
  END IF;
  IF r.decided_by IS NULL OR r.decided_at IS NULL OR r.decided_by = r.requested_by
     OR NOT psp_operator_admin(v_operator, r.requested_by)
     OR NOT psp_operator_admin(v_operator, r.decided_by) THEN
    RAISE EXCEPTION 'Configuration PSP : auteur et valideur, deux OPERATOR_ADMIN actifs distincts'
      USING ERRCODE = 'CL023';
  END IF;
  IF v_target = 'ACTIVE' AND r.decided_by = c.created_by THEN
    RAISE EXCEPTION 'Configuration PSP : activation refusée à la personne qui l''a créée'
      USING ERRCODE = 'CL023';
  END IF;
  IF c.last_request_id = r.id OR (c.last_decided_at IS NOT NULL AND r.decided_at <= c.last_decided_at) THEN
    RAISE EXCEPTION 'Configuration PSP : demande déjà utilisée ou antérieure à la dernière décision'
      USING ERRCODE = 'CL023';
  END IF;

  IF v_target = 'ACTIVE' THEN
    IF c.status NOT IN ('DRAFT','SUSPENDED') THEN
      RAISE EXCEPTION 'Configuration PSP : déjà active' USING ERRCODE = 'CL029';
    END IF;
    IF c.valid_until IS NOT NULL AND c.valid_until <= v_now THEN
      RAISE EXCEPTION 'Configuration PSP : période de validité échue' USING ERRCODE = 'CL029';
    END IF;
    IF c.status = 'SUSPENDED' AND EXISTS (SELECT 1 FROM psp_configuration s
                                            WHERE s.supersedes_id = c.psp_configuration_id
                                              AND s.status <> 'DRAFT') THEN
      RAISE EXCEPTION 'Configuration PSP : remplacée par une version plus récente'
        USING ERRCODE = 'CL029';
    END IF;
    -- A18 : jamais de recharge sans règle de frais explicite (une règle à 0 % suffit).
    IF NOT EXISTS (SELECT 1 FROM fee_rule f
                    WHERE f.scope_type = 'PSP_CONFIGURATION' AND f.scope_id = c.psp_configuration_id
                      AND f.operator_id = v_operator AND f.basis = 'TOPUP_AMOUNT'
                      AND f.valid_from <= v_now AND (f.valid_to IS NULL OR f.valid_to > v_now)) THEN
      RAISE EXCEPTION 'Configuration PSP : règle de frais explicite requise' USING ERRCODE = 'CL029';
    END IF;
    -- A34 : référence de conformité obligatoire à la première activation, conservée ensuite.
    v_compliance := c.compliance_ref;
    IF v_compliance IS NULL THEN
      v_compliance := btrim(r.payload ->> 'compliance_ref');
      IF v_compliance IS NULL OR v_compliance = '' OR length(v_compliance) > 200 THEN
        RAISE EXCEPTION 'Configuration PSP : référence de conformité obligatoire (200 caractères au plus)'
          USING ERRCODE = 'CL023';
      END IF;
    END IF;
    -- Nouvelle version : l'ancienne (ACTIVE) passe SUSPENDED d'abord (index du défaut unique).
    IF c.supersedes_id IS NOT NULL THEN
      SELECT * INTO prev FROM psp_configuration
       WHERE psp_configuration_id = c.supersedes_id AND operator_id = v_operator FOR UPDATE;
      IF FOUND AND prev.status = 'ACTIVE' THEN
        UPDATE psp_configuration SET status = 'SUSPENDED' WHERE psp_configuration_id = prev.psp_configuration_id;
      END IF;
    END IF;
    IF c.is_default AND EXISTS (SELECT 1 FROM psp_configuration d
                                 WHERE d.organizer_id = c.organizer_id AND d.method = c.method
                                   AND d.is_default AND d.status = 'ACTIVE'
                                   AND d.psp_configuration_id <> c.psp_configuration_id) THEN
      RAISE EXCEPTION 'Configuration PSP : un défaut actif existe déjà pour cet organisateur et ce moyen'
        USING ERRCODE = 'CL029';
    END IF;
    UPDATE psp_configuration
       SET status = 'ACTIVE', approved_by = r.decided_by, compliance_ref = v_compliance,
           activated_at = coalesce(activated_at, v_now), last_request_id = r.id,
           last_decided_at = r.decided_at
     WHERE psp_configuration_id = c.psp_configuration_id;
  ELSE
    IF c.status <> 'ACTIVE' THEN
      RAISE EXCEPTION 'Configuration PSP : seule une configuration active se suspend'
        USING ERRCODE = 'CL029';
    END IF;
    UPDATE psp_configuration
       SET status = 'SUSPENDED', last_request_id = r.id, last_decided_at = r.decided_at
     WHERE psp_configuration_id = c.psp_configuration_id;
  END IF;
END $$;
REVOKE ALL ON FUNCTION activate_psp_configuration(uuid, uuid) FROM PUBLIC;

-- 3c. Choix par événement ---------------------------------------------------------------------------
-- Permis seulement tant que l'événement est DRAFT ou LIVE. DRAFT : écriture directe (p_request
-- NULL). LIVE : demande EVENT_PSP_SELECTION approuvée par une autre personne, jamais utilisée et
-- postérieure à la dernière sélection de ce (événement, moyen).
CREATE FUNCTION set_event_psp_selection(p_event uuid, p_method text, p_config uuid, p_actor uuid,
                                        p_request uuid DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_operator uuid := nullif(current_setting('app.operator_id', true), '')::uuid;
  ev event%ROWTYPE;
  r approval_request%ROWTYPE;
  v_selected_by uuid := p_actor;
  v_approved_by uuid;
  v_last timestamptz;
BEGIN
  IF v_operator IS NULL OR p_event IS NULL OR p_actor IS NULL THEN
    RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found';
  END IF;
  SELECT * INTO ev FROM event WHERE id = p_event AND operator_id = v_operator FOR SHARE;
  IF NOT FOUND OR NOT psp_organizer_admin(v_operator, ev.organizer_id, p_actor) THEN
    RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found';
  END IF;
  IF p_method IS NULL OR p_method NOT IN ('WAVE','ORANGE_MONEY','CARD') THEN
    RAISE EXCEPTION 'Choix PSP : moyen inconnu' USING ERRCODE = 'CL001';
  END IF;
  IF ev.status NOT IN ('DRAFT','LIVE') THEN
    RAISE EXCEPTION 'Choix PSP : modifiable seulement en brouillon ou en direct (état %)', ev.status
      USING ERRCODE = 'CL029';
  END IF;
  -- Dernière sélection de ce (événement, moyen), verrouillée : deux changements concurrents.
  SELECT s.selected_at INTO v_last FROM event_psp_selection s
   WHERE s.event_id = p_event AND s.method = p_method FOR UPDATE;
  IF ev.status = 'DRAFT' THEN
    IF p_request IS NOT NULL THEN
      RAISE EXCEPTION 'Choix PSP : pas de demande d''approbation hors événement en direct'
        USING ERRCODE = 'CL001';
    END IF;
  ELSE
    IF p_request IS NULL THEN
      RAISE EXCEPTION 'Choix PSP : demande approuvée obligatoire en direct' USING ERRCODE = 'CL023';
    END IF;
    SELECT * INTO r FROM approval_request WHERE id = p_request AND operator_id = v_operator FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
    IF r.action <> 'EVENT_PSP_SELECTION' OR r.status <> 'APPROVED'
       OR r.payload ->> 'event_id' IS DISTINCT FROM p_event::text
       OR r.payload ->> 'method' IS DISTINCT FROM p_method
       OR r.payload ->> 'psp_configuration_id' IS DISTINCT FROM p_config::text THEN
      RAISE EXCEPTION 'Choix PSP : demande sans rapport avec ce choix' USING ERRCODE = 'CL023';
    END IF;
    IF r.decided_by IS NULL OR r.decided_at IS NULL OR r.decided_by = r.requested_by
       OR NOT psp_organizer_admin(v_operator, ev.organizer_id, r.requested_by)
       OR NOT psp_organizer_admin(v_operator, ev.organizer_id, r.decided_by) THEN
      RAISE EXCEPTION 'Choix PSP : auteur et valideur, deux ORGANIZER_ADMIN actifs distincts'
        USING ERRCODE = 'CL023';
    END IF;
    IF (v_last IS NOT NULL AND r.decided_at <= v_last)
       OR EXISTS (SELECT 1 FROM event_psp_selection u WHERE u.request_id = r.id) THEN
      RAISE EXCEPTION 'Choix PSP : demande déjà utilisée ou antérieure à la dernière sélection'
        USING ERRCODE = 'CL023';
    END IF;
    v_selected_by := r.requested_by;
    v_approved_by := r.decided_by;
  END IF;
  -- Le grand livre porte les comptes A-PSP-* (même transaction) ; le déclencheur contrôle ensuite
  -- configuration, organisateur, moyen, statut et titulaire.
  PERFORM open_psp_accounts((SELECT l.id FROM ledger l WHERE l.scope_type = 'EVENT'
                                AND l.scope_id = p_event AND l.operator_id = v_operator));
  INSERT INTO event_psp_selection (event_id, method, psp_configuration_id, selected_by, approved_by,
                                   selected_at, request_id, operator_id)
  VALUES (p_event, p_method, p_config, v_selected_by, v_approved_by, clock_timestamp(), p_request,
          v_operator)
  ON CONFLICT (event_id, method) DO UPDATE
     SET psp_configuration_id = EXCLUDED.psp_configuration_id, selected_by = EXCLUDED.selected_by,
         approved_by = EXCLUDED.approved_by, selected_at = EXCLUDED.selected_at,
         request_id = EXCLUDED.request_id;
END $$;
REVOKE ALL ON FUNCTION set_event_psp_selection(uuid, text, uuid, uuid, uuid) FROM PUBLIC;

-- 3d. Résolution revérifiée -------------------------------------------------------------------------
-- Le choix de l'événement pour ce moyen, sinon le défaut ACTIVE de l'organisateur ; dans les deux
-- cas la MÊME vérification (statut, dates, organisateur, moyen, titulaire = détenteur des fonds).
-- Un choix qui ne passe plus la vérification est un refus (CL042) : JAMAIS de repli sur le défaut,
-- aucun argent n'est routé vers un autre PSP en silence. Ne rend PAS secret_ref.
CREATE FUNCTION resolve_psp_configuration(p_event uuid, p_method text)
RETURNS TABLE (psp_configuration_id uuid, provider text, holder_party_id uuid, from_selection boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE
  v_operator uuid := nullif(current_setting('app.operator_id', true), '')::uuid;
  ev event%ROWTYPE;
  v_holder uuid;
  v_choice uuid;
  v_candidate uuid;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF v_operator IS NULL OR p_event IS NULL THEN
    RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found';
  END IF;
  SELECT * INTO ev FROM event e WHERE e.id = p_event AND e.operator_id = v_operator;
  IF NOT FOUND THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  IF p_method IS NULL OR p_method NOT IN ('WAVE','ORANGE_MONEY','CARD') THEN
    RAISE EXCEPTION 'PSP : moyen inconnu' USING ERRCODE = 'CL001';
  END IF;
  SELECT l.funds_holder_id INTO v_holder FROM ledger l
   WHERE l.scope_type = 'EVENT' AND l.scope_id = p_event AND l.operator_id = v_operator;
  IF v_holder IS NULL THEN
    RAISE EXCEPTION 'PSP non configuré : grand livre de l''événement non ouvert' USING ERRCODE = 'CL042';
  END IF;
  SELECT s.psp_configuration_id INTO v_choice FROM event_psp_selection s
   WHERE s.event_id = p_event AND s.method = p_method AND s.operator_id = v_operator;
  IF v_choice IS NOT NULL THEN
    v_candidate := v_choice;
  ELSE
    SELECT c.psp_configuration_id INTO v_candidate FROM psp_configuration c
     WHERE c.operator_id = v_operator AND c.organizer_id = ev.organizer_id AND c.method = p_method
       AND c.is_default AND c.status = 'ACTIVE';
  END IF;
  RETURN QUERY
    SELECT c.psp_configuration_id, c.provider, c.holder_party_id, v_choice IS NOT NULL
      FROM psp_configuration c
     WHERE c.psp_configuration_id = v_candidate AND c.operator_id = v_operator
       AND c.status = 'ACTIVE' AND c.valid_from <= v_now
       AND (c.valid_until IS NULL OR c.valid_until > v_now)
       AND c.organizer_id = ev.organizer_id AND c.method = p_method
       AND c.holder_party_id = v_holder;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PSP non configuré pour cet événement et ce moyen' USING ERRCODE = 'CL042';
  END IF;
END $$;
REVOKE ALL ON FUNCTION resolve_psp_configuration(uuid, text) FROM PUBLIC;

-- 3e. Lecture de la référence de secrets --------------------------------------------------------------
-- Porte du coffre (WP07). Le contrôle de rôle (OPERATOR_ADMIN pour l'affichage) est fait par l'API.
-- Une configuration suspendue reste interrogeable pour ses recharges PENDING (A15).
CREATE FUNCTION psp_configuration_secret_ref(p_config uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_operator uuid := nullif(current_setting('app.operator_id', true), '')::uuid;
  v_ref text;
BEGIN
  IF v_operator IS NULL OR p_config IS NULL THEN
    RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found';
  END IF;
  SELECT c.secret_ref INTO v_ref FROM psp_configuration c
   WHERE c.psp_configuration_id = p_config AND c.operator_id = v_operator
     AND c.status IN ('ACTIVE','SUSPENDED');
  IF v_ref IS NULL THEN
    RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found';
  END IF;
  RETURN v_ref;
END $$;
REVOKE ALL ON FUNCTION psp_configuration_secret_ref(uuid) FROM PUBLIC;

-- 3f. Contexte neutre de la réception des notifications (A9) ----------------------------------------
-- Lecture par identifiant, sans prestataire de session (la route publique n'en a pas), sans verrou
-- ni écriture ; zéro ligne si l'identifiant est inconnu. Rend secret_ref : seule autre porte de
-- lecture, avec psp_configuration_secret_ref. `currently_valid` = dans les dates (le statut est
-- rendu à part : une configuration suspendue reçoit encore les notifications de ses recharges).
CREATE FUNCTION psp_webhook_context(p_config uuid)
RETURNS TABLE (operator_id uuid, provider text, method text, status text, holder_party_id uuid,
               currently_valid boolean, secret_ref text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT c.operator_id, c.provider, c.method, c.status, c.holder_party_id,
         (c.valid_from <= clock_timestamp()
          AND (c.valid_until IS NULL OR c.valid_until > clock_timestamp())),
         c.secret_ref
    FROM psp_configuration c WHERE c.psp_configuration_id = p_config
$$;
REVOKE ALL ON FUNCTION psp_webhook_context(uuid) FROM PUBLIC;

-- 4. Comptes A-PSP-* ----------------------------------------------------------------------------------
-- ADR-77 (contre SPECIFICATION §5.2, contradiction signalée, ADR-77 appliqué) : famille ASSET, but
-- PSP, titulaire = détenteur des fonds, côté D, négatif permis, chaud.
CREATE FUNCTION psp_account_code(p_method text) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $$
BEGIN
  IF p_method = 'WAVE' THEN RETURN 'A-PSP-WAVE';
  ELSIF p_method = 'ORANGE_MONEY' THEN RETURN 'A-PSP-OM';
  ELSIF p_method = 'CARD' THEN RETURN 'A-PSP-CARTE'; END IF;
  RAISE EXCEPTION 'PSP : moyen inconnu' USING ERRCODE = 'CL001';
END $$;
REVOKE ALL ON FUNCTION psp_account_code(text) FROM PUBLIC;

-- Décision du porteur du 27/10/2026 : fonction dédiée, étroite. open_event_ledger reste INCHANGÉE
-- (SECURITY INVOKER, aucun compte A-PSP-*). Ne crée que les trois comptes A-PSP-* du grand livre
-- d'événement DU PRESTATAIRE DE LA SESSION (autre prestataire ou introuvable : P0002), titulaire =
-- détenteur des fonds, idempotente, ne modifie rien d'autre.
CREATE FUNCTION open_psp_accounts(p_ledger uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_operator uuid := nullif(current_setting('app.operator_id', true), '')::uuid;
  lg ledger%ROWTYPE;
BEGIN
  IF v_operator IS NULL OR p_ledger IS NULL THEN
    RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found';
  END IF;
  SELECT * INTO lg FROM ledger l
   WHERE l.id = p_ledger AND l.operator_id = v_operator AND l.scope_type = 'EVENT';
  IF NOT FOUND THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  INSERT INTO account (operator_id, ledger_id, code, family, purpose, owner_party_id, normal_side,
                       allow_negative, hot)
  SELECT lg.operator_id, lg.id, psp_account_code(m), 'ASSET', 'PSP', lg.funds_holder_id, 'D', true, true
    FROM unnest(ARRAY['WAVE','ORANGE_MONEY','CARD']) AS m
  ON CONFLICT (ledger_id, code) DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION open_psp_accounts(uuid) FROM PUBLIC;

-- Grands livres d'événement existants (idempotent). Le propriétaire qui applique la migration
-- n'est pas cashless_app : le garde de but de compte (migration 0036) laisse passer.
INSERT INTO account (operator_id, ledger_id, code, family, purpose, owner_party_id, normal_side,
                     allow_negative, hot)
SELECT l.operator_id, l.id, psp_account_code(m), 'ASSET', 'PSP', l.funds_holder_id, 'D', true, true
  FROM ledger l CROSS JOIN unnest(ARRAY['WAVE','ORANGE_MONEY','CARD']) AS m
 WHERE l.scope_type = 'EVENT'
ON CONFLICT (ledger_id, code) DO NOTHING;

-- 5. Portée de frais PSP_CONFIGURATION ------------------------------------------------------------
ALTER TABLE fee_rule DROP CONSTRAINT fee_rule_scope_type_check;
ALTER TABLE fee_rule ADD CONSTRAINT fee_rule_scope_type_check CHECK (scope_type IN (
  'PLATFORM_CONTRACT','OPERATOR_CONTRACT','EVENT','PARTICIPATION','PSP_CONFIGURATION'));

-- Corps de 0007 plus la branche PSP_CONFIGURATION ; le déclencheur existant n'est pas recréé.
CREATE OR REPLACE FUNCTION fee_rule_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE obj_op uuid; found_obj boolean;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.valid_to IS NOT NULL OR NEW.valid_to IS NULL
       OR (to_jsonb(NEW) - 'valid_to') IS DISTINCT FROM (to_jsonb(OLD) - 'valid_to') THEN
      RAISE EXCEPTION 'Règle de frais : ne se modifie pas (seule une fermeture par valid_to est permise)'
        USING ERRCODE = 'CL001';
    END IF;
    RETURN NEW;
  END IF;
  CASE NEW.scope_type
    WHEN 'PLATFORM_CONTRACT' THEN
      SELECT operator_id, true INTO obj_op, found_obj FROM contract WHERE id = NEW.scope_id AND kind = 'PLATFORM_OPERATOR';
    WHEN 'OPERATOR_CONTRACT' THEN
      SELECT operator_id, true INTO obj_op, found_obj FROM contract WHERE id = NEW.scope_id AND kind = 'OPERATOR_ORGANIZER';
    WHEN 'EVENT' THEN
      SELECT operator_id, true INTO obj_op, found_obj FROM event WHERE id = NEW.scope_id;
    WHEN 'PARTICIPATION' THEN
      SELECT operator_id, true INTO obj_op, found_obj FROM merchant_participation WHERE id = NEW.scope_id;
    WHEN 'PSP_CONFIGURATION' THEN
      SELECT operator_id, true INTO obj_op, found_obj FROM psp_configuration WHERE psp_configuration_id = NEW.scope_id;
      IF NEW.basis <> 'TOPUP_AMOUNT' THEN
        RAISE EXCEPTION 'Règle de frais : une configuration PSP ne porte que la base TOPUP_AMOUNT'
          USING ERRCODE = 'CL001';
      END IF;
  END CASE;
  IF found_obj IS NULL OR (NEW.operator_id IS NOT NULL AND obj_op <> NEW.operator_id) THEN
    RAISE EXCEPTION 'Règle de frais : objet de la portée % inconnu pour ce prestataire', NEW.scope_type
      USING ERRCODE = 'CL001';
  END IF;
  RETURN NEW;
END $$;

-- A18 : la convention `PSP:<canal>` (beneficiary_purpose, ADR-82 §3) est retirée. Une règle de ce
-- type n'est plus lue par personne : elle ne doit pas survivre. Contrôle nommé pour être testable.
CREATE FUNCTION assert_no_legacy_psp_fee_rules() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM fee_rule WHERE beneficiary_purpose LIKE 'PSP:%') THEN
    RAISE EXCEPTION 'Migration 0037 : des règles de frais utilisent encore la convention PSP:<canal> '
                    '(retirée, A18) ; les remplacer par une règle de portée PSP_CONFIGURATION '
                    'avant de migrer'
      USING ERRCODE = 'CL001';
  END IF;
END $$;
REVOKE ALL ON FUNCTION assert_no_legacy_psp_fee_rules() FROM PUBLIC;
SELECT assert_no_legacy_psp_fee_rules();
