-- Grand livre d'événement et conditions de passage (migration 0008) — pgTAP, écrit à la main (pas un fichier généré).
-- Lancer depuis packages/ledger-sql : pg_prove -d <base> tests/tests_event_ledger.sql (base créée par les migrations,
-- roles.sql et post-roles.sql rejoués). La suite lit scenario_reference.json dans le répertoire courant.
\set ON_ERROR_STOP 1
\set QUIET 1
\set scenario `cat scenario_reference.json`
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

-- Fixture (rôle propriétaire). La partie plateforme de la suite est la plus ancienne : c'est elle que retient
-- open_event_ledger, même si la base en contient déjà une.
INSERT INTO party (id, kind, legal_name, created_at) VALUES
 ('00000000-0000-0000-0000-00000008a000','PLATFORM','Plateforme 0008','1900-01-01');
INSERT INTO party (id, kind, legal_name, country_code) VALUES
 ('00000000-0000-0000-0000-00000008a001','OPERATOR','Prestataire A','SN'),
 ('00000000-0000-0000-0000-00000008a002','OPERATOR','Prestataire B','CI');
INSERT INTO party (id, kind, operator_id, legal_name, country_code) VALUES
 ('00000000-0000-0000-0000-00000008a011','ORGANIZER','00000000-0000-0000-0000-00000008a001','Organisateur A','SN'),
 ('00000000-0000-0000-0000-00000008a013','ORGANIZER','00000000-0000-0000-0000-00000008a002','Organisateur B','CI'),
 ('00000000-0000-0000-0000-00000008a021','MERCHANT','00000000-0000-0000-0000-00000008a001','Commerçant A','SN'),
 ('00000000-0000-0000-0000-00000008a031','THIRD_PARTY','00000000-0000-0000-0000-00000008a001','Compte cantonné A','SN');
INSERT INTO jurisdiction_profile (id, country_code, version, valid_from, breakage_destination) VALUES
 ('00000000-0000-0000-0000-00000008a041','SN', 80001, '2026-01-01', 'ORGANIZER'),
 ('00000000-0000-0000-0000-00000008a042','SN', 80002, '2026-01-01', 'LEGAL_ACCOUNT');
INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone, jurisdiction_id, funds_holder, issuer, funds_holder_party_id) VALUES
 ('00000000-0000-0000-0000-00000008a061','00000000-0000-0000-0000-00000008a001','00000000-0000-0000-0000-00000008a011',
  'Détenteur organisateur','XOF','Africa/Dakar','00000000-0000-0000-0000-00000008a041','ORGANIZER','ORGANIZER',NULL),
 ('00000000-0000-0000-0000-00000008a062','00000000-0000-0000-0000-00000008a001','00000000-0000-0000-0000-00000008a011',
  'Détenteur prestataire, compte légal','EUR','Europe/Paris','00000000-0000-0000-0000-00000008a042','OPERATOR','OPERATOR',NULL),
 ('00000000-0000-0000-0000-00000008a063','00000000-0000-0000-0000-00000008a001','00000000-0000-0000-0000-00000008a011',
  'Détenteur tiers','XOF','Africa/Dakar','00000000-0000-0000-0000-00000008a041','THIRD_PARTY','ORGANIZER','00000000-0000-0000-0000-00000008a031'),
 ('00000000-0000-0000-0000-00000008a064','00000000-0000-0000-0000-00000008a002','00000000-0000-0000-0000-00000008a013',
  'Événement de B','XOF','Africa/Abidjan','00000000-0000-0000-0000-00000008a041','ORGANIZER','ORGANIZER',NULL);
INSERT INTO merchant_participation (id, operator_id, event_id, merchant_id, link_type) VALUES
 ('00000000-0000-0000-0000-00000008a071','00000000-0000-0000-0000-00000008a001','00000000-0000-0000-0000-00000008a061',
  '00000000-0000-0000-0000-00000008a021','EXTERNAL'),
 ('00000000-0000-0000-0000-00000008a072','00000000-0000-0000-0000-00000008a001','00000000-0000-0000-0000-00000008a063',
  '00000000-0000-0000-0000-00000008a021','EXTERNAL');
