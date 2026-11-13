-- Droits de la base de la mission hors-ligne-snapshots-lots (lot WP08 ; FR-038 à FR-041, NFR-009 ; OP-N57, OP-N58,
-- OP-N68, OP-N69, OP-N75 ; research R-30.2, R-30.6, R-30.8, R-30.12 ; ADR-140) — pgTAP, écrit à la main. Sous chaque
-- rôle (SET ROLE) : EXECUTE accordés ET refusés, absence d'écriture directe sur chaque table nouvelle (0043 à 0048),
-- processus de snapshot, rotation de la clé de signature. Lancer : pg_prove -d <base> tests/tests_offline_rights.sql
-- (base créée par les migrations, roles.sql et post-roles.sql rejoués). Non couvert ici : la concurrence à deux
-- connexions de publish_offline_snapshot (version = max + 1), prouvée par WP21.
\set ON_ERROR_STOP 1
\set QUIET 1
BEGIN;
\ir _grants_for_tests.sql
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

CREATE FUNCTION pg_temp.id(p text) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT ('00000000-0000-0000-0000-' || lpad(p, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.a() RETURNS void LANGUAGE sql AS
  $$ SELECT set_config('app.operator_id', pg_temp.id('49a001')::text, true) $$;
CREATE FUNCTION pg_temp.b() RETURNS void LANGUAGE sql AS
  $$ SELECT set_config('app.operator_id', pg_temp.id('49a002')::text, true) $$;
CREATE FUNCTION pg_temp.nil() RETURNS void LANGUAGE sql AS
  $$ SELECT set_config('app.operator_id', '00000000-0000-0000-0000-000000000000', true) $$;
CREATE FUNCTION pg_temp.lg(p_event text) RETURNS uuid LANGUAGE sql AS
  $$ SELECT id FROM ledger WHERE scope_id = pg_temp.id(p_event) $$;
CREATE FUNCTION pg_temp.hx(p text) RETURNS text LANGUAGE sql IMMUTABLE AS
  $$ SELECT encode(sha256(convert_to(p, 'UTF8')), 'hex') $$;
CREATE FUNCTION pg_temp.hdr(p_kind text, p_gen text DEFAULT '2026-10-30T12:00:00Z') RETURNS jsonb
LANGUAGE sql AS $$
  SELECT jsonb_build_object('kind', p_kind, 'generated_at', p_gen,
         'valid_until', to_char((p_gen::timestamptz + interval '15 minutes') AT TIME ZONE 'UTC',
                                'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
         'entries', 0, 'removed', 0, 'content_sha256', pg_temp.hx('c-' || p_gen)) $$;

-- Données (propriétaire) ---------------------------------------------------------------------------------------------
INSERT INTO party (kind, legal_name) SELECT 'PLATFORM', 'Plateforme (test)'
 WHERE NOT EXISTS (SELECT 1 FROM party WHERE kind = 'PLATFORM');
INSERT INTO party (id, kind, legal_name, country_code) VALUES
 (pg_temp.id('49a001'), 'OPERATOR', 'Prestataire A', 'SN'),
 (pg_temp.id('49a002'), 'OPERATOR', 'Prestataire B', 'CI');
INSERT INTO party (id, kind, operator_id, legal_name) VALUES
 (pg_temp.id('49b001'), 'ORGANIZER', pg_temp.id('49a001'), 'Organisateur A'),
 (pg_temp.id('49b011'), 'ORGANIZER', pg_temp.id('49a002'), 'Organisateur B');
INSERT INTO jurisdiction_profile (id, country_code, version, valid_from, breakage_destination)
VALUES (pg_temp.id('49c001'), 'SN', 490049, '2026-01-01', 'ORGANIZER');
INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone, jurisdiction_id, funds_holder, status)
SELECT pg_temp.id(e), pg_temp.id(o), pg_temp.id(g), 'Événement ' || e, 'XOF', 'Africa/Dakar',
       pg_temp.id('49c001'), 'ORGANIZER', 'LIVE'
  FROM (VALUES ('49d001','49a001','49b001'), ('49d011','49a002','49b011')) AS v(e, o, g);
SELECT pg_temp.a();
SELECT open_event_ledger(pg_temp.id('49d001'));
SELECT pg_temp.b();
SELECT open_event_ledger(pg_temp.id('49d011'));
INSERT INTO device (id, operator_id, kind, app_mode, event_id, serial, agreement_public_key)
VALUES (pg_temp.id('49aa01'), pg_temp.id('49a001'), 'POS', 'CATALOG_POS', pg_temp.id('49d001'), 'R49-AA01',
        decode(repeat('04', 65), 'hex')),
       (pg_temp.id('49ab01'), pg_temp.id('49a002'), 'POS', 'CATALOG_POS', pg_temp.id('49d011'), 'R49-AB01',
        decode(repeat('04', 65), 'hex'));
INSERT INTO app_user (id, operator_id, issuer, subject, email, display_name)
VALUES (pg_temp.id('49e001'), pg_temp.id('49a001'), 'https://idp.test', 's0049e001', 'e001@test', 'Personne e001');
INSERT INTO role_assignment (user_id, role, scope_type, scope_id, granted_by)
VALUES (pg_temp.id('49e001'), 'OPERATOR_ADMIN', 'OPERATOR', pg_temp.id('49a001'), NULL);
INSERT INTO snapshot_signing_key (key_id, operator_id, owner, algorithm, public_key, kms_key_ref, status)
VALUES ('k49-a', pg_temp.id('49a001'), 'CENTRAL', 'ECDSA_P256_SHA256', '\x01', 'test:k49-a', 'ACTIVE'),
       ('k49-plat', NULL, 'CENTRAL', 'ECDSA_P256_SHA256', '\x02', 'test:k49-plat', 'RETIRED');
INSERT INTO tag_key (operator_id, key_index, kms_key_ref, status)
VALUES (pg_temp.id('49a001'), 1, 'test:hmac-49', 'ACTIVE');
INSERT INTO tag_data_key (id, operator_id, key_index, version, wrapping_kms_key_ref, encrypted_dek)
VALUES (pg_temp.id('49d0d0'), pg_temp.id('49a001'), 1, 1, 'test:wrap-49', '\x01');

-- 1. Tables nouvelles (0043 à 0048) : fermées en écriture, cloisonnées, lecture fermée pour cinq ---------------
CREATE TEMP TABLE new_tables(t text PRIMARY KEY, closed_read boolean);
INSERT INTO new_tables VALUES
 ('offline_snapshot_draft', true), ('offline_snapshot_entry', true), ('offline_snapshot_state', true),
 ('offline_snapshot_media_log', false), ('offline_snapshot_key', true), ('offline_snapshot_ack', false),
 ('device_journal_import', true), ('offline_batch_retry', false), ('offline_op_result', false),
 ('wallet_status_history', false);
-- Tables de public hors des dix de la mission (liste figée) : une table ni ici ni dans new_tables fait échouer le test.
-- Passerelle locale (WP09) : les huit tables de 0058 à 0063 y sont ajoutées ; leurs droits sont figés par
-- tests_edge_rights.sql (écriture fermée, lectures nommées).
SELECT is((SELECT coalesce(string_agg(c.relname, ' ' ORDER BY c.relname), '') FROM pg_class c
            WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')
              AND c.relname NOT IN (SELECT t FROM new_tables)
              AND c.relname <> ALL (ARRAY[
 'account', 'account_balance', 'anomaly', 'api_idempotency', 'app_user', 'approval_request', 'approval_token_use',
 'audit_log', 'audit_seal', 'cash_desk', 'cash_session', 'cash_session_count', 'cash_session_tx', 'catalog_category',
 'catalog_item', 'catalog_version', 'catalog_version_item', 'claim_attempt', 'claim_code', 'config_version', 'contract',
 'currency_exponent', 'debit_authority_handover', 'device', 'device_catalog_served', 'device_config_served',
 'device_enrollment_attempt', 'device_enrollment_code', 'device_refresh_token', 'device_request_nonce',
 'device_seq_registry', 'device_status_history', 'edge_gateway', 'edge_platform_setting', 'edge_pwd_pack',
 'edge_pwd_pack_key', 'edge_reference_change', 'edge_replication_horizon', 'edge_staff_token_audit',
 'edge_sync_batch', 'edge_sync_batch_result', 'edge_sync_registry', 'event', 'event_psp_selection',
 'event_status_history', 'event_status_transition', 'external_statement_line', 'fee_rule', 'handover_transition',
 'journal_transaction', 'jurisdiction_profile', 'kyc_verification', 'ledger', 'ledger_seal', 'media', 'media_assignment',
 'media_batch', 'media_batch_status_history', 'media_batch_transition', 'media_claim', 'media_identity_history',
 'media_status_history', 'media_tap', 'media_transition', 'merchant_participation', 'offline_batch', 'offline_policy',
 'offline_policy_history', 'offline_snapshot', 'party', 'payment_request', 'payment_request_detail', 'payout',
 'point_of_sale', 'point_of_sale_catalog_policy', 'posting', 'psp_chargeback', 'psp_configuration', 'psp_event',
 'psp_topup', 'psp_webhook_rejection', 'role_assignment', 'sale_attribution', 'sale_line', 'snapshot_signing_key',
 'tag_data_key', 'tag_key', 'tag_key_check_run', 'tag_key_job', 'vendor', 'vendor_pin_check', 'vendor_session',
 'wallet',
 -- 0080 : authentification des festivaliers (droits bornés par tests_customer_auth.sql)
 'customer_identity', 'customer_refresh_token', 'operator_public_code', 'otp_challenge',
 'otp_phone_block'])), '',
  'aucune table de public hors de la liste d''avant 0043 et des dix tables de la mission');
SELECT is((SELECT count(*)::int FROM new_tables n JOIN pg_class c ON c.relname = n.t
            AND c.relnamespace = 'public'::regnamespace), 10, 'les dix tables nouvelles existent');
SELECT is((SELECT coalesce(string_agg(n.t || ':' || p, ' ' ORDER BY n.t, p), '')
             FROM new_tables n, unnest(ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) p,
                  unnest(ARRAY['cashless_app', 'cashless_platform', 'cashless_tagkeys', 'cashless_perso',
                               'cashless_tagcheck', 'cashless_keyadmin', 'cashless_snapcontent',
                               'cashless_snapsign', 'cashless_maint']) r
            WHERE has_table_privilege(r, n.t, p)
               OR (p IN ('INSERT', 'UPDATE') AND has_any_column_privilege(r, n.t, p))), '',
  'tables nouvelles : aucun rôle cashless_* n''écrit (INSERT, UPDATE, DELETE, TRUNCATE, colonnes comprises)');
SELECT is((SELECT coalesce(string_agg(n.t, ' ' ORDER BY n.t), '') FROM new_tables n
            WHERE n.closed_read AND (has_table_privilege('cashless_app', n.t, 'SELECT')
                                     OR has_any_column_privilege('cashless_app', n.t, 'SELECT'))), '',
  'cinq tables à lecture fermée : cashless_app ne lit aucune colonne');
SELECT is((SELECT coalesce(string_agg(n.t, ' ' ORDER BY n.t), '') FROM new_tables n
            WHERE NOT n.closed_read AND NOT has_table_privilege('cashless_app', n.t, 'SELECT')), '',
  'autres tables nouvelles : lisibles par cashless_app sous la RLS');
SELECT is((SELECT coalesce(string_agg(n.t || ':' || r, ' ' ORDER BY n.t, r), '') FROM new_tables n,
                  unnest(ARRAY['cashless_snapcontent', 'cashless_snapsign', 'cashless_maint', 'cashless_keyadmin']) r
            WHERE has_any_column_privilege(r, n.t, 'SELECT') OR has_any_column_privilege(r, n.t, 'REFERENCES')), '',
  'rôles de processus : aucun droit de lecture sur les tables nouvelles (accès par fonctions)');
SELECT is((SELECT coalesce(string_agg(n.t, ' ' ORDER BY n.t), '') FROM new_tables n JOIN pg_class c
              ON c.relname = n.t AND c.relnamespace = 'public'::regnamespace
            WHERE NOT c.relrowsecurity OR NOT c.relforcerowsecurity
               OR NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'operator_id'
                                 AND NOT a.attisdropped)), '',
  'tables nouvelles : operator_id, RLS activée et FORCÉE');
SELECT is((SELECT coalesce(string_agg(t || ':' || p, ' ' ORDER BY t, p), '')
             FROM unnest(ARRAY['offline_snapshot', 'offline_policy', 'offline_policy_history', 'snapshot_signing_key'])
                  t, unnest(ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) p
            WHERE has_table_privilege('cashless_app', t, p) OR (p IN ('INSERT', 'UPDATE')
                  AND has_any_column_privilege('cashless_app', t, p))), '',
  'OP-N57, OP-N58, clés de signature : cashless_app n''écrit ni snapshot, ni politique, ni historique, ni clé');
-- Écart au plan décidé par le porteur le 30/10/2026 : cashless_app garde INSERT sur anomaly (OP-N86, ADR-136) ;
-- borne : la liste exacte des rôles ayant INSERT ne s'élargit pas.
SELECT is((SELECT array_agg(rolname::text ORDER BY rolname) FROM pg_roles
            WHERE rolname ~ '^cashless_' AND (has_table_privilege(oid, 'anomaly', 'INSERT')
                  OR has_any_column_privilege(oid, 'anomaly', 'INSERT'))),
  ARRAY['cashless_app'], 'anomaly : seul cashless_app a INSERT (borne OP-N86, écart décidé par le porteur)');
-- Borne complète d'anomaly pour cashless_app : SELECT et INSERT seuls au niveau table (pas de DELETE, TRUNCATE,
-- UPDATE de table, REFERENCES, TRIGGER) ; UPDATE limité aux deux colonnes déjà accordées (statu quo de roles.sql).
SELECT is((SELECT string_agg(p, ',' ORDER BY p) FROM unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE',
            'REFERENCES', 'TRIGGER']) p WHERE has_table_privilege('cashless_app', 'anomaly', p)),
  'INSERT,SELECT', 'anomaly : cashless_app n''a que SELECT et INSERT au niveau table (ni DELETE, TRUNCATE, UPDATE)');
