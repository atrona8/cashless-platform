---
work_package_id: WP02
title: 'Base : vues de lecture des ventes et des anomalies'
dependencies: [WP01]
requirement_refs:
- FR-005
- FR-006
- FR-007
- FR-008
- FR-017
- NFR-001
- NFR-003
- NFR-005
- NFR-006
planning_base_branch: feat/routes-backoffice
merge_target_branch: feat/routes-backoffice
branch_strategy: >-
  Planning artifacts for this mission were generated on feat/routes-backoffice. During
  /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must
  merge back into feat/routes-backoffice unless the human explicitly redirects the landing branch.
base_branch: kitty/mission-routes-backoffice-01M86KT6
base_commit: 83cef3907ab67b4157bc1163dbb7f6450d274a73
created_at: '2026-11-24T16:22:15.145543+00:00'
subtasks: [T006, T007, T008, T009]
phase: Phase 1 - Fondations
agent: claude
history:
- timestamp: '2026-11-24T13:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: packages/ledger-sql/migrations/0102_backoffice_read_views.sql
create_intent:
- packages/ledger-sql/migrations/0102_backoffice_read_views.sql
- packages/ledger-sql/tests/tests_backoffice_read_views.sql
execution_mode: code_change
model: sonnet
owned_files:
- packages/ledger-sql/migrations/0102_backoffice_read_views.sql
- packages/ledger-sql/tests/tests_backoffice_read_views.sql
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP02 : Base : vues de lecture des ventes et des anomalies

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role : implementer / Agent :
claude). Lis ensuite la fiche commune `docs/passation-11b/fiche-implementation.md` (démarrage, règles, base de données,
fin d'implémentation : ne pas la recopier ici), ce prompt, puis seulement :

- `kitty-specs/routes-backoffice-01M86KT6/interfaces.md` §2 « WP02 » (colonnes des deux vues, **exactes**) ;
- `research.md` D5, D6 ; `data-model.md` § Lectures ;
- `apps/api/src/payments/payment-read.service.ts` l. 55-95 (jointure du compte `MERCHANT` crédité et de la
  participation : à reprendre, pas à réinventer) ;
- `packages/ledger-sql/migrations/0101_anomaly_classification_phone_models.sql` de la lane de WP01 (colonnes de
  classement, `anomaly_classifiable`) : ta lane est basée dessus ;
- schéma : `journal_transaction`, `posting`, `account`, `sale_attribution`, `sale_line`, `device`, `anomaly`
  (`\d` dans `cashless_wp02`) ; tout pgTAP existant d'une vue `security_invoker` ou de RLS comme modèle de forme.

## Objective

Fournir aux lots de routes (WP06 ventes, WP07 anomalies) deux vues `security_invoker` lisibles par `cashless_app` sous la
RLS du prestataire, **sans donnée du festivalier** (ni portefeuille, ni bracelet, ni numéro dans `sale_overview`), et
prouver par mesure que la liste d'un événement de 200 000 ventes tient NFR-001 (p95 < 500 ms par page côté serveur).

## Subtasks

### T006 — Vue `sale_overview`

1. Une ligne par `journal_transaction` `type = 'PURCHASE'`, colonnes **exactement** celles d'`interfaces.md` §2
   (`transaction_id … reversal_transaction_id`), `WITH (security_invoker = true)`.
2. `merchant_id` et `participation_id` : par le compte `MERCHANT` crédité du posting, même jointure que
   `payment-read.service.ts`. `pos_id` : `device.pos_id`, à défaut `sale_line.pos_id` de la première ligne
   (`line_no` minimal). `vendor_id`, `device_id`, `channel` : `sale_attribution` (jointure externe : vente sans
   attribution possible, vérifie). `reversal_transaction_id` : ligne `REVERSAL` dont `reverses_id` = la vente (unique).
3. **Aucune** colonne `wallet_id`, `media_id`, `customer_*`. `GRANT SELECT` à `cashless_app` seulement ; pas d'autre droit.
4. Une vente hors ligne garde sa date d'origine (`occurred_at`, pas l'heure de synchronisation) : vérifie la colonne
   source et note-la.
