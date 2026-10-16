-- Codes et demandes de rattachement (migration 0010, S19) — pgTAP, écrit à la main (pas un fichier généré).
-- Lancer : pg_prove -d <base> tests/tests_media_claims.sql (base créée par les migrations, roles.sql rejoué).
\set ON_ERROR_STOP 1
\set QUIET 1
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

-- Fixture (rôle propriétaire) : prestataires A et B, festivaliers, événement et grand livre, lots, bracelets.
INSERT INTO party (id, kind, legal_name, country_code) VALUES
 ('00000000-0000-0000-0000-00000010a001','OPERATOR','Prestataire A','SN'),
 ('00000000-0000-0000-0000-00000010a002','OPERATOR','Prestataire B','CI');
INSERT INTO party (id, kind, operator_id, legal_name) VALUES
 ('00000000-0000-0000-0000-00000010a011','ORGANIZER','00000000-0000-0000-0000-00000010a001','Organisateur A'),
 ('00000000-0000-0000-0000-00000010a012','ORGANIZER','00000000-0000-0000-0000-00000010a002','Organisateur B');
INSERT INTO party (id, kind, operator_id, legal_name)
SELECT ('00000000-0000-0000-0000-00000010c0' || lpad(n::text, 2, '0'))::uuid, 'CUSTOMER', '00000000-0000-0000-0000-00000010a001', 'Festivalier ' || n
  FROM generate_series(1, 12) n;
INSERT INTO party (id, kind, operator_id, legal_name) VALUES
 ('00000000-0000-0000-0000-00000010c099','CUSTOMER','00000000-0000-0000-0000-00000010a002','Festivalier de B');
INSERT INTO jurisdiction_profile (id, country_code, version, valid_from, breakage_destination) VALUES
 ('00000000-0000-0000-0000-00000010a041','SN', 100001, '2026-01-01', 'ORGANIZER');
INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone, jurisdiction_id, funds_holder) VALUES
 ('00000000-0000-0000-0000-00000010a061','00000000-0000-0000-0000-00000010a001','00000000-0000-0000-0000-00000010a011',
  'Événement A','XOF','Africa/Dakar','00000000-0000-0000-0000-00000010a041','ORGANIZER');
INSERT INTO ledger (id, operator_id, scope_type, scope_id, currency, issuer_id, funds_holder_id) VALUES
 ('00000000-0000-0000-0000-00000010a071','00000000-0000-0000-0000-00000010a001','EVENT','00000000-0000-0000-0000-00000010a061','XOF',
  '00000000-0000-0000-0000-00000010a011','00000000-0000-0000-0000-00000010a011');
INSERT INTO tag_key (operator_id, key_index, kms_key_ref) VALUES
 ('00000000-0000-0000-0000-00000010a001', 1, 'test:hmac-a'), ('00000000-0000-0000-0000-00000010a002', 1, 'test:hmac-b');
INSERT INTO media_batch (id, operator_id, organizer_id, kind, quantity, key_index, reuse_policy) VALUES
 ('00000000-0000-0000-0000-00000010b001','00000000-0000-0000-0000-00000010a001','00000000-0000-0000-0000-00000010a011','PUBLIC', 6, 1, 'SINGLE_USE'),
 ('00000000-0000-0000-0000-00000010b002','00000000-0000-0000-0000-00000010a001','00000000-0000-0000-0000-00000010a011','STAFF', 2, 1, 'SINGLE_USE'),
 ('00000000-0000-0000-0000-00000010b003','00000000-0000-0000-0000-00000010a001','00000000-0000-0000-0000-00000010a011','PUBLIC', 1, 1, 'SINGLE_USE'),
 ('00000000-0000-0000-0000-00000010b009','00000000-0000-0000-0000-00000010a002','00000000-0000-0000-0000-00000010a012','PUBLIC', 1, 1, 'SINGLE_USE');
-- Portefeuilles anonymes des bracelets 1, 2, 4, 5 ; soldes : 0, 500, 700, 900.
INSERT INTO wallet (id, operator_id, ledger_id)
SELECT ('00000000-0000-0000-0000-00000010e00' || n)::uuid, '00000000-0000-0000-0000-00000010a001', '00000000-0000-0000-0000-00000010a071'
  FROM unnest(ARRAY[1,2,4,5]) n;
