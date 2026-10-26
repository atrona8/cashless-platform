-- Enrôlement et état de l'événement (migration 0035, OP-N74 ; mission terminaux-paiement-en-ligne,
-- lot WP06 ; FR-024 ; décision du porteur DM-01M5HKDXSTFR5JS88GZ4B2EA5J) — pgTAP, écrit à la main.
-- Lancer : pg_prove -d <base> tests/tests_enrollment_event_state.sql (base créée par les migrations,
-- roles.sql et post-roles.sql rejoués).
-- Les événements sont créés directement dans l'état voulu (le garde event_status_guard ne porte que
-- sur UPDATE OF status). Une clôture réellement concurrente ne se simule pas en une session : la suite
-- prouve le verrou FOR SHARE pris sur l'événement (pgrowlocks) dans la transaction de l'appel.
\set ON_ERROR_STOP 1
\set QUIET 1
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
CREATE EXTENSION IF NOT EXISTS pgrowlocks;
SELECT no_plan();

-- Identifiants : pg_temp.id('35a001') = '00000000-0000-0000-0000-00000035a001'.
CREATE FUNCTION pg_temp.id(p text) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT ('00000000-0000-0000-0000-' || lpad(p, 12, '0'))::uuid $$;
-- Empreinte de test (32 octets).
CREATE FUNCTION pg_temp.h(p text) RETURNS bytea LANGUAGE sql IMMUTABLE AS
  $$ SELECT sha256(convert_to('0035 ' || p, 'UTF8')) $$;

-- États et modes de la matrice ; refus attendu (décision du porteur).
CREATE TEMP TABLE st (state event_status, n int) ON COMMIT DROP;
INSERT INTO st VALUES ('DRAFT', 1), ('LIVE', 2), ('CLOSING', 3), ('RECONCILING', 4), ('SETTLING', 5),
                      ('REFUND_WINDOW', 6), ('CLOSED', 7);
CREATE TEMP TABLE md (mode text, k text) ON COMMIT DROP;
INSERT INTO md VALUES ('CATALOG_POS', 'cat'), ('KEYPAD_TPE', 'key'), ('TOPUP_DESK', 'top'), (NULL, 'nul');
CREATE FUNCTION pg_temp.refused(p_state event_status, p_mode text) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT p_state = 'CLOSED'
      OR (p_state IN ('CLOSING','RECONCILING','SETTLING','REFUND_WINDOW')
          AND coalesce(p_mode, 'CATALOG_POS') <> 'TOPUP_DESK')
$$;
-- Événement de l'état n : 35d00n.
CREATE FUNCTION pg_temp.ev(p_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT pg_temp.id('35d00' || p_n) $$;

-- Données (propriétaire) ------------------------------------------------------------------------
-- Prestataire A (35a001), organisateur b001, commerçants b101 et b102. Événements d001..d007 dans les sept
-- états ; d010 et d011 LIVE (points de vente f110 et f111) ; d020 LIVE et d021 LIVE réservés aux
-- preuves de verrou (aucun autre appel ne les touche).
INSERT INTO party (kind, legal_name) SELECT 'PLATFORM', 'Plateforme (test)'
 WHERE NOT EXISTS (SELECT 1 FROM party WHERE kind = 'PLATFORM');
INSERT INTO party (id, kind, legal_name, country_code) VALUES
 (pg_temp.id('35a001'), 'OPERATOR', 'Prestataire A', 'SN');
INSERT INTO party (id, kind, operator_id, legal_name) VALUES
 (pg_temp.id('35b001'), 'ORGANIZER', pg_temp.id('35a001'), 'Organisateur A'),
 (pg_temp.id('35b101'), 'MERCHANT', pg_temp.id('35a001'), 'Commerçant A1'),
 (pg_temp.id('35b102'), 'MERCHANT', pg_temp.id('35a001'), 'Commerçant A2');
INSERT INTO jurisdiction_profile (id, country_code, version, valid_from, breakage_destination)
VALUES (pg_temp.id('35c001'), 'SN', 200035, '2026-01-01', 'ORGANIZER');
INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone, jurisdiction_id,
                   funds_holder, status)
