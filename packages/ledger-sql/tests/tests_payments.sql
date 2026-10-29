-- Paiement, annulation et approbation sur place (migration 0033 ; mission
-- terminaux-paiement-en-ligne, lot WP04) — pgTAP, écrit à la main (pas un fichier généré).
-- Lancer : pg_prove -d <base> tests/tests_payments.sql (base créée par les migrations, roles.sql et
-- post-roles.sql rejoués).
-- Rôle propriétaire avec `app.operator_id` posé (pas de SET ROLE cashless_app : les accords
-- viennent du lot WP07). Chaque refus a son témoin qui passe. Une seule session : la concurrence
-- (NFR-005 : vingt annulations simultanées, une seule écrite ; même lecture payée deux fois) est
-- prouvée par les tests Jest des lots WP11, WP12 et WP14 ; ici, l'unicité est prouvée par l'index.
\set ON_ERROR_STOP 1
\set QUIET 1
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

-- Identifiants : pg_temp.id('33a001') = '00000000-0000-0000-0000-00000033a001'.
CREATE FUNCTION pg_temp.id(p text) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT ('00000000-0000-0000-0000-' || lpad(p, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.a() RETURNS void LANGUAGE sql AS
  $$ SELECT set_config('app.operator_id', pg_temp.id('33a001')::text, true) $$;
CREATE FUNCTION pg_temp.b() RETURNS void LANGUAGE sql AS
  $$ SELECT set_config('app.operator_id', pg_temp.id('33a002')::text, true) $$;
-- record_sale_attribution avec des identifiants courts (vente, session).
CREATE FUNCTION pg_temp.att(p_tx text, p_session text, p_channel text, p_actor uuid DEFAULT NULL)
  RETURNS void LANGUAGE sql AS
  $$ SELECT record_sale_attribution(pg_temp.id(p_tx), pg_temp.id(p_session), p_channel, p_actor) $$;

-- Données (propriétaire) ------------------------------------------------------------------------
-- A : organisateur b001, événements d001 (LIVE), d002 (LIVE), d003 (RECONCILING) ; commerçant M1
-- (b101), points de vente f101 (d001) et f102 (d002). B : organisateur b011, événement d011,
-- commerçant MB (b111), point de vente f111.
INSERT INTO party (id, kind, legal_name, country_code) VALUES
 (pg_temp.id('33a001'), 'OPERATOR', 'Prestataire A', 'SN'),
 (pg_temp.id('33a002'), 'OPERATOR', 'Prestataire B', 'CI');
INSERT INTO party (id, kind, operator_id, legal_name) VALUES
 (pg_temp.id('33b001'), 'ORGANIZER', pg_temp.id('33a001'), 'Organisateur A'),
 (pg_temp.id('33b011'), 'ORGANIZER', pg_temp.id('33a002'), 'Organisateur B'),
 (pg_temp.id('33b101'), 'MERCHANT', pg_temp.id('33a001'), 'Commerçant M1'),
 (pg_temp.id('33b111'), 'MERCHANT', pg_temp.id('33a002'), 'Commerçant MB'),
 (pg_temp.id('33b201'), 'CUSTOMER', pg_temp.id('33a001'), 'Festivalier A');
INSERT INTO jurisdiction_profile (id, country_code, version, valid_from, breakage_destination)
VALUES (pg_temp.id('33c001'), 'SN', 330033, '2026-01-01', 'ORGANIZER');
INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone, jurisdiction_id,
                   funds_holder, status) VALUES
 (pg_temp.id('33d001'), pg_temp.id('33a001'), pg_temp.id('33b001'), 'Événement A1', 'XOF',
  'Africa/Dakar', pg_temp.id('33c001'), 'ORGANIZER', 'LIVE'),
 (pg_temp.id('33d002'), pg_temp.id('33a001'), pg_temp.id('33b001'), 'Événement A2', 'XOF',
  'Africa/Dakar', pg_temp.id('33c001'), 'ORGANIZER', 'LIVE'),
 (pg_temp.id('33d003'), pg_temp.id('33a001'), pg_temp.id('33b001'), 'Événement A3', 'XOF',
  'Africa/Dakar', pg_temp.id('33c001'), 'ORGANIZER', 'RECONCILING'),
 (pg_temp.id('33d011'), pg_temp.id('33a002'), pg_temp.id('33b011'), 'Événement B', 'XOF',
  'Africa/Dakar', pg_temp.id('33c001'), 'ORGANIZER', 'LIVE');
INSERT INTO merchant_participation (id, operator_id, event_id, merchant_id, link_type,
                                    payout_to) VALUES
 (pg_temp.id('33f001'), pg_temp.id('33a001'), pg_temp.id('33d001'), pg_temp.id('33b101'),
  'INTERNAL', pg_temp.id('33b001')),
 (pg_temp.id('33f002'), pg_temp.id('33a001'), pg_temp.id('33d002'), pg_temp.id('33b101'),
  'INTERNAL', pg_temp.id('33b001')),
 (pg_temp.id('33f011'), pg_temp.id('33a002'), pg_temp.id('33d011'), pg_temp.id('33b111'),
  'INTERNAL', pg_temp.id('33b011'));
INSERT INTO point_of_sale (id, operator_id, participation_id, name) VALUES
 (pg_temp.id('33f101'), pg_temp.id('33a001'), pg_temp.id('33f001'), 'Bar A1'),
 (pg_temp.id('33f102'), pg_temp.id('33a001'), pg_temp.id('33f002'), 'Bar A2'),
 (pg_temp.id('33f111'), pg_temp.id('33a002'), pg_temp.id('33f011'), 'Bar B');
-- Personnes de A : e001 SUPERVISOR de d001 ; e002 SUPERVISOR de l'organisateur b001 ; e003 sans
-- rôle ; e004 SUPERVISOR de d002 ; e005 ORGANIZER_ADMIN de b001 ; e006 CASHIER de d001 (lot WP07,
-- relecture WP04 constat 3). B : e011.
INSERT INTO app_user (id, operator_id, issuer, subject, email, display_name)
SELECT pg_temp.id(u), pg_temp.id(o), 'https://idp.test', 's0033' || u, u || '@test',
       'Personne ' || u
  FROM (VALUES ('33e001', '33a001'), ('33e002', '33a001'), ('33e003', '33a001'),
               ('33e004', '33a001'), ('33e005', '33a001'), ('33e006', '33a001'),
               ('33e011', '33a002')) AS v(u, o);
INSERT INTO role_assignment (user_id, role, scope_type, scope_id, granted_by) VALUES
 (pg_temp.id('33e001'), 'SUPERVISOR', 'EVENT', pg_temp.id('33d001'), NULL),
 (pg_temp.id('33e002'), 'SUPERVISOR', 'ORGANIZER', pg_temp.id('33b001'), NULL),
 (pg_temp.id('33e004'), 'SUPERVISOR', 'EVENT', pg_temp.id('33d002'), NULL),
 (pg_temp.id('33e005'), 'ORGANIZER_ADMIN', 'ORGANIZER', pg_temp.id('33b001'), NULL),
 (pg_temp.id('33e006'), 'CASHIER', 'EVENT', pg_temp.id('33d001'), NULL);
-- Terminaux : aa01, aa02, aa05 caisses de d001 ; aa03 caisse de d002 ; ab01 caisse de B.
INSERT INTO device (id, operator_id, kind, app_mode, event_id, pos_id, serial) VALUES
 (pg_temp.id('33aa01'), pg_temp.id('33a001'), 'POS', 'CATALOG_POS', pg_temp.id('33d001'),
  pg_temp.id('33f101'), 'P33-AA01'),
 (pg_temp.id('33aa02'), pg_temp.id('33a001'), 'POS', 'CATALOG_POS', pg_temp.id('33d001'),
  pg_temp.id('33f101'), 'P33-AA02'),
 (pg_temp.id('33aa03'), pg_temp.id('33a001'), 'POS', 'CATALOG_POS', pg_temp.id('33d002'),
  pg_temp.id('33f102'), 'P33-AA03'),
 (pg_temp.id('33aa05'), pg_temp.id('33a001'), 'POS', 'CATALOG_POS', pg_temp.id('33d001'),
  pg_temp.id('33f101'), 'P33-AA05'),
 (pg_temp.id('33ab01'), pg_temp.id('33a002'), 'POS', 'CATALOG_POS', pg_temp.id('33d011'),
  pg_temp.id('33f111'), 'P33-AB01');
-- Vendeurs : v001 et v002 de M1 ; v011 de MB.
INSERT INTO vendor (id, operator_id, merchant_id, display_name, pin_hash, created_by) VALUES
 (pg_temp.id('33fa001'), pg_temp.id('33a001'), pg_temp.id('33b101'), 'Vendeur 1',
  '$argon2id$v=19$m=19456,t=2,p=1$c2VsMDAzMw$djE', pg_temp.id('33e003')),
 (pg_temp.id('33fa002'), pg_temp.id('33a001'), pg_temp.id('33b101'), 'Vendeur 2',
  '$argon2id$v=19$m=19456,t=2,p=1$c2VsMDAzMw$djI', pg_temp.id('33e003')),
 (pg_temp.id('33fa011'), pg_temp.id('33a002'), pg_temp.id('33b111'), 'Vendeur B',
  '$argon2id$v=19$m=19456,t=2,p=1$c2VsMDAzMw$dkI', pg_temp.id('33e011'));
-- Sessions : s001 (v001, aa01, ouverte) ; s002 (v002, aa02, ouverte) ; s003 (v001, aa03, ouverte) ;
-- s004 (v002, aa01, close : historique) ; s005 (v001, aa02, close : historique) ; s006 (v001,
-- aa05, expirée, jamais close) ; s011 (v011, ab01, ouverte).
INSERT INTO vendor_session (id, operator_id, vendor_id, device_id, opened_at, expires_at, closed_at,
                            closed_reason)
SELECT pg_temp.id(s), pg_temp.id(o), pg_temp.id(v), pg_temp.id(d), now() - age,
       now() - age + interval '12 hours',
       CASE WHEN closed THEN now() - interval '1 minute' END,
       CASE WHEN closed THEN 'LOGOUT' END
  FROM (VALUES ('33fb001', '33a001', '33fa001', '33aa01', interval '1 hour', false),
               ('33fb002', '33a001', '33fa002', '33aa02', interval '1 hour', false),
               ('33fb003', '33a001', '33fa001', '33aa03', interval '1 hour', false),
               ('33fb004', '33a001', '33fa002', '33aa01', interval '2 hours', true),
               ('33fb005', '33a001', '33fa001', '33aa02', interval '2 hours', true),
               ('33fb006', '33a001', '33fa001', '33aa05', interval '13 hours', false),
               ('33fb011', '33a002', '33fa011', '33ab01', interval '1 hour', false))
       AS x(s, o, v, d, age, closed);
-- Grands livres, portefeuilles (A : w001 ACTIVE, w002 BLOCKED, w003 CLOSED ; B : w011).
INSERT INTO ledger (id, operator_id, scope_type, scope_id, currency, issuer_id,
                    funds_holder_id) VALUES
 (pg_temp.id('33cc001'), pg_temp.id('33a001'), 'ORGANIZER', pg_temp.id('33b001'), 'XOF',
  pg_temp.id('33b001'), pg_temp.id('33b001')),
 (pg_temp.id('33cc011'), pg_temp.id('33a002'), 'ORGANIZER', pg_temp.id('33b011'), 'XOF',
  pg_temp.id('33b011'), pg_temp.id('33b011'));
INSERT INTO wallet (id, operator_id, ledger_id, status) VALUES
 (pg_temp.id('33cb001'), pg_temp.id('33a001'), pg_temp.id('33cc001'), 'ACTIVE'),
 (pg_temp.id('33cb002'), pg_temp.id('33a001'), pg_temp.id('33cc001'), 'BLOCKED'),
 (pg_temp.id('33cb003'), pg_temp.id('33a001'), pg_temp.id('33cc001'), 'CLOSED'),
 (pg_temp.id('33cb011'), pg_temp.id('33a002'), pg_temp.id('33cc011'), 'ACTIVE');
-- Bracelets de A : m001 ACTIVE (w001) ; m002 SUSPENDED ; m003 BLACKLISTED (passés par ACTIVE).
INSERT INTO media (id, operator_id, kind, token_hash, nfc_uid, wallet_id, status)
SELECT pg_temp.id(m), pg_temp.id('33a001'), 'NFC_TAG', sha256(convert_to('identité ' || m, 'UTF8')),
       decode('043300000000' || n, 'hex'), pg_temp.id('33cb001'), 'ACTIVE'
  FROM (VALUES ('33ca001', '01'), ('33ca002', '02'), ('33ca003', '03')) AS x(m, n);
UPDATE media SET status = 'SUSPENDED' WHERE id = pg_temp.id('33ca002');
UPDATE media SET status = 'BLACKLISTED' WHERE id = pg_temp.id('33ca003');

-- Écritures (insérées par le propriétaire ; seules les fonctions de 0033 les lisent). Ventes
-- PURCHASE en ligne sur d001 sauf mention :
--   t001 aa01 (attribution) ; t002 aa01 (lecture consommée) ; t003 BACKOFFICE (auteur e003,
--   valideur e001) ; t004 TOPUP ; t005 aa05 (session expirée) ; t006 aa01 (annulée par un
--   SUPERVISOR, sans attribution) ; t007 aa02 ; t008 sans terminal ; t009 aa01 bracelet m002 ;
--   t011 de B (ab01) ;
--   r001 aa01 v001 récente ; r002 aa01 v002 récente ; r003 aa02 v001 récente ; r004 aa01 v001
--   ancienne (20 min) ; r005 aa01 v002 ancienne ; r006 aa01 v001 déjà annulée ; r007 sur d003
--   (RECONCILING) ; r009 aa01 v001 (back-office).
INSERT INTO journal_transaction (id, operator_id, ledger_id, event_id, type, idempotency_key,
                                 request_hash, occurred_at, recorded_at, source, device_id,
                                 media_id, created_by, approved_by)
SELECT pg_temp.id(t), pg_temp.id(o), pg_temp.id(l), pg_temp.id(e), ty, 'k33:' || t, 'h33', now(),
       clock_timestamp() - age, src, pg_temp.id(d), pg_temp.id(m), pg_temp.id(cb), pg_temp.id(ab)
  FROM (VALUES
   ('33fc001','33a001','33cc001','33d001','PURCHASE','ONLINE','33aa01',NULL,interval '0',NULL,NULL),
   ('33fc002','33a001','33cc001','33d001','PURCHASE','ONLINE','33aa01',NULL,interval '0',NULL,NULL),
   ('33fc003','33a001','33cc001','33d001','PURCHASE','BACKOFFICE',NULL,NULL,interval '0','33e003',
    '33e001'),
   ('33fc004','33a001','33cc001','33d001','TOPUP','ONLINE','33aa01',NULL,interval '0',NULL,NULL),
   ('33fc005','33a001','33cc001','33d001','PURCHASE','ONLINE','33aa05',NULL,interval '0',NULL,NULL),
   ('33fc006','33a001','33cc001','33d001','PURCHASE','ONLINE','33aa01',NULL,interval '0',NULL,NULL),
   ('33fc007','33a001','33cc001','33d001','PURCHASE','ONLINE','33aa02',NULL,interval '0',NULL,NULL),
   ('33fc008','33a001','33cc001','33d001','PURCHASE','ONLINE',NULL,NULL,interval '0',NULL,NULL),
   ('33fc009','33a001','33cc001','33d001','PURCHASE','ONLINE','33aa01','33ca002',interval '0',NULL,
    NULL),
   ('33fc011','33a002','33cc011','33d011','PURCHASE','ONLINE','33ab01',NULL,interval '0',NULL,NULL),
   ('33fd001','33a001','33cc001','33d001','PURCHASE','ONLINE','33aa01','33ca001',interval '0',NULL,
    NULL),
   ('33fd002','33a001','33cc001','33d001','PURCHASE','ONLINE','33aa01',NULL,interval '0',NULL,NULL),
   ('33fd003','33a001','33cc001','33d001','PURCHASE','ONLINE','33aa02',NULL,interval '0',NULL,NULL),
   ('33fd004','33a001','33cc001','33d001','PURCHASE','ONLINE','33aa01',NULL,interval '20 minutes',
    NULL,NULL),
   ('33fd005','33a001','33cc001','33d001','PURCHASE','ONLINE','33aa01',NULL,interval '20 minutes',
    NULL,NULL),
   ('33fd006','33a001','33cc001','33d001','PURCHASE','ONLINE','33aa01',NULL,interval '0',NULL,NULL),
   ('33fd007','33a001','33cc001','33d003','PURCHASE','ONLINE','33aa01',NULL,interval '0',NULL,NULL),
   ('33fd009','33a001','33cc001','33d001','PURCHASE','ONLINE','33aa01',NULL,interval '0',NULL,NULL))
   AS x(t, o, l, e, ty, src, d, m, age, cb, ab);
-- Annulation déjà écrite de r006.
INSERT INTO journal_transaction (id, operator_id, ledger_id, event_id, type, idempotency_key,
                                 request_hash, occurred_at, source, device_id, reverses_id)
VALUES (pg_temp.id('33fe006'), pg_temp.id('33a001'), pg_temp.id('33cc001'), pg_temp.id('33d001'),
        'REVERSAL', 'k33:x006', 'h33', now(), 'ONLINE', pg_temp.id('33aa01'),
        pg_temp.id('33fd006'));
-- Attributions historiques des ventes à annuler (posées par le propriétaire).
INSERT INTO sale_attribution (transaction_id, operator_id, vendor_id, vendor_session_id, device_id,
                              channel)
SELECT pg_temp.id(t), pg_temp.id('33a001'), pg_temp.id(v), pg_temp.id(s), pg_temp.id(d), 'NFC'
  FROM (VALUES ('33fd001', '33fa001', '33fb001', '33aa01'),
               ('33fd002', '33fa002', '33fb004', '33aa01'),
               ('33fd003', '33fa001', '33fb005', '33aa02'),
               ('33fd004', '33fa001', '33fb001', '33aa01'),
               ('33fd005', '33fa002', '33fb004', '33aa01'),
               ('33fd006', '33fa001', '33fb001', '33aa01'),
               ('33fd007', '33fa001', '33fb001', '33aa01'),
               ('33fd009', '33fa001', '33fb001', '33aa01'))
       AS x(t, v, s, d);
-- Lignes de r001 : débit du portefeuille w001, crédit du commerçant (non validées : ROLLBACK).
INSERT INTO account (id, operator_id, ledger_id, code, family, purpose, wallet_id,
                     normal_side) VALUES
 (pg_temp.id('33cd001'), pg_temp.id('33a001'), pg_temp.id('33cc001'), 'K33-WAL', 'CLAIM',
  'WALLET_PAID', pg_temp.id('33cb001'), 'C'),
 (pg_temp.id('33cd002'), pg_temp.id('33a001'), pg_temp.id('33cc001'), 'K33-MER', 'CLAIM',
  'MERCHANT', NULL, 'C');
INSERT INTO posting (operator_id, ledger_id, transaction_id, line_no, account_id, amount)
SELECT pg_temp.id('33a001'), pg_temp.id('33cc001'), pg_temp.id('33fd001'), n, pg_temp.id(k), amt
  FROM (VALUES (1, '33cd001', 500), (2, '33cd002', -500)) AS x(n, k, amt);

-- Lectures (toutes de A) : 1 m001 aa01 récente ; 2 m001 aa02 récente ; 3 m001 aa01 consommée
-- (t002) ; 4 m001 aa01 liée à une demande de rattachement ; 5 m001 aa01 ancienne (10 min) ; 6 m002
-- aa01 ; 7 m003 aa01 ; 8 m001 aa02 récente ; 9 m001 aa01 récente ; 10 m001 aa01 récente.
INSERT INTO media_tap (id, operator_id, media_id, counter, nfc_uid, occurred_at, device_id, mode,
                       transaction_id, received_at)
SELECT 9033000 + n, pg_temp.id('33a001'), pg_temp.id(m), n, '\x04330000000001', now(),
       pg_temp.id(d), 'ONLINE', pg_temp.id(tx), clock_timestamp() - age
  FROM (VALUES (1, '33ca001', '33aa01', NULL, interval '0'),
               (2, '33ca001', '33aa02', NULL, interval '0'),
               (3, '33ca001', '33aa01', '33fc002', interval '0'),
               (4, '33ca001', '33aa01', NULL, interval '0'),
               (5, '33ca001', '33aa01', NULL, interval '10 minutes'),
               (6, '33ca002', '33aa01', NULL, interval '0'),
               (7, '33ca003', '33aa01', NULL, interval '0'),
               (8, '33ca001', '33aa02', NULL, interval '0'),
               (9, '33ca001', '33aa01', NULL, interval '0'),
               (10, '33ca001', '33aa01', NULL, interval '0'))
       AS x(n, m, d, tx, age);
INSERT INTO media_claim (id, operator_id, media_id, customer_id, status, confirmation_hash,
                         expires_at, confirmed_device_id, confirmed_by, confirmed_at,
                         confirmed_tap_id)
VALUES (pg_temp.id('33c004'), pg_temp.id('33a001'), pg_temp.id('33ca001'), pg_temp.id('33b201'),
        'CONFIRMED', sha256('confirmation 0033'::bytea), now() + interval '1 day',
        pg_temp.id('33aa01'), pg_temp.id('33e003'), now(), 9033004);

-- 0. Forme ---------------------------------------------------------------------------------------
-- Chaque fonction nouvelle ou remplacée : SECURITY DEFINER, search_path = public, pg_temp, aucune
-- entrée PUBLIC dans ses droits (REVOKE de la migration ; post-roles.sql le retire aussi).
SELECT is((SELECT count(*)::int FROM pg_proc p
            WHERE p.pronamespace = 'public'::regnamespace
              AND p.proname IN ('record_sale_attribution','assert_tap_payable',
                                'assert_wallet_payable','consume_tap','assert_reversible')
              AND p.prosecdef AND p.proconfig = ARRAY['search_path=public, pg_temp']
              AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl,
                                acldefault('f', p.proowner))) a WHERE a.grantee = 0)), 5,
  'cinq fonctions de 0033 : SECURITY DEFINER, search_path = public, pg_temp, aucun droit PUBLIC');
