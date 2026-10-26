-- Catalogue versionné et lignes de vente (migration 0032, S18 ; mission
-- terminaux-paiement-en-ligne, lot WP03 ; contracts/catalog.md ; research R-04 révisé par A2, R-11
-- A21) — pgTAP, écrit à la main (pas un fichier généré).
-- Lancer : pg_prove -d <base> tests/tests_catalog.sql (base créée par les migrations, roles.sql et
-- post-roles.sql rejoués).
-- Deux écritures réellement concurrentes ne se simulent pas en pgTAP (une seule session) : la suite
-- prouve que la ligne de politique est verrouillée (FOR UPDATE) par chaque écriture. Les droits de
-- cashless_app ne sont pas testés ici (lot WP07).
\set ON_ERROR_STOP 1
\set QUIET 1
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

-- Identifiants : pg_temp.id('32a001') = '00000000-0000-0000-0000-00000032a001'.
CREATE FUNCTION pg_temp.id(p text) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT ('00000000-0000-0000-0000-' || lpad(p, 12, '0'))::uuid $$;

-- Données (propriétaire) ------------------------------------------------------------------------
-- A (32a001) : organisateur b001, commerçants b101 et b102 ; événement d001 (DRAFT) avec les points
-- de vente f101 (commerçant b101) et f103 (commerçant b102) ; événement d002 CLOSED avec le point
-- de vente f102 (b101), créé DRAFT puis passé CLOSED après les données. B (32a002) : organisateur
-- b011, commerçant b111, événement d011, point f111.
INSERT INTO party (kind, legal_name) SELECT 'PLATFORM', 'Plateforme (test)'
 WHERE NOT EXISTS (SELECT 1 FROM party WHERE kind = 'PLATFORM');
INSERT INTO party (id, kind, legal_name, country_code) VALUES
 (pg_temp.id('32a001'), 'OPERATOR', 'Prestataire A', 'SN'),
 (pg_temp.id('32a002'), 'OPERATOR', 'Prestataire B', 'CI');
INSERT INTO party (id, kind, operator_id, legal_name) VALUES
 (pg_temp.id('32b001'), 'ORGANIZER', pg_temp.id('32a001'), 'Organisateur A'),
 (pg_temp.id('32b011'), 'ORGANIZER', pg_temp.id('32a002'), 'Organisateur B'),
 (pg_temp.id('32b101'), 'MERCHANT', pg_temp.id('32a001'), 'Commerçant A1'),
 (pg_temp.id('32b102'), 'MERCHANT', pg_temp.id('32a001'), 'Commerçant A2'),
 (pg_temp.id('32b111'), 'MERCHANT', pg_temp.id('32a002'), 'Commerçant B');
INSERT INTO jurisdiction_profile (id, country_code, version, valid_from, breakage_destination)
VALUES (pg_temp.id('32c001'), 'SN', 200032, '2026-01-01', 'ORGANIZER');
INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone, jurisdiction_id,
                   funds_holder, status) VALUES
 (pg_temp.id('32d001'), pg_temp.id('32a001'), pg_temp.id('32b001'), 'Événement A', 'XOF',
  'Africa/Dakar', pg_temp.id('32c001'), 'ORGANIZER', 'DRAFT'),
 (pg_temp.id('32d002'), pg_temp.id('32a001'), pg_temp.id('32b001'), 'Événement A clos', 'XOF',
  'Africa/Dakar', pg_temp.id('32c001'), 'ORGANIZER', 'DRAFT'),
 (pg_temp.id('32d011'), pg_temp.id('32a002'), pg_temp.id('32b011'), 'Événement B', 'XOF',
  'Africa/Dakar', pg_temp.id('32c001'), 'ORGANIZER', 'DRAFT');
INSERT INTO merchant_participation (id, operator_id, event_id, merchant_id, link_type,
                                    payout_to) VALUES
 (pg_temp.id('32f001'), pg_temp.id('32a001'), pg_temp.id('32d001'), pg_temp.id('32b101'),
  'INTERNAL', pg_temp.id('32b001')),
 (pg_temp.id('32f002'), pg_temp.id('32a001'), pg_temp.id('32d002'), pg_temp.id('32b101'),
  'INTERNAL', pg_temp.id('32b001')),
 (pg_temp.id('32f003'), pg_temp.id('32a001'), pg_temp.id('32d001'), pg_temp.id('32b102'),
  'INTERNAL', pg_temp.id('32b001')),
 (pg_temp.id('32f011'), pg_temp.id('32a002'), pg_temp.id('32d011'), pg_temp.id('32b111'),
  'INTERNAL', pg_temp.id('32b011'));
INSERT INTO point_of_sale (id, operator_id, participation_id, name) VALUES
 (pg_temp.id('32f101'), pg_temp.id('32a001'), pg_temp.id('32f001'), 'Bar A1'),
 (pg_temp.id('32f102'), pg_temp.id('32a001'), pg_temp.id('32f002'), 'Bar A1 (clos)'),
 (pg_temp.id('32f103'), pg_temp.id('32a001'), pg_temp.id('32f003'), 'Snack A2'),
 (pg_temp.id('32f111'), pg_temp.id('32a002'), pg_temp.id('32f011'), 'Bar B');
-- Personnes : e001 OPERATOR_ADMIN de A ; e002 ORGANIZER_ADMIN de b001 ; e003 MERCHANT_ADMIN de b101
-- (commerçant de f101) ; e004 MERCHANT_ADMIN de b102 ; e005 de A sans rôle ; e011 OPERATOR_ADMIN de
-- B.
INSERT INTO app_user (id, operator_id, issuer, subject, email, display_name)
SELECT pg_temp.id(u), pg_temp.id(o), 'https://idp.test', 's0032' || u, u || '@test',
  'Personne ' || u
  FROM (VALUES ('32e001', '32a001'), ('32e002', '32a001'), ('32e003', '32a001'), ('32e004',
      '32a001'), ('32e005', '32a001'), ('32e011', '32a002')) AS v(u, o);
INSERT INTO role_assignment (user_id, role, scope_type, scope_id, granted_by) VALUES
 (pg_temp.id('32e001'), 'OPERATOR_ADMIN', 'OPERATOR', pg_temp.id('32a001'), NULL),
 (pg_temp.id('32e002'), 'ORGANIZER_ADMIN', 'ORGANIZER', pg_temp.id('32b001'), NULL),
 (pg_temp.id('32e003'), 'MERCHANT_ADMIN', 'MERCHANT', pg_temp.id('32b101'), NULL),
 (pg_temp.id('32e004'), 'MERCHANT_ADMIN', 'MERCHANT', pg_temp.id('32b102'), NULL),
 (pg_temp.id('32e011'), 'OPERATOR_ADMIN', 'OPERATOR', pg_temp.id('32a002'), NULL);
