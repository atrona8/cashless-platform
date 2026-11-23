-- Migration 0098 : avis de solde provisoire d'un portefeuille (mission serveur-app-festivalier, lot WP03 ;
-- FR-010, FR-013 ; NFR-004). Aucun GRANT : les droits d'EXECUTE sont posés par WP04.
-- Vrai si le solde affiché peut être provisoire : un terminal non révoqué a reçu un instantané hors ligne de
-- ce grand livre (offline_snapshot_ack) plus récent que son dernier lot remonté (offline_batch) SUR CE GRAND
-- LIVRE, ou n'a remonté aucun lot sur ce grand livre. Portée : grand livre EVENT dont l'événement n'est pas CLOSED ; ORGANIZER et OPERATOR_BILLING :
-- faux (aucun événement à comparer). Tous les statuts de lot comptent (le terminal a remonté quelque chose).
-- SECURITY INVOKER : la RLS de l'appelant s'applique ; portefeuille inconnu ou d'un autre prestataire : faux.

CREATE INDEX IF NOT EXISTS offline_batch_device_received_idx ON offline_batch (device_id, received_at);
CREATE INDEX IF NOT EXISTS offline_batch_device_ledger_received_idx
  ON offline_batch (device_id, ledger_id, received_at);
CREATE INDEX IF NOT EXISTS offline_snapshot_ack_ledger_device_idx
  ON offline_snapshot_ack (ledger_id, device_id, acked_at);

CREATE FUNCTION wallet_pending_offline_notice(p_wallet uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER AS $$
  SELECT EXISTS (
    SELECT 1
      FROM wallet w
      JOIN ledger l ON l.id = w.ledger_id AND l.scope_type = 'EVENT'
      JOIN event e ON e.id = l.scope_id AND e.status <> 'CLOSED'
     WHERE w.id = p_wallet
       AND EXISTS (
         SELECT 1
           FROM offline_snapshot_ack a
           JOIN device d ON d.id = a.device_id AND d.status <> 'REVOKED'
          WHERE a.ledger_id = w.ledger_id
            AND a.acked_at > coalesce((SELECT max(b.received_at) FROM offline_batch b
                                        WHERE b.device_id = d.id AND b.ledger_id = w.ledger_id),
                                      '-infinity'::timestamptz)));
$$;
REVOKE ALL ON FUNCTION wallet_pending_offline_notice(uuid) FROM PUBLIC;
