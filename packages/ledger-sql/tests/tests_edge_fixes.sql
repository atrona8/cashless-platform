-- Migration correctrice 0064 (mission passerelle-locale, lot WP09 ; décisions du porteur du 09/11/2026 n° 21, 23, 25 ;
-- OP-N108) — pgTAP, écrit à la main, sous le propriétaire sauf mention. Lancer depuis packages/ledger-sql :
-- pg_prove -d <base> tests/tests_edge_fixes.sql
--   1. Décision 25 : plafond horaire par terminal en microsecondes, bornes fermées. Test de bordure : deux ventes à
--      3 599,9 s se comptent ENSEMBLE ; il échoue sur la fenêtre de 0061 (secondes entières, bornes ouvertes).
--   2. Décision 21 : plafond par recharge en espèces au rejeu (réglage replay_max_per_cash_topup, 500 000 par défaut) ;
--      au-delà, jamais REJECTED : crédit borné, reste en espèces dues, anomalie CASH_TOPUP_OVER_LIMIT.
--   3. Décision 23 : edge_expose_device_token_families (assert_tenant, familles actives, une seule colonne).
\set ON_ERROR_STOP 1
\set QUIET 1
BEGIN;
\ir _grants_for_tests.sql
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();
SET CONSTRAINTS ALL IMMEDIATE;

