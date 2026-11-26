-- Vues de lecture du back-office sale_overview et anomaly_overview (migration 0102, post-roles.sql § 16) — pgTAP,
-- écrit à la main. Mission 11b routes-backoffice, lot WP02 (research D5, D6 ; interfaces.md §2).
-- Lancer : pg_prove -d <base> tests/tests_backoffice_read_views.sql. La suite rejoue roles.sql puis post-roles.sql
-- (ordre de migrate.ts) : roles.sql rend INSERT et UPDATE à toute relation, vues comprises, § 16 doit les reprendre.
-- Tous les comptages portent sur les objets du test (prestataires A et B), jamais sur toute la base.
\set ON_ERROR_STOP 1
\set QUIET 1
BEGIN;
SET LOCAL client_min_messages = warning;
\ir ../roles.sql
\ir ../post-roles.sql
\ir _grants_for_tests.sql
RESET client_min_messages;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

CREATE FUNCTION pg_temp.id(p text) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT ('00000000-0000-0000-0000-' || lpad(p, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.a() RETURNS void LANGUAGE sql AS
  $$ SELECT set_config('app.operator_id', pg_temp.id('102a001')::text, true) $$;
CREATE FUNCTION pg_temp.b() RETURNS void LANGUAGE sql AS
  $$ SELECT set_config('app.operator_id', pg_temp.id('102a002')::text, true) $$;

-- Données (propriétaire) ---------------------------------------------------------------------------------------
-- A : organisateur b001, événement d001, commerçant b101 (participation f001), point de vente f101, terminal aa01,
--     festivalier c001 / portefeuille cb001 ; ventes : s1 (2 lignes, attribuée, commerçant, hors ligne), s2 (sans
--     attribution ni compte commerçant, ligne seule), s3 (annulée par r3).
-- B : une vente s4 et une anomalie, pour la preuve d'isolement.
INSERT INTO party (id, kind, legal_name, country_code) VALUES
 (pg_temp.id('102a001'), 'OPERATOR', 'Prestataire A', 'SN'), (pg_temp.id('102a002'), 'OPERATOR', 'Prestataire B', 'CI');
INSERT INTO party (id, kind, operator_id, legal_name) VALUES
 (pg_temp.id('102b001'), 'ORGANIZER', pg_temp.id('102a001'), 'Organisateur A'),
 (pg_temp.id('102b011'), 'ORGANIZER', pg_temp.id('102a002'), 'Organisateur B'),
 (pg_temp.id('102b101'), 'MERCHANT', pg_temp.id('102a001'), 'Commerçant A'),
 (pg_temp.id('102c001'), 'CUSTOMER', pg_temp.id('102a001'), 'Festivalier A');
INSERT INTO jurisdiction_profile (id, country_code, version, valid_from, breakage_destination)
VALUES (pg_temp.id('102c901'), 'SN', 1020102, '2026-01-01', 'ORGANIZER');
INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone, jurisdiction_id, funds_holder, status)
VALUES (pg_temp.id('102d001'), pg_temp.id('102a001'), pg_temp.id('102b001'), 'Événement A', 'XOF', 'Africa/Dakar',
        pg_temp.id('102c901'), 'ORGANIZER', 'LIVE'),
       (pg_temp.id('102d011'), pg_temp.id('102a002'), pg_temp.id('102b011'), 'Événement B', 'XOF', 'Africa/Dakar',
        pg_temp.id('102c901'), 'ORGANIZER', 'LIVE');
INSERT INTO merchant_participation (id, operator_id, event_id, merchant_id, link_type, payout_to)
VALUES (pg_temp.id('102f001'), pg_temp.id('102a001'), pg_temp.id('102d001'), pg_temp.id('102b101'), 'INTERNAL',
        pg_temp.id('102b001'));
INSERT INTO point_of_sale (id, operator_id, participation_id, name)
VALUES (pg_temp.id('102f101'), pg_temp.id('102a001'), pg_temp.id('102f001'), 'Bar A');
INSERT INTO device (id, operator_id, kind, app_mode, event_id, pos_id, serial, status) VALUES
 (pg_temp.id('102aa01'), pg_temp.id('102a001'), 'POS', 'CATALOG_POS', pg_temp.id('102d001'), pg_temp.id('102f101'),
  'P102-AA01', 'ACTIVE');
INSERT INTO ledger (id, operator_id, scope_type, scope_id, currency, issuer_id, funds_holder_id) VALUES
 (pg_temp.id('102cc01'), pg_temp.id('102a001'), 'EVENT', pg_temp.id('102d001'), 'XOF', pg_temp.id('102b001'),
  pg_temp.id('102b001')),
 (pg_temp.id('102cc11'), pg_temp.id('102a002'), 'EVENT', pg_temp.id('102d011'), 'XOF', pg_temp.id('102b011'),
  pg_temp.id('102b011'));
INSERT INTO wallet (id, operator_id, ledger_id, customer_id, status)
VALUES (pg_temp.id('102cb01'), pg_temp.id('102a001'), pg_temp.id('102cc01'), pg_temp.id('102c001'), 'ACTIVE');
INSERT INTO account (id, operator_id, ledger_id, code, family, purpose, wallet_id, participation_id, normal_side) VALUES
 (pg_temp.id('102e001'), pg_temp.id('102a001'), pg_temp.id('102cc01'), 'K102-WAL', 'CLAIM', 'WALLET_PAID',
  pg_temp.id('102cb01'), NULL, 'C'),
 (pg_temp.id('102e002'), pg_temp.id('102a001'), pg_temp.id('102cc01'), 'K102-MER', 'CLAIM', 'MERCHANT', NULL,
  pg_temp.id('102f001'), 'C');
INSERT INTO journal_transaction (id, operator_id, ledger_id, event_id, type, idempotency_key, request_hash,
                                 occurred_at, recorded_at, source, device_id, reverses_id) VALUES
 -- s1 : hors ligne, vendue le 01/06 à 10:00, synchronisée le 03/06
 (pg_temp.id('102f0e1'), pg_temp.id('102a001'), pg_temp.id('102cc01'), pg_temp.id('102d001'), 'PURCHASE', 'k102:s1',
  'h', '2026-06-01 10:00+00', '2026-06-03 08:00+00', 'OFFLINE_SYNC', pg_temp.id('102aa01'), NULL),
 (pg_temp.id('102f0e2'), pg_temp.id('102a001'), pg_temp.id('102cc01'), pg_temp.id('102d001'), 'PURCHASE', 'k102:s2',
  'h', '2026-06-02 10:00+00', '2026-06-02 10:00+00', 'ONLINE', NULL, NULL),
 (pg_temp.id('102f0e3'), pg_temp.id('102a001'), pg_temp.id('102cc01'), pg_temp.id('102d001'), 'PURCHASE', 'k102:s3',
  'h', '2026-06-04 10:00+00', '2026-06-04 10:00+00', 'ONLINE', pg_temp.id('102aa01'), NULL),
 (pg_temp.id('102f0e4'), pg_temp.id('102a001'), pg_temp.id('102cc01'), pg_temp.id('102d001'), 'REVERSAL', 'k102:r3',
  'h', '2026-06-04 11:00+00', '2026-06-04 11:00+00', 'ONLINE', pg_temp.id('102aa01'), pg_temp.id('102f0e3')),
 (pg_temp.id('102f0e5'), pg_temp.id('102a002'), pg_temp.id('102cc11'), pg_temp.id('102d011'), 'PURCHASE', 'k102:s4',
  'h', '2026-06-05 10:00+00', '2026-06-05 10:00+00', 'ONLINE', NULL, NULL);
-- s1 : deux lignes de vente (ne doit pas dupliquer la vente), s2 : une ligne sur le point de vente.
INSERT INTO catalog_category (id, operator_id, pos_id, label_fr, label_en, position)
VALUES (pg_temp.id('102ca01'), pg_temp.id('102a001'), pg_temp.id('102f101'), 'Boissons', 'Drinks', 0);
INSERT INTO catalog_item (id, operator_id, pos_id, category_id, label_fr, label_en, unit_price, vat_rate_bps)
VALUES (pg_temp.id('102ce01'), pg_temp.id('102a001'), pg_temp.id('102f101'), pg_temp.id('102ca01'), 'Eau', 'Water',
        500, 1800);
INSERT INTO app_user (id, operator_id, issuer, subject, email, display_name)
VALUES (pg_temp.id('102ee01'), pg_temp.id('102a001'), 'https://idp.test', 's102', 'a102@test', 'Personne A');
INSERT INTO catalog_version (operator_id, pos_id, version, created_by)
VALUES (pg_temp.id('102a001'), pg_temp.id('102f101'), 1, pg_temp.id('102ee01'));
INSERT INTO catalog_version_item (operator_id, pos_id, version, item_id, category_id, label_fr, label_en,
                                  category_label_fr, category_label_en, category_position, unit_price, vat_rate_bps)
VALUES (pg_temp.id('102a001'), pg_temp.id('102f101'), 1, pg_temp.id('102ce01'), pg_temp.id('102ca01'), 'Eau', 'Water',
        'Boissons', 'Drinks', 0, 500, 1800);
INSERT INTO sale_line (operator_id, transaction_id, line_no, pos_id, item_id, catalog_version, label_fr, label_en,
                       quantity, unit_price, vat_rate_bps, line_total)
SELECT pg_temp.id('102a001'), pg_temp.id(t), n, pg_temp.id('102f101'), pg_temp.id('102ce01'), 1, 'Eau', 'Water',
       1, 500, 1800, 500
  FROM (VALUES ('102f0e1', 1), ('102f0e1', 2), ('102f0e2', 1)) AS x(t, n);
INSERT INTO sale_attribution (transaction_id, operator_id, actor_user_id, channel)
VALUES (pg_temp.id('102f0e1'), pg_temp.id('102a001'), pg_temp.id('102ee01'), 'CUSTOMER_QR');
-- Postings (débit du portefeuille, crédit du commerçant) : s1 1000 (2 x 500), s3 300 ; s2 sans compte commerçant :
-- le débit du portefeuille est équilibré par un compte de l'organisateur.
INSERT INTO account (id, operator_id, ledger_id, code, family, purpose, normal_side)
VALUES (pg_temp.id('102e003'), pg_temp.id('102a001'), pg_temp.id('102cc01'), 'K102-ORG', 'ASSET', 'ORG_CASH', 'D');
INSERT INTO posting (operator_id, ledger_id, transaction_id, line_no, account_id, amount)
SELECT pg_temp.id('102a001'), pg_temp.id('102cc01'), pg_temp.id(t), n, pg_temp.id(k), amt
  FROM (VALUES ('102f0e1', 1, '102e001', 1000), ('102f0e1', 2, '102e002', -1000),
               ('102f0e2', 1, '102e001', 200), ('102f0e2', 2, '102e003', -200),
               ('102f0e3', 1, '102e001', 300), ('102f0e3', 2, '102e002', -300)) AS x(t, n, k, amt);
-- Anomalies : A rattachée à une transaction (événement par la transaction) et à un grand livre d'événement ; A sans
-- transaction ; A sans grand livre ; B.
INSERT INTO anomaly (id, operator_id, ledger_id, kind, amount, transaction_id) VALUES
 (pg_temp.id('102d101'), pg_temp.id('102a001'), pg_temp.id('102cc01'), 'CASH_DIFF', 0, pg_temp.id('102f0e1')),
 (pg_temp.id('102d102'), pg_temp.id('102a001'), pg_temp.id('102cc01'), 'PSP_TOPUP_NOT_CREDITED', 700, NULL),
 (pg_temp.id('102d103'), pg_temp.id('102a001'), NULL, 'RETIRED_IDENTITY', 0, NULL),
 (pg_temp.id('102d104'), pg_temp.id('102a002'), pg_temp.id('102cc11'), 'CASH_DIFF', 0, NULL);

-- 1. Forme des vues -----------------------------------------------------------------------------------------------
SELECT has_view('sale_overview');
SELECT has_view('anomaly_overview');
SELECT columns_are('public', 'sale_overview', ARRAY['transaction_id','operator_id','ledger_id','event_id',
  'occurred_at','amount','currency','pos_id','merchant_id','participation_id','vendor_id','device_id','source',
  'channel','reversal_transaction_id'], 'sale_overview : colonnes exactes, aucune donnée du festivalier');
SELECT columns_are('public', 'anomaly_overview', ARRAY['id','operator_id','ledger_id','kind','media_id','device_id',
  'seq','created_at','transaction_id','amount','status','resolution_tx_id','loss_bearer','detail','batch_id',
  'classified_by','classified_at','classification_reason','event_id','currency','classifiable'],
  'anomaly_overview : colonnes exactes');
SELECT is((SELECT count(*)::int FROM pg_class WHERE relname IN ('sale_overview','anomaly_overview')
              AND 'security_invoker=true' = ANY (reloptions)), 2, 'les deux vues sont security_invoker');

-- 2. Droits : SELECT seulement pour cashless_app, rien pour les autres rôles, aucun droit nouveau sur les tables -----
SELECT is(has_table_privilege('cashless_app', v, 'SELECT'), true, 'cashless_app lit ' || v)
  FROM unnest(ARRAY['sale_overview','anomaly_overview']) v;
SELECT is((SELECT array_agg(p ORDER BY p) FROM unnest(ARRAY['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES',
            'TRIGGER']) p WHERE has_table_privilege('cashless_app', v, p)), NULL::text[],
  'cashless_app n''a que SELECT sur ' || v)
  FROM unnest(ARRAY['sale_overview','anomaly_overview']) v;
SELECT is(has_table_privilege(r, v, 'SELECT'), false, r || ' ne lit pas ' || v)
  FROM unnest(ARRAY['sale_overview','anomaly_overview']) v, unnest(ARRAY['cashless_platform','cashless_edge_gateway']) r
 WHERE EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r);
