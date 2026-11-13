---
work_package_id: WP01
title: Base des demandes de remboursement
dependencies: []
requirement_refs:
- FR-001
- FR-003
- NFR-002
planning_base_branch: feat/remboursements
merge_target_branch: feat/remboursements
branch_strategy: Planning artifacts for this mission were generated on feat/remboursements. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/remboursements unless the human explicitly redirects the landing branch.
subtasks: [T001, T002, T003, T004, T005, T006]
phase: Phase 1 - Base
agent: claude
history:
- timestamp: '2026-11-13T15:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
role: implementer
model: sonnet
execution_mode: code_change
authoritative_surface: packages/ledger-sql/
owned_files: [packages/ledger-sql/migrations/0081_refund_requests.sql, packages/ledger-sql/post-roles.sql, packages/ledger-sql/tests/tests_refund_requests.sql, packages/ledger-sql/tests/tests_execute_grants.sql, packages/ledger-sql/tests/tests_offline_rights.sql]
create_intent: [packages/ledger-sql/migrations/0081_refund_requests.sql, packages/ledger-sql/tests/tests_refund_requests.sql]
tags: []
tracker_refs: []
---

# Work Package Prompt: WP01 : Base des demandes de remboursement

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role : implementer / Agent :
claude). Lis ensuite la fiche commune `docs/passation-9a/fiche-implementation.md`, ce prompt, puis seulement :

- `contracts/interfaces.md` : section « Base » et ligne WP01 du tableau de répartition ;
- `data-model.md` : « `refund_request` », « États », « `otp_challenge` (colonnes ajoutées) », « Fonctions SQL » ;
- `research.md` R-02, R-05 (points 3 à 5), R-06 ; `spec.md` FR-001, FR-003 (l. 167-169), NFR-002 (l. 193) ;
- `packages/ledger-sql/migrations/0080_customer_auth.sql` : en-tête (l. 1-9), modèle de table avec RLS (l. 16-27),
  `otp_challenge` (l. 37-55), fonctions SECURITY DEFINER (l. 88-108) ;
- `migrations/0063_edge_replication.sql` l. 835-860 : modèle d'une fonction de maintenance sur tous les prestataires ;
- `post-roles.sql` section 10 (l. 1042-1063), et `roles.sql` l. 13-16 et 44 (droits larges de `cashless_app`) ;
- `tests/tests_customer_auth.sql` en entier (modèle des tests de droits), `tests/tests_execute_grants.sql` l. 70-194
  (liste de `cashless_app`), l. 307-313 (`cashless_maint`), l. 195-250 (fonctions refusées à `cashless_app`),
  `tests/tests_offline_rights.sql` l. 85-102 (liste figée des tables).

Priorité des sources (SPECIFICATION §0.3). Contradiction : tu la signales. Entre `tasks.md`, `interfaces.md` et
`data-model.md`, `interfaces.md` fait foi.

## Objective

Poser la base de la mission : la table `refund_request` (S16) avec son isolation par prestataire, ses invariants et sa
règle « une demande ouverte par portefeuille » garantie par la base ; deux colonnes d'usage sur `otp_challenge` ; deux
fonctions SECURITY DEFINER (prestataire d'une demande pour la route publique du titulaire, promotion des demandes
échues) ; les droits exacts. Seul ce lot accorde des droits de base dans la mission. Aucune route, aucun code d'erreur.

## Branch Strategy

- Branche de planification et de fusion : `feat/remboursements`.
- Worktree alloué par lane, calculé dans `lanes.json`.
- Commande : `LC_ALL=C LANG=C spec-kitty agent action implement WP01 --agent claude --mission remboursements-01M7AG5V`.

## Périmètre et arbitrages

- Fichiers : uniquement ceux d'`owned_files`. Jamais un `.sql` généré (`schema_grand_livre_cashless.sql`,
  `tests_grand_livre_cashless.sql`, `scenario_reference_test.sql`). Pas de modification de la section 10 de
  `post-roles.sql` : ajoute une section 11 à la suite.
- Numéro de migration `0081` (R-11). Commentaires en français, en-tête de migration comme celle de `0080` (objet,
  décisions, droits, fonctions à faire relire).
