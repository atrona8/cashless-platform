-- Droits de la base de la mission serveur-app-festivalier (mission 10a ; WP04 ; FR-004, FR-006, FR-007, NFR-003, C-004)
-- — pgTAP, écrit à la main. Listes EXACTES des fonctions de la mission exécutables par rôle, écritures directes
-- refusées à cashless_app, droits de colonne exacts d'otp_channel_attempt, surface exacte de cashless_claimadmin,
-- contrôles positifs, rejeu de post-roles.sql.
-- A FAIRE RELIRE PAR UNE PERSONNE : les listes attendues ci-dessous sont la source de vérité des droits de la mission.
-- Lancer : pg_prove -d <base> tests/tests_10a_rights.sql (base créée par les migrations, roles.sql et post-roles.sql
-- rejoués). Comptages limités aux objets du test (suites parallèles en CI).
-- Mutations (NFR-004), rejouées à la main à la livraison : voir la note de lane de WP04 (identifiants des tests).
\set ON_ERROR_STOP 1
\set QUIET 1
BEGIN;
\ir _grants_for_tests.sql
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

CREATE FUNCTION pg_temp.id(p text) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT ('00000000-0000-0000-0000-' || lpad(p, 12, '0'))::uuid $$;
-- Résultat d'une instruction : NULL si elle passe, sinon le SQLSTATE.
CREATE FUNCTION pg_temp.code(p text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE p; RETURN NULL; EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE; END $$;
CREATE FUNCTION pg_temp.a() RETURNS void LANGUAGE sql AS
  $$ SELECT set_config('app.operator_id', pg_temp.id('10a001')::text, true) $$;

-- 1. Données (propriétaire) : deux prestataires, événement, grand livre, portefeuille d'un client au numéro vérifié,
--    agent titulaire, lot PUBLIC et bracelets, défi OTP -----------------------------------------------------------
INSERT INTO party (id, kind, legal_name, country_code) VALUES
 (pg_temp.id('10a001'), 'OPERATOR', 'Prestataire A', 'SN'),
 (pg_temp.id('10a002'), 'OPERATOR', 'Prestataire B', 'CI');
INSERT INTO party (id, kind, operator_id, legal_name) VALUES
 (pg_temp.id('10b001'), 'ORGANIZER', pg_temp.id('10a001'), 'Organisateur A'),
 (pg_temp.id('10b011'), 'ORGANIZER', pg_temp.id('10a002'), 'Organisateur B'),
 (pg_temp.id('10c001'), 'CUSTOMER', pg_temp.id('10a001'), 'Client A1');
INSERT INTO customer_identity (customer_id, operator_id, phone)
VALUES (pg_temp.id('10c001'), pg_temp.id('10a001'), '+221770010001');
INSERT INTO jurisdiction_profile (id, country_code, version, valid_from, breakage_destination)
VALUES (pg_temp.id('10f001'), 'SN', 100010, '2026-01-01', 'ORGANIZER');
INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone, jurisdiction_id, funds_holder, status)
VALUES (pg_temp.id('10d001'), pg_temp.id('10a001'), pg_temp.id('10b001'), 'Événement A', 'XOF', 'Africa/Dakar',
        pg_temp.id('10f001'), 'ORGANIZER', 'LIVE');
INSERT INTO ledger (id, operator_id, scope_type, scope_id, currency, issuer_id, funds_holder_id)
VALUES (pg_temp.id('10cc01'), pg_temp.id('10a001'), 'EVENT', pg_temp.id('10d001'), 'XOF', pg_temp.id('10b001'),
        pg_temp.id('10b001'));
