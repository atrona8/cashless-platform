-- Garde d'insertion des demandes de remboursement (migration 0092 ; mission durcissements-serveur, lot WP02 ;
-- FR-010) — pgTAP, écrit à la main. Fixtures en propriétaire ; les refus sont prouvés sous cashless_app.
-- Lancer depuis packages/ledger-sql : pg_prove -d <base> tests/tests_refund_insert_guard.sql
\set ON_ERROR_STOP 1
\set QUIET 1
BEGIN;
\ir _grants_for_tests.sql
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

CREATE FUNCTION pg_temp.id(p text) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT ('00000000-0000-0000-0000-' || lpad(p, 12, '0'))::uuid $$;

INSERT INTO party (kind, legal_name) SELECT 'PLATFORM', 'Plateforme (test)'
 WHERE NOT EXISTS (SELECT 1 FROM party WHERE kind = 'PLATFORM');
INSERT INTO party (id, kind, legal_name, country_code) VALUES (pg_temp.id('92a001'), 'OPERATOR', 'Prestataire A', 'SN');
INSERT INTO party (id, kind, operator_id, legal_name) VALUES
 (pg_temp.id('92b001'), 'ORGANIZER', pg_temp.id('92a001'), 'Organisateur A'),
 (pg_temp.id('92c001'), 'CUSTOMER', pg_temp.id('92a001'), 'Festivalier A');
INSERT INTO customer_identity (customer_id, operator_id, phone) VALUES
 (pg_temp.id('92c001'), pg_temp.id('92a001'), '+221770000092');
INSERT INTO jurisdiction_profile (id, country_code, version, valid_from, breakage_destination)
VALUES (pg_temp.id('92d001'), 'SN', 920092, '2026-01-01', 'ORGANIZER');
INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone, jurisdiction_id, funds_holder) VALUES
 (pg_temp.id('92e001'), pg_temp.id('92a001'), pg_temp.id('92b001'), 'Événement A', 'XOF', 'Africa/Dakar',
  pg_temp.id('92d001'), 'ORGANIZER');
SELECT set_config('app.operator_id', pg_temp.id('92a001')::text, true);
SELECT open_event_ledger(pg_temp.id('92e001'));
CREATE TEMP TABLE fx AS SELECT (SELECT id FROM ledger WHERE scope_id = pg_temp.id('92e001')) AS la;
GRANT SELECT ON fx TO cashless_app;
INSERT INTO wallet (id, operator_id, ledger_id)
SELECT pg_temp.id('92f00' || n), pg_temp.id('92a001'), (SELECT la FROM fx) FROM generate_series(1, 9) n;
INSERT INTO journal_transaction (id, operator_id, ledger_id, event_id, type, idempotency_key, request_hash, occurred_at,
                                 source, created_by, approved_by)
VALUES (pg_temp.id('92aa01'), pg_temp.id('92a001'), (SELECT la FROM fx), pg_temp.id('92e001'), 'WALLET_REFUND',
        'bo:r1', 'h', now(), 'BACKOFFICE', pg_temp.id('92aaa1'), pg_temp.id('92aaa2'));
INSERT INTO journal_transaction (id, operator_id, ledger_id, event_id, type, idempotency_key, request_hash, occurred_at,
                                 source, reverses_id)
VALUES (pg_temp.id('92aa02'), pg_temp.id('92a001'), (SELECT la FROM fx), pg_temp.id('92e001'), 'REVERSAL', 'bo:r2',
        'h', now(), 'ONLINE', pg_temp.id('92aa01'));
GRANT SELECT ON journal_transaction TO cashless_app;
-- Mission 11a, WP03 : cashless_app n'a plus INSERT que sur seize colonnes (post-roles.sql §13b, prouvé par
-- tests_11a_rights.sql). Ce fichier prouve le DÉCLENCHEUR en défense en profondeur, comme si un droit de colonne
-- était élargi plus tard : l'INSERT complet est rendu à cashless_app DANS CETTE TRANSACTION SEULEMENT (ROLLBACK en fin
-- de fichier ; aucun effet sur les droits de la base).
GRANT INSERT ON refund_request TO cashless_app;

-- Insère une demande de A pour le portefeuille p_wallet, statut p_status, surcharges jsonb ; rend son id.
CREATE FUNCTION pg_temp.rr(p_wallet uuid, p_status text, p_extra jsonb DEFAULT '{}') RETURNS uuid
LANGUAGE sql AS $$
  INSERT INTO refund_request
  SELECT * FROM jsonb_populate_record(null::refund_request, jsonb_build_object(
    'id', gen_random_uuid(), 'operator_id', pg_temp.id('92a001'), 'ledger_id', (SELECT la FROM fx),
    'event_id', pg_temp.id('92e001'), 'wallet_id', p_wallet, 'customer_id', pg_temp.id('92c001'),
    'method', 'WAVE', 'msisdn', '+221770000092', 'new_number', false, 'status', p_status,
    'hold_until', now() + interval '1 hour',
    'estimated_amount', 1000, 'fee', 10, 'currency', 'XOF', 'extra_check_required', false,
    'created_at', clock_timestamp(), 'updated_at', clock_timestamp()) || p_extra)
  RETURNING id
