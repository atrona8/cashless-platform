---
work_package_id: WP13
title: Rejeu du scénario de référence
dependencies:
- WP12
requirement_refs:
- FR-020
- FR-021
- FR-024
planning_base_branch: feat/fondations-grand-livre
merge_target_branch: feat/fondations-grand-livre
branch_strategy: Planning artifacts for this mission were generated on feat/fondations-grand-livre. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/fondations-grand-livre unless the human explicitly redirects the landing branch.
subtasks:
- T065
- T066
- T067
- T068
- T069
- T070
- T071
phase: Phase 5 - Preuve de bout en bout et CI
history:
- timestamp: '2026-10-07T12:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: node-norris
authoritative_surface: apps/api/test/scenario/
create_intent:
- apps/api/test/scenario/fixture.ts
- apps/api/test/scenario/commands.ts
- apps/api/test/scenario/scenario-config.ts
- apps/api/test/scenario/replay.spec.ts
execution_mode: code_change
owned_files:
- apps/api/test/scenario/**
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP13 – Rejeu du scénario de référence

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load node-norris`. Lis SPECIFICATION §5.8, §12.1 ; `research.md` §R-07, R-08,
R-09 ; `packages/ledger-sql/scenario_reference.json` en entier ; `packages/ledger-sql/gen_golden.py` (comment la
fixture pgTAP est construite) ; `packages/ledger-sql/scenario_reference_test.sql` (fixture générée).

## Objective

Prouver le critère V1 n° 3 : le festival de référence rejoué **par les constructeurs du moteur**, à travers la
connexion applicative, donne exactement les soldes attendus, l'événement finit `CLOSED` et le grand livre
`LOCKED`, et un second rejeu ne crée rien.

## Context

- Exigences : FR-020, FR-021, FR-024, NFR-001, NFR-002, SC-003.
- Projection des statuts (research R-08, vérifiée sur le papier : conditions de passage satisfaites) :
  `DRAFT → LIVE` avant T1 ; T1-T23 `LIVE` ; `CLOSING` puis T24 ; `RECONCILING` puis T25-T29 ; `SETTLING` puis
  T30-T40 ; `REFUND_WINDOW` puis T41-T48 ; `CLOSED` (→ `LOCKED`).
- Cautions (R-07) : T5, T7, T23, T44 passent par `take_deposit`/`refund_deposit`/`forfeit_deposit` ; comparer
  **comptes et montants** seulement (clé, date, mémo produits par la fonction).

## Branch Strategy

Planification et merge sur `feat/fondations-grand-livre`. Commande : `spec-kitty agent action implement WP13 --agent claude`.

## Subtasks

### T065 — Fixture (`fixture.ts`)

- Reproduire en TypeScript la fixture que `gen_golden.py` écrit dans `scenario_reference_test.sql` (parties,
  profil de législation, événement, contrat, grand livre, comptes du JSON avec leurs propriétaires, portefeuilles,
  participations) — **lire** `gen_golden.py` pour reprendre exactement les mêmes valeurs ; exécution par le rôle
  propriétaire, avant le rejeu.
- En plus (pour les cautions) : lots `media_batch` (`deposit_amount = 2000`, mode `SEPARATE` pour W04, `FROM_BALANCE`
  pour W05), supports `media` actifs rattachés aux portefeuilles W04 et W05, `media_assignment` (n = 1). Respecter
  les contraintes du schéma (lire `media_batch`, `media`, `media_assignment` et leurs déclencheurs).
- Comptes chauds : laisser la base poser `hot`/`allow_negative` (déclencheur `account_merchant_hot`).

### T066 — Table des 48 commandes (`commands.ts`, `scenario-config.ts`)

- `scenario-config.ts` : `ConfigResolver` de test construit depuis `parameters` du JSON — taux convertis en points de
  base **depuis le texte** (`0.015` → `150n`, `0.12` → `1200n`, `0.8` → `8000n`) : lire le fichier brut et extraire
  les nombres avec leur texte (pas de `JSON.parse` sur ces valeurs, ou `reviver` avec texte source) ; payeur des frais
  PSP `ORGANIZER` ; frais d'activation 1 000 ; frais de remboursement 500 ; frais prestataire 3 % des recharges payées
  + 500 par bracelet activé (6) ; redevance 20 % ; casse 80 % organisateur ; TVA 18 % ; droits de place FOOD 15 000,
  TEE 10 000.
- `commands.ts` : une entrée par transaction `no` → `{ statusBefore?, command }` où `command` est une **commande
  métier** (montant, portefeuille, participation, canal, compté, etc.), jamais les lignes du JSON. Clés
  d'idempotence et `occurred_at` repris du JSON ; `REVERSAL` T16 → `reversesId` de T15 (résolu à l'exécution par la
  clé `TPE-BAR-01:0003`). Sources reprises du JSON. Auteurs/valideurs `BACKOFFICE` : deux UUID fixes distincts.

### T067 — Comparaison ligne à ligne

- Pour chaque transaction : construire les lignes via le registre, les résoudre en codes de compte, comparer
  **(code, montant)** dans l'ordre aux lignes du JSON avant d'écrire ; écart → échec du test avec le numéro de
  transaction et le diff. Pour les cautions déléguées : comparer après écriture les lignes `posting` produites
  (codes, montants).

### T068 — Passages de statut intercalés

- `set_event_status(event, statut, auteur)` appelé via la connexion **applicative** (`cashless_app`) aux points de
  la projection. Un refus `CL019` est un résultat significatif : faire échouer le test avec le nom de la condition
  et le consigner (T071), ne jamais modifier le scénario pour le contourner.

### T069 — Soldes et clôture (`replay.spec.ts`)

- Après T23 : chaque compte de `expected.after_festival` = solde réel (comptes chauds compris : solde calculé).
- Après T48 : `expected.after_closing` ; puis `CLOSED` ; grand livre `LOCKED` ; `balance_drift` vide ;
  `ledger_invariant.must_be_zero` = 0.

### T070 — Second rejeu

- Rejouer les 48 commandes à l'identique : chaque appel renvoie l'identifiant existant (`replayed: true`, ou sans
  effet pour les cautions) **avant** les passages de statut ? — le grand livre est `LOCKED` : la base refuse
  (`LEDGER_LOCKED`) avant de rejouer ? Vérifier l'ordre de `post_transaction` : le contrôle d'idempotence (étape 3)
  précède le contrôle `LOCKED` (étape 4) ; un rejeu identique doit donc renvoyer la transaction existante même
  verrouillé, mais la **matrice** du moteur refuse avant d'appeler la base. Décision à appliquer : le second rejeu
  se fait sur une **seconde base** rejouée jusqu'à T48 puis rejouée une seconde fois **avant** `CLOSED`, et un test
  séparé vérifie le rejeu après `LOCKED` directement par `post_transaction` (comportement de la base). Compter
  `journal_transaction` et `posting` : inchangés. Consigner ce choix (T071).

### T071 — Consignation des contradictions

- Ajouter à `kitty-specs/fondations-grand-livre-01M4AY8M/research.md` une section « Contradictions constatées à
  l'implémentation » (hors carte : fichier de mission, justifié par FR-024) : R-07 confirmé ou non, toute cellule
  ambiguë de la matrice (WP09), le choix du second rejeu (T070), tout `CL019` rencontré.

## Definition of Done

- `npm test -w @cashless/api -- scenario` vert sur base fraîche : 0 écart aux deux points de contrôle, `CLOSED`,
  `LOCKED`, second rejeu = 0 transaction et 0 ligne.

## Risks / Reviewer guidance

- Vérifier qu'aucune ligne du JSON n'est passée telle quelle à `post_transaction` (seulement utilisée pour comparer).
- Durée du test : base recréée une ou deux fois ; rester sous 2 minutes.
