# Quickstart: Remboursement partiel en espèces au guichet

Parcours de recette, une fois la mission livrée (base de test, faux du terminal en développement).

1. Le prestataire autorise la fonction : nouvelle version de configuration prestataire avec
   `cash_partial_refund_allowed = true`.
2. L'organisateur l'active : `updateEvent` avec `cash_partial_refund_enabled = true` (immédiat en `DRAFT`, à deux
   personnes en `LIVE`).
3. Au guichet (`TOPUP_DESK`), un caissier ouvre une session de caisse et recharge un bracelet de 20 000 XOF en espèces.
4. Le caissier lit le bracelet et appelle `refundPartialCash` avec `amount = 5 000` : réponse `201`, `cash_handed` =
   5 000 moins les frais, `paid_balance_after` = 15 000.
5. Le festivalier paie un achat avec le même bracelet : accepté.
6. Seuil à 50 000 XOF : deux rendus de 30 000 et 25 000 le même jour (après recharge suffisante) : le second répond
   `403 APPROVAL_REQUIRED` sans jeton, `201` avec un jeton d'une autre personne.
7. L'organisateur désactive la fonction : le rendu suivant répond `422 REFUND_NOT_ALLOWED`.
8. Le superviseur ferme la session : l'écart tient compte des rendus partiels.

Commandes de preuve (à préciser par les lots) : `SKIP_LATENCY=1 npx jest test/integration/media/partial-cash-refund
--runInBand` dans `apps/api` ; `node tools/contract-stability/check.mjs` ; `pg_prove` de la migration 0100 en CI.
