-- Personnes et attributions de rôle (S1, migration 0003) — pgTAP, écrit à la main (pas un fichier généré).
-- Lancer : pg_prove -d <base> tests/tests_identity.sql (base créée par les migrations, roles.sql rejoué).
\set ON_ERROR_STOP 1
\set QUIET 1
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

-- Fixture (rôle propriétaire) : prestataires A et B, organisateurs, commerçant, événement de A.
INSERT INTO party (id, kind, legal_name, country_code) VALUES
 ('00000000-0000-0000-0000-0000000f1d01','OPERATOR','Prestataire A','SN'),
 ('00000000-0000-0000-0000-0000000f1d02','OPERATOR','Prestataire B','CI');
INSERT INTO party (id, kind, operator_id, legal_name, country_code) VALUES
 ('00000000-0000-0000-0000-0000000f1d11','ORGANIZER','00000000-0000-0000-0000-0000000f1d01','Organisateur A','SN'),
 ('00000000-0000-0000-0000-0000000f1d12','ORGANIZER','00000000-0000-0000-0000-0000000f1d02','Organisateur B','CI'),
 ('00000000-0000-0000-0000-0000000f1d21','MERCHANT','00000000-0000-0000-0000-0000000f1d01','Commerçant A','SN');
INSERT INTO jurisdiction_profile (id, country_code, version, valid_from, breakage_destination)
VALUES ('00000000-0000-0000-0000-0000000f1d31','SN', 77001, '2026-01-01', 'ORGANIZER');
INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone, jurisdiction_id, funds_holder) VALUES
 ('00000000-0000-0000-0000-0000000f1d41','00000000-0000-0000-0000-0000000f1d01','00000000-0000-0000-0000-0000000f1d11',
  'Événement A','XOF','Africa/Dakar','00000000-0000-0000-0000-0000000f1d31','ORGANIZER');

-- Personnes : plateforme (P1, P2), prestataire A (UA, UA2), prestataire B (UB).
INSERT INTO app_user (id, operator_id, issuer, subject, email, display_name) VALUES
 ('00000000-0000-0000-0000-0000000f1e01', NULL, 'https://idp.test', 'p1', 'p1@test', 'Admin plateforme 1'),
 ('00000000-0000-0000-0000-0000000f1e02', NULL, 'https://idp.test', 'p2', 'p2@test', 'Admin plateforme 2'),
 ('00000000-0000-0000-0000-0000000f1e11','00000000-0000-0000-0000-0000000f1d01','https://idp.test','ua','ua@test','Admin A'),
 ('00000000-0000-0000-0000-0000000f1e12','00000000-0000-0000-0000-0000000f1d01','https://idp.test','ua2','ua2@test','Caissier A'),
 ('00000000-0000-0000-0000-0000000f1e21','00000000-0000-0000-0000-0000000f1d02','https://idp.test','ub','ub@test','Admin B');
INSERT INTO role_assignment (id, user_id, role, scope_type, scope_id, granted_by) VALUES
 ('00000000-0000-0000-0000-0000000f1f01','00000000-0000-0000-0000-0000000f1e01','PLATFORM_ADMIN','PLATFORM',NULL,NULL),
 ('00000000-0000-0000-0000-0000000f1f11','00000000-0000-0000-0000-0000000f1e11','OPERATOR_ADMIN','OPERATOR','00000000-0000-0000-0000-0000000f1d01','00000000-0000-0000-0000-0000000f1e01');

-- 1. Structure
SELECT has_table('app_user');
SELECT has_table('role_assignment');
SELECT col_is_pk('app_user', 'id');
SELECT col_is_pk('role_assignment', 'id');
SELECT col_not_null('app_user', c, 'colonne obligatoire : ' || c)
  FROM unnest(ARRAY['issuer','subject','display_name','status','created_at']) AS c;
SELECT col_not_null('role_assignment', c, 'colonne obligatoire : ' || c)
  FROM unnest(ARRAY['user_id','role','scope_type','granted_at']) AS c;
SELECT fk_ok('role_assignment', 'user_id', 'app_user', 'id');
SELECT has_index('role_assignment', 'role_assignment_active_uniq', 'une attribution active par personne, rôle, portée');
SELECT is((SELECT relforcerowsecurity FROM pg_class WHERE relname = 'app_user'), true, 'app_user : RLS forcée');
SELECT is((SELECT relforcerowsecurity FROM pg_class WHERE relname = 'role_assignment'), true, 'role_assignment : RLS forcée');

