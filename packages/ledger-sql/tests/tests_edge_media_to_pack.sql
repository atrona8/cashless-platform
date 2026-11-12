-- Lecture étroite des bracelets à sceller (migration 0067 ; mission passerelle-locale, lot WP15, T068 ; décision 41,
-- ADR-183) — pgTAP, écrit à la main. Les données sont posées par le propriétaire, la fonction est appelée SOUS LE RÔLE
-- cashless_tagkeys (SET LOCAL ROLE). Lancer depuis packages/ledger-sql : pg_prove -d <base> tests/tests_edge_media_to_pack.sql
-- Preuves : seul cashless_tagkeys l'exécute ; autre prestataire, autre événement, autre passerelle, STANDBY, délai non
-- écoulé, révoquée : rien n'est rendu ; jamais de clair (seul le chiffré stocké sort).
\set ON_ERROR_STOP 1
\set QUIET 1
BEGIN;
\ir _grants_for_tests.sql
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();
SET CONSTRAINTS ALL IMMEDIATE;

CREATE FUNCTION pg_temp.id(p text) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT ('00000000-0000-0000-0000-' || lpad(p, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.ctx(p text) RETURNS void LANGUAGE sql AS
  $$ SELECT set_config('app.operator_id', pg_temp.id(p)::text, true) $$;
CREATE FUNCTION pg_temp.st(q text) RETURNS text LANGUAGE plpgsql AS
  $$ BEGIN EXECUTE q; RETURN 'OK'; EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE; END $$;
-- Bracelets rendus pour une passerelle (liste triée des identifiants courts), sous le rôle courant.
CREATE FUNCTION pg_temp.got(p_gw text) RETURNS text[] LANGUAGE plpgsql AS $$
DECLARE r text[];
BEGIN
  SELECT coalesce(array_agg(right(media_id::text, 4) ORDER BY media_id), ARRAY[]::text[]) INTO r
    FROM edge_media_to_pack(pg_temp.id(p_gw), 100) WHERE media_id IS NOT NULL;
  RETURN r;
END $$;

INSERT INTO party (kind, legal_name) SELECT 'PLATFORM', 'Plateforme (test)'
 WHERE NOT EXISTS (SELECT 1 FROM party WHERE kind = 'PLATFORM');
INSERT INTO party (id, kind, legal_name, country_code) VALUES
 (pg_temp.id('67a001'), 'OPERATOR', 'Prestataire A', 'SN'), (pg_temp.id('67a002'), 'OPERATOR', 'Prestataire B', 'CI');
INSERT INTO party (id, kind, operator_id, legal_name) VALUES
 (pg_temp.id('67b001'), 'ORGANIZER', pg_temp.id('67a001'), 'Organisateur A'),
 (pg_temp.id('67b011'), 'ORGANIZER', pg_temp.id('67a002'), 'Organisateur B');
INSERT INTO jurisdiction_profile (id, country_code, version, valid_from, breakage_destination)
VALUES (pg_temp.id('67c001'), 'SN', 670067, '2026-01-01', 'ORGANIZER');
INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone, jurisdiction_id, funds_holder, status)
SELECT pg_temp.id(e), pg_temp.id(o), pg_temp.id(g), 'Événement ' || e, 'XOF', 'Africa/Dakar',
       pg_temp.id('67c001'), 'ORGANIZER', 'LIVE'
  FROM (VALUES ('67d001','67a001','67b001'), ('67d002','67a001','67b001'), ('67d011','67a002','67b011')) AS v(e, o, g);
SELECT pg_temp.ctx('67a001'); SELECT open_event_ledger(pg_temp.id('67d001')); SELECT open_event_ledger(pg_temp.id('67d002'));
SELECT pg_temp.ctx('67a002'); SELECT open_event_ledger(pg_temp.id('67d011'));
-- Passerelles : e001 PRIMARY (d001), e002 STANDBY (d001), e003 PRIMARY inscrite il y a une minute, e004 PRIMARY (d002),
-- e005 PRIMARY révoquée, e011 PRIMARY du prestataire B.
INSERT INTO edge_gateway (id, operator_id, event_id, serial, role, agreement_public_key, registered_at, status)
SELECT pg_temp.id(g), pg_temp.id(o), pg_temp.id(e), s, r, decode('04' || repeat(x, 64), 'hex'), now() - age,
       CASE WHEN g = '67e005' THEN 'REVOKED' ELSE 'ACTIVE' END
  FROM (VALUES ('67e001','67a001','67d001','GW1','PRIMARY','11', interval '1 day'),
               ('67e002','67a001','67d001','GW2','STANDBY','12', interval '1 day'),
               ('67e003','67a001','67d001','GW3','PRIMARY','13', interval '1 minute'),
               ('67e004','67a001','67d002','GW4','PRIMARY','14', interval '1 day'),
               ('67e005','67a001','67d001','GW5','PRIMARY','15', interval '1 day'),
               ('67e011','67a002','67d011','GWB','PRIMARY','16', interval '1 day')) AS v(g, o, e, s, r, x, age);
INSERT INTO tag_key (operator_id, key_index, kms_key_ref) VALUES
 (pg_temp.id('67a001'), 1, 'test:hmac-67'), (pg_temp.id('67a002'), 1, 'test:hmac-67b');
INSERT INTO tag_data_key (id, operator_id, key_index, version, wrapping_kms_key_ref, encrypted_dek)
SELECT pg_temp.id('67900' || n), pg_temp.id('67a00' || CASE WHEN n = 1 THEN '1' ELSE '2' END), 1, 1, 'test:wrap', '\xdeadbeef'
  FROM generate_series(1, 2) n;
-- Lots et bracelets : 0001, 0002 (d001), 0004 (d002), 0011 (prestataire B) ; 0003 sans mot de passe stocké.
INSERT INTO media_batch (id, operator_id, organizer_id, event_id, kind, quantity, key_index) VALUES
 (pg_temp.id('67f001'), pg_temp.id('67a001'), pg_temp.id('67b001'), pg_temp.id('67d001'), 'PUBLIC', 10, 1),
 (pg_temp.id('67f002'), pg_temp.id('67a001'), pg_temp.id('67b001'), pg_temp.id('67d002'), 'PUBLIC', 10, 1),
 (pg_temp.id('67f011'), pg_temp.id('67a002'), pg_temp.id('67b011'), pg_temp.id('67d011'), 'PUBLIC', 10, 1);
INSERT INTO media (id, operator_id, kind, token_hash, nfc_uid, batch_id, key_index, status, personalized_at,
                   pwd_pack_enc, pwd_pack_dek_id)
SELECT pg_temp.id(m), pg_temp.id(o), 'NFC_TAG', sha256(convert_to(m, 'UTF8')), decode('04670000' || lpad(m, 6, '0'), 'hex'),
       pg_temp.id(b), 1, 'PERSONALIZED', CASE WHEN has_pwd THEN timestamptz '2026-10-01 10:00:00+00' END,
       CASE WHEN has_pwd THEN decode(repeat('ab', 34), 'hex') END,
       CASE WHEN has_pwd THEN pg_temp.id('67900' || CASE WHEN o = '67a001' THEN '1' ELSE '2' END) END
  FROM (VALUES ('670001','67a001','67f001', true), ('670002','67a001','67f001', true), ('670003','67a001','67f001', false),
               ('670004','67a001','67f002', true), ('670011','67a002','67f011', true)) AS v(m, o, b, has_pwd);

-- 1. Droits : cashless_tagkeys seul ------------------------------------------------------------------------------
SELECT is((SELECT array_agg(r.rolname::text ORDER BY r.rolname) FROM pg_roles r
            WHERE r.rolname LIKE 'cashless\_%' AND r.rolsuper IS NOT TRUE
              AND has_function_privilege(r.oid, 'edge_media_to_pack(uuid,integer)', 'EXECUTE')),
  ARRAY['cashless_tagkeys'], 'EXECUTE : cashless_tagkeys seul parmi les rôles cashless_*');
SELECT ok(NOT has_function_privilege('public', 'edge_media_to_pack(uuid,integer)', 'EXECUTE'), 'rien pour PUBLIC');
SELECT ok((SELECT prosecdef AND proconfig @> ARRAY['search_path=public, pg_temp'] FROM pg_proc
            WHERE proname = 'edge_media_to_pack'), 'SECURITY DEFINER, search_path = public, pg_temp');
SELECT pg_temp.ctx('67a001');
SELECT is(pg_temp.st(format('SET LOCAL ROLE %I; SELECT * FROM edge_media_to_pack(%L, 10)', r, pg_temp.id('67e001'))),
  '42501', r || ' : appel refusé')
  FROM unnest(ARRAY['cashless_app', 'cashless_edge', 'cashless_edgeadmin', 'cashless_maint', 'cashless_perso',
                    'cashless_platform']) r;
RESET ROLE;

-- 2. Rendu sous cashless_tagkeys -----------------------------------------------------------------------------------
SELECT pg_temp.ctx('67a001');
SELECT set_config('t.ledger', edge_ref_event_ledger(pg_temp.id('67d001'))::text, true);
SET LOCAL ROLE cashless_tagkeys;
SELECT is(pg_temp.got('67e001'), ARRAY['0001', '0002'], 'PRIMARY de d001 : ses deux bracelets avec mot de passe, ni 0003 (sans), ni 0004 (autre événement), ni 0011');
SELECT is(pg_temp.got('67e004'), ARRAY['0004'], 'autre passerelle (autre événement) : seulement le bracelet de son événement');
SELECT is(pg_temp.got('67e002'), ARRAY[]::text[], 'STANDBY : rien');
SELECT is(pg_temp.got('67e003'), ARRAY[]::text[], 'PRIMARY dans le délai de 30 minutes : rien');
SELECT is(pg_temp.got('67e005'), ARRAY[]::text[], 'passerelle révoquée : rien');
SELECT is((SELECT count(*)::int FROM edge_media_to_pack(pg_temp.id('67e002'), 100)), 0, 'STANDBY : aucune ligne, pas même le contexte');
SELECT is((SELECT count(DISTINCT ledger_id)::int FROM edge_media_to_pack(pg_temp.id('67e001'), 100)), 1, 'un seul grand livre');
SELECT is((SELECT ledger_id FROM edge_media_to_pack(pg_temp.id('67e001'), 1)), current_setting('t.ledger')::uuid,
  'le grand livre rendu est celui de l''événement de la passerelle');
SELECT is((SELECT pwd_pack_enc FROM edge_media_to_pack(pg_temp.id('67e001'), 100) WHERE media_id = pg_temp.id('670001')),
  decode(repeat('ab', 34), 'hex'), 'seul le chiffré stocké sort (jamais de clair)');
SELECT throws_ok($$SELECT * FROM edge_media_to_pack(NULL, 10)$$, 'P0002', NULL, 'passerelle absente : refusée');
SELECT throws_ok($$SELECT * FROM edge_media_to_pack(gen_random_uuid(), 10)$$, 'P0002', NULL, 'passerelle inconnue : refusée');
SELECT throws_ok(format('SELECT * FROM edge_media_to_pack(%L, 0)', pg_temp.id('67e001')), 'CL001', NULL, 'limite 0 refusée');
SELECT is((SELECT count(*)::int FROM edge_media_to_pack(pg_temp.id('67e001'), 1) WHERE media_id IS NOT NULL), 1, 'limite respectée');
-- Autre prestataire : ni sa passerelle depuis A, ni celle de A depuis B.
SELECT throws_ok(format('SELECT * FROM edge_media_to_pack(%L, 10)', pg_temp.id('67e011')), 'P0002', NULL,
  'prestataire A, passerelle de B : refusé, rien rendu');
SELECT pg_temp.ctx('67a002');
SELECT throws_ok(format('SELECT * FROM edge_media_to_pack(%L, 10)', pg_temp.id('67e001')), 'P0002', NULL,
  'prestataire B, passerelle de A : refusé, rien rendu');
SELECT is(pg_temp.got('67e011'), ARRAY['0011'], 'prestataire B : ses propres bracelets seulement');
SELECT pg_temp.ctx('67a001');
SELECT set_config('app.operator_id', '', true);
SELECT throws_ok(format('SELECT * FROM edge_media_to_pack(%L, 10)', pg_temp.id('67e001')), 'P0002', NULL, 'sans prestataire en contexte : refusé');
SELECT pg_temp.ctx('67a001');

-- 3. Colis déposé : plus rendu ; version changée : rendu de nouveau ; clé d'accord changée : tout revient -----------
SELECT deposit_edge_pwd_pack_key(pg_temp.id('67e001'), sha256(decode('04' || repeat('11', 64), 'hex')),
  jsonb_build_object('alg', 'ECDH-ES+HKDF-SHA256+A256GCM', 'epk', 'AA', 'iv', 'AA', 'wrapped_key', 'AA'));
RESET ROLE;
-- Migration 0071 : le dépôt d'un colis entre dans le flux de réplication (sans cela, une passerelle déjà en marche ne
-- le revoit jamais : elle ne relit que les bracelets de sa fenêtre de changements).
CREATE FUNCTION pg_temp.emitted(p_media text) RETURNS int LANGUAGE sql AS $f$
  SELECT count(*)::int FROM edge_reference_change
   WHERE ledger_id = current_setting('t.ledger')::uuid AND entity_id = pg_temp.id(p_media)
     AND change_seq > current_setting('t.seq0')::bigint $f$;
