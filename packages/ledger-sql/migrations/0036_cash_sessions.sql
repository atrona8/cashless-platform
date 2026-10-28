-- Migration 0036 : caisses, sessions de caisse, comptages à l'aveugle et gardes (mission
-- recharges-caisses-psp, lot WP02 ; spec FR-001 à FR-004, FR-006, NFR-007, NFR-008, C-002, C-004 ;
-- data-model « cash_session », « cash_desk », « cash_session_count », « cash_session_tx » ;
-- contracts/cash.md, contracts/database-rights.md ; research R-01 à R-03, R-05, R-20 (fait foi) ;
-- research-adversarial A1, A6, A7, A8, A21, A26, A27 ; ADR-89).
--
-- Contenu :
--   1. Tables `cash_desk`, `cash_session`, `cash_session_count`, `cash_session_tx` ; RLS activée et
--      forcée sur les quatre. Aucune colonne ni vue ne porte le solde d'une caisse avant la
--      fermeture (A27).
--   2. Fonctions SECURITY DEFINER, `search_path = public, pg_temp` (règle de 0021), EXECUTE retiré à
--      PUBLIC. AUCUN GRANT et aucun REVOKE de table ici : les accords à `cashless_app` et les
--      retraits d'écriture sont posés par `post-roles.sql` (lot WP05).
--        cash_actor_allowed        INTERNE (jamais accordée) : personne CASHIER/SUPERVISOR (ou
--                                  SUPERVISOR seul) de l'événement ou de son organisateur
--        cash_session_usable       INTERNE : session OPEN du prestataire, du grand livre attendu
--        cash_session_attach_own   INTERNE : rattache la transaction d'une variante
--        open_cash_session         ouverture (crée le compte A-CAISSE-<série> à la première session)
--        count_cash_session        comptage à l'aveugle (rend le seul numéro du comptage)
--        begin_cash_close          fermeture, temps 1 : verrou du solde, état CLOSING, théorique
--        finish_cash_close         fermeture, temps 2 : contrôle de CASH_CLOSE, anomalie, CLOSED
--        attach_cash_tx            rattache une transaction de recharge à la session
--        open_cash_due_anomaly     anomalie CASH_TOPUP_OVER_LIMIT d'une recharge espèces
--        take_deposit_for_session, refund_deposit_for_session, refund_cash_due_for_session
--                                  variantes qui écrivent sur la caisse de la session et rattachent
--                                  elles-mêmes leur transaction
--        posting_cash_desk_guard   déclencheur (SECURITY DEFINER) : garde de caisse sur `posting`
--        account_purpose_guard     déclencheur (SECURITY INVOKER) : `cashless_app` ne crée ni
--                                  CASH_DESK ni PSP
--   3. Déclencheurs `posting_cash_desk_guard` (BEFORE INSERT ON posting) et `account_purpose_guard`
--      (BEFORE INSERT OR UPDATE OF purpose ON account).
--
-- Comme 0022 et 0031, aucune fonction ne s'appuie sur la RLS : chaque lecture et chaque écriture
-- nomment le prestataire de la session (`app.operator_id`). Absent : P0002. Hypothèse sur le
-- propriétaire (comme 0022) : le propriétaire des fonctions ignore la RLS (superutilisateur sur le
-- poste local). Si un propriétaire y restait soumis, la garde de caisse ne verrait aucune session et
-- refuserait tout : elle échoue fermée.
--
-- Ordre global des verrous (5b, A7) : terminal -> vendeur -> session de vendeur -> demande QR ->
-- bracelet -> portefeuille. Cette migration y ajoute : session de caisse -> solde du compte de
-- caisse (un solde est pris après la session, jamais avant). Les variantes `..._for_session` et la
-- garde lisent la session SANS la verrouiller. Les verrous de session pris ici sont FOR NO KEY
-- UPDATE (et non FOR UPDATE) : un rattachement (`cash_session_tx`, `cash_session_count`) prend un
-- FOR KEY SHARE sur la session par sa clé étrangère APRÈS le verrou du solde pris par
-- `post_transaction` ; avec FOR UPDATE, `begin_cash_close` (session puis solde) et une recharge
-- (solde puis clé étrangère de la session) s'attendraient mutuellement (40P01). FOR NO KEY UPDATE
-- reste exclusif entre fermetures et comptages, et ne gêne pas la clé étrangère.
--
-- Pourquoi la lecture sans verrou de la garde est sûre : `post_transaction` verrouille les soldes
-- non chauds AVANT d'insérer les lignes ; en READ COMMITTED chaque instruction du déclencheur voit
-- l'état validé après l'attente. Si `begin_cash_close` tient le solde, une écriture concurrente
-- attend, puis la garde voit CLOSING/CLOSED et refuse.
--
-- Erreurs (traduites par apps/api/src/errors/sqlstate-map.ts, qui appartient au lot WP07) :
--   CL001   paramètre invalide, transaction de fermeture fausse           -> 422 VALIDATION_FAILED
--   CL029   conflit d'état : garde de caisse (aucune session ouverte pour la caisse), session
--           absente ou non ouverte, doublon d'ouverture, 11e comptage, fermeture sans comptage,
--           caisse inscrite pour un autre terminal                       -> 409 CONFLICT_STATE
--   CL041   le fermeur est l'auteur d'un comptage de la session          -> 403 FORBIDDEN
--   CL030   terminal suspendu (via assert_device_active)                 -> 403 DEVICE_SUSPENDED
--   42501   terminal révoqué (via assert_device_active) ; création d'un compte CASH_DESK ou PSP
--           par `cashless_app`
--   CL027   mode du terminal (autre que TOPUP_DESK) ou terminal sans événement
--   P0002   objet introuvable, d'un autre prestataire, ou personne hors périmètre -> 404

