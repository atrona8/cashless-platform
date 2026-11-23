---
work_package_id: WP09
title: /me complet (numéro imprimé, avis de solde provisoire) et ajout au contrat
dependencies: [WP04, WP07]
requirement_refs:
- FR-009
- FR-010
- NFR-004
- C-001
planning_base_branch: feat/serveur-app-festivalier
merge_target_branch: feat/serveur-app-festivalier
branch_strategy: >-
  Planning artifacts for this mission were generated on feat/serveur-app-festivalier. During
  /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must
  merge back into feat/serveur-app-festivalier unless the human explicitly redirects the landing branch.
base_branch: kitty/mission-serveur-app-festivalier-01M7WB69
base_commit: 54694d7b2e3874f51085e3c3e16fc4d4031f49db
created_at: '2026-11-20T15:51:10.808854+00:00'
subtasks: [T037, T038, T039, T040]
phase: Phase 2 - API
agent: claude
history:
- timestamp: '2026-11-20T10:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: apps/api/src/customer-app/me.service.ts
create_intent:
- apps/api/test/integration/customer-app/me-10a.spec.ts
execution_mode: code_change
model: sonnet
owned_files:
- apps/api/src/customer-app/me.service.ts
- packages/contracts/openapi.yaml
- tools/contract-stability/contract-baseline.json
- apps/api/test/integration/customer-app/me-10a.spec.ts
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP09 : /me complet (numéro imprimé, avis de solde provisoire)

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role :
implementer / Agent : claude). Lis ensuite la fiche commune
`docs/passation-10a/fiche-implementation.md`, ce prompt, puis seulement :

- `contracts/printer-file-printed-number.md`, `interfaces.md` (lignes `MeService`,
  `wallet_pending_offline_notice`, `media.printed_number`), `research.md` R-06 et R-07 ;
- la migration `0098` ou `0097` **telle que fusionnée** (colonne `printed_number`, fonction
  `wallet_pending_offline_notice` : signatures réelles) et les tests pgTAP de WP03
  (`tests_pending_offline_notice.sql` : l'amorçage de terminaux, de snapshots et de lots à
  réutiliser) ;
