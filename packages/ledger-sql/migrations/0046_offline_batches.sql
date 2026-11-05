-- Migration 0046 : lots hors ligne, registre, trace RETRY, résultats d'opération, import du journal
-- (mission hors-ligne-snapshots-lots, lot WP05 ; spec FR-015, FR-016, FR-029, FR-031, FR-035, NFR-012 ;
-- research R-10, R-11, R-18, R-19 et R-30.3, R-30.7, R-30.10, R-30.11 (font foi) ; contracts/interfaces.md
-- § 1 et § 4 ; ADR-139 (écart nommé à I2) ; ADR-140 (droits ajoutés)).
--
-- Numéro : `interfaces.md` § 1 donne 0046 ; `data-model.md` écrit 0045 pour ces objets. 0046 fait foi.
--
-- Contenu :
--   1. `offline_batch` complétée : `received_via` admet 'IMPORT', `size_bytes`, `import_id`.
--   2. Tables nouvelles (operator_id, RLS `tenant_isolation` activée ET forcée) :
--        device_journal_import   import contrôlé du journal d'un terminal REVOKED
--        offline_batch_retry     trace RETRY (ADR-139) ; seules évolutions : closed_at, alerted_at
--        offline_op_result       résultat de chaque opération, immuable
--   3. Fonctions (SECURITY DEFINER sauf mention, `search_path = public, pg_temp`, EXECUTE retiré à PUBLIC,
--      AUCUN GRANT : les accords sont posés par le lot WP08) :
--        open_offline_batch_core    INTERNE, SECURITY INVOKER (voir plus bas) : corps unique de l'ouverture
--        open_offline_batch         ouverture ordinaire (CENTRAL, EDGE), remplace celle du schéma de référence
--        open_imported_batch        ouverture jumelle pour un terminal REVOKED, canal IMPORT
--        complete_offline_batch     clôture, remplacée (trace RETRY, ADR-139)
--        offline_batch_state, record_offline_retry, record_offline_op_result, offline_op_results,
--        offline_batch_retries_open, check_seq_gap_waivable, create/begin/finish_device_journal_import,
--        device_journal_import_view, device_journal_imports_processing
--        close_offline_batch_retry  déclencheur sur device_seq_registry
--
-- Erreurs (SQLSTATE réservés par interfaces.md § 1 ; traduction : lot WP01) :
--   CL001  paramètre ou état incohérent (grand livre qui n'est pas celui de l'événement du terminal, canal
--          IMPORT par la voie ordinaire, numéro sans résultat final ni trace RETRY ouverte, lot de l'import
--          non listé, même personne pour la demande et l'approbation)
--   CL002  lot ou résultat déjà reçu avec un contenu différent
--   CL010  lot déjà en cours pour le terminal, import déjà actif
--   CL011  lot vide ou de plus de 500 opérations, numéro de départ hors des entiers permis (dépassement
--          de bigint ou < 1), taille hors 1..1 048 576 octets
--   CL012  levée d'un numéro qui n'est pas un trou (check_seq_gap_waivable)
--   CL052  import : terminal non REVOKED
--   CL053  import : empreinte différente de la demande, ou import déjà appliqué / échoué / rejeté
--   42501  terminal révoqué (ouverture ordinaire, inchangé) ; P0002 objet introuvable ou d'un autre prestataire
--
-- Ordre des verrous (0023 l.318-335) : terminal FOR UPDATE d'abord, puis le lot ou l'import. Respecté par
-- open_offline_batch_core, complete_offline_batch, record_offline_retry, create/begin_device_journal_import
-- et open_imported_batch (qui lit l'import sans verrou, prend le terminal, puis l'import FOR SHARE).
-- finish_device_journal_import ne prend que l'import (jamais le terminal) : aucun cycle possible.
--
-- Hypothèse sur le propriétaire (comme 0022 et 0036) : le propriétaire des fonctions ignore la RLS
-- (superutilisateur sur le poste local). Aucune fonction de ce lot n'a besoin d'une autre hypothèse : toutes
-- prennent un lot, un terminal ou un import et font `assert_tenant`, sauf offline_batch_state,
-- offline_op_results (nomment le prestataire de la session, aucune ligne sinon) et
-- device_journal_imports_processing (DM 01M667Y1J4DT3HY96ZBCXXMXBT, ADR-140 : identifiants seulement).
--
-- Signature élargie (interfaces.md § 4) : open_offline_batch reçoit un dernier paramètre
-- `p_size_bytes int DEFAULT NULL` (taille du corps reçu, écrite dans offline_batch.size_bytes). L'ancienne
-- signature à 9 paramètres est supprimée ; les appels à 9 arguments continuent de marcher grâce au défaut.
--
-- open_offline_batch_core est SECURITY INVOKER (renforcement, signalé au rapport) : roles.sql accorde
-- `EXECUTE ON ALL FUNCTIONS` à cashless_app ; en INVOKER, un appel direct de la fonction interne (avec
-- p_allow_revoked = true) échoue faute de droit d'écriture sur offline_batch, au lieu d'ouvrir un lot d'un
-- terminal révoqué. Appelée par les enveloppes DEFINER, elle s'exécute avec les droits du propriétaire.
-- Le lot WP08 doit en plus retirer son EXECUTE à cashless_app (comme advance_device_chain).
--
-- ADR-139 (écart nommé à I2) : un numéro sans ligne de registre n'est admis par complete_offline_batch que
-- s'il a une ligne offline_batch_retry OUVERTE du même lot. C'est la seule exception à I2. Le test
-- tests_offline_batches.sql échoue si elle s'élargit.

-- 1. Tables ---------------------------------------------------------------------------------------------
CREATE TABLE device_journal_import (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id     uuid NOT NULL REFERENCES party(id),
  device_id       uuid NOT NULL REFERENCES device(id),
  -- Lots exportés tels que reçus. Forme (rapportée pour WP20) : tableau de 1 à 20 objets ; chacun porte au
  -- moins `batch_id` (uuid, texte) et `seq_from` (entier JSON de 1 à 2^53 − 1) ; le reste est libre.
  batches         jsonb NOT NULL CONSTRAINT device_journal_import_batches
                  CHECK (jsonb_typeof(batches) = 'array' AND jsonb_array_length(batches) BETWEEN 1 AND 20),
  batches_sha256  bytea NOT NULL CONSTRAINT device_journal_import_sha
                  CHECK (octet_length(batches_sha256) = 32),
  summary         jsonb NOT NULL CONSTRAINT device_journal_import_summary
                  CHECK (jsonb_typeof(summary) = 'object'),
  status          text NOT NULL DEFAULT 'PENDING' CONSTRAINT device_journal_import_status
                  CHECK (status IN ('PENDING','PROCESSING','APPLIED','FAILED','REJECTED')),
  reason          text NOT NULL CONSTRAINT device_journal_import_reason CHECK (length(btrim(reason)) >= 10),
  requested_by    uuid NOT NULL REFERENCES app_user(id),
  approved_by     uuid REFERENCES app_user(id),
  result          jsonb,
  created_at      timestamptz NOT NULL DEFAULT clock_timestamp(),
  applied_at      timestamptz,
  CONSTRAINT device_journal_import_approver CHECK (approved_by IS NULL OR approved_by <> requested_by),
  CONSTRAINT device_journal_import_approved CHECK (status NOT IN ('PROCESSING','APPLIED','FAILED')
                                                   OR approved_by IS NOT NULL),
  CONSTRAINT device_journal_import_pending CHECK (status <> 'PENDING' OR approved_by IS NULL),
  CONSTRAINT device_journal_import_final CHECK ((status IN ('APPLIED','FAILED')) = (applied_at IS NOT NULL)),
  CONSTRAINT device_journal_import_result CHECK (status NOT IN ('APPLIED','FAILED') OR result IS NOT NULL)
);
-- Un seul import actif par terminal (le contrôle de create_device_journal_import le dit en CL010 ; l'index
-- le garantit sous concurrence).
CREATE UNIQUE INDEX device_journal_import_active ON device_journal_import (device_id)
  WHERE status IN ('PENDING','PROCESSING');
CREATE INDEX device_journal_import_processing ON device_journal_import (created_at)
  WHERE status = 'PROCESSING';

-- Garde : batches, batches_sha256 et tout ce que la demande a figé sont immuables ; états finaux gelés ;
-- aucune suppression. Seuls status, approved_by, result et applied_at évoluent, dans le sens PENDING ->
-- PROCESSING -> APPLIED | FAILED (PENDING -> REJECTED).
CREATE FUNCTION device_journal_import_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Table device_journal_import : aucune suppression';
  END IF;
  IF OLD.status IN ('APPLIED','FAILED','REJECTED') THEN
    RAISE EXCEPTION 'Import % en état final (%) : aucune modification', OLD.id, OLD.status;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.operator_id IS DISTINCT FROM OLD.operator_id
     OR NEW.device_id IS DISTINCT FROM OLD.device_id OR NEW.batches IS DISTINCT FROM OLD.batches
     OR NEW.batches_sha256 IS DISTINCT FROM OLD.batches_sha256 OR NEW.summary IS DISTINCT FROM OLD.summary
     OR NEW.reason IS DISTINCT FROM OLD.reason OR NEW.requested_by IS DISTINCT FROM OLD.requested_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Import % : lots, empreinte et demande immuables', OLD.id;
  END IF;
  IF NOT ((OLD.status = 'PENDING' AND NEW.status IN ('PENDING','PROCESSING','REJECTED'))
          OR (OLD.status = 'PROCESSING' AND NEW.status IN ('PROCESSING','APPLIED','FAILED'))) THEN
    RAISE EXCEPTION 'Import % : passage % -> % interdit', OLD.id, OLD.status, NEW.status;
  END IF;
  IF OLD.approved_by IS NOT NULL AND NEW.approved_by IS DISTINCT FROM OLD.approved_by THEN
    RAISE EXCEPTION 'Import % : approbateur déjà posé', OLD.id;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION device_journal_import_guard() FROM PUBLIC;
CREATE TRIGGER device_journal_import_guard BEFORE UPDATE OR DELETE ON device_journal_import
  FOR EACH ROW EXECUTE FUNCTION device_journal_import_guard();

-- 2. offline_batch complétée -----------------------------------------------------------------------------
ALTER TABLE offline_batch DROP CONSTRAINT offline_batch_received_via_check;
ALTER TABLE offline_batch ADD CONSTRAINT offline_batch_received_via_check
  CHECK (received_via IN ('CENTRAL','EDGE','IMPORT'));
ALTER TABLE offline_batch ADD COLUMN size_bytes int
  CONSTRAINT offline_batch_size_bytes CHECK (size_bytes BETWEEN 1 AND 1048576);
ALTER TABLE offline_batch ADD COLUMN import_id uuid REFERENCES device_journal_import(id);
-- Le canal IMPORT et l'import vont ensemble.
ALTER TABLE offline_batch ADD CONSTRAINT offline_batch_import_channel
  CHECK ((received_via = 'IMPORT') = (import_id IS NOT NULL));
CREATE INDEX offline_batch_import_idx ON offline_batch (import_id) WHERE import_id IS NOT NULL;

-- 3. Trace RETRY (ADR-139) ------------------------------------------------------------------------------
CREATE TABLE offline_batch_retry (
  batch_id    uuid NOT NULL REFERENCES offline_batch(id),
  seq         bigint NOT NULL CHECK (seq >= 1),
  operator_id uuid NOT NULL REFERENCES party(id),
  device_id   uuid NOT NULL REFERENCES device(id),
  reason      text NOT NULL CONSTRAINT offline_batch_retry_reason CHECK (reason = 'INSUFFICIENT_FUNDS_RETRY'),
  created_at  timestamptz NOT NULL DEFAULT clock_timestamp(),
  closed_at   timestamptz,      -- posé par le déclencheur quand le numéro reçoit un résultat final
  alerted_at  timestamptz,      -- posé une fois par mark_offline_retry_alerted (WP06) : alerte unique à 24 h
  PRIMARY KEY (batch_id, seq)
);
CREATE INDEX offline_batch_retry_open_idx ON offline_batch_retry (device_id, seq) WHERE closed_at IS NULL;

CREATE FUNCTION offline_batch_retry_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Table offline_batch_retry : aucune suppression';
  END IF;
  IF NEW.batch_id IS DISTINCT FROM OLD.batch_id OR NEW.seq IS DISTINCT FROM OLD.seq
     OR NEW.operator_id IS DISTINCT FROM OLD.operator_id OR NEW.device_id IS DISTINCT FROM OLD.device_id
     OR NEW.reason IS DISTINCT FROM OLD.reason OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Table offline_batch_retry : seuls closed_at et alerted_at évoluent';
  END IF;
  IF OLD.closed_at IS NOT NULL AND NEW.closed_at IS DISTINCT FROM OLD.closed_at THEN
    RAISE EXCEPTION 'Trace RETRY (%, %) close : elle ne se rouvre pas', OLD.batch_id, OLD.seq;
  END IF;
  IF OLD.alerted_at IS NOT NULL AND NEW.alerted_at IS DISTINCT FROM OLD.alerted_at THEN
    RAISE EXCEPTION 'Trace RETRY (%, %) : alerte déjà posée', OLD.batch_id, OLD.seq;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION offline_batch_retry_guard() FROM PUBLIC;
CREATE TRIGGER offline_batch_retry_guard BEFORE UPDATE OR DELETE ON offline_batch_retry
  FOR EACH ROW EXECUTE FUNCTION offline_batch_retry_guard();

-- Un résultat final au registre (y compris WAIVED, quel que soit le lot qui l'apporte) clôt toute trace
-- ouverte du numéro. record_device_seq et waive_seq_gap ne sont pas modifiées.
CREATE FUNCTION close_offline_batch_retry() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE offline_batch_retry SET closed_at = clock_timestamp()
   WHERE device_id = NEW.device_id AND seq = NEW.seq AND closed_at IS NULL;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION close_offline_batch_retry() FROM PUBLIC;
CREATE TRIGGER device_seq_registry_close_retry AFTER INSERT ON device_seq_registry
  FOR EACH ROW EXECUTE FUNCTION close_offline_batch_retry();

-- 4. Résultat de chaque opération (R-30.7) ---------------------------------------------------------------
CREATE TABLE offline_op_result (
  batch_id    uuid NOT NULL REFERENCES offline_batch(id),
  seq         bigint NOT NULL CHECK (seq >= 1),
  operator_id uuid NOT NULL REFERENCES party(id),
  result      jsonb NOT NULL CONSTRAINT offline_op_result_object CHECK (jsonb_typeof(result) = 'object'),
  created_at  timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (batch_id, seq)
);
CREATE TRIGGER offline_op_result_immutable BEFORE UPDATE OR DELETE ON offline_op_result
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- 5. RLS : activée et forcée sur les trois tables --------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['device_journal_import','offline_batch_retry','offline_op_result'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
                     USING (operator_id = current_setting('app.operator_id', true)::uuid)
                     WITH CHECK (operator_id = current_setting('app.operator_id', true)::uuid)$p$, t);
  END LOOP;
END $$;

-- 6. Ouverture d'un lot : corps unique et deux enveloppes -------------------------------------------------
-- Corps de open_offline_batch du schéma de référence (l.2183), À L'IDENTIQUE, plus les contrôles ajoutés
-- (jamais retirés) : numéro de départ sans dépassement de bigint (CL011), grand livre = celui de l'événement
-- du terminal (CL001), canal cohérent avec l'import (CL001), taille (CL011). Idempotente sur batch_id.
-- Chaîne rompue -> lot REJECTED (CHAIN_BROKEN) + anomalie, sans erreur SQL.
DROP FUNCTION open_offline_batch(uuid, uuid, uuid, bigint, bytea, bytea[], bytea, bytea, text);

CREATE FUNCTION open_offline_batch_core(p_batch uuid, p_device uuid, p_ledger uuid, p_seq_from bigint,
                                        p_prev_chain_hash bytea, p_op_hashes bytea[],
                                        p_last_chain_hash bytea, p_signature bytea, p_via text,
                                        p_size_bytes int, p_allow_revoked boolean, p_import uuid)
RETURNS offline_batch
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE d device%ROWTYPE; b offline_batch%ROWTYPE; hs bytea[]; expected bytea; cs text; miss bigint[]; n int;
        i int; k bigint;
BEGIN
  IF p_via IS NULL OR p_via NOT IN ('CENTRAL','EDGE','IMPORT') OR (p_via = 'IMPORT') <> (p_import IS NOT NULL) THEN
    RAISE EXCEPTION 'Canal % incohérent avec l''import', p_via USING ERRCODE = 'CL001';
  END IF;
  PERFORM assert_tenant(tenant_of_device(p_device));
  PERFORM assert_tenant(tenant_of_ledger(p_ledger));
  SELECT * INTO d FROM device WHERE id = p_device FOR UPDATE;
  IF p_allow_revoked THEN
    IF d.status <> 'REVOKED' THEN
      RAISE EXCEPTION 'Terminal % non révoqué : import refusé', d.serial USING ERRCODE = 'CL052';
    END IF;
  ELSIF d.status = 'REVOKED' THEN
    RAISE EXCEPTION 'Terminal révoqué' USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- grand livre de l'événement du terminal, et lui seul
  IF d.event_id IS NULL OR NOT EXISTS (SELECT 1 FROM ledger l WHERE l.id = p_ledger
                                          AND l.scope_type = 'EVENT' AND l.scope_id = d.event_id) THEN
    RAISE EXCEPTION 'Grand livre % : ce n''est pas celui de l''événement du terminal %', p_ledger, d.serial
      USING ERRCODE = 'CL001';
  END IF;
  SELECT * INTO b FROM offline_batch WHERE id = p_batch;
  IF FOUND THEN
    IF b.device_id <> p_device OR b.seq_from <> p_seq_from OR b.op_hashes <> p_op_hashes
       OR b.prev_chain_hash <> p_prev_chain_hash THEN
      RAISE EXCEPTION 'Lot % déjà reçu avec un contenu différent', p_batch USING ERRCODE = 'CL002';
    END IF;
    RETURN b;                                            -- renvoi du même lot
  END IF;
  n := coalesce(cardinality(p_op_hashes), 0);
  IF n < 1 OR n > 500 THEN RAISE EXCEPTION 'Lot de % opérations (1 à 500)', n USING ERRCODE = 'CL011'; END IF;
  -- débordement : seq_from + n − 1 ne doit pas sortir de bigint (22003 sinon) ; n <= 500 : pas de dépassement ici
  IF p_seq_from IS NULL OR p_seq_from < 1 OR p_seq_from > 9223372036854775807 - n THEN
    RAISE EXCEPTION 'Numéro de départ % hors des valeurs permises pour un lot de % opérations', p_seq_from, n
      USING ERRCODE = 'CL011';
  END IF;
  IF p_size_bytes IS NOT NULL AND (p_size_bytes < 1 OR p_size_bytes > 1048576) THEN
    RAISE EXCEPTION 'Taille du lot % octets (1 à 1 048 576)', p_size_bytes USING ERRCODE = 'CL011';
  END IF;
  IF p_seq_from + n - 1 > d.contiguous_acked_seq + max_seq_jump() THEN                 -- revue 2, DB-B3
    RAISE EXCEPTION 'Lot hors plage : numéros %..% (dernier continu %, saut max %)', p_seq_from, p_seq_from + n - 1,
      d.contiguous_acked_seq, max_seq_jump() USING ERRCODE = 'CL021';
  END IF;
  -- Lot resté en cours plus de 15 min (traitement interrompu, terminal parti) : abandonné pour ne pas bloquer
  -- le terminal (revue 2, M8). Ses numéros déjà enregistrés restent ; les autres deviennent des trous à renvoyer.
  UPDATE offline_batch SET status = 'REJECTED', reject_reason = 'ABANDONED'
   WHERE device_id = p_device AND status = 'PROCESSING' AND received_at < clock_timestamp() - interval '15 minutes';
  IF EXISTS (SELECT 1 FROM offline_batch WHERE device_id = p_device AND status = 'PROCESSING') THEN
    RAISE EXCEPTION 'Un lot est déjà en cours pour le terminal %', d.serial USING ERRCODE = 'CL010';
  END IF;
  -- cohérence interne : la chaîne recalculée depuis prev_chain_hash doit aboutir à last_chain_hash.
  -- hs[k+1] = empreinte de chaîne après les k premières opérations (hs[1] = prev_chain_hash).
  hs := ARRAY[p_prev_chain_hash];
  FOR i IN 1..n LOOP
    IF octet_length(p_op_hashes[i]) IS DISTINCT FROM 32 THEN
      RAISE EXCEPTION 'Empreinte d''opération invalide (rang %)', i USING ERRCODE = 'CL001';
    END IF;
    hs := array_append(hs, chain_step(hs[i], p_op_hashes[i]));
  END LOOP;
  -- raccord avec le curseur du central : k = nombre d'opérations du lot déjà couvertes par la chaîne connue
  k := d.last_chain_seq - p_seq_from + 1;
  IF hs[n + 1] <> p_last_chain_hash THEN
    cs := 'BROKEN';
  ELSIF k < 0 THEN
    cs := 'PENDING';                                     -- un lot antérieur manque encore
  ELSIF k >= n THEN
    cs := 'RESENT';                                      -- tout est déjà couvert
  ELSE
    expected := CASE WHEN d.last_chain_hash IS NOT NULL THEN d.last_chain_hash
                     WHEN d.last_chain_seq = 0 THEN device_chain_genesis(p_device) END;
    cs := CASE WHEN expected IS NULL THEN 'UNVERIFIABLE' WHEN expected = hs[k + 1] THEN 'VERIFIED' ELSE 'BROKEN' END;
  END IF;

  IF cs = 'BROKEN' THEN
    INSERT INTO offline_batch (id, operator_id, device_id, ledger_id, received_via, seq_from, seq_to, op_hashes,
                               prev_chain_hash, last_chain_hash, signature, status, reject_reason, chain_status,
                               size_bytes, import_id)
    VALUES (p_batch, d.operator_id, p_device, p_ledger, p_via, p_seq_from, p_seq_from + n - 1, p_op_hashes,
            p_prev_chain_hash, p_last_chain_hash, p_signature, 'REJECTED', 'CHAIN_BROKEN', 'BROKEN',
            p_size_bytes, p_import)
    RETURNING * INTO b;
    INSERT INTO anomaly (operator_id, ledger_id, kind, device_id, seq, amount)
    VALUES (d.operator_id, p_ledger, 'CHAIN_BROKEN', p_device, p_seq_from, 0);
    RETURN b;
  END IF;

  -- numéros manquants avant le lot : le lot est traité quand même (I4), une anomalie par numéro
  SELECT coalesce(array_agg(s ORDER BY s), '{}') INTO miss
    FROM generate_series(d.contiguous_acked_seq + 1, p_seq_from - 1) s
   WHERE NOT EXISTS (SELECT 1 FROM device_seq_registry r WHERE r.device_id = p_device AND r.seq = s);
  INSERT INTO anomaly (operator_id, ledger_id, kind, device_id, seq, amount)
  SELECT d.operator_id, p_ledger, 'SEQ_GAP', p_device, s, 0 FROM unnest(miss) s
  ON CONFLICT (device_id, seq) WHERE kind = 'SEQ_GAP' DO NOTHING;

  INSERT INTO offline_batch (id, operator_id, device_id, ledger_id, received_via, seq_from, seq_to, op_hashes,
                             prev_chain_hash, last_chain_hash, signature, chain_status, missing_seqs,
                             size_bytes, import_id)
  VALUES (p_batch, d.operator_id, p_device, p_ledger, p_via, p_seq_from, p_seq_from + n - 1, p_op_hashes,
          p_prev_chain_hash, p_last_chain_hash, p_signature, cs, miss, p_size_bytes, p_import)
  RETURNING * INTO b;
  IF cs IN ('VERIFIED','UNVERIFIABLE') THEN
    UPDATE device SET last_chain_seq = b.seq_to, last_chain_hash = p_last_chain_hash WHERE id = p_device;
    PERFORM advance_device_chain(p_device);
  END IF;
  RETURN b;
END $$;
REVOKE ALL ON FUNCTION open_offline_batch_core(uuid, uuid, uuid, bigint, bytea, bytea[], bytea, bytea, text, int,
                                               boolean, uuid) FROM PUBLIC;

-- Ouverture ordinaire : CENTRAL ou EDGE seulement (le canal IMPORT n'est pas ouvrable par cette voie).
CREATE FUNCTION open_offline_batch(p_batch uuid, p_device uuid, p_ledger uuid, p_seq_from bigint,
                                   p_prev_chain_hash bytea, p_op_hashes bytea[], p_last_chain_hash bytea,
                                   p_signature bytea, p_via text DEFAULT 'CENTRAL',
                                   p_size_bytes int DEFAULT NULL)
RETURNS offline_batch
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF p_via IS NULL OR p_via NOT IN ('CENTRAL','EDGE') THEN
    RAISE EXCEPTION 'Canal % refusé : CENTRAL ou EDGE', p_via USING ERRCODE = 'CL001';
  END IF;
  RETURN open_offline_batch_core(p_batch, p_device, p_ledger, p_seq_from, p_prev_chain_hash, p_op_hashes,
                                 p_last_chain_hash, p_signature, p_via, p_size_bytes, false, NULL);
END $$;
REVOKE ALL ON FUNCTION open_offline_batch(uuid, uuid, uuid, bigint, bytea, bytea[], bytea, bytea, text, int)
  FROM PUBLIC;

-- Ouverture d'un lot de l'import du journal d'un terminal REVOKED (canal IMPORT). Ne contourne que le statut
-- REVOKED : chaîne, plage, unicité du lot en cours et grand livre de l'événement sont ceux du corps commun.
CREATE FUNCTION open_imported_batch(p_import uuid, p_batch uuid, p_seq_from bigint, p_prev_chain_hash bytea,
                                    p_op_hashes bytea[], p_last_chain_hash bytea, p_signature bytea)
RETURNS offline_batch
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_dev uuid; v_op uuid; i device_journal_import%ROWTYPE; v_ledger uuid;
BEGIN
  SELECT device_id, operator_id INTO v_dev, v_op FROM device_journal_import WHERE id = p_import;
  PERFORM assert_tenant(v_op);
  PERFORM 1 FROM device WHERE id = v_dev FOR UPDATE;                      -- terminal d'abord
  SELECT * INTO i FROM device_journal_import WHERE id = p_import FOR SHARE;
  IF i.status <> 'PROCESSING' THEN
    RAISE EXCEPTION 'Import % en état % : ouverture de lot refusée', p_import, i.status USING ERRCODE = 'CL001';
  END IF;
  IF p_batch IS NULL OR p_seq_from IS NULL OR NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements(i.batches) e
        WHERE e->>'batch_id' = p_batch::text AND jsonb_typeof(e->'seq_from') = 'number'
          AND (e->>'seq_from')::numeric = p_seq_from) THEN
    RAISE EXCEPTION 'Lot % (départ %) non listé dans l''import %', p_batch, p_seq_from, p_import
      USING ERRCODE = 'CL001';
  END IF;
  SELECT l.id INTO v_ledger FROM device dv JOIN ledger l ON l.scope_type = 'EVENT' AND l.scope_id = dv.event_id
   WHERE dv.id = v_dev;
  RETURN open_offline_batch_core(p_batch, v_dev, v_ledger, p_seq_from, p_prev_chain_hash, p_op_hashes,
                                 p_last_chain_hash, p_signature, 'IMPORT', NULL, true, p_import);
END $$;
REVOKE ALL ON FUNCTION open_imported_batch(uuid, uuid, bigint, bytea, bytea[], bytea, bytea) FROM PUBLIC;

-- 7. Clôture d'un lot (remplacée) ------------------------------------------------------------------------
-- Chaque numéro du lot DOIT avoir un résultat final au registre (I2), SAUF un numéro porteur d'une trace
-- RETRY OUVERTE de CE lot (ADR-139, R-30.11) : p_results seul n'admet plus rien. Le reste est inchangé
-- (idempotence sur COMPLETED, lot rejeté CL001). Verrous : terminal, puis lot.
CREATE OR REPLACE FUNCTION complete_offline_batch(p_batch uuid, p_results jsonb) RETURNS offline_batch
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE b offline_batch%ROWTYPE; k bigint; v_dev uuid;
BEGIN
  SELECT device_id INTO v_dev FROM offline_batch WHERE id = p_batch;
  PERFORM assert_tenant((SELECT operator_id FROM offline_batch WHERE id = p_batch));
  PERFORM 1 FROM device WHERE id = v_dev FOR UPDATE;
  SELECT * INTO b FROM offline_batch WHERE id = p_batch FOR UPDATE;
  IF b.status = 'COMPLETED' THEN RETURN b; END IF;
  IF b.status <> 'PROCESSING' THEN RAISE EXCEPTION 'Lot % rejeté', p_batch USING ERRCODE = 'CL001'; END IF;
  SELECT min(s) INTO k FROM generate_series(b.seq_from, b.seq_to) s
   WHERE NOT EXISTS (SELECT 1 FROM device_seq_registry r WHERE r.device_id = b.device_id AND r.seq = s)
     AND NOT EXISTS (SELECT 1 FROM offline_batch_retry t
                      WHERE t.batch_id = b.id AND t.seq = s AND t.closed_at IS NULL);
  IF k IS NOT NULL THEN
    RAISE EXCEPTION 'Lot % incomplet : numéro % sans résultat final ni trace RETRY ouverte de ce lot', p_batch, k
      USING ERRCODE = 'CL001';
  END IF;
  UPDATE offline_batch SET status = 'COMPLETED', results = p_results, completed_at = clock_timestamp()
   WHERE id = p_batch RETURNING * INTO b;
  RETURN b;
END $$;
REVOKE ALL ON FUNCTION complete_offline_batch(uuid, jsonb) FROM PUBLIC;

-- 8. Lecture de l'état d'un lot ---------------------------------------------------------------------------
-- missing_seqs = trous ACTUELS du terminal (1 000 au plus) tant que le lot est PROCESSING ou COMPLETED ;
-- results NULL avant la clôture. Lot inconnu ou d'un autre prestataire : aucune ligne.
CREATE FUNCTION offline_batch_state(p_batch uuid)
RETURNS TABLE (status text, reject_reason text, device_id uuid, received_at timestamptz,
               completed_at timestamptz, seq_from bigint, seq_to bigint, missing_seqs bigint[], results jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT b.status, b.reject_reason, b.device_id, b.received_at, b.completed_at, b.seq_from, b.seq_to,
         CASE WHEN b.status IN ('PROCESSING','COMPLETED')
              THEN ARRAY(SELECT device_missing_seqs(b.device_id, 1000)) ELSE b.missing_seqs END,
         b.results
    FROM offline_batch b
   WHERE b.id = p_batch AND b.operator_id = nullif(current_setting('app.operator_id', true), '')::uuid
$$;
REVOKE ALL ON FUNCTION offline_batch_state(uuid) FROM PUBLIC;

-- 9. Trace RETRY ------------------------------------------------------------------------------------------
-- Appelée par la transaction de l'opération au quatrième CL007. Lot PROCESSING, numéro dans la plage du lot,
-- AUCUNE ligne de registre pour ce numéro (CL001 sinon), raison exacte. Idempotente ; ne rouvre pas une ligne
-- close (l'appel sur une trace existante, close ou non, ne change rien).
CREATE FUNCTION record_offline_retry(p_batch uuid, p_seq bigint, p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE b offline_batch%ROWTYPE; v_dev uuid; v_op uuid;
BEGIN
  SELECT device_id, operator_id INTO v_dev, v_op FROM offline_batch WHERE id = p_batch;
  PERFORM assert_tenant(v_op);
  PERFORM 1 FROM device WHERE id = v_dev FOR UPDATE;                      -- sérialise avec record_device_seq
  SELECT * INTO b FROM offline_batch WHERE id = p_batch;
  IF p_reason IS DISTINCT FROM 'INSUFFICIENT_FUNDS_RETRY' THEN
    RAISE EXCEPTION 'Raison de trace RETRY % refusée', p_reason USING ERRCODE = 'CL001';
  END IF;
  IF p_seq IS NULL OR p_seq < b.seq_from OR p_seq > b.seq_to THEN
    RAISE EXCEPTION 'Numéro % hors du lot % (%..%)', p_seq, p_batch, b.seq_from, b.seq_to USING ERRCODE = 'CL001';
  END IF;
  IF EXISTS (SELECT 1 FROM offline_batch_retry WHERE batch_id = p_batch AND seq = p_seq) THEN
    RETURN;
  END IF;
  IF b.status <> 'PROCESSING' THEN
    RAISE EXCEPTION 'Lot % : trace RETRY refusée (état %)', p_batch, b.status USING ERRCODE = 'CL001';
  END IF;
  IF EXISTS (SELECT 1 FROM device_seq_registry WHERE device_id = b.device_id AND seq = p_seq) THEN
    RAISE EXCEPTION 'Numéro % a déjà un résultat final : pas de trace RETRY', p_seq USING ERRCODE = 'CL001';
  END IF;
  INSERT INTO offline_batch_retry (batch_id, seq, operator_id, device_id, reason)
  VALUES (p_batch, p_seq, b.operator_id, b.device_id, p_reason);
END $$;
REVOKE ALL ON FUNCTION record_offline_retry(uuid, bigint, text) FROM PUBLIC;

-- Numéros à trace ouverte du terminal, croissants.
CREATE FUNCTION offline_batch_retries_open(p_device uuid) RETURNS SETOF bigint
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM assert_tenant(tenant_of_device(p_device));
  RETURN QUERY SELECT DISTINCT t.seq FROM offline_batch_retry t
                WHERE t.device_id = p_device AND t.closed_at IS NULL ORDER BY t.seq;
END $$;
REVOKE ALL ON FUNCTION offline_batch_retries_open(uuid) FROM PUBLIC;

-- 10. Résultats d'opération ------------------------------------------------------------------------------
-- Même jsonb : rien ; autre jsonb : CL002 (la comparaison octet pour octet, JCS, est faite côté API).
-- Lot PROCESSING, COMPLETED ou REJECTED admis (reprise après abandon).
CREATE FUNCTION record_offline_op_result(p_batch uuid, p_seq bigint, p_result jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE b offline_batch%ROWTYPE; r jsonb; n int;
BEGIN
  SELECT * INTO b FROM offline_batch WHERE id = p_batch;
  PERFORM assert_tenant(b.operator_id);
  IF p_seq IS NULL OR p_seq < b.seq_from OR p_seq > b.seq_to THEN
    RAISE EXCEPTION 'Numéro % hors du lot % (%..%)', p_seq, p_batch, b.seq_from, b.seq_to USING ERRCODE = 'CL001';
  END IF;
  IF p_result IS NULL OR jsonb_typeof(p_result) <> 'object' OR jsonb_typeof(p_result->'seq') IS DISTINCT FROM 'number'
     OR (p_result->>'seq')::numeric <> p_seq THEN
    RAISE EXCEPTION 'Résultat du numéro % : objet JSON dont seq est ce numéro attendu', p_seq USING ERRCODE = 'CL001';
  END IF;
  INSERT INTO offline_op_result (batch_id, seq, operator_id, result)
  VALUES (p_batch, p_seq, b.operator_id, p_result)
  ON CONFLICT (batch_id, seq) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 THEN
    SELECT o.result INTO r FROM offline_op_result o WHERE o.batch_id = p_batch AND o.seq = p_seq;
    IF r IS DISTINCT FROM p_result THEN
      RAISE EXCEPTION 'Résultat du numéro % du lot % déjà écrit, différent', p_seq, p_batch USING ERRCODE = 'CL002';
    END IF;
  END IF;
END $$;
REVOKE ALL ON FUNCTION record_offline_op_result(uuid, bigint, jsonb) FROM PUBLIC;

CREATE FUNCTION offline_op_results(p_batch uuid) RETURNS TABLE (seq bigint, result jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT o.seq, o.result FROM offline_op_result o
   WHERE o.batch_id = p_batch AND o.operator_id = nullif(current_setting('app.operator_id', true), '')::uuid
   ORDER BY o.seq
$$;
REVOKE ALL ON FUNCTION offline_op_results(uuid) FROM PUBLIC;

-- 11. Pré-contrôle de levée d'un trou ---------------------------------------------------------------------
-- Mêmes contrôles que waive_seq_gap (schéma de référence l.2089), dans le même ordre, mêmes codes ; sans
-- effet, sans verrou FOR UPDATE.
CREATE FUNCTION check_seq_gap_waivable(p_device uuid, p_seq bigint) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE d device%ROWTYPE;
BEGIN
  PERFORM assert_tenant(tenant_of_device(p_device));
  SELECT * INTO d FROM device WHERE id = p_device;
  IF p_seq <= d.contiguous_acked_seq OR p_seq > d.last_seq
     OR EXISTS (SELECT 1 FROM device_seq_registry WHERE device_id = p_device AND seq = p_seq) THEN
    RAISE EXCEPTION 'Le numéro % du terminal % n''est pas un trou', p_seq, d.serial USING ERRCODE = 'CL012';
  END IF;
  IF EXISTS (SELECT 1 FROM offline_batch WHERE device_id = p_device AND status = 'PROCESSING'
               AND p_seq BETWEEN seq_from AND seq_to) THEN
    RAISE EXCEPTION 'Numéro % en cours de traitement dans un lot', p_seq USING ERRCODE = 'CL010';
  END IF;
END $$;
REVOKE ALL ON FUNCTION check_seq_gap_waivable(uuid, bigint) FROM PUBLIC;

-- 12. Import du journal d'un terminal REVOKED (R-30.10, FR-035) -------------------------------------------
-- Demande : terminal REVOKED (CL052) ; 1 à 20 lots, chacun avec batch_id (uuid) et seq_from (entier de 1 à
-- 2^53 − 1), sans doublon ; empreinte de 32 octets (stockée telle quelle : l'API a calculé l'empreinte JCS) ;
-- synthèse objet ; raison >= 10 caractères ; acteur non nul ; aucun import PENDING|PROCESSING du terminal
-- (CL010). Toute autre incohérence : CL001.
CREATE FUNCTION create_device_journal_import(p_device uuid, p_batches jsonb, p_batches_sha256 bytea,
                                             p_summary jsonb, p_reason text, p_actor uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE d device%ROWTYPE; v_id uuid; n int;
BEGIN
  PERFORM assert_tenant(tenant_of_device(p_device));
  SELECT * INTO d FROM device WHERE id = p_device FOR UPDATE;
  IF d.status <> 'REVOKED' THEN
    RAISE EXCEPTION 'Terminal % non révoqué : import refusé', d.serial USING ERRCODE = 'CL052';
  END IF;
  IF p_batches IS NULL OR jsonb_typeof(p_batches) <> 'array' THEN
    RAISE EXCEPTION 'Import : les lots forment un tableau JSON' USING ERRCODE = 'CL001';
  END IF;
  n := jsonb_array_length(p_batches);
  IF n < 1 OR n > 20 THEN
    RAISE EXCEPTION 'Import de % lots (1 à 20)', n USING ERRCODE = 'CL001';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_batches) e
              WHERE jsonb_typeof(e) <> 'object'
                 OR jsonb_typeof(e->'batch_id') IS DISTINCT FROM 'string'
                 OR (e->>'batch_id') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
                 OR jsonb_typeof(e->'seq_from') IS DISTINCT FROM 'number'
                 OR (e->>'seq_from') !~ '^[1-9][0-9]{0,15}$'
                 OR (e->>'seq_from')::numeric > 9007199254740991) THEN
    RAISE EXCEPTION 'Import : chaque lot porte batch_id (uuid) et seq_from (entier de 1 à 2^53 - 1)'
      USING ERRCODE = 'CL001';
  END IF;
  IF (SELECT count(DISTINCT lower(e->>'batch_id')) FROM jsonb_array_elements(p_batches) e) <> n THEN
    RAISE EXCEPTION 'Import : identifiant de lot en double' USING ERRCODE = 'CL001';
  END IF;
  IF p_batches_sha256 IS NULL OR octet_length(p_batches_sha256) <> 32 THEN
    RAISE EXCEPTION 'Import : empreinte de 32 octets attendue' USING ERRCODE = 'CL001';
  END IF;
  IF p_summary IS NULL OR jsonb_typeof(p_summary) <> 'object' THEN
    RAISE EXCEPTION 'Import : synthèse en objet JSON attendue' USING ERRCODE = 'CL001';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) < 10 THEN
    RAISE EXCEPTION 'Import : raison d''au moins 10 caractères' USING ERRCODE = 'CL001';
  END IF;
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'Import : demandeur obligatoire' USING ERRCODE = 'CL001';
  END IF;
  IF EXISTS (SELECT 1 FROM device_journal_import WHERE device_id = p_device
                AND status IN ('PENDING','PROCESSING')) THEN
    RAISE EXCEPTION 'Un import est déjà actif pour le terminal %', d.serial USING ERRCODE = 'CL010';
  END IF;
  INSERT INTO device_journal_import (operator_id, device_id, batches, batches_sha256, summary, reason,
                                     requested_by)
  VALUES (d.operator_id, p_device, p_batches, p_batches_sha256, p_summary, btrim(p_reason), p_actor)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION create_device_journal_import(uuid, jsonb, bytea, jsonb, text, uuid) FROM PUBLIC;

-- Approbation : approbateur distinct du demandeur (CL001) ; empreinte égale à la stockée (CL053) ; import
-- APPLIED, FAILED ou REJECTED : CL053 ; aucun lot PROCESSING du terminal hors cet import (CL010) ;
-- PENDING|PROCESSING -> PROCESSING (idempotent : un import déjà PROCESSING n'admet que son approbateur).
-- Un lot du terminal resté PROCESSING plus de 15 min est d'abord abandonné (même règle que l'ouverture
-- ordinaire : sans elle, un lot interrompu avant la révocation bloquerait l'import pour toujours).
CREATE FUNCTION begin_device_journal_import(p_import uuid, p_batches_sha256 bytea, p_approver uuid)
RETURNS device_journal_import
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_dev uuid; v_op uuid; i device_journal_import%ROWTYPE;
BEGIN
  SELECT device_id, operator_id INTO v_dev, v_op FROM device_journal_import WHERE id = p_import;
  PERFORM assert_tenant(v_op);
  PERFORM 1 FROM device WHERE id = v_dev FOR UPDATE;                      -- terminal d'abord
  SELECT * INTO i FROM device_journal_import WHERE id = p_import FOR UPDATE;
  IF p_approver IS NULL OR p_approver = i.requested_by THEN
    RAISE EXCEPTION 'Import % : l''approbateur doit être une autre personne que le demandeur', p_import
      USING ERRCODE = 'CL001';
  END IF;
  IF p_batches_sha256 IS DISTINCT FROM i.batches_sha256 THEN
    RAISE EXCEPTION 'Import % : empreinte des lots différente de la demande', p_import USING ERRCODE = 'CL053';
  END IF;
  IF i.status IN ('APPLIED','FAILED','REJECTED') THEN
    RAISE EXCEPTION 'Import % en état final (%)', p_import, i.status USING ERRCODE = 'CL053';
  END IF;
  IF i.status = 'PROCESSING' AND i.approved_by IS DISTINCT FROM p_approver THEN
    RAISE EXCEPTION 'Import % déjà approuvé par une autre personne', p_import USING ERRCODE = 'CL001';
  END IF;
  UPDATE offline_batch SET status = 'REJECTED', reject_reason = 'ABANDONED'
   WHERE device_id = v_dev AND status = 'PROCESSING' AND received_at < clock_timestamp() - interval '15 minutes';
  IF EXISTS (SELECT 1 FROM offline_batch WHERE device_id = v_dev AND status = 'PROCESSING'
                AND import_id IS DISTINCT FROM p_import) THEN
    RAISE EXCEPTION 'Un lot du terminal est en cours de traitement : import % refusé', p_import
      USING ERRCODE = 'CL010';
  END IF;
  IF i.status = 'PENDING' THEN
    UPDATE device_journal_import SET status = 'PROCESSING', approved_by = p_approver
     WHERE id = p_import RETURNING * INTO i;
  END IF;
  RETURN i;
END $$;
REVOKE ALL ON FUNCTION begin_device_journal_import(uuid, bytea, uuid) FROM PUBLIC;

-- Fin : PROCESSING seulement, APPLIED ou FAILED (autre : CL001), résultat obligatoire, applied_at posé.
-- Ne prend que l'import (jamais le terminal).
CREATE FUNCTION finish_device_journal_import(p_import uuid, p_status text, p_result jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE i device_journal_import%ROWTYPE;
BEGIN
  SELECT * INTO i FROM device_journal_import WHERE id = p_import;
  PERFORM assert_tenant(i.operator_id);
  SELECT * INTO i FROM device_journal_import WHERE id = p_import FOR UPDATE;
  IF p_status IS NULL OR p_status NOT IN ('APPLIED','FAILED') THEN
    RAISE EXCEPTION 'Fin d''import : APPLIED ou FAILED, pas %', p_status USING ERRCODE = 'CL001';
  END IF;
  IF i.status <> 'PROCESSING' THEN
    RAISE EXCEPTION 'Import % en état % : fin refusée', p_import, i.status USING ERRCODE = 'CL001';
  END IF;
  IF p_result IS NULL THEN
    RAISE EXCEPTION 'Fin d''import : résultat obligatoire' USING ERRCODE = 'CL001';
  END IF;
  UPDATE device_journal_import SET status = p_status, result = p_result, applied_at = clock_timestamp()
   WHERE id = p_import;
END $$;
REVOKE ALL ON FUNCTION finish_device_journal_import(uuid, text, jsonb) FROM PUBLIC;

-- Lecture : la ligne, `batches` à NULL sauf demande.
CREATE FUNCTION device_journal_import_view(p_import uuid, p_with_batches boolean DEFAULT false)
RETURNS device_journal_import
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE i device_journal_import%ROWTYPE;
BEGIN
  SELECT * INTO i FROM device_journal_import WHERE id = p_import;
  PERFORM assert_tenant(i.operator_id);
  IF NOT coalesce(p_with_batches, false) THEN i.batches := NULL; END IF;
  RETURN i;
END $$;
REVOKE ALL ON FUNCTION device_journal_import_view(uuid, boolean) FROM PUBLIC;

-- Travailleur d'import (DM 01M667Y1J4DT3HY96ZBCXXMXBT, ADR-140) : identifiants des imports PROCESSING de TOUS
-- les prestataires, rien d'autre (ni lots, ni terminal, ni synthèse). Le travailleur traite ensuite chaque
-- import sous la RLS de son prestataire. Propriétaire qui ignore la RLS (voir l'en-tête).
CREATE FUNCTION device_journal_imports_processing() RETURNS TABLE (import_id uuid, operator_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT i.id, i.operator_id FROM device_journal_import i WHERE i.status = 'PROCESSING' ORDER BY i.created_at
$$;
REVOKE ALL ON FUNCTION device_journal_imports_processing() FROM PUBLIC;
