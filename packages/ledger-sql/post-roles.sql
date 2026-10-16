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

-- ---------------------------------------------------------------------------------------------------------------
-- Bracelets NFC : rôles de base des processus des clés (mission bracelets-nfc, research R-01, R-02 ; data-model
-- « Rôles de base » ; décisions du porteur n° 1, 2 et 6 du 13/10/2026).
-- Deux barrières indépendantes protègent les mots de passe des bracelets : les droits sur le service de clés (un
-- processus par droit) et, ici, les droits en base. L'API publique ne lit plus ni `media.pwd_pack_enc` ni
-- `tag_data_key.encrypted_dek` ; seuls les processus des clés le peuvent.
-- ---------------------------------------------------------------------------------------------------------------

-- 1. Rôle applicatif (API publique) : retraits ------------------------------------------------------------------------
-- roles.sql vient de lui rendre SELECT, INSERT et UPDATE sur toutes les tables : on retire, puis on accorde par
-- colonne. La liste des colonnes lisibles de `media` est calculée (toutes sauf les secrètes), pour qu'une colonne
-- ajoutée plus tard ne soit ni oubliée ni exposée par erreur ; les colonnes modifiables sont nommées une à une.
REVOKE SELECT, INSERT, UPDATE ON media FROM cashless_app;
DO $$
DECLARE cols text;
BEGIN
  SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) INTO cols FROM pg_attribute
   WHERE attrelid = 'public.media'::regclass AND attnum > 0 AND NOT attisdropped
     AND attname NOT IN ('pwd_pack_enc', 'pwd_pack_dek_id');
  EXECUTE format('GRANT SELECT (%s) ON media TO cashless_app', cols);
END $$;
--   Statut (liste noire, perte : fonctions INVOKER de la migration 0013) et usage du code de rattachement (migration
--   0010). Le reste de `media` ne s'écrit que par les fonctions SECURITY DEFINER du schéma de référence et des
--   migrations. L'empreinte du code (claim_code_hash) ne s'écrit que par associate_claim_code (SECURITY DEFINER,
--   0019) : lot 20, cycle 7, renforcement (ADR-94).
GRANT UPDATE (status, claim_code_used_at, claim_attempts) ON media TO cashless_app;
--   Enregistrement d'un bracelet : processus de personnalisation seul (migration 0019). roles.sql vient de rendre
--   EXECUTE sur toutes les fonctions à ce rôle : retrait explicite.
REVOKE EXECUTE ON FUNCTION register_personalized_media(uuid, uuid, bytea, bytea, bytea, boolean, bytea, uuid, uuid)
  FROM cashless_app;
--   Association d'un code : appelée par l'import du fichier de l'imprimeur (claim-codes.service.ts). Retirée à
--   PUBLIC par 0019, accordée ici nommément (et non par le seul GRANT global de roles.sql).
GRANT EXECUTE ON FUNCTION associate_claim_code(bytea, uuid) TO cashless_app;
--   Clés : lecture sans la clé de données chiffrée ; aucune écriture (la commande d'administration et la
--   personnalisation les créent).
REVOKE SELECT, INSERT, UPDATE ON tag_data_key FROM cashless_app;
GRANT SELECT (id, operator_id, key_index, version, wrapping_kms_key_ref, status, created_at) ON tag_data_key TO cashless_app;
REVOKE INSERT, UPDATE ON tag_key FROM cashless_app;
--   Contenu d'un snapshot hors ligne : il porte le mot de passe chiffré de chaque bracelet.
REVOKE ALL ON offline_snapshot_rows FROM cashless_app;
--   Travaux de clé : l'API en inscrit et relance un travail en échec ; elle n'en modifie rien d'autre.
REVOKE UPDATE ON tag_key_job FROM cashless_app;
GRANT UPDATE (status, locked_until) ON tag_key_job TO cashless_app;
--   Comptes rendus du contrôle quotidien et essais de code : jamais modifiés par l'API.
REVOKE INSERT, UPDATE ON tag_key_check_run FROM cashless_app;
REVOKE UPDATE ON claim_attempt FROM cashless_app;
--   Consultation anonyme du solde : fonction SECURITY DEFINER retirée à PUBLIC par sa migration (décision n° 8).
GRANT EXECUTE ON FUNCTION public_balance_lookup(bytea, text) TO cashless_app;
--   Historiques des bracelets et des lots : écrits par leurs seuls déclencheurs (lot 20, cycles 4 et 5 ; relectures
--   du 15/10/2026, ADR-94). log_media_status et log_batch_status sont SECURITY DEFINER depuis la migration 0018 :
--   l'API n'y a ni INSERT, ni UPDATE, ni DELETE. media_reinstatement_approved (0017) prend pour épisode en cours le
--   max(id) des mises en liste noire : avec UPDATE, une session de l'API masquait cet épisode ; avec INSERT, elle
--   plantait une fausse ligne d'identifiant très grand qui figeait « l'épisode en cours ». Dans les deux cas, la demande
--   REINSTATE_MEDIA approuvée d'un épisode passé redevenait réutilisable. media_identity_history (écrite par
--   reassign_pool_media seule) porte les identités retirées que la restitution refuse de réutiliser. DELETE et
--   TRUNCATE sont déjà retirés par roles.sql pour toutes les tables : redits ici pour que ce retrait ne dépende pas
--   de l'ordre des fichiers.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON media_status_history, media_batch_status_history, media_identity_history
  FROM cashless_app;
