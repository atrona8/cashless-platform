-- Retrait d'une clé dédiée par son seul travail, demande de clé approuvée périmée refusée
-- (migration 0025 ; OP-N62, ADR-102 ; mission 5a, lot WP06) — pgTAP, écrit à la main.
-- Lancer : pg_prove -d <base> tests/tests_tag_key_retire_guard.sql (base créée par les migrations,
-- roles.sql et post-roles.sql rejoués).
\set ON_ERROR_STOP 1
\set QUIET 1
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

-- Identifiants : pg_temp.id('25a001') = '00000000-0000-0000-0000-00000025a001'.
CREATE FUNCTION pg_temp.id(p text) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT ('00000000-0000-0000-0000-' || lpad(p, 12, '0'))::uuid $$;

-- Données (propriétaire) ------------------------------------------------------------------------
INSERT INTO party (kind, legal_name) SELECT 'PLATFORM', 'Plateforme (test)'
 WHERE NOT EXISTS (SELECT 1 FROM party WHERE kind = 'PLATFORM');
INSERT INTO party (id, kind, legal_name, country_code) VALUES
 (pg_temp.id('25a001'), 'OPERATOR', 'Prestataire A', 'SN'),
 (pg_temp.id('25a002'), 'OPERATOR', 'Prestataire B', 'CI');
INSERT INTO party (id, kind, operator_id, legal_name) VALUES
 (pg_temp.id('25b001'), 'ORGANIZER', pg_temp.id('25a001'), 'Organisateur A'),
 (pg_temp.id('25b002'), 'ORGANIZER', pg_temp.id('25a002'), 'Organisateur B');
INSERT INTO jurisdiction_profile (id, country_code, version, valid_from, breakage_destination)
VALUES (pg_temp.id('25c0a1'), 'SN', 250025, '2026-01-01', 'ORGANIZER'),
       (pg_temp.id('25c0a2'), 'CI', 250025, '2026-01-01', 'ORGANIZER');
INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone, jurisdiction_id,
                   funds_holder) VALUES
 (pg_temp.id('25d001'), pg_temp.id('25a001'), pg_temp.id('25b001'), 'Événement A', 'XOF',
  'Africa/Dakar', pg_temp.id('25c0a1'), 'ORGANIZER'),
 (pg_temp.id('25d002'), pg_temp.id('25a002'), pg_temp.id('25b002'), 'Événement B', 'XOF',
  'Africa/Abidjan', pg_temp.id('25c0a2'), 'ORGANIZER');
-- A : clé 1 partagée ; clés 2 (chemin nominal), 3, 5, 6, 7 (refus) et 4 (demande périmée)
-- dédiées. B : clé 2 dédiée.
INSERT INTO tag_key (operator_id, key_index, kms_key_ref, scope, dedicated_event_id) VALUES
 (pg_temp.id('25a001'), 1, 'test:a1', 'SHARED', NULL),
 (pg_temp.id('25a001'), 2, 'test:a2', 'DEDICATED', pg_temp.id('25d001')),
 (pg_temp.id('25a001'), 3, 'test:a3', 'DEDICATED', pg_temp.id('25d001')),
 (pg_temp.id('25a001'), 4, 'test:a4', 'DEDICATED', pg_temp.id('25d001')),
 (pg_temp.id('25a001'), 5, 'test:a5', 'DEDICATED', pg_temp.id('25d001')),
 (pg_temp.id('25a001'), 6, 'test:a6', 'DEDICATED', pg_temp.id('25d001')),
 (pg_temp.id('25a001'), 7, 'test:a7', 'DEDICATED', pg_temp.id('25d001')),
 (pg_temp.id('25a002'), 2, 'test:b2', 'DEDICATED', pg_temp.id('25d002'));
