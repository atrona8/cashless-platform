-- Travaux de clé et comptes rendus du contrôle quotidien (migration 0012) — pgTAP, écrit à la main.
-- Lancer : pg_prove -d <base> tests/tests_tag_key_jobs.sql (base créée par les migrations, roles.sql rejoué).
\set ON_ERROR_STOP 1
\set QUIET 1
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

INSERT INTO party (id, kind, legal_name, country_code) VALUES
 ('00000000-0000-0000-0000-00000012a001','OPERATOR','Prestataire A','SN'),
 ('00000000-0000-0000-0000-00000012a002','OPERATOR','Prestataire B','CI');

-- 1. Structure -------------------------------------------------------------------------------------------------------
SELECT has_table('tag_key_job');
SELECT has_table('tag_key_check_run');
SELECT is((SELECT count(*)::int FROM pg_class WHERE relname IN ('tag_key_job','tag_key_check_run') AND relrowsecurity AND relforcerowsecurity),
  2, 'RLS activée et forcée sur les deux tables');
SELECT is((SELECT count(*)::int FROM pg_proc WHERE proname IN ('claim_tag_key_job','finish_tag_key_job','retry_tag_key_job') AND NOT prosecdef),
  3, 'les trois fonctions de la file sont SECURITY INVOKER');

-- L'API n'inscrit plus aucun travail directement (migration 0020, SEC-1) :
-- tests_tag_key_job_approval.sql couvre l'inscription par les fonctions. Les contraintes de la
-- table se vérifient ici sous le propriétaire.
SET LOCAL ROLE cashless_app;
SELECT set_config('app.operator_id', '00000000-0000-0000-0000-00000012a001', true);
SELECT throws_ok($$INSERT INTO tag_key_job (operator_id, key_index, kind)
                   VALUES ('00000000-0000-0000-0000-00000012a001', 1, 'CREATE_KEY')$$,
  '42501', NULL, 'l''API n''inscrit aucun travail directement');
RESET ROLE;

-- 2. Contraintes -----------------------------------------------------------------------------------------------------
SELECT lives_ok($$INSERT INTO tag_key_job (id, operator_id, key_index, kind, payload) VALUES
  ('00000000-0000-0000-0000-00000012c001','00000000-0000-0000-0000-00000012a001', 1, 'CREATE_KEY', '{"scope":"SHARED"}')$$, 'travail inscrit');
SELECT is((SELECT status || ':' || attempts FROM tag_key_job WHERE id = '00000000-0000-0000-0000-00000012c001'), 'PENDING:0', 'en attente à la création');
SELECT throws_ok($$INSERT INTO tag_key_job (operator_id, key_index, kind) VALUES ('00000000-0000-0000-0000-00000012a001', 1, 'CREATE_KEY')$$,
  '23505', NULL, 'un seul travail non terminé par (prestataire, index, sorte)');
SELECT lives_ok($$INSERT INTO tag_key_job (id, operator_id, key_index, kind) VALUES
  ('00000000-0000-0000-0000-00000012c002','00000000-0000-0000-0000-00000012a001', 1, 'ROTATE_DEK'),
  ('00000000-0000-0000-0000-00000012c003','00000000-0000-0000-0000-00000012a001', 2, 'CREATE_KEY')$$, 'autre sorte ou autre index : accepté');
SELECT throws_ok($$INSERT INTO tag_key_job (operator_id, key_index, kind) VALUES ('00000000-0000-0000-0000-00000012a001', 3, 'DESTROY_KEY')$$,
  '23514', NULL, 'sorte inconnue refusée');
SELECT throws_ok($$INSERT INTO tag_key_job (operator_id, key_index, kind) VALUES ('00000000-0000-0000-0000-00000012a001', 70000, 'CREATE_KEY')$$,
  '23514', NULL, 'index hors bornes refusé');
SELECT throws_ok(format($$INSERT INTO tag_key_job (operator_id, key_index, kind, payload) VALUES
  ('00000000-0000-0000-0000-00000012a001', 9, 'REENCRYPT', %L)$$, jsonb_build_object(k, 'x')), '23514', NULL, 'charge utile avec « ' || k || ' » refusée')
  FROM unnest(ARRAY['plaintext','dek','data_key','pwd','pwd_pack','secret','private_key','password']) k;
SELECT throws_ok($$INSERT INTO tag_key_job (operator_id, key_index, kind, progress) VALUES
  ('00000000-0000-0000-0000-00000012a001', 9, 'REENCRYPT', '{"dek":"x"}')$$, '23514', NULL, 'avancement avec un secret refusé');
