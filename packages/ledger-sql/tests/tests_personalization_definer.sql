-- Personnalisation : écritures de `media` et association des codes par fonctions SECURITY DEFINER seulement
-- (migration 0019) — pgTAP, écrit à la main. Lot 20, cycle 7 (relecture du cycle 6, constat 1 ; décision du porteur
-- du 15/10/2026, option B ; ADR-94, OP-N59).
-- Ce fichier prouve que :
--   1. les quatre variantes de la relecture (scratchpad wp20c6r/variants.sql) sont refusées depuis cashless_perso,
--      par un accès direct (42501) comme par register_personalized_media : lot actif, lot d'un autre prestataire,
--      clé de données d'un autre prestataire, lot plein ; le chemin légitime passe ;
--   2. la fonction ne dépend pas de la RLS (propriétaire superutilisateur en local) : chaque contrôle nomme le
--      prestataire de la session ; et une table temporaire de l'appelant ne masque pas une table de la base
--      (search_path = public, pg_temp) ;
--   3. l'association d'un code ne passe que par associate_claim_code (poste de personnalisation, et import du fichier
--      de l'imprimeur par l'API) ; ni l'un ni l'autre rôle n'écrit en direct l'empreinte du code d'un bracelet ni
--      l'association d'un code ;
--   4. la forme exacte : SECURITY DEFINER, search_path, EXECUTE retiré à PUBLIC ; register_personalized_media à
--      cashless_perso seul, associate_claim_code à cashless_perso et cashless_app seuls ; aucun droit d'écriture de
--      cashless_perso sur `media` ni sur l'association des codes.
-- Lancer : pg_prove -d <base> tests/tests_personalization_definer.sql (base créée par les migrations, roles.sql et
-- post-roles.sql rejoués).
\set ON_ERROR_STOP 1
\set QUIET 1
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

-- Prestataires A (a001) et B (a002), organisateurs, clés et clés de données de chacun (index 1).
-- Lots : 9001 de A en préparation (quantité 1), 9002 de A actif, 9003 de B en préparation, 9004 de A en préparation.
INSERT INTO party (id, kind, legal_name, country_code) VALUES
 ('00000000-0000-0000-0000-00000019a001','OPERATOR','Prestataire A','SN'),
 ('00000000-0000-0000-0000-00000019a002','OPERATOR','Prestataire B','CI');
INSERT INTO party (id, kind, operator_id, legal_name, country_code) VALUES
 ('00000000-0000-0000-0000-00000019a011','ORGANIZER','00000000-0000-0000-0000-00000019a001','Organisateur A','SN'),
 ('00000000-0000-0000-0000-00000019a012','ORGANIZER','00000000-0000-0000-0000-00000019a002','Organisateur B','CI');
INSERT INTO tag_key (operator_id, key_index, kms_key_ref, status) VALUES
 ('00000000-0000-0000-0000-00000019a001', 1, 'test:hmac-19a', 'ACTIVE'),
 ('00000000-0000-0000-0000-00000019a002', 1, 'test:hmac-19b', 'ACTIVE');
INSERT INTO tag_data_key (id, operator_id, key_index, version, wrapping_kms_key_ref, encrypted_dek) VALUES
 ('00000000-0000-0000-0000-00000019e001','00000000-0000-0000-0000-00000019a001', 1, 1, 'test:wrap', '\xdead'),
 ('00000000-0000-0000-0000-00000019e002','00000000-0000-0000-0000-00000019a002', 1, 1, 'test:wrap', '\xdead');
INSERT INTO media_batch (id, operator_id, organizer_id, kind, quantity, key_index) VALUES
 ('00000000-0000-0000-0000-000000199001','00000000-0000-0000-0000-00000019a001','00000000-0000-0000-0000-00000019a011','PUBLIC', 1, 1),
 ('00000000-0000-0000-0000-000000199002','00000000-0000-0000-0000-00000019a001','00000000-0000-0000-0000-00000019a011','PUBLIC', 5, 1),
 ('00000000-0000-0000-0000-000000199003','00000000-0000-0000-0000-00000019a002','00000000-0000-0000-0000-00000019a012','PUBLIC', 5, 1),
 ('00000000-0000-0000-0000-000000199004','00000000-0000-0000-0000-00000019a001','00000000-0000-0000-0000-00000019a011','PUBLIC', 5, 1);
