-- Droits de la base de la mission durcissements-serveur (mission 11a ; WP03 ; FR-006, NFR-003, C-005, C-008) —
-- pgTAP, écrit à la main. Sous chaque rôle (SET ROLE) : listes EXACTES des fonctions de la mission exécutables par rôle,
-- écritures directes refusées à cashless_app, droits de colonne exacts, contrôles positifs, rôle cashless_pin.
-- A FAIRE RELIRE PAR UNE PERSONNE : les listes attendues ci-dessous sont la source de vérité des droits de la mission.
-- Lancer : pg_prove -d <base> tests/tests_11a_rights.sql (base créée par les migrations, roles.sql et post-roles.sql
-- rejoués).
-- Mutations (NFR-004), rejouées à la main à la livraison : voir la note de lane de WP03 (identifiants des tests).
\set ON_ERROR_STOP 1
\set QUIET 1
BEGIN;
\ir _grants_for_tests.sql
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

CREATE FUNCTION pg_temp.id(p text) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT ('00000000-0000-0000-0000-' || lpad(p, 12, '0'))::uuid $$;
-- Résultat d'une instruction : NULL si elle passe, sinon le SQLSTATE.
CREATE FUNCTION pg_temp.code(p text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE p; RETURN NULL; EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE; END $$;
CREATE FUNCTION pg_temp.a() RETURNS void LANGUAGE sql AS
  $$ SELECT set_config('app.operator_id', pg_temp.id('11a001')::text, true) $$;

-- 1. Données (propriétaire) : un prestataire, son événement, un bracelet, un lot, un terminal et sa clé App Attest ---
INSERT INTO party (kind, legal_name) SELECT 'PLATFORM', 'Plateforme (test)'
 WHERE NOT EXISTS (SELECT 1 FROM party WHERE kind = 'PLATFORM');
INSERT INTO party (id, kind, legal_name, country_code) VALUES (pg_temp.id('11a001'), 'OPERATOR', 'Prestataire A', 'SN');
INSERT INTO party (id, kind, operator_id, legal_name) VALUES
 (pg_temp.id('11b001'), 'ORGANIZER', pg_temp.id('11a001'), 'Organisateur A'),
 (pg_temp.id('11b101'), 'MERCHANT', pg_temp.id('11a001'), 'Commerçant A');
INSERT INTO jurisdiction_profile (id, country_code, version, valid_from, breakage_destination)
VALUES (pg_temp.id('11c001'), 'SN', 110011, '2026-01-01', 'ORGANIZER');
INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone, jurisdiction_id, funds_holder, status)
VALUES (pg_temp.id('11d001'), pg_temp.id('11a001'), pg_temp.id('11b001'), 'Événement A', 'XOF', 'Africa/Dakar',
        pg_temp.id('11c001'), 'ORGANIZER', 'LIVE');
INSERT INTO merchant_participation (id, operator_id, event_id, merchant_id, link_type, payout_to)
VALUES (pg_temp.id('11f001'), pg_temp.id('11a001'), pg_temp.id('11d001'), pg_temp.id('11b101'), 'INTERNAL',
        pg_temp.id('11b001'));
INSERT INTO point_of_sale (id, operator_id, participation_id, name)
VALUES (pg_temp.id('11f101'), pg_temp.id('11a001'), pg_temp.id('11f001'), 'Bar A');
INSERT INTO app_user (id, operator_id, issuer, subject, email, display_name)
VALUES (pg_temp.id('11e001'), pg_temp.id('11a001'), 'https://idp.test', 's11a1', 'u@test', 'Personne A');
INSERT INTO role_assignment (user_id, role, scope_type, scope_id, granted_by)
VALUES (pg_temp.id('11e001'), 'OPERATOR_ADMIN', 'OPERATOR', pg_temp.id('11a001'), NULL);
INSERT INTO device (id, operator_id, kind, app_mode, event_id, pos_id, serial, status)
VALUES (pg_temp.id('11aa01'), pg_temp.id('11a001'), 'POS', 'KEYPAD_TPE', pg_temp.id('11d001'),
        pg_temp.id('11f101'), 'P11-AA01', 'ACTIVE');
