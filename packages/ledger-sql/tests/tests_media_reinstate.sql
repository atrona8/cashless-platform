-- Sortie de liste noire vérifiée par la base (migration 0017, levée d'OP-N52) — pgTAP, écrit à la main.
-- Lancer : pg_prove -d <base> tests/tests_media_reinstate.sql (base créée par les migrations, roles.sql et
-- post-roles.sql rejoués). Les refus sont vérifiés depuis le rôle de l'API (cashless_app) : la session du propriétaire
-- garde la seule règle du schéma de référence.
\set ON_ERROR_STOP 1
\set QUIET 1
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

-- Prestataire A (a001) et B (a002) ; organisateur de A ; grand livre, portefeuille, bracelet en liste noire.
INSERT INTO party (id, kind, legal_name, country_code) VALUES
 ('00000000-0000-0000-0000-00000017a001','OPERATOR','Prestataire A','SN'),
 ('00000000-0000-0000-0000-00000017a002','OPERATOR','Prestataire B','CI');
INSERT INTO party (id, kind, operator_id, legal_name, country_code) VALUES
 ('00000000-0000-0000-0000-00000017a011','ORGANIZER','00000000-0000-0000-0000-00000017a001','Organisateur A','SN');
INSERT INTO ledger (id, operator_id, scope_type, scope_id, currency, issuer_id, funds_holder_id) VALUES
 ('00000000-0000-0000-0000-00000017b001','00000000-0000-0000-0000-00000017a001','EVENT', gen_random_uuid(),'XOF',
  '00000000-0000-0000-0000-00000017a011','00000000-0000-0000-0000-00000017a011');
INSERT INTO wallet (id, operator_id, ledger_id) VALUES
 ('00000000-0000-0000-0000-00000017c001','00000000-0000-0000-0000-00000017a001','00000000-0000-0000-0000-00000017b001');
INSERT INTO media (id, operator_id, kind, token_hash, nfc_uid, wallet_id, status) VALUES
 ('00000000-0000-0000-0000-00000017d001','00000000-0000-0000-0000-00000017a001','NFC_TAG', sha256('\x17d001'::bytea),
  '\x04170000000001','00000000-0000-0000-0000-00000017c001','ACTIVE');

-- Lot du prestataire A (historique des lots, migration 0018).
INSERT INTO tag_key (operator_id, key_index, kms_key_ref, status) VALUES
 ('00000000-0000-0000-0000-00000017a001', 1, 'test:hmac-17', 'ACTIVE');
INSERT INTO media_batch (id, operator_id, organizer_id, kind, quantity, key_index) VALUES
 ('00000000-0000-0000-0000-000000179001','00000000-0000-0000-0000-00000017a001','00000000-0000-0000-0000-00000017a011','PUBLIC', 1, 1);

-- Personnes de A : auteur e01 (SUPERVISOR), valideur e02 (SUPERVISOR), caissier e03 (CASHIER, non habilité).
INSERT INTO app_user (id, operator_id, issuer, subject, email, display_name) VALUES
 ('00000000-0000-0000-0000-00000017e001','00000000-0000-0000-0000-00000017a001','https://idp.test','s17-1','s1@test','Superviseur 1'),
 ('00000000-0000-0000-0000-00000017e002','00000000-0000-0000-0000-00000017a001','https://idp.test','s17-2','s2@test','Superviseur 2'),
 ('00000000-0000-0000-0000-00000017e003','00000000-0000-0000-0000-00000017a001','https://idp.test','s17-3','c3@test','Caissier 3');
INSERT INTO role_assignment (user_id, role, scope_type, scope_id, granted_by) VALUES
 ('00000000-0000-0000-0000-00000017e001','SUPERVISOR','ORGANIZER','00000000-0000-0000-0000-00000017a011', NULL),
 ('00000000-0000-0000-0000-00000017e002','SUPERVISOR','ORGANIZER','00000000-0000-0000-0000-00000017a011', NULL),
 ('00000000-0000-0000-0000-00000017e003','CASHIER','ORGANIZER','00000000-0000-0000-0000-00000017a011', NULL);

SELECT set_config('app.user_id', '00000000-0000-0000-0000-00000017e001', true);
SELECT set_config('app.reason', 'fraude', true);
UPDATE media SET status = 'BLACKLISTED' WHERE id = '00000000-0000-0000-0000-00000017d001';
SELECT set_config('app.user_id', '', true);
SELECT set_config('app.reason', '', true);

-- Demande de sortie du prestataire A pour cet épisode (auteur e01), en attente.
CREATE FUNCTION pg_temp.ask(p_id uuid, p_episode text DEFAULT NULL) RETURNS void LANGUAGE sql AS $$
  INSERT INTO approval_request (id, operator_id, action, target_id, payload, requested_by) VALUES
   (p_id, '00000000-0000-0000-0000-00000017a001', 'REINSTATE_MEDIA', '00000000-0000-0000-0000-00000017d001',
    jsonb_build_object('media_id', '00000000-0000-0000-0000-00000017d001', 'reason', 'enquête close',
      'scope_type', 'ORGANIZER', 'scope_id', '00000000-0000-0000-0000-00000017a011',
      'blacklist_history_id', coalesce(p_episode, (SELECT max(id)::text FROM media_status_history
        WHERE media_id = '00000000-0000-0000-0000-00000017d001' AND to_status = 'BLACKLISTED'))),
    '00000000-0000-0000-0000-00000017e001')
$$;
SELECT pg_temp.ask('00000000-0000-0000-0000-00000017f001');

-- 1. Structure ---------------------------------------------------------------------------------------------------------
SELECT has_function('media_reinstatement_approved', ARRAY['uuid','uuid','uuid']);
SELECT ok((SELECT prosecdef FROM pg_proc WHERE proname = 'media_reinstatement_approved'),
  'media_reinstatement_approved : SECURITY DEFINER (lecture indépendante des droits de l''appelant)');
SELECT ok(NOT (SELECT prosecdef FROM pg_proc WHERE proname = 'check_media_transition'),
  'check_media_transition : SECURITY INVOKER (la session de l''appelant compte)');
SELECT has_trigger('approval_request', 'approval_request_born_pending');
-- Migration 0018 : les historiques de statut s'écrivent avec les droits du propriétaire, search_path fixé.
SELECT is((SELECT string_agg(proname || ':' || prosecdef || ':' || coalesce(array_to_string(proconfig, ','), ''), ' '
                             ORDER BY proname)
             FROM pg_proc WHERE proname IN ('log_media_status','log_batch_status')
              AND pronamespace = 'public'::regnamespace),
  'log_batch_status:true:search_path=public, pg_temp log_media_status:true:search_path=public, pg_temp',
  'log_media_status et log_batch_status : SECURITY DEFINER, search_path = public, pg_temp (0019 : pg_temp en dernier)');

-- 2. Refus depuis le rôle de l'API -------------------------------------------------------------------------------------
SET LOCAL ROLE cashless_app;
SELECT set_config('app.operator_id', '00000000-0000-0000-0000-00000017a001', true);

SELECT throws_ok($$SELECT reinstate_media('00000000-0000-0000-0000-00000017d001','00000000-0000-0000-0000-00000017e001',
  '00000000-0000-0000-0000-00000017e002','x')$$, 'CL020', NULL, 'sortie sans demande approuvée (demande en attente) : refusée');

SELECT throws_ok($$INSERT INTO approval_request (operator_id, action, target_id, payload, requested_by, status, decided_by, decided_at)
  VALUES ('00000000-0000-0000-0000-00000017a001','REINSTATE_MEDIA','00000000-0000-0000-0000-00000017d001','{}',
          '00000000-0000-0000-0000-00000017e001','APPROVED','00000000-0000-0000-0000-00000017e002', now())$$,
  'CL023', NULL, 'demande inscrite déjà approuvée : refusée');

-- Demande approuvée par un valideur inventé (decide_approval_request ne connaît pas les personnes) : la sortie est
-- refusée, que l'appel cite ce valideur inventé ou le vrai superviseur.
SAVEPOINT invented;
SELECT is((SELECT status FROM decide_approval_request('00000000-0000-0000-0000-00000017f001',
  '00000000-0000-0000-0000-0000001700ff', true)), 'APPROVED', 'décision par un valideur inventé (acceptée par la fonction de décision)');
SELECT throws_ok($$SELECT reinstate_media('00000000-0000-0000-0000-00000017d001','00000000-0000-0000-0000-00000017e001',
  '00000000-0000-0000-0000-0000001700ff','x')$$, 'CL020', NULL, 'demande approuvée avec un valideur inventé : sortie refusée');
SELECT throws_ok($$SELECT reinstate_media('00000000-0000-0000-0000-00000017d001','00000000-0000-0000-0000-00000017e001',
  '00000000-0000-0000-0000-00000017e002','x')$$, 'CL020', NULL, 'valideur de l''appel différent de celui de la demande : refusé');
ROLLBACK TO SAVEPOINT invented;

-- Demande approuvée par un caissier (personne réelle, non SUPERVISOR) : refusée.
SAVEPOINT cashier;
SELECT is((SELECT status FROM decide_approval_request('00000000-0000-0000-0000-00000017f001',
  '00000000-0000-0000-0000-00000017e003', true)), 'APPROVED', 'décision par un caissier');
SELECT throws_ok($$SELECT reinstate_media('00000000-0000-0000-0000-00000017d001','00000000-0000-0000-0000-00000017e001',
  '00000000-0000-0000-0000-00000017e003','x')$$, 'CL020', NULL, 'valideur non SUPERVISOR : refusé');
ROLLBACK TO SAVEPOINT cashier;

-- Demande approuvée par le bon valideur : un UPDATE direct reste refusé, même avec les réglages posés.
SELECT is((SELECT status FROM decide_approval_request('00000000-0000-0000-0000-00000017f001',
  '00000000-0000-0000-0000-00000017e002', true)), 'APPROVED', 'décision par le second superviseur');
SELECT set_config('app.user_id', '00000000-0000-0000-0000-00000017e001', true);
SELECT set_config('app.approved_by', '00000000-0000-0000-0000-00000017e002', true);
SELECT throws_ok($$UPDATE media SET status = 'ACTIVE' WHERE id = '00000000-0000-0000-0000-00000017d001'$$,
  'CL020', NULL, 'UPDATE direct BLACKLISTED -> ACTIVE depuis cashless_app : refusé');
SELECT throws_ok($$SELECT media_set_status('00000000-0000-0000-0000-00000017d001', 'ACTIVE', 'x',
  '00000000-0000-0000-0000-00000017e001')$$, 'CL020', NULL, 'media_set_status BLACKLISTED -> ACTIVE : refusé');
SELECT throws_ok($$SELECT reinstate_media('00000000-0000-0000-0000-00000017d001','00000000-0000-0000-0000-00000017e002',
  '00000000-0000-0000-0000-00000017e001','x')$$, 'CL020', NULL, 'auteur et valideur inversés : refusé');

-- Autre prestataire : rien n'est visible.
SELECT set_config('app.operator_id', '00000000-0000-0000-0000-00000017a002', true);
SELECT throws_ok($$SELECT reinstate_media('00000000-0000-0000-0000-00000017d001','00000000-0000-0000-0000-00000017e001',
  '00000000-0000-0000-0000-00000017e002','x')$$, 'P0002', NULL, 'autre prestataire : introuvable');
SELECT set_config('app.operator_id', '00000000-0000-0000-0000-00000017a001', true);

-- 3. Chemin nominal ----------------------------------------------------------------------------------------------------
SELECT lives_ok($$SELECT reinstate_media('00000000-0000-0000-0000-00000017d001','00000000-0000-0000-0000-00000017e001',
  '00000000-0000-0000-0000-00000017e002','enquête close')$$, 'chemin nominal : sortie avec la demande approuvée');
SELECT is((SELECT status FROM media WHERE id = '00000000-0000-0000-0000-00000017d001'), 'ACTIVE', 'bracelet remis en service');
SELECT is((SELECT actor_id::text || ' ' || approved_by::text FROM media_status_history
            WHERE media_id = '00000000-0000-0000-0000-00000017d001' ORDER BY id DESC LIMIT 1),
  '00000000-0000-0000-0000-00000017e001 00000000-0000-0000-0000-00000017e002', 'historique : auteur et valideur');
SELECT is(current_setting('app.reinstate_media', true), '', 'marqueur retiré après l''appel');

-- 4. Demande approuvée d'un épisode passé : ne couvre pas une nouvelle mise en liste noire -------------------------------
UPDATE media SET status = 'BLACKLISTED' WHERE id = '00000000-0000-0000-0000-00000017d001';
SELECT throws_ok($$SELECT reinstate_media('00000000-0000-0000-0000-00000017d001','00000000-0000-0000-0000-00000017e001',
  '00000000-0000-0000-0000-00000017e002','encore')$$, 'CL020', NULL, 'demande d''un épisode passé (toujours APPROVED) : refusée');

-- 4 bis. L'historique ne se réécrit pas (lot 20, cycle 4 ; relecture du 15/10/2026). Contournement relevé : masquer
-- la mise en liste noire en cours, pour que la demande de l'épisode passé redevienne « concordante ».
SELECT throws_ok($$UPDATE media_status_history SET to_status = 'X'
  WHERE id = (SELECT max(id) FROM media_status_history
               WHERE media_id = '00000000-0000-0000-0000-00000017d001' AND to_status = 'BLACKLISTED')$$,
  '42501', NULL, 'cashless_app : UPDATE sur media_status_history refusé (masquer l''épisode en cours)');
SELECT throws_ok($$DELETE FROM media_status_history
  WHERE id = (SELECT max(id) FROM media_status_history
               WHERE media_id = '00000000-0000-0000-0000-00000017d001' AND to_status = 'BLACKLISTED')$$,
  '42501', NULL, 'cashless_app : DELETE sur media_status_history refusé');
SELECT throws_ok($$SELECT reinstate_media('00000000-0000-0000-0000-00000017d001','00000000-0000-0000-0000-00000017e001',
  '00000000-0000-0000-0000-00000017e002','réutilisation')$$, 'CL020', NULL,
  'après la tentative de masquer l''historique, la demande de l''épisode passé reste refusée');
SELECT is((SELECT status FROM media WHERE id = '00000000-0000-0000-0000-00000017d001'), 'BLACKLISTED',
  'le bracelet reste en liste noire');

-- 4 ter. Les passages autorisés ne s'écrivent pas : sinon BLACKLISTED -> ISSUED -> ACTIVE contourne la règle.
SELECT throws_ok($$INSERT INTO media_transition VALUES ('BLACKLISTED','ISSUED')$$, '42501', NULL,
  'cashless_app : INSERT sur media_transition refusé');
SELECT throws_ok($$UPDATE media_transition SET to_status = 'ISSUED' WHERE from_status = 'BLACKLISTED' AND to_status = 'RETIRED'$$,
  '42501', NULL, 'cashless_app : UPDATE sur media_transition refusé');
SELECT throws_ok($$UPDATE media SET status = 'ISSUED' WHERE id = '00000000-0000-0000-0000-00000017d001'$$, 'CL020', NULL,
  'BLACKLISTED -> ISSUED : refusé (aucun détour par un autre état)');

-- 4 quinquies. Aucune ligne plantée dans les historiques (lot 20, cycle 5 ; relecture du 15/10/2026, scénario
-- « pin »). Contournement relevé : une fausse mise en liste noire d'identifiant très grand fige l'épisode « en cours »
-- (max(id)) ; une demande approuvée pour cet épisode reste alors réutilisable après une nouvelle mise en liste noire.
-- Contrôle du contrôle : avec INSERT rendu à cashless_app sur media_status_history, l'insertion passe, la ligne reste,
-- la demande f002 porte l'épisode planté et la réutilisation finale réussit : les tests ci-dessous échouent.
SELECT throws_ok($$INSERT INTO media_status_history (id, operator_id, media_id, from_status, to_status)
  VALUES (9000000000000000, '00000000-0000-0000-0000-00000017a001','00000000-0000-0000-0000-00000017d001','ACTIVE','BLACKLISTED')$$,
  '42501', NULL, 'cashless_app : INSERT direct dans media_status_history refusé (ligne plantée)');
SELECT throws_ok($$INSERT INTO media_batch_status_history (operator_id, batch_id, from_status, to_status)
  VALUES ('00000000-0000-0000-0000-00000017a001','00000000-0000-0000-0000-000000179001','ORDERED','CLOSED')$$,
  '42501', NULL, 'cashless_app : INSERT direct dans media_batch_status_history refusé');
-- Épisode en cours (2) : demande légitime calculée par max(id), décidée par le vrai second superviseur, exécutée.
SELECT pg_temp.ask('00000000-0000-0000-0000-00000017f002');
SELECT is((SELECT payload->>'blacklist_history_id' FROM approval_request WHERE id = '00000000-0000-0000-0000-00000017f002'),
          (SELECT max(id)::text FROM media_status_history WHERE media_id = '00000000-0000-0000-0000-00000017d001'
              AND to_status = 'BLACKLISTED' AND id < 9000000000000000),
  'demande de l''épisode en cours : elle porte la vraie mise en liste noire (aucune ligne plantée)');
SELECT is((SELECT status FROM decide_approval_request('00000000-0000-0000-0000-00000017f002',
  '00000000-0000-0000-0000-00000017e002', true)), 'APPROVED', 'épisode 2 : décision par le second superviseur');
SELECT is((SELECT count(*) FROM media_status_history WHERE media_id = '00000000-0000-0000-0000-00000017d001')::int, 4,
  'avant la sortie : quatre lignes d''historique (ACTIVE, BLACKLISTED, ACTIVE, BLACKLISTED), aucune plantée');
SELECT lives_ok($$SELECT reinstate_media('00000000-0000-0000-0000-00000017d001','00000000-0000-0000-0000-00000017e001',
  '00000000-0000-0000-0000-00000017e002','épisode 2 clos')$$, 'épisode 2 : sortie avec sa demande approuvée');
-- Passage normal depuis cashless_app : l'historique s'écrit toujours (déclencheur), avec l'identifiant de la séquence.
SELECT is((SELECT to_status || ' ' || actor_id::text || ' ' || approved_by::text || ' ' || (id < 9000000000000000)::text
             FROM media_status_history WHERE media_id = '00000000-0000-0000-0000-00000017d001' ORDER BY id DESC LIMIT 1),
  'ACTIVE 00000000-0000-0000-0000-00000017e001 00000000-0000-0000-0000-00000017e002 true',
  'passage normal depuis cashless_app : historique écrit par le déclencheur');
-- La demande f002 n'est pas passée EXECUTED (l'API ne le fait pas ici) ; nouvel épisode de liste noire (3).
SELECT set_config('app.user_id', '00000000-0000-0000-0000-00000017e001', true);
SELECT set_config('app.approved_by', '', true);
UPDATE media SET status = 'BLACKLISTED' WHERE id = '00000000-0000-0000-0000-00000017d001';
SELECT is((SELECT count(*) FROM media_status_history WHERE media_id = '00000000-0000-0000-0000-00000017d001'
              AND id >= 9000000000000000)::int, 0, 'aucune ligne plantée dans l''historique');
