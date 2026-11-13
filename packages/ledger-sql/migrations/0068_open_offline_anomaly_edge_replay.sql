-- Migration 0068 : open_offline_anomaly accepte EDGE_REPLAY_FAILED (mission passerelle-locale, lot WP14 ; R-23,
-- décision 46 du porteur : plus d'INSERT direct dans `anomaly` pour le journal des terminaux après reprise forcée).
--
-- Seul changement par rapport à 0047 : douzième type permis, EDGE_REPLAY_FAILED, avec grand livre, porteur de la perte
-- et detail.origin_key exigés (CL001 sinon), idempotent par (prestataire, clé d'origine) avec le MÊME verrou
-- consultatif que edge_open_replay_failed (0062) : les deux voies se retrouvent l'une l'autre. Les onze autres types
-- sont inchangés (corps repris de 0047). CREATE OR REPLACE conserve la signature, SECURITY DEFINER, search_path et les
-- droits : aucun GRANT ni REVOKE nouveau, post-roles.sql inchangé (open_offline_anomaly reste accordée à cashless_app).
-- A faire relire par une personne (CLAUDE.md, règle 4) : fonction SECURITY DEFINER qui écrit hors des droits de l'appelant.

CREATE OR REPLACE FUNCTION open_offline_anomaly(p_ledger uuid, p_kind text, p_device uuid, p_media uuid, p_seq bigint,
                                     p_tx uuid, p_amount bigint, p_loss_bearer text, p_detail jsonb,
                                     p_batch uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_op uuid;
  v_id uuid;
BEGIN
  IF p_kind IS NULL OR p_kind NOT IN ('OFFLINE_SHORTFALL','SEQ_GAP','CHAIN_BROKEN','CLOCK_SKEW',
       'SIGNATURE_MISMATCH','NON_COMPLIANT_OPERATION','PERIOD_CLOSED_OPERATION','LATE_OFFLINE_SYNC',
       'IDEMPOTENCY_CONFLICT','VOID_CONFLICT','ONLINE_CONFIRMED_MISSING','EDGE_REPLAY_FAILED') THEN
    RAISE EXCEPTION 'Anomalie : type % non ouvrable par cette fonction', p_kind USING ERRCODE = 'CL001';
  END IF;
  IF p_amount IS NULL OR p_amount < 0 THEN
    RAISE EXCEPTION 'Anomalie : montant négatif ou absent' USING ERRCODE = 'CL001';
  END IF;
  IF p_loss_bearer IS NOT NULL AND p_loss_bearer NOT IN ('OPERATOR','ORGANIZER','MERCHANT') THEN
    RAISE EXCEPTION 'Anomalie : porteur de la perte inconnu' USING ERRCODE = 'CL001';
  END IF;
  IF p_detail IS NOT NULL AND jsonb_typeof(p_detail) <> 'object' THEN
    RAISE EXCEPTION 'Anomalie : le détail doit être un objet JSON' USING ERRCODE = 'CL001';
  END IF;
  IF p_kind = 'OFFLINE_SHORTFALL' AND (p_amount = 0 OR p_tx IS NULL) THEN
    RAISE EXCEPTION 'Manque : montant positif et transaction exigés' USING ERRCODE = 'CL001';
  END IF;
  IF p_kind = 'NON_COMPLIANT_OPERATION' AND p_loss_bearer IS NULL THEN
    RAISE EXCEPTION 'Opération non conforme : porteur de la perte exigé' USING ERRCODE = 'CL001';
  END IF;

  IF p_kind = 'EDGE_REPLAY_FAILED' AND (p_ledger IS NULL OR p_loss_bearer IS NULL
       OR coalesce(p_detail ->> 'origin_key', '') = '') THEN
    RAISE EXCEPTION 'Rejeu impossible : grand livre, porteur de la perte et clé d''origine exigés'
      USING ERRCODE = 'CL001';
  END IF;

  -- Prestataire : celui du grand livre ; sans grand livre (anomalie de sécurité sans montant), celui du terminal
  -- puis du bracelet.
  IF p_ledger IS NOT NULL THEN
    v_op := tenant_of_ledger(p_ledger);
  ELSE
    IF p_amount <> 0 THEN
      RAISE EXCEPTION 'Anomalie avec montant : grand livre exigé' USING ERRCODE = 'CL001';
    END IF;
    v_op := coalesce(tenant_of_device(p_device), tenant_of_media(p_media));
  END IF;
  PERFORM assert_tenant(v_op);

  -- Objets cités : même prestataire que l'anomalie
  IF (p_device IS NOT NULL AND tenant_of_device(p_device) IS DISTINCT FROM v_op)
     OR (p_media IS NOT NULL AND tenant_of_media(p_media) IS DISTINCT FROM v_op)
     OR (p_tx IS NOT NULL AND NOT EXISTS (SELECT 1 FROM journal_transaction WHERE id = p_tx AND operator_id = v_op))
     OR (p_batch IS NOT NULL AND NOT EXISTS (SELECT 1 FROM offline_batch WHERE id = p_batch AND operator_id = v_op))
  THEN
    RAISE EXCEPTION 'Anomalie : objet cité absent ou d''un autre prestataire' USING ERRCODE = 'CL001';
  END IF;

  IF p_kind = 'EDGE_REPLAY_FAILED' THEN
    -- Idempotence par (prestataire, clé d'origine), même verrou et même recherche que edge_open_replay_failed (0062) :
    -- une anomalie déjà ouverte par EDGE_SYNC ou par le journal d'un terminal pour cette clé est retrouvée.
    PERFORM pg_advisory_xact_lock(hashtextextended('edge-replay-failed:' || v_op || ':' || (p_detail ->> 'origin_key'), 0));
    SELECT a.id INTO v_id FROM anomaly a
     WHERE a.operator_id = v_op AND a.kind = 'EDGE_REPLAY_FAILED' AND a.detail ->> 'origin_key' = p_detail ->> 'origin_key'
     ORDER BY a.created_at, a.id LIMIT 1;
    IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  ELSE
    PERFORM pg_advisory_xact_lock(hashtextextended('anomaly:' || v_op::text || ':' || p_kind || ':'
      || coalesce(p_device::text, '') || ':' || coalesce(p_seq::text, '~') || ':' || coalesce(p_tx::text, ''), 0));

    SELECT a.id INTO v_id FROM anomaly a
     WHERE a.operator_id = v_op AND a.kind = p_kind
       AND a.device_id IS NOT DISTINCT FROM p_device
       AND a.seq IS NOT DISTINCT FROM p_seq
       AND a.transaction_id IS NOT DISTINCT FROM p_tx
     ORDER BY a.created_at, a.id LIMIT 1;
    IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  END IF;

  INSERT INTO anomaly (operator_id, ledger_id, kind, media_id, device_id, seq, transaction_id, amount,
                       loss_bearer, detail, batch_id)
  VALUES (v_op, p_ledger, p_kind, p_media, p_device, p_seq, p_tx, p_amount, p_loss_bearer, p_detail, p_batch)
  ON CONFLICT (device_id, seq) WHERE kind = 'SEQ_GAP' DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    -- SEQ_GAP déjà ouvert pour ce (terminal, numéro) par une autre voie : on rend cette ligne
    SELECT a.id INTO v_id FROM anomaly a
     WHERE a.kind = 'SEQ_GAP' AND a.device_id = p_device AND a.seq = p_seq;
  END IF;
  RETURN v_id;
END $$;