SELECT pg_temp.ev(n), pg_temp.id('35a001'), pg_temp.id('35b001'), 'Événement ' || state, 'XOF',
       'Africa/Dakar', pg_temp.id('35c001'), 'ORGANIZER', state
  FROM st;
INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone, jurisdiction_id,
                   funds_holder, status)
SELECT pg_temp.id(e), pg_temp.id('35a001'), pg_temp.id('35b001'), 'Événement ' || e, 'XOF',
       'Africa/Dakar', pg_temp.id('35c001'), 'ORGANIZER', 'LIVE'
  FROM unnest(ARRAY['35d010', '35d011', '35d020', '35d021']) e;
INSERT INTO merchant_participation (id, operator_id, event_id, merchant_id, link_type) VALUES
 (pg_temp.id('35f010'), pg_temp.id('35a001'), pg_temp.id('35d010'), pg_temp.id('35b102'), 'INTERNAL'),
 (pg_temp.id('35f011'), pg_temp.id('35a001'), pg_temp.id('35d011'), pg_temp.id('35b101'), 'INTERNAL');
INSERT INTO point_of_sale (id, operator_id, participation_id, name) VALUES
 (pg_temp.id('35f110'), pg_temp.id('35a001'), pg_temp.id('35f010'), 'Bar d010'),
 (pg_temp.id('35f111'), pg_temp.id('35a001'), pg_temp.id('35f011'), 'Bar d011');
-- Personnes : e001 OPERATOR_ADMIN de A ; e003 de A sans rôle (hors périmètre).
INSERT INTO app_user (id, operator_id, issuer, subject, email, display_name)
SELECT pg_temp.id(u), pg_temp.id('35a001'), 'https://idp.test', 's0035' || u, u || '@test',
       'Personne ' || u
  FROM unnest(ARRAY['35e001', '35e003']) u;
INSERT INTO role_assignment (user_id, role, scope_type, scope_id, granted_by) VALUES
 (pg_temp.id('35e001'), 'OPERATOR_ADMIN', 'OPERATOR', pg_temp.id('35a001'), NULL);

