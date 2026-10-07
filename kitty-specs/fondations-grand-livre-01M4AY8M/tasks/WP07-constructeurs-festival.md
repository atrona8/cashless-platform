---
work_package_id: WP07
title: Constructeurs « festival »
dependencies:
- WP06
requirement_refs:
- FR-013
- FR-015
planning_base_branch: feat/fondations-grand-livre
merge_target_branch: feat/fondations-grand-livre
branch_strategy: Planning artifacts for this mission were generated on feat/fondations-grand-livre. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/fondations-grand-livre unless the human explicitly redirects the landing branch.
subtasks:
- T029
- T030
- T031
- T032
- T033
- T034
- T035
phase: Phase 3 - Moteur d'écritures
history:
- timestamp: '2026-10-07T12:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: node-norris
authoritative_surface: apps/api/src/ledger/builders/festival/
create_intent:
- apps/api/src/ledger/types.ts
- apps/api/src/ledger/builders/festival/topup.ts
- apps/api/src/ledger/builders/festival/topup-cash.ts
- apps/api/src/ledger/builders/festival/promo.ts
- apps/api/src/ledger/builders/festival/activation-fee.ts
- apps/api/src/ledger/builders/festival/purchase.ts
- apps/api/src/ledger/builders/festival/reversal.ts
- apps/api/src/ledger/builders/festival/wallet-refund.ts
- apps/api/src/ledger/builders/festival/chargeback.ts
- apps/api/test/unit/builders/support/scenario-lines.ts
- apps/api/test/unit/builders/festival/festival-builders.spec.ts
execution_mode: code_change
owned_files:
- apps/api/src/ledger/types.ts
- apps/api/src/ledger/builders/festival/**
- apps/api/test/unit/builders/festival/**
- apps/api/test/unit/builders/support/**
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP07 – Constructeurs « festival »

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load node-norris`. Lis SPECIFICATION §5.2 (plan de comptes), §5.3 (types),
§5.4, §5.5 ; `contracts/engine-command.md` ; `packages/ledger-sql/scenario_reference.json` (transactions 1 à 22,
41, 42).

## Objective

Définir les types du moteur et écrire les constructeurs **purs** (commande + contexte → lignes) des types émis
pendant le festival. Aucun accès base, aucun NestJS.

## Context

- Exigences : FR-013, FR-015 (étapes 1, 4, 5 côté lignes), FR-016, C-001, C-004.
- Un constructeur ne fait **que** produire des lignes ; la matrice des statuts (WP09), la lecture des soldes et
  l'appel à `post_transaction` (WP12) sont ailleurs.
- Les comptes sont désignés par des **références** résolues plus tard en identifiants (port de résolution, WP09).

## Branch Strategy

Planification et merge sur `feat/fondations-grand-livre`. Commande : `spec-kitty agent action implement WP07 --agent claude`.

## Subtasks

### T029 — Types du moteur (`apps/api/src/ledger/types.ts`)

- `TRANSACTION_TYPES` : tuple `as const` des 26 types, **dans l'ordre de la contrainte `CHECK`** de
  `journal_transaction.type` ; `type TransactionType`.
- `SOURCES` : `ONLINE | OFFLINE_SYNC | EDGE_SYNC | PSP_WEBHOOK | BATCH | BACKOFFICE`.
- `AccountRef` : `{ code: string }` (comptes d'argent par canal ou caisse : `A-PSP-WAVE`, `A-CAISSE-C1`, `A-BANQUE`,
  `A-TRANSIT`) ou `{ purpose: string; ownerPartyId?: string; walletId?: string; participationId?: string }`
  (droits). Fournir des fabriques lisibles : `wallet(walletId,'P'|'X')`, `merchant(participationId)`,
  `org(purpose)`, `ope(purpose)`, `plt(purpose)`, `suspense()`, `payoutPending()`, `cashDue()`, `legalBreakage()`,
  `money(code)`. Les fabriques `org/ope/plt` prennent l'identifiant de partie depuis le contexte (organisateur,
  prestataire, plateforme du grand livre).
- `Line = { account: AccountRef; amount: bigint; memo?: string }` (débit +, crédit −).
- `ResolvedConfig` (fourni par `ConfigResolver`, WP09) : `taxBps`, `configVersionId?`, `commissions:
  Record<participationId, FeeRule>`, `pspFees: Record<channel, FeeRule>`, `pspFeeBearer: 'ORGANIZER' | 'OPERATOR'
  | 'CUSTOMER'`, `activationFee: FeeRule`, `refundFee: FeeRule`, `operatorFees: { basis: …; rule: FeeRule }[]`,
  `platformFee: FeeRule`, `breakageOrganizerBps`, `pitchFees: Record<participationId, bigint>`, `spendOrder:
  'PROMO_FIRST' | 'PAID_FIRST'`, parties `{ platformId, operatorId, organizerId }`.
- `BuildContext = { config: ResolvedConfig; balances?: …; original?: Line[] }`.
- `LedgerCommand` : union discriminée par `type`, champs communs de `contracts/engine-command.md` + `payload`
  propre à chaque type (défini dans le fichier du constructeur et réexporté). Les constructeurs exportent
  `build<Type>(command, ctx): Line[]`.
- `BuildError` (code `VALIDATION_FAILED` ou `INSUFFICIENT_FUNDS`, message court) : levé par un constructeur pour une
  commande incohérente (montant ≤ 0, devise, portefeuille manquant…).

### T030 — `TOPUP`, `TOPUP_CASH`

- `TOPUP` (source `PSP_WEBHOOK`) : `money('A-PSP-<canal>') +brut`, `wallet P −brut` ; frais PSP
  `f = fee(brut, pspFees[canal])` : payeur `ORGANIZER` → `org('ORG_FPSP') +f`, `A-PSP −f` ; `OPERATOR` →
  `ope('OPE_FPSP')` ; `CUSTOMER` → portefeuille crédité du **net** et `ORG_FFEST` (HT) + `ORG_TAX` (taxe extraite)
  crédités des frais. Référence : T1 à T3 du scénario (payeur `ORGANIZER`).
- `TOPUP_CASH` : `money('A-CAISSE-<n>') +montant`, `wallet P −montant`. Découpage hors ligne au-delà de la marge
  (ADR-63) : `payload.headroom?: bigint` fourni par le service (WP12) ; si `headroom < montant`, crédit `wallet P`
  de `headroom` et `cashDue()` du reste. Référence : T4, T6.

### T031 — `PROMO_CREDIT`, `PROMO_EXPIRY`, `ACTIVATION_FEE`

- `PROMO_CREDIT` (hors préchargement, qui est délégué) : `org('ORG_PROMO') +m`, `wallet X −m` (T8).
- `PROMO_EXPIRY` : `wallet X +solde`, `org('ORG_PROMO') −solde` ; `payload.amount` = solde offert à expirer (T45).
- `ACTIVATION_FEE` : une ligne de débit `wallet P` par support (montant `fee(…, activationFee)` chacun), puis
  `ORG_FFEST` HT + `ORG_TAX` avec **une** extraction de taxe sur la somme (`groupForTax`) (T9 : 5 × 1 000 →
  4 237 + 763).

### T032 — `PURCHASE`

- Entrées : montant, portefeuille, participation, `promoBalance`/`paidBalance` (positifs, fournis par le service),
  `mode` (`ONLINE` si source `ONLINE`, sinon `OFFLINE`).
- Lignes, dans l'ordre : `wallet X +fromPromo` (si > 0), `wallet P +fromPaid` (si > 0), `suspense() +uncovered`
  (si > 0), `merchant −montant` ; commission `c = fee(montant, commissions[participation])` ; si `c > 0` :
  `merchant +c`, `org('ORG_COM') −ht`, `org('ORG_TAX') −tax` (ligne de taxe omise si nulle).
- Références : T10 à T22 (T22 : hors ligne avec `S-ATTENTE`). Cas 13, 14, 19 de WP06.

### T033 — `REVERSAL`

- `ctx.original` = lignes de la transaction d'origine ; sortie = mêmes comptes, montants opposés, même ordre ;
  **jamais de recalcul**. Exiger `reversesId`. Référence : T16 (contre-passe T15).

### T034 — `WALLET_REFUND`, `CHARGEBACK`

- `WALLET_REFUND` (solde payé ; le rendu d'espèces dues est délégué) : frais de remboursement
  `r = fee(…, refundFee)` : `wallet P +r`, `ORG_FFEST −ht`, `ORG_TAX −tax` ; puis `wallet P +net`, `money(<canal>)
  −net` (`A-BANQUE`, `A-PSP-*` ou `A-CAISSE-*`). Référence : T41, T42 (500 de frais → 424 + 76, puis 1 500 / 12 000).
- `CHARGEBACK` : `wallet P +min(montant, soldePayé)`, compte de pertes de `contract.chargeback_bearer`
  (`org('ORG_PERTES')` par défaut, ou `ope('OPE_PERTES')`) `+reste`, `money('A-PSP-<canal>') −montant`.
  Pas dans le scénario : tests dédiés (solde suffisant, insuffisant, nul).

### T035 — Tests (`test/unit/builders/festival/festival-builders.spec.ts`)

- `test/unit/builders/support/scenario-lines.ts` : charge `scenario_reference.json`, expose les lignes d'une
  transaction par numéro, et un résolveur de test `AccountRef → code du scénario` (`L-WAL-W01-P`, `L-MCH-FOOD`,
  `L-ORG-COM`…) à partir des parties et comptes du JSON. Paramètres décimaux du JSON : convertir en points de base
  **depuis le texte** (`"0.015"` → `150n`), jamais par flottant (lire le fichier brut et extraire les nombres par
  expression régulière, ou analyser le JSON avec un `reviver` qui garde le texte source si disponible).
- Pour chaque transaction du scénario de ces types (T1-T4, T6, T8-T22, T41, T42, T45) : construire la commande,
  appeler le constructeur, comparer **comptes et montants dans l'ordre** aux lignes du JSON (mémo ignoré).
- Tests de cas limites : montant nul ou négatif → `BuildError` ; commission 0 → aucune ligne de commission ; taxe 0
  → aucune ligne de taxe ; `CUSTOMER` payeur PSP ; `TOPUP_CASH` avec marge partielle ; `CHARGEBACK` ×3.

## Definition of Done

- Tous les tests verts ; ESLint sans erreur ; aucune lecture de base ni import NestJS dans `builders/`.
- Somme des lignes = 0 pour chaque sortie (assertion générique dans les tests).

## Risks / Reviewer guidance

- L'ordre des lignes compte (comparaison au JSON et `line_no`). Vérifier T9 (5 débits puis 2 crédits) et T22.
