-- Jetons de rafraîchissement, nonces de requête et garde de statut des terminaux (migration 0023 ;
-- mission identite-enrolement-terminaux, lot WP04 ; R-04, R-07, R-14 ; OP-N65, ADR-108) — pgTAP, écrit à
-- la main (pas un fichier généré).
-- Lancer : pg_prove -d <base> tests/tests_device_tokens.sql (base créée par les migrations, roles.sql et
-- post-roles.sql rejoués).
-- Une seule session : deux échanges réellement concurrents (verrou NOWAIT, résultat IN_PROGRESS) et une
-- révocation pendant une écriture en cours ne se simulent pas ici ; ils sont prouvés par les tests
-- d'intégration de l'API (20 rafraîchissements simultanés, révocation pendant une requête). Verrou
-- de famille (relecture WP04, B1) : un verrou consultatif est réentrant dans une même session et
-- dblink n'est pas installé ; ce fichier prouve donc que le verrou est pris (pg_locks) et où il
-- l'est, et le cas « verrou tenu par une autre session : IN_PROGRESS, puis révocation qui voit le
-- successeur » est confié aux tests à deux connexions de WP15. Dans la
-- transaction du test, now() est fixe : un jeton consommé l'est « maintenant » ; les durées écoulées sont
-- posées en datant consumed_at directement (propriétaire).
\set ON_ERROR_STOP 1
\set QUIET 1
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

-- Identifiants : pg_temp.id('23a001') = '00000000-0000-0000-0000-00000023a001'.
CREATE FUNCTION pg_temp.id(p text) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT ('00000000-0000-0000-0000-' || lpad(p, 12, '0'))::uuid $$;
-- Empreinte de test (32 octets).
CREATE FUNCTION pg_temp.h(p text) RETURNS bytea LANGUAGE sql IMMUTABLE AS
  $$ SELECT sha256(convert_to('0023 ' || p, 'UTF8')) $$;
-- Nonce de test (16 octets par défaut).
CREATE FUNCTION pg_temp.n(p text, p_len int DEFAULT 16) RETURNS bytea LANGUAGE sql IMMUTABLE AS
  $$ SELECT substring(sha512(convert_to('0023 nonce ' || p, 'UTF8')) FROM 1 FOR p_len) $$;

