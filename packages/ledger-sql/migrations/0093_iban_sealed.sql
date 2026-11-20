-- Migration 0093 : IBAN toujours sous enveloppe (mission durcissements-serveur, lot WP02 ; FR-012 ; plan IC-07).
-- Le chiffrement se fait côté API (clé de configuration, WP08) ; la base refuse seulement toute écriture en clair.
-- NOT VALID : les lignes anciennes sont tolérées, toute écriture à venir porte l'enveloppe `enc:v1:`.
ALTER TABLE refund_request ADD CONSTRAINT refund_request_iban_sealed
  CHECK (iban IS NULL OR iban LIKE 'enc:v1:%') NOT VALID;
ALTER TABLE payout ADD CONSTRAINT payout_iban_sealed
  CHECK (iban IS NULL OR iban LIKE 'enc:v1:%') NOT VALID;
