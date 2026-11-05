-- Migration 0044 : snapshots hors ligne, brouillon et publication (mission hors-ligne-snapshots-lots,
-- lot WP03 ; FR-006 à FR-010, FR-038 ; NFR-006 ; research R-05, R-06, R-08, R-30.5, R-30.6, R-30.8,
-- R-30.9 ; OP-N57 ; ADR-140 ; contracts/interfaces.md § 3).
--
-- Contenu :
--   1. `offline_snapshot.content_key_wrapped` (clé de contenu K_v enveloppée par le KMS). Sans défaut :
--      la migration refuse de s'appliquer si un snapshot existe (aucun n'a jamais été publié).
--   2. Cinq tables nouvelles, toutes avec `operator_id` et RLS `tenant_isolation` ENABLE + FORCE :
--      `offline_snapshot_draft` (brouillon non signé), `offline_snapshot_entry` (contenu par version),
--      `offline_snapshot_state` (état courant par bracelet, sert au calcul d'un DELTA),
--      `offline_snapshot_media_log` (journal sans secret, une ligne par entrée et par version).
--   3. Lectures du processus `snapshot-content` : `offline_snapshot_targets`, `offline_snapshot_source`,
--      `offline_snapshot_source_delta`, `offline_snapshot_state_hashes`.
--   4. Brouillon : `save_`, `append_…_entries`, `seal_`, `discard_` (sans signature).
--   5. Signataire : `offline_snapshot_drafts_ready`, `offline_snapshot_draft_content` (jamais de mot de
--      passe), `publish_offline_snapshot` (SEULE voie d'inscription dans `offline_snapshot`, OP-N57),
--      `purge_offline_snapshot_content`.
--
-- Version (OP-N57) : personne ne la fournit. `save_` la calcule (max publiée + 1) sous le verrou
-- consultatif `hashtextextended('snapshot-version:' || ledger, 0)` ; `publish_` la reverifie sous le
-- même verrou. La chaîne publiée doit rester contiguë (max(version) = nombre de lignes) : une version
-- plantée par écriture directe fait refuser `save_` et `publish_` (CL048) au lieu de « sauter ».
-- Un seul brouillon OPEN|READY par grand livre (index unique partiel).
--
-- La base NE recalcule PAS l'empreinte JCS (le jsonb de PostgreSQL n'est pas canonique, RFC 8785) : elle
-- vérifie l'en-tête contre le brouillon, les colonnes et le contenu compté ; le signataire (WP13)
-- recalcule `content_sha256` depuis `offline_snapshot_draft_content` avant de signer.
--
-- Codes : CL048 (brouillon ou en-tête invalide, version déjà publiée ou chaîne rompue, brouillon en
-- mauvais état, DETAIL = motif court), CL015 (époque d'autorité différente de la courante, comme le
-- déclencheur existant), CL001 (argument incohérent : paquet > 5 000, type, p_since nul, raison vide),
-- P0002 « Objet introuvable » (grand livre ou brouillon d'un autre prestataire, ou inconnu).
--
-- Forme JSON des paquets (p_entries) : tableau d'objets
--   {"token_hash": 64 hex minuscules, "entry": objet aux ONZE clés de interfaces.md § 3 (null si retiré),
--    "pwd_pack_enc": 68 hex minuscules (34 octets) ou null, "removed": booléen (faux par défaut)}.
--   Si pwd_pack_enc est présent, entry.pwd_pack_sha256 = hex(SHA-256(pwd_pack_enc)) ; sinon il est null.
--
-- Forme de `entry_sha256` (détecteur de changement, non signé) : SHA-256 de `entry::text`, texte de
-- sortie du jsonb de PostgreSQL (clés triées par longueur puis par octets, séparateurs « ": » et « , »).
-- Pour ne pas la recopier côté Node, le producteur appelle `offline_snapshot_entry_sha256(entry)`.
-- Une entrée retirée (entry nul) porte SHA-256('removed').
-- Cette empreinte est INDÉPENDANTE du mot de passe chiffré (B2, cycle 3) : la clé `pwd_pack_sha256` est
-- retirée de l'entrée avant le calcul. La source la rend à NULL, `publish_` la voit remplie ; le
-- chiffrement n'est pas déterministe (nonce) et un rechiffrement (ROTATE_DEK, REENCRYPT) change
-- `pwd_pack_enc` sans changer le mot de passe. Le mot de passe est dérivé (KDF) de l'opérateur, de
-- `key_index` et de l'UID : un vrai changement de mot de passe passe donc par `key_index` ou `nfc_uid`,
-- deux clés de l'entrée, ou par le retrait du bracelet (`status`). Aucun autre signal n'existe à la source.
--
-- Hypothèse sur le propriétaire (migration 0023, en-tête l.19-25) : `offline_snapshot_targets` et
-- `offline_snapshot_drafts_ready` n'ont pas de prestataire de session ; elles supposent un propriétaire
-- qui ignore la RLS (avec un propriétaire soumis à la RLS elles échouent fermé : liste vide). Toutes les
-- autres fonctions prennent un `p_ledger` ou un `p_draft` et font `assert_tenant` : le processus pose
-- `app.operator_id` du prestataire cible avant l'appel (comme `tag-check`).
--
-- Droits : `REVOKE ALL … FROM PUBLIC` sur chaque fonction, aucun GRANT (WP08, post-roles.sql).
-- Hors lot : `offline_snapshot_key`, `offline_snapshot_for_device`, rotation des clés (WP04, 0045) ;
-- accusés (WP07) ; `wallet_status_history` (WP06, 0047).

-- 1. Colonne ajoutée ------------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM offline_snapshot) THEN
    RAISE EXCEPTION 'Migration 0044 : des snapshots existent déjà, content_key_wrapped ne peut pas être ajoutée sans défaut'
      USING ERRCODE = 'CL048';
  END IF;
END $$;
ALTER TABLE offline_snapshot
  ADD COLUMN content_key_wrapped bytea NOT NULL
    CONSTRAINT offline_snapshot_content_key_nonempty CHECK (octet_length(content_key_wrapped) > 0);

-- 2. Tables ----------------------------------------------------------------------------------------
CREATE TABLE offline_snapshot_draft (
  id                  bigserial PRIMARY KEY,
  operator_id         uuid NOT NULL REFERENCES party(id),
  ledger_id           uuid NOT NULL REFERENCES ledger(id),
  kind                text NOT NULL CHECK (kind IN ('FULL','DELTA')),
  base_version        bigint,
  version             bigint NOT NULL CHECK (version >= 1),   -- réservée par save_, jamais fournie
  header              jsonb NOT NULL,                          -- en-tête complet, sans signature
  content_key_wrapped bytea NOT NULL CHECK (octet_length(content_key_wrapped) > 0),
  status              text NOT NULL DEFAULT 'OPEN'
                        CHECK (status IN ('OPEN','READY','PUBLISHED','DISCARDED')),
  discard_reason      text CHECK (discard_reason IS NULL OR length(discard_reason) BETWEEN 1 AND 200),
  created_at          timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((kind = 'DELTA') = (base_version IS NOT NULL)),
  CHECK (base_version IS NULL OR base_version < version),
  CHECK ((status = 'DISCARDED') = (discard_reason IS NOT NULL))
);
-- Un seul brouillon en cours (OPEN|READY) par grand livre : « max(publiée, brouillons) + 1 ».
CREATE UNIQUE INDEX offline_snapshot_draft_one_live ON offline_snapshot_draft (ledger_id)
  WHERE status IN ('OPEN','READY');
CREATE INDEX offline_snapshot_draft_ready_idx ON offline_snapshot_draft (version, id)
  WHERE status = 'READY';

-- Contenu par version. Pas de clé étrangère vers offline_snapshot : le brouillon précède la ligne
-- publiée ; le rattachement est le statut PUBLISHED du brouillon (draft_id).
CREATE TABLE offline_snapshot_entry (
  ledger_id    uuid NOT NULL REFERENCES ledger(id),
  version      bigint NOT NULL CHECK (version >= 1),
  token_hash   bytea NOT NULL CHECK (octet_length(token_hash) = 32),
  draft_id     bigint NOT NULL REFERENCES offline_snapshot_draft(id),
  entry        jsonb,                                         -- nul si retiré (removed_token_hashes)
  pwd_pack_enc bytea CHECK (pwd_pack_enc IS NULL OR octet_length(pwd_pack_enc) = 34),
  removed      boolean NOT NULL DEFAULT false,
  operator_id  uuid NOT NULL REFERENCES party(id),
  PRIMARY KEY (ledger_id, version, token_hash),
  CHECK (removed = (entry IS NULL)),
  CHECK (NOT removed OR pwd_pack_enc IS NULL)
);
CREATE INDEX offline_snapshot_entry_draft_idx ON offline_snapshot_entry (draft_id);

CREATE TABLE offline_snapshot_state (
  ledger_id    uuid NOT NULL REFERENCES ledger(id),
  token_hash   bytea NOT NULL CHECK (octet_length(token_hash) = 32),
  entry_sha256 bytea NOT NULL CHECK (octet_length(entry_sha256) = 32),
  last_version bigint NOT NULL CHECK (last_version >= 1),
  removed      boolean NOT NULL DEFAULT false,
  operator_id  uuid NOT NULL REFERENCES party(id),
  PRIMARY KEY (ledger_id, token_hash)
);

CREATE TABLE offline_snapshot_media_log (
  ledger_id      uuid NOT NULL REFERENCES ledger(id),
  version        bigint NOT NULL CHECK (version >= 1),
  token_hash     bytea NOT NULL CHECK (octet_length(token_hash) = 32),
  media_status   text,
  batch_status   text,
  batch_event_id uuid,
  wallet_status  text,
  in_snapshot    boolean NOT NULL,
  operator_id    uuid NOT NULL REFERENCES party(id),
  PRIMARY KEY (ledger_id, version, token_hash)
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['offline_snapshot_draft','offline_snapshot_entry','offline_snapshot_state',
                           'offline_snapshot_media_log'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
                     USING (operator_id = current_setting('app.operator_id', true)::uuid)
                     WITH CHECK (operator_id = current_setting('app.operator_id', true)::uuid)$p$, t);
  END LOOP;
END $$;

-- 3. Fonctions internes ------------------------------------------------------------------------------
-- Empreinte de changement d'une entrée (voir l'en-tête). INVOKER, pure.
CREATE FUNCTION offline_snapshot_entry_sha256(p_entry jsonb) RETURNS bytea
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT sha256(convert_to(CASE WHEN p_entry IS NULL OR jsonb_typeof(p_entry) = 'null'
                                THEN 'removed' ELSE (p_entry - 'pwd_pack_sha256')::text END, 'UTF8'))
$$;
REVOKE ALL ON FUNCTION offline_snapshot_entry_sha256(jsonb) FROM PUBLIC;

-- Un élément de paquet est-il bien formé ? (les onze clés exactes d'une entrée, types, mot de passe)
CREATE FUNCTION offline_snapshot_item_ok(p_item jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $$
DECLARE v_removed boolean; v_en jsonb; v_pw text;
BEGIN
  IF jsonb_typeof(p_item) IS DISTINCT FROM 'object'
     OR coalesce(p_item->>'token_hash', '') !~ '^[0-9a-f]{64}$' THEN
    RETURN false;
  END IF;
  IF p_item ? 'removed' AND jsonb_typeof(p_item->'removed') IS DISTINCT FROM 'boolean' THEN
    RETURN false;
  END IF;
  v_removed := coalesce((p_item->>'removed')::boolean, false);
  v_en := p_item->'entry';
  v_pw := p_item->>'pwd_pack_enc';
  IF p_item ? 'pwd_pack_enc' AND jsonb_typeof(p_item->'pwd_pack_enc') NOT IN ('string','null') THEN
    RETURN false;
  END IF;
  IF v_removed THEN
    RETURN (v_en IS NULL OR jsonb_typeof(v_en) = 'null') AND v_pw IS NULL;
  END IF;
  IF jsonb_typeof(v_en) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
  IF ARRAY(SELECT k FROM jsonb_object_keys(v_en) k ORDER BY k COLLATE "C")
     IS DISTINCT FROM ARRAY['batch_event_id','batch_status','key_index','last_counter','nfc_uid',
                            'originality_sig_sha256','pwd_pack_sha256','spendable','status',
                            'token_hash','wallet_status'] THEN
    RETURN false;
  END IF;
  IF v_en->>'token_hash' IS DISTINCT FROM p_item->>'token_hash'
     OR jsonb_typeof(v_en->'status') IS DISTINCT FROM 'string'
     OR jsonb_typeof(v_en->'wallet_status') IS DISTINCT FROM 'string'
     OR jsonb_typeof(v_en->'key_index') IS DISTINCT FROM 'number'
     OR coalesce(v_en->>'spendable', '') !~ '^-?[0-9]+$'
     OR (jsonb_typeof(v_en->'last_counter') NOT IN ('number','null'))
     OR (jsonb_typeof(v_en->'nfc_uid') = 'string' AND (v_en->>'nfc_uid') !~ '^[0-9a-f]{14}$')
     OR (jsonb_typeof(v_en->'nfc_uid') NOT IN ('string','null'))
     OR (jsonb_typeof(v_en->'originality_sig_sha256') = 'string'
         AND (v_en->>'originality_sig_sha256') !~ '^[0-9a-f]{64}$')
     OR (jsonb_typeof(v_en->'originality_sig_sha256') NOT IN ('string','null'))
     OR (jsonb_typeof(v_en->'batch_event_id') NOT IN ('string','null'))
     OR (jsonb_typeof(v_en->'batch_status') NOT IN ('string','null')) THEN
    RETURN false;
  END IF;
  IF v_pw IS NULL THEN
    RETURN jsonb_typeof(v_en->'pwd_pack_sha256') = 'null';
  END IF;
  -- Tout NULL est un refus (B2) : un sha nul avec mot de passe ne passe pas.
  RETURN coalesce(v_pw ~ '^[0-9a-f]{68}$'
     AND v_en->>'pwd_pack_sha256' = encode(sha256(decode(v_pw, 'hex')), 'hex'), false);
END $$;
REVOKE ALL ON FUNCTION offline_snapshot_item_ok(jsonb) FROM PUBLIC;

-- En-tête complet et bien formé ? Ensemble EXACT des quinze clés, types, entiers bornés, dates avec
-- fuseau, empreinte hex. Tout NULL est un refus (B3) ; ne lève jamais.
CREATE FUNCTION offline_snapshot_header_ok(h jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $$
DECLARE c_ts constant text :=
  '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$';
BEGIN
  IF jsonb_typeof(h) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
  IF ARRAY(SELECT k FROM jsonb_object_keys(h) k ORDER BY k COLLATE "C")
     IS DISTINCT FROM ARRAY['authority_epoch','base_version','content_sha256','currency','entries',
                            'event_id','format','generated_at','key_id','kind','ledger_id',
                            'operator_id','removed','valid_until','version'] THEN
    RETURN false;
  END IF;
  IF jsonb_typeof(h->'entries') IS DISTINCT FROM 'number'
     OR jsonb_typeof(h->'removed') IS DISTINCT FROM 'number'
     OR jsonb_typeof(h->'version') IS DISTINCT FROM 'number'
     OR jsonb_typeof(h->'authority_epoch') IS DISTINCT FROM 'number'
     OR jsonb_typeof(h->'base_version') NOT IN ('number','null')
     OR jsonb_typeof(h->'generated_at') IS DISTINCT FROM 'string'
     OR jsonb_typeof(h->'valid_until') IS DISTINCT FROM 'string'
     OR jsonb_typeof(h->'content_sha256') IS DISTINCT FROM 'string'
     OR jsonb_typeof(h->'kind') IS DISTINCT FROM 'string'
     OR jsonb_typeof(h->'format') IS DISTINCT FROM 'string'
     OR jsonb_typeof(h->'key_id') IS DISTINCT FROM 'string'
     OR jsonb_typeof(h->'currency') IS DISTINCT FROM 'string'
     OR jsonb_typeof(h->'operator_id') IS DISTINCT FROM 'string'
     OR jsonb_typeof(h->'ledger_id') IS DISTINCT FROM 'string'
     OR jsonb_typeof(h->'event_id') IS DISTINCT FROM 'string' THEN
    RETURN false;
  END IF;
  IF (h->>'entries') !~ '^[0-9]{1,10}$' OR (h->>'removed') !~ '^[0-9]{1,10}$'
     OR (h->>'version') !~ '^[0-9]{1,18}$' OR (h->>'authority_epoch') !~ '^[0-9]{1,9}$'
     OR (h->>'generated_at') !~ c_ts OR (h->>'valid_until') !~ c_ts
     OR (h->>'content_sha256') !~ '^[0-9a-f]{64}$'
     OR (h->>'kind') NOT IN ('FULL','DELTA')
     OR (h->>'format') <> 'CASHLESS-SNAPSHOT/v1' THEN
    RETURN false;
  END IF;
  IF (h->>'entries')::bigint > 2147483647 OR (h->>'removed')::bigint > 2147483647 THEN
    RETURN false;
  END IF;
  RETURN (h->>'valid_until')::timestamptz > (h->>'generated_at')::timestamptz;
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END $$;
REVOKE ALL ON FUNCTION offline_snapshot_header_ok(jsonb) FROM PUBLIC;

-- Brouillon du prestataire de la session (P0002 sinon), ligne verrouillée. Avec p_ledger_lock, le
-- verrou consultatif de version du grand livre est pris AVANT le verrou de ligne (ordre fixe).
CREATE FUNCTION offline_snapshot_draft_locked(p_draft bigint, p_ledger_lock boolean)
RETURNS offline_snapshot_draft
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE d offline_snapshot_draft%ROWTYPE;
BEGIN
  SELECT * INTO d FROM offline_snapshot_draft WHERE id = p_draft;
  IF NOT FOUND THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  PERFORM assert_tenant(d.operator_id);
  IF p_ledger_lock THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('snapshot-version:' || d.ledger_id::text, 0));
  END IF;
  SELECT * INTO d FROM offline_snapshot_draft WHERE id = p_draft FOR UPDATE;
  RETURN d;
END $$;
REVOKE ALL ON FUNCTION offline_snapshot_draft_locked(bigint, boolean) FROM PUBLIC;

-- Ajoute un paquet (≤ 5 000) à un brouillon OPEN déjà verrouillé par l'appelant ; rend le nombre inscrit.
CREATE FUNCTION offline_snapshot_add_entries(p_draft bigint, p_entries jsonb) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE d offline_snapshot_draft%ROWTYPE; n int; v_live int; v_gone int;
BEGIN
  IF p_entries IS NULL THEN RETURN 0; END IF;
  IF jsonb_typeof(p_entries) <> 'array' THEN
    RAISE EXCEPTION 'Snapshot : paquet d''entrées (tableau) attendu' USING ERRCODE = 'CL001';
  END IF;
  IF jsonb_array_length(p_entries) > 5000 THEN
    RAISE EXCEPTION 'Snapshot : paquet de % entrées, 5 000 au plus', jsonb_array_length(p_entries)
      USING ERRCODE = 'CL001';
  END IF;
  IF jsonb_array_length(p_entries) = 0 THEN RETURN 0; END IF;
  SELECT * INTO d FROM offline_snapshot_draft WHERE id = p_draft;
  IF offline_snapshot_header_ok(d.header) IS NOT TRUE THEN
    RAISE EXCEPTION 'Snapshot : en-tête du brouillon mal formé' USING ERRCODE = 'CL048',
      DETAIL = 'HEADER_SHAPE';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_entries) x WHERE offline_snapshot_item_ok(x) IS NOT TRUE) THEN
    RAISE EXCEPTION 'Snapshot : entrée mal formée (onze clés exactes, hex, mot de passe lié à son empreinte)'
      USING ERRCODE = 'CL048', DETAIL = 'BAD_ENTRY';
  END IF;
  BEGIN
    INSERT INTO offline_snapshot_entry (ledger_id, version, token_hash, draft_id, entry, pwd_pack_enc,
                                        removed, operator_id)
    SELECT d.ledger_id, d.version, decode(x->>'token_hash', 'hex'), d.id,
           CASE WHEN coalesce((x->>'removed')::boolean, false) THEN NULL ELSE x->'entry' END,
           decode(x->>'pwd_pack_enc', 'hex'), coalesce((x->>'removed')::boolean, false), d.operator_id
      FROM jsonb_array_elements(p_entries) x;
    GET DIAGNOSTICS n = ROW_COUNT;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'Snapshot : jeton déjà présent dans le brouillon' USING ERRCODE = 'CL048',
      DETAIL = 'DUPLICATE_TOKEN';
  END;
  -- Le brouillon ne dépasse jamais les comptes annoncés par son en-tête.
  SELECT count(*) FILTER (WHERE NOT removed), count(*) FILTER (WHERE removed)
    INTO v_live, v_gone FROM offline_snapshot_entry WHERE draft_id = d.id;
  IF v_live > (d.header->>'entries')::int OR v_gone > (d.header->>'removed')::int THEN
    RAISE EXCEPTION 'Snapshot : plus d''entrées que l''en-tête n''en annonce' USING ERRCODE = 'CL048',
      DETAIL = 'TOO_MANY_ENTRIES';
  END IF;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION offline_snapshot_add_entries(bigint, jsonb) FROM PUBLIC;

-- 4. Lectures du processus snapshot-content ------------------------------------------------------------
-- Un grand livre par événement non LOCKED ayant au moins un terminal éligible : ACTIVE, de l'événement,
-- hors ligne permis, pas un téléphone personnel, clé d'accord connue. Sans prestataire de session
-- (hypothèse sur le propriétaire, voir l'en-tête).
-- `max_snapshot_age` (B3, cycle 3) : plafond d'âge effectif (politique effective de 0043, héritage
-- DEVICE > EVENT > ORGANIZER, 15 min par défaut). Un snapshot sert tous les terminaux éligibles : on rend le
-- PLUS PETIT plafond d'entre eux, pour qu'aucun ne détienne un snapshot plus vieux que sa politique.
-- Le producteur pose valid_until = generated_at + max_snapshot_age.
CREATE FUNCTION offline_snapshot_targets()
RETURNS TABLE (operator_id uuid, ledger_id uuid, event_id uuid, last_version bigint,
               last_generated_at timestamptz, last_full_version bigint, eligible_devices int,
               max_snapshot_age interval)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT l.operator_id, l.id, l.scope_id, coalesce(lv.version, 0)::bigint, lv.generated_at,
         coalesce(lf.version, 0)::bigint, c.n::int, c.age
    FROM ledger l
    JOIN event e ON e.id = l.scope_id AND e.operator_id = l.operator_id
    CROSS JOIN LATERAL (
      SELECT count(*) AS n, min(p.max_snapshot_age) AS age FROM device d
        CROSS JOIN LATERAL effective_offline_policy(d.id) p
       WHERE d.event_id = e.id AND d.operator_id = l.operator_id AND d.status = 'ACTIVE'
         AND NOT d.personal_phone AND d.agreement_public_key IS NOT NULL
         AND p.offline_enabled) c
    LEFT JOIN LATERAL (SELECT o.version, o.generated_at FROM offline_snapshot o
                        WHERE o.ledger_id = l.id ORDER BY o.version DESC LIMIT 1) lv ON true
    LEFT JOIN LATERAL (SELECT o.version FROM offline_snapshot o
                        WHERE o.ledger_id = l.id AND o.kind = 'FULL'
                        ORDER BY o.version DESC LIMIT 1) lf ON true
   WHERE l.scope_type = 'EVENT' AND l.status <> 'LOCKED' AND c.n > 0
$$;
REVOKE ALL ON FUNCTION offline_snapshot_targets() FROM PUBLIC;

-- Source commune. p_since NULL : état complet ; sinon bracelets changés depuis p_since - 5 s
-- (recouvrement, R-30.5) plus tous les bracelets des portefeuilles non ACTIVE (pas d'historique de
-- portefeuille avant WP06 : le producteur écarte les entrées inchangées grâce à l'état). Les jetons de
-- l'état absents de la vue sont rendus retirés (en DELTA : seulement ceux pas encore marqués retirés).
CREATE FUNCTION offline_snapshot_source_rows(p_ledger uuid, p_since timestamptz)
RETURNS TABLE (token_hash bytea, media_id uuid, entry jsonb, pwd_pack_enc bytea, pwd_pack_dek_id uuid,
               key_index int, nfc_uid bytea, removed boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE v_t0 timestamptz := p_since - interval '5 seconds';
BEGIN
  PERFORM assert_tenant(tenant_of_ledger(p_ledger));
  RETURN QUERY
  WITH live AS (
    SELECT r.*, m.batch_id AS media_batch_id
      FROM offline_snapshot_rows r JOIN media m ON m.id = r.media_id
     WHERE r.ledger_id = p_ledger),
  changed_wallets AS (
    SELECT DISTINCT a.wallet_id
      FROM journal_transaction jt
      JOIN posting po ON po.ledger_id = jt.ledger_id AND po.transaction_id = jt.id
      JOIN account a ON a.id = po.account_id
     WHERE p_since IS NOT NULL AND jt.ledger_id = p_ledger AND jt.recorded_at > v_t0
       AND a.purpose IN ('WALLET_PAID','WALLET_PROMO') AND a.wallet_id IS NOT NULL)
  SELECT l.token_hash, l.media_id,
         jsonb_build_object(
           'token_hash', encode(l.token_hash, 'hex'),
           'nfc_uid', encode(l.nfc_uid, 'hex'),
           'key_index', l.key_index,
           'originality_sig_sha256', encode(l.originality_sig_sha256, 'hex'),
           'status', l.status,
           'batch_event_id', l.batch_event_id,
           'batch_status', l.batch_status,
           'wallet_status', l.wallet_status,
           'spendable', l.spendable,
           'last_counter', l.last_counter,
           'pwd_pack_sha256', NULL::text),
         l.pwd_pack_enc, l.pwd_pack_dek_id, l.key_index, l.nfc_uid, false
    FROM live l
   WHERE p_since IS NULL
      OR l.wallet_status <> 'ACTIVE'
      OR l.wallet_id IN (SELECT w.wallet_id FROM changed_wallets w)
      OR EXISTS (SELECT 1 FROM media_status_history h
                  WHERE h.media_id = l.media_id AND h.at > v_t0)
      OR (l.media_batch_id IS NOT NULL
          AND EXISTS (SELECT 1 FROM media_batch_status_history h
                       WHERE h.batch_id = l.media_batch_id AND h.at > v_t0))
      OR EXISTS (SELECT 1 FROM media_assignment ma
                  WHERE ma.media_id = l.media_id AND ma.wallet_id = l.wallet_id
                    AND (ma.assigned_at > v_t0 OR ma.released_at > v_t0))
  UNION ALL
  SELECT st.token_hash, NULL::uuid, NULL::jsonb, NULL::bytea, NULL::uuid, NULL::int, NULL::bytea, true
    FROM offline_snapshot_state st
   WHERE st.ledger_id = p_ledger
     AND NOT EXISTS (SELECT 1 FROM live l WHERE l.token_hash = st.token_hash)
     AND (p_since IS NULL OR NOT st.removed);
END $$;
REVOKE ALL ON FUNCTION offline_snapshot_source_rows(uuid, timestamptz) FROM PUBLIC;

-- État complet du grand livre, retirés compris. Seule voie de sortie de pwd_pack_enc (rôle content).
CREATE FUNCTION offline_snapshot_source(p_ledger uuid)
RETURNS TABLE (token_hash bytea, media_id uuid, entry jsonb, pwd_pack_enc bytea, pwd_pack_dek_id uuid,
               key_index int, nfc_uid bytea, removed boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  RETURN QUERY SELECT * FROM offline_snapshot_source_rows(p_ledger, NULL);
END $$;
REVOKE ALL ON FUNCTION offline_snapshot_source(uuid) FROM PUBLIC;

CREATE FUNCTION offline_snapshot_source_delta(p_ledger uuid, p_since timestamptz)
RETURNS TABLE (token_hash bytea, media_id uuid, entry jsonb, pwd_pack_enc bytea, pwd_pack_dek_id uuid,
               key_index int, nfc_uid bytea, removed boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF p_since IS NULL THEN
    RAISE EXCEPTION 'Snapshot : date de départ obligatoire pour un DELTA' USING ERRCODE = 'CL001';
  END IF;
  RETURN QUERY SELECT * FROM offline_snapshot_source_rows(p_ledger, p_since);
END $$;
REVOKE ALL ON FUNCTION offline_snapshot_source_delta(uuid, timestamptz) FROM PUBLIC;

-- Ajout à interfaces.md : lecture de l'état courant par le producteur (aucun rôle ne lit la table).
CREATE FUNCTION offline_snapshot_state_hashes(p_ledger uuid)
RETURNS TABLE (token_hash bytea, entry_sha256 bytea, removed boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
BEGIN
  PERFORM assert_tenant(tenant_of_ledger(p_ledger));
  RETURN QUERY SELECT s.token_hash, s.entry_sha256, s.removed
                 FROM offline_snapshot_state s WHERE s.ledger_id = p_ledger;
END $$;
REVOKE ALL ON FUNCTION offline_snapshot_state_hashes(uuid) FROM PUBLIC;

-- 5. Brouillon ---------------------------------------------------------------------------------------------
-- Réserve la version (max publiée + 1) sous verrou et inscrit le brouillon OPEN. La base pose ELLE-MÊME
-- les champs qu'elle possède dans l'en-tête : format, operator_id, ledger_id, event_id, currency,
-- version, base_version, authority_epoch, key_id (clé centrale ACTIVE, celle du prestataire d'abord).
-- Le producteur fournit kind, generated_at, valid_until, entries, removed, content_sha256 ; toute autre
-- clé est ignorée, un champ de la base fourni avec une autre valeur est refusé (CL048).
CREATE FUNCTION save_offline_snapshot_draft(p_ledger uuid, p_kind text, p_header jsonb,
                                            p_content_key_wrapped bytea, p_entries jsonb)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE lg ledger%ROWTYPE; v_max bigint; v_cnt bigint; v_version bigint; v_base bigint;
        v_key text; v_owned jsonb; v_header jsonb; v_id bigint; k text; v jsonb;
BEGIN
  IF p_kind IS NULL OR p_kind NOT IN ('FULL','DELTA') OR p_header IS NULL
     OR jsonb_typeof(p_header) <> 'object' THEN
    RAISE EXCEPTION 'Snapshot : type (FULL|DELTA) et en-tête (objet) attendus' USING ERRCODE = 'CL001';
  END IF;
  IF p_content_key_wrapped IS NULL OR octet_length(p_content_key_wrapped) = 0 THEN
    RAISE EXCEPTION 'Snapshot : clé de contenu enveloppée vide' USING ERRCODE = 'CL048',
      DETAIL = 'EMPTY_CONTENT_KEY';
  END IF;
  PERFORM assert_tenant(tenant_of_ledger(p_ledger));
  PERFORM pg_advisory_xact_lock(hashtextextended('snapshot-version:' || p_ledger::text, 0));
  SELECT * INTO lg FROM ledger WHERE id = p_ledger;
  IF NOT FOUND THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  IF lg.scope_type <> 'EVENT' OR lg.status = 'LOCKED' THEN
    RAISE EXCEPTION 'Snapshot : grand livre sans événement ou verrouillé' USING ERRCODE = 'CL048',
      DETAIL = 'LEDGER_NOT_SERVABLE';
  END IF;
  -- Champs du producteur.
  IF p_header->>'kind' IS DISTINCT FROM p_kind THEN
    RAISE EXCEPTION 'Snapshot : champs du producteur invalides dans l''en-tête' USING ERRCODE = 'CL048',
      DETAIL = 'BAD_PRODUCER_FIELDS';
  END IF;
  -- Chaîne de versions contiguë (une version plantée la rompt).
  SELECT coalesce(max(version), 0), count(*) INTO v_max, v_cnt
    FROM offline_snapshot WHERE ledger_id = p_ledger;
  IF v_max <> v_cnt THEN
    RAISE EXCEPTION 'Snapshot : chaîne de versions rompue (max %, % publiées)', v_max, v_cnt
      USING ERRCODE = 'CL048', DETAIL = 'VERSION_CHAIN_BROKEN';
  END IF;
  IF EXISTS (SELECT 1 FROM offline_snapshot_draft
              WHERE ledger_id = p_ledger AND status IN ('OPEN','READY')) THEN
    RAISE EXCEPTION 'Snapshot : un brouillon est déjà en cours pour ce grand livre'
      USING ERRCODE = 'CL048', DETAIL = 'DRAFT_ALREADY_OPEN';
  END IF;
  v_version := v_max + 1;
  IF p_kind = 'DELTA' THEN
    IF v_max = 0 THEN
      RAISE EXCEPTION 'Snapshot : DELTA sans version précédente' USING ERRCODE = 'CL048',
        DETAIL = 'NO_BASE_VERSION';
    END IF;
    v_base := v_max;
  END IF;
  SELECT key_id INTO v_key FROM snapshot_signing_key
   WHERE owner = 'CENTRAL' AND status = 'ACTIVE'
     AND (operator_id IS NULL OR operator_id = lg.operator_id)
   ORDER BY operator_id NULLS LAST LIMIT 1;
  IF v_key IS NULL THEN
    RAISE EXCEPTION 'Snapshot : aucune clé de signature centrale ACTIVE' USING ERRCODE = 'CL048',
      DETAIL = 'NO_SIGNING_KEY';
  END IF;
  v_owned := jsonb_build_object('format', 'CASHLESS-SNAPSHOT/v1', 'operator_id', lg.operator_id,
                                'ledger_id', lg.id, 'event_id', lg.scope_id,
                                'currency', lg.currency::text, 'version', v_version,
                                'base_version', v_base, 'authority_epoch', lg.authority_epoch,
                                'key_id', v_key);
  FOR k, v IN SELECT * FROM jsonb_each(v_owned) LOOP
    IF p_header ? k AND p_header->k IS DISTINCT FROM v THEN
      RAISE EXCEPTION 'Snapshot : le champ % appartient à la base et ne correspond pas', k
        USING ERRCODE = 'CL048', DETAIL = 'OWNED_FIELD_MISMATCH';
    END IF;
  END LOOP;
  v_header := v_owned || jsonb_build_object(
    'kind', p_kind, 'generated_at', p_header->'generated_at', 'valid_until', p_header->'valid_until',
    'entries', p_header->'entries', 'removed', p_header->'removed',
    'content_sha256', p_header->'content_sha256');
  -- Forme complète, entiers bornés, dates et empreinte (M1 : CL048, jamais 22003).
  IF offline_snapshot_header_ok(v_header) IS NOT TRUE THEN
    RAISE EXCEPTION 'Snapshot : champs du producteur invalides dans l''en-tête' USING ERRCODE = 'CL048',
      DETAIL = 'BAD_PRODUCER_FIELDS';
  END IF;
  INSERT INTO offline_snapshot_draft (operator_id, ledger_id, kind, base_version, version, header,
                                      content_key_wrapped)
  VALUES (lg.operator_id, lg.id, p_kind, v_base, v_version, v_header, p_content_key_wrapped)
  RETURNING id INTO v_id;
  PERFORM offline_snapshot_add_entries(v_id, p_entries);
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION save_offline_snapshot_draft(uuid, text, jsonb, bytea, jsonb) FROM PUBLIC;

-- Paquet supplémentaire (≤ 5 000) sur un brouillon OPEN ; rend le nombre inscrit.
CREATE FUNCTION append_offline_snapshot_draft_entries(p_draft bigint, p_entries jsonb) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE d offline_snapshot_draft%ROWTYPE;
BEGIN
  d := offline_snapshot_draft_locked(p_draft, false);
  IF d.status <> 'OPEN' THEN
    RAISE EXCEPTION 'Snapshot : brouillon % non ouvert (%)', p_draft, d.status USING ERRCODE = 'CL048',
      DETAIL = 'DRAFT_NOT_OPEN';
  END IF;
  RETURN offline_snapshot_add_entries(p_draft, p_entries);
END $$;
REVOKE ALL ON FUNCTION append_offline_snapshot_draft_entries(bigint, jsonb) FROM PUBLIC;

-- OPEN -> READY quand les comptes inscrits égalent ceux de l'en-tête ; plus d'ajout ensuite.
CREATE FUNCTION seal_offline_snapshot_draft(p_draft bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE d offline_snapshot_draft%ROWTYPE; v_live int; v_gone int;
BEGIN
  d := offline_snapshot_draft_locked(p_draft, false);
  IF d.status <> 'OPEN' THEN
    RAISE EXCEPTION 'Snapshot : brouillon % non ouvert (%)', p_draft, d.status USING ERRCODE = 'CL048',
      DETAIL = 'DRAFT_NOT_OPEN';
  END IF;
  IF offline_snapshot_header_ok(d.header) IS NOT TRUE THEN
    RAISE EXCEPTION 'Snapshot : en-tête du brouillon mal formé' USING ERRCODE = 'CL048',
      DETAIL = 'HEADER_SHAPE';
  END IF;
  SELECT count(*) FILTER (WHERE NOT removed), count(*) FILTER (WHERE removed)
    INTO v_live, v_gone FROM offline_snapshot_entry WHERE draft_id = d.id;
  IF v_live <> (d.header->>'entries')::int OR v_gone <> (d.header->>'removed')::int THEN
    RAISE EXCEPTION 'Snapshot : % entrées et % retirées inscrites, l''en-tête annonce % et %',
      v_live, v_gone, d.header->>'entries', d.header->>'removed'
      USING ERRCODE = 'CL048', DETAIL = 'COUNT_MISMATCH';
  END IF;
  UPDATE offline_snapshot_draft SET status = 'READY' WHERE id = d.id;
END $$;
REVOKE ALL ON FUNCTION seal_offline_snapshot_draft(bigint) FROM PUBLIC;

-- OPEN|READY -> DISCARDED, entrées supprimées. Appelable par le producteur et par le signataire.
-- Brouillon déjà abandonné : sans effet ; publié : CL048.
CREATE FUNCTION discard_offline_snapshot_draft(p_draft bigint, p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE d offline_snapshot_draft%ROWTYPE;
BEGIN
  IF p_reason IS NULL OR length(btrim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'Snapshot : motif d''abandon obligatoire' USING ERRCODE = 'CL001';
  END IF;
  d := offline_snapshot_draft_locked(p_draft, false);
  IF d.status = 'DISCARDED' THEN RETURN; END IF;
  IF d.status = 'PUBLISHED' THEN
    RAISE EXCEPTION 'Snapshot : brouillon % déjà publié', p_draft USING ERRCODE = 'CL048',
      DETAIL = 'DRAFT_PUBLISHED';
  END IF;
  DELETE FROM offline_snapshot_entry WHERE draft_id = d.id;
  UPDATE offline_snapshot_draft SET status = 'DISCARDED', discard_reason = left(btrim(p_reason), 200)
   WHERE id = d.id;
END $$;
REVOKE ALL ON FUNCTION discard_offline_snapshot_draft(bigint, text) FROM PUBLIC;

-- Brouillon orphelin (B1, cycle 3) : un passage planté laisse un brouillon OPEN|READY dont l'id est perdu
-- et qui bloque ensuite save_ (DRAFT_ALREADY_OPEN). Jette tous les brouillons OPEN|READY du grand livre
-- (jamais PUBLISHED), supprime leurs entrées, rend le nombre jeté. Même verrou de version que save_
-- et publish_ (verrou du grand livre, puis lignes) ; même effet que discard_offline_snapshot_draft.
CREATE FUNCTION discard_open_offline_snapshot_drafts(p_ledger uuid) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_ids bigint[]; v_n int;
BEGIN
  PERFORM assert_tenant(tenant_of_ledger(p_ledger));
  PERFORM pg_advisory_xact_lock(hashtextextended('snapshot-version:' || p_ledger::text, 0));
  SELECT coalesce(array_agg(id ORDER BY id), ARRAY[]::bigint[]) INTO v_ids
    FROM offline_snapshot_draft WHERE ledger_id = p_ledger AND status IN ('OPEN','READY');
  DELETE FROM offline_snapshot_entry WHERE draft_id = ANY (v_ids);
  UPDATE offline_snapshot_draft SET status = 'DISCARDED', discard_reason = 'orphan draft discarded'
   WHERE id = ANY (v_ids);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION discard_open_offline_snapshot_drafts(uuid) FROM PUBLIC;

-- 6. Signataire ------------------------------------------------------------------------------------------------
-- Brouillons READY de tous les prestataires, par version (hypothèse sur le propriétaire, voir l'en-tête).
-- Colonnes énumérées : JAMAIS content_key_wrapped (le signataire n'a pas à voir la clé de contenu).
CREATE FUNCTION offline_snapshot_drafts_ready()
RETURNS TABLE (id bigint, operator_id uuid, ledger_id uuid, kind text, base_version bigint,
               version bigint, header jsonb, created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT d.id, d.operator_id, d.ledger_id, d.kind, d.base_version, d.version, d.header, d.created_at
    FROM offline_snapshot_draft d WHERE d.status = 'READY' ORDER BY d.version, d.id
$$;
REVOKE ALL ON FUNCTION offline_snapshot_drafts_ready() FROM PUBLIC;

-- Contenu à hacher et à signer. JAMAIS pwd_pack_enc ; brouillon READY ou PUBLISHED seulement.
CREATE FUNCTION offline_snapshot_draft_content(p_draft bigint)
RETURNS TABLE (token_hash bytea, entry jsonb, removed boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE d offline_snapshot_draft%ROWTYPE;
BEGIN
  SELECT * INTO d FROM offline_snapshot_draft WHERE id = p_draft;
  IF NOT FOUND THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  PERFORM assert_tenant(d.operator_id);
  IF d.status NOT IN ('READY','PUBLISHED') THEN
    RAISE EXCEPTION 'Snapshot : brouillon % non prêt (%)', p_draft, d.status USING ERRCODE = 'CL048',
      DETAIL = 'DRAFT_NOT_READY';
  END IF;
  RETURN QUERY SELECT e.token_hash, e.entry, e.removed FROM offline_snapshot_entry e
                WHERE e.draft_id = d.id ORDER BY e.token_hash;
END $$;
REVOKE ALL ON FUNCTION offline_snapshot_draft_content(bigint) FROM PUBLIC;

-- Seule voie d'inscription dans offline_snapshot (OP-N57). Vérifie le brouillon READY, la version
-- (max + 1, chaîne contiguë), l'en-tête contre le grand livre, le brouillon et le contenu compté, puis
-- insère (le déclencheur offline_snapshot_check rejoue ses contrôles), met à jour l'état et le journal,
-- passe le brouillon à PUBLISHED et écrit l'audit SNAPSHOT_PUBLISHED (acteur = rôle de connexion du
-- signataire, qui n'a aucun droit d'audit, ADR-140). La signature n'est pas vérifiée par la base.
CREATE FUNCTION publish_offline_snapshot(p_draft bigint, p_key_id text, p_signature bytea)
RETURNS TABLE (ledger_id uuid, version bigint, kind text, generated_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE d offline_snapshot_draft%ROWTYPE; lg ledger%ROWTYPE; k snapshot_signing_key%ROWTYPE;
        h jsonb; v_max bigint; v_cnt bigint; v_live int; v_gone int; v_expected jsonb;
        kk text; vv jsonb; r offline_snapshot%ROWTYPE;
BEGIN
  d := offline_snapshot_draft_locked(p_draft, true);
  IF d.status <> 'READY' THEN
    RAISE EXCEPTION 'Snapshot : brouillon % non prêt à publier (%)', p_draft, d.status
      USING ERRCODE = 'CL048', DETAIL = 'DRAFT_NOT_READY';
  END IF;
  IF p_signature IS NULL OR octet_length(p_signature) = 0 OR p_key_id IS NULL OR p_key_id = '' THEN
    RAISE EXCEPTION 'Snapshot : signature ou identifiant de clé vide' USING ERRCODE = 'CL048',
      DETAIL = 'EMPTY_SIGNATURE';
  END IF;
  SELECT * INTO lg FROM ledger WHERE id = d.ledger_id;
  SELECT coalesce(max(version), 0), count(*) INTO v_max, v_cnt
    FROM offline_snapshot WHERE ledger_id = d.ledger_id;
  IF v_max <> v_cnt THEN
    RAISE EXCEPTION 'Snapshot : chaîne de versions rompue (max %, % publiées)', v_max, v_cnt
      USING ERRCODE = 'CL048', DETAIL = 'VERSION_CHAIN_BROKEN';
  END IF;
  IF d.version <> v_max + 1 THEN
    RAISE EXCEPTION 'Snapshot : version % réservée, la suivante est %', d.version, v_max + 1
      USING ERRCODE = 'CL048', DETAIL = 'VERSION_NOT_NEXT';
  END IF;
  IF lg.status = 'LOCKED' THEN
    RAISE EXCEPTION 'Snapshot : grand livre verrouillé' USING ERRCODE = 'CL048',
      DETAIL = 'LEDGER_NOT_SERVABLE';
  END IF;
  IF d.base_version IS DISTINCT FROM (CASE WHEN d.kind = 'DELTA' THEN v_max END) THEN
    RAISE EXCEPTION 'Snapshot : version de base % différente de la version précédente', d.base_version
      USING ERRCODE = 'CL048', DETAIL = 'BASE_NOT_PREVIOUS';
  END IF;
  IF offline_snapshot_header_ok(d.header) IS NOT TRUE THEN
    RAISE EXCEPTION 'Snapshot : en-tête mal formé (quinze champs exacts, types, dates, empreinte)'
      USING ERRCODE = 'CL048', DETAIL = 'HEADER_SHAPE';
  END IF;
  IF lg.authority_epoch IS DISTINCT FROM (d.header->>'authority_epoch')::int THEN
    RAISE EXCEPTION 'Snapshot : époque % différente de l''époque courante %',
      d.header->>'authority_epoch', lg.authority_epoch USING ERRCODE = 'CL015';
  END IF;
  SELECT * INTO k FROM snapshot_signing_key WHERE key_id = p_key_id;
  IF NOT FOUND OR k.status <> 'ACTIVE' OR k.owner <> 'CENTRAL'
     OR (k.operator_id IS NOT NULL AND k.operator_id <> d.operator_id)
     OR d.header->>'key_id' IS DISTINCT FROM p_key_id THEN
    RAISE EXCEPTION 'Snapshot : clé de signature % non utilisable ou différente de l''en-tête', p_key_id
      USING ERRCODE = 'CL048', DETAIL = 'KEY_NOT_USABLE';
  END IF;
  -- En-tête : quinze champs exactement, champs de la base égaux à la vérité courante.
  h := d.header;
  v_expected := jsonb_build_object('format', 'CASHLESS-SNAPSHOT/v1', 'operator_id', lg.operator_id,
                                   'ledger_id', lg.id, 'event_id', lg.scope_id,
                                   'currency', lg.currency::text, 'version', d.version,
                                   'base_version', d.base_version, 'kind', d.kind);
  FOR kk, vv IN SELECT * FROM jsonb_each(v_expected) LOOP
    IF h->kk IS DISTINCT FROM vv THEN
      RAISE EXCEPTION 'Snapshot : champ % de l''en-tête différent du brouillon ou du grand livre', kk
        USING ERRCODE = 'CL048', DETAIL = 'HEADER_MISMATCH';
    END IF;
  END LOOP;
  SELECT count(*) FILTER (WHERE NOT removed), count(*) FILTER (WHERE removed)
    INTO v_live, v_gone FROM offline_snapshot_entry WHERE draft_id = d.id;
  IF (v_live = (h->>'entries')::int AND v_gone = (h->>'removed')::int) IS NOT TRUE THEN
    RAISE EXCEPTION 'Snapshot : % entrées et % retirées en contenu, l''en-tête annonce % et %',
      v_live, v_gone, h->>'entries', h->>'removed' USING ERRCODE = 'CL048', DETAIL = 'COUNT_MISMATCH';
  END IF;

  INSERT INTO offline_snapshot (operator_id, ledger_id, event_id, kind, version, base_version,
                                generated_at, valid_until, entries, content_sha256, authority_epoch,
                                key_id, header, signature, content_key_wrapped)
  VALUES (d.operator_id, d.ledger_id, lg.scope_id, d.kind, d.version, d.base_version,
          (h->>'generated_at')::timestamptz, (h->>'valid_until')::timestamptz, v_live,
          decode(h->>'content_sha256', 'hex'), lg.authority_epoch, p_key_id, h, p_signature,
          d.content_key_wrapped)
  RETURNING * INTO r;

  INSERT INTO offline_snapshot_state (ledger_id, token_hash, entry_sha256, last_version, removed,
                                      operator_id)
  SELECT e.ledger_id, e.token_hash, offline_snapshot_entry_sha256(e.entry), e.version, e.removed,
         e.operator_id
    FROM offline_snapshot_entry e WHERE e.draft_id = d.id
  ON CONFLICT (ledger_id, token_hash) DO UPDATE
    SET entry_sha256 = EXCLUDED.entry_sha256, last_version = EXCLUDED.last_version,
        removed = EXCLUDED.removed;

  INSERT INTO offline_snapshot_media_log (ledger_id, version, token_hash, media_status, batch_status,
                                          batch_event_id, wallet_status, in_snapshot, operator_id)
  SELECT e.ledger_id, e.version, e.token_hash, e.entry->>'status', e.entry->>'batch_status',
         (e.entry->>'batch_event_id')::uuid, e.entry->>'wallet_status', NOT e.removed, e.operator_id
    FROM offline_snapshot_entry e WHERE e.draft_id = d.id;

  UPDATE offline_snapshot_draft SET status = 'PUBLISHED' WHERE id = d.id;

  INSERT INTO audit_log (operator_id, actor_id, actor_role, action, object_type, object_id, after,
                         origin)
  VALUES (d.operator_id, NULL, session_user::text, 'SNAPSHOT_PUBLISHED', 'offline_snapshot',
          d.version::text,
          jsonb_build_object('ledger_id', d.ledger_id, 'version', d.version, 'kind', d.kind,
                             'entries', v_live, 'removed', v_gone, 'key_id', p_key_id,
                             'content_sha256', h->>'content_sha256', 'draft_id', d.id),
          'snapshot-signer');
  RETURN QUERY SELECT r.ledger_id, r.version, r.kind, r.generated_at;
END $$;
REVOKE ALL ON FUNCTION publish_offline_snapshot(bigint, text, bytea) FROM PUBLIC;

-- Supprime le contenu des versions antérieures à l'avant-dernier FULL publié (rien s'il y a moins de
-- deux FULL) et celui des brouillons abandonnés. Garde offline_snapshot, le journal et l'état (R-05).
CREATE FUNCTION purge_offline_snapshot_content(p_ledger uuid) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_keep bigint; v_n int := 0; v_m int;
BEGIN
  PERFORM assert_tenant(tenant_of_ledger(p_ledger));
  SELECT o.version INTO v_keep FROM offline_snapshot o
   WHERE o.ledger_id = p_ledger AND o.kind = 'FULL' ORDER BY o.version DESC OFFSET 1 LIMIT 1;
  IF v_keep IS NOT NULL THEN
    DELETE FROM offline_snapshot_entry WHERE ledger_id = p_ledger AND version < v_keep;
    GET DIAGNOSTICS v_n = ROW_COUNT;
  END IF;
  DELETE FROM offline_snapshot_entry e USING offline_snapshot_draft d
   WHERE e.draft_id = d.id AND d.ledger_id = p_ledger AND d.status = 'DISCARDED';
  GET DIAGNOSTICS v_m = ROW_COUNT;
  RETURN v_n + v_m;
END $$;
REVOKE ALL ON FUNCTION purge_offline_snapshot_content(uuid) FROM PUBLIC;
