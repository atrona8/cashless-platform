-- IBAN toujours sous enveloppe (migration 0093 ; mission durcissements-serveur, lot WP02 ; FR-012) — pgTAP.
-- Lancer depuis packages/ledger-sql : pg_prove -d <base> tests/tests_iban_sealed.sql
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
INSERT INTO party (id, kind, legal_name, country_code) VALUES (pg_temp.id('93a001'), 'OPERATOR', 'Prestataire A', 'SN');
INSERT INTO party (id, kind, operator_id, legal_name) VALUES
 (pg_temp.id('93b001'), 'ORGANIZER', pg_temp.id('93a001'), 'Organisateur A'),
 (pg_temp.id('93c001'), 'CUSTOMER', pg_temp.id('93a001'), 'Festivalier A');
INSERT INTO customer_identity (customer_id, operator_id, phone) VALUES
 (pg_temp.id('93c001'), pg_temp.id('93a001'), '+221770000093');
INSERT INTO jurisdiction_profile (id, country_code, version, valid_from, breakage_destination)
VALUES (pg_temp.id('93d001'), 'SN', 930093, '2026-01-01', 'ORGANIZER');
INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone, jurisdiction_id, funds_holder) VALUES
 (pg_temp.id('93e001'), pg_temp.id('93a001'), pg_temp.id('93b001'), 'Événement A', 'XOF', 'Africa/Dakar',
  pg_temp.id('93d001'), 'ORGANIZER');
SELECT set_config('app.operator_id', pg_temp.id('93a001')::text, true);
SELECT open_event_ledger(pg_temp.id('93e001'));
CREATE TEMP TABLE fx AS SELECT (SELECT id FROM ledger WHERE scope_id = pg_temp.id('93e001')) AS la;
INSERT INTO wallet (id, operator_id, ledger_id)
SELECT pg_temp.id('93f00' || n), pg_temp.id('93a001'), (SELECT la FROM fx) FROM generate_series(1, 8) n;

-- Demande BANK_TRANSFER de A avec l'IBAN p_iban
CREATE FUNCTION pg_temp.rr(p_wallet uuid, p_iban text) RETURNS uuid LANGUAGE sql AS $$
  INSERT INTO refund_request (operator_id, ledger_id, event_id, wallet_id, customer_id, method, iban, new_number,
                              status, estimated_amount, fee, currency)
  VALUES (pg_temp.id('93a001'), (SELECT la FROM fx), pg_temp.id('93e001'), p_wallet, pg_temp.id('93c001'),
          'BANK_TRANSFER', p_iban, false, 'REQUESTED', 1000, 10, 'XOF')
  RETURNING id
$$;

-- 0. Une ligne ancienne (avant les contraintes) reste lisible : on retire la contrainte, on insère en clair, on la
--    remet NOT VALID (état de la migration) ; la ligne ancienne n'est pas revalidée.
ALTER TABLE refund_request DROP CONSTRAINT refund_request_iban_sealed;
SELECT pg_temp.rr(pg_temp.id('93f001'), 'SN08SN0100152000048500003035');
ALTER TABLE refund_request ADD CONSTRAINT refund_request_iban_sealed
  CHECK (iban IS NULL OR iban LIKE 'enc:v1:%') NOT VALID;
SELECT is((SELECT iban FROM refund_request WHERE wallet_id = pg_temp.id('93f001')), 'SN08SN0100152000048500003035',
  'une ligne ancienne en clair reste lisible');
-- Limite connue de NOT VALID : un UPDATE réévalue le CHECK sur la ligne écrite ; une ligne ancienne en clair ne
-- peut donc plus changer d'état tant que son IBAN n'est pas chiffré (aucune reprise : plan IC-07).
SELECT throws_ok($q$UPDATE refund_request SET updated_at = clock_timestamp() WHERE wallet_id = pg_temp.id('93f001')$q$,
  '23514', NULL, 'une ligne ancienne en clair est lisible mais ne peut plus être mise à jour (limite signalée)');

-- 1. Métadonnées
SELECT is((SELECT convalidated FROM pg_constraint WHERE conname = 'refund_request_iban_sealed'), false,
  'refund_request_iban_sealed est NOT VALID');
SELECT is((SELECT convalidated FROM pg_constraint WHERE conname = 'payout_iban_sealed'), false,
  'payout_iban_sealed est NOT VALID');

-- 2. refund_request
SELECT throws_ok(format($q$SELECT pg_temp.rr(%L, 'SN08SN0100152000048500003035')$q$, pg_temp.id('93f002')),
  '23514', 'new row for relation "refund_request" violates check constraint "refund_request_iban_sealed"',
  'refund_request : IBAN en clair refusé');
