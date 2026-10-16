-- Migration 0020 : la base n'accepte un travail de clé que s'il naît d'une demande approuvée à deux
-- (correctif post-fusion n° 1 de la mission bracelets-nfc, constat SEC-1 de la revue ; décision du
-- porteur du 16/10/2026 : corriger dans la base ET dans les programmes qui exécutent les travaux ;
-- ADR-102).
--
-- Avant : `cashless_app` gardait INSERT sur `tag_key_job` (post-roles.sql ne bornait que UPDATE) et
-- `cashless_perso` y insérait librement REENCRYPT et DISABLE_KMS_KEY. Aucun exécutant ne relisait
-- la demande d'approbation. Une session de l'API compromise inscrivait, sans aucune approbation,
-- une désactivation dans le service de clés de la clé partagée ACTIVE, un retrait de clé dédiée ou
-- une création de clé ; la commande d'administration et la personnalisation l'exécutaient.
-- `retire_dedicated_key` (schéma de référence, SECURITY DEFINER) restait de plus appelable par
-- l'API (EXECUTE hérité de PUBLIC) : retrait direct, sans travail.
--
-- Après :
--   1. Plus aucun INSERT direct sur `tag_key_job` pour l'API ni pour la personnalisation
--      (post-roles.sql). Un travail ne naît que par deux fonctions SECURITY DEFINER, qui fixent
--      elles-mêmes la sorte, l'index, la charge utile, l'auteur et le valideur à partir de la
--      demande (jamais de l'appelant), et le statut initial :
--        - enqueue_tag_key_job(demande) — l'API, pendant l'exécution de l'approbation (demande
--          APPROVED) : TAG_KEY_CREATE -> CREATE_KEY, TAG_DEK_ROTATE -> ROTATE_DEK, TAG_KEY_RETIRE
--          -> RETIRE_KEY ;
--        - enqueue_tag_key_child_job(parent, clé cible) — la personnalisation, pendant l'exécution
--          du travail parent (RUNNING, demande EXECUTED dont le résultat désigne ce parent) :
--          ROTATE_DEK -> REENCRYPT, RETIRE_KEY -> DISABLE_KMS_KEY (clé RETIRED seulement).
--      Contrôles : même prestataire que la session, action et objet concordants (index de la
--      demande, paramètres figés de la création), auteur ≠ valideur, l'un et l'autre personnes
--      ACTIVE du prestataire avec une attribution OPERATOR_ADMIN non retirée sur ce prestataire
--      (création à l'approbation), demande jamais consommée (index uniques : un seul travail racine
--      par demande, un seul travail enfant par parent).
--   2. tag_key_job_refusal(travail) : les trois exécutants la consultent juste après la prise d'un
--      travail et avant tout appel au service de clés (défense en profondeur : un travail planté
--      par une autre voie — propriétaire, droit rétabli par erreur — est refusé, passé en échec,
--      audité et signalé).
--   3. retire_dedicated_key : EXECUTE retiré à PUBLIC, accordé à la seule personnalisation
--      (post-roles.sql).
--
-- Aucune de ces fonctions ne s'appuie sur la RLS (propriétaire superutilisateur en local) : chaque
-- lecture nomme le prestataire de la session (`app.operator_id`). search_path `public, pg_temp`
-- (voir 0019, OP-N59).
--
-- Limite restante (OP-N56, mission 11) : la base n'authentifie pas qui décide une demande. Une
-- session de l'API compromise peut encore faire décider une demande au nom d'un second
-- OPERATOR_ADMIN réel du prestataire ; la règle à deux reste alors celle de l'authentification de
-- l'API. Elle ne peut plus inscrire un travail sans demande, ni avec une demande d'une autre
-- action, d'un autre objet, d'un autre prestataire ou déjà consommée.
--   CL001  paramètres de la demande invalides
--   CL020  état de la clé ou du travail parent incompatible
--   CL023  demande absente, non approuvée, sans rapport, décidée par son auteur ou déjà consommée

-- 1. Une demande, un travail racine ; un parent, un travail enfant --------------------------------
CREATE UNIQUE INDEX tag_key_job_one_per_approval ON tag_key_job (approval_request_id)
  WHERE parent_job_id IS NULL AND approval_request_id IS NOT NULL;
CREATE UNIQUE INDEX tag_key_job_one_per_parent ON tag_key_job (parent_job_id)
  WHERE parent_job_id IS NOT NULL;

-- 2. Travail racine, inscrit à l'approbation par l'API --------------------------------------------
CREATE FUNCTION enqueue_tag_key_job(p_approval uuid) RETURNS tag_key_job
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
REVOKE ALL ON FUNCTION enqueue_tag_key_job(uuid) FROM PUBLIC;

