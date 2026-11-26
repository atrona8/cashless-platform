-- Rendu partiel en espèces au guichet (migration 0100, mission 9c remboursement-partiel-especes, lot WP01 ;
-- FR-005) — pgTAP, écrit à la main. Propriétaire pour la logique ; SET LOCAL ROLE cashless_app pour les droits
-- et l'isolation.
-- Lancer : pg_prove -d <base> tests/tests_cash_partial_refund.sql
\set ON_ERROR_STOP 1
\set QUIET 1
BEGIN;
\ir _grants_for_tests.sql
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

CREATE FUNCTION pg_temp.id(p text) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT ('00000000-0000-0000-0000-' || lpad(p, 12, '0'))::uuid $$;

INSERT INTO party (kind, legal_name) SELECT 'PLATFORM', 'Plateforme (test)'
 WHERE NOT EXISTS (SELECT 1 FROM party WHERE kind = 'PLATFORM');
INSERT INTO party (id, kind, legal_name, country_code) VALUES
 (pg_temp.id('100a01'), 'OPERATOR', 'Prestataire A', 'SN'),
 (pg_temp.id('100a02'), 'OPERATOR', 'Prestataire B', 'CI');
INSERT INTO party (id, kind, operator_id, legal_name) VALUES
 (pg_temp.id('100b01'), 'ORGANIZER', pg_temp.id('100a01'), 'Organisateur A'),
 (pg_temp.id('100b02'), 'ORGANIZER', pg_temp.id('100a02'), 'Organisateur B');
INSERT INTO jurisdiction_profile (id, country_code, version, valid_from, breakage_destination)
VALUES (pg_temp.id('100c01'), 'SN', 990100, '2026-01-01', 'ORGANIZER');
-- La colonne n'est jamais fournie à l'insertion : c'est le défaut qui est éprouvé.
INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone, jurisdiction_id, funds_holder)
VALUES (pg_temp.id('100d01'), pg_temp.id('100a01'), pg_temp.id('100b01'), 'Événement A', 'XOF',
        'Africa/Dakar', pg_temp.id('100c01'), 'ORGANIZER'),
       (pg_temp.id('100d02'), pg_temp.id('100a02'), pg_temp.id('100b02'), 'Événement B', 'XOF',
        'Africa/Dakar', pg_temp.id('100c01'), 'ORGANIZER');

-- 1. Colonne
SELECT has_column('event', 'cash_partial_refund_enabled', 'event.cash_partial_refund_enabled existe');
SELECT col_type_is('event', 'cash_partial_refund_enabled', 'boolean', 'type boolean');
SELECT col_not_null('event', 'cash_partial_refund_enabled', 'NOT NULL');
SELECT col_default_is('event', 'cash_partial_refund_enabled', 'false', 'défaut false');
SELECT is((SELECT cash_partial_refund_enabled FROM event WHERE id = pg_temp.id('100d01')), false,
          'un événement créé sans la colonne a false');
SELECT throws_ok($$UPDATE event SET cash_partial_refund_enabled = NULL WHERE id = pg_temp.id('100d01')$$,
                 '23502', NULL, 'NULL refusé');

-- 2. Index partiel du cumul du jour (prédicat repris mot pour mot par WP04)
SELECT ok(EXISTS (SELECT 1 FROM pg_indexes WHERE tablename = 'journal_transaction'
                   AND indexname = 'journal_transaction_partial_refund_idx'
                   AND indexdef LIKE '%(ledger_id, recorded_at)%'
                   AND indexdef LIKE '%type = ''WALLET_REFUND''%'
                   AND indexdef LIKE '%partial_cash_refund%'),
          'index partiel des rendus partiels présent, sur (ledger_id, recorded_at)');

-- 3. Droits : aucun droit nouveau, le droit de table existant couvre la colonne
SELECT is((SELECT array_agg(p ORDER BY p) FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE',
             'REFERENCES','TRIGGER']) p WHERE has_table_privilege('cashless_app', 'event', p)),
          ARRAY['INSERT','SELECT','UPDATE'], 'cashless_app : droits de table sur event inchangés');
SELECT is((SELECT count(*)::int FROM information_schema.column_privileges
            WHERE table_name = 'event' AND column_name = 'cash_partial_refund_enabled'
              AND grantee = 'cashless_app' AND privilege_type = 'DELETE'), 0, 'aucun droit de suppression');
SELECT is((SELECT array_agg(p ORDER BY p) FROM unnest(ARRAY['SELECT','INSERT','UPDATE','REFERENCES']) p
            WHERE has_column_privilege('cashless_app', 'event', 'cash_partial_refund_enabled', p)),
          ARRAY['INSERT','SELECT','UPDATE'], 'cashless_app : droits de colonne = ceux de la table');
SELECT is((SELECT array_agg(p) FROM unnest(ARRAY['SELECT','INSERT','UPDATE']) p
            WHERE has_table_privilege('cashless_perso', 'event', p)), ARRAY['SELECT'],
          'cashless_perso : lecture seule sur event, inchangé');

-- 4. Isolation entre prestataires (RLS existante)
SET LOCAL ROLE cashless_app;
SELECT set_config('app.operator_id', pg_temp.id('100a01')::text, true);
SELECT is((SELECT count(*)::int FROM event WHERE id IN (pg_temp.id('100d01'), pg_temp.id('100d02'))), 1,
          'le prestataire A ne voit que son événement');
SELECT is((SELECT count(*)::int FROM event WHERE id = pg_temp.id('100d02')), 0,
          'l''événement de B n''est pas lisible sous A');
SELECT is((SELECT cash_partial_refund_enabled FROM event WHERE id = pg_temp.id('100d01')), false,
          'A lit la colonne de son événement');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
