# Compte rendu du lot WP03 — Catalogue versionné et lignes de vente (migration 0032)

- Lane : `.worktrees/terminaux-paiement-en-ligne-01M52QB9-lane-c`, commit `3e475563`
  (`feat(WP03): catalogue versionné par point de vente et lignes de vente (migration 0032)`).
- Fichiers : `packages/ledger-sql/migrations/0032_catalog.sql`, `packages/ledger-sql/tests/tests_catalog.sql`
  (seuls fichiers du lot ; aucune retouche hors carte).
- Sous-tâches T011 à T015 marquées `done` (mark-status accepté).
- Reprise : les deux fichiers de l'implémenteur interrompu étaient complets sur le fond mais jamais exécutés. La suite
  échouait dès les données (participation sur un événement déjà `CLOSED`, refusée par `participation_guard`). Ce que
  j'ai corrigé :
  - données : l'événement d002 est créé `DRAFT`, puis passé `CLOSED` après les données, avec `event_status_guard`
    suspendu par le propriétaire (même procédé que `tests_configuration.sql`) ;
  - un cas de vente était faux (Chips à 200, prix jamais publié, attendu accepté) : remplacé par Chips 300 + 300 sur
    un montant brut de 1300 avec 60 de commission, ce qui prouve aussi que le montant pris est le brut ;
  - trois cas vides (`WHERE false`, jamais exécutés) ont été retirés ;
  - un renforcement dans la migration (point 1 ci-dessous).
- Dépendance à 0031 : aucune. 0032 ne référence ni les tables ni les fonctions de 0031 (vendeurs, lane-b) ; le prompt
  ne suppose pas le contraire. Pas de conflit de nom ni de code d'erreur entre les deux (0031 utilise CL030 à CL033).

## Écarts au plan (et leur sens)

1. **Renforcement** : la « dernière version servie » est triée par `version DESC, served_at DESC`, alors que le prompt
   dit `served_at DESC, version DESC`. Les versions d'un point de vente ne font que croître. Avec le tri par
   `served_at`, une horloge qui recule (cas connu de la base Docker) pourrait de nouveau faire admettre une version
   servie puis remplacée, ce qui rouvrirait le défaut A2. L'index reste `(device_id, pos_id, served_at DESC)` comme
   prévu.
2. **Renforcement** : `catalog_item.pos_id` est tenu par une clé étrangère composite `(pos_id, category_id)` →
   `catalog_category(pos_id, id)`, et pas seulement par les fonctions. Test : « table : article dans une catégorie
   d'un autre point de vente refusé ».
3. **Renforcement** : `sale_line` a une colonne `pos_id` qui n'est pas dans data-model. Sa clé étrangère composite
   `(pos_id, catalog_version, item_id)` → `catalog_version_item` garantit que chaque ligne vient de la version nommée.
4. **Renforcement** : `catalog_category`, `catalog_item` et `point_of_sale_catalog_policy` refusent `DELETE` par un
   déclencheur `forbid_mutation` (le contrat dit déjà « désactivation seulement »).
5. **Renforcement** : `record_sale_lines` prend un verrou consultatif par vente (`pg_advisory_xact_lock`). Deux appels
   concurrents sur la même vente : le second voit les lignes du premier et reçoit `CL034`.
6. Ajouts internes, non prévus au plan : `catalog_lock_pos` (déroulé commun : verrou, auteur relu après le verrou,
   CLOSED) et `catalog_label` (bornes des libellés). Tous deux en SECURITY DEFINER, sans droit pour PUBLIC.
7. Contrat (`contracts/catalog.md`) : « Audit : une ligne par écriture, avec la version créée ». Ce n'est pas fait en
   base dans ce lot : l'audit relève de l'API (WP10), qui reçoit la version dans le `(id, version)` rendu.
   **À confirmer par l'orchestrateur.**

## Choix sur les points à trancher