-- 2. Contraintes de app_user
SELECT throws_ok($$INSERT INTO app_user (issuer, subject, email, display_name) VALUES ('https://idp.test','p1','x@test','Doublon')$$,
  '23505', NULL, '(émetteur, sujet) unique');
SELECT throws_ok($$INSERT INTO app_user (issuer, subject, display_name) VALUES ('https://idp.test','sans-contact','Sans contact')$$,
  '23514', NULL, 'e-mail ou téléphone obligatoire');
SELECT throws_ok($$INSERT INTO app_user (issuer, subject, phone, display_name) VALUES ('https://idp.test','tel','771234567','Tel')$$,
  '23514', NULL, 'téléphone hors E.164 refusé');
SELECT lives_ok($$INSERT INTO app_user (issuer, subject, phone, display_name) VALUES ('https://idp.test','tel2','+221771234567','Tel')$$,
  'téléphone E.164 accepté');
SELECT throws_ok($$INSERT INTO app_user (issuer, subject, email, display_name, status) VALUES ('https://idp.test','st','st@test','St','LOCKED')$$,
  '23514', NULL, 'statut hors liste refusé');
SELECT throws_ok($$INSERT INTO app_user (issuer, subject, email, display_name, status) VALUES ('https://idp.test','st2','st@test','St','DISABLED')$$,
  '23514', NULL, 'DISABLED sans disabled_at refusé');
SELECT throws_ok($$INSERT INTO app_user (issuer, subject, email, display_name) VALUES ('','vide','v@test','Vide')$$,
  '23514', NULL, 'émetteur vide refusé');
SELECT throws_ok($$INSERT INTO app_user (operator_id, issuer, subject, email, display_name)
                   VALUES ('00000000-0000-0000-0000-0000000f1d11','https://idp.test','org','o@test','Org')$$,
  'CL001', NULL, 'rattachement à une partie qui n''est pas un prestataire refusé');

-- 3. Gardes de app_user
SELECT throws_ok($$UPDATE app_user SET subject = 'autre' WHERE id = '00000000-0000-0000-0000-0000000f1e11'$$,
  'CL001', NULL, 'sujet immuable');
SELECT throws_ok($$UPDATE app_user SET operator_id = '00000000-0000-0000-0000-0000000f1d02' WHERE id = '00000000-0000-0000-0000-0000000f1e11'$$,
  'CL001', NULL, 'prestataire immuable');
SELECT lives_ok($$UPDATE app_user SET status = 'DISABLED', disabled_at = clock_timestamp() WHERE id = '00000000-0000-0000-0000-0000000f1e12'$$,
  'désactivation acceptée');
SELECT throws_ok($$UPDATE app_user SET status = 'ACTIVE', disabled_at = NULL WHERE id = '00000000-0000-0000-0000-0000000f1e12'$$,
  'CL001', NULL, 'réactivation refusée');
SELECT throws_ok($$DELETE FROM app_user WHERE id = '00000000-0000-0000-0000-0000000f1e12'$$,
  'CL001', NULL, 'suppression d''une personne refusée');
SELECT throws_ok($$UPDATE app_user SET status = 'DISABLED', disabled_at = clock_timestamp() WHERE id = '00000000-0000-0000-0000-0000000f1e01'$$,
  'CL001', NULL, 'désactivation du dernier PLATFORM_ADMIN refusée');

-- 4. Contraintes et gardes de role_assignment
SELECT throws_ok($$INSERT INTO role_assignment (user_id, role, scope_type, scope_id) VALUES
  ('00000000-0000-0000-0000-0000000f1e11','SUPERHERO','OPERATOR','00000000-0000-0000-0000-0000000f1d01')$$,
  '23514', NULL, 'rôle hors liste refusé');
SELECT throws_ok($$INSERT INTO role_assignment (user_id, role, scope_type, scope_id) VALUES
  ('00000000-0000-0000-0000-0000000f1e11','ORGANIZER_ADMIN','OPERATOR','00000000-0000-0000-0000-0000000f1d01')$$,
  '23514', NULL, 'rôle incompatible avec la portée refusé');
SELECT throws_ok($$INSERT INTO role_assignment (user_id, role, scope_type, scope_id) VALUES
  ('00000000-0000-0000-0000-0000000f1e11','OPERATOR_ADMIN','OPERATOR',NULL)$$,
  '23514', NULL, 'portée sans objet refusée');
