-- Vendeurs, essais de PIN, sessions de vendeur et set_device_status remplacée (migration 0031 ;
-- mission terminaux-paiement-en-ligne, lot WP02) — pgTAP, écrit à la main (pas un fichier généré).
-- Lancer : pg_prove -d <base> tests/tests_vendors.sql (base créée par les migrations, roles.sql et
-- post-roles.sql rejoués).
-- Une seule session : la concurrence réelle (5e PIN faux pendant une vente, suspension pendant une
-- vente) est prouvée par les tests d'intégration de l'API (lots WP09, WP14). Les droits de
-- cashless_app (accords, retraits de colonnes, vue) sont testés par le lot WP07.
\set ON_ERROR_STOP 1
\set QUIET 1
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

-- Identifiants : pg_temp.id('31a001') = '00000000-0000-0000-0000-00000031a001'.
CREATE FUNCTION pg_temp.id(p text) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT ('00000000-0000-0000-0000-' || lpad(p, 12, '0'))::uuid $$;
-- Empreinte PHC argon2id de test (la base ne vérifie que le format).
CREATE FUNCTION pg_temp.ph(p text) RETURNS text LANGUAGE sql IMMUTABLE AS
  $$ SELECT '$argon2id$v=19$m=19456,t=2,p=1$c2VsMDAzMQ$' || encode(convert_to(p, 'UTF8'),
    'base64') $$;

-- Données (propriétaire) ------------------------------------------------------------------------
-- A : organisateur b001, événement d001, commerçants M1 (b101, point de vente f101) et M2 (b102,
-- point de vente f102). B : organisateur b011, événement d011, commerçant MB (b111, point de
-- vente f111).
INSERT INTO party (kind, legal_name) SELECT 'PLATFORM', 'Plateforme (test)'
 WHERE NOT EXISTS (SELECT 1 FROM party WHERE kind = 'PLATFORM');
INSERT INTO party (id, kind, legal_name, country_code) VALUES
 (pg_temp.id('31a001'), 'OPERATOR', 'Prestataire A', 'SN'),
 (pg_temp.id('31a002'), 'OPERATOR', 'Prestataire B', 'CI');
INSERT INTO party (id, kind, operator_id, legal_name) VALUES
 (pg_temp.id('31b001'), 'ORGANIZER', pg_temp.id('31a001'), 'Organisateur A'),
 (pg_temp.id('31b011'), 'ORGANIZER', pg_temp.id('31a002'), 'Organisateur B'),
 (pg_temp.id('31b101'), 'MERCHANT', pg_temp.id('31a001'), 'Commerçant M1'),
 (pg_temp.id('31b102'), 'MERCHANT', pg_temp.id('31a001'), 'Commerçant M2'),
 (pg_temp.id('31b111'), 'MERCHANT', pg_temp.id('31a002'), 'Commerçant MB');
INSERT INTO jurisdiction_profile (id, country_code, version, valid_from, breakage_destination)
VALUES (pg_temp.id('31c001'), 'SN', 310031, '2026-01-01', 'ORGANIZER');
INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone, jurisdiction_id,
                   funds_holder) VALUES
 (pg_temp.id('31d001'), pg_temp.id('31a001'), pg_temp.id('31b001'), 'Événement A', 'XOF',
  'Africa/Dakar', pg_temp.id('31c001'), 'ORGANIZER'),
 (pg_temp.id('31d011'), pg_temp.id('31a002'), pg_temp.id('31b011'), 'Événement B', 'XOF',
  'Africa/Dakar', pg_temp.id('31c001'), 'ORGANIZER');
INSERT INTO merchant_participation (id, operator_id, event_id, merchant_id, link_type,
                                    payout_to) VALUES
 (pg_temp.id('31f001'), pg_temp.id('31a001'), pg_temp.id('31d001'), pg_temp.id('31b101'),
  'INTERNAL', pg_temp.id('31b001')),
 (pg_temp.id('31f002'), pg_temp.id('31a001'), pg_temp.id('31d001'), pg_temp.id('31b102'),
  'INTERNAL', pg_temp.id('31b001')),
 (pg_temp.id('31f011'), pg_temp.id('31a002'), pg_temp.id('31d011'), pg_temp.id('31b111'),
  'INTERNAL', pg_temp.id('31b011'));
INSERT INTO point_of_sale (id, operator_id, participation_id, name) VALUES
 (pg_temp.id('31f101'), pg_temp.id('31a001'), pg_temp.id('31f001'), 'Bar M1'),
 (pg_temp.id('31f102'), pg_temp.id('31a001'), pg_temp.id('31f002'), 'Bar M2'),
 (pg_temp.id('31f111'), pg_temp.id('31a002'), pg_temp.id('31f011'), 'Bar MB');
-- Personnes : e001 OPERATOR_ADMIN de A ; e002 MERCHANT_ADMIN de M1 ; e003 MERCHANT_ADMIN de M2 ;
-- e004 de A sans rôle ; e011 OPERATOR_ADMIN de B ; e012 MERCHANT_ADMIN de MB.
INSERT INTO app_user (id, operator_id, issuer, subject, email, display_name)
SELECT pg_temp.id(u), pg_temp.id(o), 'https://idp.test', 's0031' || u, u || '@test',
       'Personne ' || u
  FROM (VALUES ('31e001', '31a001'), ('31e002', '31a001'), ('31e003', '31a001'),
               ('31e004', '31a001'), ('31e011', '31a002'), ('31e012', '31a002')) AS v(u, o);
INSERT INTO role_assignment (user_id, role, scope_type, scope_id, granted_by) VALUES
 (pg_temp.id('31e001'), 'OPERATOR_ADMIN', 'OPERATOR', pg_temp.id('31a001'), NULL),
 (pg_temp.id('31e002'), 'MERCHANT_ADMIN', 'MERCHANT', pg_temp.id('31b101'), NULL),
 (pg_temp.id('31e003'), 'MERCHANT_ADMIN', 'MERCHANT', pg_temp.id('31b102'), NULL),
 (pg_temp.id('31e011'), 'OPERATOR_ADMIN', 'OPERATOR', pg_temp.id('31a002'), NULL),
 (pg_temp.id('31e012'), 'MERCHANT_ADMIN', 'MERCHANT', pg_temp.id('31b111'), NULL);
-- Terminaux de A : aa01 caisse catalogue de M1 ; aa02 TPE à clavier de M1 ; aa03 caisse de M2 ;
-- aa04 caisse de recharge (point de vente de M1) ; aa05 caisse sans point de vente ; aa06 et aa07
-- caisses de M1 (statut du terminal) ; aa08 caisse de M1 (verrous). B : ab01 caisse de MB.
INSERT INTO device (id, operator_id, kind, app_mode, event_id, pos_id, serial) VALUES
 (pg_temp.id('31aa01'), pg_temp.id('31a001'), 'POS', 'CATALOG_POS', pg_temp.id('31d001'),
  pg_temp.id('31f101'), 'V31-AA01'),
 (pg_temp.id('31aa02'), pg_temp.id('31a001'), 'POS', 'KEYPAD_TPE', pg_temp.id('31d001'),
  pg_temp.id('31f101'), 'V31-AA02'),
 (pg_temp.id('31aa03'), pg_temp.id('31a001'), 'POS', 'CATALOG_POS', pg_temp.id('31d001'),
  pg_temp.id('31f102'), 'V31-AA03'),
 (pg_temp.id('31aa04'), pg_temp.id('31a001'), 'TOPUP', 'TOPUP_DESK', pg_temp.id('31d001'),
  pg_temp.id('31f101'), 'V31-AA04'),
 (pg_temp.id('31aa05'), pg_temp.id('31a001'), 'POS', 'CATALOG_POS', pg_temp.id('31d001'), NULL,
  'V31-AA05'),
 (pg_temp.id('31aa06'), pg_temp.id('31a001'), 'POS', 'CATALOG_POS', pg_temp.id('31d001'),
  pg_temp.id('31f101'), 'V31-AA06'),
 (pg_temp.id('31aa07'), pg_temp.id('31a001'), 'POS', 'CATALOG_POS', pg_temp.id('31d001'),
  pg_temp.id('31f101'), 'V31-AA07'),
 (pg_temp.id('31aa08'), pg_temp.id('31a001'), 'POS', 'CATALOG_POS', pg_temp.id('31d001'),
  pg_temp.id('31f101'), 'V31-AA08'),
 (pg_temp.id('31ab01'), pg_temp.id('31a002'), 'POS', 'CATALOG_POS', pg_temp.id('31d011'),
  pg_temp.id('31f111'), 'V31-AB01');

