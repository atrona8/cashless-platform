-- Demandes de paiement QR (migration 0034 ; mission terminaux-paiement-en-ligne, lot WP05) —
-- pgTAP, écrit à la main (pas un fichier généré).
-- Lancer : pg_prove -d <base> tests/tests_payment_requests.sql (base créée par les migrations,
-- roles.sql et post-roles.sql rejoués).
-- Rôle propriétaire avec `app.operator_id` posé (accords de WP07 absents). Prestataires A et B.
-- Chaque refus a son témoin qui passe. Tous les refus CL037 sont comparés au MÊME message
-- (throws_ok avec message exact). Une seule session : la concurrence (NFR-005, vingt paiements
-- simultanés d'un jeton) est laissée aux tests Jest de WP13 et WP14 ; ici, la seconde
-- confirmation d'une même demande est refusée.
\set ON_ERROR_STOP 1
\set QUIET 1
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

-- Identifiants : pg_temp.id('34a001') = '00000000-0000-0000-0000-00000034a001'.
CREATE FUNCTION pg_temp.id(p text) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT ('00000000-0000-0000-0000-' || lpad(p, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.a() RETURNS void LANGUAGE sql AS
  $$ SELECT set_config('app.operator_id', pg_temp.id('34a001')::text, true) $$;
CREATE FUNCTION pg_temp.b() RETURNS void LANGUAGE sql AS
  $$ SELECT set_config('app.operator_id', pg_temp.id('34a002')::text, true) $$;
-- Empreinte d'un jeton (l'API calcule sha256 ; le jeton n'arrive jamais en base).
CREATE FUNCTION pg_temp.h(p text) RETURNS bytea LANGUAGE sql IMMUTABLE AS
  $$ SELECT sha256(convert_to(p, 'UTF8')) $$;
-- Le message unique des refus CL037.
CREATE FUNCTION pg_temp.m() RETURNS text LANGUAGE sql IMMUTABLE AS
  $$ SELECT 'Demande de paiement indisponible'::text $$;
-- Lignes : une ligne de l'article i001 (500) en quantité q.
CREATE FUNCTION pg_temp.lines(q int) RETURNS jsonb LANGUAGE sql IMMUTABLE AS
  $$ SELECT jsonb_build_array(jsonb_build_object(
       'product_id', '00000000-0000-0000-0000-000000349001', 'quantity', q, 'unit_price', 500)) $$;
-- Création commerçant avec des identifiants courts.
CREATE FUNCTION pg_temp.cm(p_device text, p_session text, p_amount bigint, p_token text,
                           p_key text, p_lines jsonb, p_currency char(3) DEFAULT 'XOF',
                           p_ttl int DEFAULT 60, p_version int DEFAULT NULL)
  RETURNS uuid LANGUAGE sql AS
  $$ SELECT payment_request_id FROM create_merchant_payment_request(pg_temp.id(p_device),
       pg_temp.id(p_session), p_amount, p_currency, p_ttl, pg_temp.h(p_token), p_key, p_lines,
       p_version) $$;
-- Vente PURCHASE écrite par le propriétaire (le moteur n'est pas appelé par SQL) : débit du compte
-- de portefeuille `p_wal_account`, crédit du commerçant ; postings non équilibrés validés jamais
-- (ROLLBACK final).
CREATE FUNCTION pg_temp.sale(p_tx text, p_ledger text, p_event text, p_device text, p_key text,
                             p_wal_account text, p_amount bigint, p_type text DEFAULT 'PURCHASE',
                             p_source text DEFAULT 'ONLINE')
  RETURNS uuid LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO journal_transaction (id, operator_id, ledger_id, event_id, type, idempotency_key,
                                   request_hash, occurred_at, source, device_id, created_by,
                                   approved_by)
  VALUES (pg_temp.id(p_tx), pg_temp.id('34a001'), pg_temp.id(p_ledger), pg_temp.id(p_event),
          p_type, p_key, 'h34', now(), p_source, pg_temp.id(p_device),
          CASE WHEN p_source = 'BACKOFFICE' THEN pg_temp.id('34e001') END,
          CASE WHEN p_source = 'BACKOFFICE' THEN pg_temp.id('34e002') END);
  INSERT INTO posting (operator_id, ledger_id, transaction_id, line_no, account_id, amount)
  VALUES (pg_temp.id('34a001'), pg_temp.id(p_ledger), pg_temp.id(p_tx), 1,
          pg_temp.id(p_wal_account), p_amount),
         (pg_temp.id('34a001'), pg_temp.id(p_ledger), pg_temp.id(p_tx), 2,
          pg_temp.id(CASE p_ledger WHEN '34cc002' THEN '34cd092' ELSE '34cd091' END), -p_amount);
  RETURN pg_temp.id(p_tx);
END $$;

-- Données (propriétaire) ------------------------------------------------------------------------
-- A : organisateur b001 ; événements d001 (LIVE), d002 (LIVE), d003 (DRAFT) ; commerçant M1
-- (b101) ; points de vente f101 (d001), f102 (d002), f103 (d003) ; festivaliers c201, c202.
-- B : organisateur b011, événement d011 (LIVE), commerçant MB (b111), point de vente f111,
-- festivalier c211.
INSERT INTO party (id, kind, legal_name, country_code) VALUES
 (pg_temp.id('34a001'), 'OPERATOR', 'Prestataire A', 'SN'),
 (pg_temp.id('34a002'), 'OPERATOR', 'Prestataire B', 'CI');
INSERT INTO party (id, kind, operator_id, legal_name) VALUES
 (pg_temp.id('34b001'), 'ORGANIZER', pg_temp.id('34a001'), 'Organisateur A'),
 (pg_temp.id('34b011'), 'ORGANIZER', pg_temp.id('34a002'), 'Organisateur B'),
 (pg_temp.id('34b101'), 'MERCHANT', pg_temp.id('34a001'), 'Commerçant M1'),
 (pg_temp.id('34b111'), 'MERCHANT', pg_temp.id('34a002'), 'Commerçant MB'),
 (pg_temp.id('34c201'), 'CUSTOMER', pg_temp.id('34a001'), 'Festivalier 1'),
 (pg_temp.id('34c202'), 'CUSTOMER', pg_temp.id('34a001'), 'Festivalier 2'),
 (pg_temp.id('34c211'), 'CUSTOMER', pg_temp.id('34a002'), 'Festivalier B');
INSERT INTO jurisdiction_profile (id, country_code, version, valid_from, breakage_destination)
VALUES (pg_temp.id('34c001'), 'SN', 340034, '2026-01-01', 'ORGANIZER');
INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone, jurisdiction_id,
                   funds_holder, status) VALUES
 (pg_temp.id('34d001'), pg_temp.id('34a001'), pg_temp.id('34b001'), 'Événement A1', 'XOF',
  'Africa/Dakar', pg_temp.id('34c001'), 'ORGANIZER', 'LIVE'),
 (pg_temp.id('34d002'), pg_temp.id('34a001'), pg_temp.id('34b001'), 'Événement A2', 'XOF',
  'Africa/Dakar', pg_temp.id('34c001'), 'ORGANIZER', 'LIVE'),
 (pg_temp.id('34d003'), pg_temp.id('34a001'), pg_temp.id('34b001'), 'Événement A3', 'XOF',
  'Africa/Dakar', pg_temp.id('34c001'), 'ORGANIZER', 'DRAFT'),
 (pg_temp.id('34d011'), pg_temp.id('34a002'), pg_temp.id('34b011'), 'Événement B', 'XOF',
  'Africa/Dakar', pg_temp.id('34c001'), 'ORGANIZER', 'LIVE');
INSERT INTO merchant_participation (id, operator_id, event_id, merchant_id, link_type,
                                    payout_to) VALUES
 (pg_temp.id('34f001'), pg_temp.id('34a001'), pg_temp.id('34d001'), pg_temp.id('34b101'),
  'INTERNAL', pg_temp.id('34b001')),
 (pg_temp.id('34f002'), pg_temp.id('34a001'), pg_temp.id('34d002'), pg_temp.id('34b101'),
  'INTERNAL', pg_temp.id('34b001')),
 (pg_temp.id('34f003'), pg_temp.id('34a001'), pg_temp.id('34d003'), pg_temp.id('34b101'),
  'INTERNAL', pg_temp.id('34b001')),
 (pg_temp.id('34f011'), pg_temp.id('34a002'), pg_temp.id('34d011'), pg_temp.id('34b111'),
  'INTERNAL', pg_temp.id('34b011'));
INSERT INTO point_of_sale (id, operator_id, participation_id, name) VALUES
 (pg_temp.id('34f101'), pg_temp.id('34a001'), pg_temp.id('34f001'), 'Bar A1'),
 (pg_temp.id('34f102'), pg_temp.id('34a001'), pg_temp.id('34f002'), 'Bar A2'),
 (pg_temp.id('34f103'), pg_temp.id('34a001'), pg_temp.id('34f003'), 'Bar A3'),
 (pg_temp.id('34f111'), pg_temp.id('34a002'), pg_temp.id('34f011'), 'Bar B');
INSERT INTO app_user (id, operator_id, issuer, subject, email, display_name)
SELECT pg_temp.id(u), pg_temp.id(o), 'https://idp.test', 's0034' || u, u || '@test',
       'Personne ' || u
  FROM (VALUES ('34e001', '34a001'), ('34e002', '34a001'), ('34e011', '34a002')) AS v(u, o);
-- Terminaux de A : aa01 CATALOG_POS (d001) ; aa02 KEYPAD_TPE (d001) ; aa03 TOPUP_DESK (d001) ;
-- aa04 suspendu ; aa05 révoqué ; aa06 caisse de d003 (DRAFT) ; aa07 caisse de d002 ; aa08
-- KEYPAD_TPE (d001, terminal suspendu plus tard). B : ab01 caisse de d011.
INSERT INTO device (id, operator_id, kind, app_mode, event_id, pos_id, serial, status) VALUES
 (pg_temp.id('34aa01'), pg_temp.id('34a001'), 'POS', 'CATALOG_POS', pg_temp.id('34d001'),
  pg_temp.id('34f101'), 'P34-AA01', 'ACTIVE'),
 (pg_temp.id('34aa02'), pg_temp.id('34a001'), 'POS', 'KEYPAD_TPE', pg_temp.id('34d001'),
  pg_temp.id('34f101'), 'P34-AA02', 'ACTIVE'),
 (pg_temp.id('34aa03'), pg_temp.id('34a001'), 'TOPUP', 'TOPUP_DESK', pg_temp.id('34d001'),
  NULL, 'P34-AA03', 'ACTIVE'),
 (pg_temp.id('34aa04'), pg_temp.id('34a001'), 'POS', 'CATALOG_POS', pg_temp.id('34d001'),
  pg_temp.id('34f101'), 'P34-AA04', 'SUSPENDED'),
 (pg_temp.id('34aa05'), pg_temp.id('34a001'), 'POS', 'CATALOG_POS', pg_temp.id('34d001'),
  pg_temp.id('34f101'), 'P34-AA05', 'REVOKED'),
 (pg_temp.id('34aa06'), pg_temp.id('34a001'), 'POS', 'KEYPAD_TPE', pg_temp.id('34d003'),
  pg_temp.id('34f103'), 'P34-AA06', 'ACTIVE'),
 (pg_temp.id('34aa07'), pg_temp.id('34a001'), 'POS', 'KEYPAD_TPE', pg_temp.id('34d002'),
  pg_temp.id('34f102'), 'P34-AA07', 'ACTIVE'),
 (pg_temp.id('34aa08'), pg_temp.id('34a001'), 'POS', 'KEYPAD_TPE', pg_temp.id('34d001'),
  pg_temp.id('34f101'), 'P34-AA08', 'ACTIVE'),
 (pg_temp.id('34ab01'), pg_temp.id('34a002'), 'POS', 'KEYPAD_TPE', pg_temp.id('34d011'),
  pg_temp.id('34f111'), 'P34-AB01', 'ACTIVE');
-- Vendeurs : v001, v002 de M1 ; v011 de MB.
INSERT INTO vendor (id, operator_id, merchant_id, display_name, pin_hash, created_by) VALUES
 (pg_temp.id('34fa001'), pg_temp.id('34a001'), pg_temp.id('34b101'), 'Vendeur 1',
  '$argon2id$v=19$m=19456,t=2,p=1$c2VsMDAzNA$djE', pg_temp.id('34e001')),
 (pg_temp.id('34fa002'), pg_temp.id('34a001'), pg_temp.id('34b101'), 'Vendeur 2',
  '$argon2id$v=19$m=19456,t=2,p=1$c2VsMDAzNA$djI', pg_temp.id('34e001')),
 (pg_temp.id('34fa011'), pg_temp.id('34a002'), pg_temp.id('34b111'), 'Vendeur B',
  '$argon2id$v=19$m=19456,t=2,p=1$c2VsMDAzNA$dkI', pg_temp.id('34e011'));
-- Sessions ouvertes : s001 (v001, aa01), s002 (v001, aa02), s006 (v001, aa06), s007 (v001, aa07),
-- s008 (v002, aa08), s011 (v011, ab01) ; s009 (v002, aa01, close).
INSERT INTO vendor_session (id, operator_id, vendor_id, device_id, opened_at, expires_at, closed_at,
                            closed_reason)
SELECT pg_temp.id(s), pg_temp.id(o), pg_temp.id(v), pg_temp.id(d), now() - interval '1 hour',
       now() + interval '11 hours',
       CASE WHEN closed THEN now() - interval '1 minute' END,
       CASE WHEN closed THEN 'LOGOUT' END
  FROM (VALUES ('34fb001', '34a001', '34fa001', '34aa01', false),
               ('34fb002', '34a001', '34fa001', '34aa02', false),
               ('34fb006', '34a001', '34fa001', '34aa06', false),
               ('34fb007', '34a001', '34fa001', '34aa07', false),
               ('34fb008', '34a001', '34fa002', '34aa08', false),
               ('34fb009', '34a001', '34fa002', '34aa01', true),
               ('34fb011', '34a002', '34fa011', '34ab01', false))
       AS x(s, o, v, d, closed);
-- Catalogue de f101 : article i001 à 500, version 1.
INSERT INTO catalog_category (id, operator_id, pos_id, label_fr, label_en, position) VALUES
 (pg_temp.id('348001'), pg_temp.id('34a001'), pg_temp.id('34f101'), 'Boissons', 'Drinks', 0);
INSERT INTO catalog_item (id, operator_id, pos_id, category_id, label_fr, label_en, unit_price,
                          vat_rate_bps) VALUES
 (pg_temp.id('349001'), pg_temp.id('34a001'), pg_temp.id('34f101'), pg_temp.id('348001'),
  'Eau', 'Water', 500, 1800);
INSERT INTO catalog_version (operator_id, pos_id, version, created_by) VALUES
 (pg_temp.id('34a001'), pg_temp.id('34f101'), 1, pg_temp.id('34e001'));
INSERT INTO catalog_version_item (operator_id, pos_id, version, item_id, category_id, label_fr,
                                  label_en, category_label_fr, category_label_en,
                                  category_position, unit_price, vat_rate_bps) VALUES
 (pg_temp.id('34a001'), pg_temp.id('34f101'), 1, pg_temp.id('349001'), pg_temp.id('348001'),
  'Eau', 'Water', 'Boissons', 'Drinks', 0, 500, 1800);
-- Grands livres : A l001 (EVENT d001), l002 (ORGANIZER b001), l003 (EVENT d002) ; B l011.
INSERT INTO ledger (id, operator_id, scope_type, scope_id, currency, issuer_id,
                    funds_holder_id) VALUES
 (pg_temp.id('34cc001'), pg_temp.id('34a001'), 'EVENT', pg_temp.id('34d001'), 'XOF',
  pg_temp.id('34b001'), pg_temp.id('34b001')),
 (pg_temp.id('34cc002'), pg_temp.id('34a001'), 'ORGANIZER', pg_temp.id('34b001'), 'XOF',
  pg_temp.id('34b001'), pg_temp.id('34b001')),
 (pg_temp.id('34cc003'), pg_temp.id('34a001'), 'EVENT', pg_temp.id('34d002'), 'XOF',
  pg_temp.id('34b001'), pg_temp.id('34b001')),
 (pg_temp.id('34cc011'), pg_temp.id('34a002'), 'EVENT', pg_temp.id('34d011'), 'XOF',
  pg_temp.id('34b011'), pg_temp.id('34b011'));
-- Portefeuilles : w001 (c201, l001) ; w002 (c201, l001, BLOCKED) ; w003 (c202, l001) ; w004 (c201,
-- l002 ORGANIZER) ; w005 (c201, l003, événement d002) ; w006 (c201, l001, bloqué plus tard) ;
-- w011 (c211, B).
INSERT INTO wallet (id, operator_id, ledger_id, customer_id, status) VALUES
 (pg_temp.id('34cb001'), pg_temp.id('34a001'), pg_temp.id('34cc001'), pg_temp.id('34c201'),
  'ACTIVE'),
 (pg_temp.id('34cb002'), pg_temp.id('34a001'), pg_temp.id('34cc001'), pg_temp.id('34c201'),
  'BLOCKED'),
 (pg_temp.id('34cb003'), pg_temp.id('34a001'), pg_temp.id('34cc001'), pg_temp.id('34c202'),
  'ACTIVE'),
 (pg_temp.id('34cb004'), pg_temp.id('34a001'), pg_temp.id('34cc002'), pg_temp.id('34c201'),
  'ACTIVE'),
 (pg_temp.id('34cb005'), pg_temp.id('34a001'), pg_temp.id('34cc003'), pg_temp.id('34c201'),
  'ACTIVE'),
 (pg_temp.id('34cb006'), pg_temp.id('34a001'), pg_temp.id('34cc001'), pg_temp.id('34c201'),
  'ACTIVE'),
 (pg_temp.id('34cb011'), pg_temp.id('34a002'), pg_temp.id('34cc011'), pg_temp.id('34c211'),
  'ACTIVE');
-- Comptes : WALLET_PAID de w001 (cd001), w003 (cd003), w004 (cd004, l002), WALLET_PROMO de w001
-- (cd011) ; MERCHANT de l001 (cd091) et de l002 (cd092).
INSERT INTO account (id, operator_id, ledger_id, code, family, purpose, wallet_id,
                     normal_side) VALUES
 (pg_temp.id('34cd001'), pg_temp.id('34a001'), pg_temp.id('34cc001'), 'K34-W1', 'CLAIM',
  'WALLET_PAID', pg_temp.id('34cb001'), 'C'),
 (pg_temp.id('34cd011'), pg_temp.id('34a001'), pg_temp.id('34cc001'), 'K34-W1P', 'CLAIM',
  'WALLET_PROMO', pg_temp.id('34cb001'), 'C'),
 (pg_temp.id('34cd003'), pg_temp.id('34a001'), pg_temp.id('34cc001'), 'K34-W3', 'CLAIM',
  'WALLET_PAID', pg_temp.id('34cb003'), 'C'),
 (pg_temp.id('34cd004'), pg_temp.id('34a001'), pg_temp.id('34cc002'), 'K34-W4', 'CLAIM',
  'WALLET_PAID', pg_temp.id('34cb004'), 'C'),
 (pg_temp.id('34cd091'), pg_temp.id('34a001'), pg_temp.id('34cc001'), 'K34-M1', 'CLAIM',
  'MERCHANT', NULL, 'C'),
 (pg_temp.id('34cd092'), pg_temp.id('34a001'), pg_temp.id('34cc002'), 'K34-M2', 'CLAIM',
  'MERCHANT', NULL, 'C');

-- 0. Forme ---------------------------------------------------------------------------------------
SELECT is((SELECT count(*)::int FROM pg_proc p
            WHERE p.pronamespace = 'public'::regnamespace
              AND p.proname IN ('create_merchant_payment_request','create_customer_qr_token',
                                'lock_payment_request_for_pay','lock_customer_qr_token',
                                'confirm_payment_request','cancel_payment_request',
                                'payment_request_for_token')
              AND p.prosecdef AND p.proconfig = ARRAY['search_path=public, pg_temp']
              AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl,
                                acldefault('f', p.proowner))) a WHERE a.grantee = 0)), 7,
  'sept fonctions de 0034 : SECURITY DEFINER, search_path = public, pg_temp, aucun droit PUBLIC');
