-- Version du secret des codes de rattachement, réémission, numéro imprimé (migration 0097, mission 10a,
-- WP02) — pgTAP, écrit à la main. Lancer : pg_prove -d <base> tests/tests_claim_key_version.sql
-- Fonctions prouvées en propriétaire (les droits d'EXECUTE sont posés par post-roles.sql, WP04).
-- Tous les comptages sont limités aux objets de la suite (prestataires 97a001 et 97a002).
\set ON_ERROR_STOP 1
\set QUIET 1
BEGIN;
\ir _grants_for_tests.sql
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

CREATE FUNCTION pg_temp.id(p text) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT ('00000000-0000-0000-0000-' || lpad(p, 12, '0'))::uuid $$;
-- Bracelet n (un caractère hexadécimal), festivalier n, empreintes de code (version v, numéro n).
CREATE FUNCTION pg_temp.m(t text) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT ('00000000-0000-0000-0000-00000097d00' || t)::uuid $$;
CREATE FUNCTION pg_temp.c(n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT pg_temp.id('97c0' || lpad(n::text, 2, '0')) $$;
CREATE FUNCTION pg_temp.h(v int, n int) RETURNS bytea LANGUAGE sql IMMUTABLE AS
  $$ SELECT sha256(('code 0097 v' || v || ' ' || n)::bytea) $$;
CREATE FUNCTION pg_temp.k(n int) RETURNS bytea LANGUAGE sql IMMUTABLE AS
  $$ SELECT sha256(('confirmation 0097 ' || n)::bytea) $$;
CREATE FUNCTION pg_temp.as_op(p text) RETURNS void LANGUAGE sql AS
  $$ SELECT set_config('app.operator_id', pg_temp.id(p)::text, true) $$;
-- Résultat de claim_media en un mot (version v).
CREATE FUNCTION pg_temp.claim(code bytea, customer int, claim int, v int) RETURNS text LANGUAGE sql AS $$
  SELECT outcome FROM claim_media(code, pg_temp.c(customer), 'dev-' || customer,
         CASE WHEN claim IS NULL THEN gen_random_uuid() ELSE pg_temp.id('97e5' || lpad(claim::text, 2, '0')) END,
         pg_temp.k(coalesce(claim, 0)), v::smallint)
$$;
CREATE FUNCTION pg_temp.q(n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT pg_temp.id('97e5' || lpad(n::text, 2, '0')) $$;
-- Réémission avec les empreintes de version v des bracelets listés (numéros t).
CREATE FUNCTION pg_temp.reissue(batch text, ids text[], v int, op text DEFAULT '97a001') RETURNS int
LANGUAGE sql AS $$
  SELECT reissue_claim_codes(pg_temp.id(op), pg_temp.id(batch),
           (SELECT array_agg(pg_temp.m(t) ORDER BY o) FROM unnest(ids) WITH ORDINALITY u(t, o)),
           (SELECT array_agg(pg_temp.h(v, ('x0' || t)::bit(8)::int) ORDER BY o) FROM unnest(ids) WITH ORDINALITY u(t, o)),
           v::smallint)
$$;

-- Fixture (propriétaire) -------------------------------------------------------------------------------------
INSERT INTO party (id, kind, legal_name, country_code) VALUES
 (pg_temp.id('97a001'), 'OPERATOR', 'Prestataire A', 'SN'),
 (pg_temp.id('97a002'), 'OPERATOR', 'Prestataire B', 'CI');
INSERT INTO party (id, kind, operator_id, legal_name) VALUES
 (pg_temp.id('97a011'), 'ORGANIZER', pg_temp.id('97a001'), 'Organisateur A'),
 (pg_temp.id('97a012'), 'ORGANIZER', pg_temp.id('97a002'), 'Organisateur B');
INSERT INTO party (id, kind, operator_id, legal_name)
SELECT pg_temp.c(n), 'CUSTOMER', pg_temp.id('97a001'), 'Festivalier ' || n FROM generate_series(1, 8) n;
INSERT INTO jurisdiction_profile (id, country_code, version, valid_from, breakage_destination)
VALUES (pg_temp.id('97a041'), 'SN', 970001, '2026-01-01', 'ORGANIZER');
INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone, jurisdiction_id, funds_holder)
VALUES (pg_temp.id('97a061'), pg_temp.id('97a001'), pg_temp.id('97a011'), 'Événement A', 'XOF',
        'Africa/Dakar', pg_temp.id('97a041'), 'ORGANIZER');
INSERT INTO ledger (id, operator_id, scope_type, scope_id, currency, issuer_id, funds_holder_id)
VALUES (pg_temp.id('97a071'), pg_temp.id('97a001'), 'EVENT', pg_temp.id('97a061'), 'XOF',
        pg_temp.id('97a011'), pg_temp.id('97a011'));
INSERT INTO tag_key (operator_id, key_index, kms_key_ref) VALUES
 (pg_temp.id('97a001'), 1, 'test:hmac-a'), (pg_temp.id('97a002'), 1, 'test:hmac-b');
-- bP (PUBLIC, 6) ; bS (STAFF) ; bC (PUBLIC, sera clos) ; bQ (PUBLIC, 4, autre lot du même prestataire) ; bB (B).
INSERT INTO media_batch (id, operator_id, organizer_id, kind, quantity, key_index, reuse_policy) VALUES
 (pg_temp.id('97b001'), pg_temp.id('97a001'), pg_temp.id('97a011'), 'PUBLIC', 6, 1, 'SINGLE_USE'),
 (pg_temp.id('97b002'), pg_temp.id('97a001'), pg_temp.id('97a011'), 'STAFF', 2, 1, 'SINGLE_USE'),
 (pg_temp.id('97b003'), pg_temp.id('97a001'), pg_temp.id('97a011'), 'PUBLIC', 1, 1, 'SINGLE_USE'),
 (pg_temp.id('97b004'), pg_temp.id('97a001'), pg_temp.id('97a011'), 'PUBLIC', 4, 1, 'SINGLE_USE'),
 (pg_temp.id('97b009'), pg_temp.id('97a002'), pg_temp.id('97a012'), 'PUBLIC', 2, 1, 'SINGLE_USE');
-- Portefeuilles anonymes des bracelets actifs 1 (solde 0), 2 (500), 4 (700) ; 3, 5, 6 : en stock.
INSERT INTO wallet (id, operator_id, ledger_id)
SELECT pg_temp.id('97e00' || n), pg_temp.id('97a001'), pg_temp.id('97a071') FROM unnest(ARRAY[1,2,4]) n;
INSERT INTO media (id, operator_id, kind, token_hash, nfc_uid, batch_id, key_index, status, wallet_id)
SELECT pg_temp.m(t), pg_temp.id('97a001'), 'NFC_TAG', sha256(('identité 0097 ' || t)::bytea),
       decode('0497000000000' || t, 'hex'),
       CASE WHEN t = '7' THEN pg_temp.id('97b003') WHEN t IN ('9','a','b','c') THEN pg_temp.id('97b004')
            ELSE pg_temp.id('97b001') END, 1,
       CASE WHEN t IN ('1','2','4') THEN 'ACTIVE' ELSE 'PERSONALIZED' END,
       CASE WHEN t IN ('1','2','4') THEN pg_temp.id('97e00' || t) END
  FROM unnest(ARRAY['1','2','3','4','5','6','7','9','a','b','c']) t;
INSERT INTO media (id, operator_id, kind, token_hash, nfc_uid, batch_id, key_index, status) VALUES
 (pg_temp.m('8'), pg_temp.id('97a002'), 'NFC_TAG', sha256('identité 0097 B'), '\x04970000000008',
  pg_temp.id('97b009'), 1, 'PERSONALIZED');
INSERT INTO account (id, operator_id, ledger_id, code, family, purpose, wallet_id, normal_side)
SELECT pg_temp.id('97f00' || n), pg_temp.id('97a001'), pg_temp.id('97a071'), 'L-WAL-0097-' || n || '-P', 'CLAIM',
       'WALLET_PAID', pg_temp.id('97e00' || n), 'C' FROM unnest(ARRAY[1,2,4]) n;
INSERT INTO account_balance (account_id, operator_id, balance)
SELECT pg_temp.id('97f00' || n), pg_temp.id('97a001'), b FROM (VALUES (1, 0), (2, -500), (4, -700)) v(n, b)
ON CONFLICT (account_id) DO UPDATE SET balance = EXCLUDED.balance;
INSERT INTO device (id, operator_id, event_id, serial)
VALUES (pg_temp.id('97d101'), pg_temp.id('97a001'), pg_temp.id('97a061'), 'TERM-0097');

-- 1. Émission : la version est posée, une seconde commande reste refusée -------------------------------------------
SELECT pg_temp.as_op('97a001');
SELECT throws_ok($$SELECT issue_claim_codes(pg_temp.id('97b001'), ARRAY[pg_temp.h(1,1)], NULL)$$, 'CL001', NULL,
  'issue_claim_codes : version nulle refusée');
SELECT throws_ok($$SELECT issue_claim_codes(pg_temp.id('97b001'), ARRAY[pg_temp.h(1,1)], 0::smallint)$$, 'CL001', NULL,
  'issue_claim_codes : version 0 refusée');
SELECT is(issue_claim_codes(pg_temp.id('97b001'), ARRAY(SELECT pg_temp.h(1, n) FROM generate_series(1, 6) n ORDER BY n), 1::smallint),
  6, 'issue_claim_codes : six codes enregistrés');
SELECT is((SELECT count(*)::int FROM claim_code WHERE batch_id = pg_temp.id('97b001') AND key_version = 1), 6,
  'issue_claim_codes : key_version = 1 sur les six lignes');
SELECT is(issue_claim_codes(pg_temp.id('97b004'), ARRAY(SELECT pg_temp.h(1, n) FROM generate_series(80, 83) n ORDER BY n), 1::smallint),
  4, 'issue_claim_codes : second lot du prestataire');
SELECT throws_ok($$SELECT issue_claim_codes(pg_temp.id('97b001'), ARRAY(SELECT pg_temp.h(2, n) FROM generate_series(1, 6) n), 2::smallint)$$,
  'CL020', 'CLAIM_CODES_ALREADY_ISSUED : le fichier de commande de ce lot a déjà été produit',
  'une seconde commande reste refusée, même avec une autre version');
-- Colonnes : défaut 1 sur les trois tables.
SELECT is((SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d JOIN pg_attribute a
            ON a.attrelid = d.adrelid AND a.attnum = d.adnum
            WHERE d.adrelid = 'media'::regclass AND a.attname = 'claim_key_version'), '1', 'media.claim_key_version : défaut 1');
SELECT is((SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d JOIN pg_attribute a
            ON a.attrelid = d.adrelid AND a.attnum = d.adnum
            WHERE d.adrelid = 'claim_code'::regclass AND a.attname = 'key_version'), '1', 'claim_code.key_version : défaut 1');
SELECT is((SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d JOIN pg_attribute a
            ON a.attrelid = d.adrelid AND a.attnum = d.adnum
            WHERE d.adrelid = 'media_claim'::regclass AND a.attname = 'key_version'), '1', 'media_claim.key_version : défaut 1');
SELECT is((SELECT claim_key_version FROM media WHERE id = pg_temp.m('1')), 1::smallint, 'bracelet existant : version 1');
SELECT is(claim_key_version_max(),
  (SELECT greatest((SELECT max(claim_key_version) FROM media), (SELECT max(key_version) FROM claim_code),
                   (SELECT max(key_version) FROM media_claim)))::smallint,
  'claim_key_version_max : égale au calcul direct');
SELECT is(claim_key_version_max(), 1::smallint, 'claim_key_version_max : 1 tant que tout est en version 1');

-- 2. Association : un code d'une autre version est inconnu ------------------------------------------------------------
-- Bracelets 1 à 4 reçoivent leur code de version 1 ; le 5 sert au contrôle de version.
SELECT lives_ok($$SELECT associate_claim_code(pg_temp.h(1, n), pg_temp.m(n::text), NULL, 1::smallint)
                  FROM generate_series(1, 4) n$$, 'codes 1 à 4 associés (version 1)');
SELECT is((SELECT claim_key_version FROM media WHERE id = pg_temp.m('2')), 1::smallint, 'association : version posée sur le bracelet');
SELECT throws_ok($$SELECT associate_claim_code(pg_temp.h(1, 5), pg_temp.m('5'), NULL, 2::smallint)$$, 'CL020',
  'CLAIM_CODE_UNKNOWN : code inconnu', 'associate_claim_code : code de version 1 appelé en version 2 : inconnu');
SELECT is((SELECT claim_code_hash FROM media WHERE id = pg_temp.m('5')), NULL, 'association refusée : bracelet inchangé');
SELECT throws_ok($$SELECT associate_claim_code(pg_temp.h(1, 5), pg_temp.m('5'), NULL, NULL)$$, 'CL001', NULL, 'association : version nulle');
SELECT lives_ok($$SELECT associate_claim_code(pg_temp.h(1, 5), pg_temp.m('5'), NULL, 1::smallint)$$,
  'le même appel en version 1 réussit (le test n''est pas vide)');

-- 3. Ancienne version absente : rattachement, confirmation, consultation ------------------------------------------------
SELECT is(pg_temp.claim(pg_temp.h(1, 1), 1, NULL, 2), 'REFUSED', 'claim_media : code v1 appelé en v2 : REFUSED');
SELECT is((SELECT count(*)::int FROM media_claim WHERE operator_id = pg_temp.id('97a001')), 0, 'aucune demande créée');
SELECT is((SELECT count(*)::int FROM wallet WHERE id = pg_temp.id('97e001') AND customer_id IS NOT NULL), 0,
  'aucun rattachement du portefeuille');
SELECT is((SELECT claim_attempts FROM media WHERE id = pg_temp.m('1')), 0, 'essai compté comme pour un inconnu (rien sur le bracelet)');
SELECT is((SELECT claim_code_used_at FROM media WHERE id = pg_temp.m('1')), NULL, 'code non consommé');
SELECT is(pg_temp.claim(pg_temp.h(1, 1), 1, NULL, 1), 'ATTACHED', 'claim_media : le même appel en v1 réussit');
SELECT throws_ok($$SELECT claim_media(pg_temp.h(1,1), pg_temp.c(1), 'd', NULL, NULL, NULL)$$, 'CL001', NULL, 'claim_media : version nulle');

SELECT is(pg_temp.claim(pg_temp.h(1, 2), 2, 1, 1), 'PENDING', 'demande en attente créée en v1');
SELECT is((SELECT key_version FROM media_claim WHERE id = pg_temp.q(1)), 1::smallint, 'la demande porte la version 1');
SELECT is(confirm_media_claim(pg_temp.q(1), pg_temp.m('2'), pg_temp.k(1), pg_temp.id('97d101'), pg_temp.c(7), 2::smallint),
  'REFUSED', 'confirm_media_claim : demande v1 confirmée en v2 avec le bon code : REFUSED');
SELECT is((SELECT status || ':' || attempts FROM media_claim WHERE id = pg_temp.q(1)), 'PENDING:0', 'demande inchangée');
SELECT is((SELECT claim_code_used_at FROM media WHERE id = pg_temp.m('2')), NULL, 'bracelet non rattaché');
SELECT throws_ok($$SELECT confirm_media_claim(pg_temp.q(1), pg_temp.m('2'), pg_temp.k(1), pg_temp.id('97d101'), pg_temp.c(7), 0::smallint)$$,
  'CL001', NULL, 'confirm_media_claim : version 0 refusée');
SELECT is(confirm_media_claim(pg_temp.q(1), pg_temp.m('2'), pg_temp.k(1), pg_temp.id('97d101'), pg_temp.c(7), 1::smallint),
  'CONFIRMED', 'le même appel en v1 réussit');

SELECT is((SELECT outcome FROM public_balance_lookup(pg_temp.h(1, 4), 'adr-1', 2::smallint)), 'REFUSED',
  'public_balance_lookup : code v1 appelé en v2 : REFUSED');
SELECT is((SELECT outcome FROM public_balance_lookup(pg_temp.h(1, 4), 'adr-1', 1::smallint)), 'LOOKUP',
  'le même appel en v1 renvoie le solde');
SELECT throws_ok($$SELECT public_balance_lookup(pg_temp.h(1, 4), 'adr-1', NULL)$$, 'CL001', NULL, 'consultation : version nulle');

-- 4. Réémission : refus (rien d'écrit), puis succès ---------------------------------------------------------------------
-- État : 1 et 2 au code utilisé ; 3, 4, 5 au code v1 jamais utilisé ; 6 sans code (code 6 non associé).
CREATE TEMP TABLE before_state AS
  SELECT m.id, m.claim_code_hash, m.claim_key_version FROM media m WHERE m.batch_id = pg_temp.id('97b001');
SELECT set_config('t97.issued_at', (SELECT claim_codes_issued_at::text FROM media_batch WHERE id = pg_temp.id('97b001')), true);
SELECT throws_ok($$SELECT pg_temp.reissue('97b001', ARRAY['3','1'], 2)$$, 'CL064', NULL,
  'un bracelet au code utilisé dans la liste : CL064');
SELECT is((SELECT count(*)::int FROM media m JOIN before_state b USING (id)
            WHERE m.claim_code_hash IS DISTINCT FROM b.claim_code_hash OR m.claim_key_version <> b.claim_key_version), 0,
  'tout ou rien : aucun bracelet changé');
SELECT is((SELECT count(*)::int FROM claim_code WHERE batch_id = pg_temp.id('97b001') AND key_version = 2), 0,
  'tout ou rien : aucune ligne de code v2');
SELECT throws_ok($$SELECT pg_temp.reissue('97b001', ARRAY['1'], 2)$$, 'CL064', NULL, 'bracelet au code utilisé (rattaché) : CL064');
SELECT throws_ok($$SELECT pg_temp.reissue('97b001', ARRAY['2'], 2)$$, 'CL064', NULL, 'bracelet au code utilisé (confirmé) : CL064');
SELECT throws_ok($$SELECT pg_temp.reissue('97b001', ARRAY['9'], 2)$$, 'CL064', NULL, 'bracelet d''un autre lot : CL064');
SELECT throws_ok($$SELECT pg_temp.reissue('97b001', ARRAY['8'], 2)$$, 'CL064', NULL, 'bracelet d''un autre prestataire : CL064');
SELECT throws_ok($$SELECT pg_temp.reissue('97b001', ARRAY['3'], 1)$$, 'CL064', NULL, 'même version que le code courant : CL064');
SELECT throws_ok($$SELECT pg_temp.reissue('97b002', ARRAY['3'], 2)$$, 'CL020', NULL, 'lot STAFF : CL020');
SELECT throws_ok($$SELECT pg_temp.reissue('97b777', ARRAY['3'], 2)$$, 'P0002', NULL, 'lot inconnu : introuvable');
SELECT throws_ok($$SELECT pg_temp.reissue('97b009', ARRAY['8'], 2)$$, 'P0002', NULL, 'lot d''un autre prestataire : introuvable');
SELECT throws_ok($$SELECT reissue_claim_codes(pg_temp.id('97a001'), pg_temp.id('97b001'), ARRAY[pg_temp.m('3'), pg_temp.m('4')],
  ARRAY[pg_temp.h(2,3)], 2::smallint)$$, 'CL001', NULL, 'tailles différentes : CL001');
SELECT throws_ok($$SELECT reissue_claim_codes(pg_temp.id('97a001'), pg_temp.id('97b001'), ARRAY[pg_temp.m('3'), pg_temp.m('3')],
  ARRAY[pg_temp.h(2,3), pg_temp.h(2,4)], 2::smallint)$$, 'CL001', NULL, 'bracelet en double : CL001');
SELECT throws_ok($$SELECT reissue_claim_codes(pg_temp.id('97a001'), pg_temp.id('97b001'), ARRAY[pg_temp.m('3'), pg_temp.m('4')],
  ARRAY[pg_temp.h(2,3), pg_temp.h(2,3)], 2::smallint)$$, 'CL001', NULL, 'empreinte en double : CL001');
SELECT throws_ok($$SELECT reissue_claim_codes(pg_temp.id('97a001'), pg_temp.id('97b001'), ARRAY[pg_temp.m('3')],
  ARRAY['\x0102'::bytea], 2::smallint)$$, 'CL001', NULL, 'empreinte de 2 octets : CL001');
SELECT throws_ok($$SELECT reissue_claim_codes(pg_temp.id('97a001'), pg_temp.id('97b001'), ARRAY[]::uuid[], ARRAY[]::bytea[], 2::smallint)$$,
  'CL001', NULL, 'tableaux vides : CL001');
SELECT throws_ok($$SELECT reissue_claim_codes(pg_temp.id('97a001'), pg_temp.id('97b001'), ARRAY[pg_temp.m('3')],
  ARRAY[pg_temp.h(2,3)], NULL)$$, 'CL001', NULL, 'version nulle : CL001');
SELECT throws_ok($$SELECT reissue_claim_codes(NULL, pg_temp.id('97b001'), ARRAY[pg_temp.m('3')],
  ARRAY[pg_temp.h(2,3)], 2::smallint)$$, 'CL001', NULL, 'prestataire nul : CL001');

-- Lot clos admis : bracelet 7 du lot 97b003 au code v1 jamais utilisé.
INSERT INTO claim_code (operator_id, batch_id, code_hash, key_version, media_id, associated_at)
VALUES (pg_temp.id('97a001'), pg_temp.id('97b003'), pg_temp.h(1, 70), 1, pg_temp.m('7'), now());
UPDATE media SET claim_code_hash = pg_temp.h(1, 70) WHERE id = pg_temp.m('7');
UPDATE media_batch SET status = 'CLOSED' WHERE id = pg_temp.id('97b003');
SELECT is((SELECT status FROM media_batch WHERE id = pg_temp.id('97b003')), 'CLOSED', 'fixture : lot clos');
SELECT is(pg_temp.reissue('97b003', ARRAY['7'], 2), 1, 'lot clos admis : un bracelet réémis');
SELECT is((SELECT claim_code_hash FROM media WHERE id = pg_temp.m('7')), pg_temp.h(2, 7), 'lot clos : nouvelle empreinte posée');

-- Succès : 3 (code v1 non utilisé), 4 (idem), 5 (idem), 6 (sans code) ; rank des appels dans l'ordre de la liste.
SELECT is(pg_temp.reissue('97b001', ARRAY['3','4','5','6'], 2), 4, 'réémission : quatre bracelets');
SELECT is((SELECT claim_code_hash FROM media WHERE id = pg_temp.m('3')), pg_temp.h(2, 3), 'bracelet 3 : nouvelle empreinte');
SELECT is((SELECT claim_key_version FROM media WHERE id = pg_temp.m('3')), 2::smallint, 'bracelet 3 : version 2');
SELECT is((SELECT claim_code_hash FROM media WHERE id = pg_temp.m('6')), pg_temp.h(2, 6), 'bracelet sans code : code posé');
SELECT is((SELECT array_agg(claim_key_version ORDER BY id) FROM media WHERE id IN (pg_temp.m('1'), pg_temp.m('2'))),
  ARRAY[1,1]::smallint[], 'bracelets au code utilisé : inchangés');
SELECT is((SELECT media_id || ':' || key_version FROM claim_code WHERE code_hash = pg_temp.h(2, 3)),
  pg_temp.m('3') || ':2', 'nouvelle ligne claim_code : associée, version 2');
SELECT is((SELECT (media_id IS NULL AND associated_at IS NULL AND invalidated_at IS NOT NULL)
             FROM claim_code WHERE code_hash = pg_temp.h(1, 3)), true,
  'ancienne ligne libérée et invalidée');
SELECT is((SELECT invalidated_at IS NOT NULL FROM claim_code WHERE code_hash = pg_temp.h(1, 6)), true,
  'ancien code non associé du lot : invalidé');
SELECT is((SELECT media_id FROM claim_code WHERE code_hash = pg_temp.h(1, 1)), pg_temp.m('1'),
  'ligne du bracelet au code utilisé : intacte');
SELECT is((SELECT claim_codes_issued_at::text FROM media_batch WHERE id = pg_temp.id('97b001')), current_setting('t97.issued_at'),
  'claim_codes_issued_at inchangé');
SELECT is((SELECT claim_codes_issued_at IS NULL FROM media_batch WHERE id = pg_temp.id('97b003')), true,
  'lot clos : claim_codes_issued_at non posé par la réémission');
SELECT throws_ok($$SELECT pg_temp.reissue('97b001', ARRAY['3'], 2)$$, 'CL064', NULL, 'bracelet déjà en version 2 : CL064');
-- Audit : le nombre, jamais une empreinte.
SELECT is((SELECT (after->>'count')::int FROM audit_log WHERE operator_id = pg_temp.id('97a001')
             AND action = 'CLAIM_CODES_REISSUED' AND object_id = pg_temp.id('97b001')::text), 4, 'audit : nombre de bracelets');
SELECT is((SELECT after->>'key_version' FROM audit_log WHERE operator_id = pg_temp.id('97a001')
             AND action = 'CLAIM_CODES_REISSUED' AND object_id = pg_temp.id('97b001')::text), '2', 'audit : version');
SELECT is((SELECT count(*)::int FROM audit_log a, generate_series(1, 7) n, generate_series(1, 2) v
            WHERE a.operator_id = pg_temp.id('97a001') AND a.action = 'CLAIM_CODES_REISSUED'
              AND (a.after::text LIKE '%' || encode(pg_temp.h(v, n), 'hex') || '%'
                   OR a.after::text LIKE '%' || encode(pg_temp.h(v, n), 'base64') || '%'
                   OR a.before::text LIKE '%' || encode(pg_temp.h(v, n), 'hex') || '%')), 0,
  'audit : aucun octet des empreintes');
SELECT is((SELECT origin FROM audit_log WHERE operator_id = pg_temp.id('97a001') AND action = 'CLAIM_CODES_REISSUED'
             AND object_id = pg_temp.id('97b001')::text), 'claim-admin', 'audit : origine');
SELECT is(claim_key_version_max(), 2::smallint, 'claim_key_version_max : 2 après la réémission');
SELECT is(claim_key_version_max(),
  (SELECT greatest((SELECT max(claim_key_version) FROM media), (SELECT max(key_version) FROM claim_code),
                   (SELECT max(key_version) FROM media_claim)))::smallint, 'claim_key_version_max : égale au calcul direct');
-- Le code v1 d'un bracelet réémis est refusé partout ; le v2 réussit (contrôle positif).
SELECT is(pg_temp.claim(pg_temp.h(1, 3), 3, NULL, 1), 'REFUSED', 'réémis : code v1 refusé au rattachement (v1)');
SELECT is(pg_temp.claim(pg_temp.h(1, 3), 3, NULL, 2), 'REFUSED', 'réémis : code v1 refusé au rattachement (v2)');
SELECT is(pg_temp.claim(pg_temp.h(2, 3), 3, NULL, 2), 'NOT_ACTIVE', 'réémis : le code v2 est reconnu');
SELECT is((SELECT outcome FROM public_balance_lookup(pg_temp.h(1, 4), 'adr-2', 1::smallint)), 'REFUSED',
  'réémis : consultation du code v1 refusée (v1)');
SELECT is((SELECT outcome FROM public_balance_lookup(pg_temp.h(1, 4), 'adr-2', 2::smallint)), 'REFUSED',
  'réémis : consultation du code v1 refusée (v2)');
SELECT is((SELECT outcome FROM public_balance_lookup(pg_temp.h(2, 4), 'adr-2', 2::smallint)), 'LOOKUP',
  'réémis : consultation du code v2 réussie');
SELECT throws_ok($$SELECT associate_claim_code(pg_temp.h(1, 4), pg_temp.m('6'), NULL, 1::smallint)$$, 'CL020',
  'CLAIM_CODE_INVALIDATED : code invalidé à la clôture du lot', 'réémis : l''ancien code ne s''associe plus');

-- 5. Numéro imprimé et association d'un code de version nouvelle -------------------------------------------------------
-- Lot 97b004 : bracelets 9, a, b, c ; codes v1 80 à 83 (émis plus haut).
SELECT lives_ok($$SELECT associate_claim_code(pg_temp.h(1, 80), pg_temp.m('9'), 'ab-12', 1::smallint)$$,
  'association avec numéro imprimé');
SELECT is((SELECT printed_number FROM media WHERE id = pg_temp.m('9')), 'AB-12', 'numéro posé, en majuscules');
SELECT throws_ok($$SELECT associate_claim_code(pg_temp.h(1, 81), pg_temp.m('a'), 'AB-12', 1::smallint)$$, 'CL065',
  'PRINTED_NUMBER_TAKEN : numéro imprimé déjà pris', 'numéro déjà pris dans le prestataire : CL065 (contrôle explicite)');
SELECT is((SELECT claim_code_hash FROM media WHERE id = pg_temp.m('a')), NULL, 'refus : bracelet inchangé');
SELECT is((SELECT media_id FROM claim_code WHERE code_hash = pg_temp.h(1, 81)), NULL, 'refus : code toujours libre');
SELECT throws_ok($$SELECT associate_claim_code(pg_temp.h(1, 81), pg_temp.m('a'), 'ab-12', 1::smallint)$$, 'CL065', NULL,
  'doublon en minuscules : CL065');
SELECT throws_ok($$SELECT associate_claim_code(pg_temp.h(1, 81), pg_temp.m('a'), repeat('A', 33), 1::smallint)$$, '23514', NULL,
  'numéro de 33 caractères : refusé par la base');
SELECT throws_ok($$SELECT associate_claim_code(pg_temp.h(1, 81), pg_temp.m('a'), 'A B', 1::smallint)$$, '23514', NULL,
  'numéro avec une espace : refusé par la base');
SELECT lives_ok($$SELECT associate_claim_code(pg_temp.h(1, 81), pg_temp.m('a'), repeat('a', 32), 1::smallint)$$, 'numéro de 32 caractères accepté');
-- Même numéro chez l'autre prestataire.
SELECT pg_temp.as_op('97a002');
SELECT is(issue_claim_codes(pg_temp.id('97b009'), ARRAY[pg_temp.h(1, 90), pg_temp.h(1, 91)], 1::smallint), 2, 'prestataire B : codes émis');
SELECT lives_ok($$SELECT associate_claim_code(pg_temp.h(1, 90), pg_temp.m('8'), 'AB-12', 1::smallint)$$,
  'même numéro chez l''autre prestataire : accepté');
SELECT is((SELECT printed_number FROM media WHERE id = pg_temp.m('8')), 'AB-12', 'numéro de B posé');
SELECT pg_temp.as_op('97a001');
-- Deux colonnes seulement : numéro intact ; bracelet qui porte déjà un autre numéro.
UPDATE media SET printed_number = 'ZZ-1' WHERE id = pg_temp.m('b');
SELECT lives_ok($$SELECT associate_claim_code(pg_temp.h(1, 82), pg_temp.m('b'), NULL, 1::smallint)$$, 'association sans numéro');
SELECT is((SELECT printed_number FROM media WHERE id = pg_temp.m('b')), 'ZZ-1', 'numéro NULL : colonne intacte');
UPDATE media SET printed_number = 'Q-1' WHERE id = pg_temp.m('c');
SELECT throws_ok($$SELECT associate_claim_code(pg_temp.h(1, 83), pg_temp.m('c'), 'Q-2', 1::smallint)$$, 'CL065', NULL,
  'bracelet qui porte déjà un autre numéro : CL065');
SELECT lives_ok($$SELECT associate_claim_code(pg_temp.h(1, 83), pg_temp.m('c'), 'q-1', 1::smallint)$$, 'même numéro : sans effet, association faite');
-- Association d'un code de version 2 à un bracelet au code v1 jamais utilisé : l'ancienne ligne est libérée.
INSERT INTO claim_code (operator_id, batch_id, code_hash, key_version)
SELECT pg_temp.id('97a001'), pg_temp.id('97b004'), pg_temp.h(2, n), 2 FROM generate_series(84, 86) n;
SELECT lives_ok($$SELECT associate_claim_code(pg_temp.h(2, 84), pg_temp.m('9'), NULL, 2::smallint)$$,
  'bracelet au code v1 non utilisé : ré-association en v2');
SELECT is((SELECT claim_code_hash FROM media WHERE id = pg_temp.m('9')), pg_temp.h(2, 84), 'bracelet : empreinte v2');
SELECT is((SELECT claim_key_version FROM media WHERE id = pg_temp.m('9')), 2::smallint, 'bracelet : version 2');
SELECT is((SELECT printed_number FROM media WHERE id = pg_temp.m('9')), 'AB-12', 'numéro conservé');
SELECT is((SELECT (media_id IS NULL AND associated_at IS NULL AND invalidated_at IS NOT NULL)
             FROM claim_code WHERE code_hash = pg_temp.h(1, 80)), true, 'ancienne ligne libérée et invalidée');
UPDATE media SET claim_code_used_at = now() WHERE id = pg_temp.m('c');
SELECT throws_ok($$SELECT associate_claim_code(pg_temp.h(2, 85), pg_temp.m('c'), NULL, 2::smallint)$$, 'CL020',
  'MEDIA_ALREADY_HAS_CODE : ce bracelet porte déjà un code', 'code v1 déjà utilisé : MEDIA_ALREADY_HAS_CODE');
SELECT throws_ok($$SELECT associate_claim_code(pg_temp.h(2, 86), pg_temp.m('9'), NULL, 2::smallint)$$, 'CL020',
  'MEDIA_ALREADY_HAS_CODE : ce bracelet porte déjà un code', 'code de la version courante : MEDIA_ALREADY_HAS_CODE');

-- 6. reissuable_media : même prédicat que la réémission -----------------------------------------------------------------
-- Lot 97b001 pour la version 3 : 3, 4, 5, 6 (v2 < 3, jamais utilisés) ; pas 1 ni 2 (codes utilisés).
SELECT is((SELECT array_agg(media_id ORDER BY rank) FROM reissuable_media(pg_temp.id('97a001'), pg_temp.id('97b001'), 3::smallint)),
  ARRAY[pg_temp.m('3'), pg_temp.m('4'), pg_temp.m('5'), pg_temp.m('6')], 'reissuable_media : les quatre bracelets réémissibles, dans l''ordre');
SELECT is((SELECT array_agg(rank ORDER BY rank) FROM reissuable_media(pg_temp.id('97a001'), pg_temp.id('97b001'), 3::smallint)),
  ARRAY[1,2,3,4], 'reissuable_media : rangs consécutifs');
SELECT is((SELECT array_agg(encode(nfc_uid, 'hex') ORDER BY rank) FROM reissuable_media(pg_temp.id('97a001'), pg_temp.id('97b001'), 3::smallint)),
  ARRAY['04970000000003','04970000000004','04970000000005','04970000000006'], 'reissuable_media : UID de chaque bracelet, dans l''ordre');
SELECT is((SELECT count(*)::int FROM reissuable_media(pg_temp.id('97a001'), pg_temp.id('97b001'), 3::smallint) WHERE printed_number IS NULL),
  4, 'reissuable_media : numéro imprimé NULL rendu tel quel');
SELECT is((SELECT array_agg(a.attname::text ORDER BY a.attnum) FROM pg_proc p, unnest(p.proargnames, p.proargmodes) WITH ORDINALITY a(attname, mode, attnum)
            WHERE p.proname = 'reissuable_media' AND a.mode = 't'),
  ARRAY['media_id','rank','nfc_uid','printed_number'], 'reissuable_media : colonnes rendues');
SELECT is((SELECT count(*)::int FROM reissuable_media(pg_temp.id('97a001'), pg_temp.id('97b001'), 2::smallint)), 0,
  'reissuable_media : aucun bracelet déjà en version 2');
SELECT is((SELECT count(*)::int FROM reissuable_media(pg_temp.id('97a001'), pg_temp.id('97b003'), 3::smallint)), 1,
  'reissuable_media : lot clos lu aussi');
SELECT throws_ok($$SELECT * FROM reissuable_media(pg_temp.id('97a001'), pg_temp.id('97b002'), 3::smallint)$$, 'CL020', NULL, 'lot STAFF : CL020');
SELECT throws_ok($$SELECT * FROM reissuable_media(pg_temp.id('97a001'), pg_temp.id('97b777'), 3::smallint)$$, 'P0002', NULL, 'lot inconnu');
SELECT throws_ok($$SELECT * FROM reissuable_media(pg_temp.id('97a001'), pg_temp.id('97b009'), 3::smallint)$$, 'P0002', NULL,
  'lot d''un autre prestataire');
-- Jamais un bracelet que la réémission refuserait : réémission de l'ensemble listé, puis refus des autres.
SELECT is(pg_temp.reissue('97b001', (SELECT array_agg(right(media_id::text, 1) ORDER BY rank)
            FROM reissuable_media(pg_temp.id('97a001'), pg_temp.id('97b001'), 3::smallint)), 3), 4,
  'la réémission accepte exactement l''ensemble listé');
SELECT is(claim_key_version_max(), 3::smallint, 'claim_key_version_max : 3');
SELECT is((SELECT count(*)::int FROM reissuable_media(pg_temp.id('97a001'), pg_temp.id('97b001'), 3::smallint)), 0,
  'plus rien de réémissible en version 3');

-- 7. Forme ---------------------------------------------------------------------------------------------------------------
SELECT is((SELECT count(*)::int FROM unnest(ARRAY[
  'issue_claim_codes(uuid, bytea[], smallint)', 'associate_claim_code(bytea, uuid, text, smallint)',
  'claim_media(bytea, uuid, text, uuid, bytea, smallint)', 'confirm_media_claim(uuid, uuid, bytea, uuid, uuid, smallint)',
  'public_balance_lookup(bytea, text, smallint)', 'claim_key_version_max()',
  'reissuable_media(uuid, uuid, smallint)', 'reissue_claim_codes(uuid, uuid, uuid[], bytea[], smallint)']) s
  WHERE to_regprocedure(s) IS NOT NULL), 8, 'les cinq signatures versionnées et trois fonctions nouvelles existent');
SELECT is((SELECT count(*)::int FROM unnest(ARRAY[
  'issue_claim_codes(uuid, bytea[])', 'associate_claim_code(bytea, uuid)', 'claim_media(bytea, uuid, text, uuid, bytea)',
  'confirm_media_claim(uuid, uuid, bytea, uuid, uuid)', 'public_balance_lookup(bytea, text)']) s
  WHERE to_regprocedure(s) IS NOT NULL), 0, 'les cinq anciennes signatures sont retirées');
SELECT isnt(to_regprocedure('register_personalized_media(uuid, uuid, bytea, bytea, bytea, boolean, bytea, uuid, uuid)'), NULL,
  'register_personalized_media : inchangée');
SELECT is((SELECT count(*)::int FROM pg_proc WHERE proname IN ('issue_claim_codes','associate_claim_code','claim_media',
  'confirm_media_claim','public_balance_lookup','register_personalized_media')), 6, 'une seule signature par fonction');
SELECT is((SELECT string_agg(proname || ':' || prosecdef::text, ' ' ORDER BY proname) FROM pg_proc
            WHERE pronamespace = 'public'::regnamespace AND proname IN ('issue_claim_codes','associate_claim_code','claim_media',
              'confirm_media_claim','public_balance_lookup','claim_key_version_max','reissuable_media','reissue_claim_codes')),
  'associate_claim_code:true claim_key_version_max:true claim_media:false confirm_media_claim:false issue_claim_codes:true '
  'public_balance_lookup:true reissuable_media:true reissue_claim_codes:true', 'modes SECURITY DEFINER / INVOKER');
SELECT is((SELECT count(*)::int FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND prosecdef
             AND proname IN ('issue_claim_codes','associate_claim_code','public_balance_lookup','claim_key_version_max',
                             'reissuable_media','reissue_claim_codes','claim_media_reissuable')
             AND proconfig @> ARRAY['search_path=public, pg_temp']), 7, 'DEFINER : search_path = public, pg_temp');
SELECT is((SELECT count(*)::int FROM pg_proc WHERE pronamespace = 'public'::regnamespace
             AND proname IN ('issue_claim_codes','associate_claim_code','claim_media','confirm_media_claim','public_balance_lookup',
                             'claim_key_version_max','reissuable_media','reissue_claim_codes','claim_media_reissuable')
             AND has_function_privilege('public', oid, 'EXECUTE')), 0, 'PUBLIC sans EXECUTE sur les neuf fonctions');
SELECT is((SELECT count(*)::int FROM pg_proc WHERE pronamespace = 'public'::regnamespace
             AND proname IN ('reissuable_media','reissue_claim_codes','claim_media_reissuable')
             AND has_function_privilege('cashless_app', oid, 'EXECUTE')), 0, 'cashless_app : aucun droit sur les fonctions d''exploitation');

SELECT * FROM finish();
ROLLBACK;
