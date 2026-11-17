-- Correspondance comptable (migration 0088, mission 9b, lot WP05 ; FR-023, C-007) — pgTAP, suite du propriétaire.
-- Les comptes ci-dessous sont des fixtures INDICATIVES (§12.3), pas un jeu SYSCOHADA livré.
\set ON_ERROR_STOP 1
\set QUIET 1
BEGIN;
\ir _grants_for_tests.sql
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

CREATE FUNCTION pg_temp.id(p text) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT ('00000000-0000-0000-0000-' || lpad(p, 12, '0'))::uuid $$;

INSERT INTO party (kind, legal_name) SELECT 'PLATFORM', 'Plateforme (test)' WHERE NOT EXISTS (SELECT 1 FROM party WHERE kind = 'PLATFORM');
INSERT INTO party (id, kind, legal_name, country_code) VALUES
 (pg_temp.id('88a001'), 'OPERATOR', 'Prestataire A', 'SN'), (pg_temp.id('88a002'), 'OPERATOR', 'Prestataire B', 'SN');
INSERT INTO party (id, kind, operator_id, legal_name) VALUES
 (pg_temp.id('88b001'), 'ORGANIZER', pg_temp.id('88a001'), 'Org A'), (pg_temp.id('88b002'), 'ORGANIZER', pg_temp.id('88a002'), 'Org B');
SELECT set_config('app.operator_id', pg_temp.id('88a001')::text, true);

SELECT has_table('account_mapping');
SELECT is((SELECT count(*) FROM pg_class WHERE relname = 'account_mapping' AND relrowsecurity AND relforcerowsecurity),
  1::bigint, 'RLS ENABLE + FORCE');
SELECT is((SELECT count(*) FROM pg_policies WHERE tablename = 'account_mapping' AND policyname = 'tenant_isolation'),
  1::bigint, 'politique tenant_isolation');
SELECT is((SELECT count(*) FROM account_mapping), 0::bigint, 'aucun jeu livré (C-007)');

SELECT is(create_account_mapping_version(pg_temp.id('88a001'), pg_temp.id('88b001'), '2026-01-01', $j$[
  {"purpose": "TOPUP", "transaction_type": null, "debit_account": "521000", "credit_account": "419100"},
  {"purpose": "TOPUP", "transaction_type": "TOPUP_CASH", "debit_account": "571000", "credit_account": "419100"},
  {"purpose": "FEE", "debit_account": "419100", "credit_account": "706000"}]$j$, pg_temp.id('88aa01')),
  1, 'version 1');
SELECT is(create_account_mapping_version(pg_temp.id('88a001'), pg_temp.id('88b001'), '2026-02-01',
  '[{"purpose": "TOPUP", "debit_account": "521001", "credit_account": "419100"}]', pg_temp.id('88aa01')), 2, 'version 2');
SELECT is((SELECT count(*) FROM account_mapping WHERE version = 1), 3::bigint, 'version 1 : trois lignes, conservée');
SELECT is((SELECT count(*) FROM account_mapping WHERE version = 1 AND transaction_type IS NULL), 2::bigint,
  'transaction_type nul = tous');
SELECT throws_ok($$SELECT create_account_mapping_version(pg_temp.id('88a001'), pg_temp.id('88b001'), '2026-02-01',
  '[{"purpose": "X", "debit_account": "1", "credit_account": "2"}]', pg_temp.id('88aa01'))$$, 'CL001', NULL,
  'valid_from égal à la version précédente : refusé');
SELECT throws_ok($$SELECT create_account_mapping_version(pg_temp.id('88a001'), pg_temp.id('88b001'), '2025-01-01',
  '[{"purpose": "X", "debit_account": "1", "credit_account": "2"}]', pg_temp.id('88aa01'))$$, 'CL001', NULL,
  'valid_from antérieur : refusé');
SELECT throws_ok($$SELECT create_account_mapping_version(pg_temp.id('88a001'), pg_temp.id('88b001'), '2026-03-01', '[
  {"purpose": "X", "debit_account": "1", "credit_account": "2"},
  {"purpose": "X", "debit_account": "3", "credit_account": "4"}]', pg_temp.id('88aa01'))$$, 'CL001', NULL,
  'doublon (finalité, type) : refusé');
SELECT throws_ok($$SELECT create_account_mapping_version(pg_temp.id('88a001'), pg_temp.id('88b001'), '2026-03-01', '[]',
  pg_temp.id('88aa01'))$$, 'CL001', NULL, 'aucune ligne : refusé');