SELECT is((SELECT count(*)::int FROM pg_proc p
            WHERE p.pronamespace = 'public'::regnamespace
              AND p.proname IN ('create_merchant_payment_request','create_customer_qr_token',
                                'lock_payment_request_for_pay','lock_customer_qr_token',
                                'confirm_payment_request','cancel_payment_request',
                                'payment_request_for_token')), 7,
  'une seule signature par fonction');
-- payment_request_for_token lit clock_timestamp() (volatile) : aucune des sept n'est STABLE.
SELECT is((SELECT count(*)::int FROM pg_proc p
            WHERE p.pronamespace = 'public'::regnamespace
              AND p.proname IN ('create_merchant_payment_request','create_customer_qr_token',
                                'lock_payment_request_for_pay','lock_customer_qr_token',
                                'confirm_payment_request','cancel_payment_request',
                                'payment_request_for_token')
              AND p.provolatile = 'v'), 7,
  'sept fonctions VOLATILE (clock_timestamp() n''est pas STABLE)');
-- Aucun paramètre texte ne porte un jeton : l'empreinte est le seul secret reçu (bytea).
SELECT is((SELECT count(*)::int FROM pg_proc p, unnest(p.proargnames) n
            WHERE p.pronamespace = 'public'::regnamespace
              AND p.proname IN ('create_merchant_payment_request','create_customer_qr_token',
                                'lock_payment_request_for_pay','lock_customer_qr_token',
                                'confirm_payment_request','cancel_payment_request',
                                'payment_request_for_token')
              AND (n LIKE '%token%' OR n = 'p_nonce')), 0,
  'aucun paramètre nommé jeton (seul p_nonce_hash est reçu)');
