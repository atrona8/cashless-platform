# WP20 — cycle 3 : réouverture pour deux constats de la relecture (15/10/2026)

La relecture du cycle 3 a approuvé les constats de review-feedback-2. Elle a aussi relevé deux points que l'orchestrateur traite avant `accept`. Le premier est un renforcement de la sécurité (règle 1 de CLAUDE.md : un renforcement se fait, puis se consigne). Le second est une dette de sécurité non consignée, ce que la règle 4 classe comme bloquant.

## Constat 1 (bloquant, sécurité) : `cashless_app` peut réécrire `media_status_history`

**Constat** : `roles.sql` donne `GRANT INSERT, UPDATE ON ALL TABLES` à `cashless_app`, et ce droit n'a jamais été retiré pour `media_status_history`. La relecture l'a démontré en base, dans une transaction annulée ensuite :
1. masquer la dernière ligne `BLACKLISTED` de l'historique ;
2. réutiliser une demande `REINSTATE_MEDIA` d'un épisode précédent restée APPROVED ;
3. le bracelet repasse `ACTIVE`.

La règle de la migration 0017 (« demande liée à l'épisode en cours ») est donc contournable. Le test pgTAP « épisode passé : refusé » et l'ADR-94 promettent plus que ce que la base garantit. L'historique des statuts, qui est une trace d'audit, est en plus réécrivable.

**Correction attendue** :
1. Retire à `cashless_app` le droit `UPDATE` sur `media_status_history`, par `post-roles.sql`. Ne modifie jamais les `.sql` générés.
2. Vérifie d'abord qu'aucun code de l'API ni aucune fonction exécutée avec les droits de l'appelant ne fait `UPDATE` sur cette table.
3. Examine `DELETE` sur la même table. S'il est accordé, retire-le aussi.
4. Recense les autres tables d'historique ou d'audit de la mission (statuts des lots, des clés, des demandes de rattachement…) qui garderaient `UPDATE` ou `DELETE` pour `cashless_app` sans raison. Retire ces droits s'ils ne servent à rien. Liste dans la note ceux que tu laisses, avec la raison.
5. Ajoute un test pgTAP :
   - `UPDATE` et `DELETE` sur `media_status_history` depuis `cashless_app` sont refusés ;
   - la réutilisation d'une demande APPROVED d'un épisode passé reste refusée, même après une tentative de masquer l'historique.
6. Ajoute un contrôle du contrôle : rétablis le `GRANT` et constate que le test échoue, puis retire-le.

## Constat 2 (documentation, règle 3) : limite résiduelle de l'ADR-94 non consignée

Une session de l'API compromise peut faire décider une demande au nom d'un vrai superviseur, parce que `decide_approval_request` ne vérifie pas l'identité de la personne qui décide. L'ADR-94 le dit, mais il n'y a aucune ligne dans `docs/POINTS_OUVERTS.md`, et OP-N52 est marqué « levé » sans cette réserve.

**Correction attendue** :
1. Ajoute un point ouvert OP-N56 (numéro suivant libre), avec :
   - le risque ;
   - les mesures en place ;
   - la mission qui doit le lever : l'identité réelle des personnes ou une signature de la décision, à rattacher à la mission qui convient d'après le découpage ;
   - la condition de levée.
2. Ajoute-le au tableau récapitulatif.
3. Dans OP-N52, ajoute « levé, avec une limite résiduelle : OP-N56 ».
4. Dans l'ADR-94, renvoie à OP-N56.
5. Complète l'ADR-94 sur le droit `UPDATE` retiré (constat 1).

## Tests et contraintes

- Lance `reset-db` puis pgTAP.
- Lance les suites Jest `blacklist`, `media-*` et `daily-check`, puis toute suite qui écrit dans les tables dont tu retires des droits.
- Lance `typecheck` et `lint`.
- Donne la sortie réelle de chaque commande.
- Fichiers à faire relire par une personne : `post-roles.sql`.