SELECT throws_ok($$INSERT INTO tag_key_job (operator_id, key_index, kind, payload) VALUES
  ('00000000-0000-0000-0000-00000012a001', 9, 'REENCRYPT', '[1]')$$, '23514', NULL, 'charge utile qui n''est pas un objet refusée');

-- 3. File : prise, avancement, échec, relance, clôture ----------------------------------------------------------------
-- La file est travaillée par les processus des clés (post-roles.sql), jamais par l'API publique : ici la commande
-- d'administration, qui ne voit que ses sortes de travaux, sans prestataire de session (identifiant nul : une valeur
-- vide ferait échouer la conversion en uuid des politiques tenant_*).
SET LOCAL ROLE cashless_keyadmin;
SELECT set_config('app.operator_id', '00000000-0000-0000-0000-000000000000', true);
SELECT is((SELECT id FROM claim_tag_key_job(ARRAY['CREATE_KEY','DISABLE_KMS_KEY'])), '00000000-0000-0000-0000-00000012c001'::uuid,
  'le plus ancien travail des sortes demandées est pris');
SELECT is((SELECT status || ':' || attempts || ':' || (locked_until > clock_timestamp())::text FROM tag_key_job WHERE id = '00000000-0000-0000-0000-00000012c001'),
  'RUNNING:1:true', 'pris : RUNNING, une tentative, verrou posé');
SELECT is((SELECT id FROM claim_tag_key_job(ARRAY['CREATE_KEY','DISABLE_KMS_KEY'])), '00000000-0000-0000-0000-00000012c003'::uuid,
  'un travail pris n''est pas repris : le suivant vient');
SELECT is((SELECT count(*)::int FROM claim_tag_key_job(ARRAY['CREATE_KEY','DISABLE_KMS_KEY'])), 0, 'file vide : aucune ligne');
SELECT is((SELECT count(*)::int FROM claim_tag_key_job(ARRAY['REENCRYPT'])), 0, 'une sorte non demandée n''est pas prise');
SELECT throws_ok($$SELECT claim_tag_key_job(ARRAY['CREATE_KEY'], 0)$$, 'CL001', NULL, 'durée de verrou hors bornes');

SELECT lives_ok($$SELECT finish_tag_key_job('00000000-0000-0000-0000-00000012c001', 'RUNNING', NULL, '{"kms_key_ref":"test:k1"}')$$, 'avancement enregistré');
SELECT is((SELECT status || ' ' || (progress->>'kms_key_ref') FROM tag_key_job WHERE id = '00000000-0000-0000-0000-00000012c001'),
  'RUNNING test:k1', 'toujours pris, avancement gardé');
SELECT lives_ok($$SELECT finish_tag_key_job('00000000-0000-0000-0000-00000012c001', 'FAILED', 'service de clés indisponible')$$, 'échec enregistré');
SELECT is((SELECT status || ':' || last_error || ':' || (finished_at IS NULL)::text || ':' || (progress->>'kms_key_ref') FROM tag_key_job WHERE id = '00000000-0000-0000-0000-00000012c001'),
  'FAILED:service de clés indisponible:true:test:k1', 'en échec, erreur gardée, avancement conservé');
SELECT throws_ok($$SELECT finish_tag_key_job('00000000-0000-0000-0000-00000012c001', 'DONE')$$, 'CL020', NULL, 'un travail en échec ne se clôt pas sans être repris');
SELECT is((SELECT count(*)::int FROM claim_tag_key_job(ARRAY['CREATE_KEY'])), 0, 'un travail en échec n''est pas repris tout seul');
-- La relance est demandée par l'administrateur, donc par l'API publique.
SET LOCAL ROLE cashless_app;
SELECT set_config('app.operator_id', '00000000-0000-0000-0000-00000012a001', true);
SELECT lives_ok($$SELECT retry_tag_key_job('00000000-0000-0000-0000-00000012c001')$$, 'relance');
SELECT throws_ok($$SELECT retry_tag_key_job('00000000-0000-0000-0000-00000012c001')$$, 'CL020', NULL, 'on ne relance qu''un travail en échec');
SELECT throws_ok($$SELECT claim_tag_key_job(ARRAY['CREATE_KEY'])$$, '42501', NULL, 'l''API publique ne prend aucun travail');
SET LOCAL ROLE cashless_keyadmin;
SELECT set_config('app.operator_id', '00000000-0000-0000-0000-000000000000', true);
SELECT is((SELECT id FROM claim_tag_key_job(ARRAY['CREATE_KEY'])), '00000000-0000-0000-0000-00000012c001'::uuid, 'travail relancé repris');
SELECT is((SELECT attempts FROM tag_key_job WHERE id = '00000000-0000-0000-0000-00000012c001'), 2, 'deuxième tentative comptée');
SELECT lives_ok($$SELECT finish_tag_key_job('00000000-0000-0000-0000-00000012c001', 'DONE')$$, 'clôture');
SELECT is((SELECT status || ':' || (finished_at IS NOT NULL)::text || ':' || (locked_until IS NULL)::text FROM tag_key_job WHERE id = '00000000-0000-0000-0000-00000012c001'),
  'DONE:true:true', 'terminé, daté, verrou levé');
