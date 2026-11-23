-- 0097 : version du secret des codes de rattachement, réémission après rotation, numéro imprimé
-- (mission 10a, WP02, OP-N47 partie base).
-- Chaque empreinte porte la version du secret qui l'a calculée ; une empreinte d'une autre version
-- compte comme absente partout (même réponse qu'un code inconnu). Cinq fonctions changent de
-- signature (l'ancienne est retirée) ; register_personalized_media n'écrit aucune empreinte et reste
-- inchangée. Trois fonctions nouvelles pour l'exploitation (réémission, lecture, version maximale).
-- Aucun GRANT ici : les droits (rôle d'exploitation compris) sont posés par post-roles.sql (WP04).

-- 1. Colonnes ---------------------------------------------------------------------------------------
ALTER TABLE media ADD COLUMN claim_key_version smallint NOT NULL DEFAULT 1
  CONSTRAINT media_claim_key_version CHECK (claim_key_version >= 1);
ALTER TABLE claim_code ADD COLUMN key_version smallint NOT NULL DEFAULT 1
  CONSTRAINT claim_code_key_version CHECK (key_version >= 1);
ALTER TABLE media_claim ADD COLUMN key_version smallint NOT NULL DEFAULT 1
  CONSTRAINT media_claim_key_version CHECK (key_version >= 1);

-- Numéro imprimé sur le bracelet (3e colonne facultative du fichier de l'imprimeur).
ALTER TABLE media ADD COLUMN printed_number text
  CONSTRAINT media_printed_number CHECK (printed_number ~ '^[A-Z0-9-]{1,32}$');
CREATE UNIQUE INDEX media_printed_number_key ON media (operator_id, printed_number)
  WHERE printed_number IS NOT NULL;

-- 2. Les cinq fonctions versionnées -------------------------------------------------------------------
DROP FUNCTION issue_claim_codes(uuid, bytea[]);
DROP FUNCTION associate_claim_code(bytea, uuid);
DROP FUNCTION claim_media(bytea, uuid, text, uuid, bytea);
DROP FUNCTION confirm_media_claim(uuid, uuid, bytea, uuid, uuid);
DROP FUNCTION public_balance_lookup(bytea, text);

-- Enregistre les empreintes du fichier de commande. Une seule fois par lot (la réémission est la
-- seule voie après rotation) ; lot PUBLIC seulement.
CREATE FUNCTION issue_claim_codes(p_batch uuid, p_hashes bytea[], p_key_version smallint) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE b_operator uuid; b_kind text; b_quantity int; b_issued timestamptz; b_status text;
BEGIN
  IF p_key_version IS NULL OR p_key_version < 1 THEN
    RAISE EXCEPTION 'Version du secret invalide' USING ERRCODE = 'CL001';
  END IF;
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
  INSERT INTO claim_code (operator_id, batch_id, code_hash, key_version)
  SELECT b_operator, p_batch, h, p_key_version FROM unnest(p_hashes) AS h;
  UPDATE media_batch SET claim_codes_issued_at = clock_timestamp() WHERE id = p_batch;
  RETURN b_quantity;
END $$;
REVOKE ALL ON FUNCTION issue_claim_codes(uuid, bytea[], smallint) FROM PUBLIC;

-- Associe un code imprimé à son bracelet (scan au poste, ou fichier de correspondance de l'imprimeur),
-- et pose le numéro imprimé s'il est fourni. Un code d'une autre version que p_key_version est inconnu.
-- Un bracelet dont le code est d'une version plus ancienne, jamais utilisé, est ré-associé : l'ancienne
-- ligne claim_code est libérée (même opération que la réémission).
CREATE FUNCTION associate_claim_code(p_hash bytea, p_media uuid, p_printed_number text,
                                     p_key_version smallint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_operator uuid := claim_session_operator(); c claim_code%ROWTYPE; m_batch uuid; m_hash bytea;
        m_ver smallint; m_used timestamptz; m_printed text; v_num text := upper(p_printed_number);
BEGIN
  IF p_key_version IS NULL OR p_key_version < 1 THEN
    RAISE EXCEPTION 'Version du secret invalide' USING ERRCODE = 'CL001';
  END IF;
  -- Bracelet et code du prestataire de la session (contrôles explicites : la RLS ne s'applique pas ici).
  SELECT batch_id, claim_code_hash, claim_key_version, claim_code_used_at, printed_number
    INTO m_batch, m_hash, m_ver, m_used, m_printed
    FROM media WHERE id = p_media AND operator_id = v_operator FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  SELECT * INTO c FROM claim_code
   WHERE operator_id = v_operator AND code_hash = p_hash AND key_version = p_key_version FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CLAIM_CODE_UNKNOWN : code inconnu' USING ERRCODE = 'CL020';
  ELSIF c.invalidated_at IS NOT NULL THEN
    RAISE EXCEPTION 'CLAIM_CODE_INVALIDATED : code invalidé à la clôture du lot' USING ERRCODE = 'CL020';
  ELSIF c.media_id IS NOT NULL THEN
    RAISE EXCEPTION 'CLAIM_CODE_ALREADY_ASSOCIATED : code déjà associé à un bracelet' USING ERRCODE = 'CL020';
  ELSIF m_batch IS DISTINCT FROM c.batch_id THEN
    RAISE EXCEPTION 'CLAIM_CODE_OTHER_BATCH : ce code appartient à un autre lot' USING ERRCODE = 'CL020';
  ELSIF m_hash IS NOT NULL AND (m_ver >= p_key_version OR m_used IS NOT NULL) THEN
    RAISE EXCEPTION 'MEDIA_ALREADY_HAS_CODE : ce bracelet porte déjà un code' USING ERRCODE = 'CL020';
  END IF;
  -- Numéro imprimé : pris par un autre bracelet du prestataire, ou bracelet qui en porte déjà un autre.
  IF v_num IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM media WHERE operator_id = v_operator AND printed_number = v_num
                  AND id <> p_media)
       OR (m_printed IS NOT NULL AND m_printed <> v_num) THEN
      RAISE EXCEPTION 'PRINTED_NUMBER_TAKEN : numéro imprimé déjà pris' USING ERRCODE = 'CL065';
    END IF;
  END IF;
  -- Ancienne association d'une version antérieure : libérée avant la nouvelle (index claim_code_media_key).
  IF m_hash IS NOT NULL THEN
    UPDATE claim_code SET media_id = NULL, associated_at = NULL, invalidated_at = clock_timestamp()
     WHERE media_id = p_media AND operator_id = v_operator;
  END IF;
  UPDATE claim_code SET media_id = p_media, associated_at = clock_timestamp()
   WHERE id = c.id AND operator_id = v_operator;
  BEGIN
    UPDATE media SET claim_code_hash = p_hash, claim_key_version = p_key_version,
                     printed_number = coalesce(v_num, printed_number)
     WHERE id = p_media AND operator_id = v_operator;
  EXCEPTION WHEN unique_violation THEN
    -- Course sur le numéro imprimé (le contrôle explicite ci-dessus n'a pas vu l'autre transaction).
    IF SQLERRM LIKE '%media_printed_number_key%' THEN
      RAISE EXCEPTION 'PRINTED_NUMBER_TAKEN : numéro imprimé déjà pris (concurrence)' USING ERRCODE = 'CL065';
    END IF;
    RAISE;
  END;
END $$;
REVOKE ALL ON FUNCTION associate_claim_code(bytea, uuid, text, smallint) FROM PUBLIC;

-- Rattachement : corps de 0010 ; le bracelet est cherché avec la version du secret, la demande la porte.
CREATE FUNCTION claim_media(p_hash bytea, p_customer uuid, p_device_ref text, p_claim_id uuid,
                            p_confirmation_hash bytea, p_key_version smallint)
RETURNS TABLE (outcome text, claim_id uuid, media_id uuid, expires_at timestamptz)
LANGUAGE plpgsql AS $$
DECLARE v_operator uuid := claim_session_operator();
        m_id uuid; m_status text; m_used timestamptz;
        v_outcome text := 'REFUSED'; v_expires timestamptz; v_wallets int; v_attached int; v_spendable bigint; v_pending int;
BEGIN
  IF p_key_version IS NULL OR p_key_version < 1 THEN
    RAISE EXCEPTION 'Version du secret invalide' USING ERRCODE = 'CL001';
  END IF;
  IF p_customer IS NULL OR NOT EXISTS (SELECT 1 FROM party WHERE id = p_customer AND kind = 'CUSTOMER' AND operator_id = v_operator) THEN
    RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found';
  END IF;
  IF claim_attempts_exceeded(v_operator, p_customer, p_device_ref) THEN
    INSERT INTO claim_attempt (operator_id, customer_id, device_ref, code_hash, outcome) VALUES (v_operator, p_customer, p_device_ref, p_hash, 'BLOCKED');
    RETURN QUERY SELECT 'BLOCKED'::text, NULL::uuid, NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;

  SELECT m.id, m.status, m.claim_code_used_at INTO m_id, m_status, m_used
    FROM media m WHERE m.operator_id = v_operator AND m.claim_code_hash = p_hash
     AND m.claim_key_version = p_key_version FOR UPDATE;

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
            INSERT INTO media_claim (id, operator_id, media_id, customer_id, confirmation_hash, expires_at, key_version)
            VALUES (p_claim_id, v_operator, m_id, p_customer, p_confirmation_hash, v_expires, p_key_version);
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
REVOKE ALL ON FUNCTION claim_media(bytea, uuid, text, uuid, bytea, smallint) FROM PUBLIC;

-- Confirmation au guichet : corps de 0010 ; la demande lue doit porter la version du secret appelante.
CREATE FUNCTION confirm_media_claim(p_claim uuid, p_media uuid, p_confirmation_hash bytea, p_device uuid,
                                    p_actor uuid, p_key_version smallint)
RETURNS text
LANGUAGE plpgsql AS $$
DECLARE v_operator uuid := claim_session_operator(); c media_claim%ROWTYPE; m_status text; v_attached int; v_wallets int;
BEGIN
  IF p_key_version IS NULL OR p_key_version < 1 THEN
    RAISE EXCEPTION 'Version du secret invalide' USING ERRCODE = 'CL001';
  END IF;
  SELECT * INTO c FROM media_claim
   WHERE id = p_claim AND operator_id = v_operator AND key_version = p_key_version FOR UPDATE;
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
REVOKE ALL ON FUNCTION confirm_media_claim(uuid, uuid, bytea, uuid, uuid, smallint) FROM PUBLIC;

-- Consultation anonyme du solde : corps de 0010 ; le bracelet est cherché avec la version du secret.
-- REFUSED sans distinction pour un code inconnu, d'une autre version, utilisé, ou un bracelet rattaché.
CREATE FUNCTION public_balance_lookup(p_hash bytea, p_address_ref text, p_key_version smallint)
RETURNS TABLE (outcome text, currency char(3), spendable bigint, media_status text, movements jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE m_id uuid; m_operator uuid; m_status text; v_found boolean := false; v_blocked boolean;
BEGIN
  IF p_hash IS NULL OR octet_length(p_hash) <> 32 OR p_address_ref IS NULL
     OR p_key_version IS NULL OR p_key_version < 1 THEN
    RAISE EXCEPTION 'Empreinte de 32 octets, référence d''adresse et version du secret attendues' USING ERRCODE = 'CL001';
  END IF;
  SELECT m.id, m.operator_id, m.status INTO m_id, m_operator, m_status FROM media m
   WHERE m.claim_code_hash = p_hash AND m.claim_key_version = p_key_version
     AND m.claim_code_used_at IS NULL AND m.status = 'ACTIVE'
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
REVOKE ALL ON FUNCTION public_balance_lookup(bytea, text, smallint) FROM PUBLIC;

-- 3. Exploitation : version maximale, bracelets réémissibles, réémission ---------------------------------
-- Plus haute version du secret présente en base (0 si aucune ligne) : sert au refus de démarrage de l'API.
CREATE FUNCTION claim_key_version_max() RETURNS smallint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce(greatest(
           (SELECT max(claim_key_version) FROM media),
           (SELECT max(key_version) FROM claim_code),
           (SELECT max(key_version) FROM media_claim)), 0)::smallint
$$;
REVOKE ALL ON FUNCTION claim_key_version_max() FROM PUBLIC;

-- Prédicat unique de « réémissible », partagé par reissuable_media et reissue_claim_codes : bracelet du
-- prestataire et du lot, sans code, ou au code d'une version plus ancienne jamais utilisé.
CREATE FUNCTION claim_media_reissuable(p_media uuid, p_operator uuid, p_batch uuid, p_key_version smallint)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM media m
     WHERE m.id = p_media AND m.operator_id = p_operator AND m.batch_id = p_batch
       AND (m.claim_code_hash IS NULL
            OR (m.claim_key_version < p_key_version AND m.claim_code_used_at IS NULL)))
$$;
REVOKE ALL ON FUNCTION claim_media_reissuable(uuid, uuid, uuid, smallint) FROM PUBLIC;

-- Bracelets du lot que reissue_claim_codes accepterait, par rang (ordre stable de media.id), avec leur UID et leur
-- numéro imprimé (le rôle d'exploitation n'a aucun droit de table : le fichier de commande nomme son bracelet).
CREATE FUNCTION reissuable_media(p_operator uuid, p_batch uuid, p_key_version smallint)
RETURNS TABLE (media_id uuid, rank int, nfc_uid bytea, printed_number text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE b_kind text;
BEGIN
  IF p_operator IS NULL OR p_batch IS NULL OR p_key_version IS NULL OR p_key_version < 1 THEN
    RAISE EXCEPTION 'Paramètres invalides' USING ERRCODE = 'CL001';
  END IF;
  SELECT kind INTO b_kind FROM media_batch WHERE id = p_batch AND operator_id = p_operator;
  IF NOT FOUND THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  IF b_kind <> 'PUBLIC' THEN
    RAISE EXCEPTION 'CLAIM_CODES_NOT_PUBLIC : seuls les lots PUBLIC portent un code de rattachement' USING ERRCODE = 'CL020';
  END IF;
  RETURN QUERY
    SELECT m.id, (row_number() OVER (ORDER BY m.id))::int, m.nfc_uid, m.printed_number
      FROM media m
     WHERE m.operator_id = p_operator AND m.batch_id = p_batch
       AND claim_media_reissuable(m.id, p_operator, p_batch, p_key_version)
     ORDER BY m.id;
END $$;
REVOKE ALL ON FUNCTION reissuable_media(uuid, uuid, smallint) FROM PUBLIC;

-- Réémission après rotation : tout ou rien. Sans session de prestataire (rôle d'exploitation) : tout
-- filtre porte p_operator. Ne renvoie ni n'écrit jamais un code en clair ; l'audit ne porte que le nombre.
CREATE FUNCTION reissue_claim_codes(p_operator uuid, p_batch uuid, p_media uuid[], p_hashes bytea[],
                                    p_key_version smallint) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE b_kind text; v_n int; v_ok int; h bytea;
BEGIN
  IF p_operator IS NULL OR p_batch IS NULL OR p_media IS NULL OR p_hashes IS NULL
     OR p_key_version IS NULL OR p_key_version < 1
     OR coalesce(cardinality(p_media), 0) = 0 OR cardinality(p_media) <> cardinality(p_hashes)
     OR array_position(p_media, NULL) IS NOT NULL OR array_position(p_hashes, NULL) IS NOT NULL
     OR (SELECT count(DISTINCT x) FROM unnest(p_media) x) <> cardinality(p_media)
     OR (SELECT count(DISTINCT x) FROM unnest(p_hashes) x) <> cardinality(p_hashes) THEN
    RAISE EXCEPTION 'Paramètres de réémission invalides' USING ERRCODE = 'CL001';
  END IF;
  FOREACH h IN ARRAY p_hashes LOOP
    IF octet_length(h) <> 32 THEN
      RAISE EXCEPTION 'Empreintes de 32 octets attendues' USING ERRCODE = 'CL001';
    END IF;
  END LOOP;
  v_n := cardinality(p_media);

  SELECT kind INTO b_kind FROM media_batch WHERE id = p_batch AND operator_id = p_operator FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  IF b_kind <> 'PUBLIC' THEN
    RAISE EXCEPTION 'CLAIM_CODES_NOT_PUBLIC : seuls les lots PUBLIC portent un code de rattachement' USING ERRCODE = 'CL020';
  END IF;

  -- Verrou dans l'ordre de media.id, puis contrôle de tous avant toute écriture.
  PERFORM 1 FROM media WHERE id = ANY(p_media) ORDER BY id FOR UPDATE;
  SELECT count(*) INTO v_ok FROM unnest(p_media) AS u(id)
   WHERE claim_media_reissuable(u.id, p_operator, p_batch, p_key_version);
  IF v_ok <> v_n THEN
    RAISE EXCEPTION 'CLAIM_MEDIA_NOT_REISSUABLE : un bracelet au moins n''est pas réémissible' USING ERRCODE = 'CL064';
  END IF;

  -- Anciens rattachements libérés (les CHECK de claim_code imposent media_id et associated_at à NULL
  -- avant invalidated_at), puis les codes du lot non associés d'ancienne version invalidés.
  UPDATE claim_code SET media_id = NULL, associated_at = NULL, invalidated_at = clock_timestamp()
   WHERE media_id = ANY(p_media) AND operator_id = p_operator;
  UPDATE claim_code SET invalidated_at = clock_timestamp()
   WHERE operator_id = p_operator AND batch_id = p_batch AND media_id IS NULL
     AND invalidated_at IS NULL AND key_version < p_key_version;

  INSERT INTO claim_code (operator_id, batch_id, code_hash, key_version, media_id, associated_at)
  SELECT p_operator, p_batch, p_hashes[o.ord], p_key_version, p_media[o.ord], clock_timestamp()
    FROM unnest(p_media) WITH ORDINALITY AS o(id, ord);
  UPDATE media SET claim_code_hash = p_hashes[o.ord], claim_key_version = p_key_version
    FROM unnest(p_media) WITH ORDINALITY AS o(id, ord)
   WHERE media.id = o.id AND media.operator_id = p_operator;

  INSERT INTO audit_log (operator_id, actor_id, actor_role, action, object_type, object_id, after, origin)
  VALUES (p_operator, NULL, session_user::text, 'CLAIM_CODES_REISSUED', 'MEDIA_BATCH', p_batch::text,
          jsonb_build_object('count', v_n, 'key_version', p_key_version), 'claim-admin');
  RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION reissue_claim_codes(uuid, uuid, uuid[], bytea[], smallint) FROM PUBLIC;