-- Sessions : prestataire A, B, ou aucun.
CREATE FUNCTION pg_temp.a() RETURNS void LANGUAGE sql AS
  $$ SELECT set_config('app.operator_id', pg_temp.id('31a001')::text, true) $$;
CREATE FUNCTION pg_temp.b() RETURNS void LANGUAGE sql AS
  $$ SELECT set_config('app.operator_id', pg_temp.id('31a002')::text, true) $$;
CREATE FUNCTION pg_temp.none() RETURNS void LANGUAGE sql AS
  $$ SELECT set_config('app.operator_id', '', true) $$;
-- Vendeur par son nom (lu par le propriétaire).
CREATE FUNCTION pg_temp.v(p_name text) RETURNS uuid LANGUAGE sql AS
  $$ SELECT id FROM vendor WHERE display_name = p_name $$;
CREATE FUNCTION pg_temp.attempts(p_name text) RETURNS int LANGUAGE sql AS
  $$ SELECT failed_attempts FROM vendor WHERE display_name = p_name $$;
CREATE FUNCTION pg_temp.is_locked(p_name text) RETURNS boolean LANGUAGE sql AS
  $$ SELECT locked_at IS NOT NULL FROM vendor WHERE display_name = p_name $$;
-- Essai compté (transaction A) : identifiant du check, NULL si zéro ligne.
CREATE FUNCTION pg_temp.chk(p_name text, p_device text) RETURNS uuid LANGUAGE sql AS
  $$ SELECT check_id FROM begin_vendor_pin_check(pg_temp.v(p_name), pg_temp.id(p_device)) $$;
-- Nombre de lignes rendues par begin_vendor_pin_check.
CREATE FUNCTION pg_temp.rows(p_vendor uuid, p_device text) RETURNS int LANGUAGE sql AS
  $$ SELECT count(*)::int FROM begin_vendor_pin_check(p_vendor, pg_temp.id(p_device)) $$;
-- Essai puis ouverture (PIN bon) : identifiant de la session ouverte.
CREATE FUNCTION pg_temp.login(p_name text, p_device text) RETURNS uuid LANGUAGE sql AS $$
  SELECT vendor_session_id FROM open_vendor_session(pg_temp.chk(p_name, p_device),
    pg_temp.id(p_device))
$$;
-- Session ouverte d'un terminal, et motif de fermeture d'une session.
CREATE FUNCTION pg_temp.open_session(p_device text) RETURNS uuid LANGUAGE sql AS
  $$ SELECT id FROM vendor_session WHERE device_id = pg_temp.id(p_device) AND closed_at IS NULL $$;
CREATE FUNCTION pg_temp.reason(p_session uuid) RETURNS text LANGUAGE sql AS
  $$ SELECT closed_reason FROM vendor_session WHERE id = p_session $$;
CREATE FUNCTION pg_temp.checks() RETURNS int LANGUAGE sql AS
  $$ SELECT count(*)::int FROM vendor_pin_check $$;
-- Verrous de table tenus par cette session sur une relation.
CREATE FUNCTION pg_temp.locks(p_rel regclass) RETURNS text[] LANGUAGE sql AS $$
  SELECT coalesce(array_agg(DISTINCT mode ORDER BY mode), '{}') FROM pg_locks
   WHERE pid = pg_backend_pid() AND locktype = 'relation' AND relation = p_rel AND granted
$$;

-- 1. Structure et droits ------------------------------------------------------------------------
SELECT has_table('vendor');
SELECT has_table('vendor_pin_check');
SELECT has_table('vendor_session');
SELECT has_view('vendor_public');
SELECT is((SELECT count(*)::int FROM pg_proc
            WHERE proname IN ('vendor_admin_allowed', 'create_vendor', 'set_vendor_pin',
                              'set_vendor_status', 'begin_vendor_pin_check', 'open_vendor_session',
                              'close_vendor_session', 'assert_vendor_session', 'set_device_status',
                              'purge_device_enrollment_attempts')
              AND prosecdef AND proconfig @> ARRAY['search_path=public, pg_temp']), 10,
  'dix fonctions SECURITY DEFINER, search_path public, pg_temp (dont les deux remplacées)');
DROP ROLE IF EXISTS vendor_probe_0031;
CREATE ROLE vendor_probe_0031;
SELECT is((SELECT count(*)::int
             FROM unnest(ARRAY['vendor_admin_allowed(uuid,uuid,uuid)',
                               'create_vendor(uuid,text,text,uuid)',
                               'set_vendor_pin(uuid,text,uuid)',
                               'set_vendor_status(uuid,text,uuid)',
                               'begin_vendor_pin_check(uuid,uuid)',
                               'open_vendor_session(uuid,uuid)',
                               'close_vendor_session(uuid)',
                               'assert_vendor_session(uuid,uuid)',
                               'set_device_status(uuid,text,text,uuid)',
                               'purge_device_enrollment_attempts()']) f
            WHERE has_function_privilege('vendor_probe_0031', f, 'EXECUTE')), 0,
  'aucune des dix fonctions n''est exécutable par PUBLIC');
SELECT ok(NOT has_table_privilege('vendor_probe_0031', 'vendor_public', 'SELECT'),
  'vendor_public : aucune lecture pour PUBLIC');
SELECT is((SELECT count(*)::int FROM pg_class
            WHERE relname IN ('vendor', 'vendor_pin_check', 'vendor_session')
              AND relkind = 'r' AND relrowsecurity AND relforcerowsecurity), 3,
  'RLS activée et forcée sur les trois tables');
SELECT is((SELECT count(*)::int FROM pg_policies
            WHERE tablename IN ('vendor', 'vendor_pin_check', 'vendor_session')
              AND policyname = 'tenant_isolation' AND qual LIKE '%app.operator_id%'
              AND with_check LIKE '%app.operator_id%'), 3,
  'politique tenant_isolation (USING et WITH CHECK) sur les trois tables');
SELECT ok((SELECT reloptions @> ARRAY['security_barrier=true'] FROM pg_class WHERE relname =
  'vendor_public'),
  'vendor_public : security_barrier');
SELECT ok((SELECT NOT coalesce(reloptions @> ARRAY['security_invoker=true'], false)
             FROM pg_class WHERE relname = 'vendor_public'),
  'vendor_public : exécutée avec les droits du propriétaire (pas security_invoker)');
SELECT is((SELECT array_agg(attname::text ORDER BY attnum) FROM pg_attribute
            WHERE attrelid = 'vendor_public'::regclass AND attnum > 0 AND NOT attisdropped),
  ARRAY['id', 'operator_id', 'merchant_id', 'display_name', 'status', 'locked'],
  'vendor_public : ni pin_hash, ni failed_attempts, ni locked_at');
