-- Fonctions d'écriture des lots de bracelets (0091, OP-N60 partie base, mission 11a WP01) — pgTAP,
-- écrit à la main. Lancer : pg_prove -d <base> tests/tests_media_batch_functions.sql
-- Fonctions prouvées en propriétaire (WP03 retire ensuite les droits d'écriture directs).
\set ON_ERROR_STOP 1
\set QUIET 1
BEGIN;
\ir _grants_for_tests.sql
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

CREATE FUNCTION pg_temp.id(p text) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT ('00000000-0000-0000-0000-' || lpad(p, 12, '0'))::uuid $$;
-- Prestataire de la session : a (A) ou b (B).
CREATE FUNCTION pg_temp.as_op(p text) RETURNS void LANGUAGE sql AS
  $$ SELECT set_config('app.operator_id', pg_temp.id(p)::text, true) $$;
-- Appel de create_media_batch avec des valeurs par défaut valides (lot PUBLIC de 10, clé 1).
CREATE FUNCTION pg_temp.cmb(p_org text, p_event text DEFAULT NULL, p_kind text DEFAULT 'PUBLIC',
                            p_qty int DEFAULT 10, p_key int DEFAULT 1, p_dep bigint DEFAULT 0,
                            p_mode text DEFAULT NULL, p_keymode text DEFAULT 'SHARED')
RETURNS uuid LANGUAGE sql AS $$
  SELECT create_media_batch(pg_temp.id(p_org), pg_temp.id(p_event), p_kind, p_qty, p_key, 'ref-1',
                            0, p_dep, p_mode, p_keymode, 'SINGLE_USE', pg_temp.id('91e001'))
$$;
CREATE FUNCTION pg_temp.state(p text, p_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE p_sql; RETURN 'ok'; EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE; END $$;

INSERT INTO party (id, kind, legal_name, country_code) VALUES
 (pg_temp.id('91a001'), 'OPERATOR', 'Prestataire A', 'SN'),
 (pg_temp.id('91a002'), 'OPERATOR', 'Prestataire B', 'CI');
INSERT INTO party (id, kind, operator_id, legal_name) VALUES
 (pg_temp.id('91b001'), 'ORGANIZER', pg_temp.id('91a001'), 'Organisateur A'),
 (pg_temp.id('91b002'), 'ORGANIZER', pg_temp.id('91a001'), 'Organisateur A2'),
 (pg_temp.id('91b011'), 'ORGANIZER', pg_temp.id('91a002'), 'Organisateur B'),
 (pg_temp.id('91b101'), 'MERCHANT', pg_temp.id('91a001'), 'Commerçant A');
INSERT INTO jurisdiction_profile (id, country_code, version, valid_from, breakage_destination)
VALUES (pg_temp.id('91c001'), 'SN', 910091, '2026-01-01', 'ORGANIZER');
INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone, jurisdiction_id,
                   funds_holder, status) VALUES
 (pg_temp.id('91d001'), pg_temp.id('91a001'), pg_temp.id('91b001'), 'Événement A', 'XOF',
  'Africa/Dakar', pg_temp.id('91c001'), 'ORGANIZER', 'LIVE'),
 (pg_temp.id('91d002'), pg_temp.id('91a001'), pg_temp.id('91b002'), 'Événement A2', 'XOF',
  'Africa/Dakar', pg_temp.id('91c001'), 'ORGANIZER', 'LIVE'),
 (pg_temp.id('91d011'), pg_temp.id('91a002'), pg_temp.id('91b011'), 'Événement B', 'XOF',
  'Africa/Dakar', pg_temp.id('91c001'), 'ORGANIZER', 'LIVE');
INSERT INTO app_user (id, operator_id, issuer, subject, email, display_name)
VALUES (pg_temp.id('91e001'), pg_temp.id('91a001'), 'https://idp.test', 's0091', 'u@test', 'Admin A');
INSERT INTO tag_key (operator_id, key_index, kms_key_ref, status) VALUES
 (pg_temp.id('91a001'), 1, 'test:hmac-a1', 'ACTIVE'),
 (pg_temp.id('91a001'), 2, 'test:hmac-a2', 'DECRYPT_ONLY'),
 (pg_temp.id('91a002'), 1, 'test:hmac-b1', 'ACTIVE');
-- Lot de B (isolation) et bracelet de B.
INSERT INTO media_batch (id, operator_id, organizer_id, kind, quantity, key_index) VALUES
 (pg_temp.id('91b9001'), pg_temp.id('91a002'), pg_temp.id('91b011'), 'PUBLIC', 5, 1);
INSERT INTO ledger (id, operator_id, scope_type, scope_id, currency, issuer_id, funds_holder_id) VALUES
 (pg_temp.id('91cc01'), pg_temp.id('91a001'), 'EVENT', pg_temp.id('91d001'), 'XOF',
  pg_temp.id('91b001'), pg_temp.id('91b001')),
 (pg_temp.id('91cc11'), pg_temp.id('91a002'), 'EVENT', pg_temp.id('91d011'), 'XOF',
  pg_temp.id('91b011'), pg_temp.id('91b011'));
INSERT INTO wallet (id, operator_id, ledger_id) VALUES
 (pg_temp.id('91cb01'), pg_temp.id('91a001'), pg_temp.id('91cc01')),
 (pg_temp.id('91cb02'), pg_temp.id('91a001'), pg_temp.id('91cc01')),
 (pg_temp.id('91cb11'), pg_temp.id('91a002'), pg_temp.id('91cc11'));

-- 1. Structure : cinq fonctions SECURITY DEFINER, search_path fixé -------------------------------------
SELECT is((SELECT count(*)::int FROM pg_proc WHERE proname IN ('create_media_batch',
  'update_media_batch', 'set_media_batch_status', 'media_set_status', 'issue_claim_codes')
  AND prosecdef AND proconfig @> ARRAY['search_path=public, pg_temp']), 5,
  'les cinq fonctions sont SECURITY DEFINER avec search_path = public, pg_temp');
SELECT is((SELECT count(*)::int FROM pg_proc WHERE proname IN ('create_media_batch',
  'update_media_batch') AND has_function_privilege('public', oid, 'EXECUTE')), 0,
  'create_media_batch et update_media_batch : EXECUTE retiré à PUBLIC');
SELECT is((SELECT count(*)::int FROM pg_proc WHERE proname = 'create_media_batch'
  AND 'p_status' = ANY (proargnames)), 0, 'create_media_batch n''a aucun paramètre de statut');

-- 2. create_media_batch ------------------------------------------------------------------------------
SELECT pg_temp.as_op('91a001');
SELECT set_config('t91.b1', pg_temp.cmb('91b001')::text, true);
SELECT is((SELECT status || ':' || kind || ':' || quantity || ':' || operator_id::text
             FROM media_batch WHERE id = current_setting('t91.b1')::uuid),
  'ORDERED:PUBLIC:10:' || pg_temp.id('91a001')::text, 'lot créé ORDERED, prestataire de session');
SELECT is((SELECT actor_id FROM media_batch_status_history
            WHERE batch_id = current_setting('t91.b1')::uuid AND to_status = 'ORDERED'),
  pg_temp.id('91e001'), 'l''historique de création porte l''auteur');
SELECT is(pg_temp.state('cmb', $$SELECT pg_temp.cmb('91b011')$$), 'P0002',
  'organisateur d''un autre prestataire : no_data_found');
SELECT is(pg_temp.state('cmb', $$SELECT pg_temp.cmb('91c211')$$), 'P0002',
  'une partie qui n''est pas un organisateur : no_data_found');
SELECT is(pg_temp.state('cmb', $$SELECT pg_temp.cmb('91b001', '91d011')$$), 'P0002',
  'événement d''un autre prestataire : no_data_found');
SELECT is(pg_temp.state('cmb', $$SELECT pg_temp.cmb('91b001', '91d002')$$), 'P0002',
  'événement d''un autre organisateur du même prestataire : no_data_found');
SELECT lives_ok($$SELECT pg_temp.cmb('91b001', '91d001')$$, 'événement de l''organisateur : accepté');
SELECT is(pg_temp.state('cmb', $$SELECT pg_temp.cmb('91b001', NULL, 'PUBLIC', 10, 99)$$), 'CL020',
  'clé inconnue : SQLSTATE de check_batch_key inchangé (CL020)');
SELECT is(pg_temp.state('cmb', $$SELECT pg_temp.cmb('91b001', NULL, 'PUBLIC', 10, 2)$$), 'CL020',
  'clé inactive : CL020');
SELECT is(pg_temp.state('cmb', $$SELECT pg_temp.cmb('91b001', NULL, 'PUBLIC', 10, 1, 500)$$),
  '23514', 'caution sans mode : 23514');
SELECT is(pg_temp.state('cmb', $$SELECT pg_temp.cmb('91b001', NULL, 'PUBLIC', 0)$$), '23514',
  'quantité nulle : 23514');
SELECT is(pg_temp.state('cmb', $$SELECT pg_temp.cmb('91b001', NULL, 'AUTRE')$$), '23514',
  'type hors liste : 23514');
SELECT is(pg_temp.state('cmb', $$SELECT pg_temp.cmb('91b001', NULL, 'PUBLIC', NULL)$$), '23502',
  'quantité absente : 23502');
SELECT is(pg_temp.state('cmb', $$SELECT pg_temp.cmb('91b001', NULL, 'PUBLIC', 10, 1, 0, NULL,
  'DEDICATED')$$), 'CL020', 'clé dédiée sans clé dédiée : CL020 (check_batch_key)');
SELECT is((SELECT count(*)::int FROM media_batch WHERE operator_id = pg_temp.id('91a001')
  AND status <> 'ORDERED'), 0, 'aucun chemin vers un lot non ORDERED');
SELECT is(pg_temp.state('cmb', $$SELECT create_media_batch(pg_temp.id('91b001'), NULL, 'PUBLIC', 1,
  1, NULL, 0, 0, NULL, 'SHARED', 'SINGLE_USE', NULL)$$), 'CL001', 'auteur absent : CL001');
SELECT set_config('app.operator_id', '', true);
SELECT is(pg_temp.state('cmb', $$SELECT pg_temp.cmb('91b001')$$), 'P0002',
  'sans prestataire de session : no_data_found');
SELECT pg_temp.as_op('91a001');

-- 3. update_media_batch ------------------------------------------------------------------------------
CREATE FUNCTION pg_temp.upd(p_changes text, p_batch text DEFAULT NULL) RETURNS void
LANGUAGE sql AS $$
  SELECT update_media_batch(coalesce(p_batch::uuid, current_setting('t91.b1')::uuid),
                            p_changes::jsonb, pg_temp.id('91e001'))
$$;
SELECT lives_ok($$SELECT pg_temp.upd('{"quantity": 25}')$$, 'quantity modifiable');
SELECT is((SELECT quantity FROM media_batch WHERE id = current_setting('t91.b1')::uuid), 25,
  'quantity écrite');
SELECT lives_ok($$SELECT pg_temp.upd('{"print_order_ref": "ref-2"}')$$, 'print_order_ref modifiable');
SELECT is((SELECT print_order_ref FROM media_batch WHERE id = current_setting('t91.b1')::uuid),
  'ref-2', 'print_order_ref écrite');
SELECT lives_ok($$SELECT pg_temp.upd('{"preload_promo_amount": 300}')$$, 'préchargement modifiable');
SELECT is((SELECT preload_promo_amount FROM media_batch WHERE id = current_setting('t91.b1')::uuid),
  300::bigint, 'preload_promo_amount écrit');
SELECT lives_ok($$SELECT pg_temp.upd('{"deposit_amount": 500, "deposit_mode": "SEPARATE"}')$$,
  'caution modifiable');
SELECT is((SELECT deposit_amount || ':' || deposit_mode FROM media_batch
            WHERE id = current_setting('t91.b1')::uuid), '500:SEPARATE', 'caution écrite');
SELECT lives_ok($$SELECT pg_temp.upd('{"reuse_policy": "POOL"}')$$, 'reuse_policy modifiable');
SELECT is((SELECT reuse_policy FROM media_batch WHERE id = current_setting('t91.b1')::uuid),
  'POOL', 'reuse_policy écrite');
-- clé absente = colonne inchangée ; null JSON = NULL.
SELECT lives_ok($$SELECT pg_temp.upd('{"quantity": 26}')$$, 'une seule clé');
SELECT is((SELECT quantity || ':' || deposit_mode || ':' || print_order_ref FROM media_batch
            WHERE id = current_setting('t91.b1')::uuid), '26:SEPARATE:ref-2',
  'clés absentes : colonnes inchangées');
SELECT lives_ok($$SELECT pg_temp.upd('{"deposit_amount": 0, "deposit_mode": null,
  "print_order_ref": null}')$$, 'null JSON accepté');
SELECT is((SELECT (deposit_mode IS NULL)::text || (print_order_ref IS NULL)::text FROM media_batch
            WHERE id = current_setting('t91.b1')::uuid), 'truetrue', 'null JSON efface les colonnes');
SELECT is((SELECT actor_id FROM media_batch_status_history WHERE batch_id = current_setting('t91.b1')::uuid
  AND to_status = 'ORDERED'), pg_temp.id('91e001'), 'historique inchangé par les modifications');
-- Clés hors liste blanche et formes refusées : CL056, rien n'est écrit.
SELECT is(pg_temp.state('u', $$SELECT pg_temp.upd('{"status": "CLOSED"}')$$), 'CL056', 'status : CL056');
SELECT is(pg_temp.state('u', $$SELECT pg_temp.upd('{"key_index": 1}')$$), 'CL056', 'key_index : CL056');
SELECT is(pg_temp.state('u', $$SELECT pg_temp.upd('{"organizer_id": "91b002"}')$$), 'CL056',
  'organizer_id : CL056');
SELECT is(pg_temp.state('u', $$SELECT pg_temp.upd('{"event_id": null}')$$), 'CL056', 'event_id : CL056');
SELECT is(pg_temp.state('u', $$SELECT pg_temp.upd('{"operator_id": "91a002"}')$$), 'CL056',
  'operator_id : CL056');
SELECT is(pg_temp.state('u', $$SELECT pg_temp.upd('{"kind": "VIP"}')$$), 'CL056', 'kind : CL056');
SELECT is(pg_temp.state('u', $$SELECT pg_temp.upd('{"key_mode": "DEDICATED"}')$$), 'CL056',
  'key_mode : CL056');
SELECT is(pg_temp.state('u', $$SELECT pg_temp.upd('{"claim_codes_issued_at": "2026-01-01"}')$$),
  'CL056', 'claim_codes_issued_at : CL056');
SELECT is(pg_temp.state('u', $$SELECT pg_temp.upd('{"quantity": 5, "status": "ACTIVE"}')$$), 'CL056',
  'une clé permise ne couvre pas une clé interdite');
SELECT is((SELECT quantity FROM media_batch WHERE id = current_setting('t91.b1')::uuid), 26,
  'refus : rien n''est écrit');
SELECT is(pg_temp.state('u', $$SELECT pg_temp.upd('{}')$$), 'CL056', 'objet vide : CL056');
SELECT is(pg_temp.state('u', $$SELECT pg_temp.upd('null')$$), 'CL056', 'jsonb null : CL056');
SELECT is(pg_temp.state('u', $$SELECT pg_temp.upd('[1]')$$), 'CL056', 'tableau : CL056');
SELECT is(pg_temp.state('u', $$SELECT pg_temp.upd('"x"')$$), 'CL056', 'chaîne : CL056');
SELECT is(pg_temp.state('u', $$SELECT update_media_batch(current_setting('t91.b1')::uuid, NULL,
  pg_temp.id('91e001'))$$), 'CL056', 'SQL NULL : CL056');
SELECT is(pg_temp.state('u', $$SELECT pg_temp.upd('{"quantity": {"a": 1}}')$$), '22P02',
  'valeur imbriquée : refusée (cast), rien n''est écrit');
SELECT is(pg_temp.state('u', $$SELECT pg_temp.upd('{"quantity": 0}')$$), '23514',
  'valeur interdite par les CHECK : 23514');
SELECT is(pg_temp.state('u', $$SELECT pg_temp.upd('{"quantity": 5}', pg_temp.id('91b9001')::text)$$), 'P0002',
  'lot d''un autre prestataire : no_data_found');
SELECT is(pg_temp.state('u', $$SELECT pg_temp.upd('{"quantity": 5}', pg_temp.id('91b9999')::text)$$), 'P0002',
  'lot inconnu : no_data_found');
-- Hors ORDERED : CL020.
SELECT set_config('t91.b2', pg_temp.cmb('91b001')::text, true);
SELECT set_media_batch_status(current_setting('t91.b2')::uuid, 'PERSONALIZED', NULL,
                              pg_temp.id('91e001'));
SELECT is(pg_temp.state('u', $$SELECT pg_temp.upd('{"quantity": 5}', current_setting('t91.b2'))$$),
  'CL020', 'lot PERSONALIZED : CL020');
SELECT set_media_batch_status(current_setting('t91.b2')::uuid, 'DELIVERED', NULL, pg_temp.id('91e001'));
SELECT set_media_batch_status(current_setting('t91.b2')::uuid, 'ACTIVE', NULL, pg_temp.id('91e001'));
-- Quantité après les codes : CL020 ; les autres champs restent modifiables.
SELECT set_config('t91.b3', pg_temp.cmb('91b001', NULL, 'PUBLIC', 3)::text, true);
SELECT is(issue_claim_codes(current_setting('t91.b3')::uuid,
  ARRAY[sha256('\x01'), sha256('\x02'), sha256('\x03')], 1::smallint), 3, 'issue_claim_codes toujours fonctionnel');
SELECT is(pg_temp.state('u', $$SELECT pg_temp.upd('{"quantity": 4}', current_setting('t91.b3'))$$),
  'CL020', 'quantity après les codes : CL020');
SELECT lives_ok($$SELECT pg_temp.upd('{"print_order_ref": "x"}', current_setting('t91.b3'))$$,
  'print_order_ref reste modifiable après les codes');

-- 4. Statuts de lot -----------------------------------------------------------------------------------
SELECT is(pg_temp.state('s', $$SELECT set_media_batch_status(current_setting('t91.b1')::uuid,
  'CLOSED', 'x', pg_temp.id('91e001'))$$), 'CL020', 'CLOSED par set_media_batch_status : CL020');
SELECT is(pg_temp.state('s', $$SELECT set_media_batch_status(current_setting('t91.b2')::uuid,
  'SUSPENDED', '  ', pg_temp.id('91e001'))$$), 'CL001', 'SUSPENDED sans motif : CL001');
SELECT is(pg_temp.state('s', $$SELECT set_media_batch_status(pg_temp.id('91b9001'),
  'SUSPENDED', 'x', pg_temp.id('91e001'))$$), 'P0002', 'lot d''un autre prestataire : no_data_found');
SELECT is(set_media_batch_status(current_setting('t91.b2')::uuid, 'SUSPENDED', 'enquête',
  pg_temp.id('91e001')), 'SUSPENDED', 'SUSPENDED avec motif : accepté');

-- 5. media_set_status ---------------------------------------------------------------------------------
INSERT INTO media (id, operator_id, kind, token_hash, nfc_uid, wallet_id, status) VALUES
 (pg_temp.id('91d001'), pg_temp.id('91a001'), 'NFC_TAG', sha256('\x91d001'::bytea),
  '\x04910000000001', pg_temp.id('91cb01'), 'ACTIVE'),
 (pg_temp.id('91d002'), pg_temp.id('91a001'), 'NFC_TAG', sha256('\x91d002'::bytea),
  '\x04910000000002', pg_temp.id('91cb02'), 'ACTIVE'),
 (pg_temp.id('91d009'), pg_temp.id('91a002'), 'NFC_TAG', sha256('\x91d009'::bytea),
  '\x04910000000009', pg_temp.id('91cb11'), 'ACTIVE');
CREATE FUNCTION pg_temp.mss(p_media text, p_to text, p_reason text DEFAULT 'motif') RETURNS text
LANGUAGE sql AS $$ SELECT media_set_status(pg_temp.id(p_media), p_to, p_reason, pg_temp.id('91e001')) $$;
SELECT is(pg_temp.state('m', $$SELECT pg_temp.mss('91d001', 'RETIRED')$$), 'CL020', 'RETIRED : CL020');
SELECT is(pg_temp.state('m', $$SELECT pg_temp.mss('91d001', 'DESTROYED')$$), 'CL020', 'DESTROYED : CL020');
SELECT is(pg_temp.state('m', $$SELECT pg_temp.mss('91d001', 'ACTIVE')$$), 'CL020', 'ACTIVE : CL020');
SELECT is(pg_temp.state('m', $$SELECT media_set_status(pg_temp.id('91d001'), NULL, 'x',
  pg_temp.id('91e001'))$$), 'CL020', 'destination nulle : CL020');
SELECT is(pg_temp.state('m', $$SELECT pg_temp.mss('91d001', 'SUSPENDED', '')$$), 'CL001', 'motif vide : CL001');
SELECT is(pg_temp.state('m', $$SELECT pg_temp.mss('91d001', 'SUSPENDED', '   ')$$), 'CL001',
  'motif d''espaces : CL001');
SELECT is(pg_temp.state('m', $$SELECT pg_temp.mss('91d009', 'SUSPENDED')$$), 'P0002',
  'bracelet d''un autre prestataire : no_data_found');
SELECT is((SELECT status FROM media WHERE id = pg_temp.id('91d001')), 'ACTIVE',
  'les refus n''ont rien écrit');
SELECT is(pg_temp.mss('91d001', 'SUSPENDED'), 'SUSPENDED', 'SUSPENDED passe');
SELECT is((SELECT status FROM media WHERE id = pg_temp.id('91d001')), 'SUSPENDED', 'SUSPENDED écrit');
SELECT is(pg_temp.mss('91d002', 'BLACKLISTED'), 'BLACKLISTED', 'BLACKLISTED passe');
SELECT is((SELECT status FROM media WHERE id = pg_temp.id('91d002')), 'BLACKLISTED', 'BLACKLISTED écrit');
-- BLACKLISTED -> ACTIVE : refusé hors reinstate_media (sous cashless_app : media_owner_session() faux).
SET LOCAL ROLE cashless_app;
SELECT pg_temp.as_op('91a001');
SELECT is(pg_temp.state('r', $$SELECT pg_temp.mss('91d002', 'ACTIVE')$$), 'CL020',
  'BLACKLISTED -> ACTIVE par media_set_status sous cashless_app : CL020');
-- Mission 11a, WP03 : le droit UPDATE (status) est retiré à cashless_app : refus de droit (42501), plus CL020.
SELECT is(pg_temp.state('r', $$UPDATE media SET status = 'ACTIVE' WHERE id = pg_temp.id('91d002')$$),
  '42501', 'BLACKLISTED -> ACTIVE par UPDATE direct sous cashless_app : 42501 (droit retiré)');
RESET ROLE;
SELECT is((SELECT status FROM media WHERE id = pg_temp.id('91d002')), 'BLACKLISTED',
  'le bracelet reste en liste noire');

-- 6. Mutation (NFR-004) : sans la limite de destination, RETIRED passerait -----------------------------
CREATE FUNCTION pg_temp.mutation() RETURNS text LANGUAGE plpgsql AS $$
DECLARE v_src text;
BEGIN
  SELECT pg_get_functiondef('media_set_status(uuid, text, text, uuid)'::regprocedure) INTO v_src;
  v_src := replace(v_src, 'IF p_to IS NULL OR p_to NOT IN (''SUSPENDED'', ''BLACKLISTED'') THEN',
                          'IF false THEN');
  IF v_src NOT LIKE '%IF false THEN%' THEN RETURN 'MUTATION_NOT_APPLIED'; END IF;
  EXECUTE v_src;
  PERFORM media_set_status(pg_temp.id('91d001'), 'RETIRED', 'motif', pg_temp.id('91e001'));
  RAISE EXCEPTION 'MUTATION_PASSED';
EXCEPTION WHEN raise_exception THEN RETURN SQLERRM;
          WHEN OTHERS THEN RETURN 'refused ' || SQLSTATE;
END $$;
SELECT is(pg_temp.mutation(), 'MUTATION_PASSED',
  'MUTATION : sans la limite, RETIRED passe : le test « RETIRED : CL020 » la détecte');
SELECT is(pg_temp.state('m', $$SELECT pg_temp.mss('91d001', 'RETIRED')$$), 'CL020',
  'limite de retour après la mutation annulée');

SELECT * FROM finish();
ROLLBACK;