SELECT is((SELECT string_agg(a.attname, ',' ORDER BY a.attname) FROM pg_attribute a
            WHERE a.attrelid = 'anomaly'::regclass AND a.attnum > 0 AND NOT a.attisdropped
              AND has_column_privilege('cashless_app', 'anomaly', a.attname, 'UPDATE')),
  'resolution_tx_id,status', 'anomaly : UPDATE de cashless_app limité à status et resolution_tx_id (borne)');
-- M4 (décision du porteur, 02/11/2026) : la clé de contenu enveloppée n'est pas lisible par l'API.
SELECT is((SELECT string_agg(a.attname, ',' ORDER BY a.attnum) FROM pg_attribute a
            WHERE a.attrelid = 'offline_snapshot'::regclass AND a.attnum > 0 AND NOT a.attisdropped
              AND NOT has_column_privilege('cashless_app', 'offline_snapshot', a.attname, 'SELECT')),
  'content_key_wrapped', 'offline_snapshot : seule content_key_wrapped est illisible par cashless_app');
SELECT ok(NOT has_any_column_privilege('cashless_keyadmin', 'snapshot_signing_key', 'INSERT')
          AND NOT has_any_column_privilege('cashless_keyadmin', 'snapshot_signing_key', 'UPDATE'),
  'cashless_keyadmin : aucune écriture directe sur snapshot_signing_key (rotation par la fonction)');
