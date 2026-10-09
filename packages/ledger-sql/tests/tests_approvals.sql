-- Double validation en base (migration 0005) et droits posés par post-roles.sql — pgTAP, écrit à la main.
-- Lancer : pg_prove -d <base> tests/tests_approvals.sql (base créée par les migrations, roles.sql et post-roles.sql
-- rejoués).
\set ON_ERROR_STOP 1
\set QUIET 1
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

INSERT INTO party (id, kind, legal_name, country_code) VALUES
 ('00000000-0000-0000-0000-0000000b0d01','OPERATOR','Prestataire A','SN'),
 ('00000000-0000-0000-0000-0000000b0d02','OPERATOR','Prestataire B','CI');

-- Demande du prestataire A : auteur e01, décideur e02.
INSERT INTO approval_request (id, operator_id, action, payload, requested_by) VALUES
 ('00000000-0000-0000-0000-0000000b0a01','00000000-0000-0000-0000-0000000b0d01','ADJUSTMENT','{"amount":100}',
  '00000000-0000-0000-0000-0000000b0e01'),
 ('00000000-0000-0000-0000-0000000b0a02','00000000-0000-0000-0000-0000000b0d01','ADJUSTMENT','{"amount":200}',
  '00000000-0000-0000-0000-0000000b0e01');

CREATE FUNCTION pg_temp.use_token(p_jti text, p_operator uuid) RETURNS int LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  INSERT INTO approval_token_use (jti, operator_id, operation_id, approver_id, caller_id, expires_at)
  VALUES (p_jti, p_operator, 'adjustLedger', '00000000-0000-0000-0000-0000000b0e02',
          '00000000-0000-0000-0000-0000000b0e01', clock_timestamp() + interval '5 minutes')
  ON CONFLICT (jti) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

-- 1. Structure
SELECT has_column('approval_request', 'result');
SELECT col_type_is('approval_request', 'result', 'jsonb');
SELECT has_table('approval_token_use');
SELECT col_is_pk('approval_token_use', 'jti');
SELECT is((SELECT relforcerowsecurity FROM pg_class WHERE relname = 'approval_token_use'), true,
  'approval_token_use : RLS forcée');
SELECT ok(EXISTS (SELECT 1 FROM pg_indexes WHERE tablename = 'approval_token_use' AND indexdef LIKE '%(expires_at)%'),
  'approval_token_use : index sur expires_at');

-- 2. result : seulement à l'état EXECUTED
SELECT throws_ok($$UPDATE approval_request SET result = '{"ok":true}' WHERE id = '00000000-0000-0000-0000-0000000b0a01'$$,
  'CL023', NULL, 'result seul sur une demande PENDING : refusé par la garde (pas de passage)');
SELECT throws_ok($$UPDATE approval_request SET status = 'REJECTED', decided_by = '00000000-0000-0000-0000-0000000b0e02',
  decided_at = clock_timestamp(), result = '{"ok":true}' WHERE id = '00000000-0000-0000-0000-0000000b0a01'$$,
  '23514', NULL, 'result refusé au passage PENDING -> REJECTED');
SELECT throws_ok($$INSERT INTO approval_request (operator_id, action, payload, requested_by, result)
  VALUES ('00000000-0000-0000-0000-0000000b0d01','ADJUSTMENT','{}','00000000-0000-0000-0000-0000000b0e01','{}')$$,
  '23514', NULL, 'result refusé à la création');

-- 3. Parcours sous le rôle applicatif : décision puis exécution avec résultat
SET LOCAL ROLE cashless_app;
SELECT set_config('app.operator_id', '00000000-0000-0000-0000-0000000b0d01', true);
SELECT is((decide_approval_request('00000000-0000-0000-0000-0000000b0a01', '00000000-0000-0000-0000-0000000b0e02', true)).status,
  'APPROVED', 'décision par une autre personne : APPROVED');
SELECT throws_ok($$UPDATE approval_request SET status = 'FAILED', failure_code = 'X', result = '{"ok":true}'
  WHERE id = '00000000-0000-0000-0000-0000000b0a01'$$,
  '23514', NULL, 'result refusé au passage APPROVED -> FAILED');