- `apps/api/src/customer-app/me.service.ts` : en-tête l. 1-12 (limites connues,
  `pending_offline_notice` « absent »), `KYC_VERIFIED_SQL` l. 17-20, `CustomerMediaDto` l. 22-28,
  `profile` (`getMe`) l. 66-89, `wallets` (`listMyWallets`) l. 91-156 (requête l. 95-118, appel
  d'éligibilité l. 120-130, objet rendu l. 131-150), `media` l. 157-159, `mediaRows` l. 162-181
  (`printed_number: null` l. 180) ;
- `apps/api/src/customer-app/lost-media.service.ts` l. 56-66 (`NULL::text AS printed_number`) :
  **hors carte**, voir plus bas ;
- `packages/contracts/openapi.yaml` : `importClaimCodeAssociations` l. 10436-10475 (description du
  corps `text/csv` l. 10459), schéma `ClaimCodeAssociationResult` l. 18748-18765 (énumération
  `reason` l. 18765), `CustomerMedia` l. 17043-17062, `Wallet` l. 17063-17110
  (`pending_offline_notice` facultatif l. 17093) ;
- `tools/contract-stability/check.mjs` (liste blanche : `classify` l. 141-210 ; `subtreeHash`
  exporté), `contract-baseline.json` (entrées de types `description` et `enum-value`, commentaire
  d'en-tête), `check-baseline-decision.mjs` (ligne « Décision du porteur : <date> ADR-<n> » exigée)
  et, dans `docs/DECISIONS_ADR.md`, l'ADR-215 (l. 3142 : comment une description réécrite a été
  épinglée) ;
- `apps/api/test/integration/customer-app/me.spec.ts` l. 1-60 (monde, clients, en-têtes) et 140-175
  (forme attendue de `/me/wallets` et `/me/media`) ; `test/support/contract-schema.ts`
  (`contractViolations`).

Priorité des sources (SPECIFICATION §0.3). Contradiction ou manque : tu le signales, tu ne tranches
pas en silence.

## Objective

`listMyMedia`, `listMyWallets` et `getMe` servent enfin les deux champs déjà déclarés au contrat :
`CustomerMedia.printed_number` lu en base (`null` si inconnu) et `Wallet.pending_offline_notice`
calculé par la fonction de la base (FR-009, FR-010, SC-004, NFR-004). Le seul ajout au contrat est
la description du corps `text/csv` de `importClaimCodeAssociations` (colonne facultative), inscrit
dans `contract-baseline.json`.

## Context

- **Décisions du porteur (20/11/2026)** : `printed_number` en 3e colonne facultative du fichier de
  l'imprimeur ; l'ajout au contrat est rétrocompatible et validé par le porteur ; consigne du
  05/11/2026 : implémenter ce que `openapi.yaml` déclare, tout ajout signalé avant. Aucune route,
  aucun champ, aucun code d'erreur nouveau.
- **Interfaces consommées** : `media.printed_number text` (nul si inconnu) ;
  `wallet_pending_offline_notice(p_wallet uuid) RETURNS boolean` (`STABLE`, `SECURITY INVOKER`, sous
  la RLS du prestataire de la transaction) ; `EXECUTE` de `cashless_app` (WP04). **Interface
  possédée** : le rendu de `MeService`.
- **Décision du porteur (20/11/2026)** : les deux motifs `BAD_PRINTED_NUMBER` et
  `PRINTED_NUMBER_TAKEN` (produits par WP07) sont ajoutés à l'énumération
  `ClaimCodeAssociationResult.reason` (`openapi.yaml` l. 18765, fermée sur neuf motifs) : entrées
  `enum-value` dans `contract-baseline.json`, types TS et Dart régénérés, ADR-225. Aucun autre
  ajout.
- **Retouches hors carte à nommer** : (1) `lost-media.service.ts` l. 59 :
  `NULL::text AS printed_number` devient `m.printed_number` (même champ de `CustomerMedia`, rendu
  aujourd'hui `null` par `reportMyMediaLost`) ; (2) fichiers **générés**
  `packages/contracts/generated/openapi.ts` et les modèles Dart
  (`packages/contracts/dart/lib/src/generated/models/reason3.dart`, `rejected.g.dart`, etc.),
  régénérés par `npm run generate -w @cashless/contracts` puis `npm run generate:dart -w
  @cashless/contracts` (outil Dart absent : signale-le, ne les modifie jamais à la main) ;
  `npm run check -w @cashless/contracts` doit passer.

## Subtasks

### T037 : `mediaRows` : `printed_number` lu en base

1. `mediaRows` : ajouter `m.printed_number` au `SELECT` (l. 168) et à la déclaration de type de la
   ligne ; rendre `printed_number: r.printed_number ?? null` (l. 180). L'ordre des champs du JSON
   rendu ne change pas (`me.spec.ts` l. 158-165 compare l'objet entier).
2. En-tête du fichier (l. 10-12) : retirer « `pending_offline_notice` : absent » et dire ce qui est
   servi.
3. Retouche hors carte (1) ci-dessus ; `claims.service.ts` (WP07) lit déjà le champ pour
   `claimMedia`.

Validation : `npx tsc -p tsconfig.json --noEmit` ; `me.spec.ts` (hors carte) vert : ses bracelets
sans numéro restent `null`.

Cas limites : un numéro imprimé d'un autre prestataire n'est jamais lu (RLS) ; bracelet sans numéro
: `null`, pas chaîne vide.

### T038 : `pending_offline_notice` par portefeuille

1. Dans la requête de `wallets` (l. 95-118), ajouter `wallet_pending_offline_notice(w.id) AS
   pending_offline_notice` ; type de la ligne `pending_offline_notice: boolean` ; objet rendu
   l. 131-150 : `pending_offline_notice: w.pending_offline_notice` (le champ est facultatif au
   contrat : il est toujours rendu, `true` ou `false`). Même transaction `TenantTx` que le reste (la
   fonction est `INVOKER` : elle lit `offline_snapshot_ack` et `offline_batch` sous la RLS du
   prestataire).
2. `profile` (`getMe`) ne porte aucun portefeuille : rien à y ajouter ; vérifie dans `openapi.yaml`
   que `getMe` ne déclare pas ce champ.
3. Une panne de la fonction ne doit pas faire échouer la liste silencieusement : laisse l'erreur
   remonter (pas de `try` qui rende `false` : un avis faux « pas de solde provisoire » serait
   trompeur).

Validation : tests de T040. **Mutation** : remplace l'appel par `false` : le test « avis vrai »
échoue.

### T039 : `openapi.yaml` (description du corps `text/csv`) et `contract-baseline.json`

1. `openapi.yaml` l. 10459 : réécrire la `description` du schéma du corps `text/csv` : lignes
   `code,uid[,printed_number]` ; troisième colonne facultative (1 à 32 caractères `[A-Z0-9-]`, casse
   normalisée, unique par prestataire) ; deux colonnes restent valides ; avec ou sans ligne
   d'en-tête ; l'exemple (`example`) reste valable, ajoute-en un à trois colonnes **sans toucher** à
   l'existant (un `example` ajouté à un endroit nouveau est un ajout à épingler aussi : préfère
   décrire dans le texte). Ajouter `BAD_PRINTED_NUMBER, PRINTED_NUMBER_TAKEN` à la fin de
   l'énumération l. 18765 (décision du porteur). Rien d'autre.
2. `contract-baseline.json` : une entrée `kind: "description"` au pointeur exact ci-dessous (une
   seule ligne dans le JSON, `~1` pour chaque `/`), avec `before` = le texte actuel (copie exacte)
   et `sha256` = `subtreeHash` du **nouveau** texte :
   ```
   /paths/~1operators~1{operator_id}~1media-batches~1{batch_id}~1claim-code-associations
   /post/requestBody/content/text~1csv/schema/description
   ```
   Deux entrées `kind: "enum-value"` aux pointeurs `/components/schemas/ClaimCodeAssociationResult/
   properties/rejected/items/properties/reason/enum/9` et `…/enum/10` (suite du même pointeur),
   `sha256` = `subtreeHash` de chaque chaîne. Calcule les empreintes par `node -e
   "import('./tools/contract-stability/check.mjs').then(m=>console.log(m.subtreeHash(…)))"` (le
   module ne lance rien à l'import). Suis la forme des entrées existantes (`pointer`, `kind`,
   `sha256`, `before`).
3. **Décision du porteur** : `check-baseline-decision.mjs` refuse un fichier changé sans la ligne
   `Décision du porteur : 20/11/2026 ADR-225` dans le dernier commit qui le touche ou dans
   `docs/DECISIONS_ADR.md`. Mets-la dans le **message de ton commit** ; **ADR-225** est réservée à
   ce sujet (WP11 l'écrit).
4. Régénérer les types (retouche hors carte 2) et lancer `node tools/contract-stability/check.mjs` :
   **0 refus**. Les modèles Dart se régénèrent comme à la mission 9b : sans l'outil Dart, nomme-les
   dans la note.

Validation : `node tools/contract-stability/check.mjs` (sortie 0) ; `node
tools/contract-stability/check-baseline-decision.mjs` ; `npm run check -w @cashless/contracts`.

**Mutation** (note de lane) : modifie un caractère de la description dans `openapi.yaml` sans mettre
à jour l'empreinte : `check.mjs` sort `2` en nommant le pointeur ; remets-le.

### T040 : intégration `customer-app/me-10a.spec.ts` et mesure NFR-004

Jeu d'essai : monde de `me.spec.ts` (`createMediaWorld`, `goLive`, clients, portefeuilles) ;
amorçage des terminaux, snapshots et lots comme `tests_pending_offline_notice.sql` (WP03), par le
propriétaire.

1. `GET /me/media` : bracelet au numéro imprimé connu : le numéro apparaît ; sans numéro : `null` ;
   `contractViolations('CustomerMedia', …)` vide ; même chose pour la réponse de `reportMyMediaLost`
   (retouche hors carte 1) et de `claimMedia`.
2. `GET /me/wallets` : `pending_offline_notice: true` pour un portefeuille d'un événement dont un
   terminal non révoqué a un accusé de snapshot sans lot reçu depuis ; `false` après la remontée des
   lots (SC-004) ; `false` pour un événement `CLOSED` ; un terminal **révoqué** ne compte pas ; un
   autre événement du même client : sa propre valeur. `contractViolations('Wallet', …)` vide.
3. Cloisonnement : le festivalier B (autre compte, autre prestataire) ne voit ni le numéro ni l'avis
   d'un autre ; `JSON.stringify` de la réponse ne contient aucun identifiant d'un portefeuille
   étranger.
4. **NFR-004** : un client de **5 portefeuilles** (même grand livre) ; 30 appels de `getMe` et de
   `listMyWallets` ; p95 inférieur à 300 ms (aide `p95` de `device-latency.spec.ts` l. 82 ; essai
   dans `it` écarté par `SKIP_LATENCY`, comme `cash-topup.spec.ts` l. 294). Note le p95 mesuré. Si
   la fonction domine, regarde le plan d'exécution (`EXPLAIN`) et **signale** à WP03 un index
   manquant sans le créer ici.
5. Comptages limités au prestataire de l'essai.

Validation : `export PGDATABASE=cashless_wp09; source ../../tools/dev-db/env.sh; env | grep
DATABASE_URL`, puis `SKIP_LATENCY=1 npx jest test/integration/customer-app/me-10a.spec.ts
test/integration/customer-app/me.spec.ts --runInBand --forceExit` ; la mesure NFR-004 se lance
**sans** `SKIP_LATENCY`, seule ; `reset-db`.

## Branch Strategy

- Planification et fusion : `feat/serveur-app-festivalier`.
- Worktree de lane calculé par `lanes.json` ; la base contient WP04 et WP07 (donc WP01 à WP03).
- Commande : `LC_ALL=C LANG=C spec-kitty agent action implement WP09 --agent claude --mission
  serveur-app-festivalier-01M7WB69`.

## Commandes de preuve

```
cd <lane>/apps/api
export PGDATABASE=cashless_wp09; source ../../tools/dev-db/env.sh; env | grep DATABASE_URL
SKIP_LATENCY=1 npx jest test/integration/customer-app --runInBand --forceExit
cd ../.. && node tools/contract-stability/check.mjs && npm run check -w @cashless/contracts
```

## Definition of Done

- [ ] `printed_number` lu en base dans `/me/media`, `/me/wallets`, `reportMyMediaLost` ; `null`
  sinon.
- [ ] `pending_offline_notice` rendu par portefeuille via la fonction, vrai puis faux après remontée
  (SC-004).
- [ ] `check.mjs` à 0 refus, entrées de la liste blanche exactes ; `check-baseline-decision.mjs` à 0
  (ligne de décision dans le commit) ; types générés à jour (ou Dart signalé).
- [ ] NFR-004 mesuré (p95 noté) ; mutation de `pending_offline_notice` et de l'empreinte vérifiées.
- [ ] Note de lane : retouches hors carte, fichiers à faire relire par une personne
  (`contract-baseline.json` : « changer ce fichier est une décision du porteur »).
- [ ] Lignes de 100 caractères au plus ; `eslint` et `tsc` propres.

## Risks

1. Énumération `reason` oubliée : la réponse de l'import sort du contrat sans que `check.mjs` le
   voie.
2. Empreinte de description fausse (espace, retour à la ligne) : `check.mjs` refuse ; copie le texte
   exact.
3. Modèles Dart non régénérés : `npm run check` échoue en CI.
4. Avis calculé hors transaction du prestataire : fonction `INVOKER` sans RLS, résultat toujours
   faux.

## Ce que le relecteur doit casser

- Un festivalier qui lit le numéro ou l'avis d'un autre compte ou d'un autre prestataire.
- Un avis `false` alors qu'un terminal non révoqué a un accusé sans lot reçu ; `true` après la
  remontée.
- `check.mjs` : modifier un caractère de la description, retirer une valeur d'énumération, ajouter
  un champ non épinglé : sortie `2` attendue à chaque fois ;
  `git diff packages/contracts/openapi.yaml` ne montre que deux hunks.
- Mesurer le p95 sur une base chargée (5 portefeuilles, beaucoup de terminaux) ; chercher l'index
  manquant.
- Vérifier que `lost-media.service.ts` et `claims.service.ts` rendent le même numéro que
  `/me/media`.
