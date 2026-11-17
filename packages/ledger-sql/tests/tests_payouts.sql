-- Base des versements (migration 0085 ; mission versements-rapprochements-cloture, lot WP03) — pgTAP, écrit à la main.
-- Propriétaire seulement : aucun droit n'est accordé ici (post-roles.sql, section 12, lot WP06).
-- Couvre FR-009, FR-010, FR-012, NFR-001, SC-002 (borne CL055), transitions, écritures, rejeu, isolation.
-- Lancer : pg_prove -d <base> tests/tests_payouts.sql
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
 (pg_temp.id('85a001'), 'OPERATOR', 'Prestataire A', 'SN'),
 (pg_temp.id('85a002'), 'OPERATOR', 'Prestataire B', 'SN');
INSERT INTO party (id, kind, operator_id, legal_name) VALUES
 (pg_temp.id('85b001'), 'ORGANIZER', pg_temp.id('85a001'), 'Organisateur A'),
 (pg_temp.id('85b002'), 'ORGANIZER', pg_temp.id('85a002'), 'Organisateur B'),
 (pg_temp.id('85b003'), 'ORGANIZER', pg_temp.id('85a001'), 'Organisateur A2'),
 (pg_temp.id('85c001'), 'MERCHANT', pg_temp.id('85a001'), 'Commerçant 1'),
 (pg_temp.id('85c002'), 'MERCHANT', pg_temp.id('85a001'), 'Commerçant 2');
INSERT INTO jurisdiction_profile (id, country_code, version, valid_from, breakage_destination) VALUES
 (pg_temp.id('85d001'), 'SN', 850085, '2026-01-01', 'ORGANIZER'),
 (pg_temp.id('85d002'), 'SN', 850086, '2026-01-01', 'LEGAL_ACCOUNT');
INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone, jurisdiction_id, funds_holder) VALUES
 (pg_temp.id('85e001'), pg_temp.id('85a001'), pg_temp.id('85b001'), 'Événement A', 'XOF', 'Africa/Dakar',
  pg_temp.id('85d001'), 'ORGANIZER'),
 (pg_temp.id('85e002'), pg_temp.id('85a002'), pg_temp.id('85b002'), 'Événement B', 'XOF', 'Africa/Dakar',
  pg_temp.id('85d001'), 'ORGANIZER'),
 (pg_temp.id('85e003'), pg_temp.id('85a001'), pg_temp.id('85b003'), 'Événement A2 (légal)', 'XOF', 'Africa/Dakar',
  pg_temp.id('85d002'), 'ORGANIZER');
INSERT INTO merchant_participation (id, operator_id, event_id, merchant_id, link_type, payout_to) VALUES
 (pg_temp.id('85f001'), pg_temp.id('85a001'), pg_temp.id('85e001'), pg_temp.id('85c001'), 'EXTERNAL', pg_temp.id('85c001')),
 (pg_temp.id('85f002'), pg_temp.id('85a001'), pg_temp.id('85e001'), pg_temp.id('85c002'), 'EXTERNAL', pg_temp.id('85c002'));
SELECT set_config('app.operator_id', pg_temp.id('85a001')::text, true);
SELECT open_event_ledger(pg_temp.id('85e001'));
SELECT open_event_ledger(pg_temp.id('85e003'));
SELECT open_participation_account(pg_temp.id('85f001'));
SELECT open_participation_account(pg_temp.id('85f002'));
SELECT set_config('app.operator_id', pg_temp.id('85a002')::text, true);
SELECT open_event_ledger(pg_temp.id('85e002'));
SELECT set_config('app.operator_id', pg_temp.id('85a001')::text, true);

CREATE TEMP TABLE fx AS
SELECT (SELECT id FROM ledger WHERE scope_id = pg_temp.id('85e001')) AS la,
       (SELECT id FROM ledger WHERE scope_id = pg_temp.id('85e002')) AS lb,
       (SELECT id FROM ledger WHERE scope_id = pg_temp.id('85e003')) AS ll;
CREATE FUNCTION pg_temp.acc(p_ledger uuid, p_code text) RETURNS uuid LANGUAGE sql AS
  $$ SELECT id FROM account WHERE ledger_id = p_ledger AND code = p_code $$;
-- Solde signé d'un compte (débit positif)
CREATE FUNCTION pg_temp.bal(p_ledger uuid, p_code text) RETURNS bigint LANGUAGE sql AS
  $$ SELECT coalesce(sum(p.amount), 0)::bigint FROM posting p WHERE p.account_id = pg_temp.acc(p_ledger, p_code) $$;
CREATE FUNCTION pg_temp.net(p_ledger uuid, p_party uuid) RETURNS bigint LANGUAGE sql AS
  $$ SELECT coalesce((SELECT net_claim FROM party_position WHERE ledger_id = p_ledger AND owner_party_id = p_party), 0)::bigint $$;
-- Comptes d'argent de sortie (créés par les missions de paiement ; ici à la main)
INSERT INTO account (operator_id, ledger_id, code, family, purpose, normal_side, allow_negative)
SELECT pg_temp.id('85a001'), l, c, 'ASSET', 'PSP', 'D', true
  FROM (SELECT la AS l FROM fx UNION ALL SELECT ll FROM fx) x, (VALUES ('A-PSP-WAVE'), ('A-PSP-OM')) v(c);
-- Demandes d'approbation (lots)
-- Les demandes naissent PENDING (déclencheur de 0017) ; on les amène à l'état voulu par UPDATE (propriétaire).
INSERT INTO approval_request (id, operator_id, action, target_id, payload, requested_by)
SELECT pg_temp.id('85ab0' || n), pg_temp.id('85a001'), 'PAYOUT', (SELECT la FROM fx), '{}', pg_temp.id('85aaa1')
  FROM generate_series(1, 9) n;
