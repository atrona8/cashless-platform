-- Génération de 200 000 ventes PURCHASE pour un événement (prestataire P1) + 5 000 pour un second (P2).
-- Usage : psql -d cashless_wp02 -f gen_sales.sql (propriétaire ; base remise à zéro avant).
\set ON_ERROR_STOP 1
\set QUIET 1
CREATE FUNCTION pg_temp.id(p text) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT ('00000000-0000-0000-0000-' || lpad(p, 12, '0'))::uuid $$;
INSERT INTO party (id, kind, legal_name, country_code) VALUES
 (pg_temp.id('f001'), 'OPERATOR', 'Perf P1', 'SN'), (pg_temp.id('f002'), 'OPERATOR', 'Perf P2', 'SN');
INSERT INTO party (id, kind, operator_id, legal_name) VALUES
 (pg_temp.id('f101'), 'ORGANIZER', pg_temp.id('f001'), 'Org 1'), (pg_temp.id('f102'), 'ORGANIZER', pg_temp.id('f002'), 'Org 2'),
 (pg_temp.id('f301'), 'CUSTOMER', pg_temp.id('f001'), 'Cl 1'), (pg_temp.id('f302'), 'CUSTOMER', pg_temp.id('f002'), 'Cl 2');
INSERT INTO party (id, kind, operator_id, legal_name)
SELECT pg_temp.id('f2' || lpad(n::text, 3, '0')), 'MERCHANT', pg_temp.id('f001'), 'M' || n FROM generate_series(1, 20) n;
INSERT INTO party (id, kind, operator_id, legal_name) VALUES (pg_temp.id('f290'), 'MERCHANT', pg_temp.id('f002'), 'M2');
INSERT INTO jurisdiction_profile (id, country_code, version, valid_from, breakage_destination)
VALUES (pg_temp.id('f900'), 'SN', 9990001, '2026-01-01', 'ORGANIZER');
INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone, jurisdiction_id, funds_holder, status) VALUES
 (pg_temp.id('fd01'), pg_temp.id('f001'), pg_temp.id('f101'), 'E1', 'XOF', 'Africa/Dakar', pg_temp.id('f900'), 'ORGANIZER', 'LIVE'),
 (pg_temp.id('fd02'), pg_temp.id('f002'), pg_temp.id('f102'), 'E2', 'XOF', 'Africa/Dakar', pg_temp.id('f900'), 'ORGANIZER', 'LIVE');
INSERT INTO merchant_participation (id, operator_id, event_id, merchant_id, link_type, payout_to)
SELECT pg_temp.id('f4' || lpad(n::text, 3, '0')), pg_temp.id('f001'), pg_temp.id('fd01'),
       pg_temp.id('f2' || lpad(n::text, 3, '0')), 'INTERNAL', pg_temp.id('f101') FROM generate_series(1, 20) n;
INSERT INTO merchant_participation (id, operator_id, event_id, merchant_id, link_type, payout_to)
VALUES (pg_temp.id('f490'), pg_temp.id('f002'), pg_temp.id('fd02'), pg_temp.id('f290'), 'INTERNAL', pg_temp.id('f102'));
INSERT INTO point_of_sale (id, operator_id, participation_id, name)
SELECT pg_temp.id('f5' || lpad(n::text, 3, '0')), pg_temp.id('f001'), pg_temp.id('f4' || lpad(n::text, 3, '0')), 'PDV' || n
  FROM generate_series(1, 20) n;
INSERT INTO point_of_sale (id, operator_id, participation_id, name)
VALUES (pg_temp.id('f590'), pg_temp.id('f002'), pg_temp.id('f490'), 'PDV2');
INSERT INTO device (id, operator_id, kind, app_mode, event_id, pos_id, serial, status)
SELECT pg_temp.id('f6' || lpad(n::text, 3, '0')), pg_temp.id('f001'), 'POS', 'CATALOG_POS', pg_temp.id('fd01'),
       pg_temp.id('f5' || lpad(n::text, 3, '0')), 'PERF-' || n, 'ACTIVE' FROM generate_series(1, 20) n;
INSERT INTO device (id, operator_id, kind, app_mode, event_id, pos_id, serial, status)
VALUES (pg_temp.id('f690'), pg_temp.id('f002'), 'POS', 'CATALOG_POS', pg_temp.id('fd02'), pg_temp.id('f590'), 'PERF-X', 'ACTIVE');
INSERT INTO ledger (id, operator_id, scope_type, scope_id, currency, issuer_id, funds_holder_id) VALUES
 (pg_temp.id('fc01'), pg_temp.id('f001'), 'EVENT', pg_temp.id('fd01'), 'XOF', pg_temp.id('f101'), pg_temp.id('f101')),
 (pg_temp.id('fc02'), pg_temp.id('f002'), 'EVENT', pg_temp.id('fd02'), 'XOF', pg_temp.id('f102'), pg_temp.id('f102'));
