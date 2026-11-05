-- Fichier commun des suites pgTAP (mission hors-ligne-snapshots-lots, WP08, OP-N68).
-- post-roles.sql (section 8a) retire EXECUTE à PUBLIC sur les fonctions que le propriétaire créera : pgtap
-- (CREATE EXTENSION dans la transaction de la suite) et les fonctions pg_temp des suites ne seraient plus
-- exécutables sous `SET ROLE cashless_*`. Ce fichier rétablit, DANS LA TRANSACTION DE LA SUITE seulement, le
-- défaut de PostgreSQL (EXECUTE à PUBLIC pour les fonctions créées ensuite) ; le ROLLBACK de la suite l'annule.
-- Inclusion : `\ir _grants_for_tests.sql` APRÈS `BEGIN;` et AVANT `CREATE EXTENSION pgtap` et la création des
-- fonctions de la suite. JAMAIS hors transaction, JAMAIS dans tests_execute_grants.sql §4 (preuve que le
-- défaut de production reste fermé), JAMAIS par migrate.ts. Le fichier n'est pas une suite : test-pgtap.sh
-- ignore les fichiers `_*.sql`.
-- Garde (relecture de WP08, M1) : hors transaction explicite, le défaut serait posé de façon permanente.
-- DECLARE … CURSOR (sans HOLD) échoue hors d'un bloc de transaction ; la DO refuse alors d'aller plus loin.
DECLARE wp08_tx_guard CURSOR FOR SELECT 1;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_cursors WHERE name = 'wp08_tx_guard') THEN
    RAISE EXCEPTION '_grants_for_tests.sql : à inclure DANS une transaction explicite (BEGIN), jamais seul';
  END IF;
END $$;
CLOSE wp08_tx_guard;
DO $$ BEGIN
  EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I GRANT EXECUTE ON FUNCTIONS TO PUBLIC', current_user);
END $$;
