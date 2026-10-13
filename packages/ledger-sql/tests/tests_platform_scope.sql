-- Portée plateforme (migration 0009 et post-roles.sql) — pgTAP, écrit à la main (pas un fichier généré).
-- Lancer : pg_prove -d <base> tests/tests_platform_scope.sql (base créée par les migrations, roles.sql et
-- post-roles.sql rejoués), par un superutilisateur : la suite change de session (SET SESSION AUTHORIZATION), car
-- platform_session() regarde session_user et un superutilisateur est membre de tous les rôles.
\set ON_ERROR_STOP 1
\set QUIET 1
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

-- Fixture (propriétaire) : plateforme, prestataires A et B, organisateur et événement de A, contrats, versions,
-- règles, personnes de la plateforme (e1, e2) et de A (e3), demandes d'approbation, lignes d'audit et d'idempotence.
INSERT INTO party (id, kind, legal_name) VALUES ('00000000-0000-0000-0000-00000009a000','PLATFORM','Plateforme 0009');
INSERT INTO party (id, kind, legal_name, country_code) VALUES
 ('00000000-0000-0000-0000-00000009a001','OPERATOR','Prestataire A','SN'),
 ('00000000-0000-0000-0000-00000009a002','OPERATOR','Prestataire B','CI');
INSERT INTO party (id, kind, operator_id, legal_name, country_code) VALUES
 ('00000000-0000-0000-0000-00000009a011','ORGANIZER','00000000-0000-0000-0000-00000009a001','Organisateur A','SN');
INSERT INTO jurisdiction_profile (id, country_code, version, valid_from, breakage_destination) VALUES
 ('00000000-0000-0000-0000-00000009a041','SN', 90001, '2026-01-01', 'ORGANIZER');
INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone, jurisdiction_id, funds_holder) VALUES
 ('00000000-0000-0000-0000-00000009a061','00000000-0000-0000-0000-00000009a001','00000000-0000-0000-0000-00000009a011',
  'Événement de A','XOF','Africa/Dakar','00000000-0000-0000-0000-00000009a041','ORGANIZER');
INSERT INTO contract (id, operator_id, kind, counterparty_id, valid_from, platform_fee_mode) VALUES
 ('00000000-0000-0000-0000-00000009a051','00000000-0000-0000-0000-00000009a001','PLATFORM_OPERATOR','00000000-0000-0000-0000-00000009a000','2026-01-01','IN_POOL');
INSERT INTO contract (id, operator_id, kind, counterparty_id, valid_from, offline_loss_bearer, cash_diff_bearer, breakage_organizer_bps) VALUES
 ('00000000-0000-0000-0000-00000009a052','00000000-0000-0000-0000-00000009a001','OPERATOR_ORGANIZER','00000000-0000-0000-0000-00000009a011','2026-01-01','ORGANIZER','ORGANIZER',8000);
INSERT INTO config_version (id, operator_id, scope_type, scope_id, version, valid_from, settings) VALUES
 ('00000000-0000-0000-0000-00000009a101', NULL,'PLATFORM','00000000-0000-0000-0000-00000009a000', 1, '2026-01-01', '{"spend_order":"PROMO_FIRST"}'),
 ('00000000-0000-0000-0000-00000009a102','00000000-0000-0000-0000-00000009a001','OPERATOR','00000000-0000-0000-0000-00000009a001', 1, '2026-01-01', '{}');
INSERT INTO fee_rule (id, operator_id, scope_type, scope_id, payer_purpose, beneficiary_purpose, basis, rate_bps, trigger, valid_from) VALUES
 ('00000000-0000-0000-0000-00000009a091','00000000-0000-0000-0000-00000009a001','PLATFORM_CONTRACT','00000000-0000-0000-0000-00000009a051',
  'OPE_REDEV','PLT_REDEV','FEE_AMOUNT', 1000, 'CLOSING', '2026-01-01'),
 ('00000000-0000-0000-0000-00000009a092','00000000-0000-0000-0000-00000009a001','EVENT','00000000-0000-0000-0000-00000009a061',
  'ORG_FPREST','OPE_FRAIS','TOPUP_AMOUNT', 200, 'CLOSING', '2026-01-01');
INSERT INTO app_user (id, operator_id, issuer, subject, email, display_name) VALUES
 ('00000000-0000-0000-0000-00000009a0e1', NULL, 'https://idp.test', '0009-p1', 'p1@plateforme.test', 'Admin plateforme 1'),
 ('00000000-0000-0000-0000-00000009a0e2', NULL, 'https://idp.test', '0009-p2', 'p2@plateforme.test', 'Admin plateforme 2'),
 ('00000000-0000-0000-0000-00000009a0e3', '00000000-0000-0000-0000-00000009a001', 'https://idp.test', '0009-a1', 'a1@prestataire.test', 'Admin de A');
INSERT INTO role_assignment (id, user_id, role, scope_type, scope_id) VALUES
 ('00000000-0000-0000-0000-00000009a0f1','00000000-0000-0000-0000-00000009a0e1','PLATFORM_ADMIN','PLATFORM',NULL),
 ('00000000-0000-0000-0000-00000009a0f3','00000000-0000-0000-0000-00000009a0e3','OPERATOR_ADMIN','OPERATOR','00000000-0000-0000-0000-00000009a001');