SELECT is((SELECT relrowsecurity AND relforcerowsecurity FROM pg_class
            WHERE oid = 'payment_request_detail'::regclass), true,
  'payment_request_detail : RLS activée et forcée');
SELECT is((SELECT count(*)::int FROM pg_attribute
            WHERE attrelid = 'payment_request'::regclass AND attnum > 0 AND NOT attisdropped),
  12, 'payment_request inchangée : douze colonnes du schéma de référence');

-- 1. Création commerçant (FR-018) ----------------------------------------------------------------
SELECT pg_temp.a();
SELECT throws_ok($$SELECT pg_temp.cm('34aa04', '34fb001', 500, 'tok-x1', 'k:x1',
                     pg_temp.lines(1))$$, 'CL030', NULL, 'terminal suspendu refusé (CL030)');
SELECT throws_ok($$SELECT pg_temp.cm('34aa05', '34fb001', 500, 'tok-x2', 'k:x2',
                     pg_temp.lines(1))$$, '42501', NULL, 'terminal révoqué refusé (42501)');
SELECT throws_ok($$SELECT pg_temp.cm('34aa03', '34fb001', 500, 'tok-x3', 'k:x3', NULL)$$,
  'CL001', NULL, 'terminal TOPUP_DESK refusé (CL001)');
SELECT throws_ok($$SELECT pg_temp.cm('34aa06', '34fb006', 500, 'tok-x4', 'k:x4', NULL)$$,
  'CL001', NULL, 'événement non LIVE refusé (CL001)');
SELECT throws_ok($$SELECT pg_temp.cm('34aa02', '34fb001', 500, 'tok-x5', 'k:x5', NULL)$$,
  'CL032', NULL, 'session d''un autre terminal refusée (CL032)');
SELECT throws_ok($$SELECT pg_temp.cm('34aa01', '34fb009', 500, 'tok-x6', 'k:x6',
                     pg_temp.lines(1))$$, 'CL032', NULL, 'session close refusée (CL032)');
SELECT throws_ok($$SELECT pg_temp.cm('34aa02', '34fb002', 0, 'tok-x7', 'k:x7', NULL)$$,
  'CL001', NULL, 'montant nul refusé (CL001)');
SELECT throws_ok($$SELECT pg_temp.cm('34aa02', '34fb002', 500, 'tok-x8', 'k:x8', NULL, 'EUR')$$,
  'CL001', NULL, 'devise différente de l''événement refusée (CL001)');
SELECT throws_ok($$SELECT pg_temp.cm('34aa02', '34fb002', 500, 'tok-x9', 'k:x9', NULL, 'XOF',
                     14)$$, 'CL001', NULL, 'durée de 14 s refusée (CL001)');
SELECT throws_ok($$SELECT pg_temp.cm('34aa02', '34fb002', 500, 'tok-x10', 'k:x10', NULL, 'XOF',
                     301)$$, 'CL001', NULL, 'durée de 301 s refusée (CL001)');
SELECT throws_ok($$SELECT payment_request_id FROM create_merchant_payment_request(
                     pg_temp.id('34aa02'), pg_temp.id('34fb002'), 500, 'XOF', 60,
                     substring(pg_temp.h('tok-x11') FROM 1 FOR 31), 'k:x11', NULL, NULL)$$,
  'CL001', NULL, 'empreinte de 31 octets refusée (CL001)');
SELECT throws_ok($$SELECT pg_temp.cm('34aa02', '34fb002', 500, 'tok-x12', 'k:x12',
                     pg_temp.lines(1))$$, 'CL001', NULL, 'lignes en KEYPAD_TPE refusées (CL001)');
SELECT throws_ok($$SELECT pg_temp.cm('34aa02', '34fb002', 500, 'tok-x13', 'k:x13', NULL, 'XOF',
                     60, 1)$$, 'CL001', NULL, 'version de catalogue en KEYPAD_TPE refusée (CL001)');
SELECT throws_ok($$SELECT pg_temp.cm('34aa01', '34fb001', 500, 'tok-x14', 'k:x14', NULL)$$,
  'CL001', NULL, 'CATALOG_POS sans lignes refusé (CL001)');
SELECT throws_ok($$SELECT pg_temp.cm('34aa01', '34fb001', 600, 'tok-x15', 'k:x15',
                     pg_temp.lines(1))$$, 'CL034', NULL,
  'lignes dont la somme diffère du montant refusées (check_sale_lines, CL034)');
SELECT throws_ok($$SELECT pg_temp.cm('34aa01', '34fb001', 500, 'tok-x16', '', pg_temp.lines(1))$$,
  'CL001', NULL, 'clé de vente vide refusée (CL001)');