-- Sessions : prestataire A, ou aucun (route d'enrôlement sans compte).
CREATE FUNCTION pg_temp.a() RETURNS void LANGUAGE sql AS
  $$ SELECT set_config('app.operator_id', pg_temp.id('35a001')::text, true) $$;
CREATE FUNCTION pg_temp.none() RETURNS void LANGUAGE sql AS
  $$ SELECT set_config('app.operator_id', '', true) $$;
-- Appel d'émission (texte SQL, pour throws_ok / lives_ok).
CREATE FUNCTION pg_temp.emit_sql(p_code text, p_event uuid, p_pos uuid, p_mode text, p_actor text)
RETURNS text LANGUAGE sql AS $$
  SELECT format('SELECT create_device_enrollment_code(%L, %L, %L, %L, false, NULL, %L)',
                pg_temp.h('code ' || p_code), p_event, p_pos, p_mode, pg_temp.id(p_actor))
$$;
-- Code inséré directement (propriétaire), sans passer par le contrôle de l'émission.
CREATE FUNCTION pg_temp.raw_code(p_code text, p_event uuid, p_pos uuid, p_mode text,
                                 p_created interval DEFAULT '0 seconds',
                                 p_expires interval DEFAULT '1 day') RETURNS void LANGUAGE sql AS $$
  INSERT INTO device_enrollment_code (operator_id, code_hash, event_id, pos_id, app_mode, personal_phone,
                                      created_by, created_at, expires_at)
  VALUES (pg_temp.id('35a001'), pg_temp.h('code ' || p_code), p_event, p_pos, p_mode, false,
          pg_temp.id('35e001'), now() + p_created, now() + p_expires)
$$;
-- Appel d'enrôlement nominal d'après le code p_code (texte SQL).
CREATE FUNCTION pg_temp.enroll_sql(p_code text, p_serial text, p_os text DEFAULT 'ANDROID') RETURNS text
LANGUAGE sql AS $$
  SELECT format($q$SELECT * FROM enroll_device(%L, %L, %L, '1.0.0', %L, %L, %L,
                    now() + interval '365 days', %L, %L, %L, now() + interval '30 days')$q$,
                pg_temp.h('code ' || p_code), p_serial, p_os,
                decode(repeat('ab', 91), 'hex'), decode('04' || repeat('cd', 64), 'hex'),
                pg_temp.h('cert ' || p_code),
                CASE p_os WHEN 'ANDROID' THEN 'ANDROID_KEY_ATTESTATION' ELSE 'IOS_APP_ATTEST' END,
                CASE p_os WHEN 'ANDROID' THEN 'STRONGBOX' END,
                pg_temp.h('refresh ' || p_code))
$$;
CREATE FUNCTION pg_temp.used(p_code text) RETURNS boolean LANGUAGE sql AS
  $$ SELECT used_at IS NOT NULL FROM device_enrollment_code WHERE code_hash = pg_temp.h('code ' || p_code) $$;
CREATE FUNCTION pg_temp.has_device(p_serial text) RETURNS boolean LANGUAGE sql AS
  $$ SELECT EXISTS (SELECT 1 FROM device WHERE operator_id = pg_temp.id('35a001') AND serial = p_serial) $$;
-- Écritures de l'enrôlement chez A : terminaux, codes consommés, jetons, historique.
CREATE FUNCTION pg_temp.writes() RETURNS int[] LANGUAGE sql AS $$
  SELECT ARRAY[(SELECT count(*)::int FROM device WHERE operator_id = pg_temp.id('35a001')),
               (SELECT count(*)::int FROM device_enrollment_code
                 WHERE operator_id = pg_temp.id('35a001') AND used_at IS NOT NULL),
               (SELECT count(*)::int FROM device_refresh_token WHERE operator_id = pg_temp.id('35a001')),
               (SELECT count(*)::int FROM device_status_history WHERE operator_id = pg_temp.id('35a001'))]
$$;
-- Modes de verrou posés sur un événement (pgrowlocks), dans la transaction courante.
CREATE FUNCTION pg_temp.event_lock_modes(p_event uuid) RETURNS text[] LANGUAGE sql AS $$
  SELECT coalesce((SELECT l.modes FROM pgrowlocks('event') l
                    JOIN event e ON e.ctid = l.locked_row WHERE e.id = p_event), '{}')
$$;

-- 1. Structure et droits ------------------------------------------------------------------------
SELECT is((SELECT count(*)::int FROM pg_proc
            WHERE oid IN ('create_device_enrollment_code(bytea,uuid,uuid,text,boolean,integer,uuid)'::regprocedure,
                          'enroll_device(bytea,text,text,text,bytea,bytea,bytea,timestamptz,text,text,bytea,timestamptz,uuid)'::regprocedure,
                          'record_enrollment_attempt(bytea,inet,text)'::regprocedure)
              AND prosecdef AND proconfig = ARRAY['search_path=public, pg_temp']), 3,
  'émission, enrôlement et trace d''essai : signatures inchangées, SECURITY DEFINER, search_path public, pg_temp');
SELECT is((SELECT count(*)::int FROM pg_proc
            WHERE proname IN ('create_device_enrollment_code', 'enroll_device', 'record_enrollment_attempt')),
  3, 'aucune surcharge ajoutée (une seule version de chaque fonction)');
SELECT is((SELECT pg_get_function_result(
             'enroll_device(bytea,text,text,text,bytea,bytea,bytea,timestamptz,text,text,bytea,timestamptz,uuid)'::regprocedure)),
  'TABLE(device_id uuid, next_seq bigint)', 'enroll_device rend toujours (device_id, next_seq)');
SELECT ok((SELECT pg_get_function_arguments(
             'enroll_device(bytea,text,text,text,bytea,bytea,bytea,timestamptz,text,text,bytea,timestamptz,uuid)'::regprocedure))
          LIKE '%p_device_id uuid DEFAULT NULL::uuid',
  'enroll_device : p_device_id toujours facultatif (DEFAULT NULL)');
SELECT is((SELECT pg_get_function_arguments(
             'create_device_enrollment_code(bytea,uuid,uuid,text,boolean,integer,uuid)'::regprocedure)),
  'p_code_hash bytea, p_event uuid, p_pos uuid, p_mode text, p_personal_phone boolean, p_ttl_seconds integer, p_actor uuid',
  'create_device_enrollment_code : noms de paramètres inchangés');
DROP ROLE IF EXISTS enroll_state_probe;
CREATE ROLE enroll_state_probe;
SELECT is((SELECT count(*)::int
             FROM unnest(ARRAY['create_device_enrollment_code(bytea,uuid,uuid,text,boolean,integer,uuid)',
                               'enroll_device(bytea,text,text,text,bytea,bytea,bytea,timestamptz,text,text,bytea,timestamptz,uuid)',
                               'record_enrollment_attempt(bytea,inet,text)']) f
            WHERE has_function_privilege('enroll_state_probe', f, 'EXECUTE')), 0,
  'aucune des trois fonctions n''est exécutable par PUBLIC');
SELECT ok(has_function_privilege('cashless_app',
            'enroll_device(bytea,text,text,text,bytea,bytea,bytea,timestamptz,text,text,bytea,timestamptz,uuid)',
            'EXECUTE')
          AND has_function_privilege('cashless_app',
            'create_device_enrollment_code(bytea,uuid,uuid,text,boolean,integer,uuid)', 'EXECUTE'),
  'droits de cashless_app conservés par CREATE OR REPLACE');
SELECT ok((SELECT prosrc FROM pg_proc
            WHERE oid = 'create_device_enrollment_code(bytea,uuid,uuid,text,boolean,integer,uuid)'::regprocedure)
          ~ 'device_admin_allowed.*FROM event e\s+WHERE e\.id = p_event AND e\.operator_id = v_operator FOR SHARE',
  'émission : état lu FOR SHARE, après le contrôle de l''auteur');
SELECT ok((SELECT prosrc FROM pg_proc
            WHERE oid = 'enroll_device(bytea,text,text,text,bytea,bytea,bytea,timestamptz,text,text,bytea,timestamptz,uuid)'::regprocedure)
          ~ 'FOR UPDATE.*CL027.*FROM event e\s+WHERE e\.id = c\.event_id AND e\.operator_id = c\.operator_id FOR SHARE.*pg_advisory_xact_lock',
  'enrôlement : état lu FOR SHARE après le code (FOR UPDATE) et le mode, avant le verrou du serial');

-- 2. Émission : matrice des sept états et quatre modes -------------------------------------------
SELECT pg_temp.a();
SELECT throws_ok(pg_temp.emit_sql('emit ' || st.state || ' ' || md.k, pg_temp.ev(st.n), NULL, md.mode,
                                  '35e001'),
                 'CL031', NULL,
                 'émission refusée (CL031) : ' || st.state || ' / ' || coalesce(md.mode, 'NULL'))
  FROM st, md WHERE pg_temp.refused(st.state, md.mode) ORDER BY st.n, md.k;
SELECT lives_ok(pg_temp.emit_sql('emit ' || st.state || ' ' || md.k, pg_temp.ev(st.n), NULL, md.mode,
                                 '35e001'),
                'émission permise : ' || st.state || ' / ' || coalesce(md.mode, 'NULL'))
  FROM st, md WHERE NOT pg_temp.refused(st.state, md.mode) ORDER BY st.n, md.k;
SELECT is((SELECT count(*)::int FROM device_enrollment_code c, st, md
            WHERE pg_temp.refused(st.state, md.mode)
              AND c.code_hash = pg_temp.h('code emit ' || st.state || ' ' || md.k)), 0,
  'émission : aucun code écrit pour les 16 refus');
SELECT is((SELECT count(*)::int FROM device_enrollment_code c, st, md
            WHERE NOT pg_temp.refused(st.state, md.mode)
              AND c.code_hash = pg_temp.h('code emit ' || st.state || ' ' || md.k)
              AND c.event_id = pg_temp.ev(st.n) AND c.app_mode IS NOT DISTINCT FROM md.mode), 12,
  'émission : les 12 codes permis sont écrits, avec leur événement et leur mode');
-- Ordre des contrôles : auteur hors périmètre sur un événement CLOSED -> P0002 (l'état ne fuit pas).
SELECT throws_ok(pg_temp.emit_sql('emit outsider closed', pg_temp.ev(7), NULL, 'TOPUP_DESK', '35e003'),
  'P0002', NULL, 'émission : auteur hors périmètre sur un événement CLOSED -> P0002, pas CL031');
SELECT throws_ok(pg_temp.emit_sql('emit outsider closing', pg_temp.ev(3), NULL, 'CATALOG_POS', '35e003'),
  'P0002', NULL, 'émission : auteur hors périmètre sur un événement CLOSING -> P0002, pas CL031');
SELECT throws_ok(pg_temp.emit_sql('emit paired closed', pg_temp.ev(7), NULL, 'PAIRED_TPE', '35e001'),
  'CL027', NULL, 'émission : PAIRED_TPE reste CL027 sur un événement CLOSED (contrôle de 0022 d''abord)');
-- Verrou : une émission réussie laisse l'événement verrouillé en partage dans la transaction.
SELECT is(pg_temp.event_lock_modes(pg_temp.id('35d020')) @> ARRAY['For Share'], false,
  'verrou (émission) : événement d020 sans verrou de partage avant l''appel');
SELECT ok(create_device_enrollment_code(pg_temp.h('code lock emit'), pg_temp.id('35d020'), NULL,
                                        'CATALOG_POS', false, NULL, pg_temp.id('35e001')) IS NOT NULL,
  'verrou (émission) : code émis sur d020');
SELECT ok(pg_temp.event_lock_modes(pg_temp.id('35d020')) && ARRAY['For Share', 'For No Key Update', 'For Update'],
  'verrou (émission) : événement verrouillé au moins en partage (pgrowlocks)');

-- 3. Enrôlement : matrice des sept états et quatre modes du code ---------------------------------
-- Codes insérés en propriétaire sur des événements déjà dans l'état (code émis puis événement clos).
SELECT pg_temp.raw_code('enr ' || st.state || ' ' || md.k, pg_temp.ev(st.n), NULL, md.mode)
  FROM st, md;
SELECT pg_temp.none();
CREATE TEMP TABLE w0 ON COMMIT DROP AS SELECT pg_temp.writes() AS w;
SELECT throws_ok(pg_temp.enroll_sql('enr ' || st.state || ' ' || md.k, 'SN-' || st.n || '-' || md.k),
                 'CL031', NULL,
                 'enrôlement refusé (CL031) : ' || st.state || ' / ' || coalesce(md.mode, 'NULL'))
  FROM st, md WHERE pg_temp.refused(st.state, md.mode) ORDER BY st.n, md.k;
SELECT is((SELECT pg_temp.writes() FROM w0), (SELECT w FROM w0),
  'enrôlement : les 16 refus n''écrivent rien (terminal, code consommé, jeton, historique)');
SELECT is((SELECT count(*)::int FROM st, md
            WHERE pg_temp.refused(st.state, md.mode)
              AND (pg_temp.used('enr ' || st.state || ' ' || md.k)
                   OR pg_temp.has_device('SN-' || st.n || '-' || md.k))), 0,
  'enrôlement : aucun code refusé consommé, aucun terminal créé');
SELECT lives_ok(pg_temp.enroll_sql('enr ' || st.state || ' ' || md.k, 'SN-' || st.n || '-' || md.k),
                'enrôlement permis : ' || st.state || ' / ' || coalesce(md.mode, 'NULL'))
  FROM st, md WHERE NOT pg_temp.refused(st.state, md.mode) ORDER BY st.n, md.k;
SELECT is((SELECT pg_temp.writes() FROM w0), (SELECT array_agg(x + 12 ORDER BY i) FROM w0,
                                                     unnest(w) WITH ORDINALITY u(x, i)),
  'enrôlement : 12 réussites, chacune un terminal, un code consommé, un jeton, une ligne d''historique');
SELECT is((SELECT d.event_id FROM device d WHERE d.serial = 'SN-6-top'), pg_temp.ev(6),
  'TOPUP_DESK sur Android enrôlé en REFUND_WINDOW, rattaché à l''événement du code');
SELECT ok(NOT pg_temp.has_device('SN-7-top') AND NOT pg_temp.used('enr CLOSED top'),
  'TOPUP_DESK sur Android refusé en CLOSED, code non consommé');
-- Ordre des contrôles : les refus de 0022 passent avant celui de l'état de l'événement.
SELECT throws_ok(pg_temp.enroll_sql('enr DRAFT cat', 'SN-again'), 'CL025', NULL,
  'code déjà utilisé : CL025 (avant l''état)');
SELECT pg_temp.raw_code('ios topup closed', pg_temp.ev(7), NULL, 'TOPUP_DESK');
SELECT throws_ok(pg_temp.enroll_sql('ios topup closed', 'SN-ios-closed', 'IOS'), 'CL027', NULL,
  'iOS sur un code TOPUP_DESK d''un événement CLOSED : CL027 (le mode avant l''état)');
SELECT pg_temp.raw_code('expired closed', pg_temp.ev(7), NULL, 'TOPUP_DESK', '-2 days', '-1 day');
SELECT throws_ok(pg_temp.enroll_sql('expired closed', 'SN-exp-closed'), 'CL026', NULL,
  'code expiré d''un événement CLOSED : CL026 (l''expiration avant l''état)');
SELECT throws_ok(pg_temp.enroll_sql('enr CLOSED cat', ''), 'CL001', NULL,
  'paramètre invalide sur un code d''un événement CLOSED : CL001 (les paramètres d''abord)');

-- 4. Point de vente du code hors de l'événement du code ------------------------------------------
-- a) Code émis sur d010 avec f110, puis participation de f110 déplacée vers d011 (garde du
--    rattachement désactivé en propriétaire, le temps de simuler un rattachement devenu faux).
SELECT pg_temp.a();
SELECT ok(create_device_enrollment_code(pg_temp.h('code pos moved'), pg_temp.id('35d010'),
                                        pg_temp.id('35f110'), 'CATALOG_POS', false, NULL,
                                        pg_temp.id('35e001')) IS NOT NULL,
  'point de vente : code émis sur d010 avec f110');
ALTER TABLE merchant_participation DISABLE TRIGGER participation_guard;
UPDATE merchant_participation SET event_id = pg_temp.id('35d011') WHERE id = pg_temp.id('35f010');
ALTER TABLE merchant_participation ENABLE TRIGGER participation_guard;
SELECT pg_temp.none();
SELECT throws_ok(pg_temp.enroll_sql('pos moved', 'SN-pos-moved'), 'CL031', NULL,
  'point de vente rattaché à un autre événement que celui du code : CL031');
SELECT ok(NOT pg_temp.used('pos moved') AND NOT pg_temp.has_device('SN-pos-moved'),
  'point de vente hors de l''événement : code non consommé, aucun terminal');
ALTER TABLE merchant_participation DISABLE TRIGGER participation_guard;
UPDATE merchant_participation SET event_id = pg_temp.id('35d010') WHERE id = pg_temp.id('35f010');
ALTER TABLE merchant_participation ENABLE TRIGGER participation_guard;
SELECT lives_ok(pg_temp.enroll_sql('pos moved', 'SN-pos-moved'),
  'point de vente rendu à l''événement du code : enrôlement permis');
-- b) Code inséré en propriétaire avec un point de vente d'un autre événement (d011).
SELECT pg_temp.raw_code('pos other event', pg_temp.id('35d010'), pg_temp.id('35f111'), 'KEYPAD_TPE');
SELECT throws_ok(pg_temp.enroll_sql('pos other event', 'SN-pos-other'), 'CL031', NULL,
  'code portant le point de vente d''un autre événement : CL031');