INSERT INTO device (id, operator_id, kind, event_id, serial) VALUES
 ('00000000-0000-0000-0000-00000008a091','00000000-0000-0000-0000-00000008a001','POS','00000000-0000-0000-0000-00000008a061','TPE-0008-01');

-- Aides de la suite : compte par code, écriture simple à deux lignes, codes d'un passage, condition par code.
CREATE FUNCTION pg_temp.lg(p_event text) RETURNS uuid LANGUAGE sql AS
  $$ SELECT id FROM ledger WHERE scope_type = 'EVENT' AND scope_id = p_event::uuid $$;
CREATE FUNCTION pg_temp.acc(p_event text, p_code text) RETURNS uuid LANGUAGE sql AS
  $$ SELECT id FROM account WHERE ledger_id = pg_temp.lg(p_event) AND code = p_code $$;
CREATE FUNCTION pg_temp.post(p_key text, p_debit text, p_credit text, p_amount bigint) RETURNS uuid LANGUAGE sql AS $$
  SELECT post_transaction(pg_temp.lg('00000000-0000-0000-0000-00000008a061'), 'CASH_DEPOSIT', p_key, clock_timestamp(), 'BATCH',
    jsonb_build_array(
      jsonb_build_object('account_id', pg_temp.acc('00000000-0000-0000-0000-00000008a061', p_debit), 'amount', p_amount),
      jsonb_build_object('account_id', pg_temp.acc('00000000-0000-0000-0000-00000008a061', p_credit), 'amount', -p_amount)))
$$;
CREATE FUNCTION pg_temp.codes(p_to event_status) RETURNS text LANGUAGE sql AS
  $$ SELECT string_agg(code, ',') FROM event_transition_conditions('00000000-0000-0000-0000-00000008a061', p_to) $$;
CREATE FUNCTION pg_temp.met(p_to event_status, p_code text) RETURNS boolean LANGUAGE sql AS
  $$ SELECT met FROM event_transition_conditions('00000000-0000-0000-0000-00000008a061', p_to) WHERE code = p_code $$;
CREATE FUNCTION pg_temp.unmet(p_to event_status) RETURNS text LANGUAGE sql AS
  $$ SELECT coalesce(string_agg(code, ','), '') FROM event_transition_conditions('00000000-0000-0000-0000-00000008a061', p_to) WHERE NOT met $$;
CREATE FUNCTION pg_temp.go(p_to event_status) RETURNS event_status LANGUAGE sql AS
  $$ SELECT set_event_status('00000000-0000-0000-0000-00000008a061', p_to, '00000000-0000-0000-0000-00000008a0ff') $$;