INSERT INTO wallet (id, operator_id, ledger_id, customer_id)
VALUES (pg_temp.id('10cb01'), pg_temp.id('10a001'), pg_temp.id('10cc01'), pg_temp.id('10c001'));
-- 10e001 : agent d'un autre numéro (appelle create_kyc_verification) ; 10e002 : agent titulaire (CL061).
INSERT INTO app_user (id, operator_id, issuer, subject, phone, display_name) VALUES
 (pg_temp.id('10e001'), pg_temp.id('10a001'), 'https://idp.test', 's10a1', '+221770010099', 'Agent'),
 (pg_temp.id('10e002'), pg_temp.id('10a001'), 'https://idp.test', 's10a2', '+221770010001', 'Agent titulaire');
INSERT INTO tag_key (operator_id, key_index, kms_key_ref, status)
VALUES (pg_temp.id('10a001'), 1, 'test:hmac-10a', 'ACTIVE');
INSERT INTO media_batch (id, operator_id, organizer_id, kind, quantity, key_index)
VALUES (pg_temp.id('10b9001'), pg_temp.id('10a001'), pg_temp.id('10b001'), 'PUBLIC', 5, 1);
INSERT INTO media (id, operator_id, kind, token_hash, nfc_uid, batch_id)
VALUES (pg_temp.id('10d9001'), pg_temp.id('10a001'), 'NFC_TAG', sha256('\x10a001'::bytea), '\x04100000000001',
        pg_temp.id('10b9001'));
INSERT INTO otp_challenge (id, operator_id, phone, channel, code_hash, client_ref, expires_at)
VALUES (pg_temp.id('10d0001'), pg_temp.id('10a001'), '+221770010001', 'AUTO', sha256('d10a'), 'r',
        now() + interval '5 min');
INSERT INTO otp_channel_attempt (id, operator_id, challenge_id, channel, provider)
VALUES (pg_temp.id('10e0001'), pg_temp.id('10a001'), pg_temp.id('10d0001'), 'WHATSAPP', 'fake-whatsapp');

-- 2. Listes exactes des fonctions de la mission, par rôle (la suite échoue si l'une s'élargit) -----------------------
CREATE TEMP TABLE m10a (sig text PRIMARY KEY);
INSERT INTO m10a VALUES
 ('create_kyc_verification(uuid,uuid,text,text,text,date,uuid)'),
 ('revoke_kyc_verification(uuid,uuid,text)'), ('wallet_pending_offline_notice(uuid)'),
 ('claim_key_version_max()'), ('claim_media_reissuable(uuid,uuid,uuid,smallint)'),
 ('reissuable_media(uuid,uuid,smallint)'), ('reissue_claim_codes(uuid,uuid,uuid[],bytea[],smallint)'),
 ('issue_claim_codes(uuid,bytea[],smallint)'), ('associate_claim_code(bytea,uuid,text,smallint)'),
 ('claim_media(bytea,uuid,text,uuid,bytea,smallint)'),
 ('confirm_media_claim(uuid,uuid,bytea,uuid,uuid,smallint)'), ('public_balance_lookup(bytea,text,smallint)'),
 ('register_personalized_media(uuid,uuid,bytea,bytea,bytea,boolean,bytea,uuid,uuid)');
SELECT is((SELECT count(*)::int FROM m10a WHERE to_regprocedure(sig) IS NULL), 0,
  'les treize signatures de la mission existent (aucune faute de frappe dans les listes)');
-- Aucune ancienne signature (retirées par 0097).
SELECT is((SELECT count(*)::int FROM unnest(ARRAY['issue_claim_codes(uuid,bytea[])',
  'associate_claim_code(bytea,uuid)', 'claim_media(bytea,uuid,text,uuid,bytea)',
  'confirm_media_claim(uuid,uuid,bytea,uuid,uuid)', 'public_balance_lookup(bytea,text)']) s
  WHERE to_regprocedure(s) IS NOT NULL), 0, 'aucune ancienne signature des cinq fonctions de codes');
