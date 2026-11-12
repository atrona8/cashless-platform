-- Journal de réplication en mode DIFFERE REEL (migration 0063, lot WP08, décision 28 du porteur, cycle 2) — pgTAP.
-- Les autres suites passent en SET CONSTRAINTS ALL IMMEDIATE ; celle-ci non : trois connexions réelles (dblink), commits
-- réels, sans SET CONSTRAINTS. Preuves : (1) une transaction qui écrit une entité de référence ne reçoit sa ligne de journal
-- qu'AU COMMIT ; (2) deux transactions concurrentes sur le même grand livre : les change_seq suivent l'ordre de VALIDATION
-- (la seconde à écrire valide la première), sans trou.
-- La suite commit pour de vrai : elle crée ses propres données (identifiants fixes 64...) et les retire en fin de suite
-- (et en tête, au cas d'une exécution interrompue). Session principale hors transaction. Lancer depuis packages/ledger-sql :
--   pg_prove -d <base> tests/tests_edge_replication_deferred.sql
-- Nécessite un superutilisateur (dblink sans mot de passe, session_replication_role pour le nettoyage).
\set ON_ERROR_STOP 1
\set QUIET 1
-- Les autres suites créent pgtap et dblink DANS leur transaction (annulée) ; celle-ci commit : elle ne doit pas les laisser
-- derrière elle (les suites de droits sondent des rôles sans le EXECUTE que _grants_for_tests.sql donne à pgtap).
SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pgtap') AS had_pgtap,
       EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'dblink') AS had_dblink \gset
CREATE EXTENSION IF NOT EXISTS pgtap;
CREATE EXTENSION IF NOT EXISTS dblink;
SELECT no_plan();

CREATE FUNCTION pg_temp.id(p text) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT ('00000000-0000-0000-0000-' || lpad(p, 12, '0'))::uuid $$;

-- Nettoyage (connexion fx, propriétaire superutilisateur) : retire tout ce qui porte le prestataire de la suite.
CREATE FUNCTION pg_temp.cleanup() RETURNS void LANGUAGE plpgsql AS $$
DECLARE op text := pg_temp.id('64a001')::text;
BEGIN
  PERFORM dblink_exec('fx', 'SET session_replication_role = replica');
  PERFORM dblink_exec('fx', format($f$
    DO $d$ DECLARE t text; BEGIN
      FOR t IN SELECT c.table_name FROM information_schema.columns c JOIN pg_tables p
                 ON p.schemaname = 'public' AND p.tablename = c.table_name
                WHERE c.table_schema = 'public' AND c.column_name = 'operator_id' LOOP
        EXECUTE format('DELETE FROM %%I WHERE operator_id = %%L', t, %L);
      END LOOP;
      DELETE FROM party WHERE id IN (%L, %L);
      DELETE FROM jurisdiction_profile WHERE id = %L;
    END $d$ $f$, op, op, pg_temp.id('64f001')::text, pg_temp.id('64c001')::text));
  PERFORM dblink_exec('fx', 'SET session_replication_role = origin');
END $$;

SELECT dblink_connect('fx', 'dbname=' || current_database());
SELECT pg_temp.cleanup();

-- Données committées : un prestataire, un organisateur, un événement et son grand livre.
-- Partie PLATEFORME : créée seulement si absente, avec un identifiant fixe pour pouvoir la retirer (une seule permise).
SELECT dblink_exec('fx', format($q$
  INSERT INTO party (id, kind, legal_name) SELECT %L, 'PLATFORM', 'Plateforme (test)'
   WHERE NOT EXISTS (SELECT 1 FROM party WHERE kind = 'PLATFORM') $q$, pg_temp.id('64f001')));
SELECT dblink_exec('fx', format($q$
  INSERT INTO party (id, kind, legal_name, country_code) VALUES (%L, 'OPERATOR', 'Prestataire différé', 'SN') $q$,
  pg_temp.id('64a001')));
SELECT dblink_exec('fx', format($q$
  INSERT INTO party (id, kind, operator_id, legal_name) VALUES (%L, 'ORGANIZER', %L, 'Organisateur différé') $q$,
  pg_temp.id('64b001'), pg_temp.id('64a001')));
SELECT dblink_exec('fx', format($q$
  INSERT INTO jurisdiction_profile (id, country_code, version, valid_from, breakage_destination)
  VALUES (%L, 'SN', 640064, '2026-01-01', 'ORGANIZER') $q$, pg_temp.id('64c001')));
SELECT dblink_exec('fx', format('SET app.operator_id = %L', pg_temp.id('64a001')));
SELECT dblink_exec('fx', format($q$
  INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone, jurisdiction_id, funds_holder, status)
  VALUES (%L, %L, %L, 'Evénement différé', 'XOF', 'Africa/Dakar', %L, 'ORGANIZER', 'LIVE') $q$,
  pg_temp.id('64d001'), pg_temp.id('64a001'), pg_temp.id('64b001'), pg_temp.id('64c001')));
SELECT * FROM dblink('fx', format('SELECT open_event_ledger(%L)::text', pg_temp.id('64d001'))) AS t(x text);