SELECT set_config('t.seq0', coalesce(max(change_seq), 0)::text, true) FROM edge_reference_change
 WHERE ledger_id = current_setting('t.ledger')::uuid;
SET LOCAL ROLE cashless_tagkeys;
SELECT deposit_edge_pwd_pack(pg_temp.id('67e001'), media_id, decode(repeat('cd', 34), 'hex'),
                             sha256(decode(repeat('cd', 34), 'hex')), media_version)
  FROM edge_media_to_pack(pg_temp.id('67e001'), 100) WHERE media_id = pg_temp.id('670001');
RESET ROLE;
SELECT is(pg_temp.emitted('670001'), 1, 'dépôt du colis de 0001 : un changement émis pour ce bracelet');
SELECT is(pg_temp.emitted('670002'), 0, 'aucun changement pour un bracelet dont le colis n''a pas bougé');
SELECT set_config('t.mv', media_version::text, true) FROM edge_pwd_pack WHERE media_id = pg_temp.id('670001');
SET LOCAL ROLE cashless_tagkeys;
SELECT deposit_edge_pwd_pack(pg_temp.id('67e001'), pg_temp.id('670001'), decode(repeat('cd', 34), 'hex'),
                             sha256(decode(repeat('cd', 34), 'hex')), current_setting('t.mv')::bigint);