-- Personnes : e001 et e002 OPERATOR_ADMIN de A ; e011 et e012 OPERATOR_ADMIN de B.
INSERT INTO app_user (id, operator_id, issuer, subject, email, display_name)
SELECT pg_temp.id(u), pg_temp.id(o), 'https://idp.test', 's' || u, u || '@test', 'Personne ' || u
  FROM (VALUES ('25e001', '25a001'), ('25e002', '25a001'),
               ('25e011', '25a002'), ('25e012', '25a002')) AS v(u, o);
INSERT INTO role_assignment (user_id, role, scope_type, scope_id, granted_by)
SELECT pg_temp.id(u), 'OPERATOR_ADMIN', 'OPERATOR', pg_temp.id(o), NULL
  FROM (VALUES ('25e001', '25a001'), ('25e002', '25a001'),
               ('25e011', '25a002'), ('25e012', '25a002')) AS v(u, o);

-- Demande (PENDING) de l'auteur e001 (A) ou e011 (B), décidée par e002 ou e012, comme l'API.
CREATE FUNCTION pg_temp.request(p_id text, p_operator text, p_action text, p_payload jsonb,
                                p_expires timestamptz DEFAULT NULL)
RETURNS void LANGUAGE sql AS $$
  INSERT INTO approval_request (id, operator_id, action, payload, requested_by, expires_at)
  VALUES (pg_temp.id(p_id), pg_temp.id(p_operator), p_action,
          p_payload || jsonb_build_object('operator_id', pg_temp.id(p_operator)),
          CASE p_operator WHEN '25a001' THEN pg_temp.id('25e001') ELSE pg_temp.id('25e011') END,
          coalesce(p_expires, clock_timestamp() + interval '24 hours'))
