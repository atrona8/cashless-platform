-- Migration 0069 : ordre de dépense répliqué et lot de passerelle sans opération (mission passerelle-locale, lot
-- WP25 partie A ; décisions du porteur 45 (ADR-185) et 50 (ADR-187, OP-N119) ; contracts/interfaces.md fait foi).
--
--   1. Décision 45 : `edge_replication_terms(p_gateway)` (aide interne, JAMAIS accordée) rend en plus la clé
--      `spend_order` (`PROMO_FIRST` ou `PAID_FIRST`, état courant de la cascade, via `edge_spend_promo_first` de 0061,
--      la même fonction que le rejeu central) dans `edge_terms`. Seul ajout par rapport à 0065 ; la page de
--      réplication, qui appelle cette fonction, n'est PAS redéfinie.
--   2. Décision 50 : un lot sans opération (`edge_seq_to = edge_seq_from - 1`) est enregistrable pour l'idempotence
--      (la contrainte d'intervalle de `edge_sync_batch` admet l'intervalle vide) et `edge_sync_batch_begin` le
--      contrôle : époque d'autorité du grand livre (CL015), passerelle non révoquée (CL013), numéro de départ égal au
--      suivant du dernier numéro contigu du central (CL016). La règle « au moins un local_orders » est posée par
--      l'API (le corps n'est pas visible ici). Aucune écriture comptable, edge_seq et chaîne inchangés.
-- edge_replication_terms : CREATE OR REPLACE conserve les droits (aucun GRANT nouveau).
-- edge_sync_batch_begin : nouvelle signature (décision 51), REVOKE ALL FROM PUBLIC, GRANT repris dans post-roles.sql.
-- personne (CLAUDE.md, règle 4) : edge_sync_batch_begin (frontière de réception, contrôle d'époque) et
-- edge_replication_terms (cloisonnement par passerelle).

SET CONSTRAINTS ALL IMMEDIATE;

-- 1. Décision 45 -----------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION edge_replication_terms(p_gateway uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  g edge_gateway%ROWTYPE; lg ledger%ROWTYPE; v_result jsonb := '{}'::jsonb; v_cap bigint; v_n int; v_fee bigint;
BEGIN
  SELECT * INTO g FROM edge_gateway WHERE id = p_gateway;
  IF NOT FOUND THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  SELECT l.* INTO lg FROM ledger l WHERE l.id = edge_ledger_of_gateway(p_gateway);
  IF NOT FOUND THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  PERFORM assert_tenant(lg.operator_id);
  v_cap := edge_setting_value('replay_max_per_cash_topup', lg.currency);
  IF v_cap IS NOT NULL THEN v_result := v_result || jsonb_build_object('max_cash_topup', v_cap); END IF;
  -- Frais d'activation : une seule règle en vigueur ; assiette PER_MEDIA, donc le montant fixe borné par min et max.
  SELECT count(*), max(least(coalesce(f.max_amount, 9223372036854775807), greatest(coalesce(f.min_amount, 0), f.fixed_amount)))
    INTO v_n, v_fee
    FROM fee_rule f
   WHERE f.scope_type = 'EVENT' AND f.scope_id = g.event_id AND f.beneficiary_purpose = 'ORG_FFEST'
     AND f.basis = 'PER_MEDIA' AND f.valid_from <= clock_timestamp()
     AND (f.valid_to IS NULL OR clock_timestamp() < f.valid_to);
  IF v_n = 0 THEN v_result := v_result || jsonb_build_object('activation_fee', 0);
  ELSIF v_n = 1 THEN v_result := v_result || jsonb_build_object('activation_fee', v_fee);
  END IF;
  -- Décision 45 (ADR-185) : ordre de dépense de l'événement, état courant (cascade EVENT, ORGANIZER, OPERATOR, PLATFORM).
  v_result := v_result || jsonb_build_object('spend_order',
    CASE WHEN edge_spend_promo_first(lg.id, clock_timestamp()) THEN 'PROMO_FIRST' ELSE 'PAID_FIRST' END);
  v_result := v_result || jsonb_build_object('deposit_batches',
    (SELECT coalesce(jsonb_agg(jsonb_build_object('batch_id', b.id, 'deposit_amount', b.deposit_amount,
                                                   'deposit_mode', b.deposit_mode) ORDER BY b.id), '[]'::jsonb)
       FROM media_batch b WHERE b.event_id = g.event_id AND b.operator_id = g.operator_id));
  RETURN v_result;
END $$;

-- 2. Décision 50 -----------------------------------------------------------------------------------------------
DO $$
DECLARE c text;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint
            WHERE conrelid = 'edge_sync_batch'::regclass AND contype = 'c'
              AND pg_get_constraintdef(oid) LIKE '%edge_seq_to >= edge_seq_from%'
  LOOP
    EXECUTE format('ALTER TABLE edge_sync_batch DROP CONSTRAINT %I', c);
  END LOOP;
END $$;
ALTER TABLE edge_sync_batch ADD CONSTRAINT edge_sync_batch_span
  CHECK (edge_seq_to >= edge_seq_from - 1 AND edge_seq_to - edge_seq_from + 1 <= 500);

-- Décision 51 : la fonction reçoit le nombre d'ordres locaux du lot (p_local_orders) et refuse en base un intervalle
-- vide sans ordre (CL001), en plus du refus de l'API. Signature changée : l'ancienne est supprimée, la nouvelle est
-- retirée à PUBLIC ; son GRANT (cashless_edge seulement, liste inchangée) est repris dans post-roles.sql. Le défaut
-- 0 est volontaire : un appelant qui n'annonce pas d'ordre ne peut pas enregistrer un lot vide (échec fermé).
DROP FUNCTION edge_sync_batch_begin(uuid, uuid, bigint, bigint, bigint, bytea);
CREATE FUNCTION edge_sync_batch_begin(p_gateway uuid, p_batch uuid, p_epoch bigint, p_from bigint, p_to bigint,
                                      p_request_sha256 bytea, p_local_orders integer DEFAULT 0)
RETURNS TABLE (state text, already_done boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE g edge_gateway%ROWTYPE; b edge_sync_batch%ROWTYPE; lg uuid; v_epoch int;
BEGIN
  PERFORM edge_assert_session_gateway(p_gateway);
  SELECT * INTO g FROM edge_gateway WHERE id = p_gateway;
  IF NOT FOUND THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  PERFORM assert_tenant(g.operator_id);
  IF p_batch IS NULL OR p_epoch IS NULL OR p_epoch < 0 OR p_from IS NULL OR p_to IS NULL OR p_from < 1
     OR p_to < p_from - 1 OR p_to - p_from + 1 > 500
     OR p_request_sha256 IS NULL OR octet_length(p_request_sha256) <> 32 THEN
    RAISE EXCEPTION 'Lot incohérent (intervalle de 0 à 500 numéros, empreinte de 32 octets)' USING ERRCODE = 'CL001';
  END IF;
  IF p_to = p_from - 1 AND coalesce(p_local_orders, 0) < 1 THEN
    RAISE EXCEPTION 'Lot sans opération et sans ordre local' USING ERRCODE = 'CL001';
  END IF;
  -- Un seul begin à la fois par passerelle (le verrou tombe avec la transaction).
  PERFORM pg_advisory_xact_lock(hashtextextended('edge-batch:' || p_gateway, 0));
  -- Lot en vol interrompu depuis plus de 15 minutes : abandonné (A29).
  UPDATE edge_sync_batch SET status = 'ABANDONED', completed_at = clock_timestamp()
   WHERE gateway_id = p_gateway AND status IN ('RECEIVED','PROCESSING')
     AND received_at < clock_timestamp() - interval '15 minutes';

  SELECT * INTO b FROM edge_sync_batch WHERE batch_id = p_batch;
  IF FOUND THEN
    IF b.gateway_id <> p_gateway OR b.operator_id <> g.operator_id THEN
      RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found';
    END IF;
    IF b.request_sha256 <> p_request_sha256 OR b.epoch <> p_epoch OR b.edge_seq_from <> p_from
       OR b.edge_seq_to <> p_to THEN
      RAISE EXCEPTION 'batch_id % déjà utilisé avec un contenu différent', p_batch USING ERRCODE = 'CL002';
    END IF;
    RETURN QUERY SELECT b.status, b.status = 'DONE';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM edge_sync_batch WHERE gateway_id = p_gateway AND status IN ('RECEIVED','PROCESSING')) THEN
    RAISE EXCEPTION 'Un autre lot est en cours pour la passerelle' USING ERRCODE = 'CL010';
  END IF;
  lg := edge_ledger_of_gateway(p_gateway);
  IF lg IS NULL THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  -- Lot sans opération (décision 50, ADR-187) : aucune enveloppe ne contrôlera l'époque, donc ici, sur l'époque
  -- d'autorité du grand livre (CL015 sinon). Le lot n'a aucun effet comptable et ne bouge ni edge_seq ni la chaîne.
  IF p_to = p_from - 1 THEN
    IF g.status = 'REVOKED' THEN RAISE EXCEPTION 'Passerelle révoquée' USING ERRCODE = 'CL013'; END IF;
    SELECT authority_epoch INTO v_epoch FROM ledger WHERE id = lg;
    IF v_epoch IS DISTINCT FROM p_epoch::int THEN
      RAISE EXCEPTION 'Époque % différente de l''époque d''autorité du grand livre (%)', p_epoch, v_epoch
        USING ERRCODE = 'CL015';
    END IF;
    IF p_from <> g.contiguous_edge_seq + 1 THEN
      RAISE EXCEPTION 'Lot sans opération : edge_seq_from % reçu, % attendu', p_from, g.contiguous_edge_seq + 1
        USING ERRCODE = 'CL016';
    END IF;
  END IF;
  BEGIN
    INSERT INTO edge_sync_batch (batch_id, operator_id, gateway_id, ledger_id, epoch, edge_seq_from, edge_seq_to,
                                 request_sha256, status)
    VALUES (p_batch, g.operator_id, p_gateway, lg, p_epoch, p_from, p_to, p_request_sha256, 'PROCESSING');
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'Un autre lot est en cours pour la passerelle' USING ERRCODE = 'CL010';
  END;
  RETURN QUERY SELECT 'PROCESSING'::text, false;
END $$;
REVOKE ALL ON FUNCTION edge_sync_batch_begin(uuid, uuid, bigint, bigint, bigint, bytea, integer) FROM PUBLIC;
