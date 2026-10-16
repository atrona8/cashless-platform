-- Migration 0010 : codes de rattachement et demandes en attente (SPECIFICATION §7.8, §14.2 S19, ADR-36, ADR-56,
-- ADR-57 ; mission bracelets-nfc, data-model « Migration 0010 », contracts/claim-codes.md).
-- Le serveur ne conserve jamais un code en clair : les colonnes *_hash portent une empreinte à clé (HMAC-SHA256,
-- 32 octets) calculée par l'API avec un secret hors de la base (research R-06). La base ne sait donc ni produire ni
-- vérifier un code ; elle compare des empreintes.
-- Règles tenues ici : un code par bracelet d'un lot PUBLIC, associé une fois ; un rattachement direct seulement si le
-- solde disponible est nul, sinon une demande en attente (24 h, 3 au plus par bracelet) confirmée au guichet avec le
-- même bracelet ; rattachement : 5 essais par compte et par heure, 20 par appareil et par jour (§7.8) ; consultation
-- anonyme : 20 par code et par heure, 60 par adresse et par heure (contrat `lookupBalanceByClaimCode`, qui prime sur la
-- spécification, §0.3) ; une seule sorte de refus pour un code inconnu, utilisé ou invalidé (pas d'énumération).
-- Erreurs métier : CL020 (état du bracelet ou du lot qui ne permet pas l'action). Fonctions SECURITY INVOKER : la RLS
-- et les droits du rôle appelant s'appliquent ; aucune ne lit une ligne entière de `media` (colonnes secrètes).
-- Le cloisonnement ne passe pas par les fonctions `tenant_of_*` du schéma (réservées aux fonctions DEFINER, non
-- exécutables par le rôle applicatif) : chaque fonction filtre sur le prestataire de la session, et un objet d'un
-- autre prestataire répond « introuvable », comme partout ailleurs.
-- Aucun nom de rôle ici : les droits sont posés par post-roles.sql.

-- 1. Colonnes ---------------------------------------------------------------------------------------------------
ALTER TABLE media ADD COLUMN claim_code_hash bytea
  CONSTRAINT media_claim_code_hash CHECK (claim_code_hash IS NULL OR octet_length(claim_code_hash) = 32);
ALTER TABLE media ADD COLUMN claim_code_used_at timestamptz;
ALTER TABLE media ADD COLUMN claim_attempts int NOT NULL DEFAULT 0
  CONSTRAINT media_claim_attempts CHECK (claim_attempts >= 0);
ALTER TABLE media ADD CONSTRAINT media_claim_code_used CHECK (claim_code_used_at IS NULL OR claim_code_hash IS NOT NULL);
-- Unicité tous prestataires confondus : la consultation anonyme (sans compte, donc sans prestataire) retrouve le
-- bracelet par son seul code.
CREATE UNIQUE INDEX media_claim_code_hash_key ON media (claim_code_hash) WHERE claim_code_hash IS NOT NULL;

-- Le fichier de commande (codes en clair) n'est produit qu'une fois par lot.
ALTER TABLE media_batch ADD COLUMN claim_codes_issued_at timestamptz;

-- 2. Tables -----------------------------------------------------------------------------------------------------
-- Un code imprimé : généré à la commande du lot, associé à une puce à la personnalisation (ADR-56).
CREATE TABLE claim_code (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id    uuid NOT NULL REFERENCES party(id),
  batch_id       uuid NOT NULL REFERENCES media_batch(id),
  code_hash      bytea NOT NULL CONSTRAINT claim_code_hash_length CHECK (octet_length(code_hash) = 32),
  media_id       uuid REFERENCES media(id),
  associated_at  timestamptz,
  invalidated_at timestamptz,                -- code jamais associé à la clôture du lot
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT claim_code_association CHECK ((media_id IS NULL) = (associated_at IS NULL)),
  CONSTRAINT claim_code_invalidated CHECK (invalidated_at IS NULL OR media_id IS NULL),
  UNIQUE (code_hash)                         -- tous prestataires confondus (consultation anonyme par le seul code)
);
CREATE UNIQUE INDEX claim_code_media_key ON claim_code (media_id) WHERE media_id IS NOT NULL;
CREATE INDEX claim_code_batch_idx ON claim_code (batch_id);

-- Demande de rattachement d'un bracelet déjà approvisionné, à confirmer au guichet (ADR-57).
CREATE TABLE media_claim (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id         uuid NOT NULL REFERENCES party(id),
  media_id            uuid NOT NULL REFERENCES media(id),
  customer_id         uuid NOT NULL REFERENCES party(id),
  status              text NOT NULL DEFAULT 'PENDING'
                      CONSTRAINT media_claim_status CHECK (status IN ('PENDING','CONFIRMED','EXPIRED','CANCELLED')),
  confirmation_hash   bytea NOT NULL CONSTRAINT media_claim_confirmation_hash CHECK (octet_length(confirmation_hash) = 32),
  attempts            int NOT NULL DEFAULT 0 CONSTRAINT media_claim_attempts CHECK (attempts BETWEEN 0 AND 5),
  created_at          timestamptz NOT NULL DEFAULT now(),
  expires_at          timestamptz NOT NULL,
  confirmed_device_id uuid REFERENCES device(id),
  confirmed_by        uuid,
  confirmed_at        timestamptz,
  CONSTRAINT media_claim_confirmed CHECK ((status = 'CONFIRMED') = (confirmed_at IS NOT NULL)),
  CONSTRAINT media_claim_confirmer CHECK (confirmed_at IS NULL OR (confirmed_device_id IS NOT NULL AND confirmed_by IS NOT NULL))
);
CREATE INDEX media_claim_media_idx ON media_claim (media_id, status);
CREATE INDEX media_claim_customer_idx ON media_claim (customer_id, created_at);

-- Trace de chaque essai de code (rattachement ou consultation anonyme) : sert aux limites. En ajout seul.
CREATE TABLE claim_attempt (
  id           bigserial PRIMARY KEY,
  operator_id  uuid REFERENCES party(id),      -- NULL : consultation anonyme d'un code inconnu (aucun prestataire)
  customer_id  uuid REFERENCES party(id),      -- NULL : consultation anonyme
  device_ref   text NOT NULL CONSTRAINT claim_attempt_device_ref CHECK (length(device_ref) BETWEEN 1 AND 200),
  code_hash    bytea CONSTRAINT claim_attempt_code_hash CHECK (code_hash IS NULL OR octet_length(code_hash) = 32),
  attempted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  outcome      text NOT NULL
               CONSTRAINT claim_attempt_outcome CHECK (outcome IN ('ATTACHED','PENDING','NOT_ACTIVE','LOOKUP','REFUSED','BLOCKED'))
);
CREATE INDEX claim_attempt_customer_idx ON claim_attempt (customer_id, attempted_at) WHERE customer_id IS NOT NULL;
CREATE INDEX claim_attempt_device_idx ON claim_attempt (device_ref, attempted_at);
CREATE INDEX claim_attempt_code_idx ON claim_attempt (code_hash, attempted_at) WHERE code_hash IS NOT NULL;
ALTER TABLE claim_attempt ADD CONSTRAINT claim_attempt_customer_tenant CHECK (customer_id IS NULL OR operator_id IS NOT NULL);
CREATE TRIGGER claim_attempt_immutable BEFORE UPDATE OR DELETE ON claim_attempt
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['claim_code','media_claim','claim_attempt'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
                     USING (operator_id = current_setting('app.operator_id', true)::uuid)$p$, t);
  END LOOP;
END $$;

-- 3. Appuis -----------------------------------------------------------------------------------------------------
-- Prestataire de la session ; erreur neutre s'il n'est pas posé (comme assert_tenant).
CREATE FUNCTION claim_session_operator() RETURNS uuid LANGUAGE plpgsql STABLE AS $$
DECLARE v uuid := nullif(current_setting('app.operator_id', true), '')::uuid;
BEGIN
  IF v IS NULL THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  RETURN v;
END $$;

-- Limites d'essais (§7.8) : 5 par compte et par heure, 20 par appareil et par jour. Les essais déjà bloqués ne
-- comptent pas, sinon un blocage s'entretiendrait lui-même.
CREATE FUNCTION claim_attempts_exceeded(p_operator uuid, p_customer uuid, p_device_ref text) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT (p_customer IS NOT NULL AND (SELECT count(*) FROM claim_attempt a
            WHERE a.operator_id = p_operator AND a.customer_id = p_customer AND a.outcome <> 'BLOCKED'
              AND a.attempted_at > clock_timestamp() - interval '1 hour') >= 5)
      OR (SELECT count(*) FROM claim_attempt a
            WHERE a.operator_id = p_operator AND a.device_ref = p_device_ref AND a.customer_id IS NOT NULL
              AND a.outcome <> 'BLOCKED' AND a.attempted_at > clock_timestamp() - interval '1 day') >= 20
$$;

-- Les demandes dont le délai est passé ne sont plus en attente.
CREATE FUNCTION expire_media_claims(p_media uuid) RETURNS void LANGUAGE sql AS $$
  UPDATE media_claim SET status = 'EXPIRED'
   WHERE media_id = p_media AND status = 'PENDING' AND expires_at <= clock_timestamp()
$$;

-- 4. Codes : émission, association, invalidation -------------------------------------------------------------------
-- Enregistre les empreintes des codes du fichier de commande. Une seule fois par lot ; lot PUBLIC seulement.
CREATE FUNCTION issue_claim_codes(p_batch uuid, p_hashes bytea[]) RETURNS int
LANGUAGE plpgsql AS $$
DECLARE b_operator uuid; b_kind text; b_quantity int; b_issued timestamptz; b_status text;
BEGIN
  SELECT operator_id, kind, quantity, claim_codes_issued_at, status
    INTO b_operator, b_kind, b_quantity, b_issued, b_status
    FROM media_batch WHERE id = p_batch AND operator_id = claim_session_operator() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  IF b_kind <> 'PUBLIC' THEN
    RAISE EXCEPTION 'CLAIM_CODES_NOT_PUBLIC : seuls les lots PUBLIC portent un code de rattachement' USING ERRCODE = 'CL020';
  END IF;
  IF b_issued IS NOT NULL THEN
    RAISE EXCEPTION 'CLAIM_CODES_ALREADY_ISSUED : le fichier de commande de ce lot a déjà été produit' USING ERRCODE = 'CL020';
  END IF;
  IF b_status = 'CLOSED' THEN
    RAISE EXCEPTION 'CLAIM_CODES_BATCH_CLOSED : lot clos' USING ERRCODE = 'CL020';
  END IF;
  IF p_hashes IS NULL OR cardinality(p_hashes) <> b_quantity THEN
    RAISE EXCEPTION 'CLAIM_CODES_COUNT : un code par bracelet du lot est attendu' USING ERRCODE = 'CL020';
  END IF;
  INSERT INTO claim_code (operator_id, batch_id, code_hash) SELECT b_operator, p_batch, h FROM unnest(p_hashes) AS h;
  UPDATE media_batch SET claim_codes_issued_at = clock_timestamp() WHERE id = p_batch;
  RETURN b_quantity;
END $$;

-- Associe un code imprimé à son bracelet (scan au poste, ou fichier de correspondance de l'imprimeur).
-- Chaque refus a son motif, pour que l'import puisse l'indiquer ligne par ligne.
CREATE FUNCTION associate_claim_code(p_hash bytea, p_media uuid) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE v_operator uuid := claim_session_operator(); c claim_code%ROWTYPE; m_batch uuid; m_hash bytea;
BEGIN
  SELECT batch_id, claim_code_hash INTO m_batch, m_hash FROM media WHERE id = p_media AND operator_id = v_operator FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  SELECT * INTO c FROM claim_code WHERE operator_id = v_operator AND code_hash = p_hash FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CLAIM_CODE_UNKNOWN : code inconnu' USING ERRCODE = 'CL020';
  ELSIF c.invalidated_at IS NOT NULL THEN
    RAISE EXCEPTION 'CLAIM_CODE_INVALIDATED : code invalidé à la clôture du lot' USING ERRCODE = 'CL020';
  ELSIF c.media_id IS NOT NULL THEN
    RAISE EXCEPTION 'CLAIM_CODE_ALREADY_ASSOCIATED : code déjà associé à un bracelet' USING ERRCODE = 'CL020';
  ELSIF m_batch IS DISTINCT FROM c.batch_id THEN
    RAISE EXCEPTION 'CLAIM_CODE_OTHER_BATCH : ce code appartient à un autre lot' USING ERRCODE = 'CL020';
  ELSIF m_hash IS NOT NULL THEN
    RAISE EXCEPTION 'MEDIA_ALREADY_HAS_CODE : ce bracelet porte déjà un code' USING ERRCODE = 'CL020';
  END IF;
  UPDATE claim_code SET media_id = p_media, associated_at = clock_timestamp() WHERE id = c.id;
  UPDATE media SET claim_code_hash = p_hash WHERE id = p_media;
END $$;

-- Invalide les codes d'un lot jamais associés à une puce (clôture du lot, §7.8).
CREATE FUNCTION invalidate_unassociated_codes(p_batch uuid) RETURNS int
LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  PERFORM 1 FROM media_batch WHERE id = p_batch AND operator_id = claim_session_operator();
  IF NOT FOUND THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  UPDATE claim_code SET invalidated_at = clock_timestamp()
   WHERE batch_id = p_batch AND media_id IS NULL AND invalidated_at IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

-- Consomme le code d'un bracelet (activation par l'app : le rattachement se fait à l'activation elle-même).
CREATE FUNCTION mark_claim_code_used(p_media uuid) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM media WHERE id = p_media AND operator_id = claim_session_operator();
  IF NOT FOUND THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  UPDATE media SET claim_code_used_at = clock_timestamp()
   WHERE id = p_media AND claim_code_hash IS NOT NULL AND claim_code_used_at IS NULL;
END $$;

-- 5. Rattachement -----------------------------------------------------------------------------------------------
-- Résultats : ATTACHED (rattaché), PENDING (demande en attente créée), NOT_ACTIVE (code valide d'un bracelet pas
-- encore activé : l'appelant l'active puis consomme le code), REFUSED (toute autre situation, sans distinction),
-- BLOCKED (limite d'essais). `p_claim_id` et `p_confirmation_hash` sont fournis par l'appelant, qui a tiré le code de
-- confirmation : ils ne servent que si une demande est créée.
CREATE FUNCTION claim_media(p_hash bytea, p_customer uuid, p_device_ref text, p_claim_id uuid, p_confirmation_hash bytea)
RETURNS TABLE (outcome text, claim_id uuid, media_id uuid, expires_at timestamptz)
LANGUAGE plpgsql AS $$
DECLARE v_operator uuid := claim_session_operator();
        m_id uuid; m_status text; m_used timestamptz;
        v_outcome text := 'REFUSED'; v_expires timestamptz; v_wallets int; v_attached int; v_spendable bigint; v_pending int;
BEGIN
  IF p_customer IS NULL OR NOT EXISTS (SELECT 1 FROM party WHERE id = p_customer AND kind = 'CUSTOMER' AND operator_id = v_operator) THEN
    RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found';
  END IF;
  IF claim_attempts_exceeded(v_operator, p_customer, p_device_ref) THEN
    INSERT INTO claim_attempt (operator_id, customer_id, device_ref, code_hash, outcome) VALUES (v_operator, p_customer, p_device_ref, p_hash, 'BLOCKED');
    RETURN QUERY SELECT 'BLOCKED'::text, NULL::uuid, NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;

  SELECT m.id, m.status, m.claim_code_used_at INTO m_id, m_status, m_used
    FROM media m WHERE m.operator_id = v_operator AND m.claim_code_hash = p_hash FOR UPDATE;

  IF FOUND AND m_used IS NULL THEN
    PERFORM expire_media_claims(m_id);
    IF m_status IN ('PERSONALIZED','ISSUED') THEN
      v_outcome := 'NOT_ACTIVE';
    ELSIF m_status = 'ACTIVE' THEN
      SELECT count(*), count(w.customer_id), coalesce(sum(wallet_spendable(w.id)), 0)
        INTO v_wallets, v_attached, v_spendable
        FROM media_assignment ma JOIN wallet w ON w.id = ma.wallet_id
       WHERE ma.media_id = m_id AND ma.released_at IS NULL;
      IF v_wallets > 0 AND v_attached = 0 THEN
        IF v_spendable = 0 THEN
          UPDATE wallet w SET customer_id = p_customer
            FROM media_assignment ma WHERE ma.wallet_id = w.id AND ma.media_id = m_id AND ma.released_at IS NULL;
          UPDATE media SET claim_code_used_at = clock_timestamp() WHERE id = m_id;
          UPDATE media_claim SET status = 'CANCELLED' WHERE media_claim.media_id = m_id AND status = 'PENDING';
          v_outcome := 'ATTACHED';
        ELSE
          SELECT count(*) INTO v_pending FROM media_claim c WHERE c.media_id = m_id AND c.status = 'PENDING';
          IF v_pending < 3 AND p_claim_id IS NOT NULL AND p_confirmation_hash IS NOT NULL THEN
            v_expires := clock_timestamp() + interval '24 hours';
            INSERT INTO media_claim (id, operator_id, media_id, customer_id, confirmation_hash, expires_at)
            VALUES (p_claim_id, v_operator, m_id, p_customer, p_confirmation_hash, v_expires);
            v_outcome := 'PENDING';
          END IF;
        END IF;
      END IF;
    END IF;
  END IF;

  INSERT INTO claim_attempt (operator_id, customer_id, device_ref, code_hash, outcome) VALUES (v_operator, p_customer, p_device_ref, p_hash, v_outcome);
  IF v_outcome = 'REFUSED' THEN
    IF m_id IS NOT NULL THEN UPDATE media SET claim_attempts = claim_attempts + 1 WHERE id = m_id; END IF;
    RETURN QUERY SELECT 'REFUSED'::text, NULL::uuid, NULL::uuid, NULL::timestamptz;
  ELSE
    RETURN QUERY SELECT v_outcome, CASE WHEN v_outcome = 'PENDING' THEN p_claim_id END, m_id, v_expires;
  END IF;
END $$;

-- Confirmation au guichet (ADR-57) : même bracelet que la demande, bon code de confirmation, 5 essais au plus.
-- Résultats : CONFIRMED ; WRONG_CODE (essai compté ; au cinquième la demande est annulée) ; WRONG_MEDIA (autre
-- bracelet : la demande est annulée) ; REFUSED (demande absente, expirée, déjà décidée, ou portefeuille déjà rattaché).
-- Les changements d'état sont validés même quand le résultat est un refus : la fonction rend un texte, elle ne lève pas.
CREATE FUNCTION confirm_media_claim(p_claim uuid, p_media uuid, p_confirmation_hash bytea, p_device uuid, p_actor uuid)
RETURNS text
LANGUAGE plpgsql AS $$
DECLARE v_operator uuid := claim_session_operator(); c media_claim%ROWTYPE; m_status text; v_attached int; v_wallets int;
BEGIN
  SELECT * INTO c FROM media_claim WHERE id = p_claim AND operator_id = v_operator FOR UPDATE;
  IF NOT FOUND THEN RETURN 'REFUSED'; END IF;
  IF c.status = 'PENDING' AND c.expires_at <= clock_timestamp() THEN
    UPDATE media_claim SET status = 'EXPIRED' WHERE id = c.id;
    RETURN 'REFUSED';
  END IF;
  IF c.status <> 'PENDING' OR c.attempts >= 5 THEN RETURN 'REFUSED'; END IF;
  IF p_device IS NULL OR p_actor IS NULL THEN
    RAISE EXCEPTION 'Terminal et agent de confirmation obligatoires' USING ERRCODE = 'CL001';
  END IF;
  IF p_media IS DISTINCT FROM c.media_id THEN
    UPDATE media_claim SET status = 'CANCELLED' WHERE id = c.id;
    RETURN 'WRONG_MEDIA';
  END IF;
  IF p_confirmation_hash IS DISTINCT FROM c.confirmation_hash THEN
    UPDATE media_claim SET attempts = attempts + 1, status = CASE WHEN attempts + 1 >= 5 THEN 'CANCELLED' ELSE status END
     WHERE id = c.id;
    RETURN 'WRONG_CODE';
  END IF;

  SELECT status INTO m_status FROM media WHERE id = c.media_id FOR UPDATE;
  SELECT count(*), count(w.customer_id) INTO v_wallets, v_attached
    FROM media_assignment ma JOIN wallet w ON w.id = ma.wallet_id
   WHERE ma.media_id = c.media_id AND ma.released_at IS NULL;
  IF m_status <> 'ACTIVE' OR v_wallets = 0 OR v_attached > 0 THEN
    UPDATE media_claim SET status = 'CANCELLED' WHERE id = c.id;
    RETURN 'REFUSED';
  END IF;

  -- Rattachement sans mouvement d'argent : le portefeuille anonyme devient celui du compte.
  UPDATE wallet w SET customer_id = c.customer_id
    FROM media_assignment ma WHERE ma.wallet_id = w.id AND ma.media_id = c.media_id AND ma.released_at IS NULL;
  UPDATE media SET claim_code_used_at = clock_timestamp() WHERE id = c.media_id AND claim_code_hash IS NOT NULL;
  UPDATE media_claim SET status = 'CONFIRMED', confirmed_device_id = p_device, confirmed_by = p_actor, confirmed_at = clock_timestamp()
   WHERE id = c.id;
  UPDATE media_claim SET status = 'CANCELLED' WHERE media_id = c.media_id AND status = 'PENDING' AND id <> c.id;
  RETURN 'CONFIRMED';
END $$;

-- Consultation anonyme du solde (§8.5, contrat `lookupBalanceByClaimCode`) : lecture seule, sans donnée personnelle,
-- tant que le bracelet n'est rattaché à aucun compte. La route est publique : il n'y a ni compte ni prestataire de
-- session, et le code seul désigne le bracelet. La fonction est donc SECURITY DEFINER et ne dépend pas de
-- `app.operator_id` ; elle ne rend que le solde et les 10 derniers mouvements du bracelet désigné, rien d'autre.
-- `p_address_ref` : référence de l'adresse appelante (empreinte calculée par l'API, jamais l'adresse en clair).
-- Limites du contrat : 20 consultations par code et par heure, 60 par adresse et par heure → BLOCKED.
-- Une ligne par portefeuille (devise) ; REFUSED sans distinction pour un code inconnu, utilisé, ou un bracelet rattaché.
CREATE FUNCTION public_balance_lookup(p_hash bytea, p_address_ref text)
RETURNS TABLE (outcome text, currency char(3), spendable bigint, media_status text, movements jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE m_id uuid; m_operator uuid; m_status text; v_found boolean := false; v_blocked boolean;
BEGIN
  IF p_hash IS NULL OR octet_length(p_hash) <> 32 OR p_address_ref IS NULL THEN
    RAISE EXCEPTION 'Empreinte de 32 octets et référence d''adresse attendues' USING ERRCODE = 'CL001';
  END IF;
  SELECT m.id, m.operator_id, m.status INTO m_id, m_operator, m_status FROM media m
   WHERE m.claim_code_hash = p_hash AND m.claim_code_used_at IS NULL AND m.status = 'ACTIVE'
     AND NOT EXISTS (SELECT 1 FROM media_assignment ma JOIN wallet w ON w.id = ma.wallet_id
                      WHERE ma.media_id = m.id AND ma.released_at IS NULL AND w.customer_id IS NOT NULL);
  v_blocked := (SELECT count(*) FROM claim_attempt a WHERE a.device_ref = p_address_ref AND a.customer_id IS NULL
                   AND a.outcome <> 'BLOCKED' AND a.attempted_at > clock_timestamp() - interval '1 hour') >= 60
            OR (SELECT count(*) FROM claim_attempt a WHERE a.code_hash = p_hash AND a.customer_id IS NULL
                   AND a.outcome <> 'BLOCKED' AND a.attempted_at > clock_timestamp() - interval '1 hour') >= 20;
  IF v_blocked THEN
    INSERT INTO claim_attempt (operator_id, device_ref, code_hash, outcome) VALUES (m_operator, p_address_ref, p_hash, 'BLOCKED');
    RETURN QUERY SELECT 'BLOCKED'::text, NULL::char(3), NULL::bigint, NULL::text, NULL::jsonb;
    RETURN;
  END IF;
  IF m_id IS NOT NULL THEN
    RETURN QUERY
      SELECT 'LOOKUP'::text, ma.currency,
             (SELECT coalesce(-sum(ab.balance), 0)::bigint FROM account a JOIN account_balance ab ON ab.account_id = a.id
               WHERE a.wallet_id = ma.wallet_id AND a.purpose IN ('WALLET_PAID','WALLET_PROMO')),
             m_status,
             coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.occurred_at DESC) FROM (
                         SELECT t.occurred_at, t.type, (-sum(p.amount))::bigint AS amount
                           FROM posting p JOIN account a ON a.id = p.account_id
                           JOIN journal_transaction t ON t.id = p.transaction_id
                          WHERE a.wallet_id = ma.wallet_id AND a.purpose IN ('WALLET_PAID','WALLET_PROMO')
                          GROUP BY t.id, t.occurred_at, t.type
                          ORDER BY t.occurred_at DESC LIMIT 10) x), '[]'::jsonb)
        FROM media_assignment ma WHERE ma.media_id = m_id AND ma.released_at IS NULL;
    v_found := FOUND;
  END IF;
  INSERT INTO claim_attempt (operator_id, device_ref, code_hash, outcome)
  VALUES (m_operator, p_address_ref, p_hash, CASE WHEN v_found THEN 'LOOKUP' ELSE 'REFUSED' END);
  IF NOT v_found THEN
    RETURN QUERY SELECT 'REFUSED'::text, NULL::char(3), NULL::bigint, NULL::text, NULL::jsonb;
  END IF;
END $$;
-- Fonction DEFINER : retirée à PUBLIC ; post-roles.sql l'accorde au seul rôle de l'API.
REVOKE ALL ON FUNCTION public_balance_lookup(bytea, text) FROM PUBLIC;
