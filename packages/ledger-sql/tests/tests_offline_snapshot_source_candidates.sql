-- Équivalence de la lecture des changements d'un snapshot (migrations 0054, 0055 et 0057 ; mission hors-ligne-snapshots-lots,
-- WP21 partie I ; NFR-005) — pgTAP, écrit à la main. La version 0053 (jointure complète de la vue) est recopiée ici
-- en fonction temporaire `pg_temp.old_rows` ; `offline_snapshot_source_rows` (0054 candidats par index, 0055 retraits en EXCEPT) doit rendre
-- EXACTEMENT les mêmes lignes pour chaque date de départ, retraits compris, même si l'état est incohérent.
-- Lancer : pg_prove -d <base> tests/tests_offline_snapshot_source_candidates.sql. Sous le PROPRIÉTAIRE seulement.
\set ON_ERROR_STOP 1
\set QUIET 1
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

CREATE FUNCTION pg_temp.id(p text) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT ('00000000-0000-0000-0000-' || lpad(p, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.lg() RETURNS uuid LANGUAGE sql AS
  $$ SELECT id FROM ledger WHERE scope_id = pg_temp.id('54d001') $$;

INSERT INTO party (kind, legal_name) SELECT 'PLATFORM', 'Plateforme (test)'
 WHERE NOT EXISTS (SELECT 1 FROM party WHERE kind = 'PLATFORM');
INSERT INTO party (id, kind, legal_name, country_code) VALUES (pg_temp.id('54a001'), 'OPERATOR', 'Prestataire 54', 'SN');
INSERT INTO party (id, kind, operator_id, legal_name)
VALUES (pg_temp.id('54b001'), 'ORGANIZER', pg_temp.id('54a001'), 'Organisateur 54');
INSERT INTO jurisdiction_profile (id, country_code, version, valid_from, breakage_destination)
VALUES (pg_temp.id('54c001'), 'SN', 540054, '2026-01-01', 'ORGANIZER');
INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone, jurisdiction_id, funds_holder, status)
VALUES (pg_temp.id('54d001'), pg_temp.id('54a001'), pg_temp.id('54b001'), 'Événement 54', 'XOF', 'Africa/Dakar',
        pg_temp.id('54c001'), 'ORGANIZER', 'LIVE');
SELECT set_config('app.operator_id', pg_temp.id('54a001')::text, true);
SELECT open_event_ledger(pg_temp.id('54d001'));

INSERT INTO wallet (id, operator_id, ledger_id, status)
SELECT pg_temp.id('54f00' || n), pg_temp.id('54a001'), pg_temp.lg(), CASE WHEN n = 2 THEN 'BLOCKED' ELSE 'ACTIVE' END
  FROM generate_series(1, 6) n;
INSERT INTO account (operator_id, ledger_id, code, family, purpose, wallet_id, normal_side)
SELECT pg_temp.id('54a001'), pg_temp.lg(), 'L-WAL-54-' || n, 'CLAIM', 'WALLET_PAID', pg_temp.id('54f00' || n), 'C'
  FROM generate_series(1, 6) n;
INSERT INTO account (operator_id, ledger_id, code, family, purpose, normal_side)
VALUES (pg_temp.id('54a001'), pg_temp.lg(), 'A-BANK-54', 'ASSET', 'BANK', 'D');
INSERT INTO tag_key (operator_id, key_index, kms_key_ref, status) VALUES (pg_temp.id('54a001'), 1, 'test:hmac-54', 'ACTIVE');
INSERT INTO tag_data_key (id, operator_id, key_index, version, wrapping_kms_key_ref, encrypted_dek)
VALUES (pg_temp.id('54d0d0'), pg_temp.id('54a001'), 1, 1, 'test:wrap-54', '\x01');
INSERT INTO media_batch (id, operator_id, organizer_id, event_id, kind, quantity, key_index) VALUES
 (pg_temp.id('54f901'), pg_temp.id('54a001'), pg_temp.id('54b001'), pg_temp.id('54d001'), 'PUBLIC', 9, 1),
 (pg_temp.id('54f902'), pg_temp.id('54a001'), pg_temp.id('54b001'), pg_temp.id('54d001'), 'PUBLIC', 9, 1);
-- Six bracelets : un par portefeuille ; m5 et m6 dans le lot 2, les autres dans le lot 1 ; m7 sans lot.
INSERT INTO media (id, operator_id, kind, token_hash, nfc_uid, batch_id, key_index, wallet_id,
                   originality_sig_sha256, pwd_pack_enc, pwd_pack_dek_id)
SELECT pg_temp.id('54f10' || n), pg_temp.id('54a001'), 'NFC_TAG', sha256(convert_to('m54-' || n, 'UTF8')),
       decode('0454000000000' || n, 'hex'),
       CASE WHEN n IN (5, 6) THEN pg_temp.id('54f902') WHEN n = 4 THEN NULL ELSE pg_temp.id('54f901') END,
       1, pg_temp.id('54f00' || n), sha256(convert_to('sig' || n, 'UTF8')), decode(repeat('aa', 34), 'hex'),
       pg_temp.id('54d0d0')
  FROM generate_series(1, 6) n;
-- Septième bracelet : porté par un portefeuille d'un AUTRE grand livre (autre événement) ; son jeton figure pourtant
-- dans l'état du premier grand livre, il doit y ressortir comme retrait (0055 : EXCEPT limité aux portefeuilles du
-- grand livre lu).
INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone, jurisdiction_id, funds_holder, status)
VALUES (pg_temp.id('54d002'), pg_temp.id('54a001'), pg_temp.id('54b001'), 'Événement 54 bis', 'XOF', 'Africa/Dakar',
        pg_temp.id('54c001'), 'ORGANIZER', 'LIVE');
