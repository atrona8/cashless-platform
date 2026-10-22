-- search_path des fonctions SECURITY DEFINER (migration 0021) — pgTAP, écrit à la main. Mission
-- identite-enrolement-terminaux, lot WP02 (OP-N59, ADR-96 ; FR-020, NFR-010 ; research R-11).
-- Ce fichier prouve que :
--   1. une table temporaire de l'appelant, de même nom qu'une table de la base, ne change pas le prestataire rendu par
--      chaque tenant_of_* : la fonction lit la table de la base (search_path = public, pg_temp, pg_temp en dernier).
--      Un témoin aux réglages d'avant 0021 (search_path = public) lit, lui, la table temporaire : les tables
--      temporaires de la suite masquent bien les tables de la base, le test n'est pas vide. L'appelant est un rôle de
--      test de la suite, pas un rôle cashless_* (WP07 leur retire TEMPORARY) ;
--   2. aucune fonction SECURITY DEFINER du schéma public (hors extensions) n'a un search_path qui ne finit pas par
--      pg_temp ; trois témoins créés dans la transaction (search_path = public, pg_temp en premier, aucun search_path)
--      sont détectés : une fonction future qui oublie pg_temp (ou un CREATE OR REPLACE qui efface le réglage) fait
--      échouer la suite.
-- Lancer : pg_prove -d <base> tests/tests_definer_search_path.sql (base créée par les migrations, roles.sql et
-- post-roles.sql rejoués : le contrôle du catalogue porte sur l'état final).
\set ON_ERROR_STOP 1
\set QUIET 1
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

-- Prestataires A (a001) et B (a002), organisateur de A ; chez A : grand livre, portefeuille, clé, lot, bracelet,
-- événement, terminal et passerelle. Chaque tenant_of_* doit rendre A pour l'objet de A.
INSERT INTO party (id, kind, legal_name, country_code) VALUES
 ('00000000-0000-0000-0000-00000021a001','OPERATOR','Prestataire A','SN'),
 ('00000000-0000-0000-0000-00000021a002','OPERATOR','Prestataire B','CI');
INSERT INTO party (id, kind, operator_id, legal_name, country_code) VALUES
 ('00000000-0000-0000-0000-00000021a011','ORGANIZER','00000000-0000-0000-0000-00000021a001','Organisateur A','SN');
INSERT INTO ledger (id, operator_id, scope_type, scope_id, currency, issuer_id, funds_holder_id) VALUES
 ('00000000-0000-0000-0000-00000021b001','00000000-0000-0000-0000-00000021a001','EVENT', gen_random_uuid(),'XOF',
  '00000000-0000-0000-0000-00000021a011','00000000-0000-0000-0000-00000021a011');
INSERT INTO wallet (id, operator_id, ledger_id) VALUES
 ('00000000-0000-0000-0000-00000021c001','00000000-0000-0000-0000-00000021a001','00000000-0000-0000-0000-00000021b001');
INSERT INTO tag_key (operator_id, key_index, kms_key_ref, status) VALUES
 ('00000000-0000-0000-0000-00000021a001', 1, 'test:hmac-21', 'ACTIVE');
INSERT INTO media_batch (id, operator_id, organizer_id, kind, quantity, key_index) VALUES
 ('00000000-0000-0000-0000-000000219001','00000000-0000-0000-0000-00000021a001','00000000-0000-0000-0000-00000021a011',
  'PUBLIC', 5, 1);
INSERT INTO media (id, operator_id, kind, token_hash, nfc_uid, batch_id, key_index, status) VALUES
 ('00000000-0000-0000-0000-00000021d001','00000000-0000-0000-0000-00000021a001','NFC_TAG', sha256('identité 0021'),
  '\x04210000000001','00000000-0000-0000-0000-000000219001', 1, 'PERSONALIZED');
INSERT INTO jurisdiction_profile (id, country_code, version, valid_from, breakage_destination)
VALUES ('00000000-0000-0000-0000-00000021f001','SN', 210021, '2026-01-01', 'ORGANIZER');
INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone, jurisdiction_id, funds_holder) VALUES
 ('00000000-0000-0000-0000-00000021e001','00000000-0000-0000-0000-00000021a001','00000000-0000-0000-0000-00000021a011',
  'Événement A','XOF','Africa/Dakar','00000000-0000-0000-0000-00000021f001','ORGANIZER');
INSERT INTO device (id, operator_id, kind, event_id, serial) VALUES
 ('00000000-0000-0000-0000-000000218001','00000000-0000-0000-0000-00000021a001','POS',
  '00000000-0000-0000-0000-00000021e001','TPE-0021-A');
