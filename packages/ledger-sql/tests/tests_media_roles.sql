-- Rôles de base des processus des clés de bracelet et retraits à l'API publique (post-roles.sql, mission
-- bracelets-nfc) — pgTAP, écrit à la main. Deux barrières protègent les mots de passe des bracelets : ce fichier
-- prouve celle de la base (qui lit et écrit quoi), indépendamment du service de clés.
-- Lancer : pg_prove -d <base> tests/tests_media_roles.sql (base créée par les migrations, roles.sql et post-roles.sql rejoués).
\set ON_ERROR_STOP 1
\set QUIET 1
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

INSERT INTO party (id, kind, legal_name, country_code) VALUES
 ('00000000-0000-0000-0000-00000014a001','OPERATOR','Prestataire A','SN'),
 ('00000000-0000-0000-0000-00000014a002','OPERATOR','Prestataire B','CI');
INSERT INTO party (id, kind, operator_id, legal_name) VALUES
 ('00000000-0000-0000-0000-00000014a011','ORGANIZER','00000000-0000-0000-0000-00000014a001','Organisateur A'),
 ('00000000-0000-0000-0000-00000014a012','ORGANIZER','00000000-0000-0000-0000-00000014a002','Organisateur B');
INSERT INTO tag_key (operator_id, key_index, kms_key_ref) VALUES
 ('00000000-0000-0000-0000-00000014a001', 1, 'test:hmac-a'), ('00000000-0000-0000-0000-00000014a002', 1, 'test:hmac-b');
INSERT INTO tag_data_key (id, operator_id, key_index, version, wrapping_kms_key_ref, encrypted_dek) VALUES
 ('00000000-0000-0000-0000-00000014e001','00000000-0000-0000-0000-00000014a001', 1, 1, 'test:wrap', '\xdeadbeef'),
 ('00000000-0000-0000-0000-00000014e002','00000000-0000-0000-0000-00000014a002', 1, 1, 'test:wrap', '\xdeadbeef');
INSERT INTO media_batch (id, operator_id, organizer_id, kind, quantity, key_index) VALUES
 ('00000000-0000-0000-0000-00000014b001','00000000-0000-0000-0000-00000014a001','00000000-0000-0000-0000-00000014a011','PUBLIC', 5, 1),
 ('00000000-0000-0000-0000-00000014b002','00000000-0000-0000-0000-00000014a002','00000000-0000-0000-0000-00000014a012','PUBLIC', 5, 1);
INSERT INTO media (id, operator_id, kind, token_hash, nfc_uid, batch_id, key_index, status, personalized_at, pwd_pack_enc, pwd_pack_dek_id) VALUES
 ('00000000-0000-0000-0000-00000014d001','00000000-0000-0000-0000-00000014a001','NFC_TAG', sha256('identité 0014 A'), '\x04140000000001',
  '00000000-0000-0000-0000-00000014b001', 1, 'PERSONALIZED', now(), decode(repeat('ab', 34), 'hex'), '00000000-0000-0000-0000-00000014e001'),
 ('00000000-0000-0000-0000-00000014d002','00000000-0000-0000-0000-00000014a002','NFC_TAG', sha256('identité 0014 B'), '\x04140000000002',
  '00000000-0000-0000-0000-00000014b002', 1, 'PERSONALIZED', now(), decode(repeat('cd', 34), 'hex'), '00000000-0000-0000-0000-00000014e002');
INSERT INTO tag_key_job (id, operator_id, key_index, kind) VALUES
 ('00000000-0000-0000-0000-00000014c001','00000000-0000-0000-0000-00000014a001', 2, 'CREATE_KEY'),
 ('00000000-0000-0000-0000-00000014c002','00000000-0000-0000-0000-00000014a001', 1, 'ROTATE_DEK'),
 ('00000000-0000-0000-0000-00000014c003','00000000-0000-0000-0000-00000014a002', 1, 'REENCRYPT'),
 ('00000000-0000-0000-0000-00000014c004','00000000-0000-0000-0000-00000014a002', 1, 'RETIRE_KEY'),
 ('00000000-0000-0000-0000-00000014c005','00000000-0000-0000-0000-00000014a002', 1, 'DISABLE_KMS_KEY');