-- 1. Tables ---------------------------------------------------------------------------------------
-- Registre des caisses : seuls les comptes inscrits ici sont soumis à la garde (A1). Rempli par
-- `open_cash_session` à la création (ou à la première session) du compte A-CAISSE-<série>.
CREATE TABLE cash_desk (
  account_id  uuid PRIMARY KEY REFERENCES account(id),
  operator_id uuid NOT NULL REFERENCES party(id),
  device_id   uuid NOT NULL UNIQUE REFERENCES device(id),
  ledger_id   uuid NOT NULL REFERENCES ledger(id),
  created_at  timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT cash_desk_account_ledger FOREIGN KEY (ledger_id, account_id)
    REFERENCES account(ledger_id, id)
);

-- Session de caisse. Aucune colonne ne porte le solde avant la fermeture : `expected_amount` n'est
-- rempli qu'à `begin_cash_close` (A27).
CREATE TABLE cash_session (
  cash_session_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id          uuid NOT NULL REFERENCES party(id),
  ledger_id            uuid NOT NULL REFERENCES ledger(id),
  event_id             uuid NOT NULL REFERENCES event(id),
  device_id            uuid NOT NULL REFERENCES device(id),
  cash_account_id      uuid NOT NULL,
  opened_by            uuid NOT NULL REFERENCES app_user(id),
  opened_at            timestamptz NOT NULL DEFAULT clock_timestamp(),
  status               text NOT NULL DEFAULT 'OPEN' CONSTRAINT cash_session_status
                       CHECK (status IN ('OPEN','CLOSING','CLOSED')),
  closed_by            uuid REFERENCES app_user(id),
  closed_at            timestamptz,
  counted_amount       bigint,
  expected_amount      bigint,
  close_tx_id          uuid REFERENCES journal_transaction(id),
  cash_diff_anomaly_id uuid REFERENCES anomaly(id),
  CONSTRAINT cash_session_account FOREIGN KEY (ledger_id, cash_account_id)
    REFERENCES account(ledger_id, id),
  CONSTRAINT cash_session_closing_fields CHECK (status = 'OPEN'
    OR (counted_amount IS NOT NULL AND expected_amount IS NOT NULL AND closed_by IS NOT NULL)),
  -- Renforcement : une session ouverte ne porte ni théorique ni compté ni fermeur (A27).
  CONSTRAINT cash_session_open_fields CHECK (status <> 'OPEN'
    OR (counted_amount IS NULL AND expected_amount IS NULL AND closed_by IS NULL
        AND closed_at IS NULL AND close_tx_id IS NULL AND cash_diff_anomaly_id IS NULL)),
  CONSTRAINT cash_session_closed_at CHECK (status <> 'CLOSED' OR closed_at IS NOT NULL),
  CONSTRAINT cash_session_counted_nonneg CHECK (counted_amount >= 0),
  CONSTRAINT cash_session_diff_anomaly CHECK (status <> 'CLOSED'
    OR ((counted_amount <> expected_amount) = (cash_diff_anomaly_id IS NOT NULL))),
  CONSTRAINT cash_session_close_tx CHECK (status <> 'CLOSED' OR close_tx_id IS NOT NULL
    OR (counted_amount = 0 AND expected_amount = 0))
);
-- Une session OPEN/CLOSING par caisse et une par terminal.
CREATE UNIQUE INDEX cash_session_open_per_account ON cash_session (cash_account_id)
  WHERE status IN ('OPEN','CLOSING');
CREATE UNIQUE INDEX cash_session_open_per_device ON cash_session (device_id)
  WHERE status IN ('OPEN','CLOSING');
CREATE INDEX cash_session_list_idx ON cash_session (operator_id, event_id, opened_at);

-- Comptages à l'aveugle : 10 au plus par session (A26).
CREATE TABLE cash_session_count (
  cash_session_id uuid NOT NULL REFERENCES cash_session(cash_session_id),
  count_no        int NOT NULL,
  counted_amount  bigint NOT NULL CHECK (counted_amount >= 0),
  counted_by      uuid NOT NULL REFERENCES app_user(id),
  counted_at      timestamptz NOT NULL DEFAULT clock_timestamp(),
  note            text CHECK (note IS NULL OR length(note) <= 200),
  operator_id     uuid NOT NULL REFERENCES party(id),
  PRIMARY KEY (cash_session_id, count_no),
  CONSTRAINT cash_session_count_no CHECK (count_no BETWEEN 1 AND 10)
);

