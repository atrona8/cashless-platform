-- Migration 0033 : paiement, annulation et approbation sur place (mission
-- terminaux-paiement-en-ligne, lot WP04 ; FR-006, FR-009, FR-010, FR-014, FR-016, FR-017,
-- NFR-005, NFR-006, C-001 ; data-model « sale_attribution », « journal_transaction :
-- renforcement », « approval_token_use : appelant terminal », codes d'erreur ;
-- contracts/payments.md ; research R-05, R-06, R-11 constats A1, A5, A9, A11, A17, A18, A19 ;
-- décisions DM-01M5HRNBX5CTP7CAKN4JRCY3F9 et ADR-123 ; arbitrages de l'orchestrateur du
-- 22/10/2026).
--
-- Contenu :
--   1. Table `sale_attribution` (vendeur, session, terminal et canal d'une vente ou d'une
--      annulation ; ou personne auteur au back-office). RLS activée et forcée, ajout seul.
--   2. `vendor_session` : contrainte UNIQUE (id, device_id, operator_id), cible des clés
--      étrangères composites de `sale_attribution` et `approval_token_use`.
--   3. Index unique `journal_transaction_reverses_once` : une vente ne s'annule qu'une fois (A19 :
--      l'API traduit la violation par le NOM de l'index, pas par tout 23505).
--   4. `approval_token_use` : appelant terminal (terminal + session de vendeur) en plus de
--      l'appelant personne ; exactement un appelant ; objet visé (`target_id`) pour lier le jeton
--      consommé à la vente annulée (renforcement de l'arbitrage du 22/10).
--   5. `approval_request_action_check` : liste de 0011 recopiée à l'identique, plus SALE_REVERSAL.
--   6. Fonctions SECURITY DEFINER, `search_path = public, pg_temp` (règle de 0021), EXECUTE retiré
--      à PUBLIC. Aucun GRANT ici : les droits de `cashless_app` sont posés par `post-roles.sql`
--      (lot WP07).
--        record_sale_attribution  attribution d'une vente ou d'une annulation (vendeur et terminal
--                                 lus dans la session, jamais reçus ; A11)
--        assert_tap_payable       lecture `tap_id` payable par ce terminal, bracelet ACTIVE
--                                 (A1, A18)
--        assert_wallet_payable    portefeuille ACTIVE relu FOR SHARE (A17)
--        consume_tap              remplacée : corps de 0026 à l'identique, plus le terminal de
--                                 l'écriture comparé à celui de la lecture (A18)
--        assert_reversible        garde d'annulation, trois modes (A5, A9 ; ADR-123)
--
-- Chaque lecture nomme le prestataire de la session (`app.operator_id`) : aucune fonction ne
-- s'appuie sur la RLS (même hypothèse sur le propriétaire que 0022). Sans prestataire : P0002.
-- Heure : celle de la base (`clock_timestamp()`), jamais reçue en paramètre.
--
-- Ordre global des verrous (contracts/vendors.md, A7) :
--   terminal -> vendeur -> session de vendeur -> demande QR -> bracelet -> portefeuille.
-- Le terminal est pris FOR UPDATE par `record_device_seq` (API) avant tout appel de ce fichier ;
-- aucune fonction ici ne prend le terminal. Une fonction peut sauter un échelon, jamais en prendre
-- un plus haut après un plus bas.
--
-- Erreurs (traduites par apps/api/src/errors/sqlstate-map.ts, lot WP08) :
--   CL001   paramètre invalide ; annulation hors LIVE / CLOSING      -> 422 VALIDATION_FAILED
--   CL022   lecture inconnue, d'un autre terminal, déjà utilisée ou expirée
--                                                                     -> 409 TAP_UNUSABLE
--   CL032   session de vendeur absente, close, expirée, d'un autre terminal
--                                                                     -> 409 VENDOR_SESSION_INVALID
--   CL035   vente déjà annulée                                        -> 409 ALREADY_REVERSED
--   CL036   annulation refusée : autre terminal, autre vendeur, vente non PURCHASE, preuve
--           d'approbation absente                                     -> 422 REVERSAL_NOT_ALLOWED
--   CL040   fenêtre d'annulation dépassée, contrôlée APRÈS terminal et vendeur (ADR-123)
--                                                                   -> 409 REVERSAL_WINDOW_EXPIRED
--   CL038   bracelet non ACTIVE (arbitrage du 22/10)                  -> 422 MEDIA_BLOCKED
--   CL039   portefeuille non ACTIVE (arbitrage du 22/10)              -> 422 WALLET_BLOCKED
--   23505   seconde attribution (clé primaire) ; seconde annulation
--           (`journal_transaction_reverses_once`, traduite par son nom) -> 409 ALREADY_REVERSED
--   P0002   objet introuvable ou d'un autre prestataire               -> 404

-- 1. vendor_session : cible des clés composites ---------------------------------------------------
-- Une session désignée avec un terminal et un prestataire est bien la session de ce terminal chez
-- ce prestataire (contrôle par la table, sans déclencheur SECURITY DEFINER).
ALTER TABLE vendor_session
  ADD CONSTRAINT vendor_session_id_device_operator_key UNIQUE (id, device_id, operator_id);

-- 2. sale_attribution -----------------------------------------------------------------------------
-- Une ligne par vente PURCHASE et par annulation REVERSAL. Au terminal : vendeur, session et
-- terminal (tous lus dans la session par record_sale_attribution) ; annulation par un SUPERVISOR au
-- terminal : en plus `actor_user_id` (le valideur) ; au back-office : `actor_user_id` seul
-- (auteur).
CREATE TABLE sale_attribution (
  transaction_id    uuid PRIMARY KEY REFERENCES journal_transaction(id),
  operator_id       uuid NOT NULL REFERENCES party(id),
  vendor_id         uuid REFERENCES vendor(id),
  vendor_session_id uuid,
  device_id         uuid REFERENCES device(id),
  channel           text NOT NULL CONSTRAINT sale_attribution_channel
                    CHECK (channel IN ('NFC','MERCHANT_QR','CUSTOMER_QR')),
  actor_user_id     uuid REFERENCES app_user(id),
  created_at        timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT sale_attribution_terminal_all_or_none
    CHECK ((vendor_id IS NULL) = (vendor_session_id IS NULL)
           AND (vendor_session_id IS NULL) = (device_id IS NULL)),
  CONSTRAINT sale_attribution_has_author
    CHECK (vendor_session_id IS NOT NULL OR actor_user_id IS NOT NULL),
  CONSTRAINT sale_attribution_session_fk FOREIGN KEY (vendor_session_id, device_id, operator_id)
    REFERENCES vendor_session (id, device_id, operator_id)
);
CREATE INDEX sale_attribution_vendor_idx ON sale_attribution (vendor_id, created_at);
CREATE INDEX sale_attribution_session_idx ON sale_attribution (vendor_session_id);

CREATE TRIGGER sale_attribution_immutable BEFORE UPDATE OR DELETE ON sale_attribution
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

ALTER TABLE sale_attribution ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale_attribution FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON sale_attribution
  USING (operator_id = current_setting('app.operator_id', true)::uuid)
  WITH CHECK (operator_id = current_setting('app.operator_id', true)::uuid);

-- 3. Une vente ne s'annule qu'une fois (A19) ------------------------------------------------------
-- Deux annulations simultanées : la seconde attend la première à l'insertion, puis échoue (23505,
-- contrainte `journal_transaction_reverses_once`). Aucun scénario du kit n'annule deux fois une
-- vente (vérifié : gen_tests.py, gen_golden.py, scenario_reference.json, suites tests/).
CREATE UNIQUE INDEX journal_transaction_reverses_once ON journal_transaction (reverses_id)
  WHERE reverses_id IS NOT NULL;

