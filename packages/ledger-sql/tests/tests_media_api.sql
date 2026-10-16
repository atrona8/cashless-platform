-- Fonctions d'appui de l'API des bracelets (migration 0013) — pgTAP, écrit à la main.
-- Lancer : pg_prove -d <base> tests/tests_media_api.sql (base créée par les migrations, roles.sql rejoué).
\set ON_ERROR_STOP 1
\set QUIET 1
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

INSERT INTO party (id, kind, legal_name, country_code) VALUES
 ('00000000-0000-0000-0000-00000013a001','OPERATOR','Prestataire A','SN'),
 ('00000000-0000-0000-0000-00000013a002','OPERATOR','Prestataire B','CI');
INSERT INTO party (id, kind, operator_id, legal_name) VALUES
 ('00000000-0000-0000-0000-00000013a011','ORGANIZER','00000000-0000-0000-0000-00000013a001','Organisateur A'),
 ('00000000-0000-0000-0000-00000013a012','ORGANIZER','00000000-0000-0000-0000-00000013a002','Organisateur B');
INSERT INTO tag_key (operator_id, key_index, kms_key_ref, status) VALUES
 ('00000000-0000-0000-0000-00000013a001', 1, 'test:hmac-a1', 'ACTIVE'),
 ('00000000-0000-0000-0000-00000013a001', 2, 'test:hmac-a2', 'DECRYPT_ONLY'),
 ('00000000-0000-0000-0000-00000013a002', 1, 'test:hmac-b1', 'ACTIVE');
INSERT INTO tag_data_key (id, operator_id, key_index, version, wrapping_kms_key_ref, encrypted_dek, status) VALUES
 ('00000000-0000-0000-0000-00000013e001','00000000-0000-0000-0000-00000013a001', 1, 1, 'test:wrap', '\xdeadbeef', 'DECRYPT_ONLY'),
 ('00000000-0000-0000-0000-00000013e002','00000000-0000-0000-0000-00000013a001', 1, 2, 'test:wrap', '\xdeadbeef', 'ACTIVE'),
 ('00000000-0000-0000-0000-00000013e003','00000000-0000-0000-0000-00000013a001', 2, 1, 'test:wrap', '\xdeadbeef', 'ACTIVE'),
 ('00000000-0000-0000-0000-00000013e009','00000000-0000-0000-0000-00000013a002', 1, 1, 'test:wrap', '\xdeadbeef', 'ACTIVE');
INSERT INTO media_batch (id, operator_id, organizer_id, kind, quantity, key_index) VALUES
 ('00000000-0000-0000-0000-00000013b001','00000000-0000-0000-0000-00000013a001','00000000-0000-0000-0000-00000013a011','PUBLIC', 2, 1),
 ('00000000-0000-0000-0000-00000013b003','00000000-0000-0000-0000-00000013a001','00000000-0000-0000-0000-00000013a011','STAFF', 5, 1),
 ('00000000-0000-0000-0000-00000013b009','00000000-0000-0000-0000-00000013a002','00000000-0000-0000-0000-00000013a012','PUBLIC', 5, 1);
-- Lot dont la clé n'est plus active : créé tant que la clé l'était encore (la base refuse un nouveau lot sinon).
UPDATE tag_key SET status = 'ACTIVE' WHERE operator_id = '00000000-0000-0000-0000-00000013a001' AND key_index = 2;
INSERT INTO media_batch (id, operator_id, organizer_id, kind, quantity, key_index) VALUES
 ('00000000-0000-0000-0000-00000013b002','00000000-0000-0000-0000-00000013a001','00000000-0000-0000-0000-00000013a011','PUBLIC', 5, 2);
UPDATE tag_key SET status = 'DECRYPT_ONLY' WHERE operator_id = '00000000-0000-0000-0000-00000013a001' AND key_index = 2;

CREATE FUNCTION pg_temp.enc() RETURNS bytea LANGUAGE sql IMMUTABLE AS $$ SELECT decode(repeat('ab', 34), 'hex') $$;
CREATE FUNCTION pg_temp.reg(batch text, n int, sig_ok boolean DEFAULT true, dek text DEFAULT '00000000-0000-0000-0000-00000013e002') RETURNS uuid
LANGUAGE sql AS $$
  SELECT register_personalized_media(batch::uuid, ('00000000-0000-0000-0000-00000013d0' || lpad(n::text, 2, '0'))::uuid,
           sha256(('identité 0013 ' || n)::bytea), decode('04130000000' || lpad(n::text, 3, '0'), 'hex'), sha256(('signature ' || n)::bytea),
           sig_ok, pg_temp.enc(), dek::uuid, '00000000-0000-0000-0000-00000013c001')
