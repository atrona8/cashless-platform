-- Demandes de remboursement (migration 0081, post-roles.sql §11 ; mission 9a, lot WP01) — pgTAP, écrit à la main.
-- Famille 1 (propriétaire) : invariants CHECK, index unique partiel (FR-003, NFR-002), garde d'insertion, fonctions,
-- colonnes d'usage de otp_challenge. Famille 2 (rôles) : RLS, droits de table et de colonne, EXECUTE, isolation.
-- Lancer : pg_prove -d <base> tests/tests_refund_requests.sql (base créée par les migrations, droits rejoués).
\set ON_ERROR_STOP 1
\set QUIET 1
BEGIN;
\ir _grants_for_tests.sql
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

CREATE FUNCTION pg_temp.id(p text) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT ('00000000-0000-0000-0000-' || lpad(p, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.h(p text) RETURNS bytea LANGUAGE sql IMMUTABLE AS
  $$ SELECT sha256(convert_to('81 ' || p, 'UTF8')) $$;

-- Données (propriétaire) : prestataires A et B, un organisateur, un festivalier, un événement et un grand livre chacun.
INSERT INTO party (kind, legal_name) SELECT 'PLATFORM', 'Plateforme (test)' WHERE NOT EXISTS (SELECT 1 FROM party WHERE kind = 'PLATFORM');
INSERT INTO party (id, kind, legal_name, country_code) VALUES
 (pg_temp.id('81a001'), 'OPERATOR', 'Prestataire A', 'SN'),
 (pg_temp.id('81a002'), 'OPERATOR', 'Prestataire B', 'SN');
INSERT INTO party (id, kind, operator_id, legal_name) VALUES
 (pg_temp.id('81b001'), 'ORGANIZER', pg_temp.id('81a001'), 'Organisateur A'),
 (pg_temp.id('81b002'), 'ORGANIZER', pg_temp.id('81a002'), 'Organisateur B'),
 (pg_temp.id('81c001'), 'CUSTOMER', pg_temp.id('81a001'), 'Festivalier A'),
 (pg_temp.id('81c002'), 'CUSTOMER', pg_temp.id('81a002'), 'Festivalier B');
INSERT INTO customer_identity (customer_id, operator_id, phone) VALUES
 (pg_temp.id('81c001'), pg_temp.id('81a001'), '+221770000001'),
 (pg_temp.id('81c002'), pg_temp.id('81a002'), '+221770000002');
INSERT INTO jurisdiction_profile (id, country_code, version, valid_from, breakage_destination)
VALUES (pg_temp.id('81d001'), 'SN', 810081, '2026-01-01', 'ORGANIZER');
INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone, jurisdiction_id, funds_holder) VALUES
 (pg_temp.id('81e001'), pg_temp.id('81a001'), pg_temp.id('81b001'), 'Événement A', 'XOF', 'Africa/Dakar',
  pg_temp.id('81d001'), 'ORGANIZER'),
 (pg_temp.id('81e002'), pg_temp.id('81a002'), pg_temp.id('81b002'), 'Événement B', 'XOF', 'Africa/Dakar',
  pg_temp.id('81d001'), 'ORGANIZER');
SELECT set_config('app.operator_id', pg_temp.id('81a001')::text, true);
SELECT open_event_ledger(pg_temp.id('81e001'));
SELECT set_config('app.operator_id', pg_temp.id('81a002')::text, true);
SELECT open_event_ledger(pg_temp.id('81e002'));
CREATE TEMP TABLE fx AS
SELECT (SELECT id FROM ledger WHERE scope_id = pg_temp.id('81e001')) AS la,
       (SELECT id FROM ledger WHERE scope_id = pg_temp.id('81e002')) AS lb;
GRANT SELECT ON fx TO cashless_app;
INSERT INTO wallet (id, operator_id, ledger_id)
SELECT pg_temp.id('81f00' || n), pg_temp.id('81a001'), (SELECT la FROM fx) FROM generate_series(1, 7) n;
INSERT INTO wallet (id, operator_id, ledger_id) SELECT pg_temp.id('81f0b1'), pg_temp.id('81a002'), (SELECT lb FROM fx);
INSERT INTO journal_transaction (id, operator_id, ledger_id, event_id, type, idempotency_key, request_hash, occurred_at,
                                 source, created_by, approved_by)
VALUES (pg_temp.id('81aa01'), pg_temp.id('81a001'), (SELECT la FROM fx), pg_temp.id('81e001'), 'WALLET_REFUND', 'bo:r1',
        'h', now(), 'BACKOFFICE', pg_temp.id('81aaa1'), pg_temp.id('81aaa2'));
INSERT INTO journal_transaction (id, operator_id, ledger_id, event_id, type, idempotency_key, request_hash, occurred_at,
                                 source, reverses_id)
VALUES (pg_temp.id('81aa02'), pg_temp.id('81a001'), (SELECT la FROM fx), pg_temp.id('81e001'), 'REVERSAL', 'bo:r2',
        'h', now(), 'ONLINE', pg_temp.id('81aa01'));

-- Insère une demande valide de A (portefeuille p_wallet, statut p_status) avec des surcharges jsonb ; rend son id.
CREATE FUNCTION pg_temp.rr(p_wallet uuid, p_status text, p_extra jsonb DEFAULT '{}') RETURNS uuid
LANGUAGE sql AS $$
  INSERT INTO refund_request
  SELECT * FROM jsonb_populate_record(null::refund_request, jsonb_build_object(
    'id', gen_random_uuid(), 'operator_id', pg_temp.id('81a001'), 'ledger_id', (SELECT la FROM fx),
    'event_id', pg_temp.id('81e001'), 'wallet_id', p_wallet, 'customer_id', pg_temp.id('81c001'),
    'method', 'WAVE', 'msisdn', '+221770000001', 'new_number', false, 'status', p_status,
    'estimated_amount', 1000, 'fee', 10, 'currency', 'XOF', 'extra_check_required', false,
    'created_at', clock_timestamp(), 'updated_at', clock_timestamp()) || p_extra)
  RETURNING id
$$;
CREATE FUNCTION pg_temp.st(p uuid) RETURNS text LANGUAGE sql AS $$ SELECT status FROM refund_request WHERE id = p $$;

-- ===== Famille 1 : propriétaire ===========================================================================================
-- 1. CHECK d'invariants (violation 23514, puis cas valide)
SELECT throws_ok(format($q$SELECT pg_temp.rr(%L, 'PAID', %L)$q$, pg_temp.id('81f001'),
  jsonb_build_object('transaction_id', pg_temp.id('81aa01'), 'approved_by', pg_temp.id('81aaa2'))),
  '23514', NULL, 'PAID sans référence externe : refusé');
SELECT throws_ok(format($q$SELECT pg_temp.rr(%L, 'PAID', %L)$q$, pg_temp.id('81f001'),
  jsonb_build_object('transaction_id', pg_temp.id('81aa01'), 'approved_by', pg_temp.id('81aaa2'),
                     'external_reference', '  ')),
  '23514', NULL, 'PAID avec référence blanche : refusé');
SELECT lives_ok(format($q$SELECT pg_temp.rr(%L, 'PAID', %L)$q$, pg_temp.id('81f006'),
  jsonb_build_object('transaction_id', pg_temp.id('81aa01'), 'approved_by', pg_temp.id('81aaa2'),
                     'external_reference', 'WAVE-123')), 'PAID complet : accepté');
SELECT throws_ok(format($q$SELECT pg_temp.rr(%L, 'FAILED', %L)$q$, pg_temp.id('81f001'),
  jsonb_build_object('transaction_id', pg_temp.id('81aa01'), 'approved_by', pg_temp.id('81aaa2'),
                     'failure_reason', 'Compte fermé')),
  '23514', NULL, 'FAILED sans REVERSAL : refusé');
SELECT throws_ok(format($q$SELECT pg_temp.rr(%L, 'FAILED', %L)$q$, pg_temp.id('81f001'),
  jsonb_build_object('transaction_id', pg_temp.id('81aa01'), 'approved_by', pg_temp.id('81aaa2'),
                     'reversal_transaction_id', pg_temp.id('81aa02'))),
  '23514', NULL, 'FAILED sans motif : refusé');
SELECT lives_ok(format($q$SELECT pg_temp.rr(%L, 'FAILED', %L)$q$, pg_temp.id('81f006'),
  jsonb_build_object('transaction_id', pg_temp.id('81aa01'), 'approved_by', pg_temp.id('81aaa2'),
                     'failure_reason', 'Compte fermé', 'reversal_transaction_id', pg_temp.id('81aa02'))),
  'FAILED complet : accepté');
SELECT throws_ok($q$SELECT pg_temp.rr(pg_temp.id('81f001'), 'REJECTED')$q$, '23514', NULL, 'REJECTED sans motif : refusé');
SELECT lives_ok($q$SELECT pg_temp.rr(pg_temp.id('81f006'), 'REJECTED', '{"reject_reason":"Hors délai"}')$q$,
  'REJECTED avec motif : accepté');
SELECT throws_ok(format($q$SELECT pg_temp.rr(%L, 'PROCESSING', %L)$q$, pg_temp.id('81f001'),
  jsonb_build_object('transaction_id', pg_temp.id('81aa01'))),
  '23514', NULL, 'PROCESSING sans valideur : refusé');
SELECT throws_ok(format($q$SELECT pg_temp.rr(%L, 'PROCESSING', %L)$q$, pg_temp.id('81f001'),
  jsonb_build_object('approved_by', pg_temp.id('81aaa2'))),
  '23514', NULL, 'PROCESSING sans transaction : refusé');
SELECT throws_ok(format($q$SELECT pg_temp.rr(%L, 'PROCESSING', %L)$q$, pg_temp.id('81f001'),
  jsonb_build_object('transaction_id', pg_temp.id('81aa01'), 'approved_by', pg_temp.id('81aaa2'),
                     'requested_by', pg_temp.id('81aaa2'))),
  '23514', NULL, 'demandeur du back-office égal au valideur : refusé');
SELECT throws_ok($q$SELECT pg_temp.rr(pg_temp.id('81f001'), 'AWAITING_HOLDER')$q$, '23514', NULL,
  'AWAITING_HOLDER sans échéance : refusé');
SELECT throws_ok($q$SELECT pg_temp.rr(pg_temp.id('81f001'), 'BLOCKED')$q$, '23514', NULL,
  'BLOCKED sans décision BLOCK : refusé');
SELECT throws_ok($q$SELECT pg_temp.rr(pg_temp.id('81f001'), 'BLOCKED', '{"holder_decision":"CONFIRM","holder_decided_at":"2026-01-01"}')$q$,
  '23514', NULL, 'BLOCKED avec décision CONFIRM : refusé');
SELECT lives_ok($q$SELECT pg_temp.rr(pg_temp.id('81f006'), 'BLOCKED', '{"holder_decision":"BLOCK","holder_decided_at":"2026-01-01"}')$q$,
  'BLOCKED avec décision BLOCK : accepté');
SELECT throws_ok($q$SELECT pg_temp.rr(pg_temp.id('81f001'), 'REQUESTED', '{"holder_decision":"BLOCK"}')$q$, '23514', NULL,
  'décision sans date : refusé');
SELECT throws_ok($q$SELECT pg_temp.rr(pg_temp.id('81f001'), 'REQUESTED', '{"holder_decision":"MAYBE","holder_decided_at":"2026-01-01"}')$q$,
  '23514', NULL, 'décision hors CONFIRM / BLOCK : refusé');
SELECT throws_ok($q$SELECT pg_temp.rr(pg_temp.id('81f001'), 'REQUESTED', '{"estimated_amount":-1}')$q$, '23514', NULL,
  'montant négatif : refusé');
SELECT throws_ok($q$SELECT pg_temp.rr(pg_temp.id('81f001'), 'REQUESTED', '{"fee":-1}')$q$, '23514', NULL,
  'frais négatifs : refusés');
SELECT throws_ok($q$SELECT pg_temp.rr(pg_temp.id('81f001'), 'REQUESTED', '{"extra_check_required":true}')$q$, '23514', NULL,
  'contrôle renforcé sans autre numéro : refusé');
SELECT lives_ok($q$SELECT pg_temp.rr(pg_temp.id('81f006'), 'CANCELLED', '{"new_number":true,"extra_check_required":true}')$q$,
  'contrôle renforcé avec autre numéro : accepté (CANCELLED reste dans l''énumération)');
SELECT throws_ok($q$SELECT pg_temp.rr(pg_temp.id('81f001'), 'REQUESTED', '{"msisdn":"0770000001"}')$q$, '23514', NULL,
  'canal mobile avec numéro hors E.164 : refusé');
SELECT throws_ok($q$SELECT pg_temp.rr(pg_temp.id('81f001'), 'REQUESTED', '{"msisdn":null}')$q$, '23514', NULL,
  'canal mobile sans numéro : refusé');
SELECT throws_ok($q$SELECT pg_temp.rr(pg_temp.id('81f001'), 'ARCHIVED')$q$, '23514', NULL, 'statut hors énumération : refusé');
SELECT throws_ok($q$SELECT pg_temp.rr(pg_temp.id('81f001'), 'REQUESTED', '{"method":"CASH"}')$q$, '23514', NULL,
  'canal hors énumération : refusé');
SELECT lives_ok($q$SELECT pg_temp.rr(pg_temp.id('81f006'), 'CANCELLED', '{"method":"BANK_TRANSFER","msisdn":null,"iban":"enc:v1:k1:SN08X"}')$q$,
  'BANK_TRANSFER reste dans l''énumération du contrat');

-- 2. Index unique partiel : une demande ouverte par portefeuille (FR-003, NFR-002)
SELECT has_index('refund_request', 'refund_request_one_open', 'wallet_id', 'index refund_request_one_open présent (lu par l''API)');
SELECT lives_ok($q$SELECT pg_temp.rr(pg_temp.id('81f002'), 'REQUESTED')$q$, 'première demande ouverte : acceptée');
SELECT throws_ok($q$SELECT pg_temp.rr(pg_temp.id('81f002'), 'REQUESTED')$q$, '23505', NULL,
  'seconde demande ouverte du même portefeuille : refusée (23505)');
SELECT throws_ok($q$SELECT pg_temp.rr(pg_temp.id('81f002'), 'AWAITING_HOLDER', '{"hold_until":"2099-01-01"}')$q$, '23505', NULL,
  'AWAITING_HOLDER compte comme ouverte');
SELECT throws_ok(format($q$SELECT pg_temp.rr(%L, 'PROCESSING', %L)$q$, pg_temp.id('81f002'),
  jsonb_build_object('transaction_id', pg_temp.id('81aa01'), 'approved_by', pg_temp.id('81aaa2'))),
  '23505', NULL, 'PROCESSING compte comme ouverte');
SELECT lives_ok($q$SELECT pg_temp.rr(pg_temp.id('81f003'), 'REQUESTED')$q$, 'deux portefeuilles distincts : acceptés');
SELECT lives_ok(format($q$SELECT pg_temp.rr(%L, 'PAID', %L)$q$, pg_temp.id('81f004'),
  jsonb_build_object('transaction_id', pg_temp.id('81aa01'), 'approved_by', pg_temp.id('81aaa2'),
                     'external_reference', 'R1')), 'PAID puis ...');
SELECT lives_ok(format($q$SELECT pg_temp.rr(%L, 'FAILED', %L)$q$, pg_temp.id('81f004'),
  jsonb_build_object('transaction_id', pg_temp.id('81aa01'), 'approved_by', pg_temp.id('81aaa2'),
                     'failure_reason', 'x', 'reversal_transaction_id', pg_temp.id('81aa02'))), '... FAILED ...');
SELECT lives_ok($q$SELECT pg_temp.rr(pg_temp.id('81f004'), 'REJECTED', '{"reject_reason":"x"}')$q$, '... REJECTED ...');
SELECT lives_ok($q$SELECT pg_temp.rr(pg_temp.id('81f004'), 'BLOCKED', '{"holder_decision":"BLOCK","holder_decided_at":"2026-01-01"}')$q$,
  '... BLOCKED ...');
SELECT lives_ok($q$SELECT pg_temp.rr(pg_temp.id('81f004'), 'REQUESTED')$q$, '... puis une ouverte : acceptée');

-- 3. Garde d'insertion : éléments d'un autre prestataire (CL001)
SELECT throws_ok(format($q$SELECT pg_temp.rr(%L, 'REQUESTED')$q$, pg_temp.id('81f0b1')), 'CL001', NULL,
  'portefeuille d''un autre prestataire : refusé');
SELECT throws_ok(format($q$SELECT pg_temp.rr(%L, 'REQUESTED', %L)$q$, pg_temp.id('81f005'),
  jsonb_build_object('ledger_id', (SELECT lb FROM fx))), 'CL001', NULL, 'grand livre d''un autre prestataire : refusé');
SELECT throws_ok(format($q$SELECT pg_temp.rr(%L, 'REQUESTED', %L)$q$, pg_temp.id('81f005'),
  jsonb_build_object('event_id', pg_temp.id('81e002'))), 'CL001', NULL, 'événement d''un autre prestataire : refusé');
SELECT throws_ok(format($q$SELECT pg_temp.rr(%L, 'REQUESTED', %L)$q$, pg_temp.id('81f005'),
  jsonb_build_object('customer_id', pg_temp.id('81c002'))), 'CL001', NULL, 'festivalier d''un autre prestataire : refusé');
SELECT lives_ok($q$SELECT pg_temp.rr(pg_temp.id('81f005'), 'REQUESTED', '{"customer_id":null}')$q$,
  'demande sans festivalier (back-office) : acceptée');

-- 4. refund_request_operator
INSERT INTO refund_request (id, operator_id, ledger_id, event_id, wallet_id, customer_id, method, msisdn, new_number,
                            status, estimated_amount, fee, currency)
VALUES (pg_temp.id('81bb01'), pg_temp.id('81a002'), (SELECT lb FROM fx), pg_temp.id('81e002'), pg_temp.id('81f0b1'),
        pg_temp.id('81c002'), 'WAVE', '+221770000002', false, 'CANCELLED', 500, 5, 'XOF');   -- WP06 : créée directement
SELECT is(refund_request_operator(pg_temp.id('81bb01')), pg_temp.id('81a002'), 'demande de B : prestataire B');
SELECT is(refund_request_operator(pg_temp.id('81bb99')), NULL, 'demande inconnue : NULL');

-- 5. promote_due_refund_requests
INSERT INTO refund_request (id, operator_id, ledger_id, event_id, wallet_id, customer_id, method, msisdn, new_number,
                            status, estimated_amount, fee, currency, hold_until)
VALUES (pg_temp.id('81bb02'), pg_temp.id('81a001'), (SELECT la FROM fx), pg_temp.id('81e001'), pg_temp.id('81f001'),
        pg_temp.id('81c001'), 'WAVE', '+221770000009', true, 'AWAITING_HOLDER', 500, 5, 'XOF',
        clock_timestamp() - interval '1 minute');
INSERT INTO refund_request (id, operator_id, ledger_id, event_id, wallet_id, customer_id, method, msisdn, new_number,
                            status, estimated_amount, fee, currency, hold_until)
VALUES (pg_temp.id('81bb03'), pg_temp.id('81a001'), (SELECT la FROM fx), pg_temp.id('81e001'), pg_temp.id('81f006'),
        pg_temp.id('81c001'), 'WAVE', '+221770000009', true, 'AWAITING_HOLDER', 500, 5, 'XOF',
        clock_timestamp() + interval '1 day');
-- Une seconde échue, chez B : l'appel couvre tous les prestataires.
-- (81bb01 est déjà CANCELLED depuis sa création : REQUESTED -> CANCELLED est refusé par le déclencheur, 0086, WP06.)
INSERT INTO refund_request (id, operator_id, ledger_id, event_id, wallet_id, customer_id, method, msisdn, new_number,
                            status, estimated_amount, fee, currency, hold_until)
VALUES (pg_temp.id('81bb04'), pg_temp.id('81a002'), (SELECT lb FROM fx), pg_temp.id('81e002'), pg_temp.id('81f0b1'),
        pg_temp.id('81c002'), 'WAVE', '+221770000009', true, 'AWAITING_HOLDER', 500, 5, 'XOF',
        clock_timestamp() - interval '1 second');
SELECT is(promote_due_refund_requests(), 2, 'deux échues (deux prestataires) promues dans le même appel');
SELECT is(pg_temp.st(pg_temp.id('81bb02')), 'REQUESTED', 'l''échue de A est REQUESTED');
SELECT is(pg_temp.st(pg_temp.id('81bb04')), 'REQUESTED', 'l''échue de B est REQUESTED');
SELECT is((SELECT holder_decision FROM refund_request WHERE id = pg_temp.id('81bb02')), NULL,
  'holder_decision reste nul (échéance, pas décision)');
SELECT is((SELECT holder_decided_at FROM refund_request WHERE id = pg_temp.id('81bb02')), NULL, 'holder_decided_at reste nul');
SELECT is(pg_temp.st(pg_temp.id('81bb03')), 'AWAITING_HOLDER', 'la non échue reste intacte');
SELECT is((SELECT count(*)::int FROM refund_request WHERE wallet_id = pg_temp.id('81f003') AND status = 'REQUESTED'), 1,
  'une REQUESTED d''origine reste intacte');
SELECT is((SELECT count(*)::int FROM refund_request WHERE status = 'BLOCKED'), 2, 'les BLOCKED ne sont pas touchées');
SELECT is(promote_due_refund_requests(), 0, 'second appel : 0 (idempotente)');

-- 6. otp_challenge : purpose et subject_id
INSERT INTO otp_challenge (id, operator_id, phone, channel, code_hash, client_ref, expires_at) VALUES
 (pg_temp.id('81d0a1'), pg_temp.id('81a001'), '+221770000001', 'SMS', pg_temp.h('a'), 'r', now() + interval '5 min');
SELECT is((SELECT purpose FROM otp_challenge WHERE id = pg_temp.id('81d0a1')), 'LOGIN', 'purpose vaut LOGIN par défaut');
SELECT is((SELECT subject_id FROM otp_challenge WHERE id = pg_temp.id('81d0a1')), NULL, 'subject_id nul par défaut');
SELECT throws_ok($q$INSERT INTO otp_challenge (operator_id, phone, channel, code_hash, client_ref, expires_at, purpose)
  VALUES (pg_temp.id('81a001'), '+221770000001', 'SMS', pg_temp.h('b'), 'r', now(), 'AUTRE')$q$, '23514', NULL,
  'purpose hors liste : refusé');
SELECT throws_ok($q$INSERT INTO otp_challenge (operator_id, phone, channel, code_hash, client_ref, expires_at, purpose)
  VALUES (pg_temp.id('81a001'), '+221770000001', 'SMS', pg_temp.h('c'), 'r', now(), 'REFUND_HOLDER')$q$, '23514', NULL,
  'REFUND_HOLDER sans subject_id : refusé');
SELECT throws_ok($q$INSERT INTO otp_challenge (operator_id, phone, channel, code_hash, client_ref, expires_at, subject_id)
  VALUES (pg_temp.id('81a001'), '+221770000001', 'SMS', pg_temp.h('d'), 'r', now(), pg_temp.id('81bb02'))$q$, '23514', NULL,
  'LOGIN avec subject_id : refusé');
SELECT lives_ok($q$INSERT INTO otp_challenge (operator_id, phone, channel, code_hash, client_ref, expires_at, purpose, subject_id)
  VALUES (pg_temp.id('81a001'), '+221770000001', 'SMS', pg_temp.h('e'), 'r', now(), 'REFUND_HOLDER', pg_temp.id('81bb02'))$q$,
  'REFUND_HOLDER avec subject_id : accepté');

-- ===== Famille 2 : rôles ===================================================================================================
-- 7. RLS ENABLE + FORCE
SELECT is((SELECT count(*)::int FROM pg_class WHERE oid = 'public.refund_request'::regclass
            AND relrowsecurity AND relforcerowsecurity), 1, 'RLS ENABLE + FORCE sur refund_request');
SELECT is((SELECT polname FROM pg_policy WHERE polrelid = 'public.refund_request'::regclass), 'tenant_isolation',
  'politique tenant_isolation');

-- 8. Droits exacts de cashless_app
SELECT is((SELECT string_agg(p, ' ' ORDER BY p)
             FROM unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p
            WHERE has_table_privilege('cashless_app', 'refund_request', p)), 'SELECT',
  'cashless_app : SELECT seulement au niveau table (INSERT par seize colonnes depuis la mission 11a, WP03 : '
  'tests_11a_rights.sql ; jamais UPDATE de table entière, DELETE, TRUNCATE)');
SELECT is((SELECT string_agg(a.attname, ' ' ORDER BY a.attname) FROM pg_attribute a
            WHERE a.attrelid = 'public.refund_request'::regclass AND a.attnum > 0 AND NOT a.attisdropped
              AND has_column_privilege('cashless_app', a.attrelid, a.attnum, 'UPDATE')),
  'approval_request_id approved_by confirmed_at confirmed_by estimated_amount external_reference failure_reason fee '
  'holder_decided_at holder_decision reject_reason reversal_transaction_id status transaction_id updated_at',
  'cashless_app : colonnes modifiables exactes (colonnes de transition)');
SELECT is((SELECT count(*)::int FROM unnest(ARRAY['cashless_platform', 'cashless_tagkeys', 'cashless_perso',
                               'cashless_tagcheck', 'cashless_keyadmin', 'cashless_snapcontent', 'cashless_snapsign',
                               'cashless_maint']) r
            WHERE has_any_column_privilege(r, 'public.refund_request'::regclass, 'SELECT')
               OR has_any_column_privilege(r, 'public.refund_request'::regclass, 'INSERT')
               OR has_any_column_privilege(r, 'public.refund_request'::regclass, 'UPDATE')
               OR has_table_privilege(r, 'public.refund_request'::regclass, 'DELETE')), 0,
  'aucun autre rôle cashless_* ne lit ni n''écrit refund_request (cashless_maint compris)');
SELECT is((SELECT count(*)::int FROM pg_roles r WHERE r.rolname LIKE 'cashless\_%' AND r.rolname <> 'cashless_app'
            AND NOT r.rolsuper
            AND (has_any_column_privilege(r.rolname, 'public.refund_request'::regclass, 'SELECT')
              OR has_any_column_privilege(r.rolname, 'public.refund_request'::regclass, 'INSERT')
              OR has_any_column_privilege(r.rolname, 'public.refund_request'::regclass, 'UPDATE'))), 0,
  'aucun rôle cashless_* existant (autres que cashless_app) n''accède à la table');

-- 9. Fonctions : SECURITY DEFINER au search_path figé ; EXECUTE
SELECT is((SELECT string_agg(proname, ' ' ORDER BY proname) FROM pg_proc
            WHERE pronamespace = 'public'::regnamespace AND prosecdef
              AND proname IN ('refund_request_operator', 'promote_due_refund_requests', 'refund_request_scope_guard')
              AND proconfig @> ARRAY['search_path=public, pg_temp']),
  'promote_due_refund_requests refund_request_operator refund_request_scope_guard',
  'trois fonctions SECURITY DEFINER au search_path figé (public, pg_temp)');
SELECT is((SELECT string_agg(r || ':' || f, ' ' ORDER BY r, f)
             FROM unnest(ARRAY['public', 'cashless_platform', 'cashless_tagkeys', 'cashless_perso',
                               'cashless_tagcheck', 'cashless_keyadmin', 'cashless_snapcontent',
                               'cashless_snapsign']) r,
                  unnest(ARRAY['refund_request_operator(uuid)', 'promote_due_refund_requests()',
                               'refund_request_scope_guard()']) f
            WHERE has_function_privilege(r, f::regprocedure, 'EXECUTE')), NULL,
  'aucun autre rôle (PUBLIC compris) n''exécute les trois fonctions');
SELECT is((SELECT string_agg(f, ' ' ORDER BY f) FROM unnest(ARRAY['refund_request_operator(uuid)',
                               'promote_due_refund_requests()', 'refund_request_scope_guard()']) f
            WHERE has_function_privilege('cashless_app', f::regprocedure, 'EXECUTE')),
  'promote_due_refund_requests() refund_request_operator(uuid)',
  'cashless_app exécute les deux fonctions publiques, pas la fonction de déclencheur');
SELECT is((SELECT string_agg(f, ' ' ORDER BY f) FROM unnest(ARRAY['refund_request_operator(uuid)',
                               'promote_due_refund_requests()', 'refund_request_scope_guard()']) f
            WHERE has_function_privilege('cashless_maint', f::regprocedure, 'EXECUTE')),
  'promote_due_refund_requests()', 'cashless_maint exécute la promotion seule');

-- 10. Isolation entre prestataires sous cashless_app
SET LOCAL ROLE cashless_app;
SELECT set_config('app.operator_id', pg_temp.id('81a001')::text, true);
SELECT is((SELECT count(*)::int FROM refund_request WHERE operator_id <> pg_temp.id('81a001')), 0,
  'A ne voit aucune demande de B');
SELECT cmp_ok((SELECT count(*)::int FROM refund_request), '>', 0, 'A voit ses demandes');
SELECT is(refund_request_operator(pg_temp.id('81bb04')), pg_temp.id('81a002'),
  'la fonction publique rend le prestataire d''une demande de B (identifiant seul)');
SELECT is((SELECT count(*)::int FROM (SELECT * FROM refund_request WHERE id = pg_temp.id('81bb04')) s), 0,
  'A ne lit pas la demande de B');
SELECT results_eq($q$WITH u AS (UPDATE refund_request SET status = 'CANCELLED' WHERE id = pg_temp.id('81bb04')
                                RETURNING 1) SELECT count(*)::int FROM u$q$, ARRAY[0], 'A ne met pas à jour la demande de B');
SELECT throws_ok(format($q$INSERT INTO refund_request (operator_id, ledger_id, event_id, wallet_id, method, msisdn,
    new_number, status, estimated_amount, fee, currency)
  VALUES (%L, %L, %L, %L, 'WAVE', '+221770000009', false, 'REQUESTED', 1, 0, 'XOF')$q$,
  pg_temp.id('81a002'), (SELECT lb FROM fx), pg_temp.id('81e002'), pg_temp.id('81f0b1')), '42501', NULL,
  'A ne peut pas insérer au nom de B (RLS WITH CHECK)');
SELECT throws_ok(format($q$INSERT INTO refund_request (operator_id, ledger_id, event_id, wallet_id, method, msisdn,
    new_number, status, estimated_amount, fee, currency)
  VALUES (%L, %L, %L, %L, 'WAVE', '+221770000009', false, 'REQUESTED', 1, 0, 'XOF')$q$,
  pg_temp.id('81a001'), (SELECT la FROM fx), pg_temp.id('81e001'), pg_temp.id('81f0b1')), 'CL001', NULL,
  'A ne peut pas viser le portefeuille de B avec son propre operator_id (garde d''insertion)');
SELECT throws_ok(format($q$INSERT INTO refund_request (operator_id, ledger_id, event_id, wallet_id, method, msisdn,
    new_number, status, estimated_amount, fee, currency)
  VALUES (%L, %L, %L, %L, 'WAVE', '+221770000009', false, 'REQUESTED', 1, 0, 'XOF')$q$,
  pg_temp.id('81a001'), (SELECT lb FROM fx), pg_temp.id('81e001'), pg_temp.id('81f007')), 'CL001', NULL,
  'A ne peut pas viser le grand livre de B');
SELECT throws_ok(format($q$INSERT INTO refund_request (operator_id, ledger_id, event_id, wallet_id, method, msisdn,
    new_number, status, estimated_amount, fee, currency)
  VALUES (%L, %L, %L, %L, 'WAVE', '+221770000009', false, 'REQUESTED', 1, 0, 'XOF')$q$,
  pg_temp.id('81a001'), (SELECT la FROM fx), pg_temp.id('81e002'), pg_temp.id('81f007')), 'CL001', NULL,
  'A ne peut pas viser l''événement de B');
SELECT lives_ok(format($q$INSERT INTO refund_request (operator_id, ledger_id, event_id, wallet_id, customer_id, method,
    msisdn, new_number, status, estimated_amount, fee, currency)
  VALUES (%L, %L, %L, %L, %L, 'WAVE', '+221770000001', false, 'REQUESTED', 1, 0, 'XOF')$q$,
  pg_temp.id('81a001'), (SELECT la FROM fx), pg_temp.id('81e001'), pg_temp.id('81f007'), pg_temp.id('81c001')),
  'A insère une demande valide de son prestataire');
SELECT lives_ok($q$UPDATE refund_request SET status = 'REJECTED', reject_reason = 'x', updated_at = clock_timestamp()
  WHERE wallet_id = pg_temp.id('81f007')$q$, 'A met à jour des colonnes de transition');
SELECT throws_ok($q$UPDATE refund_request SET method = method$q$, '42501', NULL, 'UPDATE method refusé');
SELECT throws_ok($q$UPDATE refund_request SET msisdn = msisdn$q$, '42501', NULL, 'UPDATE msisdn refusé');
SELECT throws_ok($q$UPDATE refund_request SET wallet_id = wallet_id$q$, '42501', NULL, 'UPDATE wallet_id refusé');
SELECT throws_ok($q$UPDATE refund_request SET operator_id = operator_id$q$, '42501', NULL, 'UPDATE operator_id refusé');
SELECT throws_ok($q$UPDATE refund_request SET hold_until = hold_until$q$, '42501', NULL, 'UPDATE hold_until refusé');
SELECT throws_ok($q$DELETE FROM refund_request$q$, '42501', NULL, 'DELETE refusé');
SELECT throws_ok($q$TRUNCATE refund_request$q$, '42501', NULL, 'TRUNCATE refusé');
SELECT throws_ok($q$SELECT refund_request_scope_guard()$q$, '42501', NULL,
  'la fonction de déclencheur n''est pas appelable par cashless_app');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