-- Plan de comptes attendu (SPECIFICATION §5.2), titulaires de l'événement « détenteur organisateur ».
CREATE TEMP TABLE expected_account (code text, family text, purpose text, owner uuid, side text, neg boolean, hot boolean);
INSERT INTO expected_account VALUES
 ('A-TRANSIT','ASSET','CASH_TRANSIT','00000000-0000-0000-0000-00000008a011','D',false,false),
 ('A-BANQUE','ASSET','BANK','00000000-0000-0000-0000-00000008a011','D',false,false),
 ('L-ORG-COM','CLAIM','ORG_COM','00000000-0000-0000-0000-00000008a011','C',false,true),
 ('L-ORG-PLACE','CLAIM','ORG_PLACE','00000000-0000-0000-0000-00000008a011','C',false,false),
 ('L-ORG-FFEST','CLAIM','ORG_FFEST','00000000-0000-0000-0000-00000008a011','C',false,false),
 ('L-ORG-TVA','CLAIM','ORG_TAX','00000000-0000-0000-0000-00000008a011','C',false,true),
 ('L-ORG-CASSE','CLAIM','ORG_CASSE','00000000-0000-0000-0000-00000008a011','C',true,false),
 ('L-ORG-CAUTION','CLAIM','ORG_DEPOSIT','00000000-0000-0000-0000-00000008a011','C',false,false),
 ('L-ORG-CAUTION-ACQ','CLAIM','ORG_DEPOSIT_FORFEIT','00000000-0000-0000-0000-00000008a011','C',false,false),
 ('L-ORG-PROMO','CLAIM','ORG_PROMO','00000000-0000-0000-0000-00000008a011','D',true,false),
 ('L-ORG-FPSP','CLAIM','ORG_FPSP','00000000-0000-0000-0000-00000008a011','D',true,true),
 ('L-ORG-FPREST','CLAIM','ORG_FPREST','00000000-0000-0000-0000-00000008a011','D',true,false),
 ('L-ORG-PERTES','CLAIM','ORG_PERTES','00000000-0000-0000-0000-00000008a011','D',true,false),
 ('L-ORG-CREANCES','CLAIM','ORG_RECEIVABLE','00000000-0000-0000-0000-00000008a011','D',true,false),
 ('L-ORG-VERS','CLAIM','ORG_VERS','00000000-0000-0000-0000-00000008a011','D',true,false),
 ('L-OPE-FRAIS','CLAIM','OPE_FRAIS','00000000-0000-0000-0000-00000008a001','C',false,false),
 ('L-OPE-TVA','CLAIM','OPE_TAX','00000000-0000-0000-0000-00000008a001','C',false,false),
 ('L-OPE-CASSE','CLAIM','OPE_CASSE','00000000-0000-0000-0000-00000008a001','C',true,false),
 ('L-OPE-FPSP','CLAIM','OPE_FPSP','00000000-0000-0000-0000-00000008a001','D',true,true),
 ('L-OPE-PERTES','CLAIM','OPE_PERTES','00000000-0000-0000-0000-00000008a001','D',true,false),
 ('L-OPE-REDEV','CLAIM','OPE_REDEV','00000000-0000-0000-0000-00000008a001','D',true,false),
 ('L-OPE-VERS','CLAIM','OPE_VERS','00000000-0000-0000-0000-00000008a001','D',true,false),
 ('L-PLT-REDEV','CLAIM','PLT_REDEV','00000000-0000-0000-0000-00000008a000','C',false,false),
 ('L-PLT-TVA','CLAIM','PLT_TAX','00000000-0000-0000-0000-00000008a000','C',false,false),
 ('L-PLT-VERS','CLAIM','PLT_VERS','00000000-0000-0000-0000-00000008a000','D',true,false),
 ('L-ESP-A-RENDRE','CLAIM','CUSTOMER_CASH_DUE',NULL,'C',false,false),
 ('L-VERS-ENCOURS','CLAIM','PAYOUT_PENDING',NULL,'C',false,false),
 ('S-ATTENTE','SUSPENSE','SUSPENSE',NULL,'D',true,false);
GRANT SELECT ON expected_account TO PUBLIC;

-- 1. Structure ---------------------------------------------------------------------------------------------------
SELECT has_function('open_event_ledger', ARRAY['uuid']);
SELECT has_function('open_participation_account', ARRAY['uuid']);
SELECT has_function('event_transition_conditions', ARRAY['uuid','event_status']);
SELECT is((SELECT prosecdef FROM pg_proc WHERE proname = 'open_event_ledger'), false, 'open_event_ledger : SECURITY INVOKER');
SELECT is((SELECT prosecdef FROM pg_proc WHERE proname = 'open_participation_account'), false, 'open_participation_account : SECURITY INVOKER');
SELECT is((SELECT prosecdef FROM pg_proc WHERE proname = 'event_transition_conditions'), true, 'event_transition_conditions : SECURITY DEFINER');
SELECT is((SELECT provolatile FROM pg_proc WHERE proname = 'event_transition_conditions'), 's', 'event_transition_conditions : STABLE');
SELECT ok(NOT has_function_privilege('public', 'event_transition_conditions(uuid, event_status)', 'execute'),
  'event_transition_conditions : retirée à PUBLIC');

-- Tout le reste s'exécute sous le rôle applicatif, session du prestataire A (droits d'exécution : à confirmer par
-- WP03 dans post-roles.sql ; aujourd'hui accordés par le rejeu de roles.sql).
SET LOCAL ROLE cashless_app;
SELECT set_config('app.operator_id', '00000000-0000-0000-0000-00000008a001', true);