INSERT INTO approval_request (id, operator_id, action, payload, requested_by) VALUES
 ('00000000-0000-0000-0000-00000009a0a1', NULL, 'PLATFORM_CONTRACT_VERSION', '{"n":1}', '00000000-0000-0000-0000-00000009a0e1'),
 ('00000000-0000-0000-0000-00000009a0a2', NULL, 'JURISDICTION_LIMITS_CHANGE', '{"n":2}', '00000000-0000-0000-0000-00000009a0e1'),
 ('00000000-0000-0000-0000-00000009a0a3', '00000000-0000-0000-0000-00000009a001', 'CONTRACT_VERSION', '{"n":3}', '00000000-0000-0000-0000-00000009a0e3'),
 ('00000000-0000-0000-0000-00000009a0a4', '00000000-0000-0000-0000-00000009a001', 'CONTRACT_VERSION', '{"n":4}', '00000000-0000-0000-0000-00000009a0e3');
INSERT INTO audit_log (operator_id, action) VALUES ('00000000-0000-0000-0000-00000009a001', 'TEST_0009_A'), (NULL, 'TEST_0009_PLT');

CREATE FUNCTION pg_temp.idem(p_operator uuid, p_key text) RETURNS void LANGUAGE sql AS $$
  INSERT INTO api_idempotency (operator_id, scope, idempotency_key, request_hash, status, lease_until, expires_at)
  VALUES (p_operator, 'plt:test', p_key, repeat('a', 64), 'IN_PROGRESS', clock_timestamp() + interval '1 minute',
          clock_timestamp() + interval '1 day')
$$;

-- 1. Migration 0009 : structure --------------------------------------------------------------------------------
SELECT col_is_null('approval_request', 'operator_id', 'approval_request.operator_id facultatif (NULL = plateforme)');
SELECT col_is_null('api_idempotency', 'operator_id', 'api_idempotency.operator_id facultatif (NULL = plateforme)');
SELECT has_function('platform_session', ARRAY[]::text[]);
SELECT is((SELECT prosecdef FROM pg_proc WHERE proname = 'platform_session'), false, 'platform_session : SECURITY INVOKER');
SELECT is((SELECT provolatile FROM pg_proc WHERE proname = 'platform_session'), 's', 'platform_session : STABLE');
SELECT is((SELECT prosecdef FROM pg_proc WHERE proname = 'decide_approval_request'), true, 'decide_approval_request : toujours SECURITY DEFINER');

-- Actions : les huit actions de la mission, et leur niveau.
SELECT lives_ok($$INSERT INTO approval_request (operator_id, action, payload, requested_by)
  SELECT '00000000-0000-0000-0000-00000009a001', a, '{}', '00000000-0000-0000-0000-00000009a0e3'
    FROM unnest(ARRAY['EVENT_GO_LIVE','EVENT_SETTINGS_CHANGE','EVENT_OPERATOR_SETTINGS_CHANGE','PARTICIPATION_CHANGE',
                      'FEE_RULE_CHANGE','CONTRACT_VERSION','ADJUSTMENT']) a$$,
  'actions de prestataire de la mission acceptées (et une action existante)');
SELECT throws_ok($$INSERT INTO approval_request (operator_id, action, payload, requested_by)
  VALUES ('00000000-0000-0000-0000-00000009a001', 'EVENT_DELETE', '{}', '00000000-0000-0000-0000-00000009a0e3')$$,
  '23514', NULL, 'action hors liste refusée');
SELECT throws_ok($$INSERT INTO approval_request (operator_id, action, payload, requested_by)
  VALUES (NULL, 'ADJUSTMENT', '{}', '00000000-0000-0000-0000-00000009a0e1')$$,
  '23514', NULL, 'demande sans prestataire avec une action de prestataire refusée');
SELECT throws_ok($$INSERT INTO approval_request (operator_id, action, payload, requested_by)
  VALUES (NULL, 'CONTRACT_VERSION', '{}', '00000000-0000-0000-0000-00000009a0e1')$$,
  '23514', NULL, 'CONTRACT_VERSION sans prestataire refusée');
SELECT throws_ok($$INSERT INTO approval_request (operator_id, action, payload, requested_by)
  VALUES ('00000000-0000-0000-0000-00000009a001', 'PLATFORM_CONTRACT_VERSION', '{}', '00000000-0000-0000-0000-00000009a0e3')$$,
  '23514', NULL, 'action de plateforme rattachée à un prestataire refusée');

-- Idempotence : NULL se heurte à NULL, un prestataire ne se heurte qu'à lui-même.
SELECT lives_ok($$SELECT pg_temp.idem(NULL, 'k1')$$, 'clé de niveau plateforme acceptée');
SELECT throws_ok($$SELECT pg_temp.idem(NULL, 'k1')$$, '23505', NULL, 'même clé de niveau plateforme : unicité violée');
SELECT lives_ok($$SELECT pg_temp.idem('00000000-0000-0000-0000-00000009a001', 'k1')$$, 'même clé pour le prestataire A acceptée');
SELECT lives_ok($$SELECT pg_temp.idem('00000000-0000-0000-0000-00000009a002', 'k1')$$, 'même clé pour le prestataire B acceptée');
SELECT throws_ok($$SELECT pg_temp.idem('00000000-0000-0000-0000-00000009a001', 'k1')$$, '23505', NULL, 'même clé, même prestataire : toujours refusée');

