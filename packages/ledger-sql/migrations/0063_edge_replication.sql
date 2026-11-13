-- Migration 0063 : réplication côté base (mission passerelle-locale, lot WP08 ; FR-008, FR-009, FR-036, NFR-010,
-- NFR-011, C-009 ; contracts/interfaces.md § 1, § 2, § 12 et § 13 (font foi) ; contracts/replication-page-additions.yaml ;
-- research R-08, R-15, R-24 ; constats A02, A03, A16, A18, A22, A25, A26 du plan contradictoire).
--
-- Contenu
--   1. Garde « propriétaire seul » des tables nouvelles ; REVOKE aux rôles `cashless_*` (les droits viennent de WP09).
--   2. Tables : edge_pwd_pack_key, edge_pwd_pack (colis chiffrés, une clé de contenu PAR passerelle), edge_staff_token_audit
--      (immuable), edge_replication_horizon (dernier horizon sûr, par grand livre). Vue edge_device_seq_acked.
--   3. Journal `edge_reference_change` (table créée en 0058, vide) : NUMEROTATION et DECLENCHEURS (cette migration).
--   4. Fonctions : edge_replication_page, edge_record_staff_token_audit, deposit_edge_pwd_pack, deposit_edge_pwd_pack_key,
--      mark_edge_gateways_silent, edge_gateways_awaiting_pack (§ 12.5).
--
-- ---------------------------------------------------------------------------------------------------------------
-- LISTE EXACTE DES DECLENCHEURS DU JOURNAL (tables d'origine ; aucun `.sql` généré modifié : déclencheurs AJOUTES ici)
-- Tous sont des CONSTRAINT TRIGGER `DEFERRABLE INITIALLY DEFERRED` (exécutés au COMMIT, voir « numérotation »), sauf
-- celui de `ledger` (immédiat, verrou pris en cours de transaction). Un déclencheur ne porte QUE sur les colonnes servies (`UPDATE OF ...` plus `WHEN` sur la
-- différence réelle) : aucune colonne chaude (`last_seen_at`, `last_seq`, `contiguous_*`, `last_counter`...) n'en déclenche.
--   ledger                 AFTER INSERT (scope EVENT)                      -> EVENT       (amorce d'un grand livre neuf)
--   event                  UPDATE OF status, name, currency, timezone, activation_modes, jurisdiction_id, et les neuf
--                          réglages de terminal (online_connect_timeout_ms ... tap_replay_window_seconds) -> EVENT
--   jurisdiction_profile   UPDATE OF max_wallet_balance, unidentified_max_balance, identified_monthly_limit,
--                          unidentified_monthly_limit                                          -> EVENT (événements du profil)
--   wallet                 INSERT ; UPDATE OF status, customer_id                              -> WALLET_STATE
--   kyc_verification       INSERT ; UPDATE OF status, revoked_at, id_expires_on, customer_id, wallet_id
--                                                                      -> WALLET_STATE (portefeuilles du client)
--   media                  INSERT ; UPDATE OF status, batch_id, wallet_id   -> MEDIA (rattaché) ou UNASSIGNED_MEDIA
--   media_assignment       INSERT ; UPDATE OF released_at                                      -> MEDIA / UNASSIGNED_MEDIA
--   media_batch            UPDATE OF status, event_id                     -> MEDIA / UNASSIGNED_MEDIA (bracelets du lot)
--   device                 INSERT ; UPDATE OF status, public_key, cert_sha256, agreement_public_key, pos_id, station_name,
--                          event_id, app_mode, os, nfc_enabled, kind, serial                   -> DEVICE
--   cash_desk              INSERT                                                              -> DEVICE
--   point_of_sale          UPDATE OF name, participation_id                      -> DEVICE (terminaux du point de vente)
--   device_config_served   INSERT (une ligne par configuration effectivement changée)         -> DEVICE_CONFIG
--   cash_session           INSERT ; UPDATE OF status, closed_at                                -> CASH_SESSION
--   vendor                 INSERT ; UPDATE OF status, locked_at, display_name, merchant_id    -> VENDOR
--   merchant_participation INSERT                                    -> VENDOR (vendeurs du commerçant)
--   vendor_session         INSERT ; UPDATE OF closed_at                                        -> VENDOR_SESSION
--   app_user               UPDATE OF status, issuer, subject                                   -> STAFF
--   role_assignment        INSERT ; UPDATE OF revoked_at, role, scope_type, scope_id (CASHIER, SUPERVISOR) -> STAFF
--   catalog_version        INSERT                                                              -> CATALOG (id = point de vente)
--   device_refresh_token   UPDATE OF edge_exposed, consumed_at, revoked_at (ligne exposée seulement)       -> DEVICE
--   edge_gateway           INSERT ; UPDATE OF role, status, role_changed_at, event_id, lan_url, agreement_public_key
--                                                                                              -> GATEWAY (A03, A25)
-- Reprise de l'existant (T034, amorce) : à la fin de cette migration, `edge_ref_backfill` verse au journal, pour CHAQUE
-- grand livre d'événement existant, une ligne par entité de référence déjà présente (événement, passerelles,
-- terminaux, configurations, sessions de caisse, vendeurs, sessions vendeur, personnes, catalogues, portefeuilles,
-- bracelets). Un grand livre neuf reçoit une ligne `EVENT` du déclencheur de `ledger`. Aucun grand livre n'a donc un
-- journal vide (un journal vide fait REFUSER l'accord d'autorité, `edge_grant_authority` de 0059 : échec fermé).
-- Une copie complète (`after_change_seq = 0`) se lit ainsi dans le journal, par pages, comme n'importe quelle reprise.
--
-- NUMEROTATION. `edge_ref_emit_many` prend le verrou consultatif transactionnel `edge-reference:<grand livre>`,
-- puis écrit `max(change_seq) + 1`. Les déclencheurs étant DIFFERES (sauf `edge_ref_ledger`), le verrou est pris au COMMIT
-- et tenu jusqu'à la fin de celui-ci : l'ordre des numéros est l'ordre de validation, aucun saut possible, aucun trou pour une
-- transaction lente ; et comme le verrou n'est pas pris pendant la transaction, il ne peut pas former de cycle avec
-- des verrous de lignes. Limite : une session `REPEATABLE READ` qui écrirait une entité de référence ne verrait pas la ligne
-- du journal d'un pair validé après son instantané (clé primaire en double, 23505, l'appel est à rejouer) ;
-- les écritures applicatives sont en READ COMMITTED. Une transaction qui touche deux grands livres peut, en théorie, les
-- verrouiller dans deux ordres différents : PostgreSQL détecte le cycle (40P01) et l'une des deux est à rejouer.
--
-- HORIZON (A18). Les `posting.id` sont attribués avant la validation, et toute écriture tient le verrou PARTAGE
-- `debit-authority:<grand livre>` jusqu'à sa validation. `edge_replication_page` prend le verrou EXCLUSIF de même clé que
-- `grant_edge_authority` (`lock_timeout` 200 ms, niveau session, relâché aussitôt après `SELECT max(id) FROM posting`) :
-- plus aucune écriture de ce grand livre n'est en vol à cet instant. Piège traité : l'instantané REPEATABLE READ de l'appelant
-- précède le verrou ; une écriture qui valide pendant l'attente est INVISIBLE de l'instantané, et `max(id)` pourrait alors
-- dépasser un `id` plus bas non vu. La fonction compare donc l'instantané à la fin des transactions en vol qu'il
-- liste (`pg_snapshot_xip` + `pg_xact_status`) : une seule validée depuis suffit à déclarer l'horizon NON SÛR. Verrou non
-- obtenu ou horizon non sûr : l'horizon PRECEDENT est servi (table `edge_replication_horizon`, monotone). `to_posting_id`
-- ne dépasse jamais l'horizon. Les soldes servis sont ceux de l'instantané (donc cohérents avec `edge_seq_applied`) et
-- peuvent inclure des écritures au-delà de `to_posting_id` : la page suivante les redonne, sans effet (état, pas delta).
--
-- SOURCE DU DELAI DES COLIS (A16). `pack_delay_seconds` de `edge_platform_setting`, lu par `edge_setting_value`
-- (0061), sans paramètre de configuration ; aucune écriture dans la table (seul `set_edge_setting` écrit).
--
-- ORDRE DES VERROUS. Page : verrou exclusif `debit-authority` (bref, relâché) ; puis, pour la mise à jour de
-- `reference_applied_seq`, la ligne `edge_gateway` (UPDATE). Journal : verrou `edge-reference` au COMMIT (sauf `edge_ref_ledger`, en cours de transaction).
-- Dépôts de colis : ligne `edge_gateway` FOR SHARE, puis lignes de colis.
--
-- COHERENCE REPEATABLE READ. `edge_replication_page` doit être appelée dans une transaction REPEATABLE READ (ou plus
-- stricte) : sinon CL001. Son UPDATE de `edge_gateway.reference_applied_seq` peut échouer en 40001 si la ligne a
-- changé depuis l'instantané (`touch_edge_gateway` l'écrit à chaque appel) : l'API rejoue la requête.
--
-- Aucun GRANT. Toutes les fonctions : SECURITY DEFINER, search_path = public, pg_temp, EXECUTE retiré à PUBLIC.
-- A GRANTER par WP09 : edge_replication_page, edge_record_staff_token_audit (cashless_edge) ; deposit_edge_pwd_pack,
-- deposit_edge_pwd_pack_key, edge_gateways_awaiting_pack (cashless_tagkeys) ; mark_edge_gateways_silent (maintenance) ;
-- SELECT sur la vue edge_device_seq_acked (cashless_edge, lecture étroite). A NE JAMAIS GRANTER : edge_ref_emit_many,
-- edge_ref_emit_media_set, edge_ref_backfill, edge_ref_trigger, edge_ref_event_ledger, edge_ref_scope_ledgers,
-- edge_ref_staff_ledgers, edge_ref_ctx_enter, edge_ref_ctx_leave, edge_owner_only_guard, edge_forbid_truncate, edge_ts, edge_b64.
--
-- JETON D'APPAREIL (décision 11, OP-N102 ; décision 23 du porteur, cycle 2). Colonne `device_refresh_token.edge_exposed`
-- (boolean NOT NULL DEFAULT false) : vraie quand l'empreinte du jeton de la famille est réputée copiée sur un site.
-- `devices[].token_family` = {fid, status, refresh_token_sha256_current} (empreinte SHA-256 seulement, JAMAIS le jeton), servi
-- UNIQUEMENT à une passerelle PRIMARY non révoquée, pour la ligne EXPOSEE la plus récente de la famille d'un terminal de son
-- prestataire et de son événement ; null sinon. Celui qui POSE `edge_exposed` à true n'est PAS cette migration (aucun
-- GRANT, aucune fonction d'écriture) : c'est l'API centrale (lots WP12/WP19), avant la première réplication de l'empreinte et
-- au renouvellement ; le retour (rotation forcée) relève du même lot. Tant qu'elle n'est pas posée, token_family reste null.
-- Un changement de `edge_exposed`, de `consumed_at` ou de `revoked_at` d'une ligne exposée émet une ligne DEVICE au journal.
--
-- REGLE DDL (décision 28). `migrate.ts` exécute TOUTES les migrations dans UNE transaction (BEGIN puis COMMIT). Les
-- déclencheurs du journal sont différés : une migration future qui ÉCRIT une table à déclencheur du journal (liste ci-dessus)
-- puis fait un ALTER TABLE / CREATE INDEX / DROP sur elle échoue (« cannot ALTER TABLE ... because it has pending
-- trigger events »). Règle : `SET CONSTRAINTS ALL IMMEDIATE;` avant tout DDL qui suit une écriture dans la même
-- transaction. Un simple correctif de données est sûr : le journal se remplit au COMMIT.
-- NB : `edge_ref_ledger` (AFTER INSERT ON ledger) est IMMEDIAT, pas différé : il prend le verrou `edge-reference` du grand
-- livre neuf EN COURS de transaction (sans danger : ce grand livre n'a pas de pair), à la différence de tous les autres.
--
-- A faire relire par une personne (CLAUDE.md, règle 4) : edge_replication_page (frontière de cloisonnement),
-- deposit_edge_pwd_pack* (colis chiffrés), edge_ref_trigger et les déclencheurs sur les tables chaudes.

-- 0. Colonne du jeton d'appareil (décision 23). Avant toute écriture de cette migration (règle DDL ci-dessus).
ALTER TABLE device_refresh_token ADD COLUMN edge_exposed boolean NOT NULL DEFAULT false;

-- 1. Gardes -----------------------------------------------------------------------------------------------------
-- Garde indépendante des droits (roles.sql / post-roles.sql redonnent arw à cashless_app sur toutes les tables) : refuse
-- toute écriture dont current_user n'est pas le propriétaire de la table (modèle 0061). Les fonctions DEFINER passent.
CREATE FUNCTION edge_owner_only_guard() RETURNS trigger LANGUAGE plpgsql
SET search_path = public, pg_temp AS $$
BEGIN
  IF current_user::text <> (SELECT pg_get_userbyid(c.relowner) FROM pg_class c WHERE c.oid = TG_RELID) THEN
    RAISE EXCEPTION '% : écriture réservée aux fonctions de la base', TG_TABLE_NAME USING ERRCODE = '42501';
  END IF;
  RETURN CASE WHEN TG_OP = 'TRUNCATE' THEN NULL WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
REVOKE ALL ON FUNCTION edge_owner_only_guard() FROM PUBLIC;

CREATE FUNCTION edge_forbid_truncate() RETURNS trigger LANGUAGE plpgsql
SET search_path = public, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'Table % en ajout seul : vidage interdit', TG_TABLE_NAME USING ERRCODE = '42501';
END $$;
REVOKE ALL ON FUNCTION edge_forbid_truncate() FROM PUBLIC;

-- Outils de format (JSON de la page).
CREATE FUNCTION edge_ts(p timestamptz) RETURNS text LANGUAGE sql IMMUTABLE
SET search_path = public, pg_temp AS $$
  SELECT CASE WHEN p IS NULL THEN NULL ELSE to_char(p AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END
$$;
REVOKE ALL ON FUNCTION edge_ts(timestamptz) FROM PUBLIC;
-- Base64 standard SANS retours à la ligne (encode(.., 'base64') en insère tous les 76 caractères).
CREATE FUNCTION edge_b64(p bytea) RETURNS text LANGUAGE sql IMMUTABLE
SET search_path = public, pg_temp AS $$
  SELECT CASE WHEN p IS NULL THEN NULL ELSE translate(encode(p, 'base64'), E'\n', '') END
$$;
REVOKE ALL ON FUNCTION edge_b64(bytea) FROM PUBLIC;

-- 2. Tables -----------------------------------------------------------------------------------------------------
-- Clé de contenu PAR passerelle, scellée pour `edge_gateway.agreement_public_key` (jamais pour un terminal).
CREATE TABLE edge_pwd_pack_key (
  gateway_id           uuid PRIMARY KEY REFERENCES edge_gateway(id),
  operator_id          uuid NOT NULL REFERENCES party(id),
  agreement_key_sha256 bytea NOT NULL CHECK (octet_length(agreement_key_sha256) = 32),
  wrapped_key          jsonb NOT NULL CHECK (jsonb_typeof(wrapped_key) = 'object'),
  created_at           timestamptz NOT NULL DEFAULT clock_timestamp()
);
-- Colis chiffrés (AES-256-GCM sous la clé de contenu de la passerelle ; jamais en clair, jamais de clé maître).
-- `agreement_key_sha256` (ajout de ce lot) lie le colis à la clé d'accord pour laquelle la clé de contenu a été scellée :
-- changer la clé d'accord de la passerelle rend les anciens colis inservables.
CREATE TABLE edge_pwd_pack (
  gateway_id           uuid NOT NULL REFERENCES edge_gateway(id),
  media_id             uuid NOT NULL REFERENCES media(id),
  operator_id          uuid NOT NULL REFERENCES party(id),
  pwd_pack_enc         bytea NOT NULL CHECK (octet_length(pwd_pack_enc) BETWEEN 28 AND 256),
  pwd_pack_sha256      bytea NOT NULL CHECK (octet_length(pwd_pack_sha256) = 32),
  media_version        bigint NOT NULL CHECK (media_version >= 0),
  agreement_key_sha256 bytea NOT NULL CHECK (octet_length(agreement_key_sha256) = 32),
  created_at           timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (gateway_id, media_id)
);
CREATE INDEX edge_pwd_pack_media_idx ON edge_pwd_pack (media_id);
-- Audit immuable de la tolérance des jetons de personne expirés (décision 18).
CREATE TABLE edge_staff_token_audit (
  gateway_id          uuid NOT NULL REFERENCES edge_gateway(id),
  batch_id            uuid NOT NULL REFERENCES edge_sync_batch(batch_id),
  edge_seq            bigint NOT NULL CHECK (edge_seq >= 1),
  operator_id         uuid NOT NULL REFERENCES party(id),
  at                  timestamptz NOT NULL,
  subject             text NOT NULL CHECK (length(subject) BETWEEN 1 AND 512),
  issuer              text NOT NULL CHECK (length(issuer) BETWEEN 1 AND 512),
  jti                 text NOT NULL CHECK (length(jti) BETWEEN 1 AND 512),
  seconds_past_expiry integer NOT NULL CHECK (seconds_past_expiry >= 1),
  route               text NOT NULL CHECK (route IN ('activateMedia', 'takeDeposit', 'createCashTopup')),
  device_serial       text NOT NULL CHECK (length(device_serial) BETWEEN 1 AND 128),
  cash_session_id     uuid,
  received_at         timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (gateway_id, batch_id, edge_seq)
);
-- Dernier horizon SÛR des postings, par grand livre (monotone).
CREATE TABLE edge_replication_horizon (
  ledger_id   uuid PRIMARY KEY REFERENCES ledger(id),
  operator_id uuid NOT NULL REFERENCES party(id),
  horizon     bigint NOT NULL CHECK (horizon >= 0),
  updated_at  timestamptz NOT NULL DEFAULT clock_timestamp()
);

DO $$
DECLARE t text; r text;
BEGIN
  FOREACH t IN ARRAY ARRAY['edge_pwd_pack_key', 'edge_pwd_pack', 'edge_staff_token_audit', 'edge_replication_horizon',
                           'edge_reference_change'] LOOP
    IF t <> 'edge_reference_change' THEN
      EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
      EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
      EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (operator_id = current_setting(%L, true)::uuid)',
                     t, 'app.operator_id');
    END IF;
    -- Aucun droit d'écriture pour aucun rôle applicatif (des REVOKE seulement, aucun GRANT : WP09).
    EXECUTE format('REVOKE ALL ON %I FROM PUBLIC', t);
    FOR r IN SELECT rolname FROM pg_roles WHERE rolname LIKE 'cashless\_%' ESCAPE '\' LOOP
      EXECUTE format('REVOKE ALL ON %I FROM %I', t, r);
    END LOOP;
    -- roles.sql / post-roles.sql redonnent des droits par défaut à cashless_app : déclencheur de refus.
    EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH STATEMENT EXECUTE FUNCTION edge_owner_only_guard()',
                   t || '_owner_only', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION edge_owner_only_guard()',
                   t || '_owner_only_truncate', t);
  END LOOP;