UPDATE media_batch SET status = 'PERSONALIZED' WHERE id = '00000000-0000-0000-0000-000000199002';
UPDATE media_batch SET status = 'DELIVERED' WHERE id = '00000000-0000-0000-0000-000000199002';
UPDATE media_batch SET status = 'ACTIVE' WHERE id = '00000000-0000-0000-0000-000000199002';
-- Codes imprimés : c1, c2 du lot 9004 ; c3 du lot 9001 ; c4 du lot 9004, invalidé ; b1 du lot 9003, chez B.
INSERT INTO claim_code (operator_id, batch_id, code_hash, invalidated_at) VALUES
 ('00000000-0000-0000-0000-00000019a001','00000000-0000-0000-0000-000000199004', sha256('code 19 c1'), NULL),
 ('00000000-0000-0000-0000-00000019a001','00000000-0000-0000-0000-000000199004', sha256('code 19 c2'), NULL),
 ('00000000-0000-0000-0000-00000019a001','00000000-0000-0000-0000-000000199001', sha256('code 19 c3'), NULL),
 ('00000000-0000-0000-0000-00000019a001','00000000-0000-0000-0000-000000199004', sha256('code 19 c4'), now()),
 ('00000000-0000-0000-0000-00000019a002','00000000-0000-0000-0000-000000199003', sha256('code 19 b1'), NULL);

-- Enregistrement par la fonction : lot, numéro (identifiant, identité, UID), clé de données.
CREATE FUNCTION pg_temp.reg(batch text, n int, dek text DEFAULT '00000000-0000-0000-0000-00000019e001') RETURNS uuid
LANGUAGE sql AS $$
  SELECT register_personalized_media(batch::uuid, ('00000000-0000-0000-0000-00000019d0' || lpad(n::text, 2, '0'))::uuid,
           sha256(('identité 0019 ' || n)::bytea), decode('04190000000' || lpad(n::text, 3, '0'), 'hex'), sha256('signature'),
           true, decode(repeat('12', 34), 'hex'), dek::uuid, '00000000-0000-0000-0000-00000019f001')
$$;
-- Insertion directe, avec exactement les colonnes que fixe la fonction (forme des variantes de la relecture).
CREATE FUNCTION pg_temp.direct(batch text, n int, dek text DEFAULT '00000000-0000-0000-0000-00000019e001') RETURNS text
LANGUAGE sql AS $$
  SELECT format($i$INSERT INTO media (id, operator_id, kind, token_hash, nfc_uid, key_index, signature_ok,
      originality_sig_sha256, batch_id, status, personalized_at, pwd_pack_enc, pwd_pack_dek_id) VALUES
    (%L, '00000000-0000-0000-0000-00000019a001', 'NFC_TAG', sha256(%L::bytea), %L::bytea, 1, true, sha256('s'), %L,
     'PERSONALIZED', now(), decode(repeat('12', 34), 'hex'), %L)$i$,
    '00000000-0000-0000-0000-00000019d0' || lpad(n::text, 2, '0'), 'identité 0019 ' || n,
    '\x04190000000' || lpad(n::text, 3, '0'), batch, dek)
$$;

-- 0. Tables temporaires de l'appelant, depuis cashless_perso ------------------------------------------------------------
-- Avant tout appel de la fonction dans cette session : un plan déjà en cache ignorerait la table temporaire, et le
-- test ne prouverait rien. L'une imite le lot actif « en préparation », l'autre donne à A la clé de données de B :
-- sans effet, pg_temp est cherché en dernier.
SET LOCAL ROLE cashless_perso;
SELECT set_config('app.operator_id', '00000000-0000-0000-0000-00000019a001', true);
CREATE TEMP TABLE media_batch (id uuid, operator_id uuid, status text, quantity int, key_index int);
INSERT INTO pg_temp.media_batch VALUES ('00000000-0000-0000-0000-000000199002','00000000-0000-0000-0000-00000019a001','ORDERED', 99, 1);
CREATE TEMP TABLE tag_data_key (id uuid, operator_id uuid, key_index int, status text);
INSERT INTO pg_temp.tag_data_key VALUES ('00000000-0000-0000-0000-00000019e002','00000000-0000-0000-0000-00000019a001', 1, 'ACTIVE');
SELECT throws_like($$SELECT pg_temp.reg('00000000-0000-0000-0000-000000199002', 67)$$, '%BATCH_NOT_IN_PREPARATION%',
  'table temporaire media_batch de l''appelant : ignorée');
