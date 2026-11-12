-- edge-0006 (WP21, numéro attribué par l'orchestrateur ; WP22 prend edge-0007, WP23 edge-0008) :
-- ce que les ventes de la passerelle doivent garder et que edge-0001 ne portait pas. Aucun droit élargi, aucun contrôle retiré.
--
--  * edge_tap.reading : la lecture complète reçue du terminal (objet `TapInput`). Le central la
--    rejoue depuis l'objet `tap` de l'opération (R-18, A07 : compteur, UID, signature) ; le
--    paiement par `tap_id` doit donc pouvoir la reconstituer. Jamais envoyée avec le `tap_id`.
--  * edge_tap : un compteur ne sert qu'une fois par bracelet (anti-clone, miroir de
--    `media_tap(media_id, counter)` du central).
--  * edge_idempotency.sale : décision interne d'une vente (portefeuille, parts payée et offerte),
--    jamais rendue au terminal ; sert à l'annulation, qui rend exactement ce qui a été prélevé
--    même après la purge des deltas (A08).
--  * Index : recherche d'une vente par `transaction_id` local, plafond horaire par terminal.
ALTER TABLE edge_tap ADD COLUMN reading jsonb;
CREATE UNIQUE INDEX edge_tap_token_counter ON edge_tap (token_hash, counter);
CREATE INDEX edge_tap_device ON edge_tap (device_id, tap_id);

ALTER TABLE edge_idempotency ADD COLUMN sale jsonb;
CREATE INDEX edge_idempotency_transaction
  ON edge_idempotency ((response ->> 'transaction_id')) WHERE status_code = 201;

CREATE INDEX edge_op_purchase_device_time
  ON edge_op (device_id, recorded_at) WHERE type = 'PURCHASE';

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;

-- Les `tap_id` de la passerelle ne recoupent jamais ceux du central (R-18) : la suite locale part de
-- 2^52 (entier sûr de JSON), très au-delà de `media_tap.id`. Un `tap_id` du central présenté ici
-- n'existe donc pas dans cette table (`409 TAP_UNUSABLE`), même sur un terminal qui vient de le lire.
ALTER SEQUENCE edge_tap_tap_id_seq START WITH 4503599627370496 MINVALUE 4503599627370496
  RESTART WITH 4503599627370496;

CREATE INDEX edge_idempotency_reverses
  ON edge_idempotency ((response ->> 'reverses_id')) WHERE status_code = 201;