SELECT open_event_ledger(pg_temp.id('54d002'));
INSERT INTO wallet (id, operator_id, ledger_id, status)
SELECT pg_temp.id('54f007'), pg_temp.id('54a001'), id, 'ACTIVE' FROM ledger WHERE scope_id = pg_temp.id('54d002');
INSERT INTO media (id, operator_id, kind, token_hash, nfc_uid, batch_id, key_index, wallet_id,
                   originality_sig_sha256, pwd_pack_enc, pwd_pack_dek_id)
VALUES (pg_temp.id('54f107'), pg_temp.id('54a001'), 'NFC_TAG', sha256(convert_to('m54-7', 'UTF8')),
        decode('04540000000007', 'hex'), NULL, 1, pg_temp.id('54f007'), sha256(convert_to('sig7', 'UTF8')),
        decode(repeat('aa', 34), 'hex'), pg_temp.id('54d0d0'));
-- Ancienneté : tout l'historique créé par les insertions est repoussé à il y a une heure.
UPDATE media_assignment SET assigned_at = now() - interval '1 hour';
UPDATE media_status_history SET at = now() - interval '1 hour';
UPDATE media_batch_status_history SET at = now() - interval '1 hour';
-- État : les six jetons, plus le jeton du bracelet 7 (autre grand livre), un jeton orphelin (aucun média) et un jeton
-- déjà retiré.
INSERT INTO offline_snapshot_state (ledger_id, operator_id, token_hash, entry_sha256, last_version, removed)
SELECT pg_temp.lg(), pg_temp.id('54a001'), sha256(convert_to('m54-' || n, 'UTF8')), sha256('e'), 1, false
  FROM generate_series(1, 6) n
UNION ALL SELECT pg_temp.lg(), pg_temp.id('54a001'), sha256(convert_to('m54-7', 'UTF8')), sha256('e'), 1, false
UNION ALL SELECT pg_temp.lg(), pg_temp.id('54a001'), sha256('orphelin'), sha256('e'), 1, false
UNION ALL SELECT pg_temp.lg(), pg_temp.id('54a001'), sha256('deja-retire'), sha256('e'), 1, true;

