-- Rôle applicatif du système cashless (revue 2) — à exécuter APRÈS schema_grand_livre_cashless.sql,
-- par le propriétaire des tables (qui possède aussi les fonctions SECURITY DEFINER).
-- Principe : l'application lit tout (sous RLS), écrit les données de référence, mais n'écrit JAMAIS
-- directement dans le grand livre ni dans les registres en ajout seul : uniquement par les fonctions.
-- Le mot de passe se règle hors de ce fichier (gestionnaire de secrets).

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cashless_app') THEN
    CREATE ROLE cashless_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO cashless_app;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO cashless_app;
GRANT INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO cashless_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO cashless_app;

-- Grand livre, scellements et registres : écriture seulement par les fonctions (SECURITY DEFINER)
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON
  journal_transaction, posting, account_balance, ledger_seal, device_seq_registry, edge_sync_registry,
  offline_batch, debit_authority_handover, event_status_history, media_tap
FROM cashless_app;
-- Demandes d'approbation : créées par l'application, décidées seulement par decide_approval_request ;
-- l'application ne peut que passer une demande APPROVED à EXECUTED ou FAILED (garde approval_request_guard).
REVOKE UPDATE ON approval_request FROM cashless_app;
GRANT UPDATE (status, executed_tx_id, failure_code, failure_reason) ON approval_request TO cashless_app;
-- Grand livre : créé par l'application, mais son statut et son autorité ne changent que par les fonctions
REVOKE UPDATE ON ledger FROM cashless_app;
-- Colonnes tenues par les fonctions : l'application ne peut pas les modifier (revue 2)
--   device : numérotation et chaînage (sinon la borne max_seq_jump et la chaîne seraient contournables)
REVOKE UPDATE ON device FROM cashless_app;
GRANT UPDATE (app_mode, nfc_enabled, event_id, pos_id, station_name, status, public_key, last_snapshot_version,
              last_seen_at, next_seq_floor, agreement_public_key, cert_sha256, personal_phone) ON device TO cashless_app;
--   account : le sens permis et la famille ne changent pas après création ; chaud/froid et activité restent réglables
REVOKE UPDATE ON account FROM cashless_app;
GRANT UPDATE (is_active, hot) ON account TO cashless_app;
--   anomaly : seuls le statut et l'écriture de résolution changent (garde anomaly_cash_due_guard pour les espèces dues)
REVOKE UPDATE ON anomaly FROM cashless_app;
GRANT UPDATE (status, resolution_tx_id) ON anomaly TO cashless_app;
-- Aucune suppression nulle part (corrections par contre-passation ou changement de statut)
REVOKE DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public FROM cashless_app;

-- Fonctions : toutes celles de l'API, sauf les fonctions internes (déjà retirées à PUBLIC par le schéma)
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO cashless_app;
REVOKE EXECUTE ON FUNCTION
  set_debit_authority(uuid, text, uuid), advance_device_seq(uuid), advance_device_chain(uuid), deposit_accounts(uuid),
  check_wallet_limits(uuid, uuid, text, timestamptz), check_late_claim(ledger, text, jsonb), wallet_currency(uuid), ledger_jurisdiction(uuid),
  tenant_of_ledger(uuid), tenant_of_media(uuid), tenant_of_wallet(uuid), tenant_of_batch(uuid), tenant_of_event(uuid),
  tenant_of_device(uuid), tenant_of_gateway(uuid), ledger_purpose_balance(uuid, text[]), ledger_unsettled(uuid, text[])
FROM cashless_app;

-- Durée des transactions (ADR-55, SPECIFICATION §13.7) — OBLIGATOIRE en production
ALTER ROLE cashless_app SET statement_timeout = '30s';
ALTER ROLE cashless_app SET idle_in_transaction_session_timeout = '10s';
ALTER ROLE cashless_app SET lock_timeout = '5s';
DO $$ BEGIN
  IF current_setting('server_version_num')::int >= 170000 THEN
    EXECUTE 'ALTER ROLE cashless_app SET transaction_timeout = ''60s''';
  END IF;
END $$;
