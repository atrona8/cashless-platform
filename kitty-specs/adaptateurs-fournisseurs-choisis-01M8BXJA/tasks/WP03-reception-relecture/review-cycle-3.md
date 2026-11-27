---
affected_files: []
cycle_number: 3
mission_slug: adaptateurs-fournisseurs-choisis-01M8BXJA
reproduction_command:
reviewed_at: '2026-11-26T15:48:17Z'
reviewer_agent: claude
wp_id: WP03
---

# WP03 — cycle 3 : litige Stripe non rattaché (décision du porteur du 26/11/2026)

Constat (orchestrateur) : au cycle 2, un litige Stripe que la relecture ne rattache pas laisse seulement le journal
`psp.signal.unmatched`, et l'événement est déjà marqué traité. Aujourd'hui, un litige sans correspondance passe en
`UNMATCHED` : `EventDispatcher` le retente, puis `expireUnmatched` (`webhooks/event-dispatcher.ts`) enregistre une
anomalie `UNMATCHED_EXPIRED` au bout de 24 h. Le cycle 2 retire donc un contrôle : refusé (règle 1).

Décision : **garder l'anomalie en base.** Un litige Stripe non rattaché (résolution `null`, adaptateur sans
`resolvePaymentReference`, recharge introuvable, erreur de résolution) suit la voie actuelle « sans correspondance » :
l'événement reste `UNMATCHED`, il est retenté par les nouvelles tentatives existantes, puis il devient une anomalie
au bout de 24 h via `expireUnmatched`. Aucun effet sur le grand livre avant le rattachement.
- Il ne doit jamais être marqué traité tant qu'il n'est pas rattaché.
- Quand une nouvelle tentative le rattache, il passe au répartiteur existant comme au cycle 2.
- La borne d'une résolution par minute reste en place.

Tests :
- non rattaché → statut `UNMATCHED` ;
- non rattaché après 24 h → anomalie `UNMATCHED_EXPIRED` ;
- rattaché à une tentative suivante → répartiteur appelé une seule fois.

Mutation à vérifier : remettre le marquage « traité » → test rouge.

Fichier à faire relire par une personne : `psp-status-confirmer.ts`.
