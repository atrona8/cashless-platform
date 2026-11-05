-- Lots hors ligne, trace RETRY, résultats d'opération, import du journal (migration 0046 ; mission
-- hors-ligne-snapshots-lots, lot WP05 ; FR-015, FR-016, FR-029 à FR-035, NFR-012 ; ADR-139) — pgTAP, écrit à la
-- main. Sous le PROPRIÉTAIRE seulement : aucun SET ROLE (les droits sont posés par le lot WP08).
-- Lancer : pg_prove -d <base> tests/tests_offline_batches.sql (base créée par les migrations).
\set ON_ERROR_STOP 1
\set QUIET 1
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

CREATE FUNCTION pg_temp.id(p text) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT ('00000000-0000-0000-0000-' || lpad(p, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.a() RETURNS void LANGUAGE sql AS
  $$ SELECT set_config('app.operator_id', pg_temp.id('46a001')::text, true) $$;
CREATE FUNCTION pg_temp.b() RETURNS void LANGUAGE sql AS
  $$ SELECT set_config('app.operator_id', pg_temp.id('46a002')::text, true) $$;
-- Empreintes d'opérations et chaîne : op<seq>, chaîne depuis la genèse du terminal ou d'une empreinte donnée
CREATE FUNCTION pg_temp.hs(p_from bigint, p_n int) RETURNS bytea[] LANGUAGE sql IMMUTABLE AS
  $$ SELECT array_agg(sha256(convert_to('op' || s, 'UTF8')) ORDER BY s) FROM generate_series(p_from, p_from + p_n - 1) s $$;
CREATE FUNCTION pg_temp.chain_to(p_prev bytea, p_hs bytea[]) RETURNS bytea LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE e bytea := p_prev; h bytea;
BEGIN FOREACH h IN ARRAY p_hs LOOP e := chain_step(e, h); END LOOP; RETURN e; END $$;
-- Chaîne du central après les numéros 1..p_upto d'un terminal (op<seq>)
CREATE FUNCTION pg_temp.chain_after(p_dev uuid, p_upto bigint) RETURNS bytea LANGUAGE sql AS
  $$ SELECT CASE WHEN p_upto = 0 THEN device_chain_genesis(p_dev) ELSE pg_temp.chain_to(device_chain_genesis(p_dev), pg_temp.hs(1, p_upto::int)) END $$;
-- Ouvre un lot p_from..p_from+n-1 bien chaîné (empreintes op<seq>) par la voie ordinaire
CREATE FUNCTION pg_temp.ob(p_batch uuid, p_dev uuid, p_ledger uuid, p_from bigint, p_n int) RETURNS offline_batch
LANGUAGE sql AS $$
  SELECT open_offline_batch(p_batch, p_dev, p_ledger, p_from, pg_temp.chain_after(p_dev, p_from - 1),
         pg_temp.hs(p_from, p_n), pg_temp.chain_to(pg_temp.chain_after(p_dev, p_from - 1), pg_temp.hs(p_from, p_n)),
         '\x01') $$;
CREATE FUNCTION pg_temp.ib(p_imp uuid, p_batch uuid, p_dev uuid, p_from bigint, p_n int) RETURNS offline_batch
LANGUAGE sql AS $$
  SELECT open_imported_batch(p_imp, p_batch, p_from, pg_temp.chain_after(p_dev, p_from - 1),
         pg_temp.hs(p_from, p_n), pg_temp.chain_to(pg_temp.chain_after(p_dev, p_from - 1), pg_temp.hs(p_from, p_n)),
         '\x01') $$;
-- Résultat final au registre (canal ONLINE) pour un numéro d'un terminal
CREATE FUNCTION pg_temp.rec(p_dev uuid, p_seq bigint) RETURNS void LANGUAGE sql AS
  $$ SELECT record_device_seq(p_dev, p_seq, sha256(convert_to('op' || p_seq, 'UTF8')), 'ACCEPTED', 'ONLINE') $$;
-- SQLSTATE d'une instruction ('OK' si elle passe)
CREATE FUNCTION pg_temp.code(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE p_sql; RETURN 'OK'; EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE; END $$;

-- Données (propriétaire) --------------------------------------------------------------------------------
-- A : événements ea1 (grand livre la1), ea2 (la2). B : événement eb1 (lb1).
INSERT INTO party (kind, legal_name) SELECT 'PLATFORM', 'Plateforme (test)'
 WHERE NOT EXISTS (SELECT 1 FROM party WHERE kind = 'PLATFORM');
INSERT INTO party (id, kind, legal_name, country_code) VALUES
 (pg_temp.id('46a001'), 'OPERATOR', 'Prestataire A', 'SN'),
 (pg_temp.id('46a002'), 'OPERATOR', 'Prestataire B', 'CI');
INSERT INTO party (id, kind, operator_id, legal_name) VALUES
 (pg_temp.id('46b001'), 'ORGANIZER', pg_temp.id('46a001'), 'Organisateur A'),
 (pg_temp.id('46b011'), 'ORGANIZER', pg_temp.id('46a002'), 'Organisateur B');
INSERT INTO jurisdiction_profile (id, country_code, version, valid_from, breakage_destination)
VALUES (pg_temp.id('46c001'), 'SN', 460046, '2026-01-01', 'ORGANIZER');
INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone, jurisdiction_id, funds_holder)
SELECT pg_temp.id(e), pg_temp.id(o), pg_temp.id(g), 'Événement ' || e, 'XOF', 'Africa/Dakar',
       pg_temp.id('46c001'), 'ORGANIZER'
  FROM (VALUES ('46d001','46a001','46b001'), ('46d002','46a001','46b001'), ('46d011','46a002','46b011')) AS v(e, o, g);
INSERT INTO ledger (id, operator_id, scope_type, scope_id, currency, issuer_id, funds_holder_id) VALUES
 (pg_temp.id('46f001'), pg_temp.id('46a001'), 'EVENT', pg_temp.id('46d001'), 'XOF', pg_temp.id('46b001'), pg_temp.id('46b001')),
 (pg_temp.id('46f002'), pg_temp.id('46a001'), 'EVENT', pg_temp.id('46d002'), 'XOF', pg_temp.id('46b001'), pg_temp.id('46b001')),
 (pg_temp.id('46f011'), pg_temp.id('46a002'), 'EVENT', pg_temp.id('46d011'), 'XOF', pg_temp.id('46b011'), pg_temp.id('46b011'));
-- Terminaux : aa01 (lots ordinaires), aa02 (surcharges), aa03 (trous), aa04 sans événement, aa05 (lot en vol puis
-- révoqué), aa06 (révoqué, import), aa07 (révoqué, import du prestataire B vu par A), aa08 (lot rejeté), ab01 (B)
INSERT INTO device (id, operator_id, kind, event_id, serial)
SELECT pg_temp.id('46aa' || n), pg_temp.id('46a001'), 'POS', CASE WHEN n = '04' THEN NULL ELSE pg_temp.id('46d001') END,
       'C46-AA' || n
  FROM (VALUES ('01'), ('02'), ('03'), ('04'), ('05'), ('06'), ('08')) AS v(n);
INSERT INTO device (id, operator_id, kind, event_id, serial)
VALUES (pg_temp.id('46ab01'), pg_temp.id('46a002'), 'POS', pg_temp.id('46d011'), 'C46-AB01');
INSERT INTO app_user (id, operator_id, issuer, subject, email, display_name)
SELECT pg_temp.id(u), pg_temp.id(o), 'https://idp.test', 's0046' || u, u || '@test', 'Personne ' || u
  FROM (VALUES ('46e001','46a001'), ('46e002','46a001'), ('46e003','46a001'), ('46e011','46a002')) AS v(u, o);
CREATE FUNCTION pg_temp.dev(n text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT pg_temp.id('46aa' || n) $$;
CREATE FUNCTION pg_temp.bid(n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT ('b0460000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid $$;
SELECT pg_temp.a();

-- 1. Ouverture : contrôles ajoutés, aucun retiré -----------------------------------------------------------
SELECT is((SELECT chain_status FROM pg_temp.ob(pg_temp.bid(1), pg_temp.dev('01'), pg_temp.id('46f001'), 1, 3)),
  'VERIFIED', 'ouverture ordinaire d''un premier lot : chaîne vérifiée');
SELECT is((SELECT count(*)::int FROM pg_temp.ob(pg_temp.bid(1), pg_temp.dev('01'), pg_temp.id('46f001'), 1, 3)), 1,
  'renvoi du même lot : la ligne est rendue');
SELECT is((SELECT count(*)::int FROM offline_batch WHERE id = pg_temp.bid(1)), 1, 'renvoi du même lot : aucune seconde ligne');
SELECT is(pg_temp.code($$SELECT open_offline_batch(pg_temp.bid(1), pg_temp.dev('01'), pg_temp.id('46f001'), 1,
  pg_temp.chain_after(pg_temp.dev('01'), 0), pg_temp.hs(1, 2), pg_temp.chain_to(pg_temp.chain_after(pg_temp.dev('01'), 0), pg_temp.hs(1, 2)), '\x01')$$),
  'CL002', 'même batch_id, autre contenu : CL002');
SELECT is(pg_temp.code($$SELECT pg_temp.ob(pg_temp.bid(2), pg_temp.dev('01'), pg_temp.id('46f001'), 4, 1)$$), 'CL010',
  'second lot pendant qu''un lot est en cours : CL010');
-- appel à 9 arguments (signature d'avant) : le défaut de p_size_bytes le laisse marcher
SELECT is((SELECT size_bytes FROM offline_batch WHERE id = pg_temp.bid(1)), NULL::int, 'appel à 9 arguments : size_bytes NULL');
SELECT is((SELECT size_bytes FROM open_offline_batch(pg_temp.bid(3), pg_temp.dev('02'), pg_temp.id('46f001'), 1,
  pg_temp.chain_after(pg_temp.dev('02'), 0), pg_temp.hs(1, 1), pg_temp.chain_to(pg_temp.chain_after(pg_temp.dev('02'), 0), pg_temp.hs(1, 1)),
  '\x01', 'CENTRAL', 1048576)), 1048576, 'taille de 1 048 576 octets écrite');
SELECT is((SELECT received_via FROM offline_batch WHERE id = pg_temp.bid(3)), 'CENTRAL', 'canal CENTRAL par défaut');
UPDATE offline_batch SET status = 'REJECTED', reject_reason = 'ABANDONED' WHERE id = pg_temp.bid(3);
SELECT is(pg_temp.code($$SELECT open_offline_batch(pg_temp.bid(4), pg_temp.dev('02'), pg_temp.id('46f001'), 1,
  pg_temp.chain_after(pg_temp.dev('02'), 0), pg_temp.hs(1, 1), pg_temp.chain_to(pg_temp.chain_after(pg_temp.dev('02'), 0), pg_temp.hs(1, 1)),
  '\x01', 'CENTRAL', 0)$$), 'CL011', 'taille 0 : CL011');
SELECT is(pg_temp.code($$SELECT open_offline_batch(pg_temp.bid(4), pg_temp.dev('02'), pg_temp.id('46f001'), 1,
  pg_temp.chain_after(pg_temp.dev('02'), 0), pg_temp.hs(1, 1), pg_temp.chain_to(pg_temp.chain_after(pg_temp.dev('02'), 0), pg_temp.hs(1, 1)),
  '\x01', 'CENTRAL', 1048577)$$), 'CL011', 'taille 1 048 577 : CL011');
SELECT is(pg_temp.code($$SELECT open_offline_batch(pg_temp.bid(4), pg_temp.dev('02'), pg_temp.id('46f001'), 1,
  pg_temp.chain_after(pg_temp.dev('02'), 0), pg_temp.hs(1, 1), pg_temp.chain_to(pg_temp.chain_after(pg_temp.dev('02'), 0), pg_temp.hs(1, 1)),
  '\x01', 'IMPORT')$$), 'CL001', 'canal IMPORT par la voie ordinaire : CL001');
SELECT is(pg_temp.code($$SELECT open_offline_batch(pg_temp.bid(4), pg_temp.dev('02'), pg_temp.id('46f001'), 1,
  pg_temp.chain_after(pg_temp.dev('02'), 0), pg_temp.hs(1, 1), pg_temp.chain_to(pg_temp.chain_after(pg_temp.dev('02'), 0), pg_temp.hs(1, 1)),
  '\x01', 'AUTRE')$$), 'CL001', 'canal inconnu : CL001');
SELECT is(pg_temp.code($$SELECT open_offline_batch(pg_temp.bid(4), pg_temp.dev('02'), pg_temp.id('46f001'), 9223372036854775807,
  pg_temp.chain_after(pg_temp.dev('02'), 0), pg_temp.hs(1, 1), pg_temp.chain_after(pg_temp.dev('02'), 0), '\x01')$$),
  'CL011', 'seq_from = 2^63 - 1 : CL011 (et non 22003)');
SELECT is(pg_temp.code($$SELECT open_offline_batch(pg_temp.bid(4), pg_temp.dev('02'), pg_temp.id('46f001'), 9223372036854775800,
  pg_temp.chain_after(pg_temp.dev('02'), 0), pg_temp.hs(1, 10), pg_temp.chain_after(pg_temp.dev('02'), 0), '\x01')$$),
  'CL011', 'seq_from + n - 1 déborde de bigint : CL011');
SELECT is(pg_temp.code($$SELECT open_offline_batch(pg_temp.bid(4), pg_temp.dev('02'), pg_temp.id('46f001'), 0,
  pg_temp.chain_after(pg_temp.dev('02'), 0), pg_temp.hs(1, 1), pg_temp.chain_after(pg_temp.dev('02'), 0), '\x01')$$),
  'CL011', 'seq_from = 0 : CL011');
SELECT is(pg_temp.code($$SELECT open_offline_batch(pg_temp.bid(4), pg_temp.dev('02'), pg_temp.id('46f001'), 1000000000,
  pg_temp.chain_after(pg_temp.dev('02'), 0), pg_temp.hs(1, 1), pg_temp.chain_after(pg_temp.dev('02'), 0), '\x01')$$),
  'CL021', 'saut trop grand : CL021 (inchangé)');
SELECT is(pg_temp.code($$SELECT open_offline_batch(pg_temp.bid(4), pg_temp.dev('02'), pg_temp.id('46f001'), 10,
  pg_temp.chain_after(pg_temp.dev('02'), 0), ARRAY(SELECT sha256(i::text::bytea) FROM generate_series(1, 501) i),
  pg_temp.chain_after(pg_temp.dev('02'), 0), '\x01')$$), 'CL011', 'lot de 501 opérations : CL011');
SELECT is(pg_temp.code($$SELECT pg_temp.ob(pg_temp.bid(4), pg_temp.dev('02'), pg_temp.id('46f002'), 1, 1)$$), 'CL001',
  'grand livre d''un autre événement du même prestataire : CL001');
SELECT is(pg_temp.code($$SELECT pg_temp.ob(pg_temp.bid(4), pg_temp.dev('04'), pg_temp.id('46f001'), 1, 1)$$), 'CL001',
  'terminal sans événement : CL001');
SELECT is(pg_temp.code($$SELECT pg_temp.ob(pg_temp.bid(4), pg_temp.dev('02'), pg_temp.id('46f011'), 1, 1)$$), 'P0002',
  'grand livre d''un autre prestataire : introuvable');
SELECT is((SELECT reject_reason FROM open_offline_batch(pg_temp.bid(5), pg_temp.dev('02'), pg_temp.id('46f001'), 2,
  sha256('faux'::bytea), pg_temp.hs(2, 1), pg_temp.chain_to(sha256('faux'::bytea), pg_temp.hs(2, 1)), '\x01')),
  'CHAIN_BROKEN', 'lot qui ne suit pas la chaîne : rejeté CHAIN_BROKEN (inchangé)');
SELECT is((SELECT status FROM offline_batch WHERE id = pg_temp.bid(5)), 'REJECTED', 'lot CHAIN_BROKEN : REJECTED');

-- 2. Clôture : ni registre ni trace = refusé ; trace ouverte du même lot = admise (ADR-139) ---------------------
SELECT pg_temp.rec(pg_temp.dev('01'), 1);
SELECT pg_temp.rec(pg_temp.dev('01'), 2);
SELECT is(pg_temp.code($$SELECT complete_offline_batch(pg_temp.bid(1), '[]')$$), 'CL001',
  'clôture d''un lot dont le numéro 3 n''a ni registre ni trace : CL001');
SELECT throws_ok($$SELECT complete_offline_batch('b0460000-0000-0000-0000-000000000001', '[{"seq":3,"retryable":true}]')$$,
  'CL001', NULL, 'ADR-139 (borne) : un numéro « retryable » dans p_results seul n''est PAS admis');
SELECT throws_ok($$SELECT complete_offline_batch('b0460000-0000-0000-0000-000000000099', '[]')$$, 'P0002', NULL,
  'clôture d''un lot inconnu : introuvable');
SELECT is(pg_temp.code($$SELECT record_offline_retry(pg_temp.bid(1), 3, 'AUTRE_RAISON')$$), 'CL001', 'trace : raison inconnue refusée');
SELECT is(pg_temp.code($$SELECT record_offline_retry(pg_temp.bid(1), 4, 'INSUFFICIENT_FUNDS_RETRY')$$), 'CL001',
  'trace : numéro hors de la plage du lot refusé');
SELECT is(pg_temp.code($$SELECT record_offline_retry(pg_temp.bid(1), 1, 'INSUFFICIENT_FUNDS_RETRY')$$), 'CL001',
  'trace : numéro déjà au registre refusé');
SELECT lives_ok($$SELECT record_offline_retry('b0460000-0000-0000-0000-000000000001', 3, 'INSUFFICIENT_FUNDS_RETRY')$$,
  'trace du numéro 3 écrite');
SELECT lives_ok($$SELECT record_offline_retry('b0460000-0000-0000-0000-000000000001', 3, 'INSUFFICIENT_FUNDS_RETRY')$$,
  'trace : idempotente');
SELECT is((SELECT count(*)::int FROM offline_batch_retry WHERE batch_id = pg_temp.bid(1)), 1, 'trace : une seule ligne');
SELECT is((SELECT array_agg(s)::text FROM offline_batch_retries_open(pg_temp.dev('01')) s), '{3}', 'traces ouvertes du terminal : {3}');
SELECT is((SELECT status FROM complete_offline_batch(pg_temp.bid(1), '[{"seq":3}]')), 'COMPLETED',
  'clôture avec trace ouverte du même lot : admise');
SELECT is((SELECT results::text FROM offline_batch_state(pg_temp.bid(1))), '[{"seq": 3}]', 'résultats mémorisés');
SELECT is((SELECT status FROM complete_offline_batch(pg_temp.bid(1), '[]')), 'COMPLETED', 'clôture idempotente sur COMPLETED');
-- trace d'un AUTRE lot : refusée ; lot 2 = numéros 3..4 (renvoi chevauchant)
SELECT is((SELECT chain_status FROM pg_temp.ob(pg_temp.bid(2), pg_temp.dev('01'), pg_temp.id('46f001'), 3, 2)), 'VERIFIED',
  'lot 3..4 après le lot 1..3 : renvoi chevauchant, raccord vérifié');
SELECT pg_temp.rec(pg_temp.dev('01'), 4);
SELECT is(pg_temp.code($$SELECT complete_offline_batch(pg_temp.bid(2), '[]')$$), 'CL001',
  'clôture : trace ouverte d''un AUTRE lot pour le numéro 3 : refusée');
SELECT lives_ok($$SELECT record_offline_retry('b0460000-0000-0000-0000-000000000002', 3, 'INSUFFICIENT_FUNDS_RETRY')$$,
  'trace du lot 2 pour le numéro 3');
SELECT is((SELECT array_agg(s)::text FROM offline_batch_retries_open(pg_temp.dev('01')) s), '{3}', 'deux traces du même numéro : une seule dans la liste');
SELECT is((SELECT status FROM complete_offline_batch(pg_temp.bid(2), '[]')), 'COMPLETED', 'clôture du lot 2 avec sa propre trace');
-- le résultat final du numéro 3 clôt toute trace ouverte, quel que soit le lot
SELECT pg_temp.rec(pg_temp.dev('01'), 3);
SELECT is((SELECT count(*)::int FROM offline_batch_retry WHERE device_id = pg_temp.dev('01') AND closed_at IS NOT NULL), 2,
  'registre : le numéro 3 reçoit un résultat final, les deux traces sont closes');
SELECT is((SELECT count(*)::int FROM offline_batch_retries_open(pg_temp.dev('01'))), 0, 'plus aucune trace ouverte');
SELECT lives_ok($$SELECT record_offline_retry('b0460000-0000-0000-0000-000000000001', 3, 'INSUFFICIENT_FUNDS_RETRY')$$,
  'trace close : l''appel répété ne change rien');
SELECT is((SELECT count(*)::int FROM offline_batch_retry WHERE batch_id = pg_temp.bid(1) AND closed_at IS NOT NULL), 1, 'trace close : pas rouverte');
SELECT throws_ok($$UPDATE offline_batch_retry SET closed_at = NULL$$, NULL, NULL, 'trace close : closed_at ne se remet pas à NULL');
SELECT throws_ok($$UPDATE offline_batch_retry SET reason = 'INSUFFICIENT_FUNDS_RETRY', seq = seq + 10$$, NULL, NULL,
  'trace : seuls closed_at et alerted_at évoluent');
SELECT throws_ok($$DELETE FROM offline_batch_retry$$, NULL, NULL, 'trace : aucune suppression');
SELECT throws_ok($$INSERT INTO offline_batch_retry (batch_id, seq, operator_id, device_id, reason)
  VALUES ('b0460000-0000-0000-0000-000000000002', 4, '00000000-0000-0000-0000-0000000046a1', '00000000-0000-0000-0000-000046aa0001', 'AUTRE')$$,
  NULL, NULL, 'raison de trace : seule INSUFFICIENT_FUNDS_RETRY (borne ADR-139)');
SELECT is((SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'offline_batch_retry_reason'),
  'CHECK ((reason = ''INSUFFICIENT_FUNDS_RETRY''::text))', 'borne : la liste des raisons de trace ne s''élargit pas');
SELECT ok((SELECT prosrc LIKE '%offline_batch_retry%' AND prosrc LIKE '%closed_at IS NULL%' FROM pg_proc WHERE proname = 'complete_offline_batch'),
  'borne : complete_offline_batch ne tolère un numéro sans registre que par une trace ouverte');
-- alerted_at : posé une fois
UPDATE offline_batch_retry SET alerted_at = now() WHERE batch_id = pg_temp.bid(1);
SELECT throws_ok($$UPDATE offline_batch_retry SET alerted_at = now() + interval '1 day' WHERE batch_id = 'b0460000-0000-0000-0000-000000000001'$$,
  NULL, NULL, 'alerted_at posé une seule fois');
-- trace close par WAIVED : lot 5..6 (seq 6 au registre), trace sur 5, clôture, puis levée du trou 5
SELECT is((SELECT chain_status FROM pg_temp.ob(pg_temp.bid(6), pg_temp.dev('01'), pg_temp.id('46f001'), 5, 2)), 'VERIFIED', 'lot 5..6');
SELECT pg_temp.rec(pg_temp.dev('01'), 6);
SELECT lives_ok($$SELECT record_offline_retry('b0460000-0000-0000-0000-000000000006', 5, 'INSUFFICIENT_FUNDS_RETRY')$$, 'trace du numéro 5');
SELECT is((SELECT status FROM complete_offline_batch(pg_temp.bid(6), '[]')), 'COMPLETED', 'clôture du lot 5..6 par la trace');
SELECT is(waive_seq_gap(pg_temp.dev('01'), 5, pg_temp.id('46e001'), pg_temp.id('46e002'), 'journal perdu'), 6::bigint,
  'trou 5 levé à deux personnes');
SELECT is((SELECT closed_at IS NOT NULL FROM offline_batch_retry WHERE batch_id = pg_temp.bid(6) AND seq = 5), true,
  'WAIVED clôt la trace RETRY du numéro');
SELECT is(pg_temp.code($$SELECT record_offline_retry(pg_temp.bid(6), 5, 'INSUFFICIENT_FUNDS_RETRY')$$), 'OK',
  'trace déjà existante (close) : appel sans effet');
SELECT is(pg_temp.code($$SELECT record_offline_retry(pg_temp.bid(2), 4, 'INSUFFICIENT_FUNDS_RETRY')$$), 'CL001',
  'numéro déjà final sans trace : CL001, lot terminé');

-- 3. Résultats d'opération ---------------------------------------------------------------------------------
SELECT lives_ok($$SELECT record_offline_op_result('b0460000-0000-0000-0000-000000000001', 1, '{"seq":1,"status":"ACCEPTED"}')$$,
  'résultat du numéro 1 écrit (lot COMPLETED admis)');
SELECT lives_ok($$SELECT record_offline_op_result('b0460000-0000-0000-0000-000000000001', 1, '{"status":"ACCEPTED", "seq":1}')$$,
  'rejeu du même jsonb : rien');
SELECT is((SELECT count(*)::int FROM offline_op_result WHERE batch_id = pg_temp.bid(1)), 1, 'rejeu égal : une seule ligne');
SELECT is(pg_temp.code($$SELECT record_offline_op_result(pg_temp.bid(1), 1, '{"seq":1,"status":"REJECTED"}')$$), 'CL002',
  'rejeu différent : CL002');
SELECT is(pg_temp.code($$SELECT record_offline_op_result(pg_temp.bid(1), 99, '{"seq":99}')$$), 'CL001', 'numéro hors plage : CL001');
SELECT is(pg_temp.code($$SELECT record_offline_op_result(pg_temp.bid(1), 2, '{"seq":3}')$$), 'CL001', 'seq du JSON différent : CL001');
SELECT is(pg_temp.code($$SELECT record_offline_op_result(pg_temp.bid(1), 2, '{"status":"X"}')$$), 'CL001', 'seq absent : CL001');
SELECT is(pg_temp.code($$SELECT record_offline_op_result(pg_temp.bid(1), 2, '"seq"')$$), 'CL001', 'résultat non objet : CL001');
SELECT is(pg_temp.code($$SELECT record_offline_op_result(pg_temp.bid(1), 2, '{"seq":"2"}')$$), 'CL001', 'seq en texte : CL001');
SELECT lives_ok($$SELECT record_offline_op_result('b0460000-0000-0000-0000-000000000005', 2, '{"seq":2}')$$,
  'lot REJECTED admis (reprise après abandon)');
SELECT is((SELECT array_agg(seq)::text FROM offline_op_results(pg_temp.bid(1))), '{1}', 'offline_op_results : lignes par seq');
SELECT throws_ok($$UPDATE offline_op_result SET result = '{"seq":1}'$$, NULL, NULL, 'résultat immuable (mise à jour)');
SELECT throws_ok($$DELETE FROM offline_op_result$$, NULL, NULL, 'résultat immuable (suppression)');

-- 4. check_seq_gap_waivable et waive_seq_gap d'accord ----------------------------------------------------------
SELECT pg_temp.rec(pg_temp.dev('03'), 1);
SELECT pg_temp.rec(pg_temp.dev('03'), 3);
SELECT pg_temp.rec(pg_temp.dev('03'), 6);
-- trous : 2, 4, 5 ; contigu 1 ; dernier 6
SELECT is(pg_temp.code($$SELECT check_seq_gap_waivable(pg_temp.dev('03'), 1)$$), 'CL012', 'pré-contrôle, numéro <= continu : CL012');
SELECT is(pg_temp.code($$SELECT waive_seq_gap(pg_temp.dev('03'), 1, pg_temp.id('46e001'), pg_temp.id('46e002'), 'raison x')$$), 'CL012', 'levée, numéro <= continu : CL012');
SELECT is(pg_temp.code($$SELECT check_seq_gap_waivable(pg_temp.dev('03'), 7)$$), 'CL012', 'pré-contrôle, numéro > dernier : CL012');
SELECT is(pg_temp.code($$SELECT waive_seq_gap(pg_temp.dev('03'), 7, pg_temp.id('46e001'), pg_temp.id('46e002'), 'raison x')$$), 'CL012', 'levée, numéro > dernier : CL012');
SELECT is(pg_temp.code($$SELECT check_seq_gap_waivable(pg_temp.dev('03'), 3)$$), 'CL012', 'pré-contrôle, numéro au registre : CL012');
SELECT is(pg_temp.code($$SELECT waive_seq_gap(pg_temp.dev('03'), 3, pg_temp.id('46e001'), pg_temp.id('46e002'), 'raison x')$$), 'CL012', 'levée, numéro au registre : CL012');
SELECT is((SELECT count(*)::int FROM pg_temp.ob(pg_temp.bid(30), pg_temp.dev('03'), pg_temp.id('46f001'), 2, 1)), 1, 'lot 2..2 en cours');
SELECT is(pg_temp.code($$SELECT check_seq_gap_waivable(pg_temp.dev('03'), 2)$$), 'CL010', 'pré-contrôle, lot en cours qui le couvre : CL010');
SELECT is(pg_temp.code($$SELECT waive_seq_gap(pg_temp.dev('03'), 2, pg_temp.id('46e001'), pg_temp.id('46e002'), 'raison x')$$), 'CL010', 'levée, lot en cours : CL010');
SELECT is((SELECT count(*)::int FROM device_seq_registry WHERE device_id = pg_temp.dev('03')), 3, 'les refus n''ont rien écrit');
SELECT is(pg_temp.code($$SELECT check_seq_gap_waivable(pg_temp.dev('03'), 4)$$), 'OK', 'pré-contrôle, vrai trou : passe');
SELECT is((SELECT count(*)::int FROM device_seq_registry WHERE device_id = pg_temp.dev('03')), 3, 'pré-contrôle : aucune écriture');
SELECT is((SELECT provolatile FROM pg_proc WHERE proname = 'check_seq_gap_waivable'), 's', 'pré-contrôle STABLE');
SELECT is(pg_temp.code($$SELECT waive_seq_gap(pg_temp.dev('03'), 4, pg_temp.id('46e001'), pg_temp.id('46e002'), 'raison x')$$), 'OK', 'levée, vrai trou : passe');
SELECT is(pg_temp.code($$SELECT check_seq_gap_waivable(pg_temp.dev('03'), 4)$$), 'CL012', 'pré-contrôle après levée : CL012, comme la levée');

-- 5. Import du journal ----------------------------------------------------------------------------------------
-- aa05 : lot en vol (ouvert avant la révocation) ; aa06 et aa08 : révoqués sans lot
SELECT is((SELECT count(*)::int FROM pg_temp.ob(pg_temp.bid(50), pg_temp.dev('05'), pg_temp.id('46f001'), 1, 1)), 1, 'aa05 : lot en cours');
UPDATE device SET status = 'REVOKED' WHERE id IN (pg_temp.dev('05'), pg_temp.dev('06'), pg_temp.dev('08'));
SELECT is(pg_temp.code($$SELECT pg_temp.ob(pg_temp.bid(51), pg_temp.dev('06'), pg_temp.id('46f001'), 1, 1)$$), '42501',
  'terminal révoqué, voie ordinaire : 42501');
SELECT is(pg_temp.code($$SELECT create_device_journal_import(pg_temp.dev('02'), '[{"batch_id":"b0460000-0000-0000-0000-000000000060","seq_from":1}]',
  sha256('x'::bytea), '{}', 'raison suffisante', pg_temp.id('46e001'))$$), 'CL052', 'import d''un terminal ACTIVE : CL052');
CREATE FUNCTION pg_temp.mk(p_dev uuid, p_batches jsonb, p_sha bytea DEFAULT sha256('x'::bytea), p_reason text DEFAULT 'raison suffisante',
                           p_actor uuid DEFAULT pg_temp.id('46e001')) RETURNS uuid LANGUAGE sql AS
  $$ SELECT create_device_journal_import(p_dev, p_batches, p_sha, '{"operations":2}', p_reason, p_actor) $$;
SELECT is(pg_temp.code($$SELECT pg_temp.mk(pg_temp.dev('06'), (SELECT jsonb_agg(jsonb_build_object('batch_id', gen_random_uuid(), 'seq_from', i)) FROM generate_series(1, 21) i))$$),
  'CL001', 'import de 21 lots : CL001');
SELECT is(pg_temp.code($$SELECT pg_temp.mk(pg_temp.dev('06'), '[]')$$), 'CL001', 'import sans lot : CL001');
SELECT is(pg_temp.code($$SELECT pg_temp.mk(pg_temp.dev('06'), '{"batch_id":"x"}')$$), 'CL001', 'lots non tableau : CL001');
SELECT is(pg_temp.code($$SELECT pg_temp.mk(pg_temp.dev('06'), '[{"seq_from":1}]')$$), 'CL001', 'lot sans batch_id : CL001');
SELECT is(pg_temp.code($$SELECT pg_temp.mk(pg_temp.dev('06'), '[{"batch_id":"b0460000-0000-0000-0000-000000000060","seq_from":0}]')$$), 'CL001', 'seq_from 0 : CL001');
SELECT is(pg_temp.code($$SELECT pg_temp.mk(pg_temp.dev('06'), '[{"batch_id":"b0460000-0000-0000-0000-000000000060","seq_from":1},{"batch_id":"b0460000-0000-0000-0000-000000000060","seq_from":2}]')$$), 'CL001', 'lot en double : CL001');
SELECT is(pg_temp.code($$SELECT pg_temp.mk(pg_temp.dev('06'), '[{"batch_id":"b0460000-0000-0000-0000-000000000060","seq_from":1}]', '\x00'::bytea)$$), 'CL001', 'empreinte de 1 octet : CL001');
SELECT is(pg_temp.code($$SELECT pg_temp.mk(pg_temp.dev('06'), '[{"batch_id":"b0460000-0000-0000-0000-000000000060","seq_from":1}]', sha256('x'::bytea), 'court')$$), 'CL001', 'raison trop courte : CL001');
SELECT is(pg_temp.code($$SELECT pg_temp.mk(pg_temp.dev('06'), '[{"batch_id":"b0460000-0000-0000-0000-000000000060","seq_from":1}]', sha256('x'::bytea), 'raison suffisante', NULL)$$), 'CL001', 'demandeur nul : CL001');

CREATE TEMP TABLE imp AS
 SELECT pg_temp.mk(pg_temp.dev('06'), '[{"batch_id":"b0460000-0000-0000-0000-000000000061","seq_from":1,"n":2},{"batch_id":"b0460000-0000-0000-0000-000000000062","seq_from":3}]') AS id;
GRANT ALL ON imp TO PUBLIC;
SELECT is((SELECT status FROM device_journal_import_view((SELECT id FROM imp))), 'PENDING', 'import créé : PENDING');
SELECT is((SELECT batches FROM device_journal_import_view((SELECT id FROM imp))), NULL::jsonb, 'vue : batches à NULL par défaut');
SELECT is((SELECT jsonb_array_length(batches) FROM device_journal_import_view((SELECT id FROM imp), true)), 2, 'vue : batches rendus sur demande');
SELECT is(pg_temp.code($$SELECT pg_temp.mk(pg_temp.dev('06'), '[{"batch_id":"b0460000-0000-0000-0000-000000000063","seq_from":1}]')$$), 'CL010',
  'second import pendant qu''un import est actif : CL010');
SELECT is(pg_temp.code($$SELECT open_imported_batch((SELECT id FROM imp), pg_temp.bid(61), 1, pg_temp.chain_after(pg_temp.dev('06'), 0),
  pg_temp.hs(1, 2), pg_temp.chain_to(pg_temp.chain_after(pg_temp.dev('06'), 0), pg_temp.hs(1, 2)), '\x01')$$), 'CL001',
  'ouverture de lot pour un import PENDING : CL001');
SELECT is(pg_temp.code($$SELECT begin_device_journal_import((SELECT id FROM imp), sha256('x'::bytea), pg_temp.id('46e001'))$$), 'CL001',
  'approbateur = demandeur : CL001');
SELECT is(pg_temp.code($$SELECT begin_device_journal_import((SELECT id FROM imp), sha256('autre'::bytea), pg_temp.id('46e002'))$$), 'CL053',
  'empreinte différente de la demande : CL053');
SELECT is(pg_temp.code($$SELECT begin_device_journal_import((SELECT id FROM imp), sha256('x'::bytea), NULL)$$), 'CL001', 'approbateur nul : CL001');
SELECT is((SELECT status FROM begin_device_journal_import((SELECT id FROM imp), sha256('x'::bytea), pg_temp.id('46e002'))), 'PROCESSING',
  'approbation : PROCESSING');
SELECT is((SELECT approved_by FROM device_journal_import WHERE id = (SELECT id FROM imp)), pg_temp.id('46e002'), 'approbateur enregistré');
SELECT is((SELECT status FROM begin_device_journal_import((SELECT id FROM imp), sha256('x'::bytea), pg_temp.id('46e002'))), 'PROCESSING',
  'begin idempotent');
SELECT is(pg_temp.code($$SELECT begin_device_journal_import((SELECT id FROM imp), sha256('x'::bytea), pg_temp.id('46e003'))$$), 'CL001',
  'import PROCESSING : un autre approbateur refusé');
-- lots de l'import
SELECT is(pg_temp.code($$SELECT pg_temp.ib((SELECT id FROM imp), pg_temp.bid(99), pg_temp.dev('06'), 1, 2)$$), 'CL001', 'lot non listé : CL001');
SELECT is(pg_temp.code($$SELECT pg_temp.ib((SELECT id FROM imp), pg_temp.bid(61), pg_temp.dev('06'), 2, 1)$$), 'CL001', 'lot listé mais autre seq_from : CL001');
SELECT is((SELECT received_via FROM pg_temp.ib((SELECT id FROM imp), pg_temp.bid(61), pg_temp.dev('06'), 1, 2)), 'IMPORT', 'lot importé : canal IMPORT');
SELECT is((SELECT import_id FROM offline_batch WHERE id = pg_temp.bid(61)), (SELECT id FROM imp), 'lot importé : import_id posé');
SELECT is((SELECT chain_status FROM offline_batch WHERE id = pg_temp.bid(61)), 'VERIFIED', 'lot importé : chaîne vérifiée comme à l''ordinaire');
SELECT is((SELECT count(*)::int FROM pg_temp.ib((SELECT id FROM imp), pg_temp.bid(61), pg_temp.dev('06'), 1, 2)), 1, 'lot importé : renvoi du même lot');
SELECT is(pg_temp.code($$SELECT pg_temp.ib((SELECT id FROM imp), pg_temp.bid(62), pg_temp.dev('06'), 3, 1)$$), 'CL010',
  'un seul lot en cours par terminal, même par l''import : CL010');
SELECT is((SELECT ledger_id FROM offline_batch WHERE id = pg_temp.bid(61)), pg_temp.id('46f001'), 'grand livre pris sur l''événement du terminal');
SELECT is(pg_temp.code($$SELECT open_imported_batch((SELECT id FROM imp), pg_temp.bid(62), 3, pg_temp.chain_after(pg_temp.dev('06'), 2),
  pg_temp.hs(3, 1), sha256('pas la chaîne'::bytea), '\x01')$$), 'CL010', 'ordre : le lot précédent est encore en cours');
SELECT pg_temp.rec(pg_temp.dev('06'), 1);
SELECT pg_temp.rec(pg_temp.dev('06'), 2);
SELECT is((SELECT status FROM complete_offline_batch(pg_temp.bid(61), '[]')), 'COMPLETED', 'lot importé clos comme les autres');
SELECT is((SELECT reject_reason FROM open_imported_batch((SELECT id FROM imp), pg_temp.bid(62), 3, pg_temp.chain_after(pg_temp.dev('06'), 2),
  pg_temp.hs(3, 1), sha256('pas la chaîne'::bytea), '\x01')), 'CHAIN_BROKEN', 'lot importé hors chaîne : rejeté CHAIN_BROKEN (la chaîne n''est pas contournée)');
SELECT is(pg_temp.code($$SELECT finish_device_journal_import((SELECT id FROM imp), 'PENDING', '{}')$$), 'CL001', 'fin avec un autre statut : CL001');
SELECT is(pg_temp.code($$SELECT finish_device_journal_import((SELECT id FROM imp), 'APPLIED', NULL)$$), 'CL001', 'fin sans résultat : CL001');
SELECT is((SELECT array_agg(import_id) FROM device_journal_imports_processing()), ARRAY[(SELECT id FROM imp)], 'imports PROCESSING listés (identifiants)');
SELECT lives_ok($$SELECT finish_device_journal_import((SELECT id FROM imp), 'APPLIED', '{"operations":2}')$$, 'fin APPLIED');
SELECT is((SELECT applied_at IS NOT NULL FROM device_journal_import WHERE id = (SELECT id FROM imp)), true, 'applied_at posé');
SELECT is(pg_temp.code($$SELECT finish_device_journal_import((SELECT id FROM imp), 'FAILED', '{}')$$), 'CL001', 'fin d''un import déjà APPLIED : CL001');
SELECT is(pg_temp.code($$SELECT begin_device_journal_import((SELECT id FROM imp), sha256('x'::bytea), pg_temp.id('46e002'))$$), 'CL053',
  'import rejoué après APPLIED : CL053');
SELECT is(pg_temp.code($$SELECT begin_device_journal_import((SELECT id FROM imp), sha256('x'::bytea), pg_temp.id('46e003'))$$), 'CL053',
  'import rejoué par un autre approbateur : CL053');
SELECT is(pg_temp.code($$SELECT open_imported_batch((SELECT id FROM imp), pg_temp.bid(62), 3, pg_temp.chain_after(pg_temp.dev('06'), 2),
  pg_temp.hs(3, 1), sha256('x'::bytea), '\x01')$$), 'CL001', 'ouverture de lot pour un import APPLIED : CL001');
SELECT throws_ok($$UPDATE device_journal_import SET batches = '[]'$$, NULL, NULL, 'batches immuables');
SELECT throws_ok($$UPDATE device_journal_import SET batches_sha256 = sha256('y'::bytea)$$, NULL, NULL, 'batches_sha256 immuable');
SELECT throws_ok($$UPDATE device_journal_import SET status = 'PENDING'$$, NULL, NULL, 'import en état final gelé');
SELECT throws_ok($$DELETE FROM device_journal_import$$, NULL, NULL, 'import : aucune suppression');
-- lot en vol du terminal : begin refusé (CL010), puis abandon après 15 min
CREATE TEMP TABLE imp2 AS
 SELECT pg_temp.mk(pg_temp.dev('05'), '[{"batch_id":"b0460000-0000-0000-0000-000000000070","seq_from":2}]') AS id;
GRANT ALL ON imp2 TO PUBLIC;
SELECT is(pg_temp.code($$SELECT begin_device_journal_import((SELECT id FROM imp2), sha256('x'::bytea), pg_temp.id('46e002'))$$), 'CL010',
  'import pendant qu''un lot du terminal est PROCESSING : CL010');
SELECT is((SELECT status FROM device_journal_import WHERE id = (SELECT id FROM imp2)), 'PENDING', 'import resté PENDING');
UPDATE offline_batch SET received_at = clock_timestamp() - interval '20 minutes' WHERE id = pg_temp.bid(50);
SELECT is((SELECT status FROM begin_device_journal_import((SELECT id FROM imp2), sha256('x'::bytea), pg_temp.id('46e002'))), 'PROCESSING',
  'lot du terminal en cours depuis plus de 15 min : abandonné, import approuvé');
SELECT is((SELECT reject_reason FROM offline_batch WHERE id = pg_temp.bid(50)), 'ABANDONED', 'lot en vol : ABANDONED');
-- listage multi-prestataires (identifiants seulement)
UPDATE device SET status = 'REVOKED' WHERE id = pg_temp.id('46ab01');
SELECT pg_temp.b();
CREATE TEMP TABLE imp3 AS
 SELECT create_device_journal_import(pg_temp.id('46ab01'), '[{"batch_id":"b0460000-0000-0000-0000-000000000080","seq_from":1}]',
   sha256('z'::bytea), '{}', 'raison suffisante', pg_temp.id('46e011')) AS id;
GRANT ALL ON imp3 TO PUBLIC;
SELECT pg_temp.a();
SELECT is(pg_temp.code($$SELECT begin_device_journal_import((SELECT id FROM imp3), sha256('z'::bytea), pg_temp.id('46e011'))$$), 'P0002',
  'import d''un autre prestataire : introuvable');
SELECT pg_temp.b();
SELECT pg_temp.a();
SELECT is((SELECT count(*)::int FROM device_journal_imports_processing()), 1, 'imports PROCESSING (A seul : B encore PENDING)');
SELECT is(pg_get_function_result('device_journal_imports_processing()'::regprocedure), 'TABLE(import_id uuid, operator_id uuid)',
  'imports PROCESSING : colonnes figées (identifiants seulement)');
SELECT is((SELECT prosecdef FROM pg_proc WHERE proname = 'device_journal_imports_processing'), true, 'imports PROCESSING : SECURITY DEFINER');
SELECT is((SELECT provolatile FROM pg_proc WHERE proname = 'device_journal_imports_processing'), 's', 'imports PROCESSING : STABLE');

-- 6. Autre prestataire sur chaque fonction ---------------------------------------------------------------------
SELECT pg_temp.b();
SELECT is(pg_temp.code($$SELECT pg_temp.ob(pg_temp.bid(90), pg_temp.dev('02'), pg_temp.id('46f001'), 1, 1)$$), 'P0002', 'autre prestataire : open_offline_batch');
SELECT is(pg_temp.code($$SELECT complete_offline_batch(pg_temp.bid(1), '[]')$$), 'P0002', 'autre prestataire : complete_offline_batch');
SELECT is(pg_temp.code($$SELECT record_offline_retry(pg_temp.bid(1), 3, 'INSUFFICIENT_FUNDS_RETRY')$$), 'P0002', 'autre prestataire : record_offline_retry');
SELECT is(pg_temp.code($$SELECT record_offline_op_result(pg_temp.bid(1), 1, '{"seq":1}')$$), 'P0002', 'autre prestataire : record_offline_op_result');
SELECT is(pg_temp.code($$SELECT offline_batch_retries_open(pg_temp.dev('01'))$$), 'P0002', 'autre prestataire : offline_batch_retries_open');
SELECT is(pg_temp.code($$SELECT check_seq_gap_waivable(pg_temp.dev('03'), 5)$$), 'P0002', 'autre prestataire : check_seq_gap_waivable');
SELECT is(pg_temp.code($$SELECT pg_temp.mk(pg_temp.dev('08'), '[{"batch_id":"b0460000-0000-0000-0000-000000000090","seq_from":1}]')$$), 'P0002', 'autre prestataire : create_device_journal_import');
SELECT is(pg_temp.code($$SELECT begin_device_journal_import((SELECT id FROM imp2), sha256('x'::bytea), pg_temp.id('46e011'))$$), 'P0002', 'autre prestataire : begin_device_journal_import');
SELECT is(pg_temp.code($$SELECT open_imported_batch((SELECT id FROM imp2), pg_temp.bid(70), 2, pg_temp.chain_after(pg_temp.dev('05'), 1), pg_temp.hs(2, 1), sha256('x'::bytea), '\x01')$$), 'P0002', 'autre prestataire : open_imported_batch');
SELECT is(pg_temp.code($$SELECT finish_device_journal_import((SELECT id FROM imp2), 'FAILED', '{}')$$), 'P0002', 'autre prestataire : finish_device_journal_import');
SELECT is(pg_temp.code($$SELECT device_journal_import_view((SELECT id FROM imp2))$$), 'P0002', 'autre prestataire : device_journal_import_view');
SELECT is((SELECT count(*)::int FROM offline_batch_state(pg_temp.bid(1))), 0, 'autre prestataire : offline_batch_state, aucune ligne');
SELECT is((SELECT count(*)::int FROM offline_op_results(pg_temp.bid(1))), 0, 'autre prestataire : offline_op_results, aucune ligne');
SELECT pg_temp.a();
SELECT is((SELECT status FROM offline_batch_state(pg_temp.bid(1))), 'COMPLETED', 'offline_batch_state : statut du lot');
SELECT is((SELECT missing_seqs FROM offline_batch_state(pg_temp.bid(6))), '{}'::bigint[], 'offline_batch_state : aucun trou actuel');
SELECT is((SELECT missing_seqs FROM offline_batch_state(pg_temp.bid(30))), '{2,5}'::bigint[], 'offline_batch_state : trous actuels du terminal (lot en cours)');
SELECT is((SELECT results FROM offline_batch_state(pg_temp.bid(30))), NULL::jsonb, 'offline_batch_state : résultats NULL avant clôture');

-- 7. Structure : RLS forcée, search_path, droits de PUBLIC ----------------------------------------------------
SELECT is((SELECT count(*)::int FROM pg_class WHERE relname IN ('device_journal_import','offline_batch_retry','offline_op_result')
            AND relrowsecurity AND relforcerowsecurity), 3, 'RLS activée et forcée sur les trois tables');
SELECT is((SELECT count(*)::int FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
            WHERE c.relname IN ('device_journal_import','offline_batch_retry','offline_op_result') AND p.polname = 'tenant_isolation'), 3,
  'une politique tenant_isolation par table');
SELECT is((SELECT count(*)::int FROM pg_proc WHERE proname IN ('open_offline_batch','open_offline_batch_core','open_imported_batch',
  'complete_offline_batch','offline_batch_state','record_offline_retry','record_offline_op_result','offline_op_results',
  'offline_batch_retries_open','check_seq_gap_waivable','create_device_journal_import','begin_device_journal_import',
  'finish_device_journal_import','device_journal_import_view','device_journal_imports_processing','close_offline_batch_retry',
  'offline_batch_retry_guard','device_journal_import_guard')), 18, 'dix-huit fonctions de la migration présentes');
SELECT is((SELECT count(*)::int FROM pg_proc p WHERE p.proname IN ('open_offline_batch','open_offline_batch_core','open_imported_batch',
  'complete_offline_batch','offline_batch_state','record_offline_retry','record_offline_op_result','offline_op_results',
  'offline_batch_retries_open','check_seq_gap_waivable','create_device_journal_import','begin_device_journal_import',
  'finish_device_journal_import','device_journal_import_view','device_journal_imports_processing','close_offline_batch_retry',
  'offline_batch_retry_guard','device_journal_import_guard')
     AND coalesce(p.proconfig, '{}') @> ARRAY['search_path=public, pg_temp']), 18, 'search_path = public, pg_temp sur chaque fonction');
SELECT is((SELECT count(*)::int FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
   WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE' AND p.proname IN ('open_offline_batch','open_offline_batch_core','open_imported_batch',
  'complete_offline_batch','offline_batch_state','record_offline_retry','record_offline_op_result','offline_op_results',
  'offline_batch_retries_open','check_seq_gap_waivable','create_device_journal_import','begin_device_journal_import',
  'finish_device_journal_import','device_journal_import_view','device_journal_imports_processing','close_offline_batch_retry',
  'offline_batch_retry_guard','device_journal_import_guard')), 0, 'EXECUTE retiré à PUBLIC sur chaque fonction');
SELECT is((SELECT prosecdef FROM pg_proc WHERE proname = 'open_offline_batch_core'), false,
  'open_offline_batch_core : SECURITY INVOKER (un appel direct par un rôle sans droit d''écriture échoue)');
SELECT is((SELECT count(*)::int FROM pg_proc WHERE proname = 'open_offline_batch'), 1, 'une seule signature de open_offline_batch');

SELECT * FROM finish();
ROLLBACK;
