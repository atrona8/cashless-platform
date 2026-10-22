-- Limites d'enrôlement atomiques, clé d'adresse /64 en IPv6, limite nommée dans la trace
-- (migration 0030 ; mission identite-enrolement-terminaux, lot WP18 ; ADR-117 N-a, N-b, N-c) —
-- pgTAP, écrit à la main (pas un fichier généré).
-- Lancer : pg_prove -d <base> tests/tests_enrollment_limits.sql (base créée par les migrations,
-- roles.sql et post-roles.sql rejoués).
-- Les requêtes réellement simultanées sont prouvées par
-- apps/api/test/integration/devices/enrollment-limits.spec.ts ; ici, des refus appelés sans le
-- contrôle préalable de l'API jouent ceux d'une rafale qui l'a passé tout entière.
\set ON_ERROR_STOP 1
\set QUIET 1
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

CREATE FUNCTION pg_temp.id(p text) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT ('00000000-0000-0000-0000-' || lpad(p, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.h(p text) RETURNS bytea LANGUAGE sql IMMUTABLE AS
  $$ SELECT sha256(convert_to('0030 ' || p, 'UTF8')) $$;
CREATE FUNCTION pg_temp.refuse(p_code bytea, p_address text, p_result text) RETURNS boolean
LANGUAGE sql AS $$
  SELECT record_enrollment_refusal(p_code, p_address::inet, p_result, 'raison de test',
                                   'SER-0030', 'ANDROID', p_address,
                                   '00000000-0000-0000-0000-00000030ffff')
$$;
-- Refus écrits sous la clé d'adresse de p (propriétaire), résultat et limite.
CREATE FUNCTION pg_temp.traces(p text) RETURNS text[] LANGUAGE sql AS $$
  SELECT coalesce(array_agg(concat_ws(' ', after->>'result', after->>'limit', after->>'refusal')
                            ORDER BY id), '{}')
    FROM audit_log
   WHERE action = 'DEVICE_ENROLLMENT_REFUSED'
     AND enrollment_address_key((after->>'address')::inet) = enrollment_address_key(p::inet)
$$;

-- Données (propriétaire) : prestataire A et un code ouvert.
INSERT INTO party (kind, legal_name) SELECT 'PLATFORM', 'Plateforme (test)'
 WHERE NOT EXISTS (SELECT 1 FROM party WHERE kind = 'PLATFORM');
INSERT INTO party (id, kind, legal_name, country_code) VALUES
 (pg_temp.id('30a001'), 'OPERATOR', 'Prestataire A', 'SN');
INSERT INTO party (id, kind, operator_id, legal_name) VALUES
 (pg_temp.id('30b001'), 'ORGANIZER', pg_temp.id('30a001'), 'Organisateur A');
INSERT INTO jurisdiction_profile (id, country_code, version, valid_from, breakage_destination)
VALUES (pg_temp.id('30c001'), 'SN', 200030, '2026-01-01', 'ORGANIZER');
INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone, jurisdiction_id,
                   funds_holder)
VALUES (pg_temp.id('30d001'), pg_temp.id('30a001'), pg_temp.id('30b001'), 'Événement A', 'XOF',
        'Africa/Dakar', pg_temp.id('30c001'), 'ORGANIZER');
INSERT INTO app_user (id, operator_id, issuer, subject, email, display_name)
VALUES (pg_temp.id('30e001'), pg_temp.id('30a001'), 'https://idp.test', 's0030', 'e@test',
        'Admin A');
INSERT INTO device_enrollment_code (id, operator_id, code_hash, event_id, personal_phone,
                                    created_by, created_at, expires_at)
VALUES (pg_temp.id('30f001'), pg_temp.id('30a001'), pg_temp.h('fuité'), pg_temp.id('30d001'),
        false, pg_temp.id('30e001'), now(), now() + interval '1 day');

-- 1. Structure et droits --------------------------------------------------------------------------
SELECT ok(NOT has_function_privilege('public', 'enrollment_address_key(inet)', 'EXECUTE')
          AND NOT has_function_privilege('cashless_app', 'enrollment_address_key(inet)', 'EXECUTE'),
  'enrollment_address_key : interne, exécutable par aucun rôle de l''API');
SELECT is((SELECT attgenerated::text FROM pg_attribute
            WHERE attrelid = 'device_enrollment_attempt'::regclass AND attname = 'address_key'),
  's', 'essai : address_key est une colonne générée (stockée)');
SELECT ok(pg_get_indexdef('device_enrollment_attempt_address_key_idx'::regclass)
            LIKE '%(address_key, at)%',
  'essai : index (address_key, at)');
SELECT is(to_regclass('device_enrollment_attempt_address_idx'), NULL,
  'essai : ancien index (address, at) retiré');
SELECT ok(proconfig @> ARRAY['search_path=public, pg_temp'] AND prosecdef,
  f || ' : SECURITY DEFINER, search_path public, pg_temp')
  FROM unnest(ARRAY['enrollment_attempts_exceeded(bytea,inet)',
                    'record_enrollment_refusal(bytea,inet,text,text,text,text,text,uuid)']) f
  JOIN pg_proc p ON p.oid = f::regprocedure;

-- 2. Clé d'adresse (N-c) --------------------------------------------------------------------------
SELECT is(ARRAY(SELECT enrollment_address_key(a::inet)::text FROM unnest(ARRAY[
            '198.51.100.7', '::ffff:198.51.100.7', '2001:db8:30:1:aaaa:bbbb:cccc:dddd',
            '2001:db8:30:1::1', '2001:db8:30:2::1', '::1']) a),
  ARRAY['198.51.100.7/32', '198.51.100.7/32', '2001:db8:30:1::/64', '2001:db8:30:1::/64',
        '2001:db8:30:2::/64', '::/64'],
  'clé : IPv4 telle quelle, IPv4 en notation IPv6 ramenée à IPv4, IPv6 ramenée à son /64');
INSERT INTO device_enrollment_attempt (address, result)
SELECT a::inet, 'CODE_INVALID'
  FROM unnest(ARRAY['198.51.100.9', '::ffff:198.51.100.9', '2001:db8:30:9::5', '::1']) a;
SELECT is((SELECT count(*)::int FROM device_enrollment_attempt
            WHERE address IN ('198.51.100.9', '::ffff:198.51.100.9', '2001:db8:30:9::5', '::1')
              AND address_key IS DISTINCT FROM enrollment_address_key(address)), 0,
  'colonne générée : même clé que la fonction');

SET LOCAL ROLE cashless_app;
SELECT set_config('app.operator_id', '', true);

-- 3. Limite par adresse agrégée par /64 (N-c) -----------------------------------------------------
SELECT pg_temp.refuse(pg_temp.h('v6 ' || n), '2001:db8:30:1::' || to_hex(n), 'CODE_INVALID')
  FROM generate_series(1, 30) n;
SELECT is(enrollment_attempts_exceeded(pg_temp.h('v6 neuf'), '2001:db8:30:1:ffff::1'), true,
  'IPv6 : 30 refus depuis 30 adresses d''un même /64, une 31e adresse du /64 est limitée');
SELECT is(enrollment_attempts_exceeded(pg_temp.h('v6 neuf'), '2001:db8:30:2::1'), false,
  'IPv6 : un autre /64 n''est pas limité');
SELECT pg_temp.refuse(pg_temp.h('v4 ' || n), '198.51.100.' || n, 'CODE_INVALID')
  FROM generate_series(1, 30) n;
SELECT is(enrollment_attempts_exceeded(pg_temp.h('v4 neuf'), '198.51.100.31'), false,
  'IPv4 : pas d''agrégation, 30 adresses voisines ne limitent pas une 31e');
SELECT pg_temp.refuse(pg_temp.h('mappée ' || n), '::ffff:198.51.100.200', 'CODE_INVALID')
  FROM generate_series(1, 30) n;
SELECT is(enrollment_attempts_exceeded(pg_temp.h('v4 neuf'), '198.51.100.200'), true,
  'IPv4 en notation IPv6 : comptée sous son adresse IPv4');
SELECT is(enrollment_attempts_exceeded(pg_temp.h('v4 neuf'), '::ffff:198.51.100.201'), false,
  'IPv4 en notation IPv6 : jamais agrégée par /64 (un client IPv4 ne bloque pas les autres)');

-- 4. Limite franchie nommée (N-a) -----------------------------------------------------------------
SELECT is(pg_temp.refuse(NULL, '2001:db8:30:1::abcd', 'RATE_LIMITED'), true,
  'adresse limitée : la trace RATE_LIMITED est écrite');
SELECT is(pg_temp.refuse(pg_temp.h('code'), '10.30.4.' || n, 'CODE_INVALID'), true,
  'code : refus ' || n || ' écrit')
  FROM generate_series(1, 10) n;
SELECT is(pg_temp.refuse(pg_temp.h('code'), '10.30.4.99', 'RATE_LIMITED'), true,
  'code limité : la trace RATE_LIMITED est écrite');
-- Les deux limites franchies par le même essai.
SELECT pg_temp.refuse(pg_temp.h('double ' || (n % 2)), '10.30.5.1', 'CODE_INVALID')
  FROM generate_series(1, 20) n;
SELECT pg_temp.refuse(pg_temp.h('double ' || n), '10.30.5.1', 'CODE_INVALID')
  FROM generate_series(2, 11) n;
SELECT is(pg_temp.refuse(pg_temp.h('double 0'), '10.30.5.1', 'RATE_LIMITED'), true,
  'code et adresse limités : une trace');
RESET ROLE;
SELECT is((SELECT array_agg(after->>'limit' ORDER BY id) FROM audit_log
            WHERE action = 'DEVICE_ENROLLMENT_REFUSED' AND after->>'result' = 'RATE_LIMITED'
              AND after->>'address' IN ('2001:db8:30:1::abcd', '10.30.4.99', '10.30.5.1')),
  ARRAY['address', 'code', 'code,address'],
  'trace RATE_LIMITED : limit = address, code, ou code,address');
SELECT is((SELECT count(*)::int FROM audit_log
            WHERE action = 'DEVICE_ENROLLMENT_REFUSED' AND after->>'result' <> 'RATE_LIMITED'
              AND after ? 'limit' AND after->>'address' LIKE '10.30.%'), 0,
  'refus ordinaire : pas de champ limit');
SET LOCAL ROLE cashless_app;
SELECT set_config('app.operator_id', '', true);

-- 5. Rafale qui a passé le contrôle préalable (N-b) -----------------------------------------------
-- Code fuité : 25 refus « simultanés » (aucun contrôle préalable), chacun d'une adresse neuve.
SELECT is(ARRAY(SELECT pg_temp.refuse(pg_temp.h('fuité'), '10.30.6.' || n, 'ATTESTATION_FAILED')
                  FROM generate_series(1, 25) n ORDER BY n),
  array_fill(true, ARRAY[11]) || array_fill(false, ARRAY[14]),
  'rafale sur un code fuité : 10 refus et une trace RATE_LIMITED écrits, rien ensuite');
-- Adresse : 40 refus de codes inconnus distincts depuis une seule clé d'adresse.
SELECT is(ARRAY(SELECT pg_temp.refuse(pg_temp.h('rafale ' || n), '2001:db8:30:7::' || to_hex(n),
                                      'CODE_INVALID')
                  FROM generate_series(1, 40) n ORDER BY n),
  array_fill(true, ARRAY[31]) || array_fill(false, ARRAY[9]),
  'rafale depuis un /64 : 30 refus et une trace RATE_LIMITED écrits, rien ensuite');
RESET ROLE;
SELECT is((SELECT count(*)::int FROM audit_log
            WHERE action = 'DEVICE_ENROLLMENT_REFUSED' AND operator_id = pg_temp.id('30a001')
              AND after->>'enrollment_code_id' = pg_temp.id('30f001')::text), 11,
  'code fuité : 11 lignes d''audit dans la chaîne du prestataire, pas 25');
SELECT is((SELECT array_agg(concat_ws(' ', after->>'result', after->>'limit', after->>'refusal')
                            ORDER BY id) FROM audit_log
            WHERE action = 'DEVICE_ENROLLMENT_REFUSED'
              AND after->>'enrollment_code_id' = pg_temp.id('30f001')::text
              AND after->>'result' = 'RATE_LIMITED'),
  ARRAY['RATE_LIMITED code ATTESTATION_FAILED'],
  'code fuité : le refus au-delà de la limite s''écrit comme son franchissement (refusal gardé)');
SELECT is((SELECT count(*)::int FROM device_enrollment_attempt
            WHERE code_hash = pg_temp.h('fuité')), 11,
  'code fuité : 11 essais');
SELECT is(cardinality(pg_temp.traces('2001:db8:30:7::1')), 31,
  'rafale depuis un /64 : 31 lignes d''audit');
SELECT is((pg_temp.traces('2001:db8:30:7::1'))[31], 'RATE_LIMITED address CODE_INVALID',
  'rafale depuis un /64 : dernière trace = franchissement de la limite de l''adresse');

SELECT * FROM finish();
ROLLBACK;
