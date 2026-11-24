---
work_package_id: WP03
title: "Contrat : opérations et schémas de la mission"
dependencies: []
requirement_refs:
- FR-001
- FR-002
- FR-005
- FR-008
- FR-009
- FR-011
- FR-015
- FR-016
- C-001
- SC-002
planning_base_branch: feat/routes-backoffice
merge_target_branch: feat/routes-backoffice
branch_strategy: >-
  Planning artifacts for this mission were generated on feat/routes-backoffice. During
  /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must
  merge back into feat/routes-backoffice unless the human explicitly redirects the landing branch.
subtasks: [T010, T011, T012, T013]
phase: Phase 1 - Fondations
agent: claude
history:
- timestamp: '2026-11-24T13:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: packages/contracts/openapi.yaml
create_intent: []
execution_mode: code_change
model: sonnet
owned_files:
- packages/contracts/openapi.yaml
- packages/contracts/generated/**
- packages/contracts/dart/lib/**
- tools/contract-stability/contract-baseline.json
- apps/api/test/unit/contracts/contract-additions-9b.spec.ts
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP03 : Contrat : opérations et schémas de la mission

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role : implementer / Agent :
claude). Lis ensuite la fiche commune `docs/passation-11b/fiche-implementation.md` (démarrage, règles, base de données,
fin d'implémentation : ne pas la recopier ici), ce prompt, puis seulement :

- `kitty-specs/routes-backoffice-01M86KT6/contracts/backoffice-routes.md` (A1, A3 à A6 : **la** source des champs) et
  `interfaces.md` §3 (noms, rôles) ; `research.md` D10 ;
- `packages/contracts/openapi.yaml` : une opération et ses schémas ajoutés par la 9c comme modèle
  (`refundPartialCash`, `PartialCashRefundCreate`, `PartialCashRefund`) ; `/devices` l. 796-910 ;
  `DeviceAdminDetail` l. 13171, `DevicePage` l. 13182, `DeviceEnrollmentRequest` l. 13297, `HeartbeatRequest` l. 13786 ;
  `x-process: public` à l. 1233 (forme exacte) ; un schéma de page existant (`data`, `next_cursor`, `has_more`) ;
- `tools/contract-stability/check.mjs`, `check-baseline-decision.mjs` (regex `Décision du porteur : <date> ADR-<n>`),
  `contract-baseline.json` (entête `_comment` et fin de fichier : forme d'une entrée) ;
- `apps/api/test/unit/contracts/contract-additions-9b.spec.ts` (forme du test de gel : base, listes d'ajouts) ;
- `packages/contracts/scripts/` (`generate.mjs`, `generate-dart.sh`).

## Objective

Déclarer dans `openapi.yaml` les ajouts **A1, A3, A4, A5 et A6** de `contracts/backoffice-routes.md`, et seulement eux,
avec leurs types générés (TypeScript et Dart), leur référence de stabilité et leur test de gel. **`x-roles` (A2) n'est pas
dans ce lot : c'est WP04.** Aucun `ProblemCode` nouveau (D10). Aucune route existante modifiée hormis les propriétés
facultatives d'A6.

## Subtasks

### T010 — Opérations et schémas A1, A3, A4, A5

1. Huit opérations : `getStaffProfile`, `listEventSales`, `getSale`, `listAnomalies`, `classifyAnomaly`, `searchMedia`,
   `getWalletOverview`, `searchCustomerByPhone` (chemins et méthodes : `interfaces.md` §3). Toutes `x-process: public`,
   sécurité du personnel (même schéma de sécurité que `getDevice`), `Idempotency-Key` exigée pour `classifyAnomaly` et la
   forme déjà utilisée par les autres POST du personnel pour `searchCustomerByPhone` (relis un POST équivalent ; recherche
   sans effet : ne l'exige pas si les POST de lecture existants ne l'exigent pas, note le choix).
2. Schémas : `StaffProfile`, `StaffAssignment`, `SalePage`, `SaleSummary`, `SaleDetail`, `SaleLine`, `AnomalyPage`,
   `Anomaly`, `AnomalyClassificationCreate`, `MediaSearchResult`, `WalletOverview`, `CustomerSearchRequest`,
   `CustomerSearchResult` : champs, obligations et énumérations du fichier des ajouts. `additionalProperties: false` comme
   les schémas voisins. `SaleSummary`/`SaleDetail` : **aucun** champ de portefeuille ni de festivalier.
3. Réponses d'erreur : références aux réponses et `ProblemCode` **existants** seulement (`VALIDATION_FAILED`,
   `CONFLICT_STATE`, `NOT_FOUND`, `RATE_LIMITED`, 401, 403). `ANOMALY_KIND_NOT_CLASSIFIABLE` se décrit dans la
   `description` du 422 comme `reason`, pas comme code. `429` avec en-tête `Retry-After`.
4. Pagination : `limit` entier 1..200 défaut 50 ; `cursor` chaîne opaque.
5. Validation : `npm run check -w @cashless/contracts` ; `node tools/contract-stability/check.mjs` (les ajouts sont refusés
   tant que T012 n'est pas fait : c'est attendu).
6. **Mutation** : retirer `x-process: public` d'une opération ; la garde de processus (test existant qui lit le contrat)
   doit échouer ; note lequel.

### T011 — A6 : modèles de téléphone, `device_model` et `nfc_level`

1. `listPhoneModels` (`GET /phone-models`, `PhoneModelPage`), `upsertPhoneModel` (`PUT`, corps `PhoneModelUpsert`
   `{ nfc_level, measured_at }`, réponse `PhoneModel`), `deletePhoneModel` (`DELETE`, `204`). Paramètres de chemin
   `manufacturer` et `model` (chaînes ; encodage d'URL, 1 à 100 caractères).
2. Schémas `PhoneModel`, `PhoneModelPage`, `PhoneModelUpsert`, `DeviceModel` (`manufacturer`, `model`), `NfcLevel`
   (`RECOMMENDED`, `TOLERATED`, `UNTESTED`).
3. Propriétés **facultatives** (jamais dans `required`) : `device_model` sur `DeviceEnrollmentRequest` et
   `HeartbeatRequest` ; `device_model` et `nfc_level` sur `DeviceAdminDetail` et l'élément de `DevicePage`. Ne touche à
   rien d'autre dans ces schémas.
4. **Mutation** : rendre `device_model` obligatoire sur `HeartbeatRequest` : `check.mjs` doit le refuser comme
   modification non rétrocompatible ; note-le.

### T012 — `contract-baseline.json` et test de gel

1. Ajoute à `contract-baseline.json` **une entrée par ajout** (opérations et schémas ajoutés, propriétés facultatives
   nouvelles), avec l'empreinte calculée par l'outil (regarde comment `check.mjs` la calcule ; ne la fabrique pas à la
   main). Si un ajout modifie la description d'un élément existant, il y a une entrée de description : liste-les.
2. Complète `_comment` de la référence par : « Mission 11b (routes du back-office), décision du porteur du 24/11/2026
   (ADR-235) : … » (liste courte des opérations et schémas), de façon que la ligne exacte `Décision du porteur :
   24/11/2026 ADR-235` figure dans le **message du commit** de ce lot (regex de `check-baseline-decision.mjs`) ; l'ADR-235
   sera écrit par WP11 : signale-le dans la note (la garde peut le chercher dans `DECISIONS_ADR.md`).
3. `contract-additions-9b.spec.ts` : étends le test de gel pour que le contrat n'ajoute **que** les ajouts de la 11b
   (liste explicite d'opérations, schémas, propriétés facultatives), sans tolérance générale : ajouter la liste, ne pas
   supprimer les contrôles de la 9b ni élargir leurs tolérances. Base de comparaison : prends le commit de fin de la 9c
   (note-le), ou laisse la base de la 9b et ajoute les ajouts 9c et 11b en listes séparées, selon ce que le fichier fait
   déjà ; explique le choix.
4. `node tools/contract-stability/check.mjs` à 0 refus ; `node --test tools/contract-stability/*.test.mjs` vert ;
   `npx jest test/unit/contracts` vert (depuis `apps/api`).
5. **Mutations** : retirer une entrée de la référence → `check.mjs` refuse ; ajouter une opération non listée → le test
   de gel échoue.

### T013 — Types générés TypeScript et Dart

1. `npm run generate -w @cashless/contracts` puis `npm run generate:dart -w @cashless/contracts` (adapte à
   `package.json`). Ne retouche jamais `generated/**` ni `dart/lib/**` à la main.
2. `npm run check -w @cashless/contracts` vert (inclut le contrôle Dart `--check`) ; `npm run typecheck -w
   @cashless/contracts` ; `npx tsc --noEmit -p apps/api/tsconfig.json` (aucune rupture de l'API).
3. Si Dart n'est pas installé sur le poste : ne contourne pas ; signale-le dans la note (la CI le fera).

## Retouches hors carte permises

Aucune. (`x-roles` et la retouche de `openapi.yaml` et de `contract-baseline.json` par WP04 viennent après ce lot.)

## Definition of Done

- [ ] Exactement 11 opérations (8 de A1, A3-A5 plus 3 de A6) et 18 schémas de `interfaces.md` §3, rien d'autre.
- [ ] `check.mjs` 0 refus ; `node --test tools/contract-stability/*.test.mjs` ; `npm run check -w @cashless/contracts`
      verts ; test de gel vert.
- [ ] Aucun `ProblemCode` nouveau : `git diff` de `generated/problem-codes.ts` vide.
- [ ] Mutations notées. Fichier à faire relire par une personne : `contract-baseline.json` (décision du porteur).

## Ce que le relecteur doit casser

- Une propriété d'A6 rendue obligatoire, ou un champ existant modifié en silence (diff de `openapi.yaml` hors ajouts).
- Un champ de portefeuille ou de festivalier dans `SaleSummary`/`SaleDetail` ; un numéro dans un chemin (`GET`) de
  `searchCustomerByPhone` ou une réponse sans masque.
- Une opération sans `x-process: public` ou avec un autre schéma de sécurité ; un code d'erreur inventé.
- Une tolérance du test de gel qui laisse passer un ajout non prévu ; une empreinte écrite à la main.
- Des types générés différents de ce que produit `generate` (relance et compare).
- Un ajout de `x-roles` dans ce lot (hors périmètre).

## Implementation command

`LC_ALL=C LANG=C spec-kitty agent action implement WP03 --agent claude --mission routes-backoffice-01M86KT6`