-- 2. Droits effectifs --------------------------------------------------------------------------------------------
SELECT results_eq($$SELECT rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolbypassrls FROM pg_roles WHERE rolname = 'cashless_platform'$$,
  $$VALUES (true, false, false, false, false)$$, 'cashless_platform : connexion seule, ni superutilisateur ni BYPASSRLS');
SELECT results_eq($$SELECT unnest(rolconfig) FROM pg_roles WHERE rolname = 'cashless_platform' ORDER BY 1$$,
  $$SELECT unnest(rolconfig) FROM pg_roles WHERE rolname = 'cashless_app' ORDER BY 1$$,
  'cashless_platform : mêmes durées de transaction que cashless_app');
-- Grand livre et événements : aucun droit, d'aucune sorte.
SELECT is((SELECT coalesce(string_agg(t || ':' || p, ','), '')
             FROM unnest(ARRAY['journal_transaction','posting','account_balance','ledger','account','event','wallet','media','device',
                               'merchant_participation','point_of_sale','payout','event_status_history']) t,
                  unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) p
            WHERE has_table_privilege('cashless_platform', t, p)), '',
  'cashless_platform : aucun droit sur le grand livre, les événements et leurs objets');
SELECT is((SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relkind IN ('r','p')
              AND (has_table_privilege('cashless_platform', c.oid, 'DELETE') OR has_table_privilege('cashless_platform', c.oid, 'TRUNCATE'))), 0,
  'cashless_platform : aucune suppression nulle part');
-- Droits de table : exactement ceux-ci, rien d'autre.
SELECT results_eq(
  $$SELECT c.relname::text COLLATE "default", p FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace,
           unnest(ARRAY['SELECT','INSERT','UPDATE']) p
     WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v') AND has_table_privilege('cashless_platform', c.oid, p)
       -- hors vues de pgTAP (extension), lisibles de tous
       AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e')
     ORDER BY c.relname, p$$,
  $$VALUES ('api_idempotency','INSERT'), ('api_idempotency','SELECT'), ('api_idempotency','UPDATE'),
           ('app_user','SELECT'),
           ('approval_request','INSERT'), ('approval_request','SELECT'),
           ('audit_log','INSERT'), ('audit_log','SELECT'),
           ('config_version','INSERT'), ('config_version','SELECT'),
           ('contract','INSERT'), ('contract','SELECT'),
           ('currency_exponent','SELECT'),
           ('fee_rule','INSERT'), ('fee_rule','SELECT'),
           ('jurisdiction_profile','INSERT'), ('jurisdiction_profile','SELECT'),
           ('party','INSERT'), ('party','SELECT'),
           ('role_assignment','SELECT')$$,
  'cashless_platform : droits de table exacts');
-- Droits de colonne : exactement ceux-ci (hors api_idempotency, modifiable en entier).
SELECT results_eq(
  $$SELECT c.relname::text COLLATE "default", a.attname::text COLLATE "default" FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
     WHERE n.nspname = 'public' AND c.relkind IN ('r','p') AND c.relname <> 'api_idempotency'
       AND has_column_privilege('cashless_platform', c.oid, a.attnum, 'UPDATE')
     ORDER BY c.relname, a.attname$$,
  $$VALUES ('approval_request','executed_tx_id'), ('approval_request','failure_code'), ('approval_request','failure_reason'),
           ('approval_request','result'), ('approval_request','status'),
           ('fee_rule','valid_to'),
           ('party','country_code'), ('party','legal_name'), ('party','tax_id')$$,
  'cashless_platform : colonnes modifiables exactes');
SELECT results_eq(
  $$SELECT c.relname::text COLLATE "default" FROM pg_sequence s JOIN pg_class c ON c.oid = s.seqrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND has_sequence_privilege('cashless_platform', s.seqrelid, 'USAGE') ORDER BY c.relname$$,
  $$VALUES ('audit_log_id_seq')$$, 'cashless_platform : une seule séquence (audit_log)');
SELECT ok(has_function_privilege('cashless_platform', 'decide_approval_request(uuid, uuid, boolean, text)', 'execute')
      AND has_function_privilege('cashless_platform', 'platform_session()', 'execute'),
  'cashless_platform : decide_approval_request et platform_session exécutables');
SELECT ok(NOT has_function_privilege('cashless_platform', 'party_kind_of(uuid)', 'execute')
      AND NOT has_function_privilege('cashless_platform', 'event_transition_conditions(uuid, event_status)', 'execute')
      AND NOT has_function_privilege('cashless_platform', 'tenant_of_event(uuid)', 'execute')
      AND NOT has_function_privilege('cashless_platform', 'create_platform_admin(uuid, text, text, text, text, text, text, uuid)', 'execute'),
  'cashless_platform : aucune fonction retirée à PUBLIC en dehors des deux siennes');
