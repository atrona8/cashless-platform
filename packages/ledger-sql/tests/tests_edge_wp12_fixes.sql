-- Migration 0065 (mission passerelle-locale, lot WP12, cycle 2 ; décisions 36 et 37, ADR-172 et ADR-173) — pgTAP,
-- écrit à la main. Lancer depuis packages/ledger-sql : pg_prove -d <base> tests/tests_edge_wp12_fixes.sql
--   1. Décision 37 : edge_log_release_stuck écrit EDGE_RELEASE_STUCK dans audit_log, seulement pour un rendu
--      réellement bloqué (TO_CENTRAL, RELEASING depuis plus de 10 minutes), une fois, refus sinon ; droits : cashless_maint seul.
--   2. Décision 36 : bloc edge_terms de la page de réplication (dernière page seulement) : plafond de recharge
--      (500 000 par défaut, réglable), frais d'activation (0, une règle, ambigu = clé omise), lots et cautions ;
--      aucune fuite d'un autre événement ni d'un autre prestataire.
\set ON_ERROR_STOP 1
\set QUIET 1
BEGIN ISOLATION LEVEL REPEATABLE READ;
\ir _grants_for_tests.sql
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();
SET CONSTRAINTS ALL IMMEDIATE;

CREATE FUNCTION pg_temp.id(p text) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT ('00000000-0000-0000-0000-' || lpad(p, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.ctx(p_op text) RETURNS void LANGUAGE sql AS
  $$ SELECT set_config('app.operator_id', pg_temp.id(p_op)::text, true) $$;
CREATE FUNCTION pg_temp.st(q text) RETURNS text LANGUAGE plpgsql AS
  $$ BEGIN EXECUTE q; RETURN 'OK'; EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE; END $$;
CREATE FUNCTION pg_temp.lg(p text) RETURNS uuid LANGUAGE sql AS
  $$ SELECT id FROM ledger WHERE scope_type = 'EVENT' AND scope_id = pg_temp.id(p) $$;
CREATE FUNCTION pg_temp.terms(p_op text, p_gw text) RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp.ctx(p_op);
  PERFORM set_config('app.gateway_id', pg_temp.id(p_gw)::text, true);
  RETURN edge_replication_page(pg_temp.id(p_gw), 0, NULL, 200) -> 'edge_terms';
END $$;

INSERT INTO party (kind, legal_name) SELECT 'PLATFORM', 'Plateforme (test)'
 WHERE NOT EXISTS (SELECT 1 FROM party WHERE kind = 'PLATFORM');
INSERT INTO party (id, kind, legal_name, country_code) VALUES
 (pg_temp.id('65a001'), 'OPERATOR', 'Prestataire A', 'SN'), (pg_temp.id('65a002'), 'OPERATOR', 'Prestataire B', 'CI');
INSERT INTO party (id, kind, operator_id, legal_name) VALUES
 (pg_temp.id('65b001'), 'ORGANIZER', pg_temp.id('65a001'), 'Organisateur A'),
 (pg_temp.id('65b011'), 'ORGANIZER', pg_temp.id('65a002'), 'Organisateur B');
INSERT INTO jurisdiction_profile (id, country_code, version, valid_from, breakage_destination)
VALUES (pg_temp.id('65c001'), 'SN', 650065, '2026-01-01', 'ORGANIZER');
CREATE FUNCTION pg_temp.mk_event(p_op text, p_org text, p_event text, p_gw text, p_serial text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp.ctx(p_op);
  INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone, jurisdiction_id, funds_holder, status)
  VALUES (pg_temp.id(p_event), pg_temp.id(p_op), pg_temp.id(p_org), 'Événement ' || p_event, 'XOF',
          'Africa/Dakar', pg_temp.id('65c001'), 'ORGANIZER', 'LIVE');
  PERFORM open_event_ledger(pg_temp.id(p_event));
  INSERT INTO edge_gateway (id, operator_id, event_id, serial, role, registered_at)
  VALUES (pg_temp.id(p_gw), pg_temp.id(p_op), pg_temp.id(p_event), p_serial, 'PRIMARY', now() - interval '1 day');
END $$;
SELECT pg_temp.mk_event('65a001', '65b001', '65d001', '65e001', 'W65-1');
SELECT pg_temp.mk_event('65a001', '65b001', '65d002', '65e002', 'W65-2');
SELECT pg_temp.mk_event('65a002', '65b011', '65d011', '65e011', 'W65-3');

-- 1. Décision 37 -------------------------------------------------------------------------------------------------
SELECT pg_temp.ctx('65a001');
INSERT INTO debit_authority_handover (id, operator_id, ledger_id, edge_gateway_id, direction, status, epoch,
                                      watermark_posting_id, requested_by)
VALUES (pg_temp.id('65f101'), pg_temp.id('65a001'), pg_temp.lg('65d001'), pg_temp.id('65e001'), 'TO_EDGE', 'ACTIVE', 1, 0,
        pg_temp.id('65f901')),
       (pg_temp.id('65f102'), pg_temp.id('65a001'), pg_temp.lg('65d002'), pg_temp.id('65e002'), 'TO_EDGE', 'ACTIVE', 1, 0,
        pg_temp.id('65f901'));
INSERT INTO debit_authority_handover (id, operator_id, ledger_id, edge_gateway_id, direction, edge_handover_id, status,
                                      epoch, requested_by, begun_releasing_at)
VALUES (pg_temp.id('65f001'), pg_temp.id('65a001'), pg_temp.lg('65d001'), pg_temp.id('65e001'), 'TO_CENTRAL',
        pg_temp.id('65f101'), 'RELEASING', 1, pg_temp.id('65f901'), now() - interval '11 minutes'),
       (pg_temp.id('65f002'), pg_temp.id('65a001'), pg_temp.lg('65d002'), pg_temp.id('65e002'), 'TO_CENTRAL',
        pg_temp.id('65f102'), 'RELEASING', 1, pg_temp.id('65f901'), now() - interval '5 minutes');
SELECT is((SELECT prosecdef FROM pg_proc WHERE proname = 'edge_log_release_stuck'), true, 'SECURITY DEFINER');
SELECT ok((SELECT proconfig @> ARRAY['search_path=public, pg_temp'] FROM pg_proc WHERE proname = 'edge_log_release_stuck'),
  'search_path = public, pg_temp');
SELECT is(has_function_privilege('public', 'edge_log_release_stuck(uuid)', 'EXECUTE'), false, 'rien pour PUBLIC');
SELECT is(edge_log_release_stuck(pg_temp.id('65f001')), true, 'rendu bloqué depuis 11 minutes : écrit');
SELECT is((SELECT count(*)::int FROM audit_log WHERE action = 'EDGE_RELEASE_STUCK' AND object_id = pg_temp.id('65f001')::text),
  1, 'une ligne EDGE_RELEASE_STUCK');
SELECT is((SELECT operator_id FROM audit_log WHERE action = 'EDGE_RELEASE_STUCK'), pg_temp.id('65a001'),
  'ligne rattachée au prestataire du rendu');
SELECT is((SELECT after ->> 'gateway_id' FROM audit_log WHERE action = 'EDGE_RELEASE_STUCK'),
  pg_temp.id('65e001')::text, 'la ligne nomme la passerelle');
SELECT is(edge_log_release_stuck(pg_temp.id('65f001')), false, 'deuxième appel : rien de nouveau (idempotent)');
SELECT is((SELECT count(*)::int FROM audit_log WHERE action = 'EDGE_RELEASE_STUCK'), 1, 'toujours une seule ligne');
SELECT throws_ok($$SELECT edge_log_release_stuck(pg_temp.id('65f002'))$$, 'CL013', NULL,
  'rendu en RELEASING depuis 5 minutes : refusé (seuil posé par la base)');
SELECT throws_ok($$SELECT edge_log_release_stuck(gen_random_uuid())$$, 'CL013', NULL, 'handover inconnu : refusé');
UPDATE debit_authority_handover SET status = 'COMPLETED' WHERE id = pg_temp.id('65f001');
SELECT throws_ok($$SELECT edge_log_release_stuck(pg_temp.id('65f001'))$$, 'CL013', NULL, 'rendu terminé : refusé');
SELECT is((SELECT count(*)::int FROM audit_log WHERE action = 'EDGE_RELEASE_STUCK'), 1, 'les refus n''ont rien écrit');
-- Droits par rôle
SELECT is((SELECT count(*)::int FROM pg_roles r WHERE r.rolname LIKE 'cashless\_%'
            AND has_function_privilege(r.rolname, 'edge_log_release_stuck(uuid)', 'EXECUTE')
            AND r.rolname <> 'cashless_maint' AND NOT r.rolsuper
            AND NOT pg_has_role(r.rolname, (SELECT proowner FROM pg_proc WHERE proname = 'edge_log_release_stuck'), 'USAGE')),
  0, 'aucun rôle cashless_* sauf cashless_maint (et le propriétaire) ne l''exécute');
SELECT is(has_function_privilege('cashless_maint', 'edge_log_release_stuck(uuid)', 'EXECUTE'), true,
  'cashless_maint l''exécute');
SELECT is(has_function_privilege('cashless_edge', 'edge_replication_terms(uuid)', 'EXECUTE'), false,
  'edge_replication_terms jamais accordée à cashless_edge');
SELECT is(has_function_privilege('cashless_maint', 'edge_replication_terms(uuid)', 'EXECUTE'), false,
  'edge_replication_terms jamais accordée à cashless_maint');

-- 2. Décision 36 -------------------------------------------------------------------------------------------------
-- Sans règle ni lot : plafond par défaut (0064), frais 0, aucun lot.
SELECT is(pg_temp.terms('65a001', '65e001'), '{"max_cash_topup": 500000, "activation_fee": 0, "spend_order": "PROMO_FIRST", "deposit_batches": []}'::jsonb,
  'défauts : plafond 500 000 (décision 21), frais 0, PROMO_FIRST (0069), aucun lot');
SELECT pg_temp.ctx('65a001');
INSERT INTO tag_key (operator_id, key_index, kms_key_ref, status)
VALUES (pg_temp.id('65a001'), 1, 'test:hmac-65', 'ACTIVE');
INSERT INTO media_batch (id, operator_id, organizer_id, event_id, kind, quantity, key_index, deposit_amount, deposit_mode)
VALUES (pg_temp.id('65aa01'), pg_temp.id('65a001'), pg_temp.id('65b001'), pg_temp.id('65d001'), 'PUBLIC', 5, 1, 3000, 'SEPARATE'),
       (pg_temp.id('65aa02'), pg_temp.id('65a001'), pg_temp.id('65b001'), pg_temp.id('65d001'), 'PUBLIC', 5, 1, 0, NULL),
       (pg_temp.id('65aa03'), pg_temp.id('65a001'), pg_temp.id('65b001'), pg_temp.id('65d002'), 'PUBLIC', 5, 1, 7777, 'FROM_BALANCE');
SELECT is(pg_temp.terms('65a001', '65e001') -> 'deposit_batches',
  '[{"batch_id": "00000000-0000-0000-0000-00000065aa01", "deposit_amount": 3000, "deposit_mode": "SEPARATE"},
    {"batch_id": "00000000-0000-0000-0000-00000065aa02", "deposit_amount": 0, "deposit_mode": null}]'::jsonb,
  'lots de l''événement de la passerelle seulement (pas celui de l''autre événement)');
SELECT is(pg_temp.terms('65a001', '65e002') -> 'deposit_batches',
  '[{"batch_id": "00000000-0000-0000-0000-00000065aa03", "deposit_amount": 7777, "deposit_mode": "FROM_BALANCE"}]'::jsonb,
  'autre événement : ses lots');
-- Frais d'activation : une règle (borne minimale appliquée), puis deux règles : clé omise.
INSERT INTO fee_rule (operator_id, scope_type, scope_id, payer_purpose, beneficiary_purpose, basis, fixed_amount, min_amount,
                      trigger, valid_from)
VALUES (pg_temp.id('65a001'), 'EVENT', pg_temp.id('65d001'), 'ORG_FFEST', 'ORG_FFEST', 'PER_MEDIA', 200, 300, 'REALTIME',
        now() - interval '1 day');
SELECT is((pg_temp.terms('65a001', '65e001') ->> 'activation_fee')::bigint, 300::bigint, 'une règle : montant borné par min');
SELECT is(pg_temp.terms('65a001', '65e002') -> 'activation_fee', '0'::jsonb, 'règle d''un autre événement : ignorée');
INSERT INTO fee_rule (operator_id, scope_type, scope_id, payer_purpose, beneficiary_purpose, basis, fixed_amount,
                      trigger, valid_from, version)
VALUES (pg_temp.id('65a001'), 'EVENT', pg_temp.id('65d001'), 'ORG_FFEST', 'ORG_FFEST', 'PER_MEDIA', 100, 'REALTIME',
        now() - interval '1 day', 2);
SELECT is(pg_temp.terms('65a001', '65e001') ? 'activation_fee', false, 'deux règles en vigueur : clé omise (échec fermé)');
-- Plafond réglable
SELECT set_edge_setting('replay_max_per_cash_topup', 250000, 'test WP12');
SELECT is((pg_temp.terms('65a001', '65e001') ->> 'max_cash_topup')::bigint, 250000::bigint, 'plafond réglé : 250 000');
-- Dernière page seulement
SELECT pg_temp.ctx('65a001');
SELECT set_config('app.gateway_id', pg_temp.id('65e001')::text, true);
SELECT ok(edge_replication_page(pg_temp.id('65e001'), 0, NULL, 200) ? 'edge_terms', 'dernière page : edge_terms présent');
-- Prestataire B ne voit rien de A
SELECT pg_temp.ctx('65a002');
SELECT throws_ok($$SELECT edge_replication_terms(pg_temp.id('65e001'))$$, 'P0002', NULL,
  'l''aide interne refuse la passerelle d''un autre prestataire');

SELECT * FROM finish();
ROLLBACK;
