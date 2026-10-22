-- Migration 0025 : retrait d'une clé dédiée lié à un travail approuvé en cours, et demande de clé
-- approuvée périmée refusée (OP-N62, ADR-102 ; mission 5a, lot WP06).
--
-- Avant (0020) : `retire_dedicated_key` (schéma de référence, SECURITY DEFINER) était exécutable
-- par la personnalisation sans aucun travail : un processus de personnalisation compromis retirait
-- une clé dédiée (clé et clés de données retirées, mots de passe effacés, bracelets en fin de vie)
-- sans décision à deux. Et `enqueue_tag_key_job` ne lisait pas `expires_at` : une demande APPROVED
-- jamais exécutée servait encore après son délai, une fois.
--
-- Après :
--   1. retire_dedicated_key_for_job(travail) : le travail est un RETIRE_KEY racine du prestataire
--      de la session, en cours (RUNNING), et tag_key_job_refusal (0020) l'accepte : demande
--      TAG_KEY_RETIRE EXECUTED du même prestataire, dont le résultat désigne ce travail et cette
--      clé, auteur ≠ valideur, auteur et valideur identiques à ceux du travail. Elle appelle
--      ensuite retire_dedicated_key avec le prestataire et l'index du travail (jamais ceux de
--      l'appelant). EXECUTE retiré à PUBLIC ; accordé à la personnalisation par post-roles.sql,
--      qui doit retirer à ce rôle `retire_dedicated_key` (OP-N44, lot WP07).
--   2. enqueue_tag_key_job : corps de 0020 à l'identique, plus le refus (CL023) d'une demande
--      APPROVED dont `expires_at` est dépassé. L'heure lue est clock_timestamp(), comme le défaut
--      de `expires_at` et la lecture des demandes expirées par l'API : une demande qui périme
--      pendant une transaction longue est refusée aussi.
--   enqueue_tag_key_child_job n'est pas modifiée : elle n'accepte qu'une demande EXECUTED, déjà
--   consommée dans son délai par le travail parent.
--
-- Comme 0020, aucune de ces fonctions ne s'appuie sur la RLS : chaque lecture nomme le prestataire
-- de la session (`app.operator_id`). search_path `public, pg_temp` (OP-N59, 0021).
--   CL020  travail d'une autre sorte, enfant ou non en cours
--   CL023  demande absente, non approuvée, sans rapport, décidée par son auteur, déjà consommée
--          ou périmée