SELECT lives_ok($$UPDATE approval_request SET status = 'EXECUTED', result = '{"adjusted":100}'
  WHERE id = '00000000-0000-0000-0000-0000000b0a01'$$, 'APPROVED -> EXECUTED avec result : permis (garde inchangée)');
SELECT is((SELECT result FROM approval_request WHERE id = '00000000-0000-0000-0000-0000000b0a01'), '{"adjusted":100}'::jsonb,
  'result conservé');
SELECT throws_ok($$UPDATE approval_request SET payload = '{}' WHERE id = '00000000-0000-0000-0000-0000000b0a02'$$,
  '42501', NULL, 'payload non modifiable par le rôle applicatif');
RESET ROLE;

-- 4. approval_token_use : contraintes, ajout seul, consommation unique
SELECT is(pg_temp.use_token('jti-1', '00000000-0000-0000-0000-0000000b0d01'), 1, 'première utilisation : 1 ligne');
SELECT is(pg_temp.use_token('jti-1', '00000000-0000-0000-0000-0000000b0d01'), 0, 'rejeu du même jti : 0 ligne');
SELECT throws_ok($$INSERT INTO approval_token_use (jti, operator_id, operation_id, approver_id, caller_id, expires_at)
  VALUES ('jti-2','00000000-0000-0000-0000-0000000b0d01','adjustLedger','00000000-0000-0000-0000-0000000b0e01',
          '00000000-0000-0000-0000-0000000b0e01', clock_timestamp() + interval '1 minute')$$,
  '23514', NULL, 'approbateur = appelant : refusé');
SELECT throws_ok($$INSERT INTO approval_token_use (jti, operator_id, operation_id, approver_id, caller_id, expires_at)
  VALUES ('jti-3','00000000-0000-0000-0000-0000000b0d01','adjustLedger','00000000-0000-0000-0000-0000000b0e02',
          '00000000-0000-0000-0000-0000000b0e01', clock_timestamp() - interval '1 second')$$,
  '23514', NULL, 'jeton déjà expiré : refusé');
SELECT throws_ok($$UPDATE approval_token_use SET caller_id = approver_id WHERE jti = 'jti-1'$$, 'CL001', NULL,
  'modification refusée (propriétaire compris)');
SELECT throws_ok($$DELETE FROM approval_token_use WHERE jti = 'jti-1'$$, 'CL001', NULL,
  'suppression refusée (propriétaire compris)');

-- 5. RLS sous le rôle applicatif
SET LOCAL ROLE cashless_app;
SELECT set_config('app.operator_id', '00000000-0000-0000-0000-0000000b0d02', true);
SELECT is((SELECT count(*)::int FROM approval_token_use), 0, 'prestataire B : jetons de A invisibles');
SELECT throws_ok($$INSERT INTO approval_token_use (jti, operator_id, operation_id, approver_id, caller_id, expires_at)
  VALUES ('jti-4','00000000-0000-0000-0000-0000000b0d01','adjustLedger','00000000-0000-0000-0000-0000000b0e02',
          '00000000-0000-0000-0000-0000000b0e01', clock_timestamp() + interval '1 minute')$$,
  '42501', NULL, 'consommation pour le prestataire A refusée (RLS)');
SELECT is(pg_temp.use_token('jti-5', '00000000-0000-0000-0000-0000000b0d02'), 1, 'consommation sous le rôle applicatif');
SELECT is(pg_temp.use_token('jti-5', '00000000-0000-0000-0000-0000000b0d02'), 0, 'rejeu sous le rôle applicatif : 0 ligne');
SELECT throws_ok($$UPDATE approval_token_use SET operation_id = 'x' WHERE jti = 'jti-5'$$, '42501', NULL,
  'UPDATE non accordé au rôle applicatif');
RESET ROLE;