-- Données (propriétaire) ------------------------------------------------------------------------
-- Prestataire A : terminaux aa01 à aa05 ; prestataire B : terminal ab01. Terminaux insérés
-- directement (seule compte ici l'empreinte du certificat).
INSERT INTO party (kind, legal_name) SELECT 'PLATFORM', 'Plateforme (test)'
 WHERE NOT EXISTS (SELECT 1 FROM party WHERE kind = 'PLATFORM');
INSERT INTO party (id, kind, legal_name, country_code) VALUES
 (pg_temp.id('23a001'), 'OPERATOR', 'Prestataire A', 'SN'),
 (pg_temp.id('23a002'), 'OPERATOR', 'Prestataire B', 'CI');
INSERT INTO device (id, operator_id, serial, cert_sha256)
SELECT pg_temp.id(d), pg_temp.id(o), 'T0023-' || d, pg_temp.h('cert ' || c)
  FROM (VALUES ('23aa01', '23a001', 'c1'), ('23aa02', '23a001', 'c2'), ('23aa03', '23a001', 'c3'),
               ('23aa04', '23a001', 'c4'), ('23aa05', '23a001', 'c5'), ('23ab01', '23a002', 'cb')) AS v(d, o, c);

-- Sessions : prestataire A, B, ou aucun.
CREATE FUNCTION pg_temp.a() RETURNS void LANGUAGE sql AS
  $$ SELECT set_config('app.operator_id', pg_temp.id('23a001')::text, true) $$;
CREATE FUNCTION pg_temp.b() RETURNS void LANGUAGE sql AS
  $$ SELECT set_config('app.operator_id', pg_temp.id('23a002')::text, true) $$;
CREATE FUNCTION pg_temp.none() RETURNS void LANGUAGE sql AS
  $$ SELECT set_config('app.operator_id', '', true) $$;
-- Premier jeton (vivant) d'une famille, posé par le propriétaire.
CREATE FUNCTION pg_temp.tok(p_operator text, p_device text, p_family text, p_name text) RETURNS void
LANGUAGE sql AS $$
  INSERT INTO device_refresh_token (operator_id, device_id, family_id, token_hash, expires_at)
  VALUES (pg_temp.id(p_operator), pg_temp.id(p_device), pg_temp.id(p_family), pg_temp.h('tok ' || p_name),
          now() + interval '30 days')
$$;
-- Échange : rend le résultat seul.
CREATE FUNCTION pg_temp.rot(p_tok text, p_cert text, p_new text) RETURNS text LANGUAGE sql AS $$
  SELECT r.outcome FROM rotate_device_refresh_token(pg_temp.h('tok ' || p_tok), pg_temp.h('cert ' || p_cert),
                                                    pg_temp.h('tok ' || p_new), now() + interval '30 days') r
$$;
-- État d'un jeton : 'live', 'consumed', ou le motif de révocation.
CREATE FUNCTION pg_temp.st(p_name text) RETURNS text LANGUAGE sql AS $$
  SELECT coalesce(revoked_reason, CASE WHEN consumed_at IS NULL THEN 'live' ELSE 'consumed' END)
    FROM device_refresh_token WHERE token_hash = pg_temp.h('tok ' || p_name)
$$;
CREATE FUNCTION pg_temp.active(p_device text, p_family text) RETURNS boolean LANGUAGE sql AS
  $$ SELECT device_token_family_active(pg_temp.id(p_device), pg_temp.id(p_family)) $$;
-- Verrou consultatif exclusif de la famille tenu par cette session (clé de 64 bits : 32 bits hauts
-- dans classid, 32 bits bas dans objid, objsubid = 1).
CREATE FUNCTION pg_temp.famlock(p_family text) RETURNS boolean LANGUAGE sql AS $$
  SELECT EXISTS (
    SELECT 1 FROM pg_locks l,
           LATERAL (SELECT hashtextextended('device-token-family:' || pg_temp.id(p_family)::text, 0)
                    AS k) h
     WHERE l.locktype = 'advisory' AND l.pid = pg_backend_pid() AND l.granted
       AND l.mode = 'ExclusiveLock' AND l.objsubid = 1
       AND l.classid = ((h.k >> 32) & 4294967295)::oid AND l.objid = (h.k & 4294967295)::oid)
$$;

-- 1. Structure et droits ------------------------------------------------------------------------
SELECT has_table('device_request_nonce');
SELECT col_is_pk('device_request_nonce', ARRAY['device_id', 'nonce']::name[], 'nonce : clé (device_id, nonce)');
SELECT has_index('device_refresh_token', 'device_refresh_token_device_family_idx', ARRAY['device_id', 'family_id']::name[],
  'index (device_id, family_id) du contrôle de famille');
SELECT is((SELECT count(*)::int FROM pg_proc
            WHERE proname IN ('rotate_device_refresh_token', 'revoke_device_token_family',
                              'device_token_family_active', 'consume_device_nonce',
                              'purge_device_request_nonces', 'assert_device_active')
              AND prosecdef AND proconfig @> ARRAY['search_path=public, pg_temp']), 6,
  'six fonctions SECURITY DEFINER, search_path public, pg_temp');
DROP ROLE IF EXISTS dev_tokens_probe;
CREATE ROLE dev_tokens_probe;
SELECT is((SELECT count(*)::int
             FROM unnest(ARRAY['rotate_device_refresh_token(bytea,bytea,bytea,timestamptz)',
                               'revoke_device_token_family(uuid,uuid,text)',
                               'device_token_family_active(uuid,uuid)',
                               'consume_device_nonce(uuid,bytea,timestamptz,integer)',
                               'purge_device_request_nonces(integer)',
                               'assert_device_active(uuid)']) f
            WHERE has_function_privilege('dev_tokens_probe', f, 'EXECUTE')), 0,
  'aucune des six fonctions n''est exécutable par PUBLIC');
-- Verrou de famille (B1) : en essai dans l'échange, après le terminal et avant le jeton ; en
-- attente dans la révocation, après le contrôle d'appartenance et avant l'UPDATE ; préfixe propre.
CREATE FUNCTION pg_temp.src(p_name text) RETURNS text LANGUAGE sql AS
  $$ SELECT prosrc FROM pg_proc WHERE proname = p_name $$;
CREATE FUNCTION pg_temp.pos(p_name text, p_text text) RETURNS int LANGUAGE sql AS
  $$ SELECT strpos(pg_temp.src(p_name), p_text) $$;
SELECT ok(pg_temp.pos('rotate_device_refresh_token', 'FOR SHARE') > 0
          AND pg_temp.pos('rotate_device_refresh_token', 'FOR SHARE')
            < pg_temp.pos('rotate_device_refresh_token', 'pg_try_advisory_xact_lock(')
          AND pg_temp.pos('rotate_device_refresh_token', 'pg_try_advisory_xact_lock(')
            < pg_temp.pos('rotate_device_refresh_token', '''device-token-family:''')
          AND pg_temp.pos('rotate_device_refresh_token', '''device-token-family:''')
            < pg_temp.pos('rotate_device_refresh_token', 'FOR UPDATE NOWAIT')
          AND pg_temp.pos('rotate_device_refresh_token', 'pg_advisory_xact_lock(') = 0,
  'échange : verrou de famille en essai seulement, après le terminal, avant le jeton');
SELECT ok(pg_temp.pos('revoke_device_token_family', 'IF NOT FOUND') > 0
          AND pg_temp.pos('revoke_device_token_family', 'IF NOT FOUND')
            < pg_temp.pos('revoke_device_token_family',
                          'PERFORM pg_advisory_xact_lock(hashtextextended(''device-token-family:''')
          AND pg_temp.pos('revoke_device_token_family', '''device-token-family:''')
            < pg_temp.pos('revoke_device_token_family', 'UPDATE device_refresh_token'),
  'révocation : verrou de famille en attente, après l''appartenance, avant l''UPDATE');
SELECT is((SELECT count(*)::int FROM pg_proc
            WHERE pronamespace = 'public'::regnamespace AND prosrc LIKE '%device-token-family:%'), 2,
  'préfixe device-token-family : utilisé par l''échange et la révocation seulement');
SELECT is((SELECT count(*)::int FROM pg_proc
            WHERE proname IN ('rotate_device_refresh_token', 'revoke_device_token_family')
              AND prosrc LIKE '%current_setting(''transaction_isolation'') <> ''read committed''%'),
  2, 'échange et révocation de famille : READ COMMITTED exigé');
SELECT ok((SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE relname = 'device_request_nonce'),
  'RLS activée et forcée sur device_request_nonce');
SELECT is((SELECT count(*)::int FROM pg_policies
            WHERE tablename = 'device_request_nonce' AND policyname = 'tenant_isolation'
              AND qual LIKE '%app.operator_id%' AND with_check LIKE '%app.operator_id%'), 1,
  'politique tenant_isolation (lecture et écriture) sur device_request_nonce');
-- Contraintes (propriétaire, écritures directes).
SELECT throws_ok(format($q$INSERT INTO device_request_nonce (operator_id, device_id, nonce, expires_at)
                           VALUES (%L, %L, %L, now())$q$, pg_temp.id('23a001'), pg_temp.id('23aa01'),
                        pg_temp.n('court', 15)), '23514', NULL, 'nonce de 15 octets refusé par la table');
SELECT throws_ok(format($q$INSERT INTO device_request_nonce (operator_id, device_id, nonce, expires_at)
                           VALUES (%L, %L, %L, now())$q$, pg_temp.id('23a001'), pg_temp.id('23aa01'),
                        pg_temp.n('long', 64) || '\x00'::bytea), '23514', NULL,
  'nonce de 65 octets refusé par la table');
INSERT INTO device_request_nonce (operator_id, device_id, nonce, expires_at)
VALUES (pg_temp.id('23a001'), pg_temp.id('23aa01'), pg_temp.n('fixe'), now() + interval '1 hour');
SELECT throws_like(format('UPDATE device_request_nonce SET expires_at = now() WHERE nonce = %L', pg_temp.n('fixe')),
  '%ajout seul%', 'nonce : aucune modification');

-- 2. Rotation, grâce et réutilisation (R-07, OP-N65, ADR-108) ----------------------------------------
SELECT pg_temp.a();
-- Famille f001 du terminal aa01 (certificat c1).
SELECT pg_temp.tok('23a001', '23aa01', '23f001', 'a0');
SELECT is((SELECT r.outcome || ' ' || r.device_id || ' ' || r.family_id
             FROM rotate_device_refresh_token(pg_temp.h('tok a0'), pg_temp.h('cert c1'), pg_temp.h('tok a1'),
                                              now() + interval '30 days') r),
  'ROTATED ' || pg_temp.id('23aa01') || ' ' || pg_temp.id('23f001'), 'rotation simple : terminal et famille rendus');
SELECT is(pg_temp.st('a0'), 'consumed', 'rotation : jeton présenté consommé');
SELECT is(pg_temp.st('a1'), 'live', 'rotation : successeur vivant');
SELECT is((SELECT s.token_hash FROM device_refresh_token t JOIN device_refresh_token s ON s.id = t.successor_id
            WHERE t.token_hash = pg_temp.h('tok a0')), pg_temp.h('tok a1'), 'rotation : successeur rattaché');
SELECT is((SELECT family_id FROM device_refresh_token WHERE token_hash = pg_temp.h('tok a1')), pg_temp.id('23f001'),
  'rotation : successeur dans la même famille');
SELECT ok(pg_temp.active('23aa01', '23f001'), 'famille active après rotation');
-- Réponse perdue : le jeton consommé représenté une fois, dans les 60 s, même certificat.
SELECT is(pg_temp.rot('a0', 'c1', 'a2'), 'GRACE', 'seconde présentation dans la grâce : nouvelle paire');
SELECT is(pg_temp.st('a1'), 'GRACE_REPLACED', 'grâce : successeur jamais utilisé révoqué');
SELECT is(pg_temp.st('a2'), 'live', 'grâce : nouveau successeur vivant');
SELECT ok((SELECT grace_used_at IS NOT NULL FROM device_refresh_token WHERE token_hash = pg_temp.h('tok a0')),
  'grâce : grace_used_at posé');
SELECT is((SELECT s.token_hash FROM device_refresh_token t JOIN device_refresh_token s ON s.id = t.successor_id
            WHERE t.token_hash = pg_temp.h('tok a0')), pg_temp.h('tok a2'), 'grâce : nouveau successeur rattaché');
SELECT is(pg_temp.rot('a1', 'c1', 'a3'), 'INVALID', 'successeur remplacé (réponse perdue) refusé');
SELECT is(pg_temp.st('a2'), 'live', 'successeur remplacé refusé : famille intacte');
SELECT ok(pg_temp.active('23aa01', '23f001'), 'famille active après la grâce');
-- Troisième présentation : la grâce ne sert qu'une fois.
SELECT is(pg_temp.rot('a0', 'c1', 'a4'), 'REUSED', 'troisième présentation : réutilisation');
SELECT is(pg_temp.st('a2'), 'REUSE', 'troisième présentation : famille révoquée (jeton vivant)');
SELECT is(pg_temp.st('a0'), 'REUSE', 'troisième présentation : famille révoquée (jeton consommé)');
SELECT ok(NOT pg_temp.active('23aa01', '23f001'), 'famille révoquée : device_token_family_active faux');
SELECT is(pg_temp.rot('a2', 'c1', 'a5'), 'INVALID', 'jeton d''une famille révoquée refusé');
SELECT is((SELECT count(*)::int FROM device_refresh_token WHERE token_hash IN (pg_temp.h('tok a3'),
           pg_temp.h('tok a4'), pg_temp.h('tok a5'))), 0, 'aucun jeton créé par un échange refusé');

-- Plus de 60 s : famille révoquée (borne d'OP-N65 : échoue si la grâce s'élargit).
SELECT pg_temp.tok('23a001', '23aa02', '23f002', 'b0');
SELECT is(pg_temp.rot('b0', 'c2', 'b1'), 'ROTATED', 'famille f002 : rotation');
UPDATE device_refresh_token SET consumed_at = now() - interval '61 seconds' WHERE token_hash = pg_temp.h('tok b0');
SELECT is(pg_temp.rot('b0', 'c2', 'b2'), 'REUSED', 'présentation après 61 s : réutilisation');
SELECT is(pg_temp.st('b1'), 'REUSE', 'présentation après 61 s : famille révoquée');
-- 59 s : encore dans la grâce.
SELECT pg_temp.tok('23a001', '23aa02', '23f003', 'g0');
SELECT is(pg_temp.rot('g0', 'c2', 'g1'), 'ROTATED', 'famille f003 : rotation');
UPDATE device_refresh_token SET consumed_at = now() - interval '59 seconds' WHERE token_hash = pg_temp.h('tok g0');
SELECT is(pg_temp.rot('g0', 'c2', 'g2'), 'GRACE', 'présentation après 59 s : grâce');
-- Successeur déjà utilisé : ce n'est plus une réponse perdue.
SELECT pg_temp.tok('23a001', '23aa02', '23f004', 'u0');
SELECT is(pg_temp.rot('u0', 'c2', 'u1'), 'ROTATED', 'famille f004 : rotation');
SELECT is(pg_temp.rot('u1', 'c2', 'u2'), 'ROTATED', 'famille f004 : seconde rotation');
SELECT is(pg_temp.rot('u0', 'c2', 'u3'), 'REUSED', 'jeton consommé dont le successeur a servi : réutilisation');
SELECT is(pg_temp.st('u2'), 'REUSE', 'successeur déjà utilisé : famille révoquée');
-- Autre certificat : jeton jamais consommé, puis jeton dans la grâce.
SELECT pg_temp.tok('23a001', '23aa01', '23f005', 'k0');
SELECT is(pg_temp.rot('k0', 'c2', 'k1'), 'REUSED', 'autre certificat (jeton vivant) : réutilisation');
SELECT is(pg_temp.st('k0'), 'REUSE', 'autre certificat : famille révoquée');
SELECT ok(NOT pg_temp.active('23aa01', '23f005'), 'autre certificat : famille inactive');
SELECT pg_temp.tok('23a001', '23aa01', '23f006', 'm0');
SELECT is(pg_temp.rot('m0', 'c1', 'm1'), 'ROTATED', 'famille f006 : rotation');
SELECT is(pg_temp.rot('m0', 'c9', 'm2'), 'REUSED', 'autre certificat dans les 60 s : pas de grâce, réutilisation');
SELECT is(pg_temp.st('m1'), 'REUSE', 'autre certificat dans les 60 s : famille révoquée');

-- Statut du terminal : rien n'est écrit.
SELECT pg_temp.tok('23a001', '23aa03', '23f007', 's0');
UPDATE device SET status = 'SUSPENDED' WHERE id = pg_temp.id('23aa03');
SELECT is(pg_temp.rot('s0', 'c3', 's1'), 'SUSPENDED', 'terminal suspendu : SUSPENDED');
SELECT is(pg_temp.st('s0'), 'live', 'terminal suspendu : jeton intact');
-- Certificat contrôlé avant le statut (relecture WP04, M5) : le jeton volé d'un terminal suspendu
-- ne doit pas redevenir valable à la réactivation.
SELECT is(pg_temp.rot('s0', 'c9', 's2'), 'REUSED', 'terminal suspendu, autre certificat : REUSED');
SELECT is(pg_temp.st('s0'), 'REUSE', 'terminal suspendu, autre certificat : famille révoquée');
SELECT ok(NOT pg_temp.active('23aa03', '23f007'), 'terminal suspendu, autre certificat : inactive');
-- Terminal révoqué dont un jeton serait resté vivant (défense en profondeur).
SELECT pg_temp.tok('23a001', '23aa04', '23f008', 'r0');
UPDATE device SET status = 'REVOKED' WHERE id = pg_temp.id('23aa04');
SELECT is(pg_temp.rot('r0', 'c4', 'r1'), 'REVOKED', 'terminal révoqué, jeton vivant : REVOKED');
SELECT is(pg_temp.st('r0'), 'live', 'terminal révoqué : rien n''est écrit');
-- Terminal révoqué comme le fait set_device_status (familles révoquées) : jeton révoqué.
SELECT pg_temp.tok('23a001', '23aa05', '23f009', 'q0');
UPDATE device SET status = 'REVOKED' WHERE id = pg_temp.id('23aa05');
UPDATE device_refresh_token SET revoked_at = now(), revoked_reason = 'DEVICE_REVOKED'
 WHERE device_id = pg_temp.id('23aa05');
SELECT is(pg_temp.rot('q0', 'c5', 'q1'), 'INVALID', 'terminal révoqué, familles révoquées : INVALID');

-- Inconnu, expiré, autre prestataire.
SELECT is((SELECT r.outcome || ':' || coalesce(r.device_id::text, '-') || ':' || coalesce(r.family_id::text, '-')
             FROM rotate_device_refresh_token(pg_temp.h('tok inconnu'), pg_temp.h('cert c1'), pg_temp.h('tok x1'),
                                              now() + interval '30 days') r),
  'INVALID:-:-', 'jeton inconnu : INVALID, rien n''est rendu');
SELECT is((SELECT r.outcome FROM rotate_device_refresh_token('\x0102'::bytea, pg_temp.h('cert c1'),
                                                             pg_temp.h('tok x2'), now() + interval '30 days') r),
  'INVALID', 'jeton de longueur invalide : INVALID');
INSERT INTO device_refresh_token (operator_id, device_id, family_id, token_hash, created_at, expires_at)
VALUES (pg_temp.id('23a001'), pg_temp.id('23aa01'), pg_temp.id('23f010'), pg_temp.h('tok e0'),
        now() - interval '31 days', now() - interval '1 day');
SELECT is(pg_temp.rot('e0', 'c1', 'e1'), 'INVALID', 'jeton expiré : INVALID');
SELECT is(pg_temp.st('e0'), 'live', 'jeton expiré : rien n''est écrit');
SELECT pg_temp.tok('23a001', '23aa01', '23f011', 'z0');
SELECT pg_temp.b();
SELECT is(pg_temp.rot('z0', 'c1', 'z1'), 'INVALID', 'jeton de A sous la session de B : INVALID');
SELECT is(pg_temp.st('z0'), 'live', 'jeton de A sous la session de B : intact');
SELECT pg_temp.none();
SELECT is(pg_temp.rot('z0', 'c1', 'z1'), 'ROTATED', 'route sans prestataire de session : prestataire du jeton');
SELECT is((SELECT operator_id FROM device_refresh_token WHERE token_hash = pg_temp.h('tok z1')), pg_temp.id('23a001'),
  'successeur rattaché au prestataire du jeton');
SELECT pg_temp.a();

-- Paramètres.
SELECT throws_ok($$SELECT * FROM rotate_device_refresh_token(pg_temp.h('tok z1'), NULL, pg_temp.h('tok p1'),
                                                             now() + interval '30 days')$$,
  'CL001', NULL, 'empreinte du certificat absente refusée');
SELECT throws_ok($$SELECT * FROM rotate_device_refresh_token(pg_temp.h('tok z1'), pg_temp.h('cert c1'), '\x01'::bytea,
                                                             now() + interval '30 days')$$,
  'CL001', NULL, 'nouvelle empreinte de longueur invalide refusée');
SELECT throws_ok($$SELECT * FROM rotate_device_refresh_token(pg_temp.h('tok z1'), pg_temp.h('cert c1'),
                                                             pg_temp.h('tok p2'), now() - interval '1 second')$$,
  'CL001', NULL, 'nouveau jeton déjà expiré refusé');
SELECT throws_ok($$SELECT * FROM rotate_device_refresh_token(pg_temp.h('tok z1'), pg_temp.h('cert c1'),
                                                             pg_temp.h('tok z1'), now() + interval '30 days')$$,
  'CL001', NULL, 'nouveau jeton identique au jeton présenté refusé');
SELECT is(pg_temp.st('z1'), 'live', 'paramètres refusés : jeton intact');

-- 3. Familles -------------------------------------------------------------------------------------
SELECT pg_temp.tok('23a001', '23aa01', '23f012', 'v0');
SELECT ok(pg_temp.active('23aa01', '23f012'), 'famille f012 active');
SELECT ok(NOT pg_temp.active('23aa02', '23f012'), 'famille d''un autre terminal : inactive pour celui-ci');
SELECT pg_temp.b();
SELECT ok(NOT pg_temp.active('23aa01', '23f012'), 'famille de A sous la session de B : inactive');
SELECT throws_ok(format('SELECT revoke_device_token_family(%L, %L, ''REUSE'')', pg_temp.id('23aa01'),
                        pg_temp.id('23f012')), 'P0002', NULL,
  'révocation d''une famille de A sous la session de B : introuvable');
SELECT pg_temp.none();
SELECT ok(NOT pg_temp.active('23aa01', '23f012'), 'sans prestataire de session : famille inactive (échec fermé)');
SELECT throws_ok(format('SELECT revoke_device_token_family(%L, %L, ''REUSE'')', pg_temp.id('23aa01'),
                        pg_temp.id('23f012')), 'P0002', NULL, 'révocation sans prestataire de session : introuvable');
SELECT pg_temp.a();
SELECT throws_ok(format('SELECT revoke_device_token_family(%L, %L, ''GRACE_REPLACED'')', pg_temp.id('23aa01'),
                        pg_temp.id('23f012')), 'CL001', NULL, 'motif GRACE_REPLACED refusé pour une famille');
SELECT throws_ok(format('SELECT revoke_device_token_family(%L, %L, NULL)', pg_temp.id('23aa01'),
                        pg_temp.id('23f012')), 'CL001', NULL, 'motif absent refusé');
SELECT throws_ok(format('SELECT revoke_device_token_family(%L, %L, ''REUSE'')', pg_temp.id('23aa01'),
                        pg_temp.id('23f999')), 'P0002', NULL, 'famille inconnue : introuvable');
SELECT is(revoke_device_token_family(pg_temp.id('23aa01'), pg_temp.id('23f012'), 'REENROLLED'), 1,
  'révocation de la famille : un jeton révoqué');
SELECT is(pg_temp.st('v0'), 'REENROLLED', 'révocation : motif posé');
SELECT ok(NOT pg_temp.active('23aa01', '23f012'), 'famille révoquée : inactive');
SELECT is(revoke_device_token_family(pg_temp.id('23aa01'), pg_temp.id('23f012'), 'REUSE'), 0,
  'seconde révocation : aucun jeton, motif inchangé');
SELECT is(pg_temp.st('v0'), 'REENROLLED', 'seconde révocation : premier motif conservé');
SELECT ok(pg_temp.active('23aa01', '23f011'), 'autre famille du terminal intacte');
-- Famille dont le jeton vivant a expiré : inactive.
SELECT ok(NOT pg_temp.active('23aa01', '23f010'), 'famille au jeton expiré : inactive');
-- Verrou de famille effectivement pris (B1) : absent avant l'appel, tenu après (jusqu'à la fin de
-- la transaction), sur la seule famille concernée.
SELECT pg_temp.tok('23a001', '23aa01', '23f013', 'l0');
SELECT pg_temp.tok('23a001', '23aa01', '23f014', 'l2');
SELECT ok(NOT pg_temp.famlock('23f013') AND NOT pg_temp.famlock('23f014'),
  'verrou de famille : non tenu avant l''échange et la révocation');
