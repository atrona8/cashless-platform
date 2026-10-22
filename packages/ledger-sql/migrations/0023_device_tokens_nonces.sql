-- Migration 0023 : jetons de rafraîchissement, nonces de requête et garde de statut des terminaux
-- (mission identite-enrolement-terminaux, lot WP04 ; FR-011, FR-012, FR-014, NFR-003, NFR-004, NFR-008 ;
-- data-model « Jeton de rafraîchissement », « Nonce de requête », « Fonctions » ; contracts/device-tokens.md,
-- contracts/device-authentication.md ; research R-04 (rejeu, horloge), R-07 (grâce), R-14 (garde et
-- écriture) ; OP-N65, ADR-108).
--
-- Contenu :
--   1. `device_refresh_token` (créée par 0022) : index (device_id, family_id) pour le contrôle de famille.
--   2. `device_request_nonce` : nonces de requête, RLS activée et forcée, ajout seul (sauf la purge).
--   3. Fonctions SECURITY DEFINER, `search_path = public, pg_temp` (OP-N59), EXECUTE retiré à PUBLIC.
--      Les droits par rôle sont posés par `post-roles.sql` (lot WP07), jamais ici :
--        rotate_device_refresh_token   échange d'un jeton (verrou NOWAIT, grâce de 60 s, réutilisation)
--        revoke_device_token_family    révocation d'une famille
--        device_token_family_active    famille non révoquée (contrôle du claim `fid` à chaque requête)
--        consume_device_nonce          fenêtre d'horloge (heure de la base) et rejeu
--        purge_device_request_nonces   purge par lots des nonces expirés (heure de la base)
--        assert_device_active          statut relu FOR SHARE dans la transaction métier (R-14)
--
-- Prestataire : `rotate_device_refresh_token` suit `enroll_device` (0022) : la route de rafraîchissement n'a
-- pas de jeton d'appareil ; si la session a un prestataire et qu'il diffère de celui du jeton, le jeton est
-- traité comme inconnu ; sans prestataire de session, le prestataire est celui du jeton. Ce cas et la purge
-- (travail sans prestataire) SUPPOSENT un propriétaire qui ignore la RLS, même hypothèse que 0019, 0020 et
-- 0022 (avec un propriétaire soumis à la RLS, l'échec est fermé : jeton inconnu, rien de purgé). Toutes les
-- autres fonctions exigent le prestataire de la session (`app.operator_id`) et le nomment dans chaque
-- lecture et chaque écriture.
--
-- Erreurs (traduites par apps/api/src/errors/sqlstate-map.ts, lot WP12) :
--   CL001   paramètre invalide (dont tolérance d'horloge hors de 1 à 300 s)  -> 422 VALIDATION_FAILED (existant)
--   CL030   terminal suspendu (assert_device_active)                          -> 403 DEVICE_SUSPENDED (nouveau)
--   42501   terminal révoqué (assert_device_active) : même SQLSTATE que le schéma de référence
--           (`open_offline_batch`) et que `record_device_heartbeat` (0022)   -> 403 DEVICE_REVOKED (existant)
--   P0002   objet introuvable, d'un autre prestataire, ou sans prestataire de session -> 404 (existant)
--   25000   échange ou révocation de famille hors READ COMMITTED (erreur de programmation) -> 500
-- L'échange de jeton et la consommation d'un nonce rendent un résultat au lieu d'une erreur : une
-- révocation de famille (REUSED) doit être validée avec la transaction, pas annulée par une exception.
--
-- Écrivains d'une famille de jetons : sérialisés par un verrou consultatif de transaction, de clé
-- hashtextextended('device-token-family:' || family_id, 0) (préfixe propre à ce verrou).
-- Sans lui, une révocation (UPDATE … WHERE family_id = …) partie pendant un échange concurrent
-- ne voit pas le successeur que cet échange insère : le jeton volé resterait vivant (FR-011).
-- Pris en essai par rotate_device_refresh_token (échec : IN_PROGRESS, rien n'est écrit), en
-- attente par revoke_device_token_family. Les deux exigent READ COMMITTED : chaque instruction
-- exécutée APRÈS le verrou relit les successeurs validés ; sous REPEATABLE READ, l'image daterait
-- du début de la transaction et le verrou ne servirait à rien (refus 25000, échec fermé).
-- Ordre des verrous, pour toute transaction : terminal (ligne `device`), famille (consultatif),
-- puis jetons (lignes). set_device_status (terminal FOR UPDATE, puis jetons) est sérialisé avec
-- l'échange par la ligne du terminal ; un appelant de revoke_device_token_family qui verrouille
-- aussi le terminal le fait AVANT d'appeler la fonction.

-- 1. Jetons : index du contrôle de famille ----------------------------------------------------------
CREATE INDEX device_refresh_token_device_family_idx ON device_refresh_token (device_id, family_id);

-- 2. Nonces de requête -------------------------------------------------------------------------------
-- `operator_id` en plus des colonnes de data-model : porte la politique de cloisonnement (RLS forcée).
-- Écrite seulement par consume_device_nonce, APRÈS vérification du certificat, du jeton et de la
-- signature (aucune écriture pour une requête non authentifiée) ; un doublon de la clé = rejeu.
CREATE TABLE device_request_nonce (
  operator_id uuid NOT NULL REFERENCES party(id),
  device_id   uuid NOT NULL REFERENCES device(id),
  nonce       bytea NOT NULL
              CONSTRAINT device_request_nonce_length CHECK (octet_length(nonce) BETWEEN 16 AND 64),
  expires_at  timestamptz NOT NULL,                  -- created + 2 × tolérance
  CONSTRAINT device_request_nonce_pkey PRIMARY KEY (device_id, nonce)
);
CREATE INDEX device_request_nonce_expires_idx ON device_request_nonce (expires_at);
-- Ajout seul, sauf la purge (DELETE par purge_device_request_nonces).
CREATE TRIGGER device_request_nonce_immutable BEFORE UPDATE ON device_request_nonce
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
ALTER TABLE device_request_nonce ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_request_nonce FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON device_request_nonce
  USING (operator_id = current_setting('app.operator_id', true)::uuid)
  WITH CHECK (operator_id = current_setting('app.operator_id', true)::uuid);

-- 3. Fonctions ---------------------------------------------------------------------------------------
-- 3a. Échange d'un jeton de rafraîchissement (contracts/device-tokens.md, R-07, ADR-108) -------------
-- Rend (outcome, device_id, family_id). Résultats :
--   IN_PROGRESS  le jeton (ou son successeur, dans la grâce) est verrouillé par un échange en cours :
--                rien n'est écrit, l'API répond 409 CONFLICT_STATE (à réessayer)
--   INVALID      jeton inconnu, d'un autre prestataire que la session, expiré ou révoqué -> 401
--   SUSPENDED    terminal suspendu -> 403 DEVICE_SUSPENDED ; REVOKED : terminal révoqué -> 403 DEVICE_REVOKED
--   REUSED       autre certificat que celui du terminal, ou jeton consommé hors grâce : famille révoquée
--                (REUSE), validée avec la transaction ; l'API écrit l'audit DEVICE_TOKEN_REUSE -> 401
--   ROTATED      jeton consommé, successeur créé (p_new_hash)
--   GRACE        jeton consommé représenté UNE fois, dans les 60 s, avec le même certificat, et dont le
--                successeur n'a jamais servi : ce successeur est révoqué (GRACE_REPLACED), un nouveau est
--                créé, grace_used_at posé (OP-N65, ADR-108)
-- device_id et family_id sont NULL pour IN_PROGRESS et INVALID (rien n'est dit d'un jeton inconnu).
-- Ordre des verrous : terminal (FOR SHARE), famille (consultatif, en essai), jeton (FOR UPDATE
-- NOWAIT), l'ordre général ci-dessus. Aucun verrou n'est attendu après la ligne du terminal : pas
-- d'interblocage avec set_device_status ni avec revoke_device_token_family. À appeler seul dans sa
-- transaction (route de rafraîchissement), sans autre verrou pris avant.
CREATE FUNCTION rotate_device_refresh_token(p_token_hash bytea, p_cert_sha256 bytea, p_new_hash bytea,
                                            p_new_expires timestamptz)
RETURNS TABLE (outcome text, device_id uuid, family_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE
  -- Durée de grâce : constante (ADR-108, décision du porteur), pas un réglage.
  c_grace CONSTANT interval := interval '60 seconds';
  v_session uuid := nullif(current_setting('app.operator_id', true), '')::uuid;
  v_id uuid; v_device uuid; v_operator uuid; v_family uuid;
  t device_refresh_token%ROWTYPE;
  s device_refresh_token%ROWTYPE;
  d device%ROWTYPE;
  v_new uuid;
BEGIN
  IF p_cert_sha256 IS NULL OR octet_length(p_cert_sha256) <> 32 THEN
    RAISE EXCEPTION 'Rafraîchissement : empreinte du certificat de 32 octets attendue' USING ERRCODE = 'CL001';
  END IF;
  IF p_new_hash IS NULL OR octet_length(p_new_hash) <> 32 OR p_new_hash = p_token_hash
     OR p_new_expires IS NULL OR p_new_expires <= now() THEN
    RAISE EXCEPTION 'Rafraîchissement : nouveau jeton invalide' USING ERRCODE = 'CL001';
  END IF;
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'Rafraîchissement : READ COMMITTED exigé'
      USING ERRCODE = 'invalid_transaction_state';
  END IF;

  -- 1. Jeton (lecture sans verrou, pour verrouiller le terminal d'abord). Inconnu, ou d'un autre
  --    prestataire que la session : INVALID, sans distinction.
  IF p_token_hash IS NOT NULL AND octet_length(p_token_hash) = 32 THEN
    SELECT r.id, r.device_id, r.operator_id, r.family_id INTO v_id, v_device, v_operator, v_family
      FROM device_refresh_token r WHERE r.token_hash = p_token_hash;
  END IF;
  IF v_id IS NULL OR (v_session IS NOT NULL AND v_session IS DISTINCT FROM v_operator) THEN
    RETURN QUERY SELECT 'INVALID'::text, NULL::uuid, NULL::uuid; RETURN;
  END IF;

  -- 2. Terminal (FOR SHARE : une révocation en cours est attendue, puis relue), famille (verrou
  --    consultatif en essai : si un autre écrivain de la famille est en cours, rien n'est écrit)
  --    et jeton (NOWAIT). Les lectures et écritures qui suivent voient les successeurs validés.
  SELECT * INTO d FROM device WHERE id = v_device AND operator_id = v_operator FOR SHARE;
  IF NOT pg_try_advisory_xact_lock(
           hashtextextended('device-token-family:' || v_family::text, 0)) THEN
    RETURN QUERY SELECT 'IN_PROGRESS'::text, NULL::uuid, NULL::uuid; RETURN;
  END IF;
  BEGIN
    SELECT * INTO t FROM device_refresh_token WHERE id = v_id FOR UPDATE NOWAIT;
  EXCEPTION WHEN lock_not_available THEN
    RETURN QUERY SELECT 'IN_PROGRESS'::text, NULL::uuid, NULL::uuid; RETURN;
  END;

  -- 3. Expiré ou révoqué (dont famille déjà révoquée, successeur remplacé dans la grâce).
  IF d.id IS NULL OR t.revoked_at IS NOT NULL OR t.expires_at <= now() THEN
    RETURN QUERY SELECT 'INVALID'::text, NULL::uuid, NULL::uuid; RETURN;
  END IF;

  -- 4. Jeton présenté avec un autre certificat que celui du terminal : vol présumé, famille
  --    révoquée. Contrôlé AVANT le statut (renforcement, relecture WP04 M5) : sinon le jeton volé
  --    d'un terminal suspendu resterait valable à sa réactivation.
  IF p_cert_sha256 IS DISTINCT FROM d.cert_sha256 THEN
    UPDATE device_refresh_token r SET revoked_at = now(), revoked_reason = 'REUSE'
     WHERE r.family_id = t.family_id AND r.device_id = t.device_id AND r.operator_id = v_operator
       AND r.revoked_at IS NULL;
    RETURN QUERY SELECT 'REUSED'::text, t.device_id, t.family_id; RETURN;
  END IF;

  -- 5. Statut du terminal : rien n'est écrit.
  IF d.status = 'REVOKED' THEN
    RETURN QUERY SELECT 'REVOKED'::text, t.device_id, t.family_id; RETURN;
  END IF;
  IF d.status = 'SUSPENDED' THEN
    RETURN QUERY SELECT 'SUSPENDED'::text, t.device_id, t.family_id; RETURN;
  END IF;

  -- 6. Jeton jamais consommé : échange. Ordre imposé par l'index « un seul jeton vivant par famille » et
  --    la clé étrangère du successeur : consommer, créer le successeur, puis le rattacher.
  IF t.consumed_at IS NULL THEN
    UPDATE device_refresh_token r SET consumed_at = now() WHERE r.id = t.id;
    INSERT INTO device_refresh_token (operator_id, device_id, family_id, token_hash, expires_at)
    VALUES (v_operator, t.device_id, t.family_id, p_new_hash, p_new_expires)
    RETURNING id INTO v_new;
    UPDATE device_refresh_token r SET successor_id = v_new WHERE r.id = t.id;
    RETURN QUERY SELECT 'ROTATED'::text, t.device_id, t.family_id; RETURN;
  END IF;

  -- 7. Grâce (OP-N65, ADR-108) : jeton consommé il y a moins de 60 s, grâce jamais utilisée, même
  --    certificat (contrôlé en 4), et successeur jamais utilisé (ni consommé ni révoqué). Le
  --    successeur est verrouillé NOWAIT : s'il est en cours d'échange, rien n'est écrit
  --    (IN_PROGRESS).
  IF t.grace_used_at IS NULL AND t.consumed_at > now() - c_grace AND t.successor_id IS NOT NULL THEN
    BEGIN
      SELECT * INTO s FROM device_refresh_token WHERE id = t.successor_id FOR UPDATE NOWAIT;
    EXCEPTION WHEN lock_not_available THEN
      RETURN QUERY SELECT 'IN_PROGRESS'::text, NULL::uuid, NULL::uuid; RETURN;
    END;
    IF s.consumed_at IS NULL AND s.revoked_at IS NULL THEN
      UPDATE device_refresh_token r SET revoked_at = now(), revoked_reason = 'GRACE_REPLACED' WHERE r.id = s.id;
      INSERT INTO device_refresh_token (operator_id, device_id, family_id, token_hash, expires_at)
      VALUES (v_operator, t.device_id, t.family_id, p_new_hash, p_new_expires)
      RETURNING id INTO v_new;
      UPDATE device_refresh_token r SET grace_used_at = now(), successor_id = v_new WHERE r.id = t.id;
      RETURN QUERY SELECT 'GRACE'::text, t.device_id, t.family_id; RETURN;
    END IF;
  END IF;

  -- 8. Tout autre jeton consommé (seconde représentation, plus de 60 s, successeur déjà utilisé) :
  --    réutilisation, famille révoquée.
  UPDATE device_refresh_token r SET revoked_at = now(), revoked_reason = 'REUSE'
   WHERE r.family_id = t.family_id AND r.device_id = t.device_id AND r.operator_id = v_operator
     AND r.revoked_at IS NULL;
  RETURN QUERY SELECT 'REUSED'::text, t.device_id, t.family_id;
END $$;
REVOKE ALL ON FUNCTION rotate_device_refresh_token(bytea, bytea, bytea, timestamptz) FROM PUBLIC;

-- 3b. Familles ---------------------------------------------------------------------------------------
-- Révoque tous les jetons non révoqués de la famille (consommés compris : une représentation ultérieure
-- reçoit INVALID). Rend le nombre de jetons révoqués (0 : famille déjà révoquée). GRACE_REPLACED est
-- propre à un jeton, jamais à une famille. Verrou consultatif de la famille, en attente, pris
-- après le contrôle d'appartenance (une session ne bloque pas la famille d'un autre prestataire) :
-- un échange en cours est attendu, et la révocation voit le successeur qu'il a créé.
CREATE FUNCTION revoke_device_token_family(p_device uuid, p_family uuid, p_reason text) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_operator uuid := nullif(current_setting('app.operator_id', true), '')::uuid;
  n integer;
BEGIN
  IF v_operator IS NULL OR p_device IS NULL OR p_family IS NULL THEN
    RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found';
  END IF;
  IF p_reason IS NULL OR p_reason NOT IN ('REUSE','DEVICE_REVOKED','REENROLLED') THEN
    RAISE EXCEPTION 'Motif de révocation de famille inconnu' USING ERRCODE = 'CL001';
  END IF;
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'Révocation de famille : READ COMMITTED exigé'
      USING ERRCODE = 'invalid_transaction_state';
  END IF;
  PERFORM 1 FROM device_refresh_token
   WHERE device_id = p_device AND family_id = p_family AND operator_id = v_operator;
  IF NOT FOUND THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('device-token-family:' || p_family::text, 0));
  UPDATE device_refresh_token SET revoked_at = now(), revoked_reason = p_reason
   WHERE device_id = p_device AND family_id = p_family AND operator_id = v_operator AND revoked_at IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION revoke_device_token_family(uuid, uuid, text) FROM PUBLIC;

-- Famille active : elle a un jeton vivant (ni consommé, ni révoqué, ni expiré) pour ce terminal, dans le
-- prestataire de la session. Sans prestataire de session : faux (échec fermé). Appelée à chaque requête
-- d'un terminal pour refuser un jeton d'appareil dont le claim `fid` désigne une famille révoquée.
CREATE FUNCTION device_token_family_active(p_device uuid, p_family uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM device_refresh_token t
     WHERE t.device_id = p_device AND t.family_id = p_family
       AND t.operator_id = nullif(current_setting('app.operator_id', true), '')::uuid
       AND t.consumed_at IS NULL AND t.revoked_at IS NULL AND t.expires_at > now())
$$;
REVOKE ALL ON FUNCTION device_token_family_active(uuid, uuid) FROM PUBLIC;

-- 3c. Nonces de requête (R-04) -------------------------------------------------------------------------
-- Une seule source d'heure : now() de la base. `created` hors de [now − tolérance, now + tolérance] :
-- CLOCK_SKEW, rien n'est écrit (l'API répond 400 CLOCK_SKEW_TOO_LARGE). Sinon insertion avec
-- expires_at = created + 2 × tolérance ; doublon : REPLAY ; sinon OK. Tolérance bornée à 300 s.
CREATE FUNCTION consume_device_nonce(p_device uuid, p_nonce bytea, p_created timestamptz,
                                     p_tolerance_seconds int) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_operator uuid := nullif(current_setting('app.operator_id', true), '')::uuid;
  n integer;
BEGIN
  IF v_operator IS NULL OR p_device IS NULL THEN
    RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found';
  END IF;
  IF p_tolerance_seconds IS NULL OR p_tolerance_seconds < 1 OR p_tolerance_seconds > 300 THEN
    RAISE EXCEPTION 'Tolérance d''horloge hors bornes (1 à 300 s)' USING ERRCODE = 'CL001';
  END IF;
  IF p_nonce IS NULL OR octet_length(p_nonce) NOT BETWEEN 16 AND 64 THEN
    RAISE EXCEPTION 'Nonce de 16 à 64 octets attendu' USING ERRCODE = 'CL001';
  END IF;
  IF p_created IS NULL THEN
    RAISE EXCEPTION 'Heure de création de la requête obligatoire' USING ERRCODE = 'CL001';
  END IF;
  PERFORM 1 FROM device WHERE id = p_device AND operator_id = v_operator;
  IF NOT FOUND THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  IF abs(extract(epoch FROM now() - p_created)) > p_tolerance_seconds THEN
    RETURN 'CLOCK_SKEW';
  END IF;
  INSERT INTO device_request_nonce (operator_id, device_id, nonce, expires_at)
  VALUES (v_operator, p_device, p_nonce, p_created + make_interval(secs => 2 * p_tolerance_seconds))
  ON CONFLICT (device_id, nonce) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN CASE WHEN n = 0 THEN 'REPLAY' ELSE 'OK' END;
END $$;
REVOKE ALL ON FUNCTION consume_device_nonce(uuid, bytea, timestamptz, int) FROM PUBLIC;

-- Purge par lots des nonces expirés depuis plus de 300 s (heure de la base, jamais une heure fournie).
-- La marge est la tolérance maximale : même si la tolérance est relevée entre-temps, une requête encore
-- acceptable par l'horloge (created ≥ now − 300 s) trouve toujours son nonce en table. Sans prestataire
-- (travail de fond) ; SKIP LOCKED : deux purges simultanées ne s'attendent pas. Rend le nombre de lignes.
CREATE FUNCTION purge_device_request_nonces(p_limit int DEFAULT 1000) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  c_margin CONSTANT interval := interval '300 seconds';
  n bigint;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 10000 THEN
    RAISE EXCEPTION 'Purge des nonces : lot de 1 à 10000 lignes' USING ERRCODE = 'CL001';
  END IF;
  DELETE FROM device_request_nonce r
   USING (SELECT x.device_id, x.nonce FROM device_request_nonce x
           WHERE x.expires_at < now() - c_margin
           ORDER BY x.expires_at LIMIT p_limit FOR UPDATE SKIP LOCKED) e
   WHERE r.device_id = e.device_id AND r.nonce = e.nonce;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION purge_device_request_nonces(int) FROM PUBLIC;

-- 3d. Garde de statut dans la transaction métier (R-14) ------------------------------------------------
-- À appeler dans la transaction de toute écriture faite pour un terminal : la garde HTTP lit le statut
-- dans sa propre transaction, une révocation validée entre-temps serait sinon ignorée. FOR SHARE :
-- set_device_status (FOR UPDATE) attend la fin de l'écriture, ou l'écriture attend la révocation et la
-- voit. Révoqué : 42501 (DEVICE_REVOKED) ; suspendu : CL030 (DEVICE_SUSPENDED).
-- Ordre d'appel (interblocage, relecture WP04 M1) : record_device_seq, waive_seq_gap,
-- open_offline_batch (schéma de référence), record_device_heartbeat et set_device_status (0022)
-- prennent le terminal FOR UPDATE. Appeler assert_device_active AVANT l'une d'elles dans la même
-- transaction ferait monter un FOR SHARE en FOR UPDATE : deux requêtes simultanées du même
-- terminal tiendraient chacune le FOR SHARE et s'attendraient (40P01). Règle : l'appeler APRÈS la
-- fonction qui prend le terminal FOR UPDATE (le FOR SHARE est alors déjà couvert), ou pas du tout
-- quand cette fonction contrôle déjà le statut (open_offline_batch). OBLIGATOIRE avant
-- register_tap et post_transaction, qui ne contrôlent pas le statut du terminal (register_tap ne
-- contrôle que son prestataire) et ne le prennent pas FOR UPDATE.
CREATE FUNCTION assert_device_active(p_device uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_operator uuid := nullif(current_setting('app.operator_id', true), '')::uuid;
  v_status text;
BEGIN
  IF v_operator IS NULL OR p_device IS NULL THEN
    RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found';
  END IF;
  SELECT status INTO v_status FROM device WHERE id = p_device AND operator_id = v_operator FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  IF v_status = 'REVOKED' THEN
    RAISE EXCEPTION 'Terminal révoqué' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_status = 'SUSPENDED' THEN
    RAISE EXCEPTION 'Terminal suspendu' USING ERRCODE = 'CL030';
  END IF;
END $$;
REVOKE ALL ON FUNCTION assert_device_active(uuid) FROM PUBLIC;
