# Mission Review Report: configuration-parties-evenements-01M4GCJ9

**Reviewer**: claude (revue post-merge, skill `spec-kitty-mission-review`)
**Date**: 2026-10-13
**Mission**: `configuration-parties-evenements-01M4GCJ9` — Configuration, parties et événements
**Baseline commit**: `8d09388` (`baseline_merge_commit` de `meta.json`, juste avant le squash merge `d9e3779`)
**HEAD at review**: `2408715` (local ; rien n'est poussé, aucune exécution GitHub Actions pour cette mission)
**WPs reviewed**: WP01..WP13 (13/13 `done` ; un cycle de revue chacun, sauf WP03 : un rejet puis approbation)

> Limite d'indépendance : le même agent a implémenté, relu, accepté (matrice 21/21) puis audité cette mission.
> Cette revue ne vaut pas relecture indépendante (voir RISK-1).

---

## Gate Results

Les portes 1 à 3 du skill visent le dépôt Spec Kitty lui-même ; leurs équivalents propres au projet ont été
exécutés sur `2408715`, comme pour la mission 2.

### Gate 1 — Contract tests
- Commandes équivalentes : `npm run check -w @cashless/contracts` (types générés = `openapi.yaml`) ;
  `npm run check:generated -w @cashless/ledger-sql` (fichiers `.sql` générés du kit inchangés).
- Exit code : 0 et 0.
- Result: **PASS**.

### Gate 2 — Architectural tests
- Commande équivalente : `test/unit/architecture.spec.ts` (pool confiné à `src/db/`, `PlatformTx` importée seulement
  par `db/`, `idempotency/`, `approval/` et les fichiers de plateforme, jamais `app.operator_id` dans `PlatformTx`)
  et `test/unit/idempotency-guard.spec.ts`, dans `npm test`.
- Exit code : 0 (47 suites, 873 tests, base neuve).
- Result: **PASS**.

### Gate 3 — Cross-repo E2E
- Sans objet (un seul dépôt). Équivalents du projet : `configuration-journey.spec.ts` (hiérarchie complète par
  l'API, une seule approbation pour `LIVE`), `api-config-replay.spec.ts` (48 transactions du scénario de référence
  rejouées à l'identique sur une configuration construite par l'API), pgTAP 947/947 sur base neuve.
- Exit code : 0.
- Result: **PASS** (équivalent).

### Gate 4 — Issue Matrix
- Fichier : absent. `spec.md` ne référence aucune issue GitHub ; aucune matrice n'a été générée par `finalize-tasks`.
- Result: **SANS OBJET**.

---

## FR Coverage Matrix

| FR ID | Description (bref) | WP | Test(s) | Adéquation | Constat |
|---|---|---|---|---|---|
| FR-001 | Rôle de base distinct pour la plateforme | WP03, WP05 | `tests_platform_scope.sql` (115), `platform-tx.spec.ts`, `architecture.spec.ts` | ADEQUATE | RISK-2 (limite acceptée) |
| FR-002 | Profils de législation versionnés | WP07 | `platform.spec.ts` | ADEQUATE | — |
| FR-003 | Valeurs provisoires signalées | WP06, WP07 | `test/unit/configuration/*`, `platform.spec.ts` | ADEQUATE | — |
| FR-004 | Prestataires | WP07 | `platform.spec.ts` | ADEQUATE | — |
| FR-005 | Organisateurs | WP08 | `tenant.spec.ts` | ADEQUATE | — |
| FR-006 | Commerçants | WP08 | `tenant.spec.ts` | ADEQUATE | — |
| FR-007 | Contrats versionnés | WP01, WP07, WP08 | `tests_configuration.sql`, `platform.spec.ts`, `tenant.spec.ts` | ADEQUATE | — |
| FR-008 | Règles de frais des quatre flux | WP01, WP10 | `fee-rules.spec.ts`, pgTAP | ADEQUATE | — |
| FR-009 | Événements | WP09 | `events.spec.ts` | ADEQUATE | — |
| FR-010 | Réglages par qui de droit | WP06, WP09 | catalogue (unitaires), `events.spec.ts` | ADEQUATE | plus strict que le plan (ADR-81) |
| FR-011 | Grand livre et comptes à la création | WP02, WP09 | `tests_event_ledger.sql` (84), `events.spec.ts` | ADEQUATE | — |
| FR-012 | Participations | WP10 | `participations.spec.ts` | ADEQUATE | DRIFT-1 (atomicité) |
| FR-013 | Points de vente | WP10 | `participations.spec.ts` | ADEQUATE | — |
| FR-014 | Cascade versionnée | WP06 | `cascade.spec.ts`, pgTAP | ADEQUATE | — |
| FR-015 | Bornes à l'enregistrement | WP06 | `bounds-validator.spec.ts`, `events.spec.ts`, `tenant.spec.ts` | ADEQUATE | — |
| FR-016 | Version de configuration pour les écritures | WP12 | `sql-config-resolver.spec.ts`, `api-config-replay.spec.ts` | ADEQUATE | écart de plan consigné (ADR-82) |
| FR-017 | Conditions de passage visibles | WP02, WP11 | pgTAP, `status.spec.ts` | ADEQUATE | — |
| FR-018 | Statut par `set_event_status` seulement | WP11 | `status.spec.ts` | ADEQUATE | — |
| FR-019 | Double validation | WP05, WP07-WP11 | suites de chaque module, `configuration-journey.spec.ts` | ADEQUATE | — |
| FR-020 | Audit | WP05-WP11 | suites d'intégration de chaque module | ADEQUATE | — |
| FR-021 | Contrat d'API et types générés | WP04 | `configuration-isolation.spec.ts` (opérations lues dans `openapi.yaml` par leurs tags) | ADEQUATE | — |

Les tests d'intégration passent par HTTP sur l'application réelle et une vraie base : aucun n'a été trouvé qui
fabrique à la main la forme attendue. Les modules ajoutés sont tous importés par `app.module.ts` (pas de code mort).

---

## Drift Findings

### DRIFT-1 : atomicité prouvée en un seul point d'injection

**Type**: NFR-MISS (partiel)
**Severity**: MEDIUM
**Spec reference**: NFR-004 (« après injection d'une erreur à chaque étape »)
**Evidence**:
- `apps/api/test/integration/events/events.spec.ts:197` : une seule panne injectée (`CascadeService.writeVersion`),
  après l'insertion de l'événement.
- `apps/api/test/integration/events/participations.spec.ts` : aucune injection d'erreur, alors que NFR-004 exige
  « 0 participation sans compte commerçant ».

**Analysis**: la garantie tient par construction (insertion et `open_event_ledger` / `open_participation_account`
dans la même transaction `TenantTx`), mais la preuve demandée par NFR-004, une panne à chaque étape et pour les deux
créations, n'est faite qu'en un point et pour l'événement seul.

### DRIFT-2 : seuil de latence tenu sur la meilleure de trois séries

**Type**: NFR-MISS (méthode de mesure)
**Severity**: LOW
**Spec reference**: NFR-003
**Evidence**: `apps/api/test/integration/end-to-end/configuration-latency.spec.ts:136-149` : une série au-dessus du
seuil est refaite, trois fois au plus, et le test retient la meilleure.

**Analysis**: adopté parce que la première série d'écritures dépassait 200 ms quand les 47 suites tournent en
parallèle sur le poste local (base en Docker). Mesuré seul : créations 74 à 88 ms, lectures 31 ms, écritures 67 ms.
Toutes les séries sont consignées, mais un dépassement réel et intermittent ne ferait pas échouer le test.

### DRIFT-3 : écarts de plan consignés (information)

**Type**: écarts documentés, sans violation
**Severity**: LOW
**Evidence**: ADR-80, ADR-81, ADR-82 dans `docs/DECISIONS_ADR.md` ; `kitty-specs/…/docs/architecture-notes.md`.

**Analysis**: nom de rôle fixe dans `platform_session()`, CHECK d'équivalence sur les demandes de plateforme,
politiques restrictives, un réglage par rôle, option d'idempotence `'principal'`, `fee_rule_id` ajouté au moteur
de la mission 1 (le plan le supposait déjà présent), 48 opérations au lieu de ~45. Tous vont vers plus de contrôle
et ont été confirmés par le porteur le 12/10/2026.

---

## Risk Findings

### RISK-1 : aucune relecture indépendante

**Type**: PROCESS
**Severity**: MEDIUM
**Location**: `status.events.jsonl` (13 approbations), `acceptance-matrix.json`
**Analysis**: implémentation, revue des 13 lots, matrice d'acceptation et présente revue viennent du même agent,
par délégation du porteur. Le seul rejet (WP03) est une auto-détection. Une relecture humaine des points sensibles
(`post-roles.sql`, migration `0009`, `platform-tx.ts`) reste souhaitable avant mise en production.

### RISK-2 : `cashless_platform` peut exécuter les fonctions d'API du schéma

**Type**: BOUNDARY-CONDITION (limite acceptée)
**Severity**: MEDIUM
**Location**: `packages/ledger-sql/roles.sql` (fichier du kit, non modifiable), ADR-80
**Trigger condition**: une session `cashless_platform` qui poserait elle-même `app.operator_id`.
**Analysis**: `EXECUTE` hérité de `PUBLIC`, exigé par la suite de référence. Défenses : chaque fonction commence par
`assert_tenant`, `PlatformTx` ne pose jamais `app.operator_id` (vérifié par `architecture.spec.ts`), le rôle n'a
aucun droit sur les tables du grand livre. Accepté par le porteur le 12/10/2026.

### RISK-3 : la CI n'a jamais exécuté cette mission

**Type**: CROSS-WP-INTEGRATION
**Severity**: MEDIUM
**Spec reference**: NFR-006 (« verts en CI à chaque commit »)
**Analysis**: tout est local ; `.github/workflows/ledger-tests.yml` a changé (mot de passe et URL du rôle
plateforme) sans avoir tourné sur GitHub. La répétition locale est verte, mais l'horloge et l'ordonnancement de la
CI diffèrent du poste local. À lever au premier push.

### RISK-4 : pagination par décalage non bornée

**Type**: BOUNDARY-CONDITION
**Severity**: LOW
**Location**: `apps/api/src/organization/platform/platform.dto.ts:115-122`
**Analysis**: le curseur accepte tout entier positif ; un très grand décalage fait un parcours inutile. Les listes
peuvent aussi sauter ou répéter une ligne si une insertion survient entre deux pages.

### RISK-5 : mise à jour d'une partie filtrée par l'identifiant seul

**Type**: BOUNDARY-CONDITION
**Severity**: LOW
**Location**: `apps/api/src/organization/tenant/parties.service.ts:64`
**Analysis**: `UPDATE party … WHERE id = $1` sans rappel du type ni du prestataire ; la protection repose sur la
lecture préalable `row(kind, id)` dans la même transaction et sur la RLS. Correct aujourd'hui, fragile si la lecture
préalable était un jour retirée.

---

## Silent Failure Candidates

| Emplacement | Condition | Résultat | Impact |
|---|---|---|---|
| — | — | — | Aucun trouvé. Les sept `catch` du code ajouté retraduisent une unicité (`23505`) ou `CL001` en 409 puis relancent tout le reste ; deux valident une entrée (curseur, fuseau) et finissent en 400. |

---

## Security Notes

| Constat | Emplacement | Classe | Recommandation |
|---|---|---|---|
| Noms de colonnes interpolés dans `INSERT` / `UPDATE event` | `events.service.ts:77,113` | injection SQL (écartée) | Les clés viennent de listes fermées (`CREATE_KEYS`, `UPDATE_KEYS`) ; garder cette contrainte si le catalogue devient dynamique |
| Fragments SQL interpolés (`${IDENTITY}`, `${where}`, `${COLUMNS}`) | `fee-rules.service.ts`, `participation-approval-actions.ts`, services de parties | injection SQL (écartée) | Constantes du code, valeurs toujours paramétrées |
| `EXECUTE` via `PUBLIC` | `roles.sql` | cloisonnement | Voir RISK-2 |
| Aucune suppression de règle de lint ou de type, aucun test désactivé | code ajouté | — | — |

---

## Final Verdict

**PASS WITH NOTES**

### Verdict rationale

Les 21 exigences fonctionnelles ont chacune une chaîne spec → lot → test → code, vérifiée par des tests qui
exercent l'application réelle. Aucune décision verrouillée n'est violée, aucun non-objectif envahi, aucun code mort,
aucun échec silencieux. Les portes équivalentes sont vertes sur le code fusionné (pgTAP 947/947, Jest 873/873).
Aucun constat CRITICAL ou HIGH. Les notes portent sur la preuve de deux exigences non fonctionnelles (NFR-004
partielle, NFR-003 mesurée au mieux de trois), sur l'absence de relecture indépendante et sur une CI pas encore
exécutée.

### Open items (non-blocking)

1. DRIFT-1 : ajouter une injection d'erreur à la création d'une participation, et aux autres étapes de la création
   d'un événement.
2. DRIFT-2 : en CI, mesurer la latence dans une suite isolée et sans nouvel essai.
3. RISK-3 : pousser la branche et obtenir une exécution GitHub Actions verte.
4. RISK-1 : relecture humaine de `post-roles.sql`, `0009_platform_scope.sql` et `platform-tx.ts`.
5. RISK-4, RISK-5 : borner le décalage ; rappeler type et prestataire dans l'`UPDATE` des parties.

## Retrospective Reminder

Séquence après fusion : revue de mission → rétrospective → constats. `retrospective.yaml` a été capturé à la fusion
(commit `3459cda`). Pour la relire :

- `spec-kitty retrospect summary` — vue d'ensemble des missions (lecture seule)
- `spec-kitty agent retrospect synthesize --mission configuration-parties-evenements-01M4GCJ9` — propositions
  (à blanc par défaut ; `--apply` pour les appliquer)