SELECT is(pg_temp.rot('l0', 'c1', 'l1'), 'ROTATED', 'famille f013 : rotation');
SELECT ok(pg_temp.famlock('23f013'), 'échange : verrou de la famille tenu');
SELECT ok(NOT pg_temp.famlock('23f014'), 'échange : verrou d''une autre famille non pris');
SELECT is(revoke_device_token_family(pg_temp.id('23aa01'), pg_temp.id('23f014'), 'REUSE'), 1,
  'famille f014 : révocation');
SELECT ok(pg_temp.famlock('23f014'), 'révocation : verrou de la famille tenu');

-- 4. Nonces de requête (R-04) ---------------------------------------------------------------------
SELECT is(consume_device_nonce(pg_temp.id('23aa01'), pg_temp.n('n1'), now() - interval '30 seconds', 60), 'OK',
  'nonce neuf dans la tolérance : OK');
SELECT is((SELECT expires_at FROM device_request_nonce
            WHERE device_id = pg_temp.id('23aa01') AND nonce = pg_temp.n('n1')),
  now() - interval '30 seconds' + interval '120 seconds', 'nonce : expires_at = created + 2 × tolérance');
SELECT is((SELECT operator_id FROM device_request_nonce
            WHERE device_id = pg_temp.id('23aa01') AND nonce = pg_temp.n('n1')),
  pg_temp.id('23a001'), 'nonce rattaché au prestataire de la session');
