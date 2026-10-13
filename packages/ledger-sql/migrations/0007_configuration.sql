-- Migration 0007 : intégrité de la configuration (SPECIFICATION §3.1, §4, §5.6, §12.1 ; mission
-- configuration-parties-evenements, data-model « Migration 0007 », research R-04 à R-06).
-- Contradictions consignées (research X-4, X-5) : l'émetteur et le tiers détenteur des fonds sont des paramètres de
-- l'événement (§4.2) sans colonne dans le schéma de référence ; le droit de place est porté par la participation
-- (§3.1, §12.1) sans montant ni référence de paiement d'avance. Colonnes ajoutées ici.
-- Versionnement (§4.1, §4.3, §5.6) : contrats, versions de configuration et profils de législation ne se modifient
-- jamais ; une règle de frais se ferme (valid_to) puis se remplace. Le numéro de version est posé par la base.
-- Erreurs métier : CL001 (VALIDATION_FAILED), messages courts et neutres (rien d'un autre prestataire).
-- Aucun nom de rôle ici : les droits sont posés par post-roles.sql (une base neuve n'a pas encore cashless_app).

-- 1. Colonnes ---------------------------------------------------------------------------------------------------
ALTER TABLE event ADD COLUMN issuer text NOT NULL DEFAULT 'ORGANIZER'
  CONSTRAINT event_issuer CHECK (issuer IN ('ORGANIZER','OPERATOR'));
ALTER TABLE event ADD COLUMN funds_holder_party_id uuid REFERENCES party(id);
ALTER TABLE event ADD CONSTRAINT event_funds_holder_party
  CHECK ((funds_holder = 'THIRD_PARTY') = (funds_holder_party_id IS NOT NULL));

ALTER TABLE merchant_participation ADD COLUMN pitch_fee bigint NOT NULL DEFAULT 0
  CONSTRAINT merchant_participation_pitch_fee CHECK (pitch_fee >= 0);
ALTER TABLE merchant_participation ADD COLUMN pitch_fee_reference text;
ALTER TABLE merchant_participation ADD CONSTRAINT merchant_participation_prepaid_reference
  CHECK (pitch_fee_mode <> 'PREPAID' OR pitch_fee = 0 OR pitch_fee_reference IS NOT NULL);

-- Devises connues et leur exposant ISO 4217 (§5.1 : unités mineures). Donnée de référence, sans RLS.
CREATE TABLE currency_exponent (
  code     char(3) PRIMARY KEY CONSTRAINT currency_exponent_code CHECK (code ~ '^[A-Z]{3}$'),
  exponent smallint NOT NULL CONSTRAINT currency_exponent_exponent CHECK (exponent BETWEEN 0 AND 4)
);
INSERT INTO currency_exponent (code, exponent) VALUES ('XOF', 0), ('XAF', 0), ('EUR', 2), ('USD', 2);

-- 2. Cohérence des références ----------------------------------------------------------------------------------
-- Les lectures de party / contract / jurisdiction_profile se font en SECURITY DEFINER : sous RLS, une partie d'un
-- autre prestataire serait simplement invisible et le message dirait « introuvable », ce qui est l'effet voulu,
-- mais le propriétaire (fixtures, migrations) doit obtenir le même contrôle.
CREATE FUNCTION party_kind_of(p uuid) RETURNS TABLE (kind party_kind, operator_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
  $$ SELECT kind, operator_id FROM party WHERE id = p $$;
REVOKE ALL ON FUNCTION party_kind_of(uuid) FROM PUBLIC;

CREATE FUNCTION event_references_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE k party_kind; op uuid; c contract%ROWTYPE;
BEGIN
  SELECT x.kind, x.operator_id INTO k, op FROM party_kind_of(NEW.organizer_id) x;
  IF k IS DISTINCT FROM 'ORGANIZER' OR op IS DISTINCT FROM NEW.operator_id THEN
    RAISE EXCEPTION 'Événement : organisateur inconnu pour ce prestataire' USING ERRCODE = 'CL001';
  END IF;
  IF NEW.contract_id IS NOT NULL THEN
    SELECT * INTO c FROM contract WHERE id = NEW.contract_id;
    IF NOT FOUND OR c.kind <> 'OPERATOR_ORGANIZER' OR c.counterparty_id <> NEW.organizer_id
       OR c.operator_id <> NEW.operator_id THEN
      RAISE EXCEPTION 'Événement : le contrat doit être un contrat prestataire–organisateur de cet organisateur'
        USING ERRCODE = 'CL001';
    END IF;
  END IF;
  IF NEW.funds_holder_party_id IS NOT NULL THEN
    SELECT x.kind, x.operator_id INTO k, op FROM party_kind_of(NEW.funds_holder_party_id) x;
    IF k IS DISTINCT FROM 'THIRD_PARTY' OR op IS DISTINCT FROM NEW.operator_id THEN
      RAISE EXCEPTION 'Événement : le détenteur tiers des fonds doit être une partie tierce de ce prestataire'
        USING ERRCODE = 'CL001';
    END IF;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM currency_exponent WHERE code = NEW.currency) THEN
    RAISE EXCEPTION 'Événement : devise inconnue (%)', NEW.currency USING ERRCODE = 'CL001';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION event_references_guard() FROM PUBLIC;
CREATE TRIGGER event_references_guard
  BEFORE INSERT OR UPDATE OF organizer_id, operator_id, contract_id, funds_holder_party_id,
  jurisdiction_id, currency ON event
  FOR EACH ROW EXECUTE FUNCTION event_references_guard();

-- Participation : commerçant du même prestataire, événement non clôturé, bénéficiaire des versements cohérent
-- (INTERNAL : l'organisateur ; EXTERNAL : le commerçant), posé par la base s'il est absent.
CREATE FUNCTION participation_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE k party_kind; op uuid; ev event%ROWTYPE; expected uuid;
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.event_id, NEW.merchant_id, NEW.operator_id, NEW.link_type)
       IS DISTINCT FROM (OLD.event_id, OLD.merchant_id, OLD.operator_id, OLD.link_type) THEN
    RAISE EXCEPTION 'Participation : événement, commerçant et type ne changent pas' USING ERRCODE = 'CL001';
  END IF;
  SELECT * INTO ev FROM event WHERE id = NEW.event_id;
  IF NOT FOUND OR ev.operator_id <> NEW.operator_id THEN
    RAISE EXCEPTION 'Participation : événement inconnu pour ce prestataire' USING ERRCODE = 'CL001';
  END IF;
  IF ev.status = 'CLOSED' THEN
    RAISE EXCEPTION 'Participation : événement clôturé' USING ERRCODE = 'CL001';
  END IF;
  SELECT x.kind, x.operator_id INTO k, op FROM party_kind_of(NEW.merchant_id) x;
  IF k IS DISTINCT FROM 'MERCHANT' OR op IS DISTINCT FROM NEW.operator_id THEN
    RAISE EXCEPTION 'Participation : commerçant inconnu pour ce prestataire' USING ERRCODE = 'CL001';
  END IF;
  expected := CASE NEW.link_type WHEN 'INTERNAL' THEN ev.organizer_id ELSE NEW.merchant_id END;
  IF NEW.payout_to IS NULL THEN
    NEW.payout_to := expected;
  ELSIF NEW.payout_to <> expected THEN
    RAISE EXCEPTION 'Participation : versements à l''organisateur si INTERNAL, au commerçant si EXTERNAL'
      USING ERRCODE = 'CL001';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION participation_guard() FROM PUBLIC;
CREATE TRIGGER participation_guard BEFORE INSERT OR UPDATE ON merchant_participation
  FOR EACH ROW EXECUTE FUNCTION participation_guard();
-- payout_to est posé par le déclencheur : la colonne peut être omise à l'insertion.
ALTER TABLE merchant_participation ALTER COLUMN payout_to DROP NOT NULL;
ALTER TABLE merchant_participation ADD CONSTRAINT merchant_participation_payout_to CHECK (payout_to IS NOT NULL);

-- Point de vente : rattachement immuable, même prestataire que la participation ; seul le nom change.
CREATE FUNCTION point_of_sale_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.participation_id, NEW.operator_id) IS DISTINCT FROM (OLD.participation_id, OLD.operator_id) THEN
    RAISE EXCEPTION 'Point de vente : rattachement immuable' USING ERRCODE = 'CL001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM merchant_participation WHERE id = NEW.participation_id AND operator_id = NEW.operator_id) THEN
    RAISE EXCEPTION 'Point de vente : participation inconnue pour ce prestataire' USING ERRCODE = 'CL001';
  END IF;
  IF length(btrim(NEW.name)) = 0 THEN
    RAISE EXCEPTION 'Point de vente : nom obligatoire' USING ERRCODE = 'CL001';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION point_of_sale_guard() FROM PUBLIC;
CREATE TRIGGER point_of_sale_guard BEFORE INSERT OR UPDATE ON point_of_sale
  FOR EACH ROW EXECUTE FUNCTION point_of_sale_guard();

-- 3. Règles de frais : bornes, portée cohérente, fermeture seule ------------------------------------------------
ALTER TABLE fee_rule ADD CONSTRAINT fee_rule_rate CHECK (rate_bps BETWEEN 0 AND 10000);
ALTER TABLE fee_rule ADD CONSTRAINT fee_rule_amounts
  CHECK (fixed_amount >= 0 AND (min_amount IS NULL OR min_amount >= 0) AND (max_amount IS NULL OR max_amount >= 0)
         AND (min_amount IS NULL OR max_amount IS NULL OR min_amount <= max_amount));
ALTER TABLE fee_rule ADD CONSTRAINT fee_rule_validity CHECK (valid_to IS NULL OR valid_to >= valid_from);
ALTER TABLE fee_rule ADD CONSTRAINT fee_rule_version_uniq
  UNIQUE (scope_type, scope_id, payer_purpose, beneficiary_purpose, basis, version);

-- Objet visé par la portée, du même prestataire que la règle. Une règle sans prestataire (operator_id NULL, niveau
-- plateforme du schéma de référence) n'est contrôlée que sur l'existence de l'objet.
CREATE FUNCTION fee_rule_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
  END CASE;
  IF found_obj IS NULL OR (NEW.operator_id IS NOT NULL AND obj_op <> NEW.operator_id) THEN
    RAISE EXCEPTION 'Règle de frais : objet de la portée % inconnu pour ce prestataire', NEW.scope_type
      USING ERRCODE = 'CL001';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION fee_rule_guard() FROM PUBLIC;
CREATE TRIGGER fee_rule_guard BEFORE INSERT OR UPDATE ON fee_rule
  FOR EACH ROW EXECUTE FUNCTION fee_rule_guard();
CREATE FUNCTION fee_rule_no_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Règle de frais : suppression interdite (fermer par valid_to)' USING ERRCODE = 'CL001';
END $$;
CREATE TRIGGER fee_rule_no_delete BEFORE DELETE ON fee_rule FOR EACH ROW EXECUTE FUNCTION fee_rule_no_delete();

-- 4. Objets versionnés : jamais modifiés, numéro posé par la base -----------------------------------------------
CREATE FUNCTION versioned_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% : ne se modifie pas, créer une nouvelle version', TG_TABLE_NAME USING ERRCODE = 'CL001';
END $$;
CREATE TRIGGER contract_immutable BEFORE UPDATE OR DELETE ON contract
  FOR EACH ROW EXECUTE FUNCTION versioned_immutable();
CREATE TRIGGER config_version_immutable BEFORE UPDATE OR DELETE ON config_version
  FOR EACH ROW EXECUTE FUNCTION versioned_immutable();
CREATE TRIGGER jurisdiction_profile_immutable BEFORE UPDATE OR DELETE ON jurisdiction_profile
  FOR EACH ROW EXECUTE FUNCTION versioned_immutable();

ALTER TABLE contract ADD CONSTRAINT contract_version_uniq UNIQUE (operator_id, kind, counterparty_id, version);

-- Version n+1 d'un contrat (même prestataire, type, contrepartie) ; date d'effet jamais antérieure à la précédente.
-- SECURITY DEFINER : la précédente version doit être vue même si elle est hors de la portée RLS de l'appelant.
-- Verrou consultatif par triplet : deux nouvelles versions simultanées ne prennent pas le même numéro.
CREATE FUNCTION contract_version_assign() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE prev contract%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('contract:' || NEW.operator_id || ':' || NEW.kind || ':' || NEW.counterparty_id, 0));
  SELECT * INTO prev FROM contract
   WHERE operator_id = NEW.operator_id AND kind = NEW.kind AND counterparty_id = NEW.counterparty_id
   ORDER BY version DESC LIMIT 1;
  NEW.version := coalesce(prev.version, 0) + 1;
  IF prev.id IS NOT NULL AND NEW.valid_from < prev.valid_from THEN
    RAISE EXCEPTION 'Contrat : la nouvelle version ne peut pas prendre effet avant la précédente' USING ERRCODE = 'CL001';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION contract_version_assign() FROM PUBLIC;
