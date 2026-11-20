-- Tests de borne de la mission durcissements-serveur (mission 11a ; règle 3 de CLAUDE.md, décision du porteur du 19/11/2026)
-- pgTAP, écrit à la main. Chaque écart accepté a ici un test qui ÉCHOUE si la limite s'élargit :
--   OP-N155(b) : refund_request_insert_guard n'exclut que les superutilisateurs ;
--   OP-N157    : surface exacte de cashless_pin (droits, EXECUTE, RLS d'audit_log) ; OP-N8 : cashless_pin sans pouvoir d'administration ;
--   OP-N152    : bornes d'advance_app_attest_counter (EXECUTE, compteur strictement croissant, REVOKED, autre prestataire).
-- A FAIRE RELIRE PAR UNE PERSONNE : les listes attendues sont la source de vérité des bornes.
-- Un test qui échoue après un RESSERREMENT (ex. politique VENDOR_* ajoutée) est voulu : mettre à jour OP-N157 et ce test.
-- Lancer : pg_prove -d <base> tests/tests_11a_bounds.sql. Mutations : voir la note de lane (identifiants de tests).
\set ON_ERROR_STOP 1
\set QUIET 1
BEGIN;
\ir _grants_for_tests.sql
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

CREATE FUNCTION pg_temp.id(p text) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT ('00000000-0000-0000-0000-' || lpad(p, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.code(p text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE p; RETURN NULL; EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE; END $$;
CREATE FUNCTION pg_temp.a(p text) RETURNS void LANGUAGE sql AS
  $$ SELECT set_config('app.operator_id', pg_temp.id(p)::text, true) $$;

-- Données (propriétaire) : deux prestataires, trois terminaux (A actif, A révoqué, B actif), une clé App Attest chacun.
INSERT INTO party (id, kind, legal_name, country_code) VALUES
  (pg_temp.id('12a001'), 'OPERATOR', 'Prestataire A (bornes)', 'SN'),
  (pg_temp.id('12a002'), 'OPERATOR', 'Prestataire B (bornes)', 'SN');
INSERT INTO device (id, operator_id, kind, app_mode, serial, status) VALUES
  (pg_temp.id('12d001'), pg_temp.id('12a001'), 'POS', 'KEYPAD_TPE', 'B12-A1', 'ACTIVE'),
  (pg_temp.id('12d002'), pg_temp.id('12a001'), 'POS', 'KEYPAD_TPE', 'B12-A2', 'ACTIVE'),
  (pg_temp.id('12d003'), pg_temp.id('12a002'), 'POS', 'KEYPAD_TPE', 'B12-B1', 'ACTIVE');
INSERT INTO device_app_attest_key (device_id, operator_id, key_id, public_key, counter) VALUES
  (pg_temp.id('12d001'), pg_temp.id('12a001'), sha256('k1'), '\x3059', 5),
  (pg_temp.id('12d002'), pg_temp.id('12a001'), sha256('k2'), '\x3059', 5),
  (pg_temp.id('12d003'), pg_temp.id('12a002'), sha256('k3'), '\x3059', 5);
UPDATE device SET status = 'REVOKED' WHERE id = pg_temp.id('12d002');

-- 1. OP-N155(b) : refund_request_insert_guard n'exclut QUE les superutilisateurs ----------------------------------------
CREATE FUNCTION pg_temp.paid_insert() RETURNS text LANGUAGE sql AS $$
  SELECT pg_temp.code(format($q$INSERT INTO refund_request (operator_id, ledger_id, event_id, wallet_id, status)
    VALUES (%L, %L, %L, %L, 'PAID')$q$, pg_temp.id('12a001'), pg_temp.id('12e001'), pg_temp.id('12e002'),
    pg_temp.id('12e003'))) $$;
-- Un rôle gardé reçoit CL057 ; un rôle exclu passerait la garde et échouerait plus tard (NOT NULL, clé étrangère).
SET LOCAL ROLE cashless_app;
SELECT is(pg_temp.paid_insert(), 'CL057', 'OP-N155b : cashless_app est gardé (insertion en PAID refusée, CL057)');
RESET ROLE;
CREATE ROLE t12_member LOGIN NOSUPERUSER NOINHERIT NOCREATEROLE NOCREATEDB NOBYPASSRLS;
CREATE ROLE t12_nested LOGIN NOSUPERUSER NOINHERIT NOCREATEROLE NOCREATEDB NOBYPASSRLS;
CREATE ROLE t12_owner  LOGIN NOSUPERUSER NOINHERIT NOCREATEROLE NOCREATEDB NOBYPASSRLS;
GRANT cashless_app TO t12_member;       -- membre direct, sans héritage de droits
GRANT t12_member TO t12_nested;         -- membre indirect
GRANT cashless_app TO t12_owner;
GRANT INSERT ON refund_request TO t12_member, t12_nested;   -- dans la transaction seulement (ROLLBACK final)
SET LOCAL ROLE t12_member;
SELECT is(pg_temp.paid_insert(), 'CL057', 'OP-N155b : un membre non super (NOINHERIT) de cashless_app est gardé');
RESET ROLE;
SET LOCAL ROLE t12_nested;
SELECT is(pg_temp.paid_insert(), 'CL057', 'OP-N155b : un membre indirect non super est gardé');
RESET ROLE;
-- Propriétaire non super de la table (membre de cashless_app) : l'exclusion ne doit pas s'élargir au propriétaire.
ALTER TABLE refund_request OWNER TO t12_owner;
SET LOCAL ROLE t12_owner;
SELECT is(pg_temp.paid_insert(), 'CL057', 'OP-N155b : le propriétaire non super de la table est gardé');
RESET ROLE;
ALTER TABLE refund_request OWNER TO postgres;
-- Le propriétaire réel (superutilisateur) reste exclu : c'est la seule exclusion.
SELECT is((SELECT rolsuper FROM pg_roles WHERE oid = (SELECT relowner FROM pg_class WHERE relname = 'refund_request')),
  true, 'OP-N155b : le propriétaire de refund_request est superutilisateur (fixtures)');
SELECT isnt(pg_temp.paid_insert(), 'CL057', 'OP-N155b : le superutilisateur passe la garde (seule exclusion)');
-- Aucun rôle non super, hors cashless_app, n'a INSERT sur refund_request (table ou colonne), PUBLIC compris. Les rôles
-- de processus (cashless_platform, cashless_pin, ...) ne sont pas membres de cashless_app : la garde ne les vise pas,
-- seul l'absence de droit les arrête (limite figée ici ; la garde ne couvre que les membres de cashless_app).
SELECT is((SELECT array_agg(rolname::text ORDER BY rolname) FROM pg_roles
            WHERE NOT rolsuper AND rolname NOT LIKE 't12\_%' AND rolname NOT LIKE 'pg\_%'
              AND (has_table_privilege(oid, 'refund_request', 'INSERT')
                   OR has_any_column_privilege(oid, 'refund_request', 'INSERT'))),
  ARRAY['cashless_app'], 'OP-N155b : seul cashless_app (non super) a INSERT sur refund_request');
SELECT is((SELECT count(*)::int FROM aclexplode((SELECT relacl FROM pg_class WHERE relname = 'refund_request')) a
            WHERE a.grantee = 0 AND a.privilege_type = 'INSERT'), 0, 'OP-N155b : PUBLIC sans INSERT sur refund_request');
SELECT is((SELECT array_agg(m.rolname::text ORDER BY m.rolname) FROM pg_auth_members am
             JOIN pg_roles r ON r.oid = am.roleid JOIN pg_roles m ON m.oid = am.member
            WHERE r.rolname = 'cashless_app' AND m.rolname NOT LIKE 't12\_%'), NULL,
  'OP-N155b : aucun membre de cashless_app en base (un nouveau membre serait gardé, à examiner)');
-- Le texte de la garde : une seule exclusion de rôle (rolsuper), ni propriétaire ni nom.
SELECT is((SELECT prosecdef FROM pg_proc WHERE proname = 'refund_request_insert_guard'), false,
  'OP-N155b : la garde n''est pas SECURITY DEFINER (current_user est le rôle de la session)');
SELECT is((SELECT (length(prosrc) - length(replace(prosrc, 'rolsuper', ''))) / 8 FROM pg_proc
            WHERE proname = 'refund_request_insert_guard'), 1, 'OP-N155b : la garde cite rolsuper une fois');
SELECT is((SELECT (length(prosrc) - length(replace(prosrc, 'rolname', ''))) / 7 FROM pg_proc
            WHERE proname = 'refund_request_insert_guard'), 2,
  'OP-N155b : la garde ne nomme que cashless_app et current_user (aucun rôle nommé en exclusion)');
SELECT is((SELECT count(*)::int FROM pg_proc WHERE proname = 'refund_request_insert_guard'
            AND (prosrc ~* 'relowner|session_user|pg_class|usesuper')), 0,
  'OP-N155b : la garde ne regarde ni le propriétaire ni session_user');

-- 2. OP-N157 : surface exacte de cashless_pin -----------------------------------------------------------------------------
-- Droits de table (tout objet relation, tout privilège) : audit_log SELECT, INSERT ; audit_log_id_seq USAGE, SELECT.
SELECT is((SELECT array_agg(c.relname || ':' || p ORDER BY c.relname, p) FROM pg_class c
            CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
            WHERE c.relkind IN ('r','p','v','m','f') AND c.relnamespace NOT IN ('pg_catalog'::regnamespace,
              'information_schema'::regnamespace) AND NOT EXISTS (SELECT 1 FROM pg_depend e WHERE e.classid = 'pg_class'::regclass AND e.objid = c.oid AND e.deptype = 'e') AND c.relname NOT LIKE '\_\_t%'
              AND has_table_privilege('cashless_pin', c.oid, p)),
  ARRAY['audit_log:INSERT', 'audit_log:SELECT'], 'OP-N157 : droits de table de cashless_pin : audit_log SELECT et INSERT, rien d''autre');
SELECT is((SELECT array_agg(c.relname || ':' || p ORDER BY c.relname, p) FROM pg_class c
            CROSS JOIN unnest(ARRAY['USAGE','SELECT','UPDATE']) p
            WHERE c.relkind = 'S' AND NOT EXISTS (SELECT 1 FROM pg_depend e WHERE e.classid = 'pg_class'::regclass AND e.objid = c.oid AND e.deptype = 'e') AND c.relname NOT LIKE '\_\_t%' AND has_sequence_privilege('cashless_pin', c.oid, p)),
  ARRAY['audit_log_id_seq:SELECT', 'audit_log_id_seq:USAGE'], 'OP-N157 : séquences de cashless_pin : audit_log_id_seq USAGE et SELECT seulement');
-- Droits de colonne (y compris ceux qu'un droit de table ne donnerait pas) : INSERT et SELECT sur toutes les colonnes
-- d'audit_log, jamais UPDATE ni REFERENCES, rien sur aucune autre table.
SELECT is((SELECT array_agg(DISTINCT c.relname || ':' || p ORDER BY c.relname || ':' || p) FROM pg_attribute a
            JOIN pg_class c ON c.oid = a.attrelid CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','REFERENCES']) p
            WHERE a.attnum > 0 AND NOT a.attisdropped AND c.relkind IN ('r','p','v','m','f')
              AND c.relnamespace NOT IN ('pg_catalog'::regnamespace, 'information_schema'::regnamespace) AND NOT EXISTS (SELECT 1 FROM pg_depend e WHERE e.classid = 'pg_class'::regclass AND e.objid = c.oid AND e.deptype = 'e') AND c.relname NOT LIKE '\_\_t%'
              AND has_column_privilege('cashless_pin', c.oid, a.attnum, p)),
  ARRAY['audit_log:INSERT', 'audit_log:SELECT'], 'OP-N157 : droits de colonne de cashless_pin : INSERT et SELECT sur audit_log seulement');
SELECT is((SELECT count(*)::int FROM information_schema.column_privileges WHERE grantee = 'cashless_pin'),
  2 * (SELECT count(*)::int FROM pg_attribute WHERE attrelid = 'audit_log'::regclass AND attnum > 0 AND NOT attisdropped),
  'OP-N157 : cashless_pin a SELECT et INSERT sur chacune des colonnes d''audit_log, pas une de plus');
-- EXECUTE : tout schéma sauf les systèmes ; extensions exclues (pgtap, accordée à PUBLIC par _grants_for_tests).
SELECT is((SELECT array_agg(p.oid::regprocedure::text ORDER BY p.oid::regprocedure::text) FROM pg_proc p
            WHERE p.pronamespace NOT IN ('pg_catalog'::regnamespace, 'information_schema'::regnamespace)
              AND NOT EXISTS (SELECT 1 FROM pg_depend e WHERE e.classid = 'pg_proc'::regclass AND e.objid = p.oid
                                 AND e.deptype = 'e')
              AND p.pronamespace::regnamespace::text NOT LIKE 'pg\_temp%'
              AND has_function_privilege('cashless_pin', p.oid, 'EXECUTE')),
  ARRAY['begin_vendor_pin_check(uuid,uuid)', 'open_vendor_session(uuid,uuid)'],
  'OP-N157 : EXECUTE de cashless_pin : begin_vendor_pin_check et open_vendor_session seulement');
SELECT is((SELECT array_agg(n.nspname::text || ':' || p ORDER BY n.nspname, p) FROM pg_namespace n
            CROSS JOIN unnest(ARRAY['USAGE','CREATE']) p
            WHERE n.nspname NOT LIKE 'pg\_%' AND n.nspname <> 'information_schema'
              AND has_schema_privilege('cashless_pin', n.oid, p)),
  ARRAY['public:USAGE'], 'OP-N157 : schémas : USAGE sur public, aucun CREATE');
SELECT is((SELECT array_agg(p ORDER BY p) FROM unnest(ARRAY['CONNECT','CREATE','TEMPORARY']) p
            WHERE has_database_privilege('cashless_pin', current_database(), p)),
  ARRAY['CONNECT'], 'OP-N157 : base : CONNECT seulement (ni CREATE ni TEMPORARY)');
-- RLS : audit_log force la RLS ; politiques qui visent cashless_pin = celles de PUBLIC, nommées une à une.
SELECT is((SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = 'audit_log'::regclass), true,
  'OP-N157 : audit_log : RLS activée et forcée');
SELECT is((SELECT array_agg(polname::text || ':' || polcmd::text || ':' || polpermissive::text ORDER BY polname) FROM pg_policy
            WHERE polrelid = 'audit_log'::regclass AND (0::oid = ANY (polroles)
                  OR 'cashless_pin'::regrole::oid = ANY (polroles))),
  ARRAY['snapshot_signing_key_audit_writer:a:false', 'tenant_isolation:*:true'],
  'OP-N157 : politiques d''audit_log qui visent cashless_pin : tenant_isolation (PUBLIC) et la restrictive des clés de signature');
SELECT is((SELECT count(*)::int FROM pg_policy WHERE 'cashless_pin'::regrole::oid = ANY (polroles)), 0,
  'OP-N157 : aucune politique ne nomme cashless_pin (aucune politique propre, donc aucune restriction VENDOR_* : OP-N157)');
SELECT is((SELECT pg_get_expr(polqual, polrelid) || ' / ' || pg_get_expr(polwithcheck, polrelid) FROM pg_policy
            WHERE polrelid = 'audit_log'::regclass AND polname = 'tenant_isolation'),
  '(operator_id = (current_setting(''app.operator_id''::text, true))::uuid) / (operator_id = (current_setting(''app.operator_id''::text, true))::uuid)',
  'OP-N157 : tenant_isolation borne par le prestataire de session (USING et WITH CHECK)');
-- Comportement sous le rôle.
SET LOCAL ROLE cashless_pin;
SELECT pg_temp.a('12a001');
SELECT is(pg_temp.code(format($q$INSERT INTO audit_log (operator_id, action, object_type, object_id, origin)
  VALUES (%L, 'VENDOR_PIN_FAILED', 'vendor', 'x', 'test')$q$, pg_temp.id('12a001'))), NULL,
  'OP-N157 : INSERT audit_log pour le prestataire de session accepté');
SELECT is(pg_temp.code(format($q$INSERT INTO audit_log (operator_id, action, object_type, object_id, origin)
  VALUES (%L, 'VENDOR_PIN_FAILED', 'vendor', 'x', 'test')$q$, pg_temp.id('12a002'))), '42501',
  'OP-N157 : INSERT audit_log pour un AUTRE prestataire refusé (RLS)');
SELECT is(pg_temp.code($q$INSERT INTO audit_log (operator_id, action, object_type, object_id, origin)
  VALUES (NULL, 'VENDOR_PIN_FAILED', 'vendor', 'x', 'test')$q$), '42501',
  'OP-N157 : INSERT audit_log sans prestataire (plateforme) refusé (RLS)');
SELECT is(pg_temp.code(format($q$INSERT INTO audit_log (operator_id, action, object_type, object_id, origin)
  VALUES (%L, 'SNAPSHOT_SIGNING_KEY_X', 'k', 'x', 'test')$q$, pg_temp.id('12a001'))), '42501',
  'OP-N157 : INSERT d''une action de clé de signature refusé (politique restrictive)');
-- Limite acceptée, figée : aucune politique ne restreint aux actions VENDOR_* (échoue le jour où elle est ajoutée).
SELECT is(pg_temp.code(format($q$INSERT INTO audit_log (operator_id, action, object_type, object_id, origin)
  VALUES (%L, 'AUTRE_ACTION', 'x', 'x', 'test')$q$, pg_temp.id('12a001'))), NULL,
  'OP-N157 : limite actuelle : une action autre que VENDOR_* passe pour le prestataire de session');
RESET ROLE;

-- 3. OP-N8 : cashless_pin, aucun pouvoir d'administration (le mot de passe n'est pas testable en base de test) ------------
SELECT is((SELECT ARRAY[rolcanlogin, rolsuper, rolcreaterole, rolcreatedb, rolbypassrls, rolreplication]
             FROM pg_roles WHERE rolname = 'cashless_pin'), ARRAY[true, false, false, false, false, false],
  'OP-N8 : cashless_pin : rolcanlogin, et ni rolsuper, rolcreaterole, rolcreatedb, rolbypassrls ni rolreplication');
SELECT is((SELECT count(*)::int FROM pg_auth_members am JOIN pg_roles m ON m.oid = am.member
            WHERE m.rolname = 'cashless_pin'), 0, 'OP-N8 : cashless_pin n''est membre d''aucun rôle');

-- 4. OP-N152 : bornes d'advance_app_attest_counter -----------------------------------------------------------------------
SELECT is((SELECT array_agg(rolname::text ORDER BY rolname) FROM pg_roles
            WHERE NOT rolsuper AND rolname NOT LIKE 't12\_%'
              AND has_function_privilege(oid, 'advance_app_attest_counter(uuid,bytea,bigint)'::regprocedure, 'EXECUTE')),
  ARRAY['cashless_app'], 'OP-N152 : seul cashless_app (non super) exécute advance_app_attest_counter');
SELECT is((SELECT count(*)::int FROM aclexplode((SELECT proacl FROM pg_proc
            WHERE oid = 'advance_app_attest_counter(uuid,bytea,bigint)'::regprocedure)) a WHERE a.grantee = 0), 0,
  'OP-N152 : PUBLIC sans EXECUTE sur advance_app_attest_counter');
SELECT is((SELECT ARRAY[prosecdef::text, array_to_string(proconfig, ',')] FROM pg_proc
            WHERE oid = 'advance_app_attest_counter(uuid,bytea,bigint)'::regprocedure),
  ARRAY['true', 'search_path=public, pg_temp'], 'OP-N152 : advance_app_attest_counter : SECURITY DEFINER, search_path fixé');
SET LOCAL ROLE cashless_app;
SELECT pg_temp.a('12a001');
SELECT is(advance_app_attest_counter(pg_temp.id('12d001'), sha256('k1'), 5), false, 'OP-N152 : compteur égal refusé (strictement croissant)');
SELECT is(advance_app_attest_counter(pg_temp.id('12d001'), sha256('k1'), 4), false, 'OP-N152 : compteur en recul refusé');
SELECT is(advance_app_attest_counter(pg_temp.id('12d001'), sha256('autre'), 9), false, 'OP-N152 : mauvaise clé : refusé');
SELECT is((SELECT counter FROM device_app_attest_key WHERE device_id = pg_temp.id('12d001')), 5::bigint,
  'OP-N152 : le compteur n''a ni reculé ni bougé après les refus');
SELECT is(advance_app_attest_counter(pg_temp.id('12d001'), sha256('k1'), 6), true, 'OP-N152 : compteur supérieur accepté');
SELECT is(advance_app_attest_counter(pg_temp.id('12d001'), sha256('k1'), 6), false, 'OP-N152 : rejeu du même compteur refusé');
SELECT is((SELECT counter FROM device_app_attest_key WHERE device_id = pg_temp.id('12d001')), 6::bigint,
  'OP-N152 : le compteur vaut 6');
SELECT is(pg_temp.code(format('SELECT advance_app_attest_counter(%L, sha256(''k2''), 99)', pg_temp.id('12d002'))), 'CL059',
  'OP-N152 : appareil REVOKED : CL059');
SELECT is(pg_temp.code(format('SELECT advance_app_attest_counter(%L, sha256(''k3''), 99)', pg_temp.id('12d003'))), 'CL059',
  'OP-N152 : appareil d''un autre prestataire : CL059');
SELECT is(pg_temp.code(format('SELECT advance_app_attest_counter(%L, sha256(''k1''), 4294967296)', pg_temp.id('12d001'))),
  'CL059', 'OP-N152 : compteur hors plage : CL059');
SELECT set_config('app.operator_id', '', true);
SELECT is(pg_temp.code(format('SELECT advance_app_attest_counter(%L, sha256(''k1''), 99)', pg_temp.id('12d001'))), 'CL059',
  'OP-N152 : sans prestataire de session : CL059');
RESET ROLE;
SELECT is((SELECT array_agg(counter ORDER BY device_id) FROM device_app_attest_key),
  ARRAY[6, 5, 5]::bigint[], 'OP-N152 : seul le compteur de l''appareil actif du prestataire a avancé');

SELECT * FROM finish();
ROLLBACK;
