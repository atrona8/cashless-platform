-- 0055 : détection des retraits d'un DELTA sans boucle imbriquée, robuste à l'absence de statistiques
-- (mission hors-ligne-snapshots-lots, WP21 partie I ; NFR-005, blocage visible en 5 s au plus).
--
-- Constat : juste après un chargement massif, avant l'autoanalyze, les statistiques des tables sont périmées. Le
-- planificateur estime alors ~277 lignes d'état et un seul vivant, et choisit pour le « NOT EXISTS » de 0054 (et de
-- 0053) une Nested Loop Anti Join avec un Materialize de ~50 000 lignes à l'intérieur : 50 000 x 50 000 comparaisons.
-- Le statement_timeout de 30 s du rôle coupe la lecture (reproduit sans statistiques : plus de 60 s) et le premier
-- blocage attend plus de 30 s.
-- Le FULL a le même défaut (20 000 bracelets sans statistiques : plus de 5 s, mesuré par le test dédié).
-- Correction : la détection des retraits, dans le FULL comme dans le DELTA, est écrite en EXCEPT (jetons de l'état moins jetons des médias ouverts du
-- grand livre) ; une opération ensembliste n'a pas de forme en boucle imbriquée (0,28 s sans statistiques, 0,22 s avec).
-- Le reste de la fonction (lignes vivantes du FULL et du DELTA) est celui de 0054, à l'identique.
-- Mêmes colonnes, mêmes lignes, mêmes droits (CREATE OR REPLACE conserve propriétaire et ACL), assert_tenant en
-- premier ; aucun droit, colonne ni format ne change.

CREATE OR REPLACE FUNCTION offline_snapshot_source_rows(p_ledger uuid, p_since timestamptz)
RETURNS TABLE (token_hash bytea, media_id uuid, entry jsonb, pwd_pack_enc bytea, pwd_pack_dek_id uuid,
               key_index int, nfc_uid bytea, removed boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE
  v_t0 timestamptz := p_since - interval '5 seconds';
  v_op uuid;
BEGIN
  v_op := tenant_of_ledger(p_ledger);
  PERFORM assert_tenant(v_op);
  IF p_since IS NULL THEN
    -- FULL : toutes les lignes vivantes, puis les retraits de l'état (requête de 0053).
    RETURN QUERY
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
      FROM offline_snapshot_rows l
     WHERE l.ledger_id = p_ledger
    UNION ALL
    -- Retraits du FULL : tous les jetons de l'état (retirés ou non) absents de la vue, en EXCEPT (clé primaire
    -- (ledger_id, token_hash) : un jeton une seule fois, EXCEPT rend le même ensemble).
    SELECT x.token_hash, NULL::uuid, NULL::jsonb, NULL::bytea, NULL::uuid, NULL::int, NULL::bytea, true
      FROM (SELECT st.token_hash
              FROM offline_snapshot_state st
             WHERE st.ledger_id = p_ledger
            EXCEPT
            SELECT l.token_hash
              FROM offline_snapshot_rows l
             WHERE l.ledger_id = p_ledger) x;
    RETURN;
  END IF;
  RETURN QUERY
  WITH changed_wallets AS MATERIALIZED (
    SELECT DISTINCT a.wallet_id
      FROM journal_transaction jt
      JOIN posting po ON po.ledger_id = jt.ledger_id AND po.transaction_id = jt.id
      JOIN account a ON a.id = po.account_id
     WHERE jt.ledger_id = p_ledger AND jt.recorded_at > v_t0
       AND a.purpose IN ('WALLET_PAID','WALLET_PROMO') AND a.wallet_id IS NOT NULL),
  -- Médias ouverts de CE grand livre pouvant vérifier l'une des cinq conditions (sur-ensemble ; le filtre d'origine
  -- est rejoué sur les lignes lues).
  cand AS MATERIALIZED (
    SELECT ma.media_id
      FROM media_assignment ma JOIN wallet w ON w.id = ma.wallet_id
     WHERE w.ledger_id = p_ledger AND ma.released_at IS NULL
       AND (w.status <> 'ACTIVE' OR w.id IN (SELECT c.wallet_id FROM changed_wallets c)
            OR ma.assigned_at > v_t0)
    UNION
    SELECT ma.media_id
      FROM media_status_history h
      JOIN media_assignment ma ON ma.media_id = h.media_id AND ma.released_at IS NULL
      JOIN wallet w ON w.id = ma.wallet_id AND w.ledger_id = p_ledger
     WHERE h.at > v_t0
    UNION
    SELECT ma.media_id
      FROM media_batch_status_history b
      JOIN media m ON m.batch_id = b.batch_id
      JOIN media_assignment ma ON ma.media_id = m.id AND ma.released_at IS NULL
      JOIN wallet w ON w.id = ma.wallet_id AND w.ledger_id = p_ledger
     WHERE b.at > v_t0
    UNION
    SELECT ma.media_id
      FROM media_assignment ma
      JOIN wallet w ON w.id = ma.wallet_id AND w.ledger_id = p_ledger
     WHERE ma.assigned_at > v_t0 OR ma.released_at > v_t0),
  live AS (
    SELECT r.*, m.batch_id AS media_batch_id
      FROM cand c
      JOIN offline_snapshot_rows r ON r.media_id = c.media_id AND r.ledger_id = p_ledger
      JOIN media m ON m.id = r.media_id)
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
   WHERE l.wallet_status <> 'ACTIVE'
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
  -- Retraits : jetons de l'état (non retirés) sans média ouvert dans ce grand livre. EXCEPT déduplique, ce qui rend le
  -- même ensemble : la clé primaire de offline_snapshot_state est (ledger_id, token_hash) (0044), donc un jeton n'y
  -- figure qu'une fois par grand livre.
  SELECT x.token_hash, NULL::uuid, NULL::jsonb, NULL::bytea, NULL::uuid, NULL::int, NULL::bytea, true
    FROM (SELECT st.token_hash
            FROM offline_snapshot_state st
           WHERE st.ledger_id = p_ledger AND NOT st.removed
          EXCEPT
          SELECT m.token_hash
            FROM media m
            JOIN media_assignment ma ON ma.media_id = m.id AND ma.released_at IS NULL
            JOIN wallet w ON w.id = ma.wallet_id AND w.ledger_id = p_ledger
           WHERE m.operator_id = v_op) x;
END $$;
