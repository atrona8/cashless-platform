-- Non-régression « statistiques absentes » de la lecture des changements d'un snapshot (migrations 0055, 0056 et 0057 ; mission
-- hors-ligne-snapshots-lots, WP21 partie I ; NFR-005) — pgTAP, écrit à la main.
-- Juste après un chargement massif, avant l'autoanalyze, le planificateur ne connaît pas la taille des tables. Avec la
-- forme « NOT EXISTS » de 0054 pour les retraits, il choisissait une Nested Loop Anti Join avec Materialize : ici
-- 20 000 jetons d'état x 20 000 médias = 4 x 10^8 comparaisons (plus de 60 s mesurées pour 50 000), bien au-delà des
-- 5 s posées ci-dessous (le rôle réel est coupé à 30 s). La forme EXCEPT de 0055 n'a pas de boucle imbriquée.
-- Jeu : 20 000 bracelets vivants (un portefeuille par bracelet, un seul rattachement ouvert par média et devise), 20 000
-- lignes d'état correspondantes, plus 5 jetons d'état orphelins ; historique repoussé à il y a une heure.
-- Lancer : pg_prove -d <base> tests/tests_offline_snapshot_source_no_stats.sql. Sous le PROPRIÉTAIRE seulement.
\set ON_ERROR_STOP 1
\set QUIET 1
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

CREATE FUNCTION pg_temp.id(p text) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT ('00000000-0000-0000-0000-' || lpad(p, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.lg() RETURNS uuid LANGUAGE sql AS
  $$ SELECT id FROM ledger WHERE scope_id = pg_temp.id('55d001') $$;

INSERT INTO party (kind, legal_name) SELECT 'PLATFORM', 'Plateforme (test)'
 WHERE NOT EXISTS (SELECT 1 FROM party WHERE kind = 'PLATFORM');
INSERT INTO party (id, kind, legal_name, country_code) VALUES (pg_temp.id('55a001'), 'OPERATOR', 'Prestataire 55', 'SN');
INSERT INTO party (id, kind, operator_id, legal_name)
VALUES (pg_temp.id('55b001'), 'ORGANIZER', pg_temp.id('55a001'), 'Organisateur 55');
INSERT INTO jurisdiction_profile (id, country_code, version, valid_from, breakage_destination)
VALUES (pg_temp.id('55c001'), 'SN', 550055, '2026-01-01', 'ORGANIZER');
INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone, jurisdiction_id, funds_holder, status)
VALUES (pg_temp.id('55d001'), pg_temp.id('55a001'), pg_temp.id('55b001'), 'Événement 55', 'XOF', 'Africa/Dakar',
        pg_temp.id('55c001'), 'ORGANIZER', 'LIVE');
SELECT set_config('app.operator_id', pg_temp.id('55a001')::text, true);
SELECT open_event_ledger(pg_temp.id('55d001'));
INSERT INTO tag_key (operator_id, key_index, kms_key_ref, status) VALUES (pg_temp.id('55a001'), 1, 'test:hmac-55', 'ACTIVE');
INSERT INTO tag_data_key (id, operator_id, key_index, version, wrapping_kms_key_ref, encrypted_dek)
VALUES (pg_temp.id('55d0d0'), pg_temp.id('55a001'), 1, 1, 'test:wrap-55', '\x01');

CREATE TEMP TABLE bulk55 AS
SELECT n, gen_random_uuid() AS wid, gen_random_uuid() AS mid FROM generate_series(1, 20000) n;
INSERT INTO wallet (id, operator_id, ledger_id, status)
SELECT wid, pg_temp.id('55a001'), pg_temp.lg(), 'ACTIVE' FROM bulk55;
INSERT INTO media (id, operator_id, kind, token_hash, nfc_uid, batch_id, key_index, wallet_id,
                   originality_sig_sha256, pwd_pack_enc, pwd_pack_dek_id)
SELECT mid, pg_temp.id('55a001'), 'NFC_TAG', sha256(convert_to('m55-' || n, 'UTF8')),
       decode(lpad(to_hex(n), 14, '0'), 'hex'), NULL, 1, wid, sha256(convert_to('sig55-' || n, 'UTF8')),
       decode(repeat('aa', 34), 'hex'), pg_temp.id('55d0d0')
  FROM bulk55;
UPDATE media_assignment SET assigned_at = now() - interval '1 hour';
UPDATE media_status_history SET at = now() - interval '1 hour';
INSERT INTO offline_snapshot_state (ledger_id, operator_id, token_hash, entry_sha256, last_version, removed)
SELECT pg_temp.lg(), pg_temp.id('55a001'), sha256(convert_to('m55-' || n, 'UTF8')), sha256('e'), 1, false
  FROM bulk55
UNION ALL
SELECT pg_temp.lg(), pg_temp.id('55a001'), sha256(convert_to('orphelin55-' || n, 'UTF8')), sha256('e'), 1, false
  FROM generate_series(1, 5) n;

-- Statistiques absentes, comme juste après un chargement massif (tables lues par la fonction).
UPDATE pg_class SET reltuples = -1, relpages = 0
 WHERE oid IN ('offline_snapshot_state'::regclass, 'media'::regclass, 'media_assignment'::regclass,
               'media_status_history'::regclass);
DELETE FROM pg_statistic
 WHERE starelid IN ('offline_snapshot_state'::regclass, 'media'::regclass, 'media_assignment'::regclass,
                    'media_status_history'::regclass);

SET LOCAL statement_timeout = '5s';

-- Appels directs, sans lives_ok : lives_ok exécute dans une sous-transaction (bloc EXCEPTION) qui, sur les lignes non
-- validées de cette transaction, ralentit tout d'un facteur 100 sans rapport avec la production (le travailleur appelle
-- la fonction en tête de transaction, sur des données validées). Un dépassement du délai interrompt le fichier : échec.
SELECT is((SELECT count(*)::int FROM offline_snapshot_source_rows(pg_temp.lg(), now() - interval '3 seconds')), 5,
          'DELTA sans statistiques : seuls les 5 jetons orphelins sont retirés');
SELECT is((SELECT count(*)::int FROM offline_snapshot_source_rows(pg_temp.lg(), NULL)), 20005,
          'FULL : 20 000 vivants + 5 jetons orphelins');

-- Fenêtre pleine : un changement de statut à now() pour chaque bracelet (le chargement massif d'un FULL précédent
-- laisse l'historique dans la fenêtre du DELTA suivant). La fonction lit depuis p_since - 5 s = now() - 8 s : les
-- lignes à now() y tombent. Tous les médias deviennent candidats et passent le filtre (EXISTS sur l'historique de
-- statut) : 20 000 vivants + 5 orphelins. Sans les index de 0056, chaque EXISTS corrélé parcourt toute la table pour
-- chacun des 20 000 candidats. Placé après les cas précédents : il change aussi ce que compte le FULL.
INSERT INTO media_status_history (operator_id, media_id, from_status, to_status, at)
SELECT pg_temp.id('55a001'), mid, 'ISSUED', 'SUSPENDED', now() FROM bulk55;
SELECT is((SELECT count(*)::int FROM offline_snapshot_source_rows(pg_temp.lg(), now() - interval '3 seconds')), 20005,
          'DELTA fenêtre pleine sans statistiques : 20 000 vivants + 5 orphelins, avant 5 s');

SELECT * FROM finish();
ROLLBACK;
