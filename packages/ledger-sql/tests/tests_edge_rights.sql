-- Droits de la base de la passerelle locale (mission passerelle-locale, lot WP09 ; FR-031, NFR-011, C-010 ;
-- post-roles.sql §9 ; migrations 0058 à 0064) — pgTAP, écrit à la main, gabarit de tests_offline_rights.sql.
-- Lancer depuis packages/ledger-sql : pg_prove -d <base> tests/tests_edge_rights.sql (base créée par les migrations,
-- roles.sql et post-roles.sql rejoués). Sous chaque rôle (SET ROLE) : appels refusés (42501), écritures directes
-- refusées, lectures fermées ; isolation entre prestataires des fonctions d'administration et du journal de
-- référence. Les listes EXACTES d'EXECUTE par rôle sont figées par tests_execute_grants.sql.
-- COMMENT CHAQUE ASSERTION ECHOUE SI LE DROIT REVIENT : les contrôles « catalogue » comparent à une liste vide ; la
-- section 5 le PROUVE en accordant un droit de contrôle (GRANT dans la transaction, annulé par le ROLLBACK) et en
-- vérifiant que la mesure le voit. Non couvert ici : la connexion réelle (SET ROLE ne change pas session_user), prouvée
-- par apps/api/test/integration/edge/edge-sync-guard.spec.ts.
\set ON_ERROR_STOP 1
\set QUIET 1
BEGIN;
\ir _grants_for_tests.sql
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();
SET CONSTRAINTS ALL IMMEDIATE;