-- 2. open_event_ledger -------------------------------------------------------------------------------------------
SELECT throws_ok($$SELECT open_participation_account('00000000-0000-0000-0000-00000008a071')$$,
  'CL001', 'Participation : grand livre de l''événement non ouvert', 'compte de participation avant le grand livre refusé');
SELECT lives_ok($$SELECT open_event_ledger('00000000-0000-0000-0000-00000008a061')$$, 'grand livre ouvert sous le rôle applicatif');
SELECT results_eq(
  $$SELECT operator_id, currency::text, issuer_id, funds_holder_id, status, debit_authority FROM ledger
     WHERE scope_type = 'EVENT' AND scope_id = '00000000-0000-0000-0000-00000008a061'$$,
  $$VALUES ('00000000-0000-0000-0000-00000008a001'::uuid, 'XOF', '00000000-0000-0000-0000-00000008a011'::uuid,
            '00000000-0000-0000-0000-00000008a011'::uuid, 'OPEN', 'CENTRAL')$$,
  'grand livre : devise de l''événement, émetteur et détenteur = organisateur');
SELECT is((SELECT count(*)::int FROM account WHERE ledger_id = pg_temp.lg('00000000-0000-0000-0000-00000008a061')), 28,
  '28 comptes fixes');
SELECT results_eq(
  $$SELECT code, family::text, purpose, owner_party_id, normal_side::text, allow_negative, hot FROM account
     WHERE ledger_id = pg_temp.lg('00000000-0000-0000-0000-00000008a061') ORDER BY code$$,
  $$SELECT code, family, purpose, owner, side, neg, hot FROM expected_account ORDER BY code$$,
  'plan de comptes identique au tableau de §5.2 (famille, usage, titulaire, sens, négatif permis, chaud)');
SELECT is((SELECT count(*)::int FROM account WHERE ledger_id = pg_temp.lg('00000000-0000-0000-0000-00000008a061')
            AND (operator_id <> '00000000-0000-0000-0000-00000008a001' OR NOT is_active OR wallet_id IS NOT NULL OR participation_id IS NOT NULL)), 0,
  'comptes fixes : prestataire de l''événement, actifs, sans portefeuille ni participation');
-- Comptes communs avec le scénario de référence : mêmes attributs. allow_negative des comptes de casse est posé par
-- le déclencheur account_merchant_hot (le scénario demande false, la base pose true) : hors comparaison.
SELECT is((SELECT count(*)::int FROM jsonb_array_elements(:'scenario'::jsonb -> 'accounts') s
            JOIN account a ON a.code = s->>'code' AND a.ledger_id = pg_temp.lg('00000000-0000-0000-0000-00000008a061')), 24,
  '24 comptes communs avec scenario_reference.json');
SELECT is((SELECT coalesce(string_agg(a.code, ','), '') FROM jsonb_array_elements(:'scenario'::jsonb -> 'accounts') s
            JOIN account a ON a.code = s->>'code' AND a.ledger_id = pg_temp.lg('00000000-0000-0000-0000-00000008a061')
           WHERE a.family::text <> s->>'family' OR a.purpose <> s->>'purpose' OR a.normal_side <> s->>'normal_side'
              OR (a.purpose NOT IN ('ORG_CASSE','OPE_CASSE') AND a.allow_negative <> (s->>'allow_negative')::boolean)
              OR a.owner_party_id IS DISTINCT FROM CASE s->>'owner'
                   WHEN 'ORG' THEN '00000000-0000-0000-0000-00000008a011'::uuid
                   WHEN 'OPE' THEN '00000000-0000-0000-0000-00000008a001'::uuid
                   WHEN 'PLT' THEN '00000000-0000-0000-0000-00000008a000'::uuid END), '',
  'comptes communs : attributs identiques à ceux de scenario_reference.json');
SELECT throws_ok($$SELECT open_event_ledger('00000000-0000-0000-0000-00000008a061')$$,
  'CL001', 'Événement : grand livre déjà ouvert', 'second appel refusé');

