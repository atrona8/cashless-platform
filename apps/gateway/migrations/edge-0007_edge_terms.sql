-- edge-0007 (WP22, correction cycle 2) : `edge_terms` de la page de réplication (décisions 21 et 36,
-- ADR-172) : plafond par recharge en espèces, frais d'activation, conditions de caution par lot.
-- Une seule colonne JSON sur la ligne de réglages de l'événement ; NULL = « inconnu », et la
-- passerelle garde son refus (échec fermé). Écrite par la seule réplication, sur la dernière page
-- d'une passe (absente de cette page : remise à NULL). Rien ici n'élargit un droit.
ALTER TABLE edge_event_setting ADD COLUMN edge_terms jsonb
  CHECK (edge_terms IS NULL OR jsonb_typeof(edge_terms) = 'object');
