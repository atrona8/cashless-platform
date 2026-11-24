---
work_package_id: WP07
title: Anomalies
dependencies: [WP01, WP02, WP03, WP05]
requirement_refs:
- FR-008
- FR-009
- FR-010
- FR-017
- FR-018
- NFR-001
- NFR-003
- NFR-005
- NFR-006
- C-002
- C-005
- SC-004
planning_base_branch: feat/routes-backoffice
merge_target_branch: feat/routes-backoffice
branch_strategy: >-
  Planning artifacts for this mission were generated on feat/routes-backoffice. During
  /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must
  merge back into feat/routes-backoffice unless the human explicitly redirects the landing branch.
subtasks: [T025, T026, T027, T028]
phase: Phase 2 - Routes
agent: claude
history:
- timestamp: '2026-11-24T13:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: apps/api/src/anomalies/
create_intent:
- apps/api/src/anomalies/anomalies.controller.ts
- apps/api/src/anomalies/anomalies.service.ts
- apps/api/src/anomalies/anomalies.dto.ts
- apps/api/src/anomalies/anomalies.module.ts
- apps/api/test/integration/backoffice/anomalies.spec.ts
- apps/api/test/integration/backoffice/anomalies-classification.spec.ts
- apps/api/test/integration/backoffice/anomalies-concurrency.spec.ts
- apps/api/test/integration/end-to-end/backoffice-isolation-cases/anomalies.cases.ts
execution_mode: code_change
model: sonnet
owned_files:
- apps/api/src/anomalies/**
- apps/api/src/app.module.ts
- apps/api/test/integration/backoffice/anomalies*.spec.ts
- apps/api/test/integration/end-to-end/backoffice-isolation-cases/anomalies.cases.ts
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP07 : Anomalies

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role : implementer / Agent :
claude). Lis ensuite la fiche commune `docs/passation-11b/fiche-implementation.md`, ce prompt, puis seulement :

- `interfaces.md` §1, §2 (WP01 : `classify_anomaly`, codes `CL066` à `CL069`, D4 ; WP02 : `anomaly_overview`), §3
  (`listAnomalies`, `classifyAnomaly`, `reason`), §4 (audit, pagination), §5 ; `contracts/backoffice-routes.md` A4 ;
  `research.md` D1, D4, D10 ; migrations `0101` et `0102` **telles que fusionnées** ; note de lane de WP01 (preuve
  d'usage du droit `UPDATE anomaly`, choix retrait ou déclencheur) ;
- un contrôleur d'écriture à `Idempotency-Key` du personnel : chercher `@Idempotent(` dans `apps/api/src` (par exemple
  `organization/platform/operators.controller.ts`) et `apps/api/src/idempotency/` ;
- comment l'API traduit une erreur `CLnnn` de la base en problème HTTP : chercher `CL025` ou `pgCode` dans
  `apps/api/src/errors/` et `devices/enrollment/enrollment.service.ts` ;
- `apps/api/src/audit/audit.service.ts` (`AuditService.record`, action `ANOMALY_CLASSIFIED` ajoutée par WP05) ;
- `identity/users/users.dto.ts` (curseur), `identity/scope-resolver.ts`, `apps/api/src/app.module.ts` ;
- `apps/api/test/integration/end-to-end/backoffice-isolation-cases/staff-profile.cases.ts` ; pour la concurrence,
  `test/integration/end-to-end/payment-concurrency.spec.ts`.

## Objective

`GET /anomalies` et `POST /anomalies/{anomaly_id}/classification` : lister les anomalies de la portée et classer
« traitée » celles des 10 types de D1, avec motif, sans aucune écriture au grand livre (C-002).

## Subtasks

### T025 — `listAnomalies` : filtres, portée, `classifiable`

1. `AnomaliesModule` (contrôleur, service, dto), **inscrit dans `AppModule`** (`app.module.ts` : seul lot de la mission à
   le toucher ; une ligne d'import et une dans `imports`). Rôles : `OPERATOR_ADMIN`, `ORGANIZER_ADMIN`.
2. Lecture dans `anomaly_overview` (WP02), sous la RLS du prestataire. Portée dans le `WHERE` : un `ORGANIZER_ADMIN`
   ne voit que les anomalies dont `event_id` appartient à son organisateur ; un `OPERATOR_ADMIN` celles de son
   prestataire. Filtres `event_id` (hors portée : liste vide, pas d'erreur révélatrice), `kind` (liste fermée des 23 types
   de la base, sinon `422`), `status`, `from`, `to`. Pagination §4 sur `(created_at, anomaly_id)`.
3. Réponse `Anomaly` : `classifiable` vient de la colonne de la vue (`anomaly_classifiable`), **jamais d'une liste
   recopiée en TypeScript** ; `classification` (`reason`, `classified_by`, `classified_at`) si classée. Le motif est du
   texte libre saisi par le personnel : il n'est pas une donnée de festivalier mais ne sert qu'à l'affichage.
4. Mutation : `WHERE` de portée retiré (un organisateur voit l'autre : le test d'isolement échoue).

### T026 — `classifyAnomaly` : fonction de la base, codes, audit, idempotence

1. Corps `{ reason }` (1 à 500 caractères après `btrim`), `Idempotency-Key` obligatoire (absente : refus existant du
   mécanisme), `200 Anomaly` (ligne relue après classement).
2. Un seul appel : `SELECT * FROM classify_anomaly($1, $2, $3)` avec l'identifiant de la personne ; l'API **ne décide
   ni du type ni du statut** : c'est la base (D1, D4). Correspondance : `CL066` → `404 NOT_FOUND` ; `CL067` → `422
   VALIDATION_FAILED` avec `reason = ANOMALY_KIND_NOT_CLASSIFIABLE` ; `CL068` → `409 CONFLICT_STATE` ; `CL069` → `422
   VALIDATION_FAILED`. Aucun code nouveau (D10).
3. Contrôle de portée **avant** l'appel : l'anomalie doit être dans la portée de la personne (lecture de la vue sous la
   même transaction, `FOR UPDATE` pris par la fonction) ; hors portée = `404` identique à `CL066`.
4. Audit `ANOMALY_CLASSIFIED` dans la même transaction (auteur, rôle exercé, portée, `anomaly_id`, `kind`, motif ; aucun
   montant à régler). Un refus n'écrit pas de ligne `ANOMALY_CLASSIFIED`.
5. Rejeu de la même clé : même réponse, un seul classement, une seule ligne d'audit.
6. Mutation : l'API ne passe plus par `classify_anomaly` et fait un `UPDATE` direct : le test T027 « droit retiré »
   échoue ; correspondance de `CL067` retirée : le test du type non classable échoue.

### T027 — Tests `anomalies*.spec.ts`

- `anomalies.spec.ts` : liste et filtres, `classifiable` vrai pour `CASH_DIFF` et faux pour `OFFLINE_SHORTFALL`, portée
  (`OPERATOR_ADMIN`, `ORGANIZER_ADMIN` de deux organisateurs, autre prestataire), `CASHIER`/`SUPERVISOR` refusés,
  pagination sans doublon (au moins 30 anomalies, `limit=7`).
- `anomalies-classification.spec.ts` : un test par type des **10 classables** (créer l'anomalie par le chemin le plus
  court du jeu de test ; sinon `INSERT` par le rôle propriétaire du test, noté) → `200`, `RESOLVED`, classement rempli ;
  un test par type non classable représentatif (`OFFLINE_SHORTFALL`, `PSP_TOPUP_NOT_CREDITED`, `CASH_TOPUP_OVER_LIMIT`) →
  `422` + `reason` et anomalie inchangée ; deuxième classement → `409` ; motif vide et 501 caractères → `422` ; anomalie
  d'un autre prestataire → `404` ; **nombre de lignes `journal_transaction` (et `posting`) du grand livre de
  l'anomalie, avant et après : inchangé** (SC-004) ; audit `ANOMALY_CLASSIFIED` présent (une ligne, bon auteur).
  **Preuve du retrait D4** : une connexion `cashless_app` qui lance `UPDATE anomaly SET status = 'RESOLVED'` en direct
  est refusée (droit retiré, ou déclencheur selon le choix de WP01 : lis sa note) ; vérifie aussi que `waive_seq_gap`
  clôt toujours un `SEQ_GAP`.
- `anomalies-concurrency.spec.ts` : deux classements simultanés de la même anomalie (clés différentes) → un `200`, un
  `409`, une seule ligne d'audit ; 10 simultanés → un seul `200`.

### T028 — Cas d'isolement

`backoffice-isolation-cases/anomalies.cases.ts` : un cas par opération (`listAnomalies`, `classifyAnomaly`). **Tu ne
modifies ni `registry.ts` ni le balayage** (§5 : opération servie = cas exigé). Mutation : retire un cas, le balayage
`backoffice-isolation.spec.ts` échoue ; remets-le. Le cas `classifyAnomaly` ne doit rien modifier chez A quand B tente.

## Retouches hors carte permises

Aucune. Un défaut de la fonction `classify_anomaly`, de la vue ou d'un schéma se signale dans la note de lane (WP01,
WP02, WP03 le corrigent) ; tu ne contournes pas en TypeScript.

## Definition of Done

- [ ] Deux routes conformes au contrat ; types classables tenus par la base seule ; aucun écrit au grand livre.
- [ ] `anomalies*.spec.ts`, `backoffice-isolation.spec.ts`, `architecture.spec.ts`, `test/unit/contracts` verts ;
      `app.module.ts` : une ligne ajoutée, rien d'autre.
- [ ] Mutations notées (portée, `UPDATE` direct, `CL067`, cas retiré).

## Ce que le relecteur doit casser

- Classer une anomalie d'argent (`OFFLINE_SHORTFALL`, `PSP_TOPUP_NOT_CREDITED`, `CASH_TOPUP_OVER_LIMIT`) par la route ou
  par un `UPDATE` direct de `cashless_app`.
- Deux classements simultanés qui passent tous les deux ; un classement rejoué qui double l'audit.
- Une écriture dans `journal_transaction` ou `posting` au classement.
- Un organisateur qui classe ou voit l'anomalie d'un autre ; une anomalie d'un autre prestataire autre que `404`.
- Une liste de types recopiée en TypeScript au lieu de `classifiable` de la base.
- Une modification de `app.module.ts` au-delà de l'inscription.

## Implementation command

`LC_ALL=C LANG=C spec-kitty agent action implement WP07 --agent claude --mission routes-backoffice-01M86KT6`
