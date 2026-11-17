-- Fonctions d'exploitation ops_* (migration 0087, mission 9b, lot WP05 ; FR-020, FR-021, NFR-005, C-010, C-011) — pgTAP.
-- Suite du propriétaire : aucun droit n'est accordé par ce lot (WP06). Lancer : pg_prove -d <base> tests/tests_ops_functions.sql
\set ON_ERROR_STOP 1
\set QUIET 1
BEGIN;
\ir _grants_for_tests.sql
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

CREATE FUNCTION pg_temp.id(p text) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT ('00000000-0000-0000-0000-' || lpad(p, 12, '0'))::uuid $$;

-- 1. Catalogue : signatures, DEFINER, search_path, PUBLIC ---------------------------------------------------------
CREATE TEMP TABLE sig (fn text, args text[]);
INSERT INTO sig VALUES
 ('ops_ledgers_to_seal', '{}'), ('ops_seal_ledger', '{uuid}'), ('ops_audit_chains_to_seal', '{}'),
 ('ops_seal_audit', '{uuid}'), ('ops_record_seal_copy', '{text,uuid,integer,text}'),
 ('ops_seals_since', '{interval}'), ('ops_verify_ledger_seals', '{uuid,integer}'),
 ('ops_verify_audit_chain', '{uuid,timestamp with time zone}'), ('ops_ledger_controls', '{text}'),
 ('ops_overdue_payouts', '{interval}'), ('ops_unmatched_statements', '{interval}'),
 ('ops_new_open_anomalies', '{timestamp with time zone}'), ('ops_raise_alert', '{integer,jsonb}'),
 ('ops_long_transactions', '{interval}');
SELECT is((SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname LIKE 'ops\_%'),
  (SELECT count(*) FROM sig), 'ops_* : liste exacte (une fonction de plus fait échouer la suite)');
SELECT is((SELECT count(*) FROM sig s JOIN pg_proc p ON p.pronamespace = 'public'::regnamespace AND p.proname = s.fn
            AND p.oid::regprocedure::text = s.fn || '(' || array_to_string(s.args, ',') || ')'),
  (SELECT count(*) FROM sig), 'signatures exactes');
SELECT is((SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'ops\_%'
            AND p.prosecdef AND 'search_path=public, pg_temp' = ANY (p.proconfig)), (SELECT count(*) FROM sig),
  'ops_* : SECURITY DEFINER, search_path = public, pg_temp');
SELECT is((SELECT count(*) FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
            WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'ops\_%' AND a.grantee = 0
              AND a.privilege_type = 'EXECUTE'), 0::bigint, 'ops_* : EXECUTE retiré à PUBLIC');
SELECT is((SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'ops\_%'
            AND p.prosrc ~* 'assert_tenant\('), 0::bigint, 'ops_* : aucun assert_tenant');