SELECT throws_ok($$SELECT reinstate_media('00000000-0000-0000-0000-00000017d001','00000000-0000-0000-0000-00000017e001',
  '00000000-0000-0000-0000-00000017e002','réutilisation')$$, 'CL020', NULL,
  'scénario « pin » : la demande de l''épisode 2 (toujours APPROVED) ne couvre pas l''épisode 3');
SELECT is((SELECT status FROM media WHERE id = '00000000-0000-0000-0000-00000017d001'), 'BLACKLISTED',
  'scénario « pin » : le bracelet reste en liste noire');
-- Historique des lots : le passage normal depuis cashless_app s'écrit toujours.
SELECT set_config('app.reason', 'personnalisé', true);
UPDATE media_batch SET status = 'PERSONALIZED' WHERE id = '00000000-0000-0000-0000-000000179001';
SELECT set_config('app.reason', '', true);
SELECT is((SELECT string_agg(coalesce(from_status, '-') || '>' || to_status || ':' || coalesce(actor_id::text, '-'), ' '
                             ORDER BY id)
             FROM media_batch_status_history WHERE batch_id = '00000000-0000-0000-0000-000000179001'),
  '->ORDERED:- ORDERED>PERSONALIZED:00000000-0000-0000-0000-00000017e001',
  'passage de lot depuis cashless_app : historique écrit par le déclencheur');