SELECT is(consume_device_nonce(pg_temp.id('23aa01'), pg_temp.n('n1'), now() - interval '30 seconds', 60), 'REPLAY',
  'même nonce, même terminal : REPLAY');
SELECT is(consume_device_nonce(pg_temp.id('23aa01'), pg_temp.n('n1'), now(), 60), 'REPLAY',
  'même nonce avec une autre heure : REPLAY');
SELECT is(consume_device_nonce(pg_temp.id('23aa02'), pg_temp.n('n1'), now(), 60), 'OK',
  'même nonce, autre terminal : OK');
SELECT is(consume_device_nonce(pg_temp.id('23aa01'), pg_temp.n('n2'), now() - interval '61 seconds', 60), 'CLOCK_SKEW',
  'requête trop ancienne : CLOCK_SKEW');
SELECT is(consume_device_nonce(pg_temp.id('23aa01'), pg_temp.n('n2'), now() + interval '61 seconds', 60), 'CLOCK_SKEW',
  'requête dans le futur : CLOCK_SKEW');
SELECT is((SELECT count(*)::int FROM device_request_nonce WHERE nonce = pg_temp.n('n2')), 0,
  'hors tolérance : rien n''est écrit');
SELECT is(consume_device_nonce(pg_temp.id('23aa01'), pg_temp.n('n2'), now() - interval '60 seconds', 60), 'OK',
  'borne de la tolérance (60 s) acceptée ; nonce resté libre après CLOCK_SKEW');
