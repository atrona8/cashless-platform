---
work_package_id: WP04
title: Base des dettes de la 9a (OP-N130, OP-N128)
dependencies: []
requirement_refs:
- FR-018
- FR-019
planning_base_branch: feat/versements-rapprochements-cloture
merge_target_branch: feat/versements-rapprochements-cloture
branch_strategy: Planning artifacts for this mission were generated on feat/versements-rapprochements-cloture. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/versements-rapprochements-cloture unless the human explicitly redirects the landing branch.
subtasks: [T017, T018, T019]
phase: Phase 1 - Fondations
agent: claude
history:
- timestamp: '2026-11-17T12:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: packages/ledger-sql/
create_intent: [packages/ledger-sql/migrations/0086_refund_debts.sql, packages/ledger-sql/tests/tests_refund_transitions.sql]
execution_mode: code_change
model: sonnet
owned_files: [packages/ledger-sql/migrations/0086_refund_debts.sql, packages/ledger-sql/tests/tests_refund_transitions.sql]
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP04 : Base des dettes de la 9a (OP-N130, OP-N128)

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role :
implementer / Agent : claude). Lis ensuite la fiche commune
`docs/passation-9b/fiche-implementation.md`, ce prompt, puis seulement :

- `contracts/interfaces.md` : tableau « Base de données » (ligne `refund_request_transition_guard`) ;
  `data-model.md` : « `refund_request` (OP-N130, R-10) » avec son graphe, « Fonctions SQL » ;
  `research.md` R-10 (OP-N128, OP-N130) ; `spec.md` FR-018, FR-019 ;
