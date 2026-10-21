-- Essais et audit des refus d'enrôlement (migration 0027 ; mission identite-enrolement-terminaux,
-- reprise du lot WP14 ; ADR-117) — pgTAP, écrit à la main (pas un fichier généré).
-- Lancer : pg_prove -d <base> tests/tests_enrollment_refusal.sql (base créée par les migrations,
-- roles.sql et post-roles.sql rejoués).
\set ON_ERROR_STOP 1
\set QUIET 1
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

-- Identifiants : pg_temp.id('27a001') = '00000000-0000-0000-0000-00000027a001'.
CREATE FUNCTION pg_temp.id(p text) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT ('00000000-0000-0000-0000-' || lpad(p, 12, '0'))::uuid $$;
-- Empreinte de test (32 octets).
CREATE FUNCTION pg_temp.h(p text) RETURNS bytea LANGUAGE sql IMMUTABLE AS
  $$ SELECT sha256(convert_to('0027 ' || p, 'UTF8')) $$;
-- Contrainte visée : « SQLSTATE:nom de la contrainte » de l'erreur levée (NULL si aucune).
CREATE FUNCTION pg_temp.ko(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v_state text; v_constraint text;
BEGIN
  EXECUTE p_sql;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_constraint = CONSTRAINT_NAME;
  RETURN v_state || ':' || coalesce(v_constraint, '');
END $$;
-- Refus enregistré avec le contexte de test ; rend true si écrit.
CREATE FUNCTION pg_temp.refuse(p_code bytea, p_address text, p_result text) RETURNS boolean
LANGUAGE sql AS $$
  SELECT record_enrollment_refusal(p_code, p_address::inet, p_result, 'raison de test',
                                   'SER-0027', 'ANDROID', p_address,
                                   '00000000-0000-0000-0000-00000027ffff')
$$;
-- Lignes d'audit des refus d'une adresse.
CREATE FUNCTION pg_temp.audits(p_address text) RETURNS SETOF audit_log LANGUAGE sql AS $$
  SELECT * FROM audit_log
   WHERE action = 'DEVICE_ENROLLMENT_REFUSED' AND after->>'address' = p_address
$$;

-- Données (propriétaire) : prestataire A, un code ouvert, un code expiré, un code utilisé.
INSERT INTO party (kind, legal_name) SELECT 'PLATFORM', 'Plateforme (test)'
 WHERE NOT EXISTS (SELECT 1 FROM party WHERE kind = 'PLATFORM');
INSERT INTO party (id, kind, legal_name, country_code) VALUES
 (pg_temp.id('27a001'), 'OPERATOR', 'Prestataire A', 'SN');
INSERT INTO party (id, kind, operator_id, legal_name) VALUES
 (pg_temp.id('27b001'), 'ORGANIZER', pg_temp.id('27a001'), 'Organisateur A');
INSERT INTO jurisdiction_profile (id, country_code, version, valid_from, breakage_destination)
VALUES (pg_temp.id('27c001'), 'SN', 200027, '2026-01-01', 'ORGANIZER');
INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone, jurisdiction_id,
                   funds_holder)
VALUES (pg_temp.id('27d001'), pg_temp.id('27a001'), pg_temp.id('27b001'), 'Événement A', 'XOF',
        'Africa/Dakar', pg_temp.id('27c001'), 'ORGANIZER');
INSERT INTO app_user (id, operator_id, issuer, subject, email, display_name)
VALUES (pg_temp.id('27e001'), pg_temp.id('27a001'), 'https://idp.test', 's0027', 'e@test',
        'Admin A');
INSERT INTO device (id, operator_id, event_id, serial) VALUES
 (pg_temp.id('27aa01'), pg_temp.id('27a001'), pg_temp.id('27d001'), 'USED-0027'),
 (pg_temp.id('27aa02'), pg_temp.id('27a001'), pg_temp.id('27d001'), 'USED-0027-2');