-- 6. Droits effectifs du rôle applicatif après post-roles.sql
SELECT ok(has_table_privilege('cashless_app', 'audit_log', 'INSERT'), 'audit_log : INSERT accordé');
SELECT ok(has_table_privilege('cashless_app', 'audit_log', 'SELECT'), 'audit_log : SELECT accordé');
SELECT ok(NOT has_table_privilege('cashless_app', 'audit_log', 'UPDATE'), 'audit_log : UPDATE retiré');
SELECT ok(NOT has_table_privilege('cashless_app', 'audit_log', 'DELETE'), 'audit_log : DELETE retiré');
SELECT ok(NOT has_table_privilege('cashless_app', 'audit_seal', 'INSERT'), 'audit_seal : INSERT retiré');
SELECT ok(NOT has_table_privilege('cashless_app', 'audit_seal', 'UPDATE'), 'audit_seal : UPDATE retiré');
SELECT ok(has_table_privilege('cashless_app', 'approval_token_use', 'INSERT'), 'approval_token_use : INSERT accordé');
SELECT ok(NOT has_table_privilege('cashless_app', 'approval_token_use', 'UPDATE'), 'approval_token_use : UPDATE retiré');
SELECT ok(NOT has_table_privilege('cashless_app', 'approval_token_use', 'DELETE'), 'approval_token_use : DELETE retiré');
SELECT ok(has_column_privilege('cashless_app', 'approval_request', 'result', 'UPDATE'), 'approval_request.result : UPDATE accordé');
SELECT ok(has_column_privilege('cashless_app', 'approval_request', 'status', 'UPDATE'), 'approval_request.status : UPDATE accordé (roles.sql)');
SELECT ok(NOT has_column_privilege('cashless_app', 'approval_request', 'payload', 'UPDATE'), 'approval_request.payload : UPDATE non accordé');
SELECT ok(NOT has_function_privilege('cashless_app', 'seal_audit(uuid, interval)', 'EXECUTE'), 'seal_audit : EXECUTE retiré');
SELECT ok(NOT has_function_privilege('cashless_app', 'verify_audit_chain(uuid, timestamptz)', 'EXECUTE'), 'verify_audit_chain : EXECUTE retiré');
SELECT ok(NOT has_function_privilege('cashless_app', 'audit_chain_genesis(uuid)', 'EXECUTE'), 'audit_chain_genesis : EXECUTE retiré');
SELECT ok(NOT has_function_privilege('cashless_app', 'audit_row_canonical(audit_log)', 'EXECUTE'), 'audit_row_canonical : EXECUTE retiré');
SELECT ok(NOT has_function_privilege('cashless_app', 'audit_rows_sha256(uuid, bigint, bigint)', 'EXECUTE'), 'audit_rows_sha256 : EXECUTE retiré');
SELECT ok(NOT has_function_privilege('cashless_app', 'active_platform_admins(uuid, uuid)', 'EXECUTE'), 'active_platform_admins : EXECUTE retiré');
SELECT ok(has_function_privilege('cashless_app', 'identify_person(text, text)', 'EXECUTE'), 'identify_person : EXECUTE accordé');
SELECT ok(has_function_privilege('cashless_app', 'decide_approval_request(uuid, uuid, boolean, text)', 'EXECUTE'),
  'decide_approval_request : EXECUTE accordé');
SELECT ok(NOT has_function_privilege('public', 'seal_audit(uuid, interval)', 'EXECUTE'), 'seal_audit : rien pour PUBLIC');

-- 7. Amorçage autorisé par la base : personne de plateforme et attribution sans auteur (le reste : WP10)
SELECT lives_ok($$INSERT INTO app_user (id, operator_id, issuer, subject, email, display_name, created_by)
  VALUES ('00000000-0000-0000-0000-0000000b0f01', NULL, 'https://idp.test', 'boot-1', 'admin@test', 'Admin', NULL)$$,
  'personne de plateforme sans auteur');
SELECT lives_ok($$INSERT INTO role_assignment (user_id, role, scope_type, scope_id, granted_by)
  VALUES ('00000000-0000-0000-0000-0000000b0f01', 'PLATFORM_ADMIN', 'PLATFORM', NULL, NULL)$$,
  'attribution PLATFORM_ADMIN sans auteur');
SELECT is((SELECT assignments -> 0 ->> 'role' FROM identify_person('https://idp.test', 'boot-1')), 'PLATFORM_ADMIN',
  'identify_person : rôle amorcé visible');

SELECT * FROM finish();
ROLLBACK;