RESET ROLE;
SELECT is(pg_temp.emitted('670001'), 1, 'rejeu du même dépôt : rien de plus émis');
SET LOCAL ROLE cashless_tagkeys;
SELECT is(pg_temp.got('67e001'), ARRAY['0002'], 'après dépôt du colis de 0001 : il n''est plus rendu');
SELECT is((SELECT count(*)::int FROM edge_media_to_pack(pg_temp.id('67e001'), 100)), 1, 'reste 0002');
RESET ROLE;
UPDATE media SET personalized_at = timestamptz '2026-10-02 10:00:00+00' WHERE id = pg_temp.id('670001');
SET LOCAL ROLE cashless_tagkeys;
SELECT is(pg_temp.got('67e001'), ARRAY['0001', '0002'], 'version du bracelet changée (re-personnalisation) : rendu de nouveau');
RESET ROLE;
UPDATE edge_gateway SET agreement_public_key = decode('04' || repeat('21', 64), 'hex') WHERE id = pg_temp.id('67e001');
SET LOCAL ROLE cashless_tagkeys;
SELECT is(pg_temp.got('67e001'), ARRAY['0001', '0002'], 'clé d''accord changée : tous les bracelets reviennent');
RESET ROLE;
UPDATE edge_gateway SET role = 'STANDBY', role_changed_at = now() WHERE id = pg_temp.id('67e001');
SET LOCAL ROLE cashless_tagkeys;
SELECT is(pg_temp.got('67e001'), ARRAY[]::text[], 'rétrogradée : rien');
RESET ROLE;

