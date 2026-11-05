-- 0051 : enveloppe de lecture de l'état de remontée des terminaux d'un événement, pour l'API publique
-- (mission hors-ligne-snapshots-lots, WP21 partie D ; décision du porteur du 04/11/2026, option (a)).
--
-- Contexte : GET /events/{event_id}/device-sync-status (getEventDeviceSyncStatus) a besoin de
-- event_device_sync_status (ADR-73) et de event_sync_deadline. Ces deux fonctions restent RETIRÉES à
-- cashless_app (R-30.12) ; cette enveloppe est la seule porte ouverte.
--
-- event_device_sync_status_api(p_event uuid)
--   RETURNS TABLE (sync_deadline timestamptz, device_id uuid, serial text, caught_up boolean, reason text)
--   - STABLE, SECURITY DEFINER, search_path fixé ; lecture seule ;
--   - prestataire : assert_tenant(tenant_of_event(p_event)) AVANT toute lecture. Événement inexistant, d'un autre
--     prestataire ou appel sans prestataire de session : la même erreur « Objet introuvable » (no_data_found,
--     P0002, 404 neutre) ;
--   - ne rend que les colonnes de la réponse du contrat : la date limite (répétée sur chaque ligne) et, par
--     terminal, identifiant, numéro de série, « à jour » et raison. Aucune autre colonne, aucune clé, aucun
--     jeton ;
--   - un événement sans terminal rend UNE ligne dont device_id, serial, caught_up et reason sont NULL (la date
--     limite reste lisible) ; l'API l'écarte ;
--   - le calcul est celui des fonctions existantes (appelées, pas recopiées) : exclus les terminaux révoqués et
--     les téléphones personnels (ADR-73).
-- Droits : REVOKE ALL FROM PUBLIC ici ; EXECUTE à cashless_app seul (post-roles.sql 8d).
CREATE FUNCTION event_device_sync_status_api(p_event uuid)
RETURNS TABLE (sync_deadline timestamptz, device_id uuid, serial text, caught_up boolean, reason text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_deadline timestamptz;
BEGIN
  PERFORM assert_tenant(tenant_of_event(p_event));
  v_deadline := event_sync_deadline(p_event);
  RETURN QUERY
  SELECT v_deadline, s.device_id, s.serial, s.caught_up, s.reason
    FROM (SELECT 1) one
    LEFT JOIN event_device_sync_status(p_event) s ON true
   ORDER BY s.serial;
END $$;
REVOKE ALL ON FUNCTION event_device_sync_status_api(uuid) FROM PUBLIC;
