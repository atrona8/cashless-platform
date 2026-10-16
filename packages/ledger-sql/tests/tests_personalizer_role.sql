-- Rôle PERSONALIZER et actions à deux des clés de bracelet (migration 0011) — pgTAP, écrit à la main.
-- Lancer : pg_prove -d <base> tests/tests_personalizer_role.sql (base créée par les migrations, roles.sql rejoué).
\set ON_ERROR_STOP 1
\set QUIET 1
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

INSERT INTO party (id, kind, legal_name, country_code) VALUES
 ('00000000-0000-0000-0000-00000011a001','OPERATOR','Prestataire A','SN'),
 ('00000000-0000-0000-0000-00000011a002','OPERATOR','Prestataire B','CI');
INSERT INTO party (id, kind, operator_id, legal_name) VALUES
 ('00000000-0000-0000-0000-00000011a011','ORGANIZER','00000000-0000-0000-0000-00000011a001','Organisateur A');
INSERT INTO app_user (id, operator_id, issuer, subject, email, display_name) VALUES
 ('00000000-0000-0000-0000-00000011b001','00000000-0000-0000-0000-00000011a001','https://idp.test','0011-admin','admin-0011@test','Administrateur A'),
 ('00000000-0000-0000-0000-00000011b002','00000000-0000-0000-0000-00000011a001','https://idp.test','0011-poste','poste-0011@test','Agent de personnalisation A'),
 ('00000000-0000-0000-0000-00000011b003','00000000-0000-0000-0000-00000011a002','https://idp.test','0011-b','b-0011@test','Agent de B');

-- 1. Rôle PERSONALIZER : portée prestataire seulement ---------------------------------------------------------------
SELECT lives_ok($$INSERT INTO role_assignment (user_id, role, scope_type, scope_id, granted_by) VALUES
  ('00000000-0000-0000-0000-00000011b002','PERSONALIZER','OPERATOR','00000000-0000-0000-0000-00000011a001','00000000-0000-0000-0000-00000011b001')$$,
  'PERSONALIZER attribué sur la portée du prestataire');
SELECT throws_ok($$INSERT INTO role_assignment (user_id, role, scope_type, scope_id, granted_by) VALUES
  ('00000000-0000-0000-0000-00000011b002','PERSONALIZER','ORGANIZER','00000000-0000-0000-0000-00000011a011','00000000-0000-0000-0000-00000011b001')$$,
  '23514', NULL, 'PERSONALIZER refusé sur une portée organisateur');
SELECT throws_ok($$INSERT INTO role_assignment (user_id, role, scope_type, scope_id, granted_by) VALUES
  ('00000000-0000-0000-0000-00000011b002','PERSONALIZER','PLATFORM',NULL,'00000000-0000-0000-0000-00000011b001')$$,
  NULL, NULL, 'PERSONALIZER refusé sur la portée plateforme (garde d''attribution de la mission 2, avant même la contrainte)');
SELECT throws_ok($$INSERT INTO role_assignment (user_id, role, scope_type, scope_id, granted_by) VALUES
  ('00000000-0000-0000-0000-00000011b002','PERSONALIZER','OPERATOR','00000000-0000-0000-0000-00000011a001','00000000-0000-0000-0000-00000011b002')$$,
  '23514', NULL, 'personne ne s''attribue PERSONALIZER à elle-même');
SELECT throws_ok($$INSERT INTO role_assignment (user_id, role, scope_type, scope_id, granted_by) VALUES
  ('00000000-0000-0000-0000-00000011b002','KEY_MASTER','OPERATOR','00000000-0000-0000-0000-00000011a001','00000000-0000-0000-0000-00000011b001')$$,
  '23514', NULL, 'un rôle inconnu reste refusé');
SELECT lives_ok($$INSERT INTO role_assignment (user_id, role, scope_type, scope_id, granted_by) VALUES
  ('00000000-0000-0000-0000-00000011b002','CASHIER','ORGANIZER','00000000-0000-0000-0000-00000011a011','00000000-0000-0000-0000-00000011b001')$$,
  'les rôles existants gardent leurs portées');

-- 2. Actions à deux : toujours avec un prestataire --------------------------------------------------------------------
SELECT lives_ok(format($$INSERT INTO approval_request (operator_id, action, payload, requested_by) VALUES
  ('00000000-0000-0000-0000-00000011a001', %L, '{}', '00000000-0000-0000-0000-00000011b001')$$, action), action || ' : demande acceptée')
  FROM unnest(ARRAY['TAG_KEY_CREATE','TAG_DEK_ROTATE','TAG_KEY_RETIRE','REINSTATE_MEDIA']) action;
SELECT throws_ok(format($$INSERT INTO approval_request (operator_id, action, payload, requested_by) VALUES
  (NULL, %L, '{}', '00000000-0000-0000-0000-00000011b001')$$, action), '23514', NULL, action || ' : refusée sans prestataire')
  FROM unnest(ARRAY['TAG_KEY_CREATE','TAG_DEK_ROTATE','TAG_KEY_RETIRE']) action;
SELECT throws_ok($$INSERT INTO approval_request (operator_id, action, payload, requested_by) VALUES
  ('00000000-0000-0000-0000-00000011a001', 'TAG_KEY_DESTROY', '{}', '00000000-0000-0000-0000-00000011b001')$$, '23514', NULL,
  'une action inconnue reste refusée');
SELECT lives_ok($$INSERT INTO approval_request (operator_id, action, payload, requested_by) VALUES
  ('00000000-0000-0000-0000-00000011a001', 'EVENT_GO_LIVE', '{}', '00000000-0000-0000-0000-00000011b001')$$,
  'les actions des missions précédentes restent acceptées');

-- 3. Isolation : une demande de clé de A est invisible de B ---------------------------------------------------------------
SET LOCAL ROLE cashless_app;
SELECT set_config('app.operator_id', '00000000-0000-0000-0000-00000011a002', true);
SELECT is((SELECT count(*)::int FROM approval_request WHERE action LIKE 'TAG_%'), 0, 'B ne voit aucune demande de clé de A');
SELECT is((SELECT count(*)::int FROM role_assignment WHERE role = 'PERSONALIZER'), 0, 'B ne voit pas le PERSONALIZER de A');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
