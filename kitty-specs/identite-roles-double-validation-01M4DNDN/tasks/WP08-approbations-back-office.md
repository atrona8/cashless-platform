---
work_package_id: WP08
title: Demandes d'approbation au back-office
dependencies:
- WP06
- WP07
requirement_refs:
- FR-009
- FR-010
- FR-011
- FR-012
- FR-013
planning_base_branch: feat/identite-roles
merge_target_branch: feat/identite-roles
branch_strategy: Planning artifacts for this mission were generated on feat/identite-roles. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/identite-roles unless the human explicitly redirects the landing branch.
subtasks:
- T034
- T035
- T036
- T037
- T038
- T039
phase: Phase 3 - Double validation
history:
- timestamp: '2026-10-08T13:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: node-norris
authoritative_surface: apps/api/src/approval/
create_intent:
- apps/api/src/approval/approval.module.ts
- apps/api/src/approval/action-registry.ts
- apps/api/src/approval/approval.service.ts
- apps/api/src/approval/approval.controller.ts
- apps/api/src/approval/approval-request.mapper.ts
- apps/api/test/support/demo-approval-action.ts
- apps/api/test/integration/approval/back-office.spec.ts
- apps/api/test/unit/approval/action-registry.spec.ts
execution_mode: code_change
owned_files:
- apps/api/src/approval/*.ts
- apps/api/test/support/demo-approval-action.ts
- apps/api/test/integration/approval/back-office.spec.ts
- apps/api/test/unit/approval/action-registry.spec.ts
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP08 – Demandes d'approbation au back-office

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load node-norris`. Lis `contracts/approvals.md`, `research.md` R-08, SPECIFICATION
§3.2 (Transport de la seconde validation, table des actions), `openapi.yaml` (`/approval-requests…`,
`ApprovalRequest`, `ApprovalAction`, `ApprovalRequestStatus`, `ApprovalDecision`, `ApprovalRejection`), le schéma
(`approval_request`, `approval_request_guard`, `decide_approval_request`), et le code de WP04-WP07.

## Objective

Le mécanisme générique de double validation au back-office : registre d'actions, création d'une demande (`202`),
approbation avec exécution unique dans la même transaction, refus avec note, et les 4 routes `/approval-requests`.

## Context

- Exigences : FR-009 à FR-013, C-001, C-002, SC-002, SC-005.
- Aucune action métier n'est branchée ici ; une action de démonstration (test) prouve le mécanisme.
- `AppModule` : ajouter `ApprovalModule` (une ligne, hors carte, justifiée).

## Branch Strategy

Planification et merge sur `feat/identite-roles`. Commande : `spec-kitty agent action implement WP08 --agent claude`.

## Subtasks

### T034 — Registre (`action-registry.ts`)

- `ApprovalActionDefinition<P>` : `action: ApprovalAction`, `requiredRole: StaffRole`, `scopeOf(payload, targetId):
  ScopeRef`, `validate(payload): P` (refus `422`), `execute(client, ctx: { request, payload, requestedBy,
  approvedBy }): Promise<{ result: unknown; executedTxId?: string }>`.
- `ApprovalActionRegistry` : `register(def)` (doublon → erreur au démarrage), `get(action)` ; jeton Nest
  `APPROVAL_ACTIONS` en multi-fournisseur, pour que chaque mission enregistre ses actions dans son module.

### T035 — Création (`ApprovalService.request`)

- Appelée par l'opération à deux d'une mission (dans son `IdempotentTx.run`) : action enregistrée sinon `422` ;
  auteur avec `requiredRole` sur `scopeOf` sinon `403` ; `INSERT approval_request` (`requested_by` = personne de la
  session, paramètres figés = `payload` validé) ; audit `APPROVAL_REQUESTED` ; rend la demande. Le contrôleur de
  l'opération répond `202` avec la demande (helper `respondAccepted(res, request)`).

### T036 — Approbation (`approve`)

Dans `IdempotentTx.run` (route `@Idempotent({ scope: 'bo:' })`) :
1. Lire la demande (RLS ; absente → `404`) ; définition de l'action ; valideur avec `requiredRole` sur la même
   portée, sinon `403`.
2. `decide_approval_request(id, valideur, true, note)` ; `CL023` → `409 APPROVAL_INVALID` (traduit par le filtre) ;
   retour NULL (expirée, passée `EXPIRED`) → `throw new CommittedProblem('APPROVAL_INVALID', 409)` (WP07) pour que
   `EXPIRED` soit validé.
3. `SAVEPOINT approval_exec` ; `execute(...)` ; succès → `UPDATE … SET status = 'EXECUTED', result = $1,
   executed_tx_id = $2` ; audit `APPROVAL_EXECUTED` (`actor` = valideur, `approver_id` = valideur, `before`/`after`).
   Échec `ProblemException` ou erreur SQL traduisible → `ROLLBACK TO SAVEPOINT approval_exec` ; `FAILED`,
   `failure_code` = code stable, `failure_reason` = détail sans texte SQL ; audit `APPROVAL_FAILED`. Erreur
   inattendue (5xx) : relancée (tout est annulé, clé relâchée).
4. Réponse `200` : la demande (mapper).

### T037 — Refus (`reject`)

- Note obligatoire et non vide (`400 VALIDATION_FAILED`) ; rôle exigé sur la portée (`403`) ;
  `decide_approval_request(id, valideur, false, note)` ; NULL → `CommittedProblem` `409` ; audit
  `APPROVAL_REJECTED` ; `200`.

### T038 — Routes et mapper

- `GET /approval-requests` (`status`, `action`, `cursor`, `limit`) : demandes du prestataire (RLS), restreintes aux
  actions dont la personne a le rôle exigé ; `PENDING` dont `expires_at` est passé → présentée `EXPIRED` (sans
  écriture) ; tri `requested_at DESC, id DESC` ; curseur opaque.
- `GET /approval-requests/{id}` (`404` si invisible ou action sans droit), `POST …/approve`, `POST …/reject`.
- Mapper vers `ApprovalRequest` du contrat (snake_case, `approval_request_id`, `result`, etc.). Corps : seuls
  `note` acceptés ; `approved_by`, `decided_by` ignorés (FR-013).

### T039 — Démonstration et tests

- `test/support/demo-approval-action.ts` : action `ADJUSTMENT` de démonstration (rôle `ORGANIZER_ADMIN`, portée =
  organisateur du payload) dont l'exécution écrit une ligne témoin et rend `{ done: true }` ; variante qui échoue
  (`ProblemException('VALIDATION_FAILED')`) après avoir écrit (pour prouver le `ROLLBACK TO SAVEPOINT`) ; route de
  test `POST /v1/__test/demo-adjustments` (`202`).
- `back-office.spec.ts` (faux serveur) : parcours complet (demande `202` → auteur approuve `409` → valideur sans
  rôle `403` → valideur d'un autre organisateur `403` → valideur correct `200 EXECUTED`, ligne témoin unique,
  `result`) ; échec d'exécution → `FAILED`, aucune ligne témoin, audit `APPROVAL_FAILED` ; refus sans note `400`,
  avec note `REJECTED` ; demande expirée (owner met `expires_at` au passé) → `409` et statut `EXPIRED` en base ;
  rejeu de l'approbation (même clé) → même réponse, aucune seconde exécution ; `approved_by` dans le corps ignoré ;
  liste filtrée et paginée ; isolation à deux prestataires ; lignes d'audit avec auteur et valideur.
- Unitaires : registre (doublon, action inconnue).

## Definition of Done

- Tests verts ; SC-002 démontré ; aucune demande `APPROVED` ne reste en base après un test.

## Risks / Reviewer guidance

- Vérifier en lisant le code que décision, exécution, statut final et audit sont dans **une** transaction.
- `failure_reason` ne doit jamais contenir de texte SQL.
