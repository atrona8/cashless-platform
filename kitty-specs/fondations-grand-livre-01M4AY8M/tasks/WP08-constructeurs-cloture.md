---
work_package_id: WP08
title: Constructeurs « clôture et back-office » et registre
dependencies:
- WP07
requirement_refs:
- FR-013
- FR-014
- FR-019
planning_base_branch: feat/fondations-grand-livre
merge_target_branch: feat/fondations-grand-livre
branch_strategy: Planning artifacts for this mission were generated on feat/fondations-grand-livre. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/fondations-grand-livre unless the human explicitly redirects the landing branch.
subtasks:
- T036
- T037
- T038
- T039
- T040
- T041
- T042
phase: Phase 3 - Moteur d'écritures
history:
- timestamp: '2026-10-07T12:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: node-norris
authoritative_surface: apps/api/src/ledger/builders/closing/
create_intent:
- apps/api/src/ledger/builders/closing/pitch-fee.ts
- apps/api/src/ledger/builders/closing/merchant-debt-transfer.ts
- apps/api/src/ledger/builders/closing/operator-fee.ts
- apps/api/src/ledger/builders/closing/platform-fee.ts
- apps/api/src/ledger/builders/closing/cash.ts
- apps/api/src/ledger/builders/closing/psp-settlement.ts
- apps/api/src/ledger/builders/closing/backoffice.ts
- apps/api/src/ledger/builders/closing/breakage.ts
- apps/api/src/ledger/builders/closing/payout.ts
- apps/api/src/ledger/builders/registry.ts
- apps/api/test/unit/builders/closing/closing-builders.spec.ts
- apps/api/test/unit/builders/closing/registry.spec.ts
execution_mode: code_change
owned_files:
- apps/api/src/ledger/builders/closing/**
- apps/api/src/ledger/builders/registry.ts
- apps/api/test/unit/builders/closing/**
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP08 – Constructeurs « clôture et back-office » et registre

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load node-norris`. Lis `apps/api/src/ledger/types.ts` (WP07), SPECIFICATION
§5.3, §5.6, §12.1 (droit de place, casse réversible, ADR-67/75) et les transactions 23 à 48 du scénario.

## Objective

Écrire les constructeurs purs restants et le **registre** qui associe chacun des 26 types à son constructeur ou à sa
fonction SQL déléguée.

## Context

- Exigences : FR-013, FR-014 (marqueur de délégation), FR-019, NFR-001.
- Les types `BACKOFFICE` (`ANOMALY_RESOLUTION`, `ADJUSTMENT`, `BREAKAGE_REVERSAL`, et toute commande de source
  `BACKOFFICE`) exigent `createdBy` et `approvedBy` distincts : sinon `BuildError('VALIDATION_FAILED')`.

## Branch Strategy

Planification et merge sur `feat/fondations-grand-livre`. Commande : `spec-kitty agent action implement WP08 --agent claude`.

## Subtasks

### T036 — `PITCH_FEE`, `MERCHANT_DEBT_TRANSFER`

- `PITCH_FEE` : pour chaque participation retenue (mode `DEDUCT_OR_DEBT` : montant total ; `DEDUCT_CAPPED` :
  `min(droit, solde du commerçant)` fourni par le service ; `PREPAID` : exclue), `merchant +TTC` ; puis
  `org('ORG_PLACE') −HT` et `org('ORG_TAX') −taxe` avec **une** extraction sur la somme. Référence : T30
  (15 000 + 10 000 → 21 186 + 3 814).
- `MERCHANT_DEBT_TRANSFER` : commerçant en solde négatif `s` → `org('ORG_RECEIVABLE') +|s|`, `merchant −|s|`.
  Pas dans le scénario : test dédié.

### T037 — `OPERATOR_FEE`, `PLATFORM_FEE`

- `OPERATOR_FEE` : une ligne de débit `org('ORG_FPREST')` **par règle** (dans l'ordre des règles), montant
  `fee(assiette, règle)` ; puis `ope('OPE_FRAIS') −HT`, `ope('OPE_TAX') −taxe` sur la somme. Assiettes fournies
  par le service : `TOPUP_AMOUNT` (recharges payées de la période, `GROSS` ou `NET_OF_REFUNDS`), `PER_MEDIA`
  (nombre de supports × fixe). Référence : T31 (3 % de 100 000 = 3 000 ; 6 × 500 = 3 000 ; 6 000 → 5 085 + 915).
  Régularisation `NET_OF_REFUNDS` (sens inverse) : `payload.regularization = true` inverse les signes.
- `PLATFORM_FEE` : assiette `FEE_AMOUNT` = frais HT du prestataire ; `ope('OPE_REDEV') +TTC`,
  `plt('PLT_REDEV') −HT`, `plt('PLT_TAX') −taxe`. Référence : T32 (20 % de 5 085 = 1 017 → 862 + 155).

### T038 — `CASH_CLOSE`, `CASH_DEPOSIT`, `PSP_SETTLEMENT`

- `CASH_CLOSE` : `money('A-TRANSIT') +compté`, puis selon l'écart `d = théorique − compté` : manque (`d > 0`) →
  compte de pertes de `cash_diff_bearer` (`ORG_PERTES` ou `OPE_PERTES`) `+d` ; surplus (`d < 0`) → même compte
  `−|d|` ; enfin `money('A-CAISSE-<n>') −théorique`. Référence : T24 (36 800 compté, 200 de manque, 37 000).
- `CASH_DEPOSIT` : `A-BANQUE +m`, `A-TRANSIT −m` (T26).
- `PSP_SETTLEMENT` : `A-BANQUE +net`, `A-PSP-<canal> −net` (T27 à T29).

### T039 — `ANOMALY_RESOLUTION`, `ADJUSTMENT`, `BREAKAGE`, `BREAKAGE_REVERSAL`

- `ANOMALY_RESOLUTION` (source `BACKOFFICE` obligatoire) : compte de pertes de `offline_loss_bearer` `+m`,
  `suspense() −m` (T25).
- `ADJUSTMENT` (source `BACKOFFICE`, motif obligatoire dans `metadata.reason`) : lignes **fournies** par la
  commande (références de comptes + montants), contrôlées : ≥ 2, somme 0, aucun montant nul.
- `BREAKAGE` : pour chaque portefeuille, `wallet P +solde` (et `cashDue()` si présent) ; total partagé selon
  `breakage_destination` : `ORGANIZER` → `splitShare(total, breakageOrganizerBps)` → `org('ORG_CASSE') −a`,
  `ope('OPE_CASSE') −b` ; `LEGAL_ACCOUNT` → `legalBreakage() −total`. Référence : T43 (20 000 → 16 000 + 4 000).
- `BREAKAGE_REVERSAL` (source `BACKOFFICE`) : débite chaque bénéficiaire de la casse au prorata de sa part initiale
  (`payload.originalShares`, `splitShare` du montant réclamé), crédite `wallet P` du montant. La base contrôle les
  bornes (`check_late_claim`, `CL024`) ; le constructeur garantit seulement l'équilibre et le prorata.

### T040 — `PAYOUT_INITIATED`, `PAYOUT_CONFIRMED`, `PAYOUT_FAILED`

- `PAYOUT_INITIATED` : une ligne de débit par bénéficiaire (`merchant(…)`, `org('ORG_VERS')`, `ope('OPE_VERS')`,
  `plt('PLT_VERS')`, `legalBreakage()`) puis `payoutPending() −total`. Référence : T33, T39, T46.
- `PAYOUT_CONFIRMED` : `payoutPending() +m`, `money(A-BANQUE | A-PSP-*) −m` (T34, T36-T38, T40, T47, T48).
- `PAYOUT_FAILED` : `payoutPending() +m`, compte d'origine `−m` (T35).

### T041 — Registre (`builders/registry.ts`)

- `BUILDERS: Record<TransactionType, { kind: 'lines'; build } | { kind: 'delegated'; fn: 'take_deposit' |
  'refund_deposit' | 'forfeit_deposit' } | { kind: 'mixed'; … }>` :
  `DEPOSIT_TAKEN`, `DEPOSIT_REFUNDED`, `DEPOSIT_FORFEITED` → délégués ; `PROMO_CREDIT` et `WALLET_REFUND` →
  `mixed` (préchargement → `preload_media` ; espèces dues → `refund_cash_due` ; sinon constructeur de lignes),
  choix par `payload.variant`.
- Typage : `satisfies Record<TransactionType, …>` pour que l'oubli d'un type soit une erreur de compilation.

### T042 — Tests

- `closing-builders.spec.ts` : transactions 24 à 40, 43, 46 à 48 du scénario, comparées ligne à ligne (réutiliser
  `test/unit/builders/support/scenario-lines.ts` de WP07) ; tests dédiés `MERCHANT_DEBT_TRANSFER`, `ADJUSTMENT`
  (refus si déséquilibré, si auteur = valideur, si motif absent), `BREAKAGE_REVERSAL` (prorata ±1), `CASH_CLOSE`
  surplus, `OPERATOR_FEE` régularisation.
- `registry.spec.ts` : les clés du registre = exactement les 26 valeurs de la contrainte `CHECK` lue dans
  `packages/ledger-sql/schema_grand_livre_cashless.sql` (analyse du texte du fichier) ; chaque type a au moins un
  test de construction ou de délégation.

## Definition of Done

- 26/26 types au registre, tous couverts par un test (SC-004). Lignes du scénario reproduites pour T24-T40, T43,
  T46-T48.

## Risks / Reviewer guidance

- T31 a **deux** lignes `L-ORG-FPREST` (une par règle) : ne pas les fusionner.
- `ANOMALY_RESOLUTION`/`ADJUSTMENT`/`BREAKAGE_REVERSAL` hors `BACKOFFICE` doivent échouer avant la base.