$$;
CREATE FUNCTION pg_temp.approve(p_id text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_operator uuid := (SELECT operator_id FROM approval_request WHERE id = pg_temp.id(p_id));
BEGIN
  PERFORM set_config('app.operator_id', v_operator::text, true);
  PERFORM decide_approval_request(pg_temp.id(p_id),
            CASE WHEN v_operator = pg_temp.id('25a001') THEN pg_temp.id('25e002')
                 ELSE pg_temp.id('25e012') END, true, NULL);
END $$;
CREATE FUNCTION pg_temp.executed(p_id text, p_job uuid, p_index int) RETURNS void
LANGUAGE sql AS $$
  UPDATE approval_request
     SET status = 'EXECUTED', result = jsonb_build_object('job_id', p_job, 'key_index', p_index)
   WHERE id = pg_temp.id(p_id)
$$;
-- Travail planté par le propriétaire (base qui l'aurait accepté), auteur et valideur de A ou B.
CREATE FUNCTION pg_temp.plant(p_job text, p_operator text, p_index int, p_kind text,
                              p_status text, p_request text, p_parent uuid DEFAULT NULL)
RETURNS void LANGUAGE sql AS $$
  INSERT INTO tag_key_job (id, operator_id, key_index, kind, status, payload, started_at,
                           locked_until, finished_at, approval_request_id, parent_job_id)
  SELECT pg_temp.id(p_job), pg_temp.id(p_operator), p_index, p_kind, p_status,
         CASE p_operator
           WHEN '25a001' THEN jsonb_build_object('requested_by', pg_temp.id('25e001'),
                                                 'approved_by', pg_temp.id('25e002'))
           ELSE jsonb_build_object('requested_by', pg_temp.id('25e011'),
                                   'approved_by', pg_temp.id('25e012')) END,
         CASE WHEN p_status <> 'PENDING' THEN now() END,
         CASE WHEN p_status <> 'PENDING' THEN now() + interval '10 minutes' END,
         CASE WHEN p_status = 'DONE' THEN now() END,
         CASE WHEN p_request IS NOT NULL THEN pg_temp.id(p_request) END, p_parent
$$;
CREATE FUNCTION pg_temp.a() RETURNS void LANGUAGE sql AS
  $$ SELECT set_config('app.operator_id', pg_temp.id('25a001')::text, true) $$;
CREATE FUNCTION pg_temp.b() RETURNS void LANGUAGE sql AS
  $$ SELECT set_config('app.operator_id', pg_temp.id('25a002')::text, true) $$;
-- Lectures du propriétaire, quel que soit le rôle courant (politiques par sorte de travail).
CREATE FUNCTION pg_temp.job(p_approval text) RETURNS uuid LANGUAGE sql SECURITY DEFINER AS $$
  SELECT id FROM tag_key_job
   WHERE approval_request_id = pg_temp.id(p_approval) AND parent_job_id IS NULL
$$;
CREATE FUNCTION pg_temp.key_status(p_operator text, p_index int) RETURNS text
LANGUAGE sql SECURITY DEFINER AS $$
  SELECT status FROM tag_key WHERE operator_id = pg_temp.id(p_operator) AND key_index = p_index
$$;

-- 1. Structure et droits ------------------------------------------------------------------------
SELECT is((SELECT count(*)::int FROM pg_proc
            WHERE proname IN ('retire_dedicated_key_for_job', 'enqueue_tag_key_job')
              AND prosecdef AND proconfig @> ARRAY['search_path=public, pg_temp']), 2,
  'retrait par travail et inscription : SECURITY DEFINER, search_path public, pg_temp');
SELECT is((SELECT count(DISTINCT proowner)::int FROM pg_proc
            WHERE proname IN ('retire_dedicated_key_for_job', 'enqueue_tag_key_job',
                              'tag_key_job_refusal', 'retire_dedicated_key')), 1,
  'propriétaire inchangé : celui des fonctions de 0020 et du schéma de référence');
DROP ROLE IF EXISTS retire_guard_probe;
CREATE ROLE retire_guard_probe;
CREATE FUNCTION pg_temp.can(p_role text) RETURNS boolean[] LANGUAGE sql AS $$
  SELECT ARRAY[has_function_privilege(p_role, 'retire_dedicated_key_for_job(uuid)', 'EXECUTE'),
               has_function_privilege(p_role, 'enqueue_tag_key_job(uuid)', 'EXECUTE')]
$$;
SELECT is(pg_temp.can('retire_guard_probe'), ARRAY[false, false],
  'PUBLIC : ni retrait par travail, ni inscription');
SELECT is(pg_temp.can('cashless_app'), ARRAY[false, true],
  'API : inscription conservée après CREATE OR REPLACE ; pas de retrait');
SELECT is(pg_temp.can('cashless_perso'), ARRAY[true, false],
  'personnalisation : retrait par travail seulement');
SELECT is(pg_temp.can('cashless_tagkeys'), ARRAY[false, false], 'clés de bracelet : aucune');
SELECT is(pg_temp.can('cashless_keyadmin'), ARRAY[false, false],
  'commande d''administration : aucune');
SELECT is(pg_temp.can('cashless_platform'), ARRAY[false, false], 'plateforme : aucune');
SELECT is((SELECT count(*)::int
             FROM unnest(ARRAY['cashless_app', 'cashless_platform', 'cashless_tagkeys',
                               'cashless_perso', 'cashless_tagcheck', 'cashless_keyadmin']) r
            WHERE has_table_privilege(r, 'tag_key_job', 'INSERT')), 0,
  'INSERT sur tag_key_job toujours fermé à tout rôle applicatif ou processus');

-- 2. Demande approuvée : non périmée acceptée, périmée refusée (CL023) ---------------------------
SELECT pg_temp.request('259001', '25a001', 'TAG_KEY_RETIRE', '{"key_index":2}');
SELECT pg_temp.request('259002', '25a001', 'TAG_KEY_RETIRE', '{"key_index":4}',
                       clock_timestamp() + interval '1 second');
SELECT pg_temp.approve(r) FROM unnest(ARRAY['259001', '259002']) r;
SELECT pg_sleep(1.3);
SELECT ok((SELECT clock_timestamp() > expires_at AND status = 'APPROVED'
             FROM approval_request WHERE id = pg_temp.id('259002')),
  'demande 259002 approuvée, expires_at dépassé');
SET LOCAL ROLE cashless_app;
SELECT pg_temp.a();
SELECT throws_ok($$SELECT enqueue_tag_key_job(pg_temp.id('259002'))$$, 'CL023',
  'Travail de clé : demande approuvée périmée', 'demande approuvée périmée : refusée (CL023)');
SELECT is((SELECT kind || ':' || key_index FROM enqueue_tag_key_job(pg_temp.id('259001'))),
  'RETIRE_KEY:2', 'demande approuvée non périmée : acceptée');
RESET ROLE;
SELECT is((SELECT count(*)::int FROM tag_key_job
            WHERE approval_request_id = pg_temp.id('259002')), 0,
  'la demande périmée reste sans travail');
SELECT pg_temp.executed('259001', pg_temp.job('259001'), 2);

-- 3. Chemin nominal : retrait par le travail en cours ------------------------------------------
SET LOCAL ROLE cashless_perso;
SELECT pg_temp.a();
SELECT is((SELECT id FROM claim_tag_key_job_for(ARRAY[pg_temp.id('25a001')], ARRAY['RETIRE_KEY'])),
  pg_temp.job('259001'), 'la personnalisation prend le retrait (RUNNING)');
SELECT is(retire_dedicated_key_for_job(pg_temp.job('259001')), 0,
  'chemin nominal : clé dédiée retirée par son travail en cours (aucun bracelet)');
SELECT is(pg_temp.key_status('25a001', 2), 'RETIRED', 'la clé 2 de A est retirée');
SELECT lives_ok(format($$SELECT finish_tag_key_job(%L, 'DONE')$$, pg_temp.job('259001')),
  'travail de retrait terminé');
SELECT throws_ok(format('SELECT retire_dedicated_key_for_job(%L)', pg_temp.job('259001')),
  'CL020', NULL, 'travail terminé (DONE) : rejeu refusé');

-- 4. Refus ---------------------------------------------------------------------------------------
-- Travaux plantés par le propriétaire sur les clés 3, 5, 6 et 7 de A (un seul travail ouvert par
-- clé et par sorte, index tag_key_job_one_open), et sur la clé 2 de B.
RESET ROLE;
--   259003 approuvée, jamais exécutée ; 259004 exécutée, travail en attente ; 259005 rotation
--   exécutée ; 259006 exécutée pour un autre travail ; 259011 de B, exécutée.
SELECT pg_temp.request('259003', '25a001', 'TAG_KEY_RETIRE', '{"key_index":3}');
SELECT pg_temp.request('259004', '25a001', 'TAG_KEY_RETIRE', '{"key_index":5}');
SELECT pg_temp.request('259005', '25a001', 'TAG_DEK_ROTATE', '{"key_index":3}');
SELECT pg_temp.request('259006', '25a001', 'TAG_KEY_RETIRE', '{"key_index":7}');
SELECT pg_temp.request('259011', '25a002', 'TAG_KEY_RETIRE', '{"key_index":2}');
SELECT pg_temp.approve(r)
  FROM unnest(ARRAY['259003', '259004', '259005', '259006', '259011']) r;
SELECT pg_temp.plant('25f001', '25a001', 3, 'RETIRE_KEY', 'RUNNING', '259003');
SELECT pg_temp.plant('25f002', '25a001', 5, 'RETIRE_KEY', 'PENDING', '259004');
SELECT pg_temp.plant('25f003', '25a001', 3, 'ROTATE_DEK', 'RUNNING', '259005');
SELECT pg_temp.plant('25f004', '25a001', 6, 'RETIRE_KEY', 'RUNNING', NULL);
SELECT pg_temp.plant('25f005', '25a001', 7, 'RETIRE_KEY', 'RUNNING', '259006');
SELECT pg_temp.plant('25f006', '25a002', 2, 'RETIRE_KEY', 'RUNNING', '259011');
SELECT pg_temp.plant('25f007', '25a001', 2, 'DISABLE_KMS_KEY', 'RUNNING', '259001',
                     pg_temp.job('259001'));
SELECT pg_temp.executed('259004', pg_temp.id('25f002'), 5);
SELECT pg_temp.executed('259005', pg_temp.id('25f003'), 3);
SELECT pg_temp.executed('259006', pg_temp.id('25fff0'), 7);
SELECT pg_temp.executed('259011', pg_temp.id('25f006'), 2);

SET LOCAL ROLE cashless_app;
SELECT pg_temp.a();
SELECT throws_ok($$SELECT retire_dedicated_key_for_job(pg_temp.id('25f001'))$$, '42501', NULL,
  'API : retrait par travail refusé (EXECUTE non accordé)');
SET LOCAL ROLE cashless_perso;
SELECT set_config('app.operator_id', '', true);
SELECT throws_ok($$SELECT retire_dedicated_key_for_job(pg_temp.id('25f001'))$$, 'P0002', NULL,
  'sans prestataire de session : refusé');
SELECT pg_temp.a();
SELECT throws_ok('SELECT retire_dedicated_key_for_job(NULL)', 'P0002', NULL,
  'appel sans travail : refusé');
SELECT throws_ok($$SELECT retire_dedicated_key_for_job(pg_temp.id('25ffff'))$$, 'P0002', NULL,
  'travail inexistant : refusé');
SELECT throws_ok($$SELECT retire_dedicated_key_for_job(pg_temp.id('25f003'))$$, 'CL020', NULL,
  'travail d''une autre sorte (ROTATE_DEK) : refusé');
SELECT throws_ok($$SELECT retire_dedicated_key_for_job(pg_temp.id('25f007'))$$, 'CL020', NULL,
  'travail enfant (DISABLE_KMS_KEY) : refusé');
SELECT throws_ok($$SELECT retire_dedicated_key_for_job(pg_temp.id('25f002'))$$, 'CL020', NULL,
  'travail en attente, non RUNNING : refusé');
SELECT throws_ok($$SELECT retire_dedicated_key_for_job(pg_temp.id('25f001'))$$, 'CL023',
  'Retrait de clé : demande d''approbation APPROVED, non exécutée',
  'demande approuvée mais non EXECUTED : refusé');
SELECT throws_ok($$SELECT retire_dedicated_key_for_job(pg_temp.id('25f004'))$$, 'CL023',
  'Retrait de clé : aucune demande d''approbation', 'travail sans demande : refusé');
SELECT throws_ok($$SELECT retire_dedicated_key_for_job(pg_temp.id('25f005'))$$, 'CL023',
  'Retrait de clé : le travail n''est pas celui que la demande a produit',
  'demande exécutée pour un autre travail : refusé');
SELECT throws_ok($$SELECT retire_dedicated_key_for_job(pg_temp.id('25f006'))$$, 'P0002', NULL,
  'session de A, travail de B : refusé (introuvable)');
SELECT is(ARRAY[pg_temp.key_status('25a001', 3), pg_temp.key_status('25a001', 5),
                pg_temp.key_status('25a001', 6), pg_temp.key_status('25a001', 7)],
  ARRAY['ACTIVE', 'ACTIVE', 'ACTIVE', 'ACTIVE'],
  'après les refus, les clés 3, 5, 6, 7 de A sont intactes');
SELECT is(pg_temp.key_status('25a002', 2), 'ACTIVE', 'après les refus, la clé 2 de B est intacte');
-- Témoin du refus inter-prestataires : le même travail, dans la session de B, est accepté.
SELECT pg_temp.b();
SELECT is(retire_dedicated_key_for_job(pg_temp.id('25f006')), 0,
  'témoin : session de B, travail de B en cours, demande exécutée : accepté');
SELECT is(pg_temp.key_status('25a002', 2), 'RETIRED', 'la clé 2 de B est retirée');
RESET ROLE;

DROP ROLE retire_guard_probe;

SELECT * FROM finish();
ROLLBACK;
