---
work_package_id: WP05
title: Opération de rendu partiel au guichet
dependencies: [WP02, WP03, WP04]
requirement_refs:
- FR-001
- FR-002
- FR-003
- FR-006
- FR-007
- FR-008
- FR-009
- FR-010
- FR-011
- FR-012
- FR-013
- NFR-001
- NFR-002
- NFR-004
- C-002
- C-005
planning_base_branch: feat/remboursement-partiel-especes
merge_target_branch: feat/remboursement-partiel-especes
branch_strategy: >-
  Planning artifacts for this mission were generated on feat/remboursement-partiel-especes. During
  /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must
  merge back into feat/remboursement-partiel-especes unless the human explicitly redirects the landing branch.
subtasks: [T015, T016, T017, T018, T019, T020]
phase: Phase 3 - Opération
agent: claude
history:
- timestamp: '2026-11-23T14:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: apps/api/src/media/lifecycle/partial-refund.service.ts
create_intent:
- apps/api/src/media/lifecycle/partial-refund.controller.ts
- apps/api/src/media/lifecycle/partial-refund.service.ts
- apps/api/test/integration/media/partial-cash-refund.spec.ts
- apps/api/test/integration/media/partial-cash-refund-concurrency.spec.ts
execution_mode: code_change
model: sonnet
owned_files:
- apps/api/src/media/lifecycle/partial-refund.controller.ts
- apps/api/src/media/lifecycle/partial-refund.service.ts
- apps/api/src/media/lifecycle/return.module.ts
- apps/api/test/integration/media/partial-cash-refund.spec.ts
- apps/api/test/integration/media/partial-cash-refund-concurrency.spec.ts
- apps/api/jest.config.cjs
- .github/workflows/ledger-tests.yml
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP05 : Opération de rendu partiel au guichet

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role : implementer / Agent :
claude). Lis ensuite la fiche commune `docs/passation-9c/fiche-implementation.md`, ce prompt, puis seulement :

- `interfaces.md` (route, service, codes, réponse) ; `contracts/partial-cash-refund.md` et l'opération
  `refundPartialCash` **telle que fusionnée par WP02** dans `openapi.yaml` ;
- `apps/api/src/media/lifecycle/release.controller.ts` (modèle exact des décorateurs, du passage, du jeton) et
  `release.service.ts` (verrous, `approverFor`, `WALLET_REFUND`, `attach_cash_tx`, espèces lues sur la ligne de caisse) ;
- `apps/api/src/media/lifecycle/cash-due.service.ts` (refus `EDGE`, seuil, caisse) et `counter-access.ts`
  (`CounterAccess.authorize`, `requireCashSession`) ;
- `apps/api/src/media/lifecycle/partial-refund-threshold.ts` (WP04, fusionné) ;
- les réglages de WP03 (catalogue, résolution par `cascade.service.ts`) ; la politique `refund_policy` (frais,
  `minimum_amount`, `channels` doit contenir `CASH`, `open`) et l'endroit où le moteur applique les frais d'un
  `WALLET_REFUND` ;