-- Rôle applicatif.
SELECT is((SELECT coalesce(string_agg(t || ':' || p, ','), '')
             FROM unnest(ARRAY['jurisdiction_profile','currency_exponent']) t, unnest(ARRAY['INSERT','UPDATE','DELETE','TRUNCATE']) p
            WHERE has_table_privilege('cashless_app', t, p)), '',
  'cashless_app : aucune écriture des profils de législation ni des devises (X-3)');
SELECT ok(has_table_privilege('cashless_app', 'jurisdiction_profile', 'SELECT') AND has_table_privilege('cashless_app', 'currency_exponent', 'SELECT'),
  'cashless_app : profils de législation et devises lisibles');
SELECT ok(NOT has_function_privilege('cashless_app', 'party_kind_of(uuid)', 'execute')
      AND NOT has_function_privilege('cashless_app', 'platform_session()', 'execute')
      AND NOT has_function_privilege('public', 'party_kind_of(uuid)', 'execute')
      AND NOT has_function_privilege('public', 'platform_session()', 'execute'),
  'cashless_app et PUBLIC : fonctions internes party_kind_of et platform_session non exécutables');
SELECT ok(has_function_privilege('cashless_app', 'open_event_ledger(uuid)', 'execute')
      AND has_function_privilege('cashless_app', 'open_participation_account(uuid)', 'execute')
      AND has_function_privilege('cashless_app', 'event_transition_conditions(uuid, event_status)', 'execute')
      AND has_function_privilege('cashless_app', 'decide_approval_request(uuid, uuid, boolean, text)', 'execute'),
  'cashless_app : fonctions d''API de la mission exécutables');
-- Politiques : toutes nominatives (une politique de plateforme sans TO ouvrirait la portée au rôle applicatif).
SELECT is((SELECT count(*)::int FROM pg_policies WHERE policyname LIKE 'platform\_%' AND roles <> '{cashless_platform}'), 0,
  'politiques platform_* : toutes réservées à cashless_platform');
SELECT is((SELECT count(*)::int FROM pg_policies WHERE roles = '{cashless_app}' AND permissive = 'RESTRICTIVE'), 4,
  'politiques restrictives du rôle applicatif : contrat, version de configuration, règle de frais (insertion, fermeture)');
SELECT is((SELECT count(*)::int FROM pg_policies WHERE policyname LIKE 'app\_no\_%' AND roles <> '{cashless_app}'), 0,
  'politiques app_no_* : toutes réservées à cashless_app');
SELECT is((SELECT count(*)::int FROM pg_policies WHERE roles = '{cashless_platform}'), 46,
  'politiques du rôle de la plateforme : 7 tables en lecture et écriture (6 chacune), 2 en lecture seule (2 chacune)');

-- 3. Rôle applicatif, session du prestataire A : aucune écriture de plateforme --------------------------------------
SET LOCAL SESSION AUTHORIZATION cashless_app;
SELECT set_config('app.operator_id', '00000000-0000-0000-0000-00000009a001', true);
SELECT throws_ok($$INSERT INTO party (kind, legal_name) VALUES ('OPERATOR', 'Prestataire pirate')$$,
  '42501', NULL, 'cashless_app : création d''un prestataire refusée');
SELECT throws_ok($$INSERT INTO config_version (operator_id, scope_type, scope_id, version, valid_from, settings)
  VALUES (NULL, 'PLATFORM', '00000000-0000-0000-0000-00000009a000', 2, now(), '{}')$$,
  '42501', NULL, 'cashless_app : version de configuration PLATFORM refusée');
SELECT throws_ok($$INSERT INTO config_version (operator_id, scope_type, scope_id, version, valid_from, settings)
  VALUES ('00000000-0000-0000-0000-00000009a001', 'PLATFORM', '00000000-0000-0000-0000-00000009a000', 2, now(), '{}')$$,
  '42501', NULL, 'cashless_app : version PLATFORM rattachée à son prestataire refusée');
SELECT lives_ok($$INSERT INTO config_version (operator_id, scope_type, scope_id, version, valid_from, settings)
  VALUES ('00000000-0000-0000-0000-00000009a001', 'OPERATOR', '00000000-0000-0000-0000-00000009a001', 2, '2026-02-01', '{}')$$,
  'cashless_app : version de configuration de son prestataire acceptée');
SELECT throws_ok($$INSERT INTO contract (operator_id, kind, counterparty_id, valid_from, platform_fee_mode)
  VALUES ('00000000-0000-0000-0000-00000009a001', 'PLATFORM_OPERATOR', '00000000-0000-0000-0000-00000009a000', now(), 'INVOICED')$$,
  '42501', NULL, 'cashless_app : contrat PLATFORM_OPERATOR refusé, même pour son prestataire');
SELECT throws_ok($$INSERT INTO fee_rule (operator_id, scope_type, scope_id, payer_purpose, beneficiary_purpose, basis, rate_bps, trigger, valid_from, version)
  VALUES ('00000000-0000-0000-0000-00000009a001', 'PLATFORM_CONTRACT', '00000000-0000-0000-0000-00000009a051', 'OPE_REDEV', 'PLT_REDEV', 'FEE_AMOUNT', 1, 'CLOSING', now(), 2)$$,
  '42501', NULL, 'cashless_app : règle PLATFORM_CONTRACT refusée');