SELECT is((SELECT count(*)::int FROM payment_request), 0, 'aucune demande écrite par les refus');
-- Témoins.
SELECT lives_ok($$SELECT pg_temp.cm('34aa01', '34fb001', 1000, 'tok-m1', 'P34-AA01:101',
                    pg_temp.lines(2), 'XOF', 60, 7)$$,
  'témoin CATALOG_POS : lignes contrôlées, demande créée');
SELECT lives_ok($$SELECT pg_temp.cm('34aa02', '34fb002', 700, 'tok-m2', 'P34-AA02:201', NULL,
                    'XOF', 15)$$, 'témoin KEYPAD_TPE : sans lignes, durée de 15 s');
SELECT lives_ok($$SELECT pg_temp.cm('34aa02', '34fb002', 700, 'tok-m3', 'P34-AA02:202', NULL,
                    'XOF', 300)$$, 'témoin : durée de 300 s');
SELECT ok((SELECT direction = 'MERCHANT_QR' AND status = 'PENDING' AND amount = 1000
                  AND currency = 'XOF' AND device_id = pg_temp.id('34aa01')
                  AND event_id = pg_temp.id('34d001') AND wallet_id IS NULL
                  AND transaction_id IS NULL
                  AND expires_at BETWEEN clock_timestamp() + interval '50 seconds'
                                     AND clock_timestamp() + interval '61 seconds'
             FROM payment_request WHERE nonce_hash = pg_temp.h('tok-m1')),
  'demande commerçant : MERCHANT_QR, PENDING, montant, terminal, événement, 60 s (heure base)');
SELECT ok((SELECT expires_at <= clock_timestamp() + interval '15 seconds'
             FROM payment_request WHERE nonce_hash = pg_temp.h('tok-m2')),
  'durée de 15 s respectée');
SELECT ok((SELECT d.vendor_session_id = pg_temp.id('34fb001')
                  AND d.idempotency_key = 'P34-AA01:101' AND d.lines = pg_temp.lines(2)
                  AND d.catalog_version = 1 AND d.operator_id = pg_temp.id('34a001')
             FROM payment_request p JOIN payment_request_detail d ON d.payment_request_id = p.id
            WHERE p.nonce_hash = pg_temp.h('tok-m1')),
  'détail : session, clé, lignes, version RETENUE par la base (1, non la 7 reçue)');
SELECT ok((SELECT d.lines IS NULL AND d.catalog_version IS NULL
             FROM payment_request p JOIN payment_request_detail d ON d.payment_request_id = p.id
            WHERE p.nonce_hash = pg_temp.h('tok-m2')), 'détail KEYPAD_TPE : ni lignes ni version');
SELECT is((SELECT count(*)::int FROM payment_request p
            WHERE NOT EXISTS (SELECT 1 FROM payment_request_detail d
                               WHERE d.payment_request_id = p.id)), 0,
  'une ligne de détail par demande commerçant');
-- Doublons.
SELECT throws_ok($$SELECT pg_temp.cm('34aa02', '34fb002', 700, 'tok-m2', 'P34-AA02:203', NULL)$$,
  '23505', NULL, 'empreinte déjà prise : 23505 (jamais un succès)');
SELECT throws_ok($$SELECT pg_temp.cm('34aa02', '34fb002', 700, 'tok-m4', 'P34-AA02:201', NULL)$$,
  '23505', NULL, 'clé de vente déjà prise chez le prestataire : 23505');
-- Jeton jamais en base : seule l'empreinte (32 octets).
SELECT is((SELECT count(*)::int FROM payment_request p
            WHERE row_to_json(p)::text LIKE '%tok-m%'), 0, 'aucune colonne ne contient le jeton');
SELECT is((SELECT count(*)::int FROM payment_request_detail d
            WHERE row_to_json(d)::text LIKE '%tok-m%'), 0, 'détail : aucun jeton');
SELECT is((SELECT count(*)::int FROM payment_request WHERE octet_length(nonce_hash) <> 32), 0,
  'empreintes de 32 octets seulement');
-- Détail en ajout seul.
SELECT throws_ok($$UPDATE payment_request_detail SET idempotency_key = 'autre'$$, NULL, NULL,
  'détail en ajout seul : modification refusée');
SELECT throws_ok($$DELETE FROM payment_request_detail$$, NULL, NULL,
  'détail en ajout seul : suppression refusée');

-- 2. QR client (FR-019, A25) ---------------------------------------------------------------------
CREATE FUNCTION pg_temp.cq(p_customer text, p_wallet text, p_token text) RETURNS uuid
  LANGUAGE sql AS
  $$ SELECT payment_request_id FROM create_customer_qr_token(pg_temp.id(p_customer),
       pg_temp.id(p_wallet), pg_temp.h(p_token)) $$;
SELECT throws_ok($$SELECT pg_temp.cq('34c202', '34cb001', 'tok-y1')$$, 'CL037', pg_temp.m(),
  'portefeuille d''un autre festivalier refusé (CL037)');
SELECT throws_ok($$SELECT pg_temp.cq('34c201', '34cb002', 'tok-y2')$$, 'CL037', pg_temp.m(),
  'portefeuille bloqué refusé (CL037)');
SELECT throws_ok($$SELECT pg_temp.cq('34c211', '34cb011', 'tok-y3')$$, 'CL037', pg_temp.m(),
  'portefeuille d''un autre prestataire refusé (CL037)');
SELECT throws_ok($$SELECT pg_temp.cq('34c201', '34cb004', 'tok-y4')$$, 'CL001', NULL,
  'grand livre de portée ORGANIZER refusé (CL001, arbitrage)');
SELECT throws_ok($$SELECT payment_request_id FROM create_customer_qr_token(pg_temp.id('34c201'),
                     pg_temp.id('34cb001'), '\x00'::bytea)$$, 'CL001', NULL,
  'empreinte mal formée refusée (CL001)');
SELECT lives_ok($$SELECT pg_temp.cq('34c201', '34cb001', 'tok-c1')$$, 'témoin : QR client créé');
SELECT ok((SELECT direction = 'CUSTOMER_QR' AND status = 'PENDING' AND amount IS NULL
                  AND device_id IS NULL AND wallet_id = pg_temp.id('34cb001')
                  AND event_id = pg_temp.id('34d001') AND currency = 'XOF'
                  AND expires_at BETWEEN clock_timestamp() + interval '55 seconds'
                                     AND clock_timestamp() + interval '61 seconds'
             FROM payment_request WHERE nonce_hash = pg_temp.h('tok-c1')),
  'QR client : événement du grand livre (A25), montant et terminal nuls, 60 s');
SELECT lives_ok($$SELECT pg_temp.cq('34c201', '34cb005', 'tok-c5')$$,
  'témoin : QR client sur le grand livre de d002');
SELECT is((SELECT event_id FROM payment_request WHERE nonce_hash = pg_temp.h('tok-c5')),
  pg_temp.id('34d002'), 'QR client : événement = scope_id du grand livre');
SELECT lives_ok($$SELECT pg_temp.cq('34c201', '34cb001', 'tok-c2')$$,
  'second QR client PENDING du même portefeuille : le premier n''est pas annulé');
SELECT is((SELECT status FROM payment_request WHERE nonce_hash = pg_temp.h('tok-c1')), 'PENDING',
  'premier QR client toujours PENDING');
SELECT throws_ok($$SELECT pg_temp.cq('34c201', '34cb001', 'tok-c1')$$, '23505', NULL,
  'QR client : empreinte déjà prise, 23505');
SELECT is((SELECT detail FROM (SELECT count(*)::int AS detail FROM payment_request_detail d
            JOIN payment_request p ON p.id = d.payment_request_id
           WHERE p.direction = 'CUSTOMER_QR') x), 0, 'QR client : aucune ligne de détail');

-- 3. Verrouillage côté festivalier ---------------------------------------------------------------
CREATE FUNCTION pg_temp.req(p_token text) RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT id FROM payment_request WHERE nonce_hash = pg_temp.h(p_token) $$;
CREATE FUNCTION pg_temp.lk(p_id uuid, p_token text, p_wallet text, p_customer text)
  RETURNS SETOF record LANGUAGE sql AS
  $$ SELECT x.device_id, x.vendor_session_id, x.vendor_id, x.event_id, x.ledger_id, x.amount,
            x.currency, x.idempotency_key, x.lines, x.catalog_version
       FROM lock_payment_request_for_pay(p_id, pg_temp.h(p_token), pg_temp.id(p_wallet),
                                         pg_temp.id(p_customer)) x $$;
-- Session expirée (heure de la base) ou rendue à son état initial (ouverte il y a 1 h).
CREATE FUNCTION pg_temp.expire_session(p_session text) RETURNS void LANGUAGE sql AS
  $$ UPDATE vendor_session SET (opened_at, expires_at) = (SELECT t - interval '12 hours', t
                                 FROM (SELECT clock_timestamp() - interval '1 second' AS t) x)
      WHERE id = pg_temp.id(p_session) $$;
