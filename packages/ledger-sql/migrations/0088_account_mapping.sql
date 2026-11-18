-- Correspondance comptable versionnée de l'export (mission 9b, lot WP05 ; FR-023, C-007, R-14, S22).
-- Table `account_mapping` en ajout seul, sous RLS ENABLE + FORCE, avec garde de portée, et la fonction
-- `create_account_mapping_version`. Aucun jeu SYSCOHADA (OP-N3, C-007) : la table est vide à la livraison.
-- AUCUN GRANT ici : WP06 pose les droits (lecture par SELECT, écriture par la seule fonction).
-- Clé : `transaction_type` nul (= tous les types) est impossible dans une PK ; choix : index UNIQUE avec
-- coalesce(transaction_type, '*') et CHECK interdisant la valeur '*' dans la colonne (la colonne reste nulle pour
-- « tous »). Pas de clé primaire ; l'unicité est portée par l'index `account_mapping_key`.
-- Hypothèse existante (0022) : le propriétaire des fonctions SECURITY DEFINER ignore la RLS forcée.
-- Fonctions à faire relire : account_mapping_scope_guard, create_account_mapping_version.

CREATE TABLE account_mapping (
  operator_id     uuid NOT NULL REFERENCES party(id),
  entity_party_id uuid NOT NULL REFERENCES party(id),
  version         int NOT NULL CHECK (version >= 1),
  valid_from      timestamptz NOT NULL,
  purpose         text NOT NULL CHECK (length(btrim(purpose)) > 0),
  transaction_type text CHECK (transaction_type IS NULL
                               OR (length(btrim(transaction_type)) > 0 AND transaction_type <> '*')),
  debit_account   text NOT NULL CHECK (length(btrim(debit_account)) > 0 AND length(debit_account) <= 32),
  credit_account  text NOT NULL CHECK (length(btrim(credit_account)) > 0 AND length(credit_account) <= 32),
  created_by      uuid NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX account_mapping_key
  ON account_mapping (operator_id, entity_party_id, version, purpose, coalesce(transaction_type, '*'));

ALTER TABLE account_mapping ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_mapping FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON account_mapping
  USING (operator_id = nullif(current_setting('app.operator_id', true), '')::uuid)
  WITH CHECK (operator_id = nullif(current_setting('app.operator_id', true), '')::uuid);

-- Garde de portée : l'entité est le prestataire ou une partie de ce prestataire.
CREATE FUNCTION account_mapping_scope_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM party p
                  WHERE p.id = NEW.entity_party_id
                    AND (p.id = NEW.operator_id OR p.operator_id = NEW.operator_id)) THEN
    RAISE EXCEPTION 'Correspondance comptable : entité d''un autre prestataire' USING ERRCODE = 'CL001';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION account_mapping_scope_guard() FROM PUBLIC;
CREATE TRIGGER account_mapping_scope_guard BEFORE INSERT ON account_mapping
  FOR EACH ROW EXECUTE FUNCTION account_mapping_scope_guard();

-- Ajout seul, pour tout rôle (propriétaire compris) : UPDATE, DELETE et TRUNCATE refusés.
CREATE FUNCTION account_mapping_append_only() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'account_mapping en ajout seul' USING ERRCODE = 'CL001';
END $$;
REVOKE ALL ON FUNCTION account_mapping_append_only() FROM PUBLIC;
CREATE TRIGGER account_mapping_append_only BEFORE UPDATE OR DELETE ON account_mapping
  FOR EACH ROW EXECUTE FUNCTION account_mapping_append_only();
CREATE TRIGGER account_mapping_no_truncate BEFORE TRUNCATE ON account_mapping
  FOR EACH STATEMENT EXECUTE FUNCTION account_mapping_append_only();

-- Nouvelle version complète du mappage d'une entité. Rend le numéro de version.
-- p_lines : tableau d'objets {purpose, transaction_type (nul = tous), debit_account, credit_account}.
CREATE FUNCTION create_account_mapping_version(p_operator uuid, p_entity uuid, p_valid_from timestamptz,
                                               p_lines jsonb, p_actor uuid)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_prev_version int; v_prev_from timestamptz; v_version int;
BEGIN
  PERFORM assert_tenant(p_operator);
  IF p_actor IS NULL OR p_entity IS NULL OR p_valid_from IS NULL THEN
    RAISE EXCEPTION 'Correspondance comptable : auteur, entité et date obligatoires' USING ERRCODE = 'CL001';
  END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'Correspondance comptable : au moins une ligne' USING ERRCODE = 'CL001';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_lines) e WHERE jsonb_typeof(e) <> 'object') THEN
    RAISE EXCEPTION 'Correspondance comptable : lignes mal formées' USING ERRCODE = 'CL001';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_to_recordset(p_lines) AS l(purpose text, transaction_type text)
              GROUP BY l.purpose, coalesce(l.transaction_type, '*') HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Correspondance comptable : doublon (finalité, type)' USING ERRCODE = 'CL001';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('account-mapping:' || p_operator || ':' || p_entity, 0));
  SELECT m.version, m.valid_from INTO v_prev_version, v_prev_from FROM account_mapping m
   WHERE m.operator_id = p_operator AND m.entity_party_id = p_entity
   ORDER BY m.version DESC LIMIT 1;
  IF v_prev_version IS NOT NULL AND p_valid_from <= v_prev_from THEN
    RAISE EXCEPTION 'Correspondance comptable : valid_from doit être postérieur à la version précédente'
      USING ERRCODE = 'CL001';
  END IF;
  v_version := coalesce(v_prev_version, 0) + 1;
  INSERT INTO account_mapping (operator_id, entity_party_id, version, valid_from, purpose, transaction_type,
                               debit_account, credit_account, created_by)
  SELECT p_operator, p_entity, v_version, p_valid_from, l.purpose, l.transaction_type, l.debit_account,
         l.credit_account, p_actor
    FROM jsonb_to_recordset(p_lines)
      AS l(purpose text, transaction_type text, debit_account text, credit_account text);
  RETURN v_version;
END $$;
REVOKE ALL ON FUNCTION create_account_mapping_version(uuid, uuid, timestamptz, jsonb, uuid) FROM PUBLIC;
