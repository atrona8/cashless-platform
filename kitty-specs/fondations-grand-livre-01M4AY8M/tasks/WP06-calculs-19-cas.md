---
work_package_id: WP06
title: Calculs monétaires et 19 cas normatifs
dependencies:
- WP01
requirement_refs:
- FR-016
- FR-017
planning_base_branch: feat/fondations-grand-livre
merge_target_branch: feat/fondations-grand-livre
branch_strategy: Planning artifacts for this mission were generated on feat/fondations-grand-livre. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/fondations-grand-livre unless the human explicitly redirects the landing branch.
subtasks:
- T023
- T024
- T025
- T026
- T027
- T028
phase: Phase 3 - Moteur d'écritures
history:
- timestamp: '2026-10-07T12:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: node-norris
authoritative_surface: apps/api/src/ledger/money/
create_intent:
- apps/api/src/ledger/money/rounding.ts
- apps/api/src/ledger/money/fee.ts
- apps/api/src/ledger/money/tax.ts
- apps/api/src/ledger/money/split.ts
- apps/api/src/ledger/money/spend.ts
- apps/api/src/ledger/money/index.ts
- apps/api/test/unit/money/reference-cases.spec.ts
- apps/api/test/unit/money/money.spec.ts
execution_mode: code_change
owned_files:
- apps/api/src/ledger/money/**
- apps/api/test/unit/money/**
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP06 – Calculs monétaires et 19 cas normatifs

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load node-norris`. Lis **intégralement**
`packages/ledger-sql/moteur_ecritures_reference.py` (107 lignes, normatif) et SPECIFICATION §5.5.

## Objective

Porter en TypeScript, en `bigint` exclusivement, les fonctions de calcul de `moteur_ecritures_reference.py` et
reprendre ses cas **tels quels** en tests unitaires (critère V1 n° 2).

## Context

- Exigences : FR-016, FR-017, NFR-001, C-004. Fonctions **pures**, sans NestJS ni base.
- La règle ESLint de WP01 interdit `Number(`, `Math.*` et les décimaux dans `apps/api/src/ledger/**`.
- Correspondance Python → TS : `div_round` → `roundDiv`, `fee` → `fee`, `split_tax` → `extractTax`,
  `split_share` → `splitShare`, `purchase_lines`/`offline_sync_lines` → `spendSplit` (+ assemblage de lignes dans
  les constructeurs, WP07).

## Branch Strategy

Planification et merge sur `feat/fondations-grand-livre`. Commande : `spec-kitty agent action implement WP06 --agent claude`.

## Subtasks

### T023 — `roundDiv(num: bigint, den: bigint): bigint` (`rounding.ts`)

- `den > 0n` sinon `RangeError`. `q = |num| / den`, `r = |num| % den` ; `if (2n * r >= den) q += 1n` ;
  signe de `num`. Identique à `div_round` (moitié s'éloignant de zéro).
- Tests : 1005×1000/10000 → 101 ; −1005×1000/10000 → −101 ; 0 → 0 ; 1/3 → 0 ; 2/3 → 1 ; −2/3 → −1.

### T024 — `fee(base, rule)` (`fee.ts`)

- `rule = { rateBps?: bigint; fixed?: bigint; min?: bigint | null; max?: bigint | null }`.
- `f = roundDiv(base * rateBps, 10_000n) + fixed` puis `max(f, min)` puis `min(f, max)` (dans cet ordre).

### T025 — Extraction de taxe et regroupement (`tax.ts`)

- `extractTax(ttc: bigint, taxBps: bigint): { ht: bigint; tax: bigint }` : `tax = roundDiv(ttc * taxBps, 10_000n +
  taxBps)` ; `ht = ttc - tax`.
- `groupForTax(items: { beneficiary: string; taxBps: bigint; ttc: bigint }[])` : additionne par
  `(beneficiary, taxBps)` en gardant l'ordre de première apparition ; renvoie `{ beneficiary, taxBps, ttc, ht, tax }[]`.
  C'est la règle « une fois par transaction et par bénéficiaire » (cas 2 et 18).

### T026 — Partage (`split.ts`)

- `splitShare(total, firstBps): [bigint, bigint]` : `a = roundDiv(total * firstBps, 10_000n)` ; `[a, total - a]`.

### T027 — Répartition offerts / payés (`spend.ts`)

- `spendSplit({ amount, promoBalance, paidBalance, promoFirst, mode: 'ONLINE' | 'OFFLINE' })` →
  `{ fromPromo, fromPaid, uncovered }`.
  - `ONLINE` : si `promo + paid < amount` → lever `InsufficientFundsError` (code `INSUFFICIENT_FUNDS`) ;
    `fromPromo = promoFirst ? min(amount, promo) : max(0, amount - paid)` ; `uncovered = 0`.
  - `OFFLINE` : `covered = min(amount, max(paid,0) + max(promo,0))` ; `fromPromo = promoFirst ? min(covered, promo)
    : max(0, covered - paid)` ; `fromPaid = covered - fromPromo` ; `uncovered = amount - covered`.
- Soldes en convention « positif = disponible » (le service convertit depuis les soldes signés du grand livre).

### T028 — 19 cas normatifs (`test/unit/money/reference-cases.spec.ts`)

- Un `it` par cas, numérotés et libellés comme dans `CASES` (1 à 16, 18, 19) + le cas d'erreur 17
  (`purchase 7000, promo 400, payé 5000` → `INSUFFICIENT_FUNDS`). Les cas 13, 14, 19 vérifient la sortie de
  `spendSplit` **et** l'assemblage de lignes équivalent (utiliser un petit assembleur de test local au fichier qui
  reproduit `purchase_lines`/`offline_sync_lines` ; les vrais constructeurs arrivent en WP07 et réutiliseront ces cas).
- Ajouter un test « garde de parité » qui lit `moteur_ecritures_reference.py` et vérifie que la liste des numéros de
  cas (`(n, "…"`) est exactement {1..16, 18, 19} : si le fichier de référence gagne un cas, le test échoue.

## Definition of Done

- `npm test -w @cashless/api -- money` : 19/19 cas + tests unitaires verts ; ESLint sans erreur sur `money/`.
- Aucun `number` dans les signatures de `money/`.

## Risks / Reviewer guidance

- Vérifier l'ordre min puis max dans `fee`. Vérifier `roundDiv` sur négatifs (cas 6).