$$;

-- 1. Structure ---------------------------------------------------------------------------------------------------------
SELECT is((SELECT count(*)::int FROM pg_proc WHERE proname IN ('set_media_batch_status','media_set_status',
  'blacklist_media','suspend_media','media_summary','media_status_log','media_set_actor','media_session_operator') AND NOT prosecdef), 8,
  'les huit autres fonctions sont SECURITY INVOKER');
SELECT is((SELECT prosecdef FROM pg_proc WHERE proname = 'register_personalized_media'), true,
  'register_personalized_media : SECURITY DEFINER depuis 0019 (personnalisation seule, tests_personalization_definer.sql)');
SELECT is((SELECT count(*)::int FROM unnest((SELECT proargnames FROM pg_proc WHERE proname = 'media_summary')) n
            WHERE n IN ('token_hash','pwd_pack_enc','pwd_pack_dek_id','claim_code_hash','nfc_uid')), 0,
  'media_summary ne rend ni identité, ni UID, ni chiffré, ni empreinte de code');

-- 2. Enregistrement d'un bracelet personnalisé : fait par le processus de personnalisation (post-roles.sql) ----------------
SET LOCAL ROLE cashless_perso;
SELECT set_config('app.operator_id', '00000000-0000-0000-0000-00000013a001', true);
SELECT is(pg_temp.reg('00000000-0000-0000-0000-00000013b001', 1), '00000000-0000-0000-0000-00000013d001'::uuid, 'bracelet enregistré');
RESET ROLE;
SELECT is((SELECT status || ' ' || key_index || ' ' || signature_ok::text || ' ' || (personalized_at IS NOT NULL)::text || ' ' || kind
             FROM media WHERE id = '00000000-0000-0000-0000-00000013d001'), 'PERSONALIZED 1 true true NFC_TAG', 'statut, index du lot, signature, date');
SELECT is((SELECT originality_sig_sha256 FROM media WHERE id = '00000000-0000-0000-0000-00000013d001'), sha256('signature 1'), 'empreinte de la signature gardée');
SELECT is((SELECT to_status || ' ' || reason || ' ' || actor_id::text FROM media_status_history WHERE media_id = '00000000-0000-0000-0000-00000013d001'),
  'PERSONALIZED PERSONALIZATION 00000000-0000-0000-0000-00000013c001', 'historique : auteur et motif');
SET LOCAL ROLE cashless_perso;
SELECT throws_like($$SELECT pg_temp.reg('00000000-0000-0000-0000-00000013b001', 2, false)$$, '%MEDIA_SIGNATURE_INVALID%', 'signature invalide : puce refusée');
SELECT throws_like($$SELECT pg_temp.reg('00000000-0000-0000-0000-00000013b001', 2, true, '00000000-0000-0000-0000-00000013e001')$$,
  '%TAG_DATA_KEY_NOT_ACTIVE%', 'clé de données en déchiffrement seul refusée');
SELECT throws_like($$SELECT pg_temp.reg('00000000-0000-0000-0000-00000013b001', 2, true, '00000000-0000-0000-0000-00000013e003')$$,
  '%TAG_DATA_KEY_NOT_ACTIVE%', 'clé de données d''un autre index refusée');
SELECT throws_like($$SELECT pg_temp.reg('00000000-0000-0000-0000-00000013b001', 2, true, '00000000-0000-0000-0000-00000013e009')$$,
  '%TAG_DATA_KEY_NOT_ACTIVE%', 'clé de données d''un autre prestataire refusée');
SELECT throws_like($$SELECT pg_temp.reg('00000000-0000-0000-0000-00000013b002', 2, true, '00000000-0000-0000-0000-00000013e003')$$,
  '%TAG_KEY_NOT_ACTIVE%', 'lot dont la clé n''est plus active');
SELECT throws_ok($$SELECT register_personalized_media('00000000-0000-0000-0000-00000013b001', gen_random_uuid(), sha256('x'), '\x0413', sha256('s'), true, pg_temp.enc(),
  '00000000-0000-0000-0000-00000013e002', '00000000-0000-0000-0000-00000013c001')$$, 'CL001', NULL, 'UID de mauvaise longueur');
SELECT throws_ok($$SELECT register_personalized_media('00000000-0000-0000-0000-00000013b001', gen_random_uuid(), sha256('x'), '\x04130000000099', sha256('s'), true,
  decode(repeat('ab', 33), 'hex'), '00000000-0000-0000-0000-00000013e002', '00000000-0000-0000-0000-00000013c001')$$, '23514', NULL, 'chiffré de 33 octets refusé par la base');
