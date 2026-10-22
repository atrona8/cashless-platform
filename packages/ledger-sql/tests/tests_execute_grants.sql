-- EXECUTE rôle par rôle (OP-N44, ADR-101 ; mission 5a, identite-enrolement-terminaux, lot WP07 ;
-- research R-11, contracts/database-debts.md) — pgTAP, écrit à la main.
-- Lancer : pg_prove -d <base> tests/tests_execute_grants.sql (base créée par les migrations,
-- roles.sql et post-roles.sql rejoués).
-- La suite rejoue elle-même roles.sql puis post-roles.sql (ordre de migrate.ts et de reset-db) :
-- roles.sql rend EXECUTE sur toutes les fonctions à cashless_app, post-roles.sql doit le reprendre.
-- Listes figées : une fonction ajoutée à un rôle, ou rendue à PUBLIC, fait échouer la suite. Les
-- fonctions des extensions (pgcrypto ; pgtap, créée par la suite) sont hors du compte.
\set ON_ERROR_STOP 1
\set QUIET 1
BEGIN;
SET LOCAL client_min_messages = warning;
\ir ../roles.sql
\ir ../post-roles.sql
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

-- Fonctions de public (hors extensions) qu'un rôle peut exécuter, triées.
CREATE FUNCTION pg_temp.fns(p_role text) RETURNS text[] LANGUAGE sql STABLE AS $$
  SELECT coalesce(array_agg(p.oid::regprocedure::text
                            ORDER BY p.oid::regprocedure::text COLLATE "C"), '{}')
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND NOT EXISTS (SELECT 1 FROM pg_depend e WHERE e.classid = 'pg_proc'::regclass
                        AND e.objid = p.oid AND e.deptype = 'e')
     AND has_function_privilege(p_role, p.oid, 'EXECUTE')
$$;
-- Liste attendue, écrite en signatures courtes (normalisées par regprocedure), triée.
CREATE FUNCTION pg_temp.sigs(p regprocedure[]) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(array_agg(x ORDER BY x COLLATE "C"), '{}') FROM unnest(p::text[]) x
$$;

-- 1. PUBLIC n'exécute aucune fonction de public ---------------------------------------------------
SELECT is(pg_temp.fns('public'), '{}'::text[],
  'PUBLIC : aucune fonction de public exécutable (OP-N44)');
SELECT is((SELECT count(*)::int FROM pg_proc p
            WHERE p.pronamespace = 'public'::regnamespace
              AND NOT EXISTS (SELECT 1 FROM pg_depend e WHERE e.classid = 'pg_proc'::regclass
                                 AND e.objid = p.oid AND e.deptype = 'e')
              AND EXISTS (SELECT 1
                            FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                           WHERE a.grantee = 0)), 0,
  'PUBLIC : aucune entrée dans les droits d''une fonction de public (droit par défaut compris)');
SELECT is((SELECT count(*)::int FROM pg_proc p
            JOIN pg_depend e ON e.classid = 'pg_proc'::regclass AND e.objid = p.oid
                            AND e.deptype = 'e'
            JOIN pg_extension x ON x.oid = e.refobjid AND x.extname = 'pgcrypto'
           WHERE has_function_privilege('public', p.oid, 'EXECUTE')), 0,
  'pgcrypto : aucune fonction exécutable par PUBLIC (ni le schéma ni l''API ne l''appellent)');
SELECT is((SELECT count(*)::int FROM pg_proc p
            JOIN pg_depend e ON e.classid = 'pg_proc'::regclass AND e.objid = p.oid
                            AND e.deptype = 'e'
            JOIN pg_extension x ON x.oid = e.refobjid AND x.extname = 'pgcrypto'
           CROSS JOIN unnest(ARRAY['cashless_app', 'cashless_platform', 'cashless_tagkeys',
                                   'cashless_perso', 'cashless_tagcheck', 'cashless_keyadmin']) r
           WHERE has_function_privilege(r, p.oid, 'EXECUTE')), 0,
  'pgcrypto : aucun rôle applicatif ne l''exécute');