INSERT INTO approval_request (id, operator_id, action, target_id, payload, requested_by) VALUES
 (pg_temp.id('85abb1'), pg_temp.id('85a002'), 'PAYOUT', (SELECT lb FROM fx), '{}', pg_temp.id('85aaa1')),
 (pg_temp.id('85abc1'), pg_temp.id('85a001'), 'PAYOUT', (SELECT la FROM fx), '{}', pg_temp.id('85aaa1')),
 (pg_temp.id('85abc2'), pg_temp.id('85a001'), 'PAYOUT', (SELECT la FROM fx), '{}', pg_temp.id('85aaa1')),
 (pg_temp.id('85abc3'), pg_temp.id('85a001'), 'ADJUSTMENT', (SELECT la FROM fx), '{}', pg_temp.id('85aaa1')),
 (pg_temp.id('85abc4'), pg_temp.id('85a001'), 'PAYOUT', (SELECT la FROM fx), '{}', pg_temp.id('85aaa1')),
 (pg_temp.id('85abc5'), pg_temp.id('85a001'), 'PAYOUT', (SELECT la FROM fx), '{}', pg_temp.id('85aaa1'));
UPDATE approval_request SET status = 'APPROVED', decided_by = pg_temp.id('85aaa2'), decided_at = now()
 WHERE id NOT IN (pg_temp.id('85abc1'), pg_temp.id('85abc2'), pg_temp.id('85abc4'));
UPDATE approval_request SET status = 'REJECTED', decided_by = pg_temp.id('85aaa2'), decided_at = now()
 WHERE id = pg_temp.id('85abc2');
UPDATE approval_request SET status = 'APPROVED', decided_by = pg_temp.id('85aaa5'), decided_at = now()
 WHERE id = pg_temp.id('85abc4');
UPDATE approval_request SET status = 'EXECUTED' WHERE id = pg_temp.id('85abc5');

-- Droits : organisateur 39 225 ; prestataire 4 000 ; plateforme 1 017 ; commerçants 11 400 et 8 000 ; légal 600.
CREATE FUNCTION pg_temp.fund(p_ledger uuid, p_code text, p_amount bigint, p_key text) RETURNS void LANGUAGE sql AS $$
  SELECT post_transaction(p_ledger, 'ADJUSTMENT', p_key, clock_timestamp(), 'BACKOFFICE',
    jsonb_build_array(jsonb_build_object('account_id', pg_temp.acc(p_ledger, 'S-ATTENTE'), 'amount', p_amount),
                      jsonb_build_object('account_id', pg_temp.acc(p_ledger, p_code), 'amount', -p_amount)),
    NULL, NULL, pg_temp.id('85aaa1'), pg_temp.id('85aaa2')) $$;
SELECT pg_temp.fund((SELECT la FROM fx), 'L-ORG-PLACE', 39225, 'f:org');
SELECT pg_temp.fund((SELECT la FROM fx), 'L-OPE-CASSE', 4000, 'f:ope');
SELECT pg_temp.fund((SELECT la FROM fx), 'L-PLT-REDEV', 1017, 'f:plt');
SELECT pg_temp.fund((SELECT la FROM fx), 'L-MCH-' || pg_temp.id('85f001'), 11400, 'f:m1');
SELECT pg_temp.fund((SELECT la FROM fx), 'L-MCH-' || pg_temp.id('85f002'), 8000, 'f:m2');
SELECT pg_temp.fund((SELECT ll FROM fx), 'L-LEGAL-CASSE', 600, 'f:legal');
-- Argent en banque pour les confirmations
SELECT post_transaction((SELECT la FROM fx), 'ADJUSTMENT', 'f:bank', clock_timestamp(), 'BACKOFFICE',
  jsonb_build_array(jsonb_build_object('account_id', pg_temp.acc((SELECT la FROM fx), 'A-BANQUE'), 'amount', 100000),
                    jsonb_build_object('account_id', pg_temp.acc((SELECT la FROM fx), 'S-ATTENTE'), 'amount', -100000)),
  NULL, NULL, pg_temp.id('85aaa1'), pg_temp.id('85aaa2'));

-- Ligne de lot
CREATE FUNCTION pg_temp.ln(p_ben jsonb, p_party uuid, p_amount bigint, p_method text DEFAULT 'BANK_TRANSFER')
RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('beneficiary', p_ben, 'beneficiary_id', p_party, 'amount', p_amount, 'method', p_method)
         || CASE WHEN p_method = 'BANK_TRANSFER' THEN jsonb_build_object('iban', 'SN08SN0100152000048500003035')
                 ELSE jsonb_build_object('msisdn', '+221770000001') END $$;
CREATE FUNCTION pg_temp.batch(p_req text, p_lines jsonb) RETURNS jsonb LANGUAGE sql AS $$
  SELECT create_payout_batch((SELECT la FROM fx), pg_temp.id(p_req), p_lines, pg_temp.id('85aaa1'), pg_temp.id('85aaa2')) $$;

-- ===== Colonnes, CHECK, index
SELECT has_column('payout', c, 'colonne ' || c) FROM unnest(ARRAY['approval_request_id', 'origin_account_id', 'msisdn',
  'iban', 'failure_reason', 'confirmed_by', 'confirmed_at']) c;
SELECT has_index('payout', 'payout_batch_beneficiary', 'un bénéficiaire par lot : index unique');
SELECT throws_like($$INSERT INTO payout (operator_id, ledger_id, beneficiary_id, amount, method, status, initiated_by,
  approved_by, iban, msisdn) SELECT pg_temp.id('85a001'), la, pg_temp.id('85b001'), 10, 'BANK_TRANSFER', 'INITIATED',
  pg_temp.id('85aaa1'), pg_temp.id('85aaa2'), NULL, NULL FROM fx$$, '%payout_destination_bank%',
  'virement sans IBAN refusé');
