-- Journal d'audit chaîné et scellé (migration 0004) — pgTAP, écrit à la main (pas un fichier généré).
-- Lancer : pg_prove -d <base> tests/tests_audit_log.sql (base créée par les migrations, roles.sql rejoué).
\set ON_ERROR_STOP 1
\set QUIET 1
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

INSERT INTO party (id, kind, legal_name, country_code) VALUES
 ('00000000-0000-0000-0000-0000000a0d01','OPERATOR','Prestataire A','SN'),
 ('00000000-0000-0000-0000-0000000a0d02','OPERATOR','Prestataire B','CI');

CREATE FUNCTION pg_temp.audit(p_operator uuid, p_action text, p_after jsonb DEFAULT NULL) RETURNS bigint
LANGUAGE sql AS $$
  INSERT INTO audit_log (operator_id, actor_id, actor_role, action, object_type, object_id, after, origin, request_id)
  VALUES (p_operator, '00000000-0000-0000-0000-0000000a0e01', 'OPERATOR_ADMIN', p_action, 'app_user', 'u-1', p_after,
          '127.0.0.1', '00000000-0000-0000-0000-0000000a0f01')
  RETURNING seq
$$;
CREATE FUNCTION pg_temp.problems(p_chain uuid) RETURNS int LANGUAGE sql AS $$
  SELECT count(*)::int FROM verify_audit_chain(p_chain)
$$;

-- 1. Structure et protections
SELECT has_table('audit_log');
SELECT has_table('audit_seal');
SELECT is((SELECT relforcerowsecurity FROM pg_class WHERE relname = 'audit_log'), true, 'audit_log : RLS forcée');
SELECT is((SELECT relforcerowsecurity FROM pg_class WHERE relname = 'audit_seal'), true, 'audit_seal : RLS forcée');
SELECT has_function('audit_chain_genesis', ARRAY['uuid']);
SELECT has_function('seal_audit', ARRAY['uuid', 'interval']);
SELECT has_function('verify_audit_chain', ARRAY['uuid', 'timestamp with time zone']);

-- 2. Chaînage
SELECT is(pg_temp.audit('00000000-0000-0000-0000-0000000a0d01', 'USER_CREATED'), 1::bigint, 'première ligne : seq 1');
SELECT is(pg_temp.audit('00000000-0000-0000-0000-0000000a0d01', 'ROLE_GRANTED', '{"role":"CASHIER"}'), 2::bigint, 'deuxième ligne : seq 2');
SELECT is(pg_temp.audit('00000000-0000-0000-0000-0000000a0d01', 'ROLE_REVOKED'), 3::bigint, 'troisième ligne : seq 3');
SELECT is(pg_temp.audit('00000000-0000-0000-0000-0000000a0d02', 'USER_CREATED'), 1::bigint, 'autre prestataire : chaîne indépendante');
SELECT is(pg_temp.audit(NULL, 'PLATFORM_ADMIN_BOOTSTRAPPED'), 1::bigint, 'plateforme : chaîne propre');
SELECT is((SELECT chain_key FROM audit_log WHERE operator_id IS NULL), '00000000-0000-0000-0000-000000000000'::uuid,
  'chaîne de la plateforme : clé nulle');
SELECT is((SELECT prev_hash FROM audit_log WHERE chain_key = '00000000-0000-0000-0000-0000000a0d01' AND seq = 1),
  audit_chain_genesis('00000000-0000-0000-0000-0000000a0d01'), 'seq 1 : prev_hash = genèse');
SELECT is((SELECT prev_hash FROM audit_log WHERE chain_key = '00000000-0000-0000-0000-0000000a0d01' AND seq = 2),
  (SELECT row_hash FROM audit_log WHERE chain_key = '00000000-0000-0000-0000-0000000a0d01' AND seq = 1), 'seq 2 : chaîné sur seq 1');
SELECT is(audit_chain_genesis('00000000-0000-0000-0000-0000000a0d01'),
  sha256(convert_to('CASHLESS/AUDIT/v1', 'UTF8') || uuid_send('00000000-0000-0000-0000-0000000a0d01'::uuid)), 'genèse conforme au contrat');
INSERT INTO audit_log (operator_id, action, seq, prev_hash, row_hash)
VALUES ('00000000-0000-0000-0000-0000000a0d01', 'FORGED', 99, '\x00'::bytea, '\x00'::bytea);
SELECT is((SELECT seq FROM audit_log WHERE action = 'FORGED'), 4::bigint, 'seq fourni écrasé par le déclencheur');
SELECT is((SELECT octet_length(row_hash) FROM audit_log WHERE action = 'FORGED'), 32, 'empreintes fournies écrasées');
SELECT is(pg_temp.problems('00000000-0000-0000-0000-0000000a0d01'), 0, 'chaîne intacte : aucune anomalie');

-- 3. Ajout seul
SELECT throws_ok($$UPDATE audit_log SET action = 'X' WHERE seq = 1$$, 'CL001', NULL, 'modification refusée (propriétaire compris)');
SELECT throws_ok($$DELETE FROM audit_log WHERE seq = 1$$, 'CL001', NULL, 'suppression refusée (propriétaire compris)');

