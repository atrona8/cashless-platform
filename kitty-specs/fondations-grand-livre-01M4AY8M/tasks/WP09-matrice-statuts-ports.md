---
work_package_id: WP09
title: Matrice des statuts et ports du moteur
dependencies:
- WP07
requirement_refs:
- FR-015
- FR-018
planning_base_branch: feat/fondations-grand-livre
merge_target_branch: feat/fondations-grand-livre
branch_strategy: Planning artifacts for this mission were generated on feat/fondations-grand-livre. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/fondations-grand-livre unless the human explicitly redirects the landing branch.
subtasks:
- T043
- T044
- T045
- T046
phase: Phase 3 - Moteur d'écritures
history:
- timestamp: '2026-10-07T12:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: node-norris
authoritative_surface: apps/api/src/ledger/ports/
create_intent:
- apps/api/src/ledger/status-matrix.ts
- apps/api/src/ledger/ports/config-resolver.ts
- apps/api/src/ledger/ports/account-resolver.ts
- apps/api/test/unit/status-matrix.spec.ts
execution_mode: code_change
owned_files:
- apps/api/src/ledger/status-matrix.ts
- apps/api/src/ledger/ports/**
- apps/api/test/unit/status-matrix.spec.ts
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP09 – Matrice des statuts et ports du moteur

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load node-norris`. Lis `contracts/status-type-matrix.md` et SPECIFICATION §12.1
(tableau « Types acceptés », « Clôture avec soldes restants », « Casse réversible », `wallet_scope = ORGANIZER`).

## Objective

Encoder la matrice « statut de l'événement → types acceptés » sous forme de **données** testées cellule par cellule,
et définir les deux ports dont le service du moteur a besoin : configuration en vigueur et résolution des comptes.

## Context

- Exigences : FR-018, FR-015 (étape 2 : figer la configuration).
- Refus = `VALIDATION_FAILED` **avant** tout appel à la base (la base applique en plus le statut du grand livre).

## Branch Strategy

Planification et merge sur `feat/fondations-grand-livre`. Commande : `spec-kitty agent action implement WP09 --agent claude`.

## Subtasks

### T043 — `status-matrix.ts`

- `isAccepted({ eventStatus, ledgerStatus, type, source, debitPurposes }): { ok: true } | { ok: false; reason }`.
- Données = transcription de `contracts/status-type-matrix.md` : `DRAFT`, `LIVE`, `CLOSING`, `RECONCILING`,
  `SETTLING`, `REFUND_WINDOW`, `CLOSED` (deux variantes selon `ledgerStatus` : `CLOSING` avec soldes restants,
  `LOCKED`). Restrictions de source : synchronisations (`OFFLINE_SYNC`, `EDGE_SYNC`) en `CLOSING`/`RECONCILING`
  pour `PURCHASE`/`TOPUP_CASH`/`DEPOSIT_TAKEN` ; `TOPUP` en `CLOSING` seulement `PSP_WEBHOOK` ; `LOCKED` :
  `BACKOFFICE` seulement ; `CLOSED`/`CLOSING` : `PAYOUT_*` seulement si un compte débité a le `purpose`
  `LEGAL_BREAKAGE` (`debitPurposes`).
- `DRAFT` : `PROMO_CREDIT` seulement en variante préchargement, `DEPOSIT_TAKEN`/`DEPOSIT_REFUNDED` seulement en
  mode `SEPARATE` (paramètres `variant`/`depositMode` transmis par le service).
- `reason` : texte court nommant le statut et le type (va dans `detail`, jamais de SQL).

### T044 — Tests (`test/unit/status-matrix.spec.ts`)

- Table de tests générée : pour chaque statut × chacun des 26 types, l'attendu (accepté / refusé) écrit en clair
  dans le test (pas dérivé de l'implémentation) ; cas de source et de variante en plus.
- Cas obligatoires : `BREAKAGE` refusé en `LIVE` ; `PURCHASE` `ONLINE` refusé en `CLOSING`, accepté en
  `OFFLINE_SYNC` ; `PITCH_FEE` accepté en `SETTLING` seulement ; `LOCKED` + `ADJUSTMENT` `BACKOFFICE` accepté,
  `BATCH` refusé.
- Toute cellule ambiguë dans §12.1 : choisir la lecture stricte, la commenter dans le test et l'ajouter à la section
  « Contradictions et ambiguïtés » de `research.md` en WP13 (FR-024) — noter ici dans un commentaire `// FR-024:`.

### T045 — Port `ConfigResolver` (`ports/config-resolver.ts`)

- `interface ConfigResolver { resolve(input: { ledgerId; eventId?; occurredAt: Date; participationId? }):
  Promise<ResolvedConfig> }` + jeton d'injection NestJS (`CONFIG_RESOLVER = Symbol(...)`) déclaré ici sans module.
- Pas d'implémentation réelle (mission 3) : documenter en tête que la seule implémentation de cette mission est la
  fixture du scénario (WP13) et une fixture minimale de test (WP12).

### T046 — Port de résolution des comptes (`ports/account-resolver.ts`)

- `interface AccountResolver { resolve(ledgerId, refs: AccountRef[], parties): Promise<Map<AccountRef, string>> }`.
- Implémentation SQL fournie ici (fonction pure + requête) : une seule requête par écriture — `SELECT id, code,
  purpose, owner_party_id, wallet_id, participation_id FROM account WHERE ledger_id = $1 AND (code = ANY($2) OR
  purpose = ANY($3))`, puis correspondance en mémoire ; référence introuvable ou ambiguë → erreur
  `VALIDATION_FAILED` (« compte introuvable »). L'exécution de la requête prend un client `pg` en paramètre (fourni
  par `withTenantTx`, WP10) : aucun import du pool ici.

## Definition of Done

- 26 × 7 (+ variantes) assertions vertes ; ports typés, documentés, sans dépendance au pool.

## Risks / Reviewer guidance

- Relire la matrice contre §12.1 ligne à ligne (c'est la règle métier la plus facile à dévoyer en silence).
