---
work_package_id: WP07
title: 'Base : terminal, vendeur et configuration datés (migration 0048)'
dependencies: [WP03, WP05]
requirement_refs:
- FR-003
- FR-005
- FR-011
- FR-012
planning_base_branch: feat/hors-ligne-snapshots-lots
merge_target_branch: feat/hors-ligne-snapshots-lots
branch_strategy: Planning artifacts for this mission were generated on feat/hors-ligne-snapshots-lots. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/hors-ligne-snapshots-lots unless the human explicitly redirects the landing branch.
base_branch: kitty/mission-hors-ligne-snapshots-lots-01M645RN
base_commit: 886717a4ac8a63a989fd7d2b58124db49aaac9c6
created_at: '2026-10-30T14:46:21.689875+00:00'
subtasks: [T028, T029, T030, T031, T032]
phase: Phase 1 - Contrat et base de données
agent: claude
history:
- timestamp: '2026-10-30T12:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: packages/ledger-sql/migrations/0048_offline_device_vendor.sql
create_intent: [packages/ledger-sql/migrations/0048_offline_device_vendor.sql, packages/ledger-sql/tests/tests_offline_device_vendor.sql]
execution_mode: code_change
model: sonnet
owned_files: [packages/ledger-sql/migrations/0048_offline_device_vendor.sql, packages/ledger-sql/tests/tests_offline_device_vendor.sql]
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP07 – Base : terminal, vendeur et configuration datés (migration 0048)

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role :
implementer / Agent : claude). Lis ensuite la fiche de contexte d'implémentation fournie par
l'orchestrateur, ce prompt, puis seulement :

- `contracts/interfaces.md` § 1 (numérotation, CL049) et § 6 (signatures figées) ;
- `research.md` **R-30.3** (heures de référence, exposition), **R-30.4** (configuration et accusés
  cités), **R-30.2** (tables fermées) ;
- `data-model.md` sections `offline_snapshot_media_log`, `offline_snapshot_key`,
  `offline_snapshot_ack` et « Fonctions du terminal et du vendeur » ;
- `spec.md` FR-039 (OP-N69).

Priorité des sources (SPECIFICATION §0.3) : tests exécutables > schéma SQL, `openapi.yaml`,
`sync_protocol.md` > SPECIFICATION > PRD ; contradiction : **signale-la**, ne choisis pas en
silence. Ne modifie jamais un `.sql` généré de `packages/ledger-sql/`
(`schema_grand_livre_cashless.sql`, `tests_grand_livre_cashless.sql`,
`scenario_reference_test.sql`).