SELECT throws_like($$INSERT INTO payout (operator_id, ledger_id, beneficiary_id, amount, method, status, initiated_by,
  approved_by, iban, msisdn) SELECT pg_temp.id('85a001'), la, pg_temp.id('85b001'), 10, 'WAVE', 'INITIATED',
  pg_temp.id('85aaa1'), pg_temp.id('85aaa2'), NULL, NULL FROM fx$$, '%payout_destination_mobile%',
  'Wave sans numéro refusé');
SELECT throws_like($$INSERT INTO payout (operator_id, ledger_id, beneficiary_id, amount, method, status, initiated_by,
  approved_by, iban, msisdn) SELECT pg_temp.id('85a001'), la, pg_temp.id('85b001'), 10, 'WAVE', 'INITIATED',
  pg_temp.id('85aaa1'), pg_temp.id('85aaa2'), 'SN08', '+221770000001' FROM fx$$, '%payout_destination_mobile%',
  'Wave avec IBAN refusé');
SELECT throws_like($$INSERT INTO payout (operator_id, ledger_id, beneficiary_id, amount, method, status, initiated_by,
  approved_by, msisdn, failure_reason, confirmed_by, confirmed_at) SELECT pg_temp.id('85a001'), la,
  pg_temp.id('85b001'), 10, 'WAVE', 'FAILED', pg_temp.id('85aaa1'), pg_temp.id('85aaa2'), '+221770000001', NULL,
  pg_temp.id('85aaa1'), now() FROM fx$$, '%payout_failure_reason_iff_failed%', 'échec sans motif refusé');
SELECT throws_like($$INSERT INTO payout (operator_id, ledger_id, beneficiary_id, amount, method, status, initiated_by,
  approved_by, msisdn, failure_reason) SELECT pg_temp.id('85a001'), la, pg_temp.id('85b001'), 10, 'WAVE', 'INITIATED',
  pg_temp.id('85aaa1'), pg_temp.id('85aaa2'), '+221770000001', 'motif' FROM fx$$, '%payout_failure_reason_iff_failed%',
  'motif sur une ligne non échouée refusé');
SELECT throws_like($$INSERT INTO payout (operator_id, ledger_id, beneficiary_id, amount, method, status, initiated_by,
  approved_by, msisdn, confirmed_by) SELECT pg_temp.id('85a001'), la, pg_temp.id('85b001'), 10, 'WAVE', 'INITIATED',
  pg_temp.id('85aaa1'), pg_temp.id('85aaa2'), '+221770000001', pg_temp.id('85aaa1') FROM fx$$, '%payout_confirmed_pair%',
  'confirmed_by sur une ligne INITIATED refusé');
SELECT throws_like($$INSERT INTO payout (operator_id, ledger_id, beneficiary_id, amount, method, status, initiated_by,
  approved_by, msisdn, confirmed_by, confirmed_at, external_ref) SELECT pg_temp.id('85a001'), la, pg_temp.id('85b001'), 10,
  'WAVE', 'CONFIRMED', pg_temp.id('85aaa1'), pg_temp.id('85aaa2'), '+221770000001', pg_temp.id('85aaa1'), now(), ' '
  FROM fx$$, '%payout_confirmed_ref%', 'confirmation sans référence refusée');
SELECT throws_like($$INSERT INTO payout (operator_id, ledger_id, beneficiary_id, amount, method, status, initiated_by,
  approved_by, msisdn) SELECT pg_temp.id('85a001'), la, pg_temp.id('85b001'), 10, 'WAVE', 'INITIATED',
  pg_temp.id('85aaa1'), pg_temp.id('85aaa1'), '+221770000001' FROM fx$$, '%payout_check%',
  'auteur et valideur identiques refusés (CHECK d''origine intact)');
SELECT throws_ok($$INSERT INTO payout (operator_id, ledger_id, beneficiary_id, amount, method, status, initiated_by,
  approved_by, msisdn) SELECT pg_temp.id('85a002'), la, pg_temp.id('85b002'), 10, 'WAVE', 'INITIATED',
  pg_temp.id('85aaa1'), pg_temp.id('85aaa2'), '+221770000001' FROM fx$$, 'CL001', NULL,
  'garde d''insertion : grand livre d''un autre prestataire refusé');

-- ===== Borne du droit net (SC-002)
SELECT is(pg_temp.net((SELECT la FROM fx), pg_temp.id('85b001')), 39225::bigint, 'droit net de l''organisateur : 39 225');
SELECT throws_ok($$SELECT pg_temp.batch('85ab01', jsonb_build_array(
  pg_temp.ln('"ORGANIZER"', pg_temp.id('85b001'), 40000)))$$, 'CL055', NULL, '40 000 pour un droit de 39 225 : refusé');
SELECT is((SELECT count(*) FROM payout WHERE approval_request_id = pg_temp.id('85ab01'))::int, 0, 'refus : aucune ligne écrite');
SELECT is((SELECT count(*) FROM journal_transaction WHERE idempotency_key = 'payout-batch:' || pg_temp.id('85ab01'))::int, 0,
  'refus : aucune transaction');
SELECT throws_ok($$SELECT pg_temp.batch('85ab01', jsonb_build_array(
  pg_temp.ln('"ORGANIZER"', pg_temp.id('85b001'), 30000),
  pg_temp.ln('"OPERATOR"', pg_temp.id('85a001'), 4001, 'WAVE')))$$, 'CL055', NULL,
  'lot dont une seule ligne dépasse : refusé en entier');
SELECT is((SELECT count(*) FROM payout)::int, 0, 'lot refusé : aucune ligne payout (même celle qui passait)');
SELECT is(pg_temp.bal((SELECT la FROM fx), 'L-VERS-ENCOURS'), 0::bigint, 'lot refusé : versements en cours à 0');

