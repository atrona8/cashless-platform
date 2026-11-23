-- Canaux d'envoi des codes (migration 0099, mission serveur-app-festivalier, lot WP03 ; FR-011 à FR-013,
-- NFR-002) — pgTAP, écrit à la main. Prouve : aucune colonne de code ou de numéro, contraintes, clé composite
-- vers le défi du même prestataire, RLS ENABLE + FORCE et isolation sous cashless_app.
-- Lancer : pg_prove -d <base> tests/tests_otp_channel_attempt.sql
\set ON_ERROR_STOP 1
\set QUIET 1
BEGIN;
\ir _grants_for_tests.sql
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

CREATE FUNCTION pg_temp.id(p text) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT ('00000000-0000-0000-0000-' || lpad(p, 12, '0'))::uuid $$;

INSERT INTO party (id, kind, legal_name, country_code) VALUES
 (pg_temp.id('99a001'), 'OPERATOR', 'Prestataire A', 'SN'),
 (pg_temp.id('99a002'), 'OPERATOR', 'Prestataire B', 'CI');
INSERT INTO otp_challenge (id, operator_id, phone, channel, code_hash, client_ref, expires_at) VALUES
 (pg_temp.id('99d001'), pg_temp.id('99a001'), '+221770000001', 'AUTO', sha256('d1'), 'r', now() + interval '5 min'),
 (pg_temp.id('99d002'), pg_temp.id('99a002'), '+221770000001', 'AUTO', sha256('d2'), 'r', now() + interval '5 min');

-- 1. Forme -------------------------------------------------------------------------------------------------------
SELECT set_eq($$SELECT attname::text FROM pg_attribute WHERE attrelid = 'otp_channel_attempt'::regclass
                  AND attnum > 0 AND NOT attisdropped$$,
  $$VALUES ('id'), ('operator_id'), ('challenge_id'), ('channel'), ('provider'), ('sent_at'), ('confirmed_at'),
           ('failed_reason')$$, 'colonnes exactes');
SELECT is((SELECT count(*)::int FROM pg_attribute WHERE attrelid = 'otp_channel_attempt'::regclass
            AND attnum > 0 AND NOT attisdropped AND attname IN ('code', 'code_hash', 'phone')), 0,
  'aucune colonne code, code_hash, phone');
SELECT is((SELECT count(*)::int FROM pg_attribute WHERE attrelid = 'otp_channel_attempt'::regclass
            AND attnum > 0 AND NOT attisdropped AND atttypid = 'bytea'::regtype), 0, 'aucune colonne bytea');
SELECT is((SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = 'otp_channel_attempt'::regclass),
  true, 'RLS ENABLE + FORCE');
SELECT is((SELECT count(*)::int FROM pg_policy WHERE polrelid = 'otp_channel_attempt'::regclass), 1,
  'une politique tenant_isolation');
SELECT is((SELECT count(*)::int FROM pg_indexes WHERE tablename = 'otp_channel_attempt'
            AND indexdef LIKE '%(challenge_id, sent_at)'), 1, 'index (challenge_id, sent_at)');
SELECT is((SELECT count(*)::int FROM information_schema.role_table_grants
            WHERE table_name = 'otp_channel_attempt' AND grantee = 'PUBLIC'), 0, 'aucun droit pour PUBLIC');

-- 2. Contraintes (propriétaire) -----------------------------------------------------------------------------------
INSERT INTO otp_channel_attempt (id, operator_id, challenge_id, channel, provider, failed_reason) VALUES
 (pg_temp.id('99e001'), pg_temp.id('99a001'), pg_temp.id('99d001'), 'WHATSAPP', 'fake-whatsapp', 'NO_WHATSAPP');
INSERT INTO otp_channel_attempt (id, operator_id, challenge_id, channel, provider, confirmed_at) VALUES
 (pg_temp.id('99e002'), pg_temp.id('99a001'), pg_temp.id('99d001'), 'SMS_PRIMARY', 'fake-sms', now());
SELECT is((SELECT channel || ':' || provider || ':' || coalesce(failed_reason, '-') || ':' || (confirmed_at IS NULL)
             FROM otp_channel_attempt WHERE id = pg_temp.id('99e001')),
  'WHATSAPP:fake-whatsapp:NO_WHATSAPP:true', 'ligne valide lue en valeur (échec)');
