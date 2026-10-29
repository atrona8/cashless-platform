---
affected_files: []
cycle_number: 2
mission_slug: recharges-caisses-psp-01M5YEBA
reproduction_command:
reviewed_at: '2026-10-29T11:44:23Z'
reviewer_agent: claude
wp_id: WP14
---

# WP14 — cycle 2 : correctifs avant fusion (décisions du porteur du 29/10/2026)

Le relecteur distinct a approuvé le cycle 1 (aucun bloquant dans le périmètre initial ; batterie complète de
lane-m : 2635 verts, 0 échec). Le porteur a ensuite décidé de corriger avant la fusion trois défauts relevés par
WP14 et sa relecture. Ces décisions lèvent, pour ce cycle seulement, l'arbitrage « aucune retouche de code de
production » de WP14, sur les seuls fichiers nécessaires.

## 1. Interblocage fermeture de session / recharges espèces (bloquant, décision : corriger)

`cash-concurrency.spec.ts` (`it.failing`) : une fermeture (`begin_cash_close`, WP02, 0036) simultanée à 2
recharges espèces ou plus (`createCashTopup`, WP09) donne des 500 `40P01`. Attendu :
- trouver l'ordre de verrous en conflit (journal du serveur, `pg_locks`) et imposer le même ordre aux deux
  chemins (par ex. session de caisse puis portefeuille puis comptes), sans élargir aucun droit ;
- à défaut, et seulement en complément, un nouvel essai borné côté API sur `40P01` (jamais de 500 au client) ;
- `it.failing` repasse en `it` ; ajouter une entrée POINTS_OUVERTS si une limite subsiste.

## 2. `[A8-DETTE]` / OP-N84 (bloquant, décision : lever avant fusion)

`cashless_app` garde EXECUTE sur `take_deposit`, `refund_deposit`, `refund_cash_due`. Attendu : le moteur passe
par les fonctions dédiées prévues (voir `contracts/database-rights.md` et WP05), retrait des droits (migration
suivante + `post-roles.sql` si c'est là qu'ils sont accordés), test `[A8-DETTE]` inversé (prouve que le droit
est retiré), OP-N84 marqué levé avec preuves, ADR-135 mis à jour.

## 3. OP-N83 / 0039 : décision B tenue en partie (bloquant, décision du porteur : corriger)

Le cas contestation → perte → déblocage « contestation » remet encore ACTIVE un portefeuille bloqué pour deux
causes. ADR-134 dit « décision du porteur » pour cette limite : faux, le porteur ne l'a pas acceptée. Attendu :
- le déblocage par contestation ne remet ACTIVE que si AUCUNE autre cause de blocage n'est active, quel que soit
  l'ordre des événements (stocker la cause, ou vérifier les autres causes au déblocage) ;
- tests pgTAP : perte → contestation → déblocage ; contestation → perte → déblocage ; cause tierce puis deux
  contestations (tue la mutation survivante « suppression de `AND c.wallet_blocked` ») ;
- ADR-134 et OP-N83 corrigés (plus de « décision du porteur » pour une limite non validée).

## Mineurs à faire au passage

- `media-port-swap.spec.ts` : borner le contenu admis des trois contrôleurs de WP09 si c'est simple.

## Fichiers à faire relire par une personne

Les migrations nouvelles ou modifiées, `post-roles.sql`, le code des chemins de verrous changés.
