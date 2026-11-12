-- Droits du rôle applicatif posés APRÈS roles.sql (mission identite-roles-double-validation, plan « Complexity
-- Tracking »). roles.sql, fichier du kit, rend INSERT, UPDATE et EXECUTE sur tout à chaque rejeu : ce fichier
-- retire ensuite ce qui ne doit pas l'être et accorde les colonnes nouvelles. Idempotent ; exécuté par le
-- propriétaire des tables, rejoué par migrate.ts juste après roles.sql.

-- 0. EXECUTE et TEMPORARY remis à zéro (OP-N44, ADR-101 ; OP-N59, ADR-96 ; mission 5a, WP07) ---
-- Le schéma de référence et les migrations laissent EXECUTE à PUBLIC sur la plupart des fonctions,
-- et roles.sql accorde EXECUTE sur toutes à cashless_app : un droit hérité de PUBLIC ne se retire
-- pas à un seul rôle. On retire tout ici, avant tout GRANT de ce fichier ; chaque rôle reçoit
-- ensuite sa liste nommée (sections 4 et 5). Les fonctions de déclencheur n'ont pas besoin
-- d'EXECUTE pour se déclencher (vérifié à CREATE TRIGGER seulement), et aucune politique, aucun
-- défaut de colonne, aucune contrainte ni aucune vue n'appelle une fonction de public. Extensions :
-- pgcrypto n'est appelée ni par le schéma ni par l'API (ses fonctions perdent aussi PUBLIC) ; pgtap
-- n'existe que dans la transaction d'une suite de test, créée par le propriétaire.
-- Fonctions futures (OP-N68, levée par la mission hors-ligne-snapshots-lots, WP08 ; supersede la décision du
-- porteur du 20/10/2026, option c) : la section 8 pose `ALTER DEFAULT PRIVILEGES FOR ROLE <propriétaire>
-- REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC`, FORME GLOBALE (sans IN SCHEMA). La forme « IN SCHEMA public »
-- seule serait sans effet : un droit par défaut retiré « pour un schéma » ne retire rien à ce que PostgreSQL
-- accorde globalement à PUBLIC. Une fonction créée ensuite par le propriétaire (celui qui exécute migrate.ts)
-- n'est donc exécutable de personne d'autre tant qu'un GRANT nominatif ne la nomme pas, même créée à la main
-- hors de migrate.ts. Conséquence pour les suites pgTAP (pgtap, fonctions pg_temp) : tests/_grants_for_tests.sql.
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL ROUTINES IN SCHEMA public FROM cashless_app;
-- Tables temporaires (OP-N59, seconde barrière ; la première est le search_path des fonctions
-- SECURITY DEFINER, migration 0021) : aucun rôle n'en crée hors du propriétaire. Les rôles
-- cashless_* n'ont pas de TEMPORARY propre (retiré à chacun en section 5, après leur création).
DO $$ BEGIN
  EXECUTE format('REVOKE TEMPORARY ON DATABASE %I FROM PUBLIC', current_database());
END $$;

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

-- Fonctions d'API de cashless_app (dont identify_person, create_platform_admin) : liste nommée en
-- section 4.

-- ---------------------------------------------------------------------------------------------------------------
-- Portée plateforme (mission configuration-parties-evenements, research R-01, R-02, X-3 ; contrat platform-access).
-- ---------------------------------------------------------------------------------------------------------------

-- Rôle applicatif : aucune écriture de plateforme.
--   Profils de législation et devises : données de référence sans RLS, écrites par la plateforme seule (X-3).
REVOKE INSERT, UPDATE ON jurisdiction_profile, currency_exponent FROM cashless_app;
--   Fonctions internes des gardes de configuration (lisent une partie hors RLS) et test de session de la plateforme.
REVOKE EXECUTE ON FUNCTION party_kind_of(uuid), platform_session() FROM cashless_app, PUBLIC;
--   Fonctions d'API de la mission (open_* sous la RLS de l'appelant, event_transition_conditions
--   SECURITY DEFINER) : section 4.
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
-- EXECUTE : PUBLIC n'exécute plus aucune fonction de public (section 0, OP-N44 levée par la mission
-- 5a) ; ce rôle n'exécute que les deux fonctions nommées ci-dessous.
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
--   Enregistrement d'un bracelet : processus de personnalisation seul (migration 0019) ; jamais
--   accordé à ce rôle (section 4), retrait redit pour qu'il ne dépende pas de l'ordre du fichier.
REVOKE EXECUTE ON FUNCTION register_personalized_media(uuid, uuid, bytea, bytea, bytea, boolean, bytea, uuid, uuid)
  FROM cashless_app;
--   Association d'un code : appelée par l'import du fichier de l'imprimeur (claim-codes.service.ts)
--   ; section 4.
--   Clés : lecture sans la clé de données chiffrée ; aucune écriture (la commande d'administration et la
--   personnalisation les créent).
REVOKE SELECT, INSERT, UPDATE ON tag_data_key FROM cashless_app;
GRANT SELECT (id, operator_id, key_index, version, wrapping_kms_key_ref, status, created_at) ON tag_data_key TO cashless_app;
REVOKE INSERT, UPDATE ON tag_key FROM cashless_app;
--   Contenu d'un snapshot hors ligne : il porte le mot de passe chiffré de chaque bracelet.
REVOKE ALL ON offline_snapshot_rows FROM cashless_app;
--   Travaux de clé : l'API relance un travail en échec ; elle n'en modifie rien d'autre. Elle
--   n'en inscrit que par enqueue_tag_key_job (SECURITY DEFINER, migration 0020), pendant
--   l'exécution d'une demande approuvée à deux : avec INSERT, une session de l'API inscrivait
--   sans approbation une désactivation dans le service de clés, un retrait ou une création de
--   clé, que les processus des clés exécutaient (revue post-fusion, SEC-1 ; ADR-102).
REVOKE INSERT, UPDATE ON tag_key_job FROM cashless_app;
GRANT UPDATE (status, locked_until) ON tag_key_job TO cashless_app;
--   enqueue_tag_key_job : section 4. Fonctions des processus des clés : jamais accordées à ce
--   rôle (retrait redit). retire_dedicated_key retire une clé dédiée sans travail ni approbation
--   (EXECUTE retiré à PUBLIC par 0020) ; retire_dedicated_key_for_job (0025) est réservée à la
--   personnalisation.
REVOKE EXECUTE ON FUNCTION enqueue_tag_key_child_job(uuid, uuid), tag_key_job_refusal(uuid),
  retire_dedicated_key(uuid, integer), retire_dedicated_key_for_job(uuid) FROM cashless_app;
--   Comptes rendus du contrôle quotidien et essais de code : jamais modifiés par l'API.
REVOKE INSERT, UPDATE ON tag_key_check_run FROM cashless_app;
REVOKE UPDATE ON claim_attempt FROM cashless_app;
--   Consultation anonyme du solde (public_balance_lookup, décision n° 8) : section 4.
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
--   La lecture liée à une demande (confirmed_tap_id) ne s'écrit que par consume_tap_for_claim
--   (SECURITY DEFINER depuis 0026 : verrou media-tap-use:, fenêtre de renvoi, lecture encore
--   libre). Avec UPDATE (confirmed_tap_id), une session de l'API liait à une demande une lecture
--   déjà consommée par une écriture (relecture de WP05, défaut antérieur de 0016 ; renforcement,
--   mission 5a, lot WP07).
REVOKE UPDATE ON media_claim FROM cashless_app;
GRANT UPDATE (status, attempts, confirmed_at, confirmed_by, confirmed_device_id) ON media_claim
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
-- EXECUTE : plus rien n'est hérité de PUBLIC (section 0 ; ADR-80 et OP-N44 levées par la mission
-- 5a, lot WP07) ; chaque rôle n'exécute que les fonctions nommées ci-dessous et en section 5
-- (tests_execute_grants.sql).

--   2a. Clés de bracelet : sert POST /media/auth-keys et rechiffre après une rotation. Lit le chiffré ; n'écrit que
--       le chiffré et le statut d'une clé de données.
GRANT SELECT (id, operator_id, kind, nfc_uid, key_index, batch_id, status, personalized_at, pwd_pack_enc, pwd_pack_dek_id)
  ON media TO cashless_tagkeys;