INSERT INTO device_enrollment_code (id, operator_id, code_hash, event_id, personal_phone,
                                    created_by, created_at, expires_at, used_at, device_id) VALUES
 (pg_temp.id('27f001'), pg_temp.id('27a001'), pg_temp.h('ouvert'), pg_temp.id('27d001'), false,
  pg_temp.id('27e001'), now(), now() + interval '1 day', NULL, NULL),
 (pg_temp.id('27f002'), pg_temp.id('27a001'), pg_temp.h('expiré'), pg_temp.id('27d001'), false,
  pg_temp.id('27e001'), now() - interval '2 hours', now() - interval '1 hour', NULL, NULL),
 (pg_temp.id('27f003'), pg_temp.id('27a001'), pg_temp.h('utilisé'), pg_temp.id('27d001'), false,
  pg_temp.id('27e001'), now(), now() + interval '1 day', now(), pg_temp.id('27aa01')),
 -- Second code utilisé pour le §4 : le premier atteint sa limite au §3, et depuis 0030 un refus
 -- au-delà de la limite s'écrit comme son franchissement (RATE_LIMITED).
 (pg_temp.id('27f004'), pg_temp.id('27a001'), pg_temp.h('utilisé 2'), pg_temp.id('27d001'), false,
  pg_temp.id('27e001'), now(), now() + interval '1 day', now(), pg_temp.id('27aa02'));

-- 1. Structure et droits --------------------------------------------------------------------------
SELECT ok((SELECT prosecdef AND proconfig @> ARRAY['search_path=public, pg_temp'] FROM pg_proc
            WHERE oid = 'record_enrollment_refusal(bytea,inet,text,text,text,text,text,uuid)'
                        ::regprocedure),
  'record_enrollment_refusal : SECURITY DEFINER, search_path public, pg_temp');
SELECT ok(NOT has_function_privilege('public',
            'record_enrollment_refusal(bytea,inet,text,text,text,text,text,uuid)', 'EXECUTE'),
  'record_enrollment_refusal : non exécutable par PUBLIC');
SELECT ok(has_function_privilege('cashless_app',
            'record_enrollment_refusal(bytea,inet,text,text,text,text,text,uuid)', 'EXECUTE'),
  'record_enrollment_refusal : exécutable par cashless_app (post-roles.sql §4a)');
SELECT is((SELECT count(*)::int FROM pg_constraint
            WHERE conrelid = 'device_enrollment_attempt'::regclass
              AND conname = 'device_enrollment_attempt_known_code'), 0,
  'essai : contrainte known_code retirée (ADR-117)');
SELECT is(pg_temp.ko(format($q$INSERT INTO device_enrollment_attempt
                     (operator_id, code_hash, address, result)
                   VALUES (%L, NULL, '10.27.0.9', 'CODE_INVALID')$q$, pg_temp.id('27a001'))),
  '23514:device_enrollment_attempt_operator_code', 'essai : prestataire sans empreinte refusé');
SELECT lives_ok(format($q$INSERT INTO device_enrollment_attempt
                  (operator_id, code_hash, address, result)
                  VALUES (NULL, %L, '10.27.0.9', 'CODE_INVALID')$q$, pg_temp.h('inconnu 0')),
  'essai : empreinte sans prestataire (code inconnu) acceptée');

-- Session : route sans compte, sous le rôle de l'API publique.
SET LOCAL ROLE cashless_app;
SELECT set_config('app.operator_id', '', true);

-- 2. Code inconnu : empreinte gardée, limite par code (B2) ----------------------------------------
SELECT record_enrollment_attempt(pg_temp.h('inconnu 1'), ('10.27.1.' || n)::inet, 'CODE_INVALID')
  FROM generate_series(1, 9) n;
SELECT is(enrollment_attempts_exceeded(pg_temp.h('inconnu 1'), '10.27.1.99'), false,
  'code inconnu : 9 refus, pas de limite');
