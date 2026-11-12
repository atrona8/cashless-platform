-- Migration 0064 : corrections de lots approuvés (mission passerelle-locale, lot WP09 ; décisions du porteur du
-- 09/11/2026 n° 21, 23, 25 et 30 ; contracts/interfaces.md § 12 et § 13 font foi). Partie des définitions de 0061 et
-- de 0062 (jamais du schéma) : CREATE OR REPLACE, mêmes signatures, mêmes retours.
--
--   1. Décision 25 (0061) : plafond horaire par terminal. La fenêtre se calculait en SECONDES ENTIERES, bornes ouvertes
--      (]h - 3600 ; h + 3600[) : deux ventes à 3 599,9 s l'une de l'autre pouvaient ne pas se voir. Elle se calcule en
--      MICROSECONDES, bornes FERMEES ([h - 3 600 s ; h + 3 600 s]), métadonnée `ceiling_epoch_us`. Les écritures de 0061
--      (`ceiling_epoch`, secondes tronquées) restent comptées, avec une borne basse élargie d'une seconde (prudence).
--   2. Décision 21 (0062) : plafond par recharge en espèces au rejeu, réglage `replay_max_per_cash_topup` lu par
--      `edge_setting_value` (500 000 XOF par défaut, posé par `set_edge_setting`). Une recharge jamais REJECTED : le
--      crédit au portefeuille est borné par la marge ET par le plafond, le reste est écrit en espèces dues
--      (L-ESP-A-RENDRE) avec l'anomalie CASH_TOPUP_OVER_LIMIT, résolue à deux (même mécanisme que la décision 14,
--      OP-N108). Réglage absent pour la devise : échec fermé (tout est dû, rien n'est crédité), jamais de rejet.
--   3. Décision 23 (0063) : `edge_expose_device_token_families(p_event_id)`, SECURITY DEFINER, assert_tenant. Pose
--      `device_refresh_token.edge_exposed = true` sur la ligne courante (ni consommée, ni révoquée, ni expirée) de chaque
--      famille active des terminaux de l'événement ; JAMAIS une autre colonne. EXECUTE à cashless_app seul (WP09,
--      post-roles.sql) ; l'appel est fait par l'API centrale (WP12), avant la première réplication de l'empreinte.
--
-- Règle de la décision 28 : `SET CONSTRAINTS ALL IMMEDIATE` avant tout DDL qui suit une écriture (migrate.ts passe toutes
-- les migrations en une seule transaction).
-- Aucun GRANT ici (post-roles.sql, WP09). A faire relire par une personne : le plafond de recharge (argent en espèces)
-- et la fonction d'exposition des jetons.

SET CONSTRAINTS ALL IMMEDIATE;

-- 1. Réglage : nouvelle clé admise, valeur par défaut ---------------------------------------------------------------
ALTER TABLE edge_platform_setting DROP CONSTRAINT edge_platform_setting_key_check;
ALTER TABLE edge_platform_setting ADD CONSTRAINT edge_platform_setting_key_check
  CHECK (key ~ '^(replay_max_per_sale|replay_max_per_terminal_hour|replay_max_per_cash_topup)(\.[A-Z]{3})?$'
         OR key = 'pack_delay_seconds');

