---
work_package_id: WP10
title: "Catalogue : back-office et configuration servie"
dependencies:
- WP07
- WP08
requirement_refs:
- FR-007
- FR-008
- FR-012
- FR-026
- NFR-007
- C-001
- C-003
planning_base_branch: feat/terminaux-paiement-en-ligne
merge_target_branch: feat/terminaux-paiement-en-ligne
branch_strategy: Planning artifacts for this mission were generated on feat/terminaux-paiement-en-ligne. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/terminaux-paiement-en-ligne unless the human explicitly redirects the landing branch.
subtasks:
- T044
- T045
- T046
- T047
phase: "Phase 3 - Routes"
history:
- timestamp: '2026-10-22T14:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks-packages
agent_profile: node-norris
role: implementer
agent: claude
authoritative_surface: apps/api/
create_intent:
- apps/api/src/catalog/catalog.module.ts
- apps/api/src/catalog/catalog.controller.ts
- apps/api/src/catalog/catalog.service.ts
- apps/api/src/catalog/catalog.dto.ts
- apps/api/src/catalog/served-catalog.ts
- apps/api/test/integration/catalog/catalog.spec.ts
- apps/api/test/integration/catalog/catalog-config.spec.ts
- apps/api/test/unit/catalog/catalog.dto.spec.ts
- apps/api/test/integration/end-to-end/device-auth-cases/catalog.cases.ts
execution_mode: code_change
owned_files:
- apps/api/src/catalog/**
- apps/api/src/devices/config/**
- apps/api/test/integration/catalog/**
- apps/api/test/unit/catalog/**
- apps/api/test/integration/end-to-end/device-auth-cases/catalog.cases.ts
tags: []
tracker_refs: []
---

# Work Package Prompt: WP10 – Catalogue : back-office et configuration servie

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load node-norris` (Profile : node-norris / Role : implementer / Agent : claude).
Lis ensuite la fiche de contexte d'implémentation fournie par l'orchestrateur, ce prompt, puis, dans
`kitty-specs/terminaux-paiement-en-ligne-01M52QB9/` : `spec.md` (FR-007, FR-008, FR-012, FR-026, NFR-007),
`data-model.md` (sections `catalog_category`, `catalog_item`, `catalog_version`, `catalog_version_item`,
`device_catalog_served`, `point_of_sale_catalog_policy`), `research.md` R-04 et R-11 (A2, A21), `contracts/catalog.md`
(en entier), `contracts/openapi-additions.md` (opérations du catalogue), `plan.md` IC-03. Lis la migration
`packages/ledger-sql/migrations/0032_catalog.sql` livrée par WP03 (noms et signatures exacts des fonctions d'écriture,
que le plan n'arrête pas) et le code existant `apps/api/src/devices/config/` (5a : `DeviceConfigService.build`,
`configEtag`, verrou du terminal `FOR NO KEY UPDATE`).

Règle §0.3 : en cas de contradiction entre sources, applique la priorité (tests exécutables > schéma SQL,
`openapi.yaml`, `sync_protocol.md` > SPECIFICATION > PRD) et **signale-la** dans le compte rendu. Ne modifie jamais un
fichier `.sql` généré de `packages/ledger-sql/` ; ce lot ne touche à aucun fichier SQL.

## Objective

Servir le back-office du catalogue d'un point de vente (catégories, articles, versions, délégation au commerçant) par
les fonctions de la base de WP03, et servir au terminal `CATALOG_POS` la dernière version de son catalogue dans
`DeviceConfig`, en enregistrant la version servie (`device_catalog_served`) dont dépend le contrôle des prix.

## Context

- Exigences : FR-007 (catalogue et délégation), FR-008 (catalogue servi, pris au battement de cœur suivant), FR-012
  (prix vérifiés : ce lot fournit la version servie ; le contrôle des lignes est `record_sale_lines`, appelé par WP11),
  FR-026 (audit de chaque modification), NFR-007 (isolation), C-001 (règles tenues par la base), C-003. Carte : IC-03.
- Décision du porteur `DM-01M5HK8RJSX2KVK7Y6Y0C7XSRD` (prix servi ou actuel), précisée par A2 : versions admises =
  version **courante** et **dernière** version servie au terminal. Ce lot doit donc écrire la version servie **à chaque
  nouvelle version servie**, et seulement la dernière construite pour ce terminal.
- A21 : chaque fonction d'écriture verrouille `point_of_sale_catalog_policy` du point de vente (versions successives
  sous écritures concurrentes) et revérifie la délégation (`merchant_manages`) en relisant le rôle de l'auteur.
- R-04 : `record_config_served` ne voit pas le catalogue ; sa déduplication (`config_id`) ne doit pas changer.
- Fonctions de la base (WP03, 0032) : fonctions d'écriture du catalogue (une par opération, chacune crée la version
  suivante), `record_device_catalog_served` et lecture d'une version. Utilise leurs noms exacts dans 0032.
- Socle WP08 : `DeviceContext` enrichi (`appMode`), traduction des codes, registre des cas de la matrice.
- Ce qui en dépend : WP11 (`record_sale_lines` s'appuie sur `device_catalog_served`), WP13 (lignes d'une demande QR).

**Règle de sécurité du projet (`CLAUDE.md`, C-009, C-010)** : si un point de ce lot ne peut être tenu qu'en
affaiblissant la sécurité (droit plus large, contrôle retiré ou reporté, secret plus exposé, faux gardé plus longtemps
que prévu), **arrête-toi sur ce point et soumets-le au porteur avant de coder**, avec le risque et les options ;
continue le reste. Un renforcement se fait, puis se consigne dans le compte rendu du lot.

## Arbitrages de l'orchestrateur (22/10/2026)

Décisions prises à la génération des lots ; tous dans le sens le plus strict ou de pure répartition (aucun
affaiblissement, règle 1 de `CLAUDE.md`). Elles priment sur les « points à trancher » du texte ci-dessus et
ci-dessous. Reporter dans le compte rendu du lot les écarts au plan qui en découlent.

- Pas de `x-process`. `catalog.cases.ts` peut ne contenir aucun cas (registre de WP08).
- `403` ou `404` pour un `MERCHANT_ADMIN` sans délégation : suivre la convention existante du back-office (portée étrangère → `404`) ; libellé de catégorie lu dans la version (WP03 le copie).

## Branch Strategy

Planification et fusion sur `feat/terminaux-paiement-en-ligne`. Dépendances : WP07 (droits), WP08 (socle). L'espace de
travail (worktree) est attribué par lane calculée dans `lanes.json`. Commande :
`spec-kitty agent action implement WP10 --agent claude --mission terminaux-paiement-en-ligne-01M52QB9`.

Retouches hors carte autorisées, chacune consignée en une ligne dans le compte rendu :
- `apps/api/src/app.module.ts` : **une ligne** d'import de `CatalogModule` ;
- `packages/contracts/openapi.yaml` : lignes `x-process: public` des sept opérations du catalogue (voir T047) ;
- `apps/api/src/audit/audit.service.ts` : ajout des actions d'audit du catalogue à l'union `AuditAction` (fichier hors
  de toute carte ; ajout seul).

## Subtasks

### T044 — Back-office du catalogue et versions

Routes (`catalog.controller.ts`, préfixe de la personne, pas de prestataire au chemin) : `getCatalog` `GET
/points-of-sale/{pos_id}/catalog`, `createCatalogCategory` `POST /points-of-sale/{pos_id}/catalog/categories`,
`updateCatalogCategory` `PATCH /catalog-categories/{category_id}`, `createCatalogItem` `POST
/catalog-categories/{category_id}/items`, `updateCatalogItem` `PATCH /catalog-items/{item_id}`, `getCatalogVersion`
`GET /points-of-sale/{pos_id}/catalog/versions/{version}`.
- Accès : `TenantAccess.actor(req, ['OPERATOR_ADMIN', 'ORGANIZER_ADMIN', 'MERCHANT_ADMIN'])`. Point de vente résolu
  dans la transaction (point de vente → `merchant_participation` → événement → organisateur ; commerçant). Lecture
  (`getCatalog`) : `OPERATOR_ADMIN` ; `ORGANIZER_ADMIN` de l'organisateur de l'événement ; `MERCHANT_ADMIN` du
  commerçant du point de vente. Écriture (« gestionnaire ») : les deux premiers, et le `MERCHANT_ADMIN` du commerçant
  **seulement si** `merchant_manages` est vrai. Point de vente, catégorie ou article hors périmètre ou d'un autre
  prestataire : `404` neutre. `MERCHANT_ADMIN` qui lit mais ne gère pas : `403 FORBIDDEN` (à confirmer, voir Risks).
- Le contrôle de l'API est une première barrière ; la base revérifie la délégation et le rôle de l'auteur (A21). Passe
  toujours l'auteur (`actor.principal.userId`) à la fonction ; ne contourne jamais un refus de la base.
- Validation avant écriture (`422 VALIDATION_FAILED`, avec `violations`) : `label_fr`, `label_en` non vides, 120
  caractères au plus ; `unit_price` entier > 0 (unités mineures, aucun flottant : lis-le en `bigint`) ; `vat_rate_bps`
  entier de 0 à 10 000 ; `position` entier ≥ 0 ; `active` booléen. Pas de suppression : la désactivation passe par
  `PATCH` (`active: false`).
- Chaque écriture : `@Idempotent({ scope: 'bo:' })` + `IdempotentTx.run`, un seul appel à la fonction de la base qui
  crée la version suivante dans la même transaction ; la réponse porte l'objet et le numéro de version créé (schémas
  `CatalogCategory`, `CatalogItemAdmin` de WP01). Événement `CLOSED` : refus de la base, traduit par WP08 ; code exact
  selon 0032 et WP01 (signale-le).
- Audit (même transaction) : `CATALOG_CATEGORY_CREATED`, `CATALOG_CATEGORY_UPDATED`, `CATALOG_ITEM_CREATED`,
  `CATALOG_ITEM_UPDATED`, avec `after` = champs écrits et `catalog_version` créée. Noms non arrêtés au plan : garde-les
  sauf contradiction, note-les au compte rendu.
- `getCatalog` : état courant (catégories ordonnées par `position`, articles), et numéro de la version courante.
  `getCatalogVersion` : lignes figées de `catalog_version_item` ; version inexistante → `404`. Le tableau de
  `openapi-additions.md` donne « idem » (gestionnaire) pour cette lecture : applique les lecteurs de `getCatalog` si le
  contrat de WP01 le dit, sinon les gestionnaires, et signale l'ambiguïté.
- Fichiers : `catalog.controller.ts`, `catalog.service.ts`, `catalog.dto.ts`, `catalog.module.ts`.

### T045 — Politique de délégation au commerçant

`setCatalogPolicy` `PUT /points-of-sale/{pos_id}/catalog-policy` `{merchant_manages: boolean}` : `OPERATOR_ADMIN` ou
`ORGANIZER_ADMIN` de l'organisateur de l'événement du point de vente ; `MERCHANT_ADMIN` → `403` (il ne s'autorise
jamais lui-même). Écriture par la fonction de 0032 (ligne créée à la première écriture, verrouillée). Idempotente
(`bo:`), auditée (`CATALOG_POLICY_SET`, avant et après). Une délégation retirée prend effet à l'écriture suivante du
commerçant (la base relit la politique sous verrou) : test dédié.

### T046 — Catalogue servi dans la configuration

Dans `apps/api/src/devices/config/` (code de la 5a, owned par ce lot) :
- `DeviceConfigService.build(client, device, language)` : la langue vient de `pickLanguage(req.header('Accept-Language'))`
  dans `device-config.controller.ts`.
- Terminal `CATALOG_POS` avec point de vente : **après** le verrou du terminal et `record_config_served` (ordre
  inchangé), appelle `record_device_catalog_served` (WP03) : la base lit la dernière version du point de vente et
  l'écrit dans `device_catalog_served` si elle n'y est pas pour ce terminal ; lis ensuite les articles de cette version
  (`catalog_version_item`) et sers `catalog = {version, items}`, `items: CatalogItem[]` = `{product_id (= item_id),
  name, unit_price, category, vat_rate_bps}` ; `name` et `category` dans la langue demandée (`label_fr` ou `label_en` ;
  libellé de catégorie lu dans `catalog_category`, voir Risks) ; ordre : `position` de la catégorie, puis libellé.
  Le service de lecture des articles vit dans `catalog/served-catalog.ts`, exporté par `CatalogModule` et importé par
  `DeviceConfigModule`.
- Terminal `CATALOG_POS` sans point de vente, ou point de vente sans version : `{version: 0, items: []}`, rien écrit.
  Autres modes : `catalog: null` (inchangé).
- `config_id` inchangé (aucun changement de `record_config_served`) ; l'ETag (`configEtag`, contenu hors
  `server_time`) change avec la version, donc au battement de cœur suivant (FR-008). Un terminal suspendu reçoit sa
  configuration (`allowSuspended`) : même règle.
- Mets à jour le commentaire d'en-tête de `device-config.service.ts` (« catalogue vide … mission 5b » n'est plus vrai).

### T047 — Tests du catalogue

- `test/unit/catalog/catalog.dto.spec.ts` : bornes (prix 0, négatif, décimal, au-delà de 2^53 refusé ou lu en
  `bigint` ; taux −1 et 10 001 ; libellés vides et de 121 caractères).
- `test/integration/catalog/catalog.spec.ts` : création et modification par `ORGANIZER_ADMIN` et `OPERATOR_ADMIN` ;
  version incrémentée à chaque écriture, versions précédentes inchangées ; `MERCHANT_ADMIN` refusé sans délégation,
  accepté avec, refusé après retrait ; `ORGANIZER_ADMIN` d'un autre organisateur et autre prestataire → `404`
  (NFR-007) ; deux modifications simultanées → deux versions successives (A21) ; événement `CLOSED` → refus ; audit
  avec la version créée ; rejeu d'une clé → réponse enregistrée.
- `test/integration/catalog/catalog-config.spec.ts` (terminal de test WP08, `CATALOG_POS`) : `catalog.version` servi ;
  après une modification, ETag changé, `config_id` identique ; deux `GET` sans modification → une seule ligne
  `device_catalog_served` ; version 1 servie puis version 2 servie → deux lignes ; `Accept-Language: en` → libellés
  anglais ; terminal `KEYPAD_TPE` → `catalog: null` ; terminal sans point de vente → version 0 ; réponse validée contre
  le schéma `DeviceConfig` du contrat.
- `device-auth-cases/catalog.cases.ts` : le lot n'ajoute **aucune** route de terminal (`GET /device/config` a déjà son
  cas). Le fichier suit la forme du registre de WP08 ; s'il n'admet pas une liste vide, signale-le à l'orchestrateur
  plutôt que de dupliquer le cas de la configuration.
- `x-process: public` sur les sept opérations du catalogue. **Attention** : `media-isolation.spec.ts` compte toutes
  les opérations marquées `x-process` (39 attendues, chacune avec un cas). Avant de poser la marque, vérifie ce test ;
  s'il casse, ne le modifie pas (hors carte) : arrête ce point et demande à l'orchestrateur.

## Test Strategy

Ordre : `npm run lint`, `npm run typecheck`, `npm run reset-db -w @cashless/ledger-sql`,
`npm run test:pgtap -w @cashless/ledger-sql`, puis `npm run reset-db -w @cashless/ledger-sql && npm test -w
@cashless/api -- --runInBand`. Jamais pgTAP sur une base où Jest vient de tourner (rejouer `reset-db`). La base
partagée appartient à l'orchestrateur : tests en série seulement. Dans un worktree de lane, crée d'abord les liens
`node_modules/@cashless/{api,contracts,ledger-sql,tag-format}`. Horloge de la base Docker qui peut reculer : aucun test
ne compare l'heure de Node à `now()` de la base sans marge. Les suites existantes `test/integration/devices/config.spec.ts`
et `device-journey.spec.ts` doivent rester vertes (non-régression de la 5a).

## Definition of Done

- Sept opérations du catalogue servies ; `DeviceConfig.catalog` servi avec sa version ; `device_catalog_served`
  écrit à chaque nouvelle version servie.
- Lint, typecheck, pgTAP et Jest verts en série ; matrice des preuves verte.
- Chaque sous-tâche marquée : `spec-kitty agent tasks mark-status T044 --status done --mission
  terminaux-paiement-en-ligne-01M52QB9` (idem T045 à T047).
- Compte rendu ajouté en fin de ce fichier : écarts au plan (sens) ; retouches hors carte (une ligne chacune) ; points
  soumis au porteur ; fichiers à faire relire par une personne (aucun fichier de clé ou de droit attendu ; signaler
  sinon) ; **critères couverts avec leur preuve** (fichier de test et nom du cas) pour FR-007, FR-008, FR-026 (part
  catalogue), NFR-007 (part catalogue) et la part « version servie » de FR-012.

## Risks

- Délégation contrôlée par l'API seule : interdit (A21) ; l'API ne fait que précéder la base.
- `device_catalog_served` non écrit pour une version servie : une vente au prix affiché serait refusée (FR-012) ;
  écrit pour une version non servie : élargirait les prix admis (A2) — seul `record_device_catalog_served` l'écrit.
- `config_id` modifié par le catalogue : casserait la déduplication de `record_config_served` (R-04).
- Libellé de catégorie non figé dans `catalog_version_item` (seul `category_id` l'est) : servi depuis
  `catalog_category` ; un renommage crée une version, donc la configuration suit. Signale-le si 0032 fige le libellé.
- Points à trancher (à signaler) : `403` ou `404` pour un `MERCHANT_ADMIN` sans délégation ; lecteurs de
  `getCatalogVersion` ; code du refus « événement `CLOSED` » ; noms des actions d'audit ; forme de `catalog.cases.ts`
  sans route ; `x-process` et `media-isolation.spec.ts` ; `audit.service.ts` hors carte.

## Reviewer Guidance

Le relecteur distinct vérifie :
- chaque écriture passe par une fonction de 0032, une seule, avec l'auteur ; aucun `INSERT`/`UPDATE` direct sur une
  table du catalogue ;
- refus : rôle absent (`403`), hors périmètre ou autre prestataire (`404` neutre), commerçant sans délégation, bornes
  (`422`), événement clos ;
- la configuration : version servie = dernière version, écrite une fois par terminal et par version, `config_id`
  stable, ETag qui change ; aucune donnée d'un autre point de vente dans `items` ;
- aucune régression des tests de configuration de la 5a.
