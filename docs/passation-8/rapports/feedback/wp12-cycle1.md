# Relecture WP12 : constats

1. BLOQUANT (securite, test manquant) : `refresh.service.ts` `exposeWhileEdge` n'a aucun test direct. Mutation
   `rows.length > 0` -> `>= 0` (exposition a chaque renouvellement, meme hors EDGE) : aucune suite de
   `test/integration/devices/refresh` ne la tue (seule une defaillance incidente de `replication-feed.spec`
   a ete observee, non fiable). Correction : deux tests dans `edge-token-exposure.spec.ts` ou `refresh` :
   (a) ledger `EDGE`, renouvellement -> nouvelle ligne `edge_exposed = true` ; (b) ledger `CENTRAL`,
   renouvellement -> `edge_exposed = false`, aucun appel d'exposition. Aucun changement de code attendu.
2. MINEUR : le rejeu sur 40001/23505 de `replication-feed.service.ts` n'est prouve par aucun test (mutation
   « retirer le rejeu » survit). Ajouter un test unitaire avec un client qui leve 40001 puis reussit, et un
   qui leve 3 fois (erreur propagee), ou consigner.
3. MINEUR : le canari de secret est pose dans `claim_code_hash`, colonne que la fonction ne lit jamais : le test
   ne prouve rien sur `pwd_pack_enc` d'une passerelle PRIMARY (couvert par pgTAP seulement). A consigner dans
   POINTS_OUVERTS, ou poser le canari dans un colis reel.
4. MINEUR : `edge-routes-auth.spec.ts` enumere les routes dynamiquement (les trois nouvelles sont couvertes, 401
   verifie dans les specs `routes/`) mais ne nomme pas explicitement ack, release, replication-feed.
5. INFO (signale au porteur, non bloquant) : `EDGE_RELEASE_STUCK` en journal seulement, faute de droit d'audit
   pour `cashless_maint` ; le controleur de schema ne suit pas les `$ref` de propriete.
