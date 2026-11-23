---
work_package_id: WP04
title: Seuil de la seconde personne au cumul du jour
dependencies: [WP01]
requirement_refs:
- FR-007
- NFR-002
planning_base_branch: feat/remboursement-partiel-especes
merge_target_branch: feat/remboursement-partiel-especes
branch_strategy: >-
  Planning artifacts for this mission were generated on feat/remboursement-partiel-especes. During
  /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must
  merge back into feat/remboursement-partiel-especes unless the human explicitly redirects the landing branch.
base_branch: kitty/mission-remboursement-partiel-especes-01M84932
base_commit: ca19084c915229a733c034180609f789a22ad401
created_at: '2026-11-23T14:25:50.618893+00:00'
subtasks: [T012, T013, T014]
phase: Phase 2 - Réglages et seuil
agent: claude
history:
- timestamp: '2026-11-23T14:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: apps/api/src/media/lifecycle/partial-refund-threshold.ts
create_intent:
- apps/api/src/media/lifecycle/partial-refund-threshold.ts
- apps/api/test/integration/media/partial-refund-threshold.spec.ts
execution_mode: code_change
model: sonnet
owned_files:
- apps/api/src/media/lifecycle/partial-refund-threshold.ts
- apps/api/test/integration/media/partial-refund-threshold.spec.ts
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP04 : Seuil de la seconde personne au cumul du jour

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role : implementer / Agent :
claude). Lis ensuite la fiche commune `docs/passation-9c/fiche-implementation.md`, ce prompt, puis seulement :

- `kitty-specs/remboursement-partiel-especes-01M84932/interfaces.md`, section « Module du seuil » (signatures **exactes**
  à respecter) et `research.md` D3 ;
- la note de lane de WP01 (requête du cumul et index : reprends le prédicat **mot pour mot**) ;
- `apps/api/src/media/lifecycle/release.service.ts` l. 200-245 (verrou `lockWalletPaidBalance` puis lecture du cumul,
  `approverFor`, comparaison `>`) ;
- `docs/DECISIONS_ADR.md` ADR-190 et ADR-195 ;
- `apps/api/test/integration/media/release-chaining.spec.ts` (« fractionnement ») pour l'amorçage d'un portefeuille et
  d'écritures `WALLET_REFUND` en test.

## Objective

Fournir à WP05 un module autonome qui lit le cumul du jour des rendus partiels **d'un portefeuille** (tous bracelets) et
décide la seconde personne, sans dupliquer la logique du guichet de retour (qui garde son propre cumul, inchangé).

## Subtasks

### T012 — `partialRefundDayTotal(client, walletId, now)`

1. Somme des débits du compte `WALLET_PAID` du portefeuille portés par les `journal_transaction` `WALLET_REFUND`
   marquées `metadata->>'partial_cash_refund' = 'true'`, `recorded_at` ≥ 00:00 UTC du jour de `now` (le jour est
   calculé côté base : `date_trunc('day', $now AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`).
2. Retour `bigint` (0 sans rendu). Requête paramétrée, jamais de concaténation.
3. **Heure serveur** : `now` vient de l'appelant mais la comparaison porte sur `recorded_at` (heure de la base).

### T013 — `requireApprovalOverDailyCumul(client, input, approve)`

1. `dayTotal = partialRefundDayTotal(...)` ; si `dayTotal + amount > limit` : `approve` absent → `ProblemException
   ('APPROVAL_REQUIRED', { status: 403 })` ; sinon `approvedBy = await approve(client)`.
2. Renvoie `{ dayTotal, approvedBy }`. Commentaire : **l'appelant doit avoir pris `lockWalletPaidBalance` avant**
   (ADR-195) ; la fonction ne verrouille pas elle-même (ordre des verrous : bracelet, puis portefeuilles).
3. `limit` nul ou absent du réglage : la valeur passée est celle de l'événement ; `limit = 0` ⇒ tout rendu exige un
   jeton (comportement du guichet de retour).

### T014 — Tests `partial-refund-threshold.spec.ts`

Prouve, sur `cashless_wp04` :
- cumul nul sans rendu ; somme exacte de 3 rendus partiels du jour ;
- rendus d'hier exclus (pose `recorded_at` par le propriétaire pour simuler, ou attends le changement de jour de façon
  déterministe : pas d'horloge de Node comparée à celle de la base, piège connu) ;
- **tous bracelets** : deux bracelets du même portefeuille s'additionnent ; un autre portefeuille est exclu ;
- un `WALLET_REFUND` du guichet de retour (sans la marque) est exclu ;
- seuil : `total + amount = limit` passe sans jeton ; `> limit` sans `approve` → `403 APPROVAL_REQUIRED` ; avec
  `approve` → valeur rendue ;
- mutations notées : `>=` au lieu de `>`, marque ignorée, filtre de portefeuille retiré, jour non borné.

## Definition of Done

- [ ] Signatures identiques à `interfaces.md` ; aucun autre fichier modifié.
- [ ] Suite verte ; quatre mutations notées.
- [ ] `EXPLAIN` de la requête réelle cohérent avec l'index de WP01 (note de lane).

## Ce que le relecteur doit casser

- Un cumul par bracelet au lieu du portefeuille (décision du porteur : portefeuille).
- Une comparaison `>=`, ou un cumul qui oublie le montant en cours.
- L'heure du terminal ou de Node utilisée pour borner le jour.
- Un comptage qui lit toute la base (filtre par portefeuille absent ou contourné).

## Implementation command

`LC_ALL=C LANG=C spec-kitty agent action implement WP04 --agent claude --mission remboursement-partiel-especes-01M84932`
