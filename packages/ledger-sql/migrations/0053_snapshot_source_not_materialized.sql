-- 0053 : lecture des changements d'un snapshot sans calculer toutes les lignes du grand livre
-- (mission hors-ligne-snapshots-lots, WP21 partie G ; NFR-005, blocage visible en 5 s au plus).
--
-- Constat : `offline_snapshot_source_rows` nomme la vue `offline_snapshot_rows` dans une expression de table `live`
-- lue deux fois (candidats, puis « jeton de l'état absent de la vue »). PostgreSQL matérialise alors la vue entière,
-- avec ses sous-requêtes par ligne (solde, dernier compteur) : environ 3 s pour 50 000 bracelets, même pour un
-- DELTA d'une seule ligne, et à chaque passage du travailleur. Un blocage attendait donc deux passages (6 à 8 s).
-- Correction : `AS NOT MATERIALIZED`. Les sous-requêtes ne sont plus évaluées que pour les lignes gardées
-- (environ 0,5 s). Même fonction, mêmes colonnes, mêmes lignes, même ordre d'évaluation des droits (assert_tenant
-- d'abord), mêmes droits (CREATE OR REPLACE conserve propriétaire et ACL) : seul le plan d'exécution change.
-- Aucun droit, aucune colonne, aucun format ne change.

CREATE OR REPLACE FUNCTION offline_snapshot_source_rows(p_ledger uuid, p_since timestamptz)
RETURNS TABLE (token_hash bytea, media_id uuid, entry jsonb, pwd_pack_enc bytea, pwd_pack_dek_id uuid,
               key_index int, nfc_uid bytea, removed boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
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
