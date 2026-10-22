-- Migration 0029 : configuration servie refusée à un terminal révoqué et bornée au prestataire du
-- terminal (mission identite-enrolement-terminaux, lot WP18 ; ADR-118 (1), relectures de WP15 et
-- WP17 du 21/10/2026). 0028 reste libre.
--
-- Avant : `record_config_served` (schéma de référence, S10) appliquait `assert_tenant` au seul
-- prestataire du terminal. Elle ne refusait pas un terminal REVOKED et ne vérifiait pas que
-- `p_config_version` appartient au prestataire du terminal (clé étrangère seule). Sans effet par la
-- route (WP17 : statut relu sous verrou, `p_config_version` jamais passé), mais `cashless_app`, qui
-- l'exécute depuis WP17, pouvait enregistrer une configuration pour un terminal révoqué ou citer la
-- `config_version` d'un autre prestataire.
--
-- Après (même signature, mêmes droits : post-roles.sql §4a inchangé) :
--   1. terminal REVOKED -> refus `insufficient_privilege` (42501), comme `assert_device_active`
--      (0023) ; rien n'est écrit. Un terminal SUSPENDED garde sa configuration (route
--      `allowSuspended`, FR-018) ;
--   2. `p_config_version` non NULL : `assert_tenant` sur son prestataire. Inconnue, d'un autre
--      prestataire, ou sans prestataire (configuration de niveau PLATFORM) -> `no_data_found`
--      (« Objet introuvable »), rien n'est écrit. Une configuration PLATFORM n'est donc pas
--      enregistrable telle quelle : aucun appelant ne la passe aujourd'hui (choix le plus strict
--      de la lettre d'ADR-118, signalé au compte rendu de WP18) ;
--   3. ligne du terminal relue `FOR SHARE` : une révocation simultanée (`set_device_status`,
--      FOR UPDATE) attend la fin de l'enregistrement ou le voit, jamais l'inverse.
-- Le reste du corps est celui du schéma de référence, à l'identique ; `search_path` passe à
-- `public, pg_temp` (OP-N59, comme les fonctions de la mission).

CREATE OR REPLACE FUNCTION record_config_served(p_device uuid, p_config_version uuid DEFAULT NULL)
RETURNS device_config_served
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE d device%ROWTYPE; pol jsonb; ep int; last device_config_served%ROWTYPE;
        r device_config_served%ROWTYPE; ts jsonb; v_cv_operator uuid;
BEGIN
  PERFORM assert_tenant(tenant_of_device(p_device));
  SELECT * INTO d FROM device WHERE id = p_device FOR SHARE;
  IF d.status = 'REVOKED' THEN
    RAISE EXCEPTION 'Terminal révoqué' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_config_version IS NOT NULL THEN
    SELECT cv.operator_id INTO v_cv_operator FROM config_version cv WHERE cv.id = p_config_version;
    -- Inconnue (NULL) ou sans prestataire : même refus qu'un autre prestataire.
    PERFORM assert_tenant(v_cv_operator);
    IF v_cv_operator IS DISTINCT FROM d.operator_id THEN
      RAISE EXCEPTION 'Objet introuvable' USING ERRCODE = 'no_data_found';
    END IF;
  END IF;
  SELECT coalesce((SELECT jsonb_build_object(
           'online_connect_timeout_ms', e.online_connect_timeout_ms,
           'online_total_timeout_ms', e.online_total_timeout_ms,
           'online_retries', e.online_retries, 'pending_sync_seconds', e.pending_sync_seconds,
           'reconcile_sync_seconds', e.reconcile_sync_seconds,
           'heartbeat_seconds', e.heartbeat_seconds,
           'reversal_window_minutes', e.reversal_window_minutes,
           'local_retention_days', e.local_retention_days,
           'tap_replay_window_seconds', e.tap_replay_window_seconds)
         FROM event e WHERE e.id = d.event_id), '{}') INTO ts;
  SELECT to_jsonb(e) INTO pol FROM effective_offline_policy(p_device) e;
  SELECT coalesce(max(l.authority_epoch), 0) INTO ep
    FROM ledger l JOIN event ev ON ev.id = d.event_id
   WHERE (l.scope_type = 'EVENT' AND l.scope_id = ev.id)
      OR (l.scope_type = 'ORGANIZER' AND l.scope_id = ev.organizer_id);
  SELECT * INTO last FROM device_config_served WHERE device_id = p_device ORDER BY id DESC LIMIT 1;
  IF FOUND AND last.policy = pol AND last.authority_epoch = ep
     AND last.next_seq_floor = d.next_seq_floor
     AND last.config_version_id IS NOT DISTINCT FROM p_config_version
     AND last.terminal_settings = ts THEN
    RETURN last;
  END IF;
  INSERT INTO device_config_served (operator_id, device_id, config_version_id, policy,
                                    policy_sha256, authority_epoch, next_seq_floor,
                                    terminal_settings)
  VALUES (d.operator_id, p_device, p_config_version, pol, sha256(convert_to(pol::text, 'UTF8')),
          ep, d.next_seq_floor, ts)
  RETURNING * INTO r;
  RETURN r;
END $$;
REVOKE ALL ON FUNCTION record_config_served(uuid, uuid) FROM PUBLIC;
