-- Migration 0003 : personnes du personnel et attributions de rôle (SPECIFICATION §3.2, §14.2 S1 ; mission
-- identite-roles-double-validation, data-model `app_user`, `role_assignment`, `identify_person`).
-- Une personne de la plateforme a operator_id NULL : invisible sous RLS, lue seulement par identify_person.
-- Erreurs métier : CL001 (VALIDATION_FAILED). Aucune suppression (cohérent avec roles.sql).

CREATE TABLE app_user (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id   uuid REFERENCES party(id),               -- NULL = personne de la plateforme
  issuer        text NOT NULL,
  subject       text NOT NULL,
  email         text,
  phone         text,
  display_name  text NOT NULL,
  status        text NOT NULL DEFAULT 'ACTIVE',
  created_by    uuid REFERENCES app_user(id),            -- NULL seulement pour l'amorçage
  created_at    timestamptz NOT NULL DEFAULT clock_timestamp(),
  disabled_at   timestamptz,
  CONSTRAINT app_user_identity_uniq UNIQUE (issuer, subject),
  CONSTRAINT app_user_issuer_nonempty CHECK (length(issuer) > 0),
  CONSTRAINT app_user_subject_nonempty CHECK (length(subject) > 0),
  CONSTRAINT app_user_display_name_nonempty CHECK (length(display_name) > 0),
  CONSTRAINT app_user_contact CHECK (email IS NOT NULL OR phone IS NOT NULL),
  CONSTRAINT app_user_phone_e164 CHECK (phone IS NULL OR phone ~ '^\+[1-9][0-9]{6,14}$'),
  CONSTRAINT app_user_status CHECK (status IN ('ACTIVE','DISABLED')),
  CONSTRAINT app_user_disabled_at CHECK ((status = 'DISABLED') = (disabled_at IS NOT NULL))
);
CREATE INDEX app_user_operator_idx ON app_user (operator_id, created_at);