-- Lecture du journal par une troisième connexion (hors instantané de la session principale).
SELECT dblink_connect('rd', 'dbname=' || current_database());
SELECT dblink_exec('rd', format('SET app.operator_id = %L', pg_temp.id('64a001')));
CREATE FUNCTION pg_temp.journal() RETURNS text LANGUAGE sql AS $$
  SELECT coalesce(x, '') FROM dblink('rd', format($q$
    SELECT string_agg(r.change_seq || ':' || r.entity_kind || ':' || coalesce(g.serial, '-'), ' ' ORDER BY r.change_seq)
      FROM edge_reference_change r LEFT JOIN edge_gateway g ON g.id = r.entity_id
     WHERE r.ledger_id = (SELECT id FROM ledger WHERE scope_type = 'EVENT' AND scope_id = %L) $q$,
    pg_temp.id('64d001'))) AS t(x text)
$$;

SELECT is(pg_temp.journal(), '1:EVENT:-', 'grand livre neuf : une seule ligne d''amorce EVENT');

-- A écrit d'abord et valide en dernier ; B écrit ensuite et valide d'abord. Aucun SET CONSTRAINTS nulle part.
SELECT dblink_connect('ca', 'dbname=' || current_database());
SELECT dblink_connect('cb', 'dbname=' || current_database());
SELECT dblink_exec('ca', format('SET app.operator_id = %L', pg_temp.id('64a001')));
SELECT dblink_exec('cb', format('SET app.operator_id = %L', pg_temp.id('64a001')));
SELECT dblink_exec('ca', 'BEGIN');
SELECT dblink_exec('ca', format($q$INSERT INTO edge_gateway (id, operator_id, event_id, serial, role, status)
  VALUES (%L, %L, %L, 'D-A', 'STANDBY', 'ACTIVE') $q$, pg_temp.id('64e001'), pg_temp.id('64a001'), pg_temp.id('64d001')));
SELECT dblink_exec('cb', 'BEGIN');
SELECT dblink_exec('cb', format($q$INSERT INTO edge_gateway (id, operator_id, event_id, serial, role, status)
  VALUES (%L, %L, %L, 'D-B', 'STANDBY', 'ACTIVE') $q$, pg_temp.id('64e002'), pg_temp.id('64a001'), pg_temp.id('64d001')));
SELECT is(pg_temp.journal(), '1:EVENT:-', 'deux écritures en cours : le journal n''a encore rien reçu (déclencheurs différés)');
SELECT is((SELECT x FROM dblink('ca', $q$SELECT count(*)::text FROM edge_reference_change
  WHERE entity_kind = 'GATEWAY' AND entity_id = (SELECT id FROM edge_gateway WHERE serial = 'D-A')$q$) AS t(x text)), '0',
  'même dans sa propre transaction, A n''a pas encore sa ligne de journal (elle arrive au COMMIT)');
SELECT dblink_exec('cb', 'COMMIT');
SELECT is(pg_temp.journal(), '1:EVENT:- 2:GATEWAY:D-B', 'B valide la première : sa ligne reçoit le numéro 2');
SELECT dblink_exec('ca', 'COMMIT');
SELECT is(pg_temp.journal(), '1:EVENT:- 2:GATEWAY:D-B 3:GATEWAY:D-A',
  'A (qui avait écrit la première) valide ensuite : numéro 3, l''ordre est celui de la validation, sans trou');

-- Une transaction qui écrit plusieurs entités reçoit des numéros contigus à son COMMIT, après ceux déjà validés.
SELECT dblink_exec('ca', 'BEGIN');
SELECT dblink_exec('ca', format($q$INSERT INTO edge_gateway (id, operator_id, event_id, serial, role, status)
  VALUES (%L, %L, %L, 'D-C', 'STANDBY', 'ACTIVE') $q$, pg_temp.id('64e003'), pg_temp.id('64a001'), pg_temp.id('64d001')));
SELECT dblink_exec('ca', $q$UPDATE edge_gateway SET lan_url = 'https://d-a.test:8443' WHERE serial = 'D-A'$q$);
SELECT dblink_exec('ca', 'COMMIT');
SELECT is((SELECT array_agg(n ORDER BY n) FROM regexp_split_to_table(pg_temp.journal(), ' ') AS n WHERE n ~ '^[0-9]+:'),
  ARRAY['1:EVENT:-', '2:GATEWAY:D-B', '3:GATEWAY:D-A', '4:GATEWAY:D-C', '5:GATEWAY:D-A'],
  'commit multiple : numéros 4 et 5 contigus à la suite, sans trou');

-- Nettoyage.
SELECT dblink_disconnect('ca');
SELECT dblink_disconnect('cb');
SELECT dblink_disconnect('rd');
SELECT pg_temp.cleanup();
SELECT is((SELECT x FROM dblink('fx', format('SELECT count(*)::text FROM party WHERE id IN (%L, %L)',
  pg_temp.id('64a001'), pg_temp.id('64f001'))) AS t(x text)), '0', 'nettoyage : parties de la suite retirées');
SELECT is((SELECT x FROM dblink('fx', format('SELECT count(*)::text FROM edge_reference_change WHERE operator_id = %L',
  pg_temp.id('64a001'))) AS t(x text)), '0', 'nettoyage : journal de la suite retiré');
SELECT dblink_disconnect('fx');
SELECT * FROM finish();
\if :had_dblink
\else
  DROP EXTENSION dblink;
\endif
\if :had_pgtap
\else
  DROP EXTENSION pgtap;
\endif