SELECT ok(EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'vendor_session_open_per_device'
                     AND indexdef LIKE '%UNIQUE%' AND indexdef LIKE '%closed_at IS NULL%'),
  'index unique partiel : une session ouverte par terminal');

-- 2. create_vendor --------------------------------------------------------------------------------
SELECT pg_temp.a();
SELECT isnt(create_vendor(pg_temp.id('31b101'), '  Awa  ', pg_temp.ph('awa'), pg_temp.id('31e002')),
  NULL, 'create_vendor : MERCHANT_ADMIN du commerçant');
SELECT is((SELECT display_name || '|' || status || '|' || failed_attempts || '|'
                  || (locked_at IS NULL) || '|' || created_by
             FROM vendor WHERE id = pg_temp.v('Awa')),
  'Awa|ACTIVE|0|true|' || pg_temp.id('31e002'),
  'create_vendor : nom sans blancs de bord, ACTIVE, compteur 0, non bloqué, auteur');
SELECT isnt(create_vendor(pg_temp.id('31b101'), 'Binta', pg_temp.ph('binta'), pg_temp.id('31e001')),
  NULL, 'create_vendor : OPERATOR_ADMIN du prestataire');
SELECT isnt(create_vendor(pg_temp.id('31b102'), 'Coumba', pg_temp.ph('coumba'),
  pg_temp.id('31e003')),
  NULL, 'create_vendor : MERCHANT_ADMIN de M2 pour M2');
SELECT create_vendor(pg_temp.id('31b101'), n, pg_temp.ph(n), pg_temp.id('31e002'))
  FROM unnest(ARRAY['Diarra', 'Fatou', 'Gora', 'Habib', 'Ibou', 'Lock']) n;
SELECT throws_ok($$SELECT create_vendor(pg_temp.id('31b101'), 'X', pg_temp.ph('x'),
  pg_temp.id('31e003'))$$,
  'P0002', NULL, 'create_vendor : MERCHANT_ADMIN d''un autre commerçant -> P0002');
SELECT throws_ok($$SELECT create_vendor(pg_temp.id('31b101'), 'X', pg_temp.ph('x'),
  pg_temp.id('31e004'))$$,
  'P0002', NULL, 'create_vendor : personne sans rôle -> P0002');
SELECT throws_ok($$SELECT create_vendor(pg_temp.id('31b101'), 'X', pg_temp.ph('x'), NULL)$$,
  'P0002', NULL, 'create_vendor : sans auteur -> P0002');
SELECT throws_ok($$SELECT create_vendor(pg_temp.id('31b111'), 'X', pg_temp.ph('x'),
  pg_temp.id('31e001'))$$,
  'P0002', NULL, 'create_vendor : commerçant d''un autre prestataire -> P0002');
SELECT throws_ok($$SELECT create_vendor(pg_temp.id('31b001'), 'X', pg_temp.ph('x'),
  pg_temp.id('31e001'))$$,
  'P0002', NULL, 'create_vendor : partie qui n''est pas un commerçant -> P0002');
SELECT throws_ok($$SELECT create_vendor(pg_temp.id('31b101'), '   ', pg_temp.ph('x'),
  pg_temp.id('31e002'))$$,
  'CL001', NULL, 'create_vendor : nom vide -> CL001');
SELECT throws_ok($$SELECT create_vendor(pg_temp.id('31b101'), repeat('n', 81), pg_temp.ph('x'),
                                        pg_temp.id('31e002'))$$,
  'CL001', NULL, 'create_vendor : nom de 81 caractères -> CL001');
SELECT throws_ok($$SELECT create_vendor(pg_temp.id('31b101'), 'X', '$2b$10$secretbcrypt',
  pg_temp.id('31e002'))$$,
  'CL001', 'Vendeur : empreinte du PIN invalide',
  'create_vendor : empreinte non PHC argon2id -> CL001, message sans l''empreinte');
SELECT throws_ok($$SELECT create_vendor(pg_temp.id('31b101'), 'X', pg_temp.ph(repeat('z', 200)),
                                        pg_temp.id('31e002'))$$,
  'CL001', NULL, 'create_vendor : empreinte de plus de 200 caractères -> CL001');
SELECT pg_temp.b();
SELECT throws_ok($$SELECT create_vendor(pg_temp.id('31b101'), 'X', pg_temp.ph('x'),
  pg_temp.id('31e011'))$$,
  'P0002', NULL, 'create_vendor : commerçant de A depuis une session de B -> P0002');
SELECT isnt(create_vendor(pg_temp.id('31b111'), 'Mbaye', pg_temp.ph('mbaye'), pg_temp.id('31e012')),
  NULL, 'create_vendor : vendeur de B');
SELECT pg_temp.none();
SELECT throws_ok($$SELECT create_vendor(pg_temp.id('31b101'), 'X', pg_temp.ph('x'),
  pg_temp.id('31e002'))$$,
  'P0002', NULL, 'create_vendor : sans prestataire de session -> P0002');

-- 3. Contraintes (propriétaire, écritures directes) -----------------------------------------------
SELECT throws_ok($$INSERT INTO vendor (operator_id, merchant_id, display_name, pin_hash, created_by)
                  VALUES (pg_temp.id('31a001'), pg_temp.id('31b101'), 'X', 'clair123',
                    pg_temp.id('31e002'))$$,
  '23514', NULL, 'vendor : empreinte non PHC refusée');
SELECT throws_ok($$INSERT INTO vendor (operator_id, merchant_id, display_name, pin_hash, created_by)
                  VALUES (pg_temp.id('31a001'), pg_temp.id('31b101'), '', pg_temp.ph('x'),
                    pg_temp.id('31e002'))$$,
  '23514', NULL, 'vendor : nom vide refusé');
SELECT throws_ok($$INSERT INTO vendor (operator_id, merchant_id, display_name, pin_hash, created_by)
                  VALUES (pg_temp.id('31a001'), pg_temp.id('31b101'), repeat('n', 81),
                    pg_temp.ph('x'),
                          pg_temp.id('31e002'))$$,
  '23514', NULL, 'vendor : nom de 81 caractères refusé');
SELECT throws_ok($$UPDATE vendor SET failed_attempts = 6,
  locked_at = now() WHERE id = pg_temp.v('Awa')$$,
  '23514', NULL, 'vendor : compteur 6 refusé');
SELECT throws_ok($$UPDATE vendor SET failed_attempts = 5 WHERE id = pg_temp.v('Awa')$$,
  '23514', NULL, 'vendor : compteur 5 sans locked_at refusé');
SELECT throws_ok($$UPDATE vendor SET locked_at = now() WHERE id = pg_temp.v('Awa')$$,
  '23514', NULL, 'vendor : locked_at sans compteur 5 refusé');
SELECT throws_ok($$UPDATE vendor SET status = 'LOCKED' WHERE id = pg_temp.v('Awa')$$,
  '23514', NULL, 'vendor : statut inconnu refusé');
SELECT throws_ok($$INSERT INTO vendor_pin_check (operator_id, vendor_id, device_id, created_at,
  expires_at)
                  VALUES (pg_temp.id('31a001'), pg_temp.v('Awa'), pg_temp.id('31aa01'), now(),
                          now() + interval '31 seconds')$$,
  '23514', NULL, 'vendor_pin_check : durée autre que 30 s refusée');
SELECT throws_ok($$INSERT INTO vendor_session (operator_id, vendor_id, device_id, opened_at,
  expires_at)
                  VALUES (pg_temp.id('31a001'), pg_temp.v('Awa'), pg_temp.id('31aa01'), now(),
                          now() + interval '13 hours')$$,
  '23514', NULL, 'vendor_session : durée autre que 12 h refusée');