GRANT UPDATE (pwd_pack_enc, pwd_pack_dek_id) ON media TO cashless_tagkeys;
GRANT SELECT ON tag_key, tag_data_key, tag_key_job TO cashless_tagkeys;
GRANT UPDATE (status) ON tag_data_key TO cashless_tagkeys;
GRANT UPDATE (status, attempts, last_error, progress, started_at, locked_until, finished_at) ON tag_key_job TO cashless_tagkeys;
--       Terminal relu par la garde des requêtes de terminal (contracts/device-authentication.md,
--       étapes 3, 4, 6 et 9 ; mission 5a) : clés publiques et empreinte du certificat, lues jamais
--       écrites ; os et nfc_enabled pour req.device (un terminal iOS n'a jamais nfc_enabled).
GRANT SELECT (id, operator_id, event_id, pos_id, status, agreement_public_key, public_key,
              cert_sha256, os, nfc_enabled) ON device TO cashless_tagkeys;
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
--       Travaux suivants (rechiffrement, désactivation) : par enqueue_tag_key_child_job
--       seulement (0020, SEC-1).
GRANT INSERT ON tag_data_key, audit_log, api_idempotency TO cashless_perso;
GRANT EXECUTE ON FUNCTION enqueue_tag_key_child_job(uuid, uuid) TO cashless_perso;
--       Retrait d'une clé dédiée par son travail RETIRE_KEY en cours, issu d'une demande exécutée
--       (0025, OP-N62). Le retrait direct (retire_dedicated_key, sans travail ni approbation) ne
--       lui est plus accordé (OP-N44 et OP-N62 levées, lot WP07) : il n'est exécuté que par
--       retire_dedicated_key_for_job, sous les droits du propriétaire.
GRANT EXECUTE ON FUNCTION retire_dedicated_key_for_job(uuid) TO cashless_perso;
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

--   2e. Les trois exécutants de la file revérifient la demande d'approbation de chaque travail
--       (0020, SEC-1).
GRANT EXECUTE ON FUNCTION tag_key_job_refusal(uuid)
  TO cashless_tagkeys, cashless_perso, cashless_keyadmin;

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
    -- Aucune insertion directe (0020) : la politique d'insertion de la personnalisation
    -- disparaît au rejeu.
    ('cashless_perso',    $q$kind IN ('ROTATE_DEK','RETIRE_KEY')$q$,        NULL),
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

-- -----------------------------------------------------------------------------------------------
-- 4. API publique (cashless_app) : fonctions et terminaux (mission 5a,
-- identite-enrolement-terminaux, lot WP07 ; OP-N44, ADR-101 ; OP-N63, ADR-105 ; research R-11 ;
-- contracts/database-debts.md).
-- -----------------------------------------------------------------------------------------------

-- 4a. EXECUTE, fonction par fonction. Liste dérivée des appels réels de apps/api/src (fichiers du
-- processus de l'API publique, hors *.spec.ts : `<fonction>(` dans le texte des requêtes), plus les
-- fonctions qu'appellent les fonctions SECURITY INVOKER de la liste et les déclencheurs SECURITY
-- INVOKER des tables que l'API écrit (les uns et les autres s'exécutent sous ce rôle). Une fonction
-- SECURITY DEFINER appelle les siennes sous les droits du propriétaire. Recensement consigné dans
-- le compte rendu du lot WP07 ; tests_execute_grants.sql compare cette liste à une liste figée. Une
-- fonction du schéma de référence que l'API n'appelle pas encore (synchronisation hors ligne,
-- passerelle, scellements) n'est pas accordée : la mission qui l'appelle l'ajoute ici.
GRANT EXECUTE ON FUNCTION
  -- Personnes, approbations, configuration et événements
  identify_person(text, text),
  create_platform_admin(uuid, text, text, text, text, text, text, uuid),
  decide_approval_request(uuid, uuid, boolean, text),
  open_event_ledger(uuid), open_participation_account(uuid),
  event_transition_conditions(uuid, event_status), set_event_status(uuid, event_status, uuid),
  -- Grand livre (ledger-queries.ts)
  post_transaction(uuid, text, text, timestamptz, text, jsonb, uuid, uuid, uuid, uuid, uuid, uuid,
                   uuid, jsonb),
  preload_media(uuid), forfeit_deposit(uuid), wallet_topup_headroom(uuid, timestamptz),
  -- Bracelets : lots, codes de rattachement, cycle de vie, liste noire, lectures
  preload_batch(uuid, integer), close_batch(uuid), forfeit_batch_deposits(uuid, integer),
  set_media_batch_status(uuid, text, text, uuid), invalidate_unassociated_codes(uuid),
  issue_claim_codes(uuid, bytea[]), associate_claim_code(bytea, uuid),
  activate_media(uuid, uuid, text, uuid), open_event_wallet(uuid, uuid), release_media(uuid, text),
  reassign_pool_media(uuid, bytea), replace_media(uuid, uuid), recover_media(uuid),
  suspend_media(uuid, text, uuid), blacklist_media(uuid, text, uuid),
  reinstate_media(uuid, uuid, uuid, text),
  media_event(uuid), media_set_actor(uuid, text), media_summary(uuid), media_status_log(uuid),
  wallet_spendable(uuid),
  register_tap(uuid, bytea, bytea, bigint, timestamptz, uuid, text, uuid, bigint, bytea),
  consume_tap(bigint, uuid),
  -- Rattachement par le festivalier
  claim_media(bytea, uuid, text, uuid, bytea), confirm_media_claim(uuid, uuid, bytea, uuid, uuid),
  mark_claim_code_used(uuid), consume_tap_for_claim(bigint, uuid),
  public_balance_lookup(bytea, text),
  -- Travaux de clé : inscription d'un travail approuvé, relance d'un travail en échec
  enqueue_tag_key_job(uuid), retry_tag_key_job(uuid),
  -- Appelées par les fonctions SECURITY INVOKER ci-dessus (suspend_media, blacklist_media,
  -- set_media_batch_status -> media_set_status -> media_session_operator ; claim_media ->
  -- claim_attempts_exceeded, expire_media_claims ; mark_claim_code_used, claim_media,
  -- confirm_media_claim -> claim_session_operator)
  media_set_status(uuid, text, text, uuid), media_session_operator(),
  claim_attempts_exceeded(uuid, uuid, text), expire_media_claims(uuid), claim_session_operator(),
  -- Appelées par le déclencheur SECURITY INVOKER check_media_transition (statut d'un bracelet écrit
  -- par l'API) : une fonction de déclencheur s'exécute sous le rôle qui écrit, ses appels exigent
  -- EXECUTE
  media_owner_session(), media_reinstatement_approved(uuid, uuid, uuid),
  -- Terminaux (migrations 0022, 0023 ; routes des lots WP12 à WP16). Pas device_admin_allowed
  -- (fonction interne de set_device_status et create_device_enrollment_code).
  -- revoke_device_token_family : révocation d'une famille par la réutilisation (WP15) et le
  -- back-office (WP16), deux routes de l'API publique ; aucun processus des clés n'en a l'usage.
  -- Purges purge_device_request_nonces et purge_device_enrollment_attempts (maintenance globale,
  -- SECURITY DEFINER, lignes expirées seulement, heure de la base) : planifiées par le travailleur
  -- device-purge du registre de l'API publique (lot WP12, device-identity/device-maintenance.ts),
  -- le seul processus qui les charge ; aucun autre rôle ne les exécute.
  create_device_enrollment_code(bytea, uuid, uuid, text, boolean, integer, uuid),
  check_device_enrollment_code(bytea, text),
  enroll_device(bytea, text, text, text, bytea, bytea, bytea, timestamptz, text, text, bytea,
                timestamptz, uuid),
  set_device_status(uuid, text, text, uuid), record_device_heartbeat(uuid, text, timestamptz),
  record_enrollment_attempt(bytea, inet, text), enrollment_attempts_exceeded(bytea, inet),
  -- Refus d'enrôlement : essai et audit ensemble, chaîne du code ou de la plateforme (0027, ADR-117)
  record_enrollment_refusal(bytea, inet, text, text, text, text, text, uuid),
  rotate_device_refresh_token(bytea, bytea, bytea, timestamptz),
  revoke_device_token_family(uuid, uuid, text),
  device_token_family_active(uuid, uuid), consume_device_nonce(uuid, bytea, timestamptz, integer),
  assert_device_active(uuid),
  -- Les deux purges (purge_device_request_nonces, purge_device_enrollment_attempts) ne sont plus
  -- accordées à ce rôle (OP-N75 levée, WP08) : cashless_maint, section 8.
  -- Configuration servie (lot WP17, S10) : enregistre la configuration servie et rend config_id ;
  -- assert_tenant sur le prestataire du terminal. La route relit d'abord le statut du terminal
  -- (verrou, révoqué refusé) dans la même transaction. Migration 0029 (ADR-118) : la fonction
  -- refuse elle-même un terminal révoqué et une config_version d'un autre prestataire.
  record_config_served(uuid, uuid),
  -- Encaissement en ligne (mission 5b, terminaux-paiement-en-ligne, lot WP07 ;
  -- contracts/database-rights.md). Toutes SECURITY DEFINER, search_path = public, pg_temp,
  -- REVOKE ALL … FROM PUBLIC dans leur migration : aucune n'exige l'EXECUTE d'une autre fonction
  -- sous ce rôle. Fonctions internes jamais accordées (appelées seulement par les fonctions
  -- SECURITY DEFINER ci-dessous) : vendor_admin_allowed (0031), catalog_admin_allowed,
  -- catalog_lock_pos, catalog_bump_version, catalog_label (0032) ; tests_execute_grants.sql §2.
  --   Vendeurs (0031). OP-N76, ADR-121 (limite acceptée, dette nommée) : begin_vendor_pin_check
  --   et open_vendor_session ne sont exécutées que par ce rôle (borne de tests_payment_rights.sql).
  create_vendor(uuid, text, text, uuid), set_vendor_pin(uuid, text, uuid),
  set_vendor_status(uuid, text, uuid), begin_vendor_pin_check(uuid, uuid),
  open_vendor_session(uuid, uuid), close_vendor_session(uuid), assert_vendor_session(uuid, uuid),
  --   Catalogue (0032) : écritures (chacune crée la version suivante), version servie, contrôle
  --   des lignes d'une vente (check_sale_lines, STABLE : arbitrage du 22/10/2026) et écriture des
  --   lignes. Aucune lecture de version par fonction (l'API lit les tables, sous la RLS).
  create_catalog_category(uuid, text, text, integer, uuid),
  update_catalog_category(uuid, text, text, integer, boolean, uuid),
  create_catalog_item(uuid, text, text, bigint, integer, uuid),
  update_catalog_item(uuid, uuid, text, text, bigint, integer, boolean, uuid),
  set_catalog_policy(uuid, boolean, uuid), record_device_catalog_served(uuid),
  check_sale_lines(uuid, jsonb, bigint), record_sale_lines(uuid, uuid, jsonb),
  --   Paiement et annulation (0033 ; consume_tap(bigint, uuid) plus haut, signature inchangée).
  --   record_device_seq : schéma de référence, accordée pour la première fois (numérotation des
  --   écritures d'un terminal en ligne).
  record_device_seq(uuid, bigint, bytea, text, text, uuid, text, uuid),
  assert_tap_payable(bigint, uuid), assert_wallet_payable(uuid),
  record_sale_attribution(uuid, uuid, text, uuid),
  assert_reversible(uuid, text, uuid, uuid, text, uuid),
  --   Demandes de paiement QR (0034). payment_request_for_token prend l'identifiant ET
  --   l'empreinte du jeton (relecture WP05, cycle 1 : plus strict que l'arbitrage du 22/10).
  create_merchant_payment_request(uuid, uuid, bigint, character, integer, bytea, text, jsonb,
                                  integer),
  create_customer_qr_token(uuid, uuid, bytea), lock_payment_request_for_pay(uuid, bytea, uuid, uuid),
  lock_customer_qr_token(bytea, uuid), confirm_payment_request(uuid, uuid, bytea),
  cancel_payment_request(uuid, uuid, bytea), payment_request_for_token(uuid, bytea)
  --   Terminaux : set_device_status, create_device_enrollment_code, enroll_device et
  --   purge_device_enrollment_attempts sont remplacées par 0031 et 0035 à signature égale (déjà
  --   accordées plus haut ; aucune ancienne signature ne subsiste).
TO cashless_app;

-- 4b. Terminaux (OP-N63, ADR-105) : identité, clés, certificat, statut et prestataire ne s'écrivent
-- que par les fonctions SECURITY DEFINER de 0022 et 0023 (enroll_device, set_device_status,
-- rotate_device_refresh_token…). roles.sql vient de rendre INSERT et UPDATE sur toutes les tables :
-- sans ce retrait, une session de l'API repassait ACTIVE un terminal REVOKED, remplaçait sa clé
-- publique ou son certificat, ou remettait à neuf un code d'enrôlement ou un jeton de
-- rafraîchissement. La lecture reste permise (sous la RLS) : la garde lit public_key et cert_sha256
-- pour vérifier la signature ; token_hash est un SHA-256 d'un jeton aléatoire ; code_hash (HMAC à
-- clé hors base) n'est plus lisible (SEC-2, ci-dessous). Colonnes encore modifiables : nom du
-- poste, numérotation (next_seq_floor) et suivi (last_seen_at, last_snapshot_version) ; la suite
-- de référence et le schéma bornent les autres.
-- A12 (mission 5b, lot WP07 ; part d'OP-N69 levée, renforcement) : affectation et mode
-- (event_id, pos_id, app_mode, nfc_enabled, personal_phone) ne sont plus modifiables en direct.
-- Aucun usage dans apps/api/src ; avec ce droit, une session de l'API réaffectait un terminal à
-- un autre point de vente ou événement sans set_device_status ni enrôlement (contournement
-- d'OP-N74 et de FR-015 ; la version du catalogue servie à ce terminal devenait celle d'un autre
-- point de vente). Le reste d'OP-N69 (numérotation, suivi) reste à la mission 7.
REVOKE INSERT, UPDATE ON device FROM cashless_app;
-- OP-N69 levée (mission hors-ligne-snapshots-lots, WP08) : plus aucun UPDATE direct sur device ; les écritures
-- légitimes sont record_device_heartbeat, ack_offline_snapshot, set_device_station_name et les fonctions
-- d'enrôlement (SECURITY DEFINER).
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON device_enrollment_code, device_refresh_token,
  device_status_history, device_request_nonce, device_enrollment_attempt FROM cashless_app;
-- Empreinte des codes d'enrôlement (SEC-2 de la revue post-fusion de la mission 5a, renforcement
-- décidé par le porteur le 21/10/2026) : la base croit l'auteur et les preuves que l'API lui donne
-- (ADR-105, OP-N56) ; avec la connexion de l'API compromise, une empreinte lue préparait un
-- enrôlement. code_hash n'est plus lisible par cashless_app, ni dans device_enrollment_code ni dans
-- device_enrollment_attempt (un essai refusé d'un code valide en garde l'empreinte). L'API ne la
-- lit jamais : création, contrôle, enrôlement et limites passent par les fonctions SECURITY DEFINER
-- de 0022, 0027 et 0030 ; la liste des codes nomme ses colonnes. Lecture accordée par colonne,
-- liste calculée (toutes sauf code_hash) comme pour media.
REVOKE SELECT ON device_enrollment_code, device_enrollment_attempt FROM cashless_app;
DO $$
DECLARE t text; cols text;
BEGIN
  FOREACH t IN ARRAY ARRAY['device_enrollment_code', 'device_enrollment_attempt'] LOOP
    SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) INTO cols FROM pg_attribute
     WHERE attrelid = format('public.%I', t)::regclass AND attnum > 0 AND NOT attisdropped
       AND attname <> 'code_hash';
    EXECUTE format('GRANT SELECT (%s) ON %I TO cashless_app', cols, t);
  END LOOP;
END $$;

-- -----------------------------------------------------------------------------------------------
-- 5. Processus des clés : fonctions de la file des travaux et de la garde des terminaux ; TEMPORARY
-- (lot WP07).
-- -----------------------------------------------------------------------------------------------
-- La file des travaux (claim_tag_key_job, claim_tag_key_job_for, finish_tag_key_job : SECURITY
-- INVOKER, sous la RLS et les politiques par sorte de travail de la section 3) était exécutée par
-- droit hérité de PUBLIC ; elle est accordée aux trois exécutants nommément. Le contrôle quotidien
-- (cashless_tagcheck) n'exécute aucune fonction.
GRANT EXECUTE ON FUNCTION claim_tag_key_job(text[], integer),
  claim_tag_key_job_for(uuid[], text[], integer),
  finish_tag_key_job(uuid, text, text, jsonb, integer)
  TO cashless_tagkeys, cashless_perso, cashless_keyadmin;
-- Garde des requêtes de terminal dans le processus des clés de bracelet (POST /media/auth-keys ;
-- lot WP12).
GRANT EXECUTE ON FUNCTION consume_device_nonce(uuid, bytea, timestamptz, integer),
  device_token_family_active(uuid, uuid), assert_device_active(uuid) TO cashless_tagkeys;
-- Aucun rôle applicatif n'a de TEMPORARY propre (PUBLIC le perd en section 0).
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['cashless_app','cashless_platform','cashless_tagkeys','cashless_perso',
                           'cashless_tagcheck','cashless_keyadmin'] LOOP
    EXECUTE format('REVOKE TEMPORARY ON DATABASE %I FROM %I', current_database(), r);
  END LOOP;
END $$;

-- -----------------------------------------------------------------------------------------------
-- 6. Encaissement en ligne, mission 5b (terminaux-paiement-en-ligne, lot WP07 ;
-- contracts/database-rights.md ; research R-06, R-07, R-11 A20).
-- -----------------------------------------------------------------------------------------------
-- roles.sql vient de rendre SELECT, INSERT et UPDATE sur toutes les tables et vues : une table de
-- la mission reste ouverte en écriture tant que cette section ne la ferme pas. Toutes s'écrivent
-- par les fonctions SECURITY DEFINER de 0031 à 0034 (section 4a). DELETE et TRUNCATE sont déjà
-- retirés partout par roles.sql. Lecture : sous la RLS forcée de chaque table. Un retrait de
-- colonne se fait par REVOKE SELECT sur la table puis GRANT SELECT des colonnes permises (A20 : un
-- REVOKE SELECT (colonne) ne retire rien sur une table accordée en entier) ; liste calculée
-- « toutes sauf » comme pour media et device_enrollment_code, pour qu'une colonne ajoutée plus tard
-- ne soit ni oubliée ni exposée sans que les listes exactes de tests_payment_rights.sql échouent.

-- 6a. Vendeurs (0031). L'empreinte du PIN (Argon2id) et le compteur de blocage ne se lisent que
-- par les fonctions (begin_vendor_pin_check rend l'empreinte à l'API pour la vérification) ; le
-- statut « bloqué » se lit par la vue vendor_public. Sessions et essais de PIN : ouverts et fermés
-- par la base seule (une ligne plantée ouvrait une session sans PIN).
REVOKE SELECT, INSERT, UPDATE ON vendor FROM cashless_app;
DO $$
DECLARE cols text;
BEGIN
  SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) INTO cols FROM pg_attribute
   WHERE attrelid = 'public.vendor'::regclass AND attnum > 0 AND NOT attisdropped
     AND attname NOT IN ('pin_hash', 'failed_attempts', 'locked_at');
  EXECUTE format('GRANT SELECT (%s) ON vendor TO cashless_app', cols);
