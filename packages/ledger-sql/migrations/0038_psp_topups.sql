-- Migration 0038 : recharges PSP et leur automate d'états, registre durable des notifications,
-- compteur des notifications refusées, contestations (chargebacks), blocage et déblocage de
-- portefeuille, extensions de listes fermées (mission recharges-caisses-psp, lot WP04 ; spec
-- FR-012, FR-013, FR-016 à FR-019, FR-024 à FR-027, NFR-001, C-009 ; data-model « psp_topup »,
-- « psp_event », « psp_webhook_rejection », « psp_chargeback » ; research R-11, R-12, R-14, R-20 ;
-- research-adversarial A2, A3, A4, A9, A11 à A14, A20, A22, A24, A25, A33 ; contracts/psp.md
-- règles 7 à 14).
--
-- Contenu :
--   1. Tables psp_topup, psp_event, psp_webhook_rejection, psp_chargeback (RLS activée et forcée
--      sauf mention), déclencheurs d'automate (psp_topup_transition_guard), d'ajout seul
--      (psp_event_guard), de plafond et d'immuabilité des contestations (psp_chargeback_cap,
--      psp_chargeback_guard).
--   2. Fonctions de recharge, de notification, de carte, de contestation (tableau ci-dessous).
--   3. Extensions : anomalie PSP_TOPUP_NOT_CREDITED, actions WALLET_UNBLOCK et CASH_DEPOSIT.
--
-- Toutes les fonctions sont SECURITY DEFINER, `search_path = public, pg_temp` (règle de 0021),
-- EXECUTE retiré à PUBLIC. AUCUN GRANT/REVOKE de table ici : accords et retraits sont posés par le
-- lot WP05 (post-roles.sql). Heure = clock_timestamp() partout (jamais now()).
--
-- Fonctions (rôle ; I = INTERNE, jamais accordée ; P = nomme le prestataire de la session, absent :
-- P0002 ; N = neutre, sans prestataire de session) :
--   psp_session_operator          I  prestataire de la session ou P0002
--   psp_key_prefix                I  moyen -> préfixe de clé d'écriture (wave, om, psp)
--   psp_topup_net_credited        I  net crédité au portefeuille par la transaction de la recharge
--   psp_complete_core             I  noyau commun de complete_psp_topup et complete_card_topup
--   psp_topup_replay_row          I  rejeu de create_psp_topup
--   create_psp_topup              P  crée une recharge PENDING (trois transactions courtes côté API)
--   mark_psp_topup_initiated      P  pose la référence du PSP (avant ou après un succès)
--   cancel_psp_topup              P  PENDING -> CANCELLED (après confirmation de l'adaptateur)
--   expire_psp_topups             P  PENDING échues -> EXPIRED
--   psp_poll_candidates           N  recharges PENDING à interroger (aucune colonne secrète)
--   record_psp_event              P  conserve une notification authentifiée (avant traitement, A4)
--   mark_psp_event                P  COMPLÉMENT : avance l'état d'une notification
--   psp_events_to_retry           N  COMPLÉMENT : notifications à reprendre (normalisées, sans corps)
--   purge_psp_event_bodies        N  COMPLÉMENT : vide les corps de plus de 365 jours (400 par défaut)
--   read_psp_event_body           P  lit un corps, ligne d'audit écrite dans la fonction
--   complete_psp_topup            P  crédite Wave / Orange Money (refuse CARD)
--   complete_card_topup           P  crédite une carte : 3-D Secure, empreinte, plafond du jour UTC
--   fail_psp_topup                P  échec ; anomalie unique par recharge si l'argent est encaissé
--   card_topups_today             P  somme du jour UTC pour une empreinte, sous verrou consultatif
--   wallet_card_count             P  empreintes distinctes d'un portefeuille (vélocité, FR-026)
--   record_webhook_rejection      N  compteur des notifications refusées (aucune donnée de requête)
--   record_chargeback             P  enregistre une contestation (plafond sur le net crédité)
--   attach_chargeback_tx          P  COMPLÉMENT : rattache l'écriture CHARGEBACK
--   block_wallet_after_chargeback P  ACTIVE -> BLOCKED, idempotent
--   unblock_wallet                P  BLOCKED -> ACTIVE par demande WALLET_UNBLOCK à deux personnes
--
-- Automate de psp_topup (tableau du data-model, R-20 / A3 fait foi) :
--   PENDING   -> SUCCEEDED | FAILED | EXPIRED | CANCELLED
--   FAILED | EXPIRED | CANCELLED -> SUCCEEDED   (succès tardif authentifié : crédite si recevable,
--                                                  ferme l'anomalie, vide anomaly_id)
--   SUCCEEDED est définitif ; toute autre transition : CL029. Un succès sur CANCELLED est donc
--   crédité (R-20) ; le contrat psp.md règle 9 le traitait comme non crédité : R-20 prime.
--
-- Hypothèse sur le propriétaire (à faire relire par une personne) : comme 0019, 0020, 0022 et 0037,
-- aucune fonction ne s'appuie sur la RLS pour se protéger : chaque lecture et chaque écriture nomme
-- le prestataire de la session (`app.operator_id`, absent : P0002). Les fonctions NEUTRES
-- (psp_poll_candidates, psp_events_to_retry, purge_psp_event_bodies, record_webhook_rejection) et
-- les déclencheurs DEFINER supposent un propriétaire qui IGNORE la RLS (superutilisateur du poste
-- local). Avec un propriétaire soumis à la RLS, l'échec est FERMÉ : aucune ligne n'est lue ni
-- écrite.
--
-- Erreurs (traduites par apps/api/src/errors/sqlstate-map.ts ; CL043 et CL044 sont à ajouter par le
-- lot WP07, pas ici) :
--   CL001   paramètre invalide, contrainte violée, carte refusée (3-D Secure, empreinte), transaction
--           qui ne correspond pas -> 422 VALIDATION_FAILED
--   CL004   grand livre qui n'accepte plus (EVENT_CLOSING)
--   CL023   demande d'approbation absente de la règle, rejouée, mal décidée -> 409 APPROVAL_INVALID
--   CL029   état incompatible (transition, plafond carte, trop de recharges en attente, rejeu avec
--           un autre contenu) -> 409 CONFLICT_STATE
--   CL039   portefeuille non ACTIVE (WALLET_BLOCKED ; mappé 422 aujourd'hui, le contrat veut 409 :
--           WP11 contrôle le statut avant d'appeler la base)
--   CL042   aucune configuration utilisable (WP03)
--   CL043   NOUVEAU : contestation au-delà du montant net restant crédité -> 409
--   CL044   NOUVEAU : contestation non permise (recharge non SUCCEEDED, non carte, sans transaction,
--           autre portefeuille) -> 409
--   P0002   objet introuvable, d'un autre prestataire ou hors du périmètre -> 404
--
-- Jour du plafond par carte : jour civil UTC (R-20 prime sur « jour civil de l'événement », R-11).
-- Clés d'écriture (C-009, qualifiées par la configuration, A31) : wave:<config>:<paiement>,
-- om:<config>:<paiement>, psp:<config>:<paiement> ; contestation psp:<config>:<identifiant de la
-- contestation chez le PSP>. La base les vérifie à la complétion et au rattachement.

-- 1. Tables ---------------------------------------------------------------------------------------
CREATE TABLE psp_topup (
  psp_topup_id         uuid PRIMARY KEY,
  operator_id          uuid NOT NULL REFERENCES party(id),
  ledger_id            uuid NOT NULL REFERENCES ledger(id),
  event_id             uuid NOT NULL REFERENCES event(id),
  wallet_id            uuid NOT NULL REFERENCES wallet(id),
  psp_configuration_id uuid NOT NULL REFERENCES psp_configuration(psp_configuration_id),
  method               text NOT NULL,
  provider             text NOT NULL,
  amount               bigint NOT NULL,
  currency             char(3) NOT NULL,
  fee_amount           bigint,
  status               text NOT NULL DEFAULT 'PENDING',
  provider_payment_ref text,
  expires_at           timestamptz NOT NULL,
  requested_by_kind    text NOT NULL,
  device_id            uuid REFERENCES device(id),
  person_id            uuid REFERENCES app_user(id),
  customer_id          uuid REFERENCES party(id),
  card_fingerprint     text,
  three_ds             text,
  topup_tx_id          uuid REFERENCES journal_transaction(id),
  failure_reason       text,
  anomaly_id           uuid REFERENCES anomaly(id),
  created_at           timestamptz NOT NULL DEFAULT clock_timestamp(),
  succeeded_at         timestamptz,
  CONSTRAINT psp_topup_method CHECK (method IN ('WAVE','ORANGE_MONEY','CARD')),
  CONSTRAINT psp_topup_amount CHECK (amount > 0),
  CONSTRAINT psp_topup_status
    CHECK (status IN ('PENDING','SUCCEEDED','FAILED','EXPIRED','CANCELLED')),
  CONSTRAINT psp_topup_requested_by_kind CHECK (requested_by_kind IN ('DESK','CUSTOMER')),
  CONSTRAINT psp_topup_desk_actor
    CHECK ((requested_by_kind = 'DESK') = (device_id IS NOT NULL AND person_id IS NOT NULL)),
  CONSTRAINT psp_topup_customer_actor
    CHECK ((requested_by_kind = 'CUSTOMER') = (customer_id IS NOT NULL)),
  CONSTRAINT psp_topup_customer_no_device
    CHECK (requested_by_kind = 'DESK' OR (device_id IS NULL AND person_id IS NULL)),
  -- A13 : le statut SUCCEEDED et la transaction de crédit vont ensemble, quel que soit l'écrivain.
  CONSTRAINT psp_topup_status_credit CHECK ((status = 'SUCCEEDED') = (topup_tx_id IS NOT NULL)),
  CONSTRAINT psp_topup_succeeded_shape CHECK (
    status <> 'SUCCEEDED' OR (anomaly_id IS NULL AND failure_reason IS NULL
                              AND succeeded_at IS NOT NULL AND fee_amount IS NOT NULL)),
  CONSTRAINT psp_topup_failure_reason_presence
    CHECK ((status IN ('PENDING','SUCCEEDED')) = (failure_reason IS NULL)),
  CONSTRAINT psp_topup_failure_reason CHECK (failure_reason IS NULL OR failure_reason IN (
    'THREE_DS','NO_FINGERPRINT','CARD_DAILY_LIMIT','LEDGER_STATUS','WALLET_LIMIT','MONTHLY_LIMIT',
    'WALLET_BLOCKED','PERIOD_CLOSED','DEBIT_AUTHORITY_EDGE','FEES_EXCEED_AMOUNT','ACCOUNT_INACTIVE',
    'PSP_FAILED','EXPIRED','CANCELLED')),
  CONSTRAINT psp_topup_three_ds
    CHECK (three_ds IS NULL OR three_ds IN ('SUCCEEDED','FAILED','NOT_PERFORMED')),
  CONSTRAINT psp_topup_card_only
    CHECK (method = 'CARD' OR (card_fingerprint IS NULL AND three_ds IS NULL)),
  -- Une carte créditée a un 3-D Secure réussi et une empreinte, même en écriture directe.
  CONSTRAINT psp_topup_card_credit CHECK (
    NOT (method = 'CARD' AND status = 'SUCCEEDED')
    OR (three_ds = 'SUCCEEDED' AND card_fingerprint IS NOT NULL AND card_fingerprint <> '')),
  CONSTRAINT psp_topup_fee CHECK (fee_amount IS NULL OR (fee_amount >= 0 AND fee_amount < amount)),
  CONSTRAINT psp_topup_fee_only_credited CHECK (status = 'SUCCEEDED' OR fee_amount IS NULL),
  CONSTRAINT psp_topup_expires CHECK (expires_at > created_at)
);
-- Une référence de paiement n'existe qu'une fois par configuration (A2, A31).
CREATE UNIQUE INDEX psp_topup_payment_ref ON psp_topup (psp_configuration_id, provider_payment_ref)
  WHERE provider_payment_ref IS NOT NULL;
-- Une transaction de crédit ne sert qu'une recharge : aucun double crédit par deux recharges.
CREATE UNIQUE INDEX psp_topup_one_tx ON psp_topup (topup_tx_id) WHERE topup_tx_id IS NOT NULL;
CREATE INDEX psp_topup_wallet_pending ON psp_topup (wallet_id) WHERE status = 'PENDING';
CREATE INDEX psp_topup_device_pending ON psp_topup (device_id) WHERE status = 'PENDING';
CREATE INDEX psp_topup_poll ON psp_topup (status, created_at) WHERE status = 'PENDING';
CREATE INDEX psp_topup_card_day ON psp_topup (ledger_id, card_fingerprint) WHERE status = 'SUCCEEDED';

-- Automate (A3, A13) et colonnes figées. SUCCEEDED définitif : seule la référence du PSP, si elle
-- n'était pas posée, peut encore arriver (notification reçue avant la fin de l'initiation, A2).
CREATE FUNCTION psp_topup_transition_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Recharge PSP : suppression interdite' USING ERRCODE = 'CL001';
  END IF;
  IF (NEW.operator_id, NEW.ledger_id, NEW.event_id, NEW.wallet_id, NEW.psp_configuration_id,
      NEW.method, NEW.provider, NEW.amount, NEW.currency, NEW.requested_by_kind, NEW.device_id,
      NEW.person_id, NEW.customer_id, NEW.created_at)
     IS DISTINCT FROM
     (OLD.operator_id, OLD.ledger_id, OLD.event_id, OLD.wallet_id, OLD.psp_configuration_id,
      OLD.method, OLD.provider, OLD.amount, OLD.currency, OLD.requested_by_kind, OLD.device_id,
      OLD.person_id, OLD.customer_id, OLD.created_at) THEN
    RAISE EXCEPTION 'Recharge PSP : colonne d''identité non modifiable' USING ERRCODE = 'CL001';
  END IF;
  IF OLD.provider_payment_ref IS NOT NULL
     AND NEW.provider_payment_ref IS DISTINCT FROM OLD.provider_payment_ref THEN
    RAISE EXCEPTION 'Recharge PSP : la référence du PSP ne change plus' USING ERRCODE = 'CL029';
  END IF;
  IF OLD.status = 'SUCCEEDED'
     AND (to_jsonb(NEW) - 'provider_payment_ref') IS DISTINCT FROM
         (to_jsonb(OLD) - 'provider_payment_ref') THEN
    RAISE EXCEPTION 'Recharge PSP : SUCCEEDED est définitif' USING ERRCODE = 'CL029';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status
     AND (OLD.status, NEW.status) NOT IN (
       ('PENDING','SUCCEEDED'), ('PENDING','FAILED'), ('PENDING','EXPIRED'),
       ('PENDING','CANCELLED'), ('FAILED','SUCCEEDED'), ('EXPIRED','SUCCEEDED'),
       ('CANCELLED','SUCCEEDED')) THEN
    RAISE EXCEPTION 'Recharge PSP : passage % -> % interdit', OLD.status, NEW.status
      USING ERRCODE = 'CL029';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION psp_topup_transition_guard() FROM PUBLIC;
CREATE TRIGGER psp_topup_transition_guard BEFORE UPDATE OR DELETE ON psp_topup
  FOR EACH ROW EXECUTE FUNCTION psp_topup_transition_guard();

-- Notifications authentifiées, conservées AVANT tout traitement (A4). Ajout seul sauf les colonnes
-- de traitement ; le corps brut ne se vide que par la purge (A24).
CREATE TABLE psp_event (
  psp_event_id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id          uuid NOT NULL REFERENCES party(id),
  psp_configuration_id uuid NOT NULL REFERENCES psp_configuration(psp_configuration_id),
  provider_event_id    text NOT NULL,
  received_at          timestamptz NOT NULL DEFAULT clock_timestamp(),
  body                 bytea,
  body_purged_at       timestamptz,
  signature_valid      boolean NOT NULL DEFAULT true CONSTRAINT psp_event_signature_valid
                       CHECK (signature_valid),
  kind                 text NOT NULL,
  status               text NOT NULL DEFAULT 'RECEIVED',
  attempts             int NOT NULL DEFAULT 0,
  processed_at         timestamptz,
  outcome              text,
  psp_topup_id         uuid REFERENCES psp_topup(psp_topup_id),
  normalized           jsonb NOT NULL,
  CONSTRAINT psp_event_provider_event_id
    CHECK (length(provider_event_id) BETWEEN 1 AND 200),
  CONSTRAINT psp_event_body_size CHECK (body IS NULL OR octet_length(body) <= 65536),
  CONSTRAINT psp_event_kind CHECK (kind IN (
    'PAYMENT_SUCCEEDED','PAYMENT_FAILED','PAYMENT_CANCELLED','DISPUTE','UNKNOWN')),
  CONSTRAINT psp_event_status CHECK (status IN ('RECEIVED','PROCESSED','UNMATCHED','RETRY')),
  CONSTRAINT psp_event_attempts CHECK (attempts >= 0),
  CONSTRAINT psp_event_outcome CHECK (outcome IS NULL OR outcome IN (
    'CREDITED','NOT_CREDITED','MISMATCH','DUPLICATE_PAYMENT','CHARGEBACK','NO_EFFECT')),
  CONSTRAINT psp_event_processed_shape CHECK (
    (status = 'PROCESSED') = (outcome IS NOT NULL)
    AND (status = 'PROCESSED') = (processed_at IS NOT NULL)),
  CONSTRAINT psp_event_normalized
    CHECK (jsonb_typeof(normalized) = 'object' AND pg_column_size(normalized) <= 8192),
  CONSTRAINT psp_event_purge_shape CHECK (body IS NOT NULL OR body_purged_at IS NOT NULL
                                          OR body IS NULL),
  CONSTRAINT psp_event_unique UNIQUE (psp_configuration_id, provider_event_id)
);
CREATE INDEX psp_event_status_idx ON psp_event (status, received_at);
CREATE INDEX psp_event_body_idx ON psp_event (received_at) WHERE body IS NOT NULL;

CREATE FUNCTION psp_event_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_cols text[] := ARRAY['status','attempts','processed_at','outcome','psp_topup_id','body',
                         'body_purged_at'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Notification PSP : suppression interdite' USING ERRCODE = 'CL001';
  END IF;
  IF (to_jsonb(NEW) - v_cols) IS DISTINCT FROM (to_jsonb(OLD) - v_cols) THEN
    RAISE EXCEPTION 'Notification PSP : ajout seul (identité non modifiable)' USING ERRCODE = 'CL001';
  END IF;
  IF NEW.body IS DISTINCT FROM OLD.body AND (NEW.body IS NOT NULL OR NEW.body_purged_at IS NULL) THEN
    RAISE EXCEPTION 'Notification PSP : le corps ne se vide que par la purge' USING ERRCODE = 'CL001';
  END IF;
  IF OLD.status = 'PROCESSED'
     AND (NEW.status, NEW.outcome, NEW.processed_at, NEW.psp_topup_id, NEW.attempts)
         IS DISTINCT FROM
         (OLD.status, OLD.outcome, OLD.processed_at, OLD.psp_topup_id, OLD.attempts) THEN
    RAISE EXCEPTION 'Notification PSP : PROCESSED est définitif' USING ERRCODE = 'CL029';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION psp_event_guard() FROM PUBLIC;
CREATE TRIGGER psp_event_guard BEFORE UPDATE OR DELETE ON psp_event
  FOR EACH ROW EXECUTE FUNCTION psp_event_guard();

-- Compteur des notifications refusées (A22) : aucune donnée de la requête. Borne : configurations
-- x motifs x minutes. Seul record_webhook_rejection écrit (aucune politique d'écriture).
CREATE TABLE psp_webhook_rejection (
  config_key           uuid NOT NULL,
  psp_configuration_id uuid,
  operator_id          uuid,
  reason               text NOT NULL,
  minute               timestamptz NOT NULL,
  count                int NOT NULL,
  PRIMARY KEY (config_key, reason, minute),
  CONSTRAINT psp_webhook_rejection_reason CHECK (reason IN (
    'BODY_TOO_LARGE','UNKNOWN_CONFIG','CONFIG_NOT_ACTIVE','PROVIDER_MISMATCH','SECRET_UNAVAILABLE',
    'SIGNATURE_MISSING','SIGNATURE_MALFORMED','SIGNATURE_INVALID','TIMESTAMP_OUT_OF_TOLERANCE',
    'BODY_MALFORMED')),
  CONSTRAINT psp_webhook_rejection_count CHECK (count >= 1),
  CONSTRAINT psp_webhook_rejection_unknown CHECK (
    (config_key = '00000000-0000-0000-0000-000000000000')
    = (psp_configuration_id IS NULL AND operator_id IS NULL))
);
CREATE INDEX psp_webhook_rejection_minute_idx ON psp_webhook_rejection (minute);

-- Contestations (A14). Le montant est cumulé sur le NET crédité, jamais sur le brut.
CREATE TABLE psp_chargeback (
  psp_chargeback_id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id          uuid NOT NULL REFERENCES party(id),
  psp_configuration_id uuid NOT NULL REFERENCES psp_configuration(psp_configuration_id),
  provider_dispute_id  text NOT NULL,
  psp_topup_id         uuid NOT NULL REFERENCES psp_topup(psp_topup_id),
  amount               bigint NOT NULL,
  chargeback_tx_id     uuid REFERENCES journal_transaction(id),
  wallet_blocked       boolean NOT NULL DEFAULT false,
  late                 boolean NOT NULL DEFAULT false,
  anomaly_id           uuid REFERENCES anomaly(id),
  unblocked_by_request uuid,
  created_at           timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT psp_chargeback_amount CHECK (amount > 0),
  CONSTRAINT psp_chargeback_dispute_id CHECK (length(provider_dispute_id) BETWEEN 1 AND 200),
  CONSTRAINT psp_chargeback_late_anomaly CHECK (NOT late OR anomaly_id IS NOT NULL),
  CONSTRAINT psp_chargeback_unique UNIQUE (psp_configuration_id, provider_dispute_id)
);
CREATE UNIQUE INDEX psp_chargeback_one_tx ON psp_chargeback (chargeback_tx_id)
  WHERE chargeback_tx_id IS NOT NULL;
CREATE INDEX psp_chargeback_topup_idx ON psp_chargeback (psp_topup_id);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['psp_topup','psp_event','psp_chargeback'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
                     USING (operator_id = current_setting('app.operator_id', true)::uuid)
                     WITH CHECK (operator_id = current_setting('app.operator_id', true)::uuid)$p$,
                   t);
  END LOOP;
END $$;
ALTER TABLE psp_webhook_rejection ENABLE ROW LEVEL SECURITY;
ALTER TABLE psp_webhook_rejection FORCE ROW LEVEL SECURITY;
CREATE POLICY rejection_read ON psp_webhook_rejection FOR SELECT
  USING (operator_id IS NULL OR operator_id = current_setting('app.operator_id', true)::uuid);

-- 2. Fonctions internes ---------------------------------------------------------------------------
CREATE FUNCTION psp_session_operator() RETURNS uuid
LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $$
DECLARE v uuid := nullif(current_setting('app.operator_id', true), '')::uuid;
BEGIN
  IF v IS NULL THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  RETURN v;
END $$;
REVOKE ALL ON FUNCTION psp_session_operator() FROM PUBLIC;

CREATE FUNCTION psp_key_prefix(p_method text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT CASE p_method WHEN 'WAVE' THEN 'wave' WHEN 'ORANGE_MONEY' THEN 'om' ELSE 'psp' END
$$;
REVOKE ALL ON FUNCTION psp_key_prefix(text) FROM PUBLIC;

-- Net crédité au portefeuille de la recharge par sa transaction de crédit (R-20, A14).
CREATE FUNCTION psp_topup_net_credited(p_topup uuid) RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce(-sum(p.amount), 0)::bigint
    FROM psp_topup t
    JOIN posting p ON p.transaction_id = t.topup_tx_id
    JOIN account a ON a.id = p.account_id AND a.purpose = 'WALLET_PAID' AND a.wallet_id = t.wallet_id
   WHERE t.psp_topup_id = p_topup
$$;
REVOKE ALL ON FUNCTION psp_topup_net_credited(uuid) FROM PUBLIC;

-- 3. Création, initiation, annulation, expiration, interrogation (T018) ---------------------------
-- Rejeu de create_psp_topup : la ligne si elle existe avec le même contenu, NULL sinon ; un autre
-- contenu ou un autre prestataire : CL029 (sans révéler l'existence).
CREATE FUNCTION psp_topup_replay_row(p_id uuid, p_wallet uuid, p_method text, p_amount bigint,
                                     p_kind text) RETURNS psp_topup
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_operator uuid := psp_session_operator();
  t psp_topup%ROWTYPE;
BEGIN
  SELECT * INTO t FROM psp_topup x WHERE x.psp_topup_id = p_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF t.operator_id <> v_operator OR t.wallet_id IS DISTINCT FROM p_wallet
     OR t.method IS DISTINCT FROM p_method OR t.amount IS DISTINCT FROM p_amount
     OR t.requested_by_kind IS DISTINCT FROM p_kind THEN
    RAISE EXCEPTION 'Recharge PSP : identifiant déjà utilisé avec un autre contenu'
      USING ERRCODE = 'CL029';
  END IF;
  RETURN t;
END $$;
REVOKE ALL ON FUNCTION psp_topup_replay_row(uuid, uuid, text, bigint, text) FROM PUBLIC;

CREATE FUNCTION create_psp_topup(p_psp_topup uuid, p_wallet uuid, p_method text, p_amount bigint,
                                 p_kind text, p_device uuid, p_person uuid, p_customer uuid,
                                 p_expires_at timestamptz)
RETURNS TABLE (psp_topup_id uuid, psp_configuration_id uuid, provider text, expires_at timestamptz,
               replayed boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE
  v_operator uuid := psp_session_operator();
  v_now timestamptz := clock_timestamp();
  t psp_topup%ROWTYPE;
  w wallet%ROWTYPE;
  lg ledger%ROWTYPE;
  c record;
BEGIN
  IF p_psp_topup IS NULL THEN
    RAISE EXCEPTION 'Recharge PSP : identifiant obligatoire' USING ERRCODE = 'CL001';
  END IF;
  -- 0. Rejeu avant tout autre contrôle (aucune écriture, aucun contrôle de bornes).
  t := psp_topup_replay_row(p_psp_topup, p_wallet, p_method, p_amount, p_kind);
  IF t.psp_topup_id IS NOT NULL THEN
    RETURN QUERY SELECT t.psp_topup_id, t.psp_configuration_id, t.provider, t.expires_at, true;
    RETURN;
  END IF;
  IF p_wallet IS NULL THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('DESK','CUSTOMER') THEN
    RAISE EXCEPTION 'Recharge PSP : demandeur inconnu' USING ERRCODE = 'CL001';
  END IF;
  -- a. Portefeuille, grand livre, montant, échéance.
  SELECT * INTO w FROM wallet x WHERE x.id = p_wallet AND x.operator_id = v_operator;
  IF NOT FOUND THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  IF w.status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'Recharge PSP : portefeuille non actif (%)', w.status USING ERRCODE = 'CL039';
  END IF;
  SELECT * INTO lg FROM ledger l WHERE l.id = w.ledger_id AND l.operator_id = v_operator;
  IF NOT FOUND OR lg.scope_type <> 'EVENT' THEN
    RAISE EXCEPTION 'Recharge PSP : grand livre d''événement attendu' USING ERRCODE = 'CL001';
  END IF;
  IF lg.status <> 'OPEN' THEN
    RAISE EXCEPTION 'Recharge PSP : grand livre % (EVENT_CLOSING)', lg.status USING ERRCODE = 'CL004';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Recharge PSP : montant invalide' USING ERRCODE = 'CL001';
  END IF;
  IF p_expires_at IS NULL OR p_expires_at <= v_now OR p_expires_at > v_now + interval '7 days' THEN
    RAISE EXCEPTION 'Recharge PSP : échéance hors de [maintenant, 7 jours]' USING ERRCODE = 'CL001';
  END IF;
  -- b. Configuration revérifiée (CL042 si aucune) ; comptes A-PSP-* (filet idempotent).
  PERFORM open_psp_accounts(lg.id);
  SELECT r.psp_configuration_id, r.provider INTO c
    FROM resolve_psp_configuration(lg.scope_id, p_method) r;
  -- c. Bornes des recharges en attente, sous verrou consultatif du portefeuille (A25).
  PERFORM pg_advisory_xact_lock(hashtextextended('psp-pending:' || p_wallet::text, 0));
  t := psp_topup_replay_row(p_psp_topup, p_wallet, p_method, p_amount, p_kind);
  IF t.psp_topup_id IS NOT NULL THEN
    RETURN QUERY SELECT t.psp_topup_id, t.psp_configuration_id, t.provider, t.expires_at, true;
    RETURN;
  END IF;
  IF (SELECT count(*) FROM psp_topup x WHERE x.wallet_id = p_wallet AND x.status = 'PENDING') >= 3 THEN
    RAISE EXCEPTION 'Recharge PSP : trop de recharges en attente pour ce portefeuille'
      USING ERRCODE = 'CL029';
  END IF;
  IF p_device IS NOT NULL
     AND (SELECT count(*) FROM psp_topup x WHERE x.device_id = p_device AND x.status = 'PENDING') >= 20 THEN
    RAISE EXCEPTION 'Recharge PSP : trop de recharges en attente pour ce terminal'
      USING ERRCODE = 'CL029';
  END IF;
  -- d. Demandeur.
  IF p_kind = 'DESK' THEN
    IF p_device IS NULL OR p_person IS NULL OR p_customer IS NOT NULL THEN
      RAISE EXCEPTION 'Recharge PSP : guichet = terminal et personne, sans client'
        USING ERRCODE = 'CL001';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM device d WHERE d.id = p_device AND d.operator_id = v_operator) THEN
      RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM device d WHERE d.id = p_device AND d.operator_id = v_operator
                      AND d.status = 'ACTIVE' AND d.app_mode = 'TOPUP_DESK') THEN
      RAISE EXCEPTION 'Recharge PSP : terminal actif en mode guichet de recharge obligatoire'
        USING ERRCODE = 'CL001';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM app_user u WHERE u.id = p_person AND u.operator_id = v_operator) THEN
      RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM app_user u WHERE u.id = p_person AND u.operator_id = v_operator
                      AND u.status = 'ACTIVE') THEN
      RAISE EXCEPTION 'Recharge PSP : personne inactive' USING ERRCODE = 'CL001';
    END IF;
  ELSE
    IF p_customer IS NULL OR p_device IS NOT NULL OR p_person IS NOT NULL THEN
      RAISE EXCEPTION 'Recharge PSP : client seul attendu' USING ERRCODE = 'CL001';
    END IF;
    IF w.customer_id IS DISTINCT FROM p_customer THEN
      RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found';
    END IF;
  END IF;
  -- e. Insertion : le frais est calculé au crédit, jamais ici.
  INSERT INTO psp_topup (psp_topup_id, operator_id, ledger_id, event_id, wallet_id,
                         psp_configuration_id, method, provider, amount, currency, status,
                         expires_at, requested_by_kind, device_id, person_id, customer_id, created_at)
  VALUES (p_psp_topup, v_operator, lg.id, lg.scope_id, p_wallet, c.psp_configuration_id, p_method,
          c.provider, p_amount, lg.currency, 'PENDING', p_expires_at, p_kind, p_device, p_person,
          p_customer, v_now);
  RETURN QUERY SELECT p_psp_topup, c.psp_configuration_id, c.provider, p_expires_at, false;
END $$;
REVOKE ALL ON FUNCTION create_psp_topup(uuid, uuid, text, bigint, text, uuid, uuid, uuid,
                                        timestamptz) FROM PUBLIC;

CREATE FUNCTION mark_psp_topup_initiated(p_psp_topup uuid, p_provider_payment_ref text,
                                         p_expires_at timestamptz DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE
  v_operator uuid := psp_session_operator();
  v_now timestamptz := clock_timestamp();
  t psp_topup%ROWTYPE;
BEGIN
  IF p_psp_topup IS NULL THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  SELECT * INTO t FROM psp_topup x WHERE x.psp_topup_id = p_psp_topup AND x.operator_id = v_operator
    FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  IF p_provider_payment_ref IS NULL OR length(p_provider_payment_ref) NOT BETWEEN 1 AND 200
     OR p_provider_payment_ref ~ '\s' THEN
    RAISE EXCEPTION 'Recharge PSP : référence du PSP de 1 à 200 caractères sans espace'
      USING ERRCODE = 'CL001';
  END IF;
  IF p_expires_at IS NOT NULL AND (p_expires_at < v_now OR p_expires_at > v_now + interval '7 days') THEN
    RAISE EXCEPTION 'Recharge PSP : échéance hors de [maintenant, 7 jours]' USING ERRCODE = 'CL001';
  END IF;
  IF t.provider_payment_ref IS NOT NULL AND t.provider_payment_ref <> p_provider_payment_ref THEN
    RAISE EXCEPTION 'Recharge PSP : autre référence déjà posée' USING ERRCODE = 'CL029';
  END IF;
  BEGIN
    IF t.provider_payment_ref IS NULL THEN
      UPDATE psp_topup SET provider_payment_ref = p_provider_payment_ref
       WHERE psp_topup_id = t.psp_topup_id;
    END IF;
    IF p_expires_at IS NOT NULL AND t.status = 'PENDING' THEN
      UPDATE psp_topup SET expires_at = p_expires_at WHERE psp_topup_id = t.psp_topup_id;
    END IF;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'Recharge PSP : référence déjà utilisée dans cette configuration'
      USING ERRCODE = 'CL029';
  END;
END $$;
REVOKE ALL ON FUNCTION mark_psp_topup_initiated(uuid, text, timestamptz) FROM PUBLIC;

CREATE FUNCTION cancel_psp_topup(p_psp_topup uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE
  v_operator uuid := psp_session_operator();
  t psp_topup%ROWTYPE;
BEGIN
  IF p_psp_topup IS NULL THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  SELECT * INTO t FROM psp_topup x WHERE x.psp_topup_id = p_psp_topup AND x.operator_id = v_operator
    FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  IF t.status = 'CANCELLED' THEN RETURN 'CANCELLED'; END IF;
  IF t.status <> 'PENDING' THEN
    RAISE EXCEPTION 'Recharge PSP : annulation impossible (%)', t.status USING ERRCODE = 'CL029';
  END IF;
  UPDATE psp_topup SET status = 'CANCELLED', failure_reason = 'CANCELLED'
   WHERE psp_topup_id = t.psp_topup_id;
  RETURN 'CANCELLED';
END $$;
REVOKE ALL ON FUNCTION cancel_psp_topup(uuid) FROM PUBLIC;

CREATE FUNCTION expire_psp_topups(p_ids uuid[]) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE
  v_operator uuid := psp_session_operator();
  v_id uuid;
  v_n int := 0;
  t psp_topup%ROWTYPE;
BEGIN
  IF p_ids IS NULL OR cardinality(p_ids) > 500 THEN
    RAISE EXCEPTION 'Recharge PSP : de 0 à 500 identifiants' USING ERRCODE = 'CL001';
  END IF;
  FOR v_id IN SELECT DISTINCT i FROM unnest(p_ids) AS i WHERE i IS NOT NULL ORDER BY i LOOP
    SELECT * INTO t FROM psp_topup x WHERE x.psp_topup_id = v_id AND x.operator_id = v_operator
      FOR UPDATE;
    IF FOUND AND t.status = 'PENDING' AND t.expires_at <= clock_timestamp() THEN
      UPDATE psp_topup SET status = 'EXPIRED', failure_reason = 'EXPIRED'
       WHERE psp_topup_id = t.psp_topup_id;
      v_n := v_n + 1;
    END IF;
  END LOOP;
  RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION expire_psp_topups(uuid[]) FROM PUBLIC;

-- Neutre : l'interrogation parcourt tous les prestataires. Ne filtre PAS sur le statut de la
-- configuration (A15 : une configuration suspendue reste interrogée). Aucune colonne secrète.
CREATE FUNCTION psp_poll_candidates(p_limit int)
RETURNS TABLE (psp_topup_id uuid, operator_id uuid, psp_configuration_id uuid, provider text,
               method text, provider_payment_ref text, created_at timestamptz,
               expires_at timestamptz, expired boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 500 THEN
    RAISE EXCEPTION 'Interrogation PSP : limite de 1 à 500' USING ERRCODE = 'CL001';
  END IF;
  RETURN QUERY
    SELECT t.psp_topup_id, t.operator_id, t.psp_configuration_id, t.provider, t.method,
           t.provider_payment_ref, t.created_at, t.expires_at, t.expires_at <= clock_timestamp()
      FROM psp_topup t
     WHERE t.status = 'PENDING' AND t.created_at < clock_timestamp() - interval '2 minutes'
     ORDER BY t.created_at, t.psp_topup_id
     LIMIT p_limit;
END $$;
REVOKE ALL ON FUNCTION psp_poll_candidates(int) FROM PUBLIC;

-- 4. Notifications (T019) -------------------------------------------------------------------------
CREATE FUNCTION record_psp_event(p_config uuid, p_provider_event_id text, p_kind text, p_body bytea,
                                 p_normalized jsonb)
RETURNS TABLE (psp_event_id uuid, duplicate boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE
  v_operator uuid := psp_session_operator();
  c psp_configuration%ROWTYPE;
  v_id uuid;
BEGIN
  IF p_config IS NULL THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  SELECT * INTO c FROM psp_configuration x
   WHERE x.psp_configuration_id = p_config AND x.operator_id = v_operator;
  IF NOT FOUND THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  IF c.status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'Notification PSP : configuration non active' USING ERRCODE = 'CL029';
  END IF;
  IF p_provider_event_id IS NULL OR length(p_provider_event_id) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'Notification PSP : identifiant de 1 à 200 caractères' USING ERRCODE = 'CL001';
  END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('PAYMENT_SUCCEEDED','PAYMENT_FAILED','PAYMENT_CANCELLED',
                                      'DISPUTE','UNKNOWN') THEN
    RAISE EXCEPTION 'Notification PSP : nature inconnue' USING ERRCODE = 'CL001';
  END IF;
  IF p_body IS NOT NULL AND octet_length(p_body) > 65536 THEN
    RAISE EXCEPTION 'Notification PSP : corps de plus de 65 536 octets' USING ERRCODE = 'CL001';
  END IF;
  IF p_normalized IS NULL OR jsonb_typeof(p_normalized) <> 'object'
     OR pg_column_size(p_normalized) > 8192 THEN
    RAISE EXCEPTION 'Notification PSP : notification normalisée invalide' USING ERRCODE = 'CL001';
  END IF;
  INSERT INTO psp_event (operator_id, psp_configuration_id, provider_event_id, body, kind, normalized)
  VALUES (v_operator, p_config, p_provider_event_id, p_body, p_kind, p_normalized)
  ON CONFLICT (psp_configuration_id, provider_event_id) DO NOTHING
  RETURNING psp_event.psp_event_id INTO v_id;
  IF v_id IS NULL THEN
    SELECT e.psp_event_id INTO v_id FROM psp_event e
     WHERE e.psp_configuration_id = p_config AND e.provider_event_id = p_provider_event_id;
    RETURN QUERY SELECT v_id, true;
  ELSE
    RETURN QUERY SELECT v_id, false;
  END IF;
END $$;
REVOKE ALL ON FUNCTION record_psp_event(uuid, text, text, bytea, jsonb) FROM PUBLIC;

CREATE FUNCTION mark_psp_event(p_psp_event uuid, p_status text, p_outcome text DEFAULT NULL,
                               p_psp_topup uuid DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE
  v_operator uuid := psp_session_operator();
  e psp_event%ROWTYPE;
BEGIN
  IF p_psp_event IS NULL THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  SELECT * INTO e FROM psp_event x WHERE x.psp_event_id = p_psp_event AND x.operator_id = v_operator
    FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  IF p_status IS NULL OR p_status NOT IN ('PROCESSED','UNMATCHED','RETRY') THEN
    RAISE EXCEPTION 'Notification PSP : état demandé inconnu' USING ERRCODE = 'CL001';
  END IF;
  IF p_psp_topup IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM psp_topup t WHERE t.psp_topup_id = p_psp_topup AND t.operator_id = v_operator) THEN
    RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found';
  END IF;
  IF p_status = 'PROCESSED' THEN
    IF p_outcome IS NULL OR p_outcome NOT IN ('CREDITED','NOT_CREDITED','MISMATCH',
                                              'DUPLICATE_PAYMENT','CHARGEBACK','NO_EFFECT') THEN
      RAISE EXCEPTION 'Notification PSP : issue obligatoire pour PROCESSED' USING ERRCODE = 'CL001';
    END IF;
    IF e.status = 'PROCESSED' THEN
      IF e.outcome = p_outcome THEN RETURN; END IF;
      RAISE EXCEPTION 'Notification PSP : PROCESSED est définitif' USING ERRCODE = 'CL029';
    END IF;
    UPDATE psp_event SET status = 'PROCESSED', outcome = p_outcome,
           processed_at = clock_timestamp(), psp_topup_id = coalesce(p_psp_topup, psp_topup_id)
     WHERE psp_event_id = e.psp_event_id;
  ELSE
    IF p_outcome IS NOT NULL THEN
      RAISE EXCEPTION 'Notification PSP : issue réservée à PROCESSED' USING ERRCODE = 'CL001';
    END IF;
    IF e.status = 'PROCESSED' THEN
      RAISE EXCEPTION 'Notification PSP : PROCESSED est définitif' USING ERRCODE = 'CL029';
    END IF;
    UPDATE psp_event SET status = p_status,
           attempts = attempts + CASE WHEN p_status = 'RETRY' THEN 1 ELSE 0 END,
           psp_topup_id = coalesce(p_psp_topup, psp_topup_id)
     WHERE psp_event_id = e.psp_event_id;
  END IF;
END $$;
REVOKE ALL ON FUNCTION mark_psp_event(uuid, text, text, uuid) FROM PUBLIC;

-- Neutre : la reprise parcourt tous les prestataires. Ne rend NI le corps NI aucune référence de
-- secrets : la notification normalisée suffit (le corps n'est pas lisible par cashless_app).
CREATE FUNCTION psp_events_to_retry(p_limit int)
RETURNS TABLE (psp_event_id uuid, operator_id uuid, psp_configuration_id uuid, kind text,
               status text, attempts int, received_at timestamptz, normalized jsonb,
               exhausted boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 500 THEN
    RAISE EXCEPTION 'Reprise PSP : limite de 1 à 500' USING ERRCODE = 'CL001';
  END IF;
  RETURN QUERY
    SELECT e.psp_event_id, e.operator_id, e.psp_configuration_id, e.kind, e.status, e.attempts,
           e.received_at, e.normalized, (e.status = 'RETRY' AND e.attempts > 5)
      FROM psp_event e
     WHERE (e.status = 'RECEIVED' AND e.received_at < clock_timestamp() - interval '1 minute')
        OR e.status IN ('RETRY','UNMATCHED')
     ORDER BY e.received_at, e.psp_event_id
     LIMIT p_limit;
END $$;
REVOKE ALL ON FUNCTION psp_events_to_retry(int) FROM PUBLIC;

CREATE FUNCTION purge_psp_event_bodies(p_older_than_days int DEFAULT 400) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_n bigint;
BEGIN
  IF p_older_than_days IS NULL OR p_older_than_days < 365 THEN
    RAISE EXCEPTION 'Purge PSP : au moins 365 jours' USING ERRCODE = 'CL001';
  END IF;
  UPDATE psp_event SET body = NULL, body_purged_at = clock_timestamp()
   WHERE body IS NOT NULL
     AND received_at < clock_timestamp() - make_interval(days => p_older_than_days);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION purge_psp_event_bodies(int) FROM PUBLIC;

-- Lecture du corps brut (A24) : seul OPERATOR_ADMIN actif, ligne d'audit écrite DANS la fonction
-- (colonnes comme apps/api/src/audit : le déclencheur de 0004 pose chaîne, numéro et heure).
CREATE FUNCTION read_psp_event_body(p_psp_event uuid, p_actor uuid) RETURNS bytea
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE
  v_operator uuid := psp_session_operator();
  e psp_event%ROWTYPE;
BEGIN
  IF p_psp_event IS NULL OR p_actor IS NULL THEN
    RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found';
  END IF;
  SELECT * INTO e FROM psp_event x WHERE x.psp_event_id = p_psp_event AND x.operator_id = v_operator;
  IF NOT FOUND OR NOT psp_operator_admin(v_operator, p_actor) THEN
    RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found';
  END IF;
  INSERT INTO audit_log (operator_id, actor_id, actor_role, action, object_type, object_id, after,
                         origin)
  VALUES (v_operator, p_actor, 'OPERATOR_ADMIN', 'PSP_EVENT_BODY_READ', 'psp_event',
          e.psp_event_id::text,
          jsonb_build_object('psp_configuration_id', e.psp_configuration_id,
                             'provider_event_id', e.provider_event_id,
                             'body_purged', e.body IS NULL),
          'database');
  RETURN e.body;
END $$;
REVOKE ALL ON FUNCTION read_psp_event_body(uuid, uuid) FROM PUBLIC;

-- 5. Complétion, échec, carte (T019) --------------------------------------------------------------
-- Noyau INTERNE. Aucun chemin n'évite ce noyau pour créditer : la transaction doit exister, être
-- du bon type, de la bonne clé, du bon grand livre, créditer le bon portefeuille.
CREATE FUNCTION psp_complete_core(p_psp_topup uuid, p_tx uuid, p_fee_amount bigint,
                                  p_provider_payment_ref text, p_card boolean,
                                  p_card_fingerprint text, p_three_ds text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE
  v_operator uuid := psp_session_operator();
  t psp_topup%ROWTYPE;
  x journal_transaction%ROWTYPE;
  v_ref text;
  v_code text;
  v_psp_sum bigint;
  v_wallet_lines int;
  v_wallet_net bigint;
  v_foreign int;
  v_cap bigint;
  v_today bigint;
BEGIN
  IF p_psp_topup IS NULL THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  SELECT * INTO t FROM psp_topup y WHERE y.psp_topup_id = p_psp_topup AND y.operator_id = v_operator
    FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  IF p_tx IS NULL THEN
    RAISE EXCEPTION 'Recharge PSP : transaction de crédit obligatoire' USING ERRCODE = 'CL001';
  END IF;
  -- Rejeu de la même complétion : sans effet ; une autre transaction : refusée.
  IF t.status = 'SUCCEEDED' THEN
    IF t.topup_tx_id = p_tx THEN RETURN; END IF;
    RAISE EXCEPTION 'Recharge PSP : déjà créditée par une autre transaction' USING ERRCODE = 'CL029';
  END IF;
  IF p_card AND t.method <> 'CARD' THEN
    RAISE EXCEPTION 'Recharge PSP : complete_card_topup ne vaut que pour une carte'
      USING ERRCODE = 'CL001';
  END IF;
  IF p_fee_amount IS NULL OR p_fee_amount < 0 OR p_fee_amount >= t.amount THEN
    RAISE EXCEPTION 'Recharge PSP : frais hors de [0, montant[' USING ERRCODE = 'CL001';
  END IF;
  -- Référence de paiement : celle de la ligne, ou celle fournie si la ligne n'en a pas encore.
  IF t.provider_payment_ref IS NOT NULL AND p_provider_payment_ref IS NOT NULL
     AND t.provider_payment_ref <> p_provider_payment_ref THEN
    RAISE EXCEPTION 'Recharge PSP : autre référence de paiement' USING ERRCODE = 'CL029';
  END IF;
  v_ref := coalesce(t.provider_payment_ref, p_provider_payment_ref);
  IF v_ref IS NULL OR length(v_ref) NOT BETWEEN 1 AND 200 OR v_ref ~ '\s' THEN
    RAISE EXCEPTION 'Recharge PSP : référence de paiement de 1 à 200 caractères sans espace'
      USING ERRCODE = 'CL001';
  END IF;
  -- Transaction de crédit.
  SELECT * INTO x FROM journal_transaction j
   WHERE j.id = p_tx AND j.operator_id = v_operator AND j.ledger_id = t.ledger_id;
  IF NOT FOUND OR x.type <> 'TOPUP' OR x.source <> 'PSP_WEBHOOK'
     OR x.idempotency_key <> psp_key_prefix(t.method) || ':' || t.psp_configuration_id::text
                             || ':' || v_ref THEN
    RAISE EXCEPTION 'Recharge PSP : la transaction ne correspond pas (grand livre, type, source, clé)'
      USING ERRCODE = 'CL001';
  END IF;
  v_code := psp_account_code(t.method);
  SELECT coalesce(sum(p.amount) FILTER (WHERE a.code = v_code AND p.amount > 0), 0),
         count(*) FILTER (WHERE a.purpose = 'WALLET_PAID' AND a.wallet_id = t.wallet_id
                                AND p.amount < 0),
         coalesce(-sum(p.amount) FILTER (WHERE a.purpose = 'WALLET_PAID'
                                               AND a.wallet_id = t.wallet_id), 0),
         count(*) FILTER (WHERE a.wallet_id IS NOT NULL AND a.wallet_id <> t.wallet_id)
    INTO v_psp_sum, v_wallet_lines, v_wallet_net, v_foreign
    FROM posting p JOIN account a ON a.id = p.account_id
   WHERE p.transaction_id = p_tx;
  IF v_psp_sum <> t.amount OR v_wallet_lines < 1 OR v_wallet_net < 1 OR v_wallet_net > t.amount
     OR v_foreign > 0 THEN
    RAISE EXCEPTION 'Recharge PSP : les lignes de la transaction ne créditent pas ce portefeuille du montant brut'
      USING ERRCODE = 'CL001';
  END IF;
  -- Carte : 3-D Secure, empreinte, plafond du jour UTC sous verrou consultatif par carte.
  IF p_card THEN
    IF p_three_ds IS DISTINCT FROM 'SUCCEEDED' THEN
      RAISE EXCEPTION 'Recharge carte : 3-D Secure non réussi' USING ERRCODE = 'CL001';
    END IF;
    IF p_card_fingerprint IS NULL OR btrim(p_card_fingerprint) = '' THEN
      RAISE EXCEPTION 'Recharge carte : empreinte de carte absente' USING ERRCODE = 'CL001';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(
      'card:' || t.ledger_id::text || ':' || p_card_fingerprint, 0));
    SELECT e.card_topup_daily_max_per_card INTO v_cap FROM event e WHERE e.id = t.event_id;
    SELECT coalesce(sum(y.amount), 0) INTO v_today FROM psp_topup y
     WHERE y.ledger_id = t.ledger_id AND y.card_fingerprint = p_card_fingerprint
       AND y.status = 'SUCCEEDED'
       AND (y.succeeded_at AT TIME ZONE 'UTC')::date = (clock_timestamp() AT TIME ZONE 'UTC')::date;
    IF v_today + t.amount > v_cap THEN
      RAISE EXCEPTION 'Recharge carte : plafond carte du jour dépassé' USING ERRCODE = 'CL029';
    END IF;
  END IF;
  -- Anomalie liée : fermée avec la transaction de crédit comme résolution (succès tardif).
  IF t.anomaly_id IS NOT NULL THEN
    UPDATE anomaly SET status = 'RESOLVED', resolution_tx_id = p_tx WHERE id = t.anomaly_id;
  END IF;
  BEGIN
    UPDATE psp_topup SET status = 'SUCCEEDED', fee_amount = p_fee_amount, topup_tx_id = p_tx,
           succeeded_at = clock_timestamp(), provider_payment_ref = v_ref, failure_reason = NULL,
           anomaly_id = NULL,
           card_fingerprint = CASE WHEN p_card THEN p_card_fingerprint ELSE card_fingerprint END,
           three_ds = CASE WHEN p_card THEN p_three_ds ELSE three_ds END
     WHERE psp_topup_id = t.psp_topup_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'Recharge PSP : transaction ou référence déjà utilisée' USING ERRCODE = 'CL029';
  END;
END $$;
REVOKE ALL ON FUNCTION psp_complete_core(uuid, uuid, bigint, text, boolean, text, text) FROM PUBLIC;

-- Wave et Orange Money. Une carte ne se crédite que par complete_card_topup (FR-024, FR-025).
CREATE FUNCTION complete_psp_topup(p_psp_topup uuid, p_tx uuid, p_fee_amount bigint,
                                   p_provider_payment_ref text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_operator uuid := psp_session_operator(); v_method text;
BEGIN
  SELECT t.method INTO v_method FROM psp_topup t
   WHERE t.psp_topup_id = p_psp_topup AND t.operator_id = v_operator;
  IF v_method IS NULL THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  IF v_method = 'CARD' THEN
    RAISE EXCEPTION 'Recharge PSP : une carte se crédite par complete_card_topup'
      USING ERRCODE = 'CL001';
  END IF;
  PERFORM psp_complete_core(p_psp_topup, p_tx, p_fee_amount, p_provider_payment_ref, false, NULL, NULL);
END $$;
REVOKE ALL ON FUNCTION complete_psp_topup(uuid, uuid, bigint, text) FROM PUBLIC;

CREATE FUNCTION complete_card_topup(p_psp_topup uuid, p_tx uuid, p_fee_amount bigint,
                                    p_card_fingerprint text, p_three_ds text,
                                    p_provider_payment_ref text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM psp_complete_core(p_psp_topup, p_tx, p_fee_amount, p_provider_payment_ref, true,
                            p_card_fingerprint, p_three_ds);
END $$;
REVOKE ALL ON FUNCTION complete_card_topup(uuid, uuid, bigint, text, text, text) FROM PUBLIC;

CREATE FUNCTION fail_psp_topup(p_psp_topup uuid, p_reason text, p_paid boolean,
                               p_anomaly_kind text DEFAULT 'PSP_TOPUP_NOT_CREDITED',
                               p_card_fingerprint text DEFAULT NULL,
                               p_three_ds text DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE
  v_operator uuid := psp_session_operator();
  t psp_topup%ROWTYPE;
  v_anomaly uuid;
BEGIN
  IF p_psp_topup IS NULL THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  SELECT * INTO t FROM psp_topup y WHERE y.psp_topup_id = p_psp_topup AND y.operator_id = v_operator
    FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  IF p_reason IS NULL OR p_reason NOT IN (
       'THREE_DS','NO_FINGERPRINT','CARD_DAILY_LIMIT','LEDGER_STATUS','WALLET_LIMIT','MONTHLY_LIMIT',
       'WALLET_BLOCKED','PERIOD_CLOSED','DEBIT_AUTHORITY_EDGE','FEES_EXCEED_AMOUNT',
       'ACCOUNT_INACTIVE','PSP_FAILED','EXPIRED','CANCELLED') THEN
    RAISE EXCEPTION 'Recharge PSP : motif d''échec inconnu' USING ERRCODE = 'CL001';
  END IF;
  IF p_anomaly_kind IS NULL OR p_anomaly_kind NOT IN ('PSP_TOPUP_NOT_CREDITED','PSP_TOPUP_OVER_LIMIT') THEN
    RAISE EXCEPTION 'Recharge PSP : nature d''anomalie inconnue' USING ERRCODE = 'CL001';
  END IF;
  IF p_paid IS NULL THEN
    RAISE EXCEPTION 'Recharge PSP : argent encaissé ou non ?' USING ERRCODE = 'CL001';
  END IF;
  IF t.status = 'SUCCEEDED' THEN
    RAISE EXCEPTION 'Recharge PSP : déjà créditée' USING ERRCODE = 'CL029';
  END IF;
  IF (p_card_fingerprint IS NOT NULL OR p_three_ds IS NOT NULL) AND t.method <> 'CARD' THEN
    RAISE EXCEPTION 'Recharge PSP : empreinte et 3-D Secure ne valent que pour une carte'
      USING ERRCODE = 'CL001';
  END IF;
  IF p_three_ds IS NOT NULL AND p_three_ds NOT IN ('SUCCEEDED','FAILED','NOT_PERFORMED') THEN
    RAISE EXCEPTION 'Recharge PSP : état 3-D Secure inconnu' USING ERRCODE = 'CL001';
  END IF;
  IF t.status = 'PENDING' THEN
    UPDATE psp_topup SET status = 'FAILED', failure_reason = p_reason,
           card_fingerprint = coalesce(p_card_fingerprint, card_fingerprint),
           three_ds = coalesce(p_three_ds, three_ds)
     WHERE psp_topup_id = t.psp_topup_id;
  ELSE
    UPDATE psp_topup SET card_fingerprint = coalesce(p_card_fingerprint, card_fingerprint),
           three_ds = coalesce(p_three_ds, three_ds)
     WHERE psp_topup_id = t.psp_topup_id;
  END IF;
  v_anomaly := t.anomaly_id;
  IF p_paid AND v_anomaly IS NULL THEN
    INSERT INTO anomaly (operator_id, ledger_id, kind, amount, status)
    VALUES (v_operator, t.ledger_id, p_anomaly_kind, t.amount, 'OPEN')
    RETURNING id INTO v_anomaly;
    UPDATE psp_topup SET anomaly_id = v_anomaly WHERE psp_topup_id = t.psp_topup_id;
  END IF;
  RETURN v_anomaly;
END $$;
REVOKE ALL ON FUNCTION fail_psp_topup(uuid, text, boolean, text, text, text) FROM PUBLIC;

CREATE FUNCTION card_topups_today(p_ledger uuid, p_fingerprint text, p_at timestamptz)
RETURNS bigint
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_operator uuid := psp_session_operator();
BEGIN
  IF p_ledger IS NULL OR p_at IS NULL OR NOT EXISTS (
       SELECT 1 FROM ledger l WHERE l.id = p_ledger AND l.operator_id = v_operator) THEN
    RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found';
  END IF;
  IF p_fingerprint IS NULL OR btrim(p_fingerprint) = '' THEN
    RAISE EXCEPTION 'Recharge carte : empreinte de carte absente' USING ERRCODE = 'CL001';
  END IF;
  -- Même verrou que psp_complete_core ; tenu jusqu'à la fin de la transaction de l'appelant.
  PERFORM pg_advisory_xact_lock(hashtextextended('card:' || p_ledger::text || ':' || p_fingerprint, 0));
  RETURN (SELECT coalesce(sum(t.amount), 0)::bigint FROM psp_topup t
           WHERE t.ledger_id = p_ledger AND t.card_fingerprint = p_fingerprint
             AND t.status = 'SUCCEEDED' AND t.operator_id = v_operator
             AND (t.succeeded_at AT TIME ZONE 'UTC')::date = (p_at AT TIME ZONE 'UTC')::date);
END $$;
REVOKE ALL ON FUNCTION card_topups_today(uuid, text, timestamptz) FROM PUBLIC;

CREATE FUNCTION wallet_card_count(p_wallet uuid, p_fingerprint text)
RETURNS TABLE (distinct_cards int, is_new boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_operator uuid := psp_session_operator(); v_n int; v_known boolean;
BEGIN
  IF p_wallet IS NULL OR NOT EXISTS (
       SELECT 1 FROM wallet w WHERE w.id = p_wallet AND w.operator_id = v_operator) THEN
    RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found';
  END IF;
  IF p_fingerprint IS NULL OR btrim(p_fingerprint) = '' THEN
    RAISE EXCEPTION 'Recharge carte : empreinte de carte absente' USING ERRCODE = 'CL001';
  END IF;
  SELECT count(DISTINCT t.card_fingerprint)::int,
         coalesce(bool_or(t.card_fingerprint = p_fingerprint), false)
    INTO v_n, v_known
    FROM psp_topup t
   WHERE t.wallet_id = p_wallet AND t.operator_id = v_operator AND t.status = 'SUCCEEDED'
     AND t.card_fingerprint IS NOT NULL;
  RETURN QUERY SELECT v_n + CASE WHEN v_known THEN 0 ELSE 1 END, NOT v_known;
END $$;
REVOKE ALL ON FUNCTION wallet_card_count(uuid, text) FROM PUBLIC;

-- Neutre : la route publique des notifications n'a pas de prestataire de session. Aucune donnée de
-- la requête n'est stockée ; le compteur est borné par configurations x motifs x minutes.
CREATE FUNCTION record_webhook_rejection(p_config uuid, p_reason text) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_key uuid := '00000000-0000-0000-0000-000000000000';
  v_cfg uuid;
  v_operator uuid;
  v_count int;
BEGIN
  IF p_reason IS NULL OR p_reason NOT IN (
       'BODY_TOO_LARGE','UNKNOWN_CONFIG','CONFIG_NOT_ACTIVE','PROVIDER_MISMATCH',
       'SECRET_UNAVAILABLE','SIGNATURE_MISSING','SIGNATURE_MALFORMED','SIGNATURE_INVALID',
       'TIMESTAMP_OUT_OF_TOLERANCE','BODY_MALFORMED') THEN
    RAISE EXCEPTION 'Notification refusée : motif inconnu' USING ERRCODE = 'CL001';
  END IF;
  IF p_config IS NOT NULL THEN
    SELECT c.psp_configuration_id, c.operator_id INTO v_cfg, v_operator
      FROM psp_configuration c WHERE c.psp_configuration_id = p_config;
    IF v_cfg IS NOT NULL THEN v_key := v_cfg; END IF;
  END IF;
  INSERT INTO psp_webhook_rejection (config_key, psp_configuration_id, operator_id, reason, minute, count)
  VALUES (v_key, v_cfg, v_operator, p_reason, date_trunc('minute', clock_timestamp()), 1)
  ON CONFLICT (config_key, reason, minute)
  DO UPDATE SET count = psp_webhook_rejection.count + 1
  RETURNING psp_webhook_rejection.count INTO v_count;
  DELETE FROM psp_webhook_rejection r
   WHERE (r.config_key, r.reason, r.minute) IN (
     SELECT o.config_key, o.reason, o.minute FROM psp_webhook_rejection o
      WHERE o.minute < clock_timestamp() - interval '30 days' LIMIT 100);
  RETURN v_count;
END $$;
REVOKE ALL ON FUNCTION record_webhook_rejection(uuid, text) FROM PUBLIC;

-- 6. Contestations (T020) -------------------------------------------------------------------------
-- Plafond cumulé sur le net crédité, quel que soit l'écrivain ; verrou de la recharge pris ici pour
-- les écritures directes. Une contestation ne vaut que pour une recharge carte SUCCEEDED, du même
-- prestataire et de la même configuration.
CREATE FUNCTION psp_chargeback_cap() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  t psp_topup%ROWTYPE;
  v_net bigint;
  v_sum bigint;
BEGIN
  SELECT * INTO t FROM psp_topup x WHERE x.psp_topup_id = NEW.psp_topup_id FOR UPDATE;
  IF NOT FOUND OR t.operator_id <> NEW.operator_id
     OR t.psp_configuration_id <> NEW.psp_configuration_id
     OR t.status <> 'SUCCEEDED' OR t.method <> 'CARD' OR t.topup_tx_id IS NULL THEN
    RAISE EXCEPTION 'Contestation non permise pour cette recharge' USING ERRCODE = 'CL044';
  END IF;
  v_net := psp_topup_net_credited(NEW.psp_topup_id);
  SELECT coalesce(sum(c.amount), 0) INTO v_sum FROM psp_chargeback c
   WHERE c.psp_topup_id = NEW.psp_topup_id;
  IF v_sum + NEW.amount > v_net THEN
    RAISE EXCEPTION 'Contestation au-delà du montant net restant (net %, déjà %, demandé %)',
      v_net, v_sum, NEW.amount USING ERRCODE = 'CL043';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION psp_chargeback_cap() FROM PUBLIC;
CREATE TRIGGER psp_chargeback_cap BEFORE INSERT ON psp_chargeback
  FOR EACH ROW EXECUTE FUNCTION psp_chargeback_cap();

-- Seuls le rattachement de l'écriture, le blocage et le déblocage évoluent, une fois chacun.
CREATE FUNCTION psp_chargeback_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_cols text[] := ARRAY['chargeback_tx_id','wallet_blocked','unblocked_by_request'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Contestation : suppression interdite' USING ERRCODE = 'CL001';
  END IF;
  IF (to_jsonb(NEW) - v_cols) IS DISTINCT FROM (to_jsonb(OLD) - v_cols) THEN
    RAISE EXCEPTION 'Contestation : identité non modifiable' USING ERRCODE = 'CL001';
  END IF;
  IF OLD.chargeback_tx_id IS NOT NULL AND NEW.chargeback_tx_id IS DISTINCT FROM OLD.chargeback_tx_id THEN
    RAISE EXCEPTION 'Contestation : écriture déjà rattachée' USING ERRCODE = 'CL029';
  END IF;
  IF OLD.wallet_blocked AND NOT NEW.wallet_blocked THEN
    RAISE EXCEPTION 'Contestation : blocage non retirable' USING ERRCODE = 'CL029';
  END IF;
  IF OLD.unblocked_by_request IS NOT NULL
     AND NEW.unblocked_by_request IS DISTINCT FROM OLD.unblocked_by_request THEN
    RAISE EXCEPTION 'Contestation : déblocage déjà posé' USING ERRCODE = 'CL029';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION psp_chargeback_guard() FROM PUBLIC;
CREATE TRIGGER psp_chargeback_guard BEFORE UPDATE OR DELETE ON psp_chargeback
  FOR EACH ROW EXECUTE FUNCTION psp_chargeback_guard();

CREATE FUNCTION record_chargeback(p_psp_topup uuid, p_dispute_id text, p_amount bigint,
                                  p_late boolean DEFAULT false)
RETURNS TABLE (psp_chargeback_id uuid, duplicate boolean, remaining bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE
  v_operator uuid := psp_session_operator();
  t psp_topup%ROWTYPE;
  cb psp_chargeback%ROWTYPE;
  v_net bigint;
  v_sum bigint;
  v_id uuid := gen_random_uuid();
  v_anomaly uuid;
BEGIN
  IF p_psp_topup IS NULL THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  SELECT * INTO t FROM psp_topup x WHERE x.psp_topup_id = p_psp_topup AND x.operator_id = v_operator
    FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  IF p_dispute_id IS NULL OR length(p_dispute_id) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'Contestation : identifiant de 1 à 200 caractères' USING ERRCODE = 'CL001';
  END IF;
  v_net := psp_topup_net_credited(t.psp_topup_id);
  SELECT coalesce(sum(c.amount), 0) INTO v_sum FROM psp_chargeback c WHERE c.psp_topup_id = t.psp_topup_id;
  -- Doublon : rend l'existant, sans écriture ni contrôle du montant.
  SELECT * INTO cb FROM psp_chargeback c
   WHERE c.psp_configuration_id = t.psp_configuration_id AND c.provider_dispute_id = p_dispute_id;
  IF FOUND THEN
    IF cb.psp_topup_id <> t.psp_topup_id THEN
      RAISE EXCEPTION 'Contestation : identifiant déjà utilisé pour une autre recharge'
        USING ERRCODE = 'CL029';
    END IF;
    RETURN QUERY SELECT cb.psp_chargeback_id, true, v_net - v_sum;
    RETURN;
  END IF;
  IF t.status <> 'SUCCEEDED' OR t.topup_tx_id IS NULL OR t.method <> 'CARD'
     OR p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Contestation non permise (recharge %, moyen %)', t.status, t.method
      USING ERRCODE = 'CL044';
  END IF;
  IF p_amount > v_net - v_sum THEN
    RAISE EXCEPTION 'Contestation au-delà du montant net restant (restant %, demandé %)',
      v_net - v_sum, p_amount USING ERRCODE = 'CL043';
  END IF;
  IF coalesce(p_late, false) THEN
    INSERT INTO anomaly (operator_id, ledger_id, kind, amount, status)
    VALUES (v_operator, t.ledger_id, 'LATE_CHARGEBACK', p_amount, 'OPEN')
    RETURNING id INTO v_anomaly;
  END IF;
  INSERT INTO psp_chargeback (psp_chargeback_id, operator_id, psp_configuration_id,
                              provider_dispute_id, psp_topup_id, amount, late, anomaly_id)
  VALUES (v_id, v_operator, t.psp_configuration_id, p_dispute_id, t.psp_topup_id, p_amount,
          coalesce(p_late, false), v_anomaly);
  RETURN QUERY SELECT v_id, false, v_net - v_sum - p_amount;
END $$;
REVOKE ALL ON FUNCTION record_chargeback(uuid, text, bigint, boolean) FROM PUBLIC;

CREATE FUNCTION attach_chargeback_tx(p_chargeback uuid, p_tx uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE
  v_operator uuid := psp_session_operator();
  cb psp_chargeback%ROWTYPE;
  t psp_topup%ROWTYPE;
  x journal_transaction%ROWTYPE;
  v_psp_credit bigint;
BEGIN
  IF p_chargeback IS NULL THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  SELECT * INTO cb FROM psp_chargeback c
   WHERE c.psp_chargeback_id = p_chargeback AND c.operator_id = v_operator FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  IF p_tx IS NULL THEN
    RAISE EXCEPTION 'Contestation : transaction obligatoire' USING ERRCODE = 'CL001';
  END IF;
  IF cb.chargeback_tx_id IS NOT NULL THEN
    IF cb.chargeback_tx_id = p_tx THEN RETURN; END IF;
    RAISE EXCEPTION 'Contestation : déjà rattachée à une autre écriture' USING ERRCODE = 'CL029';
  END IF;
  SELECT * INTO t FROM psp_topup y WHERE y.psp_topup_id = cb.psp_topup_id;
  SELECT * INTO x FROM journal_transaction j
   WHERE j.id = p_tx AND j.operator_id = v_operator AND j.ledger_id = t.ledger_id;
  IF NOT FOUND OR x.type <> 'CHARGEBACK'
     OR x.idempotency_key <> 'psp:' || cb.psp_configuration_id::text || ':' || cb.provider_dispute_id THEN
    RAISE EXCEPTION 'Contestation : la transaction ne correspond pas (grand livre, type, clé)'
      USING ERRCODE = 'CL001';
  END IF;
  SELECT coalesce(-sum(p.amount) FILTER (WHERE p.amount < 0), 0) INTO v_psp_credit
    FROM posting p JOIN account a ON a.id = p.account_id
   WHERE p.transaction_id = p_tx AND a.ledger_id = t.ledger_id AND a.code = psp_account_code('CARD');
  IF v_psp_credit <> cb.amount THEN
    RAISE EXCEPTION 'Contestation : le compte A-PSP-CARTE n''est pas crédité du montant contesté'
      USING ERRCODE = 'CL001';
  END IF;
  BEGIN
    UPDATE psp_chargeback SET chargeback_tx_id = p_tx WHERE psp_chargeback_id = cb.psp_chargeback_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'Contestation : écriture déjà rattachée à une autre contestation'
      USING ERRCODE = 'CL029';
  END;
  IF cb.anomaly_id IS NOT NULL THEN
    UPDATE anomaly SET status = 'RESOLVED', resolution_tx_id = p_tx
     WHERE id = cb.anomaly_id AND kind = 'LATE_CHARGEBACK' AND status = 'OPEN';
  END IF;
END $$;
REVOKE ALL ON FUNCTION attach_chargeback_tx(uuid, uuid) FROM PUBLIC;

CREATE FUNCTION block_wallet_after_chargeback(p_wallet uuid, p_chargeback uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE
  v_operator uuid := psp_session_operator();
  cb psp_chargeback%ROWTYPE;
  w wallet%ROWTYPE;
BEGIN
  IF p_wallet IS NULL OR p_chargeback IS NULL THEN
    RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found';
  END IF;
  SELECT * INTO cb FROM psp_chargeback c
   WHERE c.psp_chargeback_id = p_chargeback AND c.operator_id = v_operator FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  IF NOT EXISTS (SELECT 1 FROM psp_topup t WHERE t.psp_topup_id = cb.psp_topup_id
                    AND t.wallet_id = p_wallet AND t.operator_id = v_operator) THEN
    RAISE EXCEPTION 'Contestation d''un autre portefeuille' USING ERRCODE = 'CL044';
  END IF;
  SELECT * INTO w FROM wallet x WHERE x.id = p_wallet AND x.operator_id = v_operator FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  IF w.status = 'CLOSED' THEN
    RAISE EXCEPTION 'Portefeuille clos : blocage impossible' USING ERRCODE = 'CL044';
  END IF;
  IF w.status = 'ACTIVE' THEN
    UPDATE wallet SET status = 'BLOCKED' WHERE id = p_wallet;
  END IF;
  UPDATE psp_chargeback SET wallet_blocked = true WHERE psp_chargeback_id = cb.psp_chargeback_id;
END $$;
REVOKE ALL ON FUNCTION block_wallet_after_chargeback(uuid, uuid) FROM PUBLIC;

-- Modèle de enqueue_tag_key_job (0020) : demande APPROVED du prestataire, deux personnes
-- ORGANIZER_ADMIN actives de l'organisateur de l'événement du portefeuille, postérieure à la
-- contestation qui a bloqué (une demande plus ancienne ou rejouée ne débloque pas).
CREATE FUNCTION unblock_wallet(p_wallet uuid, p_request uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE
  v_operator uuid := psp_session_operator();
  r approval_request%ROWTYPE;
  w wallet%ROWTYPE;
  v_organizer uuid;
  v_latest timestamptz;
BEGIN
  IF p_wallet IS NULL OR p_request IS NULL THEN
    RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found';
  END IF;
  SELECT * INTO r FROM approval_request a WHERE a.id = p_request AND a.operator_id = v_operator
    FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  SELECT * INTO w FROM wallet x WHERE x.id = p_wallet AND x.operator_id = v_operator FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  SELECT e.organizer_id INTO v_organizer FROM ledger l JOIN event e ON e.id = l.scope_id
   WHERE l.id = w.ledger_id AND l.scope_type = 'EVENT' AND e.operator_id = v_operator;
  IF v_organizer IS NULL THEN
    RAISE EXCEPTION 'Déblocage : portefeuille hors d''un événement' USING ERRCODE = 'CL023';
  END IF;
  IF r.action <> 'WALLET_UNBLOCK' OR r.status <> 'APPROVED'
     OR r.payload ->> 'wallet_id' IS DISTINCT FROM p_wallet::text
     OR r.decided_by IS NULL OR r.decided_by = r.requested_by
     OR r.decided_at IS NULL THEN
    RAISE EXCEPTION 'Déblocage : demande absente, non approuvée, sans rapport ou décidée par son auteur'
      USING ERRCODE = 'CL023';
  END IF;
  IF NOT psp_organizer_admin(v_operator, v_organizer, r.requested_by)
     OR NOT psp_organizer_admin(v_operator, v_organizer, r.decided_by) THEN
    RAISE EXCEPTION 'Déblocage : auteur et valideur, deux ORGANIZER_ADMIN actifs de l''organisateur'
      USING ERRCODE = 'CL023';
  END IF;
  SELECT max(c.created_at) INTO v_latest FROM psp_chargeback c
    JOIN psp_topup t ON t.psp_topup_id = c.psp_topup_id
   WHERE t.wallet_id = p_wallet AND c.wallet_blocked AND c.unblocked_by_request IS NULL;
  IF w.status <> 'BLOCKED' OR v_latest IS NULL THEN
    RAISE EXCEPTION 'Déblocage : portefeuille non bloqué par une contestation' USING ERRCODE = 'CL029';
  END IF;
  IF r.decided_at <= v_latest THEN
    RAISE EXCEPTION 'Déblocage : demande antérieure à la dernière contestation' USING ERRCODE = 'CL029';
  END IF;
  UPDATE wallet SET status = 'ACTIVE' WHERE id = p_wallet;
  UPDATE psp_chargeback c SET unblocked_by_request = p_request
   WHERE c.wallet_blocked AND c.unblocked_by_request IS NULL
     AND c.psp_topup_id IN (SELECT t.psp_topup_id FROM psp_topup t WHERE t.wallet_id = p_wallet);
END $$;
REVOKE ALL ON FUNCTION unblock_wallet(uuid, uuid) FROM PUBLIC;

-- 7. Extensions de listes fermées (T021) -----------------------------------------------------------
-- Listes relues dans pg_get_constraintdef de la base (état de 0037) puis recopiées plus la valeur.
ALTER TABLE anomaly DROP CONSTRAINT anomaly_kind_check;
ALTER TABLE anomaly ADD CONSTRAINT anomaly_kind_check CHECK (kind IN (
  'OFFLINE_SHORTFALL','COUNTER_DUPLICATE','COUNTER_TIME_INVERSION','UID_MISMATCH','RETIRED_IDENTITY',
  'SEQ_GAP','CHAIN_BROKEN','CLOCK_SKEW','VOID_CONFLICT','ONLINE_CONFIRMED_MISSING',
  'IDEMPOTENCY_CONFLICT','NON_COMPLIANT_OPERATION','PERIOD_CLOSED_OPERATION','LATE_OFFLINE_SYNC',
  'SIGNATURE_MISMATCH','CASH_TOPUP_OVER_LIMIT','CASH_DIFF','PSP_MISMATCH','PSP_TOPUP_OVER_LIMIT',
  'EDGE_REPLAY_FAILED','LATE_CHARGEBACK','CARD_VELOCITY','PSP_TOPUP_NOT_CREDITED'));
-- Montant et grand livre exigés pour l'argent encaissé non crédité.
ALTER TABLE anomaly ADD CONSTRAINT anomaly_psp_topup_not_credited
  CHECK (kind <> 'PSP_TOPUP_NOT_CREDITED' OR (ledger_id IS NOT NULL AND amount > 0));

ALTER TABLE approval_request DROP CONSTRAINT approval_request_action_check;
ALTER TABLE approval_request ADD CONSTRAINT approval_request_action_check CHECK (action IN (
  'LATE_CLAIM','ADJUSTMENT','ANOMALY_RESOLUTION','WAIVE_SEQ_GAP','FORCE_CENTRAL_AUTHORITY',
  'REINSTATE_MEDIA','PAYOUT','DEVICE_JOURNAL_IMPORT','KYC_REVOCATION','PSP_CONFIGURATION',
  'EVENT_PSP_SELECTION','WALLET_REFUND','LATE_CHARGEBACK','EVENT_GO_LIVE','EVENT_SETTINGS_CHANGE',
  'EVENT_OPERATOR_SETTINGS_CHANGE','PARTICIPATION_CHANGE','FEE_RULE_CHANGE','CONTRACT_VERSION',
  'PLATFORM_CONTRACT_VERSION','JURISDICTION_LIMITS_CHANGE','TAG_KEY_CREATE','TAG_DEK_ROTATE',
  'TAG_KEY_RETIRE','SALE_REVERSAL','WALLET_UNBLOCK','CASH_DEPOSIT'));
