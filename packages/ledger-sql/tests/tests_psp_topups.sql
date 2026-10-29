-- Recharges PSP, notifications, compteur de refus, contestations, extensions de listes fermées
-- (migration 0038 ; mission recharges-caisses-psp, lot WP04) — pgTAP, écrit à la main.
-- Lancer : pg_prove -d <base> tests/tests_psp_topups.sql (base créée par les migrations,
-- roles.sql et post-roles.sql rejoués). Les droits par rôle sont testés par le lot WP05 : ici le
-- propriétaire appelle les fonctions, chaque contrôle testé est celui de la FONCTION ou du
-- déclencheur. Les anciennetés se fabriquent par UPDATE du propriétaire (déclencheurs désactivés
-- dans la transaction, annulés avec elle) ; aucune comparaison avec l'horloge de Node.
-- Toutes les dates sont relatives à clock_timestamp() (aucune comparaison avec l'horloge de Node).
\set ON_ERROR_STOP 1
\set QUIET 1
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

-- Identifiants : pg_temp.id('38a001') = '00000000-0000-0000-0000-00000038a001'.
CREATE FUNCTION pg_temp.id(p text) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT ('00000000-0000-0000-0000-' || lpad(p, 12, '0'))::uuid $$;
-- Code d'erreur (5 caractères) et message de l'exécution d'une instruction, ou 'ok'.
CREATE FUNCTION pg_temp.err(p text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE p; RETURN 'ok';
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE || ' ' || SQLERRM; END $$;
CREATE FUNCTION pg_temp.code(p text) RETURNS text LANGUAGE sql AS
  $$ SELECT left(pg_temp.err(p), 5) $$;
CREATE FUNCTION pg_temp.sa() RETURNS void LANGUAGE sql AS
  $$ SELECT set_config('app.operator_id', pg_temp.id('38a001')::text, true) $$;
CREATE FUNCTION pg_temp.sb() RETURNS void LANGUAGE sql AS
  $$ SELECT set_config('app.operator_id', pg_temp.id('38a002')::text, true) $$;
CREATE FUNCTION pg_temp.nosession() RETURNS void LANGUAGE sql AS
  $$ SELECT set_config('app.operator_id', '', true) $$;

-- Données (propriétaire) ------------------------------------------------------------------------
-- A : organisateurs b001 et b002 ; événements d001 (fonds : organisateur b001), d002 (fonds :
-- prestataire a001), d003 (futur CLOSING), d004 (futur LIVE), d005 (organisateur b002), d006 (sans
-- grand livre). B : organisateur b011, événement d011.
INSERT INTO party (kind, legal_name) SELECT 'PLATFORM', 'Plateforme (test)'
 WHERE NOT EXISTS (SELECT 1 FROM party WHERE kind = 'PLATFORM');
INSERT INTO party (id, kind, legal_name, country_code) VALUES
 (pg_temp.id('38a001'), 'OPERATOR', 'Prestataire A', 'SN'),
 (pg_temp.id('38a002'), 'OPERATOR', 'Prestataire B', 'CI');
INSERT INTO party (id, kind, operator_id, legal_name) VALUES
 (pg_temp.id('38b001'), 'ORGANIZER', pg_temp.id('38a001'), 'Organisateur A1'),
 (pg_temp.id('38b002'), 'ORGANIZER', pg_temp.id('38a001'), 'Organisateur A2'),
 (pg_temp.id('38b011'), 'ORGANIZER', pg_temp.id('38a002'), 'Organisateur B');
INSERT INTO jurisdiction_profile (id, country_code, version, valid_from, breakage_destination)
VALUES (pg_temp.id('38c001'), 'SN', 380037, '2026-01-01', 'ORGANIZER');
INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone, jurisdiction_id,
                   funds_holder) VALUES
 (pg_temp.id('38d001'), pg_temp.id('38a001'), pg_temp.id('38b001'), 'Événement 1', 'XOF',
  'Africa/Dakar', pg_temp.id('38c001'), 'ORGANIZER'),
 (pg_temp.id('38d002'), pg_temp.id('38a001'), pg_temp.id('38b001'), 'Événement 2', 'XOF',
  'Africa/Dakar', pg_temp.id('38c001'), 'OPERATOR'),
 (pg_temp.id('38d003'), pg_temp.id('38a001'), pg_temp.id('38b001'), 'Événement 3', 'XOF',
  'Africa/Dakar', pg_temp.id('38c001'), 'ORGANIZER'),
 (pg_temp.id('38d004'), pg_temp.id('38a001'), pg_temp.id('38b001'), 'Événement 4', 'XOF',
  'Africa/Dakar', pg_temp.id('38c001'), 'ORGANIZER'),
 (pg_temp.id('38d005'), pg_temp.id('38a001'), pg_temp.id('38b002'), 'Événement 5', 'XOF',
  'Africa/Dakar', pg_temp.id('38c001'), 'ORGANIZER'),
 (pg_temp.id('38d006'), pg_temp.id('38a001'), pg_temp.id('38b001'), 'Événement 6', 'XOF',
  'Africa/Dakar', pg_temp.id('38c001'), 'ORGANIZER'),
 (pg_temp.id('38d011'), pg_temp.id('38a002'), pg_temp.id('38b011'), 'Événement B', 'XOF',
  'Africa/Dakar', pg_temp.id('38c001'), 'ORGANIZER');
-- Grands livres par open_event_ledger (jamais fabriqués à la main).
SELECT pg_temp.sa();
SELECT count(open_event_ledger(pg_temp.id(e))) FROM unnest(ARRAY['38d001','38d002','38d003','38d004',
                                                          '38d005']) e;
SELECT pg_temp.sb();
SELECT count(open_event_ledger(pg_temp.id('38d011')));
-- Personnes : A : e001, e002, e003 OPERATOR_ADMIN, e004 sans rôle, o101 et o102 ORGANIZER_ADMIN de
-- b001. B : e011, e012 OPERATOR_ADMIN, o111 ORGANIZER_ADMIN de b011.
INSERT INTO app_user (id, operator_id, issuer, subject, email, display_name)
SELECT pg_temp.id(u), pg_temp.id(o), 'https://idp.test', 's' || u, u || '@test', 'Personne ' || u
  FROM (VALUES ('38e001','38a001'), ('38e002','38a001'), ('38e003','38a001'), ('38e004','38a001'),
               ('38f101','38a001'), ('38f102','38a001'),
               ('38e011','38a002'), ('38e012','38a002'), ('38f111','38a002')) AS v(u, o);
INSERT INTO role_assignment (user_id, role, scope_type, scope_id, granted_by)
SELECT pg_temp.id(u), 'OPERATOR_ADMIN', 'OPERATOR', pg_temp.id(o), NULL
  FROM (VALUES ('38e001','38a001'), ('38e002','38a001'), ('38e003','38a001'),
               ('38e011','38a002'), ('38e012','38a002')) AS v(u, o);
INSERT INTO role_assignment (user_id, role, scope_type, scope_id, granted_by)
SELECT pg_temp.id(u), 'ORGANIZER_ADMIN', 'ORGANIZER', pg_temp.id(o), NULL
  FROM (VALUES ('38f101','38b001'), ('38f102','38b001'), ('38f111','38b011')) AS v(u, o);

-- Aides ---------------------------------------------------------------------------------------------
-- Configurations nommées (temp table).
CREATE TEMP TABLE k (name text PRIMARY KEY, id uuid NOT NULL);
CREATE FUNCTION pg_temp.k(p text) RETURNS uuid LANGUAGE sql AS
  $$ SELECT id FROM k WHERE name = p $$;
-- Création sous la session d'un prestataire (a : A/e001 ; b : B/e011).
CREATE FUNCTION pg_temp.mk(p_name text, p_org text, p_method text, p_provider text,
                           p_holder text, p_default boolean,
                           p_from timestamptz DEFAULT clock_timestamp() - interval '2 days',
                           p_until timestamptz DEFAULT NULL, p_super text DEFAULT NULL,
                           p_actor text DEFAULT '38e001') RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_id uuid;
BEGIN
  v_id := create_psp_configuration(pg_temp.id(p_org), p_method, p_provider, pg_temp.id(p_holder),
            'psp/' || pg_temp.id(p_holder) || '/' || p_name, p_default, p_from, p_until,
            pg_temp.id(p_actor), CASE WHEN p_super IS NULL THEN NULL ELSE pg_temp.k(p_super) END);
  INSERT INTO k VALUES (p_name, v_id);
END $$;
-- Règle de frais explicite d'une configuration (propriétaire).
CREATE FUNCTION pg_temp.fee(p_cfg text, p_op text DEFAULT '38a001', p_basis text DEFAULT 'TOPUP_AMOUNT',
                           p_ben text DEFAULT 'OPE_FRAIS')
RETURNS void LANGUAGE sql AS $$
  INSERT INTO fee_rule (operator_id, scope_type, scope_id, payer_purpose, beneficiary_purpose,
                        basis, rate_bps, trigger, valid_from)
  VALUES (CASE WHEN p_op = 'NULL' THEN NULL ELSE pg_temp.id(p_op) END, 'PSP_CONFIGURATION', pg_temp.k(p_cfg), 'WALLET_PAID', p_ben,
          p_basis, 0, 'REALTIME', clock_timestamp() - interval '1 day')
$$;
-- Demande (PENDING puis décision), comme l'API. p_dec NULL : laissée en attente.
CREATE FUNCTION pg_temp.req(p_id text, p_op text, p_action text, p_target uuid, p_payload jsonb,
                            p_by text, p_dec text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('app.operator_id', pg_temp.id(p_op)::text, true);
  INSERT INTO approval_request (id, operator_id, action, target_id, payload, requested_by)
  VALUES (pg_temp.id(p_id), pg_temp.id(p_op), p_action, p_target, p_payload, pg_temp.id(p_by));
  IF p_dec IS NOT NULL THEN
    PERFORM decide_approval_request(pg_temp.id(p_id), pg_temp.id(p_dec), true, NULL);
  END IF;
END $$;
-- Demande d'activation (ou de suspension) d'une configuration nommée.
CREATE FUNCTION pg_temp.preq(p_id text, p_cfg text, p_version int DEFAULT 1,
                             p_status text DEFAULT NULL, p_compliance text DEFAULT 'BCEAO-2026-001',
                             p_by text DEFAULT '38e003', p_dec text DEFAULT '38e002')
RETURNS void LANGUAGE sql AS $$
  SELECT pg_temp.req(p_id, '38a001', 'PSP_CONFIGURATION', pg_temp.k(p_cfg),
    jsonb_build_object('psp_configuration_id', pg_temp.k(p_cfg), 'version', p_version)
      || CASE WHEN p_status IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('status', p_status) END
      || CASE WHEN p_compliance IS NULL THEN '{}'::jsonb
              ELSE jsonb_build_object('compliance_ref', p_compliance) END,
    p_by, p_dec)
$$;
-- Activation complète d'une configuration (règle de frais, demande, activation) sous la session A.
CREATE FUNCTION pg_temp.quick(p_cfg text, p_req text, p_version int DEFAULT 1) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp.fee(p_cfg);
  PERFORM pg_temp.preq(p_req, p_cfg, p_version);
  PERFORM pg_temp.sa();
  PERFORM activate_psp_configuration(pg_temp.k(p_cfg), pg_temp.id(p_req));
END $$;

DROP ROLE IF EXISTS psp_probe;
CREATE ROLE psp_probe;

-- Aides propres à ce lot ---------------------------------------------------------------------------
CREATE FUNCTION pg_temp.t(n text) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT pg_temp.id('3870' || n) $$;
CREATE TEMP TABLE wl (name text PRIMARY KEY, id uuid NOT NULL);
CREATE FUNCTION pg_temp.wl(p text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM wl WHERE name = p $$;
CREATE FUNCTION pg_temp.st(p_n text) RETURNS text LANGUAGE sql AS
  $$ SELECT status FROM psp_topup WHERE psp_topup_id = pg_temp.t(p_n) $$;
-- Recharge de guichet (terminal aa01, personne e004), référence facultative.
CREATE FUNCTION pg_temp.mkt(n text, p_wallet text, p_method text, p_amount bigint,
                            p_ref text DEFAULT NULL) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp.sa();
  PERFORM create_psp_topup(pg_temp.t(n), pg_temp.wl(p_wallet), p_method, p_amount, 'DESK',
            pg_temp.id('38aa01'), pg_temp.id('38e004'), NULL, clock_timestamp() + interval '1 hour');
  IF p_ref IS NOT NULL THEN PERFORM mark_psp_topup_initiated(pg_temp.t(n), p_ref); END IF;
END $$;
-- Transaction TOPUP (ou autre type) de la recharge n : clé exacte par défaut.
CREATE FUNCTION pg_temp.mktx(n text, p_gross bigint, p_fee bigint, p_key text DEFAULT NULL,
                             p_type text DEFAULT 'TOPUP', p_source text DEFAULT 'PSP_WEBHOOK')
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE t psp_topup%ROWTYPE; v_lines jsonb;
BEGIN
  SELECT * INTO t FROM psp_topup WHERE psp_topup_id = pg_temp.t(n);
  v_lines := jsonb_build_array(
    jsonb_build_object('account_id', (SELECT id FROM account WHERE ledger_id = t.ledger_id
                                       AND code = psp_account_code(t.method)), 'amount', p_gross),
    jsonb_build_object('account_id', (SELECT id FROM account WHERE wallet_id = t.wallet_id
                                       AND purpose = 'WALLET_PAID'), 'amount', -(p_gross - p_fee)));
  IF p_fee > 0 THEN
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('account_id',
      (SELECT id FROM account WHERE ledger_id = t.ledger_id AND code = 'L-OPE-FRAIS'),
      'amount', -p_fee));
  END IF;
  RETURN post_transaction(t.ledger_id, p_type,
    coalesce(p_key, psp_key_prefix(t.method) || ':' || t.psp_configuration_id || ':'
                    || t.provider_payment_ref),
    clock_timestamp(), p_source, v_lines, t.event_id);
END $$;
-- Crédit complet Wave / Orange Money de la recharge n (transaction puis complete_psp_topup).
CREATE FUNCTION pg_temp.pay(n text, p_fee bigint DEFAULT 0) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_amount bigint; v_tx uuid;
BEGIN
  PERFORM pg_temp.sa();
  SELECT amount INTO v_amount FROM psp_topup WHERE psp_topup_id = pg_temp.t(n);
  v_tx := pg_temp.mktx(n, v_amount, p_fee);
  PERFORM complete_psp_topup(pg_temp.t(n), v_tx, p_fee);
END $$;
-- Crédit complet par carte.
CREATE FUNCTION pg_temp.paycard(n text, p_fp text, p_fee bigint DEFAULT 0) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE v_amount bigint; v_tx uuid;
BEGIN
  PERFORM pg_temp.sa();
  SELECT amount INTO v_amount FROM psp_topup WHERE psp_topup_id = pg_temp.t(n);
  v_tx := pg_temp.mktx(n, v_amount, p_fee);
  PERFORM complete_card_topup(pg_temp.t(n), v_tx, p_fee, p_fp, 'SUCCEEDED');
END $$;
-- Insertion directe (propriétaire) d'une copie modifiée d'une recharge : code et message.
CREATE FUNCTION pg_temp.insx(p_base text, p_new text, p_over jsonb) RETURNS text LANGUAGE sql AS $$
  SELECT pg_temp.err(format($q$INSERT INTO psp_topup SELECT (jsonb_populate_record(t,
      %L::jsonb)).* FROM psp_topup t WHERE t.psp_topup_id = %L$q$,
      (jsonb_build_object('psp_topup_id', pg_temp.t(p_new)) || p_over)::text, pg_temp.t(p_base)))
$$;
-- Vieillit une recharge (déclencheurs désactivés dans la transaction).
CREATE FUNCTION pg_temp.age(n text, p_created interval, p_expires interval) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  ALTER TABLE psp_topup DISABLE TRIGGER psp_topup_transition_guard;
  UPDATE psp_topup SET created_at = clock_timestamp() - p_created,
         expires_at = clock_timestamp() - p_expires WHERE psp_topup_id = pg_temp.t(n);
  ALTER TABLE psp_topup ENABLE TRIGGER psp_topup_transition_guard;
END $$;
-- Demande d'approbation décidée (comme l'API).
CREATE FUNCTION pg_temp.wreq(p_id text, p_wallet uuid, p_by text, p_dec text,
                             p_action text DEFAULT 'WALLET_UNBLOCK', p_op text DEFAULT '38a001')
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('app.operator_id', pg_temp.id(p_op)::text, true);
  INSERT INTO approval_request (id, operator_id, action, target_id, payload, requested_by)
  VALUES (pg_temp.id(p_id), pg_temp.id(p_op), p_action, p_wallet,
          jsonb_build_object('wallet_id', p_wallet), pg_temp.id(p_by));
  IF p_dec IS NOT NULL THEN
    PERFORM decide_approval_request(pg_temp.id(p_id), pg_temp.id(p_dec), true, NULL);
  END IF;
  PERFORM pg_temp.sa();
END $$;

-- Données complémentaires -----------------------------------------------------------------------
INSERT INTO party (id, kind, operator_id, legal_name) VALUES
 (pg_temp.id('38b201'), 'CUSTOMER', pg_temp.id('38a001'), 'Festivalier 1'),
 (pg_temp.id('38b202'), 'CUSTOMER', pg_temp.id('38a001'), 'Festivalier 2');
INSERT INTO device (id, operator_id, kind, app_mode, serial) VALUES
 (pg_temp.id('38aa01'), pg_temp.id('38a001'), 'POS', 'TOPUP_DESK', 'D38-A01'),
 (pg_temp.id('38aa02'), pg_temp.id('38a001'), 'POS', 'CATALOG_POS', 'D38-A02'),
 (pg_temp.id('38aa03'), pg_temp.id('38a001'), 'POS', 'TOPUP_DESK', 'D38-A03'),
 (pg_temp.id('38ab01'), pg_temp.id('38a002'), 'POS', 'TOPUP_DESK', 'D38-B01');
UPDATE device SET status = 'SUSPENDED' WHERE id = pg_temp.id('38aa03');
-- Configurations actives de A (organisateur b001, événement d001) et de B (insertion directe).
SELECT pg_temp.sa();
SELECT pg_temp.mk('wave1', '38b001', 'WAVE', 'WAVE', '38b001', true);
SELECT pg_temp.mk('om1', '38b001', 'ORANGE_MONEY', 'ORANGE_MONEY', '38b001', true);
SELECT pg_temp.mk('card1', '38b001', 'CARD', 'PAYDUNYA', '38b001', true);
SELECT pg_temp.quick('wave1', '38ee01');
SELECT pg_temp.quick('om1', '38ee02');
SELECT pg_temp.quick('card1', '38ee03');
INSERT INTO psp_configuration (psp_configuration_id, operator_id, organizer_id, method, provider,
    holder_party_id, secret_ref, status, valid_from, created_by, approved_by, compliance_ref,
    activated_at, is_default)
VALUES (pg_temp.id('38ca01'), pg_temp.id('38a002'), pg_temp.id('38b011'), 'WAVE', 'WAVE',
        pg_temp.id('38b011'), 'psp/' || pg_temp.id('38b011') || '/bwave', 'ACTIVE',
        clock_timestamp() - interval '2 days', pg_temp.id('38e011'), pg_temp.id('38e012'),
        'BCEAO-B-1', clock_timestamp(), true);
-- Portefeuilles : w1 (client c1), w2 (client c2), wp1..wp8 (anonymes), wc1..wc12 (cartes et
-- contestations), wd002 (événement sans configuration), wd003 (futur CLOSING), wB (prestataire B).
SELECT pg_temp.sa();
INSERT INTO wl VALUES ('w1', open_event_wallet(pg_temp.id('38d001'), pg_temp.id('38b201'))),
                      ('w2', open_event_wallet(pg_temp.id('38d001'), pg_temp.id('38b202')));
INSERT INTO wl SELECT 'wp' || i, open_event_wallet(pg_temp.id('38d001')) FROM generate_series(1, 8) i;
INSERT INTO wl SELECT 'wc' || i, open_event_wallet(pg_temp.id('38d001')) FROM generate_series(1, 12) i;
INSERT INTO wl VALUES ('wd002', open_event_wallet(pg_temp.id('38d002'))),
                      ('wd003', open_event_wallet(pg_temp.id('38d003')));
SELECT pg_temp.sb();
INSERT INTO wl VALUES ('wB', open_event_wallet(pg_temp.id('38d011')));
SELECT pg_temp.sa();

-- 1. Structure ------------------------------------------------------------------------------------
SELECT is((SELECT count(*)::int FROM pg_class
            WHERE relname IN ('psp_topup','psp_event','psp_chargeback','psp_webhook_rejection')
              AND relrowsecurity AND relforcerowsecurity), 4, 'RLS activée et forcée sur les quatre tables');
SELECT is((SELECT count(*)::int FROM pg_policies
            WHERE tablename IN ('psp_topup','psp_event','psp_chargeback')
              AND policyname = 'tenant_isolation'), 3, 'tenant_isolation sur les trois tables à prestataire');
SELECT is((SELECT count(*)::int FROM pg_policies WHERE tablename = 'psp_webhook_rejection'
              AND cmd = 'SELECT'), 1, 'compteur de refus : une seule politique, en lecture');
SELECT is((SELECT count(*)::int FROM pg_constraint WHERE conrelid = 'psp_topup'::regclass
              AND contype = 'c'), 17, 'psp_topup : dix-sept contraintes CHECK nommées');
SELECT is((SELECT count(*)::int FROM pg_indexes WHERE indexname IN
            ('psp_topup_payment_ref','psp_topup_one_tx','psp_chargeback_one_tx')
              AND indexdef LIKE '%UNIQUE%'), 3, 'index uniques : référence de paiement, une transaction par recharge');
SELECT is((SELECT string_agg(c.relname || ':' || p.proname, ' ' ORDER BY c.relname, p.proname)
             FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid JOIN pg_class c ON c.oid = t.tgrelid
            WHERE NOT t.tgisinternal AND c.relname LIKE 'psp\_%'),
  'psp_chargeback:psp_chargeback_cap psp_chargeback:psp_chargeback_guard '
  'psp_configuration:psp_configuration_immutable psp_event:psp_event_guard '
  'psp_topup:psp_topup_transition_guard', 'déclencheurs : automate, ajout seul, plafond, immuabilité');
SELECT is((SELECT count(*)::int FROM pg_proc WHERE pronamespace = 'public'::regnamespace
            AND proname IN ('create_psp_topup','mark_psp_topup_initiated','cancel_psp_topup',
              'expire_psp_topups','psp_poll_candidates','record_psp_event','mark_psp_event',
              'psp_events_to_retry','purge_psp_event_bodies','read_psp_event_body',
              'complete_psp_topup','complete_card_topup','fail_psp_topup','card_topups_today',
              'wallet_card_count','record_webhook_rejection','record_chargeback',
              'attach_chargeback_tx','block_wallet_after_chargeback','unblock_wallet',
              'psp_session_operator','psp_key_prefix','psp_topup_net_credited',
              'psp_complete_core','psp_topup_replay_row','psp_topup_transition_guard',
              'psp_event_guard','psp_chargeback_cap','psp_chargeback_guard')
            AND proconfig @> ARRAY['search_path=public, pg_temp']), 29,
  'vingt-neuf fonctions du lot : search_path = public, pg_temp');
SELECT is((SELECT count(*)::int FROM pg_proc WHERE pronamespace = 'public'::regnamespace
            AND prosecdef AND proname IN ('create_psp_topup','mark_psp_topup_initiated',
              'cancel_psp_topup','expire_psp_topups','psp_poll_candidates','record_psp_event',
              'mark_psp_event','psp_events_to_retry','purge_psp_event_bodies','read_psp_event_body',
              'complete_psp_topup','complete_card_topup','fail_psp_topup','card_topups_today',
              'wallet_card_count','record_webhook_rejection','record_chargeback',
              'attach_chargeback_tx','block_wallet_after_chargeback','unblock_wallet')), 20,
  'les vingt fonctions appelables sont SECURITY DEFINER');
SELECT is((SELECT count(*)::int FROM pg_proc p WHERE pronamespace = 'public'::regnamespace
            AND proname IN ('create_psp_topup','mark_psp_topup_initiated','cancel_psp_topup',
              'expire_psp_topups','psp_poll_candidates','record_psp_event','mark_psp_event',
              'psp_events_to_retry','purge_psp_event_bodies','read_psp_event_body',
              'complete_psp_topup','complete_card_topup','fail_psp_topup','card_topups_today',
              'wallet_card_count','record_webhook_rejection','record_chargeback',
              'attach_chargeback_tx','block_wallet_after_chargeback','unblock_wallet',
              'psp_session_operator','psp_key_prefix','psp_topup_net_credited',
              'psp_complete_core','psp_topup_replay_row','psp_topup_transition_guard',
              'psp_event_guard','psp_chargeback_cap','psp_chargeback_guard')
              AND has_function_privilege('psp_probe', p.oid, 'EXECUTE')), 0,
  'aucune fonction du lot n''est exécutable par PUBLIC');
SELECT is((SELECT count(*)::int FROM pg_proc WHERE proname IN ('psp_poll_candidates',
            'psp_events_to_retry','purge_psp_event_bodies','record_webhook_rejection')
            AND (pg_get_function_result(oid) ILIKE '%secret%' OR pg_get_function_result(oid) ILIKE '%body bytea%'
                 OR pg_get_function_result(oid) ILIKE '%bytea%')), 0,
  'fonctions neutres : aucune colonne secrète ni corps dans leur résultat');

-- 2. Création (T018) ------------------------------------------------------------------------------
SELECT pg_temp.sa();
SELECT pg_temp.mkt('01', 'wp1', 'WAVE', 10000);
SELECT is((SELECT status || ':' || coalesce(fee_amount::text, 'nul') || ':' || currency
             FROM psp_topup WHERE psp_topup_id = pg_temp.t('01')), 'PENDING:nul:XOF',
  'création : PENDING, frais nul, devise du grand livre');
SELECT is((SELECT replayed FROM create_psp_topup(pg_temp.t('01'), pg_temp.wl('wp1'), 'WAVE', 10000,
    'DESK', pg_temp.id('38aa01'), pg_temp.id('38e004'), NULL, clock_timestamp() + interval '1 hour')),
  true, 'rejeu du même identifiant et du même contenu : replayed = true');
SELECT is((SELECT count(*)::int FROM psp_topup WHERE psp_topup_id = pg_temp.t('01')), 1,
  'rejeu : toujours une seule ligne');
SELECT is(pg_temp.code(format($$SELECT create_psp_topup(%L, %L, 'WAVE', 10001, 'DESK', %L, %L, NULL,
    clock_timestamp() + interval '1 hour')$$, pg_temp.t('01'), pg_temp.wl('wp1'),
    pg_temp.id('38aa01'), pg_temp.id('38e004'))), 'CL029', 'même identifiant, autre montant : CL029');
SELECT pg_temp.sb();
SELECT is(pg_temp.code(format($$SELECT create_psp_topup(%L, %L, 'WAVE', 10000, 'DESK', %L, %L, NULL,
    clock_timestamp() + interval '1 hour')$$, pg_temp.t('01'), pg_temp.wl('wB'),
    pg_temp.id('38ab01'), pg_temp.id('38e011'))), 'CL029',
  'identifiant d''un autre prestataire : CL029 sans révéler l''existence');
SELECT pg_temp.sa();
SELECT is(pg_temp.code(format($$SELECT create_psp_topup(NULL, %L, 'WAVE', 10000, 'DESK', %L, %L, NULL,
    clock_timestamp() + interval '1 hour')$$, pg_temp.wl('wp2'), pg_temp.id('38aa01'),
    pg_temp.id('38e004'))), 'CL001', 'identifiant nul : CL001');
-- Refus de portefeuille, grand livre, montant, échéance, configuration.
UPDATE wallet SET status = 'BLOCKED' WHERE id = pg_temp.wl('wp8');
UPDATE wallet SET status = 'CLOSED' WHERE id = pg_temp.wl('wc12');
SELECT is(pg_temp.code(format($$SELECT create_psp_topup(%L, %L, 'WAVE', 10000, 'DESK', %L, %L, NULL,
    clock_timestamp() + interval '1 hour')$$, pg_temp.t('f1'), pg_temp.wl('wp8'),
    pg_temp.id('38aa01'), pg_temp.id('38e004'))), 'CL039', 'portefeuille BLOCKED : CL039');
SELECT is(pg_temp.code(format($$SELECT create_psp_topup(%L, %L, 'WAVE', 10000, 'DESK', %L, %L, NULL,
    clock_timestamp() + interval '1 hour')$$, pg_temp.t('f2'), pg_temp.wl('wc12'),
    pg_temp.id('38aa01'), pg_temp.id('38e004'))), 'CL039', 'portefeuille CLOSED : CL039');
UPDATE ledger SET status = 'CLOSING' WHERE scope_type = 'EVENT' AND scope_id = pg_temp.id('38d003');
SELECT is(pg_temp.code(format($$SELECT create_psp_topup(%L, %L, 'WAVE', 10000, 'DESK', %L, %L, NULL,
    clock_timestamp() + interval '1 hour')$$, pg_temp.t('f3'), pg_temp.wl('wd003'),
    pg_temp.id('38aa01'), pg_temp.id('38e004'))), 'CL004', 'grand livre CLOSING : CL004');
SELECT is(pg_temp.code(format($$SELECT create_psp_topup(%L, %L, 'WAVE', 0, 'DESK', %L, %L, NULL,
    clock_timestamp() + interval '1 hour')$$, pg_temp.t('f4'), pg_temp.wl('wp2'),
    pg_temp.id('38aa01'), pg_temp.id('38e004'))), 'CL001', 'montant nul : CL001');
SELECT is(pg_temp.code(format($$SELECT create_psp_topup(%L, %L, 'WAVE', 100, 'DESK', %L, %L, NULL,
    clock_timestamp() - interval '1 minute')$$, pg_temp.t('f5'), pg_temp.wl('wp2'),
    pg_temp.id('38aa01'), pg_temp.id('38e004'))), 'CL001', 'échéance passée : CL001');
SELECT is(pg_temp.code(format($$SELECT create_psp_topup(%L, %L, 'WAVE', 100, 'DESK', %L, %L, NULL,
    clock_timestamp() + interval '8 days')$$, pg_temp.t('f6'), pg_temp.wl('wp2'),
    pg_temp.id('38aa01'), pg_temp.id('38e004'))), 'CL001', 'échéance au-delà de 7 jours : CL001');
SELECT is(pg_temp.code(format($$SELECT create_psp_topup(%L, %L, 'WAVE', 100, 'DESK', %L, %L, NULL,
    clock_timestamp() + interval '1 hour')$$, pg_temp.t('f7'), pg_temp.wl('wd002'),
    pg_temp.id('38aa01'), pg_temp.id('38e004'))), 'CL042', 'événement sans configuration : CL042');
SELECT is(pg_temp.code(format($$SELECT create_psp_topup(%L, %L, 'BOGUS', 100, 'DESK', %L, %L, NULL,
    clock_timestamp() + interval '1 hour')$$, pg_temp.t('f8'), pg_temp.wl('wp2'),
    pg_temp.id('38aa01'), pg_temp.id('38e004'))), 'CL001', 'moyen inconnu : CL001');
-- Demandeur.
SELECT is(pg_temp.code(format($$SELECT create_psp_topup(%L, %L, 'WAVE', 100, 'DESK', %L, %L, NULL,
    clock_timestamp() + interval '1 hour')$$, pg_temp.t('f9'), pg_temp.wl('wp2'),
    pg_temp.id('38aa02'), pg_temp.id('38e004'))), 'CL001', 'terminal d''un autre mode : CL001');
SELECT is(pg_temp.code(format($$SELECT create_psp_topup(%L, %L, 'WAVE', 100, 'DESK', %L, %L, NULL,
    clock_timestamp() + interval '1 hour')$$, pg_temp.t('fa'), pg_temp.wl('wp2'),
    pg_temp.id('38aa03'), pg_temp.id('38e004'))), 'CL001', 'terminal suspendu : CL001');
SELECT is(pg_temp.code(format($$SELECT create_psp_topup(%L, %L, 'WAVE', 100, 'DESK', %L, %L, NULL,
    clock_timestamp() + interval '1 hour')$$, pg_temp.t('fb'), pg_temp.wl('wp2'),
    pg_temp.id('38ab01'), pg_temp.id('38e004'))), 'P0002', 'terminal d''un autre prestataire : P0002');
SELECT is(pg_temp.code(format($$SELECT create_psp_topup(%L, %L, 'WAVE', 100, 'DESK', %L, %L, NULL,
    clock_timestamp() + interval '1 hour')$$, pg_temp.t('fc'), pg_temp.wl('wp2'),
    pg_temp.id('38aa01'), pg_temp.id('38e011'))), 'P0002', 'personne d''un autre prestataire : P0002');
SELECT is(pg_temp.code(format($$SELECT create_psp_topup(%L, %L, 'WAVE', 100, 'DESK', %L, NULL, NULL,
    clock_timestamp() + interval '1 hour')$$, pg_temp.t('fd'), pg_temp.wl('wp2'),
    pg_temp.id('38aa01'))), 'CL001', 'guichet sans personne : CL001');
SELECT is(pg_temp.code(format($$SELECT create_psp_topup(%L, %L, 'WAVE', 100, 'BOGUS', NULL, NULL, NULL,
    clock_timestamp() + interval '1 hour')$$, pg_temp.t('fe'), pg_temp.wl('wp2'))), 'CL001',
  'demandeur inconnu : CL001');
SELECT is((SELECT replayed FROM create_psp_topup(pg_temp.t('02'), pg_temp.wl('w1'), 'CARD', 5000,
    'CUSTOMER', NULL, NULL, pg_temp.id('38b201'), clock_timestamp() + interval '1 hour')), false,
  'client : crée une recharge pour son portefeuille');
SELECT is(pg_temp.code(format($$SELECT create_psp_topup(%L, %L, 'CARD', 5000, 'CUSTOMER', NULL, NULL, %L,
    clock_timestamp() + interval '1 hour')$$, pg_temp.t('ff'), pg_temp.wl('w1'),
    pg_temp.id('38b202'))), 'P0002', 'client d''un autre portefeuille : P0002');
SELECT is(pg_temp.code(format($$SELECT create_psp_topup(%L, %L, 'CARD', 5000, 'CUSTOMER', NULL, NULL, NULL,
    clock_timestamp() + interval '1 hour')$$, pg_temp.t('f0'), pg_temp.wl('w1'))), 'CL001',
  'client sans identité : CL001');
-- Bornes (A25) : 3 par portefeuille, 20 par terminal.
SELECT pg_temp.mkt('03', 'wp1', 'WAVE', 100);
SELECT pg_temp.mkt('04', 'wp1', 'WAVE', 100);
SELECT is(pg_temp.code(format($$SELECT create_psp_topup(%L, %L, 'WAVE', 100, 'DESK', %L, %L, NULL,
    clock_timestamp() + interval '1 hour')$$, pg_temp.t('05'), pg_temp.wl('wp1'),
    pg_temp.id('38aa01'), pg_temp.id('38e004'))), 'CL029', '4e recharge en attente d''un portefeuille : CL029');
DO $$
DECLARE i int; j int;
BEGIN
  -- wp1 : 3 ; wp2..wp6 : 15 => 18 ; wp7 : 2 => 20.
  FOR i IN 2..6 LOOP FOR j IN 1..3 LOOP
    PERFORM pg_temp.mkt('1' || i || j, 'wp' || i, 'WAVE', 100);
  END LOOP; END LOOP;
  PERFORM pg_temp.mkt('171', 'wp7', 'WAVE', 100);
  PERFORM pg_temp.mkt('172', 'wp7', 'WAVE', 100);
END $$;
SELECT is((SELECT count(*)::int FROM psp_topup WHERE device_id = pg_temp.id('38aa01')
            AND status = 'PENDING'), 20, 'vingt recharges en attente sur le terminal');
SELECT is(pg_temp.code(format($$SELECT create_psp_topup(%L, %L, 'WAVE', 100, 'DESK', %L, %L, NULL,
    clock_timestamp() + interval '1 hour')$$, pg_temp.t('173'), pg_temp.wl('wp7'),
    pg_temp.id('38aa01'), pg_temp.id('38e004'))), 'CL029', '21e recharge en attente du terminal : CL029');
SELECT pg_temp.nosession();
SELECT is(pg_temp.code(format($$SELECT create_psp_topup(%L, %L, 'WAVE', 100, 'DESK', %L, %L, NULL,
    clock_timestamp() + interval '1 hour')$$, pg_temp.t('174'), pg_temp.wl('wp7'),
    pg_temp.id('38aa01'), pg_temp.id('38e004'))), 'P0002', 'sans prestataire de session : P0002');
SELECT pg_temp.sa();
-- Libère le terminal pour la suite.
UPDATE psp_topup SET status = 'CANCELLED', failure_reason = 'CANCELLED' WHERE status = 'PENDING';

-- mark_psp_topup_initiated
SELECT pg_temp.mkt('20', 'wc1', 'WAVE', 5000);
SELECT lives_ok(format($$SELECT mark_psp_topup_initiated(%L, 'REF-20')$$, pg_temp.t('20')),
  'initiation : pose la référence');
SELECT lives_ok(format($$SELECT mark_psp_topup_initiated(%L, 'REF-20')$$, pg_temp.t('20')),
  'initiation : même référence, sans effet');
SELECT is(pg_temp.code(format($$SELECT mark_psp_topup_initiated(%L, 'REF-20B')$$, pg_temp.t('20'))),
  'CL029', 'initiation : autre référence refusée');
SELECT pg_temp.mkt('21', 'wc1', 'WAVE', 5000);
SELECT is(pg_temp.code(format($$SELECT mark_psp_topup_initiated(%L, 'REF-20')$$, pg_temp.t('21'))),
  'CL029', 'initiation : doublon de référence dans la même configuration : CL029');
SELECT pg_temp.mkt('22', 'wc1', 'CARD', 5000);
SELECT lives_ok(format($$SELECT mark_psp_topup_initiated(%L, 'REF-20')$$, pg_temp.t('22')),
  'initiation : même référence dans une autre configuration acceptée');
SELECT is(pg_temp.code(format($$SELECT mark_psp_topup_initiated(%L, 'a b')$$, pg_temp.t('21'))),
  'CL001', 'initiation : référence avec espace : CL001');
SELECT is(pg_temp.code(format($$SELECT mark_psp_topup_initiated(%L, %L)$$, pg_temp.t('21'),
  repeat('x', 201))), 'CL001', 'initiation : référence de 201 caractères : CL001');
SELECT is(pg_temp.code(format($$SELECT mark_psp_topup_initiated(%L, 'REF-X', clock_timestamp() - interval '1 minute')$$,
  pg_temp.t('21'))), 'CL001', 'initiation : échéance passée : CL001');
SELECT lives_ok(format($$SELECT mark_psp_topup_initiated(%L, 'REF-21', clock_timestamp() + interval '2 hours')$$,
  pg_temp.t('21')), 'initiation : échéance de l''adaptateur acceptée');

-- cancel_psp_topup
SELECT is(cancel_psp_topup(pg_temp.t('21')), 'CANCELLED', 'annulation : PENDING -> CANCELLED');
SELECT is((SELECT failure_reason FROM psp_topup WHERE psp_topup_id = pg_temp.t('21')), 'CANCELLED',
  'annulation : motif CANCELLED');
SELECT is(cancel_psp_topup(pg_temp.t('21')), 'CANCELLED', 'annulation : déjà annulée, sans écriture');

-- expire_psp_topups
SELECT pg_temp.mkt('23', 'wc2', 'WAVE', 5000, 'REF-23');
SELECT is(expire_psp_topups(ARRAY[pg_temp.t('23')]), 0, 'expiration avant l''échéance : rien');
SELECT pg_temp.age('23', interval '1 hour', interval '1 minute');
SELECT is(expire_psp_topups(ARRAY[pg_temp.t('23'), pg_temp.t('21')]), 1,
  'expiration après l''échéance : une recharge (l''annulée est ignorée)');
SELECT is(pg_temp.st('23') || ':' || pg_temp.st('21'), 'EXPIRED:CANCELLED', 'états après expiration');
SELECT is(pg_temp.code(format($$SELECT expire_psp_topups(ARRAY(SELECT %L::uuid FROM generate_series(1, 501)))$$,
  pg_temp.t('23'))), 'CL001', 'expiration : plus de 500 identifiants : CL001');
SELECT pg_temp.mkt('24', 'wc2', 'WAVE', 5000, 'REF-24');
SELECT pg_temp.age('24', interval '1 hour', interval '1 minute');
SELECT pg_temp.pay('24');
SELECT is(expire_psp_topups(ARRAY[pg_temp.t('24')]), 0, 'expiration : une recharge payée entre-temps est ignorée');
SELECT is(pg_temp.st('24'), 'SUCCEEDED', 'recharge payée : toujours SUCCEEDED');

-- psp_poll_candidates : neutre, sans filtre de configuration (A15)
SELECT pg_temp.mkt('25', 'wc2', 'WAVE', 5000, 'REF-25');
SELECT is((SELECT count(*)::int FROM psp_poll_candidates(500) WHERE psp_topup_id = pg_temp.t('25')), 0,
  'interrogation : une recharge récente n''est pas listée');
SELECT pg_temp.age('25', interval '3 minutes', interval '-1 hour');
UPDATE psp_configuration SET status = 'SUSPENDED' WHERE psp_configuration_id = pg_temp.k('wave1');
SELECT pg_temp.nosession();
SELECT is((SELECT count(*)::int FROM psp_poll_candidates(500) WHERE psp_topup_id = pg_temp.t('25')), 1,
  'interrogation : listée sans prestataire de session, configuration suspendue comprise');
SELECT is((SELECT expired FROM psp_poll_candidates(500) WHERE psp_topup_id = pg_temp.t('25')), false,
  'interrogation : expired = faux avant l''échéance');
SELECT is(pg_temp.code('SELECT psp_poll_candidates(0)') || pg_temp.code('SELECT psp_poll_candidates(501)'),
  'CL001CL001', 'interrogation : limite hors de 1 à 500 : CL001');
SELECT pg_temp.sa();
UPDATE psp_configuration SET status = 'ACTIVE' WHERE psp_configuration_id = pg_temp.k('wave1');

-- 3. Automate et crédit ---------------------------------------------------------------------------
-- PENDING -> SUCCEEDED, avec frais.
SELECT pg_temp.mkt('30', 'wc3', 'WAVE', 20000, 'REF-30');
SELECT pg_temp.pay('30', 500);
SELECT is((SELECT status || ':' || fee_amount || ':' || (topup_tx_id IS NOT NULL) || ':' || (succeeded_at IS NOT NULL)
             FROM psp_topup WHERE psp_topup_id = pg_temp.t('30')), 'SUCCEEDED:500:true:true',
  'PENDING -> SUCCEEDED : frais, transaction et date posés');
SELECT is((SELECT fee_amount FROM psp_topup WHERE psp_topup_id = pg_temp.t('30')), 500::bigint, 'frais posé');
-- Rejeu de la même complétion : sans effet ; autre transaction : CL029.
SELECT lives_ok(format($$SELECT complete_psp_topup(%L, %L, 500)$$, pg_temp.t('30'),
  (SELECT topup_tx_id FROM psp_topup WHERE psp_topup_id = pg_temp.t('30'))), 'rejeu de la même complétion : sans effet');
SELECT is(pg_temp.code(format($$SELECT complete_psp_topup(%L, %L, 500)$$, pg_temp.t('30'),
  pg_temp.mktx('30', 20000, 500, 'wave:' || (SELECT psp_configuration_id FROM psp_topup
     WHERE psp_topup_id = pg_temp.t('30')) || ':REF-30B'))), 'CL029',
  'SUCCEEDED + autre transaction : CL029 (aucun double crédit)');
-- PENDING -> FAILED.
SELECT pg_temp.mkt('31', 'wc3', 'WAVE', 20000, 'REF-31');
SELECT is(fail_psp_topup(pg_temp.t('31'), 'PSP_FAILED', false), NULL::uuid,
  'PENDING -> FAILED sans argent encaissé : aucune anomalie');
SELECT is(pg_temp.st('31'), 'FAILED', 'état FAILED');
-- PENDING -> CANCELLED / EXPIRED.
SELECT pg_temp.mkt('32', 'wc3', 'WAVE', 20000, 'REF-32');
SELECT is(cancel_psp_topup(pg_temp.t('32')), 'CANCELLED', 'PENDING -> CANCELLED');
SELECT pg_temp.mkt('33', 'wc4', 'WAVE', 20000, 'REF-33');
SELECT pg_temp.age('33', interval '1 hour', interval '1 minute');
SELECT is(expire_psp_topups(ARRAY[pg_temp.t('33')]), 1, 'PENDING -> EXPIRED');
-- Succès tardifs : FAILED (avec anomalie fermée), EXPIRED, CANCELLED.
SELECT pg_temp.mkt('34', 'wc4', 'WAVE', 20000, 'REF-34');
SELECT isnt(fail_psp_topup(pg_temp.t('34'), 'WALLET_LIMIT', true), NULL::uuid,
  'FAILED après paiement : anomalie ouverte');
SELECT is(fail_psp_topup(pg_temp.t('34'), 'WALLET_LIMIT', true),
          (SELECT anomaly_id FROM psp_topup WHERE psp_topup_id = pg_temp.t('34')),
  'FAILED : seconde demande, même anomalie');
SELECT is((SELECT count(*)::int FROM anomaly WHERE kind = 'PSP_TOPUP_NOT_CREDITED'
            AND ledger_id = (SELECT ledger_id FROM psp_topup WHERE psp_topup_id = pg_temp.t('34'))
            AND amount = 20000), 1, 'une seule anomalie par recharge payée');
SELECT is((SELECT status FROM anomaly WHERE id = (SELECT anomaly_id FROM psp_topup
            WHERE psp_topup_id = pg_temp.t('34'))), 'OPEN', 'anomalie OPEN');
CREATE TEMP TABLE an AS SELECT anomaly_id AS id FROM psp_topup WHERE psp_topup_id = pg_temp.t('34');
SELECT pg_temp.pay('34');
SELECT is(pg_temp.st('34'), 'SUCCEEDED', 'succès tardif sur FAILED : crédité');
SELECT is((SELECT a.status || ':' || (a.resolution_tx_id = t.topup_tx_id) || ':' || (t.anomaly_id IS NULL)
             FROM anomaly a, psp_topup t WHERE a.id = (SELECT id FROM an) AND t.psp_topup_id = pg_temp.t('34')),
  'RESOLVED:true:true', 'anomalie fermée avec la transaction de crédit, anomaly_id vidé');
SELECT pg_temp.pay('33');
SELECT is(pg_temp.st('33'), 'SUCCEEDED', 'succès tardif sur EXPIRED : crédité');
SELECT pg_temp.pay('32');
SELECT is(pg_temp.st('32'), 'SUCCEEDED', 'succès tardif sur CANCELLED : crédité (R-20 prime sur le contrat)');
-- Cellules refusées.
SELECT pg_temp.mkt('35', 'wc5', 'WAVE', 20000, 'REF-35');
SELECT fail_psp_topup(pg_temp.t('35'), 'PSP_FAILED', false);
SELECT is(pg_temp.code(format($$SELECT cancel_psp_topup(%L)$$, pg_temp.t('35'))), 'CL029', 'FAILED -> annulation : CL029');
SELECT is(expire_psp_topups(ARRAY[pg_temp.t('35')]), 0, 'FAILED -> expiration : sans effet');
SELECT is(pg_temp.code(format($$UPDATE psp_topup SET status = 'EXPIRED', failure_reason = 'EXPIRED'
    WHERE psp_topup_id = %L$$, pg_temp.t('35'))), 'CL029', 'FAILED -> EXPIRED en écriture directe : CL029');
SELECT is(pg_temp.code(format($$SELECT cancel_psp_topup(%L)$$, pg_temp.t('33'))), 'CL029', 'SUCCEEDED -> annulation : CL029');
SELECT is(pg_temp.code(format($$SELECT fail_psp_topup(%L, 'PSP_FAILED', true)$$, pg_temp.t('33'))), 'CL029',
  'SUCCEEDED -> échec : CL029');
SELECT is(pg_temp.code(format($$UPDATE psp_topup SET status = 'FAILED', failure_reason = 'PSP_FAILED',
    topup_tx_id = NULL, fee_amount = NULL, succeeded_at = NULL WHERE psp_topup_id = %L$$, pg_temp.t('33'))),
  'CL029', 'SUCCEEDED est définitif en écriture directe');
SELECT is(pg_temp.code(format($$UPDATE psp_topup SET amount = 1 WHERE psp_topup_id = %L$$, pg_temp.t('35'))),
  'CL001', 'colonne d''identité non modifiable');
SELECT is(pg_temp.code(format($$DELETE FROM psp_topup WHERE psp_topup_id = %L$$, pg_temp.t('35'))),
  'CL001', 'suppression refusée');
-- Frais et cohérence.
SELECT pg_temp.mkt('36', 'wc5', 'WAVE', 20000, 'REF-36');
SELECT is(pg_temp.code(format($$UPDATE psp_topup SET status = 'SUCCEEDED' WHERE psp_topup_id = %L$$, pg_temp.t('36'))),
  '23514', 'CHECK statut / crédit : SUCCEEDED sans transaction refusé en écriture directe');
SELECT ok(pg_temp.err(format($$UPDATE psp_topup SET status = 'SUCCEEDED' WHERE psp_topup_id = %L$$, pg_temp.t('36')))
          LIKE '%psp_topup_status_credit%', 'c''est bien la contrainte psp_topup_status_credit');
SELECT is(pg_temp.code(format($$SELECT complete_psp_topup(%L, %L, 20000)$$, pg_temp.t('36'),
  pg_temp.mktx('36', 20000, 0, NULL))), 'CL001', 'frais égal au montant : CL001');
SELECT is(pg_temp.code(format($$SELECT complete_psp_topup(%L, NULL, 0)$$, pg_temp.t('36'))), 'CL001', 'transaction nulle : CL001');
-- Clés d'écriture et contrôle de la transaction.
SELECT pg_temp.mkt('37', 'wc5', 'WAVE', 20000, 'REF-37');
SELECT is(pg_temp.code(format($$SELECT complete_psp_topup(%L, %L, 0)$$, pg_temp.t('37'),
  pg_temp.mktx('37', 20000, 0, 'om:' || (SELECT psp_configuration_id FROM psp_topup
    WHERE psp_topup_id = pg_temp.t('37')) || ':REF-37'))), 'CL001', 'clé d''un autre moyen : refusée');
SELECT is(pg_temp.code(format($$SELECT complete_psp_topup(%L, %L, 0)$$, pg_temp.t('37'),
  pg_temp.mktx('37', 20000, 0, 'wave:' || pg_temp.k('om1') || ':REF-37'))), 'CL001',
  'clé d''une autre configuration : refusée');
SELECT pg_temp.mkt('38', 'wp3', 'WAVE', 20000, 'REF-38');
SELECT is(pg_temp.code(format($$SELECT complete_psp_topup(%L, %L, 0)$$, pg_temp.t('38'),
  pg_temp.mktx('38', 20000, 0, NULL, 'TOPUP_CASH'))), 'CL001', 'autre type de transaction : refusé');
SELECT pg_temp.mkt('39', 'wp3', 'WAVE', 20000, 'REF-39');
SELECT is(pg_temp.code(format($$SELECT complete_psp_topup(%L, %L, 0)$$, pg_temp.t('39'),
  pg_temp.mktx('39', 20000, 0, NULL, 'TOPUP', 'ONLINE'))), 'CL001', 'autre source : refusée');
SELECT pg_temp.mkt('3a', 'wp3', 'WAVE', 20000, 'REF-3A');
SELECT is(pg_temp.code(format($$SELECT complete_psp_topup(%L, %L, 0)$$, pg_temp.t('3a'),
  pg_temp.mktx('3a', 20001, 0))), 'CL001', 'montant brut faux : refusé');
SELECT pg_temp.mkt('3b', 'wp4', 'WAVE', 20000, 'REF-3B');
SELECT is(pg_temp.code(format($$SELECT complete_psp_topup(%L, %L, 0)$$, pg_temp.t('3b'),
  pg_temp.mktx('3a', 20000, 0, 'wave:' || (SELECT psp_configuration_id FROM psp_topup
    WHERE psp_topup_id = pg_temp.t('3b')) || ':REF-3B'))), 'CL001',
  'transaction posée sur le portefeuille d''une autre recharge : refusée');
SELECT pg_temp.sb();
SELECT is(pg_temp.code(format($$SELECT complete_psp_topup(%L, %L, 0)$$, pg_temp.t('37'), pg_temp.t('37'))),
  'P0002', 'recharge d''un autre prestataire : P0002');
SELECT pg_temp.sa();
SELECT is(pg_temp.st('37'), 'PENDING', 'aucune de ces tentatives n''a crédité la recharge');

-- 4. Notifications (T019) -------------------------------------------------------------------------
SELECT is((SELECT duplicate FROM record_psp_event(pg_temp.k('wave1'), 'EV-1', 'PAYMENT_SUCCEEDED',
    '\x01'::bytea, '{"ref":"REF-37"}')), false, 'notification : première réception');
SELECT is((SELECT duplicate FROM record_psp_event(pg_temp.k('wave1'), 'EV-1', 'PAYMENT_SUCCEEDED',
    '\x02'::bytea, '{"ref":"autre"}')), true, 'notification : doublon rendu avec duplicate = true');
SELECT is((SELECT count(*)::int FROM psp_event WHERE provider_event_id = 'EV-1'), 1, 'doublon : une seule ligne');
SELECT is((SELECT status || ':' || attempts FROM psp_event WHERE provider_event_id = 'EV-1'), 'RECEIVED:0',
  'état initial RECEIVED, aucun essai');
SELECT is(pg_temp.code(format($$SELECT record_psp_event(%L, 'EV-BIG', 'UNKNOWN', %L, '{}')$$,
  pg_temp.k('wave1'), decode(repeat('00', 65537), 'hex'))), 'CL001', 'corps de 65 537 octets : refusé');
SELECT lives_ok(format($$SELECT record_psp_event(%L, 'EV-MAX', 'UNKNOWN', %L, '{}')$$,
  pg_temp.k('wave1'), decode(repeat('00', 65536), 'hex')), 'corps de 65 536 octets : accepté');
SELECT is(pg_temp.code(format($$SELECT record_psp_event(%L, 'EV-K', 'BOGUS', NULL, '{}')$$, pg_temp.k('wave1'))),
  'CL001', 'nature inconnue : CL001');
SELECT is(pg_temp.code(format($$SELECT record_psp_event(%L, 'EV-N', 'UNKNOWN', NULL, '[]')$$, pg_temp.k('wave1'))),
  'CL001', 'notification normalisée qui n''est pas un objet : CL001');
SELECT is(pg_temp.code(format($$SELECT record_psp_event(%L, '', 'UNKNOWN', NULL, '{}')$$, pg_temp.k('wave1'))),
  'CL001', 'identifiant vide : CL001');
UPDATE psp_configuration SET status = 'SUSPENDED' WHERE psp_configuration_id = pg_temp.k('om1');
SELECT is(pg_temp.code(format($$SELECT record_psp_event(%L, 'EV-S', 'UNKNOWN', NULL, '{}')$$, pg_temp.k('om1'))),
  'CL029', 'configuration suspendue : CL029');
UPDATE psp_configuration SET status = 'ACTIVE' WHERE psp_configuration_id = pg_temp.k('om1');
SELECT pg_temp.sb();
SELECT is(pg_temp.code(format($$SELECT record_psp_event(%L, 'EV-X', 'UNKNOWN', NULL, '{}')$$, pg_temp.k('wave1'))),
  'P0002', 'configuration d''un autre prestataire : P0002');
SELECT pg_temp.sa();
-- Ajout seul.
SELECT is(pg_temp.code(format($$UPDATE psp_event SET kind = 'UNKNOWN' WHERE provider_event_id = 'EV-1'$$)), 'CL001',
  'ajout seul : kind non modifiable');
SELECT is(pg_temp.code($$UPDATE psp_event SET provider_event_id = 'Z' WHERE provider_event_id = 'EV-1'$$), 'CL001',
  'ajout seul : identifiant non modifiable');
SELECT is(pg_temp.code($$UPDATE psp_event SET body = '\x09' WHERE provider_event_id = 'EV-1'$$), 'CL001',
  'ajout seul : le corps ne se remplace pas');
SELECT is(pg_temp.code($$DELETE FROM psp_event WHERE provider_event_id = 'EV-1'$$), 'CL001', 'ajout seul : pas de suppression');
SELECT is(pg_temp.code($$UPDATE psp_event SET signature_valid = false WHERE provider_event_id = 'EV-1'$$), 'CL001',
  'signature_valid non modifiable');
SELECT ok(pg_temp.err($$INSERT INTO psp_event (operator_id, psp_configuration_id, provider_event_id, kind,
    normalized, signature_valid) SELECT operator_id, psp_configuration_id, 'EV-SIG', 'UNKNOWN', '{}', false
    FROM psp_event LIMIT 1$$) LIKE '23514%psp_event_signature_valid%', 'CHECK : signature invalide jamais conservée');
-- mark_psp_event.
CREATE TEMP TABLE ev AS SELECT psp_event_id AS id FROM psp_event WHERE provider_event_id = 'EV-1';
SELECT lives_ok(format($$SELECT mark_psp_event(%L, 'RETRY')$$, (SELECT id FROM ev)), 'RETRY');
SELECT lives_ok(format($$SELECT mark_psp_event(%L, 'RETRY')$$, (SELECT id FROM ev)), 'RETRY encore');
SELECT is((SELECT attempts FROM psp_event WHERE psp_event_id = (SELECT id FROM ev)), 2, 'RETRY incrémente les essais');
SELECT lives_ok(format($$SELECT mark_psp_event(%L, 'UNMATCHED')$$, (SELECT id FROM ev)), 'UNMATCHED');
SELECT is((SELECT attempts FROM psp_event WHERE psp_event_id = (SELECT id FROM ev)), 2, 'UNMATCHED laisse les essais');
SELECT is(pg_temp.code(format($$SELECT mark_psp_event(%L, 'PROCESSED')$$, (SELECT id FROM ev))), 'CL001',
  'PROCESSED sans issue : CL001');
SELECT lives_ok(format($$SELECT mark_psp_event(%L, 'PROCESSED', 'CREDITED', %L)$$, (SELECT id FROM ev),
  pg_temp.t('30')), 'PROCESSED avec issue et recharge');
SELECT is((SELECT status || ':' || outcome || ':' || (processed_at IS NOT NULL) FROM psp_event
            WHERE psp_event_id = (SELECT id FROM ev)), 'PROCESSED:CREDITED:true', 'PROCESSED posé');
SELECT lives_ok(format($$SELECT mark_psp_event(%L, 'PROCESSED', 'CREDITED')$$, (SELECT id FROM ev)),
  'PROCESSED de même issue : sans effet');
SELECT is(pg_temp.code(format($$SELECT mark_psp_event(%L, 'PROCESSED', 'NO_EFFECT')$$, (SELECT id FROM ev))),
  'CL029', 'PROCESSED d''une autre issue : CL029');
SELECT is(pg_temp.code(format($$SELECT mark_psp_event(%L, 'RETRY')$$, (SELECT id FROM ev))), 'CL029',
  'PROCESSED est définitif');
SELECT is(pg_temp.code(format($$UPDATE psp_event SET status = 'RECEIVED', outcome = NULL, processed_at = NULL
    WHERE psp_event_id = %L$$, (SELECT id FROM ev))), 'CL029', 'PROCESSED définitif en écriture directe');
SELECT pg_temp.sb();
SELECT is(pg_temp.code(format($$SELECT mark_psp_event(%L, 'RETRY')$$, (SELECT id FROM ev))), 'P0002',
  'notification d''un autre prestataire : P0002');
SELECT pg_temp.sa();
-- psp_events_to_retry (neutre).
SELECT record_psp_event(pg_temp.k('wave1'), 'EV-R1', 'DISPUTE', NULL, '{"a":1}');
SELECT record_psp_event(pg_temp.k('wave1'), 'EV-R2', 'DISPUTE', NULL, '{"a":2}');
CREATE TEMP TABLE ev2 AS SELECT psp_event_id AS id, provider_event_id AS p FROM psp_event WHERE provider_event_id IN ('EV-R1','EV-R2');
SELECT mark_psp_event((SELECT id FROM ev2 WHERE p = 'EV-R2'), 'RETRY');
SELECT pg_temp.nosession();
SELECT is((SELECT count(*)::int FROM psp_events_to_retry(500) WHERE psp_event_id = (SELECT id FROM ev2 WHERE p = 'EV-R1')), 0,
  'reprise : RECEIVED de moins d''une minute non listé');
SELECT is((SELECT count(*)::int FROM psp_events_to_retry(500) WHERE psp_event_id = (SELECT id FROM ev2 WHERE p = 'EV-R2')), 1,
  'reprise : RETRY listé, sans prestataire de session');
SELECT is((SELECT exhausted FROM psp_events_to_retry(500) WHERE psp_event_id = (SELECT id FROM ev2 WHERE p = 'EV-R2')),
  false, 'reprise : non épuisé à un essai');
ALTER TABLE psp_event DISABLE TRIGGER psp_event_guard;
UPDATE psp_event SET received_at = clock_timestamp() - interval '2 minutes'
 WHERE psp_event_id = (SELECT id FROM ev2 WHERE p = 'EV-R1');
UPDATE psp_event SET attempts = 6 WHERE psp_event_id = (SELECT id FROM ev2 WHERE p = 'EV-R2');
ALTER TABLE psp_event ENABLE TRIGGER psp_event_guard;
SELECT is((SELECT count(*)::int FROM psp_events_to_retry(500) WHERE psp_event_id = (SELECT id FROM ev2 WHERE p = 'EV-R1')), 1,
  'reprise : RECEIVED de plus d''une minute listé');
SELECT is((SELECT exhausted FROM psp_events_to_retry(500) WHERE psp_event_id = (SELECT id FROM ev2 WHERE p = 'EV-R2')),
  true, 'reprise : plus de cinq essais = épuisé');
SELECT is(pg_temp.code('SELECT psp_events_to_retry(0)'), 'CL001', 'reprise : limite 0 : CL001');
SELECT pg_temp.sa();
-- Purge des corps.
SELECT record_psp_event(pg_temp.k('wave1'), 'EV-OLD', 'UNKNOWN', '\x0a0b'::bytea, '{}');
SELECT record_psp_event(pg_temp.k('wave1'), 'EV-NEW', 'UNKNOWN', '\x0a0c'::bytea, '{}');
ALTER TABLE psp_event DISABLE TRIGGER psp_event_guard;
UPDATE psp_event SET received_at = clock_timestamp() - interval '401 days' WHERE provider_event_id = 'EV-OLD';
UPDATE psp_event SET received_at = clock_timestamp() - interval '399 days' WHERE provider_event_id = 'EV-NEW';
ALTER TABLE psp_event ENABLE TRIGGER psp_event_guard;
SELECT is(pg_temp.code('SELECT purge_psp_event_bodies(364)'), 'CL001', 'purge : plancher de 365 jours');
SELECT pg_temp.nosession();
SELECT is(purge_psp_event_bodies(), 1::bigint, 'purge : exactement le corps de 401 jours est vidé');
SELECT pg_temp.sa();
SELECT is((SELECT (body IS NULL)::text || ':' || (body_purged_at IS NOT NULL)::text FROM psp_event
            WHERE provider_event_id = 'EV-OLD'), 'true:true', 'purge : corps vidé, date de purge posée');
SELECT is((SELECT body IS NOT NULL FROM psp_event WHERE provider_event_id = 'EV-NEW'), true,
  'purge : le corps de 399 jours reste');
SELECT is((SELECT kind || ':' || status FROM psp_event WHERE provider_event_id = 'EV-OLD'), 'UNKNOWN:RECEIVED',
  'purge : métadonnées gardées');
-- Lecture auditée.
CREATE TEMP TABLE ev3 AS SELECT psp_event_id AS id FROM psp_event WHERE provider_event_id = 'EV-NEW';
SELECT is(read_psp_event_body((SELECT id FROM ev3), pg_temp.id('38e001')), '\x0a0c'::bytea,
  'lecture du corps par un OPERATOR_ADMIN');
SELECT is((SELECT count(*)::int FROM audit_log WHERE action = 'PSP_EVENT_BODY_READ'
            AND object_id = (SELECT id::text FROM ev3) AND actor_id = pg_temp.id('38e001')
            AND operator_id = pg_temp.id('38a001')), 1, 'lecture : ligne d''audit écrite');
SELECT is(pg_temp.code(format($$SELECT read_psp_event_body(%L, %L)$$, (SELECT id FROM ev3), pg_temp.id('38e004'))),
  'P0002', 'lecture par une personne sans rôle : P0002');
SELECT is(pg_temp.code(format($$SELECT read_psp_event_body(%L, %L)$$, (SELECT id FROM ev3), pg_temp.id('38f101'))),
  'P0002', 'lecture par un ORGANIZER_ADMIN : P0002');
SELECT is((SELECT count(*)::int FROM audit_log WHERE action = 'PSP_EVENT_BODY_READ'), 1,
  'lectures refusées : aucune ligne d''audit');
SELECT is(read_psp_event_body((SELECT psp_event_id FROM psp_event WHERE provider_event_id = 'EV-OLD'),
  pg_temp.id('38e001')), NULL::bytea, 'corps purgé : NULL');
SELECT pg_temp.sb();
SELECT is(pg_temp.code(format($$SELECT read_psp_event_body(%L, %L)$$, (SELECT id FROM ev3), pg_temp.id('38e011'))),
  'P0002', 'notification d''un autre prestataire : P0002');
SELECT pg_temp.sa();

-- 5. Carte -----------------------------------------------------------------------------------------
SELECT pg_temp.mkt('50', 'wc6', 'CARD', 60000, 'REF-50');
SELECT is(pg_temp.code(format($$SELECT complete_psp_topup(%L, %L, 0)$$, pg_temp.t('50'),
  pg_temp.mktx('50', 60000, 0))), 'CL001', 'complete_psp_topup refuse une carte (aucun contournement du 3-D Secure)');
SELECT is(pg_temp.st('50'), 'PENDING', 'la carte n''est pas créditée');
SELECT is(pg_temp.code(format($$SELECT complete_card_topup(%L, %L, 0, 'fpA', 'FAILED')$$, pg_temp.t('50'),
  pg_temp.mktx('50', 60000, 0, 'psp:' || (SELECT psp_configuration_id FROM psp_topup
     WHERE psp_topup_id = pg_temp.t('50')) || ':REF-50'))), 'CL001', 'carte sans 3-D Secure réussi : CL001');
SELECT is(pg_temp.code(format($$SELECT complete_card_topup(%L, %L, 0, '', 'SUCCEEDED')$$, pg_temp.t('50'),
  (SELECT id FROM journal_transaction WHERE idempotency_key LIKE 'psp:%:REF-50'))), 'CL001', 'carte sans empreinte : CL001');
SELECT is(pg_temp.code(format($$SELECT complete_card_topup(%L, %L, 0, NULL, 'SUCCEEDED')$$, pg_temp.t('50'),
  (SELECT id FROM journal_transaction WHERE idempotency_key LIKE 'psp:%:REF-50'))), 'CL001', 'empreinte nulle : CL001');
SELECT is(pg_temp.code(format($$SELECT complete_card_topup(%L, %L, 0, 'fpA', 'SUCCEEDED')$$, pg_temp.t('20'),
  (SELECT id FROM journal_transaction WHERE idempotency_key LIKE 'psp:%:REF-50'))), 'CL001',
  'complete_card_topup sur une recharge Wave : CL001');
SELECT lives_ok(format($$SELECT complete_card_topup(%L, %L, 0, 'fpA', 'SUCCEEDED')$$, pg_temp.t('50'),
  (SELECT id FROM journal_transaction WHERE idempotency_key LIKE 'psp:%:REF-50')), 'carte : 60 000, première du jour');
SELECT is((SELECT card_fingerprint || ':' || three_ds FROM psp_topup WHERE psp_topup_id = pg_temp.t('50')),
  'fpA:SUCCEEDED', 'empreinte et 3-D Secure enregistrés');
-- Plafond du jour (100 000 par défaut) : 60 000 + 60 000 refusé, 60 000 + 40 000 passe.
SELECT pg_temp.mkt('51', 'wc7', 'CARD', 60000, 'REF-51');
SELECT is(pg_temp.code(format($$SELECT complete_card_topup(%L, %L, 0, 'fpA', 'SUCCEEDED')$$, pg_temp.t('51'),
  pg_temp.mktx('51', 60000, 0))), 'CL029', 'plafond carte du jour dépassé : CL029');
SELECT pg_temp.mkt('52', 'wc7', 'CARD', 40000, 'REF-52');
SELECT lives_ok(format($$SELECT complete_card_topup(%L, %L, 0, 'fpA', 'SUCCEEDED')$$, pg_temp.t('52'),
  pg_temp.mktx('52', 40000, 0)), 'plafond carte : la limite exacte passe');
SELECT pg_temp.mkt('53', 'wc7', 'CARD', 1, 'REF-53');
SELECT is(pg_temp.code(format($$SELECT complete_card_topup(%L, %L, 0, 'fpA', 'SUCCEEDED')$$, pg_temp.t('53'),
  pg_temp.mktx('53', 1, 0))), 'CL029', 'plafond carte : 1 de plus refusé');
-- Autre empreinte : indépendante. La veille (UTC) ne compte pas.
SELECT pg_temp.mkt('54', 'wc8', 'CARD', 90000, 'REF-54');
SELECT pg_temp.paycard('54', 'fpC');
ALTER TABLE psp_topup DISABLE TRIGGER psp_topup_transition_guard;
UPDATE psp_topup SET succeeded_at = clock_timestamp() - interval '25 hours' WHERE psp_topup_id = pg_temp.t('54');
ALTER TABLE psp_topup ENABLE TRIGGER psp_topup_transition_guard;
SELECT pg_temp.mkt('55', 'wc8', 'CARD', 90000, 'REF-55');
SELECT lives_ok(format($$SELECT complete_card_topup(%L, %L, 0, 'fpC', 'SUCCEEDED')$$, pg_temp.t('55'),
  pg_temp.mktx('55', 90000, 0)), 'plafond carte : une recharge de la veille ne compte pas');
-- Écriture directe : une carte créditée sans 3-D Secure est refusée par la contrainte.
SELECT ok(pg_temp.err(format($$UPDATE psp_topup SET status = 'SUCCEEDED', fee_amount = 0, succeeded_at = now(),
    topup_tx_id = %L WHERE psp_topup_id = %L$$, (SELECT id FROM journal_transaction LIMIT 1), pg_temp.t('22')))
    LIKE '23514%psp_topup_card_credit%', 'CHECK : carte créditée sans 3-D Secure refusée en écriture directe');
-- card_topups_today : somme et verrou consultatif.
SELECT is(card_topups_today((SELECT ledger_id FROM psp_topup WHERE psp_topup_id = pg_temp.t('50')), 'fpA',
  clock_timestamp()), 100000::bigint, 'card_topups_today : somme du jour pour l''empreinte');
CREATE TEMP TABLE lk AS SELECT count(*) AS n FROM pg_locks WHERE locktype = 'advisory' AND pid = pg_backend_pid();
SELECT is(card_topups_today((SELECT ledger_id FROM psp_topup WHERE psp_topup_id = pg_temp.t('50')), 'fpNEUVE',
  clock_timestamp()), 0::bigint, 'card_topups_today : empreinte inconnue = 0');
SELECT cmp_ok((SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' AND pid = pg_backend_pid()), '>',
  (SELECT n FROM lk), 'card_topups_today : verrou consultatif pris (tenu jusqu''à la fin de la transaction)');
SELECT is(card_topups_today((SELECT ledger_id FROM psp_topup WHERE psp_topup_id = pg_temp.t('50')), 'fpC',
  clock_timestamp()), 90000::bigint, 'card_topups_today : la veille exclue du jour');
SELECT is(pg_temp.code(format($$SELECT card_topups_today(%L, '', now())$$,
  (SELECT ledger_id FROM psp_topup WHERE psp_topup_id = pg_temp.t('50')))), 'CL001', 'empreinte vide : CL001');
-- Vélocité.
SELECT is((SELECT distinct_cards || ':' || is_new FROM wallet_card_count(pg_temp.wl('wc7'), 'fpA')), '1:false',
  'vélocité : carte déjà vue');
SELECT is((SELECT distinct_cards || ':' || is_new FROM wallet_card_count(pg_temp.wl('wc7'), 'fpZ')), '2:true',
  'vélocité : nouvelle carte, comptée');
-- fail_psp_topup carte.
SELECT pg_temp.mkt('56', 'wc9', 'CARD', 1000, 'REF-56');
SELECT lives_ok(format($$SELECT fail_psp_topup(%L, 'THREE_DS', true, 'PSP_TOPUP_OVER_LIMIT', 'fpQ', 'FAILED')$$,
  pg_temp.t('56')), 'échec carte : empreinte, 3-D Secure et anomalie de dépassement');
SELECT is((SELECT status || ':' || card_fingerprint || ':' || three_ds || ':' || failure_reason
             FROM psp_topup WHERE psp_topup_id = pg_temp.t('56')), 'FAILED:fpQ:FAILED:THREE_DS', 'échec carte enregistré');
SELECT is((SELECT kind FROM anomaly WHERE id = (SELECT anomaly_id FROM psp_topup WHERE psp_topup_id = pg_temp.t('56'))),
  'PSP_TOPUP_OVER_LIMIT', 'anomalie du genre demandé');
SELECT pg_temp.mkt('57', 'wc9', 'WAVE', 1000, 'REF-57');
SELECT is(pg_temp.code(format($$SELECT fail_psp_topup(%L, 'PSP_FAILED', false, 'PSP_TOPUP_NOT_CREDITED', 'fp', NULL)$$,
  pg_temp.t('57'))), 'CL001', 'empreinte sur une recharge Wave : CL001');
SELECT is(pg_temp.code(format($$SELECT fail_psp_topup(%L, 'BOGUS', false)$$, pg_temp.t('57'))), 'CL001', 'motif inconnu : CL001');
SELECT is(pg_temp.code(format($$SELECT fail_psp_topup(%L, 'PSP_FAILED', true, 'LATE_CHARGEBACK')$$, pg_temp.t('57'))),
  'CL001', 'genre d''anomalie inconnu : CL001');

-- Revue cycle 1 -------------------------------------------------------------------------------------
SELECT ok(pg_temp.err($$INSERT INTO psp_event (operator_id, psp_configuration_id, provider_event_id, kind,
    normalized, body, body_purged_at) SELECT operator_id, psp_configuration_id, 'EV-PURGE', 'UNKNOWN', '{}',
    '\x01', now() FROM psp_event LIMIT 1$$) LIKE '23514%psp_event_purge_shape%',
  'CHECK : un corps présent n''est jamais marqué purgé');
-- Frais cohérents avec brut - net (revue 4).
SELECT pg_temp.mkt('70', 'wp5', 'WAVE', 10000, 'REF-70');
SELECT is(pg_temp.code(format($$SELECT complete_psp_topup(%L, %L, 100)$$, pg_temp.t('70'),
  pg_temp.mktx('70', 10000, 0))), 'CL001', 'frais déclaré 100 pour une transaction qui crédite le brut : CL001');
SELECT is(pg_temp.code(format($$SELECT complete_psp_topup(%L, %L, 0)$$, pg_temp.t('70'),
  pg_temp.mktx('70', 10000, 0, 'wave:' || (SELECT psp_configuration_id FROM psp_topup
     WHERE psp_topup_id = pg_temp.t('70')) || ':REF-70B'))), 'CL001', 'autre clé : refusée');
-- Anomalie résolue à la main puis succès tardif (revue 1) : depuis FAILED, EXPIRED, CANCELLED.
CREATE TEMP TABLE human AS SELECT topup_tx_id AS id FROM psp_topup WHERE psp_topup_id = pg_temp.t('30');
SELECT pg_temp.mkt('71', 'wp6', 'WAVE', 10000, 'REF-71');
SELECT fail_psp_topup(pg_temp.t('71'), 'PSP_FAILED', true);
SELECT pg_temp.mkt('72', 'wp6', 'WAVE', 10000, 'REF-72');
SELECT pg_temp.age('72', interval '1 hour', interval '1 minute');
SELECT expire_psp_topups(ARRAY[pg_temp.t('72')]);
SELECT fail_psp_topup(pg_temp.t('72'), 'PSP_FAILED', true);
SELECT pg_temp.mkt('73', 'wp6', 'WAVE', 10000, 'REF-73');
SELECT cancel_psp_topup(pg_temp.t('73'));
SELECT fail_psp_topup(pg_temp.t('73'), 'PSP_FAILED', true);
UPDATE anomaly SET status = 'RESOLVED', resolution_tx_id = (SELECT id FROM human)
 WHERE id IN (SELECT anomaly_id FROM psp_topup WHERE psp_topup_id IN (pg_temp.t('71'), pg_temp.t('72'), pg_temp.t('73')));
SELECT is(pg_temp.code(format($$SELECT pg_temp.pay('71')$$)), 'CL029', 'anomalie résolue à la main : succès tardif sur FAILED refusé');
SELECT is(pg_temp.code(format($$SELECT pg_temp.pay('72')$$)), 'CL029', 'anomalie résolue à la main : succès tardif sur EXPIRED refusé');
SELECT is(pg_temp.code(format($$SELECT pg_temp.pay('73')$$)), 'CL029', 'anomalie résolue à la main : succès tardif sur CANCELLED refusé');
SELECT is((SELECT string_agg(status || ':' || (topup_tx_id IS NULL), ' ' ORDER BY psp_topup_id) FROM psp_topup
            WHERE psp_topup_id IN (pg_temp.t('71'), pg_temp.t('72'), pg_temp.t('73'))),
  'FAILED:true EXPIRED:true CANCELLED:true', 'aucun second crédit : les recharges gardent leur état');
SELECT is((SELECT count(*)::int FROM anomaly WHERE resolution_tx_id = (SELECT id FROM human)
            AND id IN (SELECT anomaly_id FROM psp_topup WHERE psp_topup_id IN (pg_temp.t('71'),
                pg_temp.t('72'), pg_temp.t('73')))), 3, 'la résolution humaine n''est pas écrasée');
SELECT lives_ok(format($$SELECT complete_psp_topup(%L, %L, 0)$$, pg_temp.t('34'),
  (SELECT topup_tx_id FROM psp_topup WHERE psp_topup_id = pg_temp.t('34'))),
  'rejeu de la même complétion déjà faite (anomalie fermée par le crédit) : toujours un rejeu');
-- Déblocage : demande approuvée entre la contestation et le blocage (revue 2).
SELECT pg_temp.mkt('74', 'wp7', 'CARD', 4000, 'REF-74');
SELECT pg_temp.paycard('74', 'fpU');
CREATE TEMP TABLE cbu AS SELECT psp_chargeback_id AS id FROM record_chargeback(pg_temp.t('74'), 'DSP-U', 1000);
SELECT pg_temp.wreq('38aa61', pg_temp.wl('wp7'), '38f101', '38f102');
SELECT block_wallet_after_chargeback(pg_temp.wl('wp7'), (SELECT id FROM cbu));
SELECT is(pg_temp.code(format($$SELECT unblock_wallet(%L, %L)$$, pg_temp.wl('wp7'), pg_temp.id('38aa61'))), 'CL029',
  'déblocage : demande approuvée avant le blocage : CL029');
SELECT pg_temp.wreq('38aa62', pg_temp.wl('wp7'), '38f101', '38f102');
SELECT lives_ok(format($$SELECT unblock_wallet(%L, %L)$$, pg_temp.wl('wp7'), pg_temp.id('38aa62')),
  'déblocage : demande approuvée après le blocage');

-- 6. Compteur de refus (A22) ----------------------------------------------------------------------
SELECT pg_temp.nosession();
CREATE TEMP TABLE rj AS
  SELECT record_webhook_rejection(pg_temp.k('wave1'), 'SIGNATURE_INVALID') AS a,
         record_webhook_rejection(pg_temp.k('wave1'), 'SIGNATURE_INVALID') AS b;
SELECT ok((SELECT a = 1 AND b = (SELECT count FROM psp_webhook_rejection
              WHERE psp_configuration_id = pg_temp.k('wave1') AND reason = 'SIGNATURE_INVALID'
              ORDER BY minute DESC LIMIT 1) FROM rj),
  'compteur : 1 puis la valeur exacte de la minute courante (2 dans la même minute)');
SELECT is((SELECT sum(count)::int FROM psp_webhook_rejection WHERE psp_configuration_id = pg_temp.k('wave1')
            AND reason = 'SIGNATURE_INVALID'), 2, 'compteur : deux refus comptés');
SELECT is((SELECT operator_id FROM psp_webhook_rejection WHERE psp_configuration_id = pg_temp.k('wave1') LIMIT 1),
  pg_temp.id('38a001'), 'compteur : prestataire de la configuration gardé');
SELECT record_webhook_rejection(pg_temp.k('wave1'), 'SIGNATURE_MISSING');
SELECT is((SELECT count(DISTINCT reason)::int FROM psp_webhook_rejection WHERE psp_configuration_id = pg_temp.k('wave1')),
  2, 'compteur : une ligne par motif');
SELECT is(pg_temp.code($$INSERT INTO psp_webhook_rejection (config_key, psp_configuration_id, operator_id,
    reason, minute, count) SELECT config_key, psp_configuration_id, operator_id, reason, minute, 1
    FROM psp_webhook_rejection LIMIT 1$$), '23505', 'clé primaire : (configuration, motif, minute) unique');
INSERT INTO psp_webhook_rejection (config_key, psp_configuration_id, operator_id, reason, minute, count)
SELECT config_key, psp_configuration_id, operator_id, reason, minute - interval '5 minutes', 1
  FROM psp_webhook_rejection WHERE reason = 'SIGNATURE_MISSING';
SELECT is((SELECT count(*)::int FROM psp_webhook_rejection WHERE reason = 'SIGNATURE_MISSING'), 2,
  'compteur : minutes distinctes, lignes distinctes');
SELECT record_webhook_rejection(gen_random_uuid(), 'UNKNOWN_CONFIG');
SELECT is((SELECT psp_configuration_id IS NULL AND operator_id IS NULL AND
                  config_key = '00000000-0000-0000-0000-000000000000'
             FROM psp_webhook_rejection WHERE reason = 'UNKNOWN_CONFIG'), true,
  'configuration inconnue : clé nulle, aucune colonne renseignée');
SELECT is(pg_temp.code($$SELECT record_webhook_rejection(NULL, 'NOPE')$$), 'CL001', 'motif inconnu : CL001');
SELECT lives_ok($$SELECT record_webhook_rejection(NULL, 'BODY_MALFORMED')$$, 'configuration nulle acceptée');
SELECT lives_ok($$SELECT count(record_webhook_rejection(gen_random_uuid(), 'BODY_TOO_LARGE'))
                    FROM generate_series(1, 1000)$$, '1 000 refus de configurations inconnues');
SELECT is((SELECT count(*) FROM psp_webhook_rejection WHERE reason = 'BODY_TOO_LARGE'),
  (SELECT count(DISTINCT minute) FROM psp_webhook_rejection WHERE reason = 'BODY_TOO_LARGE'),
  'borne : 1 000 appels, exactement une ligne par minute');
SELECT is((SELECT sum(count)::int FROM psp_webhook_rejection WHERE reason = 'BODY_TOO_LARGE'), 1000,
  'borne : le compteur porte les 1 000');
INSERT INTO psp_webhook_rejection VALUES ('00000000-0000-0000-0000-000000000000', NULL, NULL, 'SIGNATURE_MALFORMED', now() - interval '31 days', 1);
SELECT record_webhook_rejection(NULL, 'BODY_MALFORMED');
SELECT is((SELECT count(*)::int FROM psp_webhook_rejection WHERE reason = 'SIGNATURE_MALFORMED'), 0,
  'compteur : les lignes de plus de 30 jours sont purgées');
SELECT pg_temp.sa();

-- 7. Contestations (T020) -------------------------------------------------------------------------
-- cb1 : 20 000 brut, 1 000 de frais, net crédité 19 000.
SELECT pg_temp.mkt('60', 'wc10', 'CARD', 20000, 'REF-60');
SELECT pg_temp.paycard('60', 'fpD', 1000);
SELECT is(psp_topup_net_credited(pg_temp.t('60')), 19000::bigint, 'net crédité = brut - frais');
SELECT is((SELECT remaining FROM record_chargeback(pg_temp.t('60'), 'DSP-1', 10000)), 9000::bigint,
  'contestation : restant calculé sur le net');
SELECT is(pg_temp.code(format($$SELECT record_chargeback(%L, 'DSP-2', 9001)$$, pg_temp.t('60'))), 'CL043',
  'contestation au-delà du net restant : CL043 (le brut aurait laissé passer)');
SELECT is((SELECT remaining FROM record_chargeback(pg_temp.t('60'), 'DSP-3', 9000)), 0::bigint,
  'contestation égale au restant : acceptée');
SELECT is(pg_temp.code(format($$SELECT record_chargeback(%L, 'DSP-4', 1)$$, pg_temp.t('60'))), 'CL043', 'plus rien de contestable : CL043');
SELECT is((SELECT duplicate FROM record_chargeback(pg_temp.t('60'), 'DSP-1', 99999)), true,
  'contestation rejouée : duplicate, sans contrôle du montant');
SELECT is((SELECT count(*)::int FROM psp_chargeback WHERE psp_topup_id = pg_temp.t('60')), 2, 'rejeu : aucune écriture');
SELECT ok(pg_temp.err(format($$INSERT INTO psp_chargeback (operator_id, psp_configuration_id, provider_dispute_id,
    psp_topup_id, amount) SELECT operator_id, psp_configuration_id, 'DSP-DIRECT', psp_topup_id, 1
    FROM psp_topup WHERE psp_topup_id = %L$$, pg_temp.t('60'))) LIKE 'CL043%',
  'plafond en écriture directe aussi (déclencheur)');
SELECT pg_temp.mkt('61', 'wc10', 'CARD', 5000, 'REF-61');
SELECT pg_temp.paycard('61', 'fpD');
SELECT is(pg_temp.code(format($$SELECT record_chargeback(%L, 'DSP-1', 10)$$, pg_temp.t('61'))), 'CL029',
  'identifiant de contestation déjà utilisé pour une autre recharge : CL029');
SELECT is(pg_temp.code(format($$SELECT record_chargeback(%L, 'DSP-5', 0)$$, pg_temp.t('61'))), 'CL044', 'montant nul : CL044');
SELECT is(pg_temp.code(format($$SELECT record_chargeback(%L, 'DSP-6', 10)$$, pg_temp.t('30'))), 'CL044', 'recharge Wave : CL044');
SELECT is(pg_temp.code(format($$SELECT record_chargeback(%L, 'DSP-7', 10)$$, pg_temp.t('56'))), 'CL044', 'recharge FAILED : CL044');
SELECT pg_temp.mkt('62', 'wc11', 'CARD', 5000, 'REF-62');
SELECT is(pg_temp.code(format($$SELECT record_chargeback(%L, 'DSP-8', 10)$$, pg_temp.t('62'))), 'CL044',
  'recharge PENDING, sans transaction : CL044');
SELECT is(pg_temp.code(format($$SELECT record_chargeback(%L, 'DSP-9', 10)$$, pg_temp.t('62'))) ||
          pg_temp.code(format($$SELECT record_chargeback(%L, '', 10)$$, pg_temp.t('61'))), 'CL044CL001',
  'identifiant de contestation vide : CL001');
SELECT is(pg_temp.code(format($$UPDATE psp_chargeback SET amount = 1 WHERE provider_dispute_id = 'DSP-1'$$)), 'CL001',
  'contestation : montant non modifiable');
SELECT is(pg_temp.code($$DELETE FROM psp_chargeback WHERE provider_dispute_id = 'DSP-1'$$), 'CL001',
  'contestation : suppression interdite');
-- Contestation tardive et rattachement de l'écriture.
SELECT pg_temp.mkt('63', 'wc11', 'CARD', 8000, 'REF-63');
SELECT pg_temp.paycard('63', 'fpE');
SELECT pg_temp.mkt('64', 'wc11', 'CARD', 3000, 'REF-64');
SELECT pg_temp.paycard('64', 'fpE');
CREATE TEMP TABLE cbl AS SELECT psp_chargeback_id AS id FROM record_chargeback(pg_temp.t('63'), 'DSP-L', 7000, true);
SELECT is((SELECT a.kind || ':' || a.status || ':' || a.amount FROM anomaly a JOIN psp_chargeback c ON c.anomaly_id = a.id
             WHERE c.psp_chargeback_id = (SELECT id FROM cbl)), 'LATE_CHARGEBACK:OPEN:7000',
  'contestation tardive : anomalie LATE_CHARGEBACK ouverte et liée');
SELECT is((SELECT chargeback_tx_id IS NULL FROM psp_chargeback WHERE psp_chargeback_id = (SELECT id FROM cbl)), true,
  'contestation tardive : pas encore d''écriture');
CREATE FUNCTION pg_temp.cbtx(p_n text, p_amount bigint, p_key text, p_type text DEFAULT 'CHARGEBACK',
                             p_psp_code text DEFAULT 'A-PSP-CARTE') RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE t psp_topup%ROWTYPE;
BEGIN
  SELECT * INTO t FROM psp_topup WHERE psp_topup_id = pg_temp.t(p_n);
  RETURN post_transaction(t.ledger_id, p_type, p_key, clock_timestamp(), 'BACKOFFICE',
    jsonb_build_array(
      jsonb_build_object('account_id', (SELECT id FROM account WHERE ledger_id = t.ledger_id AND code = p_psp_code),
                         'amount', -p_amount),
      jsonb_build_object('account_id', (SELECT id FROM account WHERE wallet_id = t.wallet_id AND purpose = 'WALLET_PAID'),
                         'amount', p_amount)),
    t.event_id, NULL, pg_temp.id('38e001'), pg_temp.id('38e002'));
END $$;
SELECT is(pg_temp.code(format($$SELECT attach_chargeback_tx(%L, %L)$$, (SELECT id FROM cbl),
  pg_temp.cbtx('63', 1, 'psp:' || pg_temp.k('card1') || ':AUTRE'))), 'CL001', 'rattachement : mauvaise clé refusée');
CREATE TEMP TABLE cbl3 AS SELECT psp_chargeback_id AS id FROM record_chargeback(pg_temp.t('63'), 'DSP-L3', 300);
CREATE TEMP TABLE cbl4 AS SELECT psp_chargeback_id AS id FROM record_chargeback(pg_temp.t('63'), 'DSP-L4', 300);
SELECT is(pg_temp.code(format($$SELECT attach_chargeback_tx(%L, %L)$$, (SELECT id FROM cbl4),
  pg_temp.cbtx('63', 1, 'psp:' || pg_temp.k('card1') || ':DSP-L4', 'WALLET_REFUND'))), 'CL001',
  'rattachement : mauvais type refusé');
SELECT is(pg_temp.code(format($$SELECT attach_chargeback_tx(%L, %L)$$, (SELECT id FROM cbl3),
  pg_temp.cbtx('63', 1, 'psp:' || pg_temp.k('card1') || ':DSP-L3'))), 'CL001', 'rattachement : mauvais montant refusé');
SELECT is((SELECT status FROM anomaly a JOIN psp_chargeback c ON c.anomaly_id = a.id
            WHERE c.psp_chargeback_id = (SELECT id FROM cbl)), 'OPEN', 'refus : l''anomalie reste ouverte');
CREATE TEMP TABLE cbt AS SELECT pg_temp.cbtx('63', 7000, 'psp:' || pg_temp.k('card1') || ':DSP-L', 'CHARGEBACK',
                                               'A-PSP-CARTE') AS id;
SELECT lives_ok(format($$SELECT attach_chargeback_tx(%L, %L)$$, (SELECT id FROM cbl), (SELECT id FROM cbt)),
  'rattachement de l''écriture exacte');
SELECT is((SELECT a.status || ':' || (a.resolution_tx_id = (SELECT id FROM cbt)) FROM anomaly a
             JOIN psp_chargeback c ON c.anomaly_id = a.id WHERE c.psp_chargeback_id = (SELECT id FROM cbl)),
  'RESOLVED:true', 'rattachement : anomalie tardive fermée');
SELECT lives_ok(format($$SELECT attach_chargeback_tx(%L, %L)$$, (SELECT id FROM cbl), (SELECT id FROM cbt)),
  'rattachement rejoué : sans effet');
SELECT is(pg_temp.code(format($$SELECT attach_chargeback_tx(%L, %L)$$, (SELECT id FROM cbl),
  pg_temp.cbtx('63', 1, 'psp:' || pg_temp.k('card1') || ':DSP-L2'))), 'CL029', 'autre écriture sur une contestation rattachée : CL029');
-- Blocage et déblocage.
SELECT lives_ok(format($$SELECT block_wallet_after_chargeback(%L, %L)$$, pg_temp.wl('wc11'), (SELECT id FROM cbl)),
  'blocage après contestation');
SELECT is((SELECT status FROM wallet WHERE id = pg_temp.wl('wc11')), 'BLOCKED', 'portefeuille BLOCKED');
SELECT lives_ok(format($$SELECT block_wallet_after_chargeback(%L, %L)$$, pg_temp.wl('wc11'), (SELECT id FROM cbl)),
  'blocage idempotent');
SELECT is((SELECT wallet_blocked FROM psp_chargeback WHERE psp_chargeback_id = (SELECT id FROM cbl)), true, 'wallet_blocked posé');
SELECT is(pg_temp.code(format($$SELECT block_wallet_after_chargeback(%L, %L)$$, pg_temp.wl('wc10'), (SELECT id FROM cbl))),
  'CL044', 'blocage d''un autre portefeuille que celui de la contestation : CL044');
UPDATE wallet SET status = 'CLOSED' WHERE id = pg_temp.wl('wc11');
SELECT is(pg_temp.code(format($$SELECT block_wallet_after_chargeback(%L, %L)$$, pg_temp.wl('wc11'), (SELECT id FROM cbl))),
  'CL044', 'portefeuille CLOSED : CL044');
UPDATE wallet SET status = 'BLOCKED' WHERE id = pg_temp.wl('wc11');
-- Demandes : ancienne (avant la contestation), autre portefeuille, autre action, rôle insuffisant, B.
SELECT pg_temp.wreq('38aa51', pg_temp.wl('wc11'), '38f101', '38f102');
-- Nouvelle contestation APRÈS la demande : la demande ancienne ne débloque plus.
CREATE TEMP TABLE cbm AS SELECT psp_chargeback_id AS id FROM record_chargeback(pg_temp.t('64'), 'DSP-M', 1000);
SELECT block_wallet_after_chargeback(pg_temp.wl('wc11'), (SELECT id FROM cbm));
SELECT is(pg_temp.code(format($$SELECT unblock_wallet(%L, %L)$$, pg_temp.wl('wc11'), pg_temp.id('38aa51'))), 'CL029',
  'déblocage : demande antérieure à la dernière contestation : CL029');
SELECT pg_temp.wreq('38aa52', pg_temp.wl('wc10'), '38f101', '38f102');
SELECT is(pg_temp.code(format($$SELECT unblock_wallet(%L, %L)$$, pg_temp.wl('wc11'), pg_temp.id('38aa52'))), 'CL023',
  'déblocage : demande d''un autre portefeuille : CL023');
SELECT pg_temp.wreq('38aa53', pg_temp.wl('wc11'), '38f101', '38f102', 'PAYOUT');
SELECT is(pg_temp.code(format($$SELECT unblock_wallet(%L, %L)$$, pg_temp.wl('wc11'), pg_temp.id('38aa53'))), 'CL023',
  'déblocage : demande d''une autre action : CL023');
SELECT pg_temp.wreq('38aa54', pg_temp.wl('wc11'), '38f101', NULL);
SELECT is(pg_temp.code(format($$SELECT unblock_wallet(%L, %L)$$, pg_temp.wl('wc11'), pg_temp.id('38aa54'))), 'CL023',
  'déblocage : demande non approuvée : CL023');
SELECT pg_temp.wreq('38aa55', pg_temp.wl('wc11'), '38e004', '38f102');
SELECT is(pg_temp.code(format($$SELECT unblock_wallet(%L, %L)$$, pg_temp.wl('wc11'), pg_temp.id('38aa55'))), 'CL023',
  'déblocage : auteur sans rôle ORGANIZER_ADMIN : CL023');
SELECT pg_temp.wreq('38aa56', pg_temp.wl('wc11'), '38e001', '38e002');
SELECT is(pg_temp.code(format($$SELECT unblock_wallet(%L, %L)$$, pg_temp.wl('wc11'), pg_temp.id('38aa56'))), 'CL023',
  'déblocage : deux OPERATOR_ADMIN (pas l''organisateur) : CL023');
SELECT is(pg_temp.code(format($$SELECT unblock_wallet(%L, %L)$$, pg_temp.wl('wc11'), pg_temp.id('38aa99'))), 'P0002',
  'déblocage : demande inconnue : P0002');
SELECT pg_temp.wreq('38aa57', pg_temp.wl('wc11'), '38f101', '38f102');
SELECT pg_temp.sb();
SELECT is(pg_temp.code(format($$SELECT unblock_wallet(%L, %L)$$, pg_temp.wl('wc11'), pg_temp.id('38aa57'))), 'P0002',
  'déblocage : demande d''un autre prestataire : P0002');
SELECT pg_temp.sa();
SELECT lives_ok(format($$SELECT unblock_wallet(%L, %L)$$, pg_temp.wl('wc11'), pg_temp.id('38aa57')), 'déblocage régulier');
SELECT is((SELECT status FROM wallet WHERE id = pg_temp.wl('wc11')), 'ACTIVE', 'portefeuille ACTIVE');
SELECT is((SELECT count(*)::int FROM psp_chargeback c JOIN psp_topup t USING (psp_topup_id)
            WHERE t.wallet_id = pg_temp.wl('wc11') AND c.wallet_blocked AND c.unblocked_by_request IS NULL), 0,
  'déblocage : contestations marquées levées');
SELECT is(pg_temp.code(format($$SELECT unblock_wallet(%L, %L)$$, pg_temp.wl('wc11'), pg_temp.id('38aa57'))), 'CL029',
  'déblocage : demande rejouée : CL029');
-- Portefeuille bloqué pour une autre cause.
SELECT pg_temp.mkt('65', 'wc9', 'CARD', 6000, 'REF-65');
SELECT pg_temp.paycard('65', 'fpG');
CREATE TEMP TABLE cbo AS SELECT psp_chargeback_id AS id FROM record_chargeback(pg_temp.t('65'), 'DSP-O', 1000);
UPDATE wallet SET status = 'BLOCKED' WHERE id = pg_temp.wl('wc9');
SELECT pg_temp.wreq('38aa58', pg_temp.wl('wc9'), '38f101', '38f102');
SELECT is(pg_temp.code(format($$SELECT unblock_wallet(%L, %L)$$, pg_temp.wl('wc9'), pg_temp.id('38aa58'))), 'CL029',
  'déblocage : portefeuille bloqué pour une autre cause : CL029');
-- Défaut de 0038 corrigé par 0039 : une contestation sur un portefeuille DÉJÀ bloqué pour une autre
-- cause ne pose pas le marqueur de blocage par contestation, et le déblocage « contestation » refuse.
SELECT lives_ok(format($$SELECT block_wallet_after_chargeback(%L, %L)$$, pg_temp.wl('wc9'), (SELECT id FROM cbo)),
  'blocage demandé sur un portefeuille déjà bloqué pour une autre cause : sans erreur');
SELECT is((SELECT wallet_blocked FROM psp_chargeback WHERE psp_chargeback_id = (SELECT id FROM cbo)), false,
  'autre cause : le marqueur de blocage par contestation n''est PAS posé');
SELECT is((SELECT blocked_at IS NULL FROM psp_chargeback WHERE psp_chargeback_id = (SELECT id FROM cbo)), true,
  'autre cause : blocked_at reste vide');
SELECT lives_ok(format($$SELECT block_wallet_after_chargeback(%L, %L)$$, pg_temp.wl('wc9'), (SELECT id FROM cbo)),
  'autre cause : rejeu du blocage sans effet');
SELECT pg_temp.wreq('38aa59', pg_temp.wl('wc9'), '38f101', '38f102');
SELECT is(pg_temp.code(format($$SELECT unblock_wallet(%L, %L)$$, pg_temp.wl('wc9'), pg_temp.id('38aa59'))), 'CL029',
  'autre cause + contestation : le déblocage par contestation est refusé (CL029)');
SELECT is((SELECT status FROM wallet WHERE id = pg_temp.wl('wc9')), 'BLOCKED',
  'autre cause + contestation : le portefeuille reste BLOCKED');
-- Portefeuille ACTIVE : blocage et marqueur posés par la contestation (cas nominal inchangé).
UPDATE wallet SET status = 'ACTIVE' WHERE id = pg_temp.wl('wc9');
SELECT block_wallet_after_chargeback(pg_temp.wl('wc9'), (SELECT id FROM cbo));
SELECT is((SELECT status || ':' || (SELECT wallet_blocked FROM psp_chargeback WHERE psp_chargeback_id = (SELECT id FROM cbo))
             FROM wallet WHERE id = pg_temp.wl('wc9')), 'BLOCKED:true',
  'portefeuille ACTIVE : bloqué et marqué par la contestation');
-- Déjà bloqué PAR une contestation : une seconde contestation est marquée aussi (cause identique).
SELECT is((SELECT wallet_blocked FROM psp_chargeback WHERE psp_chargeback_id = (SELECT id FROM cbm)), true,
  'déjà bloqué par une contestation : la contestation suivante est marquée');
UPDATE wallet SET status = 'BLOCKED' WHERE id = pg_temp.wl('wc9');

-- 8. Extensions de listes fermées (T021) ----------------------------------------------------------
SELECT is(pg_temp.code(format($$INSERT INTO anomaly (operator_id, kind, amount) VALUES (%L, 'PSP_TOPUP_NOT_CREDITED', 100)$$,
  pg_temp.id('38a001'))), '23514', 'PSP_TOPUP_NOT_CREDITED sans grand livre : refusée');
SELECT ok(pg_temp.err(format($$INSERT INTO anomaly (operator_id, ledger_id, kind, amount) VALUES (%L, %L,
    'PSP_TOPUP_NOT_CREDITED', 0)$$, pg_temp.id('38a001'),
    (SELECT id FROM ledger WHERE scope_id = pg_temp.id('38d001')))) LIKE '23514%anomaly_psp_topup_not_credited%',
  'PSP_TOPUP_NOT_CREDITED sans montant : refusée par la contrainte dédiée');
SELECT lives_ok(format($$INSERT INTO anomaly (operator_id, ledger_id, kind, amount) VALUES (%L, %L,
    'PSP_TOPUP_NOT_CREDITED', 100)$$, pg_temp.id('38a001'),
    (SELECT id FROM ledger WHERE scope_id = pg_temp.id('38d001'))), 'PSP_TOPUP_NOT_CREDITED avec montant et grand livre : acceptée');
SELECT is(pg_temp.code(format($$INSERT INTO anomaly (operator_id, ledger_id, kind, amount) VALUES (%L, %L, 'BOGUS', 1)$$,
  pg_temp.id('38a001'), (SELECT id FROM ledger WHERE scope_id = pg_temp.id('38d001')))), '23514', 'genre inconnu : refusé');
SELECT is((SELECT count(*)::int FROM unnest(ARRAY['OFFLINE_SHORTFALL','COUNTER_DUPLICATE','COUNTER_TIME_INVERSION',
  'UID_MISMATCH','RETIRED_IDENTITY','SEQ_GAP','CHAIN_BROKEN','CLOCK_SKEW','VOID_CONFLICT','ONLINE_CONFIRMED_MISSING',
  'IDEMPOTENCY_CONFLICT','NON_COMPLIANT_OPERATION','PERIOD_CLOSED_OPERATION','LATE_OFFLINE_SYNC','SIGNATURE_MISMATCH',
  'CASH_TOPUP_OVER_LIMIT','CASH_DIFF','PSP_MISMATCH','PSP_TOPUP_OVER_LIMIT','EDGE_REPLAY_FAILED','LATE_CHARGEBACK',
  'CARD_VELOCITY']) v WHERE (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'anomaly_kind_check')
  LIKE '%''' || v || '''%'), 22, 'anomaly.kind : aucune valeur précédente n''a disparu');
SELECT lives_ok(format($$INSERT INTO approval_request (operator_id, action, payload, requested_by) VALUES (%L, 'WALLET_UNBLOCK', '{}', %L)$$,
  pg_temp.id('38a001'), pg_temp.id('38e001')), 'action WALLET_UNBLOCK acceptée');
SELECT lives_ok(format($$INSERT INTO approval_request (operator_id, action, payload, requested_by) VALUES (%L, 'CASH_DEPOSIT', '{}', %L)$$,
  pg_temp.id('38a001'), pg_temp.id('38e001')), 'action CASH_DEPOSIT acceptée');
SELECT is(pg_temp.code(format($$INSERT INTO approval_request (operator_id, action, payload, requested_by) VALUES (%L, 'BOGUS', '{}', %L)$$,
  pg_temp.id('38a001'), pg_temp.id('38e001'))), '23514', 'action inconnue : refusée');
SELECT is((SELECT count(*)::int FROM unnest(ARRAY['LATE_CLAIM','ADJUSTMENT','ANOMALY_RESOLUTION','WAIVE_SEQ_GAP',
  'FORCE_CENTRAL_AUTHORITY','REINSTATE_MEDIA','PAYOUT','DEVICE_JOURNAL_IMPORT','KYC_REVOCATION','PSP_CONFIGURATION',
  'EVENT_PSP_SELECTION','WALLET_REFUND','LATE_CHARGEBACK','EVENT_GO_LIVE','EVENT_SETTINGS_CHANGE',
  'EVENT_OPERATOR_SETTINGS_CHANGE','PARTICIPATION_CHANGE','FEE_RULE_CHANGE','CONTRACT_VERSION',
  'PLATFORM_CONTRACT_VERSION','JURISDICTION_LIMITS_CHANGE','TAG_KEY_CREATE','TAG_DEK_ROTATE','TAG_KEY_RETIRE',
  'SALE_REVERSAL']) v WHERE (SELECT pg_get_constraintdef(oid) FROM pg_constraint
    WHERE conname = 'approval_request_action_check') LIKE '%''' || v || '''%'), 25,
  'approval_request.action : les vingt-cinq valeurs précédentes sont conservées');

-- Grand livre LOCKED : une écriture CHARGEBACK reste acceptée (extension T021, ADR-77).
UPDATE ledger SET status = 'LOCKED', late_claims_until = clock_timestamp() + interval '1 day'
 WHERE scope_type = 'EVENT' AND scope_id = pg_temp.id('38d001');
CREATE TEMP TABLE cb60 AS SELECT psp_chargeback_id AS id FROM psp_chargeback WHERE provider_dispute_id = 'DSP-1';
SELECT lives_ok(format($$SELECT attach_chargeback_tx(%L, %L)$$, (SELECT id FROM cb60),
  pg_temp.cbtx('60', 10000, 'psp:' || pg_temp.k('card1') || ':DSP-1')),
  'grand livre LOCKED : écriture CHARGEBACK (A-PSP-CARTE crédité, portefeuille débité) acceptée et rattachée');
SELECT is(pg_temp.code(format($$SELECT pg_temp.cbtx('61', 100, 'psp:x:y', 'TOPUP')$$)), 'CL003',
  'grand livre LOCKED : une écriture TOPUP reste refusée');
UPDATE ledger SET status = 'OPEN', late_claims_until = NULL
 WHERE scope_type = 'EVENT' AND scope_id = pg_temp.id('38d001');

-- Contraintes de psp_topup, une par une (écriture directe du propriétaire).
SELECT ok(pg_temp.insx(b, 'c' || i, o::jsonb) LIKE '23514%' || c || '%', 'contrainte ' || c)
  FROM (VALUES
    (1, '3b', 'psp_topup_amount', '{"amount":0}'),
    (2, '3b', 'psp_topup_status', '{"status":"BOGUS","failure_reason":"PSP_FAILED"}'),
    (3, '3b', 'psp_topup_requested_by_kind',
       '{"requested_by_kind":"X","device_id":null,"person_id":null}'),
    (4, '3b', 'psp_topup_desk_actor', '{"person_id":null}'),
    (5, '3b', 'psp_topup_customer_actor', '{"customer_id":"00000000-0000-0000-0000-00000038b201"}'),
    (6, '3b', 'psp_topup_customer_no_device',
       '{"requested_by_kind":"CUSTOMER","customer_id":"00000000-0000-0000-0000-00000038b201","person_id":null}'),
    (7, '3b', 'psp_topup_status_credit', '{"topup_tx_id":"00000000-0000-0000-0000-000000000000"}'),
    (8, '3b', 'psp_topup_failure_reason_presence', '{"failure_reason":"PSP_FAILED"}'),
    (9, '3b', 'psp_topup_failure_reason', '{"status":"FAILED","failure_reason":"BOGUS"}'),
    (10, '3b', 'psp_topup_card_only', '{"three_ds":"SUCCEEDED"}'),
    (11, '62', 'psp_topup_three_ds', '{"three_ds":"X"}'),
    (12, '3b', 'psp_topup_fee', '{"fee_amount":20000}'),
    (13, '3b', 'psp_topup_fee_only_credited', '{"fee_amount":5}'),
    (14, '3b', 'psp_topup_expires', '{"expires_at":"2000-01-01T00:00:00Z"}'),
    (15, '3b', 'psp_topup_method', '{"method":"X"}'))
  AS v(i, b, c, o);

-- 9. Cloisonnement : un objet de A sous la session de B, puis sans session --------------------------
CREATE TEMP TABLE iso (label text, sql text);
INSERT INTO iso VALUES
 ('create_psp_topup', format($$SELECT create_psp_topup(%L, %L, 'WAVE', 100, 'DESK', %L, %L, NULL, clock_timestamp() + interval '1 hour')$$,
    pg_temp.t('e1'), pg_temp.wl('wp2'), pg_temp.id('38ab01'), pg_temp.id('38e011'))),
 ('mark_psp_topup_initiated', format($$SELECT mark_psp_topup_initiated(%L, 'R-ISO')$$, pg_temp.t('36'))),
 ('cancel_psp_topup', format($$SELECT cancel_psp_topup(%L)$$, pg_temp.t('36'))),
 ('record_psp_event', format($$SELECT record_psp_event(%L, 'EV-ISO', 'UNKNOWN', NULL, '{}')$$, pg_temp.k('wave1'))),
 ('read_psp_event_body', format($$SELECT read_psp_event_body(%L, %L)$$, (SELECT id FROM ev3), pg_temp.id('38e011'))),
 ('complete_psp_topup', format($$SELECT complete_psp_topup(%L, %L, 0)$$, pg_temp.t('36'), pg_temp.t('36'))),
 ('complete_card_topup', format($$SELECT complete_card_topup(%L, %L, 0, 'fp', 'SUCCEEDED')$$, pg_temp.t('53'), pg_temp.t('53'))),
 ('fail_psp_topup', format($$SELECT fail_psp_topup(%L, 'PSP_FAILED', true)$$, pg_temp.t('36'))),
 ('card_topups_today', format($$SELECT card_topups_today(%L, 'fpA', now())$$, (SELECT ledger_id FROM psp_topup WHERE psp_topup_id = pg_temp.t('50')))),
 ('wallet_card_count', format($$SELECT wallet_card_count(%L, 'fpA')$$, pg_temp.wl('wc7'))),
 ('record_chargeback', format($$SELECT record_chargeback(%L, 'DSP-ISO', 1)$$, pg_temp.t('60'))),
 ('attach_chargeback_tx', format($$SELECT attach_chargeback_tx(%L, %L)$$, (SELECT id FROM cbl), (SELECT id FROM cbt))),
 ('block_wallet_after_chargeback', format($$SELECT block_wallet_after_chargeback(%L, %L)$$, pg_temp.wl('wc11'), (SELECT id FROM cbl))),
 ('unblock_wallet', format($$SELECT unblock_wallet(%L, %L)$$, pg_temp.wl('wc11'), pg_temp.id('38aa57')));
SELECT pg_temp.sb();
SELECT is(pg_temp.code(sql), CASE label WHEN 'create_psp_topup' THEN 'P0002' ELSE 'P0002' END,
  'prestataire B, objet de A : P0002 (' || label || ')') FROM iso;
SELECT pg_temp.nosession();
SELECT is(pg_temp.code(sql), 'P0002', 'sans session : P0002 (' || label || ')') FROM iso;
SELECT pg_temp.sb();
SELECT is(expire_psp_topups(ARRAY[pg_temp.t('36')]), 0, 'expire_psp_topups d''un autre prestataire : ignoré');
SELECT pg_temp.sa();
SELECT is(pg_temp.st('36'), 'PENDING', 'la recharge de A n''a pas bougé');
-- Isolation des lectures (RLS) pour un rôle soumis à la RLS.
SELECT is((SELECT count(*)::int FROM psp_topup WHERE operator_id = pg_temp.id('38a002')), 0,
  'aucune recharge de B n''a été créée par les tentatives');

SELECT * FROM finish();
ROLLBACK;
