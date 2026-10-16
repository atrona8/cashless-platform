-- Lecture consommée par une demande de rattachement confirmée (migration 0016) — pgTAP, écrit à la main.
-- Lancer : pg_prove -d <base> tests/tests_media_claim_tap.sql (base créée par les migrations, roles.sql rejoué).
\set ON_ERROR_STOP 1
\set QUIET 1
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

-- Fixture (rôle propriétaire) : prestataires A et B, deux bracelets de A, un terminal, des demandes et des lectures.
INSERT INTO party (id, kind, legal_name, country_code) VALUES
 ('00000000-0000-0000-0000-00000016a001','OPERATOR','Prestataire A','SN'),
 ('00000000-0000-0000-0000-00000016a002','OPERATOR','Prestataire B','CI');
INSERT INTO party (id, kind, operator_id, legal_name) VALUES
 ('00000000-0000-0000-0000-00000016a011','ORGANIZER','00000000-0000-0000-0000-00000016a001','Organisateur A'),
 ('00000000-0000-0000-0000-00000016a021','CUSTOMER','00000000-0000-0000-0000-00000016a001','Festivalier A');
INSERT INTO tag_key (operator_id, key_index, kms_key_ref) VALUES ('00000000-0000-0000-0000-00000016a001', 1, 'test:hmac-16');
INSERT INTO media_batch (id, operator_id, organizer_id, kind, quantity, key_index) VALUES
 ('00000000-0000-0000-0000-00000016b001','00000000-0000-0000-0000-00000016a001','00000000-0000-0000-0000-00000016a011','PUBLIC', 2, 1);
INSERT INTO media (id, operator_id, kind, token_hash, nfc_uid, batch_id, key_index, status)
SELECT ('00000000-0000-0000-0000-00000016d00' || n)::uuid, '00000000-0000-0000-0000-00000016a001', 'NFC_TAG',
       sha256(('identité 0016 ' || n)::bytea), decode('0416000000000' || n, 'hex'), '00000000-0000-0000-0000-00000016b001', 1, 'PERSONALIZED'
  FROM generate_series(1, 2) n;
INSERT INTO device (id, operator_id, kind, serial) VALUES
 ('00000000-0000-0000-0000-00000016e001','00000000-0000-0000-0000-00000016a001','POS','TPE-0016');
-- Demandes : 1, 2, 3 confirmées (bracelet 1), 4 en attente (bracelet 1).
INSERT INTO media_claim (id, operator_id, media_id, customer_id, status, confirmation_hash, expires_at, confirmed_device_id, confirmed_by, confirmed_at)
SELECT ('00000000-0000-0000-0000-00000016c00' || n)::uuid, '00000000-0000-0000-0000-00000016a001', '00000000-0000-0000-0000-00000016d001',
       '00000000-0000-0000-0000-00000016a021', CASE WHEN n = 4 THEN 'PENDING' ELSE 'CONFIRMED' END, sha256(('confirmation ' || n)::bytea),
       now() + interval '1 day',
       CASE WHEN n = 4 THEN NULL ELSE '00000000-0000-0000-0000-00000016e001'::uuid END,
       CASE WHEN n = 4 THEN NULL ELSE '00000000-0000-0000-0000-00000016a099'::uuid END,
       CASE WHEN n = 4 THEN NULL ELSE now() END
  FROM generate_series(1, 4) n;
-- Lectures : 1 récente (bracelet 1), 2 récente (bracelet 2), 3 trop ancienne, 4 déjà consommée par une écriture, 5 récente.
INSERT INTO media_tap (id, operator_id, media_id, counter, nfc_uid, occurred_at, device_id, mode, transaction_id, received_at) VALUES
 (9016001, '00000000-0000-0000-0000-00000016a001', '00000000-0000-0000-0000-00000016d001', 1, '\x04160000000001', now(), '00000000-0000-0000-0000-00000016e001', 'ONLINE', NULL, clock_timestamp()),
 (9016002, '00000000-0000-0000-0000-00000016a001', '00000000-0000-0000-0000-00000016d002', 1, '\x04160000000002', now(), '00000000-0000-0000-0000-00000016e001', 'ONLINE', NULL, clock_timestamp()),
 (9016003, '00000000-0000-0000-0000-00000016a001', '00000000-0000-0000-0000-00000016d001', 2, '\x04160000000001', now(), '00000000-0000-0000-0000-00000016e001', 'ONLINE', NULL, clock_timestamp() - interval '10 minutes'),
 (9016004, '00000000-0000-0000-0000-00000016a001', '00000000-0000-0000-0000-00000016d001', 3, '\x04160000000001', now(), '00000000-0000-0000-0000-00000016e001', 'ONLINE', gen_random_uuid(), clock_timestamp()),
 (9016005, '00000000-0000-0000-0000-00000016a001', '00000000-0000-0000-0000-00000016d001', 4, '\x04160000000001', now(), '00000000-0000-0000-0000-00000016e001', 'ONLINE', NULL, clock_timestamp());
-- Écriture comptable EN LIGNE du bracelet 1 (sans lignes : seul `consume_tap` la lit ici), sur un grand livre de A.
-- Sert au cas « limite connue » ci-dessous : `consume_tap` exige une écriture existante du même prestataire.
INSERT INTO ledger (id, operator_id, scope_type, scope_id, currency, issuer_id, funds_holder_id) VALUES
 ('00000000-0000-0000-0000-00000016f071','00000000-0000-0000-0000-00000016a001','ORGANIZER','00000000-0000-0000-0000-00000016a011','XOF',
  '00000000-0000-0000-0000-00000016a011','00000000-0000-0000-0000-00000016a011');
