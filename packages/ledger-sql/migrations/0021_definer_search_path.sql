-- Migration 0021 : toute fonction SECURITY DEFINER du schéma public fixe `search_path = public, pg_temp`
-- (mission identite-enrolement-terminaux, lot WP02 ; OP-N59, ADR-96 ; FR-020, NFR-010 ; research R-11).
--
-- Avant : 77 des 84 fonctions SECURITY DEFINER du schéma public (dont les tenant_of_* du schéma de référence :
-- tenant_of_ledger, tenant_of_media, tenant_of_wallet, tenant_of_batch, tenant_of_event, tenant_of_device,
-- tenant_of_gateway) fixaient `SET search_path = public`, sans `pg_temp`. Quand `pg_temp` n'est pas nommé dans le
-- search_path, PostgreSQL cherche les tables D'ABORD dans le schéma temporaire de la session. Un appelant qui a le
-- droit TEMPORARY (accordé à PUBLIC par défaut) créait une table temporaire `ledger`, `media`, `wallet`… de son choix :
-- la fonction, exécutée avec les droits du propriétaire, lisait cette table au lieu de celle de la base. Pour les
-- tenant_of_*, cela rendait le prestataire choisi par l'appelant et contournait le cloisonnement entre prestataires.
--
-- Après : chaque fonction SECURITY DEFINER du schéma public a `search_path = public, pg_temp`. Nommé en DERNIER,
-- `pg_temp` n'est plus cherché qu'après `public` : une table temporaire de même nom qu'une table de la base est
-- ignorée. (Le retirer de la liste ne suffirait pas : absent, il est cherché en premier implicitement.)
-- Seconde barrière, posée par un autre lot (WP07) : TEMPORARY retiré à PUBLIC dans `post-roles.sql`.
--
-- Parcours du catalogue, pas de liste figée : aucune fonction n'est oubliée. Les fonctions qui appartiennent à une
-- extension (pg_depend, deptype 'e') sont exclues : elles relèvent de leur extension. ALTER ROUTINE couvre fonctions
-- et procédures. Les autres réglages de la fonction (proconfig) sont conservés : seul search_path est fixé. Une
-- fonction dont le propriétaire n'est pas celui qui applique la migration fait échouer la migration (refus visible,
-- pas d'oubli silencieux). Le bloc est idempotent : une fonction déjà conforme n'est pas retouchée.
--
-- RÈGLE POUR LES MIGRATIONS FUTURES : un `CREATE OR REPLACE FUNCTION` remplace aussi les réglages de la fonction et
-- efface ce `SET search_path`. Toute migration qui crée ou remplace une fonction SECURITY DEFINER doit fixer
-- elle-même `SET search_path = public, pg_temp`. La suite tests/tests_definer_search_path.sql, lancée après toutes
-- les migrations et `post-roles.sql`, échoue sinon (de même que la section 4 de tests/tests_definer_trigger_writers.sql).
DO $$
DECLARE
  f regprocedure;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure
      FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace
       AND p.prosecdef
       AND NOT EXISTS (SELECT 1 FROM pg_depend d
                        WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
       AND NOT coalesce(p.proconfig @> ARRAY['search_path=public, pg_temp'], false)
     ORDER BY p.oid
  LOOP
    EXECUTE format('ALTER ROUTINE %s SET search_path = public, pg_temp', f);
  END LOOP;
END
$$;
