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
-- post-roles.sql vient de fermer le défaut des fonctions futures (OP-N68) : pgtap, créée ensuite, n'aurait plus
-- d'EXECUTE pour PUBLIC et les assertions sous SET ROLE échoueraient. On rouvre le défaut le temps de créer
-- l'extension ; le §4 rejoue post-roles.sql (défaut refermé) AVANT de créer sa fonction de preuve, et
-- n'inclut jamais ce fichier.
\ir _grants_for_tests.sql
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
-- record_config_served (configuration servie, lot WP17) ; encaissement en ligne (mission 5b,
-- lot WP07 : vendeurs, catalogue, paiement, demandes QR ; contracts/database-rights.md).
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
  'reassign_pool_media(uuid,bytea)', 'record_config_served(uuid,uuid)',
  'record_device_heartbeat(uuid,text,timestamptz)',
  'record_enrollment_attempt(bytea,inet,text)',
  'record_enrollment_refusal(bytea,inet,text,text,text,text,text,uuid)', 'recover_media(uuid)',
  'register_tap(uuid,bytea,bytea,bigint,timestamptz,uuid,text,uuid,bigint,bytea)',
  'reinstate_media(uuid,uuid,uuid,text)', 'release_media(uuid,text)',
  'replace_media(uuid,uuid)', 'retry_tag_key_job(uuid)',
  'revoke_device_token_family(uuid,uuid,text)',
  'rotate_device_refresh_token(bytea,bytea,bytea,timestamptz)',
  'set_device_status(uuid,text,text,uuid)', 'set_event_status(uuid,event_status,uuid)',
  'set_media_batch_status(uuid,text,text,uuid)', 'suspend_media(uuid,text,uuid)',
  'wallet_spendable(uuid)', 'wallet_topup_headroom(uuid,timestamptz)',
  -- Mission 5b, lot WP07 : vendeurs (0031)
  'assert_vendor_session(uuid,uuid)', 'begin_vendor_pin_check(uuid,uuid)',
  'close_vendor_session(uuid)', 'create_vendor(uuid,text,text,uuid)',
  'open_vendor_session(uuid,uuid)', 'set_vendor_pin(uuid,text,uuid)',
  'set_vendor_status(uuid,text,uuid)',
  -- catalogue (0032)
  'check_sale_lines(uuid,jsonb,bigint)', 'create_catalog_category(uuid,text,text,integer,uuid)',
  'create_catalog_item(uuid,text,text,bigint,integer,uuid)', 'record_device_catalog_served(uuid)',
  'record_sale_lines(uuid,uuid,jsonb)', 'set_catalog_policy(uuid,boolean,uuid)',
  'update_catalog_category(uuid,text,text,integer,boolean,uuid)',
  'update_catalog_item(uuid,uuid,text,text,bigint,integer,boolean,uuid)',
  -- paiement et annulation (0033 ; record_device_seq du schéma de référence)
  'assert_reversible(uuid,text,uuid,uuid,text,uuid)', 'assert_tap_payable(bigint,uuid)',
  'assert_wallet_payable(uuid)', 'record_device_seq(uuid,bigint,bytea,text,text,uuid,text,uuid)',
  'record_sale_attribution(uuid,uuid,text,uuid)',
  -- demandes de paiement QR (0034)
  'cancel_payment_request(uuid,uuid,bytea)', 'confirm_payment_request(uuid,uuid,bytea)',
  'create_customer_qr_token(uuid,uuid,bytea)',
  'create_merchant_payment_request(uuid,uuid,bigint,character,integer,bytea,text,jsonb,integer)',
  'lock_customer_qr_token(bytea,uuid)', 'lock_payment_request_for_pay(uuid,bytea,uuid,uuid)',
  'payment_request_for_token(uuid,bytea)',
  -- Authentification des festivaliers (0080, post-roles.sql §10)
  'operator_by_public_code(text)', 'otp_challenge_operator(uuid)', 'customer_refresh_operator(bytea)',
  -- Mission 6, lot WP05 : sessions de caisse (0036)
  'open_cash_session(uuid,uuid)', 'count_cash_session(uuid,bigint,uuid,uuid,text)',
  'begin_cash_close(uuid,uuid)', 'finish_cash_close(uuid,uuid,uuid)', 'attach_cash_tx(uuid,uuid)',
  'open_cash_due_anomaly(uuid,uuid,bigint,uuid)', 'take_deposit_for_session(uuid,uuid)',
  'refund_deposit_for_session(uuid,uuid)',
  'refund_cash_due_for_session(uuid,uuid,text,uuid,uuid,uuid)',
  -- cautions sans compte désigné (0041), à la place de take_deposit et refund_deposit
  'take_deposit_from_balance(uuid)', 'refund_deposit_from_balance(uuid)',
  -- configurations PSP (0037)
  'create_psp_configuration(uuid,text,text,uuid,text,boolean,timestamptz,timestamptz,uuid,uuid)',
  'activate_psp_configuration(uuid,uuid)', 'set_event_psp_selection(uuid,text,uuid,uuid,uuid)',
  'resolve_psp_configuration(uuid,text)', 'psp_configuration_secret_ref(uuid)',
  'psp_webhook_context(uuid)',
  -- recharges (0038)
  'create_psp_topup(uuid,uuid,text,bigint,text,uuid,uuid,uuid,timestamptz)',
  'mark_psp_topup_initiated(uuid,text,timestamptz)', 'cancel_psp_topup(uuid)',
  'expire_psp_topups(uuid[])', 'psp_poll_candidates(integer)',
  'record_psp_event(uuid,text,text,bytea,jsonb)', 'mark_psp_event(uuid,text,text,uuid)',
  'psp_events_to_retry(integer)', 'purge_psp_event_bodies(integer)',
  'read_psp_event_body(uuid,uuid)', 'complete_psp_topup(uuid,uuid,bigint,text)',
  'complete_card_topup(uuid,uuid,bigint,text,text,text)',
  'fail_psp_topup(uuid,text,boolean,text,text,text)', 'record_webhook_rejection(uuid,text)',
  'card_topups_today(uuid,text,timestamptz)', 'wallet_card_count(uuid,text)',
  -- contestations (0038)
  'record_chargeback(uuid,text,bigint,boolean)', 'attach_chargeback_tx(uuid,uuid)',
  'block_wallet_after_chargeback(uuid,uuid)', 'unblock_wallet(uuid,uuid)',
  -- Mission hors-ligne-snapshots-lots, lot WP08 (post-roles.sql §8d ; ADR-140) : politique (0043),
  -- snapshot lu par le terminal (0045), lots, registre, import (0046), anomalies (0047), terminal,
  -- vendeur et configuration datés (0048) ; effective_offline_policy, policy_in_force,
  -- device_missing_seqs et waive_seq_gap sont pré-existantes (database-rights.md)
  'set_offline_policy(text,uuid,jsonb,integer,uuid)', 'clear_offline_policy(text,uuid,integer,uuid)',
  'offline_policy_level(text,uuid)', 'offline_max_exposure(uuid)',
  'effective_offline_policy(uuid)', 'policy_in_force(uuid,bigint)',
  'offline_snapshot_for_device(uuid,bigint)', 'snapshot_public_keys(uuid)',
  'open_offline_batch(uuid,uuid,uuid,bigint,bytea,bytea[],bytea,bytea,text,integer)',
  'complete_offline_batch(uuid,jsonb)', 'offline_batch_state(uuid)',
  'record_offline_retry(uuid,bigint,text)', 'record_offline_op_result(uuid,bigint,jsonb)',
  'offline_op_results(uuid)', 'offline_batch_retries_open(uuid)',
  'check_seq_gap_waivable(uuid,bigint)', 'device_missing_seqs(uuid,integer)',
  'waive_seq_gap(uuid,bigint,uuid,uuid,text)',
  'create_device_journal_import(uuid,jsonb,bytea,jsonb,text,uuid)',
  'begin_device_journal_import(uuid,bytea,uuid)',
  'open_imported_batch(uuid,uuid,bigint,bytea,bytea[],bytea,bytea)',
  'finish_device_journal_import(uuid,text,jsonb)', 'device_journal_import_view(uuid,boolean)',
  'device_journal_imports_processing()', 'cancel_device_journal_import(uuid,uuid,text)',
  'open_offline_anomaly(uuid,text,uuid,uuid,bigint,uuid,bigint,text,jsonb,uuid)',
  'reduce_offline_shortfall(uuid,bigint,uuid)', 'offline_block_time(uuid,uuid,timestamptz)',
  'ack_offline_snapshot(uuid,bigint,bytea)', 'offline_snapshot_ack_floor(uuid,timestamptz)',
  'offline_snapshot_meta(uuid,bigint,uuid)', 'offline_media_state_at(uuid,bytea,bigint)',
  'offline_config_in_force(uuid,bigint,timestamptz,interval)',
  'device_status_at(uuid,timestamptz)', 'device_revoked_at(uuid)',
  'assert_vendor_session_at(uuid,uuid,timestamptz)',
  'record_sale_attribution_at(uuid,uuid,text,uuid,timestamptz)',
  'set_device_station_name(uuid,text,uuid)',
  'offline_device_exposure(uuid,uuid,bigint,timestamptz,interval)', 'lock_device(uuid,text)',
  -- 0051 (WP21 partie D) : enveloppe étroite de la remontée des terminaux ; les deux fonctions qu'elle appelle
  -- (event_device_sync_status, event_sync_deadline) restent refusées à cashless_app
  'event_device_sync_status_api(uuid)'
]::text[]::regprocedure[]),
  'cashless_app : liste exacte des fonctions exécutables');
