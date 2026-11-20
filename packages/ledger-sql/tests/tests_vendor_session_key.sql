-- Clé vendeur-session (0090, OP-N79, mission 11a WP01) — pgTAP, écrit à la main.
-- Lancer : pg_prove -d <base> tests/tests_vendor_session_key.sql
-- Fixtures en propriétaire ; deux vendeurs (VA, VB) d'un même prestataire, une session chacun.
\set ON_ERROR_STOP 1
\set QUIET 1
BEGIN;
\ir _grants_for_tests.sql
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

CREATE FUNCTION pg_temp.id(p text) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT ('00000000-0000-0000-0000-' || lpad(p, 12, '0'))::uuid $$;

CREATE FUNCTION pg_temp.try_msg(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE p_sql; RETURN 'ok'; EXCEPTION WHEN OTHERS THEN RETURN SQLERRM; END $$;

INSERT INTO party (id, kind, legal_name, country_code) VALUES
 (pg_temp.id('90a001'), 'OPERATOR', 'Prestataire A', 'SN');
INSERT INTO party (id, kind, operator_id, legal_name) VALUES
 (pg_temp.id('90b001'), 'ORGANIZER', pg_temp.id('90a001'), 'Organisateur A'),
 (pg_temp.id('90b101'), 'MERCHANT', pg_temp.id('90a001'), 'Commerçant M1');
INSERT INTO jurisdiction_profile (id, country_code, version, valid_from, breakage_destination)
VALUES (pg_temp.id('90c001'), 'SN', 900090, '2026-01-01', 'ORGANIZER');
INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone, jurisdiction_id,
                   funds_holder, status)
VALUES (pg_temp.id('90d001'), pg_temp.id('90a001'), pg_temp.id('90b001'), 'Événement A', 'XOF',
        'Africa/Dakar', pg_temp.id('90c001'), 'ORGANIZER', 'LIVE');
INSERT INTO merchant_participation (id, operator_id, event_id, merchant_id, link_type, payout_to)
VALUES (pg_temp.id('90f001'), pg_temp.id('90a001'), pg_temp.id('90d001'), pg_temp.id('90b101'),
        'INTERNAL', pg_temp.id('90b001'));
INSERT INTO point_of_sale (id, operator_id, participation_id, name)
VALUES (pg_temp.id('90f101'), pg_temp.id('90a001'), pg_temp.id('90f001'), 'Bar A');
INSERT INTO app_user (id, operator_id, issuer, subject, email, display_name)
VALUES (pg_temp.id('90e001'), pg_temp.id('90a001'), 'https://idp.test', 's0090', 'u@test', 'Admin A'),
       (pg_temp.id('90e002'), pg_temp.id('90a001'), 'https://idp.test', 's0091', 'u2@test', 'Admin 2');
INSERT INTO role_assignment (user_id, role, scope_type, scope_id, granted_by)
VALUES (pg_temp.id('90e001'), 'OPERATOR_ADMIN', 'OPERATOR', pg_temp.id('90a001'), NULL);
INSERT INTO device (id, operator_id, kind, app_mode, event_id, pos_id, serial, status) VALUES
 (pg_temp.id('90aa01'), pg_temp.id('90a001'), 'POS', 'KEYPAD_TPE', pg_temp.id('90d001'),
  pg_temp.id('90f101'), 'P90-AA01', 'ACTIVE'),
 (pg_temp.id('90aa02'), pg_temp.id('90a001'), 'POS', 'KEYPAD_TPE', pg_temp.id('90d001'),
  pg_temp.id('90f101'), 'P90-AA02', 'ACTIVE');
INSERT INTO ledger (id, operator_id, scope_type, scope_id, currency, issuer_id, funds_holder_id)
VALUES (pg_temp.id('90cc01'), pg_temp.id('90a001'), 'EVENT', pg_temp.id('90d001'), 'XOF',
        pg_temp.id('90b001'), pg_temp.id('90b001'));

SELECT set_config('app.operator_id', pg_temp.id('90a001')::text, true);
SELECT set_config('t90.va', create_vendor(pg_temp.id('90b101'), 'Vendeur A',
  '$argon2id$v=19$m=19456,t=2,p=1$c2VsMDA5MA$dkI', pg_temp.id('90e001'))::text, true);
SELECT set_config('t90.vb', create_vendor(pg_temp.id('90b101'), 'Vendeur B',
  '$argon2id$v=19$m=19456,t=2,p=1$c2VsMDA5MA$dkI', pg_temp.id('90e001'))::text, true);
SELECT set_config('t90.sa', (SELECT vendor_session_id FROM open_vendor_session(
  (SELECT check_id FROM begin_vendor_pin_check(current_setting('t90.va')::uuid,
     pg_temp.id('90aa01'))), pg_temp.id('90aa01')))::text, true);
SELECT set_config('t90.sb', (SELECT vendor_session_id FROM open_vendor_session(
  (SELECT check_id FROM begin_vendor_pin_check(current_setting('t90.vb')::uuid,
     pg_temp.id('90aa02'))), pg_temp.id('90aa02')))::text, true);

-- Ventes : t1 (positif), t2 (croisée), t3 (back-office), t4 et t5 (fonctions).
INSERT INTO journal_transaction (id, operator_id, ledger_id, event_id, type, idempotency_key,
                                 request_hash, occurred_at, source, device_id, created_by, approved_by)