-- 4. approval_token_use : appelant terminal -------------------------------------------------------
-- Appelant personne (`caller_id`, inchangé) OU appelant terminal (`caller_device_id` et
-- `caller_vendor_session_id` ensemble) : exactement un. `approval_token_use_distinct_people` reste
-- telle quelle : elle vaut pour l'appelant personne (avec `caller_id` nul, elle est sans objet ; un
-- vendeur n'est pas une personne). La session est celle du terminal appelant, chez le même
-- prestataire (clé composite). `target_id` : objet visé par l'opération approuvée (la vente pour
-- `reversePayment`), relu par assert_reversible ; nul pour les usages existants. Ajout seul et RLS
-- inchangés ; l'insertion reste faite par l'API (ON CONFLICT (jti) DO NOTHING).
ALTER TABLE approval_token_use ALTER COLUMN caller_id DROP NOT NULL;
ALTER TABLE approval_token_use
  ADD COLUMN caller_device_id uuid,
  ADD COLUMN caller_vendor_session_id uuid,
  ADD COLUMN target_id uuid;
ALTER TABLE approval_token_use ADD CONSTRAINT approval_token_use_one_caller
  CHECK ((caller_id IS NOT NULL AND caller_device_id IS NULL AND caller_vendor_session_id IS NULL)
         OR (caller_id IS NULL AND caller_device_id IS NOT NULL
             AND caller_vendor_session_id IS NOT NULL));
