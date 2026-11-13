-- Migration 0060 : registre des décisions de la passerelle, lots d'idempotence, garde EDGE_SYNC
-- (mission passerelle-locale, lot WP05 ; FR-012, FR-013 ; contracts/interfaces.md § 1, § 2, § 7, § 12, § 13 ;
-- data-model A.5, A.6 invariants 2, 3, 5, 10 ; research R-06, R-08, R-09 ; constats A06, A10, A29).
--
-- Contenu :
--   1. edge_sync_registry : la contrainte d'`outcome` est remplacée pour admettre `VOID` (numéro consommé sans effet
--      comptable, y compris une ONLINE_REF sans écriture). La contrainte de colonne est TROUVEE PAR LE CATALOGUE
--      (auto-nommée par le kit : on ne devine pas son nom) ; son nom est conservé. Les deux CHECK existants
--      (transaction_id exigé pour ACCEPTED_WITH_SHORTFALL/DUPLICATE, interdit pour REJECTED) sont conservés tels quels.
--      Ajout (renforcement) : un `VOID` ne porte jamais de transaction_id. La table reste immuable. `WAIVED` n'est PAS
--      ajoutée.
--   2. edge_sync_batch (un lot de la passerelle, idempotent par batch_id = Idempotency-Key) et
--      edge_sync_batch_result (un résultat par edge_seq, immuable). Un seul lot en vol par passerelle (index unique
--      partiel). RLS `tenant_isolation` ENABLE + FORCE, operator_id.
--   3. Fonctions : edge_sync_batch_begin, edge_sync_batch_result, edge_sync_batch_finish, edge_record_seq (+ deux
--      aides : edge_assert_session_gateway, edge_ledger_of_gateway).
--   4. Garde EDGE_SYNC de post_transaction.
--
-- LOT ABANDONNE (A29). Un lot en vol (RECEIVED/PROCESSING) interrompu depuis plus de 15 minutes passe ABANDONED à
-- l'ouverture du suivant (même règle que le lot de terminal, SP §6.2-6). Ses résultats sont PARTIELS. La passerelle
-- renvoie le reste sous un NOUVEAU batch_id, avec edge_seq_from = premier numéro non enregistré (les numéros déjà
-- au registre sont rejoués à l'identique par record_edge_seq : `replayed`, sans effet). Rejouer le batch_id abandonné
-- rend l'état ABANDONED (already_done = false), jamais un résultat mémorisé.
--
-- GARDE EDGE_SYNC. `post_transaction` est SECURITY DEFINER : `current_user` y est le propriétaire quel que soit
-- l'appelant. On teste donc `session_user`, le rôle de la CONNEXION. Forme choisie : LISTE D'AUTORISATION, parce
-- qu'une liste de refus oublie le prochain rôle :
--     session_user = current_user      (connexion du propriétaire : migrations, outils, tests du kit
--                                       dont tests_grand_livre_cashless.sql:118, qui n'est pas modifié)
--  OU session_user = 'cashless_edge'   (les enveloppes edge_* de WP06/WP07, SECURITY DEFINER, appelées depuis la
--                                       connexion `cashless_edge`)
-- Tout autre rôle de connexion (dont `cashless_app`) est refusé pour la source EDGE_SYNC et pour elle seule. Si
-- `cashless_edge` n'existe pas (base sans 0058), la comparaison de noms ne correspond à aucune connexion : la garde
-- reste fermée (échec fermé). `SET ROLE` ne change pas session_user. Erreur : 42501 (insufficient_privilege), pas
-- CL006 qui se traduirait en `409 DEBIT_AUTHORITY_EDGE`, message trompeur pour un refus de droit.
-- Hors cette garde, le corps de post_transaction est IDENTIQUE à sa dernière définition (schéma de référence
-- l. 510-627, jamais remplacée depuis) ; seul le réglage `search_path = public, pg_temp` suit la règle de 0021.
-- Limite : un test pgTAP par SET ROLE ne prouve rien ; le test à connexion réelle `cashless_app` est celui de WP09.
--
-- Erreurs : 42501 (p_gateway différent de app.gateway_id) ; no_data_found (objet inconnu ou d'un autre prestataire) ;
-- CL001 paramètre incohérent ; CL002 batch_id ou résultat rejoué avec un contenu différent ; CL010 un autre lot est en
-- vol pour la passerelle ; CL013 passerelle révoquée/en attente/sans handover ; CL016 numéro non suivant (kit).
-- edge_sync_batch_finish est dans interfaces.md § 2 mais absent de data-model A.4 et de la liste de droits de
-- `cashless_edge` (A.1) : WP09 doit la lui accorder (interfaces.md § 12.5 le prévoit).
--
-- Aucun GRANT. Toutes les fonctions : SECURITY DEFINER, search_path = public, pg_temp, EXECUTE retiré à PUBLIC.
-- A faire relire par une personne (CLAUDE.md, règle 4) : post_transaction (garde), edge_record_seq, la contrainte
-- de registre remplacée.

-- 1. Registre : VOID --------------------------------------------------------------------------------------------
DO $$
DECLARE c record; n int := 0;
BEGIN
  FOR c IN
    SELECT con.conname
      FROM pg_constraint con
      JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attname = 'outcome'
     WHERE con.conrelid = 'edge_sync_registry'::regclass AND con.contype = 'c'
       AND con.conkey = ARRAY[a.attnum]
  LOOP
    EXECUTE format('ALTER TABLE edge_sync_registry DROP CONSTRAINT %I', c.conname);
    EXECUTE format($f$ALTER TABLE edge_sync_registry ADD CONSTRAINT %I
      CHECK (outcome IN ('ACCEPTED','ACCEPTED_WITH_SHORTFALL','DUPLICATE','REJECTED','VOID'))$f$, c.conname);
    n := n + 1;
  END LOOP;
  IF n <> 1 THEN
    RAISE EXCEPTION '0060 : % contrainte(s) de colonne sur edge_sync_registry.outcome, une seule attendue', n;
  END IF;
END $$;
ALTER TABLE edge_sync_registry ADD CONSTRAINT edge_sync_registry_void_no_tx
  CHECK (outcome <> 'VOID' OR transaction_id IS NULL);

-- 2. Tables d'idempotence des lots -------------------------------------------------------------------------------
CREATE TABLE edge_sync_batch (
  batch_id        uuid PRIMARY KEY,                       -- = Idempotency-Key du POST
  operator_id     uuid NOT NULL REFERENCES party(id),
  gateway_id      uuid NOT NULL REFERENCES edge_gateway(id),
  ledger_id       uuid NOT NULL REFERENCES ledger(id),
  epoch           bigint NOT NULL CHECK (epoch >= 0),
  edge_seq_from   bigint NOT NULL CHECK (edge_seq_from >= 1),
  edge_seq_to     bigint NOT NULL,
  request_sha256  bytea NOT NULL CHECK (octet_length(request_sha256) = 32),
  status          text NOT NULL DEFAULT 'PROCESSING'
                  CHECK (status IN ('RECEIVED','PROCESSING','DONE','ABANDONED')),
  received_at     timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at    timestamptz,
  CHECK (edge_seq_to >= edge_seq_from AND edge_seq_to - edge_seq_from + 1 <= 500),
  CHECK ((status IN ('DONE','ABANDONED')) = (completed_at IS NOT NULL))
);
CREATE UNIQUE INDEX edge_sync_batch_one_in_flight ON edge_sync_batch (gateway_id)
  WHERE status IN ('RECEIVED','PROCESSING');
CREATE INDEX edge_sync_batch_gateway_idx ON edge_sync_batch (gateway_id, edge_seq_from);

-- Un lot ne change que de statut, en vol vers DONE/ABANDONED, avec completed_at ; jamais supprimé.
CREATE FUNCTION edge_sync_batch_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'edge_sync_batch est immuable (DELETE)' USING ERRCODE = 'CL001';
  END IF;
  IF (NEW.batch_id, NEW.operator_id, NEW.gateway_id, NEW.ledger_id, NEW.epoch, NEW.edge_seq_from, NEW.edge_seq_to,
      NEW.request_sha256, NEW.received_at)
     IS DISTINCT FROM
     (OLD.batch_id, OLD.operator_id, OLD.gateway_id, OLD.ledger_id, OLD.epoch, OLD.edge_seq_from, OLD.edge_seq_to,
      OLD.request_sha256, OLD.received_at)
     OR OLD.status IN ('DONE','ABANDONED')
     OR NEW.status NOT IN ('DONE','ABANDONED') THEN
    RAISE EXCEPTION 'edge_sync_batch : seule la clôture d''un lot en vol est permise (% -> %)', OLD.status, NEW.status
      USING ERRCODE = 'CL001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER edge_sync_batch_guard BEFORE UPDATE OR DELETE ON edge_sync_batch
  FOR EACH ROW EXECUTE FUNCTION edge_sync_batch_guard();

CREATE TABLE edge_sync_batch_result (
  batch_id       uuid NOT NULL REFERENCES edge_sync_batch(batch_id),
  edge_seq       bigint NOT NULL CHECK (edge_seq >= 1),
  operator_id    uuid NOT NULL REFERENCES party(id),
  outcome        text NOT NULL CHECK (outcome IN ('ACCEPTED','ACCEPTED_WITH_SHORTFALL','DUPLICATE','REJECTED','VOID')),
  reason         text,
  detail         text,
  transaction_id uuid REFERENCES journal_transaction(id),
  retryable      boolean NOT NULL DEFAULT false,
  recorded_at    timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (batch_id, edge_seq),
  CHECK (outcome NOT IN ('REJECTED','VOID') OR transaction_id IS NULL)
);
CREATE TRIGGER edge_sync_batch_result_immutable BEFORE UPDATE OR DELETE ON edge_sync_batch_result
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['edge_sync_batch','edge_sync_batch_result'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
                     USING (operator_id = current_setting('app.operator_id', true)::uuid)$p$, t);
  END LOOP;
END $$;

-- 3. Fonctions ----------------------------------------------------------------------------------------------------
-- p_gateway doit être la passerelle de la session (app.gateway_id, posé par la garde mTLS) ; absent ou différent : 42501.
CREATE FUNCTION edge_assert_session_gateway(p_gateway uuid) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF p_gateway IS NULL OR nullif(current_setting('app.gateway_id', true), '') IS NULL
     OR p_gateway::text <> lower(current_setting('app.gateway_id', true)) THEN
    RAISE EXCEPTION 'Passerelle de la session différente de celle de l''appel' USING ERRCODE = '42501';
  END IF;
END $$;
REVOKE ALL ON FUNCTION edge_assert_session_gateway(uuid) FROM PUBLIC;

-- Grand livre de l'événement de la passerelle (ledger.scope_type = 'EVENT', scope_id = event_id).
CREATE FUNCTION edge_ledger_of_gateway(p_gateway uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT l.id FROM edge_gateway g JOIN ledger l ON l.scope_type = 'EVENT' AND l.scope_id = g.event_id
   WHERE g.id = p_gateway
$$;
REVOKE ALL ON FUNCTION edge_ledger_of_gateway(uuid) FROM PUBLIC;

CREATE FUNCTION edge_sync_batch_begin(p_gateway uuid, p_batch uuid, p_epoch bigint, p_from bigint, p_to bigint,
                                      p_request_sha256 bytea)
RETURNS TABLE (state text, already_done boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE g edge_gateway%ROWTYPE; b edge_sync_batch%ROWTYPE; lg uuid;
BEGIN
  PERFORM edge_assert_session_gateway(p_gateway);
  SELECT * INTO g FROM edge_gateway WHERE id = p_gateway;
  IF NOT FOUND THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  PERFORM assert_tenant(g.operator_id);
  IF p_batch IS NULL OR p_epoch IS NULL OR p_epoch < 0 OR p_from IS NULL OR p_to IS NULL OR p_from < 1
     OR p_to < p_from OR p_to - p_from + 1 > 500
     OR p_request_sha256 IS NULL OR octet_length(p_request_sha256) <> 32 THEN
    RAISE EXCEPTION 'Lot incohérent (intervalle de 1 à 500 numéros, empreinte de 32 octets)' USING ERRCODE = 'CL001';
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
  BEGIN
    INSERT INTO edge_sync_batch (batch_id, operator_id, gateway_id, ledger_id, epoch, edge_seq_from, edge_seq_to,
                                 request_sha256, status)
    VALUES (p_batch, g.operator_id, p_gateway, lg, p_epoch, p_from, p_to, p_request_sha256, 'PROCESSING');
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'Un autre lot est en cours pour la passerelle' USING ERRCODE = 'CL010';
  END;
  RETURN QUERY SELECT 'PROCESSING'::text, false;
END $$;
REVOKE ALL ON FUNCTION edge_sync_batch_begin(uuid, uuid, bigint, bigint, bigint, bytea) FROM PUBLIC;

CREATE FUNCTION edge_sync_batch_result(p_batch uuid, p_edge_seq bigint, p_outcome text, p_reason text, p_detail text,
                                       p_tx uuid, p_retryable boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE b edge_sync_batch%ROWTYPE; r edge_sync_batch_result%ROWTYPE;
BEGIN
  IF nullif(current_setting('app.gateway_id', true), '') IS NULL THEN
    RAISE EXCEPTION 'Aucune passerelle dans la session' USING ERRCODE = '42501';
  END IF;
  -- Lot inconnu ou d'une autre passerelle ou d'un autre prestataire : même erreur, aucun oracle.
  SELECT * INTO b FROM edge_sync_batch WHERE batch_id = p_batch
     AND gateway_id::text = lower(current_setting('app.gateway_id', true)) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  PERFORM assert_tenant(b.operator_id);
  IF p_edge_seq IS NULL OR p_edge_seq NOT BETWEEN b.edge_seq_from AND b.edge_seq_to THEN
    RAISE EXCEPTION 'edge_seq % hors de l''intervalle du lot', p_edge_seq USING ERRCODE = 'CL001';
  END IF;
  IF p_outcome IS NULL OR p_outcome NOT IN ('ACCEPTED','ACCEPTED_WITH_SHORTFALL','DUPLICATE','REJECTED','VOID') THEN
    RAISE EXCEPTION 'Issue inconnue' USING ERRCODE = 'CL001';
  END IF;
  IF p_tx IS NOT NULL THEN
    PERFORM assert_tenant((SELECT t.operator_id FROM journal_transaction t WHERE t.id = p_tx));
  END IF;
  SELECT * INTO r FROM edge_sync_batch_result WHERE batch_id = p_batch AND edge_seq = p_edge_seq;
  IF FOUND THEN
    IF (r.outcome, r.reason, r.detail, r.transaction_id, r.retryable)
       IS DISTINCT FROM (p_outcome, p_reason, p_detail, p_tx, coalesce(p_retryable, false)) THEN
      RAISE EXCEPTION 'Résultat du numéro % déjà enregistré avec un contenu différent', p_edge_seq USING ERRCODE = 'CL002';
    END IF;
    RETURN;
  END IF;
  IF b.status NOT IN ('RECEIVED','PROCESSING') THEN
    RAISE EXCEPTION 'Lot clos (%) : aucun résultat nouveau', b.status USING ERRCODE = 'CL001';
  END IF;
  INSERT INTO edge_sync_batch_result (batch_id, edge_seq, operator_id, outcome, reason, detail, transaction_id, retryable)
  VALUES (p_batch, p_edge_seq, b.operator_id, p_outcome, p_reason, p_detail, p_tx, coalesce(p_retryable, false));
END $$;
REVOKE ALL ON FUNCTION edge_sync_batch_result(uuid, bigint, text, text, text, uuid, boolean) FROM PUBLIC;

-- DONE exige un résultat pour chaque numéro du lot (aucun numéro consommé sans résultat de lot, invariant 10) ;
-- un lot partiel se clôt ABANDONED (A29).
CREATE FUNCTION edge_sync_batch_finish(p_batch uuid, p_status text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE b edge_sync_batch%ROWTYPE; n bigint;
BEGIN
  IF nullif(current_setting('app.gateway_id', true), '') IS NULL THEN
    RAISE EXCEPTION 'Aucune passerelle dans la session' USING ERRCODE = '42501';
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('DONE','ABANDONED') THEN
    RAISE EXCEPTION 'Statut de clôture : DONE ou ABANDONED' USING ERRCODE = 'CL001';
  END IF;
  SELECT * INTO b FROM edge_sync_batch WHERE batch_id = p_batch
     AND gateway_id::text = lower(current_setting('app.gateway_id', true)) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  PERFORM assert_tenant(b.operator_id);
  IF b.status = p_status THEN RETURN; END IF;
  IF b.status IN ('DONE','ABANDONED') THEN
    RAISE EXCEPTION 'Lot déjà clos (%)', b.status USING ERRCODE = 'CL001';
  END IF;
  IF p_status = 'DONE' THEN
    SELECT count(*) INTO n FROM edge_sync_batch_result WHERE batch_id = p_batch;
    IF n <> b.edge_seq_to - b.edge_seq_from + 1 THEN
      RAISE EXCEPTION 'Lot incomplet : % résultat(s) sur %', n, b.edge_seq_to - b.edge_seq_from + 1
        USING ERRCODE = 'CL001';
    END IF;
  END IF;
  UPDATE edge_sync_batch SET status = p_status, completed_at = clock_timestamp() WHERE batch_id = p_batch;
END $$;
REVOKE ALL ON FUNCTION edge_sync_batch_finish(uuid, text) FROM PUBLIC;

-- Enveloppe de record_edge_seq (S12, non modifiée). Ordre des verrous (C-012) : verrou consultatif PARTAGE de
-- l'événement (le même que prennent revoke/swap, en exclusif), puis la ligne de passerelle (dans record_edge_seq).
-- Autorisation (liste, pas de refus) : passerelle ni REVOKED ni STANDBY ET handover de CETTE passerelle pour SON
-- grand livre : TO_EDGE ACTIVE, ou TO_CENTRAL RELEASE_REQUESTED/RELEASING (la vidange).
CREATE FUNCTION edge_record_seq(p_gateway uuid, p_edge_seq bigint, p_origin_key text, p_content bytea,
                                p_outcome text, p_tx uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE g edge_gateway%ROWTYPE; lg uuid;
BEGIN
  PERFORM edge_assert_session_gateway(p_gateway);
  SELECT * INTO g FROM edge_gateway WHERE id = p_gateway;
  IF NOT FOUND THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  PERFORM assert_tenant(g.operator_id);
  PERFORM pg_advisory_xact_lock_shared(hashtextextended('edge-event:' || g.event_id, 0));
  SELECT * INTO g FROM edge_gateway WHERE id = p_gateway;   -- relue sous le verrou
  IF g.status = 'REVOKED' THEN
    RAISE EXCEPTION 'Passerelle révoquée' USING ERRCODE = 'CL013';
  END IF;
  IF g.role = 'STANDBY' THEN
    RAISE EXCEPTION 'Passerelle en attente (STANDBY)' USING ERRCODE = 'CL013';
  END IF;
  lg := edge_ledger_of_gateway(p_gateway);
  IF lg IS NULL OR NOT EXISTS (
       SELECT 1 FROM debit_authority_handover h
        WHERE h.edge_gateway_id = p_gateway AND h.ledger_id = lg
          AND ((h.direction = 'TO_EDGE' AND h.status = 'ACTIVE')
            OR (h.direction = 'TO_CENTRAL' AND h.status IN ('RELEASE_REQUESTED','RELEASING')))) THEN
    RAISE EXCEPTION 'Aucun handover actif de cette passerelle pour son grand livre' USING ERRCODE = 'CL013';
  END IF;
  PERFORM * FROM record_edge_seq(p_gateway, p_edge_seq, p_origin_key, p_content, p_outcome, p_tx, p_reason);
END $$;
REVOKE ALL ON FUNCTION edge_record_seq(uuid, bigint, text, bytea, text, uuid, text) FROM PUBLIC;

-- 4. Garde EDGE_SYNC de post_transaction -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION post_transaction(p_ledger uuid, p_type text, p_key text, p_occurred timestamptz,
                                 p_source text, p_lines jsonb, p_event uuid DEFAULT NULL,
                                 p_reverses uuid DEFAULT NULL, p_created_by uuid DEFAULT NULL,
                                 p_approved_by uuid DEFAULT NULL, p_config_version uuid DEFAULT NULL,
                                 p_device uuid DEFAULT NULL, p_media uuid DEFAULT NULL,
                                 p_metadata jsonb DEFAULT '{}')
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
-- Codes SQLSTATE propres (traduits un à un en ProblemCode par l'API, voir SPECIFICATION §5.7) :
--   CL001 VALIDATION_FAILED   CL002 IDEMPOTENCY_KEY_REUSED   CL003 LEDGER_LOCKED   CL004 EVENT_CLOSING
--   CL005 PERIOD_CLOSED       CL006 DEBIT_AUTHORITY_EDGE     CL007 INSUFFICIENT_FUNDS
--   CL008 WALLET_LIMIT_EXCEEDED (check_wallet_limits)        CL009 MONTHLY_TOPUP_LIMIT_EXCEEDED
DECLARE
  tx uuid; lg ledger%ROWTYPE; h text; existing_hash text;
  n int; s bigint; bad text; r record;
BEGIN
  PERFORM assert_tenant(tenant_of_ledger(p_ledger));   -- cloisonnement : l'objet doit appartenir au prestataire de la session
  -- Garde EDGE_SYNC (0060, liste d'autorisation sur la CONNEXION, voir l'en-tête de la migration) : échec fermé.
  IF p_source = 'EDGE_SYNC' AND NOT (session_user = current_user OR session_user = 'cashless_edge') THEN
    RAISE EXCEPTION 'Source EDGE_SYNC réservée aux enveloppes de la passerelle' USING ERRCODE = '42501';
  END IF;
  -- 1. Validation du contenu (avant tout verrou)
  SELECT count(*), coalesce(sum((l->>'amount')::bigint),0),
         bool_or((l->>'amount')::bigint = 0)::text
    INTO n, s, bad FROM jsonb_array_elements(p_lines) l;
  IF n < 2 OR s <> 0 OR bad = 'true' THEN
    RAISE EXCEPTION 'Lignes invalides : % lignes, somme %, montant nul : %', n, s, bad USING ERRCODE = 'CL001';
  END IF;
  -- Empreinte de la requête (revue 2, M7) : tout ce qui change le sens de l'écriture, pas seulement les lignes
  h := encode(sha256(convert_to(concat_ws('|', p_type, p_event, p_reverses, p_device, p_media, p_lines::text), 'UTF8')), 'hex');
  -- Verrou PARTAGÉ d'autorité de débit (en mémoire, compatible entre écritures concurrentes) :
  -- une bascule CENTRAL <-> EDGE (verrou exclusif) attend la fin des écritures en vol, et aucune ne démarre pendant.
  PERFORM pg_advisory_xact_lock_shared(hashtextextended('debit-authority:' || p_ledger, 0));

  -- 2. Idempotence, sûre en concurrence
  SELECT * INTO lg FROM ledger WHERE id = p_ledger;
  IF NOT FOUND THEN RAISE EXCEPTION 'Grand livre inconnu' USING ERRCODE = 'no_data_found'; END IF;
  INSERT INTO journal_transaction (operator_id, ledger_id, event_id, type, idempotency_key, request_hash,
                                   occurred_at, source, reverses_id, created_by, approved_by,
                                   config_version_id, device_id, media_id, metadata)
       VALUES (lg.operator_id, p_ledger, p_event, p_type, p_key, h,
               p_occurred, p_source, p_reverses, p_created_by, p_approved_by,
               p_config_version, p_device, p_media, coalesce(p_metadata, '{}'))
  ON CONFLICT (ledger_id, idempotency_key) DO NOTHING
  RETURNING id INTO tx;
  IF tx IS NULL THEN
    SELECT id, request_hash INTO tx, existing_hash
      FROM journal_transaction WHERE ledger_id = p_ledger AND idempotency_key = p_key;
    IF existing_hash <> h THEN
      RAISE EXCEPTION 'Clé % déjà utilisée avec un contenu différent', p_key USING ERRCODE = 'CL002';
    END IF;
    RETURN tx;                                      -- rejeu identique : on renvoie l'existant
  END IF;

  -- 3. État du grand livre et période
  -- Grand livre verrouillé : seules les réclamations tardives (casse réversible, ADR-67) sont acceptées, en
  -- back-office, jusqu'à late_claims_until : annulation de casse, apport du bénéficiaire, remboursement.
  IF lg.status = 'LOCKED' AND NOT (p_source = 'BACKOFFICE' AND p_type IN ('BREAKAGE_REVERSAL','ADJUSTMENT','WALLET_REFUND','CHARGEBACK')
                                   AND lg.late_claims_until IS NOT NULL AND clock_timestamp() <= lg.late_claims_until) THEN
    RAISE EXCEPTION 'Grand livre verrouillé' USING ERRCODE = 'CL003';
  END IF;
  IF lg.status = 'CLOSING' AND p_source = 'ONLINE' AND p_type IN ('TOPUP','TOPUP_CASH','PURCHASE') THEN
    RAISE EXCEPTION 'Événement en clôture : % refusé', p_type USING ERRCODE = 'CL004';
  END IF;
  IF lg.locked_until IS NOT NULL AND p_occurred <= lg.locked_until THEN
    RAISE EXCEPTION 'Période close jusqu''au %', lg.locked_until USING ERRCODE = 'CL005';
  END IF;
  -- Passerelle locale isolée : elle seule débite les portefeuilles ; le central n'accepte que les crédits
  IF lg.debit_authority = 'EDGE' AND p_source <> 'EDGE_SYNC' AND EXISTS (
       SELECT 1 FROM jsonb_array_elements(p_lines) l JOIN account a ON a.id = (l->>'account_id')::uuid
        WHERE (l->>'amount')::bigint > 0 AND a.purpose IN ('WALLET_PAID','WALLET_PROMO')) THEN
    RAISE EXCEPTION 'Débit de portefeuille refusé : autorité détenue par la passerelle locale' USING ERRCODE = 'CL006';
  END IF;

  -- 3b. Tous les comptes doivent appartenir au grand livre et être actifs
  SELECT string_agg(l->>'account_id', ', ') INTO bad
    FROM jsonb_array_elements(p_lines) l
    LEFT JOIN account a ON a.id = (l->>'account_id')::uuid AND a.ledger_id = p_ledger AND a.is_active
   WHERE a.id IS NULL;
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'Compte inconnu, inactif ou d''un autre grand livre : %', bad USING ERRCODE = 'CL001'; END IF;

  -- 3c. Annulation de casse et réclamations tardives : bornes (ADR-75, Q4). CL024 LATE_CLAIM_INVALID.
  IF p_type = 'BREAKAGE_REVERSAL' OR (lg.status = 'LOCKED' AND p_type IN ('ADJUSTMENT','WALLET_REFUND','CHARGEBACK')) THEN
    PERFORM check_late_claim(lg, p_type, p_lines);
  END IF;

  -- 4. Verrouillage des soldes dans un ordre stable (évite les interblocages)
  --    (les comptes "hot" sont exclus : ni cache, ni verrou)
  INSERT INTO account_balance (account_id, operator_id)
       SELECT DISTINCT a.id, lg.operator_id
         FROM jsonb_array_elements(p_lines) l JOIN account a ON a.id = (l->>'account_id')::uuid
        WHERE NOT a.hot
  ON CONFLICT (account_id) DO NOTHING;
  PERFORM 1 FROM account_balance
    WHERE account_id IN (SELECT (l->>'account_id')::uuid FROM jsonb_array_elements(p_lines) l)
    ORDER BY account_id FOR UPDATE;

  -- 5. Lignes, dans l'ordre fourni
  INSERT INTO posting (operator_id, ledger_id, transaction_id, line_no, account_id, amount, fee_rule_id, memo)
       SELECT lg.operator_id, p_ledger, tx, ord, (l->>'account_id')::uuid, (l->>'amount')::bigint,
              (l->>'fee_rule_id')::uuid, l->>'memo'
         FROM jsonb_array_elements(p_lines) WITH ORDINALITY AS t(l, ord);

  -- 6. Soldes en cache mis à jour par compte (montant agrégé) puis contrôle du sens
  FOR r IN
    WITH d AS (SELECT account_id, sum(amount) AS delta, max(id) AS last_id
                 FROM posting WHERE transaction_id = tx GROUP BY account_id)
    UPDATE account_balance ab SET balance = ab.balance + d.delta, last_posting_id = d.last_id
      FROM d WHERE ab.account_id = d.account_id
    RETURNING ab.account_id, ab.balance
  LOOP
    PERFORM 1 FROM account a
      WHERE a.id = r.account_id
        AND (a.allow_negative OR (a.normal_side = 'D' AND r.balance >= 0) OR (a.normal_side = 'C' AND r.balance <= 0));
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Solde interdit sur % (solde %)',
        (SELECT code FROM account WHERE id = r.account_id), r.balance USING ERRCODE = 'CL007';
    END IF;
  END LOOP;
  -- 7. Plafonds réglementaires sur les portefeuilles crédités (profil de législation du grand livre)
  PERFORM check_wallet_limits(p_ledger, tx, p_type, p_occurred);
  RETURN tx;
END $$;