SELECT throws_ok($$INSERT INTO vendor_session (operator_id, vendor_id, device_id, opened_at,
  expires_at,
                                               closed_reason)
                  VALUES (pg_temp.id('31a001'), pg_temp.v('Awa'), pg_temp.id('31aa01'), now(),
                          now() + interval '12 hours', 'LOGOUT')$$,
  '23514', NULL, 'vendor_session : motif sans closed_at refusé');
SELECT throws_ok($$INSERT INTO vendor_session (operator_id, vendor_id, device_id, opened_at,
  expires_at,
                                               closed_at, closed_reason)
                  VALUES (pg_temp.id('31a001'), pg_temp.v('Awa'), pg_temp.id('31aa01'), now(),
                          now() + interval '12 hours', now(), 'EXPIRED')$$,
  '23514', NULL, 'vendor_session : motif de fermeture inconnu refusé');
SELECT throws_ok($$INSERT INTO vendor_session (operator_id, vendor_id, device_id, opened_at,
  expires_at)
                  VALUES (pg_temp.id('31a001'), pg_temp.v('Awa'), pg_temp.id('31aa07'), now(),
                          now() + interval '12 hours'),
                         (pg_temp.id('31a001'), pg_temp.v('Binta'), pg_temp.id('31aa07'), now(),
                          now() + interval '12 hours')$$,
  '23505', NULL,
    'vendor_session : deuxième session ouverte sur un terminal refusée (index unique)');

-- 4. Ordre des verrous de begin_vendor_pin_check --------------------------------------------------
-- Premier appel touchant terminal et vendeur dans la transaction : avant lui, aucun verrou de ligne
-- (RowShareLock) sur device ni sur vendor. Après : RowShareLock sur device (FOR SHARE, sans
-- écriture), RowShareLock et RowExclusiveLock sur vendor (FOR UPDATE puis mise à jour du compteur).
-- pg_locks ne montre que les verrous de table ; le mode de verrou de la ligne du terminal est lu
-- par pgrowlocks quand l'extension est disponible.
SELECT pg_temp.a();
SELECT ok(NOT ('RowShareLock' = ANY (pg_temp.locks('device'))) AND NOT ('RowShareLock' = ANY
  (pg_temp.locks('vendor'))),
  'verrous : aucun verrou de ligne sur device ni vendor avant le premier essai');
SELECT is(pg_temp.rows(pg_temp.v('Ibou'), '31aa08'), 1, 'verrous : premier essai compté');
SELECT ok('RowShareLock' = ANY (pg_temp.locks('device')),
  'verrous : terminal pris en partage (RowShareLock sur device)');
SELECT ok('RowShareLock' = ANY (pg_temp.locks('vendor')) AND 'RowExclusiveLock' = ANY
  (pg_temp.locks('vendor')),
  'verrous : vendeur pris en exclusif puis mis à jour (RowShareLock, RowExclusiveLock sur vendor)');
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pgrowlocks') THEN
    CREATE EXTENSION IF NOT EXISTS pgrowlocks;
  END IF;
END $$;
CREATE FUNCTION pg_temp.device_row_modes(p_device uuid) RETURNS text[] LANGUAGE plpgsql AS $$
DECLARE r text[];
BEGIN
  EXECUTE 'SELECT l.modes FROM pgrowlocks(''device'') l JOIN device d ON d.ctid = l.locked_row
            WHERE d.id = $1' INTO r USING p_device;
  RETURN r;
END $$;
SELECT CASE WHEN EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pgrowlocks')
            THEN is(pg_temp.device_row_modes(pg_temp.id('31aa08')), ARRAY['For Share'],
                    'verrous : ligne du terminal en FOR SHARE (pgrowlocks), jamais en exclusif')
            ELSE skip('pgrowlocks indisponible', 1) END;

-- 5. Compter d'abord (A6) -------------------------------------------------------------------------
-- Lock : une session ouverte sur aa02 (essai puis ouverture, compteur remis à 0), puis cinq essais
-- sur aa01.
SELECT isnt(pg_temp.login('Lock', '31aa02'), NULL,
  'compter d''abord : session de Lock ouverte sur aa02');
SELECT is(pg_temp.attempts('Lock'), 0, 'compter d''abord : compteur remis à 0 par l''ouverture');
SELECT is((SELECT pin_hash || '|' || locked FROM begin_vendor_pin_check(pg_temp.v('Lock'),
  pg_temp.id('31aa01'))),
  pg_temp.ph('Lock') || '|false',
    'compter d''abord : 1er essai, empreinte réelle rendue, non bloqué');
SELECT is(pg_temp.attempts('Lock'), 1, 'compter d''abord : compteur à 1 avant toute vérification');
SELECT is((SELECT count(*)::int FROM vendor_pin_check
            WHERE vendor_id = pg_temp.v('Lock') AND device_id = pg_temp.id('31aa01')
              AND expires_at = created_at + interval '30 seconds' AND used_at IS NULL), 1,
  'compter d''abord : un check de 30 s, non utilisé, pour ce vendeur et ce terminal');
SELECT is((SELECT locked FROM begin_vendor_pin_check(pg_temp.v('Lock'), pg_temp.id('31aa01'))),
  false,
  'compter d''abord : 2e essai, non bloqué');
SELECT is((SELECT locked FROM begin_vendor_pin_check(pg_temp.v('Lock'), pg_temp.id('31aa01'))),
  false,
  'compter d''abord : 3e essai, non bloqué');
SELECT is((SELECT locked FROM begin_vendor_pin_check(pg_temp.v('Lock'), pg_temp.id('31aa01'))),
  false,
  'compter d''abord : 4e essai, non bloqué');
SELECT is(pg_temp.attempts('Lock') || '|' || pg_temp.is_locked('Lock'), '4|false',
  'compter d''abord : compteur à 4, non bloqué');
CREATE TEMP TABLE t_lock5 AS
  SELECT * FROM begin_vendor_pin_check(pg_temp.v('Lock'), pg_temp.id('31aa01'));
SELECT is((SELECT locked FROM t_lock5), true,
  'compter d''abord : 5e essai rendu avec locked = true (bloqué avant vérification)');
SELECT is(pg_temp.attempts('Lock') || '|' || pg_temp.is_locked('Lock'), '5|true',
  'compter d''abord : compteur à 5, locked_at posé');
SELECT is((SELECT closed_reason FROM vendor_session WHERE vendor_id = pg_temp.v('Lock')
            AND device_id = pg_temp.id('31aa02')), 'VENDOR_LOCKED',
  'compter d''abord : le blocage ferme la session du vendeur (VENDOR_LOCKED)');
SELECT is(pg_temp.rows(pg_temp.v('Lock'), '31aa01'), 0, 'compter d''abord : 6e essai, zéro ligne');
SELECT is(pg_temp.attempts('Lock'), 5, 'compter d''abord : le compteur reste à 5 (jamais au-delà)');
SELECT is((SELECT array_agg(id) FROM vendor_pin_check
            WHERE vendor_id = pg_temp.v('Lock') AND used_at IS NULL),
  ARRAY[(SELECT check_id FROM t_lock5)],
  'compter d''abord : le blocage retire les checks des essais 1 à 4, seul celui du 5e reste');
SELECT is((SELECT count(*)::int FROM vendor_pin_check WHERE vendor_id = pg_temp.v('Lock')), 2,
  'compter d''abord : aucun check pour le 6e essai (celui de l''ouverture et celui du 5e)');
-- 4 PIN faux puis le bon : le check du 5e essai, même vérifié bon par l'API, n'ouvre rien.
SELECT throws_ok($$SELECT * FROM open_vendor_session((SELECT check_id FROM t_lock5),
  pg_temp.id('31aa01'))$$,
  'CL033', 'Ouverture de session refusée',
  'compter d''abord : check du 5e essai passé à open_vendor_session -> CL033');
