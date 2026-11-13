-- edge-0009 (WP25 partie A2, décision 50, ADR-187, OP-N119) : un lot sortant SANS opération, qui ne
-- porte que des ordres locaux (`local_orders`). L'intervalle `edge_seq_from .. edge_seq_to` d'un tel
-- lot est vide : `edge_seq_from = dernier numéro + 1` et `edge_seq_to = edge_seq_from - 1` ;
-- `edge_seq` et la chaîne ne bougent pas. Seule la contrainte d'intervalle de `edge_outgoing_batch`
-- est relâchée (d'un cran) ; rien d'autre ne change : aucun droit, aucun secret, aucun contrôle
-- retiré (le central refuse un lot vide sans ordre).
DO $$
DECLARE c text;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint
            WHERE conrelid = 'edge_outgoing_batch'::regclass AND contype = 'c'
              AND pg_get_constraintdef(oid) LIKE '%edge_seq_to >= edge_seq_from%'
  LOOP
    EXECUTE format('ALTER TABLE edge_outgoing_batch DROP CONSTRAINT %I', c);
  END LOOP;
END $$;
ALTER TABLE edge_outgoing_batch ADD CONSTRAINT edge_outgoing_batch_span
  CHECK (edge_seq_to >= edge_seq_from - 1);