-- Transactions rattachées à une session ; une transaction n'appartient qu'à une session.
CREATE TABLE cash_session_tx (
  cash_session_id uuid NOT NULL REFERENCES cash_session(cash_session_id),
  tx_id           uuid NOT NULL UNIQUE REFERENCES journal_transaction(id),
  operator_id     uuid NOT NULL REFERENCES party(id),
  attached_at     timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (cash_session_id, tx_id)
);

-- RLS activée et forcée, même politique que les tables de 0031.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['cash_desk','cash_session','cash_session_count','cash_session_tx'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
                     USING (operator_id = current_setting('app.operator_id', true)::uuid)
                     WITH CHECK (operator_id = current_setting('app.operator_id', true)::uuid)$p$,
                   t);
  END LOOP;
END $$;

-- 2. Fonctions internes ---------------------------------------------------------------------------
-- Personne autorisée sur les caisses d'un événement : personne ACTIVE du prestataire, attribution
-- non révoquée, rôle dans p_roles, portée EVENT = l'événement ou ORGANIZER = son organisateur.
-- Modèle : vendor_admin_allowed (0031). INTERNE : jamais accordée.
CREATE FUNCTION cash_actor_allowed(p_operator uuid, p_event uuid, p_actor uuid, p_roles text[])
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM app_user u
      JOIN role_assignment a ON a.user_id = u.id AND a.revoked_at IS NULL
      JOIN event e ON e.id = p_event AND e.operator_id = p_operator
     WHERE u.id = p_actor AND u.operator_id = p_operator AND u.status = 'ACTIVE'
       AND a.operator_id = p_operator AND a.role = ANY (p_roles)
       AND ((a.scope_type = 'EVENT' AND a.scope_id = e.id)
            OR (a.scope_type = 'ORGANIZER' AND a.scope_id = e.organizer_id)))
$$;
REVOKE ALL ON FUNCTION cash_actor_allowed(uuid, uuid, uuid, text[]) FROM PUBLIC;

-- Session OPEN du prestataire de la session, du grand livre attendu. Lecture sans verrou. Session
-- absente ou d'un autre prestataire : P0002 ; non ouverte ou d'un autre grand livre : CL029.
-- INTERNE : jamais accordée.
CREATE FUNCTION cash_session_usable(p_session uuid, p_ledger uuid) RETURNS cash_session
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_operator uuid := nullif(current_setting('app.operator_id', true), '')::uuid;
  s cash_session%ROWTYPE;
BEGIN
  IF v_operator IS NULL OR p_session IS NULL THEN
    RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found';
  END IF;
  SELECT * INTO s FROM cash_session
   WHERE cash_session_id = p_session AND operator_id = v_operator;
  IF NOT FOUND THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  IF s.status <> 'OPEN' OR s.ledger_id IS DISTINCT FROM p_ledger THEN
    RAISE EXCEPTION 'Session de caisse non ouverte pour ce grand livre' USING ERRCODE = 'CL029';
  END IF;
  RETURN s;
END $$;
REVOKE ALL ON FUNCTION cash_session_usable(uuid, uuid) FROM PUBLIC;