INSERT INTO edge_gateway (id, operator_id, event_id, serial, role) VALUES
 ('00000000-0000-0000-0000-000000217001','00000000-0000-0000-0000-00000021a001','00000000-0000-0000-0000-00000021e001',
  'GW-0021-A','PRIMARY');

-- Les tenant_of_* couverts ci-dessous : liste exacte (une nouvelle fonction impose d'ajouter son cas à la suite).
SELECT is((SELECT string_agg(proname, ' ' ORDER BY proname) FROM pg_proc
            WHERE pronamespace = 'public'::regnamespace AND proname LIKE 'tenant\_of\_%'),
  'tenant_of_batch tenant_of_device tenant_of_event tenant_of_gateway tenant_of_ledger tenant_of_media tenant_of_wallet',
  'tenant_of_* : liste exacte des fonctions couvertes par la suite');

-- Rôle de test de la suite (annulé avec la transaction) : peut créer une table temporaire et appeler les tenant_of_*.
-- Droits accordés explicitement : la suite ne dépend pas de ce qu'hérite PUBLIC (WP07 retire TEMPORARY à PUBLIC).
CREATE ROLE ledger_test_definer_search_path NOLOGIN;
GRANT USAGE ON SCHEMA public TO ledger_test_definer_search_path;
DO $$ BEGIN
  EXECUTE format('GRANT TEMPORARY ON DATABASE %I TO ledger_test_definer_search_path', current_database());
END $$;
GRANT EXECUTE ON FUNCTION tenant_of_ledger(uuid), tenant_of_media(uuid), tenant_of_wallet(uuid), tenant_of_batch(uuid),
  tenant_of_event(uuid), tenant_of_device(uuid), tenant_of_gateway(uuid) TO ledger_test_definer_search_path;

-- 1. Tables temporaires de l'appelant ------------------------------------------------------------------------------------
-- Créées avant le premier appel explicite des fonctions dans cette suite. Chacune porte, pour l'objet de A, une ligne
-- qui le donne à B : une fonction qui la lirait rendrait B.
SET LOCAL ROLE ledger_test_definer_search_path;
CREATE TEMP TABLE ledger (id uuid, operator_id uuid);
CREATE TEMP TABLE media (id uuid, operator_id uuid);
CREATE TEMP TABLE wallet (id uuid, operator_id uuid);
CREATE TEMP TABLE media_batch (id uuid, operator_id uuid);
CREATE TEMP TABLE event (id uuid, operator_id uuid);
CREATE TEMP TABLE device (id uuid, operator_id uuid);
CREATE TEMP TABLE edge_gateway (id uuid, operator_id uuid);
INSERT INTO pg_temp.ledger VALUES ('00000000-0000-0000-0000-00000021b001','00000000-0000-0000-0000-00000021a002');
INSERT INTO pg_temp.media VALUES ('00000000-0000-0000-0000-00000021d001','00000000-0000-0000-0000-00000021a002');
INSERT INTO pg_temp.wallet VALUES ('00000000-0000-0000-0000-00000021c001','00000000-0000-0000-0000-00000021a002');
INSERT INTO pg_temp.media_batch VALUES ('00000000-0000-0000-0000-000000219001','00000000-0000-0000-0000-00000021a002');
INSERT INTO pg_temp.event VALUES ('00000000-0000-0000-0000-00000021e001','00000000-0000-0000-0000-00000021a002');
INSERT INTO pg_temp.device VALUES ('00000000-0000-0000-0000-000000218001','00000000-0000-0000-0000-00000021a002');
INSERT INTO pg_temp.edge_gateway VALUES ('00000000-0000-0000-0000-000000217001','00000000-0000-0000-0000-00000021a002');

-- Témoin : mêmes réglages que les tenant_of_* avant 0021 (search_path = public, sans pg_temp). Il lit la table
-- temporaire, donc les tables ci-dessus masquent bien les tables de la base.
CREATE FUNCTION pg_temp.temoin_avant_0021(p uuid) RETURNS uuid LANGUAGE sql STABLE SET search_path = public AS
  $$ SELECT operator_id FROM ledger WHERE id = p $$;
SELECT is(pg_temp.temoin_avant_0021('00000000-0000-0000-0000-00000021b001'), '00000000-0000-0000-0000-00000021a002'::uuid,
  'témoin search_path = public : la table temporaire de l''appelant masque ledger (faille OP-N59 reproduite)');

SELECT is(tenant_of_ledger('00000000-0000-0000-0000-00000021b001'), '00000000-0000-0000-0000-00000021a001'::uuid,
  'tenant_of_ledger : table temporaire ledger de l''appelant ignorée, prestataire réel rendu');
SELECT is(tenant_of_media('00000000-0000-0000-0000-00000021d001'), '00000000-0000-0000-0000-00000021a001'::uuid,
  'tenant_of_media : table temporaire media de l''appelant ignorée, prestataire réel rendu');
SELECT is(tenant_of_wallet('00000000-0000-0000-0000-00000021c001'), '00000000-0000-0000-0000-00000021a001'::uuid,
  'tenant_of_wallet : table temporaire wallet de l''appelant ignorée, prestataire réel rendu');
SELECT is(tenant_of_batch('00000000-0000-0000-0000-000000219001'), '00000000-0000-0000-0000-00000021a001'::uuid,
  'tenant_of_batch : table temporaire media_batch de l''appelant ignorée, prestataire réel rendu');
SELECT is(tenant_of_event('00000000-0000-0000-0000-00000021e001'), '00000000-0000-0000-0000-00000021a001'::uuid,
  'tenant_of_event : table temporaire event de l''appelant ignorée, prestataire réel rendu');
SELECT is(tenant_of_device('00000000-0000-0000-0000-000000218001'), '00000000-0000-0000-0000-00000021a001'::uuid,
  'tenant_of_device : table temporaire device de l''appelant ignorée, prestataire réel rendu');
SELECT is(tenant_of_gateway('00000000-0000-0000-0000-000000217001'), '00000000-0000-0000-0000-00000021a001'::uuid,
  'tenant_of_gateway : table temporaire edge_gateway de l''appelant ignorée, prestataire réel rendu');
-- Objet absent de la base mais présent dans la table temporaire : rien (et non le prestataire de la table temporaire).
INSERT INTO pg_temp.ledger VALUES ('00000000-0000-0000-0000-00000021b0ff','00000000-0000-0000-0000-00000021a002');
SELECT is(tenant_of_ledger('00000000-0000-0000-0000-00000021b0ff'), NULL::uuid,
  'tenant_of_ledger : un grand livre qui n''existe que dans la table temporaire n''a pas de prestataire');
RESET ROLE;
DROP TABLE pg_temp.ledger, pg_temp.media, pg_temp.wallet, pg_temp.media_batch, pg_temp.event, pg_temp.device,
  pg_temp.edge_gateway;

-- 2. Catalogue : toute fonction SECURITY DEFINER du schéma public finit son search_path par pg_temp -------------------------
-- Fonctions fautives (NULL si aucune) : hors extensions, aucun réglage search_path=… finissant par pg_temp.
CREATE FUNCTION pg_temp.definer_sans_pg_temp() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT string_agg(p.oid::regprocedure::text, ' ' ORDER BY p.oid::regprocedure::text)
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace AND p.prosecdef
     AND NOT EXISTS (SELECT 1 FROM pg_depend d
                      WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
     AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, '{}'::text[])) c
                      WHERE c LIKE 'search_path=%pg\_temp')
