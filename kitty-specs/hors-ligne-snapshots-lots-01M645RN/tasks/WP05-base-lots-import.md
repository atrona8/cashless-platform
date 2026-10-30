---
work_package_id: WP05
title: 'Base : lots, registre, trace RETRY, import (migration 0046)'
dependencies: []
requirement_refs:
- FR-029
- FR-031
- FR-035
- NFR-012
planning_base_branch: feat/hors-ligne-snapshots-lots
merge_target_branch: feat/hors-ligne-snapshots-lots
branch_strategy: Planning artifacts for this mission were generated on feat/hors-ligne-snapshots-lots. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/hors-ligne-snapshots-lots unless the human explicitly redirects the landing branch.
base_branch: kitty/mission-hors-ligne-snapshots-lots-01M645RN
base_commit: ab7eaa9c66d882cf70dd73b6338e6df1af8cb417
created_at: '2026-10-30T11:35:04.592647+00:00'
subtasks: [T019, T020, T021, T022, T023]
phase: Phase 1 - Contrat et base de données
agent: claude
history:
- timestamp: '2026-10-30T12:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: packages/ledger-sql/migrations/0046_offline_batches.sql
create_intent: [packages/ledger-sql/migrations/0046_offline_batches.sql, packages/ledger-sql/tests/tests_offline_batches.sql]
execution_mode: code_change
model: sonnet
owned_files: [packages/ledger-sql/migrations/0046_offline_batches.sql, packages/ledger-sql/tests/tests_offline_batches.sql]
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP05 – Base : lots, registre, trace RETRY, import (migration 0046)

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role :
implementer / Agent : claude). Lis ensuite la fiche de contexte d'implémentation fournie par
l'orchestrateur, ce prompt, puis seulement :

- `contracts/interfaces.md` § 1 (CL052, CL053) et § 4 (signatures figées, forme du résultat) ;
- `research.md` R-10, R-11, R-18, R-19 et **R-30.3, R-30.7, R-30.10, R-30.11** (font foi) ;
- `data-model.md` sections `offline_batch`, `offline_op_result`, `offline_batch_retry`,
  `device_journal_import` ; `contracts/batches.md` § Traitement (points 9, 10), § Reprise, § Trous, § Import ;
- `docs/DECISIONS_ADR.md` ADR-139 (écart nommé) ; `spec.md` FR-015, FR-016, FR-029 à FR-035.

Code de référence : `schema_grand_livre_cashless.sql` l.1998-2037 (`device_seq_registry`, immuable),
l.2040 (`record_device_seq`), l.2089 (`waive_seq_gap`, contrôles `CL012`/`CL010`), l.2119-2145
(`offline_batch`), l.2183-2267 (`open_offline_batch`), l.2270-2287 (`complete_offline_batch`), l.1973-1976
(`chain_step`, `device_chain_genesis`), l.1990 (`max_seq_jump`), l.842 (`anomaly`) ;
`migrations/0023_device_tokens_nonces.sql:312-335` (ordre des verrous : terminal `FOR UPDATE` d'abord) et
l.19-25 (hypothèse du propriétaire). Priorité des sources (SPECIFICATION §0.3) : tests exécutables > schéma
SQL, `openapi.yaml`, `sync_protocol.md` > SPECIFICATION > PRD ; contradiction : **signale-la**. Aucun
`.sql` généré modifié.

## Objective

Compléter la base des lots hors ligne : contrôles d'ouverture ajoutés (jamais retirés), résultat de chaque
opération écrit par la base, trace `RETRY` qui rend admissible un numéro sans ligne de registre (décision du
porteur, R-30.11, ADR-139), et import du journal d'un terminal `REVOKED` par une voie jumelle qui ne passe
pas par l'ouverture ordinaire. C'est le seul lot qui remplace `complete_offline_batch` : fichier à relire
par une personne.

## Périmètre et arbitrages

- Dans le lot : colonnes, tables, fonctions de § 4 de `interfaces.md`, suite pgTAP **sous le propriétaire
  uniquement** (pas de `SET ROLE` : droits en WP08). `REVOKE ALL … FROM PUBLIC` sur chaque fonction ; aucun
  `GRANT`. Toute table nouvelle : `operator_id`, `tenant_isolation` ENABLE + FORCE (R-30.2).
- Hors lot : `open_offline_anomaly` et le reste des anomalies (WP06, 0047) ; `waive_seq_gap` (inchangée) ;
  l'API (WP18 à WP20). Les `INSERT INTO anomaly` déjà présents dans `open_offline_batch` (`CHAIN_BROKEN`,
  `SEQ_GAP`) restent tels quels : WP06 ne les reprend pas, `INSERT` direct n'étant retiré qu'à `cashless_app`.
