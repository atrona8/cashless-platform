# Relecture WP10 — constats (rejet 1)

1. BLOQUANT — fuite d'écouteur / attente non interrompue si le client coupe avant la fin de la garde.
   `current-handover.controller.ts` n'arme `res.once('close', …)` qu'APRÈS la garde `edgeMtls` (requête SQL asynchrone).
   Un client qui coupe pendant la garde (ou pendant `parseWait`/avant l'armement) a déjà émis `close` : l'abandon ne
   part jamais, la requête attend jusqu'à `wait` (25 s) avec son écouteur `LISTEN` et sa relecture toutes les 2 s.
   Preuve : `current-handover-wait.spec.ts` « 50 attentes abandonnées par le client : zéro écouteur résiduel » échoue
   de façon reproductible (3 exécutions : reste 1, 5, 4 écouteurs au lieu de 0).
   Correction : après l'armement, tester `res.destroyed || req.socket.destroyed || req.destroyed` et abandonner
   aussitôt ; écouter aussi `req.on('close')`/`req.socket.once('close')`. Vérifier que le test passe 5 fois de suite.
2. MINEUR — aucune borne sur le nombre d'attentes simultanées par passerelle (chacune : une minuterie, un abonné et une
   transaction courte toutes les 2 s). Seule une passerelle authentifiée peut en ouvrir ; borner (ex. 4 par passerelle,
   au-delà : réponse immédiate avec l'état courant) ou consigner dans POINTS_OUVERTS.
3. MINEUR — aucun test ne dénombre les routes du processus edge : la neutralisation de `EdgeMtlsGuard` laisse les
   tests verts car les deux contrôleurs appellent `edgeGatewayOf` (refus en 401). Aujourd'hui toutes les routes
   (`/edge/handovers/current`, `/ledgers/:id/debit-authority`) refusent sans identité ; ajouter un test qui énumère
   les routes du processus (hors `/health`) et vérifie chacune sans certificat, pour les lots WP12+.
4. INFO — `/v1/health` reste publique sur l'écouteur edge (comme les autres processus) ; acceptable, à confirmer au porteur.
