-- `consume_tap` refuse une lecture qui a confirmé une demande de rattachement (migration 0024,
-- OP-N50, mission 5a) — pgTAP, écrit à la main.
-- Lancer : pg_prove -d <base> tests/tests_consume_tap_claim.sql (base créée par les migrations,
-- roles.sql rejoué).
-- Chaque refus a son témoin : la même écriture sur une lecture ordinaire passe. Les refus d'avant
-- (lecture déjà consommée par une écriture, autre prestataire) restent tels quels.
\set ON_ERROR_STOP 1
\set QUIET 1
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

-- Fixture (rôle propriétaire) : prestataires A et B, un bracelet de A, un terminal, des lectures,
-- des demandes et des écritures.
INSERT INTO party (id, kind, legal_name, country_code) VALUES
 ('00000000-0000-0000-0000-00000024a001','OPERATOR','Prestataire A','SN'),
 ('00000000-0000-0000-0000-00000024a002','OPERATOR','Prestataire B','CI');
INSERT INTO party (id, kind, operator_id, legal_name) VALUES
 ('00000000-0000-0000-0000-00000024a011','ORGANIZER','00000000-0000-0000-0000-00000024a001','Organisateur A'),
 ('00000000-0000-0000-0000-00000024a021','CUSTOMER','00000000-0000-0000-0000-00000024a001','Festivalier A');
INSERT INTO tag_key (operator_id, key_index, kms_key_ref) VALUES ('00000000-0000-0000-0000-00000024a001', 1, 'test:hmac-24');
INSERT INTO media_batch (id, operator_id, organizer_id, kind, quantity, key_index) VALUES
 ('00000000-0000-0000-0000-00000024b001','00000000-0000-0000-0000-00000024a001','00000000-0000-0000-0000-00000024a011','PUBLIC', 1, 1);
INSERT INTO media (id, operator_id, kind, token_hash, nfc_uid, batch_id, key_index, status) VALUES
 ('00000000-0000-0000-0000-00000024d001','00000000-0000-0000-0000-00000024a001','NFC_TAG', sha256('identité 0024'::bytea),
  '\x04240000000001','00000000-0000-0000-0000-00000024b001', 1, 'PERSONALIZED');
INSERT INTO device (id, operator_id, kind, serial) VALUES
 ('00000000-0000-0000-0000-00000024e001','00000000-0000-0000-0000-00000024a001','POS','TPE-0024');
-- Lectures du bracelet : 1 récente (confirmera la demande c001 par consume_tap_for_claim), 2
-- récente ordinaire, 3 récente (déjà liée à la demande c002), 4 ancienne (déjà liée à c004), 5
-- ancienne ordinaire.
INSERT INTO media_tap (id, operator_id, media_id, counter, nfc_uid, occurred_at, device_id, mode, transaction_id, received_at)
SELECT 9024000 + n, '00000000-0000-0000-0000-00000024a001', '00000000-0000-0000-0000-00000024d001', n, '\x04240000000001',
       now(), '00000000-0000-0000-0000-00000024e001', 'ONLINE', NULL,
       CASE WHEN n >= 4 THEN clock_timestamp() - interval '10 minutes' ELSE clock_timestamp() END
  FROM generate_series(1, 5) n;
-- Demandes confirmées du bracelet : c001 et c003 sans lecture, c002 liée à la lecture 3, c004 à la
-- lecture 4.
INSERT INTO media_claim (id, operator_id, media_id, customer_id, status, confirmation_hash, expires_at,
                         confirmed_device_id, confirmed_by, confirmed_at, confirmed_tap_id)
SELECT ('00000000-0000-0000-0000-00000024c00' || n)::uuid, '00000000-0000-0000-0000-00000024a001',
       '00000000-0000-0000-0000-00000024d001', '00000000-0000-0000-0000-00000024a021', 'CONFIRMED',
       sha256(('confirmation 0024 ' || n)::bytea), now() + interval '1 day', '00000000-0000-0000-0000-00000024e001',
       '00000000-0000-0000-0000-00000024a099', now(), CASE n WHEN 2 THEN 9024003 WHEN 4 THEN 9024004 END
  FROM generate_series(1, 4) n;
-- Écritures du bracelet (sans lignes : seul `consume_tap` les lit ici) : f081 et f082 en ligne,
-- f083 et f084 synchronisées hors ligne (aucune fenêtre de délai).
INSERT INTO ledger (id, operator_id, scope_type, scope_id, currency, issuer_id, funds_holder_id) VALUES
 ('00000000-0000-0000-0000-00000024f071','00000000-0000-0000-0000-00000024a001','ORGANIZER','00000000-0000-0000-0000-00000024a011','XOF',
  '00000000-0000-0000-0000-00000024a011','00000000-0000-0000-0000-00000024a011');