CREATE FUNCTION pg_temp.a() RETURNS void LANGUAGE sql AS $$ SELECT set_config('app.operator_id', '00000000-0000-0000-0000-00000014a001', true) $$;
CREATE FUNCTION pg_temp.b() RETURNS void LANGUAGE sql AS $$ SELECT set_config('app.operator_id', '00000000-0000-0000-0000-00000014a002', true) $$;
CREATE FUNCTION pg_temp.nil() RETURNS void LANGUAGE sql AS $$ SELECT set_config('app.operator_id', '00000000-0000-0000-0000-000000000000', true) $$;

-- 1. Attributs des rôles -------------------------------------------------------------------------------------------------
SELECT is((SELECT count(*)::int FROM pg_roles WHERE rolname IN ('cashless_tagkeys','cashless_perso','cashless_tagcheck','cashless_keyadmin')
            AND rolcanlogin AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolinherit), 4,
  'quatre rôles : connexion seule, ni super-utilisateur, ni contournement de la RLS, ni héritage');
SELECT is((SELECT count(*)::int FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.member
            WHERE r.rolname IN ('cashless_tagkeys','cashless_perso','cashless_tagcheck','cashless_keyadmin','cashless_app')), 0,
  'aucun de ces rôles n''est membre d''un autre rôle');

-- 2. Aucun rôle des clés n'atteint le grand livre -----------------------------------------------------------------------------
SELECT is((SELECT count(*)::int FROM unnest(ARRAY['cashless_tagkeys','cashless_perso','cashless_tagcheck','cashless_keyadmin']) r,
                  unnest(ARRAY['journal_transaction','posting','account_balance','account','wallet','ledger','anomaly','media_tap','media_assignment']) t,
                  unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) p
            WHERE has_table_privilege(r, t, p) OR has_any_column_privilege(r, t, CASE WHEN p IN ('DELETE','TRUNCATE') THEN 'SELECT' ELSE p END)), 0,
  'aucun droit sur le grand livre, les comptes, les portefeuilles, les anomalies ni les lectures');
SELECT is((SELECT count(*)::int FROM unnest(ARRAY['cashless_tagkeys','cashless_perso','cashless_tagcheck','cashless_keyadmin','cashless_app']) r,
                  unnest(ARRAY['media','tag_key','tag_data_key','tag_key_job','tag_key_check_run','claim_code','media_claim','claim_attempt']) t,
                  unnest(ARRAY['DELETE','TRUNCATE']) p WHERE has_table_privilege(r, t, p)), 0,
  'aucune suppression nulle part, pour aucun rôle');

-- 3. API publique : ne lit plus les secrets chiffrés ---------------------------------------------------------------------------
SELECT ok(NOT has_column_privilege('cashless_app', 'media', 'pwd_pack_enc', 'SELECT'), 'API publique : pas de lecture de media.pwd_pack_enc');
SELECT ok(NOT has_column_privilege('cashless_app', 'media', 'pwd_pack_dek_id', 'SELECT'), 'API publique : pas de lecture de media.pwd_pack_dek_id');
SELECT ok(NOT has_column_privilege('cashless_app', 'tag_data_key', 'encrypted_dek', 'SELECT'), 'API publique : pas de lecture de tag_data_key.encrypted_dek');
SELECT ok(NOT has_table_privilege('cashless_app', 'offline_snapshot_rows', 'SELECT'), 'API publique : pas de lecture du contenu d''un snapshot');
SELECT ok(NOT has_table_privilege('cashless_app', 'media', 'INSERT'), 'API publique : n''insère aucun bracelet');
SELECT ok(NOT has_any_column_privilege('cashless_app', 'tag_key', 'INSERT') AND NOT has_any_column_privilege('cashless_app', 'tag_key', 'UPDATE'),
  'API publique : n''écrit aucune clé');
SELECT ok(NOT has_any_column_privilege('cashless_app', 'tag_data_key', 'INSERT') AND NOT has_any_column_privilege('cashless_app', 'tag_data_key', 'UPDATE'),
  'API publique : n''écrit aucune clé de données');
SELECT is((SELECT array_agg(a.attname::text ORDER BY a.attname) FROM pg_attribute a
            WHERE a.attrelid = 'media'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('cashless_app', 'media', a.attname, 'UPDATE')),
  ARRAY['claim_attempts','claim_code_used_at','status'],
  'API publique : trois colonnes de media modifiables, pas une de plus (claim_code_hash : associate_claim_code seule, 0019)');