CREATE FUNCTION pg_temp.renew_session(p_session text) RETURNS void LANGUAGE sql AS
  $$ UPDATE vendor_session SET opened_at = now() - interval '1 hour',
                               expires_at = now() + interval '11 hours', closed_at = NULL,
                               closed_reason = NULL
      WHERE id = pg_temp.id(p_session) $$;
-- Demandes : m5 (aa02, payée plus tard), m6 (aa02, annulée), m7 (aa02, expirée), m8 (aa07,
-- événement d002), m9 (aa08 : terminal suspendu ensuite), m10 (aa08 : session close ensuite...),
-- m11 (aa02, portefeuille bloqué).
SELECT pg_temp.cm('34aa02', '34fb002', 700, 'tok-m5', 'P34-AA02:205', NULL);
SELECT pg_temp.cm('34aa02', '34fb002', 700, 'tok-m6', 'P34-AA02:206', NULL);
SELECT pg_temp.cm('34aa02', '34fb002', 700, 'tok-m7', 'P34-AA02:207', NULL);
SELECT pg_temp.cm('34aa07', '34fb007', 700, 'tok-m8', 'P34-AA07:208', NULL);
SELECT pg_temp.cm('34aa08', '34fb008', 700, 'tok-m9', 'P34-AA08:209', NULL);
UPDATE payment_request SET expires_at = clock_timestamp() - interval '1 second'
 WHERE id = pg_temp.req('tok-m7');
UPDATE payment_request SET status = 'CANCELLED' WHERE id = pg_temp.req('tok-m6');
UPDATE payment_request SET status = 'CONFIRMED' WHERE id = pg_temp.req('tok-m5');
SELECT throws_ok($$SELECT pg_temp.lk(pg_temp.req('tok-m2'), 'tok-mauvais', '34cb001', '34c201')$$,
  'CL037', pg_temp.m(), 'verrouillage : mauvais jeton (CL037)');
SELECT throws_ok($$SELECT pg_temp.lk(pg_temp.id('34ffff'), 'tok-m2', '34cb001', '34c201')$$,
  'CL037', pg_temp.m(), 'verrouillage : demande inconnue (CL037)');
SELECT throws_ok($$SELECT pg_temp.lk(pg_temp.req('tok-m7'), 'tok-m7', '34cb001', '34c201')$$,
  'CL037', pg_temp.m(), 'verrouillage : demande expirée (CL037)');
SELECT throws_ok($$SELECT pg_temp.lk(pg_temp.req('tok-m5'), 'tok-m5', '34cb001', '34c201')$$,
  'CL037', pg_temp.m(), 'verrouillage : demande payée (CL037)');
SELECT throws_ok($$SELECT pg_temp.lk(pg_temp.req('tok-m6'), 'tok-m6', '34cb001', '34c201')$$,
  'CL037', pg_temp.m(), 'verrouillage : demande annulée (CL037)');
SELECT throws_ok($$SELECT pg_temp.lk(pg_temp.req('tok-m8'), 'tok-m8', '34cb001', '34c201')$$,
  'CL037', pg_temp.m(), 'verrouillage : portefeuille d''un autre événement (CL037)');
SELECT throws_ok($$SELECT pg_temp.lk(pg_temp.req('tok-m2'), 'tok-m2', '34cb002', '34c201')$$,
  'CL037', pg_temp.m(), 'verrouillage : portefeuille bloqué (CL037)');
SELECT throws_ok($$SELECT pg_temp.lk(pg_temp.req('tok-m2'), 'tok-m2', '34cb003', '34c201')$$,
  'CL037', pg_temp.m(), 'verrouillage : portefeuille d''un autre festivalier (CL037)');
SELECT throws_ok($$SELECT pg_temp.lk(pg_temp.req('tok-c1'), 'tok-c1', '34cb001', '34c201')$$,
  'CL037', pg_temp.m(), 'verrouillage : QR client présenté comme QR commerçant (CL037)');
-- Terminal suspendu (relu sous verrou) ; session close.
UPDATE device SET status = 'SUSPENDED' WHERE id = pg_temp.id('34aa08');
SELECT throws_ok($$SELECT pg_temp.lk(pg_temp.req('tok-m9'), 'tok-m9', '34cb001', '34c201')$$,
  'CL037', pg_temp.m(), 'verrouillage : terminal suspendu, non révélé (CL037)');
UPDATE device SET status = 'ACTIVE' WHERE id = pg_temp.id('34aa08');
SELECT lives_ok($$SELECT pg_temp.lk(pg_temp.req('tok-m9'), 'tok-m9', '34cb001', '34c201')$$,
  'témoin : terminal de nouveau ACTIVE, verrouillage accepté');
UPDATE vendor_session SET closed_at = now(), closed_reason = 'LOGOUT'
 WHERE id = pg_temp.id('34fb008');
SELECT throws_ok($$SELECT pg_temp.lk(pg_temp.req('tok-m9'), 'tok-m9', '34cb001', '34c201')$$,
  'CL037', pg_temp.m(), 'verrouillage : session close (CL037)');
-- Les cas suivants partent d'une session rouverte (témoin), pour que seul le contrôle nommé refuse.
SELECT pg_temp.renew_session('34fb008');
SELECT lives_ok($$SELECT pg_temp.lk(pg_temp.req('tok-m9'), 'tok-m9', '34cb001', '34c201')$$,
  'témoin : session rouverte, verrouillage accepté');
SELECT pg_temp.expire_session('34fb008');
SELECT ok((SELECT closed_at IS NULL FROM vendor_session WHERE id = pg_temp.id('34fb008')),
  'session expirée mais non close (seule l''expiration la rend invalide)');
SELECT throws_ok($$SELECT pg_temp.lk(pg_temp.req('tok-m9'), 'tok-m9', '34cb001', '34c201')$$,
  'CL037', pg_temp.m(), 'verrouillage : session expirée, non close (CL037)');
SELECT pg_temp.renew_session('34fb008');
UPDATE vendor SET status = 'DISABLED' WHERE id = pg_temp.id('34fa002');
SELECT throws_ok($$SELECT pg_temp.lk(pg_temp.req('tok-m9'), 'tok-m9', '34cb001', '34c201')$$,
  'CL037', pg_temp.m(), 'verrouillage : vendeur désactivé, session ouverte (CL037)');
UPDATE vendor SET status = 'ACTIVE' WHERE id = pg_temp.id('34fa002');
SELECT lives_ok($$SELECT pg_temp.lk(pg_temp.req('tok-m9'), 'tok-m9', '34cb001', '34c201')$$,
  'témoin : vendeur de nouveau ACTIVE, verrouillage accepté');
UPDATE vendor SET failed_attempts = 5, locked_at = now() WHERE id = pg_temp.id('34fa002');
SELECT throws_ok($$SELECT pg_temp.lk(pg_temp.req('tok-m9'), 'tok-m9', '34cb001', '34c201')$$,
  'CL037', pg_temp.m(), 'verrouillage : vendeur bloqué (PIN), ACTIVE, session ouverte (CL037)');
UPDATE vendor SET failed_attempts = 0, locked_at = NULL WHERE id = pg_temp.id('34fa002');
SELECT lives_ok($$SELECT pg_temp.lk(pg_temp.req('tok-m9'), 'tok-m9', '34cb001', '34c201')$$,
  'témoin : vendeur débloqué, verrouillage accepté');
-- Portefeuille bloqué après création (w006).
UPDATE wallet SET status = 'BLOCKED' WHERE id = pg_temp.id('34cb006');
SELECT throws_ok($$SELECT pg_temp.lk(pg_temp.req('tok-m2'), 'tok-m2', '34cb006', '34c201')$$,
  'CL037', pg_temp.m(), 'verrouillage : portefeuille bloqué ensuite (CL037)');
-- Témoins : portefeuille du grand livre de l'événement (EVENT) et de l'organisateur (ORGANIZER).
SELECT results_eq($$SELECT * FROM pg_temp.lk(pg_temp.req('tok-m2'), 'tok-m2', '34cb001', '34c201')
                      AS (device_id uuid, vendor_session_id uuid, vendor_id uuid, event_id uuid,
                          ledger_id uuid, amount bigint, currency char(3), idempotency_key text,
                          lines jsonb, catalog_version int)$$,
  $$VALUES (pg_temp.id('34aa02'), pg_temp.id('34fb002'), pg_temp.id('34fa001'),
            pg_temp.id('34d001'), pg_temp.id('34cc001'), 700::bigint, 'XOF'::char(3),
            'P34-AA02:201', NULL::jsonb, NULL::int)$$,
  'témoin : verrouillage rend terminal, session, vendeur, événement, grand livre, montant, clé');
SELECT is((SELECT wallet_id FROM payment_request WHERE id = pg_temp.req('tok-m2')),
  pg_temp.id('34cb001'), 'verrouillage : portefeuille posé dans la demande');
