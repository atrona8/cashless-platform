---
work_package_id: WP04
title: Authentification et contexte de prestataire
dependencies:
- WP01
requirement_refs:
- FR-003
- FR-004
- FR-016
planning_base_branch: feat/identite-roles
merge_target_branch: feat/identite-roles
branch_strategy: Planning artifacts for this mission were generated on feat/identite-roles. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/identite-roles unless the human explicitly redirects the landing branch.
subtasks:
- T014
- T015
- T016
- T017
- T018
- T019
phase: Phase 2 - Identité dans l'API
history:
- timestamp: '2026-10-08T13:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: node-norris
authoritative_surface: apps/api/src/identity/
create_intent:
- apps/api/src/identity/identity.module.ts
- apps/api/src/identity/oidc-verifier.ts
- apps/api/src/identity/authentication.guard.ts
- apps/api/src/identity/principal.ts
- apps/api/src/identity/identity-tenant-context.ts
- apps/api/src/identity/public.decorator.ts
- apps/api/test/support/fake-idp.ts
- apps/api/test/unit/identity/oidc-verifier.spec.ts
- apps/api/test/integration/identity/authentication.spec.ts
execution_mode: code_change
owned_files:
- apps/api/src/identity/identity.module.ts
- apps/api/src/identity/oidc-verifier.ts
- apps/api/src/identity/authentication.guard.ts
- apps/api/src/identity/principal.ts
- apps/api/src/identity/identity-tenant-context.ts
- apps/api/src/identity/public.decorator.ts
- apps/api/src/config/config.ts
- apps/api/src/app.module.ts
- apps/api/src/health/health.controller.ts
- apps/api/src/tenancy/tenant-context.ts
- apps/api/package.json
- apps/api/jest.config.cjs
- package-lock.json
- apps/api/test/support/fake-idp.ts
- apps/api/test/support/app.ts
- apps/api/test/unit/identity/oidc-verifier.spec.ts
- apps/api/test/integration/identity/authentication.spec.ts
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP04 – Authentification et contexte de prestataire

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load node-norris`. Lis `contracts/identity.md`, `research.md` R-01, R-03, R-04,
R-06, R-11, `plan.md` (Supply-chain), et le code de la mission 1 : `apps/api/src/app.module.ts`,
`src/tenancy/tenant-context.ts` (`TENANT_CONTEXT`, `UnauthenticatedTenantContext`), `src/db/tenant-tx.ts`,
`src/errors/problem.ts`, `src/config/config.ts`, `test/support/app.ts` (`HeaderTenantContext`, `createTestApp`),
`jest.config.cjs` (exception `canonicalize`), `src/idempotency/idempotency.interceptor.ts` (résolution de
`TENANT_CONTEXT` par `ModuleRef`).

## Objective

Toute requête (sauf la santé) porte un jeton d'accès OIDC vérifié ; la personne est retrouvée par
`identify_person` ; prestataire et rôles viennent de la base ; le fournisseur de prestataire « refus systématique »
est remplacé. Les tests utilisent un faux serveur d'identité.

## Context

- Exigences : FR-003, FR-004, FR-016, NFR-002, NFR-005, C-004, C-005.
- `identify_person` doit être appelée **hors** prestataire : utiliser une transaction en lecture seule sans
  `set_config` (ajouter à `TenantTx` une méthode `identify(issuer, subject)` sur le modèle de `ping()`, exception
  documentée — `src/db/` est un fichier de la mission 1 : modification hors carte justifiée, ou bien exposer cette
  lecture depuis `identity/` via `TenantTx.ping`-like ; **décider et le noter dans le commit**).
- Les tests de la mission 1 utilisent l'en-tête `X-Test-Operator-Id` : ils doivent rester verts sans jeton.

## Branch Strategy

Planification et merge sur `feat/identite-roles`. Commande : `spec-kitty agent action implement WP04 --agent claude`.

## Subtasks

### T014 — Configuration et dépendance

- `apps/api/package.json` : `"jose": "6.2.12"` (exact) en dépendance ; `npm install` ; lockfile mis à jour.
- `jest.config.cjs` : `transformIgnorePatterns: ['/node_modules/(?!(canonicalize|jose)/)']`.
- `config.ts` : `oidc: { issuer, audience, approvalAudience, jwksUri, clockToleranceSeconds: 10 }` lus de
  `OIDC_ISSUER`, `OIDC_AUDIENCE`, `OIDC_APPROVAL_AUDIENCE`, `OIDC_JWKS_URI` ; en production, les quatre sont
  obligatoires et `jwksUri` doit être en `https:` (erreur claire au démarrage) ; valeurs de test par défaut
  hors production (émetteur `https://idp.test`).
- Vérifier le démarrage compilé (`npm run build -w @cashless/api && npm run start …`) : `jose` (ESM) chargé par
  `require(esm)` comme `canonicalize`.

### T015 — `IdentityVerifier` (`oidc-verifier.ts`)

