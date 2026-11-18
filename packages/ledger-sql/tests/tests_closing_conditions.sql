-- Étapes de clôture et conditions de passage de statut (migration 0084, mission 9b, lot WP02 ; FR-002, FR-008, C-004)
-- — pgTAP, écrit à la main. Exécuté en propriétaire : aucun droit de rôle (lot WP06).
-- Lancer : pg_prove -d <base> tests/tests_closing_conditions.sql
\set ON_ERROR_STOP 1
\set QUIET 1
BEGIN;
\ir _grants_for_tests.sql
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

CREATE FUNCTION pg_temp.id(p text) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT ('00000000-0000-0000-0000-' || lpad(p, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.code(p text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE p; RETURN NULL; EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE; END $$;

INSERT INTO party (kind, legal_name) SELECT 'PLATFORM', 'Plateforme (test)' WHERE NOT EXISTS (SELECT 1 FROM party WHERE kind = 'PLATFORM');
INSERT INTO party (id, kind, legal_name, country_code) VALUES
 (pg_temp.id('84a001'), 'OPERATOR', 'Prestataire A', 'SN'), (pg_temp.id('84a002'), 'OPERATOR', 'Prestataire B', 'SN');
INSERT INTO party (id, kind, operator_id, legal_name) VALUES
 (pg_temp.id('84b001'), 'ORGANIZER', pg_temp.id('84a001'), 'Organisateur A'),
 (pg_temp.id('84b002'), 'ORGANIZER', pg_temp.id('84a002'), 'Organisateur B');
INSERT INTO jurisdiction_profile (id, country_code, version, valid_from, breakage_destination)
VALUES (pg_temp.id('84d001'), 'SN', 840084, '2026-01-01', 'ORGANIZER');
SELECT set_config('app.operator_id', pg_temp.id('84a001')::text, true);
ALTER TABLE event DISABLE TRIGGER event_status_guard;   -- fixtures : on place les statuts directement (annulé par ROLLBACK)

-- Événement de A avec grand livre et comptes PSP ; p_deadline : échéance de remboursement ; p_steps : étapes déjà faites.
CREATE FUNCTION pg_temp.mkev(p_n text, p_deadline timestamptz, p_steps int, p_ledger boolean DEFAULT true) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE e uuid := pg_temp.id('84e' || p_n); st text[] := ARRAY['PITCH_FEES', 'OPERATOR_FEE', 'PLATFORM_FEE',
  'OPERATOR_FEE_REGULARIZATION', 'BREAKAGE', 'DEPOSIT_FORFEIT', 'PROMO_EXPIRY']; i int;
BEGIN
  INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone, jurisdiction_id, funds_holder, refund_deadline)
  VALUES (e, pg_temp.id('84a001'), pg_temp.id('84b001'), 'Événement ' || p_n, 'XOF', 'Africa/Dakar', pg_temp.id('84d001'),
          'ORGANIZER', p_deadline);
  IF p_ledger THEN
    PERFORM open_event_ledger(e);
    PERFORM open_psp_accounts((SELECT id FROM ledger WHERE scope_id = e));
  END IF;
  FOR i IN 1 .. p_steps LOOP
    INSERT INTO closing_step (operator_id, event_id, step, status, done_by)
    VALUES (pg_temp.id('84a001'), e, st[i], CASE WHEN i % 2 = 0 THEN 'NOT_APPLICABLE' ELSE 'DONE' END, pg_temp.id('84aa01'));
  END LOOP;
  RETURN e;
END $$;

CREATE TEMP TABLE ev AS SELECT
  pg_temp.mkev('001', now() - interval '1 day', 7) AS ok,
  pg_temp.mkev('002', now() - interval '1 day', 0) AS none,
  pg_temp.mkev('003', now() - interval '1 day', 3) AS s13,
  pg_temp.mkev('004', now() - interval '1 day', 7) AS cash_open,
  pg_temp.mkev('005', now() - interval '1 day', 7) AS cash_closing,
  pg_temp.mkev('006', now() - interval '1 day', 7) AS cash_closed,
  pg_temp.mkev('007', now() - interval '1 day', 7) AS psp,
  pg_temp.mkev('008', now() + interval '10 days', 7) AS future,
  pg_temp.mkev('009', NULL, 7) AS nodl,
  pg_temp.mkev('00a', now() - interval '1 day', 7, false) AS noledger,
  pg_temp.mkev('00b', now() - interval '1 day', 7) AS lock_ev,
  pg_temp.mkev('00c', now() - interval '1 day', 0) AS rec;
GRANT SELECT ON ev TO PUBLIC;
-- Un grand livre à portée ORGANIZER pour l'événement « ok » : ne compte pas comme grand livre de l'événement.
INSERT INTO ledger (operator_id, scope_type, scope_id, currency, issuer_id, funds_holder_id)
VALUES (pg_temp.id('84a001'), 'ORGANIZER', pg_temp.id('84b001'), 'XOF', pg_temp.id('84b001'), pg_temp.id('84b001'));
-- Sessions de caisse (fixtures : clés étrangères ignorées)
SET LOCAL session_replication_role = replica;
INSERT INTO cash_session (operator_id, ledger_id, event_id, device_id, cash_account_id, opened_by, status, counted_amount,
                          expected_amount, closed_by, closed_at)
SELECT pg_temp.id('84a001'), (SELECT id FROM ledger WHERE scope_id = e), e, gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
       s, CASE WHEN s <> 'OPEN' THEN 0 END, CASE WHEN s <> 'OPEN' THEN 0 END,
       CASE WHEN s <> 'OPEN' THEN gen_random_uuid() END, CASE WHEN s = 'CLOSED' THEN now() END
  FROM (SELECT cash_open e, 'OPEN' s FROM ev UNION ALL SELECT cash_closing, 'CLOSING' FROM ev
        UNION ALL SELECT cash_closed, 'CLOSED' FROM ev) x;
RESET session_replication_role;
-- Mouvement PSP sans relevé sur l'événement « psp »
INSERT INTO journal_transaction (id, operator_id, ledger_id, type, idempotency_key, request_hash, occurred_at, source, created_by, approved_by)
SELECT pg_temp.id('84f001'), pg_temp.id('84a001'), l.id, 'ADJUSTMENT', 'psp-mv', 'h', '2026-01-10 12:00+00', 'BACKOFFICE',
       pg_temp.id('84aa01'), pg_temp.id('84aa02') FROM ledger l WHERE l.scope_id = (SELECT psp FROM ev);
INSERT INTO posting (operator_id, ledger_id, transaction_id, line_no, account_id, amount)
SELECT pg_temp.id('84a001'), l.id, pg_temp.id('84f001'), n,
       (SELECT id FROM account WHERE ledger_id = l.id AND code = CASE n WHEN 1 THEN 'A-PSP-WAVE' ELSE 'L-ORG-COM' END),
       CASE n WHEN 1 THEN 1000 ELSE -1000 END
  FROM ledger l, generate_series(1, 2) n WHERE l.scope_id = (SELECT psp FROM ev);

-- Statut direct, puis résultat de set_event_status (annulé) et de la copie en lecture
CREATE FUNCTION pg_temp.setst(p_event uuid, p_st event_status) RETURNS void LANGUAGE sql AS
  $$ UPDATE event SET status = p_st WHERE id = p_event $$;
CREATE FUNCTION pg_temp.try(p_event uuid, p_to event_status) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    PERFORM set_event_status(p_event, p_to, pg_temp.id('84aa01'));
    RAISE EXCEPTION 'réussi' USING ERRCODE = 'XX999';     -- annule le passage
  EXCEPTION WHEN SQLSTATE 'XX999' THEN RETURN 'OK'; WHEN OTHERS THEN RETURN SQLSTATE;
  END;
END $$;
CREATE FUNCTION pg_temp.expect(p_event uuid, p_to event_status) RETURNS text LANGUAGE sql AS $$
  SELECT CASE WHEN EXISTS (SELECT 1 FROM event_transition_conditions(p_event, p_to) WHERE code = 'TRANSITION_ALLOWED' AND NOT met) THEN 'CL018'
              WHEN EXISTS (SELECT 1 FROM event_transition_conditions(p_event, p_to) WHERE NOT met) THEN 'CL019'
              ELSE 'OK' END
$$;
CREATE FUNCTION pg_temp.cell(p_event uuid, p_st event_status, p_to event_status) RETURNS text LANGUAGE plpgsql AS $$
BEGIN PERFORM pg_temp.setst(p_event, p_st); RETURN pg_temp.expect(p_event, p_to) || '/' || pg_temp.try(p_event, p_to); END $$;
CREATE FUNCTION pg_temp.cond(p_event uuid, p_st event_status, p_to event_status, p_code text, OUT met boolean, OUT detail text)
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp.setst(p_event, p_st);
  SELECT c.met, c.detail INTO met, detail FROM event_transition_conditions(p_event, p_to) c WHERE c.code = p_code;
END $$;

-- ===== 1. Égalité des deux copies sur une grille d'états ========================================================
CREATE TEMP TABLE grid AS
SELECT e.k, s.st, t.tgt, pg_temp.cell(e.id, s.st, t.tgt) AS res
  FROM (SELECT 'ok' k, ok id FROM ev UNION ALL SELECT 'none', none FROM ev UNION ALL SELECT 's13', s13 FROM ev
        UNION ALL SELECT 'cash_open', cash_open FROM ev UNION ALL SELECT 'cash_closing', cash_closing FROM ev
        UNION ALL SELECT 'cash_closed', cash_closed FROM ev UNION ALL SELECT 'psp', psp FROM ev
        UNION ALL SELECT 'future', future FROM ev UNION ALL SELECT 'nodl', nodl FROM ev
        UNION ALL SELECT 'noledger', noledger FROM ev) e
  CROSS JOIN unnest(enum_range(NULL::event_status)) s(st)
  CROSS JOIN unnest(enum_range(NULL::event_status)) t(tgt);
SELECT is((SELECT count(*)::int FROM grid), 490, 'grille : 10 événements x 7 statuts x 7 cibles');
SELECT is((SELECT count(*)::int FROM grid WHERE split_part(res, '/', 1) <> split_part(res, '/', 2)), 0,
  'grille : set_event_status et la copie en lecture disent la même chose (CL019 ssi une condition non remplie)');
SELECT cmp_ok((SELECT count(*)::int FROM grid WHERE res = 'CL019/CL019'), '>', 5, 'grille : des refus CL019 sont bien exercés');
SELECT cmp_ok((SELECT count(*)::int FROM grid WHERE res = 'OK/OK'), '>', 5, 'grille : des passages réussis sont bien exercés');
SELECT is((SELECT count(*)::int FROM grid WHERE res = 'CL018/CL018'), 490 - (SELECT count(*)::int FROM grid WHERE res <> 'CL018/CL018'),
  'grille : les passages hors graphe sont CL018 des deux côtés');

-- ===== 2. Chacune des 4 conditions : cas passant et cas bloquant ================================================
-- NO_OPEN_CASH_SESSION (vers RECONCILING)
SELECT is((SELECT met FROM pg_temp.cond((SELECT ok FROM ev), 'CLOSING', 'RECONCILING', 'NO_OPEN_CASH_SESSION')), true, 'sans caisse : remplie');
SELECT is((SELECT met FROM pg_temp.cond((SELECT cash_open FROM ev), 'CLOSING', 'RECONCILING', 'NO_OPEN_CASH_SESSION')), false, 'session OPEN : bloque');
SELECT is((SELECT met FROM pg_temp.cond((SELECT cash_closing FROM ev), 'CLOSING', 'RECONCILING', 'NO_OPEN_CASH_SESSION')), false, 'session CLOSING : bloque aussi');
SELECT is((SELECT met FROM pg_temp.cond((SELECT cash_closed FROM ev), 'CLOSING', 'RECONCILING', 'NO_OPEN_CASH_SESSION')), true, 'session CLOSED : ne bloque pas');
SELECT pg_temp.setst((SELECT cash_open FROM ev), 'CLOSING');
SELECT is(pg_temp.try((SELECT cash_open FROM ev), 'RECONCILING'), 'CL019', 'set_event_status refuse RECONCILING avec une session ouverte');
SELECT pg_temp.setst((SELECT ok FROM ev), 'CLOSING');
SELECT is(pg_temp.try((SELECT ok FROM ev), 'RECONCILING'), 'OK', 'set_event_status laisse passer RECONCILING sans caisse');
SELECT is((SELECT met FROM pg_temp.cond((SELECT noledger FROM ev), 'CLOSING', 'RECONCILING', 'NO_OPEN_CASH_SESSION')), true, 'événement sans grand livre : remplie');
SELECT is((SELECT count(*)::int FROM event_transition_conditions((SELECT ok FROM ev), 'SETTLING') WHERE code = 'NO_OPEN_CASH_SESSION'), 0,
  'la condition n''apparaît que vers RECONCILING');

-- PSP_RECONCILED (vers SETTLING)
SELECT is((SELECT met FROM pg_temp.cond((SELECT ok FROM ev), 'RECONCILING', 'SETTLING', 'PSP_RECONCILED')), true, 'sans mouvement PSP : remplie');
SELECT is((SELECT met FROM pg_temp.cond((SELECT psp FROM ev), 'RECONCILING', 'SETTLING', 'PSP_RECONCILED')), false, 'mouvement PSP sans relevé : bloque');
SELECT is((SELECT met FROM pg_temp.cond((SELECT noledger FROM ev), 'RECONCILING', 'SETTLING', 'PSP_RECONCILED')), true, 'événement sans grand livre : remplie');
SELECT is(pg_temp.try((SELECT psp FROM ev), 'SETTLING'), 'CL019', 'set_event_status refuse SETTLING (PSP non rapproché)');
SELECT import_statement_lines(jsonb_build_object('ledger_id', (SELECT id FROM ledger WHERE scope_id = (SELECT psp FROM ev)),
  'account_id', (SELECT a.id FROM account a JOIN ledger l ON l.id = a.ledger_id WHERE l.scope_id = (SELECT psp FROM ev) AND a.code = 'A-PSP-WAVE'),
  'source', 'wave', 'file_sha256', encode(sha256('84'::bytea), 'hex'), 'statement_date', '2026-01-31', 'closing_balance', 1000,
  'currency', 'XOF', 'imported_by', pg_temp.id('84aa01')), '[]'::jsonb);
SELECT is((SELECT met FROM pg_temp.cond((SELECT psp FROM ev), 'RECONCILING', 'SETTLING', 'PSP_RECONCILED')), true,
  'relevé de clôture égal au solde : remplie (devient calculée)');
SELECT is(pg_temp.try((SELECT psp FROM ev), 'SETTLING'), 'OK', 'set_event_status laisse passer SETTLING une fois rapproché');
SELECT is((SELECT source FROM event_transition_conditions((SELECT psp FROM ev), 'SETTLING') WHERE code = 'PSP_RECONCILED'), 'DATABASE',
  'PSP_RECONCILED : source DATABASE');

-- CLOSING_STEPS_DONE (vers REFUND_WINDOW : 1 à 3 ; vers CLOSED : 1 à 7)
SELECT is((SELECT met FROM pg_temp.cond((SELECT s13 FROM ev), 'SETTLING', 'REFUND_WINDOW', 'CLOSING_STEPS_DONE')), true, 'étapes 1 à 3 faites : fenêtre ouverte');
SELECT is((SELECT met FROM pg_temp.cond((SELECT s13 FROM ev), 'REFUND_WINDOW', 'CLOSED', 'CLOSING_STEPS_DONE')), false, 'étapes 4 à 7 manquantes : CLOSED bloque');
SELECT matches((SELECT detail FROM pg_temp.cond((SELECT s13 FROM ev), 'REFUND_WINDOW', 'CLOSED', 'CLOSING_STEPS_DONE')), 'OPERATOR_FEE_REGULARIZATION.*PROMO_EXPIRY',
  'le détail nomme les étapes à faire');
SELECT is((SELECT met FROM pg_temp.cond((SELECT none FROM ev), 'SETTLING', 'REFUND_WINDOW', 'CLOSING_STEPS_DONE')), false, 'aucune étape : bloque');
SELECT is((SELECT met FROM pg_temp.cond((SELECT ok FROM ev), 'REFUND_WINDOW', 'CLOSED', 'CLOSING_STEPS_DONE')), true, 'sept étapes (DONE ou NOT_APPLICABLE) : remplie');
SELECT pg_temp.setst((SELECT none FROM ev), 'SETTLING');
SELECT is(pg_temp.try((SELECT none FROM ev), 'REFUND_WINDOW'), 'CL019', 'set_event_status refuse REFUND_WINDOW sans étapes');
SELECT is((SELECT count(*)::int FROM event_transition_conditions((SELECT ok FROM ev), 'SETTLING') WHERE code = 'CLOSING_STEPS_DONE'), 0,
  'la condition n''apparaît que vers REFUND_WINDOW et CLOSED');

-- REFUND_DEADLINE_REACHED (vers CLOSED)
SELECT is((SELECT met FROM pg_temp.cond((SELECT ok FROM ev), 'REFUND_WINDOW', 'CLOSED', 'REFUND_DEADLINE_REACHED')), true, 'échéance passée : remplie');
SELECT is((SELECT met FROM pg_temp.cond((SELECT future FROM ev), 'REFUND_WINDOW', 'CLOSED', 'REFUND_DEADLINE_REACHED')), false, 'échéance future : bloque');
SELECT is((SELECT met FROM pg_temp.cond((SELECT nodl FROM ev), 'REFUND_WINDOW', 'CLOSED', 'REFUND_DEADLINE_REACHED')), false, 'échéance nulle : non remplie');
SELECT matches((SELECT detail FROM pg_temp.cond((SELECT nodl FROM ev), 'REFUND_WINDOW', 'CLOSED', 'REFUND_DEADLINE_REACHED')), 'non définie',
  'échéance nulle : détail explicite');
SELECT pg_temp.setst((SELECT future FROM ev), 'REFUND_WINDOW');
SELECT is(pg_temp.try((SELECT future FROM ev), 'CLOSED'), 'CL019', 'set_event_status refuse CLOSED avant l''échéance (renforcement)');

-- Forme de la copie en lecture : premier bloc TRANSITION_ALLOWED, conditions nouvelles à la suite, source DATABASE
SELECT is((SELECT code FROM event_transition_conditions((SELECT ok FROM ev), 'CLOSED') LIMIT 1), 'TRANSITION_ALLOWED', 'premier bloc : TRANSITION_ALLOWED');
SELECT is((SELECT string_agg(code, ',') FROM (SELECT code FROM event_transition_conditions((SELECT ok FROM ev), 'CLOSED') OFFSET 5) q),
  'POSITIONS_SETTLED,CLOSING_STEPS_DONE,REFUND_DEADLINE_REACHED', 'conditions nouvelles à la suite des existantes');
SELECT is((SELECT count(DISTINCT source)::int FROM event_transition_conditions((SELECT ok FROM ev), 'CLOSED') WHERE source = 'DATABASE'), 1,
  'source = DATABASE');

-- Transactions : une sur le grand livre de l'événement « rec », une sur celui de l'événement « ok » (même prestataire)
INSERT INTO journal_transaction (id, operator_id, ledger_id, type, idempotency_key, request_hash, occurred_at, source, created_by, approved_by)
SELECT pg_temp.id(v.k), pg_temp.id('84a001'), l.id, 'ADJUSTMENT', 'rec-' || v.k, 'h', now(), 'BACKOFFICE', pg_temp.id('84aa01'), pg_temp.id('84aa02')
  FROM (VALUES ('84f002', (SELECT rec FROM ev)), ('84f003', (SELECT ok FROM ev))) v(k, e) JOIN ledger l ON l.scope_id = v.e;
-- ===== 3. closing_step et record_closing_step ===================================================================
SELECT pg_temp.setst((SELECT rec FROM ev), 'SETTLING');
CREATE FUNCTION pg_temp.rec(p_step text, p_status text DEFAULT 'DONE', p_tx uuid[] DEFAULT '{}', p_actor uuid DEFAULT pg_temp.id('84aa01'),
                            p_summary jsonb DEFAULT '{"k":1}') RETURNS text LANGUAGE sql AS $$
  SELECT pg_temp.code(format('SELECT record_closing_step(%L, %L, %L, %L, %L, %L)', (SELECT rec FROM ev), p_step, p_status, p_tx, p_summary, p_actor))
$$;
SELECT is(pg_temp.rec('OPERATOR_FEE'), 'CL019', 'étape 2 avant l''étape 1 : CL019 (ordre)');
SELECT is(pg_temp.rec('BREAKAGE'), 'CL019', 'étape 5 en SETTLING : CL019 (phase)');
SELECT is(pg_temp.rec('FOO'), 'CL047', 'étape inconnue : CL047');
SELECT is(pg_temp.rec('PITCH_FEES', 'MAYBE'), 'CL047', 'statut inconnu : CL047');
SELECT is(pg_temp.rec('PITCH_FEES', 'DONE', '{}', NULL), 'CL047', 'auteur absent : CL047');
SELECT is(pg_temp.rec('PITCH_FEES', 'NOT_APPLICABLE', ARRAY[pg_temp.id('84f002')]), '23514', 'sans objet avec transactions : refusé (CHECK)');
SELECT is((SELECT count(*)::int FROM closing_step WHERE event_id = (SELECT rec FROM ev)), 0, 'refus : aucune ligne écrite');
SELECT is(pg_temp.rec('PITCH_FEES', 'DONE', ARRAY[pg_temp.id('84f003')]), 'CL047', 'transaction d''un autre événement du même prestataire : CL047');
SELECT is(pg_temp.rec('PITCH_FEES', 'DONE', ARRAY[pg_temp.id('84f001')]), 'CL047', 'transaction du grand livre d''un autre événement : CL047');
SELECT is(pg_temp.rec('PITCH_FEES', 'DONE', ARRAY[pg_temp.id('84f002')]), NULL, 'étape 1 : enregistrée (transaction du grand livre de l''événement)');
SELECT is((SELECT transaction_ids FROM closing_step WHERE event_id = (SELECT rec FROM ev) AND step = 'PITCH_FEES'), ARRAY[pg_temp.id('84f002')],
  'transactions consignées');
SELECT is((SELECT done_by FROM closing_step WHERE event_id = (SELECT rec FROM ev) AND step = 'PITCH_FEES'), pg_temp.id('84aa01'), 'auteur consigné');
SELECT is(pg_temp.rec('PITCH_FEES', 'DONE', '{}', pg_temp.id('84aa09'), '{"autre":2}'), NULL, 'rejeu : accepté');
SELECT is((SELECT summary FROM closing_step WHERE event_id = (SELECT rec FROM ev) AND step = 'PITCH_FEES'), '{"k":1}'::jsonb,
  'rejeu : rien n''est réécrit (premier résumé conservé)');
SELECT is((SELECT (record_closing_step((SELECT rec FROM ev), 'PITCH_FEES', 'DONE', '{}', '{}', pg_temp.id('84aa09'))).done_by), pg_temp.id('84aa01'),
  'rejeu : rend la ligne existante');
SELECT is(pg_temp.rec('OPERATOR_FEE', 'NOT_APPLICABLE'), NULL, 'étape 2 sans objet : enregistrée');
SELECT is(pg_temp.rec('PLATFORM_FEE', 'DONE', ARRAY[pg_temp.id('84f009')]), 'CL047', 'transaction inconnue ou d''un autre prestataire : CL047');
SELECT is(pg_temp.rec('PLATFORM_FEE'), NULL, 'étape 3 : enregistrée');
SELECT is((SELECT count(*)::int FROM (SELECT record_closing_step((SELECT rec FROM ev), 'PLATFORM_FEE', 'DONE', '{}', '{}', pg_temp.id('84aa01'))
  FROM generate_series(1, 50)) q), 50, '50 appels successifs');
SELECT is((SELECT count(*)::int FROM closing_step WHERE event_id = (SELECT rec FROM ev) AND step = 'PLATFORM_FEE'), 1, '50 appels : une seule ligne');
SELECT pg_temp.setst((SELECT rec FROM ev), 'REFUND_WINDOW');
SELECT is(pg_temp.rec('PITCH_FEES'), NULL, 'rejeu après changement de phase : rend la ligne');
SELECT is(pg_temp.rec('PLATFORM_FEE'), NULL, 'rejeu étape 3 en REFUND_WINDOW : rend la ligne');
SELECT is(pg_temp.rec('BREAKAGE'), 'CL019', 'étape 5 avant l''étape 4 : CL019');
SELECT is(pg_temp.rec('OPERATOR_FEE_REGULARIZATION', 'NOT_APPLICABLE'), NULL, 'étape 4 en REFUND_WINDOW : enregistrée');
SELECT is(pg_temp.rec('BREAKAGE'), NULL, 'étape 5 : enregistrée');
SELECT pg_temp.setst((SELECT rec FROM ev), 'SETTLING');
SELECT is(pg_temp.rec('DEPOSIT_FORFEIT'), 'CL019', 'étape 6 en SETTLING : CL019 (phase)');
-- Ajout seul, PK, garde de portée
SELECT isnt(pg_temp.code(format($q$UPDATE closing_step SET status = 'DONE' WHERE event_id = %L$q$, (SELECT rec FROM ev))), NULL, 'UPDATE : refusé');
SELECT isnt(pg_temp.code(format($q$DELETE FROM closing_step WHERE event_id = %L$q$, (SELECT rec FROM ev))), NULL, 'DELETE : refusé');
SELECT is(pg_temp.code(format($q$INSERT INTO closing_step (operator_id, event_id, step, status, done_by) VALUES (%L, %L, 'PITCH_FEES', 'DONE', %L)$q$,
  pg_temp.id('84a001'), (SELECT rec FROM ev), pg_temp.id('84aa01'))), '23505', 'même étape deux fois : PK');
SELECT is(pg_temp.code(format($q$INSERT INTO closing_step (operator_id, event_id, step, status, done_by) VALUES (%L, %L, 'BREAKAGE', 'DONE', %L)$q$,
  pg_temp.id('84a002'), (SELECT none FROM ev), pg_temp.id('84aa01'))), 'CL047', 'événement d''un autre prestataire : refusé');
SELECT is(pg_temp.code(format($q$INSERT INTO closing_step (operator_id, event_id, step, status, done_by) VALUES (%L, %L, 'NOPE', 'DONE', %L)$q$,
  pg_temp.id('84a001'), (SELECT none FROM ev), pg_temp.id('84aa01'))), '23514', 'étape hors liste : CHECK');

-- ===== 4. Cloisonnement, droits d'exécution, search_path ========================================================
SELECT set_config('app.operator_id', pg_temp.id('84a002')::text, true);
SELECT is(pg_temp.rec('BREAKAGE'), 'P0002', 'record_closing_step : événement d''un autre prestataire introuvable');
SELECT is(pg_temp.code(format($q$SELECT * FROM closing_new_conditions(%L, 'CLOSED')$q$, (SELECT ok FROM ev))), 'P0002', 'closing_new_conditions : introuvable');
SELECT is(pg_temp.code(format($q$SELECT * FROM event_transition_conditions(%L, 'CLOSED')$q$, (SELECT ok FROM ev))), 'P0002', 'event_transition_conditions : introuvable');
SELECT is(pg_temp.try((SELECT ok FROM ev), 'CLOSED'), 'P0002', 'set_event_status : introuvable');
SELECT set_config('app.operator_id', pg_temp.id('84a001')::text, true);
SELECT is((SELECT count(*)::int FROM pg_proc p WHERE p.proname IN ('record_closing_step', 'closing_new_conditions', 'event_transition_conditions',
  'set_event_status', 'closing_step_scope_guard') AND p.prosecdef AND coalesce(p.proconfig, '{}') @> ARRAY['search_path=public, pg_temp']), 5,
  'les cinq fonctions sont SECURITY DEFINER avec search_path = public, pg_temp');
SELECT is((SELECT count(*)::int FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
  WHERE p.proname IN ('record_closing_step', 'closing_new_conditions', 'event_transition_conditions', 'set_event_status',
                      'closing_step_scope_guard') AND a.grantee = 0), 0, 'aucune de ces fonctions n''est exécutable par PUBLIC');
SELECT is((SELECT count(*)::int FROM pg_class c WHERE c.relname = 'closing_step' AND c.relrowsecurity AND c.relforcerowsecurity), 1, 'closing_step : RLS ENABLE + FORCE');
SELECT is((SELECT count(*)::int FROM pg_policies WHERE tablename = 'closing_step' AND policyname = 'tenant_isolation'), 1, 'closing_step : politique tenant_isolation');

-- ===== 5. Ordre des verrous inchangé ==============================================================================
SELECT pg_temp.setst((SELECT lock_ev FROM ev), 'RECONCILING');
CREATE TEMP TABLE lk0 AS SELECT count(*) AS n FROM pg_locks WHERE pid = pg_backend_pid() AND locktype = 'advisory';
SELECT set_event_status((SELECT lock_ev FROM ev), 'SETTLING', pg_temp.id('84aa01'));
SELECT is((SELECT count(*)::int FROM pg_locks WHERE pid = pg_backend_pid() AND locktype = 'advisory') - (SELECT n::int FROM lk0), 1,
  'un seul verrou consultatif (autorité du grand livre) : les conditions nouvelles n''en ajoutent aucun');
SELECT is((SELECT count(*)::int FROM pg_locks WHERE pid = pg_backend_pid() AND locktype = 'advisory'
            AND objid = (hashtextextended('debit-authority:' || (SELECT id FROM ledger WHERE scope_id = (SELECT lock_ev FROM ev)), 0) & 4294967295)::oid),
  1, 'le verrou est bien celui d''autorité du grand livre');
SELECT is((SELECT status::text FROM event WHERE id = (SELECT lock_ev FROM ev)), 'SETTLING', 'le passage a bien eu lieu');

SELECT * FROM finish();
ROLLBACK;
