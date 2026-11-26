-- Classement des anomalies, modèles de téléphone, modèle du terminal (migration 0101, post-roles.sql §15) — pgTAP,
-- écrit à la main. Mission 11b routes-backoffice, lot WP01 (research D1, D4, D9 ; interfaces.md §2).
-- Lancer : pg_prove -d <base> tests/tests_backoffice_writes.sql (base créée par les migrations, roles.sql et
-- post-roles.sql rejoués). Tous les comptages portent sur les objets du test, jamais sur toute la base.
\set ON_ERROR_STOP 1
\set QUIET 1
BEGIN;
\ir _grants_for_tests.sql
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

-- Prestataires A (b001) et B (b002), personne de A, grand livre de A, une anomalie par type et une écriture.
INSERT INTO party (id, kind, legal_name, country_code) VALUES
 ('00000000-0000-0000-0000-0000101ba001','OPERATOR','Prestataire A','SN'),
 ('00000000-0000-0000-0000-0000101ba002','OPERATOR','Prestataire B','CI');
INSERT INTO party (id, kind, operator_id, legal_name, country_code) VALUES
 ('00000000-0000-0000-0000-0000101ba011','ORGANIZER','00000000-0000-0000-0000-0000101ba001','Organisateur A','SN');
INSERT INTO app_user (id, operator_id, issuer, subject, email, display_name) VALUES
 ('00000000-0000-0000-0000-0000101bb001','00000000-0000-0000-0000-0000101ba001','iss','u1','a@x.test','Admin A');
INSERT INTO ledger (id, operator_id, scope_type, scope_id, currency, issuer_id, funds_holder_id) VALUES
 ('00000000-0000-0000-0000-0000101bc001','00000000-0000-0000-0000-0000101ba001','EVENT', gen_random_uuid(),'XOF',
  '00000000-0000-0000-0000-0000101ba011','00000000-0000-0000-0000-0000101ba011');

-- Une anomalie ouverte de chacun des 23 types du schéma (CASH_TOPUP_OVER_LIMIT et PSP_TOPUP_NOT_CREDITED exigent un
-- bracelet / un montant : on les crée par leurs contraintes propres plus bas ; ici les 21 autres, montant 0).
CREATE TEMP TABLE kinds AS
SELECT k, gen_random_uuid() AS id FROM unnest(ARRAY[
  'CASH_DIFF','CLOCK_SKEW','CARD_VELOCITY','IDEMPOTENCY_CONFLICT','CHAIN_BROKEN','COUNTER_DUPLICATE',
  'COUNTER_TIME_INVERSION','UID_MISMATCH','RETIRED_IDENTITY','SIGNATURE_MISMATCH',
  'OFFLINE_SHORTFALL','SEQ_GAP','VOID_CONFLICT','ONLINE_CONFIRMED_MISSING','NON_COMPLIANT_OPERATION',
  'PERIOD_CLOSED_OPERATION','LATE_OFFLINE_SYNC','PSP_MISMATCH','PSP_TOPUP_OVER_LIMIT','EDGE_REPLAY_FAILED',
  'LATE_CHARGEBACK']) AS k;
GRANT SELECT ON kinds TO cashless_app, cashless_platform;
INSERT INTO anomaly (id, operator_id, ledger_id, kind, amount)
SELECT id, '00000000-0000-0000-0000-0000101ba001', '00000000-0000-0000-0000-0000101bc001', k, 0 FROM kinds;
INSERT INTO anomaly (id, operator_id, ledger_id, kind, amount) VALUES
 ('00000000-0000-0000-0000-0000101bd001','00000000-0000-0000-0000-0000101ba001','00000000-0000-0000-0000-0000101bc001',
  'PSP_TOPUP_NOT_CREDITED', 500),
 ('00000000-0000-0000-0000-0000101bd002','00000000-0000-0000-0000-0000101ba002', NULL, 'UID_MISMATCH', 0);
