-- Purges des nonces et des essais d'enrôlement exécutées par l'API publique : bornes de fenêtre
-- (ADR-114 ; mission identite-enrolement-terminaux, lot WP18) — pgTAP, écrit à la main.
-- Lancer : pg_prove -d <base> tests/tests_device_purge_window.sql (base créée par les migrations,
-- roles.sql et post-roles.sql rejoués).
-- `cashless_app` exécute les deux purges (droit plus large accepté par ADR-114) : la suite échoue
-- si l'une d'elles peut retirer une ligne encore dans sa fenêtre, appelée sous ce rôle et sans
-- prestataire (travailleur device-purge). Seules les lignes de la suite sont regardées : d'autres
-- lignes expirées peuvent exister en base.
\set ON_ERROR_STOP 1
\set QUIET 1
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

CREATE FUNCTION pg_temp.id(p text) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT ('00000000-0000-0000-0000-' || lpad(p, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.h(p text) RETURNS bytea LANGUAGE sql IMMUTABLE AS
  $$ SELECT sha256(convert_to('purge ' || p, 'UTF8')) $$;
-- Nonces de la suite encore en table (propriétaire), triés.
CREATE FUNCTION pg_temp.nonces() RETURNS text[] LANGUAGE sql AS $$
  SELECT coalesce(array_agg(n ORDER BY n), '{}') FROM unnest(ARRAY['futur', 'expiré 60 s',
                                                                   'expiré 299 s', 'expiré 301 s',
                                                                   'expiré 1 h']) n
   WHERE EXISTS (SELECT 1 FROM device_request_nonce
                  WHERE device_id = pg_temp.id('14e001') AND nonce = pg_temp.h(n))
$$;
-- Essais de la suite encore en table (propriétaire), triés.
CREATE FUNCTION pg_temp.attempts() RETURNS text[] LANGUAGE sql AS $$
  SELECT coalesce(array_agg(host(address) ORDER BY address), '{}') FROM device_enrollment_attempt
   WHERE address << '192.0.2.0/24'
$$;

-- Données (propriétaire). Heure de la base : `now()` est figée dans la transaction, comme dans la
-- purge des nonces ; la purge des essais lit clock_timestamp() (marge d'une minute).
INSERT INTO party (id, kind, legal_name, country_code) VALUES
 (pg_temp.id('14a001'), 'OPERATOR', 'Prestataire purge', 'SN');
INSERT INTO device (id, operator_id, kind, serial)
VALUES (pg_temp.id('14e001'), pg_temp.id('14a001'), 'POS', 'WP18-PURGE');
INSERT INTO device_request_nonce (operator_id, device_id, nonce, expires_at)
SELECT pg_temp.id('14a001'), pg_temp.id('14e001'), pg_temp.h(n), now() + d
  FROM (VALUES ('futur', interval '1 minute'), ('expiré 60 s', interval '-60 seconds'),
               ('expiré 299 s', interval '-299 seconds'), ('expiré 301 s', interval '-301 seconds'),
               ('expiré 1 h', interval '-1 hour')) AS v(n, d);
INSERT INTO device_enrollment_attempt (code_hash, address, at, result)
SELECT pg_temp.h(a), a::inet, clock_timestamp() + d, 'CODE_INVALID'
  FROM (VALUES ('192.0.2.1', interval '0'), ('192.0.2.2', interval '-1 hour'),
               ('192.0.2.3', interval '-23 hours -59 minutes'),
               ('192.0.2.4', interval '-24 hours -1 minute'),
               ('192.0.2.5', interval '-3 days')) AS v(a, d);

-- 1. Droits (ADR-114) -----------------------------------------------------------------------------
SELECT ok(has_function_privilege('cashless_app', 'purge_device_request_nonces(integer)', 'EXECUTE'),
  'cashless_app exécute purge_device_request_nonces (ADR-114)');
SELECT ok(has_function_privilege('cashless_app', 'purge_device_enrollment_attempts()', 'EXECUTE'),
  'cashless_app exécute purge_device_enrollment_attempts (ADR-114)');
SELECT ok(NOT has_function_privilege('cashless_tagkeys', 'purge_device_request_nonces(integer)',
                                     'EXECUTE')
          AND NOT has_function_privilege('cashless_tagkeys', 'purge_device_enrollment_attempts()',
                                         'EXECUTE'),
  'cashless_tagkeys n''exécute aucune des deux purges');

-- 2. Purges sous cashless_app, sans prestataire ---------------------------------------------------
SET LOCAL ROLE cashless_app;
SELECT set_config('app.operator_id', '', true);
SELECT lives_ok($$SELECT purge_device_request_nonces(10000)$$,
  'purge des nonces : exécutée par cashless_app');
SELECT lives_ok($$SELECT purge_device_request_nonces(10000)$$,
  'purge des nonces : seconde exécution');
SELECT lives_ok($$SELECT purge_device_enrollment_attempts()$$,
  'purge des essais : exécutée par cashless_app');
RESET ROLE;

-- 3. Bornes ---------------------------------------------------------------------------------------
SELECT is(pg_temp.nonces(), ARRAY['expiré 299 s', 'expiré 60 s', 'futur'],
  'nonces : seuls ceux expirés depuis plus de 300 s sont retirés (un nonce non expiré ou expiré '
  'depuis moins de la tolérance maximale reste)');
SELECT is(pg_temp.attempts(), ARRAY['192.0.2.1', '192.0.2.2', '192.0.2.3'],
  'essais : seuls ceux de plus de 24 h sont retirés (un essai de 23 h 59 reste)');

SELECT * FROM finish();
ROLLBACK;
