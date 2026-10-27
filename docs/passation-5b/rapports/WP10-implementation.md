# Compte rendu du lot WP10 « Catalogue : back-office et configuration servie »

- Lane : `lane-j`. Commit `d7ae89bd` (`feat(WP10): catalogue d'un point de vente — back-office et
  catalogue servi au terminal`).
- Sous-tâches T044 à T047 marquées `done` (mark-status accepté). Pas de `move-task`.
- Base de travail : `cashless_wp10`, avec toutes les `DATABASE_URL_*` pointées dessus (OWNER, APP,
  PLATFORM, TAGKEYS, PERSO, TAGCHECK, KEYADMIN, plus `DATABASE_URL`). Le fichier d'environnement est
  `scratchpad/env-wp10.sh`. La base a été supprimée à la fin.
- `node_modules` de la lane : copie `cp -cR` de celui de lane-g (avec ses liens `@cashless/*`). Il
  n'est pas commité.

## Ce qui est livré

- `apps/api/src/catalog/` :
  - `catalog.dto.ts` : validation des corps. Un champ refusé donne `422 VALIDATION_FAILED` avec
    `violations[]` ; un corps qui n'est pas un objet donne 400.
  - `catalog.service.ts` : portée, écritures par les fonctions de 0032, audit.
  - `catalog.controller.ts` : les sept routes.
  - `served-catalog.ts` : le catalogue servi au terminal.
  - `catalog.module.ts` : exporte `ServedCatalog`.
- `apps/api/src/devices/config/` :
  - `build(client, device, language = 'fr', deliver = false)` ;
  - le contrôleur passe la langue (`pickLanguage`) et `deliver = true` ;
  - le module importe `CatalogModule` ;
  - l'en-tête du service est mis à jour.
- Chaque écriture appelle une seule fonction de 0032 (`create_catalog_category`,
  `update_catalog_category`, `create_catalog_item`, `update_catalog_item`, `set_catalog_policy`),
  avec l'auteur `actor.principal.userId`. Aucun `INSERT` ou `UPDATE` direct sur une table du
  catalogue. Un refus de la base n'est jamais contourné : P0002 donne 404, CL029 donne 409, CL001
  donne 422.
- Contrôle d'accès dans l'API (première barrière seulement ; la base revérifie sous verrou, A21).
  Seules comptent les attributions dont la portée couvre le point de vente :
  - `OPERATOR_ADMIN` de portée OPERATOR sur ce prestataire ;
  - `ORGANIZER_ADMIN` de l'organisateur de l'événement ;
  - `MERCHANT_ADMIN` du commerçant : il peut lire. Il gère seulement si `merchant_manages` est vrai,
    sinon 403. Il ne règle jamais la délégation (403).
  - Hors portée : 404 neutre.
  - Aucun des trois rôles : 403.
- Audit dans la même transaction : `CATALOG_CATEGORY_CREATED`, `CATALOG_CATEGORY_UPDATED`,
  `CATALOG_ITEM_CREATED`, `CATALOG_ITEM_UPDATED` et `CATALOG_POLICY_SET`.
  - `after` contient les champs écrits et `catalog_version` ; le prix est écrit en texte (bigint).
  - `before` contient l'état lu avant l'écriture pour les modifications, et la délégation pour la
    politique.
  - `actor_role` est le rôle qui a réellement donné l'accès, et non le premier rôle tenu par la
    personne.

## Écarts au plan (et leur sens)

1. **Renforcement : le battement de cœur n'inscrit pas de version servie.** Le service
   `DeviceConfigService.build` est aussi appelé par `POST /device/heartbeat`, qui ne rend que
   l'ETag. Si l'appel se faisait sans précaution, chaque battement aurait inscrit dans
   `device_catalog_served` une version que le terminal n'a jamais reçue (prouvé par un test,
   ensuite corrigé). Correctif : un paramètre `deliver`. Il vaut `true` seulement pour
   `GET /device/config`. Le battement lit la même dernière version sans rien écrire, donc son ETag
   reste celui de la configuration.
   - Le battement de cœur n'est pas dans ma carte. Sa valeur par défaut (`false`) suffit : je n'ai
     pas modifié son fichier.
2. **Libellé de catégorie lu dans la version** (`category_label_fr/en` copiés par 0032), et non dans
   `catalog_category`. Conforme à l'arbitrage. Le texte des Risks, qui dit l'inverse, est dépassé.