SELECT is(consume_device_nonce(pg_temp.id('23aa01'), pg_temp.n('n3', 64), now() + interval '300 seconds', 300), 'OK',
  'tolérance de 300 s et nonce de 64 octets acceptés');
SELECT throws_ok(format('SELECT consume_device_nonce(%L, %L, now(), 301)', pg_temp.id('23aa01'), pg_temp.n('n4')),
  'CL001', NULL, 'tolérance de 301 s refusée');
SELECT throws_ok(format('SELECT consume_device_nonce(%L, %L, now(), 0)', pg_temp.id('23aa01'), pg_temp.n('n4')),
  'CL001', NULL, 'tolérance nulle refusée');
SELECT throws_ok(format('SELECT consume_device_nonce(%L, %L, now(), NULL)', pg_temp.id('23aa01'), pg_temp.n('n4')),
  'CL001', NULL, 'tolérance absente refusée');
SELECT throws_ok(format('SELECT consume_device_nonce(%L, %L, now(), 60)', pg_temp.id('23aa01'), pg_temp.n('n4', 15)),
  'CL001', NULL, 'nonce de 15 octets refusé');
SELECT throws_ok(format('SELECT consume_device_nonce(%L, %L, now(), 60)', pg_temp.id('23aa01'),
                        pg_temp.n('n4', 64) || '\x00'::bytea), 'CL001', NULL, 'nonce de 65 octets refusé');