- Fait de code à garder en tête : `roles.sql:14-16` accorde SELECT, INSERT, UPDATE sur TOUTES les tables et `:44`
  EXECUTE sur TOUTES les fonctions à `cashless_app`. La section 11 doit donc retirer ce qui n'est pas nécessaire (modèle
  : section 10).
- Hypothèse existante, à ne pas élargir : les fonctions SECURITY DEFINER qui lisent une table à RLS FORCÉE sans
  prestataire de session supposent un propriétaire qui ignore la RLS (0022, OP-N87 ; `otp_challenge_operator` de 0080
  fait de même). Les deux nouvelles fonctions s'y alignent ; ne le « corrige » pas, signale-le dans le compte rendu.

## T001 : table `refund_request` (0081)

But : la table de `data-model.md`, dans `0081_refund_requests.sql`, section 1.

- Colonnes, types et nullités : exactement `data-model.md`. `id uuid PRIMARY KEY DEFAULT gen_random_uuid()` (R-02). Clés
  étrangères : `operator_id → party`, `ledger_id → ledger`, `event_id → event`, `wallet_id → wallet`, `customer_id →
  customer_identity(customer_id)`, `approval_request_id → approval_request`, `transaction_id` et
  `reversal_transaction_id → journal_transaction`. Le type de `currency` est celui de la devise de l'événement (lis le
  schéma). Les identifiants de personnes du back-office (`requested_by`, `approved_by`, `confirmed_by`) : mêmes
  références que celles d'`approval_request` (lis-les, ne devine pas).
- `status` : CHECK sur les huit valeurs de l'interface (`AWAITING_HOLDER`, `REQUESTED`, `PROCESSING`, `PAID`, `FAILED`,
  `REJECTED`, `CANCELLED`, `BLOCKED`) ; `method` : `WAVE`, `ORANGE_MONEY`, `BANK_TRANSFER`.
- CHECK de cohérence statut ↔ colonnes : les cinq invariants de `data-model.md` (`PAID` ⇒ `external_reference` non vide
  ; `FAILED` ⇒ `failure_reason` et `reversal_transaction_id` ; `REJECTED` ⇒ `reject_reason` ; `PROCESSING`, `PAID`,
  `FAILED` ⇒ `transaction_id` et `approved_by`). Resserrements permis (renforcements, à consigner) : `AWAITING_HOLDER` ⇒
  `hold_until` non nul ; `BLOCKED` ⇒ `holder_decision = 'BLOCK'` ; `holder_decision` dans `CONFIRM`, `BLOCK` et nul
  exactement quand `holder_decided_at` l'est ; montants `>= 0` ; `extra_check_required` ⇒ `new_number` ; `msisdn` au
  format E.164 de `0080` (`^\+[1-9][0-9]{6,14}$`) pour les canaux mobile money. Le contrat est inchangé : ne retire
  aucune valeur de statut, `CANCELLED` reste dans l'énumération.
- Index unique partiel `(wallet_id) WHERE status IN ('AWAITING_HOLDER','REQUESTED','PROCESSING')` : c'est FR-003 et
  NFR-002, garantis par la base. Le nom de l'index sera lu par l'API (WP04) pour répondre `409 REFUND_ALREADY_OPEN` :
  nomme-le `refund_request_one_open` et note-le dans `docs/passation-9a/suivi-lots.md`.
- Index de lecture : `(operator_id, event_id, status, created_at, id)` (liste du back-office), `(customer_id,
  created_at, id)` (liste du festivalier), `(hold_until) WHERE status = 'AWAITING_HOLDER'` (promotion).
- RLS : `ENABLE` + `FORCE`, politique `tenant_isolation` avec `USING` et `WITH CHECK` sur `operator_id`, calquée sur
  `0080`.
- Garde d'insertion (renforcement, à consigner) : la RLS ne vérifie que `operator_id`, et une clé étrangère lit la table
  référencée hors RLS ; sans garde, une session du prestataire A pourrait insérer une demande qui désigne le
  portefeuille de B. Ajoute un déclencheur `BEFORE INSERT` `refund_request_scope_guard()` (SECURITY DEFINER, `SET
  search_path = public, pg_temp`, REVOKE PUBLIC) qui refuse (`CL001`) si `tenant_of_wallet`, `tenant_of_ledger`,
  `tenant_of_event` ou le prestataire de `customer_identity` ne valent pas `NEW.operator_id`.

