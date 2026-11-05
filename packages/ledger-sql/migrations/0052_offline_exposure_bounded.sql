-- 0052 : exposition « non acquittée » bornée (mission hors-ligne-snapshots-lots, WP21 partie F ; NFR-003).
--
-- Constat (mesure de la partie A, puis profil de la partie F) : sur un lot de 500 ventes, `offline_device_exposure`
-- (0048, 0049) coûtait 31 ms par appel au premier lot, 40 ms au deuxième, 66 ms au quatrième, soit 15,7 s, 20,0 s puis
-- 33,2 s d'un lot dont la durée était 60,4 s, 72,8 s puis 73,8 s : le coût croît avec l'historique du terminal.
-- Deux causes :
--   (1) la somme des lignes `posting` de l'écriture était évaluée TROIS fois par vente (filtre `amount > 0`, puis
--       les deux agrégats de la sortie, la requête commune étant dépliée) ;
--   (2) la fonction joignait TOUT l'historique du terminal (registre, écriture, lot, lignes) avant de retirer les
--       ventes acquittées : le travail suivait le nombre de ventes passées, pas le nombre de ventes non acquittées.
--
-- Correction, sans changer le résultat (mêmes lignes comptées, mêmes erreurs, même signature, même ACL : CREATE OR
-- REPLACE conserve les droits, aucun GRANT ici) : les ventes non acquittées sont désignées d'abord, par trois
-- parties exclusives qui reprennent la règle de 0048 :
--   A. canal BATCH rattaché à un lot : le lot n'est pas terminé (`completed_at` NULL : en cours, rejeté) ou l'a été
--      à `p_reference - p_tol` ou après (strict) ;
--   B. résultat jamais connu : canal BATCH sans lot, ou canal hors BATCH/ONLINE (EDGE) : compté toujours ;
--   C. canal ONLINE inscrit à `p_reference - p_tol` ou après.
-- Le montant (somme WALLET_PAID + WALLET_PROMO, débit du portefeuille) n'est calculé qu'ensuite, UNE fois par vente
-- désignée, puis seules les sommes strictement positives comptent, comme avant. Le compte d'une ligne est lu par sa
-- clé primaire (sous-requête), non joint : le plan reste une recherche par clé même quand les statistiques sont
-- neuves ou absentes (un balayage de `account` par vente coûtait 2,5 fois plus sur le jeu de mesure).
-- Aucun contrôle n'est retiré : `assert_tenant`, les refus CL001, le filtre de prestataire explicite sur chaque
-- table, SECURITY DEFINER et le `search_path` figé sont inchangés. Le total ne change pas (tests_offline_device_vendor
-- et tests_offline_exposure_bounded).
--
-- Index (les trois dans le modèle du prestataire, aucun droit nouveau) :
--   device_seq_registry_batch_idx   : lignes du registre d'un lot (branche A) ;
--   device_seq_registry_online_idx  : ventes ONLINE d'un terminal par date d'inscription (branche C) ;
--   device_seq_registry_unknown_idx : ventes sans résultat connu (branche B), peu nombreuses ;
--   offline_batch_completed_idx     : lots non terminés ou récents (branche A).
CREATE INDEX device_seq_registry_batch_idx ON device_seq_registry (batch_id)
  WHERE batch_id IS NOT NULL AND transaction_id IS NOT NULL;
CREATE INDEX device_seq_registry_online_idx ON device_seq_registry (device_id, recorded_at)
  WHERE channel = 'ONLINE' AND transaction_id IS NOT NULL;
CREATE INDEX device_seq_registry_unknown_idx ON device_seq_registry (device_id, seq)
  WHERE transaction_id IS NOT NULL AND channel <> 'ONLINE' AND (channel <> 'BATCH' OR batch_id IS NULL);
CREATE INDEX offline_batch_completed_idx ON offline_batch (completed_at);

CREATE OR REPLACE FUNCTION offline_device_exposure(p_device uuid, p_media uuid, p_seq bigint,
                                        p_reference timestamptz, p_tol interval)
RETURNS TABLE (per_media bigint, per_device bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_operator uuid := nullif(current_setting('app.operator_id', true), '')::uuid;
  v_since timestamptz;
BEGIN
  PERFORM assert_tenant(tenant_of_device(p_device));
  IF p_seq IS NULL OR p_reference IS NULL OR p_tol IS NULL OR p_tol < interval '0' THEN
    RAISE EXCEPTION 'Exposition : numéro, heure de référence ou tolérance invalide'
      USING ERRCODE = 'CL001';
  END IF;
  v_since := p_reference - p_tol;
  RETURN QUERY
    WITH unacked AS (
      -- A. lot connu, pas encore terminé ou terminé à v_since ou après
      SELECT r.transaction_id
        FROM offline_batch b
        JOIN device_seq_registry r ON r.batch_id = b.id AND r.operator_id = b.operator_id
       WHERE b.operator_id = v_operator
         AND (b.completed_at IS NULL OR b.completed_at >= v_since)
         AND r.operator_id = v_operator AND r.device_id = p_device AND r.seq < p_seq
         AND r.channel = 'BATCH' AND r.transaction_id IS NOT NULL
         AND r.outcome IN ('ACCEPTED','ACCEPTED_WITH_SHORTFALL')
      UNION ALL
      -- B. résultat jamais connu : toujours compté
      SELECT r.transaction_id
        FROM device_seq_registry r
       WHERE r.operator_id = v_operator AND r.device_id = p_device AND r.seq < p_seq
         AND r.transaction_id IS NOT NULL AND r.channel <> 'ONLINE'
         AND (r.channel <> 'BATCH' OR r.batch_id IS NULL)
         AND r.outcome IN ('ACCEPTED','ACCEPTED_WITH_SHORTFALL')
      UNION ALL
      -- C. canal en ligne inscrit à v_since ou après
      SELECT r.transaction_id
        FROM device_seq_registry r
       WHERE r.operator_id = v_operator AND r.device_id = p_device AND r.seq < p_seq
         AND r.transaction_id IS NOT NULL AND r.channel = 'ONLINE' AND r.recorded_at >= v_since
         AND r.outcome IN ('ACCEPTED','ACCEPTED_WITH_SHORTFALL')
    ), sales AS (
      SELECT jt.media_id AS media_id, x.amount
        FROM unacked u
        JOIN journal_transaction jt
          ON jt.id = u.transaction_id AND jt.operator_id = v_operator AND jt.type = 'PURCHASE'
        CROSS JOIN LATERAL (
          SELECT coalesce(sum(p.amount), 0) AS amount
            FROM posting p
           WHERE p.transaction_id = jt.id AND p.operator_id = v_operator
             AND (SELECT a.purpose FROM account a WHERE a.id = p.account_id) IN ('WALLET_PAID','WALLET_PROMO')) x
       WHERE x.amount > 0
    )
    SELECT coalesce(sum(s.amount) FILTER (WHERE s.media_id = p_media), 0)::bigint,
           coalesce(sum(s.amount), 0)::bigint
      FROM sales s;
END $$;