-- Terminaux de A : aa01 et aa02 CATALOG_POS sur f101 ; aa03 KEYPAD_TPE sur f101 ; aa04 sans point
-- de vente ; aa05 révoqué sur f101 ; aa06 CATALOG_POS sur f102 (sans catalogue).
INSERT INTO device (id, operator_id, event_id, pos_id, app_mode, status, serial) VALUES
 (pg_temp.id('32aa01'), pg_temp.id('32a001'), pg_temp.id('32d001'), pg_temp.id('32f101'),
  'CATALOG_POS', 'ACTIVE', 'T0032-1'),
 (pg_temp.id('32aa02'), pg_temp.id('32a001'), pg_temp.id('32d001'), pg_temp.id('32f101'),
  'CATALOG_POS', 'ACTIVE', 'T0032-2'),
 (pg_temp.id('32aa03'), pg_temp.id('32a001'), pg_temp.id('32d001'), pg_temp.id('32f101'),
  'KEYPAD_TPE', 'ACTIVE', 'T0032-3'),
 (pg_temp.id('32aa04'), pg_temp.id('32a001'), pg_temp.id('32d001'), NULL, 'CATALOG_POS',
  'ACTIVE', 'T0032-4'),
 (pg_temp.id('32aa05'), pg_temp.id('32a001'), pg_temp.id('32d001'), pg_temp.id('32f101'),
  'CATALOG_POS', 'REVOKED', 'T0032-5'),
 (pg_temp.id('32aa06'), pg_temp.id('32a001'), pg_temp.id('32d002'), pg_temp.id('32f102'),
  'CATALOG_POS', 'ACTIVE', 'T0032-6');
-- d002 passe CLOSED une fois ses participation, point de vente et terminal écrits
-- (participation_guard refuse une participation sur un événement clos) ; garde de statut suspendue
-- par le propriétaire, comme tests_configuration.sql.
ALTER TABLE event DISABLE TRIGGER event_status_guard;
UPDATE event SET status = 'CLOSED' WHERE id = pg_temp.id('32d002');
ALTER TABLE event ENABLE TRIGGER event_status_guard;
-- Grand livre de A : attente, commerçant de f001 (point f101), commerçant de f003 (point f103),
-- commission de l'organisateur.
INSERT INTO ledger (id, operator_id, scope_type, scope_id, currency, issuer_id,
                    funds_holder_id) VALUES
 (pg_temp.id('32ca01'), pg_temp.id('32a001'), 'EVENT', pg_temp.id('32d001'), 'XOF',
  pg_temp.id('32b001'), pg_temp.id('32b001'));
INSERT INTO account (id, operator_id, ledger_id, code, family, purpose, participation_id,
                     normal_side, allow_negative) VALUES
 (pg_temp.id('32cb01'), pg_temp.id('32a001'), pg_temp.id('32ca01'), 'S-0032', 'SUSPENSE',
  'SUSPENSE', NULL, 'D', true),
 (pg_temp.id('32cb02'), pg_temp.id('32a001'), pg_temp.id('32ca01'), 'L-MER-0032-1', 'CLAIM',
  'MERCHANT', pg_temp.id('32f001'), 'C', true),
 (pg_temp.id('32cb03'), pg_temp.id('32a001'), pg_temp.id('32ca01'), 'L-MER-0032-3', 'CLAIM',
  'MERCHANT', pg_temp.id('32f003'), 'C', true),
 (pg_temp.id('32cb04'), pg_temp.id('32a001'), pg_temp.id('32ca01'), 'R-COM-0032', 'CLAIM',
  'ORG_COM', NULL, 'C', true);

-- Sessions : prestataire A, B, ou aucun.
CREATE FUNCTION pg_temp.a() RETURNS void LANGUAGE sql AS
  $$ SELECT set_config('app.operator_id', pg_temp.id('32a001')::text, true) $$;
CREATE FUNCTION pg_temp.b() RETURNS void LANGUAGE sql AS
  $$ SELECT set_config('app.operator_id', pg_temp.id('32a002')::text, true) $$;
CREATE FUNCTION pg_temp.none() RETURNS void LANGUAGE sql AS
  $$ SELECT set_config('app.operator_id', '', true) $$;
-- Lectures du propriétaire.
CREATE FUNCTION pg_temp.cur(p_pos text) RETURNS int LANGUAGE sql AS
  $$ SELECT coalesce(max(version), 0) FROM catalog_version WHERE pos_id = pg_temp.id(p_pos) $$;
CREATE FUNCTION pg_temp.cat(p_label text) RETURNS uuid LANGUAGE sql AS
  $$ SELECT id FROM catalog_category WHERE label_fr = p_label $$;
CREATE FUNCTION pg_temp.item(p_label text) RETURNS uuid LANGUAGE sql AS
  $$ SELECT id FROM catalog_item WHERE label_fr = p_label $$;
-- Articles d'une version : « libellé:prix », triés.
CREATE FUNCTION pg_temp.content(p_pos text, p_version int) RETURNS text LANGUAGE sql AS $$
  SELECT coalesce(string_agg(label_fr || ':' || unit_price, ',' ORDER BY label_fr), '')
    FROM catalog_version_item WHERE pos_id = pg_temp.id(p_pos) AND version = p_version
$$;
-- Ligne de vente JSON.
CREATE FUNCTION pg_temp.ln(p_item text, p_quantity numeric, p_price numeric) RETURNS jsonb
LANGUAGE sql AS $$
  SELECT jsonb_build_object('product_id', pg_temp.item(p_item), 'quantity', p_quantity,
                            'unit_price', p_price)
$$;
-- Vente écrite par le propriétaire : attente +montant, commerçant −montant (compte p_merchant),
-- commission éventuelle (commerçant +c, commission −c). Rend l'identifiant de la vente.
CREATE FUNCTION pg_temp.sale(p_tx text, p_device text, p_amount bigint,
                             p_merchant text DEFAULT '32cb02',
                             p_type text DEFAULT 'PURCHASE', p_commission bigint DEFAULT 0)
RETURNS uuid LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO journal_transaction (id, operator_id, ledger_id, event_id, type, idempotency_key,
                                   request_hash, occurred_at, source, device_id)
  VALUES (pg_temp.id(p_tx), pg_temp.id('32a001'), pg_temp.id('32ca01'), pg_temp.id('32d001'),
          p_type, 'sale-0032:' || p_tx, 'empreinte 0032', now(), 'ONLINE', pg_temp.id(p_device));
  INSERT INTO posting (operator_id, ledger_id, transaction_id, line_no, account_id, amount) VALUES
   (pg_temp.id('32a001'), pg_temp.id('32ca01'), pg_temp.id(p_tx), 1, pg_temp.id('32cb01'),
    p_amount),
   (pg_temp.id('32a001'), pg_temp.id('32ca01'), pg_temp.id(p_tx), 2, pg_temp.id(p_merchant),
    -p_amount);
  IF p_commission > 0 THEN
    INSERT INTO posting (operator_id, ledger_id, transaction_id, line_no, account_id, amount) VALUES
     (pg_temp.id('32a001'), pg_temp.id('32ca01'), pg_temp.id(p_tx), 3, pg_temp.id(p_merchant),
      p_commission),
     (pg_temp.id('32a001'), pg_temp.id('32ca01'), pg_temp.id(p_tx), 4, pg_temp.id('32cb04'),
      -p_commission);
  END IF;
  RETURN pg_temp.id(p_tx);
END $$;
CREATE FUNCTION pg_temp.lines(p_tx text) RETURNS int LANGUAGE sql AS
  $$ SELECT count(*)::int FROM sale_line WHERE transaction_id = pg_temp.id(p_tx) $$;

-- 1. Structure et droits ------------------------------------------------------------------------
SELECT has_table(t::name)
  FROM unnest(ARRAY['point_of_sale_catalog_policy', 'catalog_category', 'catalog_item',
                    'catalog_version',
                    'catalog_version_item', 'device_catalog_served', 'sale_line']) t;