SELECT throws_ok($$SELECT register_personalized_media('00000000-0000-0000-0000-00000013b001', gen_random_uuid(), sha256('autre identité'), '\x04130000000001', sha256('s'), true,
  pg_temp.enc(), '00000000-0000-0000-0000-00000013e002', '00000000-0000-0000-0000-00000013c001')$$, '23505', NULL, 'UID déjà connu : conflit');
SELECT throws_ok($$SELECT register_personalized_media('00000000-0000-0000-0000-00000013b001', gen_random_uuid(), sha256('identité 0013 1'), '\x04130000000077', sha256('s'), true,
  pg_temp.enc(), '00000000-0000-0000-0000-00000013e002', '00000000-0000-0000-0000-00000013c001')$$, '23505', NULL, 'identité déjà connue : conflit');
SELECT throws_ok($$SELECT register_personalized_media('00000000-0000-0000-0000-00000013b001', gen_random_uuid(), sha256('y'), '\x04130000000078', sha256('s'), true,
  pg_temp.enc(), '00000000-0000-0000-0000-00000013e002', NULL)$$, 'CL001', NULL, 'auteur obligatoire');
SELECT lives_ok($$SELECT pg_temp.reg('00000000-0000-0000-0000-00000013b001', 2)$$, 'second bracelet du lot');
SELECT throws_like($$SELECT pg_temp.reg('00000000-0000-0000-0000-00000013b001', 3)$$, '%BATCH_QUANTITY_REACHED%', 'quantité du lot atteinte');
SELECT throws_ok($$SELECT pg_temp.reg('00000000-0000-0000-0000-00000013b009', 4)$$, 'P0002', NULL, 'lot d''un autre prestataire : introuvable');

-- 3. Statut d'un lot : API publique ---------------------------------------------------------------------------------------
SET LOCAL ROLE cashless_app;
SELECT throws_ok($$SELECT pg_temp.reg('00000000-0000-0000-0000-00000013b003', 6)$$, '42501', NULL, 'l''API publique n''enregistre aucun bracelet');
SELECT is(set_media_batch_status('00000000-0000-0000-0000-00000013b001', 'PERSONALIZED', NULL, '00000000-0000-0000-0000-00000013c002'), 'PERSONALIZED', 'commandé → personnalisé');
SELECT is((SELECT from_status || '>' || to_status || ' ' || actor_id::text FROM media_batch_status_history
            WHERE batch_id = '00000000-0000-0000-0000-00000013b001' AND to_status = 'PERSONALIZED'),
  'ORDERED>PERSONALIZED 00000000-0000-0000-0000-00000013c002', 'passage tracé avec son auteur');
SELECT is((SELECT count(*)::int FROM media_batch_status_history WHERE batch_id = '00000000-0000-0000-0000-00000013b001' AND to_status = 'PERSONALIZED'), 1,
  'une seule trace par passage');
SELECT throws_ok($$SELECT set_media_batch_status('00000000-0000-0000-0000-00000013b001', 'ACTIVE', NULL, '00000000-0000-0000-0000-00000013c002')$$,
  'CL020', NULL, 'personnalisé → actif : passage non prévu');
SELECT is(set_media_batch_status('00000000-0000-0000-0000-00000013b001', 'DELIVERED', NULL, '00000000-0000-0000-0000-00000013c002'), 'DELIVERED', 'personnalisé → livré');
SET LOCAL ROLE cashless_perso;
SELECT throws_like($$SELECT pg_temp.reg('00000000-0000-0000-0000-00000013b001', 5)$$, '%BATCH_%', 'plus d''enregistrement dans un lot livré');
SET LOCAL ROLE cashless_app;
SELECT is(set_media_batch_status('00000000-0000-0000-0000-00000013b001', 'ACTIVE', NULL, '00000000-0000-0000-0000-00000013c002'), 'ACTIVE', 'livré → actif');
SELECT is(set_media_batch_status('00000000-0000-0000-0000-00000013b001', 'ACTIVE', NULL, '00000000-0000-0000-0000-00000013c002'), 'ACTIVE', 'même statut : sans effet');
SELECT throws_ok($$SELECT set_media_batch_status('00000000-0000-0000-0000-00000013b001', 'SUSPENDED', '  ', '00000000-0000-0000-0000-00000013c002')$$,
  'CL001', NULL, 'suspension sans motif refusée');