INSERT INTO wallet (id, operator_id, ledger_id, customer_id, status) VALUES
 (pg_temp.id('fb01'), pg_temp.id('f001'), pg_temp.id('fc01'), pg_temp.id('f301'), 'ACTIVE'),
 (pg_temp.id('fb02'), pg_temp.id('f002'), pg_temp.id('fc02'), pg_temp.id('f302'), 'ACTIVE');
INSERT INTO account (id, operator_id, ledger_id, code, family, purpose, wallet_id, participation_id, normal_side)
SELECT pg_temp.id('f7' || lpad(n::text, 3, '0')), pg_temp.id('f001'), pg_temp.id('fc01'), 'MER' || n, 'CLAIM', 'MERCHANT',
       NULL, pg_temp.id('f4' || lpad(n::text, 3, '0')), 'C' FROM generate_series(1, 20) n;
INSERT INTO account (id, operator_id, ledger_id, code, family, purpose, wallet_id, participation_id, normal_side) VALUES
 (pg_temp.id('f790'), pg_temp.id('f002'), pg_temp.id('fc02'), 'MER2', 'CLAIM', 'MERCHANT', NULL, pg_temp.id('f490'), 'C'),
 (pg_temp.id('f701'), pg_temp.id('f001'), pg_temp.id('fc01'), 'WAL1', 'CLAIM', 'WALLET_PAID', pg_temp.id('fb01'), NULL, 'C'),
 (pg_temp.id('f702'), pg_temp.id('f002'), pg_temp.id('fc02'), 'WAL2', 'CLAIM', 'WALLET_PAID', pg_temp.id('fb02'), NULL, 'C');
INSERT INTO app_user (id, operator_id, issuer, subject, email, display_name) VALUES
 (pg_temp.id('f801'), pg_temp.id('f001'), 'https://idp.test', 'perf1', 'p1@test', 'P1'),
 (pg_temp.id('f802'), pg_temp.id('f002'), 'https://idp.test', 'perf2', 'p2@test', 'P2');
-- Ventes : 200 000 (P1) sur 30 jours, 5 000 (P2). Identifiant = f0000 + n.
CREATE TEMP TABLE gen AS
SELECT n, CASE WHEN n <= 200000 THEN 1 ELSE 2 END AS p, 1 + (n % 20) AS k FROM generate_series(1, 205000) n;
INSERT INTO journal_transaction (id, operator_id, ledger_id, event_id, type, idempotency_key, request_hash,
                                 occurred_at, recorded_at, source, device_id)
SELECT pg_temp.id('f0' || lpad(n::text, 8, '0')), pg_temp.id('f00' || p), pg_temp.id('fc0' || p), pg_temp.id('fd0' || p),
       'PURCHASE', 'perf:' || n, 'h', '2026-06-01'::timestamptz + n * interval '13 seconds', now(), 'ONLINE',
       CASE WHEN p = 1 THEN pg_temp.id('f6' || lpad(k::text, 3, '0')) ELSE pg_temp.id('f690') END
  FROM gen;
INSERT INTO posting (operator_id, ledger_id, transaction_id, line_no, account_id, amount)
SELECT pg_temp.id('f00' || p), pg_temp.id('fc0' || p), pg_temp.id('f0' || lpad(n::text, 8, '0')), l,
       CASE WHEN l = 1 THEN pg_temp.id('f70' || p) WHEN p = 1 THEN pg_temp.id('f7' || lpad(k::text, 3, '0'))
            ELSE pg_temp.id('f790') END,
       CASE WHEN l = 1 THEN 500 ELSE -500 END
  FROM gen, generate_series(1, 2) l;
INSERT INTO sale_attribution (transaction_id, operator_id, actor_user_id, channel)
SELECT pg_temp.id('f0' || lpad(n::text, 8, '0')), pg_temp.id('f00' || p), pg_temp.id('f80' || p), 'NFC' FROM gen;
-- 2 % d'annulations (P1).
INSERT INTO journal_transaction (id, operator_id, ledger_id, event_id, type, idempotency_key, request_hash,
                                 occurred_at, recorded_at, source, device_id, reverses_id)
SELECT pg_temp.id('f1' || lpad(n::text, 8, '0')), pg_temp.id('f001'), pg_temp.id('fc01'), pg_temp.id('fd01'),
       'REVERSAL', 'perfr:' || n, 'h', '2026-06-01'::timestamptz + n * interval '13 seconds' + interval '1 minute', now(),
       'ONLINE', pg_temp.id('f6' || lpad(k::text, 3, '0')), pg_temp.id('f0' || lpad(n::text, 8, '0'))
  FROM gen WHERE p = 1 AND n % 50 = 0;
ANALYZE;
