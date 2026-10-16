-- Ouverture d'un portefeuille d'événement (migration 0015) — pgTAP, écrit à la main.
-- Lancer : pg_prove -d <base> tests/tests_event_wallet.sql (base créée par les migrations, roles.sql rejoué).
\set ON_ERROR_STOP 1
\set QUIET 1
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

INSERT INTO party (kind, legal_name) SELECT 'PLATFORM', 'Plateforme (test)' WHERE NOT EXISTS (SELECT 1 FROM party WHERE kind = 'PLATFORM');
INSERT INTO party (id, kind, legal_name, country_code) VALUES
 ('00000000-0000-0000-0000-00000015a001','OPERATOR','Prestataire A','SN'),
 ('00000000-0000-0000-0000-00000015a002','OPERATOR','Prestataire B','CI');
INSERT INTO party (id, kind, operator_id, legal_name) VALUES
 ('00000000-0000-0000-0000-00000015b001','ORGANIZER','00000000-0000-0000-0000-00000015a001','Organisateur A'),
 ('00000000-0000-0000-0000-00000015b002','CUSTOMER','00000000-0000-0000-0000-00000015a001','Festivalier A'),
 ('00000000-0000-0000-0000-00000015b003','CUSTOMER','00000000-0000-0000-0000-00000015a002','Festivalier B');
INSERT INTO jurisdiction_profile (id, country_code, version, valid_from, breakage_destination)
VALUES ('00000000-0000-0000-0000-00000015c001','SN', 150015, '2026-01-01', 'ORGANIZER');
INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone, jurisdiction_id, funds_holder) VALUES
 ('00000000-0000-0000-0000-00000015d001','00000000-0000-0000-0000-00000015a001','00000000-0000-0000-0000-00000015b001','Événement A','XOF','Africa/Dakar',
  '00000000-0000-0000-0000-00000015c001','ORGANIZER'),
 ('00000000-0000-0000-0000-00000015d002','00000000-0000-0000-0000-00000015a001','00000000-0000-0000-0000-00000015b001','Sans grand livre','XOF','Africa/Dakar',
  '00000000-0000-0000-0000-00000015c001','ORGANIZER');
SELECT set_config('app.operator_id', '00000000-0000-0000-0000-00000015a001', true);
SELECT open_event_ledger('00000000-0000-0000-0000-00000015d001');

SELECT is((SELECT count(*)::int FROM pg_proc WHERE proname = 'open_event_wallet' AND NOT prosecdef), 1, 'SECURITY INVOKER');

SET LOCAL ROLE cashless_app;
SELECT set_config('app.operator_id', '00000000-0000-0000-0000-00000015a001', true);
CREATE TEMP TABLE opened ON COMMIT DROP AS SELECT open_event_wallet('00000000-0000-0000-0000-00000015d001') AS anonymous,
                                                  open_event_wallet('00000000-0000-0000-0000-00000015d001', '00000000-0000-0000-0000-00000015b002') AS named;
SELECT is((SELECT w.customer_id FROM wallet w, opened o WHERE w.id = o.anonymous), NULL, 'portefeuille anonyme : aucun titulaire');
SELECT is((SELECT w.customer_id FROM wallet w, opened o WHERE w.id = o.named), '00000000-0000-0000-0000-00000015b002'::uuid, 'portefeuille d''un compte festivalier');
SELECT is((SELECT w.ledger_id FROM wallet w, opened o WHERE w.id = o.anonymous),
          (SELECT id FROM ledger WHERE scope_type = 'EVENT' AND scope_id = '00000000-0000-0000-0000-00000015d001'), 'au grand livre de l''événement');
SELECT is((SELECT string_agg(a.purpose || ':' || a.family || ':' || a.normal_side || ':' || a.allow_negative || ':' || a.hot || ':' || (a.owner_party_id IS NULL), ' ' ORDER BY a.purpose)
             FROM account a, opened o WHERE a.wallet_id = o.anonymous),
          'WALLET_PAID:CLAIM:C:false:false:true WALLET_PROMO:CLAIM:C:false:false:true', 'deux comptes : payé et offert, créditeurs, jamais négatifs ni chauds');
SELECT is((SELECT string_agg(a.code, ' ' ORDER BY a.code) FROM account a, opened o WHERE a.wallet_id = o.anonymous),
          (SELECT 'L-WAL-' || anonymous || '-P L-WAL-' || anonymous || '-X' FROM opened), 'codes du plan de comptes (§5.2)');
SELECT is((SELECT wallet_spendable(anonymous) FROM opened), 0::bigint, 'solde nul à l''ouverture');
SELECT throws_ok($$SELECT open_event_wallet('00000000-0000-0000-0000-00000015d002')$$, 'P0002', NULL, 'événement sans grand livre : refus');
SELECT throws_ok($$SELECT open_event_wallet('00000000-0000-0000-0000-00000015dfff')$$, 'P0002', NULL, 'événement inconnu : refus');
SELECT throws_ok($$SELECT open_event_wallet('00000000-0000-0000-0000-00000015d001', '00000000-0000-0000-0000-00000015b003')$$, 'P0002', NULL,
  'festivalier d''un autre prestataire : refus');
SELECT throws_ok($$SELECT open_event_wallet('00000000-0000-0000-0000-00000015d001', '00000000-0000-0000-0000-00000015b001')$$, 'P0002', NULL,
  'un organisateur n''est pas un festivalier : refus');
-- Session d'un autre prestataire : l'événement de A n'existe pas pour lui.
SELECT set_config('app.operator_id', '00000000-0000-0000-0000-00000015a002', true);
SELECT throws_ok($$SELECT open_event_wallet('00000000-0000-0000-0000-00000015d001')$$, 'P0002', NULL, 'B n''ouvre pas de portefeuille chez A');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
