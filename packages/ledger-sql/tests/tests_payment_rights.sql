-- Droits de l'encaissement en ligne (mission 5b, terminaux-paiement-en-ligne, lot WP07 ;
-- contracts/database-rights.md ; research R-06, R-07, R-11 A12, A20 ; OP-N76, ADR-121) — pgTAP,
-- écrit à la main (pas un fichier généré).
-- Lancer : pg_prove -d <base> tests/tests_payment_rights.sql (base créée par les migrations,
-- roles.sql et post-roles.sql rejoués).
-- La suite rejoue elle-même roles.sql puis post-roles.sql (ordre de migrate.ts) : roles.sql rend
-- SELECT, INSERT et UPDATE sur toutes les tables et vues à cashless_app, post-roles.sql (section 6)
-- doit les reprendre. Les suites de 0031 à 0034 testent leurs fonctions en propriétaire ; celle-ci
-- prouve les droits et les chemins légitimes sous SET LOCAL ROLE cashless_app. Prestataires A et B.
\set ON_ERROR_STOP 1
\set QUIET 1
BEGIN;
SET LOCAL client_min_messages = warning;
\ir ../roles.sql
\ir ../post-roles.sql
RESET client_min_messages;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

-- Identifiants : pg_temp.id('52a001') = '00000000-0000-0000-0000-00000052a001'.
CREATE FUNCTION pg_temp.id(p text) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT ('00000000-0000-0000-0000-' || lpad(p, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.a() RETURNS void LANGUAGE sql AS
  $$ SELECT set_config('app.operator_id', pg_temp.id('52a001')::text, true) $$;
CREATE FUNCTION pg_temp.b() RETURNS void LANGUAGE sql AS
  $$ SELECT set_config('app.operator_id', pg_temp.id('52a002')::text, true) $$;
CREATE FUNCTION pg_temp.h(p text) RETURNS bytea LANGUAGE sql IMMUTABLE AS
  $$ SELECT sha256(convert_to('52 ' || p, 'UTF8')) $$;
-- Colonnes d'une table (ou vue) qu'un rôle peut lire, insérer ou modifier, triées.
CREATE FUNCTION pg_temp.cols(p_role text, p_table text, p_priv text) RETURNS text[]
LANGUAGE sql STABLE AS $$
  SELECT coalesce(array_agg(attname::text ORDER BY attname::text COLLATE "C"), '{}')
    FROM pg_attribute
   WHERE attrelid = p_table::regclass AND attnum > 0 AND NOT attisdropped
     AND has_column_privilege(p_role, p_table, attname, p_priv)
$$;
-- Tables de la mission (0031 à 0034) et tables du schéma que la mission ferme.
CREATE FUNCTION pg_temp.tables() RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY['vendor', 'vendor_session', 'vendor_pin_check', 'catalog_category', 'catalog_item',
               'catalog_version', 'catalog_version_item', 'point_of_sale_catalog_policy',
               'device_catalog_served', 'sale_line', 'sale_attribution', 'payment_request',
               'payment_request_detail', 'kyc_verification']
$$;
-- Lecture d'un identifiant posé par un appel précédent (cashless_app n'a pas de table temporaire).
CREATE FUNCTION pg_temp.g(p text) RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('wp07.' || p, true), '')::uuid $$;