-- Détenteur prestataire, émetteur prestataire, casse due à un compte légal.
SELECT lives_ok($$SELECT open_event_ledger('00000000-0000-0000-0000-00000008a062')$$, 'grand livre ouvert (détenteur prestataire)');
SELECT results_eq(
  $$SELECT currency::text, issuer_id, funds_holder_id FROM ledger WHERE id = pg_temp.lg('00000000-0000-0000-0000-00000008a062')$$,
  $$VALUES ('EUR', '00000000-0000-0000-0000-00000008a001'::uuid, '00000000-0000-0000-0000-00000008a001'::uuid)$$,
  'détenteur OPERATOR et émetteur OPERATOR : le prestataire');
SELECT results_eq(
  $$SELECT code, owner_party_id FROM account WHERE ledger_id = pg_temp.lg('00000000-0000-0000-0000-00000008a062')
     AND family = 'ASSET' ORDER BY code$$,
  $$VALUES ('A-BANQUE', '00000000-0000-0000-0000-00000008a001'::uuid), ('A-TRANSIT', '00000000-0000-0000-0000-00000008a001'::uuid)$$,
  'comptes d''argent au nom du prestataire');
SELECT is((SELECT count(*)::int FROM account WHERE ledger_id = pg_temp.lg('00000000-0000-0000-0000-00000008a062')), 29,
  '29 comptes avec le compte légal');
SELECT results_eq(
  $$SELECT family::text, purpose, owner_party_id, normal_side::text, allow_negative, hot FROM account
     WHERE ledger_id = pg_temp.lg('00000000-0000-0000-0000-00000008a062') AND code = 'L-LEGAL-CASSE'$$,
  $$VALUES ('CLAIM', 'LEGAL_BREAKAGE', NULL::uuid, 'C', true, false)$$,
  'L-LEGAL-CASSE créé si breakage_destination = LEGAL_ACCOUNT (sans titulaire, négatif permis posé par la base)');
SELECT is((SELECT count(*)::int FROM account WHERE ledger_id = pg_temp.lg('00000000-0000-0000-0000-00000008a061') AND code = 'L-LEGAL-CASSE'), 0,
  'pas de L-LEGAL-CASSE sans destination légale');

-- Détenteur tiers.
SELECT lives_ok($$SELECT open_event_ledger('00000000-0000-0000-0000-00000008a063')$$, 'grand livre ouvert (détenteur tiers)');
SELECT results_eq(
  $$SELECT l.issuer_id, l.funds_holder_id, (SELECT count(*)::int FROM account a WHERE a.ledger_id = l.id AND a.family = 'ASSET'
      AND a.owner_party_id = '00000000-0000-0000-0000-00000008a031')
      FROM ledger l WHERE l.id = pg_temp.lg('00000000-0000-0000-0000-00000008a063')$$,
  $$VALUES ('00000000-0000-0000-0000-00000008a011'::uuid, '00000000-0000-0000-0000-00000008a031'::uuid, 2)$$,
  'détenteur THIRD_PARTY : la partie désignée, titulaire des comptes d''argent');

-- Isolation : l'événement de B est invisible de A, et son grand livre aussi.
SELECT throws_ok($$SELECT open_event_ledger('00000000-0000-0000-0000-00000008a064')$$,
  'P0002', 'Objet introuvable', 'événement d''un autre prestataire : introuvable');
SELECT throws_ok($$SELECT open_event_ledger('00000000-0000-0000-0000-00000008afff')$$,
  'P0002', 'Objet introuvable', 'événement inexistant : même erreur');
SELECT set_config('app.operator_id', '00000000-0000-0000-0000-00000008a002', true);
SELECT lives_ok($$SELECT open_event_ledger('00000000-0000-0000-0000-00000008a064')$$, 'B ouvre le grand livre de son événement');
SELECT is((SELECT count(*)::int FROM ledger), 1, 'B ne voit que son grand livre');
SELECT is((SELECT count(*)::int FROM account), 28, 'B ne voit que ses comptes');
SELECT throws_ok($$SELECT open_participation_account('00000000-0000-0000-0000-00000008a071')$$,
  'P0002', 'Objet introuvable', 'participation d''un autre prestataire : introuvable');
SELECT throws_ok($$SELECT * FROM event_transition_conditions('00000000-0000-0000-0000-00000008a061', 'LIVE')$$,
  'P0002', 'Objet introuvable', 'conditions d''un événement d''un autre prestataire : introuvable');
