---
work_package_id: WP03
title: Base des versements
dependencies: []
requirement_refs:
- FR-009
- FR-010
- FR-012
- NFR-001
planning_base_branch: feat/versements-rapprochements-cloture
merge_target_branch: feat/versements-rapprochements-cloture
branch_strategy: Planning artifacts for this mission were generated on feat/versements-rapprochements-cloture. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/versements-rapprochements-cloture unless the human explicitly redirects the landing branch.
subtasks: [T013, T014, T015, T016]
phase: Phase 1 - Fondations
agent: claude
history:
- timestamp: '2026-11-17T12:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: packages/ledger-sql/
create_intent: [packages/ledger-sql/migrations/0085_payouts.sql, packages/ledger-sql/tests/tests_payouts.sql]
execution_mode: code_change
model: sonnet
owned_files: [packages/ledger-sql/migrations/0085_payouts.sql, packages/ledger-sql/tests/tests_payouts.sql]
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP03 : Base des versements

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role :
implementer / Agent : claude). Lis ensuite la fiche commune
`docs/passation-9b/fiche-implementation.md`, ce prompt, puis seulement :

- `contracts/interfaces.md` : tableau « Base de données » (lignes `payout`, `CL055`), « Ordre des
  verrous » ; `data-model.md` : « `payout` », « Fonctions SQL », « Invariants » 2 et 3 ;
- `research.md` R-06, R-07 ; `spec.md` FR-009, FR-010, FR-012, NFR-001, SC-002 ;
- `schema_grand_livre_cashless.sql` : `journal_transaction` l. 428-457 (CHECK `BACKOFFICE` : auteur et
  valideur distincts), `post_transaction` l. 510-600 (lignes : montant positif = débit, négatif =
  crédit), `payout` l. 824-840, `party_position` l. 934-937, comptes `L-VERS-ENCOURS` et `L-*-VERS`
  (`migrations/0008_event_ledger.sql` l. 57-78) ;
- `apps/api/src/ledger/builders/closing/payout.ts` l. 18-92 (les trois constructeurs : la fonction SQL
  doit produire les mêmes lignes), `apps/api/src/ledger/builders/festival/refund.ts` l. 26-30
  (`moneyAccountFor`) ;
- `tests_grand_livre_cashless.sql` l. 548 et 565-592 (test existant du CHECK de `payout` et exemples de
  transactions `PAYOUT_*`) ; `scenario_reference.json` `expected.after_closing` (ORG-VERS 39225 ;
  OPE-VERS 4000) ;
- `0081_refund_requests.sql` (modèle de colonnes, CHECK, garde) ; `tests/tests_refund_requests.sql` en
  tête (modèle de suite).

Priorité des sources (SPECIFICATION §0.3). Contradiction : tu la signales. `interfaces.md` fait foi.

## Objective

Migration `0085` : étendre `payout` (destination, résultat, lot) et la fermer par un déclencheur de
transitions ; `create_payout_batch`, qui relit le droit net sous verrou et refuse tout montant au-delà
(`CL055`) avant d'écrire `PAYOUT_INITIATED` et les lignes ; `settle_payout`, qui écrit `PAYOUT_CONFIRMED`
ou `PAYOUT_FAILED` une seule fois par ligne. Aucun droit accordé (WP06). Aucune route.

## Branch Strategy

- Branche de planification et de fusion : `feat/versements-rapprochements-cloture`.
- Worktree alloué par lane, calculé dans `lanes.json`.
- Commande : `LC_ALL=C LANG=C spec-kitty agent action implement WP03 --agent claude --mission
  versements-rapprochements-cloture-01M7JT4G`.

## Périmètre et arbitrages

- Fichiers : uniquement ceux d'`owned_files`. Jamais un `.sql` généré ni `schema_grand_livre_cashless.sql`.
  **Aucun GRANT** (WP06). Fonctions : `REVOKE ALL … FROM PUBLIC`, DEFINER,
  `SET search_path = public, pg_temp`, `assert_tenant`. Aucun `DELETE`. Le test existant de la ligne 548
  (CHECK `payout_check`) doit rester vert : ne renomme ni ne retire ce CHECK.
