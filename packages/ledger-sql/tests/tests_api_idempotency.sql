-- Registre d'idempotence de l'API (S21, migration 0002) — pgTAP, écrit à la main (pas un fichier généré).
-- Lancer : pg_prove -d <base> tests/tests_api_idempotency.sql (base créée par les migrations, roles.sql rejoué).
\set ON_ERROR_STOP 1
\set QUIET 1
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(41);

-- Fixture : deux prestataires A et B
INSERT INTO party (id, kind, legal_name, country_code) VALUES
 ('00000000-0000-0000-0000-0000000e1d01','OPERATOR','Prestataire A','SN'),
 ('00000000-0000-0000-0000-0000000e1d02','OPERATOR','Prestataire B','SN');

-- Insère une ligne valide de A, avec des surcharges éventuelles (les CHECK sont testés une colonne à la fois).
CREATE FUNCTION pg_temp.idem_insert(p_operator uuid, p_key text, p_scope text DEFAULT 'app:',
  p_hash text DEFAULT repeat('a', 64), p_status text DEFAULT 'IN_PROGRESS',
  p_lease timestamptz DEFAULT now() + interval '30 seconds', p_response smallint DEFAULT NULL,
  p_completed timestamptz DEFAULT NULL, p_expires timestamptz DEFAULT now() + interval '24 hours')
RETURNS uuid LANGUAGE sql AS $$
  INSERT INTO api_idempotency (operator_id, scope, idempotency_key, request_hash, status, lease_until,
                               response_status, completed_at, expires_at)
  VALUES (p_operator, p_scope, p_key, p_hash, p_status, p_lease, p_response, p_completed, p_expires)
  RETURNING id
$$;

-- 1. Structure
SELECT has_table('api_idempotency');
SELECT col_is_pk('api_idempotency', 'id');
SELECT col_not_null('api_idempotency', c, 'colonne obligatoire : ' || c)
  FROM unnest(ARRAY['operator_id','scope','idempotency_key','request_hash','status','created_at','expires_at']) AS c;
SELECT fk_ok('api_idempotency', 'operator_id', 'party', 'id');
SELECT has_index('api_idempotency', 'api_idempotency_expires_at_idx', 'index de purge sur expires_at');

-- 2. Chaque CHECK refuse une valeur fautive (23514)
SELECT throws_ok($$SELECT pg_temp.idem_insert('00000000-0000-0000-0000-0000000e1d01', '')$$,
  '23514', NULL, 'clé vide refusée (api_idempotency_key_len)');
SELECT throws_ok($$SELECT pg_temp.idem_insert('00000000-0000-0000-0000-0000000e1d01', repeat('k', 256))$$,
  '23514', NULL, 'clé de 256 caractères refusée (api_idempotency_key_len)');
SELECT lives_ok($$SELECT pg_temp.idem_insert('00000000-0000-0000-0000-0000000e1d01', repeat('k', 255))$$,
  'clé de 255 caractères acceptée');
SELECT throws_ok($$SELECT pg_temp.idem_insert('00000000-0000-0000-0000-0000000e1d01', 'k-scope', '')$$,
  '23514', NULL, 'portée vide refusée (api_idempotency_scope_nonempty)');
SELECT throws_ok($$SELECT pg_temp.idem_insert('00000000-0000-0000-0000-0000000e1d01', 'k-hash', 'app:', repeat('A', 64))$$,
  '23514', NULL, 'empreinte en majuscules refusée (api_idempotency_hash_hex)');
SELECT throws_ok($$SELECT pg_temp.idem_insert('00000000-0000-0000-0000-0000000e1d01', 'k-hash2', 'app:', repeat('a', 63))$$,
  '23514', NULL, 'empreinte de 63 caractères refusée (api_idempotency_hash_hex)');
SELECT throws_ok($$SELECT pg_temp.idem_insert('00000000-0000-0000-0000-0000000e1d01', 'k-status', 'app:', repeat('a', 64), 'FAILED')$$,
  '23514', NULL, 'statut inconnu refusé (api_idempotency_status)');
SELECT throws_ok($$SELECT pg_temp.idem_insert('00000000-0000-0000-0000-0000000e1d01', 'k-lease', 'app:', repeat('a', 64), 'IN_PROGRESS', NULL)$$,
  '23514', NULL, 'IN_PROGRESS sans bail refusé (api_idempotency_in_progress)');
SELECT throws_ok($$SELECT pg_temp.idem_insert('00000000-0000-0000-0000-0000000e1d01', 'k-done1', 'app:', repeat('a', 64), 'COMPLETED', NULL, NULL, now())$$,
  '23514', NULL, 'COMPLETED sans statut de réponse refusé (api_idempotency_completed)');
SELECT throws_ok($$SELECT pg_temp.idem_insert('00000000-0000-0000-0000-0000000e1d01', 'k-done2', 'app:', repeat('a', 64), 'COMPLETED', NULL, 199::smallint, now())$$,
  '23514', NULL, 'statut de réponse 199 refusé (api_idempotency_completed)');
SELECT throws_ok($$SELECT pg_temp.idem_insert('00000000-0000-0000-0000-0000000e1d01', 'k-done3', 'app:', repeat('a', 64), 'COMPLETED', NULL, 600::smallint, now())$$,
  '23514', NULL, 'statut de réponse 600 refusé (api_idempotency_completed)');
