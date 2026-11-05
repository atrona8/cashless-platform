---
work_package_id: WP02
title: 'Base : politique hors ligne (migration 0043)'
dependencies: []
requirement_refs:
- FR-001
- FR-002
- FR-004
- FR-027
- NFR-014
planning_base_branch: feat/hors-ligne-snapshots-lots
merge_target_branch: feat/hors-ligne-snapshots-lots
branch_strategy: Planning artifacts for this mission were generated on feat/hors-ligne-snapshots-lots. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/hors-ligne-snapshots-lots unless the human explicitly redirects the landing branch.
base_branch: kitty/mission-hors-ligne-snapshots-lots-01M645RN
base_commit: f544d3c4d07cab3997225997096080a082ed1d15
created_at: '2026-10-30T11:25:12.595857+00:00'
subtasks: [T005, T006, T007, T008]
phase: Phase 1 - Contrat et base de données
agent: claude
history:
- timestamp: '2026-10-30T12:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: packages/ledger-sql/migrations/0043_offline_policy.sql
create_intent: [packages/ledger-sql/migrations/0043_offline_policy.sql, packages/ledger-sql/tests/tests_offline_policy.sql]
execution_mode: code_change
model: sonnet
owned_files: [packages/ledger-sql/migrations/0043_offline_policy.sql, packages/ledger-sql/tests/tests_offline_policy.sql]
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP02 – Base : politique hors ligne (migration 0043)

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role :
implementer / Agent : claude). Lis ensuite la fiche de contexte d'implémentation fournie par
l'orchestrateur, ce prompt, puis seulement :

- `contracts/interfaces.md` § 1 (CL045 à CL047) et § 2 (signatures figées) ;
- `research.md` R-02, R-03 et R-20 (OP-N58) ; **R-30.2** (tables fermées) ;
- `data-model.md` section `offline_policy` ; `contracts/database-rights.md` (ligne OP-N58) ;
- `spec.md` FR-001 à FR-005 et FR-039 (OP-N58).

Code de référence : `packages/ledger-sql/schema_grand_livre_cashless.sql` l.747 (`offline_policy`),
l.766 (`effective_offline_policy`), l.2381-2412 (`offline_policy_history`, `bump_offline_policy_version`,
`log_offline_policy`, déclencheur `offline_policy_log`) ; `migrations/0036_cash_sessions.sql` (style :
en-tête, `cash_actor_allowed`, `search_path`, `REVOKE ALL`) et `0021_definer_search_path.sql` (règle du
`search_path`). Priorité des sources (SPECIFICATION §0.3) : tests exécutables > schéma SQL,
`openapi.yaml`, `sync_protocol.md` > SPECIFICATION > PRD ; contradiction : **signale-la**. Ne modifie
jamais un `.sql` généré de `packages/ledger-sql/`.

## Objective

Rendre l'écriture des politiques hors ligne contrôlée : portée vérifiée, version attendue (concurrence
optimiste), recharge espèces hors ligne interdite par contrainte, historique écrit par la base sous
ses propres droits (OP-N58 levée côté fonction), et calcul du risque maximal d'un événement. Les
retraits de droits à `cashless_app` sont posés par WP08, pas ici.

## Périmètre et arbitrages

- Dans le lot : migration `0043_offline_policy.sql` et sa suite pgTAP, **sous le propriétaire
  uniquement** (pas de `SET ROLE` : les tests de droits sont dans WP08, `tests_offline_rights.sql`).
- Hors lot : tout `GRANT`/`REVOKE` de table ou d'`EXECUTE` à un rôle (WP08) ; les routes (WP14).
  Chaque fonction : `REVOKE ALL … FROM PUBLIC`, aucun `GRANT`.
- **Aucune recharge espèces hors ligne** (porteur, 30/10/2026, R-02) : `CHECK (cash_topup_offline IS
  NOT TRUE)`. Contradiction signalée par R-02 avec `sync_protocol.md` §5.4/§7.5, appliquée : la décision.
- Numérotation : `interfaces.md` § 1 fait foi (0043) sur `data-model.md` et `plan.md`.
- Hypothèse sur le propriétaire (comme 0022, 0036) : les tables ont `FORCE ROW LEVEL SECURITY` ; une
  fonction `SECURITY DEFINER` ne s'appuie donc pas sur la RLS. Chaque lecture et écriture nomme
  `operator_id` (celui de la portée) après `assert_tenant`.
- `effective_offline_policy` (S:766) et `policy_in_force` restent inchangées.

## Subtasks

### T005 – Contrainte espèces, déclencheur de portée, `log_offline_policy` DEFINER

**But** : fermer les données et la trace avant d'ouvrir les fonctions.

