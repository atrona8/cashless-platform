-- Registre des décisions, lots d'idempotence et garde EDGE_SYNC (migration 0060 ; mission passerelle-locale, lot
-- WP05 ; FR-012, FR-013) — pgTAP, écrit à la main, SOUS LE PROPRIETAIRE (les droits sont en WP09).
-- Lancer depuis packages/ledger-sql : pg_prove -d <base> tests/tests_edge_sync.sql
-- Limites : une session pgTAP ne prouve pas la concurrence (deux lots simultanés : WP25) ; la garde sous
-- `cashless_app` est prouvée par SET SESSION AUTHORIZATION (le poste de test est superutilisateur) ; la preuve à
-- connexion réelle est celle de WP09 (T040).
\set ON_ERROR_STOP 1
\set QUIET 1
BEGIN;
\ir _grants_for_tests.sql
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

CREATE FUNCTION pg_temp.id(p text) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT ('00000000-0000-0000-0000-' || lpad(p, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.a() RETURNS void LANGUAGE sql AS
  $$ SELECT set_config('app.operator_id', pg_temp.id('60a001')::text, true) $$;
CREATE FUNCTION pg_temp.b() RETURNS void LANGUAGE sql AS
  $$ SELECT set_config('app.operator_id', pg_temp.id('60a002')::text, true) $$;
CREATE FUNCTION pg_temp.gw(p text) RETURNS void LANGUAGE sql AS
  $$ SELECT set_config('app.gateway_id', pg_temp.id(p)::text, true) $$;
CREATE FUNCTION pg_temp.c(p int) RETURNS bytea LANGUAGE sql IMMUTABLE AS
  $$ SELECT sha256(convert_to('contenu-' || p, 'UTF8')) $$;
CREATE FUNCTION pg_temp.sha(p text) RETURNS bytea LANGUAGE sql IMMUTABLE AS
  $$ SELECT sha256(convert_to(p, 'UTF8')) $$;
CREATE FUNCTION pg_temp.ledger_of(p text) RETURNS uuid LANGUAGE sql AS
  $$ SELECT id FROM ledger WHERE scope_type = 'EVENT' AND scope_id = pg_temp.id(p) $$;

-- Données (propriétaire) ----------------------------------------------------------------------------------
INSERT INTO party (kind, legal_name) SELECT 'PLATFORM', 'Plateforme (test)'
 WHERE NOT EXISTS (SELECT 1 FROM party WHERE kind = 'PLATFORM');
INSERT INTO party (id, kind, legal_name, country_code) VALUES
 (pg_temp.id('60a001'), 'OPERATOR', 'Prestataire A', 'SN'),
 (pg_temp.id('60a002'), 'OPERATOR', 'Prestataire B', 'CI');
INSERT INTO party (id, kind, operator_id, legal_name) VALUES
 (pg_temp.id('60b001'), 'ORGANIZER', pg_temp.id('60a001'), 'Organisateur A'),
 (pg_temp.id('60b011'), 'ORGANIZER', pg_temp.id('60a002'), 'Organisateur B');
INSERT INTO jurisdiction_profile (id, country_code, version, valid_from, breakage_destination)
VALUES (pg_temp.id('60c001'), 'SN', 600060, '2026-01-01', 'ORGANIZER');
INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone, jurisdiction_id, funds_holder, status)
SELECT pg_temp.id(e), pg_temp.id(o), pg_temp.id(g), 'Evénement ' || e, 'XOF', 'Africa/Dakar',
       pg_temp.id('60c001'), 'ORGANIZER', 'LIVE'::event_status
  FROM (VALUES ('60d001','60a001','60b001'), ('60d002','60a001','60b001'), ('60d003','60a001','60b001'),
               ('60d004','60a001','60b001'), ('60d005','60a001','60b001'), ('60d006','60a001','60b001'),
               ('60d007','60a001','60b001'), ('60d011','60a002','60b011')) AS v(e, o, g);
SELECT pg_temp.a();
SELECT open_event_ledger(pg_temp.id(e))
  FROM (VALUES ('60d001'), ('60d002'), ('60d003'), ('60d004'), ('60d005'), ('60d006'), ('60d007')) AS v(e);
SELECT pg_temp.b();
SELECT open_event_ledger(pg_temp.id('60d011'));
SELECT pg_temp.a();

-- Passerelles : P1 (cas nominal), RV (révoquée), SB (STANDBY), NH (sans handover), OT (handover d'une autre),
-- OT2 (porteuse du handover), FL (handover FAILED), RL (vidange), B1 (prestataire B).
INSERT INTO edge_gateway (id, operator_id, event_id, serial, role) VALUES
 (pg_temp.id('60e001'), pg_temp.id('60a001'), pg_temp.id('60d001'), 'P1', 'PRIMARY'),
 (pg_temp.id('60e002'), pg_temp.id('60a001'), pg_temp.id('60d002'), 'RV', 'PRIMARY'),
 (pg_temp.id('60e003'), pg_temp.id('60a001'), pg_temp.id('60d003'), 'SB', 'STANDBY'),
 (pg_temp.id('60e004'), pg_temp.id('60a001'), pg_temp.id('60d004'), 'NH', 'PRIMARY'),
 (pg_temp.id('60e005'), pg_temp.id('60a001'), pg_temp.id('60d005'), 'OT', 'PRIMARY'),
 (pg_temp.id('60e006'), pg_temp.id('60a001'), pg_temp.id('60d005'), 'OT2', 'STANDBY'),
 (pg_temp.id('60e007'), pg_temp.id('60a001'), pg_temp.id('60d006'), 'FL', 'PRIMARY'),
 (pg_temp.id('60e008'), pg_temp.id('60a001'), pg_temp.id('60d007'), 'RL', 'PRIMARY'),
 (pg_temp.id('60e011'), pg_temp.id('60a002'), pg_temp.id('60d011'), 'B1', 'PRIMARY');
INSERT INTO debit_authority_handover (operator_id, ledger_id, edge_gateway_id, direction, status, epoch,
                                      watermark_posting_id, requested_by)
SELECT CASE WHEN g = '60e011' THEN pg_temp.id('60a002') ELSE pg_temp.id('60a001') END,
       pg_temp.ledger_of(e), pg_temp.id(g), 'TO_EDGE', s, 1, 0, pg_temp.id('60f001')
  FROM (VALUES ('60e001','60d001','ACTIVE'), ('60e002','60d002','ACTIVE'), ('60e003','60d003','ACTIVE'),
               ('60e006','60d005','ACTIVE'), ('60e007','60d006','FAILED'), ('60e008','60d007','ACTIVE'),
               ('60e011','60d011','ACTIVE')) AS v(g, e, s);
INSERT INTO debit_authority_handover (operator_id, ledger_id, edge_gateway_id, direction, status, epoch,
                                      edge_handover_id, requested_by)
SELECT pg_temp.id('60a001'), h.ledger_id, h.edge_gateway_id, 'TO_CENTRAL', 'RELEASING', 1, h.id, pg_temp.id('60f001')
  FROM debit_authority_handover h WHERE h.edge_gateway_id = pg_temp.id('60e008');
UPDATE edge_gateway SET status = 'REVOKED' WHERE id = pg_temp.id('60e002');

-- 1. Catalogue : tables et fonctions --------------------------------------------------------------------------
SELECT is((SELECT count(*)::int FROM pg_class WHERE relname IN ('edge_sync_batch','edge_sync_batch_result')
            AND relrowsecurity AND relforcerowsecurity), 2, 'RLS activée ET forcée sur les deux nouvelles tables');
SELECT is((SELECT count(*)::int FROM pg_policies WHERE policyname = 'tenant_isolation'
            AND tablename IN ('edge_sync_batch','edge_sync_batch_result')), 2, 'politique tenant_isolation sur les deux');
SELECT is((SELECT count(*)::int FROM pg_proc WHERE proname IN ('edge_record_seq','edge_sync_batch_begin',
            'edge_sync_batch_result','edge_sync_batch_finish') AND prosecdef
            AND proconfig @> ARRAY['search_path=public, pg_temp']), 4,
  'les quatre fonctions : SECURITY DEFINER et search_path = public, pg_temp');
SELECT is((SELECT count(*)::int FROM pg_proc WHERE proname IN ('edge_record_seq','edge_sync_batch_begin',
            'edge_sync_batch_result','edge_sync_batch_finish','edge_assert_session_gateway','edge_ledger_of_gateway')
            AND has_function_privilege('public', oid, 'EXECUTE')), 0, 'aucune fonction exécutable par PUBLIC');
SELECT ok((SELECT proconfig @> ARRAY['search_path=public, pg_temp'] AND prosecdef FROM pg_proc
            WHERE proname = 'post_transaction'), 'post_transaction : SECURITY DEFINER et search_path = public, pg_temp');

-- 2. Registre : VOID --------------------------------------------------------------------------------------------
SELECT pg_temp.gw('60e001');
SELECT lives_ok($$SELECT edge_record_seq(pg_temp.id('60e001'), 1, 'T1:1', pg_temp.c(1), 'VOID', NULL, 'ONLINE_REF')$$,
  'VOID sans transaction_id : accepté');
SELECT is((SELECT outcome FROM edge_sync_registry WHERE gateway_id = pg_temp.id('60e001') AND edge_seq = 1), 'VOID',
  'VOID inscrit au registre');
SELECT throws_ok($$INSERT INTO edge_sync_registry (operator_id, gateway_id, edge_seq, origin_key, content_sha256,
   chain_hash, outcome, transaction_id) VALUES (pg_temp.id('60a001'), pg_temp.id('60e001'), 90, 'T1:90',
   pg_temp.c(90), pg_temp.c(90), 'VOID', gen_random_uuid())$$, '23514', NULL, 'VOID avec transaction_id refusé');
SELECT throws_ok($$INSERT INTO edge_sync_registry (operator_id, gateway_id, edge_seq, origin_key, content_sha256,
   chain_hash, outcome, reason, transaction_id) VALUES (pg_temp.id('60a001'), pg_temp.id('60e001'), 91, 'T1:91',
   pg_temp.c(91), pg_temp.c(91), 'REJECTED', 'x', gen_random_uuid())$$, '23514', NULL,
  'REJECTED avec transaction_id refusé (contrainte du kit conservée)');
SELECT throws_ok($$INSERT INTO edge_sync_registry (operator_id, gateway_id, edge_seq, origin_key, content_sha256,
   chain_hash, outcome) VALUES (pg_temp.id('60a001'), pg_temp.id('60e001'), 92, 'T1:92',
   pg_temp.c(92), pg_temp.c(92), 'DUPLICATE')$$, '23514', NULL, 'DUPLICATE sans transaction_id refusé (conservée)');
SELECT throws_ok($$INSERT INTO edge_sync_registry (operator_id, gateway_id, edge_seq, origin_key, content_sha256,
   chain_hash, outcome) VALUES (pg_temp.id('60a001'), pg_temp.id('60e001'), 93, 'T1:93',
   pg_temp.c(93), pg_temp.c(93), 'WAIVED')$$, '23514', NULL, 'WAIVED non admise');
SELECT throws_ok($$UPDATE edge_sync_registry SET outcome = 'ACCEPTED' WHERE gateway_id = pg_temp.id('60e001')$$,
  NULL, NULL, 'mutation du registre refusée');
SELECT throws_ok($$DELETE FROM edge_sync_registry WHERE gateway_id = pg_temp.id('60e001')$$,
  NULL, NULL, 'suppression au registre refusée');

-- 3. Ordre et chaîne --------------------------------------------------------------------------------------------
SELECT throws_ok($$SELECT edge_record_seq(pg_temp.id('60e001'), 3, 'T1:3', pg_temp.c(3), 'ACCEPTED', NULL, NULL)$$,
  'CL016', NULL, 'saut de numéro : CL016');
SELECT lives_ok($$SELECT edge_record_seq(pg_temp.id('60e001'), 2, 'T1:2', pg_temp.c(2), 'REJECTED', NULL, 'SOLDE')$$,
  'numéro 2 : REJECTED avec raison, sans transaction');
SELECT lives_ok($$SELECT edge_record_seq(pg_temp.id('60e001'), 3, 'T1:3', pg_temp.c(3), 'ACCEPTED', NULL, NULL)$$,
  'numéro 3');
SELECT lives_ok($$SELECT edge_record_seq(pg_temp.id('60e001'), 2, 'T1:2', pg_temp.c(2), 'REJECTED', NULL, 'SOLDE')$$,
  'rejeu exact accepté');
SELECT throws_ok($$SELECT edge_record_seq(pg_temp.id('60e001'), 2, 'T1:2', pg_temp.c(99), 'REJECTED', NULL, 'SOLDE')$$,
  'CL002', NULL, 'même numéro, autre contenu : CL002');
SELECT throws_ok($$SELECT edge_record_seq(pg_temp.id('60e001'), 4, 'T1:3', pg_temp.c(4), 'ACCEPTED', NULL, NULL)$$,
  '23505', NULL, 'origin_key déjà connue avec un autre numéro : unicité');
SELECT is((SELECT last_chain_hash FROM edge_gateway WHERE id = pg_temp.id('60e001')),
  sha256(sha256(sha256(edge_chain_genesis(pg_temp.id('60e001')) || pg_temp.c(1)) || pg_temp.c(2)) || pg_temp.c(3)),
  'après trois numéros : last_chain_hash = SHA-256 itéré depuis le départ (calcul indépendant)');
SELECT is((SELECT contiguous_edge_seq FROM edge_gateway WHERE id = pg_temp.id('60e001')), 3::bigint,
  'contiguous_edge_seq = 3 (l''échec CL016 n''a rien consommé)');
SELECT is((SELECT count(*)::int FROM edge_sync_registry WHERE gateway_id = pg_temp.id('60e001')), 3,
  'trois lignes de registre exactement');

-- 4. edge_record_seq : refus -----------------------------------------------------------------------------------
SELECT pg_temp.gw('60e002');
SELECT throws_ok($$SELECT edge_record_seq(pg_temp.id('60e002'), 1, 'RV:1', pg_temp.c(1), 'ACCEPTED', NULL, NULL)$$,
  'CL013', NULL, 'passerelle REVOKED (même avec un handover ACTIVE) : refusé');
SELECT pg_temp.gw('60e003');
SELECT throws_ok($$SELECT edge_record_seq(pg_temp.id('60e003'), 1, 'SB:1', pg_temp.c(1), 'ACCEPTED', NULL, NULL)$$,
  'CL013', NULL, 'passerelle STANDBY (même avec un handover ACTIVE) : refusé');
SELECT pg_temp.gw('60e004');
SELECT throws_ok($$SELECT edge_record_seq(pg_temp.id('60e004'), 1, 'NH:1', pg_temp.c(1), 'ACCEPTED', NULL, NULL)$$,
  'CL013', NULL, 'sans handover : refusé');
SELECT pg_temp.gw('60e005');
SELECT throws_ok($$SELECT edge_record_seq(pg_temp.id('60e005'), 1, 'OT:1', pg_temp.c(1), 'ACCEPTED', NULL, NULL)$$,
  'CL013', NULL, 'handover d''une AUTRE passerelle du même grand livre : refusé');
SELECT pg_temp.gw('60e007');
SELECT throws_ok($$SELECT edge_record_seq(pg_temp.id('60e007'), 1, 'FL:1', pg_temp.c(1), 'ACCEPTED', NULL, NULL)$$,
  'CL013', NULL, 'handover FAILED : refusé');
SELECT pg_temp.gw('60e001');
SELECT throws_ok($$SELECT edge_record_seq(pg_temp.id('60e004'), 1, 'NH:1', pg_temp.c(1), 'ACCEPTED', NULL, NULL)$$,
  '42501', NULL, 'p_gateway différent de app.gateway_id : 42501');
SELECT set_config('app.gateway_id', '', true);
SELECT throws_ok($$SELECT edge_record_seq(pg_temp.id('60e001'), 4, 'T1:4', pg_temp.c(4), 'ACCEPTED', NULL, NULL)$$,
  '42501', NULL, 'app.gateway_id absent : 42501');
SELECT is((SELECT count(*)::int FROM edge_sync_registry WHERE gateway_id <> pg_temp.id('60e001')), 0,
  'aucun refus n''a laissé de ligne de registre');
SELECT pg_temp.gw('60e008');
SELECT lives_ok($$SELECT edge_record_seq(pg_temp.id('60e008'), 1, 'RL:1', pg_temp.c(1), 'ACCEPTED', NULL, NULL)$$,
  'vidange (TO_CENTRAL RELEASING) : acceptée');
SELECT pg_temp.b();
SELECT pg_temp.gw('60e011');
SELECT lives_ok($$SELECT edge_record_seq(pg_temp.id('60e011'), 1, 'B1:1', pg_temp.c(1), 'ACCEPTED', NULL, NULL)$$,
  'prestataire B sur sa propre passerelle : accepté');
SELECT pg_temp.a();
SELECT throws_ok($$SELECT edge_record_seq(pg_temp.id('60e011'), 2, 'B1:2', pg_temp.c(2), 'ACCEPTED', NULL, NULL)$$,
  'P0002', NULL, 'passerelle d''un autre prestataire : no_data_found');

-- 5. Lots : begin, idempotence, un seul en vol, abandon (A29) ----------------------------------------------------
SELECT pg_temp.gw('60e001');
SELECT is((SELECT state || '/' || already_done FROM edge_sync_batch_begin(pg_temp.id('60e001'), pg_temp.id('600b01'),
   1, 1, 5, pg_temp.sha('req-1'))), 'PROCESSING/false', 'nouveau lot : PROCESSING, pas déjà fait');
SELECT is((SELECT count(*)::int FROM edge_sync_batch WHERE batch_id = pg_temp.id('600b01')
            AND ledger_id = pg_temp.ledger_of('60d001') AND operator_id = pg_temp.id('60a001')), 1,
  'lot inscrit avec son grand livre et son prestataire');
SELECT is((SELECT state || '/' || already_done FROM edge_sync_batch_begin(pg_temp.id('60e001'), pg_temp.id('600b01'),
   1, 1, 5, pg_temp.sha('req-1'))), 'PROCESSING/false', 'même lot, même empreinte, en vol : rend l''état');
SELECT throws_ok($$SELECT * FROM edge_sync_batch_begin(pg_temp.id('60e001'), pg_temp.id('600b01'), 1, 1, 5,
   pg_temp.sha('req-AUTRE'))$$, 'CL002', NULL, 'même batch_id, autre empreinte : CL002');
SELECT throws_ok($$SELECT * FROM edge_sync_batch_begin(pg_temp.id('60e001'), pg_temp.id('600b01'), 1, 1, 6,
   pg_temp.sha('req-1'))$$, 'CL002', NULL, 'même batch_id, autre intervalle : CL002');
SELECT throws_ok($$SELECT * FROM edge_sync_batch_begin(pg_temp.id('60e001'), pg_temp.id('600b02'), 1, 6, 8,
   pg_temp.sha('req-2'))$$, 'CL010', NULL, 'second lot en vol pour la passerelle : CL010');
SELECT throws_ok($$SELECT * FROM edge_sync_batch_begin(pg_temp.id('60e004'), pg_temp.id('600b03'), 1, 1, 2,
   pg_temp.sha('req-3'))$$, '42501', NULL, 'p_gateway différent de la session : 42501');
SELECT throws_ok($$SELECT * FROM edge_sync_batch_begin(pg_temp.id('60e001'), pg_temp.id('600b04'), 1, 1, 502,
   pg_temp.sha('req-4'))$$, 'CL001', NULL, 'plus de 500 opérations : CL001');
SELECT throws_ok($$SELECT * FROM edge_sync_batch_begin(pg_temp.id('60e001'), pg_temp.id('600b04'), 1, 5, 3,
   pg_temp.sha('req-4'))$$, 'CL001', NULL, 'intervalle inversé (to < from - 1) : CL001');
SELECT throws_ok($$SELECT * FROM edge_sync_batch_begin(pg_temp.id('60e001'), pg_temp.id('600b04'), 1, 1, 2,
   '\x0102'::bytea)$$, 'CL001', NULL, 'empreinte de 2 octets : CL001');
-- Résultats : hors intervalle, idempotence, contenu différent
SELECT throws_ok($$SELECT edge_sync_batch_result(pg_temp.id('600b01'), 6, 'ACCEPTED', NULL, NULL, NULL, false)$$,
  'CL001', NULL, 'edge_seq hors de l''intervalle du lot : CL001');
SELECT lives_ok($$SELECT edge_sync_batch_result(pg_temp.id('600b01'), 1, 'VOID', 'ONLINE_REF', NULL, NULL, false)$$,
  'résultat 1');
SELECT lives_ok($$SELECT edge_sync_batch_result(pg_temp.id('600b01'), 1, 'VOID', 'ONLINE_REF', NULL, NULL, false)$$,
  'résultat rejoué à l''identique : accepté');
SELECT is((SELECT count(*)::int FROM edge_sync_batch_result WHERE batch_id = pg_temp.id('600b01')), 1,
  'le rejeu n''a pas dupliqué la ligne');
SELECT throws_ok($$SELECT edge_sync_batch_result(pg_temp.id('600b01'), 1, 'REJECTED', 'SOLDE', NULL, NULL, true)$$,
  'CL002', NULL, 'résultat rejoué différent : CL002');
SELECT throws_ok($$SELECT edge_sync_batch_result(pg_temp.id('600b01'), 2, 'REJECTED', 'SOLDE', NULL, gen_random_uuid(), true)$$,
  NULL, NULL, 'REJECTED avec transaction : refusé (clé étrangère ou contrainte)');
SELECT throws_ok($$SELECT edge_sync_batch_result(pg_temp.id('600b01'), 2, 'WAIVED', NULL, NULL, NULL, false)$$,
  'CL001', NULL, 'issue inconnue : CL001');
SELECT throws_ok($$UPDATE edge_sync_batch_result SET outcome = 'ACCEPTED' WHERE batch_id = pg_temp.id('600b01')$$,
  NULL, NULL, 'mutation d''un résultat de lot refusée');
SELECT throws_ok($$SELECT edge_sync_batch_result(pg_temp.id('600b99'), 1, 'VOID', NULL, NULL, NULL, false)$$,
  'P0002', NULL, 'lot inconnu : no_data_found');
-- Clôture
SELECT throws_ok($$SELECT edge_sync_batch_finish(pg_temp.id('600b01'), 'PROCESSING')$$, 'CL001', NULL,
  'finish : seulement DONE ou ABANDONED');
SELECT throws_ok($$SELECT edge_sync_batch_finish(pg_temp.id('600b01'), 'DONE')$$, 'CL001', NULL,
  'DONE refusé tant que des numéros n''ont pas de résultat');
-- Lot abandonné après 15 minutes (le déclencheur interdit de toucher received_at : on le suspend dans la suite).
ALTER TABLE edge_sync_batch DISABLE TRIGGER edge_sync_batch_guard;
UPDATE edge_sync_batch SET received_at = clock_timestamp() - interval '16 minutes' WHERE batch_id = pg_temp.id('600b01');
ALTER TABLE edge_sync_batch ENABLE TRIGGER edge_sync_batch_guard;
SELECT is((SELECT state || '/' || already_done FROM edge_sync_batch_begin(pg_temp.id('60e001'), pg_temp.id('600b05'),
   1, 2, 6, pg_temp.sha('req-5'))), 'PROCESSING/false',
  'lot en vol de plus de 15 minutes : abandonné, le suivant s''ouvre (A29)');
SELECT is((SELECT status FROM edge_sync_batch WHERE batch_id = pg_temp.id('600b01')), 'ABANDONED',
  'l''ancien lot est ABANDONED');
SELECT isnt((SELECT completed_at FROM edge_sync_batch WHERE batch_id = pg_temp.id('600b01')), NULL::timestamptz,
  'completed_at posé à l''abandon');
SELECT is((SELECT count(*)::int FROM edge_sync_batch_result WHERE batch_id = pg_temp.id('600b01')), 1,
  'résultats partiels conservés');
SELECT is((SELECT state || '/' || already_done FROM edge_sync_batch_begin(pg_temp.id('60e001'), pg_temp.id('600b01'),
   1, 1, 5, pg_temp.sha('req-1'))), 'ABANDONED/false', 'rejouer le batch_id abandonné rend ABANDONED, pas DONE');
SELECT throws_ok($$SELECT edge_sync_batch_result(pg_temp.id('600b01'), 2, 'VOID', NULL, NULL, NULL, false)$$,
  'CL001', NULL, 'aucun résultat nouveau sur un lot abandonné');
SELECT throws_ok($$SELECT edge_sync_batch_finish(pg_temp.id('600b01'), 'DONE')$$, 'CL001', NULL,
  'un lot abandonné ne devient jamais DONE');
-- Reprise sous un NOUVEAU batch_id, numéros continus : 600b05 couvre 2..6 (le numéro 1 est déjà fait)
SELECT lives_ok($$SELECT edge_sync_batch_result(pg_temp.id('600b05'), n, 'VOID', 'ONLINE_REF', NULL, NULL, false)
   FROM generate_series(2, 5) AS n$$, 'résultats 2 à 5 du nouveau lot');
SELECT throws_ok($$SELECT edge_sync_batch_finish(pg_temp.id('600b05'), 'DONE')$$, 'CL001', NULL,
  'DONE refusé : il manque le résultat du numéro 6');
SELECT lives_ok($$SELECT edge_sync_batch_result(pg_temp.id('600b05'), 6, 'VOID', 'ONLINE_REF', NULL, NULL, false)$$,
  'résultat 6');
SELECT lives_ok($$SELECT edge_sync_batch_finish(pg_temp.id('600b05'), 'DONE')$$, 'DONE accepté, tous les résultats présents');
SELECT lives_ok($$SELECT edge_sync_batch_finish(pg_temp.id('600b05'), 'DONE')$$, 'finish rejoué : sans effet');
SELECT throws_ok($$SELECT edge_sync_batch_finish(pg_temp.id('600b05'), 'ABANDONED')$$, 'CL001', NULL,
  'un lot DONE ne devient pas ABANDONED');
SELECT is((SELECT state || '/' || already_done FROM edge_sync_batch_begin(pg_temp.id('60e001'), pg_temp.id('600b05'),
   1, 2, 6, pg_temp.sha('req-5'))), 'DONE/true', 'lot DONE rejoué : already_done = true');
SELECT throws_ok($$UPDATE edge_sync_batch SET status = 'PROCESSING', completed_at = NULL
   WHERE batch_id = pg_temp.id('600b05')$$, 'CL001', NULL, 'un lot clos ne se rouvre pas');
SELECT throws_ok($$UPDATE edge_sync_batch SET epoch = 9 WHERE batch_id = pg_temp.id('600b01')$$, 'CL001', NULL,
  'les colonnes d''un lot ne changent pas');
SELECT throws_ok($$DELETE FROM edge_sync_batch WHERE batch_id = pg_temp.id('600b05')$$, 'CL001', NULL,
  'un lot ne se supprime pas');
SELECT lives_ok($$SELECT * FROM edge_sync_batch_begin(pg_temp.id('60e001'), pg_temp.id('600b06'), 1, 7, 9,
   pg_temp.sha('req-6'))$$, 'après DONE, un nouveau lot s''ouvre');
-- Isolation
SELECT pg_temp.b();
SELECT throws_ok($$SELECT edge_sync_batch_finish(pg_temp.id('600b06'), 'ABANDONED')$$, 'P0002', NULL,
  'autre prestataire (et autre passerelle) : lot invisible, no_data_found');
SELECT pg_temp.a();
SELECT pg_temp.gw('60e008');
SELECT throws_ok($$SELECT edge_sync_batch_result(pg_temp.id('600b06'), 7, 'VOID', NULL, NULL, NULL, false)$$,
  'P0002', NULL, 'lot d''une autre passerelle du même prestataire : no_data_found');

-- 6. Garde EDGE_SYNC de post_transaction -----------------------------------------------------------------------
INSERT INTO ledger (id, operator_id, scope_type, scope_id, currency, issuer_id, funds_holder_id)
VALUES (pg_temp.id('60aa01'), pg_temp.id('60a001'), 'EVENT', gen_random_uuid(), 'XOF', pg_temp.id('60b001'),
        pg_temp.id('60b001'));
INSERT INTO account (id, operator_id, ledger_id, code, family, purpose, owner_party_id, normal_side, allow_negative)
VALUES (pg_temp.id('60ab01'), pg_temp.id('60a001'), pg_temp.id('60aa01'), 'A-PSP-G', 'ASSET', 'PSP', NULL, 'D', false),
       (pg_temp.id('60ab02'), pg_temp.id('60a001'), pg_temp.id('60aa01'), 'L-WAL-G-P', 'CLAIM', 'WALLET_PAID', NULL, 'C', false);
CREATE FUNCTION pg_temp.post(p_src text, p_key text) RETURNS uuid LANGUAGE sql AS $$
  SELECT post_transaction(pg_temp.id('60aa01'), 'TOPUP', p_key, clock_timestamp(), p_src,
    jsonb_build_array(jsonb_build_object('account_id', pg_temp.id('60ab01'), 'amount', 100),
                      jsonb_build_object('account_id', pg_temp.id('60ab02'), 'amount', -100)),
    NULL, NULL, pg_temp.id('60f001'), pg_temp.id('60f002')) $$;
SELECT lives_ok($$SELECT pg_temp.post('EDGE_SYNC', 'g:owner:edge')$$,
  'EDGE_SYNC sous le propriétaire : passe encore (le test du kit tests_grand_livre_cashless.sql:118 reste vert)');
SELECT lives_ok(format($$SELECT pg_temp.post(%L, %L)$$, s, 'g:owner:' || s), 'source ' || s || ' sous le propriétaire : inchangée')
  FROM unnest(ARRAY['ONLINE','OFFLINE_SYNC','PSP_WEBHOOK','BATCH','BACKOFFICE']) AS s;
SELECT ok(session_user = current_user, 'la suite tourne sous le propriétaire (session_user = current_user)');
SELECT ok((SELECT prosrc FROM pg_proc WHERE proname = 'post_transaction') LIKE '%session_user = current_user OR session_user = ''cashless_edge''%',
  'la garde est une liste d''autorisation sur session_user');
-- Sous la connexion cashless_app (SET SESSION AUTHORIZATION change session_user ; SET ROLE ne le change pas)
SET SESSION AUTHORIZATION cashless_app;
SELECT set_config('app.operator_id', '00000000-0000-0000-0000-00000060a001', true);
SELECT is(session_user::text, 'cashless_app', 'connexion simulée : session_user = cashless_app');
SELECT throws_ok($Q$SELECT post_transaction('00000000-0000-0000-0000-00000060aa01','TOPUP','g:app:edge',now(),'EDGE_SYNC','[{"account_id":"00000000-0000-0000-0000-00000060ab01","amount":100},{"account_id":"00000000-0000-0000-0000-00000060ab02","amount":-100}]')$Q$, '42501', NULL,
  'EDGE_SYNC sous cashless_app : refusée (42501)');
SELECT lives_ok($Q$SELECT post_transaction('00000000-0000-0000-0000-00000060aa01','TOPUP','g:app:online',now(),'ONLINE','[{"account_id":"00000000-0000-0000-0000-00000060ab01","amount":100},{"account_id":"00000000-0000-0000-0000-00000060ab02","amount":-100}]')$Q$,
  'la même écriture en ONLINE sous cashless_app : passe');
RESET SESSION AUTHORIZATION;
SELECT is((SELECT count(*)::int FROM journal_transaction WHERE idempotency_key = 'g:app:edge'), 0,
  'le refus n''a rien écrit');

SELECT * FROM finish();
ROLLBACK;