SELECT throws_ok($$SELECT pg_temp.idem_insert('00000000-0000-0000-0000-0000000e1d01', 'k-done4', 'app:', repeat('a', 64), 'COMPLETED', NULL, 201::smallint, NULL)$$,
  '23514', NULL, 'COMPLETED sans date de fin refusé (api_idempotency_completed)');
SELECT lives_ok($$SELECT pg_temp.idem_insert('00000000-0000-0000-0000-0000000e1d01', 'k-done5', 'app:', repeat('a', 64), 'COMPLETED', NULL, 201::smallint, now())$$,
  'COMPLETED complet accepté (bail facultatif)');
SELECT throws_ok($$SELECT pg_temp.idem_insert('00000000-0000-0000-0000-0000000e1d01', 'k-exp', 'app:', repeat('a', 64), 'IN_PROGRESS', now() + interval '30 seconds', NULL, NULL, now())$$,
  '23514', NULL, 'expiration non postérieure à la création refusée (api_idempotency_expiry)');

-- 3. Unicité (operator_id, scope, idempotency_key)
SELECT lives_ok($$SELECT pg_temp.idem_insert('00000000-0000-0000-0000-0000000e1d01', 'k-1')$$, 'première insertion acceptée');
SELECT throws_ok($$SELECT pg_temp.idem_insert('00000000-0000-0000-0000-0000000e1d01', 'k-1')$$,
  '23505', NULL, 'même prestataire, même portée, même clé : refusé (api_idempotency_uniq)');
SELECT lives_ok($$SELECT pg_temp.idem_insert('00000000-0000-0000-0000-0000000e1d01', 'k-1', 'bo:')$$,
  'même clé, autre portée : accepté');
SELECT lives_ok($$SELECT pg_temp.idem_insert('00000000-0000-0000-0000-0000000e1d02', 'k-1')$$,
  'même clé, autre prestataire : accepté');

-- 4. Garde d'immuabilité et d'avancement (CL001)
SELECT throws_ok($$UPDATE api_idempotency SET request_hash = repeat('b', 64)
                   WHERE operator_id = '00000000-0000-0000-0000-0000000e1d01' AND scope = 'app:' AND idempotency_key = 'k-1'$$,
  'CL001', NULL, 'empreinte immuable');
SELECT throws_ok($$UPDATE api_idempotency SET idempotency_key = 'k-autre'
                   WHERE operator_id = '00000000-0000-0000-0000-0000000e1d01' AND scope = 'app:' AND idempotency_key = 'k-1'$$,
  'CL001', NULL, 'clé immuable');
SELECT throws_ok($$UPDATE api_idempotency SET operator_id = '00000000-0000-0000-0000-0000000e1d02'
                   WHERE operator_id = '00000000-0000-0000-0000-0000000e1d01' AND scope = 'bo:' AND idempotency_key = 'k-1'$$,
  'CL001', NULL, 'prestataire immuable');
SELECT lives_ok($$UPDATE api_idempotency SET lease_until = now() + interval '60 seconds'
                  WHERE operator_id = '00000000-0000-0000-0000-0000000e1d01' AND scope = 'app:' AND idempotency_key = 'k-1'$$,
  'IN_PROGRESS → IN_PROGRESS (reprise : nouveau bail) accepté');
SELECT lives_ok($$UPDATE api_idempotency SET status = 'COMPLETED', response_status = 201, completed_at = now(),
                         response_body = '{"ok":true}', response_headers = '{"Location":"/x"}'
                  WHERE operator_id = '00000000-0000-0000-0000-0000000e1d01' AND scope = 'app:' AND idempotency_key = 'k-1'$$,
  'IN_PROGRESS → COMPLETED avec réponse accepté');
SELECT throws_ok($$UPDATE api_idempotency SET status = 'IN_PROGRESS', lease_until = now() + interval '30 seconds'
                   WHERE operator_id = '00000000-0000-0000-0000-0000000e1d01' AND scope = 'app:' AND idempotency_key = 'k-1'$$,
  'CL001', NULL, 'COMPLETED → IN_PROGRESS refusé');

-- 5. RLS activée et forcée ; cloisonnement sous le rôle applicatif
SELECT ok((SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = 'api_idempotency'::regclass),
  'RLS activée et forcée');
SET LOCAL ROLE cashless_app;
SET LOCAL app.operator_id = '00000000-0000-0000-0000-0000000e1d01';
SELECT is((SELECT count(*) FROM api_idempotency WHERE operator_id = '00000000-0000-0000-0000-0000000e1d02'), 0::bigint,
  'A ne voit pas la ligne de B');
SELECT ok((SELECT count(*) FROM api_idempotency) > 0, 'A voit ses propres lignes');
SELECT is_empty($$UPDATE api_idempotency SET lease_until = now() + interval '90 seconds'
                  WHERE operator_id = '00000000-0000-0000-0000-0000000e1d02' RETURNING id$$,
  'A ne modifie aucune ligne de B');
SELECT throws_ok($$SELECT pg_temp.idem_insert('00000000-0000-0000-0000-0000000e1d02', 'k-intrus')$$,
  '42501', NULL, 'A ne peut pas écrire une ligne de B (WITH CHECK)');
RESET ROLE;

-- 6. Droits : aucune suppression pour le rôle applicatif
SELECT ok(NOT has_table_privilege('cashless_app', 'api_idempotency', 'DELETE'), 'cashless_app sans DELETE');

SELECT * FROM finish();
ROLLBACK;