-- Portefeuille w007 du grand livre EUR de d001 (cc004) : même festivalier, même événement, ACTIVE ;
-- seule la devise diffère de la demande (XOF).
INSERT INTO ledger (id, operator_id, scope_type, scope_id, currency, issuer_id,
                    funds_holder_id) VALUES
 (pg_temp.id('34cc004'), pg_temp.id('34a001'), 'EVENT', pg_temp.id('34d001'), 'EUR',
  pg_temp.id('34b001'), pg_temp.id('34b001'));
INSERT INTO wallet (id, operator_id, ledger_id, customer_id, status) VALUES
 (pg_temp.id('34cb007'), pg_temp.id('34a001'), pg_temp.id('34cc004'), pg_temp.id('34c201'),
  'ACTIVE');
SELECT throws_ok($$SELECT pg_temp.lk(pg_temp.req('tok-m3'), 'tok-m3', '34cb007', '34c201')$$,
  'CL037', pg_temp.m(), 'verrouillage : portefeuille d''une autre devise (EUR) refusé (CL037)');
SELECT lives_ok($$SELECT pg_temp.lk(pg_temp.req('tok-m3'), 'tok-m3', '34cb004', '34c201')$$,
  'témoin : portefeuille du grand livre ORGANIZER de l''organisateur de l''événement');
SELECT ok((SELECT x.lines = pg_temp.lines(2) AND x.catalog_version = 1
             FROM lock_payment_request_for_pay(pg_temp.req('tok-m1'), pg_temp.h('tok-m1'),
                    pg_temp.id('34cb001'), pg_temp.id('34c201')) x),
  'témoin CATALOG_POS : lignes et version rendues');

-- 4. Confirmation (A10) --------------------------------------------------------------------------
-- Chaque refus porte sur sa propre demande (aa02, 700 XOF, clé = 'Q:' || jeton, verrouillée par
-- w001) et une vente qui ne diffère que d'un attribut (la clé d'une vente est unique par grand
-- livre).
CREATE FUNCTION pg_temp.cf(p_token text, p_tx text, p_hash_token text DEFAULT NULL)
  RETURNS void LANGUAGE sql AS
  $$ SELECT confirm_payment_request(pg_temp.req(p_token), pg_temp.id(p_tx),
       pg_temp.h(coalesce(p_hash_token, p_token))) $$;
CREATE FUNCTION pg_temp.mk(p_token text, p_lock boolean DEFAULT true) RETURNS void
  LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp.cm('34aa02', '34fb002', 700, p_token, 'Q:' || p_token, NULL);
  IF p_lock THEN
    PERFORM pg_temp.lk(pg_temp.req(p_token), p_token, '34cb001', '34c201');
  END IF;
END $$;
SELECT pg_temp.mk('tok-q1');
SELECT pg_temp.sale('34fc001', '34cc001', '34d001', '34aa02', 'Q:tok-q1', '34cd001', 600);
SELECT throws_ok($$SELECT pg_temp.cf('tok-q1', '34fc001')$$, 'CL037', pg_temp.m(),
  'confirmation : montant différent refusé');
SELECT pg_temp.mk('tok-q2');
SELECT pg_temp.sale('34fc002', '34cc001', '34d001', '34aa02', 'Q:tok-q2-autre', '34cd001', 700);
SELECT throws_ok($$SELECT pg_temp.cf('tok-q2', '34fc002')$$, 'CL037', pg_temp.m(),
  'confirmation : clé différente refusée');
SELECT pg_temp.mk('tok-q3');
SELECT pg_temp.sale('34fc003', '34cc001', '34d001', '34aa01', 'Q:tok-q3', '34cd001', 700);
SELECT throws_ok($$SELECT pg_temp.cf('tok-q3', '34fc003')$$, 'CL037', pg_temp.m(),
  'confirmation : terminal différent refusé');
SELECT pg_temp.mk('tok-q4');
SELECT pg_temp.sale('34fc004', '34cc001', '34d001', '34aa02', 'Q:tok-q4', '34cd003', 700);
SELECT throws_ok($$SELECT pg_temp.cf('tok-q4', '34fc004')$$, 'CL037', pg_temp.m(),
  'confirmation : autre portefeuille débité refusé');
SELECT pg_temp.mk('tok-q5');
SELECT pg_temp.sale('34fc005', '34cc001', '34d001', '34aa02', 'Q:tok-q5', '34cd001', 700,
                    'TOPUP');
SELECT throws_ok($$SELECT pg_temp.cf('tok-q5', '34fc005')$$, 'CL037', pg_temp.m(),
  'confirmation : type différent (TOPUP) refusé');
SELECT pg_temp.mk('tok-q6');
SELECT pg_temp.sale('34fc006', '34cc001', '34d001', '34aa02', 'Q:tok-q6', '34cd001', 700,
                    'PURCHASE', 'BACKOFFICE');
SELECT throws_ok($$SELECT pg_temp.cf('tok-q6', '34fc006')$$, 'CL037', pg_temp.m(),
  'confirmation : source autre que ONLINE refusée');
SELECT pg_temp.mk('tok-q7');
SELECT pg_temp.sale('34fc007', '34cc001', '34d002', '34aa02', 'Q:tok-q7', '34cd001', 700);
SELECT throws_ok($$SELECT pg_temp.cf('tok-q7', '34fc007')$$, 'CL037', pg_temp.m(),
  'confirmation : événement de la vente différent refusé');
SELECT throws_ok($$SELECT pg_temp.cf('tok-q7', '34fcfff')$$, 'CL037', pg_temp.m(),
  'confirmation : vente inconnue refusée');
-- Demande jamais verrouillée (aucun portefeuille posé) : refusée, puis témoin après verrouillage.
SELECT pg_temp.mk('tok-q8', false);
SELECT pg_temp.sale('34fc008', '34cc001', '34d001', '34aa02', 'Q:tok-q8', '34cd001', 700);
SELECT throws_ok($$SELECT pg_temp.cf('tok-q8', '34fc008')$$, 'CL037', pg_temp.m(),
  'confirmation sans verrouillage préalable refusée');
SELECT pg_temp.lk(pg_temp.req('tok-q8'), 'tok-q8', '34cb001', '34c201');
SELECT throws_ok($$SELECT pg_temp.cf('tok-q8', '34fc008', 'tok-mauvais')$$, 'CL037', pg_temp.m(),
  'confirmation : mauvais jeton refusé');
SELECT throws_ok($$SELECT pg_temp.cf('tok-q1', '34fc008')$$, 'CL037', pg_temp.m(),
  'confirmation : vente d''une autre demande refusée');
SELECT is((SELECT status FROM payment_request WHERE id = pg_temp.req('tok-q8')), 'PENDING',
  'refus : demande toujours PENDING');
SELECT lives_ok($$SELECT pg_temp.cf('tok-q8', '34fc008')$$, 'témoin : vente exacte confirmée');
SELECT ok((SELECT status = 'CONFIRMED' AND transaction_id = pg_temp.id('34fc008')
                  AND wallet_id = pg_temp.id('34cb001') AND amount = 700
             FROM payment_request WHERE id = pg_temp.req('tok-q8')),
  'demande CONFIRMED, transaction_id posé');
SELECT ok((SELECT channel = 'MERCHANT_QR' AND vendor_id = pg_temp.id('34fa001')
                  AND vendor_session_id = pg_temp.id('34fb002') AND device_id = pg_temp.id('34aa02')
             FROM sale_attribution WHERE transaction_id = pg_temp.id('34fc008')),
  'attribution MERCHANT_QR par la session de la demande');
SELECT throws_ok($$SELECT pg_temp.cf('tok-q8', '34fc008')$$, 'CL037', pg_temp.m(),
  'seconde confirmation de la même demande refusée');
SELECT throws_ok($$SELECT pg_temp.lk(pg_temp.req('tok-q8'), 'tok-q8', '34cb001', '34c201')$$,
  'CL037', pg_temp.m(), 'jeton à usage unique : verrouillage après paiement refusé');
-- Montant réparti entre WALLET_PAID et WALLET_PROMO du même portefeuille : accepté.
SELECT pg_temp.mk('tok-q9');
INSERT INTO journal_transaction (id, operator_id, ledger_id, event_id, type, idempotency_key,
                                 request_hash, occurred_at, source, device_id)
VALUES (pg_temp.id('34fc009'), pg_temp.id('34a001'), pg_temp.id('34cc001'), pg_temp.id('34d001'),
        'PURCHASE', 'Q:tok-q9', 'h34', now(), 'ONLINE', pg_temp.id('34aa02'));
INSERT INTO posting (operator_id, ledger_id, transaction_id, line_no, account_id, amount)
SELECT pg_temp.id('34a001'), pg_temp.id('34cc001'), pg_temp.id('34fc009'), n, pg_temp.id(k), amt
  FROM (VALUES (1, '34cd001', 400), (2, '34cd011', 300), (3, '34cd091', -700)) AS x(n, k, amt);