- Port : `interface IdentityVerifier { verifyAccess(token: string): Promise<VerifiedToken>; verifyApproval(token:
  string): Promise<VerifiedApprovalToken> }` + jeton `IDENTITY_VERIFIER`. `VerifiedToken` : `issuer`, `subject`,
  `tokenId`, `operatorClaim?`, `expiresAt`. `VerifiedApprovalToken` : + `jti`, `act`, `actHash`.
- Implémentation `JoseIdentityVerifier(keySet)` : `jwtVerify(token, keySet, { issuer, audience, algorithms:
  ['RS256','ES256'], clockTolerance, requiredClaims: ['exp','sub'] })` ; approbation : audience
  `approvalAudience`, claims requis `jti`, `act`, `act_hash`, `iat`, et `exp - iat <= 300`.
- Erreurs : jeton invalide → `IdentityError('INVALID')` ; JWKS injoignable (`JWKSTimeout`, erreur réseau) →
  `IdentityError('UNAVAILABLE')`. Fabrique : `createRemoteJWKSet(new URL(jwksUri), { timeoutDuration: 2000,
  cooldownDuration: 30000 })`.

### T016 — Faux serveur d'identité (`test/support/fake-idp.ts`)

- `FakeIdp.create()` : `generateKeyPair('ES256')`, `exportJWK`, `createLocalJWKSet({ keys: [jwk] })`.
- `accessToken(subject, overrides?)`, `approvalToken({ subject, act, actHash, jti?, ttlSeconds? })`, variantes
  défectueuses (`expired`, `wrongIssuer`, `wrongAudience`, `otherKey`, `noExp`, `alg none`).
- `provider()` : fournisseur Nest `{ provide: IDENTITY_VERIFIER, useValue: new JoseIdentityVerifier(localSet, cfg) }`.
- `createPerson(db, { operatorId, roles })` : insère `app_user` + `role_assignment` en rôle propriétaire et rend
  `{ userId, subject, token }`.

### T017 — Garde d'authentification et `Principal`

- `principal.ts` : `Principal { userId, operatorId: string | null, assignments: Assignment[], issuer, subject }`,
  `requestPrincipal(req)`.
- `@Public()` (`public.decorator.ts`) ; `GET /v1/health` marqué public.
- `AuthenticationGuard` (global, `APP_GUARD` via `useExisting`) : route publique → laisse passer ; sinon
  `Authorization: Bearer` obligatoire ; `verifyAccess` ; `identify(issuer, subject)` ; personne absente ou
  `DISABLED` → `401 UNAUTHENTICATED` ; `operatorClaim` défini et ≠ `operator_id` → `401` ; `UNAVAILABLE` →
  `503 SERVICE_UNAVAILABLE` ; pose `req.principal`.
- Coût (NFR-005) : une requête SQL par requête HTTP ; clés en cache (`jose`).

### T018 — `TENANT_CONTEXT` de production

- `IdentityTenantContext.current(req)` : prestataire = `req.principal.operatorId` ; pour une route
  `/operators/:operator_id/…` (paramètre `operator_id` présent) : `PLATFORM_ADMIN` → ce paramètre ; sinon il doit
  égaler le prestataire de la personne, sinon `404 NOT_FOUND`. Personne de plateforme sur une route sans prestataire
  → `403 FORBIDDEN`.
- `AppModule` : importe `IdentityModule` (fournit `IDENTITY_VERIFIER` réel, garde, `TENANT_CONTEXT`) ; supprime
  `UnauthenticatedTenantContext` (ou le garde comme repli non enregistré).
- `test/support/app.ts` : `createTestApp({ identity: 'header' | FakeIdp })` ; mode `header` (défaut, mission 1) :
  remplace la garde par une garde qui laisse passer et garde `HeaderTenantContext` ; mode `FakeIdp` : vraie garde,
  vrai `IdentityTenantContext`, vérifieur du faux serveur.

### T019 — Tests

- Unitaires (`oidc-verifier.spec.ts`) : jeton valide ; chaque variante défectueuse refusée ; `alg: none` refusé ;
  durée d'un jeton d'approbation > 300 s refusée.
- Intégration (`authentication.spec.ts`, faux serveur, base locale) : sans jeton `401` ; chaque défaut `401`
  (NFR-002, 100 %) ; personne inconnue, désactivée → `401` ; claim `operator_id` différent → `401` ; JWKS
  injoignable (vérifieur qui lève `UNAVAILABLE`) → `503` ; santé sans jeton → `200` ; deux personnes de deux
  prestataires sur une route de test qui lit sous RLS → chacune ne voit que son prestataire ; `/operators/{autre}/…`
  par une personne non plateforme → `404`.
- Toute la suite de la mission 1 reste verte (mode `header`).

## Definition of Done

- `npm test -w @cashless/api`, `npm run lint`, `npm run typecheck` verts ; démarrage compilé vérifié.

## Risks / Reviewer guidance

- Aucun chemin n'accepte un jeton sans vérification (relire la garde : `@Public` seulement sur la santé).
- Les rôles annoncés par le jeton ne sont jamais lus.
