---
affected_files: []
cycle_number: 2
mission_slug: passerelle-locale-01M6NM1S
reproduction_command:
reviewed_at: '2026-11-10T13:40:52Z'
reviewer_agent: claude
wp_id: WP22
---

# Relecture WP22 (1bb130bb), cycle 2 : un test manquant

1. [MAJEUR, test seulement] Mutant survivant dans `cashTopupCeiling`
   (`cash-topup.service.ts`) : remplacer `event.currency === 'XOF' ? DEFAULT_CASH_TOPUP_CEILING : 0n`
   par `DEFAULT_CASH_TOPUP_CEILING` ne fait échouer aucun test (159/159 verts sur test/counter +
   test/replication). Tous les tests posent `currency: 'XOF'`. Le critère « autre devise sans
   réglage `edge_terms.max_cash_topup` : refus » (décision 21, échec fermé) n'est donc pas prouvé ;
   le mutant élargit le plafond (500 000 dans une devise inconnue).
   Correction : un test dans `cash-topup.spec.ts` (ou `edge-terms.spec.ts`) avec une devise autre
   que XOF (ex. EUR) et sans `max_cash_topup` : la recharge est refusée, rien n'est écrit ; et avec
   `max_cash_topup` renseigné dans cette devise : plafond lu. Aucun changement de code attendu.
Vérifié et OK : 5 mutants de `staff-token.guard.ts` (terminal, status OPEN, closed_at, HS256, route)
tués ; lecture de `wallet_limits` (5 échecs), page non finale écrasant `edge_terms`, non-remise à NULL,
borne `>= 1`, bracelet ACTIVE, lots différents, FROM_BALANCE, frais > 0 : chacun tue un test.
tsc propre ; test/counter, replication, queue : 239/239 verts. Code remis à l'identique.
Note (info) : mutant « retrait du contrôle `kid` absent » équivalent (la recherche de clé refuse).