END $$;
-- Vue vendor_public : une vue simple est modifiable et s'exécute avec les droits de son
-- propriétaire ; avec l'INSERT et l'UPDATE que roles.sql lui rend, une session de l'API
-- réécrivait vendor (statut, nom, prestataire) à travers elle. Lecture gardée (seule lecture du
-- statut « bloqué »). Seule vue créée par la mission (pg_views après 0035).
REVOKE INSERT, UPDATE ON vendor_public FROM cashless_app;
REVOKE INSERT, UPDATE ON vendor_session, vendor_pin_check FROM cashless_app;

-- 6b. Catalogue (0032) : versions créées par la base (une écriture directe changeait un prix sans
-- nouvelle version, ou plantait une version « servie » qui rendait un ancien prix acceptable).
REVOKE INSERT, UPDATE ON catalog_category, catalog_item, catalog_version, catalog_version_item,
  point_of_sale_catalog_policy, device_catalog_served FROM cashless_app;

-- 6c. Ventes (0033) : lignes et attribution en ajout seul, par record_sale_lines et
-- record_sale_attribution. Relecture WP04, constat 1 : un INSERT direct dans sale_attribution
-- attribuait une vente à un autre vendeur que celui de la session (vendor_id n'est pas dans la
-- clé de la session), qui pouvait ensuite l'annuler en mode VENDOR (assert_reversible relit
-- sale_attribution.vendor_id). record_sale_attribution lit vendeur et terminal dans la session.
REVOKE INSERT, UPDATE ON sale_line, sale_attribution FROM cashless_app;
--   approval_token_use : INSERT gardé (l'API y consomme les jetons d'approbation, colonnes
--   d'appelant terminal de 0033 comprises) ; UPDATE, DELETE, TRUNCATE retirés en tête de fichier.

-- 6d. Demandes de paiement QR (0034 ; R-06, renforcement) : usage unique et expiration garantis
-- par la base ; l'empreinte du jeton (nonce_hash) n'est ni lisible ni cherchable par l'API (une
-- empreinte lue, ou une recherche WHERE nonce_hash = …, servait d'oracle sur un jeton capturé).
REVOKE SELECT, INSERT, UPDATE ON payment_request FROM cashless_app;
DO $$
DECLARE cols text;
BEGIN
  SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) INTO cols FROM pg_attribute
   WHERE attrelid = 'public.payment_request'::regclass AND attnum > 0 AND NOT attisdropped
     AND attname <> 'nonce_hash';
  EXECUTE format('GRANT SELECT (%s) ON payment_request TO cashless_app', cols);