SELECT ok(NOT has_function_privilege('cashless_app', f, 'EXECUTE'),
  'cashless_app : ' || f || ' non exécutable')
  FROM unnest(ARRAY['device_admin_allowed(uuid,uuid,uuid)', 'retire_dedicated_key(uuid,integer)',
                    'retire_dedicated_key_for_job(uuid)', 'register_personalized_media(uuid,uuid,'
                      || 'bytea,bytea,bytea,boolean,bytea,uuid,uuid)',
                    'set_debit_authority(uuid,text,uuid)', 'seal_audit(uuid,interval)',
                    -- internes de la mission 5b (lot WP07) : appelées seulement par les
                    -- fonctions SECURITY DEFINER de 0031 et 0032
                    'vendor_admin_allowed(uuid,uuid,uuid)',
                    'catalog_admin_allowed(uuid,uuid,uuid)',
                    'catalog_lock_pos(uuid,uuid,uuid,boolean)',
                    'catalog_bump_version(uuid,uuid,uuid)', 'catalog_label(text,text)',
                    -- internes de la mission 6 (lot WP05) : helpers, noyaux et fonctions de
                    -- déclencheur ; open_psp_accounts (0037) n'est appelée que par d'autres
                    -- fonctions de la base (décision du porteur du 27/10/2026, option b)
                    'cash_actor_allowed(uuid,uuid,uuid,text[])', 'cash_session_usable(uuid,uuid)',
                    'cash_session_attach_own(cash_session,text)', 'posting_cash_desk_guard()',
                    'account_purpose_guard()', 'psp_configuration_immutable()',
                    'event_psp_selection_guard()', 'psp_operator_admin(uuid,uuid)',
                    'psp_organizer_admin(uuid,uuid,uuid)', 'psp_account_code(text)',
                    'open_psp_accounts(uuid)', 'fee_rule_guard()',
                    'assert_no_legacy_psp_fee_rules()', 'psp_topup_transition_guard()',
                    'psp_event_guard()', 'psp_session_operator()', 'psp_key_prefix(text)',
                    'psp_topup_net_credited(uuid)',
                    'psp_topup_replay_row(uuid,uuid,text,bigint,text)',
                    'psp_complete_core(uuid,uuid,bigint,text,boolean,text,text)',
                    'psp_chargeback_cap()', 'psp_chargeback_guard()',
                    -- OP-N75 levée (WP08) : les deux purges vont à cashless_maint
                    'purge_device_request_nonces(integer)', 'purge_device_enrollment_attempts()',
                    -- mission hors-ligne-snapshots-lots : jamais accordées à l'API publique
                    -- (R-30.12 ; internes de 0043 à 0046 ; processus de snapshot et d'alerte)
                    'open_offline_batch_core(uuid,uuid,uuid,bigint,bytea,bytea[],bytea,bytea,text,'
                      || 'integer,boolean,uuid)',
                    'mark_seq_gap_alerted(uuid)', 'event_sync_deadline(uuid)',
                    'mark_offline_retry_alerted(uuid,bigint)',
                    'offline_seq_gaps_to_alert(interval)', 'offline_retries_to_alert(interval)',
                    'offline_policy_scope_operator(text,uuid)', 'offline_policy_actor_check(uuid,uuid)',
                    'offline_snapshot_add_entries(bigint,jsonb)',
                    'offline_snapshot_draft_locked(bigint,boolean)',
                    'offline_snapshot_source_rows(uuid,timestamptz)',
                    'offline_snapshot_item_ok(jsonb)', 'offline_snapshot_header_ok(jsonb)',
                    'offline_snapshot_envelope_ok(jsonb)', 'offline_snapshot_keys_to_wrap(integer)',
                    'wrap_offline_snapshot_key(uuid,bigint,uuid,bytea,jsonb)',
                    'rotate_snapshot_signing_key(text,bytea,text,uuid)',
                    'publish_offline_snapshot(bigint,text,bytea)',
                    'save_offline_snapshot_draft(uuid,text,jsonb,bytea,jsonb)',
                    'discard_offline_snapshot_draft(bigint,text)']) f;
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
  'finish_tag_key_job(uuid,text,text,jsonb,integer)', 'tag_key_job_refusal(uuid)',
  'rotate_snapshot_signing_key(text,bytea,text,uuid)'
]::text[]::regprocedure[]),
  'cashless_keyadmin : liste exacte (rotation de la clé de signature des snapshots, WP08)');