-- 3. Travail enfant, inscrit par la personnalisation pendant l'exécution du parent ----------------
CREATE FUNCTION enqueue_tag_key_child_job(p_parent uuid, p_target_dek uuid DEFAULT NULL)
RETURNS tag_key_job
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_operator uuid := nullif(current_setting('app.operator_id', true), '')::uuid;
  p tag_key_job%ROWTYPE;
  r approval_request%ROWTYPE;
  j tag_key_job%ROWTYPE;
  v_kind text;
  v_action text;
  v_dek uuid;
  v_version int;
  v_payload jsonb;
BEGIN
  IF v_operator IS NULL OR p_parent IS NULL THEN
    RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found';
  END IF;
  SELECT * INTO p FROM tag_key_job WHERE id = p_parent AND operator_id = v_operator FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found'; END IF;
  v_kind := CASE p.kind WHEN 'ROTATE_DEK' THEN 'REENCRYPT'
                        WHEN 'RETIRE_KEY' THEN 'DISABLE_KMS_KEY' END;
  v_action := CASE p.kind WHEN 'ROTATE_DEK' THEN 'TAG_DEK_ROTATE'
                          WHEN 'RETIRE_KEY' THEN 'TAG_KEY_RETIRE' END;
  IF v_kind IS NULL OR p.parent_job_id IS NOT NULL THEN
    RAISE EXCEPTION 'Travail de clé : % n''a pas de travail suivant', p.kind
      USING ERRCODE = 'CL020';
  END IF;
  IF p.status <> 'RUNNING' THEN
    RAISE EXCEPTION 'Travail de clé : le travail parent doit être en cours (%)', p.status
      USING ERRCODE = 'CL020';
  END IF;
  SELECT * INTO r FROM approval_request
   WHERE id = p.approval_request_id AND operator_id = v_operator;
  IF NOT FOUND OR r.status <> 'EXECUTED' OR r.action <> v_action
     OR r.decided_by IS NULL OR r.decided_by = r.requested_by
     OR r.result ->> 'job_id' IS DISTINCT FROM p.id::text
     OR r.payload ->> 'key_index' IS DISTINCT FROM p.key_index::text THEN
    RAISE EXCEPTION 'Travail de clé : le parent ne vient pas d''une demande approuvée concordante'
      USING ERRCODE = 'CL023';
  END IF;
  IF EXISTS (SELECT 1 FROM tag_key_job WHERE parent_job_id = p.id) THEN
    RAISE EXCEPTION 'Travail de clé : travail suivant déjà inscrit' USING ERRCODE = 'CL023';
  END IF;

  IF v_kind = 'REENCRYPT' THEN
    SELECT d.id, d.version INTO v_dek, v_version FROM tag_data_key d
     WHERE d.id = p_target_dek AND d.operator_id = v_operator AND d.key_index = p.key_index
       AND d.status = 'ACTIVE';
    IF v_dek IS NULL THEN
      RAISE EXCEPTION 'Travail de clé : clé de données cible inconnue ou non active'
        USING ERRCODE = 'CL020';
    END IF;
    v_payload := jsonb_build_object('target_dek_id', v_dek, 'target_version', v_version);
  ELSE
    IF p_target_dek IS NOT NULL THEN
      RAISE EXCEPTION 'Travail de clé : pas de clé de données cible pour une désactivation'
        USING ERRCODE = 'CL001';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM tag_key
                    WHERE operator_id = v_operator AND key_index = p.key_index
                      AND status = 'RETIRED') THEN
      RAISE EXCEPTION 'Travail de clé : seule une clé retirée se désactive' USING ERRCODE = 'CL020';
    END IF;
    v_payload := '{}'::jsonb;
  END IF;

  INSERT INTO tag_key_job
    (operator_id, key_index, kind, payload, approval_request_id, parent_job_id)
  VALUES (v_operator, p.key_index, v_kind,
          v_payload || jsonb_build_object('requested_by', r.requested_by,
                                          'approved_by', r.decided_by),
          r.id, p.id)
  RETURNING * INTO j;
  RETURN j;
END $$;
REVOKE ALL ON FUNCTION enqueue_tag_key_child_job(uuid, uuid) FROM PUBLIC;