ALTER TABLE approval_token_use ADD CONSTRAINT approval_token_use_caller_session_fk
  FOREIGN KEY (caller_vendor_session_id, caller_device_id, operator_id)
  REFERENCES vendor_session (id, device_id, operator_id);

-- 5. Action SALE_REVERSAL -------------------------------------------------------------------------
-- Liste de 0011 (dernière définition) recopiée à l'identique, plus SALE_REVERSAL. La contrainte
-- approval_request_platform_scope (0009) reste telle quelle : SALE_REVERSAL a toujours un
-- prestataire.
ALTER TABLE approval_request DROP CONSTRAINT approval_request_action_check;
ALTER TABLE approval_request ADD CONSTRAINT approval_request_action_check CHECK (action IN (
  'LATE_CLAIM','ADJUSTMENT','ANOMALY_RESOLUTION','WAIVE_SEQ_GAP','FORCE_CENTRAL_AUTHORITY','REINSTATE_MEDIA','PAYOUT',
  'DEVICE_JOURNAL_IMPORT','KYC_REVOCATION','PSP_CONFIGURATION','EVENT_PSP_SELECTION','WALLET_REFUND','LATE_CHARGEBACK',
  'EVENT_GO_LIVE','EVENT_SETTINGS_CHANGE','EVENT_OPERATOR_SETTINGS_CHANGE','PARTICIPATION_CHANGE','FEE_RULE_CHANGE',
  'CONTRACT_VERSION','PLATFORM_CONTRACT_VERSION','JURISDICTION_LIMITS_CHANGE',
  'TAG_KEY_CREATE','TAG_DEK_ROTATE','TAG_KEY_RETIRE',
  'SALE_REVERSAL'));