SELECT is(has_table_privilege('cashless_app', t, 'INSERT') OR has_table_privilege('cashless_app', t, 'DELETE'),
  false, 'cashless_app : aucun droit d''écriture nouveau sur ' || t)
  FROM unnest(ARRAY['journal_transaction','posting']) t;

-- 3. sale_overview : contenu ---------------------------------------------------------------------------------------
SELECT pg_temp.a();
SET LOCAL ROLE cashless_app;
SELECT is((SELECT count(*)::int FROM sale_overview WHERE event_id = pg_temp.id('102d001')), 3,
  'une ligne par vente : 3 ventes de A (s1 à deux lignes non dupliquée, l''annulation exclue)');
SELECT is((SELECT count(*)::int FROM sale_overview WHERE transaction_id = pg_temp.id('102f0e1')), 1,
  'vente à deux lignes : une seule ligne de vue');
SELECT is((SELECT amount FROM sale_overview WHERE transaction_id = pg_temp.id('102f0e1')), 1000::bigint,
  's1 : montant = débit du portefeuille');
SELECT is((SELECT occurred_at FROM sale_overview WHERE transaction_id = pg_temp.id('102f0e1')),
  '2026-06-01 10:00+00'::timestamptz, 's1 (hors ligne) : date d''origine, pas celle de la synchronisation');