SELECT is((SELECT count(*)::int FROM pg_proc WHERE proname = 'consume_tap'), 1,
  'consume_tap : une seule signature (bigint, uuid), remplacée sur place');
SELECT is((SELECT provolatile::text FROM pg_proc WHERE proname = 'assert_reversible'), 'v',
  'assert_reversible : VOLATILE (elle verrouille ; STABLE interdit)');
SELECT ok((SELECT prosrc LIKE '%pg_advisory_xact_lock(hashtextextended(''media-tap-use:'''
                               || ' || p_tap::text, 0))%'
             FROM pg_proc WHERE proname = 'assert_tap_payable'),
  'assert_tap_payable prend le même verrou consultatif que consume_tap');
SELECT is((SELECT indexdef FROM pg_indexes WHERE indexname = 'journal_transaction_reverses_once'),
  'CREATE UNIQUE INDEX journal_transaction_reverses_once ON public.journal_transaction '
  || 'USING btree (reverses_id) WHERE (reverses_id IS NOT NULL)',
  'index unique partiel journal_transaction_reverses_once sur reverses_id');
SELECT ok(NOT EXISTS (SELECT 1 FROM pg_trigger g JOIN pg_proc p ON p.oid = g.tgfoid
                       WHERE g.tgrelid IN ('sale_attribution'::regclass,
                                           'approval_token_use'::regclass,
                                           'vendor_session'::regclass)
                         AND NOT g.tgisinternal AND p.prosecdef),
  'aucun déclencheur SECURITY DEFINER sur sale_attribution, approval_token_use, vendor_session');
