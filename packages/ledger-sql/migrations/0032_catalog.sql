-- Migration 0032 : catalogue versionné par point de vente et lignes de vente (S18 ; mission
-- terminaux-paiement-en-ligne, lot WP03 ; FR-007, FR-008, FR-011, FR-012, NFR-006 ; data-model
-- « catalog_* », « device_catalog_served », « sale_line » ; contracts/catalog.md ; research R-04
-- révisé par A2, R-11 A2 et A21 ; décision du porteur DM-01M5HK8RJSX2KVK7Y6Y0C7XSRD : prix servi ou
-- actuel).
--
-- Contenu :
--   1. Tables : `point_of_sale_catalog_policy` (délégation au commerçant ; sa ligne sert de verrou
--      du catalogue d'un point de vente), `catalog_category`, `catalog_item` (état courant),
--      `catalog_version`, `catalog_version_item` (versions immuables), `device_catalog_served`
--      (versions servies à chaque terminal), `sale_line` (lignes d'une vente). RLS activée et
--      forcée sur les sept ; versions, versions servies et lignes en ajout seul
--      (`forbid_mutation`) ; catégories, articles et politiques sans suppression (désactivation
--      seulement).
--   2. Fonctions SECURITY DEFINER, `search_path = public, pg_temp`, EXECUTE retiré à PUBLIC. Aucun
--      GRANT ici : les droits de `cashless_app` sont posés par `post-roles.sql` (lot WP07).
--        catalog_admin_allowed        (interne) auteur autorisé sur le catalogue d'un point de
--                                     vente
--        catalog_lock_pos             (interne) verrou du point de vente et contrôles communs
--        catalog_bump_version         (interne) version suivante, copie des articles actifs
--        create_catalog_category, update_catalog_category, create_catalog_item, update_catalog_item
--        set_catalog_policy           délégation au commerçant (organisateur ou prestataire seuls)
--        record_device_catalog_served version servie à un terminal CATALOG_POS
--        check_sale_lines             contrôle seul des lignes (sans écriture ; WP04 et WP05)
--        record_sale_lines            écriture des lignes d'une vente PURCHASE
--
-- Chaque lecture et chaque écriture nomment le prestataire de la session (`app.operator_id`) : les
-- fonctions ne s'appuient pas sur la RLS (même hypothèse sur le propriétaire que 0022).
--
-- Erreurs (traduites par apps/api/src/errors/sqlstate-map.ts) :
--   CL001   paramètre invalide (bornes du catalogue)                   -> 422 VALIDATION_FAILED
--   CL029   écriture du catalogue sur un événement CLOSED (état de
--           l'objet incompatible, même sens que 0022)                  -> 409 CONFLICT_STATE
--   CL034   lignes de vente refusées (forme, article, prix, version,
--           somme, vente, terminal ; nouveau)                          -> 422 SALE_LINES_INVALID
--   42501   terminal révoqué (record_device_catalog_served)            -> 403 DEVICE_REVOKED
--   P0002   objet introuvable, d'un autre prestataire ou hors du périmètre de l'auteur -> 404

-- 1. Tables ---------------------------------------------------------------------------------------
-- Délégation au commerçant : créée à la première écriture du catalogue du point de vente (ou par
-- set_catalog_policy) ; verrouillée (FOR UPDATE) par chaque écriture du catalogue (A21).
CREATE TABLE point_of_sale_catalog_policy (
  pos_id           uuid PRIMARY KEY REFERENCES point_of_sale(id),
  operator_id      uuid NOT NULL REFERENCES party(id),
  merchant_manages boolean NOT NULL DEFAULT false,
  updated_by       uuid NOT NULL REFERENCES app_user(id),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- Libellés : sans espace en tête ni en fin (les fonctions les rognent), 1 à 120 caractères.
CREATE TABLE catalog_category (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id uuid NOT NULL REFERENCES party(id),
  pos_id      uuid NOT NULL REFERENCES point_of_sale(id),
  label_fr    text NOT NULL,
  label_en    text NOT NULL,
  position    int NOT NULL CONSTRAINT catalog_category_position CHECK (position >= 0),
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT catalog_category_labels CHECK (
    label_fr = btrim(label_fr) AND length(label_fr) BETWEEN 1 AND 120
    AND label_en = btrim(label_en) AND length(label_en) BETWEEN 1 AND 120),
  -- Cible de la clé composite de catalog_item : un article reste dans le point de vente de sa
  -- catégorie.
  CONSTRAINT catalog_category_pos_id_key UNIQUE (pos_id, id)
);
CREATE INDEX catalog_category_pos_idx ON catalog_category (pos_id, position);

CREATE TABLE catalog_item (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id  uuid NOT NULL REFERENCES party(id),
  pos_id       uuid NOT NULL REFERENCES point_of_sale(id),
  category_id  uuid NOT NULL,
  label_fr     text NOT NULL,
  label_en     text NOT NULL,
  unit_price   bigint NOT NULL CONSTRAINT catalog_item_unit_price CHECK (unit_price > 0),
  vat_rate_bps int NOT NULL
               CONSTRAINT catalog_item_vat_rate CHECK (vat_rate_bps BETWEEN 0 AND 10000),
  active       boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT catalog_item_labels CHECK (
    label_fr = btrim(label_fr) AND length(label_fr) BETWEEN 1 AND 120
    AND label_en = btrim(label_en) AND length(label_en) BETWEEN 1 AND 120),
  -- Renforcement : le point de vente de l'article est celui de sa catégorie, tenu par la table.
  CONSTRAINT catalog_item_category_fk FOREIGN KEY (pos_id, category_id)
    REFERENCES catalog_category (pos_id, id)
);
CREATE INDEX catalog_item_pos_idx ON catalog_item (pos_id);
CREATE INDEX catalog_item_category_idx ON catalog_item (category_id);

-- Versions immuables, numérotées par point de vente à partir de 1.
CREATE TABLE catalog_version (
  operator_id uuid NOT NULL REFERENCES party(id),
  pos_id      uuid NOT NULL REFERENCES point_of_sale(id),
  version     int NOT NULL CONSTRAINT catalog_version_number CHECK (version >= 1),
  created_by  uuid NOT NULL REFERENCES app_user(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (pos_id, version)
);

-- Copie des articles actifs d'une catégorie active au moment de la version. Libellés et rang de la
-- catégorie copiés aussi (arbitrage du 22/10) : un renommage ultérieur ne change pas une version.
CREATE TABLE catalog_version_item (
  operator_id       uuid NOT NULL REFERENCES party(id),
  pos_id            uuid NOT NULL,
  version           int NOT NULL,
  item_id           uuid NOT NULL REFERENCES catalog_item(id),
  category_id       uuid NOT NULL REFERENCES catalog_category(id),
  label_fr          text NOT NULL,
  label_en          text NOT NULL,
  category_label_fr text NOT NULL,
  category_label_en text NOT NULL,
  category_position int NOT NULL,
  unit_price        bigint NOT NULL
                    CONSTRAINT catalog_version_item_unit_price CHECK (unit_price > 0),
  vat_rate_bps      int NOT NULL
                    CONSTRAINT catalog_version_item_vat_rate
                      CHECK (vat_rate_bps BETWEEN 0 AND 10000),
  PRIMARY KEY (pos_id, version, item_id),
  CONSTRAINT catalog_version_item_version_fk FOREIGN KEY (pos_id, version)
    REFERENCES catalog_version (pos_id, version)
);

-- Versions servies (configuration d'un terminal CATALOG_POS), en ajout seul. Unique (device_id,
-- pos_id, version), et non (device_id, version) comme data-model (renforcement d'A2) : les numéros
-- de version sont comptés par point de vente ; avec la clé de data-model, un terminal réaffecté
-- d'un point de vente à un autre perdrait l'écriture d'un numéro déjà servi ailleurs, et la
-- « dernière servie » redeviendrait une version servie puis remplacée. Une version déjà servie au
-- terminal pour ce point de vente n'est pas réécrite. « Dernière servie » = plus grand numéro servi
-- pour ce terminal et ce point de vente (les versions d'un point de vente croissent ; served_at ne
-- départage qu'ensuite) : une horloge qui recule ne peut pas rendre de nouveau admise une version
-- servie puis remplacée (renforcement d'A2).
CREATE TABLE device_catalog_served (
  operator_id uuid NOT NULL REFERENCES party(id),
  device_id   uuid NOT NULL REFERENCES device(id),
  pos_id      uuid NOT NULL,
  version     int NOT NULL,
  served_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT device_catalog_served_key UNIQUE (device_id, pos_id, version),
  CONSTRAINT device_catalog_served_version_fk FOREIGN KEY (pos_id, version)
    REFERENCES catalog_version (pos_id, version)
);
CREATE INDEX device_catalog_served_last_idx
  ON device_catalog_served (device_id, pos_id, served_at DESC);

-- Lignes d'une vente. `pos_id` en plus de data-model (renforcement) : la clé composite vers
-- catalog_version_item garantit que l'article, son prix et son taux viennent de la version nommée.
CREATE TABLE sale_line (
  operator_id     uuid NOT NULL REFERENCES party(id),
  transaction_id  uuid NOT NULL REFERENCES journal_transaction(id),
  line_no         int NOT NULL CONSTRAINT sale_line_line_no CHECK (line_no >= 1),
  pos_id          uuid NOT NULL,
  item_id         uuid NOT NULL,
  catalog_version int NOT NULL,
  label_fr        text NOT NULL,
  label_en        text NOT NULL,
  quantity        int NOT NULL CONSTRAINT sale_line_quantity CHECK (quantity >= 1),
  unit_price      bigint NOT NULL CONSTRAINT sale_line_unit_price CHECK (unit_price > 0),
  vat_rate_bps    int NOT NULL
                  CONSTRAINT sale_line_vat_rate CHECK (vat_rate_bps BETWEEN 0 AND 10000),
  line_total      bigint NOT NULL,
  PRIMARY KEY (transaction_id, line_no),
  CONSTRAINT sale_line_total CHECK (line_total = quantity * unit_price),
  CONSTRAINT sale_line_version_item_fk FOREIGN KEY (pos_id, catalog_version, item_id)
    REFERENCES catalog_version_item (pos_id, version, item_id)
);
CREATE INDEX sale_line_item_idx ON sale_line (item_id);

-- Ajout seul : versions, contenu des versions, versions servies, lignes de vente.
CREATE TRIGGER catalog_version_immutable BEFORE UPDATE OR DELETE ON catalog_version
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER catalog_version_item_immutable BEFORE UPDATE OR DELETE ON catalog_version_item
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER device_catalog_served_immutable BEFORE UPDATE OR DELETE ON device_catalog_served
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER sale_line_immutable BEFORE UPDATE OR DELETE ON sale_line
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
-- Pas de suppression de l'état courant (désactivation seulement ; renforcement : tenu par la
-- table).
CREATE TRIGGER catalog_category_no_delete BEFORE DELETE ON catalog_category
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER catalog_item_no_delete BEFORE DELETE ON catalog_item
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER point_of_sale_catalog_policy_no_delete BEFORE DELETE ON point_of_sale_catalog_policy
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- RLS activée et forcée, même politique que 0022.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['point_of_sale_catalog_policy','catalog_category','catalog_item',
                           'catalog_version','catalog_version_item','device_catalog_served',
                           'sale_line'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
                     USING (operator_id = current_setting('app.operator_id', true)::uuid)
                     WITH CHECK (operator_id = current_setting('app.operator_id', true)::uuid)$p$,
                 t);
  END LOOP;
END $$;

-- 2. Fonctions internes ---------------------------------------------------------------------------
-- Auteur autorisé sur le catalogue d'un point de vente : OPERATOR_ADMIN du prestataire ou
-- ORGANIZER_ADMIN de l'organisateur de l'événement du point de vente (device_admin_allowed, 0022) ;
-- ou, si la délégation est active, MERCHANT_ADMIN (portée MERCHANT, attribution non retirée,
-- personne ACTIVE du prestataire) du commerçant du point de vente. Point de vente inconnu : faux.
CREATE FUNCTION catalog_admin_allowed(p_operator uuid, p_pos uuid, p_actor uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce((
    SELECT device_admin_allowed(p_operator, mp.event_id, p_actor)
           OR (coalesce(pol.merchant_manages, false) AND EXISTS (
                 SELECT 1 FROM app_user u
                   JOIN role_assignment a ON a.user_id = u.id AND a.revoked_at IS NULL
                  WHERE u.id = p_actor AND u.operator_id = p_operator AND u.status = 'ACTIVE'
                    AND a.operator_id = p_operator AND a.role = 'MERCHANT_ADMIN'
                    AND a.scope_type = 'MERCHANT' AND a.scope_id = mp.merchant_id))
      FROM point_of_sale p
      JOIN merchant_participation mp ON mp.id = p.participation_id AND mp.operator_id = p_operator
      LEFT JOIN point_of_sale_catalog_policy pol
             ON pol.pos_id = p.id AND pol.operator_id = p_operator
     WHERE p.id = p_pos AND p.operator_id = p_operator), false)
$$;
REVOKE ALL ON FUNCTION catalog_admin_allowed(uuid, uuid, uuid) FROM PUBLIC;

-- Déroulé commun des écritures (A21) : point de vente du prestataire (P0002) ; ligne de politique
-- créée si absente puis verrouillée (FOR UPDATE : deux écritures simultanées donnent deux versions
-- successives) ; auteur relu APRÈS le verrou (P0002) — le commerçant seulement si p_merchant_ok et
-- délégation active ; événement CLOSED refusé (CL029).
CREATE FUNCTION catalog_lock_pos(p_operator uuid, p_pos uuid, p_actor uuid, p_merchant_ok boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_event uuid;
  v_status event_status;
BEGIN
  IF p_operator IS NULL OR p_pos IS NULL OR p_actor IS NULL THEN
    RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found';
  END IF;
  SELECT mp.event_id INTO v_event
    FROM point_of_sale p JOIN merchant_participation mp ON mp.id = p.participation_id
   WHERE p.id = p_pos AND p.operator_id = p_operator AND mp.operator_id = p_operator;
  IF NOT FOUND THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  -- Un auteur inconnu ferait échouer la clé étrangère (23503) : refus nommé avant.
  PERFORM 1 FROM app_user WHERE id = p_actor AND operator_id = p_operator;
  IF NOT FOUND THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  INSERT INTO point_of_sale_catalog_policy (pos_id, operator_id, merchant_manages, updated_by,
                                            updated_at)
  VALUES (p_pos, p_operator, false, p_actor, now())
  ON CONFLICT (pos_id) DO NOTHING;
  PERFORM 1 FROM point_of_sale_catalog_policy
   WHERE pos_id = p_pos AND operator_id = p_operator FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  IF NOT (CASE WHEN p_merchant_ok THEN catalog_admin_allowed(p_operator, p_pos, p_actor)
               ELSE device_admin_allowed(p_operator, v_event, p_actor) END) THEN
    RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found';
  END IF;
  SELECT status INTO v_status FROM event WHERE id = v_event AND operator_id = p_operator;
  IF v_status = 'CLOSED' THEN
    RAISE EXCEPTION 'Catalogue : événement clos' USING ERRCODE = 'CL029';
  END IF;
END $$;
REVOKE ALL ON FUNCTION catalog_lock_pos(uuid, uuid, uuid, boolean) FROM PUBLIC;

-- Version suivante du point de vente (appelée sous le verrou de catalog_lock_pos) : copie des
-- articles actifs dont la catégorie est active (arbitrage du 22/10).
CREATE FUNCTION catalog_bump_version(p_operator uuid, p_pos uuid, p_actor uuid) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_version int;
BEGIN
  SELECT coalesce(max(v.version), 0) + 1 INTO v_version
    FROM catalog_version v WHERE v.pos_id = p_pos AND v.operator_id = p_operator;
  INSERT INTO catalog_version (operator_id, pos_id, version, created_by, created_at)
  VALUES (p_operator, p_pos, v_version, p_actor, now());
  INSERT INTO catalog_version_item (operator_id, pos_id, version, item_id, category_id, label_fr,
                                    label_en, category_label_fr, category_label_en,
                                    category_position, unit_price, vat_rate_bps)
  SELECT p_operator, p_pos, v_version, i.id, c.id, i.label_fr, i.label_en, c.label_fr, c.label_en,
         c.position, i.unit_price, i.vat_rate_bps
    FROM catalog_item i
    JOIN catalog_category c
      ON c.id = i.category_id AND c.pos_id = p_pos AND c.operator_id = p_operator
   WHERE i.pos_id = p_pos AND i.operator_id = p_operator AND i.active AND c.active;
  RETURN v_version;
END $$;
REVOKE ALL ON FUNCTION catalog_bump_version(uuid, uuid, uuid) FROM PUBLIC;

-- Bornes d'un libellé (CL001) ; rend le libellé rogné. NULL : NULL (paramètre inchangé).
CREATE FUNCTION catalog_label(p_label text, p_what text) RETURNS text
LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF p_label IS NULL THEN RETURN NULL; END IF;
  IF length(btrim(p_label)) NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION 'Catalogue : libellé % vide ou de plus de 120 caractères', p_what
      USING ERRCODE = 'CL001';
  END IF;
  RETURN btrim(p_label);
END $$;
REVOKE ALL ON FUNCTION catalog_label(text, text) FROM PUBLIC;

-- 3. Écritures du catalogue -----------------------------------------------------------------------
-- Chacune rend (id, version) : l'objet écrit et la version créée dans la même transaction.
CREATE FUNCTION create_catalog_category(p_pos uuid, p_label_fr text, p_label_en text,
                                        p_position int, p_actor uuid)
RETURNS TABLE (id uuid, version int)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE
  v_operator uuid := nullif(current_setting('app.operator_id', true), '')::uuid;
  v_id uuid;
BEGIN
  PERFORM catalog_lock_pos(v_operator, p_pos, p_actor, true);
  IF p_label_fr IS NULL OR p_label_en IS NULL THEN
    RAISE EXCEPTION 'Catalogue : libellés FR et EN obligatoires' USING ERRCODE = 'CL001';
  END IF;
  IF p_position IS NULL OR p_position < 0 THEN
    RAISE EXCEPTION 'Catalogue : rang de catégorie invalide' USING ERRCODE = 'CL001';
  END IF;
  INSERT INTO catalog_category (operator_id, pos_id, label_fr, label_en, position)
  VALUES (v_operator, p_pos, catalog_label(p_label_fr, 'FR'), catalog_label(p_label_en, 'EN'),
          p_position)
  RETURNING catalog_category.id INTO v_id;
  RETURN QUERY SELECT v_id, catalog_bump_version(v_operator, p_pos, p_actor);
END $$;
REVOKE ALL ON FUNCTION create_catalog_category(uuid, text, text, int, uuid) FROM PUBLIC;

-- Paramètre NULL : inchangé.
CREATE FUNCTION update_catalog_category(p_category uuid, p_label_fr text, p_label_en text,
                                        p_position int, p_active boolean, p_actor uuid)
RETURNS TABLE (id uuid, version int)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE
  v_operator uuid := nullif(current_setting('app.operator_id', true), '')::uuid;
  v_pos uuid;
BEGIN
  SELECT c.pos_id INTO v_pos FROM catalog_category c
   WHERE c.id = p_category AND c.operator_id = v_operator;
  IF NOT FOUND THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  PERFORM catalog_lock_pos(v_operator, v_pos, p_actor, true);
  IF p_position IS NOT NULL AND p_position < 0 THEN
    RAISE EXCEPTION 'Catalogue : rang de catégorie invalide' USING ERRCODE = 'CL001';
  END IF;
  UPDATE catalog_category c
     SET label_fr = coalesce(catalog_label(p_label_fr, 'FR'), c.label_fr),
         label_en = coalesce(catalog_label(p_label_en, 'EN'), c.label_en),
         position = coalesce(p_position, c.position),
         active = coalesce(p_active, c.active),
         updated_at = now()
   WHERE c.id = p_category AND c.operator_id = v_operator;
  RETURN QUERY SELECT p_category, catalog_bump_version(v_operator, v_pos, p_actor);
END $$;
REVOKE ALL ON FUNCTION update_catalog_category(uuid, text, text, int, boolean, uuid) FROM PUBLIC;

CREATE FUNCTION create_catalog_item(p_category uuid, p_label_fr text, p_label_en text,
                                    p_unit_price bigint, p_vat_rate_bps int, p_actor uuid)
RETURNS TABLE (id uuid, version int)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE
  v_operator uuid := nullif(current_setting('app.operator_id', true), '')::uuid;
  v_pos uuid;
  v_id uuid;
BEGIN
  SELECT c.pos_id INTO v_pos FROM catalog_category c
   WHERE c.id = p_category AND c.operator_id = v_operator;
  IF NOT FOUND THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  PERFORM catalog_lock_pos(v_operator, v_pos, p_actor, true);
  IF p_label_fr IS NULL OR p_label_en IS NULL THEN
    RAISE EXCEPTION 'Catalogue : libellés FR et EN obligatoires' USING ERRCODE = 'CL001';
  END IF;
  IF p_unit_price IS NULL OR p_unit_price <= 0 THEN
    RAISE EXCEPTION 'Catalogue : prix strictement positif requis' USING ERRCODE = 'CL001';
  END IF;
  IF p_vat_rate_bps IS NULL OR p_vat_rate_bps NOT BETWEEN 0 AND 10000 THEN
    RAISE EXCEPTION 'Catalogue : taux de TVA hors bornes (0 à 10000)' USING ERRCODE = 'CL001';
  END IF;
  INSERT INTO catalog_item (operator_id, pos_id, category_id, label_fr, label_en, unit_price,
                            vat_rate_bps)
  VALUES (v_operator, v_pos, p_category, catalog_label(p_label_fr, 'FR'),
          catalog_label(p_label_en, 'EN'), p_unit_price, p_vat_rate_bps)
  RETURNING catalog_item.id INTO v_id;
  RETURN QUERY SELECT v_id, catalog_bump_version(v_operator, v_pos, p_actor);
END $$;
REVOKE ALL ON FUNCTION create_catalog_item(uuid, text, text, bigint, int, uuid) FROM PUBLIC;

-- Paramètre NULL : inchangé. Changement de catégorie : même point de vente seulement (CL001).
CREATE FUNCTION update_catalog_item(p_item uuid, p_category uuid, p_label_fr text, p_label_en text,
                                    p_unit_price bigint, p_vat_rate_bps int, p_active boolean,
                                    p_actor uuid)
RETURNS TABLE (id uuid, version int)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE
  v_operator uuid := nullif(current_setting('app.operator_id', true), '')::uuid;
  v_pos uuid;
  v_cat_pos uuid;
BEGIN
  SELECT i.pos_id INTO v_pos FROM catalog_item i WHERE i.id = p_item AND i.operator_id = v_operator;
  IF NOT FOUND THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  PERFORM catalog_lock_pos(v_operator, v_pos, p_actor, true);
  IF p_category IS NOT NULL THEN
    SELECT c.pos_id INTO v_cat_pos FROM catalog_category c
     WHERE c.id = p_category AND c.operator_id = v_operator;
    IF NOT FOUND THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
    IF v_cat_pos <> v_pos THEN
      RAISE EXCEPTION 'Catalogue : catégorie d''un autre point de vente' USING ERRCODE = 'CL001';
    END IF;
  END IF;
  IF p_unit_price IS NOT NULL AND p_unit_price <= 0 THEN
    RAISE EXCEPTION 'Catalogue : prix strictement positif requis' USING ERRCODE = 'CL001';
  END IF;
  IF p_vat_rate_bps IS NOT NULL AND p_vat_rate_bps NOT BETWEEN 0 AND 10000 THEN
    RAISE EXCEPTION 'Catalogue : taux de TVA hors bornes (0 à 10000)' USING ERRCODE = 'CL001';
  END IF;
  UPDATE catalog_item i
     SET category_id = coalesce(p_category, i.category_id),
         label_fr = coalesce(catalog_label(p_label_fr, 'FR'), i.label_fr),
         label_en = coalesce(catalog_label(p_label_en, 'EN'), i.label_en),
         unit_price = coalesce(p_unit_price, i.unit_price),
         vat_rate_bps = coalesce(p_vat_rate_bps, i.vat_rate_bps),
         active = coalesce(p_active, i.active),
         updated_at = now()
   WHERE i.id = p_item AND i.operator_id = v_operator;
  RETURN QUERY SELECT p_item, catalog_bump_version(v_operator, v_pos, p_actor);
END $$;
REVOKE ALL ON FUNCTION update_catalog_item(uuid, uuid, text, text, bigint, int, boolean, uuid)
  FROM PUBLIC;

-- Délégation au commerçant : OPERATOR_ADMIN ou ORGANIZER_ADMIN seulement, jamais le commerçant. Ne
-- crée pas de version (le contenu du catalogue ne change pas).
CREATE FUNCTION set_catalog_policy(p_pos uuid, p_merchant_manages boolean, p_actor uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_operator uuid := nullif(current_setting('app.operator_id', true), '')::uuid;
BEGIN
  PERFORM catalog_lock_pos(v_operator, p_pos, p_actor, false);
  IF p_merchant_manages IS NULL THEN
    RAISE EXCEPTION 'Catalogue : délégation à choisir' USING ERRCODE = 'CL001';
  END IF;
  UPDATE point_of_sale_catalog_policy
     SET merchant_manages = p_merchant_manages, updated_by = p_actor, updated_at = now()
   WHERE pos_id = p_pos AND operator_id = v_operator;
END $$;
REVOKE ALL ON FUNCTION set_catalog_policy(uuid, boolean, uuid) FROM PUBLIC;

-- 4. Version servie à un terminal -----------------------------------------------------------------
-- Appelée par la construction de la configuration (DeviceConfigService.build). Terminal sans point
-- de vente, mode autre que CATALOG_POS, ou point de vente sans version : (pos_id, 0), sans
-- écriture.
CREATE FUNCTION record_device_catalog_served(p_device uuid)
RETURNS TABLE (pos_id uuid, version int)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE
  v_operator uuid := nullif(current_setting('app.operator_id', true), '')::uuid;
  d record;
  v_version int;
BEGIN
  SELECT x.pos_id, x.app_mode, x.status INTO d FROM device x
   WHERE x.id = p_device AND x.operator_id = v_operator FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  IF d.status = 'REVOKED' THEN
    RAISE EXCEPTION 'Terminal révoqué' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF d.pos_id IS NULL OR d.app_mode <> 'CATALOG_POS' THEN
    RETURN QUERY SELECT d.pos_id, 0;
    RETURN;
  END IF;
  SELECT max(v.version) INTO v_version FROM catalog_version v
   WHERE v.pos_id = d.pos_id AND v.operator_id = v_operator;
  IF v_version IS NULL THEN
    RETURN QUERY SELECT d.pos_id, 0;
    RETURN;
  END IF;
  INSERT INTO device_catalog_served (operator_id, device_id, pos_id, version, served_at)
  VALUES (v_operator, p_device, d.pos_id, v_version, now())
  ON CONFLICT (device_id, pos_id, version) DO NOTHING;
  RETURN QUERY SELECT d.pos_id, v_version;
END $$;
REVOKE ALL ON FUNCTION record_device_catalog_served(uuid) FROM PUBLIC;

-- 5. Lignes de vente ------------------------------------------------------------------------------
-- Contrôle seul, sans écriture (arbitrage du 22/10 ; appelé par record_sale_lines et, à la création
-- d'une demande QR, par WP05). Rend la version retenue ; tout refus : CL034.
--   p_lines : tableau JSON de 1 à 200 objets {product_id (uuid), quantity (entier >= 1),
--             unit_price (entier > 0)} (noms du schéma SaleLine ; autres clés ignorées).
--   Σ quantity × unit_price (calcul en numeric, sans dépassement) = p_amount.
--   Versions candidates (A2), dans cet ordre : courante du point de vente du terminal, puis
--   dernière servie à ce terminal pour ce point de vente si elle diffère. Aucune autre. La première
--   où TOUTES les lignes ont leur article au prix reçu est retenue (une seule version par vente).
CREATE FUNCTION check_sale_lines(p_device uuid, p_lines jsonb, p_amount bigint) RETURNS int
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_operator uuid := nullif(current_setting('app.operator_id', true), '')::uuid;
  e jsonb;
  q numeric;
  p numeric;
  v_sum numeric := 0;
  v_pos uuid;
  v_current int;
  v_served int;
  v_candidate int;
BEGIN
  IF v_operator IS NULL THEN
    RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found';
  END IF;
  -- 1. Forme et bornes.
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array'
     OR jsonb_array_length(p_lines) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'Lignes de vente : tableau de 1 à 200 lignes attendu' USING ERRCODE = 'CL034';
  END IF;
  FOR e IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
    IF jsonb_typeof(e) <> 'object'
       OR jsonb_typeof(e->'product_id') IS DISTINCT FROM 'string'
       OR (e->>'product_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       OR jsonb_typeof(e->'quantity') IS DISTINCT FROM 'number'
       OR jsonb_typeof(e->'unit_price') IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION 'Lignes de vente : ligne mal formée' USING ERRCODE = 'CL034';
    END IF;
    q := (e->>'quantity')::numeric;
    p := (e->>'unit_price')::numeric;
    IF q <> trunc(q) OR q < 1 OR q > 2147483647
       OR p <> trunc(p) OR p < 1 OR p > 9223372036854775807 THEN
      RAISE EXCEPTION 'Lignes de vente : quantité ou prix hors bornes' USING ERRCODE = 'CL034';
    END IF;
    v_sum := v_sum + q * p;
  END LOOP;
  IF p_amount IS NULL OR v_sum <> p_amount THEN
    RAISE EXCEPTION 'Lignes de vente : somme différente du montant' USING ERRCODE = 'CL034';
  END IF;
  -- 2. Terminal du prestataire, affecté à un point de vente.
  SELECT d.pos_id INTO v_pos FROM device d WHERE d.id = p_device AND d.operator_id = v_operator;
  IF v_pos IS NULL THEN
    RAISE EXCEPTION 'Lignes de vente : terminal inconnu ou sans point de vente'
      USING ERRCODE = 'CL034';
  END IF;
  -- 3. Versions candidates.
  SELECT max(v.version) INTO v_current FROM catalog_version v
   WHERE v.pos_id = v_pos AND v.operator_id = v_operator;
  IF v_current IS NULL THEN
    RAISE EXCEPTION 'Lignes de vente : point de vente sans catalogue' USING ERRCODE = 'CL034';
  END IF;
  SELECT s.version INTO v_served FROM device_catalog_served s
   WHERE s.device_id = p_device AND s.pos_id = v_pos AND s.operator_id = v_operator
   ORDER BY s.version DESC, s.served_at DESC LIMIT 1;
  FOREACH v_candidate IN ARRAY CASE WHEN v_served IS NULL OR v_served = v_current
                                    THEN ARRAY[v_current] ELSE ARRAY[v_current, v_served] END LOOP
    IF NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_lines) l
       WHERE NOT EXISTS (
         SELECT 1 FROM catalog_version_item vi
          WHERE vi.pos_id = v_pos AND vi.version = v_candidate AND vi.operator_id = v_operator
            AND vi.item_id = (l.value->>'product_id')::uuid
            AND vi.unit_price = (l.value->>'unit_price')::numeric)) THEN
      RETURN v_candidate;
    END IF;
  END LOOP;
  RAISE EXCEPTION
    'Lignes de vente : article ou prix absent de la version courante et de la dernière servie'
    USING ERRCODE = 'CL034';
END $$;
REVOKE ALL ON FUNCTION check_sale_lines(uuid, jsonb, bigint) FROM PUBLIC;

-- Écriture des lignes d'une vente (WP04 : après l'écriture de la vente, avant consume_tap). Rend le
-- nombre de lignes. Tout refus : CL034, rien n'est écrit (l'exception annule la transaction).
-- Montant de la vente (non stocké dans journal_transaction) : − Σ des lignes négatives (crédits) de
-- la vente sur le compte MERCHANT de la participation du point de vente du terminal. Le
-- constructeur PURCHASE (apps/api/src/ledger/builders/festival/purchase.ts) crédite ce compte du
-- montant TTC et le débite à part de la commission : seuls les crédits comptent.
CREATE FUNCTION record_sale_lines(p_tx uuid, p_device uuid, p_lines jsonb) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_operator uuid := nullif(current_setting('app.operator_id', true), '')::uuid;
  v_pos uuid;
  v_participation uuid;
  v_amount numeric;
  v_version int;
  v_count int;
BEGIN
  IF v_operator IS NULL THEN
    RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found';
  END IF;
  IF p_tx IS NULL OR p_device IS NULL THEN
    RAISE EXCEPTION 'Lignes de vente : vente ou terminal manquant' USING ERRCODE = 'CL034';
  END IF;
  -- Deux appels concurrents pour la même vente : le second voit les lignes du premier (CL034).
  PERFORM pg_advisory_xact_lock(hashtextextended('sale-lines:' || p_tx::text, 0));
  -- 1. Vente PURCHASE du prestataire, écrite par ce terminal, sans lignes.
  PERFORM 1 FROM journal_transaction t
   WHERE t.id = p_tx AND t.operator_id = v_operator AND t.type = 'PURCHASE'
     AND t.device_id = p_device;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lignes de vente : vente inconnue, d''un autre type ou d''un autre terminal'
      USING ERRCODE = 'CL034';
  END IF;
  IF EXISTS (SELECT 1 FROM sale_line s WHERE s.transaction_id = p_tx) THEN
    RAISE EXCEPTION 'Lignes de vente : déjà écrites pour cette vente' USING ERRCODE = 'CL034';
  END IF;
  -- 2. Point de vente du terminal et sa participation.
  SELECT d.pos_id, p.participation_id INTO v_pos, v_participation
    FROM device d JOIN point_of_sale p ON p.id = d.pos_id AND p.operator_id = v_operator
   WHERE d.id = p_device AND d.operator_id = v_operator;
  IF v_pos IS NULL THEN
    RAISE EXCEPTION 'Lignes de vente : terminal sans point de vente' USING ERRCODE = 'CL034';
  END IF;
  -- 3. Montant de la vente.
  SELECT -sum(po.amount) INTO v_amount
    FROM posting po JOIN account a ON a.id = po.account_id AND a.operator_id = v_operator
   WHERE po.transaction_id = p_tx AND po.operator_id = v_operator AND po.amount < 0
     AND a.purpose = 'MERCHANT' AND a.participation_id = v_participation;
  IF v_amount IS NULL OR v_amount <= 0 OR v_amount > 9223372036854775807 THEN
    RAISE EXCEPTION 'Lignes de vente : vente sans crédit du commerçant du point de vente'
      USING ERRCODE = 'CL034';
  END IF;
  -- 4. Contrôle (forme, somme, version retenue).
  v_version := check_sale_lines(p_device, p_lines, v_amount::bigint);
  -- 5. Écriture : libellés, prix et taux copiés de la version retenue.
  INSERT INTO sale_line (operator_id, transaction_id, line_no, pos_id, item_id, catalog_version,
                         label_fr, label_en, quantity, unit_price, vat_rate_bps, line_total)
  SELECT v_operator, p_tx, l.n::int, v_pos, vi.item_id, v_version, vi.label_fr, vi.label_en,
         (l.value->>'quantity')::numeric::int, vi.unit_price, vi.vat_rate_bps,
         (l.value->>'quantity')::numeric::int * vi.unit_price
    FROM jsonb_array_elements(p_lines) WITH ORDINALITY l(value, n)
    JOIN catalog_version_item vi
      ON vi.pos_id = v_pos AND vi.version = v_version AND vi.operator_id = v_operator
     AND vi.item_id = (l.value->>'product_id')::uuid
     AND vi.unit_price = (l.value->>'unit_price')::numeric;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> jsonb_array_length(p_lines)
     OR (SELECT sum(s.line_total) FROM sale_line s WHERE s.transaction_id = p_tx) <> v_amount THEN
    RAISE EXCEPTION 'Lignes de vente : écriture incohérente' USING ERRCODE = 'CL034';
  END IF;
  RETURN v_count;
END $$;
REVOKE ALL ON FUNCTION record_sale_lines(uuid, uuid, jsonb) FROM PUBLIC;
