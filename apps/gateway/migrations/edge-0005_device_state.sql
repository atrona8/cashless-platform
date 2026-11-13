-- edge-0005 (WP19) : colonnes de `edge_device` que la passerelle sert aux terminaux et que
-- edge-0001/0003 ne portaient pas. Numéro 0004 : réservé à WP20 (décision 19). Signalé au compte
-- rendu de WP19. Rien ici n'élargit un droit ni ne retire un contrôle.
--
--  * os, nfc_enabled, station_name, pos_name, merchant_name : le bloc `device` et `pos` de
--    `getDeviceConfig` (`EdgeDevice` de replication-page-additions.yaml les porte ; WP18 ne les
--    gardait pas, contradiction signalée). Écrites par la seule réplication ; NULL tant que le
--    flux ne les a pas portées (la configuration est alors refusée, jamais inventée).
--  * last_heartbeat_at, app_version, reported_snapshot_version, reported_local_seq,
--    pending_operations : l'état local du terminal que met à jour `postDeviceHeartbeat`. Non
--    répliqué, jamais renvoyé au central par ce lot.
ALTER TABLE edge_device ADD COLUMN os text CHECK (os IS NULL OR os IN ('ANDROID', 'IOS'));
ALTER TABLE edge_device ADD COLUMN nfc_enabled boolean;
ALTER TABLE edge_device ADD COLUMN station_name text;
ALTER TABLE edge_device ADD COLUMN pos_name text;
ALTER TABLE edge_device ADD COLUMN merchant_name text;
ALTER TABLE edge_device ADD COLUMN last_heartbeat_at timestamptz;
ALTER TABLE edge_device ADD COLUMN app_version text CHECK (app_version IS NULL OR length(app_version) <= 64);
ALTER TABLE edge_device ADD COLUMN reported_snapshot_version bigint;
ALTER TABLE edge_device ADD COLUMN reported_local_seq bigint;
ALTER TABLE edge_device ADD COLUMN pending_operations bigint;