SELECT throws_like($$SELECT pg_temp.reg('00000000-0000-0000-0000-000000199004', 68, '00000000-0000-0000-0000-00000019e002')$$,
  '%TAG_DATA_KEY_NOT_ACTIVE%', 'table temporaire tag_data_key de l''appelant : ignorée');
DROP TABLE pg_temp.media_batch, pg_temp.tag_data_key;

-- 1. Accès direct depuis cashless_perso : refusé (42501) -------------------------------------------------------------------
SELECT throws_ok(pg_temp.direct('00000000-0000-0000-0000-000000199002', 51), '42501', NULL,
  'V1 direct : bracelet dans un lot ACTIVE refusé');
SELECT throws_ok(pg_temp.direct('00000000-0000-0000-0000-000000199003', 52), '42501', NULL,
  'V2 direct : bracelet dans le lot d''un autre prestataire refusé');
SELECT throws_ok(pg_temp.direct('00000000-0000-0000-0000-000000199004', 53, '00000000-0000-0000-0000-00000019e002'), '42501', NULL,
  'V3 direct : clé de données d''un autre prestataire refusée');

-- 2. Par la fonction : mêmes variantes refusées, chemin légitime accepté ---------------------------------------------------
SELECT is(pg_temp.reg('00000000-0000-0000-0000-000000199001', 1), '00000000-0000-0000-0000-00000019d001'::uuid,
  'chemin légitime : bracelet enregistré dans un lot en préparation');
SELECT throws_ok(pg_temp.direct('00000000-0000-0000-0000-000000199001', 54), '42501', NULL,
  'V4 direct : bracelet de plus dans un lot plein refusé');
SELECT throws_like($$SELECT pg_temp.reg('00000000-0000-0000-0000-000000199002', 61)$$, '%BATCH_NOT_IN_PREPARATION%',
  'V1 fonction : lot ACTIVE refusé');
SELECT throws_ok($$SELECT pg_temp.reg('00000000-0000-0000-0000-000000199003', 62)$$, 'P0002', NULL,
  'V2 fonction : lot d''un autre prestataire introuvable');
SELECT throws_like($$SELECT pg_temp.reg('00000000-0000-0000-0000-000000199004', 63, '00000000-0000-0000-0000-00000019e002')$$,
  '%TAG_DATA_KEY_NOT_ACTIVE%', 'V3 fonction : clé de données d''un autre prestataire refusée');
SELECT throws_like($$SELECT pg_temp.reg('00000000-0000-0000-0000-000000199001', 64)$$, '%BATCH_QUANTITY_REACHED%',
  'V4 fonction : lot plein refusé');
-- Sans prestataire de session : rien n'est lu.
SELECT set_config('app.operator_id', '', true);
SELECT throws_ok($$SELECT pg_temp.reg('00000000-0000-0000-0000-000000199004', 65)$$, 'P0002', NULL,
  'sans prestataire de session : introuvable');
-- Session posée sur B, lot de A : introuvable, même si la RLS ne s'applique pas dans la fonction.
SELECT set_config('app.operator_id', '00000000-0000-0000-0000-00000019a002', true);
SELECT throws_ok($$SELECT pg_temp.reg('00000000-0000-0000-0000-000000199004', 66, '00000000-0000-0000-0000-00000019e002')$$, 'P0002', NULL,
  'session de B, lot de A : introuvable');
SELECT set_config('app.operator_id', '00000000-0000-0000-0000-00000019a001', true);