-- 2. Chaque rôle n'exécute que sa liste ----------------------------------------------------------
-- API publique : appels réels de apps/api/src, fonctions appelées par ses fonctions et
-- déclencheurs SECURITY INVOKER, fonctions des terminaux (0022, 0023) des lots WP12 à WP16,
-- record_config_served (configuration servie, lot WP17).
SELECT is(pg_temp.fns('cashless_app'), pg_temp.sigs(ARRAY[
  'activate_media(uuid,uuid,text,uuid)', 'assert_device_active(uuid)',
  'associate_claim_code(bytea,uuid)', 'blacklist_media(uuid,text,uuid)',
  'check_device_enrollment_code(bytea,text)', 'claim_attempts_exceeded(uuid,uuid,text)',
  'claim_media(bytea,uuid,text,uuid,bytea)', 'claim_session_operator()', 'close_batch(uuid)',
  'confirm_media_claim(uuid,uuid,bytea,uuid,uuid)',
  'consume_device_nonce(uuid,bytea,timestamptz,integer)', 'consume_tap(bigint,uuid)',
  'consume_tap_for_claim(bigint,uuid)',
  'create_device_enrollment_code(bytea,uuid,uuid,text,boolean,integer,uuid)',
  'create_platform_admin(uuid,text,text,text,text,text,text,uuid)',
  'decide_approval_request(uuid,uuid,boolean,text)', 'device_token_family_active(uuid,uuid)',
  'enqueue_tag_key_job(uuid)',
  'enroll_device(bytea,text,text,text,bytea,bytea,bytea,timestamptz,text,text,bytea,timestamptz,'
    || 'uuid)',
  'enrollment_attempts_exceeded(bytea,inet)', 'event_transition_conditions(uuid,event_status)',
  'expire_media_claims(uuid)', 'forfeit_batch_deposits(uuid,integer)', 'forfeit_deposit(uuid)',
  'identify_person(text,text)', 'invalidate_unassociated_codes(uuid)',
  'issue_claim_codes(uuid,bytea[])', 'mark_claim_code_used(uuid)', 'media_event(uuid)',
  'media_owner_session()', 'media_reinstatement_approved(uuid,uuid,uuid)',
  'media_session_operator()', 'media_set_actor(uuid,text)',
  'media_set_status(uuid,text,text,uuid)', 'media_status_log(uuid)', 'media_summary(uuid)',
  'open_event_ledger(uuid)', 'open_event_wallet(uuid,uuid)', 'open_participation_account(uuid)',
  'post_transaction(uuid,text,text,timestamptz,text,jsonb,uuid,uuid,uuid,uuid,uuid,uuid,uuid,'
    || 'jsonb)',
  'preload_batch(uuid,integer)', 'preload_media(uuid)', 'public_balance_lookup(bytea,text)',
  'purge_device_enrollment_attempts()', 'purge_device_request_nonces(integer)',
  'reassign_pool_media(uuid,bytea)', 'record_config_served(uuid,uuid)',
  'record_device_heartbeat(uuid,text,timestamptz)',
  'record_enrollment_attempt(bytea,inet,text)',
  'record_enrollment_refusal(bytea,inet,text,text,text,text,text,uuid)', 'recover_media(uuid)',
  'refund_cash_due(uuid,uuid,text,uuid,uuid,uuid)', 'refund_deposit(uuid,uuid)',
  'register_tap(uuid,bytea,bytea,bigint,timestamptz,uuid,text,uuid,bigint,bytea)',
  'reinstate_media(uuid,uuid,uuid,text)', 'release_media(uuid,text)',
  'replace_media(uuid,uuid)', 'retry_tag_key_job(uuid)',
  'revoke_device_token_family(uuid,uuid,text)',
  'rotate_device_refresh_token(bytea,bytea,bytea,timestamptz)',
  'set_device_status(uuid,text,text,uuid)', 'set_event_status(uuid,event_status,uuid)',
  'set_media_batch_status(uuid,text,text,uuid)', 'suspend_media(uuid,text,uuid)',
  'take_deposit(uuid,uuid)', 'wallet_spendable(uuid)', 'wallet_topup_headroom(uuid,timestamptz)'
]::text[]::regprocedure[]),
  'cashless_app : liste exacte des fonctions exécutables');
SELECT ok(NOT has_function_privilege('cashless_app', f, 'EXECUTE'),
  'cashless_app : ' || f || ' non exécutable')
  FROM unnest(ARRAY['device_admin_allowed(uuid,uuid,uuid)', 'retire_dedicated_key(uuid,integer)',
                    'retire_dedicated_key_for_job(uuid)', 'register_personalized_media(uuid,uuid,'
                      || 'bytea,bytea,bytea,boolean,bytea,uuid,uuid)',
                    'set_debit_authority(uuid,text,uuid)', 'seal_audit(uuid,interval)']) f;
SELECT is(pg_temp.fns('cashless_platform'), pg_temp.sigs(ARRAY[
  'decide_approval_request(uuid,uuid,boolean,text)', 'platform_session()'
]::text[]::regprocedure[]),
  'cashless_platform : liste exacte des fonctions exécutables');
SELECT is(pg_temp.fns('cashless_tagkeys'), pg_temp.sigs(ARRAY[
  'assert_device_active(uuid)', 'claim_tag_key_job(text[],integer)',
  'claim_tag_key_job_for(uuid[],text[],integer)',
  'consume_device_nonce(uuid,bytea,timestamptz,integer)', 'device_token_family_active(uuid,uuid)',
  'finish_tag_key_job(uuid,text,text,jsonb,integer)', 'tag_key_job_refusal(uuid)'
]::text[]::regprocedure[]),
  'cashless_tagkeys : liste exacte (file des rechiffrements, garde des terminaux)');
