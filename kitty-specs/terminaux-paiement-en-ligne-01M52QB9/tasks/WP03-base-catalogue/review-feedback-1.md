# Relecture WP03, cycle 1 : catalogue versionné et lignes de vente (migration 0032)

- Relecteur : claude (distinct de l'implémenteur). Lane `lane-c`, commit `3e475563`.
- Fichiers relus : `packages/ledger-sql/migrations/0032_catalog.sql` et
  `packages/ledger-sql/tests/tests_catalog.sql`. Ce sont les seuls fichiers du commit, il n'y a donc aucune retouche
  hors carte.
- Sources confrontées : prompt WP03 (arbitrages du 22/10 compris), `spec.md` (FR-007, 008, 011, 012, 026, NFR-006,
  007), `data-model.md`, `contracts/catalog.md`, `contracts/database-rights.md`, `0022_device_enrollment.sql`
  (`device_admin_allowed`, CL029), `apps/api/src/ledger/builders/festival/purchase.ts` et `lines.ts`, et
  `post-roles.sql` (droits actuels sur `device`).

## Verdict : REJETÉ

Le lot doit être corrigé sur un constat majeur (n° 1) qui touche la sécurité. Il est court à corriger. Le reste du lot
est solide, et les renforcements annoncés sont bien présents dans le code.

## Tests rejoués (base `cashless_wp03r`, supprimée ensuite)

- `reset-db.sh` : code 0. Les migrations jusqu'à 0032, puis `roles.sql` et `post-roles.sql`, sont rejoués.
- `pg_prove tests/tests_catalog.sql` : `Tests=151, Result: PASS`.
- `scripts/test-pgtap.sh`, lancé après un `reset-db` : `Files=34, Tests=2234, All tests successful`. Les résultats
  annoncés par l'implémenteur sont confirmés, et `tests_execute_grants` ainsi que `tests_definer_search_path` restent
  vertes.
- Deux sondes écrites pour cette relecture, à partir des données de la suite :
  - `scratchpad/wp03r/probe.sql` : réaffectation d'un terminal (constat 1) ;
  - `scratchpad/wp03r/probe2.sql` : quantité `1.0` (constat 2).

## Constats

### 1. MAJEUR (sécurité, A2) : la clé `UNIQUE (device_id, version)` rouvre le défaut A2 quand un terminal change de point de vente

- **Où** : `0032_catalog.sql:131` (`device_catalog_served_key UNIQUE (device_id, version)`), `:462`
  (`ON CONFLICT (device_id, version) DO NOTHING`) et `:525-527` (lecture de la dernière version servie).
- **Le problème** : les numéros de version sont comptés par point de vente. La version 3 du point de vente A et la
  version 3 du point de vente B ont donc la même clé pour un terminal donné. Quand la version 3 de B est servie au
  terminal, elle n'est pas écrite si la version 3 de A l'a déjà été. La dernière version servie que lit
  `check_sale_lines` est alors une version plus ancienne, qui a été servie puis remplacée.
- **Scénario reproduit** (`probe.sql`, résultat obtenu sur la base) :
  1. Le terminal aa01 est sur B. On lui sert la version 2 de B (Burger à 1000).
  2. B passe en version 3 (Burger à 1500).
  3. aa01 est réaffecté à A, qui en est à sa version 3. On la lui sert.
  4. aa01 revient sur B. On lui sert la version 3 de B : la ligne n'est pas écrite, à cause du conflit sur
     `(aa01, 3)`.
  5. B passe en version 4.
  6. Résultat : `device_catalog_served` ne contient que `(aa01, B, 2)` et `(aa01, A, 3)`.
     `check_sale_lines(aa01, Burger à 1000)` **rend 2**, donc le prix de la version 2 est accepté alors que cette
     version a été servie puis remplacée. À l'inverse, Burger à 1500 (version 3, réellement servie en dernier) est
     **refusé en CL034**.
- **Ce que cela contredit** : le compte rendu de l'implémenteur affirme que la limite est « plus stricte (aucun
  élargissement) ». C'est inexact : la décision du porteur DM-01M5HK8RJSX2KVK7Y6Y0C7XSRD, telle que révisée par A2,
  est élargie dans ce cas.
