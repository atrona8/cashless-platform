-- Migration 0100 : activation par événement du rendu partiel en espèces au guichet (mission 9c,
-- remboursement-partiel-especes, lot WP01 ; FR-005 ; décision du porteur du 23/11/2026 ; noms figés par
-- kitty-specs/remboursement-partiel-especes-01M84932/interfaces.md).
-- Valeur par défaut false : un événement existant reste sans rendu partiel après migration.
-- Aucun GRANT ni REVOKE : cashless_app a déjà SELECT, INSERT et UPDATE au niveau de la table event.
-- Index partiel : le cumul du jour des rendus partiels d'un portefeuille (WP04) lit journal_transaction ; sans lui
-- le plan passe par (event_id, type) et parcourt tous les WALLET_REFUND de l'événement (plan noté dans le lot WP01).
-- Le prédicat doit être repris MOT POUR MOT par la requête de WP04 pour que l'index serve.

ALTER TABLE event ADD COLUMN cash_partial_refund_enabled boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN event.cash_partial_refund_enabled IS
  'Rendu partiel en espèces au guichet activé par l''organisateur pour l''événement ; permis seulement si le prestataire l''autorise (contrôle applicatif).';

CREATE INDEX journal_transaction_partial_refund_idx ON journal_transaction (ledger_id, recorded_at)
  WHERE type = 'WALLET_REFUND' AND metadata->>'partial_cash_refund' = 'true';
