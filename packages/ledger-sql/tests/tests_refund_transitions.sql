-- Transitions des demandes de remboursement et auteur / valideur du rendu de caution (migration 0086 ;
-- mission 9b, lot WP04 ; FR-018, FR-019 ; OP-N130, OP-N128) — pgTAP, écrit à la main.
-- Famille 1 : refund_request_transition_guard (graphe, promotion, figeage après PROCESSING, identité, terminaux).
-- Famille 2 : refund_deposit / refund_deposit_for_session à quatre arguments (created_by, approved_by) et anciennes
-- signatures. Tout se joue en propriétaire : WP06 accorde les droits (post-roles.sql), pas ce lot.
-- Lancer : pg_prove -d <base> tests/tests_refund_transitions.sql (base créée par les migrations).
\set ON_ERROR_STOP 1
\set QUIET 1
BEGIN;
\ir _grants_for_tests.sql
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

CREATE FUNCTION pg_temp.id(p text) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT ('00000000-0000-0000-0000-' || lpad(p, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.a() RETURNS void LANGUAGE sql AS
  $$ SELECT set_config('app.operator_id', pg_temp.id('82a001')::text, true) $$;
CREATE FUNCTION pg_temp.b() RETURNS void LANGUAGE sql AS
  $$ SELECT set_config('app.operator_id', pg_temp.id('82a002')::text, true) $$;

-- Données (propriétaire) : prestataires A et B, un organisateur, un événement LIVE et un grand livre chacun. ------------
INSERT INTO party (kind, legal_name) SELECT 'PLATFORM', 'Plateforme (test)' WHERE NOT EXISTS (SELECT 1 FROM party WHERE kind = 'PLATFORM');
INSERT INTO party (id, kind, legal_name, country_code) VALUES
 (pg_temp.id('82a001'), 'OPERATOR', 'Prestataire A', 'SN'),
 (pg_temp.id('82a002'), 'OPERATOR', 'Prestataire B', 'SN');
INSERT INTO party (id, kind, operator_id, legal_name) VALUES
 (pg_temp.id('82b001'), 'ORGANIZER', pg_temp.id('82a001'), 'Organisateur A'),
 (pg_temp.id('82b002'), 'ORGANIZER', pg_temp.id('82a002'), 'Organisateur B'),
 (pg_temp.id('82c001'), 'CUSTOMER', pg_temp.id('82a001'), 'Festivalier A');
INSERT INTO customer_identity (customer_id, operator_id, phone)
VALUES (pg_temp.id('82c001'), pg_temp.id('82a001'), '+221770000082');
INSERT INTO jurisdiction_profile (id, country_code, version, valid_from, breakage_destination)
VALUES (pg_temp.id('82d001'), 'SN', 820082, '2026-01-01', 'ORGANIZER');
INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone, jurisdiction_id, funds_holder, status) VALUES
 (pg_temp.id('82e001'), pg_temp.id('82a001'), pg_temp.id('82b001'), 'Événement A', 'XOF', 'Africa/Dakar',
  pg_temp.id('82d001'), 'ORGANIZER', 'LIVE'),
 (pg_temp.id('82e002'), pg_temp.id('82a002'), pg_temp.id('82b002'), 'Événement B', 'XOF', 'Africa/Dakar',
  pg_temp.id('82d001'), 'ORGANIZER', 'LIVE');
SELECT pg_temp.a();
SELECT open_event_ledger(pg_temp.id('82e001'));
SELECT pg_temp.b();
SELECT open_event_ledger(pg_temp.id('82e002'));
CREATE TEMP TABLE fx AS
SELECT (SELECT id FROM ledger WHERE scope_id = pg_temp.id('82e001')) AS la,
       (SELECT id FROM ledger WHERE scope_id = pg_temp.id('82e002')) AS lb;
-- Portefeuilles : 150 pour les demandes (un par fixture), 6 pour les bracelets de A, 1 pour un bracelet de B.
INSERT INTO wallet (id, operator_id, ledger_id)
SELECT pg_temp.id('82f' || lpad(n::text, 3, '0')), pg_temp.id('82a001'), (SELECT la FROM fx)
  FROM generate_series(1, 150) n;
INSERT INTO wallet (id, operator_id, ledger_id)
SELECT pg_temp.id('82f9' || lpad(n::text, 2, '0')), pg_temp.id('82a001'), (SELECT la FROM fx)
  FROM generate_series(1, 6) n;
INSERT INTO wallet (id, operator_id, ledger_id)
VALUES (pg_temp.id('82f9b1'), pg_temp.id('82a002'), (SELECT lb FROM fx));
INSERT INTO journal_transaction (id, operator_id, ledger_id, event_id, type, idempotency_key, request_hash, occurred_at,
                                 source, created_by, approved_by)
VALUES (pg_temp.id('82aa01'), pg_temp.id('82a001'), (SELECT la FROM fx), pg_temp.id('82e001'), 'WALLET_REFUND', 'bo:r1',
        'h', now(), 'BACKOFFICE', pg_temp.id('82aaa1'), pg_temp.id('82aaa2'));
INSERT INTO journal_transaction (id, operator_id, ledger_id, event_id, type, idempotency_key, request_hash, occurred_at,
                                 source, reverses_id)
VALUES (pg_temp.id('82aa02'), pg_temp.id('82a001'), (SELECT la FROM fx), pg_temp.id('82e001'), 'REVERSAL', 'bo:r2',
        'h', now(), 'ONLINE', pg_temp.id('82aa01'));
INSERT INTO approval_request (id, operator_id, action, target_id, payload, requested_by)
VALUES (pg_temp.id('82ab01'), pg_temp.id('82a001'), 'WALLET_REFUND', pg_temp.id('82f001'), '{}', pg_temp.id('82aaa1'));

CREATE SEQUENCE pg_temp.ws;
-- Demande valide de A dans l'état p_status sur un portefeuille neuf ; surcharges jsonb ; rend l'id.
CREATE FUNCTION pg_temp.mk(p_status text, p_extra jsonb DEFAULT '{}') RETURNS uuid
LANGUAGE sql AS $$
  INSERT INTO refund_request
  SELECT * FROM jsonb_populate_record(null::refund_request, jsonb_build_object(
    'id', gen_random_uuid(), 'operator_id', pg_temp.id('82a001'), 'ledger_id', (SELECT la FROM fx),
    'event_id', pg_temp.id('82e001'),
    'wallet_id', pg_temp.id('82f' || lpad(nextval('pg_temp.ws')::text, 3, '0')),
    'customer_id', pg_temp.id('82c001'), 'requested_by', pg_temp.id('82aaa1'), 'method', 'WAVE',
    'msisdn', '+221770000082', 'new_number', false, 'status', p_status,
    'estimated_amount', 1000, 'fee', 10, 'currency', 'XOF', 'extra_check_required', false,
    'created_at', clock_timestamp(), 'updated_at', clock_timestamp())
    || CASE p_status
         WHEN 'AWAITING_HOLDER' THEN jsonb_build_object('hold_until', clock_timestamp() + interval '1 day')
         WHEN 'BLOCKED' THEN jsonb_build_object('holder_decision', 'BLOCK', 'holder_decided_at', clock_timestamp())
         WHEN 'REJECTED' THEN jsonb_build_object('reject_reason', 'Hors délai')
         WHEN 'PROCESSING' THEN jsonb_build_object('transaction_id', pg_temp.id('82aa01'),
                                                   'approved_by', pg_temp.id('82aaa2'))
         WHEN 'PAID' THEN jsonb_build_object('transaction_id', pg_temp.id('82aa01'),
                                             'approved_by', pg_temp.id('82aaa2'), 'external_reference', 'WAVE-1')
         WHEN 'FAILED' THEN jsonb_build_object('transaction_id', pg_temp.id('82aa01'),
                                               'approved_by', pg_temp.id('82aaa2'), 'failure_reason', 'Compte fermé',
                                               'reversal_transaction_id', pg_temp.id('82aa02'))
         ELSE '{}'::jsonb END
    || p_extra)
  RETURNING id
$$;
CREATE FUNCTION pg_temp.st(p uuid) RETURNS text LANGUAGE sql AS $$ SELECT status FROM refund_request WHERE id = p $$;

-- ===== Famille 1 : déclencheur de transitions ==============================================================================
SELECT has_trigger('refund_request', 'refund_request_transition_guard', 'déclencheur refund_request_transition_guard présent');
SELECT has_function('refund_request_transition_guard', 'fonction refund_request_transition_guard présente');

-- 1. Les 6 transitions autorisées passent (une assertion nommée par paire).
SELECT lives_ok(format($q$UPDATE refund_request SET status='REQUESTED', holder_decision='CONFIRM',
    holder_decided_at=clock_timestamp(), updated_at=clock_timestamp() WHERE id=%L$q$, pg_temp.mk('AWAITING_HOLDER')),
  'AWAITING_HOLDER -> REQUESTED (décision CONFIRM) : autorisée');
SELECT lives_ok(format($q$UPDATE refund_request SET status='REQUESTED', updated_at=clock_timestamp() WHERE id=%L$q$,
    pg_temp.mk('AWAITING_HOLDER', jsonb_build_object('hold_until', clock_timestamp() - interval '1 minute'))),
  'AWAITING_HOLDER -> REQUESTED (promotion à l''échéance) : autorisée');
SELECT lives_ok(format($q$UPDATE refund_request SET status='BLOCKED', holder_decision='BLOCK',
    holder_decided_at=clock_timestamp(), updated_at=clock_timestamp() WHERE id=%L$q$, pg_temp.mk('AWAITING_HOLDER')),
  'AWAITING_HOLDER -> BLOCKED (décision BLOCK) : autorisée');
SELECT lives_ok(format($q$UPDATE refund_request SET status='PROCESSING', transaction_id=%L, approved_by=%L,
    approval_request_id=%L, estimated_amount=1500, fee=15, updated_at=clock_timestamp() WHERE id=%L$q$,
    pg_temp.id('82aa01'), pg_temp.id('82aaa2'), pg_temp.id('82ab01'), pg_temp.mk('REQUESTED')),
  'REQUESTED -> PROCESSING avec montant et frais recalculés : autorisée');
SELECT lives_ok(format($q$UPDATE refund_request SET status='REJECTED', reject_reason='Refus', updated_at=clock_timestamp()
    WHERE id=%L$q$, pg_temp.mk('REQUESTED')), 'REQUESTED -> REJECTED : autorisée');
SELECT lives_ok(format($q$UPDATE refund_request SET status='PAID', external_reference='WAVE-9', confirmed_by=%L,
    confirmed_at=clock_timestamp(), updated_at=clock_timestamp() WHERE id=%L$q$, pg_temp.id('82aaa2'),
    pg_temp.mk('PROCESSING')), 'PROCESSING -> PAID : autorisée');
SELECT lives_ok(format($q$UPDATE refund_request SET status='FAILED', failure_reason='Compte fermé', reversal_transaction_id=%L,
    confirmed_by=%L, confirmed_at=clock_timestamp(), updated_at=clock_timestamp() WHERE id=%L$q$, pg_temp.id('82aa02'),
    pg_temp.id('82aaa2'), pg_temp.mk('PROCESSING')), 'PROCESSING -> FAILED : autorisée');

-- 2. Toutes les autres paires parmi les 8 statuts : refusées (CL029), une assertion nommée par paire (50).
SELECT throws_ok(format($q$UPDATE refund_request SET status=%L WHERE id=%L$q$, t.s, pg_temp.mk(f.s)), 'CL029', NULL,
  f.s || ' -> ' || t.s || ' : refusée')
  FROM unnest(ARRAY['AWAITING_HOLDER','REQUESTED','PROCESSING','PAID','FAILED','REJECTED','CANCELLED','BLOCKED']) AS f(s)
  CROSS JOIN unnest(ARRAY['AWAITING_HOLDER','REQUESTED','PROCESSING','PAID','FAILED','REJECTED','CANCELLED','BLOCKED']) AS t(s)
 WHERE f.s <> t.s
   AND (f.s, t.s) NOT IN (('AWAITING_HOLDER','REQUESTED'), ('AWAITING_HOLDER','BLOCKED'), ('REQUESTED','PROCESSING'),
                          ('REQUESTED','REJECTED'), ('PROCESSING','PAID'), ('PROCESSING','FAILED'))
 ORDER BY f.s, t.s;
SELECT is((SELECT count(*)::int FROM refund_request WHERE status = 'CANCELLED'), 7,
  'sept demandes CANCELLED (fixtures) : aucune n''a quitté son état');

-- 3. Promotion : décision, échéance (FR-018).
SELECT throws_ok(format($q$UPDATE refund_request SET status='REQUESTED' WHERE id=%L$q$, pg_temp.mk('AWAITING_HOLDER')),
  'CL029', NULL, 'promotion avant l''échéance sans décision : refusée');
SELECT throws_ok(format($q$UPDATE refund_request SET status='REQUESTED', holder_decision='BLOCK',
    holder_decided_at=clock_timestamp() WHERE id=%L$q$, pg_temp.mk('AWAITING_HOLDER')),
  'CL029', NULL, 'AWAITING_HOLDER -> REQUESTED avec décision BLOCK : refusée');
SELECT lives_ok(format($q$UPDATE refund_request SET status='REQUESTED', holder_decision='CONFIRM',
    holder_decided_at=clock_timestamp() WHERE id=%L$q$,
    pg_temp.mk('AWAITING_HOLDER', jsonb_build_object('hold_until', clock_timestamp() - interval '1 hour'))),
  'décision CONFIRM après l''échéance (avant promotion) : acceptée, la demande devient REQUESTED');
CREATE TEMP TABLE past AS
SELECT pg_temp.mk('AWAITING_HOLDER', jsonb_build_object('hold_until', clock_timestamp() - interval '1 minute')) AS id;
SELECT is(promote_due_refund_requests(), 1, 'promote_due_refund_requests : une demande échue promue (les autres ne le sont pas)');
SELECT is(pg_temp.st((SELECT id FROM past)), 'REQUESTED', 'la demande échue est passée à REQUESTED');
SELECT is(promote_due_refund_requests(), 0, 'promote_due_refund_requests : second appel, 0');
SELECT is(pg_temp.st(pg_temp.mk('AWAITING_HOLDER')), 'AWAITING_HOLDER', 'demande dont l''échéance n''est pas atteinte : intacte');
CREATE TEMP TABLE due AS
SELECT pg_temp.mk('AWAITING_HOLDER', jsonb_build_object('hold_until', clock_timestamp() + interval '2 seconds')) AS id;
SELECT pg_sleep(2.2);
SELECT is(promote_due_refund_requests(), 1, 'promotion juste après l''échéance : 1');
SELECT is(pg_temp.st((SELECT id FROM due)), 'REQUESTED', 'la demande échue est REQUESTED');
SELECT is((SELECT holder_decision FROM refund_request WHERE id = (SELECT id FROM due)), NULL,
  'une échéance n''est pas une décision : holder_decision reste nul');
SELECT is(promote_due_refund_requests(), 0, 'promotion : idempotente');
SELECT throws_ok(format($q$UPDATE refund_request SET status='REQUESTED', holder_decision='CONFIRM',
    holder_decided_at=clock_timestamp() WHERE id=%L$q$, pg_temp.mk('BLOCKED')),
  'CL029', NULL, 'décision CONFIRM sur une demande déjà BLOCKED : refusée');
SELECT throws_ok(format($q$UPDATE refund_request SET status='REQUESTED', holder_decision='CONFIRM',
    holder_decided_at=clock_timestamp() WHERE id=%L$q$, pg_temp.mk('PROCESSING')),
  'CL029', NULL, 'décision CONFIRM sur une demande PROCESSING : refusée');

-- 4. Montant et frais : figés hors du passage REQUESTED -> PROCESSING.
SELECT throws_ok(format($q$UPDATE refund_request SET estimated_amount=1 WHERE id=%L$q$, pg_temp.mk('PROCESSING')),
  'CL029', NULL, 'montant changé sur PROCESSING (sans changement de statut) : refusé');
SELECT throws_ok(format($q$UPDATE refund_request SET fee=1 WHERE id=%L$q$, pg_temp.mk('PROCESSING')),
  'CL029', NULL, 'frais changés sur PROCESSING (sans changement de statut) : refusés');
SELECT throws_ok(format($q$UPDATE refund_request SET status='PAID', external_reference='W', estimated_amount=999
    WHERE id=%L$q$, pg_temp.mk('PROCESSING')), 'CL029', NULL, 'montant changé au passage PROCESSING -> PAID : refusé');
SELECT throws_ok(format($q$UPDATE refund_request SET status='FAILED', failure_reason='x', reversal_transaction_id=%L, fee=99
    WHERE id=%L$q$, pg_temp.id('82aa02'), pg_temp.mk('PROCESSING')), 'CL029', NULL,
  'frais changés au passage PROCESSING -> FAILED : refusés');
SELECT throws_ok(format($q$UPDATE refund_request SET status='REJECTED', reject_reason='x', estimated_amount=1
    WHERE id=%L$q$, pg_temp.mk('REQUESTED')), 'CL029', NULL, 'montant changé au passage REQUESTED -> REJECTED : refusé');
SELECT throws_ok(format($q$UPDATE refund_request SET estimated_amount=1 WHERE id=%L$q$, pg_temp.mk('REQUESTED')),
  'CL029', NULL, 'montant changé sur REQUESTED sans changement de statut : refusé');
SELECT throws_ok(format($q$UPDATE refund_request SET status='REQUESTED', holder_decision='CONFIRM',
    holder_decided_at=clock_timestamp(), fee=1 WHERE id=%L$q$, pg_temp.mk('AWAITING_HOLDER')),
  'CL029', NULL, 'frais changés au passage AWAITING_HOLDER -> REQUESTED : refusés');
SELECT is((SELECT (estimated_amount, fee)::text FROM refund_request WHERE status = 'PROCESSING'
            AND approval_request_id IS NOT NULL), '(1500,15)', 'le recalcul à PROCESSING est bien inscrit');

-- 5. Colonnes d'identité immuables (à tout UPDATE, y compris avec changement de statut).
SELECT throws_ok(format($q$UPDATE refund_request SET %I = %s WHERE id=%L$q$, c.col, c.val, pg_temp.mk('REQUESTED')),
  'CL029', NULL, 'colonne immuable ' || c.col || ' : refusée')
  FROM (VALUES ('id','gen_random_uuid()'), ('operator_id','gen_random_uuid()'), ('ledger_id','gen_random_uuid()'),
               ('event_id','gen_random_uuid()'), ('wallet_id','gen_random_uuid()'), ('customer_id','gen_random_uuid()'),
               ('requested_by','gen_random_uuid()'), ('method','''BANK_TRANSFER'''), ('msisdn','''+221770000099'''),
               ('iban','''SN08X'''), ('new_number','true'), ('currency','''EUR'''),
               ('hold_until','now()'), ('extra_check_required','true'),
               ('created_at','now() + interval ''1 day''')) AS c(col, val);
SELECT throws_ok(format($q$UPDATE refund_request SET status='REJECTED', reject_reason='x', wallet_id=gen_random_uuid()
    WHERE id=%L$q$, pg_temp.mk('REQUESTED')), 'CL029', NULL, 'wallet_id changé avec une transition permise : refusé');
SELECT throws_ok(format($q$UPDATE refund_request SET status='REJECTED', reject_reason='x', iban='SN08X', requested_by=NULL
    WHERE id=%L$q$, pg_temp.mk('REQUESTED')), 'CL029', NULL, 'iban et requested_by changés avec une transition permise : refusés');

-- 6. Sans changement de statut : seuls approval_request_id et updated_at.
SELECT lives_ok(format($q$UPDATE refund_request SET approval_request_id=%L, updated_at=clock_timestamp() WHERE id=%L$q$,
    pg_temp.id('82ab01'), pg_temp.mk('REQUESTED')), 'approval_request_id posé sur REQUESTED : accepté');
SELECT throws_ok(format($q$UPDATE refund_request SET holder_decision='CONFIRM', holder_decided_at=now() WHERE id=%L$q$,
    pg_temp.mk('AWAITING_HOLDER')), 'CL029', NULL, 'décision posée sans changement de statut : refusée');
SELECT throws_ok(format($q$UPDATE refund_request SET approved_by=%L WHERE id=%L$q$, pg_temp.id('82aaa1'),
    pg_temp.mk('PROCESSING')), 'CL029', NULL, 'approved_by changé sur PROCESSING : refusé');
SELECT throws_ok(format($q$UPDATE refund_request SET external_reference='AUTRE' WHERE id=%L$q$, pg_temp.mk('PAID')),
  'CL029', NULL, 'référence externe changée sur PAID : refusée');
SELECT lives_ok(format($q$UPDATE refund_request SET status = status, fee = fee WHERE id=%L$q$, pg_temp.mk('REQUESTED')),
  'écriture identique sur REQUESTED : sans levée');
SELECT lives_ok(format($q$UPDATE refund_request SET status = status WHERE id=%L$q$, pg_temp.mk('PAID')),
  'écriture identique sur PAID : sans levée');

-- 7. Un état terminal ne change plus du tout.
SELECT throws_ok(format($q$UPDATE refund_request SET updated_at = clock_timestamp() + interval '1 hour' WHERE id=%L$q$,
    pg_temp.mk(s.s)), 'CL029', NULL, 'état terminal ' || s.s || ' : updated_at lui-même ne change plus')
  FROM unnest(ARRAY['PAID','FAILED','REJECTED','BLOCKED','CANCELLED']) AS s(s);
SELECT throws_ok(format($q$UPDATE refund_request SET approval_request_id=%L WHERE id=%L$q$, pg_temp.id('82ab01'),
    pg_temp.mk(s.s)), 'CL029', NULL, 'état terminal ' || s.s || ' : approval_request_id ne change plus')
  FROM unnest(ARRAY['PAID','FAILED','REJECTED','BLOCKED','CANCELLED']) AS s(s);

-- 8. Les cinq UPDATE du code TypeScript de la 9a passent (formes exactes).
SELECT lives_ok(format($q$UPDATE refund_request r SET status = 'REJECTED', reject_reason = 'Hors délai',
    updated_at = clock_timestamp() WHERE r.id = %L AND r.status = 'REQUESTED'$q$, pg_temp.mk('REQUESTED')),
  'refund-requests.service : REQUESTED -> REJECTED');
SELECT lives_ok(format($q$UPDATE refund_request r SET status = 'PAID', external_reference = 'W1', confirmed_by = %L,
    confirmed_at = clock_timestamp(), updated_at = clock_timestamp() WHERE r.id = %L AND r.status = 'PROCESSING'$q$,
    pg_temp.id('82aaa2'), pg_temp.mk('PROCESSING')), 'refund-confirm.service : PROCESSING -> PAID');
SELECT lives_ok(format($q$UPDATE refund_request r SET status = 'FAILED', failure_reason = 'x',
    reversal_transaction_id = %L, confirmed_by = %L, confirmed_at = clock_timestamp(), updated_at = clock_timestamp()
    WHERE r.id = %L AND r.status = 'PROCESSING'$q$, pg_temp.id('82aa02'), pg_temp.id('82aaa2'),
    pg_temp.mk('PROCESSING')), 'refund-confirm.service : PROCESSING -> FAILED');
SELECT lives_ok(format($q$UPDATE refund_request SET status = CASE 'CONFIRM' WHEN 'CONFIRM' THEN 'REQUESTED' ELSE 'BLOCKED' END,
    holder_decision = 'CONFIRM', holder_decided_at = clock_timestamp(), updated_at = clock_timestamp()
    WHERE id = %L AND status = 'AWAITING_HOLDER' AND hold_until > clock_timestamp()$q$, pg_temp.mk('AWAITING_HOLDER')),
  'holder-challenge.service : décision CONFIRM');
SELECT lives_ok(format($q$UPDATE refund_request SET status = CASE 'BLOCK' WHEN 'CONFIRM' THEN 'REQUESTED' ELSE 'BLOCKED' END,
    holder_decision = 'BLOCK', holder_decided_at = clock_timestamp(), updated_at = clock_timestamp()
    WHERE id = %L AND status = 'AWAITING_HOLDER' AND hold_until > clock_timestamp()$q$, pg_temp.mk('AWAITING_HOLDER')),
  'holder-challenge.service : décision BLOCK');
SELECT lives_ok(format($q$UPDATE refund_request SET approval_request_id = %L, updated_at = clock_timestamp()
    WHERE id = %L$q$, pg_temp.id('82ab01'), pg_temp.mk('REQUESTED')), 'wallet-refund-action : lien d''approbation');
SELECT lives_ok(format($q$UPDATE refund_request r SET status = 'PROCESSING', transaction_id = %L, approved_by = %L,
    approval_request_id = %L, estimated_amount = 1200, fee = 12, updated_at = clock_timestamp()
    WHERE r.id = %L AND r.status = 'REQUESTED'$q$, pg_temp.id('82aa01'), pg_temp.id('82aaa2'), pg_temp.id('82ab01'),
    pg_temp.mk('REQUESTED')), 'wallet-refund-action : REQUESTED -> PROCESSING avec recalcul');

-- 9. La fonction de déclencheur : droits et réglage.
SELECT is((SELECT has_function_privilege('public', 'refund_request_transition_guard()', 'EXECUTE')), false,
  'refund_request_transition_guard : EXECUTE retiré à PUBLIC');
SELECT is((SELECT proconfig FROM pg_proc WHERE proname = 'refund_request_transition_guard'),
  ARRAY['search_path=public, pg_temp'], 'refund_request_transition_guard : search_path fixé');

-- ===== Famille 2 : auteur et valideur du rendu de caution (OP-N128) =======================================================
-- Caisse de A : terminal, personne CASHIER, session ouverte ; bracelets à caution payée à part (3000).
INSERT INTO app_user (id, operator_id, issuer, subject, email, display_name) VALUES
 (pg_temp.id('82e0a1'), pg_temp.id('82a001'), 'https://idp.test', 's0082a1', 'a1@test', 'Guichetière'),
 (pg_temp.id('82e0a2'), pg_temp.id('82a001'), 'https://idp.test', 's0082a2', 'a2@test', 'Superviseur');
INSERT INTO role_assignment (user_id, role, scope_type, scope_id, granted_by)
VALUES (pg_temp.id('82e0a1'), 'CASHIER', 'EVENT', pg_temp.id('82e001'), NULL);
INSERT INTO device (id, operator_id, kind, app_mode, event_id, serial)
VALUES (pg_temp.id('82ad01'), pg_temp.id('82a001'), 'TOPUP', 'TOPUP_DESK', pg_temp.id('82e001'), 'C82-AD01');
INSERT INTO tag_key (operator_id, key_index, kms_key_ref, status)
VALUES (pg_temp.id('82a001'), 1, 'test:hmac-82', 'ACTIVE'), (pg_temp.id('82a002'), 1, 'test:hmac-82b', 'ACTIVE');
INSERT INTO media_batch (id, operator_id, organizer_id, kind, quantity, key_index, deposit_amount, deposit_mode)
VALUES (pg_temp.id('82ac01'), pg_temp.id('82a001'), pg_temp.id('82b001'), 'PUBLIC', 10, 1, 3000, 'SEPARATE'),
       (pg_temp.id('82ac02'), pg_temp.id('82a001'), pg_temp.id('82b001'), 'PUBLIC', 10, 1, 0, NULL);
INSERT INTO media (id, operator_id, kind, token_hash, nfc_uid, batch_id, key_index, wallet_id)
SELECT pg_temp.id('82ae0' || n), pg_temp.id('82a001'), 'NFC_TAG', sha256(convert_to('m82-' || n, 'UTF8')),
       ('\x0482000000000' || n)::text::bytea, pg_temp.id('82ac01'), 1, pg_temp.id('82f90' || n)
  FROM generate_series(1, 5) n;
INSERT INTO media (id, operator_id, kind, token_hash, nfc_uid, batch_id, key_index, wallet_id)
VALUES (pg_temp.id('82ae06'), pg_temp.id('82a001'), 'NFC_TAG', sha256('m82-6'), '\x04820000000006',
        pg_temp.id('82ac02'), 1, pg_temp.id('82f906'));
SELECT pg_temp.a();
CREATE TEMP TABLE sess AS
SELECT cash_session_id AS id, cash_account_id AS acc FROM open_cash_session(pg_temp.id('82ad01'), pg_temp.id('82e0a1'));
CREATE FUNCTION pg_temp.take(n int) RETURNS text LANGUAGE sql AS
  $$ SELECT take_deposit_for_session(pg_temp.id('82ae0' || n), (SELECT id FROM sess)) $$;
CREATE FUNCTION pg_temp.dr(n int) RETURNS TABLE (created_by uuid, approved_by uuid, source text, c int) LANGUAGE sql AS
  $$ SELECT t.created_by, t.approved_by, t.source, count(*) OVER ()::int FROM journal_transaction t
      WHERE t.type = 'DEPOSIT_REFUNDED' AND t.idempotency_key LIKE 'deposit-refund:' || pg_temp.id('82ae0' || n) || ':%' $$;
SELECT is(pg_temp.take(1), 'HELD', 'bracelet 1 : caution prise sur la caisse');
SELECT is(pg_temp.take(2), 'HELD', 'bracelet 2 : caution prise');
SELECT is(pg_temp.take(3), 'HELD', 'bracelet 3 : caution prise');
SELECT is(pg_temp.take(4), 'HELD', 'bracelet 4 : caution prise');
SELECT is(pg_temp.take(5), 'HELD', 'bracelet 5 : caution prise');

SELECT has_function('refund_deposit', ARRAY['uuid', 'uuid', 'uuid', 'uuid'], 'refund_deposit à quatre arguments présente');
SELECT has_function('refund_deposit', ARRAY['uuid', 'uuid'], 'refund_deposit à deux arguments conservée');
SELECT has_function('refund_deposit_for_session', ARRAY['uuid', 'uuid', 'uuid', 'uuid'],
  'refund_deposit_for_session à quatre arguments présente');
-- Mission durcissements-serveur (WP02, 0092) : la surcharge à deux arguments est retirée ; refund_deposit(uuid, uuid)
-- reste en base, interne (sa non-exécution par cashless_app est prouvée plus bas et par WP03).
SELECT hasnt_function('refund_deposit_for_session', ARRAY['uuid', 'uuid'],
  'refund_deposit_for_session à deux arguments retirée');
SELECT ok(NOT has_function_privilege('cashless_app', 'refund_deposit(uuid, uuid)', 'EXECUTE')
          AND NOT has_function_privilege('public', 'refund_deposit(uuid, uuid)', 'EXECUTE'),
  'refund_deposit(uuid, uuid) existe, interne : ni cashless_app ni PUBLIC ne l''exécutent');
SELECT is((SELECT count(*)::int FROM pg_proc p
            WHERE p.proname IN ('refund_deposit', 'refund_deposit_for_session') AND p.prosecdef
              AND NOT has_function_privilege('public', p.oid, 'EXECUTE')
              AND coalesce(p.proconfig, '{}') @> ARRAY['search_path=public, pg_temp']), 3,
  -- trois depuis 0092 : refund_deposit (2 et 4 arguments) et refund_deposit_for_session (4 arguments)
  'les trois signatures : DEFINER, search_path = public, pg_temp, EXECUTE retiré à PUBLIC');

-- Quatre arguments : created_by et approved_by portés par DEPOSIT_REFUNDED, source ONLINE.
SELECT lives_ok(format($q$SELECT refund_deposit_for_session(%L, %L, %L, %L)$q$, pg_temp.id('82ae01'),
    (SELECT id FROM sess), pg_temp.id('82e0a1'), pg_temp.id('82e0a2')), 'refund_deposit_for_session à quatre arguments : rendu');
SELECT is((SELECT created_by FROM pg_temp.dr(1)), pg_temp.id('82e0a1'), 'DEPOSIT_REFUNDED porte created_by');
SELECT is((SELECT approved_by FROM pg_temp.dr(1)), pg_temp.id('82e0a2'), 'DEPOSIT_REFUNDED porte approved_by');
SELECT is((SELECT source FROM pg_temp.dr(1)), 'ONLINE', 'DEPOSIT_REFUNDED garde la source ONLINE');
SELECT is((SELECT idempotency_key FROM journal_transaction WHERE type = 'DEPOSIT_REFUNDED'
            AND idempotency_key LIKE 'deposit-refund:' || pg_temp.id('82ae01') || ':%'),
  'deposit-refund:' || pg_temp.id('82ae01') || ':1', 'clé d''idempotence inchangée');
SELECT is((SELECT count(*)::int FROM cash_session_tx x JOIN journal_transaction t ON t.id = x.tx_id
            WHERE x.cash_session_id = (SELECT id FROM sess) AND t.type = 'DEPOSIT_REFUNDED'
              AND t.idempotency_key LIKE 'deposit-refund:' || pg_temp.id('82ae01') || ':%'), 1,
  'rendu rattaché à la session de caisse');
SELECT lives_ok(format($q$SELECT refund_deposit_for_session(%L, %L, %L, %L)$q$, pg_temp.id('82ae01'),
    (SELECT id FROM sess), pg_temp.id('82e0a1'), pg_temp.id('82e0a2')), 'rejeu : sans effet (caution déjà rendue)');
SELECT is((SELECT c FROM pg_temp.dr(1) LIMIT 1), 1, 'rejeu : une seule transaction DEPOSIT_REFUNDED');

-- Auteur et valideur nuls : comportement d'avant (ancienne forme à deux arguments, retirée en 0092).
SELECT lives_ok(format($q$SELECT refund_deposit_for_session(%L, %L, NULL, NULL)$q$, pg_temp.id('82ae02'),
  (SELECT id FROM sess)), 'refund_deposit_for_session à quatre arguments (NULL, NULL) : rendu');
SELECT is((SELECT created_by FROM pg_temp.dr(2)), NULL, 'deux arguments : created_by nul');
SELECT is((SELECT approved_by FROM pg_temp.dr(2)), NULL, 'deux arguments : approved_by nul');
SELECT is((SELECT deposit_status FROM media WHERE id = pg_temp.id('82ae02')), 'REFUNDED', 'deux arguments : caution REFUNDED');
SELECT is((SELECT deposit_status FROM media WHERE id = pg_temp.id('82ae01')), 'REFUNDED', 'quatre arguments : caution REFUNDED');

-- Garde auteur / valideur (CL001) : aucune écriture n'est faite.
SELECT throws_ok(format($q$SELECT refund_deposit_for_session(%L, %L, %L, %L)$q$, pg_temp.id('82ae03'),
    (SELECT id FROM sess), pg_temp.id('82e0a1'), pg_temp.id('82e0a1')), 'CL001', NULL, 'auteur égal au valideur : refusé');
SELECT throws_ok(format($q$SELECT refund_deposit_for_session(%L, %L, NULL, %L)$q$, pg_temp.id('82ae03'),
    (SELECT id FROM sess), pg_temp.id('82e0a2')), 'CL001', NULL, 'valideur sans auteur : refusé');
SELECT is((SELECT deposit_status FROM media WHERE id = pg_temp.id('82ae03')), 'HELD', 'refus : la caution reste HELD');
SELECT is((SELECT count(*)::int FROM pg_temp.dr(3)), 0, 'refus : aucune transaction DEPOSIT_REFUNDED');
SELECT lives_ok(format($q$SELECT refund_deposit_for_session(%L, %L, %L, NULL)$q$, pg_temp.id('82ae03'),
    (SELECT id FROM sess), pg_temp.id('82e0a1')), 'auteur seul (sans valideur) : accepté');
SELECT is((SELECT created_by FROM pg_temp.dr(3)), pg_temp.id('82e0a1'), 'auteur seul : created_by porté');
SELECT is((SELECT approved_by FROM pg_temp.dr(3)), NULL, 'auteur seul : approved_by nul');

-- refund_deposit à deux et quatre arguments se comportent pareil (compte d'argent explicite, mode SEPARATE).
SELECT lives_ok(format($q$SELECT refund_deposit(%L, %L)$q$, pg_temp.id('82ae04'), (SELECT acc FROM sess)),
  'refund_deposit à deux arguments : rendu');
SELECT is((SELECT created_by FROM pg_temp.dr(4)), NULL, 'refund_deposit à deux arguments : created_by nul');
SELECT is((SELECT approved_by FROM pg_temp.dr(4)), NULL, 'refund_deposit à deux arguments : approved_by nul');
SELECT lives_ok(format($q$SELECT refund_deposit(%L, %L, NULL, NULL)$q$, pg_temp.id('82ae05'), (SELECT acc FROM sess)),
  'refund_deposit(a, b, NULL, NULL) : rendu');
SELECT is((SELECT (created_by, approved_by)::text FROM pg_temp.dr(5)), (SELECT (created_by, approved_by)::text FROM pg_temp.dr(4)),
  'refund_deposit à deux et à quatre arguments (NULL, NULL) : même écriture');
SELECT is((SELECT deposit_held FROM media WHERE id = pg_temp.id('82ae05')), 0::bigint, 'refund_deposit : deposit_held remis à 0');
SELECT is((SELECT count(*)::int FROM posting p JOIN journal_transaction t ON t.id = p.transaction_id
            WHERE t.type = 'DEPOSIT_REFUNDED' AND t.idempotency_key LIKE 'deposit-refund:' || pg_temp.id('82ae05') || ':%'
              AND p.account_id = (SELECT acc FROM sess) AND p.amount = -3000), 1,
  'refund_deposit : la caution est rendue sur le compte donné');
SELECT throws_ok(format($q$SELECT refund_deposit(%L, NULL, %L, %L)$q$, pg_temp.id('82ae05'), pg_temp.id('82e0a1'),
    pg_temp.id('82e0a1')), 'CL001', NULL, 'refund_deposit à quatre arguments : auteur égal au valideur refusé');
SELECT lives_ok(format($q$SELECT refund_deposit(%L, NULL)$q$, pg_temp.id('82ae05')),
  'refund_deposit(media, NULL) : appel non ambigu (rejeu sans effet)');

-- Bracelet sans caution : retour sans écriture.
SELECT lives_ok(format($q$SELECT refund_deposit_for_session(%L, %L, %L, %L)$q$, pg_temp.id('82ae06'),
    (SELECT id FROM sess), pg_temp.id('82e0a1'), pg_temp.id('82e0a2')), 'bracelet sans caution (NONE) : retour sans écriture');
SELECT is((SELECT count(*)::int FROM pg_temp.dr(6)), 0, 'bracelet sans caution : aucune transaction');

-- Isolation entre prestataires et prestataire absent.
SELECT pg_temp.b();
SELECT throws_ok(format($q$SELECT refund_deposit_for_session(%L, %L, %L, %L)$q$, pg_temp.id('82ae03'),
    (SELECT id FROM sess), pg_temp.id('82e0a1'), pg_temp.id('82e0a2')), 'P0002', NULL,
  'B : refund_deposit_for_session à quatre arguments sur un bracelet de A : P0002');
SELECT throws_ok(format($q$SELECT refund_deposit_for_session(%L, %L, NULL, NULL)$q$, pg_temp.id('82ae03'),
  (SELECT id FROM sess)), 'P0002', NULL, 'B : refund_deposit_for_session (NULL, NULL) sur un bracelet de A : P0002');
SELECT throws_ok(format($q$SELECT refund_deposit(%L, NULL, %L, %L)$q$, pg_temp.id('82ae03'), pg_temp.id('82e0a1'),
    pg_temp.id('82e0a2')), 'P0002', NULL, 'B : refund_deposit à quatre arguments : P0002');
SELECT throws_ok(format($q$SELECT refund_deposit(%L, NULL)$q$, pg_temp.id('82ae03')), 'P0002', NULL,
  'B : refund_deposit à deux arguments : P0002');
SELECT set_config('app.operator_id', '', true);
SELECT throws_ok(format($q$SELECT refund_deposit_for_session(%L, %L, %L, %L)$q$, pg_temp.id('82ae03'),
    (SELECT id FROM sess), pg_temp.id('82e0a1'), pg_temp.id('82e0a2')), 'P0002', NULL,
  'sans prestataire : refund_deposit_for_session à quatre arguments : P0002');
SELECT pg_temp.a();

SELECT * FROM finish();
ROLLBACK;
