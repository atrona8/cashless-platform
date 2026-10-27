-- Écrivains des tables dont un déclencheur s'exécute avec les droits du propriétaire (migration 0018) — pgTAP, écrit
-- à la main. Lot 20, cycle 6 (relecture du cycle 5, constat 1 et remarque 1 ; ADR-94, OP-N57, OP-N58).
-- Depuis 0018, log_media_status et log_batch_status sont SECURITY DEFINER : un rôle qui insère dans `media` ou change
-- un statut de `media` / `media_batch` fait écrire, par le déclencheur, dans des tables où il n'a aucun droit. Ce
-- fichier prouve que ce passage n'élargit les droits d'aucun rôle de l'application :
--   1. la personnalisation (cashless_perso) n'insère dans `media` que par register_personalized_media : le scénario
--      de la relecture (bracelet ACTIVE rattaché au portefeuille d'un festivalier, identité choisie) est refusé, et
--      aucun rattachement n'est créé ; register_personalized_media passe toujours. Depuis le cycle 7 (migration 0019),
--      ce rôle n'a plus aucun INSERT sur `media` : les refus ci-dessous sont des refus de droit, et
--      tests_personalization_definer.sql prouve les contrôles de lot et de clé de données de la fonction ;
--   2. la liste exacte des droits d'écriture des rôles cashless_* sur `media` et `media_batch` est figée, ainsi que la
--      liste des fonctions de déclencheur SECURITY DEFINER ;
--   3. les droits d'écriture actuels sur `offline_snapshot` et `offline_policy_history` (OP-N57, OP-N58, mission 7)
--      sont figés : la suite échoue si la limite s'élargit ;
--   4. OP-N59, levée par la mission 5a (migration 0021) : aucune fonction SECURITY DEFINER sans pg_temp en dernier
--      dans son search_path ; OP-N60 (mission 11) : les droits de cashless_app sur media_batch sont figés, colonne par
--      colonne.
-- Lancer : pg_prove -d <base> tests/tests_definer_trigger_writers.sql (base créée par les migrations, roles.sql et
-- post-roles.sql rejoués).
\set ON_ERROR_STOP 1
\set QUIET 1
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

-- Prestataires A (a001) et B (a002), organisateurs, grands livres et portefeuilles de chacun ; clé, clé de données et
-- lot en préparation chez A.
INSERT INTO party (id, kind, legal_name, country_code) VALUES
 ('00000000-0000-0000-0000-00000018a001','OPERATOR','Prestataire A','SN'),
 ('00000000-0000-0000-0000-00000018a002','OPERATOR','Prestataire B','CI');
INSERT INTO party (id, kind, operator_id, legal_name, country_code) VALUES
 ('00000000-0000-0000-0000-00000018a011','ORGANIZER','00000000-0000-0000-0000-00000018a001','Organisateur A','SN'),
 ('00000000-0000-0000-0000-00000018a012','ORGANIZER','00000000-0000-0000-0000-00000018a002','Organisateur B','CI');
INSERT INTO ledger (id, operator_id, scope_type, scope_id, currency, issuer_id, funds_holder_id) VALUES
 ('00000000-0000-0000-0000-00000018b001','00000000-0000-0000-0000-00000018a001','EVENT', gen_random_uuid(),'XOF',
  '00000000-0000-0000-0000-00000018a011','00000000-0000-0000-0000-00000018a011'),
 ('00000000-0000-0000-0000-00000018b002','00000000-0000-0000-0000-00000018a002','EVENT', gen_random_uuid(),'XOF',
  '00000000-0000-0000-0000-00000018a012','00000000-0000-0000-0000-00000018a012');
INSERT INTO wallet (id, operator_id, ledger_id) VALUES
 ('00000000-0000-0000-0000-00000018c001','00000000-0000-0000-0000-00000018a001','00000000-0000-0000-0000-00000018b001'),
 ('00000000-0000-0000-0000-00000018c002','00000000-0000-0000-0000-00000018a002','00000000-0000-0000-0000-00000018b002');
INSERT INTO tag_key (operator_id, key_index, kms_key_ref, status) VALUES
 ('00000000-0000-0000-0000-00000018a001', 1, 'test:hmac-18', 'ACTIVE');
INSERT INTO tag_data_key (id, operator_id, key_index, version, wrapping_kms_key_ref, encrypted_dek) VALUES
 ('00000000-0000-0000-0000-00000018e001','00000000-0000-0000-0000-00000018a001', 1, 1, 'test:wrap', '\xdeadbeef');
INSERT INTO media_batch (id, operator_id, organizer_id, kind, quantity, key_index) VALUES
 ('00000000-0000-0000-0000-000000189001','00000000-0000-0000-0000-00000018a001','00000000-0000-0000-0000-00000018a011',
  'PUBLIC', 5, 1);

-- 1. Personnalisation : aucune insertion directe -------------------------------------------------------------------------
SET LOCAL ROLE cashless_perso;
SELECT set_config('app.operator_id', '00000000-0000-0000-0000-00000018a001', true);

-- Scénario de la relecture (scratchpad wp20c5r/perso.sql) : bracelet ACTIVE, identité choisie, rattaché au
-- portefeuille d'un autre prestataire.
SELECT throws_ok($$INSERT INTO media (id, operator_id, kind, token_hash, nfc_uid, wallet_id, status) VALUES
  ('00000000-0000-0000-0000-00000018d0ff','00000000-0000-0000-0000-00000018a001','NFC_TAG', sha256('\xbeef'::bytea),
   '\x041800000000ff','00000000-0000-0000-0000-00000018c002','ACTIVE')$$,
  '42501', NULL, 'cashless_perso : bracelet ACTIVE rattaché au portefeuille d''un autre prestataire refusé (scénario de la relecture)');
SELECT throws_ok($$INSERT INTO media (id, operator_id, kind, token_hash, nfc_uid, wallet_id, status) VALUES
  ('00000000-0000-0000-0000-00000018d0f1','00000000-0000-0000-0000-00000018a001','NFC_TAG', sha256('\xbe01'::bytea),
   '\x041800000000f1','00000000-0000-0000-0000-00000018c001','ACTIVE')$$,
  '42501', NULL, 'cashless_perso : bracelet ACTIVE rattaché à un portefeuille du même prestataire refusé');
SELECT throws_ok($$INSERT INTO media (id, operator_id, kind, token_hash, nfc_uid, wallet_id, status) VALUES
  ('00000000-0000-0000-0000-00000018d0f2','00000000-0000-0000-0000-00000018a001','NFC_TAG', sha256('\xbe02'::bytea),
   '\x041800000000f2','00000000-0000-0000-0000-00000018c001','ISSUED')$$,
  '42501', NULL, 'cashless_perso : bracelet ISSUED rattaché à un portefeuille refusé');
SELECT throws_ok($$INSERT INTO media (id, operator_id, kind, token_hash, nfc_uid, wallet_id, status) VALUES
  ('00000000-0000-0000-0000-00000018d0f3','00000000-0000-0000-0000-00000018a001','NFC_TAG', sha256('\xbe03'::bytea),
   '\x041800000000f3','00000000-0000-0000-0000-00000018c001','PERSONALIZED')$$,
  '42501', NULL, 'cashless_perso : bracelet en stock rattaché à un portefeuille refusé');
-- Mêmes colonnes que register_personalized_media, sauf le statut ou la signature : refusé (aucun INSERT, cycle 7).
SELECT throws_ok($$INSERT INTO media (id, operator_id, kind, token_hash, nfc_uid, key_index, signature_ok,
    originality_sig_sha256, batch_id, status, personalized_at, pwd_pack_enc, pwd_pack_dek_id) VALUES
  ('00000000-0000-0000-0000-00000018d0f4','00000000-0000-0000-0000-00000018a001','NFC_TAG', sha256('\xbe04'::bytea),
   '\x041800000000f4', 1, true, sha256('sig'), '00000000-0000-0000-0000-000000189001', 'ISSUED', now(),
   decode(repeat('12', 34), 'hex'), '00000000-0000-0000-0000-00000018e001')$$,
  '42501', NULL, 'cashless_perso : bracelet ISSUED (sans portefeuille) refusé : seul PERSONALIZED naît par ce rôle');
SELECT throws_ok($$INSERT INTO media (id, operator_id, kind, token_hash, nfc_uid, key_index, signature_ok,
    originality_sig_sha256, batch_id, status, personalized_at, pwd_pack_enc, pwd_pack_dek_id) VALUES
  ('00000000-0000-0000-0000-00000018d0f5','00000000-0000-0000-0000-00000018a001','NFC_TAG', sha256('\xbe05'::bytea),
   '\x041800000000f5', 1, false, sha256('sig'), '00000000-0000-0000-0000-000000189001', 'PERSONALIZED', now(),
   decode(repeat('12', 34), 'hex'), '00000000-0000-0000-0000-00000018e001')$$,
  '42501', NULL, 'cashless_perso : bracelet à signature d''originalité invalide refusé');
SELECT throws_ok($$INSERT INTO media (id, operator_id, kind, token_hash, nfc_uid, key_index, signature_ok,
    originality_sig_sha256, batch_id, status, personalized_at, pwd_pack_enc, pwd_pack_dek_id, deposit_status) VALUES
  ('00000000-0000-0000-0000-00000018d0f6','00000000-0000-0000-0000-00000018a001','NFC_TAG', sha256('\xbe06'::bytea),
   '\x041800000000f6', 1, true, sha256('sig'), '00000000-0000-0000-0000-000000189001', 'PERSONALIZED', now(),
   decode(repeat('12', 34), 'hex'), '00000000-0000-0000-0000-00000018e001', 'HELD')$$,
  '42501', NULL, 'cashless_perso : caution posée à l''insertion refusée');

-- Chemin légitime : inchangé.
SELECT lives_ok($$SELECT register_personalized_media('00000000-0000-0000-0000-000000189001',
  '00000000-0000-0000-0000-00000018d001', sha256('identité 0018'), '\x04180000000001', sha256('signature'), true,
  decode(repeat('34', 34), 'hex'), '00000000-0000-0000-0000-00000018e001', '00000000-0000-0000-0000-00000018f001')$$,
  'cashless_perso : register_personalized_media enregistre toujours un bracelet');
RESET ROLE;

SELECT is((SELECT count(*)::int FROM media WHERE id IN ('00000000-0000-0000-0000-00000018d0ff',
            '00000000-0000-0000-0000-00000018d0f1','00000000-0000-0000-0000-00000018d0f2','00000000-0000-0000-0000-00000018d0f3',
            '00000000-0000-0000-0000-00000018d0f4','00000000-0000-0000-0000-00000018d0f5','00000000-0000-0000-0000-00000018d0f6')),
  0, 'aucun des bracelets refusés n''existe');
SELECT is((SELECT count(*)::int FROM media_assignment WHERE wallet_id IN ('00000000-0000-0000-0000-00000018c001',
            '00000000-0000-0000-0000-00000018c002')),
  0, 'aucun rattachement ouvert sur les portefeuilles visés');
SELECT is((SELECT status || ' ' || coalesce(wallet_id::text, '-') || ' ' || deposit_status FROM media
            WHERE id = '00000000-0000-0000-0000-00000018d001'),
  'PERSONALIZED - NONE', 'bracelet enregistré : en stock, sans portefeuille, sans caution');
SELECT is((SELECT coalesce(from_status, '-') || '>' || to_status || ':' || actor_id::text FROM media_status_history
            WHERE media_id = '00000000-0000-0000-0000-00000018d001'),
  '->PERSONALIZED:00000000-0000-0000-0000-00000018f001', 'historique du bracelet enregistré écrit par le déclencheur');
SELECT is((SELECT count(*)::int FROM media_assignment WHERE media_id = '00000000-0000-0000-0000-00000018d001'), 0,
  'bracelet enregistré : aucun rattachement');

-- Droits : aucun INSERT, ni sur la table ni sur une colonne (cycle 7 ; la politique perso_media_insert du cycle 6 est
-- retirée, faute de droit à borner).
SELECT ok(NOT has_any_column_privilege('cashless_perso', 'media', 'INSERT'),
  'cashless_perso : aucun INSERT sur media, ni table ni colonne');
SELECT is((SELECT count(*)::int FROM pg_policies WHERE tablename = 'media' AND roles @> ARRAY['cashless_perso']::name[]), 0,
  'aucune politique nominative de cashless_perso sur media');

-- 2. Écrivains de media et media_batch (déclencheurs SECURITY DEFINER depuis 0018) ---------------------------------------
SELECT is((SELECT string_agg(c.relname || ':' || p.proname, ' ' ORDER BY c.relname, p.proname)
             FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid JOIN pg_class c ON c.oid = t.tgrelid
            WHERE NOT t.tgisinternal AND p.prosecdef AND c.relnamespace = 'public'::regnamespace),
  'account:account_hot_switch anomaly:anomaly_cash_due_guard app_user:app_user_guard audit_log:audit_log_chain '
  'config_version:config_version_assign contract:contract_version_assign event:event_jurisdiction_bounds '
  'event:event_references_guard event_psp_selection:event_psp_selection_guard fee_rule:fee_rule_guard media:log_media_status media_batch:log_batch_status '
  'merchant_participation:participation_guard point_of_sale:point_of_sale_guard '
  'psp_configuration:psp_configuration_immutable role_assignment:role_assignment_guard',
  'fonctions de déclencheur SECURITY DEFINER : liste exacte (une nouvelle impose de revoir ses écrivains)');
-- Liste exacte des droits d'écriture des rôles de l'application sur les deux tables. Avant 0018 :
--   cashless_app (UPDATE status de media, INSERT et UPDATE de media_batch) avait INSERT sur les deux historiques :
--   le déclencheur n'écrit rien de plus qu'avant (et UPDATE ne crée aucun rattachement) ;
--   cashless_perso avait INSERT sur media_status_history, mais aucun droit sur media_assignment : d'où la borne du
--   cycle 6, remplacée au cycle 7 par l'absence de tout droit d'écriture sur media (migration 0019) ;
--   cashless_tagkeys (UPDATE pwd_pack_enc, pwd_pack_dek_id) ne déclenche rien (déclencheur UPDATE OF status) ;
--   l'empreinte du code (claim_code_hash) ne s'écrit plus que par associate_claim_code (0019).
SELECT is((SELECT string_agg(r || ':' || t || ':' || p || ':' ||
                    CASE WHEN has_table_privilege(r, t, p) THEN 'ALL'
                         ELSE (SELECT string_agg(a.attname, ',' ORDER BY a.attname) FROM pg_attribute a
                                WHERE a.attrelid = t::regclass AND a.attnum > 0 AND NOT a.attisdropped
                                  AND has_column_privilege(r, t, a.attname, p)) END,
                  ' ' ORDER BY r, t, p)
             FROM (SELECT rolname::text AS r FROM pg_roles WHERE rolname LIKE 'cashless\_%') roles,
                  unnest(ARRAY['media','media_batch']) t, unnest(ARRAY['INSERT','UPDATE']) p
            WHERE has_any_column_privilege(r, t, p)),
  'cashless_app:media:UPDATE:claim_attempts,claim_code_used_at,status '
  'cashless_app:media_batch:INSERT:ALL cashless_app:media_batch:UPDATE:ALL '
  'cashless_tagkeys:media:UPDATE:pwd_pack_dek_id,pwd_pack_enc',
  'écrivains de media et media_batch : liste exacte des droits des rôles cashless_*');
SELECT is((SELECT string_agg(r || ':' || t || ':' || p, ' ' ORDER BY r, t, p)
             FROM (SELECT rolname::text AS r FROM pg_roles WHERE rolname LIKE 'cashless\_%') roles,
                  unnest(ARRAY['media','media_batch']) t, unnest(ARRAY['DELETE','TRUNCATE']) p
            WHERE has_table_privilege(r, t, p)),
  NULL, 'aucun rôle cashless_* ne supprime de bracelet ni de lot');

-- 3. Tables hors ligne (OP-N57 offline_snapshot, OP-N58 offline_policy_history ; mission 7) --------------------------------
-- Limite acceptée en l'état : seul cashless_app y écrit, et seulement INSERT et UPDATE (UPDATE refusé par le
-- déclencheur forbid_mutation). La suite échoue si un rôle ou un droit s'ajoute.
SELECT is((SELECT string_agg(r || ':' || t || ':' || p || ':' ||
                    CASE WHEN has_table_privilege(r, t, p) THEN 'ALL'
                         ELSE (SELECT string_agg(a.attname, ',' ORDER BY a.attname) FROM pg_attribute a
                                WHERE a.attrelid = t::regclass AND a.attnum > 0 AND NOT a.attisdropped
                                  AND has_column_privilege(r, t, a.attname, p)) END,
                  ' ' ORDER BY r, t, p)
             FROM (SELECT rolname::text AS r FROM pg_roles WHERE rolname LIKE 'cashless\_%') roles,
                  unnest(ARRAY['offline_snapshot','offline_policy_history']) t,
                  unnest(ARRAY['INSERT','UPDATE']) p
            WHERE has_any_column_privilege(r, t, p)),
  'cashless_app:offline_policy_history:INSERT:ALL cashless_app:offline_policy_history:UPDATE:ALL '
  'cashless_app:offline_snapshot:INSERT:ALL cashless_app:offline_snapshot:UPDATE:ALL',
  'OP-N57, OP-N58 : écritures sur offline_snapshot et offline_policy_history limitées à INSERT et UPDATE de cashless_app');
