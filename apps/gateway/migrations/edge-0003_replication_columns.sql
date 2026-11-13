-- edge-0003 (WP18) : colonnes que le flux de réplication porte et que edge-0001 ne pouvait pas
-- recevoir (contradiction entre data-model.md B.3/B.4 et contracts/replication-page-additions.yaml,
-- signalée au compte rendu de WP18). Rien ici n'élargit un droit ni ne retire un contrôle : ce sont
-- des colonnes de copie (R), toutes écrites par la seule réplication.
--
--  * edge_media.media_id : `SnapshotEntry` (media[]) ne porte NI `media_id` NI `wallet_id`, ils
--    viennent de `reference.media_refs` (autre curseur). Une entrée reçue avant son lien est
--    gardée avec media_id NULL (jamais une valeur inventée) ; les lecteurs la traitent comme non
--    liée.
--  * edge_media : `originality_sig_sha256`, `key_index`, `pwd_pack_sha256` (requis par
--    getMediaAuthKey et activateMedia, R-22).
--  * edge_event_setting : `name`, `wallet_limits` (plafonds de la législation, EdgeEventSettings).
--  * edge_device : `cash_desk_account_id` (obligatoire pour DEPOSIT_CASH de la file).
--  * edge_staff : `user_id` ; edge_cash_session : `opened_by_user_id`, `cash_account_id` facultatif
--    (EdgeCashSession ne porte que l'identifiant de la personne ; l'identité vient d'edge_staff).
ALTER TABLE edge_media ALTER COLUMN media_id DROP NOT NULL;
ALTER TABLE edge_media ADD CONSTRAINT edge_media_wallet_needs_media
  CHECK (media_id IS NOT NULL OR wallet_id IS NULL);
ALTER TABLE edge_media ADD COLUMN originality_sig_sha256 bytea
  CHECK (originality_sig_sha256 IS NULL OR octet_length(originality_sig_sha256) = 32);
ALTER TABLE edge_media ADD COLUMN key_index integer;
ALTER TABLE edge_media ADD COLUMN pwd_pack_sha256 bytea
  CHECK (pwd_pack_sha256 IS NULL OR octet_length(pwd_pack_sha256) = 32);
ALTER TABLE edge_event_setting ADD COLUMN name text;
ALTER TABLE edge_event_setting ADD COLUMN wallet_limits jsonb NOT NULL DEFAULT '{}';
ALTER TABLE edge_device ADD COLUMN cash_desk_account_id uuid;
ALTER TABLE edge_staff ADD COLUMN user_id uuid;
ALTER TABLE edge_cash_session ADD COLUMN opened_by_user_id uuid;
ALTER TABLE edge_cash_session ALTER COLUMN cash_account_id DROP NOT NULL;

-- R-24 : `usable_on_edge` est faux tant que `edge_authority.activated_at` est NULL ; quand il est
-- posé, les sessions OUVERTES déjà connues et ouvertes avant la bascule deviennent utilisables.
-- (Fonction de déclencheur : exécutée avec les droits de l'appelant, aucun EXECUTE à accorder.)
CREATE FUNCTION edge_cash_session_activation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE edge_cash_session SET usable_on_edge = true
   WHERE status = 'OPEN' AND closed_at IS NULL AND opened_at < NEW.activated_at;
  RETURN NULL;
END $$;
CREATE TRIGGER edge_cash_session_activation AFTER UPDATE OF activated_at ON edge_authority
  FOR EACH ROW WHEN (OLD.activated_at IS NULL AND NEW.activated_at IS NOT NULL)
  EXECUTE FUNCTION edge_cash_session_activation();

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