-- 1. Retrait d'une clé dédiée par son travail -----------------------------------------------------
CREATE FUNCTION retire_dedicated_key_for_job(p_job uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_operator uuid := nullif(current_setting('app.operator_id', true), '')::uuid;
  j tag_key_job%ROWTYPE;
  v_refusal text;
BEGIN
  IF v_operator IS NULL OR p_job IS NULL THEN
    RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found';
  END IF;
  -- Travail du prestataire de la session, verrouillé : il ne se termine ni ne se relance pendant
  -- le retrait.
  SELECT * INTO j FROM tag_key_job WHERE id = p_job AND operator_id = v_operator FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  IF j.kind <> 'RETIRE_KEY' OR j.parent_job_id IS NOT NULL THEN
    RAISE EXCEPTION 'Retrait de clé : un travail % ne retire pas de clé', j.kind
      USING ERRCODE = 'CL020';
  END IF;
  IF j.status <> 'RUNNING' THEN
    RAISE EXCEPTION 'Retrait de clé : le travail doit être en cours (%)', j.status
      USING ERRCODE = 'CL020';
  END IF;
  -- Même revérification que les exécutants (0020) : demande TAG_KEY_RETIRE EXECUTED concordante.
  v_refusal := tag_key_job_refusal(j.id);
  IF v_refusal IS NOT NULL THEN
    RAISE EXCEPTION 'Retrait de clé : %', v_refusal USING ERRCODE = 'CL023';
  END IF;
  RETURN retire_dedicated_key(j.operator_id, j.key_index);
END $$;
REVOKE ALL ON FUNCTION retire_dedicated_key_for_job(uuid) FROM PUBLIC;

-- 2. Travail racine : demande approuvée périmée refusée ------------------------------------------
--    Corps de 0020, seule la garde « demande périmée » est ajoutée (après le contrôle du statut).
CREATE OR REPLACE FUNCTION enqueue_tag_key_job(p_approval uuid) RETURNS tag_key_job
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_operator uuid := nullif(current_setting('app.operator_id', true), '')::uuid;
  r approval_request%ROWTYPE;
  k tag_key%ROWTYPE;
  j tag_key_job%ROWTYPE;
  v_kind text;
  v_index int;
  v_scope text;
  v_event uuid;
  v_payload jsonb;
BEGIN
  IF v_operator IS NULL OR p_approval IS NULL THEN
    RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found';
  END IF;
  -- Demande du prestataire de la session, verrouillée : deux inscriptions concurrentes ne la
  -- consomment pas deux fois.
  SELECT * INTO r FROM approval_request
   WHERE id = p_approval AND operator_id = v_operator FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  v_kind := CASE r.action WHEN 'TAG_KEY_CREATE' THEN 'CREATE_KEY'
                          WHEN 'TAG_DEK_ROTATE' THEN 'ROTATE_DEK'
                          WHEN 'TAG_KEY_RETIRE' THEN 'RETIRE_KEY' END;
  IF v_kind IS NULL THEN
    RAISE EXCEPTION 'Travail de clé : la demande % n''est pas une action de clé', r.action
      USING ERRCODE = 'CL023';
  END IF;
  IF r.status <> 'APPROVED' THEN
    RAISE EXCEPTION 'Travail de clé : demande % et non APPROVED', r.status USING ERRCODE = 'CL023';
  END IF;
  -- OP-N62 (0025) : une demande approuvée ne sert plus après son délai.
  IF r.expires_at < clock_timestamp() THEN
    RAISE EXCEPTION 'Travail de clé : demande approuvée périmée' USING ERRCODE = 'CL023';
  END IF;
  IF r.decided_by IS NULL OR r.decided_by = r.requested_by THEN
    RAISE EXCEPTION 'Travail de clé : demande décidée par son auteur' USING ERRCODE = 'CL023';
  END IF;
  IF r.payload ->> 'operator_id' IS DISTINCT FROM v_operator::text THEN
    RAISE EXCEPTION 'Travail de clé : demande d''un autre prestataire' USING ERRCODE = 'CL023';
  END IF;
  -- Auteur et valideur : deux personnes ACTIVE du prestataire, chacune OPERATOR_ADMIN de ce
  -- prestataire.
  IF (SELECT count(DISTINCT u.id) FROM app_user u
       WHERE u.id IN (r.requested_by, r.decided_by) AND u.operator_id = v_operator
         AND u.status = 'ACTIVE'
         AND EXISTS (SELECT 1 FROM role_assignment a
                      WHERE a.user_id = u.id AND a.operator_id = v_operator
                        AND a.role = 'OPERATOR_ADMIN' AND a.scope_type = 'OPERATOR'
                        AND a.scope_id = v_operator AND a.revoked_at IS NULL)) <> 2 THEN
    RAISE EXCEPTION 'Travail de clé : auteur et valideur, deux OPERATOR_ADMIN actifs du prestataire'
      USING ERRCODE = 'CL023';
  END IF;
  IF EXISTS (SELECT 1 FROM tag_key_job WHERE approval_request_id = r.id) THEN
    RAISE EXCEPTION 'Travail de clé : demande déjà consommée' USING ERRCODE = 'CL023';
  END IF;

  IF v_kind = 'CREATE_KEY' THEN
    v_scope := r.payload ->> 'scope';
    IF v_scope IS NULL OR v_scope NOT IN ('SHARED','DEDICATED') THEN
      RAISE EXCEPTION 'Travail de clé : portée de la clé invalide' USING ERRCODE = 'CL001';
    END IF;
    IF v_scope = 'DEDICATED' THEN
      SELECT e.id INTO v_event FROM event e
       WHERE e.id::text = r.payload ->> 'dedicated_event_id' AND e.operator_id = v_operator;
      IF v_event IS NULL THEN
        RAISE EXCEPTION 'Travail de clé : événement de la clé dédiée inconnu'
          USING ERRCODE = 'CL001';
      END IF;
    ELSIF r.payload ->> 'dedicated_event_id' IS NOT NULL THEN
      RAISE EXCEPTION 'Travail de clé : événement interdit pour une clé partagée'
        USING ERRCODE = 'CL001';
    END IF;
    -- Index suivant, calculé ici (jamais choisi par l'appelant), sous un verrou du prestataire.
    PERFORM pg_advisory_xact_lock(hashtextextended('tag-key-index:' || v_operator::text, 0));
    v_index := 1 + greatest(
      coalesce((SELECT max(key_index) FROM tag_key WHERE operator_id = v_operator), 0),
      coalesce((SELECT max(key_index) FROM tag_key_job
                 WHERE operator_id = v_operator AND kind = 'CREATE_KEY'), 0));
    IF v_index > 65535 THEN
      RAISE EXCEPTION 'Travail de clé : plus aucun index de clé disponible' USING ERRCODE = 'CL020';
    END IF;
    v_payload := jsonb_build_object('scope', v_scope, 'dedicated_event_id', v_event);
  ELSE
    IF jsonb_typeof(r.payload -> 'key_index') IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION 'Travail de clé : index de la clé attendu' USING ERRCODE = 'CL001';
    END IF;
    v_index := (r.payload ->> 'key_index')::int;
    SELECT * INTO k FROM tag_key WHERE operator_id = v_operator AND key_index = v_index;
    IF NOT FOUND THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
    IF v_kind = 'ROTATE_DEK' AND k.status <> 'ACTIVE' THEN
      RAISE EXCEPTION 'Travail de clé : la clé n''est pas active' USING ERRCODE = 'CL020';
    END IF;
    IF v_kind = 'RETIRE_KEY' AND (k.scope <> 'DEDICATED' OR k.status = 'RETIRED') THEN
      RAISE EXCEPTION 'Travail de clé : seule une clé dédiée non retirée se retire'
        USING ERRCODE = 'CL020';
    END IF;
    v_payload := '{}'::jsonb;
  END IF;

  INSERT INTO tag_key_job (operator_id, key_index, kind, payload, approval_request_id)
  VALUES (v_operator, v_index, v_kind,
          v_payload || jsonb_build_object('requested_by', r.requested_by,
                                          'approved_by', r.decided_by),
          r.id)
  RETURNING * INTO j;
  RETURN j;
END $$;
-- CREATE OR REPLACE garde propriétaire et droits ; redit pour ne pas dépendre de l'ordre.
REVOKE ALL ON FUNCTION enqueue_tag_key_job(uuid) FROM PUBLIC;
