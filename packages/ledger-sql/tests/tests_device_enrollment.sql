-- Enrôlement et statut des terminaux (migration 0022, S5 ; mission identite-enrolement-terminaux, lot
-- WP03 ; ADR-109) — pgTAP, écrit à la main (pas un fichier généré).
-- Lancer : pg_prove -d <base> tests/tests_device_enrollment.sql (base créée par les migrations,
-- roles.sql et post-roles.sql rejoués).
-- Deux enrôlements réellement concurrents ne se simulent pas en pgTAP (une seule session) : la suite
-- vérifie que le second appel sur un code utilisé échoue ; la concurrence est prouvée par les tests
-- d'intégration de l'API (20 enrôlements simultanés, NFR-008).
\set ON_ERROR_STOP 1
\set QUIET 1
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

-- Identifiants : pg_temp.id('22a001') = '00000000-0000-0000-0000-00000022a001'.
CREATE FUNCTION pg_temp.id(p text) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT ('00000000-0000-0000-0000-' || lpad(p, 12, '0'))::uuid $$;
-- Empreinte de test (32 octets).
CREATE FUNCTION pg_temp.h(p text) RETURNS bytea LANGUAGE sql IMMUTABLE AS
  $$ SELECT sha256(convert_to('0022 ' || p, 'UTF8')) $$;

-- Données (propriétaire) ------------------------------------------------------------------------
-- A : organisateurs b001 (événement d001, point de vente f101) et b002 (événement d002, point de
-- vente f102) ; B : organisateur b011 (événement d011, point de vente f111).
INSERT INTO party (kind, legal_name) SELECT 'PLATFORM', 'Plateforme (test)'
 WHERE NOT EXISTS (SELECT 1 FROM party WHERE kind = 'PLATFORM');
INSERT INTO party (id, kind, legal_name, country_code) VALUES
 (pg_temp.id('22a001'), 'OPERATOR', 'Prestataire A', 'SN'),
 (pg_temp.id('22a002'), 'OPERATOR', 'Prestataire B', 'CI');
INSERT INTO party (id, kind, operator_id, legal_name) VALUES
 (pg_temp.id('22b001'), 'ORGANIZER', pg_temp.id('22a001'), 'Organisateur A1'),
 (pg_temp.id('22b002'), 'ORGANIZER', pg_temp.id('22a001'), 'Organisateur A2'),
 (pg_temp.id('22b011'), 'ORGANIZER', pg_temp.id('22a002'), 'Organisateur B'),
 (pg_temp.id('22b101'), 'MERCHANT', pg_temp.id('22a001'), 'Commerçant A'),
 (pg_temp.id('22b111'), 'MERCHANT', pg_temp.id('22a002'), 'Commerçant B');
INSERT INTO jurisdiction_profile (id, country_code, version, valid_from, breakage_destination)
VALUES (pg_temp.id('22c001'), 'SN', 200022, '2026-01-01', 'ORGANIZER');
INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone, jurisdiction_id,
                   funds_holder) VALUES
 (pg_temp.id('22d001'), pg_temp.id('22a001'), pg_temp.id('22b001'), 'Événement A1', 'XOF',
  'Africa/Dakar', pg_temp.id('22c001'), 'ORGANIZER'),
 (pg_temp.id('22d002'), pg_temp.id('22a001'), pg_temp.id('22b002'), 'Événement A2', 'XOF',
  'Africa/Dakar', pg_temp.id('22c001'), 'ORGANIZER'),
 (pg_temp.id('22d011'), pg_temp.id('22a002'), pg_temp.id('22b011'), 'Événement B', 'XOF',
  'Africa/Dakar', pg_temp.id('22c001'), 'ORGANIZER');
INSERT INTO merchant_participation (id, operator_id, event_id, merchant_id, link_type, payout_to) VALUES
 (pg_temp.id('22f001'), pg_temp.id('22a001'), pg_temp.id('22d001'), pg_temp.id('22b101'), 'INTERNAL',
  pg_temp.id('22b001')),
 (pg_temp.id('22f002'), pg_temp.id('22a001'), pg_temp.id('22d002'), pg_temp.id('22b101'), 'INTERNAL',
  pg_temp.id('22b002')),
 (pg_temp.id('22f011'), pg_temp.id('22a002'), pg_temp.id('22d011'), pg_temp.id('22b111'), 'INTERNAL',
  pg_temp.id('22b011'));
INSERT INTO point_of_sale (id, operator_id, participation_id, name) VALUES
 (pg_temp.id('22f101'), pg_temp.id('22a001'), pg_temp.id('22f001'), 'Bar A1'),
 (pg_temp.id('22f102'), pg_temp.id('22a001'), pg_temp.id('22f002'), 'Bar A2'),
 (pg_temp.id('22f111'), pg_temp.id('22a002'), pg_temp.id('22f011'), 'Bar B');
-- Personnes : e001 OPERATOR_ADMIN de A ; e002 ORGANIZER_ADMIN de b001 ; e003 de A sans rôle ;
-- e011 OPERATOR_ADMIN de B.
INSERT INTO app_user (id, operator_id, issuer, subject, email, display_name)
SELECT pg_temp.id(u), pg_temp.id(o), 'https://idp.test', 's0022' || u, u || '@test', 'Personne ' || u
  FROM (VALUES ('22e001', '22a001'), ('22e002', '22a001'), ('22e003', '22a001'),
               ('22e011', '22a002')) AS v(u, o);
INSERT INTO role_assignment (user_id, role, scope_type, scope_id, granted_by) VALUES
 (pg_temp.id('22e001'), 'OPERATOR_ADMIN', 'OPERATOR', pg_temp.id('22a001'), NULL),
 (pg_temp.id('22e002'), 'ORGANIZER_ADMIN', 'ORGANIZER', pg_temp.id('22b001'), NULL),
 (pg_temp.id('22e011'), 'OPERATOR_ADMIN', 'OPERATOR', pg_temp.id('22a002'), NULL);
-- Terminal d'avant la mission (inséré directement, sans enrôlement).
INSERT INTO device (id, operator_id, event_id, serial) VALUES
 (pg_temp.id('22aa01'), pg_temp.id('22a001'), pg_temp.id('22d001'), 'LEGACY-0022');

