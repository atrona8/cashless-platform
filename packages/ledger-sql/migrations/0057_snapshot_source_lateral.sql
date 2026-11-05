-- 0057 : lecture de la vue des bracelets pilotée par les candidats, insensible aux estimations
-- (mission hors-ligne-snapshots-lots, WP21 partie I ; NFR-005, blocage visible en 5 s au plus).
--
-- Constat (statistiques périmées juste après un chargement massif, fenêtre du DELTA pleine) : le planificateur estime
-- `cand` à 124 lignes (portefeuilles estimés à 63 au lieu de 20 000) alors qu'il en contient 20 000, et fait de la
-- jointure `live` (cand JOIN offline_snapshot_rows JOIN media) une boucle imbriquée dont l'intérieur est un
-- « CTE Scan on cand » répété 20 000 fois : 20 000 x 20 000 comparaisons, 81 s mesurées.
-- Correction : `live` lit la vue par une jointure LATERAL avec OFFSET 0 (barrière d'optimisation), donc une lecture par
-- index par candidat, quelle que soit l'estimation. La vue produit une ligne par rattachement ouvert (média, devise) ;
-- `cand` est un ensemble (UNION) sans doublon, et la jointure interne latérale rend les mêmes lignes que la jointure
-- précédente. Mêmes colonnes (r.*), mêmes filtres.
-- Le reste de la fonction (FULL, cand, filtre final, retraits) est celui de 0055, à l'identique.
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
  -- Lecture de la vue pilotée par les candidats, une lecture par index par candidat. OFFSET 0 est une barrière
  -- d'optimisation : la sous-requête latérale n'est pas aplatie dans la jointure, donc `cand` reste à l'extérieur
  -- (boucle sur les candidats) et le planificateur ne peut pas la retourner en parcours de `cand` pour chaque ligne.
  live AS (
    SELECT r.*, m.batch_id AS media_batch_id
      FROM cand c
      CROSS JOIN LATERAL (
        SELECT r0.* FROM offline_snapshot_rows r0
         WHERE r0.media_id = c.media_id AND r0.ledger_id = p_ledger
        OFFSET 0) r
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