CREATE TEMP TABLE r10a (r text PRIMARY KEY);
INSERT INTO r10a SELECT rolname::text FROM pg_roles WHERE rolname LIKE 'cashless\_%' UNION SELECT 'public';
SELECT is((SELECT count(*)::int FROM r10a WHERE r = 'cashless_claimadmin'), 1, 'cashless_claimadmin existe');
SELECT set_eq(
  $q$SELECT r || ' ' || sig FROM r10a, m10a WHERE has_function_privilege(r, to_regprocedure(sig), 'EXECUTE')$q$,
  $q$VALUES
    ('cashless_app create_kyc_verification(uuid,uuid,text,text,text,date,uuid)'),
    ('cashless_app revoke_kyc_verification(uuid,uuid,text)'),
    ('cashless_app wallet_pending_offline_notice(uuid)'),
    ('cashless_app claim_key_version_max()'),
    ('cashless_app issue_claim_codes(uuid,bytea[],smallint)'),
    ('cashless_app associate_claim_code(bytea,uuid,text,smallint)'),
    ('cashless_app claim_media(bytea,uuid,text,uuid,bytea,smallint)'),
    ('cashless_app confirm_media_claim(uuid,uuid,bytea,uuid,uuid,smallint)'),
    ('cashless_app public_balance_lookup(bytea,text,smallint)'),
    ('cashless_perso associate_claim_code(bytea,uuid,text,smallint)'),
    ('cashless_perso register_personalized_media(uuid,uuid,bytea,bytea,bytea,boolean,bytea,uuid,uuid)'),
    ('cashless_claimadmin reissue_claim_codes(uuid,uuid,uuid[],bytea[],smallint)'),
    ('cashless_claimadmin reissuable_media(uuid,uuid,smallint)'),
    ('cashless_claimadmin claim_key_version_max()')$q$,
  'fonctions de la mission : liste exacte par rôle (cashless_app, cashless_perso, cashless_claimadmin ; PUBLIC et les autres non)');
SELECT is((SELECT count(*)::int FROM r10a, m10a
            WHERE sig = 'claim_media_reissuable(uuid,uuid,uuid,smallint)'
              AND has_function_privilege(r, to_regprocedure(sig), 'EXECUTE')), 0,
  'claim_media_reissuable : exécutable par aucun rôle cashless_* ni PUBLIC');
SELECT is((SELECT count(*)::int FROM r10a, m10a
            WHERE sig IN ('reissue_claim_codes(uuid,uuid,uuid[],bytea[],smallint)',
                          'reissuable_media(uuid,uuid,smallint)')
              AND r <> 'cashless_claimadmin' AND has_function_privilege(r, to_regprocedure(sig), 'EXECUTE')), 0,
  'reissue_claim_codes et reissuable_media : exécutables par cashless_claimadmin seul (ni cashless_app, ni PUBLIC)');
-- Entrées d'ACL des fonctions de la mission : le propriétaire et les rôles attendus seulement, jamais PUBLIC.
SELECT is((SELECT count(*)::int FROM m10a m
            CROSS JOIN LATERAL aclexplode(coalesce((SELECT proacl FROM pg_proc WHERE oid = to_regprocedure(m.sig)),
                                  acldefault('f', (SELECT proowner FROM pg_proc WHERE oid = to_regprocedure(m.sig))))) a
           WHERE a.grantee = 0), 0, 'PUBLIC : aucune entrée d''ACL sur les fonctions de la mission');
-- Fonctions de la mission : SECURITY DEFINER avec search_path fixé (hors wallet_pending_offline_notice : INVOKER).
SELECT is((SELECT count(*)::int FROM pg_proc WHERE oid = ANY (ARRAY[
  to_regprocedure('create_kyc_verification(uuid,uuid,text,text,text,date,uuid)'),
  to_regprocedure('revoke_kyc_verification(uuid,uuid,text)'), to_regprocedure('claim_key_version_max()'),
  to_regprocedure('claim_media_reissuable(uuid,uuid,uuid,smallint)'),
  to_regprocedure('reissuable_media(uuid,uuid,smallint)'),
  to_regprocedure('reissue_claim_codes(uuid,uuid,uuid[],bytea[],smallint)')])
  AND prosecdef AND proconfig @> ARRAY['search_path=public, pg_temp']), 6,
  'six fonctions DEFINER de la mission : search_path = public, pg_temp');