SELECT is((SELECT coalesce(string_agg(a.attname, ',' ORDER BY a.attname), '') FROM pg_attribute a
            WHERE a.attrelid = 'snapshot_signing_key'::regclass AND a.attnum > 0 AND NOT a.attisdropped
              AND has_column_privilege('cashless_keyadmin', 'snapshot_signing_key', a.attname, 'SELECT')),
  'key_id,kms_key_ref,operator_id,owner,status', 'cashless_keyadmin : colonnes lisibles de snapshot_signing_key');

-- 2. Refus par rôle : écriture directe, appels refusés ----------------------------------------------------------------
SELECT pg_temp.a();
SET LOCAL ROLE cashless_app;
SELECT throws_ok(q, '42501', NULL, 'cashless_app : ' || left(q, 70) || ' refusé')
  FROM unnest(ARRAY[
   $$INSERT INTO offline_snapshot (operator_id) VALUES (NULL)$$,
   $$UPDATE offline_snapshot SET entries = 0$$,
   $$INSERT INTO offline_policy (operator_id, scope_type, scope_id) VALUES (NULL, 'EVENT', NULL)$$,
   $$UPDATE offline_policy SET offline_enabled = true$$,
   $$DELETE FROM offline_policy$$,
   $$INSERT INTO offline_policy_history (operator_id) VALUES (NULL)$$,
   $$UPDATE offline_policy_history SET operator_id = operator_id$$,
   $$UPDATE device SET status = 'REVOKED'$$,
   $$UPDATE device SET station_name = 'x'$$,
   $$UPDATE device SET next_seq_floor = 0$$,
   $$UPDATE device SET last_snapshot_version = 99$$,
   $$UPDATE device SET last_seen_at = now()$$,
   $$INSERT INTO snapshot_signing_key (key_id) VALUES ('x')$$,
   $$UPDATE snapshot_signing_key SET status = 'ACTIVE'$$,
   $$INSERT INTO offline_snapshot_draft (operator_id) VALUES (NULL)$$,
   $$SELECT * FROM offline_snapshot_draft$$,
   $$SELECT * FROM offline_snapshot_entry$$,
   $$SELECT * FROM offline_snapshot_state$$,
   $$SELECT * FROM offline_snapshot_key$$,
   $$SELECT * FROM device_journal_import$$,
   $$INSERT INTO offline_snapshot_media_log (operator_id) VALUES (NULL)$$,
   $$INSERT INTO offline_snapshot_ack (operator_id) VALUES (NULL)$$,
   $$INSERT INTO offline_batch_retry (operator_id) VALUES (NULL)$$,
   $$UPDATE offline_batch_retry SET alerted_at = now()$$,
   $$INSERT INTO offline_op_result (operator_id) VALUES (NULL)$$,
   $$INSERT INTO wallet_status_history (operator_id) VALUES (NULL)$$,
   $$UPDATE wallet_status_history SET operator_id = operator_id$$,
   $$DELETE FROM wallet_status_history$$,
   $$TRUNCATE offline_op_result$$
  ]) q;
SELECT throws_ok(q, '42501', NULL, 'cashless_app : fonction refusée : ' || left(q, 60))
  FROM unnest(ARRAY[
   $$SELECT purge_device_request_nonces(1)$$,
   $$SELECT purge_device_enrollment_attempts()$$,
   $$SELECT mark_seq_gap_alerted(gen_random_uuid())$$,
   $$SELECT mark_offline_retry_alerted(gen_random_uuid(), 1)$$,
   $$SELECT * FROM offline_seq_gaps_to_alert(interval '1 hour')$$,
   $$SELECT * FROM offline_retries_to_alert(interval '1 hour')$$,
   $$SELECT event_sync_deadline(gen_random_uuid())$$,
   $$SELECT * FROM offline_snapshot_keys_to_wrap(10)$$,
   $$SELECT wrap_offline_snapshot_key(gen_random_uuid(), 1, gen_random_uuid(), '\x01', '{}')$$,
   $$SELECT * FROM offline_snapshot_targets()$$,
   $$SELECT * FROM offline_snapshot_source(gen_random_uuid())$$,
   $$SELECT * FROM offline_snapshot_drafts_ready()$$,
   $$SELECT * FROM publish_offline_snapshot(1, 'k', '\x01')$$,
   $$SELECT discard_offline_snapshot_draft(1, 'x')$$,
   $$SELECT rotate_snapshot_signing_key('k', '\x01', 'r', gen_random_uuid())$$,
   $$SELECT * FROM open_offline_batch_core(gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 1, '\x01',
       ARRAY['\x01'::bytea], '\x01', '\x01', 'DEVICE', 1, true, NULL)$$,
   $$SELECT offline_snapshot_add_entries(1, '[]')$$,
   $$SELECT offline_snapshot_draft_locked(1, true)$$,
   $$SELECT * FROM offline_snapshot_source_rows(gen_random_uuid(), NULL)$$,
   $$SELECT offline_snapshot_item_ok('{}')$$,
   $$SELECT offline_snapshot_header_ok('{}')$$,
   $$SELECT offline_snapshot_envelope_ok('{}')$$,
   $$SELECT offline_policy_scope_operator('EVENT', gen_random_uuid())$$,
   $$SELECT offline_policy_actor_check(gen_random_uuid(), gen_random_uuid())$$
  ]) q;
-- Accordées (appel autorisé : le refus éventuel vient du contrôle métier, jamais de 42501).
SELECT ok((SELECT has_function_privilege('cashless_app', f::regprocedure, 'EXECUTE')),
  'cashless_app exécute ' || f)
  FROM unnest(ARRAY['set_offline_policy(text,uuid,jsonb,integer,uuid)', 'clear_offline_policy(text,uuid,integer,uuid)',
   'offline_snapshot_for_device(uuid,bigint)', 'snapshot_public_keys(uuid)', 'ack_offline_snapshot(uuid,bigint,bytea)',
   'open_offline_anomaly(uuid,text,uuid,uuid,bigint,uuid,bigint,text,jsonb,uuid)',
   'device_journal_imports_processing()', 'cancel_device_journal_import(uuid,uuid,text)',
   'offline_device_exposure(uuid,uuid,bigint,timestamptz,interval)',
   'set_device_station_name(uuid,text,uuid)', 'complete_offline_batch(uuid,jsonb)']) f;
