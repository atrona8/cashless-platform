-- Snapshots hors ligne : brouillon, publication, sources, purge (migration 0044 ; mission
-- hors-ligne-snapshots-lots, lot WP03 ; FR-006 à FR-010, FR-038, NFR-006 ; OP-N57) — pgTAP, écrit à la
-- main (pas un fichier généré). Lancer : pg_prove -d <base> tests/tests_offline_snapshots.sql (base créée
-- par les migrations). Sous le PROPRIÉTAIRE seulement : aucun SET ROLE (les droits sont posés par WP08 ;
-- l'écriture directe dans offline_snapshot est fermée à cashless_app par WP08, pas ici).
\set ON_ERROR_STOP 1
\set QUIET 1
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

CREATE FUNCTION pg_temp.id(p text) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT ('00000000-0000-0000-0000-' || lpad(p, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.a() RETURNS void LANGUAGE sql AS
  $$ SELECT set_config('app.operator_id', pg_temp.id('44a001')::text, true) $$;
CREATE FUNCTION pg_temp.b() RETURNS void LANGUAGE sql AS
  $$ SELECT set_config('app.operator_id', pg_temp.id('44a002')::text, true) $$;
CREATE FUNCTION pg_temp.lg(p_event text) RETURNS uuid LANGUAGE sql AS
  $$ SELECT id FROM ledger WHERE scope_id = pg_temp.id(p_event) $$;

-- Données ---------------------------------------------------------------------------------------------
-- A : événements d001 (LIVE, deux terminaux éligibles), d002 (LIVE, ledger sans terminal éligible),
-- d003 (LIVE, grand livre LOCKED). B : d011.
INSERT INTO party (kind, legal_name) SELECT 'PLATFORM', 'Plateforme (test)'
 WHERE NOT EXISTS (SELECT 1 FROM party WHERE kind = 'PLATFORM');
INSERT INTO party (id, kind, legal_name, country_code) VALUES
 (pg_temp.id('44a001'), 'OPERATOR', 'Prestataire A', 'SN'),
 (pg_temp.id('44a002'), 'OPERATOR', 'Prestataire B', 'CI');
INSERT INTO party (id, kind, operator_id, legal_name) VALUES
 (pg_temp.id('44b001'), 'ORGANIZER', pg_temp.id('44a001'), 'Organisateur A'),
 (pg_temp.id('44b011'), 'ORGANIZER', pg_temp.id('44a002'), 'Organisateur B');
INSERT INTO jurisdiction_profile (id, country_code, version, valid_from, breakage_destination)
VALUES (pg_temp.id('44c001'), 'SN', 440044, '2026-01-01', 'ORGANIZER');
INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone, jurisdiction_id,
                   funds_holder, status)
SELECT pg_temp.id(e), pg_temp.id(o), pg_temp.id(g), 'Événement ' || e, 'XOF', 'Africa/Dakar',
       pg_temp.id('44c001'), 'ORGANIZER', 'LIVE'
  FROM (VALUES ('44d001','44a001','44b001'), ('44d002','44a001','44b001'),
               ('44d003','44a001','44b001'), ('44d011','44a002','44b011')) AS v(e, o, g);
SELECT pg_temp.a();
SELECT open_event_ledger(pg_temp.id(e)) FROM (VALUES ('44d001'), ('44d002'), ('44d003')) AS v(e);
SELECT pg_temp.b();
SELECT open_event_ledger(pg_temp.id('44d011'));
UPDATE ledger SET status = 'LOCKED' WHERE scope_id = pg_temp.id('44d003');

-- Terminaux : aa01, aa02 éligibles de d001 ; aa03 sans clé d'accord ; aa04 suspendu ; aa05 téléphone
-- personnel ; aa06 hors ligne interdit (politique de l'événement d002) ; ab01 de B.
INSERT INTO device (id, operator_id, kind, app_mode, event_id, serial, agreement_public_key,
                    personal_phone)
SELECT pg_temp.id('44aa' || n), pg_temp.id('44a001'), 'POS', 'CATALOG_POS', pg_temp.id(ev),
       'S44-' || n, CASE WHEN n = '03' THEN NULL ELSE decode(repeat('04', 65), 'hex') END, n = '05'
  FROM (VALUES ('01','44d001'), ('02','44d001'), ('03','44d001'), ('04','44d001'), ('05','44d001'),
               ('06','44d002')) AS v(n, ev);
INSERT INTO device (id, operator_id, kind, app_mode, event_id, serial, agreement_public_key)
VALUES (pg_temp.id('44ab01'), pg_temp.id('44a002'), 'POS', 'CATALOG_POS', pg_temp.id('44d011'),
        'S44-B01', decode(repeat('04', 65), 'hex'));
UPDATE device SET status = 'SUSPENDED' WHERE id = pg_temp.id('44aa04');
INSERT INTO offline_policy (operator_id, scope_type, scope_id, offline_enabled, max_per_sale,
                            max_per_media_per_device, max_total_per_device)
VALUES (pg_temp.id('44a001'), 'EVENT', pg_temp.id('44d001'), true, 5000, 10000, 100000),
       (pg_temp.id('44a002'), 'EVENT', pg_temp.id('44d011'), true, 5000, 10000, 100000);

-- Clé de signature centrale (prestataire A) ; clé EDGE ; clé retirée.
INSERT INTO edge_gateway (id, operator_id, event_id, serial)
VALUES (pg_temp.id('44ee01'), pg_temp.id('44a001'), pg_temp.id('44d001'), 'G44-1');
INSERT INTO snapshot_signing_key (key_id, operator_id, owner, algorithm, public_key, kms_key_ref, status)
VALUES ('k44-a', pg_temp.id('44a001'), 'CENTRAL', 'ECDSA_P256_SHA256', '\x01', 'test:k44-a', 'ACTIVE'),
       ('k44-old', pg_temp.id('44a001'), 'CENTRAL', 'ECDSA_P256_SHA256', '\x02', 'test:k44-old', 'RETIRED');
INSERT INTO snapshot_signing_key (key_id, operator_id, owner, algorithm, public_key, edge_gateway_id,
                                  status)
VALUES ('k44-edge', pg_temp.id('44a001'), 'EDGE', 'ECDSA_P256_SHA256', '\x03', pg_temp.id('44ee01'),
        'ACTIVE');

-- Portefeuilles et bracelets de d001 : w1 ACTIVE (m1, m2), w2 BLOCKED (m3). Un compte contrepartie.
INSERT INTO wallet (id, operator_id, ledger_id, status) VALUES
 (pg_temp.id('44f001'), pg_temp.id('44a001'), pg_temp.lg('44d001'), 'ACTIVE'),
 (pg_temp.id('44f002'), pg_temp.id('44a001'), pg_temp.lg('44d001'), 'BLOCKED'),
 (pg_temp.id('44f011'), pg_temp.id('44a002'), pg_temp.lg('44d011'), 'ACTIVE');
INSERT INTO account (operator_id, ledger_id, code, family, purpose, wallet_id, normal_side) VALUES
 (pg_temp.id('44a001'), pg_temp.lg('44d001'), 'L-WAL-44-P', 'CLAIM', 'WALLET_PAID',
  pg_temp.id('44f001'), 'C');
INSERT INTO account (operator_id, ledger_id, code, family, purpose, normal_side)
VALUES (pg_temp.id('44a001'), pg_temp.lg('44d001'), 'A-BANK-44', 'ASSET', 'BANK', 'D');
INSERT INTO tag_key (operator_id, key_index, kms_key_ref, status) VALUES
 (pg_temp.id('44a001'), 1, 'test:hmac-44', 'ACTIVE'), (pg_temp.id('44a002'), 1, 'test:hmac-44b', 'ACTIVE');
INSERT INTO tag_data_key (id, operator_id, key_index, version, wrapping_kms_key_ref, encrypted_dek) VALUES
 (pg_temp.id('44d0d0'), pg_temp.id('44a001'), 1, 1, 'test:wrap-44', '\x01'),
 (pg_temp.id('44d0d1'), pg_temp.id('44a002'), 1, 1, 'test:wrap-44b', '\x01');
INSERT INTO media_batch (id, operator_id, organizer_id, event_id, kind, quantity, key_index) VALUES
 (pg_temp.id('44f901'), pg_temp.id('44a001'), pg_temp.id('44b001'), pg_temp.id('44d001'), 'PUBLIC', 9, 1),
 (pg_temp.id('44f911'), pg_temp.id('44a002'), pg_temp.id('44b011'), pg_temp.id('44d011'), 'PUBLIC', 9, 1);
INSERT INTO media (id, operator_id, kind, token_hash, nfc_uid, batch_id, key_index, wallet_id,
                   originality_sig_sha256, pwd_pack_enc, pwd_pack_dek_id) VALUES
 (pg_temp.id('44f101'), pg_temp.id('44a001'), 'NFC_TAG', sha256('m44-1'), '\x04440000000001',
  pg_temp.id('44f901'), 1, pg_temp.id('44f001'), sha256('sig1'), decode(repeat('aa', 34), 'hex'),
  pg_temp.id('44d0d0')),
 (pg_temp.id('44f102'), pg_temp.id('44a001'), 'NFC_TAG', sha256('m44-2'), '\x04440000000002',
  pg_temp.id('44f901'), 1, pg_temp.id('44f001'), sha256('sig2'), decode(repeat('bb', 34), 'hex'),
  pg_temp.id('44d0d0')),
 (pg_temp.id('44f103'), pg_temp.id('44a001'), 'NFC_TAG', sha256('m44-3'), '\x04440000000003',
  pg_temp.id('44f901'), 1, pg_temp.id('44f002'), sha256('sig3'), decode(repeat('cc', 34), 'hex'),
  pg_temp.id('44d0d0')),
 (pg_temp.id('44f111'), pg_temp.id('44a002'), 'NFC_TAG', sha256('m44-b'), '\x04440000000011',
  pg_temp.id('44f911'), 1, pg_temp.id('44f011'), sha256('sigb'), decode(repeat('dd', 34), 'hex'),
  pg_temp.id('44d0d1'));

-- Aides ----------------------------------------------------------------------------------------------
CREATE FUNCTION pg_temp.hx(p text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT encode(sha256(convert_to(p, 'UTF8')), 'hex') $$;
-- Paquet d'entrées issu de la source (pwd_pack_enc réel mis en hex, empreinte liée).
CREATE FUNCTION pg_temp.items(p_ledger uuid, p_since timestamptz DEFAULT NULL) RETURNS jsonb
LANGUAGE sql AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'token_hash', encode(s.token_hash, 'hex'),
           'entry', CASE WHEN s.removed THEN NULL ELSE s.entry END,
           'pwd_pack_enc', NULL, 'removed', s.removed)), '[]'::jsonb)
    FROM (SELECT * FROM offline_snapshot_source_rows(p_ledger, p_since)) s $$;
CREATE FUNCTION pg_temp.hdr(p_kind text, p_entries int, p_removed int,
                            p_gen text DEFAULT '2026-10-30T12:00:00Z') RETURNS jsonb
LANGUAGE sql AS $$
  SELECT jsonb_build_object('kind', p_kind, 'generated_at', p_gen,
         'valid_until', to_char((p_gen::timestamptz + interval '15 minutes') AT TIME ZONE 'UTC',
                                'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
         'entries', p_entries, 'removed', p_removed, 'content_sha256', pg_temp.hx('c-' || p_gen)) $$;
-- Brouillon complet (entrées de la source) -> id.
CREATE FUNCTION pg_temp.mk(p_ledger uuid, p_kind text, p_since timestamptz DEFAULT NULL,
                           p_gen text DEFAULT '2026-10-30T12:00:00Z') RETURNS bigint
LANGUAGE sql AS $$
  SELECT save_offline_snapshot_draft(p_ledger, p_kind,
    pg_temp.hdr(p_kind, (SELECT count(*) FROM offline_snapshot_source_rows(p_ledger, p_since)
                          WHERE NOT removed)::int,
                (SELECT count(*) FROM offline_snapshot_source_rows(p_ledger, p_since)
                  WHERE removed)::int, p_gen),
    '\x0102'::bytea, pg_temp.items(p_ledger, p_since)) $$;
CREATE FUNCTION pg_temp.sig() RETURNS bytea LANGUAGE sql AS $$ SELECT '\x3045'::bytea $$;
CREATE FUNCTION pg_temp.ready(p_draft bigint) RETURNS bigint LANGUAGE plpgsql AS $$
BEGIN PERFORM seal_offline_snapshot_draft(p_draft); RETURN p_draft; END $$;
CREATE FUNCTION pg_temp.pub(p_draft bigint) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE v bigint; BEGIN
  SELECT p.version INTO v FROM publish_offline_snapshot(pg_temp.ready(p_draft), 'k44-a', pg_temp.sig()) p;
  RETURN v; END $$;

-- 1. Structure, RLS, search_path ------------------------------------------------------------------------
SELECT is((SELECT count(*)::int FROM pg_class WHERE relname IN ('offline_snapshot_draft',
       'offline_snapshot_entry','offline_snapshot_state','offline_snapshot_media_log')
       AND relrowsecurity AND relforcerowsecurity), 4, 'RLS activée et forcée sur les quatre tables nouvelles');
SELECT is((SELECT count(*)::int FROM pg_policy WHERE polname = 'tenant_isolation'
       AND polrelid::regclass::text IN ('offline_snapshot_draft','offline_snapshot_entry',
       'offline_snapshot_state','offline_snapshot_media_log')), 4, 'politique tenant_isolation sur les quatre');
SELECT is((SELECT count(*)::int FROM information_schema.columns WHERE table_name = 'offline_snapshot'
       AND column_name = 'content_key_wrapped' AND is_nullable = 'NO' AND column_default IS NULL), 1,
       'content_key_wrapped NOT NULL sans défaut');
SELECT is((SELECT count(*)::int FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
       AND p.proname IN ('offline_snapshot_targets','offline_snapshot_source','offline_snapshot_source_delta',
       'offline_snapshot_state_hashes','save_offline_snapshot_draft','append_offline_snapshot_draft_entries',
       'seal_offline_snapshot_draft','discard_offline_snapshot_draft','offline_snapshot_drafts_ready',
       'offline_snapshot_draft_content','publish_offline_snapshot','purge_offline_snapshot_content',
       'discard_open_offline_snapshot_drafts')
       AND p.prosecdef AND p.proconfig @> ARRAY['search_path=public, pg_temp']), 13,
       'treize fonctions publiques : SECURITY DEFINER, search_path = public, pg_temp');
SELECT is((SELECT count(*)::int FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
       AND p.proname LIKE '%offline_snapshot%' AND p.proname NOT LIKE 'check%'
       AND has_function_privilege('public', p.oid, 'EXECUTE')), 0,
       'aucune fonction de snapshot ouverte à PUBLIC');
SELECT is((SELECT count(*)::int FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
       AND p.proname IN ('offline_snapshot_add_entries','offline_snapshot_draft_locked',
                         'offline_snapshot_source_rows','offline_snapshot_item_ok','offline_snapshot_header_ok')
       AND has_function_privilege('cashless_app', p.oid, 'EXECUTE')), 0,
       'aucun accord à cashless_app sur les fonctions internes (accords nominatifs : tests_offline_rights.sql, WP08)');

-- 2. Cibles --------------------------------------------------------------------------------------------
SELECT is((SELECT count(*)::int FROM offline_snapshot_targets()
            WHERE ledger_id = pg_temp.lg('44d001') AND eligible_devices = 2 AND last_version = 0
              AND last_full_version = 0 AND last_generated_at IS NULL), 1,
       'cible d001 : deux terminaux éligibles, aucune version');
SELECT is((SELECT count(*)::int FROM offline_snapshot_targets()
            WHERE ledger_id IN (pg_temp.lg('44d002'), pg_temp.lg('44d003'))), 0,
       'ni hors ligne interdit, ni grand livre LOCKED');
SELECT is((SELECT count(*)::int FROM offline_snapshot_targets() WHERE operator_id = pg_temp.id('44a002')), 1,
       'cible du prestataire B présente (propriétaire sans RLS)');

-- 3. Source --------------------------------------------------------------------------------------------
SELECT pg_temp.a();
SELECT is((SELECT count(*)::int FROM offline_snapshot_source(pg_temp.lg('44d001'))), 3,
       'source : un rattachement ouvert par bracelet (3)');
SELECT is((SELECT count(*)::int FROM offline_snapshot_source(pg_temp.lg('44d001')) s,
            LATERAL jsonb_object_keys(s.entry) k WHERE s.token_hash = sha256('m44-1')), 11,
       'entrée : onze clés exactes');
SELECT is((SELECT entry->'pwd_pack_sha256' FROM offline_snapshot_source(pg_temp.lg('44d001'))
            WHERE token_hash = sha256('m44-1')), 'null'::jsonb, 'pwd_pack_sha256 à null dans la source');
SELECT is((SELECT pwd_pack_enc FROM offline_snapshot_source(pg_temp.lg('44d001'))
            WHERE token_hash = sha256('m44-1')), decode(repeat('aa', 34), 'hex'),
       'source : pwd_pack_enc rendu au rôle content');
SELECT throws_ok($$SELECT * FROM offline_snapshot_source(pg_temp.lg('44d011'))$$, 'P0002', NULL,
       'source : session sur A, grand livre de B refusé');
SELECT throws_ok($$SELECT * FROM offline_snapshot_source_delta(pg_temp.lg('44d001'), NULL)$$, 'CL001', NULL,
       'delta : p_since nul refusé');
SELECT throws_ok($$SELECT * FROM offline_snapshot_state_hashes(pg_temp.lg('44d011'))$$, 'P0002', NULL,
       'state_hashes : grand livre d''un autre prestataire refusé');
SELECT is((SELECT count(*)::int FROM offline_snapshot_source_delta(pg_temp.lg('44d001'),
            clock_timestamp() + interval '1 hour') WHERE token_hash <> sha256('m44-3')), 0,
       'delta futur : seuls les bracelets du portefeuille BLOCKED reviennent');
SELECT is((SELECT count(*)::int FROM offline_snapshot_source_delta(pg_temp.lg('44d001'),
            clock_timestamp() + interval '1 hour')), 1, 'delta : le portefeuille bloqué est repris');
SELECT is((SELECT count(*)::int FROM offline_snapshot_source_delta(pg_temp.lg('44d001'),
            clock_timestamp() - interval '1 hour')), 3, 'delta passé : tous les bracelets changés');

-- 4. Version, brouillon, publication ------------------------------------------------------------------
SELECT throws_ok($$SELECT save_offline_snapshot_draft(pg_temp.lg('44d001'), 'DELTA',
         pg_temp.hdr('DELTA', 0, 0), '\x0102', '[]')$$, 'CL048', NULL, 'DELTA sans version précédente refusé');
SELECT throws_ok($$SELECT save_offline_snapshot_draft(pg_temp.lg('44d001'), 'FULL',
         pg_temp.hdr('FULL', 0, 0) || '{"version": 7}', '\x0102', '[]')$$, 'CL048', NULL,
       'champ de la base fourni avec une autre valeur refusé');
SELECT throws_ok($$SELECT save_offline_snapshot_draft(pg_temp.lg('44d001'), 'FULL',
         pg_temp.hdr('FULL', 0, 0), '\x', '[]')$$, 'CL048', NULL, 'content_key_wrapped vide refusé');
SELECT throws_ok($$SELECT save_offline_snapshot_draft(pg_temp.lg('44d003'), 'FULL',
         pg_temp.hdr('FULL', 0, 0), '\x0102', '[]')$$, 'CL048', NULL, 'grand livre LOCKED refusé');
SELECT throws_ok($$SELECT save_offline_snapshot_draft(pg_temp.lg('44d011'), 'FULL',
         pg_temp.hdr('FULL', 0, 0), '\x0102', '[]')$$, 'P0002', NULL, 'save : grand livre d''un autre prestataire');
-- Sans clé ACTIVE centrale pour B : NO_SIGNING_KEY
SELECT pg_temp.b();
SELECT throws_ok($$SELECT save_offline_snapshot_draft(pg_temp.lg('44d011'), 'FULL',
         pg_temp.hdr('FULL', 0, 0), '\x0102', '[]')$$, 'CL048', NULL, 'aucune clé ACTIVE : CL048');
SELECT pg_temp.a();

CREATE TEMP TABLE r (k text PRIMARY KEY, v bigint);
INSERT INTO r SELECT 'd1', pg_temp.mk(pg_temp.lg('44d001'), 'FULL');
SELECT is((SELECT status FROM offline_snapshot_draft WHERE id = (SELECT v FROM r WHERE k = 'd1')), 'OPEN',
       'save : brouillon OPEN');
SELECT is((SELECT version FROM offline_snapshot_draft WHERE id = (SELECT v FROM r WHERE k = 'd1')), 1::bigint,
       'save : version 1 calculée par la base');
SELECT is((SELECT count(*)::int FROM jsonb_object_keys((SELECT header FROM offline_snapshot_draft
            WHERE id = (SELECT v FROM r WHERE k = 'd1')))), 15, 'en-tête du brouillon : quinze champs');
SELECT is((SELECT header->>'key_id' FROM offline_snapshot_draft WHERE id = (SELECT v FROM r WHERE k = 'd1')),
       'k44-a', 'key_id posé par la base (clé centrale ACTIVE)');
SELECT throws_ok($$SELECT pg_temp.mk(pg_temp.lg('44d001'), 'FULL')$$, 'CL048', NULL,
       'second save sans discard : CL048');
SELECT throws_ok($$SELECT publish_offline_snapshot((SELECT v FROM r WHERE k = 'd1'), 'k44-a',
         pg_temp.sig())$$, 'CL048', NULL, 'publication d''un brouillon OPEN refusée');
SELECT throws_ok($$SELECT append_offline_snapshot_draft_entries((SELECT v FROM r WHERE k = 'd1'),
         '[{"token_hash": "00", "entry": {}}]')$$, 'CL048', NULL, 'append : entrée mal formée');
SELECT throws_ok($$SELECT append_offline_snapshot_draft_entries((SELECT v FROM r WHERE k = 'd1'),
         pg_temp.items(pg_temp.lg('44d001')))$$, 'CL048', NULL, 'append : jetons en double dans le brouillon');
SELECT throws_ok($$SELECT append_offline_snapshot_draft_entries((SELECT v FROM r WHERE k = 'd1'),
         (SELECT jsonb_agg(jsonb_build_object('token_hash', pg_temp.hx(g::text), 'removed', true))
            FROM generate_series(1, 5001) g))$$, 'CL001', NULL, 'append : paquet de plus de 5 000 refusé');
-- Une entrée sans les onze clés / avec une clé de plus est refusée.
SELECT throws_ok(format($f$SELECT append_offline_snapshot_draft_entries(%s, %L::jsonb)$f$,
         (SELECT v FROM r WHERE k = 'd1'),
         jsonb_build_array(jsonb_build_object('token_hash', pg_temp.hx('x'), 'removed', false, 'entry',
           jsonb_build_object('token_hash', pg_temp.hx('x'), 'status', 'ACTIVE')))),
       'CL048', NULL, 'append : entrée sans les onze clés refusée');
SELECT throws_ok(format($f$SELECT append_offline_snapshot_draft_entries(%s, %L::jsonb)$f$,
         (SELECT v FROM r WHERE k = 'd1'),
         jsonb_build_array(jsonb_build_object('token_hash', pg_temp.hx('y'), 'removed', false, 'entry',
           (SELECT entry || '{"extra": 1}' || jsonb_build_object('token_hash', pg_temp.hx('y'))
              FROM offline_snapshot_source(pg_temp.lg('44d001')) LIMIT 1)))),
       'CL048', NULL, 'append : entrée avec une douzième clé refusée');
SELECT lives_ok(format($f$SELECT seal_offline_snapshot_draft(%s)$f$, (SELECT v FROM r WHERE k = 'd1')),
       'seal : comptes égaux à l''en-tête');
SELECT throws_ok(format($f$SELECT append_offline_snapshot_draft_entries(%s, '[]')$f$,
         (SELECT v FROM r WHERE k = 'd1')), 'CL048', NULL, 'append sur un brouillon READY refusé');
SELECT is((SELECT count(*)::int FROM offline_snapshot_drafts_ready()), 1, 'drafts_ready : le brouillon READY');
SELECT is((SELECT pg_get_function_result('offline_snapshot_drafts_ready()'::regprocedure)),
       'TABLE(id bigint, operator_id uuid, ledger_id uuid, kind text, base_version bigint, version bigint, header jsonb, created_at timestamp with time zone)',
       'drafts_ready : liste exacte des colonnes, sans content_key_wrapped');
SELECT is((SELECT pg_get_function_result('publish_offline_snapshot(bigint,text,bytea)'::regprocedure)),
       'TABLE(ledger_id uuid, version bigint, kind text, generated_at timestamp with time zone)',
       'publish : liste exacte des colonnes, sans clé enveloppée ni signature');
SELECT is((SELECT count(*)::int FROM offline_snapshot_draft_content((SELECT v FROM r WHERE k = 'd1'))), 3,
       'draft_content : trois entrées');
SELECT is((SELECT count(*)::int FROM pg_proc WHERE proname = 'offline_snapshot_draft_content'
            AND pg_get_function_result(oid) LIKE '%pwd_pack_enc%'), 0,
       'draft_content : le type de retour ne contient pas pwd_pack_enc');
-- Publication refusée : clé inconnue, retirée, EDGE, signature vide, clé différente de l'en-tête.
SELECT throws_ok($$SELECT publish_offline_snapshot((SELECT v FROM r WHERE k = 'd1'), 'inconnue',
         pg_temp.sig())$$, 'CL048', NULL, 'publication : clé inconnue');
SELECT throws_ok($$SELECT publish_offline_snapshot((SELECT v FROM r WHERE k = 'd1'), 'k44-old',
         pg_temp.sig())$$, 'CL048', NULL, 'publication : clé RETIRED refusée');
SELECT throws_ok($$SELECT publish_offline_snapshot((SELECT v FROM r WHERE k = 'd1'), 'k44-edge',
         pg_temp.sig())$$, 'CL048', NULL, 'publication : clé EDGE refusée');
SELECT throws_ok($$SELECT publish_offline_snapshot((SELECT v FROM r WHERE k = 'd1'), 'k44-a', '\x')$$,
       'CL048', NULL, 'publication : signature vide');
SELECT pg_temp.b();
SELECT throws_ok($$SELECT publish_offline_snapshot((SELECT v FROM r WHERE k = 'd1'), 'k44-a',
         pg_temp.sig())$$, 'P0002', NULL, 'publication : brouillon d''un autre prestataire invisible');
SELECT throws_ok($$SELECT * FROM offline_snapshot_draft_content((SELECT v FROM r WHERE k = 'd1'))$$,
       'P0002', NULL, 'draft_content : autre prestataire refusé');
SELECT throws_ok($$SELECT discard_offline_snapshot_draft((SELECT v FROM r WHERE k = 'd1'), 'x')$$,
       'P0002', NULL, 'discard : autre prestataire refusé');
SELECT pg_temp.a();

-- En-tête falsifié par écriture directe (propriétaire) : refusé à la publication.
UPDATE offline_snapshot_draft SET header = jsonb_set(header, '{entries}', '2')
 WHERE id = (SELECT v FROM r WHERE k = 'd1');
SELECT throws_ok($$SELECT publish_offline_snapshot((SELECT v FROM r WHERE k = 'd1'), 'k44-a',
         pg_temp.sig())$$, 'CL048', NULL, 'en-tête : compte d''entrées faux refusé');
UPDATE offline_snapshot_draft SET header = jsonb_set(header, '{entries}', '3')
 WHERE id = (SELECT v FROM r WHERE k = 'd1');
UPDATE offline_snapshot_draft SET header = jsonb_set(header, '{key_id}', '"k44-old"')
 WHERE id = (SELECT v FROM r WHERE k = 'd1');
SELECT throws_ok($$SELECT publish_offline_snapshot((SELECT v FROM r WHERE k = 'd1'), 'k44-a',
         pg_temp.sig())$$, 'CL048', NULL, 'en-tête : key_id différent de la clé de publication');
UPDATE offline_snapshot_draft SET header = jsonb_set(header, '{key_id}', '"k44-a"')
 WHERE id = (SELECT v FROM r WHERE k = 'd1');
UPDATE offline_snapshot_draft SET header = jsonb_set(header, '{authority_epoch}', '9')
 WHERE id = (SELECT v FROM r WHERE k = 'd1');
SELECT throws_ok($$SELECT publish_offline_snapshot((SELECT v FROM r WHERE k = 'd1'), 'k44-a',
         pg_temp.sig())$$, 'CL015', NULL, 'en-tête : époque différente de la courante : CL015');
UPDATE offline_snapshot_draft SET header = jsonb_set(header, '{authority_epoch}', '0')
 WHERE id = (SELECT v FROM r WHERE k = 'd1');
UPDATE offline_snapshot_draft SET header = header || '{"extra": 1}'
 WHERE id = (SELECT v FROM r WHERE k = 'd1');
SELECT throws_ok($$SELECT publish_offline_snapshot((SELECT v FROM r WHERE k = 'd1'), 'k44-a',
         pg_temp.sig())$$, 'CL048', NULL, 'en-tête : champ de plus refusé');
UPDATE offline_snapshot_draft SET header = header - 'extra' WHERE id = (SELECT v FROM r WHERE k = 'd1');
-- Entrée retirée en base après scellement : le compte ne tient plus.
DELETE FROM offline_snapshot_entry WHERE draft_id = (SELECT v FROM r WHERE k = 'd1')
   AND token_hash = sha256('m44-3');
SELECT throws_ok($$SELECT publish_offline_snapshot((SELECT v FROM r WHERE k = 'd1'), 'k44-a',
         pg_temp.sig())$$, 'CL048', NULL, 'contenu : une entrée en moins refusée à la publication');
-- On repart proprement : abandon puis nouveau brouillon.
SELECT lives_ok(format($f$SELECT discard_offline_snapshot_draft(%s, 'test')$f$, (SELECT v FROM r WHERE k = 'd1')),
       'discard : brouillon READY abandonné');
SELECT is((SELECT count(*)::int FROM offline_snapshot_entry WHERE draft_id = (SELECT v FROM r WHERE k = 'd1')),
       0, 'discard : entrées supprimées');
SELECT throws_ok(format($f$SELECT publish_offline_snapshot(%s, 'k44-a', '\x3045')$f$,
       (SELECT v FROM r WHERE k = 'd1')), 'CL048', NULL, 'publication d''un brouillon DISCARDED refusée');
SELECT throws_ok($$SELECT discard_offline_snapshot_draft((SELECT v FROM r WHERE k = 'd1'), '')$$, 'CL001',
       NULL, 'discard : motif vide refusé');

-- B2 : lien pwd_pack_sha256 (sur un brouillon neuf, puis abandonné).
CREATE FUNCTION pg_temp.pw_item(p_pw text, p_sha text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_array(jsonb_build_object('token_hash', pg_temp.hx('pw'), 'removed', false,
    'pwd_pack_enc', p_pw,
    'entry', (SELECT entry FROM offline_snapshot_source(pg_temp.lg('44d001')) LIMIT 1)
             || jsonb_build_object('token_hash', pg_temp.hx('pw'), 'pwd_pack_sha256', p_sha))) $$;
INSERT INTO r SELECT 'dpw', save_offline_snapshot_draft(pg_temp.lg('44d001'), 'FULL',
  pg_temp.hdr('FULL', 9, 0), '\x0102', '[]');
SELECT throws_ok(format($f$SELECT append_offline_snapshot_draft_entries(%s, %L::jsonb)$f$, (SELECT v FROM r WHERE k = 'dpw'),
  pg_temp.pw_item(repeat('aa', 34), NULL)), 'CL048', NULL, 'B2 : mot de passe avec sha nul refusé');
SELECT throws_ok(format($f$SELECT append_offline_snapshot_draft_entries(%s, %L::jsonb)$f$, (SELECT v FROM r WHERE k = 'dpw'),
  pg_temp.pw_item(repeat('aa', 34), repeat('0', 64))), 'CL048', NULL, 'B2 : sha faux refusé');
SELECT throws_ok(format($f$SELECT append_offline_snapshot_draft_entries(%s, %L::jsonb)$f$, (SELECT v FROM r WHERE k = 'dpw'),
  pg_temp.pw_item(NULL, encode(sha256(decode(repeat('aa', 34), 'hex')), 'hex'))), 'CL048', NULL,
  'B2 : sha sans mot de passe refusé');
SELECT throws_ok(format($f$SELECT append_offline_snapshot_draft_entries(%s, %L::jsonb)$f$, (SELECT v FROM r WHERE k = 'dpw'),
  pg_temp.pw_item(repeat('aa', 33), encode(sha256(decode(repeat('aa', 33), 'hex')), 'hex'))), 'CL048', NULL,
  'B2 : mot de passe de 33 octets refusé');
SELECT is(append_offline_snapshot_draft_entries((SELECT v FROM r WHERE k = 'dpw'),
  pg_temp.pw_item(repeat('aa', 34), encode(sha256(decode(repeat('aa', 34), 'hex')), 'hex'))), 1,
  'B2 : mot de passe avec lien correct accepté');
SELECT is((SELECT pwd_pack_enc FROM offline_snapshot_entry WHERE draft_id = (SELECT v FROM r WHERE k = 'dpw')),
  decode(repeat('aa', 34), 'hex'), 'B2 : mot de passe stocké');
-- M1 : entiers hors bornes ou mal typés -> CL048.
SELECT lives_ok(format($f$SELECT discard_offline_snapshot_draft(%s, 'B2 fini')$f$, (SELECT v FROM r WHERE k = 'dpw')),
  'B2 : brouillon abandonné');
SELECT throws_ok($$SELECT save_offline_snapshot_draft(pg_temp.lg('44d001'), 'FULL',
  pg_temp.hdr('FULL', 0, 0) || '{"entries": 99999999999}', '\x0102', '[]')$$, 'CL048', NULL, 'M1 : entries hors entier : CL048');
SELECT throws_ok($$SELECT save_offline_snapshot_draft(pg_temp.lg('44d001'), 'FULL',
  pg_temp.hdr('FULL', 0, 0) || '{"removed": "0"}', '\x0102', '[]')$$, 'CL048', NULL, 'M1 : removed en texte : CL048');
SELECT is((SELECT count(*)::int FROM offline_snapshot_draft WHERE ledger_id = pg_temp.lg('44d001')
  AND status IN ('OPEN','READY')), 0, 'M1 : aucun brouillon laissé ouvert');
-- B3 : en-tête du brouillon altéré par écriture directe.
INSERT INTO r SELECT 'dh', pg_temp.mk(pg_temp.lg('44d001'), 'FULL');
SELECT pg_temp.ready((SELECT v FROM r WHERE k = 'dh'));
UPDATE offline_snapshot_draft SET header = (header - 'removed') || '{"extra": 1}' WHERE id = (SELECT v FROM r WHERE k = 'dh');
SELECT throws_ok($$SELECT publish_offline_snapshot((SELECT v FROM r WHERE k = 'dh'), 'k44-a', pg_temp.sig())$$,
  'CL048', NULL, 'B3 : clé manquante + clé en trop refusées');
UPDATE offline_snapshot_draft SET header = (header - 'extra') || '{"removed": 0}' WHERE id = (SELECT v FROM r WHERE k = 'dh');
UPDATE offline_snapshot_draft SET header = header - 'entries' WHERE id = (SELECT v FROM r WHERE k = 'dh');
SELECT throws_ok($$SELECT publish_offline_snapshot((SELECT v FROM r WHERE k = 'dh'), 'k44-a', pg_temp.sig())$$,
  'CL048', NULL, 'B3 : entries absent refusé');
UPDATE offline_snapshot_draft SET header = (header || '{"entries": 3}'::jsonb) - 'removed' WHERE id = (SELECT v FROM r WHERE k = 'dh');
SELECT throws_ok($$SELECT publish_offline_snapshot((SELECT v FROM r WHERE k = 'dh'), 'k44-a', pg_temp.sig())$$,
  'CL048', NULL, 'B3 : removed absent refusé');
UPDATE offline_snapshot_draft SET header = header || '{"removed": "0"}' WHERE id = (SELECT v FROM r WHERE k = 'dh');
SELECT throws_ok($$SELECT publish_offline_snapshot((SELECT v FROM r WHERE k = 'dh'), 'k44-a', pg_temp.sig())$$,
  'CL048', NULL, 'B3 : removed en texte refusé');
UPDATE offline_snapshot_draft SET header = (header || '{"removed": 0}'::jsonb) - 'valid_until' WHERE id = (SELECT v FROM r WHERE k = 'dh');
SELECT throws_ok($$SELECT publish_offline_snapshot((SELECT v FROM r WHERE k = 'dh'), 'k44-a', pg_temp.sig())$$,
  'CL048', NULL, 'B3 : valid_until absent refusé');
UPDATE offline_snapshot_draft SET header = header || '{"valid_until": "2026-10-30T12:15:00Z", "content_sha256": null}'
 WHERE id = (SELECT v FROM r WHERE k = 'dh');
SELECT throws_ok($$SELECT publish_offline_snapshot((SELECT v FROM r WHERE k = 'dh'), 'k44-a', pg_temp.sig())$$,
  'CL048', NULL, 'B3 : content_sha256 nul refusé');
UPDATE offline_snapshot_draft SET header = header || jsonb_build_object('content_sha256', pg_temp.hx('c-2026-10-30T12:00:00Z'))
 WHERE id = (SELECT v FROM r WHERE k = 'dh');
SELECT throws_ok(format($f$SELECT seal_offline_snapshot_draft(%s)$f$, (SELECT v FROM r WHERE k = 'dh')),
  'CL048', NULL, 'seal : brouillon READY refuse un nouveau seal') ;
SELECT lives_ok(format($f$SELECT discard_offline_snapshot_draft(%s, 'B3 fini')$f$, (SELECT v FROM r WHERE k = 'dh')),
  'B3 : brouillon abandonné');

-- Premier FULL publié.
SELECT is(pg_temp.pub(pg_temp.mk(pg_temp.lg('44d001'), 'FULL')), 1::bigint,
       'publication : FULL version 1 (la version abandonnée est réattribuée)');
SELECT is((SELECT count(*)::int FROM offline_snapshot WHERE ledger_id = pg_temp.lg('44d001')), 1,
       'une ligne offline_snapshot');
SELECT is((SELECT status FROM offline_snapshot_draft WHERE ledger_id = pg_temp.lg('44d001')
            AND version = 1 AND status <> 'DISCARDED'), 'PUBLISHED', 'brouillon PUBLISHED');
SELECT is((SELECT content_key_wrapped FROM offline_snapshot WHERE ledger_id = pg_temp.lg('44d001')),
       '\x0102'::bytea, 'content_key_wrapped repris du brouillon');
SELECT is((SELECT count(*)::int FROM offline_snapshot_media_log WHERE ledger_id = pg_temp.lg('44d001')
            AND version = 1 AND in_snapshot), 3, 'journal : trois lignes dans le snapshot');
SELECT is((SELECT count(*)::int FROM offline_snapshot_state_hashes(pg_temp.lg('44d001'))), 3,
       'état : trois jetons');
SELECT is((SELECT entry_sha256 FROM offline_snapshot_state_hashes(pg_temp.lg('44d001'))
            WHERE token_hash = sha256('m44-1')),
       offline_snapshot_entry_sha256((SELECT entry FROM offline_snapshot_source(pg_temp.lg('44d001'))
            WHERE token_hash = sha256('m44-1'))), 'entry_sha256 = empreinte rejouable côté producteur');
SELECT is((SELECT count(*)::int FROM audit_log WHERE action = 'SNAPSHOT_PUBLISHED'
            AND operator_id = pg_temp.id('44a001') AND object_id = '1'
            AND actor_role = session_user::text), 1, 'audit SNAPSHOT_PUBLISHED écrit par la fonction');
SELECT throws_ok($$SELECT publish_offline_snapshot((SELECT id FROM offline_snapshot_draft
         WHERE ledger_id = pg_temp.lg('44d001') AND status = 'PUBLISHED'), 'k44-a', pg_temp.sig())$$,
       'CL048', NULL, 'double publication du même brouillon refusée');
SELECT throws_ok($$SELECT discard_offline_snapshot_draft((SELECT id FROM offline_snapshot_draft
         WHERE ledger_id = pg_temp.lg('44d001') AND status = 'PUBLISHED'), 'x')$$, 'CL048', NULL,
       'discard d''un brouillon publié refusé');
SELECT is((SELECT count(*)::int FROM offline_snapshot_draft_content((SELECT id FROM offline_snapshot_draft
         WHERE ledger_id = pg_temp.lg('44d001') AND status = 'PUBLISHED'))), 3,
       'draft_content lisible après publication');

-- FULL avec base, DELTA avec mauvaise base : écriture directe falsifiée refusée.
INSERT INTO r SELECT 'd2', pg_temp.mk(pg_temp.lg('44d001'), 'DELTA', clock_timestamp() + interval '1 hour',
                                       '2026-10-30T12:01:00Z');
SELECT is((SELECT base_version FROM offline_snapshot_draft WHERE id = (SELECT v FROM r WHERE k = 'd2')),
       1::bigint, 'DELTA : base = version précédente');
SELECT is((SELECT version FROM offline_snapshot_draft WHERE id = (SELECT v FROM r WHERE k = 'd2')), 2::bigint,
       'DELTA : version 2');
SELECT is((SELECT count(*)::int FROM offline_snapshot_entry WHERE draft_id = (SELECT v FROM r WHERE k = 'd2')),
       1, 'DELTA : une seule entrée');
UPDATE offline_snapshot_draft SET base_version = 0, header = jsonb_set(header, '{base_version}', '0')
 WHERE id = (SELECT v FROM r WHERE k = 'd2');
SELECT throws_ok($$SELECT publish_offline_snapshot(pg_temp.ready((SELECT v FROM r WHERE k = 'd2')),
         'k44-a', pg_temp.sig())$$, 'CL048', NULL, 'DELTA dont la base n''est pas la version précédente');
UPDATE offline_snapshot_draft SET base_version = NULL, kind = 'FULL' WHERE id = (SELECT v FROM r WHERE k = 'd2');
UPDATE offline_snapshot_draft SET header = jsonb_set(jsonb_set(header, '{base_version}', '1'), '{kind}', '"FULL"')
 WHERE id = (SELECT v FROM r WHERE k = 'd2');
SELECT throws_ok($$SELECT publish_offline_snapshot((SELECT v FROM r WHERE k = 'd2'), 'k44-a', pg_temp.sig())$$,
       'CL048', NULL, 'FULL avec base_version dans l''en-tête refusé');
UPDATE offline_snapshot_draft SET kind = 'DELTA', base_version = 1,
       header = jsonb_set(jsonb_set(header, '{base_version}', '1'), '{kind}', '"DELTA"')
 WHERE id = (SELECT v FROM r WHERE k = 'd2');
SELECT is(pg_temp.pub((SELECT v FROM r WHERE k = 'd2')), 2::bigint, 'DELTA publié : version 2');
SELECT is((SELECT count(*)::int FROM offline_snapshot_media_log WHERE ledger_id = pg_temp.lg('44d001')
            AND version = 2), 1, 'journal : une ligne pour le DELTA');

-- Retrait : un bracelet libéré apparaît retiré (source et delta), puis l'état le garde.
UPDATE media_assignment SET released_at = clock_timestamp(), release_reason = 'RETURNED'
 WHERE media_id = pg_temp.id('44f102') AND released_at IS NULL;
SELECT is((SELECT count(*)::int FROM offline_snapshot_source(pg_temp.lg('44d001')) WHERE removed), 1,
       'source : le bracelet libéré ressort retiré');
SELECT is((SELECT count(*)::int FROM offline_snapshot_source(pg_temp.lg('44d001'))), 3,
       'source : 2 actifs + 1 retiré = rattachements ouverts + retirés');
SELECT is((SELECT count(*)::int FROM offline_snapshot_source_delta(pg_temp.lg('44d001'),
            clock_timestamp() + interval '1 hour') WHERE removed), 1, 'delta : retrait repris');
UPDATE media_assignment SET assigned_at = now() - interval '1 hour';
UPDATE media_batch_status_history SET at = now() - interval '1 hour';
-- Recouvrement de 5 s : changement à t-3 s repris, à t-10 s non.
INSERT INTO media_status_history (operator_id, media_id, from_status, to_status, at)
VALUES (pg_temp.id('44a001'), pg_temp.id('44f101'), 'PERSONALIZED', 'ISSUED', clock_timestamp() - interval '3 seconds'),
       (pg_temp.id('44a001'), pg_temp.id('44f102'), 'PERSONALIZED', 'ISSUED', clock_timestamp() - interval '10 seconds');
SELECT is((SELECT count(*)::int FROM offline_snapshot_source_delta(pg_temp.lg('44d001'), clock_timestamp())
            WHERE token_hash = sha256('m44-1')), 1, 'delta : changement à t-3 s repris (recouvrement 5 s)');
-- (m44-2 est retiré : sa ligne vient de l'état, pas de l'historique ; on teste t-10 s sur m44-1 ci-dessous)
UPDATE media_status_history SET at = clock_timestamp() - interval '10 seconds'
 WHERE media_id = pg_temp.id('44f101');
SELECT is((SELECT count(*)::int FROM offline_snapshot_source_delta(pg_temp.lg('44d001'), clock_timestamp())
            WHERE token_hash = sha256('m44-1')), 0, 'delta : changement à t-10 s non repris');
-- Solde : une écriture sur le portefeuille w1 reprend ses bracelets.
SELECT post_transaction(pg_temp.lg('44d001'), 'TOPUP_CASH', 'T44-1', clock_timestamp(), 'ONLINE',
  jsonb_build_array(
    jsonb_build_object('account_id', (SELECT id FROM account WHERE code = 'A-BANK-44'), 'amount', 700),
    jsonb_build_object('account_id', (SELECT id FROM account WHERE code = 'L-WAL-44-P'), 'amount', -700)));
SELECT is((SELECT count(*)::int FROM offline_snapshot_source_delta(pg_temp.lg('44d001'),
            clock_timestamp() + interval '2 seconds') WHERE token_hash = sha256('m44-1')), 1,
       'delta : solde modifié, bracelet repris');
SELECT is((SELECT (entry->>'spendable')::int FROM offline_snapshot_source(pg_temp.lg('44d001'))
            WHERE token_hash = sha256('m44-1')), 700, 'spendable reflète le solde');

-- 5. Version plantée -----------------------------------------------------------------------------------
INSERT INTO r SELECT 'd3', pg_temp.mk(pg_temp.lg('44d001'), 'DELTA', clock_timestamp() - interval '1 hour',
                                       '2026-10-30T12:02:00Z');
SELECT pg_temp.ready((SELECT v FROM r WHERE k = 'd3'));
-- Le propriétaire plante une version très grande (écriture directe, fermée à cashless_app par WP08).
ALTER TABLE offline_snapshot DISABLE TRIGGER offline_snapshot_check;
INSERT INTO offline_snapshot (operator_id, ledger_id, event_id, kind, version, base_version, generated_at,
                              valid_until, entries, content_sha256, authority_epoch, key_id, header, signature,
                              content_key_wrapped)
SELECT operator_id, ledger_id, event_id, 'DELTA', 4611686018427387904, 2, now(), now() + interval '1 hour', 0,
       sha256('p'), authority_epoch, key_id, header, signature, content_key_wrapped
  FROM offline_snapshot WHERE ledger_id = pg_temp.lg('44d001') AND version = 2;
ALTER TABLE offline_snapshot ENABLE TRIGGER offline_snapshot_check;
SELECT throws_ok($$SELECT publish_offline_snapshot((SELECT v FROM r WHERE k = 'd3'), 'k44-a', pg_temp.sig())$$,
       'CL048', NULL, 'version plantée à 2^62 : la publication refuse au lieu de sauter');
SELECT lives_ok($$SELECT discard_offline_snapshot_draft((SELECT v FROM r WHERE k = 'd3'), 'planté')$$,
       'abandon du brouillon bloqué');
SELECT throws_ok($$SELECT pg_temp.mk(pg_temp.lg('44d001'), 'DELTA', clock_timestamp(), '2026-10-30T12:03:00Z')$$,
       'CL048', NULL, 'version plantée : save refuse (chaîne rompue)');

-- 6. Purge ---------------------------------------------------------------------------------------------
-- Trois FULL sur d002 impossibles (aucun terminal) : on les produit sur le grand livre de B.
SELECT pg_temp.b();
INSERT INTO snapshot_signing_key (key_id, operator_id, owner, algorithm, public_key, kms_key_ref, status)
VALUES ('k44-b', pg_temp.id('44a002'), 'CENTRAL', 'ECDSA_P256_SHA256', '\x04', 'test:k44-b', 'ACTIVE');
CREATE FUNCTION pg_temp.pubb(p_draft bigint) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE v bigint; BEGIN
  SELECT p.version INTO v FROM publish_offline_snapshot(pg_temp.ready(p_draft), 'k44-b', pg_temp.sig()) p;
  RETURN v; END $$;
CREATE FUNCTION pg_temp.pub2(p_draft bigint) RETURNS bigint LANGUAGE sql AS $$ SELECT pg_temp.pubb(p_draft) $$;
SELECT is(pg_temp.pubb(pg_temp.mk(pg_temp.lg('44d011'), 'FULL', NULL, '2026-10-30T13:00:00Z')), 1::bigint, 'B : FULL 1');
SELECT is(pg_temp.pubb(pg_temp.mk(pg_temp.lg('44d011'), 'FULL', NULL, '2026-10-30T13:01:00Z')), 2::bigint, 'B : FULL 2');
SELECT is(pg_temp.pubb(pg_temp.mk(pg_temp.lg('44d011'), 'FULL', NULL, '2026-10-30T13:02:00Z')), 3::bigint, 'B : FULL 3');
SELECT is(purge_offline_snapshot_content(pg_temp.lg('44d011')), 1, 'purge : entrées de la version 1 supprimées');
SELECT is((SELECT count(*)::int FROM offline_snapshot_entry WHERE ledger_id = pg_temp.lg('44d011')), 2,
       'purge : versions 2 et 3 gardées');
SELECT is((SELECT count(*)::int FROM offline_snapshot WHERE ledger_id = pg_temp.lg('44d011')), 3,
       'purge : en-têtes gardés');
SELECT is((SELECT count(*)::int FROM offline_snapshot_media_log WHERE ledger_id = pg_temp.lg('44d011')), 3,
       'purge : journal gardé');
SELECT is((SELECT count(*)::int FROM offline_snapshot_state_hashes(pg_temp.lg('44d011'))), 1,
       'purge : état gardé');
SELECT is(purge_offline_snapshot_content(pg_temp.lg('44d011')), 0, 'purge : idempotente');
SELECT pg_temp.a();
SELECT throws_ok($$SELECT purge_offline_snapshot_content(pg_temp.lg('44d011'))$$, 'P0002', NULL,
       'purge : grand livre d''un autre prestataire refusé');
SELECT is(purge_offline_snapshot_content(pg_temp.lg('44d001')), 0, 'purge : moins de deux FULL, rien');

-- 7. Cycle 3 (B1 brouillon orphelin, B2 empreinte sans chiffré, B3 plafond d'âge) -------------------------
-- B1 : brouillons OPEN puis READY laissés par un passage planté, jetés sans connaître leur id.
SELECT pg_temp.a();
INSERT INTO r SELECT 'c3-other', pg_temp.mk(pg_temp.lg('44d002'), 'FULL', NULL, '2026-10-30T14:00:00Z');
SELECT pg_temp.b();
INSERT INTO r SELECT 'c3-open', save_offline_snapshot_draft(pg_temp.lg('44d011'), 'FULL',
  pg_temp.hdr('FULL', 1, 0, '2026-10-30T14:00:00Z'), '\x0102', '[]');
SELECT throws_ok($$SELECT save_offline_snapshot_draft(pg_temp.lg('44d011'), 'FULL',
  pg_temp.hdr('FULL', 0, 0, '2026-10-30T14:01:00Z'), '\x0102', '[]')$$, 'CL048', NULL,
  'B1 : brouillon orphelin OPEN bloque save (DRAFT_ALREADY_OPEN)');
SELECT is(discard_open_offline_snapshot_drafts(pg_temp.lg('44d011')), 1, 'B1 : un brouillon OPEN jeté');
SELECT is((SELECT status FROM offline_snapshot_draft WHERE id = (SELECT v FROM r WHERE k = 'c3-open')),
  'DISCARDED', 'B1 : statut DISCARDED');
SELECT isnt((SELECT discard_reason FROM offline_snapshot_draft WHERE id = (SELECT v FROM r WHERE k = 'c3-open')),
  NULL, 'B1 : motif consigné');
INSERT INTO r SELECT 'c3-ready', pg_temp.ready(pg_temp.mk(pg_temp.lg('44d011'), 'FULL', NULL, '2026-10-30T14:02:00Z'));
SELECT is((SELECT count(*)::int FROM offline_snapshot_entry WHERE draft_id = (SELECT v FROM r WHERE k = 'c3-ready')),
  1, 'B1 : le brouillon READY a une entrée');
SELECT is(discard_open_offline_snapshot_drafts(pg_temp.lg('44d011')), 1, 'B1 : un brouillon READY jeté');
SELECT is((SELECT status FROM offline_snapshot_draft WHERE id = (SELECT v FROM r WHERE k = 'c3-ready')),
  'DISCARDED', 'B1 : READY passé à DISCARDED');
SELECT is((SELECT count(*)::int FROM offline_snapshot_entry WHERE draft_id = (SELECT v FROM r WHERE k = 'c3-ready')),
  0, 'B1 : entrées du READY supprimées');
SELECT is(discard_open_offline_snapshot_drafts(pg_temp.lg('44d011')), 0, 'B1 : rien à jeter, zéro');
SELECT is((SELECT count(*)::int FROM offline_snapshot_draft WHERE ledger_id = pg_temp.lg('44d011')
  AND status = 'PUBLISHED'), 3, 'B1 : les brouillons PUBLISHED sont intacts');
SELECT is((SELECT count(*)::int FROM offline_snapshot WHERE ledger_id = pg_temp.lg('44d011')), 3,
  'B1 : les snapshots publiés sont intacts');
SELECT is((SELECT status FROM offline_snapshot_draft WHERE id = (SELECT v FROM r WHERE k = 'c3-other')),
  'OPEN', 'B1 : le brouillon d''un autre grand livre (autre prestataire) est intact') ;
SELECT lives_ok($$SELECT pg_temp.mk(pg_temp.lg('44d011'), 'FULL', NULL, '2026-10-30T14:03:00Z')$$,
  'B1 : save réussit après le nettoyage');
SELECT is(discard_open_offline_snapshot_drafts(pg_temp.lg('44d011')), 1, 'B1 : nettoyage du brouillon de contrôle');
SELECT throws_ok($$SELECT discard_open_offline_snapshot_drafts(pg_temp.lg('44d001'))$$, 'P0002', NULL,
  'B1 : grand livre d''un autre prestataire refusé');
SELECT pg_temp.a();
SELECT throws_ok($$SELECT discard_open_offline_snapshot_drafts(pg_temp.lg('44d011'))$$, 'P0002', NULL,
  'B1 : B vu depuis A refusé');
SELECT is(discard_open_offline_snapshot_drafts(pg_temp.lg('44d002')), 1, 'B1 : A jette son propre brouillon');
SELECT is((SELECT count(*)::int FROM pg_proc p WHERE p.proname = 'discard_open_offline_snapshot_drafts'
  AND p.prosecdef AND p.proconfig @> ARRAY['search_path=public, pg_temp']
  AND NOT has_function_privilege('public', p.oid, 'EXECUTE')
  AND NOT has_function_privilege('cashless_app', p.oid, 'EXECUTE')), 1,
  'B1 : SECURITY DEFINER, search_path figé, ni PUBLIC ni cashless_app');

-- B2 : l'empreinte d'état ne dépend pas du chiffré du mot de passe.
CREATE FUNCTION pg_temp.items_pw(p_ledger uuid) RETURNS jsonb LANGUAGE sql AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('token_hash', encode(s.token_hash, 'hex'),
           'entry', s.entry || jsonb_build_object('pwd_pack_sha256', encode(sha256(s.pwd_pack_enc), 'hex')),
           'pwd_pack_enc', encode(s.pwd_pack_enc, 'hex'), 'removed', false)), '[]'::jsonb)
    FROM offline_snapshot_source(p_ledger) s WHERE NOT s.removed $$;
SELECT pg_temp.b();
SELECT is(offline_snapshot_entry_sha256('{"a":1,"pwd_pack_sha256":null}'),
  offline_snapshot_entry_sha256('{"a":1,"pwd_pack_sha256":"ff"}'), 'B2 : l''empreinte ignore pwd_pack_sha256');
SELECT isnt(offline_snapshot_entry_sha256('{"a":1,"pwd_pack_sha256":null}'),
  offline_snapshot_entry_sha256('{"a":2,"pwd_pack_sha256":null}'), 'B2 : l''empreinte suit les autres champs');
SELECT is(pg_temp.pub2(
  (SELECT save_offline_snapshot_draft(pg_temp.lg('44d011'), 'FULL',
     pg_temp.hdr('FULL', 1, 0, '2026-10-30T14:10:00Z'), '\x0102', pg_temp.items_pw(pg_temp.lg('44d011'))))),
  4::bigint, 'B2 : FULL avec mot de passe publié (version 4)');
SELECT is((SELECT count(*)::int FROM offline_snapshot_entry WHERE ledger_id = pg_temp.lg('44d011')
  AND version = 4 AND pwd_pack_enc IS NOT NULL AND entry->>'pwd_pack_sha256' IS NOT NULL), 1,
  'B2 : l''entrée publiée porte bien un mot de passe lié');
SELECT is((SELECT entry_sha256 FROM offline_snapshot_state_hashes(pg_temp.lg('44d011'))
    WHERE token_hash = sha256('m44-b')),
  offline_snapshot_entry_sha256((SELECT entry FROM offline_snapshot_source(pg_temp.lg('44d011'))
    WHERE token_hash = sha256('m44-b'))), 'B2 : source rejouée = état publié, aucun changement détecté');
-- Même source, autre chiffré (rechiffrement, nonce différent) : toujours aucun changement.
UPDATE media SET pwd_pack_enc = decode(repeat('ee', 34), 'hex') WHERE id = pg_temp.id('44f111');
SELECT is((SELECT entry_sha256 FROM offline_snapshot_state_hashes(pg_temp.lg('44d011'))
    WHERE token_hash = sha256('m44-b')),
  offline_snapshot_entry_sha256((SELECT entry FROM offline_snapshot_source(pg_temp.lg('44d011'))
    WHERE token_hash = sha256('m44-b'))), 'B2 : autre chiffré, même mot de passe : aucun changement');
-- Mot de passe réellement changé (nouvel index de clé, donc nouvelle dérivation) : changement détecté.
INSERT INTO tag_key (operator_id, key_index, kms_key_ref, status)
VALUES (pg_temp.id('44a002'), 2, 'test:hmac-44b2', 'ACTIVE');
UPDATE media_batch SET key_index = 2 WHERE id = pg_temp.id('44f911');
UPDATE media SET key_index = 2 WHERE id = pg_temp.id('44f111');
SELECT isnt((SELECT entry_sha256 FROM offline_snapshot_state_hashes(pg_temp.lg('44d011'))
    WHERE token_hash = sha256('m44-b')),
  offline_snapshot_entry_sha256((SELECT entry FROM offline_snapshot_source(pg_temp.lg('44d011'))
    WHERE token_hash = sha256('m44-b'))), 'B2 : key_index changé (mot de passe changé) : changement détecté');
UPDATE media_batch SET key_index = 1 WHERE id = pg_temp.id('44f911');
UPDATE media SET key_index = 1 WHERE id = pg_temp.id('44f111');
-- Ligne sans mot de passe : empreinte inchangée par la clé retirée.
SELECT is(offline_snapshot_entry_sha256((SELECT entry FROM offline_snapshot_source(pg_temp.lg('44d011')) LIMIT 1)),
  offline_snapshot_entry_sha256((SELECT entry || '{"pwd_pack_sha256":null}' FROM
    offline_snapshot_source(pg_temp.lg('44d011')) LIMIT 1)), 'B2 : ligne sans mot de passe inchangée');

-- B3 : plafond d'âge effectif.
SELECT pg_temp.a();
SELECT is((SELECT max_snapshot_age FROM offline_snapshot_targets() WHERE ledger_id = pg_temp.lg('44d001')),
  interval '15 minutes', 'B3 : plafond hérité (aucune politique ne le fixe) : 15 minutes');
INSERT INTO offline_policy (operator_id, scope_type, scope_id, max_snapshot_age)
VALUES (pg_temp.id('44a001'), 'DEVICE', pg_temp.id('44aa02'), interval '5 minutes');
SELECT is((SELECT max_snapshot_age FROM offline_snapshot_targets() WHERE ledger_id = pg_temp.lg('44d001')),
  interval '5 minutes', 'B3 : plafond surchargé sur un terminal : le plus petit des terminaux éligibles');
INSERT INTO offline_policy (operator_id, scope_type, scope_id, max_snapshot_age)
VALUES (pg_temp.id('44a002'), 'DEVICE', pg_temp.id('44ab01'), interval '20 minutes');
SELECT is((SELECT max_snapshot_age FROM offline_snapshot_targets() WHERE ledger_id = pg_temp.lg('44d011')),
  interval '20 minutes', 'B3 : plafond surchargé supérieur au défaut rendu tel quel');

SELECT * FROM finish();
ROLLBACK;