END $$;

-- Tables en ajout seul : le journal et l'audit.
CREATE TRIGGER edge_reference_change_immutable BEFORE UPDATE OR DELETE ON edge_reference_change
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER edge_reference_change_no_truncate BEFORE TRUNCATE ON edge_reference_change
  FOR EACH STATEMENT EXECUTE FUNCTION edge_forbid_truncate();
CREATE TRIGGER edge_staff_token_audit_immutable BEFORE UPDATE OR DELETE ON edge_staff_token_audit
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER edge_staff_token_audit_no_truncate BEFORE TRUNCATE ON edge_staff_token_audit
  FOR EACH STATEMENT EXECUTE FUNCTION edge_forbid_truncate();

-- La politique du journal (0058) n'autorisait l'écriture qu'au prestataire courant ; les déclencheurs inter-prestataires
-- (profil de juridiction) posent le drapeau local `app.edge_journal_write`, que seules les fonctions de cette migration posent.
ALTER POLICY tenant_isolation ON edge_reference_change
  USING (operator_id = current_setting('app.operator_id', true)::uuid)
  WITH CHECK (operator_id = current_setting('app.operator_id', true)::uuid
              OR current_setting('app.edge_journal_write', true) = 'on');

-- Vue étroite des numéros de terminal (base de getDeviceSeqStatus, FR-026) : les terminaux de l'événement de la
-- passerelle appelante (app.gateway_id), rien d'autre. Aucun droit ici (WP09 : SELECT à cashless_edge).
CREATE VIEW edge_device_seq_acked AS
  SELECT d.id AS device_id,
         d.contiguous_acked_seq,
         d.last_seq AS max_seen_seq,
         coalesce((SELECT array_agg(q.s ORDER BY q.s)
                     FROM (SELECT s FROM generate_series(d.contiguous_acked_seq + 1, d.last_seq) s
                            WHERE NOT EXISTS (SELECT 1 FROM device_seq_registry r WHERE r.device_id = d.id AND r.seq = s)
                            ORDER BY s LIMIT 1000) q), '{}'::bigint[]) AS missing_seqs,
         d.next_seq_floor,
         clock_timestamp() AS as_of
    FROM device d
   WHERE d.event_id = (SELECT g.event_id FROM edge_gateway g
                        WHERE g.id = nullif(current_setting('app.gateway_id', true), '')::uuid
                          AND g.status <> 'REVOKED')
     AND d.operator_id = (SELECT g.operator_id FROM edge_gateway g
                           WHERE g.id = nullif(current_setting('app.gateway_id', true), '')::uuid);
DO $$
DECLARE r text;
BEGIN
  REVOKE ALL ON edge_device_seq_acked FROM PUBLIC;
  FOR r IN SELECT rolname FROM pg_roles WHERE rolname LIKE 'cashless\_%' ESCAPE '\' LOOP
    EXECUTE format('REVOKE ALL ON edge_device_seq_acked FROM %I', r);
  END LOOP;
END $$;

-- 3. Journal : émission et déclencheurs ---------------------------------------------------------------------------
-- Grand livre de l'événement (devise de l'événement).
CREATE FUNCTION edge_ref_event_ledger(p_event uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT l.id FROM ledger l JOIN event e ON e.id = l.scope_id AND l.currency = e.currency
   WHERE l.scope_type = 'EVENT' AND l.scope_id = p_event
$$;
REVOKE ALL ON FUNCTION edge_ref_event_ledger(uuid) FROM PUBLIC;

-- Grands livres touchés par un rôle d'affectation (EVENT : celui de l'événement ; ORGANIZER : ceux de ses événements).
CREATE FUNCTION edge_ref_scope_ledgers(p_scope_type text, p_scope_id uuid) RETURNS SETOF uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF p_scope_type = 'EVENT' THEN
    RETURN QUERY SELECT edge_ref_event_ledger(p_scope_id) WHERE edge_ref_event_ledger(p_scope_id) IS NOT NULL;
  ELSIF p_scope_type = 'ORGANIZER' THEN
    RETURN QUERY SELECT l.id FROM event e JOIN ledger l ON l.scope_type = 'EVENT' AND l.scope_id = e.id AND l.currency = e.currency
                  WHERE e.organizer_id = p_scope_id ORDER BY l.id;
  END IF;