$$;
SELECT is(pg_temp.definer_sans_pg_temp(), NULL,
  'OP-N59 : aucune fonction SECURITY DEFINER du schéma public sans pg_temp en dernier dans son search_path');
SELECT cmp_ok((SELECT count(*)::int FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND prosecdef), '>=', 84,
  'le contrôle porte sur au moins les 84 fonctions SECURITY DEFINER connues à la migration 0021');

-- Témoins : une fonction future qui oublie pg_temp, le met en premier, ou n'a aucun search_path, est détectée.
CREATE FUNCTION temoin_definer_public() RETURNS int LANGUAGE sql SECURITY DEFINER SET search_path = public AS 'SELECT 1';
CREATE FUNCTION temoin_definer_pg_temp_premier() RETURNS int LANGUAGE sql SECURITY DEFINER
  SET search_path = pg_temp, public AS 'SELECT 1';
CREATE FUNCTION temoin_definer_sans_reglage() RETURNS int LANGUAGE sql SECURITY DEFINER AS 'SELECT 1';
SELECT is(pg_temp.definer_sans_pg_temp(),
  'temoin_definer_pg_temp_premier() temoin_definer_public() temoin_definer_sans_reglage()',
  'contrôle du catalogue : les trois témoins fautifs sont détectés');
-- Une fonction conforme créée après 0021 n'est pas signalée.
CREATE FUNCTION temoin_definer_conforme() RETURNS int LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
  AS 'SELECT 1';
DROP FUNCTION temoin_definer_public(), temoin_definer_pg_temp_premier(), temoin_definer_sans_reglage();
SELECT is(pg_temp.definer_sans_pg_temp(), NULL, 'contrôle du catalogue : une fonction conforme n''est pas signalée');

SELECT * FROM finish();
ROLLBACK;