SELECT is(pg_temp.fns('cashless_perso'), pg_temp.sigs(ARRAY[
  'associate_claim_code(bytea,uuid)', 'claim_tag_key_job(text[],integer)',
  'claim_tag_key_job_for(uuid[],text[],integer)', 'enqueue_tag_key_child_job(uuid,uuid)',
  'finish_tag_key_job(uuid,text,text,jsonb,integer)', 'identify_person(text,text)',
  'register_personalized_media(uuid,uuid,bytea,bytea,bytea,boolean,bytea,uuid,uuid)',
  'retire_dedicated_key_for_job(uuid)', 'tag_key_job_refusal(uuid)'
]::text[]::regprocedure[]),
  'cashless_perso : liste exacte (sans retire_dedicated_key, OP-N62)');
SELECT is(pg_temp.fns('cashless_tagcheck'), '{}'::text[],
  'cashless_tagcheck : aucune fonction');
SELECT is(pg_temp.fns('cashless_keyadmin'), pg_temp.sigs(ARRAY[
  'claim_tag_key_job(text[],integer)', 'claim_tag_key_job_for(uuid[],text[],integer)',
  'finish_tag_key_job(uuid,text,text,jsonb,integer)', 'tag_key_job_refusal(uuid)'
]::text[]::regprocedure[]),
  'cashless_keyadmin : liste exacte');

-- 3. Refus à l'appel (et non seulement au catalogue) ---------------------------------------------
SET LOCAL ROLE cashless_tagcheck;
SELECT throws_ok($$SELECT claim_tag_key_job(ARRAY['REENCRYPT'])$$, '42501', NULL,
  'contrôle quotidien : ne prend aucun travail de clé');
SET LOCAL ROLE cashless_platform;
SELECT throws_ok($$SELECT open_event_ledger('00000000-0000-0000-0000-000000000000')$$,
  '42501', NULL,
  'plateforme : n''exécute plus les fonctions d''API des prestataires');
SET LOCAL ROLE cashless_app;
-- Purges : accordées à l'API publique seule (travailleur device-purge, lot WP12) ; refusées aux
-- processus des clés, dont celui qui consomme aussi des nonces (POST /media/auth-keys).
SELECT lives_ok($$SELECT purge_device_request_nonces(1)$$,
  'API publique : purge des nonces exécutable (travailleur device-purge, lot WP12)');
SELECT lives_ok($$SELECT purge_device_enrollment_attempts()$$,
  'API publique : purge des essais d''enrôlement exécutable (lot WP12)');
SELECT throws_ok($$SELECT seal_ledger('00000000-0000-0000-0000-000000000000', interval '1 hour')$$,
  '42501', NULL, 'API publique : fonction du schéma qu''elle n''appelle pas refusée (scellement)');
SET LOCAL ROLE cashless_tagkeys;
SELECT throws_ok($$SELECT purge_device_request_nonces(1)$$, '42501', NULL,
  'clés de bracelet : purge des nonces refusée (planifiée par l''API publique seule)');
RESET ROLE;

-- 4. Fonction créée à la main, hors de migrate.ts, par le propriétaire --------------------------
-- LIMITE RESTANTE (décision du porteur du 20/10/2026, option c) : migrate.ts applique une série et
-- rejoue roles.sql puis post-roles.sql dans une même transaction, une fonction d'une migration
-- n'est donc jamais validée exécutable par PUBLIC (migrate-rights.spec.ts de l'API). Une fonction
-- créée à la main hors de migrate.ts reste exécutable par PUBLIC jusqu'au prochain rejeu de
-- post-roles.sql : la première assertion le borne, la suite prouve la fermeture au rejeu.
CREATE TEMP TABLE wp07_before AS
  SELECT r, pg_temp.fns(r) AS f
    FROM unnest(ARRAY['public', 'cashless_app', 'cashless_platform', 'cashless_tagkeys',
                      'cashless_perso', 'cashless_tagcheck', 'cashless_keyadmin']) r;
CREATE FUNCTION public.wp07_future_probe() RETURNS int LANGUAGE sql AS 'SELECT 1';
SELECT ok(has_function_privilege('public', 'public.wp07_future_probe()', 'EXECUTE'),
  'LIMITE RESTANTE : fonction créée à la main hors de migrate.ts exécutable par PUBLIC jusqu''au '
  || 'rejeu');
\ir ../roles.sql
\ir ../post-roles.sql
SELECT ok(NOT has_function_privilege('public', 'public.wp07_future_probe()', 'EXECUTE')
      AND NOT has_function_privilege('cashless_app', 'public.wp07_future_probe()', 'EXECUTE'),
  'rejeu roles.sql puis post-roles.sql : la fonction nouvelle n''est exécutable ni par PUBLIC '
  || 'ni par cashless_app');
SELECT is((SELECT array_agg(r ORDER BY r) FROM wp07_before
             WHERE f IS DISTINCT FROM pg_temp.fns(r)), NULL::text[],
  'rejeu : liste de chaque rôle inchangée (idempotent)');

SELECT * FROM finish();
ROLLBACK;
