-- Migration 0061 : enveloppe edge_post_transaction, bornes de décision et réglages de plafonds
-- (mission passerelle-locale, lot WP06 ; FR-018, FR-038 ; contracts/interfaces.md § 1, § 2, § 7, § 8, § 12 et § 13
-- (font foi sur le prompt) ; data-model A.4 bis (onze contrôles), A.6 invariants 6, 8, 10 ; research R-09 ;
-- constats A06, A07, A08, A11 ; ADR-159, OP-N104).
--
-- Contenu :
--   1. edge_platform_setting : réglages globaux (plafonds de rejeu, délai des colis), décision interfaces.md § 12.4.
--      set_edge_setting : seule voie d'écriture, auditée. Valeurs initiales (porteur, 05/11/2026) : 50 000 par vente,
--      500 000 par terminal et par heure, 1 800 s de délai des colis.
--   2. Aides internes : edge_setting_value, edge_spend_promo_first, edge_record_rejection.
--   3. edge_post_transaction : l'enveloppe. Elle CONSTRUIT les lignes du portefeuille et de l'attente sous verrou de
--      compte ; elle ne prend de p_fee_lines que les lignes de frais et de commission, validées.
--   4. Un index partiel pour le plafond horaire.
--
-- SIGNATURE (interfaces.md § 2, figée) :
--   edge_post_transaction(p_gateway uuid, p_epoch bigint, p_edge_seq bigint, p_origin_key text, p_content bytea,
--                         p_op jsonb, p_fee_lines jsonb)
--   RETURNS TABLE (outcome text, transaction_id uuid, reason text, detail text, charged_to_wallet bigint,
--                  shortfall_amount bigint)
-- research.md R-09 donne une autre liste d'arguments (p_media, p_amount, p_type, p_decision...) : elle est périmée.
-- Tout ce qu'elle passait est DANS p_op (l'opération EdgeSyncOperation telle que reçue). Écart signalé.
-- `outcome` est l'un de ACCEPTED, ACCEPTED_WITH_SHORTFALL, DUPLICATE, REJECTED, VOID. Une issue `REJECTED` /
-- `INSUFFICIENT_FUNDS_RETRY` est « retryable » (le retour n'a pas de colonne retryable : l'API la déduit de la raison).
--
-- CE QUE L'API DOIT FOURNIR (champs que la passerelle ne peut PAS poser ; l'API les calcule après ses propres
-- vérifications et écrase toute valeur reçue de la passerelle) :
--   p_content        SHA-256 (32 octets) du contenu canonique de l'opération (chaîne du registre).
--   p_op.tap.signature_verified = true  : la signature de passage a été vérifiée par le processus des clés. Pour une
--                    vente ou une annulation EDGE_ONLINE, son absence ou sa valeur fausse est un rejet.
--   p_op.device_batch_verified = true   : l'en-tête et la signature du lot hors ligne du terminal, relayés par la
--                    passerelle, ont été vérifiés. Seules les opérations DEVICE_OFFLINE qui portent aussi
--                    device_batch_id ET ce drapeau échappent à la preuve du bracelet et aux plafonds de rejeu (le lot
--                    signé du terminal tient lieu de preuve, SPEC §9). Toute autre opération est traitée comme EDGE_ONLINE.
--   p_fee_lines      lignes de frais et de commission calculées par le moteur du central (shared-rules), tableau de
--                    {account_id, amount, fee_rule_id, memo}. Jamais de ligne de portefeuille ni d'attente.
-- Champs lus dans p_op (EdgeSyncOperation) : edge_seq, seq, type, occurred_at, amount, currency, authorized_mode,
-- device_serial, tap{nfc_uid, token_hash, counter, pack_verified, signature_verified}, edge_decision{status,
-- charged_to_wallet, shortfall_amount, shortfall_reason, reject_reason}, reverses_seq, reverses_transaction_id,
-- vendor_session_id, void_reason, device_batch_id, device_batch_verified. Jamais lus : tout compte (marchand, caisse,
-- portefeuille, attente), tout champ edge_guichet : les comptes viennent de la base.
--
-- TYPES TRAITES ICI : PURCHASE, REVERSAL, VOID. TOPUP_CASH, ACTIVATION, DEPOSIT_CASH (écritures DEPOSIT_TAKEN, TOPUP_CASH,
-- PRELOAD) sont les enveloppes de WP07 : ici elles sont refusées (MALFORMED_OPERATION, détail WRONG_ENVELOPE), comme tout
-- autre type (ADJUSTMENT...). La liste blanche d'A.4 bis 1 s'applique donc ENSEMBLE à ces enveloppes.
--
-- ORDRE DES VERROUS (C-012). Le prompt demande « autorité d'abord ». Les fonctions de handover (WP04) prennent le verrou
-- consultatif de l'ÉVÉNEMENT puis celui de l'autorité de débit (exclusif) ; edge_record_seq prend le verrou de
-- l'événement (partagé). Prendre l'autorité (partagé) avant l'événement ferait un interblocage possible. Ordre retenu,
-- cohérent avec 0058 à 0060 : (1) événement, partagé ; (2) autorité de débit, partagé (le même que post_transaction,
-- qui le reprend sans attente) ; (3) lignes : passerelle, handover ; (4) verrou du terminal (plafonds) ; (5) ligne du
-- bracelet FOR UPDATE ; (6) soldes payé et offert du portefeuille FOR UPDATE, par identifiant croissant, puis lecture ;
-- (7) post_transaction, qui reverrouille les mêmes soldes (déjà tenus). Écart signalé à l'orchestrateur.
--
-- BORNES (A.4 bis, ordre du fichier) : 1 type ; 2 comptes lus en base ; 3 plafond par vente ; 4 rognage sous verrou ;
-- 5 CL007 ; 6 preuve du bracelet ; 7 plafond par terminal et par heure ; 8 REVERSAL. 9 à 11 : WP07.
-- Plafonds : TABLE edge_platform_setting, lue dans la transaction, sans paramètre (interfaces.md § 12.4 l'emporte sur
-- § 8 : les clés de configuration EDGE_REPLAY_MAX_* sont retirées). Devise : la clé nue ne vaut que pour XOF ; une
-- autre devise exige une clé `replay_max_per_sale.<DEVISE>` / `replay_max_per_terminal_hour.<DEVISE>`, sinon l'enveloppe
-- REFUSE d'écrire (échec fermé : REJECTED / INSUFFICIENT_FUNDS_RETRY, détail EDGE_CEILING_NOT_CONFIGURED, retryable).
-- Plafond horaire : fenêtre SYMETRIQUE ]h - 1 h ; h + 1 h[ autour de l'heure d'origine h de la vente (cumul de toutes
-- les ventes déjà écrites du terminal dans cette fenêtre, quel que soit l'ordre d'arrivée : des heures décroissantes ou
-- mélangées ne contournent pas le plafond, correction du constat B1 de la relecture ; choix de la fenêtre symétrique
-- plutôt que des seaux sur l'heure d'écriture, qui feraient refuser à tort un vidage en rafale après une longue coupure).
-- Le cumul compte le MONTANT DEMANDE de la vente (edge_amount), non le montant écrit : sur-comptage prudent, voulu
-- (M3). L'heure d'origine est BORNEE au cycle (début du handover
-- moins 15 minutes ; maintenant plus 15 minutes) : une passerelle hostile ne peut pas étaler ses ventes sur des heures
-- inventées. Somme des ventes EDGE_ONLINE du terminal déjà écrites, sous le verrou du terminal.
--
-- DECISION DE LA PASSERELLE. Obligatoire dès qu'une opération porte un montant (PURCHASE ; REVERSAL qui porte `amount`).
-- Incohérente (charged + shortfall <> amount, négatif, raison absente, statut inconnu) : REJECTED / MALFORMED_OPERATION,
-- anomalie NON_COMPLIANT_OPERATION, RIEN d'écrit. Statut REJECTED de la passerelle : relayé tel quel (reject_reason
-- valide), sans écriture ni anomalie. Le central ne reprend de la décision que `charged_to_wallet` comme MAJORANT :
-- il écrit au plus ce montant, rogné par les plafonds et par le solde central lu sous verrou.
-- REVERSAL : contre-passation EXACTE de la vente écrite au central (mêmes comptes, signes inversés). Le portefeuille
-- récupère donc exactement ce que le central lui a débité (jamais plus que le charged_to_wallet écrit) ; la part
-- restée en S-ATTENTE est annulée et reduce_offline_shortfall réduit l'anomalie. Aucune ligne n'est lue de la requête.
-- Cible absente ou non écrite : REJECTED / REVERSAL_TARGET_NOT_FOUND ; déjà annulée : DUPLICATE (transaction de
-- l'annulation existante, détail ALREADY_REVERSED).
--
-- CL007. Sous le verrou du solde elle ne doit pas survenir. Si elle survient, le bloc d'écriture (sous-transaction) est
-- annulé en entier, rejoué une fois ; au second échec le numéro est enregistré REJECTED / INSUFFICIENT_FUNDS_RETRY avec
-- une anomalie. CL003 et CL005 de post_transaction deviennent REJECTED / LEDGER_LOCKED et PERIOD_CLOSED.
-- Une même transaction fait l'écriture ET edge_record_seq (appelée en dernier : rien ne peut échouer après elle).
--
-- Erreurs levées (rien n'est enregistré, l'appel est refusé en entier) : 42501 (p_gateway différent de
-- app.gateway_id) ; no_data_found ; CL013 (passerelle révoquée, en attente, ou sans handover actif de ce grand livre) ;
-- CL015 (époque) ; CL016 (numéro non suivant) ; CL002 (même numéro, autre contenu) ; CL001 (p_content invalide).
-- Limite connue : une origin_key déjà au registre sous un AUTRE numéro lève 23505 (registre WP05) et bloque cette
-- passerelle seule.
--
-- Aucun GRANT, aucune valeur d'énumération ajoutée (A11). Toutes les fonctions : SECURITY DEFINER,
-- search_path = public, pg_temp, EXECUTE retiré à PUBLIC. WP09 accordera edge_post_transaction à cashless_edge et
-- set_edge_setting à cashless_edgeadmin ; les aides edge_setting_value, edge_spend_promo_first et edge_record_rejection
-- ne s'accordent JAMAIS.
-- A faire relire par une personne (CLAUDE.md, règle 4) : TOUT ce fichier (création d'argent, concurrence, bornes de la
-- passerelle compromise).

-- 1. Réglages de plateforme ---------------------------------------------------------------------------------------
-- Exception nommée à la règle « toute table porte operator_id » (interfaces.md § 12.4) : réglage global, aucune donnée
-- de prestataire. RLS activée ET forcée quand même : lecture ouverte, écriture seulement si le drapeau local
-- app.edge_setting_write est posé par set_edge_setting (aucun GRANT n'est donné sur la table).
CREATE TABLE edge_platform_setting (
  key              text PRIMARY KEY
                   CHECK (key ~ '^(replay_max_per_sale|replay_max_per_terminal_hour)(\.[A-Z]{3})?$'
                          OR key = 'pack_delay_seconds'),
  value            bigint NOT NULL CHECK (value > 0),
  updated_at       timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_by_label text NOT NULL CHECK (length(btrim(updated_by_label)) > 0)
);
CREATE TRIGGER edge_platform_setting_no_delete BEFORE DELETE ON edge_platform_setting
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
ALTER TABLE edge_platform_setting ENABLE ROW LEVEL SECURITY;
ALTER TABLE edge_platform_setting FORCE ROW LEVEL SECURITY;
CREATE POLICY edge_setting_read ON edge_platform_setting FOR SELECT USING (true);
CREATE POLICY edge_setting_write ON edge_platform_setting FOR ALL
  USING (current_setting('app.edge_setting_write', true) = 'on')
  WITH CHECK (current_setting('app.edge_setting_write', true) = 'on');
-- Aucun droit sur la table pour aucun rôle applicatif (les droits par défaut donnent arw à cashless_app) : seul le
-- propriétaire écrit, par set_edge_setting. Des REVOKE seulement, aucun GRANT. Le drapeau local n'est qu'une
-- ceinture : sans privilège de table, un appelant qui le pose ne peut rien écrire.
DO $$
DECLARE r text;
BEGIN
  REVOKE ALL ON edge_platform_setting FROM PUBLIC;
  FOR r IN SELECT rolname FROM pg_roles WHERE rolname LIKE 'cashless\_%' ESCAPE '\' LOOP
    EXECUTE format('REVOKE ALL ON edge_platform_setting FROM %I', r);
  END LOOP;
END $$;
-- Mais roles.sql et post-roles.sql (WP09), rejoués APRES les migrations, redonnent arw à cashless_app sur toutes les
-- tables : le REVOKE ci-dessus ne suffit donc pas. Garde indépendante des droits : un déclencheur (non DEFINER)
-- refuse toute écriture dont current_user n'est pas le propriétaire de la table. set_edge_setting est SECURITY DEFINER :
-- current_user y est le propriétaire, elle passe ; un appelant applicatif, quel que soit son privilège de table et
-- quel que soit le drapeau local qu'il pose, est refusé (42501). WP09 doit aussi retirer ce droit dans post-roles.sql.
CREATE FUNCTION edge_platform_setting_owner_only() RETURNS trigger LANGUAGE plpgsql
SET search_path = public, pg_temp AS $$
BEGIN
  IF current_user::text <> (SELECT pg_get_userbyid(c.relowner) FROM pg_class c WHERE c.oid = 'public.edge_platform_setting'::regclass) THEN
    RAISE EXCEPTION 'edge_platform_setting : écriture réservée à set_edge_setting' USING ERRCODE = '42501';
  END IF;
  IF TG_OP IN ('DELETE', 'TRUNCATE') THEN RAISE EXCEPTION 'edge_platform_setting : suppression interdite' USING ERRCODE = '42501'; END IF;
  RETURN CASE WHEN TG_OP = 'TRUNCATE' THEN NULL ELSE NEW END;
END $$;
REVOKE ALL ON FUNCTION edge_platform_setting_owner_only() FROM PUBLIC;
CREATE TRIGGER edge_platform_setting_owner_only BEFORE INSERT OR UPDATE OR DELETE ON edge_platform_setting
  FOR EACH ROW EXECUTE FUNCTION edge_platform_setting_owner_only();
CREATE TRIGGER edge_platform_setting_owner_only_truncate BEFORE TRUNCATE ON edge_platform_setting
  FOR EACH STATEMENT EXECUTE FUNCTION edge_platform_setting_owner_only();
INSERT INTO edge_platform_setting (key, value, updated_by_label) VALUES
  ('replay_max_per_sale', 50000, 'porteur 2026-11-05 (OP-N104)'),
  ('replay_max_per_terminal_hour', 500000, 'porteur 2026-11-05 (OP-N104)'),
  ('pack_delay_seconds', 1800, 'porteur 2026-11-05 (décision 16)');

CREATE FUNCTION set_edge_setting(p_key text, p_value bigint, p_label text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_before bigint;
BEGIN
  IF p_label IS NULL OR length(btrim(p_label)) = 0 THEN
    RAISE EXCEPTION 'Réglage : libellé de l''auteur obligatoire' USING ERRCODE = 'CL001';
  END IF;
  IF p_value IS NULL OR p_value <= 0 THEN
    RAISE EXCEPTION 'Réglage : valeur strictement positive obligatoire' USING ERRCODE = 'CL001';
  END IF;
  IF p_key IS NULL OR NOT (p_key ~ '^(replay_max_per_sale|replay_max_per_terminal_hour)(\.[A-Z]{3})?$'
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

-- 2. Aides internes (jamais accordées) -----------------------------------------------------------------------------
-- Valeur d'un plafond pour une devise : clé suffixée d'abord ; la clé nue ne vaut que pour XOF ; sinon NULL (refus).
CREATE FUNCTION edge_setting_value(p_key text, p_currency text) RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce(
    (SELECT s.value FROM edge_platform_setting s WHERE s.key = p_key || '.' || p_currency),
    (SELECT s.value FROM edge_platform_setting s WHERE s.key = p_key AND p_currency = 'XOF'))
$$;
REVOKE ALL ON FUNCTION edge_setting_value(text, text) FROM PUBLIC;

-- Ordre de dépense (réglage spend_order de la cascade) en SQL : niveau le plus précis qui le définit (EVENT,
-- ORGANIZER, OPERATOR, PLATFORM), dernière version dont la date d'effet ne dépasse pas p_at ; défaut PROMO_FIRST.
CREATE FUNCTION edge_spend_promo_first(p_ledger uuid, p_at timestamptz) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce((
    SELECT v.settings ->> 'spend_order'
      FROM ledger l
      JOIN event e ON l.scope_type = 'EVENT' AND e.id = l.scope_id
      CROSS JOIN LATERAL (VALUES (1, 'EVENT', e.id), (2, 'ORGANIZER', e.organizer_id),
                                 (3, 'OPERATOR', e.operator_id), (4, 'PLATFORM', NULL::uuid)) AS lv(rnk, scp, sid)
      CROSS JOIN LATERAL (SELECT c.settings FROM config_version c
                           WHERE c.scope_type = lv.scp AND (lv.sid IS NULL OR c.scope_id = lv.sid)
                             AND c.valid_from <= p_at
                           ORDER BY c.version DESC LIMIT 1) AS v
     WHERE l.id = p_ledger AND v.settings ? 'spend_order'
     ORDER BY lv.rnk LIMIT 1), 'PROMO_FIRST') <> 'PAID_FIRST'
$$;
REVOKE ALL ON FUNCTION edge_spend_promo_first(uuid, timestamptz) FROM PUBLIC;

-- Rejet enregistré : anomalie NON_COMPLIANT_OPERATION (jamais écrite à la main : open_offline_anomaly) puis numéro
-- consommé avec REJECTED. p_anomaly = false pour un refus déclaré par la passerelle elle-même.
CREATE FUNCTION edge_record_rejection(p_gateway uuid, p_ledger uuid, p_edge_seq bigint, p_origin_key text,
                                      p_content bytea, p_reason text, p_detail text, p_device uuid, p_media uuid,
                                      p_terminal_seq bigint, p_amount bigint, p_loss text, p_anomaly boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF p_anomaly THEN
    PERFORM open_offline_anomaly(p_ledger, 'NON_COMPLIANT_OPERATION', p_device, p_media, p_terminal_seq, NULL,
              greatest(coalesce(p_amount, 0), 0), coalesce(p_loss, 'OPERATOR'),
              jsonb_build_object('source', 'EDGE_SYNC', 'edge_gateway_id', p_gateway, 'edge_seq', p_edge_seq,
                                 'origin_key', p_origin_key, 'reason', p_reason, 'detail', p_detail), NULL);
  END IF;
  PERFORM edge_record_seq(p_gateway, p_edge_seq, p_origin_key, p_content, 'REJECTED', NULL, p_reason);
END $$;
REVOKE ALL ON FUNCTION edge_record_rejection(uuid, uuid, bigint, text, bytea, text, text, uuid, uuid, bigint, bigint,
                                            text, boolean) FROM PUBLIC;

-- 4. Index du plafond horaire (partiel : seules les écritures de passerelle) --------------------------------------
CREATE INDEX journal_transaction_edge_terminal_idx
  ON journal_transaction (device_id, ((metadata ->> 'ceiling_epoch')::bigint))
  WHERE source = 'EDGE_SYNC' AND type = 'PURCHASE';

-- 3. L'enveloppe ---------------------------------------------------------------------------------------------------
CREATE FUNCTION edge_post_transaction(p_gateway uuid, p_epoch bigint, p_edge_seq bigint, p_origin_key text,
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
          v_eff_epoch := floor(extract(epoch FROM v_eff))::bigint;
          SELECT coalesce(sum((t.metadata ->> 'edge_amount')::bigint), 0) INTO v_used
            FROM journal_transaction t
           WHERE t.device_id = dev.id AND t.source = 'EDGE_SYNC' AND t.type = 'PURCHASE'
             AND t.metadata ->> 'origin_mode' = 'EDGE_ONLINE'
             AND (t.metadata ->> 'ceiling_epoch')::bigint > v_eff_epoch - 3600
             AND (t.metadata ->> 'ceiling_epoch')::bigint < v_eff_epoch + 3600;
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
        IF v_strict THEN v_meta := v_meta || jsonb_build_object('ceiling_epoch', v_eff_epoch); END IF;

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
