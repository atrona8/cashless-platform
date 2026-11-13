-- Inscription, identité et administration des passerelles (migration 0058 ; mission passerelle-locale, lot WP03 ;
-- FR-002, FR-031, FR-037, C-009) — pgTAP, écrit à la main, SOUS LE PROPRIETAIRE seulement (les droits sont en WP09).
-- Lancer depuis packages/ledger-sql : pg_prove -d <base> tests/tests_edge_gateway.sql
-- Limite : une session pgTAP ne prouve pas la concurrence. On prouve (a) le refus séquentiel du second PRIMARY et
-- (b) la prise du verrou consultatif de l'événement. La concurrence réelle (deux connexions) revient à
-- l'orchestrateur et à WP25.
\set ON_ERROR_STOP 1
\set QUIET 1
BEGIN;
\ir _grants_for_tests.sql
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

CREATE FUNCTION pg_temp.id(p text) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT ('00000000-0000-0000-0000-' || lpad(p, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.a() RETURNS void LANGUAGE sql AS
  $$ SELECT set_config('app.operator_id', pg_temp.id('58a001')::text, true) $$;
CREATE FUNCTION pg_temp.b() RETURNS void LANGUAGE sql AS
  $$ SELECT set_config('app.operator_id', pg_temp.id('58a002')::text, true) $$;
CREATE FUNCTION pg_temp.fp(p int) RETURNS bytea LANGUAGE sql IMMUTABLE AS
  $$ SELECT sha256(convert_to('cert-' || p, 'UTF8')) $$;
CREATE FUNCTION pg_temp.ak() RETURNS bytea LANGUAGE sql IMMUTABLE AS
  $$ SELECT '\x04'::bytea || decode(repeat('ab', 64), 'hex') $$;

-- Données (propriétaire) ---------------------------------------------------------------------------------
INSERT INTO party (kind, legal_name) SELECT 'PLATFORM', 'Plateforme (test)'
 WHERE NOT EXISTS (SELECT 1 FROM party WHERE kind = 'PLATFORM');
INSERT INTO party (id, kind, legal_name, country_code) VALUES
 (pg_temp.id('58a001'), 'OPERATOR', 'Prestataire A', 'SN'),
 (pg_temp.id('58a002'), 'OPERATOR', 'Prestataire B', 'CI');
INSERT INTO party (id, kind, operator_id, legal_name) VALUES
 (pg_temp.id('58b001'), 'ORGANIZER', pg_temp.id('58a001'), 'Organisateur A'),
 (pg_temp.id('58b011'), 'ORGANIZER', pg_temp.id('58a002'), 'Organisateur B');
INSERT INTO jurisdiction_profile (id, country_code, version, valid_from, breakage_destination)
VALUES (pg_temp.id('58c001'), 'SN', 580058, '2026-01-01', 'ORGANIZER');
INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone, jurisdiction_id, funds_holder, status)
SELECT pg_temp.id(e), pg_temp.id(o), pg_temp.id(g), 'Evénement ' || e, 'XOF', 'Africa/Dakar',
       pg_temp.id('58c001'), 'ORGANIZER', 'LIVE'::event_status
  FROM (VALUES ('58d001','58a001','58b001'), ('58d002','58a001','58b001'), ('58d003','58a001','58b001'),
               ('58d004','58a001','58b001'), ('58d011','58a002','58b011')) AS v(e, o, g);
SELECT pg_temp.a();
SELECT open_event_ledger(pg_temp.id(e)) FROM (VALUES ('58d001'), ('58d002'), ('58d003'), ('58d004')) AS v(e);

-- 1. Non-régression du kit : insertions à cinq colonnes, deux PRIMARY du même événement ---------------------
SELECT lives_ok($$INSERT INTO edge_gateway (id, operator_id, event_id, serial, role) VALUES
   (pg_temp.id('58e001'), pg_temp.id('58a001'), pg_temp.id('58d004'), 'KIT-1', 'PRIMARY'),
   (pg_temp.id('58e002'), pg_temp.id('58a001'), pg_temp.id('58d004'), 'KIT-2', 'PRIMARY')$$,
  'le kit insère deux PRIMARY du même événement avec cinq colonnes');
SELECT is((SELECT reference_applied_seq FROM edge_gateway WHERE id = pg_temp.id('58e001')), 0::bigint,
  'reference_applied_seq vaut 0 par défaut');

-- 2. REVOKED terminal, revoked_at posé par le déclencheur, DELETE refusé -----------------------------------
SELECT lives_ok($$UPDATE edge_gateway SET status = 'REVOKED' WHERE id = pg_temp.id('58e001')$$,
  'UPDATE status = REVOKED sans revoked_at (comme force_central_authority) : accepté');
SELECT isnt((SELECT revoked_at FROM edge_gateway WHERE id = pg_temp.id('58e001')), NULL::timestamptz,
  'revoked_at posé par le déclencheur');
SELECT throws_ok($$UPDATE edge_gateway SET status = 'ACTIVE' WHERE id = pg_temp.id('58e001')$$, 'CL001', NULL,
  'retour hors de REVOKED refusé');
SELECT throws_ok($$UPDATE edge_gateway SET status = 'ISOLATED' WHERE id = pg_temp.id('58e001')$$, 'CL001', NULL,
  'REVOKED vers ISOLATED refusé');
SELECT throws_ok($$DELETE FROM edge_gateway WHERE id = pg_temp.id('58e002')$$, NULL, NULL, 'DELETE refusé');
SELECT lives_ok($$UPDATE edge_gateway SET status = 'ISOLATED' WHERE id = pg_temp.id('58e002')$$,
  'transition hors REVOKED inchangée');

-- 3. register_edge_gateway -------------------------------------------------------------------------------------
SELECT pg_temp.a();
CREATE TABLE pg_temp.r (k text PRIMARY KEY, v uuid);
INSERT INTO pg_temp.r SELECT 'p1', register_edge_gateway(pg_temp.id('58a001'), pg_temp.id('58d001'), 'GW-P1',
  'PRIMARY', pg_temp.fp(1), pg_temp.ak(), pg_temp.ak(), 'https://gw1.lan', 'Awa (outil)');
SELECT ok((SELECT v FROM pg_temp.r WHERE k = 'p1') IS NOT NULL, 'register renvoie l''identifiant');
SELECT is((SELECT status || '/' || role FROM edge_gateway WHERE id = (SELECT v FROM pg_temp.r WHERE k = 'p1')),
  'ACTIVE/PRIMARY', 'inscrite ACTIVE');
SELECT isnt((SELECT role_changed_at FROM edge_gateway WHERE id = (SELECT v FROM pg_temp.r WHERE k = 'p1')),
  NULL::timestamptz, 'role_changed_at posé');
SELECT is((SELECT registered_by_label FROM edge_gateway WHERE id = (SELECT v FROM pg_temp.r WHERE k = 'p1')),
  'Awa (outil)', 'libellé enregistré');
SELECT is((SELECT count(*)::int FROM audit_log WHERE action = 'EDGE_GATEWAY_REGISTERED'
            AND object_id = (SELECT v::text FROM pg_temp.r WHERE k = 'p1') AND after->>'alert' = 'EDGE_REGISTERED'
            AND after->>'label' = 'Awa (outil)'), 1, 'audit d''inscription avec alerte EDGE_REGISTERED et libellé');
SELECT ok(NOT (SELECT after::text FROM audit_log WHERE action = 'EDGE_GATEWAY_REGISTERED'
                AND object_id = (SELECT v::text FROM pg_temp.r WHERE k = 'p1') ) LIKE '%' || encode(pg_temp.fp(1), 'hex') || '%',
  'l''audit ne porte pas l''empreinte complète');
SELECT ok(EXISTS (SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND pid = pg_backend_pid()),
  'le verrou consultatif de l''événement est pris dans la transaction');
SELECT ok((SELECT prosrc FROM pg_proc WHERE proname = 'edge_admin_audit') LIKE '%pg_notify(''edge_alert''%',
  'l''alerte passe par pg_notify(edge_alert)');
SELECT throws_ok($$SELECT register_edge_gateway(pg_temp.id('58a001'), pg_temp.id('58d001'), 'GW-P2', 'PRIMARY',
   pg_temp.fp(2), pg_temp.ak(), pg_temp.ak(), NULL, 'x')$$, '23505', NULL, 'second PRIMARY non révoqué refusé');
SELECT lives_ok($$SELECT register_edge_gateway(pg_temp.id('58a001'), pg_temp.id('58d001'), 'GW-S1', 'STANDBY',
   pg_temp.fp(3), pg_temp.ak(), pg_temp.ak(), NULL, 'x')$$, 'une STANDBY est admise');
SELECT throws_ok($$SELECT register_edge_gateway(pg_temp.id('58a001'), pg_temp.id('58d002'), 'GW-X', 'PRIMARY',
   substring(pg_temp.fp(9) FROM 1 FOR 31), pg_temp.ak(), pg_temp.ak(), NULL, 'x')$$, 'CL001', NULL,
  'empreinte de 31 octets refusée');
SELECT throws_ok($$SELECT register_edge_gateway(pg_temp.id('58a001'), pg_temp.id('58d002'), 'GW-X', 'PRIMARY',
   pg_temp.fp(9), pg_temp.ak(), substring(pg_temp.ak() FROM 1 FOR 64), NULL, 'x')$$, 'CL001', NULL,
  'clé d''accord de 64 octets refusée');
SELECT throws_ok($$SELECT register_edge_gateway(pg_temp.id('58a001'), pg_temp.id('58d002'), 'GW-X', 'PRIMARY',
   pg_temp.fp(9), pg_temp.ak(), pg_temp.ak(), NULL, '  ')$$, 'CL001', NULL, 'libellé vide refusé');
SELECT throws_ok($$SELECT register_edge_gateway(pg_temp.id('58a001'), pg_temp.id('58d002'), 'GW-X', 'ADMIN',
   pg_temp.fp(9), pg_temp.ak(), pg_temp.ak(), NULL, 'x')$$, 'CL001', NULL, 'rôle inconnu refusé');
SELECT throws_ok($$SELECT register_edge_gateway(pg_temp.id('58a001'), pg_temp.id('58d011'), 'GW-X', 'PRIMARY',
   pg_temp.fp(9), pg_temp.ak(), pg_temp.ak(), NULL, 'x')$$, 'P0002', NULL,
  'événement d''un autre prestataire : no_data_found');
SELECT throws_ok($$SELECT register_edge_gateway(pg_temp.id('58a002'), pg_temp.id('58d011'), 'GW-X', 'PRIMARY',
   pg_temp.fp(9), pg_temp.ak(), pg_temp.ak(), NULL, 'x')$$, 'P0002', NULL,
  'prestataire différent de la session : no_data_found');
SELECT throws_ok($$SELECT register_edge_gateway(pg_temp.id('58a001'), pg_temp.id('58d002'), 'GW-P1', 'PRIMARY',
   pg_temp.fp(9), pg_temp.ak(), pg_temp.ak(), NULL, 'x')$$, '23505', NULL, 'numéro de série dupliqué refusé');
SELECT throws_ok($$SELECT register_edge_gateway(pg_temp.id('58a001'), pg_temp.id('58d002'), 'GW-X', 'PRIMARY',
   pg_temp.fp(1), pg_temp.ak(), pg_temp.ak(), NULL, 'x')$$, '23505', NULL,
  'UNIQUE (cert_sha256) hors REVOKED : empreinte déjà prise refusée');

-- 4. identify / touch ------------------------------------------------------------------------------------------
SELECT is((SELECT gateway_id FROM identify_edge_gateway(pg_temp.fp(1))), (SELECT v FROM pg_temp.r WHERE k = 'p1'),
  'identify retrouve la passerelle par empreinte');
SELECT is((SELECT ledger_id FROM identify_edge_gateway(pg_temp.fp(1))),
  (SELECT id FROM ledger WHERE scope_type = 'EVENT' AND scope_id = pg_temp.id('58d001')),
  'identify résout le grand livre de l''événement');
SELECT is((SELECT count(*)::int FROM (SELECT * FROM identify_edge_gateway(pg_temp.fp(1))) t), 1, 'une seule ligne');
-- même erreur, même message : inconnue, REVOKED, mauvaise longueur, NULL
CREATE TABLE pg_temp.errs (k text, st text, msg text);
DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT * FROM (VALUES ('unknown', pg_temp.fp(99)), ('revoked', NULL::bytea),
                          ('short', '\x0102'::bytea), ('null', NULL::bytea)) v(k, fp) LOOP
    BEGIN
      PERFORM * FROM identify_edge_gateway(CASE c.k WHEN 'revoked' THEN (SELECT cert_sha256 FROM edge_gateway
                                                    WHERE id = pg_temp.id('58e001')) ELSE c.fp END);
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO pg_temp.errs VALUES (c.k, SQLSTATE, SQLERRM);
    END;
  END LOOP;
END $$;
-- la passerelle de kit 58e001 n'a pas d'empreinte : on en pose une avant de la révoquer pour le vrai test
SELECT is((SELECT count(DISTINCT st || msg)::int FROM pg_temp.errs), 1, 'inconnue, courte, NULL : même erreur et même message');
SELECT is((SELECT st FROM pg_temp.errs LIMIT 1), 'P0002', 'erreur no_data_found');
UPDATE edge_gateway SET cert_sha256 = pg_temp.fp(50) WHERE id = pg_temp.id('58e001');
DO $$
BEGIN
  PERFORM * FROM identify_edge_gateway(pg_temp.fp(50));
EXCEPTION WHEN OTHERS THEN
  INSERT INTO pg_temp.errs VALUES ('revoked-real', SQLSTATE, SQLERRM);
END $$;
SELECT is((SELECT count(DISTINCT st || msg)::int FROM pg_temp.errs), 1,
  'passerelle REVOKED : même erreur et même message que l''inconnue');
SELECT is((SELECT count(*)::int FROM pg_temp.errs WHERE k = 'revoked-real'), 1, 'la REVOKED est bien refusée');

UPDATE edge_gateway SET status = 'ISOLATED' WHERE id = (SELECT v FROM pg_temp.r WHERE k = 'p1');
SELECT touch_edge_gateway((SELECT v FROM pg_temp.r WHERE k = 'p1'));
SELECT is((SELECT status FROM edge_gateway WHERE id = (SELECT v FROM pg_temp.r WHERE k = 'p1')), 'CATCHING_UP',
  'touch : ISOLATED devient CATCHING_UP');
SELECT isnt((SELECT last_seen_at FROM edge_gateway WHERE id = (SELECT v FROM pg_temp.r WHERE k = 'p1')),
  NULL::timestamptz, 'touch pose last_seen_at');
SELECT touch_edge_gateway((SELECT v FROM pg_temp.r WHERE k = 'p1'));
SELECT is((SELECT status FROM edge_gateway WHERE id = (SELECT v FROM pg_temp.r WHERE k = 'p1')), 'CATCHING_UP',
  'touch ne change pas CATCHING_UP');
SELECT touch_edge_gateway(pg_temp.id('58e001'));
SELECT is((SELECT status || '/' || (last_seen_at IS NULL)::text FROM edge_gateway WHERE id = pg_temp.id('58e001')),
  'REVOKED/true', 'touch ne touche pas une REVOKED');
SELECT lives_ok($$SELECT touch_edge_gateway(pg_temp.id('58ffff'))$$, 'touch d''une inconnue : sans erreur');
SELECT pg_temp.b();
SELECT throws_ok($$SELECT touch_edge_gateway((SELECT v FROM pg_temp.r WHERE k = 'p1'))$$, 'P0002', NULL,
  'touch avec un contexte d''un autre prestataire : refusé');
SELECT pg_temp.a();
UPDATE edge_gateway SET status = 'ACTIVE' WHERE id = (SELECT v FROM pg_temp.r WHERE k = 'p1');

-- 5. rotate ----------------------------------------------------------------------------------------------------
SELECT lives_ok($$SELECT rotate_edge_gateway_cert((SELECT v FROM pg_temp.r WHERE k = 'p1'), pg_temp.fp(11), 'Awa')$$,
  'rotate accepté');
SELECT is((SELECT count(*)::int FROM identify_edge_gateway(pg_temp.fp(11))), 1, 'la nouvelle empreinte identifie');
SELECT throws_ok($$SELECT * FROM identify_edge_gateway(pg_temp.fp(1))$$, 'P0002', NULL,
  'l''ancienne empreinte est refusée aussitôt');
SELECT is((SELECT count(*)::int FROM audit_log WHERE action = 'EDGE_CERT_ROTATED'), 1, 'audit de rotation');
SELECT throws_ok($$SELECT rotate_edge_gateway_cert((SELECT v FROM pg_temp.r WHERE k = 'p1'), pg_temp.fp(12), '')$$,
  'CL001', NULL, 'rotate sans libellé refusé');
SELECT throws_ok($$SELECT rotate_edge_gateway_cert((SELECT v FROM pg_temp.r WHERE k = 'p1'), '\x01'::bytea, 'Awa')$$,
  'CL001', NULL, 'rotate avec une mauvaise longueur refusé');
SELECT throws_ok($$SELECT rotate_edge_gateway_cert(pg_temp.id('58e001'), pg_temp.fp(13), 'Awa')$$, 'CL001', NULL,
  'rotate d''une REVOKED refusé');

-- 6. swap / set_role --------------------------------------------------------------------------------------------
INSERT INTO pg_temp.r SELECT 's1', id FROM edge_gateway WHERE serial = 'GW-S1';
SELECT lives_ok($$SELECT swap_edge_gateway_roles((SELECT v FROM pg_temp.r WHERE k = 'p1'),
   (SELECT v FROM pg_temp.r WHERE k = 's1'), 'Awa')$$, 'swap accepté');
SELECT is((SELECT string_agg(serial || ':' || role, ',' ORDER BY serial) FROM edge_gateway
            WHERE event_id = pg_temp.id('58d001')), 'GW-P1:STANDBY,GW-S1:PRIMARY', 'rôles échangés');
SELECT is((SELECT count(*)::int FROM edge_gateway WHERE event_id = pg_temp.id('58d001') AND role = 'PRIMARY'
            AND status <> 'REVOKED'), 1, 'jamais deux PRIMARY, jamais zéro');
SELECT is((SELECT count(*)::int FROM audit_log WHERE action = 'EDGE_GATEWAY_ROLE_CHANGED'
            AND after->>'alert' = 'EDGE_ROLE_CHANGED'), 1, 'audit et alerte du changement de rôle');
SELECT throws_ok($$SELECT swap_edge_gateway_roles((SELECT v FROM pg_temp.r WHERE k = 'p1'),
   (SELECT v FROM pg_temp.r WHERE k = 's1'), 'Awa')$$, 'CL001', NULL, 'swap dans le mauvais sens refusé');
INSERT INTO pg_temp.r SELECT 'o2', register_edge_gateway(pg_temp.id('58a001'), pg_temp.id('58d002'), 'GW-O2',
  'STANDBY', pg_temp.fp(21), pg_temp.ak(), pg_temp.ak(), NULL, 'Awa');
SELECT throws_ok($$SELECT swap_edge_gateway_roles((SELECT v FROM pg_temp.r WHERE k = 's1'),
   (SELECT v FROM pg_temp.r WHERE k = 'o2'), 'Awa')$$, 'CL001', NULL, 'swap entre deux événements refusé');
SELECT throws_ok($$SELECT swap_edge_gateway_roles((SELECT v FROM pg_temp.r WHERE k = 's1'),
   (SELECT v FROM pg_temp.r WHERE k = 'p1'), '')$$, 'CL001', NULL, 'swap sans libellé refusé');
SELECT throws_ok($$SELECT set_edge_gateway_role((SELECT v FROM pg_temp.r WHERE k = 'p1'), 'PRIMARY', 'Awa')$$,
  '23505', NULL, 'set_role refuse de créer un second PRIMARY');
SELECT lives_ok($$SELECT set_edge_gateway_role((SELECT v FROM pg_temp.r WHERE k = 's1'), 'STANDBY', 'Awa')$$,
  'set_role : PRIMARY vers STANDBY');
SELECT lives_ok($$SELECT set_edge_gateway_role((SELECT v FROM pg_temp.r WHERE k = 'p1'), 'PRIMARY', 'Awa')$$,
  'set_role : STANDBY vers PRIMARY quand il n''y en a plus');

-- handover ouvert pour l'événement 58d001
INSERT INTO debit_authority_handover (operator_id, ledger_id, edge_gateway_id, direction, status, epoch,
                                      watermark_posting_id, requested_by)
SELECT pg_temp.id('58a001'), l.id, (SELECT v FROM pg_temp.r WHERE k = 'p1'), 'TO_EDGE', 'GRANTED', 1, 0,
       pg_temp.id('58f001')
  FROM ledger l WHERE l.scope_type = 'EVENT' AND l.scope_id = pg_temp.id('58d001');
SELECT throws_ok($$SELECT revoke_edge_gateway((SELECT v FROM pg_temp.r WHERE k = 'p1'), 'perdue', 'Awa')$$,
  'CL013', NULL, 'revoke refusée avec un handover ouvert');
SELECT throws_ok($$SELECT swap_edge_gateway_roles((SELECT v FROM pg_temp.r WHERE k = 'p1'),
   (SELECT v FROM pg_temp.r WHERE k = 's1'), 'Awa')$$, 'CL013', NULL, 'swap refusé avec un handover ouvert');
SELECT throws_ok($$SELECT set_edge_gateway_role((SELECT v FROM pg_temp.r WHERE k = 's1'), 'PRIMARY', 'Awa')$$,
  'CL013', NULL, 'set_role refusée avec un handover ouvert');
SELECT throws_ok($$SELECT set_edge_gateway_role((SELECT v FROM pg_temp.r WHERE k = 's1'), 'STANDBY', 'Awa')$$,
  'CL013', NULL, 'set_role (même sans effet) refusée avec un handover ouvert');
-- swap avec handover : remet p1 STANDBY et s1 PRIMARY pour tester le bon sens
UPDATE debit_authority_handover SET status = 'FAILED' WHERE edge_gateway_id = (SELECT v FROM pg_temp.r WHERE k = 'p1');
SELECT swap_edge_gateway_roles((SELECT v FROM pg_temp.r WHERE k = 'p1'), (SELECT v FROM pg_temp.r WHERE k = 's1'), 'Awa');
INSERT INTO debit_authority_handover (operator_id, ledger_id, edge_gateway_id, direction, status, epoch,
                                      watermark_posting_id, requested_by)
SELECT pg_temp.id('58a001'), l.id, (SELECT v FROM pg_temp.r WHERE k = 'p1'), 'TO_EDGE', 'GRANTED', 2, 0,
       pg_temp.id('58f001')
  FROM ledger l WHERE l.scope_type = 'EVENT' AND l.scope_id = pg_temp.id('58d001');
SELECT throws_ok($$SELECT swap_edge_gateway_roles((SELECT v FROM pg_temp.r WHERE k = 's1'),
   (SELECT v FROM pg_temp.r WHERE k = 'p1'), 'Awa')$$, 'CL013', NULL, 'swap refusé avec un handover ouvert');
UPDATE debit_authority_handover SET status = 'FAILED' WHERE edge_gateway_id = (SELECT v FROM pg_temp.r WHERE k = 'p1') AND status = 'GRANTED';

-- 7. revoke --------------------------------------------------------------------------------------------------
SELECT lives_ok($$SELECT revoke_edge_gateway((SELECT v FROM pg_temp.r WHERE k = 'p1'), 'perdue', 'Awa')$$,
  'revoke accepté sans handover ouvert');
SELECT is((SELECT status || '/' || revoke_reason || '/' || (revoked_at IS NOT NULL)::text FROM edge_gateway
            WHERE id = (SELECT v FROM pg_temp.r WHERE k = 'p1')), 'REVOKED/perdue/true', 'REVOKED, motif, date');
SELECT lives_ok($$SELECT revoke_edge_gateway((SELECT v FROM pg_temp.r WHERE k = 'p1'), 'autre', 'Awa')$$,
  'revoke idempotente');
SELECT is((SELECT count(*)::int FROM audit_log WHERE action = 'EDGE_GATEWAY_REVOKED'), 1, 'un seul audit de révocation');
SELECT throws_ok($$SELECT revoke_edge_gateway((SELECT v FROM pg_temp.r WHERE k = 's1'), '', 'Awa')$$, 'CL001', NULL,
  'revoke sans motif refusée');
SELECT lives_ok($$SELECT register_edge_gateway(pg_temp.id('58a001'), pg_temp.id('58d003'), 'GW-REUSE', 'PRIMARY',
   pg_temp.fp(11), pg_temp.ak(), pg_temp.ak(), NULL, 'Awa')$$,
  'une empreinte libérée par révocation peut être réinscrite');
SELECT pg_temp.b();
SELECT throws_ok($$SELECT revoke_edge_gateway((SELECT v FROM pg_temp.r WHERE k = 's1'), 'x', 'Awa')$$, 'P0002', NULL,
  'revoke d''une passerelle d''un autre prestataire : refusée');
SELECT pg_temp.a();

-- 8. Clé de snapshot -----------------------------------------------------------------------------------------
SELECT lives_ok($$SELECT edge_register_snapshot_key((SELECT v FROM pg_temp.r WHERE k = 's1'), 'edge-k1', pg_temp.ak(), 'Awa')$$,
  'edge_register_snapshot_key accepté');
SELECT is((SELECT owner || '/' || status FROM snapshot_signing_key WHERE key_id = 'edge-k1'), 'EDGE/ACTIVE',
  'clé EDGE ACTIVE enregistrée');
SELECT throws_ok($$SELECT edge_register_snapshot_key((SELECT v FROM pg_temp.r WHERE k = 's1'), 'edge-k2', pg_temp.ak(), 'Awa')$$,
  '23505', NULL, 'une seconde clé ACTIVE n''est pas substituée en silence');
SELECT throws_ok($$SELECT edge_register_snapshot_key((SELECT v FROM pg_temp.r WHERE k = 's1'), 'edge-k3', pg_temp.ak(), '')$$,
  'CL001', NULL, 'clé de snapshot sans libellé refusée');

-- 9. edge_reference_change -----------------------------------------------------------------------------------
-- Le journal ne porte que les lignes d'amorce EVENT (une par grand livre neuf, 0063), rien d'autre.
SELECT is((SELECT count(*)::int FROM edge_reference_change WHERE entity_kind <> 'EVENT' OR change_seq <> 1), 0,
  'edge_reference_change créée, ne porte que les lignes d''amorce EVENT');
SELECT is((SELECT relrowsecurity::text || relforcerowsecurity::text FROM pg_class WHERE relname = 'edge_reference_change'),
  'truetrue', 'edge_reference_change : RLS activée et forcée');

-- 10. Propriétés des fonctions --------------------------------------------------------------------------------
SELECT is((SELECT count(*)::int FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
            AND p.proname IN ('identify_edge_gateway','touch_edge_gateway','register_edge_gateway','revoke_edge_gateway',
              'rotate_edge_gateway_cert','swap_edge_gateway_roles','set_edge_gateway_role','edge_register_snapshot_key',
              'edge_event_lock','edge_event_handover_open','edge_admin_audit')), 11, 'onze fonctions');
SELECT is((SELECT count(*)::int FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
            AND p.proname IN ('identify_edge_gateway','touch_edge_gateway','register_edge_gateway','revoke_edge_gateway',
              'rotate_edge_gateway_cert','swap_edge_gateway_roles','set_edge_gateway_role','edge_register_snapshot_key',
              'edge_event_lock','edge_event_handover_open','edge_admin_audit')
            AND (NOT p.prosecdef OR NOT coalesce(p.proconfig::text LIKE '%search_path=public, pg_temp%', false))),
  0, 'toutes SECURITY DEFINER avec search_path = public, pg_temp');
SELECT is((SELECT count(*)::int FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
            AND p.proname IN ('identify_edge_gateway','touch_edge_gateway','register_edge_gateway','revoke_edge_gateway',
              'rotate_edge_gateway_cert','swap_edge_gateway_roles','set_edge_gateway_role','edge_register_snapshot_key',
              'edge_event_lock','edge_event_handover_open','edge_admin_audit')
            AND has_function_privilege('public', p.oid, 'EXECUTE')),
  0, 'aucune exécutable par PUBLIC');
SELECT is((SELECT count(*)::int FROM pg_roles WHERE rolname IN ('cashless_edge','cashless_edgeadmin')), 2,
  'les deux rôles existent');
SELECT is((SELECT count(*)::int FROM pg_roles WHERE rolname IN ('cashless_edge','cashless_edgeadmin')
            AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolbypassrls OR rolinherit OR NOT rolcanlogin)), 0,
  'rôles LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT');

SELECT * FROM finish();
ROLLBACK;