SELECT is((SELECT merchant_id || '|' || participation_id FROM sale_overview WHERE transaction_id = pg_temp.id('102f0e1')),
  pg_temp.id('102b101') || '|' || pg_temp.id('102f001'), 's1 : commerçant et participation par le compte MERCHANT');
SELECT is((SELECT pos_id FROM sale_overview WHERE transaction_id = pg_temp.id('102f0e1')), pg_temp.id('102f101'),
  's1 : point de vente du terminal');
SELECT is((SELECT device_id || '|' || channel || '|' || source FROM sale_overview
            WHERE transaction_id = pg_temp.id('102f0e1')), pg_temp.id('102aa01') || '|CUSTOMER_QR|OFFLINE_SYNC',
  's1 : terminal de l''écriture, canal de l''attribution, source');
SELECT is((SELECT merchant_id::text || participation_id::text || coalesce(channel, '-') || coalesce(device_id::text, '-')
             FROM sale_overview WHERE transaction_id = pg_temp.id('102f0e2')), NULL,
  's2 : sans commerçant, ni participation, ni terminal (valeurs nulles)');
SELECT is((SELECT pos_id FROM sale_overview WHERE transaction_id = pg_temp.id('102f0e2')), pg_temp.id('102f101'),
  's2 : point de vente de la première ligne de vente à défaut de terminal');