-- Rattachements et configurations servies : jamais écrits directement par l'API.
SELECT throws_ok($$INSERT INTO media_assignment (operator_id, media_id, wallet_id, currency, token_hash, released_at)
  VALUES ('00000000-0000-0000-0000-00000017a001','00000000-0000-0000-0000-00000017d001',
          '00000000-0000-0000-0000-00000017c001','XOF', '\x00', now())$$,
  '42501', NULL, 'cashless_app : INSERT dans media_assignment refusé (clés preload/deposit, portefeuille débité)');
SELECT throws_ok($$UPDATE media_assignment SET released_at = NULL WHERE media_id = '00000000-0000-0000-0000-00000017d001'$$,
  '42501', NULL, 'cashless_app : UPDATE sur media_assignment refusé');
RESET ROLE;

-- 4 quater. Droits du rôle de l'API sur les historiques et les règles de passage : la liste exacte, pour qu'un droit
-- rendu plus tard (nouveau GRANT, rejeu de roles.sql sans post-roles.sql) fasse échouer la suite.
SELECT is((SELECT coalesce(string_agg(t || ':' || p, ', ' ORDER BY t, p), '')
             FROM unnest(ARRAY['media_status_history','media_batch_status_history','media_identity_history',
                               'media_transition','media_batch_transition','event_status_transition',
                               'handover_transition']) t,
                  unnest(ARRAY['UPDATE','DELETE','TRUNCATE']) p
            WHERE has_table_privilege('cashless_app', t, p)
               OR EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = t::regclass AND a.attnum > 0
                            AND NOT a.attisdropped AND p = 'UPDATE'
                            AND has_column_privilege('cashless_app', t, a.attname, p))),
  '', 'cashless_app : ni UPDATE (même par colonne), ni DELETE, ni TRUNCATE sur les historiques et les passages');