SELECT is(pg_temp.attempts('Lock') || '|' || pg_temp.is_locked('Lock'), '5|true',
  'compter d''abord : le refus de l''ouverture laisse le vendeur bloqué, compteur à 5');

-- 6. Zéro ligne et rien d'écrit -------------------------------------------------------------------
SELECT is(pg_temp.checks(), 3, 'avant les refus : trois checks');
SELECT is(pg_temp.rows(pg_temp.v('Coumba'), '31aa01'), 0,
  'refus : vendeur d''un autre commerçant (M2 sur caisse de M1)');
SELECT is(pg_temp.attempts('Coumba'), 0, 'refus : vendeur d''un autre commerçant jamais compté');
SELECT set_vendor_status(pg_temp.v('Diarra'), 'DISABLED', pg_temp.id('31e002'));
SELECT is(pg_temp.rows(pg_temp.v('Diarra'), '31aa01'), 0, 'refus : vendeur DISABLED');
SELECT is(pg_temp.attempts('Diarra'), 0, 'refus : vendeur DISABLED non compté');
SELECT is(pg_temp.rows(pg_temp.id('31ffff'), '31aa01'), 0, 'refus : vendeur inconnu');
SELECT is(pg_temp.rows(NULL, '31aa01'), 0, 'refus : vendeur absent');
SELECT is(pg_temp.rows(pg_temp.v('Mbaye'), '31aa01'), 0, 'refus : vendeur d''un autre prestataire');
SELECT is(pg_temp.attempts('Mbaye'), 0, 'refus : vendeur d''un autre prestataire non compté');
SELECT is(pg_temp.rows(pg_temp.v('Awa'), '31aa04'), 0, 'refus : terminal TOPUP_DESK');
SELECT is(pg_temp.rows(pg_temp.v('Awa'), '31aa05'), 0, 'refus : terminal sans point de vente');
SELECT is(pg_temp.attempts('Awa'), 0, 'refus : vendeur non compté sur un terminal hors vente');
SELECT is(pg_temp.checks(), 3, 'refus : aucun check écrit');
SELECT throws_ok($$SELECT * FROM begin_vendor_pin_check(pg_temp.v('Awa'), pg_temp.id('31ab01'))$$,
  'P0002', NULL, 'begin_vendor_pin_check : terminal d''un autre prestataire -> P0002');
SELECT throws_ok($$SELECT * FROM begin_vendor_pin_check(pg_temp.v('Awa'), pg_temp.id('31ffff'))$$,
  'P0002', NULL, 'begin_vendor_pin_check : terminal inconnu -> P0002');
SELECT pg_temp.none();
SELECT throws_ok($$SELECT * FROM begin_vendor_pin_check(pg_temp.v('Awa'), pg_temp.id('31aa01'))$$,
  'P0002', NULL, 'begin_vendor_pin_check : sans prestataire de session -> P0002');
SELECT pg_temp.a();
UPDATE device SET status = 'SUSPENDED' WHERE id = pg_temp.id('31aa07');
SELECT throws_ok($$SELECT * FROM begin_vendor_pin_check(pg_temp.v('Awa'), pg_temp.id('31aa07'))$$,
  'CL030', NULL, 'begin_vendor_pin_check : terminal suspendu -> CL030');
UPDATE device SET status = 'REVOKED' WHERE id = pg_temp.id('31aa07');
SELECT throws_ok($$SELECT * FROM begin_vendor_pin_check(pg_temp.v('Awa'), pg_temp.id('31aa07'))$$,
  '42501', NULL, 'begin_vendor_pin_check : terminal révoqué -> 42501');
SELECT is(pg_temp.attempts('Awa'), 0, 'refus : terminal suspendu ou révoqué, vendeur non compté');

-- 7. open_vendor_session --------------------------------------------------------------------------
SELECT is((SELECT pg_temp.attempts('Awa')), 0, 'ouverture : compteur de Awa à 0 au départ');
CREATE TEMP TABLE t_open AS
  SELECT * FROM open_vendor_session(pg_temp.chk('Awa', '31aa01'), pg_temp.id('31aa01'));
SELECT is((SELECT vendor_id || '|' || vendor_display_name || '|' || (expires_at = now() + interval
  '12 hours')
             FROM t_open),
  pg_temp.v('Awa') || '|Awa|true', 'ouverture : vendeur, nom et fin à 12 h rendus');
SELECT is(pg_temp.open_session('31aa01'), (SELECT vendor_session_id FROM t_open),
  'ouverture : session ouverte du terminal');
SELECT is(pg_temp.attempts('Awa'), 0, 'ouverture : compteur remis à 0');
SELECT is((SELECT count(*)::int FROM vendor_pin_check WHERE vendor_id = pg_temp.v('Awa') AND used_at
  IS NOT NULL), 1,
  'ouverture : check marqué utilisé');
-- Binta sur le même terminal : la session de Awa est remplacée.
SELECT isnt(pg_temp.login('Binta', '31aa01'), NULL, 'ouverture : Binta sur aa01');
SELECT is(pg_temp.reason((SELECT vendor_session_id FROM t_open)), 'REPLACED',
  'ouverture : session précédente du terminal fermée (REPLACED)');
SELECT is((SELECT count(*)::int FROM vendor_session WHERE device_id = pg_temp.id('31aa01') AND
  closed_at IS NULL), 1,
  'ouverture : une seule session ouverte sur le terminal');
-- Check déjà utilisé.
CREATE TEMP TABLE t_chk (name text PRIMARY KEY, id uuid);
INSERT INTO t_chk VALUES ('used', (SELECT id FROM vendor_pin_check
                                     WHERE vendor_id = pg_temp.v('Awa') AND used_at IS NOT NULL));
SELECT throws_ok($$SELECT * FROM open_vendor_session((SELECT id FROM t_chk WHERE name = 'used'),
  pg_temp.id('31aa01'))$$,
  'CL033', 'Ouverture de session refusée', 'ouverture : check déjà utilisé -> CL033');
-- Check expiré.
INSERT INTO t_chk VALUES ('expired', pg_temp.chk('Awa', '31aa01'));
UPDATE vendor_pin_check SET created_at = now() - interval '31 seconds',
  expires_at = now() - interval '1 second'
 WHERE id = (SELECT id FROM t_chk WHERE name = 'expired');
SELECT throws_ok($$SELECT * FROM open_vendor_session((SELECT id FROM t_chk WHERE name = 'expired'),
  pg_temp.id('31aa01'))$$,
  'CL033', 'Ouverture de session refusée', 'ouverture : check expiré -> CL033');
SELECT is(pg_temp.attempts('Awa'), 1, 'ouverture refusée : l''essai reste compté');
-- Check d'un autre terminal.
INSERT INTO t_chk VALUES ('other_device', pg_temp.chk('Awa', '31aa01'));
SELECT throws_ok($$SELECT * FROM open_vendor_session((SELECT id FROM t_chk WHERE name =
  'other_device'), pg_temp.id('31aa02'))$$,
  'CL033', 'Ouverture de session refusée', 'ouverture : check d''un autre terminal -> CL033');
-- Check inconnu, absent.
SELECT throws_ok($$SELECT * FROM open_vendor_session(pg_temp.id('31ffff'), pg_temp.id('31aa01'))$$,
  'CL033', 'Ouverture de session refusée', 'ouverture : check inconnu -> CL033');
SELECT throws_ok($$SELECT * FROM open_vendor_session(NULL, pg_temp.id('31aa01'))$$,
  'CL033', 'Ouverture de session refusée', 'ouverture : check absent -> CL033');
