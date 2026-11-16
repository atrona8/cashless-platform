-- Demandes de remboursement des festivaliers (mission 9a, lot WP01 ; SPECIFICATION S16, FR-001, FR-003, NFR-002).
-- Objet : la table `refund_request`, deux colonnes d'usage sur `otp_challenge`, deux fonctions SECURITY DEFINER
-- (prestataire d'une demande pour la route publique du titulaire ; promotion des demandes échues) et une garde
-- d'insertion. Numéro 0081 (R-11). Aucune route, aucun code d'erreur : le contrat d'API est inchangé.
--
-- Décisions :
--   * Une seule demande ouverte (AWAITING_HOLDER, REQUESTED, PROCESSING) par portefeuille, garantie par l'index
--     unique partiel `refund_request_one_open` (le nom est lu par l'API pour répondre 409 REFUND_ALREADY_OPEN).
--   * Statut et colonnes cohérents par CHECK (PAID sans référence, FAILED sans motif ni REVERSAL, etc. impossibles).
--   * RLS ENABLE + FORCE sur operator_id (modèle 0080) ; la RLS ne voit que operator_id, d'où la garde d'insertion
--     `refund_request_scope_guard` : portefeuille, grand livre, événement et festivalier doivent être du prestataire.
--   * Aucune transition d'état n'est gardée par la base : l'API ordonne les états (limite connue, à ne pas corriger ici).
-- Droits : post-roles.sql, section 11 (seul ce lot en accorde dans la mission).
-- Fonctions à faire relire : refund_request_operator, promote_due_refund_requests, refund_request_scope_guard.
-- Hypothèse existante (0022, OP-N87, comme otp_challenge_operator de 0080) : le propriétaire des fonctions
-- SECURITY DEFINER ignore la RLS forcée ; les nouvelles fonctions s'y alignent sans l'élargir.

-- 1. Table ----------------------------------------------------------------------------------------------------------
CREATE TABLE refund_request (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id             uuid NOT NULL REFERENCES party(id),
  ledger_id               uuid NOT NULL REFERENCES ledger(id),
  event_id                uuid NOT NULL REFERENCES event(id),
  wallet_id               uuid NOT NULL REFERENCES wallet(id),
  customer_id             uuid REFERENCES customer_identity(customer_id),
  -- Personnes du back-office : comme approval_request, sans clé étrangère.
  requested_by            uuid,
  method                  text NOT NULL CHECK (method IN ('WAVE', 'ORANGE_MONEY', 'BANK_TRANSFER')),
  msisdn                  text,
  iban                    text,
  new_number              boolean NOT NULL,
  status                  text NOT NULL CHECK (status IN ('AWAITING_HOLDER', 'REQUESTED', 'PROCESSING', 'PAID',
                            'FAILED', 'REJECTED', 'CANCELLED', 'BLOCKED')),
  estimated_amount        bigint NOT NULL CHECK (estimated_amount >= 0),
  fee                     bigint NOT NULL CHECK (fee >= 0),
  currency                char(3) NOT NULL,
  hold_until              timestamptz,
  extra_check_required    boolean NOT NULL DEFAULT false,
  holder_decision         text CHECK (holder_decision IN ('CONFIRM', 'BLOCK')),
  holder_decided_at       timestamptz,
  approval_request_id     uuid REFERENCES approval_request(id),
  approved_by             uuid,
  transaction_id          uuid REFERENCES journal_transaction(id),
  external_reference      text,
  failure_reason          text,
  reject_reason           text,
  reversal_transaction_id uuid REFERENCES journal_transaction(id),
  confirmed_by            uuid,
  confirmed_at            timestamptz,
  created_at              timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at              timestamptz NOT NULL DEFAULT clock_timestamp(),
  -- Invariants du contrat (data-model)
  CONSTRAINT refund_request_paid_ref CHECK (status <> 'PAID' OR length(btrim(coalesce(external_reference, ''))) > 0),
  CONSTRAINT refund_request_failed_fields CHECK (status <> 'FAILED'
    OR (length(btrim(coalesce(failure_reason, ''))) > 0 AND reversal_transaction_id IS NOT NULL)),
  CONSTRAINT refund_request_rejected_reason CHECK (status <> 'REJECTED'
    OR length(btrim(coalesce(reject_reason, ''))) > 0),
  CONSTRAINT refund_request_executed_fields CHECK (status NOT IN ('PROCESSING', 'PAID', 'FAILED')
    OR (transaction_id IS NOT NULL AND approved_by IS NOT NULL)),
  -- Resserrements (renforcements)
  CONSTRAINT refund_request_awaiting_hold CHECK (status <> 'AWAITING_HOLDER' OR hold_until IS NOT NULL),
  CONSTRAINT refund_request_blocked_decision CHECK (status <> 'BLOCKED'
    OR holder_decision IS NOT DISTINCT FROM 'BLOCK'),
  CONSTRAINT refund_request_decision_pair CHECK ((holder_decision IS NULL) = (holder_decided_at IS NULL)),
  CONSTRAINT refund_request_extra_check CHECK (NOT extra_check_required OR new_number),
  CONSTRAINT refund_request_mobile_msisdn CHECK (method NOT IN ('WAVE', 'ORANGE_MONEY')
    OR (msisdn IS NOT NULL AND msisdn ~ '^\+[1-9][0-9]{6,14}$')),
  CONSTRAINT refund_request_two_persons CHECK (requested_by IS NULL OR approved_by IS NULL
    OR requested_by <> approved_by)
);
-- FR-003, NFR-002 : une demande ouverte par portefeuille, garantie par la base (lue par l'API : WP04).
CREATE UNIQUE INDEX refund_request_one_open ON refund_request (wallet_id)
  WHERE status IN ('AWAITING_HOLDER', 'REQUESTED', 'PROCESSING');
CREATE INDEX refund_request_operator_list_idx ON refund_request (operator_id, event_id, status, created_at, id);
CREATE INDEX refund_request_customer_list_idx ON refund_request (customer_id, created_at, id);
CREATE INDEX refund_request_hold_idx ON refund_request (hold_until) WHERE status = 'AWAITING_HOLDER';
ALTER TABLE refund_request ENABLE ROW LEVEL SECURITY;
ALTER TABLE refund_request FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON refund_request
  USING (operator_id = current_setting('app.operator_id', true)::uuid)
  WITH CHECK (operator_id = current_setting('app.operator_id', true)::uuid);

-- Garde d'insertion : la RLS ne contrôle que operator_id et une clé étrangère lit hors RLS ; sans cette garde, une
-- session du prestataire A pourrait désigner le portefeuille, le grand livre, l'événement ou le festivalier de B.
CREATE FUNCTION refund_request_scope_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF tenant_of_wallet(NEW.wallet_id) IS DISTINCT FROM NEW.operator_id
     OR tenant_of_ledger(NEW.ledger_id) IS DISTINCT FROM NEW.operator_id
     OR tenant_of_event(NEW.event_id) IS DISTINCT FROM NEW.operator_id
     OR (NEW.customer_id IS NOT NULL
         AND (SELECT ci.operator_id FROM customer_identity ci WHERE ci.customer_id = NEW.customer_id)
             IS DISTINCT FROM NEW.operator_id) THEN
    RAISE EXCEPTION 'Demande de remboursement : portefeuille, grand livre, événement ou festivalier d''un autre prestataire'
      USING ERRCODE = 'CL001';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION refund_request_scope_guard() FROM PUBLIC;
CREATE TRIGGER refund_request_scope_guard BEFORE INSERT ON refund_request
  FOR EACH ROW EXECUTE FUNCTION refund_request_scope_guard();

-- 2. Usage d'un code à usage unique (R-05, points 3 à 5) --------------------------------------------------------------
-- Les défis existants valent LOGIN : aucune réécriture de ligne, la connexion n'est pas touchée.
ALTER TABLE otp_challenge
  ADD COLUMN purpose text NOT NULL DEFAULT 'LOGIN' CHECK (purpose IN ('LOGIN', 'REFUND_HOLDER')),
  ADD COLUMN subject_id uuid;
ALTER TABLE otp_challenge ADD CONSTRAINT otp_challenge_purpose_subject CHECK (
  (purpose = 'LOGIN' AND subject_id IS NULL) OR (purpose = 'REFUND_HOLDER' AND subject_id IS NOT NULL));
CREATE INDEX otp_challenge_purpose_idx ON otp_challenge (operator_id, phone, purpose, created_at);

-- 3. Fonctions ---------------------------------------------------------------------------------------------------------
-- Prestataire d'une demande (route publique du titulaire) : ne rend que l'identifiant, NULL si inconnue.
CREATE FUNCTION refund_request_operator(p_refund_request uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT operator_id FROM refund_request WHERE id = p_refund_request
$$;
REVOKE ALL ON FUNCTION refund_request_operator(uuid) FROM PUBLIC;

-- Promotion des demandes échues, tous prestataires, horloge de la base. Une échéance n'est pas une décision :
-- holder_decision reste nul. Idempotente. Le journal d'audit est alimenté par l'API, pas ici.
CREATE FUNCTION promote_due_refund_requests() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  n integer;
BEGIN
  UPDATE refund_request SET status = 'REQUESTED', updated_at = clock_timestamp()
   WHERE status = 'AWAITING_HOLDER' AND hold_until <= clock_timestamp();
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION promote_due_refund_requests() FROM PUBLIC;