SELECT is((SELECT reversal_transaction_id FROM sale_overview WHERE transaction_id = pg_temp.id('102f0e3')),
  pg_temp.id('102f0e4'), 's3 : annulation portée par reversal_transaction_id');
SELECT is((SELECT count(*)::int FROM sale_overview WHERE reversal_transaction_id IS NULL
              AND event_id = pg_temp.id('102d001')), 2, 'les ventes non annulées n''ont pas d''annulation');
SELECT is((SELECT currency FROM sale_overview WHERE transaction_id = pg_temp.id('102f0e1')), 'XOF', 's1 : devise');

-- 4. Isolement entre prestataires ---------------------------------------------------------------------------------
SELECT is((SELECT count(*)::int FROM sale_overview WHERE operator_id = pg_temp.id('102a002')), 0,
  'A ne lit aucune vente de B');
SELECT is((SELECT count(*)::int FROM anomaly_overview WHERE operator_id = pg_temp.id('102a002')), 0,
  'A ne lit aucune anomalie de B');
RESET ROLE;
SELECT pg_temp.b();
SET LOCAL ROLE cashless_app;
SELECT is((SELECT count(*)::int FROM sale_overview WHERE operator_id = pg_temp.id('102a001')), 0,
  'B ne lit aucune vente de A');
