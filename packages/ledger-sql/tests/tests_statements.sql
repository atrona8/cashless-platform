-- Relevés importés et rapprochement (migration 0083, mission 9b, lot WP02 ; FR-001, FR-004, FR-013 à FR-015, C-004)
-- — pgTAP, écrit à la main. Exécuté en propriétaire : aucun droit de rôle (lot WP06).
-- Lancer : pg_prove -d <base> tests/tests_statements.sql
\set ON_ERROR_STOP 1
\set QUIET 1
BEGIN;
\ir _grants_for_tests.sql
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

CREATE FUNCTION pg_temp.id(p text) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT ('00000000-0000-0000-0000-' || lpad(p, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.h(p text) RETURNS text LANGUAGE sql IMMUTABLE AS
  $$ SELECT encode(sha256(convert_to('83 ' || p, 'UTF8')), 'hex') $$;
-- Code SQLSTATE d'une instruction (NULL si elle réussit).
CREATE FUNCTION pg_temp.code(p text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE p; RETURN NULL; EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE; END $$;

-- Données : prestataires A et B, un événement et un grand livre chacun, comptes PSP.
INSERT INTO party (kind, legal_name) SELECT 'PLATFORM', 'Plateforme (test)' WHERE NOT EXISTS (SELECT 1 FROM party WHERE kind = 'PLATFORM');
INSERT INTO party (id, kind, legal_name, country_code) VALUES
 (pg_temp.id('83a001'), 'OPERATOR', 'Prestataire A', 'SN'), (pg_temp.id('83a002'), 'OPERATOR', 'Prestataire B', 'SN');
INSERT INTO party (id, kind, operator_id, legal_name) VALUES
 (pg_temp.id('83b001'), 'ORGANIZER', pg_temp.id('83a001'), 'Organisateur A'),
 (pg_temp.id('83b002'), 'ORGANIZER', pg_temp.id('83a002'), 'Organisateur B'),
 (pg_temp.id('83c001'), 'CUSTOMER', pg_temp.id('83a001'), 'Festivalier A');
INSERT INTO jurisdiction_profile (id, country_code, version, valid_from, breakage_destination)
VALUES (pg_temp.id('83d001'), 'SN', 830083, '2026-01-01', 'ORGANIZER');
INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone, jurisdiction_id, funds_holder) VALUES
 (pg_temp.id('83e001'), pg_temp.id('83a001'), pg_temp.id('83b001'), 'Événement A', 'XOF', 'Africa/Dakar',
  pg_temp.id('83d001'), 'ORGANIZER'),
 (pg_temp.id('83e002'), pg_temp.id('83a002'), pg_temp.id('83b002'), 'Événement B', 'XOF', 'Africa/Dakar',
  pg_temp.id('83d001'), 'ORGANIZER');
SELECT set_config('app.operator_id', pg_temp.id('83a001')::text, true);
SELECT open_event_ledger(pg_temp.id('83e001'));
SELECT open_psp_accounts((SELECT id FROM ledger WHERE scope_id = pg_temp.id('83e001')));
SELECT set_config('app.operator_id', pg_temp.id('83a002')::text, true);
SELECT open_event_ledger(pg_temp.id('83e002'));
SELECT open_psp_accounts((SELECT id FROM ledger WHERE scope_id = pg_temp.id('83e002')));
SELECT set_config('app.operator_id', pg_temp.id('83a001')::text, true);
CREATE TEMP TABLE fx AS
SELECT l.id AS la, l.operator_id AS oa,
  (SELECT id FROM ledger WHERE scope_id = pg_temp.id('83e002')) AS lb,
  (SELECT id FROM account WHERE ledger_id = l.id AND code = 'A-PSP-WAVE') AS wave,
  (SELECT id FROM account WHERE ledger_id = l.id AND code = 'A-PSP-OM') AS om,
  (SELECT id FROM account WHERE ledger_id = l.id AND code = 'A-PSP-CARTE') AS carte,
  (SELECT id FROM account WHERE ledger_id = l.id AND code = 'A-BANQUE') AS bank,
  (SELECT id FROM account WHERE ledger_id = l.id AND code = 'L-ORG-COM') AS liab,
  (SELECT a.id FROM account a JOIN ledger b ON b.id = a.ledger_id WHERE b.scope_id = pg_temp.id('83e002') AND a.code = 'A-PSP-WAVE') AS wave_b
FROM ledger l WHERE l.scope_id = pg_temp.id('83e001');
INSERT INTO wallet (id, operator_id, ledger_id) VALUES (pg_temp.id('83f001'), pg_temp.id('83a001'), (SELECT la FROM fx));

-- Transaction à deux lignes : compte p_acct débité de p_amt, L-ORG-COM crédité.
CREATE FUNCTION pg_temp.mktx(p_ledger uuid, p_op uuid, p_key text, p_acct uuid, p_amt bigint,
                             p_at timestamptz DEFAULT '2026-01-10 12:00+00') RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE t uuid := gen_random_uuid(); liab uuid;
BEGIN
  SELECT id INTO liab FROM account WHERE ledger_id = p_ledger AND code = 'L-ORG-COM';
  INSERT INTO journal_transaction (id, operator_id, ledger_id, type, idempotency_key, request_hash, occurred_at, source,
                                   created_by, approved_by)
  VALUES (t, p_op, p_ledger, 'ADJUSTMENT', p_key, 'h', p_at, 'BACKOFFICE', pg_temp.id('83aa01'), pg_temp.id('83aa02'));
  INSERT INTO posting (operator_id, ledger_id, transaction_id, line_no, account_id, amount)
  VALUES (p_op, p_ledger, t, 1, p_acct, p_amt), (p_op, p_ledger, t, 2, liab, -p_amt);
  RETURN t;
END $$;
-- Import : par défaut compte WAVE de A, devise XOF.
CREATE FUNCTION pg_temp.imp(p_sha text, p_closing bigint, p_lines jsonb, p_account uuid DEFAULT NULL,
                            p_ledger uuid DEFAULT NULL, p_cur text DEFAULT 'XOF', p_date text DEFAULT '2026-01-31',
                            p_source text DEFAULT 'wave') RETURNS jsonb LANGUAGE sql AS $$
  SELECT import_statement_lines(jsonb_build_object('ledger_id', coalesce(p_ledger, (SELECT la FROM fx)),
    'account_id', coalesce(p_account, (SELECT wave FROM fx)), 'source', p_source, 'file_sha256', pg_temp.h(p_sha),
    'statement_date', p_date, 'closing_balance', p_closing, 'currency', p_cur, 'imported_by', pg_temp.id('83aa03')),
    p_lines)
$$;
CREATE FUNCTION pg_temp.ln(p_ref text, p_amt bigint, p_cur text DEFAULT 'XOF') RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('external_ref', p_ref, 'value_date', '2026-01-10', 'amount', p_amt, 'currency', p_cur)
$$;

-- ===== 1. Garde de portée (insertion directe) ====================================================================
SELECT is(pg_temp.code(format($q$INSERT INTO external_statement_line (operator_id, ledger_id, account_id, source, external_ref,
  value_date, amount) VALUES (%L, %L, %L, 's', 'g1', '2026-01-01', 1)$q$, pg_temp.id('83a001'), (SELECT la FROM fx),
  (SELECT wave_b FROM fx))), 'CL047', 'compte d''un autre prestataire : refusé');
SELECT is(pg_temp.code(format($q$INSERT INTO external_statement_line (operator_id, ledger_id, account_id, source, external_ref,
  value_date, amount) VALUES (%L, %L, %L, 's', 'g2', '2026-01-01', 1)$q$, pg_temp.id('83a001'), (SELECT lb FROM fx),
  (SELECT wave_b FROM fx))), 'CL047', 'grand livre d''un autre prestataire : refusé');
SELECT is(pg_temp.code(format($q$INSERT INTO external_statement_line (operator_id, ledger_id, account_id, source, external_ref,
  value_date, amount) VALUES (%L, %L, %L, 's', 'g3', '2026-01-01', 1)$q$, pg_temp.id('83a001'), (SELECT la FROM fx),
  (SELECT liab FROM fx))), 'CL047', 'compte de famille CLAIM : refusé');
SELECT is(pg_temp.code(format($q$INSERT INTO external_statement_line (operator_id, ledger_id, account_id, source, external_ref,
  value_date, amount) VALUES (%L, %L, %L, 's', 'g4', '2026-01-01', 1)$q$, pg_temp.id('83a001'), (SELECT la FROM fx),
  (SELECT bank FROM fx))), NULL, 'compte ASSET du bon grand livre : accepté');
SELECT is(pg_temp.code(format($q$INSERT INTO external_statement_line (operator_id, ledger_id, account_id, source, external_ref,
  value_date, amount) VALUES (%L, %L, %L, 's', 'g5', '2026-01-01', 0)$q$, pg_temp.id('83a001'), (SELECT la FROM fx),
  (SELECT carte FROM fx))), '23514', 'montant nul : refusé par CHECK');

-- ===== 2. Import et dédoublonnage ================================================================================
CREATE TEMP TABLE r1 AS SELECT pg_temp.imp('f1', 3000, jsonb_build_array(pg_temp.ln('W-1', 1000), pg_temp.ln('W-2', 1000),
  pg_temp.ln('W-3', 1000))) AS j;
SELECT is((SELECT (j->>'created')::int FROM r1), 3, 'import : 3 lignes créées');
SELECT is((SELECT (j->>'existing')::int FROM r1), 0, 'import : aucune existante');
SELECT is((SELECT count(*)::int FROM external_statement_line WHERE statement_import_id = (SELECT (j->>'import_id')::uuid FROM r1)),
  3, 'lignes rattachées au relevé');
SELECT is((SELECT lines_created FROM statement_import WHERE id = (SELECT (j->>'import_id')::uuid FROM r1)), 3,
  'compteur du relevé');
CREATE TEMP TABLE r2 AS SELECT pg_temp.imp('f1', 3000, jsonb_build_array(pg_temp.ln('W-1', 1000))) AS j;
SELECT is((SELECT j->>'import_id' FROM r2), (SELECT j->>'import_id' FROM r1), 'réimport : même import rendu');
SELECT is((SELECT (j->>'created')::int FROM r2), 0, 'réimport : created = 0');
SELECT is((SELECT count(*)::int FROM statement_import WHERE file_sha256 = pg_temp.h('f1')), 1, 'réimport : un seul relevé');
CREATE TEMP TABLE r3 AS SELECT pg_temp.imp('f2', 4000, jsonb_build_array(pg_temp.ln('W-3', 1000), pg_temp.ln('W-4', 1000))) AS j;
SELECT is((SELECT (j->>'created')::int FROM r3), 1, 'fichier qui en recoupe un autre : 1 ligne neuve');
SELECT is((SELECT (j->>'existing')::int FROM r3), 1, 'fichier qui en recoupe un autre : 1 ligne existante');
SELECT is((SELECT count(*)::int FROM external_statement_line WHERE account_id = (SELECT wave FROM fx) AND source = 'wave'),
  4, 'aucune ligne en double');
CREATE TEMP TABLE r4 AS SELECT pg_temp.imp('f3', 5000, jsonb_build_array(pg_temp.ln('D-1', 5), pg_temp.ln('D-1', 5))) AS j;
SELECT is((SELECT (j->>'created')::int FROM r4), 1, 'deux lignes identiques dans le fichier : une seule créée');
CREATE TEMP TABLE r5 AS SELECT pg_temp.imp('f4', 0, '[]'::jsonb, (SELECT carte FROM fx)) AS j;
SELECT is((SELECT (j->>'created')::int FROM r5), 0, 'fichier vide : accepté, aucune ligne');
CREATE TEMP TABLE r6 AS SELECT pg_temp.imp('f5', 5, jsonb_build_array(pg_temp.ln('W-1', 7)), (SELECT bank FROM fx), NULL, 'XOF', '2026-01-31', 'wave') AS j;
SELECT is((SELECT (j->>'created')::int FROM r6), 1,
  'même (source, référence) sur un autre compte : ligne créée (plus d''unicité globale)');
CREATE TEMP TABLE r7 AS SELECT pg_temp.imp('f6', 5, jsonb_build_array(pg_temp.ln('W-1', 7)), (SELECT bank FROM fx), NULL, 'XOF', '2026-01-31', 'banque') AS j;
SELECT is((SELECT (j->>'created')::int FROM r7), 1, 'même référence, autre source, autre compte : deux lignes');

-- Isolation entre prestataires : B occupe une (source, référence), A importe la même et la crée ; et inversement.
SELECT set_config('app.operator_id', pg_temp.id('83a002')::text, true);
CREATE TEMP TABLE rb1 AS SELECT pg_temp.imp('xb1', 5, jsonb_build_array(pg_temp.ln('VICTIM-1', 5)), (SELECT wave_b FROM fx), (SELECT lb FROM fx)) AS j;
SELECT is((SELECT (j->>'created')::int FROM rb1), 1, 'B crée sa ligne (source wave, VICTIM-1)');
SELECT set_config('app.operator_id', pg_temp.id('83a001')::text, true);
CREATE TEMP TABLE ra1 AS SELECT pg_temp.imp('xa1', 5, jsonb_build_array(pg_temp.ln('VICTIM-1', 5), pg_temp.ln('VICTIM-2', 5))) AS j;
SELECT is((SELECT (j->>'created')::int FROM ra1), 2, 'A importe la même paire : ses lignes sont créées');
SELECT is((SELECT (j->>'existing')::int FROM ra1), 0, 'A : existing = 0 (rien ne révèle la ligne de B)');
SELECT set_config('app.operator_id', pg_temp.id('83a002')::text, true);
CREATE TEMP TABLE rb2 AS SELECT pg_temp.imp('xb2', 5, jsonb_build_array(pg_temp.ln('VICTIM-2', 5)), (SELECT wave_b FROM fx), (SELECT lb FROM fx)) AS j;
SELECT is((SELECT (j->>'created')::int FROM rb2), 1, 'inversement : B crée une paire déjà présente chez A');
SELECT is((SELECT (j->>'existing')::int FROM rb2), 0, 'B : existing = 0');
SELECT set_config('app.operator_id', pg_temp.id('83a001')::text, true);
SELECT is((SELECT count(*)::int FROM pg_constraint WHERE conrelid = 'external_statement_line'::regclass
            AND conname = 'external_statement_line_source_external_ref_key'), 0, 'contrainte globale retirée');

-- Refus (CL047) : aucune ligne écrite
SELECT is(pg_temp.code(format($q$SELECT pg_temp.imp('e1', 0, %L::jsonb, NULL, NULL, 'EUR')$q$, '[]')), 'CL047', 'devise du relevé étrangère');
SELECT is(pg_temp.code(format($q$SELECT pg_temp.imp('e2', 0, %L::jsonb)$q$,
  jsonb_build_array(pg_temp.ln('E-1', 5, 'EUR')))), 'CL047', 'devise d''une ligne étrangère');
SELECT is(pg_temp.code(format($q$SELECT pg_temp.imp('e3', 0, %L::jsonb, %L)$q$, '[]', (SELECT wave_b FROM fx))), 'CL047',
  'compte d''un autre prestataire (CL047, pas 42501)');
SELECT is(pg_temp.code(format($q$SELECT pg_temp.imp('e4', 0, %L::jsonb, %L)$q$, '[]', (SELECT liab FROM fx))), 'CL047',
  'compte hors famille ASSET');
SELECT is(pg_temp.code(format($q$SELECT pg_temp.imp('e5', 0, %L::jsonb, %L, %L)$q$, '[]', (SELECT wave_b FROM fx), (SELECT lb FROM fx))),
  'P0002', 'grand livre d''un autre prestataire : introuvable');
SELECT is(pg_temp.code(format($q$SELECT pg_temp.imp('e6', 0, %L::jsonb)$q$, jsonb_build_array(pg_temp.ln('E-0', 0)))), 'CL047', 'montant nul');
SELECT is(pg_temp.code(format($q$SELECT pg_temp.imp('e7', 0, %L::jsonb)$q$, jsonb_build_array(pg_temp.ln('  ', 5)))), 'CL047', 'référence vide');
SELECT is(pg_temp.code($q$SELECT pg_temp.imp('e8', 0, '[{"external_ref":"E-8","value_date":"pas une date","amount":5,"currency":"XOF"}]'::jsonb)$q$),
  'CL047', 'date mal formée');
SELECT is(pg_temp.code($q$SELECT import_statement_lines('{}'::jsonb, '[]'::jsonb)$q$), 'P0002', 'relevé sans grand livre : introuvable');
SELECT is((SELECT count(*)::int FROM statement_import WHERE file_sha256 IN (pg_temp.h('e1'), pg_temp.h('e2'), pg_temp.h('e6'))), 0,
  'refus : aucun relevé écrit');

-- ===== 3. Rapprochement automatique par les quatre sources ========================================================
SET LOCAL session_replication_role = replica;
CREATE TEMP TABLE tx AS SELECT
  pg_temp.mktx((SELECT la FROM fx), pg_temp.id('83a001'), 't-topup', (SELECT om FROM fx), 1000) AS topup,
  pg_temp.mktx((SELECT la FROM fx), pg_temp.id('83a001'), 't-cb', (SELECT om FROM fx), -300) AS cb,
  pg_temp.mktx((SELECT la FROM fx), pg_temp.id('83a001'), 't-refund', (SELECT om FROM fx), -200) AS refund,
  pg_temp.mktx((SELECT la FROM fx), pg_temp.id('83a001'), 't-payout', (SELECT bank FROM fx), -500) AS payout,
  pg_temp.mktx((SELECT la FROM fx), pg_temp.id('83a001'), 't-amb1', (SELECT om FROM fx), 10) AS amb1,
  pg_temp.mktx((SELECT la FROM fx), pg_temp.id('83a001'), 't-amb2', (SELECT om FROM fx), 10) AS amb2,
  pg_temp.mktx((SELECT la FROM fx), pg_temp.id('83a001'), 't-other', (SELECT bank FROM fx), 77) AS other;
INSERT INTO psp_topup (psp_topup_id, operator_id, ledger_id, event_id, wallet_id, psp_configuration_id, method, provider,
    amount, currency, fee_amount, status, provider_payment_ref, expires_at, requested_by_kind, customer_id, topup_tx_id,
    succeeded_at)
SELECT pg_temp.id(v.k), pg_temp.id('83a001'), (SELECT la FROM fx), pg_temp.id('83e001'), pg_temp.id('83f001'),
       pg_temp.id(v.cfg), 'WAVE', 'WAVE', 1000, 'XOF', 0, 'SUCCEEDED', v.ref, now() + interval '1 day', 'CUSTOMER',
       pg_temp.id('83c001'), v.tx, now()
  FROM (VALUES ('83ea01', '83cf01', 'PAY-1', (SELECT topup FROM tx)),
               ('83ea02', '83cf01', 'PAY-AMB', (SELECT amb1 FROM tx)),
               ('83ea03', '83cf02', 'PAY-AMB', (SELECT amb2 FROM tx)),
               ('83ea04', '83cf01', 'PAY-OTHER', (SELECT other FROM tx))) v(k, cfg, ref, tx);
INSERT INTO psp_chargeback (operator_id, psp_configuration_id, provider_dispute_id, psp_topup_id, amount, chargeback_tx_id)
VALUES (pg_temp.id('83a001'), pg_temp.id('83cf01'), 'DSP-1', pg_temp.id('83ea01'), 300, (SELECT cb FROM tx));
INSERT INTO refund_request (operator_id, ledger_id, event_id, wallet_id, method, msisdn, new_number, status, estimated_amount,
    fee, currency, transaction_id, approved_by, external_reference)
VALUES (pg_temp.id('83a001'), (SELECT la FROM fx), pg_temp.id('83e001'), pg_temp.id('83f001'), 'WAVE', '+221770000001', false,
        'PROCESSING', 200, 0, 'XOF', (SELECT refund FROM tx), pg_temp.id('83aa02'), 'RF-1');
INSERT INTO payout (operator_id, ledger_id, beneficiary_id, amount, method, status, external_ref, initiated_by, approved_by,
    initiated_tx_id, settled_tx_id, settled_at, confirmed_by, confirmed_at, msisdn)
VALUES (pg_temp.id('83a001'), (SELECT la FROM fx), pg_temp.id('83b001'), 500, 'WAVE', 'CONFIRMED', 'PO-1',
        pg_temp.id('83aa01'), pg_temp.id('83aa02'), (SELECT payout FROM tx), (SELECT payout FROM tx), now(),
        pg_temp.id('83aa02'), now(), '+221770000010');   -- WP06 : contraintes de 0085 (tx, confirmation, mobile)
RESET session_replication_role;

CREATE TEMP TABLE r8 AS SELECT pg_temp.imp('m1', 500, jsonb_build_array(pg_temp.ln('PAY-1', 1000), pg_temp.ln('DSP-1', -300),
  pg_temp.ln('RF-1', -200), pg_temp.ln('PAY-AMB', 10), pg_temp.ln('PAY-OTHER', 77), pg_temp.ln('INCONNUE', 1)),
  (SELECT om FROM fx), NULL, 'XOF', '2026-01-31', 'om') AS j;
SELECT is((SELECT (j->>'created')::int FROM r8), 6, 'import OM : 6 lignes');
SELECT is((SELECT (j->>'matched')::int FROM r8), 3, 'rapprochées automatiquement : recharge, contestation, remboursement');
SELECT is((SELECT matched_tx_id FROM external_statement_line WHERE external_ref = 'PAY-1' AND source = 'om'),
  (SELECT topup FROM tx), 'psp_topup.provider_payment_ref -> topup_tx_id');
SELECT is((SELECT matched_tx_id FROM external_statement_line WHERE external_ref = 'DSP-1'), (SELECT cb FROM tx),
  'psp_chargeback.provider_dispute_id -> chargeback_tx_id');
SELECT is((SELECT matched_tx_id FROM external_statement_line WHERE external_ref = 'RF-1'), (SELECT refund FROM tx),
  'refund_request.external_reference -> transaction_id');
SELECT is((SELECT matched_by FROM external_statement_line WHERE external_ref = 'PAY-1' AND source = 'om'),
  pg_temp.id('83aa03'), 'matched_by = imported_by');
SELECT is((SELECT matched_tx_id FROM external_statement_line WHERE external_ref = 'PAY-AMB'), NULL,
  'référence qui désigne deux transactions : reste non rapprochée');
SELECT is((SELECT matched_tx_id FROM external_statement_line WHERE external_ref = 'PAY-OTHER'), NULL,
  'transaction qui ne touche pas le compte de la ligne : non rapprochée');
CREATE TEMP TABLE r9 AS SELECT pg_temp.imp('m2', 5, jsonb_build_array(pg_temp.ln('PO-1', -500)), (SELECT bank FROM fx), NULL,
  'XOF', '2026-01-31', 'banque2') AS j;
SELECT is((SELECT (j->>'matched')::int FROM r9), 1, 'payout.external_ref -> settled_tx_id');
SELECT is((SELECT matched_tx_id FROM external_statement_line WHERE external_ref = 'PO-1'), (SELECT payout FROM tx),
  'versement rapproché à sa transaction de règlement');

-- 3b. Montant et signe : le rapprochement automatique exige un mouvement net égal, signe et valeur, au montant de la ligne.
SET LOCAL session_replication_role = replica;
CREATE TEMP TABLE txs AS SELECT
  pg_temp.mktx((SELECT la FROM fx), pg_temp.id('83a001'), 't-sg1', (SELECT om FROM fx), 300) AS sg1,
  pg_temp.mktx((SELECT la FROM fx), pg_temp.id('83a001'), 't-sg2', (SELECT om FROM fx), -200) AS sg2,
  pg_temp.mktx((SELECT la FROM fx), pg_temp.id('83a001'), 't-sg3', (SELECT om FROM fx), 150) AS sg3,
  pg_temp.mktx((SELECT la FROM fx), pg_temp.id('83a001'), 't-sg4', (SELECT om FROM fx), -120) AS sg4;
INSERT INTO wallet (id, operator_id, ledger_id)
SELECT pg_temp.id(v), pg_temp.id('83a001'), (SELECT la FROM fx) FROM unnest(ARRAY['83f011','83f012','83f013','83f014']) v;
INSERT INTO refund_request (operator_id, ledger_id, event_id, wallet_id, method, msisdn, new_number, status, estimated_amount,
    fee, currency, transaction_id, approved_by, external_reference)
SELECT pg_temp.id('83a001'), (SELECT la FROM fx), pg_temp.id('83e001'), pg_temp.id(v.w), 'WAVE', '+221770000001', false,
       'PROCESSING', 100, 0, 'XOF', v.tx, pg_temp.id('83aa02'), v.ref
  FROM (VALUES ('SG-1', '83f011', (SELECT sg1 FROM txs)), ('SG-2', '83f012', (SELECT sg2 FROM txs)),
               ('SG-3', '83f013', (SELECT sg3 FROM txs)), ('SG-4', '83f014', (SELECT sg4 FROM txs))) v(ref, w, tx);
RESET session_replication_role;
CREATE TEMP TABLE rs AS SELECT pg_temp.imp('m3', 0, jsonb_build_array(pg_temp.ln('SG-1', -300), pg_temp.ln('SG-2', -250),
  pg_temp.ln('SG-3', 150), pg_temp.ln('SG-4', -120)), (SELECT om FROM fx), NULL, 'XOF', '2026-01-31', 'om2') AS j;
SELECT is((SELECT (j->>'created')::int FROM rs), 4, 'signe/montant : 4 lignes');
SELECT is((SELECT (j->>'matched')::int FROM rs), 2, 'signe/montant : seules les 2 lignes concordantes rapprochées');
SELECT is((SELECT matched_tx_id FROM external_statement_line WHERE external_ref = 'SG-1'), NULL,
  'signe contraire (transaction +300, ligne -300) : non rapprochée');
SELECT is((SELECT matched_tx_id FROM external_statement_line WHERE external_ref = 'SG-2'), NULL,
  'même signe, montant différent (-200 contre -250) : non rapprochée');
SELECT is((SELECT matched_tx_id FROM external_statement_line WHERE external_ref = 'SG-3'), (SELECT sg3 FROM txs),
  'entrée positive concordante : rapprochée');
SELECT is((SELECT matched_tx_id FROM external_statement_line WHERE external_ref = 'SG-4'), (SELECT sg4 FROM txs),
  'sortie négative concordante : rapprochée');

-- 3c. Forme réelle du constructeur de recharge : +brut puis -frais sur le même compte (net 970, brut 1000).
SET LOCAL session_replication_role = replica;
CREATE TEMP TABLE txf AS SELECT pg_temp.mktx((SELECT la FROM fx), pg_temp.id('83a001'), 't-fee', (SELECT om FROM fx), 1000) AS f;
INSERT INTO posting (operator_id, ledger_id, transaction_id, line_no, account_id, amount)
SELECT pg_temp.id('83a001'), (SELECT la FROM fx), (SELECT f FROM txf), 3, (SELECT om FROM fx), -30
UNION ALL SELECT pg_temp.id('83a001'), (SELECT la FROM fx), (SELECT f FROM txf), 4,
  (SELECT id FROM account WHERE ledger_id = (SELECT la FROM fx) AND code = 'L-ORG-COM'), 30;
INSERT INTO wallet (id, operator_id, ledger_id)
SELECT pg_temp.id(v), pg_temp.id('83a001'), (SELECT la FROM fx) FROM unnest(ARRAY['83f021','83f022','83f023','83f024']) v;
INSERT INTO refund_request (operator_id, ledger_id, event_id, wallet_id, method, msisdn, new_number, status, estimated_amount,
    fee, currency, transaction_id, approved_by, external_reference)
SELECT pg_temp.id('83a001'), (SELECT la FROM fx), pg_temp.id('83e001'), pg_temp.id(v.w), 'WAVE', '+221770000001', false,
       'PROCESSING', 100, 0, 'XOF', (SELECT f FROM txf), pg_temp.id('83aa02'), v.ref
  FROM (VALUES ('FE-1', '83f021'), ('FE-2', '83f022'), ('FE-3', '83f023'), ('FE-4', '83f024')) v(ref, w);
RESET session_replication_role;
CREATE TEMP TABLE rf AS SELECT pg_temp.imp('m4', 0, jsonb_build_array(pg_temp.ln('FE-1', 1000), pg_temp.ln('FE-2', 970),
  pg_temp.ln('FE-3', 985), pg_temp.ln('FE-4', -1000)), (SELECT om FROM fx), NULL, 'XOF', '2026-01-31', 'om3') AS j;
SELECT is((SELECT (j->>'matched')::int FROM rf), 2, 'frais sur le même compte : 2 lignes rapprochées sur 4');
SELECT is((SELECT matched_tx_id FROM external_statement_line WHERE external_ref = 'FE-1'), (SELECT f FROM txf), 'brut 1000 : rapprochée');
SELECT is((SELECT matched_tx_id FROM external_statement_line WHERE external_ref = 'FE-2'), (SELECT f FROM txf), 'net 970 : rapprochée');
SELECT is((SELECT matched_tx_id FROM external_statement_line WHERE external_ref = 'FE-3'), NULL, '985 : non rapprochée');
SELECT is((SELECT matched_tx_id FROM external_statement_line WHERE external_ref = 'FE-4'), NULL, '-1000 : non rapprochée');

-- ===== 4. Rapprochement manuel =====================================================================================
CREATE TEMP TABLE ln AS SELECT id, external_ref FROM external_statement_line WHERE external_ref IN ('PAY-AMB', 'PAY-OTHER', 'INCONNUE');
INSERT INTO journal_transaction (id, operator_id, ledger_id, type, idempotency_key, request_hash, occurred_at, source, created_by, approved_by)
VALUES (pg_temp.id('83bb01'), pg_temp.id('83a002'), (SELECT lb FROM fx), 'ADJUSTMENT', 'b1', 'h', now(), 'BACKOFFICE',
        pg_temp.id('83aa01'), pg_temp.id('83aa02'));
INSERT INTO posting (operator_id, ledger_id, transaction_id, line_no, account_id, amount)
SELECT pg_temp.id('83a002'), (SELECT lb FROM fx), pg_temp.id('83bb01'), 1, (SELECT wave_b FROM fx), 5
UNION ALL SELECT pg_temp.id('83a002'), (SELECT lb FROM fx), pg_temp.id('83bb01'), 2,
  (SELECT id FROM account WHERE ledger_id = (SELECT lb FROM fx) AND code = 'L-ORG-COM'), -5;
INSERT INTO anomaly (id, operator_id, ledger_id, kind, amount, status) VALUES
 (pg_temp.id('83a901'), pg_temp.id('83a001'), (SELECT la FROM fx), 'PSP_TOPUP_NOT_CREDITED', 1000, 'OPEN'),
 (pg_temp.id('83a902'), pg_temp.id('83a001'), (SELECT la FROM fx), 'PSP_MISMATCH', 1, 'OPEN'),
 (pg_temp.id('83a903'), pg_temp.id('83a002'), (SELECT lb FROM fx), 'PSP_MISMATCH', 1, 'OPEN'),
 (pg_temp.id('83a904'), pg_temp.id('83a001'), (SELECT la FROM fx), 'CASH_DIFF', 1, 'OPEN');
INSERT INTO anomaly (id, operator_id, ledger_id, kind, amount, status, resolution_tx_id) VALUES
 (pg_temp.id('83a905'), pg_temp.id('83a001'), (SELECT la FROM fx), 'PSP_MISMATCH', 1, 'RESOLVED', (SELECT other FROM tx));
CREATE FUNCTION pg_temp.m(p_ref text, p_tx uuid, p_an uuid, p_actor uuid DEFAULT pg_temp.id('83aa04')) RETURNS text
LANGUAGE sql AS $$ SELECT pg_temp.code(format('SELECT match_statement_line(%L, %L, %L, %L)',
  (SELECT id FROM ln WHERE external_ref = p_ref), p_tx, p_an, p_actor)) $$;
SELECT is(pg_temp.m('INCONNUE', pg_temp.id('83bb01'), NULL), 'CL047', 'transaction d''un autre prestataire : refusée');
SELECT is(pg_temp.m('INCONNUE', (SELECT payout FROM tx), NULL), 'CL047', 'transaction qui ne touche pas le compte : refusée');
SELECT is(pg_temp.m('INCONNUE', NULL, pg_temp.id('83a903')), 'CL047', 'anomalie d''un autre prestataire : refusée');
SELECT is(pg_temp.m('INCONNUE', NULL, pg_temp.id('83a904')), 'CL047', 'anomalie de type non PSP : refusée');
SELECT is(pg_temp.m('INCONNUE', NULL, pg_temp.id('83a905')), 'CL047', 'anomalie résolue : refusée');
SELECT is(pg_temp.m('INCONNUE', NULL, NULL), 'CL047', 'aucune cible : refusé');
SELECT is(pg_temp.m('INCONNUE', (SELECT amb1 FROM tx), pg_temp.id('83a901')), 'CL047', 'deux cibles : refusé');
SELECT is(pg_temp.m('INCONNUE', (SELECT amb1 FROM tx), NULL, NULL), 'CL047', 'auteur absent : refusé');
SELECT is(pg_temp.m('INCONNUE', (SELECT amb1 FROM tx), NULL), NULL, 'transaction du compte : accepté');
SELECT is((SELECT matched_by FROM external_statement_line WHERE external_ref = 'INCONNUE'), pg_temp.id('83aa04'), 'auteur consigné');
SELECT is(pg_temp.m('INCONNUE', (SELECT amb2 FROM tx), NULL), 'CL043', 'double rapprochement : CL043');
SELECT is(pg_temp.m('PAY-AMB', NULL, pg_temp.id('83a901')), NULL, 'rapprochement à une anomalie PSP ouverte');
SELECT is((SELECT matched_anomaly_id FROM external_statement_line WHERE external_ref = 'PAY-AMB'), pg_temp.id('83a901'),
  'matched_anomaly_id posé');
SELECT set_config('app.operator_id', pg_temp.id('83a002')::text, true);
SELECT is(pg_temp.m('PAY-OTHER', (SELECT other FROM tx), NULL), 'P0002', 'ligne d''un autre prestataire : introuvable');
SELECT set_config('app.operator_id', pg_temp.id('83a001')::text, true);

-- ===== 5. Immuabilité ============================================================================================
SELECT is(pg_temp.code($q$UPDATE external_statement_line SET amount = amount + 1 WHERE external_ref = 'W-1'$q$), 'CL047', 'UPDATE amount : refusé');
SELECT is(pg_temp.code($q$UPDATE external_statement_line SET external_ref = 'Z' WHERE external_ref = 'W-1'$q$), 'CL047', 'UPDATE external_ref : refusé');
SELECT is(pg_temp.code(format($q$UPDATE external_statement_line SET account_id = %L WHERE external_ref = 'W-1'$q$, (SELECT carte FROM fx))),
  'CL047', 'UPDATE account_id : refusé');
SELECT isnt(pg_temp.code($q$DELETE FROM external_statement_line WHERE external_ref = 'W-1'$q$), NULL, 'DELETE d''une ligne : refusé');
SELECT is(pg_temp.code(format($q$UPDATE external_statement_line SET matched_tx_id = %L, matched_by = %L, matched_at = now() WHERE external_ref = 'W-1'$q$,
  pg_temp.id('83bb01'), pg_temp.id('83aa04'))), 'CL047', 'rapprochement direct à une transaction étrangère : refusé');
SELECT is(pg_temp.code(format($q$UPDATE external_statement_line SET matched_tx_id = %L, matched_by = %L, matched_at = now() WHERE external_ref = 'PAY-1' AND source = 'om'$q$,
  (SELECT cb FROM tx), pg_temp.id('83aa04'))), 'CL043', 'rapprochement posé deux fois : refusé');
SELECT isnt(pg_temp.code($q$UPDATE statement_import SET closing_balance = 1$q$), NULL, 'UPDATE d''un relevé : refusé');
SELECT isnt(pg_temp.code($q$DELETE FROM statement_import$q$), NULL, 'DELETE d''un relevé : refusé');
SELECT is(pg_temp.code(format($q$INSERT INTO statement_import (operator_id, ledger_id, account_id, source, file_sha256, statement_date,
  closing_balance, currency, imported_by, lines_created, lines_existing, lines_matched) VALUES (%L, %L, %L, 's', %L, '2026-01-01', 0, 'XOF', %L, 0, 0, 0)$q$,
  pg_temp.id('83a001'), (SELECT la FROM fx), (SELECT liab FROM fx), pg_temp.h('x'), pg_temp.id('83aa01'))), 'CL047',
  'relevé sur un compte hors ASSET : refusé');
SELECT is(pg_temp.code(format($q$INSERT INTO statement_import (operator_id, ledger_id, account_id, source, file_sha256, statement_date,
  closing_balance, currency, imported_by, lines_created, lines_existing, lines_matched) VALUES (%L, %L, %L, 's', %L, '2026-01-01', 0, 'XOF', %L, 0, 0, 0)$q$,
  pg_temp.id('83a001'), (SELECT lb FROM fx), (SELECT wave_b FROM fx), pg_temp.h('y'), pg_temp.id('83aa01'))), 'CL047',
  'relevé sur le grand livre d''un autre prestataire : refusé');

-- ===== 6. account_reconciliation ==================================================================================
-- Compte A-PSP-CARTE : 8 recharges référencées (1000 chacune, 10 janvier) et un relevé de 10 lignes dont 2 inconnues.
SET LOCAL session_replication_role = replica;
CREATE TEMP TABLE tx2 AS SELECT n, pg_temp.mktx((SELECT la FROM fx), pg_temp.id('83a001'), 'c-' || n, (SELECT carte FROM fx), 1000) AS t
  FROM generate_series(1, 8) n;
INSERT INTO psp_topup (psp_topup_id, operator_id, ledger_id, event_id, wallet_id, psp_configuration_id, method, provider,
    amount, currency, fee_amount, status, provider_payment_ref, expires_at, requested_by_kind, customer_id, topup_tx_id, succeeded_at)
SELECT gen_random_uuid(), pg_temp.id('83a001'), (SELECT la FROM fx), pg_temp.id('83e001'), pg_temp.id('83f001'), pg_temp.id('83cf09'),
       'WAVE', 'WAVE', 1000, 'XOF', 0, 'SUCCEEDED', 'C-' || n, now() + interval '1 day', 'CUSTOMER', pg_temp.id('83c001'), t, now()
  FROM tx2;
RESET session_replication_role;
-- Un mouvement postérieur à la date du relevé ne compte pas dans le solde à cette date.
SELECT pg_temp.mktx((SELECT la FROM fx), pg_temp.id('83a001'), 'c-late', (SELECT carte FROM fx), 4242, '2026-02-15 12:00+00');
SELECT is((SELECT reconciled FROM account_reconciliation((SELECT la FROM fx)) WHERE code = 'A-PSP-WAVE'), false,
  'compte WAVE : lignes non rapprochées, non rapproché');
CREATE TEMP TABLE r10 AS SELECT pg_temp.imp('c1', 9000,
  (SELECT jsonb_agg(pg_temp.ln('C-' || n, 1000)) FROM generate_series(1, 8) n) || jsonb_build_array(pg_temp.ln('X-1', 600), pg_temp.ln('X-2', 400)),
  (SELECT carte FROM fx), NULL, 'XOF', '2026-01-31', 'carte') AS j;
SELECT is((SELECT (j->>'matched')::int FROM r10), 8, 'relevé de 10 lignes dont 8 par référence : 8 rapprochées');
SELECT is((SELECT unmatched_lines FROM account_reconciliation((SELECT la FROM fx)) WHERE code = 'A-PSP-CARTE'), 2::bigint,
  '2 lignes non rapprochées');
SELECT is((SELECT reconciled FROM account_reconciliation((SELECT la FROM fx)) WHERE code = 'A-PSP-CARTE'), false,
  'sans anomalie : non rapproché');
SELECT is((SELECT ledger_balance FROM account_reconciliation((SELECT la FROM fx)) WHERE code = 'A-PSP-CARTE'), 8000::bigint,
  'solde du grand livre à la date du relevé (mouvement postérieur exclu)');
SELECT is((SELECT ledger_balance FROM account_reconciliation((SELECT la FROM fx)) WHERE code = 'A-PSP-CARTE'),
  (SELECT signed_balance FROM trial_balance_at((SELECT la FROM fx), '2026-01-31 23:59:59+00') WHERE code = 'A-PSP-CARTE'),
  'même valeur que trial_balance_at');
INSERT INTO anomaly (id, operator_id, ledger_id, kind, amount, status)
VALUES (pg_temp.id('83a910'), pg_temp.id('83a001'), (SELECT la FROM fx), 'PSP_TOPUP_NOT_CREDITED', 1000, 'OPEN');
CREATE TEMP TABLE xl AS SELECT id FROM external_statement_line WHERE external_ref IN ('X-1', 'X-2');
SELECT is((SELECT count(*)::int FROM (SELECT match_statement_line(id, NULL, pg_temp.id('83a910'), pg_temp.id('83aa04')) FROM xl) q), 2,
  'les deux lignes inconnues sont rapprochées à l''anomalie ouverte');
SELECT is((SELECT explained_by_anomalies FROM account_reconciliation((SELECT la FROM fx)) WHERE code = 'A-PSP-CARTE'), 1000::bigint,
  'écart expliqué par l''anomalie');
SELECT is((SELECT reconciled FROM account_reconciliation((SELECT la FROM fx)) WHERE code = 'A-PSP-CARTE'), true,
  'anomalie ouverte égale à l''écart : compte rapproché');
CREATE TEMP TABLE r11 AS SELECT pg_temp.imp('c2', 1234, '[]'::jsonb, (SELECT carte FROM fx), NULL, 'XOF', '2026-01-31', 'carte') AS j;
SELECT is((SELECT reconciled FROM account_reconciliation((SELECT la FROM fx)) WHERE code = 'A-PSP-CARTE'), false,
  'solde de relevé faux (dernier relevé) : non rapproché');
SELECT is((SELECT reconciled FROM account_reconciliation((SELECT la FROM fx)) WHERE code = 'A-BANQUE'), false,
  'compte rapproché ? banque : lignes non rapprochées, non rapproché');
SELECT is(pg_temp.code(format('SELECT * FROM account_reconciliation(%L)', (SELECT lb FROM fx))), 'P0002',
  'grand livre d''un autre prestataire : introuvable');
SELECT is((SELECT reconciled FROM account_reconciliation((SELECT la FROM fx)) WHERE code = 'A-PSP-OM'), false,
  'OM : une ligne inconnue non rapprochée');
-- Compte sans ligne ni mouvement : rapproché (utilise le grand livre d'un second événement de A).
INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone, jurisdiction_id, funds_holder)
VALUES (pg_temp.id('83e003'), pg_temp.id('83a001'), pg_temp.id('83b001'), 'Événement A2', 'XOF', 'Africa/Dakar',
        pg_temp.id('83d001'), 'ORGANIZER');
SELECT open_event_ledger(pg_temp.id('83e003'));
SELECT open_psp_accounts((SELECT id FROM ledger WHERE scope_id = pg_temp.id('83e003')));
SELECT is((SELECT bool_and(reconciled) FROM account_reconciliation((SELECT id FROM ledger WHERE scope_id = pg_temp.id('83e003')))),
  true, 'compte sans ligne ni mouvement : rapproché');

-- ===== 4b. Décision 14 : demande de remboursement déjà recréditée (FAILED) ======================================
SET LOCAL session_replication_role = replica;
CREATE TEMP TABLE txd AS SELECT
  pg_temp.mktx((SELECT la FROM fx), pg_temp.id('83a001'), 'd-f1', (SELECT om FROM fx), -100) AS f1,
  pg_temp.mktx((SELECT la FROM fx), pg_temp.id('83a001'), 'd-f2', (SELECT om FROM fx), -110) AS f2,
  pg_temp.mktx((SELECT la FROM fx), pg_temp.id('83a001'), 'd-p1', (SELECT om FROM fx), -120) AS p1,
  pg_temp.mktx((SELECT la FROM fx), pg_temp.id('83a001'), 'd-d1', (SELECT om FROM fx), -130) AS d1,
  pg_temp.mktx((SELECT la FROM fx), pg_temp.id('83a001'), 'd-p2', (SELECT om FROM fx), -140) AS p2,
  pg_temp.mktx((SELECT la FROM fx), pg_temp.id('83a001'), 'd-d2', (SELECT om FROM fx), -150) AS d2,
  pg_temp.mktx((SELECT la FROM fx), pg_temp.id('83a001'), 'd-r1', (SELECT om FROM fx), 100) AS r1,
  pg_temp.mktx((SELECT la FROM fx), pg_temp.id('83a001'), 'd-r2', (SELECT om FROM fx), 110) AS r2;
INSERT INTO wallet (id, operator_id, ledger_id)
SELECT pg_temp.id(v), pg_temp.id('83a001'), (SELECT la FROM fx) FROM unnest(ARRAY['83f031','83f032','83f033','83f034','83f035','83f036']) v;
INSERT INTO refund_request (operator_id, ledger_id, event_id, wallet_id, method, msisdn, new_number, status, estimated_amount,
    fee, currency, transaction_id, approved_by, external_reference, failure_reason, reversal_transaction_id)
SELECT pg_temp.id('83a001'), (SELECT la FROM fx), pg_temp.id('83e001'), pg_temp.id(v.w), 'WAVE', '+221770000001', false,
       v.st, 100, 0, 'XOF', v.tx, pg_temp.id('83aa02'), v.ref,
       CASE WHEN v.st = 'FAILED' THEN 'paiement rejeté' END, v.rv
  FROM (VALUES ('FL-1', '83f031', 'FAILED', (SELECT f1 FROM txd), (SELECT r1 FROM txd)),
               ('FL-2', '83f032', 'FAILED', (SELECT f2 FROM txd), (SELECT r2 FROM txd)),
               ('PR-1', '83f033', 'PROCESSING', (SELECT p1 FROM txd), NULL::uuid),
               ('PD-1', '83f034', 'PAID', (SELECT d1 FROM txd), NULL),
               ('PR-2', '83f035', 'PROCESSING', (SELECT p2 FROM txd), NULL),
               ('PD-2', '83f036', 'PAID', (SELECT d2 FROM txd), NULL)) v(ref, w, st, tx, rv);
RESET session_replication_role;
CREATE TEMP TABLE rd AS SELECT pg_temp.imp('m5', 0, jsonb_build_array(pg_temp.ln('FL-1', -100), pg_temp.ln('FL-2', -110),
  pg_temp.ln('PR-1', -120), pg_temp.ln('PD-1', -130), pg_temp.ln('PR-2', -1), pg_temp.ln('PD-2', -2)),
  (SELECT om FROM fx), NULL, 'XOF', '2026-01-31', 'om4') AS j;
SELECT is((SELECT (j->>'matched')::int FROM rd), 2,
  'décision 14 : demande FAILED, ligne laissée non rapprochée ; PROCESSING et PAID rapprochées comme avant');
SELECT is((SELECT matched_tx_id FROM external_statement_line WHERE external_ref = 'FL-1'), NULL,
  'FAILED (transaction et référence concordantes) : ligne non rapprochée');
SELECT is((SELECT matched_tx_id FROM external_statement_line WHERE external_ref = 'PR-1'), (SELECT p1 FROM txd),
  'PROCESSING : rapprochée');
SELECT is((SELECT matched_tx_id FROM external_statement_line WHERE external_ref = 'PD-1'), (SELECT d1 FROM txd),
  'PAID : rapprochée');
CREATE FUNCTION pg_temp.m2(p_ref text, p_tx uuid, p_an uuid) RETURNS text LANGUAGE sql AS $$
  SELECT pg_temp.code(format('SELECT match_statement_line(%L, %L, %L, %L)',
    (SELECT id FROM external_statement_line WHERE external_ref = p_ref), p_tx, p_an, pg_temp.id('83aa04')))
$$;
SELECT is(pg_temp.m2('FL-1', (SELECT f1 FROM txd), NULL), 'CL043',
  'manuel : demande FAILED sur la transaction cible : refusé (CL043)');
SELECT is(pg_temp.m2('FL-2', (SELECT sg3 FROM txs), NULL), 'CL043',
  'manuel : demande FAILED sur la référence de la ligne (autre transaction) : refusé (CL043)');
SELECT is(pg_temp.m2('FL-2', NULL, pg_temp.id('83a902')), 'CL043',
  'manuel à une anomalie : demande FAILED sur la référence : refusé (CL043)');
SELECT is((SELECT count(*)::int FROM external_statement_line WHERE external_ref IN ('FL-1', 'FL-2')
  AND (matched_tx_id IS NOT NULL OR matched_anomaly_id IS NOT NULL)), 0, 'lignes FAILED toujours non rapprochées');
SELECT is(pg_temp.m2('PR-2', (SELECT p2 FROM txd), NULL), NULL, 'manuel : demande PROCESSING : inchangé (accepté)');
SELECT is(pg_temp.m2('PD-2', (SELECT d2 FROM txd), NULL), NULL, 'manuel : demande PAID : inchangé (accepté)');

-- ===== 7. Volume : 10 000 lignes en moins de 60 s ===================================================================
CREATE TEMP TABLE clk AS SELECT clock_timestamp() AS t0;
CREATE TEMP TABLE r12 AS SELECT pg_temp.imp('big', 0,
  (SELECT jsonb_agg(pg_temp.ln('B-' || n, 1 + n)) FROM generate_series(1, 10000) n), (SELECT wave FROM fx), NULL, 'XOF', '2026-01-31', 'volume') AS j;
SELECT is((SELECT (j->>'created')::int FROM r12), 10000, '10 000 lignes importées');
SELECT ok(clock_timestamp() - (SELECT t0 FROM clk) < interval '60 seconds', '10 000 lignes en moins de 60 s');

SELECT * FROM finish();
ROLLBACK;