SELECT is((SELECT coalesce(string_agg(t, ', ' ORDER BY t), '')
             FROM unnest(ARRAY['media_transition','media_batch_transition','event_status_transition',
                               'handover_transition']) t
            WHERE has_table_privilege('cashless_app', t, 'INSERT')),
  '', 'cashless_app : aucun INSERT sur les règles de passage');
SELECT ok(NOT has_table_privilege('cashless_app', 'media_identity_history', 'INSERT'),
  'cashless_app : aucun INSERT sur media_identity_history (écrite par reassign_pool_media seule)');
SELECT is((SELECT coalesce(string_agg(r || ':' || t || ':' || p, ', ' ORDER BY r, t, p), '')
             FROM unnest(ARRAY['cashless_app','cashless_perso','cashless_tagkeys','cashless_tagcheck',
                               'cashless_keyadmin','cashless_platform']) r,
                  unnest(ARRAY['media_status_history','media_batch_status_history','media_assignment',
                               'device_config_served']) t,
                  unnest(ARRAY['INSERT','UPDATE']) p
            WHERE has_table_privilege(r, t, p)
               OR EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = t::regclass AND a.attnum > 0
                            AND NOT a.attisdropped AND has_column_privilege(r, t, a.attname, p))),
  '', 'aucun rôle de l''application n''écrit les historiques de statut, les rattachements ni les configurations servies (0018)');