INSERT INTO device_app_attest_key (device_id, operator_id, key_id, public_key)
VALUES (pg_temp.id('11aa01'), pg_temp.id('11a001'), sha256('cle 11a'), '\x3059');
INSERT INTO tag_key (operator_id, key_index, kms_key_ref, status) VALUES (pg_temp.id('11a001'), 1, 'test:hmac-11a', 'ACTIVE');
INSERT INTO ledger (id, operator_id, scope_type, scope_id, currency, issuer_id, funds_holder_id)
VALUES (pg_temp.id('11cc01'), pg_temp.id('11a001'), 'EVENT', pg_temp.id('11d001'), 'XOF', pg_temp.id('11b001'),
        pg_temp.id('11b001'));
INSERT INTO wallet (id, operator_id, ledger_id) VALUES (pg_temp.id('11cb01'), pg_temp.id('11a001'), pg_temp.id('11cc01'));
INSERT INTO media (id, operator_id, kind, token_hash, nfc_uid, wallet_id, status)
VALUES (pg_temp.id('11d9001'), pg_temp.id('11a001'), 'NFC_TAG', sha256('\x11a001'::bytea), '\x04110000000001',
        pg_temp.id('11cb01'), 'ACTIVE');
INSERT INTO media_batch (id, operator_id, organizer_id, kind, quantity, key_index)
VALUES (pg_temp.id('11b9001'), pg_temp.id('11a001'), pg_temp.id('11b001'), 'PUBLIC', 5, 1);
-- Vendeur, créé en propriétaire (create_vendor reste à cashless_app, le processus vendor-pin ne fait que hacher).
SELECT pg_temp.a();
SELECT set_config('t11a.vendor', create_vendor(pg_temp.id('11b101'), 'Vendeur A',
  '$argon2id$v=19$m=19456,t=2,p=1$c2VsMDA1Mg$djE', pg_temp.id('11e001'))::text, true);

-- 2. Listes exactes des fonctions de la mission, par rôle (la suite échoue si l'une s'élargit) ----------------------------
-- Pour chaque rôle cashless_* et PUBLIC : les fonctions de la mission exécutables, nommées une à une.
CREATE TEMP TABLE m11a (sig text PRIMARY KEY);
INSERT INTO m11a VALUES
 ('create_media_batch(uuid,uuid,text,integer,integer,text,bigint,bigint,text,text,text,uuid)'),
 ('update_media_batch(uuid,jsonb,uuid)'), ('set_media_batch_status(uuid,text,text,uuid)'),
 ('media_set_status(uuid,text,text,uuid)'), ('issue_claim_codes(uuid,bytea[],smallint)'),
 ('advance_app_attest_counter(uuid,bytea,bigint)'),
 ('enroll_device(bytea,text,text,text,bytea,bytea,bytea,timestamptz,text,text,bytea,timestamptz,uuid,bytea,bytea)'),
 ('begin_vendor_pin_check(uuid,uuid)'), ('open_vendor_session(uuid,uuid)'),
 ('refund_deposit(uuid,uuid)'), ('refund_request_insert_guard()'),
 ('register_edge_gateway(uuid,uuid,text,text,bytea,bytea,bytea,text,text)');
SELECT is((SELECT count(*)::int FROM m11a WHERE to_regprocedure(sig) IS NULL), 0,
  'les douze signatures de la mission existent (aucune faute de frappe dans les listes)');
