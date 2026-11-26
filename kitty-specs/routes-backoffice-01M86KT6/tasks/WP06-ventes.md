---
work_package_id: WP06
title: Ventes
dependencies: [WP02, WP03, WP05]
requirement_refs:
- FR-005
- FR-006
- FR-007
- FR-017
- NFR-001
- NFR-002
- NFR-003
- NFR-006
- SC-003
planning_base_branch: feat/routes-backoffice
merge_target_branch: feat/routes-backoffice
branch_strategy: >-
  Planning artifacts for this mission were generated on feat/routes-backoffice. During
  /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must
  merge back into feat/routes-backoffice unless the human explicitly redirects the landing branch.
subtasks: [T021, T022, T023, T024]
phase: Phase 2 - Routes
agent: claude
history:
- timestamp: '2026-11-24T13:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: apps/api/src/sales/
create_intent:
- apps/api/src/sales/sales.controller.ts
- apps/api/src/sales/sales.service.ts
- apps/api/src/sales/sales.dto.ts
- apps/api/src/sales/sales.module.ts
- apps/api/test/integration/backoffice/sales.spec.ts
- apps/api/test/integration/backoffice/sales-pagination.spec.ts
- apps/api/test/integration/backoffice/sales-latency.spec.ts
- apps/api/test/integration/end-to-end/backoffice-isolation-cases/sales.cases.ts
execution_mode: code_change
model: sonnet
owned_files:
- apps/api/src/sales/**
- apps/api/src/payments/payments.module.ts
- apps/api/test/integration/backoffice/sales*.spec.ts
- apps/api/test/integration/end-to-end/backoffice-isolation-cases/sales.cases.ts
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP06 : Ventes

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role : implementer / Agent :
claude). Lis ensuite la fiche commune `docs/passation-11b/fiche-implementation.md`, ce prompt, puis seulement :

- `interfaces.md` §1 (carte), §2 (vue `sale_overview`, WP02), §3 (lignes `listEventSales`, `getSale`), §4
  (pagination, portée), §5 (balayage d'isolement, règle « opération servie ») ; `contracts/backoffice-routes.md` A3 ;
  `research.md` D5, D6 ; l'état fusionné de `0102_backoffice_read_views.sql` (WP02) et les schémas `SalePage`,
  `SaleSummary`, `SaleDetail`, `SaleLine` de `openapi.yaml` (WP03) ;
- `apps/api/src/payments/payment-read.service.ts` (l. 55-95 : portée d'une vente, jointure commerçant par le compte
  `MERCHANT`) et `payments.module.ts` (où inscrire `SalesModule`) ;
- `apps/api/src/identity/users/users.dto.ts` (`encodeCursor` / `decodeCursor`, l. 167-185) ; `identity/scope-resolver.ts`
  (`resolveChain`, `exercisedRole`, `hasRole`) et `identity/roles.decorator.ts` ;
- `apps/api/src/staff-profile/` (WP05 fusionné : modèle de contrôleur du personnel) ;
- `apps/api/test/integration/end-to-end/backoffice-isolation-cases/staff-profile.cases.ts` (forme d'un cas) et
  `device-latency.spec.ts` (modèle de mesure de latence, `SKIP_LATENCY`).

## Objective

`GET /events/{event_id}/sales` et `GET /sales/{transaction_id}` : lire les ventes de la portée de la personne, avec
filtres, pagination sans doublon, détail des lignes, origine et annulation ; aucune donnée du festivalier ; rien n'est écrit.

## Subtasks

### T021 — `listEventSales` : filtres, portée, pagination

1. Module `SalesModule` (contrôleur, service, dto), inscrit dans `PaymentsModule` (`payments.module.ts`, une ligne
   d'import : retouche permise, dans la carte). `@Roles` ou contrôle de service selon `interfaces.md` §3 :
   `OPERATOR_ADMIN`, `ORGANIZER_ADMIN`, `SUPERVISOR`, `MERCHANT_ADMIN`.
2. Lecture dans `sale_overview` (WP02) sous la transaction du prestataire (`TenantTx`). **La portée est dans le `WHERE`**
   (jamais un filtre après lecture) : événement du chemin dans le chemin de portée de l'appelant (`resolveChain`) ;
   pour un `MERCHANT_ADMIN`, `merchant_id` borné à ses commerçants (D6) quel que soit le filtre demandé. Événement
   hors portée ou d'un autre prestataire : `404 NOT_FOUND`.
3. Filtres `pos_id`, `merchant_id`, `vendor_id`, `from`, `to` (UTC, borne `to` exclusive), `status` (`VALID`, `REVERSED`
   par `reversal_transaction_id`). Valeur mal formée : `422 VALIDATION_FAILED`.
4. Pagination : tri `(occurred_at, transaction_id)` décroissant, curseur `base64url(`${iso}|${uuid}`)` (§4 ; réutilise
   `decodeCursor` de `users.dto.ts` ou en reprend la forme, sans le modifier), `limit` 1..200 défaut 50, `limit + 1`
   lignes lues pour `has_more`. Curseur invalide : `422`.
5. Mutation : filtre de portée retiré du `WHERE` (le test commerçant échoue) ; borne du curseur `>` au lieu de `<`
   (doublon ou trou détecté par le test de pagination).

### T022 — `getSale` : lignes, origine, annulation

`SaleDetail` = résumé + `lines[]` (`sale_line`, `line_no` croissant, libellés FR et EN, `unit_price`, `vat_rate_bps`,
`line_total`). Même portée que la liste, dans la requête ; vente d'un autre prestataire, hors portée ou d'un autre
commerçant : `404` identique (aucun indice). `source` ∈ `ONLINE`, `EDGE_SYNC`, `OFFLINE_SYNC` (une vente hors ligne garde
son `occurred_at` d'origine) ; `status = REVERSED` et `reversal_transaction_id` si une ligne `REVERSAL` la vise.
Aucun `wallet_id`, `media_id`, nom ou numéro dans la réponse (NFR-006). Mutation : colonne `wallet_id` ajoutée à la
réponse (le test de minimisation échoue).

### T023 — Tests `sales.spec.ts`, `sales-pagination.spec.ts`

Jeu de la recette (`quickstart.md` n° 2) : événement de 120 ventes, 2 points de vente, 2 commerçants, 2 vendeurs, 1
annulée. À couvrir : chaque filtre rend le bon sous-ensemble (effectifs exacts) ; `limit=7` parcourt les 120 sans
doublon ni oubli ; **1 000 ventes à `limit=200` : 0 écart** (NFR-002) ; `limit=201` ou `0` refusé ; `MERCHANT_ADMIN` ne
voit que ses ventes et reçoit `404` sur la vente d'un autre commerçant (même avec `merchant_id` d'un autre en filtre :
liste vide) ; `ORGANIZER_ADMIN` d'un autre organisateur et personne d'un autre prestataire : `404` ; `CASHIER`/`VENDOR`
refusés ; vente annulée et vente hors ligne. **Minimisation** : un test parcourt récursivement le JSON de chaque
réponse (liste et détail) et échoue si une clé ou une valeur ressemble à un numéro (`+\d{8,}`), un courriel, un
`wallet_id`, `media_id` ou un nom du jeu de test. Comptages limités à l'événement du test.

### T024 — Cas d'isolement et mesure de latence

1. `backoffice-isolation-cases/sales.cases.ts` : `export const cases: BackofficeIsolationCase[]` avec un cas par
   opération (`listEventSales`, `getSale`), forme de `staff-profile.cases.ts`. **Tu ne modifies ni `registry.ts` ni
   `backoffice-isolation.spec.ts`** (règle de §5 : le balayage exige un cas pour toute opération de la mission servie ;
   une opération non servie est sautée, la tienne ne l'est plus une fois `SalesModule` inscrit).
2. Mutation : retire un de tes deux cas, lance `backoffice-isolation.spec.ts` : il doit échouer en nommant l'opération ;
   remets le cas.
3. `sales-latency.spec.ts` (écartée par `SKIP_LATENCY`) : 200 000 ventes sur `cashless_wp06` (insertion en masse par
   `generate_series`, en test, jamais dans une migration), p95 < 500 ms sur 50 appels de liste (page 1, page profonde par
   curseur, filtre `merchant_id`, `MERCHANT_ADMIN`) et 50 détails. Note `EXPLAIN (ANALYZE, BUFFERS)` des trois requêtes ;
   si un plan balaie la table, signale-le à WP02 dans la note de lane (index = migration `0102`, pas à toi). Les
   chiffres et la commande vont dans la note de lane (repris par WP11 dans `preuves.md`).

## Retouches hors carte permises

Aucune. `payments.module.ts` est dans la carte. Un manque de colonne dans `sale_overview` ou de schéma dans
`openapi.yaml` se signale dans la note de lane ; ne modifie pas ces fichiers.

## Definition of Done

- [ ] Deux routes conformes au contrat fusionné (WP03) ; aucun droit nouveau ; aucun code d'erreur nouveau ; aucun SQL
      ni écriture dans le grand livre.
- [ ] `sales*.spec.ts` verts ; p95 < 500 ms mesuré sur 200 000 ventes (chiffre et commande dans la note) ;
      `backoffice-isolation.spec.ts`, `architecture.spec.ts`, `test/unit/contracts` verts.
- [ ] Mutations notées : portée du `WHERE`, borne du curseur, colonne personnelle ajoutée, cas d'isolement retiré.

## Ce que le relecteur doit casser

- Un `MERCHANT_ADMIN` qui lit la vente d'un autre commerçant du même événement, par la liste (filtre `merchant_id`
  étranger) ou par le détail.
- Un filtre de portée appliqué après lecture (comparer les requêtes : tout est-il dans le `WHERE` ?).
- Doublon ou trou de pagination quand deux ventes ont le même `occurred_at`.
- Un identifiant de portefeuille, de bracelet ou un nom dans une réponse ; un test de minimisation qui ne parcourt pas
  tout le JSON.
- Un plan d'exécution qui balaie les 200 000 lignes ; un p95 mesuré hors de `cashless_wp06` ou sans la portée du commerçant.
- Un cas d'isolement absent (retire-le : le balayage doit échouer).

## Implementation command

`LC_ALL=C LANG=C spec-kitty agent action implement WP06 --agent claude --mission routes-backoffice-01M86KT6`