SELECT is((SELECT string_agg(r || ':' || t || ':' || p, ' ' ORDER BY r, t, p)
             FROM (SELECT rolname::text AS r FROM pg_roles WHERE rolname LIKE 'cashless\_%') roles,
                  unnest(ARRAY['offline_snapshot','offline_policy_history']) t, unnest(ARRAY['DELETE','TRUNCATE']) p
            WHERE has_table_privilege(r, t, p)),
  NULL, 'OP-N57, OP-N58 : aucun rôle cashless_* ne supprime de snapshot ni d''historique de politique');
SELECT is((SELECT string_agg(tgname, ' ' ORDER BY tgname) FROM pg_trigger
            WHERE tgrelid IN ('offline_snapshot'::regclass, 'offline_policy_history'::regclass) AND NOT tgisinternal),
  'offline_policy_history_immutable offline_snapshot_check offline_snapshot_immutable',
  'OP-N57, OP-N58 : contrôles en place (version croissante, lignes immuables)');
SELECT ok(NOT (SELECT prosecdef FROM pg_proc WHERE proname = 'log_offline_policy'),
  'OP-N58 : log_offline_policy reste aux droits de l''appelant (comportement inchangé dans cette mission)');

-- 4. OP-N59 (ADR-96, levée) ; limite acceptée par le porteur le 15/10/2026 : OP-N60 (ADR-97) ---------------------------
-- OP-N59 : levée par la mission 5a (identite-enrolement-terminaux, migration 0021). Toute fonction SECURITY DEFINER du
-- schéma public (hors extensions) fixe un search_path qui finit par pg_temp : une table temporaire de l'appelant ne
-- masque plus une table de la base. La borne est passée de « au plus 77 » à 0 : une fonction future qui oublie
-- `search_path = public, pg_temp` (ou un CREATE OR REPLACE qui efface le réglage) fait échouer la suite. Preuves
-- détaillées (tables temporaires sur chaque tenant_of_*, témoins) : tests_definer_search_path.sql.
SELECT is((SELECT count(*)::int FROM pg_proc p
            WHERE p.pronamespace = 'public'::regnamespace AND p.prosecdef
              AND NOT EXISTS (SELECT 1 FROM pg_depend d
                               WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
              AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, '{}'::text[])) c
                               WHERE c LIKE 'search_path=%pg\_temp')),
  0, 'OP-N59 : aucune fonction SECURITY DEFINER sans pg_temp en dernier dans son search_path (levée, migration 0021)');