CREATE TEMP TABLE r11a (r text PRIMARY KEY);
INSERT INTO r11a SELECT rolname::text FROM pg_roles WHERE rolname LIKE 'cashless\_%' UNION SELECT 'public';
SELECT is((SELECT count(*)::int FROM r11a WHERE r = 'cashless_pin'), 1, 'cashless_pin existe');
-- Pour tous les rôles, y compris cashless_edgeadmin (register_edge_gateway) : couples (rôle, fonction) exécutables.
SELECT set_eq(
  $q$SELECT r || ' ' || sig FROM r11a, m11a WHERE has_function_privilege(r, to_regprocedure(sig), 'EXECUTE')$q$,
  $q$VALUES
    ('cashless_app create_media_batch(uuid,uuid,text,integer,integer,text,bigint,bigint,text,text,text,uuid)'),
    ('cashless_app update_media_batch(uuid,jsonb,uuid)'),
    ('cashless_app set_media_batch_status(uuid,text,text,uuid)'),
    ('cashless_app media_set_status(uuid,text,text,uuid)'),
    ('cashless_app issue_claim_codes(uuid,bytea[],smallint)'),
    ('cashless_app advance_app_attest_counter(uuid,bytea,bigint)'),
    ('cashless_app enroll_device(bytea,text,text,text,bytea,bytea,bytea,timestamptz,text,text,bytea,timestamptz,uuid,bytea,bytea)'),
    ('cashless_pin begin_vendor_pin_check(uuid,uuid)'),
    ('cashless_pin open_vendor_session(uuid,uuid)'),
    ('cashless_edgeadmin register_edge_gateway(uuid,uuid,text,text,bytea,bytea,bytea,text,text)')$q$,
  'fonctions de la mission : liste exacte par rôle (cashless_app, cashless_pin, cashless_edgeadmin ; aucun autre, PUBLIC non)');
SELECT is((SELECT count(*)::int FROM r11a, m11a
            WHERE sig IN ('refund_deposit(uuid,uuid)', 'refund_request_insert_guard()')
              AND has_function_privilege(r, to_regprocedure(sig), 'EXECUTE')), 0,
  'refund_deposit(uuid,uuid) et refund_request_insert_guard() : exécutables par aucun rôle cashless_* ni PUBLIC');
SELECT is((SELECT count(*)::int FROM pg_proc WHERE proname = 'refund_deposit_for_session' AND pronargs = 2), 0,
  'refund_deposit_for_session(uuid,uuid) : retirée');
SELECT is((SELECT count(*)::int FROM pg_proc WHERE proname = 'enroll_device'), 1,
  'enroll_device : une seule signature (l''ancienne à 13 arguments est retirée)');
-- cashless_pin : exactement deux fonctions de public, sur tout le schéma (pas seulement la mission).
SELECT is((SELECT array_agg(p.oid::regprocedure::text ORDER BY p.oid::regprocedure::text)
             FROM pg_proc p
            WHERE p.pronamespace = 'public'::regnamespace
              AND NOT EXISTS (SELECT 1 FROM pg_depend e WHERE e.classid = 'pg_proc'::regclass
                                 AND e.objid = p.oid AND e.deptype = 'e')
              AND has_function_privilege('cashless_pin', p.oid, 'EXECUTE')),
  ARRAY['begin_vendor_pin_check(uuid,uuid)', 'open_vendor_session(uuid,uuid)'],
  'cashless_pin : exactement begin_vendor_pin_check et open_vendor_session sur tout le schéma');
-- Fonctions de la mission : SECURITY DEFINER avec search_path fixé (la section 4 de tests_definer_trigger_writers le
-- vérifie pour tout le schéma ; ici les nouvelles fonctions nommément).
SELECT is((SELECT count(*)::int FROM pg_proc WHERE proname IN ('create_media_batch', 'update_media_batch',
  'advance_app_attest_counter') AND prosecdef AND proconfig @> ARRAY['search_path=public, pg_temp']), 3,
  'create_media_batch, update_media_batch, advance_app_attest_counter : DEFINER, search_path = public, pg_temp');

-- 3. Droits de table de cashless_app : exacts --------------------------------------------------------------------------
SELECT is((SELECT array_agg(a.attname::text ORDER BY a.attname) FROM pg_attribute a
            WHERE a.attrelid = 'refund_request'::regclass AND a.attnum > 0 AND NOT a.attisdropped
              AND has_column_privilege('cashless_app', 'refund_request', a.attname, 'INSERT')),
  ARRAY['currency','customer_id','estimated_amount','event_id','extra_check_required','fee','hold_until','iban',
        'ledger_id','method','msisdn','new_number','operator_id','requested_by','status','wallet_id'],
  'refund_request : INSERT de cashless_app sur exactement les seize colonnes écrites par l''API');
SELECT ok(NOT has_column_privilege('cashless_app', 'refund_request', c, 'INSERT'),
  'refund_request.' || c || ' : INSERT refusé à cashless_app')
  FROM unnest(ARRAY['approved_by','external_reference','holder_decision','transaction_id','failure_reason',
                    'reject_reason','confirmed_by','confirmed_at','approval_request_id','id']) c;