SELECT is((SELECT count(*)::int FROM sale_overview WHERE operator_id = pg_temp.id('102a002')), 1,
  'B lit sa vente (preuve non vide)');
SELECT is((SELECT count(*)::int FROM anomaly_overview WHERE operator_id = pg_temp.id('102a001')), 0,
  'B ne lit aucune anomalie de A');
SELECT is((SELECT count(*)::int FROM anomaly_overview WHERE operator_id = pg_temp.id('102a002')), 1,
  'B lit son anomalie (preuve non vide)');
RESET ROLE;
SELECT set_config('app.operator_id', gen_random_uuid()::text, true);
SET LOCAL ROLE cashless_app;
SELECT is((SELECT count(*)::int FROM sale_overview WHERE operator_id IN (pg_temp.id('102a001'), pg_temp.id('102a002'))),
  0, 'prestataire inconnu : aucune vente');
RESET ROLE;

-- 5. anomaly_overview : contenu -----------------------------------------------------------------------------------
SELECT pg_temp.a();
SET LOCAL ROLE cashless_app;
SELECT is((SELECT count(*)::int FROM anomaly_overview WHERE id IN (pg_temp.id('102d101'), pg_temp.id('102d102'),
            pg_temp.id('102d103'))), 3, 'une ligne par anomalie de A');
SELECT is((SELECT classifiable FROM anomaly_overview WHERE id = pg_temp.id('102d101')), true,
  'CASH_DIFF : classable');
SELECT is((SELECT classifiable FROM anomaly_overview WHERE id = pg_temp.id('102d102')), false,
  'PSP_TOPUP_NOT_CREDITED : non classable');
SELECT is((SELECT event_id FROM anomaly_overview WHERE id = pg_temp.id('102d101')), pg_temp.id('102d001'),
  'anomalie avec transaction : événement de la transaction');
SELECT is((SELECT event_id FROM anomaly_overview WHERE id = pg_temp.id('102d102')), pg_temp.id('102d001'),
  'anomalie sans transaction, grand livre d''événement : événement du grand livre');
SELECT is((SELECT event_id::text || currency FROM anomaly_overview WHERE id = pg_temp.id('102d103')), NULL,
  'anomalie sans grand livre : event_id et currency nuls');
SELECT is((SELECT currency FROM anomaly_overview WHERE id = pg_temp.id('102d101')), 'XOF', 'devise du grand livre');
RESET ROLE;

-- 6. Écriture refusée ----------------------------------------------------------------------------------------------
SELECT pg_temp.a();
SET LOCAL ROLE cashless_app;
SELECT throws_ok($$UPDATE sale_overview SET amount = 1$$, '55000', NULL, 'UPDATE de sale_overview refusé (vue non modifiable)');
SELECT throws_ok($$DELETE FROM anomaly_overview$$, '55000', NULL, 'DELETE de anomaly_overview refusé (vue non modifiable)');
SELECT throws_ok($$INSERT INTO anomaly_overview (id) VALUES (gen_random_uuid())$$, '55000', NULL,
  'INSERT dans anomaly_overview refusé (vue non modifiable)');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