SELECT is((SELECT prosecdef FROM pg_proc WHERE oid = to_regprocedure('wallet_pending_offline_notice(uuid)')), false,
  'wallet_pending_offline_notice : SECURITY INVOKER');

-- 3. Droits de table de cashless_app ----------------------------------------------------------------------------------
SELECT is((SELECT count(*)::int FROM unnest(ARRAY['INSERT','UPDATE','DELETE','TRUNCATE']) p
            WHERE has_table_privilege('cashless_app', 'kyc_verification', p)
               OR (p IN ('INSERT','UPDATE') AND has_any_column_privilege('cashless_app', 'kyc_verification', p))), 0,
  'kyc_verification : aucun droit d''écriture (colonne comprise) pour cashless_app ; l''API passe par les fonctions');
SELECT ok(has_table_privilege('cashless_app', 'kyc_verification', 'SELECT'), 'kyc_verification : lecture conservée');
SELECT is((SELECT array_agg(a.attname::text ORDER BY a.attname) FROM pg_attribute a
            WHERE a.attrelid = 'otp_channel_attempt'::regclass AND a.attnum > 0 AND NOT a.attisdropped
              AND has_column_privilege('cashless_app', 'otp_channel_attempt', a.attname, 'UPDATE')),
  ARRAY['confirmed_at','failed_reason'], 'otp_channel_attempt : UPDATE de cashless_app sur ces deux colonnes seulement');
SELECT ok(NOT has_table_privilege('cashless_app', 'otp_channel_attempt', 'UPDATE'),
  'otp_channel_attempt : pas d''UPDATE de table entière pour cashless_app');
SELECT ok(has_table_privilege('cashless_app', 'otp_channel_attempt', 'INSERT')
      AND has_table_privilege('cashless_app', 'otp_channel_attempt', 'SELECT'),
  'otp_channel_attempt : INSERT et SELECT pour cashless_app');
SELECT is((SELECT count(*)::int FROM r10a, unnest(ARRAY['DELETE','TRUNCATE']) p
            WHERE has_table_privilege(r, 'otp_channel_attempt', p)), 0,
  'otp_channel_attempt : ni DELETE ni TRUNCATE pour aucun rôle ni PUBLIC');
SELECT is((SELECT count(*)::int FROM r10a WHERE r NOT IN ('cashless_app')
              AND (has_table_privilege(r, 'otp_channel_attempt', 'SELECT, INSERT, UPDATE')
                   OR has_any_column_privilege(r, 'otp_channel_attempt', 'SELECT, INSERT, UPDATE'))), 0,
  'otp_channel_attempt : aucun droit pour les autres rôles cashless_* ni PUBLIC (cashless_app seul)');
SELECT is((SELECT array_agg(a.attname::text ORDER BY a.attname) FROM pg_attribute a
            WHERE a.attrelid = 'media'::regclass AND a.attnum > 0 AND NOT a.attisdropped
              AND has_column_privilege('cashless_app', 'media', a.attname, 'UPDATE')),
  ARRAY['claim_attempts','claim_code_used_at'], 'media : UPDATE de cashless_app sur ces deux colonnes seulement');
SELECT ok(has_column_privilege('cashless_app', 'media', c, 'SELECT'),
  'media.' || c || ' : lisible par cashless_app') FROM unnest(ARRAY['claim_key_version','printed_number']) c;

