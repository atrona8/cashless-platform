-- edge-0004 (WP20, numéro attribué par l'orchestrateur) : durcissement de la file des décisions.
--
-- 1. Décision 19 du porteur : un déclencheur BEFORE TRUNCATE refuse sur edge_authority, edge_op et
--    edge_audit. `edge_op` et `edge_audit` en portaient déjà un depuis edge-0001 : il est redéclaré
--    ici (CREATE OR REPLACE) pour que la migration porte à elle seule la garantie des trois tables.
--    `edge_authority` n'en avait pas : TRUNCATE puis INSERT remettait `epoch` à 0 sous `edge_app`.
--    RENFORCEMENT non demandé, signalé : le même refus sur `edge_chain_head` (TRUNCATE puis INSERT
--    remettait la numérotation à zéro) et `edge_outgoing_batch`.
-- 2. `edge_outgoing_batch.body` : le corps EXACT envoyé au central (signature comprise), pour
--    renvoyer le même lot à l'identique après une coupure (B.7-7). Un déclencheur le rend immuable,
--    interdit la suppression et n'autorise que PREPARED -> SENT -> DONE, ou PREPARED -> DONE (lot clos avant envoi), jamais de retour.
--    `done_reason` : RESULTS (résultats appliqués) ou SUPERSEDED (refus du central : le lot est clos
--    sans résultat, les opérations non résolues repartent dans un NOUVEAU lot, jamais le même id).
--
-- Rien ici n'élargit un droit : tout est un contrôle de plus. Limite connue, non levée ici : le
-- propriétaire unique `edge_app` peut encore DISABLE TRIGGER ou DROP (plan : rôle unique).

CREATE OR REPLACE TRIGGER edge_op_no_truncate BEFORE TRUNCATE ON edge_op
  FOR EACH STATEMENT EXECUTE FUNCTION edge_forbid_change();
CREATE OR REPLACE TRIGGER edge_audit_no_truncate BEFORE TRUNCATE ON edge_audit
  FOR EACH STATEMENT EXECUTE FUNCTION edge_forbid_change();
CREATE TRIGGER edge_authority_no_truncate BEFORE TRUNCATE ON edge_authority
  FOR EACH STATEMENT EXECUTE FUNCTION edge_forbid_change();
CREATE TRIGGER edge_chain_head_no_truncate BEFORE TRUNCATE ON edge_chain_head
  FOR EACH STATEMENT EXECUTE FUNCTION edge_forbid_change();
CREATE TRIGGER edge_outgoing_batch_no_truncate BEFORE TRUNCATE ON edge_outgoing_batch
  FOR EACH STATEMENT EXECUTE FUNCTION edge_forbid_change();

ALTER TABLE edge_outgoing_batch ADD COLUMN body text;
ALTER TABLE edge_outgoing_batch ADD COLUMN done_reason text
  CHECK (done_reason IS NULL OR done_reason IN ('RESULTS', 'SUPERSEDED'));

CREATE FUNCTION edge_outgoing_batch_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'DELETE interdit sur edge_outgoing_batch' USING ERRCODE = 'restrict_violation';
  END IF;
  IF (to_jsonb(NEW) - ARRAY['status', 'sent_at', 'done_reason'])
     IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status', 'sent_at', 'done_reason']) THEN
    RAISE EXCEPTION 'edge_outgoing_batch : le lot ne change pas (batch_id %)', OLD.batch_id
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NOT ((OLD.status = 'PREPARED' AND NEW.status IN ('PREPARED', 'SENT', 'DONE'))
          OR (OLD.status = 'SENT' AND NEW.status IN ('SENT', 'DONE'))
          OR (OLD.status = 'DONE' AND NEW.status = 'DONE')) THEN
    RAISE EXCEPTION 'edge_outgoing_batch : transition % -> % interdite', OLD.status, NEW.status
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status = 'DONE' AND NEW.done_reason IS DISTINCT FROM OLD.done_reason THEN
    RAISE EXCEPTION 'edge_outgoing_batch : lot clos' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER edge_outgoing_batch_guard BEFORE UPDATE OR DELETE ON edge_outgoing_batch
  FOR EACH ROW EXECUTE FUNCTION edge_outgoing_batch_guard();

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