CREATE TEMP TABLE r1 AS SELECT pg_temp.batch('85ab02', jsonb_build_array(
  pg_temp.ln('"ORGANIZER"', pg_temp.id('85b001'), 30000),
  pg_temp.ln('"OPERATOR"', pg_temp.id('85a001'), 4000, 'WAVE'),
  pg_temp.ln('"PLATFORM"', (SELECT id FROM party WHERE kind = 'PLATFORM' ORDER BY created_at, id LIMIT 1), 1017, 'ORANGE_MONEY'),
  pg_temp.ln(jsonb_build_object('participation_id', pg_temp.id('85f001')), pg_temp.id('85c001'), 11400))) AS j;
SELECT is((SELECT jsonb_array_length(j -> 'payout_ids') FROM r1), 4, 'lot multi-bénéficiaires : quatre lignes');
SELECT is((SELECT count(*) FROM payout WHERE initiated_tx_id = (SELECT (j ->> 'transaction_id')::uuid FROM r1)
            AND status = 'INITIATED')::int, 4, 'toutes INITIATED, rattachées à la transaction');
SELECT is((SELECT array_agg(x.amount ORDER BY u.o) FROM r1, jsonb_array_elements_text(j -> 'payout_ids')
            WITH ORDINALITY u(pid, o) JOIN payout x ON x.id = u.pid::uuid), ARRAY[30000, 4000, 1017, 11400]::bigint[],
  'payout_ids dans l''ordre des lignes demandées');
SELECT is((SELECT array_agg(p.amount ORDER BY p.line_no) FROM posting p
            WHERE p.transaction_id = (SELECT (j ->> 'transaction_id')::uuid FROM r1)),
  ARRAY[30000, 4000, 1017, 11400, -46417]::bigint[], 'PAYOUT_INITIATED : un débit par bénéficiaire, un crédit du total');
SELECT is((SELECT array_agg(a.code ORDER BY p.line_no) FROM posting p JOIN account a ON a.id = p.account_id
            WHERE p.transaction_id = (SELECT (j ->> 'transaction_id')::uuid FROM r1)),
  ARRAY['L-ORG-VERS', 'L-OPE-VERS', 'L-PLT-VERS', 'L-MCH-' || pg_temp.id('85f001'), 'L-VERS-ENCOURS'],
  'mêmes comptes que buildPayoutInitiated');
SELECT is((SELECT sum(p.amount) FROM posting p WHERE p.transaction_id = (SELECT (j ->> 'transaction_id')::uuid FROM r1))::int, 0,
  'transaction équilibrée');
SELECT is((SELECT created_by::text || '/' || approved_by::text FROM journal_transaction
            WHERE id = (SELECT (j ->> 'transaction_id')::uuid FROM r1)),
  pg_temp.id('85aaa1')::text || '/' || pg_temp.id('85aaa2')::text, 'auteur et valideur portés par la transaction');
SELECT is(pg_temp.net((SELECT la FROM fx), pg_temp.id('85b001')), 9225::bigint, 'droit net diminué des 30 000 initiés');
-- deuxième lot qui cumulerait au-delà
SELECT throws_ok($$SELECT pg_temp.batch('85ab03', jsonb_build_array(
  pg_temp.ln('"ORGANIZER"', pg_temp.id('85b001'), 9226)))$$, 'CL055', NULL, 'deux lots cumulant au-delà du droit : le second refusé');
SELECT lives_ok($$SELECT pg_temp.batch('85ab03', jsonb_build_array(
  pg_temp.ln('"ORGANIZER"', pg_temp.id('85b001'), 9225)))$$, 'montant égal au droit net restant : admis');
SELECT is(pg_temp.net((SELECT la FROM fx), pg_temp.id('85b001')), 0::bigint, 'droit net épuisé');
SELECT throws_ok($$SELECT pg_temp.batch('85ab04', jsonb_build_array(
  pg_temp.ln('"ORGANIZER"', pg_temp.id('85b001'), 1)))$$, 'CL055', NULL, 'droit net nul : tout versement refusé');
-- droit net négatif
SELECT pg_temp.fund((SELECT la FROM fx), 'L-ORG-PLACE', -500, 'f:neg');
SELECT throws_ok($$SELECT pg_temp.batch('85ab04', jsonb_build_array(
  pg_temp.ln('"ORGANIZER"', pg_temp.id('85b001'), 1)))$$, 'CL055', NULL, 'droit net négatif : refusé');
SELECT pg_temp.fund((SELECT la FROM fx), 'L-ORG-PLACE', 500, 'f:neg2');

-- ===== Règlement : échec recrédite, confirmation solde
CREATE TEMP TABLE ids AS
SELECT u.pid::uuid AS pid, u.o::int AS o FROM r1, jsonb_array_elements_text(j -> 'payout_ids') WITH ORDINALITY u(pid, o);
CREATE FUNCTION pg_temp.pid(p_o int) RETURNS uuid LANGUAGE sql AS $$ SELECT pid FROM ids WHERE o = p_o $$;
CREATE FUNCTION pg_temp.settle(p_o int, p_out text, p_ref text, p_reason text, p_actor text DEFAULT '85aaa3')
RETURNS payout LANGUAGE sql AS $$ SELECT settle_payout(pg_temp.pid(p_o), p_out, p_ref, p_reason, pg_temp.id(p_actor)) $$;

-- Entrées invalides
SELECT throws_ok($$SELECT pg_temp.settle(1, 'CONFIRMED', ' ', NULL)$$, 'CL001', NULL, 'confirmation sans référence refusée');
SELECT throws_ok($$SELECT pg_temp.settle(1, 'FAILED', NULL, '  ')$$, 'CL001', NULL, 'échec sans motif refusé');
SELECT throws_ok($$SELECT pg_temp.settle(1, 'PAID', 'x', NULL)$$, 'CL001', NULL, 'résultat hors liste refusé');
SELECT is((SELECT count(*) FROM payout WHERE status <> 'INITIATED')::int, 0, 'refus : aucune ligne modifiée');