Code de référence (`S:` = `packages/ledger-sql/schema_grand_livre_cashless.sql`) :
`device` S:150-176
(`station_name` l.161, `last_snapshot_version` l.166), `offline_snapshot` S:355,
`device_seq_registry` S:1998, `offline_batch` S:2119, `device_config_served` S:2427,
`record_config_served` S:2445 (modèle de garde `assert_tenant`), `policy_in_force` S:2478 ;
`migrations/0022_device_enrollment.sql` : `device_status_history` l.164-182, écritures l.455 et
l.495, `record_device_heartbeat` l.503-524 (modèle d'écriture sur `device`) ;
`0031_vendors.sql` : `assert_vendor_session` l.411-441 ; `0033_payments.sql` :
`record_sale_attribution` l.154-215 ; `0036_cash_sessions.sql` : style d'en-tête.

## Objective

Donner à l'API les lectures et écritures datées que le traitement des lots exige, sans modifier les
fonctions existantes : accusés de snapshot historisés (jamais en recul), état d'un bracelet à la
version citée, configuration en vigueur à une heure, statut et révocation d'un terminal à une heure,
vendeur et attribution d'une vente à l'heure de l'opération, nom de station par fonction, exposition
« non acquittée » d'un terminal. Ces fonctions sont les seules écritures légitimes de ces données
une fois les droits retirés par WP08.

## Périmètre et arbitrages

- Dans le lot : migration `0048_offline_device_vendor.sql` et sa suite pgTAP, **sous le propriétaire
  uniquement** (pas de `SET ROLE` : les tests de droits sont dans WP08, `tests_offline_rights.sql`).
  Chaque fonction : `REVOKE ALL … FROM PUBLIC`, aucun `GRANT` ni `REVOKE` de table (WP08).
- Hors lot : les `GRANT` (WP08) ; les appelants (WP15 accusés, WP18 lots, WP19 traitement) ; les
  règles pures (WP17). `record_sale_attribution` (0033) et `assert_vendor_session` (0031) **ne sont
  pas modifiées** : les variantes `_at` sont des fonctions nouvelles.
- Numérotation : `interfaces.md` § 1 fait foi (0048) ; `data-model.md` écrit « 0047 » pour la table
  d'accusés et les fonctions du terminal : **contradiction signalée, 0048 appliquée**.
- Tables lues, déjà posées : `offline_snapshot`, `offline_snapshot_media_log`,
  `offline_snapshot_key` (WP03, 0044) ; `offline_batch` complétée (WP05, 0046) ;
  `device_config_served`, `device_status_history` (existantes).
- Heure de la base (`clock_timestamp()`), jamais celle de l'appelant, sauf `p_at`/`p_reference`.
- Hypothèse sur le propriétaire (comme 0022, 0036) : tables en `FORCE ROW LEVEL SECURITY`, donc une
  fonction `SECURITY DEFINER` ne s'appuie pas sur la RLS : chaque requête nomme `operator_id`
  (`current_setting('app.operator_id')`) ou passe par `assert_tenant(tenant_of_device(…))`.
- Ordre des verrous (risque du lot) : terminal (`FOR UPDATE`), puis vendeur, puis session, jamais
  l'inverse. Les fonctions `STABLE` ne prennent aucun verrou.

## Subtasks

### T028 – Table d'accusés, `ack_offline_snapshot`, `…_ack_floor`, `…_meta`

**But** : historiser les accusés (R-30.4) et les lire.

**Étapes**
- Table `offline_snapshot_ack (device_id, version)` PK, `operator_id` (FK `party`), `ledger_id`,
  `acked_at timestamptz NOT NULL DEFAULT clock_timestamp()`. RLS `tenant_isolation` ENABLE + FORCE
  (R-30.2), `forbid_mutation` sur `UPDATE`/`DELETE` (modèle S:2440), index `(device_id, acked_at)`.
- `ack_offline_snapshot(p_device, p_version, p_content_sha256)` : `FOR UPDATE` du terminal du
  prestataire (étranger : `no_data_found`). Version inconnue du grand livre du terminal, empreinte
  différente de `offline_snapshot.content_sha256`, ou sans enveloppe pour ce terminal
  (`offline_snapshot_key`) : `CL049`. Insère l'accusé (`ON CONFLICT DO NOTHING` : `acked_at` d'un
  premier accusé ne change pas) ; `device.last_snapshot_version = greatest(ancien, p_version)` :
  **jamais de recul**. Un accusé plus ancien est inscrit, le maximum ne baisse pas.
- `offline_snapshot_ack_floor(p_device, p_before)` : `STABLE`, plus grande version accusée avec
  `acked_at <= p_before`, `0` si aucune.
- `offline_snapshot_meta(p_ledger, p_version, p_device)` : `STABLE`, une ligne (`generated_at`,
  `valid_until`, `published_at`, `wrapped_for_device`) ou aucune si la version est inconnue ou d'un
  autre prestataire. `published_at` : colonne posée par WP03 (lis 0044) ; si absente, signale-le.

**Critère** : accusé v3 puis v2 → ligne v2 inscrite, `last_snapshot_version` reste 3 ; empreinte
fausse → `CL049`, aucune ligne ; `ack_floor` juste à `−1 s` et `+1 s` de `acked_at`.

### T029 – États datés : bracelet, configuration, statut, révocation

**But** : états « tels qu'ils étaient », pour juger une opération datée (R-30.3, R-30.4).

**Étapes**
- `offline_media_state_at(p_ledger, p_token_hash, p_version)` : `STABLE`. Lit
  `offline_snapshot_media_log` : dernière ligne de version `<= p_version`. Rend `(in_snapshot,
  media_status, batch_status, batch_event_id, wallet_status)` ; aucune ligne si le bracelet n'a
  aucune ligne `<= p_version` ou si le grand livre n'est pas du prestataire.
- `offline_config_in_force(p_device, p_config_id, p_at, p_tol)` : `STABLE`, `jsonb`. Rend la
  `policy` de `device_config_served` si `p_config_id` est **la dernière configuration servie** au
  terminal avec `served_at <= p_at + p_tol` ; sinon `NULL` (plus ancienne, postérieure, d'un autre
  terminal, inconnue : même résultat). Ne remplace pas `policy_in_force`.