-- Vendeur désactivé entre A et B.
INSERT INTO t_chk VALUES ('disabled', pg_temp.chk('Fatou', '31aa01'));
SELECT set_vendor_status(pg_temp.v('Fatou'), 'DISABLED', pg_temp.id('31e002'));
SELECT throws_ok($$SELECT * FROM open_vendor_session((SELECT id FROM t_chk WHERE name = 'disabled'),
  pg_temp.id('31aa01'))$$,
  'CL033', 'Ouverture de session refusée', 'ouverture : vendeur désactivé entre A et B -> CL033');
-- Vendeur bloqué entre A et B.
INSERT INTO t_chk VALUES ('locked', pg_temp.chk('Gora', '31aa01'));
UPDATE vendor SET failed_attempts = 5, locked_at = now() WHERE id = pg_temp.v('Gora');
SELECT throws_ok($$SELECT * FROM open_vendor_session((SELECT id FROM t_chk WHERE name = 'locked'),
  pg_temp.id('31aa01'))$$,
  'CL033', 'Ouverture de session refusée', 'ouverture : vendeur bloqué entre A et B -> CL033');
-- Terminal suspendu entre A et B.
INSERT INTO t_chk VALUES ('device_suspended', pg_temp.chk('Habib', '31aa06'));
UPDATE device SET status = 'SUSPENDED' WHERE id = pg_temp.id('31aa06');
SELECT throws_ok($$SELECT * FROM open_vendor_session((SELECT id FROM t_chk WHERE name =
  'device_suspended'), pg_temp.id('31aa06'))$$,
  'CL033', 'Ouverture de session refusée', 'ouverture : terminal suspendu entre A et B -> CL033');
UPDATE device SET status = 'ACTIVE' WHERE id = pg_temp.id('31aa06');
-- Vendeur changé de commerçant entre A et B (écriture directe : aucune fonction ne le fait).
INSERT INTO t_chk VALUES ('merchant', pg_temp.chk('Habib', '31aa06'));
UPDATE vendor SET merchant_id = pg_temp.id('31b102') WHERE id = pg_temp.v('Habib');
SELECT throws_ok($$SELECT * FROM open_vendor_session((SELECT id FROM t_chk WHERE name = 'merchant'),
  pg_temp.id('31aa06'))$$,
  'CL033', 'Ouverture de session refusée',
    'ouverture : vendeur d''un autre commerçant que le point de vente -> CL033');
UPDATE vendor SET merchant_id = pg_temp.id('31b101') WHERE id = pg_temp.v('Habib');
-- Autre prestataire de session.
INSERT INTO t_chk VALUES ('tenant', pg_temp.chk('Habib', '31aa06'));
SELECT pg_temp.b();
SELECT throws_ok($$SELECT * FROM open_vendor_session((SELECT id FROM t_chk WHERE name = 'tenant'),
  pg_temp.id('31aa06'))$$,
  'CL033', 'Ouverture de session refusée', 'ouverture : session d''un autre prestataire -> CL033');
SELECT pg_temp.a();
SELECT is((SELECT count(*)::int FROM open_vendor_session((SELECT id FROM t_chk WHERE name =
  'tenant'), pg_temp.id('31aa06'))), 1,
  'ouverture : le même check passe dans son prestataire (les refus n''ont rien consommé)');
SELECT is(pg_temp.attempts('Habib'), 0, 'ouverture : compteur de Habib remis à 0');

-- 8. assert_vendor_session et close_vendor_session ------------------------------------------------
-- Binta est ouverte sur aa01 (§7).
INSERT INTO t_chk VALUES ('binta', pg_temp.open_session('31aa01'));
SELECT is(assert_vendor_session(pg_temp.id('31aa01'), (SELECT id FROM t_chk WHERE name = 'binta')),
  pg_temp.v('Binta'),
  'garde : session valide, rend le vendeur');
SELECT throws_ok($$SELECT assert_vendor_session(pg_temp.id('31aa01'), pg_temp.id('31ffff'))$$,
  'CL032', NULL, 'garde : autre identifiant de session -> CL032');
SELECT throws_ok($$SELECT assert_vendor_session(pg_temp.id('31aa06'),
  (SELECT id FROM t_chk WHERE name = 'binta'))$$,
  'CL032', NULL, 'garde : session d''un autre terminal -> CL032');
SELECT throws_ok($$SELECT assert_vendor_session(pg_temp.id('31aa01'), NULL)$$,
  'CL032', NULL, 'garde : sans session -> CL032');
SELECT pg_temp.b();
SELECT throws_ok($$SELECT assert_vendor_session(pg_temp.id('31aa01'),
  (SELECT id FROM t_chk WHERE name = 'binta'))$$,
  'CL032', NULL, 'garde : session d''un autre prestataire -> CL032');
SELECT pg_temp.none();
SELECT throws_ok($$SELECT assert_vendor_session(pg_temp.id('31aa01'),
  (SELECT id FROM t_chk WHERE name = 'binta'))$$,
  'P0002', NULL, 'garde : sans prestataire de session -> P0002');
SELECT pg_temp.a();
-- Expirée (propriétaire : ouverture reculée de 13 h).
UPDATE vendor_session SET opened_at = now() - interval '13 hours',
  expires_at = now() - interval '1 hour'
 WHERE id = (SELECT id FROM t_chk WHERE name = 'binta');
SELECT throws_ok($$SELECT assert_vendor_session(pg_temp.id('31aa01'),
  (SELECT id FROM t_chk WHERE name = 'binta'))$$,
  'CL032', NULL, 'garde : session expirée -> CL032');
UPDATE vendor_session SET opened_at = now(), expires_at = now() + interval '12 hours'
 WHERE id = (SELECT id FROM t_chk WHERE name = 'binta');
-- Vendeur bloqué (propriétaire), puis débloqué.
UPDATE vendor SET failed_attempts = 5, locked_at = now() WHERE id = pg_temp.v('Binta');
SELECT throws_ok($$SELECT assert_vendor_session(pg_temp.id('31aa01'),
  (SELECT id FROM t_chk WHERE name = 'binta'))$$,
  'CL032', NULL, 'garde : vendeur bloqué -> CL032');
UPDATE vendor SET failed_attempts = 0, locked_at = NULL WHERE id = pg_temp.v('Binta');
-- Vendeur désactivé (propriétaire, pour garder la session ouverte), puis réactivé.
UPDATE vendor SET status = 'DISABLED' WHERE id = pg_temp.v('Binta');
SELECT throws_ok($$SELECT assert_vendor_session(pg_temp.id('31aa01'),
  (SELECT id FROM t_chk WHERE name = 'binta'))$$,
  'CL032', NULL, 'garde : vendeur désactivé -> CL032');
UPDATE vendor SET status = 'ACTIVE' WHERE id = pg_temp.v('Binta');
SELECT is(assert_vendor_session(pg_temp.id('31aa01'), (SELECT id FROM t_chk WHERE name = 'binta')),
  pg_temp.v('Binta'),
  'garde : de nouveau valide');
-- Fermeture par le terminal.
SELECT is(close_vendor_session(pg_temp.id('31aa01')), (SELECT id FROM t_chk WHERE name = 'binta'),
  'close_vendor_session : rend la session fermée');
SELECT is(pg_temp.reason((SELECT id FROM t_chk WHERE name = 'binta')), 'LOGOUT',
  'close_vendor_session : motif LOGOUT');
SELECT is(close_vendor_session(pg_temp.id('31aa01')), NULL,
  'close_vendor_session : sans session ouverte, NULL');
SELECT throws_ok($$SELECT assert_vendor_session(pg_temp.id('31aa01'),
  (SELECT id FROM t_chk WHERE name = 'binta'))$$,
  'CL032', NULL, 'garde : session fermée -> CL032');