RESET ROLE;

-- OP-N58 : set_offline_policy écrit la ligne ET la trace sous cashless_app (écrivains DEFINER) --------------------
SELECT pg_temp.a();
SET LOCAL ROLE cashless_app;
SELECT lives_ok($$SELECT set_offline_policy('EVENT', pg_temp.id('49d001'),
  '{"offline_enabled": true, "max_per_sale": 5000}', NULL, pg_temp.id('49e001'))$$,
  'OP-N58 : set_offline_policy exécutée par cashless_app');
RESET ROLE;
SELECT is((SELECT count(*)::int FROM offline_policy WHERE scope_id = pg_temp.id('49d001')), 1,
  'OP-N58 : la ligne de politique est écrite');
SELECT cmp_ok((SELECT count(*)::int FROM offline_policy_history WHERE operator_id = pg_temp.id('49a001')), '>=', 1,
  'OP-N58 : la trace est écrite par log_offline_policy (DEFINER), sans INSERT de cashless_app');
SET LOCAL ROLE cashless_app;
SELECT lives_ok($$SELECT clear_offline_policy('EVENT', pg_temp.id('49d001'), 1, pg_temp.id('49e001'))$$,
  'OP-N58 : clear_offline_policy exécutée par cashless_app');
RESET ROLE;

-- OP-N69 : UPDATE device refusé en entier ; les fonctions fonctionnent --------------------------------------------
SELECT pg_temp.a();
SET LOCAL ROLE cashless_app;
SELECT lives_ok($$SELECT record_device_heartbeat(pg_temp.id('49aa01'), '1.0.0', now())$$,
  'OP-N69 : record_device_heartbeat fonctionne sous cashless_app');
SELECT lives_ok($$SELECT set_device_station_name(pg_temp.id('49aa01'), 'Caisse 49', pg_temp.id('49e001'))$$,
  'OP-N69 : set_device_station_name fonctionne sous cashless_app');
RESET ROLE;
SELECT is((SELECT station_name FROM device WHERE id = pg_temp.id('49aa01')), 'Caisse 49',
  'OP-N69 : le nom de station est posé par la fonction');

-- OP-N57 : publication par cashless_snapsign seul, version = max + 1 ---------------------------------------------------
CREATE FUNCTION pg_temp.mk(p_kind text, p_gen text) RETURNS bigint LANGUAGE sql AS $$
  SELECT save_offline_snapshot_draft(current_setting('wp08.l1')::uuid, p_kind, pg_temp.hdr(p_kind, p_gen),
                                     '\x0102'::bytea, '[]'::jsonb) $$;
SELECT pg_temp.a();
SELECT set_config('wp08.l1', pg_temp.lg('49d001')::text, true);
SET LOCAL ROLE cashless_snapcontent;
SELECT set_config('wp08.d1', pg_temp.mk('FULL', '2026-10-30T12:00:00Z')::text, true);
SELECT lives_ok($$SELECT seal_offline_snapshot_draft(current_setting('wp08.d1')::bigint)$$,
  'cashless_snapcontent : dépose et scelle un brouillon');
SELECT throws_ok($$SELECT * FROM publish_offline_snapshot(current_setting('wp08.d1')::bigint, 'k49-a', '\x3045')$$,
  '42501', NULL, 'cashless_snapcontent : publish_offline_snapshot refusée');
RESET ROLE;
SELECT pg_temp.a();
SET LOCAL ROLE cashless_snapsign;
SELECT is((SELECT count(*)::int FROM offline_snapshot_drafts_ready()), 1,
  'cashless_snapsign : voit le brouillon prêt');
SELECT is((SELECT version FROM publish_offline_snapshot(current_setting('wp08.d1')::bigint, 'k49-a', '\x3045')),
  1::bigint, 'OP-N57 : première publication = version 1 (max + 1)');
RESET ROLE;
SELECT pg_temp.a();
SET LOCAL ROLE cashless_snapcontent;
SELECT set_config('wp08.d2', pg_temp.mk('FULL', '2026-10-30T13:00:00Z')::text, true);
SELECT lives_ok($$SELECT seal_offline_snapshot_draft(current_setting('wp08.d2')::bigint)$$, 'second brouillon scellé');
RESET ROLE;
-- Version plantée en avance par le propriétaire (la base ne se fie pas au numéro réservé du brouillon).
ALTER TABLE offline_snapshot DISABLE TRIGGER offline_snapshot_check;
INSERT INTO offline_snapshot (operator_id, ledger_id, event_id, kind, version, base_version, generated_at, valid_until,
                              entries, content_sha256, authority_epoch, key_id, header, signature, content_key_wrapped)
SELECT operator_id, ledger_id, event_id, 'FULL', 2, NULL, generated_at + interval '1 minute',
       valid_until + interval '1 minute', 0, sha256('plante'), authority_epoch, key_id, header, '\x01', '\x01'
  FROM offline_snapshot WHERE version = 1 AND ledger_id = pg_temp.lg('49d001');
ALTER TABLE offline_snapshot ENABLE TRIGGER offline_snapshot_check;
SELECT pg_temp.a();
SET LOCAL ROLE cashless_snapsign;
SELECT throws_ok($$SELECT * FROM publish_offline_snapshot(current_setting('wp08.d2')::bigint, 'k49-a', '\x3045')$$,
  'CL048', NULL, 'OP-N57 : version déjà publiée (plantée en avance) refusée (CL048)');
RESET ROLE;
SELECT is((SELECT max(version) FROM offline_snapshot WHERE ledger_id = pg_temp.lg('49d001')), 2::bigint,
  'OP-N57 : rien n''est publié par le refus');

-- discard_open_offline_snapshot_drafts : le seul droit ajouté à cashless_snapcontent (porteur, 02/11).
SELECT pg_temp.a();
SET LOCAL ROLE cashless_app;
SELECT throws_ok($$SELECT discard_open_offline_snapshot_drafts(current_setting('wp08.l1')::uuid)$$, '42501', NULL,
  'cashless_app : discard_open_offline_snapshot_drafts refusée');
RESET ROLE;
SET LOCAL ROLE cashless_snapsign;
SELECT throws_ok($$SELECT discard_open_offline_snapshot_drafts(current_setting('wp08.l1')::uuid)$$, '42501', NULL,
  'cashless_snapsign : discard_open_offline_snapshot_drafts refusée');
RESET ROLE;
SELECT pg_temp.a();
SET LOCAL ROLE cashless_snapcontent;
SELECT is((SELECT discard_open_offline_snapshot_drafts(current_setting('wp08.l1')::uuid)), 1,
  'cashless_snapcontent : discard_open_offline_snapshot_drafts jette le brouillon READY resté (version non publiée)');
RESET ROLE;
SELECT is((SELECT status FROM offline_snapshot_draft WHERE id = current_setting('wp08.d2')::bigint), 'DISCARDED',
  'discard_open_offline_snapshot_drafts : brouillon jeté');
SELECT is((SELECT count(*)::int FROM offline_snapshot WHERE ledger_id = pg_temp.lg('49d001')), 2,
  'discard_open_offline_snapshot_drafts : aucune version publiée touchée');