- `device_status_at(p_device, p_at)` : `STABLE`, `text`. Dernier `to_status` de
  `device_status_history` avec `at <= p_at` ; `NULL` avant la première ligne. Terminal étranger :
  `no_data_found`.
- `device_revoked_at(p_device)` : `STABLE`, `at` de la ligne `to_status = 'REVOKED'` (définitif,
  contrainte 0022:178) ; `NULL` si non révoqué.

**Critère** : terminal `ACTIVE` → `SUSPENDED` → `ACTIVE` : `device_status_at` juste dans chaque
intervalle ; configuration servie à `t`, remplacée à `t+10 s` : la plus ancienne n'est jamais rendue
une fois la suivante servie avant `p_at + p_tol`.

### T030 – `assert_vendor_session_at`, `record_sale_attribution_at`, `set_device_station_name`

**But** : vendeur et attribution à l'heure de l'opération ; nom de station par fonction (FR-039).

**Étapes**
- `assert_vendor_session_at(p_device, p_session, p_at)` : copie contrôlée de 0031:411 avec `p_at` au
  lieu de `now()` : session du prestataire et du terminal, `opened_at <= p_at`, `closed_at IS NULL
  OR closed_at > p_at`, `expires_at > p_at` ; vendeur `ACTIVE` et non bloqué à `p_at` si les
  colonnes de `vendor` le permettent. Si le blocage n'est pas daté, applique l'état courant et
  **signale-le**. Mêmes verrous `FOR SHARE` (vendeur puis session), sinon `CL032`. Rend `vendor_id`.
- `record_sale_attribution_at(<arguments de 0033:154>, p_at)` : même logique, session jugée à
  `p_at`, terminal = celui de l'écriture. Mêmes erreurs (`CL032`, `CL001`, `23505`).
  N'appelle pas la fonction d'origine ; un test compare les deux sur un cas « maintenant ».
- `set_device_station_name(p_device, p_name, p_actor)` : `FOR UPDATE` du terminal du prestataire ;
  nom de 1 à 200 caractères après `btrim`, ou `NULL` pour effacer, sinon `CL001` ; acteur : même
  contrôle que `set_device_status` (0022) ; seule colonne écrite : `station_name`. Terminal
  `REVOKED` : refus comme `record_device_heartbeat`.

**Critère** : session fermée à `t` : valide à `t − 1 s`, `CL032` à `t + 1 s` ; session d'un autre
terminal : `CL032` ; nom de 201 caractères : `CL001`.

### T031 – `offline_device_exposure` (R-30.3)

**But** : exposition « non acquittée » du terminal avant l'opération `p_seq`, par bracelet et au
total (porteur, 30/10/2026 : stricte, acquittement de moins de 120 s compté).

**Étapes**
- `RETURNS TABLE (per_media bigint, per_device bigint)`, `STABLE`, une ligne. `p_tol` = 120 s,
  `p_reference` = `min(occurred_at_corrigé(p_seq), received_at)` : calculés par l'API (WP19).
- Ventes du terminal : lignes de `device_seq_registry` de numéro `< p_seq`,
  `transaction_id` non nul, `outcome IN ('ACCEPTED','ACCEPTED_WITH_SHORTFALL')`, jointes à
  `journal_transaction` (`media_id`, `device_id`). Elle ne porte pas de montant : prends celui
  débité au bracelet dans `posting` ou `sale_line` (0033), dis lequel, signale tout doute.
- Acquittée = résultat rendu **avant `p_reference − p_tol`** : `offline_batch.completed_at` (via
  `batch_id`) pour le canal `BATCH`, `device_seq_registry.recorded_at` pour `ONLINE`. Acquittée à
  `p_reference − p_tol` pile ou plus tard : **compte** (strict).
  `WAIVED`, `VOID`, `REJECTED` : jamais comptés.
- `per_media` : somme pour `p_media` ; `per_device` : somme du terminal. `0`/`0` si rien. Terminal
  étranger : `no_data_found`.

**Critère** : R-30.3 (500 opérations datées `réception + 119 s` : plafond par terminal tenu) ;
vente acquittée à `p_reference − 121 s` non comptée, à `− 119 s` comptée.

### T032 – Suite `tests_offline_device_vendor.sql`

Gabarit : en-tête de `tests/tests_cash_sessions.sql` (`\set ON_ERROR_STOP`, `BEGIN`, `no_plan()`,
`ROLLBACK` final, `pg_temp.id()`, deux prestataires A et B, aucune dépendance à des données
existantes, aucun `SET ROLE`).
- T028 : accusé, monotonie, `CL049` (empreinte, version inconnue, sans enveloppe), `ack_floor`,
  `meta` d'un autre prestataire, immuabilité de la table.
