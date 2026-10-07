---
work_package_id: WP11
title: Idempotence applicative et preuves transverses
dependencies:
- WP04
- WP10
requirement_refs:
- FR-006
- FR-008
- FR-009
planning_base_branch: feat/fondations-grand-livre
merge_target_branch: feat/fondations-grand-livre
branch_strategy: Planning artifacts for this mission were generated on feat/fondations-grand-livre. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/fondations-grand-livre unless the human explicitly redirects the landing branch.
subtasks:
- T054
- T055
- T056
- T057
- T058
- T059
phase: Phase 4 - API
history:
- timestamp: '2026-10-07T12:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: node-norris
authoritative_surface: apps/api/src/idempotency/
create_intent:
- apps/api/src/idempotency/idempotency.module.ts
- apps/api/src/idempotency/idempotency.repository.ts
- apps/api/src/idempotency/request-hash.ts
- apps/api/src/idempotency/idempotency.interceptor.ts
- apps/api/src/idempotency/idempotent.decorator.ts
- apps/api/test/integration/transverse/test-route.module.ts
- apps/api/test/integration/transverse/idempotency.spec.ts
- apps/api/test/integration/transverse/isolation.spec.ts
- apps/api/test/integration/transverse/errors.spec.ts
execution_mode: code_change
owned_files:
- apps/api/src/idempotency/**
- apps/api/test/integration/transverse/**
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP11 – Idempotence applicative et preuves transverses

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load node-norris`. Lis `contracts/idempotency.md`, `data-model.md`
(`api_idempotency`), `research.md` §R-05, SPECIFICATION §10.2.

## Objective

Implémenter le protocole d'idempotence S21 et prouver en intégration toutes les garanties transverses : idempotence,
isolation entre prestataires, durées du rôle, aucune fuite de texte SQL.

## Context

- Exigences : FR-009, FR-006/FR-007 (preuves), FR-008 (preuves), NFR-004, NFR-005, NFR-008, C-009.
- La route de test vit **uniquement** sous `test/` (jamais importée par `AppModule`).

## Branch Strategy

Planification et merge sur `feat/fondations-grand-livre`. Commande : `spec-kitty agent action implement WP11 --agent claude`.

## Subtasks

### T054 — Dépôt (`idempotency.repository.ts`)

- `reserve(operatorId, scope, key, hash, leaseSeconds, ttlHours)` dans **sa propre** `TenantTx.run` :
  `INSERT … ON CONFLICT (operator_id, scope, idempotency_key) DO NOTHING RETURNING id` ; si rien inséré :
  `SELECT … FOR UPDATE` puis décision : `COMPLETED` + même hash → `{ kind: 'replay', response }` ; hash différent →
  `IDEMPOTENCY_KEY_REUSED` ; `IN_PROGRESS` non expirée → `IDEMPOTENCY_KEY_IN_PROGRESS` ; `IN_PROGRESS` expirée ou
  `expires_at` dépassé → reprise (`UPDATE … SET lease_until = now()+…, status='IN_PROGRESS'` — une ligne expirée
  `COMPLETED` est traitée comme neuve : la garde interdit `COMPLETED → IN_PROGRESS`, donc insérer une **nouvelle**
  portée n'est pas possible ; solution : `UPDATE` vers un nouvel enregistrement logique en remettant `created_at`,
  `expires_at`, `request_hash`… interdit par la garde → décider : une clé expirée et `COMPLETED` renvoie
  `IDEMPOTENCY_KEY_REUSED` si le hash diffère, sinon la réponse enregistrée. Documenter ce choix (pas de réutilisation
  d'une clé après expiration : la purge future supprimera la ligne).
- `complete(client, id, status, body, headers)` : appelé **avec le client de la transaction métier**.
- `release(id)` : bail remis à `now()` (erreur 5xx).

### T055 — Empreinte (`request-hash.ts`)

- `sha256hex(method + '\n' + routeTemplate + '\n' + canonicalize(body ?? null))` ; `routeTemplate` = chemin
  déclaré (ex. `/v1/__test/notes`), pas l'URL concrète ; corps vide → `null`.

### T056 — Intercepteur et `@Idempotent({ scope })`

- Décorateur marquant une route d'écriture ; l'intercepteur (global dans `IdempotencyModule`) ne s'applique qu'aux
  routes marquées. Sans en-tête → `400 IDEMPOTENCY_KEY_REQUIRED`.
- Portée : `scope` du décorateur (`app:`, `bo:`, `pos:<client_id>:`, `device:<serial>`).
- Mise à disposition du client de la transaction métier au contrôleur : le contrôleur reçoit un `IdempotentTx`
  (`run(fn)`) qui ouvre la `TenantTx` et appelle `complete` dans la même transaction avant `COMMIT`.
- Rejeu : renvoie statut, corps, en-têtes enregistrés + `Idempotency-Replayed: true`.
- Erreur 4xx métier : enregistrée (dans une transaction propre, la transaction métier ayant échoué) puis renvoyée ;
  5xx : `release`.
- Brancher `IdempotencyModule` dans `AppModule` (modification hors carte de `apps/api/src/app.module.ts`, une
  ligne d'import — justifiée : le module doit être global).

### T057 — Module de route de test (`test/integration/transverse/test-route.module.ts`)

- `POST /v1/__test/notes` (`@Idempotent({ scope: 'app:' })`) : insère une ligne dans une table métier existante
  sous RLS sans effet comptable — utiliser `config_version` ou une table du schéma acceptant l'insertion par
  `cashless_app` ; à défaut, appeler `post_transaction` sur une fixture minimale (deux comptes d'argent) — choisir
  la plus simple et le noter en commentaire.
- `POST /v1/__test/fail?sqlstate=CL007` : exécute `SELECT … RAISE … USING ERRCODE` via une fonction temporaire
  créée par le test (rôle propriétaire) pour provoquer chaque SQLSTATE de la table.
- `GET /v1/__test/notes/:id` : lecture cloisonnée.

### T058 — Tests d'idempotence (`idempotency.spec.ts`)

Scénarios d'acceptation US4 n° 1 à 4 : sans clé → 400 ; rejeu identique → même statut et corps,
`Idempotency-Replayed: true`, **une seule** ligne en base ; autre corps même clé → 409 `IDEMPOTENCY_KEY_REUSED` ;
deux requêtes simultanées (la première bloquée par un verrou consultatif pris par le test) → la seconde reçoit 409
`IDEMPOTENCY_KEY_IN_PROGRESS` ; bail expiré → reprise ; 5xx → clé réutilisable ; même clé chez un autre prestataire
→ indépendante.

### T059 — Isolation, durées, erreurs (`isolation.spec.ts`, `errors.spec.ts`)

- Isolation (US4 n° 8, NFR-005) : objet de B lu par A → `404 NOT_FOUND` identique à un objet inexistant (corps
  comparés hors `instance`) ; requête sans `set_config` (client propriétaire en `SET ROLE cashless_app`) → 0 ligne ;
  même connexion physique réutilisée A puis B (pool de taille 1) → aucune fuite.
- Durées (NFR-008) : sur une connexion du pool, `SHOW transaction_timeout` = `1min`, `statement_timeout` = `30s`,
  `idle_in_transaction_session_timeout` = `10s`.
- Erreurs (NFR-004) : pour chaque SQLSTATE de la table, réponse avec le bon code et statut, corps sans aucun
  fragment du message SQL (le test lève un message sentinelle `SENTINELLE_SQL_42` et vérifie son absence) ;
  `23514` de double validation → `FORBIDDEN` (insérer une écriture `BACKOFFICE` sans valideur via
  `post_transaction`).

## Definition of Done

- Suite `test/integration/transverse` verte ; aucun import de `test/` depuis `src/`.

## Risks / Reviewer guidance

- La concurrence doit être réellement testée (deux requêtes en vol), pas simulée par un mock.
- Vérifier que `complete` est dans la même transaction que l'écriture métier (lire le code, pas seulement les tests).