-- Bracelets du lot b001 : 1 (actif, solde nul), 2 (actif, approvisionné), 3 (en stock), 4 (actif, approvisionné,
-- pour la confirmation), 5 (actif, approvisionné, pour la consultation) ; 7 : lot b003 ; 9 : prestataire B.
INSERT INTO media (id, operator_id, kind, token_hash, nfc_uid, batch_id, key_index, status, wallet_id)
SELECT ('00000000-0000-0000-0000-00000010d00' || n)::uuid, '00000000-0000-0000-0000-00000010a001', 'NFC_TAG',
       sha256(('identité 0010 ' || n)::bytea), decode('0410000000000' || n, 'hex'),
       CASE WHEN n = 7 THEN '00000000-0000-0000-0000-00000010b003' ELSE '00000000-0000-0000-0000-00000010b001' END::uuid, 1,
       CASE WHEN n IN (3, 7) THEN 'PERSONALIZED' ELSE 'ACTIVE' END,
       CASE WHEN n IN (3, 7) THEN NULL ELSE ('00000000-0000-0000-0000-00000010e00' || n)::uuid END
  FROM unnest(ARRAY[1,2,3,4,5,7]) n;
INSERT INTO media (id, operator_id, kind, token_hash, nfc_uid, batch_id, key_index, status) VALUES
 ('00000000-0000-0000-0000-00000010d009','00000000-0000-0000-0000-00000010a002','NFC_TAG', sha256('identité 0010 B'), '\x04100000000099',
  '00000000-0000-0000-0000-00000010b009', 1, 'PERSONALIZED');
INSERT INTO account (id, operator_id, ledger_id, code, family, purpose, wallet_id, normal_side)
SELECT ('00000000-0000-0000-0000-00000010f00' || n)::uuid, '00000000-0000-0000-0000-00000010a001', '00000000-0000-0000-0000-00000010a071',
       'L-WAL-0010-' || n || '-P', 'CLAIM', 'WALLET_PAID', ('00000000-0000-0000-0000-00000010e00' || n)::uuid, 'C'
  FROM unnest(ARRAY[1,2,4,5]) n;
INSERT INTO account_balance (account_id, operator_id, balance)
SELECT ('00000000-0000-0000-0000-00000010f00' || n)::uuid, '00000000-0000-0000-0000-00000010a001', b
  FROM (VALUES (1, 0), (2, -500), (4, -700), (5, -900)) v(n, b)
ON CONFLICT (account_id) DO UPDATE SET balance = EXCLUDED.balance;
-- Le rattachement (media_assignment) est posé par le déclencheur du schéma à l'insertion d'un bracelet actif.
INSERT INTO device (id, operator_id, event_id, serial) VALUES
 ('00000000-0000-0000-0000-000000100d01','00000000-0000-0000-0000-00000010a001','00000000-0000-0000-0000-00000010a061','TERM-0010');