SELECT record_enrollment_attempt(pg_temp.h('inconnu 1'), '10.27.1.10', 'ATTESTATION_FAILED');
SELECT is(enrollment_attempts_exceeded(pg_temp.h('inconnu 1'), '10.27.1.99'), true,
  'code inconnu : 10 refus dans l''heure, le 11e est limité (comme un code existant)');
RESET ROLE;
SELECT is((SELECT count(*)::int FROM device_enrollment_attempt
            WHERE code_hash = pg_temp.h('inconnu 1') AND operator_id IS NULL), 10,
  'code inconnu : essais rattachés à l''empreinte, sans prestataire');
SET LOCAL ROLE cashless_app;
SELECT set_config('app.operator_id', '', true);

-- 3. Seuls les refus comptent (N5) ----------------------------------------------------------------
-- 40 réussites depuis une adresse (codes distincts) : aucune limite.
SELECT record_enrollment_attempt(pg_temp.h('réussi ' || n), '10.27.2.1', 'ENROLLED')
  FROM generate_series(1, 40) n;
SELECT is(enrollment_attempts_exceeded(pg_temp.h('nouveau'), '10.27.2.1'), false,
  'adresse : 40 réussites dans l''heure, aucune limite');
SELECT record_enrollment_attempt(pg_temp.h('refus ' || n), '10.27.2.1', 'CODE_INVALID')
  FROM generate_series(1, 29) n;
SELECT is(enrollment_attempts_exceeded(pg_temp.h('nouveau'), '10.27.2.1'), false,
  'adresse : 40 réussites et 29 refus, pas de limite');
SELECT record_enrollment_attempt(pg_temp.h('refus 30'), '10.27.2.1', 'CODE_INVALID');
SELECT is(enrollment_attempts_exceeded(pg_temp.h('nouveau'), '10.27.2.1'), true,
  'adresse : 30 refus dans l''heure, le 31e est limité');
-- Code utilisé : la réussite ne compte pas, 10 refus comme pour un code inconnu.
SELECT record_enrollment_attempt(pg_temp.h('utilisé'), '10.27.3.1', 'ENROLLED');
SELECT record_enrollment_attempt(pg_temp.h('utilisé'), ('10.27.3.' || n)::inet, 'CODE_INVALID')
  FROM generate_series(2, 10) n;
SELECT is(enrollment_attempts_exceeded(pg_temp.h('utilisé'), '10.27.3.99'), false,
  'code utilisé : réussite et 9 refus, pas de limite (même seuil qu''un code inconnu)');
SELECT record_enrollment_attempt(pg_temp.h('utilisé'), '10.27.3.11', 'CODE_INVALID');
SELECT is(enrollment_attempts_exceeded(pg_temp.h('utilisé'), '10.27.3.99'), true,
  'code utilisé : 10 refus, le 11e est limité');

-- 4. Audit de chaque refus (B1) -------------------------------------------------------------------
SELECT ok(pg_temp.refuse(pg_temp.h('expiré'), '10.27.4.1', 'CODE_EXPIRED'), 'expiré : écrit');
SELECT ok(pg_temp.refuse(pg_temp.h('utilisé 2'), '10.27.4.2', 'CODE_INVALID'), 'utilisé : écrit');
SELECT ok(pg_temp.refuse(pg_temp.h('ouvert'), '10.27.4.3', 'MODE_NOT_ALLOWED'), 'mode : écrit');
SELECT ok(pg_temp.refuse(pg_temp.h('ouvert'), '10.27.4.4', 'VALIDATION_FAILED'),
  'validation, code connu : écrit');
