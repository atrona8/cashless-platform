-- Migration 0047 : anomalies hors ligne derrière des fonctions, alertes à 24 h, historique du portefeuille
-- (mission hors-ligne-snapshots-lots, lot WP06 ; spec FR-019 à FR-021, FR-026, FR-031, FR-034 ;
-- research R-16, R-17, R-18 et R-30.11, R-30.13 (font foi) ; contracts/interfaces.md § 5).
--
-- Numéro : `interfaces.md` § 1 donne 0047 ; `data-model.md` écrit 0046 pour `anomaly` et
-- `wallet_status_history`. 0047 fait foi.
-- Type : `interfaces.md` § 5 écrit `bigint` pour l'identifiant d'anomalie ; `anomaly.id` est un `uuid`
-- (schéma de référence l.843, `psp_chargeback.anomaly_id uuid`). Le schéma prime (SPECIFICATION §0.3) : `uuid`
-- partout (open_offline_anomaly, mark_seq_gap_alerted, offline_seq_gaps_to_alert.anomaly_id).
--
-- Contenu :
--   1. `anomaly` : colonnes loss_bearer, detail (objet JSON), batch_id (lignes existantes : NULL).
--   2. open_offline_anomaly        seule voie d'écriture des anomalies de la mission (R-17), idempotente par
--                                  (kind, device, seq, tx), NULL égaux entre eux ; onze types permis :
--                                  OFFLINE_SHORTFALL, SEQ_GAP, CHAIN_BROKEN, CLOCK_SKEW, SIGNATURE_MISMATCH,
--                                  NON_COMPLIANT_OPERATION, PERIOD_CLOSED_OPERATION, LATE_OFFLINE_SYNC,
--                                  IDEMPOTENCY_CONFLICT, VOID_CONFLICT, ONLINE_CONFIRMED_MISSING (les autres
--                                  types du CHECK ne s'ouvrent pas par cette fonction : CL001). CLOCK_SKEW sert
--                                  aussi au chemin en ligne (p_batch et p_seq NULL, montant 0).
--      reduce_offline_shortfall   réduction d'un manque par une annulation (jamais fermé autrement)
--   3. Alertes (une seule par trou et par numéro RETRY) :
--      offline_seq_gaps_to_alert, mark_seq_gap_alerted (marqueur anomaly.detail.alerted_at, R-18),
--      offline_retries_to_alert, mark_offline_retry_alerted (offline_batch_retry.alerted_at, créée en 0046)
--   4. `wallet_status_history` + déclencheur log_wallet_status + ligne de départ ; offline_block_time.
--
-- Erreurs : CL001 paramètre ou état incohérent (type hors liste, montant négatif, objet d'un autre prestataire,
-- durée hors 0..30 jours, anomalie qui n'est pas un SEQ_GAP, montant de réduction hors 1..reste) ;
-- P0002 objet introuvable ou d'un autre prestataire (assert_tenant).
--
-- Hypothèse sur le propriétaire (comme 0022, 0036 et 0046) : le propriétaire des fonctions ignore la RLS
-- (superutilisateur sur le poste local). offline_seq_gaps_to_alert et offline_retries_to_alert n'ont pas de
-- prestataire de session (travailleur transversal) : elles listent toutes les lignes avec un propriétaire qui
-- ignore la RLS, sinon rien (échec fermé). Les fonctions d'écriture (open_, reduce_, mark_) font assert_tenant :
-- le travailleur pose `app.operator_id` de la ligne lue avant d'appeler mark_….
--
-- Aucun GRANT : les accords sont posés par le lot WP08 (qui retire aussi l'INSERT direct sur `anomaly` à
-- cashless_app). Toutes les fonctions : SECURITY DEFINER, `search_path = public, pg_temp`, EXECUTE retiré à PUBLIC.
--
-- Anomalie `CLOCK_SKEW` en ligne : payments.service.ts:186 insère directement ; WP16 le remplace par
-- open_offline_anomaly. Aucune contrainte d'unicité n'est ajoutée sur `anomaly` (open_offline_batch insère
-- CHAIN_BROKEN et SEQ_GAP à la main : un index ferait échouer un renvoi) ; l'idempotence tient au verrou
-- consultatif posé par open_offline_anomaly. Pour SEQ_GAP, l'index anomaly_seq_gap_once s'applique aussi.
--
-- Fonctions à faire relire par une personne : open_offline_anomaly, reduce_offline_shortfall, log_wallet_status
-- (écrit hors des droits de l'appelant ; règle 4 de CLAUDE.md).

-- 1. Colonnes ------------------------------------------------------------------------------------------------
ALTER TABLE anomaly ADD COLUMN loss_bearer text
  CONSTRAINT anomaly_loss_bearer CHECK (loss_bearer IN ('OPERATOR','ORGANIZER','MERCHANT'));
ALTER TABLE anomaly ADD COLUMN detail jsonb
  CONSTRAINT anomaly_detail_object CHECK (detail IS NULL OR jsonb_typeof(detail) = 'object');
ALTER TABLE anomaly ADD COLUMN batch_id uuid REFERENCES offline_batch(id);
CREATE INDEX anomaly_seq_gap_open_idx ON anomaly (created_at) WHERE kind = 'SEQ_GAP' AND status = 'OPEN';

-- 2. Ouverture et réduction ----------------------------------------------------------------------------------
CREATE FUNCTION open_offline_anomaly(p_ledger uuid, p_kind text, p_device uuid, p_media uuid, p_seq bigint,
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
       'IDEMPOTENCY_CONFLICT','VOID_CONFLICT','ONLINE_CONFIRMED_MISSING') THEN
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

  PERFORM pg_advisory_xact_lock(hashtextextended('anomaly:' || v_op::text || ':' || p_kind || ':'
    || coalesce(p_device::text, '') || ':' || coalesce(p_seq::text, '~') || ':' || coalesce(p_tx::text, ''), 0));

  SELECT a.id INTO v_id FROM anomaly a
   WHERE a.operator_id = v_op AND a.kind = p_kind
     AND a.device_id IS NOT DISTINCT FROM p_device
     AND a.seq IS NOT DISTINCT FROM p_seq
     AND a.transaction_id IS NOT DISTINCT FROM p_tx
   ORDER BY a.created_at, a.id LIMIT 1;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

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
REVOKE ALL ON FUNCTION open_offline_anomaly(uuid, text, uuid, uuid, bigint, uuid, bigint, text, jsonb, uuid)
  FROM PUBLIC;

-- Réduit le manque d'une vente par une annulation. Aucune anomalie : rien (vente entièrement couverte). Le
-- manque n'est fermé (RESOLVED) que lorsqu'il tombe à zéro, avec l'annulation qui l'a soldé.
CREATE FUNCTION reduce_offline_shortfall(p_original_tx uuid, p_amount bigint, p_reversal_tx uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_op uuid;
  a anomaly%ROWTYPE;
BEGIN
  SELECT operator_id INTO v_op FROM journal_transaction WHERE id = p_original_tx;
  PERFORM assert_tenant(v_op);
  IF p_reversal_tx IS NULL
     OR NOT EXISTS (SELECT 1 FROM journal_transaction WHERE id = p_reversal_tx AND operator_id = v_op) THEN
    RAISE EXCEPTION 'Réduction du manque : annulation absente ou d''un autre prestataire' USING ERRCODE = 'CL001';
  END IF;

  SELECT * INTO a FROM anomaly
   WHERE operator_id = v_op AND kind = 'OFFLINE_SHORTFALL' AND transaction_id = p_original_tx
   ORDER BY (status = 'OPEN') DESC, created_at, id LIMIT 1
   FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  -- Rejeu de la même annulation : aucun second effet
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(a.detail -> 'reductions', '[]'::jsonb)) e
              WHERE e ->> 'reversal_tx' = p_reversal_tx::text) THEN
    RETURN;
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 OR p_amount > a.amount THEN
    RAISE EXCEPTION 'Réduction du manque : montant % hors 1..% (reste du manque)', p_amount, a.amount
      USING ERRCODE = 'CL001';
  END IF;

  UPDATE anomaly SET
    amount = a.amount - p_amount,
    status = CASE WHEN a.amount - p_amount = 0 THEN 'RESOLVED' ELSE a.status END,
    resolution_tx_id = CASE WHEN a.amount - p_amount = 0 THEN p_reversal_tx ELSE a.resolution_tx_id END,
    detail = jsonb_set(coalesce(a.detail, '{}'::jsonb), '{reductions}',
               coalesce(a.detail -> 'reductions', '[]'::jsonb)
               || jsonb_build_array(jsonb_build_object('reversal_tx', p_reversal_tx, 'amount', p_amount,
                                                       'at', clock_timestamp())))
   WHERE id = a.id;
END $$;
REVOKE ALL ON FUNCTION reduce_offline_shortfall(uuid, bigint, uuid) FROM PUBLIC;

-- 3. Alertes -----------------------------------------------------------------------------------------------
CREATE FUNCTION offline_seq_gaps_to_alert(p_older_than interval)
RETURNS TABLE (anomaly_id uuid, operator_id uuid, device_id uuid, seq bigint, created_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
BEGIN
  IF p_older_than IS NULL OR p_older_than < interval '0' OR p_older_than > interval '30 days' THEN
    RAISE EXCEPTION 'Alerte : durée hors 0..30 jours' USING ERRCODE = 'CL001';
  END IF;
  RETURN QUERY
  SELECT a.id, a.operator_id, a.device_id, a.seq, a.created_at
    FROM anomaly a
   WHERE a.kind = 'SEQ_GAP' AND a.status = 'OPEN'
     AND a.created_at < clock_timestamp() - p_older_than
     AND NOT (coalesce(a.detail, '{}'::jsonb) ? 'alerted_at')
   ORDER BY a.created_at, a.id;
END $$;
REVOKE ALL ON FUNCTION offline_seq_gaps_to_alert(interval) FROM PUBLIC;

CREATE FUNCTION mark_seq_gap_alerted(p_anomaly uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE a anomaly%ROWTYPE;
BEGIN
  SELECT * INTO a FROM anomaly WHERE id = p_anomaly;
  PERFORM assert_tenant(a.operator_id);
  SELECT * INTO a FROM anomaly WHERE id = p_anomaly FOR UPDATE;
  IF a.kind <> 'SEQ_GAP' THEN
    RAISE EXCEPTION 'Alerte : l''anomalie % n''est pas un SEQ_GAP', p_anomaly USING ERRCODE = 'CL001';
  END IF;
  IF coalesce(a.detail, '{}'::jsonb) ? 'alerted_at' THEN RETURN; END IF;   -- la première date fait foi
  UPDATE anomaly SET detail = coalesce(a.detail, '{}'::jsonb)
                              || jsonb_build_object('alerted_at', clock_timestamp())
   WHERE id = p_anomaly;
END $$;
REVOKE ALL ON FUNCTION mark_seq_gap_alerted(uuid) FROM PUBLIC;

CREATE FUNCTION offline_retries_to_alert(p_older_than interval)
RETURNS TABLE (operator_id uuid, device_id uuid, batch_id uuid, seq bigint, created_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
BEGIN
  IF p_older_than IS NULL OR p_older_than < interval '0' OR p_older_than > interval '30 days' THEN
    RAISE EXCEPTION 'Alerte : durée hors 0..30 jours' USING ERRCODE = 'CL001';
  END IF;
  RETURN QUERY
  SELECT t.operator_id, t.device_id, t.batch_id, t.seq, t.created_at
    FROM offline_batch_retry t
   WHERE t.closed_at IS NULL AND t.alerted_at IS NULL
     AND t.created_at < clock_timestamp() - p_older_than
   ORDER BY t.created_at, t.batch_id, t.seq;
END $$;
REVOKE ALL ON FUNCTION offline_retries_to_alert(interval) FROM PUBLIC;

CREATE FUNCTION mark_offline_retry_alerted(p_batch uuid, p_seq bigint)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_op uuid;
BEGIN
  SELECT operator_id INTO v_op FROM offline_batch_retry WHERE batch_id = p_batch AND seq = p_seq;
  PERFORM assert_tenant(v_op);
  UPDATE offline_batch_retry SET alerted_at = clock_timestamp()
   WHERE batch_id = p_batch AND seq = p_seq AND alerted_at IS NULL;
END $$;
REVOKE ALL ON FUNCTION mark_offline_retry_alerted(uuid, bigint) FROM PUBLIC;

-- 4. Historique du portefeuille ------------------------------------------------------------------------------
CREATE TABLE wallet_status_history (
  id          bigserial PRIMARY KEY,
  wallet_id   uuid NOT NULL REFERENCES wallet(id),
  operator_id uuid NOT NULL REFERENCES party(id),
  from_status text,
  to_status   text NOT NULL,
  at          timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX wallet_status_history_wallet_at ON wallet_status_history (wallet_id, at);
CREATE TRIGGER wallet_status_history_immutable BEFORE UPDATE OR DELETE ON wallet_status_history
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER wallet_status_history_no_truncate BEFORE TRUNCATE ON wallet_status_history
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();

-- Ligne de départ (R-30.13) : tout portefeuille déjà BLOCKED ou CLOSED reçoit une ligne `from_status NULL`.
-- Règle (jamais une date postérieure à la réalité) : `at` = la plus ancienne `psp_chargeback.blocked_at` des
-- recharges du portefeuille, SAUF pour un portefeuille BLOCKED dont `other_block` est vrai (bloqué aussi pour
-- une autre cause, dont la date est inconnue et peut précéder la contestation) ; à défaut : '-infinity'
-- (« bloqué avant la vente », manque entier). Posée avant l'activation de la RLS : la migration s'exécute sans
-- prestataire de session.
INSERT INTO wallet_status_history (wallet_id, operator_id, from_status, to_status, at)
SELECT w.id, w.operator_id, NULL, w.status,
       CASE WHEN w.status = 'BLOCKED' AND w.other_block THEN '-infinity'::timestamptz
            ELSE coalesce((SELECT min(c.blocked_at) FROM psp_chargeback c
                             JOIN psp_topup t ON t.psp_topup_id = c.psp_topup_id
                            WHERE t.wallet_id = w.id AND c.blocked_at IS NOT NULL), '-infinity'::timestamptz)
       END
  FROM wallet w
 WHERE w.status IN ('BLOCKED','CLOSED');

ALTER TABLE wallet_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_status_history FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON wallet_status_history
  USING (operator_id = current_setting('app.operator_id', true)::uuid)
  WITH CHECK (operator_id = current_setting('app.operator_id', true)::uuid);

-- Déclencheur : n'écrit que la ligne d'historique, hors des droits de l'appelant (modèle 0018). WHEN : `wallet`
-- est chaud (last_activity_at, soldes) ; la fonction n'est appelée que sur un vrai changement de statut, donc
-- une mise à jour de last_activity_at ne coûte que l'évaluation de la condition WHEN (sans appel de fonction).
-- S'ajoute à `wallet_block_cause` (0042, BEFORE) sans le toucher.
CREATE FUNCTION log_wallet_status() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO wallet_status_history (wallet_id, operator_id, from_status, to_status)
  VALUES (NEW.id, NEW.operator_id, CASE WHEN TG_OP = 'UPDATE' THEN OLD.status END, NEW.status);
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION log_wallet_status() FROM PUBLIC;
CREATE TRIGGER wallet_status_log_update AFTER UPDATE OF status ON wallet
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status) EXECUTE FUNCTION log_wallet_status();
CREATE TRIGGER wallet_status_log_insert AFTER INSERT ON wallet
  FOR EACH ROW WHEN (NEW.status <> 'ACTIVE') EXECUTE FUNCTION log_wallet_status();

-- Heure de blocage d'un bracelet, de son lot et de son portefeuille, pour la table de conflit.
-- Pour chaque source dont l'état COURANT est bloquant (bracelet SUSPENDED|BLACKLISTED|REPLACED|RELEASED|RETIRED|
-- DESTROYED ; lot SUSPENDED|CLOSED ; portefeuille BLOCKED|CLOSED) : début du blocage en vigueur à p_before
-- (p_before NULL = sans borne), soit la plus ancienne entrée de la suite ininterrompue d'états bloquants qui
-- se termine à la dernière entrée antérieure ou égale à p_before. Une source dont l'état courant n'est pas
-- bloquant (réactivée depuis) est ignorée. Aucune entrée du tout pour un état courant bloquant : '-infinity'.
-- Des entrées existent mais l'état en vigueur à p_before n'est pas bloquant (blocage postérieur à p_before) :
-- la source ne compte pas. Résultat : la plus ANCIENNE des dates des sources (DM 01M667YQ5GEVNHMJ3MHGJBJ220),
-- '-infinity' si une source est inconnue ; NULL si aucune source n'est bloquante.
CREATE FUNCTION offline_block_time(p_media uuid, p_wallet uuid, p_before timestamptz)
RETURNS timestamptz
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_op uuid := nullif(current_setting('app.operator_id', true), '')::uuid;
  v_hi timestamptz := coalesce(p_before, 'infinity'::timestamptz);
  m media%ROWTYPE;
  v_batch media_batch%ROWTYPE;
  v_wstatus text;
  v_best timestamptz;
  v_src timestamptz;
  v_n bigint;
BEGIN
  IF p_media IS NULL AND p_wallet IS NULL THEN
    RAISE EXCEPTION 'Heure de blocage : bracelet ou portefeuille exigé' USING ERRCODE = 'CL001';
  END IF;
  IF p_media IS NOT NULL THEN PERFORM assert_tenant(tenant_of_media(p_media)); END IF;
  IF p_wallet IS NOT NULL THEN PERFORM assert_tenant(tenant_of_wallet(p_wallet)); END IF;

  -- Bracelet
  IF p_media IS NOT NULL THEN
    SELECT * INTO m FROM media WHERE id = p_media;
    IF m.status IN ('SUSPENDED','BLACKLISTED','REPLACED','RELEASED','RETIRED','DESTROYED') THEN
      v_src := NULL;
      SELECT count(*) INTO v_n FROM media_status_history WHERE media_id = p_media AND operator_id = v_op;
      IF v_n = 0 THEN
        v_src := '-infinity';
      ELSE
        WITH h AS (SELECT at, id, to_status IN ('SUSPENDED','BLACKLISTED','REPLACED','RELEASED','RETIRED',
                                                 'DESTROYED') AS b
                     FROM media_status_history
                    WHERE media_id = p_media AND operator_id = v_op AND at <= v_hi),
             lst AS (SELECT b FROM h ORDER BY at DESC, id DESC LIMIT 1),
             nb AS (SELECT at, id FROM h WHERE NOT b ORDER BY at DESC, id DESC LIMIT 1)
        SELECT min(h.at) INTO v_src FROM h
         WHERE h.b AND (SELECT coalesce(b, false) FROM lst)
           AND (NOT EXISTS (SELECT 1 FROM nb) OR (h.at, h.id) > (SELECT nb.at, nb.id FROM nb));
      END IF;
      v_best := least(v_best, v_src);   -- least ignore les NULL
    END IF;

    -- Lot du bracelet
    IF m.batch_id IS NOT NULL THEN
      SELECT * INTO v_batch FROM media_batch WHERE id = m.batch_id;
      IF v_batch.status IN ('SUSPENDED','CLOSED') THEN
        v_src := NULL;
        SELECT count(*) INTO v_n FROM media_batch_status_history WHERE batch_id = m.batch_id AND operator_id = v_op;
        IF v_n = 0 THEN
          v_src := '-infinity';
        ELSE
          WITH h AS (SELECT at, id, to_status IN ('SUSPENDED','CLOSED') AS b
                       FROM media_batch_status_history
                      WHERE batch_id = m.batch_id AND operator_id = v_op AND at <= v_hi),
               lst AS (SELECT b FROM h ORDER BY at DESC, id DESC LIMIT 1),
               nb AS (SELECT at, id FROM h WHERE NOT b ORDER BY at DESC, id DESC LIMIT 1)
          SELECT min(h.at) INTO v_src FROM h
           WHERE h.b AND (SELECT coalesce(b, false) FROM lst)
             AND (NOT EXISTS (SELECT 1 FROM nb) OR (h.at, h.id) > (SELECT nb.at, nb.id FROM nb));
        END IF;
        IF v_src IS NOT NULL THEN v_best := least(v_best, v_src); END IF;
      END IF;
    END IF;
  END IF;

  -- Portefeuille
  IF p_wallet IS NOT NULL THEN
    SELECT status INTO v_wstatus FROM wallet WHERE id = p_wallet;
    IF v_wstatus IN ('BLOCKED','CLOSED') THEN
      v_src := NULL;
      SELECT count(*) INTO v_n FROM wallet_status_history WHERE wallet_id = p_wallet AND operator_id = v_op;
      IF v_n = 0 THEN
        v_src := '-infinity';
      ELSE
        WITH h AS (SELECT at, id, to_status IN ('BLOCKED','CLOSED') AS b
                     FROM wallet_status_history
                    WHERE wallet_id = p_wallet AND operator_id = v_op AND at <= v_hi),
             lst AS (SELECT b FROM h ORDER BY at DESC, id DESC LIMIT 1),
             nb AS (SELECT at, id FROM h WHERE NOT b ORDER BY at DESC, id DESC LIMIT 1)
        SELECT min(h.at) INTO v_src FROM h
         WHERE h.b AND (SELECT coalesce(b, false) FROM lst)
           AND (NOT EXISTS (SELECT 1 FROM nb) OR (h.at, h.id) > (SELECT nb.at, nb.id FROM nb));
      END IF;
      IF v_src IS NOT NULL THEN v_best := least(v_best, v_src); END IF;
    END IF;
  END IF;

  RETURN v_best;
END $$;
REVOKE ALL ON FUNCTION offline_block_time(uuid, uuid, timestamptz) FROM PUBLIC;
