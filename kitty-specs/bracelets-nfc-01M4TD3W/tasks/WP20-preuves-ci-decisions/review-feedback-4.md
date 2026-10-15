# WP20 — relecture du cycle 4 (15/10/2026) : changements demandés

Référentiel : `review-feedback-3.md`. Commits relus : `2d31ed0` (travail) et `5ea9d0e` (nettoyage de la lane).

## Ce qui est acquis

- `post-roles.sql` retire bien à `cashless_app` : `UPDATE`, `DELETE` et `TRUNCATE` sur les trois historiques ;
  `INSERT` sur `media_identity_history` ; toute écriture sur les quatre tables de règles de passage. L'`UPDATE` sur
  `claim_code` et `media_claim` est réduit aux colonnes que changent les fonctions 0010 et 0016.
- Aucun chemin légitime ne perd un droit utile :
  - l'API ne fait que lire ces tables (`release.service.ts`, `batches.service.ts`, `blacklist.service.ts`) ;
  - `reassign_pool_media` est SECURITY DEFINER ;
  - les `SELECT … FOR UPDATE` sur `claim_code` et `media_claim` restent couverts par les droits par colonne.
- Ordre d'application : `migrate.ts` rejoue `roles.sql` puis `post-roles.sql` à chaque série. C'est le même chemin au
  `reset-db` et en production, et aucun autre script n'applique `roles.sql` seul.
- Le contournement `BLACKLISTED → ISSUED` est fermé. `BLACKLISTED` ne mène plus qu'à `ACTIVE`, `RETIRED` ou
  `DESTROYED`, et les deux derniers sont des états finaux. `media_set_status` est refusé (CL020).
- Contrôle du contrôle refait par le relecteur :
  - avec `GRANT UPDATE ON media_status_history` rétabli, les tests 22, 24, 25 et 29 échouent ;
  - avec `GRANT INSERT ON media_transition` rétabli, les tests 26, 28 et 30 échouent.
- OP-N56 est complet : risque, mesures en place, mission 11, condition de levée et tests. Il figure aussi dans le
  tableau récapitulatif, le renvoi depuis OP-N52, l'ADR-94, `PRD.md` et `PROMPTS-A-ENVOYER.md`.
- Aucun `.sql` généré n'est modifié, et `check:generated` est à jour.

## Constat 1 (bloquant, sécurité) : l'`INSERT` laissé sur `media_status_history` rouvre la réutilisation d'une demande d'un épisode passé

**Justification avancée** : les déclencheurs `log_media_status` et `log_batch_status` s'exécutent avec les droits de
l'appelant. Le fait est exact, mais la justification ne tient pas. Avec ce droit, `cashless_app` peut écrire
n'importe quelle ligne dans l'historique, avec l'`id` de son choix (`bigserial`, valeur explicite acceptée). Or
`media_reinstatement_approved` prend pour « épisode en cours » le `max(id)` des lignes `BLACKLISTED`.

**Démonstration** : faite en base, depuis `cashless_app`, dans une transaction annulée ensuite. Le script est
`scratchpad/wp20c4r/pin.sql`.

1. Insérer une fausse ligne `ACTIVE → BLACKLISTED` d'`id` 9 000 000 000 000 000 pour le bracelet.
2. Une demande légitime est faite : son `blacklist_history_id` vaut la ligne plantée. Un vrai second superviseur
   la décide.
3. `reinstate_media` est appelée. La demande reste APPROVED, car la session ne la passe pas EXECUTED.
4. Le bracelet est remis en liste noire. Le vrai épisode a l'`id` 99, mais l'épisode vu par la base reste la
   ligne plantée.
5. `reinstate_media` est rappelée avec l'ancienne demande, sans nouvelle décision. Résultat : **`ACTIVE`**.

La garantie « demande liée à l'épisode en cours » n'est donc toujours pas tenue par la base. Trois textes promettent
pourtant que ce chemin est fermé :
- le complément de l'ADR-94 ;
- la section « En place » d'OP-N56 ;
- le commentaire de `post-roles.sql`.

L'historique, qui est une trace d'audit affichée par `media_status_log`, accepte en plus de fausses lignes : statut,
auteur et valideur au choix.

Ce risque reste dans l'enveloppe d'OP-N56, puisqu'une session de l'API compromise peut déjà faire décider une demande
au nom de deux vrais superviseurs. Mais la réutilisation ne laisse aucune nouvelle demande ni aucune décision dans les
journaux, et les documents affirment le contraire.

