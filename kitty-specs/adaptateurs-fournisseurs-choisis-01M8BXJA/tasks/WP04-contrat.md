---
work_package_id: WP04
title: 'Contrat : `receivePspWebhook` en formulaire et décrit par fournisseur (D9)'
dependencies: []
requirement_refs:
- C-001
planning_base_branch: feat/adaptateurs-fournisseurs-choisis
merge_target_branch: feat/adaptateurs-fournisseurs-choisis
branch_strategy: >-
  Planning artifacts for this mission were generated on feat/adaptateurs-fournisseurs-choisis. During
  /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must
  merge back into feat/adaptateurs-fournisseurs-choisis unless the human explicitly redirects the landing branch.
subtasks: [T016, T017, T018]
phase: Phase 1 - Fondations
agent: claude
history:
- timestamp: '2026-11-26T15:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: packages/contracts/
create_intent:
- apps/api/test/unit/contracts/receive-psp-webhook-12b1.spec.ts
execution_mode: code_change
model: sonnet
owned_files:
- packages/contracts/openapi.yaml
- packages/contracts/generated/**
- packages/contracts/dart/lib/**
- tools/contract-stability/contract-baseline.json
- apps/api/test/unit/contracts/receive-psp-webhook-12b1.spec.ts
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP04 — Contrat : `receivePspWebhook` en formulaire et décrit par fournisseur (D9)

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role : implementer / Agent :
claude). Lis ensuite la fiche commune `docs/passation-12b-1/fiche-implementation.md` (démarrage, règles, base de
données, fin d'implémentation : ne pas la recopier ici), ce prompt, puis seulement (`<M>` =
`kitty-specs/adaptateurs-fournisseurs-choisis-01M8BXJA`) :

- `<M>/contracts/openapi-receivePspWebhook.md` (fait foi) ; `packages/contracts/openapi.yaml` l. 3920-4010 ;
- `tools/contract-stability/check.mjs` et son mode d'emploi (en-tête), `contract-baseline.json` (forme des entrées admises) ;
- un test de gel récent pour modèle : `apps/api/test/unit/contracts/contract-additions-9b.spec.ts` ;
- la génération des types (`packages/contracts/package.json`, scripts).

## Objective

Ajout rétrocompatible au contrat partagé, accepté par le porteur (D9) : rien n'est retiré, aucune autre
opération ne change.

Dépendances : aucune. Implémentation :
`LC_ALL=C LANG=C spec-kitty agent action implement WP04 --agent claude --mission adaptateurs-fournisseurs-choisis-01M8BXJA`.

## Branch Strategy

Planification et fusion sur `feat/adaptateurs-fournisseurs-choisis`. Le worktree d'exécution est celui de la lane calculée dans
`<M>/lanes.json` ; si ta lane dépend d'autres lanes, `bash docs/passation-12b-1/scripts/merge-deps.sh <lettre>`
d'abord.

## Subtasks

### T016 — Contenu en formulaire

Ajoute sous `requestBody.content` de `receivePspWebhook` : `application/x-www-form-urlencoded` avec un schéma objet libre
(`type: object`, `additionalProperties: true`) et une description « utilisé par `paydunya` seulement ». Le contenu
`application/json` existant reste identique.

### T017 — Description par fournisseur

Remplace, au point 1 de la description, la phrase sur les en-têtes par la liste de `contracts/openapi-receivePspWebhook.md`
§2 (Wave, Stripe, PayDunya, Orange Money inchangé). Ne touche à aucun autre point de la description. Le schéma de sécurité
`pspHmac` reste (ajoute seulement dans sa description que PayDunya prouve son origine par `data[hash]`).

### T018 — Stabilité, types, gel

1. `node tools/contract-stability/check.mjs` : les seules différences sont celles de cette opération ; inscris-les dans
   `contract-baseline.json` comme différences admises (même forme que les entrées de la 11b), puis 0 refus.
2. Régénère les types TypeScript et Dart (scripts du paquet) ; diff limité à cette opération.
3. `receive-psp-webhook-12b1.spec.ts` : charge `openapi.yaml` ; vérifie les deux contenus, et qu'en dehors de
   `paths./webhooks/{provider}/{psp_config_id}.post.requestBody` et de la description, l'opération est identique à
   celle de `main` (empreinte figée dans le test). Mutation : retirer le contenu JSON → le test échoue.
4. `node tools/contract-stability/x-roles.test.mjs` reste vert (`x-roles` de l'opération inchangé).

## Definition of Done

- Toutes les sous-tâches faites ; fichiers limités aux `owned_files` (+ retouches de compilation nommées) ;
- tests du lot verts sur la base du lot (ou sans base pour les tests unitaires), **aucun appel réseau externe** ;
- chaque contrôle ajouté a sa mutation notée (retiré → test rouge → remis) ;
- `eslint`, `prettier --check`, `tsc --noEmit` propres sur les fichiers du lot ;
- note de lane : retouches hors carte, écarts (renforce/affaiblit), points « à confirmer à l'essai », fichiers à
  faire relire par une personne.

## Ce que le relecteur doit casser

Une autre opération modifiée ; le contenu JSON altéré ; une entrée de base trop large (qui admettrait d'autres
changements) ; types générés non régénérés ; `x-roles` perdu.

## Retouches hors carte permises

Seulement les retouches de compilation imposées par un changement de signature d'un lot antérieur (`interfaces.md`
§1), nommées dans la note de lane. Tout autre besoin : signale-le, ne le code pas.
