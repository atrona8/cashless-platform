---
work_package_id: WP09
title: Jeton d'approbation sur place
dependencies:
- WP08
requirement_refs:
- FR-013
- FR-014
planning_base_branch: feat/identite-roles
merge_target_branch: feat/identite-roles
branch_strategy: Planning artifacts for this mission were generated on feat/identite-roles. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/identite-roles unless the human explicitly redirects the landing branch.
subtasks:
- T040
- T041
- T042
- T043
phase: Phase 3 - Double validation
history:
- timestamp: '2026-10-08T13:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: node-norris
authoritative_surface: apps/api/src/approval/onsite/
create_intent:
- apps/api/src/approval/onsite/act-hash.ts
- apps/api/src/approval/onsite/onsite-approval.guard.ts
- apps/api/src/approval/onsite/onsite-approval.module.ts
- apps/api/test/unit/approval/act-hash.spec.ts
- apps/api/test/integration/approval/onsite.spec.ts
execution_mode: code_change
owned_files:
- apps/api/src/approval/onsite/**
- apps/api/test/unit/approval/act-hash.spec.ts
- apps/api/test/integration/approval/onsite.spec.ts
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP09 – Jeton d'approbation sur place

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load node-norris`. Lis `contracts/approvals.md` (Jeton d'approbation sur place :
formule, tableau des refus), `research.md` R-09, SPECIFICATION §3.2 point 1, ADR-74, et le code de WP04
(`IdentityVerifier.verifyApproval`, `FakeIdp.approvalToken`), WP05 (`hasRole`, `AuditService`), WP07, WP08, et
`src/idempotency/request-hash.ts` (mission 1 : JCS, gabarit de route).

## Objective

Une garde réutilisable `@RequiresOnsiteApproval({ operationId, role })` qui exige et vérifie `X-Approval-Token`, le
consomme une seule fois dans la transaction métier et fournit le valideur au contrôleur.

## Context

- Exigences : FR-013, FR-014, NFR-003.
- Opérations futures concernées : `refundCashDue`, `releaseMedia` (missions bracelets et recharges). Ici, une route
  de démonstration de test.
- Le module `OnsiteApprovalModule` est importé par `ApprovalModule` (fichier de WP08, une ligne hors carte).

## Branch Strategy

Planification et merge sur `feat/identite-roles`. Commande : `spec-kitty agent action implement WP09 --agent claude`.

## Subtasks

### T040 — `act_hash` (`act-hash.ts`)

- `actHash(method, path, body)` : `sha256hex(METHOD.toUpperCase() + '\n' + path + '\n' + (canonicalize(body ??
  null) ?? 'null'))` ; `path` = `req.originalUrl` sans la chaîne de requête (préfixe `/v1` compris).
- Différence avec l'empreinte S21 : chemin **réel** (pas le gabarit). Tests unitaires : vecteurs fixes (méthode,
  chemin, corps → empreinte hex), ordre des clés indifférent, corps absent = `null`, la chaîne de requête n'entre pas.

### T041 — Vérification

- `verifyOnsiteApproval(req, principal, opts)` : en-tête absent → `403 APPROVAL_REQUIRED` ; `verifyApproval`
  (signature, `aud` d'approbation, `exp`, durée ≤ 300 s) ; `act === opts.operationId` ; `act_hash === actHash(req)` ;
  personne du `sub` par `identify_person` : connue, `ACTIVE`, même prestataire que l'appelant, `userId ≠
  principal.userId`, rôle `opts.role` sur la portée de l'opération (`hasRole`) ; tout défaut → `403
  APPROVAL_INVALID` (le message serveur journalise la raison exacte ; la réponse ne la détaille pas).

### T042 — Garde, consommation, audit

- `@RequiresOnsiteApproval({ operationId, role, scope? })` + garde : exécute T041 et pose
  `req.onsiteApproval = { approverId, jti, expiresAt }`.
- Consommation **dans la transaction métier** : helper `consumeOnsiteApproval(client, req)` à appeler dans
  `IdempotentTx.run` : `INSERT INTO approval_token_use … ON CONFLICT (jti) DO NOTHING RETURNING jti` ; 0 ligne →
  `ProblemException('APPROVAL_INVALID', 403)` ; audit `APPROVAL_TOKEN_USED` (acteur = appelant, valideur = sujet).
  Le contrôleur reçoit `approverId` pour la base (jamais du corps).

### T043 — Démonstration et tests

- Route de test `POST /v1/__test/onsite-refunds` (`@Idempotent`, `@RequiresOnsiteApproval({ operationId:
  'refundCashDue', role: 'SUPERVISOR' })`) qui écrit une ligne témoin avec `approved_by` = valideur.
- `onsite.spec.ts` (faux serveur) : sans jeton `403 APPROVAL_REQUIRED` ; jeton valide → `200`, valideur = sujet, une
  ligne `approval_token_use`, une ligne d'audit ; rejeu du même jeton sur une **autre** clé d'idempotence → `403
  APPROVAL_INVALID` ; jeton expiré, mal signé, autre audience, autre `act`, corps modifié (`act_hash`), émis pour
  l'appelant, sujet sans rôle, sujet d'un autre prestataire, sujet désactivé → `403 APPROVAL_INVALID`, aucune
  consommation ; deux requêtes simultanées avec le même jeton (deux clés d'idempotence) → exactement une réussit
  (NFR-003) ; `approved_by` dans le corps ignoré.

## Definition of Done

- Tests verts ; 100 % des conditions du tableau du contrat couvertes.

## Risks / Reviewer guidance

- Le jeton ne doit être consommé que si le travail est validé (consommation dans la transaction métier).
- La comparaison des empreintes peut être faite en temps constant (`timingSafeEqual`).