END $$;
REVOKE ALL ON FUNCTION edge_ref_scope_ledgers(text, uuid) FROM PUBLIC;

CREATE FUNCTION edge_ref_staff_ledgers(p_user uuid) RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT DISTINCT s FROM role_assignment ra, LATERAL edge_ref_scope_ledgers(ra.scope_type, ra.scope_id) s
   WHERE ra.user_id = p_user AND ra.role IN ('CASHIER', 'SUPERVISOR') ORDER BY s
$$;
REVOKE ALL ON FUNCTION edge_ref_staff_ledgers(uuid) FROM PUBLIC;

-- Contexte de prestataire des déclencheurs (les lectures de résolution passent sous la RLS forcée).
CREATE FUNCTION edge_ref_ctx_enter(p_operator uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v text := current_setting('app.operator_id', true);
BEGIN
  IF p_operator IS NOT NULL THEN
    PERFORM set_config('app.operator_id', p_operator::text, true);
  END IF;
  RETURN v;
END $$;
REVOKE ALL ON FUNCTION edge_ref_ctx_enter(uuid) FROM PUBLIC;
CREATE FUNCTION edge_ref_ctx_leave(p_prev text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM set_config('app.operator_id', coalesce(p_prev, ''), true);
END $$;
REVOKE ALL ON FUNCTION edge_ref_ctx_leave(text) FROM PUBLIC;

-- Émission : numérotation sous verrou par grand livre (voir l'en-tête). Ne fait rien pour un grand livre qui n'est pas
-- celui d'un événement. Les identifiants en double dans l'appel sont versés une seule fois.
CREATE FUNCTION edge_ref_emit_many(p_ledger uuid, p_kind text, p_ids uuid[]) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_op uuid; v_flag text;
BEGIN
  IF p_ledger IS NULL OR p_ids IS NULL OR cardinality(p_ids) = 0 THEN RETURN; END IF;
  SELECT l.operator_id INTO v_op FROM ledger l WHERE l.id = p_ledger AND l.scope_type = 'EVENT';
  IF NOT FOUND THEN RETURN; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('edge-reference:' || p_ledger::text, 0));
  v_flag := current_setting('app.edge_journal_write', true);
  PERFORM set_config('app.edge_journal_write', 'on', true);
  INSERT INTO edge_reference_change (ledger_id, change_seq, operator_id, entity_kind, entity_id)
  SELECT p_ledger, base.m + row_number() OVER (ORDER BY u.id), v_op, p_kind, u.id
    FROM (SELECT DISTINCT x AS id FROM unnest(p_ids) x WHERE x IS NOT NULL) u,
         (SELECT coalesce(max(c.change_seq), 0) AS m FROM edge_reference_change c WHERE c.ledger_id = p_ledger) base;
  PERFORM set_config('app.edge_journal_write', coalesce(v_flag, ''), true);
END $$;
REVOKE ALL ON FUNCTION edge_ref_emit_many(uuid, text, uuid[]) FROM PUBLIC;

-- Bracelets : MEDIA (rattaché dans un grand livre d'événement) ou UNASSIGNED_MEDIA (lot d'un événement, non rattaché).
CREATE FUNCTION edge_ref_emit_media_set(p_media uuid[]) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r record;
BEGIN
  IF p_media IS NULL OR cardinality(p_media) = 0 THEN RETURN; END IF;
  FOR r IN
    SELECT q.ledger_id, q.kind, array_agg(q.media_id) AS ids
      FROM (SELECT w.ledger_id, 'MEDIA'::text AS kind, m.id AS media_id
              FROM media m JOIN media_assignment ma ON ma.media_id = m.id AND ma.released_at IS NULL
              JOIN wallet w ON w.id = ma.wallet_id
             WHERE m.id = ANY (p_media)
            UNION ALL
            SELECT edge_ref_event_ledger(b.event_id), 'UNASSIGNED_MEDIA', m.id
              FROM media m JOIN media_batch b ON b.id = m.batch_id
             WHERE m.id = ANY (p_media) AND b.event_id IS NOT NULL
               AND NOT EXISTS (SELECT 1 FROM media_assignment ma WHERE ma.media_id = m.id AND ma.released_at IS NULL)) q
     WHERE q.ledger_id IS NOT NULL
     GROUP BY q.ledger_id, q.kind ORDER BY q.ledger_id, q.kind
  LOOP
    PERFORM edge_ref_emit_many(r.ledger_id, r.kind, r.ids);
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION edge_ref_emit_media_set(uuid[]) FROM PUBLIC;

-- Reprise de l'existant d'UN grand livre d'événement (migration, et rattrapage manuel d'un grand livre sans journal).
CREATE FUNCTION edge_ref_backfill(p_ledger uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE lg ledger%ROWTYPE; v_prev text;
BEGIN
  SELECT * INTO lg FROM ledger WHERE id = p_ledger AND scope_type = 'EVENT';
  IF NOT FOUND THEN RETURN; END IF;
  v_prev := edge_ref_ctx_enter(lg.operator_id);
  PERFORM edge_ref_emit_many(lg.id, 'EVENT', ARRAY[lg.scope_id]);
  PERFORM edge_ref_emit_many(lg.id, 'GATEWAY', ARRAY(SELECT g.id FROM edge_gateway g WHERE g.event_id = lg.scope_id));
  PERFORM edge_ref_emit_many(lg.id, 'DEVICE', ARRAY(SELECT d.id FROM device d WHERE d.event_id = lg.scope_id));
  PERFORM edge_ref_emit_many(lg.id, 'DEVICE_CONFIG',
    ARRAY(SELECT DISTINCT c.device_id FROM device_config_served c JOIN device d ON d.id = c.device_id
           WHERE d.event_id = lg.scope_id));
  PERFORM edge_ref_emit_many(lg.id, 'CASH_SESSION', ARRAY(SELECT s.cash_session_id FROM cash_session s WHERE s.ledger_id = lg.id));
  PERFORM edge_ref_emit_many(lg.id, 'VENDOR',
    ARRAY(SELECT v.id FROM vendor v WHERE EXISTS (SELECT 1 FROM merchant_participation mp
                                                   WHERE mp.event_id = lg.scope_id AND mp.merchant_id = v.merchant_id)));
  PERFORM edge_ref_emit_many(lg.id, 'VENDOR_SESSION',
    ARRAY(SELECT vs.id FROM vendor_session vs JOIN device d ON d.id = vs.device_id WHERE d.event_id = lg.scope_id));
  PERFORM edge_ref_emit_many(lg.id, 'STAFF',
    ARRAY(SELECT DISTINCT ra.user_id FROM role_assignment ra
           WHERE ra.role IN ('CASHIER', 'SUPERVISOR')
             AND ((ra.scope_type = 'EVENT' AND ra.scope_id = lg.scope_id)
                  OR (ra.scope_type = 'ORGANIZER' AND ra.scope_id = (SELECT e.organizer_id FROM event e WHERE e.id = lg.scope_id)))));
  PERFORM edge_ref_emit_many(lg.id, 'CATALOG',
    ARRAY(SELECT DISTINCT pos.id FROM point_of_sale pos JOIN merchant_participation mp ON mp.id = pos.participation_id
           WHERE mp.event_id = lg.scope_id AND EXISTS (SELECT 1 FROM catalog_version cv WHERE cv.pos_id = pos.id)));
  PERFORM edge_ref_emit_many(lg.id, 'WALLET_STATE', ARRAY(SELECT w.id FROM wallet w WHERE w.ledger_id = lg.id));
  PERFORM edge_ref_emit_media_set(ARRAY(
    SELECT m.id FROM media m JOIN media_batch b ON b.id = m.batch_id WHERE b.event_id = lg.scope_id
    UNION
    SELECT ma.media_id FROM media_assignment ma JOIN wallet w ON w.id = ma.wallet_id
     WHERE ma.released_at IS NULL AND w.ledger_id = lg.id));
  PERFORM edge_ref_ctx_leave(v_prev);
END $$;
REVOKE ALL ON FUNCTION edge_ref_backfill(uuid) FROM PUBLIC;

-- Fonction de déclenchement unique, aiguillée par la table.
CREATE FUNCTION edge_ref_trigger() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_prev text; r record; v_row jsonb := to_jsonb(NEW);
BEGIN
  v_prev := edge_ref_ctx_enter(nullif(v_row ->> 'operator_id', '')::uuid);
  CASE TG_TABLE_NAME
    WHEN 'ledger' THEN
      PERFORM edge_ref_emit_many(NEW.id, 'EVENT', ARRAY[NEW.scope_id]);
    WHEN 'event' THEN
      PERFORM edge_ref_emit_many(edge_ref_event_ledger(NEW.id), 'EVENT', ARRAY[NEW.id]);
    WHEN 'jurisdiction_profile' THEN
      FOR r IN SELECT l.id AS ledger_id, l.scope_id FROM ledger l JOIN event e ON e.id = l.scope_id
                WHERE l.scope_type = 'EVENT' AND e.jurisdiction_id = NEW.id ORDER BY l.id LOOP
        PERFORM edge_ref_emit_many(r.ledger_id, 'EVENT', ARRAY[r.scope_id]);
      END LOOP;
    WHEN 'wallet' THEN
      PERFORM edge_ref_emit_many(NEW.ledger_id, 'WALLET_STATE', ARRAY[NEW.id]);
    WHEN 'kyc_verification' THEN
      FOR r IN SELECT w.id, w.ledger_id FROM wallet w WHERE w.customer_id = NEW.customer_id ORDER BY w.ledger_id, w.id LOOP
        PERFORM edge_ref_emit_many(r.ledger_id, 'WALLET_STATE', ARRAY[r.id]);
      END LOOP;
    WHEN 'media' THEN
      PERFORM edge_ref_emit_media_set(ARRAY[NEW.id]);
    WHEN 'media_assignment' THEN
      PERFORM edge_ref_emit_media_set(ARRAY[NEW.media_id]);
      IF NEW.released_at IS NOT NULL THEN
        PERFORM edge_ref_emit_many((SELECT w.ledger_id FROM wallet w WHERE w.id = NEW.wallet_id), 'MEDIA', ARRAY[NEW.media_id]);
      END IF;
    WHEN 'media_batch' THEN
      PERFORM edge_ref_emit_media_set(ARRAY(SELECT m.id FROM media m WHERE m.batch_id = NEW.id));
    WHEN 'device' THEN
      PERFORM edge_ref_emit_many(edge_ref_event_ledger(NEW.event_id), 'DEVICE', ARRAY[NEW.id]);
      IF TG_OP = 'UPDATE' AND OLD.event_id IS NOT NULL AND OLD.event_id IS DISTINCT FROM NEW.event_id THEN
        PERFORM edge_ref_emit_many(edge_ref_event_ledger(OLD.event_id), 'DEVICE', ARRAY[NEW.id]);
      END IF;
    WHEN 'cash_desk' THEN
      PERFORM edge_ref_emit_many(NEW.ledger_id, 'DEVICE', ARRAY[NEW.device_id]);
    WHEN 'point_of_sale' THEN
      FOR r IN SELECT d.id, d.event_id FROM device d WHERE d.pos_id = NEW.id AND d.event_id IS NOT NULL ORDER BY d.event_id, d.id LOOP
        PERFORM edge_ref_emit_many(edge_ref_event_ledger(r.event_id), 'DEVICE', ARRAY[r.id]);
      END LOOP;
    WHEN 'device_config_served' THEN
      PERFORM edge_ref_emit_many(edge_ref_event_ledger((SELECT d.event_id FROM device d WHERE d.id = NEW.device_id)),
                                 'DEVICE_CONFIG', ARRAY[NEW.device_id]);
    WHEN 'cash_session' THEN
      PERFORM edge_ref_emit_many(NEW.ledger_id, 'CASH_SESSION', ARRAY[NEW.cash_session_id]);
    WHEN 'vendor' THEN
      FOR r IN SELECT DISTINCT edge_ref_event_ledger(mp.event_id) AS ledger_id FROM merchant_participation mp
                WHERE mp.merchant_id = NEW.merchant_id ORDER BY 1 LOOP
        PERFORM edge_ref_emit_many(r.ledger_id, 'VENDOR', ARRAY[NEW.id]);
      END LOOP;
    WHEN 'merchant_participation' THEN
      PERFORM edge_ref_emit_many(edge_ref_event_ledger(NEW.event_id), 'VENDOR',
                                 ARRAY(SELECT v.id FROM vendor v WHERE v.merchant_id = NEW.merchant_id));
    WHEN 'vendor_session' THEN
      PERFORM edge_ref_emit_many(edge_ref_event_ledger((SELECT d.event_id FROM device d WHERE d.id = NEW.device_id)),
                                 'VENDOR_SESSION', ARRAY[NEW.id]);
    WHEN 'app_user' THEN
      FOR r IN SELECT s AS ledger_id FROM edge_ref_staff_ledgers(NEW.id) s LOOP
        PERFORM edge_ref_emit_many(r.ledger_id, 'STAFF', ARRAY[NEW.id]);
      END LOOP;
    WHEN 'role_assignment' THEN
      IF NEW.role IN ('CASHIER', 'SUPERVISOR') THEN
        FOR r IN SELECT s AS ledger_id FROM edge_ref_scope_ledgers(NEW.scope_type, NEW.scope_id) s LOOP
          PERFORM edge_ref_emit_many(r.ledger_id, 'STAFF', ARRAY[NEW.user_id]);
        END LOOP;
      END IF;
    WHEN 'catalog_version' THEN
      FOR r IN SELECT DISTINCT edge_ref_event_ledger(mp.event_id) AS ledger_id
                 FROM point_of_sale pos JOIN merchant_participation mp ON mp.id = pos.participation_id
                WHERE pos.id = NEW.pos_id ORDER BY 1 LOOP
        PERFORM edge_ref_emit_many(r.ledger_id, 'CATALOG', ARRAY[NEW.pos_id]);
      END LOOP;
    WHEN 'edge_gateway' THEN
      PERFORM edge_ref_emit_many(edge_ref_event_ledger(NEW.event_id), 'GATEWAY', ARRAY[NEW.id]);
    WHEN 'device_refresh_token' THEN
      PERFORM edge_ref_emit_many(edge_ref_event_ledger((SELECT d.event_id FROM device d WHERE d.id = NEW.device_id)),
                                 'DEVICE', ARRAY[NEW.device_id]);
    ELSE
      RAISE EXCEPTION 'edge_ref_trigger : table inattendue %', TG_TABLE_NAME;
  END CASE;
  PERFORM edge_ref_ctx_leave(v_prev);
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION edge_ref_trigger() FROM PUBLIC;

-- Grand livre neuf : amorce immédiate (une ligne EVENT), non différée.
CREATE TRIGGER edge_ref_ledger AFTER INSERT ON ledger
  FOR EACH ROW WHEN (NEW.scope_type = 'EVENT') EXECUTE FUNCTION edge_ref_trigger();

CREATE CONSTRAINT TRIGGER edge_ref_event AFTER UPDATE OF status, name, currency, timezone, activation_modes, jurisdiction_id,
    online_connect_timeout_ms, online_total_timeout_ms, online_retries, pending_sync_seconds, reconcile_sync_seconds,
    heartbeat_seconds, reversal_window_minutes, local_retention_days, tap_replay_window_seconds
  ON event DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status OR OLD.name IS DISTINCT FROM NEW.name
        OR OLD.currency IS DISTINCT FROM NEW.currency OR OLD.timezone IS DISTINCT FROM NEW.timezone
        OR OLD.activation_modes IS DISTINCT FROM NEW.activation_modes
        OR OLD.jurisdiction_id IS DISTINCT FROM NEW.jurisdiction_id
        OR OLD.online_connect_timeout_ms IS DISTINCT FROM NEW.online_connect_timeout_ms
        OR OLD.online_total_timeout_ms IS DISTINCT FROM NEW.online_total_timeout_ms
        OR OLD.online_retries IS DISTINCT FROM NEW.online_retries
        OR OLD.pending_sync_seconds IS DISTINCT FROM NEW.pending_sync_seconds
        OR OLD.reconcile_sync_seconds IS DISTINCT FROM NEW.reconcile_sync_seconds
        OR OLD.heartbeat_seconds IS DISTINCT FROM NEW.heartbeat_seconds
        OR OLD.reversal_window_minutes IS DISTINCT FROM NEW.reversal_window_minutes
        OR OLD.local_retention_days IS DISTINCT FROM NEW.local_retention_days
        OR OLD.tap_replay_window_seconds IS DISTINCT FROM NEW.tap_replay_window_seconds)
  EXECUTE FUNCTION edge_ref_trigger();

CREATE CONSTRAINT TRIGGER edge_ref_jurisdiction AFTER UPDATE OF max_wallet_balance, unidentified_max_balance,
    identified_monthly_limit, unidentified_monthly_limit
  ON jurisdiction_profile DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  WHEN (OLD.max_wallet_balance IS DISTINCT FROM NEW.max_wallet_balance
        OR OLD.unidentified_max_balance IS DISTINCT FROM NEW.unidentified_max_balance
        OR OLD.identified_monthly_limit IS DISTINCT FROM NEW.identified_monthly_limit
        OR OLD.unidentified_monthly_limit IS DISTINCT FROM NEW.unidentified_monthly_limit)
  EXECUTE FUNCTION edge_ref_trigger();

CREATE CONSTRAINT TRIGGER edge_ref_wallet_ins AFTER INSERT ON wallet
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION edge_ref_trigger();
CREATE CONSTRAINT TRIGGER edge_ref_wallet_upd AFTER UPDATE OF status, customer_id ON wallet
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status OR OLD.customer_id IS DISTINCT FROM NEW.customer_id)
  EXECUTE FUNCTION edge_ref_trigger();

