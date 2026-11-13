-- Accès étroits de la réception des lots (migration 0066 ; WP13 correction ; décisions 38 et 39, ADR-174) — pgTAP.
-- Lancer depuis packages/ledger-sql : pg_prove -d <base> tests/tests_edge_sync_access.sql (base migrée, roles.sql et
-- post-roles.sql rejoués). Catalogue seulement : la preuve sous la connexion réelle `cashless_edge` (COMMIT compris)
-- est celle de apps/api/test/integration/edge/sync/sync-real-role.spec.ts.
\set ON_ERROR_STOP 1
\set QUIET 1
BEGIN;
\ir _grants_for_tests.sql
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

CREATE TEMP TABLE access_fns(sig text PRIMARY KEY);
INSERT INTO access_fns VALUES ('edge_sync_cursor(uuid)'), ('edge_sync_device_key(uuid,text)'),
 ('edge_sync_results(uuid,uuid)'), ('edge_fee_config(uuid,text,timestamptz)'),
 ('edge_sync_audit(uuid,text,uuid,jsonb)'), ('edge_tap_proof(uuid,bytea,bytea,bytea)');

-- check_balanced : SECURITY DEFINER, search_path figé, pas d'EXECUTE pour PUBLIC.
SELECT ok((SELECT p.prosecdef FROM pg_proc p WHERE p.oid = 'check_balanced()'::regprocedure),
  'check_balanced : SECURITY DEFINER (décision 38)');
SELECT ok((SELECT p.proconfig @> ARRAY['search_path=public, pg_temp'] FROM pg_proc p
            WHERE p.oid = 'check_balanced()'::regprocedure),
  'check_balanced : search_path = public, pg_temp');
SELECT ok(NOT has_function_privilege('public', 'check_balanced()', 'EXECUTE'),
  'check_balanced : EXECUTE retiré à PUBLIC');
SELECT ok(NOT has_table_privilege('cashless_edge', 'public.posting', 'SELECT')
          AND NOT has_any_column_privilege('cashless_edge', 'public.posting', 'SELECT'),
  'cashless_edge : AUCUN droit de lecture sur posting (la fonction DEFINER remplace le droit)');

-- Six fonctions : DEFINER, search_path, PUBLIC fermé, cashless_edge seul.
SELECT is((SELECT count(*)::int FROM access_fns f
            WHERE (SELECT p.prosecdef AND p.proconfig @> ARRAY['search_path=public, pg_temp']
                     FROM pg_proc p WHERE p.oid = f.sig::regprocedure)), 6,
  'les six fonctions de 0066 : SECURITY DEFINER avec search_path = public, pg_temp');
SELECT is((SELECT count(*)::int FROM access_fns f WHERE has_function_privilege('public', f.sig::regprocedure, 'EXECUTE')), 0,
  'les six fonctions de 0066 : aucun EXECUTE pour PUBLIC');
SELECT is((SELECT count(*)::int FROM access_fns f WHERE has_function_privilege('cashless_edge', f.sig::regprocedure, 'EXECUTE')), 6,
  'les six fonctions de 0066 : EXECUTE à cashless_edge');
SELECT is((SELECT coalesce(string_agg(r.rolname || ':' || f.sig, ' '), '') FROM access_fns f, pg_roles r
            WHERE r.rolname LIKE 'cashless\_%' AND r.rolname <> 'cashless_edge'
              AND has_function_privilege(r.rolname, f.sig::regprocedure, 'EXECUTE')), '',
  'les six fonctions de 0066 : aucun autre rôle cashless_* ne les exécute');
-- Aucun droit direct sur une table pour cashless_edge, hors la vue des terminaux (garde contre un retour du droit).
SELECT is((SELECT coalesce(string_agg(c.relname, ' ' ORDER BY c.relname), '') FROM pg_class c
            WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
              AND c.relname <> 'edge_device_seq_acked'
              AND NOT EXISTS (SELECT 1 FROM pg_depend e WHERE e.classid = 'pg_class'::regclass
                                 AND e.objid = c.oid AND e.deptype = 'e')
              AND (has_any_column_privilege('cashless_edge', c.oid, 'SELECT')
                   OR has_any_column_privilege('cashless_edge', c.oid, 'INSERT')
                   OR has_any_column_privilege('cashless_edge', c.oid, 'UPDATE')
                   OR has_table_privilege('cashless_edge', c.oid, 'DELETE'))), '',
  'cashless_edge : aucun droit direct sur aucune table ou vue de public (hors la vue des terminaux)');
SELECT * FROM finish();
ROLLBACK;
