-- Configurations de prestataire de paiement, choix par événement, résolution, comptes A-PSP-* et
-- portée de frais PSP_CONFIGURATION (migration 0037 ; mission recharges-caisses-psp, lot WP03)
-- — pgTAP, écrit à la main (pas un fichier généré).
-- Lancer : pg_prove -d <base> tests/tests_psp_configurations.sql (base créée par les migrations,
-- roles.sql et post-roles.sql rejoués).
-- Les droits par rôle (accords, retraits de colonnes) sont testés par le lot WP05. Ici, le
-- propriétaire (superutilisateur local) appelle les fonctions : chaque contrôle testé est celui de
-- la FONCTION ou du déclencheur, jamais une vérification faite à sa place par le propriétaire.
-- Toutes les dates sont relatives à clock_timestamp() (aucune comparaison avec l'horloge de Node).
\set ON_ERROR_STOP 1
\set QUIET 1
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

-- Identifiants : pg_temp.id('37a001') = '00000000-0000-0000-0000-00000037a001'.
CREATE FUNCTION pg_temp.id(p text) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT ('00000000-0000-0000-0000-' || lpad(p, 12, '0'))::uuid $$;
-- Code d'erreur (5 caractères) et message de l'exécution d'une instruction, ou 'ok'.
CREATE FUNCTION pg_temp.err(p text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE p; RETURN 'ok';
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE || ' ' || SQLERRM; END $$;
CREATE FUNCTION pg_temp.code(p text) RETURNS text LANGUAGE sql AS
  $$ SELECT left(pg_temp.err(p), 5) $$;
CREATE FUNCTION pg_temp.sa() RETURNS void LANGUAGE sql AS
  $$ SELECT set_config('app.operator_id', pg_temp.id('37a001')::text, true) $$;
CREATE FUNCTION pg_temp.sb() RETURNS void LANGUAGE sql AS
  $$ SELECT set_config('app.operator_id', pg_temp.id('37a002')::text, true) $$;
CREATE FUNCTION pg_temp.nosession() RETURNS void LANGUAGE sql AS
  $$ SELECT set_config('app.operator_id', '', true) $$;

-- Données (propriétaire) ------------------------------------------------------------------------
-- A : organisateurs b001 et b002 ; événements d001 (fonds : organisateur b001), d002 (fonds :
-- prestataire a001), d003 (futur CLOSING), d004 (futur LIVE), d005 (organisateur b002), d006 (sans
-- grand livre). B : organisateur b011, événement d011.
INSERT INTO party (kind, legal_name) SELECT 'PLATFORM', 'Plateforme (test)'
 WHERE NOT EXISTS (SELECT 1 FROM party WHERE kind = 'PLATFORM');
INSERT INTO party (id, kind, legal_name, country_code) VALUES
 (pg_temp.id('37a001'), 'OPERATOR', 'Prestataire A', 'SN'),
 (pg_temp.id('37a002'), 'OPERATOR', 'Prestataire B', 'CI');
INSERT INTO party (id, kind, operator_id, legal_name) VALUES
 (pg_temp.id('37b001'), 'ORGANIZER', pg_temp.id('37a001'), 'Organisateur A1'),
 (pg_temp.id('37b002'), 'ORGANIZER', pg_temp.id('37a001'), 'Organisateur A2'),
 (pg_temp.id('37b011'), 'ORGANIZER', pg_temp.id('37a002'), 'Organisateur B');
INSERT INTO jurisdiction_profile (id, country_code, version, valid_from, breakage_destination)
VALUES (pg_temp.id('37c001'), 'SN', 370037, '2026-01-01', 'ORGANIZER');
INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone, jurisdiction_id,
                   funds_holder) VALUES
 (pg_temp.id('37d001'), pg_temp.id('37a001'), pg_temp.id('37b001'), 'Événement 1', 'XOF',
  'Africa/Dakar', pg_temp.id('37c001'), 'ORGANIZER'),
 (pg_temp.id('37d002'), pg_temp.id('37a001'), pg_temp.id('37b001'), 'Événement 2', 'XOF',
  'Africa/Dakar', pg_temp.id('37c001'), 'OPERATOR'),
 (pg_temp.id('37d003'), pg_temp.id('37a001'), pg_temp.id('37b001'), 'Événement 3', 'XOF',
  'Africa/Dakar', pg_temp.id('37c001'), 'ORGANIZER'),
 (pg_temp.id('37d004'), pg_temp.id('37a001'), pg_temp.id('37b001'), 'Événement 4', 'XOF',
  'Africa/Dakar', pg_temp.id('37c001'), 'ORGANIZER'),
 (pg_temp.id('37d005'), pg_temp.id('37a001'), pg_temp.id('37b002'), 'Événement 5', 'XOF',
  'Africa/Dakar', pg_temp.id('37c001'), 'ORGANIZER'),
 (pg_temp.id('37d006'), pg_temp.id('37a001'), pg_temp.id('37b001'), 'Événement 6', 'XOF',
  'Africa/Dakar', pg_temp.id('37c001'), 'ORGANIZER'),
 (pg_temp.id('37d011'), pg_temp.id('37a002'), pg_temp.id('37b011'), 'Événement B', 'XOF',
  'Africa/Dakar', pg_temp.id('37c001'), 'ORGANIZER');
-- Grands livres par open_event_ledger (jamais fabriqués à la main).
SELECT pg_temp.sa();
SELECT count(open_event_ledger(pg_temp.id(e))) FROM unnest(ARRAY['37d001','37d002','37d003','37d004',
                                                          '37d005']) e;
SELECT pg_temp.sb();
SELECT count(open_event_ledger(pg_temp.id('37d011')));
-- Personnes : A : e001, e002, e003 OPERATOR_ADMIN, e004 sans rôle, o101 et o102 ORGANIZER_ADMIN de
-- b001. B : e011, e012 OPERATOR_ADMIN, o111 ORGANIZER_ADMIN de b011.
INSERT INTO app_user (id, operator_id, issuer, subject, email, display_name)
SELECT pg_temp.id(u), pg_temp.id(o), 'https://idp.test', 's' || u, u || '@test', 'Personne ' || u
  FROM (VALUES ('37e001','37a001'), ('37e002','37a001'), ('37e003','37a001'), ('37e004','37a001'),
               ('37f101','37a001'), ('37f102','37a001'),
               ('37e011','37a002'), ('37e012','37a002'), ('37f111','37a002')) AS v(u, o);
INSERT INTO role_assignment (user_id, role, scope_type, scope_id, granted_by)
SELECT pg_temp.id(u), 'OPERATOR_ADMIN', 'OPERATOR', pg_temp.id(o), NULL
  FROM (VALUES ('37e001','37a001'), ('37e002','37a001'), ('37e003','37a001'),
               ('37e011','37a002'), ('37e012','37a002')) AS v(u, o);
INSERT INTO role_assignment (user_id, role, scope_type, scope_id, granted_by)
SELECT pg_temp.id(u), 'ORGANIZER_ADMIN', 'ORGANIZER', pg_temp.id(o), NULL
  FROM (VALUES ('37f101','37b001'), ('37f102','37b001'), ('37f111','37b011')) AS v(u, o);

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
                           p_actor text DEFAULT '37e001') RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_id uuid;
BEGIN
  v_id := create_psp_configuration(pg_temp.id(p_org), p_method, p_provider, pg_temp.id(p_holder),
            'psp/' || pg_temp.id(p_holder) || '/' || p_name, p_default, p_from, p_until,
            pg_temp.id(p_actor), CASE WHEN p_super IS NULL THEN NULL ELSE pg_temp.k(p_super) END);
  INSERT INTO k VALUES (p_name, v_id);
END $$;
-- Règle de frais explicite d'une configuration (propriétaire).
CREATE FUNCTION pg_temp.fee(p_cfg text, p_op text DEFAULT '37a001', p_basis text DEFAULT 'TOPUP_AMOUNT',
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
                             p_by text DEFAULT '37e003', p_dec text DEFAULT '37e002')
