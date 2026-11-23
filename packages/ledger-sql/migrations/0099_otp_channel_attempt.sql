-- Migration 0099 : canaux essayés d'une chaîne d'envoi des codes (mission serveur-app-festivalier, lot WP03 ;
-- FR-011 à FR-013 ; NFR-002 ; plan IC-06). La table note le canal, le fournisseur et le résultat, JAMAIS le
-- code, son empreinte, un numéro ni un texte libre : le code reste en mémoire du processus.
-- Aucun GRANT : WP04 pose SELECT, INSERT et UPDATE (confirmed_at, failed_reason). Aucun DELETE.
-- Retouche d'une table de 0080 : UNIQUE (id, operator_id) sur otp_challenge (ajout, aucune ligne réécrite),
-- cible de la clé composite qui interdit de désigner le défi d'un autre prestataire.
-- Fichier à faire relire : absence de tout code ou numéro, RLS forcée, contrainte ajoutée sur otp_challenge.

ALTER TABLE otp_challenge ADD CONSTRAINT otp_challenge_id_operator_key UNIQUE (id, operator_id);

CREATE TABLE otp_channel_attempt (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id  uuid NOT NULL REFERENCES party(id),
  challenge_id uuid NOT NULL,
  channel      text NOT NULL CHECK (channel IN ('WHATSAPP', 'SMS_PRIMARY', 'SMS_FALLBACK')),
  provider     text NOT NULL CHECK (char_length(provider) BETWEEN 1 AND 64),
  sent_at      timestamptz NOT NULL DEFAULT clock_timestamp(),
  confirmed_at timestamptz,
  -- Raison en capitales commençant par une lettre (NO_WHATSAPP, TIMEOUT, REFUSED...) : un texte libre ou une
  -- suite de chiffres pourrait recevoir un numéro ou un code.
  failed_reason text CHECK (failed_reason ~ '^[A-Z][A-Z0-9_]{0,39}$'),
  CHECK (confirmed_at IS NULL OR failed_reason IS NULL),
  FOREIGN KEY (challenge_id, operator_id) REFERENCES otp_challenge (id, operator_id)
);
CREATE INDEX otp_channel_attempt_challenge_idx ON otp_channel_attempt (challenge_id, sent_at);
ALTER TABLE otp_channel_attempt ENABLE ROW LEVEL SECURITY;
ALTER TABLE otp_channel_attempt FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON otp_channel_attempt
  USING (operator_id = current_setting('app.operator_id', true)::uuid)
  WITH CHECK (operator_id = current_setting('app.operator_id', true)::uuid);
REVOKE ALL ON otp_channel_attempt FROM PUBLIC;