$$;

-- 1. Nature du déclencheur
SELECT is((SELECT (tgtype & 2)::int FROM pg_trigger WHERE tgname = 'refund_request_insert_guard'
            AND tgrelid = 'refund_request'::regclass), 2, 'le déclencheur est BEFORE');
SELECT is((SELECT (tgtype & 4)::int FROM pg_trigger WHERE tgname = 'refund_request_insert_guard'
            AND tgrelid = 'refund_request'::regclass), 4, 'le déclencheur est sur INSERT');
SELECT is((SELECT (tgtype & 1)::int FROM pg_trigger WHERE tgname = 'refund_request_insert_guard'
            AND tgrelid = 'refund_request'::regclass), 1, 'le déclencheur est FOR EACH ROW');
SELECT ok(NOT has_function_privilege('cashless_app', 'refund_request_insert_guard()', 'EXECUTE')
          AND NOT has_function_privilege('public', 'refund_request_insert_guard()', 'EXECUTE'),
  'la fonction du déclencheur n''est exécutable ni par PUBLIC ni par cashless_app (appel direct)');
SELECT is((SELECT prosecdef FROM pg_proc WHERE proname = 'refund_request_insert_guard'), false,
  'fonction non SECURITY DEFINER (current_user = rôle de session)');

-- 2. Propriétaire : états finals acceptés (fixtures)
SELECT lives_ok(format($q$SELECT pg_temp.rr(%L, 'PAID', %L)$q$, pg_temp.id('92f001'),
  jsonb_build_object('transaction_id', pg_temp.id('92aa01'), 'approved_by', pg_temp.id('92aaa2'),
                     'external_reference', 'PSP-1')),
  'propriétaire : INSERT en PAID complet accepté');
SELECT lives_ok(format($q$SELECT pg_temp.rr(%L, 'CANCELLED')$q$, pg_temp.id('92f002')),
  'propriétaire : INSERT en CANCELLED accepté');

