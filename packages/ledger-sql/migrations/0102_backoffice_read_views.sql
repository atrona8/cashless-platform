-- Mission 11b routes-backoffice, lot WP02 : vues de lecture du back-office (research D5, D6 ; interfaces.md §2).
-- Deux vues `security_invoker` : elles s'exécutent avec les droits ET la RLS de l'appelant (cashless_app sous
-- app.operator_id) ; le propriétaire qui les lirait contournerait la RLS, ce qu'aucun code de l'API ne fait.
-- Aucun droit nouveau sur les tables : SELECT sur les vues seulement (post-roles.sql § 16 retire l'INSERT et
-- l'UPDATE que roles.sql rend à toute relation, vues comprises).

-- 0. Index de la liste des ventes d'un événement (NFR-001), justifié par la mesure de 200 000 ventes (note de lane
-- WP02) : sans lui, première page = Seq Scan parallèle de journal_transaction (p95 297 ms), filtre « annulées »
-- 603 ms (> 500) ; avec lui, première page 7 ms, page profonde 7 ms, filtre point de vente 34 ms, commerçant 16 ms,
-- plage de dates 7 ms, annulées 305 ms. Partiel sur PURCHASE, dans l'ordre exact de la pagination par curseur.
CREATE INDEX journal_transaction_sales_idx ON journal_transaction (event_id, occurred_at DESC, id DESC)
 WHERE type = 'PURCHASE';

-- 1. sale_overview : une ligne par vente PURCHASE, SANS donnée du festivalier (ni portefeuille, ni bracelet).
-- Chaque jointure rend au plus une ligne par vente (pas de duplication d'une vente à plusieurs lignes) :
--   * sale_attribution : clé primaire transaction_id ; jointure externe (vente de back-office sans attribution) ;
--   * device : clé primaire ; terminal de l'attribution, à défaut celui de l'écriture ;
--   * première ligne de vente (line_no minimal) : seulement si le terminal n'a pas de point de vente ;
--   * compte MERCHANT crédité (LIMIT 1, comme payment-read.service.ts) puis participation ;
--   * montant : somme des mouvements positifs des comptes de portefeuille (même définition que PaymentResult) ;
--   * annulation : journal_transaction_reverses_once (index unique sur reverses_id).
-- occurred_at est la date d'origine de la vente : une vente hors ligne la garde (colonne source de l'écriture,
-- fixée à l'import, jamais l'heure de synchronisation qui est recorded_at).
CREATE VIEW sale_overview WITH (security_invoker = true) AS
SELECT t.id                       AS transaction_id,
       t.operator_id,
       t.ledger_id,
       t.event_id,
       t.occurred_at,
       w.amount,
       l.currency,
       coalesce(d.pos_id, fl.pos_id) AS pos_id,
       mp.merchant_id,
       m.participation_id,
       sa.vendor_id,
       coalesce(sa.device_id, t.device_id) AS device_id,
       t.source,
       sa.channel,
       r.id                       AS reversal_transaction_id
  FROM journal_transaction t
  JOIN ledger l ON l.id = t.ledger_id
  LEFT JOIN sale_attribution sa ON sa.transaction_id = t.id
  LEFT JOIN device d ON d.id = coalesce(sa.device_id, t.device_id)
  LEFT JOIN LATERAL (SELECT s.pos_id FROM sale_line s WHERE s.transaction_id = t.id
                      ORDER BY s.line_no LIMIT 1) fl ON true
  LEFT JOIN LATERAL (SELECT a.participation_id FROM posting p JOIN account a ON a.id = p.account_id
                      WHERE p.transaction_id = t.id AND a.purpose = 'MERCHANT'
                      ORDER BY p.line_no LIMIT 1) m ON true
  LEFT JOIN merchant_participation mp ON mp.id = m.participation_id
  LEFT JOIN LATERAL (SELECT coalesce(sum(p.amount), 0)::bigint AS amount
                       FROM posting p JOIN account a ON a.id = p.account_id
                      WHERE p.transaction_id = t.id AND p.amount > 0
                        AND a.purpose IN ('WALLET_PAID', 'WALLET_PROMO')) w ON true
  LEFT JOIN journal_transaction r ON r.reverses_id = t.id
 WHERE t.type = 'PURCHASE';
REVOKE ALL ON sale_overview FROM PUBLIC;
GRANT SELECT ON sale_overview TO cashless_app;

-- 2. anomaly_overview : colonnes d'anomaly + événement + devise + « classable » (0101).
-- event_id : l'événement de la transaction liée ; à défaut celui du grand livre s'il est de portée EVENT ; NULL
-- sinon (anomalie sans transaction sur un grand livre d'organisateur, ou sans grand livre : signal de bracelet
-- sans portefeuille). currency : celle du grand livre, NULL sans grand livre.
CREATE VIEW anomaly_overview WITH (security_invoker = true) AS
SELECT an.id, an.operator_id, an.ledger_id, an.kind, an.media_id, an.device_id, an.seq, an.created_at,
       an.transaction_id, an.amount, an.status, an.resolution_tx_id, an.loss_bearer, an.detail, an.batch_id,
       an.classified_by, an.classified_at, an.classification_reason,
       coalesce(tx.event_id, CASE WHEN l.scope_type = 'EVENT' THEN l.scope_id END) AS event_id,
       l.currency,
       anomaly_classifiable(an.kind) AS classifiable
  FROM anomaly an
  LEFT JOIN ledger l ON l.id = an.ledger_id
  LEFT JOIN journal_transaction tx ON tx.id = an.transaction_id;
REVOKE ALL ON anomaly_overview FROM PUBLIC;
GRANT SELECT ON anomaly_overview TO cashless_app;