SELECT ok(NOT pg_temp.used('pos other event'), 'point de vente d''un autre événement : code non consommé');

-- 5. Verrou de l'enrôlement ----------------------------------------------------------------------
SELECT pg_temp.raw_code('lock enroll', pg_temp.id('35d021'), NULL, 'CATALOG_POS');
SELECT is(pg_temp.event_lock_modes(pg_temp.id('35d021')) @> ARRAY['For Share'], false,
  'verrou (enrôlement) : événement d021 sans verrou de partage avant l''appel');
SELECT is((SELECT e.next_seq FROM enroll_device(
             pg_temp.h('code lock enroll'), 'SN-lock', 'ANDROID', '1.0.0',
             decode(repeat('ab', 91), 'hex'), decode('04' || repeat('cd', 64), 'hex'),
             pg_temp.h('cert lock enroll'), now() + interval '365 days', 'ANDROID_KEY_ATTESTATION',
             'STRONGBOX', pg_temp.h('refresh lock enroll'), now() + interval '30 days') e), 1::bigint,
  'verrou (enrôlement) : enrôlement réussi sur d021');
SELECT ok(pg_temp.event_lock_modes(pg_temp.id('35d021')) && ARRAY['For Share', 'For No Key Update', 'For Update'],
  'verrou (enrôlement) : événement du code verrouillé au moins en partage (pgrowlocks)');