- **Numéro de migration** : `interfaces.md` § 1 donne 0046 ; `data-model.md` écrit 0045 pour ces objets.
  0046 fait foi. Signale-le.
- **Contradiction réglée par R-30.11** : `data-model.md` (et R-11) disent que `complete_offline_batch` admet
  un numéro « retryable dans `p_results` » ; R-30.11 et `interfaces.md` exigent la **ligne
  `offline_batch_retry` du même lot**. Fais ce que dit R-30.11 : `p_results` seul n'admet plus rien.
- Écart nommé (règle 1) déjà accepté par le porteur : le numéro `RETRY` sans registre est la seule
  exception à I2 ; le test T023 doit échouer si la limite s'élargit. ADR/`POINTS_OUVERTS` : WP21.
- Hypothèse de propriétaire (0023 l.19-25) : aucune fonction de ce lot n'en a besoin, toutes prennent un lot,
  un terminal ou un import et font `assert_tenant`.

## Subtasks

### T019 – `open_offline_batch` complétée, colonnes, `offline_batch_state`

**But** : contrôles ajoutés, aucun retiré (C-004 : n'affaiblis rien).

**Étapes**
- `offline_batch.received_via` : remplacer la contrainte (nom auto `offline_batch_received_via_check`,
  vérifie-le) pour admettre `'IMPORT'` ; `size_bytes int NULL CHECK (size_bytes BETWEEN 1 AND 1048576)` ;
  `import_id uuid NULL` (FK `device_journal_import`, créée en T022 : ordre de la migration).
- Refonte en deux niveaux : une fonction interne `open_offline_batch_core(…, p_allow_revoked boolean,
  p_import uuid)` (aucun `GRANT`, jamais appelée hors DEFINER) reprend le corps de `open_offline_batch`
  (l.2183) **à l'identique** ; `open_offline_batch` et `open_imported_batch` (T022) sont deux enveloppes.
- Contrôles ajoutés : (1) débordement : `p_seq_from + n − 1` calculé sans dépassement de `bigint` ; si
  `p_seq_from > 9223372036854775807 − n` : `CL011` (aujourd'hui l'addition lève `22003`) ; `p_seq_from >= 1`
  sinon `CL011` ; (2) `p_ledger` doit être le grand livre de l'événement du terminal (`device.event_id`,
  grand livre de cet événement) sinon `CL001` ; terminal sans événement : `CL001` ; (3) `p_via` :
  `open_offline_batch` n'accepte que `CENTRAL` et `EDGE` (`IMPORT` : `CL001`).
