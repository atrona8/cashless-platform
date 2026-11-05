-- Annulation d'un import de journal resté PENDING (migration 0050 ; mission hors-ligne-snapshots-lots, lot WP20,
-- cycle 2 ; décision du porteur du 03/11/2026) — pgTAP, écrit à la main. Sous le PROPRIÉTAIRE seulement (les
-- droits EXECUTE sont dans tests_execute_grants.sql et tests_offline_rights.sql).
-- Lancer : pg_prove -d <base> tests/tests_device_journal_import_cancel.sql (base créée par les migrations).
\set ON_ERROR_STOP 1
\set QUIET 1
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

CREATE FUNCTION pg_temp.id(p text) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT ('00000000-0000-0000-0000-' || lpad(p, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.a() RETURNS void LANGUAGE sql AS
  $$ SELECT set_config('app.operator_id', pg_temp.id('50a001')::text, true) $$;
CREATE FUNCTION pg_temp.b() RETURNS void LANGUAGE sql AS
  $$ SELECT set_config('app.operator_id', pg_temp.id('50a002')::text, true) $$;
CREATE FUNCTION pg_temp.code(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE p_sql; RETURN 'OK'; EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE; END $$;
-- Un import PENDING du terminal p_dev (lot unique, numéro 1) et sa demande d'approbation PENDING
CREATE FUNCTION pg_temp.mk(p_dev uuid, p_batch uuid) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v uuid;
BEGIN
  v := create_device_journal_import(p_dev, jsonb_build_array(jsonb_build_object('batch_id', p_batch, 'seq_from', 1)),
         sha256('x'::bytea), '{}', 'raison suffisante', pg_temp.id('50e001'));
  INSERT INTO approval_request (operator_id, action, target_id, payload, requested_by)
  SELECT d.operator_id, 'DEVICE_JOURNAL_IMPORT', v, jsonb_build_object('import_id', v, 'device_id', p_dev),
         pg_temp.id('50e001')
    FROM device d WHERE d.id = p_dev;
  RETURN v;
END $$;
CREATE FUNCTION pg_temp.req(p_import uuid) RETURNS uuid LANGUAGE sql AS
  $$ SELECT id FROM approval_request WHERE target_id = p_import $$;

INSERT INTO party (kind, legal_name) SELECT 'PLATFORM', 'Plateforme (test)'
 WHERE NOT EXISTS (SELECT 1 FROM party WHERE kind = 'PLATFORM');
INSERT INTO party (id, kind, legal_name, country_code) VALUES
 (pg_temp.id('50a001'), 'OPERATOR', 'Prestataire A', 'SN'),
 (pg_temp.id('50a002'), 'OPERATOR', 'Prestataire B', 'CI');
INSERT INTO party (id, kind, operator_id, legal_name) VALUES
 (pg_temp.id('50b001'), 'ORGANIZER', pg_temp.id('50a001'), 'Organisateur A'),
 (pg_temp.id('50b011'), 'ORGANIZER', pg_temp.id('50a002'), 'Organisateur B');
INSERT INTO jurisdiction_profile (id, country_code, version, valid_from, breakage_destination)
VALUES (pg_temp.id('50c001'), 'SN', 500050, '2026-01-01', 'ORGANIZER');
INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone, jurisdiction_id, funds_holder)
SELECT pg_temp.id(e), pg_temp.id(o), pg_temp.id(g), 'Événement ' || e, 'XOF', 'Africa/Dakar',
       pg_temp.id('50c001'), 'ORGANIZER'
  FROM (VALUES ('50d001','50a001','50b001'), ('50d011','50a002','50b011')) AS v(e, o, g);
INSERT INTO device (id, operator_id, kind, event_id, serial)
SELECT pg_temp.id('50aa' || n), pg_temp.id('50a001'), 'POS', pg_temp.id('50d001'), 'C50-AA' || n
  FROM (VALUES ('01'), ('02'), ('03'), ('04'), ('05'), ('06'), ('07')) AS v(n);
INSERT INTO device (id, operator_id, kind, event_id, serial)
VALUES (pg_temp.id('50ab01'), pg_temp.id('50a002'), 'POS', pg_temp.id('50d011'), 'C50-AB01');
INSERT INTO app_user (id, operator_id, issuer, subject, email, display_name)
SELECT pg_temp.id(u), pg_temp.id(o), 'https://idp.test', 's0050' || u, u || '@test', 'Personne ' || u
  FROM (VALUES ('50e001','50a001'), ('50e002','50a001'), ('50e011','50a002')) AS v(u, o);
UPDATE device SET status = 'REVOKED' WHERE serial LIKE 'C50-%';
SELECT pg_temp.a();

-- 1. Demande rejetée -> import REJECTED, nouvelle demande acceptée ----------------------------------------------------
CREATE TEMP TABLE imp AS SELECT pg_temp.mk(pg_temp.id('50aa01'), 'b0500000-0000-0000-0000-000000000001') AS id;
GRANT ALL ON imp TO PUBLIC;
SELECT is(pg_temp.code($$SELECT create_device_journal_import(pg_temp.id('50aa01'),
  '[{"batch_id":"b0500000-0000-0000-0000-000000000002","seq_from":1}]', sha256('x'::bytea), '{}', 'raison suffisante',
  pg_temp.id('50e001'))$$), 'CL010', 'avant : un second import du terminal est refusé (CL010)');
SELECT is(pg_temp.code($$SELECT cancel_device_journal_import((SELECT id FROM imp), pg_temp.id('50e002'), 'REJECTED')$$),
  'CL001', 'demande encore valable : annulation refusée (CL001)');
SELECT is((SELECT status FROM device_journal_import WHERE id = (SELECT id FROM imp)), 'PENDING', 'refus : import resté PENDING');
SELECT is((SELECT status FROM decide_approval_request(pg_temp.req((SELECT id FROM imp)), pg_temp.id('50e002'), false, 'non')),
  'REJECTED', 'la demande est rejetée');
SELECT is(pg_temp.code($$SELECT cancel_device_journal_import((SELECT id FROM imp), pg_temp.id('50e002'), 'REJECTED')$$),
  'OK', 'demande rejetée : annulation acceptée');
SELECT is((SELECT status FROM device_journal_import WHERE id = (SELECT id FROM imp)), 'REJECTED', 'import REJECTED');
SELECT is((SELECT result->>'reason' FROM device_journal_import WHERE id = (SELECT id FROM imp)), 'REJECTED', 'motif consigné');
SELECT is((SELECT result->>'cancelled_by' FROM device_journal_import WHERE id = (SELECT id FROM imp)),
  pg_temp.id('50e002')::text, 'acteur consigné');
SELECT is((SELECT applied_at FROM device_journal_import WHERE id = (SELECT id FROM imp)), NULL::timestamptz,
  'applied_at reste NULL');
SELECT is(pg_temp.code($$SELECT cancel_device_journal_import((SELECT id FROM imp), pg_temp.id('50e002'), 'REJECTED')$$),
  'OK', 'idempotente : second appel sans erreur');
SELECT is((SELECT count(*)::int FROM device_journal_import WHERE device_id = pg_temp.id('50aa01')), 1, 'second appel : aucune ligne de plus');
SELECT is(pg_temp.code($$SELECT pg_temp.mk(pg_temp.id('50aa01'), 'b0500000-0000-0000-0000-000000000003')$$), 'OK',
  'index d''unicité libéré : nouvelle demande acceptée');

-- 2. Demande échue (jamais décidée, puis décidée trop tard) ---------------------------------------------------------
CREATE TEMP TABLE imp2 AS SELECT pg_temp.mk(pg_temp.id('50aa02'), 'b0500000-0000-0000-0000-000000000011') AS id;
GRANT ALL ON imp2 TO PUBLIC;
SELECT is(pg_temp.code($$SELECT cancel_device_journal_import((SELECT id FROM imp2), pg_temp.id('50e002'), 'EXPIRED')$$),
  'CL001', 'demande pas échue : annulation EXPIRED refusée');
ALTER TABLE approval_request DISABLE TRIGGER approval_request_guard;
UPDATE approval_request SET expires_at = clock_timestamp() - interval '1 minute' WHERE target_id = (SELECT id FROM imp2);
ALTER TABLE approval_request ENABLE TRIGGER approval_request_guard;
SELECT is(pg_temp.code($$SELECT cancel_device_journal_import((SELECT id FROM imp2), pg_temp.id('50e002'), 'EXPIRED')$$),
  'OK', 'demande PENDING échue : annulation acceptée');
SELECT is((SELECT status FROM device_journal_import WHERE id = (SELECT id FROM imp2)), 'REJECTED', 'import REJECTED (échéance)');
SELECT is((SELECT result->>'reason' FROM device_journal_import WHERE id = (SELECT id FROM imp2)), 'EXPIRED', 'motif EXPIRED');
SELECT is(pg_temp.code($$SELECT pg_temp.mk(pg_temp.id('50aa02'), 'b0500000-0000-0000-0000-000000000012')$$), 'OK',
  'après échéance : nouvelle demande acceptée');

-- 3. Demande FAILED (approuvée, exécution échouée avant begin_) -----------------------------------------------------
CREATE TEMP TABLE imp3 AS SELECT pg_temp.mk(pg_temp.id('50aa03'), 'b0500000-0000-0000-0000-000000000021') AS id;
GRANT ALL ON imp3 TO PUBLIC;
SELECT decide_approval_request(pg_temp.req((SELECT id FROM imp3)), pg_temp.id('50e002'), true, 'ok');
UPDATE approval_request SET status = 'FAILED', failure_code = 'CONFLICT_STATE' WHERE target_id = (SELECT id FROM imp3);
SELECT is(pg_temp.code($$SELECT cancel_device_journal_import((SELECT id FROM imp3), pg_temp.id('50e002'), 'FAILED')$$),
  'OK', 'demande FAILED : annulation acceptée');
SELECT is((SELECT status FROM device_journal_import WHERE id = (SELECT id FROM imp3)), 'REJECTED', 'import REJECTED (échec)');

-- 4. Demande APPROVED : l'import n'est pas annulable --------------------------------------------------------------
CREATE TEMP TABLE imp4 AS SELECT pg_temp.mk(pg_temp.id('50aa04'), 'b0500000-0000-0000-0000-000000000031') AS id;
GRANT ALL ON imp4 TO PUBLIC;
SELECT decide_approval_request(pg_temp.req((SELECT id FROM imp4)), pg_temp.id('50e002'), true, 'ok');
SELECT is(pg_temp.code($$SELECT cancel_device_journal_import((SELECT id FROM imp4), pg_temp.id('50e002'), 'REJECTED')$$),
  'CL001', 'demande approuvée : annulation refusée');
SELECT is((SELECT status FROM device_journal_import WHERE id = (SELECT id FROM imp4)), 'PENDING', 'import resté PENDING');

-- 5. États PROCESSING, APPLIED, FAILED : CL053, rien de modifié -------------------------------------------------------
SELECT begin_device_journal_import((SELECT id FROM imp4), sha256('x'::bytea), pg_temp.id('50e002'));
UPDATE approval_request SET status = 'EXECUTED' WHERE target_id = (SELECT id FROM imp4);
SELECT is(pg_temp.code($$SELECT cancel_device_journal_import((SELECT id FROM imp4), pg_temp.id('50e002'), 'REJECTED')$$),
  'CL053', 'import PROCESSING : CL053');
SELECT finish_device_journal_import((SELECT id FROM imp4), 'APPLIED', '{"results":[]}');
SELECT is(pg_temp.code($$SELECT cancel_device_journal_import((SELECT id FROM imp4), pg_temp.id('50e002'), 'REJECTED')$$),
  'CL053', 'import APPLIED : CL053');
SELECT is((SELECT status FROM device_journal_import WHERE id = (SELECT id FROM imp4)), 'APPLIED', 'import APPLIED intact');
CREATE TEMP TABLE imp5 AS SELECT pg_temp.mk(pg_temp.id('50aa05'), 'b0500000-0000-0000-0000-000000000041') AS id;
GRANT ALL ON imp5 TO PUBLIC;
SELECT decide_approval_request(pg_temp.req((SELECT id FROM imp5)), pg_temp.id('50e002'), true, 'ok');
SELECT begin_device_journal_import((SELECT id FROM imp5), sha256('x'::bytea), pg_temp.id('50e002'));
UPDATE approval_request SET status = 'EXECUTED' WHERE target_id = (SELECT id FROM imp5);
SELECT finish_device_journal_import((SELECT id FROM imp5), 'FAILED', '{"results":[]}');
SELECT is(pg_temp.code($$SELECT cancel_device_journal_import((SELECT id FROM imp5), pg_temp.id('50e002'), 'REJECTED')$$),
  'CL053', 'import FAILED : CL053');

-- 6. Entrées invalides et cloisonnement ---------------------------------------------------------------------------
CREATE TEMP TABLE imp6 AS SELECT pg_temp.mk(pg_temp.id('50aa06'), 'b0500000-0000-0000-0000-000000000051') AS id;
GRANT ALL ON imp6 TO PUBLIC;
SELECT decide_approval_request(pg_temp.req((SELECT id FROM imp6)), pg_temp.id('50e002'), false, 'non');
SELECT is(pg_temp.code($$SELECT cancel_device_journal_import((SELECT id FROM imp6), NULL, 'REJECTED')$$), 'CL001', 'acteur NULL : CL001');
SELECT is(pg_temp.code($$SELECT cancel_device_journal_import((SELECT id FROM imp6), pg_temp.id('50e002'), 'AUTRE')$$), 'CL001', 'motif inconnu : CL001');
SELECT is(pg_temp.code($$SELECT cancel_device_journal_import((SELECT id FROM imp6), pg_temp.id('50e002'), NULL)$$), 'CL001', 'motif NULL : CL001');
SELECT is((SELECT status FROM device_journal_import WHERE id = (SELECT id FROM imp6)), 'PENDING', 'entrées invalides : rien de modifié');
SELECT pg_temp.b();
SELECT is(pg_temp.code($$SELECT cancel_device_journal_import((SELECT id FROM imp6), pg_temp.id('50e011'), 'REJECTED')$$), 'P0002',
  'autre prestataire : introuvable');
SELECT is(pg_temp.code($$SELECT cancel_device_journal_import(gen_random_uuid(), pg_temp.id('50e011'), 'REJECTED')$$), 'P0002',
  'import inconnu : introuvable');
SELECT pg_temp.a();
SELECT is((SELECT status FROM device_journal_import WHERE id = (SELECT id FROM imp6)), 'PENDING', 'autre prestataire : rien de modifié');

-- 7. Nature de la fonction ----------------------------------------------------------------------------------------
SELECT is((SELECT prosecdef FROM pg_proc WHERE proname = 'cancel_device_journal_import'), true, 'SECURITY DEFINER');
SELECT ok(coalesce((SELECT proconfig FROM pg_proc WHERE proname = 'cancel_device_journal_import'), '{}')
          @> ARRAY['search_path=public, pg_temp'], 'search_path = public, pg_temp');
SELECT is((SELECT count(*)::int FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
   WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE' AND p.proname = 'cancel_device_journal_import'), 0,
  'EXECUTE retiré à PUBLIC');

SELECT * FROM finish();
ROLLBACK;