-- 3. Association d'un code ---------------------------------------------------------------------------------------------------
SELECT lives_ok($$SELECT pg_temp.reg('00000000-0000-0000-0000-000000199004', 2)$$, 'bracelet 2 enregistré dans le lot 9004');
SELECT lives_ok($$SELECT pg_temp.reg('00000000-0000-0000-0000-000000199004', 3)$$, 'bracelet 3 enregistré dans le lot 9004');
SELECT throws_ok($$UPDATE media SET claim_code_hash = sha256('code 19 c1') WHERE id = '00000000-0000-0000-0000-00000019d002'$$,
  '42501', NULL, 'personnalisation : n''écrit pas directement l''empreinte du code d''un bracelet');
SELECT throws_ok($$UPDATE claim_code SET media_id = '00000000-0000-0000-0000-00000019d002', associated_at = now()
                    WHERE code_hash = sha256('code 19 c4')$$,
  '42501', NULL, 'personnalisation : n''associe pas directement un code (ici, un code invalidé)');
SELECT lives_ok($$SELECT associate_claim_code(sha256('code 19 c1'), '00000000-0000-0000-0000-00000019d002')$$,
  'chemin légitime : code associé par la fonction');
SELECT throws_like($$SELECT associate_claim_code(sha256('code 19 c1'), '00000000-0000-0000-0000-00000019d003')$$,
  '%CLAIM_CODE_ALREADY_ASSOCIATED%', 'code déjà associé : refusé');
SELECT throws_like($$SELECT associate_claim_code(sha256('code 19 c4'), '00000000-0000-0000-0000-00000019d003')$$,
  '%CLAIM_CODE_INVALIDATED%', 'code invalidé : refusé');
SELECT throws_like($$SELECT associate_claim_code(sha256('code 19 c3'), '00000000-0000-0000-0000-00000019d003')$$,
  '%CLAIM_CODE_OTHER_BATCH%', 'code d''un autre lot : refusé');
-- Code d'un autre prestataire (relecture du cycle 7, remarque 3) : la fonction ne le voit pas, comme un code inconnu.
-- Sans le filtre de prestataire sur claim_code, le refus deviendrait CLAIM_CODE_OTHER_BATCH et trahirait son existence.
SELECT throws_ok($$SELECT associate_claim_code(sha256('code 19 b1'), '00000000-0000-0000-0000-00000019d003')$$, 'CL020',
  'CLAIM_CODE_UNKNOWN : code inconnu', 'code d''un autre prestataire : CLAIM_CODE_UNKNOWN, comme un code inconnu');
SELECT set_config('app.operator_id', '00000000-0000-0000-0000-00000019a002', true);
SELECT throws_ok($$SELECT associate_claim_code(sha256('code 19 c2'), '00000000-0000-0000-0000-00000019d003')$$, 'P0002', NULL,
  'session de B, bracelet de A : introuvable');
RESET ROLE;

-- 4. L'API (cashless_app) : aucun enregistrement ; association par la fonction seulement ---------------------------------
SET LOCAL ROLE cashless_app;
SELECT set_config('app.operator_id', '00000000-0000-0000-0000-00000019a001', true);
SELECT throws_ok($$SELECT pg_temp.reg('00000000-0000-0000-0000-000000199004', 70)$$, '42501', NULL,
  'API : register_personalized_media refusée');
SELECT throws_ok($$UPDATE media SET claim_code_hash = sha256('code 19 c2') WHERE id = '00000000-0000-0000-0000-00000019d003'$$,
  '42501', NULL, 'API : n''écrit pas l''empreinte du code d''un bracelet');
SELECT throws_ok($$UPDATE claim_code SET media_id = '00000000-0000-0000-0000-00000019d003', associated_at = now()
                    WHERE code_hash = sha256('code 19 c4')$$,
  '42501', NULL, 'API : n''associe pas directement un code (ici, un code invalidé)');
SELECT throws_like($$SELECT associate_claim_code(sha256('code 19 c1'), '00000000-0000-0000-0000-00000019d003')$$,
  '%CLAIM_CODE_ALREADY_ASSOCIATED%', 'API, par la fonction : code déjà associé refusé');
SELECT lives_ok($$SELECT associate_claim_code(sha256('code 19 c2'), '00000000-0000-0000-0000-00000019d003')$$,
  'API, par la fonction : association légitime (import du fichier de l''imprimeur)');
RESET ROLE;

