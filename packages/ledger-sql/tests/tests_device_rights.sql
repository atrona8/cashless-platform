-- Droits sur les terminaux (OP-N63, ADR-105 ; OP-N59, ADR-96 ; mission 5a,
-- identite-enrolement-terminaux, lot WP07 ; research R-11, contracts/database-debts.md) — pgTAP,
-- écrit à la main.
-- Lancer : pg_prove -d <base> tests/tests_device_rights.sql (base créée par les migrations,
-- roles.sql et post-roles.sql rejoués).
-- La suite rejoue elle-même roles.sql puis post-roles.sql (ordre de migrate.ts) : roles.sql rend
-- INSERT et UPDATE sur toutes les tables à cashless_app, post-roles.sql doit les reprendre.
\set ON_ERROR_STOP 1
\set QUIET 1
BEGIN;
SET LOCAL client_min_messages = warning;
\ir ../roles.sql
\ir ../post-roles.sql
RESET client_min_messages;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

CREATE FUNCTION pg_temp.id(p text) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT ('00000000-0000-0000-0000-' || lpad(p, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.h(p text) RETURNS bytea LANGUAGE sql IMMUTABLE AS
  $$ SELECT sha256(convert_to('07 ' || p, 'UTF8')) $$;
CREATE FUNCTION pg_temp.a() RETURNS void LANGUAGE sql AS
  $$ SELECT set_config('app.operator_id', pg_temp.id('07a001')::text, true) $$;

-- Données (propriétaire) : A et B ; terminaux de A : e001 actif, e002 révoqué ; de B : e011 actif.
-- Familles de jetons : f001 et f002 (e001), f011 (e011), un jeton vivant chacune.
INSERT INTO party (id, kind, legal_name, country_code) VALUES
 (pg_temp.id('07a001'), 'OPERATOR', 'Prestataire A', 'SN'),
 (pg_temp.id('07a002'), 'OPERATOR', 'Prestataire B', 'CI');
INSERT INTO device (id, operator_id, kind, serial, status, cert_sha256, public_key)
SELECT pg_temp.id(d), pg_temp.id(o), 'POS', 'WP07-' || d, s, pg_temp.h('cert ' || d), '\x01'
  FROM (VALUES ('07e001', '07a001', 'ACTIVE'), ('07e002', '07a001', 'REVOKED'),
               ('07e011', '07a002', 'ACTIVE')) AS v(d, o, s);
INSERT INTO device_refresh_token (operator_id, device_id, family_id, token_hash, expires_at)
SELECT pg_temp.id(o), pg_temp.id(d), pg_temp.id(f), pg_temp.h('jeton ' || f),
       now() + interval '1 day'
  FROM (VALUES ('07a001', '07e001', '07f001'), ('07a001', '07e001', '07f002'),
               ('07a002', '07e011', '07f011')) AS v(o, d, f);
INSERT INTO device_request_nonce (operator_id, device_id, nonce, expires_at)
VALUES (pg_temp.id('07a001'), pg_temp.id('07e001'), pg_temp.h('nonce'),
        now() + interval '1 minute');
INSERT INTO device_status_history (operator_id, device_id, from_status, to_status, reason)
VALUES (pg_temp.id('07a001'), pg_temp.id('07e002'), NULL, 'ACTIVE', 'enrôlement (test)');
INSERT INTO device_enrollment_attempt (operator_id, code_hash, address, result)
VALUES (pg_temp.id('07a001'), pg_temp.h('code'), '192.0.2.7', 'CODE_INVALID');
-- Image d'une famille de jetons, lue par le propriétaire.
CREATE FUNCTION pg_temp.fam(p_family text) RETURNS text LANGUAGE sql AS $$
  SELECT string_agg(concat_ws('|', encode(token_hash, 'hex'), consumed_at, revoked_at,
                              revoked_reason, successor_id, grace_used_at),
                    ';' ORDER BY created_at, token_hash)
    FROM device_refresh_token WHERE family_id = pg_temp.id(p_family)
$$;
CREATE TEMP TABLE wp07_families AS
  SELECT f, pg_temp.fam(f) AS img FROM unnest(ARRAY['07f001', '07f002', '07f011']) f;

-- 1. Catalogue : écritures de cashless_app sur les tables des terminaux ---------------------------
SELECT ok(NOT has_any_column_privilege('cashless_app', 'device', 'INSERT'),
  'cashless_app : aucune insertion dans device');
SELECT is((SELECT array_agg(attname::text ORDER BY attname) FROM pg_attribute
            WHERE attrelid = 'device'::regclass AND attnum > 0 AND NOT attisdropped
              AND has_column_privilege('cashless_app', 'device', attname, 'UPDATE')),
  ARRAY['app_mode', 'event_id', 'last_seen_at', 'last_snapshot_version', 'next_seq_floor',
        'nfc_enabled', 'personal_phone', 'pos_id', 'station_name'],
  'cashless_app : colonnes de device modifiables, liste exacte');
SELECT ok(has_column_privilege('cashless_app', 'device', c, 'SELECT'),
  'cashless_app : lecture de device.' || c || ' (garde des requêtes de terminal)')
  FROM unnest(ARRAY['public_key', 'cert_sha256', 'agreement_public_key', 'status']) c;
SELECT is((SELECT count(*)::int
             FROM unnest(ARRAY['device_enrollment_code', 'device_refresh_token',
                               'device_status_history', 'device_request_nonce',
                               'device_enrollment_attempt']) t,
                  unnest(ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) p
            WHERE has_table_privilege('cashless_app', t, p)
               OR (p IN ('INSERT', 'UPDATE')
                   AND has_any_column_privilege('cashless_app', t, p))), 0,
  'cashless_app : aucune écriture directe sur les tables S5');
SELECT is((SELECT count(*)::int
             FROM unnest(ARRAY['cashless_platform', 'cashless_tagkeys', 'cashless_perso',
                               'cashless_tagcheck', 'cashless_keyadmin']) r,
                  unnest(ARRAY['device', 'device_enrollment_code', 'device_refresh_token',
                               'device_status_history', 'device_request_nonce',
                               'device_enrollment_attempt']) t,
                  unnest(ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) p
            WHERE has_table_privilege(r, t, p)
               OR (p IN ('INSERT', 'UPDATE') AND has_any_column_privilege(r, t, p))), 0,
  'autres rôles : aucune écriture sur les terminaux ni sur les tables S5');
SELECT is((SELECT array_agg(attname::text ORDER BY attname) FROM pg_attribute
            WHERE attrelid = 'device'::regclass AND attnum > 0 AND NOT attisdropped
              AND has_column_privilege('cashless_tagkeys', 'device', attname, 'SELECT')),
  ARRAY['agreement_public_key', 'cert_sha256', 'event_id', 'id', 'nfc_enabled', 'operator_id', 'os',
        'pos_id', 'public_key', 'status'],
  'cashless_tagkeys : lecture de device limitée à la garde (clés, empreinte, statut, affectation)');

-- 2. Réécriture directe de chaque colonne protégée : refusée --------------------------------------
SET LOCAL ROLE cashless_app;
SELECT pg_temp.a();
SELECT throws_ok(format('UPDATE device SET %I = %I WHERE id = %L', attname, attname,
                        pg_temp.id('07e001')),
  '42501', NULL, 'cashless_app : UPDATE direct de device.' || attname || ' refusé')
  FROM pg_attribute
 WHERE attrelid = 'device'::regclass AND attnum > 0 AND NOT attisdropped
   AND attname NOT IN ('app_mode', 'event_id', 'last_seen_at', 'last_snapshot_version',
                       'next_seq_floor', 'nfc_enabled', 'personal_phone', 'pos_id', 'station_name')
 ORDER BY attnum;
SELECT lives_ok(format('UPDATE device SET station_name = %L WHERE id = %L', 'Bar',
                       pg_temp.id('07e001')),
  'témoin : réglage d''exploitation (station_name) modifiable');
SELECT throws_ok($$INSERT INTO device (operator_id, kind, serial)
                   VALUES (pg_temp.id('07a001'), 'POS', 'WP07-3')$$, '42501', NULL,
  'cashless_app : insertion directe d''un terminal refusée (enroll_device seule)');

-- 3. Un terminal REVOKED ne redevient pas ACTIVE par écriture directe -----------------------------
SELECT throws_ok(format('UPDATE device SET status = %L WHERE id = %L', 'ACTIVE',
                        pg_temp.id('07e002')),
  '42501', NULL, 'cashless_app : REVOKED -> ACTIVE par écriture directe refusé');
SELECT throws_ok(format('UPDATE device SET status = %L, status_reason = %L WHERE id = %L', 'ACTIVE',
                        'retour', pg_temp.id('07e002')),
  '42501', NULL, 'cashless_app : REVOKED -> ACTIVE avec motif refusé');
SELECT is((SELECT status FROM device WHERE id = pg_temp.id('07e002')), 'REVOKED',
  'le terminal révoqué le reste');

-- 4. Aucune écriture directe sur les tables S5 ----------------------------------------------------
SELECT throws_ok(format('INSERT INTO %I DEFAULT VALUES', t), '42501', NULL,
  'cashless_app : INSERT direct dans ' || t || ' refusé')
  FROM unnest(ARRAY['device_enrollment_code', 'device_refresh_token', 'device_status_history',
                    'device_request_nonce', 'device_enrollment_attempt']) t;
SELECT throws_ok(format('UPDATE %I SET operator_id = operator_id', t), '42501', NULL,
  'cashless_app : UPDATE direct de ' || t || ' refusé')
  FROM unnest(ARRAY['device_enrollment_code', 'device_refresh_token', 'device_status_history',
                    'device_request_nonce', 'device_enrollment_attempt']) t;
SELECT throws_ok(format('DELETE FROM %I', t), '42501', NULL,
  'cashless_app : DELETE dans ' || t || ' refusé')
  FROM unnest(ARRAY['device_enrollment_code', 'device_refresh_token', 'device_status_history',
                    'device_request_nonce', 'device_enrollment_attempt']) t;
SELECT throws_ok($$UPDATE device_refresh_token SET revoked_at = NULL, revoked_reason = NULL$$,
  '42501', NULL, 'cashless_app : un jeton révoqué ne se remet pas à neuf');
SELECT throws_ok($$UPDATE device_enrollment_code SET used_at = NULL, device_id = NULL$$,
  '42501', NULL, 'cashless_app : un code utilisé ne se remet pas à neuf');
RESET ROLE;

-- 5. Tables temporaires refusées à chaque rôle cashless_* (OP-N59, seconde barrière) -------------
SELECT ok(NOT has_database_privilege('public', current_database(), 'TEMPORARY'),
  'PUBLIC : aucun TEMPORARY sur la base');
SELECT ok(NOT has_database_privilege(r, current_database(), 'TEMPORARY'), r || ' : aucun TEMPORARY')
  FROM unnest(ARRAY['cashless_app', 'cashless_platform', 'cashless_tagkeys', 'cashless_perso',
                    'cashless_tagcheck', 'cashless_keyadmin']) r;
SET LOCAL ROLE cashless_app;
SELECT throws_ok('CREATE TEMP TABLE wp07_t (i int)', '42501', NULL,
  'cashless_app : création d''une table temporaire refusée');
SET LOCAL ROLE cashless_platform;
SELECT throws_ok('CREATE TEMP TABLE wp07_t (i int)', '42501', NULL,
  'cashless_platform : création d''une table temporaire refusée');
SET LOCAL ROLE cashless_tagkeys;
SELECT throws_ok('CREATE TEMP TABLE wp07_t (i int)', '42501', NULL,
  'cashless_tagkeys : création d''une table temporaire refusée');
SET LOCAL ROLE cashless_perso;
SELECT throws_ok('CREATE TEMP TABLE wp07_t (i int)', '42501', NULL,
  'cashless_perso : création d''une table temporaire refusée');
SET LOCAL ROLE cashless_tagcheck;
SELECT throws_ok('CREATE TEMP TABLE wp07_t (i int)', '42501', NULL,
  'cashless_tagcheck : création d''une table temporaire refusée');
SET LOCAL ROLE cashless_keyadmin;
SELECT throws_ok('CREATE TEMP TABLE wp07_t (i int)', '42501', NULL,
  'cashless_keyadmin : création d''une table temporaire refusée');
RESET ROLE;

-- 6. Hypothèse acceptée par le porteur : le propriétaire des fonctions ignore la RLS --------------
-- (R3 de la relecture WP03, 19/10/2026 ; étendue le 20/10/2026, relecture WP04 M4.) Ces fonctions
-- tournent sans prestataire de session sur des tables à RLS forcée : avec un propriétaire soumis à
-- la RLS, l'échec est fermé mais total (tout code inconnu, aucun jeton échangé, rien de purgé).
-- EXIGENCE DE DÉPLOIEMENT : propriétaire superutilisateur ou BYPASSRLS. Le test échoue sinon.
SELECT is((SELECT array_agg(p.proname::text ORDER BY p.proname) FROM pg_proc p
             JOIN pg_roles r ON r.oid = p.proowner
            WHERE p.pronamespace = 'public'::regnamespace AND p.prosecdef
              AND (r.rolsuper OR r.rolbypassrls)
              AND p.proname IN ('enroll_device', 'check_device_enrollment_code',
                                'record_enrollment_attempt', 'enrollment_attempts_exceeded',
                                'purge_device_enrollment_attempts', 'rotate_device_refresh_token',
                                'purge_device_request_nonces', 'record_enrollment_refusal')),
  ARRAY['check_device_enrollment_code', 'enroll_device', 'enrollment_attempts_exceeded',
        'purge_device_enrollment_attempts', 'purge_device_request_nonces',
        'record_enrollment_attempt', 'record_enrollment_refusal', 'rotate_device_refresh_token'],
  'hypothèse RLS : les huit fonctions sans prestataire de session sont SECURITY DEFINER et leur '
  || 'propriétaire ignore la RLS (superutilisateur ou BYPASSRLS)');

-- 7. rotate_device_refresh_token ne touche qu'à la famille du condensat présenté ------------------
-- Appel sans prestataire de session (route de rafraîchissement), sous cashless_app.
SET LOCAL ROLE cashless_app;
SELECT set_config('app.operator_id', '', true);
SELECT is((SELECT outcome
             FROM rotate_device_refresh_token(pg_temp.h('jeton 07f001'), pg_temp.h('cert 07e001'),
                                              pg_temp.h('jeton 07f001 bis'), now() + interval '1 day')),
  'ROTATED', 'échange du jeton de la famille f001');
SELECT is((SELECT outcome
             FROM rotate_device_refresh_token(pg_temp.h('jeton 07f011'), pg_temp.h('cert 07e001'),
                                              pg_temp.h('jeton 07f011 bis'), now() + interval '1 day')),
  'REUSED', 'jeton de B présenté avec le certificat d''un terminal de A : réutilisation');
RESET ROLE;
SELECT is((SELECT count(*)::int FROM device_refresh_token
            WHERE family_id = pg_temp.id('07f001')), 2,
  'famille f001 : jeton consommé et son successeur');
SELECT is((SELECT array_agg(f ORDER BY f) FROM wp07_families
            WHERE img IS DISTINCT FROM pg_temp.fam(f)),
  ARRAY['07f001', '07f011'],
  'seules les familles des condensats présentés ont changé (f002, même terminal que f001 : '
  || 'intacte)');
SELECT is((SELECT count(*)::int FROM device_refresh_token
            WHERE family_id = pg_temp.id('07f011') AND revoked_reason = 'REUSE'), 1,
  'famille f011 révoquée (REUSE), et elle seule');
SELECT is((SELECT count(*)::int FROM device_refresh_token
            WHERE revoked_at IS NOT NULL AND family_id <> pg_temp.id('07f011')), 0,
  'aucun autre jeton révoqué');

SELECT * FROM finish();
ROLLBACK;