- Colonnes ajoutées (`data-model.md`) : `approval_request_id`, `msisdn`, `iban`, `failure_reason`,
  `confirmed_by`, `confirmed_at`. **Manque dans `data-model.md`** : le compte à recréditer en cas d'échec
  n'est stocké nulle part. Ajoute `origin_account_id uuid REFERENCES account(id)` (compte débité à
  l'initiation) et signale-le à l'orchestrateur ; sans lui `settle_payout` ne peut pas recréditer sans
  ambiguïté (deux lignes de même montant sur un même bénéficiaire).
- Moyens : `CASH` **refusé** par `create_payout_batch` (`CL047`, `VALIDATION_FAILED`) : aucun compte
  d'argent de sortie ne lui correspond (`A-BANQUE`, `A-PSP-WAVE`, `A-PSP-OM` seulement). Signale-le : le
  CHECK d'origine de `payout.method` garde `CASH`.
- Bénéficiaire `LEGAL` (compte `L-LEGAL-CASSE`, sans titulaire) : `payout.beneficiary_id` est NOT NULL.
  Choix à signaler, ne le tranche pas en silence : la ligne porte la partie du prestataire
  (`operator_id`) ; la borne se lit alors sur le solde créditeur de `L-LEGAL-CASSE`, pas sur
  `party_position`. Si tu juges ce choix risqué, refuse `LEGAL` (`CL047`) et dis-le.
- Source des écritures de résultat : `PAYOUT_CONFIRMED` et `PAYOUT_FAILED` en `BACKOFFICE` exigent deux
  personnes distinctes (CHECK de `journal_transaction`) alors que `confirmPayout` est une action seule.
  Écris-les avec `created_by = p_actor` et `approved_by` = le valideur du lot (`payout.approved_by`), ou
  `payout.initiated_by` si le valideur est `p_actor`. Signale ce choix.
- Ordre des verrous (`interfaces.md`) : autorité du grand livre, puis comptes du bénéficiaire par ordre
  d'identifiant, puis la ligne `payout`. Aucun verrou d'autorité exclusif ici.

## Subtasks

### T013 : 0085, colonnes, CHECK, déclencheur de transition