3. **`x-process` non posé** (arbitrage « Pas de `x-process` ») : `openapi.yaml` n'est pas modifié,
   et `media-isolation.spec.ts` n'est pas concerné.
4. **`app.module.ts` non modifié.** `DevicesModule` → `DeviceConfigModule` → `CatalogModule` charge
   déjà `CatalogController` dans l'API publique seule. La ligne d'import autorisée était donc
   inutile.
5. **Nouvelle catégorie d'un autre point de vente** dans `updateCatalogItem` : l'API la refuse en
   404, comme le demande le contrat. La base seule répondrait CL001, soit 422.
6. **Champ inconnu dans un corps refusé en 422** (`additionalProperties: false` du contrat). C'est
   plus strict que la convention du back-office existant, qui ignore les champs inconnus.
   - Exception : `pos_id` dans `CatalogPolicy` (`readOnly`) est ignoré.
7. **Rang par défaut d'une catégorie** : `max(position) + 1`, ou 0 s'il n'y a pas de catégorie,
   calculé dans la transaction (le contrat dit « après la dernière »). Deux créations simultanées
   sans rang peuvent recevoir le même rang. C'est sans effet sur la sécurité : le rang n'est pas
   unique en base.
8. **`unit_price`** : il doit être un nombre JSON entier, sûr et strictement positif, lu en `bigint`.
   Au-delà de 2^53 − 1, il est refusé en 422, car le nombre a déjà perdu sa précision : il n'y a
   jamais d'arrondi silencieux. Une chaîne de chiffres est refusée.

## Retouches hors carte

- `apps/api/src/audit/audit.service.ts` : ajout des cinq actions du catalogue à `AuditAction`
  (autorisé ; ajout seul).
- `apps/api/test/integration/devices/config.spec.ts`, une ligne :
  - avant : `expect(body.catalog).toEqual({ items: [] })` ;
  - après : `{ version: 0, items: [] }`.
  - Raison : le contrat et T046 imposent `version: 0` pour un point de vente sans catalogue.
  - Cette retouche n'était **pas** dans la liste autorisée. C'est la non-régression de la 5a, mise à
    jour pour le nouveau contenu.

## Points à trancher (choix faits, à confirmer)

- **403 ou 404 pour un `MERCHANT_ADMIN` sans délégation : 403**, comme le dit `openapi.yaml`
  (« sinon `403 FORBIDDEN` »). Le commerçant est dans la portée en lecture : ce n'est pas une
  « portée étrangère ». Pour les autres commerçants, c'est 404.
- **Lecteurs de `getCatalogVersion` : les mêmes que `getCatalog`**, commerçant compris.
  `openapi.yaml` dit « Rôles : comme `getCatalog` », alors que le tableau de `openapi-additions.md`
  dit « idem » (gestionnaires). Contradiction de sources : `openapi.yaml` prime (§0.3).
  `openapi-additions.md` est à aligner.
- **Événement `CLOSED`** : CL029 → `409 CONFLICT_STATE`, conforme à 0032 et au contrat. Cela vaut
  aussi pour `setCatalogPolicy`. La lecture reste permise.
- **Actions d'audit** : les noms du prompt sont gardés, plus `CATALOG_POLICY_SET`.
- **`catalog.cases.ts`** : le registre de WP08 admet une liste vide. Le fichier exporte
  `controllers: []` et `cases: () => ({})`. La matrice reste verte.
- **Battement de cœur et langue (hors carte, non fait)** : `heartbeat.controller.ts` appelle
  `build` sans langue, donc en `fr`. Pour un terminal qui envoie `Accept-Language: en`, l'ETag du
  battement (libellés en français) diffère de celui de sa configuration (libellés en anglais). Le
  terminal relirait sa configuration à chaque battement.
  - Correctif d'une ligne, hors de ma carte : passer
    `pickLanguage(req.header('Accept-Language'))` à `build` dans `heartbeat.controller.ts`.
  - C'est fonctionnel seulement (aucun effet sur la sécurité) : à confier à l'orchestrateur.
- **Mesure de latence `config.spec.ts` « p95 ≤ 200 ms »** : elle dépasse le délai de 5 s sur ce
  poste, **déjà avant le lot**. Je l'ai vérifié en remettant le code de départ (`git stash`). Jest
  complet lancé avec `SKIP_LATENCY=1`, comme les lots précédents.