SELECT is((SELECT count(*)::int FROM unnest(ARRAY['INSERT','UPDATE']) p
            WHERE has_any_column_privilege('cashless_app', 'media_batch', p)), 0,
  'media_batch : aucun INSERT ni UPDATE (colonne comprise) pour cashless_app');
SELECT ok(has_table_privilege('cashless_app', 'media_batch', 'SELECT'), 'media_batch : lecture conservée');
SELECT is((SELECT array_agg(a.attname::text ORDER BY a.attname) FROM pg_attribute a
            WHERE a.attrelid = 'media'::regclass AND a.attnum > 0 AND NOT a.attisdropped
              AND has_column_privilege('cashless_app', 'media', a.attname, 'UPDATE')),
  ARRAY['claim_attempts','claim_code_used_at'], 'media : UPDATE de cashless_app sur ces deux colonnes seulement');
SELECT is((SELECT count(*)::int FROM r11a, unnest(ARRAY['INSERT','UPDATE','DELETE','TRUNCATE']) p
            WHERE has_table_privilege(r, 'device_app_attest_key', p)
               OR (p IN ('INSERT','UPDATE') AND has_any_column_privilege(r, 'device_app_attest_key', p))), 0,
  'device_app_attest_key : aucun droit d''écriture (colonne comprise) pour aucun rôle cashless_* ni PUBLIC');
SELECT is((SELECT count(*)::int FROM r11a WHERE has_table_privilege(r, 'device_app_attest_key', 'INSERT')
              OR has_table_privilege(r, 'device_app_attest_key', 'UPDATE')), 0,
  'device_app_attest_key : ni INSERT ni UPDATE pour aucun rôle ni PUBLIC');
SELECT ok(has_table_privilege('cashless_app', 'device_app_attest_key', 'SELECT'),
  'device_app_attest_key : SELECT conservé pour cashless_app');

-- 4. Sous cashless_app : refus réels --------------------------------------------------------------------------------------
SET LOCAL ROLE cashless_app;
SELECT pg_temp.a();
SELECT is(pg_temp.code(format($q$INSERT INTO media_batch (operator_id, organizer_id, kind, quantity, key_index, status)
  VALUES (%L, %L, 'PUBLIC', 1, 1, %L)$q$, pg_temp.id('11a001'), pg_temp.id('11b001'), s)), '42501',
  'cashless_app : INSERT d''un lot ' || s || ' refusé')
  FROM unnest(ARRAY['ORDERED', 'ACTIVE', 'CLOSED']) s;
SELECT is(pg_temp.code(format('UPDATE media_batch SET %s WHERE id = %L', c, pg_temp.id('11b9001'))), '42501',
  'cashless_app : UPDATE media_batch SET ' || split_part(c, ' =', 1) || ' refusé')
  FROM unnest(ARRAY['status = ''CLOSED''', 'quantity = 99', 'key_index = 2',
                    format('organizer_id = %L', pg_temp.id('11b001')), format('event_id = %L', pg_temp.id('11d001'))]) c;
SELECT is(pg_temp.code(format('SELECT id FROM media_batch WHERE id = %L FOR UPDATE', pg_temp.id('11b9001'))), '42501',
  'cashless_app : SELECT ... FROM media_batch FOR UPDATE refusé');
SELECT is(pg_temp.code(format('UPDATE media SET status = ''ISSUED'' WHERE id = %L', pg_temp.id('11d9001'))), '42501',
  'cashless_app : UPDATE media SET status refusé');
SELECT is(pg_temp.code(format($q$INSERT INTO refund_request (operator_id, ledger_id, event_id, wallet_id, method, msisdn,
  new_number, status, estimated_amount, fee, currency, hold_until, %I) VALUES (%L, %L, %L, %L, 'WAVE', '+221770000011',
  false, 'AWAITING_HOLDER', 1, 0, 'XOF', now(), %L)$q$, c, pg_temp.id('11a001'), pg_temp.id('11cc01'),
  pg_temp.id('11d001'), pg_temp.id('11cb01'), CASE c WHEN 'approved_by' THEN pg_temp.id('11e001')::text ELSE 'x' END)),
  '42501', 'cashless_app : INSERT refund_request avec ' || c || ' refusé (droit de colonne)')
  FROM unnest(ARRAY['approved_by', 'external_reference']) c;