-- Rattache à la session la transaction (ledger, clé) d'une variante, si elle a une ligne sur la
-- caisse de la session et n'est pas déjà rattachée (rejeu, caution déjà prise : sans effet).
-- INTERNE : jamais accordée.
CREATE FUNCTION cash_session_attach_own(p_session cash_session, p_key text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO cash_session_tx (cash_session_id, tx_id, operator_id)
  SELECT p_session.cash_session_id, t.id, p_session.operator_id
    FROM journal_transaction t
   WHERE t.ledger_id = p_session.ledger_id AND t.idempotency_key = p_key
     AND t.operator_id = p_session.operator_id
     AND EXISTS (SELECT 1 FROM posting p
                  WHERE p.transaction_id = t.id AND p.account_id = p_session.cash_account_id)
     AND NOT EXISTS (SELECT 1 FROM cash_session_tx x WHERE x.tx_id = t.id);
END $$;
REVOKE ALL ON FUNCTION cash_session_attach_own(cash_session, text) FROM PUBLIC;

-- 3. Ouverture et comptage ------------------------------------------------------------------------
-- Ouverture : terminal TOPUP_DESK actif d'un événement LIVE/CLOSING dont le grand livre n'est pas
-- LOCKED ; personne CASHIER/SUPERVISOR. Crée le compte A-CAISSE-<série> (ASSET, CASH_DESK, titulaire
-- = détenteur des fonds) à la première session et l'inscrit dans cash_desk. Comportement voulu
-- (consigné) : un compte A-CAISSE-<série> posé à la main avant la première session devient soumis à
-- la garde dès cette ouverture. Limite : un compte inscrit pour un AUTRE terminal (numéro de série
-- réutilisé après révocation) est refusé (CL029). Aucune écriture au grand livre.
-- Verrous : terminal FOR SHARE (assert_device_active), puis insertions (index uniques).
CREATE FUNCTION open_cash_session(p_device uuid, p_actor uuid)
RETURNS TABLE (cash_session_id uuid, cash_account_id uuid, account_code text, ledger_id uuid,
               event_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE
  v_operator uuid := nullif(current_setting('app.operator_id', true), '')::uuid;
  d device%ROWTYPE;
  ev event%ROWTYPE;
  lg ledger%ROWTYPE;
  acc account%ROWTYPE;
  v_code text;
  v_desk cash_desk%ROWTYPE;
  v_session uuid;
BEGIN
  IF v_operator IS NULL OR p_device IS NULL OR p_actor IS NULL THEN
    RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found';
  END IF;
  -- a. Terminal actif du prestataire (FOR SHARE ; révoqué 42501, suspendu CL030).
  PERFORM assert_device_active(p_device);
  -- b. Mode et événement du terminal.
  SELECT * INTO d FROM device WHERE id = p_device AND operator_id = v_operator;
  IF NOT FOUND THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  IF d.app_mode <> 'TOPUP_DESK' OR d.event_id IS NULL THEN
    RAISE EXCEPTION 'Terminal : mode ou événement ne permettent pas une caisse'
      USING ERRCODE = 'CL027';
  END IF;
  -- c. Événement, grand livre, personne.
  SELECT * INTO ev FROM event WHERE id = d.event_id AND operator_id = v_operator;
  IF NOT FOUND THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  IF ev.status NOT IN ('LIVE','CLOSING') THEN
    RAISE EXCEPTION 'Événement : état ne permettant pas d''ouvrir une caisse'
      USING ERRCODE = 'CL029';
  END IF;
  SELECT * INTO lg FROM ledger l
   WHERE l.scope_type = 'EVENT' AND l.scope_id = ev.id AND l.currency = ev.currency
     AND l.operator_id = v_operator;
  IF NOT FOUND OR lg.status = 'LOCKED' THEN
    RAISE EXCEPTION 'Grand livre de l''événement absent ou verrouillé' USING ERRCODE = 'CL029';
  END IF;
  IF NOT cash_actor_allowed(v_operator, ev.id, p_actor, ARRAY['CASHIER','SUPERVISOR']) THEN
    RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found';
  END IF;
  -- d. Compte de caisse A-CAISSE-<série>.
  v_code := 'A-CAISSE-' || d.serial;
  SELECT * INTO acc FROM account a WHERE a.ledger_id = lg.id AND a.code = v_code;
  IF NOT FOUND THEN
    INSERT INTO account (operator_id, ledger_id, code, family, purpose, owner_party_id,
                         normal_side, allow_negative, hot)
    VALUES (v_operator, lg.id, v_code, 'ASSET', 'CASH_DESK', lg.funds_holder_id, 'D', false, false)
    ON CONFLICT (ledger_id, code) DO NOTHING;
    SELECT * INTO acc FROM account a WHERE a.ledger_id = lg.id AND a.code = v_code;
  END IF;
  IF acc.operator_id IS DISTINCT FROM v_operator OR acc.family <> 'ASSET'
     OR acc.purpose <> 'CASH_DESK' OR NOT acc.is_active THEN
    RAISE EXCEPTION 'Compte de caisse inutilisable' USING ERRCODE = 'CL029';
  END IF;
  INSERT INTO account_balance (account_id, operator_id) VALUES (acc.id, v_operator)
  ON CONFLICT (account_id) DO NOTHING;
  -- e. Inscription dans cash_desk ; inscrit pour un autre terminal : refus.
  SELECT * INTO v_desk FROM cash_desk k WHERE k.account_id = acc.id;
  IF FOUND THEN
    IF v_desk.device_id <> p_device THEN
      RAISE EXCEPTION 'Caisse inscrite pour un autre terminal' USING ERRCODE = 'CL029';
    END IF;
  ELSE
    BEGIN
      INSERT INTO cash_desk (account_id, operator_id, device_id, ledger_id)
      VALUES (acc.id, v_operator, p_device, lg.id);
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'Caisse inscrite pour un autre terminal' USING ERRCODE = 'CL029';
    END;
  END IF;
  -- f. Aucune session ouverte pour ce compte ni ce terminal (pré-contrôle, puis filet).
  IF EXISTS (SELECT 1 FROM cash_session s
              WHERE s.status IN ('OPEN','CLOSING')
                AND (s.cash_account_id = acc.id OR s.device_id = p_device)) THEN
    RAISE EXCEPTION 'Une session de caisse est déjà ouverte' USING ERRCODE = 'CL029';
  END IF;
  BEGIN
    INSERT INTO cash_session (operator_id, ledger_id, event_id, device_id, cash_account_id,
                              opened_by)
    VALUES (v_operator, lg.id, ev.id, p_device, acc.id, p_actor)
    RETURNING cash_session.cash_session_id INTO v_session;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'Une session de caisse est déjà ouverte' USING ERRCODE = 'CL029';
  END;
  -- g. Aucune écriture au grand livre.
  RETURN QUERY SELECT v_session, acc.id, v_code, lg.id, ev.id;
END $$;
REVOKE ALL ON FUNCTION open_cash_session(uuid, uuid) FROM PUBLIC;

-- Comptage à l'aveugle (FR-002) : rend UNIQUEMENT le numéro du comptage, jamais le théorique ni
-- l'écart. Session verrouillée FOR NO KEY UPDATE (numérotation sûre). `p_device`, s'il est donné,
-- doit être le terminal de la session. Au plus 10 comptages (A26).
CREATE FUNCTION count_cash_session(p_session uuid, p_amount bigint, p_actor uuid,
                                   p_device uuid DEFAULT NULL, p_note text DEFAULT NULL)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_operator uuid := nullif(current_setting('app.operator_id', true), '')::uuid;
  s cash_session%ROWTYPE;
  v_note text := nullif(btrim(p_note), '');
  v_no int;
BEGIN
  IF v_operator IS NULL OR p_session IS NULL THEN
    RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found';
  END IF;
  SELECT * INTO s FROM cash_session
   WHERE cash_session_id = p_session AND operator_id = v_operator FOR NO KEY UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  IF s.status <> 'OPEN' THEN
    RAISE EXCEPTION 'Session de caisse non ouverte' USING ERRCODE = 'CL029';
  END IF;
  IF p_device IS NOT NULL AND p_device <> s.device_id THEN
    RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found';
  END IF;
  IF p_actor IS NULL
     OR NOT cash_actor_allowed(v_operator, s.event_id, p_actor, ARRAY['CASHIER','SUPERVISOR']) THEN
    RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found';
  END IF;
  IF p_amount IS NULL OR p_amount < 0 THEN
    RAISE EXCEPTION 'Comptage : montant positif ou nul requis' USING ERRCODE = 'CL001';
  END IF;
  IF v_note IS NOT NULL AND length(v_note) > 200 THEN
    RAISE EXCEPTION 'Comptage : note de 200 caractères au plus' USING ERRCODE = 'CL001';
  END IF;
  SELECT coalesce(max(c.count_no), 0) + 1 INTO v_no
    FROM cash_session_count c WHERE c.cash_session_id = s.cash_session_id;
  IF v_no > 10 THEN
    RAISE EXCEPTION 'Session de caisse : 10 comptages au plus' USING ERRCODE = 'CL029';
  END IF;
  INSERT INTO cash_session_count (cash_session_id, count_no, counted_amount, counted_by, note,
                                  operator_id)
  VALUES (s.cash_session_id, v_no, p_amount, p_actor, v_note, v_operator);
  RETURN v_no;
END $$;
REVOKE ALL ON FUNCTION count_cash_session(uuid, bigint, uuid, uuid, text) FROM PUBLIC;

-- 4. Fermeture en deux temps ----------------------------------------------------------------------
-- Temps 1 : session FOR NO KEY UPDATE, SUPERVISOR de l'événement, au moins un comptage, fermeur
-- étranger à tous les comptages (CL041), puis solde du compte de caisse FOR UPDATE : le théorique
-- est ce solde lu SOUS verrou. Session -> CLOSING. Le verrou du solde reste tenu jusqu'à la fin de
-- la transaction de l'API, qui appelle ensuite `finish_cash_close` dans la même transaction (un
-- état CLOSING n'est donc jamais visible d'une autre transaction).
CREATE FUNCTION begin_cash_close(p_session uuid, p_closer uuid)
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
BEGIN
  IF v_operator IS NULL OR p_session IS NULL THEN
    RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found';
  END IF;
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
  -- e. Session -> CLOSING.
  UPDATE cash_session cs
     SET status = 'CLOSING', closed_by = p_closer, counted_amount = v_counted,
         expected_amount = v_expected
   WHERE cs.cash_session_id = s.cash_session_id AND cs.operator_id = v_operator;
  SELECT a.code INTO v_code FROM account a WHERE a.id = s.cash_account_id;
  RETURN QUERY SELECT s.cash_session_id, s.cash_account_id, v_code, s.ledger_id, s.event_id,
                      s.device_id, v_counted, v_expected;
END $$;
REVOKE ALL ON FUNCTION begin_cash_close(uuid, uuid) FROM PUBLIC;

-- Temps 2 : contrôle de la transaction CASH_CLOSE écrite entre-temps par le moteur, anomalie
-- CASH_DIFF s'il y a un écart, session CLOSED. Rend l'identifiant de l'anomalie (NULL sans écart).
-- Un échec laisse l'API annuler toute la transaction (NFR-008) : la base n'a rien à défaire.
-- Rejeu d'une session CLOSED : CL029 (le rejeu à même clé d'idempotence est traité par l'API).
CREATE FUNCTION finish_cash_close(p_session uuid, p_closer uuid, p_close_tx uuid DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_operator uuid := nullif(current_setting('app.operator_id', true), '')::uuid;
  s cash_session%ROWTYPE;
  t journal_transaction%ROWTYPE;
  v_anomaly uuid;
  v_cash_sum bigint;
  v_transit_sum bigint;
  v_balance bigint;
BEGIN
  IF v_operator IS NULL OR p_session IS NULL THEN
    RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found';
  END IF;
  SELECT * INTO s FROM cash_session cs
   WHERE cs.cash_session_id = p_session AND cs.operator_id = v_operator FOR NO KEY UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  IF s.status <> 'CLOSING' OR p_closer IS DISTINCT FROM s.closed_by THEN
    RAISE EXCEPTION 'Session de caisse : fermeture non commencée par ce fermeur'
      USING ERRCODE = 'CL029';
  END IF;
  -- Théorique et compté nuls : aucune écriture.
  IF s.expected_amount = 0 AND s.counted_amount = 0 THEN
    IF p_close_tx IS NOT NULL THEN
      RAISE EXCEPTION 'Fermeture : aucune écriture attendue' USING ERRCODE = 'CL001';
    END IF;
    UPDATE cash_session cs SET status = 'CLOSED', closed_at = clock_timestamp()
     WHERE cs.cash_session_id = s.cash_session_id AND cs.operator_id = v_operator;
    RETURN NULL;
  END IF;
  -- Transaction de fermeture : même grand livre, type, clé, montants, caisse à zéro.
  IF p_close_tx IS NULL THEN
    RAISE EXCEPTION 'Fermeture : transaction CASH_CLOSE requise' USING ERRCODE = 'CL001';
  END IF;
  SELECT * INTO t FROM journal_transaction x
   WHERE x.id = p_close_tx AND x.ledger_id = s.ledger_id AND x.operator_id = v_operator;
  IF NOT FOUND OR t.type <> 'CASH_CLOSE'
     OR t.idempotency_key <> 'cash-close:' || s.cash_session_id THEN
    RAISE EXCEPTION 'Fermeture : transaction CASH_CLOSE invalide' USING ERRCODE = 'CL001';
  END IF;
  SELECT coalesce(sum(p.amount) FILTER (WHERE p.account_id = s.cash_account_id), 0),
         coalesce(sum(p.amount) FILTER (WHERE a.purpose = 'CASH_TRANSIT'), 0)
    INTO v_cash_sum, v_transit_sum
    FROM posting p JOIN account a ON a.id = p.account_id
   WHERE p.transaction_id = t.id;
  SELECT b.balance INTO v_balance FROM account_balance b WHERE b.account_id = s.cash_account_id;
  IF v_cash_sum <> -s.expected_amount OR v_transit_sum <> s.counted_amount
     OR coalesce(v_balance, 0) <> 0 THEN
    RAISE EXCEPTION 'Fermeture : montants de CASH_CLOSE invalides' USING ERRCODE = 'CL001';
  END IF;
  -- Écart : anomalie CASH_DIFF (le signe se déduit de counted - expected de la session).
  IF s.counted_amount <> s.expected_amount THEN
    INSERT INTO anomaly (operator_id, ledger_id, kind, device_id, transaction_id, amount, status)
    VALUES (v_operator, s.ledger_id, 'CASH_DIFF', s.device_id, t.id,
            abs(s.counted_amount - s.expected_amount), 'OPEN')
    RETURNING id INTO v_anomaly;
  END IF;
  INSERT INTO cash_session_tx (cash_session_id, tx_id, operator_id)
  VALUES (s.cash_session_id, t.id, v_operator);
  UPDATE cash_session cs
     SET status = 'CLOSED', closed_at = clock_timestamp(), close_tx_id = t.id,
         cash_diff_anomaly_id = v_anomaly
   WHERE cs.cash_session_id = s.cash_session_id AND cs.operator_id = v_operator;
  RETURN v_anomaly;
END $$;
REVOKE ALL ON FUNCTION finish_cash_close(uuid, uuid, uuid) FROM PUBLIC;

-- 5. Gardes ---------------------------------------------------------------------------------------
-- Garde de caisse (A1, A7, A8, A21). Ne vaut que pour les comptes inscrits dans cash_desk (une
-- seule recherche par clé primaire pour les autres : le chemin chaud reste léger) ; vaut pour toutes
-- les sources et tous les rôles. Ne lit AUCUNE variable de session (A7). Lectures de cash_session
-- et de journal_transaction SANS verrou (A21). Tout refus : CL029, un seul message.
--   session OPEN du compte : le terminal de la transaction, s'il y en a un, est celui de la session
--                            (A8) ; une transaction CASH_CLOSE est refusée (renforcement) ;
--   session CLOSING        : seule la transaction CASH_CLOSE de clé cash-close:<session> passe ;
--   aucune session         : refus.
CREATE FUNCTION posting_cash_desk_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  s cash_session%ROWTYPE;
  t journal_transaction%ROWTYPE;
  v_ok boolean := false;
BEGIN
  PERFORM 1 FROM cash_desk k WHERE k.account_id = NEW.account_id;
  IF NOT FOUND THEN RETURN NEW; END IF;
  SELECT * INTO s FROM cash_session cs
   WHERE cs.cash_account_id = NEW.account_id AND cs.status IN ('OPEN','CLOSING');
  IF FOUND THEN
    SELECT * INTO t FROM journal_transaction x WHERE x.id = NEW.transaction_id;
    IF FOUND THEN
      IF s.status = 'OPEN' THEN
        v_ok := t.type <> 'CASH_CLOSE' AND (t.device_id IS NULL OR t.device_id = s.device_id);
      ELSE
        v_ok := t.type = 'CASH_CLOSE' AND t.idempotency_key = 'cash-close:' || s.cash_session_id;
      END IF;
    END IF;
  END IF;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'Aucune session de caisse ouverte pour cette caisse : mouvement d''espèces refusé'
      USING ERRCODE = 'CL029';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION posting_cash_desk_guard() FROM PUBLIC;
CREATE TRIGGER posting_cash_desk_guard BEFORE INSERT ON posting
  FOR EACH ROW EXECUTE FUNCTION posting_cash_desk_guard();

-- Création des comptes de caisse et PSP : `cashless_app` n'en crée pas (A6). SECURITY INVOKER
-- (avec `search_path` fixé) : sous SECURITY DEFINER, `current_user` serait le propriétaire et la
-- garde ne se déclencherait jamais. Les fonctions SECURITY DEFINER (propriétaire), dont
-- `open_cash_session`, sont le seul chemin de création. Couvre l'INSERT et l'UPDATE de `purpose`.
-- Contradiction signalée avec contracts/database-rights.md (« fonction du déclencheur SECURITY
-- DEFINER ») : la garde reste effective, c'est un renforcement par rapport au contrat.
CREATE FUNCTION account_purpose_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF current_user = 'cashless_app' AND NEW.purpose IN ('CASH_DESK','PSP') THEN
    RAISE EXCEPTION 'Création d''un compte de caisse ou PSP refusée au rôle applicatif'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION account_purpose_guard() FROM PUBLIC;
CREATE TRIGGER account_purpose_guard BEFORE INSERT OR UPDATE OF purpose ON account
  FOR EACH ROW EXECUTE FUNCTION account_purpose_guard();

-- 6. Rattachement, espèces dues et variantes -------------------------------------------------------
-- Rattache une transaction à une session OPEN du prestataire. La transaction est du même grand livre
-- et a au moins une ligne sur le compte de caisse de la session (CL001 sinon). Idempotent ; déjà
-- rattachée à une AUTRE session : CL029.
CREATE FUNCTION attach_cash_tx(p_session uuid, p_tx uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_operator uuid := nullif(current_setting('app.operator_id', true), '')::uuid;
  s cash_session%ROWTYPE;
BEGIN
  IF v_operator IS NULL OR p_session IS NULL THEN
    RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found';
  END IF;
  SELECT * INTO s FROM cash_session cs
   WHERE cs.cash_session_id = p_session AND cs.operator_id = v_operator;
  IF NOT FOUND THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  IF s.status <> 'OPEN' THEN
    RAISE EXCEPTION 'Session de caisse non ouverte' USING ERRCODE = 'CL029';
  END IF;
  IF p_tx IS NULL OR NOT EXISTS (
       SELECT 1 FROM journal_transaction t
         JOIN posting p ON p.transaction_id = t.id AND p.account_id = s.cash_account_id
        WHERE t.id = p_tx AND t.ledger_id = s.ledger_id AND t.operator_id = v_operator) THEN
    RAISE EXCEPTION 'Rattachement : transaction sans ligne sur la caisse de la session'
      USING ERRCODE = 'CL001';
  END IF;
  BEGIN
    INSERT INTO cash_session_tx (cash_session_id, tx_id, operator_id)
    VALUES (s.cash_session_id, p_tx, v_operator)
    ON CONFLICT (cash_session_id, tx_id) DO NOTHING;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'Transaction déjà rattachée à une autre session' USING ERRCODE = 'CL029';
  END;
END $$;
REVOKE ALL ON FUNCTION attach_cash_tx(uuid, uuid) FROM PUBLIC;

-- Anomalie d'espèces dues d'une recharge espèces découpée (signature fixe : WP06 l'appelle ainsi).
-- Idempotente par transaction : un second appel rend l'anomalie sans doublon (même bracelet et
-- même montant, sinon CL001).
CREATE FUNCTION open_cash_due_anomaly(p_ledger uuid, p_media uuid, p_amount bigint, p_tx uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_operator uuid;
  t journal_transaction%ROWTYPE;
  v_existing anomaly%ROWTYPE;
  v_id uuid;
BEGIN
  PERFORM assert_tenant(tenant_of_ledger(p_ledger));
  v_operator := nullif(current_setting('app.operator_id', true), '')::uuid;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Espèces dues : montant positif requis' USING ERRCODE = 'CL001';
  END IF;
  SELECT * INTO t FROM journal_transaction x
   WHERE x.id = p_tx AND x.ledger_id = p_ledger AND x.operator_id = v_operator;
  IF NOT FOUND OR t.type <> 'TOPUP_CASH' THEN
    RAISE EXCEPTION 'Espèces dues : transaction TOPUP_CASH du grand livre requise'
      USING ERRCODE = 'CL001';
  END IF;
  IF p_media IS NULL OR NOT EXISTS (
       SELECT 1 FROM media m
         JOIN media_assignment ma ON ma.media_id = m.id AND ma.released_at IS NULL
         JOIN wallet w ON w.id = ma.wallet_id
        WHERE m.id = p_media AND m.operator_id = v_operator AND w.ledger_id = p_ledger) THEN
    RAISE EXCEPTION 'Espèces dues : bracelet du portefeuille de ce grand livre requis'
      USING ERRCODE = 'CL001';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('cash-due-anomaly:' || p_tx, 0));
  SELECT * INTO v_existing FROM anomaly a
   WHERE a.transaction_id = p_tx AND a.kind = 'CASH_TOPUP_OVER_LIMIT' AND a.operator_id = v_operator;
  IF FOUND THEN
    IF v_existing.media_id IS DISTINCT FROM p_media OR v_existing.amount <> p_amount THEN
      RAISE EXCEPTION 'Espèces dues : anomalie déjà ouverte avec un autre contenu'
        USING ERRCODE = 'CL001';
    END IF;
    RETURN v_existing.id;
  END IF;
  INSERT INTO anomaly (operator_id, ledger_id, kind, media_id, device_id, transaction_id, amount,
                       status)
  VALUES (v_operator, p_ledger, 'CASH_TOPUP_OVER_LIMIT', p_media, t.device_id, p_tx, p_amount,
          'OPEN')
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION open_cash_due_anomaly(uuid, uuid, bigint, uuid) FROM PUBLIC;

-- Variantes `..._for_session` : elles écrivent sur la caisse de la session (aucun paramètre ne
-- désigne un compte), sans verrouiller la session, et rattachent elles-mêmes leur transaction
-- (mode FROM_BALANCE : aucune ligne sur la caisse, aucun rattachement). Les corps du schéma de
-- référence ne sont pas modifiés.
CREATE FUNCTION take_deposit_for_session(p_media uuid, p_session uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  s cash_session%ROWTYPE;
  v_ledger uuid;
  v_result text;
  n int;
BEGIN
  PERFORM assert_tenant(tenant_of_media(p_media));
  SELECT w.ledger_id INTO v_ledger FROM media m JOIN wallet w ON w.id = m.wallet_id
   WHERE m.id = p_media;
  s := cash_session_usable(p_session, v_ledger);
  v_result := take_deposit(p_media, s.cash_account_id);
  SELECT count(*) INTO n FROM media_assignment WHERE media_id = p_media;
  PERFORM cash_session_attach_own(s, 'deposit:' || p_media || ':' || n);
  RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION take_deposit_for_session(uuid, uuid) FROM PUBLIC;

CREATE FUNCTION refund_deposit_for_session(p_media uuid, p_session uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  s cash_session%ROWTYPE;
  v_ledger uuid;
  n int;
BEGIN
  PERFORM assert_tenant(tenant_of_media(p_media));
  SELECT w.ledger_id INTO v_ledger FROM media m JOIN wallet w ON w.id = m.wallet_id
   WHERE m.id = p_media;
  s := cash_session_usable(p_session, v_ledger);
  PERFORM refund_deposit(p_media, s.cash_account_id);
  SELECT count(*) INTO n FROM media_assignment WHERE media_id = p_media;
  PERFORM cash_session_attach_own(s, 'deposit-refund:' || p_media || ':' || n);
END $$;
REVOKE ALL ON FUNCTION refund_deposit_for_session(uuid, uuid) FROM PUBLIC;

CREATE FUNCTION refund_cash_due_for_session(p_media uuid, p_session uuid, p_key text, p_actor uuid,
                                            p_approver uuid DEFAULT NULL,
                                            p_device uuid DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  s cash_session%ROWTYPE;
  v_ledger uuid;
  v_tx uuid;
BEGIN
  PERFORM assert_tenant(tenant_of_media(p_media));
  SELECT w.ledger_id INTO v_ledger FROM media m JOIN wallet w ON w.id = m.wallet_id
   WHERE m.id = p_media;
  s := cash_session_usable(p_session, v_ledger);
  IF p_device IS NOT NULL AND p_device <> s.device_id THEN
    RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found';
  END IF;
  v_tx := refund_cash_due(p_media, s.cash_account_id, p_key, p_actor, p_approver, p_device);
  PERFORM cash_session_attach_own(s, p_key);
  RETURN v_tx;
END $$;
REVOKE ALL ON FUNCTION refund_cash_due_for_session(uuid, uuid, text, uuid, uuid, uuid)
  FROM PUBLIC;