-- Rôles de processus de la mission hors-ligne-snapshots-lots (post-roles.sql §8e à §8g). Listes figées.
SELECT is(pg_temp.fns('cashless_snapcontent'), pg_temp.sigs(ARRAY[
  'offline_snapshot_targets()', 'offline_snapshot_source(uuid)',
  'offline_snapshot_source_delta(uuid,timestamptz)',
  'save_offline_snapshot_draft(uuid,text,jsonb,bytea,jsonb)',
  'wrap_offline_snapshot_key(uuid,bigint,uuid,bytea,jsonb)',
  'offline_snapshot_keys_to_wrap(integer)', 'purge_offline_snapshot_content(uuid)',
  'append_offline_snapshot_draft_entries(bigint,jsonb)', 'seal_offline_snapshot_draft(bigint)',
  'discard_offline_snapshot_draft(bigint,text)', 'offline_snapshot_state_hashes(uuid)',
  'offline_snapshot_entry_sha256(jsonb)', 'discard_open_offline_snapshot_drafts(uuid)'
]::text[]::regprocedure[]),
  'cashless_snapcontent : liste exacte');
SELECT is(pg_temp.fns('cashless_snapsign'), pg_temp.sigs(ARRAY[
  'offline_snapshot_drafts_ready()', 'offline_snapshot_draft_content(bigint)',
  'publish_offline_snapshot(bigint,text,bytea)', 'discard_offline_snapshot_draft(bigint,text)',
  'offline_seq_gaps_to_alert(interval)', 'mark_seq_gap_alerted(uuid)',
  'offline_retries_to_alert(interval)', 'mark_offline_retry_alerted(uuid,bigint)',
  'snapshot_public_keys(uuid)'
]::text[]::regprocedure[]),
  'cashless_snapsign : liste exacte (ADR-140)');