- T029 : états aux quatre bornes (avant, pendant, après, révoqué) ; configuration périmée, future,
  d'un autre terminal.
- T030 : trois cas par fonction `_at` ; équivalence avec `record_sale_attribution` à `now()`.
- T031 : les cas 119 s et 121 s, deux bracelets, `WAIVED` non compté.
- Chaque fonction : `SECURITY DEFINER`, `search_path = public, pg_temp`, non exécutable
  par `PUBLIC`.

## Sécurité

- Un `p_at` trop libre peut faire passer une vente d'un vendeur bloqué : bornes testées des deux
  côtés. Un `ack_offline_snapshot` qui recule `last_snapshot_version` rouvre une version périmée.
- `set_device_station_name` devient la seule écriture de `station_name` : acteur et prestataire
  vérifiés, sinon un terminal étranger se renomme.
- Tout écart qui affaiblit la sécurité (contrôle de prestataire retiré ou reporté, verrou omis,
  `GRANT` posé ici, état courant à la place d'un état daté sans le dire) est soumis au porteur
  AVANT d'être codé (règle 1 de `CLAUDE.md`).
- À faire relire par une personne : `0048_offline_device_vendor.sql`
  (`database-rights.md` la liste) ;
  l'agent qui l'écrit ne vaut pas relecture indépendante.

## Tests

- Base du lot `cashless_wp07` (pas `cashless_test`) : `reset-db`, puis
  `pg_prove -d cashless_wp07 packages/ledger-sql/tests/tests_offline_device_vendor.sql`.
- Relance aussi `tests_definer_search_path.sql`, `tests_vendors.sql`, `tests_payments.sql` et
  `tests_device_enrollment.sql` (fonctions voisines, elles restent vertes).
- L'orchestrateur relance la suite complète en série.

## Ce que le relecteur doit casser

1. `ack_offline_snapshot` : version d'un autre terminal ou prestataire, empreinte tronquée ; accusés
   concurrents v3 et v2 : le maximum ne baisse jamais.
2. `offline_config_in_force` : `config_id` d'un autre terminal ; `served_at = p_at + p_tol` exact
   et `+ 1 µs`.
3. `device_status_at` : `p_at` antérieur à l'enrôlement, futur, terminal étranger.
4. `assert_vendor_session_at` : session fermée une seconde avant `p_at` ; vendeur bloqué ; session
   d'un autre terminal ; appels concurrents (pas d'interblocage avec `record_device_seq`).
5. `record_sale_attribution_at` : seconde attribution (`23505`), vente d'un autre prestataire.
6. `offline_device_exposure` : vente `WAIVED`, `VOID` ou d'un autre terminal comptée ; frontière
   `p_reference − p_tol` à la microseconde.
7. `set_device_station_name` : terminal d'un autre prestataire, acteur suspendu, 201 caractères.
8. Une fonction sans `search_path = public, pg_temp` ou exécutable par `PUBLIC`.

## Definition of Done

- [ ] `0048_offline_device_vendor.sql` appliquée sur base propre et sur base avec lignes ; en-tête
      complet (contenu, codes, hypothèse sur le propriétaire, ordre des verrous) ; aucun `GRANT`.
- [ ] Table et fonctions de `interfaces.md` § 6 : signatures exactes, `SECURITY DEFINER` (sauf
      mention), `search_path = public, pg_temp`, `REVOKE ALL … FROM PUBLIC`.
- [ ] `tests_offline_device_vendor.sql` vert ; suites voisines et de référence vertes sur
      `cashless_wp07`.
- [ ] Rapport : signatures réelles, écarts au plan et leur sens (blocage du vendeur daté ou non,
      source du montant, `published_at`), contradictions (0047/0048), commandes et résultats pour la
      matrice d'acceptation (FR-039 et FR de datation).

## Branch Strategy

- Branche de planification et de fusion : `feat/hors-ligne-snapshots-lots`.
- Worktree par lane, calculée dans `lanes.json`.
- Commande : `spec-kitty agent action implement WP07 --agent claude --mission
  hors-ligne-snapshots-lots-01M645RN`.

## Activity Log

- 2026-10-30T12:00:00Z – claude – Prompt generated via /spec-kitty.tasks
