-- Bascule d'autorité, accusé, rendu en deux temps, reprise forcée, fermeture de caisse (migration 0059 ; mission
-- passerelle-locale, lot WP04 ; FR-003, FR-006, FR-007, FR-021, FR-022, FR-024, C-003, C-012) — pgTAP, écrit à la main,
-- SOUS LE PROPRIETAIRE seulement (les droits sont en WP09).
-- Lancer depuis packages/ledger-sql : pg_prove -d <base> tests/tests_edge_handover.sql
-- Limites : une session pgTAP ne prouve pas la concurrence (verrous d'autorité) ni la livraison de la notification
-- (NOTIFY part au COMMIT) : on prouve l'existence du déclencheur et le canal/payload dans son corps. La requête
-- « même demandeur et valideur » ne peut pas exister en base (CHECK de approval_request) : on le prouve.
\set ON_ERROR_STOP 1
\set QUIET 1
BEGIN;
\ir _grants_for_tests.sql
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

CREATE FUNCTION pg_temp.id(p text) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT ('00000000-0000-0000-0000-' || lpad(p, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.a() RETURNS void LANGUAGE sql AS
  $$ SELECT set_config('app.operator_id', pg_temp.id('59a001')::text, true) $$;
CREATE FUNCTION pg_temp.b() RETURNS void LANGUAGE sql AS
  $$ SELECT set_config('app.operator_id', pg_temp.id('59a002')::text, true) $$;
CREATE FUNCTION pg_temp.gw(p text) RETURNS void LANGUAGE sql AS
  $$ SELECT set_config('app.gateway_id', CASE WHEN p = '' THEN '' ELSE pg_temp.id(p)::text END, true) $$;
CREATE FUNCTION pg_temp.lg(p_event text) RETURNS uuid LANGUAGE sql AS
  $$ SELECT id FROM ledger WHERE scope_id = pg_temp.id(p_event) $$;

-- Données (propriétaire) -----------------------------------------------------------------------------------
INSERT INTO party (kind, legal_name) SELECT 'PLATFORM', 'Plateforme (test)'
 WHERE NOT EXISTS (SELECT 1 FROM party WHERE kind = 'PLATFORM');
INSERT INTO party (id, kind, legal_name, country_code) VALUES
 (pg_temp.id('59a001'), 'OPERATOR', 'Prestataire A', 'SN'),
 (pg_temp.id('59a002'), 'OPERATOR', 'Prestataire B', 'CI');
INSERT INTO party (id, kind, operator_id, legal_name) VALUES
 (pg_temp.id('59b001'), 'ORGANIZER', pg_temp.id('59a001'), 'Organisateur A'),
 (pg_temp.id('59b011'), 'ORGANIZER', pg_temp.id('59a002'), 'Organisateur B');
INSERT INTO jurisdiction_profile (id, country_code, version, valid_from, breakage_destination)
VALUES (pg_temp.id('59c001'), 'SN', 590059, '2026-01-01', 'ORGANIZER');
INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone, jurisdiction_id, funds_holder, status)
SELECT pg_temp.id(e), pg_temp.id(o), pg_temp.id(g), 'Evénement ' || e, 'XOF', 'Africa/Dakar',
       pg_temp.id('59c001'), 'ORGANIZER', 'LIVE'::event_status
  FROM (VALUES ('59d001','59a001','59b001'), ('59d002','59a001','59b001'), ('59d003','59a001','59b001'),
               ('59d011','59a002','59b011')) AS v(e, o, g);
SELECT pg_temp.a();
SELECT open_event_ledger(pg_temp.id(e)) FROM (VALUES ('59d001'), ('59d002'), ('59d003')) AS v(e);
SELECT pg_temp.b();
SELECT open_event_ledger(pg_temp.id('59d011'));
SELECT pg_temp.a();
-- P1 PRIMARY et S1 STANDBY de d001 ; P2 PRIMARY de d002 ; P3 PRIMARY de d003 ; P4 REVOKED de d003.
INSERT INTO edge_gateway (id, operator_id, event_id, serial, role, status) VALUES
 (pg_temp.id('59e001'), pg_temp.id('59a001'), pg_temp.id('59d001'), 'H-P1', 'PRIMARY', 'ACTIVE'),
 (pg_temp.id('59e002'), pg_temp.id('59a001'), pg_temp.id('59d001'), 'H-S1', 'STANDBY', 'ACTIVE'),
 (pg_temp.id('59e003'), pg_temp.id('59a001'), pg_temp.id('59d002'), 'H-P2', 'PRIMARY', 'ACTIVE'),
 (pg_temp.id('59e004'), pg_temp.id('59a001'), pg_temp.id('59d003'), 'H-P3', 'PRIMARY', 'ACTIVE'),
 (pg_temp.id('59e005'), pg_temp.id('59a001'), pg_temp.id('59d003'), 'H-P4', 'PRIMARY', 'REVOKED');
-- Amorce (0063) : chaque grand livre neuf porte déjà une ligne EVENT (change_seq 1). Le propriétaire les retire
-- (déclencheur d'immuabilité écarté pour la seule transaction) pour garder les numéros posés ci-dessous.
SET LOCAL session_replication_role = replica;
SELECT pg_temp.a();
DELETE FROM edge_reference_change;
SELECT pg_temp.b();
DELETE FROM edge_reference_change;
SET LOCAL session_replication_role = origin;
SELECT pg_temp.a();
-- Journal de référence : d001 trois lignes, d003 une ligne, d002 vide (au début).
INSERT INTO edge_reference_change (ledger_id, change_seq, operator_id, entity_kind, entity_id)
SELECT pg_temp.lg('59d001'), n, pg_temp.id('59a001'), 'CATALOG', gen_random_uuid() FROM generate_series(1, 3) n;
INSERT INTO edge_reference_change (ledger_id, change_seq, operator_id, entity_kind, entity_id)
VALUES (pg_temp.lg('59d003'), 1, pg_temp.id('59a001'), 'CATALOG', gen_random_uuid());
-- Personnes et terminaux de caisse (d001 : e001 CASHIER, e002 SUPERVISOR ; d003 : e003, e004).
INSERT INTO app_user (id, operator_id, issuer, subject, email, display_name)
SELECT pg_temp.id(u), pg_temp.id('59a001'), 'https://idp.test', 's0059' || u, u || '@test', 'Personne ' || u
  FROM (VALUES ('59f001'), ('59f002'), ('59f003'), ('59f004'), ('59f005'), ('59f006')) AS v(u);
INSERT INTO role_assignment (user_id, role, scope_type, scope_id, granted_by) VALUES
 (pg_temp.id('59f001'), 'CASHIER', 'EVENT', pg_temp.id('59d001'), NULL),
 (pg_temp.id('59f002'), 'SUPERVISOR', 'EVENT', pg_temp.id('59d001'), NULL),
 (pg_temp.id('59f003'), 'CASHIER', 'EVENT', pg_temp.id('59d003'), NULL),
 (pg_temp.id('59f004'), 'SUPERVISOR', 'EVENT', pg_temp.id('59d003'), NULL);
INSERT INTO device (id, operator_id, kind, app_mode, event_id, serial) VALUES
 (pg_temp.id('59aa01'), pg_temp.id('59a001'), 'TOPUP', 'TOPUP_DESK', pg_temp.id('59d001'), 'H59-AA01'),
 (pg_temp.id('59aa03'), pg_temp.id('59a001'), 'TOPUP', 'TOPUP_DESK', pg_temp.id('59d003'), 'H59-AA03');
CREATE TABLE pg_temp.r (k text PRIMARY KEY, v uuid);
CREATE FUNCTION pg_temp.hid(k text) RETURNS uuid LANGUAGE sql AS $$ SELECT v FROM pg_temp.r WHERE r.k = hid.k $$;
CREATE FUNCTION pg_temp.ep(k text) RETURNS bigint LANGUAGE sql AS
  $$ SELECT epoch::bigint FROM debit_authority_handover WHERE id = pg_temp.hid(k) $$;
CREATE FUNCTION pg_temp.hh(p text) RETURNS bytea LANGUAGE sql AS
  $$ SELECT coalesce(last_chain_hash, edge_chain_genesis(id)) FROM edge_gateway WHERE id = pg_temp.id(p) $$;
CREATE FUNCTION pg_temp.hst(k text) RETURNS text LANGUAGE sql AS
  $$ SELECT status FROM debit_authority_handover WHERE id = pg_temp.hid(k) $$;
CREATE FUNCTION pg_temp.auth(p_event text) RETURNS text LANGUAGE sql AS
  $$ SELECT debit_authority || '/' || authority_epoch FROM ledger WHERE scope_id = pg_temp.id(p_event) $$;
CREATE FUNCTION pg_temp.seqs(p text, p_from int, p_to int) RETURNS int LANGUAGE sql AS $$
  SELECT count(*)::int FROM generate_series(p_from, p_to) n,
    LATERAL record_edge_seq(pg_temp.id(p), n, 'o' || p || n, sha256(convert_to('c' || p || n, 'UTF8')), 'ACCEPTED') $$;
CREATE FUNCTION pg_temp.cur(p text) RETURNS text LANGUAGE sql AS $$
  SELECT coalesce(string_agg(direction || '/' || status, ',' ORDER BY id), '-') FROM get_current_edge_handover(pg_temp.id(p)) $$;

-- 1. Structure -------------------------------------------------------------------------------------------------
SELECT has_column('debit_authority_handover', c) FROM unnest(ARRAY['begun_releasing_at','ops_count',
  'edge_seq_at_activation','reference_watermark_seq']) c;
SELECT has_trigger('debit_authority_handover', 'edge_handover_notify', 'déclencheur de notification');
SELECT ok((SELECT prosrc FROM pg_proc WHERE proname = 'edge_handover_notify')
  LIKE '%pg_notify(''edge_handover_changed'', NEW.edge_gateway_id::text)%',
  'la notification porte le seul identifiant de la passerelle');
SELECT is((SELECT count(*)::int FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ANY(ARRAY[
  'edge_bind_gateway','edge_lock_handover','get_debit_authority','get_current_edge_handover','edge_grant_authority',
  'edge_ack_handover','begin_edge_release','edge_complete_release','fail_edge_release',
  'force_central_authority_approved','edge_stuck_handovers','begin_cash_close'])
  AND p.prosecdef AND p.proconfig @> ARRAY['search_path=public, pg_temp']), 12,
  'douze fonctions SECURITY DEFINER avec search_path = public, pg_temp');
SELECT is((SELECT count(*)::int FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ANY(ARRAY[
  'edge_bind_gateway','edge_lock_handover','get_debit_authority','get_current_edge_handover','edge_grant_authority',
  'edge_ack_handover','begin_edge_release','edge_complete_release','fail_edge_release',
  'force_central_authority_approved','edge_stuck_handovers'])
  AND has_function_privilege('public', p.oid, 'EXECUTE')), 0, 'aucune fonction de WP04 exécutable par PUBLIC');
SELECT is((SELECT count(*)::int FROM pg_proc p WHERE p.proname = 'force_central_authority'
  AND p.prosrc LIKE '%approval_request%'), 0, 'force_central_authority du kit inchangée (ne lit pas approval_request)');

-- 2. Accord : refus sans journal, avec session CLOSING (testé plus bas) ------------------------------------------
SELECT pg_temp.a();
SELECT throws_ok($$SELECT edge_grant_authority(pg_temp.lg('59d002'), pg_temp.id('59e003'), pg_temp.id('59f001'))$$,
  'CL013', NULL, 'A03 : accord sans journal de référence refusé (pas de filigrane à 0)');
SELECT is(pg_temp.auth('59d002'), 'CENTRAL/0', 'le refus n''a rien changé');
SELECT throws_ok($$SELECT edge_grant_authority(pg_temp.lg('59d001'), pg_temp.id('59e001'), NULL)$$, 'CL001', NULL,
  'acteur obligatoire');
SELECT throws_ok($$SELECT edge_grant_authority(pg_temp.lg('59d001'), pg_temp.id('59e003'), pg_temp.id('59f001'))$$,
  'CL013', NULL, 'passerelle d''un autre événement : refus par grant_edge_authority');
SELECT throws_ok($$SELECT edge_grant_authority(pg_temp.lg('59d001'), pg_temp.id('59e002'), pg_temp.id('59f001'))$$,
  'CL013', NULL, 'passerelle STANDBY : refus par grant_edge_authority');
SELECT throws_ok($$SELECT edge_grant_authority(pg_temp.lg('59d003'), pg_temp.id('59e005'), pg_temp.id('59f001'))$$,
  'CL013', NULL, 'passerelle REVOKED : refus par grant_edge_authority');

-- 3. Session de caisse ouverte avant la bascule (sert aux tests de begin_cash_close) -----------------------------
INSERT INTO pg_temp.r SELECT 's1', cash_session_id FROM open_cash_session(pg_temp.id('59aa01'), pg_temp.id('59f001'));
SELECT count_cash_session(pg_temp.hid('s1'), 100, pg_temp.id('59f001'), pg_temp.id('59aa01'));

-- 4. CYCLE 1 : accord, accusé, rendu -----------------------------------------------------------------------
INSERT INTO pg_temp.r SELECT 'g1', id FROM edge_grant_authority(pg_temp.lg('59d001'), pg_temp.id('59e001'),
  pg_temp.id('59f001'));
SELECT is(pg_temp.hst('g1'), 'GRANTED', 'accord : GRANTED');
SELECT is((SELECT reference_watermark_seq FROM debit_authority_handover WHERE id = pg_temp.hid('g1')), 3::bigint,
  'filigrane de référence = dernier change_seq du journal');
SELECT is(pg_temp.auth('59d001'), 'EDGE/1', 'grand livre sous EDGE, époque 1');
SELECT is((SELECT authority FROM get_debit_authority(pg_temp.lg('59d001'))), 'EDGE', 'get_debit_authority : EDGE');
SELECT is((SELECT epoch FROM get_debit_authority(pg_temp.lg('59d001'))), 1::bigint, 'get_debit_authority : époque');
SELECT is((SELECT edge_gateway_id FROM get_debit_authority(pg_temp.lg('59d001'))), pg_temp.id('59e001'),
  'get_debit_authority : passerelle désignée');
UPDATE edge_gateway SET lan_url = 'https://p1.lan' WHERE id = pg_temp.id('59e001');
SELECT is((SELECT lan_url FROM get_debit_authority(pg_temp.lg('59d001'))), 'https://p1.lan',
  'lan_url de la passerelle désignée sous EDGE');
SELECT is((SELECT lan_url FROM get_debit_authority(pg_temp.lg('59d003'))), NULL,
  'lan_url nul sous CENTRAL');
SELECT is((SELECT authority FROM get_debit_authority(pg_temp.lg('59d003'))), 'CENTRAL', 'CENTRAL');
SELECT throws_ok($$SELECT * FROM get_debit_authority(gen_random_uuid())$$, 'P0002', NULL, 'grand livre inconnu');

-- get_current_edge_handover, priorité (3) puis visibilité par passerelle
SELECT pg_temp.gw('59e001');
SELECT is(pg_temp.cur('59e001'), 'TO_EDGE/GRANTED', 'priorité 3 : le TO_EDGE GRANTED');
SELECT pg_temp.gw('59e002');
SELECT is(pg_temp.cur('59e002'), '-', 'priorité 4 : la STANDBY du même événement ne voit rien (lecture permise)');
SELECT pg_temp.gw('59e003');
SELECT is(pg_temp.cur('59e003'), '-', 'une autre passerelle ne voit rien');

-- begin_cash_close refusé : bascule ouverte (GRANTED), session OPEN avec un comptage
SELECT pg_temp.a();
SELECT throws_ok($$SELECT begin_cash_close(pg_temp.hid('s1'), pg_temp.id('59f002'))$$, 'CL029', NULL,
  'begin_cash_close refusé sous EDGE avec une bascule ouverte');

-- Accusé : enveloppe (42501 / CL013 / CL015 / CL014)
SELECT pg_temp.gw('');
SELECT throws_ok($$SELECT edge_ack_handover(pg_temp.id('59e001'), pg_temp.hid('g1'), pg_temp.ep('g1'), 0)$$,
  '42501', NULL, 'sans app.gateway_id : 42501');
SELECT pg_temp.gw('59e003');
SELECT throws_ok($$SELECT edge_ack_handover(pg_temp.id('59e001'), pg_temp.hid('g1'), pg_temp.ep('g1'), 0)$$,
  '42501', NULL, 'app.gateway_id d''une autre passerelle : 42501');
SELECT pg_temp.gw('59e002');
SELECT throws_ok($$SELECT edge_ack_handover(pg_temp.id('59e002'), pg_temp.hid('g1'), pg_temp.ep('g1'), 0)$$,
  '42501', NULL, 'STANDBY : 42501');
SELECT pg_temp.gw('59e005');
SELECT throws_ok($$SELECT edge_ack_handover(pg_temp.id('59e005'), pg_temp.hid('g1'), pg_temp.ep('g1'), 0)$$,
  '42501', NULL, 'REVOKED : 42501');
SELECT pg_temp.gw('59e001');
SELECT pg_temp.b();
SELECT throws_ok($$SELECT edge_ack_handover(pg_temp.id('59e001'), pg_temp.hid('g1'), pg_temp.ep('g1'), 0)$$,
  'P0002', NULL, 'autre prestataire : no_data_found');
SELECT throws_ok($$SELECT * FROM get_debit_authority(pg_temp.lg('59d001'))$$, 'P0002', NULL,
  'autre prestataire : get_debit_authority no_data_found');
SELECT throws_ok($$SELECT edge_grant_authority(pg_temp.lg('59d001'), pg_temp.id('59e001'), pg_temp.id('59f001'))$$,
  'P0002', NULL, 'autre prestataire : edge_grant_authority no_data_found');
SELECT pg_temp.a();
-- Handover étranger ou inconnu : même message (aucun oracle)
SELECT pg_temp.gw('59e003');
SELECT throws_ok($$SELECT edge_ack_handover(pg_temp.id('59e003'), pg_temp.hid('g1'), pg_temp.ep('g1'), 0)$$,
  'CL013', 'Bascule inconnue ou étrangère à cette passerelle', 'ack : handover d''une autre passerelle');
SELECT throws_ok($$SELECT edge_ack_handover(pg_temp.id('59e003'), gen_random_uuid(), 1, 0)$$,
  'CL013', 'Bascule inconnue ou étrangère à cette passerelle', 'ack : handover inconnu, même message');
SELECT throws_ok($$SELECT begin_edge_release(pg_temp.id('59e003'), pg_temp.hid('g1'), 1, 1, sha256('x'), 1)$$,
  'CL013', 'Bascule inconnue ou étrangère à cette passerelle', 'begin : handover d''une autre passerelle');
SELECT throws_ok($$SELECT edge_complete_release(pg_temp.id('59e003'), pg_temp.hid('g1'), 1, 1, sha256('x'), 1)$$,
  'CL013', 'Bascule inconnue ou étrangère à cette passerelle', 'complete : handover d''une autre passerelle');
SELECT throws_ok($$SELECT edge_complete_release(pg_temp.id('59e003'), gen_random_uuid(), 1, 1, sha256('x'), 1)$$,
  'CL013', 'Bascule inconnue ou étrangère à cette passerelle', 'complete : handover inconnu, même message');
SELECT pg_temp.gw('59e001');
SELECT throws_ok($$SELECT edge_ack_handover(pg_temp.id('59e001'), pg_temp.hid('g1'), 99, 0)$$, 'CL015', NULL,
  'ack : mauvaise époque');
-- A03 : référence en retard d'un cran
SELECT throws_ok($$SELECT edge_ack_handover(pg_temp.id('59e001'), pg_temp.hid('g1'), pg_temp.ep('g1'), 0)$$,
  'CL014', NULL, 'A03 : reference_applied_seq 0 < filigrane 3 : refusé');
UPDATE edge_gateway SET reference_applied_seq = 2 WHERE id = pg_temp.id('59e001');
SELECT throws_ok($$SELECT edge_ack_handover(pg_temp.id('59e001'), pg_temp.hid('g1'), pg_temp.ep('g1'), 0)$$,
  'CL014', NULL, 'A03 : en retard d''un cran : refusé');
SELECT is(pg_temp.hst('g1'), 'GRANTED', 'les refus n''ont rien écrit');
UPDATE edge_gateway SET reference_applied_seq = 3 WHERE id = pg_temp.id('59e001');
SELECT throws_ok($$SELECT edge_ack_handover(pg_temp.id('59e001'), pg_temp.hid('g1'), pg_temp.ep('g1'), NULL)$$,
  'CL001', NULL, 'position de réplication nulle refusée');
SELECT is((SELECT status FROM edge_ack_handover(pg_temp.id('59e001'), pg_temp.hid('g1'), pg_temp.ep('g1'), 0)),
  'ACTIVE', 'A03 : référence au filigrane : accusé accepté');
SELECT is((SELECT edge_seq_at_activation FROM debit_authority_handover WHERE id = pg_temp.hid('g1')), 0::bigint,
  'A05 : premier cycle, edge_seq_at_activation = 0');
-- A17 : rejeu sans écriture
CREATE TABLE pg_temp.snap AS SELECT ctid::text AS c, updated_at FROM debit_authority_handover
 WHERE id = pg_temp.hid('g1');
SELECT is((SELECT status FROM edge_ack_handover(pg_temp.id('59e001'), pg_temp.hid('g1'), pg_temp.ep('g1'), 0)),
  'ACTIVE', 'A17 : accusé rejoué : état courant');
SELECT is((SELECT status FROM edge_ack_handover(pg_temp.id('59e001'), pg_temp.hid('g1'), pg_temp.ep('g1'), 0)),
  'ACTIVE', 'A17 : accusé rejoué une deuxième fois');
SELECT is((SELECT ctid::text FROM debit_authority_handover WHERE id = pg_temp.hid('g1')),
  (SELECT c FROM pg_temp.snap), 'A17 : le rejeu n''écrit pas (même version de ligne)');
SELECT throws_ok($$SELECT edge_ack_handover(pg_temp.id('59e001'), pg_temp.hid('g1'), 7, 0)$$, 'CL015', NULL,
  'A17 : rejeu à une autre époque : CL015');
-- Lecture : TO_EDGE ACTIVE
SELECT is(pg_temp.cur('59e001'), 'TO_EDGE/ACTIVE', 'priorité 3 : le TO_EDGE ACTIVE');

-- 4b. File de 4211 décisions, demande de retour, rendu incomplet --------------------------------------------
SELECT is(pg_temp.seqs('59e001', 1, 4211), 4211, '4211 décisions enregistrées (S13)');
INSERT INTO pg_temp.r SELECT 'c1', id FROM request_edge_release(pg_temp.lg('59d001'), pg_temp.id('59f001'));
SELECT is(pg_temp.cur('59e001'), 'TO_CENTRAL/RELEASE_REQUESTED', 'priorité 1 : le TO_CENTRAL ouvert l''emporte');
CREATE TABLE pg_temp.h1 AS SELECT pg_temp.hh('59e001') AS h;
SELECT throws_ok($$SELECT edge_complete_release(pg_temp.id('59e001'), pg_temp.hid('c1'), pg_temp.ep('c1'), 4211,
  (SELECT h FROM pg_temp.h1), 4211)$$, 'CL013', NULL, 'COMPLETED direct depuis RELEASE_REQUESTED refusé');
SELECT throws_ok($$SELECT begin_edge_release(pg_temp.id('59e001'), pg_temp.hid('c1'), 99, 4211,
  (SELECT h FROM pg_temp.h1), 4211)$$, 'CL015', NULL, 'begin : mauvaise époque');
UPDATE edge_gateway SET contiguous_edge_seq = 4200 WHERE id = pg_temp.id('59e001');   -- file incomplète (simulée)
SELECT is((SELECT status FROM begin_edge_release(pg_temp.id('59e001'), pg_temp.hid('c1'), pg_temp.ep('c1'), 4211,
  (SELECT h FROM pg_temp.h1), 4211)), 'RELEASING', 'begin : RELEASE_REQUESTED -> RELEASING');
SELECT isnt((SELECT begun_releasing_at FROM debit_authority_handover WHERE id = pg_temp.hid('c1')), NULL::timestamptz,
  'begun_releasing_at posé');
SELECT is((SELECT ops_count FROM debit_authority_handover WHERE id = pg_temp.hid('c1')), 4211::bigint,
  'A05 : premier cycle, ops_count = final_edge_seq');
CREATE TABLE pg_temp.snap2 AS SELECT ctid::text AS c FROM debit_authority_handover WHERE id = pg_temp.hid('c1');
SELECT is((SELECT status FROM begin_edge_release(pg_temp.id('59e001'), pg_temp.hid('c1'), pg_temp.ep('c1'), 4211,
  (SELECT h FROM pg_temp.h1), 4211)), 'RELEASING', 'begin rejoué : sans effet');
SELECT is((SELECT ctid::text FROM debit_authority_handover WHERE id = pg_temp.hid('c1')),
  (SELECT c FROM pg_temp.snap2), 'begin rejoué : aucune écriture');
SELECT is(pg_temp.cur('59e001'), 'TO_CENTRAL/RELEASING', 'priorité 1 : RELEASING');
SAVEPOINT rel;
SELECT throws_ok($$SELECT edge_complete_release(pg_temp.id('59e001'), pg_temp.hid('c1'), pg_temp.ep('c1'), 4211,
  (SELECT h FROM pg_temp.h1), 4211)$$, 'CL014', NULL, 'file incomplète : CL014');
ROLLBACK TO SAVEPOINT rel;
SELECT is(pg_temp.hst('c1'), 'RELEASING', 'RELEASING conservé après l''échec');
SELECT is(pg_temp.auth('59d001'), 'EDGE/1', 'le grand livre reste EDGE');
SELECT ok(EXISTS (SELECT 1 FROM unnest(ARRAY[1]) x WHERE (SELECT prosrc FROM pg_proc
  WHERE proname = 'edge_complete_release') LIKE '%missing_edge_seqs=%'), 'le message CL014 liste missing_edge_seqs');
-- edge_stuck_handovers
SELECT is((SELECT count(*)::int FROM edge_stuck_handovers(interval '10 minutes')), 0, 'rendu récent : pas bloqué');
UPDATE debit_authority_handover SET begun_releasing_at = now() - interval '11 minutes' WHERE id = pg_temp.hid('c1');
SELECT is((SELECT id FROM edge_stuck_handovers(interval '10 minutes')), pg_temp.hid('c1'),
  'rendu bloqué depuis plus de 10 minutes rendu par edge_stuck_handovers');
-- Compte faux et chaîne fausse
SELECT throws_ok($$SELECT edge_complete_release(pg_temp.id('59e001'), pg_temp.hid('c1'), pg_temp.ep('c1'), 4211,
  (SELECT h FROM pg_temp.h1), 4210)$$, 'CL017', NULL, 'compte d''opérations faux : CL017');
SELECT throws_ok($$SELECT edge_complete_release(pg_temp.id('59e001'), pg_temp.hid('c1'), pg_temp.ep('c1'), 4211,
  sha256('autre'), 4211)$$, 'CL017', NULL, 'empreinte différente de celle du début de rendu : CL017');
-- Rendu complet
UPDATE edge_gateway SET contiguous_edge_seq = 4211 WHERE id = pg_temp.id('59e001');
SELECT is((SELECT status FROM edge_complete_release(pg_temp.id('59e001'), pg_temp.hid('c1'), pg_temp.ep('c1'), 4211,
  (SELECT h FROM pg_temp.h1), 4211)), 'COMPLETED', 'rendu complet : COMPLETED');
SELECT is(pg_temp.auth('59d001'), 'CENTRAL/2', 'grand livre revenu au central, époque 2');
SELECT is(pg_temp.hst('g1'), 'COMPLETED', 'le TO_EDGE est clos');
-- A17 : après retour au central
SELECT throws_ok($$SELECT edge_ack_handover(pg_temp.id('59e001'), pg_temp.hid('g1'), 1, 0)$$, 'CL015', NULL,
  'A17 : accusé après retour au central : CL015');

-- 5. CYCLE 2 : ni compte global ni accusé non idempotent ------------------------------------------------------
INSERT INTO edge_reference_change (ledger_id, change_seq, operator_id, entity_kind, entity_id)
VALUES (pg_temp.lg('59d001'), 4, pg_temp.id('59a001'), 'STAFF', gen_random_uuid());
INSERT INTO pg_temp.r SELECT 'g2', id FROM edge_grant_authority(pg_temp.lg('59d001'), pg_temp.id('59e001'),
  pg_temp.id('59f001'));
SELECT is((SELECT reference_watermark_seq FROM debit_authority_handover WHERE id = pg_temp.hid('g2')), 4::bigint,
  'deuxième accord : filigrane 4');
SELECT is(pg_temp.ep('g2'), 3::bigint, 'deuxième accord : époque 3');
SELECT pg_temp.gw('59e001');
SELECT throws_ok($$SELECT edge_ack_handover(pg_temp.id('59e001'), pg_temp.hid('g2'), 3, 0)$$, 'CL014', NULL,
  'référence appliquée 3 < filigrane 4 : refusé');
UPDATE edge_gateway SET reference_applied_seq = 4 WHERE id = pg_temp.id('59e001');
SELECT is((SELECT status FROM edge_ack_handover(pg_temp.id('59e001'), pg_temp.hid('g2'), 3, 0)), 'ACTIVE',
  'deuxième accusé accepté');
SELECT is((SELECT edge_seq_at_activation FROM debit_authority_handover WHERE id = pg_temp.hid('g2')), 4211::bigint,
  'A05 : edge_seq_at_activation = 4211 au deuxième cycle');
SELECT is(pg_temp.seqs('59e001', 4212, 4251), 40, '40 ventes en file');
-- Tentative A : compte du premier cycle (4211) au lieu de 40
INSERT INTO pg_temp.r SELECT 'ca', id FROM request_edge_release(pg_temp.lg('59d001'), pg_temp.id('59f001'));
CREATE TABLE pg_temp.h2 AS SELECT pg_temp.hh('59e001') AS h;
SELECT is((SELECT status FROM begin_edge_release(pg_temp.id('59e001'), pg_temp.hid('ca'), pg_temp.ep('ca'), 4251,
  (SELECT h FROM pg_temp.h2), 4211)), 'RELEASING', 'tentative A : début de rendu avec le compte du cycle 1');
SELECT throws_ok($$SELECT edge_complete_release(pg_temp.id('59e001'), pg_temp.hid('ca'), pg_temp.ep('ca'), 4251,
  (SELECT h FROM pg_temp.h2), 4211)$$, 'CL017', NULL, 'A05 : deuxième cycle avec le compte du premier : CL017');
SELECT is(pg_temp.hst('ca'), 'RELEASING', 'RELEASING conservé');
SELECT is((SELECT status FROM fail_edge_release(pg_temp.hid('ca'), pg_temp.id('59f001'))), 'FAILED',
  'fail_edge_release : RELEASING -> FAILED');
SELECT is(pg_temp.auth('59d001'), 'EDGE/3', 'l''autorité reste à la passerelle après l''abandon');
SELECT throws_ok($$SELECT fail_edge_release(pg_temp.hid('ca'), pg_temp.id('59f001'))$$, 'CL013', NULL,
  'fail_edge_release : déjà FAILED');
SELECT throws_ok($$SELECT fail_edge_release(pg_temp.hid('g2'), pg_temp.id('59f001'))$$, 'CL013', NULL,
  'fail_edge_release : refusé pour un TO_EDGE');
SELECT is(pg_temp.cur('59e001'), 'TO_CENTRAL/FAILED', 'priorité 2 : dernier TO_CENTRAL FAILED du TO_EDGE actif');
UPDATE debit_authority_handover SET requested_at = now() - interval '2 hours' WHERE id = pg_temp.hid('ca');
-- Tentative B : empreinte fausse déclarée (chaîne contrôlée par complete_edge_release)
INSERT INTO pg_temp.r SELECT 'cb', id FROM request_edge_release(pg_temp.lg('59d001'), pg_temp.id('59f001'));
SELECT is(pg_temp.cur('59e001'), 'TO_CENTRAL/RELEASE_REQUESTED', 'priorité 1 l''emporte sur le FAILED plus ancien');
SELECT begin_edge_release(pg_temp.id('59e001'), pg_temp.hid('cb'), pg_temp.ep('cb'), 4251, sha256('fausse'), 40);
SELECT throws_ok($$SELECT edge_complete_release(pg_temp.id('59e001'), pg_temp.hid('cb'), pg_temp.ep('cb'), 4251,
  sha256('fausse'), 40)$$, 'CL017', NULL, 'chaîne fausse contrôlée par complete_edge_release : CL017');
SELECT is(pg_temp.hst('cb'), 'RELEASING', 'RELEASING conservé après CL017');
SELECT fail_edge_release(pg_temp.hid('cb'), pg_temp.id('59f001'));
UPDATE debit_authority_handover SET requested_at = now() - interval '1 hour' WHERE id = pg_temp.hid('cb');
-- Tentative C : correcte
INSERT INTO pg_temp.r SELECT 'cc', id FROM request_edge_release(pg_temp.lg('59d001'), pg_temp.id('59f001'));
SELECT begin_edge_release(pg_temp.id('59e001'), pg_temp.hid('cc'), pg_temp.ep('cc'), 4251, (SELECT h FROM pg_temp.h2), 40);
SELECT is((SELECT status FROM edge_complete_release(pg_temp.id('59e001'), pg_temp.hid('cc'), pg_temp.ep('cc'), 4251,
  (SELECT h FROM pg_temp.h2), 40)), 'COMPLETED', 'A05 : deuxième cycle, 4211 puis 4251, ops_count = 40');
SELECT is((SELECT ops_count FROM debit_authority_handover WHERE id = pg_temp.hid('cc')), 40::bigint, 'ops_count = 40');
SELECT is(pg_temp.auth('59d001'), 'CENTRAL/4', 'retour au central');
SELECT is(pg_temp.cur('59e001'), '-', 'priorité 4 : plus de handover ouvert');

-- 6. begin_cash_close sous CENTRAL ; accord refusé avec une session CLOSING ----------------------------------------
SELECT pg_temp.a();
SELECT is((SELECT cash_session_id FROM begin_cash_close(pg_temp.hid('s1'), pg_temp.id('59f002'))), pg_temp.hid('s1'),
  'begin_cash_close accepté sous CENTRAL sans bascule');
SELECT throws_ok($$SELECT edge_grant_authority(pg_temp.lg('59d001'), pg_temp.id('59e001'), pg_temp.id('59f001'))$$,
  'CL013', 'Accord impossible : une session de caisse est en cours de fermeture',
  'accord refusé avec une session de caisse CLOSING');
SELECT is(pg_temp.auth('59d001'), 'CENTRAL/4', 'refus sans effet');
-- Bascule ouverte sous CENTRAL (ligne posée à la main) : begin_cash_close refusé, puis accepté une fois close
INSERT INTO pg_temp.r SELECT 's3', cash_session_id FROM open_cash_session(pg_temp.id('59aa03'), pg_temp.id('59f003'));
SELECT count_cash_session(pg_temp.hid('s3'), 50, pg_temp.id('59f003'), pg_temp.id('59aa03'));
INSERT INTO debit_authority_handover (id, operator_id, ledger_id, edge_gateway_id, direction, status, epoch,
                                      watermark_posting_id, requested_by)
VALUES (pg_temp.id('59990a'), pg_temp.id('59a001'), pg_temp.lg('59d003'), pg_temp.id('59e004'), 'TO_EDGE', 'GRANTED',
        1, 0, pg_temp.id('59f003'));
SELECT throws_ok($$SELECT begin_cash_close(pg_temp.hid('s3'), pg_temp.id('59f004'))$$, 'CL029', NULL,
  'begin_cash_close refusé sous CENTRAL avec un handover GRANTED ouvert');
UPDATE debit_authority_handover SET status = 'FAILED' WHERE id = pg_temp.id('59990a');
SELECT is((SELECT cash_session_id FROM begin_cash_close(pg_temp.hid('s3'), pg_temp.id('59f004'))), pg_temp.hid('s3'),
  'begin_cash_close accepté une fois la bascule close');
SELECT is((SELECT status FROM cash_session WHERE cash_session_id = pg_temp.hid('s3')), 'CLOSING', 'session CLOSING');
SELECT throws_ok($$SELECT edge_grant_authority(pg_temp.lg('59d003'), pg_temp.id('59e004'), pg_temp.id('59f003'))$$,
  'CL013', NULL, 'accord refusé : session CLOSING sur d003');

-- 7. Reprise forcée avec preuve d'approbation (d002 / P2) ---------------------------------------------------------
INSERT INTO edge_reference_change (ledger_id, change_seq, operator_id, entity_kind, entity_id)
VALUES (pg_temp.lg('59d002'), 1, pg_temp.id('59a001'), 'CATALOG', gen_random_uuid());
INSERT INTO pg_temp.r SELECT 'g3', id FROM edge_grant_authority(pg_temp.lg('59d002'), pg_temp.id('59e003'),
  pg_temp.id('59f001'));
UPDATE edge_gateway SET reference_applied_seq = 1 WHERE id = pg_temp.id('59e003');
SELECT pg_temp.gw('59e003');
SELECT is((SELECT status FROM edge_ack_handover(pg_temp.id('59e003'), pg_temp.hid('g3'), pg_temp.ep('g3'), 0)),
  'ACTIVE', 'P2 : accusé');
SELECT pg_temp.a();
INSERT INTO approval_request (id, operator_id, action, target_id, payload, requested_by) VALUES
 (pg_temp.id('599a01'), pg_temp.id('59a001'), 'FORCE_CENTRAL_AUTHORITY', pg_temp.lg('59d002'), '{}', pg_temp.id('59f001')),
 (pg_temp.id('599a02'), pg_temp.id('59a001'), 'ADJUSTMENT', pg_temp.lg('59d002'), '{}', pg_temp.id('59f001')),
 (pg_temp.id('599a03'), pg_temp.id('59a001'), 'FORCE_CENTRAL_AUTHORITY', pg_temp.lg('59d001'), '{}', pg_temp.id('59f001')),
 (pg_temp.id('599a04'), pg_temp.id('59a001'), 'FORCE_CENTRAL_AUTHORITY', pg_temp.lg('59d002'), '{}', pg_temp.id('59f001')),
 (pg_temp.id('599a05'), pg_temp.id('59a001'), 'FORCE_CENTRAL_AUTHORITY', pg_temp.lg('59d002'), '{}', pg_temp.id('59f001')),
 (pg_temp.id('599a06'), pg_temp.id('59a001'), 'FORCE_CENTRAL_AUTHORITY', pg_temp.lg('59d002'), '{}', pg_temp.id('59f001'));
SELECT throws_ok($$UPDATE approval_request SET status = 'APPROVED', decided_by = requested_by, decided_at = now()
  WHERE id = pg_temp.id('599a06')$$, '23514', NULL, 'même demandeur et valideur : impossible en base (CHECK)');
UPDATE approval_request SET status = 'APPROVED', decided_by = pg_temp.id('59f002'), decided_at = now()
 WHERE id IN (pg_temp.id('599a02'), pg_temp.id('599a03'), pg_temp.id('599a04'), pg_temp.id('599a05'));
UPDATE approval_request SET status = 'EXECUTED' WHERE id = pg_temp.id('599a04');
SELECT throws_ok($$SELECT force_central_authority_approved(pg_temp.lg('59d002'), gen_random_uuid(), 'perdue')$$,
  '42501', NULL, 'sans approbation (identifiant inconnu) : refus');
SELECT throws_ok($$SELECT force_central_authority_approved(pg_temp.lg('59d002'), pg_temp.id('599a01'), 'perdue')$$,
  '42501', NULL, 'demande PENDING : refus');
SELECT throws_ok($$SELECT force_central_authority_approved(pg_temp.lg('59d002'), pg_temp.id('599a02'), 'perdue')$$,
  '42501', NULL, 'action autre : refus');
SELECT throws_ok($$SELECT force_central_authority_approved(pg_temp.lg('59d002'), pg_temp.id('599a03'), 'perdue')$$,
  '42501', NULL, 'approbation d''un autre grand livre : refus');
SELECT throws_ok($$SELECT force_central_authority_approved(pg_temp.lg('59d002'), pg_temp.id('599a04'), 'perdue')$$,
  '42501', NULL, 'demande déjà exécutée : refus');
SELECT pg_temp.b();
SELECT throws_ok($$SELECT force_central_authority_approved(pg_temp.lg('59d002'), pg_temp.id('599a05'), 'perdue')$$,
  'P0002', NULL, 'autre prestataire : no_data_found');
SELECT pg_temp.a();
SELECT is(pg_temp.auth('59d002'), 'EDGE/1', 'les refus n''ont pas bougé l''autorité');
SELECT throws_ok($$SELECT force_central_authority_approved(pg_temp.lg('59d002'), pg_temp.id('599a05'), '')$$,
  '23514', NULL, 'motif vide : refus par force_central_authority');
SELECT is((SELECT direction || '/' || status FROM force_central_authority_approved(pg_temp.lg('59d002'),
  pg_temp.id('599a05'), 'passerelle perdue')), 'TO_CENTRAL/FORCED', 'approbation valide : reprise forcée');
SELECT is(pg_temp.auth('59d002'), 'CENTRAL/2', 'grand livre CENTRAL, époque e+2');
SELECT is((SELECT status FROM edge_gateway WHERE id = pg_temp.id('59e003')), 'REVOKED', 'passerelle REVOKED');
SELECT isnt((SELECT revoked_at FROM edge_gateway WHERE id = pg_temp.id('59e003')), NULL::timestamptz,
  'revoked_at posé par le déclencheur de WP03');
SELECT is(pg_temp.hst('g3'), 'FORCED', 'TO_EDGE FORCED');
SELECT is((SELECT status FROM debit_authority_handover WHERE ledger_id = pg_temp.lg('59d002')
  AND direction = 'TO_CENTRAL'), 'FORCED', 'TO_CENTRAL FORCED');
SELECT is((SELECT approved_by FROM debit_authority_handover WHERE ledger_id = pg_temp.lg('59d002')
  AND direction = 'TO_CENTRAL'), pg_temp.id('59f002'), 'seconde personne = valideur de la demande');
SELECT throws_ok($$SELECT force_central_authority_approved(pg_temp.lg('59d002'), pg_temp.id('599a05'), 'encore')$$,
  'CL013', NULL, 'rejeu de la même approbation : le grand livre n''est plus sous EDGE');
SELECT pg_temp.gw('59e003');
SELECT throws_ok($$SELECT edge_ack_handover(pg_temp.id('59e003'), pg_temp.hid('g3'), 1, 0)$$, '42501', NULL,
  'passerelle révoquée par la reprise : 42501 partout');

-- 8. Non-régression du kit : les S12 gardent leur signature et leur corps ----------------------------------------
SELECT is((SELECT count(*)::int FROM pg_proc WHERE proname IN ('grant_edge_authority','ack_edge_handover',
  'fail_edge_grant','request_edge_release','complete_edge_release','force_central_authority')), 6,
  'les six fonctions S12 existent, une version chacune');
SELECT * FROM finish();
ROLLBACK;