UPDATE fee_rule SET valid_to = '2026-06-01' WHERE id = '00000000-0000-0000-0000-00000009a091';
SELECT is((SELECT valid_to FROM fee_rule WHERE id = '00000000-0000-0000-0000-00000009a091'), NULL,
  'cashless_app : fermeture d''une règle PLATFORM_CONTRACT sans effet');
SELECT throws_ok($$INSERT INTO jurisdiction_profile (country_code, version, valid_from, breakage_destination) VALUES ('SN', 90009, '2026-01-01', 'NONE')$$,
  '42501', NULL, 'cashless_app : profil de législation refusé');
SELECT throws_ok($$INSERT INTO currency_exponent VALUES ('GBP', 2)$$, '42501', NULL, 'cashless_app : devise refusée');
SELECT throws_ok($$INSERT INTO approval_request (operator_id, action, payload, requested_by)
  VALUES (NULL, 'PLATFORM_CONTRACT_VERSION', '{}', '00000000-0000-0000-0000-00000009a0e3')$$,
  '42501', NULL, 'cashless_app : demande de niveau plateforme refusée');
SELECT throws_ok($$SELECT pg_temp.idem(NULL, 'k-app')$$, '42501', NULL, 'cashless_app : clé d''idempotence de niveau plateforme refusée');
-- Ce que le prestataire garde : lecture de son contrat avec la plateforme et de ses redevances, écriture du reste.
SELECT is((SELECT count(*)::int FROM contract WHERE kind = 'PLATFORM_OPERATOR'), 1, 'cashless_app : son contrat avec la plateforme lisible');
SELECT is((SELECT count(*)::int FROM fee_rule WHERE scope_type = 'PLATFORM_CONTRACT'), 1, 'cashless_app : ses redevances lisibles');
SELECT lives_ok($$INSERT INTO contract (operator_id, kind, counterparty_id, valid_from, offline_loss_bearer, cash_diff_bearer, breakage_organizer_bps)
  VALUES ('00000000-0000-0000-0000-00000009a001', 'OPERATOR_ORGANIZER', '00000000-0000-0000-0000-00000009a011', '2026-03-01', 'OPERATOR', 'ORGANIZER', 7000)$$,
  'cashless_app : nouvelle version d''un contrat OPERATOR_ORGANIZER acceptée');
SELECT lives_ok($$UPDATE fee_rule SET valid_to = '2026-06-01' WHERE id = '00000000-0000-0000-0000-00000009a092'$$,
  'cashless_app : fermeture d''une règle d''événement acceptée');
SELECT is((SELECT valid_to FROM fee_rule WHERE id = '00000000-0000-0000-0000-00000009a092'), '2026-06-01'::timestamptz,
  'cashless_app : règle d''événement fermée');
-- Lignes de niveau plateforme : invisibles, et la demande de plateforme n'est pas décidable.
SELECT is((SELECT count(*)::int FROM approval_request WHERE operator_id IS NULL), 0, 'cashless_app : demandes de plateforme invisibles');
SELECT is((SELECT count(*)::int FROM api_idempotency WHERE operator_id IS NULL), 0, 'cashless_app : clés de plateforme invisibles');
SELECT is((SELECT count(*)::int FROM audit_log WHERE operator_id IS NULL), 0, 'cashless_app : audit de plateforme invisible');
SELECT throws_ok($$SELECT decide_approval_request('00000000-0000-0000-0000-00000009a0a1', '00000000-0000-0000-0000-00000009a0e2', true)$$,
  'P0002', 'Objet introuvable', 'cashless_app : décision d''une demande de plateforme refusée (introuvable)');
SELECT throws_ok($$SELECT platform_session()$$, '42501', NULL, 'cashless_app : platform_session non exécutable');
-- Régression : une demande de prestataire se décide comme avant.
SELECT throws_ok($$SELECT decide_approval_request('00000000-0000-0000-0000-00000009a0a3', '00000000-0000-0000-0000-00000009a0e3', true)$$,
  'CL023', NULL, 'demande de prestataire : auteur = valideur toujours refusé');
SELECT is((decide_approval_request('00000000-0000-0000-0000-00000009a0a3', '00000000-0000-0000-0000-00000009a0e9', true)).status, 'APPROVED',
  'demande de prestataire : décidée par une autre personne de son prestataire');
SELECT set_config('app.operator_id', '00000000-0000-0000-0000-00000009a002', true);
SELECT throws_ok($$SELECT decide_approval_request('00000000-0000-0000-0000-00000009a0a4', '00000000-0000-0000-0000-00000009a0e9', true)$$,
  'P0002', 'Objet introuvable', 'demande de prestataire : introuvable depuis un autre prestataire');
RESET SESSION AUTHORIZATION;