CREATE OR REPLACE FUNCTION set_edge_setting(p_key text, p_value bigint, p_label text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_before bigint;
BEGIN
  IF p_label IS NULL OR length(btrim(p_label)) = 0 THEN
    RAISE EXCEPTION 'Réglage : libellé de l''auteur obligatoire' USING ERRCODE = 'CL001';
  END IF;
  IF p_value IS NULL OR p_value <= 0 THEN
    RAISE EXCEPTION 'Réglage : valeur strictement positive obligatoire' USING ERRCODE = 'CL001';
  END IF;
  IF p_key IS NULL OR NOT (p_key ~ '^(replay_max_per_sale|replay_max_per_terminal_hour|replay_max_per_cash_topup)(\.[A-Z]{3})?$'
                           OR p_key = 'pack_delay_seconds') THEN
    RAISE EXCEPTION 'Réglage : clé inconnue' USING ERRCODE = 'CL001';
  END IF;
  SELECT s.value INTO v_before FROM edge_platform_setting s WHERE s.key = p_key;
  PERFORM set_config('app.edge_setting_write', 'on', true);
  INSERT INTO edge_platform_setting (key, value, updated_by_label)
  VALUES (p_key, p_value, btrim(p_label))
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = clock_timestamp(),
                                  updated_by_label = EXCLUDED.updated_by_label;
  PERFORM set_config('app.edge_setting_write', 'off', true);
  INSERT INTO audit_log (operator_id, actor_id, actor_role, action, object_type, object_id, before, after, origin)
  VALUES (NULL, NULL, session_user::text, 'EDGE_SETTING_CHANGED', 'EDGE_PLATFORM_SETTING', p_key,
          CASE WHEN v_before IS NULL THEN NULL ELSE jsonb_build_object('value', v_before) END,
          jsonb_build_object('value', p_value, 'label', btrim(p_label)), 'edge-admin');
END $$;
REVOKE ALL ON FUNCTION set_edge_setting(text, bigint, text) FROM PUBLIC;

-- Valeur par défaut (propriétaire, drapeau local posé le temps de l'insertion : la politique d'écriture l'exige).
SELECT set_config('app.edge_setting_write', 'on', true);
INSERT INTO edge_platform_setting (key, value, updated_by_label)
VALUES ('replay_max_per_cash_topup', 500000, 'porteur 2026-11-09 (décision 21)')
ON CONFLICT (key) DO NOTHING;
SELECT set_config('app.edge_setting_write', 'off', true);

-- 2. Décision 25 : index de la fenêtre en microsecondes ----------------------------------------------------------------
CREATE INDEX journal_transaction_edge_terminal_us_idx
  ON journal_transaction (device_id, ((metadata ->> 'ceiling_epoch_us')::bigint))
  WHERE source = 'EDGE_SYNC' AND type = 'PURCHASE';

-- 3. edge_post_transaction (0061) : fenêtre horaire en microsecondes, bornes fermées ----------------------------------
CREATE OR REPLACE FUNCTION edge_post_transaction(p_gateway uuid, p_epoch bigint, p_edge_seq bigint, p_origin_key text,
                                      p_content bytea, p_op jsonb, p_fee_lines jsonb)
RETURNS TABLE (outcome text, transaction_id uuid, reason text, detail text, charged_to_wallet bigint,
               shortfall_amount bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
#variable_conflict use_column
DECLARE
  g edge_gateway%ROWTYPE; lg ledger%ROWTYPE; h debit_authority_handover%ROWTYPE;
  v_h_edge debit_authority_handover%ROWTYPE; reg edge_sync_registry%ROWTYPE;
  dev device%ROWTYPE; med media%ROWTYPE; wal wallet%ROWTYPE; orig journal_transaction%ROWTYPE;
  v_type text; v_mode text; v_serial text; v_tseq bigint; v_occ timestamptz; v_cur text; v_strict boolean;
  v_amount bigint; v_has_amount boolean;
  v_dstatus text; v_dcharged bigint; v_dshort bigint; v_dreason text; v_dreject text;
  v_tap jsonb; v_th bytea; v_uid bytea; v_counter bigint;
  v_rr text; v_rd text; v_anomaly boolean := true;      -- rejet décidé par le central
  v_loss text; v_pos_participation uuid; v_merchant uuid; v_suspense uuid;
  v_acc_paid uuid; v_acc_promo uuid; v_bal_paid bigint; v_bal_promo bigint;
  v_av_paid bigint; v_av_promo bigint; v_cap_sale bigint; v_cap_hour bigint; v_used bigint; v_room bigint;
  v_eff timestamptz; v_eff_epoch bigint; v_cycle_start timestamptz;
  c0 bigint; c1 bigint; c2 bigint; c3 bigint; v_covered bigint; v_from_promo bigint; v_from_paid bigint;
  v_uncovered bigint; v_sale_clip boolean; v_hour_clip boolean; v_funds_clip boolean; v_blocked text;
  v_promo_first boolean; v_lines jsonb; v_meta jsonb; v_tx uuid; v_attempt int; v_retry boolean := false;
  v_ok boolean := false; v_result text; v_res_reason text; v_res_detail text; v_res_charged bigint := 0;
  v_res_short bigint := 0; v_ceiling_alert text; v_fee_sum bigint; v_fee_pos bigint; v_orig_amount bigint;
  v_orig_suspense bigint; v_orig_wallet bigint; v_open_short bigint; v_rev_tx uuid;
  v_has_proof boolean; v_ctx_ok boolean;
BEGIN
  -- Garde de session : p_gateway doit être la passerelle de la session mTLS (42501).
  PERFORM edge_assert_session_gateway(p_gateway);
  SELECT * INTO g FROM edge_gateway WHERE id = p_gateway;
  IF NOT FOUND THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  PERFORM assert_tenant(g.operator_id);
  IF p_content IS NULL OR octet_length(p_content) <> 32 OR p_edge_seq IS NULL OR p_edge_seq < 1
     OR p_epoch IS NULL OR p_origin_key IS NULL OR length(p_origin_key) = 0
     OR p_op IS NULL OR jsonb_typeof(p_op) <> 'object' THEN
    RAISE EXCEPTION 'Enveloppe : paramètres incohérents (contenu de 32 octets, numéro, époque, clé, opération)'
      USING ERRCODE = 'CL001';
  END IF;

  -- (1) Verrou de l'événement, partagé : le premier de toutes les fonctions de passerelle (C-012).
  PERFORM pg_advisory_xact_lock_shared(hashtextextended('edge-event:' || g.event_id, 0));
  SELECT * INTO g FROM edge_gateway WHERE id = p_gateway;      -- relue sous le verrou
  IF g.status = 'REVOKED' THEN RAISE EXCEPTION 'Passerelle révoquée' USING ERRCODE = 'CL013'; END IF;
  IF g.role <> 'PRIMARY' THEN RAISE EXCEPTION 'Passerelle en attente (STANDBY)' USING ERRCODE = 'CL013'; END IF;
  SELECT l.* INTO lg FROM ledger l WHERE l.id = edge_ledger_of_gateway(p_gateway);
  IF NOT FOUND THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  -- (2) Verrou partagé d'autorité de débit (celui de post_transaction).
  PERFORM pg_advisory_xact_lock_shared(hashtextextended('debit-authority:' || lg.id, 0));
  SELECT * INTO lg FROM ledger WHERE id = lg.id;                -- relu sous le verrou

  -- (3) Handover de CETTE passerelle pour SON grand livre : TO_EDGE ACTIVE, ou vidange TO_CENTRAL.
  SELECT d.* INTO h FROM debit_authority_handover d
   WHERE d.edge_gateway_id = p_gateway AND d.ledger_id = lg.id AND d.operator_id = g.operator_id
     AND ((d.direction = 'TO_EDGE' AND d.status = 'ACTIVE')
          OR (d.direction = 'TO_CENTRAL' AND d.status IN ('RELEASE_REQUESTED', 'RELEASING')))
   ORDER BY (d.direction = 'TO_CENTRAL') DESC, d.requested_at DESC LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Aucun handover actif de cette passerelle pour son grand livre' USING ERRCODE = 'CL013';
  END IF;
  IF p_epoch <> h.epoch::bigint OR lg.authority_epoch <> h.epoch THEN
    RAISE EXCEPTION 'Époque % différente de l''époque du handover % (grand livre : %)', p_epoch, h.epoch,
      lg.authority_epoch USING ERRCODE = 'CL015';
  END IF;
  IF lg.debit_authority <> 'EDGE' THEN
    RAISE EXCEPTION 'Le grand livre n''est pas sous la passerelle' USING ERRCODE = 'CL013';
  END IF;
  -- Début du cycle EDGE (borne du plafond horaire) : le TO_EDGE du cycle.
  IF h.direction = 'TO_EDGE' THEN v_cycle_start := h.requested_at;
  ELSE SELECT d.requested_at INTO v_cycle_start FROM debit_authority_handover d WHERE d.id = h.edge_handover_id;
  END IF;
  v_cycle_start := coalesce(v_cycle_start, h.requested_at);

  -- Rejeu d'un numéro déjà au registre : aucun effet, résultat mémorisé (même contenu exigé, CL002 sinon).
  SELECT * INTO reg FROM edge_sync_registry r WHERE r.gateway_id = p_gateway AND r.edge_seq = p_edge_seq;
  IF FOUND THEN
    IF reg.content_sha256 <> p_content OR reg.origin_key <> p_origin_key THEN
      RAISE EXCEPTION 'edge_seq % déjà reçu avec un contenu différent', p_edge_seq USING ERRCODE = 'CL002';
    END IF;
    RETURN QUERY SELECT reg.outcome, reg.transaction_id, reg.reason, NULL::text,
      coalesce((SELECT sum(po.amount) FROM posting po JOIN account a ON a.id = po.account_id
                 WHERE po.transaction_id = reg.transaction_id AND a.purpose IN ('WALLET_PAID', 'WALLET_PROMO')), 0)::bigint,
      coalesce((SELECT sum(po.amount) FROM posting po JOIN account a ON a.id = po.account_id
                 WHERE po.transaction_id = reg.transaction_id AND a.purpose = 'SUSPENSE'), 0)::bigint;
    RETURN;
  END IF;
  IF p_edge_seq <> g.contiguous_edge_seq + 1 THEN
    RAISE EXCEPTION 'edge_seq % reçu, % attendu', p_edge_seq, g.contiguous_edge_seq + 1 USING ERRCODE = 'CL016';
  END IF;

  -- Champs d'enveloppe (bien formés, sinon rejet enregistré) ---------------------------------------------------------
  v_type := p_op ->> 'type';
  v_mode := p_op ->> 'authorized_mode';
  v_serial := p_op ->> 'device_serial';
  v_tseq := CASE WHEN p_op ->> 'seq' ~ '^[0-9]{1,15}$' THEN (p_op ->> 'seq')::bigint END;
  v_cur := p_op ->> 'currency';
  v_loss := 'OPERATOR';

  <<check_block>>
  BEGIN
    -- Type : traité ici PURCHASE, REVERSAL, VOID ; tout autre (ADJUSTMENT...) refusé (borne 1).
    IF v_type IS NULL OR v_type NOT IN ('PURCHASE', 'REVERSAL', 'VOID') THEN
      v_rr := 'MALFORMED_OPERATION';
      v_rd := CASE WHEN v_type IN ('TOPUP_CASH', 'ACTIVATION', 'DEPOSIT_CASH', 'ONLINE_REF')
                   THEN 'WRONG_ENVELOPE' ELSE 'TYPE_NOT_ALLOWED' END;
      EXIT check_block;
    END IF;
    IF v_tseq IS NULL OR v_serial IS NULL OR length(v_serial) = 0
       OR p_origin_key <> v_serial || ':' || v_tseq
       OR p_op ->> 'edge_seq' IS DISTINCT FROM p_edge_seq::text
       OR v_mode IS NULL OR v_mode NOT IN ('EDGE_ONLINE', 'DEVICE_OFFLINE') THEN
      v_rr := 'MALFORMED_OPERATION'; v_rd := 'ORIGIN_FIELDS'; EXIT check_block;
    END IF;
    BEGIN
      v_occ := (p_op ->> 'occurred_at')::timestamptz;
    EXCEPTION WHEN others THEN v_occ := NULL;
    END;
    IF v_occ IS NULL OR (p_op ->> 'occurred_at') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T' THEN
      v_rr := 'MALFORMED_OPERATION'; v_rd := 'ORIGIN_OCCURRED_AT'; EXIT check_block;
    END IF;
    IF v_type = 'VOID' THEN EXIT check_block; END IF;

    -- Terminal d'origine (lu en base, de l'événement de la passerelle).
    SELECT d.* INTO dev FROM device d
     WHERE d.serial = v_serial AND d.operator_id = g.operator_id AND d.event_id = g.event_id
     ORDER BY (d.status <> 'REVOKED') DESC, d.id LIMIT 1;
    IF NOT FOUND THEN v_rr := 'MALFORMED_OPERATION'; v_rd := 'UNKNOWN_TERMINAL'; EXIT check_block; END IF;
    v_loss := CASE dev.provided_by WHEN 'MERCHANT' THEN 'MERCHANT' WHEN 'ORGANIZER' THEN 'ORGANIZER' ELSE 'OPERATOR' END;

    IF v_cur IS NULL OR v_cur <> lg.currency THEN
      v_rr := 'CURRENCY_MISMATCH'; v_rd := 'LEDGER_CURRENCY'; EXIT check_block;
    END IF;
    v_has_amount := p_op ? 'amount' AND jsonb_typeof(p_op -> 'amount') <> 'null';
    IF v_has_amount THEN
      IF jsonb_typeof(p_op -> 'amount') <> 'number' OR (p_op ->> 'amount') !~ '^[0-9]{1,15}$'
         OR (p_op ->> 'amount')::bigint <= 0 THEN
        v_rr := 'MALFORMED_OPERATION'; v_rd := 'AMOUNT'; EXIT check_block;
      END IF;
      v_amount := (p_op ->> 'amount')::bigint;
    END IF;
    IF v_type = 'PURCHASE' AND NOT v_has_amount THEN
      v_rr := 'MALFORMED_OPERATION'; v_rd := 'AMOUNT_REQUIRED'; EXIT check_block;
    END IF;

    -- Décision de la passerelle : obligatoire dès qu'un montant est porté.
    IF v_has_amount THEN
      IF jsonb_typeof(p_op -> 'edge_decision') IS DISTINCT FROM 'object' THEN
        v_rr := 'MALFORMED_OPERATION'; v_rd := 'DECISION_MISSING'; EXIT check_block;
      END IF;
      v_dstatus := p_op -> 'edge_decision' ->> 'status';
      v_dreason := p_op -> 'edge_decision' ->> 'shortfall_reason';
      v_dreject := p_op -> 'edge_decision' ->> 'reject_reason';
      IF (p_op -> 'edge_decision' ->> 'charged_to_wallet') !~ '^[0-9]{1,15}$'
         OR (p_op -> 'edge_decision' ->> 'shortfall_amount') !~ '^[0-9]{1,15}$'
         OR jsonb_typeof(p_op -> 'edge_decision' -> 'charged_to_wallet') <> 'number'
         OR jsonb_typeof(p_op -> 'edge_decision' -> 'shortfall_amount') <> 'number'
         OR v_dstatus IS NULL OR v_dstatus NOT IN ('ACCEPTED', 'ACCEPTED_WITH_SHORTFALL', 'REJECTED') THEN
        v_rr := 'MALFORMED_OPERATION'; v_rd := 'DECISION_INVALID'; EXIT check_block;
      END IF;
      v_dcharged := (p_op -> 'edge_decision' ->> 'charged_to_wallet')::bigint;
      v_dshort := (p_op -> 'edge_decision' ->> 'shortfall_amount')::bigint;
      IF v_dstatus = 'REJECTED' THEN
        -- Refus déclaré par la passerelle : relayé, sans écriture ni anomalie.
        IF v_dreject IS NULL OR v_dreject NOT IN ('IDEMPOTENCY_KEY_REUSED', 'MALFORMED_OPERATION', 'CURRENCY_MISMATCH',
             'OFFLINE_NOT_ALLOWED', 'POLICY_LIMIT_EXCEEDED', 'SNAPSHOT_TOO_OLD', 'SNAPSHOT_VERSION_UNKNOWN',
             'MEDIA_NOT_IN_SNAPSHOT', 'MEDIA_BLOCKED_IN_SNAPSHOT', 'MEDIA_WRONG_EVENT', 'PACK_NOT_VERIFIED',
             'REVERSAL_TARGET_NOT_FOUND', 'ALREADY_REVERSED', 'PERIOD_CLOSED', 'LEDGER_LOCKED',
             'WALLET_LIMIT_EXCEEDED', 'INSUFFICIENT_FUNDS_RETRY', 'SYNC_DEADLINE_PASSED', 'EDGE_REPLAY_FAILED',
             'ONLINE_NOT_EXECUTED') THEN
          v_rr := 'MALFORMED_OPERATION'; v_rd := 'DECISION_INVALID'; EXIT check_block;
        END IF;
        v_rr := v_dreject; v_rd := 'EDGE_DECLARED'; v_anomaly := false; EXIT check_block;
      END IF;
      IF v_dcharged + v_dshort <> v_amount
         OR (v_dstatus = 'ACCEPTED' AND v_dshort <> 0)
         OR (v_dstatus = 'ACCEPTED_WITH_SHORTFALL' AND v_dshort = 0)
         OR (v_dshort > 0 AND (v_dreason IS NULL OR v_dreason NOT IN ('INSUFFICIENT_FUNDS',
              'MEDIA_BLOCKED_AFTER_SNAPSHOT', 'MEDIA_CLONE_SUSPECTED', 'MEDIA_UID_MISMATCH',
              'MEDIA_SIGNATURE_MISMATCH', 'WALLET_BLOCKED'))) THEN
        v_rr := 'MALFORMED_OPERATION'; v_rd := 'DECISION_INCONSISTENT'; EXIT check_block;
      END IF;
    END IF;

    -- Régime : strict (preuve du bracelet, plafonds) sauf DEVICE_OFFLINE attesté par l'API.
    v_strict := NOT (v_mode = 'DEVICE_OFFLINE' AND p_op ? 'device_batch_id'
                     AND coalesce(p_op ->> 'device_batch_verified', 'false') = 'true');

    -- Bracelet désigné par token_hash (objet tap), portefeuille dans le grand livre du handover (borne 2).
    v_tap := p_op -> 'tap';
    IF jsonb_typeof(v_tap) IS DISTINCT FROM 'object'
       OR (v_tap ->> 'token_hash') !~ '^[0-9a-f]{64}$' THEN
      v_rr := 'MALFORMED_OPERATION'; v_rd := 'TAP_MISSING'; EXIT check_block;
    END IF;
    v_th := decode(v_tap ->> 'token_hash', 'hex');
    SELECT m.* INTO med FROM media m WHERE m.operator_id = g.operator_id AND m.token_hash = v_th FOR UPDATE;
    IF NOT FOUND OR med.wallet_id IS NULL THEN
      v_rr := 'MALFORMED_OPERATION'; v_rd := 'UNKNOWN_MEDIA'; EXIT check_block;
    END IF;
    SELECT w.* INTO wal FROM wallet w WHERE w.id = med.wallet_id;
    IF wal.ledger_id <> lg.id OR wal.operator_id <> g.operator_id THEN
      v_rr := 'MALFORMED_OPERATION'; v_rd := 'WALLET_OTHER_LEDGER'; EXIT check_block;
    END IF;
    -- Compte marchand du point de vente du terminal d'origine (jamais lu dans la requête).
    SELECT pos.participation_id INTO v_pos_participation FROM point_of_sale pos WHERE pos.id = dev.pos_id;
    SELECT a.id INTO v_merchant FROM account a
     WHERE a.ledger_id = lg.id AND a.purpose = 'MERCHANT' AND a.participation_id = v_pos_participation AND a.is_active;
    IF v_merchant IS NULL THEN
      v_rr := 'MALFORMED_OPERATION'; v_rd := 'NO_MERCHANT_ACCOUNT'; EXIT check_block;
    END IF;
    SELECT a.id INTO v_suspense FROM account a WHERE a.ledger_id = lg.id AND a.purpose = 'SUSPENSE' AND a.is_active;
    SELECT a.id INTO v_acc_paid FROM account a
     WHERE a.ledger_id = lg.id AND a.purpose = 'WALLET_PAID' AND a.wallet_id = wal.id AND a.is_active;
    SELECT a.id INTO v_acc_promo FROM account a
     WHERE a.ledger_id = lg.id AND a.purpose = 'WALLET_PROMO' AND a.wallet_id = wal.id AND a.is_active;

    -- Preuve du bracelet (borne 6) : PURCHASE et REVERSAL en régime strict.
    IF v_strict THEN
      IF (v_tap ->> 'nfc_uid') !~ '^[0-9a-f]{14}$' OR jsonb_typeof(v_tap -> 'counter') <> 'number'
         OR (v_tap ->> 'counter') !~ '^[0-9]{1,8}$' THEN
        v_rr := 'MALFORMED_OPERATION'; v_rd := 'TAP_INVALID'; EXIT check_block;
      END IF;
      v_uid := decode(v_tap ->> 'nfc_uid', 'hex');
      v_counter := (v_tap ->> 'counter')::bigint;
      IF v_uid IS DISTINCT FROM med.nfc_uid THEN
        v_rr := 'MALFORMED_OPERATION'; v_rd := 'TAP_UID_MISMATCH'; EXIT check_block;
      END IF;
      IF coalesce(v_tap ->> 'signature_verified', 'false') <> 'true' THEN
        v_rr := 'MALFORMED_OPERATION'; v_rd := 'TAP_SIGNATURE_NOT_VERIFIED'; EXIT check_block;
      END IF;
      IF coalesce(v_tap ->> 'pack_verified', 'false') <> 'true' THEN
        v_rr := 'MALFORMED_OPERATION'; v_rd := 'TAP_PACK_NOT_VERIFIED'; EXIT check_block;
      END IF;
      IF v_counter <= coalesce(med.last_counter, -1) THEN
        v_rr := 'MALFORMED_OPERATION'; v_rd := 'TAP_COUNTER_NOT_INCREASING'; EXIT check_block;
      END IF;
    END IF;

    -- Ligne de frais et de commission (PURCHASE seulement) : validées, jamais de ligne de portefeuille ni d'attente.
    IF v_type = 'PURCHASE' AND p_fee_lines IS NOT NULL AND p_fee_lines <> '[]'::jsonb THEN
      BEGIN
        IF jsonb_typeof(p_fee_lines) <> 'array' THEN
          v_rr := 'MALFORMED_OPERATION'; v_rd := 'FEE_LINES_INVALID'; EXIT check_block;
        END IF;
        SELECT coalesce(sum((l ->> 'amount')::bigint), 0),
               coalesce(sum(greatest((l ->> 'amount')::bigint, 0)), 0)
          INTO v_fee_sum, v_fee_pos FROM jsonb_array_elements(p_fee_lines) l;
        IF v_fee_sum <> 0 OR v_fee_pos > v_amount
           -- Borne (M2) : le total prélevé au commerçant ne dépasse pas ce que les règles de frais distinctes
           -- référencées (hors taxes, la taxe étant comprise dans la commission TTC) permettent pour ce montant :
           -- taux x montant + fixe, au moins min_amount, au plus max_amount. Le recalcul exact (arrondi, taxe)
           -- reste à WP13, qui doit fournir des lignes issues du moteur central.
           OR v_fee_pos > coalesce((
                SELECT sum(least(coalesce(fr.max_amount, 9000000000000000000::bigint),
                                 greatest(coalesce(fr.min_amount, 0),
                                          ceil(fr.rate_bps::numeric * v_amount / 10000 + fr.fixed_amount)::bigint)))
                  FROM fee_rule fr
                 WHERE fr.id IN (SELECT (l ->> 'fee_rule_id')::uuid FROM jsonb_array_elements(p_fee_lines) l
                                   JOIN account a2 ON a2.id = (l ->> 'account_id')::uuid
                                  WHERE a2.purpose IN ('ORG_COM', 'OPE_FRAIS', 'PLT_REDEV'))), 0)
           OR EXISTS (
             SELECT 1 FROM jsonb_array_elements(p_fee_lines) l
              WHERE jsonb_typeof(l) <> 'object' OR jsonb_typeof(l -> 'amount') <> 'number'
                 OR (l ->> 'amount')::bigint = 0 OR NOT EXISTS (
                   SELECT 1 FROM account a
                    WHERE a.id = (l ->> 'account_id')::uuid AND a.ledger_id = lg.id AND a.is_active
                      AND ((a.id = v_merchant AND (l ->> 'amount')::bigint > 0)
                        OR (a.purpose IN ('ORG_COM', 'ORG_TAX', 'OPE_FRAIS', 'OPE_TAX', 'PLT_REDEV', 'PLT_TAX')
                            AND (l ->> 'amount')::bigint < 0
                            AND EXISTS (SELECT 1 FROM fee_rule fr
                                         WHERE fr.id = (l ->> 'fee_rule_id')::uuid
                                           AND fr.beneficiary_purpose = a.purpose
                                           AND (fr.operator_id IS NULL OR fr.operator_id = g.operator_id)))))) THEN
          v_rr := 'MALFORMED_OPERATION'; v_rd := 'FEE_LINES_INVALID'; EXIT check_block;
        END IF;
      EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR datatype_mismatch
                     OR invalid_parameter_value THEN
        v_rr := 'MALFORMED_OPERATION'; v_rd := 'FEE_LINES_INVALID'; EXIT check_block;
      END;
    END IF;
  END;

  -- Rejet décidé avant toute écriture : numéro consommé, rien d'écrit.
  IF v_rr IS NOT NULL THEN
    PERFORM edge_record_rejection(p_gateway, lg.id, p_edge_seq, p_origin_key, p_content, v_rr, v_rd, dev.id, med.id,
              v_tseq, v_amount, v_loss, v_anomaly);
    RETURN QUERY SELECT 'REJECTED'::text, NULL::uuid, v_rr, v_rd, 0::bigint, 0::bigint;
    RETURN;
  END IF;

  -- VOID : numéro consommé sans effet comptable.
  IF v_type = 'VOID' THEN
    PERFORM edge_record_seq(p_gateway, p_edge_seq, p_origin_key, p_content, 'VOID', NULL,
              coalesce(nullif(p_op ->> 'void_reason', ''), 'VOID'));
    RETURN QUERY SELECT 'VOID'::text, NULL::uuid, coalesce(nullif(p_op ->> 'void_reason', ''), 'VOID'), NULL::text,
                        0::bigint, 0::bigint;
    RETURN;
  END IF;

  -- Clé d'origine déjà au journal : DUPLICATE (écriture du même rejeu direct ou de la route en ligne).
  SELECT t.* INTO orig FROM journal_transaction t WHERE t.ledger_id = lg.id AND t.idempotency_key = p_origin_key;
  IF FOUND THEN
    PERFORM edge_record_seq(p_gateway, p_edge_seq, p_origin_key, p_content, 'DUPLICATE', orig.id, NULL);
    RETURN QUERY SELECT 'DUPLICATE'::text, orig.id, NULL::text, NULL::text,
      coalesce((SELECT sum(po.amount) FROM posting po JOIN account a ON a.id = po.account_id
                 WHERE po.transaction_id = orig.id AND a.purpose IN ('WALLET_PAID', 'WALLET_PROMO')), 0)::bigint,
      coalesce((SELECT sum(po.amount) FROM posting po JOIN account a ON a.id = po.account_id
                 WHERE po.transaction_id = orig.id AND a.purpose = 'SUSPENSE'), 0)::bigint;
    RETURN;
  END IF;

  -- REVERSAL : cible (borne 8) -------------------------------------------------------------------------------------
  IF v_type = 'REVERSAL' THEN
    IF p_op ->> 'reverses_transaction_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      SELECT t.* INTO orig FROM journal_transaction t
       WHERE t.id = (p_op ->> 'reverses_transaction_id')::uuid AND t.ledger_id = lg.id AND t.type = 'PURCHASE';
    ELSIF p_op ->> 'reverses_seq' ~ '^[0-9]{1,15}$' THEN
      SELECT t.* INTO orig FROM journal_transaction t
       WHERE t.ledger_id = lg.id AND t.type = 'PURCHASE'
         AND t.idempotency_key = v_serial || ':' || (p_op ->> 'reverses_seq');
    ELSE
      v_rr := 'MALFORMED_OPERATION'; v_rd := 'REVERSAL_TARGET_MISSING';
    END IF;
    IF v_rr IS NULL AND orig.id IS NULL THEN v_rr := 'REVERSAL_TARGET_NOT_FOUND'; v_rd := 'TARGET_NOT_WRITTEN'; END IF;
    -- Borne (M1) : la cible doit avoir été écrite par CETTE passerelle (source EDGE_SYNC) dans le cycle de remise courant.
    IF v_rr IS NULL AND (orig.source <> 'EDGE_SYNC' OR orig.metadata ->> 'edge_gateway_id' IS DISTINCT FROM p_gateway::text
                         OR orig.recorded_at < v_cycle_start) THEN
      v_rr := 'REVERSAL_TARGET_NOT_FOUND'; v_rd := 'TARGET_NOT_IN_CYCLE';
    END IF;
    IF v_rr IS NULL THEN
      SELECT m2.wallet_id = med.wallet_id INTO v_ctx_ok FROM media m2 WHERE m2.id = orig.media_id;
      IF v_ctx_ok IS DISTINCT FROM true THEN v_rr := 'MALFORMED_OPERATION'; v_rd := 'REVERSAL_OTHER_WALLET'; END IF;
    END IF;
    IF v_rr IS NULL THEN
      SELECT coalesce(sum(po.amount), 0) INTO v_orig_amount FROM posting po JOIN account a ON a.id = po.account_id
       WHERE po.transaction_id = orig.id AND a.purpose IN ('WALLET_PAID', 'WALLET_PROMO', 'SUSPENSE');
      IF v_has_amount AND v_amount <> v_orig_amount THEN
        v_rr := 'MALFORMED_OPERATION'; v_rd := 'REVERSAL_AMOUNT_MISMATCH';
      END IF;
    END IF;
    IF v_rr IS NULL THEN
      SELECT t.id INTO v_rev_tx FROM journal_transaction t WHERE t.reverses_id = orig.id;
      IF FOUND THEN
        PERFORM edge_record_seq(p_gateway, p_edge_seq, p_origin_key, p_content, 'DUPLICATE', v_rev_tx, NULL);
        RETURN QUERY SELECT 'DUPLICATE'::text, v_rev_tx, NULL::text, 'ALREADY_REVERSED'::text, 0::bigint, 0::bigint;
        RETURN;
      END IF;
    END IF;
    IF v_rr IS NOT NULL THEN
      PERFORM edge_record_rejection(p_gateway, lg.id, p_edge_seq, p_origin_key, p_content, v_rr, v_rd, dev.id, med.id,
                v_tseq, v_amount, v_loss, true);
      RETURN QUERY SELECT 'REJECTED'::text, NULL::uuid, v_rr, v_rd, 0::bigint, 0::bigint;
      RETURN;
    END IF;
  END IF;

  -- (4) Verrou du terminal (plafond horaire), (5) bracelet déjà verrouillé plus haut (FOR UPDATE).
  IF v_type = 'PURCHASE' AND v_strict THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('edge-terminal:' || dev.id, 0));
    v_cap_sale := edge_setting_value('replay_max_per_sale', lg.currency);
    v_cap_hour := edge_setting_value('replay_max_per_terminal_hour', lg.currency);
    IF v_cap_sale IS NULL OR v_cap_hour IS NULL THEN
      -- Échec fermé : aucune écriture sans plafond configuré pour la devise.
      PERFORM edge_record_rejection(p_gateway, lg.id, p_edge_seq, p_origin_key, p_content,
                'INSUFFICIENT_FUNDS_RETRY', 'EDGE_CEILING_NOT_CONFIGURED', dev.id, med.id, v_tseq, v_amount, v_loss, true);
      RETURN QUERY SELECT 'REJECTED'::text, NULL::uuid, 'INSUFFICIENT_FUNDS_RETRY'::text,
                          'EDGE_CEILING_NOT_CONFIGURED'::text, 0::bigint, 0::bigint;
      RETURN;
    END IF;
  END IF;

  -- Écriture : sous-transaction rejouée une fois sur CL007 (borne 5) ------------------------------------------------
  v_attempt := 0;
  LOOP
    v_attempt := v_attempt + 1;
    v_rr := NULL; v_rd := NULL; v_tx := NULL; v_ok := false;
    BEGIN
      IF v_type = 'PURCHASE' THEN
        -- (6) Soldes du portefeuille verrouillés (FOR UPDATE) AVANT la lecture. Jamais de lecture suivie d'écriture
        -- sans verrou.
        INSERT INTO account_balance (account_id, operator_id)
             SELECT a.id, g.operator_id FROM account a WHERE a.id IN (v_acc_paid, v_acc_promo)
        ON CONFLICT (account_id) DO NOTHING;
        PERFORM 1 FROM account_balance ab WHERE ab.account_id IN (v_acc_paid, v_acc_promo)
          ORDER BY ab.account_id FOR UPDATE;
        SELECT coalesce(ab.balance, 0) INTO v_bal_paid FROM account_balance ab WHERE ab.account_id = v_acc_paid;
        SELECT coalesce(ab.balance, 0) INTO v_bal_promo FROM account_balance ab WHERE ab.account_id = v_acc_promo;
        v_av_paid := greatest(-coalesce(v_bal_paid, 0), 0);
        v_av_promo := greatest(-coalesce(v_bal_promo, 0), 0);

        c0 := v_dcharged; c1 := c0; v_sale_clip := false; v_hour_clip := false; v_funds_clip := false;
        v_blocked := NULL;
        IF v_strict THEN
          -- Borne 3 : plafond par vente.
          c1 := least(c1, v_cap_sale); v_sale_clip := c1 < c0;
          -- Borne 7 : plafond par terminal et par heure glissante, bornée au cycle.
          v_eff := least(greatest(v_occ, v_cycle_start - interval '15 minutes'), clock_timestamp() + interval '15 minutes');
          v_eff_epoch := (extract(epoch FROM v_eff) * 1000000)::bigint;      -- microsecondes (décision 25)
          SELECT coalesce(sum((t.metadata ->> 'edge_amount')::bigint), 0) INTO v_used
            FROM journal_transaction t
           WHERE t.device_id = dev.id AND t.source = 'EDGE_SYNC' AND t.type = 'PURCHASE'
             AND t.metadata ->> 'origin_mode' = 'EDGE_ONLINE'
             AND (   ((t.metadata ->> 'ceiling_epoch_us')::bigint BETWEEN v_eff_epoch - 3600000000
                                                                       AND v_eff_epoch + 3600000000)
                  -- Écritures de 0061 (secondes entières, tronquées vers le bas) : bornes élargies d'une seconde,
                  -- sens de la prudence (on compte une vente de trop plutôt qu'une de moins).
                  OR (t.metadata ->> 'ceiling_epoch_us' IS NULL
                      AND (t.metadata ->> 'ceiling_epoch')::bigint * 1000000 BETWEEN v_eff_epoch - 3600000000 - 999999
                                                                                 AND v_eff_epoch + 3600000000));
          v_room := greatest(v_cap_hour - v_used, 0);
          c2 := least(c1, v_room); v_hour_clip := c2 < c1; c1 := c2;
        END IF;
        -- Bracelet ou portefeuille bloqué depuis : rien n'est prélevé, tout va en attente.
        IF wal.status <> 'ACTIVE' THEN v_blocked := 'WALLET_BLOCKED'; c1 := 0;
        ELSIF med.status <> 'ACTIVE' THEN v_blocked := 'MEDIA_BLOCKED_AFTER_SNAPSHOT'; c1 := 0;
        END IF;
        -- Borne 4 : rognage au solde central lu sous verrou.
        c3 := least(c1, v_av_paid + v_av_promo); v_funds_clip := c3 < c1;
        v_covered := c3;
        v_promo_first := edge_spend_promo_first(lg.id, v_occ);
        v_from_promo := CASE WHEN v_promo_first THEN least(v_covered, v_av_promo)
                             ELSE greatest(0, v_covered - v_av_paid) END;
        v_from_paid := v_covered - v_from_promo;
        v_uncovered := v_amount - v_covered;
        IF v_uncovered > 0 AND v_suspense IS NULL THEN
          RAISE EXCEPTION 'Compte d''attente absent du grand livre' USING ERRCODE = 'CL001';
        END IF;
        IF v_from_promo > 0 AND v_acc_promo IS NULL OR v_from_paid > 0 AND v_acc_paid IS NULL THEN
          RAISE EXCEPTION 'Compte de portefeuille absent' USING ERRCODE = 'CL001';
        END IF;

        v_lines := '[]'::jsonb;
        IF v_from_promo > 0 THEN
          v_lines := v_lines || jsonb_build_object('account_id', v_acc_promo, 'amount', v_from_promo);
        END IF;
        IF v_from_paid > 0 THEN
          v_lines := v_lines || jsonb_build_object('account_id', v_acc_paid, 'amount', v_from_paid);
        END IF;
        IF v_uncovered > 0 THEN
          v_lines := v_lines || jsonb_build_object('account_id', v_suspense, 'amount', v_uncovered);
        END IF;
        v_lines := v_lines || jsonb_build_object('account_id', v_merchant, 'amount', -v_amount);
        IF p_fee_lines IS NOT NULL AND p_fee_lines <> '[]'::jsonb THEN
          SELECT v_lines || jsonb_agg(jsonb_build_object('account_id', l ->> 'account_id',
                   'amount', (l ->> 'amount')::bigint, 'fee_rule_id', l ->> 'fee_rule_id', 'memo', l ->> 'memo')
                   ORDER BY ord)
            INTO v_lines FROM jsonb_array_elements(p_fee_lines) WITH ORDINALITY AS t(l, ord);
        END IF;

        v_meta := jsonb_build_object('origin_key', p_origin_key,
                    'origin_occurred_at', to_char(v_occ AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                    'origin_mode', v_mode, 'edge_gateway_id', p_gateway, 'edge_seq', p_edge_seq,
                    'device_serial', v_serial, 'edge_amount', v_amount,
                    'edge_charged_requested', c0, 'edge_charged_written', v_covered);
        IF p_op ->> 'vendor_session_id' IS NOT NULL THEN
          v_meta := v_meta || jsonb_build_object('vendor_session_id', p_op ->> 'vendor_session_id');
        END IF;
        IF v_strict THEN v_meta := v_meta || jsonb_build_object('ceiling_epoch_us', v_eff_epoch); END IF;

        v_tx := post_transaction(lg.id, 'PURCHASE', p_origin_key, v_occ, 'EDGE_SYNC', v_lines, g.event_id, NULL, NULL,
                                 NULL, NULL, dev.id, med.id, v_meta);

        IF v_strict THEN
          INSERT INTO media_tap (operator_id, media_id, counter, nfc_uid, occurred_at, device_id, mode, transaction_id)
          VALUES (g.operator_id, med.id, v_counter, v_uid, v_occ, dev.id, 'ONLINE', v_tx);
          UPDATE media SET last_counter = greatest(coalesce(last_counter, -1), v_counter) WHERE id = med.id;
        END IF;

        v_res_reason := NULL; v_res_detail := NULL;
        IF v_uncovered > 0 THEN
          v_res_reason := CASE WHEN v_blocked IS NOT NULL THEN v_blocked
                               WHEN v_sale_clip OR v_hour_clip OR v_funds_clip THEN 'INSUFFICIENT_FUNDS'
                               ELSE v_dreason END;
          v_res_detail := CASE WHEN v_sale_clip OR v_hour_clip THEN 'EDGE_REPLAY_CEILING'
                               WHEN v_funds_clip THEN 'CENTRAL_BALANCE' END;
          PERFORM open_offline_anomaly(lg.id, 'OFFLINE_SHORTFALL', dev.id, med.id, v_tseq, v_tx, v_uncovered, v_loss,
                    jsonb_build_object('source', 'EDGE_SYNC', 'edge_gateway_id', p_gateway, 'origin_key', p_origin_key,
                                       'reason', v_res_reason, 'detail', v_res_detail), NULL);
        END IF;
        v_ceiling_alert := CASE WHEN v_hour_clip THEN 'terminal_hour' WHEN v_sale_clip THEN 'sale' END;
        IF v_ceiling_alert IS NOT NULL THEN
          PERFORM edge_admin_audit(g.operator_id, 'EDGE_REPLAY_CEILING', p_gateway, 'edge_post_transaction',
                    jsonb_build_object('ceiling', v_ceiling_alert, 'device_serial', v_serial, 'edge_seq', p_edge_seq,
                                       'amount', v_amount, 'requested', c0, 'written', v_covered),
                    'EDGE_REPLAY_CEILING');
        END IF;
        v_result := CASE WHEN v_uncovered > 0 THEN 'ACCEPTED_WITH_SHORTFALL' ELSE 'ACCEPTED' END;
        v_res_charged := v_covered; v_res_short := v_uncovered;

      ELSE
        -- REVERSAL : contre-passation exacte de la vente écrite au central. Les soldes du portefeuille sont
        -- verrouillés avant l'écriture (même ordre que la vente).
        INSERT INTO account_balance (account_id, operator_id)
             SELECT a.id, g.operator_id FROM account a
              WHERE a.id IN (SELECT po.account_id FROM posting po WHERE po.transaction_id = orig.id)
                AND NOT a.hot
        ON CONFLICT (account_id) DO NOTHING;
        PERFORM 1 FROM account_balance ab
         WHERE ab.account_id IN (SELECT po.account_id FROM posting po WHERE po.transaction_id = orig.id)
         ORDER BY ab.account_id FOR UPDATE;
        SELECT jsonb_agg(jsonb_build_object('account_id', po.account_id, 'amount', -po.amount,
                                            'fee_rule_id', po.fee_rule_id, 'memo', po.memo) ORDER BY po.line_no)
          INTO v_lines FROM posting po WHERE po.transaction_id = orig.id;
        SELECT coalesce(sum(po.amount), 0) INTO v_orig_wallet FROM posting po JOIN account a ON a.id = po.account_id
         WHERE po.transaction_id = orig.id AND a.purpose IN ('WALLET_PAID', 'WALLET_PROMO');
        SELECT coalesce(sum(po.amount), 0) INTO v_orig_suspense FROM posting po JOIN account a ON a.id = po.account_id
         WHERE po.transaction_id = orig.id AND a.purpose = 'SUSPENSE';
        v_meta := jsonb_build_object('origin_key', p_origin_key,
                    'origin_occurred_at', to_char(v_occ AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                    'origin_mode', v_mode, 'edge_gateway_id', p_gateway, 'edge_seq', p_edge_seq,
                    'device_serial', v_serial, 'edge_amount', v_orig_amount);
        IF p_op ->> 'vendor_session_id' IS NOT NULL THEN
          v_meta := v_meta || jsonb_build_object('vendor_session_id', p_op ->> 'vendor_session_id');
        END IF;
        v_tx := post_transaction(lg.id, 'REVERSAL', p_origin_key, v_occ, 'EDGE_SYNC', v_lines, g.event_id, orig.id, NULL,
                                 NULL, NULL, dev.id, orig.media_id, v_meta);
        -- La part restée en S-ATTENTE est annulée : l'anomalie de la vente est réduite (jamais écrite à la main).
        IF v_orig_suspense > 0 THEN
          SELECT an.amount INTO v_open_short FROM anomaly an
           WHERE an.kind = 'OFFLINE_SHORTFALL' AND an.transaction_id = orig.id AND an.status = 'OPEN'
           ORDER BY an.created_at LIMIT 1;
          IF v_open_short IS NOT NULL AND least(v_orig_suspense, v_open_short) > 0 THEN
            PERFORM reduce_offline_shortfall(orig.id, least(v_orig_suspense, v_open_short), v_tx);
          END IF;
        END IF;
        IF v_strict THEN
          INSERT INTO media_tap (operator_id, media_id, counter, nfc_uid, occurred_at, device_id, mode, transaction_id)
          VALUES (g.operator_id, med.id, v_counter, v_uid, v_occ, dev.id, 'ONLINE', v_tx);
          UPDATE media SET last_counter = greatest(coalesce(last_counter, -1), v_counter) WHERE id = med.id;
        END IF;
        v_result := 'ACCEPTED'; v_res_reason := NULL; v_res_detail := NULL;
        v_res_charged := v_orig_wallet; v_res_short := v_orig_suspense;
      END IF;
      v_ok := true;
      EXIT;
    EXCEPTION
      WHEN SQLSTATE 'CL007' THEN v_retry := true;
      WHEN SQLSTATE 'CL005' THEN v_rr := 'PERIOD_CLOSED'; v_rd := 'PERIOD_CLOSED';
      WHEN SQLSTATE 'CL003' THEN v_rr := 'LEDGER_LOCKED'; v_rd := 'LEDGER_LOCKED';
    END;
    EXIT WHEN v_rr IS NOT NULL;
    IF v_attempt >= 2 THEN
      v_rr := 'INSUFFICIENT_FUNDS_RETRY'; v_rd := 'CL007'; EXIT;
    END IF;
  END LOOP;

  IF NOT v_ok THEN
    -- Écriture annulée en entier (sous-transaction) : une seconde écriture enregistre le numéro, avec anomalie.
    PERFORM edge_record_rejection(p_gateway, lg.id, p_edge_seq, p_origin_key, p_content, v_rr, v_rd, dev.id, med.id,
              v_tseq, v_amount, v_loss, true);
    RETURN QUERY SELECT 'REJECTED'::text, NULL::uuid, v_rr, v_rd, 0::bigint, 0::bigint;
    RETURN;
  END IF;

  -- La dernière écriture : le numéro (invariant 10 : aucune exception possible après lui).
  PERFORM edge_record_seq(p_gateway, p_edge_seq, p_origin_key, p_content, v_result, v_tx, v_res_reason);
  RETURN QUERY SELECT v_result, v_tx, v_res_reason, v_res_detail, v_res_charged, v_res_short;
END $fn$;
REVOKE ALL ON FUNCTION edge_post_transaction(uuid, bigint, bigint, text, bytea, jsonb, jsonb) FROM PUBLIC;

-- 4. edge_counter_op (0062) : plafond par recharge en espèces ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION edge_counter_op(p_type text, p_gateway uuid, p_epoch bigint, p_edge_seq bigint, p_origin_key text,
                                p_content bytea, p_op jsonb)
RETURNS TABLE (outcome text, transaction_id uuid, reason text, detail text, charged_to_wallet bigint,
               shortfall_amount bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
#variable_conflict use_column
DECLARE
  g edge_gateway%ROWTYPE; lg ledger%ROWTYPE; h debit_authority_handover%ROWTYPE; reg edge_sync_registry%ROWTYPE;
  ev event%ROWTYPE; dev device%ROWTYPE; med media%ROWTYPE; wal wallet%ROWTYPE; bat media_batch%ROWTYPE;
  orig journal_transaction%ROWTYPE; sess cash_session%ROWTYPE;
  v_type text; v_mode text; v_serial text; v_tseq bigint; v_occ timestamptz; v_occ_raw timestamptz; v_cur text; v_loss text := 'OPERATOR';
  v_guichet jsonb; v_tap jsonb; v_th bytea; v_media_id uuid; v_wallet_in uuid; v_cash_in uuid; v_amount bigint;
  v_cycle_start timestamptz; v_base_key text;
  v_want text; v_rr text; v_rd text; v_fail text; v_msg text; v_sess_found boolean := false;
  v_dup boolean := false; v_dup_tx uuid; v_wallet_exists boolean := false; v_wallet uuid;
  v_acc_paid uuid; v_acc_due uuid; v_acc_deposit uuid; v_acc_promo uuid; v_org_promo uuid; v_suspense uuid;
  v_head bigint; v_cap bigint; v_credit bigint := 0; v_over bigint := 0; v_lines jsonb; v_meta jsonb; v_tx uuid; v_wtx uuid; n int;
  v_result text := 'ACCEPTED'; v_charged bigint := 0; v_short bigint := 0;
BEGIN
  IF p_type IS NULL OR p_type NOT IN ('ACTIVATION', 'DEPOSIT_CASH', 'TOPUP_CASH') THEN
    RAISE EXCEPTION 'Enveloppe de guichet : type interne inconnu' USING ERRCODE = 'CL001';
  END IF;
  -- Garde de session : p_gateway doit être la passerelle de la session mTLS (42501).
  PERFORM edge_assert_session_gateway(p_gateway);
  SELECT * INTO g FROM edge_gateway WHERE id = p_gateway;
  IF NOT FOUND THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  PERFORM assert_tenant(g.operator_id);
  IF p_content IS NULL OR octet_length(p_content) <> 32 OR p_edge_seq IS NULL OR p_edge_seq < 1
     OR p_epoch IS NULL OR p_origin_key IS NULL OR length(p_origin_key) = 0
     OR p_op IS NULL OR jsonb_typeof(p_op) <> 'object' THEN
    RAISE EXCEPTION 'Enveloppe : paramètres incohérents (contenu de 32 octets, numéro, époque, clé, opération)'
      USING ERRCODE = 'CL001';
  END IF;

  -- (1) Verrou de l'événement, partagé : le premier de toutes les fonctions de passerelle (C-012).
  PERFORM pg_advisory_xact_lock_shared(hashtextextended('edge-event:' || g.event_id, 0));
  SELECT * INTO g FROM edge_gateway WHERE id = p_gateway;      -- relue sous le verrou
  IF g.status = 'REVOKED' THEN RAISE EXCEPTION 'Passerelle révoquée' USING ERRCODE = 'CL013'; END IF;
  IF g.role <> 'PRIMARY' THEN RAISE EXCEPTION 'Passerelle en attente (STANDBY)' USING ERRCODE = 'CL013'; END IF;
  SELECT l.* INTO lg FROM ledger l WHERE l.id = edge_ledger_of_gateway(p_gateway);
  IF NOT FOUND THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  -- (2) Verrou partagé d'autorité de débit (celui de post_transaction).
  PERFORM pg_advisory_xact_lock_shared(hashtextextended('debit-authority:' || lg.id, 0));
  SELECT * INTO lg FROM ledger WHERE id = lg.id;                -- relu sous le verrou

  -- (3) Handover de CETTE passerelle pour SON grand livre : TO_EDGE ACTIVE, ou vidange TO_CENTRAL.
  SELECT d.* INTO h FROM debit_authority_handover d
   WHERE d.edge_gateway_id = p_gateway AND d.ledger_id = lg.id AND d.operator_id = g.operator_id
     AND ((d.direction = 'TO_EDGE' AND d.status = 'ACTIVE')
          OR (d.direction = 'TO_CENTRAL' AND d.status IN ('RELEASE_REQUESTED', 'RELEASING')))
   ORDER BY (d.direction = 'TO_CENTRAL') DESC, d.requested_at DESC LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Aucun handover actif de cette passerelle pour son grand livre' USING ERRCODE = 'CL013';
  END IF;
  IF p_epoch <> h.epoch::bigint OR lg.authority_epoch <> h.epoch THEN
    RAISE EXCEPTION 'Époque % différente de l''époque du handover % (grand livre : %)', p_epoch, h.epoch,
      lg.authority_epoch USING ERRCODE = 'CL015';
  END IF;
  IF lg.debit_authority <> 'EDGE' THEN
    RAISE EXCEPTION 'Le grand livre n''est pas sous la passerelle' USING ERRCODE = 'CL013';
  END IF;
  -- Début du cycle EDGE : le TO_EDGE du cycle (borne des sessions de caisse servies, R-24).
  IF h.direction = 'TO_EDGE' THEN v_cycle_start := h.requested_at;
  ELSE SELECT d.requested_at INTO v_cycle_start FROM debit_authority_handover d WHERE d.id = h.edge_handover_id;
  END IF;
  v_cycle_start := coalesce(v_cycle_start, h.requested_at);

  -- Rejeu d'un numéro déjà au registre : aucun effet, résultat mémorisé (même contenu exigé, CL002 sinon).
  SELECT * INTO reg FROM edge_sync_registry r WHERE r.gateway_id = p_gateway AND r.edge_seq = p_edge_seq;
  IF FOUND THEN
    IF reg.content_sha256 <> p_content OR reg.origin_key <> p_origin_key THEN
      RAISE EXCEPTION 'edge_seq % déjà reçu avec un contenu différent', p_edge_seq USING ERRCODE = 'CL002';
    END IF;
    RETURN QUERY SELECT reg.outcome, reg.transaction_id, reg.reason, NULL::text,
      coalesce((SELECT -sum(po.amount) FROM posting po JOIN account a ON a.id = po.account_id
                 JOIN journal_transaction t ON t.id = po.transaction_id
                 WHERE po.transaction_id = reg.transaction_id AND t.type = 'TOPUP_CASH'
                   AND a.purpose IN ('WALLET_PAID', 'WALLET_PROMO')), 0)::bigint,
      coalesce((SELECT -sum(po.amount) FROM posting po JOIN account a ON a.id = po.account_id
                 WHERE po.transaction_id = reg.transaction_id AND a.purpose = 'CUSTOMER_CASH_DUE'), 0)::bigint;
    RETURN;
  END IF;
  IF p_edge_seq <> g.contiguous_edge_seq + 1 THEN
    RAISE EXCEPTION 'edge_seq % reçu, % attendu', p_edge_seq, g.contiguous_edge_seq + 1 USING ERRCODE = 'CL016';
  END IF;

  -- Champs d'enveloppe (bien formés, sinon rejet enregistré) ---------------------------------------------------------
  v_type := p_op ->> 'type';
  v_mode := p_op ->> 'authorized_mode';
  v_serial := p_op ->> 'device_serial';
  v_tseq := CASE WHEN p_op ->> 'seq' ~ '^[0-9]{1,15}$' THEN (p_op ->> 'seq')::bigint END;
  v_cur := p_op ->> 'currency';
  v_guichet := p_op -> 'edge_guichet';
  v_tap := p_op -> 'tap';
  v_base_key := v_serial || ':' || v_tseq;

  <<check_block>>
  BEGIN
    IF v_type IS DISTINCT FROM p_type THEN
      v_rr := 'MALFORMED_OPERATION'; v_rd := 'WRONG_ENVELOPE'; EXIT check_block;
    END IF;
    IF v_tseq IS NULL OR v_serial IS NULL OR length(v_serial) = 0
       OR NOT (p_origin_key = v_base_key OR (p_type = 'DEPOSIT_CASH' AND p_origin_key = v_base_key || '#deposit'))
       OR p_op ->> 'edge_seq' IS DISTINCT FROM p_edge_seq::text
       OR v_mode IS DISTINCT FROM 'EDGE_ONLINE' THEN
      v_rr := 'MALFORMED_OPERATION'; v_rd := 'ORIGIN_FIELDS'; EXIT check_block;
    END IF;
    BEGIN
      v_occ := (p_op ->> 'occurred_at')::timestamptz;
    EXCEPTION WHEN others THEN v_occ := NULL;
    END;
    IF v_occ IS NULL OR (p_op ->> 'occurred_at') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T' THEN
      v_rr := 'MALFORMED_OPERATION'; v_rd := 'ORIGIN_OCCURRED_AT'; EXIT check_block;
    END IF;
    -- Date bornée comme 0061 (v_eff) : [début du cycle - 15 min ; maintenant + 15 min]. La date brute reste en métadonnée ;
    -- la marge de recharge et l'écriture au journal utilisent la date bornée (plafond mensuel non contournable).
    v_occ_raw := v_occ;
    v_occ := least(greatest(v_occ, v_cycle_start - interval '15 minutes'), clock_timestamp() + interval '15 minutes');

    -- Terminal d'origine (lu en base, de l'événement de la passerelle).
    SELECT d.* INTO dev FROM device d
     WHERE d.serial = v_serial AND d.operator_id = g.operator_id AND d.event_id = g.event_id
     ORDER BY (d.status <> 'REVOKED') DESC, d.id LIMIT 1;
    IF NOT FOUND THEN v_rr := 'MALFORMED_OPERATION'; v_rd := 'UNKNOWN_TERMINAL'; EXIT check_block; END IF;
    v_loss := CASE dev.provided_by WHEN 'MERCHANT' THEN 'MERCHANT' WHEN 'ORGANIZER' THEN 'ORGANIZER' ELSE 'OPERATOR' END;

    -- Montant encaissé : porté tel que déclaré, seulement pour l'anomalie et l'écriture ; borné par ce qui suit.
    IF p_type = 'TOPUP_CASH' THEN
      IF jsonb_typeof(p_op -> 'amount') IS DISTINCT FROM 'number' OR (p_op ->> 'amount') !~ '^[0-9]{1,15}$'
         OR (p_op ->> 'amount')::bigint <= 0 THEN
        v_rr := 'MALFORMED_OPERATION'; v_rd := 'AMOUNT'; EXIT check_block;
      END IF;
      v_amount := (p_op ->> 'amount')::bigint;
    ELSIF p_type = 'DEPOSIT_CASH' THEN
      IF jsonb_typeof(v_guichet -> 'deposit_amount') IS DISTINCT FROM 'number'
         OR (v_guichet ->> 'deposit_amount') !~ '^[0-9]{1,15}$' OR (v_guichet ->> 'deposit_amount')::bigint <= 0 THEN
        v_rr := 'MALFORMED_OPERATION'; v_rd := 'GUICHET_DEPOSIT_AMOUNT'; EXIT check_block;
      END IF;
      v_amount := (v_guichet ->> 'deposit_amount')::bigint;
    END IF;

    IF v_cur IS NULL OR v_cur <> lg.currency THEN
      v_rr := 'CURRENCY_MISMATCH'; v_rd := 'LEDGER_CURRENCY'; EXIT check_block;
    END IF;

    -- edge_guichet : obligatoire pour ACTIVATION et DEPOSIT_CASH ; pour TOPUP_CASH, facultatif si tap.token_hash.
    IF v_guichet IS NOT NULL AND jsonb_typeof(v_guichet) <> 'object' THEN
      v_rr := 'MALFORMED_OPERATION'; v_rd := 'GUICHET_INVALID'; EXIT check_block;
    END IF;
    IF p_type <> 'TOPUP_CASH' AND v_guichet IS NULL THEN
      v_rr := 'MALFORMED_OPERATION'; v_rd := 'GUICHET_MISSING'; EXIT check_block;
    END IF;
    IF v_guichet ? 'media_id' THEN
      IF (v_guichet ->> 'media_id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        v_rr := 'MALFORMED_OPERATION'; v_rd := 'GUICHET_MEDIA'; EXIT check_block;
      END IF;
      v_media_id := (v_guichet ->> 'media_id')::uuid;
    END IF;
    IF v_tap IS NOT NULL AND jsonb_typeof(v_tap) = 'object' AND v_tap ? 'token_hash' THEN
      IF (v_tap ->> 'token_hash') !~ '^[0-9a-f]{64}$' THEN
        v_rr := 'MALFORMED_OPERATION'; v_rd := 'TAP_MISSING'; EXIT check_block;
      END IF;
      v_th := decode(v_tap ->> 'token_hash', 'hex');
    END IF;
    IF v_media_id IS NULL AND (p_type <> 'TOPUP_CASH' OR v_th IS NULL) THEN
      v_rr := 'MALFORMED_OPERATION'; v_rd := 'GUICHET_MEDIA'; EXIT check_block;
    END IF;
    IF v_guichet ? 'event_id' AND (v_guichet ->> 'event_id') IS DISTINCT FROM g.event_id::text THEN
      v_rr := 'MALFORMED_OPERATION'; v_rd := 'GUICHET_EVENT'; EXIT check_block;
    END IF;
    IF v_guichet ? 'channel' AND (v_guichet ->> 'channel') IS DISTINCT FROM 'DESK' THEN
      v_rr := 'MALFORMED_OPERATION'; v_rd := 'GUICHET_CHANNEL'; EXIT check_block;
    END IF;
    IF v_guichet ? 'wallet_id' THEN
      IF p_type <> 'ACTIVATION'
         OR (v_guichet ->> 'wallet_id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        v_rr := 'MALFORMED_OPERATION'; v_rd := 'GUICHET_WALLET'; EXIT check_block;
      END IF;
      v_wallet_in := (v_guichet ->> 'wallet_id')::uuid;
    END IF;
    IF v_guichet ? 'cash_desk_account_id' THEN
      IF p_type = 'ACTIVATION'
         OR (v_guichet ->> 'cash_desk_account_id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        v_rr := 'MALFORMED_OPERATION'; v_rd := 'GUICHET_CASH_ACCOUNT'; EXIT check_block;
      END IF;
      v_cash_in := (v_guichet ->> 'cash_desk_account_id')::uuid;
    END IF;

    -- Activation (A24) : un wallet_id existant n'est admis que pour la réactivation du MEME bracelet de ce portefeuille.
    IF p_type = 'ACTIVATION' AND v_wallet_in IS NOT NULL THEN
      SELECT * INTO wal FROM wallet w WHERE w.id = v_wallet_in;
      IF FOUND THEN
        v_wallet_exists := true;
        IF wal.operator_id <> g.operator_id OR wal.ledger_id <> lg.id OR wal.status <> 'ACTIVE'
           OR NOT EXISTS (SELECT 1 FROM media_assignment ma
                           WHERE ma.media_id = v_media_id AND ma.wallet_id = v_wallet_in
                             AND ma.operator_id = g.operator_id) THEN
          v_rr := 'MALFORMED_OPERATION'; v_rd := 'WALLET_ID_EXISTS'; EXIT check_block;
        END IF;
      END IF;
    END IF;
  END;

  IF v_rr IS NOT NULL THEN
    PERFORM edge_record_rejection(p_gateway, lg.id, p_edge_seq, p_origin_key, p_content, v_rr, v_rd, dev.id, NULL,
              v_tseq, v_amount, v_loss, true);
    RETURN QUERY SELECT 'REJECTED'::text, NULL::uuid, v_rr, v_rd, 0::bigint, 0::bigint;
    RETURN;
  END IF;

  -- Doublons ----------------------------------------------------------------------------------------------------------
  -- (a) clé d'origine déjà au journal du grand livre (une écriture du même rejeu, ou de la route en ligne).
  SELECT t.* INTO orig FROM journal_transaction t WHERE t.ledger_id = lg.id AND t.idempotency_key = p_origin_key;
  IF FOUND THEN
    v_want := CASE p_type WHEN 'TOPUP_CASH' THEN 'TOPUP_CASH' WHEN 'DEPOSIT_CASH' THEN 'DEPOSIT_TAKEN'
                          ELSE 'PROMO_CREDIT' END;
    IF orig.type = v_want THEN
      v_dup := true; v_dup_tx := orig.id;
    ELSE
      PERFORM edge_record_rejection(p_gateway, lg.id, p_edge_seq, p_origin_key, p_content, 'IDEMPOTENCY_KEY_REUSED',
                'ORIGIN_KEY_OTHER_OPERATION', dev.id, NULL, v_tseq, v_amount, v_loss, true);
      RETURN QUERY SELECT 'REJECTED'::text, NULL::uuid, 'IDEMPOTENCY_KEY_REUSED'::text,
                          'ORIGIN_KEY_OTHER_OPERATION'::text, 0::bigint, 0::bigint;
      RETURN;
    END IF;
  END IF;
  IF NOT v_dup AND p_type IN ('ACTIVATION', 'DEPOSIT_CASH') THEN
    -- (b) la même clé déjà rejouée avec effet par une AUTRE passerelle du prestataire (reprise forcée).
    SELECT r.transaction_id INTO v_dup_tx FROM edge_sync_registry r
     WHERE r.operator_id = g.operator_id AND r.origin_key = p_origin_key AND r.gateway_id <> p_gateway
       AND r.outcome IN ('ACCEPTED', 'ACCEPTED_WITH_SHORTFALL', 'DUPLICATE')
     ORDER BY r.recorded_at LIMIT 1;
    v_dup := FOUND;
    -- (c) la même requête déjà exécutée par la route en ligne (registre d'idempotence, terminée en 2xx).
    IF NOT v_dup THEN
      v_dup := EXISTS (SELECT 1 FROM api_idempotency a
                        WHERE a.operator_id = g.operator_id AND a.idempotency_key IN (p_origin_key, v_base_key)
                          AND a.scope = 'device:' || dev.id || ':'
                          AND a.status = 'COMPLETED' AND a.response_status BETWEEN 200 AND 299);
    END IF;
    IF v_dup AND v_dup_tx IS NULL THEN
      SELECT t.id INTO v_dup_tx FROM journal_transaction t
       WHERE t.ledger_id = lg.id AND v_media_id IS NOT NULL
         AND t.idempotency_key = (CASE p_type WHEN 'ACTIVATION' THEN 'preload:' ELSE 'deposit:' END)
                                 || v_media_id || ':'
                                 || (SELECT count(*) FROM media_assignment ma WHERE ma.media_id = v_media_id)
       ORDER BY t.recorded_at DESC, t.id LIMIT 1;
    END IF;
  END IF;
  IF v_dup THEN
    IF v_dup_tx IS NOT NULL THEN
      PERFORM edge_record_seq(p_gateway, p_edge_seq, p_origin_key, p_content, 'DUPLICATE', v_dup_tx, NULL);
      RETURN QUERY SELECT 'DUPLICATE'::text, v_dup_tx, NULL::text, NULL::text,
        coalesce((SELECT -sum(po.amount) FROM posting po JOIN account a ON a.id = po.account_id
                   JOIN journal_transaction t ON t.id = po.transaction_id
                   WHERE po.transaction_id = v_dup_tx AND t.type = 'TOPUP_CASH'
                     AND a.purpose IN ('WALLET_PAID', 'WALLET_PROMO')), 0)::bigint,
        coalesce((SELECT -sum(po.amount) FROM posting po JOIN account a ON a.id = po.account_id
                   WHERE po.transaction_id = v_dup_tx AND a.purpose = 'CUSTOMER_CASH_DUE'), 0)::bigint;
    ELSE
      -- Le registre n'admet DUPLICATE qu'avec une écriture : numéro consommé sans effet, raison explicite.
      PERFORM edge_record_seq(p_gateway, p_edge_seq, p_origin_key, p_content, 'VOID', NULL, 'DUPLICATE_ORIGIN_KEY');
      RETURN QUERY SELECT 'VOID'::text, NULL::uuid, 'DUPLICATE_ORIGIN_KEY'::text, NULL::text, 0::bigint, 0::bigint;
    END IF;
    RETURN;
  END IF;

  -- État du central : bornes à la passerelle, au prestataire, à l'événement et au cycle courant ------------------------
  SELECT * INTO ev FROM event e WHERE e.id = g.event_id AND e.operator_id = g.operator_id;
  SELECT a.id INTO v_suspense FROM account a WHERE a.ledger_id = lg.id AND a.purpose = 'SUSPENSE' AND a.is_active;

  IF p_type IN ('DEPOSIT_CASH', 'TOPUP_CASH') THEN
    -- Session de caisse OPEN de CE terminal, de CE grand livre, de cet événement, ouverte avant le cycle EDGE.
    SELECT cs.* INTO sess FROM cash_session cs
     WHERE cs.device_id = dev.id AND cs.operator_id = g.operator_id AND cs.ledger_id = lg.id
       AND cs.event_id = g.event_id AND cs.status = 'OPEN' AND cs.opened_at <= v_cycle_start;
    v_sess_found := FOUND;
    IF NOT v_sess_found THEN
      v_fail := 'CASH_SESSION_NOT_OPEN';
    ELSIF v_cash_in IS NOT NULL AND v_cash_in <> sess.cash_account_id THEN
      v_rr := 'MALFORMED_OPERATION'; v_rd := 'CASH_ACCOUNT_MISMATCH';
    END IF;
  END IF;

  IF v_rr IS NULL THEN
    -- Bracelet (ligne verrouillée) : désigné par l'identifiant, ou par token_hash pour une recharge.
    SELECT m.* INTO med FROM media m
     WHERE m.operator_id = g.operator_id AND (v_media_id IS NULL OR m.id = v_media_id)
       AND (v_th IS NULL OR m.token_hash = v_th)
     ORDER BY m.id LIMIT 1 FOR UPDATE;
    IF NOT FOUND THEN
      v_fail := coalesce(v_fail, 'MEDIA_UNKNOWN');
    ELSIF p_type = 'ACTIVATION' THEN
      SELECT * INTO bat FROM media_batch b WHERE b.id = med.batch_id AND b.operator_id = g.operator_id;
      IF NOT FOUND OR bat.organizer_id <> ev.organizer_id
         OR (bat.event_id IS NOT NULL AND bat.event_id <> g.event_id) THEN v_fail := 'MEDIA_WRONG_EVENT';
      ELSIF bat.status <> 'ACTIVE' THEN v_fail := 'MEDIA_BATCH_INACTIVE';
      ELSIF med.status = 'ACTIVE' OR med.wallet_id IS NOT NULL THEN v_fail := 'MEDIA_ALREADY_ACTIVE';
      END IF;
    ELSE
      IF med.wallet_id IS NULL OR med.status <> 'ACTIVE' THEN v_fail := coalesce(v_fail, 'MEDIA_NOT_ACTIVE');
      ELSE
        SELECT * INTO wal FROM wallet w WHERE w.id = med.wallet_id;
        IF wal.ledger_id <> lg.id OR wal.operator_id <> g.operator_id THEN v_fail := coalesce(v_fail, 'MEDIA_WRONG_EVENT');
        ELSIF p_type = 'TOPUP_CASH' AND wal.status <> 'ACTIVE' THEN v_fail := coalesce(v_fail, 'WALLET_NOT_ACTIVE');
        END IF;
      END IF;
      IF v_fail IS NULL AND p_type = 'DEPOSIT_CASH' THEN
        SELECT * INTO bat FROM media_batch b WHERE b.id = med.batch_id AND b.operator_id = g.operator_id;
        IF NOT FOUND OR bat.deposit_amount = 0 THEN v_fail := 'NO_DEPOSIT_DUE';
        ELSIF bat.deposit_mode = 'FROM_BALANCE' THEN
          v_rr := 'MALFORMED_OPERATION'; v_rd := 'DEPOSIT_FROM_BALANCE_REFUSED';
        ELSIF bat.deposit_amount <> v_amount THEN v_fail := 'DEPOSIT_AMOUNT_MISMATCH';
        ELSIF med.deposit_status = 'HELD' THEN v_fail := 'DEPOSIT_ALREADY_HELD';
        ELSE
          SELECT a.id INTO v_acc_deposit FROM account a
           WHERE a.ledger_id = lg.id AND a.purpose = 'ORG_DEPOSIT' AND a.owner_party_id = bat.organizer_id;
          IF v_acc_deposit IS NULL THEN v_fail := 'DEPOSIT_ACCOUNT_MISSING'; END IF;
        END IF;
      ELSIF v_fail IS NULL AND p_type = 'TOPUP_CASH' THEN
        SELECT a.id INTO v_acc_paid FROM account a
         WHERE a.ledger_id = lg.id AND a.purpose = 'WALLET_PAID' AND a.wallet_id = wal.id AND a.is_active;
        SELECT a.id INTO v_acc_due FROM account a
         WHERE a.ledger_id = lg.id AND a.purpose = 'CUSTOMER_CASH_DUE' AND a.is_active;
        IF v_acc_paid IS NULL OR v_acc_due IS NULL THEN v_fail := 'ACCOUNT_MISSING'; END IF;
      END IF;
    END IF;
  END IF;

  IF v_rr IS NOT NULL THEN
    PERFORM edge_record_rejection(p_gateway, lg.id, p_edge_seq, p_origin_key, p_content, v_rr, v_rd, dev.id,
              med.id, v_tseq, v_amount, v_loss, true);
    RETURN QUERY SELECT 'REJECTED'::text, NULL::uuid, v_rr, v_rd, 0::bigint, 0::bigint;
    RETURN;
  END IF;

  -- Écriture : sous-transaction, annulée en entier au moindre échec ------------------------------------------------------
  IF v_fail IS NULL THEN
    v_meta := jsonb_build_object('origin_key', p_origin_key,
                'origin_occurred_at', to_char(v_occ_raw AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                'origin_mode', v_mode, 'edge_gateway_id', p_gateway, 'edge_seq', p_edge_seq,
                'device_serial', v_serial);
    BEGIN
      IF p_type = 'ACTIVATION' THEN
        IF NOT ('DESK' = ANY (ev.activation_modes)) THEN
          RAISE EXCEPTION 'Mode d''activation DESK non autorisé pour l''événement' USING ERRCODE = 'CL020';
        END IF;
        v_wallet := coalesce(v_wallet_in, gen_random_uuid());
        IF NOT v_wallet_exists THEN
          INSERT INTO wallet (id, operator_id, ledger_id) VALUES (v_wallet, g.operator_id, lg.id);
          INSERT INTO account (operator_id, ledger_id, code, family, purpose, wallet_id, normal_side, allow_negative, hot)
          VALUES (g.operator_id, lg.id, 'L-WAL-' || v_wallet || '-P', 'CLAIM', 'WALLET_PAID', v_wallet, 'C', false, false),
                 (g.operator_id, lg.id, 'L-WAL-' || v_wallet || '-X', 'CLAIM', 'WALLET_PROMO', v_wallet, 'C', false, false);
        END IF;
        IF med.status = 'PERSONALIZED' THEN UPDATE media SET status = 'ISSUED' WHERE id = med.id; END IF;
        UPDATE media SET wallet_id = v_wallet, status = 'ACTIVE' WHERE id = med.id;
        INSERT INTO media_assignment (operator_id, media_id, wallet_id, currency, token_hash)
        VALUES (g.operator_id, med.id, v_wallet, wallet_currency(v_wallet), med.token_hash);
        -- Préchargement (comme preload_media, mais source EDGE_SYNC, date d'origine et métadonnées d'origine).
        IF bat.preload_promo_amount > 0 THEN
          SELECT a.id INTO v_acc_promo FROM account a WHERE a.wallet_id = v_wallet AND a.purpose = 'WALLET_PROMO';
          SELECT a.id INTO v_org_promo FROM account a
           WHERE a.ledger_id = lg.id AND a.purpose = 'ORG_PROMO' AND a.owner_party_id = bat.organizer_id;
          IF v_acc_promo IS NULL OR v_org_promo IS NULL THEN
            RAISE EXCEPTION 'Compte WALLET_PROMO ou ORG_PROMO introuvable' USING ERRCODE = 'CL001';
          END IF;
          SELECT count(*) INTO n FROM media_assignment ma WHERE ma.media_id = med.id;
          v_tx := post_transaction(lg.id, 'PROMO_CREDIT', 'preload:' || med.id || ':' || n, v_occ, 'EDGE_SYNC',
                    jsonb_build_array(
                      jsonb_build_object('account_id', v_acc_promo, 'amount', -bat.preload_promo_amount,
                                         'memo', 'Préchargement du lot'),
                      jsonb_build_object('account_id', v_org_promo, 'amount', bat.preload_promo_amount,
                                         'memo', 'Financement du préchargement')),
                    g.event_id, NULL, NULL, NULL, NULL, dev.id, med.id, v_meta);
        END IF;

      ELSIF p_type = 'DEPOSIT_CASH' THEN
        v_tx := post_transaction(lg.id, 'DEPOSIT_TAKEN', p_origin_key, v_occ, 'EDGE_SYNC',
                  jsonb_build_array(
                    jsonb_build_object('account_id', sess.cash_account_id, 'amount', v_amount, 'memo', 'Caution bracelet'),
                    jsonb_build_object('account_id', v_acc_deposit, 'amount', -v_amount, 'memo', 'Caution bracelet')),
                  g.event_id, NULL, NULL, NULL, NULL, dev.id, med.id, v_meta || jsonb_build_object('edge_amount', v_amount));
        UPDATE media SET deposit_status = 'HELD', deposit_held = v_amount WHERE id = med.id;
        PERFORM cash_session_attach_own(sess, p_origin_key);

      ELSE
        -- Recharge espèces : la marge verrouille le solde payé, puis l'écriture en deux parts au plus.
        v_head := wallet_topup_headroom(wal.id, v_occ);          -- NULL : aucun plafond
        v_credit := CASE WHEN v_head IS NULL THEN v_amount ELSE least(v_amount, greatest(v_head, 0)) END;
        -- Décision 21 : plafond par recharge en espèces (réglage replay_max_per_cash_topup, 500 000 XOF par défaut).
        -- Jamais REJECTED : la part au-delà va en espèces dues, comme une recharge hors marge (anomalie
        -- CASH_TOPUP_OVER_LIMIT, résolue à deux). Réglage absent pour la devise : échec fermé, tout est dû.
        v_cap := edge_setting_value('replay_max_per_cash_topup', lg.currency);
        v_credit := least(v_credit, coalesce(v_cap, 0));
        v_over := v_amount - v_credit;
        v_lines := jsonb_build_array(jsonb_build_object('account_id', sess.cash_account_id, 'amount', v_amount));
        IF v_credit > 0 THEN
          v_lines := v_lines || jsonb_build_object('account_id', v_acc_paid, 'amount', -v_credit);
        END IF;
        IF v_over > 0 THEN
          v_lines := v_lines || jsonb_build_object('account_id', v_acc_due, 'amount', -v_over,
                                                   'memo', 'Espèces dues au détenteur (plafond)');
        END IF;
        v_tx := post_transaction(lg.id, 'TOPUP_CASH', p_origin_key, v_occ, 'EDGE_SYNC', v_lines, g.event_id, NULL, NULL,
                  NULL, NULL, dev.id, med.id,
                  v_meta || jsonb_build_object('edge_amount', v_amount, 'edge_credited', v_credit, 'edge_cash_due', v_over));
        PERFORM cash_session_attach_own(sess, p_origin_key);
        IF v_over > 0 THEN
          PERFORM open_cash_due_anomaly(lg.id, med.id, v_over, v_tx);
        END IF;
        v_charged := v_credit; v_short := v_over;
      END IF;
    EXCEPTION
      WHEN SQLSTATE 'CL001' OR SQLSTATE 'CL002' OR SQLSTATE 'CL003' OR SQLSTATE 'CL004' OR SQLSTATE 'CL005'
        OR SQLSTATE 'CL007' OR SQLSTATE 'CL008' OR SQLSTATE 'CL009' OR SQLSTATE 'CL020' OR SQLSTATE 'CL029'
        OR unique_violation OR check_violation OR foreign_key_violation OR not_null_violation THEN
        GET STACKED DIAGNOSTICS v_fail = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
        v_tx := NULL; v_charged := 0; v_short := 0;
    END;
  END IF;

  -- Rejeu impossible : REJECTED / EDGE_REPLAY_FAILED, anomalie avec le montant, jamais de perte silencieuse -----------
  IF v_fail IS NOT NULL THEN
    v_wtx := NULL;
    -- Caution : écriture d'attente SEULEMENT si la session d'origine est encore OPEN (sinon la garde ADR-132 la refuse).
    IF p_type = 'DEPOSIT_CASH' AND v_sess_found AND v_suspense IS NOT NULL THEN
      BEGIN
        v_wtx := post_transaction(lg.id, 'DEPOSIT_TAKEN', p_origin_key, v_occ, 'EDGE_SYNC',
                   jsonb_build_array(
                     jsonb_build_object('account_id', sess.cash_account_id, 'amount', v_amount,
                                        'memo', 'Caution : rejeu impossible, en attente'),
                     jsonb_build_object('account_id', v_suspense, 'amount', -v_amount,
                                        'memo', 'Caution : rejeu impossible, en attente')),
                   g.event_id, NULL, NULL, NULL, NULL, dev.id, med.id,
                   jsonb_build_object('origin_key', p_origin_key,
                     'origin_occurred_at', to_char(v_occ_raw AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                     'origin_mode', v_mode, 'edge_gateway_id', p_gateway, 'edge_seq', p_edge_seq,
                     'device_serial', v_serial, 'edge_amount', v_amount, 'replay_failed', true,
                     'replay_failed_code', v_fail));
        PERFORM cash_session_attach_own(sess, p_origin_key);
      EXCEPTION
        WHEN SQLSTATE 'CL001' OR SQLSTATE 'CL002' OR SQLSTATE 'CL003' OR SQLSTATE 'CL004' OR SQLSTATE 'CL005'
          OR SQLSTATE 'CL007' OR SQLSTATE 'CL020' OR SQLSTATE 'CL029'
          OR unique_violation OR check_violation OR foreign_key_violation OR not_null_violation THEN
          v_wtx := NULL;
      END;
    END IF;
    PERFORM edge_open_replay_failed(lg.id, p_gateway, p_edge_seq, p_origin_key, dev.id, med.id, v_tseq, v_wtx,
              coalesce(v_amount, 0), v_loss, v_fail, v_msg);
    PERFORM edge_record_seq(p_gateway, p_edge_seq, p_origin_key, p_content, 'REJECTED', NULL, 'EDGE_REPLAY_FAILED');
    RETURN QUERY SELECT 'REJECTED'::text, NULL::uuid, 'EDGE_REPLAY_FAILED'::text, v_fail, 0::bigint, 0::bigint;
    RETURN;
  END IF;

  -- La dernière écriture : le numéro (invariant 10 : aucune exception possible après lui).
  PERFORM edge_record_seq(p_gateway, p_edge_seq, p_origin_key, p_content, v_result, v_tx, NULL);
  RETURN QUERY SELECT v_result, v_tx, NULL::text, NULL::text, v_charged, v_short;
END $fn$;
REVOKE ALL ON FUNCTION edge_counter_op(text, uuid, bigint, bigint, text, bytea, jsonb) FROM PUBLIC;

-- 5. Décision 23 : exposition des jetons d'appareil d'un événement ----------------------------------------------------
-- Ne touche QUE edge_exposed, et seulement sur la ligne courante des familles actives (ni consommée, ni révoquée, ni
-- expirée) des terminaux de l'événement, du prestataire de la session. Le déclencheur différé de 0063 émet la ligne DEVICE
-- du journal. Retour : nombre de lignes posées (0 si déjà exposées ou si aucune famille active : idempotent).
CREATE FUNCTION edge_expose_device_token_families(p_event_id uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_op uuid; n integer;
BEGIN
  SELECT e.operator_id INTO v_op FROM event e WHERE e.id = p_event_id;
  PERFORM assert_tenant(v_op);
  UPDATE device_refresh_token r SET edge_exposed = true
   WHERE r.operator_id = v_op AND NOT r.edge_exposed
     AND r.consumed_at IS NULL AND r.revoked_at IS NULL AND r.expires_at > clock_timestamp()
     AND r.device_id IN (SELECT d.id FROM device d WHERE d.event_id = p_event_id AND d.operator_id = v_op);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION edge_expose_device_token_families(uuid) FROM PUBLIC;