**Correction attendue** (option A, préférée ; renforcement) :
1. Ajouter une migration `0018` (jamais un `.sql` généré) qui fait passer `log_media_status()` et `log_batch_status()`
   en `SECURITY DEFINER SET search_path = public` par `ALTER FUNCTION`. Puis, dans `post-roles.sql`, retirer `INSERT`
   à `cashless_app` sur `media_status_history` et sur `media_batch_status_history`. Vérifier que les suites du kit
   (session du propriétaire) et la RLS forcée de ces tables se comportent comme avant.
2. Variante acceptable : un déclencheur `BEFORE INSERT` sur `media_status_history` qui :
   - refuse toute insertion qui ne vient pas de `log_media_status` (`pg_trigger_depth()`), hors session du
     propriétaire ;
   - impose l'`id` tiré de la séquence et `at = clock_timestamp()`.
3. Tests pgTAP :
   - depuis `cashless_app`, un `INSERT` direct dans les deux historiques est refusé ;
   - le scénario ci-dessus (ligne plantée, puis réutilisation de la demande au nouvel épisode) est refusé et le
     bracelet reste `BLACKLISTED` ;
   - le passage de statut normal écrit toujours son historique.
   Contrôle du contrôle : rétablir l'`INSERT`, constater l'échec, puis le retirer.
4. Corriger le test `cashless_app garde INSERT sur media_status_history`, le complément de l'ADR-94, la section « En
   place » d'OP-N56 et le commentaire de `post-roles.sql`.

**Option B** (affaiblissement par rapport à `review-feedback-3`, à soumettre au porteur avant tout codage) : garder
l'`INSERT` et consigner la limite dans OP-N56. Il faudrait alors :
- corriger les trois textes qui promettent le contraire ;
- ajouter un test qui borne la limite.

## Remarque (non bloquante, préexistante, hors lot)

`migrate.ts` exécute `roles.sql` puis `post-roles.sql` en deux requêtes, hors d'une transaction commune. Entre les
deux, `cashless_app` retrouve `INSERT` et `UPDATE` sur toutes les tables, ce qui vaut pour tous les retraits de
`post-roles.sql`. Les deux fichiers pourraient être enveloppés dans une seule transaction. C'est à proposer au porteur
et cela n'est pas exigé dans ce lot.

## Grille anti-motifs

1. Code mort : sans objet.
2. Faux de test : PASS (vraie base, rôle `cashless_app`).
3. Retour vide silencieux : sans objet.
4. Couverture FR-035 : FAIL partiel. Le test « épisode passé refusé » passe, mais la garantie reste contournable
   (constat 1).
5. Surface figée : PASS (aucun `.sql` généré).
6. Décision verrouillée : PASS.
7. Fichiers partagés : `post-roles.sql`, `docs/POINTS_OUVERTS.md`, `PRD.md` et `PROMPTS-A-ENVOYER.md` sont hors de la
   carte du lot. Ces retouches ont été demandées par `review-feedback-3`.
8. Fragilité en production : sans objet.

## Tests du relecteur (sortie réelle)

- `reset-db` puis pgTAP : `Files=19, Tests=1303 … Result: PASS`.
- `tests_media_reinstate.sql` avec chacun des deux droits rétablis : `Result: FAIL` (voir plus haut) ; une fois les
  droits retirés : `Tests=36 … PASS`.
- `reset-db` puis Jest complet : `Test Suites: 75 passed, 75 total` ; `Tests: 1244 passed, 1244 total`.
- `typecheck` : code de sortie 0. `lint` : code de sortie 0.

Fichiers à faire relire par une personne : `packages/ledger-sql/post-roles.sql`,
`packages/ledger-sql/migrations/0017_media_reinstate_approval.sql`, et la future migration `0018`.

## Décision de l'orchestrateur (15/10/2026)

- **Option A retenue**, car elle renforce la sécurité (règle 1 de CLAUDE.md). Une migration `0018` passe `log_media_status` et `log_batch_status` en SECURITY DEFINER, avec un `search_path` fixé. Ensuite, retirer `INSERT` sur `media_status_history` et `media_batch_status_history` dans `post-roles.sql`. Ajouter des tests pgTAP qui rejouent le scénario `pin.sql`, avec un contrôle du contrôle. Corriger l'ADR-94, la section « En place » d'OP-N56 et le commentaire de `post-roles.sql`.
- **Point non bloquant à traiter aussi** (renforcement) : `migrate.ts` doit appliquer `roles.sql` puis `post-roles.sql` dans une seule transaction, si PostgreSQL le permet pour ces instructions. Sinon, l'expliquer dans la note.
- Vérifier ensuite qu'il n'existe **aucune autre table** dont la base lit le « dernier état » par `max(id)` ou par ordre d'insertion et où `cashless_app` peut insérer. Si une telle table existe, la traiter de la même façon ou la signaler.