-- Données (propriétaire) ------------------------------------------------------------------------
-- A : organisateur b001, événement d001 (LIVE), commerçant M1 (b101), point de vente f101 ;
-- e001 OPERATOR_ADMIN de A ; terminaux aa01 KEYPAD_TPE, aa02 CATALOG_POS (f101).
-- B : organisateur b011, événement d011 (LIVE), commerçant MB (b111), point de vente f111 ;
-- e011 OPERATOR_ADMIN de B ; terminaux ab01 KEYPAD_TPE, ab02 CATALOG_POS (f111) ; une ligne de B
-- dans chaque table de la mission (preuve d'isolation non vide).
INSERT INTO party (id, kind, legal_name, country_code) VALUES
 (pg_temp.id('52a001'), 'OPERATOR', 'Prestataire A', 'SN'),
 (pg_temp.id('52a002'), 'OPERATOR', 'Prestataire B', 'CI');
INSERT INTO party (id, kind, operator_id, legal_name) VALUES
 (pg_temp.id('52b001'), 'ORGANIZER', pg_temp.id('52a001'), 'Organisateur A'),
 (pg_temp.id('52b011'), 'ORGANIZER', pg_temp.id('52a002'), 'Organisateur B'),
 (pg_temp.id('52b101'), 'MERCHANT', pg_temp.id('52a001'), 'Commerçant M1'),
 (pg_temp.id('52b111'), 'MERCHANT', pg_temp.id('52a002'), 'Commerçant MB'),
 (pg_temp.id('52c211'), 'CUSTOMER', pg_temp.id('52a002'), 'Festivalier B');
INSERT INTO jurisdiction_profile (id, country_code, version, valid_from, breakage_destination)
VALUES (pg_temp.id('52c001'), 'SN', 520052, '2026-01-01', 'ORGANIZER');
INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone, jurisdiction_id,
                   funds_holder, status) VALUES
 (pg_temp.id('52d001'), pg_temp.id('52a001'), pg_temp.id('52b001'), 'Événement A', 'XOF',
  'Africa/Dakar', pg_temp.id('52c001'), 'ORGANIZER', 'LIVE'),
 (pg_temp.id('52d011'), pg_temp.id('52a002'), pg_temp.id('52b011'), 'Événement B', 'XOF',
  'Africa/Dakar', pg_temp.id('52c001'), 'ORGANIZER', 'LIVE');
INSERT INTO merchant_participation (id, operator_id, event_id, merchant_id, link_type,
                                    payout_to) VALUES
 (pg_temp.id('52f001'), pg_temp.id('52a001'), pg_temp.id('52d001'), pg_temp.id('52b101'),
  'INTERNAL', pg_temp.id('52b001')),
 (pg_temp.id('52f011'), pg_temp.id('52a002'), pg_temp.id('52d011'), pg_temp.id('52b111'),
  'INTERNAL', pg_temp.id('52b011'));
INSERT INTO point_of_sale (id, operator_id, participation_id, name) VALUES
 (pg_temp.id('52f101'), pg_temp.id('52a001'), pg_temp.id('52f001'), 'Bar A'),
 (pg_temp.id('52f111'), pg_temp.id('52a002'), pg_temp.id('52f011'), 'Bar B');
INSERT INTO app_user (id, operator_id, issuer, subject, email, display_name)
SELECT pg_temp.id(u), pg_temp.id(o), 'https://idp.test', 's0052' || u, u || '@test',
       'Personne ' || u
  FROM (VALUES ('52e001', '52a001'), ('52e011', '52a002')) AS v(u, o);
INSERT INTO role_assignment (user_id, role, scope_type, scope_id, granted_by) VALUES
 (pg_temp.id('52e001'), 'OPERATOR_ADMIN', 'OPERATOR', pg_temp.id('52a001'), NULL),
 (pg_temp.id('52e011'), 'OPERATOR_ADMIN', 'OPERATOR', pg_temp.id('52a002'), NULL);
INSERT INTO device (id, operator_id, kind, app_mode, event_id, pos_id, serial, status) VALUES
 (pg_temp.id('52aa01'), pg_temp.id('52a001'), 'POS', 'KEYPAD_TPE', pg_temp.id('52d001'),
  pg_temp.id('52f101'), 'P52-AA01', 'ACTIVE'),
 (pg_temp.id('52aa02'), pg_temp.id('52a001'), 'POS', 'CATALOG_POS', pg_temp.id('52d001'),
  pg_temp.id('52f101'), 'P52-AA02', 'ACTIVE'),
 (pg_temp.id('52ab01'), pg_temp.id('52a002'), 'POS', 'KEYPAD_TPE', pg_temp.id('52d011'),
  pg_temp.id('52f111'), 'P52-AB01', 'ACTIVE'),
 (pg_temp.id('52ab02'), pg_temp.id('52a002'), 'POS', 'CATALOG_POS', pg_temp.id('52d011'),
  pg_temp.id('52f111'), 'P52-AB02', 'ACTIVE');