-- Migration 0072 (défaut C) : aucun dépôt avant la fin du délai de garde, ni pour une STANDBY ; un dépôt accepté
-- tombe donc toujours dans la fenêtre où la page de réplication sert le colis, et son émission (0071) le porte.
CREATE FUNCTION pg_temp.wk() RETURNS jsonb LANGUAGE sql AS
  $$ SELECT jsonb_build_object('alg', 'ECDH-ES+HKDF-SHA256+A256GCM', 'epk', 'AA', 'iv', 'AA', 'wrapped_key', 'AA') $$;
SELECT pg_temp.ctx('67a001');
SET LOCAL ROLE cashless_tagkeys;
SELECT is(pg_temp.st($$SELECT deposit_edge_pwd_pack_key(pg_temp.id('67e003'),
  sha256(decode('04' || repeat('13', 64), 'hex')), pg_temp.wk())$$), 'CL001',
  'clé de colis refusée à 1 minute de l''inscription (délai de 30 minutes)');
SELECT is(pg_temp.st($$SELECT deposit_edge_pwd_pack(pg_temp.id('67e003'), pg_temp.id('670001'),
  decode(repeat('cd', 34), 'hex'), sha256(decode(repeat('cd', 34), 'hex')), 1)$$), 'CL001',
  'colis refusé à 1 minute de l''inscription');