SELECT lives_ok($$SELECT pg_temp.cf('tok-q9', '34fc009')$$,
  'témoin : débit réparti entre WALLET_PAID et WALLET_PROMO du portefeuille accepté');
-- Bon montant sur le portefeuille, mais un autre portefeuille aussi débité : refusé.
SELECT pg_temp.mk('tok-q11');
INSERT INTO journal_transaction (id, operator_id, ledger_id, event_id, type, idempotency_key,
                                 request_hash, occurred_at, source, device_id)
VALUES (pg_temp.id('34fc013'), pg_temp.id('34a001'), pg_temp.id('34cc001'), pg_temp.id('34d001'),
        'PURCHASE', 'Q:tok-q11', 'h34', now(), 'ONLINE', pg_temp.id('34aa02'));
INSERT INTO posting (operator_id, ledger_id, transaction_id, line_no, account_id, amount)
SELECT pg_temp.id('34a001'), pg_temp.id('34cc001'), pg_temp.id('34fc013'), n, pg_temp.id(k), amt
  FROM (VALUES (1, '34cd001', 700), (2, '34cd003', 100), (3, '34cd091', -800)) AS x(n, k, amt);
SELECT throws_ok($$SELECT pg_temp.cf('tok-q11', '34fc013')$$, 'CL037', pg_temp.m(),
  'confirmation : un autre portefeuille débité en plus refusé');
-- Demande expirée entre le verrouillage et la confirmation.
SELECT pg_temp.mk('tok-q10');
UPDATE payment_request SET expires_at = clock_timestamp() - interval '1 second'
 WHERE id = pg_temp.req('tok-q10');
SELECT pg_temp.sale('34fc010', '34cc001', '34d001', '34aa02', 'Q:tok-q10', '34cd001', 700);
SELECT throws_ok($$SELECT pg_temp.cf('tok-q10', '34fc010')$$, 'CL037', pg_temp.m(),
  'confirmation : demande expirée refusée');
-- Session de la demande close entre le verrouillage et la confirmation (aa01, s001, m1 verrouillée
-- par w001 ci-dessus) : refusée.
SELECT pg_temp.sale('34fc012', '34cc001', '34d001', '34aa01', 'P34-AA01:101', '34cd001', 1000);
UPDATE vendor_session SET closed_at = now(), closed_reason = 'LOGOUT'
 WHERE id = pg_temp.id('34fb001');
SELECT throws_ok($$SELECT pg_temp.cf('tok-m1', '34fc012')$$, 'CL037', pg_temp.m(),
  'confirmation : session de la demande close refusée');
UPDATE vendor_session SET closed_at = NULL, closed_reason = NULL WHERE id = pg_temp.id('34fb001');
SELECT pg_temp.expire_session('34fb001');
SELECT throws_ok($$SELECT pg_temp.cf('tok-m1', '34fc012')$$, 'CL037', pg_temp.m(),
  'confirmation : session de la demande expirée, non close, refusée');
SELECT pg_temp.renew_session('34fb001');
SELECT lives_ok($$SELECT pg_temp.cf('tok-m1', '34fc012')$$,
  'témoin CATALOG_POS : confirmation avec la session ouverte');
-- Session de la demande déplacée sur un autre terminal entre la création et la confirmation : un
-- terminal aa09 (KEYPAD_TPE, d001) et sa session s010 (v001), sans attribution, pour que la session
-- puisse changer de terminal (aa03, sans session ouverte) ; refusée, puis témoin une fois la
-- session rendue à aa09.
INSERT INTO device (id, operator_id, kind, app_mode, event_id, pos_id, serial, status) VALUES
 (pg_temp.id('34aa09'), pg_temp.id('34a001'), 'POS', 'KEYPAD_TPE', pg_temp.id('34d001'),
  pg_temp.id('34f101'), 'P34-AA09', 'ACTIVE');
INSERT INTO vendor_session (id, operator_id, vendor_id, device_id, opened_at, expires_at)
VALUES (pg_temp.id('34fb010'), pg_temp.id('34a001'), pg_temp.id('34fa001'), pg_temp.id('34aa09'),
        now() - interval '1 hour', now() + interval '11 hours');
SELECT pg_temp.cm('34aa09', '34fb010', 700, 'tok-q14', 'Q:tok-q14', NULL);
SELECT pg_temp.lk(pg_temp.req('tok-q14'), 'tok-q14', '34cb001', '34c201');
SELECT pg_temp.sale('34fc014', '34cc001', '34d001', '34aa09', 'Q:tok-q14', '34cd001', 700);
UPDATE vendor_session SET device_id = pg_temp.id('34aa03') WHERE id = pg_temp.id('34fb010');
SELECT throws_ok($$SELECT pg_temp.cf('tok-q14', '34fc014')$$, 'CL037', pg_temp.m(),
  'confirmation : session de la demande sur un autre terminal refusée');
UPDATE vendor_session SET device_id = pg_temp.id('34aa09') WHERE id = pg_temp.id('34fb010');
SELECT lives_ok($$SELECT pg_temp.cf('tok-q14', '34fc014')$$,
  'témoin : session rendue au terminal de la demande, confirmation acceptée');

-- 5. QR client au terminal ------------------------------------------------------------------------
CREATE FUNCTION pg_temp.lq(p_token text, p_device text) RETURNS uuid LANGUAGE sql AS
  $$ SELECT wallet_id FROM lock_customer_qr_token(pg_temp.h(p_token), pg_temp.id(p_device)) $$;
SELECT throws_ok($$SELECT pg_temp.lq('tok-inconnu', '34aa01')$$, 'CL037', pg_temp.m(),
  'QR client : jeton inconnu (CL037)');
SELECT throws_ok($$SELECT pg_temp.lq('tok-c1', '34aa07')$$, 'CL037', pg_temp.m(),
  'QR client : terminal d''un autre événement (CL037)');
SELECT throws_ok($$SELECT pg_temp.lq('tok-m1', '34aa01')$$, 'CL037', pg_temp.m(),
  'QR client : demande commerçant déjà payée présentée comme QR client (CL037)');
-- Demande commerçant PENDING, non expirée, de d001, wallet_id posé par le verrouillage : seul le
-- contrôle `direction` la refuse.
SELECT pg_temp.mk('tok-q12');
SELECT ok((SELECT direction = 'MERCHANT_QR' AND status = 'PENDING'
                  AND wallet_id = pg_temp.id('34cb001') AND event_id = pg_temp.id('34d001')
                  AND expires_at > clock_timestamp()
             FROM payment_request WHERE id = pg_temp.req('tok-q12')),
  'demande commerçant PENDING, portefeuille posé, événement du terminal aa01');
SELECT throws_ok($$SELECT pg_temp.lq('tok-q12', '34aa01')$$, 'CL037', pg_temp.m(),
  'QR client : demande commerçant PENDING avec portefeuille posé refusée (CL037)');
SELECT pg_temp.cq('34c201', '34cb001', 'tok-c3');
UPDATE payment_request SET expires_at = clock_timestamp() - interval '1 second'
 WHERE id = pg_temp.req('tok-c3');
SELECT throws_ok($$SELECT pg_temp.lq('tok-c3', '34aa01')$$, 'CL037', pg_temp.m(),
  'QR client : expiré (CL037)');
UPDATE wallet SET status = 'ACTIVE' WHERE id = pg_temp.id('34cb006');
SELECT pg_temp.cq('34c201', '34cb006', 'tok-c6');
UPDATE wallet SET status = 'BLOCKED' WHERE id = pg_temp.id('34cb006');
SELECT throws_ok($$SELECT pg_temp.lq('tok-c6', '34aa01')$$, 'CL037', pg_temp.m(),
  'QR client : portefeuille bloqué (CL037)');
SELECT is(pg_temp.lq('tok-c1', '34aa01'), pg_temp.id('34cb001'),
  'témoin : QR client verrouillé, portefeuille rendu');
SELECT pg_temp.sale('34fc020', '34cc001', '34d001', '34aa01', 'P34-AA01:301', '34cd003', 900);
SELECT throws_ok($$SELECT pg_temp.cf('tok-c1', '34fc020')$$, 'CL037', pg_temp.m(),
  'QR client : vente sur un autre portefeuille refusée');
SELECT pg_temp.sale('34fc021', '34cc001', '34d001', '34aa01', 'P34-AA01:302', '34cd001', 900);
SELECT lives_ok($$SELECT pg_temp.cf('tok-c1', '34fc021')$$,
  'témoin : QR client confirmé sur le portefeuille de la demande');
SELECT ok((SELECT status = 'CONFIRMED' AND transaction_id = pg_temp.id('34fc021') AND amount = 900
                  AND device_id = pg_temp.id('34aa01')
             FROM payment_request WHERE id = pg_temp.req('tok-c1')),
  'QR client confirmé : montant et terminal de la vente écrits');
SELECT is((SELECT count(*)::int FROM sale_attribution
            WHERE transaction_id = pg_temp.id('34fc021')), 0,
  'QR client : pas d''attribution ici (paiement du terminal, WP11)');
