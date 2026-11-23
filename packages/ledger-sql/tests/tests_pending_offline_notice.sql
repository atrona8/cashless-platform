-- Avis de solde provisoire (migration 0098, mission serveur-app-festivalier, lot WP03 ; FR-010, FR-013) —
-- pgTAP, écrit à la main. Propriétaire pour les cas de logique ; SET LOCAL ROLE cashless_app pour l'isolation.
-- Lancer : pg_prove -d <base> tests/tests_pending_offline_notice.sql
\set ON_ERROR_STOP 1
\set QUIET 1
BEGIN;
\ir _grants_for_tests.sql
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

CREATE FUNCTION pg_temp.id(p text) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT ('00000000-0000-0000-0000-' || lpad(p, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.t0() RETURNS timestamptz LANGUAGE sql IMMUTABLE AS
  $$ SELECT '2026-06-01 12:00:00+00'::timestamptz $$;
CREATE FUNCTION pg_temp.n(p_wallet text) RETURNS boolean LANGUAGE sql AS
  $$ SELECT wallet_pending_offline_notice(pg_temp.id(p_wallet)) $$;

INSERT INTO party (kind, legal_name) SELECT 'PLATFORM', 'Plateforme (test)'
 WHERE NOT EXISTS (SELECT 1 FROM party WHERE kind = 'PLATFORM');
INSERT INTO party (id, kind, legal_name, country_code) VALUES
 (pg_temp.id('98a001'), 'OPERATOR', 'Prestataire A', 'SN'),
 (pg_temp.id('98a002'), 'OPERATOR', 'Prestataire B', 'CI');
INSERT INTO party (id, kind, operator_id, legal_name) VALUES
 (pg_temp.id('98b001'), 'ORGANIZER', pg_temp.id('98a001'), 'Organisateur A'),
 (pg_temp.id('98b011'), 'ORGANIZER', pg_temp.id('98a002'), 'Organisateur B');
INSERT INTO jurisdiction_profile (id, country_code, version, valid_from, breakage_destination)
VALUES (pg_temp.id('98c001'), 'SN', 980098, '2026-01-01', 'ORGANIZER');
-- Événements de A : d001 LIVE (cas principal), d002 CLOSED, d003..d008 autres statuts ; B : d011 LIVE
INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone, jurisdiction_id, funds_holder, status)
SELECT pg_temp.id(e), pg_temp.id(o), pg_temp.id(g), 'Événement ' || e, 'XOF', 'Africa/Dakar',
       pg_temp.id('98c001'), 'ORGANIZER', s::event_status
  FROM (VALUES ('98d001','98a001','98b001','LIVE'), ('98d002','98a001','98b001','CLOSED'),
               ('98d003','98a001','98b001','DRAFT'), ('98d004','98a001','98b001','CLOSING'),
               ('98d005','98a001','98b001','RECONCILING'), ('98d006','98a001','98b001','SETTLING'),
               ('98d007','98a001','98b001','REFUND_WINDOW'), ('98d011','98a002','98b011','LIVE'))
       AS v(e, o, g, s);
INSERT INTO ledger (id, operator_id, scope_type, scope_id, currency, issuer_id, funds_holder_id)
SELECT pg_temp.id(l), pg_temp.id(o), t, pg_temp.id(s), 'XOF', pg_temp.id(g), pg_temp.id(g)
  FROM (VALUES ('98f001','98a001','EVENT','98d001','98b001'), ('98f002','98a001','EVENT','98d002','98b001'),
               ('98f003','98a001','EVENT','98d003','98b001'), ('98f004','98a001','EVENT','98d004','98b001'),
               ('98f005','98a001','EVENT','98d005','98b001'), ('98f006','98a001','EVENT','98d006','98b001'),
               ('98f007','98a001','EVENT','98d007','98b001'), ('98f008','98a001','ORGANIZER','98b001','98b001'),
               ('98f009','98a001','EVENT','98d001','98b001'), ('98f011','98a002','EVENT','98d011','98b011'))
       AS v(l, o, t, s, g)
 WHERE NOT (l = '98f009');
-- Second grand livre de l'événement d001 impossible (UNIQUE scope, devise) : on varie la devise
INSERT INTO ledger (id, operator_id, scope_type, scope_id, currency, issuer_id, funds_holder_id)
VALUES (pg_temp.id('98f009'), pg_temp.id('98a001'), 'EVENT', pg_temp.id('98d001'), 'EUR',
        pg_temp.id('98b001'), pg_temp.id('98b001'));
-- Un portefeuille par grand livre : c = 98cb + suffixe du grand livre
INSERT INTO wallet (id, operator_id, ledger_id, status)
SELECT pg_temp.id('98cb' || right(id::text, 3)), operator_id, id, 'ACTIVE'
  FROM ledger WHERE id IN (SELECT pg_temp.id(x) FROM unnest(ARRAY['98f001','98f002','98f003','98f004','98f005',
    '98f006','98f007','98f008','98f009','98f011']) x);
-- Grands livres supplémentaires de l'événement d001 : f010 (USD, cas multi-grands livres), f012 (ORGANIZER dont le
-- scope_id est un événement non clos : seul scope_type l'écarte)
INSERT INTO ledger (id, operator_id, scope_type, scope_id, currency, issuer_id, funds_holder_id) VALUES
 (pg_temp.id('98f010'), pg_temp.id('98a001'), 'EVENT', pg_temp.id('98d001'), 'USD', pg_temp.id('98b001'),
  pg_temp.id('98b001')),
 (pg_temp.id('98f012'), pg_temp.id('98a001'), 'ORGANIZER', pg_temp.id('98d001'), 'XOF', pg_temp.id('98b001'),
  pg_temp.id('98b001'));
INSERT INTO wallet (id, operator_id, ledger_id, status) VALUES
 (pg_temp.id('98cb010'), pg_temp.id('98a001'), pg_temp.id('98f010'), 'ACTIVE'),
 (pg_temp.id('98cb012'), pg_temp.id('98a001'), pg_temp.id('98f012'), 'ACTIVE');
-- Terminaux de A : aa01 et aa03 (actifs, avec lots), aa02 (révoqué), aa04 (actif, jamais de lot) ; B : ab01
INSERT INTO device (id, operator_id, kind, event_id, serial, status)
SELECT pg_temp.id(n), pg_temp.id(o), 'POS', pg_temp.id(e), 'D98-' || n, s
  FROM (VALUES ('98aa01','98a001','98d001','ACTIVE'), ('98aa02','98a001','98d001','REVOKED'),
               ('98aa03','98a001','98d001','ACTIVE'), ('98aa04','98a001','98d001','ACTIVE'),
               ('98aa05','98a001','98d001','ACTIVE'), ('98aa06','98a001','98d001','ACTIVE'), ('98ab01','98a002','98d011','ACTIVE')) AS v(n, o, e, s);

CREATE FUNCTION pg_temp.ack(p_dev text, p_ledger text, p_ver bigint, p_at timestamptz) RETURNS void
LANGUAGE sql AS $$
  INSERT INTO offline_snapshot_ack (device_id, version, operator_id, ledger_id, acked_at)
  SELECT pg_temp.id(p_dev), p_ver, operator_id, id, p_at FROM ledger WHERE id = pg_temp.id(p_ledger) $$;
CREATE FUNCTION pg_temp.batch(p_id text, p_dev text, p_ledger text, p_seq bigint, p_at timestamptz,
                              p_status text DEFAULT 'COMPLETED') RETURNS void
LANGUAGE sql AS $$
  INSERT INTO offline_batch (id, operator_id, device_id, ledger_id, seq_from, seq_to, op_hashes,
                             prev_chain_hash, last_chain_hash, signature, status, reject_reason, chain_status,
                             results, received_at, completed_at)
  SELECT pg_temp.id(p_id), operator_id, id_dev, pg_temp.id(p_ledger), p_seq, p_seq, ARRAY[sha256('x')],
         sha256('p'), sha256('l'), '\x01', p_status, CASE WHEN p_status = 'REJECTED' THEN 'test' END,
         'VERIFIED', CASE WHEN p_status = 'COMPLETED' THEN '[]'::jsonb END, p_at,
         CASE WHEN p_status = 'COMPLETED' THEN p_at END
    FROM (SELECT operator_id, id AS id_dev FROM device WHERE id = pg_temp.id(p_dev)) d $$;

-- 1. Cas de logique (propriétaire) : wallet 98cb001 = événement LIVE d001 ---------------------------------------
SELECT is(pg_temp.n('98cb001'), false, 'aucun accusé : faux');
SELECT pg_temp.ack('98aa03', '98f001', 1, pg_temp.t0() + interval '1 hour');
SELECT is(pg_temp.n('98cb001'), true, 'accusé sans aucun lot : vrai');
SELECT pg_temp.batch('98bb001', '98aa03', '98f001', 1, pg_temp.t0() + interval '2 hours');
SELECT is(pg_temp.n('98cb001'), false, 'lot postérieur à l''accusé : faux');
SELECT pg_temp.ack('98aa03', '98f001', 2, pg_temp.t0() + interval '3 hours');
SELECT is(pg_temp.n('98cb001'), true, 'nouvel accusé postérieur au lot : vrai');
SELECT pg_temp.batch('98bb002', '98aa03', '98f001', 2, pg_temp.t0() + interval '4 hours');
SELECT is(pg_temp.n('98cb001'), false, 'lot encore postérieur : faux');
-- égalité stricte : un lot reçu à l'instant exact de l'accusé n'est pas en attente
SELECT pg_temp.ack('98aa01', '98f001', 1, pg_temp.t0() + interval '5 hours');
SELECT pg_temp.batch('98bb003', '98aa01', '98f001', 1, pg_temp.t0() + interval '5 hours');
SELECT is(pg_temp.n('98cb001'), false, 'lot à l''instant exact de l''accusé : faux (stricte)');
-- un seul terminal en attente suffit, même si un autre a remonté son lot
SELECT pg_temp.ack('98aa01', '98f001', 2, pg_temp.t0() + interval '6 hours');
SELECT is(pg_temp.n('98cb001'), true, 'un terminal en attente parmi plusieurs : vrai');
-- lot REJECTED postérieur : littéral, le terminal a remonté quelque chose
SELECT pg_temp.batch('98bb004', '98aa01', '98f001', 2, pg_temp.t0() + interval '7 hours', 'REJECTED');
SELECT is(pg_temp.n('98cb001'), false, 'lot REJECTED postérieur : faux (tous statuts)');
-- terminal révoqué seul
SELECT pg_temp.ack('98aa02', '98f009', 1, pg_temp.t0() + interval '1 hour');
SELECT is(pg_temp.n('98cb009'), false, 'accusé du seul terminal révoqué : faux');
SELECT pg_temp.ack('98aa04', '98f009', 10, pg_temp.t0() + interval '1 hour') ;
SELECT is(pg_temp.n('98cb009'), true, 'même grand livre, terminal actif en attente : vrai (contrôle positif)');
-- accusé d'un autre grand livre : aa06 n'a aucun lot et un seul accusé, sur f010 ; 98cb001 reste faux
SELECT pg_temp.ack('98aa06', '98f010', 1, pg_temp.t0() + interval '1 hour');
SELECT is(pg_temp.n('98cb001'), false, 'accusé d''un autre grand livre (aa06, f010) : sans effet sur 98cb001');
SELECT is(pg_temp.n('98cb010'), true, 'même accusé : vrai sur le portefeuille de f010 (contrôle positif)');
-- aa06 remonte son lot sur f010 : seul aa05 pourra encore rendre vrai
SELECT pg_temp.batch('98bb012', '98aa06', '98f010', 1, pg_temp.t0() + interval '2 hours');
SELECT is(pg_temp.n('98cb010'), false, 'aa06 a remonté son lot sur f010 : faux');
-- lot remonté sur un AUTRE grand livre après l'accusé : n'éteint pas l'avis de ce grand livre
SELECT pg_temp.ack('98aa05', '98f010', 1, pg_temp.t0() + interval '3 hours');
SELECT pg_temp.batch('98bb010', '98aa05', '98f001', 1, pg_temp.t0() + interval '4 hours');
SELECT is(pg_temp.n('98cb010'), true, 'lot d''aa05 sur f001 postérieur à son accusé sur f010 : vrai');
SELECT pg_temp.batch('98bb011', '98aa05', '98f010', 2, pg_temp.t0() + interval '5 hours');
SELECT is((SELECT count(*)::int FROM offline_batch WHERE device_id = pg_temp.id('98aa05')), 2, 'deux lots d''aa05');
SELECT is(pg_temp.n('98cb010'), false, 'lot d''aa05 sur f010 postérieur à son accusé : faux');
-- grand livre ORGANIZER dont le scope_id désigne un événement LIVE, accusé en attente : faux
SELECT pg_temp.ack('98aa04', '98f012', 30, pg_temp.t0() + interval '1 hour');
SELECT is(pg_temp.n('98cb012'), false, 'grand livre ORGANIZER (scope_id = événement non clos) : faux');
-- statuts d'événement
SELECT pg_temp.ack('98aa04', '98f002', 11, pg_temp.t0() + interval '1 hour');
SELECT is(pg_temp.n('98cb002'), false, 'événement CLOSED, accusé en attente : faux');
SELECT pg_temp.ack('98aa04', '98f003', 12, pg_temp.t0() + interval '1 hour');
SELECT pg_temp.ack('98aa04', '98f004', 13, pg_temp.t0() + interval '1 hour');
SELECT pg_temp.ack('98aa04', '98f005', 14, pg_temp.t0() + interval '1 hour');
SELECT pg_temp.ack('98aa04', '98f006', 15, pg_temp.t0() + interval '1 hour');
SELECT pg_temp.ack('98aa04', '98f007', 16, pg_temp.t0() + interval '1 hour');
SELECT is((SELECT string_agg(pg_temp.n('98cb00' || i)::text, ' ' ORDER BY i) FROM generate_series(3, 7) i),
  'true true true true true', 'DRAFT, CLOSING, RECONCILING, SETTLING, REFUND_WINDOW : vrai');
SELECT pg_temp.ack('98aa04', '98f008', 17, pg_temp.t0() + interval '1 hour');
SELECT is(pg_temp.n('98cb008'), false, 'grand livre ORGANIZER : faux');
SELECT is(wallet_pending_offline_notice(pg_temp.id('98cbfff')), false, 'portefeuille inconnu : faux, sans erreur');

-- 2. Isolation sous cashless_app (le propriétaire ignore la RLS) ------------------------------------------------
GRANT SELECT ON wallet, ledger, event, device, offline_snapshot_ack, offline_batch TO cashless_app;
GRANT EXECUTE ON FUNCTION wallet_pending_offline_notice(uuid) TO cashless_app;
SET LOCAL ROLE cashless_app;
SELECT set_config('app.operator_id', pg_temp.id('98a001')::text, true);
SELECT is(pg_temp.n('98cb009'), true, 'cashless_app sous A, portefeuille de A : vrai (contrôle positif)');
SELECT set_config('app.operator_id', pg_temp.id('98a002')::text, true);
SELECT is(pg_temp.n('98cb009'), false, 'cashless_app sous B, portefeuille de A : faux (isolation)');
RESET ROLE;

-- 3. Forme de la fonction et index -------------------------------------------------------------------------------
SELECT is((SELECT prosecdef FROM pg_proc WHERE oid = 'wallet_pending_offline_notice(uuid)'::regprocedure), false,
  'SECURITY INVOKER');
SELECT is((SELECT provolatile::text FROM pg_proc WHERE oid = 'wallet_pending_offline_notice(uuid)'::regprocedure),
  's', 'STABLE');
SELECT is((SELECT count(*)::int FROM pg_indexes WHERE schemaname = 'public'
            AND tablename = 'offline_batch' AND indexdef LIKE '%(device_id, received_at)'), 1,
  'index offline_batch (device_id, received_at)');
SELECT is((SELECT count(*)::int FROM pg_indexes WHERE schemaname = 'public'
            AND tablename = 'offline_batch' AND indexdef LIKE '%(device_id, ledger_id, received_at)'), 1,
  'index offline_batch (device_id, ledger_id, received_at)');
SELECT is((SELECT count(*)::int FROM pg_indexes WHERE schemaname = 'public'
            AND tablename = 'offline_snapshot_ack' AND indexdef LIKE '%(ledger_id, device_id, acked_at)'), 1,
  'index offline_snapshot_ack (ledger_id, device_id, acked_at)');
SELECT is(has_function_privilege('public', 'wallet_pending_offline_notice(uuid)', 'EXECUTE'), false,
  'aucun EXECUTE pour PUBLIC');

SELECT * FROM finish();
ROLLBACK;