CREATE TABLE role_assignment (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id  uuid REFERENCES party(id),                -- celui de la personne (posé par la garde)
  user_id      uuid NOT NULL REFERENCES app_user(id),
  role         text NOT NULL,
  scope_type   text NOT NULL,
  scope_id     uuid,
  granted_by   uuid REFERENCES app_user(id),             -- NULL seulement pour l'amorçage
  granted_at   timestamptz NOT NULL DEFAULT clock_timestamp(),
  revoked_by   uuid REFERENCES app_user(id),
  revoked_at   timestamptz,
  CONSTRAINT role_assignment_role CHECK (role IN ('PLATFORM_ADMIN','OPERATOR_ADMIN','ORGANIZER_ADMIN','SUPERVISOR',
                                                  'CASHIER','MERCHANT_ADMIN','VENDOR','CUSTOMER')),
  CONSTRAINT role_assignment_scope_type CHECK (scope_type IN ('PLATFORM','OPERATOR','ORGANIZER','EVENT','MERCHANT')),
  CONSTRAINT role_assignment_scope_id CHECK ((scope_type = 'PLATFORM') = (scope_id IS NULL)),
  -- Compatibilité rôle ↔ portée (data-model). VENDOR et CUSTOMER : prévus, non attribuables par l'API ici.
  CONSTRAINT role_assignment_role_scope CHECK (
       (role = 'PLATFORM_ADMIN' AND scope_type = 'PLATFORM')
    OR (role = 'OPERATOR_ADMIN' AND scope_type = 'OPERATOR')
    OR (role = 'ORGANIZER_ADMIN' AND scope_type = 'ORGANIZER')
    OR (role IN ('SUPERVISOR','CASHIER') AND scope_type IN ('ORGANIZER','EVENT'))
    OR (role IN ('MERCHANT_ADMIN','VENDOR') AND scope_type = 'MERCHANT')
    OR (role = 'CUSTOMER' AND scope_type = 'OPERATOR')),
  CONSTRAINT role_assignment_no_self_grant CHECK (granted_by IS NULL OR granted_by <> user_id),
  CONSTRAINT role_assignment_revocation CHECK ((revoked_at IS NULL) = (revoked_by IS NULL))
);
-- Une seule attribution active par (personne, rôle, portée).
CREATE UNIQUE INDEX role_assignment_active_uniq ON role_assignment
  (user_id, role, scope_type, coalesce(scope_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE revoked_at IS NULL;
CREATE INDEX role_assignment_user_idx ON role_assignment (user_id) WHERE revoked_at IS NULL;

-- Nombre de PLATFORM_ADMIN actifs (attribution active, personne ACTIVE), hors une attribution ou une personne donnée.
CREATE FUNCTION active_platform_admins(p_except_assignment uuid, p_except_user uuid) RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT count(*) FROM role_assignment ra JOIN app_user u ON u.id = ra.user_id
   WHERE ra.role = 'PLATFORM_ADMIN' AND ra.revoked_at IS NULL AND u.status = 'ACTIVE'
     AND ra.id IS DISTINCT FROM p_except_assignment AND u.id IS DISTINCT FROM p_except_user
$$;
REVOKE ALL ON FUNCTION active_platform_admins(uuid, uuid) FROM PUBLIC;

-- Garde des personnes : identité immuable, pas de retour à ACTIVE, pas de suppression, la plateforme garde un
-- administrateur. SECURITY DEFINER : lit des lignes de plateforme invisibles sous RLS.
CREATE FUNCTION app_user_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Personne : suppression interdite (désactiver)' USING ERRCODE = 'CL001';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.operator_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM party WHERE id = NEW.operator_id AND kind = 'OPERATOR') THEN
      RAISE EXCEPTION 'Personne : le rattachement doit être un prestataire' USING ERRCODE = 'CL001';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.operator_id, NEW.issuer, NEW.subject, NEW.created_by, NEW.created_at)
     IS DISTINCT FROM (OLD.id, OLD.operator_id, OLD.issuer, OLD.subject, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'Personne : identité immuable' USING ERRCODE = 'CL001';
  END IF;
  IF OLD.status = 'DISABLED' AND NEW.status = 'ACTIVE' THEN
    RAISE EXCEPTION 'Personne désactivée : réactivation interdite' USING ERRCODE = 'CL001';
  END IF;
  IF OLD.status = 'ACTIVE' AND NEW.status = 'DISABLED'
     AND EXISTS (SELECT 1 FROM role_assignment WHERE user_id = OLD.id AND role = 'PLATFORM_ADMIN' AND revoked_at IS NULL)
     AND active_platform_admins(NULL, OLD.id) = 0 THEN
    RAISE EXCEPTION 'Dernier administrateur de la plateforme : désactivation interdite' USING ERRCODE = 'CL001';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app_user_guard() FROM PUBLIC;
CREATE TRIGGER app_user_guard BEFORE INSERT OR UPDATE OR DELETE ON app_user
  FOR EACH ROW EXECUTE FUNCTION app_user_guard();

-- Garde des attributions : prestataire aligné sur la personne, objet de portée existant et du même prestataire,
-- personne active ; seul le retrait (une fois) modifie une ligne ; la plateforme garde un administrateur.
CREATE FUNCTION role_assignment_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u app_user%ROWTYPE; ok boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Attribution : suppression interdite (retirer)' USING ERRCODE = 'CL001';
  END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT * INTO u FROM app_user WHERE id = NEW.user_id;
    IF u.status <> 'ACTIVE' THEN
      RAISE EXCEPTION 'Attribution : personne désactivée' USING ERRCODE = 'CL001';
    END IF;
    NEW.operator_id := u.operator_id;
    IF NEW.revoked_at IS NOT NULL THEN
      RAISE EXCEPTION 'Attribution : déjà retirée à la création' USING ERRCODE = 'CL001';
    END IF;
    -- Une personne de la plateforme n'a que la portée plateforme ; une personne d'un prestataire jamais celle-ci.
    IF (u.operator_id IS NULL) <> (NEW.scope_type = 'PLATFORM') THEN
      RAISE EXCEPTION 'Attribution : portée incompatible avec le rattachement de la personne' USING ERRCODE = 'CL001';
    END IF;
    -- Objet absent : laissé à la contrainte role_assignment_scope_id (23514).
    ok := CASE WHEN NEW.scope_id IS NULL THEN true ELSE CASE NEW.scope_type
      WHEN 'PLATFORM'  THEN true
      WHEN 'OPERATOR'  THEN NEW.scope_id = u.operator_id
      WHEN 'ORGANIZER' THEN EXISTS (SELECT 1 FROM party WHERE id = NEW.scope_id AND kind = 'ORGANIZER' AND operator_id = u.operator_id)
      WHEN 'MERCHANT'  THEN EXISTS (SELECT 1 FROM party WHERE id = NEW.scope_id AND kind = 'MERCHANT' AND operator_id = u.operator_id)
      WHEN 'EVENT'     THEN EXISTS (SELECT 1 FROM event WHERE id = NEW.scope_id AND operator_id = u.operator_id)
   END END;
    IF NOT coalesce(ok, false) THEN
      RAISE EXCEPTION 'Attribution : objet de portée inconnu ou d''un autre prestataire' USING ERRCODE = 'CL001';
    END IF;
    RETURN NEW;
  END IF;
  -- UPDATE : seul le retrait est permis, une seule fois.
  IF (NEW.id, NEW.operator_id, NEW.user_id, NEW.role, NEW.scope_type, NEW.scope_id, NEW.granted_by, NEW.granted_at)
     IS DISTINCT FROM (OLD.id, OLD.operator_id, OLD.user_id, OLD.role, OLD.scope_type, OLD.scope_id, OLD.granted_by, OLD.granted_at)
     OR OLD.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'Attribution : seul un retrait unique est permis' USING ERRCODE = 'CL001';
  END IF;
  IF NEW.revoked_at IS NOT NULL AND OLD.role = 'PLATFORM_ADMIN' AND active_platform_admins(OLD.id, NULL) = 0 THEN
    RAISE EXCEPTION 'Dernier administrateur de la plateforme : retrait interdit' USING ERRCODE = 'CL001';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION role_assignment_guard() FROM PUBLIC;
CREATE TRIGGER role_assignment_guard BEFORE INSERT OR UPDATE OR DELETE ON role_assignment
  FOR EACH ROW EXECUTE FUNCTION role_assignment_guard();

-- Isolation par prestataire, forcée, même forme que les tables du schéma.
ALTER TABLE app_user ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_user FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON app_user
  USING (operator_id = current_setting('app.operator_id', true)::uuid)
  WITH CHECK (operator_id = current_setting('app.operator_id', true)::uuid);
ALTER TABLE role_assignment ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_assignment FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON role_assignment
  USING (operator_id = current_setting('app.operator_id', true)::uuid)
  WITH CHECK (operator_id = current_setting('app.operator_id', true)::uuid);

-- Personne d'un jeton (avant que le prestataire soit connu) : identifiant, prestataire, statut, attributions actives.
-- Seule lecture hors RLS offerte à l'application ; n'expose rien d'autre que la personne demandée.
CREATE FUNCTION identify_person(p_issuer text, p_subject text)
RETURNS TABLE (user_id uuid, operator_id uuid, status text, assignments jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT u.id, u.operator_id, u.status,
         coalesce((SELECT jsonb_agg(jsonb_build_object('role', ra.role, 'scope_type', ra.scope_type,
                                                       'scope_id', ra.scope_id) ORDER BY ra.granted_at, ra.id)
                     FROM role_assignment ra WHERE ra.user_id = u.id AND ra.revoked_at IS NULL), '[]'::jsonb)
    FROM app_user u
   WHERE u.issuer = p_issuer AND u.subject = p_subject
$$;
REVOKE ALL ON FUNCTION identify_person(text, text) FROM PUBLIC;
-- EXECUTE accordé au rôle applicatif par post-roles.sql (le rôle n'existe qu'après roles.sql, rejoué après la série).
