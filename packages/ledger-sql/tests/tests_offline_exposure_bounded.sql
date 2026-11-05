-- Exposition non acquittée bornée (migration 0052 ; mission hors-ligne-snapshots-lots, lot WP21 partie F ; NFR-003)
-- — pgTAP, écrit à la main. Sous le PROPRIÉTAIRE seulement (les droits sont ceux de tests_execute_grants).
-- Le résultat de `offline_device_exposure` après 0052 doit être celui de la définition de 0049 (recopiée ici comme
-- référence) pour tous les cas : acquittement strict à `référence - tolérance`, lot en cours ou rejeté, canal EDGE,
-- canal BATCH sans lot, ventes sans ligne de portefeuille, autre terminal, numéro >= p_seq.
-- Lancer : pg_prove -d <base> tests/tests_offline_exposure_bounded.sql (base créée par les migrations).
\set ON_ERROR_STOP 1
\set QUIET 1
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

CREATE FUNCTION pg_temp.id(p text) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT ('00000000-0000-0000-0000-' || lpad(p, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.t0() RETURNS timestamptz LANGUAGE sql IMMUTABLE AS
  $$ SELECT '2026-06-01 12:00:00+00'::timestamptz $$;

-- Référence : corps de 0049 (jointure de tout l'historique, filtre d'acquittement ensuite).
CREATE FUNCTION pg_temp.ref_exposure(p_device uuid, p_media uuid, p_seq bigint, p_reference timestamptz, p_tol interval)
RETURNS TABLE (per_media bigint, per_device bigint) LANGUAGE sql AS $$
    WITH sales AS (
      SELECT jt.media_id AS media_id,
             (SELECT coalesce(sum(p.amount), 0) FROM posting p JOIN account a ON a.id = p.account_id
               WHERE p.transaction_id = jt.id AND p.operator_id = pg_temp.id('52a001')
                 AND a.purpose IN ('WALLET_PAID','WALLET_PROMO')) AS amount,
             CASE r.channel WHEN 'BATCH' THEN b.completed_at WHEN 'ONLINE' THEN r.recorded_at END AS acked_at
        FROM device_seq_registry r
        JOIN journal_transaction jt ON jt.id = r.transaction_id AND jt.operator_id = r.operator_id AND jt.type = 'PURCHASE'
        LEFT JOIN offline_batch b ON b.id = r.batch_id AND b.operator_id = r.operator_id
       WHERE r.operator_id = pg_temp.id('52a001') AND r.device_id = p_device AND r.seq < p_seq
         AND r.transaction_id IS NOT NULL AND r.outcome IN ('ACCEPTED','ACCEPTED_WITH_SHORTFALL')
    ), unacked AS (
      SELECT s.media_id, s.amount FROM sales s
       WHERE s.amount > 0 AND (s.acked_at IS NULL OR s.acked_at >= p_reference - p_tol)
    )
    SELECT coalesce(sum(u.amount) FILTER (WHERE u.media_id = p_media), 0)::bigint, coalesce(sum(u.amount), 0)::bigint
      FROM unacked u $$;

INSERT INTO party (kind, legal_name) SELECT 'PLATFORM', 'Plateforme (test)'
 WHERE NOT EXISTS (SELECT 1 FROM party WHERE kind = 'PLATFORM');
INSERT INTO party (id, kind, legal_name, country_code) VALUES (pg_temp.id('52a001'), 'OPERATOR', 'Prestataire A', 'SN');
INSERT INTO party (id, kind, operator_id, legal_name) VALUES
 (pg_temp.id('52b001'), 'ORGANIZER', pg_temp.id('52a001'), 'Organisateur A');
INSERT INTO jurisdiction_profile (id, country_code, version, valid_from, breakage_destination)
VALUES (pg_temp.id('52c001'), 'SN', 520052, '2026-01-01', 'ORGANIZER');
INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone, jurisdiction_id, funds_holder)
VALUES (pg_temp.id('52d001'), pg_temp.id('52a001'), pg_temp.id('52b001'), 'Événement', 'XOF', 'Africa/Dakar',
        pg_temp.id('52c001'), 'ORGANIZER');
INSERT INTO ledger (id, operator_id, scope_type, scope_id, currency, issuer_id, funds_holder_id)
VALUES (pg_temp.id('52f001'), pg_temp.id('52a001'), 'EVENT', pg_temp.id('52d001'), 'XOF', pg_temp.id('52b001'), pg_temp.id('52b001'));
INSERT INTO device (id, operator_id, kind, event_id, serial) VALUES
 (pg_temp.id('52aa01'), pg_temp.id('52a001'), 'POS', pg_temp.id('52d001'), 'D52-01'),
 (pg_temp.id('52aa02'), pg_temp.id('52a001'), 'POS', pg_temp.id('52d001'), 'D52-02');
SELECT set_config('app.operator_id', pg_temp.id('52a001')::text, true);
INSERT INTO wallet (id, operator_id, ledger_id, status) VALUES (pg_temp.id('52cb001'), pg_temp.id('52a001'), pg_temp.id('52f001'), 'ACTIVE');
INSERT INTO account (id, operator_id, ledger_id, code, family, purpose, wallet_id, normal_side) VALUES
 (pg_temp.id('52cd001'), pg_temp.id('52a001'), pg_temp.id('52f001'), 'K52-WAL', 'CLAIM', 'WALLET_PAID', pg_temp.id('52cb001'), 'C'),
 (pg_temp.id('52cd002'), pg_temp.id('52a001'), pg_temp.id('52f001'), 'K52-MER', 'CLAIM', 'MERCHANT', NULL, 'C'),
 (pg_temp.id('52cd003'), pg_temp.id('52a001'), pg_temp.id('52f001'), 'K52-ME2', 'CLAIM', 'MERCHANT', NULL, 'C');
INSERT INTO media (id, operator_id, kind, token_hash, nfc_uid, wallet_id, status)
SELECT pg_temp.id(m), pg_temp.id('52a001'), 'NFC_TAG', sha256(convert_to('identité ' || m, 'UTF8')),
       decode('045200000000' || n, 'hex'), pg_temp.id('52cb001'), 'ACTIVE'
  FROM (VALUES ('52ca001','01'), ('52ca002','02')) AS x(m, n);

-- Lots du terminal 52aa01 : 3 terminé tôt (5 min), 4 terminé pile au seuil (8 min), 5 en cours, 8 rejeté, 9 terminé (9 min).
-- Un seul lot PROCESSING par terminal : le lot 5 est le seul.
INSERT INTO offline_batch (id, operator_id, device_id, ledger_id, seq_from, seq_to, op_hashes, prev_chain_hash,
                           last_chain_hash, signature, status, reject_reason, chain_status, results, received_at, completed_at)
SELECT pg_temp.id(b), pg_temp.id('52a001'), pg_temp.id('52aa01'), pg_temp.id('52f001'), s, s, ARRAY[sha256('x')],
       sha256('p'), sha256('l'), '\x01', st, CASE WHEN st = 'REJECTED' THEN 'test' END, 'VERIFIED',
       CASE WHEN st = 'COMPLETED' THEN '[]'::jsonb END, pg_temp.t0(), c
  FROM (VALUES ('52bb003', 3, 'COMPLETED', pg_temp.t0() + interval '5 minutes'),
               ('52bb004', 4, 'COMPLETED', pg_temp.t0() + interval '8 minutes'),
               ('52bb005', 5, 'PROCESSING', NULL::timestamptz),
               ('52bb008', 8, 'REJECTED', NULL::timestamptz),
               ('52bb009', 9, 'COMPLETED', pg_temp.t0() + interval '9 minutes')) AS x(b, s, st, c);
-- Ventes : (numéro, terminal, bracelet, montant, ligne de portefeuille ?)
INSERT INTO journal_transaction (id, operator_id, ledger_id, event_id, type, idempotency_key, request_hash,
                                 occurred_at, source, device_id, media_id)
SELECT pg_temp.id('52ff' || lpad(k::text, 3, '0')), pg_temp.id('52a001'), pg_temp.id('52f001'), pg_temp.id('52d001'),
       'PURCHASE', 'x52:' || k, 'h52', pg_temp.t0(), 'OFFLINE_SYNC', pg_temp.id(d), pg_temp.id(m)
  FROM (VALUES (1,'52aa01','52ca001'), (2,'52aa01','52ca001'), (3,'52aa01','52ca002'), (4,'52aa01','52ca002'),
               (5,'52aa01','52ca001'), (6,'52aa01','52ca002'), (7,'52aa01','52ca001'), (8,'52aa01','52ca002'),
               (9,'52aa01','52ca002'), (10,'52aa01','52ca001'), (11,'52aa02','52ca001'), (12,'52aa01','52ca001'))
       AS x(k, d, m);
INSERT INTO posting (operator_id, ledger_id, transaction_id, line_no, account_id, amount)
SELECT pg_temp.id('52a001'), pg_temp.id('52f001'), pg_temp.id('52ff' || lpad(k::text, 3, '0')), l,
       CASE WHEN w AND l = 1 THEN pg_temp.id('52cd001') WHEN l = 1 THEN pg_temp.id('52cd003') ELSE pg_temp.id('52cd002') END,
       CASE WHEN l = 1 THEN a ELSE -a END
  FROM (VALUES (1,100,true), (2,200,true), (3,400,true), (4,800,true), (5,1600,true), (6,3200,true), (7,6400,true),
               (8,12800,true), (9,25600,true), (10,51200,false), (11,102400,true), (12,204800,true)) AS x(k, a, w),
       (VALUES (1), (2)) AS y(l);
INSERT INTO device_seq_registry (operator_id, device_id, seq, content_sha256, outcome, transaction_id, channel,
                                 batch_id, recorded_at)
SELECT pg_temp.id('52a001'), pg_temp.id(d), s, sha256(convert_to('o' || s || d, 'UTF8')), o,
       pg_temp.id('52ff' || lpad(s::text, 3, '0')), ch, CASE WHEN b IS NULL THEN NULL ELSE pg_temp.id(b) END,
       pg_temp.t0() + rec
  FROM (VALUES
   ('52aa01', 1, 'ACCEPTED', 'ONLINE', NULL, interval '7 minutes 59 seconds'),
   ('52aa01', 2, 'ACCEPTED', 'ONLINE', NULL, interval '8 minutes'),
   ('52aa01', 3, 'ACCEPTED', 'BATCH', '52bb003', interval '9 minutes'),
   ('52aa01', 4, 'ACCEPTED', 'BATCH', '52bb004', interval '9 minutes'),
   ('52aa01', 5, 'ACCEPTED', 'BATCH', '52bb005', interval '9 minutes'),
   ('52aa01', 6, 'ACCEPTED', 'BATCH', NULL, interval '9 minutes'),
   ('52aa01', 7, 'ACCEPTED', 'EDGE', NULL, interval '1 minute'),
   ('52aa01', 8, 'ACCEPTED', 'BATCH', '52bb008', interval '9 minutes'),
   ('52aa01', 9, 'ACCEPTED_WITH_SHORTFALL', 'BATCH', '52bb009', interval '9 minutes'),
   ('52aa01', 10, 'ACCEPTED', 'ONLINE', NULL, interval '9 minutes'),
   ('52aa02', 11, 'ACCEPTED', 'ONLINE', NULL, interval '9 minutes'),
   ('52aa01', 12, 'ACCEPTED', 'ONLINE', NULL, interval '9 minutes')) AS x(d, s, o, ch, b, rec);

-- Cas attendus (R = t0 + 10 min, tolérance 120 s, seuil t0 + 8 min) : comptés 2 (200), 4 (800, pile), 5 (1600, lot en
-- cours), 6 (3200, sans lot), 7 (6400, EDGE), 8 (12800, lot rejeté), 9 (25600, lot de 9 min) ; exclus 1, 3 (acquittées),
-- 10 (aucune ligne de portefeuille), 11 (autre terminal), 12 (numéro >= p_seq).
SELECT is((SELECT per_device FROM offline_device_exposure(pg_temp.id('52aa01'), pg_temp.id('52ca001'), 12,
          pg_temp.t0() + interval '10 minutes', interval '120 seconds')), 50600::bigint, 'total du terminal');
SELECT is((SELECT per_media FROM offline_device_exposure(pg_temp.id('52aa01'), pg_temp.id('52ca001'), 12,
          pg_temp.t0() + interval '10 minutes', interval '120 seconds')), 8200::bigint, 'bracelet 1 : 200 + 1600 + 6400');
SELECT is((SELECT per_media FROM offline_device_exposure(pg_temp.id('52aa01'), pg_temp.id('52ca002'), 12,
          pg_temp.t0() + interval '10 minutes', interval '120 seconds')), 42400::bigint, 'bracelet 2 : 800 + 3200 + 12800 + 25600');
SELECT is((SELECT per_device FROM offline_device_exposure(pg_temp.id('52aa01'), pg_temp.id('52ca001'), 13,
          pg_temp.t0() + interval '10 minutes', interval '120 seconds')), 255400::bigint, 'p_seq = 13 : la vente 12 (204800) compte');

-- Équivalence avec la référence sur une grille de références, tolérances, numéros et bracelets.
SELECT is((SELECT count(*)::int FROM (VALUES (pg_temp.id('52ca001')), (pg_temp.id('52ca002')), (NULL::uuid)) m(media),
       generate_series(0, 14, 1) AS s(seq),
       (VALUES (interval '0'), (interval '120 seconds'), (interval '4 minutes'), (interval '1 hour')) t(tol),
       (VALUES (pg_temp.t0() + interval '5 minutes'), (pg_temp.t0() + interval '8 minutes'),
               (pg_temp.t0() + interval '10 minutes'), (pg_temp.t0() + interval '10 minutes 1 microsecond'),
               (pg_temp.t0() + interval '2 hours')) r(ref)
 WHERE (SELECT row(e.*) FROM offline_device_exposure(pg_temp.id('52aa01'), m.media, s.seq, r.ref, t.tol) e)
       IS DISTINCT FROM (SELECT row(e.*) FROM pg_temp.ref_exposure(pg_temp.id('52aa01'), m.media, s.seq, r.ref, t.tol) e)),
  0, 'résultat identique à la référence (0049) sur toute la grille');

-- Erreurs conservées
SELECT throws_ok($$SELECT offline_device_exposure(pg_temp.id('52aa01'), pg_temp.id('52ca001'), 10, NULL, interval '120 seconds')$$,
  'CL001', NULL, 'référence nulle : CL001');
SELECT throws_ok($$SELECT offline_device_exposure(pg_temp.id('52aa01'), pg_temp.id('52ca001'), 10, now(), interval '-1 second')$$,
  'CL001', NULL, 'tolérance négative : CL001');
SELECT throws_ok($$SELECT offline_device_exposure(pg_temp.id('52aa01'), pg_temp.id('52ca001'), NULL, now(), interval '1 second')$$,
  'CL001', NULL, 'numéro nul : CL001');
SELECT set_config('app.operator_id', pg_temp.id('52a009')::text, true);
SELECT throws_ok($$SELECT offline_device_exposure(pg_temp.id('52aa01'), pg_temp.id('52ca001'), 10, now(), interval '1 second')$$,
  'P0002', NULL, 'autre prestataire : introuvable');

-- Index de la borne et propriétés inchangées
SELECT is((SELECT count(*)::int FROM pg_indexes WHERE schemaname = 'public' AND indexname IN
  ('device_seq_registry_batch_idx', 'device_seq_registry_online_idx', 'device_seq_registry_unknown_idx', 'offline_batch_completed_idx')),
  4, 'les quatre index de la borne existent');
SELECT is((SELECT prosecdef AND provolatile = 's' AND proconfig = ARRAY['search_path=public, pg_temp']
             FROM pg_proc WHERE oid = 'offline_device_exposure(uuid,uuid,bigint,timestamptz,interval)'::regprocedure),
  true, 'SECURITY DEFINER, STABLE, search_path figé');
SELECT is((SELECT has_function_privilege('public', 'offline_device_exposure(uuid,uuid,bigint,timestamptz,interval)', 'EXECUTE')),
  false, 'aucun EXECUTE à PUBLIC');

SELECT * FROM finish();
ROLLBACK;