SELECT is(pg_temp.st($$SELECT deposit_edge_pwd_pack_key(pg_temp.id('67e002'),
  sha256(decode('04' || repeat('12', 64), 'hex')), pg_temp.wk())$$), 'CL001',
  'clé de colis refusée à une STANDBY, même après le délai');
RESET ROLE;
UPDATE edge_gateway SET registered_at = now() - interval '1799 seconds' WHERE id = pg_temp.id('67e003');
SET LOCAL ROLE cashless_tagkeys;
SELECT is(pg_temp.st($$SELECT deposit_edge_pwd_pack_key(pg_temp.id('67e003'),
  sha256(decode('04' || repeat('13', 64), 'hex')), pg_temp.wk())$$), 'CL001', 'à 29 min 59 s : refusé');
RESET ROLE;
UPDATE edge_gateway SET registered_at = now() - interval '1801 seconds' WHERE id = pg_temp.id('67e003');
SET LOCAL ROLE cashless_tagkeys;
SELECT is(pg_temp.st($$SELECT deposit_edge_pwd_pack_key(pg_temp.id('67e003'),
  sha256(decode('04' || repeat('13', 64), 'hex')), pg_temp.wk())$$), 'OK', 'à 30 min 1 s : accepté');
RESET ROLE;
SELECT set_config('t.seq1', coalesce(max(change_seq), 0)::text, true) FROM edge_reference_change
 WHERE ledger_id = current_setting('t.ledger')::uuid;
SET LOCAL ROLE cashless_tagkeys;
SELECT is(pg_temp.st($$SELECT deposit_edge_pwd_pack(pg_temp.id('67e003'), pg_temp.id('670002'),
  decode(repeat('cd', 34), 'hex'), sha256(decode(repeat('cd', 34), 'hex')), 1)$$), 'OK',
  'colis accepté après le délai');
RESET ROLE;
SELECT is((SELECT count(*)::int FROM edge_reference_change
            WHERE ledger_id = current_setting('t.ledger')::uuid AND entity_id = pg_temp.id('670002')
              AND change_seq > current_setting('t.seq1')::bigint), 1,
  'le colis déposé après le délai est émis dans le flux (la passerelle le reçoit)');
SELECT * FROM finish();
ROLLBACK;