CREATE CONSTRAINT TRIGGER edge_ref_kyc_ins AFTER INSERT ON kyc_verification
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION edge_ref_trigger();
CREATE CONSTRAINT TRIGGER edge_ref_kyc_upd AFTER UPDATE OF status, revoked_at, id_expires_on, customer_id, wallet_id
  ON kyc_verification DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status OR OLD.revoked_at IS DISTINCT FROM NEW.revoked_at
        OR OLD.id_expires_on IS DISTINCT FROM NEW.id_expires_on OR OLD.customer_id IS DISTINCT FROM NEW.customer_id
        OR OLD.wallet_id IS DISTINCT FROM NEW.wallet_id)
  EXECUTE FUNCTION edge_ref_trigger();

CREATE CONSTRAINT TRIGGER edge_ref_media_ins AFTER INSERT ON media
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION edge_ref_trigger();
CREATE CONSTRAINT TRIGGER edge_ref_media_upd AFTER UPDATE OF status, batch_id, wallet_id ON media
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status OR OLD.batch_id IS DISTINCT FROM NEW.batch_id
        OR OLD.wallet_id IS DISTINCT FROM NEW.wallet_id)
  EXECUTE FUNCTION edge_ref_trigger();

CREATE CONSTRAINT TRIGGER edge_ref_media_assignment_ins AFTER INSERT ON media_assignment
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION edge_ref_trigger();
CREATE CONSTRAINT TRIGGER edge_ref_media_assignment_upd AFTER UPDATE OF released_at ON media_assignment
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (OLD.released_at IS DISTINCT FROM NEW.released_at)
  EXECUTE FUNCTION edge_ref_trigger();

CREATE CONSTRAINT TRIGGER edge_ref_media_batch AFTER UPDATE OF status, event_id ON media_batch
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status OR OLD.event_id IS DISTINCT FROM NEW.event_id)
  EXECUTE FUNCTION edge_ref_trigger();

CREATE CONSTRAINT TRIGGER edge_ref_device_ins AFTER INSERT ON device
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION edge_ref_trigger();
CREATE CONSTRAINT TRIGGER edge_ref_device_upd AFTER UPDATE OF status, public_key, cert_sha256, agreement_public_key, pos_id,
    station_name, event_id, app_mode, os, nfc_enabled, kind, serial
  ON device DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status OR OLD.public_key IS DISTINCT FROM NEW.public_key
        OR OLD.cert_sha256 IS DISTINCT FROM NEW.cert_sha256
        OR OLD.agreement_public_key IS DISTINCT FROM NEW.agreement_public_key
        OR OLD.pos_id IS DISTINCT FROM NEW.pos_id OR OLD.station_name IS DISTINCT FROM NEW.station_name
        OR OLD.event_id IS DISTINCT FROM NEW.event_id OR OLD.app_mode IS DISTINCT FROM NEW.app_mode
        OR OLD.os IS DISTINCT FROM NEW.os OR OLD.nfc_enabled IS DISTINCT FROM NEW.nfc_enabled
        OR OLD.kind IS DISTINCT FROM NEW.kind OR OLD.serial IS DISTINCT FROM NEW.serial)
  EXECUTE FUNCTION edge_ref_trigger();

CREATE CONSTRAINT TRIGGER edge_ref_refresh_token AFTER UPDATE OF edge_exposed, consumed_at, revoked_at
  ON device_refresh_token DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  WHEN ((OLD.edge_exposed OR NEW.edge_exposed)
        AND (OLD.edge_exposed IS DISTINCT FROM NEW.edge_exposed OR OLD.consumed_at IS DISTINCT FROM NEW.consumed_at
             OR OLD.revoked_at IS DISTINCT FROM NEW.revoked_at))
  EXECUTE FUNCTION edge_ref_trigger();

CREATE CONSTRAINT TRIGGER edge_ref_cash_desk AFTER INSERT ON cash_desk
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION edge_ref_trigger();
CREATE CONSTRAINT TRIGGER edge_ref_pos AFTER UPDATE OF name, participation_id ON point_of_sale
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  WHEN (OLD.name IS DISTINCT FROM NEW.name OR OLD.participation_id IS DISTINCT FROM NEW.participation_id)
  EXECUTE FUNCTION edge_ref_trigger();
CREATE CONSTRAINT TRIGGER edge_ref_device_config AFTER INSERT ON device_config_served
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION edge_ref_trigger();

CREATE CONSTRAINT TRIGGER edge_ref_cash_session_ins AFTER INSERT ON cash_session
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION edge_ref_trigger();
CREATE CONSTRAINT TRIGGER edge_ref_cash_session_upd AFTER UPDATE OF status, closed_at ON cash_session
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status OR OLD.closed_at IS DISTINCT FROM NEW.closed_at)
  EXECUTE FUNCTION edge_ref_trigger();

CREATE CONSTRAINT TRIGGER edge_ref_vendor_ins AFTER INSERT ON vendor
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION edge_ref_trigger();
CREATE CONSTRAINT TRIGGER edge_ref_vendor_upd AFTER UPDATE OF status, locked_at, display_name, merchant_id ON vendor
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status OR OLD.locked_at IS DISTINCT FROM NEW.locked_at
        OR OLD.display_name IS DISTINCT FROM NEW.display_name OR OLD.merchant_id IS DISTINCT FROM NEW.merchant_id)
  EXECUTE FUNCTION edge_ref_trigger();
