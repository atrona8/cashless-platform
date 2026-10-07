---
work_package_id: WP12
title: Service du moteur d'écritures
dependencies:
- WP08
- WP09
- WP10
requirement_refs:
- FR-013
- FR-014
- FR-015
- FR-018
planning_base_branch: feat/fondations-grand-livre
merge_target_branch: feat/fondations-grand-livre
branch_strategy: Planning artifacts were generated on feat/fondations-grand-livre; completed changes must merge back into feat/fondations-grand-livre.
subtasks:
- T060
- T061
- T062
- T063
- T064
phase: Phase 4 - API
history:
- timestamp: '2026-10-07T12:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: node-norris
authoritative_surface: apps/api/src/ledger/db/
create_intent:
- apps/api/src/ledger/ledger-engine.service.ts
- apps/api/src/ledger/ledger.module.ts
- apps/api/src/ledger/db/ledger-queries.ts
- apps/api/test/integration/engine/engine.spec.ts
- apps/api/test/integration/engine/mini-fixture.ts
execution_mode: code_change
owned_files:
- apps/api/src/ledger/ledger-engine.service.ts
- apps/api/src/ledger/ledger.module.ts
- apps/api/src/ledger/db/**
- apps/api/test/integration/engine/**
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP12 – Service du moteur d'écritures

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load node-norris`. Lis SPECIFICATION §5.4 (ordre de traitement et signature de
`post_transaction`), `contracts/engine-command.md`, et dans le schéma : `post_transaction`, `take_deposit`,
`refund_deposit`, `forfeit_deposit`, `refund_cash_due`, `preload_media`, `wallet_topup_headroom`.

## Objective

Le seul composant applicatif qui écrit au grand livre : il applique la matrice, résout la configuration et les
comptes, lit les soldes si besoin, appelle le constructeur puis `post_transaction` (ou la fonction déléguée), et
renvoie l'identifiant de transaction (nouveau ou rejoué) ou un code d'erreur stable.

## Context

- Exigences : FR-013, FR-014, FR-015, FR-018 (application), C-001, NFR-001.
- Le service travaille **dans** une transaction ouverte par l'appelant : signature
  `execute(client, command): Promise<{ transactionId: string; replayed: boolean }>` (le client vient de
  `TenantTx.run` ou d'`IdempotentTx.run`).

## Branch Strategy

Planification et merge sur `feat/fondations-grand-livre`. Commande : `spec-kitty agent action implement WP12 --agent claude`.

## Subtasks

### T060 — `LedgerEngineService.execute`

Ordre (§5.4) :
1. Valider la commande (champs communs ; `BACKOFFICE` ⇒ auteur ≠ valideur ; `REVERSAL` ⇒ `reversesId`).
2. Lire grand livre et événement (`ledger.status`, `ledger.currency`, `event.status`, `wallet_scope`) en une
   requête ; devise différente → `VALIDATION_FAILED` ; matrice (`isAccepted`) → refus `VALIDATION_FAILED` avec
   `detail`.
3. `ConfigResolver.resolve(…occurredAt)` → `ResolvedConfig` (version figée).
4. Lire les soldes **seulement** si nécessaire (T062) ; `REVERSAL` : lire les lignes d'origine
   (`posting` de `reversesId`, ordre `line_no`).
5. Constructeur du registre → `Line[]` ; contrôle ≥ 2 lignes, somme 0, aucun zéro (`VALIDATION_FAILED` sinon).
6. `AccountResolver` → identifiants ; `post_transaction(p_ledger, p_type, p_key, p_occurred, p_source, p_lines,
   p_event, p_reverses, p_created_by, p_approved_by, p_config_version, p_device, p_media, p_metadata)` avec
   `p_lines` = `[{account_id, amount, memo}]` (montants passés en **texte** puis `::bigint` côté SQL pour éviter
   toute conversion `number`).
7. Rendre le résultat (T063).

### T061 — Délégation

- `DEPOSIT_TAKEN` → `SELECT take_deposit($media, $moneyAccount)` ; `DEPOSIT_REFUNDED` → `refund_deposit` ;
  `DEPOSIT_FORFEITED` → `forfeit_deposit` ; `WALLET_REFUND` variante espèces dues → `refund_cash_due($media,
  $cashAccount, $key, $actor, $approver, $device)` ; `PROMO_CREDIT` variante préchargement → `preload_media`.
- Identifiant de transaction des fonctions qui ne le renvoient pas (`take_deposit` renvoie un statut) : relire par
  `(ledger_id, idempotency_key)` avec la clé interne (`deposit:<media>:<n>`…, voir les fonctions) ; si la fonction
  n'a rien écrit (`NONE`, `DUE`, déjà `HELD`) → `{ transactionId: null, replayed: false, outcome }` (élargir le type
  de retour en conséquence et le documenter).

### T062 — Soldes pour la répartition et le découpage

- `PURCHASE` : soldes des comptes `WALLET_PROMO` et `WALLET_PAID` du portefeuille (`account_balance`, convention
  signée → convertir en « disponible » = `-balance`).
- `TOPUP_CASH` : `wallet_topup_headroom(wallet, occurred_at)` **dans la même transaction** que l'écriture (la fonction
  verrouille le solde) ; NULL = pas de plafond.
- `CHARGEBACK`, `BREAKAGE`, `PROMO_EXPIRY`, `PITCH_FEE` (`DEDUCT_CAPPED`), `MERCHANT_DEBT_TRANSFER` : soldes
  nécessaires lus ici. Les comptes chauds n'ont pas de cache : utiliser la vue ou la fonction de solde du schéma
  prévue pour eux (lire le schéma ; ne pas sommer `posting` à la main si une fonction existe).

### T063 — Résultat et erreurs

- `post_transaction` renvoie l'identifiant ; « rejoué » = l'identifiant existait avant l'appel (lire
  `journal_transaction` par `(ledger_id, idempotency_key)` avant l'appel, dans la même transaction, ou comparer
  `recorded_at` ; choisir la méthode sans course et la commenter).
- `BuildError` → `ProblemException(code)` ; erreurs SQL laissées remonter au filtre (WP10).
- `ledger.module.ts` : fournit `LedgerEngineService`, `AccountResolver` (implémentation SQL de WP09) ; attend
  `CONFIG_RESOLVER` fourni par le module appelant (aucune implémentation de production dans cette mission).

### T064 — Tests d'intégration (`test/integration/engine/`)

- `mini-fixture.ts` : un prestataire, un organisateur, un commerçant externe (commission 12 %), un événement `LIVE`,
  un grand livre, comptes nécessaires, deux portefeuilles, un lot avec caution `SEPARATE` et un support ; posée par
  le rôle propriétaire. `ConfigResolver` de test en mémoire.
- Cas : vente 6 000 → 5 lignes exactes et soldes ; vente 7 000 avec 5 400 → `INSUFFICIENT_FUNDS`, aucune ligne ;
  même commande rejouée → même id, `replayed: true` ; même clé autre montant → `IDEMPOTENCY_KEY_REUSED` (`CL002`) ;
  événement `DRAFT` + `PURCHASE` → `VALIDATION_FAILED` sans appel à la base (compter les transactions) ;
  `REVERSAL` exact ; caution déléguée (`take_deposit`) puis seconde demande sans effet ; aucun `INSERT` direct
  dans `journal_transaction`/`posting` depuis `src/` (recherche textuelle).

## Definition of Done

- Tests verts ; le service est le seul appelant de `post_transaction` dans `src/` (test d'architecture : recherche
  textuelle de `post_transaction(` hors `ledger/`).

## Risks / Reviewer guidance

- Aucun montant ne passe par `number` (ni en paramètre SQL, ni en lecture).
- Une seule requête d'écriture par commande (NFR « un aller-retour SQL d'écriture »).