INSERT INTO journal_transaction (id, operator_id, ledger_id, type, idempotency_key, request_hash, occurred_at, source, device_id, media_id)
SELECT ('00000000-0000-0000-0000-00000024f08' || n)::uuid, '00000000-0000-0000-0000-00000024a001',
       '00000000-0000-0000-0000-00000024f071', 'PURCHASE', 'tap-0024:' || n, 'empreinte 0024', now(),
       CASE WHEN n <= 2 THEN 'ONLINE' ELSE 'OFFLINE_SYNC' END, '00000000-0000-0000-0000-00000024e001',
       '00000000-0000-0000-0000-00000024d001'
  FROM generate_series(1, 4) n;

-- Forme : consume_tap reste SECURITY DEFINER, search_path fixé (OP-N59) ; consume_tap_for_claim
-- l'est aussi depuis 0026 (lot WP07 : l'API n'écrit plus confirmed_tap_id directement) ; les deux
-- prennent le même verrou par lecture (concurrence écriture / demande).
SELECT is((SELECT prosecdef::text || ':' || array_to_string(proconfig, ',') FROM pg_proc WHERE proname = 'consume_tap'),
  'true:search_path=public, pg_temp', 'consume_tap : SECURITY DEFINER, search_path = public, pg_temp');
SELECT is((SELECT prosecdef::text || ':' || array_to_string(proconfig, ',') FROM pg_proc
             WHERE proname = 'consume_tap_for_claim'),
  'true:search_path=public, pg_temp',
  'consume_tap_for_claim : SECURITY DEFINER, search_path = public, pg_temp (0026)');
-- 0026 (relecture de WP05) : la lecture liée à une demande ne s'écrit que par
-- consume_tap_for_claim.
SELECT ok(NOT has_column_privilege('cashless_app', 'media_claim', 'confirmed_tap_id', 'UPDATE'),
  'cashless_app : aucun UPDATE de media_claim.confirmed_tap_id');
SELECT ok(NOT has_function_privilege('public', 'consume_tap_for_claim(bigint, uuid)', 'EXECUTE')
      AND has_function_privilege('cashless_app', 'consume_tap_for_claim(bigint, uuid)', 'EXECUTE'),
  'consume_tap_for_claim : exécutée par cashless_app nommément, pas par PUBLIC');
SELECT is((SELECT count(*)::int FROM pg_proc WHERE proname IN ('consume_tap', 'consume_tap_for_claim')
            AND prosrc LIKE '%pg_advisory_xact_lock(hashtextextended(''media-tap-use:'' || p_tap::text, 0))%'), 2,
  'consume_tap et consume_tap_for_claim prennent le même verrou consultatif par lecture');

SET LOCAL ROLE cashless_app;
SELECT set_config('app.operator_id', '00000000-0000-0000-0000-00000024a001', true);

-- 1. Lecture qui vient de confirmer une demande : refusée à une écriture en ligne.
SELECT lives_ok($Q$SELECT consume_tap_for_claim(9024001, '00000000-0000-0000-0000-00000024c001')$Q$,
  'préparation : la lecture 1 confirme la demande c001');
SELECT throws_ok($Q$SELECT consume_tap(9024001, '00000000-0000-0000-0000-00000024f081')$Q$, 'CL022',
  'Passage 9024001 déjà utilisé par une demande de rattachement',
  'OP-N50 : lecture qui a confirmé une demande, écriture en ligne dans la fenêtre : refusée (CL022)');
SELECT is((SELECT transaction_id FROM media_tap WHERE id = 9024001), NULL::uuid,
  'OP-N50 : la lecture refusée ne porte aucune écriture');
SELECT is((SELECT confirmed_tap_id FROM media_claim WHERE id = '00000000-0000-0000-0000-00000024c001'), 9024001::bigint,
  'la demande c001 garde sa lecture');