-- Anomalie sans grand livre (signal de sécurité d'un bracelet sans portefeuille) chez A.
INSERT INTO anomaly (id, operator_id, ledger_id, kind, amount) VALUES
 ('00000000-0000-0000-0000-0000101bd003','00000000-0000-0000-0000-0000101ba001', NULL, 'RETIRED_IDENTITY', 0);

CREATE FUNCTION pg_temp.as_a() RETURNS void LANGUAGE sql AS
  $$ SELECT set_config('app.operator_id', '00000000-0000-0000-0000-0000101ba001', true) $$;
CREATE FUNCTION pg_temp.as_b() RETURNS void LANGUAGE sql AS
  $$ SELECT set_config('app.operator_id', '00000000-0000-0000-0000-0000101ba002', true) $$;
CREATE FUNCTION pg_temp.jt() RETURNS int LANGUAGE sql AS
  $$ SELECT count(*)::int FROM journal_transaction WHERE operator_id = '00000000-0000-0000-0000-0000101ba001' $$;

-- 1. Liste fermée --------------------------------------------------------------------------------------------
SELECT is((SELECT string_agg(k, ',' ORDER BY k) FROM kinds WHERE anomaly_classifiable(k)),
  'CARD_VELOCITY,CASH_DIFF,CHAIN_BROKEN,CLOCK_SKEW,COUNTER_DUPLICATE,COUNTER_TIME_INVERSION,IDEMPOTENCY_CONFLICT,'
  'RETIRED_IDENTITY,SIGNATURE_MISMATCH,UID_MISMATCH', 'anomaly_classifiable : les 10 types de D1');
SELECT is((SELECT count(*)::int FROM kinds WHERE NOT anomaly_classifiable(k)), 11,
  'anomaly_classifiable : 11 des 21 types créés ici refusés (13 au total avec les deux types à contrainte propre)');
SELECT ok(NOT anomaly_classifiable('PSP_TOPUP_NOT_CREDITED') AND NOT anomaly_classifiable('CASH_TOPUP_OVER_LIMIT')
          AND NOT anomaly_classifiable(NULL), 'anomaly_classifiable : types d''argent et NULL refusés');

-- 2. Classement nominal : trois colonnes, statut, aucune écriture au grand livre ---------------------------------
SELECT pg_temp.as_a();
CREATE TEMP TABLE before_jt AS SELECT pg_temp.jt() AS n;
SELECT is((SELECT status || '|' || (classified_by = '00000000-0000-0000-0000-0000101bb001')::text
                  || '|' || (classified_at IS NOT NULL)::text || '|' || classification_reason
             FROM classify_anomaly((SELECT id FROM kinds WHERE k = 'CASH_DIFF'), '  écart expliqué  ',
                                   '00000000-0000-0000-0000-0000101bb001')),
  'RESOLVED|true|true|écart expliqué', 'classify_anomaly : statut, auteur, date, motif (rogné)');
SELECT is((SELECT resolution_tx_id FROM anomaly WHERE id = (SELECT id FROM kinds WHERE k = 'CASH_DIFF')), NULL,
  'classify_anomaly : resolution_tx_id jamais écrit');
SELECT is(pg_temp.jt(), (SELECT n FROM before_jt), 'classify_anomaly : aucune journal_transaction du prestataire créée');
SELECT is((SELECT count(*)::int FROM posting p JOIN journal_transaction t ON t.id = p.transaction_id
            WHERE t.operator_id = '00000000-0000-0000-0000-0000101ba001'), 0,
  'classify_anomaly : aucun posting du prestataire');
-- Anomalie sans grand livre : classable (la portée est affaire de l'API).
SELECT lives_ok($$SELECT classify_anomaly('00000000-0000-0000-0000-0000101bd003', 'sans grand livre',
                  '00000000-0000-0000-0000-0000101bb001')$$, 'classify_anomaly : anomalie sans grand livre classable');

-- 3. Codes ---------------------------------------------------------------------------------------------------
SELECT throws_ok($$SELECT classify_anomaly('00000000-0000-0000-0000-0000101bd002', 'x',
                   '00000000-0000-0000-0000-0000101bb001')$$, 'CL066', NULL,
  'CL066 : anomalie d''un autre prestataire (isolement)');
SELECT is((SELECT status FROM anomaly WHERE id = '00000000-0000-0000-0000-0000101bd002'), 'OPEN',
  'isolement : l''anomalie de B reste ouverte');
SELECT throws_ok($$SELECT classify_anomaly(gen_random_uuid(), 'x', '00000000-0000-0000-0000-0000101bb001')$$,
  'CL066', NULL, 'CL066 : anomalie inconnue');
SELECT set_config('app.operator_id', '', true);
SELECT throws_ok($$SELECT classify_anomaly('00000000-0000-0000-0000-0000101bd003', 'x',
                   '00000000-0000-0000-0000-0000101bb001')$$, 'CL066', NULL, 'CL066 : sans prestataire de session');
SELECT pg_temp.as_a();
SELECT throws_ok($$SELECT classify_anomaly('00000000-0000-0000-0000-0000101bd001', 'x',
                   '00000000-0000-0000-0000-0000101bb001')$$, 'CL067', NULL, 'CL067 : PSP_TOPUP_NOT_CREDITED');
SELECT throws_ok(format($q$SELECT classify_anomaly(%L, 'x', '00000000-0000-0000-0000-0000101bb001')$q$,
                        (SELECT id FROM kinds WHERE k = 'CASH_DIFF')), 'CL068', NULL,
  'CL068 : double classement (même anomalie)');
SELECT throws_ok(format($q$SELECT classify_anomaly(%L, '   ', '00000000-0000-0000-0000-0000101bb001')$q$,
                        (SELECT id FROM kinds WHERE k = 'CLOCK_SKEW')), 'CL069', NULL, 'CL069 : motif vide');
SELECT throws_ok(format($q$SELECT classify_anomaly(%L, repeat('a', 501), '00000000-0000-0000-0000-0000101bb001')$q$,
                        (SELECT id FROM kinds WHERE k = 'CLOCK_SKEW')), 'CL069', NULL, 'CL069 : motif de 501 caractères');
SELECT throws_ok(format($q$SELECT classify_anomaly(%L, NULL, '00000000-0000-0000-0000-0000101bb001')$q$,
                        (SELECT id FROM kinds WHERE k = 'CLOCK_SKEW')), 'CL069', NULL, 'CL069 : motif NULL');
SELECT lives_ok(format($q$SELECT classify_anomaly(%L, repeat('a', 500), '00000000-0000-0000-0000-0000101bb001')$q$,
                       (SELECT id FROM kinds WHERE k = 'CLOCK_SKEW')), 'motif de 500 caractères accepté');
-- Les 11 autres types créés ici (et les deux types à contrainte propre) : CL067, statut inchangé.
DO $$
DECLARE r record; ok int := 0; wrong int := 0;
BEGIN
  FOR r IN SELECT k, id FROM kinds WHERE NOT anomaly_classifiable(k) LOOP
    BEGIN
      PERFORM classify_anomaly(r.id, 'x', '00000000-0000-0000-0000-0000101bb001');
      wrong := wrong + 1;
    EXCEPTION WHEN SQLSTATE 'CL067' THEN ok := ok + 1;
    END;
  END LOOP;
  CREATE TEMP TABLE IF NOT EXISTS loop_result (ok int, wrong int);
  INSERT INTO loop_result VALUES (ok, wrong);
END $$;
SELECT is((SELECT ok FROM loop_result), 11, 'CL067 : chacun des 11 autres types créés ici refusé');
SELECT is((SELECT wrong FROM loop_result), 0, 'aucun type non classable classé par la fonction');
SELECT is((SELECT count(*)::int FROM anomaly WHERE id IN (SELECT id FROM kinds WHERE NOT anomaly_classifiable(k))
            AND (status <> 'OPEN' OR classified_by IS NOT NULL)), 0, 'types non classables : tous restés OPEN, non classés');

-- 4. Contraintes de la table, par le propriétaire (la liste D1 est tenue par la base) -------------------------------
SELECT throws_ok($$UPDATE anomaly SET status = 'RESOLVED', classified_by = '00000000-0000-0000-0000-0000101bb001',
                     classified_at = now(), classification_reason = 'x'
                   WHERE id = '00000000-0000-0000-0000-0000101bd001'$$, '23514', NULL,
  'CHECK : type non classable avec classified_by refusé même par le propriétaire');
SELECT throws_ok($$UPDATE anomaly SET classified_by = '00000000-0000-0000-0000-0000101bb001'
                   WHERE id = '00000000-0000-0000-0000-0000101bd002'$$, '23514', NULL,
  'CHECK : les trois colonnes vont ensemble');
SELECT throws_ok(format($q$UPDATE anomaly SET classification_reason = repeat('a', 501) WHERE id = %L$q$,
                        (SELECT id FROM kinds WHERE k = 'CASH_DIFF')), '23514', NULL, 'CHECK : motif > 500 refusé');

-- 5. Droits (D4 et fonctions) ------------------------------------------------------------------------------------
SELECT ok(NOT has_column_privilege('cashless_app', 'anomaly', 'status', 'UPDATE'),
  'D4 : cashless_app n''a plus UPDATE (status)');
SELECT ok(NOT has_column_privilege('cashless_app', 'anomaly', 'resolution_tx_id', 'UPDATE'),
  'D4 : cashless_app n''a plus UPDATE (resolution_tx_id)');
SELECT ok(NOT has_column_privilege('cashless_app', 'anomaly', 'classified_by', 'UPDATE')
          AND NOT has_column_privilege('cashless_app', 'anomaly', 'classification_reason', 'UPDATE'),
  'cashless_app : aucun UPDATE sur les colonnes de classement');
SELECT ok(has_table_privilege('cashless_app', 'anomaly', 'INSERT'), 'statu quo : INSERT direct sur anomaly conservé');
SELECT ok(has_function_privilege('cashless_app', 'classify_anomaly(uuid,text,uuid)', 'EXECUTE'),
  'classify_anomaly : EXECUTE à cashless_app');
SELECT ok(NOT has_function_privilege('public', 'classify_anomaly(uuid,text,uuid)', 'EXECUTE')
          AND NOT has_function_privilege('cashless_platform', 'classify_anomaly(uuid,text,uuid)', 'EXECUTE'),
  'classify_anomaly : ni PUBLIC ni cashless_platform');
SELECT ok(has_function_privilege('cashless_app', 'set_device_model(uuid,text,text)', 'EXECUTE')
          AND NOT has_function_privilege('public', 'set_device_model(uuid,text,text)', 'EXECUTE'),
  'set_device_model : cashless_app seul');
SELECT is((SELECT prosecdef AND proconfig = ARRAY['search_path=public, pg_temp'] FROM pg_proc
            WHERE proname = 'classify_anomaly'), true, 'classify_anomaly : DEFINER, search_path public, pg_temp');
SELECT ok((SELECT prosrc FROM pg_proc WHERE proname = 'classify_anomaly') ~ 'FOR UPDATE',
  'classify_anomaly : SELECT … FOR UPDATE (deux sessions : voir la note de lane, preuve à deux connexions)');
-- Le propriétaire de la fonction ne dépend pas du rôle appelant : cashless_app classe sans droit de table.
SELECT pg_temp.as_a();
SET LOCAL ROLE cashless_app;
SELECT lives_ok(format($q$SELECT classify_anomaly(%L, 'par cashless_app', '00000000-0000-0000-0000-0000101bb001')$q$,
                       (SELECT id FROM kinds WHERE k = 'COUNTER_DUPLICATE')), 'cashless_app classe par la fonction');
SELECT throws_ok(format($q$UPDATE anomaly SET status = 'RESOLVED' WHERE id = %L$q$,
                        (SELECT id FROM kinds WHERE k = 'CHAIN_BROKEN')), '42501', NULL,
  'cashless_app : UPDATE anomaly SET status refusé en direct');
SELECT throws_ok($$SELECT upsert_phone_model('samsung', 'x', 'RECOMMENDED', current_date,
                   '00000000-0000-0000-0000-0000101bb001')$$, '42501', NULL, 'cashless_app : upsert_phone_model refusé');
SELECT throws_ok($$SELECT delete_phone_model('samsung', 'x', '00000000-0000-0000-0000-0000101bb001')$$, '42501', NULL,
  'cashless_app : delete_phone_model refusé');
SELECT throws_ok($$INSERT INTO phone_model VALUES ('a','b','TOLERATED', current_date,
                   '00000000-0000-0000-0000-0000101bb001', now())$$, '42501', NULL, 'cashless_app : INSERT phone_model refusé');
SELECT throws_ok($$UPDATE phone_model SET nfc_level = 'TOLERATED'$$, '42501', NULL, 'cashless_app : UPDATE phone_model refusé');
SELECT throws_ok($$DELETE FROM phone_model$$, '42501', NULL, 'cashless_app : DELETE phone_model refusé');
SELECT lives_ok($$SELECT count(*) FROM phone_model$$, 'cashless_app : SELECT phone_model permis');
RESET ROLE;

-- 6. Modèles de téléphone (rôle de plateforme) ------------------------------------------------------------------
SELECT is(normalize_phone_model('  Samsung   Galaxy  A14 '), 'samsung galaxy a14', 'normalisation : casse, bords, espaces');
SELECT is(normalize_phone_model(NULL), NULL, 'normalisation : NULL reste NULL');
SELECT ok(has_function_privilege('cashless_platform', 'upsert_phone_model(text,text,text,date,uuid)', 'EXECUTE')
          AND has_function_privilege('cashless_platform', 'delete_phone_model(text,text,uuid)', 'EXECUTE')
          AND NOT has_function_privilege('public', 'upsert_phone_model(text,text,text,date,uuid)', 'EXECUTE'),
  'upsert/delete : EXECUTE au rôle de plateforme seul');
SELECT ok(NOT has_table_privilege('cashless_platform', 'phone_model', 'SELECT')
          AND NOT has_table_privilege('cashless_platform', 'phone_model', 'INSERT'),
  'cashless_platform : aucun droit direct sur la table');
SET LOCAL ROLE cashless_platform;
SELECT is((SELECT manufacturer || '/' || model || '/' || nfc_level FROM upsert_phone_model(
            ' Samsung ', 'Galaxy  A14', 'TOLERATED', '2026-11-01', '00000000-0000-0000-0000-0000101bb001')),
  'samsung/galaxy a14/TOLERATED', 'upsert_phone_model : entrée normalisée');
SELECT is((SELECT nfc_level FROM upsert_phone_model('samsung', 'galaxy a14', 'RECOMMENDED', '2026-11-02',
            '00000000-0000-0000-0000-0000101bb001')), 'RECOMMENDED', 'upsert_phone_model : idempotent, niveau mis à jour');
RESET ROLE;
SELECT is((SELECT count(*)::int FROM phone_model WHERE manufacturer = 'samsung' AND model = 'galaxy a14'), 1,
  'upsert_phone_model : une seule ligne pour la clé');
SELECT throws_ok($$SELECT upsert_phone_model('samsung', 'x', 'BAD', current_date, '00000000-0000-0000-0000-0000101bb001')$$,
  'CL001', NULL, 'upsert_phone_model : niveau inconnu refusé');
SELECT throws_ok($$SELECT upsert_phone_model('  ', 'x', 'TOLERATED', current_date, '00000000-0000-0000-0000-0000101bb001')$$,
  'CL001', NULL, 'upsert_phone_model : fabricant vide refusé');
SELECT throws_ok($$SELECT upsert_phone_model('s', repeat('m', 101), 'TOLERATED', current_date,
                   '00000000-0000-0000-0000-0000101bb001')$$, 'CL001', NULL, 'upsert_phone_model : modèle > 100 refusé');
SELECT throws_ok($$INSERT INTO phone_model VALUES ('Samsung','x','TOLERATED', current_date,
                   '00000000-0000-0000-0000-0000101bb001', now())$$, '23514', NULL,
  'CHECK : une clé non normalisée est refusée même par le propriétaire');
SELECT is(delete_phone_model('SAMSUNG', ' galaxy a14 ', '00000000-0000-0000-0000-0000101bb001'), true,
  'delete_phone_model : vrai quand présent (entrée normalisée)');
SELECT is(delete_phone_model('samsung', 'galaxy a14', '00000000-0000-0000-0000-0000101bb001'), false,
  'delete_phone_model : faux quand absent');

-- 7. Colonnes du terminal et set_device_model ------------------------------------------------------------------
INSERT INTO device (id, operator_id, serial) VALUES
 ('00000000-0000-0000-0000-0000101be001','00000000-0000-0000-0000-0000101ba001','TPE-101-A'),
 ('00000000-0000-0000-0000-0000101be002','00000000-0000-0000-0000-0000101ba002','TPE-101-B');
SELECT ok(NOT has_column_privilege('cashless_app', 'device', 'model', 'UPDATE')
          AND NOT has_column_privilege('cashless_app', 'device', 'manufacturer', 'UPDATE'),
  'device : aucun UPDATE de colonne sur manufacturer ni model pour cashless_app');
SELECT pg_temp.as_a();
SET LOCAL ROLE cashless_app;
SELECT lives_ok($$SELECT set_device_model('00000000-0000-0000-0000-0000101be001', ' Samsung ', 'SM-A145F')$$,
  'set_device_model : avec modèle');
RESET ROLE;
SELECT is((SELECT manufacturer || '/' || model FROM device WHERE id = '00000000-0000-0000-0000-0000101be001'),
  'samsung/sm-a145f', 'device : valeurs normalisées écrites');
SELECT lives_ok($$SELECT set_device_model('00000000-0000-0000-0000-0000101be001', NULL, NULL)$$,
  'set_device_model : sans modèle (signal de vie sans déclaration)');
SELECT is((SELECT manufacturer || '/' || model FROM device WHERE id = '00000000-0000-0000-0000-0000101be001'),
  'samsung/sm-a145f', 'device : une valeur absente n''efface pas la valeur connue');
SELECT lives_ok($$SELECT set_device_model('00000000-0000-0000-0000-0000101be001', NULL, 'SM-A146')$$,
  'set_device_model : un seul des deux champs');
SELECT is((SELECT manufacturer || '/' || model FROM device WHERE id = '00000000-0000-0000-0000-0000101be001'),
  'samsung/sm-a146', 'device : seul le champ fourni change');
SELECT throws_ok($$SELECT set_device_model('00000000-0000-0000-0000-0000101be002', 'x', 'y')$$, 'P0002', NULL,
  'set_device_model : terminal d''un autre prestataire introuvable');
SELECT is((SELECT model FROM device WHERE id = '00000000-0000-0000-0000-0000101be002'), NULL,
  'isolement : le terminal de B est inchangé');
SELECT throws_ok($$SELECT set_device_model('00000000-0000-0000-0000-0000101be001', repeat('a', 101), 'y')$$, 'CL001', NULL,
  'set_device_model : fabricant > 100 refusé');
SELECT throws_ok($$UPDATE device SET model = 'Mixed Case' WHERE id = '00000000-0000-0000-0000-0000101be001'$$, '23514', NULL,
  'CHECK : modèle non normalisé refusé par la table');
UPDATE device SET status = 'REVOKED' WHERE id = '00000000-0000-0000-0000-0000101be001';
SELECT throws_ok($$SELECT set_device_model('00000000-0000-0000-0000-0000101be001', 'a', 'b')$$, '42501', NULL,
  'set_device_model : terminal révoqué refusé');
SELECT set_config('app.operator_id', '', true);
SELECT throws_ok($$SELECT set_device_model('00000000-0000-0000-0000-0000101be001', 'a', 'b')$$, 'P0002', NULL,
  'set_device_model : sans prestataire de session refusé');

-- 8. Index de débit ---------------------------------------------------------------------------------------------
SELECT is((SELECT count(*)::int FROM pg_indexes WHERE tablename = 'audit_log'
            AND indexdef LIKE '%(actor_id, action, occurred_at)%'), 1, 'audit_log : index (actor_id, action, occurred_at)');

SELECT * FROM finish();
ROLLBACK;
