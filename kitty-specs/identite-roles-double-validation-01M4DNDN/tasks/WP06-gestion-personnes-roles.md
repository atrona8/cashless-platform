---
work_package_id: WP06
title: Gestion des personnes et des rôles
dependencies:
- WP03
- WP05
requirement_refs:
- FR-006
- FR-008
planning_base_branch: feat/identite-roles
merge_target_branch: feat/identite-roles
branch_strategy: Planning artifacts for this mission were generated on feat/identite-roles. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/identite-roles unless the human explicitly redirects the landing branch.
subtasks:
- T025
- T026
- T027
- T028
- T029
phase: Phase 2 - Identité dans l'API
history:
- timestamp: '2026-10-08T13:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: node-norris
authoritative_surface: apps/api/src/identity/users/
create_intent:
- apps/api/src/identity/users/users.module.ts
- apps/api/src/identity/users/users.controller.ts
- apps/api/src/identity/users/users.service.ts
- apps/api/src/identity/users/role-rules.ts
- apps/api/test/unit/identity/role-rules.spec.ts
- apps/api/test/integration/identity/users.spec.ts
- packages/ledger-sql/migrations/0006_platform_admin.sql
- packages/ledger-sql/tests/tests_platform_admin.sql
execution_mode: code_change
owned_files:
- apps/api/src/identity/users/**
- packages/contracts/openapi.yaml
- packages/contracts/generated/**
- apps/api/test/unit/identity/role-rules.spec.ts
- apps/api/test/integration/identity/users.spec.ts
- packages/ledger-sql/migrations/0006_platform_admin.sql
- packages/ledger-sql/tests/tests_platform_admin.sql
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP06 – Gestion des personnes et des rôles

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load node-norris`. Lis `contracts/openapi-additions.md`,
`contracts/identity.md` (Attribution des rôles), `research.md` R-05, R-06, `data-model.md`, les conventions de
`packages/contracts/openapi.yaml` (en-tête, `components/parameters`, `components/responses`, pagination par curseur,
`humanBearer`, exemples), `packages/contracts/scripts/generate.mjs` et `check.mjs`, et le code de WP04-WP05.

## Objective

Publier les 7 routes de gestion des personnes et des rôles (ajoutées au contrat), avec les règles « qui peut donner
quoi », sans auto-attribution, sans retirer le dernier `PLATFORM_ADMIN`, chaque action journalisée.

## Context

- Exigences : FR-006, FR-008, C-006, NFR-001.
- Routes d'écriture : `@Idempotent({ scope: 'bo:' })` + `@IdempotentTransaction()` (règle RISK-2, WP07) ; le
  travail et l'audit passent par `IdempotentTx.run`.
- `AppModule` : ajouter `UsersModule` (une ligne, hors carte, justifiée).

## Branch Strategy

Planification et merge sur `feat/identite-roles`. Commande : `spec-kitty agent action implement WP06 --agent claude`.

## Subtasks

### T025 — Contrat

- Ajouter à `openapi.yaml` les chemins, schémas et énumérations de `contracts/openapi-additions.md` (tag
  `Personnes`, `security: [humanBearer: []]`, paramètres et réponses communs existants, exemples réalistes).
- Compléter la description générale (section « Double validation ») par la formule de `act_hash`
  (`contracts/approvals.md`) et une phrase « Authentification des personnes » (prestataire et rôles tirés de la
  plateforme, jamais du jeton).
- `npm run generate` puis `npm run check -w @cashless/contracts` ; aucune route `x-release: V2` ; aucun code ajouté
  à `ProblemCode`.

### T026 — Service des personnes

- `create(operatorId, input, actor)` : `(issuer, subject)` déjà connu → `409 CONFLICT_STATE` ; insère `app_user`
  (`created_by` = acteur) ; audit `USER_CREATED`.
- `list(operatorId, cursor, limit)` : tri `(created_at, id)`, curseur opaque (base64 JSON), `next_cursor`, `has_more` ;
  `ORGANIZER_ADMIN` ne voit que les personnes qui ont au moins une attribution dans son organisateur ou ses
  événements (et celles qu'il a créées).
- `get` (avec attributions actives) ; `disable` : `DISABLED`, `disabled_at` ; audit `USER_DISABLED` ;
  désactiver le dernier `PLATFORM_ADMIN` → `403`.

### T027 — Règles d'attribution (`role-rules.ts`)

- `canGrant(granter: Principal, role, scope, chain)` selon le tableau du contrat ; auto-attribution → `403` ;
  rôle et portée incompatibles → `422 VALIDATION_FAILED` ; `VENDOR`, `CUSTOMER` → `422`.
- `grant` : insère `role_assignment` (`granted_by` = acteur) ; attribution active identique → `409
  CONFLICT_STATE` ; audit `ROLE_GRANTED` (`after` = attribution).
- `revoke` : même règle de droit que pour attribuer ce rôle ; déjà retirée → `409` ; dernier `PLATFORM_ADMIN` →
  la base lève `CL001` : le traduire `403 FORBIDDEN` (cas nommé, pas un `422` générique) ; audit `ROLE_REVOKED`
  (`before`/`after`).

### T028 — Contrôleurs

- `/operators/{operator_id}/users…` et `/operators/{operator_id}/role-assignments/{assignment_id}/revoke` : sous la
  transaction cloisonnée du prestataire du chemin (`IdentityTenantContext`, WP04).
- `POST /platform-admins` : une personne de plateforme a `operator_id` NULL, invisible et non insérable sous RLS.
  Elle est donc créée par une fonction `create_platform_admin(p_actor uuid, p_issuer text, p_subject text,
  p_display_name text, p_email text, p_phone text)` SECURITY DEFINER, ajoutée par la migration
  `0006_platform_admin.sql` : elle vérifie en base que `p_actor` a une attribution `PLATFORM_ADMIN` active
  (`CL001` sinon, traduit `403`), crée la personne, l'attribution (`granted_by` = `p_actor`) et la ligne d'audit
  `PLATFORM_ADMIN_CREATED`, dans la transaction de la requête. Tests pgTAP dans `tests/tests_platform_admin.sql`.
- Corps : `approved_by` et tout champ inconnu ignorés (validation stricte des champs attendus).
- Réponses `201`/`200` au format du contrat (snake_case), `Location` sur les créations.

### T029 — Tests d'intégration (`users.spec.ts`, faux serveur)

- Chaque route, chaque règle du tableau (positif et négatif), auto-attribution, dernier `PLATFORM_ADMIN` (retrait
  et désactivation), `409` doublons, `404` autre prestataire, isolation à deux prestataires sur chaque route ;
  une ligne d'audit exacte par action réussie, aucune pour une action refusée ; rejeu idempotent d'une création.
- Unitaires (`role-rules.spec.ts`) : table de vérité de `canGrant`.

## Definition of Done

- Contrat et types à jour (`check` vert), tests verts, lint et types verts.

## Risks / Reviewer guidance

- Escalade de droits : un `ORGANIZER_ADMIN` ne doit jamais pouvoir créer un `OPERATOR_ADMIN` ni agir hors de ses
  événements.
- `create_platform_admin` ne doit faire confiance qu'à l'attribution lue en base, jamais à un paramètre de rôle.
