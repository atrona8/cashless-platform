-- Migration 0048 : terminal, vendeur et configuration datés (mission hors-ligne-snapshots-lots, lot WP07 ;
-- FR-003, FR-005, FR-011, FR-012, FR-039 ; research R-30.2, R-30.3, R-30.4 ; contracts/interfaces.md § 1 et § 6).
--
-- Contenu :
--   1. `offline_snapshot.published_at` (heure d'inscription de la version, posée par la base) : colonne lue
--      par `offline_snapshot_meta`. Absente de 0044 : ajoutée ici (défaut `clock_timestamp()`, aucune
--      fonction existante n'a à changer).
--   2. Table `offline_snapshot_ack (device_id, version)` : accusés historisés, ajout seul, `operator_id`,
--      RLS `tenant_isolation` ENABLE + FORCE.
--   3. Accusés : `ack_offline_snapshot` (CL049 ; `device.last_snapshot_version` ne recule jamais),
--      `offline_snapshot_ack_floor`, `offline_snapshot_meta`.
--   4. États datés : `offline_media_state_at`, `offline_config_in_force`, `device_status_at`,
--      `device_revoked_at`.
--   5. Vendeur et attribution datés : `assert_vendor_session_at`, `record_sale_attribution_at` (fonctions
--      NOUVELLES : `assert_vendor_session` de 0031 et `record_sale_attribution` de 0033 ne sont pas touchées).
--   6. `set_device_station_name` : seule écriture de `device.station_name` une fois les droits retirés (WP08).
--   7. `offline_device_exposure` : exposition « non acquittée » d'un terminal (R-30.3).
--
-- Numérotation : `interfaces.md` § 1 fait foi (0048) ; `data-model.md` écrit « 0047 » : contradiction signalée,
-- 0048 appliquée.
--
-- Dépendance de lecture : `offline_snapshot_key` est posée par 0045 (WP04). Les fonctions qui la lisent
-- (`ack_offline_snapshot`, `offline_snapshot_meta`) sont en plpgsql (liaison tardive) : la migration
-- s'applique même si 0045 n'est pas encore là, mais ces deux fonctions échouent à l'appel sans la table.
-- L'ordre final des migrations (0045 avant 0048) est celui de la fusion.
--
-- Codes : CL049 (version non servie à ce terminal, empreinte différente, enveloppe absente), CL032 (session
-- de vendeur invalide à l'heure citée), CL001 (argument incohérent : nom de station, tolérance négative,
-- argument nul), no_data_found / P0002 « Objet introuvable » (terminal, vente ou acteur d'un autre
-- prestataire, ou inconnu), 42501 (terminal révoqué : accusé et nom de station refusés, comme le battement).
--
-- Hypothèse sur le propriétaire (comme 0022 et 0036) : les tables sont en FORCE ROW LEVEL SECURITY, donc une
-- fonction SECURITY DEFINER ne s'appuie JAMAIS sur la RLS : chaque requête nomme `operator_id` (valeur de
-- `app.operator_id`) ou passe par `assert_tenant(tenant_of_device(…))`.
--
-- Heure : celle de la base (`clock_timestamp()`), jamais celle de l'appelant, sauf les paramètres `p_at` /
-- `p_reference` / `p_before`.
--
-- Ordre des verrous : terminal (`FOR UPDATE`), puis vendeur, puis session (`FOR SHARE`), jamais l'inverse.
-- Les fonctions STABLE ne prennent aucun verrou.
--
-- Blocage du vendeur à l'heure `p_at` (assert_vendor_session_at) : `vendor.locked_at` est daté, la
-- désactivation (`vendor.status`) ne l'est pas, mais 0031 ferme la session au moment du blocage et de la
-- désactivation (`closed_at`, raison VENDOR_LOCKED / VENDOR_DISABLED). Le fait daté est donc `closed_at`. Une
-- session encore ouverte avec un vendeur désactivé ou bloqué (état incohérent) est refusée quelle que soit
-- `p_at` (fermé par défaut). Un vendeur désactivé APRÈS `p_at` n'invalide pas une opération faite avant.
--
-- Droits : `REVOKE ALL … FROM PUBLIC` sur chaque fonction, aucun GRANT ni REVOKE de table (WP08).

-- 1. Heure d'inscription d'une version ---------------------------------------------------------------
ALTER TABLE offline_snapshot
  ADD COLUMN IF NOT EXISTS published_at timestamptz NOT NULL DEFAULT clock_timestamp();

-- 2. Accusés de snapshot historisés (R-30.4) ------------------------------------------------------------
CREATE TABLE offline_snapshot_ack (
  device_id   uuid NOT NULL REFERENCES device(id),
  version     bigint NOT NULL CHECK (version >= 1),
  operator_id uuid NOT NULL REFERENCES party(id),
  ledger_id   uuid NOT NULL REFERENCES ledger(id),
  acked_at    timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (device_id, version)
);
CREATE INDEX offline_snapshot_ack_device_at_idx ON offline_snapshot_ack (device_id, acked_at);
ALTER TABLE offline_snapshot_ack ENABLE ROW LEVEL SECURITY;
ALTER TABLE offline_snapshot_ack FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON offline_snapshot_ack
  USING (operator_id = current_setting('app.operator_id', true)::uuid)
  WITH CHECK (operator_id = current_setting('app.operator_id', true)::uuid);
CREATE TRIGGER offline_snapshot_ack_immutable BEFORE UPDATE OR DELETE ON offline_snapshot_ack
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- 3. Accusés ---------------------------------------------------------------------------------------------
-- Verrouille le terminal du prestataire (étranger ou inconnu : no_data_found). La version doit être
-- publiée dans un grand livre du terminal (événement du terminal ou son organisateur), porter l'empreinte
-- annoncée et avoir une enveloppe pour CE terminal : sinon CL049, aucune écriture. Le premier accusé d'une
-- version fixe `acked_at` ; un accusé plus ancien est inscrit mais le maximum ne baisse jamais.
CREATE FUNCTION ack_offline_snapshot(p_device uuid, p_version bigint, p_content_sha256 bytea)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_operator uuid := nullif(current_setting('app.operator_id', true), '')::uuid;
  d device%ROWTYPE;
  v_ledger uuid;
BEGIN
  IF v_operator IS NULL OR p_device IS NULL THEN
    RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found';
  END IF;
  SELECT * INTO d FROM device WHERE id = p_device AND operator_id = v_operator FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  IF d.status = 'REVOKED' THEN
    RAISE EXCEPTION 'Terminal révoqué' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_version IS NULL OR p_version < 1 OR p_content_sha256 IS NULL OR d.event_id IS NULL THEN
    RAISE EXCEPTION 'Version de snapshot non servie à ce terminal' USING ERRCODE = 'CL049';
  END IF;
  SELECT s.ledger_id INTO v_ledger
    FROM offline_snapshot s
   WHERE s.operator_id = v_operator AND s.version = p_version
     AND s.content_sha256 = p_content_sha256
     AND s.ledger_id IN (
           SELECT l.id FROM ledger l
            WHERE l.operator_id = v_operator
              AND ((l.scope_type = 'EVENT' AND l.scope_id = d.event_id)
                   OR (l.scope_type = 'ORGANIZER'
                       AND l.scope_id = (SELECT e.organizer_id FROM event e
                                          WHERE e.id = d.event_id AND e.operator_id = v_operator))))
     AND EXISTS (SELECT 1 FROM offline_snapshot_key k
                  WHERE k.ledger_id = s.ledger_id AND k.version = s.version
                    AND k.device_id = d.id AND k.operator_id = v_operator)
   ORDER BY s.ledger_id
   LIMIT 1;
  IF v_ledger IS NULL THEN
    RAISE EXCEPTION 'Version de snapshot non servie à ce terminal' USING ERRCODE = 'CL049';
  END IF;
  INSERT INTO offline_snapshot_ack (device_id, version, operator_id, ledger_id)
  VALUES (d.id, p_version, v_operator, v_ledger)
  ON CONFLICT (device_id, version) DO NOTHING;
  UPDATE device SET last_snapshot_version = greatest(coalesce(last_snapshot_version, 0), p_version)
   WHERE id = d.id AND operator_id = v_operator;
END $$;
REVOKE ALL ON FUNCTION ack_offline_snapshot(uuid, bigint, bytea) FROM PUBLIC;

-- Plus grande version accusée à `p_before` inclus (acked_at <= p_before), 0 si aucune.
CREATE FUNCTION offline_snapshot_ack_floor(p_device uuid, p_before timestamptz) RETURNS bigint
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_operator uuid := nullif(current_setting('app.operator_id', true), '')::uuid;
BEGIN
  PERFORM assert_tenant(tenant_of_device(p_device));
  RETURN coalesce((SELECT max(a.version) FROM offline_snapshot_ack a
                    WHERE a.device_id = p_device AND a.operator_id = v_operator
                      AND a.acked_at <= p_before), 0);
END $$;
REVOKE ALL ON FUNCTION offline_snapshot_ack_floor(uuid, timestamptz) FROM PUBLIC;

-- Dates d'une version et enveloppe pour p_device ; aucune ligne si inconnue ou d'un autre prestataire.
CREATE FUNCTION offline_snapshot_meta(p_ledger uuid, p_version bigint, p_device uuid)
RETURNS TABLE (generated_at timestamptz, valid_until timestamptz, published_at timestamptz,
               wrapped_for_device boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_operator uuid := nullif(current_setting('app.operator_id', true), '')::uuid;
BEGIN
  IF v_operator IS NULL THEN RETURN; END IF;
  RETURN QUERY
    SELECT s.generated_at, s.valid_until, s.published_at,
           coalesce(p_device IS NOT NULL AND EXISTS (
             SELECT 1 FROM offline_snapshot_key k
              WHERE k.ledger_id = s.ledger_id AND k.version = s.version
                AND k.device_id = p_device AND k.operator_id = v_operator), false)
      FROM offline_snapshot s
     WHERE s.ledger_id = p_ledger AND s.version = p_version AND s.operator_id = v_operator;
END $$;
REVOKE ALL ON FUNCTION offline_snapshot_meta(uuid, bigint, uuid) FROM PUBLIC;

-- 4. États datés -----------------------------------------------------------------------------------------
-- État d'un bracelet à la version citée : dernière ligne du journal de version <= p_version. Aucune ligne
-- si le bracelet n'a aucune ligne <= p_version ou si le grand livre n'est pas du prestataire.
CREATE FUNCTION offline_media_state_at(p_ledger uuid, p_token_hash bytea, p_version bigint)
RETURNS TABLE (in_snapshot boolean, media_status text, batch_status text, batch_event_id uuid,
               wallet_status text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_operator uuid := nullif(current_setting('app.operator_id', true), '')::uuid;
BEGIN
  IF v_operator IS NULL THEN RETURN; END IF;
  RETURN QUERY
    SELECT m.in_snapshot, m.media_status, m.batch_status, m.batch_event_id, m.wallet_status
      FROM offline_snapshot_media_log m
     WHERE m.ledger_id = p_ledger AND m.token_hash = p_token_hash AND m.version <= p_version
       AND m.operator_id = v_operator
     ORDER BY m.version DESC
     LIMIT 1;
END $$;
REVOKE ALL ON FUNCTION offline_media_state_at(uuid, bytea, bigint) FROM PUBLIC;

-- Politique de la configuration p_config_id si c'est la DERNIÈRE servie au terminal avec
-- served_at <= p_at + p_tol ; sinon NULL (plus ancienne, postérieure, d'un autre terminal, inconnue : même
-- résultat). Ne remplace pas `policy_in_force`.
CREATE FUNCTION offline_config_in_force(p_device uuid, p_config_id bigint, p_at timestamptz,
                                        p_tol interval)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_operator uuid := nullif(current_setting('app.operator_id', true), '')::uuid;
  v_id bigint;
  v_policy jsonb;
BEGIN
  PERFORM assert_tenant(tenant_of_device(p_device));
  IF p_at IS NULL OR p_tol IS NULL OR p_tol < interval '0' THEN
    RAISE EXCEPTION 'Configuration datée : heure ou tolérance invalide' USING ERRCODE = 'CL001';
  END IF;
  SELECT c.id, c.policy INTO v_id, v_policy FROM device_config_served c
   WHERE c.device_id = p_device AND c.operator_id = v_operator AND c.served_at <= p_at + p_tol
   ORDER BY c.id DESC LIMIT 1;
  IF v_id IS NULL OR p_config_id IS DISTINCT FROM v_id THEN RETURN NULL; END IF;
  RETURN v_policy;
END $$;
REVOKE ALL ON FUNCTION offline_config_in_force(uuid, bigint, timestamptz, interval) FROM PUBLIC;

-- Statut du terminal à p_at : dernier `to_status` avec at <= p_at ; NULL avant la première ligne.
CREATE FUNCTION device_status_at(p_device uuid, p_at timestamptz) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_operator uuid := nullif(current_setting('app.operator_id', true), '')::uuid;
BEGIN
  PERFORM assert_tenant(tenant_of_device(p_device));
  RETURN (SELECT h.to_status FROM device_status_history h
           WHERE h.device_id = p_device AND h.operator_id = v_operator AND h.at <= p_at
           ORDER BY h.id DESC LIMIT 1);
END $$;
REVOKE ALL ON FUNCTION device_status_at(uuid, timestamptz) FROM PUBLIC;

-- Heure de la révocation (définitive, contrainte 0022) ; NULL si le terminal n'est pas révoqué.
CREATE FUNCTION device_revoked_at(p_device uuid) RETURNS timestamptz
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_operator uuid := nullif(current_setting('app.operator_id', true), '')::uuid;
BEGIN
  PERFORM assert_tenant(tenant_of_device(p_device));
  RETURN (SELECT h.at FROM device_status_history h
           WHERE h.device_id = p_device AND h.operator_id = v_operator AND h.to_status = 'REVOKED'
           ORDER BY h.id DESC LIMIT 1);
END $$;
REVOKE ALL ON FUNCTION device_revoked_at(uuid) FROM PUBLIC;

-- 5. Vendeur et attribution à l'heure de l'opération ---------------------------------------------------------
-- Copie contrôlée de assert_vendor_session (0031:411) avec p_at au lieu de now() : session du prestataire
-- et du terminal, ouverte à p_at, non fermée à p_at, non expirée à p_at ; vendeur non bloqué à p_at (voir
-- l'en-tête pour le blocage et la désactivation). Ne prend PAS le terminal (l'appelant l'a pris). Vendeur
-- puis session FOR SHARE. Sinon CL032. Rend le vendeur de la session.
CREATE FUNCTION assert_vendor_session_at(p_device uuid, p_session uuid, p_at timestamptz)
RETURNS uuid
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
  IF p_at IS NULL THEN
    RAISE EXCEPTION 'Heure de l''opération requise' USING ERRCODE = 'CL001';
  END IF;
  SELECT vendor_id INTO v_vendor FROM vendor_session
   WHERE id = p_session AND operator_id = v_operator AND device_id = p_device;
  IF v_vendor IS NULL THEN
    RAISE EXCEPTION 'Session de vendeur invalide' USING ERRCODE = 'CL032';
  END IF;
  SELECT status, locked_at INTO v_status, v_locked FROM vendor
   WHERE id = v_vendor AND operator_id = v_operator FOR SHARE;
  SELECT * INTO s FROM vendor_session WHERE id = p_session AND operator_id = v_operator FOR SHARE;
  IF s.id IS NULL OR s.device_id <> p_device OR s.vendor_id <> v_vendor
     OR s.opened_at > p_at OR s.expires_at <= p_at
     OR (s.closed_at IS NOT NULL AND s.closed_at <= p_at)
     OR (v_locked IS NOT NULL AND v_locked <= p_at)
     OR (s.closed_at IS NULL AND (v_status IS DISTINCT FROM 'ACTIVE' OR v_locked IS NOT NULL)) THEN
    RAISE EXCEPTION 'Session de vendeur invalide' USING ERRCODE = 'CL032';
  END IF;
  RETURN v_vendor;
END $$;
REVOKE ALL ON FUNCTION assert_vendor_session_at(uuid, uuid, timestamptz) FROM PUBLIC;

-- Variante datée de record_sale_attribution (0033:154), mêmes arguments plus p_at, mêmes erreurs (CL032,
-- CL001, 23505, P0002) : la session est jugée à p_at (ouverte, non fermée, non expirée) et le terminal
-- est celui de l'écriture. N'appelle pas la fonction d'origine.
CREATE FUNCTION record_sale_attribution_at(p_tx uuid, p_vendor_session uuid, p_channel text,
                                           p_actor_user uuid, p_at timestamptz) RETURNS void
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
    IF p_at IS NULL THEN
      RAISE EXCEPTION 'Heure de l''opération requise' USING ERRCODE = 'CL001';
    END IF;
    SELECT * INTO s FROM vendor_session vs
     WHERE vs.id = p_vendor_session AND vs.operator_id = v_operator;
    IF NOT FOUND OR s.opened_at > p_at OR s.expires_at <= p_at
       OR (s.closed_at IS NOT NULL AND s.closed_at <= p_at)
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
REVOKE ALL ON FUNCTION record_sale_attribution_at(uuid, uuid, text, uuid, timestamptz) FROM PUBLIC;

-- 6. Nom de station (FR-039) ------------------------------------------------------------------------------
-- Seule écriture de `device.station_name`. Terminal du prestataire (FOR UPDATE), acteur contrôlé comme dans
-- set_device_status (0022) ; terminal REVOKED refusé (42501, comme le battement de cœur). Nom de 1 à 200
-- caractères après btrim, ou NULL pour effacer ; sinon CL001. Seule colonne écrite : station_name.
CREATE FUNCTION set_device_station_name(p_device uuid, p_name text, p_actor uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_operator uuid := nullif(current_setting('app.operator_id', true), '')::uuid;
  d device%ROWTYPE;
  v_name text := btrim(p_name);
BEGIN
  IF v_operator IS NULL OR p_device IS NULL THEN
    RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found';
  END IF;
  IF p_name IS NOT NULL AND length(v_name) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'Nom de station invalide (1 à 200 caractères)' USING ERRCODE = 'CL001';
  END IF;
  SELECT * INTO d FROM device WHERE id = p_device AND operator_id = v_operator FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  IF p_actor IS NULL OR NOT device_admin_allowed(v_operator, d.event_id, p_actor) THEN
    RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found';
  END IF;
  IF d.status = 'REVOKED' THEN
    RAISE EXCEPTION 'Terminal révoqué' USING ERRCODE = 'insufficient_privilege';
  END IF;
  UPDATE device SET station_name = v_name WHERE id = d.id AND operator_id = v_operator;
END $$;
REVOKE ALL ON FUNCTION set_device_station_name(uuid, text, uuid) FROM PUBLIC;

-- 7. Exposition « non acquittée » (R-30.3 ; porteur, 30/10/2026 : stricte) ------------------------------------
-- Ventes du terminal de numéro < p_seq au registre (transaction non nulle, ACCEPTED ou
-- ACCEPTED_WITH_SHORTFALL, écriture PURCHASE de ce terminal). Montant = somme des lignes `posting` de
-- l'écriture sur les comptes WALLET_PAID et WALLET_PROMO (débit du portefeuille, positif ; pour un
-- ACCEPTED_WITH_SHORTFALL, le montant réellement débité). Acquittée = résultat rendu AVANT
-- p_reference - p_tol : `offline_batch.completed_at` (canal BATCH), `device_seq_registry.recorded_at` (canal
-- ONLINE). À p_reference - p_tol pile ou plus tard : COMPTE (strict). Résultat inconnu (lot non terminé,
-- canal EDGE) : COMPTE. WAIVED, VOID, REJECTED, DUPLICATE : jamais comptés (aucun débit nouveau).
-- p_reference et p_tol sont calculés par l'API (WP19) ; un argument nul ou une tolérance négative est
-- refusé (CL001) : un NULL ferait disparaître des ventes du total (exposition sous-estimée).
CREATE FUNCTION offline_device_exposure(p_device uuid, p_media uuid, p_seq bigint,
                                        p_reference timestamptz, p_tol interval)
RETURNS TABLE (per_media bigint, per_device bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_operator uuid := nullif(current_setting('app.operator_id', true), '')::uuid;
BEGIN
  PERFORM assert_tenant(tenant_of_device(p_device));
  IF p_seq IS NULL OR p_reference IS NULL OR p_tol IS NULL OR p_tol < interval '0' THEN
    RAISE EXCEPTION 'Exposition : numéro, heure de référence ou tolérance invalide'
      USING ERRCODE = 'CL001';
  END IF;
  RETURN QUERY
    WITH sales AS (
      SELECT jt.media_id AS media_id,
             (SELECT coalesce(sum(p.amount), 0)
                FROM posting p JOIN account a ON a.id = p.account_id
               WHERE p.transaction_id = jt.id AND p.operator_id = v_operator
                 AND a.purpose IN ('WALLET_PAID','WALLET_PROMO')) AS amount,
             CASE r.channel WHEN 'BATCH' THEN b.completed_at
                            WHEN 'ONLINE' THEN r.recorded_at END AS acked_at
        FROM device_seq_registry r
        JOIN journal_transaction jt
          ON jt.id = r.transaction_id AND jt.operator_id = r.operator_id
         AND jt.device_id = r.device_id AND jt.type = 'PURCHASE'
        LEFT JOIN offline_batch b ON b.id = r.batch_id AND b.operator_id = r.operator_id
       WHERE r.operator_id = v_operator AND r.device_id = p_device AND r.seq < p_seq
         AND r.transaction_id IS NOT NULL
         AND r.outcome IN ('ACCEPTED','ACCEPTED_WITH_SHORTFALL')
    ), unacked AS (
      SELECT s.media_id, s.amount FROM sales s
       WHERE s.amount > 0 AND (s.acked_at IS NULL OR s.acked_at >= p_reference - p_tol)
    )
    SELECT coalesce(sum(u.amount) FILTER (WHERE u.media_id = p_media), 0)::bigint,
           coalesce(sum(u.amount), 0)::bigint
      FROM unacked u;
END $$;
REVOKE ALL ON FUNCTION offline_device_exposure(uuid, uuid, bigint, timestamptz, interval) FROM PUBLIC;