-- État : seuls les bracelets du chemin légitime existent ; un seul code associé.
SELECT is((SELECT string_agg(right(id::text, 2) || ':' || right(batch_id::text, 1), ' ' ORDER BY id) FROM media
            WHERE id::text LIKE '00000000-0000-0000-0000-00000019d0%'),
  '01:1 02:4 03:4', 'seuls les trois bracelets du chemin légitime existent');
SELECT is((SELECT string_agg(encode(code_hash, 'hex') || '>' || right(media_id::text, 2), ' '
                             ORDER BY encode(code_hash, 'hex') || '>' || right(media_id::text, 2)) FROM claim_code
            WHERE media_id IS NOT NULL AND operator_id = '00000000-0000-0000-0000-00000019a001'),
  (SELECT string_agg(h, ' ' ORDER BY h) FROM unnest(ARRAY[encode(sha256('code 19 c1'), 'hex') || '>02',
                                                       encode(sha256('code 19 c2'), 'hex') || '>03']) h),
  'deux codes associés, par la fonction seulement : c1 au bracelet 2, c2 au bracelet 3');
SELECT is((SELECT count(*)::int FROM media WHERE claim_code_hash IS NOT NULL AND id::text LIKE '00000000-0000-0000-0000-00000019d0%'), 2,
  'deux bracelets portent une empreinte de code');

-- 5. Forme exacte ----------------------------------------------------------------------------------------------------------
SELECT is((SELECT string_agg(proname || ':' || prosecdef::text || ':' || array_to_string(proconfig, ','), ' ' ORDER BY proname)
             FROM pg_proc WHERE pronamespace = 'public'::regnamespace
              AND proname IN ('register_personalized_media','associate_claim_code','log_media_status','log_batch_status')),
  'associate_claim_code:true:search_path=public, pg_temp log_batch_status:true:search_path=public, pg_temp '
  'log_media_status:true:search_path=public, pg_temp register_personalized_media:true:search_path=public, pg_temp',
  'SECURITY DEFINER, search_path = public, pg_temp');
SELECT is((SELECT string_agg(r || ':' || f, ' ' ORDER BY r, f)
             FROM (SELECT rolname::text AS r FROM pg_roles WHERE rolname LIKE 'cashless\_%' UNION ALL SELECT 'public') roles,
                  unnest(ARRAY['register_personalized_media(uuid, uuid, bytea, bytea, bytea, boolean, bytea, uuid, uuid)',
                               'associate_claim_code(bytea, uuid)']) f
            WHERE has_function_privilege(r, f, 'EXECUTE')),
  'cashless_app:associate_claim_code(bytea, uuid) cashless_perso:associate_claim_code(bytea, uuid) '
  'cashless_perso:register_personalized_media(uuid, uuid, bytea, bytea, bytea, boolean, bytea, uuid, uuid)',
  'EXECUTE : enregistrement à cashless_perso seul ; association à cashless_perso et cashless_app ; rien à PUBLIC');
SELECT is((SELECT string_agg(t || ':' || p, ' ' ORDER BY t, p)
             FROM unnest(ARRAY['media','claim_code','media_assignment','media_status_history']) t,
                  unnest(ARRAY['INSERT','UPDATE','DELETE']) p
            WHERE CASE WHEN p = 'DELETE' THEN has_table_privilege('cashless_perso', t, p)
                       ELSE has_any_column_privilege('cashless_perso', t, p) END),
  NULL, 'cashless_perso : aucun droit d''écriture sur media, claim_code, media_assignment, media_status_history');
SELECT is((SELECT count(*)::int FROM pg_policies WHERE tablename = 'media' AND policyname = 'perso_media_insert'), 0,
  'politique perso_media_insert retirée (plus aucun INSERT de cashless_perso)');
SELECT is((SELECT string_agg(a.attname, ',' ORDER BY a.attname) FROM pg_attribute a
            WHERE a.attrelid = 'claim_code'::regclass AND a.attnum > 0 AND NOT a.attisdropped
              AND has_column_privilege('cashless_app', 'claim_code', a.attname, 'UPDATE')),
  'invalidated_at', 'API : seule l''invalidation d''un code est modifiable');

SELECT * FROM finish();
ROLLBACK;