SELECT ok(pg_temp.refuse(pg_temp.h('inconnu 4'), '10.27.4.5', 'CODE_INVALID'), 'inconnu : écrit');
SELECT ok(pg_temp.refuse(NULL, '10.27.4.6', 'VALIDATION_FAILED'), 'mal formé : écrit');
RESET ROLE;
SELECT is((SELECT array_agg(coalesce(operator_id::text, 'plateforme') || ' ' || (after->>'result')
                            || ' ' || coalesce(after->>'enrollment_code_id', '-')
                            ORDER BY after->>'address')
             FROM audit_log WHERE action = 'DEVICE_ENROLLMENT_REFUSED'
              AND after->>'address' LIKE '10.27.4.%'),
  ARRAY[pg_temp.id('27a001') || ' CODE_EXPIRED ' || pg_temp.id('27f002'),
        pg_temp.id('27a001') || ' CODE_INVALID ' || pg_temp.id('27f004'),
        pg_temp.id('27a001') || ' MODE_NOT_ALLOWED ' || pg_temp.id('27f001'),
        pg_temp.id('27a001') || ' VALIDATION_FAILED ' || pg_temp.id('27f001'),
        'plateforme CODE_INVALID -', 'plateforme VALIDATION_FAILED -'],
  'audit : chaîne du prestataire pour un code connu (même expiré ou utilisé), sinon plateforme');
SELECT is((SELECT count(*)::int FROM audit_log
            WHERE action = 'DEVICE_ENROLLMENT_REFUSED' AND after->>'address' LIKE '10.27.4.%'
              AND chain_key = coalesce(operator_id, audit_platform_chain())), 6,
  'audit : lignes chaînées dans la chaîne de leur prestataire ou de la plateforme');
SELECT is((SELECT count(*)::int FROM audit_log a
            WHERE action = 'DEVICE_ENROLLMENT_REFUSED' AND after->>'address' LIKE '10.27.4.%'
              AND (a::text LIKE '%' || encode(pg_temp.h('expiré'), 'hex') || '%'
                   OR a::text LIKE '%' || encode(pg_temp.h('inconnu 4'), 'hex') || '%'
                   OR a::text LIKE '%' || encode(pg_temp.h('ouvert'), 'hex') || '%')), 0,
  'audit : aucune empreinte de code');
SELECT is((SELECT after - 'enrollment_code_id' FROM pg_temp.audits('10.27.4.5')),
  jsonb_build_object('result', 'CODE_INVALID', 'reason', 'raison de test', 'address', '10.27.4.5',
                     'serial', 'SER-0027', 'os', 'ANDROID'),
  'audit : raison, adresse, serial et système annoncés');
SELECT is((SELECT array_agg(result || ' ' || coalesce(operator_id::text, 'plateforme')
                            || ' ' || (code_hash IS NOT NULL)::text ORDER BY address)
             FROM device_enrollment_attempt WHERE address << '10.27.4.0/24'),
  ARRAY['CODE_EXPIRED ' || pg_temp.id('27a001') || ' true',
        'CODE_INVALID ' || pg_temp.id('27a001') || ' true',
        'MODE_NOT_ALLOWED ' || pg_temp.id('27a001') || ' true',
        'VALIDATION_FAILED ' || pg_temp.id('27a001') || ' true',
        'CODE_INVALID plateforme true', 'VALIDATION_FAILED plateforme false'],
  'essais : écrits avec chaque refus, empreinte de tout code bien formé');
SELECT is((SELECT count(*)::int FROM device_enrollment_attempt WHERE address << '10.27.4.0/24'), 6,
  'essais : une ligne par refus');
SET LOCAL ROLE cashless_app;
SELECT set_config('app.operator_id', '', true);
SELECT throws_ok($$SELECT pg_temp.refuse(NULL, '10.27.4.7', 'ENROLLED')$$, 'CL001', NULL,
  'refus : ENROLLED refusé (une réussite s''écrit dans la transaction de l''enrôlement)');
SELECT throws_ok($$SELECT record_enrollment_refusal(NULL, NULL, 'CODE_INVALID', NULL, NULL, NULL,
                                                    NULL, NULL)$$, 'CL001', NULL,
  'refus : adresse obligatoire');
SELECT throws_ok($$SELECT pg_temp.refuse(NULL, '10.27.4.8', 'FOO')$$, 'CL001', NULL,
  'refus : résultat hors liste refusé');

