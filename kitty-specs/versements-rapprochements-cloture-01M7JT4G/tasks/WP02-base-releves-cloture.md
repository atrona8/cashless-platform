---
work_package_id: WP02
title: Base des relevés, du rapprochement et de la clôture
dependencies: []
requirement_refs:
- FR-001
- FR-002
- FR-004
- FR-008
- FR-013
- FR-014
- FR-015
- C-004
planning_base_branch: feat/versements-rapprochements-cloture
merge_target_branch: feat/versements-rapprochements-cloture
branch_strategy: Planning artifacts for this mission were generated on feat/versements-rapprochements-cloture. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/versements-rapprochements-cloture unless the human explicitly redirects the landing branch.
subtasks: [T007, T008, T009, T010, T011, T012]
phase: Phase 1 - Fondations
agent: claude
history:
- timestamp: '2026-11-17T12:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: packages/ledger-sql/
create_intent: [packages/ledger-sql/migrations/0083_statements.sql, packages/ledger-sql/migrations/0084_closing_conditions_steps.sql, packages/ledger-sql/tests/tests_statements.sql, packages/ledger-sql/tests/tests_closing_conditions.sql]
execution_mode: code_change
model: sonnet
owned_files: [packages/ledger-sql/migrations/0083_statements.sql, packages/ledger-sql/migrations/0084_closing_conditions_steps.sql, packages/ledger-sql/tests/tests_statements.sql, packages/ledger-sql/tests/tests_closing_conditions.sql]
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP02 : Base des relevés, du rapprochement et de la clôture

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role :
implementer / Agent : claude). Lis ensuite la fiche commune
`docs/passation-9b/fiche-implementation.md`, ce prompt, puis seulement :

- `contracts/interfaces.md` : tableau « Base de données », « Ordre des verrous » ;
- `data-model.md` : `closing_step`, `statement_import`, `external_statement_line`, « Fonctions SQL »,
  « Invariants » 1 et 4 ; `research.md` R-01, R-02, R-05, R-08 ; `spec.md` FR-001, FR-002, FR-004,
  FR-013 à FR-015 ;
- `schema_grand_livre_cashless.sql` (lecture seule) : `external_statement_line` l. 880-890, `anomaly`
  l. 845-860, `trial_balance_at` l. 922-930, `event_status_transition` et `guard_event_status`
  l. 2985-3011, `ledger_unsettled` l. 3024-3032, `set_event_status` **l. 3093-3170 en entier** ;
- `migrations/0008_event_ledger.sql` l. 100-258 : `event_transition_conditions` (deuxième copie) ;
  `0036_cash_sessions.sql` l. 78-95 (`cash_session`) ; `0038_*.sql` : `psp_topup.provider_payment_ref`
  (l. ~97, `topup_tx_id`), `psp_chargeback.provider_dispute_id` (`chargeback_tx_id`),
  `PSP_TOPUP_NOT_CREDITED` (l. 1286-1289) ; `0081_refund_requests.sql` (`external_reference`, garde de
  portée, RLS : modèle de table) ; `0063_edge_replication.sql` l. 835-863 (modèle de fonction DEFINER) ;
- `tests/tests_refund_requests.sql` en tête et famille 1 (modèle de suite) ; `tests/tests_event_ledger.sql`
  (appels à `set_event_status`) ; `tests/_grants_for_tests.sql`.

Priorité des sources (SPECIFICATION §0.3). Contradiction : tu la signales. `interfaces.md` fait foi.

## Objective

Poser la base du rapprochement et de la clôture en deux migrations : `0083` (relevés importés,
rapprochement automatique par les tables sources puis manuel, état par compte, anomalies PSP
représentées) et `0084` (étapes de clôture à écriture unique, quatre conditions de passage de statut
dans **les deux copies** de la logique). Aucun droit accordé (WP06). Aucune route.

## Branch Strategy

- Branche de planification et de fusion : `feat/versements-rapprochements-cloture`.
- Worktree alloué par lane, calculé dans `lanes.json`.
- Commande : `LC_ALL=C LANG=C spec-kitty agent action implement WP02 --agent claude --mission
  versements-rapprochements-cloture-01M7JT4G`.

