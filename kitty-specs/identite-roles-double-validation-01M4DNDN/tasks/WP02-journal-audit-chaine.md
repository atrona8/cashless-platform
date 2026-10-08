---
work_package_id: WP02
title: Journal d'audit chaîné et scellé
dependencies:
- WP01
requirement_refs:
- FR-002
- FR-018
- FR-019
planning_base_branch: feat/identite-roles
merge_target_branch: feat/identite-roles
branch_strategy: Planning artifacts for this mission were generated on feat/identite-roles. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/identite-roles unless the human explicitly redirects the landing branch.
subtasks:
- T005
- T006
- T007
- T008
- T009
phase: Phase 1 - Base de données
history:
- timestamp: '2026-10-08T13:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: packages/ledger-sql/migrations/0004_audit_log.sql
create_intent:
- packages/ledger-sql/migrations/0004_audit_log.sql
- packages/ledger-sql/tests/tests_audit_log.sql
execution_mode: code_change
owned_files:
- packages/ledger-sql/migrations/0004_audit_log.sql
- packages/ledger-sql/tests/tests_audit_log.sql
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP02 – Journal d'audit chaîné et scellé

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan`. Lis `contracts/audit-chain.md` (format canonique,
empreintes, scellement, vérification : il fait foi), `data-model.md` (`audit_log`, `audit_seal`), `research.md`
R-07, SPECIFICATION §13.3 et §13.7, et dans le schéma de référence le modèle à suivre : `ledger_seal`,
`ledger_seal_guard`, `ledger_seal_genesis`, `seal_ledger`, `ledger_lines_sha256`, `verify_ledger_seals`.

## Objective

Migration `0004_audit_log.sql` : journal d'audit en ajout seul, chaîné ligne à ligne par prestataire (et une
chaîne plateforme), scellements périodiques chaînés, et fonction de vérification qui détecte toute altération.

## Context

- Exigences : FR-002, FR-018, FR-019, NFR-004, NFR-007 ; décision du porteur du projet (chaîne et scellement
  maintenant, copie externe en mission 9).
- `roles.sql` rendra `INSERT, UPDATE` sur `audit_log`/`audit_seal` et `EXECUTE` sur les fonctions : les droits
  justes sont posés par `post-roles.sql` (WP03). Ici, la protection passe par les déclencheurs (refus pour **tout**
  rôle, propriétaire compris, sauf désactivation explicite du déclencheur pour les tests d'altération).
- Volume faible (actions d'administration) : le verrou par chaîne est acceptable.

## Branch Strategy

Planification et merge sur `feat/identite-roles`. Commande : `spec-kitty agent action implement WP02 --agent claude`.

## Subtasks

### T005 — `audit_log`

- Colonnes de `data-model.md`. `chain_key` calculé par le déclencheur (`coalesce(operator_id,
  '00000000-0000-0000-0000-000000000000')`), `seq`, `occurred_at`, `prev_hash`, `row_hash` toujours posés par le
  déclencheur (valeurs fournies écrasées).
- BEFORE INSERT : `PERFORM pg_advisory_xact_lock(hashtextextended('audit-chain:' || chain_key, 0))` ; dernière ligne
  de la chaîne (`ORDER BY seq DESC LIMIT 1`) ; `seq` = +1 ou 1 ; `prev_hash` = son `row_hash` ou la genèse ;
  `row_hash` = `sha256(prev_hash || convert_to(audit_row_canonical(NEW), 'UTF8'))`.
- BEFORE UPDATE OR DELETE : `RAISE … USING ERRCODE = 'CL001'` (« journal d'audit en ajout seul »).
- RLS forcée : `tenant_isolation` sur `operator_id` (les lignes plateforme, `operator_id` NULL, ne sont lisibles
  par personne sous RLS ; l'API ne les relit pas).
- Index `UNIQUE (chain_key, seq)` ; index `(operator_id, occurred_at)`.

### T006 — Ligne canonique

- `audit_row_canonical(r audit_log) RETURNS text IMMUTABLE` : `concat_ws('|', …)` des champs dans l'ordre du contrat,
  `occurred_at` formaté `to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US')`, `before`/`after`
  en `jsonb::text`, `seq::text`. Un champ NULL est omis (comportement de `concat_ws`, comme `ledger_lines_sha256`).
- `audit_chain_genesis(p_chain uuid) RETURNS bytea` : `sha256(convert_to('CASHLESS/AUDIT/v1','UTF8') ||
  uuid_send(p_chain))`.

### T007 — `audit_seal` et `seal_audit`

- Table de `data-model.md` ; garde : ajout seul, seule `external_ref` passe de NULL à une valeur, une fois (copier
  `ledger_seal_guard`).
- `seal_audit(p_chain uuid, p_min_age interval DEFAULT '5 minutes') RETURNS audit_seal SECURITY DEFINER` : plage =
  dernière `last_seq` scellée + 1 → plus grand `seq` dont `occurred_at <= clock_timestamp() - p_min_age` ; NULL si
  rien ; `rows_sha256 = sha256(string_agg(row_hash, '' ORDER BY seq))` (concaténation binaire : `string_agg` sur
  bytea) ; `seal_hash` selon le contrat (`int8send` pour les bornes, `uuid_send` pour la chaîne) ; numéro = dernier
  + 1 ; premier `prev_seal_hash` = genèse.

### T008 — `verify_audit_chain`

`verify_audit_chain(p_chain uuid, p_since timestamptz DEFAULT '-infinity') RETURNS TABLE (seq bigint, problem text)`
SECURITY DEFINER : parcourt la chaîne dans l'ordre ; signale `seq` manquant, `prev_hash` ≠ `row_hash` précédent,
`row_hash` ≠ recalcul ; pour chaque scellement de la période : `rows_sha256` et `seal_hash` recalculés, chaînage
des `prev_seal_hash`. Aucune ligne = intègre.

### T009 — Tests pgTAP (`tests/tests_audit_log.sql`)

- Chaînage : 3 insertions dans une chaîne → `seq` 1, 2, 3 ; `prev_hash` en chaîne ; genèse correcte ; deux
  prestataires = deux chaînes indépendantes ; valeurs fournies pour `seq`/`row_hash` écrasées.
- Ajout seul : `UPDATE`, `DELETE` refusés (propriétaire compris).
- Scellement : rien à sceller avant 5 min (`p_min_age` par défaut) ; avec `p_min_age => '0'` : un scellement, puis
  un second chaîné ; `external_ref` modifiable une fois ; garde.
- Altérations simulées (en désactivant le déclencheur d'ajout seul : `ALTER TABLE … DISABLE TRIGGER`, en
  propriétaire, dans la transaction de test) : champ modifié, ligne supprimée, ligne insérée au milieu avec un
  `seq` décalé, scellement falsifié → chaque cas produit au moins une ligne de `verify_audit_chain` ; chaîne
  intacte → 0 ligne.
- RLS forcée ; `cashless_app` voit seulement son prestataire.

## Definition of Done

- `test:pgtap` vert ; NFR-007 démontré (4 altérations simulées détectées).

## Risks / Reviewer guidance

- Le format canonique est un contrat : toute divergence avec `contracts/audit-chain.md` est un défaut.
- Vérifier que le verrou consultatif est transactionnel (`xact`) et pris **avant** la lecture de la dernière ligne.