-- 4. Rôle de la plateforme, sans prestataire -------------------------------------------------------------------------
SET LOCAL SESSION AUTHORIZATION cashless_platform;
SELECT set_config('app.operator_id', '00000000-0000-0000-0000-000000000000', true);
SELECT is(platform_session(), true, 'session du rôle de la plateforme reconnue');
-- Parties : la plateforme et les prestataires, rien d'autre.
SELECT is((SELECT count(*)::int FROM party WHERE kind NOT IN ('PLATFORM','OPERATOR')), 0, 'plateforme : organisateurs et commerçants invisibles');
SELECT is((SELECT count(*)::int FROM party WHERE id IN ('00000000-0000-0000-0000-00000009a000','00000000-0000-0000-0000-00000009a001','00000000-0000-0000-0000-00000009a002')), 3,
  'plateforme : la plateforme et les prestataires visibles');
SELECT lives_ok($$INSERT INTO party (id, kind, legal_name, country_code) VALUES ('00000000-0000-0000-0000-00000009a003', 'OPERATOR', 'Prestataire C', 'SN')$$,
  'plateforme : création d''un prestataire acceptée');
SELECT lives_ok($$UPDATE party SET legal_name = 'Prestataire C SARL', tax_id = 'SN-0009' WHERE id = '00000000-0000-0000-0000-00000009a003'$$,
  'plateforme : fiche d''un prestataire modifiée');
SELECT throws_ok($$UPDATE party SET kind = 'ORGANIZER' WHERE id = '00000000-0000-0000-0000-00000009a003'$$,
  '42501', NULL, 'plateforme : type d''une partie non modifiable');
SELECT throws_ok($$INSERT INTO party (kind, operator_id, legal_name) VALUES ('ORGANIZER', '00000000-0000-0000-0000-00000009a001', 'Organisateur pirate')$$,
  '42501', NULL, 'plateforme : création d''un organisateur refusée');
SELECT throws_ok($$INSERT INTO party (kind, legal_name) VALUES ('PLATFORM', 'Seconde plateforme')$$,
  '42501', NULL, 'plateforme : création d''une seconde plateforme refusée');
-- Événements et grand livre : aucun droit.
SELECT throws_ok($$SELECT count(*) FROM event$$, '42501', NULL, 'plateforme : événements illisibles');
SELECT throws_ok($$INSERT INTO event (operator_id, organizer_id, name, currency, timezone, jurisdiction_id, funds_holder)
  VALUES ('00000000-0000-0000-0000-00000009a001','00000000-0000-0000-0000-00000009a011','X','XOF','Africa/Dakar','00000000-0000-0000-0000-00000009a041','ORGANIZER')$$,
  '42501', NULL, 'plateforme : création d''un événement refusée');
SELECT throws_ok($$SELECT count(*) FROM ledger$$, '42501', NULL, 'plateforme : grand livre illisible');
SELECT throws_ok($$SELECT count(*) FROM posting$$, '42501', NULL, 'plateforme : écritures illisibles');
-- Configuration : le niveau PLATFORM seul.
SELECT lives_ok($$INSERT INTO config_version (operator_id, scope_type, scope_id, version, valid_from, settings)
  VALUES (NULL, 'PLATFORM', '00000000-0000-0000-0000-00000009a000', 1, '2026-02-01', '{"spend_order":"PAID_FIRST"}')$$,
  'plateforme : version de configuration PLATFORM acceptée');
SELECT is((SELECT max(version) FROM config_version WHERE scope_type = 'PLATFORM' AND scope_id = '00000000-0000-0000-0000-00000009a000'), 2,
  'plateforme : version numérotée par la base (2)');
SELECT throws_ok($$INSERT INTO config_version (operator_id, scope_type, scope_id, version, valid_from, settings)
  VALUES ('00000000-0000-0000-0000-00000009a001', 'OPERATOR', '00000000-0000-0000-0000-00000009a001', 2, '2026-02-01', '{}')$$,
  '42501', NULL, 'plateforme : version de configuration OPERATOR refusée');
SELECT is((SELECT count(*)::int FROM config_version WHERE scope_type <> 'PLATFORM'), 0, 'plateforme : versions des prestataires invisibles');
-- Contrats et redevances.
SELECT lives_ok($$INSERT INTO contract (id, operator_id, kind, counterparty_id, valid_from, platform_fee_mode)
  VALUES ('00000000-0000-0000-0000-00000009a053', '00000000-0000-0000-0000-00000009a002', 'PLATFORM_OPERATOR', '00000000-0000-0000-0000-00000009a000', '2026-01-01', 'INVOICED')$$,
  'plateforme : contrat PLATFORM_OPERATOR d''un prestataire accepté');
SELECT throws_ok($$INSERT INTO contract (operator_id, kind, counterparty_id, valid_from, offline_loss_bearer, cash_diff_bearer, breakage_organizer_bps)
  VALUES ('00000000-0000-0000-0000-00000009a001', 'OPERATOR_ORGANIZER', '00000000-0000-0000-0000-00000009a011', '2026-04-01', 'OPERATOR', 'ORGANIZER', 7000)$$,
  '42501', NULL, 'plateforme : contrat OPERATOR_ORGANIZER refusé');
