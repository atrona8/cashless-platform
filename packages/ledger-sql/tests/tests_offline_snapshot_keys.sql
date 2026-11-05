-- Enveloppes, lecture d'un snapshot par un terminal et clés de signature (migration 0045 ; mission
-- hors-ligne-snapshots-lots, lot WP04 ; FR-006, FR-008, FR-009, FR-010, FR-011, FR-037 ; R-30.5, R-30.9) —
-- pgTAP, écrit à la main (pas un fichier généré). Lancer : pg_prove -d <base> tests/tests_offline_snapshot_keys.sql
-- (base créée par les migrations). Sous le PROPRIÉTAIRE seulement : aucun SET ROLE (les droits sont posés par WP08).
-- La concurrence de deux insertions de clés est portée par un verrou consultatif ; elle est prouvée à deux
-- connexions psql par le relecteur (un pgTAP n'a qu'une session).
\set ON_ERROR_STOP 1
\set QUIET 1
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

CREATE FUNCTION pg_temp.id(p text) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT ('00000000-0000-0000-0000-' || lpad(p, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.a() RETURNS void LANGUAGE sql AS
  $$ SELECT set_config('app.operator_id', pg_temp.id('45a001')::text, true) $$;
CREATE FUNCTION pg_temp.b() RETURNS void LANGUAGE sql AS
  $$ SELECT set_config('app.operator_id', pg_temp.id('45a002')::text, true) $$;
CREATE FUNCTION pg_temp.lg(p_event text) RETURNS uuid LANGUAGE sql AS
  $$ SELECT id FROM ledger WHERE scope_id = pg_temp.id(p_event) $$;

-- Données ---------------------------------------------------------------------------------------------
-- A : événements d001 (LIVE, hors ligne permis) et d002 (LIVE, sans politique : hors ligne interdit). B : d011.
INSERT INTO party (kind, legal_name) SELECT 'PLATFORM', 'Plateforme (test)'
 WHERE NOT EXISTS (SELECT 1 FROM party WHERE kind = 'PLATFORM');
INSERT INTO party (id, kind, legal_name, country_code) VALUES
 (pg_temp.id('45a001'), 'OPERATOR', 'Prestataire A', 'SN'),
 (pg_temp.id('45a002'), 'OPERATOR', 'Prestataire B', 'CI');
INSERT INTO party (id, kind, operator_id, legal_name) VALUES
 (pg_temp.id('45b001'), 'ORGANIZER', pg_temp.id('45a001'), 'Organisateur A'),
 (pg_temp.id('45b011'), 'ORGANIZER', pg_temp.id('45a002'), 'Organisateur B');
INSERT INTO jurisdiction_profile (id, country_code, version, valid_from, breakage_destination)
VALUES (pg_temp.id('45c001'), 'SN', 450045, '2026-01-01', 'ORGANIZER');
INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone, jurisdiction_id,
                   funds_holder, status)
SELECT pg_temp.id(e), pg_temp.id(o), pg_temp.id(g), 'Événement ' || e, 'XOF', 'Africa/Dakar',
       pg_temp.id('45c001'), 'ORGANIZER', 'LIVE'
  FROM (VALUES ('45d001','45a001','45b001'), ('45d002','45a001','45b001'),
               ('45d011','45a002','45b011')) AS v(e, o, g);
SELECT pg_temp.a();
SELECT open_event_ledger(pg_temp.id(e)) FROM (VALUES ('45d001'), ('45d002')) AS v(e);
SELECT pg_temp.b();
SELECT open_event_ledger(pg_temp.id('45d011'));

-- Terminaux de A : aa01, aa02 éligibles ; aa03 sans clé d'accord ; aa04 suspendu ; aa05 téléphone
-- personnel ; aa06 hors ligne interdit (d002) ; aa07 révoqué ; aa08 sans événement. ab01 de B.
INSERT INTO device (id, operator_id, kind, app_mode, event_id, serial, agreement_public_key,
                    personal_phone)
SELECT pg_temp.id('45aa' || n), pg_temp.id('45a001'), 'POS', 'CATALOG_POS',
       CASE WHEN n = '08' THEN NULL ELSE pg_temp.id(ev) END, 'S45-' || n,
       CASE WHEN n = '03' THEN NULL ELSE decode(repeat('04', 65), 'hex') END, n = '05'
  FROM (VALUES ('01','45d001'), ('02','45d001'), ('03','45d001'), ('04','45d001'), ('05','45d001'),
               ('06','45d002'), ('07','45d001'), ('08','45d001')) AS v(n, ev);
INSERT INTO device (id, operator_id, kind, app_mode, event_id, serial, agreement_public_key)
VALUES (pg_temp.id('45ab01'), pg_temp.id('45a002'), 'POS', 'CATALOG_POS', pg_temp.id('45d011'),
        'S45-B01', decode(repeat('04', 65), 'hex'));
UPDATE device SET status = 'SUSPENDED' WHERE id = pg_temp.id('45aa04');
UPDATE device SET status = 'REVOKED' WHERE id = pg_temp.id('45aa07');
INSERT INTO offline_policy (operator_id, scope_type, scope_id, offline_enabled, max_per_sale,
                            max_per_media_per_device, max_total_per_device)
VALUES (pg_temp.id('45a001'), 'EVENT', pg_temp.id('45d001'), true, 5000, 10000, 100000),
       (pg_temp.id('45a002'), 'EVENT', pg_temp.id('45d011'), true, 5000, 10000, 100000);

-- Clés de signature de la plateforme : p1 ACTIVE, p0 RETIRED.
INSERT INTO snapshot_signing_key (key_id, operator_id, owner, algorithm, public_key, kms_key_ref, status,
                                  retired_at)
VALUES ('k45-p0', NULL, 'CENTRAL', 'ECDSA_P256_SHA256', '\x00', 'test:k45-p0', 'RETIRED',
        clock_timestamp() - interval '2 hours'),
       ('k45-p1', NULL, 'CENTRAL', 'ECDSA_P256_SHA256', '\x01', 'test:k45-p1', 'ACTIVE', NULL);

-- Bracelets de d001 : trois, avec pwd_pack_enc.
INSERT INTO wallet (id, operator_id, ledger_id, status) VALUES
 (pg_temp.id('45f001'), pg_temp.id('45a001'), pg_temp.lg('45d001'), 'ACTIVE'),
 (pg_temp.id('45f002'), pg_temp.id('45a001'), pg_temp.lg('45d001'), 'BLOCKED');
INSERT INTO tag_key (operator_id, key_index, kms_key_ref, status)
VALUES (pg_temp.id('45a001'), 1, 'test:hmac-45', 'ACTIVE');
INSERT INTO tag_data_key (id, operator_id, key_index, version, wrapping_kms_key_ref, encrypted_dek)
VALUES (pg_temp.id('45d0d0'), pg_temp.id('45a001'), 1, 1, 'test:wrap-45', '\x01');
INSERT INTO media_batch (id, operator_id, organizer_id, event_id, kind, quantity, key_index)
VALUES (pg_temp.id('45f901'), pg_temp.id('45a001'), pg_temp.id('45b001'), pg_temp.id('45d001'),
        'PUBLIC', 9, 1);
INSERT INTO media (id, operator_id, kind, token_hash, nfc_uid, batch_id, key_index, wallet_id,
                   originality_sig_sha256, pwd_pack_enc, pwd_pack_dek_id) VALUES
 (pg_temp.id('45f101'), pg_temp.id('45a001'), 'NFC_TAG', sha256('m45-1'), '\x04450000000001',
  pg_temp.id('45f901'), 1, pg_temp.id('45f001'), sha256('sig1'), decode(repeat('aa', 34), 'hex'),
  pg_temp.id('45d0d0')),
 (pg_temp.id('45f102'), pg_temp.id('45a001'), 'NFC_TAG', sha256('m45-2'), '\x04450000000002',
  pg_temp.id('45f901'), 1, pg_temp.id('45f001'), sha256('sig2'), decode(repeat('bb', 34), 'hex'),
  pg_temp.id('45d0d0')),
 (pg_temp.id('45f103'), pg_temp.id('45a001'), 'NFC_TAG', sha256('m45-3'), '\x04450000000003',
  pg_temp.id('45f901'), 1, pg_temp.id('45f002'), sha256('sig3'), decode(repeat('cc', 34), 'hex'),
  pg_temp.id('45d0d0'));

-- Aides ----------------------------------------------------------------------------------------------
CREATE FUNCTION pg_temp.hx(p text) RETURNS text LANGUAGE sql IMMUTABLE AS
  $$ SELECT encode(sha256(convert_to(p, 'UTF8')), 'hex') $$;
CREATE FUNCTION pg_temp.hdr(p_kind text, p_entries int, p_removed int, p_gen text) RETURNS jsonb
LANGUAGE sql AS $$
  SELECT jsonb_build_object('kind', p_kind, 'generated_at', p_gen,
         'valid_until', to_char((p_gen::timestamptz + interval '15 minutes') AT TIME ZONE 'UTC',
                                'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
         'entries', p_entries, 'removed', p_removed, 'content_sha256', pg_temp.hx('c-' || p_gen)) $$;
-- Entrées avec mot de passe chiffré (hex) et empreinte liée.
CREATE FUNCTION pg_temp.items_full(p_ledger uuid) RETURNS jsonb LANGUAGE sql AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('token_hash', encode(s.token_hash, 'hex'),
           'entry', jsonb_set(s.entry, '{pwd_pack_sha256}', to_jsonb(encode(sha256(s.pwd_pack_enc), 'hex'))),
           'pwd_pack_enc', encode(s.pwd_pack_enc, 'hex'), 'removed', false)), '[]'::jsonb)
    FROM offline_snapshot_source_rows(p_ledger, NULL) s WHERE NOT s.removed $$;