SELECT set_config('app.operator_id', '00000000-0000-0000-0000-00000008a001', true);
SELECT is((SELECT count(*)::int FROM ledger), 3, 'A ne voit que ses trois grands livres');

-- 3. open_participation_account ----------------------------------------------------------------------------------
SELECT lives_ok($$SELECT open_participation_account('00000000-0000-0000-0000-00000008a071')$$, 'compte de participation ouvert');
SELECT results_eq(
  $$SELECT code, family::text, purpose, owner_party_id, participation_id, normal_side::text, allow_negative, hot, ledger_id FROM account
     WHERE participation_id = '00000000-0000-0000-0000-00000008a071'$$,
  $$VALUES ('L-MCH-00000000-0000-0000-0000-00000008a071', 'CLAIM', 'MERCHANT', '00000000-0000-0000-0000-00000008a021'::uuid,
            '00000000-0000-0000-0000-00000008a071'::uuid, 'C', true, true, pg_temp.lg('00000000-0000-0000-0000-00000008a061'))$$,
  'L-MCH-<participation> : droit du commerçant, chaud et négatif permis, dans le grand livre de l''événement');
SELECT is(open_participation_account('00000000-0000-0000-0000-00000008a071'),
  (SELECT id FROM account WHERE participation_id = '00000000-0000-0000-0000-00000008a071'), 'second appel : même compte');
SELECT is((SELECT count(*)::int FROM account WHERE participation_id = '00000000-0000-0000-0000-00000008a071'), 1,
  'idempotence : un seul compte');
SELECT lives_ok($$SELECT open_participation_account('00000000-0000-0000-0000-00000008a072')$$, 'compte ouvert pour une participation d''un autre événement');
SELECT is((SELECT ledger_id FROM account WHERE participation_id = '00000000-0000-0000-0000-00000008a072'),
  pg_temp.lg('00000000-0000-0000-0000-00000008a063'), 'participation d''un autre événement : compte dans son grand livre');
SELECT throws_ok($$SELECT open_participation_account('00000000-0000-0000-0000-00000008afff')$$,
  'P0002', 'Objet introuvable', 'participation inexistante : introuvable');

-- 4. event_transition_conditions : codes rendus par statut visé -------------------------------------------------------
SELECT is(pg_temp.codes('LIVE'), 'TRANSITION_ALLOWED', 'vers LIVE : passage seul');
SELECT is(pg_temp.codes('CLOSING'), 'TRANSITION_ALLOWED', 'vers CLOSING : passage seul');
SELECT is(pg_temp.codes('RECONCILING'), 'TRANSITION_ALLOWED,DEBIT_AUTHORITY_CENTRAL', 'vers RECONCILING : autorité de débit');
SELECT is(pg_temp.codes('SETTLING'), 'TRANSITION_ALLOWED,DEVICES_CAUGHT_UP,DEBIT_AUTHORITY_CENTRAL,SUSPENSE_ZERO',
  'vers SETTLING : terminaux, autorité de débit, compte d''attente');
SELECT is(pg_temp.codes('REFUND_WINDOW'),
  'TRANSITION_ALLOWED,DEBIT_AUTHORITY_CENTRAL,SUSPENSE_ZERO,PARTY_POSITIONS_ZERO,PAYOUT_PENDING_ZERO',
  'vers REFUND_WINDOW : positions des parties et versements en cours');
SELECT is(pg_temp.codes('CLOSED'),
  'TRANSITION_ALLOWED,DEBIT_AUTHORITY_CENTRAL,SUSPENSE_ZERO,PARTY_POSITIONS_ZERO,PAYOUT_PENDING_ZERO,POSITIONS_SETTLED',
  'vers CLOSED : toutes les positions');
SELECT is((SELECT count(*)::int FROM event_transition_conditions('00000000-0000-0000-0000-00000008a061', 'CLOSED')
            WHERE source <> 'DATABASE' OR detail IS NULL OR met IS NULL), 0, 'source DATABASE, détail et résultat toujours posés');