-- 4. Sous cashless_app : refus réels et contrôles positifs ------------------------------------------------------------
SET LOCAL ROLE cashless_app;
SELECT pg_temp.a();
SELECT is(pg_temp.code(format('SELECT reissue_claim_codes(%L, %L, ARRAY[%L]::uuid[], ARRAY[sha256(''x'')], 2::smallint)',
  pg_temp.id('10a001'), pg_temp.id('10b9001'), pg_temp.id('10d9001'))), '42501',
  'cashless_app : reissue_claim_codes refusée (42501)');
SELECT is(pg_temp.code(format('SELECT * FROM reissuable_media(%L, %L, 2::smallint)', pg_temp.id('10a001'),
  pg_temp.id('10b9001'))), '42501', 'cashless_app : reissuable_media refusée (42501)');
SELECT is(pg_temp.code(format('SELECT claim_media_reissuable(%L, %L, %L, 2::smallint)', pg_temp.id('10d9001'),
  pg_temp.id('10a001'), pg_temp.id('10b9001'))), '42501', 'cashless_app : claim_media_reissuable refusée (42501)');
SELECT is(pg_temp.code(format($q$INSERT INTO kyc_verification (operator_id, customer_id, wallet_id, agent_id,
  id_type, id_country, id_last4, id_expires_on) VALUES (%L, %L, %L, %L, 'PASSPORT', 'SN', 'AB1C',
  current_date + 30)$q$, pg_temp.id('10a001'), pg_temp.id('10c001'), pg_temp.id('10cb01'), pg_temp.id('10e001'))),
  '42501', 'cashless_app : INSERT kyc_verification refusé');
SELECT is(pg_temp.code('UPDATE kyc_verification SET status = status'), '42501',
  'cashless_app : UPDATE kyc_verification refusé');
SELECT is(pg_temp.code(format('UPDATE media SET %s WHERE id = %L', c, pg_temp.id('10d9001'))), '42501',
  'cashless_app : UPDATE media SET ' || split_part(c, ' =', 1) || ' refusé')
  FROM unnest(ARRAY['printed_number = ''X1''', 'claim_key_version = 2']) c;
SELECT is(pg_temp.code(format('UPDATE otp_channel_attempt SET %s WHERE id = %L', c, pg_temp.id('10e0001'))), '42501',
  'cashless_app : UPDATE otp_channel_attempt SET ' || split_part(c, ' =', 1) || ' refusé')
  FROM unnest(ARRAY['channel = ''SMS_PRIMARY''', 'provider = ''x''', 'sent_at = now()', 'challenge_id = challenge_id',
                    'operator_id = operator_id', 'id = id']) c;
SELECT is(pg_temp.code('DELETE FROM otp_channel_attempt'), '42501', 'cashless_app : DELETE otp_channel_attempt refusé');
SELECT is(pg_temp.code('TRUNCATE otp_channel_attempt'), '42501', 'cashless_app : TRUNCATE otp_channel_attempt refusé');
-- Contrôles positifs
SELECT is(pg_temp.code('SELECT claim_key_version_max()'), NULL, 'positif : claim_key_version_max exécutable');
SELECT is(pg_temp.code(format('SELECT wallet_pending_offline_notice(%L)', pg_temp.id('10cb01'))), NULL,
  'positif : wallet_pending_offline_notice exécutable');
SELECT is(pg_temp.code(format($q$SELECT create_kyc_verification(%L, NULL, 'PASSPORT', 'SN', 'ab1c',
  current_date + 30, %L)$q$, pg_temp.id('10cb01'), pg_temp.id('10e001'))), NULL,
  'positif : create_kyc_verification exécutable (appel abouti)');
SELECT is((SELECT count(*)::int FROM kyc_verification WHERE operator_id = pg_temp.id('10a001')
             AND wallet_id = pg_temp.id('10cb01') AND id_last4 = 'AB1C'), 1,
  'positif : l''identification créée par la fonction est lue (SELECT conservé)');
