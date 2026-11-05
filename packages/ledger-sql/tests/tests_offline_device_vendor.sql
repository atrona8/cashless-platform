-- Terminal, vendeur et configuration datés (migration 0048 ; mission hors-ligne-snapshots-lots, lot WP07 ;
-- FR-003, FR-005, FR-011, FR-012, FR-039 ; research R-30.3, R-30.4) — pgTAP, écrit à la main. Sous le
-- PROPRIÉTAIRE seulement : aucun SET ROLE (les droits sont posés et testés par le lot WP08).
-- Lancer : pg_prove -d <base> tests/tests_offline_device_vendor.sql (base créée par les migrations).
-- `offline_snapshot_key` vient de 0045 (WP04) ; si la table manque, la suite pose un équivalent (annulé par le
-- ROLLBACK) pour ne pas dépendre de l'ordre des lots.
\set ON_ERROR_STOP 1
\set QUIET 1
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

CREATE FUNCTION pg_temp.id(p text) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT ('00000000-0000-0000-0000-' || lpad(p, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.a() RETURNS void LANGUAGE sql AS
  $$ SELECT set_config('app.operator_id', pg_temp.id('48a001')::text, true) $$;
CREATE FUNCTION pg_temp.b() RETURNS void LANGUAGE sql AS
  $$ SELECT set_config('app.operator_id', pg_temp.id('48a002')::text, true) $$;
CREATE FUNCTION pg_temp.t0() RETURNS timestamptz LANGUAGE sql IMMUTABLE AS
  $$ SELECT '2026-06-01 12:00:00+00'::timestamptz $$;

CREATE TABLE IF NOT EXISTS offline_snapshot_key (
  ledger_id uuid NOT NULL, version bigint NOT NULL, device_id uuid NOT NULL REFERENCES device(id),
  agreement_key_sha256 bytea NOT NULL, operator_id uuid NOT NULL REFERENCES party(id),
  envelope jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (ledger_id, version, device_id, agreement_key_sha256));

-- Données (propriétaire) --------------------------------------------------------------------------------
INSERT INTO party (kind, legal_name) SELECT 'PLATFORM', 'Plateforme (test)'
 WHERE NOT EXISTS (SELECT 1 FROM party WHERE kind = 'PLATFORM');
INSERT INTO party (id, kind, legal_name, country_code) VALUES
 (pg_temp.id('48a001'), 'OPERATOR', 'Prestataire A', 'SN'),
 (pg_temp.id('48a002'), 'OPERATOR', 'Prestataire B', 'CI');
INSERT INTO party (id, kind, operator_id, legal_name) VALUES
 (pg_temp.id('48b001'), 'ORGANIZER', pg_temp.id('48a001'), 'Organisateur A'),
 (pg_temp.id('48b011'), 'ORGANIZER', pg_temp.id('48a002'), 'Organisateur B'),
 (pg_temp.id('48b101'), 'MERCHANT', pg_temp.id('48a001'), 'Commerçant A'),
 (pg_temp.id('48b111'), 'MERCHANT', pg_temp.id('48a002'), 'Commerçant B');
INSERT INTO jurisdiction_profile (id, country_code, version, valid_from, breakage_destination)
VALUES (pg_temp.id('48c001'), 'SN', 480048, '2026-01-01', 'ORGANIZER');
INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone, jurisdiction_id, funds_holder)
SELECT pg_temp.id(e), pg_temp.id(o), pg_temp.id(g), 'Événement ' || e, 'XOF', 'Africa/Dakar',
       pg_temp.id('48c001'), 'ORGANIZER'
  FROM (VALUES ('48d001','48a001','48b001'), ('48d011','48a002','48b011')) AS v(e, o, g);
INSERT INTO ledger (id, operator_id, scope_type, scope_id, currency, issuer_id, funds_holder_id) VALUES
 (pg_temp.id('48f001'), pg_temp.id('48a001'), 'EVENT', pg_temp.id('48d001'), 'XOF', pg_temp.id('48b001'), pg_temp.id('48b001')),
 (pg_temp.id('48f011'), pg_temp.id('48a002'), 'EVENT', pg_temp.id('48d011'), 'XOF', pg_temp.id('48b011'), pg_temp.id('48b011'));
-- Terminaux de A : aa01, aa02, aa03 (révoqué), aa05 (exposition) ; B : ab01
INSERT INTO device (id, operator_id, kind, event_id, serial, status)
SELECT pg_temp.id('48' || n), pg_temp.id('48a001'), 'POS', pg_temp.id('48d001'), 'D48-' || n, s
  FROM (VALUES ('aa01','ACTIVE'), ('aa02','ACTIVE'), ('aa03','REVOKED'), ('aa05','ACTIVE')) AS v(n, s);
INSERT INTO device (id, operator_id, kind, event_id, serial)
VALUES (pg_temp.id('48ab01'), pg_temp.id('48a002'), 'POS', pg_temp.id('48d011'), 'D48-AB01');
INSERT INTO app_user (id, operator_id, issuer, subject, email, display_name, status)
SELECT pg_temp.id(u), pg_temp.id(o), 'https://idp.test', 's0048' || u, u || '@test', 'Personne ' || u, st
  FROM (VALUES ('48e001','48a001','ACTIVE'), ('48e002','48a001','ACTIVE'), ('48e003','48a001','ACTIVE'),
               ('48e011','48a002','ACTIVE')) AS v(u, o, st);
INSERT INTO role_assignment (user_id, role, scope_type, scope_id, granted_by) VALUES
 (pg_temp.id('48e001'), 'OPERATOR_ADMIN', 'OPERATOR', pg_temp.id('48a001'), NULL),
 (pg_temp.id('48e002'), 'OPERATOR_ADMIN', 'OPERATOR', pg_temp.id('48a001'), NULL),
 (pg_temp.id('48e011'), 'OPERATOR_ADMIN', 'OPERATOR', pg_temp.id('48a002'), NULL);
UPDATE app_user SET status = 'DISABLED', disabled_at = now() WHERE id = pg_temp.id('48e002');
INSERT INTO snapshot_signing_key (key_id, operator_id, owner, algorithm, public_key, kms_key_ref, status)
VALUES ('k48-a', pg_temp.id('48a001'), 'CENTRAL', 'ECDSA_P256_SHA256', '\x01', 'test:k48-a', 'ACTIVE'),
       ('k48-b', pg_temp.id('48a002'), 'CENTRAL', 'ECDSA_P256_SHA256', '\x02', 'test:k48-b', 'ACTIVE');
-- Snapshots : A v1 FULL, v2 et v3 DELTA ; B v1 FULL (écriture directe du propriétaire)
ALTER TABLE offline_snapshot DISABLE TRIGGER offline_snapshot_check;
INSERT INTO offline_snapshot (operator_id, ledger_id, event_id, kind, version, base_version, generated_at,
                              valid_until, entries, content_sha256, authority_epoch, key_id, header, signature,
                              content_key_wrapped)
SELECT pg_temp.id(o), pg_temp.id(l), pg_temp.id(e), CASE WHEN v = 1 THEN 'FULL' ELSE 'DELTA' END, v,
       CASE WHEN v = 1 THEN NULL ELSE v - 1 END, pg_temp.t0() + v * interval '1 hour',
       pg_temp.t0() + v * interval '1 hour' + interval '3 hours', 0, sha256(convert_to(s, 'UTF8')), 1, k,
       '{}'::jsonb, '\x01', '\x01'
  FROM (VALUES ('48a001','48f001','48d001',1,'s1','k48-a'), ('48a001','48f001','48d001',2,'s2','k48-a'),
               ('48a001','48f001','48d001',3,'s3','k48-a'), ('48a002','48f011','48d011',1,'b1','k48-b'))
       AS x(o, l, e, v, s, k);
ALTER TABLE offline_snapshot ENABLE TRIGGER offline_snapshot_check;
-- Enveloppes : aa01 v1 à v3 ; aa02 v1 seulement ; aa03 v1 ; ab01 v1 de B
INSERT INTO offline_snapshot_key (ledger_id, version, device_id, agreement_key_sha256, operator_id, envelope)
SELECT pg_temp.id(l), v, pg_temp.id(d), sha256('k'), pg_temp.id(o),
       '{"alg":"ECDH-ES+HKDF-SHA256+A256GCM","epk":"e","iv":"i","wrapped_key":"w"}'::jsonb
  FROM (VALUES ('48f001',1,'48aa01','48a001'), ('48f001',2,'48aa01','48a001'), ('48f001',3,'48aa01','48a001'),
               ('48f001',1,'48aa02','48a001'), ('48f001',1,'48aa03','48a001'),
               ('48f011',1,'48ab01','48a002')) AS x(l, v, d, o);

-- T028. Accusés ---------------------------------------------------------------------------------------------
SELECT pg_temp.a();
SELECT lives_ok($$SELECT ack_offline_snapshot(pg_temp.id('48aa01'), 3, sha256('s3'))$$, 'accusé v3');
SELECT is((SELECT last_snapshot_version FROM device WHERE id = pg_temp.id('48aa01')), 3::bigint,
  'last_snapshot_version = 3');
CREATE TEMP TABLE first_ack AS SELECT acked_at FROM offline_snapshot_ack
 WHERE device_id = pg_temp.id('48aa01') AND version = 3;
SELECT lives_ok($$SELECT ack_offline_snapshot(pg_temp.id('48aa01'), 2, sha256('s2'))$$, 'accusé v2 plus ancien');
SELECT is((SELECT count(*)::int FROM offline_snapshot_ack WHERE device_id = pg_temp.id('48aa01') AND version = 2),
  1, 'la ligne v2 est inscrite');
SELECT is((SELECT last_snapshot_version FROM device WHERE id = pg_temp.id('48aa01')), 3::bigint,
  'jamais de recul : le maximum reste 3');
SELECT lives_ok($$SELECT ack_offline_snapshot(pg_temp.id('48aa01'), 3, sha256('s3'))$$, 'accusé v3 répété');
SELECT is((SELECT acked_at FROM offline_snapshot_ack WHERE device_id = pg_temp.id('48aa01') AND version = 3),
  (SELECT acked_at FROM first_ack), 'acked_at du premier accusé inchangé');
SELECT throws_ok($$SELECT ack_offline_snapshot(pg_temp.id('48aa01'), 1, sha256('faux'))$$, 'CL049', NULL,
  'empreinte fausse : CL049');
SELECT throws_ok($$SELECT ack_offline_snapshot(pg_temp.id('48aa01'), 1, substr(sha256('s1'), 1, 16))$$, 'CL049',
  NULL, 'empreinte tronquée : CL049');
SELECT throws_ok($$SELECT ack_offline_snapshot(pg_temp.id('48aa01'), 1, NULL)$$, 'CL049', NULL,
  'empreinte nulle : CL049');
SELECT is((SELECT count(*)::int FROM offline_snapshot_ack WHERE device_id = pg_temp.id('48aa01') AND version = 1),
  0, 'refus sans écriture');
SELECT throws_ok($$SELECT ack_offline_snapshot(pg_temp.id('48aa01'), 9, sha256('s1'))$$, 'CL049', NULL,
  'version inconnue : CL049');
SELECT throws_ok($$SELECT ack_offline_snapshot(pg_temp.id('48aa02'), 3, sha256('s3'))$$, 'CL049', NULL,
  'version sans enveloppe pour ce terminal : CL049');
SELECT throws_ok($$SELECT ack_offline_snapshot(pg_temp.id('48aa01'), 1, sha256('b1'))$$, 'CL049', NULL,
  'version d''un autre prestataire : CL049');
SELECT throws_ok($$SELECT ack_offline_snapshot(pg_temp.id('48ab01'), 1, sha256('b1'))$$, 'P0002', NULL,
  'terminal d''un autre prestataire : introuvable');
SELECT throws_ok($$SELECT ack_offline_snapshot(pg_temp.id('48aa03'), 1, sha256('s1'))$$, '42501', NULL,
  'terminal révoqué : refusé');
SELECT throws_ok($$UPDATE offline_snapshot_ack SET acked_at = now()$$, NULL, NULL, 'accusés en ajout seul : UPDATE');
SELECT throws_ok($$DELETE FROM offline_snapshot_ack$$, NULL, NULL, 'accusés en ajout seul : DELETE');
-- ack_floor : accusés de aa02 posés à des heures connues
INSERT INTO offline_snapshot_ack (device_id, version, operator_id, ledger_id, acked_at) VALUES
 (pg_temp.id('48aa02'), 1, pg_temp.id('48a001'), pg_temp.id('48f001'), pg_temp.t0() + interval '10 hours'),
 (pg_temp.id('48aa02'), 3, pg_temp.id('48a001'), pg_temp.id('48f001'), pg_temp.t0() + interval '11 hours');
SELECT is(offline_snapshot_ack_floor(pg_temp.id('48aa02'), pg_temp.t0() + interval '10 hours' - interval '1 second'),
  0::bigint, 'ack_floor à -1 s du premier accusé : 0');
SELECT is(offline_snapshot_ack_floor(pg_temp.id('48aa02'), pg_temp.t0() + interval '10 hours'), 1::bigint,
  'ack_floor à l''heure exacte : inclus');
SELECT is(offline_snapshot_ack_floor(pg_temp.id('48aa02'), pg_temp.t0() + interval '11 hours' - interval '1 second'),
  1::bigint, 'ack_floor à -1 s du second : 1');
SELECT is(offline_snapshot_ack_floor(pg_temp.id('48aa02'), pg_temp.t0() + interval '11 hours' + interval '1 second'),
  3::bigint, 'ack_floor à +1 s du second : 3');
SELECT throws_ok($$SELECT offline_snapshot_ack_floor(pg_temp.id('48ab01'), now())$$, 'P0002', NULL,
  'ack_floor d''un terminal étranger : introuvable');
-- meta
SELECT is((SELECT generated_at FROM offline_snapshot_meta(pg_temp.id('48f001'), 3, pg_temp.id('48aa01'))),
  pg_temp.t0() + interval '3 hours', 'meta : generated_at');
SELECT is((SELECT valid_until FROM offline_snapshot_meta(pg_temp.id('48f001'), 3, pg_temp.id('48aa01'))),
  pg_temp.t0() + interval '6 hours', 'meta : valid_until');
SELECT ok((SELECT published_at IS NOT NULL FROM offline_snapshot_meta(pg_temp.id('48f001'), 3, pg_temp.id('48aa01'))),
  'meta : published_at posé');
SELECT is((SELECT wrapped_for_device FROM offline_snapshot_meta(pg_temp.id('48f001'), 3, pg_temp.id('48aa01'))),
  true, 'meta : enveloppe pour aa01');
SELECT is((SELECT wrapped_for_device FROM offline_snapshot_meta(pg_temp.id('48f001'), 3, pg_temp.id('48aa02'))),
  false, 'meta : pas d''enveloppe pour aa02');
SELECT is((SELECT wrapped_for_device FROM offline_snapshot_meta(pg_temp.id('48f001'), 3, NULL)), false,
  'meta : terminal nul, faux');
SELECT is((SELECT count(*)::int FROM offline_snapshot_meta(pg_temp.id('48f001'), 9, pg_temp.id('48aa01'))), 0,
  'meta : version inconnue, aucune ligne');
SELECT is((SELECT count(*)::int FROM offline_snapshot_meta(pg_temp.id('48f011'), 1, pg_temp.id('48ab01'))), 0,
  'meta : grand livre d''un autre prestataire, aucune ligne');

-- T029. États datés -----------------------------------------------------------------------------------------
INSERT INTO offline_snapshot_media_log (ledger_id, version, token_hash, media_status, batch_status, batch_event_id,
                                        wallet_status, in_snapshot, operator_id) VALUES
 (pg_temp.id('48f001'), 1, sha256('m1'), 'ACTIVE', 'ACTIVE', pg_temp.id('48d001'), 'ACTIVE', true, pg_temp.id('48a001')),
 (pg_temp.id('48f001'), 3, sha256('m1'), 'SUSPENDED', 'ACTIVE', pg_temp.id('48d001'), 'BLOCKED', true, pg_temp.id('48a001')),
 (pg_temp.id('48f011'), 1, sha256('m1'), 'ACTIVE', NULL, NULL, 'ACTIVE', true, pg_temp.id('48a002'));
SELECT is((SELECT media_status FROM offline_media_state_at(pg_temp.id('48f001'), sha256('m1'), 1)), 'ACTIVE',
  'état à v1');
SELECT is((SELECT media_status FROM offline_media_state_at(pg_temp.id('48f001'), sha256('m1'), 2)), 'ACTIVE',
  'état à v2 : dernière ligne <= 2 (v1)');
SELECT is((SELECT media_status || '/' || wallet_status FROM offline_media_state_at(pg_temp.id('48f001'), sha256('m1'), 3)),
  'SUSPENDED/BLOCKED', 'état à v3');
SELECT is((SELECT count(*)::int FROM offline_media_state_at(pg_temp.id('48f001'), sha256('m1'), 0)), 0,
  'avant toute ligne : aucune');
SELECT is((SELECT count(*)::int FROM offline_media_state_at(pg_temp.id('48f001'), sha256('inconnu'), 3)), 0,
  'bracelet inconnu : aucune');
SELECT is((SELECT count(*)::int FROM offline_media_state_at(pg_temp.id('48f011'), sha256('m1'), 1)), 0,
  'grand livre d''un autre prestataire : aucune');
-- configuration en vigueur
INSERT INTO device_config_served (operator_id, device_id, policy, policy_sha256, authority_epoch, next_seq_floor,
                                  served_at)
SELECT pg_temp.id('48a001'), pg_temp.id(d), jsonb_build_object('m', m), sha256(convert_to(m::text, 'UTF8')), 1, 1, t
  FROM (VALUES ('48aa01', 1, pg_temp.t0()), ('48aa01', 2, pg_temp.t0() + interval '10 seconds'),
               ('48aa02', 3, pg_temp.t0())) AS x(d, m, t);
CREATE FUNCTION pg_temp.cid(p_m int) RETURNS bigint LANGUAGE sql AS
  $$ SELECT id FROM device_config_served WHERE policy = jsonb_build_object('m', p_m) $$;
SELECT is(offline_config_in_force(pg_temp.id('48aa01'), pg_temp.cid(1), pg_temp.t0() + interval '5 seconds', interval '0'),
  '{"m":1}'::jsonb, 'configuration 1 en vigueur à t+5 s');
SELECT is(offline_config_in_force(pg_temp.id('48aa01'), pg_temp.cid(1), pg_temp.t0() + interval '10 seconds', interval '0'),
  NULL::jsonb, 'configuration 1 périmée dès que la 2 est servie');
SELECT is(offline_config_in_force(pg_temp.id('48aa01'), pg_temp.cid(1), pg_temp.t0() + interval '5 seconds', interval '5 seconds'),
  NULL::jsonb, 'tolérance : la 2 est servie avant p_at + tol, la 1 est périmée');
SELECT is(offline_config_in_force(pg_temp.id('48aa01'), pg_temp.cid(2), pg_temp.t0() + interval '10 seconds', interval '0'),
  '{"m":2}'::jsonb, 'configuration 2 : served_at = p_at + tol exact');
SELECT is(offline_config_in_force(pg_temp.id('48aa01'), pg_temp.cid(2),
          pg_temp.t0() + interval '10 seconds' - interval '1 microsecond', interval '0'),
  NULL::jsonb, 'configuration 2 à 1 µs avant : future, NULL');
SELECT is(offline_config_in_force(pg_temp.id('48aa01'), pg_temp.cid(2),
          pg_temp.t0() + interval '10 seconds' - interval '1 microsecond', interval '1 microsecond'),
  '{"m":2}'::jsonb, 'configuration 2 avec tolérance de 1 µs');
SELECT is(offline_config_in_force(pg_temp.id('48aa01'), pg_temp.cid(3), pg_temp.t0() + interval '5 seconds', interval '0'),
  NULL::jsonb, 'configuration d''un autre terminal : NULL');
SELECT is(offline_config_in_force(pg_temp.id('48aa01'), 999999, pg_temp.t0() + interval '5 seconds', interval '0'),
  NULL::jsonb, 'configuration inconnue : NULL');
SELECT throws_ok($$SELECT offline_config_in_force(pg_temp.id('48ab01'), 1, now(), interval '0')$$, 'P0002', NULL,
  'terminal étranger : introuvable');
SELECT throws_ok($$SELECT offline_config_in_force(pg_temp.id('48aa01'), 1, now(), interval '-1 second')$$, 'CL001',
  NULL, 'tolérance négative : CL001');
-- statut daté (aa03 : ACTIVE, SUSPENDED à +1 h, ACTIVE à +2 h, REVOKED à +3 h)
INSERT INTO device_status_history (operator_id, device_id, from_status, to_status, reason, actor_id, at)
SELECT pg_temp.id('48a001'), pg_temp.id('48aa03'), f, t, 'test', CASE WHEN f IS NULL THEN NULL ELSE pg_temp.id('48e001') END,
       pg_temp.t0() + h * interval '1 hour'
  FROM (VALUES (NULL, 'ACTIVE', 0), ('ACTIVE', 'SUSPENDED', 1), ('SUSPENDED', 'ACTIVE', 2), ('ACTIVE', 'REVOKED', 3))
       AS x(f, t, h);
SELECT is(device_status_at(pg_temp.id('48aa03'), pg_temp.t0() - interval '1 second'), NULL::text, 'avant l''enrôlement : NULL');
SELECT is(device_status_at(pg_temp.id('48aa03'), pg_temp.t0()), 'ACTIVE', 'à l''enrôlement : ACTIVE');
SELECT is(device_status_at(pg_temp.id('48aa03'), pg_temp.t0() + interval '1 hour' - interval '1 second'), 'ACTIVE',
  'juste avant la suspension : ACTIVE');
SELECT is(device_status_at(pg_temp.id('48aa03'), pg_temp.t0() + interval '90 minutes'), 'SUSPENDED', 'suspendu');
SELECT is(device_status_at(pg_temp.id('48aa03'), pg_temp.t0() + interval '150 minutes'), 'ACTIVE', 'réactivé');
SELECT is(device_status_at(pg_temp.id('48aa03'), pg_temp.t0() + interval '5 hours'), 'REVOKED', 'révoqué');
SELECT is(device_status_at(pg_temp.id('48aa03'), pg_temp.t0() + interval '100 years'), 'REVOKED', 'futur lointain : REVOKED');
SELECT is(device_revoked_at(pg_temp.id('48aa03')), pg_temp.t0() + interval '3 hours', 'heure de révocation');
SELECT is(device_revoked_at(pg_temp.id('48aa01')), NULL::timestamptz, 'terminal non révoqué : NULL');
SELECT throws_ok($$SELECT device_status_at(pg_temp.id('48ab01'), now())$$, 'P0002', NULL, 'statut daté d''un terminal étranger');
SELECT throws_ok($$SELECT device_revoked_at(pg_temp.id('48ab01'))$$, 'P0002', NULL, 'révocation d''un terminal étranger');

-- T030. Vendeur et attribution datés ----------------------------------------------------------------------
-- Vendeurs : v1 actif ; v2 bloqué à t0+6 h ; v3 désactivé ; vb de B.
INSERT INTO vendor (id, operator_id, merchant_id, display_name, pin_hash, created_by, status, failed_attempts, locked_at)
VALUES
 (pg_temp.id('48fa001'), pg_temp.id('48a001'), pg_temp.id('48b101'), 'Vendeur 1', '$argon2id$v=19$m=19456,t=2,p=1$c2VsMDA0OA$djE', pg_temp.id('48e003'), 'ACTIVE', 0, NULL),
 (pg_temp.id('48fa002'), pg_temp.id('48a001'), pg_temp.id('48b101'), 'Vendeur 2', '$argon2id$v=19$m=19456,t=2,p=1$c2VsMDA0OA$djI', pg_temp.id('48e003'), 'ACTIVE', 5, pg_temp.t0() + interval '6 hours'),
 (pg_temp.id('48fa003'), pg_temp.id('48a001'), pg_temp.id('48b101'), 'Vendeur 3', '$argon2id$v=19$m=19456,t=2,p=1$c2VsMDA0OA$djM', pg_temp.id('48e003'), 'DISABLED', 0, NULL),
 (pg_temp.id('48fa011'), pg_temp.id('48a002'), pg_temp.id('48b111'), 'Vendeur B', '$argon2id$v=19$m=19456,t=2,p=1$c2VsMDA0OA$dkI', pg_temp.id('48e011'), 'ACTIVE', 0, NULL);
-- Sessions : s1 (v1, aa01) t0 -> fermée t0+1 h ; s2 (v1, aa02) ouverte depuis 1 h ; s3 (v2, aa01) t0+4 h -> fermée
-- au blocage t0+6 h ; s4 (v3 désactivé, aa03) ouverte (état incohérent) ; s5 (vb, ab01).
INSERT INTO vendor_session (id, operator_id, vendor_id, device_id, opened_at, expires_at, closed_at, closed_reason)
SELECT pg_temp.id(s), pg_temp.id(o), pg_temp.id(v), pg_temp.id(d), op, op + interval '12 hours', cl, rs
  FROM (VALUES
   ('48fb001','48a001','48fa001','48aa01', pg_temp.t0(), pg_temp.t0() + interval '1 hour', 'LOGOUT'),
   ('48fb002','48a001','48fa001','48aa02', now() - interval '1 hour', NULL::timestamptz, NULL),
   ('48fb003','48a001','48fa002','48aa01', pg_temp.t0() + interval '4 hours', pg_temp.t0() + interval '6 hours', 'VENDOR_LOCKED'),
   ('48fb004','48a001','48fa003','48aa03', pg_temp.t0(), NULL, NULL),
   ('48fb005','48a002','48fa011','48ab01', pg_temp.t0(), NULL, NULL)) AS x(s, o, v, d, op, cl, rs);
SELECT is(assert_vendor_session_at(pg_temp.id('48aa01'), pg_temp.id('48fb001'), pg_temp.t0() + interval '1 hour' - interval '1 second'),
  pg_temp.id('48fa001'), 'session fermée à t : valide à t - 1 s');
SELECT throws_ok($$SELECT assert_vendor_session_at(pg_temp.id('48aa01'), pg_temp.id('48fb001'), pg_temp.t0() + interval '1 hour' + interval '1 second')$$,
  'CL032', NULL, 'session fermée à t : CL032 à t + 1 s');
SELECT throws_ok($$SELECT assert_vendor_session_at(pg_temp.id('48aa01'), pg_temp.id('48fb001'), pg_temp.t0() + interval '1 hour')$$,
  'CL032', NULL, 'session fermée à t : CL032 à t pile');
SELECT throws_ok($$SELECT assert_vendor_session_at(pg_temp.id('48aa01'), pg_temp.id('48fb001'), pg_temp.t0() - interval '1 second')$$,
  'CL032', NULL, 'avant l''ouverture : CL032');
SELECT throws_ok($$SELECT assert_vendor_session_at(pg_temp.id('48aa02'), pg_temp.id('48fb002'), now() + interval '11 hours 1 minute')$$,
  'CL032', NULL, 'après l''échéance de 12 h : CL032');
SELECT is(assert_vendor_session_at(pg_temp.id('48aa02'), pg_temp.id('48fb002'), now() - interval '30 minutes'),
  pg_temp.id('48fa001'), 'session ouverte : valide pendant sa durée');
SELECT throws_ok($$SELECT assert_vendor_session_at(pg_temp.id('48aa01'), pg_temp.id('48fb002'), now())$$,
  'CL032', NULL, 'session d''un autre terminal : CL032');
SELECT throws_ok($$SELECT assert_vendor_session_at(pg_temp.id('48ab01'), pg_temp.id('48fb005'), pg_temp.t0() + interval '1 hour')$$,
  'CL032', NULL, 'session d''un autre prestataire : CL032');
SELECT is(assert_vendor_session_at(pg_temp.id('48aa01'), pg_temp.id('48fb003'), pg_temp.t0() + interval '6 hours' - interval '1 second'),
  pg_temp.id('48fa002'), 'vendeur bloqué à t : valide avant le blocage');
SELECT throws_ok($$SELECT assert_vendor_session_at(pg_temp.id('48aa01'), pg_temp.id('48fb003'), pg_temp.t0() + interval '6 hours' + interval '1 second')$$,
  'CL032', NULL, 'vendeur bloqué à t : CL032 après le blocage');
SELECT throws_ok($$SELECT assert_vendor_session_at(pg_temp.id('48aa03'), pg_temp.id('48fb004'), pg_temp.t0() + interval '1 hour')$$,
  'CL032', NULL, 'vendeur désactivé avec session restée ouverte : refusé (fermé par défaut)');
SELECT throws_ok($$SELECT assert_vendor_session_at(pg_temp.id('48aa01'), pg_temp.id('48fb001'), NULL)$$, 'CL001', NULL,
  'heure nulle : CL001');
-- record_sale_attribution_at
INSERT INTO journal_transaction (id, operator_id, ledger_id, event_id, type, idempotency_key, request_hash,
                                 occurred_at, source, device_id)
SELECT pg_temp.id(t), pg_temp.id(o), pg_temp.id(l), pg_temp.id(e), 'PURCHASE', 'k48:' || t, 'h48', pg_temp.t0(),
       'ONLINE', pg_temp.id(d)
  FROM (VALUES ('48fc001','48a001','48f001','48d001','48aa01'), ('48fc002','48a001','48f001','48d001','48aa01'),
               ('48fc003','48a001','48f001','48d001','48aa02'), ('48fc004','48a001','48f001','48d001','48aa02'),
               ('48fc011','48a002','48f011','48d011','48ab01')) AS x(t, o, l, e, d);
SELECT lives_ok($$SELECT record_sale_attribution_at(pg_temp.id('48fc001'), pg_temp.id('48fb001'), 'NFC', NULL,
  pg_temp.t0() + interval '1 hour' - interval '1 second')$$, 'attribution datée : session valide à p_at');
SELECT is((SELECT vendor_id::text || ' ' || device_id::text FROM sale_attribution WHERE transaction_id = pg_temp.id('48fc001')),
  pg_temp.id('48fa001')::text || ' ' || pg_temp.id('48aa01')::text, 'vendeur et terminal lus dans la session');
SELECT throws_ok($$SELECT record_sale_attribution_at(pg_temp.id('48fc001'), pg_temp.id('48fb001'), 'NFC', NULL,
  pg_temp.t0() + interval '1 hour' - interval '1 second')$$, '23505', NULL, 'seconde attribution : 23505');
SELECT throws_ok($$SELECT record_sale_attribution_at(pg_temp.id('48fc002'), pg_temp.id('48fb001'), 'NFC', NULL,
  pg_temp.t0() + interval '1 hour' + interval '1 second')$$, 'CL032', NULL, 'session fermée à p_at : CL032');
SELECT throws_ok($$SELECT record_sale_attribution_at(pg_temp.id('48fc002'), pg_temp.id('48fb002'), 'NFC', NULL, now())$$,
  'CL032', NULL, 'session d''un autre terminal que celui de la vente : CL032');
SELECT throws_ok($$SELECT record_sale_attribution_at(pg_temp.id('48fc011'), pg_temp.id('48fb001'), 'NFC', NULL,
  pg_temp.t0() + interval '30 minutes')$$, 'P0002', NULL, 'vente d''un autre prestataire : introuvable');
SELECT throws_ok($$SELECT record_sale_attribution_at(pg_temp.id('48fc002'), pg_temp.id('48fb001'), NULL, NULL,
  pg_temp.t0() + interval '30 minutes')$$, 'CL001', NULL, 'vente sans canal : CL001');
SELECT is((SELECT count(*)::int FROM sale_attribution WHERE transaction_id = pg_temp.id('48fc002')), 0,
  'refus sans écriture');
-- équivalence avec la fonction d'origine à « maintenant »
SELECT lives_ok($$SELECT record_sale_attribution(pg_temp.id('48fc003'), pg_temp.id('48fb002'), 'NFC')$$, 'origine');
SELECT lives_ok($$SELECT record_sale_attribution_at(pg_temp.id('48fc004'), pg_temp.id('48fb002'), 'NFC', NULL, now())$$,
  'variante datée à maintenant');
SELECT is((SELECT vendor_id::text || vendor_session_id::text || device_id::text || channel
             FROM sale_attribution WHERE transaction_id = pg_temp.id('48fc004')),
  (SELECT vendor_id::text || vendor_session_id::text || device_id::text || channel
     FROM sale_attribution WHERE transaction_id = pg_temp.id('48fc003')), 'mêmes valeurs écrites que l''origine');
-- nom de station
SELECT lives_ok($$SELECT set_device_station_name(pg_temp.id('48aa01'), '  Caisse 1  ', pg_temp.id('48e001'))$$, 'nom posé');
SELECT is((SELECT station_name FROM device WHERE id = pg_temp.id('48aa01')), 'Caisse 1', 'nom rogné');
SELECT throws_ok($$SELECT set_device_station_name(pg_temp.id('48aa01'), repeat('x', 201), pg_temp.id('48e001'))$$,
  'CL001', NULL, 'nom de 201 caractères : CL001');
SELECT lives_ok($$SELECT set_device_station_name(pg_temp.id('48aa01'), repeat('x', 200), pg_temp.id('48e001'))$$,
  'nom de 200 caractères accepté');
SELECT throws_ok($$SELECT set_device_station_name(pg_temp.id('48aa01'), '   ', pg_temp.id('48e001'))$$, 'CL001', NULL,
  'nom blanc : CL001');
SELECT throws_ok($$SELECT set_device_station_name(pg_temp.id('48aa01'), 'X', pg_temp.id('48e003'))$$, 'P0002', NULL,
  'acteur sans rôle : introuvable');
SELECT throws_ok($$SELECT set_device_station_name(pg_temp.id('48aa01'), 'X', pg_temp.id('48e002'))$$, 'P0002', NULL,
  'acteur désactivé : introuvable');
SELECT throws_ok($$SELECT set_device_station_name(pg_temp.id('48aa01'), 'X', pg_temp.id('48e011'))$$, 'P0002', NULL,
  'acteur d''un autre prestataire : introuvable');
SELECT throws_ok($$SELECT set_device_station_name(pg_temp.id('48ab01'), 'X', pg_temp.id('48e001'))$$, 'P0002', NULL,
  'terminal d''un autre prestataire : introuvable');
SELECT throws_ok($$SELECT set_device_station_name(pg_temp.id('48aa03'), 'X', pg_temp.id('48e001'))$$, '42501', NULL,
  'terminal révoqué : refusé');
SELECT is((SELECT station_name FROM device WHERE id = pg_temp.id('48ab01')), NULL, 'le terminal étranger n''est pas renommé');
SELECT lives_ok($$SELECT set_device_station_name(pg_temp.id('48aa01'), NULL, pg_temp.id('48e001'))$$, 'effacement');
SELECT is((SELECT station_name FROM device WHERE id = pg_temp.id('48aa01')), NULL, 'nom effacé');

-- T031. Exposition non acquittée ------------------------------------------------------------------------------
INSERT INTO wallet (id, operator_id, ledger_id, status) VALUES
 (pg_temp.id('48cb001'), pg_temp.id('48a001'), pg_temp.id('48f001'), 'ACTIVE');
INSERT INTO account (id, operator_id, ledger_id, code, family, purpose, wallet_id, normal_side) VALUES
 (pg_temp.id('48cd001'), pg_temp.id('48a001'), pg_temp.id('48f001'), 'K48-WAL', 'CLAIM', 'WALLET_PAID', pg_temp.id('48cb001'), 'C'),
 (pg_temp.id('48cd002'), pg_temp.id('48a001'), pg_temp.id('48f001'), 'K48-MER', 'CLAIM', 'MERCHANT', NULL, 'C');
INSERT INTO media (id, operator_id, kind, token_hash, nfc_uid, wallet_id, status)
SELECT pg_temp.id(m), pg_temp.id('48a001'), 'NFC_TAG', sha256(convert_to('identité ' || m, 'UTF8')),
       decode('044800000000' || n, 'hex'), pg_temp.id('48cb001'), 'ACTIVE'
  FROM (VALUES ('48ca001','01'), ('48ca002','02')) AS x(m, n);
-- Ventes : (clé, terminal, seq, bracelet, montant, canal, résultat, acquittement)
-- R = t0 + 10 min, tolérance 120 s : seuil t0 + 8 min.
INSERT INTO offline_batch (id, operator_id, device_id, ledger_id, seq_from, seq_to, op_hashes, prev_chain_hash,
                           last_chain_hash, signature, status, chain_status, results, received_at, completed_at)
SELECT pg_temp.id(b), pg_temp.id('48a001'), pg_temp.id('48aa05'), pg_temp.id('48f001'), s, s, ARRAY[sha256('x')],
       sha256('p'), sha256('l'), '\x01', 'COMPLETED', 'VERIFIED', '[]'::jsonb, pg_temp.t0(), c
  FROM (VALUES ('48bb005', 5, pg_temp.t0() + interval '9 minutes'), ('48bb006', 6, pg_temp.t0() + interval '5 minutes'))
       AS x(b, s, c);
INSERT INTO journal_transaction (id, operator_id, ledger_id, event_id, type, idempotency_key, request_hash,
                                 occurred_at, source, device_id, media_id)
SELECT pg_temp.id('48ff' || lpad(k::text, 3, '0')), pg_temp.id('48a001'), pg_temp.id('48f001'), pg_temp.id('48d001'),
       'PURCHASE', 'x48:' || k, 'h48', pg_temp.t0(), 'OFFLINE_SYNC', pg_temp.id(d), pg_temp.id(m)
  FROM (VALUES (1,'48aa05','48ca001'), (2,'48aa05','48ca001'), (3,'48aa05','48ca002'), (4,'48aa05','48ca002'),
               (5,'48aa05','48ca002'), (6,'48aa05','48ca001'), (10,'48aa05','48ca001'), (21,'48aa02','48ca001'))
       AS x(k, d, m);
INSERT INTO posting (operator_id, ledger_id, transaction_id, line_no, account_id, amount)
SELECT pg_temp.id('48a001'), pg_temp.id('48f001'), pg_temp.id('48ff' || lpad(k::text, 3, '0')), l,
       CASE WHEN l = 1 THEN pg_temp.id('48cd001') ELSE pg_temp.id('48cd002') END, CASE WHEN l = 1 THEN a ELSE -a END
  FROM (VALUES (1,100), (2,200), (3,400), (4,800), (5,1600), (6,3200), (10,6400), (21,99999)) AS x(k, a),
       (VALUES (1), (2)) AS y(l);
INSERT INTO device_seq_registry (operator_id, device_id, seq, content_sha256, outcome, transaction_id, channel,
                                 batch_id, recorded_at, reason, created_by, approved_by)
SELECT pg_temp.id('48a001'), pg_temp.id(d), s, CASE WHEN o = 'WAIVED' THEN NULL ELSE sha256(convert_to('o' || s || d, 'UTF8')) END,
       o, CASE WHEN tx IS NULL THEN NULL ELSE pg_temp.id('48ff' || lpad(tx::text, 3, '0')) END, ch,
       CASE WHEN b IS NULL THEN NULL ELSE pg_temp.id(b) END, pg_temp.t0() + rec,
       CASE WHEN o IN ('WAIVED','REJECTED') THEN 'test' END,
       CASE WHEN o = 'WAIVED' THEN pg_temp.id('48e001') END, CASE WHEN o = 'WAIVED' THEN pg_temp.id('48e003') END
  FROM (VALUES
   ('48aa05', 1, 'ACCEPTED', 1, 'ONLINE', NULL, interval '7 minutes 59 seconds'),
   ('48aa05', 2, 'ACCEPTED', 2, 'ONLINE', NULL, interval '8 minutes 1 second'),
   ('48aa05', 3, 'ACCEPTED', 3, 'ONLINE', NULL, interval '8 minutes'),
   ('48aa05', 4, 'ACCEPTED', 4, 'ONLINE', NULL, interval '7 minutes 59 seconds 999999 microseconds'),
   ('48aa05', 5, 'ACCEPTED_WITH_SHORTFALL', 5, 'BATCH', '48bb005', interval '9 minutes 30 seconds'),
   ('48aa05', 6, 'ACCEPTED', 6, 'BATCH', '48bb006', interval '9 minutes 30 seconds'),
   ('48aa05', 7, 'WAIVED', NULL, 'WAIVER', NULL, interval '9 minutes'),
   ('48aa05', 8, 'REJECTED', NULL, 'ONLINE', NULL, interval '9 minutes'),
   ('48aa05', 9, 'VOID', NULL, 'ONLINE', NULL, interval '9 minutes'),
   ('48aa05', 10, 'ACCEPTED', 10, 'ONLINE', NULL, interval '9 minutes 59 seconds'),
   ('48aa02', 21, 'ACCEPTED', 21, 'ONLINE', NULL, interval '11 minutes')) AS x(d, s, o, tx, ch, b, rec);
SELECT is((SELECT per_media FROM offline_device_exposure(pg_temp.id('48aa05'), pg_temp.id('48ca001'), 10,
          pg_temp.t0() + interval '10 minutes', interval '120 seconds')), 200::bigint,
  'm1 : seule la vente acquittée il y a 119 s compte (121 s, lot ancien, WAIVED, VOID, REJECTED, seq >= p_seq, autre terminal exclus)');
SELECT is((SELECT per_device FROM offline_device_exposure(pg_temp.id('48aa05'), pg_temp.id('48ca001'), 10,
          pg_temp.t0() + interval '10 minutes', interval '120 seconds')), 2200::bigint,
  'total du terminal : 119 s (200) + pile au seuil (400) + lot récent (1600, montant débité)');
SELECT is((SELECT per_media FROM offline_device_exposure(pg_temp.id('48aa05'), pg_temp.id('48ca002'), 10,
          pg_temp.t0() + interval '10 minutes', interval '120 seconds')), 2000::bigint,
  'm2 : seuil pile compté (strict), 1 µs avant non compté, lot récent compté');
SELECT is((SELECT per_device FROM offline_device_exposure(pg_temp.id('48aa05'), pg_temp.id('48ca002'), 1,
          pg_temp.t0() + interval '10 minutes', interval '120 seconds')), 0::bigint, 'p_seq = 1 : rien avant');
SELECT is((SELECT per_device FROM offline_device_exposure(pg_temp.id('48aa05'), pg_temp.id('48ca002'), 3,
          pg_temp.t0() + interval '10 minutes', interval '120 seconds')), 200::bigint,
  'p_seq = 3 : seulement les numéros 1 (acquittée il y a 121 s, exclue) et 2 (comptée)');
SELECT is((SELECT per_device FROM offline_device_exposure(pg_temp.id('48aa05'), pg_temp.id('48ca001'), 10,
          pg_temp.t0() + interval '10 minutes' + interval '1 microsecond', interval '120 seconds')), 1800::bigint,
  'référence +1 µs : la vente pile au seuil n''est plus comptée (400 de moins)');
SELECT throws_ok($$SELECT offline_device_exposure(pg_temp.id('48ab01'), pg_temp.id('48ca001'), 10, now(), interval '120 seconds')$$,
  'P0002', NULL, 'terminal étranger : introuvable');
SELECT throws_ok($$SELECT offline_device_exposure(pg_temp.id('48aa05'), pg_temp.id('48ca001'), 10, NULL, interval '120 seconds')$$,
  'CL001', NULL, 'référence nulle : CL001');
SELECT throws_ok($$SELECT offline_device_exposure(pg_temp.id('48aa05'), pg_temp.id('48ca001'), 10, now(), NULL)$$,
  'CL001', NULL, 'tolérance nulle : CL001');

-- Propriétés des fonctions et de la table -------------------------------------------------------------------
SELECT is((SELECT count(*)::int FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
            AND p.proname IN ('ack_offline_snapshot','offline_snapshot_ack_floor','offline_snapshot_meta',
              'offline_media_state_at','offline_config_in_force','device_status_at','device_revoked_at',
              'assert_vendor_session_at','record_sale_attribution_at','set_device_station_name',
              'offline_device_exposure')), 11, 'les onze fonctions de 0048 existent');
SELECT is((SELECT count(*)::int FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
            AND p.proname IN ('ack_offline_snapshot','offline_snapshot_ack_floor','offline_snapshot_meta',
              'offline_media_state_at','offline_config_in_force','device_status_at','device_revoked_at',
              'assert_vendor_session_at','record_sale_attribution_at','set_device_station_name',
              'offline_device_exposure')
            AND p.prosecdef AND p.proconfig @> ARRAY['search_path=public, pg_temp']
            AND p.proacl IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM aclexplode(p.proacl) x WHERE x.grantee = 0)), 11,
  'SECURITY DEFINER, search_path = public, pg_temp, non exécutables par PUBLIC');
SELECT is((SELECT string_agg(proname, ' ' ORDER BY proname) FROM pg_proc
            WHERE pronamespace = 'public'::regnamespace AND provolatile = 's'
              AND proname IN ('offline_snapshot_ack_floor','offline_snapshot_meta','offline_media_state_at',
                'offline_config_in_force','device_status_at','device_revoked_at','offline_device_exposure')),
  'device_revoked_at device_status_at offline_config_in_force offline_device_exposure offline_media_state_at offline_snapshot_ack_floor offline_snapshot_meta',
  'les sept lectures sont STABLE');
SELECT is((SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = 'offline_snapshot_ack'::regclass),
  true, 'offline_snapshot_ack : RLS ENABLE + FORCE');
SELECT is((SELECT count(*)::int FROM pg_attribute WHERE attrelid = 'offline_snapshot_ack'::regclass AND attname = 'operator_id'),
  1, 'offline_snapshot_ack : operator_id');
SELECT is((SELECT count(*)::int FROM pg_policies WHERE tablename = 'offline_snapshot_ack' AND policyname = 'tenant_isolation'),
  1, 'offline_snapshot_ack : politique tenant_isolation');

SELECT * FROM finish();
ROLLBACK;