SELECT is((SELECT count(*)::int FROM contract WHERE kind <> 'PLATFORM_OPERATOR'), 0, 'plateforme : contrats des organisateurs invisibles');
SELECT lives_ok($$INSERT INTO fee_rule (id, operator_id, scope_type, scope_id, payer_purpose, beneficiary_purpose, basis, rate_bps, trigger, valid_from)
  VALUES ('00000000-0000-0000-0000-00000009a093', '00000000-0000-0000-0000-00000009a002', 'PLATFORM_CONTRACT', '00000000-0000-0000-0000-00000009a053', 'OPE_REDEV', 'PLT_REDEV', 'FEE_AMOUNT', 800, 'CLOSING', '2026-01-01')$$,
  'plateforme : redevance sur un contrat PLATFORM_OPERATOR acceptée');
SELECT lives_ok($$UPDATE fee_rule SET valid_to = '2026-06-01' WHERE id = '00000000-0000-0000-0000-00000009a091'$$, 'plateforme : fermeture d''une redevance');
SELECT is((SELECT valid_to FROM fee_rule WHERE id = '00000000-0000-0000-0000-00000009a091'), '2026-06-01'::timestamptz, 'plateforme : redevance fermée');
SELECT throws_ok($$UPDATE fee_rule SET rate_bps = 1 WHERE id = '00000000-0000-0000-0000-00000009a093'$$,
  '42501', NULL, 'plateforme : taux d''une redevance non modifiable');
SELECT throws_ok($$INSERT INTO fee_rule (operator_id, scope_type, scope_id, payer_purpose, beneficiary_purpose, basis, rate_bps, trigger, valid_from, version)
  VALUES ('00000000-0000-0000-0000-00000009a001', 'EVENT', '00000000-0000-0000-0000-00000009a061', 'ORG_FPREST', 'OPE_FRAIS', 'TOPUP_AMOUNT', 300, 'CLOSING', now(), 2)$$,
  '42501', NULL, 'plateforme : règle de frais d''événement refusée');
SELECT is((SELECT count(*)::int FROM fee_rule WHERE scope_type <> 'PLATFORM_CONTRACT'), 0, 'plateforme : règles des prestataires invisibles');
-- Profils de législation et devises.
SELECT lives_ok($$INSERT INTO jurisdiction_profile (country_code, version, valid_from, breakage_destination) VALUES ('SN', 90002, '2026-06-01', 'LEGAL_ACCOUNT')$$,
  'plateforme : nouvelle version d''un profil de législation acceptée');
SELECT throws_ok($$INSERT INTO currency_exponent VALUES ('GBP', 2)$$, '42501', NULL, 'plateforme : devises en lecture seule');
-- Personnes : celles de la plateforme, en lecture seule.
SELECT results_eq($$SELECT id FROM app_user WHERE issuer = 'https://idp.test' AND subject LIKE '0009-%' ORDER BY id$$,
  $$VALUES ('00000000-0000-0000-0000-00000009a0e1'::uuid), ('00000000-0000-0000-0000-00000009a0e2'::uuid)$$,
  'plateforme : personnes de la plateforme visibles, personnes d''un prestataire invisibles');
SELECT is((SELECT count(*)::int FROM role_assignment WHERE operator_id IS NOT NULL), 0, 'plateforme : attributions des prestataires invisibles');
SELECT is((SELECT role FROM role_assignment WHERE id = '00000000-0000-0000-0000-00000009a0f1'), 'PLATFORM_ADMIN', 'plateforme : attribution PLATFORM_ADMIN lisible');
SELECT throws_ok($$INSERT INTO app_user (issuer, subject, email, display_name) VALUES ('https://idp.test', '0009-p3', 'p3@plateforme.test', 'P3')$$,
  '42501', NULL, 'plateforme : création d''une personne refusée (create_platform_admin seulement)');
-- Audit et idempotence de niveau plateforme.
SELECT lives_ok($$INSERT INTO audit_log (operator_id, actor_id, actor_role, action) VALUES (NULL, '00000000-0000-0000-0000-00000009a0e1', 'PLATFORM_ADMIN', 'TEST_0009_WRITE')$$,
  'plateforme : ligne d''audit de plateforme écrite');
SELECT throws_ok($$INSERT INTO audit_log (operator_id, action) VALUES ('00000000-0000-0000-0000-00000009a001', 'TEST_0009_PIRATE')$$,
  '42501', NULL, 'plateforme : ligne d''audit d''un prestataire refusée');
SELECT is((SELECT count(*)::int FROM audit_log WHERE operator_id IS NOT NULL), 0, 'plateforme : audit des prestataires invisible');
SELECT is((SELECT count(*)::int FROM audit_log WHERE action IN ('TEST_0009_PLT','TEST_0009_WRITE')), 2, 'plateforme : audit de plateforme lisible');
SELECT lives_ok($$SELECT pg_temp.idem(NULL, 'k2')$$, 'plateforme : clé d''idempotence réservée');
SELECT lives_ok($$UPDATE api_idempotency SET status = 'COMPLETED', response_status = 201, completed_at = clock_timestamp()
  WHERE operator_id IS NULL AND idempotency_key = 'k2'$$, 'plateforme : réponse enregistrée');