## Points soumis au porteur

Aucun écart qui affaiblit la sécurité n'a été codé, et aucun n'est en attente. Les écarts 1, 5 et 6
sont des renforcements.

## Fichiers à faire relire par une personne

Aucun fichier de clé ni de droits de la base. Le contrôle d'accès applicatif est à relire :
`apps/api/src/catalog/catalog.service.ts` (`catalogAccess`, `posScope`), même si la base le
revérifie.

## Critères couverts et preuves

| Critère | Preuve (fichier : cas) |
|---|---|
| FR-007 (gestion, versions, délégation, bornes) | `test/integration/catalog/catalog.spec.ts` : « FR-007 : ORGANIZER_ADMIN puis OPERATOR_ADMIN écrivent ; une version par écriture ; versions précédentes inchangées », « getCatalog : catégories ordonnées par rang… », « T045 : MERCHANT_ADMIN refusé sans délégation (403), accepté avec, refusé après retrait ; jamais la délégation », « A21 : délégation retirée pendant que la requête du commerçant attend le verrou → refus de la base, rien écrit », « A21 : deux modifications simultanées → deux versions successives », « événement CLOSED : écriture refusée (409 CONFLICT_STATE), rien écrit », « article déplacé vers une catégorie d'un autre point de vente → 404 ; bornes → 422 », « rejeu d'une clé… » ; `test/unit/catalog/catalog.dto.spec.ts` (bornes : prix 0, négatif, décimal, texte, 2^53, 9007199254740993, 1e30 ; taux −1, 10 001 ; libellés vides et de 121 caractères ou points de code ; 120 acceptés ; `catalogAccess`) |
| FR-008 (catalogue servi, battement suivant) | `test/integration/catalog/catalog-config.spec.ts` : « CATALOG_POS : dernière version servie, ordonnée, en français par défaut ; inscrite une fois ; conforme au contrat », « FR-008 : nouvelle version → nouvel ETag (configuration et battement de cœur), config_id identique ; deux lignes servies », « Accept-Language: en → libellés anglais », « KEYPAD_TPE → catalog null », « CATALOG_POS sans point de vente, ou point de vente sans catalogue → version 0 », « terminal suspendu : configuration et catalogue servis » |
| FR-012 (part « version servie », A2) | `catalog-config.spec.ts` : une ligne `device_catalog_served` par version servie (deux GET : une ligne ; v5 puis v6 : deux lignes) ; « Une version créée n'est pas inscrite tant qu'elle n'est pas servie », y compris après un battement de cœur |
| FR-026 (part catalogue) | `catalog.spec.ts` : « FR-026 : une ligne d'audit par écriture, avec la version créée, l'auteur et son rôle » (avec la délégation avant et après) ; rejeu : une seule ligne d'audit ; T045 : `actor_role = MERCHANT_ADMIN` |
| NFR-007 (part catalogue) | `catalog.spec.ts` : « NFR-007 : autre organisateur, autre commerçant, autre prestataire → 404 ; rôle absent → 403 » (sept routes × trois intrus, rien d'écrit, délégation inchangée) ; `catalog-config.spec.ts` : aucun article d'un autre point de vente dans `items` |
| R-04 (`config_id` stable) | `catalog-config.spec.ts` : `config_id` identique après une nouvelle version et entre les langues |
| Non-régression 5a | `config.spec.ts` et `heartbeat.spec.ts` verts ; `device-auth-matrix.spec.ts` vert |

## Definition of Done

| Étape | Commande | Résultat |
|---|---|---|
| Lint | `npm run lint` | 0 problème |
| Typecheck | `npm run typecheck` | 0 erreur (4 espaces de travail) |
| Prettier | `npx prettier --check apps/api/src apps/api/test` | conforme |
| Reset | `PGDATABASE=cashless_wp10 bash packages/ledger-sql/scripts/reset-db.sh` | OK (0001 à 0035, roles, post-roles) |
| pgTAP | non rejoué | le lot ne touche aucun SQL |
| Jest complet | `reset-db`, puis `SKIP_LATENCY=1 npx jest --runInBand` (toutes les `DATABASE_URL_*` vers `cashless_wp10`) | **110 suites, 1877 réussis, 6 ignorés, 0 échec** |

Lignes de 100 caractères : respectées dans le code, sauf les titres des cas de test (`it('…')`), que
Prettier laisse tels quels, comme dans les suites existantes.