SELECT throws_ok($$SELECT pg_temp.lq('tok-c1', '34aa01')$$, 'CL037', pg_temp.m(),
  'QR client à usage unique : second verrouillage refusé');
-- Vente d'un QR client portée par un terminal d'un autre événement (aa07, d002) alors que la vente
-- et la demande sont de d001 : refusée ; témoin avec le terminal aa01 (d001).
SELECT pg_temp.cq('34c201', '34cb001', 'tok-c7');
SELECT is(pg_temp.lq('tok-c7', '34aa01'), pg_temp.id('34cb001'), 'témoin : c7 verrouillé');
SELECT pg_temp.sale('34fc022', '34cc001', '34d001', '34aa07', 'P34-AA07:303', '34cd001', 900);
SELECT throws_ok($$SELECT pg_temp.cf('tok-c7', '34fc022')$$, 'CL037', pg_temp.m(),
  'QR client : terminal de la vente hors de l''événement de la demande refusé');
SELECT pg_temp.sale('34fc023', '34cc001', '34d001', '34aa01', 'P34-AA01:304', '34cd001', 900);
SELECT lives_ok($$SELECT pg_temp.cf('tok-c7', '34fc023')$$,
  'témoin : même vente sur un terminal de l''événement, confirmée');
-- Une vente ne confirme qu'une demande : c2 (même portefeuille) refusée avec la vente de c1.
SELECT is(pg_temp.lq('tok-c2', '34aa01'), pg_temp.id('34cb001'), 'témoin : c2 verrouillé');
SELECT throws_ok($$SELECT pg_temp.cf('tok-c2', '34fc021')$$, 'CL037', pg_temp.m(),
  'confirmation : vente déjà liée à une autre demande refusée');

-- 6. Annulation ----------------------------------------------------------------------------------
SELECT pg_temp.cm('34aa02', '34fb002', 700, 'tok-m20', 'P34-AA02:220', NULL);
SELECT pg_temp.cm('34aa02', '34fb002', 700, 'tok-m21', 'P34-AA02:221', NULL);
SELECT throws_ok($$SELECT cancel_payment_request(pg_temp.req('tok-m20'), pg_temp.id('34aa02'),
                     pg_temp.h('tok-m20'))$$, 'CL001', NULL,
  'annulation : terminal et jeton ensemble refusés (CL001)');
SELECT throws_ok($$SELECT cancel_payment_request(pg_temp.req('tok-m20'), NULL, NULL)$$, 'CL001',
  NULL, 'annulation : ni terminal ni jeton refusés (CL001)');
SELECT throws_ok($$SELECT cancel_payment_request(pg_temp.req('tok-m20'), pg_temp.id('34aa01'),
                     NULL)$$, 'CL037', pg_temp.m(), 'annulation : autre terminal (CL037)');
SELECT throws_ok($$SELECT cancel_payment_request(pg_temp.req('tok-m21'), NULL,
                     pg_temp.h('tok-mauvais'))$$, 'CL037', pg_temp.m(),
  'annulation : festivalier sans le bon jeton (CL037)');
SELECT throws_ok($$SELECT cancel_payment_request(pg_temp.req('tok-q8'), pg_temp.id('34aa02'),
                     NULL)$$, 'CL037', pg_temp.m(), 'annulation : demande payée (CL037)');
SELECT throws_ok($$SELECT cancel_payment_request(pg_temp.req('tok-m7'), pg_temp.id('34aa02'),
                     NULL)$$, 'CL037', pg_temp.m(), 'annulation : demande expirée (CL037)');
SELECT throws_ok($$SELECT cancel_payment_request(pg_temp.req('tok-c2'), NULL,
                     pg_temp.h('tok-c2'))$$, 'CL037', pg_temp.m(),
  'annulation : QR client non concerné (CL037)');
SELECT lives_ok($$SELECT cancel_payment_request(pg_temp.req('tok-m20'), pg_temp.id('34aa02'),
                    NULL)$$, 'témoin : annulation par le terminal d''origine');
SELECT lives_ok($$SELECT cancel_payment_request(pg_temp.req('tok-m21'), NULL,
                    pg_temp.h('tok-m21'))$$, 'témoin : annulation par le festivalier avec le jeton');
SELECT is((SELECT count(*)::int FROM payment_request
            WHERE id IN (pg_temp.req('tok-m20'), pg_temp.req('tok-m21'))
              AND status = 'CANCELLED'), 2, 'demandes CANCELLED');
SELECT throws_ok($$SELECT cancel_payment_request(pg_temp.req('tok-m20'), pg_temp.id('34aa02'),
                     NULL)$$, 'CL037', pg_temp.m(), 'annulation : déjà annulée (CL037)');

-- 7. Consultation avec le jeton (A24) -------------------------------------------------------------
SELECT results_eq($$SELECT status, amount, currency, merchant_name
                      FROM payment_request_for_token(pg_temp.req('tok-q2'), pg_temp.h('tok-q2'))$$,
  $$VALUES ('PENDING'::text, 700::bigint, 'XOF'::char(3), 'Commerçant M1'::text)$$,
  'consultation : statut, montant, devise, commerçant');
SELECT is((SELECT status FROM payment_request_for_token(pg_temp.req('tok-m7'),
                                                        pg_temp.h('tok-m7'))), 'EXPIRED',
  'consultation : PENDING expirée relue EXPIRED (heure de la base)');
SELECT is((SELECT status FROM payment_request WHERE id = pg_temp.req('tok-m7')), 'PENDING',
  'expiration sans réécriture');
SELECT is((SELECT status FROM payment_request_for_token(pg_temp.req('tok-q8'),
                                                        pg_temp.h('tok-q8'))), 'CONFIRMED',
  'consultation : demande payée');
SELECT throws_ok($$SELECT * FROM payment_request_for_token(pg_temp.req('tok-m1'),
                     pg_temp.h('tok-mauvais'))$$, 'CL037', pg_temp.m(),
  'consultation : mauvais jeton (CL037)');
SELECT throws_ok($$SELECT * FROM payment_request_for_token(pg_temp.id('34ffff'),
                     pg_temp.h('tok-m1'))$$, 'CL037', pg_temp.m(),
  'consultation : demande inconnue (CL037)');

-- 8. Isolation (NFR-007) -------------------------------------------------------------------------
SELECT pg_temp.cm('34aa02', '34fb002', 700, 'tok-m30', 'P34-AA02:230', NULL);
SELECT pg_temp.b();
SELECT throws_ok($$SELECT pg_temp.cm('34aa02', '34fb002', 700, 'tok-b1', 'B:1', NULL)$$, 'P0002',
  NULL, 'B ne crée pas de demande sur un terminal de A (P0002)');
SELECT throws_ok($$SELECT pg_temp.cq('34c201', '34cb001', 'tok-b2')$$, 'CL037', pg_temp.m(),
  'B ne crée pas de QR client sur un portefeuille de A');
SELECT throws_ok($$SELECT pg_temp.lk(pg_temp.req('tok-m30'), 'tok-m30', '34cb011', '34c211')$$,
  'CL037', pg_temp.m(), 'B ne verrouille pas une demande de A');
SELECT throws_ok($$SELECT pg_temp.lq('tok-c2', '34ab01')$$, 'CL037', pg_temp.m(),
  'B ne verrouille pas un QR client de A');
SELECT throws_ok($$SELECT pg_temp.cf('tok-m30', '34fc010')$$, 'CL037', pg_temp.m(),
  'B ne confirme pas une demande de A');
SELECT throws_ok($$SELECT cancel_payment_request(pg_temp.req('tok-m30'), NULL,
                     pg_temp.h('tok-m30'))$$, 'CL037', pg_temp.m(),
  'B n''annule pas une demande de A, même avec le jeton');
SELECT throws_ok($$SELECT * FROM payment_request_for_token(pg_temp.req('tok-m30'),
                     pg_temp.h('tok-m30'))$$, 'CL037', pg_temp.m(),
  'B ne consulte pas une demande de A');
SELECT lives_ok($$SELECT pg_temp.cm('34ab01', '34fb011', 700, 'tok-b3', 'P34-AB01:1', NULL)$$,
  'témoin : B crée une demande sur son terminal');
SELECT pg_temp.a();
SELECT is((SELECT status FROM payment_request WHERE id = pg_temp.req('tok-m30')), 'PENDING',
  'demande de A intacte après les essais de B');
SELECT throws_ok($$SELECT * FROM payment_request_for_token(pg_temp.req('tok-b3'),
                     pg_temp.h('tok-b3'))$$, 'CL037', pg_temp.m(),
  'A ne consulte pas une demande de B');

-- 9. Sans prestataire de session -----------------------------------------------------------------
SELECT set_config('app.operator_id', '', true);
SELECT throws_ok($$SELECT pg_temp.cq('34c201', '34cb001', 'tok-z1')$$, 'P0002', NULL,
  'sans prestataire de session : P0002');

SELECT * FROM finish();
ROLLBACK;
