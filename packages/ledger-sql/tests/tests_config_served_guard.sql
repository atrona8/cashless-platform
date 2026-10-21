-- Configuration servie : terminal révoqué refusé, `config_version` du seul prestataire du terminal
-- (migration 0029 ; mission identite-enrolement-terminaux, lot WP18 ; ADR-118 (1)) — pgTAP, écrit
-- à la main (pas un fichier généré).
-- Lancer : pg_prove -d <base> tests/tests_config_served_guard.sql (base créée par les migrations,
-- roles.sql et post-roles.sql rejoués).
-- Hors de la suite de référence (gen_tests.py) : celle-ci vérifie le schéma de référence seul (kit,
-- 400 assertions), que 0029 durcit ; ces bornes n'y tiendraient pas.
\set ON_ERROR_STOP 1
\set QUIET 1
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

CREATE FUNCTION pg_temp.id(p text) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT ('00000000-0000-0000-0000-' || lpad(p, 12, '0'))::uuid $$;
-- Configurations servies d'un terminal (lues par le propriétaire).
CREATE FUNCTION pg_temp.served(p text) RETURNS int LANGUAGE sql AS
  $$ SELECT count(*)::int FROM device_config_served WHERE device_id = pg_temp.id(p) $$;

-- Données (propriétaire) : A et B ; terminaux de A : e001 actif, e002 révoqué, e003 suspendu ;
-- de B : e011 actif. Versions de configuration : c001 de A, c011 de B, c099 de la plateforme.
INSERT INTO party (id, kind, legal_name, country_code) VALUES
 (pg_temp.id('29a001'), 'OPERATOR', 'Prestataire A', 'SN'),
 (pg_temp.id('29a002'), 'OPERATOR', 'Prestataire B', 'CI');
INSERT INTO device (id, operator_id, kind, serial, status)
SELECT pg_temp.id(d), pg_temp.id(o), 'POS', 'WP18-0029-' || d, s
  FROM (VALUES ('29e001', '29a001', 'ACTIVE'), ('29e002', '29a001', 'REVOKED'),
               ('29e003', '29a001', 'SUSPENDED'), ('29e011', '29a002', 'ACTIVE')) AS v(d, o, s);
INSERT INTO config_version (id, operator_id, scope_type, scope_id, version, valid_from, settings)
SELECT pg_temp.id(c), o, t, gen_random_uuid(), 1, now(), '{}'
  FROM (VALUES ('29c001', pg_temp.id('29a001'), 'OPERATOR'),
               ('29c011', pg_temp.id('29a002'), 'OPERATOR'),
               ('29c099', NULL, 'PLATFORM')) AS v(c, o, t);

-- 1. Structure et droits --------------------------------------------------------------------------
SELECT ok((SELECT prosecdef AND proconfig @> ARRAY['search_path=public, pg_temp'] FROM pg_proc
            WHERE oid = 'record_config_served(uuid,uuid)'::regprocedure),
  'record_config_served : SECURITY DEFINER, search_path public, pg_temp');
SELECT ok(NOT has_function_privilege('public', 'record_config_served(uuid,uuid)', 'EXECUTE'),
  'record_config_served : non exécutable par PUBLIC');
SELECT ok(has_function_privilege('cashless_app', 'record_config_served(uuid,uuid)', 'EXECUTE'),
  'record_config_served : exécutable par cashless_app (post-roles.sql §4a, WP17)');

-- Session de l'API publique, prestataire A.
SET LOCAL ROLE cashless_app;
SELECT set_config('app.operator_id', pg_temp.id('29a001')::text, true);

-- 2. Cas permis -----------------------------------------------------------------------------------
SELECT is((SELECT operator_id FROM record_config_served(pg_temp.id('29e001'))),
  pg_temp.id('29a001'), 'terminal actif de A, sans version : configuration enregistrée');
SELECT is((SELECT config_version_id FROM record_config_served(pg_temp.id('29e001'),
                                                              pg_temp.id('29c001'))),
  pg_temp.id('29c001'), 'terminal actif de A, version de A : configuration enregistrée');
SELECT lives_ok($$SELECT record_config_served(pg_temp.id('29e003'))$$,
  'terminal suspendu : configuration servie (allowSuspended, FR-018)');

-- 3. Refus : rien n'est écrit ---------------------------------------------------------------------
SELECT throws_ok($$SELECT record_config_served(pg_temp.id('29e011'))$$, 'P0002', NULL,
  'terminal d''un autre prestataire : refusé (Objet introuvable)');
SELECT throws_ok($$SELECT record_config_served(pg_temp.id('29e011'), pg_temp.id('29c011'))$$,
  'P0002', NULL, 'terminal et version d''un autre prestataire : refusé');
SELECT throws_ok($$SELECT record_config_served(pg_temp.id('29e002'))$$, '42501', NULL,
  'terminal révoqué : refusé (ADR-118)');
SELECT throws_ok($$SELECT record_config_served(pg_temp.id('29e002'), pg_temp.id('29c001'))$$,
  '42501', NULL, 'terminal révoqué, version de son prestataire : refusé');
SELECT throws_ok($$SELECT record_config_served(pg_temp.id('29e001'), pg_temp.id('29c011'))$$,
  'P0002', NULL, 'config_version d''un autre prestataire : refusée (ADR-118)');
SELECT throws_ok($$SELECT record_config_served(pg_temp.id('29e001'), pg_temp.id('29c099'))$$,
  'P0002', NULL, 'config_version de la plateforme (sans prestataire) : refusée');
SELECT throws_ok($$SELECT record_config_served(pg_temp.id('29e001'), pg_temp.id('29cfff'))$$,
  'P0002', NULL, 'config_version inconnue : refusée');
-- Sans prestataire de session : aucun terminal.
SELECT set_config('app.operator_id', '', true);
SELECT throws_ok($$SELECT record_config_served(pg_temp.id('29e001'))$$, 'P0002', NULL,
  'session sans prestataire : refusé');

RESET ROLE;
SELECT is(pg_temp.served('29e001'), 2,
  'terminal actif de A : seules les deux configurations permises sont écrites');
SELECT is((SELECT count(*)::int FROM device_config_served
            WHERE device_id = pg_temp.id('29e001')
              AND config_version_id IN (pg_temp.id('29c011'), pg_temp.id('29c099'))), 0,
  'aucune configuration écrite avec la version d''un autre prestataire ou de la plateforme');
SELECT is(pg_temp.served('29e002'), 0, 'terminal révoqué : aucune configuration écrite');
SELECT is(pg_temp.served('29e011'), 0, 'terminal de B : aucune configuration écrite depuis A');
SELECT is(pg_temp.served('29e003'), 1, 'terminal suspendu : une configuration');

SELECT * FROM finish();
ROLLBACK;
