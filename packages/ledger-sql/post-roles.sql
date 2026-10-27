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
-- Fonctions futures (décision du porteur du 20/10/2026, option c) : aucun droit par défaut n'est
-- posé (la forme « ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE … FROM PUBLIC » est sans effet
-- en PostgreSQL ; la forme globale retirerait EXECUTE à PUBLIC sur pgtap et sur les fonctions
-- pg_temp des suites). migrate.ts applique la série et rejoue ce fichier dans UNE transaction : une
-- fonction créée par une migration n'est jamais validée exécutable par PUBLIC
-- (apps/api/test/integration/transverse/migrate-rights.spec.ts). Limite restante : une fonction
-- créée à la main hors de migrate.ts le reste jusqu'au prochain rejeu (tests_execute_grants.sql §4).
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
  preload_media(uuid), take_deposit(uuid, uuid), refund_deposit(uuid, uuid), forfeit_deposit(uuid),
  refund_cash_due(uuid, uuid, text, uuid, uuid, uuid), wallet_topup_headroom(uuid, timestamptz),
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
  purge_device_request_nonces(integer), purge_device_enrollment_attempts(),
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
GRANT UPDATE (station_name, last_snapshot_version, last_seen_at, next_seq_floor) ON device
  TO cashless_app;
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