SELECT throws_ok(format('SELECT consume_device_nonce(%L, %L, NULL, 60)', pg_temp.id('23aa01'), pg_temp.n('n4')),
  'CL001', NULL, 'heure de création absente refusée');
SELECT throws_ok(format('SELECT consume_device_nonce(%L, %L, now(), 60)', pg_temp.id('23ab01'), pg_temp.n('n4')),
  'P0002', NULL, 'terminal de B sous la session de A : introuvable');
SELECT pg_temp.none();
SELECT throws_ok(format('SELECT consume_device_nonce(%L, %L, now(), 60)', pg_temp.id('23aa01'), pg_temp.n('n4')),
  'P0002', NULL, 'sans prestataire de session : introuvable');
SELECT pg_temp.b();
SELECT is(consume_device_nonce(pg_temp.id('23ab01'), pg_temp.n('nb'), now(), 60), 'OK', 'B : nonce de son terminal');
SELECT pg_temp.a();
SELECT is((SELECT count(*)::int FROM device_request_nonce WHERE nonce = pg_temp.n('n4')), 0,
  'appels refusés : rien n''est écrit');

-- Purge (heure de la base ; marge de 300 s après expires_at).
INSERT INTO device_request_nonce (operator_id, device_id, nonce, expires_at)
SELECT pg_temp.id('23a001'), pg_temp.id('23aa02'), pg_temp.n('vieux ' || i), now() - interval '301 seconds'
  FROM generate_series(1, 3) i;