CREATE CONSTRAINT TRIGGER edge_ref_participation AFTER INSERT ON merchant_participation
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION edge_ref_trigger();

CREATE CONSTRAINT TRIGGER edge_ref_vendor_session_ins AFTER INSERT ON vendor_session
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION edge_ref_trigger();
CREATE CONSTRAINT TRIGGER edge_ref_vendor_session_upd AFTER UPDATE OF closed_at ON vendor_session
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (OLD.closed_at IS DISTINCT FROM NEW.closed_at)
  EXECUTE FUNCTION edge_ref_trigger();

CREATE CONSTRAINT TRIGGER edge_ref_app_user AFTER UPDATE OF status, issuer, subject ON app_user
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status OR OLD.issuer IS DISTINCT FROM NEW.issuer
        OR OLD.subject IS DISTINCT FROM NEW.subject)
  EXECUTE FUNCTION edge_ref_trigger();
CREATE CONSTRAINT TRIGGER edge_ref_role_ins AFTER INSERT ON role_assignment
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW.role IN ('CASHIER', 'SUPERVISOR'))
  EXECUTE FUNCTION edge_ref_trigger();
CREATE CONSTRAINT TRIGGER edge_ref_role_upd AFTER UPDATE OF revoked_at, role, scope_type, scope_id ON role_assignment
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  WHEN ((NEW.role IN ('CASHIER', 'SUPERVISOR') OR OLD.role IN ('CASHIER', 'SUPERVISOR'))
        AND (OLD.revoked_at IS DISTINCT FROM NEW.revoked_at OR OLD.role IS DISTINCT FROM NEW.role
             OR OLD.scope_type IS DISTINCT FROM NEW.scope_type OR OLD.scope_id IS DISTINCT FROM NEW.scope_id))
  EXECUTE FUNCTION edge_ref_trigger();

CREATE CONSTRAINT TRIGGER edge_ref_catalog AFTER INSERT ON catalog_version
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION edge_ref_trigger();

CREATE CONSTRAINT TRIGGER edge_ref_gateway_ins AFTER INSERT ON edge_gateway
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION edge_ref_trigger();
CREATE CONSTRAINT TRIGGER edge_ref_gateway_upd AFTER UPDATE OF role, status, role_changed_at, event_id, lan_url,
    agreement_public_key
  ON edge_gateway DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  WHEN (OLD.role IS DISTINCT FROM NEW.role OR OLD.status IS DISTINCT FROM NEW.status
        OR OLD.role_changed_at IS DISTINCT FROM NEW.role_changed_at OR OLD.event_id IS DISTINCT FROM NEW.event_id
        OR OLD.lan_url IS DISTINCT FROM NEW.lan_url
        OR OLD.agreement_public_key IS DISTINCT FROM NEW.agreement_public_key)
  EXECUTE FUNCTION edge_ref_trigger();

-- Reprise de l'existant (amorce) : chaque grand livre d'événement existant reçoit son journal.
DO $$
DECLARE l record;
BEGIN
  FOR l IN SELECT id FROM ledger WHERE scope_type = 'EVENT' ORDER BY id LOOP
    PERFORM edge_ref_backfill(l.id);
  END LOOP;
END $$;

