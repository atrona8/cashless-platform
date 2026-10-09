-- Création d'un administrateur de la plateforme par l'API (migration 0006) — pgTAP, écrit à la main.
-- Lancer : pg_prove -d <base> tests/tests_platform_admin.sql (base créée par les migrations, rôles rejoués).
\set ON_ERROR_STOP 1
\set QUIET 1
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

INSERT INTO party (id, kind, legal_name, country_code) VALUES
 ('00000000-0000-0000-0000-0000000c0d01','OPERATOR','Prestataire A','SN');
-- Administrateur amorcé (granted_by NULL), personne d'un prestataire avec OPERATOR_ADMIN, administrateur retiré.
INSERT INTO app_user (id, operator_id, issuer, subject, email, display_name) VALUES
 ('00000000-0000-0000-0000-0000000c0e01', NULL, 'https://idp.test', 'root', 'root@test', 'Racine'),
 ('00000000-0000-0000-0000-0000000c0e02', '00000000-0000-0000-0000-0000000c0d01', 'https://idp.test', 'op', 'op@test', 'Opérateur'),
 ('00000000-0000-0000-0000-0000000c0e03', NULL, 'https://idp.test', 'ex', 'ex@test', 'Ancien');
INSERT INTO role_assignment (user_id, role, scope_type, scope_id) VALUES
 ('00000000-0000-0000-0000-0000000c0e01', 'PLATFORM_ADMIN', 'PLATFORM', NULL),
 ('00000000-0000-0000-0000-0000000c0e02', 'OPERATOR_ADMIN', 'OPERATOR', '00000000-0000-0000-0000-0000000c0d01'),
 ('00000000-0000-0000-0000-0000000c0e03', 'PLATFORM_ADMIN', 'PLATFORM', NULL);
UPDATE role_assignment SET revoked_at = clock_timestamp(), revoked_by = '00000000-0000-0000-0000-0000000c0e01'
 WHERE user_id = '00000000-0000-0000-0000-0000000c0e03';

SELECT has_function('create_platform_admin', ARRAY['uuid','text','text','text','text','text','text','uuid']);
SELECT ok(has_function_privilege('cashless_app', 'create_platform_admin(uuid, text, text, text, text, text, text, uuid)', 'EXECUTE'),
  'create_platform_admin : EXECUTE accordé au rôle applicatif');
SELECT ok(NOT has_function_privilege('public', 'create_platform_admin(uuid, text, text, text, text, text, text, uuid)', 'EXECUTE'),
  'create_platform_admin : rien pour PUBLIC');

-- Refus : l'autorisation vient de l'attribution lue en base
SET LOCAL ROLE cashless_app;
SELECT throws_ok($$SELECT create_platform_admin('00000000-0000-0000-0000-0000000c0e02', 'https://idp.test', 'x1', 'X', 'x@test', NULL)$$,
  'CL001', NULL, 'OPERATOR_ADMIN : refusé');
SELECT throws_ok($$SELECT create_platform_admin('00000000-0000-0000-0000-0000000c0e03', 'https://idp.test', 'x2', 'X', 'x@test', NULL)$$,
  'CL001', NULL, 'PLATFORM_ADMIN retiré : refusé');
SELECT throws_ok($$SELECT create_platform_admin(NULL, 'https://idp.test', 'x3', 'X', 'x@test', NULL)$$,
  'CL001', NULL, 'acteur absent : refusé');
SELECT throws_ok($$SELECT create_platform_admin(gen_random_uuid(), 'https://idp.test', 'x4', 'X', 'x@test', NULL)$$,
  'CL001', NULL, 'acteur inconnu : refusé');

-- Création par un PLATFORM_ADMIN, sous le rôle applicatif et sans prestataire
SELECT is((create_platform_admin('00000000-0000-0000-0000-0000000c0e01', 'https://idp.test', 'nouveau', 'Nouvel admin',
           'nouveau@test', NULL, '192.0.2.10', '00000000-0000-0000-0000-0000000c0f01')) -> 'role_assignments' -> 0 ->> 'role',
  'PLATFORM_ADMIN', 'création : personne et attribution rendues');
SELECT throws_ok($$SELECT create_platform_admin('00000000-0000-0000-0000-0000000c0e01', 'https://idp.test', 'nouveau', 'Doublon', 'd@test', NULL)$$,
  '23505', NULL, '(émetteur, sujet) déjà connu : refusé');
SELECT throws_ok($$SELECT create_platform_admin('00000000-0000-0000-0000-0000000c0e01', 'https://idp.test', 'sans-contact', 'X', NULL, NULL)$$,
  '23514', NULL, 'ni e-mail ni téléphone : refusé');
RESET ROLE;

SELECT is((SELECT operator_id FROM app_user WHERE subject = 'nouveau'), NULL, 'personne de la plateforme (sans prestataire)');
SELECT is((SELECT created_by FROM app_user WHERE subject = 'nouveau'), '00000000-0000-0000-0000-0000000c0e01'::uuid, 'created_by = acteur');
SELECT is((SELECT granted_by FROM role_assignment ra JOIN app_user u ON u.id = ra.user_id WHERE u.subject = 'nouveau'),
  '00000000-0000-0000-0000-0000000c0e01'::uuid, 'granted_by = acteur');
SELECT is((SELECT count(*)::int FROM audit_log WHERE action = 'PLATFORM_ADMIN_CREATED'
            AND actor_id = '00000000-0000-0000-0000-0000000c0e01' AND operator_id IS NULL
            AND request_id = '00000000-0000-0000-0000-0000000c0f01' AND origin = '192.0.2.10'), 1,
  'une ligne d''audit sur la chaîne de la plateforme');
SELECT is((SELECT count(*)::int FROM verify_audit_chain('00000000-0000-0000-0000-000000000000')), 0, 'chaîne de la plateforme intacte');
SELECT is((SELECT assignments -> 0 ->> 'role' FROM identify_person('https://idp.test', 'nouveau')), 'PLATFORM_ADMIN',
  'le nouvel administrateur est identifiable');

SELECT * FROM finish();
ROLLBACK;