-- 6. Non-régression des refus de 0022 sur un événement LIVE -------------------------------------
SELECT throws_ok(pg_temp.enroll_sql('never issued', 'SN-unknown'), 'CL025', NULL,
  'LIVE : code inconnu -> CL025');
SELECT pg_temp.raw_code('live expired', pg_temp.id('35d010'), NULL, 'CATALOG_POS', '-2 days', '-1 day');
SELECT throws_ok(pg_temp.enroll_sql('live expired', 'SN-live-exp'), 'CL026', NULL,
  'LIVE : code expiré -> CL026');
SELECT pg_temp.raw_code('live ios topup', pg_temp.id('35d010'), NULL, 'TOPUP_DESK');
SELECT throws_ok(pg_temp.enroll_sql('live ios topup', 'SN-live-ios', 'IOS'), 'CL027', NULL,
  'LIVE : iOS en TOPUP_DESK -> CL027');
SELECT pg_temp.raw_code('live serial 1', pg_temp.id('35d010'), NULL, 'CATALOG_POS');
SELECT pg_temp.raw_code('live serial 2', pg_temp.id('35d010'), NULL, 'CATALOG_POS');
SELECT lives_ok(pg_temp.enroll_sql('live serial 1', 'SN-live-dup'), 'LIVE : premier enrôlement du serial');
SELECT throws_ok(pg_temp.enroll_sql('live serial 2', 'SN-live-dup'), 'CL028', NULL,
  'LIVE : serial déjà porté par un terminal actif -> CL028');