SELECT is(set_media_batch_status('00000000-0000-0000-0000-00000013b001', 'SUSPENDED', 'stock volé', '00000000-0000-0000-0000-00000013c002'), 'SUSPENDED', 'actif → suspendu, avec motif');
SELECT is((SELECT reason FROM media_batch_status_history WHERE batch_id = '00000000-0000-0000-0000-00000013b001' AND to_status = 'SUSPENDED'), 'stock volé', 'motif tracé');
SELECT is(set_media_batch_status('00000000-0000-0000-0000-00000013b001', 'ACTIVE', 'levée', '00000000-0000-0000-0000-00000013c002'), 'ACTIVE', 'suspendu → actif');
SELECT throws_like($$SELECT set_media_batch_status('00000000-0000-0000-0000-00000013b001', 'CLOSED', 'fin', '00000000-0000-0000-0000-00000013c002')$$,
  '%BATCH_CLOSE_VIA_CLOSURE%', 'la clôture ne passe pas par cette fonction');
SELECT throws_ok($$SELECT set_media_batch_status('00000000-0000-0000-0000-00000013b001', 'SUSPENDED', 'x', NULL)$$, 'CL001', NULL, 'auteur obligatoire');
SELECT throws_ok($$SELECT set_media_batch_status('00000000-0000-0000-0000-00000013b009', 'PERSONALIZED', NULL, '00000000-0000-0000-0000-00000013c002')$$,
  'P0002', NULL, 'lot d''un autre prestataire : introuvable');

-- 4. Blocage manuel, perte, lectures --------------------------------------------------------------------------------------------
SELECT throws_ok($$SELECT blacklist_media('00000000-0000-0000-0000-00000013d001', '', '00000000-0000-0000-0000-00000013c003')$$, 'CL001', NULL, 'liste noire sans motif refusée');
SELECT is(blacklist_media('00000000-0000-0000-0000-00000013d001', 'bracelet copié signalé', '00000000-0000-0000-0000-00000013c003'), 'BLACKLISTED', 'mise en liste noire');
SELECT is((SELECT (SELECT array_agg(to_status ORDER BY at, to_status) FROM media_status_log('00000000-0000-0000-0000-00000013d001'))),
  ARRAY['PERSONALIZED','BLACKLISTED'], 'historique lu par media_status_log');
SELECT is((SELECT reason || ' ' || actor_id::text FROM media_status_log('00000000-0000-0000-0000-00000013d001') WHERE to_status = 'BLACKLISTED'),
  'bracelet copié signalé 00000000-0000-0000-0000-00000013c003', 'motif et auteur du blocage');
SELECT throws_ok($$SELECT suspend_media('00000000-0000-0000-0000-00000013d001', 'perdu', '00000000-0000-0000-0000-00000013c003')$$, 'CL020', NULL,
  'liste noire → suspendu : passage non prévu');
SELECT throws_ok($$SELECT suspend_media('00000000-0000-0000-0000-00000013d002', 'perdu', '00000000-0000-0000-0000-00000013c003')$$, 'CL020', NULL,
  'un bracelet en stock ne se suspend pas');
SELECT is((SELECT status || ' ' || batch_kind || ' ' || batch_status || ' ' || deposit_status || ' ' || has_claim_code::text || ' ' || wallets::text
             FROM media_summary('00000000-0000-0000-0000-00000013d002')), 'PERSONALIZED PUBLIC ACTIVE NONE false []', 'résumé d''un bracelet en stock');
SELECT is((SELECT count(*)::int FROM media_summary(gen_random_uuid())), 0, 'bracelet inconnu : aucune ligne');

-- 5. Isolation -------------------------------------------------------------------------------------------------------------------
SELECT set_config('app.operator_id', '00000000-0000-0000-0000-00000013a002', true);
SELECT is((SELECT count(*)::int FROM media_summary('00000000-0000-0000-0000-00000013d002')), 0, 'B ne lit pas le résumé d''un bracelet de A');
SELECT is((SELECT count(*)::int FROM media_status_log('00000000-0000-0000-0000-00000013d001')), 0, 'B ne lit pas l''historique d''un bracelet de A');
SELECT throws_ok($$SELECT blacklist_media('00000000-0000-0000-0000-00000013d002', 'x', '00000000-0000-0000-0000-00000013c003')$$, 'P0002', NULL,
  'B ne bloque pas un bracelet de A');
SELECT set_config('app.operator_id', '', true);
SELECT throws_ok($$SELECT * FROM media_summary('00000000-0000-0000-0000-00000013d002')$$, NULL, NULL, 'sans prestataire de session : refusé');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