- Taille : ajoute à la signature `p_size_bytes int DEFAULT NULL` en dernier paramètre (DROP de l'ancienne
  signature à 9 paramètres puis CREATE ; les appels à 9 arguments continuent de marcher). Figé en
  `interfaces.md` § 4 (validé par l'orchestrateur le 30/10/2026).
- `offline_batch_state(p_batch)` `STABLE` : colonnes figées ; `missing_seqs` = trous **actuels** du terminal
  (`device_missing_seqs`, 1 000 au plus) tant que le lot est `PROCESSING|COMPLETED`, `results` = `b.results`
  (NULL avant clôture). Lot inconnu ou d'un autre prestataire : aucune ligne.

**Critère** : tous les cas de `open_offline_batch` des suites existantes restent verts ; `seq_from` à 2^63−1 : `CL011`.

### T020 – `offline_batch_retry`, `record_offline_retry`, `complete_offline_batch` remplacée

**But** : la trace `RETRY` (R-30.11, ADR-139) et la clôture qui la respecte.

**Étapes**
- Table `offline_batch_retry (batch_id, seq)` PK, `operator_id`, `device_id`, `reason` (`CHECK = 'INSUFFICIENT_FUNDS_RETRY'`),
  `created_at`, `closed_at`, **`alerted_at timestamptz NULL`** (ajout : l'alerte à 24 h doit être unique,
  WP06/WP13 le lisent ; signale-le comme ajout à `interfaces.md`). FK `offline_batch`. Seules évolutions
  permises : `closed_at` et `alerted_at` posés une fois (déclencheur) ; aucune suppression.
- `record_offline_retry(p_batch, p_seq, p_reason)` : `assert_tenant`, lot `PROCESSING`, `p_seq` dans la plage
  du lot, **aucune ligne de registre** pour ce numéro (sinon `CL001`), `p_reason` exact ; idempotent ; ne
  rouvre pas une ligne close.
- Fermeture : déclencheur `AFTER INSERT ON device_seq_registry` (DEFINER, `search_path = public, pg_temp`)
  pose `closed_at` sur toute ligne ouverte `(device_id, seq)` (un résultat final, y compris `WAIVED`, clôt la
  trace, quel que soit le lot qui l'apporte). Ne modifie pas `record_device_seq`.
- `complete_offline_batch(p_batch, p_results)` : corps de l'existant (l.2270) ; le numéro sans résultat final
  au registre n'est admis **que s'il a une ligne `offline_batch_retry` ouverte de ce lot** ; sinon `CL001`
  (message : numéro et lot). Un numéro avec trace d'un autre lot, ou close, n'est pas admis. Le reste inchangé
  (idempotence sur `COMPLETED`, lot rejeté `CL001`, verrou `FOR UPDATE`).

**Cas limites** : trace écrite puis résultat final apporté par un autre lot avant la clôture : le numéro est
au registre, la trace est close, la clôture passe sans elle.

**Critère** : clôture refusée pour un numéro sans registre ni trace ; admise avec trace ouverte.

### T021 – Résultats d'opération et pré-contrôle de levée

**Étapes**
- Table `offline_op_result (batch_id, seq)` PK, `operator_id`, `result jsonb`, `created_at`. Immuable
  (`forbid_mutation`). `record_offline_op_result(p_batch, p_seq, p_result)` : plage du lot, `assert_tenant`,
  `p_result` objet JSON avec `seq` égal à `p_seq` ; **même jsonb** → rien ; autre jsonb → `CL002` (la
  comparaison est octet pour octet côté API, JCS ; ici, égalité de `jsonb`). Lot `PROCESSING`, `COMPLETED`
  ou `REJECTED` (reprise après abandon) admis.
- `offline_op_results(p_batch)` `STABLE` : lignes par `seq`. `offline_batch_retries_open(p_device)` `STABLE` :
  numéros à trace ouverte du terminal, croissants.
- `check_seq_gap_waivable(p_device, p_seq)` `STABLE`, **sans effet, sans `FOR UPDATE`** : mêmes contrôles
  que `waive_seq_gap` (l.2089) dans le même ordre, mêmes codes (`CL012` pas un trou, `CL010` lot en cours
  qui le couvre). Un test prouve que les deux restent d'accord sur les quatre cas limites.

**Critère** : deux écritures du même résultat ne créent qu'une ligne ; un résultat différent lève `CL002`.

### T022 – Import du journal

**But** : voie jumelle pour un terminal `REVOKED`, une seule fois (R-30.10, FR-035).

**Étapes**
- Table `device_journal_import` (`data-model.md`) : `id uuid`, `operator_id`, `device_id`, `batches jsonb`
  (≤ 20 éléments, chacun avec au moins `batch_id` et `seq_from` ; forme à rapporter pour WP20),
  `batches_sha256 bytea(32)`, `summary jsonb`, `status` (`PENDING`, `PROCESSING`, `APPLIED`, `FAILED`,
  `REJECTED`), `reason`, `requested_by`, `approved_by`, `result jsonb`, `created_at`, `applied_at`. Pas de
  colonne `approval_request_id` (aucune fonction ne l'écrirait ; le lien est dans la charge de la demande
  d'approbation : signale-le). `batches` et `batches_sha256` immuables après création (déclencheur).
- `create_device_journal_import(p_device, p_batches, p_batches_sha256, p_summary, p_reason, p_actor)` :
  terminal `REVOKED` sinon `CL052` ; ≤ 20 lots, `p_batches` tableau, empreinte de 32 octets, `p_reason`
  >= 10 caractères, `p_actor` non nul, aucun import `PENDING|PROCESSING` du terminal (sinon `CL010`). La base
  ne recalcule pas l'empreinte JCS (l'API l'a fait) ; elle la stocke.
- `begin_device_journal_import(p_import, p_batches_sha256, p_approver)` : `p_approver <> requested_by`
  (`CL001`) ; empreinte égale à la stockée sinon `CL053` ; `APPLIED|FAILED|REJECTED` : `CL053` ; aucun lot
  `PROCESSING` du terminal hors cet import (`CL010`) ; `PENDING|PROCESSING` → `PROCESSING` (idempotent).
- `open_imported_batch(…)` : enveloppe de `open_offline_batch_core` avec `p_allow_revoked = true`, `p_via =
  'IMPORT'`, `import_id` posé, grand livre pris sur l'événement du terminal ; import en `PROCESSING`, terminal
  de l'import, `p_batch` listé dans `batches` (`batch_id`, `seq_from`) sinon `CL001`.
- `finish_device_journal_import(p_import, p_status, p_result)` : `PROCESSING` seulement, `APPLIED` ou `FAILED`
  (autre : `CL001`), `applied_at` posé. `device_journal_import_view(p_import, p_with_batches boolean DEFAULT
  false)` `STABLE` : la ligne, `batches` à NULL sauf demande (figé en `interfaces.md` § 4).
- `device_journal_imports_processing()` DEFINER, `STABLE` (décision du porteur, DM
  `01M667Y1J4DT3HY96ZBCXXMXBT`, ADR-140) : `(import_id, operator_id)` des imports `PROCESSING` de **tous**
  les prestataires, rien d'autre (ni `batches`, ni terminal, ni résumé). Propriétaire qui ignore la RLS
  (même hypothèse que `offline_seq_gaps_to_alert`, WP06) ; colonnes figées, testées.

**Critère** : import d'un terminal `ACTIVE` : `CL052` ; deuxième `begin` après `APPLIED` : `CL053`.

### T023 – Suite `tests_offline_batches.sql`

**Étapes** (gabarit `tests_cash_sessions.sql`, `no_plan()`, ROLLBACK, données propres, prestataires A et B)
- Ouverture : débordement `CL011`, grand livre d'un autre événement `CL001`, `IMPORT` refusé par la voie
  ordinaire, renvoi du même lot (rend la ligne), lot différent sous le même `batch_id` `CL002`, taille.
- **Clôture sans trace refusée** ; avec trace ouverte admise ; trace d'un autre lot ou close refusée ;
  test de borne qui échoue si `complete_offline_batch` admet un numéro sans trace (ADR-139).
- `record_offline_retry` : idempotent, numéro déjà au registre refusé, trace close par `record_device_seq`
  puis par `WAIVED`. `record_offline_op_result` : rejeu égal, rejeu différent `CL002`, hors plage.
- `check_seq_gap_waivable` identique à `waive_seq_gap` (quatre cas) et sans effet (rien n'est écrit).
- Import : terminal actif `CL052`, > 20 lots, empreinte différente `CL053`, **import rejoué**, lot en vol
  `CL010`, `open_imported_batch` sur terminal `REVOKED` et lot non listé, même approbateur que le demandeur.
- Autre prestataire sur chaque fonction ; RLS forcée sur les trois tables ; `search_path` des fonctions.

## Sécurité

- **À faire relire par une personne** : `complete_offline_batch` remplacée, `open_offline_batch_core`,
  `begin_device_journal_import`, `open_imported_batch` (règle 4 de `CLAUDE.md`).
- Un numéro sans registre ne passe que par la trace ; l'import ne contourne que le statut `REVOKED`, jamais
  la chaîne, la plage ni l'unicité du lot. Le canal `IMPORT` n'est pas ouvrable par la voie ordinaire.
- Règle 1 : tout écart qui affaiblit la sécurité (contrôle d'ouverture retiré, trace élargie, import sans
  approbateur distinct) est soumis au porteur AVANT d'être codé.

## Tests

- `reset-db` puis `pg_prove -d cashless_wp05 packages/ledger-sql/tests/tests_offline_batches.sql` (base du
  lot, pas `cashless_test`). Relance les suites existantes qui touchent les lots, `device_seq` et
  `tests_definer_search_path.sql` ; `tests_execute_grants.sql` peut échouer sur les fonctions nouvelles.
- L'orchestrateur relance tout en série.

## Ce que le relecteur doit casser

1. Clore un lot dont un numéro n'a ni registre ni trace ; puis avec une trace d'un autre lot, ou close.
2. Ouvrir un lot `CENTRAL` avec `p_via = 'IMPORT'`, ou un lot d'un terminal `REVOKED` par la voie ordinaire.
3. `p_seq_from` proche de 2^63 : aucune erreur `22003`, seulement `CL011`.
4. Importer deux fois le même journal, ou pendant qu'un lot du terminal est `PROCESSING`.
5. Approuver son propre import ; approuver avec une empreinte autre que celle demandée.
6. `check_seq_gap_waivable` et `waive_seq_gap` en désaccord sur un cas.
7. `record_offline_op_result` avec un `seq` hors plage, un autre `seq` dans le JSON, ou un autre prestataire.
8. Une trace `RETRY` pour un numéro déjà final, ou rouverte après sa clôture.

## Definition of Done

- [ ] `0046_offline_batches.sql` appliquée sur base propre ; en-tête (codes, ADR-139, ordre des verrous,
      raison de la signature élargie) ; aucun `GRANT`.
- [ ] Toutes les fonctions : `search_path = public, pg_temp`, `REVOKE ALL … FROM PUBLIC`.
- [ ] `tests_offline_batches.sql` vert ; suites existantes vertes sur `cashless_wp05` (hors listes figées).
- [ ] Rapport : signatures réelles ; ajouts à `interfaces.md` (`alerted_at`, `p_size_bytes`, `p_with_batches`,
      forme de `batches`, pas de `approval_request_id`) ; contradictions ; fichiers à relire ; matrice
      (FR-015, FR-016, FR-029 à FR-035).

## Branch Strategy

- Branche de planification et de fusion : `feat/hors-ligne-snapshots-lots`.
- Worktree par lane, calculée dans `lanes.json`.
- Commande : `spec-kitty agent action implement WP05 --agent claude --mission
  hors-ligne-snapshots-lots-01M645RN`.

## Activity Log

- 2026-10-30T12:00:00Z – claude – Prompt generated via /spec-kitty.tasks
