# WP20 — relecture du cycle 5 (15/10/2026) : changements demandés

Référentiel : `review-feedback-4.md` et sa section « Décision de l'orchestrateur ». Commits relus : `3012d87`
(travail) et `71e0957` (nettoyage de la lane). Le code a été lu et les scénarios rejoués en base par le relecteur.

## Ce qui est acquis

- **Scénario `pin.sql` fermé.** Rejoué tel quel depuis `cashless_app`, dans une transaction annulée :
  `ERROR: permission denied for table media_status_history` dès la ligne plantée. Les tests 4 quinquies rejouent la
  suite du scénario : la réutilisation au nouvel épisode est refusée (CL020) et le bracelet reste `BLACKLISTED`.
- **Migration 0018.** Les deux fonctions sont `SECURITY DEFINER` avec `search_path=public` (vérifié dans
  `pg_proc.proconfig`) et `REVOKE ALL … FROM PUBLIC`. `roles.sql` rend ensuite `EXECUTE` à `cashless_app`, ce qui est
  sans effet : une fonction de déclencheur ne peut pas être appelée directement. L'`id` vient de la séquence et `at`
  du défaut. Les valeurs recopiées viennent de `NEW.*`, déjà passé sous la RLS de l'appelant, et des réglages
  `app.*`. L'appelant les fixait déjà avant le cycle 5, donc rien n'est nouveau de ce côté (voir la remarque 2).