CREATE FUNCTION pg_temp.items_delta(p_ledger uuid) RETURNS jsonb LANGUAGE sql AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('token_hash', encode(s.token_hash, 'hex'),
           'entry', s.entry, 'pwd_pack_enc', NULL, 'removed', false)), '[]'::jsonb)
    FROM offline_snapshot_source_rows(p_ledger, clock_timestamp() + interval '1 hour') s
   WHERE NOT s.removed $$;
-- Publie une version FULL ou DELTA (heure en minutes pour la rendre distincte) -> numéro.
CREATE FUNCTION pg_temp.publish(p_ledger uuid, p_kind text, p_min int) RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE v_gen text := '2026-10-30T12:' || lpad(p_min::text, 2, '0') || ':00Z'; v_items jsonb; v_draft bigint;
        v bigint;
BEGIN
  v_items := CASE WHEN p_kind = 'FULL' THEN pg_temp.items_full(p_ledger) ELSE pg_temp.items_delta(p_ledger) END;
  v_draft := save_offline_snapshot_draft(p_ledger, p_kind,
               pg_temp.hdr(p_kind, jsonb_array_length(v_items), 0, v_gen), '\x0102'::bytea, v_items);
  PERFORM seal_offline_snapshot_draft(v_draft);
  SELECT p.version INTO v FROM publish_offline_snapshot(v_draft, 'k45-p1', '\x3045'::bytea) p;
  RETURN v;
END $$;
CREATE FUNCTION pg_temp.env(p_tag text) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object('alg', 'ECDH-ES+HKDF-SHA256+A256GCM', 'epk', 'epk-' || p_tag,
                            'iv', 'iv-' || p_tag, 'wrapped_key', 'wk-' || p_tag) $$;
CREATE FUNCTION pg_temp.wrap(p_ledger uuid, p_version bigint, p_dev text, p_tag text) RETURNS void
LANGUAGE sql AS $$
  SELECT wrap_offline_snapshot_key(p_ledger, p_version, pg_temp.id(p_dev),
           (SELECT sha256(agreement_public_key) FROM device WHERE id = pg_temp.id(p_dev)),
           pg_temp.env(p_tag)) $$;
