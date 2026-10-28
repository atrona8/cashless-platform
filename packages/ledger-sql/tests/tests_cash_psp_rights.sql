-- Droits de la base des caisses, recharges et PSP (mission recharges-caisses-psp, lot WP05 ;
-- contracts/database-rights.md ; research R-20 A6, A7, A8, A9, A10, A24, A27 ; C-004, NFR-005) —
-- pgTAP, écrit à la main (pas un fichier généré).
-- Lancer : psql -X -tA -f tests/tests_cash_psp_rights.sql (ou pg_prove -d <base> sur une base
-- créée par les migrations, roles.sql et post-roles.sql rejoués).
-- La suite rejoue elle-même roles.sql puis post-roles.sql (ordre de migrate.ts) : roles.sql rend
-- SELECT, INSERT, UPDATE et EXECUTE sur tout à cashless_app, post-roles.sql (section 7) doit les
-- reprendre. Prestataires A et B ; identifiants préfixés 53.
\set ON_ERROR_STOP 1
\set QUIET 1
BEGIN;
SET LOCAL client_min_messages = warning;
\ir ../roles.sql
\ir ../post-roles.sql
RESET client_min_messages;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

CREATE FUNCTION pg_temp.id(p text) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT ('00000000-0000-0000-0000-' || lpad(p, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.a() RETURNS void LANGUAGE sql AS
  $$ SELECT set_config('app.operator_id', pg_temp.id('53a001')::text, true) $$;
CREATE FUNCTION pg_temp.b() RETURNS void LANGUAGE sql AS
  $$ SELECT set_config('app.operator_id', pg_temp.id('53a002')::text, true) $$;
-- Code d'erreur (5 caractères) de l'exécution d'une instruction, ou 'ok'.
CREATE FUNCTION pg_temp.code(p text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE p; RETURN 'ok';
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE; END $$;
-- Identifiant mémorisé par un appel précédent (cashless_app n'a pas de table temporaire).
CREATE FUNCTION pg_temp.g(p text) RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('wp05.' || p, true), '')::uuid $$;
CREATE FUNCTION pg_temp.cols(p_role text, p_table text, p_priv text) RETURNS text[]
LANGUAGE sql STABLE AS $$
  SELECT coalesce(array_agg(attname::text ORDER BY attname::text COLLATE "C"), '{}')
    FROM pg_attribute
   WHERE attrelid = p_table::regclass AND attnum > 0 AND NOT attisdropped
     AND has_column_privilege(p_role, p_table, attname, p_priv)
$$;
-- Les dix tables de la mission.
CREATE FUNCTION pg_temp.tables() RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY['cash_desk', 'cash_session', 'cash_session_count', 'cash_session_tx',
               'psp_configuration', 'event_psp_selection', 'psp_topup', 'psp_event',
               'psp_chargeback', 'psp_webhook_rejection']
$$;
-- Nombre de lignes d'une table pour un prestataire (appelé en propriétaire ou sous sa RLS).
CREATE FUNCTION pg_temp.n(p_table text, p_op uuid) RETURNS int LANGUAGE sql STABLE AS $$
  SELECT (xpath('/row/c/text()', query_to_xml(format(
    'SELECT count(*) AS c FROM %I WHERE operator_id = %L', p_table, p_op), false, true, '')))[1]
    ::text::int
$$;
-- Empreinte des lignes de B dans les dix tables (comparée avant et après les appels de A).
CREATE FUNCTION pg_temp.fp_b() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT string_agg(t || '=' || pg_temp.n(t, pg_temp.id('53a002')), ',' ORDER BY t)
    FROM unnest(pg_temp.tables()) t
$$;

CREATE FUNCTION pg_temp.closed(p_table text) RETURNS int LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  EXECUTE format('SELECT count(*) FROM %I', p_table) INTO n;
  RETURN n;
EXCEPTION WHEN invalid_text_representation THEN RETURN 0;
END $$;

-- Données (propriétaire) ------------------------------------------------------------------------
-- A : organisateurs b001 et b002 ; événements d001 (org. b001, LIVE) et d002 (org. b002, LIVE).
-- B : organisateur b011, événement d011. Personnes : e001 OPERATOR_ADMIN de A, e002 CASHIER d001,
-- e003 SUPERVISOR d001, f102 ORGANIZER_ADMIN de b002 ; e011 OPERATOR_ADMIN de B, e012 CASHIER
-- d011, e013 SUPERVISOR d011, f111 ORGANIZER_ADMIN de b011.
INSERT INTO party (kind, legal_name) SELECT 'PLATFORM', 'Plateforme (test)'
 WHERE NOT EXISTS (SELECT 1 FROM party WHERE kind = 'PLATFORM');
INSERT INTO party (id, kind, legal_name, country_code) VALUES
 (pg_temp.id('53a001'), 'OPERATOR', 'Prestataire A', 'SN'),
 (pg_temp.id('53a002'), 'OPERATOR', 'Prestataire B', 'CI');
INSERT INTO party (id, kind, operator_id, legal_name) VALUES
 (pg_temp.id('53b001'), 'ORGANIZER', pg_temp.id('53a001'), 'Organisateur A1'),
 (pg_temp.id('53b002'), 'ORGANIZER', pg_temp.id('53a001'), 'Organisateur A2'),
 (pg_temp.id('53b011'), 'ORGANIZER', pg_temp.id('53a002'), 'Organisateur B'),
 (pg_temp.id('53c201'), 'CUSTOMER', pg_temp.id('53a001'), 'Festivalier A'),
 (pg_temp.id('53c211'), 'CUSTOMER', pg_temp.id('53a002'), 'Festivalier B');
INSERT INTO jurisdiction_profile (id, country_code, version, valid_from, breakage_destination)
VALUES (pg_temp.id('53c001'), 'SN', 530053, '2026-01-01', 'ORGANIZER');
INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone, jurisdiction_id,
                   funds_holder, status) VALUES
 (pg_temp.id('53d001'), pg_temp.id('53a001'), pg_temp.id('53b001'), 'Événement A1', 'XOF',
  'Africa/Dakar', pg_temp.id('53c001'), 'ORGANIZER', 'LIVE'),
 (pg_temp.id('53d002'), pg_temp.id('53a001'), pg_temp.id('53b002'), 'Événement A2', 'XOF',
  'Africa/Dakar', pg_temp.id('53c001'), 'ORGANIZER', 'LIVE'),
 (pg_temp.id('53d011'), pg_temp.id('53a002'), pg_temp.id('53b011'), 'Événement B', 'XOF',
  'Africa/Dakar', pg_temp.id('53c001'), 'ORGANIZER', 'LIVE');
SELECT pg_temp.a();
SELECT count(open_event_ledger(pg_temp.id(e))) FROM unnest(ARRAY['53d001', '53d002']) e;
SELECT pg_temp.b();
SELECT open_event_ledger(pg_temp.id('53d011'));
INSERT INTO app_user (id, operator_id, issuer, subject, email, display_name)
SELECT pg_temp.id(u), pg_temp.id(o), 'https://idp.test', 's0053' || u, u || '@test',
       'Personne ' || u
  FROM (VALUES ('53e001', '53a001'), ('53e002', '53a001'), ('53e003', '53a001'),
               ('53f102', '53a001'), ('53e011', '53a002'), ('53e012', '53a002'),
               ('53e013', '53a002'), ('53f111', '53a002')) AS v(u, o);
INSERT INTO role_assignment (user_id, role, scope_type, scope_id, granted_by) VALUES
 (pg_temp.id('53e001'), 'OPERATOR_ADMIN', 'OPERATOR', pg_temp.id('53a001'), NULL),
 (pg_temp.id('53e002'), 'CASHIER', 'EVENT', pg_temp.id('53d001'), NULL),
 (pg_temp.id('53e003'), 'SUPERVISOR', 'EVENT', pg_temp.id('53d001'), NULL),
 (pg_temp.id('53f102'), 'ORGANIZER_ADMIN', 'ORGANIZER', pg_temp.id('53b002'), NULL),
 (pg_temp.id('53e011'), 'OPERATOR_ADMIN', 'OPERATOR', pg_temp.id('53a002'), NULL),
 (pg_temp.id('53e012'), 'CASHIER', 'EVENT', pg_temp.id('53d011'), NULL),
 (pg_temp.id('53e013'), 'SUPERVISOR', 'EVENT', pg_temp.id('53d011'), NULL),
 (pg_temp.id('53f111'), 'ORGANIZER_ADMIN', 'ORGANIZER', pg_temp.id('53b011'), NULL);
INSERT INTO device (id, operator_id, kind, app_mode, event_id, serial) VALUES
 (pg_temp.id('53aa01'), pg_temp.id('53a001'), 'TOPUP', 'TOPUP_DESK', pg_temp.id('53d001'),
  'R53-AA01'),
 (pg_temp.id('53aa02'), pg_temp.id('53a001'), 'TOPUP', 'TOPUP_DESK', pg_temp.id('53d001'),
  'R53-AA02'),
 (pg_temp.id('53aa03'), pg_temp.id('53a001'), 'TOPUP', 'TOPUP_DESK', pg_temp.id('53d001'),
  'R53-AA03'),
 (pg_temp.id('53ab01'), pg_temp.id('53a002'), 'TOPUP', 'TOPUP_DESK', pg_temp.id('53d011'),
  'R53-AB01'),
 (pg_temp.id('53ab02'), pg_temp.id('53a002'), 'TOPUP', 'TOPUP_DESK', pg_temp.id('53d011'),
  'R53-AB02');
-- Configurations ACTIVES, insérées en propriétaire (amorçage : l'activation passe par une demande
-- approuvée, hors de ce lot). A : WAVE par défaut de b001. B : WAVE et CARD de b011.
INSERT INTO psp_configuration (psp_configuration_id, operator_id, organizer_id, method, provider,
    holder_party_id, secret_ref, status, valid_from, created_by, approved_by, compliance_ref,
    activated_at, is_default)
VALUES
 (pg_temp.id('53ca01'), pg_temp.id('53a001'), pg_temp.id('53b001'), 'WAVE', 'WAVE',
  pg_temp.id('53b001'), 'psp/' || pg_temp.id('53b001') || '/awave', 'ACTIVE',
  clock_timestamp() - interval '2 days', pg_temp.id('53e001'), pg_temp.id('53e002'),
  'BCEAO-A-1', clock_timestamp(), true),
 (pg_temp.id('53cb01'), pg_temp.id('53a002'), pg_temp.id('53b011'), 'WAVE', 'WAVE',
  pg_temp.id('53b011'), 'psp/' || pg_temp.id('53b011') || '/bwave', 'ACTIVE',
  clock_timestamp() - interval '2 days', pg_temp.id('53e011'), pg_temp.id('53e012'),
  'BCEAO-B-1', clock_timestamp(), true),
 (pg_temp.id('53cb02'), pg_temp.id('53a002'), pg_temp.id('53b011'), 'CARD', 'PAYDUNYA',
  pg_temp.id('53b011'), 'psp/' || pg_temp.id('53b011') || '/bcard', 'ACTIVE',
  clock_timestamp() - interval '2 days', pg_temp.id('53e011'), pg_temp.id('53e012'),
  'BCEAO-B-2', clock_timestamp(), true);
-- B : choix du PSP par événement, en propriétaire (amorçage : en direct, la fonction exige une
-- demande approuvée, hors de ce lot) ; les comptes A-PSP-* viennent de open_psp_accounts.
SELECT pg_temp.b();
SELECT open_psp_accounts((SELECT id FROM ledger WHERE scope_id = pg_temp.id('53d011')));
INSERT INTO event_psp_selection (event_id, method, psp_configuration_id, selected_by, approved_by,
                                 operator_id)
VALUES (pg_temp.id('53d011'), 'WAVE', pg_temp.id('53cb01'), pg_temp.id('53f111'),
        pg_temp.id('53e013'), pg_temp.id('53a002')),
       (pg_temp.id('53d011'), 'CARD', pg_temp.id('53cb02'), pg_temp.id('53f111'),
        pg_temp.id('53e013'), pg_temp.id('53a002'));
SELECT set_config('wp05.wb', open_event_wallet(pg_temp.id('53d011'), pg_temp.id('53c211'))::text,
                  true);
SELECT pg_temp.a();
SELECT set_config('wp05.wa', open_event_wallet(pg_temp.id('53d001'), pg_temp.id('53c201'))::text,
                  true);
SELECT set_config('wp05.wa2', open_event_wallet(pg_temp.id('53d001'))::text, true);
-- B, par les fonctions : recharge WAVE, notification, refus, session de caisse avec comptage et
-- transaction rattachée, recharge CARD réussie et sa contestation.
SELECT pg_temp.b();
SELECT create_psp_topup(pg_temp.id('53ff01'), pg_temp.g('wb'), 'WAVE', 5000, 'DESK',
                        pg_temp.id('53ab01'), pg_temp.id('53e012'), NULL,
                        clock_timestamp() + interval '1 hour');
SELECT set_config('wp05.evb', (SELECT psp_event_id FROM record_psp_event(pg_temp.id('53cb01'),
  'EV-B1', 'UNKNOWN', '\x0a0b'::bytea, '{}'))::text, true);
SELECT record_webhook_rejection(pg_temp.id('53cb01'), 'SIGNATURE_INVALID');
SELECT set_config('wp05.sb', (SELECT cash_session_id FROM open_cash_session(pg_temp.id('53ab01'),
  pg_temp.id('53e012')))::text, true);
SELECT count_cash_session(pg_temp.g('sb'), 1000, pg_temp.id('53e012'));
-- Recharge espèces sur la caisse de B (propriétaire, comme le moteur) puis rattachement.
SELECT set_config('wp05.txb', post_transaction(
  (SELECT ledger_id FROM cash_session WHERE cash_session_id = pg_temp.g('sb')), 'TOPUP_CASH',
  'k53:cash-b1', clock_timestamp(), 'ONLINE', jsonb_build_array(
    jsonb_build_object('account_id', (SELECT cash_account_id FROM cash_session
                                       WHERE cash_session_id = pg_temp.g('sb')), 'amount', 2000),
    jsonb_build_object('account_id', (SELECT id FROM account WHERE wallet_id = pg_temp.g('wb')
                                         AND purpose = 'WALLET_PAID'), 'amount', -2000)),
  NULL, NULL, NULL, NULL, NULL, NULL)::text, true);
SELECT attach_cash_tx(pg_temp.g('sb'), pg_temp.g('txb'));
-- Recharge CARD de B créditée (transaction PSP + complétion), puis contestation.
SELECT create_psp_topup(pg_temp.id('53ff02'), pg_temp.g('wb'), 'CARD', 4000, 'DESK',
                        pg_temp.id('53ab01'), pg_temp.id('53e012'), NULL,
                        clock_timestamp() + interval '1 hour');
SELECT mark_psp_topup_initiated(pg_temp.id('53ff02'), 'REF-53-B2');
SELECT set_config('wp05.tcb', post_transaction(
  (SELECT ledger_id FROM psp_topup WHERE psp_topup_id = pg_temp.id('53ff02')), 'TOPUP',
  psp_key_prefix('CARD') || ':' || pg_temp.id('53cb02') || ':REF-53-B2', clock_timestamp(),
  'PSP_WEBHOOK', jsonb_build_array(
    jsonb_build_object('account_id', (SELECT id FROM account a JOIN psp_topup t
                         ON t.ledger_id = a.ledger_id AND a.code = psp_account_code('CARD')
                        WHERE t.psp_topup_id = pg_temp.id('53ff02')), 'amount', 4000),
    jsonb_build_object('account_id', (SELECT id FROM account WHERE wallet_id = pg_temp.g('wb')
                                         AND purpose = 'WALLET_PAID'), 'amount', -4000)),
  pg_temp.id('53d011'))::text, true);
SELECT complete_card_topup(pg_temp.id('53ff02'), pg_temp.g('tcb'), 0, 'fp53', 'SUCCEEDED');
SELECT set_config('wp05.cbb', (SELECT psp_chargeback_id FROM record_chargeback(
  pg_temp.id('53ff02'), 'DSP-53-B', 1000))::text, true);
RESET app.operator_id;
SELECT is((SELECT array_agg(t ORDER BY t) FROM unnest(pg_temp.tables()) t
            WHERE pg_temp.n(t, pg_temp.id('53a002')) = 0), NULL::text[],
  'données : chaque table de la mission a au moins une ligne de B (isolation non vide)');
-- A : une caisse ouverte (chemin légitime, amorçage du comptage) pour les contrôles de A.
SELECT pg_temp.a();
SELECT set_config('wp05.sa', (SELECT cash_session_id FROM open_cash_session(pg_temp.id('53aa01'),
  pg_temp.id('53e002')))::text, true);
SELECT set_config('wp05.fp0', pg_temp.fp_b(), true);
RESET app.operator_id;

-- 1. Catalogue des droits de cashless_app -------------------------------------------------------
-- 1a. Tables : RLS forcée et politique nommée sur chacune des dix tables.
SELECT is((SELECT count(*)::int FROM pg_class c WHERE c.relname = ANY (pg_temp.tables())
            AND c.relkind = 'r' AND c.relrowsecurity AND c.relforcerowsecurity), 10,
  'RLS activée et forcée sur les dix tables');
SELECT is((SELECT array_agg(c.relname::text ORDER BY c.relname) FROM pg_class c
            WHERE c.relname = ANY (pg_temp.tables()) AND c.relkind = 'r'
              AND NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.tablename = c.relname
                                 AND p.policyname IN ('tenant_isolation', 'rejection_read'))),
  NULL::text[], 'une politique (tenant_isolation, ou rejection_read) sur chaque table');
-- 1b. Lecture : liste exacte des colonnes. psp_configuration sans secret_ref (A10), psp_event
--     sans body (A24). Une colonne ajoutée plus tard fait échouer la liste (la liste calculée de
--     post-roles.sql l'aurait accordée).
SELECT is(pg_temp.cols('cashless_app', t, 'SELECT'), e::text[],
  'cashless_app : colonnes lisibles de ' || t || ', liste exacte')
  FROM (VALUES
    ('cash_desk', '{account_id,created_at,device_id,ledger_id,operator_id}'),
    ('cash_session', '{cash_account_id,cash_diff_anomaly_id,cash_session_id,close_tx_id,'
                     || 'closed_at,closed_by,counted_amount,device_id,event_id,expected_amount,'
                     || 'ledger_id,opened_at,opened_by,operator_id,status}'),
    ('cash_session_count', '{cash_session_id,count_no,counted_amount,counted_at,counted_by,note,'
                           || 'operator_id}'),
    ('cash_session_tx', '{attached_at,cash_session_id,operator_id,tx_id}'),
    ('event_psp_selection', '{approved_by,event_id,method,operator_id,psp_configuration_id,'
                            || 'request_id,selected_at,selected_by}'),
    ('psp_chargeback', '{amount,anomaly_id,blocked_at,chargeback_tx_id,created_at,late,'
                       || 'operator_id,provider_dispute_id,psp_chargeback_id,'
                       || 'psp_configuration_id,psp_topup_id,unblocked_by_request,'
                       || 'wallet_blocked}'),
    ('psp_configuration', '{activated_at,approved_by,compliance_ref,created_at,created_by,'
                          || 'holder_party_id,is_default,last_decided_at,last_request_id,method,'
                          || 'operator_id,organizer_id,provider,psp_configuration_id,status,'
                          || 'supersedes_id,valid_from,valid_until,version}'),
    ('psp_event', '{attempts,body_purged_at,kind,normalized,operator_id,outcome,processed_at,'
                  || 'provider_event_id,psp_configuration_id,psp_event_id,psp_topup_id,'
                  || 'received_at,signature_valid,status}'),
    ('psp_topup', '{amount,anomaly_id,card_fingerprint,created_at,currency,customer_id,'
                  || 'device_id,event_id,expires_at,failure_reason,fee_amount,ledger_id,method,'
                  || 'operator_id,person_id,provider,provider_payment_ref,psp_configuration_id,'
                  || 'psp_topup_id,requested_by_kind,status,succeeded_at,three_ds,topup_tx_id,'
                  || 'wallet_id}'),
    ('psp_webhook_rejection', '{config_key,count,minute,operator_id,psp_configuration_id,reason}')
  ) AS x(t, e);
SELECT ok(NOT has_table_privilege('cashless_app', t, 'SELECT'),
  'cashless_app : pas de SELECT sur toute la table ' || t || ' (accordé par colonne)')
  FROM unnest(ARRAY['psp_configuration', 'psp_event']) t;
SELECT is((SELECT array_agg(t || ':' || c ORDER BY t, c)
             FROM (VALUES ('psp_configuration', 'secret_ref'), ('psp_event', 'body')) AS x(t, c)
            WHERE has_column_privilege('cashless_app', t, c, 'SELECT')), NULL::text[],
  'A10, A24 : cashless_app ne lit ni psp_configuration.secret_ref ni psp_event.body');
-- 1c. Écriture : aucune colonne insérable ni modifiable, aucun droit de table.
SELECT is(pg_temp.cols('cashless_app', t, p), '{}'::text[],
  'cashless_app : aucune colonne ' || p || ' sur ' || t)
  FROM unnest(pg_temp.tables()) t, unnest(ARRAY['INSERT', 'UPDATE']) p;
SELECT is((SELECT array_agg(t || ':' || p ORDER BY t, p)
             FROM unnest(pg_temp.tables()) t,
                  unnest(ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES',
                               'TRIGGER']) p
            WHERE has_table_privilege('cashless_app', t, p)), NULL::text[],
  'cashless_app : aucun droit de table INSERT, UPDATE, DELETE, TRUNCATE (ni REFERENCES, TRIGGER)');
-- A6 : cashless_app garde son INSERT sur account (la barrière est le déclencheur).
SELECT ok(has_table_privilege('cashless_app', 'account', 'INSERT'),
  'A6 : cashless_app garde l''INSERT sur account (account_purpose_guard est la barrière)');
-- 1d. Autres rôles : rien sur les tables nouvelles, lecture comprise ; rôles relevés dans
--     pg_roles (un rôle cashless_* ajouté plus tard est couvert d'office).
CREATE FUNCTION pg_temp.others() RETURNS text[] LANGUAGE sql STABLE AS $$
  SELECT array_agg(rolname::text ORDER BY rolname) || 'public'::text FROM pg_roles
   WHERE rolname LIKE 'cashless\_%' AND rolname <> 'cashless_app'
$$;
SELECT ok(pg_temp.others() @> ARRAY['cashless_keyadmin', 'cashless_perso', 'cashless_platform',
                                    'cashless_tagcheck', 'cashless_tagkeys', 'public'],
  'témoin : rôles comparés (pg_roles cashless_* hors cashless_app, et PUBLIC)');
SELECT is((SELECT array_agg(r || ':' || t || ':' || p ORDER BY r, t, p)
             FROM unnest(pg_temp.others()) r, unnest(pg_temp.tables()) t,
                  unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) p
            WHERE has_table_privilege(r, t, p)
               OR (p IN ('SELECT', 'INSERT', 'UPDATE') AND has_any_column_privilege(r, t, p))),
  NULL::text[],
  'PUBLIC et autres rôles cashless_* (platform, clés) : aucun droit sur les dix tables');
SELECT is((SELECT array_agg(t ORDER BY t) FROM unnest(pg_temp.tables()) t
            WHERE NOT has_table_privilege('cashless_app', t, 'SELECT')
              AND NOT has_any_column_privilege('cashless_app', t, 'SELECT')), NULL::text[],
  'cashless_app lit (sous RLS) chacune des dix tables');

-- 2. EXECUTE : fonctions internes jamais exécutables, fonctions publiques accordées --------------
-- (la liste exacte de l'ensemble est figée dans tests_execute_grants.sql)
SELECT ok(NOT has_function_privilege('cashless_app', f, 'EXECUTE'),
  'cashless_app : ' || f || ' non exécutable (interne)')
  FROM unnest(ARRAY[
    'cash_actor_allowed(uuid,uuid,uuid,text[])', 'cash_session_usable(uuid,uuid)',
    'cash_session_attach_own(cash_session,text)', 'psp_session_operator()',
    'psp_key_prefix(text)', 'psp_topup_net_credited(uuid)',
    'psp_topup_replay_row(uuid,uuid,text,bigint,text)',
    'psp_complete_core(uuid,uuid,bigint,text,boolean,text,text)', 'psp_operator_admin(uuid,uuid)',
    'psp_organizer_admin(uuid,uuid,uuid)', 'psp_account_code(text)',
    'open_psp_accounts(uuid)', 'assert_no_legacy_psp_fee_rules()']) f;
-- Fonctions de déclencheur : toutes celles de 0036 à 0038 (relevées par le catalogue).
SELECT is((SELECT array_agg(DISTINCT p.oid::regprocedure::text ORDER BY p.oid::regprocedure::text)
             FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
            WHERE NOT t.tgisinternal AND p.pronamespace = 'public'::regnamespace
              AND has_function_privilege('cashless_app', p.oid, 'EXECUTE')), NULL::text[],
  'cashless_app : aucune fonction de déclencheur n''est exécutable');
SELECT ok(EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
                   WHERE p.proname IN ('posting_cash_desk_guard', 'account_purpose_guard',
                                       'event_psp_selection_guard')),
  'témoin : les déclencheurs de caisse et de choix du PSP existent');
SELECT ok(has_function_privilege('cashless_app', f, 'EXECUTE'),
  'cashless_app : ' || f || ' exécutable')
  FROM unnest(ARRAY[
    'open_cash_session(uuid,uuid)', 'open_cash_due_anomaly(uuid,uuid,bigint,uuid)',
    'mark_psp_event(uuid,text,text,uuid)', 'psp_events_to_retry(integer)',
    'purge_psp_event_bodies(integer)', 'attach_chargeback_tx(uuid,uuid)',
    'psp_configuration_secret_ref(uuid)', 'psp_webhook_context(uuid)',
    'read_psp_event_body(uuid,uuid)', 'psp_poll_candidates(integer)']) f;
-- Rôles autres que cashless_app : aucune fonction de la mission (cashless_platform, clés, PUBLIC).
SELECT is((SELECT array_agg(r || ':' || p.oid::regprocedure::text
                            ORDER BY r, p.oid::regprocedure::text)
             FROM unnest(pg_temp.others()) r, pg_proc p
            WHERE p.pronamespace = 'public'::regnamespace
              AND (p.proname ~ '^(cash_|psp_|open_cash|count_cash|begin_cash|finish_cash)'
                   OR p.proname IN ('attach_cash_tx', 'open_cash_due_anomaly',
                     'take_deposit_for_session', 'refund_deposit_for_session',
                     'refund_cash_due_for_session', 'create_psp_configuration',
                     'activate_psp_configuration', 'set_event_psp_selection',
                     'resolve_psp_configuration', 'create_psp_topup', 'mark_psp_topup_initiated',
                     'cancel_psp_topup', 'expire_psp_topups', 'record_psp_event',
                     'mark_psp_event', 'purge_psp_event_bodies', 'read_psp_event_body',
                     'complete_psp_topup', 'complete_card_topup', 'fail_psp_topup',
                     'card_topups_today', 'wallet_card_count', 'record_webhook_rejection',
                     'record_chargeback', 'attach_chargeback_tx',
                     'block_wallet_after_chargeback', 'unblock_wallet'))
              AND has_function_privilege(r, p.oid, 'EXECUTE')), NULL::text[],
  'PUBLIC et autres rôles cashless_* : aucune fonction de la mission exécutable');
-- [A8-DETTE] : accordées jusqu'à WP09 ; WP09 retire ces trois signatures de post-roles.sql
-- (retouche d'une ligne) et retourne ce test.
SELECT ok(has_function_privilege('cashless_app', f, 'EXECUTE'),
  '[A8-DETTE] ' || f || ' : accordée jusqu''à WP09 ; WP09 retire ces trois signatures de '
  || 'post-roles.sql (retouche d''une ligne) et retourne ce test')
  FROM unnest(ARRAY['take_deposit(uuid,uuid)', 'refund_deposit(uuid,uuid)',
                    'refund_cash_due(uuid,uuid,text,uuid,uuid,uuid)']) f;

-- 3. Refus réels sous cashless_app ----------------------------------------------------------------
SET LOCAL ROLE cashless_app;
SELECT pg_temp.a();
SELECT throws_ok(format('INSERT INTO %I DEFAULT VALUES', t), '42501', NULL,
  'cashless_app : INSERT direct dans ' || t || ' refusé')
  FROM unnest(pg_temp.tables()) t;
SELECT throws_ok(format('UPDATE %I SET operator_id = operator_id', t), '42501', NULL,
  'cashless_app : UPDATE direct de ' || t || ' refusé')
  FROM unnest(pg_temp.tables()) t;
SELECT throws_ok(format('DELETE FROM %I', t), '42501', NULL,
  'cashless_app : DELETE direct dans ' || t || ' refusé')
  FROM unnest(pg_temp.tables()) t;
SELECT throws_ok(q, '42501', NULL, 'cashless_app : ' || q || ' refusé')
  FROM unnest(ARRAY[
    'UPDATE cash_session SET status = ''CLOSED''',
    'UPDATE cash_session SET expected_amount = 0',
    'UPDATE psp_topup SET status = ''SUCCEEDED''',
    'UPDATE psp_topup SET topup_tx_id = topup_tx_id',
    'UPDATE psp_configuration SET status = ''ACTIVE''',
    'UPDATE psp_configuration SET secret_ref = secret_ref',
    'UPDATE psp_event SET status = status',
    'UPDATE psp_chargeback SET wallet_blocked = false',
    'INSERT INTO psp_configuration (operator_id, organizer_id, method, provider, holder_party_id, '
      || 'secret_ref, status, valid_from, created_by, approved_by, compliance_ref, '
      || 'activated_at, is_default) SELECT operator_id, organizer_id, method, provider, '
      || 'holder_party_id, ''psp/'' || holder_party_id || ''/x'', ''ACTIVE'', valid_from, '
      || 'created_by, approved_by, ''X-1'', now(), false FROM psp_configuration',
    'INSERT INTO event_psp_selection (event_id, method, psp_configuration_id, selected_by, '
      || 'operator_id) SELECT event_id, method, psp_configuration_id, selected_by, operator_id '
      || 'FROM event_psp_selection',
    'SELECT secret_ref FROM psp_configuration',
    'SELECT * FROM psp_configuration',
    'SELECT c FROM psp_configuration c',
    'SELECT psp_configuration_id FROM psp_configuration c WHERE secret_ref IS NOT NULL',
    'SELECT * FROM psp_event',
    'SELECT body FROM psp_event',
    'SELECT e FROM psp_event e',
    'SELECT psp_event_id FROM psp_event WHERE body IS NOT NULL'
  ]) q;
-- La lecture des colonnes permises passe (la table de A est lisible sous RLS).
SELECT lives_ok($$SELECT psp_configuration_id, status, method, provider, holder_party_id
                    FROM psp_configuration$$,
  'cashless_app : colonnes permises de psp_configuration lisibles');
SELECT lives_ok($$SELECT psp_event_id, kind, status, normalized, body_purged_at FROM psp_event$$,
  'cashless_app : colonnes permises de psp_event lisibles');
-- Fonctions internes : refus réel à l'appel.
SELECT throws_ok($$SELECT cash_session_usable(NULL, NULL)$$, '42501', NULL,
  'cashless_app : cash_session_usable refusée à l''appel');
SELECT throws_ok($$SELECT psp_complete_core(NULL, NULL, 0, NULL, false, NULL, NULL)$$, '42501',
  NULL, 'cashless_app : psp_complete_core refusée à l''appel');
SELECT throws_ok($$SELECT open_psp_accounts(NULL)$$, '42501', NULL,
  'cashless_app : open_psp_accounts refusée à l''appel (décision du porteur du 27/10/2026)');
SELECT throws_ok($$SELECT psp_topup_net_credited(NULL)$$, '42501', NULL,
  'cashless_app : psp_topup_net_credited refusée à l''appel');
RESET ROLE;

-- 4. A6 : création de comptes CASH_DESK et PSP refusée à cashless_app -----------------------------
SET LOCAL ROLE cashless_app;
SELECT pg_temp.a();
SELECT throws_ok(format($q$INSERT INTO account (operator_id, ledger_id, code, family, purpose,
    normal_side) VALUES (%L, (SELECT id FROM ledger WHERE scope_id = %L), %L, 'ASSET', %L, 'D')$q$,
    pg_temp.id('53a001'), pg_temp.id('53d001'), c, p), '42501', NULL,
  'A6 : cashless_app ne crée pas de compte ' || p || ' (' || c || ')')
  FROM (VALUES ('A-CAISSE-X53', 'CASH_DESK'), ('A-PSP-X53', 'PSP')) AS v(c, p);
SELECT throws_ok(format($q$UPDATE account SET purpose = 'CASH_DESK' WHERE ledger_id =
    (SELECT id FROM ledger WHERE scope_id = %L) AND purpose <> 'CASH_DESK'$q$,
    pg_temp.id('53d001')), '42501', NULL,
  'A6 : cashless_app ne change pas le but d''un compte en CASH_DESK');
-- La garde n'est pas trop large : un autre but est accepté.
SELECT lives_ok(format($q$INSERT INTO account (operator_id, ledger_id, code, family, purpose,
    normal_side) VALUES (%L, (SELECT id FROM ledger WHERE scope_id = %L), 'L-TRANSIT-X53',
    'SUSPENSE', 'CASH_TRANSIT', 'D')$q$, pg_temp.id('53a001'), pg_temp.id('53d001')),
  'A6 : un compte d''un autre but (CASH_TRANSIT) reste créable (ouverture de grand livre)');
RESET ROLE;
-- Le chemin légitime (open_cash_session, SECURITY DEFINER) a créé la caisse de A.
SELECT is((SELECT count(*)::int FROM account WHERE ledger_id = (SELECT ledger_id FROM
            cash_session WHERE cash_session_id = pg_temp.g('sa')) AND purpose = 'CASH_DESK'), 1,
  'A6 : open_cash_session crée le compte de caisse malgré la garde (chemin légitime)');

-- 5. A7 : une variable de session forgée n'ouvre pas la garde de caisse ---------------------------
SET LOCAL ROLE cashless_app;
SELECT pg_temp.a();
SELECT set_config('app.cash_closing', 'on', true);
SELECT set_config('app.cash_close', pg_temp.g('sa')::text, true);
SELECT set_config('app.cash_session', pg_temp.g('sa')::text, true);
-- Caisse de B (aucune session de A) ; session OPEN absente pour la caisse du terminal aa02 : on
-- inscrit en propriétaire un compte de caisse sans session, puis on poste sous cashless_app.
RESET ROLE;
INSERT INTO account (operator_id, ledger_id, code, family, purpose, normal_side)
SELECT pg_temp.id('53a001'), id, 'A-CAISSE-R53-NOSESSION', 'ASSET', 'CASH_DESK', 'D'
  FROM ledger WHERE scope_id = pg_temp.id('53d001');
INSERT INTO cash_desk (account_id, operator_id, device_id, ledger_id)
SELECT a.id, a.operator_id, pg_temp.id('53aa03'), a.ledger_id FROM account a
 WHERE a.code = 'A-CAISSE-R53-NOSESSION';
SET LOCAL ROLE cashless_app;
SELECT pg_temp.a();
SELECT set_config('app.cash_closing', 'on', true);
SELECT isnt(pg_temp.code(format($q$SELECT post_transaction(%L, 'TOPUP_CASH', 'k53:forge',
    clock_timestamp(), 'ONLINE', %L::jsonb)$q$,
    (SELECT id FROM ledger WHERE scope_id = pg_temp.id('53d001')),
    jsonb_build_array(
      jsonb_build_object('account_id', (SELECT id FROM account
                                         WHERE code = 'A-CAISSE-R53-NOSESSION'), 'amount', 100),
      jsonb_build_object('account_id', (SELECT id FROM account WHERE wallet_id = pg_temp.g('wa')
                                           AND purpose = 'WALLET_PAID'), 'amount', -100))::text)),
  'ok', 'A7 : écriture sur une caisse sans session OPEN refusée malgré la variable posée');
SELECT is((SELECT count(*)::int FROM posting p JOIN account a ON a.id = p.account_id
            WHERE a.code = 'A-CAISSE-R53-NOSESSION'), 0,
  'A7 : aucune ligne n''a été écrite sur la caisse sans session');
RESET ROLE;

-- 6. Chemins légitimes sous cashless_app (un appel réel par famille) ------------------------------
SET LOCAL ROLE cashless_app;
SELECT pg_temp.a();
SELECT lives_ok($$SELECT set_config('wp05.sa2', (SELECT cash_session_id FROM
    open_cash_session(pg_temp.id('53aa02'), pg_temp.id('53e002')))::text, true)$$,
  'sessions : open_cash_session exécutable (terminal aa02)');
SELECT is((SELECT operator_id FROM cash_session WHERE cash_session_id = pg_temp.g('sa2')),
  pg_temp.id('53a001'), 'sessions : la session ouverte est celle du prestataire courant');
SELECT lives_ok($$SELECT count_cash_session(pg_temp.g('sa'), 500, pg_temp.id('53e002'))$$,
  'sessions : count_cash_session exécutable');
SELECT lives_ok($$SELECT set_config('wp05.cfa', create_psp_configuration(pg_temp.id('53b001'),
    'ORANGE_MONEY', 'ORANGE_MONEY', pg_temp.id('53b001'), 'psp/' || pg_temp.id('53b001')
    || '/aom', false, clock_timestamp() - interval '1 day', NULL, pg_temp.id('53e001'))::text,
    true)$$, 'configurations : create_psp_configuration exécutable');
SELECT is((SELECT status FROM psp_configuration WHERE psp_configuration_id = pg_temp.g('cfa')),
  'DRAFT', 'configurations : la configuration créée est en brouillon (jamais ACTIVE)');
SELECT is((SELECT provider FROM resolve_psp_configuration(pg_temp.id('53d001'), 'WAVE')),
  'WAVE', 'configurations : resolve_psp_configuration exécutable');
SELECT lives_ok($$SELECT psp_configuration_secret_ref(pg_temp.id('53ca01'))$$,
  'configurations : psp_configuration_secret_ref exécutable (seul chemin vers secret_ref)');
SELECT lives_ok($$SELECT * FROM psp_webhook_context(pg_temp.id('53ca01'))$$,
  'configurations : psp_webhook_context exécutable');
SELECT lives_ok($$SELECT create_psp_topup(pg_temp.id('53ff11'), pg_temp.g('wa'), 'WAVE', 3000,
    'DESK', pg_temp.id('53aa01'), pg_temp.id('53e002'), NULL,
    clock_timestamp() + interval '1 hour')$$, 'recharges : create_psp_topup exécutable');
SELECT is((SELECT operator_id FROM psp_topup WHERE psp_topup_id = pg_temp.id('53ff11')),
  pg_temp.id('53a001'), 'recharges : la recharge créée est celle du prestataire courant');
SELECT lives_ok($$SELECT set_config('wp05.eva', (SELECT psp_event_id FROM record_psp_event(
    pg_temp.id('53ca01'), 'EV-A1', 'UNKNOWN', '\x0c0d'::bytea, '{}'))::text, true)$$,
  'recharges : record_psp_event exécutable');
SELECT lives_ok($$SELECT * FROM psp_poll_candidates(10)$$,
  'recharges : psp_poll_candidates exécutable');
SELECT lives_ok($$SELECT * FROM psp_events_to_retry(10)$$,
  'recharges : psp_events_to_retry exécutable');
SELECT is((SELECT body FROM (SELECT read_psp_event_body(pg_temp.g('eva'), pg_temp.id('53e001'))
            AS body) x), '\x0c0d'::bytea,
  'A24 : read_psp_event_body rend le corps à l''administrateur du prestataire');
SELECT is((SELECT count(*)::int FROM audit_log WHERE action = 'PSP_EVENT_BODY_READ'
            AND object_id = pg_temp.g('eva')::text), 1,
  'A24 : la lecture du corps est auditée');
SELECT is(record_webhook_rejection(pg_temp.id('53ca01'), 'SIGNATURE_INVALID'), 1,
  'refus : record_webhook_rejection exécutable (première occurrence)');
SELECT is(record_webhook_rejection(pg_temp.id('53ca01'), 'SIGNATURE_INVALID'), 2,
  'refus : le compteur n''est borné que par minute (deux appels : une ligne, count = 2)');
SELECT is((SELECT count(*)::int FROM psp_webhook_rejection
            WHERE psp_configuration_id = pg_temp.id('53ca01')
              AND reason = 'SIGNATURE_INVALID'), 1,
  'refus : une seule ligne par (configuration, motif, minute)');
RESET ROLE;
SELECT is(pg_temp.fp_b(), current_setting('wp05.fp0'),
  'chemins légitimes de A : aucune ligne de B n''a changé');

-- 7. T026 : isolation entre prestataires ----------------------------------------------------------
-- 7a. Lecture : sous A, aucune ligne de B ; sous B, le témoin n'est pas vide.
SET LOCAL ROLE cashless_app;
SELECT pg_temp.a();
SELECT is(pg_temp.n(t, pg_temp.id('53a002')), 0,
  'NFR-005 : sous A, ' || t || ' ne montre aucune ligne de B')
  FROM unnest(pg_temp.tables()) t;
SELECT pg_temp.b();
SELECT cmp_ok(pg_temp.n(t, pg_temp.id('53a002')), '>=', 1,
  'témoin : sous B, ' || t || ' montre au moins une ligne de B')
  FROM unnest(pg_temp.tables()) t;
-- 7b. Sans app.operator_id : aucune ligne, jamais de lecture « de tous ».
SELECT set_config('app.operator_id', '', true);
-- Un identifiant vide fait échouer la politique (22P02) ou ne rend rien (jamais « tous »).
SELECT is(pg_temp.closed(t), 0,
  'NFR-005 : sans prestataire de session, ' || t || ' ne montre aucune ligne (fermé)')
  FROM unnest(pg_temp.tables()) t;
-- psp_webhook_rejection : une ligne sans prestataire est lisible, celle d'un autre non.
RESET ROLE;
INSERT INTO psp_webhook_rejection (config_key, psp_configuration_id, operator_id, reason, minute,
                                   count)
VALUES ('00000000-0000-0000-0000-000000000000', NULL, NULL, 'UNKNOWN_CONFIG',
        date_trunc('minute', clock_timestamp()), 1);  -- amorçage : ligne sans prestataire
SET LOCAL ROLE cashless_app;
SELECT pg_temp.a();
SELECT is((SELECT count(*)::int FROM psp_webhook_rejection WHERE operator_id IS NULL), 1,
  'psp_webhook_rejection : une ligne sans prestataire est lisible');
SELECT is((SELECT count(*)::int FROM psp_webhook_rejection
            WHERE operator_id = pg_temp.id('53a002')), 0,
  'psp_webhook_rejection : la ligne d''un autre prestataire n''est pas lisible');
SELECT set_config('app.operator_id', pg_temp.id('53a003')::text, true);
SELECT is((SELECT count(*)::int FROM psp_webhook_rejection), 1,
  'psp_webhook_rejection : un tiers ne voit que la ligne sans prestataire');
-- 7c. Fonctions : sous A, un objet de B est introuvable et rien ne change.
SELECT pg_temp.a();
SELECT is(pg_temp.code(q), 'P0002', 'NFR-005 : sous A, ' || q || ' : introuvable')
  FROM unnest(ARRAY[
    format('SELECT count_cash_session(%L, 100, %L)', pg_temp.g('sb'), pg_temp.id('53e002')),
    format('SELECT begin_cash_close(%L, %L)', pg_temp.g('sb'), pg_temp.id('53e003')),
    format('SELECT attach_cash_tx(%L, %L)', pg_temp.g('sb'), pg_temp.g('txb')),
    format('SELECT open_cash_session(%L, %L)', pg_temp.id('53ab02'), pg_temp.id('53e002')),
    format('SELECT create_psp_topup(%L, %L, ''WAVE'', 1000, ''DESK'', %L, %L, NULL, '
           || 'clock_timestamp() + interval ''1 hour'')', pg_temp.id('53ff21'),
           pg_temp.g('wb'), pg_temp.id('53aa01'), pg_temp.id('53e002')),
    format('SELECT activate_psp_configuration(%L, %L)', pg_temp.id('53cb01'),
           pg_temp.id('53ff31')),
    format('SELECT set_event_psp_selection(%L, ''WAVE'', %L, %L)', pg_temp.id('53d011'),
           pg_temp.id('53cb01'), pg_temp.id('53e001')),
    format('SELECT mark_psp_topup_initiated(%L, ''REF-X'')', pg_temp.id('53ff01')),
    format('SELECT cancel_psp_topup(%L)', pg_temp.id('53ff01')),
    format('SELECT record_chargeback(%L, ''DSP-X'', 100)', pg_temp.id('53ff02')),
    format('SELECT unblock_wallet(%L, %L)', pg_temp.g('wb'), pg_temp.id('53ff31')),
    format('SELECT psp_configuration_secret_ref(%L)', pg_temp.id('53cb01')),
    format('SELECT read_psp_event_body(%L, %L)', pg_temp.g('evb'), pg_temp.id('53e001')),
    format('SELECT record_psp_event(%L, ''EV-X'', ''UNKNOWN'', NULL, ''{}'')',
           pg_temp.id('53cb01')),
    format('SELECT mark_psp_event(%L, ''PROCESSED'', ''OK'', NULL)', pg_temp.g('evb')),
    format('SELECT attach_chargeback_tx(%L, %L)', pg_temp.g('cbb'), pg_temp.g('tcb')),
    format('SELECT block_wallet_after_chargeback(%L, gen_random_uuid())', pg_temp.g('wb'))
  ]) q;
RESET ROLE;
SELECT is(pg_temp.fp_b(), current_setting('wp05.fp0'),
  'NFR-005 : les appels de A sur des objets de B n''ont modifié aucune ligne de B');
-- 7d. Sans app.operator_id, les fonctions échouent aussi.
SET LOCAL ROLE cashless_app;
SELECT set_config('app.operator_id', '', true);
SELECT is(pg_temp.code(q), 'P0002', 'NFR-005 : sans prestataire, ' || q || ' : refusé')
  FROM unnest(ARRAY[
    format('SELECT open_cash_session(%L, %L)', pg_temp.id('53aa01'), pg_temp.id('53e002')),
    format('SELECT count_cash_session(%L, 100, %L)', pg_temp.g('sa'), pg_temp.id('53e002')),
    format('SELECT create_psp_topup(%L, %L, ''WAVE'', 1000, ''DESK'', %L, %L, NULL, '
           || 'clock_timestamp() + interval ''1 hour'')', pg_temp.id('53ff22'),
           pg_temp.g('wa'), pg_temp.id('53aa01'), pg_temp.id('53e002')),
    format('SELECT psp_configuration_secret_ref(%L)', pg_temp.id('53ca01')),
    format('SELECT record_psp_event(%L, ''EV-Y'', ''UNKNOWN'', NULL, ''{}'')',
           pg_temp.id('53ca01')),
    format('SELECT read_psp_event_body(%L, %L)', pg_temp.g('eva'), pg_temp.id('53e001')),
    format('SELECT record_chargeback(%L, ''DSP-Y'', 100)', pg_temp.id('53ff02'))
  ]) q;
RESET ROLE;

-- 8. Cloisonnement par organisateur (même prestataire) : seulement ce que la base garantit --------
-- Le choix du PSP d'un événement refuse une configuration d'un autre organisateur ;
-- l'administrateur d'un organisateur n'agit pas sur l'événement d'un autre.
SET LOCAL ROLE cashless_app;
SELECT pg_temp.a();
SELECT isnt(pg_temp.code(format($q$SELECT set_event_psp_selection(%L, 'WAVE', %L, %L)$q$,
    pg_temp.id('53d002'), pg_temp.id('53ca01'), pg_temp.id('53f102'))), 'ok',
  'organisateur : une configuration de b001 ne se choisit pas pour l''événement de b002');
SELECT is(pg_temp.code(format($q$SELECT set_event_psp_selection(%L, 'WAVE', %L, %L)$q$,
    pg_temp.id('53d001'), pg_temp.id('53ca01'), pg_temp.id('53f102'))), 'P0002',
  'organisateur : l''ORGANIZER_ADMIN de b002 n''agit pas sur l''événement de b001');
SELECT is((SELECT count(*)::int FROM event_psp_selection
            WHERE event_id IN (pg_temp.id('53d001'), pg_temp.id('53d002'))), 0,
  'organisateur : aucune sélection n''a été écrite par ces refus');
RESET ROLE;

-- 9. Rejeu de post-roles.sql : mêmes droits (idempotent) ------------------------------------------
CREATE TEMP TABLE wp05_rights AS
  SELECT t, p, pg_temp.cols('cashless_app', t, p) AS c
    FROM unnest(pg_temp.tables()) t, unnest(ARRAY['SELECT', 'INSERT', 'UPDATE']) p;
SET LOCAL client_min_messages = warning;
\ir ../roles.sql
\ir ../post-roles.sql
RESET client_min_messages;
SELECT is((SELECT array_agg(t || ':' || p ORDER BY t, p) FROM wp05_rights
            WHERE c IS DISTINCT FROM pg_temp.cols('cashless_app', t, p)), NULL::text[],
  'rejeu roles.sql puis post-roles.sql : colonnes lisibles, insérables et modifiables inchangées');
SELECT ok(NOT has_function_privilege('cashless_app', 'cash_session_usable(uuid,uuid)', 'EXECUTE')
      AND has_function_privilege('cashless_app', 'open_cash_session(uuid,uuid)', 'EXECUTE'),
  'rejeu : fonction interne toujours fermée, fonction publique toujours accordée');

SELECT * FROM finish();
ROLLBACK;