SELECT throws_ok($$SELECT close_vendor_session(pg_temp.id('31ab01'))$$,
  'P0002', NULL, 'close_vendor_session : terminal d''un autre prestataire -> P0002');

-- 9. set_vendor_pin -----------------------------------------------------------------------------
SELECT is((SELECT count(*)::int FROM vendor_session WHERE vendor_id = pg_temp.v('Lock') AND
  closed_at IS NULL), 0,
  'set_vendor_pin : Lock bloqué, sans session ouverte');
SELECT throws_ok($$SELECT set_vendor_pin(pg_temp.v('Lock'), 'pas-une-empreinte',
  pg_temp.id('31e002'))$$,
  'CL001', 'Vendeur : empreinte du PIN invalide',
    'set_vendor_pin : empreinte invalide -> CL001 sans écho');
SELECT throws_ok($$SELECT set_vendor_pin(pg_temp.v('Lock'), pg_temp.ph('n'),
  pg_temp.id('31e003'))$$,
  'P0002', NULL, 'set_vendor_pin : MERCHANT_ADMIN d''un autre commerçant -> P0002');
SELECT pg_temp.b();
SELECT throws_ok($$SELECT set_vendor_pin(pg_temp.v('Lock'), pg_temp.ph('n'),
  pg_temp.id('31e011'))$$,
  'P0002', NULL, 'set_vendor_pin : vendeur d''un autre prestataire -> P0002');
