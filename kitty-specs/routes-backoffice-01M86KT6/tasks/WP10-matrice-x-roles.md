---
work_package_id: WP10
title: Matrice x-roles
dependencies: [WP04, WP06, WP07, WP08, WP09]
requirement_refs:
- FR-003
- FR-004
- SC-002
- SC-003
planning_base_branch: feat/routes-backoffice
merge_target_branch: feat/routes-backoffice
branch_strategy: >-
  Planning artifacts for this mission were generated on feat/routes-backoffice. During
  /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must
  merge back into feat/routes-backoffice unless the human explicitly redirects the landing branch.
subtasks: [T038, T039, T040]
phase: Phase 3 - Preuves transverses et consignation
agent: claude
history:
- timestamp: '2026-11-24T13:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: apps/api/test/integration/end-to-end/x-roles-matrix.spec.ts
create_intent:
- apps/api/test/integration/end-to-end/x-roles-matrix.spec.ts
- apps/api/test/integration/end-to-end/x-roles-cases/registry.ts
- apps/api/test/integration/end-to-end/x-roles-cases/
execution_mode: code_change
model: sonnet
owned_files:
- apps/api/test/integration/end-to-end/x-roles-matrix.spec.ts
- apps/api/test/integration/end-to-end/x-roles-cases/**
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP10 : Matrice x-roles

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role : implementer / Agent :
claude). Lis ensuite la fiche commune `docs/passation-11b/fiche-implementation.md`, ce prompt, puis seulement :

- `interfaces.md` §3 (`x-roles`, liste fermée des valeurs), §5 (balayage d'isolement et règle « opération servie »), §6
  (matrice) ; `research.md` D3 ; `spec.md` FR-003, FR-004, SC-002 ;
- `tools/contract-stability/x-roles/roles.json` (WP04, fusionné : `operationId` → rôles, avec `source` fichier:ligne) et
  `apply.mjs` ; la garde de WP04 (T016) pour ne pas la redoubler ;
- `apps/api/test/integration/end-to-end/backoffice-isolation.spec.ts` et `backoffice-isolation-cases/` (WP05 à WP09 :
  comment un cas est joué, comment le personnel de test est créé) ; `device-auth-matrix.spec.ts` et
  `device-auth-cases/registry.ts` (modèle d'un registre de cas par domaine) ;
- `apps/api/src/identity/roles.guard.ts`, `roles.decorator.ts`, `scope-resolver.ts` (comment un refus de droit se
  distingue d'un refus de portée ou de validation) ; `apps/api/test/support/` (`app.ts`, `db.ts`, fixtures des missions
  précédentes pour créer un événement, un bracelet, une session de caisse).
- Modèle de CI : `apps/api/jest.config.cjs` l. 28-50 (`testPathIgnorePatterns` sous `SKIP_LATENCY`) et
  `.github/workflows/ledger-tests.yml` l. 280-290 (étape « Rendu partiel en espèces… (suite seule, en série) »).

## Objective

Prouver (D3, matrice échantillon) que les rôles déclarés par `x-roles` pour **chaque** opération du contrat sont fidèles
aux contrôles réels du serveur : un rôle déclaré n'est jamais refusé pour droit, un rôle non déclaré l'est.

## Subtasks

### T038 — Cas de la matrice par domaine

1. Un fichier par domaine dans `x-roles-cases/` (modèle : `device-auth-cases/`), chargés par `registry.ts` (lecture des
   `*.cases.ts`). Domaines suggérés : identité et organisation, événements et configuration, médias et portefeuilles,
   paiements, caisse et recharges, hors ligne, terminaux, clôture et exports, back-office de la mission (11 opérations).
   Découpe selon `roles.json` ; ne crée pas de fichier vide.
2. Forme d'un cas : `{ operationId, prepare(fx) → { method, path, body?, headers? } }` : la préparation crée l'objet
   cible (événement, bracelet, anomalie…) **dans la portée de l'appelant déclaré** ; elle ne dépend jamais d'un rôle.
3. Pour chaque opération et chaque appelant humain du personnel de la liste fermée : un appel **avec un rôle déclaré**,
   dans la portée voulue → la réponse n'est **jamais `403` pour droit** (tout autre statut convient : `200`, `201`, `404`,
   `409`, `422` ; la matrice ne vérifie pas le métier) ; un appel **avec un rôle non déclaré**, même portée → `403`.
   Un appelant d'une autre nature (`VENDOR`, `CUSTOMER`, `DEVICE`, `GATEWAY`, `PUBLIC`) n'est joué que là où `x-roles` le
   déclare ou l'exclut sans ambiguïté ; sinon la raison de l'exclusion est écrite dans le cas.
4. Échantillon (D3) : ≈ 470 appels au total ; si une opération a plus de 3 rôles déclarés, joue un rôle haut, un rôle bas
   et un rôle intermédiaire ; le rôle non déclaré joué est le plus proche en droits (le plus susceptible d'être autorisé
   par erreur). Écris la règle de choix en tête du registre.
5. Distinguer **403 pour droit** d'un 403 d'une autre cause (ex. `APPROVAL_REQUIRED`, `403` de portée) : le test lit le
   corps du problème (`code`) et n'accepte comme « pour droit » que le code de refus de rôle du catalogue. Note dans le
   registre quels codes 403 sont connus et pourquoi.
6. Une opération du contrat sans cas fait échouer `x-roles-matrix.spec.ts` en la nommant (lecture d'`openapi.yaml`).

### T039 — `x-roles-matrix.spec.ts` et mutation prouvée

1. Le spec lit `openapi.yaml`, vérifie que chaque opération porte `x-roles` (sans redoubler la garde de WP04, qui reste
   dans `tools/`), joue tous les cas du registre en série et accumule **tous** les écarts avant d'échouer (message : opération,
   rôle, attendu, obtenu, `source` de `roles.json`).
2. **Opérations de la mission** : vérifie que les 11 `operationId` de `MISSION_11B_OPERATIONS`
   (`apps/api/test/support/mission-11b-operations.ts`) sont **toutes servies par l'application** (la route répond, pas `404`
   de route) et **ont toutes leur cas** dans `backoffice-isolation-cases/` (c'est la règle de §5 : une opération servie sans
   cas fait échouer le balayage ; ici, on vérifie en plus qu'aucune n'est restée non servie à la fin de la mission). Une
   opération de la mission non servie ou sans cas : échec en la nommant.
3. **Mutations à prouver, notées dans la note de lane avec résultat** (appliquées dans la lane, jamais commitées) :
   (a) retirer un rôle d'un `@Roles` d'une des 11 routes du contrôleur → la matrice échoue sur « rôle déclaré refusé » ;
   (b) retirer un rôle d'un **contrôle de service** (une route sans `@Roles`, ex. `assertPlatformAdmin` ou
   `hasRole` dans un service) → échec ; (c) ajouter un rôle au contrôle sans le déclarer → échec « rôle non déclaré
   accepté » ; (d) supprimer `x-roles` d'une opération (dans une copie du contrat) → échec ; (e) retirer le cas d'une
   opération → échec « opération sans cas ». Si l'échantillon ne rattrape pas une mutation, élargis l'échantillon de ce
   domaine ; si c'est impossible, **consigne-le** (limite à reprendre en WP11, point ouvert) au lieu de le taire.
4. Si une dérive réelle est trouvée (rôle déclaré faux dans `roles.json`, ou contrôle du serveur plus large que la
   déclaration), **ne corrige ni `roles.json` ni le serveur** (hors carte) : liste-la dans la note de lane avec fichier:ligne ;
   un contrôle du serveur trop large qui affaiblit la sécurité est soumis au porteur (règle 1) sans être codé.

### T040 — Lancement en série

La suite est longue et partage la base : **à écarter de la passe parallèle et à lancer seule**.
1. `apps/api/jest.config.cjs` : ajouter `'end-to-end/x-roles-matrix'` à la liste de `SKIP_LATENCY` (une ligne, avec un
   commentaire « Mission routes-backoffice (WP10) : ≈ 470 appels, base partagée »).
2. `.github/workflows/ledger-tests.yml` : étape « Matrice des rôles autorisés, x-roles (suite seule, en série) » :
   `npm test -w @cashless/api -- --runInBand end-to-end/x-roles-matrix`, placée après la passe parallèle, sur le modèle de
   l'étape « Rendu partiel en espèces… ». Aucun autre changement de CI.
3. Lance la suite seule sur `cashless_wp10` : durée et nombre d'appels dans la note de lane (repris par WP11).

## Retouches hors carte permises

Deux, nommées dans la note de lane, une ligne chacune : `apps/api/jest.config.cjs` (T040.1) et
`.github/workflows/ledger-tests.yml` (T040.2), comme WP05 de la 9c.

## Definition of Done

- [ ] Chaque opération du contrat a un cas ; la matrice passe seule, en série, sur `cashless_wp10`.
- [ ] Les 11 opérations de la mission sont servies et ont leur cas d'isolement (vérifié par le spec).
- [ ] Les 5 mutations (a) à (e) échouent comme attendu ; résultats notés ; dérives éventuelles listées.
- [ ] `SKIP_LATENCY=1 npx jest end-to-end/x-roles-matrix` ne la lance pas ; `backoffice-isolation.spec.ts`,
      `media-isolation.spec.ts`, `architecture.spec.ts`, `test/unit/contracts` verts.

## Ce que le relecteur doit casser

- Retirer un rôle d'un `@Roles` ou d'un contrôle de service d'une opération hors mission (ex. `PLATFORM_ADMIN` d'une
  route de plateforme) et constater que la matrice échoue ; sinon, l'échantillon n'a pas rattrapé la dérive.
- Un test « rôle déclaré » qui accepte un `403` pour droit parce que le corps n'est pas lu ; un « rôle non déclaré » joué
  avec un rôle qui n'est pas voisin.
- Un cas dont la préparation donne au rôle non déclaré un droit par ailleurs (même portée, mais rôle supplémentaire).
- Une opération ajoutée au contrat sans cas qui ne ferait pas échouer le spec.
- La suite qui tourne dans la passe parallèle (comparer `jest.config.cjs`), ou qui change le mot de passe d'un rôle de la base.

## Implementation command

`LC_ALL=C LANG=C spec-kitty agent action implement WP10 --agent claude --mission routes-backoffice-01M86KT6`