END $$;
REVOKE INSERT, UPDATE ON payment_request_detail FROM cashless_app;

-- 6e. Identification au guichet (R-07, C-008 ; renforcement) : aucun usage dans l'API ;
-- FR-021 à FR-023 reportées à la mission 10, qui accordera ses fonctions. Lecture gardée.
REVOKE INSERT, UPDATE ON kyc_verification FROM cashless_app;

-- -----------------------------------------------------------------------------------------------
-- 7. Recharges, caisses et PSP, mission 6 (recharges-caisses-psp, lot WP05 ; contracts/
-- database-rights.md ; research R-20 A6, A7, A8, A9, A10, A24, A27 ; C-004, NFR-005).
-- -----------------------------------------------------------------------------------------------
-- Modèle : section 6. Cette section vient après la section 6 et reste rejouable.
-- A FAIRE RELIRE PAR UNE PERSONNE (droits de la base) : l'agent qui l'a écrite ne la relit pas.

-- 7a. Tables (0036 à 0038) : fermées en écriture. roles.sql vient de rendre INSERT et UPDATE ;
-- DELETE et TRUNCATE sont déjà retirés, redits ici pour ne pas dépendre de l'ordre. Toutes
-- s'écrivent par les fonctions SECURITY DEFINER de 7c. Risque conjuré : un INSERT direct d'une
-- psp_configuration ACTIVE (contournement de l'approbation), d'un cash_session ou d'un psp_topup
-- SUCCEEDED (crédit sans écriture), d'un event_psp_selection (choix du PSP sans contrôle).
-- cashless_app garde son INSERT sur account (A6) : la barrière est account_purpose_guard.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON cash_desk, cash_session, cash_session_count,
  cash_session_tx, psp_configuration, event_psp_selection, psp_topup, psp_event, psp_chargeback,
  psp_webhook_rejection FROM cashless_app;
-- Aucune séquence créée par 0036 à 0038 : rien à retirer côté USAGE.

-- 7b. Colonnes secrètes (A10, A24), liste calculée « toutes sauf » comme en 6a/6d.
-- psp_configuration.secret_ref désigne l'entrée du coffre du titulaire : lue par la seule fonction
-- psp_configuration_secret_ref (adaptateur). psp_event.body est un corps authentifié qui contient
-- des données du payeur : lu par la seule fonction read_psp_event_body (qui audite).
REVOKE SELECT ON psp_configuration FROM cashless_app;
DO $$
DECLARE cols text;
BEGIN
  SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) INTO cols FROM pg_attribute
   WHERE attrelid = 'public.psp_configuration'::regclass AND attnum > 0 AND NOT attisdropped
     AND attname <> 'secret_ref';
  EXECUTE format('GRANT SELECT (%s) ON psp_configuration TO cashless_app', cols);