SELECT is(pg_temp.fns('cashless_maint'), pg_temp.sigs(ARRAY[
  'purge_device_request_nonces(integer)', 'purge_device_enrollment_attempts()'
]::text[]::regprocedure[]),
  'cashless_maint : les deux purges, rien d''autre (OP-N75)');
-- Jamais accordées à un rôle quelconque (internes DEFINER sans garde propre, gardes, fonctions de déclencheur).
SELECT is((SELECT count(*)::int FROM pg_proc p CROSS JOIN unnest(ARRAY['public', 'cashless_app',
            'cashless_platform', 'cashless_tagkeys', 'cashless_perso', 'cashless_tagcheck',
            'cashless_keyadmin', 'cashless_snapcontent', 'cashless_snapsign', 'cashless_maint']) r
           WHERE p.pronamespace = 'public'::regnamespace
             AND p.proname IN ('offline_snapshot_add_entries', 'offline_snapshot_draft_locked',
                               'offline_snapshot_source_rows', 'offline_snapshot_item_ok',
                               'offline_snapshot_header_ok', 'offline_snapshot_envelope_ok',
                               'snapshot_signing_key_cap', 'open_offline_batch_core',
                               'offline_policy_scope_operator', 'offline_policy_actor_check',
                               'offline_policy_scope_guard', 'log_offline_policy', 'log_wallet_status',
                               'close_offline_batch_retry', 'device_journal_import_guard',
                               'offline_batch_retry_guard', 'event_sync_deadline')
             AND has_function_privilege(r, p.oid, 'EXECUTE')), 0,
  'fonctions internes et de déclencheur de 0043 à 0048 : exécutables par aucun rôle (ADR-140)');
-- Toute fonction de public créée par 0043 à 0049 est nommée par une des listes ci-dessus : tests_offline_rights.sql.

