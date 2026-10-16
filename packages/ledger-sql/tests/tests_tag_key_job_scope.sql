-- Prise d'un travail de clé limitée à des prestataires (migration 0014) — pgTAP, écrit à la main.
-- Lancer : pg_prove -d <base> tests/tests_tag_key_job_scope.sql (base créée par les migrations, roles.sql rejoué).
\set ON_ERROR_STOP 1
\set QUIET 1
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

INSERT INTO party (id, kind, legal_name, country_code) VALUES
 ('00000000-0000-0000-0000-00000014a001','OPERATOR','Prestataire A','SN'),
 ('00000000-0000-0000-0000-00000014a002','OPERATOR','Prestataire B','CI');
INSERT INTO tag_key_job (id, operator_id, key_index, kind, created_at) VALUES
 ('00000000-0000-0000-0000-00000014c001','00000000-0000-0000-0000-00000014a001', 1, 'CREATE_KEY', clock_timestamp() - interval '3 minutes'),
 ('00000000-0000-0000-0000-00000014c002','00000000-0000-0000-0000-00000014a002', 1, 'CREATE_KEY', clock_timestamp() - interval '2 minutes'),
 ('00000000-0000-0000-0000-00000014c003','00000000-0000-0000-0000-00000014a002', 1, 'ROTATE_DEK', clock_timestamp() - interval '1 minute');

SELECT is((SELECT count(*)::int FROM pg_proc WHERE proname = 'claim_tag_key_job_for' AND NOT prosecdef), 1, 'SECURITY INVOKER : les politiques du rôle s''appliquent');

SET LOCAL ROLE cashless_keyadmin;
SELECT set_config('app.operator_id', '00000000-0000-0000-0000-000000000000', true);
SELECT is((SELECT id FROM claim_tag_key_job_for(ARRAY['00000000-0000-0000-0000-00000014a002']::uuid[], ARRAY['CREATE_KEY','DISABLE_KMS_KEY'])),
  '00000000-0000-0000-0000-00000014c002'::uuid, 'le travail de B est pris, pas celui de A, pourtant plus ancien');
SELECT is((SELECT status FROM tag_key_job WHERE id = '00000000-0000-0000-0000-00000014c001'), 'PENDING', 'le travail de A n''a pas bougé');
SELECT is((SELECT count(*)::int FROM claim_tag_key_job_for(ARRAY['00000000-0000-0000-0000-00000014a002']::uuid[], ARRAY['CREATE_KEY','DISABLE_KMS_KEY'])),
  0, 'plus rien pour B dans ces sortes');
SELECT is((SELECT count(*)::int FROM claim_tag_key_job_for(ARRAY['00000000-0000-0000-0000-00000014a002']::uuid[],
  ARRAY['CREATE_KEY','ROTATE_DEK','REENCRYPT','RETIRE_KEY','DISABLE_KMS_KEY'])), 0, 'la limite ne donne pas accès aux sortes d''un autre processus');
SELECT is((SELECT count(*)::int FROM claim_tag_key_job_for(ARRAY[]::uuid[], ARRAY['CREATE_KEY'])), 0, 'liste vide : rien');
SELECT throws_ok($$SELECT claim_tag_key_job_for(NULL, ARRAY['CREATE_KEY'])$$, 'CL001', NULL, 'liste absente refusée : pas de prise générale par omission');
SELECT throws_ok($$SELECT claim_tag_key_job_for(ARRAY['00000000-0000-0000-0000-00000014a001']::uuid[], ARRAY['CREATE_KEY'], 0)$$, 'CL001', NULL,
  'durée de verrou hors bornes');
SELECT is((SELECT id FROM claim_tag_key_job_for(ARRAY['00000000-0000-0000-0000-00000014a001','00000000-0000-0000-0000-00000014a002']::uuid[], ARRAY['CREATE_KEY'])),
  '00000000-0000-0000-0000-00000014c001'::uuid, 'plusieurs prestataires : le plus ancien parmi eux');
RESET ROLE;

-- L'API publique ne travaille pas la file, limitée ou non.
SET LOCAL ROLE cashless_app;
SELECT set_config('app.operator_id', '00000000-0000-0000-0000-00000014a002', true);
SELECT throws_ok($$SELECT claim_tag_key_job_for(ARRAY['00000000-0000-0000-0000-00000014a002']::uuid[], ARRAY['ROTATE_DEK'])$$, '42501', NULL,
  'le rôle de l''API publique ne peut pas prendre un travail');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