END $$;
REVOKE SELECT ON psp_event FROM cashless_app;
DO $$
DECLARE cols text;
BEGIN
  SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) INTO cols FROM pg_attribute
   WHERE attrelid = 'public.psp_event'::regclass AND attnum > 0 AND NOT attisdropped
     AND attname <> 'body';
  EXECUTE format('GRANT SELECT (%s) ON psp_event TO cashless_app', cols);
END $$;

-- 7b-bis. wallet.other_block (0042) : tenue par le seul déclencheur wallet_block_cause_guard ;
-- cashless_app ne l'écrit pas (liste « toutes sauf », comme ci-dessus). Le reste des droits de
-- cashless_app sur wallet est inchangé.
REVOKE INSERT, UPDATE ON wallet FROM cashless_app;
DO $$
DECLARE cols text;
BEGIN
  SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) INTO cols FROM pg_attribute
   WHERE attrelid = 'public.wallet'::regclass AND attnum > 0 AND NOT attisdropped
     AND attname <> 'other_block';
  EXECUTE format('GRANT INSERT (%s), UPDATE (%s) ON wallet TO cashless_app', cols, cols);
END $$;

-- 7c. EXECUTE, signature complète, par famille. Séparé de la section 4. Aucun GRANT ON ALL.
GRANT EXECUTE ON FUNCTION
  -- Sessions de caisse (0036)
  open_cash_session(uuid, uuid), count_cash_session(uuid, bigint, uuid, uuid, text),
  begin_cash_close(uuid, uuid), finish_cash_close(uuid, uuid, uuid), attach_cash_tx(uuid, uuid),
  open_cash_due_anomaly(uuid, uuid, bigint, uuid), take_deposit_for_session(uuid, uuid),
  refund_deposit_for_session(uuid, uuid),
  refund_cash_due_for_session(uuid, uuid, text, uuid, uuid, uuid),
  -- Cautions sans compte désigné (0041) : remplacent take_deposit et refund_deposit
  take_deposit_from_balance(uuid), refund_deposit_from_balance(uuid),
  -- Configurations PSP (0037)
  create_psp_configuration(uuid, text, text, uuid, text, boolean, timestamptz, timestamptz, uuid,
                           uuid),
  activate_psp_configuration(uuid, uuid), set_event_psp_selection(uuid, text, uuid, uuid, uuid),
  resolve_psp_configuration(uuid, text), psp_configuration_secret_ref(uuid),
  psp_webhook_context(uuid),
  -- Recharges (0038)
  create_psp_topup(uuid, uuid, text, bigint, text, uuid, uuid, uuid, timestamptz),
  mark_psp_topup_initiated(uuid, text, timestamptz), cancel_psp_topup(uuid),
  expire_psp_topups(uuid[]), psp_poll_candidates(int),
  record_psp_event(uuid, text, text, bytea, jsonb), mark_psp_event(uuid, text, text, uuid),
  psp_events_to_retry(int), purge_psp_event_bodies(int), read_psp_event_body(uuid, uuid),
  complete_psp_topup(uuid, uuid, bigint, text), complete_card_topup(uuid, uuid, bigint, text, text,
                                                                    text),
  fail_psp_topup(uuid, text, boolean, text, text, text), record_webhook_rejection(uuid, text),
  card_topups_today(uuid, text, timestamptz), wallet_card_count(uuid, text),
  -- Contestations (0038)
  record_chargeback(uuid, text, bigint, boolean), attach_chargeback_tx(uuid, uuid),
  block_wallet_after_chargeback(uuid, uuid), unblock_wallet(uuid, uuid)
  TO cashless_app;
-- Anciennes signatures de caisse (take_deposit, refund_deposit, refund_cash_due) : retirées de la
-- section 4 (WP14 cycle 2, OP-N84 levé, ADR-135) ; le moteur passe par les variantes ci-dessus.

-- 7d. Fonctions internes : jamais exécutables par cashless_app (REVOKE explicite, redit pour ne
-- pas dépendre de la section 0). Helpers de contrôle de rôle, noyaux, fonctions de déclencheur
-- (elles se déclenchent sans EXECUTE), open_psp_accounts (décision du porteur du 27/10/2026,
-- option b : appelée par d'autres fonctions de la base seulement).
REVOKE EXECUTE ON FUNCTION
  cash_actor_allowed(uuid, uuid, uuid, text[]), cash_session_usable(uuid, uuid),
  cash_session_attach_own(cash_session, text), posting_cash_desk_guard(), account_purpose_guard(),
  psp_configuration_immutable(), event_psp_selection_guard(), psp_operator_admin(uuid, uuid),
  psp_organizer_admin(uuid, uuid, uuid), psp_account_code(text), open_psp_accounts(uuid),
  fee_rule_guard(), assert_no_legacy_psp_fee_rules(), psp_topup_transition_guard(),
  psp_event_guard(), psp_session_operator(), psp_key_prefix(text), psp_topup_net_credited(uuid),
  psp_topup_replay_row(uuid, uuid, text, bigint, text),
  psp_complete_core(uuid, uuid, bigint, text, boolean, text, text), psp_chargeback_cap(),
  psp_chargeback_guard(), wallet_block_cause_guard()
  FROM cashless_app;

-- 7e. Autres rôles : cashless_platform et les rôles des clés reçoivent des listes nommées plus
-- haut (sections 1 et 5), aucune ne cite une table ou une fonction de cette section. Rien ici.
-- Constat pour la revue : cashless_app garde un INSERT direct sur anomaly (hérité de roles.sql),
-- non retiré dans ce lot.

-- -----------------------------------------------------------------------------------------------
-- 8. Hors ligne, snapshots et lots, mission hors-ligne-snapshots-lots (WP08 ; contracts/
-- database-rights.md corrigé par research R-30.2, R-30.6, R-30.8, R-30.12 et ADR-140 ;
-- contracts/interfaces.md §2 à §7). Rejouable.
-- A FAIRE RELIRE PAR UNE PERSONNE (droits de la base, rôles, colonnes de tag_data_key) : l'agent qui
-- l'a écrite ne la relit pas.
-- -----------------------------------------------------------------------------------------------

-- 8a. OP-N68 : défaut global. Les fonctions que le propriétaire (le rôle qui exécute migrate.ts :
-- DATABASE_URL_OWNER, le même en CI et en production) créera après ce fichier ne sont plus exécutables
-- par PUBLIC. Forme globale, sans IN SCHEMA (la forme IN SCHEMA public est sans effet). Le rôle est
-- current_user, jamais un nom en dur.
DO $$ BEGIN
  EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC', current_user);
END $$;

-- 8b. Rôles de processus nouveaux. Mots de passe hors de ce fichier (CASHLESS_SNAPCONTENT_PASSWORD,
-- CASHLESS_SNAPSIGN_PASSWORD, CASHLESS_MAINT_PASSWORD, posés par migrate.ts). Bloc séparé de la boucle des
-- rôles de clés (section 2) : délais propres, tout remis à zéro puis accordé un à un.
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['cashless_snapcontent','cashless_snapsign','cashless_maint'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT', r);
    END IF;
    EXECUTE format('ALTER ROLE %I SET statement_timeout = ''30s''', r);
    EXECUTE format('ALTER ROLE %I SET idle_in_transaction_session_timeout = ''10s''', r);
    EXECUTE format('ALTER ROLE %I SET lock_timeout = ''5s''', r);
    IF current_setting('server_version_num')::int >= 170000 THEN
      EXECUTE format('ALTER ROLE %I SET transaction_timeout = ''60s''', r);
    END IF;
    EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', r);
    EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', r);
    EXECUTE format('REVOKE ALL ON ALL ROUTINES IN SCHEMA public FROM %I', r);
    EXECUTE format('GRANT USAGE ON SCHEMA public TO %I', r);
    EXECUTE format('REVOKE TEMPORARY ON DATABASE %I FROM %I', current_database(), r);
  END LOOP;
END $$;

-- 8c. Retraits à cashless_app (après roles.sql, qui rend tout). OP-N57, OP-N58, OP-N69, renforcements.
--   OP-N57 : un snapshot ne s'écrit que par publish_offline_snapshot (cashless_snapsign).
--   OP-N58 : la politique et son historique ne s'écrivent que par set_/clear_offline_policy (DEFINER).
--   Le nom de l'historique est lu au catalogue (OP-N58 vise offline_policy_history).
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON offline_snapshot, offline_policy FROM cashless_app;
DO $$
BEGIN
  IF to_regclass('public.offline_policy_history') IS NOT NULL THEN
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON offline_policy_history FROM cashless_app;
  END IF;
END $$;
--   Décision du porteur (02/11/2026, relecture de WP08, M4) : la clé de contenu enveloppée n'est pas lisible
--   par l'API. SELECT par colonne sur offline_snapshot, toutes les colonnes sauf content_key_wrapped (la signature
--   reste lisible). Les fonctions DEFINER qui la lisent (offline_snapshot_for_device, ...) ne sont pas touchées.
REVOKE SELECT ON offline_snapshot FROM cashless_app;
DO $$
DECLARE cols text;
BEGIN
  SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) INTO cols FROM pg_attribute
   WHERE attrelid = 'public.offline_snapshot'::regclass AND attnum > 0 AND NOT attisdropped
     AND attname <> 'content_key_wrapped';
  EXECUTE format('GRANT SELECT (%s) ON offline_snapshot TO cashless_app', cols);