-- Confirmation (buildPayoutConfirmed)
SELECT lives_ok($$SELECT pg_temp.settle(1, 'CONFIRMED', 'BANK-1001', NULL)$$, 'confirmation de la ligne 1');
SELECT is((SELECT status || ':' || external_ref || ':' || (settled_tx_id IS NOT NULL) || ':' || confirmed_by::text
             FROM payout WHERE id = pg_temp.pid(1)), 'CONFIRMED:BANK-1001:true:' || pg_temp.id('85aaa3')::text,
  'ligne confirmée : référence, transaction, confirmateur');
SELECT is((SELECT array_agg(a.code || ':' || p.amount ORDER BY p.line_no) FROM posting p JOIN account a ON a.id = p.account_id
            WHERE p.transaction_id = (SELECT settled_tx_id FROM payout WHERE id = pg_temp.pid(1))),
  ARRAY['L-VERS-ENCOURS:30000', 'A-BANQUE:-30000'], 'PAYOUT_CONFIRMED : en cours -> banque');
SELECT is((SELECT type || '/' || source || '/' || idempotency_key FROM journal_transaction
            WHERE id = (SELECT settled_tx_id FROM payout WHERE id = pg_temp.pid(1))),
  'PAYOUT_CONFIRMED/BACKOFFICE/payout:' || pg_temp.pid(1)::text || ':settle', 'type, source et clé de l''écriture');
SELECT is((SELECT created_by::text || '/' || approved_by::text FROM journal_transaction
            WHERE id = (SELECT settled_tx_id FROM payout WHERE id = pg_temp.pid(1))),
  pg_temp.id('85aaa3')::text || '/' || pg_temp.id('85aaa2')::text, 'acteur + valideur du lot : deux personnes distinctes');
-- Rejeu et conflit
SELECT lives_ok($$SELECT pg_temp.settle(1, 'CONFIRMED', 'BANK-1001', NULL)$$, 'rejeu identique accepté');
SELECT is((SELECT count(*) FROM journal_transaction WHERE idempotency_key = 'payout:' || pg_temp.pid(1)::text || ':settle')::int, 1,
  'rejeu : aucune nouvelle écriture');
SELECT throws_ok($$SELECT pg_temp.settle(1, 'CONFIRMED', 'AUTRE-REF', NULL)$$, 'CL029', NULL, 'autre référence : conflit');
SELECT throws_ok($$SELECT pg_temp.settle(1, 'FAILED', NULL, 'raison')$$, 'CL029', NULL, 'CONFIRMED -> FAILED refusé');
-- Acteur = valideur du lot : l'initiateur sert de seconde personne
SELECT lives_ok($$SELECT pg_temp.settle(2, 'CONFIRMED', 'WAVE-2', NULL, '85aaa2')$$, 'confirmation par le valideur du lot');
SELECT is((SELECT created_by::text || '/' || approved_by::text FROM journal_transaction
            WHERE id = (SELECT settled_tx_id FROM payout WHERE id = pg_temp.pid(2))),
  pg_temp.id('85aaa2')::text || '/' || pg_temp.id('85aaa1')::text, 'acteur = valideur : l''initiateur est la seconde personne');
SELECT is((SELECT a.code FROM posting p JOIN account a ON a.id = p.account_id
            WHERE p.transaction_id = (SELECT settled_tx_id FROM payout WHERE id = pg_temp.pid(2)) AND p.amount < 0),
  'A-PSP-WAVE', 'moyen WAVE : compte A-PSP-WAVE crédité');
SELECT lives_ok($$SELECT pg_temp.settle(3, 'CONFIRMED', 'OM-3', NULL)$$, 'confirmation Orange Money');
SELECT is((SELECT a.code FROM posting p JOIN account a ON a.id = p.account_id
            WHERE p.transaction_id = (SELECT settled_tx_id FROM payout WHERE id = pg_temp.pid(3)) AND p.amount < 0),
  'A-PSP-OM', 'moyen ORANGE_MONEY : compte A-PSP-OM crédité');

-- Échec : le droit est recrédité (buildPayoutFailed) et redevient disponible
SELECT is(pg_temp.net((SELECT la FROM fx), pg_temp.id('85c001')), 0::bigint, 'commerçant : droit net à 0 avant l''échec');
SELECT lives_ok($$SELECT pg_temp.settle(4, 'FAILED', NULL, 'numéro invalide')$$, 'échec de la ligne 4');
SELECT is((SELECT status || ':' || failure_reason FROM payout WHERE id = pg_temp.pid(4)), 'FAILED:numéro invalide',
  'ligne échouée : motif porté');
SELECT is((SELECT array_agg(a.code || ':' || p.amount ORDER BY p.line_no) FROM posting p JOIN account a ON a.id = p.account_id
            WHERE p.transaction_id = (SELECT settled_tx_id FROM payout WHERE id = pg_temp.pid(4))),
  ARRAY['L-VERS-ENCOURS:11400', 'L-MCH-' || pg_temp.id('85f001') || ':-11400'], 'PAYOUT_FAILED : en cours -> droit d''origine');
SELECT is(pg_temp.net((SELECT la FROM fx), pg_temp.id('85c001')), 11400::bigint, 'droit net recrédité de 11 400');
SELECT lives_ok($$SELECT pg_temp.batch('85ab05', jsonb_build_array(
  pg_temp.ln(jsonb_build_object('participation_id', pg_temp.id('85f001')), pg_temp.id('85c001'), 11400)))$$,
  'après l''échec, un nouveau lot du même montant passe');
SELECT lives_ok($$SELECT pg_temp.settle(4, 'FAILED', NULL, 'numéro invalide')$$, 'rejeu de l''échec accepté');
SELECT is((SELECT count(*) FROM journal_transaction WHERE idempotency_key = 'payout:' || pg_temp.pid(4)::text || ':settle')::int, 1,
  'rejeu de l''échec : une seule écriture');
SELECT is(pg_temp.bal((SELECT la FROM fx), 'L-VERS-ENCOURS'), (-20625)::bigint, 'en cours : le lot de 9 225 et le nouveau lot de 11 400');
SELECT is((SELECT sum(amount) FROM posting WHERE ledger_id = (SELECT la FROM fx))::int, 0, 'grand livre équilibré');