- **RLS avec un propriétaire non superutilisateur.** Le relecteur a fait un essai dans une transaction annulée, avec
  les deux fonctions données à un rôle `NOSUPERUSER NOBYPASSRLS`. Les politiques `tenant_isolation` de ces tables
  sont `TO PUBLIC` et s'appliquent à ce rôle. Résultats :
  - avec `app.operator_id` égal au prestataire du bracelet, l'historique et le rattachement s'écrivent ;
  - sans `app.operator_id`, l'écriture est refusée (`new row violates row-level security policy for table
    "media_status_history"`). Le refus vaut fermeture, et `media` (RLS forcée) l'exigeait déjà.

  Aucune régression sur ce point.
- **Fermetures en plus.**
  - `media_assignment` n'est écrite que par `log_media_status` et par des fonctions SECURITY DEFINER :
    `activate_media`, `release_media`, `replace_media`, `close_batch`, `recover_media`, `attach_wallet`.
  - `device_config_served` n'est écrite que par `record_config_served` (SECURITY DEFINER).
  - `apps/api/src` ne fait que lire ces tables.
- **`migrate.ts`.** Aucune instruction de `roles.sql` ni de `post-roles.sql` n'est interdite en transaction : pas de
  `CONCURRENTLY`, pas d'`ALTER SYSTEM`, pas de `VACUUM` ni de `CREATE DATABASE`. Les `BEGIN` présents sont des blocs
  plpgsql dans des `DO`. Le `ROLLBACK` est fait en cas d'échec, et `reset-db` passe par ce chemin.
- **Contrôle du contrôle, refait par le relecteur** sur `tests_media_reinstate.sql` :

  | Changement appliqué                                  | Résultat                      |
  |------------------------------------------------------|-------------------------------|
  | `INSERT` rendu sur `media_status_history`            | tests 30, 32, 34, 36 à 39 et 46 en échec |
  | `log_media_status` remise en `SECURITY INVOKER`      | test 5 en échec, la suite s'arrête |
  | `INSERT` rendu sur `media_assignment`                | tests 41 et 46 en échec       |
  | `INSERT` rendu sur `device_config_served`            | test 46 en échec              |
  | Base propre                                          | `Tests=50 … PASS`             |

- Aucun `.sql` généré n'est modifié, et `check:generated` est à jour.

## Constat 1 (bloquant, sécurité) : `log_media_status` en SECURITY DEFINER élargit les droits de `cashless_perso`

`cashless_perso` garde `GRANT INSERT ON media`, sur toutes les colonnes, `wallet_id` et `status` compris. Avant 0018,
un bracelet inséré avec un `wallet_id` déclenchait l'écriture dans `media_assignment` avec les droits de l'appelant.
`cashless_perso` n'a pas ce droit, et l'insertion échouait. Depuis 0018, le déclencheur écrit avec les droits du
propriétaire, et l'insertion passe.

**Démonstration** : `scratchpad/wp20c5r/perso.sql`, transaction annulée. Depuis `cashless_perso`, avec
`app.operator_id` = A :

```sql
INSERT INTO media (id, operator_id, kind, token_hash, nfc_uid, wallet_id, status)
VALUES (…, 'A', 'NFC_TAG', sha256('\xbeef'), '\x041700000000ff', '<portefeuille>', 'ACTIVE');
```

| État                                             | Résultat                                                  |
|--------------------------------------------------|-----------------------------------------------------------|
| Après 0018                                       | `INSERT 0 1` : bracelet `ACTIVE` créé, ligne `media_assignment` ouverte sur le portefeuille |
| Avant 0018 (`SECURITY INVOKER` remis dans la même transaction) | `ERROR: permission denied for table media_assignment` |

Le processus de personnalisation peut donc désormais créer un bracelet **actif**, avec l'identité de son choix
(`token_hash`, `nfc_uid`), rattaché au portefeuille existant d'un festivalier. Ce bracelet ne passe ni par
`activate_media` ni par aucun de ses contrôles. Sur le poste local (propriétaire superutilisateur), le relecteur l'a
même rattaché au portefeuille d'un **autre** prestataire : la clé étrangère ignore la RLS. Avec un propriétaire non
superutilisateur, `wallet_currency` rend NULL hors du prestataire et l'insertion échoue. Le cas d'un portefeuille du
même prestataire reste ouvert.

Le chemin légitime n'a pas besoin de ce droit. `register_personalized_media` (0013) s'exécute avec les droits de
l'appelant et insère toujours `PERSONALIZED` avec `wallet_id` NULL. Le test « liste exacte des droits » ne voit pas
le problème, car `cashless_perso` n'a toujours aucun droit sur `media_assignment` : c'est le déclencheur qui écrit
pour lui.

Cet élargissement n'a été ni soumis au porteur ni consigné. C'est contraire à la règle 1 de `CLAUDE.md`.

**Correction attendue** (renforcement, dans `post-roles.sql`) :

1. Borner l'insertion de `cashless_perso` dans `media` par une politique restrictive nommée. Par exemple :
   ```sql
   CREATE POLICY perso_media_insert ON media AS RESTRICTIVE FOR INSERT TO cashless_perso
     WITH CHECK (status = 'PERSONALIZED' AND wallet_id IS NULL);
   ```
   Autre possibilité : un `GRANT INSERT (colonnes)` sans `wallet_id`, accompagné de la même borne sur `status`.
2. Ajouter des tests pgTAP, joués depuis `cashless_perso` :
   - l'insertion d'un bracelet `ACTIVE` ou `ISSUED` avec `wallet_id` est refusée ;
   - aucune ligne `media_assignment` n'est créée ;
   - `register_personalized_media` passe toujours.

   Puis faire le contrôle du contrôle : retirer la politique, constater l'échec, la remettre.
3. Vérifier qu'aucun autre rôle ne garde un `INSERT` ou un `UPDATE (status)` sur `media` ou `media_batch` que le
   déclencheur devenu SECURITY DEFINER transforme en écriture qu'il n'avait pas. Relevé du relecteur : seul
   `cashless_perso` a `INSERT` sur `media`. `cashless_app` n'y a que `UPDATE (status, claim_code_hash, …)`, ce qui
   n'ouvre aucun rattachement. Consigner ce relevé dans le complément d'ADR-94.

## Remarque 1 (non bloquante) : `offline_policy_history` et `offline_snapshot` ne sont consignés que dans ADR-94

Le complément d'ADR-94 dit ces deux tables « signalées au porteur sans être modifiées ». On ne trouve pourtant ni
décision du porteur, ni entrée dans `docs/POINTS_OUVERTS.md`, ni report dans `PROMPTS-A-ENVOYER.md` ou `PRD.md`.

Il s'agit de faiblesses du kit, antérieures au lot, et non d'un écart du lot. Il faut tout de même :
- soumettre ces deux tables au porteur ;
- si elles restent en l'état, ouvrir une entrée « OP-N » : risque, mission qui la lève, condition de levée, test qui
  borne la limite.

Le cas de `offline_snapshot` mérite la priorité : une version très grande, plantée par l'API, bloque les snapshots
suivants du grand livre. C'est un déni de service hors ligne.

## Remarque 2 (non bloquante, préexistante) : attribution des historiques

`actor_id`, `approved_by` et `reason` sont lus dans des réglages de session que l'appelant fixe. L'historique peut
donc porter un valideur inventé sur un passage réel. Cela ne débloque aucune règle : la sortie de liste noire exige
une demande approuvée (0017). C'est déjà dans l'enveloppe d'OP-N56. Une phrase dans OP-N56 suffirait à le dire
explicitement.

## Grille anti-motifs

1. Code mort : sans objet.
2. Faux de test : PASS (vraie base, vrais rôles).
3. Retour vide silencieux : sans objet.
4. Couverture FR-035 : PASS pour le scénario « pin ». FAIL partiel pour la garantie d'ensemble, à cause de l'effet
   de bord du constat 1.
5. Surface figée : PASS (aucun `.sql` généré).
6. Décision verrouillée : FAIL. La règle 1 de `CLAUDE.md` (aucun affaiblissement en silence) n'est pas tenue
   (constat 1).
7. Fichiers partagés : `post-roles.sql`, `migrate.ts`, la migration 0018, `docs/POINTS_OUVERTS.md` et
   `PROMPTS-A-ENVOYER.md` sont hors de la carte du lot. Ces retouches ont été demandées par `review-feedback-4`.
8. Fragilité en production : PASS. `migrate.ts` relance l'erreur après `ROLLBACK`, ce qui est voulu.

## Tests du relecteur (sortie réelle)

- `reset-db` puis pgTAP : `Files=19, Tests=1317 … Result: PASS`.
- Contrôle du contrôle : voir le tableau plus haut.
- `reset-db` puis Jest complet : `Test Suites: 75 passed, 75 total` ; `Tests: 1244 passed, 1244 total` ; second
  projet : `Test Suites: 1 skipped, 5 passed` ; `Tests: 1 skipped, 38 passed` ; code de sortie 0.
- `typecheck` : code de sortie 0. `lint` : code de sortie 0. `check:generated` : `suites pgTAP à jour`.

## Fichiers à faire relire par une personne

- `packages/ledger-sql/migrations/0018_status_history_definer.sql`
- `packages/ledger-sql/post-roles.sql`, en particulier les droits de `cashless_perso` sur `media`
- `packages/ledger-sql/src/migrate.ts`
- `packages/ledger-sql/migrations/0017_media_reinstate_approval.sql`

## Décision de l'orchestrateur (15/10/2026)

- **Constat 1** : à corriger, c'est un renforcement (règle 1). Dans `post-roles.sql`, ajouter une politique restrictive sur l'`INSERT` de `cashless_perso` dans `media` : `status = 'PERSONALIZED' AND wallet_id IS NULL`, plus toute autre colonne que `register_personalized_media` laisse toujours à sa valeur initiale. Si c'est plus simple et plus sûr, réduire les droits par colonne. Ajouter des tests pgTAP joués depuis `cashless_perso` (scénario `scratchpad/wp20c5r/perso.sql` refusé, chemin légitime accepté), avec le contrôle du contrôle. Vérifier de la même façon les autres rôles de processus (`cashless_*`) qui insèrent dans une table dont un déclencheur est maintenant SECURITY DEFINER : le changement de 0018 ne doit élargir les droits d'aucun rôle.
- **Remarque 1** : pas de changement de comportement dans cette mission, car les tables appartiennent à la mission 7 (hors ligne) et le risque existait avant. Il faut consigner, selon la règle 3 :
  - créer OP-N57 pour `offline_snapshot` (déni de service par une version plantée) et OP-N58 pour `offline_policy_history` (trace falsifiable) ; pour chacun, donner le risque, les mesures en place, la mission 7 comme mission qui le lève et la condition de levée, puis les ajouter au tableau récapitulatif ;
  - ajouter un test pgTAP qui fige les droits d'écriture actuels de `cashless_app` sur ces deux tables, pour qu'il échoue si la limite s'élargit ;
  - reporter le tout dans `PROMPTS-A-ENVOYER.md` (mission 7) et dans `PRD.md` (héritages de la mission 4) ;
  - renvoyer vers OP-N57 et OP-N58 depuis l'ADR-94.
- **Remarque 2** : ajouter une phrase dans OP-N56. L'attribution de l'historique (`actor_id`, `approved_by`, `reason`) vient des réglages de session et peut donc être falsifiée.
