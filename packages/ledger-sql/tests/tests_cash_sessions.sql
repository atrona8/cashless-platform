-- Sessions de caisse, comptages à l'aveugle, fermeture en deux temps et gardes (migration 0036 ;
-- mission recharges-caisses-psp, lot WP02 ; FR-001 à FR-004, FR-006, NFR-007, NFR-008) — pgTAP,
-- écrit à la main (pas un fichier généré).
-- Lancer : pg_prove -d <base> tests/tests_cash_sessions.sql (base créée par les migrations).
-- La suite rejoue roles.sql pour les parties sous cashless_app ; les droits fins de WP05
-- (post-roles.sql) ne sont pas encore là : on ne teste ici que la garde de compte. Le seul accord
-- posé par la suite est EXECUTE sur open_cash_session à cashless_app (annulé par le ROLLBACK), qui
-- imite l'accord de WP05. La concurrence à deux connexions est prouvée par WP14 (T071).
\set ON_ERROR_STOP 1
\set QUIET 1
BEGIN;
SET LOCAL client_min_messages = warning;
\ir ../roles.sql
RESET client_min_messages;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

CREATE FUNCTION pg_temp.id(p text) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT ('00000000-0000-0000-0000-' || lpad(p, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.a() RETURNS void LANGUAGE sql AS
  $$ SELECT set_config('app.operator_id', pg_temp.id('36a001')::text, true) $$;
CREATE FUNCTION pg_temp.b() RETURNS void LANGUAGE sql AS
  $$ SELECT set_config('app.operator_id', pg_temp.id('36a002')::text, true) $$;
CREATE FUNCTION pg_temp.none() RETURNS void LANGUAGE sql AS
  $$ SELECT set_config('app.operator_id', '', true) $$;

-- Données (propriétaire) ------------------------------------------------------------------------
-- A : organisateur b001 ; événements d001 (LIVE), d002 (DRAFT), d003 (CLOSED), d004 (LIVE, grand
-- livre LOCKED), d005 (CLOSING), d006 (LIVE, sans grand livre, pour open_event_ledger).
-- B : organisateur b011, événement d011 (LIVE).
INSERT INTO party (kind, legal_name) SELECT 'PLATFORM', 'Plateforme (test)'
 WHERE NOT EXISTS (SELECT 1 FROM party WHERE kind = 'PLATFORM');
INSERT INTO party (id, kind, legal_name, country_code) VALUES
 (pg_temp.id('36a001'), 'OPERATOR', 'Prestataire A', 'SN'),
 (pg_temp.id('36a002'), 'OPERATOR', 'Prestataire B', 'CI');
INSERT INTO party (id, kind, operator_id, legal_name) VALUES
 (pg_temp.id('36b001'), 'ORGANIZER', pg_temp.id('36a001'), 'Organisateur A'),
 (pg_temp.id('36b011'), 'ORGANIZER', pg_temp.id('36a002'), 'Organisateur B');
INSERT INTO jurisdiction_profile (id, country_code, version, valid_from, breakage_destination)
VALUES (pg_temp.id('36c001'), 'SN', 360036, '2026-01-01', 'ORGANIZER');
INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone, jurisdiction_id,
                   funds_holder, status)
SELECT pg_temp.id(e), pg_temp.id(o), pg_temp.id(g), 'Événement ' || e, 'XOF', 'Africa/Dakar',
       pg_temp.id('36c001'), 'ORGANIZER', s::event_status
  FROM (VALUES ('36d001','36a001','36b001','LIVE'), ('36d002','36a001','36b001','DRAFT'),
               ('36d003','36a001','36b001','CLOSED'), ('36d004','36a001','36b001','LIVE'),
               ('36d005','36a001','36b001','CLOSING'), ('36d006','36a001','36b001','LIVE'),
               ('36d011','36a002','36b011','LIVE')) AS v(e, o, g, s);
SELECT pg_temp.a();
SELECT open_event_ledger(pg_temp.id(e))
  FROM (VALUES ('36d001'), ('36d003'), ('36d004'), ('36d005')) AS v(e);
SELECT pg_temp.b();
SELECT open_event_ledger(pg_temp.id('36d011'));
UPDATE ledger SET status = 'LOCKED' WHERE scope_id = pg_temp.id('36d004');
UPDATE ledger SET status = 'CLOSING' WHERE scope_id = pg_temp.id('36d005');
CREATE FUNCTION pg_temp.lg(p_event text) RETURNS uuid LANGUAGE sql AS
  $$ SELECT id FROM ledger WHERE scope_id = pg_temp.id(p_event) $$;
CREATE FUNCTION pg_temp.acc(p_ledger uuid, p_code text) RETURNS uuid LANGUAGE sql AS
  $$ SELECT id FROM account WHERE ledger_id = p_ledger AND code = p_code $$;
-- Personnes : e001 CASHIER d001 ; e002 SUPERVISOR d001 ; e003 CASHIER de l'organisateur b001 ;
-- e004 SUPERVISOR d001 ; e005 sans rôle ; e006 SUPERVISOR d002 seulement ; e007 CASHIER d001
-- révoqué ; e011 SUPERVISOR de B.
INSERT INTO app_user (id, operator_id, issuer, subject, email, display_name)
SELECT pg_temp.id(u), pg_temp.id(o), 'https://idp.test', 's0036' || u, u || '@test', 'Personne ' || u
  FROM (VALUES ('36e001','36a001'), ('36e002','36a001'), ('36e003','36a001'), ('36e004','36a001'),
               ('36e005','36a001'), ('36e006','36a001'), ('36e007','36a001'),
               ('36e011','36a002')) AS v(u, o);
INSERT INTO role_assignment (user_id, role, scope_type, scope_id, granted_by) VALUES
 (pg_temp.id('36e001'), 'CASHIER', 'EVENT', pg_temp.id('36d001'), NULL),
 (pg_temp.id('36e002'), 'SUPERVISOR', 'EVENT', pg_temp.id('36d001'), NULL),
 (pg_temp.id('36e003'), 'CASHIER', 'ORGANIZER', pg_temp.id('36b001'), NULL),
 (pg_temp.id('36e004'), 'SUPERVISOR', 'EVENT', pg_temp.id('36d001'), NULL),
 (pg_temp.id('36e006'), 'SUPERVISOR', 'EVENT', pg_temp.id('36d002'), NULL),
 (pg_temp.id('36e007'), 'CASHIER', 'EVENT', pg_temp.id('36d001'), NULL),
 (pg_temp.id('36e011'), 'SUPERVISOR', 'EVENT', pg_temp.id('36d011'), NULL);
UPDATE role_assignment SET revoked_at = now(), revoked_by = pg_temp.id('36e002')
 WHERE user_id = pg_temp.id('36e007');
-- Terminaux de A : aa01 à aa20 TOPUP_DESK de d001 (aa03 suspendu, aa04 révoqué) ; aa21 CATALOG_POS ;
-- aa22 TOPUP_DESK de d002 (DRAFT) ; aa23 de d003 (CLOSED) ; aa24 de d004 (LOCKED) ; aa25 de d005
-- (CLOSING) ; aa26 sans événement. B : ab01 TOPUP_DESK de d011.
INSERT INTO device (id, operator_id, kind, app_mode, event_id, serial)
SELECT pg_temp.id('36aa' || lpad(n::text, 2, '0')), pg_temp.id('36a001'), 'TOPUP', 'TOPUP_DESK',
       pg_temp.id('36d001'), 'C36-AA' || lpad(n::text, 2, '0')
  FROM generate_series(1, 20) n;
INSERT INTO device (id, operator_id, kind, app_mode, event_id, serial) VALUES
 (pg_temp.id('36aa21'), pg_temp.id('36a001'), 'POS', 'CATALOG_POS', pg_temp.id('36d001'), 'C36-AA21'),
 (pg_temp.id('36aa22'), pg_temp.id('36a001'), 'TOPUP', 'TOPUP_DESK', pg_temp.id('36d002'), 'C36-AA22'),
 (pg_temp.id('36aa23'), pg_temp.id('36a001'), 'TOPUP', 'TOPUP_DESK', pg_temp.id('36d003'), 'C36-AA23'),
 (pg_temp.id('36aa24'), pg_temp.id('36a001'), 'TOPUP', 'TOPUP_DESK', pg_temp.id('36d004'), 'C36-AA24'),
 (pg_temp.id('36aa25'), pg_temp.id('36a001'), 'TOPUP', 'TOPUP_DESK', pg_temp.id('36d005'), 'C36-AA25'),
 (pg_temp.id('36aa26'), pg_temp.id('36a001'), 'TOPUP', 'TOPUP_DESK', NULL, 'C36-AA26'),
 (pg_temp.id('36ab01'), pg_temp.id('36a002'), 'TOPUP', 'TOPUP_DESK', pg_temp.id('36d011'), 'C36-AB01');
UPDATE device SET status = 'SUSPENDED' WHERE id = pg_temp.id('36aa03');
UPDATE device SET status = 'REVOKED' WHERE id = pg_temp.id('36aa04');

-- Portefeuille, bracelet à caution payée à part (3000), bracelet d'un autre portefeuille.
INSERT INTO wallet (id, operator_id, ledger_id) VALUES
 (pg_temp.id('36f001'), pg_temp.id('36a001'), pg_temp.lg('36d001')),
 (pg_temp.id('36f002'), pg_temp.id('36a001'), pg_temp.lg('36d003'));
INSERT INTO account (operator_id, ledger_id, code, family, purpose, wallet_id, normal_side)
VALUES (pg_temp.id('36a001'), pg_temp.lg('36d001'), 'L-WAL-36-P', 'CLAIM', 'WALLET_PAID',
        pg_temp.id('36f001'), 'C');
INSERT INTO tag_key (operator_id, key_index, kms_key_ref, status)
VALUES (pg_temp.id('36a001'), 1, 'test:hmac-36', 'ACTIVE');
INSERT INTO media_batch (id, operator_id, organizer_id, kind, quantity, key_index, deposit_amount,
                         deposit_mode)
VALUES (pg_temp.id('36f901'), pg_temp.id('36a001'), pg_temp.id('36b001'), 'PUBLIC', 5, 1, 3000,
        'SEPARATE');
INSERT INTO media (id, operator_id, kind, token_hash, nfc_uid, batch_id, key_index, wallet_id) VALUES
 (pg_temp.id('36f101'), pg_temp.id('36a001'), 'NFC_TAG', sha256('m36-1'), '\x04360000000001',
  pg_temp.id('36f901'), 1, pg_temp.id('36f001')),
 (pg_temp.id('36f102'), pg_temp.id('36a001'), 'NFC_TAG', sha256('m36-2'), '\x04360000000002',
  pg_temp.id('36f901'), 1, pg_temp.id('36f002'));
-- (le rattachement des bracelets à leur portefeuille est posé par le schéma à l'insertion)

-- Aides --------------------------------------------------------------------------------------------
CREATE FUNCTION pg_temp.dev(n text) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT pg_temp.id('36aa' || n) $$;
CREATE FUNCTION pg_temp.caisse(n text) RETURNS uuid LANGUAGE sql AS
  $$ SELECT pg_temp.acc(pg_temp.lg('36d001'), 'A-CAISSE-C36-AA' || n) $$;
CREATE FUNCTION pg_temp.sess(n text) RETURNS uuid LANGUAGE sql AS
  $$ SELECT cash_session_id FROM cash_session WHERE device_id = pg_temp.dev(n)
     ORDER BY opened_at DESC LIMIT 1 $$;
CREATE FUNCTION pg_temp.st(n text) RETURNS text LANGUAGE sql AS
  $$ SELECT status FROM cash_session WHERE cash_session_id = pg_temp.sess(n) $$;
CREATE FUNCTION pg_temp.bal(n text) RETURNS bigint LANGUAGE sql AS
  $$ SELECT coalesce((SELECT balance FROM account_balance WHERE account_id = pg_temp.caisse(n)), 0) $$;
-- Ouverture par e001 (CASHIER).
CREATE FUNCTION pg_temp.open(n text) RETURNS uuid LANGUAGE sql AS
  $$ SELECT cash_session_id FROM open_cash_session(pg_temp.dev(n), pg_temp.id('36e001')) $$;
-- Recharge espèces sur la caisse n (propriétaire, comme le moteur) : la clé est unique par appel.
CREATE FUNCTION pg_temp.topup(n text, p_amount bigint, p_key text,
                              p_device uuid DEFAULT NULL) RETURNS uuid LANGUAGE sql AS $$
  SELECT post_transaction(pg_temp.lg('36d001'), 'TOPUP_CASH', p_key, clock_timestamp(), 'ONLINE',
    jsonb_build_array(
      jsonb_build_object('account_id', pg_temp.caisse(n), 'amount', p_amount),
      jsonb_build_object('account_id', pg_temp.acc(pg_temp.lg('36d001'), 'L-WAL-36-P'),
                         'amount', -p_amount)),
    NULL, NULL, NULL, NULL, NULL, p_device) $$;
-- Écriture CASH_CLOSE (comme le moteur) : caisse -théorique, transit +compté, écart sur les pertes
-- de l'organisateur.
CREATE FUNCTION pg_temp.close_tx(n text, p_session uuid, p_expected bigint, p_counted bigint,
                                 p_key text DEFAULT NULL, p_type text DEFAULT 'CASH_CLOSE')
RETURNS uuid LANGUAGE sql AS $$
  SELECT post_transaction(pg_temp.lg('36d001'), p_type,
    coalesce(p_key, 'cash-close:' || p_session), clock_timestamp(), 'ONLINE',
    (SELECT jsonb_agg(l) FROM (
       SELECT jsonb_build_object('account_id', pg_temp.caisse(n), 'amount', -p_expected) AS l
        WHERE p_expected <> 0
       UNION ALL
       SELECT jsonb_build_object('account_id', pg_temp.acc(pg_temp.lg('36d001'), 'A-TRANSIT'),
                                 'amount', p_counted) WHERE p_counted <> 0
       UNION ALL
       SELECT jsonb_build_object('account_id', pg_temp.acc(pg_temp.lg('36d001'), 'L-ORG-PERTES'),
                                 'amount', p_expected - p_counted) WHERE p_expected <> p_counted
     ) x)) $$;
-- Scénario complet de fermeture : ouverture, recharge, comptage, begin, écriture, finish.
-- Rend l'identifiant de l'anomalie (NULL sans écart).
CREATE FUNCTION pg_temp.scenario(n text, p_topup bigint, p_counted bigint) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE s uuid; tx uuid;
BEGIN
  s := pg_temp.open(n);
  IF p_topup > 0 THEN PERFORM pg_temp.topup(n, p_topup, 'S36-' || n || ':1', pg_temp.dev(n)); END IF;
  PERFORM count_cash_session(s, p_counted, pg_temp.id('36e001'), pg_temp.dev(n));
  PERFORM begin_cash_close(s, pg_temp.id('36e002'));
  IF p_topup <> 0 OR p_counted <> 0 THEN tx := pg_temp.close_tx(n, s, p_topup, p_counted); END IF;
  RETURN finish_cash_close(s, pg_temp.id('36e002'), tx);
END $$;
SELECT pg_temp.a();

-- 1. Structure ----------------------------------------------------------------------------------
SELECT has_table('cash_desk');
SELECT has_table('cash_session');
SELECT has_table('cash_session_count');
SELECT has_table('cash_session_tx');
SELECT is((SELECT count(*)::int FROM pg_class
            WHERE relname IN ('cash_desk','cash_session','cash_session_count','cash_session_tx')
              AND relrowsecurity AND relforcerowsecurity), 4, 'RLS activée et forcée sur les quatre tables');
SELECT is((SELECT count(*)::int FROM pg_indexes
            WHERE indexname IN ('cash_session_open_per_account','cash_session_open_per_device')
              AND indexdef LIKE 'CREATE UNIQUE%' AND indexdef LIKE '%OPEN%CLOSING%'), 2,
          'deux index uniques partiels (une session OPEN/CLOSING par caisse et par terminal)');
SELECT is((SELECT count(*)::int FROM information_schema.columns
            WHERE table_name = 'cash_session'
              AND column_name ~ '(balance|solde|current)'), 0,
          'cash_session : aucune colonne de solde courant (A27)');
SELECT is((SELECT count(*)::int FROM pg_views WHERE viewname ~ 'cash_'), 0, 'aucune vue de caisse');
SELECT is((SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname IN ('cash_actor_allowed','cash_session_usable',
              'cash_session_attach_own','open_cash_session','count_cash_session',
              'begin_cash_close','finish_cash_close','attach_cash_tx','open_cash_due_anomaly',
              'take_deposit_for_session','refund_deposit_for_session',
              'refund_cash_due_for_session','posting_cash_desk_guard','account_purpose_guard')
              AND NOT (has_function_privilege('public', p.oid, 'EXECUTE'))), 14,
          'EXECUTE retiré à PUBLIC sur les 14 fonctions');
SELECT is((SELECT count(*)::int FROM pg_proc p
            WHERE p.proname IN ('cash_actor_allowed','cash_session_usable','cash_session_attach_own',
              'open_cash_session','count_cash_session','begin_cash_close','finish_cash_close',
              'attach_cash_tx','open_cash_due_anomaly','take_deposit_for_session',
              'refund_deposit_for_session','refund_cash_due_for_session','posting_cash_desk_guard')
              AND p.prosecdef
              AND coalesce(p.proconfig, '{}') @> ARRAY['search_path=public, pg_temp']), 13,
          'les 13 fonctions SECURITY DEFINER fixent search_path = public, pg_temp');
SELECT ok((SELECT NOT prosecdef FROM pg_proc WHERE proname = 'account_purpose_guard'),
          'account_purpose_guard est SECURITY INVOKER');
SELECT is((SELECT count(*)::int FROM pg_trigger
            WHERE tgname IN ('posting_cash_desk_guard','account_purpose_guard') AND NOT tgisinternal),
          2, 'les deux déclencheurs existent');

-- 2. Ouverture ------------------------------------------------------------------------------------
SELECT is((SELECT count(*)::int FROM account WHERE purpose = 'CASH_DESK'), 0,
          'open_event_ledger (propriétaire) ne crée aucun compte CASH_DESK');
SELECT is((SELECT count(*)::int FROM journal_transaction), 0, 'aucune transaction au départ');
SELECT lives_ok($$SELECT pg_temp.open('01')$$, 'ouverture nominale (CASHIER)');
SELECT is((SELECT count(*)::int FROM account WHERE code = 'A-CAISSE-C36-AA01' AND purpose = 'CASH_DESK'
             AND family = 'ASSET' AND normal_side = 'D' AND NOT allow_negative AND NOT hot
             AND owner_party_id = (SELECT funds_holder_id FROM ledger WHERE id = pg_temp.lg('36d001'))),
          1, 'compte A-CAISSE-<série> créé (ASSET, CASH_DESK, titulaire = détenteur des fonds)');
SELECT is((SELECT count(*)::int FROM cash_desk WHERE account_id = pg_temp.caisse('01')
             AND device_id = pg_temp.dev('01')), 1, 'cash_desk rempli');
SELECT is(pg_temp.st('01'), 'OPEN', 'session OPEN');
SELECT is((SELECT count(*)::int FROM journal_transaction), 0, 'ouverture : zéro journal_transaction');
SELECT is((SELECT count(*)::int FROM cash_session WHERE device_id = pg_temp.dev('01')
             AND counted_amount IS NULL AND expected_amount IS NULL), 1,
          'ni théorique ni compté à l''ouverture');
SELECT throws_ok($$SELECT pg_temp.open('01')$$, 'CL029', NULL, 'seconde ouverture du même terminal refusée');
SELECT throws_ok($$INSERT INTO cash_session (operator_id, ledger_id, event_id, device_id,
    cash_account_id, opened_by) VALUES (pg_temp.id('36a001'), pg_temp.lg('36d001'),
    pg_temp.id('36d001'), pg_temp.dev('02'), pg_temp.caisse('01'), pg_temp.id('36e001'))$$,
  '23505', NULL, 'deux sessions OPEN sur une même caisse : index unique');
SELECT throws_ok($$INSERT INTO cash_session (operator_id, ledger_id, event_id, device_id,
    cash_account_id, opened_by) VALUES (pg_temp.id('36a001'), pg_temp.lg('36d001'),
    pg_temp.id('36d001'), pg_temp.dev('01'), pg_temp.caisse('01'), pg_temp.id('36e001'))$$,
  '23505', NULL, 'deux sessions OPEN sur un même terminal : index unique');
SELECT lives_ok($$SELECT cash_session_id FROM open_cash_session(pg_temp.dev('02'), pg_temp.id('36e003'))$$,
  'ouverture par un CASHIER de portée ORGANIZER');
SELECT lives_ok($$SELECT cash_session_id FROM open_cash_session(pg_temp.dev('05'), pg_temp.id('36e002'))$$,
  'ouverture par un SUPERVISOR');
SELECT throws_ok($$SELECT pg_temp.open('03')$$, 'CL030', NULL, 'terminal suspendu refusé');
SELECT throws_ok($$SELECT pg_temp.open('04')$$, '42501', NULL, 'terminal révoqué refusé');
SELECT throws_ok($$SELECT pg_temp.open('21')$$, 'CL027', NULL, 'terminal d''un autre mode refusé');
SELECT throws_ok($$SELECT pg_temp.open('26')$$, 'CL027', NULL, 'terminal sans événement refusé');
SELECT throws_ok($$SELECT pg_temp.open('22')$$, 'CL029', NULL, 'événement DRAFT refusé');
SELECT throws_ok($$SELECT pg_temp.open('23')$$, 'CL029', NULL, 'événement CLOSED refusé');
SELECT throws_ok($$SELECT pg_temp.open('24')$$, 'CL029', NULL, 'grand livre LOCKED refusé');
SELECT lives_ok($$SELECT cash_session_id FROM open_cash_session(pg_temp.dev('25'), pg_temp.id('36e003'))$$, 'événement CLOSING : ouverture permise');
SELECT throws_ok($$SELECT cash_session_id FROM open_cash_session(pg_temp.dev('06'), pg_temp.id('36e005'))$$,
  'P0002', NULL, 'personne sans rôle refusée');
SELECT throws_ok($$SELECT cash_session_id FROM open_cash_session(pg_temp.dev('06'), pg_temp.id('36e006'))$$,
  'P0002', NULL, 'personne d''un autre événement refusée');
SELECT throws_ok($$SELECT cash_session_id FROM open_cash_session(pg_temp.dev('06'), pg_temp.id('36e007'))$$,
  'P0002', NULL, 'attribution révoquée refusée');
SELECT throws_ok($$SELECT cash_session_id FROM open_cash_session(pg_temp.dev('06'), pg_temp.id('36e011'))$$,
  'P0002', NULL, 'personne d''un autre prestataire refusée');
SELECT throws_ok($$SELECT cash_session_id FROM open_cash_session(pg_temp.dev('06'), NULL)$$,
  'P0002', NULL, 'auteur absent refusé');
SELECT is((SELECT count(*)::int FROM cash_session WHERE device_id = pg_temp.dev('06')), 0,
          'aucun refus ne laisse de session');
-- Compte posé à la main avant la première session : soumis à la garde dès l'ouverture.
INSERT INTO account (operator_id, ledger_id, code, family, purpose, owner_party_id, normal_side)
SELECT pg_temp.id('36a001'), pg_temp.lg('36d001'), 'A-CAISSE-C36-AA07', 'ASSET', 'CASH_DESK',
       funds_holder_id, 'D' FROM ledger WHERE id = pg_temp.lg('36d001');
SELECT lives_ok($$SELECT pg_temp.topup('07', 100, 'H36-1')$$,
  'caisse posée à la main, non inscrite : écriture libre (suites de référence inchangées)');
SELECT lives_ok($$SELECT pg_temp.open('07')$$, 'ouverture sur un compte posé à la main');
SELECT is((SELECT count(*)::int FROM cash_desk WHERE account_id = pg_temp.caisse('07')), 1,
          'le compte posé à la main est désormais inscrit');
SELECT is(pg_temp.bal('07'), 100::bigint, 'son solde antérieur est conservé');
-- Compte inscrit pour un autre terminal.
INSERT INTO account (operator_id, ledger_id, code, family, purpose, owner_party_id, normal_side)
SELECT pg_temp.id('36a001'), pg_temp.lg('36d001'), 'A-CAISSE-C36-AA08', 'ASSET', 'CASH_DESK',
       funds_holder_id, 'D' FROM ledger WHERE id = pg_temp.lg('36d001');
INSERT INTO cash_desk (account_id, operator_id, device_id, ledger_id)
VALUES (pg_temp.caisse('08'), pg_temp.id('36a001'), pg_temp.dev('21'), pg_temp.lg('36d001'));
SELECT throws_ok($$SELECT pg_temp.open('08')$$, 'CL029', NULL, 'caisse inscrite pour un autre terminal refusée');
-- Compte du même code mais d'un autre type.
INSERT INTO account (operator_id, ledger_id, code, family, purpose, owner_party_id, normal_side)
SELECT pg_temp.id('36a001'), pg_temp.lg('36d001'), 'A-CAISSE-C36-AA10', 'ASSET', 'BANK',
       funds_holder_id, 'D' FROM ledger WHERE id = pg_temp.lg('36d001');
SELECT throws_ok($$SELECT pg_temp.open('10')$$, 'CL029', NULL, 'compte homonyme d''un autre but refusé');

-- 3. Comptage à l'aveugle ----------------------------------------------------------------------------
SELECT is(count_cash_session(pg_temp.sess('01'), 500, pg_temp.id('36e001'), pg_temp.dev('01'), '  note  '),
          1, 'comptage 1 : seul le numéro est rendu');
SELECT is((SELECT note FROM cash_session_count WHERE cash_session_id = pg_temp.sess('01')
             AND count_no = 1), 'note', 'note rangée sans blancs de bord');
SELECT is((SELECT pg_typeof(count_cash_session(pg_temp.sess('01'), 600, pg_temp.id('36e002')))::text),
          'integer', 'retour = un entier seul (ni théorique ni écart)');
SELECT is((SELECT count(*)::int FROM cash_session_count WHERE cash_session_id = pg_temp.sess('01')), 2,
          'deux comptages enregistrés');
SELECT throws_ok($$SELECT count_cash_session(pg_temp.sess('01'), -1, pg_temp.id('36e001'))$$, 'CL001',
  NULL, 'montant négatif refusé');
SELECT throws_ok($$SELECT count_cash_session(pg_temp.sess('01'), 1, pg_temp.id('36e001'),
  pg_temp.dev('02'))$$, 'P0002', NULL, 'comptage depuis un autre terminal refusé');
SELECT throws_ok($$SELECT count_cash_session(pg_temp.sess('01'), 1, pg_temp.id('36e005'))$$, 'P0002',
  NULL, 'comptage par une personne sans rôle refusé');
SELECT throws_ok($$SELECT count_cash_session(pg_temp.sess('01'), 1, pg_temp.id('36e001'), NULL,
  repeat('x', 201))$$, 'CL001', NULL, 'note de plus de 200 caractères refusée');
SELECT lives_ok($$SELECT count_cash_session(pg_temp.sess('01'), 1, pg_temp.id('36e001'))
  FROM generate_series(3, 10)$$, 'comptages 3 à 10');
SELECT throws_ok($$SELECT count_cash_session(pg_temp.sess('01'), 1, pg_temp.id('36e001'))$$, 'CL029',
  NULL, '11e comptage refusé');
SELECT throws_ok($$INSERT INTO cash_session_count (cash_session_id, count_no, counted_amount,
    counted_by, operator_id) VALUES (pg_temp.sess('01'), 11, 1, pg_temp.id('36e001'),
    pg_temp.id('36a001'))$$, '23514', NULL, 'CHECK : 11e comptage refusé aussi à l''insertion directe');
SELECT throws_ok($$SELECT count_cash_session(gen_random_uuid(), 1, pg_temp.id('36e001'))$$, 'P0002',
  NULL, 'session inconnue : P0002');

-- 4. Fermeture : sept scénarios --------------------------------------------------------------------------
-- Manque : théorique 10000, compté 9000.
SELECT lives_ok($$SELECT pg_temp.scenario('11', 10000, 9000)$$, 'manque : fermeture');
SELECT is(pg_temp.st('11'), 'CLOSED', 'manque : session CLOSED');
SELECT is((SELECT expected_amount || '/' || counted_amount FROM cash_session
            WHERE cash_session_id = pg_temp.sess('11')), '10000/9000', 'manque : théorique/compté figés');
SELECT is((SELECT amount || ':' || kind || ':' || status FROM anomaly
            WHERE id = (SELECT cash_diff_anomaly_id FROM cash_session WHERE cash_session_id = pg_temp.sess('11'))),
          '1000:CASH_DIFF:OPEN', 'manque : anomalie CASH_DIFF de 1000');
SELECT is((SELECT string_agg(a.purpose || '=' || p.amount, ',' ORDER BY a.purpose) FROM posting p
             JOIN account a ON a.id = p.account_id
            WHERE p.transaction_id = (SELECT close_tx_id FROM cash_session
                                       WHERE cash_session_id = pg_temp.sess('11'))),
          'CASH_DESK=-10000,CASH_TRANSIT=9000,ORG_PERTES=1000', 'manque : écriture attendue');
SELECT is(pg_temp.bal('11'), 0::bigint, 'manque : caisse à zéro');
-- Surplus : 5000 théorique, 6000 compté.
SELECT lives_ok($$SELECT pg_temp.scenario('12', 5000, 6000)$$, 'surplus : fermeture');
SELECT is((SELECT amount FROM anomaly WHERE id = (SELECT cash_diff_anomaly_id FROM cash_session
            WHERE cash_session_id = pg_temp.sess('12'))), 1000::bigint, 'surplus : anomalie de 1000');
SELECT is((SELECT string_agg(a.purpose || '=' || p.amount, ',' ORDER BY a.purpose) FROM posting p
             JOIN account a ON a.id = p.account_id
            WHERE p.transaction_id = (SELECT close_tx_id FROM cash_session
                                       WHERE cash_session_id = pg_temp.sess('12'))),
          'CASH_DESK=-5000,CASH_TRANSIT=6000,ORG_PERTES=-1000', 'surplus : écriture attendue');
SELECT is(pg_temp.bal('12'), 0::bigint, 'surplus : caisse à zéro');
-- Égalité.
SELECT is(pg_temp.scenario('13', 4000, 4000), NULL, 'égalité : pas d''anomalie');
SELECT is((SELECT (cash_diff_anomaly_id IS NULL) || ':' || (close_tx_id IS NOT NULL) || ':' || status
             FROM cash_session WHERE cash_session_id = pg_temp.sess('13')), 'true:true:CLOSED',
          'égalité : écriture de fermeture, aucune anomalie');
SELECT is((SELECT count(*)::int FROM posting WHERE transaction_id =
            (SELECT close_tx_id FROM cash_session WHERE cash_session_id = pg_temp.sess('13'))), 2,
          'égalité : deux lignes seulement');
-- Théorique nul, compté positif : surplus seul.
SELECT lives_ok($$SELECT pg_temp.scenario('14', 0, 700)$$, 'théorique nul, compté 700');
SELECT is((SELECT amount FROM anomaly WHERE id = (SELECT cash_diff_anomaly_id FROM cash_session
            WHERE cash_session_id = pg_temp.sess('14'))), 700::bigint, 'surplus seul : anomalie de 700');
SELECT is((SELECT string_agg(a.purpose || '=' || p.amount, ',' ORDER BY a.purpose) FROM posting p
             JOIN account a ON a.id = p.account_id
            WHERE p.transaction_id = (SELECT close_tx_id FROM cash_session
                                       WHERE cash_session_id = pg_temp.sess('14'))),
          'CASH_TRANSIT=700,ORG_PERTES=-700', 'surplus seul : aucune ligne sur la caisse');
-- Compté nul, théorique positif : tout en manque.
SELECT lives_ok($$SELECT pg_temp.scenario('15', 800, 0)$$, 'compté nul, théorique 800');
SELECT is((SELECT amount FROM anomaly WHERE id = (SELECT cash_diff_anomaly_id FROM cash_session
            WHERE cash_session_id = pg_temp.sess('15'))), 800::bigint, 'tout en manque : anomalie de 800');
SELECT is((SELECT string_agg(a.purpose || '=' || p.amount, ',' ORDER BY a.purpose) FROM posting p
             JOIN account a ON a.id = p.account_id
            WHERE p.transaction_id = (SELECT close_tx_id FROM cash_session
                                       WHERE cash_session_id = pg_temp.sess('15'))),
          'CASH_DESK=-800,ORG_PERTES=800', 'tout en manque : aucune ligne au transit');
-- Nul / nul : aucune écriture.
SELECT is(pg_temp.scenario('16', 0, 0), NULL, 'nul/nul : pas d''anomalie');
SELECT is((SELECT status || ':' || (close_tx_id IS NULL) || ':' || (closed_at IS NOT NULL)
             FROM cash_session WHERE cash_session_id = pg_temp.sess('16')), 'CLOSED:true:true',
          'nul/nul : session CLOSED sans écriture');
-- Rejeux et ordres.
SELECT throws_ok($$SELECT finish_cash_close(pg_temp.sess('11'), pg_temp.id('36e002'), NULL)$$, 'CL029',
  NULL, 'seconde fermeture d''une session CLOSED refusée');
SELECT throws_ok($$SELECT begin_cash_close(pg_temp.sess('11'), pg_temp.id('36e002'))$$, 'CL029', NULL,
  'begin sur une session CLOSED refusé');
-- CL041, sans comptage, finish sans begin (terminaux 17 à 20).
SELECT pg_temp.open('17');
SELECT throws_ok($$SELECT begin_cash_close(pg_temp.sess('17'), pg_temp.id('36e002'))$$, 'CL029', NULL,
  'fermeture sans comptage : CL029');
SELECT count_cash_session(pg_temp.sess('17'), 100, pg_temp.id('36e002'));
SELECT throws_ok($$SELECT begin_cash_close(pg_temp.sess('17'), pg_temp.id('36e002'))$$, 'CL041', NULL,
  'fermeur auteur d''un comptage : CL041');
SELECT throws_ok($$SELECT begin_cash_close(pg_temp.sess('17'), pg_temp.id('36e001'))$$, 'P0002', NULL,
  'fermeur CASHIER (non SUPERVISOR) : P0002');
SELECT throws_ok($$SELECT begin_cash_close(pg_temp.sess('17'), pg_temp.id('36e006'))$$, 'P0002', NULL,
  'fermeur SUPERVISOR d''un autre événement : P0002');
SELECT is(pg_temp.st('17'), 'OPEN', 'les refus laissent la session OPEN');
SELECT throws_ok($$SELECT finish_cash_close(pg_temp.sess('17'), pg_temp.id('36e004'), NULL)$$, 'CL029',
  NULL, 'finish sans begin : CL029');
SELECT lives_ok($$SELECT * FROM begin_cash_close(pg_temp.sess('17'), pg_temp.id('36e004'))$$,
  'un autre SUPERVISOR ferme');
SELECT is(pg_temp.st('17'), 'CLOSING', 'état CLOSING après begin');
SELECT throws_ok($$SELECT finish_cash_close(pg_temp.sess('17'), pg_temp.id('36e002'), NULL)$$, 'CL029',
  NULL, 'finish par un autre fermeur que celui du begin : CL029');
SELECT throws_ok($$SELECT count_cash_session(pg_temp.sess('17'), 1, pg_temp.id('36e001'))$$, 'CL029',
  NULL, 'comptage sur une session CLOSING refusé');
SELECT throws_ok($$SELECT finish_cash_close(pg_temp.sess('17'), pg_temp.id('36e004'),
  gen_random_uuid())$$, 'CL001', NULL, 'transaction de fermeture inconnue : CL001');
SELECT throws_ok($$SELECT finish_cash_close(pg_temp.sess('17'), pg_temp.id('36e004'), NULL)$$, 'CL001',
  NULL, 'compté positif sans transaction CASH_CLOSE : CL001');
SELECT is(pg_temp.st('17'), 'CLOSING', 'les refus de finish laissent la session CLOSING');

-- Transactions de fermeture fausses (sessions 18 à 20), sans rien modifier.
SELECT pg_temp.open('18'); SELECT pg_temp.topup('18', 1000, 'F36-18:1', pg_temp.dev('18'));
SELECT count_cash_session(pg_temp.sess('18'), 900, pg_temp.id('36e001'));
SELECT * FROM begin_cash_close(pg_temp.sess('18'), pg_temp.id('36e002'));
-- Autre clé : posée sans toucher la caisse (la garde ne la voit pas), refusée par finish.
SELECT post_transaction(pg_temp.lg('36d001'), 'CASH_CLOSE', 'cash-close:autre', clock_timestamp(),
  'ONLINE', jsonb_build_array(
    jsonb_build_object('account_id', pg_temp.acc(pg_temp.lg('36d001'), 'A-TRANSIT'), 'amount', 900),
    jsonb_build_object('account_id', pg_temp.acc(pg_temp.lg('36d001'), 'L-ORG-PERTES'), 'amount', -900)));
SELECT throws_ok($$SELECT finish_cash_close(pg_temp.sess('18'), pg_temp.id('36e002'),
  (SELECT id FROM journal_transaction WHERE idempotency_key = 'cash-close:autre'))$$, 'CL001', NULL,
  'CASH_CLOSE d''une autre clé : CL001');
-- Montant faux (compté 1000 au lieu de 900) avec la bonne clé.
SELECT pg_temp.close_tx('18', pg_temp.sess('18'), 1000, 1000);
SELECT throws_ok($$SELECT finish_cash_close(pg_temp.sess('18'), pg_temp.id('36e002'),
  (SELECT id FROM journal_transaction WHERE idempotency_key = 'cash-close:' || pg_temp.sess('18')))$$,
  'CL001', NULL, 'CASH_CLOSE au mauvais montant compté : CL001');
SELECT is(pg_temp.st('18'), 'CLOSING', 'transactions fausses : la session reste CLOSING');
-- Autre type avec la bonne clé : refusé par la garde (CLOSING) quand il touche la caisse.
SELECT pg_temp.open('19'); SELECT pg_temp.topup('19', 500, 'F36-19:1', pg_temp.dev('19'));
SELECT count_cash_session(pg_temp.sess('19'), 500, pg_temp.id('36e001'));
SELECT * FROM begin_cash_close(pg_temp.sess('19'), pg_temp.id('36e002'));
SELECT throws_ok($$SELECT pg_temp.close_tx('19', pg_temp.sess('19'), 500, 500, NULL, 'CASH_DEPOSIT')$$,
  'CL029', NULL, 'CLOSING : une transaction d''un autre type que CASH_CLOSE est refusée par la garde');
-- Écriture de fermeture qui laisse un reste sur la caisse : CL001.
SELECT post_transaction(pg_temp.lg('36d001'), 'CASH_CLOSE', 'cash-close:' || pg_temp.sess('19'),
  clock_timestamp(), 'ONLINE', jsonb_build_array(
    jsonb_build_object('account_id', pg_temp.caisse('19'), 'amount', -200),
    jsonb_build_object('account_id', pg_temp.acc(pg_temp.lg('36d001'), 'A-TRANSIT'), 'amount', 200)));
SELECT throws_ok($$SELECT finish_cash_close(pg_temp.sess('19'), pg_temp.id('36e002'),
  (SELECT id FROM journal_transaction WHERE idempotency_key = 'cash-close:' || pg_temp.sess('19')))$$,
  'CL001', NULL, 'CASH_CLOSE qui laisse un solde sur la caisse : CL001');

-- 5. Garde de caisse ---------------------------------------------------------------------------------
-- Session 20 OPEN sur le terminal 20 ; caisse 11 (session CLOSED) ; caisse 17 en CLOSING.
SELECT pg_temp.open('20');
SELECT lives_ok($$SELECT pg_temp.topup('20', 300, 'G36-1', pg_temp.dev('20'))$$,
  'garde : session OPEN du même terminal acceptée');
SELECT lives_ok($$SELECT pg_temp.topup('20', 50, 'G36-2')$$,
  'garde : transaction sans terminal acceptée sur session OPEN');
SELECT throws_ok($$SELECT pg_temp.topup('20', 300, 'G36-3', pg_temp.dev('02'))$$, 'CL029', NULL,
  'garde : session OPEN d''un autre terminal refusée (A8)');
SELECT throws_ok($$SELECT pg_temp.topup('11', 300, 'G36-4', pg_temp.dev('11'))$$, 'CL029', NULL,
  'garde : caisse sans session ouverte (session CLOSED) refusée');
SELECT throws_ok($$SELECT pg_temp.topup('11', 300, 'G36-5', pg_temp.dev('20'))$$, 'CL029', NULL,
  'garde : session d''une AUTRE caisse ne couvre pas cette caisse');
SELECT throws_ok($$SELECT pg_temp.topup('17', 300, 'G36-6', pg_temp.dev('17'))$$, 'CL029', NULL,
  'garde : caisse CLOSING, recharge refusée');
SELECT throws_ok($$SELECT pg_temp.close_tx('20', pg_temp.sess('20'), 350, 350)$$, 'CL029', NULL,
  'garde : CASH_CLOSE sur une session OPEN refusée (renforcement)');
SELECT is(pg_temp.bal('20'), 350::bigint, 'garde : solde de la caisse inchangé par les refus');
-- Variable de session forgée : n'ouvre rien (A7).
SELECT set_config('app.cash_closing', 'true', true);
SELECT set_config('app.cash_session', pg_temp.sess('11')::text, true);
SELECT throws_ok($$SELECT pg_temp.topup('11', 300, 'G36-7')$$, 'CL029', NULL,
  'garde : app.cash_closing forgé n''ouvre rien (A7)');
SELECT throws_ok($$SELECT pg_temp.close_tx('11', pg_temp.sess('11'), 300, 300, 'cash-close:forge')$$,
  'CL029', NULL, 'garde : CASH_CLOSE forgé sur une caisse fermée refusé');
-- Moteur et fonctions du schéma de référence : la garde s'applique aussi au propriétaire.
SELECT throws_ok($$SELECT take_deposit(pg_temp.id('36f101'), pg_temp.caisse('11'))$$, 'CL029', NULL,
  'garde : take_deposit direct sur une caisse sans session refusé');
SELECT is((SELECT deposit_status FROM media WHERE id = pg_temp.id('36f101')), 'NONE',
          'garde : le bracelet n''a pas changé d''état');
-- Une caisse inscrite puis désactivée reste gardée.
UPDATE account SET is_active = false WHERE id = pg_temp.caisse('11');
SELECT throws_ok($$SELECT pg_temp.topup('11', 1, 'G36-8')$$, NULL, NULL,
  'garde : compte inscrit désactivé, toujours refusé');
UPDATE account SET is_active = true WHERE id = pg_temp.caisse('11');
-- Séquence « fermeture pendant une recharge » sur la caisse 09.
SELECT pg_temp.open('09');
SELECT pg_temp.topup('09', 1000, 'Q36-1', pg_temp.dev('09'));
SELECT count_cash_session(pg_temp.sess('09'), 1000, pg_temp.id('36e001'));
SELECT is((SELECT expected_amount FROM begin_cash_close(pg_temp.sess('09'), pg_temp.id('36e002'))),
          1000::bigint, 'séquence : la recharge validée avant begin est comptée dans le théorique');
SELECT throws_ok($$SELECT pg_temp.topup('09', 500, 'Q36-2', pg_temp.dev('09'))$$, 'CL029', NULL,
  'séquence : recharge après begin_cash_close refusée');
SELECT is(pg_temp.bal('09'), 1000::bigint, 'séquence : solde intact après le refus');
SELECT lives_ok($$SELECT finish_cash_close(pg_temp.sess('09'), pg_temp.id('36e002'),
  pg_temp.close_tx('09', pg_temp.sess('09'), 1000, 1000))$$, 'séquence : fermeture');
SELECT throws_ok($$SELECT pg_temp.topup('09', 500, 'Q36-3', pg_temp.dev('09'))$$, 'CL029', NULL,
  'séquence : recharge après la fermeture refusée');
SELECT is(pg_temp.bal('09'), 0::bigint, 'séquence : caisse à zéro après la fermeture');

-- 6. Rattachement ----------------------------------------------------------------------------------------
SELECT lives_ok($$SELECT attach_cash_tx(pg_temp.sess('20'),
  pg_temp.topup('20', 40, 'R36-1', pg_temp.dev('20')))$$, 'attach_cash_tx nominal');
SELECT lives_ok($$SELECT attach_cash_tx(pg_temp.sess('20'),
  (SELECT id FROM journal_transaction WHERE idempotency_key = 'R36-1'))$$, 'rattachement idempotent');
SELECT is((SELECT count(*)::int FROM cash_session_tx WHERE tx_id =
  (SELECT id FROM journal_transaction WHERE idempotency_key = 'R36-1')), 1, 'une seule ligne de rattachement');
SELECT throws_ok($$SELECT attach_cash_tx(pg_temp.sess('20'),
  (SELECT id FROM journal_transaction WHERE idempotency_key = 'S36-11:1'))$$, 'CL001', NULL,
  'transaction sans ligne sur la caisse de la session : CL001');
SELECT throws_ok($$SELECT attach_cash_tx(pg_temp.sess('11'),
  (SELECT id FROM journal_transaction WHERE idempotency_key = 'R36-1'))$$, 'CL029', NULL,
  'session non ouverte : CL029');
SELECT throws_ok($$SELECT attach_cash_tx(pg_temp.sess('20'), gen_random_uuid())$$, 'CL001', NULL,
  'transaction inconnue : CL001');
SELECT throws_ok($$SELECT attach_cash_tx(pg_temp.sess('20'),
  (SELECT id FROM journal_transaction WHERE idempotency_key = 'S36-11:1'))$$, 'CL001', NULL,
  'transaction d''une autre caisse : CL001');

-- 7. Variantes et anomalie d'espèces dues -------------------------------------------------------------------
-- Session 06 pour les variantes (terminal 06, caisse A-CAISSE-C36-AA06).
SELECT pg_temp.open('06');
SELECT is(take_deposit_for_session(pg_temp.id('36f101'), pg_temp.sess('06')), 'HELD',
          'caution prise sur la caisse de la session');
SELECT is((SELECT count(*)::int FROM posting WHERE account_id = pg_temp.caisse('06') AND amount = 3000), 1,
          'la caution est écrite sur la caisse de la session');
SELECT is((SELECT count(*)::int FROM cash_session_tx x JOIN journal_transaction t ON t.id = x.tx_id
            WHERE x.cash_session_id = pg_temp.sess('06') AND t.type = 'DEPOSIT_TAKEN'), 1,
          'la variante rattache elle-même sa transaction');
SELECT lives_ok($$SELECT take_deposit_for_session(pg_temp.id('36f101'), pg_temp.sess('06'))$$,
  'seconde prise : sans effet (HELD), sans conflit de rattachement');
SELECT lives_ok($$SELECT refund_deposit_for_session(pg_temp.id('36f101'), pg_temp.sess('06'))$$,
  'caution rendue sur la caisse de la session');
SELECT is((SELECT count(*)::int FROM cash_session_tx x JOIN journal_transaction t ON t.id = x.tx_id
            WHERE x.cash_session_id = pg_temp.sess('06') AND t.type = 'DEPOSIT_REFUNDED'), 1,
          'rendu de caution rattaché');
-- Espèces dues : recharge découpée (caisse 1000, portefeuille 600, espèces dues 400).
SELECT post_transaction(pg_temp.lg('36d001'), 'TOPUP_CASH', 'D36-1', clock_timestamp(), 'ONLINE',
  jsonb_build_array(
    jsonb_build_object('account_id', pg_temp.caisse('06'), 'amount', 1000),
    jsonb_build_object('account_id', pg_temp.acc(pg_temp.lg('36d001'), 'L-WAL-36-P'), 'amount', -600),
    jsonb_build_object('account_id', pg_temp.acc(pg_temp.lg('36d001'), 'L-ESP-A-RENDRE'), 'amount', -400)),
  NULL, NULL, NULL, NULL, NULL, pg_temp.dev('06'));
SELECT attach_cash_tx(pg_temp.sess('06'), (SELECT id FROM journal_transaction WHERE idempotency_key = 'D36-1'));
SELECT lives_ok($$SELECT open_cash_due_anomaly(pg_temp.lg('36d001'), pg_temp.id('36f101'), 400,
  (SELECT id FROM journal_transaction WHERE idempotency_key = 'D36-1'))$$, 'anomalie d''espèces dues ouverte');
SELECT is(open_cash_due_anomaly(pg_temp.lg('36d001'), pg_temp.id('36f101'), 400,
  (SELECT id FROM journal_transaction WHERE idempotency_key = 'D36-1')),
  (SELECT id FROM anomaly WHERE kind = 'CASH_TOPUP_OVER_LIMIT'), 'second appel : même anomalie');
SELECT is((SELECT count(*)::int FROM anomaly WHERE kind = 'CASH_TOPUP_OVER_LIMIT'), 1, 'sans doublon');
SELECT throws_ok($$SELECT open_cash_due_anomaly(pg_temp.lg('36d001'), pg_temp.id('36f101'), 399,
  (SELECT id FROM journal_transaction WHERE idempotency_key = 'D36-1'))$$, 'CL001', NULL,
  'même transaction, autre montant : CL001');
SELECT throws_ok($$SELECT open_cash_due_anomaly(pg_temp.lg('36d001'), pg_temp.id('36f102'), 400,
  (SELECT id FROM journal_transaction WHERE idempotency_key = 'D36-1'))$$, 'CL001', NULL,
  'bracelet d''un autre portefeuille : CL001');
SELECT throws_ok($$SELECT open_cash_due_anomaly(pg_temp.lg('36d001'), pg_temp.id('36f101'), 0,
  (SELECT id FROM journal_transaction WHERE idempotency_key = 'D36-1'))$$, 'CL001', NULL, 'montant nul : CL001');
SELECT throws_ok($$SELECT open_cash_due_anomaly(pg_temp.lg('36d001'), pg_temp.id('36f101'), 400,
  (SELECT id FROM journal_transaction WHERE idempotency_key = 'cash-close:' || pg_temp.sess('11')))$$,
  'CL001', NULL, 'transaction d''un autre type que TOPUP_CASH : CL001');
SELECT lives_ok($$SELECT refund_cash_due_for_session(pg_temp.id('36f101'), pg_temp.sess('06'), 'RD36-1',
  pg_temp.id('36e001'), pg_temp.id('36e002'), pg_temp.dev('06'))$$, 'espèces dues rendues sur la caisse');
SELECT is((SELECT count(*)::int FROM cash_session_tx x JOIN journal_transaction t ON t.id = x.tx_id
            WHERE x.cash_session_id = pg_temp.sess('06') AND t.idempotency_key = 'RD36-1'), 1,
          'rendu d''espèces dues rattaché');
SELECT is(pg_temp.bal('06'), 600::bigint, 'caisse : 1000 reçus, 400 rendus');
SELECT throws_ok($$SELECT refund_cash_due_for_session(pg_temp.id('36f101'), pg_temp.sess('06'), 'RD36-2',
  pg_temp.id('36e001'), pg_temp.id('36e002'), pg_temp.dev('02'))$$, 'P0002', NULL,
  'terminal d''un autre que la session : P0002');
SELECT throws_ok($$SELECT take_deposit_for_session(pg_temp.id('36f102'), pg_temp.sess('06'))$$, 'CL029', NULL,
  'bracelet d''un autre grand livre : CL029');
SELECT throws_ok($$SELECT take_deposit_for_session(pg_temp.id('36f101'), pg_temp.sess('17'))$$, 'CL029', NULL,
  'session CLOSING : CL029');
SELECT throws_ok($$SELECT refund_deposit_for_session(pg_temp.id('36f101'), pg_temp.sess('11'))$$, 'CL029', NULL,
  'session CLOSED : CL029');
-- Zéro écriture de caisse sans rattachement (R-02), sur le scénario caution / rendu / recharge
-- découpée / espèces dues de la caisse 06.
SELECT is((SELECT count(DISTINCT p.transaction_id) FROM posting p
            WHERE p.account_id = pg_temp.caisse('06')
              AND NOT EXISTS (SELECT 1 FROM cash_session_tx x WHERE x.tx_id = p.transaction_id)),
          0::bigint, 'caisse 06 : aucune écriture sans rattachement');
SELECT is((SELECT count(DISTINCT p.transaction_id) FROM posting p
            WHERE p.account_id = pg_temp.caisse('06')), 4::bigint,
          'caisse 06 : quatre transactions (caution, rendu, recharge, espèces dues)');
SELECT is((SELECT count(DISTINCT p.transaction_id) FROM posting p
            WHERE p.account_id IN (pg_temp.caisse('11'), pg_temp.caisse('12'), pg_temp.caisse('13'),
                                   pg_temp.caisse('09'))
              AND NOT EXISTS (SELECT 1 FROM cash_session_tx x WHERE x.tx_id = p.transaction_id)),
          4::bigint, 'recharges posées par le moteur sans attach_cash_tx : seul l''appelant les rattache (WP09)');

-- 8. Cloisonnement : prestataire B et prestataire absent -----------------------------------------------------
SELECT pg_temp.b();
SELECT throws_ok($$SELECT cash_session_id FROM open_cash_session(pg_temp.dev('12'), pg_temp.id('36e011'))$$, 'P0002', NULL, 'B : open_cash_session sur un terminal de A');
SELECT throws_ok($$SELECT count_cash_session(pg_temp.sess('20'), 1, pg_temp.id('36e011'))$$, 'P0002', NULL, 'B : count_cash_session');
SELECT throws_ok($$SELECT * FROM begin_cash_close(pg_temp.sess('20'), pg_temp.id('36e011'))$$, 'P0002', NULL, 'B : begin_cash_close');
SELECT throws_ok($$SELECT finish_cash_close(pg_temp.sess('17'), pg_temp.id('36e004'), NULL)$$, 'P0002', NULL, 'B : finish_cash_close');
SELECT throws_ok($$SELECT attach_cash_tx(pg_temp.sess('20'), gen_random_uuid())$$, 'P0002', NULL, 'B : attach_cash_tx');
SELECT throws_ok($$SELECT open_cash_due_anomaly(pg_temp.lg('36d001'), pg_temp.id('36f101'), 400, gen_random_uuid())$$, 'P0002', NULL, 'B : open_cash_due_anomaly');
SELECT throws_ok($$SELECT take_deposit_for_session(pg_temp.id('36f101'), pg_temp.sess('06'))$$, 'P0002', NULL, 'B : take_deposit_for_session');
SELECT throws_ok($$SELECT refund_deposit_for_session(pg_temp.id('36f101'), pg_temp.sess('06'))$$, 'P0002', NULL, 'B : refund_deposit_for_session');
SELECT throws_ok($$SELECT refund_cash_due_for_session(pg_temp.id('36f101'), pg_temp.sess('06'), 'X', pg_temp.id('36e011'))$$, 'P0002', NULL, 'B : refund_cash_due_for_session');
SELECT pg_temp.none();
SELECT throws_ok($$SELECT cash_session_id FROM open_cash_session(pg_temp.dev('12'), pg_temp.id('36e001'))$$, 'P0002', NULL, 'sans prestataire : open_cash_session');
SELECT throws_ok($$SELECT count_cash_session(pg_temp.sess('20'), 1, pg_temp.id('36e001'))$$, 'P0002', NULL, 'sans prestataire : count_cash_session');
SELECT throws_ok($$SELECT * FROM begin_cash_close(pg_temp.sess('20'), pg_temp.id('36e002'))$$, 'P0002', NULL, 'sans prestataire : begin_cash_close');
SELECT throws_ok($$SELECT finish_cash_close(pg_temp.sess('17'), pg_temp.id('36e004'), NULL)$$, 'P0002', NULL, 'sans prestataire : finish_cash_close');
SELECT throws_ok($$SELECT attach_cash_tx(pg_temp.sess('20'), gen_random_uuid())$$, 'P0002', NULL, 'sans prestataire : attach_cash_tx');
SELECT throws_ok($$SELECT open_cash_due_anomaly(pg_temp.lg('36d001'), pg_temp.id('36f101'), 400, gen_random_uuid())$$, 'P0002', NULL, 'sans prestataire : open_cash_due_anomaly');
SELECT throws_ok($$SELECT take_deposit_for_session(pg_temp.id('36f101'), pg_temp.sess('06'))$$, 'P0002', NULL, 'sans prestataire : take_deposit_for_session');
SELECT throws_ok($$SELECT refund_deposit_for_session(pg_temp.id('36f101'), pg_temp.sess('06'))$$, 'P0002', NULL, 'sans prestataire : refund_deposit_for_session');
SELECT throws_ok($$SELECT refund_cash_due_for_session(pg_temp.id('36f101'), pg_temp.sess('06'), 'X', pg_temp.id('36e001'))$$, 'P0002', NULL, 'sans prestataire : refund_cash_due_for_session');
SELECT pg_temp.a();

-- 9. account_purpose_guard sous cashless_app ----------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION open_cash_session(uuid, uuid) TO cashless_app;
SET LOCAL ROLE cashless_app;
SELECT throws_ok($$INSERT INTO account (operator_id, ledger_id, code, family, purpose, normal_side)
  VALUES (pg_temp.id('36a001'), pg_temp.lg('36d001'), 'X-CD', 'ASSET', 'CASH_DESK', 'D')$$,
  '42501', NULL, 'cashless_app : INSERT d''un compte CASH_DESK refusé');
SELECT throws_ok($$INSERT INTO account (operator_id, ledger_id, code, family, purpose, normal_side)
  VALUES (pg_temp.id('36a001'), pg_temp.lg('36d001'), 'X-PSP', 'ASSET', 'PSP', 'D')$$,
  '42501', NULL, 'cashless_app : INSERT d''un compte PSP refusé');
SELECT lives_ok($$INSERT INTO account (operator_id, ledger_id, code, family, purpose, normal_side)
  VALUES (pg_temp.id('36a001'), pg_temp.lg('36d001'), 'X-TR', 'ASSET', 'CASH_TRANSIT', 'D')$$,
  'cashless_app : INSERT d''un compte TRANSIT accepté');
SELECT throws_ok($$UPDATE account SET purpose = 'PSP' WHERE code = 'X-TR'
  AND ledger_id = pg_temp.lg('36d001')$$, '42501', NULL, 'cashless_app : UPDATE du but vers PSP refusé');
SELECT throws_ok($$UPDATE account SET purpose = 'CASH_DESK' WHERE code = 'X-TR'
  AND ledger_id = pg_temp.lg('36d001')$$, '42501', NULL, 'cashless_app : UPDATE du but vers CASH_DESK refusé');
SELECT lives_ok($$SELECT open_event_ledger(pg_temp.id('36d006'))$$,
  'cashless_app : open_event_ledger d''un événement de la base réussit');
SELECT is((SELECT count(*)::int FROM account WHERE ledger_id = pg_temp.lg('36d006')
             AND purpose = 'CASH_DESK'), 0, 'open_event_ledger ne crée aucun compte CASH_DESK');
SELECT lives_ok($$SELECT cash_session_id FROM open_cash_session(pg_temp.dev('13'), pg_temp.id('36e001'))$$,
  'cashless_app : open_cash_session (fonction du propriétaire) crée la caisse et réussit');
SELECT is((SELECT count(*)::int FROM account WHERE code = 'A-CAISSE-C36-AA13' AND purpose = 'CASH_DESK'),
          1, 'compte de caisse créé par la fonction');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