SELECT is((SELECT count(*)::int FROM pg_proc
            WHERE proname IN ('catalog_admin_allowed', 'catalog_lock_pos', 'catalog_bump_version',
                              'catalog_label', 'create_catalog_category', 'update_catalog_category',
                              'create_catalog_item', 'update_catalog_item', 'set_catalog_policy',
                              'record_device_catalog_served', 'check_sale_lines',
                              'record_sale_lines')
              AND prosecdef AND proconfig @> ARRAY['search_path=public, pg_temp']), 12,
  'douze fonctions SECURITY DEFINER, search_path public, pg_temp');
DROP ROLE IF EXISTS catalog_probe;
CREATE ROLE catalog_probe;
SELECT is((SELECT count(*)::int
             FROM unnest(ARRAY['catalog_admin_allowed(uuid,uuid,uuid)',
                               'catalog_lock_pos(uuid,uuid,uuid,boolean)',
                               'catalog_bump_version(uuid,uuid,uuid)',
                               'catalog_label(text,text)',
                               'create_catalog_category(uuid,text,text,integer,uuid)',
                               'update_catalog_category(uuid,text,text,integer,boolean,uuid)',
                               'create_catalog_item(uuid,text,text,bigint,integer,uuid)',
                               'update_catalog_item(uuid,uuid,text,text,bigint,integer,'
                                 || 'boolean,uuid)',
                               'set_catalog_policy(uuid,boolean,uuid)',
                               'record_device_catalog_served(uuid)',
                               'check_sale_lines(uuid,jsonb,bigint)',
                               'record_sale_lines(uuid,uuid,jsonb)']) f
            WHERE has_function_privilege('catalog_probe', f, 'EXECUTE')), 0,
  'aucune des douze fonctions n''est exécutable par PUBLIC');
SELECT is((SELECT count(*)::int FROM pg_class
            WHERE relname IN ('point_of_sale_catalog_policy', 'catalog_category', 'catalog_item',
                              'catalog_version', 'catalog_version_item', 'device_catalog_served',
                              'sale_line')
              AND relkind = 'r' AND relrowsecurity AND relforcerowsecurity), 7,
  'RLS activée et forcée sur les sept tables');
SELECT is((SELECT count(*)::int FROM pg_policies
            WHERE tablename IN ('point_of_sale_catalog_policy', 'catalog_category', 'catalog_item',
                                'catalog_version', 'catalog_version_item', 'device_catalog_served',
                                'sale_line')
              AND policyname = 'tenant_isolation' AND qual LIKE '%app.operator_id%'
              AND with_check LIKE '%app.operator_id%'), 7,
  'politique tenant_isolation (USING et WITH CHECK) sur les sept tables');
SELECT is((SELECT count(*)::int FROM pg_trigger tg JOIN pg_proc p ON p.oid = tg.tgfoid
            WHERE p.proname = 'forbid_mutation' AND NOT tg.tgisinternal
              AND tg.tgrelid IN ('catalog_version'::regclass, 'catalog_version_item'::regclass,
                                 'device_catalog_served'::regclass, 'sale_line'::regclass)
              AND (tg.tgtype & 8) <> 0 AND (tg.tgtype & 16) <> 0), 4,
  'forbid_mutation (UPDATE et DELETE) sur versions, contenu des versions, versions servies, '
  || 'lignes');
SELECT col_is_pk('catalog_version', ARRAY['pos_id', 'version'],
                 'catalog_version : clé (pos_id, version)');
SELECT col_is_pk('sale_line', ARRAY['transaction_id', 'line_no'],
                 'sale_line : clé (transaction_id, line_no)');
SELECT is((SELECT count(*)::int FROM pg_proc p
            WHERE p.proname IN ('create_catalog_category', 'update_catalog_category',
                                'create_catalog_item',
                                'update_catalog_item', 'set_catalog_policy',
                                'record_device_catalog_served',
                                'check_sale_lines', 'record_sale_lines', 'catalog_lock_pos')
              AND p.prosrc ~* '\mGRANT\M'), 0,
  'aucun GRANT dans les fonctions (droits posés par post-roles.sql, lot WP07)');

-- 2. Écritures du catalogue et versions ---------------------------------------------------------
SELECT pg_temp.a();
SELECT is((SELECT count(*)::int FROM pg_locks
            WHERE pid = pg_backend_pid() AND relation = 'point_of_sale_catalog_policy'::regclass
              AND mode = 'RowShareLock'), 0,
  'verrou : aucun verrou de ligne sur la politique avant la première écriture');
SELECT is((SELECT version FROM create_catalog_category(pg_temp.id('32f101'), '  Boissons ',
                                                       'Drinks', 1, pg_temp.id('32e002'))), 1,
  'ORGANIZER_ADMIN : catégorie créée, version 1');
SELECT is((SELECT count(*)::int FROM pg_locks
            WHERE pid = pg_backend_pid() AND relation = 'point_of_sale_catalog_policy'::regclass
              AND mode = 'RowShareLock'), 1,
  'verrou : la politique est lue FOR UPDATE par l''écriture (RowShareLock)');
SELECT ok((SELECT xmax::text <> '0' FROM point_of_sale_catalog_policy
            WHERE pos_id = pg_temp.id('32f101')),
  'verrou : la ligne de politique du point de vente porte le verrou de la transaction (xmax)');
SELECT is((SELECT merchant_manages::text || ':' || (updated_by = pg_temp.id('32e002'))::text
             FROM point_of_sale_catalog_policy WHERE pos_id = pg_temp.id('32f101')), 'false:true',
  'politique créée à la première écriture : délégation inactive');
SELECT is(pg_temp.cat('Boissons') IS NOT NULL, true, 'libellé rogné à l''écriture');
SELECT is(pg_temp.content('32f101', 1), '', 'version 1 : aucun article');
SELECT is((SELECT version FROM create_catalog_item(pg_temp.cat('Boissons'), 'Bière', 'Beer', 1000,
                                                   1800, pg_temp.id('32e001'))), 2,
  'OPERATOR_ADMIN : article créé, version 2');
SELECT is((SELECT version FROM create_catalog_item(pg_temp.cat('Boissons'), 'Eau', 'Water', 500, 0,
                                                   pg_temp.id('32e001'))), 3,
  'article créé, version 3');
SELECT is(pg_temp.content('32f101', 3), 'Bière:1000,Eau:500', 'version 3 : articles actifs');
SELECT is((SELECT category_label_fr || '/' || category_label_en || '/' || category_position || '/'
                  || vat_rate_bps
             FROM catalog_version_item WHERE pos_id = pg_temp.id('32f101') AND version = 3
              AND item_id = pg_temp.item('Bière')), 'Boissons/Drinks/1/1800',
  'version : libellés et rang de la catégorie, taux copiés');
SELECT is((SELECT created_by FROM catalog_version
            WHERE pos_id = pg_temp.id('32f101') AND version = 3),
  pg_temp.id('32e001'), 'version : auteur nommé');

-- Bornes (CL001), aucune version créée.
SELECT throws_ok(format('SELECT * FROM create_catalog_item(%L, ''Vin'', ''Wine'', 0, 0, %L)',
                        pg_temp.cat('Boissons'), pg_temp.id('32e001')), 'CL001', NULL,
                        'prix 0 refusé');