-- ack_offline_snapshot sous cashless_app (version 1 enveloppée pour le terminal) ---------------------------------------
INSERT INTO offline_snapshot_key (ledger_id, version, device_id, agreement_key_sha256, operator_id, envelope)
VALUES (pg_temp.lg('49d001'), 1, pg_temp.id('49aa01'), sha256('k'), pg_temp.id('49a001'),
        '{"alg":"ECDH-ES+HKDF-SHA256+A256GCM","epk":"e","iv":"i","wrapped_key":"w"}'::jsonb);
SELECT pg_temp.a();
SET LOCAL ROLE cashless_app;
SELECT lives_ok(format($$SELECT ack_offline_snapshot(pg_temp.id('49aa01'), 1, %L)$$,
  (SELECT content_sha256 FROM offline_snapshot WHERE version = 1 AND ledger_id = pg_temp.lg('49d001'))),
  'OP-N69 : ack_offline_snapshot fonctionne sous cashless_app');
RESET ROLE;
SELECT is((SELECT last_snapshot_version FROM device WHERE id = pg_temp.id('49aa01')), 1::bigint,
  'OP-N69 : last_snapshot_version posé par la fonction');

-- 3. Processus de contenu : tag_data_key par colonnes nommées -------------------------------------------------------
SELECT pg_temp.a();
SET LOCAL ROLE cashless_snapcontent;
SELECT lives_ok($$SELECT id, operator_id, key_index, version, status, wrapping_kms_key_ref, encrypted_dek
                    FROM tag_data_key$$, 'cashless_snapcontent : lit les colonnes figées de tag_data_key (encrypted_dek compris)');
SELECT throws_ok($$SELECT * FROM tag_data_key$$, '42501', NULL, 'cashless_snapcontent : SELECT * sur tag_data_key refusé');
SELECT throws_ok($$SELECT created_at FROM tag_data_key$$, '42501', NULL,
  'cashless_snapcontent : colonne hors liste de tag_data_key refusée');
SELECT throws_ok($$UPDATE tag_data_key SET status = 'RETIRED'$$, '42501', NULL, 'cashless_snapcontent : aucune écriture sur tag_data_key');
SELECT throws_ok($$SELECT * FROM offline_snapshot$$, '42501', NULL, 'cashless_snapcontent : aucun droit sur offline_snapshot');
SELECT throws_ok($$INSERT INTO offline_snapshot (operator_id) VALUES (NULL)$$, '42501', NULL,
  'cashless_snapcontent : aucun INSERT dans offline_snapshot');
SELECT throws_ok($$SELECT pwd_pack_enc FROM media$$, '42501', NULL, 'cashless_snapcontent : aucun droit sur media');
SELECT lives_ok($$SELECT * FROM offline_snapshot_keys_to_wrap(10)$$,
  'cashless_snapcontent SEULE exécute offline_snapshot_keys_to_wrap');
SELECT lives_ok($$SELECT * FROM offline_snapshot_targets()$$, 'cashless_snapcontent : offline_snapshot_targets');
SELECT throws_ok(q, '42501', NULL, 'cashless_snapcontent : refusé : ' || left(q, 60))
  FROM unnest(ARRAY[
   $$SELECT * FROM offline_snapshot_for_device(gen_random_uuid(), 0)$$,
   $$SELECT * FROM snapshot_public_keys(gen_random_uuid())$$,
   $$SELECT * FROM offline_snapshot_drafts_ready()$$,
   $$SELECT * FROM offline_snapshot_draft_content(1)$$,
   $$SELECT * FROM publish_offline_snapshot(1, 'k', '\x01')$$,
   $$SELECT mark_seq_gap_alerted(gen_random_uuid())$$,
   $$SELECT set_offline_policy('EVENT', gen_random_uuid(), '{}', NULL, gen_random_uuid())$$,
   $$SELECT ack_offline_snapshot(gen_random_uuid(), 1, '\x01')$$,
   $$SELECT purge_device_request_nonces(1)$$,
   $$SELECT rotate_snapshot_signing_key('k', '\x01', 'r', gen_random_uuid())$$,
   $$SELECT offline_snapshot_add_entries(1, '[]')$$,
   $$SELECT offline_snapshot_draft_locked(1, true)$$,
   $$SELECT * FROM offline_snapshot_source_rows(gen_random_uuid(), NULL)$$,
   $$SELECT * FROM open_offline_batch_core(gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 1, '\x01',
       ARRAY['\x01'::bytea], '\x01', '\x01', 'DEVICE', 1, true, NULL)$$
  ]) q;
RESET ROLE;

-- 4. Processus de signature : ni mots de passe, ni clés de données, ni enveloppes ----------------------------------
SELECT pg_temp.a();
SET LOCAL ROLE cashless_snapsign;
SELECT throws_ok(q, '42501', NULL, 'cashless_snapsign : refusé : ' || left(q, 60))
  FROM unnest(ARRAY[
   $$SELECT * FROM tag_data_key$$, $$SELECT encrypted_dek FROM tag_data_key$$,
   $$SELECT pwd_pack_enc FROM media$$, $$SELECT * FROM media$$,
   $$SELECT * FROM offline_snapshot_key$$, $$SELECT * FROM offline_snapshot$$,
   $$SELECT * FROM snapshot_signing_key$$, $$SELECT kms_key_ref FROM snapshot_signing_key$$,
   $$SELECT * FROM offline_snapshot_entry$$, $$SELECT * FROM audit_log$$,
   $$INSERT INTO audit_log (action) VALUES ('SNAPSHOT_PUBLISHED')$$,
   $$SELECT wrap_offline_snapshot_key(gen_random_uuid(), 1, gen_random_uuid(), '\x01', '{}')$$,
   $$SELECT * FROM offline_snapshot_keys_to_wrap(10)$$,
   $$SELECT * FROM offline_snapshot_source(gen_random_uuid())$$,
   $$SELECT save_offline_snapshot_draft(gen_random_uuid(), 'FULL', '{}', '\x01', '[]')$$,
   $$SELECT seal_offline_snapshot_draft(1)$$,
   $$SELECT set_offline_policy('EVENT', gen_random_uuid(), '{}', NULL, gen_random_uuid())$$,
   $$SELECT * FROM offline_snapshot_for_device(gen_random_uuid(), 0)$$,
   $$SELECT purge_device_request_nonces(1)$$,
   $$SELECT rotate_snapshot_signing_key('k', '\x01', 'r', gen_random_uuid())$$,
   $$SELECT offline_snapshot_add_entries(1, '[]')$$,
   $$SELECT * FROM open_offline_batch_core(gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 1, '\x01',
       ARRAY['\x01'::bytea], '\x01', '\x01', 'DEVICE', 1, true, NULL)$$
  ]) q;
SELECT lives_ok($$SELECT * FROM offline_seq_gaps_to_alert(interval '1 hour')$$, 'cashless_snapsign : offline_seq_gaps_to_alert');
SELECT lives_ok($$SELECT * FROM offline_retries_to_alert(interval '1 hour')$$, 'cashless_snapsign : offline_retries_to_alert');
SELECT throws_ok($$SELECT * FROM snapshot_public_keys(gen_random_uuid())$$, 'P0002', NULL,
  'cashless_snapsign : snapshot_public_keys exécutable (décision du porteur 02/11 ; le refus vient du prestataire inconnu)');