-- Aucune colonne rendue ne porte un nom de donnée sensible (la liste ne s'élargit pas en silence).
SELECT is((SELECT string_agg(DISTINCT n, ' ') FROM pg_proc p, unnest(p.proargnames) n
            WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'ops\_%'
              AND n IN ('amount', 'balance', 'iban', 'msisdn', 'query', 'phone', 'name', 'legal_name', 'client_addr')),
  NULL, 'ops_* : aucune colonne amount, balance, iban, msisdn, query');
SELECT is((SELECT proargnames FROM pg_proc WHERE proname = 'ops_long_transactions'),
  ARRAY['p_max', 'pid', 'usename', 'application_name', 'xact_seconds'],
  'ops_long_transactions : pas de colonne query');

-- 2. Données : prestataires A et B, un grand livre chacun, écritures anciennes -----------------------------------------
INSERT INTO party (kind, legal_name) SELECT 'PLATFORM', 'Plateforme (test)' WHERE NOT EXISTS (SELECT 1 FROM party WHERE kind = 'PLATFORM');
INSERT INTO party (id, kind, legal_name, country_code) VALUES
 (pg_temp.id('87a001'), 'OPERATOR', 'Prestataire A', 'SN'), (pg_temp.id('87a002'), 'OPERATOR', 'Prestataire B', 'SN');
INSERT INTO party (id, kind, operator_id, legal_name) VALUES
 (pg_temp.id('87b001'), 'ORGANIZER', pg_temp.id('87a001'), 'Org A'), (pg_temp.id('87b002'), 'ORGANIZER', pg_temp.id('87a002'), 'Org B');
INSERT INTO ledger (id, operator_id, scope_type, scope_id, currency, issuer_id, funds_holder_id) VALUES
 (pg_temp.id('87c001'), pg_temp.id('87a001'), 'EVENT', gen_random_uuid(), 'XOF', pg_temp.id('87b001'), pg_temp.id('87b001')),
 (pg_temp.id('87c002'), pg_temp.id('87a002'), 'EVENT', gen_random_uuid(), 'XOF', pg_temp.id('87b002'), pg_temp.id('87b002')),
 (pg_temp.id('87c003'), pg_temp.id('87a001'), 'ORGANIZER', gen_random_uuid(), 'XOF', pg_temp.id('87b001'), pg_temp.id('87b001'));
INSERT INTO account (id, operator_id, ledger_id, code, family, purpose, normal_side, hot, allow_negative) VALUES
 (pg_temp.id('87d001'), pg_temp.id('87a001'), pg_temp.id('87c001'), 'A-BANQUE', 'ASSET', 'BANK', 'D', false, false),
 (pg_temp.id('87d002'), pg_temp.id('87a001'), pg_temp.id('87c001'), 'L-DROITS', 'CLAIM', 'MERCHANT', 'C', false, false),
 (pg_temp.id('87d011'), pg_temp.id('87a002'), pg_temp.id('87c002'), 'A-BANQUE', 'ASSET', 'BANK', 'D', false, false),
 (pg_temp.id('87d012'), pg_temp.id('87a002'), pg_temp.id('87c002'), 'L-DROITS', 'CLAIM', 'MERCHANT', 'C', false, false),
 (pg_temp.id('87d021'), pg_temp.id('87a001'), pg_temp.id('87c003'), 'A-BANQUE', 'ASSET', 'BANK', 'D', false, false),
 (pg_temp.id('87d022'), pg_temp.id('87a001'), pg_temp.id('87c003'), 'L-DROITS', 'CLAIM', 'MERCHANT', 'C', false, false);
INSERT INTO journal_transaction (id, operator_id, ledger_id, type, idempotency_key, request_hash, occurred_at, recorded_at, source)
SELECT pg_temp.id(t), pg_temp.id(o), pg_temp.id(l), 'TOPUP', 'k87:' || t, 'h', now(), now() - interval '1 hour', 'ONLINE'
  FROM (VALUES ('87f001', '87a001', '87c001'), ('87f002', '87a002', '87c002'), ('87f003', '87a001', '87c003')) x(t, o, l);
INSERT INTO posting (operator_id, ledger_id, transaction_id, line_no, account_id, amount)
SELECT pg_temp.id(o), pg_temp.id(l), pg_temp.id(t), n, pg_temp.id(a), amt
  FROM (VALUES ('87a001','87c001','87f001',1,'87d001',500), ('87a001','87c001','87f001',2,'87d002',-500),
               ('87a002','87c002','87f002',1,'87d011',300), ('87a002','87c002','87f002',2,'87d012',-300),
               ('87a001','87c003','87f003',1,'87d021',100), ('87a001','87c003','87f003',2,'87d022',-100)) x(o,l,t,n,a,amt);
UPDATE ledger SET status = 'LOCKED' WHERE id = pg_temp.id('87c003');
SELECT set_config('app.operator_id', pg_temp.id('87a001')::text, true);   -- contexte « sentinelle » à retrouver

-- 3. Scellement ------------------------------------------------------------------------------------------------
SELECT is((SELECT count(*) FROM ops_ledgers_to_seal() WHERE ledger_id IN (pg_temp.id('87c001'), pg_temp.id('87c002'),
  pg_temp.id('87c003'))), 3::bigint, 'ops_ledgers_to_seal : deux prestataires, LOCKED compris');
SELECT is((SELECT seal_no FROM ops_seal_ledger(pg_temp.id('87c002'))), 1, 'ops_seal_ledger : grand livre de B scellé');
SELECT is(current_setting('app.operator_id'), pg_temp.id('87a001')::text, 'contexte app.operator_id rétabli après ops_seal_ledger');
SELECT is((SELECT count(*) FROM ops_seal_ledger(pg_temp.id('87c002'))), 0::bigint, 'ops_seal_ledger : rien à sceller, aucune ligne');
SELECT is((SELECT seal_no FROM ops_seal_ledger(pg_temp.id('87c001'))), 1, 'ops_seal_ledger : A scellé');
SELECT is((SELECT seal_no FROM ops_seal_ledger(pg_temp.id('87c003'))), 1, 'ops_seal_ledger : LOCKED scellé (délai 0)');
-- LOCKED : une écriture toute récente est scellée (délai 0), pas pour un grand livre OPEN (délai 5 min)
INSERT INTO journal_transaction (id, operator_id, ledger_id, type, idempotency_key, request_hash, occurred_at, source)
VALUES (pg_temp.id('87f101'), pg_temp.id('87a001'), pg_temp.id('87c003'), 'TOPUP', 'k87:late', 'h', now(), 'ONLINE'),
       (pg_temp.id('87f102'), pg_temp.id('87a001'), pg_temp.id('87c001'), 'TOPUP', 'k87:late2', 'h', now(), 'ONLINE');
INSERT INTO posting (operator_id, ledger_id, transaction_id, line_no, account_id, amount) VALUES
 (pg_temp.id('87a001'), pg_temp.id('87c003'), pg_temp.id('87f101'), 1, pg_temp.id('87d021'), 10),
 (pg_temp.id('87a001'), pg_temp.id('87c003'), pg_temp.id('87f101'), 2, pg_temp.id('87d022'), -10),
 (pg_temp.id('87a001'), pg_temp.id('87c001'), pg_temp.id('87f102'), 1, pg_temp.id('87d001'), 10),
 (pg_temp.id('87a001'), pg_temp.id('87c001'), pg_temp.id('87f102'), 2, pg_temp.id('87d002'), -10);
SELECT is((SELECT seal_no FROM ops_seal_ledger(pg_temp.id('87c003'))), 2, 'LOCKED : écriture récente scellée sans retard');
SELECT is((SELECT count(*) FROM ops_seal_ledger(pg_temp.id('87c001'))), 0::bigint, 'OPEN : écriture récente non scellée (5 min)');
SELECT throws_ok($$SELECT * FROM ops_seal_ledger('00000000-0000-0000-0000-00000fffffff')$$, 'P0002', NULL,
  'ops_seal_ledger : grand livre inconnu');

-- Chaînes d'audit : une ligne par prestataire et une pour la plateforme
INSERT INTO audit_log (operator_id, action, object_type, object_id, origin) VALUES
 (pg_temp.id('87a001'), 'T87', 'x', '1', 'test'), (pg_temp.id('87a002'), 'T87', 'x', '1', 'test'),
 (NULL, 'T87', 'x', '1', 'test');
UPDATE audit_log SET occurred_at = occurred_at WHERE false;
SELECT ok((SELECT count(*) FROM ops_audit_chains_to_seal()) >= 3, 'ops_audit_chains_to_seal : plateforme comprise');
SELECT ok(EXISTS (SELECT 1 FROM ops_audit_chains_to_seal() WHERE chain_key = audit_platform_chain() AND operator_id IS NULL),
  'chaîne de la plateforme : operator_id nul');
-- Les lignes d'audit sont trop récentes pour seal_audit (5 min) : on appelle seal_audit via ops après avoir vieilli
-- les lignes (déclencheur d'ajout seul désactivé dans la transaction de test).
SET LOCAL session_replication_role = replica;
UPDATE audit_log SET occurred_at = occurred_at - interval '1 hour';
UPDATE audit_log SET row_hash = sha256(prev_hash || convert_to(audit_row_canonical(audit_log), 'UTF8'));
SET LOCAL session_replication_role = origin;
SELECT is((SELECT count(*) FROM ops_seal_audit(pg_temp.id('87a001'))), 1::bigint, 'ops_seal_audit : chaîne de A');
SELECT is(current_setting('app.operator_id'), pg_temp.id('87a001')::text, 'contexte rétabli après ops_seal_audit');
SELECT is((SELECT count(*) FROM ops_seal_audit(audit_platform_chain())), 1::bigint, 'ops_seal_audit : plateforme');
SELECT is((SELECT count(*) FROM ops_seal_audit(pg_temp.id('87a002'))), 1::bigint, 'ops_seal_audit : chaîne de B');

-- Copie externe
SELECT is(ops_record_seal_copy('LEDGER', pg_temp.id('87c001'), 1, 'obj/l1'), true, 'copie posée');
SELECT is(ops_record_seal_copy('LEDGER', pg_temp.id('87c001'), 1, 'obj/l1'), false, 'rejeu même référence : false');
SELECT throws_ok(format($q$SELECT ops_record_seal_copy('LEDGER', %L, 1, 'obj/autre')$q$, pg_temp.id('87c001')),
  'CL029', NULL, 'autre référence : CL029');
SELECT is(ops_record_seal_copy('AUDIT', audit_platform_chain(), 1, 'obj/a1'), true, 'copie de la chaîne plateforme');
SELECT throws_ok($$SELECT ops_record_seal_copy('X', gen_random_uuid(), 1, 'r')$$, 'CL001', NULL, 'type inconnu : CL001');
SELECT throws_ok($$SELECT ops_record_seal_copy('LEDGER', gen_random_uuid(), 1, 'r')$$, 'P0002', NULL, 'scellement inconnu : P0002');
SELECT throws_ok($$SELECT ops_record_seal_copy('AUDIT', audit_platform_chain(), 1, ' ')$$, 'CL001', NULL, 'référence vide : CL001');
SELECT is((SELECT count(DISTINCT kind) FROM ops_seals_since(NULL) WHERE id IN (pg_temp.id('87c001'), audit_platform_chain())),
  2::bigint, 'ops_seals_since(NULL) : les deux chaînes, plateforme comprise');
SELECT is((SELECT count(*) FROM ops_seals_since(interval '1 second') WHERE sealed_at < clock_timestamp() - interval '1 second'),
  0::bigint, 'ops_seals_since(fenêtre) : filtre sur la date');
SELECT is((SELECT external_ref FROM ops_verify_ledger_seals(pg_temp.id('87c001')) WHERE seal_no = 1), 'obj/l1',
  'ops_verify_ledger_seals : référence externe rendue');
SELECT is((SELECT bool_and(ok) FROM ops_verify_ledger_seals(pg_temp.id('87c001'))), true, 'chaîne de A intègre');
SELECT is((SELECT count(*) FROM ops_verify_audit_chain(pg_temp.id('87a001'))), 0::bigint, 'chaîne d''audit de A intègre');
SELECT is(current_setting('app.operator_id'), pg_temp.id('87a001')::text, 'contexte rétabli après les vérifications');

-- Altération (SC-004) : une ligne de posting modifiée, une ligne d'audit modifiée
SET LOCAL session_replication_role = replica;
UPDATE posting SET amount = amount + 1 WHERE operator_id = pg_temp.id('87a002') AND line_no = 1;
SET LOCAL session_replication_role = origin;
SELECT is((SELECT ok FROM ops_verify_ledger_seals(pg_temp.id('87c002')) WHERE seal_no = 1), false,
  'posting altéré : ok = false');
SET LOCAL session_replication_role = replica;
UPDATE audit_log SET object_id = '999' WHERE operator_id = pg_temp.id('87a002');
SET LOCAL session_replication_role = origin;
SELECT ok((SELECT count(*) FROM ops_verify_audit_chain(pg_temp.id('87a002'))) >= 1, 'ligne d''audit altérée : un problem');

-- 4. Contrôles : on répare B puis on injecte les écarts un à un -----------------------------------------------------
SET LOCAL session_replication_role = replica;
UPDATE posting SET amount = amount - 1 WHERE operator_id = pg_temp.id('87a002') AND line_no = 1;
SET LOCAL session_replication_role = origin;
SELECT is((SELECT count(*) FROM ops_ledger_controls('FAST')), 0::bigint, 'FAST : zéro ligne sur données saines');
SELECT is((SELECT count(*) FROM ops_ledger_controls('SLOW')), 0::bigint, 'SLOW : zéro ligne sur données saines');
SELECT throws_ok($$SELECT * FROM ops_ledger_controls('X')$$, 'CL001', NULL, 'portée inconnue : CL001');
-- somme non nulle (et droits <> argent) sur A
INSERT INTO posting (operator_id, ledger_id, transaction_id, line_no, account_id, amount)
VALUES (pg_temp.id('87a001'), pg_temp.id('87c001'), pg_temp.id('87f102'), 3, pg_temp.id('87d001'), 7);
SELECT is((SELECT count(*) FROM ops_ledger_controls('FAST') WHERE ledger_id = pg_temp.id('87c001') AND control = 'SUM_ZERO'),
  1::bigint, 'SUM_ZERO détecté');
SELECT is((SELECT count(*) FROM ops_ledger_controls('FAST') WHERE ledger_id = pg_temp.id('87c001')
            AND control = 'CLAIMS_EQUAL_MONEY'), 1::bigint, 'CLAIMS_EQUAL_MONEY détecté');
-- LOCKED ignoré
INSERT INTO posting (operator_id, ledger_id, transaction_id, line_no, account_id, amount)
VALUES (pg_temp.id('87a001'), pg_temp.id('87c003'), pg_temp.id('87f101'), 3, pg_temp.id('87d021'), 9);
SELECT is((SELECT count(*) FROM ops_ledger_controls('FAST') WHERE ledger_id = pg_temp.id('87c003')), 0::bigint,
  'grand livre LOCKED ignoré');
-- cache faux
INSERT INTO account_balance (account_id, operator_id, balance) VALUES (pg_temp.id('87d011'), pg_temp.id('87a002'), 305)
  ON CONFLICT (account_id) DO UPDATE SET balance = 305;
SELECT is((SELECT detail_count FROM ops_ledger_controls('SLOW') WHERE ledger_id = pg_temp.id('87c002')
            AND control = 'BALANCE_CACHE'), 1::bigint, 'BALANCE_CACHE détecté');
-- compte chaud du mauvais sens (compte hot, normal D, solde négatif)
UPDATE account SET hot = true, purpose = 'ORG_COM' WHERE id = pg_temp.id('87d011');
UPDATE account SET hot = true, purpose = 'ORG_COM' WHERE id = pg_temp.id('87d001');
INSERT INTO posting (operator_id, ledger_id, transaction_id, line_no, account_id, amount)
VALUES (pg_temp.id('87a001'), pg_temp.id('87c001'), pg_temp.id('87f102'), 4, pg_temp.id('87d001'), -5000);
SELECT is((SELECT detail_count FROM ops_ledger_controls('SLOW') WHERE ledger_id = pg_temp.id('87c001')
            AND control = 'HOT_ACCOUNT_SIDE'), 1::bigint, 'HOT_ACCOUNT_SIDE détecté');

-- versement de 49 h
-- WP06 : initiated_tx_id exigé à l'insertion (payout_tx_required, 0085)
INSERT INTO payout (id, operator_id, ledger_id, beneficiary_id, amount, method, status, initiated_at, initiated_by,
                    approved_by, initiated_tx_id)
VALUES (pg_temp.id('87e001'), pg_temp.id('87a001'), pg_temp.id('87c001'), pg_temp.id('87b001'), 100, 'CASH', 'INITIATED',
        now() - interval '49 hours', pg_temp.id('87aa01'), pg_temp.id('87aa02'), pg_temp.id('87f001')),
       (pg_temp.id('87e002'), pg_temp.id('87a001'), pg_temp.id('87c001'), pg_temp.id('87b001'), 100, 'CASH', 'INITIATED',
        now() - interval '1 hour', pg_temp.id('87aa01'), pg_temp.id('87aa02'), pg_temp.id('87f001'));
SELECT is((SELECT array_agg(payout_id) FROM ops_overdue_payouts(interval '48 hours')), ARRAY[pg_temp.id('87e001')],
  'versement de 49 h rendu, celui d''1 h non');

-- relevés : ancienne ligne non rapprochée
INSERT INTO external_statement_line (operator_id, ledger_id, account_id, source, external_ref, value_date, amount)
VALUES (pg_temp.id('87a001'), pg_temp.id('87c001'), pg_temp.id('87d001'), 'BANK', 'r87-old', current_date - 10, 100),
       (pg_temp.id('87a001'), pg_temp.id('87c001'), pg_temp.id('87d001'), 'BANK', 'r87-new', current_date, 100);
SELECT is((SELECT unmatched FROM ops_unmatched_statements(interval '3 days') WHERE account_id = pg_temp.id('87d001')),
  1::bigint, 'ligne de relevé ancienne non rapprochée : une seule');
-- WP06 : external_statement_line_match_audit (0083) exige matched_by et matched_at avec le rapprochement
UPDATE external_statement_line SET matched_tx_id = pg_temp.id('87f001'), matched_by = pg_temp.id('87aa01'),
  matched_at = now() WHERE external_ref = 'r87-old';
SELECT is((SELECT count(*) FROM ops_unmatched_statements(interval '3 days')), 0::bigint, 'ligne rapprochée : plus rendue');

-- anomalies nouvelles
INSERT INTO anomaly (id, operator_id, ledger_id, kind, amount, created_at) VALUES
 (pg_temp.id('87aa11'), pg_temp.id('87a001'), pg_temp.id('87c001'), 'CASH_DIFF', 0, now()),
 (pg_temp.id('87aa12'), pg_temp.id('87a001'), pg_temp.id('87c001'), 'CASH_DIFF', 0, now() - interval '2 hours');
SELECT is((SELECT array_agg(anomaly_id) FROM ops_new_open_anomalies(now() - interval '1 hour')), ARRAY[pg_temp.id('87aa11')],
  'anomalie nouvelle rendue, ancienne non');
SELECT is((SELECT count(*) FROM ops_new_open_anomalies(now() + interval '1 minute')), 0::bigint,
  'anomalie déjà vue : ne revient pas');

-- 5. Alerte ----------------------------------------------------------------------------------------------------
CREATE TEMP TABLE al AS SELECT ops_raise_alert(9, '{"ledger": "x", "n": 2}') AS id;
SELECT is((SELECT count(*) FROM audit_log a JOIN al ON al.id = a.id WHERE a.operator_id IS NULL AND a.action = 'OPS_ALERT'
            AND a.object_type = 'ops_alarm' AND a.object_id = '9' AND a.origin = 'maintenance'
            AND a.chain_key = audit_platform_chain()), 1::bigint, 'OPS_ALERT écrite sur la chaîne de la plateforme');
SELECT is(current_setting('app.operator_id'), pg_temp.id('87a001')::text, 'contexte rétabli après ops_raise_alert');
SELECT ok(position('''audit_id''' IN prosrc) > 0 AND position('pg_notify(''ops_alert''' IN prosrc) > 0,
  'notification ops_alert avec code et identifiant') FROM pg_proc WHERE proname = 'ops_raise_alert';
SELECT throws_ok($$SELECT ops_raise_alert(6, '{}')$$, 'CL001', NULL, 'code 6 refusé');
SELECT throws_ok($$SELECT ops_raise_alert(12, '{}')$$, 'CL001', NULL, 'code 12 refusé');
SELECT throws_ok($$SELECT ops_raise_alert(7, '{"a": {"b": [{"IBAN": "x"}]}}')$$, 'CL001', NULL, 'clé interdite imbriquée refusée');
SELECT throws_ok($$SELECT ops_raise_alert(7, '{"query": "select 1"}')$$, 'CL001', NULL, 'clé query refusée');
SELECT throws_ok($$SELECT ops_raise_alert(7, '[1]')$$, 'CL001', NULL, 'détail non objet refusé');
SELECT throws_ok(format($q$SELECT ops_raise_alert(7, jsonb_build_object('a', %L))$q$, repeat('x', 4100)), 'CL001', NULL,
  'détail de plus de 4 ko refusé');
SELECT lives_ok($$SELECT ops_raise_alert(11, '{"phones": 1}')$$, 'clé voisine (phones) acceptée');

-- 6. Transactions longues --------------------------------------------------------------------------------------
SELECT lives_ok($$SELECT * FROM ops_long_transactions(interval '1 hour')$$, 'ops_long_transactions s''exécute');
SELECT is((SELECT count(*) FROM ops_long_transactions(interval '1 hour')), 0::bigint,
  'aucune transaction de plus d''une heure (propriétaire membre de pg_read_all_stats)');
-- Propriétaire sans pg_read_all_stats : ligne de configuration (C-011)
CREATE ROLE ops87_owner NOSUPERUSER NOLOGIN;
GRANT CREATE ON SCHEMA public TO ops87_owner;
ALTER FUNCTION ops_long_transactions(interval) OWNER TO ops87_owner;
SELECT is((SELECT usename || ':' || coalesce(pid::text, 'nul') FROM ops_long_transactions(interval '1 hour')), '?config:nul',
  'sans pg_read_all_stats : ligne de configuration, pas une liste vide');
SELECT finish();
ROLLBACK;
