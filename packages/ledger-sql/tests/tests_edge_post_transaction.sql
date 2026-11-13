-- Enveloppe edge_post_transaction, bornes de décision et réglages de plafonds (migration 0061 ; mission
-- passerelle-locale, lot WP06 ; FR-018, FR-038) — pgTAP, écrit à la main, SOUS LE PROPRIETAIRE (les droits sont en WP09).
-- Lancer depuis packages/ledger-sql : pg_prove -d <base> tests/tests_edge_post_transaction.sql
-- Ce que la suite NE prouve PAS : la concurrence réelle (deux connexions) ; la présence du verrou FOR UPDATE n'est
-- prouvée ici que par lecture du texte de la fonction (ordre FOR UPDATE avant lecture du solde) et par le rognage
-- séquentiel ; la preuve à deux connexions est faite par la relecture et par le banc de WP25. Les droits par rôle
-- (EXECUTE) sont ceux de WP09.
\set ON_ERROR_STOP 1
\set QUIET 1
BEGIN;
\ir _grants_for_tests.sql
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

CREATE FUNCTION pg_temp.id(p text) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT ('00000000-0000-0000-0000-' || lpad(p, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.a() RETURNS void LANGUAGE sql AS
  $$ SELECT set_config('app.operator_id', pg_temp.id('61a001')::text, true) $$;
CREATE FUNCTION pg_temp.ledger_of(p text) RETURNS uuid LANGUAGE sql AS
  $$ SELECT id FROM ledger WHERE scope_type = 'EVENT' AND scope_id = pg_temp.id(p) $$;
CREATE FUNCTION pg_temp.acc(p_ledger uuid, p_code text) RETURNS uuid LANGUAGE sql AS
  $$ SELECT id FROM account WHERE ledger_id = p_ledger AND code = p_code $$;
CREATE FUNCTION pg_temp.nx(p text) RETURNS bigint LANGUAGE sql AS
  $$ SELECT contiguous_edge_seq + 1 FROM edge_gateway WHERE id = pg_temp.id(p) $$;
CREATE FUNCTION pg_temp.ts(p timestamptz DEFAULT clock_timestamp()) RETURNS text LANGUAGE sql AS
  $$ SELECT to_char(p AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') $$;
-- Solde disponible (convention « positif = disponible ») d'un compte de portefeuille.
CREATE FUNCTION pg_temp.avail(p_wallet text, p_purpose text) RETURNS bigint LANGUAGE sql AS
  $$ SELECT coalesce(-(SELECT ab.balance FROM account_balance ab JOIN account a ON a.id = ab.account_id
                        WHERE a.wallet_id = pg_temp.id(p_wallet) AND a.purpose = p_purpose), 0) $$;
CREATE FUNCTION pg_temp.lines(p_tx uuid) RETURNS text LANGUAGE sql AS
  $$ SELECT string_agg(a.purpose || ':' || po.amount, ',' ORDER BY po.line_no)
       FROM posting po JOIN account a ON a.id = po.account_id WHERE po.transaction_id = p_tx $$;

-- Données (propriétaire) ---------------------------------------------------------------------------------------
INSERT INTO party (kind, legal_name) SELECT 'PLATFORM', 'Plateforme (test)'
 WHERE NOT EXISTS (SELECT 1 FROM party WHERE kind = 'PLATFORM');
INSERT INTO party (id, kind, legal_name, country_code) VALUES
 (pg_temp.id('61a001'), 'OPERATOR', 'Prestataire A', 'SN'),
 (pg_temp.id('61a002'), 'OPERATOR', 'Prestataire B', 'CI');
INSERT INTO party (id, kind, operator_id, legal_name) VALUES
 (pg_temp.id('61b001'), 'ORGANIZER', pg_temp.id('61a001'), 'Organisateur A'),
 (pg_temp.id('61b011'), 'ORGANIZER', pg_temp.id('61a002'), 'Organisateur B'),
 (pg_temp.id('61b101'), 'MERCHANT', pg_temp.id('61a001'), 'Commerçant 1'),
 (pg_temp.id('61b102'), 'MERCHANT', pg_temp.id('61a001'), 'Commerçant 2');
INSERT INTO jurisdiction_profile (id, country_code, version, valid_from, breakage_destination)
VALUES (pg_temp.id('61c001'), 'SN', 610061, '2026-01-01', 'ORGANIZER');

-- Un événement complet : grand livre sous la passerelle, handover ACTIVE (époque 1), commerçant, point de vente.
CREATE FUNCTION pg_temp.mk_event(p_event text, p_gw text, p_serial text, p_cur text, p_role text, p_merchant text,
                                 p_handover boolean) RETURNS void LANGUAGE plpgsql AS $$
DECLARE lg uuid;
BEGIN
  PERFORM pg_temp.a();
  INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone, jurisdiction_id, funds_holder, status)
  VALUES (pg_temp.id(p_event), pg_temp.id('61a001'), pg_temp.id('61b001'), 'Événement ' || p_event, p_cur,
          'Africa/Dakar', pg_temp.id('61c001'), 'ORGANIZER', 'LIVE');
  PERFORM open_event_ledger(pg_temp.id(p_event));
  lg := pg_temp.ledger_of(p_event);
  INSERT INTO edge_gateway (id, operator_id, event_id, serial, role)
  VALUES (pg_temp.id(p_gw), pg_temp.id('61a001'), pg_temp.id(p_event), p_serial, p_role);
  IF p_handover THEN
    UPDATE ledger SET debit_authority = 'EDGE', edge_gateway_id = pg_temp.id(p_gw), authority_epoch = 1 WHERE id = lg;
    INSERT INTO debit_authority_handover (operator_id, ledger_id, edge_gateway_id, direction, status, epoch,
                                          watermark_posting_id, requested_by)
    VALUES (pg_temp.id('61a001'), lg, pg_temp.id(p_gw), 'TO_EDGE', 'ACTIVE', 1, 0, pg_temp.id('61f001'));
  END IF;
  IF p_merchant IS NOT NULL THEN
    INSERT INTO merchant_participation (id, operator_id, event_id, merchant_id, link_type, payout_to)
    VALUES (pg_temp.id(p_event || '1'), pg_temp.id('61a001'), pg_temp.id(p_event), pg_temp.id(p_merchant),
            'INTERNAL', pg_temp.id('61b001'));
    INSERT INTO point_of_sale (id, operator_id, participation_id, name)
    VALUES (pg_temp.id(p_event || '2'), pg_temp.id('61a001'), pg_temp.id(p_event || '1'), 'Stand ' || p_event);
    PERFORM open_participation_account(pg_temp.id(p_event || '1'));
  END IF;
END $$;
SELECT pg_temp.mk_event('61d001', '61e001', 'GW1', 'XOF', 'PRIMARY', '61b101', true);   -- cas nominal
SELECT pg_temp.mk_event('61d002', '61e002', 'GW2', 'XOF', 'PRIMARY', NULL, true);        -- sera révoquée
SELECT pg_temp.mk_event('61d003', '61e003', 'GW3', 'XOF', 'STANDBY', NULL, true);        -- STANDBY
SELECT pg_temp.mk_event('61d004', '61e004', 'GW4', 'XOF', 'PRIMARY', '61b102', true);    -- autre grand livre
SELECT pg_temp.mk_event('61d005', '61e005', 'GW5', 'XOF', 'PRIMARY', NULL, false);       -- sans handover
SELECT pg_temp.mk_event('61d009', '61e009', 'GW9', 'XOF', 'PRIMARY', '61b101', true);    -- passerelle hostile
SELECT pg_temp.mk_event('61d010', '61e010', 'GW10', 'EUR', 'PRIMARY', '61b101', true);   -- devise sans plafond
SELECT pg_temp.mk_event('61d011', '61e011', 'GW11', 'XOF', 'PRIMARY', '61b101', true);   -- hostile : heures décroissantes
SELECT pg_temp.mk_event('61d012', '61e012', 'GW12', 'XOF', 'PRIMARY', '61b101', true);   -- hostile : heures mélangées
UPDATE edge_gateway SET status = 'REVOKED' WHERE id = pg_temp.id('61e002');

-- Terminaux : T1 et T2 (point de vente de d001), T3 sans point de vente, TX d'un autre événement ;
-- H1 à H3 : terminaux de la passerelle hostile ; E1 de l'événement en EUR.
INSERT INTO device (id, operator_id, kind, event_id, pos_id, serial)
SELECT pg_temp.id(d), pg_temp.id('61a001'), 'POS', pg_temp.id(e), CASE WHEN p THEN pg_temp.id(e || '2') END, s
  FROM (VALUES ('61aa01','61d001',true,'T1'), ('61aa02','61d001',true,'T2'), ('61aa03','61d001',false,'T3'),
               ('61aa04','61d004',true,'TX'), ('61aa11','61d009',true,'H1'), ('61aa12','61d009',true,'H2'),
               ('61aa13','61d009',true,'H3'), ('61aa21','61d010',true,'E1'),
               ('61aa31','61d011',true,'D1'), ('61aa32','61d011',true,'D2'), ('61aa33','61d011',true,'D3'),
               ('61aa41','61d012',true,'M1'), ('61aa42','61d012',true,'M2'), ('61aa43','61d012',true,'M3')) AS v(d, e, p, s);

-- Portefeuilles et bracelets. Comptes de portefeuille créés ici ; solde posé par une écriture du kit.
CREATE FUNCTION pg_temp.mk_wallet(p_n int, p_event text, p_paid bigint, p_promo bigint, p_wstatus text,
                                  p_mstatus text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE lg uuid := pg_temp.ledger_of(p_event); w uuid := pg_temp.id('6a' || lpad(p_n::text, 4, '0')); tx uuid;
BEGIN
  PERFORM pg_temp.a();
  INSERT INTO wallet (id, operator_id, ledger_id, status) VALUES (w, pg_temp.id('61a001'), lg, p_wstatus);
  INSERT INTO account (operator_id, ledger_id, code, family, purpose, wallet_id, normal_side) VALUES
    (pg_temp.id('61a001'), lg, 'L-WAL-' || p_n || '-P', 'CLAIM', 'WALLET_PAID', w, 'C'),
    (pg_temp.id('61a001'), lg, 'L-WAL-' || p_n || '-X', 'CLAIM', 'WALLET_PROMO', w, 'C');
  INSERT INTO media (id, operator_id, kind, token_hash, nfc_uid, wallet_id, status)
  VALUES (pg_temp.id('6b' || lpad(p_n::text, 4, '0')), pg_temp.id('61a001'), 'NFC_TAG',
          sha256(convert_to('identité ' || p_n, 'UTF8')), decode('04610000' || lpad(p_n::text, 6, '0'), 'hex'), w, 'ACTIVE');
  IF p_mstatus <> 'ACTIVE' THEN UPDATE media SET status = p_mstatus WHERE wallet_id = w; END IF;
  IF p_paid > 0 THEN
    tx := post_transaction(lg, 'TOPUP', 'fund-p-' || p_n, now(), 'BATCH',
      jsonb_build_array(jsonb_build_object('account_id', pg_temp.acc(lg, 'L-WAL-' || p_n || '-P'), 'amount', -p_paid),
                        jsonb_build_object('account_id', pg_temp.acc(lg, 'A-BANQUE'), 'amount', p_paid)));
  END IF;
  IF p_promo > 0 THEN
    tx := post_transaction(lg, 'PROMO_CREDIT', 'fund-x-' || p_n, now(), 'BATCH',
      jsonb_build_array(jsonb_build_object('account_id', pg_temp.acc(lg, 'L-WAL-' || p_n || '-X'), 'amount', -p_promo),
                        jsonb_build_object('account_id', pg_temp.acc(lg, 'L-ORG-PROMO'), 'amount', p_promo)));
  END IF;
END $$;
SELECT pg_temp.mk_wallet(1, '61d001', 100000, 20000, 'ACTIVE', 'ACTIVE');     -- nominal, avec offert
SELECT pg_temp.mk_wallet(2, '61d001', 10000, 0, 'ACTIVE', 'ACTIVE');          -- manque
SELECT pg_temp.mk_wallet(3, '61d001', 5000, 0, 'BLOCKED', 'ACTIVE');          -- portefeuille bloqué
SELECT pg_temp.mk_wallet(4, '61d001', 5000, 0, 'ACTIVE', 'SUSPENDED');        -- bracelet suspendu
SELECT pg_temp.mk_wallet(5, '61d004', 50000, 0, 'ACTIVE', 'ACTIVE');          -- autre grand livre
SELECT pg_temp.mk_wallet(6, '61d001', 50000, 0, 'ACTIVE', 'ACTIVE');          -- décision partielle
SELECT pg_temp.mk_wallet(7, '61d001', 1000000, 0, 'ACTIVE', 'ACTIVE');        -- plafond horaire
SELECT pg_temp.mk_wallet(8, '61d001', 100000, 0, 'ACTIVE', 'ACTIVE');         -- CL007, annulations
SELECT pg_temp.mk_wallet(9, '61d001', 100000, 0, 'ACTIVE', 'ACTIVE');         -- annulation d'un autre portefeuille
SELECT pg_temp.mk_wallet(10, '61d001', 100000, 0, 'ACTIVE', 'ACTIVE');        -- hors ligne vérifié
SELECT pg_temp.mk_wallet(11, '61d010', 100000, 0, 'ACTIVE', 'ACTIVE');        -- événement en EUR
SELECT pg_temp.mk_wallet(21, '61d009', 1000000, 0, 'ACTIVE', 'ACTIVE');       -- passerelle hostile
SELECT pg_temp.mk_wallet(22, '61d009', 1000000, 0, 'ACTIVE', 'ACTIVE');
SELECT pg_temp.mk_wallet(23, '61d009', 1000000, 0, 'ACTIVE', 'ACTIVE');
SELECT pg_temp.mk_wallet(24, '61d009', 1000000, 0, 'ACTIVE', 'ACTIVE');
SELECT pg_temp.mk_wallet(n, '61d011', 1000000, 0, 'ACTIVE', 'ACTIVE') FROM generate_series(31, 34) n;
SELECT pg_temp.mk_wallet(n, '61d012', 1000000, 0, 'ACTIVE', 'ACTIVE') FROM generate_series(41, 44) n;

-- Règles de frais (commission du commerçant 1, et sa taxe) et lignes de frais d'une vente de 5 000 : 10 % dont 80 de taxe.
INSERT INTO fee_rule (id, operator_id, scope_type, scope_id, payer_purpose, beneficiary_purpose, basis, rate_bps,
                      trigger, valid_from)
VALUES (pg_temp.id('61f101'), pg_temp.id('61a001'), 'PARTICIPATION', pg_temp.id('61d0011'), 'MERCHANT', 'ORG_COM',
        'SALE_AMOUNT', 1000, 'REALTIME', '2026-01-01'),
       (pg_temp.id('61f102'), pg_temp.id('61a001'), 'PARTICIPATION', pg_temp.id('61d0011'), 'MERCHANT', 'ORG_TAX',
        'SALE_AMOUNT', 0, 'REALTIME', '2026-01-01');
CREATE FUNCTION pg_temp.fee(p_com bigint, p_ht bigint, p_tax bigint) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_array(
    jsonb_build_object('account_id', pg_temp.acc(pg_temp.ledger_of('61d001'), 'L-MCH-' || pg_temp.id('61d0011')),
                       'amount', p_com),
    jsonb_build_object('account_id', pg_temp.acc(pg_temp.ledger_of('61d001'), 'L-ORG-COM'), 'amount', -p_ht,
                       'fee_rule_id', pg_temp.id('61f101')),
    jsonb_build_object('account_id', pg_temp.acc(pg_temp.ledger_of('61d001'), 'L-ORG-TVA'), 'amount', -p_tax,
                       'fee_rule_id', pg_temp.id('61f102'))) $$;

-- Opérations ---------------------------------------------------------------------------------------------------
CREATE FUNCTION pg_temp.op(p_seq bigint, p_serial text, p_n int, p_amount bigint, p_charged bigint) RETURNS jsonb
LANGUAGE sql AS $$
  SELECT jsonb_build_object('edge_seq', p_seq, 'seq', p_seq, 'type', 'PURCHASE', 'occurred_at', pg_temp.ts(),
    'amount', p_amount, 'currency', 'XOF', 'authorized_mode', 'EDGE_ONLINE', 'device_serial', p_serial,
    'tap', jsonb_build_object('nfc_uid', '04610000' || lpad(p_n::text, 6, '0'),
       'token_hash', encode(sha256(convert_to('identité ' || p_n, 'UTF8')), 'hex'), 'counter', p_seq,
       'pack_verified', true, 'signature_verified', true),
    'edge_decision', jsonb_build_object('status', CASE WHEN p_amount > p_charged THEN 'ACCEPTED_WITH_SHORTFALL' ELSE 'ACCEPTED' END,
       'charged_to_wallet', p_charged, 'shortfall_amount', p_amount - p_charged,
       'shortfall_reason', CASE WHEN p_amount > p_charged THEN 'INSUFFICIENT_FUNDS' END)) $$;
CREATE FUNCTION pg_temp.rev(p_seq bigint, p_serial text, p_n int, p_target bigint) RETURNS jsonb LANGUAGE sql AS $$
  SELECT (pg_temp.op(p_seq, p_serial, p_n, 1, 1) - 'amount' - 'edge_decision')
         || jsonb_build_object('type', 'REVERSAL', 'reverses_seq', p_target) $$;

CREATE TEMP TABLE r (name text PRIMARY KEY, outcome text, tx uuid, reason text, detail text, charged bigint, shortfall bigint);
CREATE FUNCTION pg_temp.run(p_name text, p_gw text, p_epoch bigint, p_op jsonb, p_fee jsonb DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('app.gateway_id', pg_temp.id(p_gw)::text, true);
  INSERT INTO r
  SELECT p_name, x.* FROM edge_post_transaction(pg_temp.id(p_gw), p_epoch, (p_op ->> 'edge_seq')::bigint,
           p_op ->> 'device_serial' || ':' || lpad(p_op ->> 'seq', 4, '0'), sha256(convert_to(p_op::text, 'UTF8')), p_op, p_fee) x;
END $$;
CREATE FUNCTION pg_temp.res(p_name text, p_col text) RETURNS text LANGUAGE sql AS
  $$ SELECT to_jsonb(r.*) ->> p_col FROM r WHERE r.name = p_name $$;
SELECT pg_temp.a();

-- 1. Catalogue --------------------------------------------------------------------------------------------------
SELECT is((SELECT count(*)::int FROM pg_class WHERE relname = 'edge_platform_setting' AND relrowsecurity
            AND relforcerowsecurity), 1, 'edge_platform_setting : RLS activée ET forcée');
SELECT is((SELECT count(*)::int FROM pg_policies WHERE tablename = 'edge_platform_setting'), 2,
  'edge_platform_setting : lecture ouverte, écriture sous drapeau');
SELECT is((SELECT count(*)::int FROM pg_proc WHERE proname IN ('edge_post_transaction', 'set_edge_setting',
            'edge_setting_value', 'edge_spend_promo_first', 'edge_record_rejection') AND prosecdef
            AND proconfig @> ARRAY['search_path=public, pg_temp']), 5,
  'les cinq fonctions : SECURITY DEFINER et search_path = public, pg_temp');
SELECT is((SELECT count(*)::int FROM pg_proc WHERE proname IN ('edge_post_transaction', 'set_edge_setting',
            'edge_setting_value', 'edge_spend_promo_first', 'edge_record_rejection')
            AND has_function_privilege('public', oid, 'EXECUTE')), 0, 'aucune fonction exécutable par PUBLIC');
SELECT is((SELECT count(*)::int FROM pg_proc p, pg_roles r WHERE p.proname IN ('edge_post_transaction',
            'set_edge_setting', 'edge_setting_value', 'edge_spend_promo_first', 'edge_record_rejection')
            AND r.rolname IN ('cashless_app', 'cashless_edge', 'cashless_edgeadmin')
            AND has_function_privilege(r.rolname, p.oid, 'EXECUTE')), 2,
  'accords (WP09) : edge_post_transaction à cashless_edge, set_edge_setting à cashless_edgeadmin, rien d''autre');
SELECT is((SELECT count(*)::int FROM pg_proc p, pg_roles r WHERE p.proname IN ('edge_setting_value',
            'edge_spend_promo_first', 'edge_record_rejection') AND r.rolname ~ '^cashless_'
            AND has_function_privilege(r.rolname, p.oid, 'EXECUTE')), 0, 'les trois internes : aucun rôle');
SELECT is((SELECT count(*)::int FROM pg_proc WHERE proname = 'edge_post_transaction'
            AND position('ORDER BY ab.account_id FOR UPDATE' IN prosrc) > 0
            AND position('ORDER BY ab.account_id FOR UPDATE' IN prosrc) < position('INTO v_bal_paid FROM' IN prosrc)), 1,
  'le verrou FOR UPDATE précède la lecture du solde dans le texte de la fonction (preuve partielle)');

-- 2. Réglages ---------------------------------------------------------------------------------------------------
SELECT is((SELECT value FROM edge_platform_setting WHERE key = 'replay_max_per_sale'), 50000::bigint, 'plafond par vente : 50 000');
SELECT is((SELECT value FROM edge_platform_setting WHERE key = 'replay_max_per_terminal_hour'), 500000::bigint,
  'plafond par terminal et par heure : 500 000');
SELECT is((SELECT value FROM edge_platform_setting WHERE key = 'pack_delay_seconds'), 1800::bigint, 'délai des colis : 1 800 s');
SELECT throws_ok($$INSERT INTO edge_platform_setting (key, value, updated_by_label) VALUES ('replay_max_per_sale.XAF', 0, 'x')$$,
  '23514', NULL, 'CHECK value > 0 : une valeur nulle est refusée');
SELECT throws_ok($$INSERT INTO edge_platform_setting (key, value, updated_by_label) VALUES ('replay_max_per_sale.XAF', -5, 'x')$$,
  '23514', NULL, 'CHECK value > 0 : une valeur négative est refusée');
SELECT throws_ok($$INSERT INTO edge_platform_setting (key, value, updated_by_label) VALUES ('autre_cle', 5, 'x')$$,
  '23514', NULL, 'clé inconnue refusée par la table');
SELECT throws_ok($$SELECT set_edge_setting('replay_max_per_sale', 0, 'porteur')$$, 'CL001', NULL, 'set_edge_setting : valeur nulle refusée');
SELECT throws_ok($$SELECT set_edge_setting('autre_cle', 5, 'porteur')$$, 'CL001', NULL, 'set_edge_setting : clé inconnue refusée');
SELECT throws_ok($$SELECT set_edge_setting('replay_max_per_sale', 5, '  ')$$, 'CL001', NULL, 'set_edge_setting : libellé obligatoire');
SELECT throws_ok($$DELETE FROM edge_platform_setting WHERE key = 'pack_delay_seconds'$$, NULL, NULL, 'suppression d''un réglage refusée');
SELECT is((SELECT edge_setting_value('replay_max_per_sale', 'XOF')), 50000::bigint, 'clé nue valable pour XOF');
SELECT is((SELECT edge_setting_value('replay_max_per_sale', 'EUR')), NULL::bigint, 'autre devise sans clé : aucune valeur (échec fermé)');

-- 2 bis. Aucun rôle applicatif n'écrit les réglages, même avec le drapeau local (constat B2) ----------------------------
-- roles.sql et post-roles.sql redonnent arw à cashless_app après les migrations : la garde est un déclencheur sur
-- l'identité de l'appelant, pas sur le privilège de table. Le test rejoue les rôles dans la transaction.
SET LOCAL client_min_messages = warning;
\ir ../roles.sql
RESET client_min_messages;
SELECT set_config('app.edge_setting_write', 'on', true);
SET LOCAL ROLE cashless_app;
SELECT throws_ok($$UPDATE edge_platform_setting SET value = 999999999 WHERE key = 'replay_max_per_sale'$$, '42501', NULL,
  'cashless_app : UPDATE refusé même avec le drapeau local');
SELECT throws_ok($$INSERT INTO edge_platform_setting (key, value, updated_by_label) VALUES ('replay_max_per_sale.XAF', 5, 'x')$$,
  '42501', NULL, 'cashless_app : INSERT refusé même avec le drapeau local');
SELECT throws_ok($$DELETE FROM edge_platform_setting$$, '42501', NULL, 'cashless_app : DELETE refusé');
SELECT throws_ok($$TRUNCATE edge_platform_setting$$, '42501', NULL, 'cashless_app : TRUNCATE refusé');
RESET ROLE;
SET LOCAL ROLE cashless_edge;
SELECT throws_ok($$UPDATE edge_platform_setting SET value = 999999999 WHERE key = 'replay_max_per_sale'$$, '42501', NULL,
  'cashless_edge : UPDATE refusé même avec le drapeau local');
SELECT throws_ok($$INSERT INTO edge_platform_setting (key, value, updated_by_label) VALUES ('replay_max_per_sale.XAF', 5, 'x')$$,
  '42501', NULL, 'cashless_edge : INSERT refusé');
RESET ROLE;
SET LOCAL ROLE cashless_edgeadmin;
SELECT throws_ok($$UPDATE edge_platform_setting SET value = 999999999 WHERE key = 'replay_max_per_sale'$$, '42501', NULL,
  'cashless_edgeadmin : UPDATE direct refusé (seule set_edge_setting écrit)');
SELECT throws_ok($$INSERT INTO edge_platform_setting (key, value, updated_by_label) VALUES ('replay_max_per_sale.XAF', 5, 'x')$$,
  '42501', NULL, 'cashless_edgeadmin : INSERT direct refusé');
RESET ROLE;
SELECT is((SELECT value FROM edge_platform_setting WHERE key = 'replay_max_per_sale'), 50000::bigint, 'plafond intact');
SELECT is((SELECT count(*)::int FROM pg_class c, aclexplode(c.relacl) x WHERE c.relname = 'edge_platform_setting'
            AND x.grantee = 0), 0, 'aucun droit accordé à PUBLIC sur la table');

-- 3. Refus de l'enveloppe (rien d'enregistré) -------------------------------------------------------------------
SELECT set_config('app.gateway_id', pg_temp.id('61e099')::text, true);
SELECT throws_ok($$SELECT * FROM edge_post_transaction(pg_temp.id('61e001'), 1, 1, 'T1:0001', sha256('x'),
   pg_temp.op(1, 'T1', 1, 100, 100), NULL)$$, '42501', NULL, 'autre passerelle que celle de la session : 42501');
SELECT throws_ok($$SELECT pg_temp.run('x', '61e002', 1, pg_temp.op(1, 'T1', 1, 100, 100))$$, 'CL013', NULL,
  'passerelle REVOKED : CL013');
SELECT throws_ok($$SELECT pg_temp.run('x', '61e003', 1, pg_temp.op(1, 'T1', 1, 100, 100))$$, 'CL013', NULL,
  'passerelle STANDBY : CL013');
SELECT throws_ok($$SELECT pg_temp.run('x', '61e005', 1, pg_temp.op(1, 'T1', 1, 100, 100))$$, 'CL013', NULL,
  'passerelle sans handover : CL013');
SELECT throws_ok($$SELECT pg_temp.run('x', '61e001', 2, pg_temp.op(1, 'T1', 1, 100, 100))$$, 'CL015', NULL, 'époque fausse (CL015)');
SELECT throws_ok($$SELECT pg_temp.run('x', '61e001', 0, pg_temp.op(1, 'T1', 1, 100, 100))$$, 'CL015', NULL, 'époque en retard (CL015)');
SELECT throws_ok($$SELECT pg_temp.run('x', '61e001', 1, pg_temp.op(5, 'T1', 1, 100, 100))$$, 'CL016', NULL,
  'numéro non suivant : CL016, avant toute écriture');
SELECT set_config('app.gateway_id', pg_temp.id('61e001')::text, true);
SELECT throws_ok($$SELECT * FROM edge_post_transaction(pg_temp.id('61e001'), 1, 1, 'T1:0001', 'abc'::bytea,
   pg_temp.op(1, 'T1', 1, 100, 100), NULL)$$, 'CL001', NULL, 'p_content de longueur fausse : CL001');
SELECT is((SELECT count(*)::int FROM journal_transaction WHERE source = 'EDGE_SYNC'), 0, 'aucune écriture après ces refus');

-- 4. Vente nominale (avec frais), ordre offert d'abord ----------------------------------------------------------
SELECT pg_temp.run('s1', '61e001', 1, pg_temp.op(1, 'T1', 1, 5000, 5000), pg_temp.fee(500, 420, 80));
SELECT is(pg_temp.res('s1', 'outcome'), 'ACCEPTED', 'vente complète : ACCEPTED');
SELECT is(pg_temp.lines((SELECT tx FROM r WHERE name = 's1')),
  'WALLET_PROMO:5000,MERCHANT:-5000,MERCHANT:500,ORG_COM:-420,ORG_TAX:-80',
  'lignes construites : offert d''abord, commerçant, frais validés');
SELECT is(pg_temp.avail('6a0001', 'WALLET_PROMO'), 15000::bigint, 'offert débité de 5 000');
SELECT is(pg_temp.avail('6a0001', 'WALLET_PAID'), 100000::bigint, 'payé intact');
SELECT is((SELECT sum(amount)::bigint FROM posting WHERE transaction_id = (SELECT tx FROM r WHERE name = 's1')), 0::bigint,
  'somme nulle de la transaction écrite');
SELECT is((SELECT t.metadata ->> 'origin_key' FROM journal_transaction t WHERE t.id = (SELECT tx FROM r WHERE name = 's1')),
  'T1:0001', 'metadata.origin_key');
SELECT ok((SELECT t.metadata ? 'origin_occurred_at' AND t.metadata ->> 'origin_mode' = 'EDGE_ONLINE'
              AND t.source = 'EDGE_SYNC' AND t.idempotency_key = 'T1:0001'
              AND t.device_id = pg_temp.id('61aa01') AND t.media_id = pg_temp.id('6b0001')
            FROM journal_transaction t WHERE t.id = (SELECT tx FROM r WHERE name = 's1')),
  'metadata complète (origin_occurred_at, origin_mode), source EDGE_SYNC, clé <serial>:<seq>, terminal et bracelet');
SELECT is((SELECT outcome || '/' || transaction_id::text FROM edge_sync_registry
            WHERE gateway_id = pg_temp.id('61e001') AND edge_seq = 1), 'ACCEPTED/' || (SELECT tx FROM r WHERE name = 's1'),
  'registre : ACCEPTED avec la même transaction (même transaction SQL)');
SELECT is((SELECT last_counter FROM media WHERE id = pg_temp.id('6b0001')), 1::bigint, 'compteur du bracelet avancé');
SELECT is((SELECT count(*)::int FROM media_tap WHERE media_id = pg_temp.id('6b0001') AND counter = 1
            AND transaction_id = (SELECT tx FROM r WHERE name = 's1')), 1, 'passage inscrit au journal des passages');
SELECT is((SELECT count(*)::int FROM anomaly WHERE transaction_id = (SELECT tx FROM r WHERE name = 's1')), 0,
  'vente couverte : aucune anomalie');

-- 5. Comptes forcés par la requête : ignorés ---------------------------------------------------------------------
SELECT pg_temp.run('s2', '61e001', 1,
  pg_temp.op(pg_temp.nx('61e001'), 'T2', 1, 1000, 1000)
  || jsonb_build_object('merchant_account_id', pg_temp.acc(pg_temp.ledger_of('61d001'), 'L-ORG-COM'),
       'cash_desk_account_id', pg_temp.acc(pg_temp.ledger_of('61d001'), 'A-BANQUE'),
       'edge_guichet', jsonb_build_object('media_id', pg_temp.id('6b0001'),
          'cash_desk_account_id', pg_temp.acc(pg_temp.ledger_of('61d001'), 'A-BANQUE'))));
SELECT is(pg_temp.res('s2', 'outcome'), 'ACCEPTED', 'vente avec comptes nommés dans la requête : écrite');
SELECT is((SELECT a.code FROM posting po JOIN account a ON a.id = po.account_id
            WHERE po.transaction_id = (SELECT tx FROM r WHERE name = 's2') AND a.purpose = 'MERCHANT'),
  'L-MCH-' || pg_temp.id('61d0011'), 'le compte marchand est celui du point de vente du terminal, lu en base');
SELECT is((SELECT count(*)::int FROM posting po JOIN account a ON a.id = po.account_id
            WHERE po.transaction_id = (SELECT tx FROM r WHERE name = 's2') AND a.code IN ('L-ORG-COM', 'A-BANQUE')), 0,
  'aucune ligne sur les comptes nommés par la requête');

-- 6. Lignes libres dans p_fee_lines : refusées -------------------------------------------------------------------
CREATE FUNCTION pg_temp.try_fee(p_name text, p_fee jsonb) RETURNS void LANGUAGE sql AS $$
  SELECT pg_temp.run(p_name, '61e001', 1, pg_temp.op(pg_temp.nx('61e001'), 'T1', 1, 5000, 5000), p_fee) $$;
SELECT pg_temp.try_fee('f1', jsonb_build_array(
  jsonb_build_object('account_id', pg_temp.acc(pg_temp.ledger_of('61d001'), 'L-WAL-1-P'), 'amount', 900),
  jsonb_build_object('account_id', pg_temp.acc(pg_temp.ledger_of('61d001'), 'L-ORG-COM'), 'amount', -900,
                     'fee_rule_id', pg_temp.id('61f101'))));
SELECT is(pg_temp.res('f1', 'outcome') || '/' || pg_temp.res('f1', 'reason') || '/' || pg_temp.res('f1', 'detail'),
  'REJECTED/MALFORMED_OPERATION/FEE_LINES_INVALID', 'ligne libre sur le portefeuille : REJECTED');
SELECT pg_temp.try_fee('f2', jsonb_build_array(
  jsonb_build_object('account_id', pg_temp.acc(pg_temp.ledger_of('61d001'), 'S-ATTENTE'), 'amount', 900),
  jsonb_build_object('account_id', pg_temp.acc(pg_temp.ledger_of('61d001'), 'L-ORG-COM'), 'amount', -900,
                     'fee_rule_id', pg_temp.id('61f101'))));
SELECT is(pg_temp.res('f2', 'detail'), 'FEE_LINES_INVALID', 'ligne libre sur l''attente : REJECTED');
SELECT pg_temp.try_fee('f3', jsonb_build_array(
  jsonb_build_object('account_id', pg_temp.acc(pg_temp.ledger_of('61d001'), 'L-MCH-' || pg_temp.id('61d0011')), 'amount', 500),
  jsonb_build_object('account_id', pg_temp.acc(pg_temp.ledger_of('61d001'), 'L-ORG-COM'), 'amount', -400,
                     'fee_rule_id', pg_temp.id('61f101'))));
SELECT is(pg_temp.res('f3', 'detail'), 'FEE_LINES_INVALID', 'frais non équilibrés : REJECTED');
SELECT pg_temp.try_fee('f4', jsonb_build_array(
  jsonb_build_object('account_id', pg_temp.acc(pg_temp.ledger_of('61d001'), 'L-MCH-' || pg_temp.id('61d0011')), 'amount', 500),
  jsonb_build_object('account_id', pg_temp.acc(pg_temp.ledger_of('61d001'), 'L-ORG-COM'), 'amount', -500)));
SELECT is(pg_temp.res('f4', 'detail'), 'FEE_LINES_INVALID', 'ligne de commission sans règle de frais : REJECTED');
SELECT pg_temp.try_fee('f5', jsonb_build_array(
  jsonb_build_object('account_id', pg_temp.acc(pg_temp.ledger_of('61d001'), 'L-MCH-' || pg_temp.id('61d0011')), 'amount', 9000),
  jsonb_build_object('account_id', pg_temp.acc(pg_temp.ledger_of('61d001'), 'L-ORG-COM'), 'amount', -9000,
                     'fee_rule_id', pg_temp.id('61f101'))));
SELECT is(pg_temp.res('f5', 'detail'), 'FEE_LINES_INVALID', 'commission supérieure à la vente : REJECTED');
SELECT pg_temp.try_fee('f6', jsonb_build_array(
  jsonb_build_object('account_id', pg_temp.acc(pg_temp.ledger_of('61d004'), 'L-MCH-' || pg_temp.id('61d0041')), 'amount', 500),
  jsonb_build_object('account_id', pg_temp.acc(pg_temp.ledger_of('61d001'), 'L-ORG-COM'), 'amount', -500,
                     'fee_rule_id', pg_temp.id('61f101'))));
SELECT is(pg_temp.res('f6', 'detail'), 'FEE_LINES_INVALID', 'compte marchand d''un autre grand livre : REJECTED');
SELECT pg_temp.try_fee('f7', pg_temp.fee(1500, 1500, 0));
SELECT is(pg_temp.res('f7', 'detail'), 'FEE_LINES_INVALID',
  'M2 : frais de 1 500 sur 5 000 alors que la règle référencée (10 %) permet 500 : REJECTED');
SELECT pg_temp.try_fee('f8', jsonb_build_array(
  jsonb_build_object('account_id', pg_temp.acc(pg_temp.ledger_of('61d001'), 'L-MCH-' || pg_temp.id('61d0011')), 'amount', 900),
  jsonb_build_object('account_id', pg_temp.acc(pg_temp.ledger_of('61d001'), 'L-ORG-COM'), 'amount', -300,
                     'fee_rule_id', pg_temp.id('61f101')),
  jsonb_build_object('account_id', pg_temp.acc(pg_temp.ledger_of('61d001'), 'L-ORG-COM'), 'amount', -300,
                     'fee_rule_id', pg_temp.id('61f101')),
  jsonb_build_object('account_id', pg_temp.acc(pg_temp.ledger_of('61d001'), 'L-ORG-COM'), 'amount', -300,
                     'fee_rule_id', pg_temp.id('61f101'))));
SELECT is(pg_temp.res('f8', 'detail'), 'FEE_LINES_INVALID', 'M2 : répéter la même règle ne multiplie pas la borne');
SELECT is((SELECT count(*)::int FROM journal_transaction t WHERE t.source = 'EDGE_SYNC' AND t.idempotency_key IN
            ('T1:' || lpad((SELECT edge_seq::text FROM edge_sync_registry WHERE gateway_id = pg_temp.id('61e001') AND outcome = 'REJECTED' LIMIT 1), 4, '0'))), 0,
  'ces refus n''écrivent rien');
SELECT is((SELECT count(*)::int FROM edge_sync_registry WHERE gateway_id = pg_temp.id('61e001') AND outcome = 'REJECTED'), 8,
  'chaque refus consomme son numéro avec REJECTED');
SELECT ok((SELECT count(*) >= 6 FROM anomaly WHERE kind = 'NON_COMPLIANT_OPERATION' AND ledger_id = pg_temp.ledger_of('61d001')),
  'chaque refus du central ouvre une anomalie NON_COMPLIANT_OPERATION');

-- 7. Type hors liste blanche, autres enveloppes ------------------------------------------------------------------
SELECT pg_temp.run('t1', '61e001', 1, pg_temp.op(pg_temp.nx('61e001'), 'T1', 1, 100, 100) || '{"type":"ADJUSTMENT"}');
SELECT is(pg_temp.res('t1', 'outcome') || '/' || pg_temp.res('t1', 'reason') || '/' || pg_temp.res('t1', 'detail'),
  'REJECTED/MALFORMED_OPERATION/TYPE_NOT_ALLOWED', 'type ADJUSTMENT : REJECTED');
SELECT pg_temp.run('t2', '61e001', 1, pg_temp.op(pg_temp.nx('61e001'), 'T1', 1, 100, 100) || '{"type":"TOPUP_CASH"}');
SELECT is(pg_temp.res('t2', 'detail'), 'WRONG_ENVELOPE', 'TOPUP_CASH : relève de l''enveloppe de WP07');
SELECT pg_temp.run('t3', '61e001', 1, pg_temp.op(pg_temp.nx('61e001'), 'T1', 1, 100, 100) || '{"type":"DEPOSIT_TAKEN"}');
SELECT is(pg_temp.res('t3', 'reason'), 'MALFORMED_OPERATION', 'type de grand livre DEPOSIT_TAKEN dans p_op : refusé ici');
SELECT pg_temp.run('v1', '61e001', 1, (pg_temp.op(pg_temp.nx('61e001'), 'T1', 1, 100, 100)
   || '{"type":"VOID","void_reason":"ABORTED_BY_OPERATOR"}') - 'tap' - 'edge_decision');
SELECT is(pg_temp.res('v1', 'outcome') || '/' || pg_temp.res('v1', 'reason'), 'VOID/ABORTED_BY_OPERATOR',
  'VOID : numéro consommé sans effet');
SELECT is((SELECT outcome FROM edge_sync_registry WHERE gateway_id = pg_temp.id('61e001') ORDER BY edge_seq DESC LIMIT 1),
  'VOID', 'VOID au registre, sans transaction');

-- 8. Décision de la passerelle : absente ou incohérente ----------------------------------------------------------
CREATE FUNCTION pg_temp.try_op(p_name text, p_op jsonb) RETURNS void LANGUAGE sql AS $$
  SELECT pg_temp.run(p_name, '61e001', 1, p_op) $$;
SELECT pg_temp.try_op('d1', pg_temp.op(pg_temp.nx('61e001'), 'T1', 1, 1000, 1000) - 'edge_decision');
SELECT is(pg_temp.res('d1', 'detail'), 'DECISION_MISSING', 'décision absente : REJECTED');
SELECT pg_temp.try_op('d2', pg_temp.op(pg_temp.nx('61e001'), 'T1', 1, 1000, 1000)
   || jsonb_build_object('edge_decision', '{"status":"ACCEPTED","charged_to_wallet":900,"shortfall_amount":0}'::jsonb));
SELECT is(pg_temp.res('d2', 'detail'), 'DECISION_INCONSISTENT', 'charged + shortfall <> amount : REJECTED');
SELECT pg_temp.try_op('d3', pg_temp.op(pg_temp.nx('61e001'), 'T1', 1, 1000, 1000)
   || jsonb_build_object('edge_decision', '{"status":"ACCEPTED","charged_to_wallet":1500,"shortfall_amount":-500}'::jsonb));
SELECT is(pg_temp.res('d3', 'detail'), 'DECISION_INVALID', 'montant négatif : REJECTED');
SELECT pg_temp.try_op('d4', pg_temp.op(pg_temp.nx('61e001'), 'T1', 1, 1000, 400)
   || jsonb_build_object('edge_decision', '{"status":"ACCEPTED_WITH_SHORTFALL","charged_to_wallet":400,"shortfall_amount":600}'::jsonb));
SELECT is(pg_temp.res('d4', 'detail'), 'DECISION_INCONSISTENT', 'manque sans shortfall_reason : REJECTED');
SELECT pg_temp.try_op('d5', pg_temp.op(pg_temp.nx('61e001'), 'T1', 1, 1000, 1000)
   || jsonb_build_object('edge_decision', '{"status":"ACCEPTED","charged_to_wallet":0,"shortfall_amount":1000}'::jsonb));
SELECT is(pg_temp.res('d5', 'detail'), 'DECISION_INCONSISTENT', 'ACCEPTED avec un manque : REJECTED');
SELECT pg_temp.try_op('d6', pg_temp.op(pg_temp.nx('61e001'), 'T1', 1, 1000, 1000)
   || jsonb_build_object('edge_decision', '{"status":"REJECTED","charged_to_wallet":0,"shortfall_amount":0,"reject_reason":"OFFLINE_NOT_ALLOWED"}'::jsonb));
SELECT is(pg_temp.res('d6', 'outcome') || '/' || pg_temp.res('d6', 'reason'), 'REJECTED/OFFLINE_NOT_ALLOWED',
  'refus déclaré par la passerelle : relayé sans écriture');
SELECT is((SELECT count(*)::int FROM anomaly WHERE kind = 'NON_COMPLIANT_OPERATION' AND device_id = pg_temp.id('61aa01')
            AND detail ->> 'detail' = 'EDGE_DECLARED'), 0, 'refus déclaré par la passerelle : pas d''anomalie');

-- 9. Preuve du bracelet (EDGE_ONLINE) -----------------------------------------------------------------------------
SELECT pg_temp.try_op('p1', pg_temp.op(pg_temp.nx('61e001'), 'T1', 1, 1000, 1000) - 'tap');
SELECT is(pg_temp.res('p1', 'detail'), 'TAP_MISSING', 'vente sans tap : REJECTED');
SELECT pg_temp.try_op('p2', jsonb_set(pg_temp.op(pg_temp.nx('61e001'), 'T1', 1, 1000, 1000), '{tap,counter}', '1'));
SELECT is(pg_temp.res('p2', 'detail'), 'TAP_COUNTER_NOT_INCREASING', 'compteur non croissant (déjà vu) : REJECTED');
SELECT pg_temp.try_op('p3', jsonb_set(pg_temp.op(pg_temp.nx('61e001'), 'T1', 1, 1000, 1000), '{tap,token_hash}',
   to_jsonb(encode(sha256(convert_to('inconnu', 'UTF8')), 'hex'))));
SELECT is(pg_temp.res('p3', 'detail'), 'UNKNOWN_MEDIA', 'token_hash inconnu : REJECTED');
SELECT pg_temp.try_op('p4', jsonb_set(pg_temp.op(pg_temp.nx('61e001'), 'T1', 1, 1000, 1000), '{tap,token_hash}',
   to_jsonb(encode(sha256(convert_to('identité 5', 'UTF8')), 'hex'))));
SELECT is(pg_temp.res('p4', 'detail'), 'WALLET_OTHER_LEDGER', 'token_hash d''un portefeuille d''un autre grand livre : REJECTED');
SELECT pg_temp.try_op('p5', jsonb_set(pg_temp.op(pg_temp.nx('61e001'), 'T1', 1, 1000, 1000), '{tap,nfc_uid}', '"04610000000099"'));
SELECT is(pg_temp.res('p5', 'detail'), 'TAP_UID_MISMATCH', 'UID différent de celui du bracelet : REJECTED');
SELECT pg_temp.try_op('p6', jsonb_set(pg_temp.op(pg_temp.nx('61e001'), 'T1', 1, 1000, 1000), '{tap,signature_verified}', 'false'));
SELECT is(pg_temp.res('p6', 'detail'), 'TAP_SIGNATURE_NOT_VERIFIED', 'signature de passage non vérifiée : REJECTED');
SELECT pg_temp.try_op('p7', jsonb_set(pg_temp.op(pg_temp.nx('61e001'), 'T1', 1, 1000, 1000), '{tap,pack_verified}', 'false'));
SELECT is(pg_temp.res('p7', 'detail'), 'TAP_PACK_NOT_VERIFIED', 'PACK non vérifié : REJECTED');
SELECT pg_temp.try_op('p8', pg_temp.op(pg_temp.nx('61e001'), 'T1', 1, 1000, 1000) #- '{tap,signature_verified}');
SELECT is(pg_temp.res('p8', 'detail'), 'TAP_SIGNATURE_NOT_VERIFIED', 'indicateur de signature absent : REJECTED');
SELECT pg_temp.try_op('p9', pg_temp.op(pg_temp.nx('61e001'), 'T1', 1, 1000, 1000) || '{"authorized_mode":"DEVICE_OFFLINE"}'
   #- '{tap,signature_verified}');
SELECT is(pg_temp.res('p9', 'detail'), 'TAP_SIGNATURE_NOT_VERIFIED',
  'DEVICE_OFFLINE non attesté par l''API : traité comme EDGE_ONLINE (preuve exigée)');
SELECT is((SELECT last_counter FROM media WHERE id = pg_temp.id('6b0001')), 2::bigint,
  'les refus ne font pas avancer le compteur du bracelet (dernier compteur accepté : 2)');
-- Autres refus d'origine
SELECT pg_temp.try_op('o1', pg_temp.op(pg_temp.nx('61e001'), 'ZZ', 1, 1000, 1000));
SELECT is(pg_temp.res('o1', 'detail'), 'UNKNOWN_TERMINAL', 'terminal inconnu : REJECTED');
SELECT pg_temp.try_op('o2', pg_temp.op(pg_temp.nx('61e001'), 'TX', 1, 1000, 1000));
SELECT is(pg_temp.res('o2', 'detail'), 'UNKNOWN_TERMINAL', 'terminal d''un autre événement : REJECTED');
SELECT pg_temp.try_op('o3', pg_temp.op(pg_temp.nx('61e001'), 'T3', 1, 1000, 1000));
SELECT is(pg_temp.res('o3', 'detail'), 'NO_MERCHANT_ACCOUNT', 'terminal sans point de vente : REJECTED');
SELECT pg_temp.try_op('o4', pg_temp.op(pg_temp.nx('61e001'), 'T1', 1, 1000, 1000) || '{"currency":"EUR"}');
SELECT is(pg_temp.res('o4', 'reason'), 'CURRENCY_MISMATCH', 'devise différente du grand livre : REJECTED');
SELECT set_config('app.gateway_id', pg_temp.id('61e001')::text, true);
INSERT INTO r SELECT 'o5', x.* FROM edge_post_transaction(pg_temp.id('61e001'), 1, pg_temp.nx('61e001'), 'T1:999',
  sha256('o5'), pg_temp.op(pg_temp.nx('61e001'), 'T1', 1, 1000, 1000), NULL) x;
SELECT is(pg_temp.res('o5', 'detail'), 'ORIGIN_FIELDS', 'clé d''origine différente de <serial>:<seq> : REJECTED');
SELECT pg_temp.try_op('o6', pg_temp.op(pg_temp.nx('61e001'), 'T1', 1, 1000, 1000) || '{"occurred_at":"hier"}');
SELECT is(pg_temp.res('o6', 'detail'), 'ORIGIN_OCCURRED_AT', 'heure d''origine mal formée : REJECTED');
SELECT pg_temp.try_op('o7', pg_temp.op(pg_temp.nx('61e001'), 'T1', 1, 1000, 1000) || '{"authorized_mode":"AUTRE"}');
SELECT is(pg_temp.res('o7', 'detail'), 'ORIGIN_FIELDS', 'mode d''origine inconnu : REJECTED');

-- 10. Rognage au solde central, S-ATTENTE, anomalie ----------------------------------------------------------------
SELECT pg_temp.run('m1', '61e001', 1, pg_temp.op(pg_temp.nx('61e001'), 'T1', 2, 15000, 15000));
SELECT is(pg_temp.res('m1', 'outcome') || '/' || pg_temp.res('m1', 'reason') || '/' || pg_temp.res('m1', 'detail'),
  'ACCEPTED_WITH_SHORTFALL/INSUFFICIENT_FUNDS/CENTRAL_BALANCE', 'décision au-dessus du solde : rognée');
SELECT is(pg_temp.res('m1', 'charged') || '/' || pg_temp.res('m1', 'shortfall'), '10000/5000', 'prélevé 10 000, attente 5 000');
SELECT is(pg_temp.lines((SELECT tx FROM r WHERE name = 'm1')), 'WALLET_PAID:10000,SUSPENSE:5000,MERCHANT:-15000',
  'lignes : portefeuille, attente, commerçant garanti');
SELECT is(pg_temp.avail('6a0002', 'WALLET_PAID'), 0::bigint, 'le portefeuille n''est jamais débité au-delà de son solde');
SELECT is((SELECT a.amount || '/' || a.loss_bearer || '/' || a.status FROM anomaly a
            WHERE a.kind = 'OFFLINE_SHORTFALL' AND a.transaction_id = (SELECT tx FROM r WHERE name = 'm1')),
  '5000/OPERATOR/OPEN', 'anomalie OFFLINE_SHORTFALL du montant en attente');
SELECT pg_temp.run('m2', '61e001', 1, pg_temp.op(pg_temp.nx('61e001'), 'T1', 2, 3000, 3000));
SELECT is(pg_temp.res('m2', 'charged') || '/' || pg_temp.res('m2', 'shortfall'), '0/3000',
  'second débit sur un portefeuille vidé : tout en attente, rien n''est créé');
SELECT is((SELECT sum(po.amount)::bigint FROM posting po JOIN account a ON a.id = po.account_id
            JOIN journal_transaction t ON t.id = po.transaction_id AND t.source = 'EDGE_SYNC'
            WHERE a.wallet_id = pg_temp.id('6a0002') AND a.purpose = 'WALLET_PAID'), 10000::bigint,
  'A06 : deux ventes l''une après l''autre ne dépassent jamais le solde central');
-- Décision partielle de la passerelle (raison conservée)
SELECT pg_temp.run('m3', '61e001', 1, pg_temp.op(pg_temp.nx('61e001'), 'T1', 6, 8000, 3000)
   || jsonb_build_object('edge_decision', '{"status":"ACCEPTED_WITH_SHORTFALL","charged_to_wallet":3000,"shortfall_amount":5000,"shortfall_reason":"MEDIA_CLONE_SUSPECTED"}'::jsonb));
SELECT is(pg_temp.res('m3', 'charged') || '/' || pg_temp.res('m3', 'shortfall') || '/' || pg_temp.res('m3', 'reason'),
  '3000/5000/MEDIA_CLONE_SUSPECTED', 'la décision partielle de la passerelle est un majorant respecté, raison conservée');
-- Portefeuille bloqué, bracelet suspendu
SELECT pg_temp.run('b1', '61e001', 1, pg_temp.op(pg_temp.nx('61e001'), 'T1', 3, 1000, 1000));
SELECT is(pg_temp.res('b1', 'charged') || '/' || pg_temp.res('b1', 'shortfall') || '/' || pg_temp.res('b1', 'reason'),
  '0/1000/WALLET_BLOCKED', 'portefeuille bloqué : rien prélevé, tout en attente');
SELECT pg_temp.run('b2', '61e001', 1, pg_temp.op(pg_temp.nx('61e001'), 'T1', 4, 1000, 1000));
SELECT is(pg_temp.res('b2', 'charged') || '/' || pg_temp.res('b2', 'reason'), '0/MEDIA_BLOCKED_AFTER_SNAPSHOT',
  'bracelet suspendu : rien prélevé');
SELECT is(pg_temp.avail('6a0003', 'WALLET_PAID'), 5000::bigint, 'portefeuille bloqué intact');

-- 11. Plafond par vente --------------------------------------------------------------------------------------------
SELECT pg_temp.run('c1', '61e001', 1, pg_temp.op(pg_temp.nx('61e001'), 'T1', 1, 60000, 60000));
SELECT is(pg_temp.res('c1', 'outcome') || '/' || pg_temp.res('c1', 'reason') || '/' || pg_temp.res('c1', 'detail'),
  'ACCEPTED_WITH_SHORTFALL/INSUFFICIENT_FUNDS/EDGE_REPLAY_CEILING', 'vente au-dessus du plafond par vente : part en attente');
SELECT is(pg_temp.res('c1', 'charged') || '/' || pg_temp.res('c1', 'shortfall'), '50000/10000',
  'prélevé au plus 50 000, le reste en attente (jamais un rejet)');
SELECT is((SELECT count(*)::int FROM audit_log WHERE action = 'EDGE_REPLAY_CEILING' AND after ->> 'ceiling' = 'sale'), 1,
  'alerte EDGE_REPLAY_CEILING au dépassement par vente');
SELECT set_config('app.gateway_id', pg_temp.id('61e001')::text, true);
SELECT lives_ok($$SELECT set_edge_setting('replay_max_per_sale', 20000, 'test')$$, 'plafond réglable par set_edge_setting');
SELECT pg_temp.run('c2', '61e001', 1, pg_temp.op(pg_temp.nx('61e001'), 'T1', 1, 30000, 30000));
SELECT is(pg_temp.res('c2', 'charged'), '20000', 'le nouveau plafond s''applique tout de suite (lu en table, sans paramètre)');
SELECT is((SELECT action || '/' || (after ->> 'value') FROM audit_log WHERE object_id = 'replay_max_per_sale'
            ORDER BY id DESC LIMIT 1), 'EDGE_SETTING_CHANGED/20000', 'changement de réglage audité');
SELECT set_edge_setting('replay_max_per_sale', 50000, 'test');

-- 12. Plafond par terminal et par heure ---------------------------------------------------------------------------
SELECT pg_temp.run('h' || i, '61e001', 1, pg_temp.op(pg_temp.nx('61e001'), 'T2', 7, 49000, 49000))
  FROM generate_series(1, 10) i;
SELECT is((SELECT count(*)::int FROM r WHERE name ~ '^h[0-9]+$' AND outcome = 'ACCEPTED'), 10,
  'dix ventes de 49 000 sur le même terminal : dans le plafond horaire (491 000 avec s2)');
SELECT pg_temp.run('h11', '61e001', 1, pg_temp.op(pg_temp.nx('61e001'), 'T2', 7, 49000, 49000));
SELECT is(pg_temp.res('h11', 'outcome') || '/' || pg_temp.res('h11', 'detail'), 'ACCEPTED_WITH_SHORTFALL/EDGE_REPLAY_CEILING',
  'onzième vente : le plafond horaire du terminal est franchi, pas de rejet');
SELECT is(pg_temp.res('h11', 'charged') || '/' || pg_temp.res('h11', 'shortfall'), '9000/40000',
  'prélevé jusqu''à 500 000 cumulés, la part au-delà en attente, rien de perdu pour le commerçant');
SELECT is((SELECT count(*)::int FROM audit_log WHERE action = 'EDGE_REPLAY_CEILING' AND after ->> 'ceiling' = 'terminal_hour'), 1,
  'alerte EDGE_REPLAY_CEILING au dépassement horaire');
SELECT pg_temp.run('h12', '61e001', 1, pg_temp.op(pg_temp.nx('61e001'), 'T1', 7, 1000, 1000));
SELECT is(pg_temp.res('h12', 'charged'), '1000', 'un autre terminal n''est pas concerné par le plafond de T2');
SELECT is((SELECT count(*)::int FROM journal_transaction WHERE device_id = pg_temp.id('61aa02') AND type = 'PURCHASE'), 12,
  'toutes les ventes de T2 (dont s2) sont écrites (le commerçant est garanti)');
SELECT is(pg_temp.avail('6a0007', 'WALLET_PAID'), (1000000 - 490000 - 9000 - 1000)::bigint,
  'portefeuille 7 : débité de 490 000 + 9 000 + 1 000 exactement');

-- 13. Devise sans plafond configuré : échec fermé ------------------------------------------------------------------
SELECT pg_temp.run('e1', '61e010', 1, jsonb_set(jsonb_set(pg_temp.op(1, 'E1', 11, 1000, 1000), '{currency}', '"EUR"'),
   '{tap,counter}', '1'));
SELECT is(pg_temp.res('e1', 'outcome') || '/' || pg_temp.res('e1', 'reason') || '/' || pg_temp.res('e1', 'detail'),
  'REJECTED/INSUFFICIENT_FUNDS_RETRY/EDGE_CEILING_NOT_CONFIGURED', 'devise sans plafond : l''enveloppe refuse d''écrire');
SELECT is((SELECT count(*)::int FROM journal_transaction WHERE ledger_id = pg_temp.ledger_of('61d010') AND source = 'EDGE_SYNC'), 0,
  'rien d''écrit sans plafond');
SELECT set_edge_setting('replay_max_per_sale.EUR', 30000, 'test');
SELECT set_edge_setting('replay_max_per_terminal_hour.EUR', 300000, 'test');
SELECT pg_temp.run('e2', '61e010', 1, jsonb_set(jsonb_set(pg_temp.op(2, 'E1', 11, 40000, 40000), '{currency}', '"EUR"'),
   '{tap,counter}', '2'));
SELECT is(pg_temp.res('e2', 'charged') || '/' || pg_temp.res('e2', 'detail'), '30000/EDGE_REPLAY_CEILING',
  'clé suffixée par devise : appliquée');

-- 14. Régime DEVICE_OFFLINE attesté ---------------------------------------------------------------------------------
SELECT pg_temp.run('x1', '61e001', 1, (pg_temp.op(pg_temp.nx('61e001'), 'T1', 10, 60000, 60000)
   || jsonb_build_object('authorized_mode', 'DEVICE_OFFLINE', 'device_batch_id', pg_temp.id('61ba01'),
        'device_batch_verified', true)) #- '{tap,signature_verified}');
SELECT is(pg_temp.res('x1', 'outcome') || '/' || pg_temp.res('x1', 'charged'), 'ACCEPTED/60000',
  'DEVICE_OFFLINE attesté par l''API : lot signé tient lieu de preuve, plafonds de rejeu non appliqués');
SELECT is((SELECT last_counter FROM media WHERE id = pg_temp.id('6b0010')), NULL::bigint,
  'DEVICE_OFFLINE : le compteur n''est pas touché ici');

-- 15. Rejeu et DUPLICATE ----------------------------------------------------------------------------------------------
SELECT is((SELECT count(*)::int FROM journal_transaction WHERE ledger_id = pg_temp.ledger_of('61d001')
            AND source = 'EDGE_SYNC'), (SELECT count(*)::int FROM edge_sync_registry WHERE gateway_id = pg_temp.id('61e001')
            AND transaction_id IS NOT NULL AND outcome <> 'DUPLICATE'), 'une écriture exactement par numéro accepté');
CREATE TEMP TABLE before_replay AS SELECT count(*) AS n FROM journal_transaction WHERE source = 'EDGE_SYNC';
SELECT set_config('app.gateway_id', pg_temp.id('61e001')::text, true);
SELECT is((SELECT outcome || '/' || transaction_id::text FROM edge_post_transaction(pg_temp.id('61e001'), 1, 1, 'T1:0001',
   (SELECT content_sha256 FROM edge_sync_registry WHERE gateway_id = pg_temp.id('61e001') AND edge_seq = 1),
   pg_temp.op(1, 'T1', 1, 5000, 5000), NULL)), 'ACCEPTED/' || (SELECT tx FROM r WHERE name = 's1'),
  'numéro déjà au registre : résultat mémorisé, sans nouvelle écriture');
SELECT is((SELECT count(*) FROM journal_transaction WHERE source = 'EDGE_SYNC'), (SELECT n FROM before_replay),
  'le rejeu n''écrit rien');
SELECT throws_ok($$SELECT * FROM edge_post_transaction(pg_temp.id('61e001'), 1, 1, 'T1:0001', sha256('autre'),
   pg_temp.op(1, 'T1', 1, 5000, 5000), NULL)$$, 'CL002', NULL, 'même numéro, autre contenu : CL002');
-- Clé d'origine déjà écrite au journal (même clé, hors registre) : DUPLICATE avec la transaction existante.
CREATE TEMP TABLE pre AS
SELECT post_transaction(pg_temp.ledger_of('61d001'), 'PURCHASE', 'T1:' || lpad(pg_temp.nx('61e001')::text, 4, '0'), now(), 'EDGE_SYNC',
  jsonb_build_array(jsonb_build_object('account_id', pg_temp.acc(pg_temp.ledger_of('61d001'), 'L-WAL-9-P'), 'amount', 100),
                    jsonb_build_object('account_id', pg_temp.acc(pg_temp.ledger_of('61d001'), 'L-MCH-' || pg_temp.id('61d0011')), 'amount', -100)),
  NULL, NULL, NULL, NULL, NULL, NULL, NULL) AS tx;
SELECT pg_temp.run('u1', '61e001', 1, pg_temp.op(pg_temp.nx('61e001'), 'T1', 9, 100, 100));
SELECT is(pg_temp.res('u1', 'outcome') || '/' || pg_temp.res('u1', 'tx'), 'DUPLICATE/' || (SELECT tx FROM pre),
  'clé déjà au journal : DUPLICATE avec la transaction existante');

-- 16. Isolation entre prestataires -------------------------------------------------------------------------------------
SELECT set_config('app.operator_id', pg_temp.id('61a002')::text, true);
SELECT throws_ok($$SELECT pg_temp.run('x', '61e001', 1, pg_temp.op(pg_temp.nx('61e001'), 'T1', 1, 100, 100))$$,
  'P0002', NULL, 'session d''un autre prestataire : objet introuvable (aucun oracle)');
SELECT pg_temp.a();

-- 17. REVERSAL borné (A08) -----------------------------------------------------------------------------------------------
SELECT pg_temp.run('r1', '61e001', 1, pg_temp.op(pg_temp.nx('61e001'), 'T1', 8, 4000, 4000), pg_temp.fee(400, 330, 70));
SELECT pg_temp.run('r1v', '61e001', 1, pg_temp.rev(pg_temp.nx('61e001'), 'T1', 8,
   (SELECT edge_seq FROM edge_sync_registry WHERE transaction_id = (SELECT tx FROM r WHERE name = 'r1'))));
SELECT is(pg_temp.res('r1v', 'outcome'), 'ACCEPTED', 'annulation d''une vente écrite : ACCEPTED');
SELECT is(pg_temp.lines((SELECT tx FROM r WHERE name = 'r1v')),
  'WALLET_PAID:-4000,MERCHANT:4000,MERCHANT:-400,ORG_COM:330,ORG_TAX:70',
  'contre-passation exacte : mêmes comptes, signes inversés, frais compris');
SELECT is(pg_temp.avail('6a0008', 'WALLET_PAID'), 100000::bigint, 'le portefeuille récupère exactement le débit d''origine');
SELECT is((SELECT reverses_id FROM journal_transaction WHERE id = (SELECT tx FROM r WHERE name = 'r1v')),
  (SELECT tx FROM r WHERE name = 'r1'), 'REVERSAL rattachée à la vente');
-- Annulation répétée : DUPLICATE
SELECT pg_temp.run('r1w', '61e001', 1, pg_temp.rev(pg_temp.nx('61e001'), 'T1', 8,
   (SELECT edge_seq FROM edge_sync_registry WHERE transaction_id = (SELECT tx FROM r WHERE name = 'r1'))));
SELECT is(pg_temp.res('r1w', 'outcome') || '/' || pg_temp.res('r1w', 'detail'), 'DUPLICATE/ALREADY_REVERSED',
  'même reverses_seq émis deux fois : DUPLICATE');
SELECT is(pg_temp.res('r1w', 'tx'), pg_temp.res('r1v', 'tx'), 'DUPLICATE rend la transaction de l''annulation existante');
SELECT is(pg_temp.avail('6a0008', 'WALLET_PAID'), 100000::bigint, 'double annulation : aucun second crédit');
-- Vente en manque (m1 : 15 000 dont 5 000 en attente), annulation qui prétend tout rendre au portefeuille
SELECT pg_temp.run('r2v', '61e001', 1, (pg_temp.rev(pg_temp.nx('61e001'), 'T1', 2,
   (SELECT edge_seq FROM edge_sync_registry WHERE transaction_id = (SELECT tx FROM r WHERE name = 'm1')))
   || jsonb_build_object('amount', 15000, 'edge_decision',
        '{"status":"ACCEPTED","charged_to_wallet":15000,"shortfall_amount":0}'::jsonb)));
SELECT is(pg_temp.res('r2v', 'outcome') || '/' || pg_temp.res('r2v', 'charged'), 'ACCEPTED/10000',
  'annulation d''une vente en manque : crédit au plus le charged_to_wallet écrit (10 000, pas 15 000)');
SELECT is(pg_temp.lines((SELECT tx FROM r WHERE name = 'r2v')), 'WALLET_PAID:-10000,SUSPENSE:-5000,MERCHANT:15000',
  'la part restée en attente est annulée, le portefeuille n''est crédité que de ce qu''il avait payé');
SELECT is((SELECT status || '/' || amount FROM anomaly WHERE kind = 'OFFLINE_SHORTFALL'
            AND transaction_id = (SELECT tx FROM r WHERE name = 'm1')), 'RESOLVED/0',
  'l''anomalie OFFLINE_SHORTFALL est soldée par reduce_offline_shortfall');
SELECT is(pg_temp.avail('6a0002', 'WALLET_PAID'), 10000::bigint, 'portefeuille 2 : solde d''origine, rien de créé');
-- m2 (tout en attente) : l'annulation ne crédite rien au portefeuille
SELECT pg_temp.run('r3v', '61e001', 1, (pg_temp.rev(pg_temp.nx('61e001'), 'T1', 2,
   (SELECT edge_seq FROM edge_sync_registry WHERE transaction_id = (SELECT tx FROM r WHERE name = 'm2')))
   || jsonb_build_object('amount', 3000, 'edge_decision',
        '{"status":"ACCEPTED","charged_to_wallet":3000,"shortfall_amount":0}'::jsonb)));
SELECT is(pg_temp.res('r3v', 'charged') || '/' || pg_temp.res('r3v', 'shortfall'), '0/3000',
  'annulation d''une vente entièrement en attente : aucun crédit au portefeuille');
SELECT is(pg_temp.avail('6a0002', 'WALLET_PAID'), 10000::bigint, 'portefeuille 2 inchangé');
-- Cibles invalides
SELECT pg_temp.run('r4', '61e001', 1, pg_temp.rev(pg_temp.nx('61e001'), 'T1', 8, 4242));
SELECT is(pg_temp.res('r4', 'outcome') || '/' || pg_temp.res('r4', 'reason'), 'REJECTED/REVERSAL_TARGET_NOT_FOUND',
  'cible absente : REJECTED / REVERSAL_TARGET_NOT_FOUND');
SELECT pg_temp.run('r5', '61e001', 1, pg_temp.rev(pg_temp.nx('61e001'), 'T1', 8,
   (SELECT edge_seq FROM edge_sync_registry WHERE gateway_id = pg_temp.id('61e001') AND outcome = 'REJECTED' LIMIT 1)));
SELECT is(pg_temp.res('r5', 'reason'), 'REVERSAL_TARGET_NOT_FOUND', 'cible rejetée (non écrite) : REVERSAL_TARGET_NOT_FOUND');
SELECT pg_temp.run('r6', '61e001', 1, pg_temp.op(pg_temp.nx('61e001'), 'T1', 8, 1000, 1000));
SELECT pg_temp.run('r6v', '61e001', 1, pg_temp.rev(pg_temp.nx('61e001'), 'T1', 9,
   (SELECT edge_seq FROM edge_sync_registry WHERE transaction_id = (SELECT tx FROM r WHERE name = 'r6'))));
SELECT is(pg_temp.res('r6v', 'detail'), 'REVERSAL_OTHER_WALLET', 'annulation avec le bracelet d''un autre portefeuille : REJECTED');
SELECT pg_temp.run('r7v', '61e001', 1, (pg_temp.rev(pg_temp.nx('61e001'), 'T1', 8,
   (SELECT edge_seq FROM edge_sync_registry WHERE transaction_id = (SELECT tx FROM r WHERE name = 'r6')))
   || jsonb_build_object('amount', 5000, 'edge_decision', '{"status":"ACCEPTED","charged_to_wallet":5000,"shortfall_amount":0}'::jsonb)));
SELECT is(pg_temp.res('r7v', 'detail'), 'REVERSAL_AMOUNT_MISMATCH', 'montant d''annulation supérieur à la vente : REJECTED');
SELECT pg_temp.run('r8v', '61e001', 1, pg_temp.rev(pg_temp.nx('61e001'), 'T1', 8,
   (SELECT edge_seq FROM edge_sync_registry WHERE transaction_id = (SELECT tx FROM r WHERE name = 'r6')))
   #- '{tap,signature_verified}');
SELECT is(pg_temp.res('r8v', 'detail'), 'TAP_SIGNATURE_NOT_VERIFIED', 'annulation EDGE_ONLINE sans preuve du bracelet : REJECTED');
SELECT is((SELECT count(*)::int FROM journal_transaction t WHERE t.type = 'REVERSAL' AND t.reverses_id = (SELECT tx FROM r WHERE name = 'r6')), 0,
  'ces refus n''écrivent aucune annulation');

-- 17 bis. Cible de l'annulation bornée à cette passerelle et au cycle courant (M1) ---------------------------------------------
CREATE TEMP TABLE pre2 AS
SELECT post_transaction(pg_temp.ledger_of('61d001'), 'PURCHASE', 'ZZ:1', now(), 'EDGE_SYNC',
  jsonb_build_array(jsonb_build_object('account_id', pg_temp.acc(pg_temp.ledger_of('61d001'), 'L-WAL-9-P'), 'amount', 100),
                    jsonb_build_object('account_id', pg_temp.acc(pg_temp.ledger_of('61d001'), 'L-MCH-' || pg_temp.id('61d0011')), 'amount', -100)),
  NULL, NULL, NULL, NULL, NULL, NULL, NULL) AS tx;
SELECT pg_temp.run('bm1', '61e001', 1, pg_temp.rev(pg_temp.nx('61e001'), 'T1', 9, 1)
   || jsonb_build_object('reverses_transaction_id', (SELECT tx FROM pre2)));
SELECT is(pg_temp.res('bm1', 'reason') || '/' || pg_temp.res('bm1', 'detail'), 'REVERSAL_TARGET_NOT_FOUND/TARGET_NOT_IN_CYCLE',
  'annulation d''une vente EDGE_SYNC qui n''est pas de cette passerelle : refusée');
SELECT pg_temp.run('bm2', '61e001', 1, pg_temp.op(pg_temp.nx('61e001'), 'T1', 9, 700, 700));
UPDATE debit_authority_handover SET requested_at = now() + interval '1 day'
 WHERE edge_gateway_id = pg_temp.id('61e001') AND direction = 'TO_EDGE';
SELECT pg_temp.run('bm3', '61e001', 1, pg_temp.rev(pg_temp.nx('61e001'), 'T1', 9,
   (SELECT edge_seq FROM edge_sync_registry WHERE transaction_id = (SELECT tx FROM r WHERE name = 'bm2'))));
SELECT is(pg_temp.res('bm3', 'detail'), 'TARGET_NOT_IN_CYCLE', 'annulation d''une vente écrite avant le cycle de remise courant : refusée');
UPDATE debit_authority_handover SET requested_at = now() - interval '1 minute'
 WHERE edge_gateway_id = pg_temp.id('61e001') AND direction = 'TO_EDGE';
SELECT pg_temp.run('bm4', '61e001', 1, pg_temp.rev(pg_temp.nx('61e001'), 'T1', 9,
   (SELECT edge_seq FROM edge_sync_registry WHERE transaction_id = (SELECT tx FROM r WHERE name = 'bm2'))));
SELECT is(pg_temp.res('bm4', 'outcome'), 'ACCEPTED', 'même annulation dans le cycle : acceptée');

-- 18. CL007 simulée : rejeu, puis INSUFFICIENT_FUNDS_RETRY --------------------------------------------------------------
CREATE TEMP SEQUENCE cl_seq;
CREATE FUNCTION pg_temp.boom7() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.account_id = pg_temp.acc(pg_temp.ledger_of('61d001'), 'L-WAL-8-P')
     AND nextval('pg_temp.cl_seq') <= current_setting('test.cl_fail')::int THEN
    RAISE EXCEPTION 'CL007 simulée' USING ERRCODE = 'CL007';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER boom7 BEFORE INSERT ON posting FOR EACH ROW EXECUTE FUNCTION pg_temp.boom7();
SELECT set_config('test.cl_fail', '1', false);
SELECT setval('pg_temp.cl_seq', 1, false);
SELECT pg_temp.run('k1', '61e001', 1, pg_temp.op(pg_temp.nx('61e001'), 'T1', 8, 2000, 2000));
SELECT is(pg_temp.res('k1', 'outcome'), 'ACCEPTED', 'CL007 une fois : la transaction annulée est rejouée, ACCEPTED');
SELECT is((SELECT count(*)::int FROM journal_transaction WHERE idempotency_key = 'T1:' ||
   lpad((SELECT edge_seq::text FROM edge_sync_registry WHERE transaction_id = (SELECT tx FROM r WHERE name = 'k1')), 4, '0')), 1,
  'une seule écriture (la première tentative n''a rien laissé)');
SELECT is(pg_temp.avail('6a0008', 'WALLET_PAID'), (100000 - 1000 - 2000)::bigint, 'portefeuille débité une seule fois (2 000 après la vente de 1 000)');
SELECT set_config('test.cl_fail', '2', false);
SELECT setval('pg_temp.cl_seq', 1, false);
SELECT pg_temp.run('k2', '61e001', 1, pg_temp.op(pg_temp.nx('61e001'), 'T1', 8, 2000, 2000));
SELECT is(pg_temp.res('k2', 'outcome') || '/' || pg_temp.res('k2', 'reason') || '/' || pg_temp.res('k2', 'detail'),
  'REJECTED/INSUFFICIENT_FUNDS_RETRY/CL007', 'CL007 deux fois : REJECTED / INSUFFICIENT_FUNDS_RETRY');
SELECT is((SELECT outcome || '/' || reason FROM edge_sync_registry WHERE gateway_id = pg_temp.id('61e001')
            ORDER BY edge_seq DESC LIMIT 1), 'REJECTED/INSUFFICIENT_FUNDS_RETRY',
  'le numéro est enregistré (jamais consommé sans effet explicite)');
SELECT is(pg_temp.avail('6a0008', 'WALLET_PAID'), (100000 - 1000 - 2000)::bigint, 'rien n''a été prélevé');
SELECT is((SELECT count(*)::int FROM anomaly WHERE kind = 'NON_COMPLIANT_OPERATION'
            AND detail ->> 'reason' = 'INSUFFICIENT_FUNDS_RETRY' AND detail ->> 'detail' = 'CL007'), 1, 'anomalie ouverte');
SELECT is((SELECT last_counter FROM media WHERE id = pg_temp.id('6b0008')),
  (SELECT (tap ->> 'counter')::bigint FROM (SELECT pg_temp.op(0, 'x', 8, 1, 1) -> 'tap' AS tap) z) + (SELECT edge_seq FROM edge_sync_registry
     WHERE transaction_id = (SELECT tx FROM r WHERE name = 'k1')),
  'le compteur du bracelet n''avance que pour l''écriture réussie');
DROP TRIGGER boom7 ON posting;

-- 19. Écriture et registre dans UNE transaction -----------------------------------------------------------------------------
CREATE FUNCTION pg_temp.boom_reg() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.edge_seq = current_setting('test.boom')::bigint THEN RAISE EXCEPTION 'échec du registre simulé'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER boom_reg BEFORE INSERT ON edge_sync_registry FOR EACH ROW EXECUTE FUNCTION pg_temp.boom_reg();
SELECT set_config('test.boom', pg_temp.nx('61e001')::text, false);
CREATE TEMP TABLE before_boom AS SELECT pg_temp.avail('6a0008', 'WALLET_PAID') AS bal, pg_temp.nx('61e001') AS nx,
  (SELECT count(*) FROM journal_transaction) AS n;
SELECT throws_ok($$SELECT pg_temp.run('z', '61e001', 1, pg_temp.op(pg_temp.nx('61e001'), 'T1', 8, 1500, 1500))$$,
  'P0001', NULL, 'une erreur au registre annule aussi l''écriture');
SELECT is((SELECT count(*) FROM journal_transaction), (SELECT n FROM before_boom), 'aucune écriture ne survit à l''échec du registre');
SELECT is(pg_temp.avail('6a0008', 'WALLET_PAID'), (SELECT bal FROM before_boom), 'solde inchangé');
SELECT is(pg_temp.nx('61e001'), (SELECT nx FROM before_boom), 'numéro non consommé');
DROP TRIGGER boom_reg ON edge_sync_registry;

-- 20. Période close : CL005 devient un rejet enregistré ---------------------------------------------------------------------
UPDATE ledger SET locked_until = now() + interval '1 day' WHERE id = pg_temp.ledger_of('61d001');
SELECT pg_temp.run('pc', '61e001', 1, pg_temp.op(pg_temp.nx('61e001'), 'T1', 8, 1000, 1000));
SELECT is(pg_temp.res('pc', 'outcome') || '/' || pg_temp.res('pc', 'reason'), 'REJECTED/PERIOD_CLOSED',
  'période close : REJECTED / PERIOD_CLOSED, numéro enregistré');
UPDATE ledger SET locked_until = NULL WHERE id = pg_temp.ledger_of('61d001');

-- 21. Passerelle hostile : 2 000 ventes fictives ------------------------------------------------------------------------------
-- Trois terminaux, quatre portefeuilles de 1 000 000, heures d'origine étalées sur +/- 1 000 jours, compteurs croissants.
DO $$
DECLARE i int;
BEGIN
  FOR i IN 1..2000 LOOP
    PERFORM pg_temp.run('hostile' || i, '61e009', 1,
      jsonb_set(pg_temp.op(pg_temp.nx('61e009'), 'H' || (1 + i % 3), 21 + i % 4, 40000, 40000), '{occurred_at}',
                to_jsonb(pg_temp.ts(clock_timestamp() + ((i - 1000) || ' days')::interval))));
  END LOOP;
END $$;
CREATE TEMP TABLE hostile AS
SELECT (SELECT coalesce(sum(po.amount), 0) FROM posting po JOIN account a ON a.id = po.account_id
         JOIN journal_transaction t ON t.id = po.transaction_id AND t.source = 'EDGE_SYNC'
        WHERE a.purpose IN ('WALLET_PAID', 'WALLET_PROMO') AND t.ledger_id = pg_temp.ledger_of('61d009'))::bigint AS lost,
       (SELECT sum(-po.amount) FROM posting po JOIN account a ON a.id = po.account_id
         JOIN journal_transaction t ON t.id = po.transaction_id AND t.source = 'EDGE_SYNC'
        WHERE a.purpose = 'MERCHANT' AND t.ledger_id = pg_temp.ledger_of('61d009'))::bigint AS merchant,
       (SELECT sum(po.amount) FROM posting po JOIN account a ON a.id = po.account_id
        WHERE a.purpose = 'SUSPENSE' AND po.ledger_id = pg_temp.ledger_of('61d009'))::bigint AS suspense;
-- P_max calculé par le test, indépendamment de la fonction : min(Σ soldes ; T x H x plafond horaire ; passages x plafond par vente)
--   Σ soldes = 4 000 000 ; T = 3, H = 1 h (la fenêtre d'étalement est bornée au cycle, 30 min), plafond horaire 500 000 ;
--   passages réels = 2 000 x plafond par vente 50 000.
SELECT is((SELECT count(*)::int FROM r WHERE name ~ '^hostile' AND outcome IN ('ACCEPTED', 'ACCEPTED_WITH_SHORTFALL')), 2000,
  'passerelle hostile : aucune des 2 000 ventes n''est perdue pour les commerçants');
SELECT ok((SELECT lost FROM hostile) <= LEAST(4000000, 3 * 1 * 500000, 2000 * 50000),
  'perte hostile mesurée ' || (SELECT lost FROM hostile) || ' XOF <= P_max ' || LEAST(4000000, 3 * 1 * 500000, 2000 * 50000)
  || ' XOF (T x H x plafond horaire)');
SELECT is((SELECT merchant FROM hostile), 2000 * 40000::bigint, 'les commerçants sont garantis : 80 000 000 XOF crédités');
SELECT is((SELECT suspense FROM hostile), (SELECT merchant - lost FROM hostile),
  'le reste est en S-ATTENTE : rien n''est créé ni perdu');
SELECT is((SELECT sum(po.amount)::bigint FROM posting po WHERE po.ledger_id = pg_temp.ledger_of('61d009')
            AND po.transaction_id IN (SELECT id FROM journal_transaction WHERE source = 'EDGE_SYNC')), 0::bigint,
  'somme nulle de toutes les écritures de la passerelle hostile');
SELECT ok((SELECT count(*) FROM audit_log WHERE action = 'EDGE_REPLAY_CEILING' AND object_id = pg_temp.id('61e009')::text) > 0,
  'alertes EDGE_REPLAY_CEILING levées');

-- 21 bis. Variantes hostiles (constat B1) : heures d'origine DECROISSANTES, puis MELANGEES ---------------------------------------
-- Même calcul de P_max : 3 terminaux x 1 h x 500 000 = 1 500 000 (toutes les heures sont ramenées dans la fenêtre du cycle).
DO $$
DECLARE i int;
BEGIN
  FOR i IN 1..1000 LOOP
    PERFORM pg_temp.run('desc' || i, '61e011', 1,
      jsonb_set(pg_temp.op(pg_temp.nx('61e011'), 'D' || (1 + i % 3), 31 + i % 4, 40000, 40000), '{occurred_at}',
                to_jsonb(pg_temp.ts(clock_timestamp() - (i * 0.3 || ' seconds')::interval))));
    PERFORM pg_temp.run('mix' || i, '61e012', 1,
      jsonb_set(pg_temp.op(pg_temp.nx('61e012'), 'M' || (1 + i % 3), 41 + i % 4, 40000, 40000), '{occurred_at}',
                to_jsonb(pg_temp.ts(clock_timestamp() + (((i * 7919) % 3600 - 1800) || ' seconds')::interval))));
  END LOOP;
END $$;
CREATE FUNCTION pg_temp.lost(p_event text) RETURNS bigint LANGUAGE sql AS $$
  SELECT coalesce(sum(po.amount), 0)::bigint FROM posting po JOIN account a ON a.id = po.account_id
    JOIN journal_transaction t ON t.id = po.transaction_id AND t.source = 'EDGE_SYNC'
   WHERE a.purpose IN ('WALLET_PAID', 'WALLET_PROMO') AND t.ledger_id = pg_temp.ledger_of(p_event) $$;
SELECT ok(pg_temp.lost('61d011') <= LEAST(4000000, 3 * 500000),
  'heures décroissantes : perte mesurée ' || pg_temp.lost('61d011') || ' XOF <= P_max 1 500 000');
SELECT ok(pg_temp.lost('61d012') <= LEAST(4000000, 3 * 500000),
  'heures mélangées (tard, tôt, entre les deux) : perte mesurée ' || pg_temp.lost('61d012') || ' XOF <= P_max 1 500 000');
SELECT ok((SELECT count(*) FROM audit_log WHERE action = 'EDGE_REPLAY_CEILING' AND object_id = pg_temp.id('61e011')::text) > 0,
  'heures décroissantes : alerte EDGE_REPLAY_CEILING levée');
SELECT ok((SELECT count(*) FROM audit_log WHERE action = 'EDGE_REPLAY_CEILING' AND object_id = pg_temp.id('61e012')::text) > 0,
  'heures mélangées : alerte EDGE_REPLAY_CEILING levée');
SELECT is((SELECT count(*)::int FROM r WHERE name ~ '^(desc|mix)' AND outcome IN ('ACCEPTED', 'ACCEPTED_WITH_SHORTFALL')), 2000,
  'variantes hostiles : aucune vente perdue pour les commerçants');

-- 22. Invariants généraux ------------------------------------------------------------------------------------------------------
SELECT is((SELECT count(*)::int FROM (SELECT t.id FROM journal_transaction t JOIN posting po ON po.transaction_id = t.id
            WHERE t.source = 'EDGE_SYNC' GROUP BY t.id HAVING sum(po.amount) <> 0) z), 0, 'toute transaction EDGE_SYNC écrite est de somme nulle');
SELECT is((SELECT count(*)::int FROM journal_transaction t WHERE t.source = 'EDGE_SYNC' AND t.id NOT IN ((SELECT tx FROM pre), (SELECT tx FROM pre2))
            AND NOT (t.metadata ? 'origin_key' AND t.metadata ? 'origin_occurred_at' AND t.metadata ? 'origin_mode')), 0,
  'metadata complète sur toute écriture EDGE_SYNC');
SELECT is((SELECT count(*)::int FROM journal_transaction t WHERE t.source = 'EDGE_SYNC'
            AND t.id <> (SELECT tx FROM pre2)
            AND NOT EXISTS (SELECT 1 FROM edge_sync_registry r2 WHERE r2.transaction_id = t.id)), 0,
  'toute écriture EDGE_SYNC a son numéro au registre');
SELECT is((SELECT count(*)::int FROM edge_sync_registry WHERE gateway_id = pg_temp.id('61e001'))::bigint,
  (SELECT contiguous_edge_seq FROM edge_gateway WHERE id = pg_temp.id('61e001')), 'numérotation continue, un numéro par résultat');
SELECT is((SELECT count(*)::int FROM edge_sync_registry WHERE outcome = 'REJECTED' AND reason IS NULL), 0, 'aucun rejet sans raison');
-- 20. Décision 52 (0070) : clé d'origine = deviceKey, `<serial>:<seq>` complété à 4 chiffres, jamais tronqué ---------
SELECT is(edge_seq_text(7) || '/' || edge_seq_text(1234) || '/' || edge_seq_text(12345) || '/' || edge_seq_text(9007199254740991),
  '0007/1234/12345/9007199254740991', 'edge_seq_text : complété à 4 chiffres, jamais tronqué');
CREATE TEMP TABLE k52 (k text);
INSERT INTO k52 SELECT 'T1:' || pg_temp.nx('61e001');
SELECT pg_temp.run('p52', '61e001', 1, pg_temp.op(pg_temp.nx('61e001'), 'T1', 1, 100, 100));
SELECT is(pg_temp.res('p52', 'outcome'), 'ACCEPTED', 'clé complétée (T1:000N) : acceptée');
SELECT is((SELECT t.idempotency_key FROM journal_transaction t WHERE t.id = (SELECT tx FROM r WHERE name = 'p52')),
  'T1:' || lpad((SELECT edge_seq::text FROM edge_sync_registry WHERE transaction_id = (SELECT tx FROM r WHERE name = 'p52')),
                4, '0'), 'la clé du journal est la clé complétée');
-- Clé non complétée (seq < 1000) : refusée, le numéro est consommé avec REJECTED.
SELECT set_config('app.gateway_id', pg_temp.id('61e001')::text, true);
CREATE TEMP TABLE o52 AS SELECT pg_temp.op(pg_temp.nx('61e001'), 'T1', 1, 100, 100) AS op;
INSERT INTO r SELECT 'q52', x.* FROM o52, edge_post_transaction(pg_temp.id('61e001'), 1, (o52.op ->> 'edge_seq')::bigint,
  'T1:' || (o52.op ->> 'seq'), sha256(convert_to(o52.op::text, 'UTF8')), o52.op, NULL) x;
SELECT is(pg_temp.res('q52', 'outcome') || '/' || pg_temp.res('q52', 'reason') || '/' || pg_temp.res('q52', 'detail'),
  'REJECTED/MALFORMED_OPERATION/ORIGIN_FIELDS', 'clé non complétée (T1:7) : refusée');
SELECT is((SELECT count(*)::int FROM journal_transaction t WHERE t.idempotency_key = (SELECT 'T1:' || (op ->> 'seq') FROM o52)),
  0, 'clé non complétée : aucune écriture');
-- Annulation désignant l'original par son seq : retrouvé sous la clé complétée.
SELECT pg_temp.run('p52r', '61e001', 1, pg_temp.rev(pg_temp.nx('61e001'), 'T1', 1,
  (SELECT edge_seq FROM edge_sync_registry WHERE transaction_id = (SELECT tx FROM r WHERE name = 'p52'))));
SELECT is(pg_temp.res('p52r', 'outcome'), 'ACCEPTED', 'reverses_seq retrouve l''original sous la clé complétée');
SELECT * FROM finish();
ROLLBACK;