SELECT throws_ok($$SELECT mark_seq_gap_alerted(gen_random_uuid())$$, 'P0002', NULL,
  'cashless_snapsign : mark_seq_gap_alerted exécutable (le refus vient de l''anomalie inconnue, pas du droit)');
SELECT throws_ok($$SELECT mark_offline_retry_alerted(gen_random_uuid(), 1)$$, 'P0002', NULL,
  'cashless_snapsign : mark_offline_retry_alerted exécutable (ADR-140)');
RESET ROLE;

-- 5. cashless_maint : les deux purges, rien d'autre ------------------------------------------------------------------
SELECT pg_temp.nil();
SET LOCAL ROLE cashless_maint;
SELECT lives_ok($$SELECT purge_device_request_nonces(10)$$, 'OP-N75 : cashless_maint purge les nonces');
SELECT lives_ok($$SELECT purge_device_enrollment_attempts()$$, 'OP-N75 : cashless_maint purge les essais');
SELECT throws_ok(q, '42501', NULL, 'cashless_maint : refusé : ' || left(q, 60))
  FROM unnest(ARRAY[
   $$SELECT * FROM device$$, $$SELECT * FROM tag_data_key$$, $$SELECT * FROM audit_log$$,
   $$SELECT set_offline_policy('EVENT', gen_random_uuid(), '{}', NULL, gen_random_uuid())$$,
   $$SELECT * FROM offline_snapshot_targets()$$, $$SELECT * FROM publish_offline_snapshot(1, 'k', '\x01')$$,
   $$SELECT record_device_heartbeat(gen_random_uuid(), 'x', now())$$
  ]) q;
RESET ROLE;

-- 6. cashless_keyadmin : rotation et audit de la clé de signature -----------------------------------------------------
SELECT pg_temp.nil();
SET LOCAL ROLE cashless_keyadmin;
SELECT lives_ok($$SELECT rotate_snapshot_signing_key('k49-new', decode(repeat('04', 91), 'hex'), 'test:k49-new',
  gen_random_uuid())$$, 'cashless_keyadmin exécute rotate_snapshot_signing_key');
SELECT throws_ok(q, '42501', NULL, 'cashless_keyadmin : refusé : ' || left(q, 60))
  FROM unnest(ARRAY[
   $$INSERT INTO snapshot_signing_key (key_id) VALUES ('x')$$, $$UPDATE snapshot_signing_key SET status = 'ACTIVE'$$,
   $$SELECT public_key FROM snapshot_signing_key$$, $$SELECT * FROM snapshot_signing_key$$,
   $$SELECT * FROM offline_snapshot_targets()$$, $$SELECT * FROM publish_offline_snapshot(1, 'k', '\x01')$$,
   $$SELECT * FROM tag_data_key$$
  ]) q;
SELECT lives_ok($$SELECT key_id, operator_id, owner, kms_key_ref, status FROM snapshot_signing_key$$,
  'cashless_keyadmin : lit les colonnes nécessaires à la reprise d''une rotation');
SELECT is((SELECT count(*)::int FROM snapshot_signing_key WHERE kms_key_ref = 'test:k49-new'), 1,
  'cashless_keyadmin : voit la clé qu''il vient de créer (ligne de la plateforme, operator_id NULL)');
RESET ROLE;

-- Audit : seules les sessions cashless_keyadmin écrivent SNAPSHOT_SIGNING_KEY_* ----------------------------------------
SELECT pg_temp.nil();
SET LOCAL ROLE cashless_keyadmin;
SELECT lives_ok($$INSERT INTO audit_log (operator_id, actor_id, action, object_type, object_id, origin)
  VALUES (NULL, gen_random_uuid(), 'SNAPSHOT_SIGNING_KEY_CREATED', 'snapshot_signing_key', 'test:k49-ref',
          'key-admin')$$, 'audit : cashless_keyadmin écrit SNAPSHOT_SIGNING_KEY_CREATED');
SELECT lives_ok($$INSERT INTO audit_log (operator_id, actor_id, action, object_type, object_id, origin)
  VALUES (NULL, gen_random_uuid(), 'SNAPSHOT_SIGNING_KEY_ROTATED', 'snapshot_signing_key', 'k49-new',
          'key-admin')$$, 'audit : cashless_keyadmin écrit SNAPSHOT_SIGNING_KEY_ROTATED');
SELECT is((SELECT object_id FROM audit_log WHERE action = 'SNAPSHOT_SIGNING_KEY_CREATED'
            ORDER BY id DESC LIMIT 1), 'test:k49-ref',
  'audit : cashless_keyadmin relit sa ligne SNAPSHOT_SIGNING_KEY_CREATED');
SELECT throws_ok($$INSERT INTO audit_log (operator_id, actor_id, action, object_type, object_id, origin)
  VALUES (NULL, gen_random_uuid(), 'AUTRE_ACTION', 'x', 'y', 'key-admin')$$, '42501', NULL,
  'audit : cashless_keyadmin n''écrit pas une autre action sans prestataire');
RESET ROLE;
INSERT INTO audit_log (operator_id, actor_id, action, object_type, object_id, origin)
VALUES (NULL, gen_random_uuid(), 'AUTRE_ACTION_PLATEFORME', 'x', 'y', 'test');
SELECT pg_temp.nil();
SET LOCAL ROLE cashless_keyadmin;
SELECT is((SELECT count(*)::int FROM audit_log WHERE action = 'AUTRE_ACTION_PLATEFORME'), 0,
  'audit : cashless_keyadmin ne lit pas les autres lignes de la plateforme');
RESET ROLE;
-- Les autres rôles ne forgent pas ces actions (politique RESTRICTIVE de 0049), mais écrivent leurs propres actions.
SELECT pg_temp.a();
SET LOCAL ROLE cashless_app;
SELECT throws_ok($$INSERT INTO audit_log (operator_id, actor_id, action, object_type, object_id, origin)
  VALUES (pg_temp.id('49a001'), gen_random_uuid(), 'SNAPSHOT_SIGNING_KEY_CREATED', 'snapshot_signing_key',
          'test:forgee', 'api')$$, '42501', NULL, 'audit : cashless_app ne forge pas SNAPSHOT_SIGNING_KEY_CREATED');
SELECT throws_ok($$INSERT INTO audit_log (operator_id, actor_id, action, object_type, object_id, origin)
  VALUES (pg_temp.id('49a001'), gen_random_uuid(), 'SNAPSHOT_SIGNING_KEY_ROTATED', 'snapshot_signing_key',
          'forgee', 'api')$$, '42501', NULL, 'audit : cashless_app ne forge pas SNAPSHOT_SIGNING_KEY_ROTATED');
SELECT lives_ok($$INSERT INTO audit_log (operator_id, actor_id, action, object_type, object_id, origin)
  VALUES (pg_temp.id('49a001'), gen_random_uuid(), 'OFFLINE_POLICY_SET', 'offline_policy', 'x', 'api')$$,
  'audit : cashless_app écrit toujours ses propres actions');
RESET ROLE;
SELECT pg_temp.nil();
SET LOCAL ROLE cashless_platform;
SELECT throws_ok($$INSERT INTO audit_log (operator_id, actor_id, action, object_type, object_id, origin)
  VALUES (NULL, gen_random_uuid(), 'SNAPSHOT_SIGNING_KEY_CREATED', 'snapshot_signing_key', 'forgee-p', 'p')$$,
  '42501', NULL, 'audit : cashless_platform ne forge pas SNAPSHOT_SIGNING_KEY_CREATED');
