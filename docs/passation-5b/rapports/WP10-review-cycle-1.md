# Relecture WP10 « Catalogue : back-office et configuration servie », cycle 1

- Relecteur : claude (distinct de l'implémenteur). Commit relu : `d7ae89bd` (lane-j).
- Base : `cashless_wp10r` (supprimée à la fin). Toutes les `DATABASE_URL_*` lues par
  `test/support/db.ts` et `src/config/config.ts` pointaient vers elle (DATABASE_URL, _OWNER,
  _APP, _PLATFORM, _TAGKEYS, _PERSO, _TAGCHECK, _KEYADMIN).
- `move-task` non exécuté (consigne de l'orchestrateur).

## Verdict : **APPROUVÉ**

Aucun constat bloquant. Aucun écart non consigné qui affaiblisse la sécurité.

## Vérifications faites

| Vérification | Commande ou lecture | Résultat |
|---|---|---|
| Suites du lot et de non-régression 5a | `reset-db` puis `SKIP_LATENCY=1 npx jest --runInBand test/integration/catalog test/unit/catalog test/integration/devices/config.spec.ts test/integration/devices/heartbeat.spec.ts test/integration/end-to-end/device-auth-matrix.spec.ts` | 6 suites ; 70 réussis, 2 ignorés, 0 échec |
| Lint et Prettier des fichiers du lot | `npx eslint …` et `npx prettier --check …` | 0 problème ; conforme |
| Jest complet | rejoué par l'orchestrateur sur `cashless_test` | 110 suites, 1877 réussis, 6 ignorés, 0 échec (non rejoué ici) |
| Écritures | lecture de `catalog.service.ts` | une seule fonction de 0032 par écriture (`create_catalog_category`, `update_catalog_category`, `create_catalog_item`, `update_catalog_item`, `set_catalog_policy`), toujours avec `actor.principal.userId`. Aucun `INSERT` ni `UPDATE` direct. |
| Refus de la base | lecture | jamais contournés (P0002 → 404, CL029 → 409, CL001 → 422) |
| Idempotence | lecture de `catalog.controller.ts` | les 5 écritures ont `@Idempotent({ scope: 'bo:' })` et passent par `tx.run` ; l'audit est dans la même transaction. Test « rejeu d'une clé » : aucune nouvelle version, une seule ligne d'audit. |
| Contrôle d'accès en base (A21) | lecture de 0032 | `catalog_lock_pos` verrouille la politique (`FOR UPDATE`), puis relit l'auteur (`device_admin_allowed` ou `catalog_admin_allowed`) sous ce verrou. Le commerçant n'est jamais admis pour `set_catalog_policy` (`p_merchant_ok = false`). |
| Version servie | lecture de `served-catalog.ts` et de `record_device_catalog_served` | seul `GET /device/config` inscrit la version servie (`deliver = true`). Le battement de cœur lit la même dernière version sans rien écrire. `config_id` est inchangé (R-04). `items` ne contient que les articles du point de vente et de la version renvoyés par la base. |

## Contrôle d'accès de `catalog.service.ts` (cœur sécurité)

`catalogAccess` ne retient que les attributions qui couvrent le point de vente :

- `OPERATOR_ADMIN` de portée OPERATOR sur le prestataire de la transaction ;
- `ORGANIZER_ADMIN` de l'organisateur de l'événement du point de vente ;
- `MERCHANT_ADMIN` du commerçant du point de vente.

Pour le `MERCHANT_ADMIN` :

- il lit toujours ;
- il gère seulement si `merchant_manages` est vrai ;
- la délégation (`setCatalogPolicy`) lui est toujours refusée en 403.

Dans tous les autres cas, la réponse est un 404 neutre. `posScope` filtre chaque jointure sur le
prestataire de la transaction, en plus de la RLS. Une catégorie ou un article est d'abord résolu
dans le prestataire, puis l'accès est contrôlé sur **son** point de vente. Le déplacement d'un
article vers une catégorie d'un autre point de vente est refusé en 404. La lecture d'une version
contrôle l'accès avant toute requête.

## Mutations (fichiers restaurés, rien commité ; `git status` propre, HEAD `d7ae89bd`)

| # | Mutation | Attrapée ? | Par quel test |
|---|---|---|---|
| M1 | `catalogAccess` : le commerçant gère sans délégation (`&& scope.merchantManages` retiré) | oui | unitaire « commerçant : lit ; gère seulement avec délégation » ; intégration T045 |
| M2 | `catalogAccess` : tout `ORGANIZER_ADMIN` admis, quelle que soit sa portée | oui | unitaire « hors portée : 404 neutre » ; intégration NFR-007 |
| M3 | `getVersion` sans `catalogAccess` | oui | intégration NFR-007 (route `versions/1`, trois intrus) |
| M4 | `ServedCatalog.serve` inscrit toujours la version (donc aussi au battement de cœur) | oui | « FR-008 : nouvelle version → nouvel ETag … » |
| M5 | `getCatalog` : articles de tous les points de vente du prestataire | oui | « getCatalog : catégories ordonnées par rang … » |
| M6 | `GET /device/config` n'inscrit plus la version servie (`deliver = false`) | oui | 3 cas de `catalog-config.spec.ts` |
| M7 | `updateItem` sans contrôle de l'API (`authorize` retiré) | oui (en partie) | T045 attend un 403 et reçoit le 404 de la base |

Pour M7, les intrus restent refusés en 404 par la base : la défense en profondeur (A21) tient.
Seul l'écart entre 403 et 404 révèle la mutation (voir le constat 5).

## Points d'attention de l'orchestrateur

1. **`getCatalogVersion` ouvert aux mêmes rôles que `getCatalog`** : c'est un alignement
   légitime, et non un élargissement de droit.
   - `openapi.yaml` est normatif (§0.3, au-dessus des artefacts de mission). Pour cette
     opération, il dit en toutes lettres « Rôles : comme `getCatalog` ».
   - `contracts/catalog.md` range aussi « lecture du catalogue courant et d'une version » parmi
     les opérations, sans rôle propre.
   - Seul le tableau de `openapi-additions.md` dit « idem » (gestionnaire).
   - Sur le fond, le `MERCHANT_ADMIN` du commerçant lit déjà le catalogue courant de son propre
     point de vente. Une version figée de ce même catalogue ne lui montre rien d'un autre
     périmètre. Les intrus restent en 404 (prouvé par M3).
   - La contradiction de sources est signalée dans le compte rendu de l'implémenteur. Elle n'est
     pas bloquante.
2. **Retouche hors carte de `test/integration/devices/config.spec.ts`** : une seule assertion,
   de `{ items: [] }` à `{ version: 0, items: [] }`.
   - Elle est imposée par le contrat et par T046.
   - Elle reste une égalité stricte : la retouche n'affaiblit pas la non-régression de la 5a.
   - Elle est consignée dans le compte rendu de l'implémenteur, mais elle ne figurait pas dans
     la liste des retouches autorisées (voir le constat 3).
3. **Renforcement « seul `GET /device/config` inscrit la version servie »** : il est confirmé
   et conforme à A2. Une version dont le terminal n'a reçu que l'empreinte n'est pas admise. Le
   test et la mutation M4 le prouvent. Il est consigné.
4. **`heartbeat.controller.ts:37` appelle `build(client, device)` sans langue** : le bug est
   réel (voir le constat 1). Il est fonctionnel seulement :
   - pour un terminal en `en`, l'ETag du battement diffère de celui de la configuration, et le
     terminal relit sa configuration à chaque battement ;
   - l'inscription de la version servie est idempotente (`ON CONFLICT DO NOTHING`), sans effet
     sur la sécurité.
5. **Idempotence `bo:`, audit, une fonction de 0032 par écriture** : conformes (voir le
   tableau des vérifications). L'audit porte le rôle qui a réellement donné l'accès
   (`actor_role`) et la version créée.

## Constats

1. **À reporter** : battement de cœur sans langue (`apps/api/src/devices/heartbeat/heartbeat.controller.ts:37`).
   - Scénario : un terminal `CATALOG_POS` envoie `Accept-Language: en`. L'ETag du battement,
     calculé sur des libellés en français, ne correspond jamais à celui de sa configuration. Le
     terminal relit donc sa configuration à chaque battement.
   - Correction : passer `pickLanguage(req.header('Accept-Language'))` à `build`, avec un test
     « ETag du battement = ETag de la configuration en `en` ».
   - Le fichier est hors de la carte de WP10 : il revient à l'orchestrateur ou au lot qui
     possède `devices/heartbeat/`. Ce n'est pas un écart de sécurité.
2. **À reporter** : contradiction de sources sur les lecteurs de `getCatalogVersion`.
   - Il faut aligner `contracts/openapi-additions.md` (ligne 24, « idem ») sur `openapi.yaml`
     (« comme `getCatalog` »).
   - À consigner dans le journal des contradictions de la mission.
3. **Mineur** : retouche hors carte non autorisée de `test/integration/devices/config.spec.ts:198`.
   - Elle est justifiée, consignée et sans effet sur la sécurité.
   - L'orchestrateur doit la régulariser (l'accepter dans le registre des retouches du lot).
4. **Mineur** : écart avec l'arbitrage « 403 ou 404 pour un `MERCHANT_ADMIN` sans délégation »
   (arbitrage : convention du back-office, portée étrangère → 404 ; code : 403).
   - Le choix est justifié par `openapi.yaml`, qui prime : « sinon `403 FORBIDDEN` »
     (openapi.yaml l. 8020 et 8247).
   - Le commerçant du point de vente est dans la portée en lecture : le 403 ne révèle rien qu'il
     ne puisse déjà lire. Les autres commerçants reçoivent 404.
   - Ce n'est pas un affaiblissement, mais une précision de l'arbitrage à confirmer par
     l'orchestrateur.
5. **Mineur** : aucun test ne prouve isolément que l'API refuse **avant** la base pour un intrus.
   - M7 n'est attrapée que par l'écart entre 403 et 404 du commerçant.
   - Un test qui vérifie `actor_role` ou l'absence de verrou pris pour un intrus durcirait la
     preuve.
   - La base reste la barrière effective (A21) : il n'y a aucun risque d'accès.
6. **Mineur** : `served-catalog.ts:69` convertit `unit_price` (bigint) avec `Number(...)`.
   - L'API refuse tout prix au-delà de 2^53 − 1, mais 0032 n'a pas cette borne. Un prix écrit
     autrement que par l'API au-delà de 2^53 serait servi arrondi.
   - Sans effet aujourd'hui (une seule voie d'écriture). Une borne en base pourrait être ajoutée
     dans un lot SQL ultérieur.
7. **Mineur** : la création concurrente de deux catégories sans rang peut donner le même rang
   (écart 7 de l'implémenteur). C'est sans effet sur la sécurité, et l'ordre reste départagé par
   `id`.

## Défauts antérieurs (hors lot)

- La mesure de latence « p95 ≤ 200 ms » de `config.spec.ts` dépasse 5 s sur ce poste, déjà
  avant le lot (selon l'implémenteur, non revérifié ici). Les suites sont lancées avec
  `SKIP_LATENCY=1`.

## Fichiers à faire relire par une personne

Aucun fichier de clé, de cryptographie ni de droits de la base. Pour mémoire,
`apps/api/src/catalog/catalog.service.ts` (`catalogAccess`, `posScope`) est le contrôle d'accès
applicatif. Il est doublé par 0032 (`catalog_lock_pos`), qui relève déjà de la relecture humaine
de WP03.