-- 4. Colis de mots de passe ---------------------------------------------------------------------------------------
-- Le processus des clés produit les colis (clé de contenu par passerelle) ; ces fonctions ne CHIFFRENT rien et ne lisent
-- aucune clé maître (C-009). Aucun GRANT ici : WP09 les accorde à cashless_tagkeys seul.
CREATE FUNCTION deposit_edge_pwd_pack_key(p_gateway uuid, p_agreement_key_sha256 bytea, p_wrapped jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE g edge_gateway%ROWTYPE; old edge_pwd_pack_key%ROWTYPE;
BEGIN
  SELECT * INTO g FROM edge_gateway WHERE id = p_gateway;
  IF NOT FOUND THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  PERFORM assert_tenant(g.operator_id);
  SELECT * INTO g FROM edge_gateway WHERE id = p_gateway FOR SHARE;
  IF g.status = 'REVOKED' THEN
    RAISE EXCEPTION 'Clé de colis : passerelle révoquée' USING ERRCODE = 'CL001';
  END IF;
  IF p_agreement_key_sha256 IS NULL OR octet_length(p_agreement_key_sha256) <> 32 THEN
    RAISE EXCEPTION 'Clé de colis : empreinte de 32 octets exigée' USING ERRCODE = 'CL001';
  END IF;
  IF g.agreement_public_key IS NULL OR p_agreement_key_sha256 <> sha256(g.agreement_public_key) THEN
    RAISE EXCEPTION 'Clé de colis : empreinte différente de la clé d''accord de la passerelle' USING ERRCODE = 'CL001';
  END IF;
  IF p_wrapped IS NULL OR jsonb_typeof(p_wrapped) <> 'object'
     OR p_wrapped ->> 'alg' IS DISTINCT FROM 'ECDH-ES+HKDF-SHA256+A256GCM'
     OR coalesce(jsonb_typeof(p_wrapped -> 'epk'), '') <> 'string' OR coalesce(jsonb_typeof(p_wrapped -> 'iv'), '') <> 'string'
     OR coalesce(jsonb_typeof(p_wrapped -> 'wrapped_key'), '') <> 'string'
     OR length(p_wrapped::text) > 4096 THEN
    RAISE EXCEPTION 'Clé de colis : enveloppe invalide' USING ERRCODE = 'CL001';
  END IF;
  SELECT * INTO old FROM edge_pwd_pack_key WHERE gateway_id = p_gateway FOR UPDATE;
  IF FOUND THEN
    IF old.agreement_key_sha256 = p_agreement_key_sha256 THEN
      IF old.wrapped_key = p_wrapped THEN RETURN; END IF;                       -- rejeu identique
      RAISE EXCEPTION 'Clé de colis : une clé de contenu existe déjà pour cette clé d''accord' USING ERRCODE = 'CL002';
    END IF;
    -- Clé d'accord changée : l'ancienne clé de contenu et ses colis ne sont plus servis.
    DELETE FROM edge_pwd_pack WHERE gateway_id = p_gateway;
    UPDATE edge_pwd_pack_key SET agreement_key_sha256 = p_agreement_key_sha256, wrapped_key = p_wrapped,
           created_at = clock_timestamp() WHERE gateway_id = p_gateway;
    RETURN;
  END IF;
  INSERT INTO edge_pwd_pack_key (gateway_id, operator_id, agreement_key_sha256, wrapped_key)
  VALUES (p_gateway, g.operator_id, p_agreement_key_sha256, p_wrapped);
END $$;
REVOKE ALL ON FUNCTION deposit_edge_pwd_pack_key(uuid, bytea, jsonb) FROM PUBLIC;

CREATE FUNCTION deposit_edge_pwd_pack(p_gateway uuid, p_media uuid, p_pack bytea, p_pack_sha256 bytea, p_media_version bigint)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE g edge_gateway%ROWTYPE; k edge_pwd_pack_key%ROWTYPE; m media%ROWTYPE; v_ok boolean;
BEGIN
  SELECT * INTO g FROM edge_gateway WHERE id = p_gateway;
  IF NOT FOUND THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  PERFORM assert_tenant(g.operator_id);
  SELECT * INTO g FROM edge_gateway WHERE id = p_gateway FOR SHARE;
  IF g.status = 'REVOKED' THEN
    RAISE EXCEPTION 'Colis : passerelle révoquée' USING ERRCODE = 'CL001';
  END IF;
  SELECT * INTO m FROM media WHERE id = p_media;
  IF NOT FOUND OR m.operator_id <> g.operator_id THEN
    RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found';
  END IF;
  -- Le bracelet doit être du MEME événement : lot de l'événement, ou rattaché à un portefeuille de son grand livre.
  SELECT EXISTS (SELECT 1 FROM media_batch b WHERE b.id = m.batch_id AND b.event_id = g.event_id)
      OR EXISTS (SELECT 1 FROM media_assignment ma JOIN wallet w ON w.id = ma.wallet_id
                  WHERE ma.media_id = m.id AND ma.released_at IS NULL AND w.ledger_id = edge_ref_event_ledger(g.event_id))
    INTO v_ok;
  IF NOT v_ok THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  IF p_pack IS NULL OR octet_length(p_pack) < 28 OR octet_length(p_pack) > 256 THEN
    RAISE EXCEPTION 'Colis : longueur invalide' USING ERRCODE = 'CL001';
  END IF;
  IF p_pack_sha256 IS NULL OR octet_length(p_pack_sha256) <> 32 THEN
    RAISE EXCEPTION 'Colis : empreinte de 32 octets exigée' USING ERRCODE = 'CL001';
  END IF;
  IF sha256(p_pack) <> p_pack_sha256 THEN
    RAISE EXCEPTION 'Colis : empreinte différente du contenu' USING ERRCODE = 'CL001';
  END IF;
  IF p_media_version IS NULL OR p_media_version < 0 THEN
    RAISE EXCEPTION 'Colis : version invalide' USING ERRCODE = 'CL001';
  END IF;
  SELECT * INTO k FROM edge_pwd_pack_key WHERE gateway_id = p_gateway;
  IF NOT FOUND OR g.agreement_public_key IS NULL OR k.agreement_key_sha256 <> sha256(g.agreement_public_key) THEN
    RAISE EXCEPTION 'Colis : clé de contenu absente ou périmée pour cette passerelle' USING ERRCODE = 'CL001';
  END IF;
  INSERT INTO edge_pwd_pack (gateway_id, media_id, operator_id, pwd_pack_enc, pwd_pack_sha256, media_version,
                             agreement_key_sha256)
  VALUES (p_gateway, p_media, g.operator_id, p_pack, p_pack_sha256, p_media_version, k.agreement_key_sha256)
  ON CONFLICT (gateway_id, media_id) DO UPDATE
     SET pwd_pack_enc = EXCLUDED.pwd_pack_enc, pwd_pack_sha256 = EXCLUDED.pwd_pack_sha256,
         media_version = EXCLUDED.media_version, agreement_key_sha256 = EXCLUDED.agreement_key_sha256,
         created_at = clock_timestamp()
   WHERE EXCLUDED.media_version > edge_pwd_pack.media_version
      OR edge_pwd_pack.agreement_key_sha256 <> EXCLUDED.agreement_key_sha256;
END $$;
REVOKE ALL ON FUNCTION deposit_edge_pwd_pack(uuid, uuid, bytea, bytea, bigint) FROM PUBLIC;

-- Passerelles qui attendent des colis (§ 12.5) : PRIMARY non révoquée, délai de l'enrôlement ou de la promotion écoulé
-- (aucun colis n'est même produit avant), et clé de contenu absente/périmée OU au moins un bracelet de l'événement sans
-- colis de la clé courante. Sans prestataire en contexte : tous (processus des clés) ; avec : le sien seulement.
CREATE FUNCTION edge_gateways_awaiting_pack(p_limit int)
RETURNS TABLE (gateway_id uuid, event_id uuid, agreement_public_key bytea)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_delay bigint; v_op uuid := nullif(current_setting('app.operator_id', true), '')::uuid;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 1000 THEN
    RAISE EXCEPTION 'Colis : limite entre 1 et 1000' USING ERRCODE = 'CL001';
  END IF;
  v_delay := coalesce(edge_setting_value('pack_delay_seconds', 'XOF'), 1800);
  RETURN QUERY
  SELECT g.id, g.event_id, g.agreement_public_key
    FROM edge_gateway g
   WHERE g.role = 'PRIMARY' AND g.status <> 'REVOKED' AND g.agreement_public_key IS NOT NULL
     AND (v_op IS NULL OR g.operator_id = v_op)
     AND coalesce(g.role_changed_at, g.registered_at) + make_interval(secs => v_delay) <= clock_timestamp()
     AND (NOT EXISTS (SELECT 1 FROM edge_pwd_pack_key k
                       WHERE k.gateway_id = g.id AND k.agreement_key_sha256 = sha256(g.agreement_public_key))
          OR EXISTS (SELECT 1 FROM media m
                      WHERE m.pwd_pack_enc IS NOT NULL AND m.operator_id = g.operator_id
                        AND (EXISTS (SELECT 1 FROM media_batch b WHERE b.id = m.batch_id AND b.event_id = g.event_id)
                             OR EXISTS (SELECT 1 FROM media_assignment ma JOIN wallet w ON w.id = ma.wallet_id
                                         WHERE ma.media_id = m.id AND ma.released_at IS NULL
                                           AND w.ledger_id = edge_ref_event_ledger(g.event_id)))
                        AND NOT EXISTS (SELECT 1 FROM edge_pwd_pack p
                                         WHERE p.gateway_id = g.id AND p.media_id = m.id
                                           AND p.agreement_key_sha256 = sha256(g.agreement_public_key))))
   ORDER BY g.id LIMIT p_limit;
END $$;
REVOKE ALL ON FUNCTION edge_gateways_awaiting_pack(int) FROM PUBLIC;

-- 5. Audit de la tolérance des jetons de personne ----------------------------------------------------------------
CREATE FUNCTION edge_record_staff_token_audit(p_gateway uuid, p_batch uuid, p_rows jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE g edge_gateway%ROWTYPE; b edge_sync_batch%ROWTYPE; r jsonb; v_seq bigint; v_n int := 0;
        v_at timestamptz; v_subject text; v_issuer text; v_jti text; v_secs int; v_route text; v_serial text;
        v_cash uuid; o edge_staff_token_audit%ROWTYPE; v_new boolean;
BEGIN
  g := edge_bind_gateway(p_gateway, false);
  SELECT * INTO b FROM edge_sync_batch WHERE batch_id = p_batch AND gateway_id = p_gateway;
  IF NOT FOUND THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'Audit des jetons : tableau attendu' USING ERRCODE = 'CL001';
  END IF;
  IF jsonb_array_length(p_rows) > 500 THEN
    RAISE EXCEPTION 'Audit des jetons : au plus 500 lignes' USING ERRCODE = 'check_violation';
  END IF;
  FOR r IN SELECT x FROM jsonb_array_elements(p_rows) x LOOP
    IF jsonb_typeof(r) <> 'object' OR coalesce(jsonb_typeof(r -> 'edge_seq'), '') <> 'number'
       OR coalesce(jsonb_typeof(r -> 'seconds_past_expiry'), '') <> 'number' THEN
      RAISE EXCEPTION 'Audit des jetons : ligne invalide' USING ERRCODE = 'CL001';
    END IF;
    BEGIN
      v_seq := (r ->> 'edge_seq')::bigint; v_secs := (r ->> 'seconds_past_expiry')::int;
      v_at := (r ->> 'at')::timestamptz; v_cash := nullif(r ->> 'cash_session_id', '')::uuid;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'Audit des jetons : ligne invalide' USING ERRCODE = 'CL001';
    END;
    v_subject := r ->> 'subject'; v_issuer := r ->> 'issuer'; v_jti := r ->> 'jti';
    v_route := r ->> 'route'; v_serial := r ->> 'device_serial';
    IF v_at IS NULL OR coalesce(length(v_subject), 0) NOT BETWEEN 1 AND 512 OR coalesce(length(v_issuer), 0) NOT BETWEEN 1 AND 512
       OR coalesce(length(v_jti), 0) NOT BETWEEN 1 AND 512 OR v_secs < 1
       OR v_route IS NULL OR v_route NOT IN ('activateMedia', 'takeDeposit', 'createCashTopup')
       OR coalesce(length(v_serial), 0) NOT BETWEEN 1 AND 128 THEN
      RAISE EXCEPTION 'Audit des jetons : ligne invalide' USING ERRCODE = 'CL001';
    END IF;
    IF v_seq < b.edge_seq_from OR v_seq > b.edge_seq_to THEN
      RAISE EXCEPTION 'Audit des jetons : numéro % hors de l''intervalle du lot', v_seq USING ERRCODE = 'check_violation';
    END IF;
    INSERT INTO edge_staff_token_audit (gateway_id, batch_id, edge_seq, operator_id, at, subject, issuer, jti,
                                        seconds_past_expiry, route, device_serial, cash_session_id)
    VALUES (p_gateway, p_batch, v_seq, g.operator_id, v_at, v_subject, v_issuer, v_jti, v_secs, v_route, v_serial, v_cash)
    ON CONFLICT (gateway_id, batch_id, edge_seq) DO NOTHING;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_new := v_n = 1;
    IF NOT v_new THEN
      SELECT * INTO o FROM edge_staff_token_audit WHERE gateway_id = p_gateway AND batch_id = p_batch AND edge_seq = v_seq;
      IF (o.at, o.subject, o.issuer, o.jti, o.seconds_past_expiry, o.route, o.device_serial, o.cash_session_id)
         IS DISTINCT FROM (v_at, v_subject, v_issuer, v_jti, v_secs, v_route, v_serial, v_cash) THEN
        RAISE EXCEPTION 'Audit des jetons : numéro % déjà consigné avec un autre contenu', v_seq USING ERRCODE = 'CL002';
      END IF;
    ELSE
      -- Copie dans l'audit de la plateforme : jamais de jeton, seulement jti, sujet, émetteur.
      INSERT INTO audit_log (operator_id, actor_id, actor_role, action, object_type, object_id, after, origin)
      VALUES (g.operator_id, NULL, session_user::text, 'EDGE_STAFF_TOKEN_TOLERATED', 'EDGE_GATEWAY', p_gateway::text,
              jsonb_build_object('batch_id', p_batch, 'edge_seq', v_seq, 'subject', v_subject, 'issuer', v_issuer,
                                 'jti', v_jti, 'seconds_past_expiry', v_secs, 'route', v_route,
                                 'device_serial', v_serial, 'cash_session_id', v_cash),
              'edge');
    END IF;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION edge_record_staff_token_audit(uuid, uuid, jsonb) FROM PUBLIC;

-- 6. Silence des passerelles (R-15) ---------------------------------------------------------------------------------
-- ACTIVE sans signe de vie depuis p_threshold -> ISOLATED. ISOLATED ou CATCHING_UP revue depuis moins de p_threshold et sans
-- lot reçu depuis 60 s -> ACTIVE. Chaque passage est audité ; l'alerte EDGE_SILENT part au passage à ISOLATED si un
-- handover est ouvert. Ces états n'accordent AUCUN droit (invariant 9) : rien ici ni ailleurs ne les lit comme
-- condition d'autorité. Ne touche jamais REVOKED. Retour : nombre de passages (dans les deux sens). Processus de
-- maintenance, sans prestataire : lit toutes les passerelles (comme offline_snapshot_targets).
CREATE FUNCTION mark_edge_gateways_silent(p_threshold interval) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE g edge_gateway%ROWTYPE; v_n integer := 0; v_alert text;
BEGIN
  IF p_threshold IS NULL OR p_threshold <= interval '0' THEN
    RAISE EXCEPTION 'Silence : seuil strictement positif exigé' USING ERRCODE = 'CL001';
  END IF;
  FOR g IN SELECT * FROM edge_gateway
            WHERE status = 'ACTIVE' AND coalesce(last_seen_at, registered_at) < clock_timestamp() - p_threshold
            ORDER BY id FOR UPDATE SKIP LOCKED LOOP
    UPDATE edge_gateway SET status = 'ISOLATED' WHERE id = g.id AND status = 'ACTIVE';
    v_alert := CASE WHEN edge_event_handover_open(g.event_id) THEN 'EDGE_SILENT' END;
    PERFORM edge_admin_audit(g.operator_id, 'EDGE_GATEWAY_ISOLATED', g.id, 'mark_edge_gateways_silent',
                             jsonb_build_object('last_seen_at', g.last_seen_at), v_alert);
    v_n := v_n + 1;
  END LOOP;
  FOR g IN SELECT * FROM edge_gateway
            WHERE status IN ('ISOLATED', 'CATCHING_UP') AND last_seen_at >= clock_timestamp() - p_threshold
              AND NOT EXISTS (SELECT 1 FROM edge_sync_batch b
                               WHERE b.gateway_id = edge_gateway.id AND b.received_at > clock_timestamp() - interval '60 seconds')
            ORDER BY id FOR UPDATE SKIP LOCKED LOOP
    UPDATE edge_gateway SET status = 'ACTIVE' WHERE id = g.id AND status IN ('ISOLATED', 'CATCHING_UP');
    PERFORM edge_admin_audit(g.operator_id, 'EDGE_GATEWAY_LINK_RESTORED', g.id, 'mark_edge_gateways_silent',
                             jsonb_build_object('from', g.status), NULL);
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION mark_edge_gateways_silent(interval) FROM PUBLIC;

-- 7. Page de réplication ---------------------------------------------------------------------------------------------
CREATE FUNCTION edge_replication_page(p_gateway uuid, p_after_posting bigint, p_after_change bigint, p_limit int)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  g edge_gateway%ROWTYPE; lg ledger%ROWTYPE; ev event%ROWTYPE; k edge_pwd_pack_key%ROWTYPE;
  v_iso text := current_setting('transaction_isolation');
  v_servable boolean; v_keysha bytea; v_delay bigint;
  v_key bigint; v_prev bigint; v_max bigint; v_horizon bigint; v_locked boolean := false; v_stale boolean;
  v_lt text; v_horizon_safe boolean := false;
  v_lim int; v_pids bigint[]; v_more boolean; v_to bigint; v_wallets uuid[]; v_month timestamptz; v_today date;
  v_seqs bigint[]; v_kinds text[]; v_eids uuid[]; v_rmore boolean := false; v_rto bigint;
  v_media_ids uuid[]; v_ref_wallets uuid[]; v_cap bigint;
  v_wallets_json jsonb; v_media_json jsonb; v_ref jsonb; v_result jsonb; v_acked jsonb; v_exp smallint;
BEGIN
  IF v_iso NOT IN ('repeatable read', 'serializable') THEN
    RAISE EXCEPTION 'Réplication : transaction REPEATABLE READ exigée (niveau courant : %)', v_iso USING ERRCODE = 'CL001';
  END IF;
  IF p_after_posting IS NULL OR p_after_posting < 0 OR (p_after_change IS NOT NULL AND p_after_change < 0)
     OR p_limit IS NULL OR p_limit < 1 OR p_limit > 200 THEN
    RAISE EXCEPTION 'Réplication : curseurs positifs et limite entre 1 et 200' USING ERRCODE = 'CL001';
  END IF;
  g := edge_bind_gateway(p_gateway, false);              -- 42501 (autre passerelle, révoquée) ; no_data_found (autre prestataire)
  SELECT l.* INTO lg FROM ledger l WHERE l.id = edge_ledger_of_gateway(p_gateway);
  IF NOT FOUND THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  PERFORM assert_tenant(lg.operator_id);
  SELECT * INTO ev FROM event WHERE id = g.event_id;

  -- Colis servables : PRIMARY, non révoquée, délai écoulé depuis l'enrôlement ou la promotion, clé de contenu courante.
  v_delay := coalesce(edge_setting_value('pack_delay_seconds', 'XOF'), 1800);
  v_keysha := CASE WHEN g.agreement_public_key IS NULL THEN NULL ELSE sha256(g.agreement_public_key) END;
  SELECT * INTO k FROM edge_pwd_pack_key WHERE gateway_id = p_gateway;
  v_servable := g.role = 'PRIMARY' AND g.status <> 'REVOKED'
                AND coalesce(g.role_changed_at, g.registered_at) + make_interval(secs => v_delay) <= clock_timestamp()
                AND FOUND AND v_keysha IS NOT NULL AND k.agreement_key_sha256 = v_keysha;

  -- Horizon (A18).
  v_key := hashtextextended('debit-authority:' || lg.id::text, 0);
  SELECT horizon INTO v_prev FROM edge_replication_horizon WHERE ledger_id = lg.id;
  v_prev := coalesce(v_prev, 0);
  v_horizon := v_prev;
  v_lt := current_setting('lock_timeout');
  BEGIN
    PERFORM set_config('lock_timeout', '200ms', true);
    PERFORM pg_advisory_lock(v_key);
    v_locked := true;
    SELECT coalesce(max(id), 0) INTO v_max FROM posting;
    PERFORM pg_advisory_unlock(v_key);
    v_locked := false;
    -- L'instantané précède le verrou : une transaction en vol à l'instantané et validée depuis rend l'horizon non sûr.
    v_stale := EXISTS (SELECT 1 FROM pg_snapshot_xip(pg_current_snapshot()) x WHERE pg_xact_status(x) = 'committed');
    IF NOT v_stale THEN
      v_horizon := greatest(v_prev, v_max);
      v_horizon_safe := true;
    END IF;
  EXCEPTION
    WHEN lock_not_available THEN
      NULL;                                              -- verrou non obtenu : horizon précédent
    WHEN OTHERS THEN
      IF v_locked THEN PERFORM pg_advisory_unlock(v_key); END IF;
      PERFORM set_config('lock_timeout', v_lt, true);
      RAISE;
  END;
  PERFORM set_config('lock_timeout', v_lt, true);
  IF v_horizon_safe AND v_horizon > v_prev THEN
    INSERT INTO edge_replication_horizon (ledger_id, operator_id, horizon) VALUES (lg.id, lg.operator_id, v_horizon)
    ON CONFLICT (ledger_id) DO UPDATE SET horizon = greatest(edge_replication_horizon.horizon, EXCLUDED.horizon),
                                          updated_at = clock_timestamp();
  END IF;

  -- Preuve d'application du curseur de référence (A03) : seule écriture de la page, jamais au-delà du journal.
  IF p_after_change IS NOT NULL THEN
    SELECT least(p_after_change, coalesce(max(c.change_seq), 0)) INTO v_cap
      FROM edge_reference_change c WHERE c.ledger_id = lg.id;
    IF v_cap > g.reference_applied_seq THEN
      UPDATE edge_gateway SET reference_applied_seq = v_cap WHERE id = p_gateway;
    END IF;
  END IF;

  SELECT coalesce(e.exponent, 0) INTO v_exp FROM currency_exponent e WHERE e.code = ev.currency;
  v_today := (clock_timestamp() AT TIME ZONE 'UTC')::date;
  v_lim := p_limit;
  LOOP
    -- Soldes : portefeuilles dont une écriture a un posting.id dans ]after, to] (to <= horizon).
    SELECT array_agg(s.id ORDER BY s.id) INTO v_pids
      FROM (SELECT p.id FROM posting p JOIN account a ON a.id = p.account_id
             WHERE p.ledger_id = lg.id AND p.id > p_after_posting AND p.id <= v_horizon
               AND a.purpose IN ('WALLET_PAID', 'WALLET_PROMO')
             ORDER BY p.id LIMIT v_lim + 1) s;
    v_more := coalesce(cardinality(v_pids), 0) > v_lim;
    v_to := CASE WHEN v_more THEN v_pids[v_lim] ELSE greatest(p_after_posting, v_horizon) END;
    SELECT coalesce(array_agg(DISTINCT a.wallet_id), '{}') INTO v_wallets
      FROM posting p JOIN account a ON a.id = p.account_id
     WHERE p.ledger_id = lg.id AND p.id > p_after_posting AND p.id <= v_to
       AND a.purpose IN ('WALLET_PAID', 'WALLET_PROMO') AND a.wallet_id IS NOT NULL;

    -- Journal de référence (seulement si le curseur est fourni).
    v_ref := NULL; v_media_ids := '{}'; v_ref_wallets := '{}'; v_rmore := false; v_rto := NULL;
    IF p_after_change IS NOT NULL THEN
      SELECT array_agg(s.change_seq ORDER BY s.change_seq), array_agg(s.entity_kind ORDER BY s.change_seq),
             array_agg(s.entity_id ORDER BY s.change_seq)
        INTO v_seqs, v_kinds, v_eids
        FROM (SELECT c.change_seq, c.entity_kind, c.entity_id FROM edge_reference_change c
               WHERE c.ledger_id = lg.id AND c.change_seq > p_after_change
               ORDER BY c.change_seq LIMIT v_lim + 1) s;
      v_rmore := coalesce(cardinality(v_seqs), 0) > v_lim;
      IF v_rmore THEN
        v_seqs := v_seqs[1:v_lim]; v_kinds := v_kinds[1:v_lim]; v_eids := v_eids[1:v_lim];
      END IF;
      v_rto := coalesce(v_seqs[cardinality(v_seqs)], p_after_change);
      v_media_ids := coalesce(ARRAY(SELECT u.id FROM unnest(v_kinds, v_eids) AS u(kind, id) WHERE u.kind IN ('MEDIA', 'UNASSIGNED_MEDIA')), '{}');
      v_ref_wallets := coalesce(ARRAY(SELECT u.id FROM unnest(v_kinds, v_eids) AS u(kind, id) WHERE u.kind = 'WALLET_STATE'), '{}');
    END IF;

    -- Mois UTC de to_posting_id (même calcul que check_wallet_limits).
    SELECT date_trunc('month', coalesce((SELECT t.occurred_at FROM posting p JOIN journal_transaction t ON t.id = p.transaction_id
                                          WHERE p.id = v_to), clock_timestamp()) AT TIME ZONE 'UTC')
      INTO v_month;

    SELECT coalesce(jsonb_agg(jsonb_build_object(
             'wallet_id', w.id, 'status', w.status, 'paid', b.paid, 'promo', b.promo,
             'kyc_verified', wallet_kyc_level(w.id, v_today) = 'VERIFIED', 'topup_month_paid', t.total) ORDER BY w.id), '[]')
      INTO v_wallets_json
      FROM wallet w
      CROSS JOIN LATERAL (SELECT greatest(0, coalesce(-sum(ab.balance) FILTER (WHERE a.purpose = 'WALLET_PAID'), 0))::bigint AS paid,
                                 greatest(0, coalesce(-sum(ab.balance) FILTER (WHERE a.purpose = 'WALLET_PROMO'), 0))::bigint AS promo
                            FROM account a JOIN account_balance ab ON ab.account_id = a.id
                           WHERE a.wallet_id = w.id AND a.purpose IN ('WALLET_PAID', 'WALLET_PROMO')) b
      CROSS JOIN LATERAL (SELECT greatest(0, coalesce(-sum(p.amount), 0))::bigint AS total
                            FROM account a JOIN posting p ON p.account_id = a.id
                            JOIN journal_transaction jt ON jt.id = p.transaction_id
                           WHERE a.wallet_id = w.id AND a.purpose = 'WALLET_PAID' AND p.amount < 0
                             AND jt.type IN ('TOPUP', 'TOPUP_CASH')
                             AND date_trunc('month', jt.occurred_at AT TIME ZONE 'UTC') = v_month) t
     WHERE w.id = ANY (v_wallets) AND w.ledger_id = lg.id;

    -- Entrées de snapshot : bracelets des portefeuilles de la page et du journal, du grand livre de la passerelle.
    SELECT coalesce(jsonb_agg(jsonb_build_object(
             'token_hash', encode(r.token_hash, 'hex'), 'nfc_uid', encode(r.nfc_uid, 'hex'), 'key_index', r.key_index,
             'originality_sig_sha256', encode(r.originality_sig_sha256, 'hex'), 'status', r.status,
             'batch_event_id', r.batch_event_id, 'batch_status', r.batch_status, 'wallet_status', r.wallet_status,
             'spendable', greatest(0, r.spendable)::bigint, 'last_counter', r.last_counter,
             'pwd_pack_sha256', CASE WHEN v_servable THEN encode(p.pwd_pack_sha256, 'hex') END,
             'pwd_pack_enc', CASE WHEN v_servable AND p.media_id IS NOT NULL THEN jsonb_build_object(
                'nonce', edge_b64(substring(p.pwd_pack_enc FROM 1 FOR 12)),
                'ciphertext', edge_b64(substring(p.pwd_pack_enc FROM 13 FOR octet_length(p.pwd_pack_enc) - 28)),
                'tag', edge_b64(substring(p.pwd_pack_enc FROM octet_length(p.pwd_pack_enc) - 15 FOR 16))) END
           ) ORDER BY r.media_id), '[]')
      INTO v_media_json
      FROM offline_snapshot_rows r
      LEFT JOIN edge_pwd_pack p ON p.gateway_id = p_gateway AND p.media_id = r.media_id AND p.agreement_key_sha256 = v_keysha
     WHERE r.ledger_id = lg.id AND r.operator_id = g.operator_id
       AND (r.wallet_id = ANY (v_wallets) OR r.wallet_id = ANY (v_ref_wallets) OR r.media_id = ANY (v_media_ids));

    IF p_after_change IS NOT NULL THEN
      v_ref := jsonb_build_object('from_change_seq', p_after_change, 'to_change_seq', v_rto, 'has_more', v_rmore,
        'gateway', jsonb_build_object('gateway_id', g.id, 'role', g.role, 'status', g.status,
                                      'role_changed_at', edge_ts(g.role_changed_at)));
      IF p_after_change = 0 OR 'EVENT' = ANY (v_kinds) THEN
        v_ref := v_ref || jsonb_build_object('event', jsonb_build_object(
          'event_id', ev.id, 'name', ev.name, 'currency', ev.currency, 'minor_units', v_exp, 'timezone', ev.timezone,
          'status', ev.status::text, 'activation_modes', to_jsonb(ev.activation_modes),
          'terminal_settings', jsonb_build_object(
            'online_connect_timeout_ms', ev.online_connect_timeout_ms, 'online_total_timeout_ms', ev.online_total_timeout_ms,
            'online_retries', ev.online_retries, 'pending_sync_seconds', ev.pending_sync_seconds,
            'reconcile_sync_seconds', ev.reconcile_sync_seconds, 'heartbeat_seconds', ev.heartbeat_seconds,
            'reversal_window_minutes', ev.reversal_window_minutes, 'local_retention_days', ev.local_retention_days,
            'tap_replay_window_seconds', ev.tap_replay_window_seconds),
          'wallet_limits', (SELECT jsonb_build_object('max_wallet_balance', j.max_wallet_balance,
                              'unidentified_max_balance', j.unidentified_max_balance,
                              'identified_monthly_limit', j.identified_monthly_limit,
                              'unidentified_monthly_limit', j.unidentified_monthly_limit)
                              FROM ledger_jurisdiction(lg.id) j)));
      END IF;
      v_ref := v_ref || jsonb_build_object(
        'wallet_states', (SELECT coalesce(jsonb_agg(jsonb_build_object('wallet_id', w.id, 'status', w.status,
                            'kyc_verified', wallet_kyc_level(w.id, v_today) = 'VERIFIED') ORDER BY w.id), '[]')
                            FROM wallet w WHERE w.id = ANY (v_ref_wallets) AND w.ledger_id = lg.id),
        'devices', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                      'device_id', d.id, 'serial', d.serial, 'kind', d.kind, 'app_mode', d.app_mode, 'os', d.os,
                      'nfc_enabled', d.nfc_enabled, 'status', d.status, 'station_name', d.station_name,
                      'pos', CASE WHEN pos.id IS NULL THEN NULL ELSE jsonb_build_object(
                               'pos_id', pos.id, 'name', pos.name, 'merchant_name', m.legal_name) END,
                      'cash_desk_account_id', cd.account_id, 'public_key', edge_b64(d.public_key),
                      'cert_sha256', encode(d.cert_sha256, 'hex'), 'agreement_public_key', edge_b64(d.agreement_public_key),
                      'token_family', CASE WHEN tf.family_id IS NULL THEN NULL ELSE jsonb_build_object(
                         'fid', tf.family_id, 'status', CASE WHEN tf.consumed_at IS NULL AND tf.revoked_at IS NULL
                                                              AND tf.expires_at > clock_timestamp() THEN 'ACTIVE' ELSE 'REVOKED' END,
                         'refresh_token_sha256_current', encode(tf.token_hash, 'hex')) END) ORDER BY d.id), '[]')
                      FROM device d
                      LEFT JOIN LATERAL (SELECT r.family_id, r.token_hash, r.consumed_at, r.revoked_at, r.expires_at
                                           FROM device_refresh_token r
                                          WHERE r.device_id = d.id AND r.operator_id = g.operator_id AND r.edge_exposed
                                            AND g.role = 'PRIMARY' AND g.status <> 'REVOKED'
                                          ORDER BY r.created_at DESC, r.id DESC LIMIT 1) tf ON true
                      LEFT JOIN point_of_sale pos ON pos.id = d.pos_id
                      LEFT JOIN merchant_participation mp ON mp.id = pos.participation_id AND mp.event_id = g.event_id
                      LEFT JOIN party m ON m.id = mp.merchant_id
                      LEFT JOIN cash_desk cd ON cd.device_id = d.id AND cd.ledger_id = lg.id
                     WHERE d.id IN (SELECT u.id FROM unnest(v_kinds, v_eids) AS u(kind, id) WHERE u.kind = 'DEVICE')
                       AND d.event_id = g.event_id AND d.operator_id = g.operator_id
                       AND d.public_key IS NOT NULL AND d.cert_sha256 IS NOT NULL),
        'device_configs', (SELECT coalesce(jsonb_agg(jsonb_build_object('config_id', c.id, 'device_id', c.device_id,
                             'in_force', c.id = (SELECT max(c2.id) FROM device_config_served c2 WHERE c2.device_id = d.id),
                             'offline_policy', c.policy) ORDER BY c.id), '[]')
                             FROM device d JOIN device_config_served c ON c.device_id = d.id
                            WHERE d.id IN (SELECT u.id FROM unnest(v_kinds, v_eids) AS u(kind, id) WHERE u.kind = 'DEVICE_CONFIG')
                              AND d.event_id = g.event_id AND d.operator_id = g.operator_id
                              AND (c.id = (SELECT max(c2.id) FROM device_config_served c2 WHERE c2.device_id = d.id)
                                   OR c.served_at >= clock_timestamp() - make_interval(hours => ev.sync_deadline_hours + 24))),
        'cash_sessions', (SELECT coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                            'cash_session_id', s.cash_session_id, 'device_id', s.device_id, 'status', s.status,
                            'opened_by', s.opened_by, 'opened_at', edge_ts(s.opened_at), 'closed_at', edge_ts(s.closed_at)))
                            ORDER BY s.cash_session_id), '[]')
                            FROM cash_session s
                           WHERE s.cash_session_id IN (SELECT u.id FROM unnest(v_kinds, v_eids) AS u(kind, id) WHERE u.kind = 'CASH_SESSION')
                             AND s.ledger_id = lg.id AND s.operator_id = g.operator_id),
        'vendors', (SELECT coalesce(jsonb_agg(jsonb_build_object('vendor_id', v.id, 'display_name', v.display_name,
                      'status', v.status, 'locked', v.locked_at IS NOT NULL) ORDER BY v.id), '[]')
                      FROM vendor v
                     WHERE v.id IN (SELECT u.id FROM unnest(v_kinds, v_eids) AS u(kind, id) WHERE u.kind = 'VENDOR')
                       AND v.operator_id = g.operator_id
                       AND EXISTS (SELECT 1 FROM merchant_participation mp
                                    WHERE mp.event_id = g.event_id AND mp.merchant_id = v.merchant_id)),
        'vendor_sessions', (SELECT coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                              'vendor_session_id', vs.id, 'vendor_id', vs.vendor_id, 'device_id', vs.device_id,
                              'opened_at', edge_ts(vs.opened_at), 'expires_at', edge_ts(vs.expires_at),
                              'closed_at', edge_ts(vs.closed_at), 'closed_reason', vs.closed_reason)) ORDER BY vs.id), '[]')
                              FROM vendor_session vs JOIN device d ON d.id = vs.device_id
                             WHERE vs.id IN (SELECT u.id FROM unnest(v_kinds, v_eids) AS u(kind, id) WHERE u.kind = 'VENDOR_SESSION')
                               AND d.event_id = g.event_id AND vs.operator_id = g.operator_id),
        'staff', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                    'user_id', u.id, 'issuer', u.issuer, 'subject', u.subject, 'status', u.status,
                    'roles', coalesce((SELECT jsonb_agg(jsonb_build_object('role', ra.role, 'scope_type', ra.scope_type,
                                         'scope_id', ra.scope_id) ORDER BY ra.id)
                                         FROM role_assignment ra
                                        WHERE ra.user_id = u.id AND ra.revoked_at IS NULL AND ra.role IN ('CASHIER', 'SUPERVISOR')
                                          AND ((ra.scope_type = 'EVENT' AND ra.scope_id = g.event_id)
                                               OR (ra.scope_type = 'ORGANIZER' AND ra.scope_id = ev.organizer_id))), '[]'))
                    ORDER BY u.id), '[]')
                    FROM app_user u
                   WHERE u.id IN (SELECT x.id FROM unnest(v_kinds, v_eids) AS x(kind, id) WHERE x.kind = 'STAFF')
                     AND u.operator_id = g.operator_id
                     AND EXISTS (SELECT 1 FROM role_assignment ra2
                                  WHERE ra2.user_id = u.id AND ra2.role IN ('CASHIER', 'SUPERVISOR')
                                    AND ((ra2.scope_type = 'EVENT' AND ra2.scope_id = g.event_id)
                                         OR (ra2.scope_type = 'ORGANIZER' AND ra2.scope_id = ev.organizer_id)))),
        'catalogs', (SELECT coalesce(jsonb_agg(jsonb_build_object('pos_id', pos.id, 'version', cv.v, 'items',
                      (SELECT coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                          'product_id', i.item_id, 'name_fr', i.label_fr, 'name_en', i.label_en,
                          'category_fr', i.category_label_fr, 'category_en', i.category_label_en,
                          'unit_price', i.unit_price, 'vat_rate_bps', i.vat_rate_bps))
                          ORDER BY i.category_position, i.item_id), '[]')
                          FROM catalog_version_item i WHERE i.pos_id = pos.id AND i.version = cv.v)) ORDER BY pos.id), '[]')
                      FROM point_of_sale pos
                      JOIN merchant_participation mp ON mp.id = pos.participation_id AND mp.event_id = g.event_id
                      CROSS JOIN LATERAL (SELECT max(c.version) AS v FROM catalog_version c WHERE c.pos_id = pos.id) cv
                     WHERE pos.id IN (SELECT u.id FROM unnest(v_kinds, v_eids) AS u(kind, id) WHERE u.kind = 'CATALOG')
                       AND cv.v IS NOT NULL AND pos.operator_id = g.operator_id),
        'media_refs', (SELECT coalesce(jsonb_agg(jsonb_build_object('media_id', m.id, 'token_hash', encode(m.token_hash, 'hex'),
                         'wallet_id', a.wallet_id, 'status', m.status, 'batch_status', b.status) ORDER BY m.id), '[]')
                         FROM media m
                         LEFT JOIN media_batch b ON b.id = m.batch_id
                         LEFT JOIN LATERAL (SELECT ma.wallet_id FROM media_assignment ma JOIN wallet w ON w.id = ma.wallet_id
                                             WHERE ma.media_id = m.id AND ma.released_at IS NULL AND w.ledger_id = lg.id
                                             LIMIT 1) a ON true
                        WHERE m.id = ANY (v_media_ids) AND m.operator_id = g.operator_id
                          AND (a.wallet_id IS NOT NULL OR b.event_id = g.event_id)),
        'unassigned_media', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                               'media_id', m.id, 'nfc_uid', encode(m.nfc_uid, 'hex'), 'token_hash', encode(m.token_hash, 'hex'),
                               'key_index', m.key_index, 'originality_sig_sha256', encode(m.originality_sig_sha256, 'hex'),
                               'status', m.status, 'batch_event_id', b.event_id, 'batch_status', b.status,
                               'pwd_pack_sha256', CASE WHEN v_servable THEN encode(p.pwd_pack_sha256, 'hex') END,
                               'pwd_pack_enc', CASE WHEN v_servable AND p.media_id IS NOT NULL THEN jsonb_build_object(
                                  'nonce', edge_b64(substring(p.pwd_pack_enc FROM 1 FOR 12)),
                                  'ciphertext', edge_b64(substring(p.pwd_pack_enc FROM 13 FOR octet_length(p.pwd_pack_enc) - 28)),
                                  'tag', edge_b64(substring(p.pwd_pack_enc FROM octet_length(p.pwd_pack_enc) - 15 FOR 16))) END)
                               ORDER BY m.id), '[]')
                               FROM media m JOIN media_batch b ON b.id = m.batch_id AND b.event_id = g.event_id
                               LEFT JOIN edge_pwd_pack p ON p.gateway_id = p_gateway AND p.media_id = m.id
                                                        AND p.agreement_key_sha256 = v_keysha
                              WHERE m.id = ANY (v_media_ids) AND m.operator_id = g.operator_id AND m.nfc_uid IS NOT NULL
                                AND NOT EXISTS (SELECT 1 FROM media_assignment ma JOIN wallet w ON w.id = ma.wallet_id
                                                 WHERE ma.media_id = m.id AND ma.released_at IS NULL AND w.ledger_id = lg.id)));
    END IF;

    v_result := jsonb_build_object('ledger_id', lg.id, 'epoch', lg.authority_epoch, 'from_posting_id', p_after_posting,
                                   'to_posting_id', v_to, 'wallets', v_wallets_json, 'media', v_media_json,
                                   'has_more', v_more, 'edge_seq_applied', g.contiguous_edge_seq);
    IF v_servable THEN
      v_result := v_result || jsonb_build_object('pwd_pack_key', k.wrapped_key);
    END IF;
    IF NOT v_more THEN
      SELECT coalesce(jsonb_agg(jsonb_build_object('device_id', x.device_id, 'contiguous_acked_seq', x.contiguous_acked_seq,
               'max_seen_seq', x.max_seen_seq, 'missing_seqs', to_jsonb(x.missing_seqs),
               'next_seq_floor', x.next_seq_floor, 'as_of', edge_ts(x.as_of)) ORDER BY x.device_id), '[]')
        INTO v_acked FROM edge_device_seq_acked x;
      v_result := v_result || jsonb_build_object('device_seq_acked', v_acked);
    END IF;
    IF v_ref IS NOT NULL THEN
      v_result := v_result || jsonb_build_object('reference', v_ref);
    END IF;
    EXIT WHEN octet_length(v_result::text) <= 2097152 OR v_lim = 1;   -- borne de 2 Mio : on réduit la page
    v_lim := greatest(1, v_lim / 2);
  END LOOP;
  RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION edge_replication_page(uuid, bigint, bigint, int) FROM PUBLIC;