SELECT is(pg_temp.code(format('UPDATE device_app_attest_key SET counter = 99 WHERE device_id = %L', pg_temp.id('11aa01'))),
  '42501', 'cashless_app : UPDATE device_app_attest_key refusé');
SELECT is(pg_temp.code(format($q$INSERT INTO device_app_attest_key (device_id, operator_id, key_id, public_key)
  VALUES (%L, %L, sha256('autre'), '\x3059')$q$, pg_temp.id('11aa01'), pg_temp.id('11a001'))), '42501',
  'cashless_app : INSERT device_app_attest_key refusé');
SELECT is(pg_temp.code(format('DELETE FROM device_app_attest_key WHERE device_id = %L', pg_temp.id('11aa01'))), '42501',
  'cashless_app : DELETE device_app_attest_key refusé');
SELECT is(pg_temp.code(format('SELECT * FROM begin_vendor_pin_check(%L, %L)', current_setting('t11a.vendor')::uuid,
  pg_temp.id('11aa01'))), '42501', 'cashless_app : begin_vendor_pin_check refusée');
SELECT is(pg_temp.code(format('SELECT * FROM open_vendor_session(%L, %L)', gen_random_uuid(), pg_temp.id('11aa01'))),
  '42501', 'cashless_app : open_vendor_session refusée');
SELECT is(pg_temp.code(format('SELECT refund_deposit(%L, %L)', gen_random_uuid(), gen_random_uuid())), '42501',
  'cashless_app : refund_deposit(uuid,uuid) refusée');
SELECT is(pg_temp.code(format('SELECT refund_deposit(%L, %L, %L, %L)', gen_random_uuid(), gen_random_uuid(),
  gen_random_uuid(), gen_random_uuid())), '42501', 'cashless_app : refund_deposit (quatre arguments) refusée');
-- Contrôles positifs : les trois EXECUTE ajoutés et les droits conservés
SELECT is(pg_temp.code(format($q$SELECT create_media_batch(%L, NULL, 'PUBLIC', 10, 1, 'ref-11a', 0, 0, NULL, 'SHARED',
  'SINGLE_USE', %L)$q$, pg_temp.id('11b001'), pg_temp.id('11e001'))), NULL,
  'positif : create_media_batch exécutable par cashless_app');
SELECT is((SELECT status FROM media_batch WHERE print_order_ref = 'ref-11a'), 'ORDERED',
  'positif : le lot créé par create_media_batch est ORDERED');
SELECT is(pg_temp.code(format($q$SELECT update_media_batch(%L, '{"quantity": 7}'::jsonb, %L)$q$, pg_temp.id('11b9001'),
  pg_temp.id('11e001'))), NULL, 'positif : update_media_batch exécutable par cashless_app');
SELECT is(pg_temp.code(format($q$SELECT media_set_status(%L, 'BLACKLISTED', 'motif', %L)$q$, pg_temp.id('11d9001'),
  pg_temp.id('11e001'))), NULL, 'positif : media_set_status(..., ''BLACKLISTED'', ...) exécutable');
SELECT is((SELECT status FROM media WHERE id = pg_temp.id('11d9001')), 'BLACKLISTED', 'positif : statut posé par la fonction');
SELECT is(advance_app_attest_counter(pg_temp.id('11aa01'), sha256('cle 11a'), 3), true,
  'positif : advance_app_attest_counter exécutable par cashless_app');
SELECT is(pg_temp.code('UPDATE media SET claim_attempts = claim_attempts'), NULL,
  'positif : UPDATE media SET claim_attempts (colonne conservée)');
RESET ROLE;

-- 5. Sous cashless_pin ---------------------------------------------------------------------------------------------------
SET LOCAL ROLE cashless_pin;
SELECT pg_temp.a();
SELECT is(pg_temp.code(format($q$SELECT set_config('t11a.check', (SELECT check_id FROM begin_vendor_pin_check(%L, %L))::text,
  true)$q$, current_setting('t11a.vendor')::uuid, pg_temp.id('11aa01'))), NULL,
  'cashless_pin : begin_vendor_pin_check s''appelle sur une fixture');
