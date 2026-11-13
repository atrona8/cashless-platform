-- Opérations de guichet rejouées en EDGE_SYNC : edge_activate_media, edge_take_deposit, edge_topup_cash (migration 0062 ;
-- mission passerelle-locale, lot WP07 ; FR-016, FR-020) — pgTAP, écrit à la main, SOUS LE PROPRIETAIRE (les droits sont en
-- WP09 ; la migration ne crée AUCUNE table : pas de sonde de droits de table ici, seulement celles d'EXECUTE).
-- Lancer depuis packages/ledger-sql : pg_prove -d <base> tests/tests_edge_counter_ops.sql
-- Ce que la suite NE prouve PAS : la concurrence réelle (deux connexions) ; les droits par rôle réels (WP09).
\set ON_ERROR_STOP 1
\set QUIET 1
BEGIN;
\ir _grants_for_tests.sql
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

CREATE FUNCTION pg_temp.id(p text) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT ('00000000-0000-0000-0000-' || lpad(p, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.a() RETURNS void LANGUAGE sql AS
  $$ SELECT set_config('app.operator_id', pg_temp.id('62a001')::text, true) $$;
CREATE FUNCTION pg_temp.b() RETURNS void LANGUAGE sql AS
  $$ SELECT set_config('app.operator_id', pg_temp.id('62a002')::text, true) $$;
CREATE FUNCTION pg_temp.ledger_of(p text) RETURNS uuid LANGUAGE sql AS
  $$ SELECT id FROM ledger WHERE scope_type = 'EVENT' AND scope_id = pg_temp.id(p) $$;
CREATE FUNCTION pg_temp.acc(p_ledger uuid, p_code text) RETURNS uuid LANGUAGE sql AS
  $$ SELECT id FROM account WHERE ledger_id = p_ledger AND code = p_code $$;
CREATE FUNCTION pg_temp.nx(p text) RETURNS bigint LANGUAGE sql AS
  $$ SELECT contiguous_edge_seq + 1 FROM edge_gateway WHERE id = pg_temp.id(p) $$;
CREATE FUNCTION pg_temp.ts(p timestamptz DEFAULT clock_timestamp()) RETURNS text LANGUAGE sql AS
  $$ SELECT to_char(p AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') $$;
CREATE FUNCTION pg_temp.bal(p_account uuid) RETURNS bigint LANGUAGE sql AS
  $$ SELECT coalesce((SELECT balance FROM account_balance WHERE account_id = p_account), 0)::bigint $$;
CREATE FUNCTION pg_temp.lines(p_tx uuid) RETURNS text LANGUAGE sql AS
  $$ SELECT string_agg(a.purpose || ':' || po.amount, ',' ORDER BY po.line_no)
       FROM posting po JOIN account a ON a.id = po.account_id WHERE po.transaction_id = p_tx $$;

-- Données (propriétaire) ---------------------------------------------------------------------------------------
INSERT INTO party (kind, legal_name) SELECT 'PLATFORM', 'Plateforme (test)'
 WHERE NOT EXISTS (SELECT 1 FROM party WHERE kind = 'PLATFORM');
INSERT INTO party (id, kind, legal_name, country_code) VALUES
 (pg_temp.id('62a001'), 'OPERATOR', 'Prestataire A', 'SN'),
 (pg_temp.id('62a002'), 'OPERATOR', 'Prestataire B', 'CI');
INSERT INTO party (id, kind, operator_id, legal_name) VALUES
 (pg_temp.id('62b001'), 'ORGANIZER', pg_temp.id('62a001'), 'Organisateur A'),
 (pg_temp.id('62b011'), 'ORGANIZER', pg_temp.id('62a002'), 'Organisateur B');
-- Plafond de solde des portefeuilles non identifiés : 100 000.
INSERT INTO jurisdiction_profile (id, country_code, version, valid_from, breakage_destination, unidentified_max_balance)
VALUES (pg_temp.id('62c001'), 'SN', 620062, '2026-01-01', 'ORGANIZER', 100000);
INSERT INTO app_user (id, operator_id, issuer, subject, email, display_name)
VALUES (pg_temp.id('62ea01'), pg_temp.id('62a001'), 'https://idp.test', 's62', 'u62@test', 'Caissier 62'),
       (pg_temp.id('62ea02'), pg_temp.id('62a001'), 'https://idp.test', 's62b', 'u62b@test', 'Superviseur 62');
INSERT INTO tag_key (operator_id, key_index, kms_key_ref, status) VALUES (pg_temp.id('62a001'), 1, 'test:hmac-62', 'ACTIVE');

-- Événements : d001 nominal ; d002 passerelle révoquée ; d003 STANDBY ; d004 autre événement (bracelet étranger) ;
-- d006 sans le mode d'activation DESK ; d011 prestataire B.
CREATE FUNCTION pg_temp.mk_event(p_event text, p_gw text, p_serial text, p_role text, p_modes text[]) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE lg uuid;
BEGIN
  PERFORM pg_temp.a();
  INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone, jurisdiction_id, funds_holder, status,
                     activation_modes)
  VALUES (pg_temp.id(p_event), pg_temp.id('62a001'), pg_temp.id('62b001'), 'Événement ' || p_event, 'XOF',
          'Africa/Dakar', pg_temp.id('62c001'), 'ORGANIZER', 'LIVE', p_modes);
  PERFORM open_event_ledger(pg_temp.id(p_event));
  lg := pg_temp.ledger_of(p_event);
  INSERT INTO edge_gateway (id, operator_id, event_id, serial, role)
  VALUES (pg_temp.id(p_gw), pg_temp.id('62a001'), pg_temp.id(p_event), p_serial, p_role);
  UPDATE ledger SET debit_authority = 'EDGE', edge_gateway_id = pg_temp.id(p_gw), authority_epoch = 1 WHERE id = lg;
  INSERT INTO debit_authority_handover (operator_id, ledger_id, edge_gateway_id, direction, status, epoch,
                                        watermark_posting_id, requested_by)
  VALUES (pg_temp.id('62a001'), lg, pg_temp.id(p_gw), 'TO_EDGE', 'ACTIVE', 1, 0, pg_temp.id('62f001'));
END $$;
SELECT pg_temp.mk_event('62d001', '62e001', 'GW1', 'PRIMARY', ARRAY['DESK']);
SELECT pg_temp.mk_event('62d002', '62e002', 'GW2', 'PRIMARY', ARRAY['DESK']);
SELECT pg_temp.mk_event('62d003', '62e003', 'GW3', 'STANDBY', ARRAY['DESK']);
SELECT pg_temp.mk_event('62d004', '62e004', 'GW4', 'PRIMARY', ARRAY['DESK']);
SELECT pg_temp.mk_event('62d006', '62e006', 'GW6', 'PRIMARY', ARRAY['SELF_APP']);
UPDATE edge_gateway SET status = 'REVOKED' WHERE id = pg_temp.id('62e002');

-- Terminaux de guichet : T1 (session OPEN, nominal), T2 (session CLOSED), T3 (jamais de session), T5 (session ouverte
-- APRES le début du cycle EDGE), T6 (événement d006), T7 (session OPEN, atomicité et divers), T8 (session OPEN, ordres).
INSERT INTO device (id, operator_id, kind, app_mode, event_id, serial)
SELECT pg_temp.id(d), pg_temp.id('62a001'), 'TOPUP', 'TOPUP_DESK', pg_temp.id(e), s
  FROM (VALUES ('62aa01','62d001','T1'), ('62aa02','62d001','T2'), ('62aa03','62d001','T3'), ('62aa05','62d001','T5'),
               ('62aa06','62d006','T6'), ('62aa07','62d001','T7'), ('62aa08','62d001','T8'),
               ('62aa04','62d004','T4')) AS v(d, e, s);
-- Caisses et sessions (propriétaire, comme open_cash_session). opened_at fixé avant le handover, sauf T5.
CREATE FUNCTION pg_temp.mk_session(p_dev text, p_event text, p_status text, p_opened timestamptz) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE lg uuid := pg_temp.ledger_of(p_event); acc uuid;
BEGIN
  INSERT INTO account (operator_id, ledger_id, code, family, purpose, normal_side)
  VALUES (pg_temp.id('62a001'), lg, 'A-CAISSE-' || p_dev, 'ASSET', 'CASH_DESK', 'D') RETURNING id INTO acc;
  INSERT INTO cash_desk (account_id, operator_id, device_id, ledger_id)
  VALUES (acc, pg_temp.id('62a001'), pg_temp.id(p_dev), lg);
  IF p_status = 'OPEN' THEN
    INSERT INTO cash_session (operator_id, ledger_id, event_id, device_id, cash_account_id, opened_by, opened_at)
    VALUES (pg_temp.id('62a001'), lg, pg_temp.id(p_event), pg_temp.id(p_dev), acc, pg_temp.id('62ea01'), p_opened);
  ELSE
    INSERT INTO cash_session (operator_id, ledger_id, event_id, device_id, cash_account_id, opened_by, opened_at,
                              status, closed_by, closed_at, counted_amount, expected_amount)
    VALUES (pg_temp.id('62a001'), lg, pg_temp.id(p_event), pg_temp.id(p_dev), acc, pg_temp.id('62ea01'), p_opened,
            'CLOSED', pg_temp.id('62ea02'), clock_timestamp(), 0, 0);
  END IF;
END $$;
SELECT pg_temp.mk_session('62aa01', '62d001', 'OPEN', '2026-01-01');
SELECT pg_temp.mk_session('62aa02', '62d001', 'CLOSED', '2026-01-01');
SELECT pg_temp.mk_session('62aa05', '62d001', 'OPEN', clock_timestamp() + interval '1 second');
SELECT pg_temp.mk_session('62aa07', '62d001', 'OPEN', '2026-01-01');
SELECT pg_temp.mk_session('62aa08', '62d001', 'OPEN', '2026-01-01');
CREATE FUNCTION pg_temp.caisse(p_dev text) RETURNS uuid LANGUAGE sql AS
  $$ SELECT pg_temp.acc(pg_temp.ledger_of('62d001'), 'A-CAISSE-' || p_dev) $$;

-- Lots : BA (sans préchargement ni caution), BP (préchargement 500), BD (caution 3 000 à part), BB (caution sur le solde),
-- BO (événement d004), BI (lot non actif), B6 (événement d006).
INSERT INTO media_batch (id, operator_id, organizer_id, event_id, kind, quantity, key_index, status, preload_promo_amount,
                         deposit_amount, deposit_mode)
VALUES (pg_temp.id('62c901'), pg_temp.id('62a001'), pg_temp.id('62b001'), pg_temp.id('62d001'), 'PUBLIC', 50, 1, 'ACTIVE', 0, 0, NULL),
       (pg_temp.id('62c902'), pg_temp.id('62a001'), pg_temp.id('62b001'), pg_temp.id('62d001'), 'PUBLIC', 50, 1, 'ACTIVE', 500, 0, NULL),
       (pg_temp.id('62c903'), pg_temp.id('62a001'), pg_temp.id('62b001'), pg_temp.id('62d001'), 'PUBLIC', 50, 1, 'ACTIVE', 0, 3000, 'SEPARATE'),
       (pg_temp.id('62c904'), pg_temp.id('62a001'), pg_temp.id('62b001'), pg_temp.id('62d001'), 'PUBLIC', 50, 1, 'ACTIVE', 0, 3000, 'FROM_BALANCE'),
       (pg_temp.id('62c905'), pg_temp.id('62a001'), pg_temp.id('62b001'), pg_temp.id('62d004'), 'PUBLIC', 50, 1, 'ACTIVE', 0, 0, NULL),
       (pg_temp.id('62c906'), pg_temp.id('62a001'), pg_temp.id('62b001'), pg_temp.id('62d001'), 'PUBLIC', 50, 1, 'ORDERED', 0, 0, NULL),
       (pg_temp.id('62c907'), pg_temp.id('62a001'), pg_temp.id('62b001'), pg_temp.id('62d006'), 'PUBLIC', 50, 1, 'ACTIVE', 0, 0, NULL),
       (pg_temp.id('62c908'), pg_temp.id('62a001'), pg_temp.id('62b001'), pg_temp.id('62d001'), 'PUBLIC', 50, 1, 'ACTIVE', 0, 0, NULL);
UPDATE media_batch SET reuse_policy = 'POOL' WHERE id = pg_temp.id('62c908');
-- Bracelets non activés : 1 à 3 (BA), 4 (BA, wallet étranger), 5 (BP), 6 (BO), 7 (BI), 8 (BA, réactivation), 9 (BA, doublon
-- central), 10 (BP, doublon avec écriture), 11 (BA, d006), 12 (BA, ancre pour le mauvais type d'opération).
CREATE FUNCTION pg_temp.mk_blank(p_n int, p_batch text) RETURNS void LANGUAGE sql AS $$
  INSERT INTO media (id, operator_id, kind, token_hash, nfc_uid, batch_id, key_index)
  VALUES (pg_temp.id('62c1' || lpad(p_n::text, 8, '0')), pg_temp.id('62a001'), 'NFC_TAG',
          sha256(convert_to('m62-' || p_n, 'UTF8')), decode('0462' || lpad(p_n::text, 10, '0'), 'hex'),
          pg_temp.id(p_batch), 1) $$;
SELECT pg_temp.mk_blank(1, '62c901'), pg_temp.mk_blank(2, '62c901'), pg_temp.mk_blank(3, '62c901'),
       pg_temp.mk_blank(4, '62c901'), pg_temp.mk_blank(5, '62c902'), pg_temp.mk_blank(6, '62c905'),
       pg_temp.mk_blank(7, '62c906'), pg_temp.mk_blank(8, '62c908'), pg_temp.mk_blank(9, '62c901'),
       pg_temp.mk_blank(10, '62c902'), pg_temp.mk_blank(11, '62c907'), pg_temp.mk_blank(12, '62c901');
CREATE FUNCTION pg_temp.m(p_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT pg_temp.id('62c1' || lpad(p_n::text, 8, '0')) $$;

-- Portefeuilles et bracelets ACTIFS (numéros 20 et suivants) ; solde posé par une écriture non soumise aux plafonds.
CREATE FUNCTION pg_temp.mk_wallet(p_n int, p_event text, p_paid bigint, p_batch text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE lg uuid := pg_temp.ledger_of(p_event); w uuid := pg_temp.id('62f0' || lpad(p_n::text, 8, '0')); tx uuid;
BEGIN
  PERFORM pg_temp.a();
  INSERT INTO wallet (id, operator_id, ledger_id) VALUES (w, pg_temp.id('62a001'), lg);
  INSERT INTO account (operator_id, ledger_id, code, family, purpose, wallet_id, normal_side) VALUES
    (pg_temp.id('62a001'), lg, 'L-WAL-' || p_n || '-P', 'CLAIM', 'WALLET_PAID', w, 'C'),
    (pg_temp.id('62a001'), lg, 'L-WAL-' || p_n || '-X', 'CLAIM', 'WALLET_PROMO', w, 'C');
  INSERT INTO media (id, operator_id, kind, token_hash, nfc_uid, wallet_id, status, batch_id, key_index)
  VALUES (pg_temp.m(p_n), pg_temp.id('62a001'), 'NFC_TAG', sha256(convert_to('m62-' || p_n, 'UTF8')),
          decode('0462' || lpad(p_n::text, 10, '0'), 'hex'), w, 'ACTIVE',
          CASE WHEN p_batch IS NULL THEN NULL ELSE pg_temp.id(p_batch) END, 1);
  IF p_paid > 0 THEN
    tx := post_transaction(lg, 'PSP_SETTLEMENT', 'fund-' || p_n, now(), 'BATCH',
      jsonb_build_array(jsonb_build_object('account_id', pg_temp.acc(lg, 'L-WAL-' || p_n || '-P'), 'amount', -p_paid),
                        jsonb_build_object('account_id', pg_temp.acc(lg, 'A-BANQUE'), 'amount', p_paid)));
  END IF;
END $$;
-- 20-23 : caution à part (BD) ; 24 : caution sur le solde (BB) ; 25 : caution déjà HELD ; 26 : fermée (T2) ; 27 : montant
SELECT pg_temp.mk_wallet(n, '62d001', 0, '62c903') FROM generate_series(20, 23) n;
SELECT pg_temp.mk_wallet(24, '62d001', 0, '62c904'), pg_temp.mk_wallet(25, '62d001', 0, '62c903'),
       pg_temp.mk_wallet(26, '62d001', 0, '62c903'), pg_temp.mk_wallet(27, '62d001', 0, '62c903'),
       pg_temp.mk_wallet(28, '62d001', 0, '62c903'), pg_temp.mk_wallet(29, '62d001', 0, '62c903');
UPDATE media SET deposit_status = 'HELD', deposit_held = 3000 WHERE id = pg_temp.m(25);
-- Recharges : 30 (vide), 31 (90 000 : marge 10 000), 32 (120 000 : marge 0), 33-35 (ordres), 36-38 (divers), 39 (d004).
SELECT pg_temp.mk_wallet(30, '62d001', 0, NULL), pg_temp.mk_wallet(31, '62d001', 90000, NULL),
       pg_temp.mk_wallet(32, '62d001', 120000, NULL), pg_temp.mk_wallet(33, '62d001', 0, NULL),
       pg_temp.mk_wallet(34, '62d001', 0, NULL), pg_temp.mk_wallet(35, '62d001', 0, NULL),
       pg_temp.mk_wallet(36, '62d001', 0, NULL), pg_temp.mk_wallet(37, '62d001', 0, NULL),
       pg_temp.mk_wallet(38, '62d001', 0, NULL), pg_temp.mk_wallet(39, '62d004', 0, NULL);

-- Opérations ---------------------------------------------------------------------------------------------------
CREATE FUNCTION pg_temp.base(p_type text, p_seq bigint, p_serial text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('edge_seq', p_seq, 'seq', p_seq, 'type', p_type, 'occurred_at', pg_temp.ts(),
    'currency', 'XOF', 'authorized_mode', 'EDGE_ONLINE', 'device_serial', p_serial) $$;
CREATE FUNCTION pg_temp.act(p_seq bigint, p_serial text, p_media int, p_wallet uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE sql AS $$
  SELECT pg_temp.base('ACTIVATION', p_seq, p_serial) || jsonb_build_object('edge_guichet',
    jsonb_build_object('media_id', pg_temp.m(p_media), 'event_id', pg_temp.id('62d001'), 'channel', 'DESK')
    || CASE WHEN p_wallet IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('wallet_id', p_wallet) END) $$;
CREATE FUNCTION pg_temp.dep(p_seq bigint, p_serial text, p_media int, p_amount bigint, p_cash uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT pg_temp.base('DEPOSIT_CASH', p_seq, p_serial) || jsonb_build_object('edge_guichet',
    jsonb_build_object('media_id', pg_temp.m(p_media), 'deposit_amount', p_amount)
    || CASE WHEN p_cash IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('cash_desk_account_id', p_cash) END) $$;
CREATE FUNCTION pg_temp.top(p_seq bigint, p_serial text, p_media int, p_amount bigint, p_tap boolean DEFAULT false)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT pg_temp.base('TOPUP_CASH', p_seq, p_serial) || jsonb_build_object('amount', p_amount)
    || CASE WHEN p_tap THEN jsonb_build_object('tap', jsonb_build_object('token_hash',
         encode(sha256(convert_to('m62-' || p_media, 'UTF8')), 'hex')))
       ELSE jsonb_build_object('edge_guichet', jsonb_build_object('media_id', pg_temp.m(p_media))) END $$;

CREATE TEMP TABLE ops (name text PRIMARY KEY, op jsonb);
CREATE TEMP TABLE r (name text PRIMARY KEY, outcome text, tx uuid, reason text, detail text, charged bigint, shortfall bigint);
-- Appelle la bonne fonction selon le type de l'opération ; clé d'origine = <série>:<seq> (+ suffixe).
CREATE FUNCTION pg_temp.run(p_name text, p_gw text, p_epoch bigint, p_op jsonb, p_suffix text DEFAULT '')
RETURNS void LANGUAGE plpgsql AS $$
DECLARE k text := p_op ->> 'device_serial' || ':' || lpad(p_op ->> 'seq', 4, '0') || p_suffix; c bytea := sha256(convert_to(p_op::text, 'UTF8'));
BEGIN
  INSERT INTO ops VALUES (p_name, p_op);
  PERFORM set_config('app.gateway_id', pg_temp.id(p_gw)::text, true);
  IF p_op ->> 'type' = 'ACTIVATION' THEN
    INSERT INTO r SELECT p_name, x.* FROM edge_activate_media(pg_temp.id(p_gw), p_epoch, (p_op ->> 'edge_seq')::bigint, k, c, p_op) x;
  ELSIF p_op ->> 'type' = 'DEPOSIT_CASH' THEN
    INSERT INTO r SELECT p_name, x.* FROM edge_take_deposit(pg_temp.id(p_gw), p_epoch, (p_op ->> 'edge_seq')::bigint, k, c, p_op) x;
  ELSE
    INSERT INTO r SELECT p_name, x.* FROM edge_topup_cash(pg_temp.id(p_gw), p_epoch, (p_op ->> 'edge_seq')::bigint, k, c, p_op) x;
  END IF;
END $$;
CREATE FUNCTION pg_temp.res(p_name text, p_col text) RETURNS text LANGUAGE sql AS
  $$ SELECT to_jsonb(r.*) ->> p_col FROM r WHERE r.name = p_name $$;
CREATE FUNCTION pg_temp.key(p_serial text, p_seq bigint, p_suffix text DEFAULT '') RETURNS text LANGUAGE sql AS
  $$ SELECT p_serial || ':' || lpad(p_seq::text, 4, '0') || p_suffix $$;
CREATE FUNCTION pg_temp.jt(p_key text) RETURNS journal_transaction LANGUAGE sql AS
  $$ SELECT t FROM journal_transaction t WHERE t.idempotency_key = p_key $$;
CREATE FUNCTION pg_temp.anom(p_kind text, p_key text) RETURNS anomaly LANGUAGE sql AS
  $$ SELECT a FROM anomaly a WHERE a.kind = p_kind AND (a.detail ->> 'origin_key') = p_key ORDER BY a.created_at LIMIT 1 $$;
SELECT pg_temp.a();

-- 1. Catalogue --------------------------------------------------------------------------------------------------
SELECT is((SELECT count(*)::int FROM pg_proc WHERE proname IN ('edge_activate_media', 'edge_take_deposit', 'edge_topup_cash',
            'edge_counter_op', 'edge_open_replay_failed') AND prosecdef
            AND proconfig @> ARRAY['search_path=public, pg_temp']), 5,
  'les cinq fonctions : SECURITY DEFINER et search_path = public, pg_temp');
SELECT is((SELECT count(*)::int FROM pg_proc WHERE proname IN ('edge_activate_media', 'edge_take_deposit', 'edge_topup_cash',
            'edge_counter_op', 'edge_open_replay_failed') AND has_function_privilege('public', oid, 'EXECUTE')), 0,
  'aucune fonction exécutable par PUBLIC');
SELECT is((SELECT count(*)::int FROM pg_proc p, pg_roles r WHERE p.proname IN ('edge_activate_media', 'edge_take_deposit',
            'edge_topup_cash', 'edge_counter_op', 'edge_open_replay_failed')
            AND r.rolname IN ('cashless_app', 'cashless_edge', 'cashless_edgeadmin')
            AND has_function_privilege(r.rolname, p.oid, 'EXECUTE')), 3,
  'accords (WP09) : les trois fonctions à cashless_edge seul, jamais edge_counter_op ni edge_open_replay_failed');
SELECT is((SELECT count(*)::int FROM pg_proc p, pg_roles r WHERE p.proname IN ('edge_activate_media', 'edge_take_deposit',
            'edge_topup_cash', 'edge_counter_op', 'edge_open_replay_failed')
            AND r.rolname IN ('cashless_app', 'cashless_edgeadmin', 'cashless_platform', 'cashless_tagkeys', 'cashless_maint')
            AND has_function_privilege(r.rolname, p.oid, 'EXECUTE')), 0,
  'aucun autre rôle ne les exécute');
SELECT is((SELECT count(*)::int FROM pg_proc p WHERE p.proname IN ('edge_counter_op', 'edge_open_replay_failed')
            AND has_function_privilege('cashless_edge', p.oid, 'EXECUTE')), 0, 'cashless_edge : jamais les deux internes');
SELECT is((SELECT count(*)::int FROM pg_proc WHERE proname IN ('edge_activate_media', 'edge_take_deposit', 'edge_topup_cash')
            AND pg_get_function_identity_arguments(oid) = 'p_gateway uuid, p_epoch bigint, p_edge_seq bigint, p_origin_key text, p_content bytea, p_op jsonb'), 3,
  'signatures de interfaces.md § 2');

-- 2. Activation -------------------------------------------------------------------------------------------------
SELECT pg_temp.run('a1', '62e001', 1, pg_temp.act(pg_temp.nx('62e001'), 'T1', 1));
SELECT is(pg_temp.res('a1', 'outcome'), 'ACCEPTED', 'activation anonyme : ACCEPTED');
SELECT is((SELECT status FROM media WHERE id = pg_temp.m(1)), 'ACTIVE', 'activation : bracelet ACTIVE');
SELECT is((SELECT count(*)::int FROM wallet w JOIN media m ON m.wallet_id = w.id WHERE m.id = pg_temp.m(1)
            AND w.customer_id IS NULL AND w.ledger_id = pg_temp.ledger_of('62d001')), 1,
  'activation anonyme : portefeuille créé par l''enveloppe, anonyme, dans le grand livre de la passerelle');
SELECT is((SELECT count(*)::int FROM account a JOIN media m ON m.wallet_id = a.wallet_id WHERE m.id = pg_temp.m(1)
            AND a.purpose IN ('WALLET_PAID', 'WALLET_PROMO')), 2, 'activation : comptes payé et offert créés');
SELECT is((SELECT count(*)::int FROM media_assignment WHERE media_id = pg_temp.m(1) AND released_at IS NULL), 1,
  'activation : rattachement écrit');
SELECT is((SELECT outcome FROM edge_sync_registry WHERE gateway_id = pg_temp.id('62e001') AND origin_key = 'T1:0001'),
  'ACCEPTED', 'activation : le numéro est au registre dans la même transaction');
-- wallet_id neuf choisi par la passerelle
SELECT pg_temp.run('a2', '62e001', 1, pg_temp.act(pg_temp.nx('62e001'), 'T1', 2, pg_temp.id('62f0cafe')));
SELECT is(pg_temp.res('a2', 'outcome'), 'ACCEPTED', 'activation avec wallet_id neuf : ACCEPTED');
SELECT is((SELECT wallet_id FROM media WHERE id = pg_temp.m(2)), pg_temp.id('62f0cafe'), 'le wallet_id donné devient le portefeuille');
-- préchargement
SELECT pg_temp.run('a3', '62e001', 1, pg_temp.act(pg_temp.nx('62e001'), 'T1', 5));
SELECT is(pg_temp.res('a3', 'outcome'), 'ACCEPTED', 'activation avec préchargement : ACCEPTED');
SELECT is((SELECT source FROM journal_transaction WHERE id = (SELECT tx FROM r WHERE name = 'a3')), 'EDGE_SYNC',
  'préchargement en source EDGE_SYNC');
SELECT is((SELECT idempotency_key FROM journal_transaction WHERE id = (SELECT tx FROM r WHERE name = 'a3')),
  'preload:' || pg_temp.m(5) || ':1', 'préchargement : clé preload:<bracelet>:<n> (comme preload_media)');
SELECT ok((SELECT metadata ? 'origin_key' AND metadata ? 'origin_occurred_at' AND metadata ? 'origin_mode'
             FROM journal_transaction WHERE id = (SELECT tx FROM r WHERE name = 'a3')), 'préchargement : métadonnées d''origine');
SELECT is((SELECT -sum(ab.balance)::bigint FROM account a JOIN account_balance ab ON ab.account_id = a.id
            JOIN media m ON m.wallet_id = a.wallet_id WHERE m.id = pg_temp.m(5) AND a.purpose = 'WALLET_PROMO'), 500::bigint,
  'préchargement : 500 offerts sur le portefeuille créé');
-- wallet_id existant d'un AUTRE bracelet : refus, aucun rattachement
SELECT pg_temp.run('a4', '62e001', 1, pg_temp.act(pg_temp.nx('62e001'), 'T1', 4, pg_temp.id('62f0cafe')));
SELECT is(pg_temp.res('a4', 'outcome') || '/' || pg_temp.res('a4', 'reason') || '/' || pg_temp.res('a4', 'detail'),
  'REJECTED/MALFORMED_OPERATION/WALLET_ID_EXISTS', 'wallet_id d''un autre bracelet : refus MALFORMED_OPERATION');
SELECT is((SELECT wallet_id FROM media WHERE id = pg_temp.m(4)), NULL, 'le bracelet n''est PAS rattaché au portefeuille étranger');
SELECT is((SELECT count(*)::int FROM media_assignment WHERE wallet_id = pg_temp.id('62f0cafe')), 1,
  'le portefeuille étranger garde son seul rattachement');
SELECT ok((pg_temp.anom('NON_COMPLIANT_OPERATION', 'T1:' || lpad((SELECT edge_seq::text FROM edge_sync_registry WHERE origin_key LIKE 'T1:%'
            AND reason = 'MALFORMED_OPERATION' ORDER BY edge_seq LIMIT 1), 4, '0'))).device_id = pg_temp.id('62aa01'),
  'wallet_id étranger : anomalie portant le terminal');
-- wallet_id existant du portefeuille d'un bracelet actif de la caisse, avec le bon bracelet mais ... réactivation du même bracelet
SELECT pg_temp.run('a5a', '62e001', 1, pg_temp.act(pg_temp.nx('62e001'), 'T1', 8));
UPDATE media_assignment SET released_at = now(), release_reason = 'RETURNED' WHERE media_id = pg_temp.m(8);
UPDATE media SET wallet_id = NULL, status = 'RELEASED' WHERE id = pg_temp.m(8);
UPDATE media SET status = 'ISSUED' WHERE id = pg_temp.m(8);
SELECT pg_temp.run('a5', '62e001', 1, pg_temp.act(pg_temp.nx('62e001'), 'T1', 8,
  (SELECT wallet_id FROM media_assignment WHERE media_id = pg_temp.m(8) LIMIT 1)));
SELECT is(pg_temp.res('a5', 'outcome') || '/' || coalesce(pg_temp.res('a5', 'detail'), ''), 'ACCEPTED/',
  'réactivation du MEME bracelet avec son portefeuille : admise (' || coalesce(pg_temp.res('a5', 'detail'), '') || ')');
SELECT is((SELECT wallet_id FROM media WHERE id = pg_temp.m(8)),
  (SELECT wallet_id FROM media_assignment WHERE media_id = pg_temp.m(8) ORDER BY id LIMIT 1), 'même portefeuille qu''avant');
-- mode d'activation non autorisé (CL020)
SELECT pg_temp.run('a6', '62e006', 1, jsonb_set(pg_temp.act(pg_temp.nx('62e006'), 'T6', 11), '{edge_guichet,event_id}',
  to_jsonb(pg_temp.id('62d006')::text)));
SELECT is(pg_temp.res('a6', 'outcome') || '/' || pg_temp.res('a6', 'reason') || '/' || pg_temp.res('a6', 'detail'),
  'REJECTED/EDGE_REPLAY_FAILED/CL020', 'mode DESK non autorisé : REJECTED / EDGE_REPLAY_FAILED, détail CL020');
SELECT is((SELECT status FROM media WHERE id = pg_temp.m(11)), 'PERSONALIZED', 'mode refusé : bracelet inchangé');
SELECT is((SELECT count(*)::int FROM wallet WHERE ledger_id = pg_temp.ledger_of('62d006')), 0,
  'mode refusé : aucun portefeuille laissé par la sous-transaction');
SELECT ok((pg_temp.anom('EDGE_REPLAY_FAILED', 'T6:0001')).id IS NOT NULL, 'mode refusé : anomalie EDGE_REPLAY_FAILED');
SELECT is((pg_temp.anom('EDGE_REPLAY_FAILED', 'T6:0001')).device_id, pg_temp.id('62aa06'), 'anomalie : terminal');
-- même requête au central (registre d'idempotence), sans préchargement : numéro consommé sans effet
INSERT INTO api_idempotency (operator_id, scope, idempotency_key, request_hash, status, response_status, completed_at, expires_at)
VALUES (pg_temp.id('62a001'), 'device:' || pg_temp.id('62aa01') || ':', 'T1:' || lpad((pg_temp.nx('62e001'))::text, 4, '0'), repeat('a', 64),
        'COMPLETED', 201, now(), now() + interval '1 day');
SELECT pg_temp.run('a7', '62e001', 1, pg_temp.act(pg_temp.nx('62e001'), 'T1', 9));
SELECT is(pg_temp.res('a7', 'outcome') || '/' || pg_temp.res('a7', 'reason'), 'VOID/DUPLICATE_ORIGIN_KEY',
  'requête déjà exécutée au central, sans écriture connue : VOID / DUPLICATE_ORIGIN_KEY (le registre exige une écriture pour DUPLICATE)');
SELECT is((SELECT status FROM media WHERE id = pg_temp.m(9)), 'PERSONALIZED', 'doublon central : le bracelet n''est pas ré-activé');
-- même requête au central, AVEC préchargement : DUPLICATE portant l'écriture
-- M3 : une clé terminée en 2xx sur une AUTRE portée (autre route / autre terminal) n'est pas un doublon
INSERT INTO api_idempotency (operator_id, scope, idempotency_key, request_hash, status, response_status, completed_at, expires_at)
VALUES (pg_temp.id('62a001'), 'POST /media/activations', 'T1:' || lpad((pg_temp.nx('62e001'))::text, 4, '0'), repeat('c', 64),
        'COMPLETED', 201, now(), now() + interval '1 day'),
       (pg_temp.id('62a001'), 'device:' || pg_temp.id('62aa02') || ':', 'T1:' || lpad((pg_temp.nx('62e001'))::text, 4, '0'), repeat('d', 64),
        'COMPLETED', 201, now(), now() + interval '1 day');
SELECT pg_temp.run('a7b', '62e001', 1, pg_temp.act(pg_temp.nx('62e001'), 'T1', 3));
SELECT is(pg_temp.res('a7b', 'outcome'), 'ACCEPTED', 'clé terminée sur une autre portée : pas un doublon, activation ACCEPTED');
SELECT pg_temp.run('a8a', '62e001', 1, pg_temp.act(pg_temp.nx('62e001'), 'T1', 10));
INSERT INTO api_idempotency (operator_id, scope, idempotency_key, request_hash, status, response_status, completed_at, expires_at)
VALUES (pg_temp.id('62a001'), 'device:' || pg_temp.id('62aa01') || ':', 'T1:' || lpad((pg_temp.nx('62e001'))::text, 4, '0'), repeat('b', 64),
        'COMPLETED', 200, now(), now() + interval '1 day');
SELECT pg_temp.run('a8', '62e001', 1, pg_temp.act(pg_temp.nx('62e001'), 'T1', 10));
SELECT is(pg_temp.res('a8', 'outcome'), 'DUPLICATE', 'requête déjà exécutée au central, avec préchargement : DUPLICATE');
SELECT is(pg_temp.res('a8', 'tx'), (SELECT tx::text FROM r WHERE name = 'a8a'), 'DUPLICATE : l''écriture du préchargement');
-- autre clé sur un bracelet déjà actif
SELECT pg_temp.run('a9', '62e001', 1, pg_temp.act(pg_temp.nx('62e001'), 'T1', 1));
SELECT is(pg_temp.res('a9', 'outcome') || '/' || pg_temp.res('a9', 'reason') || '/' || pg_temp.res('a9', 'detail'),
  'REJECTED/EDGE_REPLAY_FAILED/MEDIA_ALREADY_ACTIVE', 'autre clé sur bracelet actif : EDGE_REPLAY_FAILED');
SELECT ok(pg_temp.res('a9', 'tx') IS NULL, 'rejeu impossible : aucun transaction_id');
SELECT is((SELECT count(*)::int FROM edge_sync_registry WHERE outcome = 'REJECTED' AND reason = 'EDGE_REPLAY_FAILED'
            AND transaction_id IS NULL AND origin_key LIKE 'T1:%'), 1, 'le registre garde le rejet, sans écriture');
-- bracelet d'un autre événement, lot non actif
SELECT pg_temp.run('a10', '62e001', 1, pg_temp.act(pg_temp.nx('62e001'), 'T1', 6));
SELECT is(pg_temp.res('a10', 'detail'), 'MEDIA_WRONG_EVENT', 'bracelet d''un autre événement : refus');
SELECT pg_temp.run('a11', '62e001', 1, pg_temp.act(pg_temp.nx('62e001'), 'T1', 7));
SELECT is(pg_temp.res('a11', 'detail'), 'MEDIA_BATCH_INACTIVE', 'lot non actif : refus');
-- mauvais type pour la fonction
DO $$ BEGIN
  PERFORM set_config('app.gateway_id', pg_temp.id('62e001')::text, true);
  INSERT INTO r SELECT 'a12', x.* FROM edge_activate_media(pg_temp.id('62e001'), 1, pg_temp.nx('62e001'),
    'T1:' || lpad(pg_temp.nx('62e001')::text, 4, '0'), sha256('x'), pg_temp.top(pg_temp.nx('62e001'), 'T1', 30, 100)) x;
END $$;
SELECT is(pg_temp.res('a12', 'detail'), 'WRONG_ENVELOPE', 'TOPUP_CASH envoyé à edge_activate_media : WRONG_ENVELOPE');
-- activation : fonctions éprouvées intactes
SELECT is((SELECT count(*)::int FROM pg_proc WHERE proname IN ('activate_media', 'take_deposit', 'take_deposit_for_session', 'preload_media')
            AND prosrc ~ 'EDGE_SYNC'), 0, 'activate_media, take_deposit, take_deposit_for_session, preload_media ne mentionnent pas EDGE_SYNC (inchangées)');

-- 3. Caution ----------------------------------------------------------------------------------------------------
SELECT pg_temp.run('d1', '62e001', 1, pg_temp.dep(pg_temp.nx('62e001'), 'T1', 20, 3000, pg_temp.caisse('62aa01')), '#deposit');
SELECT is(pg_temp.res('d1', 'outcome'), 'ACCEPTED', 'caution en espèces avec session OPEN : ACCEPTED');
SELECT is((SELECT source || '/' || type FROM journal_transaction WHERE id = (SELECT tx FROM r WHERE name = 'd1')),
  'EDGE_SYNC/DEPOSIT_TAKEN', 'caution : source EDGE_SYNC, type DEPOSIT_TAKEN');
SELECT is((SELECT idempotency_key FROM journal_transaction WHERE id = (SELECT tx FROM r WHERE name = 'd1')),
  (SELECT origin_key FROM edge_sync_registry WHERE transaction_id = (SELECT tx FROM r WHERE name = 'd1')),
  'caution : clé d''idempotence = clé d''origine (avec #deposit)');
SELECT ok((SELECT idempotency_key LIKE '%#deposit' FROM journal_transaction WHERE id = (SELECT tx FROM r WHERE name = 'd1')),
  'clé ...#deposit');
SELECT is(pg_temp.bal(pg_temp.caisse('62aa01')), 3000::bigint, 'caution : la caisse du terminal est débitée de 3 000 (espèces reçues)');
SELECT is((SELECT deposit_status || '/' || deposit_held FROM media WHERE id = pg_temp.m(20)), 'HELD/3000', 'caution : bracelet HELD');
SELECT is((SELECT count(*)::int FROM cash_session_tx WHERE tx_id = (SELECT tx FROM r WHERE name = 'd1')), 1, 'caution rattachée à la session');
-- compte de caisse forcé dans la requête : refus
SELECT pg_temp.run('d2', '62e001', 1, pg_temp.dep(pg_temp.nx('62e001'), 'T1', 21, 3000, pg_temp.caisse('62aa08')), '#deposit');
SELECT is(pg_temp.res('d2', 'outcome') || '/' || pg_temp.res('d2', 'reason') || '/' || pg_temp.res('d2', 'detail'),
  'REJECTED/MALFORMED_OPERATION/CASH_ACCOUNT_MISMATCH', 'compte de caisse d''un autre terminal : MALFORMED_OPERATION');
SELECT is(pg_temp.bal(pg_temp.caisse('62aa08')), 0::bigint, 'compte forcé : la caisse visée n''a reçu aucun centime');
SELECT is((SELECT deposit_status FROM media WHERE id = pg_temp.m(21)), 'NONE', 'compte forcé : bracelet inchangé');
SELECT is((SELECT amount FROM anomaly WHERE kind = 'NON_COMPLIANT_OPERATION' AND detail ->> 'detail' = 'CASH_ACCOUNT_MISMATCH'), 3000::bigint,
  'compte forcé : anomalie avec le montant');
-- sans cash_desk_account_id : la caisse vient de la session (jamais de la requête)
SELECT pg_temp.run('d3', '62e001', 1, pg_temp.dep(pg_temp.nx('62e001'), 'T1', 21, 3000), '#deposit');
SELECT is(pg_temp.res('d3', 'outcome'), 'ACCEPTED', 'caution sans compte dans la requête : ACCEPTED');
SELECT is(pg_temp.bal(pg_temp.caisse('62aa01')), 6000::bigint, 'caution : toujours la caisse de la session de T1');
-- session fermée (T2) : aucune écriture, anomalie avec montant, aucune erreur CL029 remontée
SELECT pg_temp.run('d4', '62e001', 1, pg_temp.dep(pg_temp.nx('62e001'), 'T2', 22, 3000));
SELECT is(pg_temp.res('d4', 'outcome') || '/' || pg_temp.res('d4', 'reason') || '/' || pg_temp.res('d4', 'detail'),
  'REJECTED/EDGE_REPLAY_FAILED/CASH_SESSION_NOT_OPEN', 'session fermée : EDGE_REPLAY_FAILED (aucun CL029 remonté)');
SELECT is((SELECT count(*)::int FROM posting WHERE account_id = pg_temp.caisse('62aa02')), 0, 'session fermée : aucune écriture sur la caisse');
SELECT is((pg_temp.anom('EDGE_REPLAY_FAILED', (SELECT origin_key FROM edge_sync_registry WHERE gateway_id = pg_temp.id('62e001')
            AND reason = 'EDGE_REPLAY_FAILED' ORDER BY edge_seq DESC LIMIT 1))).amount, 3000::bigint, 'session fermée : l''anomalie porte le montant');
SELECT is((SELECT device_id FROM anomaly WHERE kind = 'EDGE_REPLAY_FAILED' AND amount = 3000), pg_temp.id('62aa02'),
  'session fermée : l''anomalie porte le terminal');
SELECT is((SELECT deposit_status FROM media WHERE id = pg_temp.m(22)), 'NONE', 'session fermée : bracelet sans caution');
-- terminal sans session, et session ouverte après le début du cycle (R-24)
SELECT pg_temp.run('d5', '62e001', 1, pg_temp.dep(pg_temp.nx('62e001'), 'T3', 22, 3000));
SELECT is(pg_temp.res('d5', 'detail'), 'CASH_SESSION_NOT_OPEN', 'terminal sans session : EDGE_REPLAY_FAILED');
SELECT pg_temp.run('d6', '62e001', 1, pg_temp.dep(pg_temp.nx('62e001'), 'T5', 22, 3000));
SELECT is(pg_temp.res('d6', 'detail'), 'CASH_SESSION_NOT_OPEN', 'session ouverte après le début du cycle EDGE : non servie');
SELECT is(pg_temp.bal(pg_temp.caisse('62aa05')), 0::bigint, 'session tardive : rien d''écrit sur sa caisse');
-- FROM_BALANCE refusé
SELECT pg_temp.run('d7', '62e001', 1, pg_temp.dep(pg_temp.nx('62e001'), 'T1', 24, 3000));
SELECT is(pg_temp.res('d7', 'reason') || '/' || pg_temp.res('d7', 'detail'), 'MALFORMED_OPERATION/DEPOSIT_FROM_BALANCE_REFUSED',
  'caution FROM_BALANCE : refusée');
SELECT is((SELECT deposit_status FROM media WHERE id = pg_temp.m(24)), 'NONE', 'FROM_BALANCE : aucun effet');
-- caution déjà HELD : rejeu impossible, écriture d'attente (session OPEN)
SELECT pg_temp.run('d8', '62e001', 1, pg_temp.dep(pg_temp.nx('62e001'), 'T1', 25, 3000));
SELECT is(pg_temp.res('d8', 'reason') || '/' || pg_temp.res('d8', 'detail'), 'EDGE_REPLAY_FAILED/DEPOSIT_ALREADY_HELD',
  'caution déjà détenue : EDGE_REPLAY_FAILED');
SELECT ok(pg_temp.res('d8', 'tx') IS NULL, 'le résultat ne porte pas de transaction_id');
SELECT is(pg_temp.lines((SELECT transaction_id FROM anomaly WHERE kind = 'EDGE_REPLAY_FAILED' AND media_id = pg_temp.m(25))),
  'CASH_DESK:3000,SUSPENSE:-3000', 'espèces en attente : débit de la caisse, crédit S-ATTENTE');
SELECT ok((SELECT (metadata ->> 'replay_failed')::boolean FROM journal_transaction
            WHERE id = (SELECT transaction_id FROM anomaly WHERE kind = 'EDGE_REPLAY_FAILED' AND media_id = pg_temp.m(25))),
  'écriture d''attente : metadata.replay_failed');
SELECT is((SELECT source FROM journal_transaction WHERE id = (SELECT transaction_id FROM anomaly
            WHERE kind = 'EDGE_REPLAY_FAILED' AND media_id = pg_temp.m(25))), 'EDGE_SYNC', 'écriture d''attente en EDGE_SYNC');
SELECT is((SELECT amount FROM anomaly WHERE kind = 'EDGE_REPLAY_FAILED' AND media_id = pg_temp.m(25)), 3000::bigint, 'anomalie : montant');
SELECT is(pg_temp.bal(pg_temp.caisse('62aa01')), 9000::bigint, 'la caisse compte les espèces encaissées (6 000 + 3 000)');
-- montant différent de celui du lot
SELECT pg_temp.run('d9', '62e001', 1, pg_temp.dep(pg_temp.nx('62e001'), 'T1', 26, 2000));
SELECT is(pg_temp.res('d9', 'detail'), 'DEPOSIT_AMOUNT_MISMATCH', 'montant différent du lot : EDGE_REPLAY_FAILED');
SELECT is((SELECT amount FROM anomaly WHERE kind = 'EDGE_REPLAY_FAILED' AND media_id = pg_temp.m(26)), 2000::bigint,
  'l''anomalie porte le montant encaissé déclaré');
SELECT is((SELECT deposit_status FROM media WHERE id = pg_temp.m(26)), 'NONE', 'bracelet sans caution');
-- doublon dans le journal (même clé d'origine)
SELECT post_transaction(pg_temp.ledger_of('62d001'), 'DEPOSIT_TAKEN', 'T7:' || lpad(pg_temp.nx('62e001')::text, 4, '0') || '#deposit', now(), 'EDGE_SYNC',
  jsonb_build_array(jsonb_build_object('account_id', pg_temp.caisse('62aa07'), 'amount', 3000),
                    jsonb_build_object('account_id', pg_temp.acc(pg_temp.ledger_of('62d001'), 'L-ORG-CAUTION'), 'amount', -3000)),
  NULL, NULL, NULL, NULL, NULL, pg_temp.id('62aa07'), pg_temp.m(27));
SELECT pg_temp.run('d10', '62e001', 1, pg_temp.dep(pg_temp.nx('62e001'), 'T7', 27, 3000), '#deposit');
SELECT is(pg_temp.res('d10', 'outcome'), 'DUPLICATE', 'même clé d''origine déjà au journal : DUPLICATE');
SELECT is((SELECT count(*)::int FROM journal_transaction WHERE idempotency_key LIKE 'T7:%#deposit'), 1, 'une seule écriture');
-- garde de caisse ADR-132 intacte
SELECT throws_ok($$SELECT post_transaction(pg_temp.ledger_of('62d001'), 'DEPOSIT_TAKEN', 'guard-1', now(), 'EDGE_SYNC',
  jsonb_build_array(jsonb_build_object('account_id', pg_temp.caisse('62aa02'), 'amount', 100),
                    jsonb_build_object('account_id', pg_temp.acc(pg_temp.ledger_of('62d001'), 'L-ORG-CAUTION'), 'amount', -100)))$$,
  'CL029', NULL, 'écriture EDGE_SYNC sur une caisse sans session OPEN : refusée par la garde (aucune exemption)');

-- 4. Recharge espèces -------------------------------------------------------------------------------------------
SELECT pg_temp.run('t1', '62e001', 1, pg_temp.top(pg_temp.nx('62e001'), 'T1', 30, 30000));
SELECT is(pg_temp.res('t1', 'outcome'), 'ACCEPTED', 'recharge dans la marge : ACCEPTED');
SELECT is(pg_temp.lines((SELECT tx FROM r WHERE name = 't1')), 'CASH_DESK:30000,WALLET_PAID:-30000', 'une seule part');
SELECT is(pg_temp.res('t1', 'charged') || '/' || pg_temp.res('t1', 'shortfall'), '30000/0', 'retour : 30000 au portefeuille, 0 dû');
SELECT is((SELECT count(*)::int FROM anomaly WHERE kind = 'CASH_TOPUP_OVER_LIMIT' AND media_id = pg_temp.m(30)), 0, 'aucune anomalie de plafond');
SELECT is((SELECT source || '/' || type FROM journal_transaction WHERE id = (SELECT tx FROM r WHERE name = 't1')),
  'EDGE_SYNC/TOPUP_CASH', 'recharge : EDGE_SYNC / TOPUP_CASH');
SELECT is((SELECT count(*)::int FROM cash_session_tx WHERE tx_id = (SELECT tx FROM r WHERE name = 't1')), 1, 'recharge rattachée à la session');
SELECT is((SELECT metadata ->> 'origin_key' FROM journal_transaction WHERE id = (SELECT tx FROM r WHERE name = 't1')),
  (SELECT origin_key FROM edge_sync_registry WHERE transaction_id = (SELECT tx FROM r WHERE name = 't1')), 'clé d''origine en métadonnée');
-- au-delà du plafond : deux parts, ACCEPTED, anomalie, jamais rejetée
SELECT pg_temp.run('t2', '62e001', 1, pg_temp.top(pg_temp.nx('62e001'), 'T1', 31, 30000));
SELECT is(pg_temp.res('t2', 'outcome'), 'ACCEPTED', 'recharge au-delà du plafond : ACCEPTED (jamais rejetée)');
SELECT is(pg_temp.lines((SELECT tx FROM r WHERE name = 't2')), 'CASH_DESK:30000,WALLET_PAID:-10000,CUSTOMER_CASH_DUE:-20000',
  'deux parts : 10 000 au portefeuille, 20 000 en espèces dues');
SELECT is(pg_temp.res('t2', 'charged') || '/' || pg_temp.res('t2', 'shortfall'), '10000/20000', 'retour : parts');
SELECT is((SELECT amount FROM anomaly WHERE kind = 'CASH_TOPUP_OVER_LIMIT' AND media_id = pg_temp.m(31)), 20000::bigint,
  'anomalie CASH_TOPUP_OVER_LIMIT : media_id et montant dû');
SELECT is((SELECT sum(po.amount)::bigint FROM posting po WHERE po.transaction_id = (SELECT tx FROM r WHERE name = 't2')), 0::bigint,
  'somme nulle');
SELECT is(pg_temp.bal(pg_temp.acc(pg_temp.ledger_of('62d001'), 'L-WAL-31-P')), -100000::bigint, 'solde du portefeuille : au plafond, pas au-delà');
-- résolution à deux : refund_cash_due (la somme ne dépasse pas cash_refund_single_max)
SELECT refund_cash_due(pg_temp.m(31), pg_temp.caisse('62aa01'), 'refund-31', pg_temp.id('62ea01'), NULL, pg_temp.id('62aa01'));
SELECT is((SELECT status FROM anomaly WHERE kind = 'CASH_TOPUP_OVER_LIMIT' AND media_id = pg_temp.m(31)), 'RESOLVED',
  'l''anomalie est résolue par refund_cash_due');
-- marge nulle : tout en espèces dues
SELECT pg_temp.run('t3', '62e001', 1, pg_temp.top(pg_temp.nx('62e001'), 'T1', 32, 20000));
SELECT is(pg_temp.res('t3', 'outcome') || '/' || pg_temp.res('t3', 'charged') || '/' || pg_temp.res('t3', 'shortfall'), 'ACCEPTED/0/20000',
  'marge nulle : ACCEPTED, tout en espèces dues');
SELECT is(pg_temp.lines((SELECT tx FROM r WHERE name = 't3')), 'CASH_DESK:20000,CUSTOMER_CASH_DUE:-20000', 'marge nulle : deux lignes');
-- bracelet désigné par token_hash (tap)
SELECT pg_temp.run('t4', '62e001', 1, pg_temp.top(pg_temp.nx('62e001'), 'T1', 36, 5000, true));
SELECT is(pg_temp.res('t4', 'outcome'), 'ACCEPTED', 'bracelet désigné par token_hash : ACCEPTED');
SELECT pg_temp.run('t4b', '62e001', 1, jsonb_set(pg_temp.top(pg_temp.nx('62e001'), 'T1', 36, 5000, true), '{edge_guichet}',
  jsonb_build_object('media_id', pg_temp.m(37))));
SELECT is(pg_temp.res('t4b', 'detail'), 'MEDIA_UNKNOWN', 'token_hash et media_id discordants : EDGE_REPLAY_FAILED');
-- session fermée : anomalie avec montant, terminal et clé d'origine
SELECT pg_temp.run('t5', '62e001', 1, pg_temp.top(pg_temp.nx('62e001'), 'T2', 38, 12000));
SELECT is(pg_temp.res('t5', 'outcome') || '/' || pg_temp.res('t5', 'reason') || '/' || pg_temp.res('t5', 'detail'),
  'REJECTED/EDGE_REPLAY_FAILED/CASH_SESSION_NOT_OPEN', 'recharge sur session fermée : EDGE_REPLAY_FAILED, jamais un rejet muet');
SELECT is((SELECT amount || '/' || device_id FROM anomaly WHERE kind = 'EDGE_REPLAY_FAILED' AND detail ->> 'origin_key' =
            (SELECT origin_key FROM edge_sync_registry WHERE gateway_id = pg_temp.id('62e001') AND origin_key LIKE 'T2:%' AND reason = 'EDGE_REPLAY_FAILED'
              ORDER BY edge_seq DESC LIMIT 1)), '12000/' || pg_temp.id('62aa02'),
  'anomalie : montant et terminal ; la clé d''origine est dans le détail');
SELECT is((SELECT count(*)::int FROM edge_sync_registry WHERE origin_key LIKE 'T2:%' AND outcome = 'REJECTED' AND transaction_id IS NULL), 2,
  'le numéro est enregistré avec son résultat (aucune perte silencieuse)');
SELECT is((SELECT count(*)::int FROM posting WHERE account_id = pg_temp.caisse('62aa02')), 0, 'session fermée : rien sur la caisse');
-- bracelet d'un autre événement
SELECT pg_temp.run('t6', '62e001', 1, pg_temp.top(pg_temp.nx('62e001'), 'T1', 39, 7000));
SELECT is(pg_temp.res('t6', 'reason') || '/' || pg_temp.res('t6', 'detail'), 'EDGE_REPLAY_FAILED/MEDIA_WRONG_EVENT', 'bracelet d''un autre événement : refus');
SELECT is((SELECT amount FROM anomaly WHERE kind = 'EDGE_REPLAY_FAILED' AND detail ->> 'code' = 'MEDIA_WRONG_EVENT' AND media_id = pg_temp.m(39)), 7000::bigint, 'anomalie : montant');
-- montant invalide
SELECT pg_temp.run('t7', '62e001', 1, jsonb_set(pg_temp.top(pg_temp.nx('62e001'), 'T1', 30, 100), '{amount}', '0'::jsonb));
SELECT is(pg_temp.res('t7', 'reason') || '/' || pg_temp.res('t7', 'detail'), 'MALFORMED_OPERATION/AMOUNT', 'montant nul : MALFORMED_OPERATION');
-- doublon de clé d'origine déjà au journal
SELECT post_transaction(pg_temp.ledger_of('62d001'), 'TOPUP_CASH', 'T7:' || lpad(pg_temp.nx('62e001')::text, 4, '0'), now(), 'EDGE_SYNC',
  jsonb_build_array(jsonb_build_object('account_id', pg_temp.caisse('62aa07'), 'amount', 4000),
                    jsonb_build_object('account_id', pg_temp.acc(pg_temp.ledger_of('62d001'), 'L-WAL-37-P'), 'amount', -4000)),
  NULL, NULL, NULL, NULL, NULL, pg_temp.id('62aa07'), pg_temp.m(37));
SELECT pg_temp.run('t8', '62e001', 1, pg_temp.top(pg_temp.nx('62e001'), 'T7', 37, 4000));
SELECT is(pg_temp.res('t8', 'outcome') || '/' || pg_temp.res('t8', 'charged'), 'DUPLICATE/4000', 'recharge rejouée avec la même clé : DUPLICATE (charged repris des lignes)');
-- Aucun ordre d'arrivée ne contourne le plafond de solde : 20 000 + 50 000 + 60 000 = 130 000 sur un portefeuille plafonné à 100 000
SELECT pg_temp.run('ord_asc_1', '62e001', 1, pg_temp.top(pg_temp.nx('62e001'), 'T8', 33, 20000));
SELECT pg_temp.run('ord_asc_2', '62e001', 1, pg_temp.top(pg_temp.nx('62e001'), 'T8', 33, 50000));
SELECT pg_temp.run('ord_asc_3', '62e001', 1, pg_temp.top(pg_temp.nx('62e001'), 'T8', 33, 60000));
SELECT pg_temp.run('ord_desc_1', '62e001', 1, pg_temp.top(pg_temp.nx('62e001'), 'T8', 34, 60000));
SELECT pg_temp.run('ord_desc_2', '62e001', 1, pg_temp.top(pg_temp.nx('62e001'), 'T8', 34, 50000));
SELECT pg_temp.run('ord_desc_3', '62e001', 1, pg_temp.top(pg_temp.nx('62e001'), 'T8', 34, 20000));
SELECT pg_temp.run('ord_mix_1', '62e001', 1, pg_temp.top(pg_temp.nx('62e001'), 'T8', 35, 50000));
SELECT pg_temp.run('ord_mix_2', '62e001', 1, pg_temp.top(pg_temp.nx('62e001'), 'T8', 35, 20000));
SELECT pg_temp.run('ord_mix_3', '62e001', 1, pg_temp.top(pg_temp.nx('62e001'), 'T8', 35, 60000));
SELECT is((SELECT array_agg(-pg_temp.bal(pg_temp.acc(pg_temp.ledger_of('62d001'), 'L-WAL-' || n || '-P')) ORDER BY n)
             FROM generate_series(33, 35) n), ARRAY[100000, 100000, 100000]::bigint[],
  'croissant, décroissant, mélangé : chaque portefeuille s''arrête au plafond de 100 000');
SELECT is((SELECT array_agg(s ORDER BY n) FROM (SELECT n, coalesce(sum(a.amount), 0)::bigint s FROM generate_series(33, 35) n
             LEFT JOIN anomaly a ON a.media_id = pg_temp.m(n) AND a.kind = 'CASH_TOPUP_OVER_LIMIT' GROUP BY n) z),
  ARRAY[30000, 30000, 30000]::bigint[], 'tous ordres : 30 000 en espèces dues (la somme des parts égale la somme des montants)');
SELECT is((SELECT count(*)::int FROM r WHERE name ~ '^ord_' AND outcome <> 'ACCEPTED'), 0, 'aucune des neuf recharges n''est rejetée pour un plafond');

-- 4 bis. Date d'origine bornée (B1) : [début du cycle - 15 min ; maintenant + 15 min], comme 0061 (v_eff) ------------------
-- Les profils sont immuables : événement d010 avec son profil (plafond mensuel 5 000), terminal T10 et sa caisse.
INSERT INTO jurisdiction_profile (id, country_code, version, valid_from, breakage_destination, unidentified_max_balance,
                                  unidentified_monthly_limit)
VALUES (pg_temp.id('62c002'), 'SN', 620063, '2026-01-01', 'ORGANIZER', 100000, 5000);
SELECT pg_temp.mk_event('62d010', '62e010', 'GW10', 'PRIMARY', ARRAY['DESK']);
SELECT pg_temp.a();
UPDATE event SET jurisdiction_id = pg_temp.id('62c002') WHERE id = pg_temp.id('62d010');
INSERT INTO device (id, operator_id, kind, app_mode, event_id, serial)
VALUES (pg_temp.id('62aa10'), pg_temp.id('62a001'), 'TOPUP', 'TOPUP_DESK', pg_temp.id('62d010'), 'T10');
SELECT pg_temp.mk_session('62aa10', '62d010', 'OPEN', '2026-01-01');
SELECT pg_temp.mk_wallet(n, '62d010', 0, NULL) FROM generate_series(40, 43) n;
SELECT pg_temp.a();
CREATE FUNCTION pg_temp.at(p_op jsonb, p_when text) RETURNS jsonb LANGUAGE sql AS
  $$ SELECT jsonb_set(p_op, '{occurred_at}', to_jsonb(p_when)) $$;
-- 2020, 1999, 2099 : après une recharge de 5 000 datée de maintenant, plus rien ne passe au portefeuille.
SELECT pg_temp.run('b1_now', '62e010', 1, pg_temp.top(pg_temp.nx('62e010'), 'T10', 40, 5000));
SELECT pg_temp.run('b1_2020', '62e010', 1, pg_temp.at(pg_temp.top(pg_temp.nx('62e010'), 'T10', 40, 5000), '2020-03-10T10:00:00Z'));
SELECT is(pg_temp.res('b1_now', 'charged') || '/' || pg_temp.res('b1_2020', 'charged') || '/' || pg_temp.res('b1_2020', 'shortfall'),
  '5000/0/5000', 'recharge datée 2020 : la marge est celle du mois courant (0 crédité, 5 000 dus)');
SELECT pg_temp.run('b1_now2', '62e010', 1, pg_temp.top(pg_temp.nx('62e010'), 'T10', 41, 5000));
SELECT pg_temp.run('b1_1999', '62e010', 1, pg_temp.at(pg_temp.top(pg_temp.nx('62e010'), 'T10', 41, 5000), '1999-01-01T00:00:00Z'));
SELECT is(pg_temp.res('b1_1999', 'charged') || '/' || pg_temp.res('b1_1999', 'shortfall'), '0/5000',
  'recharge datée 1999 : 0 crédité, 5 000 dus');
SELECT pg_temp.run('b1_now3', '62e010', 1, pg_temp.top(pg_temp.nx('62e010'), 'T10', 42, 5000));
SELECT pg_temp.run('b1_2099', '62e010', 1, pg_temp.at(pg_temp.top(pg_temp.nx('62e010'), 'T10', 42, 5000), '2099-12-31T23:59:59Z'));
SELECT is(pg_temp.res('b1_2099', 'charged') || '/' || pg_temp.res('b1_2099', 'shortfall'), '0/5000',
  'recharge datée 2099 : 0 crédité, 5 000 dus');
-- Cumul mensuel sur dates fausses : 4 recharges de 5 000, plafond mensuel 5 000 -> 5 000 au portefeuille au plus.
SELECT pg_temp.run('b1_c1', '62e010', 1, pg_temp.top(pg_temp.nx('62e010'), 'T10', 43, 5000));
SELECT pg_temp.run('b1_c2', '62e010', 1, pg_temp.at(pg_temp.top(pg_temp.nx('62e010'), 'T10', 43, 5000), '2024-03-10T10:00:00Z'));
SELECT pg_temp.run('b1_c3', '62e010', 1, pg_temp.at(pg_temp.top(pg_temp.nx('62e010'), 'T10', 43, 5000), '2024-04-10T10:00:00Z'));
SELECT pg_temp.run('b1_c4', '62e010', 1, pg_temp.at(pg_temp.top(pg_temp.nx('62e010'), 'T10', 43, 5000), '2099-01-01T00:00:00Z'));
SELECT is(-pg_temp.bal(pg_temp.acc(pg_temp.ledger_of('62d010'), 'L-WAL-43-P')), 5000::bigint,
  'quatre recharges de 5 000 à dates fausses : le portefeuille ne reçoit pas plus que le plafond mensuel');
SELECT is((SELECT sum(a.amount)::bigint FROM anomaly a WHERE a.kind = 'CASH_TOPUP_OVER_LIMIT' AND a.media_id = pg_temp.m(43)),
  15000::bigint, 'quatre recharges à dates fausses : 15 000 en espèces dues');
-- L'écriture porte la date bornée (jamais 1999 ni 2099) ; la date brute reste en métadonnée.
SELECT ok((SELECT bool_and(t.occurred_at BETWEEN now() - interval '1 hour' AND now() + interval '1 hour')
             FROM journal_transaction t WHERE t.metadata ->> 'origin_key' IN ('T10:' || lpad((SELECT edge_seq::text FROM edge_sync_registry
               WHERE transaction_id = (SELECT tx FROM r WHERE name = 'b1_1999')), 4, '0'), 'T10:' || lpad((SELECT edge_seq::text FROM edge_sync_registry
               WHERE transaction_id = (SELECT tx FROM r WHERE name = 'b1_2099')), 4, '0'))),
  'les écritures datées 1999 et 2099 portent une date bornée');
SELECT is((SELECT metadata ->> 'origin_occurred_at' FROM journal_transaction WHERE id = (SELECT tx FROM r WHERE name = 'b1_1999')),
  '1999-01-01T00:00:00.000Z', 'la date brute reste en métadonnée (origin_occurred_at)');

-- 5. Enveloppe, pour chacune des trois fonctions ---------------------------------------------------------------------
CREATE FUNCTION pg_temp.op_for(p_f text, p_seq bigint, p_serial text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT CASE p_f WHEN 'a' THEN pg_temp.act(p_seq, p_serial, 12) WHEN 'd' THEN pg_temp.dep(p_seq, p_serial, 28, 3000)
                  ELSE pg_temp.top(p_seq, p_serial, 30, 1000) END $$;
CREATE FUNCTION pg_temp.call(p_f text, p_gw uuid, p_epoch bigint, p_seq bigint, p_key text, p_op jsonb) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE o text;
BEGIN
  IF p_f = 'a' THEN SELECT x.outcome INTO o FROM edge_activate_media(p_gw, p_epoch, p_seq, p_key, sha256(convert_to(p_op::text, 'UTF8')), p_op) x;
  ELSIF p_f = 'd' THEN SELECT x.outcome INTO o FROM edge_take_deposit(p_gw, p_epoch, p_seq, p_key, sha256(convert_to(p_op::text, 'UTF8')), p_op) x;
  ELSE SELECT x.outcome INTO o FROM edge_topup_cash(p_gw, p_epoch, p_seq, p_key, sha256(convert_to(p_op::text, 'UTF8')), p_op) x;
  END IF;
  RETURN o;
END $$;
DO $$
DECLARE f text; s bigint; op jsonb; k text; fn text;
BEGIN
  FOREACH f IN ARRAY ARRAY['a', 'd', 'e'] LOOP
    PERFORM pg_temp.a();
    PERFORM set_config('app.gateway_id', pg_temp.id('62e001')::text, true);
    s := pg_temp.nx('62e001'); op := pg_temp.op_for(f, s, 'T1'); k := 'T1:' || lpad((s)::text, 4, '0');
    fn := f;
    -- p_gateway différent de app.gateway_id
    BEGIN
      PERFORM pg_temp.call(f, pg_temp.id('62e004'), 1, s, k, op);
      RAISE EXCEPTION 'attendu 42501 (%)', f;
    EXCEPTION WHEN SQLSTATE '42501' THEN NULL; END;
    -- passerelle révoquée, en attente
    PERFORM set_config('app.gateway_id', pg_temp.id('62e002')::text, true);
    BEGIN PERFORM pg_temp.call(f, pg_temp.id('62e002'), 1, 1, 'T1:0001', op); RAISE EXCEPTION 'attendu CL013 REVOKED (%)', f;
    EXCEPTION WHEN SQLSTATE 'CL013' THEN NULL; END;
    PERFORM set_config('app.gateway_id', pg_temp.id('62e003')::text, true);
    BEGIN PERFORM pg_temp.call(f, pg_temp.id('62e003'), 1, 1, 'T1:0001', op); RAISE EXCEPTION 'attendu CL013 STANDBY (%)', f;
    EXCEPTION WHEN SQLSTATE 'CL013' THEN NULL; END;
    -- époque fausse
    PERFORM set_config('app.gateway_id', pg_temp.id('62e001')::text, true);
    BEGIN PERFORM pg_temp.call(f, pg_temp.id('62e001'), 7, s, k, op); RAISE EXCEPTION 'attendu CL015 (%)', f;
    EXCEPTION WHEN SQLSTATE 'CL015' THEN NULL; END;
    -- autre prestataire
    PERFORM pg_temp.b();
    BEGIN PERFORM pg_temp.call(f, pg_temp.id('62e001'), 1, s, k, op); RAISE EXCEPTION 'attendu P0002 (%)', f;
    EXCEPTION WHEN no_data_found THEN NULL; END;
    PERFORM pg_temp.a();
    -- numéro non suivant
    BEGIN PERFORM pg_temp.call(f, pg_temp.id('62e001'), 1, s + 5, 'T1:' || lpad((s + 5)::text, 4, '0'), pg_temp.op_for(f, s + 5, 'T1'));
      RAISE EXCEPTION 'attendu CL016 (%)', f;
    EXCEPTION WHEN SQLSTATE 'CL016' THEN NULL; END;
  END LOOP;
END $$;
SELECT pass('les trois fonctions : 42501, CL013 (révoquée, STANDBY), CL015, no_data_found (autre prestataire), CL016');
-- Autorité de débit (M1) : grand livre non EDGE, aucun handover actif, vidange TO_CENTRAL RELEASING
SELECT pg_temp.mk_event('62d007', '62e007', 'GW7', 'PRIMARY', ARRAY['DESK']);
SELECT pg_temp.mk_event('62d008', '62e008', 'GW8', 'PRIMARY', ARRAY['DESK']);
SELECT pg_temp.mk_event('62d009', '62e009', 'GW9', 'PRIMARY', ARRAY['DESK']);
SELECT pg_temp.a();
UPDATE ledger SET debit_authority = 'CENTRAL' WHERE id = pg_temp.ledger_of('62d007');
UPDATE debit_authority_handover SET status = 'COMPLETED' WHERE ledger_id = pg_temp.ledger_of('62d008');
INSERT INTO debit_authority_handover (operator_id, ledger_id, edge_gateway_id, direction, status, epoch,
                                      watermark_posting_id, requested_by, edge_handover_id)
SELECT pg_temp.id('62a001'), ledger_id, edge_gateway_id, 'TO_CENTRAL', 'RELEASING', 1, NULL, pg_temp.id('62f001'), id
  FROM debit_authority_handover WHERE ledger_id = pg_temp.ledger_of('62d009');
CREATE FUNCTION pg_temp.auth_call(p_f text, p_gw text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE op jsonb := pg_temp.op_for(p_f, pg_temp.nx(p_gw), 'T1');
BEGIN
  PERFORM set_config('app.gateway_id', pg_temp.id(p_gw)::text, true);
  RETURN pg_temp.call(p_f, pg_temp.id(p_gw), 1, pg_temp.nx(p_gw), 'T1:' || lpad((pg_temp.nx(p_gw))::text, 4, '0'), op);
EXCEPTION WHEN SQLSTATE 'CL013' THEN RETURN 'CL013';
END $$;
SELECT is(pg_temp.auth_call('a', '62e007') || pg_temp.auth_call('d', '62e007') || pg_temp.auth_call('e', '62e007'),
  'CL013CL013CL013', 'debit_authority <> EDGE : CL013 pour les trois fonctions');
SELECT is(pg_temp.auth_call('a', '62e008') || pg_temp.auth_call('d', '62e008') || pg_temp.auth_call('e', '62e008'),
  'CL013CL013CL013', 'aucun handover actif : CL013 pour les trois fonctions');
SELECT is(pg_temp.auth_call('a', '62e009') || pg_temp.auth_call('d', '62e009') || pg_temp.auth_call('e', '62e009'),
  'REJECTEDREJECTEDREJECTED', 'handover TO_CENTRAL RELEASING : vidange acceptée (pas de CL013), rejet métier enregistré');
-- Atomicité : une erreur provoquée après l'écriture annule l'écriture ET le numéro
CREATE TEMP TABLE before AS SELECT contiguous_edge_seq AS seq FROM edge_gateway WHERE id = pg_temp.id('62e001');
CREATE TEMP TABLE jbefore AS SELECT count(*)::int AS n FROM journal_transaction;
DO $$
DECLARE s bigint;
BEGIN
  PERFORM set_config('app.gateway_id', pg_temp.id('62e001')::text, true);
  s := pg_temp.nx('62e001');
  BEGIN
    PERFORM pg_temp.run('atom_t', '62e001', 1, pg_temp.top(s, 'T7', 38, 1000));
    PERFORM pg_temp.run('atom_d', '62e001', 1, pg_temp.dep(s + 1, 'T7', 28, 3000), '#deposit');
    PERFORM pg_temp.run('atom_a', '62e001', 1, pg_temp.act(s + 2, 'T7', 12));
    IF (SELECT count(*) FROM r WHERE name LIKE 'atom_%' AND outcome = 'ACCEPTED') <> 3 THEN
      RAISE EXCEPTION 'les trois écritures devaient réussir avant l''erreur provoquée';
    END IF;
    RAISE EXCEPTION 'erreur provoquée après l''écriture' USING ERRCODE = 'CL999';
  EXCEPTION WHEN SQLSTATE 'CL999' THEN NULL;
  END;
END $$;
SELECT is((SELECT contiguous_edge_seq FROM edge_gateway WHERE id = pg_temp.id('62e001')), (SELECT seq FROM before),
  'erreur après l''écriture : le numéro (edge_record_seq) est annulé avec elle');
SELECT is((SELECT count(*)::int FROM journal_transaction), (SELECT n FROM jbefore), 'erreur après l''écriture : aucune écriture ne reste');
SELECT is((SELECT status FROM media WHERE id = pg_temp.m(12)), 'PERSONALIZED', 'erreur après l''écriture : le bracelet est inchangé');
-- Même numéro, autre contenu : CL002
SELECT throws_ok($$SELECT pg_temp.call('t', pg_temp.id('62e001'), 1, 1, 'T1:0001', pg_temp.top(1, 'T1', 30, 999))$$, 'CL002', NULL,
  'même numéro, autre contenu : CL002');
-- Rejeu d'un numéro déjà au registre : résultat mémorisé, aucune écriture nouvelle
CREATE TEMP TABLE jb2 AS SELECT count(*)::int AS n FROM journal_transaction;
SELECT is((SELECT outcome FROM edge_topup_cash(pg_temp.id('62e001'), 1, (SELECT edge_seq FROM edge_sync_registry WHERE transaction_id = (SELECT tx FROM r WHERE name = 't1')),
            (SELECT origin_key FROM edge_sync_registry WHERE transaction_id = (SELECT tx FROM r WHERE name = 't1')),
            sha256(convert_to((SELECT op FROM ops WHERE name = 't1')::text, 'UTF8')), (SELECT op FROM ops WHERE name = 't1'))),
  'ACCEPTED', 'numéro déjà au registre : résultat mémorisé');
SELECT is((SELECT count(*)::int FROM journal_transaction), (SELECT n FROM jb2), 'rejeu d''un numéro : aucune écriture nouvelle');

-- 6. Invariants généraux ---------------------------------------------------------------------------------------------
SELECT is((SELECT count(*)::int FROM (SELECT t.id FROM journal_transaction t JOIN posting po ON po.transaction_id = t.id
            WHERE t.source = 'EDGE_SYNC' GROUP BY t.id HAVING sum(po.amount) <> 0) z), 0, 'toute transaction EDGE_SYNC est de somme nulle');
SELECT is((SELECT count(*)::int FROM edge_sync_registry WHERE outcome = 'REJECTED' AND (reason IS NULL OR transaction_id IS NOT NULL)), 0,
  'aucun rejet sans raison, aucun rejet avec écriture');
SELECT is((SELECT count(*)::int FROM edge_sync_registry WHERE gateway_id = pg_temp.id('62e001'))::bigint,
  (SELECT contiguous_edge_seq FROM edge_gateway WHERE id = pg_temp.id('62e001')), 'numérotation continue : un numéro par résultat');
SELECT is((SELECT count(*)::int FROM journal_transaction t WHERE t.source = 'EDGE_SYNC'
            AND t.metadata <> '{}'::jsonb   -- hors les deux écritures posées à la main comme doublons
            AND NOT (t.metadata ? 'origin_key' AND t.metadata ? 'origin_occurred_at' AND t.metadata ? 'origin_mode')), 0,
  'métadonnées d''origine sur toute écriture EDGE_SYNC');
SELECT is((SELECT count(*)::int FROM anomaly a WHERE a.kind = 'EDGE_REPLAY_FAILED' AND (a.detail ->> 'origin_key') IS NULL), 0,
  'toute anomalie de rejeu porte la clé d''origine');
SELECT * FROM finish();
ROLLBACK;