SELECT throws_ok(format($q$SELECT pg_temp.rr(%L, ' enc:v1:k1:AAAA')$q$, pg_temp.id('93f002')), '23514', NULL,
  'refund_request : espace avant l''enveloppe refusé');
SELECT throws_ok(format($q$SELECT pg_temp.rr(%L, 'ENC:V1:k1:AAAA')$q$, pg_temp.id('93f002')), '23514', NULL,
  'refund_request : ENC:V1: refusé (casse)');
SELECT throws_ok(format($q$SELECT pg_temp.rr(%L, 'enc:v2:k1:AAAA')$q$, pg_temp.id('93f002')), '23514', NULL,
  'refund_request : enc:v2: refusé');
SELECT lives_ok(format($q$SELECT pg_temp.rr(%L, 'enc:v1:k1:AAAA')$q$, pg_temp.id('93f003')),
  'refund_request : enc:v1:k1:AAAA accepté');
SELECT lives_ok(format($q$SELECT pg_temp.rr(%L, NULL)$q$, pg_temp.id('93f004')), 'refund_request : NULL accepté');

-- 3. payout : transaction d'initiation en fixture, puis lignes complètes (les autres CHECK sont satisfaits)
INSERT INTO journal_transaction (id, operator_id, ledger_id, event_id, type, idempotency_key, request_hash, occurred_at,
                                 source, created_by, approved_by)
VALUES (pg_temp.id('93aa01'), pg_temp.id('93a001'), (SELECT la FROM fx), pg_temp.id('93e001'), 'ADJUSTMENT', 'bo:p1',
        'h', now(), 'BACKOFFICE', pg_temp.id('93aaa1'), pg_temp.id('93aaa2'));
CREATE FUNCTION pg_temp.po(p_iban text) RETURNS uuid LANGUAGE sql AS $$
  INSERT INTO payout (operator_id, ledger_id, beneficiary_id, amount, method, status, initiated_by, approved_by,
                      initiated_tx_id, iban)
  VALUES (pg_temp.id('93a001'), (SELECT la FROM fx), pg_temp.id('93b001'), 10, 'BANK_TRANSFER', 'INITIATED',
          pg_temp.id('93aaa1'), pg_temp.id('93aaa2'), pg_temp.id('93aa01'), p_iban)
  RETURNING id
$$;
SELECT throws_ok($q$SELECT pg_temp.po('SN08SN0100152000048500003035')$q$, '23514',
  'new row for relation "payout" violates check constraint "payout_iban_sealed"', 'payout : IBAN en clair refusé');
SELECT throws_ok($q$SELECT pg_temp.po('enc:v2:k1:AAAA')$q$, '23514', NULL, 'payout : enc:v2: refusé');
SELECT throws_ok($q$SELECT pg_temp.po('ENC:V1:k1:AAAA')$q$, '23514', NULL, 'payout : ENC:V1: refusé');
SELECT throws_ok($q$SELECT pg_temp.po(' enc:v1:k1:AAAA')$q$, '23514', NULL, 'payout : espace avant l''enveloppe refusé');
SELECT lives_ok($q$SELECT pg_temp.po('enc:v1:k1:AAAA')$q$, 'payout : enc:v1:k1:AAAA accepté');
SELECT lives_ok($q$INSERT INTO payout (operator_id, ledger_id, beneficiary_id, amount, method, status, initiated_by,
    approved_by, initiated_tx_id, msisdn)
  VALUES (pg_temp.id('93a001'), (SELECT la FROM fx), pg_temp.id('93b001'), 10, 'WAVE', 'INITIATED',
          pg_temp.id('93aaa1'), pg_temp.id('93aaa2'), pg_temp.id('93aa01'), '+221770000093')$q$,
  'payout : NULL (versement mobile sans IBAN) accepté');

-- 4. Mutation (NFR-004) : sans la contrainte, l'IBAN en clair passe sur les deux tables
ALTER TABLE refund_request DROP CONSTRAINT refund_request_iban_sealed;
ALTER TABLE payout DROP CONSTRAINT payout_iban_sealed;
SELECT lives_ok(format($q$SELECT pg_temp.rr(%L, 'SN08SN0100152000048500003036')$q$, pg_temp.id('93f005')),
  'MUTATION : sans refund_request_iban_sealed, l''IBAN en clair passe');
SELECT lives_ok($q$SELECT pg_temp.po('SN08SN0100152000048500003036')$q$,
  'MUTATION : sans payout_iban_sealed, l''IBAN en clair passe');

SELECT * FROM finish();
ROLLBACK;