SELECT is((SELECT confirmed_at IS NOT NULL AND failed_reason IS NULL FROM otp_channel_attempt
            WHERE id = pg_temp.id('99e002')), true, 'ligne valide lue en valeur (confirmée)');
SELECT throws_ok($$INSERT INTO otp_channel_attempt (operator_id, challenge_id, channel, provider) VALUES
  ('00000000-0000-0000-0000-00000099a001', '00000000-0000-0000-0000-00000099d001', 'TELEGRAM', 'x')$$,
  '23514', NULL, 'canal hors liste : 23514');
SELECT throws_ok($$INSERT INTO otp_channel_attempt (operator_id, challenge_id, channel, provider, confirmed_at,
  failed_reason) VALUES ('00000000-0000-0000-0000-00000099a001', '00000000-0000-0000-0000-00000099d001',
  'SMS_FALLBACK', 'x', now(), 'TIMEOUT')$$, '23514', NULL, 'confirmed_at et failed_reason ensemble : 23514');
SELECT throws_ok(format($f$INSERT INTO otp_channel_attempt (operator_id, challenge_id, channel, provider,
  failed_reason) VALUES ('00000000-0000-0000-0000-00000099a001', '00000000-0000-0000-0000-00000099d001',
  'SMS_FALLBACK', 'x', %L)$f$, r), '23514', NULL, 'failed_reason refusé : ' || r)
  FROM unnest(ARRAY['timeout', 'NO WHATSAPP', '+221770000001', '221770000001', '123456', '']) r;
SELECT throws_ok($$INSERT INTO otp_channel_attempt (operator_id, challenge_id, channel, provider) VALUES
  ('00000000-0000-0000-0000-00000099a001', '00000000-0000-0000-0000-00000099d001', 'SMS_FALLBACK', '')$$,
  '23514', NULL, 'provider vide : 23514');
SELECT throws_ok(format($f$INSERT INTO otp_channel_attempt (operator_id, challenge_id, channel, provider)
  VALUES ('00000000-0000-0000-0000-00000099a001', '00000000-0000-0000-0000-00000099d001', 'SMS_FALLBACK',
  %L)$f$, repeat('p', 65)), '23514', NULL, 'provider de 65 caractères : 23514');
SELECT throws_ok($$INSERT INTO otp_channel_attempt (operator_id, challenge_id, channel, provider) VALUES
  ('00000000-0000-0000-0000-00000099a001', '00000000-0000-0000-0000-00000099d002', 'WHATSAPP', 'x')$$,
  '23503', NULL, 'défi du prestataire B avec operator_id de A : 23503');

-- 3. RLS : droits locaux à la transaction, jamais dans 0099 -----------------------------------------------------
GRANT SELECT, INSERT ON otp_channel_attempt TO cashless_app;
INSERT INTO otp_channel_attempt (id, operator_id, challenge_id, channel, provider) VALUES
 (pg_temp.id('99e011'), pg_temp.id('99a002'), pg_temp.id('99d002'), 'SMS_PRIMARY', 'fake-sms');
SET LOCAL ROLE cashless_app;
SELECT set_config('app.operator_id', pg_temp.id('99a001')::text, true);
SELECT is((SELECT count(*)::int FROM otp_channel_attempt WHERE challenge_id IN
            (pg_temp.id('99d001'), pg_temp.id('99d002'))), 2, 'sous A : voit ses deux lignes (contrôle positif)');
SELECT is((SELECT count(*)::int FROM otp_channel_attempt WHERE id = pg_temp.id('99e011')), 0,
  'sous A : la ligne de B est invisible');
SELECT throws_ok($$INSERT INTO otp_channel_attempt (operator_id, challenge_id, channel, provider) VALUES
  ('00000000-0000-0000-0000-00000099a002', '00000000-0000-0000-0000-00000099d002', 'WHATSAPP', 'x')$$,
  '42501', NULL, 'sous A : insérer pour B refusé par la RLS');
SELECT set_config('app.operator_id', pg_temp.id('99a002')::text, true);
SELECT is((SELECT count(*)::int FROM otp_channel_attempt), 1, 'sous B : voit sa seule ligne');
SELECT is((SELECT id FROM otp_channel_attempt), pg_temp.id('99e011'), 'sous B : la bonne ligne');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