SELECT is(pg_temp.code(format($q$SELECT revoke_kyc_verification(
  (SELECT id FROM kyc_verification WHERE operator_id = %L AND wallet_id = %L), %L, 'motif de révocation long')$q$,
  pg_temp.id('10a001'), pg_temp.id('10cb01'), pg_temp.id('10e001'))), NULL,
  'positif : revoke_kyc_verification exécutable (appel abouti)');
SELECT is((SELECT claim_key_version FROM media WHERE id = pg_temp.id('10d9001')), 1::smallint,
  'positif : SELECT media.claim_key_version');
SELECT is(pg_temp.code(format($q$INSERT INTO otp_channel_attempt (operator_id, challenge_id, channel, provider)
  VALUES (%L, %L, 'SMS_PRIMARY', 'fake-sms')$q$, pg_temp.id('10a001'), pg_temp.id('10d0001'))), NULL,
  'positif : INSERT otp_channel_attempt');
SELECT is(pg_temp.code(format('UPDATE otp_channel_attempt SET confirmed_at = now() WHERE id = %L',
  pg_temp.id('10e0001'))), NULL, 'positif : UPDATE otp_channel_attempt SET confirmed_at');
SELECT is(pg_temp.code(format($q$UPDATE otp_channel_attempt SET failed_reason = 'TIMEOUT' WHERE challenge_id = %L
  AND provider = 'fake-sms'$q$, pg_temp.id('10d0001'))), NULL, 'positif : UPDATE otp_channel_attempt SET failed_reason');
RESET ROLE;