-- 3. Refus à l'appel (et non seulement au catalogue) ---------------------------------------------
SET LOCAL ROLE cashless_tagcheck;
SELECT throws_ok($$SELECT claim_tag_key_job(ARRAY['REENCRYPT'])$$, '42501', NULL,
  'contrôle quotidien : ne prend aucun travail de clé');
SET LOCAL ROLE cashless_platform;
SELECT throws_ok($$SELECT open_event_ledger('00000000-0000-0000-0000-000000000000')$$,
  '42501', NULL,
  'plateforme : n''exécute plus les fonctions d''API des prestataires');
SET LOCAL ROLE cashless_app;
-- Purges : accordées à cashless_maint seul (OP-N75 levée, WP08) ; refusées à l'API publique et aux
-- processus des clés, dont celui qui consomme aussi des nonces (POST /media/auth-keys).
SELECT throws_ok($$SELECT purge_device_request_nonces(1)$$, '42501', NULL,
  'API publique : purge des nonces refusée (cashless_maint seul, OP-N75)');
SELECT throws_ok($$SELECT purge_device_enrollment_attempts()$$, '42501', NULL,
  'API publique : purge des essais d''enrôlement refusée (OP-N75)');
SELECT throws_ok($$SELECT mark_seq_gap_alerted('00000000-0000-0000-0000-000000000000')$$, '42501', NULL,
  'API publique : mark_seq_gap_alerted refusée (R-30.12)');
SELECT throws_ok($$SELECT seal_ledger('00000000-0000-0000-0000-000000000000', interval '1 hour')$$,
  '42501', NULL, 'API publique : fonction du schéma qu''elle n''appelle pas refusée (scellement)');
SET LOCAL ROLE cashless_tagkeys;
SELECT throws_ok($$SELECT purge_device_request_nonces(1)$$, '42501', NULL,
  'clés de bracelet : purge des nonces refusée (planifiée par l''API publique seule)');
RESET ROLE;

-- 4. Fonction créée à la main, hors de migrate.ts, par le propriétaire --------------------------
-- OP-N68 LEVÉE (WP08) : post-roles.sql §8a pose ALTER DEFAULT PRIVILEGES … REVOKE EXECUTE ON FUNCTIONS
-- FROM PUBLIC pour le propriétaire. Ce paragraphe ne rouvre JAMAIS le défaut (pas d'inclusion de
-- _grants_for_tests.sql) : il rejoue roles.sql puis post-roles.sql (défaut refermé après l'ouverture du
-- haut de fichier), crée la fonction, et prouve qu'elle n'est exécutable ni par PUBLIC ni par aucun rôle.
CREATE TEMP TABLE wp07_before AS
  SELECT r, pg_temp.fns(r) AS f
    FROM unnest(ARRAY['public', 'cashless_app', 'cashless_platform', 'cashless_tagkeys',
                      'cashless_perso', 'cashless_tagcheck', 'cashless_keyadmin',
                      'cashless_snapcontent', 'cashless_snapsign', 'cashless_maint']) r;
\ir ../roles.sql
\ir ../post-roles.sql
CREATE FUNCTION public.wp07_future_probe() RETURNS int LANGUAGE sql AS 'SELECT 1';
SELECT ok(NOT has_function_privilege('public', 'public.wp07_future_probe()', 'EXECUTE')
      AND NOT has_function_privilege('cashless_app', 'public.wp07_future_probe()', 'EXECUTE')
      AND NOT has_function_privilege('cashless_snapcontent', 'public.wp07_future_probe()', 'EXECUTE')
      AND NOT has_function_privilege('cashless_snapsign', 'public.wp07_future_probe()', 'EXECUTE'),
  'OP-N68 levée : fonction créée à la main par le propriétaire, exécutable ni par PUBLIC ni par un rôle');
SELECT is((SELECT count(*)::int FROM pg_default_acl d WHERE d.defaclobjtype = 'f'
             AND d.defaclnamespace = 0 AND d.defaclrole = (SELECT oid FROM pg_roles WHERE rolname = current_user)
             AND NOT EXISTS (SELECT 1 FROM aclexplode(d.defaclacl) a WHERE a.grantee = 0)), 1,
  'défaut global (sans IN SCHEMA) posé pour le propriétaire courant, PUBLIC retiré');
\ir ../roles.sql
\ir ../post-roles.sql
SELECT is((SELECT array_agg(r ORDER BY r) FROM wp07_before
             WHERE f IS DISTINCT FROM pg_temp.fns(r)), NULL::text[],
  'rejeu : liste de chaque rôle inchangée (idempotent)');

SELECT * FROM finish();
ROLLBACK;