SELECT throws_ok(format('SELECT * FROM create_catalog_item(%L, ''Vin'', ''Wine'', -5, 0, %L)',
                        pg_temp.cat('Boissons'), pg_temp.id('32e001')), 'CL001', NULL,
                        'prix négatif refusé');
SELECT throws_ok(format('SELECT * FROM create_catalog_item(%L, ''Vin'', ''Wine'', 900, 10001, %L)',
                        pg_temp.cat('Boissons'), pg_temp.id('32e001')), 'CL001', NULL,
                        'taux 10 001 refusé');
SELECT throws_ok(format('SELECT * FROM create_catalog_item(%L, ''Vin'', ''Wine'', 900, -1, %L)',
                        pg_temp.cat('Boissons'), pg_temp.id('32e001')), 'CL001', NULL,
                        'taux négatif refusé');
SELECT throws_ok(format('SELECT * FROM create_catalog_item(%L, ''   '', ''Wine'', 900, 0, %L)',
                        pg_temp.cat('Boissons'), pg_temp.id('32e001')), 'CL001', NULL,
  'libellé FR vide (espaces) refusé');
SELECT throws_ok(format('SELECT * FROM create_catalog_item(%L, ''Vin'', %L, 900, 0, %L)',
                        pg_temp.cat('Boissons'), repeat('x', 121), pg_temp.id('32e001')), 'CL001',
                        NULL, 'libellé EN de 121 caractères refusé');
SELECT throws_ok(format('SELECT * FROM create_catalog_category(%L, %L, ''X'', 0, %L)',
                        pg_temp.id('32f101'), repeat('x', 121), pg_temp.id('32e001')), 'CL001',
                        NULL, 'libellé de catégorie de 121 caractères refusé');
SELECT throws_ok(format('SELECT * FROM create_catalog_category(%L, ''Plats'', ''Food'', -1, %L)',
                        pg_temp.id('32f101'), pg_temp.id('32e001')), 'CL001', NULL,
                        'rang négatif refusé');
SELECT throws_ok(format('SELECT * FROM update_catalog_item(%L, NULL, NULL, NULL, 0, NULL, NULL, '
                        || '%L)',
                        pg_temp.item('Eau'), pg_temp.id('32e001')), 'CL001', NULL,
  'modification : prix 0 refusé');