**Étapes**
- En tête : `UPDATE offline_policy SET cash_topup_offline = false WHERE cash_topup_offline`, avec un
  commentaire qui dit pourquoi (la contrainte suivante refuserait la migration). Puis `ALTER TABLE …
  ADD CONSTRAINT offline_policy_cash_topup_off CHECK (cash_topup_offline IS NOT TRUE)`. Même mise à
  `false` pour `offline_policy_history` n'est PAS nécessaire (historique immuable : ne le touche pas).
- Déclencheur `BEFORE INSERT OR UPDATE` de portée (fonction DEFINER, `search_path = public, pg_temp`),
  CL045 : `OPERATOR_CEILING` ⇒ `scope_id = operator_id` ; `ORGANIZER` ⇒ une `party` de `kind =
  'ORGANIZER'` dont `operator_id` est celui de la ligne ; `EVENT` ⇒ `event.operator_id` égal ;
  `DEVICE` ⇒ `device.operator_id` égal. Un `scope_id` inconnu ou d'un autre prestataire : même code.
- `CREATE OR REPLACE FUNCTION log_offline_policy()` : **corps inchangé**, mais `SECURITY DEFINER SET
  search_path = public, pg_temp` (OP-N58). Le déclencheur `offline_policy_log` garde son lien.
  `REVOKE ALL … FROM PUBLIC`. (Un `CREATE OR REPLACE` efface les réglages : repose-les.)

**Cas limites** : `UPDATE` de `scope_type`/`scope_id` après coup : refuse (CL045) ; la portée ne
change pas. Lignes existantes : la migration est rejouable sur une base qui en contient.

**Critère** : insertion directe d'une portée d'un autre prestataire échoue en CL045 ; `cash_topup_offline
= true` échoue (23514) ; `log_offline_policy` a `prosecdef` et `search_path` fixé.

### T006 – `set_offline_policy`, `clear_offline_policy`, `offline_policy_level`

**But** : seul chemin d'écriture ; signatures figées en `interfaces.md` § 2 (ne les renomme pas).

**Étapes**
- `set_offline_policy(p_scope_type, p_scope_id, p_values jsonb, p_expected_version int, p_actor uuid)
  RETURNS offline_policy`. Détermine le prestataire de la portée (T005), `assert_tenant`, verrouille la
  ligne `FOR UPDATE`. Absente : exige `p_expected_version IS NULL`, sinon CL046 ; présente : exige
  l'égalité, sinon CL046 (y compris `NULL` sur ligne existante). Course à la création : l'unicité
  `(scope_type, scope_id)` levée en `unique_violation` devient CL046.
- Clés de `p_values` : `offline_enabled`, `max_per_sale`, `max_per_media_per_device`,
  `max_total_per_device`, `max_snapshot_age_seconds`, `cash_topup_offline`. Clé absente ou `null` = hérite
  (colonne `NULL`). Une clé inconnue : CL001. Montant < 0 ou non entier : CL001. Âge hors 0 à 86 400 :
  CL001 (stocké en `interval`). `cash_topup_offline` vrai : **CL047** ; faux ou nul accepté.
- `updated_by = p_actor` ; la version monte par le déclencheur existant `bump_offline_policy_version`
  (ne la touche pas à la main) ; l'historique par `log_offline_policy`. `p_actor` est un `app_user.id`
  du prestataire : contrôle-le (personne `ACTIVE` du prestataire, motif de `cash_actor_allowed`) ; les
  rôles de l'acteur restent contrôlés par l'API (WP14), pas ici.
- `clear_offline_policy(p_scope_type, p_scope_id, p_expected_version, p_actor) RETURNS void` : même
  contrôle de version, `DELETE` (le déclencheur écrit la ligne d'historique `deleted`, version + 1).
  Ligne absente : CL046 si une version est attendue, sinon sans effet.
- `offline_policy_level(p_scope_type, p_scope_id) RETURNS offline_policy` : `STABLE`, `NULL` si aucune
  ligne, `assert_tenant` d'abord (portée d'un autre prestataire : CL045).

**Cas limites** : l'écriture sans changement (mêmes valeurs) bump quand même la version : documente-le.
Deux appels concurrents avec la même version attendue : un seul réussit.

**Critère** : cycle créer (version 1) → modifier avec 1 (version 2) → modifier avec 1 (CL046) → effacer ;
l'historique contient une ligne par état, `deleted` à la fin.

### T007 – `offline_max_exposure(p_event uuid)`

**But** : risque maximal d'un événement (R-03), lu par `getEventOfflineRisk` et par chaque réponse de `PUT`.

**Étapes**
- `RETURNS TABLE (device_id uuid, serial text, max_total_per_device bigint, capped boolean)`, `STABLE`,
  `SECURITY DEFINER`. `assert_tenant(tenant_of_event(p_event))`.
- Terminaux de l'événement, du prestataire, non `REVOKED`, `personal_phone` faux, dont
  `effective_offline_policy(device).offline_enabled` est vrai. Valeurs = celles de
  `effective_offline_policy` (déjà bornées par le plafond) ; `capped` = son indicateur (trois montants
  seulement, S:828). Tri par `serial`. La somme est faite par l'API.
