-- edge-0008 (WP23) : clés de signature des snapshots de la passerelle et résultats locaux des
-- opérations de lots de terminal. Numéro attribué par l'orchestrateur (0006 = WP21, 0007 = WP22) ;
-- aucune dépendance à leurs objets. Rien ici n'élargit un droit, n'ajoute un
-- secret ni ne retire un contrôle : aucune clé privée (le port matériel la garde), aucun mot de
-- passe, aucun GRANT (propriétaire seul).
--
--  * edge_snapshot_signing_key : parties PUBLIQUES des clés de signature de snapshot (interfaces.md
--    §4 `KeyUse = 'snapshot'`). Le port n'a qu'une clé par usage : à sa rotation, la ligne ACTIVE
--    passe RETIRED. `config.snapshot_keys` publie au plus DEUX clés (rotation, OA:12640).
--  * edge_offline_op_result : résultat LOCAL d'une opération d'un lot de terminal (statut, parts
--    couvertes). Sert au résultat du lot rendu au terminal, à l'exposition cumulée (plafonds), à
--    la cible d'une annulation et à l'idempotence par (terminal, numéro). Jamais plus fort que le
--    résultat du central quand celui-ci est revenu (`edge_op.central_status`, lu à la lecture).
CREATE TABLE edge_snapshot_signing_key (
  key_id     text PRIMARY KEY CHECK (key_id <> ''),
  seq        integer NOT NULL UNIQUE CHECK (seq >= 1),
  public_key bytea NOT NULL UNIQUE,
  status     text NOT NULL CHECK (status IN ('ACTIVE', 'RETIRED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  retired_at timestamptz,
  CHECK ((status = 'RETIRED') = (retired_at IS NOT NULL))
);
-- Une seule clé ACTIVE par passerelle.
CREATE UNIQUE INDEX edge_snapshot_signing_key_one_active
  ON edge_snapshot_signing_key ((true)) WHERE status = 'ACTIVE';

CREATE TABLE edge_offline_op_result (
  device_id       uuid NOT NULL,
  seq             bigint NOT NULL CHECK (seq >= 1),
  batch_id        uuid NOT NULL,
  edge_seq        bigint REFERENCES edge_op (edge_seq),
  content_sha256  bytea NOT NULL CHECK (octet_length(content_sha256) = 32),
  type            text NOT NULL,
  wallet_id       uuid,
  media_id        uuid,
  amount          bigint NOT NULL DEFAULT 0 CHECK (amount >= 0),
  paid_covered    bigint NOT NULL DEFAULT 0 CHECK (paid_covered >= 0),
  promo_covered   bigint NOT NULL DEFAULT 0 CHECK (promo_covered >= 0),
  status          text NOT NULL,
  reject_reason   text,
  result          jsonb NOT NULL,
  reversed_by_seq bigint,
  rendered_at     timestamptz NOT NULL,
  PRIMARY KEY (device_id, seq)
);
CREATE INDEX edge_offline_op_result_batch ON edge_offline_op_result (batch_id, seq);
CREATE INDEX edge_offline_op_result_media ON edge_offline_op_result (device_id, media_id);

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