-- 5. cashless_claimadmin : surface exacte --------------------------------------------------------------------------------
SELECT is((SELECT count(*)::int FROM pg_class c
            WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
              AND NOT EXISTS (SELECT 1 FROM pg_depend e WHERE e.classid = 'pg_class'::regclass
                                 AND e.objid = c.oid AND e.deptype = 'e')
              AND (has_table_privilege('cashless_claimadmin', c.oid,
                     'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
                   OR has_any_column_privilege('cashless_claimadmin', c.oid, 'SELECT, INSERT, UPDATE, REFERENCES'))),
  0, 'cashless_claimadmin : aucun droit de table, de vue ni de colonne');
SELECT is((SELECT count(*)::int FROM pg_class c
            WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'S'
              AND CASE WHEN c.relkind = 'S'
                       THEN has_sequence_privilege('cashless_claimadmin', c.oid, 'USAGE, SELECT, UPDATE') END), 0,
  'cashless_claimadmin : aucun droit de séquence');
SELECT is((SELECT array_agg(p.oid::regprocedure::text ORDER BY p.oid::regprocedure::text)
             FROM pg_proc p
            WHERE p.pronamespace = 'public'::regnamespace
              AND NOT EXISTS (SELECT 1 FROM pg_depend e WHERE e.classid = 'pg_proc'::regclass
                                 AND e.objid = p.oid AND e.deptype = 'e')
              AND has_function_privilege('cashless_claimadmin', p.oid, 'EXECUTE')),
  ARRAY['claim_key_version_max()', 'reissuable_media(uuid,uuid,smallint)',
        'reissue_claim_codes(uuid,uuid,uuid[],bytea[],smallint)'],
  'cashless_claimadmin : exactement trois EXECUTE sur tout le schéma');
SELECT ok(has_schema_privilege('cashless_claimadmin', 'public', 'USAGE')
      AND NOT has_schema_privilege('cashless_claimadmin', 'public', 'CREATE'),
  'cashless_claimadmin : USAGE du schéma public seul (pas CREATE)');
SELECT ok(NOT has_database_privilege('cashless_claimadmin', current_database(), 'TEMPORARY')
      AND NOT has_database_privilege('cashless_claimadmin', current_database(), 'CREATE'),
  'cashless_claimadmin : ni TEMPORARY ni CREATE sur la base');
SELECT is((SELECT rolcanlogin AND NOT (rolsuper OR rolcreaterole OR rolcreatedb OR rolbypassrls OR rolreplication
                  OR rolinherit) FROM pg_roles WHERE rolname = 'cashless_claimadmin'), true,
  'cashless_claimadmin : LOGIN, sans SUPERUSER, CREATEROLE, CREATEDB, BYPASSRLS, REPLICATION, INHERIT');
SELECT is((SELECT count(*)::int FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.member
            WHERE r.rolname = 'cashless_claimadmin'), 0, 'cashless_claimadmin : membre d''aucun rôle');
SELECT is((SELECT count(*)::int FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.roleid
            WHERE r.rolname = 'cashless_claimadmin'), 0, 'cashless_claimadmin : aucun membre');
SELECT is((SELECT count(*)::int FROM pg_db_role_setting s JOIN pg_roles r ON r.oid = s.setrole
            WHERE r.rolname = 'cashless_claimadmin' AND s.setconfig @> ARRAY['statement_timeout=30s']
              AND s.setconfig @> ARRAY['lock_timeout=5s'] AND s.setconfig @> ARRAY['idle_in_transaction_session_timeout=10s']),
  1, 'cashless_claimadmin : délais statement_timeout, lock_timeout et idle_in_transaction_session_timeout');
SET LOCAL ROLE cashless_claimadmin;
SELECT is(pg_temp.code('SELECT claim_key_version_max()'), NULL, 'cashless_claimadmin : claim_key_version_max s''appelle');
SELECT is(pg_temp.code(format('SELECT count(*) FROM reissuable_media(%L, %L, 2::smallint)', pg_temp.id('10a001'),
  pg_temp.id('10b9001'))), NULL, 'cashless_claimadmin : reissuable_media s''appelle sur la fixture');
SELECT is((SELECT count(*)::int FROM reissuable_media(pg_temp.id('10a001'), pg_temp.id('10b9001'), 2::smallint)), 1,
  'cashless_claimadmin : reissuable_media rend le bracelet sans code de la fixture');
SELECT is(pg_temp.code(format($q$SELECT set_config('t10a.n', reissue_claim_codes(%L, %L, ARRAY[%L]::uuid[],
  ARRAY[sha256('code 10a')], 2::smallint)::text, true)$q$, pg_temp.id('10a001'), pg_temp.id('10b9001'),
  pg_temp.id('10d9001'))), NULL, 'cashless_claimadmin : reissue_claim_codes s''appelle sur la fixture');
SELECT is(current_setting('t10a.n'), '1', 'cashless_claimadmin : un bracelet réémis');
SELECT is(pg_temp.code('SELECT * FROM ' || t || ' LIMIT 1'), '42501', 'cashless_claimadmin : SELECT sur ' || t || ' refusé')
  FROM unnest(ARRAY['media', 'claim_code', 'audit_log', 'party', 'media_batch', 'kyc_verification',
                    'otp_channel_attempt']) t;
SELECT is(pg_temp.code('SELECT claim_code_hash FROM media'), '42501', 'cashless_claimadmin : media.claim_code_hash illisible');
SELECT is(pg_temp.code(format($q$INSERT INTO audit_log (operator_id, action, object_type, object_id, origin)
  VALUES (%L, 'X', 'x', 'x', 'test')$q$, pg_temp.id('10a001'))), '42501', 'cashless_claimadmin : INSERT audit_log refusé');
SELECT is(pg_temp.code('CREATE TABLE public.t10a_nope (i int)'), '42501', 'cashless_claimadmin : CREATE TABLE refusé');
SELECT is(pg_temp.code('CREATE TEMP TABLE t10a_tmp (i int)'), '42501', 'cashless_claimadmin : TEMPORARY refusé');
SELECT is(pg_temp.code(format('SELECT create_kyc_verification(%L, NULL, ''PASSPORT'', ''SN'', ''AB1C'', current_date + 30, %L)',
  pg_temp.id('10cb01'), pg_temp.id('10e001'))), '42501', 'cashless_claimadmin : create_kyc_verification refusée');
SELECT is(pg_temp.code(format('SELECT wallet_pending_offline_notice(%L)', pg_temp.id('10cb01'))), '42501',
  'cashless_claimadmin : wallet_pending_offline_notice refusée');
SELECT is(pg_temp.code(format('SELECT claim_media_reissuable(%L, %L, %L, 2::smallint)', pg_temp.id('10d9001'),
  pg_temp.id('10a001'), pg_temp.id('10b9001'))), '42501', 'cashless_claimadmin : claim_media_reissuable refusée');
SELECT is(pg_temp.code('SELECT issue_claim_codes(gen_random_uuid(), ARRAY[sha256(''x'')], 2::smallint)'), '42501',
  'cashless_claimadmin : issue_claim_codes refusée');
RESET ROLE;

-- 6. cashless_perso : mêmes droits qu'avant sur les cinq fonctions (signatures versionnées) -------------------------------
SELECT ok(has_function_privilege('cashless_perso', 'associate_claim_code(bytea,uuid,text,smallint)', 'EXECUTE')
      AND has_function_privilege('cashless_perso',
        'register_personalized_media(uuid,uuid,bytea,bytea,bytea,boolean,bytea,uuid,uuid)', 'EXECUTE'),
  'cashless_perso : associate_claim_code (versionnée) et register_personalized_media exécutables');
SELECT is((SELECT count(*)::int FROM unnest(ARRAY['issue_claim_codes(uuid,bytea[],smallint)',
  'claim_media(bytea,uuid,text,uuid,bytea,smallint)', 'confirm_media_claim(uuid,uuid,bytea,uuid,uuid,smallint)',
  'public_balance_lookup(bytea,text,smallint)']) s WHERE has_function_privilege('cashless_perso', s, 'EXECUTE')), 0,
  'cashless_perso : aucune des quatre autres fonctions de codes');

-- 7. Rejeu de roles.sql puis post-roles.sql : mêmes droits (idempotent) ----------------------------------------------------
CREATE TEMP TABLE w10a_before AS
  SELECT r, sig, has_function_privilege(r, to_regprocedure(sig), 'EXECUTE') AS x FROM r10a, m10a;
SET LOCAL client_min_messages = warning;
\ir ../roles.sql
\ir ../post-roles.sql
\ir ../roles.sql
\ir ../post-roles.sql
SELECT is((SELECT count(*)::int FROM w10a_before b
            WHERE b.x IS DISTINCT FROM has_function_privilege(b.r, to_regprocedure(b.sig), 'EXECUTE')), 0,
  'rejeu (deux fois) : droits des fonctions de la mission inchangés');
SELECT is((SELECT array_agg(a.attname::text ORDER BY a.attname) FROM pg_attribute a
            WHERE a.attrelid = 'otp_channel_attempt'::regclass AND a.attnum > 0 AND NOT a.attisdropped
              AND has_column_privilege('cashless_app', 'otp_channel_attempt', a.attname, 'UPDATE')),
  ARRAY['confirmed_at','failed_reason'], 'rejeu : otp_channel_attempt UPDATE de cashless_app inchangé (deux colonnes)');
SELECT is((SELECT count(*)::int FROM unnest(ARRAY['INSERT','UPDATE']) p
            WHERE has_table_privilege('cashless_app', 'kyc_verification', p)
               OR has_any_column_privilege('cashless_app', 'kyc_verification', p)), 0,
  'rejeu : kyc_verification sans écriture directe pour cashless_app');
SELECT is((SELECT count(*)::int FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
              AND NOT EXISTS (SELECT 1 FROM pg_depend e WHERE e.classid = 'pg_proc'::regclass
                                 AND e.objid = p.oid AND e.deptype = 'e')
              AND has_function_privilege('cashless_claimadmin', p.oid, 'EXECUTE')), 3,
  'rejeu : cashless_claimadmin garde exactement trois EXECUTE');

SELECT * FROM finish();
ROLLBACK;