-- 5. Au-delà d'une limite, une seule trace par fenêtre (N3) ---------------------------------------
-- Limite de l'adresse : 30 refus, puis trois 429.
SELECT pg_temp.refuse(pg_temp.h('adresse ' || n), '10.27.5.1', 'CODE_INVALID')
  FROM generate_series(1, 30) n;
SELECT is(ARRAY[pg_temp.refuse(pg_temp.h('adresse 31'), '10.27.5.1', 'RATE_LIMITED'),
                pg_temp.refuse(pg_temp.h('adresse 32'), '10.27.5.1', 'RATE_LIMITED'),
                pg_temp.refuse(NULL, '10.27.5.1', 'RATE_LIMITED')],
  ARRAY[true, false, false], 'adresse limitée : le premier 429 est tracé, les suivants non');
-- Limite d'un code (connu) depuis des adresses diverses, puis trois 429 de deux adresses. Le §4 a
-- déjà écrit deux refus de ce code : huit de plus atteignent la limite de 10.
SELECT pg_temp.refuse(pg_temp.h('ouvert'), '10.27.6.' || n, 'ATTESTATION_FAILED')
  FROM generate_series(1, 8) n;
SELECT is(ARRAY[pg_temp.refuse(pg_temp.h('ouvert'), '10.27.6.50', 'RATE_LIMITED'),
                pg_temp.refuse(pg_temp.h('ouvert'), '10.27.6.51', 'RATE_LIMITED'),
                pg_temp.refuse(pg_temp.h('ouvert'), '10.27.6.50', 'RATE_LIMITED')],
  ARRAY[true, false, false], 'code limité : le premier 429 est tracé, les suivants non');
-- Aucune limite franchie : rien n'est écrit.
SELECT is(pg_temp.refuse(pg_temp.h('libre'), '10.27.7.1', 'RATE_LIMITED'), false,
  '429 sans limite franchie : rien d''écrit');
RESET ROLE;
SELECT is((SELECT count(*)::int FROM device_enrollment_attempt
            WHERE address = '10.27.5.1' AND result = 'RATE_LIMITED'), 1,
  'adresse limitée : un seul essai RATE_LIMITED');
SELECT is((SELECT count(*)::int FROM pg_temp.audits('10.27.5.1')
            WHERE after->>'result' = 'RATE_LIMITED' AND operator_id IS NULL), 1,
  'adresse limitée : un seul audit RATE_LIMITED, chaîne de la plateforme (code inconnu)');
SELECT is((SELECT count(*)::int FROM device_enrollment_attempt
            WHERE code_hash = pg_temp.h('ouvert') AND result = 'RATE_LIMITED'), 1,
  'code limité : un seul essai RATE_LIMITED');
SELECT is((SELECT count(*)::int FROM audit_log
            WHERE action = 'DEVICE_ENROLLMENT_REFUSED' AND after->>'result' = 'RATE_LIMITED'
              AND after->>'address' LIKE '10.27.6.%' AND operator_id = pg_temp.id('27a001')), 1,
  'code limité : un seul audit RATE_LIMITED, chaîne du prestataire du code');
SELECT is((SELECT count(*)::int FROM device_enrollment_attempt WHERE address = '10.27.7.1'), 0,
  '429 sans limite franchie : aucun essai');
-- La fenêtre glisse : un RATE_LIMITED de plus d'une heure ne compte plus.
INSERT INTO device_enrollment_attempt (address, at, result)
SELECT '10.27.8.1', clock_timestamp() - interval '2 hours', 'RATE_LIMITED';
INSERT INTO device_enrollment_attempt (code_hash, address, result)
SELECT pg_temp.h('fenêtre ' || n), '10.27.8.1', 'CODE_INVALID' FROM generate_series(1, 30) n;
SELECT is(pg_temp.refuse(NULL, '10.27.8.1', 'RATE_LIMITED'), true,
  'fenêtre : un 429 d''il y a plus d''une heure n''empêche pas la trace du nouveau franchissement');

SELECT * FROM finish();
ROLLBACK;