SELECT is((SELECT string_agg(a.attname, ', ' ORDER BY a.attname) FROM pg_attribute a
            WHERE a.attrelid = 'claim_code'::regclass AND a.attnum > 0 AND NOT a.attisdropped
              AND has_column_privilege('cashless_app', 'claim_code', a.attname, 'UPDATE')),
  'invalidated_at', 'cashless_app : UPDATE sur claim_code limité à l''invalidation (association : associate_claim_code, 0019)');
SELECT is((SELECT string_agg(a.attname, ', ' ORDER BY a.attname) FROM pg_attribute a
            WHERE a.attrelid = 'media_claim'::regclass AND a.attnum > 0 AND NOT a.attisdropped
              AND has_column_privilege('cashless_app', 'media_claim', a.attname, 'UPDATE')),
  'attempts, confirmed_at, confirmed_by, confirmed_device_id, confirmed_tap_id, status',
  'cashless_app : UPDATE sur media_claim limité aux colonnes des fonctions');

-- 5. Session du propriétaire : règle du schéma de référence (deux personnes distinctes) --------------------------------
SELECT ok(media_owner_session(), 'session de test : propriétaire du schéma');
SELECT lives_ok($$SELECT reinstate_media('00000000-0000-0000-0000-00000017d001','00000000-0000-0000-0000-00000017e001',
  '00000000-0000-0000-0000-00000017e002','reprise')$$, 'propriétaire : règle du schéma de référence seule');

SELECT * FROM finish();
ROLLBACK;
