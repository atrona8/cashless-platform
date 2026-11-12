-- Migration 0065 : corrections de lot (mission passerelle-locale, lot WP12, cycle 2 ; décisions du porteur du
-- 09/11/2026 n° 36 (avec son complément, ADR-172) et n° 37 (ADR-173) ; contracts/interfaces.md § 12 et § 13 font foi).
--
--   1. Décision 37 : `edge_log_release_stuck(p_handover)`, SECURITY DEFINER, écrit l'entrée d'audit EDGE_RELEASE_STUCK
--      (et la notification edge_alert) pour un rendu RÉELLEMENT bloqué : TO_CENTRAL, RELEASING depuis plus de
--      10 minutes (seuil posé ICI, jamais reçu de l'appelant). Un handover inconnu ou non bloqué est refusé (CL013,
--      même message). Idempotente : une seule ligne par rendu bloqué (même begun_releasing_at). EXECUTE à
--      cashless_maint seul (post-roles.sql §9f) : renforcement (l'alerte n'existait qu'au journal applicatif).
--   2. Décision 36 et complément : `edge_replication_terms(p_gateway)` (aide interne, JAMAIS accordée) rend le bloc
--      `edge_terms` de la page de réplication : plafond par recharge en espèces (`replay_max_per_cash_topup`, décision 21,
--      500 000 XOF par défaut), frais d'activation par support (règle EVENT / ORG_FFEST / PER_MEDIA en vigueur ; clé
--      omise si plusieurs règles : échec fermé côté passerelle), conditions de caution de chaque lot de l'événement.
--      `edge_replication_page` est redéfinie à l'IDENTIQUE de 0063 (CREATE OR REPLACE, mêmes droits conservés) avec UN
--      seul ajout : sur la dernière page (has_more = false), `edge_terms`. Aucun GRANT nouveau.
-- Aucun GRANT ici (post-roles.sql). A faire relire par une personne : edge_replication_page (frontière de cloisonnement,
-- redéfinie) et edge_log_release_stuck (écriture d'audit par un rôle de maintenance).

SET CONSTRAINTS ALL IMMEDIATE;

-- 1. Décision 37 ------------------------------------------------------------------------------------------------------
CREATE FUNCTION edge_log_release_stuck(p_handover uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE h debit_authority_handover%ROWTYPE;
BEGIN
  SELECT d.* INTO h FROM debit_authority_handover d
   WHERE d.id = p_handover AND d.direction = 'TO_CENTRAL' AND d.status = 'RELEASING'
     AND d.begun_releasing_at IS NOT NULL AND d.begun_releasing_at < now() - interval '10 minutes';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Handover inconnu ou non bloqué' USING ERRCODE = 'CL013';
  END IF;
  IF EXISTS (SELECT 1 FROM audit_log a WHERE a.operator_id = h.operator_id AND a.action = 'EDGE_RELEASE_STUCK'
                AND a.object_id = h.id::text AND a.after ->> 'begun_releasing_at' = h.begun_releasing_at::text) THEN
    RETURN false;
  END IF;
  INSERT INTO audit_log (operator_id, actor_id, actor_role, action, object_type, object_id, after, origin)
  VALUES (h.operator_id, NULL, session_user::text, 'EDGE_RELEASE_STUCK', 'EDGE_HANDOVER', h.id::text,
          jsonb_build_object('gateway_id', h.edge_gateway_id, 'ledger_id', h.ledger_id,
                             'begun_releasing_at', h.begun_releasing_at::text, 'alert', 'EDGE_RELEASE_STUCK'),
          'maintenance');
  PERFORM pg_notify('edge_alert', jsonb_build_object('alert', 'EDGE_RELEASE_STUCK', 'operator_id', h.operator_id,
                    'gateway_id', h.edge_gateway_id, 'handover_id', h.id)::text);
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION edge_log_release_stuck(uuid) FROM PUBLIC;

-- 2. Décision 36 ------------------------------------------------------------------------------------------------------
CREATE FUNCTION edge_replication_terms(p_gateway uuid) RETURNS jsonb
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
  v_result := v_result || jsonb_build_object('deposit_batches',
    (SELECT coalesce(jsonb_agg(jsonb_build_object('batch_id', b.id, 'deposit_amount', b.deposit_amount,
                                                   'deposit_mode', b.deposit_mode) ORDER BY b.id), '[]'::jsonb)
       FROM media_batch b WHERE b.event_id = g.event_id AND b.operator_id = g.operator_id));
  RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION edge_replication_terms(uuid) FROM PUBLIC;

-- 3. edge_replication_page : définition de 0063 + le bloc edge_terms -------------------------------------------------
CREATE OR REPLACE FUNCTION edge_replication_page(p_gateway uuid, p_after_posting bigint, p_after_change bigint, p_limit int)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  g edge_gateway%ROWTYPE; lg ledger%ROWTYPE; ev event%ROWTYPE; k edge_pwd_pack_key%ROWTYPE;
  v_iso text := current_setting('transaction_isolation');
  v_servable boolean; v_keysha bytea; v_delay bigint;
  v_key bigint; v_prev bigint; v_max bigint; v_horizon bigint; v_locked boolean := false; v_stale boolean;
  v_lt text; v_horizon_safe boolean := false;
  v_lim int; v_pids bigint[]; v_more boolean; v_to bigint; v_wallets uuid[]; v_month timestamptz; v_today date;
  v_seqs bigint[]; v_kinds text[]; v_eids uuid[]; v_rmore boolean := false; v_rto bigint;
  v_media_ids uuid[]; v_ref_wallets uuid[]; v_cap bigint;
  v_wallets_json jsonb; v_media_json jsonb; v_ref jsonb; v_result jsonb; v_acked jsonb; v_exp smallint;
BEGIN
  IF v_iso NOT IN ('repeatable read', 'serializable') THEN
    RAISE EXCEPTION 'Réplication : transaction REPEATABLE READ exigée (niveau courant : %)', v_iso USING ERRCODE = 'CL001';
  END IF;
  IF p_after_posting IS NULL OR p_after_posting < 0 OR (p_after_change IS NOT NULL AND p_after_change < 0)
     OR p_limit IS NULL OR p_limit < 1 OR p_limit > 200 THEN
    RAISE EXCEPTION 'Réplication : curseurs positifs et limite entre 1 et 200' USING ERRCODE = 'CL001';
  END IF;
  g := edge_bind_gateway(p_gateway, false);              -- 42501 (autre passerelle, révoquée) ; no_data_found (autre prestataire)
  SELECT l.* INTO lg FROM ledger l WHERE l.id = edge_ledger_of_gateway(p_gateway);
  IF NOT FOUND THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  PERFORM assert_tenant(lg.operator_id);
  SELECT * INTO ev FROM event WHERE id = g.event_id;

  -- Colis servables : PRIMARY, non révoquée, délai écoulé depuis l'enrôlement ou la promotion, clé de contenu courante.
  v_delay := coalesce(edge_setting_value('pack_delay_seconds', 'XOF'), 1800);
  v_keysha := CASE WHEN g.agreement_public_key IS NULL THEN NULL ELSE sha256(g.agreement_public_key) END;
  SELECT * INTO k FROM edge_pwd_pack_key WHERE gateway_id = p_gateway;
  v_servable := g.role = 'PRIMARY' AND g.status <> 'REVOKED'
                AND coalesce(g.role_changed_at, g.registered_at) + make_interval(secs => v_delay) <= clock_timestamp()
                AND FOUND AND v_keysha IS NOT NULL AND k.agreement_key_sha256 = v_keysha;

  -- Horizon (A18).
  v_key := hashtextextended('debit-authority:' || lg.id::text, 0);
  SELECT horizon INTO v_prev FROM edge_replication_horizon WHERE ledger_id = lg.id;
  v_prev := coalesce(v_prev, 0);
  v_horizon := v_prev;
  v_lt := current_setting('lock_timeout');
  BEGIN
    PERFORM set_config('lock_timeout', '200ms', true);
    PERFORM pg_advisory_lock(v_key);
    v_locked := true;
    SELECT coalesce(max(id), 0) INTO v_max FROM posting;
    PERFORM pg_advisory_unlock(v_key);
    v_locked := false;
    -- L'instantané précède le verrou : une transaction en vol à l'instantané et validée depuis rend l'horizon non sûr.
    v_stale := EXISTS (SELECT 1 FROM pg_snapshot_xip(pg_current_snapshot()) x WHERE pg_xact_status(x) = 'committed');
    IF NOT v_stale THEN
      v_horizon := greatest(v_prev, v_max);
      v_horizon_safe := true;
    END IF;
  EXCEPTION
    WHEN lock_not_available THEN
      NULL;                                              -- verrou non obtenu : horizon précédent
    WHEN OTHERS THEN
      IF v_locked THEN PERFORM pg_advisory_unlock(v_key); END IF;
      PERFORM set_config('lock_timeout', v_lt, true);
      RAISE;
  END;
  PERFORM set_config('lock_timeout', v_lt, true);
  IF v_horizon_safe AND v_horizon > v_prev THEN
    INSERT INTO edge_replication_horizon (ledger_id, operator_id, horizon) VALUES (lg.id, lg.operator_id, v_horizon)
    ON CONFLICT (ledger_id) DO UPDATE SET horizon = greatest(edge_replication_horizon.horizon, EXCLUDED.horizon),
                                          updated_at = clock_timestamp();
  END IF;

  -- Preuve d'application du curseur de référence (A03) : seule écriture de la page, jamais au-delà du journal.
  IF p_after_change IS NOT NULL THEN
    SELECT least(p_after_change, coalesce(max(c.change_seq), 0)) INTO v_cap
      FROM edge_reference_change c WHERE c.ledger_id = lg.id;
    IF v_cap > g.reference_applied_seq THEN
      UPDATE edge_gateway SET reference_applied_seq = v_cap WHERE id = p_gateway;
    END IF;
  END IF;

  SELECT coalesce(e.exponent, 0) INTO v_exp FROM currency_exponent e WHERE e.code = ev.currency;
  v_today := (clock_timestamp() AT TIME ZONE 'UTC')::date;
  v_lim := p_limit;
  LOOP
    -- Soldes : portefeuilles dont une écriture a un posting.id dans ]after, to] (to <= horizon).
    SELECT array_agg(s.id ORDER BY s.id) INTO v_pids
      FROM (SELECT p.id FROM posting p JOIN account a ON a.id = p.account_id
             WHERE p.ledger_id = lg.id AND p.id > p_after_posting AND p.id <= v_horizon
               AND a.purpose IN ('WALLET_PAID', 'WALLET_PROMO')
             ORDER BY p.id LIMIT v_lim + 1) s;
    v_more := coalesce(cardinality(v_pids), 0) > v_lim;
    v_to := CASE WHEN v_more THEN v_pids[v_lim] ELSE greatest(p_after_posting, v_horizon) END;
    SELECT coalesce(array_agg(DISTINCT a.wallet_id), '{}') INTO v_wallets
      FROM posting p JOIN account a ON a.id = p.account_id
     WHERE p.ledger_id = lg.id AND p.id > p_after_posting AND p.id <= v_to
       AND a.purpose IN ('WALLET_PAID', 'WALLET_PROMO') AND a.wallet_id IS NOT NULL;

    -- Journal de référence (seulement si le curseur est fourni).
    v_ref := NULL; v_media_ids := '{}'; v_ref_wallets := '{}'; v_rmore := false; v_rto := NULL;
    IF p_after_change IS NOT NULL THEN
      SELECT array_agg(s.change_seq ORDER BY s.change_seq), array_agg(s.entity_kind ORDER BY s.change_seq),
             array_agg(s.entity_id ORDER BY s.change_seq)
        INTO v_seqs, v_kinds, v_eids
        FROM (SELECT c.change_seq, c.entity_kind, c.entity_id FROM edge_reference_change c
               WHERE c.ledger_id = lg.id AND c.change_seq > p_after_change
               ORDER BY c.change_seq LIMIT v_lim + 1) s;
      v_rmore := coalesce(cardinality(v_seqs), 0) > v_lim;
      IF v_rmore THEN
        v_seqs := v_seqs[1:v_lim]; v_kinds := v_kinds[1:v_lim]; v_eids := v_eids[1:v_lim];
      END IF;
      v_rto := coalesce(v_seqs[cardinality(v_seqs)], p_after_change);
      v_media_ids := coalesce(ARRAY(SELECT u.id FROM unnest(v_kinds, v_eids) AS u(kind, id) WHERE u.kind IN ('MEDIA', 'UNASSIGNED_MEDIA')), '{}');
      v_ref_wallets := coalesce(ARRAY(SELECT u.id FROM unnest(v_kinds, v_eids) AS u(kind, id) WHERE u.kind = 'WALLET_STATE'), '{}');
    END IF;

    -- Mois UTC de to_posting_id (même calcul que check_wallet_limits).
    SELECT date_trunc('month', coalesce((SELECT t.occurred_at FROM posting p JOIN journal_transaction t ON t.id = p.transaction_id
                                          WHERE p.id = v_to), clock_timestamp()) AT TIME ZONE 'UTC')
      INTO v_month;

    SELECT coalesce(jsonb_agg(jsonb_build_object(
             'wallet_id', w.id, 'status', w.status, 'paid', b.paid, 'promo', b.promo,
             'kyc_verified', wallet_kyc_level(w.id, v_today) = 'VERIFIED', 'topup_month_paid', t.total) ORDER BY w.id), '[]')
      INTO v_wallets_json
      FROM wallet w
      CROSS JOIN LATERAL (SELECT greatest(0, coalesce(-sum(ab.balance) FILTER (WHERE a.purpose = 'WALLET_PAID'), 0))::bigint AS paid,
                                 greatest(0, coalesce(-sum(ab.balance) FILTER (WHERE a.purpose = 'WALLET_PROMO'), 0))::bigint AS promo
                            FROM account a JOIN account_balance ab ON ab.account_id = a.id
                           WHERE a.wallet_id = w.id AND a.purpose IN ('WALLET_PAID', 'WALLET_PROMO')) b
      CROSS JOIN LATERAL (SELECT greatest(0, coalesce(-sum(p.amount), 0))::bigint AS total
                            FROM account a JOIN posting p ON p.account_id = a.id
                            JOIN journal_transaction jt ON jt.id = p.transaction_id
                           WHERE a.wallet_id = w.id AND a.purpose = 'WALLET_PAID' AND p.amount < 0
                             AND jt.type IN ('TOPUP', 'TOPUP_CASH')
                             AND date_trunc('month', jt.occurred_at AT TIME ZONE 'UTC') = v_month) t
     WHERE w.id = ANY (v_wallets) AND w.ledger_id = lg.id;

    -- Entrées de snapshot : bracelets des portefeuilles de la page et du journal, du grand livre de la passerelle.
    SELECT coalesce(jsonb_agg(jsonb_build_object(
             'token_hash', encode(r.token_hash, 'hex'), 'nfc_uid', encode(r.nfc_uid, 'hex'), 'key_index', r.key_index,
             'originality_sig_sha256', encode(r.originality_sig_sha256, 'hex'), 'status', r.status,
             'batch_event_id', r.batch_event_id, 'batch_status', r.batch_status, 'wallet_status', r.wallet_status,
             'spendable', greatest(0, r.spendable)::bigint, 'last_counter', r.last_counter,
             'pwd_pack_sha256', CASE WHEN v_servable THEN encode(p.pwd_pack_sha256, 'hex') END,
             'pwd_pack_enc', CASE WHEN v_servable AND p.media_id IS NOT NULL THEN jsonb_build_object(
                'nonce', edge_b64(substring(p.pwd_pack_enc FROM 1 FOR 12)),
                'ciphertext', edge_b64(substring(p.pwd_pack_enc FROM 13 FOR octet_length(p.pwd_pack_enc) - 28)),
                'tag', edge_b64(substring(p.pwd_pack_enc FROM octet_length(p.pwd_pack_enc) - 15 FOR 16))) END
           ) ORDER BY r.media_id), '[]')
      INTO v_media_json
      FROM offline_snapshot_rows r
      LEFT JOIN edge_pwd_pack p ON p.gateway_id = p_gateway AND p.media_id = r.media_id AND p.agreement_key_sha256 = v_keysha
     WHERE r.ledger_id = lg.id AND r.operator_id = g.operator_id
       AND (r.wallet_id = ANY (v_wallets) OR r.wallet_id = ANY (v_ref_wallets) OR r.media_id = ANY (v_media_ids));

    IF p_after_change IS NOT NULL THEN
      v_ref := jsonb_build_object('from_change_seq', p_after_change, 'to_change_seq', v_rto, 'has_more', v_rmore,
        'gateway', jsonb_build_object('gateway_id', g.id, 'role', g.role, 'status', g.status,
                                      'role_changed_at', edge_ts(g.role_changed_at)));
      IF p_after_change = 0 OR 'EVENT' = ANY (v_kinds) THEN
        v_ref := v_ref || jsonb_build_object('event', jsonb_build_object(
          'event_id', ev.id, 'name', ev.name, 'currency', ev.currency, 'minor_units', v_exp, 'timezone', ev.timezone,
          'status', ev.status::text, 'activation_modes', to_jsonb(ev.activation_modes),
          'terminal_settings', jsonb_build_object(
            'online_connect_timeout_ms', ev.online_connect_timeout_ms, 'online_total_timeout_ms', ev.online_total_timeout_ms,
            'online_retries', ev.online_retries, 'pending_sync_seconds', ev.pending_sync_seconds,
            'reconcile_sync_seconds', ev.reconcile_sync_seconds, 'heartbeat_seconds', ev.heartbeat_seconds,
            'reversal_window_minutes', ev.reversal_window_minutes, 'local_retention_days', ev.local_retention_days,
            'tap_replay_window_seconds', ev.tap_replay_window_seconds),
          'wallet_limits', (SELECT jsonb_build_object('max_wallet_balance', j.max_wallet_balance,
                              'unidentified_max_balance', j.unidentified_max_balance,
                              'identified_monthly_limit', j.identified_monthly_limit,
                              'unidentified_monthly_limit', j.unidentified_monthly_limit)
                              FROM ledger_jurisdiction(lg.id) j)));
      END IF;
      v_ref := v_ref || jsonb_build_object(
        'wallet_states', (SELECT coalesce(jsonb_agg(jsonb_build_object('wallet_id', w.id, 'status', w.status,
                            'kyc_verified', wallet_kyc_level(w.id, v_today) = 'VERIFIED') ORDER BY w.id), '[]')
                            FROM wallet w WHERE w.id = ANY (v_ref_wallets) AND w.ledger_id = lg.id),
        'devices', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                      'device_id', d.id, 'serial', d.serial, 'kind', d.kind, 'app_mode', d.app_mode, 'os', d.os,
                      'nfc_enabled', d.nfc_enabled, 'status', d.status, 'station_name', d.station_name,
                      'pos', CASE WHEN pos.id IS NULL THEN NULL ELSE jsonb_build_object(
                               'pos_id', pos.id, 'name', pos.name, 'merchant_name', m.legal_name) END,
                      'cash_desk_account_id', cd.account_id, 'public_key', edge_b64(d.public_key),
                      'cert_sha256', encode(d.cert_sha256, 'hex'), 'agreement_public_key', edge_b64(d.agreement_public_key),
                      'token_family', CASE WHEN tf.family_id IS NULL THEN NULL ELSE jsonb_build_object(
                         'fid', tf.family_id, 'status', CASE WHEN tf.consumed_at IS NULL AND tf.revoked_at IS NULL
                                                              AND tf.expires_at > clock_timestamp() THEN 'ACTIVE' ELSE 'REVOKED' END,
                         'refresh_token_sha256_current', encode(tf.token_hash, 'hex')) END) ORDER BY d.id), '[]')
                      FROM device d
                      LEFT JOIN LATERAL (SELECT r.family_id, r.token_hash, r.consumed_at, r.revoked_at, r.expires_at
                                           FROM device_refresh_token r
                                          WHERE r.device_id = d.id AND r.operator_id = g.operator_id AND r.edge_exposed
                                            AND g.role = 'PRIMARY' AND g.status <> 'REVOKED'
                                          ORDER BY r.created_at DESC, r.id DESC LIMIT 1) tf ON true
                      LEFT JOIN point_of_sale pos ON pos.id = d.pos_id
                      LEFT JOIN merchant_participation mp ON mp.id = pos.participation_id AND mp.event_id = g.event_id
                      LEFT JOIN party m ON m.id = mp.merchant_id
                      LEFT JOIN cash_desk cd ON cd.device_id = d.id AND cd.ledger_id = lg.id
                     WHERE d.id IN (SELECT u.id FROM unnest(v_kinds, v_eids) AS u(kind, id) WHERE u.kind = 'DEVICE')
                       AND d.event_id = g.event_id AND d.operator_id = g.operator_id
                       AND d.public_key IS NOT NULL AND d.cert_sha256 IS NOT NULL),
        'device_configs', (SELECT coalesce(jsonb_agg(jsonb_build_object('config_id', c.id, 'device_id', c.device_id,
                             'in_force', c.id = (SELECT max(c2.id) FROM device_config_served c2 WHERE c2.device_id = d.id),
                             'offline_policy', c.policy) ORDER BY c.id), '[]')
                             FROM device d JOIN device_config_served c ON c.device_id = d.id
                            WHERE d.id IN (SELECT u.id FROM unnest(v_kinds, v_eids) AS u(kind, id) WHERE u.kind = 'DEVICE_CONFIG')
                              AND d.event_id = g.event_id AND d.operator_id = g.operator_id
                              AND (c.id = (SELECT max(c2.id) FROM device_config_served c2 WHERE c2.device_id = d.id)
                                   OR c.served_at >= clock_timestamp() - make_interval(hours => ev.sync_deadline_hours + 24))),
        'cash_sessions', (SELECT coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                            'cash_session_id', s.cash_session_id, 'device_id', s.device_id, 'status', s.status,
                            'opened_by', s.opened_by, 'opened_at', edge_ts(s.opened_at), 'closed_at', edge_ts(s.closed_at)))
                            ORDER BY s.cash_session_id), '[]')
                            FROM cash_session s
                           WHERE s.cash_session_id IN (SELECT u.id FROM unnest(v_kinds, v_eids) AS u(kind, id) WHERE u.kind = 'CASH_SESSION')
                             AND s.ledger_id = lg.id AND s.operator_id = g.operator_id),
        'vendors', (SELECT coalesce(jsonb_agg(jsonb_build_object('vendor_id', v.id, 'display_name', v.display_name,
                      'status', v.status, 'locked', v.locked_at IS NOT NULL) ORDER BY v.id), '[]')
                      FROM vendor v
                     WHERE v.id IN (SELECT u.id FROM unnest(v_kinds, v_eids) AS u(kind, id) WHERE u.kind = 'VENDOR')
                       AND v.operator_id = g.operator_id
                       AND EXISTS (SELECT 1 FROM merchant_participation mp
                                    WHERE mp.event_id = g.event_id AND mp.merchant_id = v.merchant_id)),
        'vendor_sessions', (SELECT coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                              'vendor_session_id', vs.id, 'vendor_id', vs.vendor_id, 'device_id', vs.device_id,
                              'opened_at', edge_ts(vs.opened_at), 'expires_at', edge_ts(vs.expires_at),
                              'closed_at', edge_ts(vs.closed_at), 'closed_reason', vs.closed_reason)) ORDER BY vs.id), '[]')
                              FROM vendor_session vs JOIN device d ON d.id = vs.device_id
                             WHERE vs.id IN (SELECT u.id FROM unnest(v_kinds, v_eids) AS u(kind, id) WHERE u.kind = 'VENDOR_SESSION')
                               AND d.event_id = g.event_id AND vs.operator_id = g.operator_id),
        'staff', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                    'user_id', u.id, 'issuer', u.issuer, 'subject', u.subject, 'status', u.status,
                    'roles', coalesce((SELECT jsonb_agg(jsonb_build_object('role', ra.role, 'scope_type', ra.scope_type,
                                         'scope_id', ra.scope_id) ORDER BY ra.id)
                                         FROM role_assignment ra
                                        WHERE ra.user_id = u.id AND ra.revoked_at IS NULL AND ra.role IN ('CASHIER', 'SUPERVISOR')
                                          AND ((ra.scope_type = 'EVENT' AND ra.scope_id = g.event_id)
                                               OR (ra.scope_type = 'ORGANIZER' AND ra.scope_id = ev.organizer_id))), '[]'))
                    ORDER BY u.id), '[]')
                    FROM app_user u
                   WHERE u.id IN (SELECT x.id FROM unnest(v_kinds, v_eids) AS x(kind, id) WHERE x.kind = 'STAFF')
                     AND u.operator_id = g.operator_id
                     AND EXISTS (SELECT 1 FROM role_assignment ra2
                                  WHERE ra2.user_id = u.id AND ra2.role IN ('CASHIER', 'SUPERVISOR')
                                    AND ((ra2.scope_type = 'EVENT' AND ra2.scope_id = g.event_id)
                                         OR (ra2.scope_type = 'ORGANIZER' AND ra2.scope_id = ev.organizer_id)))),
        'catalogs', (SELECT coalesce(jsonb_agg(jsonb_build_object('pos_id', pos.id, 'version', cv.v, 'items',
                      (SELECT coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                          'product_id', i.item_id, 'name_fr', i.label_fr, 'name_en', i.label_en,
                          'category_fr', i.category_label_fr, 'category_en', i.category_label_en,
                          'unit_price', i.unit_price, 'vat_rate_bps', i.vat_rate_bps))
                          ORDER BY i.category_position, i.item_id), '[]')
                          FROM catalog_version_item i WHERE i.pos_id = pos.id AND i.version = cv.v)) ORDER BY pos.id), '[]')
                      FROM point_of_sale pos
                      JOIN merchant_participation mp ON mp.id = pos.participation_id AND mp.event_id = g.event_id
                      CROSS JOIN LATERAL (SELECT max(c.version) AS v FROM catalog_version c WHERE c.pos_id = pos.id) cv
                     WHERE pos.id IN (SELECT u.id FROM unnest(v_kinds, v_eids) AS u(kind, id) WHERE u.kind = 'CATALOG')
                       AND cv.v IS NOT NULL AND pos.operator_id = g.operator_id),
        'media_refs', (SELECT coalesce(jsonb_agg(jsonb_build_object('media_id', m.id, 'token_hash', encode(m.token_hash, 'hex'),
                         'wallet_id', a.wallet_id, 'status', m.status, 'batch_status', b.status) ORDER BY m.id), '[]')
                         FROM media m
                         LEFT JOIN media_batch b ON b.id = m.batch_id
                         LEFT JOIN LATERAL (SELECT ma.wallet_id FROM media_assignment ma JOIN wallet w ON w.id = ma.wallet_id
                                             WHERE ma.media_id = m.id AND ma.released_at IS NULL AND w.ledger_id = lg.id
                                             LIMIT 1) a ON true
                        WHERE m.id = ANY (v_media_ids) AND m.operator_id = g.operator_id
                          AND (a.wallet_id IS NOT NULL OR b.event_id = g.event_id)),
        'unassigned_media', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                               'media_id', m.id, 'nfc_uid', encode(m.nfc_uid, 'hex'), 'token_hash', encode(m.token_hash, 'hex'),
                               'key_index', m.key_index, 'originality_sig_sha256', encode(m.originality_sig_sha256, 'hex'),
                               'status', m.status, 'batch_event_id', b.event_id, 'batch_status', b.status,
                               'pwd_pack_sha256', CASE WHEN v_servable THEN encode(p.pwd_pack_sha256, 'hex') END,
                               'pwd_pack_enc', CASE WHEN v_servable AND p.media_id IS NOT NULL THEN jsonb_build_object(
                                  'nonce', edge_b64(substring(p.pwd_pack_enc FROM 1 FOR 12)),
                                  'ciphertext', edge_b64(substring(p.pwd_pack_enc FROM 13 FOR octet_length(p.pwd_pack_enc) - 28)),
                                  'tag', edge_b64(substring(p.pwd_pack_enc FROM octet_length(p.pwd_pack_enc) - 15 FOR 16))) END)
                               ORDER BY m.id), '[]')
                               FROM media m JOIN media_batch b ON b.id = m.batch_id AND b.event_id = g.event_id
                               LEFT JOIN edge_pwd_pack p ON p.gateway_id = p_gateway AND p.media_id = m.id
                                                        AND p.agreement_key_sha256 = v_keysha
                              WHERE m.id = ANY (v_media_ids) AND m.operator_id = g.operator_id AND m.nfc_uid IS NOT NULL
                                AND NOT EXISTS (SELECT 1 FROM media_assignment ma JOIN wallet w ON w.id = ma.wallet_id
                                                 WHERE ma.media_id = m.id AND ma.released_at IS NULL AND w.ledger_id = lg.id)));
    END IF;

    v_result := jsonb_build_object('ledger_id', lg.id, 'epoch', lg.authority_epoch, 'from_posting_id', p_after_posting,
                                   'to_posting_id', v_to, 'wallets', v_wallets_json, 'media', v_media_json,
                                   'has_more', v_more, 'edge_seq_applied', g.contiguous_edge_seq);
    IF v_servable THEN
      v_result := v_result || jsonb_build_object('pwd_pack_key', k.wrapped_key);
    END IF;
    IF NOT v_more THEN
      SELECT coalesce(jsonb_agg(jsonb_build_object('device_id', x.device_id, 'contiguous_acked_seq', x.contiguous_acked_seq,
               'max_seen_seq', x.max_seen_seq, 'missing_seqs', to_jsonb(x.missing_seqs),
               'next_seq_floor', x.next_seq_floor, 'as_of', edge_ts(x.as_of)) ORDER BY x.device_id), '[]')
        INTO v_acked FROM edge_device_seq_acked x;
      v_result := v_result || jsonb_build_object('device_seq_acked', v_acked);
    END IF;
    IF NOT v_more THEN
      -- Décision 36 (0065) : conditions de caution, frais d'activation, plafond de recharge (dernière page).
      v_result := v_result || jsonb_build_object('edge_terms', edge_replication_terms(p_gateway));
    END IF;
    IF v_ref IS NOT NULL THEN
      v_result := v_result || jsonb_build_object('reference', v_ref);
    END IF;
    EXIT WHEN octet_length(v_result::text) <= 2097152 OR v_lim = 1;   -- borne de 2 Mio : on réduit la page
    v_lim := greatest(1, v_lim / 2);
  END LOOP;
  RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION edge_replication_page(uuid, bigint, bigint, int) FROM PUBLIC;
