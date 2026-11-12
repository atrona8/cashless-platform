-- Migration 0062 : opérations de guichet rejouées au central en source EDGE_SYNC
-- (mission passerelle-locale, lot WP07 ; FR-016, FR-020 ; contracts/interfaces.md § 1, § 2, § 12, § 13 (font foi sur le
-- prompt) ; data-model A.4 bis points 9, 10, 11 et A.6 invariants 3 et 7 ; research R-10 et R-11 ; constats A09, A10,
-- A24 ; ADR-52, ADR-63, ADR-132, ADR-162, ADR-163 ; OP-N107, OP-N108).
--
-- Contenu :
--   1. edge_open_replay_failed : aide interne qui ouvre l'anomalie EDGE_REPLAY_FAILED (jamais accordée).
--   2. edge_counter_op : corps commun interne (jamais accordé), un seul bloc d'enveloppe pour les trois types.
--   3. edge_activate_media, edge_take_deposit, edge_topup_cash : trois fonctions de la passerelle, fines, aux
--      arguments et retours de edge_post_transaction.
--
-- SIGNATURES (interfaces.md § 2, figées) :
--   edge_activate_media | edge_take_deposit | edge_topup_cash
--     (p_gateway uuid, p_epoch bigint, p_edge_seq bigint, p_origin_key text, p_content bytea, p_op jsonb)
--   RETURNS TABLE (outcome text, transaction_id uuid, reason text, detail text, charged_to_wallet bigint,
--                  shortfall_amount bigint)
-- research.md R-10 donne d'autres arguments (origin_key, media, cash_session, amount...) : périmés, tout est DANS p_op
-- (EdgeSyncOperation telle que reçue). Écart signalé.
--
-- CHAMPS LUS DANS p_op : edge_seq, seq, type, occurred_at, currency, authorized_mode (EDGE_ONLINE seulement),
-- device_serial, amount (TOPUP_CASH), tap.token_hash (TOPUP_CASH, facultatif si edge_guichet.media_id), edge_guichet
-- {media_id, wallet_id, event_id, channel, deposit_amount, cash_desk_account_id}. JAMAIS lus pour décider d'un compte :
-- le compte de caisse (celui de la session OPEN du terminal d'origine), le portefeuille d'un bracelet (la base), le grand
-- livre et l'événement (la passerelle). cash_desk_account_id, s'il est présent, n'est qu'un témoin comparé au compte de
-- la session : différent, REJECTED / MALFORMED_OPERATION.
--
-- CLE D'ORIGINE (A10). ACTIVATION et TOPUP_CASH : p_origin_key = '<serial>:<seq>'. DEPOSIT_CASH : '<serial>:<seq>' (route
-- takeDeposit seule) ou '<serial>:<seq>#deposit' (caution d'une activation). La clé sert de clé d'idempotence du grand
-- livre pour DEPOSIT_TAKEN et TOPUP_CASH. L'activation n'écrit rien sans préchargement : son doublon se reconnaît donc
-- (a) au registre d'une AUTRE passerelle du prestataire (reprise forcée), (b) au registre d'idempotence de la route en
-- ligne (api_idempotency, clé '<serial>:<seq>' terminée en 2xx). Doublon : DUPLICATE si une écriture est connue (le
-- préchargement, la caution, ou celle du registre de l'autre passerelle), sinon VOID / DUPLICATE_ORIGIN_KEY. Le
-- registre exige un transaction_id pour DUPLICATE (edge_sync_registry, 0060) : un doublon sans écriture ne peut pas
-- être DUPLICATE. Écart signalé (le prompt dit DUPLICATE).
--
-- REJEU IMPOSSIBLE (FR-020). Quand l'état du central interdit l'opération alors que le guichet a déjà agi : REJECTED /
-- EDGE_REPLAY_FAILED, detail = le motif, aucun transaction_id (le registre l'interdit), anomalie EDGE_REPLAY_FAILED qui
-- porte le montant encaissé, le terminal (device_id et seq), le bracelet et la clé d'origine. Caution seulement :
-- l'écriture d'attente (débit de la caisse, crédit SUSPENSE, metadata.replay_failed, clé d'origine) n'est écrite QUE si la
-- session d'origine est encore OPEN ; sinon aucune écriture (la garde de caisse ADR-132 la refuserait, CL029) : l'anomalie
-- porte seule le montant, résolution à deux (ANOMALY_RESOLUTION). Une recharge espèces ne laisse pas d'écriture d'attente :
-- anomalie seule. Aucune perte silencieuse : tout numéro est consommé avec un résultat.
-- Les motifs (detail) : MEDIA_UNKNOWN, MEDIA_NOT_ACTIVE, MEDIA_WRONG_EVENT, MEDIA_BATCH_INACTIVE, MEDIA_ALREADY_ACTIVE,
-- WALLET_OTHER_LEDGER, WALLET_NOT_ACTIVE, CASH_SESSION_NOT_OPEN, NO_DEPOSIT_DUE, DEPOSIT_AMOUNT_MISMATCH,
-- DEPOSIT_ALREADY_HELD, DEPOSIT_ACCOUNT_MISSING, ACCOUNT_MISSING, CL020 (mode d'activation non autorisé), ou le SQLSTATE
-- levé pendant l'écriture (CL001, CL002, CL003, CL004, CL005, CL007, CL008, CL009, CL020, CL029, 23xxx). L'écriture est
-- faite dans une sous-transaction : un échec n'en laisse rien (ni portefeuille créé, ni bracelet modifié).
-- Refus d'une requête mal formée ou mensongère (rien d'écrit, anomalie NON_COMPLIANT_OPERATION avec le montant) :
-- REJECTED / MALFORMED_OPERATION (WRONG_ENVELOPE, ORIGIN_FIELDS, ORIGIN_OCCURRED_AT, UNKNOWN_TERMINAL, AMOUNT,
-- GUICHET_*, WALLET_ID_EXISTS, CASH_ACCOUNT_MISMATCH, DEPOSIT_FROM_BALANCE_REFUSED) ou CURRENCY_MISMATCH. Une clé
-- d'origine déjà au journal pour une autre opération : REJECTED / IDEMPOTENCY_KEY_REUSED.
--
-- ACTIVATION (A24). Mêmes contrôles que activate_media (mode DESK de l'événement, CL020) plus ceux de la route en ligne
-- (lot du même organisateur, de cet événement ou réutilisable, ACTIVE). Anonyme : le portefeuille NE DOIT PAS exister, il
-- est CREE par l'enveloppe (avec l'identifiant donné par la passerelle s'il y en a un, sinon un identifiant neuf), jamais
-- rattaché à un portefeuille existant. Un wallet_id existant n'est admis que pour la réactivation du MEME bracelet de ce
-- portefeuille (media_assignment déjà écrit pour ce couple), même grand livre, portefeuille ACTIVE ; sinon REJECTED /
-- MALFORMED_OPERATION / WALLET_ID_EXISTS. L'écriture : état du bracelet, rattachement, préchargement (PROMO_CREDIT, clé
-- preload:<bracelet>:<n>, la même que preload_media, source EDGE_SYNC, métadonnées origin_*). Les fonctions éprouvées
-- activate_media, preload_media, take_deposit et take_deposit_for_session ne sont PAS modifiées (diff vide).
--
-- DEPOSIT_CASH. Mode SEPARATE en espèces seulement ; FROM_BALANCE refusé (MALFORMED_OPERATION, la passerelle ne le sert pas,
-- SP:752-758). Compte de caisse = compte de la session OPEN du terminal d'origine, de ce grand livre, de cet événement,
-- ouverte AVANT le début du cycle EDGE (R-24 : une session ouverte après la bascule n'est pas servie par la passerelle).
-- Montant = celui du lot (sinon DEPOSIT_AMOUNT_MISMATCH). Écriture DEPOSIT_TAKEN source EDGE_SYNC, rattachée à la session
-- (cash_session_attach_own), media.deposit_status = HELD.
--
-- TOPUP_CASH (A09, décision 14, OP-N108). Jamais rejetée pour un plafond réglementaire : écrite en deux parts selon
-- wallet_topup_headroom (la marge au portefeuille, le reste en L-ESP-A-RENDRE), ACCEPTED et anomalie
-- CASH_TOPUP_OVER_LIMIT (open_cash_due_anomaly : media_id et montant dû), résolue par refund_cash_due. Retour :
-- charged_to_wallet = part créditée au portefeuille, shortfall_amount = part en espèces dues. Aucune logique ne masque le
-- dépassement temporaire d'un plafond entre la recharge locale et le rejeu (OP-N108, SOUMIS AU JURISTE) : il reste visible
-- par l'anomalie. Toute autre cause d'échec : REJECTED / EDGE_REPLAY_FAILED (ci-dessus). Même session que la caution.
--
-- ORDRE DES VERROUS (celui de 0061, C-012) : (1) événement, partagé ; (2) autorité de débit, partagée ; (3) lignes :
-- passerelle, handover, terminal ; (4) ligne du bracelet FOR UPDATE ; (5) solde payé du portefeuille (wallet_topup_headroom)
-- puis les soldes de post_transaction par identifiant croissant. La session de caisse est lue SANS verrou (comme la garde).
-- Chaque fonction écrit l'opération ET appelle edge_record_seq (en dernier) dans la MEME transaction.
--
-- Erreurs levées (rien n'est enregistré) : 42501 (p_gateway différent de app.gateway_id) ; no_data_found ; CL013 ;
-- CL015 (époque) ; CL016 ; CL002 (même numéro, autre contenu) ; CL001 (p_content invalide). Limite connue (celle de 0061) :
-- une origin_key déjà au registre sous un AUTRE numéro de cette passerelle lève 23505.
--
-- Aucun GRANT, aucune valeur d'énumération ajoutée (A11). Toutes les fonctions : SECURITY DEFINER,
-- search_path = public, pg_temp, EXECUTE retiré à PUBLIC. WP09 accordera à cashless_edge : edge_activate_media,
-- edge_take_deposit, edge_topup_cash. Ne s'accordent JAMAIS : edge_counter_op, edge_open_replay_failed.
-- A faire relire par une personne (CLAUDE.md, règle 4) : TOUT ce fichier (argent en espèces, création de portefeuille,
-- garde de caisse, anomalies).

-- 1. Aide interne -------------------------------------------------------------------------------------------------
-- Anomalie EDGE_REPLAY_FAILED : idempotente par (prestataire, clé d'origine). open_offline_anomaly n'admet pas ce type
-- (liste fermée de 0047) et ne doit pas être modifiée : insertion directe, comme open_cash_due_anomaly (0036).
CREATE FUNCTION edge_open_replay_failed(p_ledger uuid, p_gateway uuid, p_edge_seq bigint, p_origin_key text,
                                        p_device uuid, p_media uuid, p_terminal_seq bigint, p_tx uuid,
                                        p_amount bigint, p_loss text, p_code text, p_message text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_op uuid; v_id uuid;
BEGIN
  v_op := tenant_of_ledger(p_ledger);
  PERFORM assert_tenant(v_op);
  IF p_amount IS NULL OR p_amount < 0 OR p_origin_key IS NULL OR p_code IS NULL THEN
    RAISE EXCEPTION 'Anomalie de rejeu : montant, clé d''origine et motif exigés' USING ERRCODE = 'CL001';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('edge-replay-failed:' || v_op || ':' || p_origin_key, 0));
  SELECT a.id INTO v_id FROM anomaly a
   WHERE a.operator_id = v_op AND a.kind = 'EDGE_REPLAY_FAILED' AND a.detail ->> 'origin_key' = p_origin_key
   ORDER BY a.created_at, a.id LIMIT 1;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  INSERT INTO anomaly (operator_id, ledger_id, kind, media_id, device_id, seq, transaction_id, amount, loss_bearer, detail)
  VALUES (v_op, p_ledger, 'EDGE_REPLAY_FAILED', p_media, p_device, p_terminal_seq, p_tx, p_amount,
          coalesce(p_loss, 'OPERATOR'),
          jsonb_build_object('source', 'EDGE_SYNC', 'edge_gateway_id', p_gateway, 'edge_seq', p_edge_seq,
                             'origin_key', p_origin_key, 'code', p_code, 'message', p_message,
                             'amount_collected', p_amount))
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION edge_open_replay_failed(uuid, uuid, bigint, text, uuid, uuid, bigint, uuid, bigint, text, text,
                                               text) FROM PUBLIC;

-- 2. Corps commun -------------------------------------------------------------------------------------------------
CREATE FUNCTION edge_counter_op(p_type text, p_gateway uuid, p_epoch bigint, p_edge_seq bigint, p_origin_key text,
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
  v_head bigint; v_credit bigint := 0; v_over bigint := 0; v_lines jsonb; v_meta jsonb; v_tx uuid; v_wtx uuid; n int;
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

-- 3. Les trois fonctions de la passerelle ------------------------------------------------------------------------------
CREATE FUNCTION edge_activate_media(p_gateway uuid, p_epoch bigint, p_edge_seq bigint, p_origin_key text,
                                    p_content bytea, p_op jsonb)
RETURNS TABLE (outcome text, transaction_id uuid, reason text, detail text, charged_to_wallet bigint,
               shortfall_amount bigint)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT * FROM edge_counter_op('ACTIVATION', p_gateway, p_epoch, p_edge_seq, p_origin_key, p_content, p_op)
$$;
REVOKE ALL ON FUNCTION edge_activate_media(uuid, bigint, bigint, text, bytea, jsonb) FROM PUBLIC;

CREATE FUNCTION edge_take_deposit(p_gateway uuid, p_epoch bigint, p_edge_seq bigint, p_origin_key text,
                                  p_content bytea, p_op jsonb)
RETURNS TABLE (outcome text, transaction_id uuid, reason text, detail text, charged_to_wallet bigint,
               shortfall_amount bigint)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT * FROM edge_counter_op('DEPOSIT_CASH', p_gateway, p_epoch, p_edge_seq, p_origin_key, p_content, p_op)
$$;
REVOKE ALL ON FUNCTION edge_take_deposit(uuid, bigint, bigint, text, bytea, jsonb) FROM PUBLIC;

CREATE FUNCTION edge_topup_cash(p_gateway uuid, p_epoch bigint, p_edge_seq bigint, p_origin_key text,
                                p_content bytea, p_op jsonb)
RETURNS TABLE (outcome text, transaction_id uuid, reason text, detail text, charged_to_wallet bigint,
               shortfall_amount bigint)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT * FROM edge_counter_op('TOPUP_CASH', p_gateway, p_epoch, p_edge_seq, p_origin_key, p_content, p_op)
$$;
REVOKE ALL ON FUNCTION edge_topup_cash(uuid, bigint, bigint, text, bytea, jsonb) FROM PUBLIC;