SELECT throws_ok($$INSERT INTO role_assignment (user_id, role, scope_type, scope_id, granted_by) VALUES
  ('00000000-0000-0000-0000-0000000f1e11','ORGANIZER_ADMIN','ORGANIZER','00000000-0000-0000-0000-0000000f1d11','00000000-0000-0000-0000-0000000f1e11')$$,
  '23514', NULL, 'auto-attribution refusée');
SELECT throws_ok($$INSERT INTO role_assignment (user_id, role, scope_type, scope_id) VALUES
  ('00000000-0000-0000-0000-0000000f1e11','OPERATOR_ADMIN','OPERATOR','00000000-0000-0000-0000-0000000f1d01')$$,
  '23505', NULL, 'une seule attribution active identique');
SELECT throws_ok($$INSERT INTO role_assignment (user_id, role, scope_type, scope_id) VALUES
  ('00000000-0000-0000-0000-0000000f1e11','ORGANIZER_ADMIN','ORGANIZER','00000000-0000-0000-0000-0000000f1d12')$$,
  'CL001', NULL, 'organisateur d''un autre prestataire refusé');
SELECT throws_ok($$INSERT INTO role_assignment (user_id, role, scope_type, scope_id) VALUES
  ('00000000-0000-0000-0000-0000000f1e11','OPERATOR_ADMIN','OPERATOR','00000000-0000-0000-0000-0000000f1d02')$$,
  'CL001', NULL, 'portée prestataire d''un autre prestataire refusée');
SELECT throws_ok($$INSERT INTO role_assignment (user_id, role, scope_type, scope_id) VALUES
  ('00000000-0000-0000-0000-0000000f1e11','MERCHANT_ADMIN','MERCHANT','00000000-0000-0000-0000-0000000f1d11')$$,
  'CL001', NULL, 'commerçant inexistant (organisateur désigné) refusé');
SELECT throws_ok($$INSERT INTO role_assignment (user_id, role, scope_type, scope_id) VALUES
  ('00000000-0000-0000-0000-0000000f1e11','PLATFORM_ADMIN','PLATFORM',NULL)$$,
  'CL001', NULL, 'portée plateforme refusée à une personne de prestataire');
SELECT throws_ok($$INSERT INTO role_assignment (user_id, role, scope_type, scope_id) VALUES
  ('00000000-0000-0000-0000-0000000f1e01','OPERATOR_ADMIN','OPERATOR','00000000-0000-0000-0000-0000000f1d01')$$,
  'CL001', NULL, 'portée de prestataire refusée à une personne de la plateforme');
SELECT throws_ok($$INSERT INTO role_assignment (user_id, role, scope_type, scope_id) VALUES
  ('00000000-0000-0000-0000-0000000f1e12','CASHIER','EVENT','00000000-0000-0000-0000-0000000f1d41')$$,
  'CL001', NULL, 'attribution à une personne désactivée refusée');
SELECT lives_ok($$INSERT INTO role_assignment (id, user_id, role, scope_type, scope_id, granted_by) VALUES
  ('00000000-0000-0000-0000-0000000f1f12','00000000-0000-0000-0000-0000000f1e11','SUPERVISOR','EVENT','00000000-0000-0000-0000-0000000f1d41','00000000-0000-0000-0000-0000000f1e01')$$,
  'SUPERVISOR sur un événement du prestataire accepté');
SELECT lives_ok($$INSERT INTO role_assignment (user_id, role, scope_type, scope_id) VALUES
  ('00000000-0000-0000-0000-0000000f1e11','MERCHANT_ADMIN','MERCHANT','00000000-0000-0000-0000-0000000f1d21')$$,
  'MERCHANT_ADMIN sur un commerçant du prestataire accepté');
SELECT is((SELECT operator_id FROM role_assignment WHERE id = '00000000-0000-0000-0000-0000000f1f12'),
  '00000000-0000-0000-0000-0000000f1d01'::uuid, 'prestataire de l''attribution aligné sur la personne');
SELECT throws_ok($$UPDATE role_assignment SET role = 'CASHIER' WHERE id = '00000000-0000-0000-0000-0000000f1f12'$$,
  'CL001', NULL, 'attribution immuable hors retrait');
SELECT throws_ok($$UPDATE role_assignment SET revoked_at = clock_timestamp() WHERE id = '00000000-0000-0000-0000-0000000f1f12'$$,
  '23514', NULL, 'retrait sans auteur refusé');