INSERT INTO device_request_nonce (operator_id, device_id, nonce, expires_at)
VALUES (pg_temp.id('23a001'), pg_temp.id('23aa02'), pg_temp.n('marge'), now() - interval '299 seconds');
SELECT throws_ok('SELECT purge_device_request_nonces(0)', 'CL001', NULL, 'purge : lot nul refusé');
SELECT throws_ok('SELECT purge_device_request_nonces(10001)', 'CL001', NULL, 'purge : lot de plus de 10000 refusé');
SELECT is(purge_device_request_nonces(2), 2::bigint, 'purge par lots : deux lignes au plus');
SELECT is(purge_device_request_nonces(), 1::bigint, 'purge : le reste des nonces expirés depuis plus de 300 s');
SELECT is(purge_device_request_nonces(), 0::bigint, 'purge : plus rien à retirer');
SELECT is((SELECT count(*)::int FROM device_request_nonce WHERE nonce = pg_temp.n('marge')), 1,
  'purge : nonce expiré depuis moins de 300 s conservé');
SELECT is(consume_device_nonce(pg_temp.id('23aa01'), pg_temp.n('n1'), now(), 60), 'REPLAY',
  'purge : nonces non expirés conservés (rejeu toujours refusé)');

-- 5. Garde de statut (R-14) -----------------------------------------------------------------------
SELECT lives_ok(format('SELECT assert_device_active(%L)', pg_temp.id('23aa01')), 'terminal actif : garde passée');
SELECT throws_ok(format('SELECT assert_device_active(%L)', pg_temp.id('23aa03')), 'CL030', NULL,
  'terminal suspendu : CL030 (DEVICE_SUSPENDED)');