SELECT throws_ok($$SELECT finish_tag_key_job('00000000-0000-0000-0000-00000012c001', 'DONE')$$, 'CL020', NULL, 'un travail terminé ne se clôt pas deux fois');
SELECT throws_ok($$SELECT finish_tag_key_job('00000000-0000-0000-0000-00000012c003', 'CANCELLED')$$, 'CL001', NULL, 'statut de clôture inconnu');
RESET ROLE;
SELECT lives_ok($$INSERT INTO tag_key_job (operator_id, key_index, kind) VALUES ('00000000-0000-0000-0000-00000012a001', 1, 'CREATE_KEY')$$,
  'le travail terminé libère la place pour une nouvelle demande');

-- Reprise d'un travail dont le processus est mort : verrou échu.
RESET ROLE;
UPDATE tag_key_job SET locked_until = clock_timestamp() - interval '1 second' WHERE id = '00000000-0000-0000-0000-00000012c003';
SET LOCAL ROLE cashless_keyadmin;
SELECT set_config('app.operator_id', '00000000-0000-0000-0000-000000000000', true);
SELECT is((SELECT id FROM claim_tag_key_job(ARRAY['CREATE_KEY']) LIMIT 1), '00000000-0000-0000-0000-00000012c003'::uuid, 'verrou échu : le travail est repris');
SELECT is((SELECT attempts FROM tag_key_job WHERE id = '00000000-0000-0000-0000-00000012c003'), 2, 'reprise comptée comme une tentative');

-- 4. Comptes rendus du contrôle quotidien (écrits par le processus du contrôle quotidien) ------------------------------------
SET LOCAL ROLE cashless_tagcheck;
SELECT set_config('app.operator_id', '00000000-0000-0000-0000-00000012a001', true);
SELECT lives_ok($$INSERT INTO tag_key_check_run (id, operator_id, sampled, mismatches, status) VALUES
  ('00000000-0000-0000-0000-00000012d001','00000000-0000-0000-0000-00000012a001', 100, 0, 'OK')$$, 'compte rendu sans écart');
SELECT lives_ok($$INSERT INTO tag_key_check_run (operator_id, sampled, mismatches, status) VALUES
  ('00000000-0000-0000-0000-00000012a001', 100, 2, 'MISMATCH')$$, 'compte rendu avec écarts');
SELECT throws_ok($$INSERT INTO tag_key_check_run (operator_id, sampled, mismatches, status) VALUES
  ('00000000-0000-0000-0000-00000012a001', 100, 2, 'OK')$$, '23514', NULL, 'des écarts ne se déclarent pas OK');
SELECT throws_ok($$INSERT INTO tag_key_check_run (operator_id, sampled, mismatches, status) VALUES
  ('00000000-0000-0000-0000-00000012a001', 101, 0, 'OK')$$, '23514', NULL, 'échantillon de 100 bracelets au plus');
SELECT throws_ok($$UPDATE tag_key_check_run SET status = 'OK', mismatches = 0 WHERE status = 'MISMATCH'$$, NULL, NULL, 'un compte rendu ne se réécrit pas');

-- 5. Isolation -------------------------------------------------------------------------------------------------------------
SET LOCAL ROLE cashless_app;
SELECT set_config('app.operator_id', '00000000-0000-0000-0000-00000012a002', true);
SELECT is((SELECT count(*)::int FROM tag_key_job), 0, 'B ne voit aucun travail de A');
SELECT is((SELECT count(*)::int FROM tag_key_check_run), 0, 'B ne voit aucun compte rendu de A');
SELECT throws_ok($$SELECT retry_tag_key_job('00000000-0000-0000-0000-00000012c002')$$, 'CL020', NULL, 'B ne relance pas un travail de A');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
