# Constats WP20 cycle 1

**1. BLOQUANT (décision 32, durcissement de la clé TLS client) : absent.**
`GATEWAY_CENTRAL_CLIENT_KEY_FILE` est lu par `central-client.ts` (`loadTrust`, `readFileSync`) et
validé par `config.ts` (`pair(...)`) sans aucun contrôle. À faire, avec tests de chacun :
(a) démarrage refusé si le fichier ou son répertoire est lisible/modifiable par d'autres que le
propriétaire du processus (mode plus large que 0600, ou lien symbolique, `lstat`/`realpath`) ;
(b) refus si cette clé est identique à la clé `batch` ou à une autre clé du port (comparer les
publics dérivés) ; (c) jamais journalisée (test sur les journaux et messages d'erreur) ;
(d) test de chaque refus + preuve que la garde de production le porte.
Rien n'est PIRE qu'avant (WP20 n'y touche pas), mais la décision 32 l'exige dans ce lot.

**2. Mineur** : `withLock` (fake-hardware-keystore) : deux processus voyant le même verrou périmé
peuvent l'un supprimer le verrou fraîchement repris par l'autre (fenêtre étroite, faux de
développement seulement). Consigner ou reprendre par rename atomique.

**3. Mineur** : repli sans WP18 (`resultOnlyDeltaPurge`) sûr (REJECTED/VOID annulés, le reste gardé) ;
à l'intégration, vérifier que `DELTA_PURGE` est bien fourni (un oubli est silencieux : `@Optional`).
Suggestion : alerte au démarrage hors test si le repli est actif.

**4. Info** : décision 20 : une mesure centrale en avance de <24 h adoptée relève `time_floor` ; le
central juste est ensuite à plus de 5 min de retard et refusé (accusé refusé). Conforme à la
décision, mais à consigner comme limite.
