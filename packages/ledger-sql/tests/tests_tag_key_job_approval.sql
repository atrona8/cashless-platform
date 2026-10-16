-- Travaux de clé nés d'une demande approuvée à deux seulement (migration 0020 ; revue post-fusion
-- de la mission bracelets-nfc, constat SEC-1 ; ADR-102) — pgTAP, écrit à la main.
-- Lancer : pg_prove -d <base> tests/tests_tag_key_job_approval.sql (base créée par les migrations,
-- roles.sql et post-roles.sql rejoués).
\set ON_ERROR_STOP 1
\set QUIET 1
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

-- Identifiants : pg_temp.id('20a001') = '00000000-0000-0000-0000-00000020a001'.
CREATE FUNCTION pg_temp.id(p text) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT ('00000000-0000-0000-0000-' || lpad(p, 12, '0'))::uuid $$;

-- Données (propriétaire) ------------------------------------------------------------------------
INSERT INTO party (kind, legal_name) SELECT 'PLATFORM', 'Plateforme (test)'
 WHERE NOT EXISTS (SELECT 1 FROM party WHERE kind = 'PLATFORM');
INSERT INTO party (id, kind, legal_name, country_code) VALUES
 (pg_temp.id('20a001'), 'OPERATOR', 'Prestataire A', 'SN'),
 (pg_temp.id('20a002'), 'OPERATOR', 'Prestataire B', 'CI');
INSERT INTO party (id, kind, operator_id, legal_name) VALUES
 (pg_temp.id('20b001'), 'ORGANIZER', pg_temp.id('20a001'), 'Organisateur A');
INSERT INTO jurisdiction_profile (id, country_code, version, valid_from, breakage_destination)
VALUES (pg_temp.id('20c001'), 'SN', 200020, '2026-01-01', 'ORGANIZER');
INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone, jurisdiction_id,
                   funds_holder) VALUES
 (pg_temp.id('20d001'), pg_temp.id('20a001'), pg_temp.id('20b001'), 'Événement A', 'XOF',
  'Africa/Dakar', pg_temp.id('20c001'), 'ORGANIZER');
-- A : clé 1 partagée active (et sa clé de données), clé 2 dédiée active ; B : clé 1 partagée.
INSERT INTO tag_key (operator_id, key_index, kms_key_ref, scope, dedicated_event_id) VALUES
 (pg_temp.id('20a001'), 1, 'test:a1', 'SHARED', NULL),
 (pg_temp.id('20a001'), 2, 'test:a2', 'DEDICATED', pg_temp.id('20d001')),
 (pg_temp.id('20a002'), 1, 'test:b1', 'SHARED', NULL);
INSERT INTO tag_data_key (id, operator_id, key_index, version, wrapping_kms_key_ref,
                          encrypted_dek) VALUES
 (pg_temp.id('20f001'), pg_temp.id('20a001'), 1, 1, 'test:wrap', '\xdeadbeef');
-- Personnes : e001 et e002 OPERATOR_ADMIN de A ; e003 de A sans rôle ; e011 et e012
-- OPERATOR_ADMIN de B.
INSERT INTO app_user (id, operator_id, issuer, subject, email, display_name)
SELECT pg_temp.id(u), pg_temp.id(o), 'https://idp.test', 's' || u, u || '@test', 'Personne ' || u
  FROM (VALUES ('20e001', '20a001'), ('20e002', '20a001'), ('20e003', '20a001'),
               ('20e011', '20a002'), ('20e012', '20a002')) AS v(u, o);
INSERT INTO role_assignment (user_id, role, scope_type, scope_id, granted_by)
SELECT pg_temp.id(u), 'OPERATOR_ADMIN', 'OPERATOR', pg_temp.id(o), NULL
  FROM (VALUES ('20e001', '20a001'), ('20e002', '20a001'),
               ('20e011', '20a002'), ('20e012', '20a002')) AS v(u, o);