END $$;
--   OP-N69 : device, plus aucun UPDATE (colonnes comprises) ni INSERT, DELETE, TRUNCATE.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON device FROM cashless_app;
--   Renforcement : clés de signature (rotate_snapshot_signing_key seule).
--   ÉCART AU PLAN décidé par le porteur le 30/10/2026 : cashless_app GARDE son INSERT direct sur anomaly (statu quo
--   d'OP-N86 / ADR-136, levé en mission 13 ; sept appelants de l'API l'utilisent). open_offline_anomaly lui est
--   accordée. ADR à rédiger par WP21 ; borne : tests_offline_rights.sql (liste exacte des rôles ayant INSERT).
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON snapshot_signing_key FROM cashless_app;
--   Tables nouvelles de 0043 à 0048 : aucune écriture directe ; lecture par fonctions seulement pour les
--   cinq qui portent le contenu, les enveloppes et les imports (R-30.2).
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON offline_snapshot_draft, offline_snapshot_entry, offline_snapshot_state,
  offline_snapshot_media_log, offline_snapshot_key, offline_snapshot_ack, offline_batch_retry, offline_op_result,
  device_journal_import, wallet_status_history FROM cashless_app;
REVOKE SELECT ON offline_snapshot_entry, offline_snapshot_key, offline_snapshot_state, offline_snapshot_draft,
  device_journal_import FROM cashless_app;

-- 8d. EXECUTE de cashless_app, signature complète, par famille. Aucun GRANT ON ALL. Jamais accordées :
-- open_offline_batch_core (INVOKER, p_allow_revoked), mark_seq_gap_alerted et event_sync_deadline (R-30.12),
-- les fonctions internes de 0043 à 0045, les gardes et fonctions de déclencheur, et les fonctions des
-- processus de snapshot (8e, 8f).
GRANT EXECUTE ON FUNCTION
  -- Politique (0043 ; WP14) et lectures pré-existantes citées par database-rights.md
  set_offline_policy(text, uuid, jsonb, integer, uuid), clear_offline_policy(text, uuid, integer, uuid),
  offline_policy_level(text, uuid), offline_max_exposure(uuid),
  effective_offline_policy(uuid), policy_in_force(uuid, bigint),
  -- Snapshot lu par le terminal et clés publiques de vérification (0045 ; WP15)
  offline_snapshot_for_device(uuid, bigint), snapshot_public_keys(uuid),
  -- Lots, registre, trous, import (0046 ; WP18, WP20)
  open_offline_batch(uuid, uuid, uuid, bigint, bytea, bytea[], bytea, bytea, text, integer),
  complete_offline_batch(uuid, jsonb), offline_batch_state(uuid), record_offline_retry(uuid, bigint, text),
  record_offline_op_result(uuid, bigint, jsonb), offline_op_results(uuid), offline_batch_retries_open(uuid),
  check_seq_gap_waivable(uuid, bigint), device_missing_seqs(uuid, integer),
  waive_seq_gap(uuid, bigint, uuid, uuid, text),
  create_device_journal_import(uuid, jsonb, bytea, jsonb, text, uuid),
  begin_device_journal_import(uuid, bytea, uuid),
  open_imported_batch(uuid, uuid, bigint, bytea, bytea[], bytea, bytea),
  finish_device_journal_import(uuid, text, jsonb), device_journal_import_view(uuid, boolean),
  device_journal_imports_processing(), cancel_device_journal_import(uuid, uuid, text),
  -- Anomalies et blocages (0047 ; WP16, WP19)
  open_offline_anomaly(uuid, text, uuid, uuid, bigint, uuid, bigint, text, jsonb, uuid),
  reduce_offline_shortfall(uuid, bigint, uuid), offline_block_time(uuid, uuid, timestamptz),
  -- Terminal, vendeur, configuration datés (0048 ; WP13, WP15, WP16, WP19)
  ack_offline_snapshot(uuid, bigint, bytea), offline_snapshot_ack_floor(uuid, timestamptz),
  offline_snapshot_meta(uuid, bigint, uuid), offline_media_state_at(uuid, bytea, bigint),
  offline_config_in_force(uuid, bigint, timestamptz, interval), device_status_at(uuid, timestamptz),
  device_revoked_at(uuid), assert_vendor_session_at(uuid, uuid, timestamptz),
  record_sale_attribution_at(uuid, uuid, text, uuid, timestamptz), set_device_station_name(uuid, text, uuid),
  offline_device_exposure(uuid, uuid, bigint, timestamptz, interval),
  -- Verrou de ligne du terminal (0049 §3 ; remplace FOR UPDATE / FOR NO KEY UPDATE, sans UPDATE sur device)
  lock_device(uuid, text),
  -- Remontée des terminaux d'un événement (0051 ; WP21 partie D) : enveloppe étroite, en lecture seule
  event_device_sync_status_api(uuid)
  TO cashless_app;
-- Redit explicite : jamais exécutables par cashless_app, quoi que roles.sql ait accordé.
REVOKE EXECUTE ON FUNCTION
  open_offline_batch_core(uuid, uuid, uuid, bigint, bytea, bytea[], bytea, bytea, text, integer, boolean, uuid),
  mark_seq_gap_alerted(uuid), event_sync_deadline(uuid), offline_policy_scope_operator(text, uuid),
  offline_policy_actor_check(uuid, uuid), offline_snapshot_add_entries(bigint, jsonb),
  offline_snapshot_draft_locked(bigint, boolean), offline_snapshot_source_rows(uuid, timestamptz),
  offline_snapshot_item_ok(jsonb), offline_snapshot_header_ok(jsonb), offline_snapshot_envelope_ok(jsonb),
  purge_device_request_nonces(integer), purge_device_enrollment_attempts()
  FROM cashless_app;

-- 8e. cashless_snapcontent (processus snapshot-content : DecryptPort et DataKeyPort). Liste figée.
GRANT EXECUTE ON FUNCTION
  offline_snapshot_targets(), offline_snapshot_source(uuid), offline_snapshot_source_delta(uuid, timestamptz),
  save_offline_snapshot_draft(uuid, text, jsonb, bytea, jsonb), wrap_offline_snapshot_key(uuid, bigint, uuid, bytea, jsonb),
  offline_snapshot_keys_to_wrap(integer), purge_offline_snapshot_content(uuid),
  append_offline_snapshot_draft_entries(bigint, jsonb), seal_offline_snapshot_draft(bigint),
  discard_offline_snapshot_draft(bigint, text), offline_snapshot_state_hashes(uuid),
  offline_snapshot_entry_sha256(jsonb), discard_open_offline_snapshot_drafts(uuid)
  TO cashless_snapcontent;
-- Colonnes de tag_data_key : liste FIGÉE (jamais « toutes sauf »), encrypted_dek comprise (R-30.12).
GRANT SELECT (id, operator_id, key_index, version, status, wrapping_kms_key_ref, encrypted_dek)
  ON tag_data_key TO cashless_snapcontent;

-- 8f. cashless_snapsign (processus snapshot-signer : SignPort seul). snapshot_public_keys(uuid) : lecture des clés
-- publiques (décision du porteur, 02/11/2026) pour vérifier la signature contre la clé du key_id ; aucun droit de table. Aucun droit d'audit (l'audit
-- SNAPSHOT_PUBLISHED est écrit par publish_offline_snapshot), aucun sur tag_data_key, media, enveloppes.
GRANT EXECUTE ON FUNCTION
  offline_snapshot_drafts_ready(), offline_snapshot_draft_content(bigint),
  publish_offline_snapshot(bigint, text, bytea), discard_offline_snapshot_draft(bigint, text),
  offline_seq_gaps_to_alert(interval), mark_seq_gap_alerted(uuid),
  offline_retries_to_alert(interval), mark_offline_retry_alerted(uuid, bigint),
  snapshot_public_keys(uuid)
  TO cashless_snapsign;