SELECT throws_ok(format('SELECT * FROM update_catalog_item(%L, NULL, NULL, '''', NULL, NULL, '
                        || 'NULL, %L)',
                        pg_temp.item('Eau'), pg_temp.id('32e001')), 'CL001', NULL,
  'modification : libellé vide refusé');
SELECT is((SELECT version FROM create_catalog_item(pg_temp.cat('Boissons'), repeat('é', 120),
                                                   'Long', 1, 0, pg_temp.id('32e001'))), 4,
  'libellé de 120 caractères accepté (version 4)');
SELECT is((SELECT version FROM update_catalog_item(pg_temp.item(repeat('é', 120)), NULL, NULL, NULL,
                                                   NULL, NULL, false, pg_temp.id('32e001'))), 5,
  'désactivation (version 5)');
SELECT is(pg_temp.content('32f101', 5), 'Bière:1000,Eau:500',
          'article désactivé absent de la version 5');
SELECT is(pg_temp.cur('32f101'), 5, 'refus de bornes : aucune version créée');

-- Désactivation, renommage, catégorie inactive, changement de catégorie.
SELECT is((SELECT version FROM update_catalog_item(pg_temp.item('Eau'), NULL, NULL, NULL, NULL,
                                                   NULL, false, pg_temp.id('32e002'))), 6,
  'Eau désactivée (version 6)');
SELECT is(pg_temp.content('32f101', 6), 'Bière:1000',
          'article désactivé absent de la version suivante');
SELECT is(pg_temp.content('32f101', 5), 'Bière:1000,Eau:500', 'version précédente inchangée');
SELECT is((SELECT version FROM update_catalog_category(pg_temp.cat('Boissons'), 'Bar', 'Bar drinks',
                                                       NULL, NULL, pg_temp.id('32e001'))), 7,
  'catégorie renommée (version 7)');
SELECT is((SELECT string_agg(DISTINCT category_label_fr, ',') FROM catalog_version_item
            WHERE pos_id = pg_temp.id('32f101') AND version = 6), 'Boissons',
  'renommage : la version 6 garde l''ancien libellé de catégorie (copie)');
SELECT is((SELECT string_agg(DISTINCT category_label_fr, ',') FROM catalog_version_item
            WHERE pos_id = pg_temp.id('32f101') AND version = 7), 'Bar',
  'renommage : la version 7 porte le nouveau libellé');
SELECT is((SELECT version FROM create_catalog_category(pg_temp.id('32f101'), 'Snacks', 'Snacks', 2,
                                                       pg_temp.id('32e001'))), 8,
  'catégorie Snacks (8)');
SELECT is((SELECT version FROM create_catalog_item(pg_temp.cat('Snacks'), 'Chips', 'Crisps', 300,
                                                   1000, pg_temp.id('32e001'))), 9,
  'article Chips (9)');
SELECT is(pg_temp.content('32f101', 9), 'Bière:1000,Chips:300',
          'version 9 : deux catégories actives');
SELECT is((SELECT version FROM update_catalog_category(pg_temp.cat('Snacks'), NULL, NULL, NULL,
                                                       false, pg_temp.id('32e001'))), 10,
  'catégorie Snacks désactivée (10)');
SELECT is(pg_temp.content('32f101', 10), 'Bière:1000',
  'article actif d''une catégorie inactive exclu de la version');
SELECT is((SELECT version FROM update_catalog_item(pg_temp.item('Chips'), pg_temp.cat('Bar'), NULL,
                                                   NULL, NULL, NULL, NULL,
                                                   pg_temp.id('32e001'))), 11,
  'article déplacé dans une catégorie du même point de vente (11)');
SELECT is(pg_temp.content('32f101', 11), 'Bière:1000,Chips:300',
          'version 11 : Chips de nouveau servi');
-- Catalogue de f103 (autre commerçant, même événement) : catégorie et article « Burger ».
SELECT is((SELECT version FROM create_catalog_category(pg_temp.id('32f103'), 'Plats', 'Food', 0,
                                                       pg_temp.id('32e001'))), 1,
  'f103 : version 1');
SELECT is((SELECT version FROM create_catalog_item(pg_temp.cat('Plats'), 'Burger', 'Burger', 2500,
                                                   1000, pg_temp.id('32e001'))), 2,
  'f103 : version 2');
SELECT throws_ok(format('SELECT * FROM update_catalog_item(%L, %L, NULL, NULL, NULL, NULL, NULL, '
                        || '%L)',
                        pg_temp.item('Chips'), pg_temp.cat('Plats'), pg_temp.id('32e001')), 'CL001',
                        NULL, 'changement de catégorie vers un autre point de vente refusé');
SELECT throws_ok(format('INSERT INTO catalog_item (operator_id, pos_id, category_id, label_fr,
                           label_en, unit_price, vat_rate_bps)
                           VALUES (%L, %L, %L, ''X'', ''X'', 1, 0)',
                        pg_temp.id('32a001'), pg_temp.id('32f101'), pg_temp.cat('Plats')),
  '23503', NULL,
  'table : article dans une catégorie d''un autre point de vente refusé (clé composite)');

-- Ajout seul et pas de suppression.
SELECT throws_like('UPDATE catalog_version SET created_at = now()', '%ajout seul%',
  'catalog_version : UPDATE refusé');
SELECT throws_like('DELETE FROM catalog_version_item', '%ajout seul%',
                   'catalog_version_item : DELETE refusé');
SELECT throws_like('UPDATE catalog_version_item SET unit_price = 1', '%ajout seul%',
  'catalog_version_item : UPDATE refusé');
SELECT throws_like('DELETE FROM catalog_item', '%ajout seul%', 'catalog_item : DELETE refusé');
SELECT throws_like('DELETE FROM catalog_category', '%ajout seul%',
                   'catalog_category : DELETE refusé');
SELECT throws_like('DELETE FROM point_of_sale_catalog_policy', '%ajout seul%',
  'point_of_sale_catalog_policy : DELETE refusé');

-- 3. Auteur, délégation, prestataire, événement clos --------------------------------------------
SELECT throws_ok(format('SELECT * FROM create_catalog_category(%L, ''M'', ''M'', 0, %L)',
                        pg_temp.id('32f101'), pg_temp.id('32e003')), 'P0002', NULL,
  'MERCHANT_ADMIN sans délégation : refusé');
SELECT throws_ok(format('SELECT set_catalog_policy(%L, true, %L)', pg_temp.id('32f101'),
                        pg_temp.id('32e003')),
  'P0002', NULL, 'set_catalog_policy refusée au commerçant');
SELECT throws_ok(format('SELECT * FROM create_catalog_category(%L, ''M'', ''M'', 0, %L)',
                        pg_temp.id('32f101'), pg_temp.id('32e005')), 'P0002', NULL,
  'personne sans rôle : refusée');
SELECT lives_ok(format('SELECT set_catalog_policy(%L, true, %L)', pg_temp.id('32f101'),
                       pg_temp.id('32e002')), 'ORGANIZER_ADMIN : délégation activée');
SELECT is(pg_temp.cur('32f101'), 11, 'set_catalog_policy ne crée pas de version');
SELECT is((SELECT version FROM create_catalog_category(pg_temp.id('32f101'), 'Marchand', 'Merchant',
                                                       3, pg_temp.id('32e003'))), 12,
  'MERCHANT_ADMIN du commerçant avec délégation : accepté (12)');
SELECT throws_ok(format('SELECT * FROM create_catalog_category(%L, ''M'', ''M'', 0, %L)',
                        pg_temp.id('32f101'), pg_temp.id('32e004')), 'P0002', NULL,
  'MERCHANT_ADMIN d''un autre commerçant : refusé même avec délégation');
SELECT throws_ok(format('SELECT * FROM create_catalog_category(%L, ''M'', ''M'', 0, %L)',
                        pg_temp.id('32f103'), pg_temp.id('32e003')), 'P0002', NULL,
  'délégation par point de vente : MERCHANT_ADMIN refusé sur f103');
SELECT throws_ok(format('SELECT set_catalog_policy(%L, false, %L)', pg_temp.id('32f101'),
                        pg_temp.id('32e003')),
  'P0002', NULL, 'set_catalog_policy refusée au commerçant même délégué');
SELECT lives_ok(format('SELECT set_catalog_policy(%L, false, %L)', pg_temp.id('32f101'),
                       pg_temp.id('32e001')), 'OPERATOR_ADMIN : délégation retirée');
SELECT throws_ok(format('SELECT * FROM update_catalog_category(%L, ''M2'', NULL, NULL, NULL, %L)',
                        pg_temp.cat('Marchand'), pg_temp.id('32e003')), 'P0002', NULL,
  'MERCHANT_ADMIN refusé de nouveau après retrait de la délégation');
SELECT throws_ok(format('SELECT set_catalog_policy(%L, NULL, %L)', pg_temp.id('32f101'),
                        pg_temp.id('32e001')),
  'CL001', NULL, 'set_catalog_policy : délégation NULL refusée');
-- Retrait de l'attribution : délégation active mais rôle retiré, refusé.
SELECT lives_ok(format('SELECT set_catalog_policy(%L, true, %L)', pg_temp.id('32f101'),
                       pg_temp.id('32e001')), 'délégation réactivée');
UPDATE role_assignment SET revoked_at = now(), revoked_by = pg_temp.id('32e001')
 WHERE user_id = pg_temp.id('32e003');
SELECT throws_ok(format('SELECT * FROM create_catalog_category(%L, ''M'', ''M'', 0, %L)',
                        pg_temp.id('32f101'), pg_temp.id('32e003')), 'P0002', NULL,
  'MERCHANT_ADMIN dont l''attribution est retirée : refusé (la base relit le rôle)');
SELECT lives_ok(format('SELECT set_catalog_policy(%L, false, %L)', pg_temp.id('32f101'),
                       pg_temp.id('32e001')), 'délégation retirée');
-- Événement CLOSED.
SELECT throws_ok(format('SELECT * FROM create_catalog_category(%L, ''C'', ''C'', 0, %L)',
                        pg_temp.id('32f102'), pg_temp.id('32e001')), 'CL029', NULL,
  'événement CLOSED : écriture du catalogue refusée (CL029)');
SELECT throws_ok(format('SELECT set_catalog_policy(%L, true, %L)', pg_temp.id('32f102'),
                        pg_temp.id('32e001')),
  'CL029', NULL, 'événement CLOSED : set_catalog_policy refusée');
SELECT is(pg_temp.cur('32f102'), 0, 'événement CLOSED : aucune version');
-- Autre prestataire, session sans prestataire, objets inconnus.
SELECT throws_ok(format('SELECT * FROM create_catalog_category(%L, ''X'', ''X'', 0, %L)',
                        pg_temp.id('32f111'), pg_temp.id('32e001')), 'P0002', NULL,
  'point de vente d''un autre prestataire : P0002');
SELECT pg_temp.b();
SELECT throws_ok(format('SELECT * FROM create_catalog_category(%L, ''X'', ''X'', 0, %L)',
                        pg_temp.id('32f101'), pg_temp.id('32e011')), 'P0002', NULL,
  'session B, point de vente de A : P0002');
SELECT throws_ok(format('SELECT * FROM update_catalog_item(%L, NULL, NULL, NULL, 1, NULL, NULL, '
                        || '%L)',
                        pg_temp.item('Bière'), pg_temp.id('32e011')), 'P0002', NULL,
  'session B, article de A : P0002');
SELECT throws_ok(format('SELECT * FROM create_catalog_item(%L, ''X'', ''X'', 1, 0, %L)',
                        pg_temp.cat('Bar'), pg_temp.id('32e011')), 'P0002', NULL,
  'session B, catégorie de A : P0002');
SELECT pg_temp.none();
SELECT throws_ok(format('SELECT * FROM create_catalog_category(%L, ''X'', ''X'', 0, %L)',
                        pg_temp.id('32f101'), pg_temp.id('32e001')), 'P0002', NULL,
  'session sans prestataire : P0002');
SELECT pg_temp.a();
SELECT throws_ok(format('SELECT * FROM create_catalog_category(%L, ''X'', ''X'', 0, %L)',
                        pg_temp.id('32f101'), pg_temp.id('32e011')), 'P0002', NULL,
  'auteur d''un autre prestataire : P0002');
SELECT throws_ok(format('SELECT * FROM create_catalog_category(%L, ''X'', ''X'', 0, NULL)',
                        pg_temp.id('32f101')), 'P0002', NULL, 'auteur absent : P0002');
SELECT is(pg_temp.cur('32f101'), 12, 'refus : aucune version créée');

-- 4. Versions servies ---------------------------------------------------------------------------
SELECT is((SELECT coalesce(pos_id::text, 'null') || ':' || version
             FROM record_device_catalog_served(pg_temp.id('32aa04'))),
  'null:0', 'terminal sans point de vente : version 0');
SELECT is((SELECT version FROM record_device_catalog_served(pg_temp.id('32aa03'))), 0,
  'terminal KEYPAD_TPE : version 0');
SELECT is((SELECT version FROM record_device_catalog_served(pg_temp.id('32aa06'))), 0,
  'point de vente sans catalogue : version 0');
SELECT is((SELECT count(*)::int FROM device_catalog_served), 0, 'version 0 : aucune écriture');
SELECT is((SELECT pos_id::text || ':' || version
             FROM record_device_catalog_served(pg_temp.id('32aa02'))),
  pg_temp.id('32f101')::text || ':12', 'terminal CATALOG_POS : dernière version servie');
SELECT is((SELECT version FROM record_device_catalog_served(pg_temp.id('32aa02'))), 12,
          'second appel');
SELECT is((SELECT count(*)::int FROM device_catalog_served WHERE device_id = pg_temp.id('32aa02')),
          1, 'version servie écrite une seule fois');
SELECT throws_ok(format('SELECT * FROM record_device_catalog_served(%L)', pg_temp.id('32aa05')),
                 '42501', NULL, 'terminal révoqué : 42501');
SELECT throws_ok(format('SELECT * FROM record_device_catalog_served(%L)', pg_temp.id('32aa99')),
                 'P0002', NULL, 'terminal inconnu : P0002');
SELECT pg_temp.b();
SELECT throws_ok(format('SELECT * FROM record_device_catalog_served(%L)', pg_temp.id('32aa02')),
                 'P0002', NULL, 'terminal d''un autre prestataire : P0002');
SELECT pg_temp.a();
SELECT throws_like('UPDATE device_catalog_served SET version = version', '%ajout seul%',
  'device_catalog_served : UPDATE refusé');

-- 5. Lignes de vente : test de borne A2 ---------------------------------------------------------
-- Ajout d'un soda (présent dans toutes les versions suivantes). Puis, pour aa01 : version V1 servie
-- (Bière 1000), version V2 servie (Bière 1100), version V3 courante (Bière 1200), jamais servie.
SELECT is((SELECT version FROM create_catalog_item(pg_temp.cat('Bar'), 'Soda', 'Soda', 700, 1000,
                                                   pg_temp.id('32e001'))), 13, 'Soda (13)');
SELECT is((SELECT version FROM record_device_catalog_served(pg_temp.id('32aa01'))), 13,
          'V1 = 13 servie à aa01');
SELECT is((SELECT version FROM update_catalog_item(pg_temp.item('Bière'), NULL, NULL, NULL, 1100,
                                                   NULL, NULL, pg_temp.id('32e001'))), 14,
  'Bière à 1100 (14)');
SELECT is((SELECT version FROM record_device_catalog_served(pg_temp.id('32aa01'))), 14,
          'V2 = 14 servie à aa01');
SELECT is((SELECT version FROM update_catalog_item(pg_temp.item('Bière'), NULL, NULL, NULL, 1200,
                                                   550, NULL, pg_temp.id('32e001'))), 15,
  'Bière à 1200, taux 550 (15)');

SELECT pg_temp.sale('32dd01', '32aa01', 1000);
SELECT throws_ok(format('SELECT record_sale_lines(%L, %L, %L)', pg_temp.id('32dd01'),
                        pg_temp.id('32aa01'),
                        jsonb_build_array(pg_temp.ln('Bière', 1, 1000))), 'CL034', NULL,
  'A2 : ligne au prix de la version 1 (servie puis remplacée) refusée');
SELECT pg_temp.sale('32dd02', '32aa01', 2300);
SELECT throws_ok(format('SELECT record_sale_lines(%L, %L, %L)', pg_temp.id('32dd02'),
                        pg_temp.id('32aa01'),
                        jsonb_build_array(pg_temp.ln('Bière', 1, 1100),
                                          pg_temp.ln('Bière', 1, 1200))),
  'CL034', NULL, 'A2 : vente mêlant les prix des versions 2 et 3 refusée');
SELECT pg_temp.sale('32dd03', '32aa01', 2900);
SELECT is(record_sale_lines(pg_temp.id('32dd03'), pg_temp.id('32aa01'),
                            jsonb_build_array(pg_temp.ln('Bière', 2, 1100),
                                              pg_temp.ln('Soda', 1, 700))), 2,
  'A2 : prix de la version 2 seule (dernière servie) acceptés');
SELECT is((SELECT string_agg(line_no || ':' || label_fr || ':' || quantity || 'x' || unit_price
                             || '=' || line_total || ':v' || catalog_version || ':t'
                             || vat_rate_bps, ','
                             ORDER BY line_no)
             FROM sale_line WHERE transaction_id = pg_temp.id('32dd03')),
  '1:Bière:2x1100=2200:v14:t1800,2:Soda:1x700=700:v14:t1000',
  'lignes : rang, libellés, prix et taux copiés de la version retenue (14)');
SELECT pg_temp.sale('32dd04', '32aa01', 1200, p_commission => 60);
SELECT is(record_sale_lines(pg_temp.id('32dd04'), pg_temp.id('32aa01'),
                            jsonb_build_array(pg_temp.ln('Bière', 1, 1200))), 1,
  'A2 : prix de la version 3 seule (courante, jamais servie) acceptés ; commission ignorée '
  || 'du montant');
SELECT is((SELECT catalog_version || ':' || vat_rate_bps FROM sale_line
            WHERE transaction_id = pg_temp.id('32dd04')),
  '15:550', 'version courante retenue en premier, taux de la version 15');
-- Montant de la vente : les seuls crédits du commerçant (le débit de commission n'est pas déduit).
SELECT pg_temp.sale('32dd05', '32aa01', 1300, p_commission => 60);
SELECT throws_ok(format('SELECT record_sale_lines(%L, %L, %L)', pg_temp.id('32dd05'),
                        pg_temp.id('32aa01'),
                        jsonb_build_array(pg_temp.ln('Soda', 1, 700), pg_temp.ln('Chips', 1, 600))),
  'CL034', NULL, 'Chips à un prix jamais publié : refusé');
SELECT is(pg_temp.lines('32dd05'), 0, 'tout ou rien : après un refus, aucune ligne');
SELECT is(record_sale_lines(pg_temp.id('32dd05'), pg_temp.id('32aa01'),
                            jsonb_build_array(pg_temp.ln('Soda', 1, 700),
                                              pg_temp.ln('Chips', 1, 300),
                                              pg_temp.ln('Chips', 1, 300))), 3,
  'même vente acceptée ensuite (article répété permis), montant = crédit brut 1300, non le '
  || 'net 1240');
-- Second appel sur une vente déjà détaillée (32dd04).
SELECT throws_ok(format('SELECT record_sale_lines(%L, %L, %L)', pg_temp.id('32dd04'),
                        pg_temp.id('32aa01'),
                        jsonb_build_array(pg_temp.ln('Bière', 1, 1200))), 'CL034', NULL,
  'lignes déjà écrites pour la vente : refus');
-- Autre terminal : aa02 a reçu la version 12 seulement ; la 14 ne lui a jamais été servie.
SELECT pg_temp.sale('32dd06', '32aa02', 1100);
SELECT throws_ok(format('SELECT record_sale_lines(%L, %L, %L)', pg_temp.id('32dd06'),
                        pg_temp.id('32aa02'),
                        jsonb_build_array(pg_temp.ln('Bière', 1, 1100))), 'CL034', NULL,
  'version servie à un autre terminal non admise');
SELECT throws_ok(format('SELECT record_sale_lines(%L, %L, %L)', pg_temp.id('32dd06'),
                        pg_temp.id('32aa01'),
                        jsonb_build_array(pg_temp.ln('Bière', 1, 1100))), 'CL034', NULL,
  'vente écrite par un autre terminal : refus');
-- Somme fausse, article inconnu, article d'un autre point de vente, vente non PURCHASE.
SELECT pg_temp.sale('32dd07', '32aa01', 1300);
SELECT throws_ok(format('SELECT record_sale_lines(%L, %L, %L)', pg_temp.id('32dd07'),
                        pg_temp.id('32aa01'),
                        jsonb_build_array(pg_temp.ln('Bière', 1, 1200))), 'CL034', NULL,
                        'somme fausse : refus');
SELECT pg_temp.sale('32dd08', '32aa01', 1200);
SELECT throws_ok(format('SELECT record_sale_lines(%L, %L, %L)', pg_temp.id('32dd08'),
                        pg_temp.id('32aa01'),
                        jsonb_build_array(jsonb_build_object('product_id', pg_temp.id('32ff99'),
                                                             'quantity', 1, 'unit_price', 1200))),
  'CL034', NULL, 'article inconnu : refus');
SELECT pg_temp.sale('32dd09', '32aa01', 2500);
SELECT throws_ok(format('SELECT record_sale_lines(%L, %L, %L)', pg_temp.id('32dd09'),
                        pg_temp.id('32aa01'),
                        jsonb_build_array(pg_temp.ln('Burger', 1, 2500))), 'CL034', NULL,
  'article d''un autre point de vente : refus');
SELECT pg_temp.sale('32dd10', '32aa01', 1200, p_type => 'TOPUP');
SELECT throws_ok(format('SELECT record_sale_lines(%L, %L, %L)', pg_temp.id('32dd10'),
                        pg_temp.id('32aa01'),
                        jsonb_build_array(pg_temp.ln('Bière', 1, 1200))), 'CL034', NULL,
  'vente non PURCHASE : refus');
-- Vente créditant le commerçant d'un autre point de vente (f103) : montant introuvable.
SELECT pg_temp.sale('32dd11', '32aa01', 1200, p_merchant => '32cb03');
SELECT throws_ok(format('SELECT record_sale_lines(%L, %L, %L)', pg_temp.id('32dd11'),
                        pg_temp.id('32aa01'),
                        jsonb_build_array(pg_temp.ln('Bière', 1, 1200))), 'CL034', NULL,
  'vente sans crédit du commerçant du point de vente du terminal : refus');
-- Article désactivé (Eau) : absent des versions courante et servie.
SELECT pg_temp.sale('32dd12', '32aa01', 500);
SELECT throws_ok(format('SELECT record_sale_lines(%L, %L, %L)', pg_temp.id('32dd12'),
                        pg_temp.id('32aa01'),
                        jsonb_build_array(pg_temp.ln('Eau', 1, 500))), 'CL034', NULL,
  'article inactif : refus');
-- Formes invalides et dépassements (jamais une erreur 500).
SELECT pg_temp.sale('32dd13', '32aa01', 1200);
SELECT throws_ok(format('SELECT record_sale_lines(%L, %L, %L)', pg_temp.id('32dd13'),
                        pg_temp.id('32aa01'), j), 'CL034', NULL, 'forme invalide refusée : ' || d)
  FROM (VALUES
    ('{}'::jsonb, 'objet au lieu d''un tableau'),
    ('[]'::jsonb, 'tableau vide'),
    (jsonb_build_array(pg_temp.ln('Bière', 0, 1200)), 'quantité 0'),
    (jsonb_build_array(pg_temp.ln('Bière', 1.5, 800)), 'quantité non entière'),
    (jsonb_build_array(pg_temp.ln('Bière', 1, 0)), 'prix 0'),
    (jsonb_build_array(jsonb_build_object('quantity', 1, 'unit_price', 1200)), 'product_id absent'),
    (jsonb_build_array(jsonb_build_object('product_id', 'x', 'quantity', 1, 'unit_price', 1200)),
     'product_id non uuid'),
    (jsonb_build_array(jsonb_build_object('product_id', pg_temp.item('Bière'), 'quantity', '1',
                                          'unit_price', 1200)), 'quantité en texte'),
    (jsonb_build_array(pg_temp.ln('Bière', 1e30, 1200)), 'quantité énorme (dépassement)'),
    (jsonb_build_array(pg_temp.ln('Bière', 3000000000, 1200)), 'quantité au-delà d''un int'),
    (jsonb_build_array(pg_temp.ln('Bière', 2147483647, 9223372036854775807)),
     'produit au-delà d''un bigint'),
    (jsonb_build_array(pg_temp.ln('Bière', 1, 1e25)), 'prix au-delà d''un bigint'),
    ((SELECT jsonb_agg(pg_temp.ln('Soda', 1, 6)) FROM generate_series(1, 201)), '201 lignes')
  ) AS v(j, d);
SELECT is(pg_temp.lines('32dd13'), 0, 'formes invalides : aucune ligne');
-- 200 lignes acceptées (Soda à 700 : 200 × 700 = 140 000).
SELECT pg_temp.sale('32dd15', '32aa01', 140000);
SELECT is(record_sale_lines(pg_temp.id('32dd15'), pg_temp.id('32aa01'),
                            (SELECT jsonb_agg(pg_temp.ln('Soda', 1, 700))
                               FROM generate_series(1, 200))), 200,
  'borne : 200 lignes acceptées');
-- Session sans prestataire, autre prestataire.
SELECT pg_temp.sale('32dd16', '32aa01', 1200);
SELECT pg_temp.none();
SELECT throws_ok(format('SELECT record_sale_lines(%L, %L, %L)', pg_temp.id('32dd16'),
                        pg_temp.id('32aa01'),
                        jsonb_build_array(pg_temp.ln('Bière', 1, 1200))), 'P0002', NULL,
  'session sans prestataire : P0002');
SELECT pg_temp.b();
SELECT throws_ok(format('SELECT record_sale_lines(%L, %L, %L)', pg_temp.id('32dd16'),
                        pg_temp.id('32aa01'),
                        jsonb_build_array(pg_temp.ln('Bière', 1, 1200))), 'CL034', NULL,
  'vente d''un autre prestataire : refus');
SELECT pg_temp.a();
SELECT is(pg_temp.lines('32dd16'), 0, 'vente 16 : aucune ligne');

-- check_sale_lines : contrôle seul, sans écriture.
SELECT is(check_sale_lines(pg_temp.id('32aa01'), jsonb_build_array(pg_temp.ln('Bière', 1, 1100)),
                           1100), 14,
  'check_sale_lines : rend la version retenue (dernière servie)');
SELECT is(check_sale_lines(pg_temp.id('32aa01'), jsonb_build_array(pg_temp.ln('Bière', 1, 1200)),
                           1200), 15, 'check_sale_lines : version courante');
SELECT throws_ok(format('SELECT check_sale_lines(%L, %L, 1000)', pg_temp.id('32aa01'),
                        jsonb_build_array(pg_temp.ln('Bière', 1, 1000))), 'CL034', NULL,
  'check_sale_lines : version 1 refusée');
SELECT throws_ok(format('SELECT check_sale_lines(%L, %L, 1)', pg_temp.id('32aa04'),
                        jsonb_build_array(pg_temp.ln('Bière', 1, 1))), 'CL034', NULL,
  'check_sale_lines : terminal sans point de vente refusé');
SELECT is((SELECT count(*)::int FROM sale_line), 206,
          'check_sale_lines n''écrit rien (2 + 1 + 3 + 200)');
SELECT is((SELECT provolatile::text FROM pg_proc WHERE proname = 'check_sale_lines'), 's',
  'check_sale_lines : STABLE (aucune écriture possible)');

-- Réaffectation d'un terminal (A2, clé (device_id, pos_id, version)) : les numéros de version sont
-- comptés par point de vente. aa07 est servi sur f103 (version 2), déplacé sur f104 (servi en
-- version 3), puis revenu sur f103 (servi en version 3, même numéro que sur f104). La version 3 de
-- f103 doit être écrite : sinon la « dernière servie » de f103 resterait la 2, servie puis
-- remplacée.
INSERT INTO point_of_sale (id, operator_id, participation_id, name)
VALUES (pg_temp.id('32f104'), pg_temp.id('32a001'), pg_temp.id('32f003'), 'Snack A2 bis');
INSERT INTO device (id, operator_id, event_id, pos_id, app_mode, status, serial)
VALUES (pg_temp.id('32aa07'), pg_temp.id('32a001'), pg_temp.id('32d001'), pg_temp.id('32f103'),
        'CATALOG_POS', 'ACTIVE', 'T0032-7');
SELECT is((SELECT version FROM record_device_catalog_served(pg_temp.id('32aa07'))), 2,
  'réaffectation : f103 version 2 (Burger 2500) servie à aa07');
SELECT is((SELECT version FROM update_catalog_item(pg_temp.item('Burger'), NULL, NULL, NULL, 2600,
                                                   NULL, NULL, pg_temp.id('32e001'))), 3,
  'réaffectation : f103 version 3 (Burger 2600)');
UPDATE device SET pos_id = pg_temp.id('32f104') WHERE id = pg_temp.id('32aa07');
SELECT is((SELECT version FROM create_catalog_category(pg_temp.id('32f104'), 'Encas', 'Bites', 0,
                                                       pg_temp.id('32e001'))), 1,
  'f104 : version 1');
SELECT is((SELECT version FROM create_catalog_item(pg_temp.cat('Encas'), 'Frites', 'Fries', 800, 0,
                                                   pg_temp.id('32e001'))), 2, 'f104 : version 2');
SELECT is((SELECT version FROM create_catalog_item(pg_temp.cat('Encas'), 'Glace', 'Ice cream', 600,
                                                   0, pg_temp.id('32e001'))), 3,
  'f104 : version 3');
SELECT is((SELECT version FROM record_device_catalog_served(pg_temp.id('32aa07'))), 3,
  'réaffectation : f104 version 3 servie à aa07');
UPDATE device SET pos_id = pg_temp.id('32f103') WHERE id = pg_temp.id('32aa07');
SELECT is((SELECT version FROM record_device_catalog_served(pg_temp.id('32aa07'))), 3,
  'réaffectation : retour sur f103, version 3 servie à aa07');
SELECT is((SELECT version FROM update_catalog_item(pg_temp.item('Burger'), NULL, NULL, NULL, 2700,
                                                   NULL, NULL, pg_temp.id('32e001'))), 4,
  'réaffectation : f103 version 4 (Burger 2700), jamais servie');
SELECT is((SELECT string_agg(right(pos_id::text, 4) || ':' || version, ',' ORDER BY pos_id, version)
             FROM device_catalog_served WHERE device_id = pg_temp.id('32aa07')),
  'f103:2,f103:3,f104:3', 'réaffectation : version 3 de f103 écrite malgré la 3 de f104');
SELECT throws_ok(format('SELECT check_sale_lines(%L, %L, 2500)', pg_temp.id('32aa07'),
                        jsonb_build_array(pg_temp.ln('Burger', 1, 2500))), 'CL034', NULL,
  'réaffectation : prix de la version 2 de f103 (servie puis remplacée) refusé');
SELECT is(check_sale_lines(pg_temp.id('32aa07'), jsonb_build_array(pg_temp.ln('Burger', 1, 2600)),
                           2600), 3,
  'réaffectation : prix de la version 3 de f103 (dernière servie) accepté');
SELECT is(check_sale_lines(pg_temp.id('32aa07'), jsonb_build_array(pg_temp.ln('Burger', 1, 2700)),
                           2700), 4, 'réaffectation : prix de la version courante de f103 accepté');
SELECT throws_ok(format('SELECT check_sale_lines(%L, %L, 800)', pg_temp.id('32aa07'),
                        jsonb_build_array(pg_temp.ln('Frites', 1, 800))), 'CL034', NULL,
  'réaffectation : version servie sur f104 non admise sur f103');

-- Quantité écrite 1.0 (nombre JSON entier à décimale nulle) : acceptée par le contrôle et par
-- l'écriture, une ligne de quantité 1 (pas d'erreur 22P02).
SELECT pg_temp.sale('32dd17', '32aa07', 2600, p_merchant => '32cb03');
SELECT is(check_sale_lines(pg_temp.id('32aa07'), jsonb_build_array(pg_temp.ln('Burger', 1.0, 2600)),
                           2600), 3, 'quantité 1.0 : check_sale_lines accepte (version 3)');
SELECT is(record_sale_lines(pg_temp.id('32dd17'), pg_temp.id('32aa07'),
                            jsonb_build_array(pg_temp.ln('Burger', 1.0, 2600))), 1,
  'quantité 1.0 : record_sale_lines écrit une ligne');
SELECT is((SELECT quantity || 'x' || unit_price || '=' || line_total || ':v' || catalog_version
             FROM sale_line WHERE transaction_id = pg_temp.id('32dd17')),
  '1x2600=2600:v3', 'quantité 1.0 : ligne de quantité 1, version 3 de f103');

-- Ajout seul des lignes.
SELECT throws_like('UPDATE sale_line SET quantity = quantity', '%ajout seul%',
                   'sale_line : UPDATE refusé');
SELECT throws_like('DELETE FROM sale_line', '%ajout seul%', 'sale_line : DELETE refusé');
SELECT throws_ok(format('INSERT INTO sale_line (operator_id, transaction_id, line_no, pos_id,
                           item_id, catalog_version, label_fr, label_en, quantity, unit_price,
                           vat_rate_bps, line_total)
                           VALUES (%L, %L, 9, %L, %L, 15, ''B'', ''B'', 2, 1200, 0, 2000)',
                        pg_temp.id('32a001'), pg_temp.id('32dd16'), pg_temp.id('32f101'),
                        pg_temp.item('Bière')),
  '23514', NULL, 'table : line_total = quantity × unit_price');

SELECT * FROM finish();
ROLLBACK;