-- Demande (PENDING), décision par decide_approval_request et exécution notée, comme l'API.
CREATE FUNCTION pg_temp.request(p_id text, p_operator text, p_action text, p_payload jsonb)
RETURNS void LANGUAGE sql AS $$
  INSERT INTO approval_request (id, operator_id, action, payload, requested_by)
  VALUES (pg_temp.id(p_id), pg_temp.id(p_operator), p_action,
          p_payload || jsonb_build_object('operator_id', pg_temp.id(p_operator)),
          CASE p_operator WHEN '20a001' THEN pg_temp.id('20e001') ELSE pg_temp.id('20e011') END)
$$;
CREATE FUNCTION pg_temp.approve(p_id text, p_by text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('app.operator_id',
                     (SELECT operator_id::text FROM approval_request WHERE id = pg_temp.id(p_id)),
                     true);
  PERFORM decide_approval_request(pg_temp.id(p_id), pg_temp.id(p_by), true, NULL);
END $$;
CREATE FUNCTION pg_temp.executed(p_id text, p_job uuid, p_index int) RETURNS void
LANGUAGE sql AS $$
  UPDATE approval_request
     SET status = 'EXECUTED', result = jsonb_build_object('job_id', p_job, 'key_index', p_index)
   WHERE id = pg_temp.id(p_id)
$$;
CREATE FUNCTION pg_temp.a() RETURNS void LANGUAGE sql AS
  $$ SELECT set_config('app.operator_id', pg_temp.id('20a001')::text, true) $$;
CREATE FUNCTION pg_temp.b() RETURNS void LANGUAGE sql AS
  $$ SELECT set_config('app.operator_id', pg_temp.id('20a002')::text, true) $$;
-- Identifiants des travaux, lus par le propriétaire quel que soit le rôle courant (politiques par
-- sorte de travail).
CREATE FUNCTION pg_temp.job(p_approval text) RETURNS uuid LANGUAGE sql SECURITY DEFINER AS $$
  SELECT id FROM tag_key_job
   WHERE approval_request_id = pg_temp.id(p_approval) AND parent_job_id IS NULL
$$;
CREATE FUNCTION pg_temp.child(p_parent uuid) RETURNS uuid LANGUAGE sql SECURITY DEFINER AS
  $$ SELECT id FROM tag_key_job WHERE parent_job_id = p_parent $$;

-- Demandes de A (auteur e001) : 9001 création partagée, 9002 rotation de la clé 1, 9003 retrait de
-- la clé 2, 9004 retrait de la clé 1 (partagée), 9005 création décidée par une personne sans rôle,
-- 9006 action étrangère aux clés, 9008 rotation refusée par le valideur. Demande de B (auteur
-- e011) : 9011 rotation.
SELECT pg_temp.request('209001', '20a001', 'TAG_KEY_CREATE',
                       '{"scope":"SHARED","dedicated_event_id":null}');
SELECT pg_temp.request('209002', '20a001', 'TAG_DEK_ROTATE', '{"key_index":1}');
SELECT pg_temp.request('209003', '20a001', 'TAG_KEY_RETIRE', '{"key_index":2}');
SELECT pg_temp.request('209004', '20a001', 'TAG_KEY_RETIRE', '{"key_index":1}');
SELECT pg_temp.request('209005', '20a001', 'TAG_KEY_CREATE',
                       '{"scope":"SHARED","dedicated_event_id":null}');
SELECT pg_temp.request('209006', '20a001', 'ADJUSTMENT', '{"key_index":1}');
SELECT pg_temp.request('209008', '20a001', 'TAG_DEK_ROTATE', '{"key_index":1}');
SELECT pg_temp.request('209011', '20a002', 'TAG_DEK_ROTATE', '{"key_index":1}');

-- 1. Structure et droits ------------------------------------------------------------------------
SELECT is((SELECT count(*)::int FROM pg_proc
            WHERE proname IN ('enqueue_tag_key_job', 'enqueue_tag_key_child_job',
                              'tag_key_job_refusal')
              AND prosecdef AND proconfig @> ARRAY['search_path=public, pg_temp']), 3,
  'trois fonctions SECURITY DEFINER, search_path public, pg_temp');
DROP ROLE IF EXISTS tag_job_probe;
CREATE ROLE tag_job_probe;
CREATE FUNCTION pg_temp.can(p_role text) RETURNS boolean[] LANGUAGE sql AS $$
  SELECT ARRAY[has_function_privilege(p_role, 'enqueue_tag_key_job(uuid)', 'EXECUTE'),
               has_function_privilege(p_role, 'enqueue_tag_key_child_job(uuid,uuid)', 'EXECUTE'),
               has_function_privilege(p_role, 'tag_key_job_refusal(uuid)', 'EXECUTE'),
               has_function_privilege(p_role, 'retire_dedicated_key(uuid,integer)', 'EXECUTE')]
$$;
SELECT is(pg_temp.can('tag_job_probe'), ARRAY[false, false, false, false],
  'aucune des quatre fonctions n''est exécutable par PUBLIC');
SELECT is(pg_temp.can('cashless_app'), ARRAY[true, false, false, false],
  'API : inscription racine seulement ; ni travail suivant, ni retrait direct d''une clé');
SELECT is(pg_temp.can('cashless_perso'), ARRAY[false, true, true, true],
  'personnalisation : travaux suivants, revérification, retrait');
SELECT is(pg_temp.can('cashless_tagkeys'), ARRAY[false, false, true, false],
  'clés de bracelet : revérification seulement');
SELECT is(pg_temp.can('cashless_keyadmin'), ARRAY[false, false, true, false],
  'commande d''administration : revérification seulement');
SELECT is(pg_temp.can('cashless_platform'), ARRAY[false, false, false, false],
  'plateforme : aucune');
SELECT is((SELECT count(*)::int
             FROM unnest(ARRAY['cashless_app', 'cashless_platform', 'cashless_tagkeys',
                               'cashless_perso', 'cashless_tagcheck', 'cashless_keyadmin']) r
            WHERE has_table_privilege(r, 'tag_key_job', 'INSERT')), 0,
  'aucun rôle applicatif ni processus n''insère directement dans tag_key_job');

-- 2. Insertion directe : refusée pour chaque sorte, depuis l'API et la personnalisation ---------
SET LOCAL ROLE cashless_app;
SELECT pg_temp.a();
SELECT throws_ok(format($$INSERT INTO tag_key_job (operator_id, key_index, kind)
                          VALUES (pg_temp.id('20a001'), 1, %L)$$, k),
  '42501', NULL, 'API : INSERT direct d''un travail ' || k || ' sans approbation refusé')
  FROM unnest(ARRAY['CREATE_KEY', 'ROTATE_DEK', 'REENCRYPT', 'RETIRE_KEY', 'DISABLE_KMS_KEY']) k;
SELECT throws_ok($$INSERT INTO tag_key_job (operator_id, key_index, kind, approval_request_id)
                   VALUES (pg_temp.id('20a001'), 1, 'ROTATE_DEK', pg_temp.id('209002'))$$,
  '42501', NULL, 'API : INSERT direct refusé même en citant une demande');
SELECT throws_ok($$SELECT retire_dedicated_key(pg_temp.id('20a001'), 2)$$, '42501', NULL,
  'API : retrait direct d''une clé dédiée refusé (EXECUTE retiré)');
SET LOCAL ROLE cashless_perso;
SELECT throws_ok(format($$INSERT INTO tag_key_job (operator_id, key_index, kind)
                          VALUES (pg_temp.id('20a001'), 2, %L)$$, k),
  '42501', NULL, 'personnalisation : INSERT direct d''un travail ' || k || ' refusé')
  FROM unnest(ARRAY['REENCRYPT', 'DISABLE_KMS_KEY']) k;

-- 3. Inscription d'un travail racine par l'API --------------------------------------------------
SET LOCAL ROLE cashless_app;
SELECT throws_ok($$SELECT enqueue_tag_key_job(pg_temp.id('209001'))$$, 'CL023', NULL,
  'demande PENDING : refusée');
RESET ROLE;
SELECT pg_temp.approve(r, CASE WHEN r = '209005' THEN '20e003' ELSE '20e002' END)
  FROM unnest(ARRAY['209001', '209002', '209003', '209004', '209005', '209006']) r;
SELECT pg_temp.approve('209011', '20e012');
SELECT pg_temp.a();
SELECT decide_approval_request(pg_temp.id('209008'), pg_temp.id('20e002'), false, 'non');
SET LOCAL ROLE cashless_app;
SELECT pg_temp.a();
SELECT is((SELECT ARRAY[kind, key_index::text, status, payload ->> 'scope',
                        payload ->> 'requested_by', payload ->> 'approved_by']
             FROM enqueue_tag_key_job(pg_temp.id('209001'))),
  ARRAY['CREATE_KEY', '3', 'PENDING', 'SHARED', pg_temp.id('20e001')::text,
        pg_temp.id('20e002')::text],
  'chemin nominal : création inscrite, index suivant, auteur et valideur pris dans la demande');
SELECT throws_ok($$SELECT enqueue_tag_key_job(pg_temp.id('209001'))$$, 'CL023', NULL,
  'demande déjà consommée : refusée');
SELECT is((SELECT kind || ':' || key_index FROM enqueue_tag_key_job(pg_temp.id('209002'))),
  'ROTATE_DEK:1', 'chemin nominal : rotation de la clé de la demande');
SELECT is((SELECT kind || ':' || key_index FROM enqueue_tag_key_job(pg_temp.id('209003'))),
  'RETIRE_KEY:2', 'chemin nominal : retrait de la clé dédiée de la demande');
SELECT throws_ok($$SELECT enqueue_tag_key_job(pg_temp.id('209004'))$$, 'CL020', NULL,
  'retrait d''une clé partagée : refusé');
SELECT throws_ok($$SELECT enqueue_tag_key_job(pg_temp.id('209005'))$$, 'CL023', NULL,
  'valideur sans attribution OPERATOR_ADMIN : refusé');
SELECT throws_ok($$SELECT enqueue_tag_key_job(pg_temp.id('209006'))$$, 'CL023', NULL,
  'approbation d''une autre action : refusée');
SELECT throws_ok($$SELECT enqueue_tag_key_job(pg_temp.id('209008'))$$, 'CL023', NULL,
  'demande REJECTED par le second OPERATOR_ADMIN : refusée');
SELECT throws_ok($$SELECT enqueue_tag_key_job(pg_temp.id('209011'))$$, 'P0002', NULL,
  'approbation d''un autre prestataire : refusée (introuvable)');
SELECT pg_temp.b();
SELECT throws_ok($$SELECT enqueue_tag_key_job(pg_temp.id('209002'))$$, 'P0002', NULL,
  'session de B, demande de A : refusée (introuvable)');
SELECT pg_temp.a();
-- L'API note l'exécution de ses demandes (APPROVED -> EXECUTED, avec le résultat) : chemin réel.
SELECT pg_temp.executed('209001', pg_temp.job('209001'), 3);
SELECT pg_temp.executed('209002', pg_temp.job('209002'), 1);
SELECT pg_temp.executed('209003', pg_temp.job('209003'), 2);
SELECT throws_ok($$SELECT enqueue_tag_key_job(pg_temp.id('209002'))$$, 'CL023', NULL,
  'demande déjà EXECUTED : refusée');

-- 4. Travaux suivants, par la personnalisation --------------------------------------------------
SET LOCAL ROLE cashless_perso;
SELECT pg_temp.a();
SELECT throws_ok(format('SELECT enqueue_tag_key_child_job(%L, %L)', pg_temp.job('209002'),
                        pg_temp.id('20f001')),
  'CL020', NULL, 'parent en attente (non pris) : refusé');
SELECT is((SELECT kind
             FROM claim_tag_key_job_for(ARRAY[pg_temp.id('20a001')], ARRAY['ROTATE_DEK'])),
  'ROTATE_DEK', 'la personnalisation prend la rotation');
SELECT throws_ok(format('SELECT enqueue_tag_key_child_job(%L)', pg_temp.job('209002')),
  'CL020', NULL, 'rechiffrement sans clé de données cible : refusé');
SELECT is((SELECT ARRAY[kind, payload ->> 'target_dek_id', payload ->> 'requested_by']
             FROM enqueue_tag_key_child_job(pg_temp.job('209002'), pg_temp.id('20f001'))),
  ARRAY['REENCRYPT', pg_temp.id('20f001')::text, pg_temp.id('20e001')::text],
  'chemin nominal : rechiffrement inscrit pendant la rotation, auteur de la demande reporté');
SELECT throws_ok(format('SELECT enqueue_tag_key_child_job(%L, %L)', pg_temp.job('209002'),
                        pg_temp.id('20f001')),
  'CL023', NULL, 'second travail suivant pour le même parent : refusé');
SELECT is((SELECT kind
             FROM claim_tag_key_job_for(ARRAY[pg_temp.id('20a001')], ARRAY['RETIRE_KEY'])),
  'RETIRE_KEY', 'la personnalisation prend le retrait');
SELECT throws_ok(format('SELECT enqueue_tag_key_child_job(%L)', pg_temp.job('209003')),
  'CL020', NULL, 'désactivation dans le service de clés d''une clé ACTIVE : refusée');
SELECT lives_ok($$SELECT retire_dedicated_key(pg_temp.id('20a001'), 2)$$,
  'la personnalisation retire la clé dédiée (EXECUTE accordé nommément)');
SELECT is((SELECT kind || ':' || key_index
             FROM enqueue_tag_key_child_job(pg_temp.job('209003'))),
  'DISABLE_KMS_KEY:2', 'chemin nominal : désactivation inscrite après le retrait');

-- Parents plantés par le propriétaire (base qui les aurait acceptés) : aucun travail suivant.
RESET ROLE;
INSERT INTO tag_key_job (id, operator_id, key_index, kind, status, started_at, locked_until,
                         approval_request_id)
SELECT pg_temp.id(j), pg_temp.id('20a001'), k, 'ROTATE_DEK', 'RUNNING', now(),
       now() + interval '1 minute', CASE WHEN r IS NOT NULL THEN pg_temp.id(r) END
  FROM (VALUES ('20c001', 7, NULL), ('20c002', 8, '209006')) AS v(j, k, r);
SELECT pg_temp.executed('209006', pg_temp.id('20c002'), 8);
SET LOCAL ROLE cashless_perso;
SELECT pg_temp.a();
SELECT throws_ok($$SELECT enqueue_tag_key_child_job(pg_temp.id('20c001'), pg_temp.id('20f001'))$$,
  'CL023', NULL, 'parent sans demande : refusé');
SELECT throws_ok($$SELECT enqueue_tag_key_child_job(pg_temp.id('20c002'), pg_temp.id('20f001'))$$,
  'CL023', NULL, 'parent dont la demande est d''une autre action : refusé');

-- 5. Revérification par l'exécutant (tag_key_job_refusal) ---------------------------------------
SET LOCAL ROLE cashless_keyadmin;
SELECT pg_temp.a();
SELECT is(tag_key_job_refusal(pg_temp.job('209001')), NULL,
  'chemin nominal : création d''une demande exécutée concordante acceptée');
SELECT is(tag_key_job_refusal(pg_temp.child(pg_temp.job('209003'))),
  'travail parent absent, inachevé ou non concordant',
  'désactivation dont le retrait n''est pas terminé : refusée');
SET LOCAL ROLE cashless_perso;
SELECT pg_temp.a();
SELECT lives_ok(format($$SELECT finish_tag_key_job(%L, 'DONE')$$, pg_temp.job(r)),
  'travail ' || r || ' terminé')
  FROM unnest(ARRAY['209002', '209003']) r;
SET LOCAL ROLE cashless_keyadmin;
SELECT pg_temp.a();
SELECT is(tag_key_job_refusal(pg_temp.child(pg_temp.job('209003'))), NULL,
  'chemin nominal : désactivation d''une clé RETIRED après un retrait approuvé acceptée');
SET LOCAL ROLE cashless_tagkeys;
SELECT pg_temp.a();
SELECT is(tag_key_job_refusal(pg_temp.child(pg_temp.job('209002'))), NULL,
  'chemin nominal : rechiffrement après une rotation approuvée accepté');
SELECT pg_temp.b();
SELECT is(tag_key_job_refusal(pg_temp.child(pg_temp.job('209002'))),
  'travail introuvable pour le prestataire de la session',
  'travail d''un autre prestataire : refusé');

-- Travaux plantés par le propriétaire.
RESET ROLE;
SELECT pg_temp.request('209007', '20a001', 'TAG_KEY_CREATE',
                       '{"scope":"SHARED","dedicated_event_id":null}');
SELECT pg_temp.approve('209007', '20e002');
SELECT pg_temp.executed('209007', pg_temp.id('20cfff'), 40);
UPDATE tag_key SET status = 'ACTIVE' WHERE operator_id = pg_temp.id('20a001') AND key_index = 2;
INSERT INTO tag_key_job (id, operator_id, key_index, kind, payload, approval_request_id)
SELECT pg_temp.id(j), pg_temp.id('20a001'), k, kind, payload::jsonb,
       CASE WHEN r IS NOT NULL THEN pg_temp.id(r) END
  FROM (VALUES ('20c003', 1, 'DISABLE_KMS_KEY', '{}', NULL),
               ('20c004', 40, 'CREATE_KEY', '{"scope":"SHARED"}', '209007'),
               ('20c005', 9, 'REENCRYPT', '{}', NULL)) AS v(j, k, kind, payload, r);
UPDATE tag_key_job
   SET payload = payload || jsonb_build_object('requested_by', pg_temp.id('20e001'),
                                               'approved_by', pg_temp.id('20e002'))
 WHERE id = pg_temp.id('20c004');
SET LOCAL ROLE cashless_keyadmin;
SELECT pg_temp.a();
SELECT is(tag_key_job_refusal(pg_temp.id('20c003')), 'aucune demande d''approbation',
  'désactivation plantée sans demande (clé partagée ACTIVE) : refusée');
SELECT is(tag_key_job_refusal(pg_temp.id('20c004')),
  'le travail n''est pas celui que la demande a produit',
  'création plantée sur une demande qui en a produit une autre : refusée');
SELECT is(tag_key_job_refusal(pg_temp.child(pg_temp.job('209003'))), 'la clé n''est pas retirée',
  'désactivation d''une clé redevenue ACTIVE : refusée');
SET LOCAL ROLE cashless_tagkeys;
SELECT pg_temp.a();
SELECT is(tag_key_job_refusal(pg_temp.id('20c005')), 'aucune demande d''approbation',
  'rechiffrement planté sans rotation : refusé');
RESET ROLE;
SELECT throws_ok($$INSERT INTO tag_key_job (operator_id, key_index, kind, approval_request_id)
                   VALUES (pg_temp.id('20a001'), 41, 'CREATE_KEY', pg_temp.id('209001'))$$,
  '23505', NULL, 'même pour le propriétaire, une demande ne produit pas deux travaux racines');

-- 6. Limite connue : une demande approuvée ne périme pas (OP-N62, ADR-102, complément) -----------
-- enqueue_tag_key_job ne lit pas expires_at : une demande APPROVED dont le délai est dépassé
-- s'inscrit encore, une seule fois. Ce test DOCUMENTE le comportement actuel. La mission 5 doit
-- corriger ce point (refus d'une demande approuvée périmée) ; ce test devra alors être INVERSÉ :
-- l'inscription sera refusée (throws_ok) et la demande restera sans travail.
INSERT INTO approval_request (id, operator_id, action, payload, requested_by, expires_at)
VALUES (pg_temp.id('209020'), pg_temp.id('20a001'), 'TAG_DEK_ROTATE',
        '{"key_index":1}'::jsonb || jsonb_build_object('operator_id', pg_temp.id('20a001')),
        pg_temp.id('20e001'), clock_timestamp() + interval '1 second');
SELECT pg_temp.approve('209020', '20e002');
SELECT pg_sleep(1.3);
SELECT ok((SELECT clock_timestamp() > expires_at AND status = 'APPROVED'
             FROM approval_request WHERE id = pg_temp.id('209020')),
  'demande approuvée dont expires_at est dépassé');
SET LOCAL ROLE cashless_app;
SELECT pg_temp.a();
SELECT is((SELECT kind || ':' || key_index FROM enqueue_tag_key_job(pg_temp.id('209020'))),
  'ROTATE_DEK:1',
  'LIMITE ACTUELLE (OP-N62) : une demande approuvée périmée est encore acceptée');
SELECT throws_ok($$SELECT enqueue_tag_key_job(pg_temp.id('209020'))$$, 'CL023', NULL,
  'LIMITE ACTUELLE (OP-N62) : acceptée une seule fois, la seconde inscription est refusée');
RESET ROLE;

-- 7. Droits de cashless_app sur device, colonne par colonne (OP-N63, ADR-105) ---------------------
-- Fige les droits actuels, y compris UPDATE (agreement_public_key) : limite acceptée jusqu'à la
-- mission 5 (enrôlement réel). Le test échoue si un droit s'élargit. Quand la mission 5 retirera
-- UPDATE (agreement_public_key), retirer cette colonne de la liste attendue ci-dessous.
SELECT is((SELECT array_agg(attname::text ORDER BY attname)
             FROM pg_attribute
            WHERE attrelid = 'device'::regclass AND attnum > 0 AND NOT attisdropped
              AND has_column_privilege('cashless_app', 'device', attname, 'UPDATE')),
  ARRAY['agreement_public_key', 'app_mode', 'cert_sha256', 'event_id', 'last_seen_at',
        'last_snapshot_version', 'next_seq_floor', 'nfc_enabled', 'personal_phone', 'pos_id',
        'public_key', 'station_name', 'status'],
  'cashless_app : UPDATE sur device colonne par colonne, liste exacte (OP-N63)');
SELECT is((SELECT count(*)::int FROM pg_attribute
            WHERE attrelid = 'device'::regclass AND attnum > 0 AND NOT attisdropped
              AND NOT has_column_privilege('cashless_app', 'device', attname, 'INSERT')), 0,
  'cashless_app : INSERT sur toutes les colonnes de device (inchangé)');
SELECT is((SELECT count(*)::int FROM pg_attribute
            WHERE attrelid = 'device'::regclass AND attnum > 0 AND NOT attisdropped
              AND has_column_privilege('cashless_app', 'device', attname, 'REFERENCES')), 0,
  'cashless_app : aucun REFERENCES sur device');
SELECT is(ARRAY[has_table_privilege('cashless_app', 'device', 'UPDATE'),
                has_table_privilege('cashless_app', 'device', 'DELETE'),
                has_table_privilege('cashless_app', 'device', 'TRUNCATE')],
  ARRAY[false, false, false],
  'cashless_app : ni UPDATE de table entière, ni DELETE, ni TRUNCATE sur device');

DROP ROLE tag_job_probe;

SELECT * FROM finish();
ROLLBACK;