- `packages/ledger-sql/migrations/0081_refund_requests.sql` l. 14-135 (colonnes, CHECK, index unique,
  garde d'insertion, `promote_due_refund_requests`) ;
- `migrations/0036_cash_sessions.sql` l. 640-700 (`refund_deposit_for_session` et
  `refund_cash_due_for_session`, qui porte déjà `p_actor` et `p_approver` : le modèle) ;
  `schema_grand_livre_cashless.sql` l. 1626-1647 (`refund_deposit`, `post_transaction` l. 510-516) ;
- `apps/api/src/refunds/` : les cinq `UPDATE refund_request` existants (`refund-requests.service.ts`
  l. 232, `refund-confirm.service.ts` l. 107 et 145, `holder-challenge.service.ts` l. 136,
  `wallet-refund-action.ts` l. 140 et 231) : le déclencheur doit tous les laisser passer ;
- `post-roles.sql` l. 1066-1081 (liste des colonnes modifiables par `cashless_app`, section 11) ;
- `tests/tests_refund_requests.sql` (famille 1 : modèle de suite et fixtures), `tests/tests_cash_sessions.sql`
  l. 194-202 et 513-592 (appels de `refund_deposit_for_session`).

Priorité des sources (SPECIFICATION §0.3). Contradiction : tu la signales. `interfaces.md` fait foi.

## Objective

Lever les dettes de base de la 9a en une migration `0086` : (OP-N130) un déclencheur qui n'accepte que le
graphe de transitions d'une demande de remboursement et fige montant et frais après `PROCESSING` ;
(OP-N128) une variante de `refund_deposit_for_session` qui transmet l'auteur et le valideur jusqu'à
`post_transaction`, pour que `DEPOSIT_REFUNDED` porte `approved_by`. Aucun droit accordé (WP06). WP11
bascule l'appel TypeScript.

## Branch Strategy

- Branche de planification et de fusion : `feat/versements-rapprochements-cloture`.
- Worktree alloué par lane, calculé dans `lanes.json`.
- Commande : `LC_ALL=C LANG=C spec-kitty agent action implement WP04 --agent claude --mission
  versements-rapprochements-cloture-01M7JT4G`.

## Périmètre et arbitrages

- Fichiers : uniquement ceux d'`owned_files`. Jamais un `.sql` généré ni `schema_grand_livre_cashless.sql`.
  **Aucun GRANT** (WP06 posera `EXECUTE` sur la nouvelle signature et retirera le droit de la fonction de
  déclencheur). `REVOKE ALL … FROM PUBLIC` sur toute fonction nouvelle.
- **Figeage** : « figés après `REQUESTED` » (OP-N130) est faux pour le code actuel : l'approbation
  recalcule montant et frais au passage `REQUESTED` → `PROCESSING` (`wallet-refund-action.ts` l. 231). Le
  contrat de la mission est « figés après `PROCESSING` » (contradiction 3 de `research.md`, spec amendée).
- **Ancienne signature** `refund_deposit_for_session(uuid, uuid)` **conservée** : WP11 bascule l'appel,
  puis une mission ultérieure la retire. Elle délègue à la nouvelle avec auteur et valideur nuls. Les
  suites existantes (`tests_cash_sessions.sql`) restent vertes sans modification.
- Toute redéfinition d'une fonction existante (`refund_deposit`) repose `SET search_path = public,
  pg_temp` : `tests_definer_search_path.sql` échoue si `CREATE OR REPLACE` efface le réglage.
- Pas de garde d'insertion nouvelle : `data-model.md` ne la prévoit pas et des suites de la 9a (hors carte)
  insèrent des états terminaux comme fixtures. Signale-la comme proposition de renforcement (un `INSERT`
  direct en `PAID` reste possible à `cashless_app`, sous les CHECK existants).
- Risque à signaler : des tests de la 9a (pgTAP ou Jest de `apps/api/test/integration/refunds/`) peuvent
  forcer des transitions hors graphe par le propriétaire. Tu ne les modifies pas ; WP11 et l'orchestrateur
  les adaptent. Dis lesquels échouent.

## Subtasks

### T017 : 0086, `refund_request_transition_guard`

Fonction de déclencheur `BEFORE UPDATE ON refund_request FOR EACH ROW`, nom figé
`refund_request_transition_guard` (déclencheur du même nom). Elle compare `OLD` et `NEW`.
1. **Changement de statut** : seules ces paires passent (graphe de `data-model.md`) :
   `AWAITING_HOLDER` → `REQUESTED`, `AWAITING_HOLDER` → `BLOCKED`, `REQUESTED` → `PROCESSING`,
   `REQUESTED` → `REJECTED`, `PROCESSING` → `PAID`, `PROCESSING` → `FAILED`. Toute autre paire (dont toute
   sortie d'un état terminal `PAID`, `FAILED`, `REJECTED`, `BLOCKED`, `CANCELLED`, et tout passage vers
   `CANCELLED`) : `RAISE EXCEPTION … USING ERRCODE = 'CL029'` (`CONFLICT_STATE`, déjà mappé).
2. **`AWAITING_HOLDER` → `REQUESTED`** : soit `holder_decision = 'CONFIRM'` (décision du titulaire), soit
   `holder_decision` nul et `hold_until <= clock_timestamp()` (promotion, `promote_due_refund_requests`).
   Une promotion avant l'échéance est refusée.
3. **Montant et frais** : `estimated_amount` et `fee` ne changent qu'au passage `REQUESTED` → `PROCESSING`.
   Après, tout changement est refusé (`CL029`).
4. **Colonnes d'identité immuables** à tout `UPDATE` : `id`, `operator_id`, `ledger_id`, `event_id`,
   `wallet_id`, `customer_id`, `requested_by`, `method`, `msisdn`, `iban`, `new_number`, `currency`,
   `hold_until`, `extra_check_required`, `created_at`.
5. **Sans changement de statut** : seuls `approval_request_id` et `updated_at` peuvent changer (cas de
   `wallet-refund-action.ts` l. 140, qui pose le lien de l'approbation sur une demande `REQUESTED`). Un état
   terminal ne change plus du tout.
- Le déclencheur ne lève pas pour une écriture identique (aucune colonne changée).
- Cas limites : promotion exactement à l'échéance ; décision `CONFIRM` après l'échéance ; `PROCESSING` →
  `REQUESTED` (retour) ; `PAID` → `FAILED` ; `FAILED` → `PROCESSING` (le recrédit d'un `FAILED` est une
  écriture au grand livre, pas une transition) ; montant changé à `PROCESSING` → `PAID`.

### T018 : 0086, `refund_deposit_for_session(…, p_actor, p_approver)` et `refund_deposit`

- `refund_deposit(p_media uuid, p_money_account uuid, p_actor uuid, p_approver uuid)` : nouvelle fonction
  (surcharge, sans valeurs par défaut pour ne pas rendre `refund_deposit(uuid, uuid)` ambigu), corps de
  `refund_deposit` d'origine, avec `p_created_by => p_actor` et `p_approved_by => p_approver` passés à
  `post_transaction`. DEFINER, `assert_tenant(tenant_of_media(...))`, `SET search_path = public, pg_temp`.
- `refund_deposit(p_media uuid, p_money_account uuid DEFAULT NULL)` d'origine : redéfinie par
  `CREATE OR REPLACE` pour **déléguer** à la nouvelle avec `NULL, NULL` (un seul corps), même signature,
  `search_path = public, pg_temp`.
- `refund_deposit_for_session(p_media uuid, p_session uuid, p_actor uuid, p_approver uuid)` : copie de la
  fonction d'origine (`0036` l. 659-674) qui appelle la nouvelle `refund_deposit` ; l'ancienne
  `refund_deposit_for_session(uuid, uuid)` est redéfinie pour déléguer avec `NULL, NULL`.
- Auteur obligatoire quand un valideur est passé ; auteur et valideur distincts (sinon `CL001`).
  `DEPOSIT_REFUNDED` garde source `ONLINE`, même clé d'idempotence (`deposit-refund:<media>:<n>`).
- Cas limites : bracelet sans caution (`NONE`, `DUE`) : retour sans écriture, comme aujourd'hui ; caution
  `FROM_BALANCE` (recréditée sur le portefeuille) ; session d'un autre prestataire (`P0002`) ; rejeu.

### T019 : pgTAP `tests_refund_transitions.sql`

Mêmes conventions que `tests_refund_requests.sql` (BEGIN, `_grants_for_tests.sql`, `no_plan`, propriétaire,
fixtures par `pg_temp.id`).
- **Chaque transition interdite** refusée, une assertion nommée par paire (les 6 autorisées passent) :
  toutes les paires hors graphe parmi les 8 statuts, sorties des états terminaux, `CANCELLED` ;
- promotion permise (`promote_due_refund_requests()` rend 1 après l'échéance, 0 avant) ; décision
  `CONFIRM` / `BLOCK` permise ; `REQUESTED` → `PROCESSING` avec montant et frais **recalculés** permis ;
  même changement après `PROCESSING` refusé ; chaque colonne d'identité immuable ; `approval_request_id`
  modifiable sur `REQUESTED` ; un état terminal ne change plus ;
- `refund_deposit_for_session` à quatre arguments : la transaction `DEPOSIT_REFUNDED` porte `created_by` et
  `approved_by` ; à deux arguments : comportement d'avant (`NULL`) ; auteur égal au valideur : refus ;
  `refund_deposit` à deux et à quatre arguments se comportent pareil ; isolation entre prestataires.

## Tests et preuves

Depuis la lane (`cd <lane> || exit 1`), base `cashless_wp04`, serveur 5433 (`docker ps`) :

```bash
export PGHOST=127.0.0.1 PGPORT=5433 PGUSER=postgres PGDATABASE=cashless_wp04
R=/Users/xaamga/Documents/omar_sylla_work/cashless/cashless-platform
export PATH=$R/docs/passation-9a/scripts/bin:/Library/PostgreSQL/18/bin:$PATH
bash packages/ledger-sql/scripts/reset-db.sh
cd packages/ledger-sql
pg_prove -d cashless_wp04 tests/tests_refund_transitions.sql tests/tests_refund_requests.sql \
  tests/tests_cash_sessions.sql tests/tests_definer_search_path.sql
pg_prove -d cashless_wp04 tests_grand_livre_cashless.sql scenario_reference_test.sql
```

Preuves : FR-018 (une assertion par transition interdite, promotion et recalcul permis), FR-019 pour
OP-N128 (`approved_by` sur `DEPOSIT_REFUNDED`) ; suites existantes vertes ; suites générées intactes.

## Definition of Done

- [ ] `0086` : déclencheur de transitions (graphe, figeage, identité), `refund_deposit` à quatre arguments,
      `refund_deposit_for_session` à quatre arguments, anciennes signatures conservées qui délèguent ;
      `search_path` figé ; aucun GRANT.
- [ ] `tests_refund_transitions.sql` vert, une assertion par transition interdite.
- [ ] `tests_refund_requests.sql`, `tests_cash_sessions.sql`, `tests_definer_search_path.sql` et suites
      générées verts ; sinon la liste précise des assertions en cause est dans le compte rendu.
- [ ] Compte rendu : figeage après `PROCESSING`, garde d'insertion proposée, tests de la 9a touchés,
      fichiers à relire.

## Ce que le relecteur doit casser

- Toute paire de statuts hors graphe, par `UPDATE` du propriétaire ou par une fonction DEFINER ; une
  écriture qui change deux colonnes à la fois pour passer (statut + montant à `PROCESSING` → `PAID`).
- `promote_due_refund_requests` qui promeut avant l'échéance ou une demande déjà `BLOCKED` ; la décision
  `CONFIRM` d'une demande non `AWAITING_HOLDER`.
- Le chemin `REQUESTED` → `PROCESSING` de `wallet-refund-action.ts` (recalcul du montant) : il doit passer ;
  la pose d'`approval_request_id` sur `REQUESTED` : elle doit passer. Essaie les cinq `UPDATE` du code.
- Changement de `wallet_id`, `iban`, `msisdn`, `requested_by`, `hold_until` après création.
- `refund_deposit` à deux arguments qui diverge de celle à quatre ; appel ambigu (`refund_deposit(a, NULL)`) ;
  `DEPOSIT_REFUNDED` encore sans `approved_by` par le chemin de la guichetière ; auteur égal au valideur.
- Fonction DEFINER sans `search_path` à `pg_temp` après `CREATE OR REPLACE` ; exécutable par PUBLIC ;
  un `.sql` généré modifié ; un GRANT introduit.

## Fichiers à faire relire par une personne

- `packages/ledger-sql/migrations/0086_refund_debts.sql` : `refund_request_transition_guard` (graphe,
  figeage, immuables) et les fonctions `refund_deposit*` (transmission de l'auteur et du valideur).