- **Libellés de catégorie copiés** : oui. `catalog_version_item` copie `category_label_fr`, `category_label_en` et
  `category_position`. Test : « renommage : la version 6 garde l'ancien libellé de catégorie ».
- **Clé de `device_catalog_served`** : `UNIQUE (device_id, version)`, comme data-model, plus une clé étrangère
  `(pos_id, version)` → `catalog_version`. Limite : si un terminal changeait de point de vente et recevait un numéro de
  version déjà servi ailleurs, la ligne ne serait pas écrite. La version admise serait alors la courante seule, donc
  plus stricte (aucun élargissement). La réaffectation est retirée par WP07.
- **Refus sur événement `CLOSED`** : `CL029` → `409 CONFLICT_STATE`. Son sens existant dans 0022 est « transition de
  statut interdite » ; il s'agit ici d'un état de l'objet incompatible avec l'opération, même famille de réponse. Je le
  signale comme demandé ; aucun code nouveau. `set_catalog_policy` est refusée elle aussi sur un événement CLOSED.
- **Montant de la vente** : vérifié dans `apps/api/src/ledger/builders/festival/purchase.ts`. Le constructeur pose
  `merchant(participationId) = −amount`, puis la commission en ligne positive sur le même compte. Montant retenu :
  `−Σ posting.amount` des lignes **négatives** de la vente sur le compte `purpose = 'MERCHANT'` dont
  `participation_id` est celle du point de vente du terminal. Aucune ligne de ce type → `CL034`. Tests : « commission
  ignorée du montant » et « montant = crédit brut 1300, non le net 1240 ».
- **Borne du nombre de lignes** : 1 à 200 (arbitrage). Tests : « 201 lignes » refusé, « 200 lignes acceptées ».
- **Catégorie inactive** : ses articles sont exclus de la version (arbitrage). Test : « article actif d'une catégorie
  inactive exclu de la version ».

## Signatures finales (pour WP04, WP05, WP07, WP10)

Toutes en `SECURITY DEFINER`, `SET search_path = public, pg_temp`, `REVOKE ALL … FROM PUBLIC`, aucun `GRANT` :

```
-- internes (ne pas accorder)
catalog_admin_allowed(p_operator uuid, p_pos uuid, p_actor uuid) RETURNS boolean
catalog_lock_pos(p_operator uuid, p_pos uuid, p_actor uuid, p_merchant_ok boolean) RETURNS void
catalog_bump_version(p_operator uuid, p_pos uuid, p_actor uuid) RETURNS int
catalog_label(p_label text, p_what text) RETURNS text
-- à accorder à cashless_app (WP07, post-roles.sql)
create_catalog_category(p_pos uuid, p_label_fr text, p_label_en text, p_position int, p_actor uuid)
  RETURNS TABLE (id uuid, version int)
update_catalog_category(p_category uuid, p_label_fr text, p_label_en text, p_position int,
                        p_active boolean, p_actor uuid) RETURNS TABLE (id uuid, version int)
create_catalog_item(p_category uuid, p_label_fr text, p_label_en text, p_unit_price bigint,
                    p_vat_rate_bps int, p_actor uuid) RETURNS TABLE (id uuid, version int)
update_catalog_item(p_item uuid, p_category uuid, p_label_fr text, p_label_en text,
                    p_unit_price bigint, p_vat_rate_bps int, p_active boolean, p_actor uuid)
  RETURNS TABLE (id uuid, version int)
set_catalog_policy(p_pos uuid, p_merchant_manages boolean, p_actor uuid) RETURNS void
record_device_catalog_served(p_device uuid) RETURNS TABLE (pos_id uuid, version int)
check_sale_lines(p_device uuid, p_lines jsonb, p_amount bigint) RETURNS int   -- STABLE, version retenue
record_sale_lines(p_tx uuid, p_device uuid, p_lines jsonb) RETURNS int        -- nombre de lignes
```

