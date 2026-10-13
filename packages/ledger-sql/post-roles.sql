-- Droits du rôle applicatif posés APRÈS roles.sql (mission identite-roles-double-validation, plan « Complexity
-- Tracking »). roles.sql, fichier du kit, rend INSERT, UPDATE et EXECUTE sur tout à chaque rejeu : ce fichier
-- retire ensuite ce qui ne doit pas l'être et accorde les colonnes nouvelles. Idempotent ; exécuté par le
-- propriétaire des tables, rejoué par migrate.ts juste après roles.sql.

-- Journal d'audit : ajout seul (les déclencheurs refusent aussi, pour tout rôle) ; scellements : fonctions seules.
REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM cashless_app;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON audit_seal FROM cashless_app;

-- Jetons d'approbation consommés : insertion seule.
REVOKE UPDATE, DELETE, TRUNCATE ON approval_token_use FROM cashless_app;

-- Fonctions d'exploitation et internes du journal d'audit : jamais appelées par l'application.
REVOKE EXECUTE ON FUNCTION
  seal_audit(uuid, interval), verify_audit_chain(uuid, timestamptz), audit_chain_genesis(uuid),
  audit_row_canonical(audit_log), audit_rows_sha256(uuid, bigint, bigint)
FROM cashless_app, PUBLIC;
-- Fonction interne des gardes d'identité (compte les administrateurs de toute la plateforme, hors RLS).
REVOKE EXECUTE ON FUNCTION active_platform_admins(uuid, uuid) FROM cashless_app, PUBLIC;

-- Résultat de l'action exécutée (R-02) : écrit au passage APPROVED -> EXECUTED.
GRANT UPDATE (result) ON approval_request TO cashless_app;

-- Fonctions d'API SECURITY DEFINER retirées à PUBLIC par leur migration : accordées explicitement ici (les migrations
-- ne nomment jamais cashless_app, qui n'existe qu'après roles.sql sur une base neuve).
GRANT EXECUTE ON FUNCTION identify_person(text, text) TO cashless_app;
GRANT EXECUTE ON FUNCTION create_platform_admin(uuid, text, text, text, text, text, text, uuid) TO cashless_app;

-- ---------------------------------------------------------------------------------------------------------------
-- Portée plateforme (mission configuration-parties-evenements, research R-01, R-02, X-3 ; contrat platform-access).
-- ---------------------------------------------------------------------------------------------------------------

-- Rôle applicatif : aucune écriture de plateforme.
--   Profils de législation et devises : données de référence sans RLS, écrites par la plateforme seule (X-3).
REVOKE INSERT, UPDATE ON jurisdiction_profile, currency_exponent FROM cashless_app;
--   Fonctions internes des gardes de configuration (lisent une partie hors RLS) et test de session de la plateforme.
REVOKE EXECUTE ON FUNCTION party_kind_of(uuid), platform_session() FROM cashless_app, PUBLIC;
--   Fonctions d'API de la mission : open_* s'exécutent sous la RLS de l'appelant ; event_transition_conditions est
--   SECURITY DEFINER, retirée à PUBLIC par sa migration.
GRANT EXECUTE ON FUNCTION open_event_ledger(uuid), open_participation_account(uuid),
  event_transition_conditions(uuid, event_status) TO cashless_app;
--   Un prestataire lit son contrat avec la plateforme et ses redevances, sans jamais les écrire. Politiques
--   restrictives : elles s'ajoutent (ET) aux politiques tenant_* existantes, qui ne regardent que operator_id.
--   Une version PLATFORM rattachée à son propre prestataire passerait tenant_write et prendrait un numéro de
--   version du niveau plateforme (config_version_assign numérote par portée).
DROP POLICY IF EXISTS app_no_platform_config ON config_version;
CREATE POLICY app_no_platform_config ON config_version AS RESTRICTIVE FOR INSERT TO cashless_app
  WITH CHECK (scope_type <> 'PLATFORM');
DROP POLICY IF EXISTS app_no_platform_contract ON contract;
CREATE POLICY app_no_platform_contract ON contract AS RESTRICTIVE FOR INSERT TO cashless_app
  WITH CHECK (kind <> 'PLATFORM_OPERATOR');
DROP POLICY IF EXISTS app_no_platform_fee_rule_insert ON fee_rule;
CREATE POLICY app_no_platform_fee_rule_insert ON fee_rule AS RESTRICTIVE FOR INSERT TO cashless_app
  WITH CHECK (scope_type <> 'PLATFORM_CONTRACT');
DROP POLICY IF EXISTS app_no_platform_fee_rule_update ON fee_rule;
CREATE POLICY app_no_platform_fee_rule_update ON fee_rule AS RESTRICTIVE FOR UPDATE TO cashless_app
  USING (scope_type <> 'PLATFORM_CONTRACT') WITH CHECK (scope_type <> 'PLATFORM_CONTRACT');

-- Rôle de base de la plateforme (§2.2) : mêmes attributs et mêmes durées de transaction que cashless_app. Le mot de
-- passe se règle hors de ce fichier (CASHLESS_PLATFORM_PASSWORD, posé par migrate.ts en local et en CI).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cashless_platform') THEN
    CREATE ROLE cashless_platform LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END $$;
ALTER ROLE cashless_platform SET statement_timeout = '30s';
ALTER ROLE cashless_platform SET idle_in_transaction_session_timeout = '10s';
ALTER ROLE cashless_platform SET lock_timeout = '5s';
DO $$ BEGIN
  IF current_setting('server_version_num')::int >= 170000 THEN
    EXECUTE 'ALTER ROLE cashless_platform SET transaction_timeout = ''60s''';
  END IF;
