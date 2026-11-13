---
work_package_id: WP02
title: Paquet @cashless/shared-rules et vecteurs
dependencies: []
requirement_refs:
- FR-001
planning_base_branch: feat/passerelle-locale
merge_target_branch: feat/passerelle-locale
branch_strategy: Planning artifacts for this mission were generated on feat/passerelle-locale. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/passerelle-locale unless the human explicitly redirects the landing branch.
base_branch: kitty/mission-passerelle-locale-01M6NM1S
base_commit: bf265b0c7ee6e230f9602ffb6f4099ce8bcd7003
created_at: '2026-11-05T15:35:41.206059+00:00'
subtasks: [T005, T006, T007, T008, T009]
phase: Phase 1 - Contrat et code partagé
agent: claude
history:
- timestamp: '2026-11-05T12:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: packages/shared-rules/
create_intent: [packages/shared-rules/package.json, packages/shared-rules/tsconfig.json, packages/shared-rules/jest.config.cjs, packages/shared-rules/src/index.ts, packages/shared-rules/src/edge-content.ts, packages/shared-rules/src/edge-chain.ts, packages/shared-rules/src/node-env.ts, packages/shared-rules/src/effective-balance.ts, packages/shared-rules/test/architecture.spec.ts, packages/shared-rules/test/edge-vectors.spec.ts, apps/api/test/fixtures/edge-vectors/gen_edge_vectors.py, apps/api/test/fixtures/edge-vectors/vectors.json]
execution_mode: code_change
model: sonnet
owned_files: [packages/shared-rules/**, apps/api/src/ledger/money/**, apps/api/src/payments/chained-content.ts, apps/api/src/offline/rules/**, apps/api/src/offline/batches/batch-chain.ts, apps/api/test/fixtures/edge-vectors/**]
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP02 : Paquet `@cashless/shared-rules` et vecteurs

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role : implementer /
Agent : claude). Lis ensuite la fiche de contexte fournie par l'orchestrateur, ce prompt, puis seulement :

- `docs/passation-8/contexte-m8.md` : décisions 1 (« mêmes modules ») et 10 ;
- `research.md` R-02 (en entier), R-12 (contenu, chaîne, vecteurs a à j), R-13 (signature de lot) ;
- `contracts/interfaces.md` § 5 (noms figés), § 8 (`nodeEnv`), § 11 ;
- `data-model.md` A.6 invariant 2 (chaîne) ; constats `A07`, `A14`, `A26` de `docs/passation-8/rapports/plan-adversarial.md` ;
- code : `apps/api/src/payments/chained-content.ts`, `apps/api/src/offline/batches/batch-chain.ts`,
  `apps/api/src/payments/device-seq-registry.ts` (fonction `contentSha256`, l. 75), `apps/api/src/config/config.ts`
  l. 329-345 (`nodeEnv`), `apps/api/src/ledger/money/*`, `apps/api/src/offline/rules/*`, `apps/api/test/unit/architecture.spec.ts`,
  `apps/api/test/fixtures/offline-vectors/gen_vectors.py` (méthode), `packages/tag-format/{package.json,jest.config.cjs,tsconfig.json}`
  (gabarit de paquet), `schema_grand_livre_cashless.sql` l. 1973-1981 (`chain_step`, `edge_chain_genesis`).

Priorité des sources (SPECIFICATION §0.3). Contradiction : tu la signales. En cas de désaccord entre `tasks.md`,
`interfaces.md` et `data-model.md`, `interfaces.md` fait foi.

## Objective

Créer le paquet workspace `@cashless/shared-rules` : un seul code de règles pour le central et la passerelle. On y
DÉPLACE (git mv, sans changer un comportement) la logique pure de l'API, puis on y ajoute les fonctions nouvelles de la
mission (contenu et chaîne d'une opération de passerelle, signature de lot, `nodeEnv`, solde effectif) avec des vecteurs
générés par un script INDÉPENDANT du code testé. Le lot doit passer avant que d'autres lots n'importent ces chemins.

## Branch Strategy

- Branche de planification et de fusion : `feat/passerelle-locale`.
- Worktree alloué par lane, calculé dans `lanes.json`.
- Commande : `spec-kitty agent action implement WP02 --agent claude --mission passerelle-locale-01M6NM1S`
  (avec `LC_ALL=C LANG=C`).

## Périmètre et arbitrages

- Déplacements (R-02) : `ledger/money/*` (`fee`, `rounding`, `spend`, `split`, `tax`, `index`), `payments/chained-content.ts`,
  `offline/rules/*`, et la partie PURE de `offline/batches/batch-chain.ts` (`chainStep`, genèse, hachage d'en-tête JCS).
  `verifyChain` dépend de `ParsedBatch` (type de l'API) : si le type est pur, déplace-le ; sinon `verifyChain` reste dans
  l'API et importe `chainStep` du paquet. `contentSha256` (de `device-seq-registry.ts`, pure : JCS puis SHA-256) passe dans
  le paquet ; `device-seq-registry.ts` l'importe (changement d'import seulement).
- Le contrôle de signature de requête RFC 9421 (`device-identity/request-signature.ts`) : lis-le ; pur, il peut venir
  dans le paquet ; sinon il reste (R-02 prévoit un adaptateur côté passerelle). Décide sur la lecture, consigne dans le rapport.
- Le paquet n'importe ni `@nestjs/*`, ni `pg`, ni `node:fs`, `node:net`, `node:http(s)`, ni aucun chemin de `apps/`
  (test d'architecture). `@cashless/contracts` et `canonicalize` sont permis (`canonicalize` n'est publié qu'en ES : son
  traitement dans `jest.config.cjs` reprend celui de l'API).
- **`nodeEnv`** : la fonction naît dans le paquet avec la MÊME énumération (`production`, `development`, `test`) et le même
  message d'erreur que `config.ts` ; `config.ts` l'importe au lieu de la définir (changement d'import hors carte, une ligne
  au rapport : §11). Un seul code, deux consommateurs.
- Hors lot : tout fichier de `apps/gateway` (créé en WP16), les clés d'accord, la base. Aucune migration.
- **Hors carte à signaler** : mises à jour d'imports dans les fichiers de l'API qui consomment les chemins déplacés (une
  vingtaine), `package.json` racine (`workspaces`), `package-lock.json` (workspace ajouté ; `npm install --package-lock-only
  --ignore-scripts`), `config.ts`. Une ligne par fichier dans le rapport.
- Ne lance pas Jest (l'orchestrateur le fait en série). Tu peux lancer `npm run typecheck` et le script Python des vecteurs.

## Subtasks

### T005 : Paquet, workspace, test d'architecture

- `packages/shared-rules/package.json` (`@cashless/shared-rules`, `"main": "src/index.ts"`, `"types"`, scripts `typecheck` et
  `test` comme `tag-format`), `tsconfig.json`, `jest.config.cjs` (préréglage commun), `src/index.ts` qui ré-exporte tout.
- Ajouter `packages/shared-rules` à `workspaces` de `package.json`, après `packages/ledger-sql`.
- `test/architecture.spec.ts` : lit récursivement `packages/shared-rules/src` et échoue sur tout import interdit ci-dessus.
  Le test doit échouer sur une version fautive : ajoute un fichier d'essai en mémoire ou en dossier temporaire qui importe
  `pg` et prouve que la détection fonctionne (sinon le test peut être vide sans qu'on le voie).

### T006 : Déplacer `money`, `chained-content`, `offline/rules`, partie pure de `batch-chain`

- `git mv` pour conserver l'historique ; les tests unitaires qui visent ces fichiers (`apps/api/test/unit/...`) se déplacent
  avec eux dans `packages/shared-rules/test/` quand ils n'importent que du code déplacé ; les autres restent et changent d'import.
- Mets à jour tous les imports de l'API vers `@cashless/shared-rules` (ou un chemin du paquet). Aucun comportement ne change :
  pas de renommage, pas de nettoyage opportuniste.
- L'API doit continuer à compiler (`npm run typecheck -w @cashless/api`) et ne plus contenir les fichiers déplacés. Aucune
  copie laissée (la copie serait une divergence silencieuse, R-02 alternative c).

### T007 : Fonctions nouvelles (noms de `interfaces.md` § 5, figés)

- `edgeContent(op)` : objet JSON formé, dans cet esprit exact (R-12) : (1) `chainedContent(op)` (onze champs, absents omis) ;
  (2) `edge_seq` (entier sûr), `device_serial`, `authorized_mode` ; (3) `device_batch_id` et `edge_guichet` s'ils sont présents
  (objet entier, absents omis) ; (4) `edge_decision` s'il est présent (inclus : la décision est ce que le central reprend).
- `edgeContentSha256(op)` = SHA-256 de `JCS(edgeContent(op))`. `edgeChainGenesis(gatewayId)` =
  SHA-256(`"CASHLESS/EDGE-CHAIN/v1"` ‖ uuid sur 16 octets bruts). `chainStep(prev, content)` = SHA-256(prev ‖ content).
- `edge_seq` supérieur à 2^53 - 1, négatif ou non entier : exception (cas (j)) ; 2^32 et 2^53 - 1 acceptés (cas (g)).
- `batchSigningPayload(batch)` : octets de `JCS(lot sans le champ signature)` (R-13). Un champ inconnu du lot est conservé tel quel.
- `nodeEnv(value)` ; `effectiveBalance(central, deltas)` : solde central + somme des deltas (`bigint`, jamais de flottant),
  composantes payé et offert séparées. Fonction pure ; la règle de purge des deltas (A26) vit dans WP18, pas ici.
- `EdgeSyncOperationLike`, `EdgeSyncBatchLike` : types minimaux déclarés dans le paquet (pas d'import de `@cashless/contracts`
  si cela crée un cycle ; sinon permis).

### T008 : Générateur de vecteurs indépendant et `vectors.json`

- `apps/api/test/fixtures/edge-vectors/gen_edge_vectors.py` : Python autonome (bibliothèque standard : `hashlib`, `json`,
  `uuid`), qui NE LIT AUCUN code TypeScript. Il écrit `vectors.json`. Implémente la canonicalisation JCS toi-même (tri des
  clés, séparateurs, échappements) ; ne copie pas d'algorithme depuis le TypeScript.
- Cas (R-12) : (a) genèse pour un UUID donné ; (b) trois maillons `EDGE_ONLINE` `PURCHASE`, `VOID`, `REVERSAL` ; (c) un
  `DEVICE_OFFLINE` relayé avec `device_batch_id` ; (d) `ACTIVATION` ; (e) `DEPOSIT_CASH` ; (f) `TOPUP_CASH` ; (g) `edge_seq` =
  2^32 et 2^53 - 1 ; (h) le même contenu avec et sans `edge_decision` (empreintes DIFFÉRENTES, vérifiées par le script) ;
  (i) propriété inconnue dans `tap` conservée telle quelle ; (j) `edge_seq` = 2^53 refusé. Ajoute (k) : charge utile de
  signature d'un lot, avec `staff_token_audit` présent et absent (la signature couvre l'audit).
- Relis `gen_tests.py` l. 662 (`EG = edge_chain_genesis(...)`) : ton cas (a) doit donner la même valeur que le kit pour le même
  UUID. Compare, et dis-le dans le rapport.
- `test/edge-vectors.spec.ts` (dans le paquet) lit `vectors.json` et vérifie chaque cas ; il vérifie aussi que le fichier
  n'est pas vide (au moins 11 cas) et que chaque cas de refus lève bien.

### T009 : Non-régression de l'API

- La suite unitaire de l'API reste verte sans autre changement que les imports (preuve demandée à l'orchestrateur). Ne touche
  à aucun test d'intégration. `test/unit/architecture.spec.ts` de l'API continue de passer ; si un de ses motifs visait un
  chemin déplacé, adapte-le sans l'affaiblir et signale-le.
- Vérifie par `grep` qu'aucun fichier de l'API n'importe encore un chemin déplacé.

## Tests attendus

- `packages/shared-rules/test/architecture.spec.ts` : imports interdits détectés (avec contrôle positif).
- `packages/shared-rules/test/edge-vectors.spec.ts` : cas (a) à (k) ; une implémentation qui exclut `edge_decision`, qui
  tronque `edge_seq` à 32 bits ou qui laisse passer 2^53 doit échouer.
- Tests unitaires déplacés (`money`, `rules`, `chained-content`) verts à leur nouvel emplacement.
- `nodeEnv` : `production`, `development`, `test` acceptés ; `undefined`, `''`, `prod` refusés avec le message d'origine.
- `effectiveBalance` : sans delta, avec deltas négatifs, avec `bigint` supérieur à 2^53 (aucune perte de précision).

## Sécurité

- Ce code est exécuté des deux côtés : une divergence ici est une divergence de comptabilité. Aucune règle (frais, arrondi,
  `spend_order`, plafonds) ne doit changer à l'occasion du déplacement ; si tu en vois une fautive, signale-la sans la corriger.
- `edgeContent` protège la chaîne de la passerelle : oublier un champ (surtout `edge_decision`) laisserait un maillon altéré
  sans rompre la chaîne. Le test (h) existe pour cela.
- Aucun secret dans le paquet ; aucun import de module qui lit le disque ou le réseau (garde d'architecture).
- Règle 1 de `CLAUDE.md` : un écart qui affaiblit un contrôle (garde d'architecture assouplie, vecteur supprimé) est soumis
  au porteur AVANT d'être codé.

## Definition of Done

- [ ] `packages/shared-rules` déclaré workspace ; `npm run typecheck` vert pour le paquet et l'API.
- [ ] Fichiers déplacés par `git mv` ; aucune copie restante ; imports de l'API mis à jour.
- [ ] Sept fonctions nouvelles aux noms et signatures de `interfaces.md` § 5.
- [ ] `gen_edge_vectors.py` indépendant du TypeScript ; `vectors.json` généré, cas (a) à (k).
- [ ] Rapport : liste des fichiers déplacés, des imports modifiés hors carte (§11), décision sur la signature de requête RFC 9421,
      valeur du cas (a) comparée au kit, ce qui n'a pas été lancé (Jest) et pourquoi.
- [ ] Aucun `.sql` généré touché ; aucun commit ; le port 80 n'est pas touché.

## Ce que le relecteur doit casser

1. Chercher dans `packages/shared-rules/src` un import de `pg`, `@nestjs/*`, `node:fs` ou un chemin `apps/` : doit échouer au test.
2. Retirer `edge_decision` de `edgeContent` : le cas (h) doit échouer.
3. Passer `edge_seq = 2^53` ou `-1` : exception ; 2^53 - 1 : accepté.
4. Comparer `edgeChainGenesis` au kit (`gen_tests.py` l. 662) pour le même UUID.
5. Diff des fichiers déplacés contre leur ancienne version : aucun octet de logique modifié (seulement des imports).
6. `config.ts` n'a plus sa propre `nodeEnv` ; un seul message d'erreur dans le dépôt.
7. Le générateur Python ne lit aucun fichier `.ts` ni `.js` ; relancé deux fois il produit un `vectors.json` identique.
8. `grep` d'un ancien chemin (`ledger/money`, `payments/chained-content`, `offline/rules`) dans `apps/api` : aucun import restant.