Paramètre `NULL` dans les `update_*` : valeur inchangée. Erreurs : `P0002` (objet introuvable, autre prestataire,
auteur hors périmètre, session sans prestataire ; dans `record_sale_lines`, session sans prestataire seulement) ;
`CL001` (bornes) ; `CL029` (événement CLOSED) ; `CL034` (tout refus de lignes) ; `42501` (terminal révoqué dans
`record_device_catalog_served`).

WP07 doit accorder à `cashless_app` : `SELECT` sur les sept tables, et `EXECUTE` sur les huit fonctions publiques.
Pour l'écriture, l'API passe par les fonctions. `contracts/database-rights.md` liste `INSERT`/`UPDATE` sur
`catalog_*`, mais les fonctions DEFINER rendent ces droits inutiles ; ne pas les accorder serait plus strict.
**À trancher par WP07.**

`CL034` → `422 SALE_LINES_INVALID` n'est pas encore dans `apps/api/src/errors/sqlstate-map.ts` (WP01/WP08).

## Fichiers à faire relire par une personne

`packages/ledger-sql/migrations/0032_catalog.sql`, en entier. Il pose les droits de la base : fonctions DEFINER, RLS
forcée, contrôle de délégation (`catalog_admin_allowed`, `catalog_lock_pos`) et contrôle des prix et des versions
admises (`check_sale_lines`, `record_sale_lines`).

## Points soumis au porteur ou à l'orchestrateur

Aucun écart n'affaiblit la sécurité. Trois points sont à confirmer : le sens de `CL029` pour un événement CLOSED,
l'audit laissé à l'API (WP10), et la liste des droits `INSERT`/`UPDATE` de `database-rights.md` (WP07).

Mise en forme : plusieurs lignes SQL dépassent 100 caractères, comme dans 0022 et dans les suites existantes.
Prettier ne formate pas le SQL ; je n'ai pas reformaté.

## Critères d'acceptation couverts (preuve)

Commandes, base `cashless_wp03` (supprimée ensuite) :
- `bash packages/ledger-sql/scripts/reset-db.sh` : migrations jusqu'à 0032, `roles.sql` et `post-roles.sql` rejoués
  sans erreur (code 0, deux passes) ;
- `pg_prove -d cashless_wp03 tests/tests_catalog.sql` → `Files=1, Tests=151, Result: PASS` ;
- `bash scripts/test-pgtap.sh` (après `reset-db`) → `Files=34, Tests=2234, All tests successful`. Les suites
  `tests_execute_grants.sql` et `tests_definer_search_path.sql` restent vertes.

Lint, typecheck et Jest n'ont pas été lancés : le lot ne contient aucun TypeScript, et Jest est réservé à la base
partagée de l'orchestrateur.

Cas de `tests/tests_catalog.sql` par exigence :
- **FR-007** (catalogue géré par organisateur ou prestataire, bornes, désactivation) : « ORGANIZER_ADMIN : catégorie
  créée, version 1 », « OPERATOR_ADMIN : article créé, version 2 », « prix 0 refusé », « taux 10 001 refusé »,
  « libellé FR vide (espaces) refusé », « libellé EN de 121 caractères refusé », « article désactivé absent de la
  version suivante », « catalog_item : DELETE refusé », « événement CLOSED : écriture du catalogue refusée (CL029) ».
- **FR-008** (versions immuables, une par écriture) : « version 3 : articles actifs », « version précédente
  inchangée », « catalog_version : UPDATE refusé », « catalog_version_item : DELETE refusé », « refus de bornes :
  aucune version créée », « renommage : la version 6 garde l'ancien libellé de catégorie (copie) ».
- **FR-011** (version servie au terminal) : « terminal CATALOG_POS : dernière version servie », « version servie
  écrite une seule fois », « terminal sans point de vente : version 0 », « terminal KEYPAD_TPE : version 0 », « point
  de vente sans catalogue : version 0 », « terminal révoqué : 42501 ».
