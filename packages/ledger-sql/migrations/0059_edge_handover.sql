-- Migration 0059 : bascule d'autorité, accusé, rendu en deux temps, reprise forcée, refus de fermeture de caisse
-- (mission passerelle-locale, lot WP04 ; FR-003, FR-006, FR-007, FR-021, FR-022, FR-024, C-003, C-012 ;
-- contracts/interfaces.md § 1, § 2, § 7, § 12 et § 13 (font foi) ; data-model A.3, A.4, A.6, A.7 ;
-- research R-06, R-07, R-11 ; constats A03, A05, A13, A17).
--
-- Contenu :
--   1. Colonnes de `debit_authority_handover` (toutes NULLables) et notification `edge_handover_changed`
--      (payload = identifiant de la passerelle, rien d'autre).
--   2. Fonctions internes : edge_bind_gateway, edge_lock_handover.
--   3. Enveloppes : get_debit_authority, get_current_edge_handover, edge_grant_authority (humaine),
--      edge_ack_handover, begin_edge_release, edge_complete_release, fail_edge_release (humaine),
--      force_central_authority_approved, edge_stuck_handovers (maintenance, interfaces.md § 12.5).
--   4. `begin_cash_close` : seule fonction du kit remplacée (dernière définition : 0040), garde ajoutée.
--
-- Les fonctions S12 du kit (grant_edge_authority, ack_edge_handover, fail_edge_grant, request_edge_release,
-- complete_edge_release, force_central_authority) ne sont NI modifiées NI redéfinies (C-003). Les enveloppes les
-- appellent. `fail_edge_grant` et `request_edge_release` n'ont pas de nouvelle enveloppe (interfaces.md ne les
-- redéclare pas) : leurs droits sont à vérifier en WP09.
--
-- Ordre des verrous (C-012) : (1) verrou consultatif de l'ÉVÉNEMENT (edge_event_lock, 0058), (2) verrou consultatif
-- d'autorité du GRAND LIVRE ('debit-authority:' || ledger, exclusif ; partagé pour begin_cash_close, comme
-- post_transaction), (3) lignes : handover, puis passerelle (même ordre que les S12). begin_cash_close garde l'ordre de
-- 0040 (terminal, session, solde) et prend le verrou d'autorité PARTAGÉ APRÈS le solde, jamais avant.
--
-- Lecture du journal de référence (interfaces.md § 12.2) : la TABLE `edge_reference_change` est créée en 0058 ; ses
-- déclencheurs arrivent en 0063 (WP08). `edge_grant_authority` la lit réellement (aucune table temporaire, aucun SQL
-- dynamique). Journal VIDE pour le grand livre : l'accord est REFUSÉ (échec fermé, jamais de filigrane à 0, A03), car
-- sans les déclencheurs de 0063 un journal vide ne prouve rien. POINT DE CONTRÔLE pour WP08 : le journal doit contenir
-- au moins une ligne par grand livre avant le premier accord (reprise des données existantes ou ligne d'amorce).
--
-- Rendu en deux temps (A07/A17) : le commit propre du début de rendu n'est PAS une fonction SQL. L'API appelle
-- `begin_edge_release` dans SA transaction, la valide (COMMIT), puis appelle `edge_complete_release` dans une autre ;
-- si celle-ci échoue (CL014, CL017), l'état RELEASING reste en base. Aucune transaction autonome, aucun dblink.
--
-- Erreurs : 42501 (p_gateway différent de app.gateway_id, passerelle REVOKED, rôle autre que PRIMARY, approbation
-- inutilisable) ; no_data_found (autre prestataire) ; CL013 (handover inconnu OU étranger, message identique ; état
-- interdit) ; CL014 (réplication de référence ou file de la passerelle en retard) ; CL015 (époque) ; CL017 (chaîne,
-- compte d'opérations) ; CL001 (paramètre invalide) ; CL029 (begin_cash_close).
--
-- Aucun GRANT : WP09. Toutes les fonctions : SECURITY DEFINER, search_path = public, pg_temp, REVOKE ALL FROM PUBLIC.
--
-- A faire relire par une personne (CLAUDE.md, règle 4) : begin_cash_close (remplacée), edge_grant_authority,
-- force_central_authority_approved, edge_ack_handover, edge_complete_release.

-- 1. Colonnes et notification ------------------------------------------------------------------------------------
ALTER TABLE debit_authority_handover ADD COLUMN begun_releasing_at timestamptz;
ALTER TABLE debit_authority_handover ADD COLUMN ops_count bigint;
ALTER TABLE debit_authority_handover ADD COLUMN edge_seq_at_activation bigint;
ALTER TABLE debit_authority_handover ADD COLUMN reference_watermark_seq bigint;

CREATE FUNCTION edge_handover_notify() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM pg_notify('edge_handover_changed', NEW.edge_gateway_id::text);
  RETURN NULL;
END $$;
CREATE TRIGGER edge_handover_notify AFTER INSERT OR UPDATE ON debit_authority_handover
  FOR EACH ROW EXECUTE FUNCTION edge_handover_notify();

-- 2. Fonctions internes -------------------------------------------------------------------------------------------
-- Lie l'appel à la passerelle authentifiée : p_gateway doit être celle posée par la garde mTLS (app.gateway_id).
-- Désaccord, absence, passerelle inconnue ou REVOKED, rôle non PRIMARY quand il est exigé : 42501.
CREATE FUNCTION edge_bind_gateway(p_gateway uuid, p_primary boolean) RETURNS edge_gateway
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE g edge_gateway%ROWTYPE; v_ctx text := nullif(current_setting('app.gateway_id', true), '');
BEGIN
  IF p_gateway IS NULL OR v_ctx IS NULL OR lower(v_ctx) <> p_gateway::text THEN
    RAISE EXCEPTION 'Passerelle non autorisée' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO g FROM edge_gateway WHERE id = p_gateway;
  IF NOT FOUND OR g.status = 'REVOKED' THEN
    RAISE EXCEPTION 'Passerelle non autorisée' USING ERRCODE = '42501';
  END IF;
  PERFORM assert_tenant(g.operator_id);
  IF p_primary AND g.role <> 'PRIMARY' THEN
    RAISE EXCEPTION 'Passerelle non autorisée' USING ERRCODE = '42501';
  END IF;
  RETURN g;
END $$;

-- Handover de CETTE passerelle (et de ce prestataire), verrouillé. Inconnu ou étranger : même erreur, même message.
CREATE FUNCTION edge_lock_handover(p_gateway uuid, p_handover uuid) RETURNS debit_authority_handover
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE g edge_gateway%ROWTYPE; h debit_authority_handover%ROWTYPE;
BEGIN
  SELECT * INTO g FROM edge_gateway WHERE id = p_gateway;
  SELECT * INTO h FROM debit_authority_handover
   WHERE id = p_handover AND edge_gateway_id = p_gateway AND operator_id = g.operator_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bascule inconnue ou étrangère à cette passerelle' USING ERRCODE = 'CL013';
  END IF;
  PERFORM edge_event_lock(g.event_id);
  PERFORM pg_advisory_xact_lock(hashtextextended('debit-authority:' || h.ledger_id, 0));
  SELECT * INTO h FROM debit_authority_handover WHERE id = p_handover FOR UPDATE;
  RETURN h;
END $$;

-- 3. Enveloppes -----------------------------------------------------------------------------------------------------
-- État de l'autorité de débit d'un grand livre. lan_url vient de la passerelle désignée, nul sous CENTRAL.
CREATE FUNCTION get_debit_authority(p_ledger uuid)
RETURNS TABLE (ledger_id uuid, authority text, epoch bigint, edge_gateway_id uuid, lan_url text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
BEGIN
  PERFORM assert_tenant(tenant_of_ledger(p_ledger));
  RETURN QUERY
  SELECT l.id, l.debit_authority, l.authority_epoch::bigint,
         CASE WHEN l.debit_authority = 'EDGE' THEN l.edge_gateway_id END,
         CASE WHEN l.debit_authority = 'EDGE' THEN g.lan_url END
    FROM ledger l LEFT JOIN edge_gateway g ON g.id = l.edge_gateway_id
   WHERE l.id = p_ledger;
END $$;

-- Un handover au plus (A13), de CETTE passerelle seulement : (1) TO_CENTRAL ouvert ; (2) sinon le dernier TO_CENTRAL
-- FAILED du TO_EDGE actif ; (3) sinon le TO_EDGE GRANTED ou ACTIVE ; (4) sinon rien. Lecture permise à une STANDBY.
CREATE FUNCTION get_current_edge_handover(p_gateway uuid) RETURNS SETOF debit_authority_handover
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE g edge_gateway%ROWTYPE; h debit_authority_handover%ROWTYPE; te debit_authority_handover%ROWTYPE;
BEGIN
  g := edge_bind_gateway(p_gateway, false);
  SELECT * INTO h FROM debit_authority_handover d
   WHERE d.edge_gateway_id = p_gateway AND d.operator_id = g.operator_id AND d.direction = 'TO_CENTRAL'
     AND d.status IN ('RELEASE_REQUESTED','RELEASING');
  IF FOUND THEN RETURN NEXT h; RETURN; END IF;
  SELECT * INTO te FROM debit_authority_handover d
   WHERE d.edge_gateway_id = p_gateway AND d.operator_id = g.operator_id AND d.direction = 'TO_EDGE'
     AND d.status = 'ACTIVE';
  IF FOUND THEN
    SELECT * INTO h FROM debit_authority_handover d
     WHERE d.edge_handover_id = te.id AND d.direction = 'TO_CENTRAL' AND d.status = 'FAILED'
       AND d.edge_gateway_id = p_gateway
     ORDER BY d.requested_at DESC LIMIT 1;
    IF FOUND THEN RETURN NEXT h; ELSE RETURN NEXT te; END IF;
    RETURN;
  END IF;
  SELECT * INTO h FROM debit_authority_handover d
   WHERE d.edge_gateway_id = p_gateway AND d.operator_id = g.operator_id AND d.direction = 'TO_EDGE'
     AND d.status = 'GRANTED';
  IF FOUND THEN RETURN NEXT h; END IF;
  RETURN;
END $$;

-- Enveloppe HUMAINE (cashless_app) de grant_edge_authority : pas de app.gateway_id. Refus si une session de caisse du
-- grand livre est CLOSING ; le filigrane de référence est lu SOUS LE MÊME VERROU que l'accord (A03).
CREATE FUNCTION edge_grant_authority(p_ledger uuid, p_gateway uuid, p_actor uuid)
RETURNS debit_authority_handover
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_event uuid; h debit_authority_handover%ROWTYPE; w bigint;
BEGIN
  PERFORM assert_tenant(tenant_of_ledger(p_ledger));
  PERFORM assert_tenant(tenant_of_gateway(p_gateway));
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'Accord : acteur obligatoire' USING ERRCODE = 'CL001';
  END IF;
  SELECT event_id INTO v_event FROM edge_gateway WHERE id = p_gateway;
  PERFORM edge_event_lock(v_event);
  PERFORM pg_advisory_xact_lock(hashtextextended('debit-authority:' || p_ledger, 0));
  IF EXISTS (SELECT 1 FROM cash_session cs WHERE cs.ledger_id = p_ledger AND cs.status = 'CLOSING') THEN
    RAISE EXCEPTION 'Accord impossible : une session de caisse est en cours de fermeture' USING ERRCODE = 'CL013';
  END IF;
  h := grant_edge_authority(p_ledger, p_gateway, p_actor);
  SELECT max(c.change_seq) INTO w FROM edge_reference_change c WHERE c.ledger_id = p_ledger;
  IF w IS NULL THEN
    RAISE EXCEPTION 'Accord impossible : journal de référence vide, filigrane inconnu' USING ERRCODE = 'CL013';
  END IF;
  UPDATE debit_authority_handover SET reference_watermark_seq = w WHERE id = h.id RETURNING * INTO h;
  RETURN h;
END $$;

-- Accusé de la passerelle, idempotent (A17). Refus CL014 tant que la référence appliquée n'atteint pas le filigrane
-- (A03). À l'accusé réel, pose edge_seq_at_activation (dernier numéro du cycle précédent, A05).
CREATE FUNCTION edge_ack_handover(p_gateway uuid, p_handover uuid, p_epoch bigint, p_replicated bigint)
RETURNS debit_authority_handover
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE g edge_gateway%ROWTYPE; h debit_authority_handover%ROWTYPE; lg ledger%ROWTYPE;
BEGIN
  g := edge_bind_gateway(p_gateway, true);
  h := edge_lock_handover(p_gateway, p_handover);
  SELECT * INTO lg FROM ledger WHERE id = h.ledger_id;
  IF h.direction <> 'TO_EDGE' THEN
    RAISE EXCEPTION 'Bascule % dans l''état %', p_handover, h.status USING ERRCODE = 'CL013';
  END IF;
  IF h.status = 'ACTIVE' THEN
    IF p_epoch IS NOT DISTINCT FROM h.epoch::bigint AND lg.debit_authority = 'EDGE'
       AND lg.edge_gateway_id = p_gateway AND lg.authority_epoch = h.epoch THEN
      RETURN h;                                           -- réponse perdue puis rejouée : état courant, sans écriture
    END IF;
    RAISE EXCEPTION 'Époque % ≠ époque courante %', p_epoch, lg.authority_epoch USING ERRCODE = 'CL015';
  END IF;
  IF h.status IN ('COMPLETED','FORCED') AND h.edge_seq_at_activation IS NOT NULL THEN
    RAISE EXCEPTION 'Autorité déjà rendue au central (époque %)', lg.authority_epoch USING ERRCODE = 'CL015';
  END IF;
  IF h.status <> 'GRANTED' THEN
    RAISE EXCEPTION 'Bascule % dans l''état %', p_handover, h.status USING ERRCODE = 'CL013';
  END IF;
  IF p_epoch IS DISTINCT FROM h.epoch::bigint OR lg.authority_epoch <> h.epoch THEN
    RAISE EXCEPTION 'Époque % ≠ époque courante %', p_epoch, lg.authority_epoch USING ERRCODE = 'CL015';
  END IF;
  IF p_replicated IS NULL THEN
    RAISE EXCEPTION 'Accusé : position de réplication obligatoire' USING ERRCODE = 'CL001';
  END IF;
  IF h.reference_watermark_seq IS NULL THEN
    RAISE EXCEPTION 'Accusé impossible : filigrane de référence absent' USING ERRCODE = 'CL013';
  END IF;
  SELECT * INTO g FROM edge_gateway WHERE id = p_gateway FOR UPDATE;
  IF g.reference_applied_seq < h.reference_watermark_seq THEN
    RAISE EXCEPTION 'Référence en retard (% < filigrane %)', g.reference_applied_seq, h.reference_watermark_seq
      USING ERRCODE = 'CL014';
  END IF;
  PERFORM ack_edge_handover(h.id, h.epoch, p_replicated);
  UPDATE debit_authority_handover SET edge_seq_at_activation = g.contiguous_edge_seq
   WHERE id = h.id RETURNING * INTO h;
  RETURN h;
END $$;

-- Rendu, temps 1 : RELEASE_REQUESTED -> RELEASING. Rejouable. Le commit propre est fait par l'API (voir en-tête).
CREATE FUNCTION begin_edge_release(p_gateway uuid, p_handover uuid, p_epoch bigint, p_final_seq bigint,
                                   p_last_hash bytea, p_ops bigint)
RETURNS debit_authority_handover
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE h debit_authority_handover%ROWTYPE; lg ledger%ROWTYPE;
BEGIN
  PERFORM edge_bind_gateway(p_gateway, true);
  h := edge_lock_handover(p_gateway, p_handover);
  IF h.direction <> 'TO_CENTRAL' THEN
    RAISE EXCEPTION 'Bascule % dans l''état %', p_handover, h.status USING ERRCODE = 'CL013';
  END IF;
  SELECT * INTO lg FROM ledger WHERE id = h.ledger_id;
  IF p_epoch IS DISTINCT FROM h.epoch::bigint OR lg.authority_epoch <> h.epoch THEN
    RAISE EXCEPTION 'Époque % ≠ époque courante %', p_epoch, lg.authority_epoch USING ERRCODE = 'CL015';
  END IF;
  IF h.status = 'RELEASING' THEN RETURN h; END IF;       -- rejeu : sans effet
  IF h.status <> 'RELEASE_REQUESTED' THEN
    RAISE EXCEPTION 'Bascule % dans l''état %', p_handover, h.status USING ERRCODE = 'CL013';
  END IF;
  IF p_final_seq IS NULL OR p_final_seq < 0 OR p_ops IS NULL OR p_ops < 0
     OR p_last_hash IS NULL OR octet_length(p_last_hash) <> 32 THEN
    RAISE EXCEPTION 'Rendu : numéro final, compte et empreinte (32 octets) obligatoires' USING ERRCODE = 'CL001';
  END IF;
  UPDATE debit_authority_handover
     SET status = 'RELEASING', begun_releasing_at = now(), ops_count = p_ops,
         final_edge_seq = p_final_seq, last_chain_hash = p_last_hash
   WHERE id = h.id RETURNING * INTO h;
  RETURN h;
END $$;

-- Rendu, temps 2 : RELEASING -> COMPLETED. operations_count est un compte PAR CYCLE (A05) :
-- ops = final_edge_seq - edge_seq_at_activation du TO_EDGE lié.
CREATE FUNCTION edge_complete_release(p_gateway uuid, p_handover uuid, p_epoch bigint, p_final_seq bigint,
                                      p_last_hash bytea, p_ops bigint)
RETURNS debit_authority_handover
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE h debit_authority_handover%ROWTYPE; lg ledger%ROWTYPE; g edge_gateway%ROWTYPE; v_start bigint;
BEGIN
  PERFORM edge_bind_gateway(p_gateway, true);
  h := edge_lock_handover(p_gateway, p_handover);
  IF h.direction <> 'TO_CENTRAL' OR h.status <> 'RELEASING' THEN
    RAISE EXCEPTION 'Bascule % dans l''état % : le rendu doit être commencé', p_handover, h.status
      USING ERRCODE = 'CL013';
  END IF;
  SELECT * INTO lg FROM ledger WHERE id = h.ledger_id;
  IF p_epoch IS DISTINCT FROM h.epoch::bigint OR lg.authority_epoch <> h.epoch THEN
    RAISE EXCEPTION 'Époque % ≠ époque courante %', p_epoch, lg.authority_epoch USING ERRCODE = 'CL015';
  END IF;
  IF p_final_seq IS NULL OR p_ops IS NULL OR p_last_hash IS NULL OR octet_length(p_last_hash) <> 32 THEN
    RAISE EXCEPTION 'Rendu : numéro final, compte et empreinte (32 octets) obligatoires' USING ERRCODE = 'CL001';
  END IF;
  -- La déclaration finale est celle du début de rendu.
  IF p_final_seq <> h.final_edge_seq OR p_ops <> h.ops_count OR p_last_hash <> h.last_chain_hash THEN
    RAISE EXCEPTION 'Rendu : déclaration différente de celle du début de rendu' USING ERRCODE = 'CL017';
  END IF;
  SELECT t.edge_seq_at_activation INTO v_start FROM debit_authority_handover t
   WHERE t.id = h.edge_handover_id AND t.edge_gateway_id = h.edge_gateway_id;
  IF v_start IS NULL OR p_ops <> p_final_seq - v_start THEN
    RAISE EXCEPTION 'Rendu : compte d''opérations % ≠ % (numéro final % moins départ du cycle %)',
      p_ops, p_final_seq - v_start, p_final_seq, v_start USING ERRCODE = 'CL017';
  END IF;
  SELECT * INTO g FROM edge_gateway WHERE id = p_gateway FOR UPDATE;
  IF g.contiguous_edge_seq < p_final_seq THEN
    RAISE EXCEPTION 'Rendu incomplet : missing_edge_seqs=[%,%] (% manquants)', g.contiguous_edge_seq + 1,
      p_final_seq, p_final_seq - g.contiguous_edge_seq USING ERRCODE = 'CL014';
  END IF;
  RETURN complete_edge_release(h.id, h.epoch, p_final_seq, p_last_hash);   -- contrôle de chaîne (CL017) inclus
END $$;

-- Abandon du rendu (humaine, cashless_app) : l'autorité reste à la passerelle, le grand livre reste EDGE.
CREATE FUNCTION fail_edge_release(p_handover uuid, p_actor uuid) RETURNS debit_authority_handover
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_op uuid; v_event uuid; h debit_authority_handover%ROWTYPE;
BEGIN
  SELECT d.operator_id, g.event_id INTO v_op, v_event FROM debit_authority_handover d
    JOIN edge_gateway g ON g.id = d.edge_gateway_id WHERE d.id = p_handover;
  PERFORM assert_tenant(v_op);
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'Abandon : acteur obligatoire' USING ERRCODE = 'CL001';
  END IF;
  PERFORM edge_event_lock(v_event);
  SELECT * INTO h FROM debit_authority_handover WHERE id = p_handover;
  PERFORM pg_advisory_xact_lock(hashtextextended('debit-authority:' || h.ledger_id, 0));
  SELECT * INTO h FROM debit_authority_handover WHERE id = p_handover FOR UPDATE;
  IF h.direction <> 'TO_CENTRAL' OR h.status NOT IN ('RELEASE_REQUESTED','RELEASING') THEN
    RAISE EXCEPTION 'Bascule % dans l''état %', p_handover, h.status USING ERRCODE = 'CL013';
  END IF;
  UPDATE debit_authority_handover SET status = 'FAILED', reason = 'Rendu abandonné par ' || p_actor
   WHERE id = p_handover RETURNING * INTO h;
  RETURN h;
END $$;

-- Reprise forcée avec preuve d'approbation : demande APPROVED, action FORCE_CENTRAL_AUTHORITY, demandeur et valideur
-- distincts, jamais exécutée, du même prestataire et du même grand livre. Passage à EXECUTED : par l'API.
CREATE FUNCTION force_central_authority_approved(p_ledger uuid, p_approval uuid, p_reason text)
RETURNS debit_authority_handover
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_op uuid := tenant_of_ledger(p_ledger); r approval_request%ROWTYPE; v_event uuid;
BEGIN
  PERFORM assert_tenant(v_op);
  SELECT * INTO r FROM approval_request WHERE id = p_approval FOR UPDATE;
  IF NOT FOUND OR r.operator_id <> v_op OR r.action <> 'FORCE_CENTRAL_AUTHORITY' OR r.status <> 'APPROVED'
     OR r.target_id IS DISTINCT FROM p_ledger OR r.executed_tx_id IS NOT NULL
     OR r.decided_by IS NULL OR r.decided_by = r.requested_by THEN
    RAISE EXCEPTION 'Reprise forcée : approbation absente ou inutilisable' USING ERRCODE = '42501';
  END IF;
  SELECT l.scope_id INTO v_event FROM ledger l WHERE l.id = p_ledger AND l.scope_type = 'EVENT';
  IF v_event IS NOT NULL THEN PERFORM edge_event_lock(v_event); END IF;
  RETURN force_central_authority(p_ledger, r.requested_by, r.decided_by, p_reason);
END $$;

-- Rendus bloqués (maintenance, WP12 : alerte EDGE_RELEASE_STUCK). Tous prestataires : la fonction n'est accordée qu'au
-- rôle de maintenance (WP09) et ne renvoie que des handovers RELEASING commencés depuis plus de p_older.
CREATE FUNCTION edge_stuck_handovers(p_older interval) RETURNS SETOF debit_authority_handover
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF p_older IS NULL OR p_older < interval '0' THEN
    RAISE EXCEPTION 'Durée invalide' USING ERRCODE = 'CL001';
  END IF;
  RETURN QUERY SELECT d.* FROM debit_authority_handover d
   WHERE d.direction = 'TO_CENTRAL' AND d.status = 'RELEASING'
     AND d.begun_releasing_at IS NOT NULL AND d.begun_releasing_at < now() - p_older
   ORDER BY d.begun_releasing_at;
END $$;

-- 4. begin_cash_close : dernière définition (0040) + garde d'autorité -------------------------------------------------
-- Ajout unique : après les verrous de 0040 (terminal, session, solde), verrou d'autorité PARTAGÉ (comme post_transaction,
-- il se sérialise avec edge_grant_authority qui le prend en exclusif), puis refus (CL029, rendu 409 CONFLICT_STATE) si
-- le grand livre n'est pas CENTRAL ou si une bascule TO_EDGE/TO_CENTRAL est ouverte. Comportement nouveau hors /edge/*
-- (décision 6 du porteur, à consigner en WP25).
CREATE OR REPLACE FUNCTION begin_cash_close(p_session uuid, p_closer uuid)
RETURNS TABLE (cash_session_id uuid, cash_account_id uuid, account_code text, ledger_id uuid,
               event_id uuid, device_id uuid, counted_amount bigint, expected_amount bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE
  v_operator uuid := nullif(current_setting('app.operator_id', true), '')::uuid;
  s cash_session%ROWTYPE;
  v_counted bigint;
  v_expected bigint;
  v_code text;
  v_device uuid;
BEGIN
  IF v_operator IS NULL OR p_session IS NULL THEN
    RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found';
  END IF;
  -- a0. Terminal de la session, verrouillé EN PREMIER (ordre global : terminal d'abord).
  SELECT cs.device_id INTO v_device FROM cash_session cs
   WHERE cs.cash_session_id = p_session AND cs.operator_id = v_operator;
  IF NOT FOUND THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  PERFORM 1 FROM device d WHERE d.id = v_device FOR NO KEY UPDATE;
  -- a. Session du prestataire, verrouillée.
  SELECT * INTO s FROM cash_session cs
   WHERE cs.cash_session_id = p_session AND cs.operator_id = v_operator FOR NO KEY UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  IF s.status <> 'OPEN' THEN
    RAISE EXCEPTION 'Session de caisse non ouverte' USING ERRCODE = 'CL029';
  END IF;
  -- b. Fermeur SUPERVISOR de l'événement.
  IF p_closer IS NULL
     OR NOT cash_actor_allowed(v_operator, s.event_id, p_closer, ARRAY['SUPERVISOR']) THEN
    RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found';
  END IF;
  -- c. Au moins un comptage ; le fermeur n'en a fait aucun ; le dernier est retenu.
  SELECT c.counted_amount INTO v_counted FROM cash_session_count c
   WHERE c.cash_session_id = s.cash_session_id ORDER BY c.count_no DESC LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Fermeture : aucun comptage' USING ERRCODE = 'CL029';
  END IF;
  IF EXISTS (SELECT 1 FROM cash_session_count c
              WHERE c.cash_session_id = s.cash_session_id AND c.counted_by = p_closer) THEN
    RAISE EXCEPTION 'Fermeture : le fermeur a compté cette session' USING ERRCODE = 'CL041';
  END IF;
  -- d. Théorique = solde de la caisse lu sous verrou (après la session, jamais avant).
  INSERT INTO account_balance (account_id, operator_id) VALUES (s.cash_account_id, v_operator)
  ON CONFLICT (account_id) DO NOTHING;
  SELECT b.balance INTO v_expected FROM account_balance b
   WHERE b.account_id = s.cash_account_id FOR UPDATE;
  -- d2. NOUVEAU (WP04) : l'autorité de débit doit être au central, sans bascule ouverte. Lecture faite APRÈS la prise
  --     du verrou d'autorité (instruction distincte : elle voit une bascule validée entre-temps).
  PERFORM pg_advisory_xact_lock_shared(hashtextextended('debit-authority:' || s.ledger_id, 0));
  IF EXISTS (SELECT 1 FROM ledger l WHERE l.id = s.ledger_id AND l.debit_authority <> 'CENTRAL')
     OR EXISTS (SELECT 1 FROM debit_authority_handover h
                 WHERE h.ledger_id = s.ledger_id
                   AND h.status IN ('GRANTED','ACTIVE','RELEASE_REQUESTED','RELEASING')) THEN
    RAISE EXCEPTION 'Fermeture de caisse impossible : l''autorité de débit n''est pas au central'
      USING ERRCODE = 'CL029';
  END IF;
  -- e. Session -> CLOSING.
  UPDATE cash_session cs
     SET status = 'CLOSING', closed_by = p_closer, counted_amount = v_counted,
         expected_amount = v_expected
   WHERE cs.cash_session_id = s.cash_session_id AND cs.operator_id = v_operator;
  SELECT a.code INTO v_code FROM account a WHERE a.id = s.cash_account_id;
  RETURN QUERY SELECT s.cash_session_id, s.cash_account_id, v_code, s.ledger_id, s.event_id,
                      s.device_id, v_counted, v_expected;
END $$;

-- Droits : retrait à PUBLIC, aucun GRANT (WP09) ------------------------------------------------------------------------
REVOKE ALL ON FUNCTION edge_handover_notify() FROM PUBLIC;
REVOKE ALL ON FUNCTION edge_bind_gateway(uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION edge_lock_handover(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION get_debit_authority(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION get_current_edge_handover(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION edge_grant_authority(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION edge_ack_handover(uuid, uuid, bigint, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION begin_edge_release(uuid, uuid, bigint, bigint, bytea, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION edge_complete_release(uuid, uuid, bigint, bigint, bytea, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION fail_edge_release(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION force_central_authority_approved(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION edge_stuck_handovers(interval) FROM PUBLIC;
