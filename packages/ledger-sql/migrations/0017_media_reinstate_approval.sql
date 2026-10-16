-- Migration 0017 : la base vérifie elle-même la sortie de liste noire (mission bracelets-nfc, lot 20, cycle 3 ; levée
-- d'OP-N52, décision du porteur du 15/10/2026 ; SPECIFICATION §7.8).
--
-- Avant : `reinstate_media` croyait le valideur qu'on lui passait, et `check_media_transition` comparait deux réglages
-- de session posés par l'appelant. Une session de l'API (défaut d'une autre route, injection) sortait seule un bracelet
-- de liste noire en inventant un valideur, par `reinstate_media`, par `media_set_status` ou par un UPDATE direct.
--
-- Après, pour toute session qui n'est pas celle du propriétaire du schéma :
--   1. `BLACKLISTED → ACTIVE` n'a lieu que dans `reinstate_media` (marqueur de transaction posé par la fonction) ;
--   2. il faut une `approval_request` `REINSTATE_MEDIA` à l'état APPROVED, du même prestataire, pour ce bracelet et
--      pour l'épisode de liste noire en cours (`blacklist_history_id` = dernière mise en liste noire), dont l'auteur et
--      le valideur sont ceux de l'appel, distincts ;
--   3. l'auteur et le valideur sont des personnes ACTIVE du prestataire ; le valideur détient une attribution
--      SUPERVISOR non révoquée chez ce prestataire (la portée exacte reste contrôlée par l'API) ;
--   4. une demande d'approbation naît PENDING, sans décision : on ne peut pas inscrire une demande déjà approuvée.
-- Le marqueur (1) est un réglage de session : il n'est pas une barrière à lui seul, il ferme les autres chemins pour
-- un code honnête. La barrière est (2) + (3) + (4) : une demande approuvée ne s'obtient que par
-- `decide_approval_request`, qui refuse l'auteur comme valideur, et (3) refuse un valideur inventé.
--
-- Session du propriétaire (connexion du propriétaire, sans SET ROLE) : règle du schéma de référence seule (deux
-- réglages distincts). Ce rôle peut de toute façon désactiver un déclencheur ; les suites pgTAP du kit
-- (tests_grand_livre_cashless.sql), qui appellent `reinstate_media` sans demande, s'exécutent sous ce rôle. L'API ne
-- se connecte jamais avec ce rôle (DATABASE_URL_OWNER sert aux migrations seulement).
--
-- Limite restante : la base ne sait pas authentifier une personne. Une session de l'API compromise peut encore faire
-- décider une demande au nom d'un vrai superviseur du prestataire ; l'authentification reste celle de l'API.
--   CL020  passage refusé (sortie de liste noire sans demande approuvée concordante)
--   CL023  demande d'approbation inscrite déjà décidée

-- 1. Une demande d'approbation naît en attente --------------------------------------------------------------------
CREATE FUNCTION approval_request_born_pending() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status <> 'PENDING' OR NEW.decided_by IS NOT NULL OR NEW.decided_at IS NOT NULL
     OR NEW.executed_tx_id IS NOT NULL   -- `result` : déjà refusé hors EXECUTED par approval_request_result_executed
     OR NEW.failure_code IS NOT NULL OR NEW.failure_reason IS NOT NULL THEN
    RAISE EXCEPTION 'Demande d''approbation : elle naît PENDING, sans décision' USING ERRCODE = 'CL023';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER approval_request_born_pending BEFORE INSERT ON approval_request
  FOR EACH ROW EXECUTE FUNCTION approval_request_born_pending();

-- 2. Demande approuvée concordante --------------------------------------------------------------------------------
-- SECURITY DEFINER : lit les demandes, personnes et attributions du prestataire du bracelet, filtrées explicitement
-- par ce prestataire (FORCE ROW LEVEL SECURITY : le prestataire de la session doit être celui du bracelet), sans
-- dépendre des droits de lecture du rôle appelant sur `app_user` et `role_assignment`.
CREATE FUNCTION media_reinstatement_approved(p_media uuid, p_actor uuid, p_approver uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH m AS (SELECT id, operator_id FROM media WHERE id = p_media),
       episode AS (SELECT max(h.id) AS id FROM media_status_history h WHERE h.media_id = p_media AND h.to_status = 'BLACKLISTED')
  SELECT p_actor IS NOT NULL AND p_approver IS NOT NULL AND p_actor <> p_approver
     AND EXISTS (
       SELECT 1 FROM approval_request r, m, episode e
        WHERE r.operator_id = m.operator_id
          AND r.action = 'REINSTATE_MEDIA'
          AND r.status = 'APPROVED'
          AND r.target_id = m.id
          AND r.payload ->> 'media_id' = m.id::text
          AND r.payload ->> 'blacklist_history_id' = e.id::text
          AND r.requested_by = p_actor
          AND r.decided_by = p_approver)
     AND EXISTS (SELECT 1 FROM app_user u, m WHERE u.id = p_actor AND u.operator_id = m.operator_id AND u.status = 'ACTIVE')
     AND EXISTS (SELECT 1 FROM app_user u, m WHERE u.id = p_approver AND u.operator_id = m.operator_id AND u.status = 'ACTIVE')
     AND EXISTS (SELECT 1 FROM role_assignment a, m
                  WHERE a.user_id = p_approver AND a.operator_id = m.operator_id
                    AND a.role = 'SUPERVISOR' AND a.revoked_at IS NULL)
$$;
-- Appelable par le rôle de l'API : le déclencheur s'exécute avec les droits de la session qui change le statut. Elle
-- ne fait que lire et ne répond que vrai ou faux, pour un bracelet du prestataire de la session.

-- Session du propriétaire du schéma : sa connexion, sans SET ROLE (dans une fonction SECURITY DEFINER, current_user
-- est le propriétaire, mais ni session_user ni le réglage `role` ne changent).
CREATE FUNCTION media_owner_session() RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT current_setting('role') = 'none'
     AND pg_has_role(session_user, (SELECT relowner FROM pg_class WHERE oid = 'public.media'::regclass), 'MEMBER')
$$;

-- 3. Déclencheur des passages : même contenu que le schéma de référence, plus la règle de sortie de liste noire -----
CREATE OR REPLACE FUNCTION check_media_transition() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE pol text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status NOT IN ('PERSONALIZED','ISSUED','ACTIVE') THEN
      RAISE EXCEPTION 'Un bracelet naît PERSONALIZED, ISSUED ou ACTIVE (reprise de données), pas %', NEW.status USING ERRCODE = 'CL020';
    END IF;
    IF NEW.status = 'ACTIVE' AND NEW.wallet_id IS NULL THEN
      RAISE EXCEPTION 'Un bracelet ACTIVE doit être rattaché à un portefeuille' USING ERRCODE = 'CL020';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;
  IF NOT EXISTS (SELECT 1 FROM media_transition WHERE from_status = OLD.status AND to_status = NEW.status) THEN
    RAISE EXCEPTION 'Passage interdit : % -> %', OLD.status, NEW.status USING ERRCODE = 'CL020';
  END IF;
  SELECT reuse_policy INTO pol FROM media_batch WHERE id = NEW.batch_id;
  -- Seul un bracelet POOL peut être remis à une autre personne
  IF OLD.status = 'RELEASED' AND NEW.status = 'ISSUED' AND coalesce(pol, 'SINGLE_USE') <> 'POOL' THEN
    RAISE EXCEPTION 'Réattribution interdite : lot %', coalesce(pol, 'sans lot') USING ERRCODE = 'CL020';
  END IF;
  -- Bracelet perdu puis retrouvé : dépend de la politique de l'événement (défaut : fin de vie)
  IF OLD.status = 'SUSPENDED' AND NEW.status = 'ACTIVE'
     AND coalesce((SELECT lost_media_policy FROM event WHERE id = media_event(NEW.id)), 'END_OF_LIFE') <> 'REACTIVATE' THEN
    RAISE EXCEPTION 'Politique de l''événement : un bracelet perdu retrouvé passe en fin de vie' USING ERRCODE = 'CL020';
  END IF;
  -- Sortie de liste noire : validation par une seconde personne obligatoire
  IF OLD.status = 'BLACKLISTED' AND NEW.status = 'ACTIVE'
     AND (nullif(current_setting('app.approved_by', true), '') IS NULL
          OR current_setting('app.approved_by', true) = coalesce(current_setting('app.user_id', true), '')) THEN
    RAISE EXCEPTION 'Sortie de liste noire : validation par une seconde personne requise' USING ERRCODE = 'CL020';
  END IF;
  -- Migration 0017 : hors session du propriétaire, seulement par reinstate_media et avec une demande approuvée
  IF OLD.status = 'BLACKLISTED' AND NEW.status = 'ACTIVE' AND NOT media_owner_session() THEN
    IF coalesce(current_setting('app.reinstate_media', true), '') <> NEW.id::text THEN
      RAISE EXCEPTION 'Sortie de liste noire : seulement par reinstate_media' USING ERRCODE = 'CL020';
    END IF;
    IF NOT media_reinstatement_approved(NEW.id, nullif(current_setting('app.user_id', true), '')::uuid,
                                        nullif(current_setting('app.approved_by', true), '')::uuid) THEN
      RAISE EXCEPTION 'Sortie de liste noire : validation par une seconde personne requise (aucune demande REINSTATE_MEDIA approuvée concordante)'
        USING ERRCODE = 'CL020';
    END IF;
  END IF;
  IF NEW.status = 'ACTIVE' AND NEW.wallet_id IS NULL THEN
    RAISE EXCEPTION 'Un bracelet ACTIVE doit être rattaché à un portefeuille' USING ERRCODE = 'CL020';
  END IF;
  RETURN NEW;
END $$;

-- 4. reinstate_media : même signature ; pose le marqueur le temps du changement d'état, puis le retire --------------
CREATE OR REPLACE FUNCTION reinstate_media(p_media uuid, p_actor uuid, p_approver uuid, p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM assert_tenant(tenant_of_media(p_media));   -- cloisonnement : l'objet doit appartenir au prestataire de la session
  PERFORM set_config('app.user_id', p_actor::text, true);
  PERFORM set_config('app.approved_by', coalesce(p_approver::text, ''), true);
  PERFORM set_config('app.reason', p_reason, true);
  PERFORM set_config('app.reinstate_media', p_media::text, true);
  UPDATE media SET status = 'ACTIVE' WHERE id = p_media;
  PERFORM set_config('app.reinstate_media', '', true);
END $$;