INSERT INTO ledger (id, operator_id, scope_type, scope_id, currency, issuer_id,
                    funds_holder_id) VALUES
 (pg_temp.id('52cc011'), pg_temp.id('52a002'), 'EVENT', pg_temp.id('52d011'), 'XOF',
  pg_temp.id('52b011'), pg_temp.id('52b011'));
INSERT INTO wallet (id, operator_id, ledger_id, customer_id, status) VALUES
 (pg_temp.id('52cb011'), pg_temp.id('52a002'), pg_temp.id('52cc011'), pg_temp.id('52c211'),
  'ACTIVE');
-- B, par les fonctions sous les droits du propriétaire : vendeur, essai de PIN, session,
-- catalogue (catégorie, article, versions, politique), version servie, demande QR et détail.
SELECT pg_temp.b();
SELECT set_config('wp07.vb', create_vendor(pg_temp.id('52b111'), 'Vendeur B',
                                           '$argon2id$v=19$m=19456,t=2,p=1$c2VsMDA1Mg$dkI',
                                           pg_temp.id('52e011'))::text, true);
SELECT set_config('wp07.cb', (SELECT check_id
                                FROM begin_vendor_pin_check(pg_temp.g('vb'), pg_temp.id('52ab01')))
                               ::text, true);
SELECT set_config('wp07.sb', (SELECT vendor_session_id
                                FROM open_vendor_session(pg_temp.g('cb'), pg_temp.id('52ab01')))
                               ::text, true);
SELECT set_config('wp07.catb', (SELECT id FROM create_catalog_category(pg_temp.id('52f111'),
                                  'Boissons B', 'Drinks B', 0, pg_temp.id('52e011')))::text, true);
SELECT set_config('wp07.itb', (SELECT id FROM create_catalog_item(pg_temp.g('catb'), 'Eau B',
                                 'Water B', 500, 1800, pg_temp.id('52e011')))::text, true);
SELECT record_device_catalog_served(pg_temp.id('52ab02'));
SELECT create_merchant_payment_request(pg_temp.id('52ab01'), pg_temp.g('sb'), 700, 'XOF', 60,
                                       pg_temp.h('jeton B'), 'k52:b1', NULL, NULL);
-- B, en direct (propriétaire) : une vente, sa ligne, son attribution ; une identification.
INSERT INTO journal_transaction (id, operator_id, ledger_id, event_id, type, idempotency_key,
                                 request_hash, occurred_at, source, device_id)
VALUES (pg_temp.id('52fc011'), pg_temp.id('52a002'), pg_temp.id('52cc011'), pg_temp.id('52d011'),
        'PURCHASE', 'k52:t011', 'h52', now(), 'ONLINE', pg_temp.id('52ab01'));
INSERT INTO sale_line (operator_id, transaction_id, line_no, pos_id, item_id, catalog_version,
                       label_fr, label_en, quantity, unit_price, vat_rate_bps, line_total)
SELECT pg_temp.id('52a002'), pg_temp.id('52fc011'), 1, pos_id, item_id, version, label_fr,
       label_en, 1, unit_price, vat_rate_bps, unit_price
  FROM catalog_version_item WHERE pos_id = pg_temp.id('52f111') AND item_id = pg_temp.g('itb')
 ORDER BY version DESC LIMIT 1;
INSERT INTO sale_attribution (transaction_id, operator_id, vendor_id, vendor_session_id, device_id,
                              channel)
VALUES (pg_temp.id('52fc011'), pg_temp.id('52a002'), pg_temp.g('vb'), pg_temp.g('sb'),
        pg_temp.id('52ab01'), 'NFC');
INSERT INTO kyc_verification (operator_id, customer_id, wallet_id, agent_id, id_type, id_country,
                              id_last4, id_expires_on)
VALUES (pg_temp.id('52a002'), pg_temp.id('52c211'), pg_temp.id('52cb011'), pg_temp.id('52e011'),
        'PASSPORT', 'CI', '1234', current_date + 365);
