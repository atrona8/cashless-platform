---
affected_files: []
cycle_number: 2
mission_slug: routes-backoffice-01M86KT6
reproduction_command:
reviewed_at: '2026-11-25T11:10:59Z'
reviewer_agent: claude
wp_id: WP06
---

# Relecture WP06, cycle 2 : changements demandés

1. BLOQUANT (décision du porteur du 25/11, ex-point 3). `channel` null : les ventes sans attribution (ventes de
   back-office, jointure externe sur sale_attribution) doivent être EXCLUES de la liste (contrat inchangé, `channel`
   reste non nul). Non fait : `sales.service.ts` sélectionne `channel` sans filtre, `SaleRow.channel: string | null`.
   Corriger la requête de liste (et la pagination/le détail de façon cohérente) + test du cas (vente sans attribution
   absente de la liste). WP11 consigne la limite en OP-N. Mutation à noter.
2. BLOQUANT (NFR-001, filtre `status=REVERSED`). Points 1 et 2 du cycle 1 : corrigés pour pos_id, merchant_id,
   MERCHANT_ADMIN (p95 de 93 à 156 ms, trois passages). Mais « annulées » mesure p95 = 175 / 632 / 474 ms sur trois
   passages (EXPLAIN 470-570 ms ; load 3-4, machine peu chargée) : limite 500 ms franchie au 2e passage, test
   `liste : filtre annulées` rouge. Le filtre n'est pas dans `walksSalesIndex`. Examiner le plan de ce filtre
   (même cause probable : tri/parcours sur 200 000 lignes) et le ramener sous 500 ms de façon stable SANS migration
   (consigne du cycle) ; si impossible sans index, proposer l'écart au porteur (index partiel sur l'annulation) au lieu
   de le coder, et consigner.
3. MINEUR. `SET LOCAL enable_sort = off` : contournement de planificateur, à consigner en WP11 (limite : 
   dépend des statistiques, à réévaluer si la volumétrie change).