- **FR-012 / A2** (prix servi ou actuel, une seule version) : « A2 : ligne au prix de la version 1 (servie puis
  remplacée) refusée », « A2 : vente mêlant les prix des versions 2 et 3 refusée », « A2 : prix de la version 2 seule
  (dernière servie) acceptés », « A2 : prix de la version 3 seule (courante, jamais servie) acceptés », « lignes :
  rang, libellés, prix et taux copiés de la version retenue », « version servie à un autre terminal non admise ».
- **FR-026 / CL034** (refus sans écriture) : « somme fausse : refus », « article inconnu : refus », « article d'un
  autre point de vente : refus », « vente non PURCHASE : refus », « vente écrite par un autre terminal : refus »,
  « lignes déjà écrites pour la vente : refus », « forme invalide refusée : quantité énorme (dépassement) », « … :
  produit au-delà d'un bigint », « tout ou rien : après un refus, aucune ligne », « formes invalides : aucune ligne ».
- **A21** (verrou, délégation revérifiée) : « verrou : la politique est lue FOR UPDATE par l'écriture
  (RowShareLock) », « verrou : la ligne de politique … porte le verrou de la transaction (xmax) », « MERCHANT_ADMIN
  sans délégation : refusé », « MERCHANT_ADMIN du commerçant avec délégation : accepté (12) », « MERCHANT_ADMIN refusé
  de nouveau après retrait de la délégation », « MERCHANT_ADMIN dont l'attribution est retirée : refusé », « set_catalog_policy
  refusée au commerçant ».
- **NFR-006 / NFR-007, C-001, C-002** (isolation entre prestataires, DEFINER, droits) : « douze fonctions SECURITY
  DEFINER, search_path public, pg_temp », « aucune des douze fonctions n'est exécutable par PUBLIC », « RLS activée et
  forcée sur les sept tables », « politique tenant_isolation (USING et WITH CHECK) sur les sept tables », « session B,
  point de vente de A : P0002 », « terminal d'un autre prestataire : P0002 », « vente d'un autre prestataire :
  refus ».

## Cycle 2 (après le rejet de la relecture du cycle 1)

- Lane `lane-c`, commit `b8eabcf4` (`feat(WP03): clé (device_id, pos_id, version) des versions servies,
  quantité 1.0, lignes à 100 caractères`). Fichiers : `0032_catalog.sql` et `tests_catalog.sql` seulement
  (aucune retouche hors carte). Sous-tâches T011 à T015 remarquées `done` (accepté).
- **Correction de la phrase du cycle 1** : « clé `(device_id, version)` … plus stricte (aucun élargissement) » était
  **inexact**. Après une réaffectation, un numéro déjà servi sur un autre point de vente n'était pas écrit. La
  « dernière servie » redevenait donc une version servie puis remplacée, ce qui élargissait A2 (constat 1 du relecteur).

### Constat 1 (majeur, A2) : corrigé
- `device_catalog_served_key UNIQUE (device_id, pos_id, version)`, et
  `ON CONFLICT (device_id, pos_id, version) DO NOTHING` dans `record_device_catalog_served`.
- `check_sale_lines` filtrait déjà sur le point de vente courant du terminal, que ce soit pour la version courante
  (`catalog_version.pos_id = v_pos`), pour la dernière servie (`s.pos_id = v_pos`) ou pour les articles
  (`vi.pos_id = v_pos`). `record_sale_lines` relit `device.pos_id`. Aucune autre requête ne supposait l'ancienne
  clé : j'ai cherché dans `apps/`, `packages/` et `kitty-specs/`, et seuls 0032 et sa suite lisent la table.
