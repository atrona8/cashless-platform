---
work_package_id: WP05
title: "Socle API : audit, profil du personnel, balayage d'isolement"
dependencies: [WP03]
requirement_refs:
- FR-001
- FR-002
- FR-018
- NFR-006
- SC-003
planning_base_branch: feat/routes-backoffice
merge_target_branch: feat/routes-backoffice
branch_strategy: >-
  Planning artifacts for this mission were generated on feat/routes-backoffice. During
  /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must
  merge back into feat/routes-backoffice unless the human explicitly redirects the landing branch.
base_branch: kitty/mission-routes-backoffice-01M86KT6
base_commit: 83cef3907ab67b4157bc1163dbb7f6450d274a73
created_at: '2026-11-24T16:22:15.242091+00:00'
subtasks: [T017, T018, T019, T020]
phase: Phase 1 - Fondations
agent: claude
history:
- timestamp: '2026-11-24T13:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: apps/api/src/staff-profile/
create_intent:
- apps/api/src/staff-profile/staff-profile.module.ts
- apps/api/src/staff-profile/staff-profile.controller.ts
- apps/api/src/staff-profile/staff-profile.service.ts
- apps/api/test/integration/backoffice/staff-profile.spec.ts
- apps/api/test/integration/end-to-end/backoffice-isolation.spec.ts
- apps/api/test/integration/end-to-end/backoffice-isolation-cases/registry.ts
- apps/api/test/integration/end-to-end/backoffice-isolation-cases/staff-profile.cases.ts
- apps/api/test/support/mission-11b-operations.ts
execution_mode: code_change
model: sonnet
owned_files:
- apps/api/src/audit/audit.service.ts
- apps/api/src/staff-profile/**
- apps/api/src/identity/identity.module.ts
- apps/api/test/integration/backoffice/staff-profile.spec.ts
- apps/api/test/integration/end-to-end/backoffice-isolation.spec.ts
- apps/api/test/integration/end-to-end/backoffice-isolation-cases/registry.ts
- apps/api/test/integration/end-to-end/backoffice-isolation-cases/staff-profile.cases.ts
- apps/api/test/support/mission-11b-operations.ts
- apps/api/test/integration/end-to-end/media-isolation.spec.ts
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP05 : Socle API : audit, profil du personnel, balayage d'isolement

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role : implementer / Agent :
claude). Lis ensuite la fiche commune `docs/passation-11b/fiche-implementation.md` (démarrage, règles, base de données,
fin d'implémentation : ne pas la recopier ici), ce prompt, puis seulement :

- `kitty-specs/routes-backoffice-01M86KT6/interfaces.md` §1 (carte), §3 (`getStaffProfile`), §4 (actions d'audit, forme
  de pagination) et **§5 en entier (règle du balayage, mise à jour par l'orchestrateur : fait foi)** ;
  `contracts/backoffice-routes.md` A1 ; `data-model.md` § Profil du personnel ;
- `apps/api/src/identity/principal.ts` (`Principal`, `Assignment`, `requestPrincipal`), `authentication.guard.ts` (jetons
  du personnel, du festivalier, du terminal : comment chacun est refusé sur une route du personnel),
  `identity.module.ts` (où inscrire le module), `users/users.module.ts` et `users.controller.ts` (forme d'un module du
  personnel) ; `app_user.display_name` (`0003_identity.sql` l. 13) ;
- `apps/api/src/audit/audit.service.ts` l. 8-40 (liste `AuditAction`) ;
- `apps/api/test/support/mission-9b-operations.ts` et `test/integration/invariants-cloture/isolation-9b.spec.ts`
  (modèle du balayage par liste figée) ; `test/integration/end-to-end/media-isolation.spec.ts` l. 55-80 (exclusion
  `MISSION_9B_OPERATIONS`) et l. 690-700 (décompte `toBe(48)` des routes publiques balayées : voir T020) ;
  `device-auth-cases/registry.ts` (registre qui lit un dossier) ;
- `apps/api/test/integration/identity/roles-audit.spec.ts` (comment on fabrique des personnes, attributions et jetons de test).

## Objective

Poser ce dont les lots de routes (WP06 à WP09) ont besoin avant de commencer, plus `GET /staff/me` : les cinq actions
d'audit, le module du profil, et le **balayage d'isolement de la mission** (`backoffice-isolation.spec.ts`, registre de
cas, liste `MISSION_11B_OPERATIONS`). **Le registre `registry.ts` n'est touché que par ce lot** : chaque lot de routes
dépose son seul fichier `<lot>.cases.ts`, sans rien éditer d'autre.

## Subtasks

### T017 — Actions d'audit de la mission

1. Ajoute à `AuditAction` (`audit.service.ts`), sous un commentaire « Mission routes-backoffice (11b) » : `'ANOMALY_CLASSIFIED'`,
   `'PHONE_MODEL_UPSERTED'`, `'PHONE_MODEL_DELETED'`, `'STAFF_CUSTOMER_SEARCH'`, `'STAFF_CUSTOMER_SEARCH_RATE_LIMITED'`
   (exactement, `interfaces.md` §4). Rien d'autre dans ce fichier.
2. Cherche si une liste des actions est dupliquée ailleurs (test, schéma, contrainte SQL sur `audit_log.action`) :
   `grep -rn "CONFIG_VERSION_CREATED" apps packages` ; si une copie est hors de ta carte, signale-la dans la note.
3. Validation : `npx tsc --noEmit -p apps/api/tsconfig.json`. Pas de mutation (type seul) ; la preuve est l'usage par WP07/08/09.

### T018 — `GET /staff/me`

1. Module `apps/api/src/staff-profile/` : `StaffProfileModule`, `StaffProfileController` (`@Get('staff/me')`, opération
   `getStaffProfile`), `StaffProfileService`. Inscris le module **dans `IdentityModule`** (`imports`), seul fichier existant
   modifié hors audit.
2. Réponse `StaffProfile` : `user_id`, `display_name`, `operator_id` (nul pour la plateforme), `assignments[]` de `{ role,
   scope_type, scope_id }` (`scope_id` nul pour `PLATFORM`), à partir de `requestPrincipal(req)` (attributions **relues en
   base à chaque requête** par la garde : n'en lis pas d'autre cache) ; `display_name` lu en base sous le prestataire de la
   personne (`TenantTx`), jamais d'autre donnée de `app_user` (ni courriel, ni téléphone : minimisation, NFR-006).
3. Ordre stable des attributions (rôle, type de portée, identifiant). Aucune pagination.
4. Refus : jeton festivalier, jeton terminal et absence de jeton ne doivent **jamais** atteindre le service (la garde
   d'authentification les refuse : 401 ou 403). Vérifie ce que fait la garde pour chacun avant d'écrire le test ; si un de
   ces jetons passait, c'est un défaut de sécurité à signaler au porteur avant tout correctif.
5. Aucun appel à l'audit (lecture sans effet), sauf si une route de lecture du personnel en écrit déjà : note ton choix.
6. **Mutation** : faire retourner l'attribution d'une autre personne (ou le courriel) : le test T019 doit échouer.

### T019 — Tests du profil (`staff-profile.spec.ts`)

Sur `cashless_wp05`, avec les fabriques de personnes de `roles-audit.spec.ts` :
- une personne à **deux attributions** (par ex. `OPERATOR_ADMIN` sur le prestataire et `SUPERVISOR` sur un événement) : les
  deux, dans l'ordre stable, `scope_type` et `scope_id` exacts ; un administrateur de plateforme : `operator_id` nul,
  `scope_id` nul ;
- une personne **sans aucun rôle actif** (attribution révoquée) : réponse `200` avec `assignments: []` **ou** refus : le
  comportement réel de la garde fait foi ; **écris ce que le code fait** et note-le (FR-002 : le dire à WP11 pour la note aux équipes) ;
- une attribution révoquée entre deux appels disparaît au second (relue en base) ;
- jeton festivalier → refus ; jeton terminal → refus ; sans jeton → 401 ;
- la réponse ne contient aucune clé hors `StaffProfile` (comparaison des clés) et valide le schéma du contrat
  (`test/support/contract-schema.ts`).
**Mutations** : lire le profil sans relecture en base (cache) ; renvoyer le courriel ; retirer la garde festivalier.

### T020 — Balayage d'isolement de la mission (règle de `interfaces.md` §5, à jour)

1. `test/support/mission-11b-operations.ts` : `export const MISSION_11B_OPERATIONS: readonly string[]` = les 11
   `operationId` de `interfaces.md` §3, liste figée, commentaire d'en-tête sur le modèle de `mission-9b-operations.ts`.
2. `backoffice-isolation-cases/registry.ts` : lit les fichiers `*.cases.ts` du dossier (modèle `device-auth-cases/registry.ts`),
   échoue sur une clé en double. `staff-profile.cases.ts` : le cas de `getStaffProfile`. **Les autres fichiers de cas
   sont déposés par les lots WP06 à WP09 : ce lot n'en crée aucun et ne les liste nulle part.**
3. `backoffice-isolation.spec.ts` — **règle** : pour chaque opération de `MISSION_11B_OPERATIONS` **servie par l'application**
   (route inscrite dans Nest : détecte-le en lisant la table des routes de l'application de test, pas en devinant), un cas
   du registre est **exigé** ; une opération **pas encore servie est sautée et nommée dans la sortie du test** (message
   explicite, par ex. `console.info` ou nom de test `skipped: <operationId> (route non servie)`). Aucune liste d'attente à
   éditer : l'état « servie » vient du code. Pour chaque cas : personne d'un autre prestataire → 403 ou 404, jamais 2xx,
   aucune donnée de A dans la réponse ; sans jeton → 401 ; jeton festivalier → refus ; jeton terminal → refus. Test
   de garde : `MISSION_11B_OPERATIONS` a 11 entrées, toutes déclarées dans le contrat ; toute clé du registre est dans la liste.
4. `media-isolation.spec.ts` : exclus `MISSION_11B_OPERATIONS` de sa sélection (comme `MISSION_9B_OPERATIONS`, l. 70) ; le
   décompte `toBe(48)` doit rester juste : relance et note-le (sans exclusion il monterait).
5. **Mutations à prouver** : (a) le profil **servi sans son cas** (retire `staff-profile.cases.ts` ou la clé `getStaffProfile`)
   fait échouer le balayage ; (b) une opération de la liste **non servie** est sautée, **nommée**, et n'échoue pas ; (c) un
   cas qui accepte un `200` pour un autre prestataire échoue ; (d) retirer l'exclusion de `media-isolation.spec.ts` le fait échouer.
   WP10 vérifiera plus tard que les 11 opérations sont servies et ont leur cas : n'implémente rien de plus ici.

## Retouches hors carte permises

Aucune. Si `architecture.spec.ts` ou une garde transverse s'oppose au module (dépendance interdite), signale-le au lieu de
la contourner.

## Definition of Done

- [ ] Cinq actions d'audit exactes ; `StaffProfileModule` dans `IdentityModule` seulement ; aucune dépendance nouvelle.
- [ ] `staff-profile.spec.ts` et `backoffice-isolation.spec.ts` verts, `media-isolation.spec.ts` vert avec son décompte.
- [ ] Les quatre mutations de T020 et celles de T018/T019 notées avec leur résultat ; sortie du balayage montrant les 10
      opérations non servies nommées.
- [ ] Gardes transverses (`architecture.spec.ts`, `production-guard.spec.ts`, `test/unit/contracts`, `device-auth-matrix.spec.ts`)
      relancées et vertes.
- [ ] Aucune donnée du festivalier ni courriel dans la réponse ; refus festivalier et terminal prouvés.

## Ce que le relecteur doit casser

- Servir `getStaffProfile` sans son cas : le balayage doit échouer ; supprimer un cas d'une opération servie : idem.
- Une opération servie que le balayage croit « non servie » (détection trop laxiste) : il doit la compter.
- Jeton festivalier ou terminal sur `/staff/me` ; jeton d'un prestataire supprimé ; attribution révoquée encore rendue.
- Un champ de plus dans `StaffProfile` (courriel, téléphone, `issuer`, `subject`) ; des attributions d'un autre utilisateur.
- `registry.ts` qui liste les fichiers de cas des autres lots en dur (ils le sauraient conflictuel) ; l'exclusion de
  `media-isolation` oubliée ou le décompte de 48 modifié sans raison.

## Implementation command

`LC_ALL=C LANG=C spec-kitty agent action implement WP05 --agent claude --mission routes-backoffice-01M86KT6`