- Un événement d'un autre prestataire : même refus que `assert_tenant` (l'API le traduit en 404).

**Critère** : événement à 3 terminaux (un révoqué, un `personal_phone`, un hors ligne coupé par le
plafond) : seuls les terminaux utiles sont rendus, avec les bonnes valeurs.

### T008 – Suite `tests_offline_policy.sql`

**Étapes** (gabarit : en-tête de `tests_cash_sessions.sql`, `no_plan()`, ROLLBACK final, aucune
dépendance à des données existantes)
- Héritage `DEVICE > EVENT > ORGANIZER`, plafond `OPERATOR_CEILING` qui réduit (`capped` vrai pour les
  trois montants seulement, `least()`), plafond qui coupe `offline_enabled`.
- `cash_topup_offline` : contrainte, CL047 par la fonction, migration d'une ligne `true` préexistante
  (rejoue le `UPDATE` de la migration sur une ligne plantée par INSERT avant la contrainte : si c'est
  impossible, prouve-le par `pg_constraint` et dis-le).
- Version attendue (CL046) dans les trois cas de T006 ; portée (CL045) pour les quatre types.
- OP-N58 côté fonction : après `set_offline_policy`, une ligne d'historique existe ; `log_offline_policy`
  est DEFINER. L'historique sous `cashless_app` (INSERT refusé) est prouvé par WP08, pas ici.
- `offline_max_exposure` (T007) ; `search_path` des fonctions (test existant
  `tests_definer_search_path.sql` doit rester vert).

## Sécurité

- Une portée mal contrôlée = un prestataire qui règle la politique d'un autre ; une version mal comparée
  = écrasement silencieux. Les deux sont testées en inversion (autre prestataire, mauvaise version).
- Tout écart qui affaiblit la sécurité (contrôle de portée retiré ou reporté, droit plus large,
  `GRANT` posé ici) est soumis au porteur AVANT d'être codé (règle 1 de `CLAUDE.md`).
- Fichiers à faire relire par une personne : aucun dans ce lot (la trace DEFINER `log_offline_policy`
  est relue avec `post-roles.sql` au lot WP08).

## Tests

- Suite : `psql`/`pg_prove` sur la base du lot `cashless_wp02` (pas `cashless_test`) :
  `reset-db` puis `pg_prove -d cashless_wp02 packages/ledger-sql/tests/tests_offline_policy.sql`.
- Relance aussi `tests_definer_search_path.sql` et `tests_definer_trigger_writers.sql` (§3 attend
  encore `log_offline_policy` INVOKER : cette assertion change au lot WP08 ; signale-la au rapport
  comme « échoue désormais, attendu », sans modifier le fichier).
- L'orchestrateur relance la suite complète en série.

## Ce que le relecteur doit casser

1. `set_offline_policy('EVENT', <événement d'un autre prestataire>, …)` : CL045, aucune ligne écrite.
2. `cash_topup_offline = true` par `INSERT` direct, par `UPDATE` direct, par la fonction.
3. Deux `set_offline_policy` avec la même version attendue : exactement un réussit.
4. Un `scope_id` inexistant ou le `scope_id` d'un autre type (un `device` passé en `EVENT`).
5. `log_offline_policy` : tenter d'y planter `(policy_id, version)` en avance par la fonction ; la
   version est lue sur la ligne verrouillée, pas fournie par l'appelant.
6. Un acteur d'un autre prestataire ou suspendu comme `p_actor`.
7. `offline_max_exposure` : un terminal révoqué ou à téléphone personnel compté ; un événement
   étranger lisible.
8. Une fonction sans `search_path = public, pg_temp` ou exécutable par `PUBLIC`.

## Definition of Done

- [ ] `0043_offline_policy.sql` appliquée sur base propre et sur base avec lignes ; en-tête complet
      (contenu, codes, hypothèse sur le propriétaire) ; aucun `GRANT`/`REVOKE` de table.
- [ ] Toutes les fonctions : `SECURITY DEFINER`, `search_path = public, pg_temp`, `REVOKE ALL … FROM PUBLIC`.
- [ ] `tests_offline_policy.sql` vert ; suites de référence et existantes vertes sur `cashless_wp02`
      (hors l'assertion attendue de `tests_definer_trigger_writers.sql` §3).
- [ ] Rapport : signatures réelles, écarts au plan et leur sens, contradictions signalées, commandes et
      résultats pour la matrice d'acceptation (FR-001 à FR-005, FR-039).

## Branch Strategy

- Branche de planification et de fusion : `feat/hors-ligne-snapshots-lots`.
- Worktree par lane, calculée dans `lanes.json`.
- Commande : `spec-kitty agent action implement WP02 --agent claude --mission
  hors-ligne-snapshots-lots-01M645RN`.

## Activity Log

- 2026-10-30T12:00:00Z – claude – Prompt generated via /spec-kitty.tasks
