-- Anomalies hors ligne, alertes à 24 h, historique du portefeuille et heure de blocage (migration 0047 ;
-- mission hors-ligne-snapshots-lots, lot WP06 ; FR-019 à FR-021, FR-026, FR-031, FR-034 ; R-17, R-18, R-30.13)
-- — pgTAP, écrit à la main. Sous le PROPRIÉTAIRE seulement : aucun SET ROLE (droits posés par le lot WP08).
-- Lancer : pg_prove -d <base> tests/tests_offline_anomalies.sql (base créée par les migrations).
\set ON_ERROR_STOP 1
\set QUIET 1
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

CREATE FUNCTION pg_temp.id(p text) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT ('00000000-0000-0000-0000-' || lpad(p, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.a() RETURNS void LANGUAGE sql AS
  $$ SELECT set_config('app.operator_id', pg_temp.id('47a001')::text, true) $$;
CREATE FUNCTION pg_temp.b() RETURNS void LANGUAGE sql AS
  $$ SELECT set_config('app.operator_id', pg_temp.id('47a002')::text, true) $$;
CREATE FUNCTION pg_temp.none() RETURNS void LANGUAGE sql AS
  $$ SELECT set_config('app.operator_id', '', true) $$;
CREATE FUNCTION pg_temp.code(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE p_sql; RETURN 'OK'; EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE; END $$;
CREATE FUNCTION pg_temp.hs(p_from bigint, p_n int) RETURNS bytea[] LANGUAGE sql IMMUTABLE AS
  $$ SELECT array_agg(sha256(convert_to('op' || s, 'UTF8')) ORDER BY s) FROM generate_series(p_from, p_from + p_n - 1) s $$;
CREATE FUNCTION pg_temp.chain_to(p_prev bytea, p_hs bytea[]) RETURNS bytea LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE e bytea := p_prev; h bytea;
BEGIN FOREACH h IN ARRAY p_hs LOOP e := chain_step(e, h); END LOOP; RETURN e; END $$;
CREATE FUNCTION pg_temp.ob(p_batch uuid, p_dev uuid, p_ledger uuid, p_n int) RETURNS offline_batch
LANGUAGE sql AS $$
  SELECT open_offline_batch(p_batch, p_dev, p_ledger, 1, device_chain_genesis(p_dev), pg_temp.hs(1, p_n),
         pg_temp.chain_to(device_chain_genesis(p_dev), pg_temp.hs(1, p_n)), '\x01') $$;

-- Données (propriétaire) --------------------------------------------------------------------------------
-- A : événement ea1 (grand livre la1), B : eb1 (lb1). Terminaux da1, da2 (A), db1 (B).
INSERT INTO party (kind, legal_name) SELECT 'PLATFORM', 'Plateforme (test)'
 WHERE NOT EXISTS (SELECT 1 FROM party WHERE kind = 'PLATFORM');
INSERT INTO party (id, kind, legal_name, country_code) VALUES
 (pg_temp.id('47a001'), 'OPERATOR', 'Prestataire A', 'SN'),
 (pg_temp.id('47a002'), 'OPERATOR', 'Prestataire B', 'CI');
INSERT INTO party (id, kind, operator_id, legal_name) VALUES
 (pg_temp.id('47b001'), 'ORGANIZER', pg_temp.id('47a001'), 'Organisateur A'),
 (pg_temp.id('47b011'), 'ORGANIZER', pg_temp.id('47a002'), 'Organisateur B');
INSERT INTO jurisdiction_profile (id, country_code, version, valid_from, breakage_destination)
VALUES (pg_temp.id('47c001'), 'SN', 470047, '2026-01-01', 'ORGANIZER');
INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone, jurisdiction_id, funds_holder)
SELECT pg_temp.id(e), pg_temp.id(o), pg_temp.id(g), 'Événement ' || e, 'XOF', 'Africa/Dakar',
       pg_temp.id('47c001'), 'ORGANIZER'
  FROM (VALUES ('47d001','47a001','47b001'), ('47d011','47a002','47b011')) AS v(e, o, g);
INSERT INTO ledger (id, operator_id, scope_type, scope_id, currency, issuer_id, funds_holder_id) VALUES
 (pg_temp.id('47f001'), pg_temp.id('47a001'), 'EVENT', pg_temp.id('47d001'), 'XOF', pg_temp.id('47b001'), pg_temp.id('47b001')),
 (pg_temp.id('47f011'), pg_temp.id('47a002'), 'EVENT', pg_temp.id('47d011'), 'XOF', pg_temp.id('47b011'), pg_temp.id('47b011'));
INSERT INTO device (id, operator_id, kind, event_id, serial) VALUES
 (pg_temp.id('47aa01'), pg_temp.id('47a001'), 'POS', pg_temp.id('47d001'), 'C47-AA01'),
 (pg_temp.id('47aa02'), pg_temp.id('47a001'), 'POS', pg_temp.id('47d001'), 'C47-AA02'),
 (pg_temp.id('47ab01'), pg_temp.id('47a002'), 'POS', pg_temp.id('47d011'), 'C47-AB01');
INSERT INTO app_user (id, operator_id, issuer, subject, email, display_name)
VALUES (pg_temp.id('47e001'), pg_temp.id('47a001'), 'https://idp.test', 's004747e001', 'e1@test', 'Personne 1'),
       (pg_temp.id('47e002'), pg_temp.id('47a001'), 'https://idp.test', 's004747e002', 'e2@test', 'Personne 2');
-- Transactions : t1..t4 de A, tb1 de B
INSERT INTO journal_transaction (id, operator_id, ledger_id, type, idempotency_key, request_hash, occurred_at, source)
SELECT pg_temp.id(t), pg_temp.id(o), pg_temp.id(l), ty, 'k47-' || t, 'h', now(), 'OFFLINE_SYNC'
  FROM (VALUES ('471001','47a001','47f001','PURCHASE'), ('471002','47a001','47f001','PURCHASE'),
               ('471003','47a001','47f001','PURCHASE'), ('471004','47a001','47f001','PURCHASE'),
               ('4710b1','47a002','47f011','PURCHASE')) AS v(t, o, l, ty);
INSERT INTO tag_key (operator_id, key_index, kms_key_ref, status)
VALUES (pg_temp.id('47a001'), 1, 'test:hmac-47', 'ACTIVE');
-- Un bracelet de A (m1) et un de B (mb), un portefeuille de A (w0)
INSERT INTO media_batch (id, operator_id, organizer_id, kind, quantity, key_index)
VALUES (pg_temp.id('47ba01'), pg_temp.id('47a001'), pg_temp.id('47b001'), 'PUBLIC', 10, 1);
INSERT INTO wallet (id, operator_id, ledger_id) VALUES
 (pg_temp.id('472000'), pg_temp.id('47a001'), pg_temp.id('47f001'));
INSERT INTO media (id, operator_id, kind, token_hash, nfc_uid, batch_id, key_index) VALUES
 (pg_temp.id('473001'), pg_temp.id('47a001'), 'NFC_TAG', sha256('m1'::bytea), decode('04000000000047', 'hex'),
  pg_temp.id('47ba01'), 1),
 (pg_temp.id('4730b1'), pg_temp.id('47a002'), 'NFC_TAG', sha256('mb'::bytea), decode('04000000000048', 'hex'), NULL, 1);
SELECT pg_temp.a();
SELECT count(*) FROM pg_temp.ob(pg_temp.id('47bb01'), pg_temp.id('47aa01'), pg_temp.id('47f001'), 3) \g /dev/null
SELECT pg_temp.b();
SELECT count(*) FROM pg_temp.ob(pg_temp.id('47bb0b'), pg_temp.id('47ab01'), pg_temp.id('47f011'), 1) \g /dev/null
SELECT pg_temp.a();

-- 1. open_offline_anomaly : types, paramètres, prestataire -------------------------------------------------
SELECT is((SELECT count(*)::int FROM (VALUES ('OFFLINE_SHORTFALL'), ('SEQ_GAP'), ('CHAIN_BROKEN'), ('CLOCK_SKEW'),
  ('SIGNATURE_MISMATCH'), ('NON_COMPLIANT_OPERATION'), ('PERIOD_CLOSED_OPERATION'), ('LATE_OFFLINE_SYNC'),
  ('IDEMPOTENCY_CONFLICT'), ('VOID_CONFLICT'), ('ONLINE_CONFIRMED_MISSING')) v(k)
  WHERE pg_temp.code(format($q$SELECT open_offline_anomaly(%L, %L, %L, NULL, %s, %L, %s, 'OPERATOR', NULL, NULL)$q$,
    pg_temp.id('47f001'), k, pg_temp.id('47aa01'), 100 + length(k), pg_temp.id('471001'),
    CASE WHEN k = 'OFFLINE_SHORTFALL' THEN 5 ELSE 0 END)) = 'OK'), 11, 'les onze types sont ouvrables');
SELECT is(pg_temp.code($$SELECT open_offline_anomaly(pg_temp.id('47f001'), 'CASH_DIFF', NULL, NULL, NULL, NULL, 0, NULL, NULL, NULL)$$),
  'CL001', 'type du CHECK hors liste (CASH_DIFF) : CL001');
SELECT is(pg_temp.code($$SELECT open_offline_anomaly(pg_temp.id('47f001'), 'INCONNU', NULL, NULL, NULL, NULL, 0, NULL, NULL, NULL)$$),
  'CL001', 'type inconnu : CL001');
SELECT is(pg_temp.code($$SELECT open_offline_anomaly(pg_temp.id('47f001'), '', NULL, NULL, NULL, NULL, 0, NULL, NULL, NULL)$$),
  'CL001', 'type vide : CL001');
SELECT is(pg_temp.code($$SELECT open_offline_anomaly(pg_temp.id('47f001'), NULL, NULL, NULL, NULL, NULL, 0, NULL, NULL, NULL)$$),
  'CL001', 'type NULL : CL001');
SELECT is(pg_temp.code($$SELECT open_offline_anomaly(pg_temp.id('47f001'), 'CLOCK_SKEW', NULL, NULL, NULL, NULL, -1, NULL, NULL, NULL)$$),
  'CL001', 'montant négatif : CL001');
SELECT is(pg_temp.code($$SELECT open_offline_anomaly(pg_temp.id('47f001'), 'OFFLINE_SHORTFALL', NULL, NULL, NULL, NULL, 5, NULL, NULL, NULL)$$),
  'CL001', 'OFFLINE_SHORTFALL sans transaction : CL001');
SELECT is(pg_temp.code($$SELECT open_offline_anomaly(pg_temp.id('47f001'), 'OFFLINE_SHORTFALL', NULL, NULL, NULL, pg_temp.id('471001'), 0, NULL, NULL, NULL)$$),
  'CL001', 'OFFLINE_SHORTFALL de montant 0 : CL001');
SELECT is(pg_temp.code($$SELECT open_offline_anomaly(pg_temp.id('47f001'), 'NON_COMPLIANT_OPERATION', NULL, NULL, NULL, NULL, 0, NULL, NULL, NULL)$$),
  'CL001', 'NON_COMPLIANT_OPERATION sans porteur de la perte : CL001');
SELECT is(pg_temp.code($$SELECT open_offline_anomaly(pg_temp.id('47f001'), 'CLOCK_SKEW', NULL, NULL, NULL, NULL, 0, 'AUTRE', NULL, NULL)$$),
  'CL001', 'porteur de la perte inconnu : CL001');
SELECT is(pg_temp.code($$SELECT open_offline_anomaly(pg_temp.id('47f001'), 'CLOCK_SKEW', NULL, NULL, NULL, NULL, 0, NULL, '[1]'::jsonb, NULL)$$),
  'CL001', 'détail qui n''est pas un objet : CL001');
-- chemin en ligne : CLOCK_SKEW, lot et numéro NULL, transaction renseignée, montant 0
SELECT is(pg_temp.code($$SELECT open_offline_anomaly(pg_temp.id('47f001'), 'CLOCK_SKEW', NULL, NULL, NULL, pg_temp.id('471002'), 0, NULL, '{"skew_s":400}', NULL)$$),
  'OK', 'CLOCK_SKEW en ligne (lot NULL, numéro NULL, transaction)');
SELECT is((SELECT detail->>'skew_s' FROM anomaly WHERE kind = 'CLOCK_SKEW' AND transaction_id = pg_temp.id('471002')),
  '400', 'le détail est écrit');
-- sans grand livre : seulement montant 0, prestataire pris sur le terminal
SELECT is(pg_temp.code($$SELECT open_offline_anomaly(NULL, 'SIGNATURE_MISMATCH', pg_temp.id('47aa01'), pg_temp.id('473001'), NULL, NULL, 0, NULL, NULL, NULL)$$),
  'OK', 'sans grand livre, montant 0, terminal de A : accepté');
SELECT is((SELECT operator_id FROM anomaly WHERE kind = 'SIGNATURE_MISMATCH' AND ledger_id IS NULL AND device_id = pg_temp.id('47aa01')),
  pg_temp.id('47a001'), 'prestataire pris sur le terminal');
SELECT is(pg_temp.code($$SELECT open_offline_anomaly(NULL, 'SIGNATURE_MISMATCH', pg_temp.id('47aa01'), NULL, 9, NULL, 7, NULL, NULL, NULL)$$),
  'CL001', 'sans grand livre avec montant : CL001');
SELECT is(pg_temp.code($$SELECT open_offline_anomaly(NULL, 'SIGNATURE_MISMATCH', NULL, NULL, 9, NULL, 0, NULL, NULL, NULL)$$),
  'P0002', 'sans grand livre ni terminal ni bracelet : introuvable');
-- prestataire
SELECT is(pg_temp.code($$SELECT open_offline_anomaly(pg_temp.id('47f011'), 'CLOCK_SKEW', NULL, NULL, NULL, NULL, 0, NULL, NULL, NULL)$$),
  'P0002', 'grand livre de B vu par A : introuvable');
SELECT is(pg_temp.code($$SELECT open_offline_anomaly(pg_temp.id('47f001'), 'CLOCK_SKEW', pg_temp.id('47ab01'), NULL, 1, NULL, 0, NULL, NULL, NULL)$$),
  'CL001', 'terminal de B avec grand livre de A : CL001');
SELECT is(pg_temp.code($$SELECT open_offline_anomaly(pg_temp.id('47f001'), 'CLOCK_SKEW', NULL, pg_temp.id('4730b1'), 2, NULL, 0, NULL, NULL, NULL)$$),
  'CL001', 'bracelet de B avec grand livre de A : CL001');
SELECT is(pg_temp.code($$SELECT open_offline_anomaly(pg_temp.id('47f001'), 'CLOCK_SKEW', NULL, NULL, 3, pg_temp.id('4710b1'), 0, NULL, NULL, NULL)$$),
  'CL001', 'transaction de B avec grand livre de A : CL001');
SELECT is(pg_temp.code($$SELECT open_offline_anomaly(pg_temp.id('47f001'), 'CLOCK_SKEW', NULL, NULL, 4, NULL, 0, NULL, NULL, pg_temp.id('47bb0b'))$$),
  'CL001', 'lot de B avec grand livre de A : CL001');
SELECT is(pg_temp.code($$SELECT open_offline_anomaly(pg_temp.id('47f001'), 'CLOCK_SKEW', NULL, NULL, 5, NULL, 0, NULL, NULL, pg_temp.id('47bb01'))$$),
  'OK', 'lot de A : accepté');
SELECT is((SELECT batch_id FROM anomaly WHERE kind = 'CLOCK_SKEW' AND seq = 5), pg_temp.id('47bb01'), 'batch_id écrit');
SELECT pg_temp.none();
SELECT is(pg_temp.code($$SELECT open_offline_anomaly(pg_temp.id('47f001'), 'CLOCK_SKEW', NULL, NULL, 6, NULL, 0, NULL, NULL, NULL)$$),
  'P0002', 'sans prestataire de session : introuvable');
SELECT pg_temp.a();

-- 2. Idempotence ----------------------------------------------------------------------------------------------
CREATE TEMP TABLE ids47 (k text PRIMARY KEY, v uuid);
INSERT INTO ids47 SELECT 'i1', open_offline_anomaly(pg_temp.id('47f001'), 'VOID_CONFLICT', pg_temp.id('47aa02'), NULL, 11, pg_temp.id('471003'), 0, NULL, NULL, NULL);
SELECT is(open_offline_anomaly(pg_temp.id('47f001'), 'VOID_CONFLICT', pg_temp.id('47aa02'), NULL, 11, pg_temp.id('471003'), 0, NULL, '{"x":1}', NULL),
  (SELECT v FROM ids47 WHERE k = 'i1'), 'même quadruplet : même identifiant');
SELECT is((SELECT count(*)::int FROM anomaly WHERE kind = 'VOID_CONFLICT' AND device_id = pg_temp.id('47aa02') AND seq = 11), 1,
  'une seule ligne');
SELECT isnt(open_offline_anomaly(pg_temp.id('47f001'), 'VOID_CONFLICT', pg_temp.id('47aa02'), NULL, 12, pg_temp.id('471003'), 0, NULL, NULL, NULL),
  (SELECT v FROM ids47 WHERE k = 'i1'), 'autre numéro : autre anomalie');
INSERT INTO ids47 SELECT 'i2', open_offline_anomaly(pg_temp.id('47f001'), 'LATE_OFFLINE_SYNC', NULL, NULL, NULL, NULL, 0, NULL, NULL, NULL);
SELECT is(open_offline_anomaly(pg_temp.id('47f001'), 'LATE_OFFLINE_SYNC', NULL, NULL, NULL, NULL, 0, NULL, NULL, NULL),
  (SELECT v FROM ids47 WHERE k = 'i2'), 'NULL égaux entre eux : même identifiant');
INSERT INTO ids47 SELECT 'i3', open_offline_anomaly(pg_temp.id('47f001'), 'SEQ_GAP', pg_temp.id('47aa02'), NULL, 20, NULL, 0, NULL, NULL, NULL);
SELECT is(open_offline_anomaly(pg_temp.id('47f001'), 'SEQ_GAP', pg_temp.id('47aa02'), NULL, 20, NULL, 0, NULL, NULL, NULL),
  (SELECT v FROM ids47 WHERE k = 'i3'), 'SEQ_GAP rejoué : même identifiant');
-- SEQ_GAP déjà ouvert à la main (open_offline_batch) : l'index anomaly_seq_gap_once ne fait pas échouer l'appel
INSERT INTO anomaly (id, operator_id, ledger_id, kind, device_id, seq, amount)
VALUES (pg_temp.id('47a0f1'), pg_temp.id('47a001'), pg_temp.id('47f001'), 'SEQ_GAP', pg_temp.id('47aa02'), 21, 0);
SELECT is(open_offline_anomaly(pg_temp.id('47f001'), 'SEQ_GAP', pg_temp.id('47aa02'), NULL, 21, NULL, 0, NULL, NULL, NULL),
  pg_temp.id('47a0f1'), 'SEQ_GAP déjà présent : sa ligne est rendue');

-- 3. reduce_offline_shortfall -------------------------------------------------------------------------------
INSERT INTO ids47 SELECT 's1', open_offline_anomaly(pg_temp.id('47f001'), 'OFFLINE_SHORTFALL', pg_temp.id('47aa01'), NULL, 31, pg_temp.id('471004'), 1000, 'OPERATOR', NULL, NULL);
SELECT is(pg_temp.code($$SELECT reduce_offline_shortfall(pg_temp.id('471004'), 400, pg_temp.id('471001'))$$), 'OK', 'réduction partielle');
SELECT is((SELECT amount FROM anomaly WHERE id = (SELECT v FROM ids47 WHERE k = 's1')), 600::bigint, 'reste 600');
SELECT is((SELECT status FROM anomaly WHERE id = (SELECT v FROM ids47 WHERE k = 's1')), 'OPEN', 'toujours ouvert');
SELECT is((SELECT resolution_tx_id FROM anomaly WHERE id = (SELECT v FROM ids47 WHERE k = 's1')), NULL, 'pas de transaction de résolution');
SELECT reduce_offline_shortfall(pg_temp.id('471004'), 400, pg_temp.id('471001'));
SELECT is((SELECT amount FROM anomaly WHERE id = (SELECT v FROM ids47 WHERE k = 's1')), 600::bigint, 'rejeu de la même annulation : aucun second effet');
SELECT is((SELECT jsonb_array_length(detail->'reductions') FROM anomaly WHERE id = (SELECT v FROM ids47 WHERE k = 's1')), 1,
  'une réduction consignée');
SELECT is(pg_temp.code($$SELECT reduce_offline_shortfall(pg_temp.id('471004'), 601, pg_temp.id('471002'))$$), 'CL001', 'montant excessif : CL001');
SELECT is(pg_temp.code($$SELECT reduce_offline_shortfall(pg_temp.id('471004'), 0, pg_temp.id('471002'))$$), 'CL001', 'montant nul : CL001');
SELECT is(pg_temp.code($$SELECT reduce_offline_shortfall(pg_temp.id('471004'), 100, NULL)$$), 'CL001', 'annulation absente : CL001');
SELECT is(pg_temp.code($$SELECT reduce_offline_shortfall(pg_temp.id('471004'), 100, pg_temp.id('4710b1'))$$), 'CL001',
  'annulation d''un autre prestataire : CL001');
SELECT is((SELECT amount FROM anomaly WHERE id = (SELECT v FROM ids47 WHERE k = 's1')), 600::bigint, 'refus : rien changé');
SELECT is(pg_temp.code($$SELECT reduce_offline_shortfall(pg_temp.id('471004'), 600, pg_temp.id('471002'))$$), 'OK', 'réduction totale');
SELECT is((SELECT status || ':' || amount FROM anomaly WHERE id = (SELECT v FROM ids47 WHERE k = 's1')), 'RESOLVED:0', 'RESOLVED, montant 0');
SELECT is((SELECT resolution_tx_id FROM anomaly WHERE id = (SELECT v FROM ids47 WHERE k = 's1')), pg_temp.id('471002'),
  'resolution_tx_id = annulation qui a soldé');
SELECT is(pg_temp.code($$SELECT reduce_offline_shortfall(pg_temp.id('471004'), 1, pg_temp.id('471003'))$$), 'CL001',
  'manque soldé, autre annulation : CL001 (plus rien à réduire)');
SELECT is(pg_temp.code($$SELECT reduce_offline_shortfall(pg_temp.id('471004'), 600, pg_temp.id('471002'))$$), 'OK',
  'rejeu de l''annulation finale : sans effet');
SELECT is(pg_temp.code($$SELECT reduce_offline_shortfall(pg_temp.id('471003'), 50, pg_temp.id('471002'))$$), 'OK',
  'vente sans manque : aucun effet');
SELECT is((SELECT count(*)::int FROM anomaly WHERE kind = 'OFFLINE_SHORTFALL' AND transaction_id = pg_temp.id('471003')), 0, 'aucune anomalie créée');
SELECT pg_temp.b();
SELECT is(pg_temp.code($$SELECT reduce_offline_shortfall(pg_temp.id('471004'), 1, pg_temp.id('4710b1'))$$), 'P0002',
  'transaction de A vue par B : introuvable');
SELECT pg_temp.a();

-- 4. Alertes ---------------------------------------------------------------------------------------------------
INSERT INTO ids47 SELECT 'g_old', open_offline_anomaly(pg_temp.id('47f001'), 'SEQ_GAP', pg_temp.id('47aa02'), NULL, 41, NULL, 0, NULL, NULL, NULL);
INSERT INTO ids47 SELECT 'g_new', open_offline_anomaly(pg_temp.id('47f001'), 'SEQ_GAP', pg_temp.id('47aa02'), NULL, 42, NULL, 0, NULL, NULL, NULL);
INSERT INTO ids47 SELECT 'g_res', open_offline_anomaly(pg_temp.id('47f001'), 'SEQ_GAP', pg_temp.id('47aa02'), NULL, 43, NULL, 0, NULL, NULL, NULL);
UPDATE anomaly SET created_at = clock_timestamp() - interval '30 hours' WHERE id IN (SELECT v FROM ids47 WHERE k IN ('g_old', 'g_res'));
UPDATE anomaly SET status = 'RESOLVED' WHERE id = (SELECT v FROM ids47 WHERE k = 'g_res');
SELECT is((SELECT count(*)::int FROM offline_seq_gaps_to_alert(interval '24 hours') WHERE anomaly_id = (SELECT v FROM ids47 WHERE k = 'g_old')), 1,
  'trou de 30 h listé');
SELECT is((SELECT count(*)::int FROM offline_seq_gaps_to_alert(interval '24 hours') WHERE anomaly_id = (SELECT v FROM ids47 WHERE k = 'g_new')), 0,
  'trou jeune non listé');
SELECT is((SELECT count(*)::int FROM offline_seq_gaps_to_alert(interval '24 hours') WHERE anomaly_id = (SELECT v FROM ids47 WHERE k = 'g_res')), 0,
  'trou résolu non listé');
SELECT is((SELECT seq || ':' || operator_id FROM offline_seq_gaps_to_alert(interval '24 hours') WHERE anomaly_id = (SELECT v FROM ids47 WHERE k = 'g_old')),
  '41:' || pg_temp.id('47a001'), 'colonnes rendues : numéro et prestataire');
SELECT is(pg_temp.code($$SELECT offline_seq_gaps_to_alert(NULL)$$), 'CL001', 'durée NULL : CL001');
SELECT is(pg_temp.code($$SELECT offline_seq_gaps_to_alert(interval '-1 second')$$), 'CL001', 'durée négative : CL001');
SELECT is(pg_temp.code($$SELECT offline_seq_gaps_to_alert(interval '31 days')$$), 'CL001', 'durée de 31 jours : CL001');
SELECT is(pg_temp.code($$SELECT offline_seq_gaps_to_alert(interval '30 days')$$), 'OK', 'durée de 30 jours : permise');
SELECT is(pg_temp.code($$SELECT offline_retries_to_alert(interval '31 days')$$), 'CL001', 'RETRY : durée de 31 jours : CL001');
SELECT is(pg_temp.code($$SELECT offline_retries_to_alert(NULL)$$), 'CL001', 'RETRY : durée NULL : CL001');
SELECT mark_seq_gap_alerted((SELECT v FROM ids47 WHERE k = 'g_old'));
SELECT is((SELECT count(*)::int FROM offline_seq_gaps_to_alert(interval '24 hours') WHERE anomaly_id = (SELECT v FROM ids47 WHERE k = 'g_old')), 0,
  'après mark_… : plus listé');
CREATE TEMP TABLE al47 AS SELECT detail->>'alerted_at' AS d FROM anomaly WHERE id = (SELECT v FROM ids47 WHERE k = 'g_old');
SELECT isnt((SELECT d FROM al47), NULL, 'alerted_at posé');
SELECT mark_seq_gap_alerted((SELECT v FROM ids47 WHERE k = 'g_old'));
SELECT is((SELECT detail->>'alerted_at' FROM anomaly WHERE id = (SELECT v FROM ids47 WHERE k = 'g_old')), (SELECT d FROM al47),
  'second appel : alerted_at inchangé');
SELECT is((SELECT status || ':' || amount FROM anomaly WHERE id = (SELECT v FROM ids47 WHERE k = 'g_old')), 'OPEN:0', 'statut et montant inchangés');
SELECT is(pg_temp.code(format($$SELECT mark_seq_gap_alerted(%L)$$, (SELECT v FROM ids47 WHERE k = 's1'))), 'CL001',
  'mark_… sur une anomalie qui n''est pas un SEQ_GAP : CL001');
SELECT is(pg_temp.code($$SELECT mark_seq_gap_alerted(NULL)$$), 'P0002', 'mark_… sur NULL : introuvable');
SELECT pg_temp.b();
SELECT is(pg_temp.code(format($$SELECT mark_seq_gap_alerted(%L)$$, (SELECT v FROM ids47 WHERE k = 'g_new'))), 'P0002',
  'session de B sur une anomalie de A : introuvable');
SELECT pg_temp.a();
-- RETRY : ouvert vieux, jeune, clos, alerté
INSERT INTO offline_batch_retry (batch_id, seq, operator_id, device_id, reason, created_at) VALUES
 (pg_temp.id('47bb01'), 1, pg_temp.id('47a001'), pg_temp.id('47aa01'), 'INSUFFICIENT_FUNDS_RETRY', clock_timestamp() - interval '30 hours'),
 (pg_temp.id('47bb01'), 2, pg_temp.id('47a001'), pg_temp.id('47aa01'), 'INSUFFICIENT_FUNDS_RETRY', clock_timestamp()),
 (pg_temp.id('47bb01'), 3, pg_temp.id('47a001'), pg_temp.id('47aa01'), 'INSUFFICIENT_FUNDS_RETRY', clock_timestamp() - interval '30 hours');
UPDATE offline_batch_retry SET closed_at = clock_timestamp() WHERE batch_id = pg_temp.id('47bb01') AND seq = 3;
SELECT is((SELECT array_agg(seq ORDER BY seq) FROM offline_retries_to_alert(interval '24 hours')), ARRAY[1::bigint],
  'RETRY : seul le numéro ouvert depuis 30 h est listé (jeune et clos exclus)');
SELECT is((SELECT operator_id || ':' || device_id FROM offline_retries_to_alert(interval '24 hours')),
  pg_temp.id('47a001') || ':' || pg_temp.id('47aa01'), 'RETRY : colonnes rendues');
SELECT pg_temp.b();
SELECT is(pg_temp.code($$SELECT mark_offline_retry_alerted(pg_temp.id('47bb01'), 1)$$), 'P0002', 'RETRY de A marqué par B : introuvable');
SELECT pg_temp.a();
SELECT is(pg_temp.code($$SELECT mark_offline_retry_alerted(pg_temp.id('47bb01'), 99)$$), 'P0002', 'RETRY inexistant : introuvable');
SELECT mark_offline_retry_alerted(pg_temp.id('47bb01'), 1);
SELECT is((SELECT count(*)::int FROM offline_retries_to_alert(interval '24 hours')), 0, 'RETRY alerté : plus listé');
CREATE TEMP TABLE ra47 AS SELECT alerted_at AS d FROM offline_batch_retry WHERE batch_id = pg_temp.id('47bb01') AND seq = 1;
SELECT mark_offline_retry_alerted(pg_temp.id('47bb01'), 1);
SELECT is((SELECT alerted_at FROM offline_batch_retry WHERE batch_id = pg_temp.id('47bb01') AND seq = 1), (SELECT d FROM ra47),
  'RETRY : second appel, alerted_at inchangé');

-- 5. Historique du portefeuille : déclencheur ------------------------------------------------------------------
INSERT INTO wallet (id, operator_id, ledger_id) VALUES (pg_temp.id('472001'), pg_temp.id('47a001'), pg_temp.id('47f001'));
SELECT is((SELECT count(*)::int FROM wallet_status_history WHERE wallet_id = pg_temp.id('472001')), 0, 'portefeuille créé ACTIVE : aucune ligne');
UPDATE wallet SET last_activity_at = now() WHERE id = pg_temp.id('472001');
UPDATE wallet SET last_activity_at = now() + interval '1 second' WHERE id = pg_temp.id('472001');
UPDATE wallet SET status = 'ACTIVE' WHERE id = pg_temp.id('472001');
SELECT is((SELECT count(*)::int FROM wallet_status_history WHERE wallet_id = pg_temp.id('472001')), 0,
  'mise à jour sans changement de statut : aucune ligne');
UPDATE wallet SET status = 'BLOCKED' WHERE id = pg_temp.id('472001');
SELECT is((SELECT from_status || '>' || to_status FROM wallet_status_history WHERE wallet_id = pg_temp.id('472001')), 'ACTIVE>BLOCKED',
  'changement de statut : une ligne');
SELECT is((SELECT operator_id FROM wallet_status_history WHERE wallet_id = pg_temp.id('472001')), pg_temp.id('47a001'), 'prestataire de la ligne');
UPDATE wallet SET status = 'ACTIVE' WHERE id = pg_temp.id('472001');
SELECT is((SELECT count(*)::int FROM wallet_status_history WHERE wallet_id = pg_temp.id('472001')), 2, 'déblocage : seconde ligne');
INSERT INTO wallet (id, operator_id, ledger_id, status) VALUES (pg_temp.id('472002'), pg_temp.id('47a001'), pg_temp.id('47f001'), 'BLOCKED');
SELECT is((SELECT (from_status IS NULL)::text || '>' || to_status FROM wallet_status_history WHERE wallet_id = pg_temp.id('472002')),
  'true>BLOCKED', 'portefeuille créé bloqué : ligne de départ');
SELECT is(pg_temp.code($$UPDATE wallet_status_history SET to_status = 'ACTIVE'$$), 'P0001', 'UPDATE direct refusé (propriétaire inclus)');
SELECT is(pg_temp.code($$DELETE FROM wallet_status_history$$), 'P0001', 'DELETE direct refusé');
SELECT is(pg_temp.code($$TRUNCATE wallet_status_history$$), 'P0001', 'TRUNCATE refusé');
SELECT is((SELECT relrowsecurity::text || ':' || relforcerowsecurity::text FROM pg_class WHERE relname = 'wallet_status_history'),
  'true:true', 'RLS activée et forcée');
SELECT is((SELECT count(*)::int FROM pg_policies WHERE tablename = 'wallet_status_history' AND policyname = 'tenant_isolation'), 1,
  'politique tenant_isolation');
SELECT is((SELECT count(*)::int FROM information_schema.columns WHERE table_name = 'wallet_status_history' AND column_name = 'operator_id'), 1,
  'colonne operator_id');

-- 6. Ligne de départ (règle de la migration, rejouée sur des portefeuilles sans historique) --------------------
-- Les déclencheurs du journal sont différés : exécutés à l'instruction avant tout ALTER TABLE (0063, décision 28).
SET CONSTRAINTS ALL IMMEDIATE;
ALTER TABLE wallet DISABLE TRIGGER USER;
ALTER TABLE psp_topup DISABLE TRIGGER USER;
ALTER TABLE psp_chargeback DISABLE TRIGGER USER;
INSERT INTO wallet (id, operator_id, ledger_id, status, other_block) VALUES
 (pg_temp.id('472010'), pg_temp.id('47a001'), pg_temp.id('47f001'), 'BLOCKED', false),   -- contestation seule
 (pg_temp.id('472011'), pg_temp.id('47a001'), pg_temp.id('47f001'), 'BLOCKED', true),    -- autre cause aussi
 (pg_temp.id('472012'), pg_temp.id('47a001'), pg_temp.id('47f001'), 'BLOCKED', false),   -- sans contestation
 (pg_temp.id('472013'), pg_temp.id('47a001'), pg_temp.id('47f001'), 'CLOSED', false),    -- fermé, contestation
 (pg_temp.id('472014'), pg_temp.id('47a001'), pg_temp.id('47f001'), 'ACTIVE', false);
INSERT INTO psp_configuration (psp_configuration_id, operator_id, organizer_id, method, provider, holder_party_id,
    secret_ref, status, valid_from, created_by, approved_by, compliance_ref, activated_at, is_default)
VALUES (pg_temp.id('47ca01'), pg_temp.id('47a001'), pg_temp.id('47b001'), 'WAVE', 'WAVE', pg_temp.id('47b001'),
        'psp/' || pg_temp.id('47b001') || '/bwave', 'ACTIVE', now() - interval '2 days', pg_temp.id('47e001'), pg_temp.id('47e002'), 'REF', now(), true);
INSERT INTO psp_topup (psp_topup_id, operator_id, ledger_id, event_id, wallet_id, psp_configuration_id, method,
    provider, amount, currency, expires_at, requested_by_kind, device_id, person_id)
SELECT pg_temp.id(t), pg_temp.id('47a001'), pg_temp.id('47f001'), pg_temp.id('47d001'), pg_temp.id(w),
       pg_temp.id('47ca01'), 'WAVE', 'WAVE', 1000, 'XOF', now() + interval '1 day', 'DESK',
       pg_temp.id('47aa01'), pg_temp.id('47e001')
  FROM (VALUES ('474010', '472010'), ('474011', '472011'), ('474013', '472013'), ('474014', '472013')) v(t, w);
INSERT INTO psp_chargeback (psp_configuration_id, operator_id, provider_dispute_id, psp_topup_id, amount, wallet_blocked, blocked_at)
VALUES (pg_temp.id('47ca01'), pg_temp.id('47a001'), 'd10', pg_temp.id('474010'), 10, true, '2026-02-10 10:00+00'),
       (pg_temp.id('47ca01'), pg_temp.id('47a001'), 'd11', pg_temp.id('474011'), 10, true, '2026-02-11 10:00+00'),
       (pg_temp.id('47ca01'), pg_temp.id('47a001'), 'd13', pg_temp.id('474013'), 10, true, '2026-02-13 10:00+00'),
       (pg_temp.id('47ca01'), pg_temp.id('47a001'), 'd14', pg_temp.id('474014'), 10, true, '2026-02-09 10:00+00');
ALTER TABLE wallet ENABLE TRIGGER USER;
ALTER TABLE psp_topup ENABLE TRIGGER USER;
ALTER TABLE psp_chargeback ENABLE TRIGGER USER;
-- Même instruction que la migration 0047 (restreinte aux portefeuilles de la suite sans historique)
INSERT INTO wallet_status_history (wallet_id, operator_id, from_status, to_status, at)
SELECT w.id, w.operator_id, NULL, w.status,
       CASE WHEN w.status = 'BLOCKED' AND w.other_block THEN '-infinity'::timestamptz
            ELSE coalesce((SELECT min(c.blocked_at) FROM psp_chargeback c
                             JOIN psp_topup t ON t.psp_topup_id = c.psp_topup_id
                            WHERE t.wallet_id = w.id AND c.blocked_at IS NOT NULL), '-infinity'::timestamptz)
       END
  FROM wallet w
 WHERE w.status IN ('BLOCKED','CLOSED') AND w.id IN (SELECT pg_temp.id(x) FROM unnest(ARRAY['472010','472011','472012','472013','472014']) x);
SELECT is((SELECT at FROM wallet_status_history WHERE wallet_id = pg_temp.id('472010')), '2026-02-10 10:00+00'::timestamptz,
  'bloqué par contestation seule : date du blocage de la contestation');
SELECT is((SELECT at FROM wallet_status_history WHERE wallet_id = pg_temp.id('472011')), '-infinity'::timestamptz,
  'bloqué aussi pour une autre cause : -infinity (jamais plus tardif que la réalité)');
SELECT is((SELECT at FROM wallet_status_history WHERE wallet_id = pg_temp.id('472012')), '-infinity'::timestamptz,
  'bloqué sans date connue : -infinity');
SELECT is((SELECT at FROM wallet_status_history WHERE wallet_id = pg_temp.id('472013')), '2026-02-09 10:00+00'::timestamptz,
  'fermé : plus ancienne contestation de ses recharges');
SELECT is((SELECT count(*)::int FROM wallet_status_history WHERE wallet_id = pg_temp.id('472014')), 0, 'portefeuille actif : pas de ligne de départ');

-- 7. offline_block_time -----------------------------------------------------------------------------------------
-- Entités sans déclencheur d'historique, historiques posés à la main (dates fixes).
-- Les déclencheurs du journal sont différés : exécutés à l'instruction avant tout ALTER TABLE (0063, décision 28).
SET CONSTRAINTS ALL IMMEDIATE;
ALTER TABLE wallet DISABLE TRIGGER USER;
ALTER TABLE media DISABLE TRIGGER USER;
ALTER TABLE media_batch DISABLE TRIGGER USER;
INSERT INTO media_batch (id, operator_id, organizer_id, kind, quantity, key_index, status) VALUES
 (pg_temp.id('47ba02'), pg_temp.id('47a001'), pg_temp.id('47b001'), 'PUBLIC', 10, 1, 'SUSPENDED'),
 (pg_temp.id('47ba03'), pg_temp.id('47a001'), pg_temp.id('47b001'), 'PUBLIC', 10, 1, 'ACTIVE'),
 (pg_temp.id('47ba04'), pg_temp.id('47a001'), pg_temp.id('47b001'), 'PUBLIC', 10, 1, 'CLOSED');
INSERT INTO media (id, operator_id, kind, token_hash, nfc_uid, batch_id, key_index, status) VALUES
 (pg_temp.id('473101'), pg_temp.id('47a001'), 'NFC_TAG', sha256('m101'::bytea), decode('04000000000101', 'hex'), pg_temp.id('47ba03'), 1, 'SUSPENDED'),
 (pg_temp.id('473102'), pg_temp.id('47a001'), 'NFC_TAG', sha256('m102'::bytea), decode('04000000000102', 'hex'), pg_temp.id('47ba03'), 1, 'ACTIVE'),
 (pg_temp.id('473103'), pg_temp.id('47a001'), 'NFC_TAG', sha256('m103'::bytea), decode('04000000000103', 'hex'), pg_temp.id('47ba02'), 1, 'ACTIVE'),
 (pg_temp.id('473104'), pg_temp.id('47a001'), 'NFC_TAG', sha256('m104'::bytea), decode('04000000000104', 'hex'), NULL, 1, 'BLACKLISTED'),
 (pg_temp.id('473105'), pg_temp.id('47a001'), 'NFC_TAG', sha256('m105'::bytea), decode('04000000000105', 'hex'), pg_temp.id('47ba03'), 1, 'ACTIVE'),
 (pg_temp.id('473106'), pg_temp.id('47a001'), 'NFC_TAG', sha256('m106'::bytea), decode('04000000000106', 'hex'), pg_temp.id('47ba04'), 1, 'ACTIVE');
INSERT INTO wallet (id, operator_id, ledger_id, status) VALUES
 (pg_temp.id('472100'), pg_temp.id('47a001'), pg_temp.id('47f001'), 'BLOCKED'),   -- bloqué le 05/01
 (pg_temp.id('472101'), pg_temp.id('47a001'), pg_temp.id('47f001'), 'BLOCKED'),   -- sans historique
 (pg_temp.id('472102'), pg_temp.id('47a001'), pg_temp.id('47f001'), 'ACTIVE'),    -- débloqué
 (pg_temp.id('472103'), pg_temp.id('47a001'), pg_temp.id('47f001'), 'BLOCKED'),   -- bloqué, débloqué, rebloqué
 (pg_temp.id('472104'), pg_temp.id('47a001'), pg_temp.id('47f001'), 'CLOSED'),    -- BLOCKED puis CLOSED
 (pg_temp.id('472105'), pg_temp.id('47a001'), pg_temp.id('47f001'), 'ACTIVE');    -- jamais bloqué
ALTER TABLE wallet ENABLE TRIGGER USER;
ALTER TABLE media ENABLE TRIGGER USER;
ALTER TABLE media_batch ENABLE TRIGGER USER;
INSERT INTO wallet_status_history (wallet_id, operator_id, from_status, to_status, at)
SELECT pg_temp.id(w), pg_temp.id('47a001'), f, t, a::timestamptz FROM (VALUES
 ('472100', NULL, 'ACTIVE', '2026-01-01'), ('472100', 'ACTIVE', 'BLOCKED', '2026-01-05'),
 ('472102', 'ACTIVE', 'BLOCKED', '2026-01-03'), ('472102', 'BLOCKED', 'ACTIVE', '2026-01-04'),
 ('472103', 'ACTIVE', 'BLOCKED', '2026-01-10'), ('472103', 'BLOCKED', 'ACTIVE', '2026-01-15'),
 ('472103', 'ACTIVE', 'BLOCKED', '2026-01-20'),
 ('472104', 'ACTIVE', 'BLOCKED', '2026-01-07'), ('472104', 'BLOCKED', 'CLOSED', '2026-01-09')) v(w, f, t, a);
INSERT INTO media_status_history (operator_id, media_id, from_status, to_status, at)
SELECT pg_temp.id('47a001'), pg_temp.id(m), f, t, a::timestamptz FROM (VALUES
 ('473101', NULL, 'ACTIVE', '2026-01-01'), ('473101', 'ACTIVE', 'SUSPENDED', '2026-01-12'),
 ('473101', 'SUSPENDED', 'BLACKLISTED', '2026-01-14'),
 ('473102', NULL, 'ACTIVE', '2026-01-01'), ('473102', 'ACTIVE', 'SUSPENDED', '2026-01-02'),
 ('473102', 'SUSPENDED', 'ACTIVE', '2026-01-03'),
 ('473103', NULL, 'ACTIVE', '2026-01-01'),
 ('473104', NULL, 'ACTIVE', '2026-01-01'), ('473104', 'ACTIVE', 'BLACKLISTED', '2026-01-25')) v(m, f, t, a);
INSERT INTO media_batch_status_history (operator_id, batch_id, from_status, to_status, at)
SELECT pg_temp.id('47a001'), pg_temp.id(b), f, t, a::timestamptz FROM (VALUES
 ('47ba02', 'ACTIVE', 'SUSPENDED', '2026-01-08'),
 ('47ba04', 'ACTIVE', 'CLOSED', '2026-01-30')) v(b, f, t, a);
-- Portefeuille
SELECT is(offline_block_time(NULL, pg_temp.id('472100'), NULL), '2026-01-05'::timestamptz, 'portefeuille bloqué le 05/01');
SELECT is(offline_block_time(NULL, pg_temp.id('472101'), NULL), '-infinity'::timestamptz, 'portefeuille bloqué sans historique : -infinity');
SELECT is(offline_block_time(NULL, pg_temp.id('472102'), NULL), NULL::timestamptz, 'portefeuille débloqué : NULL');
SELECT is(offline_block_time(NULL, pg_temp.id('472105'), NULL), NULL::timestamptz, 'portefeuille jamais bloqué : NULL');
SELECT is(offline_block_time(NULL, pg_temp.id('472103'), NULL), '2026-01-20'::timestamptz,
  'bloqué, débloqué, rebloqué : début du dernier blocage (pas l''ancien)');
SELECT is(offline_block_time(NULL, pg_temp.id('472103'), '2026-01-12'::timestamptz), '2026-01-10'::timestamptz,
  'p_before pendant le premier blocage : son début');
SELECT is(offline_block_time(NULL, pg_temp.id('472103'), '2026-01-17'::timestamptz), NULL::timestamptz,
  'p_before pendant le déblocage : rien en vigueur, NULL');
SELECT is(offline_block_time(NULL, pg_temp.id('472103'), '2026-01-02'::timestamptz), NULL::timestamptz,
  'p_before avant tout blocage : NULL (blocage postérieur)');
SELECT is(offline_block_time(NULL, pg_temp.id('472104'), NULL), '2026-01-07'::timestamptz, 'BLOCKED puis CLOSED : début de la suite bloquée');
-- Bracelet et lot
SELECT is(offline_block_time(pg_temp.id('473104'), NULL, NULL), '2026-01-25'::timestamptz, 'bracelet sans lot, liste noire le 25/01');
SELECT is(offline_block_time(pg_temp.id('473102'), NULL, NULL), NULL::timestamptz, 'bracelet réactivé depuis : NULL, pas l''ancien blocage');
SELECT is(offline_block_time(pg_temp.id('473105'), NULL, NULL), NULL::timestamptz, 'bracelet actif, lot actif : NULL');
SELECT is(offline_block_time(pg_temp.id('473101'), NULL, NULL), '2026-01-12'::timestamptz,
  'SUSPENDED puis BLACKLISTED : début de la suite bloquée (12/01)');
SELECT is(offline_block_time(pg_temp.id('473103'), NULL, NULL), '2026-01-08'::timestamptz, 'lot suspendu seul : date du lot');
SELECT is(offline_block_time(pg_temp.id('473106'), NULL, NULL), '2026-01-30'::timestamptz, 'lot fermé : date du lot');
-- Combinaisons : la plus ancienne ; inconnue = -infinity
SELECT is(offline_block_time(pg_temp.id('473101'), pg_temp.id('472100'), NULL), '2026-01-05'::timestamptz,
  'bracelet 12/01 et portefeuille 05/01 : la plus ancienne');
SELECT is(offline_block_time(pg_temp.id('473103'), pg_temp.id('472100'), NULL), '2026-01-05'::timestamptz,
  'lot 08/01 et portefeuille 05/01 : 05/01');
SELECT is(offline_block_time(pg_temp.id('473103'), pg_temp.id('472104'), NULL), '2026-01-07'::timestamptz,
  'lot 08/01 et portefeuille 07/01 : 07/01');
SELECT is(offline_block_time(pg_temp.id('473104'), pg_temp.id('472101'), NULL), '-infinity'::timestamptz,
  'une source de date inconnue : -infinity');
SELECT is(offline_block_time(pg_temp.id('473102'), pg_temp.id('472105'), NULL), NULL::timestamptz, 'aucune source bloquante : NULL');
SELECT is(offline_block_time(pg_temp.id('473104'), pg_temp.id('472102'), NULL), '2026-01-25'::timestamptz,
  'portefeuille débloqué ignoré, bracelet bloqué retenu');
-- Paramètres et prestataire
SELECT is(pg_temp.code($$SELECT offline_block_time(NULL, NULL, NULL)$$), 'CL001', 'ni bracelet ni portefeuille : CL001');
SELECT is(pg_temp.code($$SELECT offline_block_time(pg_temp.id('4730b1'), NULL, NULL)$$), 'P0002', 'bracelet de B vu par A : introuvable');
SELECT is(pg_temp.code($$SELECT offline_block_time(pg_temp.id('473104'), pg_temp.id('472100'), NULL)$$), 'OK', 'bracelet et portefeuille de A : accepté');
SELECT pg_temp.b();
SELECT is(pg_temp.code($$SELECT offline_block_time(NULL, pg_temp.id('472100'), NULL)$$), 'P0002', 'portefeuille de A vu par B : introuvable');
SELECT pg_temp.a();

-- 8. Propriétés des fonctions --------------------------------------------------------------------------------
SELECT is((SELECT count(*)::int FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
   AND p.proname IN ('open_offline_anomaly','reduce_offline_shortfall','mark_seq_gap_alerted','offline_seq_gaps_to_alert',
                     'offline_retries_to_alert','mark_offline_retry_alerted','offline_block_time','log_wallet_status')), 8,
  'huit fonctions');
SELECT is((SELECT count(*)::int FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
   AND p.proname IN ('open_offline_anomaly','reduce_offline_shortfall','mark_seq_gap_alerted','offline_seq_gaps_to_alert',
                     'offline_retries_to_alert','mark_offline_retry_alerted','offline_block_time','log_wallet_status')
   AND p.prosecdef AND p.proconfig @> ARRAY['search_path=public, pg_temp']), 8, 'toutes SECURITY DEFINER avec search_path = public, pg_temp');
SELECT is((SELECT count(*)::int FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
   AND p.proname IN ('open_offline_anomaly','reduce_offline_shortfall','mark_seq_gap_alerted','offline_seq_gaps_to_alert',
                     'offline_retries_to_alert','mark_offline_retry_alerted','offline_block_time','log_wallet_status')
   AND (p.proacl IS NULL OR EXISTS (SELECT 1 FROM aclexplode(p.proacl) x WHERE x.grantee = 0))), 0,
  'aucune fonction exécutable par PUBLIC');
SELECT is((SELECT count(*)::int FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
   AND p.proname IN ('offline_seq_gaps_to_alert','offline_retries_to_alert','offline_block_time') AND p.provolatile = 's'), 3,
  'les trois fonctions de lecture sont STABLE');
SELECT is((SELECT count(*)::int FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
   AND p.proname IN ('log_wallet_status')
   AND EXISTS (SELECT 1 FROM aclexplode(p.proacl) x WHERE x.grantee <> p.proowner)), 0,
  'aucun GRANT sur la fonction de déclencheur (les accords nominatifs : tests_offline_rights.sql, WP08)');
SELECT is((SELECT format_type(prorettype, NULL) FROM pg_proc WHERE proname = 'open_offline_anomaly'), 'uuid', 'open_offline_anomaly rend un uuid');

SELECT * FROM finish();
ROLLBACK;
