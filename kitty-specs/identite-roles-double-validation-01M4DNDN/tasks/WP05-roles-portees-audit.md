---
work_package_id: WP05
title: Rôles, portées et service d'audit
dependencies:
- WP02
- WP04
requirement_refs:
- FR-005
- FR-008
planning_base_branch: feat/identite-roles
merge_target_branch: feat/identite-roles
branch_strategy: Planning artifacts for this mission were generated on feat/identite-roles. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/identite-roles unless the human explicitly redirects the landing branch.
subtasks:
- T020
- T021
- T022
- T023
- T024
phase: Phase 2 - Identité dans l'API
history:
- timestamp: '2026-10-08T13:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: node-norris
authoritative_surface: apps/api/src/audit/
create_intent:
- apps/api/src/identity/scope-resolver.ts
- apps/api/src/identity/roles.decorator.ts
- apps/api/src/identity/roles.guard.ts
- apps/api/src/audit/audit.module.ts
- apps/api/src/audit/audit.service.ts
- apps/api/test/unit/identity/scope.spec.ts
- apps/api/test/integration/identity/roles-audit.spec.ts
execution_mode: code_change
owned_files:
- apps/api/src/identity/scope-resolver.ts
- apps/api/src/identity/roles.decorator.ts
- apps/api/src/identity/roles.guard.ts
- apps/api/src/audit/**
- apps/api/test/unit/identity/scope.spec.ts
- apps/api/test/integration/identity/roles-audit.spec.ts
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP05 – Rôles, portées et service d'audit

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load node-norris`. Lis `contracts/identity.md` (Rôles et portées),
`research.md` R-05, `data-model.md` (`audit_log`, Principal), `contracts/audit-chain.md`, et le code de WP04
(`Principal`, garde, `IdentityTenantContext`) et de la mission 1 (`TenantTx`, `TxClient`, `X-Request-Id`
middleware, `requestIdOf`).

## Objective

Contrôler déclarativement le rôle et la portée de chaque route, et écrire les lignes d'audit dans la transaction de
l'action, avec acteur, rôle exercé, origine et identifiant de requête.

## Context

- Exigences : FR-005, FR-008, NFR-004.
- Portées et englobement : `contracts/identity.md`. L'objet visé est désigné par la route (paramètre de chemin) ou
  par l'action (registre d'approbation, WP08).
- `AppModule` (fichier de WP04) : ajouter `AuditModule` (une ligne d'import, hors carte, justifiée).

## Branch Strategy

Planification et merge sur `feat/identite-roles`. Commande : `spec-kitty agent action implement WP05 --agent claude`.

## Subtasks

### T020 — `ScopeResolver`

- `ScopeRef = { type: 'PLATFORM' } | { type: 'OPERATOR'|'ORGANIZER'|'EVENT'|'MERCHANT', id: string }`.
- `resolveChain(client, ref): Promise<ScopeRef[]>` : la portée et toutes ses englobantes (événement → organisateur
  → prestataire → plateforme ; commerçant → prestataire → plateforme, plus les événements où il a une
  participation : `merchant_participation`). Lectures sous RLS (client de la transaction) : un objet d'un autre
  prestataire est introuvable → `NOT_FOUND`.
- `hasRole(principal, roles, chain)` : vrai si une attribution active a un des rôles sur une portée de la chaîne
  (pour `MERCHANT`, l'attribution `MERCHANT_ADMIN` doit viser ce commerçant ; un `ORGANIZER_ADMIN` sur un
  événement où le commerçant participe englobe ce commerçant pour la lecture seulement si la route le déclare).

### T021 — `@Roles` et `RolesGuard`

- `@Roles(roles: StaffRole[], scope?: (req) => ScopeRef)` ; défaut : portée = prestataire de la transaction.
- `RolesGuard` (après la garde d'authentification) : refuse `403 FORBIDDEN` si aucun rôle ; la résolution de
  portée qui touche la base passe par une transaction courte cloisonnée (`TenantTx.run(operatorId, …)`).
- Pose `req.exercisedRole` (le rôle qui a permis l'accès, le plus spécifique) pour l'audit.

### T022 — `AuditService` et `AuditModule`

- `AuditService.record(client: TxClient, entry: AuditEntry)` : `INSERT INTO audit_log (operator_id, actor_id,
  actor_role, action, object_type, object_id, before, after, approver_id, origin, request_id)` ; les colonnes de
  chaînage sont posées par la base. `before`/`after` sérialisés en JSON (bigint en texte).
- `AuditAction` : union fermée (`USER_CREATED`, `USER_DISABLED`, `ROLE_GRANTED`, `ROLE_REVOKED`,
  `PLATFORM_ADMIN_CREATED`, `APPROVAL_REQUESTED`, `APPROVAL_EXECUTED`, `APPROVAL_FAILED`, `APPROVAL_REJECTED`,
  `APPROVAL_TOKEN_USED`) ; les missions suivantes l'étendent.
- Toujours avec le client de la transaction de l'action (jamais une transaction séparée) : si l'action est annulée,
  la ligne d'audit l'est aussi.

### T023 — Origine et identifiant de requête

- `auditContext(req)` : `actorId` = principal, `actorRole` = `req.exercisedRole`, `origin` = terminal
  (`req.principal.deviceId`, pour plus tard) sinon IP du client (`req.ip`, en tenant compte de `trust proxy` si
  configuré ; documenter), `requestId` = `X-Request-Id`.

### T024 — Tests

- Unitaires (`scope.spec.ts`) : chaînes de portées ; `hasRole` pour chaque ligne du tableau d'englobement ; rôle
  retiré ignoré.
- Intégration (`roles-audit.spec.ts`, faux serveur) : route de test `@Roles(['ORGANIZER_ADMIN'], scope =
  organisateur du chemin)` → `200` pour l'administrateur de cet organisateur, `403` pour celui d'un autre
  organisateur du même prestataire, `404` pour un autre prestataire ; `OPERATOR_ADMIN` du prestataire → `200`
  (englobement) ; route de test qui écrit + audite → une ligne d'audit avec acteur, rôle exercé, `X-Request-Id`,
  `seq` chaîné ; action en échec → aucune ligne d'audit.

## Definition of Done

- Tests verts, lint et types verts ; aucune ligne d'audit écrite hors de la transaction de l'action.

## Risks / Reviewer guidance

- Englobement trop large = escalade de droits : chaque ligne du tableau a un test positif et un négatif.