-- Empreintes de test (32 octets) : h(n) pour les codes, k(n) pour les codes de confirmation.
CREATE FUNCTION pg_temp.h(n int) RETURNS bytea LANGUAGE sql IMMUTABLE AS $$ SELECT sha256(('code 0010 ' || n)::bytea) $$;
CREATE FUNCTION pg_temp.k(n int) RETURNS bytea LANGUAGE sql IMMUTABLE AS $$ SELECT sha256(('confirmation 0010 ' || n)::bytea) $$;
CREATE FUNCTION pg_temp.c(n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT ('00000000-0000-0000-0000-00000010c0' || lpad(n::text, 2, '0'))::uuid $$;
CREATE FUNCTION pg_temp.m(n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT ('00000000-0000-0000-0000-00000010d00' || n)::uuid $$;
CREATE FUNCTION pg_temp.q(n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT ('00000000-0000-0000-0000-0000001000' || lpad(n::text, 2, '0'))::uuid $$;
-- Résultat d'un essai de rattachement, en un mot.
CREATE FUNCTION pg_temp.claim(code int, customer int, device text, claim int DEFAULT NULL) RETURNS text LANGUAGE sql AS $$
  SELECT outcome FROM claim_media(pg_temp.h(code), pg_temp.c(customer), device,
                                  CASE WHEN claim IS NULL THEN gen_random_uuid() ELSE pg_temp.q(claim) END, pg_temp.k(coalesce(claim, 0)))
$$;

-- 1. Structure ---------------------------------------------------------------------------------------------------
SELECT has_table('claim_code');
SELECT has_table('media_claim');
SELECT has_table('claim_attempt');
SELECT has_column('media', 'claim_code_hash', 'media.claim_code_hash');
SELECT has_column('media', 'claim_code_used_at', 'media.claim_code_used_at');
SELECT has_column('media', 'claim_attempts', 'media.claim_attempts');
SELECT has_column('media_batch', 'claim_codes_issued_at', 'media_batch.claim_codes_issued_at');
SELECT is((SELECT count(*)::int FROM pg_class WHERE relname IN ('claim_code','media_claim','claim_attempt') AND relrowsecurity AND relforcerowsecurity),
  3, 'RLS activée et forcée sur les trois tables');
SELECT is((SELECT count(*)::int FROM pg_proc WHERE proname IN ('issue_claim_codes','invalidate_unassociated_codes',
  'mark_claim_code_used','claim_media','confirm_media_claim') AND NOT prosecdef), 5, 'cinq fonctions de rattachement sont SECURITY INVOKER');
SELECT is((SELECT prosecdef FROM pg_proc WHERE proname = 'associate_claim_code'), true,
  'associate_claim_code : SECURITY DEFINER depuis 0019 (tests_personalization_definer.sql)');
SELECT is((SELECT prosecdef FROM pg_proc WHERE proname = 'public_balance_lookup'), true, 'public_balance_lookup : SECURITY DEFINER (route publique, sans prestataire)');
SELECT ok(NOT has_function_privilege('public', 'public_balance_lookup(bytea, text)', 'execute'), 'public_balance_lookup : retirée à PUBLIC');
SELECT throws_ok($$INSERT INTO claim_code (operator_id, batch_id, code_hash) VALUES ('00000000-0000-0000-0000-00000010a001','00000000-0000-0000-0000-00000010b001','\x00')$$,
  '23514', NULL, 'empreinte de code : 32 octets');
SELECT throws_ok($$UPDATE media SET claim_code_used_at = now() WHERE id = '00000000-0000-0000-0000-00000010d001'$$,
  '23514', NULL, 'un code ne peut être marqué utilisé sans code');

-- Tout le reste s'exécute sous le rôle applicatif, session du prestataire A.
SET LOCAL ROLE cashless_app;
SELECT set_config('app.operator_id', '00000000-0000-0000-0000-00000010a001', true);

-- 2. Émission des codes ----------------------------------------------------------------------------------------------
SELECT throws_like($$SELECT issue_claim_codes('00000000-0000-0000-0000-00000010b001', ARRAY[pg_temp.h(1)])$$,
  '%CLAIM_CODES_COUNT%', 'un code par bracelet du lot');
SELECT throws_like($$SELECT issue_claim_codes('00000000-0000-0000-0000-00000010b002', ARRAY[pg_temp.h(91), pg_temp.h(92)])$$,
  '%CLAIM_CODES_NOT_PUBLIC%', 'pas de code pour un lot STAFF');
SELECT is(issue_claim_codes('00000000-0000-0000-0000-00000010b001', ARRAY[pg_temp.h(1), pg_temp.h(2), pg_temp.h(3), pg_temp.h(4), pg_temp.h(5), pg_temp.h(6)]),
  6, 'six empreintes enregistrées');
SELECT isnt((SELECT claim_codes_issued_at FROM media_batch WHERE id = '00000000-0000-0000-0000-00000010b001'), NULL, 'date d''émission posée');
SELECT throws_like($$SELECT issue_claim_codes('00000000-0000-0000-0000-00000010b001', ARRAY[pg_temp.h(11), pg_temp.h(12), pg_temp.h(13), pg_temp.h(14), pg_temp.h(15), pg_temp.h(16)])$$,
  '%CLAIM_CODES_ALREADY_ISSUED%', 'le fichier de commande n''est produit qu''une fois');
SELECT is(issue_claim_codes('00000000-0000-0000-0000-00000010b003', ARRAY[pg_temp.h(7)]), 1, 'code du second lot');
SELECT throws_ok($$SELECT issue_claim_codes('00000000-0000-0000-0000-00000010b009', ARRAY[pg_temp.h(99)])$$,
  'P0002', NULL, 'lot d''un autre prestataire : introuvable');

-- 3. Association ---------------------------------------------------------------------------------------------------
SELECT throws_like($$SELECT associate_claim_code(pg_temp.h(50), pg_temp.m(1))$$, '%CLAIM_CODE_UNKNOWN%', 'code inconnu');
SELECT throws_like($$SELECT associate_claim_code(pg_temp.h(7), pg_temp.m(1))$$, '%CLAIM_CODE_OTHER_BATCH%', 'code d''un autre lot');
SELECT lives_ok($$SELECT associate_claim_code(pg_temp.h(n), pg_temp.m(n)) FROM generate_series(1, 5) n$$, 'codes 1 à 5 associés aux bracelets 1 à 5');
SELECT is((SELECT claim_code_hash FROM media WHERE id = pg_temp.m(2)), pg_temp.h(2), 'le bracelet porte l''empreinte de son code');
SELECT throws_like($$SELECT associate_claim_code(pg_temp.h(1), pg_temp.m(1))$$, '%CLAIM_CODE_ALREADY_ASSOCIATED%', 'code déjà associé');
SELECT throws_like($$SELECT associate_claim_code(pg_temp.h(6), pg_temp.m(1))$$, '%MEDIA_ALREADY_HAS_CODE%', 'bracelet qui porte déjà un code');
SELECT throws_ok($$SELECT associate_claim_code(pg_temp.h(6), '00000000-0000-0000-0000-00000010d009')$$, 'P0002', NULL,
  'bracelet d''un autre prestataire : introuvable');

-- 4. Rattachement ----------------------------------------------------------------------------------------------------
SELECT is(pg_temp.claim(50, 1, 'app-1'), 'REFUSED', 'code inconnu : refus');
SELECT is(pg_temp.claim(6, 1, 'app-1'), 'REFUSED', 'code jamais associé à une puce : même refus');
SELECT is(pg_temp.claim(3, 1, 'app-1'), 'NOT_ACTIVE', 'bracelet en stock : code valide, à activer');
SELECT is((SELECT claim_code_used_at FROM media WHERE id = pg_temp.m(3)), NULL, 'le code d''un bracelet en stock n''est pas consommé');
SELECT is(pg_temp.claim(1, 1, 'app-1'), 'ATTACHED', 'solde nul : rattachement direct');
SELECT is((SELECT customer_id FROM wallet WHERE id = '00000000-0000-0000-0000-00000010e001'), pg_temp.c(1), 'portefeuille rattaché au compte');
SELECT isnt((SELECT claim_code_used_at FROM media WHERE id = pg_temp.m(1)), NULL, 'code consommé');
SELECT is(pg_temp.claim(1, 2, 'app-2'), 'REFUSED', 'code déjà utilisé : même refus qu''un code inconnu');
SELECT is((SELECT claim_attempts FROM media WHERE id = pg_temp.m(1)), 1, 'essai refusé compté sur le bracelet');
SELECT is((SELECT array_agg(outcome ORDER BY id) FROM claim_attempt WHERE customer_id = pg_temp.c(1)),
  ARRAY['REFUSED','REFUSED','NOT_ACTIVE','ATTACHED'], 'chaque essai est tracé');

-- Bracelet approvisionné : demande en attente, 3 au plus, code imprimé non consommé.
SELECT is(pg_temp.claim(2, 2, 'app-2', 1), 'PENDING', 'solde non nul : demande en attente');
SELECT is((SELECT customer_id FROM wallet WHERE id = '00000000-0000-0000-0000-00000010e002'), NULL, 'aucun rattachement sans confirmation');
SELECT is((SELECT claim_code_used_at FROM media WHERE id = pg_temp.m(2)), NULL, 'code imprimé non consommé par une demande');
SELECT ok((SELECT expires_at BETWEEN clock_timestamp() + interval '23 hours 59 minutes' AND clock_timestamp() + interval '24 hours'
             FROM media_claim WHERE id = pg_temp.q(1)), 'demande valable 24 heures');
SELECT is(pg_temp.claim(2, 3, 'app-3', 2), 'PENDING', 'deuxième demande sur le même bracelet');
SELECT is(pg_temp.claim(2, 4, 'app-4', 3), 'PENDING', 'troisième demande');
SELECT is(pg_temp.claim(2, 5, 'app-5', 4), 'REFUSED', 'quatrième demande refusée');
SELECT is((SELECT count(*)::int FROM media_claim WHERE media_id = pg_temp.m(2) AND status = 'PENDING'), 3, 'trois demandes en attente au plus');

-- Limites d'essais : 5 par compte et par heure.
SELECT is((SELECT array_agg(pg_temp.claim(50, 6, 'app-6-' || n) ORDER BY n) FROM generate_series(1, 6) n),
  ARRAY['REFUSED','REFUSED','REFUSED','REFUSED','REFUSED','BLOCKED'], 'sixième essai du même compte dans l''heure : bloqué');
SELECT is(pg_temp.claim(50, 6, 'app-6-autre'), 'BLOCKED', 'toujours bloqué, quel que soit l''appareil');
-- 20 par appareil et par jour, quel que soit le compte.
RESET ROLE;
INSERT INTO claim_attempt (operator_id, customer_id, device_ref, outcome)
SELECT '00000000-0000-0000-0000-00000010a001', pg_temp.c(12), 'appareil-partagé', 'REFUSED' FROM generate_series(1, 20);
SET LOCAL ROLE cashless_app;
SELECT is(pg_temp.claim(50, 7, 'appareil-partagé'), 'BLOCKED', 'vingt et unième essai de l''appareil dans la journée : bloqué');
SELECT is(pg_temp.claim(50, 7, 'app-7'), 'REFUSED', 'le même compte, sur un autre appareil, n''est pas bloqué');
SELECT throws_ok($$UPDATE claim_attempt SET outcome = 'REFUSED' WHERE outcome = 'BLOCKED'$$, NULL, NULL, 'les essais ne se modifient pas');
SELECT throws_ok($$SELECT pg_temp.claim(1, 99, 'app-x')$$, 'P0002', NULL, 'compte d''un autre prestataire : introuvable');

-- Code d'un bracelet en stock, consommé à l'activation par l'app.
SELECT lives_ok($$SELECT mark_claim_code_used(pg_temp.m(3))$$, 'code consommé à l''activation');
SELECT is(pg_temp.claim(3, 8, 'app-8'), 'REFUSED', 'un code consommé ne sert plus');

-- 5. Confirmation au guichet --------------------------------------------------------------------------------------------
SELECT is(confirm_media_claim(pg_temp.q(1), pg_temp.m(4), pg_temp.k(1), '00000000-0000-0000-0000-000000100d01', pg_temp.c(12)),
  'WRONG_MEDIA', 'autre bracelet que celui de la demande');
SELECT is((SELECT status FROM media_claim WHERE id = pg_temp.q(1)), 'CANCELLED', 'la demande ne peut plus être confirmée');
SELECT is(confirm_media_claim(pg_temp.q(1), pg_temp.m(2), pg_temp.k(1), '00000000-0000-0000-0000-000000100d01', pg_temp.c(12)),
  'REFUSED', 'demande annulée : refus');
SELECT is((SELECT array_agg(confirm_media_claim(pg_temp.q(2), pg_temp.m(2), pg_temp.k(99), '00000000-0000-0000-0000-000000100d01', pg_temp.c(12)) ORDER BY n)
             FROM generate_series(1, 6) n),
  ARRAY['WRONG_CODE','WRONG_CODE','WRONG_CODE','WRONG_CODE','WRONG_CODE','REFUSED'], 'cinq codes faux, puis refus');
SELECT is((SELECT status || ':' || attempts FROM media_claim WHERE id = pg_temp.q(2)), 'CANCELLED:5', 'demande annulée au cinquième code faux');
SELECT is(confirm_media_claim(pg_temp.q(2), pg_temp.m(2), pg_temp.k(2), '00000000-0000-0000-0000-000000100d01', pg_temp.c(12)),
  'REFUSED', 'le bon code arrive trop tard');
SELECT is(pg_temp.claim(2, 9, 'app-9', 5), 'PENDING', 'une place s''est libérée : nouvelle demande');
SELECT is(confirm_media_claim(pg_temp.q(3), pg_temp.m(2), pg_temp.k(3), '00000000-0000-0000-0000-000000100d01', pg_temp.c(12)),
  'CONFIRMED', 'même bracelet et bon code : confirmée');
SELECT is((SELECT customer_id FROM wallet WHERE id = '00000000-0000-0000-0000-00000010e002'), pg_temp.c(4), 'portefeuille rattaché au demandeur');
SELECT is(wallet_spendable('00000000-0000-0000-0000-00000010e002'), 500::bigint, 'aucun mouvement d''argent');
SELECT isnt((SELECT claim_code_used_at FROM media WHERE id = pg_temp.m(2)), NULL, 'code imprimé consommé');
SELECT is((SELECT confirmed_device_id::text || ' ' || confirmed_by::text FROM media_claim WHERE id = pg_temp.q(3)),
  '00000000-0000-0000-0000-000000100d01 ' || pg_temp.c(12)::text, 'terminal et agent de confirmation tracés');
SELECT is((SELECT status FROM media_claim WHERE id = pg_temp.q(5)), 'CANCELLED', 'les autres demandes du bracelet sont annulées');
SELECT is(confirm_media_claim(pg_temp.q(3), pg_temp.m(2), pg_temp.k(3), '00000000-0000-0000-0000-000000100d01', pg_temp.c(12)),
  'REFUSED', 'une demande confirmée ne se rejoue pas');
SELECT is(confirm_media_claim(gen_random_uuid(), pg_temp.m(2), pg_temp.k(3), '00000000-0000-0000-0000-000000100d01', pg_temp.c(12)),
  'REFUSED', 'demande inconnue');
-- Expiration.
SELECT is(pg_temp.claim(4, 10, 'app-10', 6), 'PENDING', 'demande sur le bracelet 4');
RESET ROLE;
UPDATE media_claim SET expires_at = clock_timestamp() - interval '1 second' WHERE id = pg_temp.q(6);
SET LOCAL ROLE cashless_app;
SELECT is(confirm_media_claim(pg_temp.q(6), pg_temp.m(4), pg_temp.k(6), '00000000-0000-0000-0000-000000100d01', pg_temp.c(12)),
  'REFUSED', 'demande expirée : refus, même avec le bon code');
SELECT is((SELECT status FROM media_claim WHERE id = pg_temp.q(6)), 'EXPIRED', 'demande marquée expirée');
SELECT is(pg_temp.claim(4, 11, 'app-11', 7), 'PENDING', 'une demande expirée ne compte plus dans la limite de trois');

-- 6. Consultation anonyme (route publique : aucun prestataire de session) ----------------------------------------------
RESET ROLE;
GRANT EXECUTE ON FUNCTION public_balance_lookup(bytea, text) TO cashless_app;   -- posé par post-roles.sql (WP06)
SET LOCAL ROLE cashless_app;
SELECT set_config('app.operator_id', '', true);
SELECT is((SELECT outcome || ' ' || currency || ' ' || spendable || ' ' || media_status FROM public_balance_lookup(pg_temp.h(5), 'adr-1')),
  'LOOKUP XOF 900 ACTIVE', 'solde lu avec le code seul, sans compte ni prestataire');
SELECT is((SELECT movements FROM public_balance_lookup(pg_temp.h(5), 'adr-1')), '[]'::jsonb, 'aucun mouvement : liste vide');
SELECT is((SELECT outcome FROM public_balance_lookup(pg_temp.h(50), 'adr-1')), 'REFUSED', 'code inconnu : refus');
SELECT is((SELECT outcome FROM public_balance_lookup(pg_temp.h(2), 'adr-1')), 'REFUSED', 'bracelet rattaché : même refus');
SELECT is((SELECT outcome FROM public_balance_lookup(pg_temp.h(3), 'adr-1')), 'REFUSED', 'code consommé : même refus');
SELECT is((SELECT outcome FROM public_balance_lookup(pg_temp.h(4), 'appareil-partagé')), 'LOOKUP',
  'les essais de rattachement d''un appareil ne comptent pas dans la limite de consultation');
SELECT throws_ok($$SELECT public_balance_lookup('\x00', 'adr-1')$$, 'CL001', NULL, 'empreinte mal formée');
-- 20 consultations par code et par heure.
SELECT is((SELECT count(*)::int FROM generate_series(1, 18) n, LATERAL public_balance_lookup(pg_temp.h(5), 'adr-code-' || n) r WHERE r.outcome = 'LOOKUP'),
  18, 'jusqu''à vingt consultations du même code dans l''heure');
SELECT is((SELECT outcome FROM public_balance_lookup(pg_temp.h(5), 'adr-code-21')), 'BLOCKED', 'vingt et unième consultation du même code : bloquée');
-- 60 par adresse et par heure, y compris pour des codes inconnus (aucun prestataire à qui les rattacher).
SELECT is((SELECT count(*)::int FROM generate_series(1, 60) n, LATERAL public_balance_lookup(pg_temp.h(1000 + n), 'adr-curieuse') r WHERE r.outcome = 'REFUSED'),
  60, 'soixante essais de codes inconnus depuis la même adresse');
SELECT is((SELECT outcome FROM public_balance_lookup(pg_temp.h(4), 'adr-curieuse')), 'BLOCKED', 'soixante et unième essai de l''adresse : bloqué, même avec un code valide');
RESET ROLE;
SELECT is((SELECT count(*)::int FROM claim_attempt WHERE operator_id IS NULL AND device_ref = 'adr-curieuse'), 60,
  'les essais de codes inconnus sont tracés sans prestataire');
SET LOCAL ROLE cashless_app;
SELECT set_config('app.operator_id', '00000000-0000-0000-0000-00000010a001', true);
SELECT is((SELECT count(*)::int FROM claim_attempt WHERE device_ref = 'adr-curieuse' AND outcome = 'REFUSED'), 0, 'un prestataire ne voit pas les essais sans prestataire');
SELECT is((SELECT count(*)::int FROM claim_attempt WHERE device_ref = 'adr-curieuse'), 1, 'il voit l''essai bloqué qui visait un de ses bracelets');

-- 7. Invalidation à la clôture ---------------------------------------------------------------------------------------------
SELECT is(invalidate_unassociated_codes('00000000-0000-0000-0000-00000010b001'), 1, 'un code jamais associé invalidé');
SELECT is(invalidate_unassociated_codes('00000000-0000-0000-0000-00000010b001'), 0, 'invalidation rejouable');
RESET ROLE;
INSERT INTO media (id, operator_id, kind, token_hash, nfc_uid, batch_id, key_index, status) VALUES
 ('00000000-0000-0000-0000-00000010d006','00000000-0000-0000-0000-00000010a001','NFC_TAG', sha256('identité 0010 6'), '\x04100000000006',
  '00000000-0000-0000-0000-00000010b001', 1, 'PERSONALIZED');
SET LOCAL ROLE cashless_app;
SELECT throws_like($$SELECT associate_claim_code(pg_temp.h(6), pg_temp.m(6))$$, '%CLAIM_CODE_INVALIDATED%', 'un code invalidé ne s''associe plus');

-- 8. Isolation -----------------------------------------------------------------------------------------------------------
SELECT set_config('app.operator_id', '00000000-0000-0000-0000-00000010a002', true);
SELECT is((SELECT count(*)::int FROM claim_code), 0, 'B ne voit aucun code de A');
SELECT is((SELECT count(*)::int FROM media_claim), 0, 'B ne voit aucune demande de A');
SELECT is((SELECT count(*)::int FROM claim_attempt), 0, 'B ne voit aucun essai de A');
SELECT is((SELECT outcome FROM claim_media(pg_temp.h(5), '00000000-0000-0000-0000-00000010c099', 'app-b', gen_random_uuid(), pg_temp.k(0))),
  'REFUSED', 'un code de A présenté chez B : refus');
SELECT is(confirm_media_claim(pg_temp.q(7), pg_temp.m(4), pg_temp.k(7), '00000000-0000-0000-0000-000000100d01', pg_temp.c(12)),
  'REFUSED', 'une demande de A ne se confirme pas chez B');
SELECT throws_ok($$SELECT mark_claim_code_used(pg_temp.m(5))$$, 'P0002', NULL, 'bracelet de A : introuvable chez B');
SELECT throws_ok($$SELECT invalidate_unassociated_codes('00000000-0000-0000-0000-00000010b003')$$, 'P0002', NULL, 'lot de A : introuvable chez B');
SELECT set_config('app.operator_id', '', true);
SELECT throws_ok($$SELECT claim_media(pg_temp.h(5), pg_temp.c(1), 'app', gen_random_uuid(), pg_temp.k(0))$$, 'P0002', NULL, 'rattachement sans prestataire de session : introuvable');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