- `apps/api/test/integration/media/release-chaining.spec.ts` et `journey.spec.ts` (amorçage d'un guichet, d'une session
  de caisse, d'un jeton sur place).

## Objective

La route `refundPartialCash` de bout en bout : rendre en espèces un montant du solde payé, bracelet gardé actif, dans
les règles décidées par le porteur. C'est le cœur de la mission (MVP).

## Subtasks

### T015 — Contrôleur et module

`PartialRefundController` (`@Controller('media/:media_id')`, `@Post('partial-cash-refunds')`, `@HttpCode(201)`),
décorateurs **dans le même ordre** que `release` (`RequiresOnsiteApproval({ operationId: 'refundPartialCash', role:
'SUPERVISOR', optional: true, scope: événement du terminal })`, `CounterAuth`, `Idempotent({ scope: counterScope })`).
Corps : `amount` entier > 0 obligatoire ; `tap_id` OU `tap` (exactement un, sinon `400`) ; passage d'un autre bracelet
→ `counterRefusal('return.wrong_media')`. Inscris contrôleur et service dans `return.module.ts`.

### T016 — Contrôles préalables (service)

Dans `tx.run`, dans cet ordre : `counter.authorize` ; bracelet `FOR UPDATE` et `ACTIVE` (refus existants) ;
autorité de débit sur la passerelle → `409 DEBIT_AUTHORITY_EDGE` ; portefeuille du grand livre du terminal (bloqué ou
clos → `422 WALLET_BLOCKED`) ; réglages résolus : `cash_partial_refund_allowed` ET `cash_partial_refund_enabled` à
`true`, sinon `422 REFUND_NOT_ALLOWED` avec `reason: 'PARTIAL_CASH_REFUND_DISABLED'` ; `refund_policy` ouverte et
`CASH` permis (sinon même refus) ; session de caisse `OPEN` du terminal (`409 CONFLICT_STATE`) ;
`lockWalletPaidBalance` ; montant : ≤ solde payé (`422 INSUFFICIENT_FUNDS`), ≥ `minimum_amount` et > frais
(`422 AMOUNT_OUT_OF_RANGE`).

### T017 — Écriture, seconde personne, réponse, audit

1. `requireApprovalOverDailyCumul(client, { walletId, amount, limit: event.cash_refund_single_max, now }, approve)`.
2. `engine.execute` `WALLET_REFUND` : montant brut, `moneyAccount: session.code`, clé
   `partial-refund:<media_id>:<Idempotency-Key>`, `metadata: { cash_session_id, partial_cash_refund: true, media_id }`,
   `approvedBy` si présent ; frais par le moteur (jamais recalculés à la main) ; `attach_cash_tx`.
3. Espèces remises lues sur la ligne de caisse (comme `release.service.ts`) ; réponse `201` `PartialCashRefund`
   (`fee = amount_debited − cash_handed`, `paid_balance_after` relu, `day_cumulative` = cumul + montant).
4. Audit : auteur, valideur, montant, frais, terminal, session (`AuditService`, même forme que la restitution).
5. Crédits offerts, caution, statut et rattachement du bracelet **ne bougent pas** (FR-002, FR-003).

### T018 — Tests `partial-cash-refund.spec.ts` : parcours et refus

US1 (anonyme, solde 20 000, rendu 5 000 → solde 15 000, remis 5 000 − frais, bracelet `ACTIVE`, paiement suivant
accepté ; tout le solde ; crédits offerts et caution intacts) ; US2 (non autorisé, non activé, désactivé, autorisation
retirée → `422` + `reason`) ; refus : montant 0, ≤ frais, > solde, sans session, autre bracelet, bracelet suspendu,
portefeuille bloqué, `EDGE`, rôle `VENDOR` ; rejeu de la même clé → même réponse, une seule sortie d'espèces (FR-011) ;
isolation entre prestataires.

### T019 — Seconde personne et caisse

US3 : seuil 50 000 ; 30 000 puis 25 000 le même jour, **avec deux bracelets du même portefeuille** → `403
APPROVAL_REQUIRED` ; avec jeton d'une autre personne → `201`, `approved_by` porté par l'écriture ; jeton de l'auteur →
`403 APPROVAL_INVALID`. SC-004 : fermeture de la session après rendus : écart nul sur un comptage juste.

### T020 — Concurrence et latence

`partial-cash-refund-concurrency.spec.ts` : 20 envois simultanés (clés différentes) sur un même portefeuille au solde
juste → somme rendue ≤ solde, cumul exact, aucune écriture en trop (NFR-002). Mesure p95 sur 50 rendus (< 300 ms,
NFR-001). Si la suite ouvre beaucoup de connexions, écarte-la de la passe parallèle (`SKIP_LATENCY` dans
`jest.config.cjs`) et ajoute une étape seule, en série, dans `.github/workflows/ledger-tests.yml` (modèle : étape
« Rotation du secret des codes de rattachement »).

## Definition of Done

- [ ] Route conforme au contrat fusionné ; aucun droit nouveau ; aucun code d'erreur nouveau.
- [ ] Suites vertes ; gardes transverses vertes (`architecture`, `production-guard`, `test/unit/contracts`,
      `consignation`).
- [ ] Mutations notées : réglage ignoré, verrou retiré (le test de concurrence échoue), marque `partial_cash_refund`
      absente (le cumul suivant ne compte plus), seuil `>=`, crédits offerts débités.

## Ce que le relecteur doit casser

- Rendu sans les deux réglages, ou avec une `refund_policy` fermée / sans `CASH`.
- Fractionnement entre bracelets du même portefeuille sans seconde personne.
- Double sortie d'espèces au rejeu ou sous concurrence.
- Crédits offerts ou caution touchés ; bracelet libéré ou détaché.
- Espèces sorties hors de la session ouverte du terminal.

## Implementation command

`LC_ALL=C LANG=C spec-kitty agent action implement WP05 --agent claude --mission remboursement-partiel-especes-01M84932`