--   Rattachements bracelet -> portefeuille : écrits par log_media_status (0018) et par des fonctions SECURITY DEFINER
--   seulement. Le nombre de lignes d'un bracelet forme les clés d'idempotence du préchargement et des cautions
--   (preload:<bracelet>:<n>, deposit:…:<n>) et la ligne ouverte désigne le portefeuille débité (media_wallet) : une
--   ligne plantée par l'API rejouait le préchargement ou détournait un bracelet vers un autre portefeuille.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON media_assignment FROM cashless_app;
--   Configurations servies aux terminaux : écrites par record_config_served (SECURITY DEFINER) seule. Sa dernière
--   ligne est relue comme configuration en cours, et policy_in_force y lit les plafonds hors ligne en vigueur.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON device_config_served FROM cashless_app;
--   Passages autorisés (bracelets, lots, événements, remise d'autorité) : règles du schéma, lues seulement. Avec
--   INSERT, une session de l'API ajoutait BLACKLISTED -> ISSUED puis passait ISSUED -> ACTIVE : sortie de liste noire
--   sans demande approuvée, pour tous les prestataires (tables sans RLS).
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON media_transition, media_batch_transition, event_status_transition,
  handover_transition FROM cashless_app;
--   Codes de rattachement et demandes de rattachement : écrits par les fonctions de la migration 0010 (droits de
--   l'appelant). L'API ne modifie que les colonnes que ces fonctions changent ; l'empreinte du code, le prestataire,
--   le lot, le client et l'empreinte de confirmation ne se réécrivent pas. L'association (media_id, associated_at)
--   ne passe que par associate_claim_code (SECURITY DEFINER, 0019) : en direct, l'API n'écrit que l'invalidation des
--   codes jamais associés (lot 20, cycle 7, renforcement).
REVOKE UPDATE ON claim_code FROM cashless_app;
GRANT UPDATE (invalidated_at) ON claim_code TO cashless_app;
REVOKE UPDATE ON media_claim FROM cashless_app;
GRANT UPDATE (status, attempts, confirmed_at, confirmed_by, confirmed_device_id, confirmed_tap_id) ON media_claim
  TO cashless_app;

-- 2. Rôles des processus des clés ---------------------------------------------------------------------------------------
-- Mots de passe hors de ce fichier (CASHLESS_TAGKEYS_PASSWORD, CASHLESS_PERSO_PASSWORD, CASHLESS_TAGCHECK_PASSWORD,
-- CASHLESS_KEYADMIN_PASSWORD, posés par migrate.ts en local et en CI).
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['cashless_tagkeys','cashless_perso','cashless_tagcheck','cashless_keyadmin'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT', r);
    END IF;
    EXECUTE format('ALTER ROLE %I SET statement_timeout = ''30s''', r);
    EXECUTE format('ALTER ROLE %I SET idle_in_transaction_session_timeout = ''10s''', r);
    EXECUTE format('ALTER ROLE %I SET lock_timeout = ''5s''', r);
    IF current_setting('server_version_num')::int >= 170000 THEN
      EXECUTE format('ALTER ROLE %I SET transaction_timeout = ''60s''', r);
    END IF;
    -- Droits remis à zéro puis accordés un à un ci-dessous (un droit retiré de ce fichier disparaît au rejeu).
    EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', r);
    EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', r);
    EXECUTE format('REVOKE ALL ON ALL ROUTINES IN SCHEMA public FROM %I', r);
    EXECUTE format('GRANT USAGE ON SCHEMA public TO %I', r);
  END LOOP;
END $$;
-- Aucun de ces rôles n'a de droit sur journal_transaction, posting, account_balance, account, wallet ni ledger.
-- Limite connue (ADR-80) : EXECUTE sur les fonctions d'API du schéma de référence est hérité de PUBLIC et ne se retire
-- pas à un seul rôle ; chacune commence par assert_tenant et écrit par ses propres droits de propriétaire. Ces rôles
-- peuvent donc les appeler pour un prestataire dont ils posent l'identifiant : c'est vrai aussi de cashless_app.

--   2a. Clés de bracelet : sert POST /media/auth-keys et rechiffre après une rotation. Lit le chiffré ; n'écrit que
--       le chiffré et le statut d'une clé de données.
GRANT SELECT (id, operator_id, kind, nfc_uid, key_index, batch_id, status, personalized_at, pwd_pack_enc, pwd_pack_dek_id)
  ON media TO cashless_tagkeys;
GRANT UPDATE (pwd_pack_enc, pwd_pack_dek_id) ON media TO cashless_tagkeys;
GRANT SELECT ON tag_key, tag_data_key, tag_key_job TO cashless_tagkeys;
GRANT UPDATE (status) ON tag_data_key TO cashless_tagkeys;
GRANT UPDATE (status, attempts, last_error, progress, started_at, locked_until, finished_at) ON tag_key_job TO cashless_tagkeys;
GRANT SELECT (id, operator_id, event_id, pos_id, status, agreement_public_key) ON device TO cashless_tagkeys;
GRANT SELECT, INSERT ON audit_log TO cashless_tagkeys;
GRANT USAGE, SELECT ON SEQUENCE audit_log_id_seq TO cashless_tagkeys;

--   2b. Personnalisation : enregistre les bracelets, associe leur code, ouvre les clés de données (session,
--       rotation), retire une clé dédiée. Ne lit jamais un mot de passe chiffré existant.
GRANT SELECT (id, operator_id, kind, nfc_uid, key_index, batch_id, status, personalized_at, claim_code_hash) ON media TO cashless_perso;
--       Aucune écriture directe sur `media` ni sur l'association des codes (lot 20, cycle 7 ; relecture du cycle 6,
--       constat 1 ; décision du porteur, option B ; ADR-94). Un bracelet ne naît que par register_personalized_media
--       et un code ne s'associe que par associate_claim_code, toutes deux SECURITY DEFINER depuis la migration 0019 :
--       elles vérifient elles-mêmes, pour le prestataire de la session, le lot (statut en préparation, quantité), la
--       clé du lot, la clé de données (même index, ACTIVE), et pour un code : lot, invalidation, association unique.
--       Avec INSERT sur `media` (même borné par colonne et par politique, cycle 6), ce rôle plantait un bracelet
--       dans un lot actif ou plein, dans le lot ou avec la clé de données d'un autre prestataire ; avec UPDATE
--       (claim_code_hash) et UPDATE (media_id, associated_at) sur claim_code, il associait un code invalidé, déjà
--       associé ou d'un autre lot.
GRANT EXECUTE ON FUNCTION register_personalized_media(uuid, uuid, bytea, bytea, bytea, boolean, bytea, uuid, uuid),
  associate_claim_code(bytea, uuid) TO cashless_perso;
GRANT SELECT ON media_batch, media_transition, tag_key, claim_code, tag_key_job, app_user, role_assignment,
  api_idempotency, event TO cashless_perso;
--       Clé de données : elle en crée (GenerateDataKey) mais ne relit jamais une clé chiffrée existante.
GRANT SELECT (id, operator_id, key_index, version, wrapping_kms_key_ref, status, created_at) ON tag_data_key TO cashless_perso;
--       L'historique de statut des bracelets enregistrés s'écrit par log_media_status (SECURITY DEFINER, 0018).
GRANT INSERT ON tag_data_key, tag_key_job, audit_log, api_idempotency TO cashless_perso;
GRANT UPDATE (status) ON tag_data_key TO cashless_perso;
GRANT UPDATE (status, attempts, last_error, progress, started_at, locked_until, finished_at) ON tag_key_job TO cashless_perso;
GRANT UPDATE ON api_idempotency TO cashless_perso;
GRANT USAGE, SELECT ON SEQUENCE audit_log_id_seq TO cashless_perso;
GRANT EXECUTE ON FUNCTION identify_person(text, text) TO cashless_perso;

--   2c. Contrôle quotidien : lit le chiffré pour le comparer à un recalcul ; n'écrit que son compte rendu et l'audit.
GRANT SELECT (id, operator_id, kind, nfc_uid, key_index, status, personalized_at, pwd_pack_enc, pwd_pack_dek_id)
  ON media TO cashless_tagcheck;
GRANT SELECT ON tag_key, tag_data_key, tag_key_check_run TO cashless_tagcheck;
GRANT INSERT ON tag_key_check_run TO cashless_tagcheck;
GRANT SELECT, INSERT ON audit_log TO cashless_tagcheck;
GRANT USAGE, SELECT ON SEQUENCE audit_log_id_seq TO cashless_tagcheck;

--   2d. Commande d'administration des clés : crée une clé et note sa désactivation. Aucun accès aux bracelets.
GRANT SELECT ON tag_key, tag_key_job TO cashless_keyadmin;
GRANT INSERT ON tag_key TO cashless_keyadmin;
GRANT UPDATE (status, kms_disabled_at) ON tag_key TO cashless_keyadmin;
GRANT UPDATE (status, attempts, last_error, progress, started_at, locked_until, finished_at) ON tag_key_job TO cashless_keyadmin;
GRANT SELECT, INSERT ON audit_log TO cashless_keyadmin;
GRANT USAGE, SELECT ON SEQUENCE audit_log_id_seq TO cashless_keyadmin;

-- 3. Politiques nominatives ------------------------------------------------------------------------------------------------
-- Les politiques tenant_* du schéma valent pour tous les rôles : un processus des clés traite les lignes du
-- prestataire dont il a posé l'identifiant (celui du terminal, de la personne, ou du travail en cours). Deux
-- exceptions exigent une lecture sans prestataire de session : la file des travaux et la liste des prestataires à
-- contrôler. Pour la file, chaque rôle ne voit et ne modifie QUE les sortes de travaux qui lui reviennent : la
-- politique restrictive le borne même quand un prestataire de session est posé.
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT * FROM (VALUES
    ('cashless_tagkeys',  $q$kind = 'REENCRYPT'$q$,                        NULL),
    ('cashless_perso',    $q$kind IN ('ROTATE_DEK','RETIRE_KEY')$q$,        $q$kind IN ('REENCRYPT','DISABLE_KMS_KEY')$q$),
    ('cashless_keyadmin', $q$kind IN ('CREATE_KEY','DISABLE_KMS_KEY')$q$,   NULL)
  ) AS v(role_name, can_work, can_create)
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON tag_key_job', t.role_name || '_jobs');
    EXECUTE format('DROP POLICY IF EXISTS %I ON tag_key_job', t.role_name || '_jobs_bound');
    EXECUTE format('DROP POLICY IF EXISTS %I ON tag_key_job', t.role_name || '_jobs_update');
    EXECUTE format('DROP POLICY IF EXISTS %I ON tag_key_job', t.role_name || '_jobs_update_bound');
    EXECUTE format('DROP POLICY IF EXISTS %I ON tag_key_job', t.role_name || '_jobs_insert_bound');
    EXECUTE format('CREATE POLICY %I ON tag_key_job FOR SELECT TO %I USING (%s)', t.role_name || '_jobs', t.role_name, t.can_work);
    EXECUTE format('CREATE POLICY %I ON tag_key_job AS RESTRICTIVE FOR SELECT TO %I USING (%s)', t.role_name || '_jobs_bound', t.role_name, t.can_work);
    EXECUTE format('CREATE POLICY %I ON tag_key_job FOR UPDATE TO %I USING (%s) WITH CHECK (%s)',
                   t.role_name || '_jobs_update', t.role_name, t.can_work, t.can_work);
    EXECUTE format('CREATE POLICY %I ON tag_key_job AS RESTRICTIVE FOR UPDATE TO %I USING (%s) WITH CHECK (%s)',
                   t.role_name || '_jobs_update_bound', t.role_name, t.can_work, t.can_work);
    IF t.can_create IS NOT NULL THEN
      EXECUTE format('CREATE POLICY %I ON tag_key_job AS RESTRICTIVE FOR INSERT TO %I WITH CHECK (%s)',
                     t.role_name || '_jobs_insert_bound', t.role_name, t.can_create);
    END IF;
  END LOOP;
END $$;
-- Politique perso_media_insert (cycle 6) retirée au cycle 7 : la personnalisation n'a plus aucun droit d'insertion
-- dans `media` (register_personalized_media, SECURITY DEFINER, migration 0019). Elle ne bornait d'ailleurs ni le lot
-- ni la clé de données (relecture du cycle 6, constat 1). Le DROP reste pour les bases qui l'ont encore.
DROP POLICY IF EXISTS perso_media_insert ON media;
-- Le contrôle quotidien parcourt tous les prestataires qui ont une clé.
DROP POLICY IF EXISTS cashless_tagcheck_keys ON tag_key;
CREATE POLICY cashless_tagcheck_keys ON tag_key FOR SELECT TO cashless_tagcheck USING (true);
-- Note d'exploitation : un processus qui lit sans prestataire de session (file des travaux, liste des prestataires à
-- contrôler) pose app.operator_id à l'identifiant nul ('00000000-0000-0000-0000-000000000000'). Une valeur vide,
-- laissée par une transaction précédente sur la même connexion, ferait échouer la conversion en uuid des politiques
-- tenant_* du schéma.