-- 3. cashless_app : refus. Le code obtenu est écrit tel quel (CL057 : le déclencheur parle d'abord).
SET LOCAL ROLE cashless_app;
SELECT set_config('app.operator_id', pg_temp.id('92a001')::text, true);
SELECT throws_ok(format($q$SELECT pg_temp.rr(%L, 'PAID', %L)$q$, pg_temp.id('92f003'),
  jsonb_build_object('transaction_id', pg_temp.id('92aa01'), 'approved_by', pg_temp.id('92aaa2'),
                     'external_reference', 'PSP-2')), 'CL057', NULL, 'app : PAID refusé (CL057)');
SELECT throws_ok(format($q$SELECT pg_temp.rr(%L, 'CANCELLED')$q$, pg_temp.id('92f003')), 'CL057', NULL,
  'app : CANCELLED refusé (CL057)');
SELECT throws_ok(format($q$SELECT pg_temp.rr(%L, 'FAILED', %L)$q$, pg_temp.id('92f003'),
  jsonb_build_object('failure_reason', 'x', 'reversal_transaction_id', pg_temp.id('92aa02'))),
  'CL057', NULL, 'app : FAILED refusé (CL057)');
SELECT throws_ok(format($q$SELECT pg_temp.rr(%L, 'REJECTED', %L)$q$, pg_temp.id('92f003'),
  jsonb_build_object('reject_reason', 'x')), 'CL057', NULL, 'app : REJECTED refusé (CL057)');
SELECT throws_ok(format($q$SELECT pg_temp.rr(%L, 'PROCESSING')$q$, pg_temp.id('92f003')), 'CL057', NULL,
  'app : PROCESSING refusé (CL057)');
SELECT throws_ok(format($q$SELECT pg_temp.rr(%L, 'BLOCKED', %L)$q$, pg_temp.id('92f003'),
  jsonb_build_object('holder_decision', 'BLOCK', 'holder_decided_at', now())), 'CL057', NULL,
  'app : BLOCKED refusé (CL057)');
SELECT throws_ok(format($q$SELECT pg_temp.rr(%L, 'REQUESTED', %L)$q$, pg_temp.id('92f003'),
  jsonb_build_object('approved_by', pg_temp.id('92aaa2'))), 'CL057', NULL, 'app : REQUESTED avec approved_by refusé');
SELECT throws_ok(format($q$SELECT pg_temp.rr(%L, 'REQUESTED', %L)$q$, pg_temp.id('92f003'),
  jsonb_build_object('transaction_id', pg_temp.id('92aa01'))), 'CL057', NULL,
  'app : REQUESTED avec transaction_id refusé');
SELECT throws_ok(format($q$SELECT pg_temp.rr(%L, 'REQUESTED', %L)$q$, pg_temp.id('92f003'),
  jsonb_build_object('confirmed_at', now())), 'CL057', NULL, 'app : REQUESTED avec confirmed_at refusé');
SELECT throws_ok(format($q$SELECT pg_temp.rr(%L, 'REQUESTED', %L)$q$, pg_temp.id('92f003'),
  jsonb_build_object('external_reference', 'PSP-3')), 'CL057', NULL,
  'app : REQUESTED avec external_reference refusé');
SELECT throws_ok(format($q$SELECT pg_temp.rr(%L, 'AWAITING_HOLDER', %L)$q$, pg_temp.id('92f003'),
  jsonb_build_object('holder_decision', 'CONFIRM', 'holder_decided_at', now())), 'CL057', NULL,
  'app : AWAITING_HOLDER avec décision du titulaire refusé');
-- INSERT ... SELECT multi-lignes : une seule ligne hors état initial fait tout refuser
SELECT throws_ok(format($q$INSERT INTO refund_request (operator_id, ledger_id, event_id, wallet_id, method, msisdn,
    new_number, status, estimated_amount, fee, currency, hold_until, failure_reason)
  SELECT %L, %L, %L, w, 'WAVE', '+221770000092', false, 'AWAITING_HOLDER', 1, 0, 'XOF', now() + interval '1 hour',
         CASE WHEN w = %L THEN 'x' END
    FROM unnest(ARRAY[%L::uuid, %L::uuid]) w$q$, pg_temp.id('92a001'), (SELECT la FROM fx), pg_temp.id('92e001'),
  pg_temp.id('92f004'), pg_temp.id('92f003'), pg_temp.id('92f004')), 'CL057', NULL,
  'app : INSERT ... SELECT multi-lignes avec une ligne hors état initial : refusé');
SELECT is((SELECT count(*)::int FROM refund_request WHERE wallet_id IN (pg_temp.id('92f003'), pg_temp.id('92f004'))),
  0, 'app : aucune ligne écrite par les refus');
-- Positifs
SELECT lives_ok(format($q$SELECT pg_temp.rr(%L, 'AWAITING_HOLDER')$q$, pg_temp.id('92f003')),
  'app : AWAITING_HOLDER à colonnes de transition nulles passe');
SELECT lives_ok(format($q$SELECT pg_temp.rr(%L, 'REQUESTED')$q$, pg_temp.id('92f004')),
  'app : REQUESTED à colonnes de transition nulles passe');
-- Désactivation réservée au propriétaire
SELECT throws_ok($q$ALTER TABLE refund_request DISABLE TRIGGER refund_request_insert_guard$q$, '42501', NULL,
  'app ne peut pas désactiver le déclencheur');
RESET ROLE;

-- 4. Mutation (NFR-004) : déclencheur désactivé, l'INSERT en CANCELLED sous cashless_app passe
ALTER TABLE refund_request DISABLE TRIGGER refund_request_insert_guard;
SET LOCAL ROLE cashless_app;
SELECT set_config('app.operator_id', pg_temp.id('92a001')::text, true);
SELECT lives_ok(format($q$SELECT pg_temp.rr(%L, 'CANCELLED')$q$, pg_temp.id('92f005')),
  'MUTATION : déclencheur désactivé, CANCELLED passe sous cashless_app (preuve que le test mord)');
RESET ROLE;
ALTER TABLE refund_request ENABLE TRIGGER refund_request_insert_guard;
SET LOCAL ROLE cashless_app;
SELECT set_config('app.operator_id', pg_temp.id('92a001')::text, true);
SELECT throws_ok(format($q$SELECT pg_temp.rr(%L, 'CANCELLED')$q$, pg_temp.id('92f006')), 'CL057', NULL,
  'déclencheur réactivé : CANCELLED refusé de nouveau');
RESET ROLE;

-- 5. refund_deposit_for_session(uuid, uuid) retirée ; refund_deposit(uuid, uuid) intacte
SELECT hasnt_function('refund_deposit_for_session', ARRAY['uuid', 'uuid'], 'la surcharge à deux arguments est retirée');
SELECT has_function('refund_deposit_for_session', ARRAY['uuid', 'uuid', 'uuid', 'uuid'],
  'la surcharge à quatre arguments reste');

SELECT * FROM finish();
ROLLBACK;