RESET ROLE;
SELECT is((SELECT count(*)::int FROM audit_log WHERE object_id IN ('test:forgee', 'forgee', 'forgee-p')), 0,
  'audit : aucune ligne forgée n''existe');
SELECT is((SELECT count(*)::int FROM pg_policies WHERE tablename = 'audit_log'
             AND policyname = 'snapshot_signing_key_audit_writer' AND permissive = 'RESTRICTIVE' AND cmd = 'INSERT'), 1,
  'audit : la politique restrictive d''écriture de 0049 est en place');

-- 6 bis. Renforcement de 0049 : offline_device_exposure ne dépend plus de journal_transaction.device_id ------------------
-- Une vente hors ligne dont journal_transaction.device_id est NULL (permis par post_transaction) doit compter dans le
-- total du terminal : le registre du terminal (device_seq_registry.device_id) suffit.
SELECT pg_temp.a();
INSERT INTO wallet (id, operator_id, ledger_id, status)
VALUES (pg_temp.id('49cb001'), pg_temp.id('49a001'), pg_temp.lg('49d001'), 'ACTIVE');
INSERT INTO account (id, operator_id, ledger_id, code, family, purpose, wallet_id, normal_side) VALUES
 (pg_temp.id('49cd001'), pg_temp.id('49a001'), pg_temp.lg('49d001'), 'K49-WAL', 'CLAIM', 'WALLET_PAID',
  pg_temp.id('49cb001'), 'C'),
 (pg_temp.id('49cd002'), pg_temp.id('49a001'), pg_temp.lg('49d001'), 'K49-MER', 'CLAIM', 'MERCHANT', NULL, 'C');
INSERT INTO media (id, operator_id, kind, token_hash, nfc_uid, wallet_id, status)
VALUES (pg_temp.id('49ca001'), pg_temp.id('49a001'), 'NFC_TAG', sha256('identité 49'), '\x04490000000001',
        pg_temp.id('49cb001'), 'ACTIVE');
INSERT INTO journal_transaction (id, operator_id, ledger_id, event_id, type, idempotency_key, request_hash,
                                 occurred_at, source, device_id, media_id)
SELECT pg_temp.id(t), pg_temp.id('49a001'), pg_temp.lg('49d001'), pg_temp.id('49d001'), 'PURCHASE', 'x49:' || t,
       'h49', '2026-06-01 12:00:00+00', 'OFFLINE_SYNC', CASE WHEN n THEN NULL ELSE pg_temp.id('49aa01') END,
       pg_temp.id('49ca001')
  FROM (VALUES ('49ff001', true), ('49ff002', false)) AS x(t, n);
INSERT INTO posting (operator_id, ledger_id, transaction_id, line_no, account_id, amount)
SELECT pg_temp.id('49a001'), pg_temp.lg('49d001'), pg_temp.id(t), l,
       CASE WHEN l = 1 THEN pg_temp.id('49cd001') ELSE pg_temp.id('49cd002') END, CASE WHEN l = 1 THEN a ELSE -a END
  FROM (VALUES ('49ff001', 700), ('49ff002', 30)) AS x(t, a), (VALUES (1), (2)) AS y(l);
INSERT INTO device_seq_registry (operator_id, device_id, seq, content_sha256, outcome, transaction_id, channel,
                                recorded_at)
VALUES (pg_temp.id('49a001'), pg_temp.id('49aa01'), 1, sha256('o49-1'), 'ACCEPTED', pg_temp.id('49ff001'), 'ONLINE',
        '2026-06-01 12:01:00+00'),
       (pg_temp.id('49a001'), pg_temp.id('49aa01'), 2, sha256('o49-2'), 'ACCEPTED', pg_temp.id('49ff002'), 'ONLINE',
        '2026-06-01 12:01:00+00');
SELECT is((SELECT per_device FROM offline_device_exposure(pg_temp.id('49aa01'), pg_temp.id('49ca001'), 10,
          '2026-06-01 12:00:00+00', interval '120 seconds')), 730::bigint,
  '0049 : la vente à journal_transaction.device_id NULL (700) compte avec celle du terminal (30)');
SELECT is((SELECT per_media FROM offline_device_exposure(pg_temp.id('49aa01'), pg_temp.id('49ca001'), 10,
          '2026-06-01 12:00:00+00', interval '120 seconds')), 730::bigint,
  '0049 : idem par bracelet (la vente à device_id NULL garde son bracelet)');
SET LOCAL ROLE cashless_app;
SELECT is((SELECT per_device FROM offline_device_exposure(pg_temp.id('49aa01'), pg_temp.id('49ca001'), 10,
          '2026-06-01 12:00:00+00', interval '120 seconds')), 730::bigint,
  '0049 : même total sous cashless_app (EXECUTE accordé)');
RESET ROLE;
SELECT is((SELECT per_device FROM offline_device_exposure(pg_temp.id('49aa01'), pg_temp.id('49ca001'), 10,
          '2026-06-01 12:10:00+00', interval '120 seconds')), 0::bigint,
  '0049 : acquittée avant le seuil, la vente à device_id NULL ne compte pas (règle d''acquittement inchangée)');
SELECT throws_ok($$SELECT * FROM offline_device_exposure(pg_temp.id('49aa01'), pg_temp.id('49ca001'), 10, NULL,
  interval '120 seconds')$$, 'CL001', NULL, '0049 : refus inchangé (heure de référence nulle)');

-- 6 ter. lock_device (0049 §3) : verrou du terminal sans UPDATE sur device (relecture de WP08, B1) ------------------
SELECT pg_temp.a();
SET LOCAL ROLE cashless_app;
SELECT is((SELECT lock_device(pg_temp.id('49aa01'), 'UPDATE')), true, 'lock_device : terminal du tenant, FOR UPDATE');
SELECT is((SELECT lock_device(pg_temp.id('49aa01'), 'NO KEY UPDATE')), true,
  'lock_device : terminal du tenant, FOR NO KEY UPDATE');
SELECT is((SELECT lock_device(pg_temp.id('49ab01'), 'UPDATE')), false,
  'lock_device : terminal d''un autre prestataire introuvable (faux)');
SELECT is((SELECT lock_device(gen_random_uuid(), 'UPDATE')), false, 'lock_device : terminal inexistant (faux)');
SELECT throws_ok($$SELECT lock_device(pg_temp.id('49aa01'), 'SHARE')$$, 'CL001', NULL,
  'lock_device : seuls UPDATE et NO KEY UPDATE sont admis');
SELECT throws_ok($$SELECT 1 FROM device WHERE id = pg_temp.id('49aa01') FOR UPDATE$$, '42501', NULL,
  'FOR UPDATE direct sur device refusé à cashless_app (aucun UPDATE accordé)');
SELECT throws_ok($$SELECT 1 FROM device WHERE id = pg_temp.id('49aa01') FOR NO KEY UPDATE$$, '42501', NULL,
  'FOR NO KEY UPDATE direct sur device refusé à cashless_app');
SELECT throws_ok($$SELECT content_key_wrapped FROM offline_snapshot$$, '42501', NULL,
  'M4 : SELECT content_key_wrapped refusé à cashless_app');
