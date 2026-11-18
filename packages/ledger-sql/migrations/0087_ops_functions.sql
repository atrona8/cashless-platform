-- Fonctions d'exploitation du processus `maintenance` (mission 9b, lot WP05 ; FR-020, FR-021, FR-023, NFR-005,
-- NFR-006, C-005, C-010, C-011 ; research R-11 à R-13).
-- Le rôle `cashless_maint` n'a AUCUNE lecture de table : tout passe par ces fonctions étroites, SECURITY DEFINER,
-- `search_path = public, pg_temp`, sans `assert_tenant` (elles traversent les prestataires). Aucune ne rend un montant
-- de portefeuille, un numéro, un IBAN, un nom ni le texte d'une requête : seulement des identifiants, des compteurs,
-- des durées, des empreintes et des dates. Chaque colonne rendue est justifiée en commentaire.
-- AUCUN GRANT ici : WP06 pose les droits (post-roles.sql, section 12). REVOKE ALL … FROM PUBLIC sur chaque fonction.
--
-- Contexte de prestataire : seal_ledger et verify_ledger_seals appellent assert_tenant ; ces fonctions s'appellent donc
-- après set_config('app.operator_id', <prestataire de l'objet>, true), et la valeur précédente est rétablie avant de
-- rendre la main (un appel suivant, dans la même transaction, ne garde jamais le contexte d'un autre prestataire).
-- Si l'appel lève une erreur, la transaction (ou le sous-bloc) qui la reçoit annule aussi le set_config local.
-- Hypothèse existante (0022, OP-N87), reprise sans l'élargir : le propriétaire des fonctions SECURITY DEFINER ignore la
-- RLS forcée. Conséquence connue : la chaîne d'audit de la plateforme (operator_id NULL) n'est lisible que sous cette
-- hypothèse, comme pour audit_log_chain (0004).
-- Fonctions à faire relire : tout le fichier, surtout ops_seal_*, ops_record_seal_copy, ops_raise_alert,
-- ops_long_transactions.

-- 1. Scellement, copie et vérification (T020) ----------------------------------------------------------------------
-- Grands livres à sceller, tous statuts (LOCKED compris : réclamations tardives).
-- Colonnes : ledger_id et operator_id (identifiants), unsealed_postings (compteur).
CREATE FUNCTION ops_ledgers_to_seal()
RETURNS TABLE (ledger_id uuid, operator_id uuid, unsealed_postings bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT v.ledger_id, l.operator_id, v.unsealed_postings
    FROM ledgers_to_seal v JOIN ledger l ON l.id = v.ledger_id
   ORDER BY v.ledger_id
$$;

-- Scelle un grand livre : seal_ledger, délai 5 min (0 si LOCKED : scellement final). Aucune ligne s'il n'y a rien.
-- Colonnes : seal_no (compteur), seal_hash (empreinte).
CREATE FUNCTION ops_seal_ledger(p_ledger uuid)
RETURNS TABLE (seal_no int, seal_hash bytea)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE v_op uuid; v_status text; v_prev text; r ledger_seal%ROWTYPE;
BEGIN
  SELECT l.operator_id, l.status INTO v_op, v_status FROM ledger l WHERE l.id = p_ledger;
  IF NOT FOUND THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  v_prev := coalesce(current_setting('app.operator_id', true), '');
  PERFORM set_config('app.operator_id', v_op::text, true);
  r := seal_ledger(p_ledger, CASE WHEN v_status = 'LOCKED' THEN interval '0' ELSE interval '5 minutes' END);
  PERFORM set_config('app.operator_id', v_prev, true);
  IF r.seal_no IS NULL THEN RETURN; END IF;
  seal_no := r.seal_no; seal_hash := r.seal_hash;
  RETURN NEXT;
END $$;

-- Chaînes d'audit à sceller (plateforme comprise, operator_id nul).
-- Colonnes : chain_key et operator_id (identifiants), unsealed_rows (compteur).
CREATE FUNCTION ops_audit_chains_to_seal()
RETURNS TABLE (chain_key uuid, operator_id uuid, unsealed_rows bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT a.chain_key, min(a.operator_id::text)::uuid, count(*)
    FROM audit_log a
   WHERE a.seq > coalesce((SELECT max(s.last_seq) FROM audit_seal s WHERE s.chain_key = a.chain_key), 0)
   GROUP BY a.chain_key
   ORDER BY a.chain_key
$$;

-- Scelle une chaîne d'audit : seal_audit. Contexte de la chaîne posé pour les prestataires (la plateforme n'en a pas).
-- Colonnes : seal_no (compteur), seal_hash (empreinte).
CREATE FUNCTION ops_seal_audit(p_chain uuid)
RETURNS TABLE (seal_no int, seal_hash bytea)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE v_prev text; r audit_seal%ROWTYPE;
BEGIN
  v_prev := coalesce(current_setting('app.operator_id', true), '');
  IF p_chain <> audit_platform_chain() THEN PERFORM set_config('app.operator_id', p_chain::text, true); END IF;
  r := seal_audit(p_chain);
  PERFORM set_config('app.operator_id', v_prev, true);
  IF r.seal_no IS NULL THEN RETURN; END IF;
  seal_no := r.seal_no; seal_hash := r.seal_hash;
  RETURN NEXT;
END $$;

-- Pose la référence de la copie externe d'un scellement, une seule fois.
-- true = posée ; false = même référence déjà posée (rejeu) ; autre référence déjà posée : CL029 ; inconnu : P0002.
CREATE FUNCTION ops_record_seal_copy(p_kind text, p_id uuid, p_seal_no int, p_external_ref text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_ref text; v_found boolean;
BEGIN
  IF p_kind IS NULL OR p_kind NOT IN ('LEDGER', 'AUDIT') THEN
    RAISE EXCEPTION 'Type de scellement inconnu' USING ERRCODE = 'CL001';
  END IF;
  IF length(btrim(coalesce(p_external_ref, ''))) = 0 THEN
    RAISE EXCEPTION 'Référence de copie vide' USING ERRCODE = 'CL001';
  END IF;
  IF p_kind = 'LEDGER' THEN
    SELECT s.external_ref, true INTO v_ref, v_found FROM ledger_seal s
     WHERE s.ledger_id = p_id AND s.seal_no = p_seal_no FOR UPDATE;
  ELSE
    SELECT s.external_ref, true INTO v_ref, v_found FROM audit_seal s
     WHERE s.chain_key = p_id AND s.seal_no = p_seal_no FOR UPDATE;
  END IF;
  IF v_found IS NOT TRUE THEN RAISE EXCEPTION 'Scellement introuvable' USING ERRCODE = 'no_data_found'; END IF;
  IF v_ref IS NOT NULL THEN
    IF v_ref = p_external_ref THEN RETURN false; END IF;
    RAISE EXCEPTION 'Copie du scellement déjà référencée' USING ERRCODE = 'CL029';
  END IF;
  IF p_kind = 'LEDGER' THEN
    UPDATE ledger_seal SET external_ref = p_external_ref WHERE ledger_id = p_id AND seal_no = p_seal_no;
  ELSE
    UPDATE audit_seal SET external_ref = p_external_ref WHERE chain_key = p_id AND seal_no = p_seal_no;
  END IF;
  RETURN true;
END $$;

-- Scellements des deux chaînes créés depuis p_window (NULL = tous), triés.
-- Colonnes : kind, id (grand livre ou chaîne), seal_no, seal_hash, sealed_at, external_ref (clé d'objet, pas un secret).
CREATE FUNCTION ops_seals_since(p_window interval)
RETURNS TABLE (kind text, id uuid, seal_no int, seal_hash bytea, sealed_at timestamptz, external_ref text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT u.kind, u.id, u.seal_no, u.seal_hash, u.sealed_at, u.external_ref FROM (
    SELECT 'LEDGER'::text AS kind, s.ledger_id AS id, s.seal_no, s.seal_hash, s.sealed_at, s.external_ref
      FROM ledger_seal s
    UNION ALL
    SELECT 'AUDIT'::text, s.chain_key, s.seal_no, s.seal_hash, s.sealed_at, s.external_ref FROM audit_seal s
  ) u
  WHERE p_window IS NULL OR u.sealed_at >= clock_timestamp() - p_window
  ORDER BY u.sealed_at, u.kind, u.id, u.seal_no
$$;

-- Vérifie les scellements d'un grand livre : verify_ledger_seals plus la référence externe.
-- Colonnes : seal_no, ok, seal_hash (stocké), external_ref.
CREATE FUNCTION ops_verify_ledger_seals(p_ledger uuid, p_from_seal int DEFAULT 1)
RETURNS TABLE (seal_no int, ok boolean, seal_hash bytea, external_ref text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE v_op uuid; v_prev text;
BEGIN
  SELECT l.operator_id INTO v_op FROM ledger l WHERE l.id = p_ledger;
  IF NOT FOUND THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  v_prev := coalesce(current_setting('app.operator_id', true), '');
  PERFORM set_config('app.operator_id', v_op::text, true);
  RETURN QUERY
    SELECT v.seal_no, v.ok, v.stored_seal_hash, s.external_ref
      FROM verify_ledger_seals(p_ledger, p_from_seal) v
      LEFT JOIN ledger_seal s ON s.ledger_id = p_ledger AND s.seal_no = v.seal_no
     ORDER BY v.seal_no;
  PERFORM set_config('app.operator_id', v_prev, true);
END $$;

-- Vérifie une chaîne d'audit (ajout au plan R-11, renforce : FR-020 exige les DEUX chaînes) : verify_audit_chain.
-- Colonnes : seq (compteur), problem (texte fixe produit par verify_audit_chain, sans donnée d'audit).
CREATE FUNCTION ops_verify_audit_chain(p_chain uuid, p_since timestamptz DEFAULT '-infinity')
RETURNS TABLE (seq bigint, problem text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE v_prev text;
BEGIN
  v_prev := coalesce(current_setting('app.operator_id', true), '');
  IF p_chain <> audit_platform_chain() THEN PERFORM set_config('app.operator_id', p_chain::text, true); END IF;
  RETURN QUERY SELECT v.seq, v.problem FROM verify_audit_chain(p_chain, p_since) v;
  PERFORM set_config('app.operator_id', v_prev, true);
END $$;

-- 2. Contrôles, alertes, transactions longues (T021) ---------------------------------------------------------------
-- Ne rend que les écarts. Grands livres OPEN et CLOSING seulement.
-- FAST : SUM_ZERO, CLAIMS_EQUAL_MONEY. SLOW : BALANCE_CACHE, HOT_ACCOUNT_SIDE. Autre valeur : CL001.
-- Colonnes : ledger_id, operator_id, control (nom fixe), detail_count (nombre d'éléments en écart ; jamais un montant).
CREATE FUNCTION ops_ledger_controls(p_scope text)
RETURNS TABLE (ledger_id uuid, operator_id uuid, control text, detail_count bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
BEGIN
  IF p_scope IS NULL OR p_scope NOT IN ('FAST', 'SLOW') THEN
    RAISE EXCEPTION 'Portée de contrôle inconnue' USING ERRCODE = 'CL001';
  END IF;
  IF p_scope = 'FAST' THEN
    RETURN QUERY
      SELECT i.ledger_id, l.operator_id, 'SUM_ZERO'::text, 1::bigint
        FROM ledger_invariant i JOIN ledger l ON l.id = i.ledger_id
       WHERE l.status IN ('OPEN', 'CLOSING') AND coalesce(i.must_be_zero, 0) <> 0
      UNION ALL
      SELECT i.ledger_id, l.operator_id, 'CLAIMS_EQUAL_MONEY'::text, 1::bigint
        FROM ledger_invariant i JOIN ledger l ON l.id = i.ledger_id
       WHERE l.status IN ('OPEN', 'CLOSING') AND coalesce(i.money_held, 0) <> coalesce(i.total_claims, 0)
      ORDER BY 1, 3;
  ELSE
    RETURN QUERY
      SELECT a.ledger_id, l.operator_id, 'BALANCE_CACHE'::text, count(*)
        FROM balance_drift d JOIN account a ON a.id = d.account_id JOIN ledger l ON l.id = a.ledger_id
       WHERE l.status IN ('OPEN', 'CLOSING')
       GROUP BY a.ledger_id, l.operator_id
      UNION ALL
      SELECT h.ledger_id, l.operator_id, 'HOT_ACCOUNT_SIDE'::text, count(*)
        FROM hot_account_side_check h JOIN ledger l ON l.id = h.ledger_id
       WHERE l.status IN ('OPEN', 'CLOSING')
       GROUP BY h.ledger_id, l.operator_id
      ORDER BY 1, 3;
  END IF;
END $$;

-- Versements INITIATED depuis plus de p_age. Colonnes : identifiants et initiated_at (date).
CREATE FUNCTION ops_overdue_payouts(p_age interval)
RETURNS TABLE (payout_id uuid, ledger_id uuid, operator_id uuid, initiated_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT p.id, p.ledger_id, p.operator_id, p.initiated_at
    FROM payout p
   WHERE p.status = 'INITIATED' AND p.initiated_at < clock_timestamp() - p_age
   ORDER BY p.initiated_at, p.id
$$;

-- Lignes de relevé non rapprochées, plus vieilles que p_age, par compte. Colonnes : identifiants, unmatched
-- (compteur), oldest (date de valeur la plus ancienne).
-- Colonnes de rapprochement LUES : `matched_tx_id` (existante) ; `matched_anomaly_id` seulement si elle existe (ajoutée
-- par la migration 0083 de WP02) : le prédicat est choisi à l'appel, d'où le SQL dynamique à texte fixe (aucune valeur
-- de l'appelant n'y entre ; p_age passe par USING).
CREATE FUNCTION ops_unmatched_statements(p_age interval)
RETURNS TABLE (account_id uuid, ledger_id uuid, operator_id uuid, unmatched bigint, oldest timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_extra text := '';
BEGIN
  IF EXISTS (SELECT 1 FROM pg_attribute
              WHERE attrelid = 'public.external_statement_line'::regclass
                AND attname = 'matched_anomaly_id' AND NOT attisdropped) THEN
    v_extra := ' AND s.matched_anomaly_id IS NULL';
  END IF;
  RETURN QUERY EXECUTE
    'SELECT s.account_id, s.ledger_id, s.operator_id, count(*), min(s.value_date)::timestamptz
       FROM external_statement_line s
      WHERE s.matched_tx_id IS NULL' || v_extra || '
        AND s.value_date::timestamptz < clock_timestamp() - $1
      GROUP BY s.account_id, s.ledger_id, s.operator_id
      ORDER BY 5, 1'
    USING p_age;
END $$;

-- Anomalies OPEN créées après p_since (une anomalie déjà signalée ne revient pas). Colonnes : identifiants, kind
-- (liste fermée), created_at.
CREATE FUNCTION ops_new_open_anomalies(p_since timestamptz)
RETURNS TABLE (anomaly_id uuid, operator_id uuid, ledger_id uuid, kind text, created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT a.id, a.operator_id, a.ledger_id, a.kind, a.created_at
    FROM anomaly a
   WHERE a.status = 'OPEN' AND a.created_at > p_since
   ORDER BY a.created_at, a.id
$$;

-- Alerte d'exploitation : une ligne d'audit de la plateforme, puis pg_notify avec le code et l'identifiant seulement.
-- Codes 7 à 11. Détail : objet JSON de 4 ko au plus, sans clé query, iban, msisdn, phone, token, secret (à toute
-- profondeur, casse ignorée). Rend l'identifiant de la ligne d'audit.
CREATE FUNCTION ops_raise_alert(p_code int, p_detail jsonb)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id bigint; v_prev text;
BEGIN
  IF p_code IS NULL OR p_code NOT BETWEEN 7 AND 11 THEN
    RAISE EXCEPTION 'Code d''alarme hors bornes' USING ERRCODE = 'CL001';
  END IF;
  IF p_detail IS NULL OR jsonb_typeof(p_detail) <> 'object' OR octet_length(p_detail::text) > 4096 THEN
    RAISE EXCEPTION 'Détail d''alarme invalide' USING ERRCODE = 'CL001';
  END IF;
  IF EXISTS (
    WITH RECURSIVE w(j) AS (
      SELECT p_detail
      UNION ALL
      SELECT c.value
        FROM w, LATERAL (
          SELECT e.value FROM jsonb_each(CASE WHEN jsonb_typeof(w.j) = 'object' THEN w.j ELSE '{}'::jsonb END) e
          UNION ALL
          SELECT e.value FROM jsonb_array_elements(CASE WHEN jsonb_typeof(w.j) = 'array' THEN w.j ELSE '[]'::jsonb END) e
        ) c)
    SELECT 1 FROM w, jsonb_object_keys(CASE WHEN jsonb_typeof(w.j) = 'object' THEN w.j ELSE '{}'::jsonb END) k
     WHERE lower(k) IN ('query', 'iban', 'msisdn', 'phone', 'token', 'secret')) THEN
    RAISE EXCEPTION 'Détail d''alarme : clé interdite' USING ERRCODE = 'CL001';
  END IF;
  -- Ligne de la plateforme : operator_id nul, donc pas de contexte de prestataire (aucun reste de contexte d'un autre).
  v_prev := coalesce(current_setting('app.operator_id', true), '');
  PERFORM set_config('app.operator_id', '', true);
  INSERT INTO audit_log (operator_id, action, object_type, object_id, after, origin)
  VALUES (NULL, 'OPS_ALERT', 'ops_alarm', p_code::text, p_detail, 'maintenance')
  RETURNING id INTO v_id;
  PERFORM set_config('app.operator_id', v_prev, true);
  PERFORM pg_notify('ops_alert', jsonb_build_object('code', p_code, 'audit_id', v_id)::text);
  RETURN v_id;
END $$;

-- Transactions ouvertes depuis plus de p_max, base courante, hors la session appelante.
-- Colonnes : pid, usename (nom de rôle technique), application_name, xact_seconds (durée). Jamais query ni client_addr.
-- C-011 : sans appartenance du propriétaire à pg_read_all_stats, les sessions des autres rôles masquent leur durée ;
-- la fonction rend alors une ligne de configuration (pid nul, usename '?config') que le travailleur transforme en
-- alerte, au lieu d'une liste vide silencieuse.
CREATE FUNCTION ops_long_transactions(p_max interval)
RETURNS TABLE (pid int, usename text, application_name text, xact_seconds numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
BEGIN
  IF NOT pg_has_role(current_user, 'pg_read_all_stats', 'member') THEN
    pid := NULL; usename := '?config'; application_name := 'pg_read_all_stats'; xact_seconds := 0;
    RETURN NEXT;
    RETURN;
  END IF;
  RETURN QUERY
    SELECT a.pid, a.usename::text, a.application_name::text,
           round(extract(epoch FROM clock_timestamp() - a.xact_start)::numeric, 3)
      FROM pg_stat_activity a
     WHERE a.datname = current_database() AND a.pid <> pg_backend_pid()
       AND a.xact_start IS NOT NULL AND clock_timestamp() - a.xact_start > p_max
     ORDER BY a.xact_start, a.pid;
END $$;

REVOKE ALL ON FUNCTION
  ops_ledgers_to_seal(), ops_seal_ledger(uuid), ops_audit_chains_to_seal(), ops_seal_audit(uuid),
  ops_record_seal_copy(text, uuid, int, text), ops_seals_since(interval),
  ops_verify_ledger_seals(uuid, int), ops_verify_audit_chain(uuid, timestamptz),
  ops_ledger_controls(text), ops_overdue_payouts(interval), ops_unmatched_statements(interval),
  ops_new_open_anomalies(timestamptz), ops_raise_alert(int, jsonb), ops_long_transactions(interval)
FROM PUBLIC;
