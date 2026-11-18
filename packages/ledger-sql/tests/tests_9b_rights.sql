-- Droits de la base de la mission versements-rapprochements-cloture (migrations 0083 à 0088 ; lot WP06 ; C-005,
-- C-008, C-011, FR-024) — pgTAP, écrit à la main. Sous chaque rôle (SET ROLE) : listes EXACTES des fonctions et des
-- droits de table de la mission (la suite échoue si l'une s'élargit), écriture directe refusée, appels réels de
-- cashless_app et de cashless_maint (RLS comprise), isolation des prestataires, propriétaire des ops_*.
-- Lancer : pg_prove -d <base> tests/tests_9b_rights.sql (base créée par les migrations, roles.sql et post-roles.sql
-- rejoués).
\set ON_ERROR_STOP 1
\set QUIET 1
BEGIN;
\ir _grants_for_tests.sql
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

CREATE FUNCTION pg_temp.id(p text) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT ('00000000-0000-0000-0000-' || lpad(p, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.code(p text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE p; RETURN NULL; EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE; END $$;
CREATE FUNCTION pg_temp.ctx(p text) RETURNS void LANGUAGE sql AS
  $$ SELECT set_config('app.operator_id', pg_temp.id(p)::text, true) $$;

-- 1. Données (propriétaire) : deux prestataires, grands livres, événements, une ligne par table de la mission ----
INSERT INTO party (kind, legal_name) SELECT 'PLATFORM', 'Plateforme (test)'
 WHERE NOT EXISTS (SELECT 1 FROM party WHERE kind = 'PLATFORM');
INSERT INTO party (id, kind, legal_name, country_code) VALUES
 (pg_temp.id('9ba001'), 'OPERATOR', 'Prestataire A', 'SN'), (pg_temp.id('9ba002'), 'OPERATOR', 'Prestataire B', 'SN');
INSERT INTO party (id, kind, operator_id, legal_name) VALUES
 (pg_temp.id('9bb001'), 'ORGANIZER', pg_temp.id('9ba001'), 'Org A'),
 (pg_temp.id('9bb002'), 'ORGANIZER', pg_temp.id('9ba002'), 'Org B');
INSERT INTO jurisdiction_profile (id, country_code, version, valid_from, breakage_destination)
VALUES (pg_temp.id('9bd001'), 'SN', 960096, '2026-01-01', 'ORGANIZER');
INSERT INTO ledger (id, operator_id, scope_type, scope_id, currency, issuer_id, funds_holder_id) VALUES
 (pg_temp.id('9bc001'), pg_temp.id('9ba001'), 'ORGANIZER', gen_random_uuid(), 'XOF', pg_temp.id('9bb001'), pg_temp.id('9bb001')),
 (pg_temp.id('9bc002'), pg_temp.id('9ba002'), 'ORGANIZER', gen_random_uuid(), 'XOF', pg_temp.id('9bb002'), pg_temp.id('9bb002'));
INSERT INTO account (id, operator_id, ledger_id, code, family, purpose, normal_side, hot, allow_negative) VALUES
 (pg_temp.id('9be001'), pg_temp.id('9ba001'), pg_temp.id('9bc001'), 'A-BANQUE', 'ASSET', 'BANK', 'D', false, false),
 (pg_temp.id('9be002'), pg_temp.id('9ba001'), pg_temp.id('9bc001'), 'L-DROITS', 'CLAIM', 'MERCHANT', 'C', false, false),
 (pg_temp.id('9be011'), pg_temp.id('9ba002'), pg_temp.id('9bc002'), 'A-BANQUE', 'ASSET', 'BANK', 'D', false, false),
 (pg_temp.id('9be012'), pg_temp.id('9ba002'), pg_temp.id('9bc002'), 'L-DROITS', 'CLAIM', 'MERCHANT', 'C', false, false);
INSERT INTO journal_transaction (id, operator_id, ledger_id, type, idempotency_key, request_hash, occurred_at, recorded_at, source)
SELECT pg_temp.id(t), pg_temp.id(o), pg_temp.id(l), 'TOPUP', 'k9b:' || t, 'h', now(), now() - interval '1 hour', 'ONLINE'
  FROM (VALUES ('9bf001', '9ba001', '9bc001'), ('9bf002', '9ba002', '9bc002')) x(t, o, l);
INSERT INTO posting (operator_id, ledger_id, transaction_id, line_no, account_id, amount)
SELECT pg_temp.id(o), pg_temp.id(l), pg_temp.id(t), n, pg_temp.id(a), amt
  FROM (VALUES ('9ba001','9bc001','9bf001',1,'9be001',500), ('9ba001','9bc001','9bf001',2,'9be002',-500),
               ('9ba002','9bc002','9bf002',1,'9be011',300), ('9ba002','9bc002','9bf002',2,'9be012',-300)) x(o,l,t,n,a,amt);
-- Événements de A et de B (grand livre ouvert) ; A en SETTLING pour record_closing_step.
ALTER TABLE event DISABLE TRIGGER event_status_guard;   -- fixture : statut posé directement (annulé par ROLLBACK)
SELECT pg_temp.ctx('9ba001');
INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone, jurisdiction_id, funds_holder)
VALUES (pg_temp.id('9b9001'), pg_temp.id('9ba001'), pg_temp.id('9bb001'), 'Événement A', 'XOF', 'Africa/Dakar',
        pg_temp.id('9bd001'), 'ORGANIZER');
SELECT open_event_ledger(pg_temp.id('9b9001'));
SELECT pg_temp.ctx('9ba002');
INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone, jurisdiction_id, funds_holder)
VALUES (pg_temp.id('9b9002'), pg_temp.id('9ba002'), pg_temp.id('9bb002'), 'Événement B', 'XOF', 'Africa/Dakar',
        pg_temp.id('9bd001'), 'ORGANIZER');
SELECT open_event_ledger(pg_temp.id('9b9002'));
UPDATE event SET status = 'SETTLING' WHERE id = pg_temp.id('9b9001');
-- Une ligne de chaque table de la mission, pour chaque prestataire (versement et relevé anciens : ops_*).
INSERT INTO payout (id, operator_id, ledger_id, beneficiary_id, amount, method, status, initiated_at, initiated_by,
                    approved_by, initiated_tx_id)
VALUES (pg_temp.id('9b7001'), pg_temp.id('9ba001'), pg_temp.id('9bc001'), pg_temp.id('9bb001'), 100, 'CASH', 'INITIATED',
        now() - interval '49 hours', pg_temp.id('9baa01'), pg_temp.id('9baa02'), pg_temp.id('9bf001')),
       (pg_temp.id('9b7002'), pg_temp.id('9ba002'), pg_temp.id('9bc002'), pg_temp.id('9bb002'), 100, 'CASH', 'INITIATED',
        now() - interval '49 hours', pg_temp.id('9baa01'), pg_temp.id('9baa02'), pg_temp.id('9bf002'));
INSERT INTO statement_import (id, operator_id, ledger_id, account_id, source, file_sha256, statement_date, closing_balance,
                              currency, imported_by, lines_created, lines_existing, lines_matched)
VALUES (pg_temp.id('9b6001'), pg_temp.id('9ba001'), pg_temp.id('9bc001'), pg_temp.id('9be001'), 'BANK', repeat('a', 64),
        current_date - 10, 500, 'XOF', pg_temp.id('9baa01'), 1, 0, 0),
       (pg_temp.id('9b6002'), pg_temp.id('9ba002'), pg_temp.id('9bc002'), pg_temp.id('9be011'), 'BANK', repeat('b', 64),
        current_date - 10, 300, 'XOF', pg_temp.id('9baa01'), 1, 0, 0);
INSERT INTO external_statement_line (operator_id, ledger_id, account_id, source, external_ref, value_date, amount,
                                     statement_import_id, currency)
VALUES (pg_temp.id('9ba001'), pg_temp.id('9bc001'), pg_temp.id('9be001'), 'BANK', 'r9b-a', current_date - 10, 500,
        pg_temp.id('9b6001'), 'XOF'),
       (pg_temp.id('9ba002'), pg_temp.id('9bc002'), pg_temp.id('9be011'), 'BANK', 'r9b-b', current_date - 10, 300,
        pg_temp.id('9b6002'), 'XOF');
INSERT INTO closing_step (operator_id, event_id, step, status, done_by)
VALUES (pg_temp.id('9ba001'), pg_temp.id('9b9001'), 'PITCH_FEES', 'DONE', pg_temp.id('9baa01')),
       (pg_temp.id('9ba002'), pg_temp.id('9b9002'), 'PITCH_FEES', 'DONE', pg_temp.id('9baa01'));
INSERT INTO account_mapping (operator_id, entity_party_id, version, valid_from, purpose, debit_account, credit_account,
                             created_by)
VALUES (pg_temp.id('9ba001'), pg_temp.id('9bb001'), 1, now(), 'TOPUP', '5211', '4191', pg_temp.id('9baa01')),
       (pg_temp.id('9ba002'), pg_temp.id('9bb002'), 1, now(), 'TOPUP', '5211', '4191', pg_temp.id('9baa01'));
INSERT INTO anomaly (id, operator_id, ledger_id, kind, amount, created_at)
VALUES (pg_temp.id('9baf01'), pg_temp.id('9ba001'), pg_temp.id('9bc001'), 'CASH_DIFF', 0, now()),
       (pg_temp.id('9baf02'), pg_temp.id('9ba002'), pg_temp.id('9bc002'), 'CASH_DIFF', 0, now());
-- Chaînes d'audit anciennes (A, B, plateforme) : seal_audit exige 5 minutes ; déclencheurs levés le temps du vieillissement.
INSERT INTO audit_log (operator_id, action, object_type, object_id, origin) VALUES
 (pg_temp.id('9ba001'), 'T9B', 'x', '1', 'test'), (pg_temp.id('9ba002'), 'T9B', 'x', '1', 'test'),
 (NULL, 'T9B', 'x', '1', 'test');
SET LOCAL session_replication_role = replica;
UPDATE audit_log SET occurred_at = occurred_at - interval '1 hour';
UPDATE audit_log SET row_hash = sha256(prev_hash || convert_to(audit_row_canonical(audit_log), 'UTF8'));
SET LOCAL session_replication_role = origin;

-- 2. Listes exactes de fonctions, par rôle (la suite échoue si une fonction s'ajoute ou se retire) -----------------
CREATE TEMP TABLE m9b (sig regprocedure PRIMARY KEY, trig boolean NOT NULL, grantee text);
INSERT INTO m9b VALUES
 ('record_closing_step(uuid,text,text,uuid[],jsonb,uuid)', false, 'cashless_app'),
 ('create_payout_batch(uuid,uuid,jsonb,uuid,uuid)', false, 'cashless_app'),
 ('settle_payout(uuid,text,text,text,uuid)', false, 'cashless_app'),
 ('import_statement_lines(jsonb,jsonb)', false, 'cashless_app'),
 ('match_statement_line(bigint,uuid,uuid,uuid)', false, 'cashless_app'),
 ('account_reconciliation(uuid)', false, 'cashless_app'),
 ('refund_deposit_for_session(uuid,uuid,uuid,uuid)', false, 'cashless_app'),
 ('create_account_mapping_version(uuid,uuid,timestamptz,jsonb,uuid)', false, 'cashless_app'),
 ('set_event_status(uuid,event_status,uuid)', false, 'cashless_app'),
 ('event_transition_conditions(uuid,event_status)', false, 'cashless_app'),
 ('ops_ledgers_to_seal()', false, 'cashless_maint'), ('ops_seal_ledger(uuid)', false, 'cashless_maint'),
 ('ops_audit_chains_to_seal()', false, 'cashless_maint'), ('ops_seal_audit(uuid)', false, 'cashless_maint'),
 ('ops_record_seal_copy(text,uuid,integer,text)', false, 'cashless_maint'),
 ('ops_seals_since(interval)', false, 'cashless_maint'),
 ('ops_verify_ledger_seals(uuid,integer)', false, 'cashless_maint'),
 ('ops_verify_audit_chain(uuid,timestamptz)', false, 'cashless_maint'),
 ('ops_ledger_controls(text)', false, 'cashless_maint'), ('ops_overdue_payouts(interval)', false, 'cashless_maint'),
 ('ops_unmatched_statements(interval)', false, 'cashless_maint'),
 ('ops_new_open_anomalies(timestamptz)', false, 'cashless_maint'),
 ('ops_raise_alert(integer,jsonb)', false, 'cashless_maint'), ('ops_long_transactions(interval)', false, 'cashless_maint'),
 -- internes et fonctions de déclencheur : exécutables par personne
 ('refund_deposit(uuid,uuid,uuid,uuid)', false, NULL), ('closing_new_conditions(uuid,event_status)', false, NULL),
 ('statement_import_scope_guard()', true, NULL), ('external_statement_line_scope_guard()', true, NULL),
 ('external_statement_line_update_guard()', true, NULL), ('closing_step_scope_guard()', true, NULL),
 ('payout_scope_guard()', true, NULL), ('payout_transition_guard()', true, NULL), ('payout_no_delete()', true, NULL),
 ('refund_request_transition_guard()', true, NULL), ('account_mapping_scope_guard()', true, NULL),
 ('account_mapping_append_only()', true, NULL);
SELECT is((SELECT count(*) FROM m9b WHERE grantee = 'cashless_maint'), 14::bigint, 'cashless_maint : quatorze ops_*');
SELECT is((SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname LIKE 'ops\_%'), 14::bigint,
  'ops_* : aucune fonction de plus que les quatorze listées');

CREATE TEMP TABLE r9b (r text PRIMARY KEY);
INSERT INTO r9b VALUES ('cashless_app'), ('cashless_platform'), ('cashless_tagkeys'), ('cashless_perso'),
 ('cashless_tagcheck'), ('cashless_keyadmin'), ('cashless_snapcontent'), ('cashless_snapsign'), ('cashless_maint'),
 ('cashless_edge'), ('cashless_edgeadmin');
SELECT is((SELECT count(*) FROM pg_roles WHERE rolname LIKE 'cashless\_%'), (SELECT count(*) FROM r9b),
  'liste des rôles cashless_* : aucun rôle de plus que ceux testés');
-- Fonctions de la mission exécutables par chaque rôle = liste attendue (set_eq sur regprocedure).
SELECT set_eq(format($q$SELECT m.sig FROM m9b m WHERE has_function_privilege(%L, m.sig, 'EXECUTE')$q$, r.r),
              format($q$SELECT m.sig FROM m9b m WHERE m.grantee = %L$q$, r.r),
              r.r || ' : fonctions de la mission exécutables = liste exacte')
  FROM r9b r ORDER BY r.r;
-- PUBLIC : aucune fonction de la mission, droit par défaut compris.
SELECT is((SELECT count(*) FROM m9b m JOIN pg_proc p ON p.oid = m.sig
            CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
           WHERE a.grantee = 0), 0::bigint, 'PUBLIC : aucune fonction de la mission');
-- Entrées d'ACL : seuls le propriétaire et le rôle attendu (aucun autre rôle, aucun PUBLIC) sur chaque fonction.
SELECT is((SELECT coalesce(string_agg(m.sig::text || ':' || coalesce(g.rolname, 'PUBLIC'), ' ' ORDER BY m.sig::text), '')
             FROM m9b m JOIN pg_proc p ON p.oid = m.sig
            CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
            LEFT JOIN pg_roles g ON g.oid = a.grantee
           WHERE a.grantee <> p.proowner AND g.rolname IS DISTINCT FROM m.grantee), '',
  'fonctions de la mission : aucune entrée d''ACL hors propriétaire et rôle attendu');
-- Fonctions de déclencheur et internes : aucun rôle, personne.
SELECT is((SELECT count(*) FROM m9b m CROSS JOIN pg_roles r
            WHERE m.grantee IS NULL AND r.rolname LIKE 'cashless\_%' AND has_function_privilege(r.oid, m.sig, 'EXECUTE')),
  0::bigint, 'déclencheurs et internes de 0083 à 0088 : exécutables par aucun rôle cashless_*');
SELECT is((SELECT count(*) FROM m9b WHERE trig), 10::bigint, 'dix fonctions de déclencheur ou de garde nommées');

-- 3. Tables : privilèges exacts (cinq tables) ---------------------------------------------------------------------
CREATE TEMP TABLE t9b (t regclass PRIMARY KEY);
INSERT INTO t9b VALUES ('payout'), ('external_statement_line'), ('closing_step'), ('statement_import'), ('account_mapping');
SELECT is((SELECT coalesce(string_agg(t.t::text || ':' || coalesce(g.rolname, 'PUBLIC') || ':' || a.privilege_type, ' '
                                      ORDER BY t.t::text, g.rolname, a.privilege_type), '')
             FROM t9b t JOIN pg_class c ON c.oid = t.t
            CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
            LEFT JOIN pg_roles g ON g.oid = a.grantee
           WHERE a.grantee <> c.relowner),
  'account_mapping:cashless_app:SELECT closing_step:cashless_app:SELECT external_statement_line:cashless_app:SELECT '
  'payout:cashless_app:SELECT statement_import:cashless_app:SELECT',
  'cinq tables : cashless_app SELECT seul, aucun autre rôle, aucun PUBLIC, ni DELETE ni TRUNCATE ni colonne');
SELECT is((SELECT count(*) FROM pg_attribute a JOIN t9b t ON t.t = a.attrelid WHERE a.attacl IS NOT NULL),
  0::bigint, 'cinq tables : aucun droit par colonne');
SELECT is((SELECT count(*) FROM t9b t JOIN pg_class c ON c.oid = t.t
            WHERE c.relrowsecurity AND c.relforcerowsecurity), 5::bigint, 'cinq tables : RLS activée et forcée');
SELECT is((SELECT count(*) FROM t9b t CROSS JOIN r9b r CROSS JOIN unnest(ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) p
            WHERE has_table_privilege(r.r, t.t, p)), 0::bigint,
  'aucun rôle cashless_* n''écrit une des cinq tables (account_mapping comprise : la fonction seule impose les versions)');

-- 4. Rôles : aucun rôle prédéfini d'exploitation --------------------------------------------------------------------
SELECT is((SELECT coalesce(string_agg(m.rolname || ' in ' || g.rolname, ' ' ORDER BY m.rolname, g.rolname), '')
             FROM pg_auth_members am JOIN pg_roles m ON m.oid = am.member JOIN pg_roles g ON g.oid = am.roleid
            WHERE m.rolname LIKE 'cashless\_%' AND g.rolname IN ('pg_read_all_stats', 'pg_signal_backend', 'pg_monitor',
                                                                   'pg_read_all_data', 'pg_write_all_data')), '',
  'aucun rôle cashless_* membre de pg_read_all_stats, pg_signal_backend (C-011), pg_monitor ni pg_*_all_data');
SELECT is((SELECT count(*) FROM pg_auth_members am JOIN pg_roles m ON m.oid = am.member
            WHERE m.rolname LIKE 'cashless\_%'), 0::bigint, 'aucun rôle cashless_* n''est membre d''un autre rôle');
-- Limite héritée : les ops_* supposent un propriétaire qui ignore la RLS forcée (comme audit_log_chain, 0022).
SELECT is((SELECT count(*) FROM pg_proc p JOIN pg_roles o ON o.oid = p.proowner
            WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'ops\_%'
              AND NOT (o.rolsuper OR o.rolbypassrls)), 0::bigint,
  'propriétaire des ops_* : superutilisateur ou BYPASSRLS (limite héritée, à consigner par WP14)');

-- 5. cashless_app : écriture directe refusée, fonctions accordées appelables, isolation ------------------------------
SET LOCAL ROLE cashless_app;
SELECT pg_temp.ctx('9ba001');
SELECT is(pg_temp.code($q$INSERT INTO payout (operator_id) VALUES (NULL)$q$), '42501', 'cashless_app : INSERT payout refusé');
SELECT is(pg_temp.code($q$INSERT INTO external_statement_line (operator_id) VALUES (NULL)$q$), '42501',
  'cashless_app : INSERT external_statement_line refusé');
SELECT is(pg_temp.code($q$INSERT INTO closing_step (operator_id) VALUES (NULL)$q$), '42501', 'cashless_app : INSERT closing_step refusé');
SELECT is(pg_temp.code($q$INSERT INTO statement_import (operator_id) VALUES (NULL)$q$), '42501',
  'cashless_app : INSERT statement_import refusé');
SELECT is(pg_temp.code($q$INSERT INTO account_mapping (operator_id) VALUES (NULL)$q$), '42501',
  'cashless_app : INSERT account_mapping refusé');
SELECT is(pg_temp.code($q$UPDATE payout SET status = status$q$), '42501', 'cashless_app : UPDATE d''une colonne de payout refusé');
SELECT is(pg_temp.code($q$UPDATE external_statement_line SET matched_tx_id = matched_tx_id$q$), '42501',
  'cashless_app : UPDATE d''une colonne de external_statement_line refusé');
SELECT is(pg_temp.code($q$UPDATE closing_step SET status = status$q$), '42501', 'cashless_app : UPDATE closing_step refusé');
SELECT is(pg_temp.code($q$UPDATE statement_import SET lines_matched = lines_matched$q$), '42501',
  'cashless_app : UPDATE statement_import refusé');
SELECT is(pg_temp.code($q$UPDATE account_mapping SET version = version$q$), '42501', 'cashless_app : UPDATE account_mapping refusé');
SELECT is(pg_temp.code($q$TRUNCATE payout$q$), '42501', 'cashless_app : TRUNCATE payout refusé');
SELECT is(pg_temp.code($q$TRUNCATE external_statement_line$q$), '42501', 'cashless_app : TRUNCATE external_statement_line refusé');
SELECT is(pg_temp.code($q$TRUNCATE closing_step$q$), '42501', 'cashless_app : TRUNCATE closing_step refusé');
SELECT is(pg_temp.code($q$TRUNCATE statement_import$q$), '42501', 'cashless_app : TRUNCATE statement_import refusé');
SELECT is(pg_temp.code($q$TRUNCATE account_mapping$q$), '42501', 'cashless_app : TRUNCATE account_mapping refusé');
SELECT is(pg_temp.code($q$DELETE FROM payout$q$), '42501', 'cashless_app : DELETE payout refusé');
SELECT is(pg_temp.code($q$DELETE FROM external_statement_line$q$), '42501', 'cashless_app : DELETE external_statement_line refusé');
SELECT is(pg_temp.code($q$DELETE FROM closing_step$q$), '42501', 'cashless_app : DELETE closing_step refusé');
SELECT is(pg_temp.code($q$DELETE FROM statement_import$q$), '42501', 'cashless_app : DELETE statement_import refusé');
SELECT is(pg_temp.code($q$DELETE FROM account_mapping$q$), '42501', 'cashless_app : DELETE account_mapping refusé');
-- Aucune fonction d'exploitation ni de déclencheur
SELECT is(pg_temp.code($q$SELECT ops_seal_ledger(gen_random_uuid())$q$), '42501', 'cashless_app : ops_seal_ledger refusé');
SELECT is(pg_temp.code($q$SELECT * FROM ops_ledgers_to_seal()$q$), '42501', 'cashless_app : ops_ledgers_to_seal refusé');
SELECT is(pg_temp.code($q$SELECT ops_raise_alert(9, '{}')$q$), '42501', 'cashless_app : ops_raise_alert refusé');
SELECT is(pg_temp.code($q$SELECT * FROM ops_long_transactions(interval '1 hour')$q$), '42501',
  'cashless_app : ops_long_transactions refusé');
SELECT is(pg_temp.code($q$SELECT refund_deposit(gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid())$q$),
  '42501', 'cashless_app : refund_deposit (quatre arguments) refusé');
-- Fonctions accordées : appels réels sous le rôle
SELECT is((SELECT unmatched_lines::text FROM account_reconciliation(pg_temp.id('9bc001'))
            WHERE code = 'A-BANQUE'), '1',
  'cashless_app : account_reconciliation (grand livre de A) rend le relevé de A-BANQUE (une ligne non rapprochée)');
SELECT is(pg_temp.code($q$SELECT * FROM account_reconciliation(gen_random_uuid())$q$) IS NOT DISTINCT FROM '42501', false,
  'cashless_app : account_reconciliation s''exécute (le refus éventuel n''est pas un refus de droit)');
SELECT is((SELECT (record_closing_step(pg_temp.id('9b9001'), 'OPERATOR_FEE', 'DONE', '{}', '{}', pg_temp.id('9baa01'))).step),
  'OPERATOR_FEE', 'cashless_app : record_closing_step (étape 2, événement de A en SETTLING)');
SELECT is((SELECT count(*) FROM event_transition_conditions(pg_temp.id('9b9001'), 'REFUND_WINDOW')) > 0, true,
  'cashless_app : event_transition_conditions s''appelle');
SELECT is(pg_temp.code(format('SELECT * FROM account_reconciliation(%L)', pg_temp.id('9bc002'))) IS NOT NULL, true,
  'cashless_app (A) : account_reconciliation du grand livre de B refusé');
SELECT is(pg_temp.code(format($q$SELECT record_closing_step(%L, 'OPERATOR_FEE', 'DONE', '{}', '{}', %L)$q$,
  pg_temp.id('9b9002'), pg_temp.id('9baa01'))) IS NOT NULL, true,
  'cashless_app (A) : record_closing_step d''un événement de B refusé');
-- RLS : chaque prestataire ne voit que ses lignes dans les cinq tables
SELECT is((SELECT count(*) FROM payout WHERE operator_id = pg_temp.id('9ba002')) +
          (SELECT count(*) FROM external_statement_line WHERE operator_id = pg_temp.id('9ba002')) +
          (SELECT count(*) FROM closing_step WHERE operator_id = pg_temp.id('9ba002')) +
          (SELECT count(*) FROM statement_import WHERE operator_id = pg_temp.id('9ba002')) +
          (SELECT count(*) FROM account_mapping WHERE operator_id = pg_temp.id('9ba002')), 0::bigint,
  'cashless_app (A) : aucune ligne de B dans les cinq tables');
SELECT is((SELECT count(*) FROM payout) > 0 AND (SELECT count(*) FROM external_statement_line) > 0
          AND (SELECT count(*) FROM closing_step) > 0 AND (SELECT count(*) FROM statement_import) > 0
          AND (SELECT count(*) FROM account_mapping) > 0, true, 'cashless_app (A) : ses propres lignes lisibles (SELECT)');
SELECT pg_temp.ctx('9ba002');
SELECT is((SELECT count(*) FROM payout WHERE operator_id = pg_temp.id('9ba001')) +
          (SELECT count(*) FROM external_statement_line WHERE operator_id = pg_temp.id('9ba001')) +
          (SELECT count(*) FROM closing_step WHERE operator_id = pg_temp.id('9ba001')) +
          (SELECT count(*) FROM statement_import WHERE operator_id = pg_temp.id('9ba001')) +
          (SELECT count(*) FROM account_mapping WHERE operator_id = pg_temp.id('9ba001')), 0::bigint,
  'cashless_app (B) : aucune ligne de A dans les cinq tables');
SELECT is((SELECT count(*) FROM payout), 1::bigint, 'cashless_app (B) : un seul versement visible, le sien');
RESET ROLE;

CREATE TEMP TABLE pc AS SELECT audit_platform_chain() AS k;   -- clé de la chaîne de la plateforme (fonction fermée à maint)
GRANT SELECT ON pc TO PUBLIC;
-- 6. cashless_maint : aucune table lisible ; les ops_* marchent sous le rôle réel (RLS comprise) -------------------
CREATE TEMP TABLE al (id bigint);
GRANT ALL ON al TO PUBLIC;
SELECT pg_temp.ctx('9ba001');   -- contexte « sentinelle » à retrouver après chaque appel
SET LOCAL ROLE cashless_maint;
SELECT is(pg_temp.code(format('SELECT count(*) FROM %I', t)), '42501', 'cashless_maint : SELECT ' || t || ' refusé')
  FROM unnest(ARRAY['posting', 'payout', 'audit_log', 'ledger_seal', 'external_statement_line', 'anomaly',
                    'closing_step', 'statement_import', 'account_mapping']) t;
SELECT is(pg_temp.code($q$SELECT * FROM set_event_status(gen_random_uuid(), 'LIVE', gen_random_uuid())$q$), '42501',
  'cashless_maint : set_event_status refusé');
SELECT is(pg_temp.code($q$SELECT * FROM account_reconciliation(gen_random_uuid())$q$), '42501',
  'cashless_maint : account_reconciliation refusé');
-- Scellement des grands livres de deux prestataires
SELECT ok((SELECT count(*) FROM ops_ledgers_to_seal() WHERE ledger_id IN (pg_temp.id('9bc001'), pg_temp.id('9bc002'))) = 2,
  'cashless_maint : ops_ledgers_to_seal voit les deux prestataires');
SELECT is((SELECT seal_no FROM ops_seal_ledger(pg_temp.id('9bc002'))), 1, 'cashless_maint : ops_seal_ledger (B) scellé');
SELECT is(current_setting('app.operator_id'), pg_temp.id('9ba001')::text, 'app.operator_id inchangé après ops_seal_ledger (B)');
SELECT is((SELECT seal_no FROM ops_seal_ledger(pg_temp.id('9bc001'))), 1, 'cashless_maint : ops_seal_ledger (A) scellé');
SELECT is(current_setting('app.operator_id'), pg_temp.id('9ba001')::text, 'app.operator_id inchangé après ops_seal_ledger (A)');
-- Chaînes d'audit, plateforme comprise
SELECT ok((SELECT count(*) FROM ops_audit_chains_to_seal() WHERE operator_id IS NULL) >= 1,
  'cashless_maint : ops_audit_chains_to_seal rend la chaîne de la plateforme');
SELECT is((SELECT count(*) FROM ops_seal_audit(pg_temp.id('9ba002'))), 1::bigint, 'cashless_maint : ops_seal_audit (B)');
SELECT is((SELECT count(*) FROM ops_seal_audit((SELECT k FROM pc))), 1::bigint,
  'cashless_maint : ops_seal_audit (chaîne de la plateforme)');
SELECT is(current_setting('app.operator_id'), pg_temp.id('9ba001')::text, 'app.operator_id inchangé après ops_seal_audit');
-- Copie externe des scellements
SELECT is(ops_record_seal_copy('LEDGER', pg_temp.id('9bc001'), 1, 'obj/9b-l1'), true, 'cashless_maint : ops_record_seal_copy posée');
SELECT is(ops_record_seal_copy('LEDGER', pg_temp.id('9bc001'), 1, 'obj/9b-l1'), false, 'cashless_maint : rejeu même référence : false');
SELECT is(pg_temp.code(format($q$SELECT ops_record_seal_copy('LEDGER', %L, 1, 'obj/9b-autre')$q$, pg_temp.id('9bc001'))), 'CL029',
  'cashless_maint : autre référence : CL029');
SELECT is(current_setting('app.operator_id'), pg_temp.id('9ba001')::text, 'app.operator_id inchangé après ops_record_seal_copy');
SELECT ok((SELECT count(*) FROM ops_seals_since(NULL)) >= 3, 'cashless_maint : ops_seals_since rend les scellements');
SELECT is((SELECT external_ref FROM ops_verify_ledger_seals(pg_temp.id('9bc001')) WHERE seal_no = 1), 'obj/9b-l1',
  'cashless_maint : ops_verify_ledger_seals rend la référence externe');
SELECT is((SELECT bool_and(ok) FROM ops_verify_ledger_seals(pg_temp.id('9bc002'))), true,
  'cashless_maint : chaîne de B intègre sous le rôle réel');
SELECT is((SELECT count(*) FROM ops_verify_audit_chain(pg_temp.id('9ba001'))), 0::bigint,
  'cashless_maint : ops_verify_audit_chain (A) sans anomalie');
SELECT is(current_setting('app.operator_id'), pg_temp.id('9ba001')::text, 'app.operator_id inchangé après les vérifications');
-- Contrôles (somme non nulle chez B vue sous le rôle) : le posting fautif s'ajoute en propriétaire, puis retour au rôle
RESET ROLE;
INSERT INTO posting (operator_id, ledger_id, transaction_id, line_no, account_id, amount)
VALUES (pg_temp.id('9ba002'), pg_temp.id('9bc002'), pg_temp.id('9bf002'), 3, pg_temp.id('9be011'), 7);
SET LOCAL ROLE cashless_maint;
SELECT is((SELECT count(*) FROM ops_ledger_controls('FAST') WHERE ledger_id = pg_temp.id('9bc002') AND control = 'SUM_ZERO'),
  1::bigint, 'cashless_maint : ops_ledger_controls voit la somme non nulle de B');
SELECT is((SELECT count(*) FROM ops_ledger_controls('FAST') WHERE ledger_id = pg_temp.id('9bc001') AND control = 'SUM_ZERO'),
  0::bigint, 'cashless_maint : ops_ledger_controls : A sain');
SELECT ok((SELECT count(*) FROM ops_ledger_controls('SLOW')) >= 0, 'cashless_maint : ops_ledger_controls(SLOW) s''exécute');
SELECT is((SELECT array_agg(payout_id ORDER BY payout_id) FROM ops_overdue_payouts(interval '48 hours')),
  ARRAY[pg_temp.id('9b7001'), pg_temp.id('9b7002')], 'cashless_maint : ops_overdue_payouts voit les versements des deux prestataires');
SELECT is((SELECT count(*) FROM ops_unmatched_statements(interval '3 days')
            WHERE account_id IN (pg_temp.id('9be001'), pg_temp.id('9be011'))), 2::bigint,
  'cashless_maint : ops_unmatched_statements voit les relevés des deux prestataires');
SELECT is((SELECT count(*) FROM ops_new_open_anomalies(now() - interval '1 hour')
            WHERE anomaly_id IN (pg_temp.id('9baf01'), pg_temp.id('9baf02'))), 2::bigint,
  'cashless_maint : ops_new_open_anomalies voit les anomalies des deux prestataires');
-- Alerte
INSERT INTO al SELECT ops_raise_alert(9, '{"ledger": "x", "n": 2}');
SELECT is(current_setting('app.operator_id'), pg_temp.id('9ba001')::text, 'app.operator_id inchangé après ops_raise_alert');
SELECT is(pg_temp.code($q$SELECT ops_raise_alert(6, '{}')$q$), 'CL001', 'cashless_maint : ops_raise_alert code 6 refusé');
RESET ROLE;
SELECT is((SELECT count(*) FROM audit_log a JOIN al ON al.id = a.id WHERE a.operator_id IS NULL AND a.action = 'OPS_ALERT'
            AND a.object_id = '9' AND a.origin = 'maintenance' AND a.chain_key = audit_platform_chain()), 1::bigint,
  'ops_raise_alert sous cashless_maint : ligne OPS_ALERT écrite sur la chaîne de la plateforme');
-- Transactions longues : propriétaire sans pg_read_all_stats -> ligne de configuration, sans lecture de pg_stat_activity
CREATE ROLE ops9b_owner NOSUPERUSER NOLOGIN;
GRANT CREATE ON SCHEMA public TO ops9b_owner;
ALTER FUNCTION ops_long_transactions(interval) OWNER TO ops9b_owner;
SET LOCAL ROLE cashless_maint;
SELECT is((SELECT usename || ':' || coalesce(pid::text, 'nul') FROM ops_long_transactions(interval '1 hour')), '?config:nul',
  'cashless_maint : ops_long_transactions sans pg_read_all_stats : ligne ?config (C-011), aucun pg_signal_backend');
SELECT is(current_setting('app.operator_id'), pg_temp.id('9ba001')::text, 'app.operator_id inchangé après ops_long_transactions');
RESET ROLE;

-- 7. Les autres rôles cashless_* : aucun accès aux objets de la mission -------------------------------------------
SELECT is((SELECT count(*) FROM r9b r CROSS JOIN t9b t CROSS JOIN unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE',
            'TRUNCATE', 'REFERENCES', 'TRIGGER']) p
            WHERE r.r <> 'cashless_app' AND has_table_privilege(r.r, t.t, p)), 0::bigint,
  'hors cashless_app : aucun droit de table sur les cinq tables, cashless_maint compris');
SELECT finish();
ROLLBACK;
