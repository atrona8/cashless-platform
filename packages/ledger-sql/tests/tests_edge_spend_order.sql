-- Migration 0069 (mission passerelle-locale, lot WP25 partie A ; décisions 45 et 50, ADR-185 et ADR-187) — pgTAP,
-- écrit à la main, SOUS LE PROPRIÉTAIRE. Lancer depuis packages/ledger-sql :
--   pg_prove -d <base> tests/tests_edge_spend_order.sql
--   1. edge_terms porte spend_order : PROMO_FIRST par défaut, PAID_FIRST quand la cascade le règle (niveau le plus
--      précis, comme edge_spend_promo_first du rejeu central) ; jamais celui d'un autre événement.
--   2. edge_sync_batch_begin : lot sans opération (to = from - 1) : accepté à la bonne époque et au bon numéro de
--      départ, idempotent ; refusé à la mauvaise époque (CL015), au mauvais numéro (CL016), passerelle révoquée
--      (CL013) ; les lots à opérations gardent leur contrôle (intervalle inversé de plus d'un cran : CL001).
\set ON_ERROR_STOP 1
\set QUIET 1
BEGIN ISOLATION LEVEL REPEATABLE READ;
\ir _grants_for_tests.sql
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();
SET CONSTRAINTS ALL IMMEDIATE;

CREATE FUNCTION pg_temp.id(p text) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT ('00000000-0000-0000-0000-' || lpad(p, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.ctx(p_op text, p_gw text) RETURNS void LANGUAGE sql AS
  $$ SELECT set_config('app.operator_id', pg_temp.id(p_op)::text, true),
            set_config('app.gateway_id', pg_temp.id(p_gw)::text, true) $$;
CREATE FUNCTION pg_temp.sha(p text) RETURNS bytea LANGUAGE sql IMMUTABLE AS
  $$ SELECT sha256(convert_to(p, 'UTF8')) $$;
CREATE FUNCTION pg_temp.so(p_gw text) RETURNS text LANGUAGE sql AS
  $$ SELECT edge_replication_terms(pg_temp.id(p_gw)) ->> 'spend_order' $$;

INSERT INTO party (kind, legal_name) SELECT 'PLATFORM', 'Plateforme (test)'
 WHERE NOT EXISTS (SELECT 1 FROM party WHERE kind = 'PLATFORM');
INSERT INTO party (id, kind, legal_name, country_code) VALUES (pg_temp.id('69a001'), 'OPERATOR', 'Prestataire A', 'SN');
INSERT INTO party (id, kind, operator_id, legal_name)
VALUES (pg_temp.id('69b001'), 'ORGANIZER', pg_temp.id('69a001'), 'Organisateur A');
INSERT INTO jurisdiction_profile (id, country_code, version, valid_from, breakage_destination)
VALUES (pg_temp.id('69c001'), 'SN', 690069, '2026-01-01', 'ORGANIZER');
CREATE FUNCTION pg_temp.mk_event(p_event text, p_gw text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('app.operator_id', pg_temp.id('69a001')::text, true);
  INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone, jurisdiction_id, funds_holder, status)
  VALUES (pg_temp.id(p_event), pg_temp.id('69a001'), pg_temp.id('69b001'), 'Événement ' || p_event, 'XOF',
          'Africa/Dakar', pg_temp.id('69c001'), 'ORGANIZER', 'LIVE');
  PERFORM open_event_ledger(pg_temp.id(p_event));
  INSERT INTO edge_gateway (id, operator_id, event_id, serial, role, registered_at)
  VALUES (pg_temp.id(p_gw), pg_temp.id('69a001'), pg_temp.id(p_event), 'W69-' || p_gw, 'PRIMARY', now() - interval '1 day');
END $$;
SELECT pg_temp.mk_event('69d001', '69e001');
SELECT pg_temp.mk_event('69d002', '69e002');
SELECT pg_temp.mk_event('69d003', '69e003');
SELECT pg_temp.ctx('69a001', '69e001');

-- 1. spend_order -----------------------------------------------------------------------------------------------
SELECT is(pg_temp.so('69e001'), 'PROMO_FIRST', 'aucun réglage : PROMO_FIRST (défaut du central)');
INSERT INTO config_version (operator_id, scope_type, scope_id, version, valid_from, settings)
VALUES (pg_temp.id('69a001'), 'EVENT', pg_temp.id('69d001'), 1, now() - interval '1 hour', '{"spend_order": "PAID_FIRST"}');
SELECT is(pg_temp.so('69e001'), 'PAID_FIRST', 'réglage de l''événement PAID_FIRST : servi tel quel');
SELECT is(pg_temp.so('69e002'), 'PROMO_FIRST', 'l''autre événement du même prestataire garde PROMO_FIRST');
INSERT INTO config_version (operator_id, scope_type, scope_id, version, valid_from, settings)
VALUES (pg_temp.id('69a001'), 'EVENT', pg_temp.id('69d001'), 2, now() - interval '1 minute', '{"spend_order": "PROMO_FIRST"}');
SELECT is(pg_temp.so('69e001'), 'PROMO_FIRST', 'dernière version de l''événement : PROMO_FIRST');
SELECT is(edge_spend_promo_first(
  (SELECT id FROM ledger WHERE scope_id = pg_temp.id('69d001')), now()), true,
  'même réponse que la fonction du rejeu central (edge_spend_promo_first)');

-- 2. lot sans opération ----------------------------------------------------------------------------------------
SELECT pg_temp.ctx('69a001', '69e002');
SELECT is((SELECT state || '/' || already_done FROM edge_sync_batch_begin(pg_temp.id('69e002'), pg_temp.id('69f001'),
   0, 1, 0, pg_temp.sha('vide-1'), 1)), 'PROCESSING/false', 'lot vide (from 1, to 0), époque 0 du grand livre : accepté');
SELECT is((SELECT edge_seq_from || '-' || edge_seq_to FROM edge_sync_batch WHERE batch_id = pg_temp.id('69f001')),
  '1-0', 'intervalle vide enregistré tel quel');
SELECT lives_ok($$SELECT edge_sync_batch_finish(pg_temp.id('69f001'), 'DONE')$$,
  'un lot vide se clôt DONE sans résultat (0 numéro attendu)');
SELECT is((SELECT state || '/' || already_done FROM edge_sync_batch_begin(pg_temp.id('69e002'), pg_temp.id('69f001'),
   0, 1, 0, pg_temp.sha('vide-1'), 1)), 'DONE/true', 'renvoi du même lot vide : DONE, déjà fait (idempotent)');
SELECT throws_ok($$SELECT * FROM edge_sync_batch_begin(pg_temp.id('69e002'), pg_temp.id('69f001'), 0, 1, 0,
   pg_temp.sha('vide-AUTRE'), 1)$$, 'CL002', NULL, 'même batch_id, autre empreinte : CL002');
SELECT throws_ok($$SELECT * FROM edge_sync_batch_begin(pg_temp.id('69e002'), pg_temp.id('69f002'), 7, 1, 0,
   pg_temp.sha('vide-2'), 1)$$, 'CL015', NULL, 'lot vide à une époque fausse : CL015');
SELECT throws_ok($$SELECT * FROM edge_sync_batch_begin(pg_temp.id('69e002'), pg_temp.id('69f003'), 0, 5, 4,
   pg_temp.sha('vide-3'), 1)$$, 'CL016', NULL, 'lot vide au mauvais numéro de départ : CL016');
SELECT is((SELECT count(*)::int FROM edge_sync_batch WHERE batch_id IN (pg_temp.id('69f002'), pg_temp.id('69f003'))), 0,
  'les lots vides refusés n''ont rien enregistré');
SELECT throws_ok($$SELECT * FROM edge_sync_batch_begin(pg_temp.id('69e002'), pg_temp.id('69f004'), 0, 5, 3,
   pg_temp.sha('inverse'))$$, 'CL001', NULL, 'intervalle inversé de plus d''un cran : CL001');
-- Décision 51 : lot vide sans ordre local refusé EN BASE (CL001), nombre d'ordres absent, nul ou négatif.
SELECT throws_ok($$SELECT * FROM edge_sync_batch_begin(pg_temp.id('69e002'), pg_temp.id('69f006'), 0, 1, 0,
   pg_temp.sha('vide-5'), 0)$$, 'CL001', NULL, 'lot vide, 0 ordre local : CL001');
SELECT throws_ok($$SELECT * FROM edge_sync_batch_begin(pg_temp.id('69e002'), pg_temp.id('69f006'), 0, 1, 0,
   pg_temp.sha('vide-5'))$$, 'CL001', NULL, 'lot vide, nombre d''ordres non annoncé (défaut) : CL001');
SELECT throws_ok($$SELECT * FROM edge_sync_batch_begin(pg_temp.id('69e002'), pg_temp.id('69f006'), 0, 1, 0,
   pg_temp.sha('vide-5'), NULL)$$, 'CL001', NULL, 'lot vide, nombre d''ordres NULL : CL001');
SELECT is((SELECT count(*)::int FROM edge_sync_batch WHERE batch_id = pg_temp.id('69f006')), 0,
  'le lot vide sans ordre n''a rien enregistré');
SELECT is((SELECT contiguous_edge_seq FROM edge_gateway WHERE id = pg_temp.id('69e002')), 0::bigint,
  'edge_seq du central inchangé par le lot vide');
-- Passerelle révoquée
UPDATE edge_gateway SET status = 'REVOKED' WHERE id = pg_temp.id('69e003');
SELECT pg_temp.ctx('69a001', '69e003');
SELECT throws_ok($$SELECT * FROM edge_sync_batch_begin(pg_temp.id('69e003'), pg_temp.id('69f005'), 0, 1, 0,
   pg_temp.sha('vide-4'), 1)$$, 'CL013', NULL, 'lot vide d''une passerelle révoquée : CL013');

SELECT * FROM finish();
ROLLBACK;