SELECT is((SELECT relrowsecurity::text || relforcerowsecurity::text FROM pg_class
            WHERE oid = 'sale_attribution'::regclass), 'truetrue',
  'sale_attribution : RLS activée et forcée');
-- Liste des actions : celle de 0011 à l'identique, plus SALE_REVERSAL (25 actions).
SELECT is((SELECT count(*)::int FROM unnest(ARRAY[
   'LATE_CLAIM','ADJUSTMENT','ANOMALY_RESOLUTION','WAIVE_SEQ_GAP','FORCE_CENTRAL_AUTHORITY',
   'REINSTATE_MEDIA','PAYOUT','DEVICE_JOURNAL_IMPORT','KYC_REVOCATION','PSP_CONFIGURATION',
   'EVENT_PSP_SELECTION','WALLET_REFUND','LATE_CHARGEBACK','EVENT_GO_LIVE','EVENT_SETTINGS_CHANGE',
   'EVENT_OPERATOR_SETTINGS_CHANGE','PARTICIPATION_CHANGE','FEE_RULE_CHANGE','CONTRACT_VERSION',
   'PLATFORM_CONTRACT_VERSION','JURISDICTION_LIMITS_CHANGE','TAG_KEY_CREATE','TAG_DEK_ROTATE',
   'TAG_KEY_RETIRE','SALE_REVERSAL']) x
            WHERE (SELECT pg_get_constraintdef(oid) FROM pg_constraint
                    WHERE conname = 'approval_request_action_check')
                  LIKE '%''' || x || '''::text%'), 25,
  'approval_request_action_check : les 24 actions de 0011 et SALE_REVERSAL');
SELECT is((SELECT (length(d) - length(replace(d, '::text', ''))) / 6 FROM
            (SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint
              WHERE conname = 'approval_request_action_check') c), 27,
  'approval_request_action_check : aucune autre action (WALLET_UNBLOCK et CASH_DEPOSIT depuis 0038)');

-- 1. record_sale_attribution (A11) ---------------------------------------------------------------
SELECT pg_temp.a();
SELECT throws_ok($$SELECT pg_temp.att('33fc001', '33fb004', 'NFC')$$,
  'CL032', NULL, 'attribution : session close refusée (CL032)');
SELECT throws_ok($$SELECT pg_temp.att('33fc005', '33fb006', 'NFC')$$,
  'CL032', NULL, 'attribution : session expirée (jamais close) refusée (CL032)');
SELECT throws_ok($$SELECT pg_temp.att('33fc001', '33fb002', 'NFC')$$,
  'CL032', NULL,
  'attribution : session d''un autre terminal que celui de la vente refusée (CL032)');
SELECT throws_ok($$SELECT pg_temp.att('33fc001', '33fb011', 'NFC')$$,
  'CL032', NULL, 'attribution : session d''un autre prestataire refusée (CL032)');
SELECT throws_ok($$SELECT pg_temp.att('33fc011', '33fb001', 'NFC')$$,
  'P0002', NULL, 'attribution : vente d''un autre prestataire : introuvable');
SELECT throws_ok($$SELECT pg_temp.att('33fc004', '33fb001', 'NFC')$$,
  'P0002', NULL, 'attribution : écriture ni PURCHASE ni REVERSAL : introuvable');
SELECT throws_ok($$SELECT pg_temp.att('33fc001', '33fb001', NULL)$$,
  'CL001', NULL, 'attribution : vente sans canal refusée');
SELECT throws_ok($$SELECT pg_temp.att('33fc001', '33fb001', 'CASH')$$,
  'CL001', NULL, 'attribution : canal inconnu refusé');
SELECT throws_ok($$SELECT pg_temp.att('33fc001', '33fb001', 'NFC',
                                                  pg_temp.id('33e001'))$$,
  'CL001', NULL, 'attribution : personne jointe à une vente au terminal refusée');
SELECT is((SELECT count(*)::int FROM sale_attribution
            WHERE transaction_id IN (pg_temp.id('33fc001'), pg_temp.id('33fc005'))), 0,
  'NFR-006 : refus sans écriture');
-- Témoin : vendeur et terminal lus dans la session, jamais reçus.
SELECT lives_ok($$SELECT pg_temp.att('33fc001', '33fb001', 'NFC')$$,
  'témoin : vente attribuée par la session ouverte de son terminal');
SELECT is((SELECT vendor_id::text || ' ' || device_id::text || ' ' || vendor_session_id::text || ' '
                  || channel || ' ' || coalesce(actor_user_id::text, '-')
             FROM sale_attribution WHERE transaction_id = pg_temp.id('33fc001')),
  pg_temp.id('33fa001')::text || ' ' || pg_temp.id('33aa01')::text || ' '
    || pg_temp.id('33fb001')::text || ' NFC -',
  'FR-006 : vente attribuée au vendeur de la session (v001) et au terminal de la session');
SELECT throws_ok($$SELECT pg_temp.att('33fc001', '33fb001', 'NFC')$$,
  '23505', NULL, 'seconde attribution de la même vente refusée (clé primaire)');
SELECT throws_ok($$UPDATE sale_attribution SET channel = 'CUSTOMER_QR'
                    WHERE transaction_id = pg_temp.id('33fc001')$$,
  NULL, NULL, 'sale_attribution en ajout seul : modification refusée');
SELECT throws_ok($$DELETE FROM sale_attribution WHERE transaction_id = pg_temp.id('33fc001')$$,
  NULL, NULL, 'sale_attribution en ajout seul : suppression refusée');
-- Back-office : auteur obligatoire, égal à created_by.
SELECT throws_ok($$SELECT record_sale_attribution(pg_temp.id('33fc003'), NULL, 'NFC')$$,
  'CL001', NULL, 'attribution au back-office sans auteur refusée');
SELECT throws_ok($$SELECT record_sale_attribution(pg_temp.id('33fc003'), NULL, 'NFC',
                                                  pg_temp.id('33e001'))$$,
  'CL001', NULL, 'attribution au back-office : auteur différent de created_by refusé');
SELECT throws_ok($$SELECT record_sale_attribution(pg_temp.id('33fc007'), NULL, 'NFC',
                                                  pg_temp.id('33e003'))$$,
  'CL001', NULL, 'attribution sans session d''une écriture qui n''est pas BACKOFFICE refusée');
SELECT lives_ok($$SELECT record_sale_attribution(pg_temp.id('33fc003'), NULL, 'NFC',
                                                 pg_temp.id('33e003'))$$,
  'témoin : attribution au back-office à son auteur');
SELECT is((SELECT actor_user_id FROM sale_attribution WHERE transaction_id = pg_temp.id('33fc003')
             AND vendor_id IS NULL AND device_id IS NULL), pg_temp.id('33e003'),
  'attribution au back-office : auteur seul, ni vendeur ni terminal');
-- Annulation : canal recopié de la vente annulée.
RESET app.operator_id;
INSERT INTO journal_transaction (id, operator_id, ledger_id, event_id, type, idempotency_key,
                                 request_hash, occurred_at, source, device_id, reverses_id,
                                 approved_by)
VALUES (pg_temp.id('33fe001'), pg_temp.id('33a001'), pg_temp.id('33cc001'), pg_temp.id('33d001'),
        'REVERSAL', 'k33:x001', 'h33', now(), 'ONLINE', pg_temp.id('33aa01'), pg_temp.id('33fc001'),
        NULL),
       (pg_temp.id('33fe002'), pg_temp.id('33a001'), pg_temp.id('33cc001'), pg_temp.id('33d001'),
        'REVERSAL', 'k33:x002', 'h33', now(), 'ONLINE', pg_temp.id('33aa01'), pg_temp.id('33fc006'),
        pg_temp.id('33e001'));
SELECT pg_temp.a();
SELECT throws_ok($$SELECT pg_temp.att('33fe001', '33fb001',
                                                  'CUSTOMER_QR')$$,
  'CL001', NULL, 'attribution d''une annulation : canal différent de la vente refusé');
SELECT lives_ok($$SELECT pg_temp.att('33fe001', '33fb001', NULL)$$,
  'témoin : attribution d''une annulation sans canal');
SELECT is((SELECT channel FROM sale_attribution WHERE transaction_id = pg_temp.id('33fe001')),
  'NFC',
  'annulation : canal recopié de l''attribution de la vente annulée');
-- Annulation par un SUPERVISOR au terminal : la personne est le valideur de l'écriture.
SELECT throws_ok($$SELECT pg_temp.att('33fe002', '33fb001', NULL,
                                                  pg_temp.id('33e001'))$$,
  'CL001', NULL, 'annulation d''une vente sans attribution : canal requis');
SELECT throws_ok($$SELECT pg_temp.att('33fe002', '33fb001', 'NFC',
                                                  pg_temp.id('33e002'))$$,
  'CL001', NULL, 'annulation au terminal : personne autre que le valideur refusée');
SELECT lives_ok($$SELECT pg_temp.att('33fe002', '33fb001', 'NFC',
                                                 pg_temp.id('33e001'))$$,
  'témoin : annulation attribuée à la session et au SUPERVISOR valideur');
SELECT is((SELECT vendor_id::text || ' ' || actor_user_id::text FROM sale_attribution
            WHERE transaction_id = pg_temp.id('33fe002')),
  pg_temp.id('33fa001')::text || ' ' || pg_temp.id('33e001')::text,
  'annulation par un SUPERVISOR : vendeur de la session et valideur');

-- 2. assert_tap_payable (A1, A18) ----------------------------------------------------------------
SELECT throws_ok($$SELECT * FROM assert_tap_payable(9033002, pg_temp.id('33aa01'))$$, 'CL022', NULL,
  'tap_id : lecture d''un autre terminal refusée (CL022)');
SELECT throws_ok($$SELECT * FROM assert_tap_payable(9033003, pg_temp.id('33aa01'))$$, 'CL022', NULL,
  'tap_id : lecture déjà consommée par une écriture refusée (CL022)');
SELECT throws_ok($$SELECT * FROM assert_tap_payable(9033004, pg_temp.id('33aa01'))$$, 'CL022', NULL,
  'tap_id : lecture liée à une demande de rattachement refusée (CL022)');
SELECT throws_ok($$SELECT * FROM assert_tap_payable(9033005, pg_temp.id('33aa01'))$$, 'CL022', NULL,
  'tap_id : lecture hors tap_replay_window_seconds refusée (CL022)');
SELECT throws_ok($$SELECT * FROM assert_tap_payable(9033999, pg_temp.id('33aa01'))$$, 'CL022', NULL,
  'tap_id : lecture inconnue refusée (CL022)');
SELECT throws_ok($$SELECT * FROM assert_tap_payable(9033006, pg_temp.id('33aa01'))$$, 'CL038', NULL,
  'A1 : bracelet SUSPENDED payé par son tap_id refusé (CL038, MEDIA_BLOCKED)');
SELECT throws_ok($$SELECT * FROM assert_tap_payable(9033007, pg_temp.id('33aa01'))$$, 'CL038', NULL,
  'A1 : bracelet BLACKLISTED payé par son tap_id refusé (CL038, MEDIA_BLOCKED)');
SELECT pg_temp.b();
SELECT throws_ok($$SELECT * FROM assert_tap_payable(9033001, pg_temp.id('33aa01'))$$, 'CL022', NULL,
  'tap_id : lecture d''un autre prestataire inconnue (CL022)');
SELECT pg_temp.a();
SELECT is((SELECT media_id::text || ' ' || wallet_id::text
             FROM assert_tap_payable(9033001, pg_temp.id('33aa01'))),
  pg_temp.id('33ca001')::text || ' ' || pg_temp.id('33cb001')::text,
  'témoin : lecture récente de ce terminal, bracelet ACTIVE : bracelet et portefeuille rendus');

-- 3. assert_wallet_payable (A17) -----------------------------------------------------------------
SELECT throws_ok($$SELECT assert_wallet_payable(pg_temp.id('33cb002'))$$, 'CL039', NULL,
  'portefeuille BLOCKED refusé (CL039, WALLET_BLOCKED)');
SELECT throws_ok($$SELECT assert_wallet_payable(pg_temp.id('33cb003'))$$, 'CL039', NULL,
  'portefeuille CLOSED refusé (CL039, WALLET_BLOCKED)');
SELECT throws_ok($$SELECT assert_wallet_payable(pg_temp.id('33cb011'))$$, 'P0002', NULL,
  'portefeuille d''un autre prestataire : introuvable');
SELECT lives_ok($$SELECT assert_wallet_payable(pg_temp.id('33cb001'))$$,
  'témoin : portefeuille ACTIVE');

-- 4. consume_tap remplacée (A18) -----------------------------------------------------------------
SELECT throws_ok($$SELECT consume_tap(9033002, pg_temp.id('33fc001'))$$, 'CL022',
  'Passage 9033002 lu par un autre terminal que celui de l''écriture',
  'A18 : écriture d''un terminal sur une lecture d''un autre terminal refusée (CL022)');
SELECT is((SELECT transaction_id FROM media_tap WHERE id = 9033002), NULL::uuid,
  'A18 : la lecture refusée ne porte aucune écriture');
SELECT lives_ok($$SELECT consume_tap(9033008, pg_temp.id('33fc007'))$$,
  'témoin A18 : écriture du terminal aa02 sur une lecture de aa02 : consommée');
SELECT lives_ok($$SELECT consume_tap(9033009, pg_temp.id('33fc008'))$$,
  'écriture sans terminal : comportement inchangé (lecture consommée)');
-- Non-régression de 0024 / 0026.
SELECT lives_ok($$SELECT consume_tap(9033001, pg_temp.id('33fc001'))$$,
  'non-régression : lecture récente du même terminal consommée');
SELECT lives_ok($$SELECT consume_tap(9033001, pg_temp.id('33fc001'))$$,
  'non-régression : rejeu de la même écriture sans effet');
SELECT throws_ok($$SELECT consume_tap(9033001, pg_temp.id('33fc006'))$$, 'CL022',
  'Passage 9033001 déjà utilisé par une autre écriture',
  'non-régression : lecture déjà utilisée par une autre écriture refusée');
SELECT throws_ok($$SELECT consume_tap(9033004, pg_temp.id('33fc006'))$$, 'CL022',
  'Passage 9033004 déjà utilisé par une demande de rattachement',
  'non-régression OP-N50 : lecture liée à une demande refusée');
SELECT throws_ok($$SELECT consume_tap(9033005, pg_temp.id('33fc006'))$$, 'CL022',
  'Passage 9033005 expiré', 'non-régression : écriture en ligne hors fenêtre refusée');
SELECT throws_ok($$SELECT consume_tap(9033010, pg_temp.id('33fc009'))$$, 'CL001', NULL,
  'non-régression : lecture d''un autre bracelet que celui de l''écriture refusée');
SELECT pg_temp.b();
SELECT throws_ok($$SELECT consume_tap(9033010, pg_temp.id('33fc006'))$$, 'P0002', NULL,
  'non-régression : lecture d''un autre prestataire introuvable');
SELECT pg_temp.a();

-- 5. Annulation unique (A19, NFR-005) ------------------------------------------------------------
RESET app.operator_id;
SELECT throws_ok($$INSERT INTO journal_transaction (operator_id, ledger_id, event_id, type,
                     idempotency_key, request_hash, occurred_at, source, device_id, reverses_id)
                   VALUES (pg_temp.id('33a001'), pg_temp.id('33cc001'), pg_temp.id('33d001'),
                     'REVERSAL', 'k33:x006b', 'h33', now(), 'ONLINE', pg_temp.id('33aa01'),
                     pg_temp.id('33fd006'))$$,
  '23505', 'duplicate key value violates unique constraint "journal_transaction_reverses_once"',
  'NFR-005 : seconde annulation d''une vente refusée par journal_transaction_reverses_once');
SELECT pg_temp.a();

-- 6. assert_reversible (A5, A9 ; ADR-123) --------------------------------------------------------
-- Forme.
SELECT throws_ok($$SELECT * FROM assert_reversible(pg_temp.id('33fd001'), 'CASHIER',
                    pg_temp.id('33aa01'), pg_temp.id('33fb001'))$$, 'CL001', NULL,
  'mode inconnu refusé (CL001)');
SELECT throws_ok($$SELECT * FROM assert_reversible(pg_temp.id('33fd001'), 'VENDOR',
                    pg_temp.id('33aa01'), NULL)$$, 'CL001', NULL,
  'VENDOR sans session refusé (CL001)');
SELECT throws_ok($$SELECT * FROM assert_reversible(pg_temp.id('33fd001'), 'SUPERVISOR_DEVICE',
                    pg_temp.id('33aa01'), pg_temp.id('33fb001'))$$, 'CL001', NULL,
  'SUPERVISOR_DEVICE sans jeton refusé (CL001)');
SELECT throws_ok($$SELECT * FROM assert_reversible(pg_temp.id('33fd009'), 'BACKOFFICE',
                    pg_temp.id('33aa01'), NULL, NULL, pg_temp.id('33ce001'))$$, 'CL001', NULL,
  'BACKOFFICE avec terminal refusé (CL001)');
-- Contrôles communs.
SELECT pg_temp.b();
SELECT throws_ok($$SELECT * FROM assert_reversible(pg_temp.id('33fd001'), 'VENDOR',
                    pg_temp.id('33aa01'), pg_temp.id('33fb001'))$$, 'P0002', NULL,
  'vente d''un autre prestataire : introuvable (pas de fuite d''existence)');
SELECT pg_temp.a();
SELECT throws_ok($$SELECT * FROM assert_reversible(pg_temp.id('33fc004'), 'VENDOR',
                    pg_temp.id('33aa01'), pg_temp.id('33fb001'))$$, 'CL036', NULL,
  'écriture non PURCHASE refusée (CL036)');
SELECT throws_ok($$SELECT * FROM assert_reversible(pg_temp.id('33fd006'), 'VENDOR',
                    pg_temp.id('33aa01'), pg_temp.id('33fb001'))$$, 'CL035', NULL,
  'VENDOR : vente déjà annulée refusée (CL035)');
SELECT throws_ok($$SELECT * FROM assert_reversible(pg_temp.id('33fd007'), 'VENDOR',
                    pg_temp.id('33aa01'), pg_temp.id('33fb001'))$$, 'CL001', NULL,
  'événement RECONCILING : annulation refusée (CL001, matrice §12.1)');
-- VENDOR.
SELECT throws_ok($$SELECT * FROM assert_reversible(pg_temp.id('33fd002'), 'VENDOR',
                    pg_temp.id('33aa01'), pg_temp.id('33fb001'))$$, 'CL036', NULL,
  'VENDOR : vente d''un autre vendeur refusée (CL036)');
SELECT throws_ok($$SELECT * FROM assert_reversible(pg_temp.id('33fd003'), 'VENDOR',
                    pg_temp.id('33aa01'), pg_temp.id('33fb001'))$$, 'CL036', NULL,
  'VENDOR : vente d''un autre terminal refusée (CL036)');
SELECT throws_ok($$SELECT * FROM assert_reversible(pg_temp.id('33fd001'), 'VENDOR',
                    pg_temp.id('33aa01'), pg_temp.id('33fb004'))$$, 'CL036', NULL,
  'VENDOR : session close refusée (CL036)');
SELECT throws_ok($$SELECT * FROM assert_reversible(pg_temp.id('33fd001'), 'VENDOR',
                    pg_temp.id('33aa01'), pg_temp.id('33fb002'))$$, 'CL036', NULL,
  'VENDOR : session d''un autre terminal refusée (CL036)');
SELECT throws_ok($$SELECT * FROM assert_reversible(pg_temp.id('33fd004'), 'VENDOR',
                    pg_temp.id('33aa01'), pg_temp.id('33fb001'))$$, 'CL040', NULL,
  'ADR-123 : bon vendeur, bon terminal, hors fenêtre (recorded_at) : CL040');
SELECT throws_ok($$SELECT * FROM assert_reversible(pg_temp.id('33fd005'), 'VENDOR',
                    pg_temp.id('33aa01'), pg_temp.id('33fb001'))$$, 'CL036', NULL,
  'ADR-123 : autre vendeur hors fenêtre : CL036, jamais CL040');
SELECT is((SELECT ledger_id::text || ' ' || event_id::text || ' ' || wallet_id::text || ' '
                  || media_id::text
             FROM assert_reversible(pg_temp.id('33fd001'), 'VENDOR', pg_temp.id('33aa01'),
                                    pg_temp.id('33fb001'))),
  pg_temp.id('33cc001')::text || ' ' || pg_temp.id('33d001')::text || ' '
    || pg_temp.id('33cb001')::text || ' ' || pg_temp.id('33ca001')::text,
  'témoin VENDOR : dans la fenêtre ; grand livre, événement, portefeuille et bracelet rendus');
-- Vendeur bloqué après la vente : refusé (défense en profondeur).
RESET app.operator_id;
UPDATE vendor SET failed_attempts = 5, locked_at = now() WHERE id = pg_temp.id('33fa001');
SELECT pg_temp.a();
SELECT throws_ok($$SELECT * FROM assert_reversible(pg_temp.id('33fd001'), 'VENDOR',
                    pg_temp.id('33aa01'), pg_temp.id('33fb001'))$$, 'CL036', NULL,
  'VENDOR : vendeur bloqué refusé (CL036)');
RESET app.operator_id;
UPDATE vendor SET failed_attempts = 0, locked_at = NULL WHERE id = pg_temp.id('33fa001');
SELECT pg_temp.a();
-- Session expirée, jamais close (lot WP07, relecture WP04 constat 2 : mutant survivant de
-- `s.expires_at <= clock_timestamp()`) : même vente, même vendeur, même terminal que le témoin
-- ci-dessus ; seule l'échéance de la session change.
RESET app.operator_id;
-- (vendor_session_ttl : échéance = ouverture + 12 h ; les deux se déplacent ensemble.)
UPDATE vendor_session SET opened_at = now() - interval '12 hours 1 second',
                          expires_at = now() - interval '1 second'
 WHERE id = pg_temp.id('33fb001');
SELECT pg_temp.a();
SELECT throws_ok($$SELECT * FROM assert_reversible(pg_temp.id('33fd001'), 'VENDOR',
                    pg_temp.id('33aa01'), pg_temp.id('33fb001'))$$, 'CL036', NULL,
  'VENDOR : session expirée (expires_at dépassé, jamais close) refusée (CL036)');
RESET app.operator_id;
UPDATE vendor_session SET opened_at = now() - interval '1 hour',
                          expires_at = now() + interval '11 hours'
 WHERE id = pg_temp.id('33fb001');
SELECT pg_temp.a();
SELECT lives_ok($$SELECT * FROM assert_reversible(pg_temp.id('33fd001'), 'VENDOR',
                   pg_temp.id('33aa01'), pg_temp.id('33fb001'))$$,
  'témoin : la même session, échéance rendue, est acceptée');

-- SUPERVISOR_DEVICE : jetons consommés (insérés comme par l'API, dans cette transaction).
--   j1 : aa01/s001, vise r002, valideur e001 (SUPERVISOR de d001) ;
--   j2 : aa01/s001, vise r004, valideur e002 (SUPERVISOR de l'organisateur) ;
--   j3 : aa03/s003, vise r001, valideur e001 ;
--   j4 : aa01/s001, vise r002, consommé avant cette transaction ;
--   j5 : aa01/s001, vise r002, valideur e003 (sans rôle) ;
--   j6 : aa01/s001, vise r002, valideur e004 (SUPERVISOR d'un autre événement) ;
--   j7 : aa01/s001, vise r006 (déjà annulée), valideur e001 ;
--   j8 : aa01/s001, vise r002, valideur e005 (ORGANIZER_ADMIN de l'organisateur, pas SUPERVISOR) ;
--   j9 : aa01/s001, vise r002, valideur e006 (CASHIER de d001, pas SUPERVISOR).
INSERT INTO approval_token_use (jti, operator_id, operation_id, approver_id, caller_device_id,
                                caller_vendor_session_id, target_id, expires_at)
SELECT j, pg_temp.id('33a001'), 'reversePayment', pg_temp.id(a), pg_temp.id(d), pg_temp.id(s),
       pg_temp.id(t), clock_timestamp() + interval '2 minutes'
  FROM (VALUES ('j33-1', '33e001', '33aa01', '33fb001', '33fd002'),
               ('j33-2', '33e002', '33aa01', '33fb001', '33fd004'),
               ('j33-3', '33e001', '33aa03', '33fb003', '33fd001'),
               ('j33-5', '33e003', '33aa01', '33fb001', '33fd002'),
               ('j33-6', '33e004', '33aa01', '33fb001', '33fd002'),
               ('j33-7', '33e001', '33aa01', '33fb001', '33fd006'),
               ('j33-8', '33e005', '33aa01', '33fb001', '33fd002'),
               ('j33-9', '33e006', '33aa01', '33fb001', '33fd002')) AS x(j, a, d, s, t);
INSERT INTO approval_token_use (jti, operator_id, operation_id, approver_id, caller_device_id,
                                caller_vendor_session_id, target_id, used_at, expires_at)
VALUES ('j33-4', pg_temp.id('33a001'), 'reversePayment', pg_temp.id('33e001'), pg_temp.id('33aa01'),
        pg_temp.id('33fb001'), pg_temp.id('33fd002'), now() - interval '1 minute',
        now() + interval '1 minute');
SELECT lives_ok($$SELECT * FROM assert_reversible(pg_temp.id('33fd002'), 'SUPERVISOR_DEVICE',
                   pg_temp.id('33aa01'), pg_temp.id('33fb001'), 'j33-1')$$,
  'SUPERVISOR_DEVICE : vente d''un autre vendeur acceptée avec un jeton consommé pour elle');
SELECT lives_ok($$SELECT * FROM assert_reversible(pg_temp.id('33fd004'), 'SUPERVISOR_DEVICE',
                   pg_temp.id('33aa01'), pg_temp.id('33fb001'), 'j33-2')$$,
  'SUPERVISOR_DEVICE : vente hors fenêtre acceptée (jamais CL040)');
SELECT throws_ok($$SELECT * FROM assert_reversible(pg_temp.id('33fd001'), 'SUPERVISOR_DEVICE',
                    pg_temp.id('33aa03'), pg_temp.id('33fb003'), 'j33-3')$$, 'CL036', NULL,
  'SUPERVISOR_DEVICE : terminal d''un autre événement refusé, même avec un jeton (CL036)');
SELECT throws_ok($$SELECT * FROM assert_reversible(pg_temp.id('33fd004'), 'SUPERVISOR_DEVICE',
                    pg_temp.id('33aa01'), pg_temp.id('33fb001'), 'j33-1')$$, 'CL036', NULL,
  'SUPERVISOR_DEVICE : jeton consommé pour une autre vente refusé (CL036)');
SELECT throws_ok($$SELECT * FROM assert_reversible(pg_temp.id('33fd002'), 'SUPERVISOR_DEVICE',
                    pg_temp.id('33aa01'), pg_temp.id('33fb001'), 'j33-4')$$, 'CL036', NULL,
  'SUPERVISOR_DEVICE : jeton consommé avant cette transaction refusé (CL036)');
SELECT throws_ok($$SELECT * FROM assert_reversible(pg_temp.id('33fd002'), 'SUPERVISOR_DEVICE',
                    pg_temp.id('33aa01'), pg_temp.id('33fb001'), 'j33-5')$$, 'CL036', NULL,
  'SUPERVISOR_DEVICE : valideur sans rôle SUPERVISOR refusé (CL036)');
SELECT throws_ok($$SELECT * FROM assert_reversible(pg_temp.id('33fd002'), 'SUPERVISOR_DEVICE',
                    pg_temp.id('33aa01'), pg_temp.id('33fb001'), 'j33-6')$$, 'CL036', NULL,
  'SUPERVISOR_DEVICE : SUPERVISOR d''un autre événement refusé (CL036)');
-- Valideur qui a un autre rôle que SUPERVISOR sur la bonne portée (lot WP07, relecture WP04
-- constat 3 : mutant survivant du retrait de `r.role = 'SUPERVISOR'`).
SELECT throws_ok($$SELECT * FROM assert_reversible(pg_temp.id('33fd002'), 'SUPERVISOR_DEVICE',
                    pg_temp.id('33aa01'), pg_temp.id('33fb001'), 'j33-8')$$, 'CL036', NULL,
  'SUPERVISOR_DEVICE : valideur ORGANIZER_ADMIN de l''organisateur (pas SUPERVISOR) refusé '
  || '(CL036)');
SELECT throws_ok($$SELECT * FROM assert_reversible(pg_temp.id('33fd002'), 'SUPERVISOR_DEVICE',
                    pg_temp.id('33aa01'), pg_temp.id('33fb001'), 'j33-9')$$, 'CL036', NULL,
  'SUPERVISOR_DEVICE : valideur CASHIER de l''événement (pas SUPERVISOR) refusé (CL036)');
SELECT throws_ok($$SELECT * FROM assert_reversible(pg_temp.id('33fd002'), 'SUPERVISOR_DEVICE',
                    pg_temp.id('33aa01'), pg_temp.id('33fb001'), 'j33-0')$$, 'CL036', NULL,
  'SUPERVISOR_DEVICE : jeton inconnu refusé (CL036)');
SELECT throws_ok($$SELECT * FROM assert_reversible(pg_temp.id('33fd002'), 'SUPERVISOR_DEVICE',
                    pg_temp.id('33aa02'), pg_temp.id('33fb002'), 'j33-1')$$, 'CL036', NULL,
  'SUPERVISOR_DEVICE : jeton consommé par un autre terminal refusé (CL036)');
SELECT throws_ok($$SELECT * FROM assert_reversible(pg_temp.id('33fd006'), 'SUPERVISOR_DEVICE',
                    pg_temp.id('33aa01'), pg_temp.id('33fb001'), 'j33-7')$$, 'CL035', NULL,
  'SUPERVISOR_DEVICE : vente déjà annulée refusée (CL035)');
SELECT throws_ok($$SELECT * FROM assert_reversible(pg_temp.id('33fd007'), 'SUPERVISOR_DEVICE',
                    pg_temp.id('33aa01'), pg_temp.id('33fb001'), 'j33-1')$$, 'CL001', NULL,
  'SUPERVISOR_DEVICE : événement RECONCILING refusé (CL001)');

-- BACKOFFICE : q001 approuvée pour r009 (auteur e005 ORGANIZER_ADMIN, valideur e001) ; q002 en
-- attente pour r009 ; q003 approuvée pour r002 ; q004 approuvée pour r009, valideur e003 sans rôle.
INSERT INTO approval_request (id, operator_id, action, target_id, payload, requested_by)
SELECT pg_temp.id(q), pg_temp.id('33a001'), 'SALE_REVERSAL', pg_temp.id(t),
       jsonb_build_object('transaction_id', pg_temp.id(t), 'reason', 'CUSTOMER_REQUEST',
                          'scope_type', 'EVENT', 'scope_id', pg_temp.id('33d001')),
       pg_temp.id('33e005')
  FROM (VALUES ('33ce001', '33fd009'), ('33ce002', '33fd009'), ('33ce003', '33fd002'),
               ('33ce004', '33fd009')) AS x(q, t);
SELECT is((SELECT count(*)::int FROM (
             SELECT decide_approval_request(pg_temp.id(q), pg_temp.id(a), true) AS r
               FROM (VALUES ('33ce001', '33e001'), ('33ce003', '33e001'),
                            ('33ce004', '33e003')) AS x(q, a)) d
            WHERE (d.r).status = 'APPROVED'), 3,
  'préparation : q001, q003, q004 approuvées par une seconde personne (decide_approval_request)');
SELECT lives_ok($$SELECT * FROM assert_reversible(pg_temp.id('33fd009'), 'BACKOFFICE', NULL, NULL,
                   NULL, pg_temp.id('33ce001'))$$,
  'BACKOFFICE : demande SALE_REVERSAL approuvée à deux pour cette vente : acceptée');
SELECT throws_ok($$SELECT * FROM assert_reversible(pg_temp.id('33fd009'), 'BACKOFFICE', NULL, NULL,
                    NULL, pg_temp.id('33ce002'))$$, 'CL036', NULL,
  'BACKOFFICE : demande non approuvée refusée (CL036)');
SELECT throws_ok($$SELECT * FROM assert_reversible(pg_temp.id('33fd009'), 'BACKOFFICE', NULL, NULL,
                    NULL, pg_temp.id('33ce003'))$$, 'CL036', NULL,
  'BACKOFFICE : demande approuvée pour une autre vente refusée (CL036)');
SELECT throws_ok($$SELECT * FROM assert_reversible(pg_temp.id('33fd009'), 'BACKOFFICE', NULL, NULL,
                    NULL, pg_temp.id('33ce004'))$$, 'CL036', NULL,
  'BACKOFFICE : valideur sans rôle sur l''événement refusé (CL036)');
SELECT throws_ok($$SELECT * FROM assert_reversible(pg_temp.id('33fd006'), 'BACKOFFICE', NULL, NULL,
                    NULL, pg_temp.id('33ce001'))$$, 'CL035', NULL,
  'BACKOFFICE : vente déjà annulée refusée (CL035)');

-- 7. approval_token_use : appelant terminal ------------------------------------------------------
SELECT throws_ok($$INSERT INTO approval_token_use (jti, operator_id, operation_id, approver_id,
                     caller_device_id, expires_at)
                   VALUES ('j33-a', pg_temp.id('33a001'), 'reversePayment', pg_temp.id('33e001'),
                     pg_temp.id('33aa01'), clock_timestamp() + interval '1 minute')$$,
  '23514', NULL, 'appelant terminal sans session refusé (approval_token_use_one_caller)');
SELECT throws_ok($$INSERT INTO approval_token_use (jti, operator_id, operation_id, approver_id,
                     caller_id, caller_device_id, caller_vendor_session_id, expires_at)
                   VALUES ('j33-b', pg_temp.id('33a001'), 'reversePayment', pg_temp.id('33e001'),
                     pg_temp.id('33e002'), pg_temp.id('33aa01'), pg_temp.id('33fb001'),
                     clock_timestamp() + interval '1 minute')$$,
  '23514', NULL, 'deux appelants (personne et terminal) refusés (approval_token_use_one_caller)');
SELECT throws_ok($$INSERT INTO approval_token_use (jti, operator_id, operation_id, approver_id,
                     expires_at)
                   VALUES ('j33-c', pg_temp.id('33a001'), 'reversePayment', pg_temp.id('33e001'),
                     clock_timestamp() + interval '1 minute')$$,
  '23514', NULL, 'aucun appelant refusé (approval_token_use_one_caller)');
SELECT throws_ok($$INSERT INTO approval_token_use (jti, operator_id, operation_id, approver_id,
                     caller_device_id, caller_vendor_session_id, expires_at)
                   VALUES ('j33-d', pg_temp.id('33a001'), 'reversePayment', pg_temp.id('33e001'),
                     pg_temp.id('33aa01'), pg_temp.id('33fb002'),
                     clock_timestamp() + interval '1 minute')$$,
  '23503', NULL, 'session d''un autre terminal que l''appelant refusée (clé composite)');
SELECT throws_ok($$INSERT INTO approval_token_use (jti, operator_id, operation_id, approver_id,
                     caller_device_id, caller_vendor_session_id, expires_at)
                   VALUES ('j33-e', pg_temp.id('33a001'), 'reversePayment', pg_temp.id('33e001'),
                     pg_temp.id('33ab01'), pg_temp.id('33fb011'),
                     clock_timestamp() + interval '1 minute')$$,
  '23503', NULL, 'terminal et session d''un autre prestataire refusés (clé composite)');
SELECT throws_ok($$INSERT INTO approval_token_use (jti, operator_id, operation_id, approver_id,
                     caller_id, expires_at)
                   VALUES ('j33-f', pg_temp.id('33a001'), 'cashDueRefund', pg_temp.id('33e001'),
                     pg_temp.id('33e001'), clock_timestamp() + interval '1 minute')$$,
  '23514', NULL, 'appelant personne : valideur = appelant toujours refusé (distinct_people)');
SELECT lives_ok($$INSERT INTO approval_token_use (jti, operator_id, operation_id, approver_id,
                    caller_id, expires_at)
                  VALUES ('j33-g', pg_temp.id('33a001'), 'cashDueRefund', pg_temp.id('33e001'),
                    pg_temp.id('33e002'), clock_timestamp() + interval '1 minute')$$,
  'témoin : appelant personne distinct du valideur inchangé');
SELECT throws_ok($$INSERT INTO approval_token_use (jti, operator_id, operation_id, approver_id,
                    caller_device_id, caller_vendor_session_id, expires_at)
                  VALUES ('j33-1', pg_temp.id('33a001'), 'reversePayment', pg_temp.id('33e001'),
                    pg_temp.id('33aa01'), pg_temp.id('33fb001'),
                    clock_timestamp() + interval '1 minute')$$,
  '23505', NULL, 'usage unique : même jti refusé');
SELECT throws_ok($$UPDATE approval_token_use SET target_id = pg_temp.id('33fd001')
                    WHERE jti = 'j33-1'$$,
  'CL001', NULL, 'approval_token_use en ajout seul : modification refusée (cible comprise)');
-- Action SALE_REVERSAL acceptée (ci-dessus), action inconnue refusée.
SELECT throws_ok($$INSERT INTO approval_request (operator_id, action, target_id, payload,
                     requested_by)
                   VALUES (pg_temp.id('33a001'), 'SALE_REFUND', pg_temp.id('33fd009'), '{}',
                     pg_temp.id('33e005'))$$,
  '23514', NULL, 'action inconnue refusée (approval_request_action_check)');
SELECT is((SELECT count(*)::int FROM approval_request WHERE action = 'SALE_REVERSAL'
             AND operator_id = pg_temp.id('33a001')), 4,
  'témoin : demandes SALE_REVERSAL acceptées');

SELECT * FROM finish();
ROLLBACK;
