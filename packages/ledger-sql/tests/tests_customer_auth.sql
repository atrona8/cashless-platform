-- Authentification des festivaliers (migration 0080, post-roles.sql §10) — pgTAP, écrit à la main.
-- Prouve : RLS ENABLE + FORCE sur les cinq tables, isolation entre prestataires, droits exacts de cashless_app,
-- fonctions SECURITY DEFINER au search_path figé et inexécutables par les autres rôles.
-- Lancer : pg_prove -d <base> tests/tests_customer_auth.sql (base créée par les migrations, droits rejoués).
\set ON_ERROR_STOP 1
\set QUIET 1
BEGIN;
\ir _grants_for_tests.sql
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

CREATE FUNCTION pg_temp.id(p text) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT ('00000000-0000-0000-0000-' || lpad(p, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.h(p text) RETURNS bytea LANGUAGE sql IMMUTABLE AS
  $$ SELECT sha256(convert_to('80 ' || p, 'UTF8')) $$;

-- Données (propriétaire) : prestataires A et B, un festivalier chacun, un défi, un blocage, un jeton chacun.
INSERT INTO party (id, kind, legal_name, country_code) VALUES
 (pg_temp.id('80a001'), 'OPERATOR', 'Prestataire A', 'SN'),
 (pg_temp.id('80a002'), 'OPERATOR', 'Prestataire B', 'CI');
INSERT INTO party (id, kind, operator_id, legal_name) VALUES
 (pg_temp.id('80c001'), 'CUSTOMER', pg_temp.id('80a001'), 'Festivalier A'),
 (pg_temp.id('80c002'), 'CUSTOMER', pg_temp.id('80a002'), 'Festivalier B');
INSERT INTO operator_public_code (operator_id, code) VALUES
 (pg_temp.id('80a001'), 'test-a'), (pg_temp.id('80a002'), 'test-b');
INSERT INTO customer_identity (customer_id, operator_id, phone) VALUES
 (pg_temp.id('80c001'), pg_temp.id('80a001'), '+221770000001'),
 (pg_temp.id('80c002'), pg_temp.id('80a002'), '+221770000001');
INSERT INTO otp_challenge (id, operator_id, phone, channel, code_hash, client_ref, expires_at) VALUES
 (pg_temp.id('80d001'), pg_temp.id('80a001'), '+221770000001', 'SMS', pg_temp.h('d1'), 'r', now() + interval '5 min'),
 (pg_temp.id('80d002'), pg_temp.id('80a002'), '+221770000001', 'SMS', pg_temp.h('d2'), 'r', now() + interval '5 min');
INSERT INTO otp_phone_block (operator_id, phone, blocked_until) VALUES
 (pg_temp.id('80a001'), '+221770000009', now() + interval '30 min'),
 (pg_temp.id('80a002'), '+221770000009', now() + interval '30 min');
INSERT INTO customer_refresh_token (operator_id, customer_id, family_id, token_hash, expires_at) VALUES
 (pg_temp.id('80a001'), pg_temp.id('80c001'), pg_temp.id('80f001'), pg_temp.h('t1'), now() + interval '1 day'),
 (pg_temp.id('80a002'), pg_temp.id('80c002'), pg_temp.id('80f002'), pg_temp.h('t2'), now() + interval '1 day');

-- 1. RLS ENABLE + FORCE sur les cinq tables ---------------------------------------------------------------------------
SELECT is((SELECT string_agg(relname, ' ' ORDER BY relname) FROM pg_class
            WHERE relnamespace = 'public'::regnamespace
              AND relname IN ('operator_public_code', 'customer_identity', 'otp_challenge', 'otp_phone_block',
                              'customer_refresh_token')
              AND relrowsecurity AND relforcerowsecurity),
  'customer_identity customer_refresh_token operator_public_code otp_challenge otp_phone_block',
  'RLS ENABLE + FORCE sur les cinq tables');

-- 2. Droits exacts de cashless_app ------------------------------------------------------------------------------------
SELECT is((SELECT string_agg(t || ':' || p, ' ' ORDER BY t, p)
             FROM unnest(ARRAY['operator_public_code', 'customer_identity', 'otp_challenge', 'otp_phone_block',
                               'customer_refresh_token']) t,
                  unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p
            WHERE has_table_privilege('cashless_app', t, p)),
  'customer_identity:INSERT customer_identity:SELECT customer_refresh_token:INSERT customer_refresh_token:SELECT '
  'otp_challenge:INSERT otp_challenge:SELECT otp_phone_block:INSERT otp_phone_block:SELECT',
  'cashless_app : droits de table exacts (jamais UPDATE de table entière, DELETE, TRUNCATE)');
SELECT is((SELECT string_agg(t || '.' || a.attname, ' ' ORDER BY t, a.attname)
             FROM unnest(ARRAY['operator_public_code', 'customer_identity', 'otp_challenge', 'otp_phone_block',
                               'customer_refresh_token']) t
             JOIN pg_attribute a ON a.attrelid = ('public.' || t)::regclass AND a.attnum > 0 AND NOT a.attisdropped
            WHERE has_column_privilege('cashless_app', ('public.' || t)::regclass, a.attnum, 'UPDATE')),
  'customer_refresh_token.revoked_at customer_refresh_token.used_at otp_challenge.attempts '
  'otp_challenge.consumed_at otp_challenge.invalidated_at otp_phone_block.blocked_until',
  'cashless_app : colonnes modifiables exactes');
SELECT is((SELECT count(*)::int FROM unnest(ARRAY['operator_public_code', 'customer_identity', 'otp_challenge',
                                                  'otp_phone_block', 'customer_refresh_token']) t,
                  unnest(ARRAY['cashless_platform', 'cashless_tagkeys', 'cashless_perso', 'cashless_tagcheck',
                               'cashless_keyadmin', 'cashless_snapcontent', 'cashless_snapsign',
                               'cashless_maint']) r
            WHERE has_any_column_privilege(r, ('public.' || t)::regclass, 'SELECT')
               OR has_any_column_privilege(r, ('public.' || t)::regclass, 'INSERT')
               OR has_any_column_privilege(r, ('public.' || t)::regclass, 'UPDATE')), 0,
  'aucun autre rôle cashless_* ne lit ni n''écrit ces tables');

-- 3. Fonctions SECURITY DEFINER : search_path figé, exécutables par cashless_app seul ---------------------------------
SELECT is((SELECT string_agg(proname, ' ' ORDER BY proname) FROM pg_proc
            WHERE pronamespace = 'public'::regnamespace AND prosecdef
              AND proname IN ('operator_by_public_code', 'otp_challenge_operator', 'customer_refresh_operator')
              AND proconfig @> ARRAY['search_path=public, pg_temp']),
  'customer_refresh_operator operator_by_public_code otp_challenge_operator',
  'trois fonctions SECURITY DEFINER au search_path figé (public, pg_temp)');
SELECT is((SELECT string_agg(r || ':' || f, ' ' ORDER BY r, f)
             FROM unnest(ARRAY['public', 'cashless_platform', 'cashless_tagkeys', 'cashless_perso',
                               'cashless_tagcheck', 'cashless_keyadmin', 'cashless_snapcontent',
                               'cashless_snapsign', 'cashless_maint']) r,
                  unnest(ARRAY['operator_by_public_code(text)', 'otp_challenge_operator(uuid)',
                               'customer_refresh_operator(bytea)']) f
            WHERE has_function_privilege(r, f::regprocedure, 'EXECUTE')), NULL,
  'aucun autre rôle (PUBLIC compris) n''exécute les trois fonctions');
SELECT is((SELECT count(*)::int FROM unnest(ARRAY['operator_by_public_code(text)', 'otp_challenge_operator(uuid)',
                                                  'customer_refresh_operator(bytea)']) f
            WHERE has_function_privilege('cashless_app', f::regprocedure, 'EXECUTE')), 3,
  'cashless_app exécute les trois fonctions');

-- 4. Isolation entre prestataires (RLS) sous cashless_app --------------------------------------------------------------
SET LOCAL ROLE cashless_app;
SELECT set_config('app.operator_id', pg_temp.id('80a001')::text, true);
SELECT is((SELECT count(*)::int FROM customer_identity), 1, 'A ne voit que son numéro vérifié');
SELECT is((SELECT count(*)::int FROM otp_challenge), 1, 'A ne voit que son défi');
SELECT is((SELECT count(*)::int FROM otp_phone_block), 1, 'A ne voit que son blocage');
SELECT is((SELECT count(*)::int FROM customer_refresh_token), 1, 'A ne voit que son jeton');
SELECT is((SELECT operator_id FROM customer_identity), pg_temp.id('80a001'), 'le numéro vu est celui de A');
SELECT throws_ok(format($q$INSERT INTO customer_identity (customer_id, operator_id, phone)
                            VALUES (%L, %L, '+221770000077')$q$, pg_temp.id('80c002'), pg_temp.id('80a002')),
  '42501', NULL, 'A ne peut pas écrire une ligne au nom de B (RLS WITH CHECK)');
SELECT throws_ok('SELECT code FROM operator_public_code', '42501', NULL,
  'cashless_app ne lit pas operator_public_code directement');
SELECT throws_ok('UPDATE customer_identity SET phone = phone', '42501', NULL,
  'cashless_app ne modifie jamais un numéro vérifié');
SELECT throws_ok('UPDATE otp_challenge SET code_hash = code_hash', '42501', NULL,
  'cashless_app ne réécrit pas l''empreinte d''un code');
SELECT throws_ok('DELETE FROM otp_challenge', '42501', NULL, 'cashless_app ne supprime aucun défi');
-- Les fonctions rendent le prestataire de n'importe quel défi : seul l'identifiant sort.
SELECT is(operator_by_public_code('TEST-B'), pg_temp.id('80a002'), 'code public (insensible à la casse) : prestataire B');
SELECT is(operator_by_public_code('inconnu'), NULL, 'code public inconnu : rien');
SELECT is(otp_challenge_operator(pg_temp.id('80d002')), pg_temp.id('80a002'), 'défi de B : prestataire B');
SELECT is(customer_refresh_operator(pg_temp.h('t2')), pg_temp.id('80a002'), 'jeton de B : prestataire B');
RESET ROLE;

-- 5. Garde-fous des tables ---------------------------------------------------------------------------------------------
SELECT throws_ok($q$INSERT INTO customer_identity (customer_id, operator_id, phone)
                    SELECT pg_temp.id('80c001'), pg_temp.id('80a001'), '+221770000002'$q$, '23505', NULL,
  'un compte n''a qu''un numéro');
SELECT throws_ok($q$INSERT INTO customer_identity (customer_id, operator_id, phone)
                    SELECT gen_random_uuid(), pg_temp.id('80a001'), '+221770000066'$q$, '23503', NULL,
  'un numéro est lié à une partie existante');
SELECT throws_ok($q$INSERT INTO otp_challenge (operator_id, phone, channel, code_hash, client_ref, expires_at, attempts)
                    VALUES (pg_temp.id('80a001'), '+221770000001', 'SMS', pg_temp.h('x'), 'r', now(), 6)$q$,
  '23514', NULL, 'au plus 5 essais par défi');
SELECT throws_ok($q$INSERT INTO operator_public_code (operator_id, code) VALUES (pg_temp.id('80a001'), 'Mauvais Code')$q$,
  '23514', NULL, 'code public : minuscules, chiffres et tirets');

SELECT * FROM finish();
ROLLBACK;