-- 5. Cohérence avec set_event_status : condition non remplie <=> refus ---------------------------------------------
SELECT is(pg_temp.met('LIVE', 'TRANSITION_ALLOWED'), true, 'DRAFT -> LIVE prévu');
SELECT is(pg_temp.met('CLOSING', 'TRANSITION_ALLOWED'), false, 'DRAFT -> CLOSING non prévu');
SELECT throws_ok($$SELECT pg_temp.go('CLOSING')$$, 'CL018', NULL, 'set_event_status refuse DRAFT -> CLOSING (CL018)');
SELECT is(pg_temp.go('LIVE'), 'LIVE'::event_status, 'conditions remplies : DRAFT -> LIVE passe');

-- Écritures de l'événement : commission due à l'organisateur, droit du commerçant, anomalie en attente, versement
-- initié non confirmé.
SELECT lives_ok($$SELECT pg_temp.post('t1', 'A-BANQUE', 'L-ORG-COM', 1000)$$, 'écriture : 1000 à l''organisateur');
SELECT lives_ok($$SELECT pg_temp.post('t2', 'A-BANQUE', 'L-MCH-00000000-0000-0000-0000-00000008a071', 700)$$, 'écriture : 700 au commerçant');
SELECT lives_ok($$SELECT pg_temp.post('t3', 'S-ATTENTE', 'L-ORG-COM', 300)$$, 'écriture : 300 en attente');
SELECT lives_ok($$SELECT pg_temp.post('t4', 'L-ORG-VERS', 'L-VERS-ENCOURS', 200)$$, 'écriture : versement de 200 initié');
SELECT is(pg_temp.go('CLOSING'), 'CLOSING'::event_status, 'LIVE -> CLOSING passe');

-- RECONCILING : autorité de débit détenue par une passerelle.
RESET ROLE;
UPDATE ledger SET debit_authority = 'EDGE', edge_gateway_id = '00000000-0000-0000-0000-00000008a0e1'
 WHERE id = pg_temp.lg('00000000-0000-0000-0000-00000008a061');
SET LOCAL ROLE cashless_app;
SELECT is(pg_temp.unmet('RECONCILING'), 'DEBIT_AUTHORITY_CENTRAL', 'autorité à la passerelle : condition non remplie');
SELECT throws_ok($$SELECT pg_temp.go('RECONCILING')$$, 'CL019', NULL, 'set_event_status refuse RECONCILING (CL019)');
RESET ROLE;
UPDATE ledger SET debit_authority = 'CENTRAL', edge_gateway_id = NULL WHERE id = pg_temp.lg('00000000-0000-0000-0000-00000008a061');
SET LOCAL ROLE cashless_app;
SELECT is(pg_temp.unmet('RECONCILING'), '', 'autorité rendue au central : conditions remplies');
SELECT is(pg_temp.go('RECONCILING'), 'RECONCILING'::event_status, 'CLOSING -> RECONCILING passe');

-- SETTLING : un terminal en retard avant la date limite, et le compte d'attente non soldé.
SELECT is(pg_temp.unmet('SETTLING'), 'DEVICES_CAUGHT_UP,SUSPENSE_ZERO', 'terminal en retard et attente non soldée');
SELECT throws_ok($$SELECT pg_temp.go('SETTLING')$$, 'CL019', NULL, 'set_event_status refuse SETTLING (terminal en retard)');
RESET ROLE;
UPDATE device SET last_seen_at = clock_timestamp() WHERE id = '00000000-0000-0000-0000-00000008a091';
SET LOCAL ROLE cashless_app;
SELECT is(pg_temp.unmet('SETTLING'), 'SUSPENSE_ZERO', 'terminal à jour : reste le compte d''attente');
SELECT throws_like($$SELECT pg_temp.go('SETTLING')$$, 'Compte d''attente non soldé%', 'set_event_status refuse SETTLING (attente non soldée)');
SELECT lives_ok($$SELECT pg_temp.post('t5', 'L-ORG-PERTES', 'S-ATTENTE', 300)$$, 'anomalie soldée en perte de l''organisateur');
SELECT is(pg_temp.unmet('SETTLING'), '', 'attente soldée : conditions remplies');
SELECT is(pg_temp.go('SETTLING'), 'SETTLING'::event_status, 'RECONCILING -> SETTLING passe');