## Périmètre et arbitrages

- Fichiers : uniquement ceux d'`owned_files`. Jamais un `.sql` généré ni
  `schema_grand_livre_cashless.sql`. **Aucun GRANT** ni REVOKE de droit de rôle : WP06 les pose. Tu
  testes en propriétaire ; en-tête de migration en français comme `0081` (objet, décisions, fonctions à
  faire relire).
- Toute fonction : `REVOKE ALL … FROM PUBLIC`, `SECURITY DEFINER SET search_path = public, pg_temp`,
  `assert_tenant(...)` en tête. Toute table : `operator_id`, RLS `tenant_isolation` ENABLE + FORCE,
  garde de portée à l'insertion, aucun `DELETE`.
- `set_event_status` et `event_transition_conditions` : **redéfinies ensemble dans `0084`**, même
  fichier, corps d'origine conservés ligne à ligne, seules les conditions ajoutées changent. Les deux
  schémas d'origine ont `search_path = public` : la redéfinition pose `public, pg_temp`
  (`tests_definer_search_path.sql` l'exige). **Garde l'ordre des verrous** : verrous consultatifs
  d'autorité par grand livre, puis événement `FOR NO KEY UPDATE`, puis grands livres par identifiant.
  Les conditions nouvelles sont de la lecture seule : aucun verrou ajouté.
- Décisions à documenter dans l'en-tête de `0083` et à signaler à l'orchestrateur (WP09 les consomme) :
  - **signe** de `external_statement_line.amount` : positif = entrée sur le compte d'argent, négatif =
    sortie (le sens est fixé par le compte, pas par le fournisseur) ;
  - **solde du compte** à une date : `trial_balance_at(ledger, date)` par `code` de compte ;
  - **compte rapproché** = aucune ligne non rapprochée ET `closing_balance` du dernier relevé =
    solde du grand livre à sa date + somme des lignes rapprochées à une anomalie (FR-015) ; un compte
    sans ligne ni mouvement compte comme rapproché (sinon un événement sans PSP ne passerait jamais).
- Risques à signaler sans trancher : (1) la contrainte d'origine `UNIQUE (source, external_ref)` est
  **globale** (sans prestataire) : un prestataire peut heurter la référence d'un autre. Garde-la (décision
  du plan) mais décris l'effet. (2) `REFUND_DEADLINE_REACHED` avec `refund_deadline` nulle : pose
  « non remplie » avec un `detail` explicite et signale le choix (la 9a lisait une échéance effective
  `fin + 30 j`, réglage de l'API).
- Un manque dans `data-model.md` (colonnes de retour de `account_reconciliation`, argument `p_actor` de
  `record_closing_step`, voir T010) : tu le comblerais mais tu le signales à l'orchestrateur.

## Subtasks

### T007 : 0083, `statement_import`, colonnes, garde de portée

- Table `statement_import` de `data-model.md` ; `UNIQUE (account_id, file_sha256)` ; `closing_balance`
  et `currency` NOT NULL ; ajout seul (déclencheur qui refuse UPDATE et DELETE).
- `external_statement_line` : colonnes `statement_import_id` (FK, nullable pour l'existant), `currency`,
  `matched_anomaly_id` (FK `anomaly`), `matched_by`, `matched_at` ; index unique
  `(account_id, source, external_ref)` en plus de l'ancien ; CHECK « pas à la fois `matched_tx_id` et
  `matched_anomaly_id` » et `matched_by`/`matched_at` posés si et seulement si rapprochée.
- Garde `BEFORE INSERT` : le grand livre appartient au prestataire de la ligne, le compte appartient au
  grand livre et sa famille est `ASSET`. Garde `BEFORE UPDATE` : seules les colonnes de rapprochement
  passent de NULL à une valeur, **une fois** ; toute autre colonne est immuable ; le DELETE est refusé.
- Index utiles à l'import (NFR-003) : `payout(external_ref)`, `refund_request(external_reference)`,
  `psp_topup(provider_payment_ref)`, `psp_chargeback(provider_dispute_id)` s'ils manquent (`IF NOT
  EXISTS`, noms figés dans l'en-tête).
- Validation : `tests_statements.sql` (insertion d'un compte d'un autre prestataire, d'un autre grand
  livre, d'un compte `LIABILITY` : refus ; double rapprochement : refus).

### T008 : 0083, `import_statement_lines` (dédoublonnage, rapprochement automatique)

`import_statement_lines(p_import jsonb, p_lines jsonb)` rend `jsonb {import_id, created, matched,
existing}`. `p_import` : `ledger_id`, `account_id`, `source`, `file_sha256`, `statement_date`,
`closing_balance`, `currency`, `imported_by` ; `p_lines` : tableau `{external_ref, value_date, amount,
currency}`.
1. `assert_tenant(tenant_of_ledger(...))` ; compte du grand livre et de famille `ASSET` ; devise du
   relevé et de chaque ligne = devise du grand livre ; sinon `RAISE … USING ERRCODE = 'CL047'`
   (`VALIDATION_FAILED`, 422 ; aucun nouveau code). Un compte étranger : `CL047`, pas `42501`.
2. Réimport du même `file_sha256` sur le même compte : rend l'import existant, `created = 0`, aucune
   écriture. Une ligne déjà connue par `(account_id, source, external_ref)` compte dans `existing`.
3. Traitement **ensembliste** (une instruction par étape, jamais ligne à ligne : 10 000 lignes en moins de
   60 s) : lignes nouvelles par `INSERT … SELECT … ON CONFLICT DO NOTHING`, puis comptage, puis ligne
   `statement_import` avec ses compteurs (la table est en ajout seul : aucun UPDATE).
4. Rapprochement automatique **par table source**, jamais en analysant `idempotency_key` :
   `psp_topup.provider_payment_ref` → `topup_tx_id` ; `psp_chargeback.provider_dispute_id` →
   `chargeback_tx_id` ; `refund_request.external_reference` → `transaction_id` ; `payout.external_ref` →
   `settled_tx_id`. Conditions : même prestataire, même grand livre, et la transaction touche le compte
   de la ligne (un `posting` sur ce compte). Une référence qui désigne plusieurs transactions : la ligne
   reste non rapprochée. `matched_by` = `imported_by`.
- Cas limites : montant nul (refus `CL047`) ; fichier vide ; `external_ref` vide ; deux lignes identiques
  dans le même fichier (une seule créée) ; même référence, comptes différents (deux lignes).

### T009 : 0083, `match_statement_line`, `account_reconciliation`

- `match_statement_line(p_line bigint, p_tx uuid, p_anomaly uuid, p_actor uuid)` : exactement un des deux
  ciblés ; ligne verrouillée `FOR UPDATE` en dernier (ordre des verrous d'`interfaces.md`) et non encore
  rapprochée ; transaction de même prestataire et grand livre, qui touche le compte ; anomalie de type
  `PSP_TOPUP_OVER_LIMIT`, `PSP_TOPUP_NOT_CREDITED` ou `PSP_MISMATCH`, `OPEN`, même grand livre. Refus par
  `CL047` (cible invalide) ou `CL043`-type existant déjà mappé `CONFLICT_STATE` si la ligne est déjà
  rapprochée : réutilise un SQLSTATE mappé, n'en crée pas.
- `account_reconciliation(p_ledger uuid)` STABLE : une ligne par compte `ASSET` d'argent (`A-PSP-*`,
  `A-BANQUE`, caisses exclues si sans relevé) avec `account_id`, `code`, `lines`, `unmatched_lines`,
  `statement_closing_balance`, `statement_date`, `ledger_balance`, `explained_by_anomalies`,
  `reconciled`. Règle de « rapproché » : voir « Périmètre ». Les noms de colonnes sont ceux du schéma
  `AccountReconciliation` du contrat (lignes, non rapprochées, solde relevé, solde grand livre, rapproché).
- Validation : relevé de 10 lignes dont 8 par référence : 8 rapprochées ; une anomalie ouverte
  `PSP_TOPUP_NOT_CREDITED` d'un montant égal à l'écart, ligne rapprochée à l'anomalie : compte rapproché ;
  sans l'anomalie : non rapproché ; solde de relevé faux : non rapproché.

### T010 : 0084, `closing_step`, `record_closing_step`

- `closing_step` de `data-model.md` : PK `(event_id, step)`, `step` dans les sept valeurs, `status` `DONE` ou
  `NOT_APPLICABLE`, `transaction_ids uuid[]`, `summary jsonb`, ajout seul (déclencheur refusant UPDATE et
  DELETE), garde de portée (l'événement appartient au prestataire), RLS.
- `record_closing_step(p_event, p_step, p_status, p_tx, p_summary, p_actor)` : **l'argument `p_actor` est
  ajouté** à la signature de `data-model.md` (`done_by` est NOT NULL et rien d'autre ne le fournit) :
  signale-le. Corps : `assert_tenant(tenant_of_event(...))` ; verrou consultatif
  `pg_advisory_xact_lock(hashtextextended('closing-step:' || p_event || ':' || p_step, 0))` (même clé que le
  verrou de l'API, WP07 : écris-la dans l'en-tête) ; phase : étapes 1 à 3 seulement en `SETTLING`, 4 à 7
  seulement en `REFUND_WINDOW` (sinon `CL019`) ; ordre : l'étape précédente est `DONE` ou `NOT_APPLICABLE`
  (sinon `CL019`) ; déjà enregistrée : rend la ligne existante sans rien écrire (rejeu).
- Ordre de référence : `PITCH_FEES`, `OPERATOR_FEE`, `PLATFORM_FEE`, `OPERATOR_FEE_REGULARIZATION`,
  `BREAKAGE`, `DEPOSIT_FORFEIT`, `PROMO_EXPIRY` (R-02).

### T011 : 0084, `set_event_status` et `event_transition_conditions` (4 conditions)

Quatre codes, mêmes dans les deux copies, ajoutés à la suite des existants (`source = 'DATABASE'`) :
- `NO_OPEN_CASH_SESSION` vers `RECONCILING` : aucune `cash_session` de l'événement `OPEN` ou `CLOSING`
  (`CL019`, FR-002) ;
- `PSP_RECONCILED` vers `SETTLING` : tous les comptes `A-PSP-*` des grands livres de l'événement sont
  rapprochés par `account_reconciliation` (devient calculée, plus « externe ») ;
- `CLOSING_STEPS_DONE` : vers `REFUND_WINDOW`, étapes 1 à 3 `DONE` ou `NOT_APPLICABLE` ; vers `CLOSED`,
  étapes 1 à 7 ;
- `REFUND_DEADLINE_REACHED` vers `CLOSED` : `refund_deadline <= clock_timestamp()`.
La copie en lecture rend un `detail` français par condition ; son premier bloc reste
`TRANSITION_ALLOWED`. Un passage refusé par `set_event_status` lève `CL019` exactement quand la copie en
lecture rend au moins une condition non remplie.
- Cas limites : événement sans caisse, sans compte PSP, sans événement lié ; grand livre à portée
  `ORGANIZER` (`scope_type`) ; `refund_deadline` nulle ; session `CLOSING` (bloque aussi) ; passage vers
  `CLOSED` avant l'échéance (nouveau refus : c'est un renforcement à consigner).
- **Régression** : tout test existant qui appelle `set_event_status` doit rester vert
  (`tests_event_ledger.sql`, `tests_cash_sessions.sql`, `tests_grand_livre_cashless.sql`,
  `scenario_reference_test.sql`). Si l'un d'eux échoue parce qu'une condition nouvelle bloque un parcours
  légitime (un test ne pose pas d'étapes), **arrête-toi sur ce point** et signale-le : tu ne modifies pas
  ces suites (générées ou hors carte).

### T012 : pgTAP `tests_statements.sql`, `tests_closing_conditions.sql`

Même forme que `tests_refund_requests.sql` (BEGIN, `_grants_for_tests.sql`, `no_plan`, propriétaire).
- `tests_statements.sql` : garde de portée (3 refus), import et dédoublonnage (réimport, deux fichiers qui
  se recoupent), devise et compte étrangers (`CL047`), rapprochement automatique par les **quatre**
  sources, ambiguïté (reste non rapprochée), manuel (cible d'un autre prestataire ou compte : refus,
  double rapprochement : refus), immuabilité (UPDATE d'une colonne d'identité, DELETE), anomalies PSP
  dans `account_reconciliation`, 10 000 lignes importées en moins de 60 s.
- `tests_closing_conditions.sql` : `closing_step` (ajout seul, PK, ordre, phase, rejeu sans écriture,
  50 appels successifs : une ligne), chacune des 4 conditions par cas passant et cas bloquant, **égalité
  des deux copies** (pour une grille d'états : mêmes codes, et `set_event_status` lève `CL019` ssi une
  condition est non remplie), ordre des verrous inchangé (même séquence de verrous qu'avant, lue dans
  `pg_locks` ou par un test de deux sessions si possible).

## Tests et preuves

Depuis la lane (`cd <lane> || exit 1`), base `cashless_wp02`, serveur 5433 (`docker ps`) :

```bash
export PGHOST=127.0.0.1 PGPORT=5433 PGUSER=postgres PGDATABASE=cashless_wp02
R=/Users/xaamga/Documents/omar_sylla_work/cashless/cashless-platform
export PATH=$R/docs/passation-9a/scripts/bin:/Library/PostgreSQL/18/bin:$PATH
bash packages/ledger-sql/scripts/reset-db.sh
cd packages/ledger-sql
pg_prove -d cashless_wp02 tests/tests_statements.sql tests/tests_closing_conditions.sql \
  tests/tests_event_ledger.sql tests/tests_cash_sessions.sql tests/tests_definer_search_path.sql
pg_prove -d cashless_wp02 tests_grand_livre_cashless.sql scenario_reference_test.sql
```

Preuves : FR-001, FR-002, FR-004, FR-008 (conditions, deux copies égales), FR-013, FR-014, FR-015
(rapprochement, anomalies), C-004 ; suites générées vertes et intactes (`git diff --stat`).

## Definition of Done

- [ ] `0083` : `statement_import`, colonnes, gardes, `import_statement_lines`, `match_statement_line`,
      `account_reconciliation`, tous DEFINER avec `assert_tenant` et `search_path` figé ; aucun GRANT.
- [ ] `0084` : `closing_step`, `record_closing_step`, deux copies des conditions redéfinies ensemble,
      ordre des verrous identique, `search_path = public, pg_temp`.
- [ ] Deux suites pgTAP vertes, dont l'égalité des copies ; suites existantes et générées vertes.
- [ ] Compte rendu : `p_actor`, signe des montants, règle « rapproché », unicité globale, échéance nulle,
      renforcements (conditions, `refund_deadline`) à consigner, fichiers à relire.

## Ce que le relecteur doit casser

- Import d'un prestataire A visant le compte ou le grand livre de B ; devise étrangère ; même fichier
  réimporté en deux transactions concurrentes (une seule importation) ; 10 000 lignes.
- Rapprochement manuel d'une ligne déjà rapprochée, d'une transaction qui ne touche pas le compte, d'une
  anomalie résolue ou d'un autre grand livre ; deux sessions qui rapprochent la même ligne.
- `UPDATE` de `amount`, `external_ref`, `account_id` d'une ligne ; DELETE ; `closing_step` modifiée ou
  effacée ; étape enregistrée hors phase ou hors ordre ; deux appels concurrents de `record_closing_step`.
- Une condition présente dans une copie et absente de l'autre ; un `set_event_status` qui passe alors que
  la copie en lecture dit non ; verrous pris dans un autre ordre (interblocage avec `post_transaction`) ;
  fonction sans `search_path` ou sans `assert_tenant` ; fonction exécutable par PUBLIC.
- Passage à `RECONCILING` avec une session `CLOSING` ; à `CLOSED` avant l'échéance ; à `SETTLING` avec un
  compte PSP non rapproché ; événement sans PSP ni caisse qui doit passer.
- Un `.sql` généré modifié ; un GRANT introduit.

## Fichiers à faire relire par une personne

- `packages/ledger-sql/migrations/0083_statements.sql` : gardes, `import_statement_lines`,
  `match_statement_line`, `account_reconciliation`.
- `packages/ledger-sql/migrations/0084_closing_conditions_steps.sql` : `set_event_status` et
  `event_transition_conditions` redéfinies (ordre des verrous, égalité des copies), `record_closing_step`.