SELECT is((SELECT count(*)::int FROM pg_attribute a WHERE a.attrelid = 'media'::regclass AND a.attnum > 0 AND NOT a.attisdropped
            AND NOT has_column_privilege('cashless_app', 'media', a.attname, 'SELECT')), 2, 'API publique : toutes les colonnes de media lisibles sauf deux');
SELECT ok(has_function_privilege('cashless_app', 'public_balance_lookup(bytea, text)', 'EXECUTE'), 'API publique : consultation anonyme accordée');
SELECT ok(NOT has_function_privilege('cashless_tagkeys', 'public_balance_lookup(bytea, text)', 'EXECUTE')
      AND NOT has_function_privilege('cashless_perso', 'public_balance_lookup(bytea, text)', 'EXECUTE'), 'consultation anonyme : API publique seulement');

SET LOCAL ROLE cashless_app;
SELECT pg_temp.a();
SELECT throws_ok($$SELECT * FROM media$$, '42501', NULL, 'API publique : SELECT * sur media refusé');
SELECT throws_ok($$SELECT pwd_pack_enc FROM media$$, '42501', NULL, 'API publique : lecture du chiffré refusée');
SELECT throws_ok($$SELECT encrypted_dek FROM tag_data_key$$, '42501', NULL, 'API publique : lecture de la clé de données chiffrée refusée');
SELECT throws_ok($$SELECT * FROM offline_snapshot_rows$$, '42501', NULL, 'API publique : contenu d''un snapshot refusé');
SELECT is((SELECT status FROM media WHERE id = '00000000-0000-0000-0000-00000014d001'), 'PERSONALIZED', 'API publique : lit le statut d''un bracelet');
SELECT is((SELECT status FROM tag_data_key WHERE id = '00000000-0000-0000-0000-00000014e001'), 'ACTIVE', 'API publique : lit le statut d''une clé de données');
SELECT throws_ok($$UPDATE media SET pwd_pack_enc = decode(repeat('00', 34), 'hex') WHERE id = '00000000-0000-0000-0000-00000014d001'$$, '42501', NULL,
  'API publique : ne remplace pas un mot de passe chiffré');
SELECT throws_ok($$UPDATE media SET deposit_status = 'HELD' WHERE id = '00000000-0000-0000-0000-00000014d001'$$, '42501', NULL,
  'API publique : la caution ne s''écrit que par les fonctions du schéma');
SELECT throws_ok($$INSERT INTO tag_key_check_run (operator_id, sampled, mismatches, status) VALUES ('00000000-0000-0000-0000-00000014a001', 1, 0, 'OK')$$,
  '42501', NULL, 'API publique : n''écrit aucun compte rendu de contrôle');
SELECT throws_ok($$UPDATE tag_key_job SET progress = '{}' WHERE id = '00000000-0000-0000-0000-00000014c001'$$, '42501', NULL,
  'API publique : ne modifie pas l''avancement d''un travail');

-- 4. Clés de bracelet ---------------------------------------------------------------------------------------------------------------
SET LOCAL ROLE cashless_tagkeys;
SELECT pg_temp.a();
SELECT is((SELECT encode(pwd_pack_enc, 'hex') FROM media WHERE nfc_uid = '\x04140000000001'), repeat('ab', 34), 'clés de bracelet : lit le chiffré par UID');
SELECT is((SELECT count(*)::int FROM media), 1, 'clés de bracelet : seulement les bracelets du prestataire de session');
SELECT throws_ok($$SELECT token_hash FROM media$$, '42501', NULL, 'clés de bracelet : pas d''empreinte de l''identité');
SELECT throws_ok($$SELECT claim_code_hash FROM media$$, '42501', NULL, 'clés de bracelet : pas d''empreinte du code');
SELECT lives_ok($$UPDATE media SET pwd_pack_enc = decode(repeat('ef', 34), 'hex') WHERE id = '00000000-0000-0000-0000-00000014d001'$$, 'clés de bracelet : rechiffre');
SELECT throws_ok($$UPDATE media SET status = 'BLACKLISTED' WHERE id = '00000000-0000-0000-0000-00000014d001'$$, '42501', NULL, 'clés de bracelet : ne change aucun statut');
SELECT throws_ok($$INSERT INTO media (operator_id, kind, token_hash) VALUES ('00000000-0000-0000-0000-00000014a001', 'QR', sha256('x'))$$, '42501', NULL,
  'clés de bracelet : n''insère aucun bracelet');