-- Sessions : prestataire A, B, ou aucun (route d'enrôlement sans compte).
CREATE FUNCTION pg_temp.a() RETURNS void LANGUAGE sql AS
  $$ SELECT set_config('app.operator_id', pg_temp.id('22a001')::text, true) $$;
CREATE FUNCTION pg_temp.b() RETURNS void LANGUAGE sql AS
  $$ SELECT set_config('app.operator_id', pg_temp.id('22a002')::text, true) $$;
CREATE FUNCTION pg_temp.none() RETURNS void LANGUAGE sql AS
  $$ SELECT set_config('app.operator_id', '', true) $$;
-- Code émis dans la session courante (durée par défaut).
CREATE FUNCTION pg_temp.code(p_code text, p_event text, p_pos text, p_mode text, p_personal boolean,
                             p_actor text) RETURNS uuid LANGUAGE sql AS $$
  SELECT create_device_enrollment_code(pg_temp.h('code ' || p_code), pg_temp.id(p_event),
                                       CASE WHEN p_pos IS NULL THEN NULL ELSE pg_temp.id(p_pos) END,
                                       p_mode, p_personal, NULL, pg_temp.id(p_actor))
$$;
-- Enrôlement nominal d'après le code p_code ; rend next_seq.
CREATE FUNCTION pg_temp.enroll(p_code text, p_serial text, p_os text DEFAULT 'ANDROID',
                               p_device uuid DEFAULT NULL) RETURNS bigint LANGUAGE sql AS $$
  SELECT e.next_seq FROM enroll_device(
    pg_temp.h('code ' || p_code), p_serial, p_os, '1.0.0',
    decode(repeat('ab', 91), 'hex'), decode('04' || repeat('cd', 64), 'hex'),
    pg_temp.h('cert ' || p_code), now() + interval '365 days',
    CASE p_os WHEN 'ANDROID' THEN 'ANDROID_KEY_ATTESTATION' ELSE 'IOS_APP_ATTEST' END,
    CASE p_os WHEN 'ANDROID' THEN 'STRONGBOX' END,
    pg_temp.h('refresh ' || p_code), now() + interval '30 days', p_device) e
$$;
-- Terminal non révoqué d'un serial dans un prestataire (lu par le propriétaire).
CREATE FUNCTION pg_temp.dev(p_operator text, p_serial text) RETURNS uuid LANGUAGE sql AS $$
  SELECT id FROM device WHERE operator_id = pg_temp.id(p_operator) AND serial = p_serial
     AND status <> 'REVOKED'
$$;
CREATE FUNCTION pg_temp.used(p_code text) RETURNS boolean LANGUAGE sql AS
  $$ SELECT used_at IS NOT NULL FROM device_enrollment_code WHERE code_hash = pg_temp.h('code ' || p_code) $$;

-- 1. Structure et droits ------------------------------------------------------------------------
SELECT has_table('device_enrollment_code');
SELECT has_table('device_refresh_token');
SELECT has_table('device_status_history');
SELECT has_table('device_enrollment_attempt');
SELECT has_column('device'::name, c::name, 'device.' || c)
  FROM unnest(ARRAY['app_version', 'attestation_kind', 'attestation_security_level', 'cert_not_after',
                    'enrolled_at', 'enrollment_code_id', 'status_reason']) c;
SELECT is((SELECT count(*)::int FROM pg_proc
            WHERE proname IN ('device_admin_allowed', 'create_device_enrollment_code',
                              'check_device_enrollment_code', 'enroll_device', 'set_device_status',
                              'record_device_heartbeat', 'record_enrollment_attempt',
                              'enrollment_attempts_exceeded', 'purge_device_enrollment_attempts')
              AND prosecdef AND proconfig @> ARRAY['search_path=public, pg_temp']), 9,
  'neuf fonctions SECURITY DEFINER, search_path public, pg_temp');
DROP ROLE IF EXISTS dev_enroll_probe;
CREATE ROLE dev_enroll_probe;
SELECT is((SELECT count(*)::int
             FROM unnest(ARRAY['device_admin_allowed(uuid,uuid,uuid)',
                               'create_device_enrollment_code(bytea,uuid,uuid,text,boolean,integer,uuid)',
                               'check_device_enrollment_code(bytea,text)',
                               'enroll_device(bytea,text,text,text,bytea,bytea,bytea,timestamptz,text,text,bytea,timestamptz,uuid)',
                               'set_device_status(uuid,text,text,uuid)',
                               'record_device_heartbeat(uuid,text,timestamptz)',
                               'record_enrollment_attempt(bytea,inet,text)',
                               'enrollment_attempts_exceeded(bytea,inet)',
                               'purge_device_enrollment_attempts()']) f
            WHERE has_function_privilege('dev_enroll_probe', f, 'EXECUTE')), 0,
  'aucune des neuf fonctions n''est exécutable par PUBLIC');
SELECT is((SELECT count(*)::int FROM pg_class
            WHERE relname IN ('device_enrollment_code', 'device_refresh_token', 'device_status_history',
                              'device_enrollment_attempt')
              AND relkind = 'r' AND relrowsecurity AND relforcerowsecurity), 4,
  'RLS activée et forcée sur les quatre tables S5');
SELECT is((SELECT count(*)::int FROM pg_policies
            WHERE tablename IN ('device_enrollment_code', 'device_refresh_token', 'device_status_history',
                                'device_enrollment_attempt')
              AND policyname = 'tenant_isolation' AND qual LIKE '%app.operator_id%'
              AND with_check LIKE '%app.operator_id%'), 4,
  'politique tenant_isolation (lecture et écriture) sur les quatre tables');
SELECT ok(pg_get_indexdef('device_serial_active'::regclass) LIKE '%UNIQUE%(operator_id, serial)%REVOKED%',
  'device_serial_active : unique par (prestataire, serial) parmi les non révoqués (ADR-109), nom conservé');

-- 2. Contraintes des tables (propriétaire, écritures directes) -----------------------------------
CREATE FUNCTION pg_temp.raw_code(p_mode text, p_personal boolean, p_expires interval DEFAULT '1 day',
                                 p_hash bytea DEFAULT NULL) RETURNS text LANGUAGE sql AS $$
  SELECT format($q$INSERT INTO device_enrollment_code (operator_id, code_hash, event_id, app_mode,
                     personal_phone, created_by, expires_at)
                   VALUES (%L, %L, %L, %L, %L, %L, now() + %L::interval)$q$,
                pg_temp.id('22a001'), coalesce(p_hash, gen_random_bytes(32)), pg_temp.id('22d001'),
                p_mode, p_personal, pg_temp.id('22e001'), p_expires)
$$;
SELECT throws_ok(pg_temp.raw_code('PAIRED_TPE', false), '23514', NULL,
  'code : app_mode PAIRED_TPE refusé par la table');
SELECT throws_ok(pg_temp.raw_code('CATALOG_POS', true), '23514', NULL,
  'code : téléphone personnel hors KEYPAD_TPE refusé par la table');
SELECT throws_ok(pg_temp.raw_code(NULL, true), '23514', NULL,
  'code : téléphone personnel sans mode refusé par la table');
SELECT throws_ok(pg_temp.raw_code('KEYPAD_TPE', NULL), '23502', NULL,
  'code : personal_phone sans défaut (NULL refusé)');
SELECT throws_ok(pg_temp.raw_code('KEYPAD_TPE', false, '8 days'), '23514', NULL,
  'code : durée au-delà de 7 jours refusée');
SELECT throws_ok(pg_temp.raw_code('KEYPAD_TPE', false, '1 minute'), '23514', NULL,
  'code : durée en deçà de 5 minutes refusée');
SELECT throws_ok(pg_temp.raw_code('KEYPAD_TPE', false, '1 day', '\x0102'::bytea), '23514', NULL,
  'code : empreinte de 32 octets exigée');
SELECT throws_ok(format($q$INSERT INTO device_enrollment_code (operator_id, code_hash, event_id,
                    personal_phone, created_by, expires_at)
                  VALUES (%L, gen_random_bytes(32), NULL, false, %L, now() + interval '1 day')$q$,
                 pg_temp.id('22a001'), pg_temp.id('22e001')), '23502', NULL,
  'code : événement obligatoire');
SELECT throws_ok(format($q$INSERT INTO device_enrollment_code (operator_id, code_hash, event_id,
                    personal_phone, created_by, expires_at, used_at)
                  VALUES (%L, gen_random_bytes(32), %L, false, %L, now() + interval '1 day', now())$q$,
                 pg_temp.id('22a001'), pg_temp.id('22d001'), pg_temp.id('22e001')), '23514', NULL,
  'code : utilisé sans terminal refusé');
SELECT throws_ok(format($q$INSERT INTO device (operator_id, os, app_mode, nfc_enabled, serial)
                  VALUES (%L, 'IOS', 'TOPUP_DESK', false, 'IOS-TOPUP')$q$, pg_temp.id('22a001')),
  '23514', NULL, 'terminal : iOS en caisse de recharge refusé');
SELECT throws_ok(format($q$INSERT INTO device (operator_id, os, serial, attestation_kind)
                  VALUES (%L, 'ANDROID', 'ATT-1', 'IOS_APP_ATTEST')$q$, pg_temp.id('22a001')),
  '23514', NULL, 'terminal : attestation iOS sur Android refusée');
SELECT throws_ok(format($q$INSERT INTO device (operator_id, os, serial, attestation_kind)
                  VALUES (%L, 'ANDROID', 'ATT-2', 'ANDROID_KEY_ATTESTATION')$q$, pg_temp.id('22a001')),
  '23514', NULL, 'terminal : attestation Android sans niveau refusée');
SELECT throws_ok(format($q$INSERT INTO device (operator_id, os, nfc_enabled, serial, attestation_kind,
                    attestation_security_level)
                  VALUES (%L, 'IOS', false, 'ATT-3', 'IOS_APP_ATTEST', 'STRONGBOX')$q$, pg_temp.id('22a001')),
  '23514', NULL, 'terminal : niveau d''attestation sur iOS refusé');
SELECT throws_ok(format($q$INSERT INTO device (operator_id, os, serial, attestation_kind,
                    attestation_security_level)
                  VALUES (%L, 'ANDROID', 'ATT-4', 'ANDROID_KEY_ATTESTATION', 'SOFTWARE')$q$,
                 pg_temp.id('22a001')),
  '23514', NULL, 'terminal : niveau d''attestation logiciel refusé');
SELECT throws_ok(format($q$INSERT INTO device_refresh_token (operator_id, device_id, family_id, token_hash,
                    expires_at, revoked_at, revoked_reason)
                  VALUES (%L, %L, gen_random_uuid(), gen_random_bytes(32), now() + interval '1 day',
                          now(), 'OTHER')$q$, pg_temp.id('22a001'), pg_temp.id('22aa01')),
  '23514', NULL, 'jeton : motif de révocation hors liste refusé');
SELECT throws_ok(format($q$INSERT INTO device_refresh_token (operator_id, device_id, family_id, token_hash,
                    expires_at, revoked_at)
                  VALUES (%L, %L, gen_random_uuid(), gen_random_bytes(32), now() + interval '1 day',
                          now())$q$, pg_temp.id('22a001'), pg_temp.id('22aa01')),
  '23514', NULL, 'jeton : révocation sans motif refusée');
SELECT throws_ok(format($q$INSERT INTO device_refresh_token (operator_id, device_id, family_id, token_hash,
                    expires_at)
                  VALUES (%1$L, %2$L, %3$L, gen_random_bytes(32), now() + interval '1 day'),
                         (%1$L, %2$L, %3$L, gen_random_bytes(32), now() + interval '1 day')$q$,
                 pg_temp.id('22a001'), pg_temp.id('22aa01'), pg_temp.id('22ff01')),
  '23505', NULL, 'jeton : deux jetons vivants dans une famille refusés');
SELECT throws_ok(format($q$INSERT INTO device_status_history (operator_id, device_id, from_status, to_status,
                    reason, actor_id)
                  VALUES (%L, %L, 'REVOKED', 'ACTIVE', 'retour', %L)$q$,
                 pg_temp.id('22a001'), pg_temp.id('22aa01'), pg_temp.id('22e001')),
  '23514', NULL, 'historique : aucune sortie de REVOKED');
SELECT throws_ok(format($q$INSERT INTO device_enrollment_attempt (operator_id, code_hash, address, result)
                  VALUES (%L, NULL, '10.0.0.9', 'CODE_INVALID')$q$, pg_temp.id('22a001')),
  '23514', NULL, 'essai : prestataire sans empreinte refusé');
SELECT throws_ok($q$INSERT INTO device_enrollment_attempt (address, result) VALUES ('10.0.0.9', 'FOO')$q$,
  '23514', NULL, 'essai : résultat hors liste refusé');

-- Contrainte visée nommée : « SQLSTATE:nom de la contrainte » de l'erreur levée (NULL si aucune).
-- Chaque ligne ci-dessous n'enfreint QUE la contrainte visée (les CHECK sont évalués par ordre
-- alphabétique de nom ; une clé unique avant les clés étrangères, vérifiées en fin d'instruction).
CREATE FUNCTION pg_temp.ko(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v_state text; v_constraint text;
BEGIN
  EXECUTE p_sql;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_constraint = CONSTRAINT_NAME;
  RETURN v_state || ':' || coalesce(v_constraint, '');
END $$;
-- Jeton de rafraîchissement sur le terminal d'avant la mission ; p_cols, p_vals : colonnes en plus.
CREATE FUNCTION pg_temp.raw_token(p_cols text, p_vals text) RETURNS text LANGUAGE sql AS $$
  SELECT format($q$INSERT INTO device_refresh_token (operator_id, device_id, family_id, token_hash,
                     expires_at%s)
                   VALUES (%L, %L, gen_random_uuid(), %s)$q$,
                p_cols, pg_temp.id('22a001'), pg_temp.id('22aa01'), p_vals)
$$;
SELECT is(pg_temp.ko(pg_temp.raw_token(', successor_id',
                                       'gen_random_bytes(32), now() + interval ''1 day'', gen_random_uuid()')),
  '23514:device_refresh_token_successor', 'jeton : successeur sans consommation refusé');
SELECT is(pg_temp.ko(pg_temp.raw_token(', grace_used_at',
                                       'gen_random_bytes(32), now() + interval ''1 day'', now()')),
  '23514:device_refresh_token_grace', 'jeton : grâce utilisée sans consommation refusée');
SELECT is(pg_temp.ko(format($q$INSERT INTO device_refresh_token (id, operator_id, device_id, family_id,
                     token_hash, expires_at, consumed_at, successor_id)
                   VALUES (%1$L, %2$L, %3$L, gen_random_uuid(), gen_random_bytes(32),
                           now() + interval '1 day', now(), %1$L)$q$,
                            pg_temp.id('22ff02'), pg_temp.id('22a001'), pg_temp.id('22aa01'))),
  '23514:device_refresh_token_not_self', 'jeton : successeur de lui-même refusé');
SELECT is(pg_temp.ko(pg_temp.raw_token(', created_at', 'gen_random_bytes(32), now(), now()')),
  '23514:device_refresh_token_expiry', 'jeton : expiration non postérieure à la création refusée');
SELECT is(pg_temp.ko(pg_temp.raw_token('', '''\x0102''::bytea, now() + interval ''1 day''')),
  '23514:device_refresh_token_hash', 'jeton : empreinte de 32 octets exigée');
SELECT is(pg_temp.ko(format($q$INSERT INTO device_refresh_token (operator_id, device_id, family_id, token_hash,
                     expires_at)
                   VALUES (%1$L, %2$L, gen_random_uuid(), %3$L, now() + interval '1 day'),
                          (%1$L, %2$L, gen_random_uuid(), %3$L, now() + interval '1 day')$q$,
                            pg_temp.id('22a001'), pg_temp.id('22aa01'), pg_temp.h('jeton double'))),
  '23505:device_refresh_token_hash_key', 'jeton : empreinte en double refusée (deux familles)');
-- Terminal.
SELECT is(pg_temp.ko(format($q$INSERT INTO device (operator_id, serial, enrollment_code_id)
                   VALUES (%L, 'KEYS-1', gen_random_uuid())$q$, pg_temp.id('22a001'))),
  '23514:device_enrolled_keys', 'terminal : code consommé sans clés ni certificat refusé');
SELECT is(pg_temp.ko(format($q$INSERT INTO device (operator_id, serial, attestation_security_level)
                   VALUES (%L, 'LVL-1', 'STRONGBOX')$q$, pg_temp.id('22a001'))),
  '23514:device_attestation_level_kind', 'terminal : niveau d''attestation sans attestation refusé');
SELECT is(pg_temp.ko(format($q$INSERT INTO device (operator_id, serial, attestation_kind,
                     attestation_security_level)
                   VALUES (%L, 'KIND-1', 'SAFETYNET', 'STRONGBOX')$q$, pg_temp.id('22a001'))),
  '23514:device_attestation_kind', 'terminal : sorte d''attestation hors liste refusée');
SELECT is(pg_temp.ko(format($q$INSERT INTO device (operator_id, serial, app_version)
                   VALUES (%L, 'APP-1', %L)$q$, pg_temp.id('22a001'), repeat('9', 65))),
  '23514:device_app_version', 'terminal : version de l''application de 65 caractères refusée');
SELECT is(pg_temp.ko(format($q$INSERT INTO device (operator_id, serial, app_version)
                   VALUES (%L, 'APP-2', '')$q$, pg_temp.id('22a001'))),
  '23514:device_app_version', 'terminal : version de l''application vide refusée');
SELECT is(pg_temp.ko(format($q$INSERT INTO device (operator_id, serial, status_reason)
                   VALUES (%L, 'RSN-1', %L)$q$, pg_temp.id('22a001'), repeat('m', 501))),
  '23514:device_status_reason', 'terminal : motif de statut de 501 caractères refusé');
SELECT is(pg_temp.ko(format($q$INSERT INTO device (operator_id, serial, public_key, agreement_public_key,
                     cert_sha256, cert_not_after, enrolled_at, attestation_kind, attestation_security_level,
                     enrollment_code_id)
                   SELECT %L, s, decode(repeat('ab', 91), 'hex'), decode('04' || repeat('cd', 64), 'hex'),
                          sha256(convert_to(s, 'UTF8')), now() + interval '1 year', now(),
                          'ANDROID_KEY_ATTESTATION', 'STRONGBOX', %L
                     FROM unnest(ARRAY['ONCE-1', 'ONCE-2']) s$q$,
                            pg_temp.id('22a001'), pg_temp.id('22ee01'))),
  '23505:device_enrollment_code_once', 'terminal : deux terminaux pour un même code refusés');
-- Code d'enrôlement.
SELECT is(pg_temp.ko(format($q$INSERT INTO device_enrollment_code (operator_id, code_hash, event_id,
                     personal_phone, created_by, expires_at)
                   SELECT %L, %L, %L, false, %L, now() + interval '1 day' FROM generate_series(1, 2)$q$,
                            pg_temp.id('22a001'), pg_temp.h('code double'), pg_temp.id('22d001'),
                            pg_temp.id('22e001'))),
  '23505:device_enrollment_code_hash_key', 'code : empreinte en double refusée');
SELECT is(pg_temp.ko(format($q$INSERT INTO device_enrollment_code (operator_id, code_hash, event_id,
                     personal_phone, created_by, expires_at, used_at, device_id)
                   SELECT %L, gen_random_bytes(32), %L, false, %L, now() + interval '1 day', now(), %L
                     FROM generate_series(1, 2)$q$,
                            pg_temp.id('22a001'), pg_temp.id('22d001'), pg_temp.id('22e001'),
                            pg_temp.id('22aa01'))),
  '23505:device_enrollment_code_device_key', 'code : deux codes consommés par un même terminal refusés');
-- Historique des statuts.
CREATE FUNCTION pg_temp.raw_hist(p_from text, p_to text, p_reason text, p_actor text) RETURNS text
LANGUAGE sql AS $$
  SELECT format($q$INSERT INTO device_status_history (operator_id, device_id, from_status, to_status, reason,
                     actor_id)
                   VALUES (%L, %L, %L, %L, %L, %L)$q$,
                pg_temp.id('22a001'), pg_temp.id('22aa01'), p_from, p_to, p_reason,
                CASE WHEN p_actor IS NULL THEN NULL ELSE pg_temp.id(p_actor) END)
$$;
SELECT is(pg_temp.ko(pg_temp.raw_hist('ACTIVE', 'ACTIVE', 'motif', '22e001')),
  '23514:device_status_history_change', 'historique : transition sans changement refusée');
SELECT is(pg_temp.ko(pg_temp.raw_hist(NULL, 'SUSPENDED', 'motif', NULL)),
  '23514:device_status_history_origin', 'historique : première ligne autre que NULL -> ACTIVE refusée');
SELECT is(pg_temp.ko(pg_temp.raw_hist('ACTIVE', 'SUSPENDED', 'motif', NULL)),
  '23514:device_status_history_actor', 'historique : transition sans auteur refusée');
SELECT is(pg_temp.ko(pg_temp.raw_hist(NULL, 'ACTIVE', '', NULL)),
  '23514:device_status_history_reason', 'historique : motif vide refusé');
SELECT is(pg_temp.ko(pg_temp.raw_hist(NULL, 'ACTIVE', repeat('m', 501), NULL)),
  '23514:device_status_history_reason', 'historique : motif de 501 caractères refusé');
SELECT is(pg_temp.ko(pg_temp.raw_hist('ACTIVE', 'LOST', 'motif', '22e001')),
  '23514:device_status_history_to', 'historique : statut d''arrivée hors liste refusé');
SELECT is(pg_temp.ko(pg_temp.raw_hist('LOST', 'ACTIVE', 'motif', '22e001')),
  '23514:device_status_history_from', 'historique : statut de départ hors liste refusé');
-- Essais.
SELECT is(pg_temp.ko(format($q$INSERT INTO device_enrollment_attempt (operator_id, code_hash, address, result)
                   VALUES (%L, '\x0102'::bytea, '10.0.0.9', 'CODE_INVALID')$q$, pg_temp.id('22a001'))),
  '23514:device_enrollment_attempt_code_hash', 'essai : empreinte de 32 octets exigée');

-- 3. Émission d'un code -------------------------------------------------------------------------
SELECT pg_temp.none();
SELECT throws_ok($$SELECT pg_temp.code('x0', '22d001', NULL, NULL, false, '22e001')$$, 'P0002', NULL,
  'émission sans prestataire de session : introuvable');
SELECT pg_temp.a();
SELECT throws_ok($$SELECT pg_temp.code('x1', '22d001', NULL, 'PAIRED_TPE', false, '22e001')$$, 'CL027', NULL,
  'émission : PAIRED_TPE refusé par un code nommé (DEVICE_MODE_NOT_ALLOWED)');
SELECT throws_ok($$SELECT create_device_enrollment_code(pg_temp.h('code x2'), NULL, NULL, NULL, false, NULL,
                                                        pg_temp.id('22e001'))$$, 'CL001', NULL,
  'émission : événement obligatoire');
SELECT throws_ok($$SELECT pg_temp.code('x3', '22d001', NULL, 'KEYPAD_TPE', NULL, '22e001')$$, 'CL001', NULL,
  'émission : téléphone personnel à choisir (NULL refusé)');
SELECT throws_ok($$SELECT pg_temp.code('x4', '22d001', NULL, 'CATALOG_POS', true, '22e001')$$, 'CL027', NULL,
  'émission : téléphone personnel hors KEYPAD_TPE refusé');
SELECT throws_ok($$SELECT pg_temp.code('x5', '22d001', NULL, NULL, true, '22e001')$$, 'CL027', NULL,
  'émission : téléphone personnel sans mode refusé');
SELECT throws_ok($$SELECT pg_temp.code('x6', '22d001', NULL, 'SELF_SERVICE', false, '22e001')$$, 'CL001', NULL,
  'émission : mode inconnu refusé');
SELECT throws_ok($$SELECT create_device_enrollment_code(pg_temp.h('code x7'), pg_temp.id('22d001'), NULL, NULL,
                                                        false, 299, pg_temp.id('22e001'))$$, 'CL001', NULL,
  'émission : durée de 299 s refusée');
SELECT throws_ok($$SELECT create_device_enrollment_code(pg_temp.h('code x8'), pg_temp.id('22d001'), NULL, NULL,
                                                        false, 604801, pg_temp.id('22e001'))$$, 'CL001', NULL,
  'émission : durée de 604 801 s refusée');
SELECT throws_ok($$SELECT create_device_enrollment_code('\x0102'::bytea, pg_temp.id('22d001'), NULL, NULL,
                                                        false, NULL, pg_temp.id('22e001'))$$, 'CL001', NULL,
  'émission : empreinte de 32 octets exigée');
SELECT throws_ok($$SELECT pg_temp.code('x9', '22d011', NULL, NULL, false, '22e001')$$, 'P0002', NULL,
  'émission : événement d''un autre prestataire introuvable');
SELECT throws_ok($$SELECT pg_temp.code('x10', '22d001', '22f111', NULL, false, '22e001')$$, 'P0002', NULL,
  'émission : point de vente d''un autre prestataire introuvable');
SELECT throws_ok($$SELECT pg_temp.code('x11', '22d001', '22f102', NULL, false, '22e001')$$, 'CL001', NULL,
  'émission : point de vente d''un autre événement refusé');
SELECT throws_ok($$SELECT pg_temp.code('x12', '22d001', NULL, NULL, false, '22e003')$$, 'P0002', NULL,
  'émission : auteur sans rôle d''administration : hors périmètre');
SELECT throws_ok($$SELECT pg_temp.code('x13', '22d002', NULL, NULL, false, '22e002')$$, 'P0002', NULL,
  'émission : ORGANIZER_ADMIN sur l''événement d''un autre organisateur : hors périmètre');
SELECT throws_ok($$SELECT pg_temp.code('x14', '22d001', NULL, NULL, false, '22e011')$$, 'P0002', NULL,
  'émission : auteur d''un autre prestataire : hors périmètre');
SELECT throws_ok($$SELECT create_device_enrollment_code(pg_temp.h('code x15'), pg_temp.id('22d001'), NULL, NULL,
                                                        false, NULL, NULL)$$, 'P0002', NULL,
  'émission sans auteur (p_actor NULL) : introuvable');
SELECT is((SELECT count(*)::int FROM device_enrollment_code WHERE operator_id = pg_temp.id('22a001')), 0,
  'aucun code créé par les refus');

SELECT lives_ok($$SELECT pg_temp.code('c1', '22d001', '22f101', 'CATALOG_POS', false, '22e001')$$,
  'émission par OPERATOR_ADMIN : point de vente de l''événement');
SELECT lives_ok($$SELECT pg_temp.code('c2', '22d001', NULL, NULL, false, '22e002')$$,
  'émission par ORGANIZER_ADMIN sur un événement de son organisateur');
SELECT pg_temp.code('c3', '22d001', NULL, 'TOPUP_DESK', false, '22e001');
SELECT pg_temp.code('c4', '22d001', NULL, 'KEYPAD_TPE', true, '22e001');
SELECT pg_temp.code('c5', '22d001', NULL, NULL, false, '22e001');
SELECT pg_temp.code('c6', '22d001', NULL, NULL, false, '22e001');
SELECT pg_temp.code('c8', '22d001', NULL, NULL, false, '22e001');
SELECT pg_temp.code('c9', '22d001', NULL, NULL, false, '22e001');
SELECT pg_temp.code('c10', '22d001', NULL, NULL, false, '22e001');
SELECT pg_temp.b();
SELECT pg_temp.code('c7', '22d011', NULL, NULL, false, '22e011');
SELECT is((SELECT expires_at - created_at FROM device_enrollment_code WHERE code_hash = pg_temp.h('code c2')),
  interval '24 hours', 'durée par défaut : 24 h');
SELECT is((SELECT ROW(personal_phone, app_mode, event_id, pos_id, created_by)::text
             FROM device_enrollment_code WHERE code_hash = pg_temp.h('code c1')),
  ROW(false, 'CATALOG_POS', pg_temp.id('22d001'), pg_temp.id('22f101'), pg_temp.id('22e001'))::text,
  'code enregistré : portée, mode, téléphone personnel, auteur');
-- Code expiré : horodatages posés, sans attente.
UPDATE device_enrollment_code SET created_at = now() - interval '2 days', expires_at = now() - interval '1 day'
 WHERE code_hash = pg_temp.h('code c5');

-- 4. Lecture du code avant l'attestation ---------------------------------------------------------
SELECT pg_temp.none();
SELECT is((SELECT ROW(operator_id, event_id, app_mode, personal_phone)::text
             FROM check_device_enrollment_code(pg_temp.h('code c1'), 'ANDROID')),
  ROW(pg_temp.id('22a001'), pg_temp.id('22d001'), 'CATALOG_POS', false)::text,
  'lecture : prestataire, affectation et mode rendus');
SELECT is((SELECT app_mode FROM check_device_enrollment_code(pg_temp.h('code c2'), 'IOS')), 'CATALOG_POS',
  'lecture : sans mode imposé, CATALOG_POS');
SELECT throws_ok($$SELECT * FROM check_device_enrollment_code(pg_temp.h('code inconnu'), 'ANDROID')$$,
  'CL025', NULL, 'lecture : code inconnu refusé (ENROLLMENT_CODE_INVALID)');
SELECT throws_ok($$SELECT * FROM check_device_enrollment_code(pg_temp.h('code c5'), 'ANDROID')$$,
  'CL026', NULL, 'lecture : code expiré refusé (ENROLLMENT_CODE_EXPIRED)');
SELECT throws_ok($$SELECT * FROM check_device_enrollment_code(pg_temp.h('code c3'), 'IOS')$$,
  'CL027', NULL, 'lecture : caisse de recharge sur iOS refusée');
SELECT throws_ok($$SELECT * FROM check_device_enrollment_code(pg_temp.h('code c1'), 'WINDOWS')$$,
  'CL001', NULL, 'lecture : système inconnu refusé');
SELECT throws_ok($$SELECT * FROM check_device_enrollment_code(pg_temp.h('code c1'), NULL)$$,
  'CL001', NULL, 'lecture : système absent refusé');
SELECT pg_temp.b();
SELECT throws_ok($$SELECT * FROM check_device_enrollment_code(pg_temp.h('code c1'), 'ANDROID')$$,
  'CL025', NULL, 'lecture : code d''un autre prestataire que la session traité comme inconnu');

-- 5. Enrôlement -------------------------------------------------------------------------------------
SELECT pg_temp.none();
SELECT is(pg_temp.enroll('c1', 'SER-1'), 1::bigint, 'Android : enrôlement nominal, next_seq = 1');
SELECT is((SELECT ROW(status, app_mode, kind, personal_phone, nfc_enabled, event_id, pos_id, next_seq_floor,
                      attestation_kind, attestation_security_level, app_version)::text
             FROM device WHERE id = pg_temp.dev('22a001', 'SER-1')),
  ROW('ACTIVE', 'CATALOG_POS', 'POS', false, true, pg_temp.id('22d001'), pg_temp.id('22f101'), 1::bigint,
      'ANDROID_KEY_ATTESTATION', 'STRONGBOX', '1.0.0')::text,
  'terminal créé : ACTIVE, affectation et mode du code, NFC, plancher, attestation');
SELECT is((SELECT ROW(public_key IS NOT NULL, octet_length(agreement_public_key), cert_sha256 = pg_temp.h('cert c1'),
                      cert_not_after > now(), enrolled_at IS NOT NULL)::text
             FROM device WHERE id = pg_temp.dev('22a001', 'SER-1')),
  ROW(true, 65, true, true, true)::text, 'terminal créé : clés, empreinte du certificat, dates');
SELECT is((SELECT ROW(c.used_at IS NOT NULL, c.device_id = d.id, d.enrollment_code_id = c.id)::text
             FROM device_enrollment_code c, device d
            WHERE c.code_hash = pg_temp.h('code c1') AND d.id = pg_temp.dev('22a001', 'SER-1')),
  ROW(true, true, true)::text, 'code consommé et lié au terminal');
SELECT is((SELECT count(*)::int FROM device_refresh_token
            WHERE device_id = pg_temp.dev('22a001', 'SER-1') AND consumed_at IS NULL AND revoked_at IS NULL
              AND token_hash = pg_temp.h('refresh c1')), 1,
  'premier jeton de rafraîchissement, vivant, d''une nouvelle famille');
SELECT is((SELECT string_agg(coalesce(from_status, '-') || '>' || to_status || ':' || reason, ',')
             FROM device_status_history WHERE device_id = pg_temp.dev('22a001', 'SER-1')),
  '->ACTIVE:ENROLLED', 'historique : NULL -> ACTIVE');

SELECT throws_ok($$SELECT pg_temp.enroll('c1', 'SER-1B')$$, 'CL025', NULL,
  'code déjà utilisé : second enrôlement refusé (ENROLLMENT_CODE_INVALID)');
SELECT throws_ok($$SELECT pg_temp.enroll('inconnu', 'SER-X')$$, 'CL025', NULL,
  'code inconnu : même refus que le code utilisé');
-- Refus unique (NFR-006) : même SQLSTATE ET même message pour le code utilisé et le code inconnu, à la
-- lecture (étape 3 du contrat, première réponse vue par le terminal) comme à l'enrôlement.
SELECT throws_ok($$SELECT * FROM check_device_enrollment_code(pg_temp.h('code c1'), 'ANDROID')$$,
  'CL025', 'Code d''enrôlement invalide', 'lecture : code déjà utilisé refusé (ENROLLMENT_CODE_INVALID)');
SELECT throws_ok($$SELECT * FROM check_device_enrollment_code(pg_temp.h('code inconnu'), 'ANDROID')$$,
  'CL025', 'Code d''enrôlement invalide', 'lecture : code inconnu, même SQLSTATE et même message que le code utilisé');
SELECT throws_ok($$SELECT pg_temp.enroll('c1', 'SER-1C')$$,
  'CL025', 'Code d''enrôlement invalide', 'enrôlement : code utilisé, message du refus unique');
SELECT throws_ok($$SELECT pg_temp.enroll('inconnu', 'SER-XC')$$,
  'CL025', 'Code d''enrôlement invalide', 'enrôlement : code inconnu, même message que le code utilisé');
SELECT throws_ok($$SELECT pg_temp.enroll('c5', 'SER-5')$$, 'CL026', NULL,
  'code expiré refusé (ENROLLMENT_CODE_EXPIRED)');
SELECT is(pg_temp.used('c5'), false, 'code expiré : non consommé');
SELECT throws_ok($$SELECT pg_temp.enroll('c2', 'SER-1')$$, 'CL028', NULL,
  'serial actif dans le même prestataire refusé (DEVICE_SERIAL_IN_USE)');
SELECT is(pg_temp.used('c2'), false, 'serial refusé : code non consommé');
SELECT throws_ok($$SELECT pg_temp.enroll('c3', 'IPAD-TOP', 'IOS')$$, 'CL027', NULL,
  'iOS en caisse de recharge refusé (DEVICE_MODE_NOT_ALLOWED)');
SELECT is(pg_temp.used('c3'), false, 'mode refusé : code non consommé');
SELECT is(pg_temp.enroll('c3', 'TOP-1'), 1::bigint, 'Android en caisse de recharge accepté');
SELECT is((SELECT kind || '/' || app_mode FROM device WHERE id = pg_temp.dev('22a001', 'TOP-1')), 'TOPUP/TOPUP_DESK',
  'caisse de recharge : sorte TOPUP');
SELECT is(pg_temp.enroll('c2', 'IPH-1', 'IOS'), 1::bigint, 'iOS : enrôlement accepté');
SELECT is((SELECT ROW(nfc_enabled, attestation_kind, attestation_security_level IS NULL)::text
             FROM device WHERE id = pg_temp.dev('22a001', 'IPH-1')),
  ROW(false, 'IOS_APP_ATTEST', true)::text, 'iOS : sans NFC, App Attest, sans niveau');
SELECT is(pg_temp.enroll('c4', 'PERSO-1'), 1::bigint, 'téléphone personnel : enrôlement accepté');
SELECT is((SELECT personal_phone::text || '/' || app_mode FROM device WHERE id = pg_temp.dev('22a001', 'PERSO-1')),
  'true/KEYPAD_TPE', 'téléphone personnel : choix du code, KEYPAD_TPE');
-- Paramètres incohérents : refusés avant le code (le code n'est pas consommé).
SELECT throws_ok($$SELECT * FROM enroll_device(pg_temp.h('code c10'), 'BAD-1', 'IOS', '1.0.0',
                    decode(repeat('ab', 91), 'hex'), decode('04' || repeat('cd', 64), 'hex'), pg_temp.h('cert b1'),
                    now() + interval '1 year', 'IOS_APP_ATTEST', 'STRONGBOX', pg_temp.h('refresh b1'),
                    now() + interval '30 days')$$, 'CL001', NULL, 'iOS avec niveau d''attestation refusé');
SELECT throws_ok($$SELECT * FROM enroll_device(pg_temp.h('code c10'), 'BAD-2', 'ANDROID', '1.0.0',
                    decode(repeat('ab', 91), 'hex'), decode('04' || repeat('cd', 64), 'hex'), pg_temp.h('cert b2'),
                    now() + interval '1 year', 'ANDROID_KEY_ATTESTATION', NULL, pg_temp.h('refresh b2'),
                    now() + interval '30 days')$$, 'CL001', NULL, 'Android sans niveau d''attestation refusé');
SELECT throws_ok($$SELECT * FROM enroll_device(pg_temp.h('code c10'), 'BAD-3', 'ANDROID', '1.0.0',
                    decode(repeat('ab', 91), 'hex'), decode('04' || repeat('cd', 32), 'hex'), pg_temp.h('cert b3'),
                    now() + interval '1 year', 'ANDROID_KEY_ATTESTATION', 'STRONGBOX', pg_temp.h('refresh b3'),
                    now() + interval '30 days')$$, 'CL001', NULL, 'clé d''accord de 33 octets refusée');
-- Chaque paramètre revérifié par la base, un par un, sur le code c10 valide et non consommé (les autres
-- paramètres sont ceux d'un enrôlement Android accepté).
CREATE FUNCTION pg_temp.bad(p_serial text DEFAULT 'BAD-P', p_os text DEFAULT 'ANDROID',
                            p_app text DEFAULT '1.0.0',
                            p_pk bytea DEFAULT decode(repeat('ab', 91), 'hex'),
                            p_cert bytea DEFAULT sha256('\x00'::bytea),
                            p_not_after timestamptz DEFAULT now() + interval '1 year',
                            p_kind text DEFAULT 'ANDROID_KEY_ATTESTATION', p_level text DEFAULT 'STRONGBOX',
                            p_refresh bytea DEFAULT sha256('\x01'::bytea),
                            p_refresh_expires timestamptz DEFAULT now() + interval '30 days') RETURNS text
LANGUAGE sql AS $$
  SELECT format('SELECT * FROM enroll_device(%L::bytea, %L, %L, %L, %L::bytea, %L::bytea, %L::bytea, '
                '%L::timestamptz, %L, %L, %L::bytea, %L::timestamptz)',
                pg_temp.h('code c10'), p_serial, p_os, p_app, p_pk, decode('04' || repeat('cd', 64), 'hex'),
                p_cert, p_not_after, p_kind, p_level, p_refresh, p_refresh_expires)
$$;
SELECT throws_ok(pg_temp.bad(p_serial => NULL), 'CL001', NULL, 'enrôlement : serial absent refusé');
SELECT throws_ok(pg_temp.bad(p_serial => ''), 'CL001', NULL, 'enrôlement : serial vide refusé');
SELECT throws_ok(pg_temp.bad(p_serial => repeat('S', 65)), 'CL001', NULL,
  'enrôlement : serial de 65 caractères refusé');
SELECT throws_ok(pg_temp.bad(p_os => 'WINDOWS'), 'CL001', NULL, 'enrôlement : système inconnu refusé');
SELECT throws_ok(pg_temp.bad(p_os => NULL), 'CL001', NULL, 'enrôlement : système absent refusé');
SELECT throws_ok(pg_temp.bad(p_app => NULL), 'CL001', NULL, 'enrôlement : version de l''application absente refusée');
SELECT throws_ok(pg_temp.bad(p_app => repeat('9', 65)), 'CL001', NULL,
  'enrôlement : version de l''application de 65 caractères refusée');
SELECT throws_ok(pg_temp.bad(p_pk => NULL), 'CL001', NULL, 'enrôlement : clé publique absente refusée');
SELECT throws_ok(pg_temp.bad(p_pk => decode(repeat('ab', 63), 'hex')), 'CL001', NULL,
  'enrôlement : clé publique de 63 octets refusée');
SELECT throws_ok(pg_temp.bad(p_pk => decode(repeat('ab', 201), 'hex')), 'CL001', NULL,
  'enrôlement : clé publique de 201 octets refusée');
SELECT throws_ok(pg_temp.bad(p_cert => NULL), 'CL001', NULL, 'enrôlement : empreinte du certificat absente refusée');
SELECT throws_ok(pg_temp.bad(p_cert => decode(repeat('ee', 31), 'hex')), 'CL001', NULL,
  'enrôlement : empreinte du certificat de 31 octets refusée');
SELECT throws_ok(pg_temp.bad(p_cert => decode(repeat('ee', 33), 'hex')), 'CL001', NULL,
  'enrôlement : empreinte du certificat de 33 octets refusée');
SELECT throws_ok(pg_temp.bad(p_not_after => now() - interval '1 day'), 'CL001', NULL,
  'enrôlement : certificat déjà expiré refusé');
SELECT throws_ok(pg_temp.bad(p_not_after => NULL), 'CL001', NULL, 'enrôlement : fin du certificat absente refusée');
SELECT throws_ok(pg_temp.bad(p_kind => 'IOS_APP_ATTEST', p_level => NULL), 'CL001', NULL,
  'enrôlement : Android avec App Attest refusé');
SELECT throws_ok(pg_temp.bad(p_kind => 'IOS_APP_ATTEST'), 'CL001', NULL,
  'enrôlement : Android avec App Attest et un niveau refusé');
SELECT throws_ok(pg_temp.bad(p_kind => NULL), 'CL001', NULL, 'enrôlement : attestation absente refusée');
SELECT throws_ok(pg_temp.bad(p_level => 'SOFTWARE'), 'CL001', NULL,
  'enrôlement : niveau d''attestation logiciel refusé');
SELECT throws_ok(pg_temp.bad(p_os => 'IOS', p_kind => 'ANDROID_KEY_ATTESTATION', p_level => NULL), 'CL001', NULL,
  'enrôlement : iOS avec attestation de clé Android refusé');
SELECT throws_ok(pg_temp.bad(p_refresh => NULL), 'CL001', NULL, 'enrôlement : jeton de rafraîchissement absent refusé');
SELECT throws_ok(pg_temp.bad(p_refresh => decode(repeat('ff', 31), 'hex')), 'CL001', NULL,
  'enrôlement : empreinte du jeton de rafraîchissement de 31 octets refusée');
SELECT throws_ok(pg_temp.bad(p_refresh_expires => now() - interval '1 second'), 'CL001', NULL,
  'enrôlement : jeton de rafraîchissement déjà expiré refusé');
SELECT throws_ok(pg_temp.bad(p_refresh_expires => NULL), 'CL001', NULL,
  'enrôlement : expiration du jeton de rafraîchissement absente refusée');
SELECT is((SELECT count(*)::int FROM device WHERE serial IN ('BAD-P', '') OR serial = repeat('S', 65)), 0,
  'paramètres refusés : aucun terminal créé');
SELECT is(pg_temp.used('c10'), false, 'paramètres refusés : code non consommé');
-- Session d'un autre prestataire que le code : même refus que le code inconnu.
SELECT pg_temp.b();
SELECT throws_ok($$SELECT pg_temp.enroll('c10', 'SER-10')$$, 'CL025', NULL,
  'session d''un autre prestataire : code traité comme inconnu');
-- Identifiant tiré par l'API (CN du certificat émis avant l'enrôlement).
SELECT pg_temp.a();
SELECT is(pg_temp.enroll('c10', 'SER-10', 'ANDROID', pg_temp.id('22dd10')), 1::bigint,
  'session du prestataire du code acceptée');
SELECT is(pg_temp.dev('22a001', 'SER-10'), pg_temp.id('22dd10'), 'identifiant fourni par l''API conservé');

-- Ré-enrôlement après révocation : next_seq = max_seen_seq + 1, dans le prestataire seulement.
UPDATE device SET last_seq = 88 WHERE id = pg_temp.dev('22a001', 'SER-1');
CREATE TEMP TABLE old_ser1 AS SELECT pg_temp.dev('22a001', 'SER-1') AS id;
SELECT pg_temp.a();
SELECT set_device_status(pg_temp.dev('22a001', 'SER-1'), 'REVOKED', 'Terminal perdu', pg_temp.id('22e001'));
SELECT pg_temp.none();
SELECT is(pg_temp.enroll('c6', 'SER-1'), 89::bigint, 'ré-enrôlement d''un serial révoqué de last_seq 88 : next_seq 89');
SELECT is((SELECT ROW(next_seq_floor, contiguous_acked_seq, last_seq, last_chain_seq,
                      last_chain_hash = device_chain_genesis(id))::text
             FROM device WHERE id = pg_temp.dev('22a001', 'SER-1')),
  ROW(89::bigint, 88::bigint, 88::bigint, 88::bigint, true)::text,
  'ré-enrôlement : plancher 89, numéros antérieurs hors du registre du nouveau terminal, chaîne à l''origine');
SELECT isnt(pg_temp.dev('22a001', 'SER-1'), (SELECT id FROM old_ser1), 'ré-enrôlement : nouveau terminal');
SELECT is(pg_temp.enroll('c7', 'SER-1'), 1::bigint,
  'même serial dans un autre prestataire : accepté, next_seq calculé dans ce prestataire (1, pas 89)');
SELECT is((SELECT count(*)::int FROM device WHERE serial = 'SER-1' AND status = 'ACTIVE'), 2,
  'deux terminaux SER-1 actifs, un par prestataire');
-- Familles vivantes d'un terminal révoqué hors set_device_status : révoquées au ré-enrôlement.
SELECT pg_temp.enroll('c8', 'SER-2');
CREATE TEMP TABLE old_ser2 AS SELECT pg_temp.dev('22a001', 'SER-2') AS id;
UPDATE device SET status = 'REVOKED' WHERE id = (SELECT id FROM old_ser2);
SELECT is(pg_temp.enroll('c9', 'SER-2'), 1::bigint, 'ré-enrôlement de SER-2');
SELECT is((SELECT string_agg(revoked_reason, ',') FROM device_refresh_token
            WHERE device_id = (SELECT id FROM old_ser2)), 'REENROLLED',
  'ré-enrôlement : famille restée vivante du terminal révoqué révoquée (REENROLLED)');

-- 6. Statut -----------------------------------------------------------------------------------------
SELECT pg_temp.a();
CREATE FUNCTION pg_temp.st(p_serial text, p_to text, p_actor text DEFAULT '22e001',
                           p_reason text DEFAULT 'motif de test') RETURNS text LANGUAGE sql AS $$
  SELECT format('SELECT set_device_status(%L, %L, %L, %L)', pg_temp.dev('22a001', p_serial), p_to, p_reason,
                pg_temp.id(p_actor))
$$;
SELECT lives_ok(pg_temp.st('TOP-1', 'SUSPENDED', '22e002'),
  'ACTIVE -> SUSPENDED par l''ORGANIZER_ADMIN de l''événement du terminal');
SELECT is((SELECT status || ':' || status_reason FROM device WHERE id = pg_temp.dev('22a001', 'TOP-1')),
  'SUSPENDED:motif de test', 'statut et motif posés');
SELECT throws_ok(pg_temp.st('TOP-1', 'SUSPENDED'), 'CL029', NULL, 'SUSPENDED -> SUSPENDED refusé (CONFLICT_STATE)');
SELECT lives_ok(pg_temp.st('TOP-1', 'ACTIVE'), 'SUSPENDED -> ACTIVE');
SELECT throws_ok(pg_temp.st('TOP-1', 'ACTIVE'), 'CL029', NULL, 'ACTIVE -> ACTIVE refusé');
SELECT throws_ok(pg_temp.st('TOP-1', 'SUSPENDED', '22e001', NULL), 'CL001', NULL, 'motif absent refusé');
SELECT throws_ok(pg_temp.st('TOP-1', 'SUSPENDED', '22e001', '   '), 'CL001', NULL, 'motif blanc refusé');
SELECT throws_ok(pg_temp.st('TOP-1', 'LOST'), 'CL001', NULL, 'statut inconnu refusé');
SELECT throws_ok(pg_temp.st('TOP-1', 'SUSPENDED', '22e001', repeat('m', 501)), 'CL001', NULL,
  'motif de 501 caractères refusé');
SELECT throws_ok(format('SELECT set_device_status(NULL, ''SUSPENDED'', ''motif'', %L)', pg_temp.id('22e001')),
  'P0002', NULL, 'terminal absent (p_device NULL) : introuvable');
SELECT pg_temp.none();
SELECT throws_ok(pg_temp.st('TOP-1', 'SUSPENDED'), 'P0002', NULL, 'statut sans prestataire de session : introuvable');
SELECT pg_temp.a();
SELECT throws_ok(pg_temp.st('TOP-1', 'SUSPENDED', '22e003'), 'P0002', NULL,
  'auteur sans rôle d''administration : hors périmètre');
SELECT throws_ok(pg_temp.st('TOP-1', 'SUSPENDED', '22e011'), 'P0002', NULL,
  'auteur d''un autre prestataire : hors périmètre');
SELECT throws_ok(format('SELECT set_device_status(%L, ''SUSPENDED'', ''motif'', %L)',
                        pg_temp.dev('22a002', 'SER-1'), pg_temp.id('22e001')), 'P0002', NULL,
  'terminal d''un autre prestataire : introuvable');
SELECT pg_temp.b();
SELECT throws_ok(pg_temp.st('TOP-1', 'SUSPENDED', '22e011'), 'P0002', NULL,
  'session d''un autre prestataire : introuvable');
SELECT pg_temp.a();
CREATE TEMP TABLE top1 AS SELECT pg_temp.dev('22a001', 'TOP-1') AS id;
SELECT lives_ok(pg_temp.st('TOP-1', 'REVOKED'), 'ACTIVE -> REVOKED');
SELECT is((SELECT count(*)::int FROM device_refresh_token
            WHERE device_id = (SELECT id FROM top1) AND revoked_at IS NULL), 0,
  'révocation : aucune famille vivante');
SELECT is((SELECT string_agg(revoked_reason, ',') FROM device_refresh_token WHERE device_id = (SELECT id FROM top1)),
  'DEVICE_REVOKED', 'révocation : familles révoquées (DEVICE_REVOKED) dans la même transaction');
SELECT throws_ok(format('SELECT set_device_status(%L, %L, ''motif'', %L)', (SELECT id FROM top1), s,
                        pg_temp.id('22e001')), 'CL029', NULL, 'REVOKED -> ' || s || ' refusé (définitif)')
  FROM unnest(ARRAY['ACTIVE', 'SUSPENDED', 'REVOKED']) s;
SELECT is((SELECT string_agg(coalesce(from_status, '-') || '>' || to_status, ',' ORDER BY id)
             FROM device_status_history WHERE device_id = (SELECT id FROM top1)),
  '->ACTIVE,ACTIVE>SUSPENDED,SUSPENDED>ACTIVE,ACTIVE>REVOKED', 'historique des transitions');
SELECT is((SELECT count(*)::int FROM device_status_history
            WHERE device_id = (SELECT id FROM top1) AND from_status IS NOT NULL AND actor_id IS NULL), 0,
  'historique : auteur de chaque transition');
SELECT throws_like(format('UPDATE device_status_history SET reason = ''x'' WHERE device_id = %L',
                          (SELECT id FROM top1)), '%ajout seul%', 'historique en ajout seul (UPDATE)');
SELECT throws_like(format('DELETE FROM device_status_history WHERE device_id = %L', (SELECT id FROM top1)),
  '%ajout seul%', 'historique en ajout seul (DELETE)');

-- 7. Battement de cœur ------------------------------------------------------------------------------
SELECT lives_ok(format('SELECT record_device_heartbeat(%L, ''1.2.3'', now())', pg_temp.dev('22a001', 'IPH-1')),
  'battement de cœur d''un terminal actif');
SELECT is((SELECT app_version || ':' || (last_seen_at IS NOT NULL)::text FROM device
            WHERE id = pg_temp.dev('22a001', 'IPH-1')), '1.2.3:true', 'version et dernière présence posées');
SELECT lives_ok(pg_temp.st('PERSO-1', 'SUSPENDED'), 'PERSO-1 suspendu');
SELECT lives_ok(format('SELECT record_device_heartbeat(%L, NULL, now())', pg_temp.dev('22a001', 'PERSO-1')),
  'battement de cœur d''un terminal suspendu accepté');
SELECT throws_ok(format('SELECT record_device_heartbeat(%L, ''1.2.3'', now())', (SELECT id FROM top1)), '42501',
  NULL, 'battement de cœur d''un terminal révoqué refusé (DEVICE_REVOKED)');
SELECT throws_ok(format('SELECT record_device_heartbeat(%L, %L, now())', pg_temp.dev('22a001', 'IPH-1'),
                        repeat('9', 65)), 'CL001', NULL, 'version trop longue refusée');
SELECT throws_ok($$SELECT record_device_heartbeat(NULL, '1.2.3', now())$$, 'P0002', NULL,
  'battement de cœur sans terminal (p_device NULL) : introuvable');
SELECT pg_temp.none();
SELECT throws_ok(format('SELECT record_device_heartbeat(%L, ''1.2.3'', now())', pg_temp.dev('22a001', 'IPH-1')),
  'P0002', NULL, 'battement de cœur sans prestataire de session : introuvable');
SELECT pg_temp.b();
SELECT throws_ok(format('SELECT record_device_heartbeat(%L, ''1.2.3'', now())', pg_temp.dev('22a001', 'IPH-1')),
  'P0002', NULL, 'battement de cœur d''un terminal d''un autre prestataire : introuvable');

-- 8. Essais d'enrôlement (R-16) ---------------------------------------------------------------------
SELECT pg_temp.none();
SELECT record_enrollment_attempt(pg_temp.h('code c2'), '10.0.0.1', 'CODE_INVALID') FROM generate_series(1, 9);
SELECT is(enrollment_attempts_exceeded(pg_temp.h('code c2'), '10.9.9.9'), false, '9 essais du code : pas de limite');
SELECT record_enrollment_attempt(pg_temp.h('code c2'), '10.0.0.1', 'ATTESTATION_FAILED');
SELECT is(enrollment_attempts_exceeded(pg_temp.h('code c2'), '10.9.9.9'), true,
  '10 essais du code dans l''heure : le 11e est refusé');
SELECT is((SELECT count(*)::int FROM device_enrollment_attempt
            WHERE code_hash = pg_temp.h('code c2') AND operator_id = pg_temp.id('22a001')), 10,
  'code connu : essais rattachés à son prestataire et à son empreinte');
SELECT record_enrollment_attempt(pg_temp.h('code c9'), '10.0.0.4', 'RATE_LIMITED') FROM generate_series(1, 12);
SELECT is(enrollment_attempts_exceeded(pg_temp.h('code c9'), '10.0.0.4'), false,
  'essais déjà refusés pour limite : non comptés');
SELECT record_enrollment_attempt(pg_temp.h('inconnu ' || n), '10.0.0.2', 'CODE_INVALID') FROM generate_series(1, 29) n;
SELECT is(enrollment_attempts_exceeded(NULL, '10.0.0.2'), false, '29 essais de l''adresse : pas de limite');
SELECT record_enrollment_attempt(pg_temp.h('inconnu 30'), '10.0.0.2', 'CODE_INVALID');
SELECT is(enrollment_attempts_exceeded(pg_temp.h('inconnu 31'), '10.0.0.2'), true,
  '30 essais de l''adresse dans l''heure : le 31e est refusé');
-- Migration 0027 (ADR-117) : l'empreinte d'un code inconnu est gardée (limite par code pour tous).
SELECT is((SELECT count(*)::int FROM device_enrollment_attempt
            WHERE address = '10.0.0.2' AND operator_id IS NULL AND code_hash IS NOT NULL), 30,
  'code inconnu : empreinte gardée, sans prestataire');
SELECT throws_ok($$SELECT record_enrollment_attempt(NULL, '10.0.0.5', 'FOO')$$, 'CL001', NULL,
  'essai : résultat inconnu refusé');
SELECT throws_ok($$SELECT record_enrollment_attempt(NULL, NULL, 'CODE_INVALID')$$, 'CL001', NULL,
  'essai : adresse obligatoire');
-- Fenêtre d'une heure et purge à 24 h (lignes datées posées par le propriétaire).
INSERT INTO device_enrollment_attempt (operator_id, code_hash, address, at, result)
SELECT pg_temp.id('22a001'), pg_temp.h('code c6'), '10.0.0.3', clock_timestamp() - interval '2 hours', 'CODE_INVALID'
  FROM generate_series(1, 10);
SELECT is(enrollment_attempts_exceeded(pg_temp.h('code c6'), '10.0.0.3'), false,
  'essais de plus d''une heure : hors limite');
INSERT INTO device_enrollment_attempt (address, at, result)
SELECT '10.0.0.6', clock_timestamp() - interval '25 hours', 'CODE_INVALID' FROM generate_series(1, 3);
SELECT is(purge_device_enrollment_attempts(), 3::bigint, 'purge : les essais de plus de 24 h seulement');
SELECT is((SELECT count(*)::int FROM device_enrollment_attempt WHERE address = '10.0.0.3'), 10,
  'purge : essais de moins de 24 h conservés');
SELECT throws_like($$UPDATE device_enrollment_attempt SET result = 'ENROLLED'$$, '%ajout seul%',
  'essais : aucune modification');

-- 9. Isolation à deux prestataires ------------------------------------------------------------------
-- Rôle sonde soumis à la RLS, avec SELECT seulement (les droits des rôles applicatifs sont posés par
-- post-roles.sql, lot WP07).
GRANT SELECT ON device_enrollment_code, device_refresh_token, device_status_history, device_enrollment_attempt
  TO dev_enroll_probe;
SET LOCAL ROLE dev_enroll_probe;
SELECT set_config('app.operator_id', '00000000-0000-0000-0000-00000022a001', true);
SELECT is((SELECT count(*)::int FROM device_enrollment_code WHERE operator_id <> '00000000-0000-0000-0000-00000022a001'),
  0, 'A : aucun code de B visible');
SELECT ok((SELECT count(*) FROM device_enrollment_code) > 0, 'A : ses codes visibles');
SELECT is((SELECT count(*)::int FROM device_refresh_token WHERE operator_id <> '00000000-0000-0000-0000-00000022a001'),
  0, 'A : aucun jeton de B visible');
SELECT ok((SELECT count(*) FROM device_refresh_token) > 0, 'A : ses jetons visibles');
SELECT is((SELECT count(*)::int FROM device_status_history WHERE operator_id <> '00000000-0000-0000-0000-00000022a001'),
  0, 'A : aucun historique de B visible');
SELECT ok((SELECT count(*) FROM device_status_history) > 0, 'A : son historique visible');
SELECT is((SELECT count(*)::int FROM device_enrollment_attempt WHERE operator_id IS NULL), 0,
  'A : essais sur codes inconnus invisibles');
SELECT is((SELECT count(*)::int FROM device_enrollment_attempt WHERE address = '10.0.0.1'), 10,
  'A : essais sur ses codes visibles');
SELECT set_config('app.operator_id', '00000000-0000-0000-0000-00000022a002', true);
SELECT is((SELECT count(*)::int FROM device_enrollment_code), 1, 'B : son seul code visible');
SELECT is((SELECT count(*)::int FROM device_refresh_token), 1, 'B : son seul jeton visible');
SELECT is((SELECT count(*)::int FROM device_status_history), 1, 'B : son seul historique visible');
SELECT is((SELECT count(*)::int FROM device_enrollment_attempt), 0, 'B : aucun essai visible');
RESET ROLE;

-- Isolation en écriture : INSERT accordé au rôle sonde pour le test seulement. Pour chaque table, une
-- ligne du prestataire de la session passe (preuve que le droit suffit, 42501 étant aussi le SQLSTATE
-- d'un droit manquant), puis la même ligne au nom de B sous la session de A est refusée par la clause
-- WITH CHECK de tenant_isolation (42501).
GRANT INSERT ON device_enrollment_code, device_refresh_token, device_status_history, device_enrollment_attempt
  TO dev_enroll_probe;
GRANT USAGE ON SEQUENCE device_status_history_id_seq, device_enrollment_attempt_id_seq TO dev_enroll_probe;
SET LOCAL ROLE dev_enroll_probe;
SELECT set_config('app.operator_id', '00000000-0000-0000-0000-00000022a001', true);
SELECT lives_ok($q$INSERT INTO device_enrollment_code (operator_id, code_hash, event_id, personal_phone, created_by,
                                                     expires_at)
                   VALUES ('00000000-0000-0000-0000-00000022a001', sha256('sonde code A'::bytea),
                           '00000000-0000-0000-0000-00000022d001', false, '00000000-0000-0000-0000-00000022e001',
                           now() + interval '1 day')$q$,
  'écriture : A insère un code à son nom');
SELECT throws_ok($q$INSERT INTO device_enrollment_code (operator_id, code_hash, event_id, personal_phone, created_by,
                                                      expires_at)
                    VALUES ('00000000-0000-0000-0000-00000022a002', sha256('sonde code B'::bytea),
                            '00000000-0000-0000-0000-00000022d011', false, '00000000-0000-0000-0000-00000022e011',
                            now() + interval '1 day')$q$,
  '42501', NULL, 'écriture : code au nom de B sous la session de A refusé (WITH CHECK)');
SELECT lives_ok($q$INSERT INTO device_refresh_token (operator_id, device_id, family_id, token_hash, expires_at)
                   VALUES ('00000000-0000-0000-0000-00000022a001', '00000000-0000-0000-0000-00000022aa01',
                           gen_random_uuid(), sha256('sonde jeton A'::bytea), now() + interval '1 day')$q$,
  'écriture : A insère un jeton à son nom');
SELECT throws_ok($q$INSERT INTO device_refresh_token (operator_id, device_id, family_id, token_hash, expires_at)
                    VALUES ('00000000-0000-0000-0000-00000022a002', '00000000-0000-0000-0000-00000022aa01',
                            gen_random_uuid(), sha256('sonde jeton B'::bytea), now() + interval '1 day')$q$,
  '42501', NULL, 'écriture : jeton au nom de B sous la session de A refusé (WITH CHECK)');
SELECT lives_ok($q$INSERT INTO device_status_history (operator_id, device_id, from_status, to_status, reason)
                   VALUES ('00000000-0000-0000-0000-00000022a001', '00000000-0000-0000-0000-00000022aa01',
                           NULL, 'ACTIVE', 'sonde')$q$,
  'écriture : A insère une ligne d''historique à son nom');
SELECT throws_ok($q$INSERT INTO device_status_history (operator_id, device_id, from_status, to_status, reason)
                    VALUES ('00000000-0000-0000-0000-00000022a002', '00000000-0000-0000-0000-00000022aa01',
                            NULL, 'ACTIVE', 'sonde')$q$,
  '42501', NULL, 'écriture : historique au nom de B sous la session de A refusé (WITH CHECK)');
SELECT lives_ok($q$INSERT INTO device_enrollment_attempt (operator_id, code_hash, address, result)
                   VALUES ('00000000-0000-0000-0000-00000022a001', sha256('sonde essai A'::bytea), '10.0.0.7',
                           'CODE_INVALID')$q$,
  'écriture : A insère un essai à son nom');
SELECT throws_ok($q$INSERT INTO device_enrollment_attempt (operator_id, code_hash, address, result)
                    VALUES ('00000000-0000-0000-0000-00000022a002', sha256('sonde essai B'::bytea), '10.0.0.7',
                            'CODE_INVALID')$q$,
  '42501', NULL, 'écriture : essai au nom de B sous la session de A refusé (WITH CHECK)');
SELECT throws_ok($q$INSERT INTO device_enrollment_attempt (address, result) VALUES ('10.0.0.7', 'CODE_INVALID')$q$,
  '42501', NULL, 'écriture : essai sans prestataire (code inconnu) refusé hors des fonctions');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