-- Rejeu de la création de lot (NFR-001)
CREATE TEMP TABLE r2 AS SELECT pg_temp.batch('85ab02', jsonb_build_array(
  pg_temp.ln('"ORGANIZER"', pg_temp.id('85b001'), 30000),
  pg_temp.ln('"OPERATOR"', pg_temp.id('85a001'), 4000, 'WAVE'),
  pg_temp.ln('"PLATFORM"', (SELECT id FROM party WHERE kind = 'PLATFORM' ORDER BY created_at, id LIMIT 1), 1017, 'ORANGE_MONEY'),
  pg_temp.ln(jsonb_build_object('participation_id', pg_temp.id('85f001')), pg_temp.id('85c001'), 11400))) AS j;
SELECT is((SELECT j FROM r2), (SELECT j FROM r1), 'rejeu du lot : même résultat (droit net épuisé, aucun refus)');
SELECT is((SELECT count(*) FROM journal_transaction WHERE idempotency_key = 'payout-batch:' || pg_temp.id('85ab02'))::int, 1,
  'rejeu du lot : une seule transaction');
SELECT is((SELECT count(*) FROM payout WHERE approval_request_id = pg_temp.id('85ab02'))::int, 4, 'rejeu du lot : quatre lignes');
SELECT throws_ok($$SELECT pg_temp.batch('85ab02', jsonb_build_array(
  pg_temp.ln('"ORGANIZER"', pg_temp.id('85b001'), 29999)))$$, 'CL002', NULL, 'lot rejoué avec un autre contenu : CL002');

-- ===== Transitions et immuabilité (déclencheurs)
SELECT throws_ok($$UPDATE payout SET status = 'INITIATED' WHERE id = pg_temp.pid(1)$$, 'CL029', NULL, 'retour à INITIATED refusé');
SELECT throws_ok($$UPDATE payout SET status = 'FAILED', failure_reason = 'x' WHERE id = pg_temp.pid(1)$$, 'CL029', NULL,
  'CONFIRMED -> FAILED direct refusé');
SELECT throws_ok($$UPDATE payout SET amount = amount + 1 WHERE id = pg_temp.pid(1)$$, 'CL029', NULL, 'montant d''une ligne réglée figé');
SELECT throws_ok($$UPDATE payout SET external_ref = 'autre' WHERE id = pg_temp.pid(1)$$, 'CL029', NULL, 'résultat figé après règlement');
SELECT throws_ok($$DELETE FROM payout WHERE id = pg_temp.pid(1)$$, 'CL029', NULL, 'DELETE refusé');
SELECT lives_ok($$SELECT pg_temp.batch('85ab06', jsonb_build_array(
  pg_temp.ln('"ORGANIZER"', pg_temp.id('85b001'), 100)))$$, 'ligne INITIATED pour les essais de colonnes') WHERE false;
-- ligne 5 (lot 85ab05) encore INITIATED
CREATE TEMP TABLE open_line AS SELECT id FROM payout WHERE approval_request_id = pg_temp.id('85ab05');
SELECT throws_ok($$UPDATE payout SET amount = amount + 1 WHERE id = (SELECT id FROM open_line)$$, 'CL001', NULL,
  'montant d''une ligne INITIATED figé');
SELECT throws_ok($$UPDATE payout SET beneficiary_id = pg_temp.id('85b001') WHERE id = (SELECT id FROM open_line)$$, 'CL001', NULL,
  'bénéficiaire figé');
SELECT throws_ok($$UPDATE payout SET approved_by = pg_temp.id('85aaa9') WHERE id = (SELECT id FROM open_line)$$, 'CL001', NULL,
  'valideur figé');
SELECT throws_ok($$UPDATE payout SET iban = 'SN00', msisdn = NULL WHERE id = (SELECT id FROM open_line)$$, 'CL001', NULL,
  'destination figée');
SELECT throws_ok($$UPDATE payout SET status = 'PAID' WHERE id = (SELECT id FROM open_line)$$, NULL, NULL, 'statut hors liste refusé');
SELECT throws_ok($$UPDATE payout SET status = 'INITIATED' WHERE id = (SELECT id FROM open_line)$$, 'CL029', NULL,
  'INITIATED -> INITIATED : pas une transition');

-- ===== Cas refusés à la création
SELECT throws_ok($$SELECT pg_temp.batch('85ab06', jsonb_build_array(
  pg_temp.ln('"ORGANIZER"', pg_temp.id('85b001'), 1, 'CASH')))$$, 'CL047', NULL, 'moyen CASH refusé');
SELECT throws_ok($$SELECT pg_temp.batch('85ab06', '[]'::jsonb)$$, 'CL001', NULL, 'lot vide refusé');
SELECT throws_ok($$SELECT pg_temp.batch('85ab06', jsonb_build_array(
  pg_temp.ln('"ORGANIZER"', pg_temp.id('85b001'), 0)))$$, 'CL001', NULL, 'montant nul refusé');
SELECT throws_ok($$SELECT pg_temp.batch('85ab06', jsonb_build_array(
  pg_temp.ln('"ORGANIZER"', pg_temp.id('85b001'), -5)))$$, 'CL001', NULL, 'montant négatif refusé');
SELECT throws_ok($$SELECT pg_temp.batch('85ab06', jsonb_build_array(
  pg_temp.ln('"ORGANIZER"', pg_temp.id('85b001'), 1), pg_temp.ln('"ORGANIZER"', pg_temp.id('85b001'), 2)))$$, 'CL001', NULL,
  'deux lignes pour un même bénéficiaire refusées');
SELECT throws_ok($$SELECT create_payout_batch((SELECT la FROM fx), pg_temp.id('85ab06'),
  jsonb_build_array(pg_temp.ln('"ORGANIZER"', pg_temp.id('85b001'), 1)), pg_temp.id('85aaa1'), pg_temp.id('85aaa1'))$$,
  'CL001', NULL, 'valideur égal à l''auteur refusé');