-- 4. Revérification par l'exécutant : NULL si le travail peut être exécuté, sinon le motif du refus
--    ---
-- Racine : demande EXECUTED, de l'action de la sorte, du prestataire, dont le résultat désigne CE
-- travail (et son index), auteur ≠ valideur, paramètres figés et personnes identiques à ceux du
-- travail. Enfant : parent racine DONE de la sorte attendue, même index et même demande ; la
-- demande est vérifiée sur le parent. DISABLE_KMS_KEY : clé RETIRED.
CREATE FUNCTION tag_key_job_refusal(p_job uuid) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_operator uuid := nullif(current_setting('app.operator_id', true), '')::uuid;
  j tag_key_job%ROWTYPE;
  root tag_key_job%ROWTYPE;
  r approval_request%ROWTYPE;
  v_action text;
BEGIN
  SELECT * INTO j FROM tag_key_job WHERE id = p_job AND operator_id = v_operator;
  IF NOT FOUND THEN RETURN 'travail introuvable pour le prestataire de la session'; END IF;
  IF j.approval_request_id IS NULL THEN RETURN 'aucune demande d''approbation'; END IF;
  IF j.parent_job_id IS NULL THEN
    IF j.kind NOT IN ('CREATE_KEY','ROTATE_DEK','RETIRE_KEY') THEN
      RETURN 'un travail ' || j.kind || ' ne naît que de son travail parent';
    END IF;
    root := j;
  ELSE
    SELECT * INTO root FROM tag_key_job WHERE id = j.parent_job_id AND operator_id = v_operator;
    IF NOT FOUND OR root.parent_job_id IS NOT NULL OR root.key_index <> j.key_index
       OR root.approval_request_id IS DISTINCT FROM j.approval_request_id OR root.status <> 'DONE'
       OR (root.kind, j.kind) NOT IN (('ROTATE_DEK','REENCRYPT'),
                                      ('RETIRE_KEY','DISABLE_KMS_KEY')) THEN
      RETURN 'travail parent absent, inachevé ou non concordant';
    END IF;
  END IF;
  SELECT * INTO r FROM approval_request
   WHERE id = j.approval_request_id AND operator_id = v_operator;
  IF NOT FOUND THEN RETURN 'demande d''approbation introuvable'; END IF;
  IF r.status <> 'EXECUTED' THEN
    RETURN 'demande d''approbation ' || r.status || ', non exécutée';
  END IF;
  IF r.decided_by IS NULL OR r.decided_by = r.requested_by THEN
    RETURN 'auteur et valideur non distincts';
  END IF;
  v_action := CASE root.kind WHEN 'CREATE_KEY' THEN 'TAG_KEY_CREATE'
                             WHEN 'ROTATE_DEK' THEN 'TAG_DEK_ROTATE'
                             WHEN 'RETIRE_KEY' THEN 'TAG_KEY_RETIRE' END;
  IF r.action IS DISTINCT FROM v_action THEN
    RETURN 'demande ' || r.action || ' sans rapport avec un travail ' || root.kind;
  END IF;
  IF r.payload ->> 'operator_id' IS DISTINCT FROM v_operator::text THEN
    RETURN 'demande d''un autre prestataire';
  END IF;
  IF r.result ->> 'job_id' IS DISTINCT FROM root.id::text
     OR r.result ->> 'key_index' IS DISTINCT FROM root.key_index::text THEN
    RETURN 'le travail n''est pas celui que la demande a produit';
  END IF;
  IF root.kind <> 'CREATE_KEY'
     AND r.payload ->> 'key_index' IS DISTINCT FROM root.key_index::text THEN
    RETURN 'clé visée différente de celle de la demande';
  END IF;
  IF root.kind = 'CREATE_KEY'
     AND (root.payload ->> 'scope' IS DISTINCT FROM r.payload ->> 'scope'
          OR root.payload ->> 'dedicated_event_id'
             IS DISTINCT FROM r.payload ->> 'dedicated_event_id') THEN
    RETURN 'paramètres différents de ceux de la demande';
  END IF;
  IF j.payload ->> 'requested_by' IS DISTINCT FROM r.requested_by::text
     OR j.payload ->> 'approved_by' IS DISTINCT FROM r.decided_by::text THEN
    RETURN 'auteur ou valideur différent de ceux de la demande';
  END IF;
  IF j.kind = 'DISABLE_KMS_KEY'
     AND NOT EXISTS (SELECT 1 FROM tag_key
                      WHERE operator_id = v_operator AND key_index = j.key_index
                        AND status = 'RETIRED') THEN
    RETURN 'la clé n''est pas retirée';
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION tag_key_job_refusal(uuid) FROM PUBLIC;

-- 5. Retrait direct d'une clé dédiée : plus d'EXECUTE hérité de PUBLIC (accordé à la
--    personnalisation, post-roles.sql)
REVOKE ALL ON FUNCTION retire_dedicated_key(uuid, integer) FROM PUBLIC;
