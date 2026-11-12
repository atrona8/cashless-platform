-- open_offline_anomaly et EDGE_REPLAY_FAILED (migration 0068 ; mission passerelle-locale, lot WP14 ; R-23, décision 46)
-- — pgTAP, écrit à la main. Sous le PROPRIÉTAIRE seulement : aucun SET ROLE (droits posés par WP09, inchangés).
-- Lancer : pg_prove -d <base> tests/tests_edge_replay_anomaly.sql (depuis packages/ledger-sql).
\set ON_ERROR_STOP 1
\set QUIET 1
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

CREATE FUNCTION pg_temp.id(p text) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT ('00000000-0000-0000-0000-' || lpad(p, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.a() RETURNS void LANGUAGE sql AS
  $$ SELECT set_config('app.operator_id', pg_temp.id('68a001')::text, true) $$;
CREATE FUNCTION pg_temp.b() RETURNS void LANGUAGE sql AS
  $$ SELECT set_config('app.operator_id', pg_temp.id('68a002')::text, true) $$;
CREATE FUNCTION pg_temp.code(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE p_sql; RETURN 'OK'; EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE; END $$;

INSERT INTO party (kind, legal_name) SELECT 'PLATFORM', 'Plateforme (test)'
 WHERE NOT EXISTS (SELECT 1 FROM party WHERE kind = 'PLATFORM');
INSERT INTO party (id, kind, legal_name, country_code) VALUES
 (pg_temp.id('68a001'), 'OPERATOR', 'Prestataire A', 'SN'),
 (pg_temp.id('68a002'), 'OPERATOR', 'Prestataire B', 'CI');
INSERT INTO party (id, kind, operator_id, legal_name) VALUES
 (pg_temp.id('68b001'), 'ORGANIZER', pg_temp.id('68a001'), 'Organisateur A'),
 (pg_temp.id('68b011'), 'ORGANIZER', pg_temp.id('68a002'), 'Organisateur B');
INSERT INTO jurisdiction_profile (id, country_code, version, valid_from, breakage_destination)
VALUES (pg_temp.id('68c001'), 'SN', 680068, '2026-01-01', 'ORGANIZER');
INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone, jurisdiction_id, funds_holder)
SELECT pg_temp.id(e), pg_temp.id(o), pg_temp.id(g), 'Événement ' || e, 'XOF', 'Africa/Dakar',
       pg_temp.id('68c001'), 'ORGANIZER'
  FROM (VALUES ('68d001','68a001','68b001'), ('68d011','68a002','68b011')) AS v(e, o, g);
INSERT INTO ledger (id, operator_id, scope_type, scope_id, currency, issuer_id, funds_holder_id) VALUES
 (pg_temp.id('68f001'), pg_temp.id('68a001'), 'EVENT', pg_temp.id('68d001'), 'XOF', pg_temp.id('68b001'), pg_temp.id('68b001')),
 (pg_temp.id('68f011'), pg_temp.id('68a002'), 'EVENT', pg_temp.id('68d011'), 'XOF', pg_temp.id('68b011'), pg_temp.id('68b011'));
INSERT INTO device (id, operator_id, kind, event_id, serial) VALUES
 (pg_temp.id('68aa01'), pg_temp.id('68a001'), 'POS', pg_temp.id('68d001'), 'C68-AA01');
SELECT pg_temp.a();

-- 1. Accepté, avec ses conditions ---------------------------------------------------------------------------
SELECT is(pg_temp.code($$SELECT open_offline_anomaly(pg_temp.id('68f001'), 'EDGE_REPLAY_FAILED', pg_temp.id('68aa01'), NULL, 7, NULL, 4000, 'OPERATOR', '{"origin_key":"C68-AA01:0007","source":"DEVICE_JOURNAL"}', NULL)$$),
  'OK', 'EDGE_REPLAY_FAILED est ouvrable');
SELECT is((SELECT count(*)::int FROM anomaly WHERE kind = 'EDGE_REPLAY_FAILED' AND detail->>'origin_key' = 'C68-AA01:0007'
            AND amount = 4000 AND seq = 7 AND status = 'OPEN' AND loss_bearer = 'OPERATOR'), 1, 'ligne écrite avec montant et porteur');
SELECT is(pg_temp.code($$SELECT open_offline_anomaly(NULL, 'EDGE_REPLAY_FAILED', pg_temp.id('68aa01'), NULL, 8, NULL, 0, 'OPERATOR', '{"origin_key":"x"}', NULL)$$),
  'CL001', 'sans grand livre : CL001');
SELECT is(pg_temp.code($$SELECT open_offline_anomaly(pg_temp.id('68f001'), 'EDGE_REPLAY_FAILED', pg_temp.id('68aa01'), NULL, 8, NULL, 0, NULL, '{"origin_key":"x"}', NULL)$$),
  'CL001', 'sans porteur de la perte : CL001');
SELECT is(pg_temp.code($$SELECT open_offline_anomaly(pg_temp.id('68f001'), 'EDGE_REPLAY_FAILED', pg_temp.id('68aa01'), NULL, 8, NULL, 0, 'OPERATOR', '{"a":1}', NULL)$$),
  'CL001', 'sans clé d''origine : CL001');
SELECT is(pg_temp.code($$SELECT open_offline_anomaly(pg_temp.id('68f001'), 'EDGE_REPLAY_FAILED', pg_temp.id('68aa01'), NULL, 8, NULL, 0, 'OPERATOR', NULL, NULL)$$),
  'CL001', 'sans détail : CL001');
SELECT is(pg_temp.code($$SELECT open_offline_anomaly(pg_temp.id('68f001'), 'EDGE_REPLAY_FAILED', pg_temp.id('68aa01'), NULL, 8, NULL, -1, 'OPERATOR', '{"origin_key":"x"}', NULL)$$),
  'CL001', 'montant négatif : CL001');
SELECT pg_temp.b();
SELECT is(pg_temp.code($$SELECT open_offline_anomaly(pg_temp.id('68f001'), 'EDGE_REPLAY_FAILED', NULL, NULL, 8, NULL, 0, 'OPERATOR', '{"origin_key":"x"}', NULL)$$),
  'P0002', 'grand livre d''un autre prestataire : introuvable');
SELECT pg_temp.a();

-- 2. Idempotence par clé d'origine --------------------------------------------------------------------------
SELECT is((SELECT open_offline_anomaly(pg_temp.id('68f001'), 'EDGE_REPLAY_FAILED', pg_temp.id('68aa01'), NULL, 7, NULL, 4000, 'OPERATOR', '{"origin_key":"C68-AA01:0007"}', NULL)),
  (SELECT id FROM anomaly WHERE kind = 'EDGE_REPLAY_FAILED' AND detail->>'origin_key' = 'C68-AA01:0007'),
  'même clé d''origine : l''anomalie existante est rendue');
SELECT is((SELECT open_offline_anomaly(pg_temp.id('68f001'), 'EDGE_REPLAY_FAILED', pg_temp.id('68aa01'), NULL, 99, NULL, 1, 'ORGANIZER', '{"origin_key":"C68-AA01:0007"}', NULL)),
  (SELECT id FROM anomaly WHERE kind = 'EDGE_REPLAY_FAILED' AND detail->>'origin_key' = 'C68-AA01:0007'),
  'même clé, autre numéro ou montant : toujours la même anomalie');
SELECT is((SELECT count(*)::int FROM anomaly WHERE kind = 'EDGE_REPLAY_FAILED' AND detail->>'origin_key' = 'C68-AA01:0007'), 1,
  'une seule ligne pour la clé');
-- retrouve l'anomalie ouverte par la fonction interne d'EDGE_SYNC (même verrou, même recherche)
SELECT edge_open_replay_failed(pg_temp.id('68f001'), pg_temp.id('68e001'), 3, 'C68-AA01:0009', pg_temp.id('68aa01'), NULL, 9, NULL, 500, 'OPERATOR', 'X', 'm');
SELECT is((SELECT open_offline_anomaly(pg_temp.id('68f001'), 'EDGE_REPLAY_FAILED', pg_temp.id('68aa01'), NULL, 9, NULL, 500, 'OPERATOR', '{"origin_key":"C68-AA01:0009"}', NULL)),
  (SELECT id FROM anomaly WHERE kind = 'EDGE_REPLAY_FAILED' AND detail->>'origin_key' = 'C68-AA01:0009' AND detail->>'source' = 'EDGE_SYNC'),
  'l''anomalie d''EDGE_SYNC pour la même clé est retrouvée');

-- 3. Autres types inchangés ---------------------------------------------------------------------------------
SELECT is(pg_temp.code($$SELECT open_offline_anomaly(pg_temp.id('68f001'), 'CASH_DIFF', NULL, NULL, NULL, NULL, 0, NULL, NULL, NULL)$$),
  'CL001', 'type hors liste : toujours CL001');
SELECT is(pg_temp.code($$SELECT open_offline_anomaly(pg_temp.id('68f001'), 'NON_COMPLIANT_OPERATION', NULL, NULL, NULL, NULL, 0, NULL, NULL, NULL)$$),
  'CL001', 'NON_COMPLIANT_OPERATION sans porteur : toujours CL001');
SELECT is(pg_temp.code($$SELECT open_offline_anomaly(pg_temp.id('68f001'), 'CLOCK_SKEW', pg_temp.id('68aa01'), NULL, 5, NULL, 0, NULL, '{"k":1}', NULL)$$),
  'OK', 'CLOCK_SKEW toujours ouvrable');
SELECT is((SELECT open_offline_anomaly(pg_temp.id('68f001'), 'CLOCK_SKEW', pg_temp.id('68aa01'), NULL, 5, NULL, 0, NULL, '{"k":2}', NULL)),
  (SELECT id FROM anomaly WHERE kind = 'CLOCK_SKEW' AND device_id = pg_temp.id('68aa01') AND seq = 5),
  'idempotence (type, terminal, numéro, transaction) inchangée pour les autres types');
SELECT is((SELECT count(*)::int FROM anomaly WHERE kind = 'CLOCK_SKEW' AND device_id = pg_temp.id('68aa01') AND seq = 5), 1,
  'une seule ligne CLOCK_SKEW');

-- 4. Droits inchangés ---------------------------------------------------------------------------------------
SELECT is(has_function_privilege('cashless_app', 'open_offline_anomaly(uuid,text,uuid,uuid,bigint,uuid,bigint,text,jsonb,uuid)', 'EXECUTE'),
  true, 'cashless_app garde EXECUTE (accord de WP09)');
SELECT is(has_function_privilege('public', 'open_offline_anomaly(uuid,text,uuid,uuid,bigint,uuid,bigint,text,jsonb,uuid)', 'EXECUTE'),
  false, 'PUBLIC sans EXECUTE');
SELECT is(has_function_privilege('cashless_app', 'edge_open_replay_failed(uuid,uuid,bigint,text,uuid,uuid,bigint,uuid,bigint,text,text,text)', 'EXECUTE'),
  false, 'edge_open_replay_failed reste inaccordée à cashless_app');

SELECT * FROM finish();
ROLLBACK;
