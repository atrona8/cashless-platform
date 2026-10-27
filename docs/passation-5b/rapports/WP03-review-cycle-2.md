# Relecture WP03, cycle 2 : catalogue versionné et lignes de vente (migration 0032)

- Relecteur : claude (distinct de l'implémenteur). Lane `lane-c`, diff `3e475563..b8eabcf4` (un seul commit,
  `b8eabcf4`). Fichiers touchés : `packages/ledger-sql/migrations/0032_catalog.sql` et
  `packages/ledger-sql/tests/tests_catalog.sql`. Il n'y a aucune retouche hors carte. Les commits suivants de la lane
  (fusions et transitions du runtime) ne changent rien sous `packages/` ni sous `apps/`.
- Sources : `review-feedback-1.md`, compte rendu de l'implémenteur (section « Cycle 2 »), prompt WP03 (T011, point
  à trancher l.105-106) et `data-model.md:86`.

## Verdict : APPROUVÉ

Les trois constats du cycle 1 sont corrigés. Aucun nouveau constat bloquant ou majeur.

## Constat 1 (majeur, A2) : corrigé

- Clé `UNIQUE (device_id, pos_id, version)` et `ON CONFLICT (device_id, pos_id, version) DO NOTHING`. Les trois
  lectures de `check_sale_lines` sont toutes filtrées sur le point de vente courant du terminal :
  - la version courante (`v.pos_id = v_pos`) ;
  - la dernière servie (`s.pos_id = v_pos`) ;
  - les articles (`vi.pos_id = v_pos`).
  `record_sale_lines` relit `device.pos_id`. Les signatures sont inchangées.
- **Sonde du cycle 1 rejouée** (`scratchpad/wp03r/probe.sql`) :
  - `device_catalog_served` contient maintenant `(aa01, B, 2)`, `(aa01, A, 3)` et `(aa01, B, 3)` ;
  - Burger à 1000 (version 2 de B, servie puis remplacée) est **refusé en CL034** ;
  - Burger à 1500 (version 3 de B, dernière servie) rend 3 ;
  - Burger à 2000 (version courante, 4) rend 4.
  Sonde : `scratchpad/wp03r2/probe3.sql`.
- Contre-épreuve : j'ai remis sur ma base l'ancienne clé et l'ancien `record_device_catalog_served`. La nouvelle
  suite échoue alors aux tests 157 et 158, puis s'arrête au test 159.
- **Contradiction de source à consigner (renforcement)** : `data-model.md:86` dit « unique `(device_id, version)` »,
  et le prompt WP03 l.105 et l.143 reprend cette formulation. Le code suit l'option `(device_id, pos_id, version)`,
  que le prompt proposait lui-même. L'orchestrateur doit mettre à jour data-model et reporter la lecture « pour ce
  terminal et ce point de vente » dans WP10.

## Constat 2 (quantité `1.0`) : corrigé, sans arrondi silencieux

- `record_sale_lines` convertit en `::numeric::int`. Cette conversion ne s'applique qu'après `check_sale_lines`, que
  `record_sale_lines` appelle à l'étape 4, avant l'INSERT. Ce contrôle refuse toute valeur non entière
  (`q <> trunc(q)`). L'arrondi de `::int` ne peut donc jamais s'appliquer à une valeur fractionnaire. De plus, la
  somme écrite est recomparée au montant de la vente.
- Valeurs sondées (`probe3.sql`, base `cashless_wp03r`).
  - **Acceptées par `check_sale_lines`** : `1.0`, `1.00000`, `1e0`, une quantité de `2147483647`, un prix de
    `2000.0`.
  - **Refusées en CL034, jamais une erreur 500** :
    - quantités `1.5`, `0`, `-1`, `-0`, `2147483648`, `1e30`, `1e300`, `1.0000000000000000000001` et
      `0.9999999999999999999999` ;
    - prix `2000.5`, `-2000` et `9223372036854775808` ;
    - quantité `"1"` (chaîne) ;
    - produit `2147483647 × 9223372036854775807` : somme différente du montant, sans dépassement.
  - **Par `record_sale_lines`** :
    - `1.0` écrit `1x2000=2000` ;
    - `2.0 × 2000` écrit `2x2000=4000` ;
    - un prix `2000.0` écrit une ligne ;
    - `1.5`, `1.4999999999999999999` et `0.6` sont refusés en CL034, aucune ligne n'est écrite.
- Contre-épreuve : avec l'ancienne conversion `::int` seule, la suite s'arrête sur une erreur 22P02 dans
  `record_sale_lines` (pas de plan trouvé).

## Constat 3 (lignes à 100 caractères) : fait

- Aucune ligne de plus de 100 caractères (comptés en caractères, pas en octets) dans les deux fichiers.
- **Découpages sans effet** : j'ai comparé les deux versions des deux fichiers après normalisation. La normalisation
  retire les commentaires hors chaînes, réduit les blancs et recolle chaque `'…' || '…'` adjacent. Résultat :
  - migration : seuls trois énoncés diffèrent, exactement les trois corrections (clé de la table, `ON CONFLICT` et
    `::numeric::int`) ;
  - suite : aucune ligne retirée ni modifiée, seulement les blocs ajoutés.
  Chaque découpage de chaîne (`'… NULL, NULL, ' || '%L)'`, `'… non le ' || 'net 1240'`, etc.) donne donc la même
  valeur.

## Tests (base `cashless_wp03r`, supprimée ensuite)

- `reset-db.sh` : code 0. Les migrations jusqu'à 0032, `roles.sql` et `post-roles.sql` sont rejoués.
- `pg_prove tests/tests_catalog.sql` : `Tests=167, Result: PASS`.
- `scripts/test-pgtap.sh`, lancé après un nouveau `reset-db` : `Files=34, Tests=2250, All tests successful`.
- Les nouveaux tests échouent sur le code du cycle 1 (voir les deux contre-épreuves ci-dessus).

## Constat mineur, non bloquant

- **M1** : l'index `device_catalog_served_last_idx (device_id, pos_id, served_at DESC)` est désormais redondant
  pour la lecture, que l'index unique `(device_id, pos_id, version)` sert mieux (le tri se fait par `version DESC`).
  Le supprimer est facultatif.

## Écarts de sécurité ouverts

Aucun écart n'est introduit par le lot. Les deux corrections sont des renforcements.

## Fichiers à faire relire par une personne

`packages/ledger-sql/migrations/0032_catalog.sql` doit être relu en entier par une personne. Il touche les droits
de la base (fonctions DEFINER et RLS), la délégation et le contrôle des prix.
