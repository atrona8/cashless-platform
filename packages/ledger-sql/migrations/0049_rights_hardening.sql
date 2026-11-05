-- 0049 : durcissement des droits (mission hors-ligne-snapshots-lots, WP08).
--
-- Les droits (rôles, EXECUTE nominatifs, retraits à cashless_app, défaut global OP-N68) sont posés par
-- `post-roles.sql`, rejoué à chaque série par migrate.ts (section 8). Cette migration porte seulement ce qui ne
-- peut pas y aller : une correction de fonction (1) et une politique d'écriture de l'audit (2).
--
-- 1. offline_device_exposure (renforcement)
--
-- Renforcement décidé par l'orchestrateur (30/10/2026, relecture de WP07) : `offline_device_exposure` (0048)
-- joignait `journal_transaction.device_id = device_seq_registry.device_id`. Or `post_transaction` permet un
-- `device_id` NULL : une vente hors ligne ainsi écrite sortait du total d'exposition sans erreur (exposition
-- sous-estimée). Le registre du terminal (`device_seq_registry.device_id = p_device`, `transaction_id` non nul)
-- suffit à rattacher la vente au terminal : la condition sur `journal_transaction.device_id` est retirée.
-- Signature, refus et résultat inchangés ; le total ne peut que croître (plus strict).
-- Droits : CREATE OR REPLACE conserve l'ACL (aucun GRANT ici).
--
-- 2. Audit des clés de signature : écrivain unique (renforcement, relecture de WP09, 30/10/2026)
--    Le travailleur snapshot-key-admin (cashless_keyadmin) reprend une rotation interrompue en adoptant la
--    référence KMS de la dernière ligne d'audit SNAPSHOT_SIGNING_KEY_CREATED. Une ligne forgée par un autre rôle
--    (cashless_app, cashless_platform, rôles des clés…) ferait adopter une clé que l'exploitant n'a pas créée.
--    Politique RESTRICTIVE d'INSERT (elle s'ajoute en ET aux politiques permissives, pour tous les rôles) : les
--    actions SNAPSHOT_SIGNING_KEY_* ne s'écrivent que sous cashless_keyadmin ; toute autre action est inchangée.
--    Aucun droit n'est retiré ni élargi : cashless_app écrit toujours ses propres actions. La politique permissive
--    qui laisse cashless_keyadmin écrire et lire ces lignes (operator_id NULL) est dans post-roles.sql §8h.
--    Limite : un propriétaire des tables non superutilisateur, soumis à la RLS forcée, est refusé aussi pour ces
--    actions (il n'en écrit aucune) ; un superutilisateur contourne toute RLS (hors périmètre de ce contrôle).
DROP POLICY IF EXISTS snapshot_signing_key_audit_writer ON audit_log;
CREATE POLICY snapshot_signing_key_audit_writer ON audit_log AS RESTRICTIVE FOR INSERT
  WITH CHECK (action NOT LIKE 'SNAPSHOT\_SIGNING\_KEY\_%' OR current_user = 'cashless_keyadmin');

CREATE OR REPLACE FUNCTION offline_device_exposure(p_device uuid, p_media uuid, p_seq bigint,
                                        p_reference timestamptz, p_tol interval)
RETURNS TABLE (per_media bigint, per_device bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_operator uuid := nullif(current_setting('app.operator_id', true), '')::uuid;
BEGIN
  PERFORM assert_tenant(tenant_of_device(p_device));
  IF p_seq IS NULL OR p_reference IS NULL OR p_tol IS NULL OR p_tol < interval '0' THEN
    RAISE EXCEPTION 'Exposition : numéro, heure de référence ou tolérance invalide'
      USING ERRCODE = 'CL001';
  END IF;
  RETURN QUERY
    WITH sales AS (
      SELECT jt.media_id AS media_id,
             (SELECT coalesce(sum(p.amount), 0)
                FROM posting p JOIN account a ON a.id = p.account_id
               WHERE p.transaction_id = jt.id AND p.operator_id = v_operator
                 AND a.purpose IN ('WALLET_PAID','WALLET_PROMO')) AS amount,
             CASE r.channel WHEN 'BATCH' THEN b.completed_at
                            WHEN 'ONLINE' THEN r.recorded_at END AS acked_at
        FROM device_seq_registry r
        JOIN journal_transaction jt
          ON jt.id = r.transaction_id AND jt.operator_id = r.operator_id
         AND jt.type = 'PURCHASE'
        LEFT JOIN offline_batch b ON b.id = r.batch_id AND b.operator_id = r.operator_id
       WHERE r.operator_id = v_operator AND r.device_id = p_device AND r.seq < p_seq
         AND r.transaction_id IS NOT NULL
         AND r.outcome IN ('ACCEPTED','ACCEPTED_WITH_SHORTFALL')
    ), unacked AS (
      SELECT s.media_id, s.amount FROM sales s
       WHERE s.amount > 0 AND (s.acked_at IS NULL OR s.acked_at >= p_reference - p_tol)
    )
    SELECT coalesce(sum(u.amount) FILTER (WHERE u.media_id = p_media), 0)::bigint,
           coalesce(sum(u.amount), 0)::bigint
      FROM unacked u;
END $$;

-- 3. lock_device : verrou de ligne du terminal pour l'API (renforcement, relecture de WP08, cycle 1, B1)
--    `SELECT … FROM device … FOR UPDATE | FOR NO KEY UPDATE` exige le privilège UPDATE sur la table. OP-N69 retire
--    tout UPDATE sur device à cashless_app (colonnes comprises) : les verrous de l'API (record_device_seq,
--    paiement, annulation, recharge espèces, configuration servie) échoueraient en 42501. Au lieu d'accorder un
--    UPDATE de colonne (affaiblissement), cette fonction DEFINER prend le verrou à la place de l'appelant.
--    Le verrou, pris dans la transaction de l'appelant, est tenu jusqu'à sa fin. La fonction ne lit rien et ne
--    rend qu'un booléen d'existence ; le terminal doit appartenir au prestataire courant (app.operator_id), sinon
--    faux (l'appelant répond « introuvable »). Mode : 'UPDATE' ou 'NO KEY UPDATE', rien d'autre.
--    Droits : REVOKE ALL FROM PUBLIC ici ; EXECUTE à cashless_app seul (post-roles.sql 8d).
CREATE OR REPLACE FUNCTION lock_device(p_device uuid, p_mode text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_operator uuid := nullif(current_setting('app.operator_id', true), '')::uuid;
BEGIN
  IF v_operator IS NULL OR p_device IS NULL THEN
    RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found';
  END IF;
  IF p_mode = 'UPDATE' THEN
    PERFORM 1 FROM device WHERE id = p_device AND operator_id = v_operator FOR UPDATE;
  ELSIF p_mode = 'NO KEY UPDATE' THEN
    PERFORM 1 FROM device WHERE id = p_device AND operator_id = v_operator FOR NO KEY UPDATE;
  ELSE
    RAISE EXCEPTION 'Mode de verrou invalide' USING ERRCODE = 'CL001';
  END IF;
  RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION lock_device(uuid, text) FROM PUBLIC;