-- 8g. cashless_maint : les deux purges, rien d'autre (OP-N75).
GRANT EXECUTE ON FUNCTION purge_device_request_nonces(integer), purge_device_enrollment_attempts()
  TO cashless_maint;

-- 8h. cashless_keyadmin : rotation de la clé de signature des snapshots (WP09). Le travailleur
-- snapshot-key-admin reprend une rotation interrompue : il relit la clé qu'il a notée (audit
-- SNAPSHOT_SIGNING_KEY_CREATED, écrit par lui) et regarde si elle est déjà dans snapshot_signing_key.
GRANT EXECUTE ON FUNCTION rotate_snapshot_signing_key(text, bytea, text, uuid) TO cashless_keyadmin;
--   Lecture de snapshot_signing_key par colonnes nommées (ni la clé publique ni les dates) ; pas d'écriture.
--   Accepté par le porteur le 30/10/2026 ; borné par tests_offline_rights.sql.
GRANT SELECT (key_id, operator_id, owner, kms_key_ref, status) ON snapshot_signing_key TO cashless_keyadmin;
--   Audit des clés de signature : lignes de la plateforme (operator_id NULL) des seules actions
--   SNAPSHOT_SIGNING_KEY_*, en lecture et en écriture. Sans cette politique, la RLS tenant_isolation refuse
--   toute ligne sans prestataire à ce rôle. Politiques permissives nominatives, ajoutées à tenant_isolation.
DROP POLICY IF EXISTS keyadmin_snapshot_key_audit_read ON audit_log;
DROP POLICY IF EXISTS keyadmin_snapshot_key_audit_insert ON audit_log;
CREATE POLICY keyadmin_snapshot_key_audit_read ON audit_log FOR SELECT TO cashless_keyadmin
  USING (operator_id IS NULL AND action LIKE 'SNAPSHOT\_SIGNING\_KEY\_%');
CREATE POLICY keyadmin_snapshot_key_audit_insert ON audit_log FOR INSERT TO cashless_keyadmin
  WITH CHECK (operator_id IS NULL AND action LIKE 'SNAPSHOT\_SIGNING\_KEY\_%');

-- -----------------------------------------------------------------------------------------------
-- 9. Passerelle locale, mission passerelle-locale (WP09 ; FR-031, NFR-011, C-010 ; contracts/interfaces.md
-- § 1, § 2, § 3, § 12.3 à 12.5, § 13.5 ; data-model A.1 ; migrations 0058 à 0064). Rejouable.
-- A FAIRE RELIRE PAR UNE PERSONNE (CLAUDE.md, règle 4) : frontière de privilèges de la passerelle côté central. Un
-- GRANT de trop rend toute la défense vaine. Principe : liste NOMMEE, jamais ALL, jamais PUBLIC. Une fonction oubliée
-- échoue fermée ; une fonction en trop est un défaut bloquant. Les mots de passe des deux rôles viennent de migrate.ts
-- (CASHLESS_EDGE_PASSWORD, CASHLESS_EDGEADMIN_PASSWORD), hors de ce fichier.
-- -----------------------------------------------------------------------------------------------