-- 6a. record_sale_attribution (A11) ---------------------------------------------------------------
-- Appelée après le moteur, dans la transaction de l'écriture. Vendeur et terminal sont LUS dans la
-- session, jamais reçus. La session a déjà été prise FOR SHARE par assert_vendor_session (API) :
-- simple relecture ici (aucun verrou pris après le portefeuille du moteur).
--   - p_tx : PURCHASE ou REVERSAL du prestataire, sinon P0002 (même erreur qu'inexistante) ;
--   - avec session : session du prestataire, ouverte, non expirée, du terminal de l'écriture, sinon
--     CL032 ; une personne (`p_actor_user`) n'y est admise que pour une annulation dont elle est le
--     valideur (`approved_by` ; SUPERVISOR au terminal), sinon CL001 ;
--   - sans session : `p_actor_user` obligatoire, écriture BACKOFFICE dont il est l'auteur
--     (`created_by`), sinon CL001 ;
--   - PURCHASE : canal obligatoire ; REVERSAL : canal recopié de l'attribution de la vente annulée
--     (`p_channel` nul ou égal, sinon CL001) ;
--   - seconde attribution : 23505 (clé primaire), laissé tel quel.
CREATE FUNCTION record_sale_attribution(p_tx uuid, p_vendor_session uuid, p_channel text,
                                        p_actor_user uuid DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_operator uuid := nullif(current_setting('app.operator_id', true), '')::uuid;
  tx journal_transaction%ROWTYPE;
  s vendor_session%ROWTYPE;
  v_channel text := p_channel;
  v_original text;
BEGIN
  IF v_operator IS NULL OR p_tx IS NULL THEN
    RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found';
  END IF;
  SELECT * INTO tx FROM journal_transaction t WHERE t.id = p_tx AND t.operator_id = v_operator;
  IF NOT FOUND OR tx.type NOT IN ('PURCHASE','REVERSAL') THEN
    RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found';
  END IF;
  IF p_channel IS NOT NULL AND p_channel NOT IN ('NFC','MERCHANT_QR','CUSTOMER_QR') THEN
    RAISE EXCEPTION 'Attribution : canal inconnu' USING ERRCODE = 'CL001';
  END IF;
  IF p_vendor_session IS NOT NULL THEN
    SELECT * INTO s FROM vendor_session vs
     WHERE vs.id = p_vendor_session AND vs.operator_id = v_operator;
    IF NOT FOUND OR s.closed_at IS NOT NULL OR s.expires_at <= clock_timestamp()
       OR tx.device_id IS DISTINCT FROM s.device_id THEN
      RAISE EXCEPTION 'Session de vendeur invalide' USING ERRCODE = 'CL032';
    END IF;
    IF p_actor_user IS NOT NULL
       AND (tx.type <> 'REVERSAL' OR tx.approved_by IS DISTINCT FROM p_actor_user) THEN
      RAISE EXCEPTION 'Attribution : personne admise seulement comme valideur d''une annulation'
        USING ERRCODE = 'CL001';
    END IF;
  ELSE
    IF p_actor_user IS NULL OR tx.source <> 'BACKOFFICE'
       OR tx.created_by IS DISTINCT FROM p_actor_user THEN
      RAISE EXCEPTION 'Attribution : sans session, auteur de l''écriture au back-office requis'
        USING ERRCODE = 'CL001';
    END IF;
  END IF;
  IF tx.type = 'PURCHASE' THEN
    IF p_channel IS NULL THEN
      RAISE EXCEPTION 'Attribution : canal requis pour une vente' USING ERRCODE = 'CL001';
    END IF;
  ELSE
    SELECT a.channel INTO v_original FROM sale_attribution a
     WHERE a.transaction_id = tx.reverses_id AND a.operator_id = v_operator;
    IF v_original IS NOT NULL THEN
      IF p_channel IS NOT NULL AND p_channel <> v_original THEN
        RAISE EXCEPTION 'Attribution : canal différent de celui de la vente annulée'
          USING ERRCODE = 'CL001';
      END IF;
      v_channel := v_original;
    ELSIF p_channel IS NULL THEN
      RAISE EXCEPTION 'Attribution : vente annulée sans attribution, canal requis'
        USING ERRCODE = 'CL001';
    END IF;
  END IF;
  INSERT INTO sale_attribution (transaction_id, operator_id, vendor_id, vendor_session_id,
                                device_id, channel, actor_user_id)
  VALUES (tx.id, v_operator, s.vendor_id, s.id, s.device_id, v_channel, p_actor_user);
END $$;
REVOKE ALL ON FUNCTION record_sale_attribution(uuid, uuid, text, uuid) FROM PUBLIC;

-- 6b. assert_tap_payable (A1, A18) ----------------------------------------------------------------
-- Paiement par `tap_id` : remplace TapService.byId (qui ne relisait pas le bracelet). Prend D'ABORD
-- le verrou consultatif de consume_tap (même lecture : une écriture ou une demande concurrente
-- attend), puis lit la lecture du prestataire de la session. Lecture inconnue, d'un autre terminal,
-- déjà consommée (écriture ou demande de rattachement) ou hors `tap_replay_window_seconds`
-- (`received_at` contre l'heure de la base, même calcul que consume_tap) : CL022. Bracelet relu
-- FOR SHARE (une suspension concurrente attend la fin du paiement, ou le paiement la voit) : non
-- ACTIVE → CL038. Rend le bracelet et son portefeuille.
CREATE FUNCTION assert_tap_payable(p_tap bigint, p_device uuid)
  RETURNS TABLE (media_id uuid, wallet_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE
  v_operator uuid := nullif(current_setting('app.operator_id', true), '')::uuid;
  t media_tap%ROWTYPE;
  m media%ROWTYPE;
  win int;
BEGIN
  IF v_operator IS NULL THEN
    RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found';
  END IF;
  IF p_tap IS NULL OR p_device IS NULL THEN
    RAISE EXCEPTION 'Lecture inutilisable' USING ERRCODE = 'CL022';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('media-tap-use:' || p_tap::text, 0));
  SELECT * INTO t FROM media_tap x WHERE x.id = p_tap AND x.operator_id = v_operator;
  IF NOT FOUND OR t.device_id IS DISTINCT FROM p_device OR t.transaction_id IS NOT NULL
     OR EXISTS (SELECT 1 FROM media_claim c
                 WHERE c.confirmed_tap_id = p_tap AND c.operator_id = v_operator) THEN
    RAISE EXCEPTION 'Lecture % inutilisable', p_tap USING ERRCODE = 'CL022';
  END IF;
  SELECT coalesce((SELECT e.tap_replay_window_seconds FROM device d
                      JOIN event e ON e.id = d.event_id WHERE d.id = t.device_id), 120)
    INTO win;
  IF t.received_at < clock_timestamp() - make_interval(secs => greatest(win, 1)) THEN
    RAISE EXCEPTION 'Lecture % expirée', p_tap USING ERRCODE = 'CL022';
  END IF;
  SELECT * INTO m FROM media x WHERE x.id = t.media_id AND x.operator_id = v_operator FOR SHARE;
  IF NOT FOUND OR m.status <> 'ACTIVE' OR m.wallet_id IS NULL THEN
    RAISE EXCEPTION 'Bracelet bloqué' USING ERRCODE = 'CL038';
  END IF;
  media_id := m.id;
  wallet_id := m.wallet_id;
  RETURN NEXT;
END $$;
REVOKE ALL ON FUNCTION assert_tap_payable(bigint, uuid) FROM PUBLIC;

-- 6c. assert_wallet_payable (A17) -----------------------------------------------------------------
-- Portefeuille du prestataire relu FOR SHARE (dernier échelon de l'ordre global ; le moteur ne
-- prend pas la ligne du portefeuille, verrou compatible avec ses clés étrangères). Inconnu :
-- P0002 ; non ACTIVE : CL039.
CREATE FUNCTION assert_wallet_payable(p_wallet uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_operator uuid := nullif(current_setting('app.operator_id', true), '')::uuid;
  v_status text;
BEGIN
  IF v_operator IS NULL OR p_wallet IS NULL THEN
    RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found';
  END IF;
  SELECT w.status INTO v_status FROM wallet w
   WHERE w.id = p_wallet AND w.operator_id = v_operator FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'Portefeuille bloqué' USING ERRCODE = 'CL039';
  END IF;
END $$;
REVOKE ALL ON FUNCTION assert_wallet_payable(uuid) FROM PUBLIC;

-- 6d. consume_tap remplacée (A18) -----------------------------------------------------------------
-- Même signature (la suite de référence compte consume_tap dans pg_proc ; tests_execute_grants.sql
-- la nomme). Corps de 0026 À L'IDENTIQUE (verrou consultatif, FOR UPDATE, assert_tenant,
-- prestataire, bracelet, rejeu de la même écriture, CL022 si déjà utilisée, garde OP-N50 avec
-- prestataire, fenêtre ONLINE), plus un contrôle : une écriture faite pour un terminal ne consomme
-- qu'une lecture de CE terminal (CL022). Écriture sans terminal (`device_id` nul : suite de
-- référence, gen_tests.py) : comportement inchangé. Appelants existants (deposit.controller.ts,
-- cash-due.controller.ts) : écriture et lecture du même terminal (TapService.byId le filtre déjà).
-- CREATE OR REPLACE efface le réglage : search_path reposé ; EXECUTE retiré à PUBLIC (0024 et 0026
-- ne l'avaient pas fait ; post-roles.sql le retirait déjà).
CREATE OR REPLACE FUNCTION consume_tap(p_tap bigint, p_tx uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE t media_tap%ROWTYPE; win int; tx journal_transaction%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('media-tap-use:' || p_tap::text, 0));
  SELECT * INTO t FROM media_tap WHERE id = p_tap FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  PERFORM assert_tenant(t.operator_id);
  SELECT * INTO tx FROM journal_transaction WHERE id = p_tx;
  IF NOT FOUND OR tx.operator_id <> t.operator_id THEN
    RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found';
  END IF;
  IF tx.media_id IS NOT NULL AND tx.media_id <> t.media_id THEN
    RAISE EXCEPTION 'Le passage % ne concerne pas le bracelet de l''écriture', p_tap USING ERRCODE = 'CL001';
  END IF;
  -- 0033 (A18) : la lecture doit venir du terminal de l'écriture.
  IF tx.device_id IS NOT NULL AND tx.device_id IS DISTINCT FROM t.device_id THEN
    RAISE EXCEPTION 'Passage % lu par un autre terminal que celui de l''écriture', p_tap
      USING ERRCODE = 'CL022';
  END IF;
  IF t.transaction_id = p_tx THEN RETURN; END IF;                    -- rejeu de la même écriture
  IF t.transaction_id IS NOT NULL THEN
    RAISE EXCEPTION 'Passage % déjà utilisé par une autre écriture', p_tap USING ERRCODE = 'CL022';
  END IF;
  -- OP-N50 : une lecture qui a confirmé une demande de rattachement est déjà consommée.
  IF EXISTS (SELECT 1 FROM media_claim WHERE confirmed_tap_id = p_tap AND operator_id = t.operator_id) THEN
    RAISE EXCEPTION 'Passage % déjà utilisé par une demande de rattachement', p_tap
      USING ERRCODE = 'CL022';
  END IF;
  -- Une écriture EN LIGNE doit suivre son passage de moins de tap_replay_window_seconds (120 s par
  -- défaut) ; une opération de lot hors ligne consomme son passage quel que soit le délai.
  IF tx.source = 'ONLINE' THEN
    SELECT coalesce((SELECT e.tap_replay_window_seconds FROM device d JOIN event e ON e.id = d.event_id
                      WHERE d.id = t.device_id), 120)
      INTO win;
    IF t.received_at < clock_timestamp() - make_interval(secs => greatest(win, 1)) THEN
      RAISE EXCEPTION 'Passage % expiré', p_tap USING ERRCODE = 'CL022';
    END IF;
  END IF;
  UPDATE media_tap SET transaction_id = p_tx WHERE id = p_tap;
END $$;
REVOKE ALL ON FUNCTION consume_tap(bigint, uuid) FROM PUBLIC;

-- 6e. assert_reversible (A5, A9 ; ADR-123 ; arbitrages du 22/10) ----------------------------------
-- Appelée sur TOUS les chemins d'annulation, avant le moteur. VOLATILE (elle verrouille vendeur et
-- session). Modes :
--   VENDOR             vendeur de la vente, à son terminal ;
--   SUPERVISOR_DEVICE  SUPERVISOR au terminal, par jeton sur place (`p_jti`) ;
--   BACKOFFICE         demande SALE_REVERSAL approuvée à deux personnes (`p_approval_request`).
-- Paramètres d'un mode absents, ou ceux d'un autre mode présents : CL001.
-- Contrôles communs, dans cet ordre : vente du prestataire (sinon P0002, pas de fuite d'existence),
-- type PURCHASE (CL036), pas déjà annulée (CL035), événement de la vente LIVE ou CLOSING (matrice
-- SPECIFICATION §12.1 : REVERSAL hors synchronisation refusée à partir de RECONCILING ; CL001 ;
-- renforcement, le moteur le contrôle aussi).
-- VENDOR : terminal de la vente = p_device ; session ouverte de ce terminal (vendeur puis session
--   FOR SHARE) ; vendeur de la session = vendeur attribué à la vente ; vendeur ACTIVE non bloqué.
--   Échec : CL036. Ensuite SEULEMENT (ADR-123 : un autre vendeur n'apprend pas l'âge de la vente)
--   la fenêtre : clock_timestamp() <= recorded_at + reversal_window_minutes (valeur de l'événement
--   lue maintenant) ; dépassée : CL040.
-- SUPERVISOR_DEVICE : session ouverte de ce terminal ; terminal du même événement que la vente ;
--   preuve en base (renforcement retenu) : ligne approval_token_use `p_jti` du prestataire,
--   consommée DANS CETTE TRANSACTION (used_at >= now()), opération `reversePayment`, appelant =
--   ce terminal et cette session, objet visé = la vente, valideur personne ACTIVE du prestataire
--   détenant SUPERVISOR non retiré sur l'événement de la vente ou son organisateur.
--   Vendeur et fenêtre non contrôlés. Échec : CL036.
-- BACKOFFICE : preuve en base (renforcement retenu) : demande SALE_REVERSAL du prestataire,
--   APPROVED, visant la vente (`target_id` et `payload.transaction_id`), auteur et valideur
--   distincts, personnes ACTIVE du prestataire détenant SUPERVISOR ou ORGANIZER_ADMIN non retiré
--   sur l'événement de la vente ou son organisateur. Échec : CL036.
-- Rend ce que le moteur relit pour écrire le REVERSAL : grand livre, événement, portefeuille (celui
-- des comptes de la vente ; nul si aucun), bracelet.
CREATE FUNCTION assert_reversible(p_tx uuid, p_mode text, p_device uuid DEFAULT NULL,
                                  p_vendor_session uuid DEFAULT NULL, p_jti text DEFAULT NULL,
                                  p_approval_request uuid DEFAULT NULL)
  RETURNS TABLE (ledger_id uuid, event_id uuid, wallet_id uuid, media_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE
  v_operator uuid := nullif(current_setting('app.operator_id', true), '')::uuid;
  tx journal_transaction%ROWTYPE;
  ev event%ROWTYPE;
  s vendor_session%ROWTYPE;
  v_vendor uuid;
  v_vendor_status text;
  v_vendor_locked timestamptz;
  v_sold_by uuid;
  v_device_event uuid;
  v_wallets uuid[];
BEGIN
  -- 0. Forme des paramètres.
  IF p_mode IS NULL OR p_mode NOT IN ('VENDOR','SUPERVISOR_DEVICE','BACKOFFICE') THEN
    RAISE EXCEPTION 'Annulation : mode inconnu' USING ERRCODE = 'CL001';
  END IF;
  IF (p_mode IN ('VENDOR','SUPERVISOR_DEVICE')
      AND (p_device IS NULL OR p_vendor_session IS NULL OR p_approval_request IS NOT NULL))
     OR (p_mode = 'VENDOR' AND p_jti IS NOT NULL)
     OR (p_mode = 'SUPERVISOR_DEVICE' AND p_jti IS NULL)
     OR (p_mode = 'BACKOFFICE'
         AND (p_device IS NOT NULL OR p_vendor_session IS NOT NULL OR p_jti IS NOT NULL
              OR p_approval_request IS NULL)) THEN
    RAISE EXCEPTION 'Annulation : paramètres incompatibles avec le mode %', p_mode
      USING ERRCODE = 'CL001';
  END IF;
  IF v_operator IS NULL OR p_tx IS NULL THEN
    RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found';
  END IF;
  -- 1. Contrôles communs (tous les modes, A9).
  SELECT * INTO tx FROM journal_transaction t WHERE t.id = p_tx AND t.operator_id = v_operator;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found';
  END IF;
  IF tx.type <> 'PURCHASE' THEN
    RAISE EXCEPTION 'Annulation refusée : seule une vente s''annule' USING ERRCODE = 'CL036';
  END IF;
  IF EXISTS (SELECT 1 FROM journal_transaction r WHERE r.reverses_id = p_tx) THEN
    RAISE EXCEPTION 'Vente déjà annulée' USING ERRCODE = 'CL035';
  END IF;
  SELECT * INTO ev FROM event e WHERE e.id = tx.event_id AND e.operator_id = v_operator;
  IF NOT FOUND OR ev.status NOT IN ('LIVE','CLOSING') THEN
    RAISE EXCEPTION 'Annulation refusée : événement ni LIVE ni CLOSING' USING ERRCODE = 'CL001';
  END IF;
  -- 2. Terminal et session (VENDOR, SUPERVISOR_DEVICE) : vendeur puis session FOR SHARE (ordre
  --    global ; déjà pris par assert_vendor_session dans la même transaction : compatible).
  IF p_mode IN ('VENDOR','SUPERVISOR_DEVICE') THEN
    SELECT vs.vendor_id INTO v_vendor FROM vendor_session vs
     WHERE vs.id = p_vendor_session AND vs.operator_id = v_operator AND vs.device_id = p_device;
    IF v_vendor IS NULL THEN
      RAISE EXCEPTION 'Annulation refusée : session de vendeur' USING ERRCODE = 'CL036';
    END IF;
    SELECT v.status, v.locked_at INTO v_vendor_status, v_vendor_locked FROM vendor v
     WHERE v.id = v_vendor AND v.operator_id = v_operator FOR SHARE;
    SELECT * INTO s FROM vendor_session vs
     WHERE vs.id = p_vendor_session AND vs.operator_id = v_operator FOR SHARE;
    IF s.id IS NULL OR s.device_id <> p_device OR s.vendor_id <> v_vendor
       OR s.closed_at IS NOT NULL OR s.expires_at <= clock_timestamp() THEN
      RAISE EXCEPTION 'Annulation refusée : session de vendeur' USING ERRCODE = 'CL036';
    END IF;
  END IF;
  IF p_mode = 'VENDOR' THEN
    SELECT a.vendor_id INTO v_sold_by FROM sale_attribution a
     WHERE a.transaction_id = p_tx AND a.operator_id = v_operator;
    IF tx.device_id IS DISTINCT FROM p_device OR v_sold_by IS DISTINCT FROM v_vendor
       OR v_vendor_status IS DISTINCT FROM 'ACTIVE' OR v_vendor_locked IS NOT NULL THEN
      RAISE EXCEPTION 'Annulation refusée : autre terminal ou autre vendeur'
        USING ERRCODE = 'CL036';
    END IF;
    -- Fenêtre, contrôlée en dernier (ADR-123), à l'heure de la base et ancrée sur recorded_at (A5).
    IF clock_timestamp() > tx.recorded_at + make_interval(mins => ev.reversal_window_minutes) THEN
      RAISE EXCEPTION 'Fenêtre d''annulation dépassée' USING ERRCODE = 'CL040';
    END IF;
  ELSIF p_mode = 'SUPERVISOR_DEVICE' THEN
    SELECT d.event_id INTO v_device_event FROM device d
     WHERE d.id = p_device AND d.operator_id = v_operator;
    IF v_device_event IS DISTINCT FROM tx.event_id THEN
      RAISE EXCEPTION 'Annulation refusée : terminal d''un autre événement' USING ERRCODE = 'CL036';
    END IF;
    IF NOT EXISTS (
         SELECT 1 FROM approval_token_use u
           JOIN app_user p ON p.id = u.approver_id AND p.operator_id = v_operator
                          AND p.status = 'ACTIVE'
          WHERE u.jti = p_jti AND u.operator_id = v_operator
            AND u.operation_id = 'reversePayment'
            AND u.caller_id IS NULL AND u.caller_device_id = p_device
            AND u.caller_vendor_session_id = p_vendor_session
            AND u.target_id = p_tx
            AND u.used_at >= now()
            AND EXISTS (SELECT 1 FROM role_assignment r
                         WHERE r.user_id = u.approver_id AND r.operator_id = v_operator
                           AND r.role = 'SUPERVISOR' AND r.revoked_at IS NULL
                           AND ((r.scope_type = 'EVENT' AND r.scope_id = ev.id)
                                OR (r.scope_type = 'ORGANIZER' AND r.scope_id = ev.organizer_id))))
    THEN
      RAISE EXCEPTION 'Annulation refusée : aucun jeton sur place consommé pour cette vente'
        USING ERRCODE = 'CL036';
    END IF;
  ELSE
    IF NOT EXISTS (
         SELECT 1 FROM approval_request q
          WHERE q.id = p_approval_request AND q.operator_id = v_operator
            AND q.action = 'SALE_REVERSAL' AND q.status = 'APPROVED'
            AND q.target_id = p_tx AND q.payload ->> 'transaction_id' = p_tx::text
            AND q.decided_by IS NOT NULL AND q.decided_by <> q.requested_by
            AND (SELECT count(*) FROM app_user p
                  WHERE p.id IN (q.requested_by, q.decided_by) AND p.operator_id = v_operator
                    AND p.status = 'ACTIVE'
                    AND EXISTS (SELECT 1 FROM role_assignment r
                                 WHERE r.user_id = p.id AND r.operator_id = v_operator
                                   AND r.role IN ('SUPERVISOR','ORGANIZER_ADMIN')
                                   AND r.revoked_at IS NULL
                                   AND ((r.scope_type = 'EVENT' AND r.scope_id = ev.id)
                                        OR (r.scope_type = 'ORGANIZER'
                                            AND r.scope_id = ev.organizer_id)))) = 2)
    THEN
      RAISE EXCEPTION 'Annulation refusée : aucune demande SALE_REVERSAL approuvée pour cette vente'
        USING ERRCODE = 'CL036';
    END IF;
  END IF;
  -- 3. Ce que le moteur relit.
  SELECT array_agg(DISTINCT a.wallet_id) INTO v_wallets
    FROM posting po JOIN account a ON a.id = po.account_id AND a.operator_id = v_operator
   WHERE po.transaction_id = p_tx AND po.operator_id = v_operator AND a.wallet_id IS NOT NULL;
  IF coalesce(cardinality(v_wallets), 0) > 1 THEN
    RAISE EXCEPTION 'Annulation refusée : vente sur plusieurs portefeuilles'
      USING ERRCODE = 'CL036';
  END IF;
  ledger_id := tx.ledger_id;
  event_id := tx.event_id;
  wallet_id := v_wallets[1];
  media_id := tx.media_id;
  RETURN NEXT;
END $$;
REVOKE ALL ON FUNCTION assert_reversible(uuid, text, uuid, uuid, text, uuid) FROM PUBLIC;