SELECT pg_temp.id(t), pg_temp.id('90a001'), pg_temp.id('90cc01'), pg_temp.id('90d001'),
       'PURCHASE', 'k90:' || t, 'h90', now(), s, d, u, u2
  FROM (VALUES ('90f001a', 'ONLINE', pg_temp.id('90aa01'), NULL::uuid, NULL::uuid),
               ('90f001b', 'ONLINE', pg_temp.id('90aa01'), NULL, NULL),
               ('90f001c', 'BACKOFFICE', NULL, pg_temp.id('90e001'), pg_temp.id('90e002')),
               ('90f001d', 'ONLINE', pg_temp.id('90aa01'), NULL, NULL),
               ('90f001e', 'ONLINE', pg_temp.id('90aa01'), NULL, NULL)) AS v(t, s, d, u, u2);

-- (a) contrôle positif : session de A, vendeur A.
SELECT lives_ok($$INSERT INTO sale_attribution (transaction_id, operator_id, vendor_id,
    vendor_session_id, device_id, channel) VALUES (pg_temp.id('90f001a'), pg_temp.id('90a001'),
    current_setting('t90.va')::uuid, current_setting('t90.sa')::uuid, pg_temp.id('90aa01'), 'NFC')$$,
  'attribution (session de A, vendeur A) acceptée');
SELECT is((SELECT vendor_id FROM sale_attribution WHERE transaction_id = pg_temp.id('90f001a')),
  current_setting('t90.va')::uuid, 'la ligne écrite porte bien le vendeur A');
-- (b) session de A, vendeur B : refus par la clé composite.
SELECT throws_ok($$INSERT INTO sale_attribution (transaction_id, operator_id, vendor_id,
    vendor_session_id, device_id, channel) VALUES (pg_temp.id('90f001b'), pg_temp.id('90a001'),
    current_setting('t90.vb')::uuid, current_setting('t90.sa')::uuid, pg_temp.id('90aa01'), 'NFC')$$,
  '23503', NULL, 'attribution (session de A, vendeur B) refusée (23503)');
SELECT matches(pg_temp.try_msg($$INSERT INTO sale_attribution (transaction_id, operator_id,
    vendor_id, vendor_session_id, device_id, channel) VALUES (pg_temp.id('90f001b'),
    pg_temp.id('90a001'), current_setting('t90.vb')::uuid, current_setting('t90.sa')::uuid,
    pg_temp.id('90aa01'), 'NFC')$$), 'sale_attribution_session_vendor_fk',
  'le refus nomme sale_attribution_session_vendor_fk');
-- (c) back-office : vendeur et session nuls, auteur posé.
SELECT lives_ok($$INSERT INTO sale_attribution (transaction_id, operator_id, channel,
    actor_user_id) VALUES (pg_temp.id('90f001c'), pg_temp.id('90a001'), 'NFC',
    pg_temp.id('90e001'))$$, 'attribution de back-office acceptée');
-- (d) les fonctions d'attribution restent vertes.
SELECT lives_ok($$SELECT record_sale_attribution(pg_temp.id('90f001d'),
    current_setting('t90.sa')::uuid, 'NFC')$$, 'record_sale_attribution vert');
SELECT is((SELECT vendor_id FROM sale_attribution WHERE transaction_id = pg_temp.id('90f001d')),
  current_setting('t90.va')::uuid, 'record_sale_attribution écrit le vendeur de la session');
SELECT lives_ok($$SELECT record_sale_attribution_at(pg_temp.id('90f001e'),
    current_setting('t90.sa')::uuid, 'NFC', NULL, now())$$, 'record_sale_attribution_at vert');
-- (e) existence des contraintes.
SELECT is((SELECT count(*)::int FROM pg_constraint WHERE conname IN
  ('vendor_session_id_vendor_key', 'sale_attribution_session_vendor_fk', 'sale_attribution_session_fk')),
  3, 'les trois contraintes existent (l''ancienne est conservée)');

-- Mutation (NFR-004) : sans la clé composite, le cas (b) passerait. La fonction retire la clé, tente
-- l'insertion du cas (b), puis annule tout (sous-transaction) : le compteur pgTAP reste intact.
SET CONSTRAINTS ALL IMMEDIATE;
CREATE FUNCTION pg_temp.mutation_b() RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  ALTER TABLE sale_attribution DROP CONSTRAINT sale_attribution_session_vendor_fk;
  INSERT INTO sale_attribution (transaction_id, operator_id, vendor_id, vendor_session_id,
                                device_id, channel)
  VALUES (pg_temp.id('90f001b'), pg_temp.id('90a001'), current_setting('t90.vb')::uuid,
          current_setting('t90.sa')::uuid, pg_temp.id('90aa01'), 'NFC');
  RAISE EXCEPTION 'MUTATION_PASSED';
EXCEPTION WHEN raise_exception THEN RETURN SQLERRM;
          WHEN OTHERS THEN RETURN 'refused ' || SQLSTATE;
END $$;
SELECT is(pg_temp.mutation_b(), 'MUTATION_PASSED',
  'MUTATION : sans la clé, (session de A, vendeur B) passe : le test (b) la détecte');
SELECT is((SELECT count(*)::int FROM pg_constraint
            WHERE conname = 'sale_attribution_session_vendor_fk'), 1,
  'la clé est de retour après la mutation annulée');

SELECT * FROM finish();
ROLLBACK;
