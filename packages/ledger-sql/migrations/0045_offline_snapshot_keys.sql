-- Migration 0045 : enveloppes de la clé de contenu, lecture d'un snapshot par un terminal, clés de
-- signature (mission hors-ligne-snapshots-lots, lot WP04 ; FR-006, FR-008, FR-009, FR-010, FR-011,
-- FR-037 ; research R-04, R-08, R-30.5, R-30.8, R-30.9 ; contracts/interfaces.md §§ 1 et 3 ;
-- contracts/snapshots.md).
--
-- Contenu :
--   1. `offline_snapshot_key` : une enveloppe de la clé de contenu K_v par (grand livre, version,
--      terminal, empreinte de la clé d'accord). Le prestataire, la RLS (ENABLE + FORCE) et un
--      déclencheur `forbid_mutation` (une enveloppe ne se réécrit pas : une nouvelle clé d'accord
--      donne une nouvelle ligne).
--   2. Borne de deux clés de signature valides (ACTIVE|RETIRED) par signataire : déclencheur sur
--      `snapshot_signing_key` (CL054), sous un verrou consultatif par signataire.
--   3. File de travail du processus `snapshot-content` : `offline_snapshot_keys_to_wrap`,
--      `wrap_offline_snapshot_key`. La base ne voit jamais une clé en clair : elle reçoit une
--      enveloppe déjà construite (WP12) et ne lit que `content_key_wrapped` (K_v enveloppée par le KMS).
--   4. Lecture par le terminal : `offline_snapshot_for_device` (la SEULE lecture d'un snapshot et de
--      son enveloppe par un terminal), `snapshot_public_keys`.
--   5. Rotation : `rotate_snapshot_signing_key` (la seule écriture prévue sur `snapshot_signing_key`).
--
-- Enveloppes des seules versions PUBLIÉES : la clé K_v est lue dans `offline_snapshot.content_key_wrapped`,
-- jamais dans un brouillon (un brouillon abandonné libère sa version, qui sera réservée à une autre K_v).
-- Coût : un tour de boucle (1 s) entre publication et enveloppe, tenu par le budget de 5 s (R-30.5).
-- Seuls les terminaux ACTIVE reçoivent une enveloppe (R-30.9) : jamais SUSPENDED, REVOKED, téléphone
-- personnel, sans clé d'accord, ni hors ligne interdit par la politique effective. Seules les versions
-- du dernier FULL publié et suivantes sont enveloppées.
--
-- Hypothèse sur le propriétaire (migration 0023, en-tête l.19-25) : `offline_snapshot_keys_to_wrap` n'a
-- pas de prestataire de session (comme `offline_snapshot_targets`, 0044) ; elle suppose un propriétaire
-- qui ignore la RLS. Avec un propriétaire soumis à la RLS elle échoue fermé : liste vide. Les autres
-- fonctions prennent un `p_ledger` ou un `p_device`, font `assert_tenant` (le processus pose
-- `app.operator_id` du prestataire cible avant l'appel), sauf `rotate_snapshot_signing_key` (clé de la
-- plateforme, sans prestataire de session : même hypothèse du propriétaire, échec fermé sinon).
--
-- Grand livre d'un terminal : le grand livre EVENT de l'événement du terminal dans la devise de
-- l'événement (un événement peut avoir un grand livre par devise ; seul celui de sa devise est servi).
--
-- Codes : CL001 (argument incohérent, terminal non éligible à une enveloppe, clé d'accord périmée,
-- clé de signature mal formée ou déjà prise), CL050 (aucun snapshot prêt : aucune version, ou enveloppe
-- pas encore faite pour ce terminal), CL051 (terminal non éligible ; le motif est dans le MESSAGE entre
-- parenthèses ET dans DETAIL : OFFLINE_DISABLED | NO_EVENT | PERSONAL_PHONE | SNAPSHOTS_UNAVAILABLE |
-- DEVICE_SUSPENDED), 42501 (terminal révoqué, comme 0023), P0002 (terminal ou grand livre inconnu ou
-- d'un autre prestataire), CL054 (troisième clé de signature valide d'un signataire).
--
-- Forme rendue par `offline_snapshot_for_device` : `entries` est l'objet
--   {"entries": [<entrée aux onze clés, plus "pwd_pack_enc" en base64 si elle en a>, ...],
--    "removed_token_hashes": ["<hex>", ...]}
-- entrées et retirés triés par token_hash hexadécimal (ordre octet) ; `envelope` est l'enveloppe stockée
-- complétée de `agreement_key_sha256` (hex) pour l'ETag de WP15.
--
-- Droits : `REVOKE ALL … FROM PUBLIC` sur chaque fonction, aucun GRANT (WP08, post-roles.sql).
-- Fonction interne à ne JAMAIS accorder : `offline_snapshot_envelope_ok` (pure, sert au CHECK).

-- 1. Enveloppes --------------------------------------------------------------------------------------
-- Forme exacte : quatre clés, textes non vides, algorithme fixe. Pure et immuable, sert au CHECK.
CREATE FUNCTION offline_snapshot_envelope_ok(e jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT jsonb_typeof(e) = 'object'
     AND (SELECT count(*) FROM jsonb_object_keys(e)) = 4
     AND jsonb_typeof(e->'alg') = 'string' AND e->>'alg' = 'ECDH-ES+HKDF-SHA256+A256GCM'
     AND jsonb_typeof(e->'epk') = 'string' AND length(e->>'epk') > 0
     AND jsonb_typeof(e->'iv') = 'string' AND length(e->>'iv') > 0
     AND jsonb_typeof(e->'wrapped_key') = 'string' AND length(e->>'wrapped_key') > 0
$$;
REVOKE ALL ON FUNCTION offline_snapshot_envelope_ok(jsonb) FROM PUBLIC;

CREATE TABLE offline_snapshot_key (
  ledger_id            uuid NOT NULL,
  version              bigint NOT NULL,
  device_id            uuid NOT NULL REFERENCES device(id),
  agreement_key_sha256 bytea NOT NULL CHECK (octet_length(agreement_key_sha256) = 32),
  operator_id          uuid NOT NULL REFERENCES party(id),
  envelope             jsonb NOT NULL CHECK (offline_snapshot_envelope_ok(envelope)),
  created_at           timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (ledger_id, version, device_id, agreement_key_sha256),
  FOREIGN KEY (ledger_id, version) REFERENCES offline_snapshot (ledger_id, version)
);
CREATE INDEX offline_snapshot_key_device_idx ON offline_snapshot_key (device_id);
ALTER TABLE offline_snapshot_key ENABLE ROW LEVEL SECURITY;
ALTER TABLE offline_snapshot_key FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON offline_snapshot_key
  USING (operator_id = current_setting('app.operator_id', true)::uuid)
  WITH CHECK (operator_id = current_setting('app.operator_id', true)::uuid);
CREATE TRIGGER offline_snapshot_key_immutable BEFORE UPDATE OR DELETE ON offline_snapshot_key
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- 2. Borne de deux clés de signature valides par signataire -------------------------------------------
-- Signataire = (owner, operator_id, edge_gateway_id), comparaison nulle-sûre. Une ligne ACTIVE ou RETIRED
-- (après l'instruction) avec deux autres lignes ACTIVE|RETIRED du même signataire : CL054. Verrou
-- consultatif avant le comptage (deux insertions concurrentes). INVOKER : la fonction ne lit que des
-- lignes du signataire, que la session qui l'écrit voit (tenant_read/tenant_write).
CREATE FUNCTION snapshot_signing_key_cap() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE n int;
BEGIN
  IF NEW.status NOT IN ('ACTIVE','RETIRED') THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('snapshot-signer:' || NEW.owner || ':'
            || coalesce(NEW.operator_id::text, '') || ':' || coalesce(NEW.edge_gateway_id::text, ''), 0));
  SELECT count(*) INTO n FROM snapshot_signing_key k
   WHERE k.key_id <> NEW.key_id AND k.status IN ('ACTIVE','RETIRED') AND k.owner = NEW.owner
     AND k.operator_id IS NOT DISTINCT FROM NEW.operator_id
     AND k.edge_gateway_id IS NOT DISTINCT FROM NEW.edge_gateway_id;
  IF n >= 2 THEN
    RAISE EXCEPTION 'Clés de signature : au plus deux clés valides (ACTIVE|RETIRED) par signataire'
      USING ERRCODE = 'CL054';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION snapshot_signing_key_cap() FROM PUBLIC;
-- Les colonnes qui définissent le signataire sont surveillées aussi (changer d'owner ou de prestataire
-- contournerait la borne).
CREATE TRIGGER snapshot_signing_key_cap BEFORE INSERT OR
  UPDATE OF status, owner, operator_id, edge_gateway_id ON snapshot_signing_key
  FOR EACH ROW EXECUTE FUNCTION snapshot_signing_key_cap();

-- 3. File de travail des enveloppes ---------------------------------------------------------------------
CREATE FUNCTION offline_snapshot_keys_to_wrap(p_limit int)
RETURNS TABLE (ledger_id uuid, version bigint, device_id uuid, agreement_public_key bytea,
               agreement_key_sha256 bytea, content_key_wrapped bytea)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 1000 THEN
    RAISE EXCEPTION 'Enveloppes : limite de 1 à 1000' USING ERRCODE = 'CL001';
  END IF;
  RETURN QUERY
  SELECT o.ledger_id, o.version, d.id, d.agreement_public_key, sha256(d.agreement_public_key),
         o.content_key_wrapped
    FROM ledger l
    JOIN event e ON e.id = l.scope_id AND e.operator_id = l.operator_id AND e.currency = l.currency
    JOIN LATERAL (SELECT max(f.version) AS v FROM offline_snapshot f
                   WHERE f.ledger_id = l.id AND f.kind = 'FULL') lf ON lf.v IS NOT NULL
    JOIN offline_snapshot o ON o.ledger_id = l.id AND o.version >= lf.v
    JOIN device d ON d.event_id = e.id AND d.operator_id = l.operator_id
   WHERE l.scope_type = 'EVENT' AND l.status <> 'LOCKED'
     AND d.status = 'ACTIVE' AND NOT d.personal_phone AND d.agreement_public_key IS NOT NULL
     AND (SELECT p.offline_enabled FROM effective_offline_policy(d.id) p) IS TRUE
     AND NOT EXISTS (SELECT 1 FROM offline_snapshot_key k
                      WHERE k.ledger_id = o.ledger_id AND k.version = o.version
                        AND k.device_id = d.id
                        AND k.agreement_key_sha256 = sha256(d.agreement_public_key))
   ORDER BY o.version, d.id
   LIMIT p_limit;
END $$;
REVOKE ALL ON FUNCTION offline_snapshot_keys_to_wrap(int) FROM PUBLIC;

CREATE FUNCTION wrap_offline_snapshot_key(p_ledger uuid, p_version bigint, p_device uuid,
                                          p_agreement_key_sha256 bytea, p_envelope jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE lg ledger%ROWTYPE; d device%ROWTYPE; v_full bigint;
BEGIN
  PERFORM assert_tenant(tenant_of_ledger(p_ledger));
  SELECT * INTO lg FROM ledger WHERE id = p_ledger;
  IF NOT FOUND THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  IF lg.scope_type <> 'EVENT' OR lg.status = 'LOCKED' THEN
    RAISE EXCEPTION 'Enveloppe : grand livre sans événement ou verrouillé' USING ERRCODE = 'CL001';
  END IF;
  -- FOR SHARE : une suspension ou une révocation validée entre-temps attend la fin de l'inscription
  -- ou la précède (et l'inscription la voit).
  SELECT * INTO d FROM device
   WHERE id = p_device AND operator_id = lg.operator_id AND event_id = lg.scope_id FOR SHARE;
  IF NOT FOUND OR d.status <> 'ACTIVE' OR d.personal_phone OR d.agreement_public_key IS NULL
     OR NOT EXISTS (SELECT 1 FROM event e WHERE e.id = d.event_id AND e.currency = lg.currency)
     OR (SELECT p.offline_enabled FROM effective_offline_policy(d.id) p) IS NOT TRUE THEN
    RAISE EXCEPTION 'Enveloppe : terminal non éligible' USING ERRCODE = 'CL001';
  END IF;
  IF p_agreement_key_sha256 IS NULL
     OR p_agreement_key_sha256 IS DISTINCT FROM sha256(d.agreement_public_key) THEN
    RAISE EXCEPTION 'Enveloppe : clé d''accord du terminal changée ou empreinte invalide'
      USING ERRCODE = 'CL001';
  END IF;
  SELECT max(f.version) INTO v_full FROM offline_snapshot f WHERE f.ledger_id = p_ledger AND f.kind = 'FULL';
  IF p_version IS NULL OR v_full IS NULL OR p_version < v_full
     OR NOT EXISTS (SELECT 1 FROM offline_snapshot o WHERE o.ledger_id = p_ledger AND o.version = p_version) THEN
    RAISE EXCEPTION 'Enveloppe : version non publiée ou antérieure au dernier FULL'
      USING ERRCODE = 'CL001';
  END IF;
  IF offline_snapshot_envelope_ok(p_envelope) IS NOT TRUE THEN
    RAISE EXCEPTION 'Enveloppe : forme invalide (alg, epk, iv, wrapped_key exactement)'
      USING ERRCODE = 'CL001';
  END IF;
  INSERT INTO offline_snapshot_key (ledger_id, version, device_id, agreement_key_sha256, operator_id,
                                    envelope)
  VALUES (p_ledger, p_version, p_device, p_agreement_key_sha256, lg.operator_id, p_envelope)
  ON CONFLICT DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION wrap_offline_snapshot_key(uuid, bigint, uuid, bytea, jsonb) FROM PUBLIC;

-- 4. Lecture par le terminal ---------------------------------------------------------------------------
CREATE FUNCTION offline_snapshot_for_device(p_device uuid, p_since bigint)
RETURNS TABLE (version bigint, latest_version bigint, header jsonb, signature bytea, entries jsonb,
               envelope jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE d device%ROWTYPE; ev event%ROWTYPE; lg ledger%ROWTYPE; o offline_snapshot%ROWTYPE;
        v_reason text; v_latest bigint; v_full bigint; v_serve bigint; v_env jsonb; v_sha bytea;
BEGIN
  PERFORM assert_tenant(tenant_of_device(p_device));
  SELECT * INTO d FROM device WHERE id = p_device;
  IF NOT FOUND THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  IF d.status = 'REVOKED' THEN
    RAISE EXCEPTION 'Terminal révoqué' USING ERRCODE = 'insufficient_privilege';
  END IF;
  v_reason := CASE
    WHEN d.status = 'SUSPENDED' THEN 'DEVICE_SUSPENDED'
    WHEN d.event_id IS NULL THEN 'NO_EVENT'
    WHEN d.personal_phone THEN 'PERSONAL_PHONE'
    WHEN (SELECT p.offline_enabled FROM effective_offline_policy(d.id) p) IS NOT TRUE THEN 'OFFLINE_DISABLED'
    WHEN NOT EXISTS (SELECT 1 FROM snapshot_signing_key k
                      WHERE k.owner = 'CENTRAL' AND k.status = 'ACTIVE'
                        AND (k.operator_id IS NULL OR k.operator_id = d.operator_id))
      THEN 'SNAPSHOTS_UNAVAILABLE'
    END;
  IF v_reason IS NOT NULL THEN
    RAISE EXCEPTION 'Snapshot : terminal non éligible (%)', v_reason
      USING ERRCODE = 'CL051', DETAIL = v_reason;
  END IF;
  SELECT * INTO ev FROM event WHERE id = d.event_id AND operator_id = d.operator_id;
  SELECT * INTO lg FROM ledger
   WHERE scope_type = 'EVENT' AND scope_id = d.event_id AND operator_id = d.operator_id
     AND currency = ev.currency;
  IF NOT FOUND OR lg.status = 'LOCKED' THEN
    RAISE EXCEPTION 'Snapshot : aucun snapshot disponible' USING ERRCODE = 'CL050';
  END IF;
  SELECT max(s.version), max(s.version) FILTER (WHERE s.kind = 'FULL') INTO v_latest, v_full
    FROM offline_snapshot s WHERE s.ledger_id = lg.id;
  IF v_latest IS NULL OR v_full IS NULL THEN
    RAISE EXCEPTION 'Snapshot : aucun snapshot disponible' USING ERRCODE = 'CL050';
  END IF;
  -- Choix de la version (snapshots.md, R-30.5) : b = p_since, L = dernière, F = dernier FULL.
  IF p_since IS NULL OR p_since < 1 OR p_since > v_latest THEN
    v_serve := v_full;                           -- sans base, inconnue ou antérieure à tout contenu
  ELSIF p_since = v_latest THEN
    v_serve := v_latest;
  ELSIF v_full > p_since OR v_latest - p_since > 5 THEN
    v_serve := v_full;
  ELSE
    v_serve := p_since + 1;
  END IF;
  SELECT * INTO o FROM offline_snapshot s WHERE s.ledger_id = lg.id AND s.version = v_serve;
  IF NOT FOUND OR (p_since = v_serve - 1 AND o.kind = 'DELTA'
                   AND o.base_version IS DISTINCT FROM p_since) THEN
    v_serve := v_full;
    SELECT * INTO o FROM offline_snapshot s WHERE s.ledger_id = lg.id AND s.version = v_serve;
  END IF;
  -- Enveloppe de CE terminal pour la clé d'accord COURANTE, jamais une autre.
  v_sha := sha256(d.agreement_public_key);
  SELECT k.envelope INTO v_env FROM offline_snapshot_key k
   WHERE k.ledger_id = lg.id AND k.version = v_serve AND k.device_id = d.id
     AND k.agreement_key_sha256 = v_sha;
  IF v_env IS NULL THEN
    RAISE EXCEPTION 'Snapshot : enveloppe pas encore prête pour ce terminal' USING ERRCODE = 'CL050';
  END IF;
  RETURN QUERY
  SELECT o.version, v_latest, o.header, o.signature,
         jsonb_build_object(
           'entries', coalesce((
              SELECT jsonb_agg(CASE WHEN e.pwd_pack_enc IS NULL THEN e.entry
                               ELSE e.entry || jsonb_build_object('pwd_pack_enc',
                                                                  encode(e.pwd_pack_enc, 'base64')) END
                               ORDER BY encode(e.token_hash, 'hex') COLLATE "C")
                FROM offline_snapshot_entry e
                JOIN offline_snapshot_draft dr ON dr.id = e.draft_id AND dr.status = 'PUBLISHED'
               WHERE e.ledger_id = lg.id AND e.version = o.version AND NOT e.removed), '[]'::jsonb),
           'removed_token_hashes', coalesce((
              SELECT jsonb_agg(encode(e.token_hash, 'hex') ORDER BY encode(e.token_hash, 'hex') COLLATE "C")
                FROM offline_snapshot_entry e
                JOIN offline_snapshot_draft dr ON dr.id = e.draft_id AND dr.status = 'PUBLISHED'
               WHERE e.ledger_id = lg.id AND e.version = o.version AND e.removed), '[]'::jsonb)),
         v_env || jsonb_build_object('agreement_key_sha256', encode(v_sha, 'hex'));
END $$;
REVOKE ALL ON FUNCTION offline_snapshot_for_device(uuid, bigint) FROM PUBLIC;

-- Clés publiques servies au terminal : le signataire du prestataire s'il a une clé CENTRAL ACTIVE propre
-- (c'est celle que `save_offline_snapshot_draft` choisit), sinon celui de la plateforme ; au plus deux
-- clés ACTIVE|RETIRED (borne CL054), l'ACTIVE d'abord puis la plus récente. `not_after` : NULL pour une ACTIVE.
CREATE FUNCTION snapshot_public_keys(p_operator uuid)
RETURNS TABLE (key_id text, algorithm text, public_key bytea, not_after timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE v_own boolean;
BEGIN
  PERFORM assert_tenant(p_operator);
  SELECT EXISTS (SELECT 1 FROM snapshot_signing_key k
                  WHERE k.owner = 'CENTRAL' AND k.status = 'ACTIVE' AND k.operator_id = p_operator)
    INTO v_own;
  RETURN QUERY
  SELECT k.key_id, k.algorithm, k.public_key,
         CASE WHEN k.status = 'RETIRED' THEN coalesce(k.retired_at, k.created_at) + interval '24 hours' END
    FROM snapshot_signing_key k
   WHERE k.owner = 'CENTRAL' AND k.status IN ('ACTIVE','RETIRED')
     AND CASE WHEN v_own THEN k.operator_id = p_operator ELSE k.operator_id IS NULL END
   ORDER BY (k.status = 'ACTIVE') DESC, k.created_at DESC, k.key_id
   LIMIT 2;
END $$;
REVOKE ALL ON FUNCTION snapshot_public_keys(uuid) FROM PUBLIC;

-- 5. Rotation de la clé de signature de la plateforme ---------------------------------------------------
-- Signataire = clé CENTRAL de la plateforme (operator_id et edge_gateway_id nuls). Reçoit la clé
-- publique et la référence KMS seulement. Ordre sous le verrou de la borne : les RETIRED en trop passent
-- REVOKED (la plus ancienne d'abord), l'ACTIVE actuelle passe RETIRED, la nouvelle est insérée ACTIVE ;
-- jamais plus de deux lignes ACTIVE|RETIRED à aucun instant. Aucune ACTIVE au départ : création.
CREATE FUNCTION rotate_snapshot_signing_key(p_new_key_id text, p_public_key bytea, p_kms_key_ref text,
                                            p_actor uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_active text; v_old text; v_retired int;
BEGIN
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'Rotation : acteur obligatoire' USING ERRCODE = 'CL001';
  END IF;
  IF p_new_key_id IS NULL OR p_new_key_id = '' OR length(p_new_key_id) > 200
     OR p_kms_key_ref IS NULL OR p_kms_key_ref = '' OR length(p_kms_key_ref) > 500 THEN
    RAISE EXCEPTION 'Rotation : identifiant et référence KMS non vides (200 et 500 caractères)'
      USING ERRCODE = 'CL001';
  END IF;
  IF p_public_key IS NULL OR octet_length(p_public_key) <> 91 THEN
    RAISE EXCEPTION 'Rotation : clé publique SPKI P-256 de 91 octets attendue' USING ERRCODE = 'CL001';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('snapshot-signer:CENTRAL::', 0));
  IF EXISTS (SELECT 1 FROM snapshot_signing_key WHERE key_id = p_new_key_id) THEN
    RAISE EXCEPTION 'Rotation : identifiant de clé déjà pris' USING ERRCODE = 'CL001';
  END IF;
  SELECT key_id INTO v_active FROM snapshot_signing_key
   WHERE owner = 'CENTRAL' AND operator_id IS NULL AND edge_gateway_id IS NULL AND status = 'ACTIVE';
  LOOP
    SELECT count(*) INTO v_retired FROM snapshot_signing_key
     WHERE owner = 'CENTRAL' AND operator_id IS NULL AND edge_gateway_id IS NULL AND status = 'RETIRED';
    EXIT WHEN v_retired <= CASE WHEN v_active IS NULL THEN 1 ELSE 0 END;
    SELECT key_id INTO v_old FROM snapshot_signing_key
     WHERE owner = 'CENTRAL' AND operator_id IS NULL AND edge_gateway_id IS NULL AND status = 'RETIRED'
     ORDER BY coalesce(retired_at, created_at), created_at, key_id LIMIT 1;
    UPDATE snapshot_signing_key SET status = 'REVOKED' WHERE key_id = v_old;
  END LOOP;
  IF v_active IS NOT NULL THEN
    UPDATE snapshot_signing_key SET status = 'RETIRED', retired_at = clock_timestamp()
     WHERE key_id = v_active;
  END IF;
  INSERT INTO snapshot_signing_key (key_id, operator_id, owner, algorithm, public_key, kms_key_ref,
                                    status)
  VALUES (p_new_key_id, NULL, 'CENTRAL', 'ECDSA_P256_SHA256', p_public_key, p_kms_key_ref, 'ACTIVE');
END $$;
REVOKE ALL ON FUNCTION rotate_snapshot_signing_key(text, bytea, text, uuid) FROM PUBLIC;