CREATE FUNCTION pg_temp.served(p_dev text, p_since bigint) RETURNS bigint LANGUAGE sql AS $$
  SELECT version FROM offline_snapshot_for_device(pg_temp.id(p_dev), p_since) $$;
-- SQLSTATE:DETAIL d'une instruction qui doit échouer.
CREATE FUNCTION pg_temp.failure(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE st text; dt text;
BEGIN
  EXECUTE p_sql;
  RETURN 'no error';
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS st = RETURNED_SQLSTATE, dt = PG_EXCEPTION_DETAIL;
  RETURN st || ':' || coalesce(dt, '');
END $$;

-- 1. Structure, RLS, search_path, droits ---------------------------------------------------------------
SELECT is((SELECT count(*)::int FROM pg_class WHERE relname = 'offline_snapshot_key'
            AND relrowsecurity AND relforcerowsecurity), 1, 'RLS activée et forcée sur offline_snapshot_key');
SELECT is((SELECT count(*)::int FROM pg_policy WHERE polname = 'tenant_isolation'
            AND polrelid = 'offline_snapshot_key'::regclass), 1, 'politique tenant_isolation');
SELECT is((SELECT count(*)::int FROM information_schema.columns WHERE table_name = 'offline_snapshot_key'
            AND column_name = 'operator_id' AND is_nullable = 'NO'), 1, 'operator_id NOT NULL');
SELECT is((SELECT count(*)::int FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
            AND p.proname IN ('offline_snapshot_keys_to_wrap','wrap_offline_snapshot_key',
                              'offline_snapshot_for_device','snapshot_public_keys',
                              'rotate_snapshot_signing_key')
            AND p.prosecdef AND p.proconfig @> ARRAY['search_path=public, pg_temp']), 5,
       'cinq fonctions publiques : SECURITY DEFINER, search_path = public, pg_temp');
SELECT is((SELECT count(*)::int FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
            AND p.proname IN ('offline_snapshot_envelope_ok','snapshot_signing_key_cap')
            AND NOT p.prosecdef AND p.proconfig @> ARRAY['search_path=public, pg_temp']), 2,
       'fonction de CHECK et de déclencheur : INVOKER, search_path posé');
SELECT is((SELECT count(*)::int FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
            AND p.proname IN ('offline_snapshot_keys_to_wrap','wrap_offline_snapshot_key',
                              'offline_snapshot_for_device','snapshot_public_keys',
                              'rotate_snapshot_signing_key','offline_snapshot_envelope_ok',
                              'snapshot_signing_key_cap')
            AND has_function_privilege('public', p.oid, 'EXECUTE')), 0,
       'aucun accord à PUBLIC ; accords nominatifs : tests_offline_rights.sql (WP08)');
SELECT is((SELECT count(*)::int FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
            AND p.proname IN ('offline_snapshot_keys_to_wrap','wrap_offline_snapshot_key',
                              'rotate_snapshot_signing_key','offline_snapshot_envelope_ok',
                              'snapshot_signing_key_cap')
            AND has_function_privilege('cashless_app', p.oid, 'EXECUTE')), 0,
       'cashless_app n''exécute ni les enveloppes, ni la rotation, ni les fonctions internes');
SELECT is((SELECT count(*)::int FROM pg_trigger WHERE tgrelid = 'snapshot_signing_key'::regclass
            AND tgname = 'snapshot_signing_key_cap'), 1, 'déclencheur de borne posé');

-- 2. Rien de publié -----------------------------------------------------------------------------------
SELECT pg_temp.a();
SELECT is(pg_temp.failure('SELECT * FROM offline_snapshot_for_device(pg_temp.id(''45aa01''), NULL)'),
          'CL050:', 'aucune version publiée : CL050');
SELECT is((SELECT count(*)::int FROM offline_snapshot_keys_to_wrap(1000)
            WHERE ledger_id = pg_temp.lg('45d001')), 0, 'rien à envelopper sans version publiée');

-- Versions : v1 FULL, v2 à v7 DELTA.
SELECT is(pg_temp.publish(pg_temp.lg('45d001'), 'FULL', 0), 1::bigint, 'v1 FULL publiée');
SELECT is((SELECT max(pg_temp.publish(pg_temp.lg('45d001'), 'DELTA', n))
             FROM generate_series(1, 6) n), 7::bigint, 'v2 à v7 DELTA publiées');

-- 3. File de travail et inscription des enveloppes ------------------------------------------------------
SELECT is((SELECT count(*)::int FROM offline_snapshot_keys_to_wrap(1000)
            WHERE ledger_id = pg_temp.lg('45d001')), 14, '7 versions x 2 terminaux éligibles = 14');
SELECT is((SELECT count(DISTINCT device_id)::int FROM offline_snapshot_keys_to_wrap(1000)
            WHERE ledger_id = pg_temp.lg('45d001')), 2,
       'seuls aa01 et aa02 : ni suspendu, révoqué, téléphone personnel, sans clé, hors ligne interdit');
SELECT is((SELECT count(*)::int FROM offline_snapshot_keys_to_wrap(1000)
            WHERE device_id IN (pg_temp.id('45aa03'), pg_temp.id('45aa04'), pg_temp.id('45aa05'),
                                pg_temp.id('45aa06'), pg_temp.id('45aa07'), pg_temp.id('45aa08'),
                                pg_temp.id('45ab01'))), 0, 'aucune ligne pour les terminaux exclus');
SELECT is((SELECT array_agg(version ORDER BY version, device_id) FROM offline_snapshot_keys_to_wrap(4)),
          ARRAY[1, 1, 2, 2]::bigint[], 'ordre : version croissante puis terminal ; limite respectée');
SELECT is((SELECT agreement_key_sha256 FROM offline_snapshot_keys_to_wrap(1)), sha256(decode(repeat('04', 65), 'hex')),
          'empreinte de la clé d''accord calculée par la base');
SELECT is((SELECT octet_length(content_key_wrapped) FROM offline_snapshot_keys_to_wrap(1)), 2,
          'la clé enveloppée de la version est rendue (jamais une clé en clair)');
SELECT is(pg_temp.failure('SELECT * FROM offline_snapshot_keys_to_wrap(0)'), 'CL001:', 'limite 0 : CL001');
SELECT is(pg_temp.failure('SELECT * FROM offline_snapshot_keys_to_wrap(1001)'), 'CL001:', 'limite 1001 : CL001');
SELECT is(pg_temp.failure('SELECT * FROM offline_snapshot_keys_to_wrap(NULL)'), 'CL001:', 'limite nulle : CL001');

-- Inscriptions : aa01 sur les 7 versions, aa02 sur v1 et v7.
SELECT lives_ok($$SELECT pg_temp.wrap(pg_temp.lg('45d001'), v, '45aa01', 'a1-' || v) FROM generate_series(1, 7) v$$,
       'enveloppes de aa01 inscrites');
SELECT lives_ok($$SELECT pg_temp.wrap(pg_temp.lg('45d001'), v, '45aa02', 'a2-' || v) FROM (VALUES (1), (7)) x(v)$$,
       'enveloppes de aa02 (v1, v7) inscrites');
SELECT is((SELECT count(*)::int FROM offline_snapshot_key), 9, 'neuf enveloppes');
SELECT is((SELECT count(*)::int FROM offline_snapshot_keys_to_wrap(1000)), 5, 'reste 5 à envelopper (aa02 v2 à v6)');
SELECT lives_ok($$SELECT wrap_offline_snapshot_key(pg_temp.lg('45d001'), 1, pg_temp.id('45aa01'),
         sha256(decode(repeat('04', 65), 'hex')), pg_temp.env('AUTRE'))$$, 'deuxième inscription : sans erreur');
SELECT is((SELECT envelope->>'epk' FROM offline_snapshot_key WHERE version = 1 AND device_id = pg_temp.id('45aa01')),
          'epk-a1-1', 'la première enveloppe fait foi (idempotent)');
SELECT is((SELECT count(*)::int FROM offline_snapshot_key), 9, 'toujours neuf enveloppes');

-- Refus d'inscription.
SELECT is(pg_temp.failure('SELECT pg_temp.wrap(pg_temp.lg(''45d001''), 1, ''45aa04'', ''x'')'), 'CL001:',
          'terminal SUSPENDED : refus');
SELECT is(pg_temp.failure('SELECT pg_temp.wrap(pg_temp.lg(''45d001''), 1, ''45aa07'', ''x'')'), 'CL001:',
          'terminal REVOKED : refus');
SELECT is(pg_temp.failure('SELECT pg_temp.wrap(pg_temp.lg(''45d001''), 1, ''45aa05'', ''x'')'), 'CL001:',
          'téléphone personnel : refus');
SELECT is(pg_temp.failure('SELECT wrap_offline_snapshot_key(pg_temp.lg(''45d001''), 1, pg_temp.id(''45aa03''),
          sha256(''x''::bytea), pg_temp.env(''x''))'), 'CL001:', 'sans clé d''accord : refus');
SELECT is(pg_temp.failure('SELECT pg_temp.wrap(pg_temp.lg(''45d001''), 1, ''45aa06'', ''x'')'), 'CL001:',
          'terminal d''un autre événement que celui du grand livre : refus');
SELECT is(pg_temp.failure('SELECT wrap_offline_snapshot_key(pg_temp.lg(''45d002''), 1, pg_temp.id(''45aa01''),
          sha256(decode(repeat(''04'', 65), ''hex'')), pg_temp.env(''x''))'), 'CL001:',
          'p_ledger d''un autre événement que celui du terminal : refus');
SELECT is(pg_temp.failure('SELECT wrap_offline_snapshot_key(pg_temp.lg(''45d001''), 2, pg_temp.id(''45aa02''),
          sha256(''ancienne''::bytea), pg_temp.env(''x''))'), 'CL001:', 'empreinte périmée : refus');
SELECT is(pg_temp.failure('SELECT pg_temp.wrap(pg_temp.lg(''45d001''), 99, ''45aa02'', ''x'')'), 'CL001:',
          'version non publiée : refus');
SELECT is(pg_temp.failure('SELECT wrap_offline_snapshot_key(pg_temp.lg(''45d001''), 2, pg_temp.id(''45aa02''),
          sha256(decode(repeat(''04'', 65), ''hex'')), ''{"alg":"ECDH-ES+HKDF-SHA256+A256GCM","epk":"e","iv":"i",
          "wrapped_key":"w","extra":"x"}''::jsonb)'), 'CL001:', 'enveloppe avec une clé de trop : refus');
SELECT is(pg_temp.failure('SELECT wrap_offline_snapshot_key(pg_temp.lg(''45d001''), 2, pg_temp.id(''45aa02''),
          sha256(decode(repeat(''04'', 65), ''hex'')), ''{"alg":"ECDH-ES+HKDF-SHA256+A256GCM","epk":"","iv":"i",
          "wrapped_key":"w"}''::jsonb)'), 'CL001:', 'enveloppe à epk vide : refus');
SELECT is(pg_temp.failure('SELECT wrap_offline_snapshot_key(pg_temp.lg(''45d001''), 2, pg_temp.id(''45aa02''),
          sha256(decode(repeat(''04'', 65), ''hex'')), ''{"alg":"RSA","epk":"e","iv":"i","wrapped_key":"w"}''::jsonb)'),
          'CL001:', 'algorithme inconnu : refus');
SELECT is(left(pg_temp.failure('INSERT INTO offline_snapshot_key (ledger_id, version, device_id, agreement_key_sha256,
          operator_id, envelope) VALUES (pg_temp.lg(''45d001''), 2, pg_temp.id(''45aa02''), sha256(''x''::bytea),
          pg_temp.id(''45a001''), ''{"alg":"x"}''::jsonb)'), 6), '23514:', 'CHECK de forme sur la table');
SELECT is(pg_temp.failure('UPDATE offline_snapshot_key SET created_at = now()'), 'P0001:',
          'une enveloppe ne se réécrit pas (UPDATE)');
SELECT is(pg_temp.failure('DELETE FROM offline_snapshot_key'), 'P0001:', 'une enveloppe ne se supprime pas');
SELECT pg_temp.b();
SELECT is(pg_temp.failure('SELECT pg_temp.wrap(pg_temp.lg(''45d001''), 2, ''45aa02'', ''x'')'), 'P0002:',
          'session de B, grand livre de A : refus avant toute lecture');
SELECT pg_temp.a();

-- 4. Lecture par le terminal : tableau de choix ----------------------------------------------------------
-- L = 7, F = 1.
SELECT is(pg_temp.served('45aa01', NULL), 1::bigint, 'b nul : dernier FULL');
SELECT is(pg_temp.served('45aa01', 0), 1::bigint, 'b = 0 : dernier FULL');
SELECT is(pg_temp.served('45aa01', -5), 1::bigint, 'b négatif : dernier FULL');
SELECT is(pg_temp.served('45aa01', 9223372036854775807), 1::bigint, 'b énorme (inconnu) : dernier FULL');
SELECT is(pg_temp.served('45aa01', 8), 1::bigint, 'b au-delà de la dernière : dernier FULL');
SELECT is(pg_temp.served('45aa01', 7), 7::bigint, 'b = L : dernière version');
SELECT is(pg_temp.served('45aa01', 6), 7::bigint, 'b = L - 1 : version suivante (DELTA de base 6)');
SELECT is(pg_temp.served('45aa01', 2), 3::bigint, 'b = L - 5 : version suivante');
SELECT is(pg_temp.served('45aa01', 1), 1::bigint, 'b = L - 6 (plus de 5 pas) : dernier FULL');
SELECT is((SELECT header->>'kind' FROM offline_snapshot_for_device(pg_temp.id('45aa01'), 6)), 'DELTA',
          'un pas servi est un DELTA');
SELECT is((SELECT (header->>'base_version')::bigint FROM offline_snapshot_for_device(pg_temp.id('45aa01'), 6)),
          6::bigint, 'DELTA servi : base_version = b');
SELECT is((SELECT latest_version FROM offline_snapshot_for_device(pg_temp.id('45aa01'), 6)), 7::bigint,
          'latest_version = dernière version du grand livre');
-- Contenu, enveloppe.
SELECT is((SELECT jsonb_array_length(entries->'entries') FROM offline_snapshot_for_device(pg_temp.id('45aa01'), NULL)),
          3, 'FULL : trois entrées');
SELECT is((SELECT jsonb_typeof(entries->'removed_token_hashes') FROM offline_snapshot_for_device(pg_temp.id('45aa01'), NULL)),
          'array', 'removed_token_hashes présent');
SELECT is((SELECT array_agg(e->>'token_hash') FROM offline_snapshot_for_device(pg_temp.id('45aa01'), NULL) f,
            jsonb_array_elements(f.entries->'entries') e),
          (SELECT array_agg(encode(sha256(convert_to(m, 'UTF8')), 'hex') ORDER BY encode(sha256(convert_to(m, 'UTF8')), 'hex')
                            COLLATE "C") FROM unnest(ARRAY['m45-1','m45-2','m45-3']) m),
          'entrées triées par token_hash hexadécimal');
SELECT is((SELECT e->>'pwd_pack_enc' FROM offline_snapshot_for_device(pg_temp.id('45aa01'), NULL) f,
            jsonb_array_elements(f.entries->'entries') e WHERE e->>'token_hash' = encode(sha256('m45-1'), 'hex')),
          encode(decode(repeat('aa', 34), 'hex'), 'base64'), 'pwd_pack_enc en base64');
SELECT is((SELECT envelope->>'epk' FROM offline_snapshot_for_device(pg_temp.id('45aa01'), 7)), 'epk-a1-7',
          'enveloppe de aa01');
SELECT is((SELECT envelope->>'epk' FROM offline_snapshot_for_device(pg_temp.id('45aa02'), 7)), 'epk-a2-7',
          'enveloppe de aa02 distincte pour la même version');
SELECT is((SELECT envelope->>'agreement_key_sha256' FROM offline_snapshot_for_device(pg_temp.id('45aa01'), 7)),
          encode(sha256(decode(repeat('04', 65), 'hex')), 'hex'), 'empreinte de la clé d''accord dans l''enveloppe');
SELECT is((SELECT count(*)::int FROM offline_snapshot_for_device(pg_temp.id('45aa01'), 7) f,
            jsonb_object_keys(f.envelope) k), 5, 'enveloppe rendue : quatre clés plus l''empreinte');
-- Enveloppe absente : aa02 n'a pas de v3.
SELECT is(pg_temp.failure('SELECT * FROM offline_snapshot_for_device(pg_temp.id(''45aa02''), 2)'), 'CL050:',
          'enveloppe absente pour ce terminal : CL050');
SELECT is(pg_temp.failure('SELECT * FROM offline_snapshot_for_device(pg_temp.id(''45aa03''), NULL)'), 'CL050:',
          'terminal sans clé d''accord : jamais d''enveloppe, CL050');

-- Non éligibles.
SELECT is(pg_temp.failure('SELECT * FROM offline_snapshot_for_device(pg_temp.id(''45aa04''), NULL)'),
          'CL051:DEVICE_SUSPENDED', 'SUSPENDED : CL051 DEVICE_SUSPENDED');
SELECT throws_ok($$SELECT * FROM offline_snapshot_for_device(pg_temp.id('45aa04'), NULL)$$, 'CL051',
          'Snapshot : terminal non éligible (DEVICE_SUSPENDED)', 'le motif est dans le MESSAGE');
SELECT is(pg_temp.failure('SELECT * FROM offline_snapshot_for_device(pg_temp.id(''45aa08''), NULL)'),
          'CL051:NO_EVENT', 'sans événement : NO_EVENT');
SELECT is(pg_temp.failure('SELECT * FROM offline_snapshot_for_device(pg_temp.id(''45aa05''), NULL)'),
          'CL051:PERSONAL_PHONE', 'téléphone personnel : PERSONAL_PHONE');
SELECT is(pg_temp.failure('SELECT * FROM offline_snapshot_for_device(pg_temp.id(''45aa06''), NULL)'),
          'CL051:OFFLINE_DISABLED', 'politique sans hors ligne : OFFLINE_DISABLED');
UPDATE snapshot_signing_key SET status = 'RETIRED', retired_at = clock_timestamp() WHERE key_id = 'k45-p1';
UPDATE snapshot_signing_key SET status = 'REVOKED' WHERE key_id = 'k45-p0';
SELECT is(pg_temp.failure('SELECT * FROM offline_snapshot_for_device(pg_temp.id(''45aa01''), NULL)'),
          'CL051:SNAPSHOTS_UNAVAILABLE', 'aucune clé ACTIVE : SNAPSHOTS_UNAVAILABLE');
UPDATE snapshot_signing_key SET status = 'ACTIVE', retired_at = NULL WHERE key_id = 'k45-p1';
UPDATE snapshot_signing_key SET status = 'RETIRED', retired_at = clock_timestamp() - interval '2 hours'
 WHERE key_id = 'k45-p0';
SELECT is(pg_temp.served('45aa01', 7), 7::bigint, 'clé ACTIVE rétablie : service rétabli');
SELECT is(pg_temp.failure('SELECT * FROM offline_snapshot_for_device(pg_temp.id(''45aa07''), NULL)'), '42501:',
          'REVOKED : 42501');
SELECT is(pg_temp.failure('SELECT * FROM offline_snapshot_for_device(pg_temp.id(''45aa01''), 7)') , 'no error',
          'contrôle : terminal éligible lu');
-- Un terminal devenu suspendu après avoir eu une enveloppe ne lit plus.
UPDATE device SET status = 'SUSPENDED' WHERE id = pg_temp.id('45aa02');
SELECT is(pg_temp.failure('SELECT * FROM offline_snapshot_for_device(pg_temp.id(''45aa02''), 7)'),
          'CL051:DEVICE_SUSPENDED', 'enveloppe existante mais terminal suspendu : refus');
UPDATE device SET status = 'ACTIVE' WHERE id = pg_temp.id('45aa02');
-- Isolation entre prestataires.
SELECT pg_temp.b();
SELECT is(pg_temp.failure('SELECT * FROM offline_snapshot_for_device(pg_temp.id(''45aa01''), 7)'), 'P0002:',
          'session de B, terminal de A : refus');
SELECT is(pg_temp.failure('SELECT * FROM offline_snapshot_for_device(gen_random_uuid(), 7)'), 'P0002:',
          'terminal inconnu : refus');
SELECT is(pg_temp.failure('SELECT * FROM offline_snapshot_for_device(pg_temp.id(''45ab01''), NULL)'), 'CL050:',
          'terminal de B : aucun snapshot pour son grand livre');
SELECT pg_temp.a();

-- Clé d'accord changée (ré-enrôlement) : l'ancienne enveloppe n'est plus servie.
UPDATE device SET agreement_public_key = decode('04' || repeat('05', 64), 'hex') WHERE id = pg_temp.id('45aa02');
SELECT is(pg_temp.failure('SELECT * FROM offline_snapshot_for_device(pg_temp.id(''45aa02''), 7)'), 'CL050:',
          'clé d''accord changée : l''enveloppe de l''ancienne clé n''est pas servie');
SELECT is((SELECT count(*)::int FROM offline_snapshot_keys_to_wrap(1000) WHERE device_id = pg_temp.id('45aa02')
             AND version = 7), 1, 'la version est à nouveau à envelopper pour la nouvelle clé');
SELECT is(pg_temp.failure('SELECT wrap_offline_snapshot_key(pg_temp.lg(''45d001''), 7, pg_temp.id(''45aa02''),
          sha256(decode(repeat(''04'', 65), ''hex'')), pg_temp.env(''perimee''))'), 'CL001:',
          'enveloppe construite pour l''ancienne empreinte : refusée');
SELECT lives_ok($$SELECT wrap_offline_snapshot_key(pg_temp.lg('45d001'), 7, pg_temp.id('45aa02'),
          sha256(decode('04' || repeat('05', 64), 'hex')), pg_temp.env('a2-neuve'))$$, 'enveloppe de la nouvelle clé');
SELECT is((SELECT envelope->>'epk' FROM offline_snapshot_for_device(pg_temp.id('45aa02'), 7)), 'epk-a2-neuve',
          'la nouvelle enveloppe est servie');
SELECT is((SELECT count(*)::int FROM offline_snapshot_key WHERE device_id = pg_temp.id('45aa02') AND version = 7), 2,
          'l''ancienne ligne reste, sans être servie');

-- 5. FULL plus récent, enveloppe pas prête, purge ---------------------------------------------------------
SELECT is(pg_temp.publish(pg_temp.lg('45d001'), 'FULL', 10), 8::bigint, 'v8 FULL publiée');
SELECT is(pg_temp.failure('SELECT pg_temp.wrap(pg_temp.lg(''45d001''), 2, ''45aa01'', ''x'')'), 'CL001:',
          'version antérieure au dernier FULL : pas d''enveloppe');
SELECT is(pg_temp.failure('SELECT * FROM offline_snapshot_for_device(pg_temp.id(''45aa01''), 7)'), 'CL050:',
          'FULL plus récent que b mais enveloppe pas prête : CL050');
SELECT is((SELECT count(*)::int FROM offline_snapshot_keys_to_wrap(1000) WHERE version < 8), 0,
          'plus d''enveloppe à faire avant le dernier FULL');
SELECT lives_ok($$SELECT pg_temp.wrap(pg_temp.lg('45d001'), 8, '45aa01', 'a1-8')$$, 'enveloppe v8');
SELECT is(pg_temp.served('45aa01', 7), 8::bigint, 'FULL plus récent que b : le FULL');
SELECT is(pg_temp.served('45aa01', 8), 8::bigint, 'b = L = FULL');
SELECT is(pg_temp.served('45aa01', NULL), 8::bigint, 'b nul : nouveau FULL');
SELECT is(pg_temp.publish(pg_temp.lg('45d001'), 'DELTA', 11), 9::bigint, 'v9 DELTA');
SELECT is(pg_temp.publish(pg_temp.lg('45d001'), 'FULL', 12), 10::bigint, 'v10 FULL');
SELECT is(pg_temp.failure('SELECT pg_temp.wrap(pg_temp.lg(''45d001''), 9, ''45aa01'', ''x'')'), 'CL001:',
          'v9 est antérieure au nouveau dernier FULL : pas d''enveloppe');
SELECT lives_ok($$SELECT pg_temp.wrap(pg_temp.lg('45d001'), 10, '45aa01', 'a1-10')$$, 'enveloppe v10');
SELECT is(pg_temp.served('45aa01', 9), 10::bigint, 'FULL v10 plus récent que b = 9');
SELECT is(pg_temp.served('45aa01', 3), 10::bigint, 'b = 3 : dernier FULL');
SELECT cmp_ok(purge_offline_snapshot_content(pg_temp.lg('45d001')), '>', 0, 'purge du contenu avant l''avant-dernier FULL');
SELECT is((SELECT count(*)::int FROM offline_snapshot_entry WHERE ledger_id = pg_temp.lg('45d001') AND version < 8), 0,
          'contenu des versions 1 à 7 purgé');
SELECT is(pg_temp.served('45aa01', 3), 10::bigint, 'b purgée : dernier FULL');
SELECT is(pg_temp.served('45aa01', 1), 10::bigint, 'b = 1 purgée : dernier FULL');
SELECT is((SELECT jsonb_array_length(entries->'entries') FROM offline_snapshot_for_device(pg_temp.id('45aa01'), NULL)),
          3, 'le FULL v10 est servi avec son contenu');
-- Contenu d'un brouillon jamais servi.
SELECT is((SELECT count(*)::int FROM offline_snapshot_key k
             JOIN offline_snapshot s ON s.ledger_id = k.ledger_id AND s.version = k.version), 
          (SELECT count(*)::int FROM offline_snapshot_key), 'chaque enveloppe porte sur une version publiée');

-- 6. Clés de signature : lecture, borne, rotation ---------------------------------------------------------
-- État de départ : p1 ACTIVE, p0 RETIRED (plateforme).
SELECT is((SELECT array_agg(key_id ORDER BY key_id) FROM snapshot_public_keys(pg_temp.id('45a001'))),
          ARRAY['k45-p0', 'k45-p1'], 'deux clés de la plateforme rendues');
SELECT is((SELECT not_after FROM snapshot_public_keys(pg_temp.id('45a001')) WHERE key_id = 'k45-p1'), NULL::timestamptz,
          'not_after nul pour une clé ACTIVE');
SELECT is((SELECT not_after - (SELECT retired_at FROM snapshot_signing_key WHERE key_id = 'k45-p0')
             FROM snapshot_public_keys(pg_temp.id('45a001')) WHERE key_id = 'k45-p0'), interval '24 hours',
          'not_after = retired_at + 24 h pour une clé RETIRED');
SELECT is((SELECT key_id FROM snapshot_public_keys(pg_temp.id('45a001')) LIMIT 1), 'k45-p1', 'la plus récente d''abord');
SELECT is(pg_temp.failure('SELECT * FROM snapshot_public_keys(pg_temp.id(''45a002''))'), 'P0002:',
          'session de A, prestataire B demandé : refus');
-- Borne.
SELECT is(pg_temp.failure('INSERT INTO snapshot_signing_key (key_id, owner, algorithm, public_key, kms_key_ref, status)
          VALUES (''k45-px'', ''CENTRAL'', ''ECDSA_P256_SHA256'', ''\x05'', ''t:px'', ''RETIRED'')'), 'CL054:',
          'troisième clé RETIRED de la plateforme : CL054');
INSERT INTO snapshot_signing_key (key_id, owner, algorithm, public_key, kms_key_ref, status)
VALUES ('k45-rv', 'CENTRAL', 'ECDSA_P256_SHA256', '\x06', 't:rv', 'REVOKED'),
       ('k45-pd', 'CENTRAL', 'ECDSA_P256_SHA256', '\x07', 't:pd', 'PENDING');
SELECT is((SELECT count(*)::int FROM snapshot_signing_key WHERE key_id IN ('k45-rv', 'k45-pd')), 2,
          'REVOKED et PENDING ne comptent pas');
SELECT is(pg_temp.failure('UPDATE snapshot_signing_key SET status = ''RETIRED'' WHERE key_id = ''k45-rv'''), 'CL054:',
          'remettre une clé REVOKED en RETIRED franchit la borne : CL054');
SELECT is(pg_temp.failure('UPDATE snapshot_signing_key SET status = ''ACTIVE'' WHERE key_id = ''k45-pd'''), 'CL054:',
          'une ACTIVE de plus avec deux clés valides : CL054');
-- Rotation x3.
SELECT lives_ok($$SELECT rotate_snapshot_signing_key('k45-p2', decode(repeat('ab', 91), 'hex'), 'test:k45-p2',
         pg_temp.id('45e001'))$$, 'rotation 1');
SELECT is((SELECT status FROM snapshot_signing_key WHERE key_id = 'k45-p2'), 'ACTIVE', 'p2 ACTIVE');
SELECT is((SELECT status FROM snapshot_signing_key WHERE key_id = 'k45-p1'), 'RETIRED', 'p1 RETIRED');
SELECT is((SELECT status FROM snapshot_signing_key WHERE key_id = 'k45-p0'), 'REVOKED', 'p0 REVOKED');
SELECT isnt((SELECT retired_at FROM snapshot_signing_key WHERE key_id = 'k45-p1'), NULL::timestamptz, 'retired_at posé');
SELECT lives_ok($$SELECT rotate_snapshot_signing_key('k45-p3', decode(repeat('ac', 91), 'hex'), 'test:k45-p3',
         pg_temp.id('45e001'))$$, 'rotation 2');
SELECT lives_ok($$SELECT rotate_snapshot_signing_key('k45-p4', decode(repeat('ad', 91), 'hex'), 'test:k45-p4',
         pg_temp.id('45e001'))$$, 'rotation 3');
SELECT is((SELECT count(*)::int FROM snapshot_signing_key WHERE key_id LIKE 'k45-p_' AND status = 'ACTIVE'), 1,
          'une ACTIVE');
SELECT is((SELECT count(*)::int FROM snapshot_signing_key WHERE key_id LIKE 'k45-p_' AND status = 'RETIRED'), 1,
          'une RETIRED');
SELECT is((SELECT array_agg(key_id ORDER BY key_id) FROM snapshot_signing_key
            WHERE key_id LIKE 'k45-p_' AND status = 'REVOKED'), ARRAY['k45-p0', 'k45-p1', 'k45-p2'],
          'le reste REVOKED');
SELECT is((SELECT array_agg(key_id ORDER BY key_id) FROM snapshot_public_keys(pg_temp.id('45a001'))),
          ARRAY['k45-p3', 'k45-p4'], 'snapshot_public_keys : au plus deux, jamais une clé REVOKED');
SELECT is((SELECT algorithm FROM snapshot_signing_key WHERE key_id = 'k45-p4'), 'ECDSA_P256_SHA256', 'algorithme');
SELECT is((SELECT operator_id FROM snapshot_signing_key WHERE key_id = 'k45-p4'), NULL::uuid, 'clé de la plateforme');
-- Contrôles.
SELECT is(pg_temp.failure($$SELECT rotate_snapshot_signing_key('k45-p5', decode(repeat('ab', 90), 'hex'), 't:x', pg_temp.id('45e001'))$$),
          'CL001:', 'clé publique tronquée : CL001');
SELECT is(pg_temp.failure($$SELECT rotate_snapshot_signing_key('k45-p4', decode(repeat('ab', 91), 'hex'), 't:x', pg_temp.id('45e001'))$$),
          'CL001:', 'identifiant déjà pris : CL001');
SELECT is(pg_temp.failure($$SELECT rotate_snapshot_signing_key('', decode(repeat('ab', 91), 'hex'), 't:x', pg_temp.id('45e001'))$$),
          'CL001:', 'identifiant vide : CL001');
SELECT is(pg_temp.failure($$SELECT rotate_snapshot_signing_key('k45-p5', decode(repeat('ab', 91), 'hex'), '', pg_temp.id('45e001'))$$),
          'CL001:', 'référence KMS vide : CL001');
SELECT is(pg_temp.failure($$SELECT rotate_snapshot_signing_key('k45-p5', decode(repeat('ab', 91), 'hex'), 't:x', NULL)$$),
          'CL001:', 'acteur nul : CL001');
SELECT is((SELECT count(*)::int FROM snapshot_signing_key WHERE key_id LIKE 'k45-p_'), 6,
          'aucune clé créée par les refus (p0 à p4 et la PENDING pd)');
-- Prestataires : B a sa propre clé CENTRAL ; A ne la voit pas, B ne voit pas celle de la plateforme.
INSERT INTO snapshot_signing_key (key_id, operator_id, owner, algorithm, public_key, kms_key_ref, status)
VALUES ('k45-b1', pg_temp.id('45a002'), 'CENTRAL', 'ECDSA_P256_SHA256', '\x08', 't:b1', 'ACTIVE');
SELECT is((SELECT array_agg(key_id ORDER BY key_id) FROM snapshot_public_keys(pg_temp.id('45a001'))),
          ARRAY['k45-p3', 'k45-p4'], 'A ne reçoit pas la clé de B');
SELECT pg_temp.b();
SELECT is((SELECT array_agg(key_id) FROM snapshot_public_keys(pg_temp.id('45a002'))), ARRAY['k45-b1'],
          'B reçoit sa clé, sans mélange avec celles de la plateforme');
SELECT pg_temp.a();
-- Le signataire de A est distinct : A peut avoir ses deux clés alors que la plateforme en a deux.
INSERT INTO snapshot_signing_key (key_id, operator_id, owner, algorithm, public_key, kms_key_ref, status)
VALUES ('k45-a1', pg_temp.id('45a001'), 'CENTRAL', 'ECDSA_P256_SHA256', '\x09', 't:a1', 'ACTIVE'),
       ('k45-a0', pg_temp.id('45a001'), 'CENTRAL', 'ECDSA_P256_SHA256', '\x0a', 't:a0', 'RETIRED');
SELECT is(pg_temp.failure('INSERT INTO snapshot_signing_key (key_id, operator_id, owner, algorithm, public_key,
          kms_key_ref, status) VALUES (''k45-a2'', pg_temp.id(''45a001''), ''CENTRAL'', ''ECDSA_P256_SHA256'', ''\x0b'',
          ''t:a2'', ''RETIRED'')'), 'CL054:', 'troisième clé du signataire A : CL054');
SELECT is((SELECT array_agg(key_id ORDER BY key_id) FROM snapshot_public_keys(pg_temp.id('45a001'))),
          ARRAY['k45-a0', 'k45-a1'], 'A a une clé ACTIVE propre : ses clés seulement (au plus deux)');

SELECT * FROM finish();
ROLLBACK;