SELECT lives_ok($$UPDATE role_assignment SET revoked_at = clock_timestamp(), revoked_by = '00000000-0000-0000-0000-0000000f1e01'
                  WHERE id = '00000000-0000-0000-0000-0000000f1f12'$$, 'retrait accepté');
SELECT throws_ok($$UPDATE role_assignment SET revoked_at = NULL, revoked_by = NULL WHERE id = '00000000-0000-0000-0000-0000000f1f12'$$,
  'CL001', NULL, 'rétablissement d''une attribution retirée refusé');
SELECT throws_ok($$DELETE FROM role_assignment WHERE id = '00000000-0000-0000-0000-0000000f1f12'$$,
  'CL001', NULL, 'suppression d''une attribution refusée');

-- 5. Dernier PLATFORM_ADMIN
SELECT throws_ok($$UPDATE role_assignment SET revoked_at = clock_timestamp(), revoked_by = '00000000-0000-0000-0000-0000000f1e01'
                   WHERE id = '00000000-0000-0000-0000-0000000f1f01'$$,
  'CL001', NULL, 'retrait du dernier PLATFORM_ADMIN refusé');
INSERT INTO role_assignment (id, user_id, role, scope_type, granted_by) VALUES
 ('00000000-0000-0000-0000-0000000f1f02','00000000-0000-0000-0000-0000000f1e02','PLATFORM_ADMIN','PLATFORM','00000000-0000-0000-0000-0000000f1e01');
SELECT lives_ok($$UPDATE role_assignment SET revoked_at = clock_timestamp(), revoked_by = '00000000-0000-0000-0000-0000000f1e02'
                  WHERE id = '00000000-0000-0000-0000-0000000f1f01'$$,
  'retrait d''un PLATFORM_ADMIN accepté quand il en reste un autre');

-- 6. identify_person
SELECT is((SELECT operator_id FROM identify_person('https://idp.test','ua')), '00000000-0000-0000-0000-0000000f1d01'::uuid,
  'identify_person : prestataire de la personne');
SELECT is((SELECT jsonb_array_length(assignments) FROM identify_person('https://idp.test','ua')), 2,
  'identify_person : seulement les attributions actives (OPERATOR_ADMIN, MERCHANT_ADMIN)');
SELECT is((SELECT count(*)::int FROM identify_person('https://idp.test','inconnu')), 0, 'identify_person : inconnu → aucune ligne');
SELECT is((SELECT assignments FROM identify_person('https://idp.test','p1')), '[]'::jsonb,
  'identify_person : attribution retirée exclue');
SELECT is((SELECT status FROM identify_person('https://idp.test','ua2')), 'DISABLED', 'identify_person : statut rendu');
SELECT ok(has_function_privilege('cashless_app', 'identify_person(text, text)', 'EXECUTE'),
  'identify_person exécutable par cashless_app');

-- 7. RLS sous le rôle applicatif
SET LOCAL ROLE cashless_app;
SELECT is((SELECT count(*)::int FROM app_user), 0, 'sans prestataire : aucune personne visible');
SELECT is((SELECT operator_id FROM identify_person('https://idp.test','ub')), '00000000-0000-0000-0000-0000000f1d02'::uuid,
  'identify_person appelable sans set_config');
SELECT set_config('app.operator_id', '00000000-0000-0000-0000-0000000f1d01', true);
SELECT is((SELECT count(*)::int FROM app_user), 2, 'prestataire A : ses seules personnes (UA, UA2)');
SELECT is((SELECT count(*)::int FROM app_user WHERE operator_id IS NULL), 0, 'personnes de la plateforme invisibles');
SELECT is((SELECT count(*)::int FROM role_assignment WHERE operator_id = '00000000-0000-0000-0000-0000000f1d02'), 0,
  'attributions de B invisibles');
SELECT throws_ok($$INSERT INTO app_user (operator_id, issuer, subject, email, display_name)
                   VALUES ('00000000-0000-0000-0000-0000000f1d02','https://idp.test','intrus','i@test','Intrus')$$,
  '42501', NULL, 'création d''une personne de B refusée (RLS)');
SELECT lives_ok($$INSERT INTO app_user (operator_id, issuer, subject, email, display_name, created_by)
                  VALUES ('00000000-0000-0000-0000-0000000f1d01','https://idp.test','ua3','ua3@test','Nouvelle A','00000000-0000-0000-0000-0000000f1e11')$$,
  'création d''une personne de A acceptée');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
