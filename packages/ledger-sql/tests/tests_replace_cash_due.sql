-- replace_media et espèces dues (migration 0082 ; mission remboursements 9a, WP02 ; FR-018, OP-N55) — pgTAP,
-- écrit à la main (pas un fichier généré). En-tête de suite : tests_customer_auth.sql.
-- Prouve : les espèces dues OPEN (CASH_TOPUP_OVER_LIMIT) suivent le bracelet neuf, une seule fois ; RESOLVED, autre
-- nature et autre prestataire restent en place ; statut intact (anomaly_cash_due_guard seul chemin de clôture) ;
-- aucun droit nouveau, search_path figé.
-- Lancer : pg_prove -d <base> tests/tests_replace_cash_due.sql (base créée par les migrations, droits rejoués).
\set ON_ERROR_STOP 1
\set QUIET 1
BEGIN;
\ir _grants_for_tests.sql
SET LOCAL client_min_messages = warning;
\ir ../roles.sql
RESET client_min_messages;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

CREATE FUNCTION pg_temp.id(p text) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT ('00000000-0000-0000-0000-' || lpad(p, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.a() RETURNS void LANGUAGE sql AS
  $$ SELECT set_config('app.operator_id', pg_temp.id('82a001')::text, true) $$;
CREATE FUNCTION pg_temp.b() RETURNS void LANGUAGE sql AS
  $$ SELECT set_config('app.operator_id', pg_temp.id('82a002')::text, true) $$;

-- Données (propriétaire) : prestataire A (événement LIVE, caisse ouverte), prestataire B (un bracelet). ------------
INSERT INTO party (kind, legal_name) SELECT 'PLATFORM', 'Plateforme (test)'
 WHERE NOT EXISTS (SELECT 1 FROM party WHERE kind = 'PLATFORM');
INSERT INTO party (id, kind, legal_name, country_code) VALUES
 (pg_temp.id('82a001'), 'OPERATOR', 'Prestataire A', 'SN'),
 (pg_temp.id('82a002'), 'OPERATOR', 'Prestataire B', 'CI');
INSERT INTO party (id, kind, operator_id, legal_name) VALUES
 (pg_temp.id('82b001'), 'ORGANIZER', pg_temp.id('82a001'), 'Organisateur A'),
 (pg_temp.id('82b002'), 'ORGANIZER', pg_temp.id('82a002'), 'Organisateur B');
INSERT INTO jurisdiction_profile (id, country_code, version, valid_from, breakage_destination)
VALUES (pg_temp.id('82c001'), 'SN', 820082, '2026-01-01', 'ORGANIZER');
INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone, jurisdiction_id, funds_holder, status)
VALUES (pg_temp.id('82d001'), pg_temp.id('82a001'), pg_temp.id('82b001'), 'Événement A', 'XOF',
        'Africa/Dakar', pg_temp.id('82c001'), 'ORGANIZER', 'LIVE'),
       (pg_temp.id('82d002'), pg_temp.id('82a002'), pg_temp.id('82b002'), 'Événement B', 'XOF',
        'Africa/Dakar', pg_temp.id('82c001'), 'ORGANIZER', 'LIVE');
SELECT pg_temp.a();
SELECT open_event_ledger(pg_temp.id('82d001'));
SELECT pg_temp.b();
SELECT open_event_ledger(pg_temp.id('82d002'));
CREATE FUNCTION pg_temp.lg(p_event text) RETURNS uuid LANGUAGE sql AS
  $$ SELECT id FROM ledger WHERE scope_id = pg_temp.id(p_event) $$;
CREATE FUNCTION pg_temp.acc(p_ledger uuid, p_code text) RETURNS uuid LANGUAGE sql AS
  $$ SELECT id FROM account WHERE ledger_id = p_ledger AND code = p_code $$;
CREATE FUNCTION pg_temp.due() RETURNS bigint LANGUAGE sql AS
  $$ SELECT coalesce((SELECT balance FROM account_balance
                       WHERE account_id = pg_temp.acc(pg_temp.lg('82d001'), 'L-ESP-A-RENDRE')), 0) $$;
INSERT INTO app_user (id, operator_id, issuer, subject, email, display_name) VALUES
 (pg_temp.id('82e001'), pg_temp.id('82a001'), 'https://idp.test', 's82e001', 'e1@test', 'Caissier'),
 (pg_temp.id('82e002'), pg_temp.id('82a001'), 'https://idp.test', 's82e002', 'e2@test', 'Superviseur');
INSERT INTO role_assignment (user_id, role, scope_type, scope_id, granted_by) VALUES
 (pg_temp.id('82e001'), 'CASHIER', 'EVENT', pg_temp.id('82d001'), NULL),
 (pg_temp.id('82e002'), 'SUPERVISOR', 'EVENT', pg_temp.id('82d001'), NULL);
INSERT INTO device (id, operator_id, kind, app_mode, event_id, serial)
VALUES (pg_temp.id('82aa01'), pg_temp.id('82a001'), 'TOPUP', 'TOPUP_DESK', pg_temp.id('82d001'), 'C82-AA01');
SELECT pg_temp.a();
SELECT open_cash_session(pg_temp.id('82aa01'), pg_temp.id('82e001'));
CREATE FUNCTION pg_temp.caisse() RETURNS uuid LANGUAGE sql AS
  $$ SELECT pg_temp.acc(pg_temp.lg('82d001'), 'A-CAISSE-C82-AA01') $$;

-- Portefeuilles : w1 (chaîne A→B→C), w2 (anomalie RESOLVED), w3 (autre nature), w4 (autre prestataire).
INSERT INTO wallet (id, operator_id, ledger_id) VALUES
 (pg_temp.id('82f001'), pg_temp.id('82a001'), pg_temp.lg('82d001')),
 (pg_temp.id('82f002'), pg_temp.id('82a001'), pg_temp.lg('82d001')),
 (pg_temp.id('82f003'), pg_temp.id('82a001'), pg_temp.lg('82d001')),
 (pg_temp.id('82f004'), pg_temp.id('82a002'), pg_temp.lg('82d002')),
 (pg_temp.id('82f005'), pg_temp.id('82a001'), pg_temp.lg('82d001'));
INSERT INTO account (operator_id, ledger_id, code, family, purpose, wallet_id, normal_side) VALUES
 (pg_temp.id('82a001'), pg_temp.lg('82d001'), 'L-WAL-82-1', 'CLAIM', 'WALLET_PAID', pg_temp.id('82f001'), 'C'),
 (pg_temp.id('82a001'), pg_temp.lg('82d001'), 'L-WAL-82-2', 'CLAIM', 'WALLET_PAID', pg_temp.id('82f002'), 'C'),
 (pg_temp.id('82a001'), pg_temp.lg('82d001'), 'L-WAL-82-3', 'CLAIM', 'WALLET_PAID', pg_temp.id('82f003'), 'C');
INSERT INTO tag_key (operator_id, key_index, kms_key_ref, status) VALUES
 (pg_temp.id('82a001'), 1, 'test:hmac-82a', 'ACTIVE'), (pg_temp.id('82a002'), 1, 'test:hmac-82b', 'ACTIVE');
INSERT INTO media_batch (id, operator_id, organizer_id, kind, quantity, key_index, deposit_amount, deposit_mode) VALUES
 (pg_temp.id('82f901'), pg_temp.id('82a001'), pg_temp.id('82b001'), 'PUBLIC', 20, 1, 3000, 'SEPARATE'),
 (pg_temp.id('82f902'), pg_temp.id('82a002'), pg_temp.id('82b002'), 'PUBLIC', 5, 1, 3000, 'SEPARATE');
-- Anciens (portefeuille posé : bracelet ACTIVE) : 101 -> w1, 102 -> w2, 103 -> w3 ; neufs PERSONALIZED : 201 à 205.
INSERT INTO media (id, operator_id, kind, token_hash, nfc_uid, batch_id, key_index, wallet_id)
SELECT pg_temp.id('82f1' || lpad(n::text, 2, '0')), pg_temp.id('82a001'), 'NFC_TAG', sha256(('m82-' || n)::bytea),
       ('\x0482' || lpad(n::text, 10, '0'))::bytea, pg_temp.id('82f901'), 1,
       CASE n WHEN 1 THEN pg_temp.id('82f001') WHEN 2 THEN pg_temp.id('82f002') WHEN 3 THEN pg_temp.id('82f003')
         WHEN 5 THEN pg_temp.id('82f005') END
  FROM (VALUES (1), (2), (3), (5)) AS v(n);
INSERT INTO media (id, operator_id, kind, token_hash, nfc_uid, batch_id, key_index, wallet_id)
SELECT pg_temp.id('82f2' || lpad(n::text, 2, '0')), pg_temp.id('82a001'), 'NFC_TAG', sha256(('m82-n' || n)::bytea),
       ('\x0482' || lpad((100 + n)::text, 10, '0'))::bytea, pg_temp.id('82f901'), 1, NULL
  FROM generate_series(1, 5) n;
INSERT INTO media (id, operator_id, kind, token_hash, nfc_uid, batch_id, key_index, wallet_id) VALUES
 (pg_temp.id('82f104'), pg_temp.id('82a002'), 'NFC_TAG', sha256('m82-b1'), '\x048200000000b1',
  pg_temp.id('82f902'), 1, pg_temp.id('82f004')),
 (pg_temp.id('82f2b4'), pg_temp.id('82a002'), 'NFC_TAG', sha256('m82-b2'), '\x048200000000b2',
  pg_temp.id('82f902'), 1, NULL);
-- Mise en service des anciens (ISSUED puis ACTIVE, comme l'activation).
UPDATE media SET status = 'ISSUED' WHERE id IN (pg_temp.id('82f101'), pg_temp.id('82f102'), pg_temp.id('82f103'),
  pg_temp.id('82f105'), pg_temp.id('82f104'));
UPDATE media SET status = 'ACTIVE' WHERE id IN (pg_temp.id('82f101'), pg_temp.id('82f102'), pg_temp.id('82f103'),
  pg_temp.id('82f105'), pg_temp.id('82f104'));
SELECT is((SELECT string_agg(status::text, ',' ORDER BY id) FROM media
            WHERE id IN (pg_temp.id('82f101'), pg_temp.id('82f201'))), 'ACTIVE,PERSONALIZED',
          'montage : ancien ACTIVE avec portefeuille, neuf PERSONALIZED');

-- Recharges espèces découpées sur w1 (400 dus) et w2 (300 dus) ; une anomalie d'espèces dues par bracelet. ---------
CREATE FUNCTION pg_temp.topup(p_key text, p_wallet text, p_due bigint) RETURNS uuid LANGUAGE sql AS $$
  SELECT post_transaction(pg_temp.lg('82d001'), 'TOPUP_CASH', p_key, clock_timestamp(), 'ONLINE',
    jsonb_build_array(
      jsonb_build_object('account_id', pg_temp.caisse(), 'amount', 1000),
      jsonb_build_object('account_id', pg_temp.acc(pg_temp.lg('82d001'), 'L-WAL-82-' || p_wallet),
                         'amount', -(1000 - p_due)),
      jsonb_build_object('account_id', pg_temp.acc(pg_temp.lg('82d001'), 'L-ESP-A-RENDRE'), 'amount', -p_due)),
    NULL, NULL, NULL, NULL, NULL, pg_temp.id('82aa01')) $$;
CREATE FUNCTION pg_temp.sess() RETURNS uuid LANGUAGE sql AS
  $$ SELECT cash_session_id FROM cash_session WHERE device_id = pg_temp.id('82aa01') $$;
CREATE FUNCTION pg_temp.tx(p_key text) RETURNS uuid LANGUAGE sql AS
  $$ SELECT id FROM journal_transaction WHERE idempotency_key = p_key $$;
SELECT pg_temp.a();
SELECT attach_cash_tx(pg_temp.sess(), pg_temp.topup('R82-1', '1', 400));
SELECT attach_cash_tx(pg_temp.sess(), pg_temp.topup('R82-2', '2', 300));
SELECT open_cash_due_anomaly(pg_temp.lg('82d001'), pg_temp.id('82f101'), 400, pg_temp.tx('R82-1'));
SELECT open_cash_due_anomaly(pg_temp.lg('82d001'), pg_temp.id('82f102'), 300, pg_temp.tx('R82-2'));
-- 102 : espèces dues déjà rendues (RESOLVED) ; 103 : anomalie d'une autre nature (PSP_TOPUP_OVER_LIMIT) ;
-- anomalie d'un AUTRE prestataire posée sur le bracelet 105 (cas artificiel : prouve le filtre sur operator_id).
SELECT refund_cash_due(pg_temp.id('82f102'), pg_temp.caisse(), 'RF82-102', pg_temp.id('82e001'),
                       pg_temp.id('82e002'), pg_temp.id('82aa01'));
INSERT INTO anomaly (operator_id, ledger_id, kind, media_id, amount, status) VALUES
 (pg_temp.id('82a001'), pg_temp.lg('82d001'), 'PSP_TOPUP_OVER_LIMIT', pg_temp.id('82f103'), 100, 'OPEN'),
 (pg_temp.id('82a002'), pg_temp.lg('82d002'), 'CASH_TOPUP_OVER_LIMIT', pg_temp.id('82f105'), 50, 'OPEN');
CREATE FUNCTION pg_temp.an(p_media text, p_kind text, p_status text, p_operator text DEFAULT '82a001')
RETURNS int LANGUAGE sql AS $$
  SELECT count(*)::int FROM anomaly WHERE media_id = pg_temp.id(p_media) AND kind = p_kind
     AND status = p_status AND operator_id = pg_temp.id(p_operator) $$;

SELECT is(pg_temp.due(), -400::bigint, 'avant : 400 d''espèces dues (102 déjà rendu)');
SELECT is(pg_temp.an('82f101', 'CASH_TOPUP_OVER_LIMIT', 'OPEN'), 1, 'avant : anomalie ouverte sur l''ancien 101');

-- 1. Remplacement 101 -> 201 -------------------------------------------------------------------------------------------
SELECT pg_temp.a();
SELECT lives_ok($$SELECT replace_media(pg_temp.id('82f101'), pg_temp.id('82f201'))$$, 'replace_media(101, 201)');
SELECT is(pg_temp.an('82f201', 'CASH_TOPUP_OVER_LIMIT', 'OPEN'), 1, 'l''anomalie OPEN porte le bracelet neuf');
SELECT is((SELECT amount FROM anomaly WHERE media_id = pg_temp.id('82f201') AND kind = 'CASH_TOPUP_OVER_LIMIT'),
          400::bigint, 'même montant');
SELECT is(pg_temp.an('82f101', 'CASH_TOPUP_OVER_LIMIT', 'OPEN'), 0, 'l''ancien n''a plus d''anomalie ouverte (A)');
SELECT is(pg_temp.due(), -400::bigint, 'aucune écriture comptable : L-ESP-A-RENDRE inchangé');
SELECT is((SELECT status FROM anomaly WHERE media_id = pg_temp.id('82f201')), 'OPEN',
          'statut intact (la garde de clôture ne se déclenche pas)');
SELECT is((SELECT resolution_tx_id FROM anomaly WHERE media_id = pg_temp.id('82f201')), NULL,
          'aucune écriture de résolution posée');
SELECT throws_ok($$SELECT refund_cash_due(pg_temp.id('82f101'), pg_temp.caisse(), 'RF82-OLD',
  pg_temp.id('82e001'), pg_temp.id('82e002'), pg_temp.id('82aa01'))$$, 'CL020', NULL,
  'refund_cash_due(ancien) : CL020');

-- 2. Remplacement en chaîne 201 -> 202 : l'anomalie ouverte suit encore -------------------------------------------------
SELECT lives_ok($$SELECT replace_media(pg_temp.id('82f201'), pg_temp.id('82f202'))$$, 'replace_media(201, 202)');
SELECT is(pg_temp.an('82f202', 'CASH_TOPUP_OVER_LIMIT', 'OPEN'), 1, 'chaîne A -> B -> C : elle suit le dernier');
SELECT is(pg_temp.an('82f201', 'CASH_TOPUP_OVER_LIMIT', 'OPEN'), 0, 'le bracelet intermédiaire n''en garde pas');

-- 3. Rendu : une seule fois, sur le bracelet neuf ----------------------------------------------------------------------
SELECT throws_ok($$SELECT refund_cash_due(pg_temp.id('82f201'), pg_temp.caisse(), 'RF82-MID',
  pg_temp.id('82e001'), pg_temp.id('82e002'), pg_temp.id('82aa01'))$$, 'CL020', NULL,
  'refund_cash_due(intermédiaire) : CL020');
SELECT lives_ok($$SELECT refund_cash_due(pg_temp.id('82f202'), pg_temp.caisse(), 'RF82-NEW',
  pg_temp.id('82e001'), pg_temp.id('82e002'), pg_temp.id('82aa01'))$$, 'refund_cash_due(neuf) rend la somme');
SELECT is((SELECT count(*)::int FROM journal_transaction t JOIN posting p ON p.transaction_id = t.id
            WHERE t.idempotency_key = 'RF82-NEW' AND t.type = 'WALLET_REFUND' AND p.amount = 400), 1,
          'une écriture WALLET_REFUND de 400');
SELECT is(pg_temp.an('82f202', 'CASH_TOPUP_OVER_LIMIT', 'RESOLVED'), 1, 'anomalie RESOLVED');
SELECT is((SELECT resolution_tx_id FROM anomaly WHERE media_id = pg_temp.id('82f202')), pg_temp.tx('RF82-NEW'),
          'resolution_tx_id posé');
SELECT throws_ok($$SELECT refund_cash_due(pg_temp.id('82f202'), pg_temp.caisse(), 'RF82-NEW2',
  pg_temp.id('82e001'), pg_temp.id('82e002'), pg_temp.id('82aa01'))$$, 'CL020', NULL, 'autre clé : CL020');
SELECT is(refund_cash_due(pg_temp.id('82f202'), pg_temp.caisse(), 'RF82-NEW',
  pg_temp.id('82e001'), pg_temp.id('82e002'), pg_temp.id('82aa01')), pg_temp.tx('RF82-NEW'),
  'même clé : même transaction');
SELECT is(pg_temp.due(), 0::bigint, 'L-ESP-A-RENDRE : solde nul');

-- 4. Ce qui reste en place ---------------------------------------------------------------------------------------------
SELECT lives_ok($$SELECT replace_media(pg_temp.id('82f102'), pg_temp.id('82f203'))$$, 'replace_media(102, 203)');
SELECT is(pg_temp.an('82f102', 'CASH_TOPUP_OVER_LIMIT', 'RESOLVED'), 1, 'RESOLVED : reste sur l''ancien');
SELECT is(pg_temp.an('82f203', 'CASH_TOPUP_OVER_LIMIT', 'RESOLVED'), 0, 'RESOLVED : rien sur le neuf');
SELECT lives_ok($$SELECT replace_media(pg_temp.id('82f103'), pg_temp.id('82f204'))$$, 'replace_media(103, 204)');
SELECT is(pg_temp.an('82f103', 'PSP_TOPUP_OVER_LIMIT', 'OPEN'), 1, 'PSP_TOPUP_OVER_LIMIT : reste sur l''ancien');
SELECT is(pg_temp.an('82f204', 'PSP_TOPUP_OVER_LIMIT', 'OPEN'), 0, 'PSP_TOPUP_OVER_LIMIT : rien sur le neuf');
SELECT lives_ok($$SELECT replace_media(pg_temp.id('82f105'), pg_temp.id('82f205'))$$, 'replace_media(105, 205)');
SELECT is(pg_temp.an('82f105', 'CASH_TOPUP_OVER_LIMIT', 'OPEN', '82a002'), 1,
          'anomalie d''un autre prestataire sur l''ancien : intacte');
SELECT is(pg_temp.an('82f205', 'CASH_TOPUP_OVER_LIMIT', 'OPEN', '82a002'), 0,
          'anomalie d''un autre prestataire : rien sur le neuf');

-- 5. Droits : cashless_app ne clôt pas à la main, ne modifie pas media_id, reste cloisonné ----------------------------
-- (nouvelle anomalie ouverte sur 202 : recharge 105 -> w1 puis remplacement n'est pas nécessaire ici)
SELECT attach_cash_tx(pg_temp.sess(), pg_temp.topup('R82-4', '1', 150));
SELECT open_cash_due_anomaly(pg_temp.lg('82d001'), pg_temp.id('82f202'), 150, pg_temp.tx('R82-4'));
SET LOCAL ROLE cashless_app;
SELECT pg_temp.a();
SELECT throws_ok($$UPDATE anomaly SET status = 'RESOLVED', resolution_tx_id = (SELECT id FROM journal_transaction
  WHERE idempotency_key = 'R82-4') WHERE media_id = pg_temp.id('82f202') AND status = 'OPEN'$$, 'CL020', NULL,
  'cashless_app ne clôt pas les espèces dues à la main : CL020');
SELECT throws_ok($$UPDATE anomaly SET media_id = pg_temp.id('82f205') WHERE media_id = pg_temp.id('82f202')$$,
  '42501', NULL, 'cashless_app ne modifie pas media_id : 42501');
SELECT throws_ok($$SELECT replace_media(pg_temp.id('82f104'), pg_temp.id('82f2b4'))$$, 'P0002', NULL,
  'replace_media sous cashless_app : bracelet d''un autre prestataire refusé (assert_tenant)');
RESET ROLE;

-- 6. search_path fixé, droits d'EXECUTE inchangés ------------------------------------------------------------------------
SELECT ok((SELECT proconfig @> ARRAY['search_path=public, pg_temp'] FROM pg_proc
            WHERE oid = 'replace_media(uuid, uuid)'::regprocedure), 'replace_media : search_path = public, pg_temp');
SELECT ok((SELECT prosecdef FROM pg_proc WHERE oid = 'replace_media(uuid, uuid)'::regprocedure),
          'replace_media reste SECURITY DEFINER');
SELECT ok(has_function_privilege('cashless_app', 'replace_media(uuid, uuid)', 'EXECUTE'),
          'cashless_app garde EXECUTE sur replace_media (droit existant)');
SELECT is((SELECT count(*)::int FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
            WHERE p.oid = 'replace_media(uuid, uuid)'::regprocedure AND a.grantee = 0), 0,
          'replace_media : aucun EXECUTE pour PUBLIC');
SELECT is((SELECT count(*)::int FROM pg_proc WHERE proname = 'replace_media'), 1,
          'une seule fonction replace_media (aucune fonction nouvelle)');

SELECT * FROM finish();
ROLLBACK;