SELECT throws_ok($$SELECT create_payout_batch((SELECT la FROM fx), pg_temp.id('85ab06'),
  jsonb_build_array(pg_temp.ln('"ORGANIZER"', pg_temp.id('85b001'), 1)), NULL, pg_temp.id('85aaa2'))$$,
  'CL001', NULL, 'auteur absent refusé');
SELECT throws_ok($$SELECT pg_temp.batch('85ab06', jsonb_build_array(
  pg_temp.ln('"ORGANIZER"', pg_temp.id('85b001'), 1) - 'iban'))$$, 'CL001', NULL, 'virement sans IBAN refusé');
SELECT throws_ok($$SELECT pg_temp.batch('85ab06', jsonb_build_array(
  pg_temp.ln('"ORGANIZER"', pg_temp.id('85b001'), 1, 'WAVE') - 'msisdn'))$$, 'CL001', NULL, 'Wave sans numéro refusé');
SELECT throws_ok($$SELECT pg_temp.batch('85ab06', jsonb_build_array(
  pg_temp.ln('"ORGANIZER"', pg_temp.id('85b001'), 1) || '{"msisdn":"+221770000001"}'))$$, 'CL001', NULL,
  'virement avec numéro refusé');
SELECT throws_ok($$SELECT pg_temp.batch('85ab06', jsonb_build_array(
  pg_temp.ln('"ORGANIZER"', pg_temp.id('85b002'), 1)))$$, 'CL001', NULL, 'organisateur d''un autre prestataire refusé');
SELECT throws_ok($$SELECT pg_temp.batch('85ab06', jsonb_build_array(
  pg_temp.ln('"LEGAL"', pg_temp.id('85a001'), 1)))$$, 'CL001', NULL, 'LEGAL sans compte légal dans ce grand livre refusé');
SELECT throws_ok($$SELECT pg_temp.batch('85ab06', jsonb_build_array(
  pg_temp.ln(jsonb_build_object('participation_id', pg_temp.id('85f009')), pg_temp.id('85c001'), 1)))$$, 'CL001', NULL,
  'bénéficiaire sans compte de droits refusé');
SELECT throws_ok($$SELECT pg_temp.batch('85ab06', jsonb_build_array(
  pg_temp.ln(jsonb_build_object('participation_id', pg_temp.id('85f001')), pg_temp.id('85c002'), 1)))$$, 'CL001', NULL,
  'participation d''un autre commerçant refusée');
SELECT throws_ok($$SELECT pg_temp.batch('85abee', jsonb_build_array(
  pg_temp.ln('"ORGANIZER"', pg_temp.id('85b001'), 1)))$$, 'P0002', NULL, 'lot (demande d''approbation) inconnu refusé');
-- L'IBAN ne figure dans aucun message d'erreur
DO $$ BEGIN
  PERFORM create_payout_batch((SELECT la FROM fx), pg_temp.id('85ab06'),
    jsonb_build_array(pg_temp.ln('"ORGANIZER"', pg_temp.id('85b001'), 99999999)), pg_temp.id('85aaa1'), pg_temp.id('85aaa2'));
EXCEPTION WHEN OTHERS THEN
  CREATE TEMP TABLE errmsg AS SELECT SQLERRM AS m;
END $$;
SELECT ok((SELECT m NOT LIKE '%SN08%' AND m LIKE '%99999999%' FROM errmsg), 'message CL055 : montants, jamais l''IBAN');

-- ===== LEGAL (grand livre à casse légale) et plusieurs bénéficiaires
CREATE FUNCTION pg_temp.batch_l(p_req text, p_lines jsonb) RETURNS jsonb LANGUAGE sql AS $$
  SELECT create_payout_batch((SELECT ll FROM fx), pg_temp.id(p_req), p_lines, pg_temp.id('85aaa1'), pg_temp.id('85aaa2')) $$;
SELECT throws_ok($$SELECT pg_temp.batch_l('85ab07', jsonb_build_array(
  pg_temp.ln('"LEGAL"', pg_temp.id('85a001'), 601, 'WAVE')))$$, 'CL055', NULL, 'LEGAL : 601 pour 600 refusé');
SELECT lives_ok($$SELECT pg_temp.batch_l('85ab07', jsonb_build_array(
  pg_temp.ln('"LEGAL"', pg_temp.id('85a001'), 600, 'WAVE')))$$, 'LEGAL : 600 admis (borne sur le compte légal)');
SELECT is(pg_temp.bal((SELECT ll FROM fx), 'L-LEGAL-CASSE'), 0::bigint, 'compte légal débité');
SELECT is((SELECT beneficiary_id FROM payout WHERE approval_request_id = pg_temp.id('85ab07')), pg_temp.id('85a001'),
  'LEGAL : la ligne porte la partie du prestataire');
SELECT throws_ok($$SELECT pg_temp.batch_l('85ab08', jsonb_build_array(
  pg_temp.ln('"LEGAL"', pg_temp.id('85a001'), 1, 'WAVE'), pg_temp.ln('"OPERATOR"', pg_temp.id('85a001'), 1, 'WAVE')))$$,
  'CL001', NULL, 'OPERATOR et LEGAL dans un même lot : refusé (même bénéficiaire)');

-- ===== Isolation : le prestataire B ne crée ni ne règle rien chez A
SELECT set_config('app.operator_id', pg_temp.id('85a002')::text, true);
SELECT throws_ok($$SELECT pg_temp.batch('85ab01', jsonb_build_array(
  pg_temp.ln('"ORGANIZER"', pg_temp.id('85b001'), 1)))$$, 'P0002', NULL, 'B ne crée pas de lot sur le grand livre de A');