SELECT is(pg_temp.code(format('SELECT * FROM open_vendor_session(%L, %L)', current_setting('t11a.check')::uuid,
  pg_temp.id('11aa01'))), NULL, 'cashless_pin : open_vendor_session s''appelle sur une fixture');
SELECT is(pg_temp.code('SELECT * FROM ' || t), '42501', 'cashless_pin : SELECT sur ' || t || ' refusé')
  FROM unnest(ARRAY['vendor', 'vendor_session', 'vendor_pin_check', 'media', 'journal_transaction']) t;
SELECT is(pg_temp.code('SELECT pin_hash FROM vendor'), '42501', 'cashless_pin : pin_hash illisible');
SELECT is(pg_temp.code(format('SELECT create_vendor(%L, ''x'', ''y'', %L)', pg_temp.id('11b101'), pg_temp.id('11e001'))),
  '42501', 'cashless_pin : create_vendor refusée');
SELECT is(pg_temp.code(format('SELECT set_vendor_pin(%L, ''x'', %L)', current_setting('t11a.vendor')::uuid,
  pg_temp.id('11e001'))), '42501', 'cashless_pin : set_vendor_pin refusée');
SELECT is(pg_temp.code(format($q$SELECT * FROM enroll_device('\x00', 's', 'IOS', '1', '\x00', '\x00', '\x00', now(),
  'a', 'b', '\x00', now(), NULL, NULL, NULL)$q$)), '42501', 'cashless_pin : enroll_device refusée');
-- Audit des essais de PIN : l'insertion passe (RLS tenant_isolation, prestataire de session), la ligne est lisible
-- par ce rôle sous la même RLS.
SELECT is(pg_temp.code(format($q$INSERT INTO audit_log (operator_id, action, object_type, object_id, origin)
  VALUES (%L, 'VENDOR_PIN_FAILED', 'vendor', 'x', 'test')$q$, pg_temp.id('11a001'))), NULL,
  'cashless_pin : INSERT audit_log VENDOR_PIN_FAILED accepté (RLS comprise)');
SELECT is(pg_temp.code(format($q$INSERT INTO audit_log (operator_id, action, object_type, object_id, origin)
  VALUES (%L, 'VENDOR_PIN_FAILED', 'vendor', 'x', 'test')$q$, pg_temp.id('11a999'))), '42501',
  'cashless_pin : INSERT audit_log pour un autre prestataire refusé (RLS)');
SELECT is(pg_temp.code('UPDATE audit_log SET action = ''X'''), '42501', 'cashless_pin : UPDATE audit_log refusé');
SELECT is(pg_temp.code('DELETE FROM audit_log'), '42501', 'cashless_pin : DELETE audit_log refusé');
RESET ROLE;

-- 6. Rejeu de post-roles.sql : mêmes droits (idempotent) ----------------------------------------------------------------
CREATE TEMP TABLE w11a_before AS
  SELECT r, sig, has_function_privilege(r, to_regprocedure(sig), 'EXECUTE') AS x FROM r11a, m11a;
SET LOCAL client_min_messages = warning;
\ir ../roles.sql
\ir ../post-roles.sql
SELECT is((SELECT count(*)::int FROM w11a_before b
            WHERE b.x IS DISTINCT FROM has_function_privilege(b.r, to_regprocedure(b.sig), 'EXECUTE')), 0,
  'rejeu de roles.sql puis post-roles.sql : droits des fonctions de la mission inchangés');
SELECT is((SELECT array_agg(a.attname::text ORDER BY a.attname) FROM pg_attribute a
            WHERE a.attrelid = 'media'::regclass AND a.attnum > 0 AND NOT a.attisdropped
              AND has_column_privilege('cashless_app', 'media', a.attname, 'UPDATE')),
  ARRAY['claim_attempts','claim_code_used_at'], 'rejeu : media UPDATE de cashless_app inchangé (deux colonnes)');
SELECT is((SELECT count(*)::int FROM unnest(ARRAY['INSERT','UPDATE']) p
            WHERE has_any_column_privilege('cashless_app', 'media_batch', p)), 0,
  'rejeu : media_batch sans INSERT ni UPDATE pour cashless_app');

SELECT * FROM finish();
ROLLBACK;