- Colonnes de `data-model.md` plus `origin_account_id`. CHECK : `BANK_TRANSFER` exige `iban` (et pas de
  `msisdn`) ; `WAVE`/`ORANGE_MONEY` exigent `msisdn` (et pas d'`iban`) ; `failure_reason` si et seulement
  si `FAILED` ; `confirmed_by`/`confirmed_at` posés si et seulement si le statut n'est plus `INITIATED` ;
  `external_ref` non vide si `CONFIRMED`. Index unique `(approval_request_id, beneficiary_id)`.
- Déclencheur `BEFORE UPDATE` : seul `INITIATED` → `CONFIRMED` ou `FAILED`, **une fois** ; seules les
  colonnes de résultat (`status`, `external_ref`, `failure_reason`, `confirmed_by`, `confirmed_at`,
  `settled_at`, `settled_tx_id`) changent ; tout le reste est immuable. Déclencheur `BEFORE DELETE` qui
  refuse. Fonction de déclencheur sans droit pour personne (WP06).
- L'IBAN est une donnée personnelle : stocké normalisé (majuscules, sans espaces) par l'API ; la base n'en
  valide que la présence. Il ne figure dans aucun message d'erreur ni `RAISE` de la migration.
- Validation : chaque CHECK, chaque transition interdite (`CONFIRMED` → `FAILED`, retour à `INITIATED`,
  modification du montant), le DELETE, le test existant de la ligne 548.

### T014 : 0085, `create_payout_batch`

`create_payout_batch(p_ledger uuid, p_approval_request uuid, p_lines jsonb, p_actor uuid, p_approver
uuid)` rend `jsonb {transaction_id, payout_ids[]}`. Chaque ligne : `beneficiary` (`{participation_id}`,
`ORGANIZER`, `OPERATOR`, `PLATFORM`, `LEGAL`), `beneficiary_id` (partie), `amount`, `method`, `msisdn` ou
`iban`.
1. `assert_tenant(tenant_of_ledger(p_ledger))` ; auteur et valideur non nuls et distincts ; lot non vide,
   montants strictement positifs, une seule ligne par bénéficiaire.
2. Verrou consultatif du lot `pg_advisory_xact_lock(hashtextextended('payout-batch:' ||
   p_approval_request, 0))` ; lot déjà écrit (lignes `payout` de cette demande) : rend le résultat
   existant sans rien écrire (rejeu ; NFR-001).
3. Verrouille **tous les comptes de droits du bénéficiaire** (`FOR UPDATE`, famille `CLAIM`, titulaire =
   la partie, par identifiant croissant ; pour un lot, tous les bénéficiaires dans un seul parcours
   ordonné), puis relis `party_position.net_claim` et la somme des `payout` `INITIATED` du bénéficiaire.
4. Refus `montant + versements INITIATED non réglés > net_claim` par `RAISE EXCEPTION … USING ERRCODE =
   'CL055'` (message avec les montants, jamais l'IBAN). Le test du plan : 40 000 pour un droit net de
   39 225 refusé.
5. `post_transaction(p_ledger, 'PAYOUT_INITIATED', 'payout-batch:' || p_approval_request, clock_timestamp(),
   'BACKOFFICE', lignes, …, p_created_by => p_actor, p_approved_by => p_approver, p_metadata =>
   {approval_request_id})` : un débit par bénéficiaire (compte de droits : `L-MCH-<participation>`,
   `L-ORG-VERS`, `L-OPE-VERS`, `L-PLT-VERS`, `L-LEGAL-CASSE`), un crédit du total sur `L-VERS-ENCOURS`
   (mêmes lignes que `buildPayoutInitiated`).
6. Une ligne `payout` par bénéficiaire : `INITIATED`, `initiated_tx_id`, `origin_account_id`,
   `initiated_by = p_actor`, `approved_by = p_approver`, destination.
- Cas limites : bénéficiaire sans compte de droits ; montant égal au droit net (admis) ; droit net négatif ;
  deux lots successifs qui cumulent au-delà du droit (refus du second) ; un lot dont une seule ligne dépasse
  (aucune ligne écrite, aucune transaction) ; commerçant à plusieurs participations (le droit net somme ses
  comptes).

### T015 : 0085, `settle_payout`

`settle_payout(p_payout uuid, p_outcome text, p_ref text, p_reason text, p_actor uuid)` rend la ligne
`payout`.
1. `assert_tenant` ; ligne verrouillée `FOR UPDATE` ; `p_outcome` dans `CONFIRMED`/`FAILED`.
2. Statut déjà réglé : même résultat et même référence : rend la ligne (rejeu) ; sinon `CL029`
   (`CONFLICT_STATE`). Une ligne ne change de statut qu'**une fois**.
3. `CONFIRMED` : `p_ref` non vide ; `PAYOUT_CONFIRMED` (clé `payout:<id>:settle`), débit `L-VERS-ENCOURS`,
   crédit du compte d'argent du moyen (`A-BANQUE`, `A-PSP-WAVE`, `A-PSP-OM`), comme `buildPayoutConfirmed`.
   `FAILED` : `p_reason` non vide ; `PAYOUT_FAILED`, débit `L-VERS-ENCOURS`, crédit `origin_account_id`
   (le droit est recrédité), comme `buildPayoutFailed`.
4. Mise à jour de la ligne : statut, référence ou motif, `settled_at`, `settled_tx_id`, `confirmed_by`,
   `confirmed_at`.
- Cas limites : référence vide ; motif vide ; paiement d'un autre grand livre (refus) ; confirmation
  simultanée de la même ligne (une seule écriture).

### T016 : pgTAP `tests_payouts.sql`

Mêmes conventions que `tests_refund_requests.sql` (propriétaire, `no_plan`). Fixtures : un prestataire, un
organisateur, deux commerçants avec participations, un grand livre avec droits nets (dont 39 225 pour
l'organisateur, 4 000 pour le prestataire).
- Borne : 40 000 refusé (`CL055`), 39 225 admis ; deux lots qui cumulent au-delà : le second refusé ;
  versement `FAILED` : le droit redevient disponible et un nouveau lot passe ; un lot dont une ligne
  dépasse n'écrit rien ; bénéficiaires multiples dans un lot ; `CASH` refusé ; `LEGAL` selon ton choix.
- Transitions : `INITIATED` → `CONFIRMED`, → `FAILED`, une seule fois, pas de retour, pas de DELETE, colonnes
  immuables ; deux personnes distinctes (CHECK de la ligne et de la transaction).
- Écritures : transaction `PAYOUT_INITIATED` égale (lignes) à celle de `buildPayoutInitiated` ; confirmation
  et échec produisent les écritures attendues ; somme de chaque transaction nulle ; rejeu de
  `create_payout_batch` et de `settle_payout` sans nouvelle écriture.
- Isolation : prestataire B ne voit ni ne règle les lignes de A (RLS, `assert_tenant`).

## Tests et preuves

Depuis la lane (`cd <lane> || exit 1`), base `cashless_wp03`, serveur 5433 (`docker ps`) :

```bash
export PGHOST=127.0.0.1 PGPORT=5433 PGUSER=postgres PGDATABASE=cashless_wp03
R=/Users/xaamga/Documents/omar_sylla_work/cashless/cashless-platform
export PATH=$R/docs/passation-9a/scripts/bin:/Library/PostgreSQL/18/bin:$PATH
bash packages/ledger-sql/scripts/reset-db.sh
cd packages/ledger-sql
pg_prove -d cashless_wp03 tests/tests_payouts.sql tests/tests_definer_search_path.sql
pg_prove -d cashless_wp03 tests_grand_livre_cashless.sql scenario_reference_test.sql
```

Preuves : FR-009, FR-010, FR-012, SC-002 (borne), NFR-001 (une écriture par ligne et par lot) ; suites
générées vertes et intactes (`git diff --stat`). La concurrence à 50 est prouvée en WP08.

## Definition of Done

- [ ] `0085` : colonnes (dont `origin_account_id`), CHECK, déclencheurs de transition et de DELETE,
      `create_payout_batch` (borne `CL055`), `settle_payout`, DEFINER avec `assert_tenant`,
      `search_path` figé ; aucun GRANT.
- [ ] `tests_payouts.sql` vert ; test existant du CHECK de `payout` et suites générées inchangés et verts.
- [ ] Compte rendu : `origin_account_id`, `CASH`, `LEGAL`, source des écritures de résultat, parité avec
      les constructeurs TypeScript (logique de comptes dupliquée), fichiers à relire.

## Ce que le relecteur doit casser

- Montant au-delà du droit net : seul, par lot multi-lignes, par deux lots successifs, avec un `FAILED`
  qui recrédite, avec un commerçant à plusieurs participations, avec un droit net qui baisse entre deux
  appels ; deux sessions qui créent chacune un lot de 30 000 sur 39 225 (un seul doit passer : cherche un
  verrou manquant sur les comptes).
- Interblocage : deux lots croisés sur les mêmes bénéficiaires dans des ordres opposés.
- `UPDATE` direct du montant, du bénéficiaire, de `approved_by`, du statut d'une ligne réglée ; retour à
  `INITIATED` ; DELETE ; ligne `payout` insérée sans passer par la fonction.
- Valideur égal à l'auteur ; lot sans ligne ; montant zéro ou négatif ; `CASH` ; IBAN ou numéro absent
  selon le moyen ; IBAN présent dans un message d'erreur.
- Règlement d'une ligne d'un autre prestataire ou d'un autre grand livre ; double règlement concurrent.
- Fonction sans `search_path` ou sans `assert_tenant` ; exécutable par PUBLIC ; un `.sql` généré modifié.

## Fichiers à faire relire par une personne

- `packages/ledger-sql/migrations/0085_payouts.sql` : `create_payout_batch` (verrous, borne du droit net,
  écriture), `settle_payout`, déclencheurs, CHECK de destination.