SELECT ok(NOT pg_temp.used('live serial 2'), 'LIVE : code du second enrôlement non consommé');
SELECT throws_ok(pg_temp.enroll_sql('live serial 2', repeat('x', 65)), 'CL001', NULL,
  'LIVE : serial trop long -> CL001');
SELECT pg_temp.a();
SELECT throws_ok(pg_temp.emit_sql('live outsider', pg_temp.id('35d010'), NULL, 'CATALOG_POS', '35e003'),
  'P0002', NULL, 'LIVE : émission par un auteur hors périmètre -> P0002');
SELECT throws_ok(format('SELECT create_device_enrollment_code(%L, %L, NULL, ''CATALOG_POS'', false, 100, %L)',
                        pg_temp.h('code live ttl'), pg_temp.id('35d010'), pg_temp.id('35e001')),
  'CL001', NULL, 'LIVE : durée hors bornes -> CL001');
SELECT throws_ok(format('SELECT create_device_enrollment_code(%L, %L, %L, ''CATALOG_POS'', false, NULL, %L)',
                        pg_temp.h('code live pos'), pg_temp.id('35d010'), pg_temp.id('35f111'),
                        pg_temp.id('35e001')),
  'CL001', NULL, 'LIVE : émission avec le point de vente d''un autre événement -> CL001 (0022)');
