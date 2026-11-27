---
affected_files: []
cycle_number: 2
mission_slug: adaptateurs-fournisseurs-choisis-01M8BXJA
reproduction_command:
reviewed_at: '2026-11-26T15:15:00Z'
reviewer_agent: claude
wp_id: WP07
---

# WP07 — cycle 2 : décisions du porteur du 26/11/2026 (après approbation du cycle 1)

1. **3-D Secure `attempt_acknowledged` (décision : non crédité).** Seul `authenticated` vaut `SUCCEEDED`.
   `attempt_acknowledged` → `NOT_PERFORMED` (la recharge arrive « reçue, non créditée », anomalie existante). Test par
   valeur et mutation (remettre `SUCCEEDED` → rouge). Mettre à jour `contracts/psp-fournisseurs.md` n'est pas ton
   fichier : signale-le dans la note (WP13).
2. **Litige rattaché par relecture (décision).** `charge.dispute.created` → `NOTIFICATION` de kind `DISPUTE` avec
   `confirmationRequired: true` et `reference.providerPaymentRef = <payment_intent>` (jamais de crédit/débit sur la seule
   notification). Ajoute à l'adaptateur une méthode documentée qui, à partir du `payment_intent`, retrouve la session :
   `GET /v1/checkout/sessions?payment_intent=<pi>&limit=1` → `{ merchantReference: client_reference_id,
   providerPaymentRef: <cs_…> }` ou `null`. Ajoute au port une méthode FACULTATIVE `resolvePaymentReference?(ref,
   secrets)` (retouche hors carte de `psp-adapter.port.ts`, au plus juste, nommée dans la note). Le branchement dans la
   réception et le confirmateur sera fait par WP03 (cycle suivant). Tests contre le faux serveur, mutations.
3. Réserve du relecteur : `expires_at` rendu stable pour un même `pspTopupId` (dérivé d'une horloge passée au moment de la
   première tentative, ou corps réutilisé), pour qu'une reprise n'envoie jamais la même `Idempotency-Key` avec un autre
   corps ; test.