SELECT is((SELECT encode(encrypted_dek, 'hex') FROM tag_data_key WHERE id = '00000000-0000-0000-0000-00000014e001'), 'deadbeef', 'clés de bracelet : lit la clé de données chiffrée');
SELECT throws_ok($$INSERT INTO tag_data_key (operator_id, key_index, version, wrapping_kms_key_ref, encrypted_dek) VALUES
  ('00000000-0000-0000-0000-00000014a001', 1, 2, 'k', '\x00')$$, '42501', NULL, 'clés de bracelet : ne crée aucune clé de données');
SELECT throws_ok($$SELECT * FROM media_batch$$, '42501', NULL, 'clés de bracelet : aucun accès aux lots');
SELECT pg_temp.nil();
SELECT is((SELECT array_agg(kind ORDER BY kind) FROM tag_key_job), ARRAY['REENCRYPT'], 'clés de bracelet : ne voit que les travaux de rechiffrement, tous prestataires');
SELECT is((SELECT kind FROM claim_tag_key_job(ARRAY['CREATE_KEY','ROTATE_DEK','REENCRYPT','RETIRE_KEY','DISABLE_KMS_KEY'])), 'REENCRYPT',
  'clés de bracelet : ne prend que le rechiffrement, même en demandant tout');
SELECT throws_ok($$INSERT INTO tag_key_job (operator_id, key_index, kind) VALUES ('00000000-0000-0000-0000-00000014a001', 5, 'REENCRYPT')$$, '42501', NULL,
  'clés de bracelet : n''inscrit aucun travail');

-- 5. Personnalisation -----------------------------------------------------------------------------------------------------------------
SET LOCAL ROLE cashless_perso;
SELECT pg_temp.a();
SELECT throws_ok($$SELECT pwd_pack_enc FROM media$$, '42501', NULL, 'personnalisation : ne relit aucun mot de passe chiffré');
SELECT throws_ok($$SELECT encrypted_dek FROM tag_data_key$$, '42501', NULL, 'personnalisation : ne relit aucune clé de données chiffrée');
SELECT throws_ok($$SELECT token_hash FROM media$$, '42501', NULL, 'personnalisation : ne relit pas l''empreinte de l''identité');
SELECT is((SELECT status FROM media WHERE nfc_uid = '\x04140000000001'), 'PERSONALIZED', 'personnalisation : retrouve un bracelet par UID (rejeu)');
SELECT lives_ok($$SELECT register_personalized_media('00000000-0000-0000-0000-00000014b001', '00000000-0000-0000-0000-00000014d003', sha256('identité 0014 C'),
  '\x04140000000003', sha256('signature'), true, decode(repeat('12', 34), 'hex'), '00000000-0000-0000-0000-00000014e001', '00000000-0000-0000-0000-00000014f001')$$,
  'personnalisation : enregistre un bracelet');
SELECT throws_ok($$UPDATE media SET status = 'ISSUED' WHERE id = '00000000-0000-0000-0000-00000014d003'$$, '42501', NULL, 'personnalisation : ne change aucun statut');
SELECT throws_ok($$UPDATE media SET pwd_pack_enc = decode(repeat('00', 34), 'hex') WHERE id = '00000000-0000-0000-0000-00000014d003'$$, '42501', NULL,
  'personnalisation : ne remplace pas un mot de passe chiffré');
SELECT throws_ok($$UPDATE media_batch SET quantity = 500 WHERE id = '00000000-0000-0000-0000-00000014b001'$$, '42501', NULL, 'personnalisation : ne modifie aucun lot');
SELECT throws_ok($$INSERT INTO tag_key (operator_id, key_index, kms_key_ref) VALUES ('00000000-0000-0000-0000-00000014a001', 9, 'x')$$, '42501', NULL,
  'personnalisation : ne crée aucune clé de dérivation');
SELECT lives_ok($$UPDATE tag_data_key SET status = 'DECRYPT_ONLY' WHERE id = '00000000-0000-0000-0000-00000014e001'$$, 'personnalisation : déclasse une clé de données');
SELECT lives_ok($$INSERT INTO tag_data_key (operator_id, key_index, version, wrapping_kms_key_ref, encrypted_dek) VALUES
  ('00000000-0000-0000-0000-00000014a001', 1, 2, 'test:wrap', '\xfeed')$$, 'personnalisation : ouvre une nouvelle version de clé de données');