RETURNS void LANGUAGE sql AS $$
  SELECT pg_temp.req(p_id, '37a001', 'PSP_CONFIGURATION', pg_temp.k(p_cfg),
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
CREATE FUNCTION pg_temp.st(p_cfg text) RETURNS text LANGUAGE sql AS
  $$ SELECT status FROM psp_configuration WHERE psp_configuration_id = pg_temp.k(p_cfg) $$;
-- Contrôle d'une configuration : code d'erreur de l'activation par la demande indiquée.
CREATE FUNCTION pg_temp.act(p_cfg text, p_req text) RETURNS text LANGUAGE sql AS $$
  SELECT pg_temp.code(format('SELECT activate_psp_configuration(%L, %L)', pg_temp.k(p_cfg),
                             pg_temp.id(p_req)))
$$;
-- Sonde de rôle sans aucun droit.
DROP ROLE IF EXISTS psp_probe;
CREATE ROLE psp_probe;

-- 1. Structure ------------------------------------------------------------------------------------
SELECT is((SELECT count(*)::int FROM pg_class
            WHERE relname IN ('psp_configuration','event_psp_selection')
              AND relrowsecurity AND relforcerowsecurity), 2,
  'RLS activée et forcée sur psp_configuration et event_psp_selection');
SELECT is((SELECT count(*)::int FROM pg_policies
            WHERE tablename IN ('psp_configuration','event_psp_selection')
              AND policyname = 'tenant_isolation'), 2, 'politique tenant_isolation sur les deux tables');
SELECT is((SELECT count(*)::int FROM pg_constraint
            WHERE conrelid = 'psp_configuration'::regclass
              AND conname IN ('psp_configuration_method','psp_configuration_provider',
                              'psp_configuration_method_provider','psp_configuration_status',
                              'psp_configuration_secret_ref_holder',
                              'psp_configuration_secret_ref_format','psp_configuration_validity',
                              'psp_configuration_two_persons','psp_configuration_activated',
                              'psp_configuration_version')), 10,
  'les dix contraintes nommées de psp_configuration existent');
SELECT is((SELECT count(*)::int FROM pg_indexes
            WHERE indexname IN ('psp_configuration_default_active','psp_configuration_one_successor')
              AND indexdef LIKE '%UNIQUE%'), 2, 'deux index uniques (défaut actif, une seule suivante)');
SELECT is((SELECT count(*)::int FROM pg_proc
            WHERE proname IN ('psp_operator_admin','psp_organizer_admin','psp_account_code',
                              'create_psp_configuration','activate_psp_configuration',
                              'set_event_psp_selection','resolve_psp_configuration',
                              'psp_configuration_secret_ref','psp_webhook_context',
                              'open_psp_accounts','assert_no_legacy_psp_fee_rules',
                              'psp_configuration_immutable','event_psp_selection_guard')
              AND (prosecdef OR proname = 'psp_account_code')
              AND proconfig @> ARRAY['search_path=public, pg_temp']), 13,
  'treize fonctions : SECURITY DEFINER (sauf le code de compte, pur), search_path public, pg_temp');
SELECT is((SELECT count(*)::int FROM pg_proc p
            WHERE proname IN ('psp_operator_admin','psp_organizer_admin','psp_account_code',
                              'create_psp_configuration','activate_psp_configuration',
                              'set_event_psp_selection','resolve_psp_configuration',
                              'psp_configuration_secret_ref','psp_webhook_context',
                              'open_psp_accounts','assert_no_legacy_psp_fee_rules')
              AND has_function_privilege('psp_probe', p.oid, 'EXECUTE')), 0,
  'aucune fonction du lot n''est exécutable par PUBLIC');
SELECT is((SELECT count(*)::int FROM pg_proc WHERE proname = 'fee_rule_guard' AND prosecdef
              AND proconfig @> ARRAY['search_path=public, pg_temp']), 1,
  'fee_rule_guard reste SECURITY DEFINER avec search_path fixé');

-- open_event_ledger INCHANGÉE (corps et mode de sécurité de 0008) : aucun compte A-PSP-*.
SELECT is((SELECT md5(prosrc) FROM pg_proc WHERE proname = 'open_event_ledger'),
  'fae8dc9516694bbab3c3176fa46854e7', 'open_event_ledger : corps inchangé');
SELECT ok((SELECT NOT prosecdef AND proconfig = ARRAY['search_path=public'] FROM pg_proc
            WHERE proname = 'open_event_ledger'), 'open_event_ledger : toujours SECURITY INVOKER');
SELECT is((SELECT count(*)::int FROM account a JOIN ledger l ON l.id = a.ledger_id
            WHERE l.scope_id = pg_temp.id('37d003') AND a.purpose = 'PSP'), 0,
  'un grand livre neuf n''a aucun compte A-PSP-* tant que open_psp_accounts n''est pas appelée');

-- 2. secret_ref : jamais un secret ----------------------------------------------------------------
SELECT pg_temp.sa();
CREATE FUNCTION pg_temp.try_ref(p_ref text) RETURNS text LANGUAGE sql AS $$
  SELECT pg_temp.err(format($f$SELECT create_psp_configuration(%L, 'WAVE', 'WAVE', %L, %L, false,
                              clock_timestamp(), NULL, %L)$f$, pg_temp.id('37b001'),
                            pg_temp.id('37b001'), p_ref, pg_temp.id('37e001')))
$$;
SELECT is(left(pg_temp.try_ref('psp/' || pg_temp.id('37b002') || '/ref1'), 5), 'CL001',
  'secret_ref d''un autre titulaire refusé');
SELECT is(left(pg_temp.try_ref('psp/' || pg_temp.id('37b001') || '/ref 1'), 5), 'CL001',
  'secret_ref avec une espace refusé');
SELECT is(left(pg_temp.try_ref('psp/' || pg_temp.id('37b001') || '/a+b/c=='), 5), 'CL001',
  'secret_ref qui ressemble à un secret encodé (+, /, =) refusé');
SELECT is(left(pg_temp.try_ref('psp/' || pg_temp.id('37b001') || '/' || repeat('x', 101)), 5), 'CL001',
  'secret_ref trop long refusé');
SELECT is(left(pg_temp.try_ref('sk_live_51Habcdef'), 5), 'CL001', 'une clé de service en clair refusée');
SELECT ok(pg_temp.try_ref('sk_live_51Habcdef') NOT LIKE '%sk_live%',
  'le message d''erreur ne répète pas la valeur fournie');
SELECT is(pg_temp.try_ref('psp/' || pg_temp.id('37b001') || '/valide-1.v2_ok'),  'ok',
  'secret_ref conforme accepté (brouillon)');
-- Contraintes de table, écriture directe (propriétaire).
SELECT throws_ok(format($$INSERT INTO psp_configuration (operator_id, organizer_id, method, provider,
    holder_party_id, secret_ref, valid_from, created_by) VALUES (%L, %L, 'WAVE', 'WAVE', %L, %L,
    now(), %L)$$, pg_temp.id('37a001'), pg_temp.id('37b001'), pg_temp.id('37b001'),
    'psp/' || pg_temp.id('37b002') || '/x', pg_temp.id('37e001')),
  '23514', NULL, 'contrainte : secret_ref d''un autre titulaire refusé en écriture directe');
SELECT throws_ok(format($$INSERT INTO psp_configuration (operator_id, organizer_id, method, provider,
    holder_party_id, secret_ref, valid_from, created_by) VALUES (%L, %L, 'CARD', 'WAVE', %L, %L,
    now(), %L)$$, pg_temp.id('37a001'), pg_temp.id('37b001'), pg_temp.id('37b001'),
    'psp/' || pg_temp.id('37b001') || '/x', pg_temp.id('37e001')),
  '23514', NULL, 'contrainte : correspondance (moyen, fournisseur) imposée');

-- 3. Création, activation, suspension, réactivation, versions ---------------------------------------
SELECT pg_temp.sa();
SELECT pg_temp.mk('wave1', '37b001', 'WAVE', 'WAVE', '37b001', true);
SELECT pg_temp.mk('wave_h2', '37b001', 'WAVE', 'WAVE', '37a001', false);
SELECT pg_temp.mk('om1', '37b001', 'ORANGE_MONEY', 'ORANGE_MONEY', '37b001', true);
SELECT pg_temp.mk('card1', '37b001', 'CARD', 'PAYDUNYA', '37b001', true);
SELECT pg_temp.mk('card2', '37b001', 'CARD', 'STRIPE', '37b001', false);
SELECT pg_temp.mk('draft1', '37b001', 'WAVE', 'WAVE', '37b001', false);
SELECT pg_temp.mk('oth', '37b002', 'WAVE', 'WAVE', '37b001', false);
SELECT pg_temp.mk('bwave', '37b002', 'WAVE', 'WAVE', '37b002', true,
                  clock_timestamp() - interval '2 days', clock_timestamp() + interval '2 seconds');
SELECT pg_temp.mk('exp', '37b001', 'ORANGE_MONEY', 'ORANGE_MONEY', '37b001', false,
                  clock_timestamp() - interval '2 days', clock_timestamp() + interval '2 seconds');
SELECT is((SELECT status || ':' || version FROM psp_configuration WHERE psp_configuration_id = pg_temp.k('wave1')),
  'DRAFT:1', 'création : brouillon, version 1');
SELECT is((SELECT created_by FROM psp_configuration WHERE psp_configuration_id = pg_temp.k('wave1')),
  pg_temp.id('37e001'), 'création : created_by = l''auteur');

-- Création : refus.
SELECT is(pg_temp.code(format($$SELECT create_psp_configuration(%L, 'WAVE', 'WAVE', %L, %L, false,
    clock_timestamp(), NULL, %L)$$, pg_temp.id('37b001'), pg_temp.id('37b001'),
    'psp/' || pg_temp.id('37b001') || '/z', pg_temp.id('37e004'))), 'P0002',
  'création par une personne sans OPERATOR_ADMIN : P0002');
SELECT is(pg_temp.code(format($$SELECT create_psp_configuration(%L, 'WAVE', 'WAVE', %L, %L, false,
    clock_timestamp(), NULL, %L)$$, pg_temp.id('37b001'), pg_temp.id('37b001'),
    'psp/' || pg_temp.id('37b001') || '/z', pg_temp.id('37f101'))), 'P0002',
  'création par un ORGANIZER_ADMIN : P0002');
SELECT is(pg_temp.code(format($$SELECT create_psp_configuration(%L, 'WAVE', 'WAVE', %L, %L, false,
    clock_timestamp(), NULL, %L)$$, pg_temp.id('37b001'), pg_temp.id('37b011'),
    'psp/' || pg_temp.id('37b011') || '/z', pg_temp.id('37e001'))), 'P0002',
  'création avec un titulaire d''un autre prestataire : P0002');
SELECT is(pg_temp.code(format($$SELECT create_psp_configuration(%L, 'WAVE', 'WAVE', %L, %L, false,
    clock_timestamp() + interval '1 day', clock_timestamp(), %L)$$, pg_temp.id('37b001'),
    pg_temp.id('37b001'), 'psp/' || pg_temp.id('37b001') || '/z', pg_temp.id('37e001'))), 'CL001',
  'création : fin avant début refusée');

-- Activation : refus.
SELECT pg_temp.preq('3a0001', 'wave1');
SELECT is(pg_temp.act('wave1', '3a0001'), 'CL029', 'activation sans règle de frais : refusée (CL029)');
SELECT ok(pg_temp.err(format('SELECT activate_psp_configuration(%L, %L)', pg_temp.k('wave1'),
    pg_temp.id('3a0001'))) LIKE '%règle de frais explicite requise%', 'message : règle de frais explicite requise');
SELECT is(pg_temp.code($$SELECT pg_temp.fee('wave1', '37a001', 'SALE_AMOUNT')$$), 'CL001',
  'la base refuse une règle PSP_CONFIGURATION d''une autre base de calcul');
SELECT is(pg_temp.code($$SELECT pg_temp.fee('wave1', '37a002')$$), 'CL001',
  'la base refuse une règle PSP_CONFIGURATION d''un autre prestataire');
SELECT pg_temp.fee('wave1', 'NULL', 'TOPUP_AMOUNT', 'OPE_TVA');
SELECT is(pg_temp.act('wave1', '3a0001'), 'CL029',
  'activation avec une règle de frais sans prestataire (niveau plateforme) : refusée');
SELECT pg_temp.fee('wave1');   -- règle à 0 % : suffit
SELECT pg_temp.preq('3a0002', 'wave1', 1, NULL, 'BCEAO-2026-001', '37e002', '37e001');
SELECT is(pg_temp.act('wave1', '3a0002'), 'CL023', 'activation par la personne qui a créé la configuration : refusée');
SELECT pg_temp.preq('3a0003', 'wave1', 2);
SELECT is(pg_temp.act('wave1', '3a0003'), 'CL023', 'demande liée à une autre version : refusée');
SELECT pg_temp.preq('3a0004', 'draft1');
SELECT is(pg_temp.act('wave1', '3a0004'), 'CL023', 'demande d''une autre configuration : refusée');
SELECT pg_temp.req('3a0005', '37a001', 'PSP_CONFIGURATION', pg_temp.k('wave1'),
  jsonb_build_object('psp_configuration_id', pg_temp.k('wave1'), 'version', 1,
                     'compliance_ref', 'BCEAO-1'), '37e003', NULL);
SELECT is(pg_temp.act('wave1', '3a0005'), 'CL023', 'demande non décidée (PENDING) : refusée');
SELECT pg_temp.req('3a0006', '37a001', 'ADJUSTMENT', pg_temp.k('wave1'),
  jsonb_build_object('psp_configuration_id', pg_temp.k('wave1'), 'version', 1,
                     'compliance_ref', 'BCEAO-1'), '37e003', '37e002');
SELECT is(pg_temp.act('wave1', '3a0006'), 'CL023', 'demande d''une autre action : refusée');
SELECT pg_temp.preq('3a0007', 'wave1', 1, NULL, NULL);
SELECT is(pg_temp.act('wave1', '3a0007'), 'CL023', 'première activation sans compliance_ref : refusée');
SELECT pg_temp.preq('3a0008', 'wave1', 1, NULL, repeat('c', 201));
SELECT is(pg_temp.act('wave1', '3a0008'), 'CL023', 'compliance_ref de plus de 200 caractères : refusée');
SELECT pg_temp.preq('3a0009', 'wave1', 1, NULL, 'BCEAO-2026-001', '37e004', '37e002');
SELECT is(pg_temp.act('wave1', '3a0009'), 'CL023', 'auteur de la demande sans OPERATOR_ADMIN : refusée');
SELECT pg_temp.preq('3a0010', 'wave1', 1, NULL, 'BCEAO-2026-001', '37e003', '37f101');
SELECT is(pg_temp.act('wave1', '3a0010'), 'CL023', 'valideur sans OPERATOR_ADMIN : refusée');
SELECT pg_temp.preq('3a0011', 'wave1', 1, 'DRAFT');
SELECT is(pg_temp.act('wave1', '3a0011'), 'CL023', 'statut visé DRAFT : refusé');
SELECT pg_temp.req('3a0012', '37a002', 'PSP_CONFIGURATION', pg_temp.k('wave1'),
  jsonb_build_object('psp_configuration_id', pg_temp.k('wave1'), 'version', 1,
                     'compliance_ref', 'BCEAO-1'), '37e011', '37e012');
SELECT pg_temp.sa();
SELECT is(pg_temp.act('wave1', '3a0012'), 'P0002', 'demande d''un autre prestataire : P0002');
SELECT is(pg_temp.st('wave1'), 'DRAFT', 'aucun refus n''a modifié la configuration');

-- Activation : succès, rejeu, suspension, réactivation.
SELECT pg_temp.preq('3a0020', 'wave1', 1, NULL, '  BCEAO-2026-001  ');
SELECT pg_temp.sa();
SELECT lives_ok(format('SELECT activate_psp_configuration(%L, %L)', pg_temp.k('wave1'), pg_temp.id('3a0020')),
  'DRAFT -> ACTIVE par deux personnes, règle de frais à 0 %');
SELECT is((SELECT status || '|' || compliance_ref || '|' || (approved_by = pg_temp.id('37e002'))
             || '|' || (activated_at IS NOT NULL) || '|' || (last_request_id = pg_temp.id('3a0020'))
             FROM psp_configuration WHERE psp_configuration_id = pg_temp.k('wave1')),
  'ACTIVE|BCEAO-2026-001|true|true|true',
  'activation : statut, conformité rognée, valideur, date et demande notés');
SELECT is(pg_temp.act('wave1', '3a0020'), 'CL023', 'rejeu de la même demande : refusé');
SELECT pg_temp.preq('3a0021', 'wave1');
SELECT is(pg_temp.act('wave1', '3a0021'), 'CL029', 'activer une configuration déjà active : CL029');
SELECT pg_temp.preq('3a0022', 'wave1', 1, 'SUSPENDED', NULL);
SELECT lives_ok(format('SELECT activate_psp_configuration(%L, %L)', pg_temp.k('wave1'), pg_temp.id('3a0022')),
  'ACTIVE -> SUSPENDED par la demande de suspension');
SELECT is(pg_temp.st('wave1'), 'SUSPENDED', 'suspendue');
SELECT is(pg_temp.act('wave1', '3a0022'), 'CL023', 'rejeu de la suspension : refusé');
SELECT is(pg_temp.act('wave1', '3a0020'), 'CL023', 'rejeu de l''activation après suspension : refusé (date)');
SELECT pg_temp.preq('3a0023', 'wave1', 1, 'SUSPENDED', NULL);
SELECT is(pg_temp.act('wave1', '3a0023'), 'CL029', 'suspendre une configuration déjà suspendue : CL029');
SELECT pg_temp.preq('3a0024', 'wave1', 1, NULL, NULL, '37e003', '37e001');
SELECT is(pg_temp.act('wave1', '3a0024'), 'CL023', 'réactivation par la personne qui l''a créée : refusée');
SELECT pg_temp.preq('3a0025', 'wave1', 1, NULL, NULL);
SELECT lives_ok(format('SELECT activate_psp_configuration(%L, %L)', pg_temp.k('wave1'), pg_temp.id('3a0025')),
  'SUSPENDED -> ACTIVE : réactivation sans nouvelle référence de conformité');
SELECT is((SELECT status || '|' || compliance_ref FROM psp_configuration
            WHERE psp_configuration_id = pg_temp.k('wave1')), 'ACTIVE|BCEAO-2026-001',
  'réactivation : la référence de conformité est conservée');

-- Défaut unique.
SELECT pg_temp.mk('wave_dup', '37b001', 'WAVE', 'WAVE', '37b001', true);
SELECT pg_temp.fee('wave_dup');
SELECT pg_temp.preq('3a0030', 'wave_dup');
SELECT is(pg_temp.act('wave_dup', '3a0030'), 'CL029', 'deuxième défaut actif pour (organisateur, moyen) : CL029');
SELECT is(pg_temp.st('wave_dup'), 'DRAFT', 'le doublon reste brouillon');
SELECT throws_ok(format($$INSERT INTO psp_configuration (operator_id, organizer_id, method, provider,
    holder_party_id, secret_ref, valid_from, created_by, status, is_default, approved_by,
    compliance_ref) VALUES (%L, %L, 'WAVE', 'WAVE', %L, %L, now(), %L, 'ACTIVE', true, %L, 'X')$$,
    pg_temp.id('37a001'), pg_temp.id('37b001'), pg_temp.id('37b001'),
    'psp/' || pg_temp.id('37b001') || '/direct', pg_temp.id('37e001'), pg_temp.id('37e002')),
  '23505', NULL, 'index unique : deux défauts ACTIVE en écriture directe refusés');

-- Versions : la nouvelle suspend l'ancienne.
SELECT pg_temp.mk('wave2', '37b001', 'WAVE', 'WAVE', '37b001', true,
                  clock_timestamp() - interval '2 days', NULL, 'wave1');
SELECT is((SELECT version FROM psp_configuration WHERE psp_configuration_id = pg_temp.k('wave2')), 2,
  'nouvelle version : numéro = ancienne + 1');
SELECT is(pg_temp.code(format($$SELECT create_psp_configuration(%L, 'WAVE', 'WAVE', %L, %L, false,
    clock_timestamp(), NULL, %L, %L)$$, pg_temp.id('37b001'), pg_temp.id('37b001'),
    'psp/' || pg_temp.id('37b001') || '/w3', pg_temp.id('37e001'), pg_temp.k('wave1'))), 'CL029',
  'une version ne reçoit qu''une suivante');
SELECT is(pg_temp.code(format($$SELECT create_psp_configuration(%L, 'WAVE', 'WAVE', %L, %L, false,
    clock_timestamp(), NULL, %L, %L)$$, pg_temp.id('37b002'), pg_temp.id('37b001'),
    'psp/' || pg_temp.id('37b001') || '/w4', pg_temp.id('37e001'), pg_temp.k('draft1'))), 'CL001',
  'version suivante d''un autre organisateur : refusée');
SELECT pg_temp.preq('3a0040', 'wave2', 2);
SELECT is(pg_temp.act('wave2', '3a0040'), 'CL029', 'nouvelle version sans sa propre règle de frais : refusée');
SELECT pg_temp.fee('wave2');
SELECT pg_temp.preq('3a0041', 'wave2', 1);
SELECT is(pg_temp.act('wave2', '3a0041'), 'CL023', 'demande de la version 1 rejouée pour la version 2 : refusée');
SELECT lives_ok(format('SELECT activate_psp_configuration(%L, %L)', pg_temp.k('wave2'), pg_temp.id('3a0040')),
  'version 2 activée (défaut) : l''ancienne version active est suspendue d''abord');
SELECT is(pg_temp.st('wave1') || '/' || pg_temp.st('wave2'), 'SUSPENDED/ACTIVE',
  'ancienne version SUSPENDED, nouvelle ACTIVE');
SELECT pg_temp.preq('3a0042', 'wave1');
SELECT is(pg_temp.act('wave1', '3a0042'), 'CL029', 'réactivation d''une version remplacée : refusée');

-- Immuabilité et suppression (propriétaire).
SELECT is(pg_temp.code(format('UPDATE psp_configuration SET secret_ref = %L WHERE psp_configuration_id = %L',
    'psp/' || pg_temp.id('37b001') || '/autre', pg_temp.k('wave2'))), 'CL001',
  'UPDATE de secret_ref refusé, même par le propriétaire');
SELECT is(pg_temp.code(format('UPDATE psp_configuration SET holder_party_id = %L WHERE psp_configuration_id = %L',
    pg_temp.id('37b002'), pg_temp.k('wave2'))), 'CL001', 'UPDATE du titulaire refusé');
SELECT is(pg_temp.code(format('UPDATE psp_configuration SET version = 9 WHERE psp_configuration_id = %L',
    pg_temp.k('wave2'))), 'CL001', 'UPDATE de la version refusé');
SELECT is(pg_temp.code(format('UPDATE psp_configuration SET valid_until = now() + interval ''9 days'' WHERE psp_configuration_id = %L',
    pg_temp.k('wave2'))), 'CL001', 'UPDATE des dates refusé');
SELECT is(pg_temp.code(format('DELETE FROM psp_configuration WHERE psp_configuration_id = %L',
    pg_temp.k('draft1'))), 'CL001', 'DELETE refusé, même d''un brouillon');
SELECT is(pg_temp.code(format('UPDATE psp_configuration SET status = ''DRAFT'' WHERE psp_configuration_id = %L',
    pg_temp.k('wave2'))), 'CL001', 'ACTIVE -> DRAFT refusé');
SELECT is(pg_temp.code(format('UPDATE psp_configuration SET compliance_ref = ''AUTRE'' WHERE psp_configuration_id = %L',
    pg_temp.k('wave2'))), 'CL001', 'référence de conformité figée après activation');

-- Activer le reste (fixtures des sections suivantes).
SELECT pg_temp.quick('wave_h2', '3a0050');
SELECT pg_temp.quick('om1', '3a0051');
SELECT pg_temp.quick('card1', '3a0052');
SELECT pg_temp.quick('card2', '3a0053');
SELECT pg_temp.quick('oth', '3a0054');
SELECT pg_temp.quick('bwave', '3a0055');
SELECT pg_temp.fee('exp');
SELECT pg_temp.preq('3a0056', 'exp');
SELECT pg_temp.sa();
SELECT pg_sleep(2.2);
SELECT is(pg_temp.act('exp', '3a0056'), 'CL029', 'configuration à la période de validité échue : activation refusée');

-- 4. Défaut unique, version précédente : voir section 3 (CL029, 23505, suspension de l'ancienne).

-- 5. Choix par événement ---------------------------------------------------------------------------
SELECT pg_temp.sa();
-- Les cinq refus du déclencheur (écriture directe en propriétaire).
SELECT is(pg_temp.code(format($$INSERT INTO event_psp_selection (event_id, method, psp_configuration_id,
    selected_by, operator_id) VALUES (%L, 'WAVE', %L, %L, %L)$$, pg_temp.id('37d001'), pg_temp.k('oth'),
    pg_temp.id('37f101'), pg_temp.id('37a001'))), 'CL001', 'déclencheur : configuration d''un autre organisateur');
SELECT is(pg_temp.code(format($$INSERT INTO event_psp_selection (event_id, method, psp_configuration_id,
    selected_by, operator_id) VALUES (%L, 'WAVE', %L, %L, %L)$$, pg_temp.id('37d001'), pg_temp.k('draft1'),
    pg_temp.id('37f101'), pg_temp.id('37a001'))), 'CL001', 'déclencheur : configuration DRAFT');
SELECT is(pg_temp.code(format($$INSERT INTO event_psp_selection (event_id, method, psp_configuration_id,
    selected_by, operator_id) VALUES (%L, 'WAVE', %L, %L, %L)$$, pg_temp.id('37d001'), pg_temp.k('wave1'),
    pg_temp.id('37f101'), pg_temp.id('37a001'))), 'CL001', 'déclencheur : configuration SUSPENDED');
SELECT is(pg_temp.code(format($$INSERT INTO event_psp_selection (event_id, method, psp_configuration_id,
    selected_by, operator_id) VALUES (%L, 'WAVE', %L, %L, %L)$$, pg_temp.id('37d001'), pg_temp.k('om1'),
    pg_temp.id('37f101'), pg_temp.id('37a001'))), 'CL001', 'déclencheur : configuration d''un autre moyen');
SELECT is(pg_temp.code(format($$INSERT INTO event_psp_selection (event_id, method, psp_configuration_id,
    selected_by, operator_id) VALUES (%L, 'WAVE', %L, %L, %L)$$, pg_temp.id('37d002'), pg_temp.k('wave2'),
    pg_temp.id('37f101'), pg_temp.id('37a001'))), 'CL001',
  'déclencheur : titulaire différent du détenteur des fonds du grand livre');
SELECT is(pg_temp.code(format($$INSERT INTO event_psp_selection (event_id, method, psp_configuration_id,
    selected_by, operator_id) VALUES (%L, 'WAVE', %L, %L, %L)$$, pg_temp.id('37d006'), pg_temp.k('wave2'),
    pg_temp.id('37f101'), pg_temp.id('37a001'))), 'CL001', 'déclencheur : événement sans grand livre');
SELECT is(pg_temp.code(format($$INSERT INTO event_psp_selection (event_id, method, psp_configuration_id,
    selected_by, operator_id) VALUES (%L, 'WAVE', %L, %L, %L)$$, pg_temp.id('37d011'), pg_temp.k('wave2'),
    pg_temp.id('37f101'), pg_temp.id('37a001'))), 'CL001', 'déclencheur : événement d''un autre prestataire');

-- Événement en brouillon : écriture directe, comptes A-PSP-* ouverts dans la même transaction.
SELECT lives_ok(format($$SELECT set_event_psp_selection(%L, 'WAVE', %L, %L)$$, pg_temp.id('37d001'),
    pg_temp.k('wave2'), pg_temp.id('37f101')), 'événement DRAFT : choix direct par un ORGANIZER_ADMIN');
SELECT is((SELECT count(*)::int FROM account a JOIN ledger l ON l.id = a.ledger_id
            WHERE l.scope_id = pg_temp.id('37d001') AND a.purpose = 'PSP'), 3,
  'le choix ouvre les trois comptes A-PSP-* du grand livre');
SELECT is((SELECT approved_by IS NULL AND selected_by = pg_temp.id('37f101') AND request_id IS NULL
             FROM event_psp_selection WHERE event_id = pg_temp.id('37d001') AND method = 'WAVE'),
  true, 'choix direct : approved_by et request_id nuls');
SELECT is(pg_temp.code(format($$SELECT set_event_psp_selection(%L, 'WAVE', %L, %L, %L)$$,
    pg_temp.id('37d001'), pg_temp.k('wave2'), pg_temp.id('37f101'), pg_temp.id('3a0020'))), 'CL001',
  'événement DRAFT avec une demande : refusé');
SELECT is(pg_temp.code(format($$SELECT set_event_psp_selection(%L, 'WAVE', %L, %L)$$,
    pg_temp.id('37d001'), pg_temp.k('wave2'), pg_temp.id('37e001'))), 'P0002',
  'choix par un OPERATOR_ADMIN (pas ORGANIZER_ADMIN de l''organisateur) : P0002');
SELECT is(pg_temp.code(format($$SELECT set_event_psp_selection(%L, 'WAVE', %L, %L)$$,
    pg_temp.id('37d001'), pg_temp.k('oth'), pg_temp.id('37f101'))), 'CL001',
  'la fonction passe par le déclencheur : configuration d''un autre organisateur refusée');
SELECT is(pg_temp.code(format($$SELECT set_event_psp_selection(%L, 'BITCOIN', %L, %L)$$,
    pg_temp.id('37d001'), pg_temp.k('wave2'), pg_temp.id('37f101'))), 'CL001', 'moyen inconnu : CL001');
-- Événement CLOSING.
SELECT set_config('app.event_status_change', 'on', true);
UPDATE event SET status = 'CLOSING' WHERE id = pg_temp.id('37d003');
SELECT is(pg_temp.code(format($$SELECT set_event_psp_selection(%L, 'WAVE', %L, %L)$$,
    pg_temp.id('37d003'), pg_temp.k('wave2'), pg_temp.id('37f101'))), 'CL029',
  'événement CLOSING : choix refusé (CL029)');
-- Événement LIVE : deux personnes.
UPDATE event SET status = 'LIVE' WHERE id = pg_temp.id('37d004');
SELECT throws_ok(format($$INSERT INTO event_psp_selection (event_id, method, psp_configuration_id,
    selected_by, operator_id) VALUES (%L, 'WAVE', %L, %L, %L)$$, pg_temp.id('37d004'), pg_temp.k('wave2'),
    pg_temp.id('37f101'), pg_temp.id('37a001')),
  'CL001', NULL, 'déclencheur : événement LIVE sans approved_by refusé');
SELECT is(pg_temp.code(format($$SELECT set_event_psp_selection(%L, 'WAVE', %L, %L)$$,
    pg_temp.id('37d004'), pg_temp.k('wave2'), pg_temp.id('37f101'))), 'CL023',
  'événement LIVE sans demande : refusé');
CREATE FUNCTION pg_temp.sreq(p_id text, p_method text, p_cfg text, p_event text DEFAULT '37d004',
                             p_by text DEFAULT '37f101', p_dec text DEFAULT '37f102',
                             p_action text DEFAULT 'EVENT_PSP_SELECTION') RETURNS void LANGUAGE sql AS $$
  SELECT pg_temp.req(p_id, '37a001', p_action, pg_temp.id(p_event),
    jsonb_build_object('event_id', pg_temp.id(p_event), 'method', p_method,
                       'psp_configuration_id', pg_temp.k(p_cfg)), p_by, p_dec)
$$;
CREATE FUNCTION pg_temp.sel(p_method text, p_cfg text, p_req text, p_event text DEFAULT '37d004')
RETURNS text LANGUAGE sql AS $$
  SELECT pg_temp.code(format('SELECT set_event_psp_selection(%L, %L, %L, %L, %L)', pg_temp.id(p_event),
    p_method, pg_temp.k(p_cfg), pg_temp.id('37f101'), pg_temp.id(p_req)))
$$;
SELECT pg_temp.sreq('3b0001', 'CARD', 'wave2');          -- autre moyen que celui demandé
SELECT pg_temp.sreq('3b0002', 'WAVE', 'wave_h2');        -- autre configuration
SELECT pg_temp.sreq('3b0003', 'WAVE', 'wave2', '37d004', '37e001', '37e002');  -- pas ORGANIZER_ADMIN
SELECT pg_temp.sreq('3b0004', 'WAVE', 'wave2', '37d004', '37f101', '37f102', 'ADJUSTMENT');
SELECT pg_temp.sreq('3b0005', 'WAVE', 'wave2', '37d001');   -- autre événement
SELECT pg_temp.sreq('3b0006', 'WAVE', 'wave2');             -- bonne demande
SELECT pg_temp.sa();
SELECT is(pg_temp.sel('WAVE', 'wave2', '3b0001'), 'CL023', 'LIVE : demande d''un autre moyen refusée');
SELECT is(pg_temp.sel('WAVE', 'wave2', '3b0002'), 'CL023', 'LIVE : demande d''une autre configuration refusée');
SELECT is(pg_temp.sel('WAVE', 'wave2', '3b0003'), 'CL023', 'LIVE : demande de personnes qui ne sont pas ORGANIZER_ADMIN refusée');
SELECT is(pg_temp.sel('WAVE', 'wave2', '3b0004'), 'CL023', 'LIVE : demande d''une autre action refusée');
SELECT is(pg_temp.sel('WAVE', 'wave2', '3b0005'), 'CL023', 'LIVE : demande d''un autre événement refusée');
SELECT is(pg_temp.sel('WAVE', 'wave2', '3b0006'), 'ok', 'LIVE : choix par une demande approuvée par une autre personne');
SELECT is((SELECT selected_by || '|' || approved_by || '|' || request_id FROM event_psp_selection
            WHERE event_id = pg_temp.id('37d004') AND method = 'WAVE'),
  pg_temp.id('37f101') || '|' || pg_temp.id('37f102') || '|' || pg_temp.id('3b0006'),
  'LIVE : auteur, valideur et demande notés');
SELECT is(pg_temp.sel('WAVE', 'wave2', '3b0006'), 'CL023', 'LIVE : demande déjà utilisée refusée');
SELECT is((SELECT count(*)::int FROM account a JOIN ledger l ON l.id = a.ledger_id
            WHERE l.scope_id = pg_temp.id('37d004') AND a.purpose = 'PSP'), 3,
  'LIVE : trois comptes A-PSP-*');
-- Une décision antérieure à la dernière sélection ne rejoue pas.
SELECT pg_temp.sreq('3b0007', 'WAVE', 'wave_h2');
SELECT pg_temp.sreq('3b0008', 'WAVE', 'wave2');
SELECT pg_temp.sa();
SELECT is(pg_temp.sel('WAVE', 'wave2', '3b0008'), 'ok', 'LIVE : nouvelle demande, même configuration');
SELECT is(pg_temp.sel('WAVE', 'wave2', '3b0007'), 'CL023', 'LIVE : demande décidée avant la dernière sélection');

-- 6. Résolution revérifiée ---------------------------------------------------------------------------
SELECT pg_temp.sa();
CREATE FUNCTION pg_temp.res(p_event text, p_method text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM resolve_psp_configuration(pg_temp.id(p_event), p_method);
  RETURN r.psp_configuration_id || '|' || r.provider || '|' || r.holder_party_id || '|' || r.from_selection;
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE; END $$;
-- 1. choix valide
SELECT is(pg_temp.res('37d001', 'WAVE'),
  pg_temp.k('wave2') || '|WAVE|' || pg_temp.id('37b001') || '|true', 'résolution : choix valide');
-- 2. défaut valide
SELECT is(pg_temp.res('37d001', 'ORANGE_MONEY'),
  pg_temp.k('om1') || '|ORANGE_MONEY|' || pg_temp.id('37b001') || '|false', 'résolution : défaut valide');
SELECT is(pg_temp.res('37d001', 'CARD'),
  pg_temp.k('card1') || '|PAYDUNYA|' || pg_temp.id('37b001') || '|false', 'résolution : défaut CARD');
-- 3. choix suspendu : refus, pas de repli sur le défaut CARD (card1, actif et valide)
SELECT lives_ok(format($$SELECT set_event_psp_selection(%L, 'CARD', %L, %L)$$, pg_temp.id('37d001'),
    pg_temp.k('card2'), pg_temp.id('37f101')), 'choix CARD (STRIPE) sur l''événement 1');
SELECT is(pg_temp.res('37d001', 'CARD'),
  pg_temp.k('card2') || '|STRIPE|' || pg_temp.id('37b001') || '|true', 'résolution : le choix prime sur le défaut');
SELECT pg_temp.preq('3a0060', 'card2', 1, 'SUSPENDED', NULL);
SELECT pg_temp.sa();
SELECT lives_ok(format('SELECT activate_psp_configuration(%L, %L)', pg_temp.k('card2'), pg_temp.id('3a0060')),
  'suspension de la configuration choisie');
SELECT is(pg_temp.res('37d001', 'CARD'), 'CL042', 'choix suspendu : refus CL042, sans repli sur le défaut');
SELECT is(pg_temp.st('card1'), 'ACTIVE', 'le défaut CARD est pourtant actif et valide');
-- 4. défaut expiré
SELECT is(pg_temp.res('37d005', 'WAVE'), 'CL042', 'défaut expiré (valid_until passé) : CL042');
-- 5. titulaire différent du détenteur des fonds (événement 2 : détenteur = prestataire)
SELECT is(pg_temp.res('37d002', 'WAVE'), 'CL042',
  'titulaire du défaut différent du détenteur des fonds : CL042');
-- 6. configuration d'un autre organisateur (événement 5 est de b002 ; défaut CARD est de b001)
SELECT is(pg_temp.res('37d005', 'CARD'), 'CL042', 'défaut d''un autre organisateur : non utilisé, CL042');
-- 7. moyen sans rien
SELECT is(pg_temp.res('37d005', 'ORANGE_MONEY'), 'CL042', 'moyen sans choix ni défaut : CL042');
SELECT is(pg_temp.res('37d006', 'WAVE'), 'CL042', 'événement sans grand livre : CL042');
SELECT is(pg_temp.res('37d001', 'BITCOIN'), 'CL001', 'moyen inconnu : CL001');
-- Choix dont le titulaire a changé depuis : le grand livre ne change pas, mais la résolution refuse
-- tout titulaire différent (simulé en changeant le détenteur des fonds du grand livre).
UPDATE ledger SET funds_holder_id = pg_temp.id('37b002') WHERE scope_id = pg_temp.id('37d004');
SELECT is(pg_temp.res('37d004', 'WAVE'), 'CL042', 'choix valide dont le titulaire ne correspond plus : CL042');
UPDATE ledger SET funds_holder_id = pg_temp.id('37b001') WHERE scope_id = pg_temp.id('37d004');
SELECT is(pg_temp.res('37d004', 'WAVE'),
  pg_temp.k('wave2') || '|WAVE|' || pg_temp.id('37b001') || '|true', 'titulaire rétabli : résolution à nouveau valide');
-- La résolution ne rend pas secret_ref.
SELECT is((SELECT array_agg(a.attname ORDER BY a.attnum) FROM pg_proc p, unnest(p.proargnames, p.proargmodes) WITH ORDINALITY u(attname, m, attnum)
            CROSS JOIN LATERAL (SELECT u.attname, u.attnum) a
            WHERE p.proname = 'resolve_psp_configuration' AND u.m = 't'),
  ARRAY['psp_configuration_id','provider','holder_party_id','from_selection'],
  'resolve_psp_configuration ne rend pas secret_ref');

-- psp_webhook_context (aucun prestataire de session).
SELECT pg_temp.nosession();
SELECT is((SELECT count(*)::int FROM psp_webhook_context(pg_temp.id('3f0000'))), 0,
  'psp_webhook_context : identifiant inconnu -> zéro ligne');
SELECT is((SELECT status || '|' || currently_valid || '|' || secret_ref || '|' || operator_id
             FROM psp_webhook_context(pg_temp.k('wave1'))),
  'SUSPENDED|true|psp/' || pg_temp.id('37b001') || '/wave1|' || pg_temp.id('37a001'),
  'psp_webhook_context : suspendue -> SUSPENDED, secret_ref et prestataire rendus');
SELECT is((SELECT currently_valid FROM psp_webhook_context(pg_temp.k('bwave'))), false,
  'psp_webhook_context : hors dates -> currently_valid faux');
SELECT is((SELECT provider || '|' || method FROM psp_webhook_context(pg_temp.k('card1'))), 'PAYDUNYA|CARD',
  'psp_webhook_context : fournisseur et moyen');
-- psp_configuration_secret_ref.
SELECT pg_temp.sa();
SELECT is(psp_configuration_secret_ref(pg_temp.k('wave2')), 'psp/' || pg_temp.id('37b001') || '/wave2',
  'secret_ref d''une configuration active');
SELECT is(psp_configuration_secret_ref(pg_temp.k('wave1')), 'psp/' || pg_temp.id('37b001') || '/wave1',
  'secret_ref d''une configuration suspendue (recharges PENDING)');
SELECT is(pg_temp.code(format('SELECT psp_configuration_secret_ref(%L)', pg_temp.k('draft1'))), 'P0002',
  'secret_ref d''un brouillon : P0002');

-- 7. Comptes et frais --------------------------------------------------------------------------------
-- Grand livre neuf : trois comptes par open_psp_accounts, appelable deux fois.
SELECT pg_temp.sa();
SELECT is((SELECT count(*)::int FROM account a JOIN ledger l ON l.id = a.ledger_id
            WHERE l.scope_id = pg_temp.id('37d003') AND a.purpose = 'PSP'), 0, 'événement 3 : aucun compte PSP au départ');
SELECT lives_ok(format('SELECT open_psp_accounts(%L)', (SELECT id FROM ledger WHERE scope_id = pg_temp.id('37d003'))),
  'open_psp_accounts : premier appel');
SELECT lives_ok(format('SELECT open_psp_accounts(%L)', (SELECT id FROM ledger WHERE scope_id = pg_temp.id('37d003'))),
  'open_psp_accounts : deuxième appel sans erreur');
SELECT is((SELECT string_agg(a.code, ',' ORDER BY a.code) FROM account a JOIN ledger l ON l.id = a.ledger_id
            WHERE l.scope_id = pg_temp.id('37d003') AND a.purpose = 'PSP'),
  'A-PSP-CARTE,A-PSP-OM,A-PSP-WAVE', 'un seul jeu de trois comptes');
SELECT is((SELECT bool_and(a.family = 'ASSET' AND a.normal_side = 'D' AND a.hot AND a.allow_negative
                           AND a.owner_party_id = l.funds_holder_id)
             FROM account a JOIN ledger l ON l.id = a.ledger_id
            WHERE l.scope_id = pg_temp.id('37d003') AND a.purpose = 'PSP'), true,
  'comptes A-PSP-* : ASSET, côté D, chaud, négatif permis, titulaire = détenteur des fonds');
SELECT is((SELECT count(*)::int FROM account a JOIN ledger l ON l.id = a.ledger_id
            WHERE l.scope_id = pg_temp.id('37d003') AND a.purpose <> 'PSP'), 28,
  'open_psp_accounts ne crée aucun autre compte (les 28 de open_event_ledger restent)');
SELECT is(pg_temp.code(format('SELECT open_psp_accounts(%L)', (SELECT id FROM ledger WHERE scope_id = pg_temp.id('37d011')))),
  'P0002', 'open_psp_accounts : grand livre d''un autre prestataire -> P0002');
SELECT is(pg_temp.code(format('SELECT open_psp_accounts(%L)', pg_temp.id('3f0000'))), 'P0002',
  'open_psp_accounts : grand livre inconnu -> P0002');
SELECT is((SELECT count(*)::int FROM account a JOIN ledger l ON l.id = a.ledger_id
            WHERE l.scope_id = pg_temp.id('37d011') AND a.purpose = 'PSP'), 0,
  'le refus n''a rien créé chez l''autre prestataire');
-- Grands livres existants : la même instruction que la migration, rejouée (propriétaire).
CREATE FUNCTION pg_temp.backfill() RETURNS void LANGUAGE sql AS $$
  INSERT INTO account (operator_id, ledger_id, code, family, purpose, owner_party_id, normal_side,
                       allow_negative, hot)
  SELECT l.operator_id, l.id, psp_account_code(m), 'ASSET', 'PSP', l.funds_holder_id, 'D', true, true
    FROM ledger l CROSS JOIN unnest(ARRAY['WAVE','ORANGE_MONEY','CARD']) AS m
   WHERE l.scope_type = 'EVENT'
  ON CONFLICT (ledger_id, code) DO NOTHING
$$;
SELECT pg_temp.backfill();
SELECT is((SELECT count(*)::int FROM account WHERE purpose = 'PSP'), 3 * 6,
  'rattrapage des grands livres existants : trois comptes pour chacun des six grands livres');
SELECT pg_temp.backfill();
SELECT is((SELECT count(*)::int FROM account WHERE purpose = 'PSP'), 3 * 6, 'rejeu du rattrapage sans effet');
SELECT is(pg_temp.code($$SELECT psp_account_code('CHEQUE')$$), 'CL001', 'psp_account_code : moyen inconnu refusé');
SELECT is(psp_account_code('WAVE') || ',' || psp_account_code('ORANGE_MONEY') || ',' || psp_account_code('CARD'),
  'A-PSP-WAVE,A-PSP-OM,A-PSP-CARTE', 'psp_account_code : trois codes');

-- Portée de frais PSP_CONFIGURATION.
CREATE FUNCTION pg_temp.feeins(p_op text, p_scope uuid, p_basis text) RETURNS text LANGUAGE sql AS $$
  SELECT pg_temp.code(format($f$INSERT INTO fee_rule (operator_id, scope_type, scope_id, payer_purpose,
      beneficiary_purpose, basis, rate_bps, trigger, valid_from) VALUES (%L, 'PSP_CONFIGURATION', %L,
      'WALLET_PAID', 'OPE_FRAIS', %L, 100, 'REALTIME', now())$f$, pg_temp.id(p_op), p_scope, p_basis))
$$;
SELECT is(pg_temp.feeins('37a001', pg_temp.k('draft1'), 'TOPUP_AMOUNT'), 'ok',
  'règle PSP_CONFIGURATION pour une configuration du prestataire');
SELECT is(pg_temp.feeins('37a001', pg_temp.id('3f0000'), 'TOPUP_AMOUNT'), 'CL001', 'configuration inconnue : refusée');
INSERT INTO psp_configuration (psp_configuration_id, operator_id, organizer_id, method, provider,
  holder_party_id, secret_ref, valid_from, created_by)
VALUES (pg_temp.id('3f0001'), pg_temp.id('37a002'), pg_temp.id('37b011'), 'WAVE', 'WAVE',
        pg_temp.id('37b011'), 'psp/' || pg_temp.id('37b011') || '/bcfg', now(), pg_temp.id('37e011'));
INSERT INTO k VALUES ('bcfg', pg_temp.id('3f0001'));
SELECT is(pg_temp.feeins('37a001', pg_temp.id('3f0001'), 'TOPUP_AMOUNT'), 'CL001',
  'configuration d''un autre prestataire : refusée');
SELECT is(pg_temp.feeins('37a001', pg_temp.k('draft1'), 'SALE_AMOUNT'), 'CL001',
  'base différente de TOPUP_AMOUNT : refusée');
SELECT isnt(pg_temp.code($$INSERT INTO fee_rule (operator_id, scope_type, scope_id, payer_purpose,
    beneficiary_purpose, basis, trigger, valid_from) VALUES (NULL, 'AUTRE', gen_random_uuid(), 'X', 'Y',
    'FIXED', 'REALTIME', now())$$), 'ok', 'portée inconnue toujours refusée');
-- Les portées existantes sont inchangées.
SELECT is(pg_temp.code(format($$INSERT INTO fee_rule (operator_id, scope_type, scope_id, payer_purpose,
    beneficiary_purpose, basis, trigger, valid_from) VALUES (%L, 'EVENT', %L, 'ORG_FPREST', 'OPE_FRAIS',
    'TOPUP_AMOUNT', 'CLOSING', now())$$, pg_temp.id('37a001'), pg_temp.id('37d001'))), 'ok',
  'portée EVENT : garde de 0007 inchangé');
SELECT is(pg_temp.code(format($$INSERT INTO fee_rule (operator_id, scope_type, scope_id, payer_purpose,
    beneficiary_purpose, basis, trigger, valid_from) VALUES (%L, 'EVENT', %L, 'ORG_FPREST', 'OPE_FRAIS',
    'TOPUP_AMOUNT', 'CLOSING', now())$$, pg_temp.id('37a001'), pg_temp.id('37d011'))), 'CL001',
  'portée EVENT d''un autre prestataire : toujours refusée');

-- 9. Convention PSP:<canal> retirée (A18) -------------------------------------------------------------
-- La migration appelle ce contrôle ; base sans règle de ce type : il passe (cas de cette base).
SELECT lives_ok('SELECT assert_no_legacy_psp_fee_rules()', 'base sans règle PSP:% : le contrôle de migration passe');
INSERT INTO fee_rule (operator_id, scope_type, scope_id, payer_purpose, beneficiary_purpose, basis,
                      rate_bps, trigger, valid_from)
VALUES (pg_temp.id('37a001'), 'EVENT', pg_temp.id('37d001'), 'WALLET_PAID', 'PSP:WAVE', 'TOPUP_AMOUNT',
        100, 'REALTIME', now());
SELECT throws_ok('SELECT assert_no_legacy_psp_fee_rules()', 'CL001', NULL,
  'base avec une règle PSP:% : la migration échouerait (message explicite)');
SELECT ok(pg_temp.err('SELECT assert_no_legacy_psp_fee_rules()') LIKE '%PSP_CONFIGURATION%',
  'le message indique la portée de remplacement');

-- 8. Cloisonnement -------------------------------------------------------------------------------------
-- Objets du prestataire B sous la session de A : P0002 ; sans session : P0002.
SELECT pg_temp.sb();
SELECT pg_temp.mk('bwave2', '37b011', 'WAVE', 'WAVE', '37b011', true, clock_timestamp() - interval '1 day',
                  NULL, NULL, '37e011');
SELECT is((SELECT operator_id FROM psp_configuration WHERE psp_configuration_id = pg_temp.k('bwave2')),
  pg_temp.id('37a002'), 'B crée sa propre configuration');
SELECT pg_temp.req('3c0001', '37a002', 'PSP_CONFIGURATION', pg_temp.k('bwave2'),
  jsonb_build_object('psp_configuration_id', pg_temp.k('bwave2'), 'version', 1, 'compliance_ref', 'B-1'),
  '37e012', '37e011');
SELECT pg_temp.sa();
SELECT is(pg_temp.code(format($$SELECT create_psp_configuration(%L, 'WAVE', 'WAVE', %L, %L, false,
    clock_timestamp(), NULL, %L)$$, pg_temp.id('37b011'), pg_temp.id('37b011'),
    'psp/' || pg_temp.id('37b011') || '/x', pg_temp.id('37e001'))), 'P0002', 'A crée sur un organisateur de B : P0002');
SELECT is(pg_temp.code(format($$SELECT create_psp_configuration(%L, 'WAVE', 'WAVE', %L, %L, false,
    clock_timestamp(), NULL, %L)$$, pg_temp.id('37b001'), pg_temp.id('37b001'),
    'psp/' || pg_temp.id('37b001') || '/x', pg_temp.id('37e011'))), 'P0002', 'A crée avec un auteur de B : P0002');
SELECT is(pg_temp.act('bwave2', '3c0001'), 'P0002', 'A active une configuration de B : P0002');
SELECT is(pg_temp.code(format('SELECT activate_psp_configuration(%L, %L)', pg_temp.k('wave2'), pg_temp.id('3c0001'))),
  'P0002', 'A active la sienne avec une demande de B : P0002');
SELECT is(pg_temp.code(format($$SELECT set_event_psp_selection(%L, 'WAVE', %L, %L)$$, pg_temp.id('37d011'),
    pg_temp.k('bwave2'), pg_temp.id('37f111'))), 'P0002', 'A choisit pour un événement de B : P0002');
SELECT is(pg_temp.code(format($$SELECT * FROM resolve_psp_configuration(%L, 'WAVE')$$, pg_temp.id('37d011'))),
  'P0002', 'A résout un événement de B : P0002');
SELECT is(pg_temp.code(format('SELECT psp_configuration_secret_ref(%L)', pg_temp.k('bwave2'))), 'P0002',
  'A lit le secret_ref d''une configuration de B : P0002');
SELECT is(pg_temp.code(format('SELECT open_psp_accounts(%L)', (SELECT id FROM ledger WHERE scope_id = pg_temp.id('37d011')))),
  'P0002', 'A ouvre les comptes du grand livre de B : P0002');
SELECT is(pg_temp.feeins('37a001', pg_temp.k('bwave2'), 'TOPUP_AMOUNT'), 'CL001',
  'A pose une règle de frais sur une configuration de B : refusé');
-- Sans session.
SELECT pg_temp.nosession();
SELECT is(pg_temp.code(format($$SELECT create_psp_configuration(%L, 'WAVE', 'WAVE', %L, %L, false,
    clock_timestamp(), NULL, %L)$$, pg_temp.id('37b001'), pg_temp.id('37b001'),
    'psp/' || pg_temp.id('37b001') || '/x', pg_temp.id('37e001'))), 'P0002', 'sans session : création, P0002');
SELECT is(pg_temp.act('wave2', '3a0040'), 'P0002', 'sans session : activation, P0002');
SELECT is(pg_temp.code(format($$SELECT set_event_psp_selection(%L, 'WAVE', %L, %L)$$, pg_temp.id('37d001'),
    pg_temp.k('wave2'), pg_temp.id('37f101'))), 'P0002', 'sans session : choix, P0002');
SELECT is(pg_temp.code(format($$SELECT * FROM resolve_psp_configuration(%L, 'WAVE')$$, pg_temp.id('37d001'))),
  'P0002', 'sans session : résolution, P0002');
SELECT is(pg_temp.code(format('SELECT psp_configuration_secret_ref(%L)', pg_temp.k('wave2'))), 'P0002',
  'sans session : secret_ref, P0002');
SELECT is(pg_temp.code(format('SELECT open_psp_accounts(%L)', (SELECT id FROM ledger WHERE scope_id = pg_temp.id('37d001')))),
  'P0002', 'sans session : open_psp_accounts, P0002');
SELECT is((SELECT count(*)::int FROM psp_webhook_context(pg_temp.k('wave2'))), 1,
  'sans session : psp_webhook_context lit (route publique)');

SELECT * FROM finish();
ROLLBACK;