CREATE TRIGGER contract_version_assign BEFORE INSERT ON contract
  FOR EACH ROW EXECUTE FUNCTION contract_version_assign();

-- Version n+1 d'un niveau de configuration (scope_type, scope_id).
CREATE FUNCTION config_version_assign() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE prev config_version%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('config:' || NEW.scope_type || ':' || NEW.scope_id, 0));
  SELECT * INTO prev FROM config_version WHERE scope_type = NEW.scope_type AND scope_id = NEW.scope_id
   ORDER BY version DESC LIMIT 1;
  NEW.version := coalesce(prev.version, 0) + 1;
  IF prev.id IS NOT NULL AND NEW.valid_from < prev.valid_from THEN
    RAISE EXCEPTION 'Configuration : la nouvelle version ne peut pas prendre effet avant la précédente' USING ERRCODE = 'CL001';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION config_version_assign() FROM PUBLIC;
CREATE TRIGGER config_version_assign BEFORE INSERT ON config_version
  FOR EACH ROW EXECUTE FUNCTION config_version_assign();

-- 5. Borne de la législation sur l'événement (défense en profondeur de l'API, research R-06) ----------------------
CREATE FUNCTION event_jurisdiction_bounds() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE min_days int;
BEGIN
  IF NEW.starts_at IS NOT NULL AND NEW.ends_at IS NOT NULL AND NEW.ends_at < NEW.starts_at THEN
    RAISE EXCEPTION 'Événement : la fin précède le début' USING ERRCODE = 'CL001';
  END IF;
  IF NEW.refund_deadline IS NOT NULL AND NEW.ends_at IS NOT NULL THEN
    SELECT min_refund_window_days INTO min_days FROM jurisdiction_profile WHERE id = NEW.jurisdiction_id;
    IF min_days IS NOT NULL AND NEW.refund_deadline < NEW.ends_at + make_interval(days => min_days) THEN
      RAISE EXCEPTION 'Règle jurisdiction.min_refund_window_days : date limite de remboursement au plus tôt % jours après la fin',
        min_days USING ERRCODE = 'CL001';
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION event_jurisdiction_bounds() FROM PUBLIC;
CREATE TRIGGER event_jurisdiction_bounds
  BEFORE INSERT OR UPDATE OF refund_deadline, ends_at, starts_at, jurisdiction_id ON event
  FOR EACH ROW EXECUTE FUNCTION event_jurisdiction_bounds();