SELECT throws_ok($$INSERT INTO tag_key_job (operator_id, key_index, kind) VALUES ('00000000-0000-0000-0000-00000014a001', 7, 'CREATE_KEY')$$, '42501', NULL,
  'personnalisation : n''inscrit pas une création de clé');
SELECT lives_ok($$INSERT INTO tag_key_job (operator_id, key_index, kind) VALUES ('00000000-0000-0000-0000-00000014a001', 1, 'REENCRYPT')$$,
  'personnalisation : inscrit le rechiffrement qui suit une rotation');
SELECT pg_temp.nil();
SELECT is((SELECT array_agg(kind ORDER BY kind) FROM tag_key_job), ARRAY['RETIRE_KEY','ROTATE_DEK'], 'personnalisation : ne voit que rotation et retrait');

-- 6. Contrôle quotidien -----------------------------------------------------------------------------------------------------------------
SET LOCAL ROLE cashless_tagcheck;
SELECT pg_temp.nil();
SELECT is((SELECT count(DISTINCT operator_id)::int FROM tag_key WHERE operator_id IN ('00000000-0000-0000-0000-00000014a001','00000000-0000-0000-0000-00000014a002')), 2,
  'contrôle quotidien : liste les prestataires qui ont une clé');
SELECT is((SELECT count(*)::int FROM media), 0, 'contrôle quotidien : aucun bracelet sans prestataire de session');
SELECT pg_temp.b();
SELECT is((SELECT encode(pwd_pack_enc, 'hex') FROM media), repeat('cd', 34), 'contrôle quotidien : lit le chiffré du prestataire contrôlé');
SELECT throws_ok($$UPDATE media SET pwd_pack_enc = decode(repeat('00', 34), 'hex')$$, '42501', NULL, 'contrôle quotidien : ne modifie aucun bracelet');
SELECT lives_ok($$INSERT INTO tag_key_check_run (operator_id, sampled, mismatches, status) VALUES ('00000000-0000-0000-0000-00000014a002', 1, 0, 'OK')$$,
  'contrôle quotidien : écrit son compte rendu');
SELECT throws_ok($$INSERT INTO tag_key_check_run (operator_id, sampled, mismatches, status) VALUES ('00000000-0000-0000-0000-00000014a001', 1, 0, 'OK')$$,
  '42501', NULL, 'contrôle quotidien : pas de compte rendu pour un autre prestataire que celui de la session');
SELECT throws_ok($$SELECT * FROM tag_key_job$$, '42501', NULL, 'contrôle quotidien : aucun accès aux travaux de clé');

-- 7. Commande d'administration des clés ------------------------------------------------------------------------------------------------
SET LOCAL ROLE cashless_keyadmin;
SELECT pg_temp.nil();
SELECT is((SELECT array_agg(kind ORDER BY kind) FROM tag_key_job), ARRAY['CREATE_KEY','DISABLE_KMS_KEY'], 'commande d''administration : ne voit que création et désactivation');
SELECT throws_ok($$SELECT id FROM media$$, '42501', NULL, 'commande d''administration : aucun accès aux bracelets');
SELECT throws_ok($$SELECT id FROM tag_data_key$$, '42501', NULL, 'commande d''administration : aucun accès aux clés de données');
SELECT pg_temp.a();
SELECT lives_ok($$INSERT INTO tag_key (operator_id, key_index, kms_key_ref) VALUES ('00000000-0000-0000-0000-00000014a001', 2, 'test:hmac-a2')$$,
  'commande d''administration : crée une clé pour le prestataire du travail');
SELECT throws_ok($$INSERT INTO tag_key (operator_id, key_index, kms_key_ref) VALUES ('00000000-0000-0000-0000-00000014a002', 2, 'test:hmac-b2')$$, '42501', NULL,
  'commande d''administration : pas pour un autre prestataire que celui de la session');
SELECT lives_ok($$UPDATE tag_key SET kms_disabled_at = now() WHERE operator_id = '00000000-0000-0000-0000-00000014a001' AND key_index = 2$$,
  'commande d''administration : note la désactivation');
SELECT throws_ok($$UPDATE tag_key SET kms_key_ref = 'autre' WHERE operator_id = '00000000-0000-0000-0000-00000014a001' AND key_index = 2$$, '42501', NULL,
  'commande d''administration : ne change pas la référence d''une clé existante');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