-- 4. Scellement
SELECT is(seal_audit('00000000-0000-0000-0000-0000000a0d01'), NULL, 'rien à sceller avant 5 minutes');
SELECT is((seal_audit('00000000-0000-0000-0000-0000000a0d01', interval '0')).last_seq, 4::bigint, 'premier scellement : lignes 1 à 4');
SELECT is(seal_audit('00000000-0000-0000-0000-0000000a0d01', interval '0'), NULL, 'rien de nouveau : pas de scellement');
SELECT pg_temp.audit('00000000-0000-0000-0000-0000000a0d01', 'USER_DISABLED');
SELECT is((seal_audit('00000000-0000-0000-0000-0000000a0d01', interval '0')).seal_no, 2, 'second scellement');
SELECT is((SELECT prev_seal_hash FROM audit_seal WHERE chain_key = '00000000-0000-0000-0000-0000000a0d01' AND seal_no = 2),
  (SELECT seal_hash FROM audit_seal WHERE chain_key = '00000000-0000-0000-0000-0000000a0d01' AND seal_no = 1), 'scellements chaînés');
SELECT is((SELECT prev_seal_hash FROM audit_seal WHERE chain_key = '00000000-0000-0000-0000-0000000a0d01' AND seal_no = 1),
  audit_chain_genesis('00000000-0000-0000-0000-0000000a0d01'), 'premier scellement : part de la genèse');
SELECT is(pg_temp.problems('00000000-0000-0000-0000-0000000a0d01'), 0, 'chaîne et scellements intacts');
SELECT lives_ok($$UPDATE audit_seal SET external_ref = 's3://audit/1' WHERE chain_key = '00000000-0000-0000-0000-0000000a0d01' AND seal_no = 1$$,
  'external_ref renseignée une fois');
SELECT throws_ok($$UPDATE audit_seal SET external_ref = 's3://autre' WHERE chain_key = '00000000-0000-0000-0000-0000000a0d01' AND seal_no = 1$$,
  'CL001', NULL, 'external_ref déjà renseignée : refus');
SELECT throws_ok($$UPDATE audit_seal SET rows = 9 WHERE chain_key = '00000000-0000-0000-0000-0000000a0d01' AND seal_no = 2$$,
  'CL001', NULL, 'scellement non modifiable');
SELECT throws_ok($$DELETE FROM audit_seal WHERE chain_key = '00000000-0000-0000-0000-0000000a0d01'$$,
  'CL001', NULL, 'scellement non supprimable');

-- 5. Altérations simulées par le propriétaire (déclencheurs désactivés) : toutes détectées (NFR-007)
ALTER TABLE audit_log DISABLE TRIGGER audit_log_append_only;
SAVEPOINT alteration;
UPDATE audit_log SET after = '{"role":"PLATFORM_ADMIN"}' WHERE chain_key = '00000000-0000-0000-0000-0000000a0d01' AND seq = 2;
SELECT ok(pg_temp.problems('00000000-0000-0000-0000-0000000a0d01') > 0, 'champ modifié : détecté');
ROLLBACK TO SAVEPOINT alteration;
DELETE FROM audit_log WHERE chain_key = '00000000-0000-0000-0000-0000000a0d01' AND seq = 3;
SELECT ok(pg_temp.problems('00000000-0000-0000-0000-0000000a0d01') > 0, 'ligne supprimée : détectée');
ROLLBACK TO SAVEPOINT alteration;
ALTER TABLE audit_log DISABLE TRIGGER audit_log_chain;
UPDATE audit_log SET seq = seq + 100 WHERE chain_key = '00000000-0000-0000-0000-0000000a0d01' AND seq >= 3;
UPDATE audit_log SET seq = seq - 99 WHERE chain_key = '00000000-0000-0000-0000-0000000a0d01' AND seq >= 100;
INSERT INTO audit_log (operator_id, chain_key, seq, occurred_at, action, prev_hash, row_hash)
SELECT '00000000-0000-0000-0000-0000000a0d01', '00000000-0000-0000-0000-0000000a0d01', 3, occurred_at, 'INSERTED', row_hash,
       sha256(row_hash) FROM audit_log WHERE chain_key = '00000000-0000-0000-0000-0000000a0d01' AND seq = 2;
SELECT ok(pg_temp.problems('00000000-0000-0000-0000-0000000a0d01') > 0, 'ligne insérée au milieu : détectée');
ROLLBACK TO SAVEPOINT alteration;
ALTER TABLE audit_seal DISABLE TRIGGER audit_seal_append_only;
UPDATE audit_seal SET seal_hash = sha256('faux'::bytea) WHERE chain_key = '00000000-0000-0000-0000-0000000a0d01' AND seal_no = 2;
SELECT ok(pg_temp.problems('00000000-0000-0000-0000-0000000a0d01') > 0, 'scellement falsifié : détecté');
ROLLBACK TO SAVEPOINT alteration;
SELECT is(pg_temp.problems('00000000-0000-0000-0000-0000000a0d01'), 0, 'après retour arrière : chaîne intacte');

-- 6. RLS sous le rôle applicatif
SET LOCAL ROLE cashless_app;
SELECT set_config('app.operator_id', '00000000-0000-0000-0000-0000000a0d02', true);
SELECT is((SELECT count(*)::int FROM audit_log), 1, 'prestataire B : ses seules lignes');
SELECT is((SELECT count(*)::int FROM audit_seal), 0, 'prestataire B : aucun scellement de A visible');
SELECT throws_ok($$INSERT INTO audit_log (operator_id, action) VALUES ('00000000-0000-0000-0000-0000000a0d01', 'INTRUS')$$,
  '42501', NULL, 'écriture dans la chaîne de A refusée (RLS)');
SELECT is(pg_temp.audit('00000000-0000-0000-0000-0000000a0d02', 'ROLE_GRANTED'), 2::bigint,
  'écriture sous le rôle applicatif : chaînée (seq 2)');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