-- 9a. Rôles cashless_edge (processus `edge`, connexion mTLS) et cashless_edgeadmin (outil d'administration) :
-- créés par 0058 sans droit ; ici attributs, délais de session (comme cashless_app), tout remis à zéro puis accordé un
-- à un, aucun TEMPORARY.
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['cashless_edge','cashless_edgeadmin'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT', r);
    END IF;
    EXECUTE format('ALTER ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT', r);
    EXECUTE format('ALTER ROLE %I SET statement_timeout = ''30s''', r);
    EXECUTE format('ALTER ROLE %I SET idle_in_transaction_session_timeout = ''10s''', r);
    EXECUTE format('ALTER ROLE %I SET lock_timeout = ''5s''', r);
    IF current_setting('server_version_num')::int >= 170000 THEN
      EXECUTE format('ALTER ROLE %I SET transaction_timeout = ''60s''', r);
    END IF;
    EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', r);
    EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', r);
    EXECUTE format('REVOKE ALL ON ALL ROUTINES IN SCHEMA public FROM %I', r);
    EXECUTE format('GRANT USAGE ON SCHEMA public TO %I', r);
    EXECUTE format('REVOKE TEMPORARY ON DATABASE %I FROM %I', current_database(), r);
  END LOOP;
END $$;

-- 9b. cashless_app : roles.sql lui rend INSERT et UPDATE sur toute table. Les tables de la passerelle ne s'écrivent que
-- par les fonctions SECURITY DEFINER (propriétaire). Lecture : retirée là où l'API publique n'en a pas l'usage.
--   edge_gateway : SELECT conservé (sous RLS), plus aucune écriture (R-06.1 ; fenêtre entre 0058 et ce fichier fermée).
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON edge_gateway FROM cashless_app, cashless_platform;
--   Registres de lots et de résultats : SELECT sous RLS conservé, aucune écriture.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON edge_sync_batch, edge_sync_batch_result
  FROM cashless_app, cashless_platform;
--   Fermées en lecture ET en écriture : colis et clé de colis (chiffrés, inutiles à l'API publique), journal de
--   référence, réglages de plateforme (écrits par set_edge_setting seule, lus par edge_setting_value), horizon de
--   réplication, audit des jetons de personnel, vue des numéros de terminal (lue par cashless_edge seul, 9d).
REVOKE ALL ON edge_pwd_pack, edge_pwd_pack_key, edge_reference_change, edge_platform_setting,
  edge_replication_horizon, edge_staff_token_audit, edge_device_seq_acked FROM cashless_app, cashless_platform;

-- 9c. EXECUTE de cashless_app (signatures complètes). Enveloppes HUMAINES uniquement (assert_tenant) ; post_transaction
-- reste exécutable (sa garde SQL refuse EDGE_SYNC à cette connexion, WP05). fail_edge_grant et request_edge_release sont des
-- fonctions du kit sans enveloppe (0059) : elles portent assert_tenant, la route humaine les appelle. Accordées
-- nommément (ÉCART signalé au porteur : elles n'étaient pas dans la liste de cashless_app).
GRANT EXECUTE ON FUNCTION
  edge_grant_authority(uuid, uuid, uuid), get_debit_authority(uuid), fail_edge_release(uuid, uuid),
  force_central_authority_approved(uuid, uuid, text), request_edge_release(uuid, uuid),
  fail_edge_grant(uuid, uuid, text),
  -- Décision 23 (0064) : exposition des jetons d'appareil d'un événement, appelée par l'API centrale seule
  edge_expose_device_token_families(uuid)
  TO cashless_app;
-- Redit explicite : jamais exécutables par un rôle applicatif (fonctions S12 brutes du kit, sans le filigrane de
-- référence ni le refus d'une caisse CLOSING ; internes de 0058 à 0064). Quoi que roles.sql ait accordé.
REVOKE EXECUTE ON FUNCTION
  grant_edge_authority(uuid, uuid, uuid), ack_edge_handover(uuid, integer, bigint),
  complete_edge_release(uuid, integer, bigint, bytea), record_edge_seq(uuid, bigint, text, bytea, text, uuid, text),
  edge_event_lock(uuid), edge_event_handover_open(uuid), edge_admin_audit(uuid, text, uuid, text, jsonb, text),
  edge_bind_gateway(uuid, boolean), edge_lock_handover(uuid, uuid), edge_assert_session_gateway(uuid),
  edge_ledger_of_gateway(uuid), edge_counter_op(text, uuid, bigint, bigint, text, bytea, jsonb),
  edge_open_replay_failed(uuid, uuid, bigint, text, uuid, uuid, bigint, uuid, bigint, text, text, text),
  edge_record_rejection(uuid, uuid, bigint, text, bytea, text, text, uuid, uuid, bigint, bigint, text, boolean),
  edge_setting_value(text, text), edge_spend_promo_first(uuid, timestamptz), set_edge_setting(text, bigint, text),
  edge_ref_emit_many(uuid, text, uuid[]), edge_ref_emit_media_set(uuid[]), edge_ref_backfill(uuid),
  edge_ref_event_ledger(uuid), edge_ref_scope_ledgers(text, uuid), edge_ref_staff_ledgers(uuid),
  edge_ref_ctx_enter(uuid), edge_ref_ctx_leave(text), edge_ts(timestamptz), edge_b64(bytea)
  FROM cashless_app, cashless_platform;

-- 9d. cashless_edge (processus `edge`) : EXECUTE nommé, AUCUN droit de table, sauf la lecture de la vue étroite des
-- numéros de terminal (déclarée à accorder par l'en-tête de 0063 : base de getDeviceSeqStatus, FR-026 ; limitée par la
-- vue aux terminaux de l'événement de la passerelle appelante, app.gateway_id). Jamais : post_transaction,
-- set_debit_authority, fonctions S12 brutes, internes.
GRANT EXECUTE ON FUNCTION
  identify_edge_gateway(bytea), touch_edge_gateway(uuid), get_current_edge_handover(uuid), get_debit_authority(uuid),
  begin_edge_release(uuid, uuid, bigint, bigint, bytea, bigint), edge_ack_handover(uuid, uuid, bigint, bigint),
  edge_complete_release(uuid, uuid, bigint, bigint, bytea, bigint),
  edge_record_seq(uuid, bigint, text, bytea, text, uuid, text),
  edge_sync_batch_begin(uuid, uuid, bigint, bigint, bigint, bytea, integer),
  edge_sync_batch_result(uuid, bigint, text, text, text, uuid, boolean), edge_sync_batch_finish(uuid, text),
  edge_record_staff_token_audit(uuid, uuid, jsonb),
  edge_post_transaction(uuid, bigint, bigint, text, bytea, jsonb, jsonb),
  edge_activate_media(uuid, bigint, bigint, text, bytea, jsonb), edge_take_deposit(uuid, bigint, bigint, text, bytea, jsonb),
  edge_topup_cash(uuid, bigint, bigint, text, bytea, jsonb), edge_replication_page(uuid, bigint, bigint, integer),
  -- Décision 39 (0066, ADR-174) : accès étroits de la réception des lots, aucun droit de table. edge_tap_proof : hors
  -- liste de la décision, soumise au porteur.
  edge_sync_cursor(uuid), edge_sync_device_key(uuid, text), edge_sync_results(uuid, uuid),
  edge_fee_config(uuid, text, timestamptz), edge_sync_audit(uuid, text, uuid, jsonb),
  edge_tap_proof(uuid, bytea, bytea, bytea)
  TO cashless_edge;
GRANT SELECT ON edge_device_seq_acked TO cashless_edge;

-- 9e. cashless_edgeadmin (outil edge-admin) : six fonctions. set_edge_gateway_role n'est accordée à PERSONNE.
GRANT EXECUTE ON FUNCTION
  register_edge_gateway(uuid, uuid, text, text, bytea, bytea, bytea, text, text),
  revoke_edge_gateway(uuid, text, text), rotate_edge_gateway_cert(uuid, bytea, text),
  swap_edge_gateway_roles(uuid, uuid, text), edge_register_snapshot_key(uuid, text, bytea, text),
  set_edge_setting(text, bigint, text)
  TO cashless_edgeadmin;

-- 9f. Processus existants : colis de mots de passe (cashless_tagkeys) et maintenance (cashless_maint).
GRANT EXECUTE ON FUNCTION
  deposit_edge_pwd_pack(uuid, uuid, bytea, bytea, bigint), deposit_edge_pwd_pack_key(uuid, bytea, jsonb),
  edge_gateways_awaiting_pack(integer), edge_media_to_pack(uuid, integer)
  TO cashless_tagkeys;
GRANT EXECUTE ON FUNCTION mark_edge_gateways_silent(interval), edge_stuck_handovers(interval),
  edge_log_release_stuck(uuid)  -- 0065, décision 37 (ADR-173)
  TO cashless_maint;
-- 10. Authentification des festivaliers par code à usage unique (migration 0080 ; hors Spec Kitty, porteur, 10/11/2026).
-- roles.sql vient de rendre SELECT, INSERT et UPDATE sur toutes les tables à cashless_app : on retire ce qui n'est pas
-- nécessaire. Aucun DELETE ni TRUNCATE (retirés par roles.sql, redits).
--   Codes publics : lus par operator_by_public_code (SECURITY DEFINER) seulement ; aucun droit de table.
REVOKE ALL ON operator_public_code FROM cashless_app;
--   Numéros vérifiés : lus et créés au premier passage ; jamais modifiés par l'API.
REVOKE UPDATE, DELETE, TRUNCATE ON customer_identity FROM cashless_app;
--   Défis : l'API en crée, et ne change que le compteur d'essais, la consommation et l'invalidation ; ni le code
--   (empreinte), ni le numéro, ni l'échéance ne se réécrivent.
REVOKE UPDATE, DELETE, TRUNCATE ON otp_challenge FROM cashless_app;
GRANT UPDATE (attempts, consumed_at, invalidated_at) ON otp_challenge TO cashless_app;
--   Blocages de numéro : création puis prolongation de l'échéance seulement.
REVOKE UPDATE, DELETE, TRUNCATE ON otp_phone_block FROM cashless_app;
GRANT UPDATE (blocked_until) ON otp_phone_block TO cashless_app;
--   Jetons de renouvellement : usage et révocation seulement ; l'empreinte, le compte et la famille ne changent pas.
REVOKE UPDATE, DELETE, TRUNCATE ON customer_refresh_token FROM cashless_app;
GRANT UPDATE (used_at, revoked_at) ON customer_refresh_token TO cashless_app;
--   Les trois lectures qui précèdent la connaissance du prestataire : cashless_app seul (jamais les autres rôles).
REVOKE EXECUTE ON FUNCTION operator_by_public_code(text), otp_challenge_operator(uuid),
  customer_refresh_operator(bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION operator_by_public_code(text), otp_challenge_operator(uuid),
  customer_refresh_operator(bytea) TO cashless_app;
