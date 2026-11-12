---
affected_files: []
cycle_number: 1
mission_slug: passerelle-locale-01M6NM1S
reproduction_command:
reviewed_at: '2026-11-10T11:22:08Z'
reviewer_agent: claude
wp_id: WP21
---

# WP21 - relecture cycle 1 (rejet) - code e9b7189a + af95d855

Preuves : `SKIP_LATENCY=1 npx jest test/sales --runInBand` 82/82 (2 ignorés), latence 2/2 (série p50/p95/p99 =
65/80/97 ms ; concurrence 10 = 228/362/465 ms), `tsc` propre. Mutations tuées : garde d'autorité (paiement,
annulation), FOR UPDATE, idempotence, tap d'un autre terminal, tap consommé, fenêtre de rejeu, X-Approval-Token,
fenêtre d'annulation, double annulation, montant d'annulation, autre vendeur, session fermée, nonce, VOID du refus,
QR client, solde effectif. Aucun défaut de code trouvé ; les constats sont des preuves absentes.

1. **MAJEUR - plafonds par vente et horaire sans test** (mutants survivants). Remplacer `amount > SALE_CEILING` ou
   le test `TERMINAL_HOURLY_CEILING` par `false` dans `payments.service.ts` : 82/82 verts. `grep CEILING test/sales`
   est vide. Correction : tests à la borne (50_000 accepté, 50_001 refusé `AMOUNT_OUT_OF_RANGE` avec détail
   `EDGE_SALE_CEILING`, rien consommé hors VOID) et horaire (cumul des PURCHASE du terminal sur 1 h glissante, refus
   `EDGE_HOURLY_CEILING`, la vente hors de l'heure ne compte plus ; un autre terminal n'est pas compté).
2. **MAJEUR - recul d'horloge d'annulation non prouvé.** Retirer `elapsedMs < 0 ||` dans `reversals.service.ts` :
   82/82 verts. Le test « horloge reculée de 2 h » n'exige que `status >= 400` : il passe par un autre refus (preuve
   `created`/CLOCK_SKEW). Correction : exiger le code attendu et isoler la garde (preuves valides, seul `GatewayClock`
   recule), aucun solde rendu, VOID ou rien d'écrit selon le contrat.
3. **MAJEUR - expiration de session vendeur non prouvée** (`s.expires_at > $3`, paiement et annulation) : mutant
   survivant, 82/82. Correction : test session expirée -> `409 VENDOR_SESSION_INVALID` pour createPayment et
   reversePayment, VOID consommé.
4. **MINEUR - annulation d'une vente d'un autre terminal** : `sale.device_id !== device.deviceId` retiré, mutant
   survivant ; le test accepte `[404, 422]`. Correction : cas « même vendeur, autre terminal » avec code exact
   (`REVERSAL_NOT_ALLOWED` ou 404 neutre, à trancher avec le contrat) et assertion du code.
5. **MINEUR - NFR-005 à concurrence 10 non tenue** : mesuré p95 362 / p99 465 ms (le prompt exige p95 <= 200 ms,
   p99 <= 500 ms ; le test borne à 1 000/2 000 ms). Écart documenté dans le test mais à signaler au porteur dans le
   compte rendu et à reporter à WP25 (`docs/POINTS_OUVERTS.md`) ; la mesure série est conforme.
6. **MINEUR - `ReleaseMediaRefusal`** répond avant tout garde, donc à un appelant non authentifié, avec l'époque
   détenue (info faible). À signaler ; envisager d'exiger les preuves ou de ne pas rendre l'époque si le contrat le permet.
7. **NOTE** - `PROMO_FIRST = true` figé dans `sales-support.ts` au lieu du réglage central répliqué ; vérifier avec
   WP18/WP25 (`spend_order`) que le central ne le rend pas configurable, sinon écart de répartition au rejeu.

Fichiers à faire relire par une personne : `payments.service.ts`, `reversals.service.ts`, `unavailable-operations.ts`.