-- Comparaison : même ensemble de lignes (colonne par colonne) ancien/nouveau pour une date de départ.
CREATE FUNCTION pg_temp.same(p_since timestamptz, p_label text) RETURNS text LANGUAGE sql AS $$
  SELECT results_eq(
    format($q$ SELECT token_hash, media_id, entry, pwd_pack_enc, pwd_pack_dek_id, key_index, nfc_uid, removed
                FROM offline_snapshot_source_rows(%L, %L) ORDER BY token_hash $q$, pg_temp.lg(), p_since),
    format($q$ SELECT token_hash, media_id, entry, pwd_pack_enc, pwd_pack_dek_id, key_index, nfc_uid, removed
                FROM pg_temp.old_rows(%L, %L) ORDER BY token_hash $q$, pg_temp.lg(), p_since),
    p_label) $$;
CREATE FUNCTION pg_temp.n(p_since timestamptz) RETURNS int LANGUAGE sql AS
  $$ SELECT count(*)::int FROM offline_snapshot_source_rows(pg_temp.lg(), p_since) $$;

CREATE FUNCTION pg_temp.old_rows(p_ledger uuid, p_since timestamptz)
RETURNS TABLE (token_hash bytea, media_id uuid, entry jsonb, pwd_pack_enc bytea, pwd_pack_dek_id uuid,
               key_index int, nfc_uid bytea, removed boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
#variable_conflict use_column
DECLARE v_t0 timestamptz := p_since - interval '5 seconds';
BEGIN
  PERFORM assert_tenant(tenant_of_ledger(p_ledger));
  RETURN QUERY
  WITH live AS NOT MATERIALIZED (
    SELECT r.*, m.batch_id AS media_batch_id
      FROM offline_snapshot_rows r JOIN media m ON m.id = r.media_id
     WHERE r.ledger_id = p_ledger),
  changed_wallets AS (
    SELECT DISTINCT a.wallet_id
      FROM journal_transaction jt
      JOIN posting po ON po.ledger_id = jt.ledger_id AND po.transaction_id = jt.id
      JOIN account a ON a.id = po.account_id
     WHERE p_since IS NOT NULL AND jt.ledger_id = p_ledger AND jt.recorded_at > v_t0
       AND a.purpose IN ('WALLET_PAID','WALLET_PROMO') AND a.wallet_id IS NOT NULL)
  SELECT l.token_hash, l.media_id,
         jsonb_build_object(
           'token_hash', encode(l.token_hash, 'hex'),
           'nfc_uid', encode(l.nfc_uid, 'hex'),
           'key_index', l.key_index,
           'originality_sig_sha256', encode(l.originality_sig_sha256, 'hex'),
           'status', l.status,
           'batch_event_id', l.batch_event_id,
           'batch_status', l.batch_status,
           'wallet_status', l.wallet_status,
           'spendable', l.spendable,
           'last_counter', l.last_counter,
           'pwd_pack_sha256', NULL::text),
         l.pwd_pack_enc, l.pwd_pack_dek_id, l.key_index, l.nfc_uid, false
    FROM live l
   WHERE p_since IS NULL
      OR l.wallet_status <> 'ACTIVE'
      OR l.wallet_id IN (SELECT w.wallet_id FROM changed_wallets w)
      OR EXISTS (SELECT 1 FROM media_status_history h
                  WHERE h.media_id = l.media_id AND h.at > v_t0)
      OR (l.media_batch_id IS NOT NULL
          AND EXISTS (SELECT 1 FROM media_batch_status_history h
                       WHERE h.batch_id = l.media_batch_id AND h.at > v_t0))
      OR EXISTS (SELECT 1 FROM media_assignment ma
                  WHERE ma.media_id = l.media_id AND ma.wallet_id = l.wallet_id
                    AND (ma.assigned_at > v_t0 OR ma.released_at > v_t0))
  UNION ALL
  SELECT st.token_hash, NULL::uuid, NULL::jsonb, NULL::bytea, NULL::uuid, NULL::int, NULL::bytea, true
    FROM offline_snapshot_state st
   WHERE st.ledger_id = p_ledger
     AND NOT EXISTS (SELECT 1 FROM live l WHERE l.token_hash = st.token_hash)
     AND (p_since IS NULL OR NOT st.removed);
END $$;


-- 1. Rien n'a changé depuis une minute : seuls le portefeuille bloqué (w2), le jeton orphelin et le jeton du bracelet 7 (autre grand livre) ressortent.
SELECT pg_temp.same(clock_timestamp(), 'équivalence : aucun changement récent');
SELECT is(pg_temp.n(clock_timestamp()), 3, 'aucun changement récent : bloqué + orphelin + bracelet d''un autre grand livre retirés');
SELECT pg_temp.same(NULL, 'équivalence : FULL (date nulle)');
SELECT is(pg_temp.n(NULL), 9, 'FULL : 6 vivants + bracelet 7 + orphelin + déjà retiré');

-- 2. Statut d'un bracelet (historique de statut).
INSERT INTO media_status_history (operator_id, media_id, from_status, to_status, at)
VALUES (pg_temp.id('54a001'), pg_temp.id('54f101'), 'ISSUED', 'SUSPENDED', clock_timestamp());
SELECT pg_temp.same(clock_timestamp() - interval '1 minute', 'équivalence : historique de statut');
SELECT is(pg_temp.n(clock_timestamp() - interval '1 minute'), 4, 'historique de statut : m1 repris');

-- 3. Historique de lot : m5 et m6 repris.
INSERT INTO media_batch_status_history (operator_id, batch_id, from_status, to_status, at)
VALUES (pg_temp.id('54a001'), pg_temp.id('54f902'), 'ACTIVE', 'SUSPENDED', clock_timestamp());
SELECT pg_temp.same(clock_timestamp() - interval '1 minute', 'équivalence : historique de lot');
SELECT is(pg_temp.n(clock_timestamp() - interval '1 minute'), 6, 'historique de lot : m5 et m6 repris');

-- 4. Solde : écriture sur le portefeuille w3.
SELECT post_transaction(pg_temp.lg(), 'TOPUP_CASH', 'T54-1', clock_timestamp(), 'ONLINE',
  jsonb_build_array(
    jsonb_build_object('account_id', (SELECT id FROM account WHERE code = 'A-BANK-54'), 'amount', 300),
    jsonb_build_object('account_id', (SELECT id FROM account WHERE code = 'L-WAL-54-3'), 'amount', -300)));
SELECT pg_temp.same(clock_timestamp() - interval '1 minute', 'équivalence : solde modifié');
SELECT is(pg_temp.n(clock_timestamp() - interval '1 minute'), 7, 'solde : m3 repris');

-- 5. Rattachement libéré (retrait) et rattachement récent d'un bracelet.
UPDATE media_assignment SET released_at = clock_timestamp(), release_reason = 'RETURNED'
 WHERE media_id = pg_temp.id('54f104') AND released_at IS NULL;
SELECT pg_temp.same(clock_timestamp() - interval '1 minute', 'équivalence : rattachement libéré');
SELECT is((SELECT count(*)::int FROM offline_snapshot_source_rows(pg_temp.lg(), clock_timestamp() - interval '1 minute')
            WHERE removed AND token_hash = sha256(convert_to('m54-4', 'UTF8'))), 1, 'rattachement libéré : m4 retiré');
UPDATE media_assignment SET assigned_at = clock_timestamp() WHERE media_id = pg_temp.id('54f106') AND released_at IS NULL;
SELECT pg_temp.same(clock_timestamp() - interval '1 minute', 'équivalence : rattachement récent');

-- 6. Date de départ très ancienne, très récente, et recouvrement de 5 s.
SELECT pg_temp.same(now() - interval '2 hours', 'équivalence : départ ancien');
SELECT pg_temp.same(clock_timestamp() + interval '1 hour', 'équivalence : départ dans le futur');
SELECT pg_temp.same(clock_timestamp() + interval '3 seconds', 'équivalence : bord du recouvrement de 5 s');

-- 7. Droits et garde de prestataire inchangés.
SELECT set_config('app.operator_id', pg_temp.id('54a002')::text, true);
SELECT throws_ok($$SELECT * FROM offline_snapshot_source_rows(pg_temp.lg(), NULL)$$, 'P0002', NULL,
       'un autre prestataire ne lit pas la source (assert_tenant)');

SELECT * FROM finish();
ROLLBACK;
