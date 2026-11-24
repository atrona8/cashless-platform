---
work_package_id: WP04
title: 'Contrat : rôles autorisés x-roles sur chaque opération'
dependencies: [WP03]
requirement_refs:
- FR-003
- FR-004
- C-001
- SC-002
planning_base_branch: feat/routes-backoffice
merge_target_branch: feat/routes-backoffice
branch_strategy: >-
  Planning artifacts for this mission were generated on feat/routes-backoffice. During
  /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must
  merge back into feat/routes-backoffice unless the human explicitly redirects the landing branch.
base_branch: kitty/mission-routes-backoffice-01M86KT6
base_commit: 83cef3907ab67b4157bc1163dbb7f6450d274a73
created_at: '2026-11-24T16:22:15.242440+00:00'
subtasks: [T014, T015, T016]
phase: Phase 1 - Fondations
agent: claude
history:
- timestamp: '2026-11-24T13:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: tools/contract-stability/x-roles/
create_intent:
- tools/contract-stability/x-roles/roles.json
- tools/contract-stability/x-roles/apply.mjs
- tools/contract-stability/x-roles/x-roles.test.mjs
execution_mode: code_change
model: sonnet
owned_files:
- tools/contract-stability/x-roles/**
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP04 : Contrat : rôles autorisés x-roles sur chaque opération

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role : implementer / Agent :
claude). Lis ensuite la fiche commune `docs/passation-11b/fiche-implementation.md` (démarrage, règles, base de données,
fin d'implémentation : ne pas la recopier ici), ce prompt, puis seulement :

- `kitty-specs/routes-backoffice-01M86KT6/interfaces.md` §3 (liste fermée des 12 valeurs, tableau des 11 opérations de la
  mission et leurs rôles) et §6 ; `contracts/backoffice-routes.md` A2 (forme (a) retenue) ; `research.md` D3 ;
- `apps/api/src/identity/roles.guard.ts`, `roles.decorator.ts`, `principal.ts` l. 6-16 (valeurs de `Role`),
  `scope-resolver.ts` (`exercisedRole`, `hasRole`) ;
- les 10 `@Roles` du code : `grep -rn "@Roles(" apps/api/src` (opérateurs, juridiction, config de plateforme) ; **les
  autres contrôles sont dans les services** : `grep -rn "hasRole\|exercisedRole\|assertRole\|requireRole" apps/api/src` ;
- le contrat : `packages/contracts/openapi.yaml` (état de WP03 : les 8 + 3 nouvelles opérations y sont) ; schémas de
  sécurité `humanBearer`, `deviceToken`/`deviceSignature`/`deviceMtls`, `edgeMtls`, `pspHmac`, `security: []`
  (public) ; `x-process` (public, tag-keys…) ;
- `tools/contract-stability/check.mjs` (comment une entrée de référence est formée) ; modèle de test de gel :
  `apps/api/test/unit/contracts/contract-additions-9b.spec.ts`.

## Objective

Chaque opération du contrat (le nombre exact est compté par le script : ~227 à 230, après WP03) porte `x-roles`, tableau de
valeurs de la liste fermée, fidèle au contrôle réel du code ; l'annotation est produite par un script depuis une table
relue à la main, avec la source (fichier:ligne) de chaque ligne ; une garde échoue si une opération perd `x-roles` ou porte
une valeur hors liste. **Le doute se note, il ne se devine pas.**

## Subtasks

### T014 — Table relue `x-roles/roles.json`

1. Génère d'abord un squelette (`operationId`, méthode, chemin, schéma de sécurité du contrat) par script : fichier de
   travail, **pas** une vérité. Ensuite, **relis chaque opération contre le code** (contrôleur, garde, service) et
   écris `{ "operationId": { "roles": [...], "source": "chemin:ligne", "note": "…" } }`.
2. Règles de relecture :
   - `@Roles([...], scope)` : les rôles de l'annotation, `source` = ligne de l'annotation ;
   - contrôle en service (`hasRole`, `exercisedRole`, lecture des attributions) : les rôles réellement acceptés, `source` =
     ligne du contrôle ; la portée n'entre pas dans `x-roles` (valeurs de rôle seulement) ;
   - `PLATFORM_ADMIN` accepté par héritage de portée (chaîne PLATFORM ⊃ OPERATOR…) : n'ajoute le rôle englobant **que si le
     code l'accepte explicitement ou par `exercisedRole` sur la chaîne** ; relis `scope-resolver.ts` avant, et applique la
     même règle partout (note-la en tête de fichier) ;
   - opérations **sans contrôle de rôle** : terminal (`deviceToken`/`deviceSignature`/`deviceMtls` → `DEVICE`), festivalier
     (jeton client → `CUSTOMER`), vendeur (PIN/session → `VENDOR`), passerelle (`edgeMtls`, `pspHmac` → `GATEWAY`), public
     (`security: []` → `PUBLIC`) ; `source` = ligne de la garde ou du décorateur qui l'établit ;
   - les 11 opérations de la mission : valeurs de `interfaces.md` §3, `source` = le contrôle prévu dans le lot concerné
     (`"source": "à confirmer par WP0x"` est **interdit** : écris `"note": "contrôle implémenté en WP0x, tableau
     interfaces.md §3"` et la matrice de WP10 le vérifie).
3. Opération dont le contrôle réel est ambigu ou absent du code : ne devine pas. `"roles": []` n'est pas admis. Mets
   `"doubt": true` avec la question, **n'annote pas** cette opération, et liste tous les doutes dans la note de lane et le
   compte rendu (le porteur tranche) ; la garde de T016 les liste en erreur nommée tant qu'ils existent, sauf liste
   `DOUBTS_ACCEPTED` explicite vide par défaut.
4. Un contrôle plus **large** que ce que la sécurité attend (route ouverte à trop de rôles) est un constat pour la note de
   lane, pas une correction de ce lot (règle 1 de la fiche).
5. Validation : un script `node tools/contract-stability/x-roles/apply.mjs --check` ne rapporte aucune opération du contrat
   absente de la table, ni entrée de la table sans opération.

### T015 — `x-roles/apply.mjs`

1. Lit `openapi.yaml` et `roles.json`, ajoute `x-roles: [...]` à chaque opération (ordre stable de la liste fermée, sans
   doublon), **idempotent** : deux exécutions de suite = aucun diff ; n'altère ni le reste du fichier, ni l'ordre, ni les
   commentaires (utilise une édition de texte ciblée ou un parseur qui préserve, vérifie par `git diff --stat` : seules des
   lignes `x-roles` apparaissent).
2. Produit les **entrées de référence** de `contract-baseline.json` (une par opération, forme (a), empreinte calculée comme
   `check.mjs`) et les écrit sans toucher aux autres entrées ; idempotent aussi.
3. Mode `--check` : code 1 si une opération n'a pas la valeur de la table.
4. Validation : `node tools/contract-stability/check.mjs` à 0 refus ; `npm run check -w @cashless/contracts` (types
   régénérés par `npm run generate`/`generate:dart` : les `x-` n'y changent rien ; vérifie et note) ; relance deux fois
   `apply.mjs` : second passage sans diff.
5. **Mutation** : modifier une valeur dans `openapi.yaml` à la main : `apply.mjs --check` échoue ; retirer une entrée de
   référence : `check.mjs` refuse.

### T016 — Garde de présence et de valeurs

1. Test node `tools/contract-stability/x-roles/x-roles.test.mjs` (lancé par `node --test tools/contract-stability/*.test.mjs`
   ou `x-roles/*.test.mjs` : vérifie que le glob de la CI l'attrape ; sinon ajoute-le au script qui le lance **si ce
   fichier est dans ta carte**, sinon signale-le) : échoue si une opération n'a pas `x-roles`, si le tableau est vide, si
   une valeur n'est pas dans les 12 valeurs fermées, si un doublon existe, ou si une `operationId` du contrat n'est pas dans
   `roles.json`.
2. Garde de forme : chacune des 11 opérations de la mission a **exactement** les rôles de `interfaces.md` §3.
3. **Mutations** à prouver (chacune fait échouer le test) : retirer `x-roles` d'une opération ; y mettre `ADMIN` ; vider le
   tableau ; changer les rôles de `upsertPhoneModel`.

## Retouches hors carte permises (après WP03, même lane)

Nommées, et seulement elles : `packages/contracts/openapi.yaml` (lignes `x-roles` uniquement),
`tools/contract-stability/contract-baseline.json` (entrées `x-roles` uniquement, et la ligne « Décision du porteur :
24/11/2026 ADR-235 » déjà posée par WP03), `packages/contracts/generated/**` et `dart/lib/**` si leur régénération change
(par `generate`, jamais à la main). Liste-les dans la note de lane avec `git diff --stat`. Le test de gel de WP03
(`contract-additions-9b.spec.ts`) doit **rester vert** : si `x-roles` y est vu comme une modification, signale-le (ne
l'élargis pas : fichier de WP03).

## Definition of Done

- [ ] `roles.json` : une ligne par opération du contrat, `source` précise partout, doutes listés au porteur.
- [ ] `apply.mjs` idempotent, `check.mjs` 0 refus, `node --test tools/contract-stability/*.test.mjs` vert, `npm run check
      -w @cashless/contracts` vert.
- [ ] Garde T016 vert et quatre mutations notées avec leur résultat.
- [ ] Retouches hors carte limitées aux lignes `x-roles`.

## Ce que le relecteur doit casser

- Tirer 15 opérations au hasard et comparer leurs rôles à leur contrôle réel (fichier:ligne donné : le contrôle existe-t-il
  et dit-il bien cela ?). Une `source` fausse ou vague est un constat bloquant.
- Une opération du terminal, du festivalier ou publique annotée d'un rôle du personnel (ou l'inverse).
- Un `PLATFORM_ADMIN` ajouté partout « par prudence », ou oublié là où le code l'accepte.
- `apply.mjs` lancé deux fois : un diff apparaît ; un diff sur autre chose que `x-roles` ; une empreinte écrite à la main.
- La garde qui passe alors qu'une opération perd `x-roles` ; un doute silencieusement tranché.

## Implementation command

`LC_ALL=C LANG=C spec-kitty agent action implement WP04 --agent claude --mission routes-backoffice-01M86KT6`