- **Écart à `data-model.md` (renforcement, à consigner par l'orchestrateur)** : data-model §device_catalog_served dit
  « unique `(device_id, version)` ». La clé retenue est `(device_id, pos_id, version)`, l'option proposée par le
  prompt T011. C'est une contradiction de source : la décision du porteur DM-01M5HK8RJSX2KVK7Y6Y0C7XSRD, révisée par
  A2, prime sur data-model. data-model est à mettre à jour.
- Effet sur WP04, WP05, WP07, WP10 : **aucune signature ne change** (`record_device_catalog_served(uuid)`,
  `check_sale_lines(uuid, jsonb, bigint)` et `record_sale_lines(uuid, uuid, jsonb)` sont identiques). Les droits ne
  changent pas pour WP07. Pour WP10, « écrite si elle n'y est pas pour ce terminal » se lit maintenant « … pour ce
  terminal et ce point de vente ». Son test « version 1 servie puis version 2 servie → deux lignes » reste vrai.
- Tests ajoutés (`tests_catalog.sql`, bloc « Réaffectation d'un terminal ») :
  - le terminal aa07 reçoit la version 2 de f103 ;
  - f103 passe en version 3 ;
  - aa07 est réaffecté à f104, qui reçoit les versions 1 à 3, et on lui sert la version 3 ;
  - aa07 revient sur f103, qui lui sert la version 3 (même numéro que sur f104) ;
  - f103 passe en version 4.
  
  Cas vérifiés :
  - « réaffectation : version 3 de f103 écrite malgré la 3 de f104 » (lignes `f103:2,f103:3,f104:3`) ;
  - « … prix de la version 2 de f103 (servie puis remplacée) refusé » (CL034) ;
  - « … prix de la version 3 de f103 (dernière servie) accepté » (rend 3) ;
  - « … prix de la version courante de f103 accepté » (rend 4) ;
  - « … version servie sur f104 non admise sur f103 » (CL034).
- Contre-épreuve : j'ai remis l'ancienne clé et l'ancien `ON CONFLICT` sur la base, et la suite échoue (tests 157
  et 158, puis arrêt au test 159).

### Constat 2 (quantité `1.0`) : corrigé
- `record_sale_lines` convertit maintenant `(l.value->>'quantity')::numeric::int`, pour la colonne et pour
  `line_total`. Le contrôle (`check_sale_lines`, qui demande un entier en `numeric`) et l'écriture se comportent de la
  même façon : `1.0` est accepté par les deux, et `1.5` est refusé en CL034 par le contrôle.
- Tests :
  - « quantité 1.0 : check_sale_lines accepte (version 3) » ;
  - « quantité 1.0 : record_sale_lines écrit une ligne » ;
  - « quantité 1.0 : ligne de quantité 1, version 3 de f103 » (`1x2600=2600:v3`).

  Contre-épreuve : avec l'ancienne conversion `::int`, la suite s'arrête sur une erreur 22P02.

### Constat 3 (lignes à 100 caractères) : fait
- Aucune ligne de plus de 100 caractères dans les deux fichiers. Le reformatage ne touche que des retours à la
  ligne et des commentaires. J'ai vérifié par une comparaison normalisée (blancs hors chaînes, commentaires
  retirés) : le seul changement de jetons est la coupure de quelques chaînes longues en `'…' || '…'` (même valeur).
  La suite compte toujours les mêmes cas, plus les 16 nouveaux.

### Preuves (base `cashless_wp03`, supprimée ensuite)
- `reset-db.sh` : code 0.
- `pg_prove -d cashless_wp03 tests/tests_catalog.sql` → `Files=1, Tests=167, Result: PASS` (151 au cycle 1, 16 cas
  ajoutés).
- `scripts/test-pgtap.sh` après `reset-db` → `Files=34, Tests=2250, All tests successful` (2234 au cycle 1).

### Points soumis
- Aucun écart n'affaiblit la sécurité. Les deux corrections sont des renforcements.
- L'orchestrateur doit consigner l'écart à `data-model.md` (clé `(device_id, pos_id, version)`).
- Fichier à faire relire par une personne : `0032_catalog.sql`, inchangé sur ce point (droits, délégation,
  contrôle des prix).