5. **Mutation** : ajouter `wallet_id` à la vue : le test de colonnes exactes (`columns_are`) doit échouer.

### T007 — Vue `anomaly_overview`

1. Colonnes d'`anomaly` + `event_id` (par le grand livre ou la transaction liée ; décris la jointure et le cas
   `transaction_id` nul : `event_id` nul, note-le) + `currency` + `classifiable` (`anomaly_classifiable(kind)`), plus les
   trois colonnes de classement. `security_invoker = true`, `SELECT` à `cashless_app`.
2. **Mutation** : retirer `security_invoker` : le test d'isolement entre prestataires doit échouer.

### T008 — Index et mesure sur 200 000 ventes

1. Dans `cashless_wp02`, génère **200 000** `PURCHASE` pour un événement (script SQL du propriétaire, `generate_series`,
   avec postings et `sale_attribution` cohérents ; scripte-le dans la note, reproductible) plus quelques milliers pour un
   second prestataire.
2. Requêtes de mesure : première page (`ORDER BY occurred_at DESC, id DESC LIMIT 51`), page profonde par curseur, filtre
   `pos_id`, filtre `merchant_id`, plage `from/to`, `status = 'REVERSED'`. `EXPLAIN (ANALYZE, BUFFERS)` de chacune dans la
   note de lane, **avant et après** index.
3. Ajoute **seulement** les index que la mesure justifie (candidats : `(event_id, type, occurred_at, id)` partiel sur
   `PURCHASE` ; `posting` sur le compte `MERCHANT`). p95 sur 50 exécutions par requête, sous `cashless_app` (RLS active) :
   < 500 ms. Note les chiffres et la commande.
4. **Mutation** : retirer l'index principal : la requête de première page passe en `Seq Scan` et dépasse le seuil ; note-le.

### T009 — pgTAP `tests_backoffice_read_views.sql`

1. `has_view`, `columns_are` des deux vues ; `reloptions` contient `security_invoker=true` ; `has_table_privilege`
   (`SELECT` oui, `INSERT/UPDATE/DELETE` non) pour `cashless_app` ; aucun droit nouveau sur les tables sous-jacentes
   (compare à `roles.sql`).
2. Isolement : sous `app.operator_id = A`, la vue ne rend aucune ligne de B (ventes et anomalies).
3. Contenu : une vente annulée porte `reversal_transaction_id` ; vente sans commerçant ; `classifiable` vrai pour
   `CASH_DIFF`, faux pour `PSP_TOPUP_NOT_CREDITED`.
4. `pg_prove -d cashless_wp02 tests/tests_backoffice_read_views.sql` vert ; `tests_execute_grants.sql` vert.

## Retouches hors carte permises

Aucune.

## Definition of Done

- [ ] Colonnes des vues identiques à `interfaces.md` §2 ; `security_invoker` prouvé ; aucun `GRANT` autre que `SELECT`.
- [ ] Mesure p95 < 500 ms sur 200 000 ventes avec `EXPLAIN` avant/après dans la note de lane, script de génération joint.
- [ ] pgTAP vert ; mutations notées ; migration rejouable sur base vierge.
- [ ] Aucun comptage sur toute la base dans les tests (filtre par prestataire ou événement).

## Ce que le relecteur doit casser

- Une colonne qui laisse passer le portefeuille, le bracelet ou le numéro du festivalier.
- Une vue sans `security_invoker` : le prestataire B lit A (ou la vue lue par le propriétaire contourne la RLS).
- Un commerçant résolu par `sale_line` ou par le nom au lieu du compte `MERCHANT` ; une vente à deux lignes dupliquée par
  la jointure (une ligne par vente, vérifier le nombre).
- Une mesure faite sur peu de lignes, ou en tant que propriétaire (RLS contournée), ou sans `ANALYZE` des tables.
- Un index inutile ajouté « au cas où » ; une migration qui modifie `0101` ou un fichier généré.

## Implementation command

`LC_ALL=C LANG=C spec-kitty agent action implement WP02 --agent claude --mission routes-backoffice-01M86KT6`