- **Pourquoi le cas n'est pas théorique** : la réaffectation est encore possible aujourd'hui. `post-roles.sql:492`
  accorde `UPDATE (… pos_id …) ON device` à `cashless_app` jusqu'à ce que WP07 le retire, et le propriétaire de la
  base peut toujours le faire.
- **Correction attendue** :
  - écrire `UNIQUE (device_id, pos_id, version)` et `ON CONFLICT (device_id, pos_id, version) DO NOTHING` ; c'est
    l'option déjà proposée par le prompt ;
  - signaler l'écart à `data-model.md` comme un renforcement, à consigner par l'orchestrateur, car c'est une
    contradiction de source à signaler et non à trancher en silence ;
  - ajouter un cas de test qui rejoue le scénario ci-dessus : après le retour sur B, le prix de la version 2 est
    refusé et celui de la version 3 est accepté ;
  - corriger la phrase du compte rendu.

### 2. MINEUR (robustesse) : une quantité `1.0` est acceptée par `check_sale_lines` mais fait échouer `record_sale_lines` en 22P02 (erreur 500)

- **Où** : `0032_catalog.sql:505` contrôle la quantité en `numeric`, donc `1.0` passe. Mais `:599-600` convertit
  avec `(l.value->>'quantity')::int`, et `'1.0'::int` lève une erreur `22P02`.
- **Résultat reproduit** (`probe2.sql`) : `check_sale_lines` rend 2, puis `record_sale_lines` lève 22P02
  (`pg_strtoint32_safe`).
- **Ce que cela contredit** : la consigne « chaque refus en CL034, jamais une erreur 500 ». Il y a aussi une
  incohérence entre le contrôle seul et l'écriture, ce qui compte pour WP05 : une demande QR acceptée par
  `check_sale_lines` pourrait échouer plus tard. Le cas reste peu probable par l'API, car JSON.stringify écrit `1` et
  non `1.0`.
- **Correction attendue** : convertir en `(l.value->>'quantity')::numeric::int`, ou réutiliser la valeur déjà
  contrôlée, puis ajouter un cas `quantité 1.0` qui produit 1 ligne de quantité 1.

### 3. MINEUR (forme, non bloquant) : plusieurs lignes dépassent 100 caractères

- **Où** : par exemple `0032:280`, `:540`, `:556` et des lignes de la suite.
- **Contexte** : Prettier ne formate pas le SQL, et 0022 présente déjà ce défaut. À reprendre en passant, sans en
  faire un motif de rejet à lui seul.

## Points que l'implémenteur demande de confirmer

- **CL029 pour « événement clos »** : confirmé acceptable. `sqlstate-map.ts:40` traduit CL029 en
  `409 CONFLICT_STATE`, ce qui correspond au sens « état de l'objet incompatible » ; aucun code nouveau n'est créé.
  WP10 doit encore reporter ce code dans son contrat (le prompt WP10 le liste parmi ses points à fixer).
- **Audit laissé à l'API** : confirmé. Le prompt WP10 prévoit les actions `CATALOG_CATEGORY_CREATED`, `…_UPDATED`,
  `CATALOG_ITEM_*` et `CATALOG_POLICY_SET` dans la même transaction (WP10 l.144 et l.158). La version créée est
  rendue par `(id, version)`. Aucun trou de couverture pour FR-026.
- **Trois cas de test retirés** (`WHERE false`, jamais exécutés) : la version d'origine n'a pas pu être relue, mais
  chaque cas exigé par T015 est présent et exécuté dans la suite livrée. Les retraits ne masquent donc aucune
  exigence :
  - structure ;
  - bornes ;
  - version suivante ;
  - article désactivé ;
  - délégation (refus, acceptation, nouveau refus, `set_catalog_policy` refusée au commerçant) ;
  - événement `CLOSED` ;
  - autre prestataire ;
  - verrou (`pg_locks` et `xmax`) ;
  - versions servies (0, une seule écriture, terminal révoqué) ;
  - les quatre cas de la borne A2 ;
  - somme fausse, article inconnu, autre point de vente, vente non PURCHASE, autre terminal, lignes déjà écrites,
    dépassement ;
  - tout ou rien.
