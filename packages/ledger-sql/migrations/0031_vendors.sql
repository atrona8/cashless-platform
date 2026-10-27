-- Migration 0031 : vendeurs, essais de PIN et sessions de vendeur (S2 ; mission
-- terminaux-paiement-en-ligne, lot WP02 ; spec FR-001 à FR-006, FR-026, NFR-002, NFR-003, NFR-007 ;
-- data-model « vendor », « vendor_public », « vendor_pin_check », « vendor_session »,
-- « set_device_status » ; contracts/vendors.md ; research R-02, R-11 A6, A7, A15, A20).
--
-- Contenu :
--   1. Tables `vendor`, `vendor_pin_check`, `vendor_session` ; RLS activée et forcée sur les trois.
--   2. Vue `vendor_public` (seule lecture du statut « bloqué » ouverte à l'API, A20).
--   3. Fonctions SECURITY DEFINER, `search_path = public, pg_temp` (règle de 0021), EXECUTE
--      retiré à PUBLIC. Aucun GRANT ici : les droits par rôle sont posés par `post-roles.sql`
--      (lot WP07).
--        vendor_admin_allowed    INTERNE (jamais accordée) : auteur MERCHANT_ADMIN du commerçant ou
--                                OPERATOR_ADMIN du prestataire
--        create_vendor           création (back-office)
--        set_vendor_pin          nouveau PIN : compteur à 0, blocage levé, sessions fermées
--        set_vendor_status       ACTIVE <-> DISABLED ; désactivation : sessions fermées
--        begin_vendor_pin_check  transaction A du « compter d'abord » (A6)
--        open_vendor_session     transaction B, appelée par l'API seulement si le PIN est bon
--        close_vendor_session    fin de session demandée par le terminal (LOGOUT)
--        assert_vendor_session   garde de session des ventes, annulations et demandes QR
--   4. `set_device_status` remplacée (A7) : contrôles de 0022 inchangés, fermeture en plus des
--      sessions de vendeur du terminal suspendu ou révoqué.
--   5. `purge_device_enrollment_attempts` remplacée : purge aussi les essais de PIN de plus de
--      24 h.
--
-- Comme 0022, aucune fonction ne s'appuie sur la RLS : chaque lecture et chaque écriture nomment le
-- prestataire de la session (`app.operator_id`). Absent : P0002.
--
-- Ordre global des verrous (A7), tenu par chaque fonction de ce fichier :
--   terminal -> vendeur -> session de vendeur -> demande QR -> bracelet -> portefeuille.
-- Une fonction peut sauter un échelon, jamais en prendre un plus haut après un plus bas.
--
-- Erreurs (traduites par apps/api/src/errors/sqlstate-map.ts) :
--   CL001   paramètre invalide (jamais d'écho de l'empreinte)        -> 422 VALIDATION_FAILED
--   CL030   terminal suspendu (begin_vendor_pin_check)               -> 403 DEVICE_SUSPENDED
--   42501   terminal révoqué (begin_vendor_pin_check)                -> 403 DEVICE_REVOKED
--   CL032   session de vendeur absente, close, expirée, d'un autre terminal ou autre que celle
--           désignée ; vendeur désactivé ou bloqué                   -> 409 VENDOR_SESSION_INVALID
--   CL033   ouverture de session refusée, une seule réponse quelle que soit la cause (NFR-004)
--                                                                    -> 401 VENDOR_PIN_INVALID
--   P0002   objet introuvable, d'un autre prestataire ou hors du périmètre de l'auteur -> 404

-- 1. Tables ---------------------------------------------------------------------------------------
-- Vendeur d'un commerçant (S2). Le PIN n'existe jamais en base : seule son empreinte argon2id
-- (format PHC, calculée par l'API avec un secret hors base). `display_name` est rangé sans blancs
-- de bord.
CREATE TABLE vendor (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id     uuid NOT NULL REFERENCES party(id),
  merchant_id     uuid NOT NULL REFERENCES party(id),  -- MERCHANT du prestataire (create_vendor)
  display_name    text NOT NULL CONSTRAINT vendor_display_name
                  CHECK (display_name = btrim(display_name)
                         AND length(display_name) BETWEEN 1 AND 80),
  pin_hash        text NOT NULL CONSTRAINT vendor_pin_hash
                  CHECK (pin_hash LIKE '$argon2id$v=19$%' AND length(pin_hash) <= 200),
  status          text NOT NULL DEFAULT 'ACTIVE' CONSTRAINT vendor_status
                  CHECK (status IN ('ACTIVE','DISABLED')),
  failed_attempts int NOT NULL DEFAULT 0 CONSTRAINT vendor_failed_attempts
                  CHECK (failed_attempts BETWEEN 0 AND 5),
  locked_at       timestamptz,
  created_by      uuid NOT NULL REFERENCES app_user(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  -- Bloqué si et seulement si 5 essais comptés : le compteur ne dépasse jamais 5 (NFR-003).
  CONSTRAINT vendor_locked CHECK ((locked_at IS NOT NULL) = (failed_attempts = 5))
);
CREATE INDEX vendor_operator_merchant_idx ON vendor (operator_id, merchant_id);

-- Essai de PIN compté (transaction A) : jeton à usage unique, valable 30 s, que la transaction B
-- consomme. Purgé à 24 h avec les essais d'enrôlement (§5).
CREATE TABLE vendor_pin_check (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id uuid NOT NULL REFERENCES party(id),
  vendor_id   uuid NOT NULL REFERENCES vendor(id),
  device_id   uuid NOT NULL REFERENCES device(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  CONSTRAINT vendor_pin_check_ttl CHECK (expires_at = created_at + interval '30 seconds')
);
CREATE INDEX vendor_pin_check_created_idx ON vendor_pin_check (created_at);

-- Session de vendeur sur un terminal (R-02) : 12 h au plus, une ouverte par terminal.
CREATE TABLE vendor_session (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id   uuid NOT NULL REFERENCES party(id),
  vendor_id     uuid NOT NULL REFERENCES vendor(id),
  device_id     uuid NOT NULL REFERENCES device(id),
  opened_at     timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  closed_at     timestamptz,
  closed_reason text CONSTRAINT vendor_session_closed_reason
                CHECK (closed_reason IS NULL
                       OR closed_reason IN ('LOGOUT','REPLACED','VENDOR_DISABLED','VENDOR_LOCKED',
                                            'DEVICE_SUSPENDED','DEVICE_REVOKED','PIN_CHANGED')),
  CONSTRAINT vendor_session_ttl CHECK (expires_at = opened_at + interval '12 hours'),
  CONSTRAINT vendor_session_closed CHECK ((closed_at IS NULL) = (closed_reason IS NULL))
);
CREATE UNIQUE INDEX vendor_session_open_per_device ON vendor_session (device_id)
  WHERE closed_at IS NULL;
CREATE INDEX vendor_session_open_vendor_idx ON vendor_session (vendor_id) WHERE closed_at IS NULL;

-- RLS activée et forcée, même politique que les tables de 0022.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['vendor','vendor_pin_check','vendor_session'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
                     USING (operator_id = current_setting('app.operator_id', true)::uuid)
                     WITH CHECK (operator_id = current_setting('app.operator_id', true)::uuid)$p$,
                   t);
  END LOOP;
END $$;

-- 2. Vue vendor_public (A20) ----------------------------------------------------------------------
-- Seule lecture des vendeurs ouverte à l'API : ni `pin_hash`, ni `failed_attempts`, ni `locked_at`
-- (seulement le booléen `locked`). Le lot WP07 retire à cashless_app la lecture de `locked_at` sur
-- `vendor` : une vue `security_invoker` exigerait ce droit. La vue s'exécute donc avec les droits
-- de son PROPRIÉTAIRE, qui ignore la RLS sur le poste local (superutilisateur) : elle FILTRE
-- ELLE-MÊME sur le prestataire de la session, sans quoi elle montrerait les vendeurs de tous les
-- prestataires. Sans prestataire de session : aucune ligne. `security_barrier` : aucune fonction de
-- l'appelant (critère de sa requête) n'est évaluée avant ce filtre, donc ne voit une ligne d'un
-- autre prestataire. Écriture par la vue : retirée par WP07 (INSERT, UPDATE).
CREATE VIEW vendor_public WITH (security_barrier = true) AS
  SELECT v.id, v.operator_id, v.merchant_id, v.display_name, v.status,
         (v.locked_at IS NOT NULL) AS locked
    FROM vendor v
   WHERE v.operator_id = nullif(current_setting('app.operator_id', true), '')::uuid;

-- 3. Fonctions ------------------------------------------------------------------------------------
-- Auteur autorisé sur les vendeurs d'un commerçant : personne ACTIVE du prestataire, attribution
-- non retirée, MERCHANT_ADMIN de ce commerçant ou OPERATOR_ADMIN du prestataire. Renforcement : la
-- base revérifie l'auteur que l'API a contrôlé. INTERNE : jamais accordée (comme
-- device_admin_allowed).
CREATE FUNCTION vendor_admin_allowed(p_operator uuid, p_merchant uuid, p_actor uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM app_user u
      JOIN role_assignment a ON a.user_id = u.id AND a.revoked_at IS NULL
     WHERE u.id = p_actor AND u.operator_id = p_operator AND u.status = 'ACTIVE'
       AND a.operator_id = p_operator
       AND ((a.role = 'OPERATOR_ADMIN' AND a.scope_type = 'OPERATOR' AND a.scope_id = p_operator)
            OR (a.role = 'MERCHANT_ADMIN' AND a.scope_type = 'MERCHANT' AND p_merchant IS NOT NULL
                AND a.scope_id = p_merchant)))
$$;
REVOKE ALL ON FUNCTION vendor_admin_allowed(uuid, uuid, uuid) FROM PUBLIC;

-- 3a. Création ------------------------------------------------------------------------------------
CREATE FUNCTION create_vendor(p_merchant uuid, p_display_name text, p_pin_hash text, p_actor uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_operator uuid := nullif(current_setting('app.operator_id', true), '')::uuid;
  v_name text := btrim(p_display_name);
  v_id uuid;
BEGIN
  IF v_operator IS NULL OR p_merchant IS NULL THEN
    RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_name IS NULL OR length(v_name) NOT BETWEEN 1 AND 80 THEN
    RAISE EXCEPTION 'Vendeur : nom de 1 à 80 caractères' USING ERRCODE = 'CL001';
  END IF;
  -- Message sans la valeur : l'empreinte n'apparaît jamais dans une erreur.
  IF p_pin_hash IS NULL OR p_pin_hash NOT LIKE '$argon2id$v=19$%' OR length(p_pin_hash) > 200 THEN
    RAISE EXCEPTION 'Vendeur : empreinte du PIN invalide' USING ERRCODE = 'CL001';
  END IF;
  -- Commerçant du prestataire de la session.
  PERFORM 1 FROM party WHERE id = p_merchant AND kind = 'MERCHANT' AND operator_id = v_operator;
  IF NOT FOUND THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  IF p_actor IS NULL OR NOT vendor_admin_allowed(v_operator, p_merchant, p_actor) THEN
    RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found';
  END IF;
  INSERT INTO vendor (operator_id, merchant_id, display_name, pin_hash, status, failed_attempts,
                      created_by, created_at, updated_at)
  VALUES (v_operator, p_merchant, v_name, p_pin_hash, 'ACTIVE', 0, p_actor, now(), now())
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION create_vendor(uuid, text, text, uuid) FROM PUBLIC;

-- 3b. Nouveau PIN : compteur à 0, blocage levé, sessions ouvertes du vendeur fermées (PIN_CHANGED),
-- essais non utilisés du vendeur retirés (l'API les a vérifiés contre l'ancienne empreinte : ils ne
-- doivent plus ouvrir de session ; relecture WP02, cycle 1). Verrous : vendeur, puis ses checks,
-- puis ses sessions.
CREATE FUNCTION set_vendor_pin(p_vendor uuid, p_pin_hash text, p_actor uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_operator uuid := nullif(current_setting('app.operator_id', true), '')::uuid;
  v vendor%ROWTYPE;
BEGIN
  IF v_operator IS NULL OR p_vendor IS NULL THEN
    RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found';
  END IF;
  IF p_pin_hash IS NULL OR p_pin_hash NOT LIKE '$argon2id$v=19$%' OR length(p_pin_hash) > 200 THEN
    RAISE EXCEPTION 'Vendeur : empreinte du PIN invalide' USING ERRCODE = 'CL001';
  END IF;
  SELECT * INTO v FROM vendor WHERE id = p_vendor AND operator_id = v_operator FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  IF p_actor IS NULL OR NOT vendor_admin_allowed(v_operator, v.merchant_id, p_actor) THEN
    RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found';
  END IF;
  UPDATE vendor SET pin_hash = p_pin_hash, failed_attempts = 0, locked_at = NULL, updated_at = now()
   WHERE id = v.id AND operator_id = v_operator;
  DELETE FROM vendor_pin_check
   WHERE vendor_id = v.id AND operator_id = v_operator AND used_at IS NULL;
  UPDATE vendor_session SET closed_at = now(), closed_reason = 'PIN_CHANGED'
   WHERE vendor_id = v.id AND operator_id = v_operator AND closed_at IS NULL;
END $$;
REVOKE ALL ON FUNCTION set_vendor_pin(uuid, text, uuid) FROM PUBLIC;

-- 3c. Statut : ACTIVE <-> DISABLED. Désactivation : sessions ouvertes fermées (VENDOR_DISABLED) et
-- essais non utilisés retirés (un essai antérieur à la désactivation n'ouvre rien après une
-- réactivation). Réactiver ne rouvre aucune session et ne débloque pas (seul un nouveau PIN
-- débloque). Statut déjà en place : sans effet, sans erreur (arbitrage de l'orchestrateur,
-- 22/10/2026). Verrous : vendeur, puis ses checks, puis ses sessions.
CREATE FUNCTION set_vendor_status(p_vendor uuid, p_status text, p_actor uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_operator uuid := nullif(current_setting('app.operator_id', true), '')::uuid;
  v vendor%ROWTYPE;
BEGIN
  IF v_operator IS NULL OR p_vendor IS NULL THEN
    RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found';
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('ACTIVE','DISABLED') THEN
    RAISE EXCEPTION 'Statut de vendeur inconnu' USING ERRCODE = 'CL001';
  END IF;
  SELECT * INTO v FROM vendor WHERE id = p_vendor AND operator_id = v_operator FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  IF p_actor IS NULL OR NOT vendor_admin_allowed(v_operator, v.merchant_id, p_actor) THEN
    RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found';
  END IF;
  IF v.status = p_status THEN
    RETURN;
  END IF;
  UPDATE vendor SET status = p_status, updated_at = now()
   WHERE id = v.id AND operator_id = v_operator;
  IF p_status = 'DISABLED' THEN
    DELETE FROM vendor_pin_check
     WHERE vendor_id = v.id AND operator_id = v_operator AND used_at IS NULL;
    UPDATE vendor_session SET closed_at = now(), closed_reason = 'VENDOR_DISABLED'
     WHERE vendor_id = v.id AND operator_id = v_operator AND closed_at IS NULL;
  END IF;
END $$;
REVOKE ALL ON FUNCTION set_vendor_status(uuid, text, uuid) FROM PUBLIC;

-- 3d. Transaction A du « compter d'abord » (A6) ---------------------------------------------------
-- Validée par l'API AVANT la vérification argon2id, faite hors transaction et sans verrou tenu. Un
-- plantage entre A et B laisse l'essai compté (échec sûr). Verrous : terminal FOR SHARE, puis
-- vendeur FOR UPDATE, puis ses checks et ses sessions (au blocage). Zéro ligne et RIEN d'écrit
-- (l'API vérifie alors l'empreinte factice) si : le terminal n'a pas de point de vente ou n'est pas
-- en mode CATALOG_POS / KEYPAD_TPE ; le vendeur n'existe pas, n'est pas du prestataire, n'est pas
-- du commerçant du point de vente du terminal, n'est pas ACTIVE ou est bloqué. Un vendeur d'un
-- autre commerçant n'est donc jamais compté, ni même verrouillé. Sinon l'essai est compté AVANT la
-- vérification ; le 5e compte bloque le vendeur, retire ses essais non utilisés (ceux des essais 1
-- à 4) et ferme ses sessions (VENDOR_LOCKED) ; `locked` vrai si ce compte vient de bloquer (l'API
-- audite VENDOR_LOCKED). Conséquence du contrat (signalée, plus stricte que la lettre de FR-004) :
-- 4 PIN faux puis le bon PIN bloquent le vendeur, le 5e essai étant bloqué avant d'être vérifié.
CREATE FUNCTION begin_vendor_pin_check(p_vendor uuid, p_device uuid)
RETURNS TABLE (check_id uuid, pin_hash text, locked boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE
  v_operator uuid := nullif(current_setting('app.operator_id', true), '')::uuid;
  d device%ROWTYPE;
  v vendor%ROWTYPE;
  v_merchant uuid;
  v_attempts int;
  v_check uuid;
BEGIN
  IF v_operator IS NULL OR p_device IS NULL THEN
    RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found';
  END IF;
  -- 1. Terminal du prestataire (comme assert_device_active).
  SELECT * INTO d FROM device WHERE id = p_device AND operator_id = v_operator FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  IF d.status = 'REVOKED' THEN
    RAISE EXCEPTION 'Terminal révoqué' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF d.status = 'SUSPENDED' THEN
    RAISE EXCEPTION 'Terminal suspendu' USING ERRCODE = 'CL030';
  END IF;
  IF p_vendor IS NULL OR d.pos_id IS NULL OR d.app_mode NOT IN ('CATALOG_POS','KEYPAD_TPE') THEN
    RETURN;
  END IF;
  -- Commerçant du point de vente du terminal.
  SELECT mp.merchant_id INTO v_merchant
    FROM point_of_sale p JOIN merchant_participation mp ON mp.id = p.participation_id
   WHERE p.id = d.pos_id AND p.operator_id = v_operator AND mp.operator_id = v_operator;
  IF v_merchant IS NULL THEN
    RETURN;
  END IF;
  -- 2. Vendeur de ce commerçant, verrouillé.
  SELECT * INTO v FROM vendor
   WHERE id = p_vendor AND operator_id = v_operator AND merchant_id = v_merchant FOR UPDATE;
  IF NOT FOUND OR v.status <> 'ACTIVE' OR v.locked_at IS NOT NULL THEN
    RETURN;
  END IF;
  -- 3. Essai compté avant la vérification ; au 5e, blocage et fermeture des sessions du vendeur.
  v_attempts := v.failed_attempts + 1;
  IF v_attempts >= 5 THEN
    UPDATE vendor SET failed_attempts = 5, locked_at = now()
     WHERE id = v.id AND operator_id = v_operator;
    DELETE FROM vendor_pin_check
     WHERE vendor_id = v.id AND operator_id = v_operator AND used_at IS NULL;
    UPDATE vendor_session SET closed_at = now(), closed_reason = 'VENDOR_LOCKED'
     WHERE vendor_id = v.id AND operator_id = v_operator AND closed_at IS NULL;
  ELSE
    UPDATE vendor SET failed_attempts = v_attempts WHERE id = v.id AND operator_id = v_operator;
  END IF;
  INSERT INTO vendor_pin_check (operator_id, vendor_id, device_id, created_at, expires_at)
  VALUES (v_operator, v.id, d.id, now(), now() + interval '30 seconds')
  RETURNING id INTO v_check;
  RETURN QUERY SELECT v_check, v.pin_hash, v_attempts >= 5;
END $$;
REVOKE ALL ON FUNCTION begin_vendor_pin_check(uuid, uuid) FROM PUBLIC;

-- 3e. Transaction B : ouverture de la session (appelée par l'API seulement si le PIN est bon) -----
-- Revérifie tout sous verrou ; tout échec rend CL033, même SQLSTATE et même message pour chaque
-- cause (NFR-004 : aucun détail exploitable). Verrous : terminal FOR SHARE, vendeur du check FOR
-- UPDATE (lu d'abord sans verrou), check FOR UPDATE, puis les sessions du terminal. Limite
-- consignée (A15, OP-N76, ADR-121) : la base croit l'API sur la vérification du PIN.
CREATE FUNCTION open_vendor_session(p_check uuid, p_device uuid)
RETURNS TABLE (vendor_session_id uuid, vendor_id uuid, vendor_display_name text,
               expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE
  v_operator uuid := nullif(current_setting('app.operator_id', true), '')::uuid;
  d device%ROWTYPE;
  v vendor%ROWTYPE;
  c vendor_pin_check%ROWTYPE;
  v_vendor uuid;
  v_merchant uuid;
  v_session uuid;
  v_expires timestamptz;
BEGIN
  IF v_operator IS NULL OR p_device IS NULL OR p_check IS NULL THEN
    RAISE EXCEPTION 'Ouverture de session refusée' USING ERRCODE = 'CL033';
  END IF;
  -- Terminal du prestataire, ACTIVE, en mode de vente, affecté à un point de vente.
  SELECT * INTO d FROM device WHERE id = p_device AND operator_id = v_operator FOR SHARE;
  IF NOT FOUND OR d.status <> 'ACTIVE' OR d.pos_id IS NULL
     OR d.app_mode NOT IN ('CATALOG_POS','KEYPAD_TPE') THEN
    RAISE EXCEPTION 'Ouverture de session refusée' USING ERRCODE = 'CL033';
  END IF;
  SELECT mp.merchant_id INTO v_merchant
    FROM point_of_sale p JOIN merchant_participation mp ON mp.id = p.participation_id
   WHERE p.id = d.pos_id AND p.operator_id = v_operator AND mp.operator_id = v_operator;
  -- Vendeur du check, lu sans verrou (colonne jamais modifiée), puis verrouillé.
  SELECT k.vendor_id INTO v_vendor FROM vendor_pin_check k
   WHERE k.id = p_check AND k.operator_id = v_operator AND k.device_id = d.id;
  IF v_vendor IS NULL OR v_merchant IS NULL THEN
    RAISE EXCEPTION 'Ouverture de session refusée' USING ERRCODE = 'CL033';
  END IF;
  SELECT * INTO v FROM vendor x WHERE x.id = v_vendor AND x.operator_id = v_operator FOR UPDATE;
  IF NOT FOUND OR v.status <> 'ACTIVE' OR v.locked_at IS NOT NULL
     OR v.merchant_id <> v_merchant THEN
    RAISE EXCEPTION 'Ouverture de session refusée' USING ERRCODE = 'CL033';
  END IF;
  -- Check à usage unique, de ce vendeur et de ce terminal, non expiré.
  SELECT * INTO c FROM vendor_pin_check k
   WHERE k.id = p_check AND k.operator_id = v_operator FOR UPDATE;
  IF NOT FOUND OR c.vendor_id <> v.id OR c.device_id <> d.id OR c.used_at IS NOT NULL
     OR c.expires_at <= now() THEN
    RAISE EXCEPTION 'Ouverture de session refusée' USING ERRCODE = 'CL033';
  END IF;
  UPDATE vendor_pin_check k SET used_at = now() WHERE k.id = c.id AND k.operator_id = v_operator;
  UPDATE vendor x SET failed_attempts = 0 WHERE x.id = v.id AND x.operator_id = v_operator;
  -- Session précédente du terminal fermée, puis la nouvelle (une ouverte par terminal).
  UPDATE vendor_session s SET closed_at = now(), closed_reason = 'REPLACED'
   WHERE s.device_id = d.id AND s.operator_id = v_operator AND s.closed_at IS NULL;
  INSERT INTO vendor_session (operator_id, vendor_id, device_id, opened_at, expires_at)
  VALUES (v_operator, v.id, d.id, now(), now() + interval '12 hours')
  RETURNING id, vendor_session.expires_at INTO v_session, v_expires;
  RETURN QUERY SELECT v_session, v.id, v.display_name, v_expires;
END $$;
REVOKE ALL ON FUNCTION open_vendor_session(uuid, uuid) FROM PUBLIC;

-- 3f. Fin de session demandée par le terminal (LOGOUT) --------------------------------------------
-- Rend l'identifiant de la session fermée, ou NULL s'il n'y en avait pas (l'API décide de la
-- réponse). Aucun contrôle de statut du terminal : fermer ne donne aucun droit (un terminal
-- suspendu ou révoqué n'a déjà plus de session ouverte). Verrous : terminal FOR SHARE, puis la
-- session (vendeur sauté).
CREATE FUNCTION close_vendor_session(p_device uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_operator uuid := nullif(current_setting('app.operator_id', true), '')::uuid;
  v_id uuid;
BEGIN
  IF v_operator IS NULL OR p_device IS NULL THEN
    RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found';
  END IF;
  PERFORM 1 FROM device WHERE id = p_device AND operator_id = v_operator FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  UPDATE vendor_session SET closed_at = now(), closed_reason = 'LOGOUT'
   WHERE device_id = p_device AND operator_id = v_operator AND closed_at IS NULL
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION close_vendor_session(uuid) FROM PUBLIC;

-- 3g. Garde de session (ventes, annulations, demandes QR) -----------------------------------------
-- Rend le vendeur de la session. Ne prend PAS le terminal : l'appelant l'a déjà pris
-- (record_device_seq FOR UPDATE, puis assert_device_active), ordre global. Lit sans verrou le
-- vendeur de la session, prend FOR SHARE le vendeur puis la session, puis revérifie : session du
-- prestataire, de ce terminal, ouverte, égale à p_session, non expirée ; vendeur ACTIVE et non
-- bloqué. Sinon CL032.
CREATE FUNCTION assert_vendor_session(p_device uuid, p_session uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_operator uuid := nullif(current_setting('app.operator_id', true), '')::uuid;
  v_vendor uuid;
  v_status text;
  v_locked timestamptz;
  s vendor_session%ROWTYPE;
BEGIN
  IF v_operator IS NULL THEN
    RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found';
  END IF;
  IF p_device IS NULL OR p_session IS NULL THEN
    RAISE EXCEPTION 'Session de vendeur invalide' USING ERRCODE = 'CL032';
  END IF;
  SELECT vendor_id INTO v_vendor FROM vendor_session
   WHERE id = p_session AND operator_id = v_operator AND device_id = p_device;
  IF v_vendor IS NULL THEN
    RAISE EXCEPTION 'Session de vendeur invalide' USING ERRCODE = 'CL032';
  END IF;
  SELECT status, locked_at INTO v_status, v_locked FROM vendor
   WHERE id = v_vendor AND operator_id = v_operator FOR SHARE;
  SELECT * INTO s FROM vendor_session WHERE id = p_session AND operator_id = v_operator FOR SHARE;
  IF v_status IS DISTINCT FROM 'ACTIVE' OR v_locked IS NOT NULL OR s.id IS NULL
     OR s.device_id <> p_device OR s.vendor_id <> v_vendor OR s.closed_at IS NOT NULL
     OR s.expires_at <= now() THEN
    RAISE EXCEPTION 'Session de vendeur invalide' USING ERRCODE = 'CL032';
  END IF;
  RETURN v_vendor;
END $$;
REVOKE ALL ON FUNCTION assert_vendor_session(uuid, uuid) FROM PUBLIC;

-- 4. set_device_status remplacée (A7) -------------------------------------------------------------
-- Corps de 0022 repris À L'IDENTIQUE (dernière définition : aucune migration de 0023 à 0030 ne la
-- remplace), plus la fermeture des sessions de vendeur ouvertes du terminal au passage à SUSPENDED
-- (DEVICE_SUSPENDED) et à REVOKED (DEVICE_REVOKED), après la mise à jour du statut : ordre global
-- terminal (FOR UPDATE), puis sessions. Retour à ACTIVE : aucune session rouverte. CREATE OR
-- REPLACE efface le réglage de la fonction : SECURITY DEFINER et search_path reposés (0021) ; les
-- droits déjà accordés sont conservés, celui de PUBLIC retiré de nouveau.
CREATE OR REPLACE FUNCTION set_device_status(p_device uuid, p_to text, p_reason text, p_actor uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_operator uuid := nullif(current_setting('app.operator_id', true), '')::uuid;
  d device%ROWTYPE;
BEGIN
  IF v_operator IS NULL OR p_device IS NULL THEN
    RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found';
  END IF;
  IF p_to IS NULL OR p_to NOT IN ('ACTIVE','SUSPENDED','REVOKED') THEN
    RAISE EXCEPTION 'Statut de terminal inconnu' USING ERRCODE = 'CL001';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) = 0 OR length(p_reason) > 500 THEN
    RAISE EXCEPTION 'Motif obligatoire (1 à 500 caractères)' USING ERRCODE = 'CL001';
  END IF;
  SELECT * INTO d FROM device WHERE id = p_device AND operator_id = v_operator FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  IF p_actor IS NULL OR NOT device_admin_allowed(v_operator, d.event_id, p_actor) THEN
    RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found';
  END IF;
  IF NOT ((d.status = 'ACTIVE' AND p_to IN ('SUSPENDED','REVOKED'))
          OR (d.status = 'SUSPENDED' AND p_to IN ('ACTIVE','REVOKED'))) THEN
    RAISE EXCEPTION 'Transition de statut interdite : % -> %', d.status, p_to USING ERRCODE = 'CL029';
  END IF;
  UPDATE device SET status = p_to, status_reason = p_reason WHERE id = d.id;
  -- Ajout de 0031 : sessions de vendeur du terminal fermées (A7).
  IF p_to IN ('SUSPENDED','REVOKED') THEN
    UPDATE vendor_session
       SET closed_at = now(),
           closed_reason = CASE p_to WHEN 'SUSPENDED' THEN 'DEVICE_SUSPENDED'
                                     ELSE 'DEVICE_REVOKED' END
     WHERE device_id = d.id AND operator_id = v_operator AND closed_at IS NULL;
  END IF;
  IF p_to = 'REVOKED' THEN
    UPDATE device_refresh_token SET revoked_at = now(), revoked_reason = 'DEVICE_REVOKED'
     WHERE device_id = d.id AND operator_id = v_operator AND revoked_at IS NULL;
  END IF;
  INSERT INTO device_status_history (operator_id, device_id, from_status, to_status, reason, actor_id)
  VALUES (v_operator, d.id, d.status, p_to, p_reason, p_actor);
END $$;
REVOKE ALL ON FUNCTION set_device_status(uuid, text, text, uuid) FROM PUBLIC;

-- 5. Purge des essais (0022) remplacée : essais de PIN de plus de 24 h en plus --------------------
-- Même signature, déjà accordée à cashless_app et planifiée par le travailleur device-purge
-- (arbitrage de l'orchestrateur, 22/10/2026). Contrôles de 0022 gardés (seuil de 24 h, heure de la
-- base). Sans prestataire de session : même hypothèse que 0022 (propriétaire qui ignore la RLS).
-- Rend le nombre total de lignes retirées des deux tables.
CREATE OR REPLACE FUNCTION purge_device_enrollment_attempts() RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n bigint; m bigint;
BEGIN
  DELETE FROM device_enrollment_attempt WHERE at < clock_timestamp() - interval '24 hours';
  GET DIAGNOSTICS n = ROW_COUNT;
  DELETE FROM vendor_pin_check WHERE created_at < clock_timestamp() - interval '24 hours';
  GET DIAGNOSTICS m = ROW_COUNT;
  RETURN n + m;
END $$;
REVOKE ALL ON FUNCTION purge_device_enrollment_attempts() FROM PUBLIC;