SELECT throws_ok(format('SELECT create_device_enrollment_code(%L, %L, NULL, ''CATALOG_POS'', true, NULL, %L)',
                        pg_temp.h('code live phone'), pg_temp.id('35d010'), pg_temp.id('35e001')),
  'CL027', NULL, 'LIVE : téléphone personnel hors KEYPAD_TPE -> CL027');

-- 7. Trace du refus (ADR-117) : valeur d'essai EVENT_CLOSED ---------------------------------------
SELECT pg_temp.none();
SELECT lives_ok(format('SELECT record_enrollment_attempt(%L, ''10.35.0.1'', ''EVENT_CLOSED'')',
                       pg_temp.h('code enr CLOSED cat')),
  'essai EVENT_CLOSED admis par record_enrollment_attempt');
SELECT is((SELECT operator_id FROM device_enrollment_attempt
            WHERE address = '10.35.0.1' AND result = 'EVENT_CLOSED'), pg_temp.id('35a001'),
  'essai EVENT_CLOSED rattaché au prestataire du code');
SELECT ok(record_enrollment_refusal(pg_temp.h('code enr CLOSED key'), '10.35.0.2', 'EVENT_CLOSED',
                                    'événement CLOSED', 'SN-7-key', 'ANDROID', 'test', NULL),
  'refus EVENT_CLOSED tracé (essai et audit) par record_enrollment_refusal');
