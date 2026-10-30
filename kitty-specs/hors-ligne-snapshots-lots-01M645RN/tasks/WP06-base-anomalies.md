---
work_package_id: WP06
title: 'Base : anomalies et historique du portefeuille (migration 0047)'
dependencies: [WP05]
requirement_refs:
- FR-020
- FR-034
planning_base_branch: feat/hors-ligne-snapshots-lots
merge_target_branch: feat/hors-ligne-snapshots-lots
branch_strategy: Planning artifacts for this mission were generated on feat/hors-ligne-snapshots-lots. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/hors-ligne-snapshots-lots unless the human explicitly redirects the landing branch.
subtasks: [T024, T025, T026, T027]
phase: Phase 1 - Contrat et base de données
agent: claude
history:
- timestamp: '2026-10-30T12:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: packages/ledger-sql/migrations/0047_offline_anomalies.sql
create_intent: [packages/ledger-sql/migrations/0047_offline_anomalies.sql, packages/ledger-sql/tests/tests_offline_anomalies.sql]
execution_mode: code_change
model: sonnet
owned_files: [packages/ledger-sql/migrations/0047_offline_anomalies.sql, packages/ledger-sql/tests/tests_offline_anomalies.sql]
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP06 – Base : anomalies et historique du portefeuille (migration 0047)

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role :
implementer / Agent : claude). Lis ensuite la fiche de contexte d'implémentation fournie par
l'orchestrateur, ce prompt, puis seulement :

- `contracts/interfaces.md` § 5 (signatures figées) ;
- `research.md` R-16, R-17, R-18 (alerte à 24 h), **R-30.11, R-30.13** (font foi) ;
- `data-model.md` sections `anomaly`, `wallet_status_history` ; `contracts/compliance.md` § Table de
  conflit (lecture de `t_blocage`) ; `contracts/batches.md` § Trous ;
