-- Migration 0034 : demandes de paiement QR (mission terminaux-paiement-en-ligne, lot WP05 ; FR-018,
-- FR-019, FR-020, NFR-005, NFR-007, NFR-008, C-001, C-009 ; data-model « payment_request et
-- payment_request_detail », codes d'erreur ; contracts/qr-payments.md ; research R-06, R-08,
-- R-11 A3, A10, A17, A24, A25 ; ADR-123 ; arbitrages de l'orchestrateur du 22/10/2026).
--
-- Contenu :
--   1. Table `payment_request_detail` : complète une demande MERCHANT_QR créée par un terminal
--      (session de vendeur, clé de la vente à écrire, lignes, version du catalogue retenue). RLS
--      activée et forcée, ajout seul (`forbid_mutation`). `payment_request` (schéma de référence)
--      reste inchangée : aucun ALTER TABLE.
--   2. Fonctions SECURITY DEFINER, `search_path = public, pg_temp` (règle de 0021), EXECUTE retiré
--      à PUBLIC. Aucun GRANT ici : les droits de `cashless_app` sont posés par `post-roles.sql`
--      (lot WP07, qui retire aussi INSERT, UPDATE et la lecture de `nonce_hash`).
--        create_merchant_payment_request  QR commerçant, par un terminal (FR-018)
--        create_customer_qr_token         QR client, par l'app (FR-019, A25)
--        lock_payment_request_for_pay     côté festivalier : verrouille et contrôle avant la vente
--        lock_customer_qr_token           côté terminal : verrouille un QR client avant la vente
--        confirm_payment_request          lie la demande à la vente exacte écrite par le moteur
--        cancel_payment_request           annulation par le terminal d'origine ou avec le jeton
--        payment_request_for_token        consultation par le festivalier avec le jeton (A24)
--
-- Le jeton n'arrive jamais en base : l'API passe `nonce_hash = sha256(jeton)` (32 octets). L'API
-- fait « verrouiller -> moteur (PURCHASE) -> confirm_payment_request » dans UNE transaction (A10) ;
-- SQL n'appelle pas le moteur.
--
-- Chaque lecture nomme le prestataire de la session (`app.operator_id`) : aucune fonction ne
-- s'appuie sur la RLS (même hypothèse sur le propriétaire que 0022). Sans prestataire : P0002.
-- Heure : celle de la base (`clock_timestamp()`), jamais reçue. Une demande expirée n'est pas
-- réécrite EXPIRED : elle est relue comme telle à l'heure de la base.
--
-- Ordre global des verrous (contracts/vendors.md, A7) :
--   terminal -> vendeur -> session de vendeur -> demande QR -> bracelet -> portefeuille.
-- Côté terminal, l'API a déjà pris le terminal FOR UPDATE (record_device_seq). Côté festivalier,
-- aucun verrou préalable : lock_payment_request_for_pay prend elle-même chaque échelon, dans
-- l'ordre. Une fonction peut sauter un échelon, jamais en prendre un plus haut après un plus bas.
--
-- Erreurs (traduites par apps/api/src/errors/sqlstate-map.ts) :
--   CL001   paramètre invalide ; terminal hors mode de vente ; événement non LIVE ; QR client sur
--           un grand livre de portée ORGANIZER                       -> 422 VALIDATION_FAILED
--   CL030   terminal suspendu (création commerçant)                  -> 403 DEVICE_SUSPENDED
--   42501   terminal révoqué (création commerçant)                   -> 403 DEVICE_REVOKED
--   CL032   session de vendeur invalide (création commerçant, assert_vendor_session)
--                                                                    -> 409 VENDOR_SESSION_INVALID
--   CL034   lignes refusées (création commerçant, check_sale_lines)  -> 422 SALE_LINES_INVALID
--   CL037   demande inconnue, d'un autre prestataire, payée, annulée, expirée, mauvais jeton,
--           mauvais portefeuille, vente qui ne correspond pas ; UN SEUL message pour toutes les
--           causes                                                   -> 409 PAYMENT_REQUEST_NOT_PENDING
--           (sur POST /payments avec un QR client : 422 QR_TOKEN_INVALID, ADR-123)
--   23505   empreinte déjà prise (l'API régénère le jeton) ; clé de vente déjà prise
--   P0002   pas de prestataire de session ; terminal inconnu (création commerçant) -> 404

-- 1. payment_request_detail -----------------------------------------------------------------------
-- Une ligne par demande MERCHANT_QR (seule create_merchant_payment_request l'écrit). La clé de la
-- vente (`idempotency_key`) est choisie par l'API, unique par prestataire ; la vente écrite au
-- paiement doit la porter (confirm_payment_request). `lines` nul en KEYPAD_TPE ; `catalog_version`
-- = version retenue par check_sale_lines à la création (nulle en KEYPAD_TPE).
CREATE TABLE payment_request_detail (
  payment_request_id uuid PRIMARY KEY REFERENCES payment_request(id),
  operator_id        uuid NOT NULL REFERENCES party(id),
  vendor_session_id  uuid NOT NULL REFERENCES vendor_session(id),
  idempotency_key    text NOT NULL CONSTRAINT payment_request_detail_idempotency_key
                     CHECK (length(idempotency_key) BETWEEN 1 AND 200),
  lines              jsonb,
  catalog_version    int CONSTRAINT payment_request_detail_catalog_version
                     CHECK (catalog_version >= 1),
  created_at         timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT payment_request_detail_lines_version
    CHECK ((lines IS NULL) = (catalog_version IS NULL)),
  CONSTRAINT payment_request_detail_key_once UNIQUE (operator_id, idempotency_key)
);
CREATE INDEX payment_request_detail_session_idx ON payment_request_detail (vendor_session_id);

CREATE TRIGGER payment_request_detail_immutable BEFORE UPDATE OR DELETE ON payment_request_detail
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

ALTER TABLE payment_request_detail ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_request_detail FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON payment_request_detail
  USING (operator_id = current_setting('app.operator_id', true)::uuid)
  WITH CHECK (operator_id = current_setting('app.operator_id', true)::uuid);

-- 2a. QR commerçant (FR-018) ----------------------------------------------------------------------
-- Appelée par l'API après record_device_seq (terminal FOR UPDATE) et assert_device_active.
-- Contrôles, dans cet ordre :
--   - forme : montant > 0, devise, durée 15 à 300 s, empreinte de 32 octets, clé de vente de 1 à
--     200 caractères (CL001) ;
--   - terminal du prestataire relu FOR SHARE (P0002 ; révoqué 42501 ; suspendu CL030, comme
--     assert_device_active), en mode CATALOG_POS ou KEYPAD_TPE, affecté à un événement LIVE dont
--     la devise est `p_currency` (CL001) ;
--   - session : assert_vendor_session (vendeur puis session FOR SHARE ; CL032) ;
--   - CATALOG_POS : lignes présentes, contrôlées par check_sale_lines (WP03, sans écriture ;
--     CL034), version retenue écrite ; KEYPAD_TPE : lignes et version absentes (CL001).
--     `p_catalog_version` reçu n'est qu'indicatif : c'est la version retenue par la base qui est
--     écrite (une version servie plus ancienne mais aux mêmes prix donne la version courante).
-- Écrit `payment_request` (MERCHANT_QR, PENDING, expiration = heure de la base + durée) et sa
-- ligne `payment_request_detail`. Empreinte ou clé déjà prise : 23505, laissé tel quel (l'API
-- régénère ; jamais traduit en succès).
CREATE FUNCTION create_merchant_payment_request(p_device uuid, p_vendor_session uuid,
                                                p_amount bigint, p_currency char(3),
                                                p_ttl_seconds int, p_nonce_hash bytea,
                                                p_idempotency_key text, p_lines jsonb,
                                                p_catalog_version int)
RETURNS TABLE (payment_request_id uuid, expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE
  v_operator uuid := nullif(current_setting('app.operator_id', true), '')::uuid;
  d device%ROWTYPE;
  ev event%ROWTYPE;
  v_version int;
  v_id uuid;
  v_expires timestamptz;
BEGIN
  IF v_operator IS NULL OR p_device IS NULL THEN
    RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found';
  END IF;
  -- Message sans valeur : ni l'empreinte ni la clé n'apparaissent dans une erreur.
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Demande QR : montant strictement positif attendu' USING ERRCODE = 'CL001';
  END IF;
  IF p_currency IS NULL OR p_ttl_seconds IS NULL OR p_ttl_seconds NOT BETWEEN 15 AND 300 THEN
    RAISE EXCEPTION 'Demande QR : devise et durée de 15 à 300 s attendues' USING ERRCODE = 'CL001';
  END IF;
  IF p_nonce_hash IS NULL OR octet_length(p_nonce_hash) <> 32 THEN
    RAISE EXCEPTION 'Demande QR : empreinte de 32 octets attendue' USING ERRCODE = 'CL001';
  END IF;
  IF p_idempotency_key IS NULL OR length(p_idempotency_key) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'Demande QR : clé de vente de 1 à 200 caractères attendue'
      USING ERRCODE = 'CL001';
  END IF;
  -- Terminal (déjà tenu FOR UPDATE par l'API : FOR SHARE ne prend rien de plus).
  SELECT * INTO d FROM device x WHERE x.id = p_device AND x.operator_id = v_operator FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  IF d.status = 'REVOKED' THEN
    RAISE EXCEPTION 'Terminal révoqué' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF d.status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'Terminal suspendu' USING ERRCODE = 'CL030';
  END IF;
  IF d.app_mode NOT IN ('CATALOG_POS','KEYPAD_TPE') THEN
    RAISE EXCEPTION 'Demande QR : terminal hors mode de vente' USING ERRCODE = 'CL001';
  END IF;
  SELECT * INTO ev FROM event e WHERE e.id = d.event_id AND e.operator_id = v_operator;
  IF NOT FOUND OR ev.status <> 'LIVE' THEN
    RAISE EXCEPTION 'Demande QR : terminal sans événement LIVE' USING ERRCODE = 'CL001';
  END IF;
  IF ev.currency <> p_currency THEN
    RAISE EXCEPTION 'Demande QR : devise différente de celle de l''événement'
      USING ERRCODE = 'CL001';
  END IF;
  -- Session de vendeur (vendeur puis session FOR SHARE ; CL032).
  PERFORM assert_vendor_session(d.id, p_vendor_session);
  IF d.app_mode = 'CATALOG_POS' THEN
    IF p_lines IS NULL THEN
      RAISE EXCEPTION 'Demande QR : lignes requises en CATALOG_POS' USING ERRCODE = 'CL001';
    END IF;
    v_version := check_sale_lines(d.id, p_lines, p_amount);
  ELSIF p_lines IS NOT NULL OR p_catalog_version IS NOT NULL THEN
    RAISE EXCEPTION 'Demande QR : ni lignes ni version en KEYPAD_TPE' USING ERRCODE = 'CL001';
  END IF;
  INSERT INTO payment_request (operator_id, event_id, direction, device_id, wallet_id, amount,
                               currency, nonce_hash, expires_at, status, transaction_id)
  VALUES (v_operator, ev.id, 'MERCHANT_QR', d.id, NULL, p_amount, ev.currency, p_nonce_hash,
          clock_timestamp() + make_interval(secs => p_ttl_seconds), 'PENDING', NULL)
  RETURNING id, payment_request.expires_at INTO v_id, v_expires;
  INSERT INTO payment_request_detail (payment_request_id, operator_id, vendor_session_id,
                                      idempotency_key, lines, catalog_version)
  VALUES (v_id, v_operator, p_vendor_session, p_idempotency_key,
          CASE WHEN d.app_mode = 'CATALOG_POS' THEN p_lines END, v_version);
  RETURN QUERY SELECT v_id, v_expires;
END $$;
REVOKE ALL ON FUNCTION create_merchant_payment_request(uuid, uuid, bigint, char, int, bytea, text,
                                                       jsonb, int) FROM PUBLIC;

-- 2b. QR client (FR-019, A25) ---------------------------------------------------------------------
-- Portefeuille du prestataire, du festivalier `p_customer`, ACTIVE, relu FOR SHARE ; sinon CL037
-- (un seul message : rien n'est révélé d'un portefeuille d'autrui). Paramètres mal formés : CL001.
-- Événement = `ledger.scope_id` quand le grand livre est de portée EVENT (A25) ; portée ORGANIZER
-- (plusieurs événements) : refusé, CL001 (arbitrage du 22/10). Devise du grand livre ; montant et
-- terminal nuls ; durée fixe de 60 s. Une demande client PENDING du même portefeuille n'est pas
-- annulée (rien au contrat). Empreinte déjà prise : 23505, laissé tel quel.
CREATE FUNCTION create_customer_qr_token(p_customer uuid, p_wallet uuid, p_nonce_hash bytea)
RETURNS TABLE (payment_request_id uuid, expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE
  v_operator uuid := nullif(current_setting('app.operator_id', true), '')::uuid;
  w wallet%ROWTYPE;
  l ledger%ROWTYPE;
  v_id uuid;
  v_expires timestamptz;
BEGIN
  IF v_operator IS NULL THEN
    RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found';
  END IF;
  IF p_customer IS NULL OR p_wallet IS NULL OR p_nonce_hash IS NULL
     OR octet_length(p_nonce_hash) <> 32 THEN
    RAISE EXCEPTION 'QR client : festivalier, portefeuille et empreinte de 32 octets attendus'
      USING ERRCODE = 'CL001';
  END IF;
  SELECT * INTO w FROM wallet x
   WHERE x.id = p_wallet AND x.operator_id = v_operator FOR SHARE;
  IF NOT FOUND OR w.customer_id IS DISTINCT FROM p_customer OR w.status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'Demande de paiement indisponible' USING ERRCODE = 'CL037';
  END IF;
  SELECT * INTO l FROM ledger x WHERE x.id = w.ledger_id AND x.operator_id = v_operator;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Demande de paiement indisponible' USING ERRCODE = 'CL037';
  END IF;
  IF l.scope_type <> 'EVENT' THEN
    RAISE EXCEPTION 'QR client : portefeuille sans événement unique (grand livre non EVENT)'
      USING ERRCODE = 'CL001';
  END IF;
  PERFORM 1 FROM event e WHERE e.id = l.scope_id AND e.operator_id = v_operator;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Demande de paiement indisponible' USING ERRCODE = 'CL037';
  END IF;
  INSERT INTO payment_request (operator_id, event_id, direction, device_id, wallet_id, amount,
                               currency, nonce_hash, expires_at, status, transaction_id)
  VALUES (v_operator, l.scope_id, 'CUSTOMER_QR', NULL, w.id, NULL, l.currency, p_nonce_hash,
          clock_timestamp() + interval '60 seconds', 'PENDING', NULL)
  RETURNING id, payment_request.expires_at INTO v_id, v_expires;
  RETURN QUERY SELECT v_id, v_expires;
END $$;
REVOKE ALL ON FUNCTION create_customer_qr_token(uuid, uuid, bytea) FROM PUBLIC;

-- 2c. Verrouillage côté festivalier (MERCHANT_QR) -------------------------------------------------
-- Lit SANS verrou le terminal et la session de la demande (colonnes jamais modifiées), puis prend
-- dans l'ordre global : terminal FOR SHARE, vendeur FOR SHARE, session FOR SHARE, demande
-- FOR UPDATE, portefeuille FOR SHARE. Contrôles sous verrou : demande MERCHANT_QR, PENDING, non
-- expirée (heure de la base), même empreinte ; portefeuille du festivalier, ACTIVE, dans la
-- devise de la demande et sur le grand livre de l'événement de la demande (portée EVENT de cet
-- événement, ou ORGANIZER de son organisateur : même définition que la configuration des
-- terminaux) ; terminal ACTIVE ; session de ce terminal, ouverte, non expirée ; vendeur ACTIVE et
-- non bloqué. Tout échec : CL037, même message (un terminal suspendu n'est pas révélé au
-- festivalier).
-- Écrit `wallet_id = p_wallet` dans la demande (encore PENDING, sous FOR UPDATE) : c'est le
-- portefeuille que confirm_payment_request exige de la vente. Annulé avec la transaction si la
-- vente échoue ; réécrit par un verrouillage ultérieur tant que la demande n'est pas confirmée.
CREATE FUNCTION lock_payment_request_for_pay(p_id uuid, p_nonce_hash bytea, p_wallet uuid,
                                             p_customer uuid)
RETURNS TABLE (device_id uuid, vendor_session_id uuid, vendor_id uuid, event_id uuid,
               ledger_id uuid, amount bigint, currency char(3), idempotency_key text,
               lines jsonb, catalog_version int)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE
  v_operator uuid := nullif(current_setting('app.operator_id', true), '')::uuid;
  v_device uuid;
  v_session uuid;
  v_vendor uuid;
  d device%ROWTYPE;
  v vendor%ROWTYPE;
  s vendor_session%ROWTYPE;
  r payment_request%ROWTYPE;
  k payment_request_detail%ROWTYPE;
  w wallet%ROWTYPE;
  l ledger%ROWTYPE;
  ev event%ROWTYPE;
BEGIN
  IF v_operator IS NULL THEN
    RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found';
  END IF;
  IF p_id IS NULL OR p_nonce_hash IS NULL OR p_wallet IS NULL OR p_customer IS NULL THEN
    RAISE EXCEPTION 'Demande de paiement indisponible' USING ERRCODE = 'CL037';
  END IF;
  -- 1. Lecture sans verrou : terminal, session et vendeur de la demande.
  SELECT pr.device_id, dt.vendor_session_id, vs.vendor_id INTO v_device, v_session, v_vendor
    FROM payment_request pr
    JOIN payment_request_detail dt ON dt.payment_request_id = pr.id
                                  AND dt.operator_id = v_operator
    JOIN vendor_session vs ON vs.id = dt.vendor_session_id AND vs.operator_id = v_operator
   WHERE pr.id = p_id AND pr.operator_id = v_operator AND pr.direction = 'MERCHANT_QR';
  IF v_device IS NULL OR v_session IS NULL OR v_vendor IS NULL THEN
    RAISE EXCEPTION 'Demande de paiement indisponible' USING ERRCODE = 'CL037';
  END IF;
  -- 2. Verrous dans l'ordre global.
  SELECT * INTO d FROM device x WHERE x.id = v_device AND x.operator_id = v_operator FOR SHARE;
  SELECT * INTO v FROM vendor x WHERE x.id = v_vendor AND x.operator_id = v_operator FOR SHARE;
  SELECT * INTO s FROM vendor_session x
   WHERE x.id = v_session AND x.operator_id = v_operator FOR SHARE;
  SELECT * INTO r FROM payment_request x
   WHERE x.id = p_id AND x.operator_id = v_operator FOR UPDATE;
  SELECT * INTO w FROM wallet x WHERE x.id = p_wallet AND x.operator_id = v_operator FOR SHARE;
  -- 3. Contrôles.
  SELECT * INTO k FROM payment_request_detail x
   WHERE x.payment_request_id = p_id AND x.operator_id = v_operator;
  SELECT * INTO ev FROM event x WHERE x.id = r.event_id AND x.operator_id = v_operator;
  SELECT * INTO l FROM ledger x WHERE x.id = w.ledger_id AND x.operator_id = v_operator;
  IF r.id IS NULL OR r.direction <> 'MERCHANT_QR' OR r.status <> 'PENDING'
     OR r.expires_at <= clock_timestamp() OR r.nonce_hash <> p_nonce_hash
     OR r.device_id IS DISTINCT FROM d.id OR k.payment_request_id IS NULL
     OR w.id IS NULL OR w.customer_id IS DISTINCT FROM p_customer OR w.status <> 'ACTIVE'
     OR l.id IS NULL OR ev.id IS NULL OR l.currency <> r.currency
     OR NOT ((l.scope_type = 'EVENT' AND l.scope_id = ev.id)
             OR (l.scope_type = 'ORGANIZER' AND l.scope_id = ev.organizer_id))
     OR d.id IS NULL OR d.status <> 'ACTIVE'
     OR s.id IS NULL OR s.id <> k.vendor_session_id OR s.device_id <> d.id
     OR s.vendor_id <> v_vendor OR s.closed_at IS NOT NULL OR s.expires_at <= clock_timestamp()
     OR v.id IS NULL OR v.status <> 'ACTIVE' OR v.locked_at IS NOT NULL THEN
    RAISE EXCEPTION 'Demande de paiement indisponible' USING ERRCODE = 'CL037';
  END IF;
  UPDATE payment_request x SET wallet_id = w.id WHERE x.id = r.id AND x.operator_id = v_operator;
  RETURN QUERY SELECT d.id, s.id, v.id, ev.id, l.id, r.amount, r.currency, k.idempotency_key,
                      k.lines, k.catalog_version;
END $$;
REVOKE ALL ON FUNCTION lock_payment_request_for_pay(uuid, bytea, uuid, uuid) FROM PUBLIC;

-- 2d. Verrouillage côté terminal (CUSTOMER_QR) ----------------------------------------------------
-- Dans la transaction de createPayment : le terminal est déjà tenu FOR UPDATE par l'API (lu ici
-- sans verrou). Demande FOR UPDATE (par l'empreinte, chez le prestataire), CUSTOMER_QR, PENDING,
-- non expirée, du même événement que le terminal ; portefeuille FOR SHARE, ACTIVE. Sinon CL037
-- (traduit en 422 QR_TOKEN_INVALID sur cette route, ADR-123).
CREATE FUNCTION lock_customer_qr_token(p_nonce_hash bytea, p_device uuid)
RETURNS TABLE (payment_request_id uuid, wallet_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE
  v_operator uuid := nullif(current_setting('app.operator_id', true), '')::uuid;
  v_event uuid;
  r payment_request%ROWTYPE;
  w wallet%ROWTYPE;
BEGIN
  IF v_operator IS NULL THEN
    RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found';
  END IF;
  IF p_nonce_hash IS NULL OR p_device IS NULL THEN
    RAISE EXCEPTION 'Demande de paiement indisponible' USING ERRCODE = 'CL037';
  END IF;
  SELECT x.event_id INTO v_event FROM device x
   WHERE x.id = p_device AND x.operator_id = v_operator;
  SELECT * INTO r FROM payment_request x
   WHERE x.nonce_hash = p_nonce_hash AND x.operator_id = v_operator FOR UPDATE;
  IF r.id IS NULL OR v_event IS NULL OR r.direction <> 'CUSTOMER_QR' OR r.status <> 'PENDING'
     OR r.expires_at <= clock_timestamp() OR r.event_id <> v_event OR r.wallet_id IS NULL THEN
    RAISE EXCEPTION 'Demande de paiement indisponible' USING ERRCODE = 'CL037';
  END IF;
  SELECT * INTO w FROM wallet x
   WHERE x.id = r.wallet_id AND x.operator_id = v_operator FOR SHARE;
  IF w.id IS NULL OR w.status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'Demande de paiement indisponible' USING ERRCODE = 'CL037';
  END IF;
  RETURN QUERY SELECT r.id, w.id;
END $$;
REVOKE ALL ON FUNCTION lock_customer_qr_token(bytea, uuid) FROM PUBLIC;

-- 2e. Confirmation : la demande est liée à la vente exacte (A10) ----------------------------------
-- Exige aussi l'empreinte (arbitrage du 22/10 : pas de marque locale à la transaction) et
-- revérifie tout. Reprend la demande FOR UPDATE NOWAIT : déjà tenue par cette transaction (après
-- lock_*), immédiat ; tenue par une autre : 55P03 traduit en CL037. Contrôles :
--   - demande PENDING, non expirée, même empreinte, portefeuille posé par le verrouillage ;
--   - vente du prestataire, PURCHASE, source ONLINE, du grand livre du portefeuille, de
--     l'événement de la demande, non déjà liée à une autre demande ;
--   - montant débité au portefeuille = Σ des lignes de la vente sur les comptes WALLET_PAID et
--     WALLET_PROMO de CE portefeuille (débits positifs) ; aucun autre portefeuille touché ;
--   - MERCHANT_QR : montant = `amount`, `tx.device_id` = terminal de la demande,
--     `tx.idempotency_key` = clé du détail, session de la demande encore ouverte ;
--   - CUSTOMER_QR : `tx.device_id` non nul, terminal du prestataire affecté à l'événement de la
--     demande ; montant > 0.
-- Tout refus : CL037, même message. Écrit CONFIRMED et `transaction_id` (CUSTOMER_QR : aussi le
-- montant et le terminal de la vente). MERCHANT_QR : attribution par la session de la demande
-- (record_sale_attribution, canal MERCHANT_QR) ; CUSTOMER_QR : attribution faite par le paiement
-- du terminal (WP11).
CREATE FUNCTION confirm_payment_request(p_id uuid, p_tx uuid, p_nonce_hash bytea) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_operator uuid := nullif(current_setting('app.operator_id', true), '')::uuid;
  r payment_request%ROWTYPE;
  k payment_request_detail%ROWTYPE;
  t journal_transaction%ROWTYPE;
  w wallet%ROWTYPE;
  s vendor_session%ROWTYPE;
  v_debit numeric;
  v_ok boolean;
BEGIN
  IF v_operator IS NULL THEN
    RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found';
  END IF;
  IF p_id IS NULL OR p_tx IS NULL OR p_nonce_hash IS NULL THEN
    RAISE EXCEPTION 'Demande de paiement indisponible' USING ERRCODE = 'CL037';
  END IF;
  BEGIN
    SELECT * INTO r FROM payment_request x
     WHERE x.id = p_id AND x.operator_id = v_operator FOR UPDATE NOWAIT;
  EXCEPTION WHEN lock_not_available THEN
    RAISE EXCEPTION 'Demande de paiement indisponible' USING ERRCODE = 'CL037';
  END;
  IF r.id IS NULL OR r.status <> 'PENDING' OR r.expires_at <= clock_timestamp()
     OR r.nonce_hash <> p_nonce_hash OR r.wallet_id IS NULL THEN
    RAISE EXCEPTION 'Demande de paiement indisponible' USING ERRCODE = 'CL037';
  END IF;
  SELECT * INTO w FROM wallet x WHERE x.id = r.wallet_id AND x.operator_id = v_operator;
  SELECT * INTO t FROM journal_transaction x WHERE x.id = p_tx AND x.operator_id = v_operator;
  IF w.id IS NULL OR t.id IS NULL OR t.type <> 'PURCHASE' OR t.source <> 'ONLINE'
     OR t.ledger_id <> w.ledger_id OR t.event_id IS DISTINCT FROM r.event_id
     OR t.device_id IS NULL
     OR EXISTS (SELECT 1 FROM payment_request x
                 WHERE x.transaction_id = p_tx AND x.operator_id = v_operator) THEN
    RAISE EXCEPTION 'Demande de paiement indisponible' USING ERRCODE = 'CL037';
  END IF;
  -- Montant débité à CE portefeuille ; aucun autre portefeuille touché par la vente.
  SELECT coalesce(sum(po.amount) FILTER (WHERE a.wallet_id = w.id), 0),
         bool_and(a.wallet_id = w.id)
    INTO v_debit, v_ok
    FROM posting po JOIN account a ON a.id = po.account_id AND a.operator_id = v_operator
   WHERE po.transaction_id = p_tx AND po.operator_id = v_operator
     AND a.purpose IN ('WALLET_PAID','WALLET_PROMO');
  IF v_debit <= 0 OR v_ok IS NOT TRUE OR v_debit > 9223372036854775807 THEN
    RAISE EXCEPTION 'Demande de paiement indisponible' USING ERRCODE = 'CL037';
  END IF;
  IF r.direction = 'MERCHANT_QR' THEN
    SELECT * INTO k FROM payment_request_detail x
     WHERE x.payment_request_id = r.id AND x.operator_id = v_operator;
    SELECT * INTO s FROM vendor_session x
     WHERE x.id = k.vendor_session_id AND x.operator_id = v_operator;
    IF k.payment_request_id IS NULL OR v_debit <> r.amount
       OR t.device_id IS DISTINCT FROM r.device_id OR t.idempotency_key <> k.idempotency_key
       OR s.id IS NULL OR s.device_id <> r.device_id OR s.closed_at IS NOT NULL
       OR s.expires_at <= clock_timestamp() THEN
      RAISE EXCEPTION 'Demande de paiement indisponible' USING ERRCODE = 'CL037';
    END IF;
    UPDATE payment_request x SET status = 'CONFIRMED', transaction_id = t.id
     WHERE x.id = r.id AND x.operator_id = v_operator;
    PERFORM record_sale_attribution(t.id, k.vendor_session_id, 'MERCHANT_QR');
  ELSE
    PERFORM 1 FROM device x
     WHERE x.id = t.device_id AND x.operator_id = v_operator AND x.event_id = r.event_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Demande de paiement indisponible' USING ERRCODE = 'CL037';
    END IF;
    UPDATE payment_request x
       SET status = 'CONFIRMED', transaction_id = t.id, amount = v_debit::bigint,
           device_id = t.device_id
     WHERE x.id = r.id AND x.operator_id = v_operator;
  END IF;
END $$;
REVOKE ALL ON FUNCTION confirm_payment_request(uuid, uuid, bytea) FROM PUBLIC;

-- 2f. Annulation ----------------------------------------------------------------------------------
-- Exactement un de `p_device` (terminal d'origine) et `p_nonce_hash` (festivalier avec le jeton),
-- sinon CL001. Demandes MERCHANT_QR seulement. Terminal : demande de CE terminal (terminal déjà
-- tenu par l'API, puis demande FOR UPDATE) ; festivalier : même empreinte (demande FOR UPDATE, sans
-- autre verrou). PENDING non expirée -> CANCELLED ; sinon CL037, même message.
CREATE FUNCTION cancel_payment_request(p_id uuid, p_device uuid, p_nonce_hash bytea) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_operator uuid := nullif(current_setting('app.operator_id', true), '')::uuid;
  r payment_request%ROWTYPE;
BEGIN
  IF v_operator IS NULL THEN
    RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found';
  END IF;
  IF (p_device IS NULL) = (p_nonce_hash IS NULL) THEN
    RAISE EXCEPTION 'Annulation : terminal ou jeton, exactement un' USING ERRCODE = 'CL001';
  END IF;
  IF p_id IS NULL THEN
    RAISE EXCEPTION 'Demande de paiement indisponible' USING ERRCODE = 'CL037';
  END IF;
  SELECT * INTO r FROM payment_request x
   WHERE x.id = p_id AND x.operator_id = v_operator FOR UPDATE;
  IF r.id IS NULL OR r.direction <> 'MERCHANT_QR' OR r.status <> 'PENDING'
     OR r.expires_at <= clock_timestamp()
     OR (p_device IS NOT NULL AND r.device_id IS DISTINCT FROM p_device)
     OR (p_nonce_hash IS NOT NULL AND r.nonce_hash <> p_nonce_hash) THEN
    RAISE EXCEPTION 'Demande de paiement indisponible' USING ERRCODE = 'CL037';
  END IF;
  UPDATE payment_request x SET status = 'CANCELLED'
   WHERE x.id = r.id AND x.operator_id = v_operator;
END $$;
REVOKE ALL ON FUNCTION cancel_payment_request(uuid, uuid, bytea) FROM PUBLIC;

-- 2g. Consultation par le festivalier avec le jeton (A24) -----------------------------------------
-- Remplace la lecture `WHERE nonce_hash = $1` que WP07 retire à cashless_app. Exige l'identifiant
-- ET l'empreinte (plus strict qu'une lecture par l'empreinte seule) ; ne rend jamais
-- `nonce_hash`. Demande inconnue, d'un autre prestataire ou autre empreinte : CL037, même message.
-- Statut relu à l'heure de la base : PENDING expirée rendue EXPIRED (sans réécriture). Commerçant :
-- raison sociale du commerçant du point de vente du terminal (nul sans terminal). VOLATILE (non
-- STABLE) : lit clock_timestamp(), fonction volatile.
CREATE FUNCTION payment_request_for_token(p_id uuid, p_nonce_hash bytea)
RETURNS TABLE (status text, amount bigint, currency char(3), expires_at timestamptz,
               merchant_name text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE
  v_operator uuid := nullif(current_setting('app.operator_id', true), '')::uuid;
  r payment_request%ROWTYPE;
  v_merchant text;
BEGIN
  IF v_operator IS NULL THEN
    RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found';
  END IF;
  IF p_id IS NULL OR p_nonce_hash IS NULL THEN
    RAISE EXCEPTION 'Demande de paiement indisponible' USING ERRCODE = 'CL037';
  END IF;
  SELECT * INTO r FROM payment_request x WHERE x.id = p_id AND x.operator_id = v_operator;
  IF r.id IS NULL OR r.nonce_hash <> p_nonce_hash THEN
    RAISE EXCEPTION 'Demande de paiement indisponible' USING ERRCODE = 'CL037';
  END IF;
  SELECT pa.legal_name INTO v_merchant
    FROM device d
    JOIN point_of_sale p ON p.id = d.pos_id AND p.operator_id = v_operator
    JOIN merchant_participation mp ON mp.id = p.participation_id AND mp.operator_id = v_operator
    JOIN party pa ON pa.id = mp.merchant_id
   WHERE d.id = r.device_id AND d.operator_id = v_operator;
  RETURN QUERY SELECT CASE WHEN r.status = 'PENDING' AND r.expires_at <= clock_timestamp()
                           THEN 'EXPIRED' ELSE r.status END,
                      r.amount, r.currency, r.expires_at, v_merchant;
END $$;
REVOKE ALL ON FUNCTION payment_request_for_token(uuid, bytea) FROM PUBLIC;