SELECT throws_ok($$SELECT pg_temp.idem('00000000-0000-0000-0000-00000009a001', 'k2')$$, '42501', NULL, 'plateforme : clé d''un prestataire refusée');
SELECT is((SELECT count(*)::int FROM api_idempotency WHERE operator_id IS NOT NULL), 0, 'plateforme : clés des prestataires invisibles');
-- Demandes d'approbation de niveau plateforme : auteur différent du valideur, comme partout.
SELECT lives_ok($$INSERT INTO approval_request (operator_id, action, payload, requested_by)
  VALUES (NULL, 'PLATFORM_CONTRACT_VERSION', '{"n":5}', '00000000-0000-0000-0000-00000009a0e2')$$, 'plateforme : demande de niveau plateforme créée');
SELECT throws_ok($$INSERT INTO approval_request (operator_id, action, payload, requested_by)
  VALUES ('00000000-0000-0000-0000-00000009a001', 'CONTRACT_VERSION', '{}', '00000000-0000-0000-0000-00000009a0e2')$$,
  '42501', NULL, 'plateforme : demande d''un prestataire refusée');
SELECT is((SELECT count(*)::int FROM approval_request WHERE operator_id IS NOT NULL), 0, 'plateforme : demandes des prestataires invisibles');
SELECT throws_ok($$SELECT decide_approval_request('00000000-0000-0000-0000-00000009a0a1', '00000000-0000-0000-0000-00000009a0e1', true)$$,
  'CL023', NULL, 'plateforme : auteur = valideur refusé');
SELECT is((decide_approval_request('00000000-0000-0000-0000-00000009a0a1', '00000000-0000-0000-0000-00000009a0e2', true)).status, 'APPROVED',
  'plateforme : demande approuvée par un autre administrateur');
SELECT throws_ok($$SELECT decide_approval_request('00000000-0000-0000-0000-00000009a0a1', '00000000-0000-0000-0000-00000009a0e2', false)$$,
  'CL023', NULL, 'plateforme : demande déjà décidée');
SELECT lives_ok($$UPDATE approval_request SET status = 'EXECUTED', result = '{"contract_id":"x"}' WHERE id = '00000000-0000-0000-0000-00000009a0a1'$$,
  'plateforme : demande exécutée, résultat enregistré');
SELECT throws_ok($$UPDATE approval_request SET decided_by = '00000000-0000-0000-0000-00000009a0e1' WHERE id = '00000000-0000-0000-0000-00000009a0a2'$$,
  '42501', NULL, 'plateforme : décision hors de decide_approval_request refusée');
SELECT is((decide_approval_request('00000000-0000-0000-0000-00000009a0a2', '00000000-0000-0000-0000-00000009a0e2', false)).status, 'REJECTED',
  'plateforme : demande refusée par un autre administrateur');
SELECT throws_ok($$SELECT decide_approval_request('00000000-0000-0000-0000-00000009a0a4', '00000000-0000-0000-0000-00000009a0e2', true)$$,
  'P0002', 'Objet introuvable', 'plateforme : demande d''un prestataire introuvable');

-- Borne : même en posant lui-même le prestataire de session, le rôle de la plateforme reste dans sa portée.
SELECT set_config('app.operator_id', '00000000-0000-0000-0000-00000009a001', true);
SELECT is((SELECT count(*)::int FROM party WHERE kind NOT IN ('PLATFORM','OPERATOR')), 0, 'borne : organisateurs toujours invisibles');
SELECT is((SELECT count(*)::int FROM contract WHERE kind <> 'PLATFORM_OPERATOR'), 0, 'borne : contrats des organisateurs toujours invisibles');
SELECT is((SELECT count(*)::int FROM config_version WHERE scope_type <> 'PLATFORM'), 0, 'borne : versions du prestataire toujours invisibles');
SELECT is((SELECT count(*)::int FROM fee_rule WHERE scope_type <> 'PLATFORM_CONTRACT'), 0, 'borne : règles du prestataire toujours invisibles');
SELECT is((SELECT count(*)::int FROM app_user WHERE operator_id IS NOT NULL), 0, 'borne : personnes du prestataire toujours invisibles');
SELECT is((SELECT count(*)::int FROM audit_log WHERE operator_id IS NOT NULL), 0, 'borne : audit du prestataire toujours invisible');
SELECT is((SELECT count(*)::int FROM approval_request WHERE operator_id IS NOT NULL), 0, 'borne : demandes du prestataire toujours invisibles');
SELECT throws_ok($$INSERT INTO party (kind, operator_id, legal_name) VALUES ('ORGANIZER', '00000000-0000-0000-0000-00000009a001', 'Organisateur pirate')$$,
  '42501', NULL, 'borne : création d''un organisateur toujours refusée');
SELECT throws_ok($$INSERT INTO config_version (operator_id, scope_type, scope_id, version, valid_from, settings)
  VALUES ('00000000-0000-0000-0000-00000009a001', 'OPERATOR', '00000000-0000-0000-0000-00000009a001', 2, '2026-02-01', '{}')$$,
  '42501', NULL, 'borne : version de configuration OPERATOR toujours refusée');
RESET SESSION AUTHORIZATION;

SELECT * FROM finish();
ROLLBACK;