- **Tri de la dernière version servie par numéro (`version DESC`)** : confirmé comme un renforcement. Pour un même
  point de vente, `record_device_catalog_served` écrit toujours la version courante, et les numéros ne font que
  croître. Le plus grand numéro est donc bien la dernière version servie, et ce tri ne dépend pas de l'horloge. Ce
  raisonnement suppose que la clé inclut `pos_id` (constat 1).

## Points vérifiés sans constat

Sécurité :
- les douze fonctions sont toutes `SECURITY DEFINER` avec `search_path = public, pg_temp`, et `REVOKE ALL … FROM
  PUBLIC` ;
- la migration ne contient aucun `GRANT` ;
- la RLS est activée et forcée sur les sept tables, avec la politique `tenant_isolation` ;
- chaque requête nomme `app.operator_id`.

Verrou et délégation (A21) :
- la ligne de politique est créée (`ON CONFLICT DO NOTHING`), puis lue `FOR UPDATE` avant le calcul de la version ;
- l'auteur est relu après le verrou ;
- le commerçant n'est accepté que si la délégation est active, que son attribution n'est pas révoquée et que la
  personne est `ACTIVE` ;
- `set_catalog_policy` n'accepte que `device_admin_allowed`.

Versions admises (A2) :
- seules sont candidates la version courante puis la dernière servie, dans cet ordre, et une seule est retenue pour
  toute la vente ;
- prix et taux sont copiés de la version retenue ;
- la clé composite de `sale_line` vers `catalog_version_item` garantit la provenance des lignes.

Montant de la vente :
- `purchase.ts` crédite le commerçant de `−amount`, puis le débite à part de la commission, et `push` n'agrège pas
  les lignes ; `post_transaction` insère les lignes telles quelles ;
- la somme des crédits du compte MERCHANT de la participation donne donc bien le montant TTC brut.

Refus et dépassements :
- les produits sont calculés en `numeric` ;
- un dépassement de `bigint` produit CL034 ;
- un tableau de plus de 200 lignes produit CL034 ;
- toute exception annule l'ensemble.

Concurrence sur une même vente : un verrou consultatif par vente est pris (renforcement).

## Liste de contrôle des anti-modèles

1. **Code mort** : sans objet. Ce sont des fonctions de la base, appelées par WP04, WP05 et WP10 (dépendances
   déclarées), et les fonctions internes sont toutes appelées.
2. **Données de test fabriquées** : PASS. Chaque cas appelle les vraies fonctions sur des données réelles.
3. **Retour vide silencieux** : PASS. Le retour `(pos_id, 0)` de `record_device_catalog_served` est documenté par le
   contrat.
4. **Couverture des FR** : PASS sous réserve. FR-012 et A2 doivent recevoir le cas de réaffectation (constat 1).
5. **Fichiers gelés** : PASS. Aucun `.sql` généré n'est modifié.
6. **Décisions verrouillées** : **FAIL**. La limite « courante et dernière servie, aucune autre » d'A2 et du contrat
   n'est pas tenue après une réaffectation (constat 1).
7. **Fichiers partagés** : PASS. Aucun fichier n'est partagé avec 0031 (lane-b) ; codes CL030 à CL033 contre CL034,
   sans recouvrement.
8. **Fragilité en production** : constat 2 (22P02 au lieu de CL034).

## Fichiers à faire relire par une personne

`packages/ledger-sql/migrations/0032_catalog.sql` doit être relu en entier par une personne. Il touche :
- les droits de la base (fonctions DEFINER et RLS) ;
- le contrôle de la délégation (`catalog_admin_allowed`, `catalog_lock_pos`) ;
- le contrôle des prix (`check_sale_lines`, `record_sale_lines`).
