-- Clé App Attest et compteur (migration 0095 ; mission durcissements-serveur, lot WP02 ; FR-020) — pgTAP, écrit à
-- la main. Propriétaire seulement (les droits de cashless_app sont à WP03). Une session pgTAP ne prouve pas la
-- concurrence : le verrou de ligne de l'UPDATE conditionnel est prouvé par le refus séquentiel du compteur égal.
-- Lancer depuis packages/ledger-sql : pg_prove -d <base> tests/tests_device_app_attest.sql
\set ON_ERROR_STOP 1
\set QUIET 1
BEGIN;
\ir _grants_for_tests.sql
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

CREATE FUNCTION pg_temp.id(p text) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT ('00000000-0000-0000-0000-' || lpad(p, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.h(p text) RETURNS bytea LANGUAGE sql IMMUTABLE AS
  $$ SELECT sha256(convert_to('0095 ' || p, 'UTF8')) $$;
CREATE FUNCTION pg_temp.a() RETURNS void LANGUAGE sql AS
  $$ SELECT set_config('app.operator_id', pg_temp.id('95a001')::text, true) $$;
CREATE FUNCTION pg_temp.b() RETURNS void LANGUAGE sql AS
  $$ SELECT set_config('app.operator_id', pg_temp.id('95a002')::text, true) $$;

INSERT INTO party (kind, legal_name) SELECT 'PLATFORM', 'Plateforme (test)'
 WHERE NOT EXISTS (SELECT 1 FROM party WHERE kind = 'PLATFORM');
INSERT INTO party (id, kind, legal_name, country_code) VALUES
 (pg_temp.id('95a001'), 'OPERATOR', 'Prestataire A', 'SN'),
 (pg_temp.id('95a002'), 'OPERATOR', 'Prestataire B', 'SN');
INSERT INTO party (id, kind, operator_id, legal_name) VALUES
 (pg_temp.id('95b001'), 'ORGANIZER', pg_temp.id('95a001'), 'Organisateur A'),
 (pg_temp.id('95b002'), 'ORGANIZER', pg_temp.id('95a002'), 'Organisateur B');
INSERT INTO jurisdiction_profile (id, country_code, version, valid_from, breakage_destination)
VALUES (pg_temp.id('95c001'), 'SN', 950095, '2026-01-01', 'ORGANIZER');
INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone, jurisdiction_id, funds_holder, status)
VALUES (pg_temp.id('95d001'), pg_temp.id('95a001'), pg_temp.id('95b001'), 'Événement A', 'XOF', 'Africa/Dakar',
        pg_temp.id('95c001'), 'ORGANIZER', 'LIVE'),
       (pg_temp.id('95d002'), pg_temp.id('95a002'), pg_temp.id('95b002'), 'Événement B', 'XOF', 'Africa/Dakar',
        pg_temp.id('95c001'), 'ORGANIZER', 'LIVE');
INSERT INTO app_user (id, operator_id, issuer, subject, email, display_name)
VALUES (pg_temp.id('95e001'), pg_temp.id('95a001'), 'https://idp.test', 's0095a', 'a@test', 'Personne A'),
       (pg_temp.id('95e002'), pg_temp.id('95a002'), 'https://idp.test', 's0095b', 'b@test', 'Personne B');
INSERT INTO role_assignment (user_id, role, scope_type, scope_id, granted_by) VALUES
 (pg_temp.id('95e001'), 'OPERATOR_ADMIN', 'OPERATOR', pg_temp.id('95a001'), NULL);

-- Code d'enrôlement (CATALOG_POS ; TOPUP_DESK est refusé sur iOS)
CREATE FUNCTION pg_temp.code(p_code text, p_op text, p_event text, p_user text) RETURNS void LANGUAGE sql AS $$
  INSERT INTO device_enrollment_code (operator_id, code_hash, event_id, app_mode, personal_phone, created_by,
                                      created_at, expires_at)
  VALUES (pg_temp.id(p_op), pg_temp.h('code ' || p_code), pg_temp.id(p_event), 'CATALOG_POS', false,
          pg_temp.id(p_user), now(), now() + interval '1 day')
$$;
-- Enrôlement : 13 arguments par position si p_key IS NULL AND NOT p_pair, sinon 15 (texte SQL).
CREATE FUNCTION pg_temp.enroll_sql(p_code text, p_serial text, p_os text, p_key text DEFAULT NULL,
                                   p_pub text DEFAULT NULL) RETURNS text LANGUAGE sql AS $$
  SELECT format($q$SELECT * FROM enroll_device(%L, %L, %L, '1.0.0', %L, %L, %L, now() + interval '365 days',
                    %L, %L, %L, now() + interval '30 days'%s)$q$,
                pg_temp.h('code ' || p_code), p_serial, p_os,
                decode(repeat('ab', 91), 'hex'), decode('04' || repeat('cd', 64), 'hex'),
                pg_temp.h('cert ' || p_code),
                CASE p_os WHEN 'ANDROID' THEN 'ANDROID_KEY_ATTESTATION' ELSE 'IOS_APP_ATTEST' END,
                CASE p_os WHEN 'ANDROID' THEN 'STRONGBOX' END,
                pg_temp.h('refresh ' || p_code),
                CASE WHEN p_key IS NULL AND p_pub IS NULL THEN ''
                     ELSE format(', NULL, %s, %s', coalesce(quote_literal(p_key), 'NULL'),
                                 coalesce(quote_literal(p_pub), 'NULL')) END)
$$;
CREATE FUNCTION pg_temp.dev(p_serial text) RETURNS uuid LANGUAGE sql AS
  $$ SELECT id FROM device WHERE serial = p_serial $$;
CREATE FUNCTION pg_temp.kid(p text) RETURNS text LANGUAGE sql IMMUTABLE AS
  $$ SELECT '\x' || encode(pg_temp.h('key ' || p), 'hex') $$;

SELECT pg_temp.code(c, '95a001', '95d001', '95e001')
  FROM unnest(ARRAY['ios1', 'ios2', 'ios3', 'ios4', 'and1', 'and2', 'old1', 'dup1', 'half1', 'half2', 'badk',
                    'ios5']) c;
SELECT pg_temp.code('bb1', '95a002', '95d002', '95e002');
SELECT pg_temp.a();

-- 1. Signature et propriétés
SELECT is((SELECT count(*)::int FROM pg_proc WHERE proname = 'enroll_device'), 1,
  'une seule signature d''enroll_device dans pg_proc (aucune surcharge)');
SELECT is((SELECT pronargs::int FROM pg_proc WHERE proname = 'enroll_device'), 15, 'enroll_device : 15 arguments');
SELECT ok((SELECT pg_get_function_arguments(oid) FROM pg_proc WHERE proname = 'enroll_device')
          LIKE '%p_device_id uuid DEFAULT NULL::uuid, p_app_attest_key_id bytea DEFAULT NULL::bytea, '
               'p_app_attest_public_key bytea DEFAULT NULL::bytea',
  'enroll_device : trois derniers arguments facultatifs');
SELECT is((SELECT pg_get_function_result(oid) FROM pg_proc WHERE proname = 'enroll_device'),
  'TABLE(device_id uuid, next_seq bigint)', 'enroll_device rend toujours (device_id, next_seq)');
SELECT ok((SELECT prosecdef AND proconfig = ARRAY['search_path=public, pg_temp'] FROM pg_proc
            WHERE proname = 'enroll_device'), 'enroll_device : SECURITY DEFINER, search_path public, pg_temp');
SELECT ok((SELECT prosecdef AND proconfig = ARRAY['search_path=public, pg_temp'] FROM pg_proc
            WHERE proname = 'advance_app_attest_counter'),
  'advance_app_attest_counter : SECURITY DEFINER, search_path public, pg_temp');
SELECT ok(NOT has_function_privilege('public', 'advance_app_attest_counter(uuid,bytea,bigint)', 'EXECUTE'),
  'advance_app_attest_counter : non exécutable par PUBLIC');
SELECT ok(NOT has_function_privilege('public', (SELECT oid FROM pg_proc WHERE proname = 'enroll_device'), 'EXECUTE'),
  'enroll_device : non exécutable par PUBLIC');
SELECT is((SELECT relrowsecurity::text || relforcerowsecurity::text FROM pg_class
            WHERE relname = 'device_app_attest_key'), 'truetrue', 'device_app_attest_key : RLS activée et forcée');

-- 2. Enrôlement
SELECT lives_ok(pg_temp.enroll_sql('ios1', 'IOS-1', 'IOS', pg_temp.kid('1'), '\x3059301306072a8648ce3d0201'),
  'iOS avec clé : enrôlé');
SELECT is((SELECT count(*)::int FROM device_app_attest_key WHERE device_id = pg_temp.dev('IOS-1')), 1,
  'ligne device_app_attest_key créée');
SELECT is((SELECT counter FROM device_app_attest_key WHERE device_id = pg_temp.dev('IOS-1')), 0::bigint,
  'counter = 0');
SELECT is((SELECT octet_length(key_id) FROM device_app_attest_key WHERE device_id = pg_temp.dev('IOS-1')), 32,
  'key_id de 32 octets');
SELECT is((SELECT operator_id FROM device_app_attest_key WHERE device_id = pg_temp.dev('IOS-1')),
  pg_temp.id('95a001'), 'operator_id de la ligne = prestataire du code');
SELECT lives_ok(pg_temp.enroll_sql('ios2', 'IOS-2', 'IOS'), 'iOS sans clé (13 arguments par position) : enrôlé');
SELECT is((SELECT count(*)::int FROM device_app_attest_key WHERE device_id = pg_temp.dev('IOS-2')), 0,
  'sans clé : aucune ligne');
SELECT lives_ok(pg_temp.enroll_sql('and1', 'AND-1', 'ANDROID'), 'Android à 13 arguments : enrôlé');
SELECT throws_ok(pg_temp.enroll_sql('and2', 'AND-2', 'ANDROID', pg_temp.kid('2'), '\x3059'), 'CL001', NULL,
  'clé App Attest pour Android : CL001');
SELECT is((SELECT count(*)::int FROM device WHERE serial = 'AND-2'), 0, 'Android refusé : appareil non créé');
SELECT is((SELECT used_at IS NULL FROM device_enrollment_code WHERE code_hash = pg_temp.h('code and2')), true,
  'Android refusé : code non consommé');
SELECT throws_ok(pg_temp.enroll_sql('half1', 'HALF-1', 'IOS', pg_temp.kid('3'), NULL), 'CL001', NULL,
  'identifiant sans clé publique : CL001');
SELECT throws_ok(pg_temp.enroll_sql('half2', 'HALF-2', 'IOS', NULL, '\x3059'), 'CL001', NULL,
  'clé publique sans identifiant : CL001');
SELECT throws_ok(pg_temp.enroll_sql('badk', 'BADK', 'IOS', '\xabcd', '\x3059'), 'CL001', NULL,
  'identifiant de 2 octets : CL001');
SELECT throws_ok(pg_temp.enroll_sql('badk', 'BADK', 'IOS', pg_temp.kid('4'), '\x'), 'CL001', NULL,
  'clé publique vide : CL001');
SELECT is((SELECT count(*)::int FROM device WHERE serial IN ('HALF-1', 'HALF-2', 'BADK')), 0,
  'refus : aucun appareil créé');
SELECT throws_ok(pg_temp.enroll_sql('dup1', 'DUP-1', 'IOS', pg_temp.kid('1'), '\x3059'), '23505', NULL,
  'key_id déjà pris : 23505');
SELECT is((SELECT count(*)::int FROM device WHERE serial = 'DUP-1'), 0, 'key_id pris : enrôlement annulé en entier');
SELECT is((SELECT used_at IS NULL FROM device_enrollment_code WHERE code_hash = pg_temp.h('code dup1')), true,
  'key_id pris : code non consommé');

-- 3. advance_app_attest_counter
SELECT is(advance_app_attest_counter(pg_temp.dev('IOS-1'), pg_temp.h('key 1'), 5),
  true, 'compteur croissant : true');
SELECT is((SELECT counter FROM device_app_attest_key WHERE device_id = pg_temp.dev('IOS-1')), 5::bigint,
  'compteur avancé à 5');
SELECT is(advance_app_attest_counter(pg_temp.dev('IOS-1'), pg_temp.h('key 1'), 5), false,
  'même compteur rendu : false');
SELECT is(advance_app_attest_counter(pg_temp.dev('IOS-1'), pg_temp.h('key 1'), 4), false, 'compteur inférieur : false');
SELECT is((SELECT counter FROM device_app_attest_key WHERE device_id = pg_temp.dev('IOS-1')), 5::bigint,
  'compteur inchangé après les refus');
SELECT is(advance_app_attest_counter(pg_temp.dev('IOS-1'), pg_temp.h('key 1'), 6), true, 'compteur 6 : true');
SELECT is(advance_app_attest_counter(pg_temp.dev('IOS-1'), pg_temp.h('key 1'), 6), false,
  'deux appels de même compteur : un seul true');
SELECT is(advance_app_attest_counter(pg_temp.dev('IOS-1'), pg_temp.h('key wrong'), 99), false,
  'mauvais key_id : false, compteur inchangé');
SELECT is((SELECT counter FROM device_app_attest_key WHERE device_id = pg_temp.dev('IOS-1')), 6::bigint,
  'compteur toujours 6');
SELECT is(advance_app_attest_counter(pg_temp.dev('IOS-1'), pg_temp.h('key 1'), 4294967295), true,
  'borne haute 4294967295 acceptée');
SELECT throws_ok($$SELECT advance_app_attest_counter(pg_temp.dev('IOS-1'), pg_temp.h('key 1'), 4294967296)$$,
  'CL059', NULL, 'compteur 4294967296 : CL059');
SELECT throws_ok($$SELECT advance_app_attest_counter(pg_temp.dev('IOS-1'), pg_temp.h('key 1'), -1)$$,
  'CL059', NULL, 'compteur -1 : CL059');
SELECT throws_ok($$SELECT advance_app_attest_counter(pg_temp.dev('IOS-1'), pg_temp.h('key 1'), NULL)$$,
  'CL059', NULL, 'compteur NULL : CL059');
SELECT throws_ok($$SELECT advance_app_attest_counter(pg_temp.id('95ffff'), pg_temp.h('key 1'), 1)$$,
  'CL059', NULL, 'appareil introuvable : CL059');
-- Sans compteur de session
SELECT set_config('app.operator_id', '', true);
SELECT throws_ok($$SELECT advance_app_attest_counter(pg_temp.dev('IOS-1'), pg_temp.h('key 1'), 4294967295)$$,
  'CL059', NULL, 'sans prestataire de session : CL059');
-- Autre prestataire
SELECT pg_temp.b();
SELECT throws_ok($$SELECT advance_app_attest_counter(pg_temp.dev('IOS-1'), pg_temp.h('key 1'), 4294967295)$$,
  'CL059', NULL, 'appareil d''un autre prestataire : CL059');
SELECT pg_temp.a();
-- Appareil révoqué
SELECT lives_ok($$SELECT set_device_status(pg_temp.dev('IOS-1'), 'REVOKED', 'perdu', pg_temp.id('95e001'))$$,
  'appareil révoqué (set_device_status)');
SELECT throws_ok($$SELECT advance_app_attest_counter(pg_temp.dev('IOS-1'), pg_temp.h('key 1'), 4294967295)$$,
  'CL059', NULL, 'appareil REVOKED : CL059');

-- 4. RLS : sous un rôle non propriétaire, B ne voit rien de A
CREATE ROLE app_attest_probe NOLOGIN;
GRANT SELECT ON device_app_attest_key TO app_attest_probe;
SET LOCAL ROLE app_attest_probe;
SELECT set_config('app.operator_id', '00000000-0000-0000-0000-00000095a002', true);
SELECT is((SELECT count(*)::int FROM device_app_attest_key), 0, 'RLS : B ne voit aucune clé de A');
SELECT set_config('app.operator_id', '00000000-0000-0000-0000-00000095a001', true);
SELECT is((SELECT count(*)::int FROM device_app_attest_key), 1, 'RLS : A voit sa clé');
RESET ROLE;

-- 5. Mutation (NFR-004) : avec `k.counter <= p_counter`, « même compteur rendu : false » échoue (rend true)
SELECT lives_ok($$SELECT * FROM enroll_device(pg_temp.h('code ios3'), 'IOS-3', 'IOS', '1.0.0', decode(repeat('ab', 91), 'hex'),
  decode('04' || repeat('cd', 64), 'hex'), pg_temp.h('cert ios3'), now() + interval '365 days', 'IOS_APP_ATTEST', NULL,
  pg_temp.h('refresh ios3'), now() + interval '30 days', NULL, pg_temp.h('key 3'), '\x3059')$$, 'IOS-3 enrôlé');
SELECT is(advance_app_attest_counter(pg_temp.dev('IOS-3'), pg_temp.h('key 3'), 3), true, 'IOS-3 : compteur 3');
SELECT is(advance_app_attest_counter(pg_temp.dev('IOS-3'), pg_temp.h('key 3'), 3), false,
  'version d''origine : même compteur rendu : false');
DO $m$ BEGIN
  EXECUTE replace(pg_get_functiondef('advance_app_attest_counter(uuid,bytea,bigint)'::regprocedure),
                  'k.counter < p_counter', 'k.counter <= p_counter');
END $m$;
SELECT is(advance_app_attest_counter(pg_temp.dev('IOS-3'), pg_temp.h('key 3'), 3), true,
  'MUTATION : avec <=, le même compteur est rendu true (le test « false » ci-dessus mord)');

SELECT * FROM finish();
ROLLBACK;
