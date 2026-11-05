-- Politique hors ligne contrôlée (migration 0043 ; mission hors-ligne-snapshots-lots, lot WP02 ;
-- FR-001 à FR-005, FR-027, FR-039, NFR-014) — pgTAP, écrit à la main (pas un fichier généré).
-- Lancer : pg_prove -d <base> tests/tests_offline_policy.sql (base créée par les migrations).
-- Tout se joue sous le PROPRIÉTAIRE : les droits de rôle sont prouvés par WP08
-- (tests_offline_rights.sql). Aucun GRANT n'est posé ici.
\set ON_ERROR_STOP 1
\set QUIET 1
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

CREATE FUNCTION pg_temp.id(p text) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT ('00000000-0000-0000-0000-' || lpad(p, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.a() RETURNS void LANGUAGE sql AS
  $$ SELECT set_config('app.operator_id', pg_temp.id('43a001')::text, true) $$;
CREATE FUNCTION pg_temp.b() RETURNS void LANGUAGE sql AS
  $$ SELECT set_config('app.operator_id', pg_temp.id('43a002')::text, true) $$;
CREATE FUNCTION pg_temp.none() RETURNS void LANGUAGE sql AS
  $$ SELECT set_config('app.operator_id', '', true) $$;

-- Données ----------------------------------------------------------------------------------------
-- A : organisateur b001 ; événements d001 (avec 5 terminaux), d002 (vide) ; B : b011, d011.
-- Terminaux de d001 : aa01 (actif, hérite) ; aa02 (révoqué) ; aa03 (téléphone personnel) ;
-- aa04 (hors ligne coupé par le plafond via DEVICE) ; aa05 (actif, plafonné). ab01 : terminal de B.
-- Personnes : e001 ACTIVE de A ; e002 DISABLED de A ; e011 ACTIVE de B.
INSERT INTO party (kind, legal_name) SELECT 'PLATFORM', 'Plateforme (test)'
 WHERE NOT EXISTS (SELECT 1 FROM party WHERE kind = 'PLATFORM');
INSERT INTO party (id, kind, legal_name, country_code) VALUES
 (pg_temp.id('43a001'), 'OPERATOR', 'Prestataire A', 'SN'),
 (pg_temp.id('43a002'), 'OPERATOR', 'Prestataire B', 'CI');
INSERT INTO party (id, kind, operator_id, legal_name) VALUES
 (pg_temp.id('43b001'), 'ORGANIZER', pg_temp.id('43a001'), 'Organisateur A'),
 (pg_temp.id('43b011'), 'ORGANIZER', pg_temp.id('43a002'), 'Organisateur B');
INSERT INTO jurisdiction_profile (id, country_code, version, valid_from, breakage_destination)
VALUES (pg_temp.id('43c001'), 'SN', 430043, '2026-01-01', 'ORGANIZER');
INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone, jurisdiction_id,
                   funds_holder, status)
SELECT pg_temp.id(e), pg_temp.id(o), pg_temp.id(g), 'Événement ' || e, 'XOF', 'Africa/Dakar',
       pg_temp.id('43c001'), 'ORGANIZER', 'LIVE'
  FROM (VALUES ('43d001','43a001','43b001'), ('43d002','43a001','43b001'),
               ('43d011','43a002','43b011')) AS v(e, o, g);
INSERT INTO device (id, operator_id, kind, app_mode, event_id, serial, personal_phone)
SELECT pg_temp.id(d), pg_temp.id(o), 'POS', 'CATALOG_POS', pg_temp.id(ev), s, pp
  FROM (VALUES ('43aa01','43a001','43d001','C43-AA01',false), ('43aa02','43a001','43d001','C43-AA02',false),
               ('43aa03','43a001','43d001','C43-AA03',true),  ('43aa04','43a001','43d001','C43-AA04',false),
               ('43aa05','43a001','43d001','C43-AA05',false), ('43ab01','43a002','43d011','C43-AB01',false))
       AS v(d, o, ev, s, pp);
UPDATE device SET status = 'REVOKED' WHERE id = pg_temp.id('43aa02');
INSERT INTO app_user (id, operator_id, issuer, subject, email, display_name)
SELECT pg_temp.id(u), pg_temp.id(o), 'https://idp.test', 's0043' || u, u || '@test', 'Personne ' || u
  FROM (VALUES ('43e001','43a001'), ('43e002','43a001'), ('43e011','43a002')) AS v(u, o);
UPDATE app_user SET status = 'DISABLED', disabled_at = now() WHERE id = pg_temp.id('43e002');

-- 1. Contrainte espèces ---------------------------------------------------------------------------
SELECT pg_temp.a();
SELECT is((SELECT pg_get_constraintdef(oid) FROM pg_constraint
            WHERE conname = 'offline_policy_cash_topup_off'),
          'CHECK ((cash_topup_offline IS NOT TRUE))',
          'CHECK offline_policy_cash_topup_off en place');
SELECT throws_ok($$INSERT INTO offline_policy (operator_id, scope_type, scope_id, cash_topup_offline)
  VALUES (pg_temp.id('43a001'), 'OPERATOR_CEILING', pg_temp.id('43a001'), true)$$, '23514', NULL,
  'cash_topup_offline = true refusé par INSERT direct');
SELECT lives_ok($$INSERT INTO offline_policy (operator_id, scope_type, scope_id, cash_topup_offline)
  VALUES (pg_temp.id('43a001'), 'OPERATOR_CEILING', pg_temp.id('43a001'), false)$$,
  'cash_topup_offline = false accepté par INSERT direct');
SELECT throws_ok($$UPDATE offline_policy SET cash_topup_offline = true
  WHERE scope_id = pg_temp.id('43a001')$$, '23514', NULL,
  'cash_topup_offline = true refusé par UPDATE direct');
DELETE FROM offline_policy WHERE scope_id = pg_temp.id('43a001');
SELECT throws_ok($$SELECT set_offline_policy('EVENT', pg_temp.id('43d001'),
  '{"cash_topup_offline": true}', NULL, pg_temp.id('43e001'))$$, 'CL047', NULL,
  'cash_topup_offline = true refusé par la fonction (CL047)');
SELECT is((SELECT count(*)::int FROM offline_policy WHERE scope_id = pg_temp.id('43d001')), 0,
  'CL047 : aucune ligne écrite');
SELECT lives_ok($$SELECT set_offline_policy('EVENT', pg_temp.id('43d002'),
  '{"cash_topup_offline": false}', NULL, pg_temp.id('43e001'))$$,
  'cash_topup_offline = false accepté par la fonction');
SELECT lives_ok($$SELECT set_offline_policy('DEVICE', pg_temp.id('43aa05'),
  '{"cash_topup_offline": null}', NULL, pg_temp.id('43e001'))$$,
  'cash_topup_offline = null accepté par la fonction');
-- Migration d'une ligne `true` préexistante : la contrainte est posée à la migration, on ne peut
-- plus planter de ligne `true` après coup. On rejoue donc la logique du UPDATE de la migration sur
-- une copie sans contrainte (table de travail créée comme offline_policy, sans le CHECK).
CREATE TEMP TABLE pol_legacy (LIKE offline_policy INCLUDING DEFAULTS);
INSERT INTO pol_legacy (operator_id, scope_type, scope_id, cash_topup_offline)
VALUES (pg_temp.id('43a001'), 'EVENT', pg_temp.id('43d001'), true);
UPDATE pol_legacy SET cash_topup_offline = false WHERE cash_topup_offline;
SELECT is((SELECT cash_topup_offline FROM pol_legacy), false,
  'migration : une ligne true préexistante est remise à false (UPDATE de 0043 rejoué sur copie)');
DROP TABLE pol_legacy;

-- 2. Portée (CL045) -------------------------------------------------------------------------------
SELECT pg_temp.a();
SELECT throws_ok(format($f$SELECT set_offline_policy('EVENT', %L, '{}', NULL, %L)$f$,
  pg_temp.id('43d011'), pg_temp.id('43e001')), 'CL045', NULL, 'EVENT d''un autre prestataire : CL045');
SELECT throws_ok(format($f$SELECT set_offline_policy('DEVICE', %L, '{}', NULL, %L)$f$,
  pg_temp.id('43ab01'), pg_temp.id('43e001')), 'CL045', NULL, 'DEVICE d''un autre prestataire : CL045');
SELECT throws_ok(format($f$SELECT set_offline_policy('ORGANIZER', %L, '{}', NULL, %L)$f$,
  pg_temp.id('43b011'), pg_temp.id('43e001')), 'CL045', NULL, 'ORGANIZER d''un autre prestataire : CL045');
SELECT throws_ok(format($f$SELECT set_offline_policy('OPERATOR_CEILING', %L, '{}', NULL, %L)$f$,
  pg_temp.id('43a002'), pg_temp.id('43e001')), 'CL045', NULL, 'OPERATOR_CEILING d''un autre prestataire : CL045');
SELECT throws_ok(format($f$SELECT set_offline_policy('OPERATOR_CEILING', %L, '{}', NULL, %L)$f$,
  pg_temp.id('43b001'), pg_temp.id('43e001')), 'CL045', NULL, 'OPERATOR_CEILING sur un organisateur : CL045');
SELECT throws_ok(format($f$SELECT set_offline_policy('EVENT', %L, '{}', NULL, %L)$f$,
  pg_temp.id('43ffff'), pg_temp.id('43e001')), 'CL045', NULL, 'EVENT inexistant : CL045');
SELECT throws_ok(format($f$SELECT set_offline_policy('EVENT', %L, '{}', NULL, %L)$f$,
  pg_temp.id('43aa01'), pg_temp.id('43e001')), 'CL045', NULL, 'un device passé en EVENT : CL045');
SELECT throws_ok(format($f$SELECT set_offline_policy('DEVICE', %L, '{}', NULL, %L)$f$,
  pg_temp.id('43d001'), pg_temp.id('43e001')), 'CL045', NULL, 'un event passé en DEVICE : CL045');
SELECT throws_ok(format($f$SELECT set_offline_policy('ORGANIZER', %L, '{}', NULL, %L)$f$,
  pg_temp.id('43a001'), pg_temp.id('43e001')), 'CL045', NULL, 'un prestataire passé en ORGANIZER : CL045');
SELECT pg_temp.none();
SELECT throws_ok(format($f$SELECT set_offline_policy('EVENT', %L, '{}', NULL, %L)$f$,
  pg_temp.id('43d001'), pg_temp.id('43e001')), 'CL045', NULL, 'sans prestataire de session : CL045');
SELECT pg_temp.a();
SELECT is((SELECT count(*)::int FROM offline_policy WHERE operator_id = pg_temp.id('43a002')), 0,
  'aucune ligne écrite pour B');
SELECT throws_ok($$INSERT INTO offline_policy (operator_id, scope_type, scope_id)
  VALUES (pg_temp.id('43a001'), 'EVENT', pg_temp.id('43d011'))$$, 'CL045', NULL,
  'INSERT direct d''une portée d''un autre prestataire : CL045 (déclencheur)');
SELECT throws_ok($$INSERT INTO offline_policy (operator_id, scope_type, scope_id)
  VALUES (pg_temp.id('43a001'), 'OPERATOR_CEILING', pg_temp.id('43a002'))$$, 'CL045', NULL,
  'INSERT direct OPERATOR_CEILING <> prestataire : CL045');
SELECT throws_ok($$UPDATE offline_policy SET scope_id = pg_temp.id('43d001')
  WHERE scope_type = 'EVENT' AND scope_id = pg_temp.id('43d002')$$, 'CL045', NULL,
  'la portée ne change pas après création : CL045');
SELECT throws_ok(format($f$SELECT offline_policy_level('EVENT', %L)$f$, pg_temp.id('43d011')),
  'CL045', NULL, 'offline_policy_level d''un autre prestataire : CL045');
SELECT throws_ok(format($f$SELECT clear_offline_policy('EVENT', %L, NULL, %L)$f$,
  pg_temp.id('43d011'), pg_temp.id('43e001')), 'CL045', NULL, 'clear d''un autre prestataire : CL045');

-- 3. Acteur ---------------------------------------------------------------------------------------
SELECT throws_ok(format($f$SELECT set_offline_policy('EVENT', %L, '{}', NULL, %L)$f$,
  pg_temp.id('43d001'), pg_temp.id('43e011')), 'P0002', NULL, 'acteur d''un autre prestataire : P0002');
SELECT throws_ok(format($f$SELECT set_offline_policy('EVENT', %L, '{}', NULL, %L)$f$,
  pg_temp.id('43d001'), pg_temp.id('43e002')), 'P0002', NULL, 'acteur désactivé : P0002');
SELECT throws_ok(format($f$SELECT set_offline_policy('EVENT', %L, '{}', NULL, %L)$f$,
  pg_temp.id('43d001'), pg_temp.id('43ffff')), 'P0002', NULL, 'acteur inconnu : P0002');
SELECT throws_ok(format($f$SELECT set_offline_policy('EVENT', %L, '{}', NULL, NULL)$f$,
  pg_temp.id('43d001')), 'P0002', NULL, 'acteur nul : P0002');

-- 4. Valeurs (CL001) ------------------------------------------------------------------------------
SELECT throws_ok(format($f$SELECT set_offline_policy('EVENT', %L, '{"inconnue": 1}', NULL, %L)$f$,
  pg_temp.id('43d001'), pg_temp.id('43e001')), 'CL001', NULL, 'clé inconnue : CL001');
SELECT throws_ok(format($f$SELECT set_offline_policy('EVENT', %L, '{"max_per_sale": -1}', NULL, %L)$f$,
  pg_temp.id('43d001'), pg_temp.id('43e001')), 'CL001', NULL, 'montant négatif : CL001');
SELECT throws_ok(format($f$SELECT set_offline_policy('EVENT', %L, '{"max_per_sale": 1.5}', NULL, %L)$f$,
  pg_temp.id('43d001'), pg_temp.id('43e001')), 'CL001', NULL, 'montant non entier : CL001');
SELECT throws_ok(format($f$SELECT set_offline_policy('EVENT', %L, '{"max_per_sale": "10"}', NULL, %L)$f$,
  pg_temp.id('43d001'), pg_temp.id('43e001')), 'CL001', NULL, 'montant texte : CL001');
SELECT throws_ok(format($f$SELECT set_offline_policy('EVENT', %L, '{"max_snapshot_age_seconds": 86401}', NULL, %L)$f$,
  pg_temp.id('43d001'), pg_temp.id('43e001')), 'CL001', NULL, 'âge > 86400 : CL001');
SELECT throws_ok(format($f$SELECT set_offline_policy('EVENT', %L, '{"max_snapshot_age_seconds": -1}', NULL, %L)$f$,
  pg_temp.id('43d001'), pg_temp.id('43e001')), 'CL001', NULL, 'âge négatif : CL001');
SELECT throws_ok(format($f$SELECT set_offline_policy('EVENT', %L, '{"offline_enabled": "oui"}', NULL, %L)$f$,
  pg_temp.id('43d001'), pg_temp.id('43e001')), 'CL001', NULL, 'booléen texte : CL001');
SELECT throws_ok(format($f$SELECT set_offline_policy('EVENT', %L, '[]', NULL, %L)$f$,
  pg_temp.id('43d001'), pg_temp.id('43e001')), 'CL001', NULL, 'valeurs non objet : CL001');
SELECT throws_ok(format($f$SELECT set_offline_policy('PLANETE', %L, '{}', NULL, %L)$f$,
  pg_temp.id('43d001'), pg_temp.id('43e001')), 'CL001', NULL, 'type de portée inconnu : CL001');
SELECT is((SELECT count(*)::int FROM offline_policy WHERE scope_id = pg_temp.id('43d001')), 0,
  'valeurs invalides : aucune ligne écrite');

-- 5. Cycle de version (CL046) et historique ------------------------------------------------------
SELECT throws_ok(format($f$SELECT set_offline_policy('ORGANIZER', %L, '{}', 1, %L)$f$,
  pg_temp.id('43b001'), pg_temp.id('43e001')), 'CL046', NULL, 'version attendue sur ligne absente : CL046');
SELECT is((SELECT version FROM set_offline_policy('ORGANIZER', pg_temp.id('43b001'),
  '{"offline_enabled": true, "max_per_sale": 5000, "max_per_media_per_device": 20000, "max_total_per_device": 100000, "max_snapshot_age_seconds": 900}',
  NULL, pg_temp.id('43e001'))), 1, 'création : version 1');
SELECT is((SELECT max_snapshot_age FROM offline_policy WHERE scope_id = pg_temp.id('43b001')),
  interval '15 minutes', 'âge stocké en interval');
SELECT is((SELECT updated_by FROM offline_policy WHERE scope_id = pg_temp.id('43b001')),
  pg_temp.id('43e001'), 'updated_by = acteur');
SELECT throws_ok(format($f$SELECT set_offline_policy('ORGANIZER', %L, '{}', NULL, %L)$f$,
  pg_temp.id('43b001'), pg_temp.id('43e001')), 'CL046', NULL, 'NULL sur ligne existante : CL046');
SELECT is((SELECT version FROM set_offline_policy('ORGANIZER', pg_temp.id('43b001'),
  '{"offline_enabled": true, "max_per_sale": 6000}', 1, pg_temp.id('43e001'))), 2,
  'modification avec la version 1 : version 2');
SELECT is((SELECT max_total_per_device FROM offline_policy WHERE scope_id = pg_temp.id('43b001')), NULL::bigint,
  'clé absente = hérite (colonne NULL)');
SELECT throws_ok(format($f$SELECT set_offline_policy('ORGANIZER', %L, '{}', 1, %L)$f$,
  pg_temp.id('43b001'), pg_temp.id('43e001')), 'CL046', NULL, 'modification avec la version périmée : CL046');
SELECT is((SELECT version FROM set_offline_policy('ORGANIZER', pg_temp.id('43b001'),
  '{"offline_enabled": true, "max_per_sale": 6000}', 2, pg_temp.id('43e001'))), 3,
  'écriture sans changement : la version monte quand même');
SELECT throws_ok(format($f$SELECT clear_offline_policy('ORGANIZER', %L, 1, %L)$f$,
  pg_temp.id('43b001'), pg_temp.id('43e001')), 'CL046', NULL, 'clear avec la version périmée : CL046');
SELECT lives_ok(format($f$SELECT clear_offline_policy('ORGANIZER', %L, 3, %L)$f$,
  pg_temp.id('43b001'), pg_temp.id('43e001')), 'clear avec la bonne version');
SELECT is((SELECT count(*)::int FROM offline_policy WHERE scope_id = pg_temp.id('43b001')), 0,
  'ligne supprimée');
SELECT is((SELECT array_agg(version ORDER BY version) FROM offline_policy_history
            WHERE scope_id = pg_temp.id('43b001')), ARRAY[1,2,3,4],
  'historique : une ligne par état (versions 1, 2, 3, puis 4 pour la suppression)');
SELECT is((SELECT deleted FROM offline_policy_history
            WHERE scope_id = pg_temp.id('43b001') AND version = 4), true, 'dernière ligne : deleted');
SELECT is((SELECT count(*)::int FROM offline_policy_history
            WHERE scope_id = pg_temp.id('43b001') AND deleted), 1, 'une seule ligne deleted');
SELECT throws_ok(format($f$SELECT clear_offline_policy('ORGANIZER', %L, 4, %L)$f$,
  pg_temp.id('43b001'), pg_temp.id('43e001')), 'CL046', NULL, 'clear sur absente avec version attendue : CL046');
SELECT lives_ok(format($f$SELECT clear_offline_policy('ORGANIZER', %L, NULL, %L)$f$,
  pg_temp.id('43b001'), pg_temp.id('43e001')), 'clear sur absente sans version : sans effet');
SELECT is((SELECT count(*)::int FROM offline_policy_history WHERE scope_id = pg_temp.id('43b001')), 4,
  'clear sans effet : pas de ligne d''historique en plus');
SELECT is((SELECT version FROM set_offline_policy('ORGANIZER', pg_temp.id('43b001'), '{}', NULL,
  pg_temp.id('43e001'))), 1, 'recréation après suppression : version 1');
-- La version d'historique vient de la ligne, pas de l'appelant : une recréation (nouvel id) n'entre
-- pas en conflit avec l'ancien policy_id.
SELECT is((SELECT count(DISTINCT policy_id)::int FROM offline_policy_history
            WHERE scope_id = pg_temp.id('43b001')), 2, 'historique : deux policy_id distincts');
SELECT is((SELECT (offline_policy_level('ORGANIZER', pg_temp.id('43b001'))).version), 1,
  'offline_policy_level lit la ligne');
SELECT ok((SELECT offline_policy_level('DEVICE', pg_temp.id('43aa01'))) IS NULL,
  'offline_policy_level : NULL si aucune ligne');

-- 6. OP-N58 côté fonction et rubriques de définition ---------------------------------------------
SELECT ok((SELECT prosecdef FROM pg_proc WHERE proname = 'log_offline_policy'),
  'log_offline_policy est SECURITY DEFINER');
SELECT ok((SELECT proconfig @> ARRAY['search_path=public, pg_temp'] FROM pg_proc WHERE proname = 'log_offline_policy'),
  'log_offline_policy : search_path fixé');
SELECT is((SELECT count(*)::int FROM pg_trigger WHERE tgname = 'offline_policy_log'
            AND tgrelid = 'offline_policy'::regclass AND NOT tgisinternal), 1,
  'le déclencheur offline_policy_log garde son lien');
SELECT is((SELECT count(*)::int FROM pg_proc p
            WHERE p.proname IN ('set_offline_policy','clear_offline_policy','offline_policy_level',
                  'offline_max_exposure','offline_policy_scope_operator','offline_policy_actor_check',
                  'offline_policy_scope_guard','log_offline_policy')
              AND (NOT p.prosecdef
                   OR NOT coalesce(p.proconfig @> ARRAY['search_path=public, pg_temp'], false)
                   OR has_function_privilege('public', p.oid, 'EXECUTE'))), 0,
  'chaque fonction : DEFINER, search_path = public, pg_temp, EXECUTE retiré à PUBLIC');
SELECT is((SELECT count(*)::int FROM pg_proc p
            WHERE p.proname IN ('offline_policy_scope_operator','offline_policy_actor_check',
                  'offline_policy_scope_guard') AND p.proacl IS NOT NULL
              AND EXISTS (SELECT 1 FROM aclexplode(p.proacl) x
                           WHERE x.grantee <> p.proowner)), 0,
  'aucun GRANT sur les fonctions internes de la migration (les accords nominatifs : tests_offline_rights.sql, WP08)');

-- 7. Héritage et plafond (effective_offline_policy inchangée) ------------------------------------
-- Organisateur b001 : activé, 5000 / 20000 / 100000, 900 s. Événement d001 : max_per_sale 3000.
-- Terminal aa05 : max_per_sale 1000. Plafond de A : 4000 / - / 80000, 600 s.
SELECT set_offline_policy('ORGANIZER', pg_temp.id('43b001'),
  '{"offline_enabled": true, "max_per_sale": 5000, "max_per_media_per_device": 20000, "max_total_per_device": 100000, "max_snapshot_age_seconds": 900}',
  1, pg_temp.id('43e001'));
SELECT set_offline_policy('EVENT', pg_temp.id('43d001'), '{"max_per_sale": 3000}', NULL, pg_temp.id('43e001'));
SELECT set_offline_policy('DEVICE', pg_temp.id('43aa05'), '{"max_per_sale": 1000}', 1, pg_temp.id('43e001'));
SELECT is((SELECT max_per_sale FROM effective_offline_policy(pg_temp.id('43aa01'))), 3000::bigint,
  'EVENT l''emporte sur ORGANIZER');
SELECT is((SELECT max_per_sale FROM effective_offline_policy(pg_temp.id('43aa05'))), 1000::bigint,
  'DEVICE l''emporte sur EVENT');
SELECT is((SELECT max_total_per_device FROM effective_offline_policy(pg_temp.id('43aa01'))), 100000::bigint,
  'champ NULL : hérite de ORGANIZER');
SELECT is((SELECT offline_enabled FROM effective_offline_policy(pg_temp.id('43aa01'))), true,
  'hors ligne activé par héritage');
SELECT set_offline_policy('OPERATOR_CEILING', pg_temp.id('43a001'),
  '{"max_per_sale": 2000, "max_total_per_device": 80000, "max_snapshot_age_seconds": 600}', NULL,
  pg_temp.id('43e001'));
SELECT is((SELECT (max_per_sale, max_total_per_device, max_snapshot_age, capped)::text
             FROM effective_offline_policy(pg_temp.id('43aa01'))),
          '(2000,80000,00:10:00,t)', 'plafond : least() sur les montants et l''âge, capped vrai');
SELECT set_offline_policy('DEVICE', pg_temp.id('43aa05'),
  '{"max_per_sale": 1000, "max_per_media_per_device": 10000, "max_total_per_device": 50000}', 2,
  pg_temp.id('43e001'));
SELECT is((SELECT capped FROM effective_offline_policy(pg_temp.id('43aa05'))), false,
  'capped faux quand la valeur du terminal est sous le plafond (3 montants seulement)');
-- capped ne couvre que les trois montants : un âge réduit seul ne le lève pas.
SELECT set_offline_policy('OPERATOR_CEILING', pg_temp.id('43a001'),
  '{"max_snapshot_age_seconds": 300}', 1, pg_temp.id('43e001'));
SELECT is((SELECT (max_per_sale, max_total_per_device, max_snapshot_age, capped)::text
             FROM effective_offline_policy(pg_temp.id('43aa01'))),
          '(3000,100000,00:05:00,f)', 'âge réduit seul : capped faux');
-- Plafond qui coupe offline_enabled.
SELECT set_offline_policy('OPERATOR_CEILING', pg_temp.id('43a001'),
  '{"offline_enabled": false, "max_total_per_device": 80000}', 2, pg_temp.id('43e001'));
SELECT is((SELECT offline_enabled FROM effective_offline_policy(pg_temp.id('43aa01'))), false,
  'plafond offline_enabled = false : coupé');

-- 8. offline_max_exposure ------------------------------------------------------------------------
-- Plafond : 80000 total, hors ligne coupé. aa04 : DEVICE hors ligne coupé. On rétablit le plafond
-- (hors ligne non coupé), puis on coupe seulement aa04 par sa propre politique.
SELECT set_offline_policy('OPERATOR_CEILING', pg_temp.id('43a001'),
  '{"max_total_per_device": 80000}', 3, pg_temp.id('43e001'));
SELECT set_offline_policy('DEVICE', pg_temp.id('43aa04'), '{"offline_enabled": false}', NULL,
  pg_temp.id('43e001'));
SELECT is((SELECT array_agg(serial ORDER BY serial) FROM offline_max_exposure(pg_temp.id('43d001'))),
          ARRAY['C43-AA01','C43-AA05'],
  'seuls les terminaux utiles : ni révoqué, ni téléphone personnel, ni hors ligne coupé');
SELECT is((SELECT max_total_per_device FROM offline_max_exposure(pg_temp.id('43d001')) WHERE serial = 'C43-AA01'),
  80000::bigint, 'valeur plafonnée (100000 -> 80000)');
SELECT is((SELECT capped FROM offline_max_exposure(pg_temp.id('43d001')) WHERE serial = 'C43-AA01'),
  true, 'capped vrai pour le terminal plafonné');
SELECT is((SELECT count(*)::int FROM offline_max_exposure(pg_temp.id('43d002'))), 0,
  'événement sans terminal : aucune ligne');
SELECT throws_ok(format($f$SELECT * FROM offline_max_exposure(%L)$f$, pg_temp.id('43d011')),
  'P0002', NULL, 'événement d''un autre prestataire : refus d''assert_tenant');
SELECT throws_ok(format($f$SELECT * FROM offline_max_exposure(%L)$f$, pg_temp.id('43ffff')),
  'P0002', NULL, 'événement inexistant : refus');
SELECT pg_temp.b();
SELECT is((SELECT count(*)::int FROM offline_max_exposure(pg_temp.id('43d011'))), 0,
  'B lit ses propres événements (terminal hors ligne non activé : aucune ligne)');
SELECT throws_ok(format($f$SELECT * FROM offline_max_exposure(%L)$f$, pg_temp.id('43d001')),
  'P0002', NULL, 'B ne lit pas l''événement de A');

SELECT * FROM finish();
ROLLBACK;
