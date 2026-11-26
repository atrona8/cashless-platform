---
affected_files: []
cycle_number: 3
mission_slug: routes-backoffice-01M86KT6
reproduction_command:
reviewed_at: '2026-11-25T11:30:13Z'
reviewer_agent: claude
wp_id: WP06
---

# Relecture WP06, cycle 3 : changements demandés

1. BLOQUANT (isolement, chemin rapide `status=REVERSED`). `reversedQuery` est un nouveau chemin de lecture
   (`journal_transaction` en CTE, puis vue par `= ANY(ARRAY(...))`). Lecture du code : il ne contourne ni la RLS
   (même transaction `tx.run(operatorId)`, `security_invoker`), ni `resolveChain`/`scopeOf` (exécutés avant, 404 hors
   portée), ni le curseur ni `has_more` (limite + 1, même tri, même borne). Mais AUCUN cas d'isolement ne l'exerce :
   `backoffice-isolation-cases/sales.cases.ts` appelle `/events/{A}/sales` sans filtre. Ajouter un cas
   `listEventSales` avec `?status=REVERSED` (personnel de B : 403/404, aucun identifiant de A dans la réponse ; la
   graine du cas doit contenir une vente annulée de A), et idéalement un test dans `sales.spec.ts` : page de
   `status=REVERSED` avec plusieurs annulées, `limit` 1 puis curseur, `has_more` et `next_cursor` identiques à ceux du
   chemin général (aujourd'hui une seule annulée dans le jeu de 120 : la pagination du chemin rapide n'est pas testée).
2. MINEUR (WP11). Détail `GET /sales/{id}` d'une vente non attribuée : `channel: null` (contraire au contrat), déjà
   soumis au porteur ; consigner en point ouvert avec l'exclusion de la liste.
3. MINEUR (WP11). Le chemin rapide teste `EXISTS sale_attribution` et la vue `channel IS NOT NULL` : équivalents
   tant que `channel` est non nul en table ; à consigner avec `enable_sort = off` (cycle 2).
4. MINEUR. Latence REVERSED : p95 = 37,6 ms (load 2,2) et 160 ms (2e passage, load 2,5, autres sondes aussi x3) :
   sous 500 ms, mais variable selon la charge de la machine.

Vérifié : sales.spec 16/16 ; mutation (retrait de `channel IS NOT NULL` aux deux endroits) = 6 rouges, code restauré ;
sales-latency 8/8 deux fois ; architecture, production-guard, contracts, consignation, backoffice-isolation,
media-isolation : 6 suites, 160 tests verts.