-- OP-N60 : droits actuels de cashless_app sur media_batch, colonne par colonne (une colonne ajoutée à la table, ou un
-- droit ajouté, fait échouer le test : à revoir avec la mission 11, back-office). Aucune suppression.
SELECT is((SELECT string_agg(p || ':' || (SELECT string_agg(a.attname, ',' ORDER BY a.attname) FROM pg_attribute a
                                           WHERE a.attrelid = 'media_batch'::regclass AND a.attnum > 0 AND NOT a.attisdropped
                                             AND has_column_privilege('cashless_app', 'media_batch', a.attname, p)),
                             ' ' ORDER BY p)
             FROM unnest(ARRAY['INSERT','REFERENCES','SELECT','UPDATE']) p
            WHERE has_any_column_privilege('cashless_app', 'media_batch', p)),
  'INSERT:claim_codes_issued_at,created_at,deposit_amount,deposit_mode,event_id,id,key_index,key_mode,kind,operator_id,'
  'organizer_id,preload_promo_amount,print_order_ref,quantity,reuse_policy,status '
  'SELECT:claim_codes_issued_at,created_at,deposit_amount,deposit_mode,event_id,id,key_index,key_mode,kind,operator_id,'
  'organizer_id,preload_promo_amount,print_order_ref,quantity,reuse_policy,status '
  'UPDATE:claim_codes_issued_at,created_at,deposit_amount,deposit_mode,event_id,id,key_index,key_mode,kind,operator_id,'
  'organizer_id,preload_promo_amount,print_order_ref,quantity,reuse_policy,status',
  'OP-N60 : droits de cashless_app sur media_batch figés (INSERT, SELECT, UPDATE ; mission 11)');
SELECT is((SELECT string_agg(p, ' ' ORDER BY p) FROM unnest(ARRAY['DELETE','TRUNCATE','TRIGGER']) p
            WHERE has_table_privilege('cashless_app', 'media_batch', p)),
  NULL, 'OP-N60 : cashless_app ne supprime ni ne vide media_batch');

SELECT * FROM finish();
ROLLBACK;