- `spec.md` FR-019 à FR-021, FR-026, FR-031, FR-034, FR-036 ; `docs/SPECIFICATION.md` §12.2 (liste
  fermée des types d'anomalie) seulement pour la liste.

Code de référence : `schema_grand_livre_cashless.sql` l.842-868 (`anomaly` : `id uuid`, `CHECK` des types,
`CHECK (amount = 0 OR ledger_id IS NOT NULL)`, déclencheur `anomaly_cash_due_guard` sur `UPDATE OF status`),
l.1993 (`anomaly_seq_gap_once`), l.1235 (`media_status_history`), l.1548 (`media_batch_status_history`),
l.220 (`wallet`), l.262 (`media`, statuts l.283) ; `migrations/0042_wallet_block_causes.sql:36-50` (déclencheur
`wallet_block_cause` déjà sur `wallet`) ; `migrations/0018_status_history_definer.sql` (modèle d'un
déclencheur d'historique `SECURITY DEFINER`) ; `apps/api/src/payments/payments.service.ts:186-189`
(`INSERT` direct de `CLOCK_SKEW` que WP16 remplace) ; `post-roles.sql:754` (constat sur l'`INSERT` direct).
Priorité des sources (SPECIFICATION §0.3) : tests exécutables > schéma SQL, `openapi.yaml`,
`sync_protocol.md` > SPECIFICATION > PRD ; contradiction : **signale-la**. Aucun `.sql` généré modifié.

## Objective

Fermer l'écriture des anomalies derrière des fonctions : colonnes `loss_bearer`, `detail`, `batch_id`,
ouverture idempotente par type, réduction d'un manque par une annulation, marqueurs d'alerte à 24 h. Poser
`wallet_status_history` (déclencheur, ligne de départ) et `offline_block_time`, qui donne l'heure de blocage
de la table de conflit : inconnue, elle vaut « bloqué avant la vente » (manque entier, R-30.13).

## Périmètre et arbitrages

- Dans le lot : colonnes, `open_offline_anomaly`, `reduce_offline_shortfall`, `mark_seq_gap_alerted`,
  `offline_seq_gaps_to_alert`, `offline_retries_to_alert`, `wallet_status_history`, `offline_block_time`, suite
  pgTAP **sous le propriétaire uniquement**. `REVOKE ALL … FROM PUBLIC` sur chaque fonction ; aucun `GRANT`
  (WP08 retire l'`INSERT` direct sur `anomaly` à `cashless_app`). Toute table nouvelle : `operator_id`,
  `tenant_isolation` ENABLE + FORCE (R-30.2).
- Hors lot : le retrait de l'`INSERT` direct (WP08) ; l'écrivain TypeScript (WP16) ; les règles de conflit
  (WP17) ; la boucle d'alerte (WP13).
- **Contradiction de type (§0.3 : le schéma SQL prime)** : `interfaces.md` § 5 écrit `RETURNS bigint`,
  `p_anomaly bigint`, `anomaly_id bigint`, mais `anomaly.id` est un **`uuid`** (l.843, et `psp_chargeback.
  anomaly_id uuid`). Utilise `uuid` partout et signale-le : WP13 et WP16 en dépendent (`AnomalyWriter.open`
  rend une chaîne, pas un `bigint`).
- **Numéro de migration** : `interfaces.md` § 1 donne 0047 ; `data-model.md` dit 0046 pour `anomaly` et
  `wallet_status_history`. 0047 fait foi. Signale-le.
- **Dépendance** : `offline_retries_to_alert` lit `offline_batch_retry` (WP05, 0046, y compris sa colonne
  `alerted_at`) : WP05 est une dépendance déclarée. Ne recrée pas la table.
- Alerte unique d'un trou : marqueur `anomaly.detail.alerted_at` (R-18), pas de colonne. Pour les numéros
  `RETRY` : colonne `offline_batch_retry.alerted_at` (WP05) et fonction ajoutée `mark_offline_retry_alerted`
  (T025) : figée en `interfaces.md` § 5 (ADR-140, accord à `cashless_snapsign` par WP08).
- Hypothèse de propriétaire (0023 l.19-25) : `offline_seq_gaps_to_alert` et `offline_retries_to_alert` n'ont
  pas de prestataire de session (travailleur transversal) : propriétaire qui ignore la RLS, sinon liste vide
  (échec fermé). Les fonctions d'écriture font `assert_tenant` : le travailleur pose `app.operator_id` de la
  ligne lue avant `mark_…`. Dis-le en en-tête.

## Subtasks

### T024 – Colonnes, `open_offline_anomaly`, `reduce_offline_shortfall`

**But** : seule voie d'écriture des anomalies de la mission (R-17).

**Étapes**
- `ALTER TABLE anomaly ADD COLUMN loss_bearer text NULL CHECK (loss_bearer IN ('OPERATOR','ORGANIZER',
  'MERCHANT'))`, `detail jsonb NULL` (objet JSON si présent), `batch_id uuid NULL REFERENCES offline_batch(id)`.
  Les lignes existantes gardent NULL.
- `open_offline_anomaly(p_ledger, p_kind, p_device, p_media, p_seq, p_tx, p_amount, p_loss_bearer, p_detail,
  p_batch)` : liste fermée des onze types de `interfaces.md` § 5, sinon `CL001` (les autres types du `CHECK`
  ne s'ouvrent pas par cette fonction). Prestataire : `assert_tenant(tenant_of_ledger(p_ledger))` ; si
  `p_ledger` est NULL, permis seulement avec `p_amount = 0` et prestataire pris sur le terminal. Terminal,
  bracelet, transaction, lot cités : même prestataire que le grand livre, sinon `CL001`. `p_amount >= 0` ;
  `OFFLINE_SHORTFALL` : montant > 0, transaction non nulle ; `NON_COMPLIANT_OPERATION` : `p_loss_bearer` non
  nul (R-17 : porteur de la perte selon `provided_by`).
- Idempotence par `(kind, device, seq, tx)` avec NULL égaux entre eux : verrou
  `pg_advisory_xact_lock(hashtextextended('anomaly:' || …, 0))` puis recherche d'une ligne identique, que la
  fonction rend. **N'ajoute pas d'index unique** : `open_offline_batch` insère déjà `CHAIN_BROKEN` et
  `SEQ_GAP` à la main (l.2183), un index ferait échouer un renvoi. Pour `SEQ_GAP`, l'index `anomaly_seq_gap_once`
  (l.1993) s'applique : `ON CONFLICT … DO NOTHING` puis relecture.
- `reduce_offline_shortfall(p_original_tx, p_amount, p_reversal_tx)` : `assert_tenant` sur la transaction ;
  anomalie `OFFLINE_SHORTFALL` de `p_original_tx` ; aucune : rien (vente entièrement couverte) ; `p_amount`
  > 0 et <= montant restant sinon `CL001` ; réduit `amount` ; à zéro : `status = 'RESOLVED'`,
  `resolution_tx_id = p_reversal_tx`. Rejouable avec la même `p_reversal_tx` (consigne l'annulation dans
  `detail.reductions`, un élément par `p_reversal_tx`, sans second effet).
- Chemin en ligne : `payments.service.ts:186` doit pouvoir appeler `open_offline_anomaly` pour `CLOCK_SKEW`
  (`p_batch` NULL, `p_seq` NULL, `p_tx` rempli, montant 0) : le test le couvre.

**Cas limites** : montant 0 sans grand livre pour une anomalie de sécurité ; deux ouvertures concurrentes de la même
anomalie (une seule ligne) ; `kind` hors liste, vide ou NULL.

**Critère** : onze types ouvrables, un douzième refusé ; rejeu : même id.

### T025 – Alertes : `mark_seq_gap_alerted`, `offline_seq_gaps_to_alert`, `offline_retries_to_alert`

**But** : une alerte par trou et par numéro `RETRY` (alarme 2, WP13).

**Étapes**
- `offline_seq_gaps_to_alert(p_older_than)` `STABLE` : anomalies `SEQ_GAP` `OPEN`, `created_at < clock_timestamp()
  − p_older_than`, sans `detail.alerted_at`. `p_older_than` NULL, négatif ou > 30 jours : `CL001`. Colonnes figées
  (`anomaly_id uuid`).
- `mark_seq_gap_alerted(p_anomaly)` : `assert_tenant` ; anomalie `SEQ_GAP` seulement (sinon `CL001`) ; pose
  `detail = coalesce(detail, '{}') || {"alerted_at": <clock_timestamp>}` une seule fois ; déjà posé : rien
  (la première date fait foi). Aucune autre colonne modifiée.
- `offline_retries_to_alert(p_older_than)` `STABLE` : lignes `offline_batch_retry` ouvertes (`closed_at IS NULL`),
  `alerted_at IS NULL`, plus vieilles que `p_older_than`. Même contrôle sur `p_older_than`.
- `mark_offline_retry_alerted(p_batch, p_seq)` (ajout) : pose `alerted_at` une fois, `assert_tenant`.

**Critère** : après `mark_…`, la fonction de liste ne rend plus la ligne ; un trou résolu n'est plus listé.

### T026 – `wallet_status_history` et `offline_block_time`

**But** : date de blocage d'un portefeuille, sans ralentir `wallet`.

**Étapes**
- Table `wallet_status_history` : `id bigserial`, `wallet_id` FK, `operator_id`, `from_status`, `to_status`,
  `at timestamptz NOT NULL DEFAULT clock_timestamp()` ; RLS forcée ; `forbid_mutation` (modèle l.2355). Index
  `(wallet_id, at)`.
- Déclencheur `AFTER UPDATE OF status ON wallet … WHEN (OLD.status IS DISTINCT FROM NEW.status)` (et
  `AFTER INSERT` si le statut de départ n'est pas `ACTIVE`), fonction `SECURITY DEFINER`, `search_path =
  public, pg_temp`, qui n'écrit que cette ligne (modèle 0018). `WHEN` obligatoire : `wallet` est chaud
  (`last_activity_at`, soldes) ; mesure ou argumente l'absence de coût dans l'en-tête. Il s'ajoute à
  `wallet_block_cause` (0042) sans le toucher.
- **Ligne de départ** (R-30.13) : pour tout portefeuille déjà `BLOCKED|CLOSED`, une ligne `from_status NULL`,
  `to_status` = statut courant, `at` = la date connue la plus prudente (la plus ancienne entre
  `psp_chargeback.blocked_at` du portefeuille, s'il y en a, et rien d'autre) ; sinon `'-infinity'`. Documente
  la règle choisie en en-tête.
- `offline_block_time(p_media, p_wallet, p_before)` `STABLE`, `assert_tenant` : pour chacune des trois
  sources dont l'état **courant** est bloquant (bracelet `SUSPENDED|BLACKLISTED|REPLACED|RELEASED|RETIRED|
  DESTROYED`, lot de bracelets `SUSPENDED|CLOSED`, portefeuille `BLOCKED|CLOSED`), dernière entrée bloquante de
  son historique à `at <= p_before` ; l'état courant bloquant sans entrée : `'-infinity'`. Résultat :
  `'-infinity'` si une source a une date inconnue, sinon la plus **ancienne** des dates (décision du porteur
  du 30/10/2026, DM `01M667YQ5GEVNHMJ3MHGJBJ220`, `interfaces.md` § 5) ; NULL si aucune source n'est
  bloquante. Pour une source, la date retenue est le début du blocage en vigueur à `p_before`.

**Cas limites** : bracelet sans lot ; portefeuille bloqué puis débloqué puis rebloqué (dernière entrée) ;
`p_before` avant tout blocage (NULL ou date selon l'état courant : documente et teste).

**Critère** : portefeuille bloqué avant migration sans date : `'-infinity'` ; débloqué : NULL.

### T027 – Suite `tests_offline_anomalies.sql`

**Étapes** (gabarit `tests_cash_sessions.sql`, `no_plan()`, ROLLBACK, prestataires A et B)
- Chaque type permis ; type refusé ; idempotence (même quadruplet = même id, NULL compris) ; `CLOCK_SKEW` en
  ligne ; `OFFLINE_SHORTFALL` sans transaction refusé ; `NON_COMPLIANT_OPERATION` sans porteur refusé ;
  grand livre, terminal ou lot d'un autre prestataire refusé.
- `reduce_offline_shortfall` : réduction partielle, totale (`RESOLVED` + `resolution_tx_id`), rejeu, montant
  excessif, vente sans manque (aucun effet).
- Alertes : trou jeune non listé ; vieux listé ; `mark_…` puis plus listé et `alerted_at` inchangé au second
  appel ; trou résolu non listé ; `RETRY` ouvert, alerté, clos ; session de B sur une anomalie de A refusée.
- Historique : changement de statut écrit une ligne, mise à jour sans changement de statut n'en écrit aucune
  (`last_activity_at`), ligne de départ sur des portefeuilles préexistants, `offline_block_time` (les cas
  ci-dessus), RLS forcée, immuabilité, `search_path` des fonctions.

## Sécurité

- **À faire relire par une personne** : `open_offline_anomaly`, `reduce_offline_shortfall`, le déclencheur
  `wallet_status_history` (écrit hors des droits de l'appelant ; règle 4 de `CLAUDE.md`).
- Une anomalie `OFFLINE_SHORTFALL` est une dette envers un commerçant ou un porteur de perte : jamais
  fermée sans l'annulation qui la réduit ; `mark_…` ne change ni statut ni montant. Un `t_blocage` plus
  tardif que la réalité augmente les ventes couvertes : toute lecture plus favorable que celle ci-dessus
  est un écart (règle 1, porteur AVANT d'être codé).
- Aucun `GRANT` ici ; `INSERT` direct sur `anomaly` retiré par WP08, pas par ce lot.

## Tests

- `reset-db` puis `pg_prove -d cashless_wp06 packages/ledger-sql/tests/tests_offline_anomalies.sql` (base du
  lot, pas `cashless_test`). Relance `tests_definer_search_path.sql`, les suites touchant `anomaly` ou
  `wallet` (`tests_cash_sessions.sql`, `tests_psp_topups.sql`, `tests_event_wallet.sql`) ; `tests_execute_grants.sql`
  peut échouer sur les fonctions nouvelles.
- L'orchestrateur relance tout en série.

## Ce que le relecteur doit casser

1. Ouvrir une anomalie du prestataire B avec un grand livre, un terminal ou un lot de A.
2. Deux `open_offline_anomaly` concurrents du même quadruplet : une seule ligne.
3. `reduce_offline_shortfall` deux fois avec la même annulation, ou pour plus que le manque.
4. `mark_seq_gap_alerted` sur une anomalie qui n'est pas un `SEQ_GAP`, ou deux fois (la date change-t-elle ?).
5. Mettre à jour `wallet.last_activity_at` en boucle : aucune ligne d'historique, aucun ralentissement mesurable.
6. Portefeuille bloqué avant la migration : `offline_block_time` ne doit jamais rendre une date postérieure.
7. `offline_block_time` avec un bracelet réactivé depuis : NULL, pas la date de l'ancien blocage.
8. Un `UPDATE` ou `DELETE` direct sur `wallet_status_history` (propriétaire inclus : déclencheur).

## Definition of Done

- [ ] `0047_offline_anomalies.sql` appliquée sur base propre ; en-tête (types permis, `uuid` et non `bigint`,
      hypothèse sur le propriétaire, règle de la ligne de départ, `t_blocage`) ; aucun `GRANT`.
- [ ] Toutes les fonctions : `search_path = public, pg_temp`, `REVOKE ALL … FROM PUBLIC`.
- [ ] `tests_offline_anomalies.sql` vert ; suites existantes vertes sur `cashless_wp06` (hors listes figées).
- [ ] Rapport : signatures réelles ; ajouts à `interfaces.md` (`mark_offline_retry_alerted`, `uuid`) ;
      contradictions et dépendance WP05 ; fichiers à relire ; matrice (FR-019 à FR-021, FR-026, FR-031, FR-034).

## Branch Strategy

- Branche de planification et de fusion : `feat/hors-ligne-snapshots-lots`.
- Worktree par lane, calculée dans `lanes.json`.
- Commande : `spec-kitty agent action implement WP06 --agent claude --mission
  hors-ligne-snapshots-lots-01M645RN`.

## Activity Log

- 2026-10-30T12:00:00Z – claude – Prompt generated via /spec-kitty.tasks