SELECT lives_ok($$SELECT id, signature, key_id, header FROM offline_snapshot$$,
  'M4 : les autres colonnes de offline_snapshot restent lisibles');
RESET ROLE;
SELECT set_config('app.operator_id', '', true);
SELECT throws_ok($$SELECT lock_device(pg_temp.id('49aa01'), 'UPDATE')$$, 'P0002', NULL,
  'lock_device : sans tenant courant, introuvable');
SELECT ok(NOT has_function_privilege('public', 'lock_device(uuid,text)', 'EXECUTE')
      AND has_function_privilege('cashless_app', 'lock_device(uuid,text)', 'EXECUTE')
      AND NOT has_function_privilege('cashless_snapcontent', 'lock_device(uuid,text)', 'EXECUTE')
      AND NOT has_function_privilege('cashless_snapsign', 'lock_device(uuid,text)', 'EXECUTE')
      AND NOT has_function_privilege('cashless_maint', 'lock_device(uuid,text)', 'EXECUTE')
      AND NOT has_function_privilege('cashless_keyadmin', 'lock_device(uuid,text)', 'EXECUTE')
      AND NOT has_function_privilege('cashless_platform', 'lock_device(uuid,text)', 'EXECUTE'),
  'lock_device : EXECUTE à cashless_app seul (ni PUBLIC, ni les autres rôles)');
SELECT ok(p.prosecdef AND EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c = 'search_path=public, pg_temp'),
  'lock_device : SECURITY DEFINER, search_path figé') FROM pg_proc p WHERE p.oid = 'lock_device(uuid,text)'::regprocedure;

-- 6 quater. event_device_sync_status_api (0051 ; WP21 partie D) : enveloppe étroite de la remontée des terminaux ----
SELECT pg_temp.a();
SET LOCAL ROLE cashless_app;
SELECT is((SELECT count(*)::int FROM event_device_sync_status_api(pg_temp.id('49d001'))), 1,
  '0051 : prestataire courant, une ligne (un terminal)');
SELECT is((SELECT device_id FROM event_device_sync_status_api(pg_temp.id('49d001'))), pg_temp.id('49aa01'),
  '0051 : le terminal de l''événement');
SELECT is((SELECT serial FROM event_device_sync_status_api(pg_temp.id('49d001'))), 'R49-AA01',
  '0051 : numéro de série du terminal');
SELECT is((SELECT caught_up FROM event_device_sync_status_api(pg_temp.id('49d001'))), false,
  '0051 : événement pas en CLOSING, terminal pas à jour');
SELECT is((SELECT reason FROM event_device_sync_status_api(pg_temp.id('49d001'))), 'NOT_SEEN_SINCE_CLOSING',
  '0051 : raison rendue');
SELECT throws_ok($$SELECT * FROM event_device_sync_status_api(pg_temp.id('49d011'))$$, 'P0002', NULL,
  '0051 : événement d''un autre prestataire, introuvable');
SELECT throws_ok($$SELECT * FROM event_device_sync_status_api(gen_random_uuid())$$, 'P0002', NULL,
  '0051 : événement inexistant, même erreur');
SELECT throws_ok($$SELECT * FROM event_device_sync_status(pg_temp.id('49d001'))$$, '42501', NULL,
  '0051 : event_device_sync_status reste refusée à cashless_app');
SELECT throws_ok($$SELECT event_sync_deadline(pg_temp.id('49d001'))$$, '42501', NULL,
  '0051 : event_sync_deadline reste refusée à cashless_app');
RESET ROLE;
SELECT pg_temp.b();
SELECT throws_ok($$SELECT * FROM event_device_sync_status_api(pg_temp.id('49d001'))$$, 'P0002', NULL,
  '0051 : le prestataire B ne lit pas l''événement de A');
SELECT set_config('app.operator_id', '', true);
SELECT throws_ok($$SELECT * FROM event_device_sync_status_api(pg_temp.id('49d001'))$$, 'P0002', NULL,
  '0051 : sans prestataire de session, introuvable');
SELECT is((SELECT array_agg(a ORDER BY o) FROM (SELECT unnest(proargnames) a, generate_series(1, 6) o
            FROM pg_proc WHERE oid = 'event_device_sync_status_api(uuid)'::regprocedure) x),
  ARRAY['p_event', 'sync_deadline', 'device_id', 'serial', 'caught_up', 'reason'],
  '0051 : seules colonnes rendues, celles du contrat');
SELECT ok(NOT has_function_privilege('public', 'event_device_sync_status_api(uuid)', 'EXECUTE')
      AND has_function_privilege('cashless_app', 'event_device_sync_status_api(uuid)', 'EXECUTE')
      AND NOT has_function_privilege('cashless_snapcontent', 'event_device_sync_status_api(uuid)', 'EXECUTE')
      AND NOT has_function_privilege('cashless_snapsign', 'event_device_sync_status_api(uuid)', 'EXECUTE')
      AND NOT has_function_privilege('cashless_maint', 'event_device_sync_status_api(uuid)', 'EXECUTE')
      AND NOT has_function_privilege('cashless_keyadmin', 'event_device_sync_status_api(uuid)', 'EXECUTE')
      AND NOT has_function_privilege('cashless_platform', 'event_device_sync_status_api(uuid)', 'EXECUTE')
      AND NOT has_function_privilege('cashless_app', 'event_device_sync_status(uuid)', 'EXECUTE')
      AND NOT has_function_privilege('cashless_app', 'event_sync_deadline(uuid)', 'EXECUTE'),
  '0051 : EXECUTE à cashless_app sur la seule enveloppe (ni PUBLIC, ni autres rôles, fonctions sous-jacentes fermées)');
SELECT ok(p.prosecdef AND p.provolatile = 's'
          AND EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c = 'search_path=public, pg_temp'),
  '0051 : SECURITY DEFINER, STABLE, search_path figé') FROM pg_proc p
 WHERE p.oid = 'event_device_sync_status_api(uuid)'::regprocedure;

-- 7. OP-N68 : une fonction créée par le propriétaire après post-roles.sql n'est exécutable de personne ------------------
-- Cette suite inclut _grants_for_tests.sql (pgtap) : le défaut est refermé par le rejeu de post-roles.sql.
SET LOCAL client_min_messages = warning;
\ir ../roles.sql
\ir ../post-roles.sql
CREATE FUNCTION public.wp08_future_probe() RETURNS int LANGUAGE sql AS 'SELECT 1';
SELECT ok(NOT has_function_privilege('public', 'public.wp08_future_probe()', 'EXECUTE')
      AND NOT has_function_privilege('cashless_app', 'public.wp08_future_probe()', 'EXECUTE')
      AND NOT has_function_privilege('cashless_snapcontent', 'public.wp08_future_probe()', 'EXECUTE')
      AND NOT has_function_privilege('cashless_snapsign', 'public.wp08_future_probe()', 'EXECUTE')
      AND NOT has_function_privilege('cashless_maint', 'public.wp08_future_probe()', 'EXECUTE')
      AND NOT has_function_privilege('cashless_keyadmin', 'public.wp08_future_probe()', 'EXECUTE'),
  'OP-N68 : fonction créée à la main par le propriétaire non exécutable (PUBLIC ni rôle)');

SELECT * FROM finish();
ROLLBACK;
