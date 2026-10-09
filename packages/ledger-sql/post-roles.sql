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
