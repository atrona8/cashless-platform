-- Défaut global des fonctions (OP-N68, WP08, relecture M2) — pgTAP. Lit pg_default_acl TELLE QUELLE : la suite ne
-- rejoue ni roles.sql ni post-roles.sql et n'inclut pas _grants_for_tests.sql, donc un
-- `ALTER DEFAULT PRIVILEGES … GRANT EXECUTE ON FUNCTIONS TO PUBLIC` posé à chaud (ou un défaut rouvert par erreur)
-- la fait échouer. Lancer : pg_prove -d <base> tests/tests_default_acl.sql (base migrée, post-roles.sql rejoué).
\set ON_ERROR_STOP 1
\set QUIET 1
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

SELECT is((SELECT count(*)::int FROM pg_default_acl d WHERE d.defaclobjtype = 'f' AND d.defaclnamespace = 0
             AND d.defaclrole = (SELECT oid FROM pg_roles WHERE rolname = current_user)
             AND NOT EXISTS (SELECT 1 FROM aclexplode(d.defaclacl) a WHERE a.grantee = 0)), 1,
  'OP-N68 : défaut global du propriétaire présent, PUBLIC sans EXECUTE sur les fonctions futures');
SELECT is((SELECT count(*)::int FROM pg_default_acl d, aclexplode(d.defaclacl) a
            WHERE d.defaclobjtype = 'f' AND a.grantee = 0), 0,
  'OP-N68 : aucun défaut (global ou par schéma, tout rôle) n''accorde EXECUTE à PUBLIC');

SELECT * FROM finish();
ROLLBACK;