CREATE FUNCTION pg_temp.id(p text) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT ('00000000-0000-0000-0000-' || lpad(p, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.a() RETURNS void LANGUAGE sql AS
  $$ SELECT set_config('app.operator_id', pg_temp.id('64a001')::text, true) $$;
CREATE FUNCTION pg_temp.b() RETURNS void LANGUAGE sql AS
  $$ SELECT set_config('app.operator_id', pg_temp.id('64a002')::text, true) $$;
-- SQLSTATE d'une instruction exécutée sous le rôle courant ('OK' si elle passe).
CREATE FUNCTION pg_temp.st(q text) RETURNS text LANGUAGE plpgsql AS
  $$ BEGIN EXECUTE q; RETURN 'OK'; EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE; END $$;

-- Données (propriétaire) --------------------------------------------------------------------------------------------
INSERT INTO party (kind, legal_name) SELECT 'PLATFORM', 'Plateforme (test)'
 WHERE NOT EXISTS (SELECT 1 FROM party WHERE kind = 'PLATFORM');
INSERT INTO party (id, kind, legal_name, country_code) VALUES
 (pg_temp.id('64a001'), 'OPERATOR', 'Prestataire A', 'SN'),
 (pg_temp.id('64a002'), 'OPERATOR', 'Prestataire B', 'CI');
INSERT INTO party (id, kind, operator_id, legal_name) VALUES
 (pg_temp.id('64b001'), 'ORGANIZER', pg_temp.id('64a001'), 'Organisateur A'),
 (pg_temp.id('64b011'), 'ORGANIZER', pg_temp.id('64a002'), 'Organisateur B');
INSERT INTO jurisdiction_profile (id, country_code, version, valid_from, breakage_destination)
VALUES (pg_temp.id('64c001'), 'SN', 640064, '2026-01-01', 'ORGANIZER');
INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone, jurisdiction_id, funds_holder, status)
SELECT pg_temp.id(e), pg_temp.id(o), pg_temp.id(g), 'Événement ' || e, 'XOF', 'Africa/Dakar',
       pg_temp.id('64c001'), 'ORGANIZER', 'LIVE'
  FROM (VALUES ('64d001','64a001','64b001'), ('64d011','64a002','64b011')) AS v(e, o, g);
SELECT pg_temp.a();
SELECT open_event_ledger(pg_temp.id('64d001'));
SELECT pg_temp.b();
SELECT open_event_ledger(pg_temp.id('64d011'));
-- A : une passerelle PRIMARY (e001) et une STANDBY (e002) de l'événement d001 ; B : une PRIMARY (e011).
INSERT INTO edge_gateway (id, operator_id, event_id, serial, role) VALUES
 (pg_temp.id('64e001'), pg_temp.id('64a001'), pg_temp.id('64d001'), 'GWA1', 'PRIMARY'),
 (pg_temp.id('64e002'), pg_temp.id('64a001'), pg_temp.id('64d001'), 'GWA2', 'STANDBY'),
 (pg_temp.id('64e011'), pg_temp.id('64a002'), pg_temp.id('64d011'), 'GWB1', 'PRIMARY');
INSERT INTO device (id, operator_id, kind, app_mode, event_id, serial)
VALUES (pg_temp.id('64aa01'), pg_temp.id('64a001'), 'POS', 'CATALOG_POS', pg_temp.id('64d001'), 'R64-AA01'),
       (pg_temp.id('64aa11'), pg_temp.id('64a002'), 'POS', 'CATALOG_POS', pg_temp.id('64d011'), 'R64-BB01');

-- 1. Catalogue : aucune écriture, lectures nommées -------------------------------------------------------------------
-- Objets de la passerelle (tables de 0058 à 0063, vue de 0063).
CREATE TEMP TABLE edge_objs(t text PRIMARY KEY, app_read boolean);
INSERT INTO edge_objs VALUES
 ('edge_gateway', true), ('edge_sync_registry', true), ('edge_sync_batch', true), ('edge_sync_batch_result', true),
 ('edge_pwd_pack', false), ('edge_pwd_pack_key', false), ('edge_reference_change', false),
 ('edge_staff_token_audit', false), ('edge_platform_setting', false), ('edge_replication_horizon', false),
 ('edge_device_seq_acked', false);
CREATE TEMP TABLE all_roles(r text PRIMARY KEY);
INSERT INTO all_roles VALUES ('cashless_app'), ('cashless_platform'), ('cashless_tagkeys'), ('cashless_perso'),
 ('cashless_tagcheck'), ('cashless_keyadmin'), ('cashless_snapcontent'), ('cashless_snapsign'), ('cashless_maint'),
 ('cashless_edge'), ('cashless_edgeadmin');
SELECT is((SELECT count(*)::int FROM edge_objs o JOIN pg_class c ON c.relname = o.t
            AND c.relnamespace = 'public'::regnamespace), 11, 'les dix tables et la vue de la passerelle existent');
-- Liste figée des objets « edge_* » de public : une table ou une vue ajoutée sans être nommée ici échoue.
SELECT is((SELECT coalesce(string_agg(c.relname, ' ' ORDER BY c.relname), '') FROM pg_class c
            WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
              AND c.relname LIKE 'edge\_%' AND c.relname NOT IN (SELECT t FROM edge_objs)), '',
  'aucun objet edge_* de public hors de la liste figée (une table nouvelle doit être nommée ici)');
-- Aucune écriture, aucun droit de structure, pour aucun rôle cashless_*, colonnes comprises.
CREATE FUNCTION pg_temp.write_viol() RETURNS text LANGUAGE sql AS $$
  SELECT coalesce(string_agg(o.t || ':' || r.r || ':' || p, ' ' ORDER BY o.t, r.r, p), '')
    FROM edge_objs o, all_roles r, unnest(ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p
   WHERE has_table_privilege(r.r, 'public.' || o.t, p)
      OR (p IN ('INSERT', 'UPDATE', 'REFERENCES') AND has_any_column_privilege(r.r, 'public.' || o.t, p)) $$;
SELECT is(pg_temp.write_viol(), '',
  'passerelle : aucun rôle cashless_* n''écrit (INSERT, UPDATE, DELETE, TRUNCATE, colonnes comprises) ni ne modifie la structure');
-- Lecture : cashless_app lit exactement les quatre tables sous RLS ; aucun autre rôle ne lit rien, sauf cashless_edge
-- qui lit la vue étroite des numéros de terminal (0063, FR-026).
CREATE FUNCTION pg_temp.read_viol() RETURNS text LANGUAGE sql AS $$
  SELECT coalesce(string_agg(o.t || ':' || r.r, ' ' ORDER BY o.t, r.r), '')
    FROM edge_objs o, all_roles r
   WHERE (has_table_privilege(r.r, 'public.' || o.t, 'SELECT') OR has_any_column_privilege(r.r, 'public.' || o.t, 'SELECT'))
     AND NOT (r.r = 'cashless_app' AND o.app_read)
     AND NOT (r.r = 'cashless_edge' AND o.t = 'edge_device_seq_acked') $$;
SELECT is(pg_temp.read_viol(), '',
  'passerelle : lectures fermées sauf cashless_app sur quatre tables (RLS) et cashless_edge sur la vue des terminaux');
SELECT is((SELECT coalesce(string_agg(o.t, ' ' ORDER BY o.t), '') FROM edge_objs o
            WHERE o.app_read AND NOT has_table_privilege('cashless_app', 'public.' || o.t, 'SELECT')), '',
  'cashless_app lit edge_gateway, edge_sync_registry, edge_sync_batch, edge_sync_batch_result (sous RLS)');
SELECT is((SELECT coalesce(string_agg(o.t, ' ' ORDER BY o.t), '') FROM edge_objs o
            WHERE NOT o.app_read AND (has_any_column_privilege('cashless_app', 'public.' || o.t, 'SELECT'))), '',
  'cashless_app ne lit ni les colis, ni la clé de colis, ni le journal de référence, ni les réglages, ni l''horizon, '
  || 'ni l''audit des jetons, ni la vue des terminaux');
SELECT ok(has_table_privilege('cashless_edge', 'public.edge_device_seq_acked', 'SELECT'),
  'cashless_edge : SELECT sur la vue étroite des numéros de terminal (en-tête de 0063)');
-- cashless_edge et cashless_edgeadmin : aucun droit sur AUCUNE relation de public (tables, vues, séquences), sauf la vue.
SELECT is((SELECT coalesce(string_agg(r.r || ':' || c.relname, ' ' ORDER BY r.r, c.relname), '')
             FROM pg_class c, (VALUES ('cashless_edge'), ('cashless_edgeadmin')) r(r)
            WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
              AND NOT (r.r = 'cashless_edge' AND c.relname = 'edge_device_seq_acked')
              AND NOT EXISTS (SELECT 1 FROM pg_depend e WHERE e.classid = 'pg_class'::regclass
                                 AND e.objid = c.oid AND e.deptype = 'e')
              AND c.relname NOT IN ('pg_all_foreign_keys', 'tap_funky')
              AND (has_any_column_privilege(r.r, c.oid, 'SELECT') OR has_any_column_privilege(r.r, c.oid, 'INSERT')
                   OR has_any_column_privilege(r.r, c.oid, 'UPDATE') OR has_table_privilege(r.r, c.oid, 'DELETE')
                   OR has_table_privilege(r.r, c.oid, 'TRUNCATE') OR has_table_privilege(r.r, c.oid, 'REFERENCES')
                   OR has_table_privilege(r.r, c.oid, 'TRIGGER')
                   OR (c.relkind = 'S' AND has_sequence_privilege(r.r, c.oid, 'USAGE, SELECT, UPDATE')))), '',
  'cashless_edge et cashless_edgeadmin : aucun droit sur aucune table, vue ou séquence de public (hors la vue des terminaux)');
-- Attributs et délais des deux rôles.
SELECT is((SELECT string_agg(rolname || ':' || rolsuper::text || rolcreatedb::text || rolcreaterole::text
                             || rolbypassrls::text || rolinherit::text || rolcanlogin::text, ' ' ORDER BY rolname)
             FROM pg_roles WHERE rolname IN ('cashless_edge', 'cashless_edgeadmin')),
  'cashless_edge:falsefalsefalsefalsefalsetrue cashless_edgeadmin:falsefalsefalsefalsefalsetrue',
  'cashless_edge et cashless_edgeadmin : LOGIN, sans superutilisateur, sans BYPASSRLS, NOINHERIT');
SELECT is((SELECT count(*)::int FROM pg_db_role_setting s JOIN pg_roles r ON r.oid = s.setrole
            WHERE r.rolname IN ('cashless_edge', 'cashless_edgeadmin')
              AND s.setconfig @> ARRAY['statement_timeout=30s', 'idle_in_transaction_session_timeout=10s',
                                       'lock_timeout=5s']), 2,
  'délais de session des deux rôles identiques à cashless_app (30 s, 10 s, 5 s)');
SELECT ok(NOT has_database_privilege('cashless_edge', current_database(), 'TEMPORARY')
          AND NOT has_database_privilege('cashless_edgeadmin', current_database(), 'TEMPORARY'),
  'cashless_edge et cashless_edgeadmin : aucun TEMPORARY');
SELECT is((SELECT count(*)::int FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.member
            WHERE r.rolname IN ('cashless_edge', 'cashless_edgeadmin')), 0,
  'cashless_edge et cashless_edgeadmin : membres d''aucun rôle (rien à hériter)');

-- 2. Refus par rôle, à l'appel (42501) ----------------------------------------------------------------------------------
SELECT pg_temp.a();
SET LOCAL ROLE cashless_app;
-- Écritures directes sur la passerelle : refusées. Contrôles positifs : lecture sous RLS passante.
SELECT is(pg_temp.st(q), '42501', 'cashless_app : ' || left(q, 80) || ' refusé')
  FROM unnest(ARRAY[
   $$UPDATE edge_gateway SET status = 'ACTIVE' WHERE status = 'REVOKED'$$,
   $$UPDATE edge_gateway SET contiguous_edge_seq = 0$$,
   $$UPDATE edge_gateway SET role = 'PRIMARY'$$,
   $$UPDATE edge_gateway SET cert_sha256 = NULL$$,
   $$INSERT INTO edge_gateway (operator_id) VALUES (NULL)$$,
   $$DELETE FROM edge_gateway$$,
   $$TRUNCATE edge_gateway$$,
   $$INSERT INTO edge_sync_registry (gateway_id) VALUES (NULL)$$,
   $$UPDATE edge_sync_registry SET outcome = 'ACCEPTED'$$,
   $$INSERT INTO edge_sync_batch (operator_id) VALUES (NULL)$$,
   $$UPDATE edge_sync_batch SET status = 'DONE'$$,
   $$DELETE FROM edge_sync_batch$$,
   $$INSERT INTO edge_sync_batch_result (operator_id) VALUES (NULL)$$,
   $$UPDATE edge_sync_batch_result SET outcome = 'ACCEPTED'$$,
   $$INSERT INTO edge_pwd_pack (operator_id) VALUES (NULL)$$,
   $$UPDATE edge_pwd_pack SET operator_id = operator_id$$,
   $$SELECT * FROM edge_pwd_pack$$,
   $$INSERT INTO edge_pwd_pack_key (operator_id) VALUES (NULL)$$,
   $$SELECT * FROM edge_pwd_pack_key$$,
   $$INSERT INTO edge_reference_change (operator_id) VALUES (NULL)$$,
   $$UPDATE edge_reference_change SET entity_kind = 'EVENT'$$,
   $$SELECT * FROM edge_reference_change$$,
   $$INSERT INTO edge_staff_token_audit (operator_id) VALUES (NULL)$$,
   $$SELECT * FROM edge_staff_token_audit$$,
   $$INSERT INTO edge_platform_setting (key, value, updated_by_label) VALUES ('replay_max_per_sale', 1, 'x')$$,
   $$UPDATE edge_platform_setting SET value = 1$$,
   $$SELECT * FROM edge_platform_setting$$,
   $$INSERT INTO edge_replication_horizon (ledger_id) VALUES (NULL)$$,
   $$SELECT * FROM edge_replication_horizon$$,
   $$SELECT * FROM edge_device_seq_acked$$
  ]) q;
SELECT is(pg_temp.st(q), '42501', 'cashless_app : fonction refusée : ' || left(q, 70))
  FROM unnest(ARRAY[
   $$SELECT grant_edge_authority(gen_random_uuid(), gen_random_uuid(), gen_random_uuid())$$,
   $$SELECT set_debit_authority(gen_random_uuid(), 'EDGE', gen_random_uuid())$$,
   $$SELECT force_central_authority(gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'x')$$,
   $$SELECT record_edge_seq(gen_random_uuid(), 1, 'k', '\x00', 'ACCEPTED', NULL, NULL)$$,
   $$SELECT ack_edge_handover(gen_random_uuid(), 1, 0)$$,
   $$SELECT complete_edge_release(gen_random_uuid(), 1, 0, '\x00')$$,
   $$SELECT edge_record_seq(gen_random_uuid(), 1, 'k', '\x00', 'ACCEPTED', NULL, NULL)$$,
   $$SELECT edge_ack_handover(gen_random_uuid(), gen_random_uuid(), 1, 0)$$,
   $$SELECT edge_complete_release(gen_random_uuid(), gen_random_uuid(), 1, 0, '\x00', 0)$$,
   $$SELECT edge_post_transaction(gen_random_uuid(), 1, 1, 'k', '\x00', '{}', NULL)$$,
   $$SELECT edge_replication_page(gen_random_uuid(), 0, 0, 10)$$,
   $$SELECT edge_sync_cursor(gen_random_uuid())$$,
   $$SELECT edge_sync_device_key(gen_random_uuid(), 's')$$,
   $$SELECT edge_sync_results(gen_random_uuid(), gen_random_uuid())$$,
   $$SELECT edge_fee_config(gen_random_uuid(), 's', now())$$,
   $$SELECT edge_sync_audit(gen_random_uuid(), 'EDGE_CHAIN_BROKEN', gen_random_uuid(), '{}')$$,
   $$SELECT edge_tap_proof(gen_random_uuid(), '\x00', '\x00', '\x00')$$,
   $$SELECT set_edge_setting('replay_max_per_sale', 1, 'x')$$,
   $$SELECT edge_setting_value('replay_max_per_sale', 'XOF')$$,
   $$SELECT register_edge_gateway(gen_random_uuid(), gen_random_uuid(), 's', 'PRIMARY', '\x00', '\x00', NULL, NULL, 'x')$$,
   $$SELECT set_edge_gateway_role(gen_random_uuid(), 'PRIMARY', 'x')$$,
   $$SELECT deposit_edge_pwd_pack(gen_random_uuid(), gen_random_uuid(), '\x00', '\x00', 1)$$,
   $$SELECT mark_edge_gateways_silent(interval '1 hour')$$
  ]) q;
-- Contrôles positifs : la lecture sous RLS passe ; les enveloppes humaines passent le contrôle de droit (autre erreur).
SELECT is(pg_temp.st('SELECT count(*) FROM edge_gateway'), 'OK', 'cashless_app : lit edge_gateway sous RLS');
SELECT is(pg_temp.st('SELECT count(*) FROM edge_sync_batch'), 'OK', 'cashless_app : lit edge_sync_batch sous RLS');
SELECT isnt(pg_temp.st($$SELECT edge_grant_authority(gen_random_uuid(), gen_random_uuid(), gen_random_uuid())$$), '42501',
  'cashless_app : edge_grant_authority (enveloppe humaine) exécutable');
SELECT isnt(pg_temp.st($$SELECT request_edge_release(gen_random_uuid(), gen_random_uuid())$$), '42501',
  'cashless_app : request_edge_release exécutable (kit, assert_tenant)');
SELECT isnt(pg_temp.st($$SELECT fail_edge_grant(gen_random_uuid(), gen_random_uuid(), 'x')$$), '42501',
  'cashless_app : fail_edge_grant exécutable (kit, assert_tenant)');
SELECT isnt(pg_temp.st($$SELECT edge_expose_device_token_families(gen_random_uuid())$$), '42501',
  'cashless_app : edge_expose_device_token_families exécutable (décision 23)');

SELECT pg_temp.a();
SET LOCAL ROLE cashless_edge;
SELECT is(pg_temp.st(q), '42501', 'cashless_edge : ' || left(q, 80) || ' refusé')
  FROM unnest(ARRAY[
   $$SELECT * FROM ledger$$, $$SELECT * FROM posting$$, $$SELECT * FROM journal_transaction$$,
   $$SELECT * FROM media$$, $$SELECT * FROM wallet$$, $$SELECT * FROM device$$, $$SELECT * FROM edge_gateway$$,
   $$SELECT * FROM edge_sync_registry$$, $$SELECT * FROM edge_sync_batch$$, $$SELECT * FROM edge_sync_batch_result$$,
   $$SELECT * FROM edge_pwd_pack$$, $$SELECT * FROM edge_pwd_pack_key$$, $$SELECT * FROM edge_reference_change$$,
   $$SELECT * FROM edge_staff_token_audit$$, $$SELECT * FROM edge_platform_setting$$,
   $$SELECT * FROM edge_replication_horizon$$, $$SELECT * FROM debit_authority_handover$$,
   $$UPDATE edge_gateway SET status = 'ACTIVE'$$, $$INSERT INTO edge_sync_batch (operator_id) VALUES (NULL)$$,
   $$SELECT edge_log_release_stuck(gen_random_uuid())$$, $$SELECT edge_replication_terms(gen_random_uuid())$$,
   $$DELETE FROM edge_sync_registry$$, $$TRUNCATE edge_reference_change$$,
   $$SELECT post_transaction(gen_random_uuid(), 'TOPUP', 'k', now(), 'EDGE_SYNC', '[]')$$,
   $$SELECT set_debit_authority(gen_random_uuid(), 'EDGE', gen_random_uuid())$$,
   $$SELECT grant_edge_authority(gen_random_uuid(), gen_random_uuid(), gen_random_uuid())$$,
   $$SELECT force_central_authority(gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'x')$$,
   $$SELECT record_edge_seq(gen_random_uuid(), 1, 'k', '\x00', 'ACCEPTED', NULL, NULL)$$,
   $$SELECT ack_edge_handover(gen_random_uuid(), 1, 0)$$,
   $$SELECT complete_edge_release(gen_random_uuid(), 1, 0, '\x00')$$,
   $$SELECT edge_grant_authority(gen_random_uuid(), gen_random_uuid(), gen_random_uuid())$$,
   $$SELECT fail_edge_release(gen_random_uuid(), gen_random_uuid())$$,
   $$SELECT request_edge_release(gen_random_uuid(), gen_random_uuid())$$,
   $$SELECT force_central_authority_approved(gen_random_uuid(), gen_random_uuid(), 'x')$$,
   $$SELECT edge_stuck_handovers(interval '1 hour')$$, $$SELECT mark_edge_gateways_silent(interval '1 hour')$$,
   $$SELECT register_edge_gateway(gen_random_uuid(), gen_random_uuid(), 's', 'PRIMARY', '\x00', '\x00', NULL, NULL, 'x')$$,
   $$SELECT set_edge_gateway_role(gen_random_uuid(), 'PRIMARY', 'x')$$,
   $$SELECT set_edge_setting('replay_max_per_sale', 1, 'x')$$,
   $$SELECT edge_setting_value('replay_max_per_sale', 'XOF')$$,
   $$SELECT deposit_edge_pwd_pack(gen_random_uuid(), gen_random_uuid(), '\x00', '\x00', 1)$$,
   $$SELECT edge_counter_op('TOPUP_CASH', gen_random_uuid(), 1, 1, 'k', '\x00', '{}')$$,
   $$SELECT edge_ref_emit_many(gen_random_uuid(), 'EVENT', ARRAY[]::uuid[])$$,
   $$SELECT edge_expose_device_token_families(gen_random_uuid())$$
  ]) q;
-- Contrôles positifs : la vue étroite se lit (aucune autre relation) ; les fonctions de la passerelle passent le droit.
SELECT set_config('app.gateway_id', pg_temp.id('64e001')::text, true);
SELECT is((SELECT count(*)::int FROM edge_device_seq_acked), 1,
  'cashless_edge : la vue des terminaux ne montre que les terminaux de l''événement de la passerelle appelante');
SELECT isnt(pg_temp.st($$SELECT * FROM identify_edge_gateway('\x00')$$), '42501',
  'cashless_edge : identify_edge_gateway exécutable');
SELECT isnt(pg_temp.st($$SELECT edge_post_transaction(pg_temp.id('64e001'), 1, 1, 'k', '\x00', '{}', NULL)$$), '42501',
  'cashless_edge : edge_post_transaction exécutable (refus pour une autre raison que le droit)');

RESET ROLE;
SELECT pg_temp.a();
SET LOCAL ROLE cashless_edgeadmin;
SELECT is(pg_temp.st(q), '42501', 'cashless_edgeadmin : ' || left(q, 80) || ' refusé')
  FROM unnest(ARRAY[
   $$SELECT set_edge_gateway_role(gen_random_uuid(), 'PRIMARY', 'x')$$,
   $$SELECT * FROM identify_edge_gateway('\x00')$$, $$SELECT touch_edge_gateway(gen_random_uuid())$$,
   $$SELECT edge_post_transaction(gen_random_uuid(), 1, 1, 'k', '\x00', '{}', NULL)$$,
   $$SELECT post_transaction(gen_random_uuid(), 'TOPUP', 'k', now(), 'EDGE_SYNC', '[]')$$,
   $$SELECT set_debit_authority(gen_random_uuid(), 'EDGE', gen_random_uuid())$$,
   $$SELECT grant_edge_authority(gen_random_uuid(), gen_random_uuid(), gen_random_uuid())$$,
   $$SELECT edge_grant_authority(gen_random_uuid(), gen_random_uuid(), gen_random_uuid())$$,
   $$SELECT edge_record_seq(gen_random_uuid(), 1, 'k', '\x00', 'ACCEPTED', NULL, NULL)$$,
   $$SELECT edge_replication_page(gen_random_uuid(), 0, 0, 10)$$,
   $$SELECT edge_expose_device_token_families(gen_random_uuid())$$,
   $$SELECT edge_log_release_stuck(gen_random_uuid())$$, $$SELECT edge_replication_terms(gen_random_uuid())$$,
   $$SELECT * FROM edge_gateway$$, $$SELECT * FROM edge_platform_setting$$, $$SELECT * FROM edge_device_seq_acked$$,
   $$UPDATE edge_gateway SET role = 'PRIMARY'$$, $$INSERT INTO edge_platform_setting (key, value, updated_by_label)
     VALUES ('replay_max_per_sale', 1, 'x')$$
  ]) q;
SELECT is(pg_temp.st($$SELECT set_edge_setting('replay_max_per_sale', 50000, 'WP09 test')$$), 'OK',
  'cashless_edgeadmin : set_edge_setting passe (seule voie d''écriture des réglages)');
SELECT isnt(pg_temp.st($$SELECT revoke_edge_gateway(gen_random_uuid(), 'x', 'x')$$), '42501',
  'cashless_edgeadmin : revoke_edge_gateway exécutable');

RESET ROLE;
SELECT pg_temp.a();
SET LOCAL ROLE cashless_tagkeys;
SELECT is(pg_temp.st(q), '42501', 'cashless_tagkeys : ' || left(q, 80) || ' refusé')
  FROM unnest(ARRAY[
   $$SELECT * FROM edge_gateway$$, $$SELECT * FROM edge_pwd_pack$$, $$SELECT * FROM edge_pwd_pack_key$$,
   $$INSERT INTO edge_pwd_pack (operator_id) VALUES (NULL)$$, $$UPDATE edge_pwd_pack SET operator_id = operator_id$$,
   $$INSERT INTO edge_pwd_pack_key (operator_id) VALUES (NULL)$$,
   $$SELECT edge_post_transaction(gen_random_uuid(), 1, 1, 'k', '\x00', '{}', NULL)$$,
   $$SELECT edge_replication_page(gen_random_uuid(), 0, 0, 10)$$,
   $$SELECT mark_edge_gateways_silent(interval '1 hour')$$, $$SELECT edge_log_release_stuck(gen_random_uuid())$$,
   $$SELECT set_edge_setting('replay_max_per_sale', 1, 'x')$$
  ]) q;
-- Dépôt autorisé (la fonction répond autre chose que 42501 : passerelle inconnue).
SELECT isnt(pg_temp.st($$SELECT deposit_edge_pwd_pack(gen_random_uuid(), gen_random_uuid(), '\x00', '\x00', 1)$$), '42501',
  'cashless_tagkeys : deposit_edge_pwd_pack exécutable');
SELECT isnt(pg_temp.st($$SELECT deposit_edge_pwd_pack_key(gen_random_uuid(), '\x00', '{}')$$), '42501',
  'cashless_tagkeys : deposit_edge_pwd_pack_key exécutable');
SELECT isnt(pg_temp.st($$SELECT * FROM edge_gateways_awaiting_pack(10)$$), '42501',
  'cashless_tagkeys : edge_gateways_awaiting_pack exécutable');

RESET ROLE;
SELECT pg_temp.a();
SET LOCAL ROLE cashless_maint;
SELECT is(pg_temp.st(q), '42501', 'cashless_maint : ' || left(q, 80) || ' refusé')
  FROM unnest(ARRAY[
   $$SELECT * FROM edge_gateway$$, $$SELECT * FROM debit_authority_handover$$,
   $$SELECT edge_post_transaction(gen_random_uuid(), 1, 1, 'k', '\x00', '{}', NULL)$$,
   $$SELECT deposit_edge_pwd_pack(gen_random_uuid(), gen_random_uuid(), '\x00', '\x00', 1)$$,
   $$SELECT set_edge_setting('replay_max_per_sale', 1, 'x')$$
  ]) q;
SELECT is(pg_temp.st($$SELECT mark_edge_gateways_silent(interval '1 hour')$$), 'OK',
  'cashless_maint : mark_edge_gateways_silent exécutable');
SELECT isnt(pg_temp.st($$SELECT * FROM edge_stuck_handovers(interval '1 hour')$$), '42501',
  'cashless_maint : edge_stuck_handovers exécutable');
SELECT is(pg_temp.st($$SELECT edge_log_release_stuck(gen_random_uuid())$$), 'CL013',
  'cashless_maint : edge_log_release_stuck exécutable (décision 37 ; handover inconnu : CL013, pas 42501)');
SELECT is(pg_temp.st($$SELECT edge_replication_terms(gen_random_uuid())$$), '42501',
  'cashless_maint : edge_replication_terms (aide interne) refusée');
RESET ROLE;

-- 3. Inter-prestataires : les fonctions d'administration refusent la passerelle d'un autre prestataire ------------------
-- Le prestataire B appelle chaque fonction sur une passerelle de A, avec des arguments VALIDES par ailleurs : sans
-- assert_tenant l'appel réussirait (ce test échouerait). Résultat attendu : no_data_found (P0002), message identique à
-- celui d'une passerelle inconnue (aucun oracle d'existence).
SELECT pg_temp.b();
SET LOCAL ROLE cashless_edgeadmin;
SELECT is(pg_temp.st($$SELECT rotate_edge_gateway_cert(pg_temp.id('64e001'), sha256('\x01'), 'test inter-prestataires')$$),
  'P0002', 'B ne fait pas tourner le certificat d''une passerelle de A (rotate_edge_gateway_cert)');
SELECT is(pg_temp.st($$SELECT revoke_edge_gateway(pg_temp.id('64e001'), 'motif', 'test inter-prestataires')$$),
  'P0002', 'B ne révoque pas une passerelle de A (revoke_edge_gateway)');
SELECT is(pg_temp.st($$SELECT swap_edge_gateway_roles(pg_temp.id('64e001'), pg_temp.id('64e002'), 'test inter-prestataires')$$),
  'P0002', 'B n''échange pas les rôles des passerelles de A (swap_edge_gateway_roles)');
SELECT is(pg_temp.st($$SELECT edge_register_snapshot_key(pg_temp.id('64e001'), 'k64', '\x0102', 'test inter-prestataires')$$),
  'P0002', 'B n''enregistre pas de clé de snapshot pour une passerelle de A (edge_register_snapshot_key)');
SELECT is(pg_temp.st($$SELECT rotate_edge_gateway_cert(gen_random_uuid(), sha256('\x01'), 'x')$$),
  'P0002', 'passerelle inconnue : même code que la passerelle d''un autre prestataire');
RESET ROLE;
-- set_edge_gateway_role n'est accordée à personne : le contrôle de prestataire se prouve sous le propriétaire.
SELECT is(pg_temp.st($$SELECT set_edge_gateway_role(pg_temp.id('64e002'), 'PRIMARY', 'test inter-prestataires')$$),
  'P0002', 'B ne change pas le rôle d''une passerelle de A (set_edge_gateway_role, sous le propriétaire)');
-- Contrôle positif : A, lui, passe (la garde ne sur-bloque pas).
SELECT pg_temp.a();
SET LOCAL ROLE cashless_edgeadmin;
SELECT is(pg_temp.st($$SELECT edge_register_snapshot_key(pg_temp.id('64e001'), 'k64', '\x0102', 'test A')$$), 'OK',
  'A enregistre une clé de snapshot pour sa propre passerelle (contrôle positif)');
SELECT is(pg_temp.st($$SELECT rotate_edge_gateway_cert(pg_temp.id('64e001'), sha256('\x01'), 'test A')$$), 'OK',
  'A fait tourner le certificat de sa propre passerelle (contrôle positif)');
RESET ROLE;

-- 4. Journal de référence : isolation réelle entre prestataires ----------------------------------------------------------
-- cashless_app n'a plus aucun droit sur edge_reference_change. L'isolation (RLS tenant_isolation, FORCEE) se prouve
-- sous un rôle auquel on accorde, DANS LA TRANSACTION, un SELECT de contrôle (annulé par le ROLLBACK).
CREATE TEMP TABLE lg AS SELECT scope_id, id FROM ledger WHERE scope_id IN (pg_temp.id('64d001'), pg_temp.id('64d011'));
GRANT ALL ON lg TO PUBLIC;
GRANT SELECT ON edge_reference_change TO cashless_maint;
SELECT pg_temp.a();
SET LOCAL ROLE cashless_maint;
SELECT cmp_ok((SELECT count(*)::int FROM edge_reference_change), '>', 0,
  'journal de référence : A voit ses lignes (le grand livre de d001 a émis sa ligne EVENT)');
SELECT is((SELECT count(*)::int FROM edge_reference_change
            WHERE ledger_id = (SELECT id FROM lg WHERE scope_id = pg_temp.id('64d011'))), 0,
  'journal de référence : A ne voit aucune ligne du grand livre de B');
RESET ROLE;
SELECT pg_temp.b();
SET LOCAL ROLE cashless_maint;
SELECT is((SELECT count(*)::int FROM edge_reference_change
            WHERE ledger_id = (SELECT id FROM lg WHERE scope_id = pg_temp.id('64d001'))), 0,
  'journal de référence : B ne voit aucune ligne du grand livre de A');
SELECT cmp_ok((SELECT count(*)::int FROM edge_reference_change), '>', 0, 'journal de référence : B voit les siennes');
RESET ROLE;
REVOKE SELECT ON edge_reference_change FROM cashless_maint;

-- 5. Les mesures voient un droit rétabli (preuve que les assertions échouent si le droit revient) ------------------------
GRANT INSERT ON edge_gateway TO cashless_app;
SELECT isnt(pg_temp.write_viol(), '', 'contrôle : INSERT rétabli sur edge_gateway pour cashless_app : détecté');
REVOKE INSERT ON edge_gateway FROM cashless_app;
GRANT UPDATE (status) ON edge_sync_batch TO cashless_app;
SELECT isnt(pg_temp.write_viol(), '', 'contrôle : UPDATE par colonne rétabli sur edge_sync_batch : détecté');
REVOKE UPDATE (status) ON edge_sync_batch FROM cashless_app;
GRANT SELECT ON edge_pwd_pack TO cashless_app;
SELECT isnt(pg_temp.read_viol(), '', 'contrôle : SELECT rétabli sur edge_pwd_pack pour cashless_app : détecté');
REVOKE SELECT ON edge_pwd_pack FROM cashless_app;
GRANT SELECT ON edge_staff_token_audit TO cashless_app;
SELECT isnt(pg_temp.read_viol(), '', 'contrôle : SELECT rétabli sur edge_staff_token_audit : détecté');
REVOKE SELECT ON edge_staff_token_audit FROM cashless_app;
GRANT SELECT ON edge_gateway TO cashless_edge;
SELECT isnt(pg_temp.read_viol(), '', 'contrôle : SELECT de cashless_edge sur edge_gateway : détecté');
REVOKE SELECT ON edge_gateway FROM cashless_edge;
GRANT ALL ON edge_platform_setting TO cashless_app;
SELECT isnt(pg_temp.write_viol() || pg_temp.read_viol(), '', 'contrôle : arw rendu sur edge_platform_setting : détecté');
REVOKE ALL ON edge_platform_setting FROM cashless_app;
GRANT ALL ON edge_device_seq_acked TO cashless_app;
SELECT isnt(pg_temp.write_viol() || pg_temp.read_viol(), '', 'contrôle : arw rendu sur la vue des terminaux : détecté');
REVOKE ALL ON edge_device_seq_acked FROM cashless_app;
SELECT is(pg_temp.write_viol() || pg_temp.read_viol(), '', 'après les contrôles : état rétabli, aucune violation');
-- Un EXECUTE rétabli sur une fonction S12 brute est vu par la liste figée de tests_execute_grants.sql ; ici, par :
GRANT EXECUTE ON FUNCTION grant_edge_authority(uuid, uuid, uuid) TO cashless_app;
SELECT ok(has_function_privilege('cashless_app', 'grant_edge_authority(uuid,uuid,uuid)', 'EXECUTE'),
  'contrôle : EXECUTE rétabli sur grant_edge_authority pour cashless_app (la liste figée de tests_execute_grants échouerait)');
REVOKE EXECUTE ON FUNCTION grant_edge_authority(uuid, uuid, uuid) FROM cashless_app;
SELECT ok(NOT has_function_privilege('cashless_app', 'grant_edge_authority(uuid,uuid,uuid)', 'EXECUTE'),
  'grant_edge_authority brute : de nouveau refusée à cashless_app');

SELECT * FROM finish();
ROLLBACK;