## T002 : colonnes d'usage de `otp_challenge` (0081)

But : un code ne vaut que pour l'usage pour lequel il a été émis (R-05, points 3 à 5).

- `ALTER TABLE otp_challenge ADD COLUMN purpose text NOT NULL DEFAULT 'LOGIN' CHECK (purpose IN
  ('LOGIN','REFUND_HOLDER'))` et `ADD COLUMN subject_id uuid NULL`. Les défis existants valent `LOGIN` : aucune
  réécriture de ligne.
- CHECK jumelé (renforcement) : `purpose = 'LOGIN'` ⇒ `subject_id IS NULL` ; `purpose = 'REFUND_HOLDER'` ⇒ `subject_id
  IS NOT NULL`. Index `(operator_id, phone, purpose, created_at)` pour la règle « un code vivant par (numéro, usage) »
  de WP03.
- Aucun droit nouveau : `cashless_app` garde `INSERT` de table (donc les deux colonnes à l'insertion) et ne change
  toujours que `attempts`, `consumed_at`, `invalidated_at` (section 10). `tests_customer_auth.sql` doit rester vert SANS
  modification : c'est la preuve que la connexion n'est pas touchée.

## T003 : `refund_request_operator` et `promote_due_refund_requests` (0081)

- `refund_request_operator(p_refund_request uuid) RETURNS uuid` : `LANGUAGE sql STABLE SECURITY DEFINER SET search_path
  = public, pg_temp`, ne rend QUE `operator_id` (ou NULL si la demande n'existe pas), comme `otp_challenge_operator`
  (0080 l. 93-96). `REVOKE ALL … FROM PUBLIC`.
- `promote_due_refund_requests() RETURNS integer` : plpgsql SECURITY DEFINER, `SET search_path = public, pg_temp`,
  `REVOKE ALL … FROM PUBLIC`. Corps : un seul `UPDATE refund_request SET status = 'REQUESTED', updated_at =
  clock_timestamp() WHERE status = 'AWAITING_HOLDER' AND hold_until <= clock_timestamp()`, résultat = nombre de lignes.
  Idempotente (un second appel rend 0), tous prestataires, horloge de la base (jamais celle de Node). Ne touche ni
  `holder_decision` (reste nul : c'est une échéance, pas une décision) ni aucune autre colonne ni aucune autre table.
- Elles ne prennent aucun prestataire en paramètre et ne rendent rien d'autre que l'identifiant ou un compte : aucune
  fuite de contenu. Le journal d'audit n'est pas alimenté par la fonction (l'API le fera quand elle promeut à la
  lecture).

## T004 : `post-roles.sql`, section 11

Ajoute à la suite de la section 10, même style de commentaire :

- `REVOKE ALL ON refund_request FROM cashless_app;` puis `GRANT SELECT, INSERT ON refund_request TO cashless_app;` puis
  `GRANT UPDATE (…) ON refund_request TO cashless_app;` limité aux colonnes de transition : `status`, `updated_at`,
  `holder_decision`, `holder_decided_at`, `approval_request_id`, `approved_by`, `transaction_id`, `external_reference`,
  `failure_reason`, `reject_reason`, `reversal_transaction_id`, `confirmed_by`, `confirmed_at`, `estimated_amount`,
  `fee` (recalculés à l'exécution). Jamais : `id`, `operator_id`, `ledger_id`, `event_id`, `wallet_id`, `customer_id`,
  `requested_by`, `method`, `msisdn`, `iban`, `new_number`, `currency`, `hold_until`, `extra_check_required`,
  `created_at`. Aucun `DELETE`, aucun `TRUNCATE`, aucun droit pour les autres rôles `cashless_*`.
- `REVOKE EXECUTE ON FUNCTION refund_request_operator(uuid), promote_due_refund_requests(), refund_request_scope_guard()
  FROM PUBLIC;` puis `GRANT EXECUTE … (les deux premières) TO cashless_app;` ; `REVOKE EXECUTE ON FUNCTION
  refund_request_scope_guard() FROM cashless_app` (fonction de déclencheur : le déclencheur s'exécute sans droit
  d'appel) ; `GRANT EXECUTE ON FUNCTION promote_due_refund_requests() TO cashless_maint;` (seulement celle-là :
  ajoute-la à la liste de la section 9f plutôt que d'ouvrir autre chose à `cashless_maint`).
- Le fichier est rejoué (`roles.sql` puis `post-roles.sql`) : chaque instruction doit être idempotente.

## T005 : `tests/tests_refund_requests.sql`

pgTAP écrit à la main, modèle `tests_customer_auth.sql` (même en-tête, `_grants_for_tests.sql`, `no_plan`, `ROLLBACK`).
Deux familles, la seconde sous `SET LOCAL ROLE cashless_app` avec `set_config('app.operator_id', …)`.

1. Propriétaire : chaque CHECK d'invariant (violation puis cas valide, `23514`) ; index unique partiel (`23505` pour une
   seconde demande ouverte du même portefeuille ; une `PAID`, `FAILED`, `REJECTED`, `BLOCKED` puis une ouverte passe ;
   deux portefeuilles distincts passent) ; garde d'insertion (portefeuille, grand livre, événement, festivalier d'un
   autre prestataire : `CL001`) ; `refund_request_operator` (demande de B → B, inconnue → NULL) ;
   `promote_due_refund_requests` (échue promue et `holder_decision` resté nul, non échue intacte, `REQUESTED` intacte,
   second appel = 0, deux prestataires dans le même appel) ; `otp_challenge` (`purpose` vaut `LOGIN` par défaut, valeur
   hors liste `23514`, `REFUND_HOLDER` sans `subject_id` `23514`, `LOGIN` avec `subject_id` `23514`).
2. Rôles : RLS ENABLE + FORCE ; droits de table exacts de `cashless_app` (`SELECT`, `INSERT` seulement) ; colonnes
   modifiables exactes (liste de T004, par `has_column_privilege`) ; aucun autre rôle `cashless_*` ne lit ni n'écrit
   (liste complète des rôles de `tests_customer_auth.sql`, `cashless_maint` compris) ; fonctions : SECURITY DEFINER au
   `search_path` figé (`pg_proc.proconfig`), `EXECUTE` de `cashless_app` sur les deux fonctions, de `cashless_maint` sur
   `promote_due_refund_requests` seule, d'aucun autre rôle ni de PUBLIC ; isolation : A ne voit ni ne met à jour la
   demande de B, ne peut pas insérer au nom de B (`42501`), ne peut ni `UPDATE method/msisdn/wallet_id/operator_id` ni
   `DELETE` (`42501`).

## T006 : listes figées et suites générées intactes

- `tests_execute_grants.sql` : liste exacte de `cashless_app` (ajoute les deux fonctions près de la ligne 129,
  commentaire « mission 9a, lot WP01 »), liste de `cashless_maint` (l. 307-313 : `promote_due_refund_requests()`, et
  corrige le texte du message), fonction de déclencheur ajoutée à la liste des « non exécutable » par `cashless_app` (l.
  195+).
- `tests_offline_rights.sql` : ajoute `'refund_request'` à la liste figée des tables (l. 97-102, commentaire « 0081 »).
  Vérifie si le texte « dix tables » du message doit changer ; ne touche pas `new_tables`.
- `tests_default_acl.sql` n'a aucune liste figée : ne le touche pas (hors de ta carte).
- Les trois fichiers générés restent byte à byte identiques (`git diff --stat` ne les montre pas) et leurs suites
  passent.

## Tests et preuves

Depuis la lane (`cd <lane> || exit 1`), base `cashless_wp01`, serveur 5433 (vérifie `docker ps`) :

```bash
export PGHOST=127.0.0.1 PGPORT=5433 PGUSER=postgres PGDATABASE=cashless_wp01
R=/Users/xaamga/Documents/omar_sylla_work/cashless/cashless-platform
export PATH=$R/docs/passation-9a/scripts/bin:/Library/PostgreSQL/18/bin:$PATH
bash packages/ledger-sql/scripts/reset-db.sh
cd packages/ledger-sql
pg_prove -d cashless_wp01 tests/tests_refund_requests.sql tests/tests_customer_auth.sql \
  tests/tests_execute_grants.sql tests/tests_offline_rights.sql tests/tests_default_acl.sql \
  tests/tests_definer_search_path.sql
pg_prove -d cashless_wp01 tests_grand_livre_cashless.sql scenario_reference_test.sql
```

Preuves à citer au compte rendu : FR-001, FR-003, NFR-002 (index unique, test `23505`) ; isolation (A ne voit pas B) ;
droits par colonne ; suites générées vertes et inchangées. Un second `reset-db` rejoue `post-roles.sql` : la suite
`tests_execute_grants.sql` §4 prouve déjà l'idempotence.

## Definition of Done

- [ ] `0081_refund_requests.sql` : table, CHECK, index unique partiel, RLS ENABLE + FORCE, garde d'insertion, colonnes
      de `otp_challenge`, deux fonctions SECURITY DEFINER au `search_path` figé, REVOKE PUBLIC.
- [ ] `post-roles.sql` section 11 seule modifiée, idempotente ; aucun droit hors de la liste de T004.
- [ ] `tests_refund_requests.sql` couvre les deux familles ; les cinq suites de droits et de connexion sont vertes.
- [ ] Listes figées à jour ; suites générées intactes ; index nommé `refund_request_one_open` noté dans `suivi-lots.md`.
- [ ] Preuves (critère → commande → résultat) notées à la fin de `docs/passation-9a/suivi-lots.md`.
- [ ] Compte rendu : renforcements consignés (garde d'insertion, CHECK jumelé de `otp_challenge`, resserrements de
      CHECK), hypothèse de propriétaire, fichiers à faire relire, aucun écart qui affaiblit.

## Ce que le relecteur doit casser

- Sous `cashless_app` du prestataire A : lire, mettre à jour ou insérer une demande de B ; insérer avec `operator_id` de
  A et le `wallet_id`, `event_id`, `ledger_id` ou `customer_id` de B (la garde doit refuser) ; `UPDATE` d'une colonne
  d'identité (`wallet_id`, `msisdn`, `hold_until`, `operator_id`) ; `DELETE`, `TRUNCATE`.
- Un rôle autre que `cashless_app` (`cashless_maint` compris) qui lit la table, ou exécute `refund_request_operator` ;
  `cashless_maint` qui exécute autre chose que `promote_due_refund_requests` ; PUBLIC qui exécute l'une des fonctions.
- Fonction SECURITY DEFINER sans `search_path` ou sans `pg_temp` : table temporaire de même nom dans la session
  appelante (`tests_definer_search_path.sql` doit rester vert).
- Deux demandes ouvertes sur le même portefeuille en deux transactions concurrentes ; une demande `PAID` sans référence
  vide, `FAILED` sans `REVERSAL`, `PROCESSING` sans valideur, `BLOCKED` sans décision `BLOCK`.
- `promote_due_refund_requests` qui promeut une demande non échue, une `REQUESTED`, une `BLOCKED`, ou qui écrit
  `holder_decision` ; un second appel qui rend plus de 0.
- `otp_challenge` : insérer `purpose = 'REFUND_HOLDER'` sans objet, ou un défi `LOGIN` avec objet ; la connexion
  existante (`tests_customer_auth.sql`) qui change de comportement.
- Un `.sql` généré modifié ; une liste figée élargie sans test ; un droit accordé à un rôle de processus par `ALL`.
- Une fuite par la fonction publique : `refund_request_operator` ne doit rendre rien d'autre que l'identifiant du
  prestataire.
- Limite à constater : aucune transition d'état n'est gardée par la base (les colonnes de transition sont modifiables
  par `cashless_app`) ; seule l'API ordonne les états. À signaler, pas à corriger ici.

## Fichiers à faire relire par une personne

- `packages/ledger-sql/migrations/0081_refund_requests.sql` : RLS et garde d'insertion, fonctions SECURITY DEFINER
  (`refund_request_operator`, `promote_due_refund_requests`, `refund_request_scope_guard`).
- `packages/ledger-sql/post-roles.sql`, section 11 (droits par colonne, EXECUTE de `cashless_app` et `cashless_maint`).