CREATE FUNCTION pg_temp.id(p text) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT ('00000000-0000-0000-0000-' || lpad(p, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.a() RETURNS void LANGUAGE sql AS
  $$ SELECT set_config('app.operator_id', pg_temp.id('64a001')::text, true) $$;
CREATE FUNCTION pg_temp.b() RETURNS void LANGUAGE sql AS
  $$ SELECT set_config('app.operator_id', pg_temp.id('64a002')::text, true) $$;
CREATE FUNCTION pg_temp.ledger_of(p text) RETURNS uuid LANGUAGE sql AS
  $$ SELECT id FROM ledger WHERE scope_type = 'EVENT' AND scope_id = pg_temp.id(p) $$;
CREATE FUNCTION pg_temp.acc(p_ledger uuid, p_code text) RETURNS uuid LANGUAGE sql AS
  $$ SELECT id FROM account WHERE ledger_id = p_ledger AND code = p_code $$;
CREATE FUNCTION pg_temp.nx(p text) RETURNS bigint LANGUAGE sql AS
  $$ SELECT contiguous_edge_seq + 1 FROM edge_gateway WHERE id = pg_temp.id(p) $$;
CREATE FUNCTION pg_temp.tsu(p timestamptz) RETURNS text LANGUAGE sql AS
  $$ SELECT to_char(p AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') $$;

INSERT INTO party (kind, legal_name) SELECT 'PLATFORM', 'Plateforme (test)'
 WHERE NOT EXISTS (SELECT 1 FROM party WHERE kind = 'PLATFORM');
INSERT INTO party (id, kind, legal_name, country_code) VALUES
 (pg_temp.id('64a001'), 'OPERATOR', 'Prestataire A', 'SN'), (pg_temp.id('64a002'), 'OPERATOR', 'Prestataire B', 'CI');
INSERT INTO party (id, kind, operator_id, legal_name) VALUES
 (pg_temp.id('64b001'), 'ORGANIZER', pg_temp.id('64a001'), 'Organisateur A'),
 (pg_temp.id('64b011'), 'ORGANIZER', pg_temp.id('64a002'), 'Organisateur B'),
 (pg_temp.id('64b101'), 'MERCHANT', pg_temp.id('64a001'), 'Commerçant 1');
INSERT INTO jurisdiction_profile (id, country_code, version, valid_from, breakage_destination)
VALUES (pg_temp.id('64c001'), 'SN', 640064, '2026-01-01', 'ORGANIZER');
INSERT INTO app_user (id, operator_id, issuer, subject, email, display_name)
VALUES (pg_temp.id('64ea01'), pg_temp.id('64a001'), 'https://idp.test', 's64', 'u64@test', 'Caissier 64'),
       (pg_temp.id('64ea02'), pg_temp.id('64a001'), 'https://idp.test', 's64b', 'u64b@test', 'Superviseur 64');

-- Événements : d001 plafond horaire ; d002 recharge ; d003 jetons (A) ; d011 (B).
CREATE FUNCTION pg_temp.mk_event(p_event text, p_gw text, p_serial text, p_op text, p_org text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE lg uuid;
BEGIN
  IF p_op = '64a001' THEN PERFORM pg_temp.a(); ELSE PERFORM pg_temp.b(); END IF;
  INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone, jurisdiction_id, funds_holder, status)
  VALUES (pg_temp.id(p_event), pg_temp.id(p_op), pg_temp.id(p_org), 'Événement ' || p_event, 'XOF', 'Africa/Dakar',
          pg_temp.id('64c001'), 'ORGANIZER', 'LIVE');
  PERFORM open_event_ledger(pg_temp.id(p_event));
  lg := pg_temp.ledger_of(p_event);
  INSERT INTO edge_gateway (id, operator_id, event_id, serial, role)
  VALUES (pg_temp.id(p_gw), pg_temp.id(p_op), pg_temp.id(p_event), p_serial, 'PRIMARY');
  UPDATE ledger SET debit_authority = 'EDGE', edge_gateway_id = pg_temp.id(p_gw), authority_epoch = 1 WHERE id = lg;
  INSERT INTO debit_authority_handover (operator_id, ledger_id, edge_gateway_id, direction, status, epoch,
                                        watermark_posting_id, requested_by, requested_at)
  VALUES (pg_temp.id(p_op), lg, pg_temp.id(p_gw), 'TO_EDGE', 'ACTIVE', 1, 0, pg_temp.id('64f001'),
          now() - interval '6 hours');
END $$;
SELECT pg_temp.mk_event('64d001', '64e001', 'GW1', '64a001', '64b001');
SELECT pg_temp.mk_event('64d002', '64e002', 'GW2', '64a001', '64b001');
SELECT pg_temp.mk_event('64d003', '64e003', 'GW3', '64a001', '64b001');
SELECT pg_temp.mk_event('64d011', '64e011', 'GW11', '64a002', '64b011');
SELECT pg_temp.a();
INSERT INTO merchant_participation (id, operator_id, event_id, merchant_id, link_type, payout_to)
VALUES (pg_temp.id('64d0011'), pg_temp.id('64a001'), pg_temp.id('64d001'), pg_temp.id('64b101'), 'INTERNAL',
        pg_temp.id('64b001'));
INSERT INTO point_of_sale (id, operator_id, participation_id, name)
VALUES (pg_temp.id('64d0012'), pg_temp.id('64a001'), pg_temp.id('64d0011'), 'Stand');
SELECT open_participation_account(pg_temp.id('64d0011'));
INSERT INTO device (id, operator_id, kind, event_id, pos_id, serial)
VALUES (pg_temp.id('64aa01'), pg_temp.id('64a001'), 'POS', pg_temp.id('64d001'), pg_temp.id('64d0012'), 'TA'),
       (pg_temp.id('64aa02'), pg_temp.id('64a001'), 'POS', pg_temp.id('64d001'), pg_temp.id('64d0012'), 'TB'),
       (pg_temp.id('64aa03'), pg_temp.id('64a001'), 'POS', pg_temp.id('64d001'), pg_temp.id('64d0012'), 'TC');

CREATE FUNCTION pg_temp.mk_wallet(p_n int, p_event text, p_paid bigint) RETURNS void LANGUAGE plpgsql AS $$
DECLARE lg uuid := pg_temp.ledger_of(p_event); w uuid := pg_temp.id('64f0' || lpad(p_n::text, 8, '0'));
BEGIN
  PERFORM pg_temp.a();
  INSERT INTO wallet (id, operator_id, ledger_id) VALUES (w, pg_temp.id('64a001'), lg);
  INSERT INTO account (operator_id, ledger_id, code, family, purpose, wallet_id, normal_side) VALUES
    (pg_temp.id('64a001'), lg, 'L-WAL-' || p_n || '-P', 'CLAIM', 'WALLET_PAID', w, 'C'),
    (pg_temp.id('64a001'), lg, 'L-WAL-' || p_n || '-X', 'CLAIM', 'WALLET_PROMO', w, 'C');
  INSERT INTO media (id, operator_id, kind, token_hash, nfc_uid, wallet_id, status)
  VALUES (pg_temp.id('64c1' || lpad(p_n::text, 8, '0')), pg_temp.id('64a001'), 'NFC_TAG',
          sha256(convert_to('m64-' || p_n, 'UTF8')), decode('0464' || lpad(p_n::text, 10, '0'), 'hex'), w, 'ACTIVE');
  IF p_paid > 0 THEN
    PERFORM post_transaction(lg, 'PSP_SETTLEMENT', 'fund-' || p_n, now(), 'BATCH',
      jsonb_build_array(jsonb_build_object('account_id', pg_temp.acc(lg, 'L-WAL-' || p_n || '-P'), 'amount', -p_paid),
                        jsonb_build_object('account_id', pg_temp.acc(lg, 'A-BANQUE'), 'amount', p_paid)));
  END IF;
END $$;
SELECT pg_temp.mk_wallet(1, '64d001', 5000000), pg_temp.mk_wallet(2, '64d001', 5000000),
       pg_temp.mk_wallet(3, '64d001', 5000000);
SELECT pg_temp.mk_wallet(n, '64d002', 0) FROM generate_series(10, 13) n;

CREATE TEMP TABLE r (name text PRIMARY KEY, outcome text, tx uuid, reason text, detail text, charged bigint, shortfall bigint);
CREATE FUNCTION pg_temp.res(p_name text, p_col text) RETURNS text LANGUAGE sql AS
  $$ SELECT to_jsonb(r.*) ->> p_col FROM r WHERE r.name = p_name $$;

-- 1. Décision 25 : fenêtre horaire -----------------------------------------------------------------------------------
-- Plafond horaire abaissé à 50 000 (plafond par vente : 50 000) ; ventes de 40 000 sur un terminal.
SELECT set_edge_setting('replay_max_per_terminal_hour', 50000, 'WP09 test');
CREATE FUNCTION pg_temp.sale(p_name text, p_serial text, p_wallet int, p_amount bigint, p_at timestamptz)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE s bigint := pg_temp.nx('64e001'); o jsonb;
BEGIN
  o := jsonb_build_object('edge_seq', s, 'seq', s, 'type', 'PURCHASE', 'occurred_at', pg_temp.tsu(p_at),
    'amount', p_amount, 'currency', 'XOF', 'authorized_mode', 'EDGE_ONLINE', 'device_serial', p_serial,
    'tap', jsonb_build_object('nfc_uid', '0464' || lpad(p_wallet::text, 10, '0'),
       'token_hash', encode(sha256(convert_to('m64-' || p_wallet, 'UTF8')), 'hex'), 'counter', s,
       'pack_verified', true, 'signature_verified', true),
    'edge_decision', jsonb_build_object('status', 'ACCEPTED', 'charged_to_wallet', p_amount, 'shortfall_amount', 0));
  PERFORM set_config('app.gateway_id', pg_temp.id('64e001')::text, true);
  INSERT INTO r SELECT p_name, x.* FROM edge_post_transaction(pg_temp.id('64e001'), 1, s,
    p_serial || ':' || lpad(s::text, 4, '0'), sha256(convert_to(o::text, 'UTF8')), o, NULL) x;
END $$;
CREATE TEMP TABLE t0 AS SELECT date_trunc('second', now()) - interval '3 hours' + interval '0.9 seconds' AS t1;
-- Terminal TA : deux ventes à 3 599,9 s. En secondes entières (0061) les deux horodatages tombent à 3 600 s l'un de
-- l'autre, bornes ouvertes : la seconde ne voit pas la première (charged 40 000). En microsecondes : elle la voit.
SELECT pg_temp.sale('a1', 'TA', 1, 40000, (SELECT t1 FROM t0));
SELECT pg_temp.sale('a2', 'TA', 1, 40000, (SELECT t1 + interval '3599.9 seconds' FROM t0));
SELECT is(pg_temp.res('a1', 'charged'), '40000', 'TA : première vente prélevée en entier');
SELECT is(pg_temp.res('a2', 'charged') || '/' || pg_temp.res('a2', 'shortfall'), '10000/30000',
  'TA : deux ventes à 3 599,9 s se comptent ensemble (seulement 10 000 restent sur le plafond horaire de 50 000)');
SELECT is(pg_temp.res('a2', 'detail'), 'EDGE_REPLAY_CEILING', 'TA : la part rognée porte EDGE_REPLAY_CEILING');
-- Borne fermée : TB, deux ventes à EXACTEMENT 3 600 s : comptées. TC, à 3 600 s + 1 µs : non comptées.
SELECT pg_temp.sale('b1', 'TB', 2, 40000, (SELECT t1 FROM t0));
SELECT pg_temp.sale('b2', 'TB', 2, 40000, (SELECT t1 + interval '3600 seconds' FROM t0));
SELECT is(pg_temp.res('b2', 'charged'), '10000', 'TB : à exactement 3 600 s, borne fermée : comptée');
SELECT pg_temp.sale('c1', 'TC', 3, 40000, (SELECT t1 FROM t0));
SELECT pg_temp.sale('c2', 'TC', 3, 40000, (SELECT t1 + interval '3600.000001 seconds' FROM t0));
SELECT is(pg_temp.res('c2', 'charged'), '40000', 'TC : à 3 600 s + 1 µs : hors fenêtre, non comptée');
SELECT is((SELECT count(*)::int FROM journal_transaction
            WHERE source = 'EDGE_SYNC' AND metadata ->> 'ceiling_epoch_us' ~ '^[0-9]{16}$'
              AND metadata ->> 'ceiling_epoch' IS NULL), 6, 'les écritures portent ceiling_epoch_us (microsecondes)');

-- 2. Décision 21 : plafond par recharge en espèces ---------------------------------------------------------------------
SELECT is((SELECT value FROM edge_platform_setting WHERE key = 'replay_max_per_cash_topup'), 500000::bigint,
  'plafond par recharge en espèces : 500 000 par défaut');
SELECT throws_ok($$SELECT set_edge_setting('replay_max_per_cash_topup', 0, 'x')$$, 'CL001', NULL, 'valeur nulle refusée');
SELECT lives_ok($$SELECT set_edge_setting('replay_max_per_cash_topup.EUR', 1000, 'WP09 test')$$,
  'clé suffixée par devise admise');
INSERT INTO device (id, operator_id, kind, app_mode, event_id, serial)
VALUES (pg_temp.id('64aa11'), pg_temp.id('64a001'), 'TOPUP', 'TOPUP_DESK', pg_temp.id('64d002'), 'TT1');
DO $$
DECLARE lg uuid := pg_temp.ledger_of('64d002'); acc uuid;
BEGIN
  INSERT INTO account (operator_id, ledger_id, code, family, purpose, normal_side)
  VALUES (pg_temp.id('64a001'), lg, 'A-CAISSE-TT1', 'ASSET', 'CASH_DESK', 'D') RETURNING id INTO acc;
  INSERT INTO cash_desk (account_id, operator_id, device_id, ledger_id)
  VALUES (acc, pg_temp.id('64a001'), pg_temp.id('64aa11'), lg);
  INSERT INTO cash_session (operator_id, ledger_id, event_id, device_id, cash_account_id, opened_by, opened_at)
  VALUES (pg_temp.id('64a001'), lg, pg_temp.id('64d002'), pg_temp.id('64aa11'), acc, pg_temp.id('64ea01'), '2026-01-01');
END $$;
CREATE FUNCTION pg_temp.topup(p_name text, p_wallet int, p_amount bigint) RETURNS void LANGUAGE plpgsql AS $$
DECLARE s bigint := pg_temp.nx('64e002'); o jsonb;
BEGIN
  o := jsonb_build_object('edge_seq', s, 'seq', s, 'type', 'TOPUP_CASH', 'occurred_at', pg_temp.tsu(clock_timestamp()),
    'currency', 'XOF', 'authorized_mode', 'EDGE_ONLINE', 'device_serial', 'TT1', 'amount', p_amount,
    'edge_guichet', jsonb_build_object('media_id', pg_temp.id('64c1' || lpad(p_wallet::text, 8, '0'))));
  PERFORM set_config('app.gateway_id', pg_temp.id('64e002')::text, true);
  INSERT INTO r SELECT p_name, x.* FROM edge_topup_cash(pg_temp.id('64e002'), 1, s, 'TT1:' || lpad((s)::text, 4, '0'),
    sha256(convert_to(o::text, 'UTF8')), o) x;
END $$;
SELECT pg_temp.a();
SELECT pg_temp.topup('u1', 10, 400000);
SELECT is(pg_temp.res('u1', 'outcome') || '/' || pg_temp.res('u1', 'charged') || '/' || pg_temp.res('u1', 'shortfall'),
  'ACCEPTED/400000/0', 'recharge de 400 000 (sous le plafond) : créditée en entier');
SELECT pg_temp.topup('u2', 11, 800000);
SELECT is(pg_temp.res('u2', 'outcome') || '/' || pg_temp.res('u2', 'charged') || '/' || pg_temp.res('u2', 'shortfall'),
  'ACCEPTED/500000/300000', 'recharge de 800 000 : jamais REJECTED, 500 000 crédités, 300 000 en espèces dues');
SELECT is((SELECT count(*)::int FROM anomaly WHERE kind = 'CASH_TOPUP_OVER_LIMIT' AND transaction_id = (SELECT tx FROM r WHERE name = 'u2')
             AND amount = 300000), 1, 'anomalie CASH_TOPUP_OVER_LIMIT de 300 000 (résolue à deux)');
SELECT is((SELECT -balance FROM account_balance WHERE account_id = pg_temp.acc(pg_temp.ledger_of('64d002'), 'L-WAL-11-P')),
  500000::bigint, 'le portefeuille n''est crédité que de 500 000');
SELECT is((SELECT count(*)::int FROM anomaly WHERE kind = 'CASH_TOPUP_OVER_LIMIT' AND transaction_id = (SELECT tx FROM r WHERE name = 'u1')),
  0, 'aucune anomalie sous le plafond');
SELECT set_edge_setting('replay_max_per_cash_topup', 100000, 'WP09 test');
SELECT pg_temp.topup('u3', 12, 150000);
SELECT is(pg_temp.res('u3', 'charged') || '/' || pg_temp.res('u3', 'shortfall'), '100000/50000',
  'plafond réglable : 100 000 crédités, 50 000 dus');
SELECT is(pg_temp.res('u3', 'outcome'), 'ACCEPTED', 'au-delà du plafond : ACCEPTED, jamais REJECTED');

-- 3. Décision 23 : exposition des jetons d'appareil --------------------------------------------------------------------
INSERT INTO device (id, operator_id, kind, app_mode, event_id, serial)
VALUES (pg_temp.id('64aa31'), pg_temp.id('64a001'), 'POS', 'CATALOG_POS', pg_temp.id('64d003'), 'J1'),
       (pg_temp.id('64aa32'), pg_temp.id('64a001'), 'POS', 'CATALOG_POS', pg_temp.id('64d003'), 'J2'),
       (pg_temp.id('64aa33'), pg_temp.id('64a001'), 'POS', 'CATALOG_POS', pg_temp.id('64d003'), 'J3'),
       (pg_temp.id('64aa34'), pg_temp.id('64a001'), 'POS', 'CATALOG_POS', pg_temp.id('64d001'), 'J4');
INSERT INTO device_refresh_token (id, operator_id, device_id, family_id, token_hash, expires_at, consumed_at, revoked_at,
                                  revoked_reason)
VALUES (pg_temp.id('64f7001'), pg_temp.id('64a001'), pg_temp.id('64aa31'), pg_temp.id('64f8001'), sha256('\x01'),
        now() + interval '1 day', NULL, NULL, NULL),                                  -- active, d003
       (pg_temp.id('64f7002'), pg_temp.id('64a001'), pg_temp.id('64aa32'), pg_temp.id('64f8002'), sha256('\x02'),
        now() + interval '1 day', NULL, now(), 'DEVICE_REVOKED'),                     -- révoquée
       (pg_temp.id('64f7003'), pg_temp.id('64a001'), pg_temp.id('64aa33'), pg_temp.id('64f8003'), sha256('\x03'),
        now() + interval '1 day', now(), NULL, NULL),                                 -- consommée
       (pg_temp.id('64f7004'), pg_temp.id('64a001'), pg_temp.id('64aa34'), pg_temp.id('64f8004'), sha256('\x04'),
        now() + interval '1 day', NULL, NULL, NULL);                                  -- active, autre événement
INSERT INTO device_refresh_token (id, operator_id, device_id, family_id, token_hash, expires_at, created_at)
VALUES (pg_temp.id('64f7005'), pg_temp.id('64a001'), pg_temp.id('64aa31'), pg_temp.id('64f8005'), sha256('\x05'),
        now() - interval '1 hour', now() - interval '2 hours');                       -- expirée
CREATE TEMP TABLE before_tok AS
  SELECT id, to_jsonb(t.*) - 'edge_exposed' AS j FROM device_refresh_token t;
GRANT SELECT ON before_tok TO PUBLIC;
CREATE TEMP TABLE before_chg AS SELECT count(*)::int AS n FROM edge_reference_change
 WHERE entity_kind = 'DEVICE' AND entity_id = pg_temp.id('64aa31');
SELECT pg_temp.b();
SELECT throws_ok($$SELECT edge_expose_device_token_families(pg_temp.id('64d003'))$$, 'P0002', NULL,
  'autre prestataire : refusé (assert_tenant)');
SELECT throws_ok($$SELECT edge_expose_device_token_families(gen_random_uuid())$$, 'P0002', NULL,
  'événement inconnu : même refus');
SELECT is((SELECT count(*)::int FROM device_refresh_token WHERE edge_exposed), 0, 'aucune ligne exposée après les refus');
SELECT pg_temp.a();
SET LOCAL ROLE cashless_app;
SELECT is(edge_expose_device_token_families(pg_temp.id('64d003')), 1,
  'cashless_app : une seule famille active exposée (révoquée, consommée et expirée ignorées)');
SELECT is(edge_expose_device_token_families(pg_temp.id('64d003')), 0, 'idempotent : deuxième appel, aucune ligne');
RESET ROLE;
SELECT is((SELECT string_agg(right(id::text, 4), ',' ORDER BY id) FROM device_refresh_token WHERE edge_exposed), '7001',
  'seule la famille active de l''événement est exposée (pas celle de l''autre événement)');
SELECT is((SELECT count(*)::int FROM before_tok b JOIN device_refresh_token t USING (id)
            WHERE b.j IS DISTINCT FROM (to_jsonb(t.*) - 'edge_exposed')), 0, 'aucune autre colonne modifiée');
SELECT is((SELECT count(*)::int FROM edge_reference_change WHERE entity_kind = 'DEVICE'
            AND entity_id = pg_temp.id('64aa31')) - (SELECT n FROM before_chg), 1,
  'la ligne DEVICE du journal de référence est émise (une de plus)');
SET LOCAL ROLE cashless_edge;
SELECT throws_ok($$SELECT edge_expose_device_token_families(pg_temp.id('64d003'))$$, '42501', NULL,
  'cashless_edge : refusé');
RESET ROLE;
SELECT is((SELECT count(*)::int FROM pg_proc WHERE proname = 'edge_expose_device_token_families' AND prosecdef
            AND proconfig @> ARRAY['search_path=public, pg_temp'] AND NOT has_function_privilege('public', oid, 'EXECUTE')),
  1, 'SECURITY DEFINER, search_path figé, rien pour PUBLIC');

SELECT * FROM finish();
ROLLBACK;