END $$;

-- Droits : remis à zéro puis accordés un à un (idempotent ; un droit retiré de ce fichier disparaît au rejeu).
-- Aucun droit sur event, ledger, account, journal_transaction, posting, account_balance (NFR-002).
-- Limite connue : le schéma de référence laisse EXECUTE à PUBLIC sur ses fonctions d'API (la suite de référence le
-- vérifie : « fonctions de bascule exposées »), et un droit hérité de PUBLIC ne se retire pas à un seul rôle. Ces
-- fonctions restent donc appelables par ce rôle ; chacune commence par assert_tenant, et le pool de la plateforme
-- ne pose jamais app.operator_id (contrat platform-access, règle 2).
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM cashless_platform;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM cashless_platform;
REVOKE ALL ON ALL ROUTINES IN SCHEMA public FROM cashless_platform;
GRANT USAGE ON SCHEMA public TO cashless_platform;
GRANT SELECT ON party, jurisdiction_profile, contract, config_version, fee_rule, audit_log, approval_request,
  api_idempotency, app_user, role_assignment, currency_exponent TO cashless_platform;
GRANT INSERT ON party, jurisdiction_profile, contract, config_version, fee_rule, audit_log, approval_request,
  api_idempotency TO cashless_platform;
GRANT UPDATE (legal_name, country_code, tax_id) ON party TO cashless_platform;
GRANT UPDATE (valid_to) ON fee_rule TO cashless_platform;
GRANT UPDATE (status, executed_tx_id, failure_code, failure_reason, result) ON approval_request TO cashless_platform;
GRANT UPDATE ON api_idempotency TO cashless_platform;
-- Seule séquence utile : l'identifiant d'audit_log (les autres identifiants écrits par ce rôle sont des uuid).
GRANT USAGE, SELECT ON SEQUENCE audit_log_id_seq TO cashless_platform;
GRANT EXECUTE ON FUNCTION decide_approval_request(uuid, uuid, boolean, text), platform_session() TO cashless_platform;

-- Politiques nominatives du rôle de la plateforme. Pour chaque table, une politique permissive ouvre sa portée et
-- une politique restrictive la borne : les politiques tenant_* existantes valent pour tous les rôles, et sans la
-- borne le rôle de la plateforme atteindrait les lignes d'un prestataire en posant lui-même app.operator_id.
-- Une politique sans TO donnerait cet accès au rôle applicatif : toutes sont nominatives.
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT * FROM (VALUES
    -- table, lecture, écriture (NULL : lecture seule)
    ('party',            $q$kind IN ('PLATFORM','OPERATOR')$q$,                  $q$kind = 'OPERATOR' AND operator_id IS NULL$q$),
    ('contract',         $q$kind = 'PLATFORM_OPERATOR'$q$,                       $q$kind = 'PLATFORM_OPERATOR'$q$),
    ('config_version',   $q$scope_type = 'PLATFORM' AND operator_id IS NULL$q$,  $q$scope_type = 'PLATFORM' AND operator_id IS NULL$q$),
    ('fee_rule',         $q$scope_type = 'PLATFORM_CONTRACT'$q$,                 $q$scope_type = 'PLATFORM_CONTRACT'$q$),
    ('audit_log',        $q$operator_id IS NULL$q$,                              $q$operator_id IS NULL$q$),
    ('approval_request', $q$operator_id IS NULL$q$,                              $q$operator_id IS NULL$q$),
    ('api_idempotency',  $q$operator_id IS NULL$q$,                              $q$operator_id IS NULL$q$),
    -- personnes de la plateforme et leurs attributions : contrôle du valideur
    ('app_user',         $q$operator_id IS NULL$q$,                              NULL),
    ('role_assignment',  $q$operator_id IS NULL$q$,                              NULL)
  ) AS v(tbl, can_read, can_write)
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS platform_read ON %I', t.tbl);
    EXECUTE format('DROP POLICY IF EXISTS platform_read_bound ON %I', t.tbl);
    EXECUTE format('DROP POLICY IF EXISTS platform_insert ON %I', t.tbl);
    EXECUTE format('DROP POLICY IF EXISTS platform_insert_bound ON %I', t.tbl);
    EXECUTE format('DROP POLICY IF EXISTS platform_update ON %I', t.tbl);
    EXECUTE format('DROP POLICY IF EXISTS platform_update_bound ON %I', t.tbl);
    EXECUTE format('CREATE POLICY platform_read ON %I FOR SELECT TO cashless_platform USING (%s)', t.tbl, t.can_read);
    EXECUTE format('CREATE POLICY platform_read_bound ON %I AS RESTRICTIVE FOR SELECT TO cashless_platform USING (%s)',
                   t.tbl, t.can_read);
    IF t.can_write IS NOT NULL THEN
      EXECUTE format('CREATE POLICY platform_insert ON %I FOR INSERT TO cashless_platform WITH CHECK (%s)', t.tbl, t.can_write);
      EXECUTE format('CREATE POLICY platform_insert_bound ON %I AS RESTRICTIVE FOR INSERT TO cashless_platform WITH CHECK (%s)',
                     t.tbl, t.can_write);
      EXECUTE format('CREATE POLICY platform_update ON %I FOR UPDATE TO cashless_platform USING (%s) WITH CHECK (%s)',
                     t.tbl, t.can_write, t.can_write);
      EXECUTE format('CREATE POLICY platform_update_bound ON %I AS RESTRICTIVE FOR UPDATE TO cashless_platform USING (%s) WITH CHECK (%s)',
                     t.tbl, t.can_write, t.can_write);
    END IF;
  END LOOP;
END $$;