SELECT throws_ok($$SELECT pg_temp.settle(1, 'CONFIRMED', 'X', NULL)$$, 'P0002', NULL, 'B ne règle pas une ligne de A (ligne réglée)');
SELECT throws_ok($$SELECT settle_payout((SELECT id FROM open_line), 'CONFIRMED', 'X', NULL, pg_temp.id('85aaa3'))$$, 'P0002', NULL,
  'B ne règle pas une ligne de A (ligne ouverte)');
SELECT set_config('app.operator_id', pg_temp.id('85a001')::text, true);
SELECT is((SELECT status FROM payout WHERE id = (SELECT id FROM open_line)), 'INITIATED', 'la ligne de A est intacte');
SELECT throws_ok($$SELECT settle_payout(pg_temp.id('85ffff'), 'CONFIRMED', 'X', NULL, pg_temp.id('85aaa3'))$$, 'P0002', NULL,
  'ligne inconnue : objet introuvable');

-- ===== Fonctions DEFINER à chemin figé (EXECUTE de PUBLIC : prouvé par tests_execute_grants, lot WP06)
SELECT ok((SELECT bool_and(p.prosecdef AND p.proconfig::text LIKE '%search_path=public, pg_temp%')
             FROM pg_proc p WHERE p.proname IN ('create_payout_batch', 'settle_payout', 'payout_scope_guard')),
  'fonctions DEFINER : search_path figé');

-- ===== Renforcements du porteur (17/11/2026) : demande d'approbation et lien aux transactions
CREATE FUNCTION pg_temp.batch_ar(p_req text, p_actor text DEFAULT '85aaa1', p_approver text DEFAULT '85aaa2')
RETURNS jsonb LANGUAGE sql AS $$
  SELECT create_payout_batch((SELECT la FROM fx), pg_temp.id(p_req),
    jsonb_build_array(pg_temp.ln('"PLATFORM"', (SELECT id FROM party WHERE kind = 'PLATFORM' ORDER BY created_at, id LIMIT 1), 1, 'WAVE')),
    pg_temp.id(p_actor), pg_temp.id(p_approver)) $$;
SELECT throws_ok($$SELECT pg_temp.batch_ar('85abc1')$$, 'CL029', NULL, 'demande PENDING refusée');
SELECT throws_ok($$SELECT pg_temp.batch_ar('85abc2')$$, 'CL029', NULL, 'demande REJECTED refusée');
SELECT throws_ok($$SELECT pg_temp.batch_ar('85abc5')$$, 'CL029', NULL, 'demande déjà EXECUTED sans lot écrit refusée');
SELECT throws_ok($$SELECT pg_temp.batch_ar('85abc3')$$, 'CL001', NULL, 'demande d''une autre action que PAYOUT refusée');
SELECT throws_ok($$SELECT pg_temp.batch_ar('85abc4')$$, 'CL001', NULL, 'valideur différent du décideur de la demande refusé');
SELECT throws_ok($$SELECT pg_temp.batch_ar('85ab08', '85aaa7', '85aaa2')$$, 'CL001', NULL, 'auteur différent du demandeur refusé');
SELECT is((SELECT count(*) FROM payout WHERE approval_request_id IN (pg_temp.id('85abc1'), pg_temp.id('85abc2'),
  pg_temp.id('85abc3'), pg_temp.id('85abc4'), pg_temp.id('85abc5'), pg_temp.id('85ab08')))::int, 0, 'refus : aucune ligne écrite');

CREATE FUNCTION pg_temp.raw_payout(p_tx uuid, p_ledger uuid DEFAULT NULL) RETURNS void LANGUAGE sql AS $$
  INSERT INTO payout (operator_id, ledger_id, beneficiary_id, amount, method, status, initiated_by, approved_by,
                      msisdn, initiated_tx_id)
  SELECT pg_temp.id('85a001'), coalesce(p_ledger, la), pg_temp.id('85b001'), 10, 'WAVE', 'INITIATED',
         pg_temp.id('85aaa1'), pg_temp.id('85aaa2'), '+221770000001', p_tx FROM fx $$;
SELECT throws_like($$SELECT pg_temp.raw_payout(NULL)$$, '%payout_tx_required%', 'insertion sans initiated_tx_id refusée');
SELECT throws_like($$SELECT pg_temp.raw_payout((SELECT id FROM journal_transaction WHERE ledger_id = (SELECT ll FROM fx) LIMIT 1))$$,
  '%payout_initiated_tx_same_ledger%', 'initiated_tx_id d''un autre grand livre refusé');
SELECT lives_ok($$SELECT pg_temp.raw_payout((SELECT id FROM journal_transaction WHERE ledger_id = (SELECT la FROM fx) LIMIT 1))$$,
  'insertion avec transaction du même grand livre admise');
CREATE TEMP TABLE raw_line AS SELECT id FROM payout WHERE approval_request_id IS NULL AND amount = 10;
SELECT throws_like($$UPDATE payout SET status = 'CONFIRMED', external_ref = 'X', confirmed_by = pg_temp.id('85aaa3'),
  confirmed_at = now() WHERE id = (SELECT id FROM raw_line)$$, '%payout_tx_required%', 'règlement sans settled_tx_id refusé');
SELECT throws_like($$UPDATE payout SET status = 'CONFIRMED', external_ref = 'X', confirmed_by = pg_temp.id('85aaa3'),
  confirmed_at = now(), settled_tx_id = (SELECT id FROM journal_transaction WHERE ledger_id = (SELECT ll FROM fx) LIMIT 1)
  WHERE id = (SELECT id FROM raw_line)$$, '%payout_settled_tx_same_ledger%', 'settled_tx_id d''un autre grand livre refusé');
SELECT throws_like($$UPDATE payout SET status = 'FAILED', failure_reason = 'x', confirmed_by = pg_temp.id('85aaa3'),
  confirmed_at = now() WHERE id = (SELECT id FROM raw_line)$$, '%payout_tx_required%', 'échec sans settled_tx_id refusé');

SELECT * FROM finish();
ROLLBACK;