RESET app.operator_id;
SELECT is((SELECT array_agg(t ORDER BY t) FROM unnest(pg_temp.tables()) t
            WHERE (xpath('/row/c/text()',
                         query_to_xml(format('SELECT count(*) AS c FROM %I WHERE operator_id = %L',
                                             t, pg_temp.id('52a002')), false, true, ''))
                  )[1]::text::int = 0),
  NULL::text[],
  'données : chaque table de la mission a au moins une ligne de B (isolation non vide)');

-- 1. Catalogue des droits de cashless_app -------------------------------------------------------
-- 1a. Lecture : liste exacte des colonnes. vendor sans pin_hash, failed_attempts, locked_at
--     (NFR-002) ; payment_request sans nonce_hash (NFR-008). Une colonne ajoutée plus tard fait
--     échouer la liste (la liste calculée de post-roles.sql l'aurait accordée).
SELECT is(pg_temp.cols('cashless_app', t, 'SELECT'), e::text[],
  'cashless_app : colonnes lisibles de ' || t || ', liste exacte')
  FROM (VALUES
    ('vendor', '{created_at,created_by,display_name,id,merchant_id,operator_id,status,updated_at}'),
    ('vendor_public', '{display_name,id,locked,merchant_id,operator_id,status}'),
    ('vendor_session', '{closed_at,closed_reason,device_id,expires_at,id,opened_at,operator_id,'
                       || 'vendor_id}'),
    ('vendor_pin_check', '{created_at,device_id,expires_at,id,operator_id,used_at,vendor_id}'),
    ('catalog_category', '{active,created_at,id,label_en,label_fr,operator_id,pos_id,position,'
                         || 'updated_at}'),
    ('catalog_item', '{active,category_id,created_at,id,label_en,label_fr,operator_id,pos_id,'
                     || 'unit_price,updated_at,vat_rate_bps}'),
    ('catalog_version', '{created_at,created_by,operator_id,pos_id,version}'),
    ('catalog_version_item', '{category_id,category_label_en,category_label_fr,category_position,'
                             || 'item_id,label_en,label_fr,operator_id,pos_id,unit_price,'
                             || 'vat_rate_bps,version}'),
    ('point_of_sale_catalog_policy', '{merchant_manages,operator_id,pos_id,updated_at,updated_by}'),
    ('device_catalog_served', '{device_id,operator_id,pos_id,served_at,version}'),
    ('sale_line', '{catalog_version,item_id,label_en,label_fr,line_no,line_total,operator_id,'
                  || 'pos_id,quantity,transaction_id,unit_price,vat_rate_bps}'),
    ('sale_attribution', '{actor_user_id,channel,created_at,device_id,operator_id,transaction_id,'
                         || 'vendor_id,vendor_session_id}'),
    ('payment_request', '{amount,currency,device_id,direction,event_id,expires_at,id,operator_id,'
                        || 'status,transaction_id,wallet_id}'),
    ('payment_request_detail', '{catalog_version,created_at,idempotency_key,lines,operator_id,'
                               || 'payment_request_id,vendor_session_id}'),
    ('kyc_verification', '{agent_id,customer_id,id,id_country,id_expires_on,id_last4,id_type,'
                         || 'method,operator_id,revoked_at,revoked_by,revoked_reason,status,'
                         || 'verified_at,wallet_id}')
  ) AS x(t, e);
SELECT ok(NOT has_table_privilege('cashless_app', t, 'SELECT'),
  'cashless_app : pas de SELECT sur toute la table ' || t || ' (A20 : accordé par colonne)')
  FROM unnest(ARRAY['vendor', 'payment_request']) t;
-- 1b. Écriture : aucune colonne insérable ni modifiable, aucun DELETE ni TRUNCATE
--     (approval_token_use garde son INSERT, hors de cette liste).
SELECT is(pg_temp.cols('cashless_app', t, p), '{}'::text[],
  'cashless_app : aucune colonne ' || p || ' sur ' || t)
  FROM unnest(pg_temp.tables() || ARRAY['vendor_public']) t, unnest(ARRAY['INSERT', 'UPDATE']) p;
SELECT is((SELECT array_agg(t || ':' || p ORDER BY t, p)
             FROM unnest(pg_temp.tables() || ARRAY['vendor_public']) t,
                  unnest(ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) p
            WHERE has_table_privilege('cashless_app', t, p)), NULL::text[],
  'cashless_app : aucun droit de table INSERT, UPDATE, DELETE, TRUNCATE sur ces tables et la vue');
SELECT ok(has_table_privilege('cashless_app', 'approval_token_use', 'INSERT')
      AND NOT has_table_privilege('cashless_app', 'approval_token_use', 'UPDATE'),
  'approval_token_use : INSERT gardé (consommation des jetons), UPDATE retiré');
-- 1c. Autres rôles : aucune écriture ; aucun rôle cashless_* (ni PUBLIC) ne lit les empreintes.
--     Rôles relevés dans pg_roles (un rôle cashless_* ajouté plus tard est couvert d'office).
CREATE FUNCTION pg_temp.others() RETURNS text[] LANGUAGE sql STABLE AS $$
  SELECT array_agg(rolname::text ORDER BY rolname) || 'public'::text FROM pg_roles
   WHERE rolname LIKE 'cashless\_%' AND rolname <> 'cashless_app'
$$;
SELECT ok(pg_temp.others() @> ARRAY['cashless_keyadmin', 'cashless_perso', 'cashless_platform',
                                    'cashless_tagcheck', 'cashless_tagkeys', 'public'],
  'témoin : rôles comparés (pg_roles cashless_* hors cashless_app, et PUBLIC)');
SELECT is((SELECT array_agg(r || ':' || t || ':' || p ORDER BY r, t, p)
             FROM unnest(pg_temp.others()) r,
                  unnest(pg_temp.tables() || ARRAY['vendor_public']) t,
                  unnest(ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) p
            WHERE has_table_privilege(r, t, p)
               OR (p IN ('INSERT', 'UPDATE') AND has_any_column_privilege(r, t, p))), NULL::text[],
  'PUBLIC et autres rôles cashless_* : aucune écriture sur les tables de la mission');
SELECT is((SELECT array_agg(r || ':' || c ORDER BY r, c)
             FROM unnest(pg_temp.others() || 'cashless_app'::text) r,
                  (VALUES ('vendor', 'pin_hash'), ('payment_request', 'nonce_hash')) AS x(t, c)
            WHERE has_column_privilege(r, t, c, 'SELECT')), NULL::text[],
  'NFR-002, NFR-008 : aucun rôle cashless_* ni PUBLIC ne lit vendor.pin_hash ni '
  || 'payment_request.nonce_hash');
SELECT is((SELECT array_agg(r ORDER BY r)
             FROM unnest(pg_temp.others()) r
            WHERE has_any_column_privilege(r, 'vendor', 'SELECT')
               OR has_any_column_privilege(r, 'payment_request', 'SELECT')), NULL::text[],
  'PUBLIC et autres rôles cashless_* : aucune lecture de vendor ni de payment_request');
SELECT is((SELECT array_agg(viewname::text ORDER BY viewname) FROM pg_views
            WHERE schemaname = 'public'
              AND (has_table_privilege('cashless_app', format('public.%I', viewname), 'INSERT')
                   OR has_table_privilege('cashless_app', format('public.%I', viewname), 'UPDATE'))
              AND viewname IN ('vendor_public')), NULL::text[],
  'vues de la mission : aucune modifiable par cashless_app');
-- Vues des extensions (pgTAP : pg_all_foreign_keys, tap_funky) écartées : elles ne sont pas au
-- schéma de l'application.
SELECT is((SELECT array_agg(viewname::text ORDER BY viewname) FROM pg_views v
            WHERE schemaname = 'public'
              AND NOT EXISTS (SELECT 1 FROM pg_depend d
                               WHERE d.classid = 'pg_class'::regclass
                                 AND d.objid = format('public.%I', v.viewname)::regclass
                                 AND d.deptype = 'e')
              AND viewname NOT IN (
              'trial_balance', 'party_position', 'ledger_invariant', 'hot_account_side_check',
              'balance_drift', 'counter_time_inversion', 'batch_inventory', 'ledgers_to_seal',
              'offline_snapshot_rows')),
  ARRAY['vendor_public'],
  'vues : vendor_public est la seule vue ajoutée depuis la mission 5a (une vue nouvelle doit être '
  || 'fermée en écriture ici)');

-- 2. Refus réels sous cashless_app (droits contrôlés à la préparation, avec ou sans ligne) --------
SET LOCAL ROLE cashless_app;
SELECT pg_temp.a();
SELECT throws_ok(format('INSERT INTO %I DEFAULT VALUES', t), '42501', NULL,
  'cashless_app : INSERT direct dans ' || t || ' refusé')
  FROM unnest(pg_temp.tables() || ARRAY['vendor_public']) t;
SELECT throws_ok(format('UPDATE %I SET operator_id = operator_id', t), '42501', NULL,
  'cashless_app : UPDATE direct de ' || t || ' refusé')
  FROM unnest(pg_temp.tables() || ARRAY['vendor_public']) t;
SELECT throws_ok(q, '42501', NULL, 'cashless_app : ' || q || ' refusé')
  FROM unnest(ARRAY[
    'UPDATE vendor_public SET status = ''ACTIVE''',
    'UPDATE vendor_public SET display_name = ''x'', merchant_id = merchant_id',
    'INSERT INTO vendor_public (operator_id, merchant_id, display_name, status) '
      || 'SELECT operator_id, merchant_id, display_name, status FROM vendor_public',
    'UPDATE vendor SET failed_attempts = 0, locked_at = NULL',
    'UPDATE vendor SET pin_hash = pin_hash',
    'UPDATE vendor_session SET closed_at = NULL, closed_reason = NULL',
    'UPDATE vendor_pin_check SET used_at = NULL',
    'UPDATE catalog_item SET unit_price = 1',
    'UPDATE payment_request SET status = ''PENDING''',
    'UPDATE payment_request SET expires_at = now() + interval ''1 day''',
    'SELECT pin_hash FROM vendor',
    'SELECT * FROM vendor',
    'SELECT v FROM vendor v',
    'SELECT id FROM vendor WHERE failed_attempts > 0',
    'SELECT locked_at FROM vendor',
    'SELECT nonce_hash FROM payment_request',
    'SELECT * FROM payment_request',
    'SELECT id FROM payment_request WHERE nonce_hash = ''\x00''::bytea',
    'SELECT id FROM payment_request WHERE nonce_hash IS NOT NULL',
    'INSERT INTO kyc_verification (operator_id, customer_id, agent_id, id_type, id_country, '
      || 'id_last4, id_expires_on) VALUES (''00000000-0000-0000-0000-00000052a001'', '
      || '''00000000-0000-0000-0000-00000052a001'', ''00000000-0000-0000-0000-00000052a001'', '
      || '''PASSPORT'', ''SN'', ''1'', current_date)',
    'UPDATE kyc_verification SET status = ''REVOKED''',
    'INSERT INTO sale_attribution (transaction_id, operator_id, vendor_id, vendor_session_id, '
      || 'device_id, channel) SELECT transaction_id, operator_id, vendor_id, vendor_session_id, '
      || 'device_id, channel FROM sale_attribution'
  ]) q;

-- 3. Chemins légitimes sous cashless_app (un appel réel par famille de fonctions accordées) -------
SELECT lives_ok($$SELECT id, operator_id, merchant_id, display_name, status, created_by,
                         created_at, updated_at FROM vendor$$,
  'cashless_app : colonnes permises de vendor lisibles');
SELECT lives_ok($$SELECT id, operator_id, merchant_id, display_name, status, locked
                    FROM vendor_public$$,
  'cashless_app : vendor_public lisible (statut « bloqué »)');
SELECT lives_ok($$SELECT id, operator_id, event_id, direction, device_id, wallet_id, amount,
                         currency, expires_at, status, transaction_id FROM payment_request$$,
  'cashless_app : colonnes permises de payment_request lisibles');
-- Vendeurs : création, puis ouverture de session en deux temps (essai de PIN, puis ouverture après
-- vérification de l'empreinte par l'API).
SELECT lives_ok($$SELECT set_config('wp07.va', create_vendor(pg_temp.id('52b101'), 'Vendeur A',
                    '$argon2id$v=19$m=19456,t=2,p=1$c2VsMDA1Mg$djE', pg_temp.id('52e001'))::text,
                    true)$$,
  'vendeurs : create_vendor exécutable');
SELECT lives_ok($$SELECT set_config('wp07.ca', (SELECT check_id FROM begin_vendor_pin_check(
                    pg_temp.g('va'), pg_temp.id('52aa01')))::text, true)$$,
  'vendeurs : begin_vendor_pin_check exécutable (premier temps)');
SELECT isnt((SELECT pin_hash FROM begin_vendor_pin_check(pg_temp.g('va'), pg_temp.id('52aa02'))),
  NULL, 'vendeurs : l''empreinte n''est rendue que par la fonction (vérification par l''API)');
SELECT lives_ok($$SELECT set_config('wp07.sa', (SELECT vendor_session_id FROM open_vendor_session(
                    pg_temp.g('ca'), pg_temp.id('52aa01')))::text, true)$$,
  'vendeurs : open_vendor_session exécutable (second temps)');
SELECT is(assert_vendor_session(pg_temp.id('52aa01'), pg_temp.g('sa')), pg_temp.g('va'),
  'vendeurs : assert_vendor_session exécutable, rend le vendeur de la session');
-- Catalogue : une écriture crée une version ; version servie à la caisse.
SELECT lives_ok($$SELECT set_config('wp07.cata', (SELECT id FROM create_catalog_category(
                    pg_temp.id('52f101'), 'Boissons', 'Drinks', 0, pg_temp.id('52e001')))::text,
                    true)$$,
  'catalogue : create_catalog_category exécutable');
SELECT lives_ok($$SELECT create_catalog_item(pg_temp.g('cata'), 'Eau', 'Water', 500, 1800,
                                             pg_temp.id('52e001'))$$,
  'catalogue : create_catalog_item exécutable');
SELECT is((SELECT max(version) FROM catalog_version WHERE pos_id = pg_temp.id('52f101')), 2,
  'catalogue : deux écritures, deux versions (lues sous la RLS)');
SELECT is((SELECT version FROM record_device_catalog_served(pg_temp.id('52aa02'))), 2,
  'catalogue : record_device_catalog_served exécutable');
-- Demande QR : création puis annulation par le terminal.
SELECT lives_ok($$SELECT set_config('wp07.pra', (SELECT payment_request_id
                    FROM create_merchant_payment_request(pg_temp.id('52aa01'), pg_temp.g('sa'), 500,
                      'XOF', 60, pg_temp.h('jeton A'), 'k52:a1', NULL, NULL))::text, true)$$,
  'QR : create_merchant_payment_request exécutable');
SELECT is((SELECT status FROM payment_request_for_token(pg_temp.g('pra'), pg_temp.h('jeton A'))),
  'PENDING', 'QR : payment_request_for_token(uuid, bytea) exécutable');
SELECT lives_ok($$SELECT cancel_payment_request(pg_temp.g('pra'), pg_temp.id('52aa01'), NULL)$$,
  'QR : cancel_payment_request exécutable (par le terminal d''origine)');
SELECT is((SELECT status FROM payment_request WHERE id = pg_temp.g('pra')), 'CANCELLED',
  'QR : demande annulée, statut lu sans l''empreinte');
-- Paiement : numérotation d'un terminal en ligne (schéma de référence, accordée par ce lot).
SELECT is((SELECT replayed FROM record_device_seq(pg_temp.id('52aa01'), 1, pg_temp.h('seq 1'),
                                                  'ACCEPTED', 'ONLINE')), false,
  'paiement : record_device_seq exécutable');
SELECT throws_ok($$SELECT * FROM assert_wallet_payable(pg_temp.id('52cb011'))$$, 'P0002', NULL,
  'paiement : assert_wallet_payable exécutable (portefeuille de B introuvable pour A)');

-- 4. Isolation : sous cashless_app et A, aucune ligne de B (RLS forcée ; vue au propriétaire) ----
SELECT is((SELECT array_agg(t ORDER BY t) FROM unnest(pg_temp.tables()) t
            WHERE (xpath('/row/c/text()',
                         query_to_xml(format('SELECT count(*) AS c FROM %I WHERE operator_id = %L',
                                             t, pg_temp.id('52a002')), false, true, ''))
                  )[1]::text::int <> 0),
  NULL::text[],
  'NFR-007 : sous A, aucune table de la mission ne montre une ligne de B');
SELECT is((SELECT count(*)::int FROM vendor_public WHERE operator_id <> pg_temp.id('52a001')), 0,
  'NFR-007 : vendor_public (droits du propriétaire) ne montre aucune ligne de B');
SELECT is((SELECT count(*)::int FROM vendor_public WHERE id = pg_temp.g('va')), 1,
  'témoin : vendor_public montre le vendeur de A');
SELECT is((SELECT count(*)::int FROM vendor_session WHERE id = pg_temp.g('sa')), 1,
  'témoin : la session de A est visible');
SELECT set_config('app.operator_id', '', true);
SELECT is((SELECT count(*)::int FROM vendor_public), 0,
  'NFR-007 : vendor_public sans prestataire de session : aucune ligne');
SELECT pg_temp.a();
RESET ROLE;

-- 5. Borne d'OP-N76 (ADR-121, limite acceptée, dette nommée) -------------------------------------
-- Seul cashless_app exécute begin_vendor_pin_check et open_vendor_session. Si ce test échoue, un
-- autre rôle (ou PUBLIC) a reçu ces fonctions : voir docs/POINTS_OUVERTS.md OP-N76 avant tout
-- élargissement (porteur, règle 1 de CLAUDE.md).
SELECT is((SELECT array_agg(g ORDER BY g)
             FROM (SELECT DISTINCT CASE a.grantee WHEN 0 THEN 'PUBLIC'
                                                  ELSE a.grantee::regrole::text END AS g
                     FROM pg_proc p,
                          aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                    WHERE p.oid = f::regprocedure AND a.grantee <> p.proowner
                      AND a.privilege_type = 'EXECUTE') x),
  ARRAY['cashless_app'],
  'OP-N76, ADR-121 : ' || f || ' accordée à cashless_app seul (droits déclarés ; '
  || 'docs/POINTS_OUVERTS.md OP-N76)')
  FROM unnest(ARRAY['begin_vendor_pin_check(uuid,uuid)', 'open_vendor_session(uuid,uuid)']) f;
SELECT is((SELECT array_agg(r.rolname::text ORDER BY r.rolname)
             FROM pg_roles r, pg_proc p
            WHERE p.oid = f::regprocedure AND NOT r.rolsuper AND r.oid <> p.proowner
              AND has_function_privilege(r.oid, p.oid, 'EXECUTE')),
  ARRAY['cashless_app'],
  'OP-N76, ADR-121 : seul cashless_app (hors superutilisateurs et propriétaire) exécute ' || f
  || ', héritage compris (docs/POINTS_OUVERTS.md OP-N76)')
  FROM unnest(ARRAY['begin_vendor_pin_check(uuid,uuid)', 'open_vendor_session(uuid,uuid)']) f;
SELECT ok(NOT has_function_privilege('public', f, 'EXECUTE'),
  'OP-N76 : PUBLIC n''exécute pas ' || f)
  FROM unnest(ARRAY['begin_vendor_pin_check(uuid,uuid)', 'open_vendor_session(uuid,uuid)']) f;

-- 6. Rejeu de post-roles.sql : mêmes droits (idempotent) -----------------------------------------
CREATE TEMP TABLE wp07_rights AS
  SELECT t, p, pg_temp.cols('cashless_app', t, p) AS c
    FROM unnest(pg_temp.tables() || ARRAY['vendor_public', 'device']) t,
         unnest(ARRAY['SELECT', 'INSERT', 'UPDATE']) p;
SET LOCAL client_min_messages = warning;
\ir ../roles.sql
\ir ../post-roles.sql
RESET client_min_messages;
SELECT is((SELECT array_agg(t || ':' || p ORDER BY t, p) FROM wp07_rights
            WHERE c IS DISTINCT FROM pg_temp.cols('cashless_app', t, p)), NULL::text[],
  'rejeu roles.sql puis post-roles.sql : colonnes lisibles, insérables et modifiables inchangées');

SELECT * FROM finish();
ROLLBACK;