INSERT INTO journal_transaction (id, operator_id, ledger_id, type, idempotency_key, request_hash, occurred_at, source, device_id, media_id) VALUES
 ('00000000-0000-0000-0000-00000016f081','00000000-0000-0000-0000-00000016a001','00000000-0000-0000-0000-00000016f071','PURCHASE',
  'tap-0016:1', 'empreinte 0016', now(), 'ONLINE', '00000000-0000-0000-0000-00000016e001', '00000000-0000-0000-0000-00000016d001');

SELECT is((SELECT count(*)::int FROM pg_proc WHERE proname = 'consume_tap_for_claim' AND NOT prosecdef), 1, 'SECURITY INVOKER');

SET LOCAL ROLE cashless_app;
SELECT set_config('app.operator_id', '00000000-0000-0000-0000-00000016a001', true);

SELECT lives_ok($Q$SELECT consume_tap_for_claim(9016001, '00000000-0000-0000-0000-00000016c001')$Q$, 'lecture récente du bracelet de la demande confirmée : consommée');
SELECT is((SELECT confirmed_tap_id FROM media_claim WHERE id = '00000000-0000-0000-0000-00000016c001'), 9016001::bigint, 'la demande garde sa lecture');
SELECT lives_ok($Q$SELECT consume_tap_for_claim(9016001, '00000000-0000-0000-0000-00000016c001')$Q$, 'rejeu : sans effet');
SELECT throws_ok($Q$SELECT consume_tap_for_claim(9016001, '00000000-0000-0000-0000-00000016c002')$Q$, 'CL022', NULL, 'une lecture ne confirme qu''une demande');
SELECT throws_ok($Q$SELECT consume_tap_for_claim(9016005, '00000000-0000-0000-0000-00000016c001')$Q$, 'CL020', NULL, 'une demande ne prend qu''une lecture');
SELECT throws_ok($Q$SELECT consume_tap_for_claim(9016002, '00000000-0000-0000-0000-00000016c002')$Q$, 'CL001', NULL, 'lecture d''un autre bracelet : refusée');
-- Hors fenêtre (120 s par défaut, terminal sans événement) : refus nommé « expirée », distinct de « déjà utilisée ».
SELECT throws_ok($Q$SELECT consume_tap_for_claim(9016003, '00000000-0000-0000-0000-00000016c002')$Q$, 'CL022', 'Lecture 9016003 expirée',
  'lecture hors fenêtre : refusée');
SELECT is((SELECT confirmed_tap_id FROM media_claim WHERE id = '00000000-0000-0000-0000-00000016c002'), NULL::bigint,
  'lecture hors fenêtre : la demande reste sans lecture');
SELECT throws_ok($Q$SELECT consume_tap_for_claim(9016004, '00000000-0000-0000-0000-00000016c002')$Q$, 'CL022', NULL, 'lecture déjà consommée par une écriture : refusée');
SELECT throws_ok($Q$SELECT consume_tap_for_claim(9016005, '00000000-0000-0000-0000-00000016c004')$Q$, 'CL020', NULL, 'demande en attente (non confirmée) : refusée');
SELECT lives_ok($Q$SELECT consume_tap_for_claim(9016005, '00000000-0000-0000-0000-00000016c003')$Q$, 'autre demande confirmée, autre lecture récente : consommée');
SELECT throws_ok($Q$UPDATE media_tap SET transaction_id = gen_random_uuid() WHERE id = 9016002$Q$, '42501', NULL, 'le rôle de l''API ne modifie pas les lectures');

-- LIMITE CONNUE (ADR-90, OP-N50) : `consume_tap` (schéma de référence, non modifiable) ignore `confirmed_tap_id`.
-- La lecture 9016001, qui a confirmé la demande c001, récente, sert ENCORE à une écriture en ligne du même bracelet.
-- Ce cas documente l'état actuel : quand la limite sera levée, il doit basculer en throws_ok(..., 'CL022', ...).
SELECT lives_ok($Q$SELECT consume_tap(9016001, '00000000-0000-0000-0000-00000016f081')$Q$,
  'LIMITE ADR-90/OP-N50 : consume_tap accepte une lecture déjà liée à une demande confirmée, dans la fenêtre '
  '(à basculer en refus CL022 quand la limite sera levée)');
SELECT is((SELECT transaction_id FROM media_tap WHERE id = 9016001), '00000000-0000-0000-0000-00000016f081'::uuid,
  'LIMITE ADR-90/OP-N50 : la lecture porte l''écriture tout en restant liée à la demande (double usage, état actuel)');
SELECT is((SELECT confirmed_tap_id FROM media_claim WHERE id = '00000000-0000-0000-0000-00000016c001'), 9016001::bigint,
  'LIMITE ADR-90/OP-N50 : la demande c001 garde la même lecture');
-- La limite ne s'élargit pas : la lecture consommée par une écriture ne confirme plus aucune demande.
SELECT throws_ok($Q$SELECT consume_tap_for_claim(9016001, '00000000-0000-0000-0000-00000016c002')$Q$, 'CL022', NULL,
  'lecture consommée par une écriture après la demande : ne confirme pas une seconde demande');

-- Autre prestataire : ni la demande ni la lecture n'existent pour lui.
SELECT set_config('app.operator_id', '00000000-0000-0000-0000-00000016a002', true);
SELECT throws_ok($Q$SELECT consume_tap_for_claim(9016002, '00000000-0000-0000-0000-00000016c002')$Q$, 'P0002', NULL, 'autre prestataire : introuvable');

SELECT * FROM finish();
ROLLBACK;