SELECT is((SELECT count(*)::int FROM audit_log
            WHERE action = 'DEVICE_ENROLLMENT_REFUSED' AND after ->> 'result' = 'EVENT_CLOSED'
              AND operator_id = pg_temp.id('35a001')), 1,
  'audit DEVICE_ENROLLMENT_REFUSED écrit pour le refus EVENT_CLOSED');
SELECT throws_ok($$INSERT INTO device_enrollment_attempt (address, result) VALUES ('10.35.0.3', 'EVENT_OPEN')$$,
  '23514', NULL, 'contrainte des essais : seule EVENT_CLOSED a été ajoutée (autre valeur refusée)');
SELECT throws_ok($$SELECT record_enrollment_attempt(NULL, '10.35.0.4', 'EVENT_OPEN')$$, 'CL001', NULL,
  'record_enrollment_attempt : résultat inconnu toujours refusé');
SELECT is((SELECT count(*)::int FROM unnest(ARRAY['ENROLLED','CODE_INVALID','CODE_EXPIRED',
                                                  'MODE_NOT_ALLOWED','ATTESTATION_FAILED',
                                                  'SERIAL_IN_USE','VALIDATION_FAILED','RATE_LIMITED',
                                                  'EVENT_CLOSED']) r
            WHERE pg_get_constraintdef((SELECT oid FROM pg_constraint
                                         WHERE conname = 'device_enrollment_attempt_result'))
                  LIKE '%''' || r || '''%'), 9,
  'contrainte des essais : les huit valeurs de 0022 et EVENT_CLOSED');
SELECT is((SELECT count(*)::int FROM regexp_matches(
             pg_get_constraintdef((SELECT oid FROM pg_constraint
                                    WHERE conname = 'device_enrollment_attempt_result')),
             '''([A-Z_]+)''', 'g')), 9,
  'contrainte des essais : exactement neuf valeurs (aucun élargissement de plus)');

SELECT * FROM finish();
ROLLBACK;