SELECT throws_ok($$SELECT create_account_mapping_version(pg_temp.id('88a001'), pg_temp.id('88b001'), '2026-03-01',
  '[{"purpose": "X", "debit_account": "1", "credit_account": "2"}]', NULL)$$, 'CL001', NULL, 'auteur obligatoire');
SELECT is((SELECT max(version) FROM account_mapping), 2, 'les refus n''ont pas créé de version (pas de saut)');
SELECT throws_ok($$UPDATE account_mapping SET debit_account = '9'$$, 'CL001', NULL, 'UPDATE refusé');
SELECT throws_ok($$DELETE FROM account_mapping$$, 'CL001', NULL, 'DELETE refusé');
SELECT throws_ok($$TRUNCATE account_mapping$$, 'CL001', NULL, 'TRUNCATE refusé');
SELECT throws_ok($$INSERT INTO account_mapping (operator_id, entity_party_id, version, valid_from, purpose,
  transaction_type, debit_account, credit_account, created_by) VALUES (pg_temp.id('88a001'), pg_temp.id('88b001'), 3,
  now(), 'X', '*', '1', '2', pg_temp.id('88aa01'))$$, '23514', NULL, 'type "*" interdit (sentinelle)');
SELECT throws_ok($$INSERT INTO account_mapping (operator_id, entity_party_id, version, valid_from, purpose,
  transaction_type, debit_account, credit_account, created_by) VALUES (pg_temp.id('88a001'), pg_temp.id('88b001'), 3,
  now(), 'X', NULL, repeat('9', 33), '2', pg_temp.id('88aa01'))$$, '23514', NULL, 'compte de plus de 32 caractères refusé');
SELECT throws_ok($$INSERT INTO account_mapping (operator_id, entity_party_id, version, valid_from, purpose,
  transaction_type, debit_account, credit_account, created_by) VALUES (pg_temp.id('88a001'), pg_temp.id('88b001'), 2,
  now(), 'TOPUP', NULL, '1', '2', pg_temp.id('88aa01'))$$, '23505', NULL, 'clé en double (coalesce du type) refusée');

-- Isolation : entité d'un autre prestataire, contexte d'un autre prestataire, RLS
SELECT throws_ok($$SELECT create_account_mapping_version(pg_temp.id('88a001'), pg_temp.id('88b002'), '2026-01-01',
  '[{"purpose": "X", "debit_account": "1", "credit_account": "2"}]', pg_temp.id('88aa01'))$$, 'CL001', NULL,
  'entité d''un autre prestataire : refusée');
SELECT throws_ok($$SELECT create_account_mapping_version(pg_temp.id('88a002'), pg_temp.id('88b002'), '2026-01-01',
  '[{"purpose": "X", "debit_account": "1", "credit_account": "2"}]', pg_temp.id('88aa01'))$$, 'P0002', NULL,
  'prestataire autre que celui de la session : refusé (assert_tenant)');
SELECT is(create_account_mapping_version(pg_temp.id('88a001'), pg_temp.id('88a001'), '2026-01-01',
  '[{"purpose": "X", "debit_account": "1", "credit_account": "2"}]', pg_temp.id('88aa01')), 1,
  'le prestataire lui-même est une entité valide, version propre à l''entité');
SELECT set_config('app.operator_id', pg_temp.id('88a002')::text, true);
SELECT is(create_account_mapping_version(pg_temp.id('88a002'), pg_temp.id('88b002'), '2026-01-01',
  '[{"purpose": "X", "debit_account": "1", "credit_account": "2"}]', pg_temp.id('88aa02')), 1, 'B : sa propre version 1');
-- RLS sous un rôle sans privilège de contournement
CREATE ROLE am88_reader NOSUPERUSER NOBYPASSRLS NOLOGIN;
GRANT SELECT ON account_mapping TO am88_reader;
GRANT SELECT ON party TO am88_reader;
SET LOCAL ROLE am88_reader;
SELECT is((SELECT count(*) FROM account_mapping WHERE operator_id <> pg_temp.id('88a002')), 0::bigint,
  'RLS : B ne voit aucune ligne de A');
SELECT is((SELECT count(*) FROM account_mapping), 1::bigint, 'RLS : B voit ses lignes seulement');
RESET ROLE;
SELECT finish();
ROLLBACK;