SELECT pg_temp.a();
SELECT set_vendor_pin(pg_temp.v('Lock'), pg_temp.ph('nouveau'), pg_temp.id('31e002'));
-- Déblocage : le check du 5e essai, émis avant le nouveau PIN (contre l'ancienne empreinte), est
-- retiré et n'ouvre rien.
SELECT is((SELECT count(*)::int FROM vendor_pin_check WHERE vendor_id = pg_temp.v('Lock')
              AND used_at IS NULL), 0,
  'set_vendor_pin : essais non utilisés du vendeur retirés');
SELECT is((SELECT count(*)::int FROM vendor_pin_check WHERE vendor_id = pg_temp.v('Lock')
              AND used_at IS NOT NULL), 1,
  'set_vendor_pin : le check déjà utilisé (historique) est gardé');
SELECT throws_ok($$SELECT * FROM open_vendor_session((SELECT check_id FROM t_lock5),
  pg_temp.id('31aa01'))$$,
  'CL033', 'Ouverture de session refusée',
  'set_vendor_pin : check émis avant le déblocage -> CL033');
SELECT is((SELECT failed_attempts || '|' || (locked_at IS NULL) || '|' || (pin_hash =
  pg_temp.ph('nouveau'))
             FROM vendor WHERE id = pg_temp.v('Lock')), '0|true|true',
  'set_vendor_pin : nouvelle empreinte, compteur à 0, blocage levé');
SELECT is(pg_temp.rows(pg_temp.v('Lock'), '31aa01'), 1,
  'set_vendor_pin : le vendeur débloqué est de nouveau compté');
-- Une session ouverte de Awa est fermée par le changement de PIN ; un essai de Awa compté avant le
-- changement (vérifié par l'API contre l'ancienne empreinte) n'ouvre plus rien.
INSERT INTO t_chk VALUES ('awa2', pg_temp.login('Awa', '31aa02'));
INSERT INTO t_chk VALUES ('awa_old', pg_temp.chk('Awa', '31aa01'));
SELECT set_vendor_pin(pg_temp.v('Awa'), pg_temp.ph('awa2'), pg_temp.id('31e001'));
SELECT is(pg_temp.reason((SELECT id FROM t_chk WHERE name = 'awa2')), 'PIN_CHANGED',
  'set_vendor_pin : sessions ouvertes du vendeur fermées (PIN_CHANGED), auteur OPERATOR_ADMIN');
SELECT throws_ok($$SELECT * FROM open_vendor_session((SELECT id FROM t_chk WHERE name = 'awa_old'),
  pg_temp.id('31aa01'))$$,
  'CL033', 'Ouverture de session refusée',
  'set_vendor_pin : essai compté avant le changement de PIN (ancien PIN) -> CL033');
SELECT is(pg_temp.open_session('31aa01'), NULL,
  'set_vendor_pin : aucune session ouverte avec l''ancien PIN');

-- 10. set_vendor_status ------------------------------------------------------------------------
INSERT INTO t_chk VALUES ('binta2', pg_temp.login('Binta', '31aa02'));
INSERT INTO t_chk VALUES ('binta_old', pg_temp.chk('Binta', '31aa01'));
SELECT set_vendor_status(pg_temp.v('Binta'), 'DISABLED', pg_temp.id('31e002'));
SELECT is(pg_temp.reason((SELECT id FROM t_chk WHERE name = 'binta2')), 'VENDOR_DISABLED',
  'set_vendor_status : désactivation, sessions fermées (VENDOR_DISABLED)');
SELECT is((SELECT count(*)::int FROM vendor_pin_check WHERE vendor_id = pg_temp.v('Binta')
              AND used_at IS NULL), 0,
  'set_vendor_status : désactivation, essais non utilisés du vendeur retirés');
SELECT set_vendor_status(pg_temp.v('Binta'), 'ACTIVE', pg_temp.id('31e002'));
SELECT is((SELECT status FROM vendor WHERE id = pg_temp.v('Binta')), 'ACTIVE',
  'set_vendor_status : réactivation');
SELECT throws_ok($$SELECT * FROM open_vendor_session((SELECT id FROM t_chk WHERE name =
  'binta_old'), pg_temp.id('31aa01'))$$,
  'CL033', 'Ouverture de session refusée',
  'set_vendor_status : essai antérieur à la désactivation, après réactivation -> CL033');
SELECT is((SELECT count(*)::int FROM vendor_session WHERE vendor_id = pg_temp.v('Binta') AND
  closed_at IS NULL), 0,
  'set_vendor_status : réactiver ne rouvre aucune session');
-- Réactiver ne débloque pas (Gora est bloqué, §7).
SELECT set_vendor_status(pg_temp.v('Gora'), 'DISABLED', pg_temp.id('31e002'));
SELECT set_vendor_status(pg_temp.v('Gora'), 'ACTIVE', pg_temp.id('31e002'));
SELECT is(pg_temp.is_locked('Gora'), true, 'set_vendor_status : réactiver ne débloque pas');
-- Statut déjà en place : sans effet (updated_at inchangé), sans erreur.
UPDATE vendor SET updated_at = '2026-01-01T00:00:00Z' WHERE id = pg_temp.v('Binta');
SELECT lives_ok($$SELECT set_vendor_status(pg_temp.v('Binta'), 'ACTIVE', pg_temp.id('31e002'))$$,
  'set_vendor_status : statut déjà en place, sans erreur');
SELECT is((SELECT updated_at FROM vendor WHERE id = pg_temp.v('Binta')),
  '2026-01-01T00:00:00Z'::timestamptz,
  'set_vendor_status : statut déjà en place, sans effet');
SELECT throws_ok($$SELECT set_vendor_status(pg_temp.v('Binta'), 'LOCKED', pg_temp.id('31e002'))$$,
  'CL001', NULL, 'set_vendor_status : statut inconnu -> CL001');
SELECT throws_ok($$SELECT set_vendor_status(pg_temp.v('Binta'), 'DISABLED', pg_temp.id('31e003'))$$,
  'P0002', NULL, 'set_vendor_status : MERCHANT_ADMIN d''un autre commerçant -> P0002');
SELECT throws_ok($$SELECT set_vendor_status(pg_temp.id('31ffff'), 'DISABLED',
  pg_temp.id('31e001'))$$,
  'P0002', NULL, 'set_vendor_status : vendeur inconnu -> P0002');

-- 11. set_device_status remplacée -----------------------------------------------------------------
INSERT INTO t_chk VALUES ('dev1', pg_temp.login('Binta', '31aa06'));
SELECT set_device_status(pg_temp.id('31aa06'), 'SUSPENDED', 'Contrôle', pg_temp.id('31e001'));
SELECT is(pg_temp.reason((SELECT id FROM t_chk WHERE name = 'dev1')), 'DEVICE_SUSPENDED',
  'set_device_status : suspension, session du terminal fermée (DEVICE_SUSPENDED)');
SELECT set_device_status(pg_temp.id('31aa06'), 'ACTIVE', 'Fin du contrôle', pg_temp.id('31e001'));
SELECT is(pg_temp.open_session('31aa06'), NULL,
  'set_device_status : retour à ACTIVE, aucune session rouverte');
INSERT INTO t_chk VALUES ('dev2', pg_temp.login('Binta', '31aa06'));
INSERT INTO t_chk VALUES ('other', pg_temp.login('Awa', '31aa01'));
SELECT set_device_status(pg_temp.id('31aa06'), 'REVOKED', 'Perdu', pg_temp.id('31e001'));
SELECT is(pg_temp.reason((SELECT id FROM t_chk WHERE name = 'dev2')), 'DEVICE_REVOKED',
  'set_device_status : révocation, session du terminal fermée (DEVICE_REVOKED)');
SELECT is(pg_temp.reason((SELECT id FROM t_chk WHERE name = 'other')), NULL,
  'set_device_status : la session d''un autre terminal reste ouverte');
SELECT is((SELECT array_agg(to_status ORDER BY at, id) FROM device_status_history
            WHERE device_id = pg_temp.id('31aa06')), ARRAY['SUSPENDED', 'ACTIVE', 'REVOKED'],
  'set_device_status : historique écrit à chaque transition');
-- Refus de 0022 gardés.
SELECT throws_ok($$SELECT set_device_status(pg_temp.id('31aa06'), 'ACTIVE', 'Retour',
  pg_temp.id('31e001'))$$,
  'CL029', NULL, 'set_device_status : sortie de REVOKED -> CL029');
SELECT throws_ok($$SELECT set_device_status(pg_temp.id('31aa01'), 'SUSPENDED', '  ',
  pg_temp.id('31e001'))$$,
  'CL001', NULL, 'set_device_status : motif vide -> CL001');
SELECT throws_ok($$SELECT set_device_status(pg_temp.id('31aa01'), 'SUSPENDED', repeat('m', 501),
  pg_temp.id('31e001'))$$,
  'CL001', NULL, 'set_device_status : motif de 501 caractères -> CL001');
SELECT throws_ok($$SELECT set_device_status(pg_temp.id('31aa01'), 'LOST', 'x',
  pg_temp.id('31e001'))$$,
  'CL001', NULL, 'set_device_status : statut inconnu -> CL001');
SELECT throws_ok($$SELECT set_device_status(pg_temp.id('31aa01'), 'ACTIVE', 'x',
  pg_temp.id('31e001'))$$,
  'CL029', NULL, 'set_device_status : ACTIVE -> ACTIVE -> CL029');
SELECT throws_ok($$SELECT set_device_status(pg_temp.id('31aa01'), 'SUSPENDED', 'x',
  pg_temp.id('31e002'))$$,
  'P0002', NULL, 'set_device_status : auteur hors périmètre (MERCHANT_ADMIN) -> P0002');
SELECT throws_ok($$SELECT set_device_status(pg_temp.id('31ab01'), 'SUSPENDED', 'x',
  pg_temp.id('31e001'))$$,
  'P0002', NULL, 'set_device_status : terminal d''un autre prestataire -> P0002');
SELECT is(pg_temp.reason((SELECT id FROM t_chk WHERE name = 'other')), NULL,
  'set_device_status : un refus ne ferme aucune session');
SELECT is((SELECT count(*)::int FROM device_refresh_token WHERE device_id = pg_temp.id('31aa06') AND
  revoked_at IS NULL), 0,
  'set_device_status : (contrôle de 0022) aucune famille vivante après révocation');

-- 12. vendor_public -----------------------------------------------------------------------------
-- Gora bloqué, Awa non bloqué ; Mbaye (B) invisible depuis A.
SELECT is((SELECT locked FROM vendor_public WHERE id = pg_temp.v('Gora')), true,
  'vendor_public : locked exact (bloqué)');
SELECT is((SELECT locked FROM vendor_public WHERE id = pg_temp.v('Awa')), false,
  'vendor_public : locked exact (non bloqué)');
SELECT is((SELECT count(*)::int FROM vendor_public WHERE id = pg_temp.v('Mbaye')), 0,
  'vendor_public : vendeur d''un autre prestataire invisible (propriétaire qui ignore la RLS)');
SELECT is((SELECT count(*)::int FROM vendor_public),
  (SELECT count(*)::int FROM vendor WHERE operator_id = pg_temp.id('31a001')),
  'vendor_public : tous les vendeurs du prestataire de session, eux seuls');
SELECT is((SELECT count(*)::int FROM vendor_public WHERE operator_id <> pg_temp.id('31a001')), 0,
  'vendor_public : aucune ligne d''un autre prestataire');
SELECT pg_temp.b();
SELECT is((SELECT array_agg(display_name) FROM vendor_public), ARRAY['Mbaye'],
  'vendor_public : session de B, seulement le vendeur de B');
SELECT pg_temp.none();
SELECT is((SELECT count(*)::int FROM vendor_public), 0,
  'vendor_public : sans prestataire de session, aucune ligne');
SELECT pg_temp.a();

-- 13. Purge (purge_device_enrollment_attempts remplacée) ------------------------------------------
-- Un check de plus de 24 h est purgé ; un check de 23 h 59 reste. L'heure de référence est lue UNE
-- fois par instruction (sous-requête) : clock_timestamp() appelée deux fois rendrait deux instants
-- distincts, et la contrainte vendor_pin_check_ttl (expires_at = created_at + 30 s) refuserait la
-- ligne.
-- Deux essais neufs de Awa (ses essais plus anciens ont été retirés par set_vendor_pin, §9).
INSERT INTO t_chk VALUES ('purge_old', pg_temp.chk('Awa', '31aa01'));
INSERT INTO t_chk VALUES ('purge_recent', pg_temp.chk('Awa', '31aa01'));
UPDATE vendor_pin_check k SET created_at = r.t, expires_at = r.t + interval '30 seconds'
  FROM (SELECT clock_timestamp() - interval '25 hours' AS t) r
 WHERE k.id = (SELECT id FROM t_chk WHERE name = 'purge_old');
UPDATE vendor_pin_check k SET created_at = r.t, expires_at = r.t + interval '30 seconds'
  FROM (SELECT clock_timestamp() - interval '23 hours 59 minutes' AS t) r
 WHERE k.id = (SELECT id FROM t_chk WHERE name = 'purge_recent');
SELECT cmp_ok(purge_device_enrollment_attempts(), '>=', 1::bigint,
  'purge : rend le nombre de lignes retirées');
SELECT is((SELECT count(*)::int FROM vendor_pin_check WHERE id = (SELECT id FROM t_chk WHERE name =
  'purge_old')), 0,
  'purge : essai de PIN de plus de 24 h retiré');
SELECT is((SELECT count(*)::int FROM vendor_pin_check WHERE id = (SELECT id FROM t_chk WHERE name =
  'purge_recent')), 1,
  'purge : essai de PIN de moins de 24 h gardé');

SELECT * FROM finish();
ROLLBACK;