SELECT throws_ok(format('SELECT assert_device_active(%L)', pg_temp.id('23aa04')), '42501', NULL,
  'terminal révoqué : 42501 (DEVICE_REVOKED)');
SELECT throws_ok(format('SELECT assert_device_active(%L)', pg_temp.id('23ab01')), 'P0002', NULL,
  'terminal de B sous la session de A : introuvable');
SELECT throws_ok('SELECT assert_device_active(NULL)', 'P0002', NULL, 'terminal absent : introuvable');
SELECT pg_temp.none();
SELECT throws_ok(format('SELECT assert_device_active(%L)', pg_temp.id('23aa01')), 'P0002', NULL,
  'sans prestataire de session : introuvable');
SELECT pg_temp.b();
SELECT lives_ok(format('SELECT assert_device_active(%L)', pg_temp.id('23ab01')), 'B : son terminal actif');

-- 6. Isolation à deux prestataires ------------------------------------------------------------------
-- Jeton de B (famille fb01) ; ses opérations sous la session de A n'aboutissent pas.
SELECT pg_temp.tok('23a002', '23ab01', '23fb01', 'w0');
SELECT pg_temp.a();
SELECT is(pg_temp.rot('w0', 'cb', 'w1'), 'INVALID', 'jeton de B sous la session de A : INVALID');
SELECT ok(NOT pg_temp.active('23ab01', '23fb01'), 'famille de B inactive sous la session de A');
SELECT pg_temp.b();
SELECT ok(pg_temp.active('23ab01', '23fb01'), 'famille de B active sous la session de B');
SELECT is(pg_temp.rot('w0', 'cb', 'w1'), 'ROTATED', 'B : rotation de son jeton');
-- Rôle sonde soumis à la RLS, avec SELECT seulement (les droits des rôles applicatifs sont posés par
-- post-roles.sql, lot WP07).
GRANT SELECT ON device_request_nonce, device_refresh_token TO dev_tokens_probe;
SET LOCAL ROLE dev_tokens_probe;
SELECT set_config('app.operator_id', '00000000-0000-0000-0000-00000023a001', true);
SELECT is((SELECT count(*)::int FROM device_request_nonce WHERE operator_id <> '00000000-0000-0000-0000-00000023a001'),
  0, 'A : aucun nonce de B visible');
SELECT ok((SELECT count(*) FROM device_request_nonce) > 0, 'A : ses nonces visibles');
SELECT is((SELECT count(*)::int FROM device_refresh_token WHERE operator_id <> '00000000-0000-0000-0000-00000023a001'),
  0, 'A : aucun jeton de B visible');
SELECT set_config('app.operator_id', '00000000-0000-0000-0000-00000023a002', true);
SELECT is((SELECT count(*)::int FROM device_request_nonce), 1, 'B : son seul nonce visible');
SELECT is((SELECT count(*)::int FROM device_refresh_token WHERE device_id = '00000000-0000-0000-0000-00000023aa01'),
  0, 'B : aucun jeton du terminal de A visible');
RESET ROLE;
-- Écriture : une ligne du prestataire de la session passe (le droit suffit, 42501 étant aussi le
-- SQLSTATE d'un droit manquant), la même au nom de B sous la session de A est refusée (WITH CHECK).
GRANT INSERT ON device_request_nonce TO dev_tokens_probe;
SET LOCAL ROLE dev_tokens_probe;
SELECT set_config('app.operator_id', '00000000-0000-0000-0000-00000023a001', true);
SELECT lives_ok($q$INSERT INTO device_request_nonce (operator_id, device_id, nonce, expires_at)
                   VALUES ('00000000-0000-0000-0000-00000023a001', '00000000-0000-0000-0000-00000023aa01',
                           sha256('sonde nonce A'::bytea), now() + interval '1 hour')$q$,
  'écriture : A insère un nonce à son nom');
SELECT throws_ok($q$INSERT INTO device_request_nonce (operator_id, device_id, nonce, expires_at)
                    VALUES ('00000000-0000-0000-0000-00000023a002', '00000000-0000-0000-0000-00000023ab01',
                            sha256('sonde nonce B'::bytea), now() + interval '1 hour')$q$,
  '42501', NULL, 'écriture : nonce au nom de B sous la session de A refusé (WITH CHECK)');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
