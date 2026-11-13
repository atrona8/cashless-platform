# Relecture WP10 cycle 2 - constats (rejet 2)

Constats 1 (courses de coupure), 2 (borne de 4) et 3 (test des routes) du cycle 1 : corriges et verifies.

1. MAJEUR - fuite d'ecouteurs sur connexion persistante (introduite par la correction).
   `client-gone.ts` pose `req.socket.once('close', stop)` (et `req.once`/`res.once`) et ne les retire JAMAIS.
   Sur une socket keep-alive reutilisee (cas normal d'une passerelle qui rappelle `?wait=25` en boucle), chaque
   requete laisse un ecouteur `close` sur la socket jusqu'a la fermeture de celle-ci : accumulation (reproduit :
   15 requetes -> 17 ecouteurs, MaxListenersExceededWarning des la 11e), chaque ecouteur retenant AbortController,
   req et res. Viole le critere "aucun chemin de sortie (reponse normale) ne laisse un abonne".
   Correction : retirer `socket.off('close', stop)` (et `req.off`) sur `res.once('close')` / `res.once('finish')`
   (fin de requete), ou n'ecouter que `res.once('close')` + `req.once('aborted'/'close')` sans ecouteur sur la
   socket. Ajouter un test : 20 requetes sur UNE socket keep-alive (agent keepAlive, maxSockets 1), puis
   `socket.listenerCount('close')` <= valeur de base ; et un test aucun MaxListenersExceededWarning.
Preuves relancees OK : current-handover-wait x3 (16/16), mutation de route non protegee detectee puis retiree,
test/integration/edge + unit (18 suites, 302 tests), tsc.