-- 2. Lecture déjà liée à une demande (quel que soit le chemin qui l'a liée) : refusée aussi.
SELECT throws_ok($Q$SELECT consume_tap(9024003, '00000000-0000-0000-0000-00000024f081')$Q$, 'CL022',
  'Passage 9024003 déjà utilisé par une demande de rattachement',
  'OP-N50 : lecture déjà liée à la demande c002 : refusée');
-- 3. Écriture hors ligne (pas de fenêtre de délai) : la lecture liée à une demande reste refusée ;
--    témoin : une lecture ordinaire aussi ancienne est acceptée, le refus vient donc de la demande
--    et non du délai.
SELECT throws_ok($Q$SELECT consume_tap(9024004, '00000000-0000-0000-0000-00000024f083')$Q$, 'CL022',
  'Passage 9024004 déjà utilisé par une demande de rattachement',
  'OP-N50 : écriture hors ligne sur une lecture liée à une demande : refusée');
SELECT lives_ok($Q$SELECT consume_tap(9024005, '00000000-0000-0000-0000-00000024f084')$Q$,
  'témoin : écriture hors ligne sur une lecture ordinaire ancienne : acceptée');
-- 4. Témoin en ligne : lecture ordinaire récente acceptée, rejeu sans effet.
SELECT lives_ok($Q$SELECT consume_tap(9024002, '00000000-0000-0000-0000-00000024f081')$Q$,
  'témoin : lecture ordinaire récente : consommée par l''écriture');
SELECT is((SELECT transaction_id FROM media_tap WHERE id = 9024002), '00000000-0000-0000-0000-00000024f081'::uuid,
  'témoin : la lecture porte l''écriture');
SELECT lives_ok($Q$SELECT consume_tap(9024002, '00000000-0000-0000-0000-00000024f081')$Q$,
  'rejeu de la même écriture : sans effet');
-- 5. Comme avant : une lecture consommée par une écriture ne sert ni à une autre écriture ni à
--    une demande.
SELECT throws_ok($Q$SELECT consume_tap(9024002, '00000000-0000-0000-0000-00000024f082')$Q$, 'CL022',
  'Passage 9024002 déjà utilisé par une autre écriture', 'lecture déjà consommée par une écriture : refusée comme avant');
SELECT throws_ok($Q$SELECT consume_tap_for_claim(9024002, '00000000-0000-0000-0000-00000024c003')$Q$, 'CL022', NULL,
  'lecture consommée par une écriture : ne confirme pas la demande c003');
SELECT is((SELECT confirmed_tap_id FROM media_claim WHERE id = '00000000-0000-0000-0000-00000024c003'), NULL::bigint,
  'la demande c003 reste sans lecture');
SELECT is((SELECT count(*)::int FROM media_tap t WHERE t.id BETWEEN 9024001 AND 9024005 AND t.transaction_id IS NOT NULL
            AND EXISTS (SELECT 1 FROM media_claim c WHERE c.confirmed_tap_id = t.id)), 0,
  'aucune lecture ne porte à la fois une écriture et une demande');

-- 6. Écriture directe de la lecture d'une demande (0026) : refusée, même sur une lecture libre.
SELECT throws_ok($Q$UPDATE media_claim SET confirmed_tap_id = 9024002
                    WHERE id = '00000000-0000-0000-0000-00000024c003'$Q$, '42501', NULL,
  'cashless_app : UPDATE direct de confirmed_tap_id refusé (lecture déjà consommée par une écriture)');
SELECT throws_ok($Q$UPDATE media_claim SET confirmed_tap_id = NULL
                    WHERE id = '00000000-0000-0000-0000-00000024c001'$Q$, '42501', NULL,
  'cashless_app : effacement direct de la lecture d''une demande refusé');

-- 7. Garde OP-N50 bornée au prestataire de la lecture (0026, défense en profondeur) : une demande
--    plantée par le propriétaire chez B, qui cite la lecture 6 de A, ne consomme pas cette lecture.
RESET ROLE;
INSERT INTO media_tap (id, operator_id, media_id, counter, nfc_uid, occurred_at, device_id, mode, received_at)
VALUES (9024006, '00000000-0000-0000-0000-00000024a001', '00000000-0000-0000-0000-00000024d001', 6, '\x04240000000001',
        now(), '00000000-0000-0000-0000-00000024e001', 'ONLINE', clock_timestamp() - interval '10 minutes');
INSERT INTO party (id, kind, operator_id, legal_name) VALUES
 ('00000000-0000-0000-0000-00000024a022','CUSTOMER','00000000-0000-0000-0000-00000024a002','Festivalier B');
INSERT INTO media (id, operator_id, kind, token_hash, status) VALUES
 ('00000000-0000-0000-0000-00000024d002','00000000-0000-0000-0000-00000024a002','QR', sha256('identité 0024 B'::bytea),
  'ISSUED');
INSERT INTO device (id, operator_id, kind, serial) VALUES
 ('00000000-0000-0000-0000-00000024e002','00000000-0000-0000-0000-00000024a002','POS','TPE-0024-B');
INSERT INTO media_claim (id, operator_id, media_id, customer_id, status, confirmation_hash, expires_at,
                         confirmed_device_id, confirmed_by, confirmed_at, confirmed_tap_id)
VALUES ('00000000-0000-0000-0000-00000024c005', '00000000-0000-0000-0000-00000024a002',
        '00000000-0000-0000-0000-00000024d002', '00000000-0000-0000-0000-00000024a022', 'CONFIRMED',
        sha256('confirmation 0024 B'::bytea), now() + interval '1 day', '00000000-0000-0000-0000-00000024e002',
        '00000000-0000-0000-0000-00000024a099', now(), 9024006);
SET LOCAL ROLE cashless_app;
SELECT set_config('app.operator_id', '00000000-0000-0000-0000-00000024a001', true);
SELECT lives_ok($Q$SELECT consume_tap(9024006, '00000000-0000-0000-0000-00000024f083')$Q$,
  'OP-N50 : une demande d''un autre prestataire ne consomme pas la lecture');

-- 8. Autre prestataire : la lecture reste introuvable (le cloisonnement passe avant la garde, qui
--    ne révèle donc pas qu'une demande existe).
SELECT set_config('app.operator_id', '00000000-0000-0000-0000-00000024a002', true);
SELECT throws_ok($Q$SELECT consume_tap(9024003, '00000000-0000-0000-0000-00000024f081')$Q$, 'P0002', NULL,
  'autre prestataire : introuvable, comme avant');

SELECT * FROM finish();
ROLLBACK;