-- Date limite de synchronisation dépassée : un terminal en retard ne bloque plus (événement de B, sans écriture).
RESET ROLE;
INSERT INTO device (id, operator_id, kind, event_id, serial) VALUES
 ('00000000-0000-0000-0000-00000008a092','00000000-0000-0000-0000-00000008a002','POS','00000000-0000-0000-0000-00000008a064','TPE-0008-02');
UPDATE event SET ends_at = clock_timestamp() - interval '30 days' WHERE id = '00000000-0000-0000-0000-00000008a064';
SET LOCAL ROLE cashless_app;
SELECT set_config('app.operator_id', '00000000-0000-0000-0000-00000008a002', true);
SELECT results_eq(
  $$SELECT met, detail FROM event_transition_conditions('00000000-0000-0000-0000-00000008a064', 'SETTLING') WHERE code = 'DEVICES_CAUGHT_UP'$$,
  $$VALUES (true, '1 terminal(aux) en retard, date limite de synchronisation dépassée')$$,
  'après la date limite : terminal en retard toléré');
SELECT set_config('app.operator_id', '00000000-0000-0000-0000-00000008a001', true);

-- REFUND_WINDOW : droit net du commerçant et versement en cours.
SELECT is(pg_temp.unmet('REFUND_WINDOW'), 'PARTY_POSITIONS_ZERO,PAYOUT_PENDING_ZERO', 'commerçant non payé et versement en cours');
SELECT throws_ok($$SELECT pg_temp.go('REFUND_WINDOW')$$, 'CL019', NULL, 'set_event_status refuse REFUND_WINDOW (commerçant non soldé)');
SELECT lives_ok($$SELECT pg_temp.post('t6', 'L-MCH-00000000-0000-0000-0000-00000008a071', 'A-BANQUE', 700)$$, 'commerçant payé');
SELECT is(pg_temp.unmet('REFUND_WINDOW'), 'PAYOUT_PENDING_ZERO', 'reste le versement en cours');
SELECT throws_like($$SELECT pg_temp.go('REFUND_WINDOW')$$, 'Versements initiés non confirmés%', 'set_event_status refuse REFUND_WINDOW (versement en cours)');
SELECT lives_ok($$SELECT pg_temp.post('t7', 'L-VERS-ENCOURS', 'A-BANQUE', 200)$$, 'versement confirmé');
SELECT is(pg_temp.unmet('REFUND_WINDOW'), '', 'conditions remplies');
SELECT is(pg_temp.go('REFUND_WINDOW'), 'REFUND_WINDOW'::event_status, 'SETTLING -> REFUND_WINDOW passe');

-- CLOSED : l'organisateur a encore un droit net (1300 de commissions - 300 de pertes - 200 versés = 800).
SELECT is(pg_temp.unmet('CLOSED'), 'POSITIONS_SETTLED', 'organisateur non soldé');
SELECT results_eq(
  $$SELECT detail FROM event_transition_conditions('00000000-0000-0000-0000-00000008a061', 'CLOSED') WHERE code = 'POSITIONS_SETTLED'$$,
  $$VALUES ('1 position(s) non soldée(s) hors soldes restants autorisés')$$, 'détail : nombre de positions non soldées');
SELECT throws_ok($$SELECT pg_temp.go('CLOSED')$$, 'CL019', NULL, 'set_event_status refuse CLOSED (position non soldée)');
SELECT lives_ok($$SELECT pg_temp.post('t8', 'L-ORG-VERS', 'A-BANQUE', 800)$$, 'organisateur payé');
SELECT is(pg_temp.unmet('CLOSED'), '', 'toutes les conditions remplies');
SELECT is(pg_temp.go('CLOSED'), 'CLOSED'::event_status, 'REFUND_WINDOW -> CLOSED passe');
SELECT is((SELECT status FROM ledger WHERE id = pg_temp.lg('00000000-0000-0000-0000-00000008a061')), 'LOCKED',
  'grand livre soldé : verrouillé à la clôture');
SELECT is(pg_temp.unmet('CLOSED'), 'TRANSITION_ALLOWED', 'événement clos : plus aucun passage prévu');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
