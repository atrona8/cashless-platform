---
work_package_id: WP03
title: 'Base : snapshots, brouillon et publication (migration 0044)'
dependencies: []
requirement_refs:
- FR-006
- FR-007
- NFR-006
planning_base_branch: feat/hors-ligne-snapshots-lots
merge_target_branch: feat/hors-ligne-snapshots-lots
branch_strategy: Planning artifacts for this mission were generated on feat/hors-ligne-snapshots-lots. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/hors-ligne-snapshots-lots unless the human explicitly redirects the landing branch.
subtasks: [T009, T010, T011, T012, T013]
phase: Phase 1 - Contrat et base de données
agent: claude
history:
- timestamp: '2026-10-30T12:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: packages/ledger-sql/migrations/0044_offline_snapshots.sql
create_intent: [packages/ledger-sql/migrations/0044_offline_snapshots.sql, packages/ledger-sql/tests/tests_offline_snapshots.sql]
execution_mode: code_change
model: sonnet
owned_files: [packages/ledger-sql/migrations/0044_offline_snapshots.sql, packages/ledger-sql/tests/tests_offline_snapshots.sql]
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP03 – Base : snapshots, brouillon et publication (migration 0044)

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role :
implementer / Agent : claude). Lis ensuite la fiche de contexte d'implémentation fournie par
l'orchestrateur, ce prompt, puis seulement :

- `contracts/interfaces.md` § 1 (CL048) et § 3 (partie WP03, signatures figées, forme d'une entrée) ;
- `research.md` R-05, R-06 (cadence), R-08 et **R-30.5, R-30.6, R-30.8, R-30.9** (font foi) ;
- `data-model.md` sections `offline_snapshot`, `_entry`, `_state`, `_media_log`, `_draft` ;
- `contracts/snapshots.md` § Production, § En-tête signé, § Contenu ; `spec.md` FR-006 à FR-010, FR-038 ;
- `research.md` R-20 ligne OP-N57.

Code de référence : `schema_grand_livre_cashless.sql` l.355 (`offline_snapshot`), l.2291
(`snapshot_signing_key`), l.2314-2356 (`check_offline_snapshot`, déclencheurs `offline_snapshot_check` et
`offline_snapshot_immutable`), l.2362 (`offline_snapshot_rows`, vue `security_invoker`), l.319
(`tag_data_key`), l.1212 (`media_assignment`) ; `migrations/0013_media_api.sql:48` (verrou consultatif
`hashtextextended`) ; `0023_device_tokens_nonces.sql` en-tête l.19-25 (hypothèse du propriétaire).
Priorité des sources (SPECIFICATION §0.3) : tests exécutables > schéma SQL, `openapi.yaml`,
`sync_protocol.md` > SPECIFICATION > PRD ; contradiction : **signale-la**. Aucun `.sql` généré modifié.

## Objective

Poser le stockage et l'inscription des snapshots : contenu et journal par version, brouillon non signé
écrit par `snapshot-content`, publication par `snapshot-signer` seul. La version est calculée par la
base (`max + 1` sous verrou, OP-N57) : personne ne la fournit. La base ne recalcule pas l'empreinte JCS
(le `jsonb` de PostgreSQL n'est pas canonique RFC 8785) ; elle vérifie l'en-tête contre le brouillon, le
signataire (WP13) recalcule l'empreinte.

## Périmètre et arbitrages

- Dans le lot : tables, colonne `content_key_wrapped`, sources, brouillon, publication, purge,
  `discard`, suite pgTAP **sous le propriétaire uniquement** (pas de `SET ROLE` : droits en WP08).
  `REVOKE ALL … FROM PUBLIC` sur chaque fonction ; aucun `GRANT`.
- Hors lot : `offline_snapshot_key` (table des enveloppes), `offline_snapshot_for_device`, rotation des
  clés (WP04) ; accusés (WP07) ; `wallet_status_history` (WP06, migration 0047).
- Toute table nouvelle : `operator_id` (FK `party`), `tenant_isolation` ENABLE + FORCE (R-30.2).
- Hypothèse sur le propriétaire (0023, l.19-25) : les listes sans prestataire de session
  (`offline_snapshot_targets`, `offline_snapshot_drafts_ready`) supposent un propriétaire qui ignore la
  RLS ; avec un propriétaire soumis, elles échouent fermé (liste vide). Toutes les autres fonctions
  prennent un `p_ledger` ou un `p_draft`, font `assert_tenant(tenant_of_ledger(...))` : les processus
  posent `app.operator_id` du prestataire cible avant l'appel (comme `tag-check`). Dis-le en en-tête.
- Pas de dépendance à WP06 : la source incrémentale ne lit pas `wallet_status_history` (voir T010).
- Choix d'implémentation à rapporter (la forme exacte du brouillon n'est pas figée) : voir T011.

## Subtasks

### T009 – Tables et colonne `content_key_wrapped`

**But** : structure de `data-model.md`, sans fonction.

**Étapes**
- `ALTER TABLE offline_snapshot ADD COLUMN content_key_wrapped bytea NOT NULL`, **sans défaut** : la
  migration commence par `DO $$ … IF EXISTS (SELECT 1 FROM offline_snapshot) THEN RAISE EXCEPTION … $$`
  (aucun snapshot n'a jamais été publié : R-01). Le déclencheur d'immutabilité n'est pas touché.
- `offline_snapshot_draft` : `id bigserial`, `operator_id`, `ledger_id`, `kind`, `base_version`,
  `version` (réservée), `header jsonb` (sans signature), `content_key_wrapped bytea NOT NULL`, `status`
  (`OPEN` en cours d'ajout, `READY`, `PUBLISHED`, `DISCARDED`), `discard_reason`, `created_at`.
  Index unique partiel : **un seul brouillon `OPEN|READY` par grand livre** (stricte lecture de
  « max(publiée, brouillons)+1 » de `interfaces.md` ; un second `save_` lève CL048). Signale ce choix.
- `offline_snapshot_entry` `(ledger_id, version, token_hash)` PK, `draft_id` FK, `entry jsonb`,
  `pwd_pack_enc bytea NULL`, `removed boolean`, `operator_id`. **Pas de FK vers `offline_snapshot`**
  (le brouillon précède la ligne publiée) ; `publish_` rattache. `offline_snapshot_state`,
  `offline_snapshot_media_log` : colonnes de `data-model.md`. RLS forcée sur les cinq tables.

**Critère** : migration appliquée sur base propre ; `\d` montre RLS forcée ; `token_hash` en 32 octets.

### T010 – `offline_snapshot_targets`, `offline_snapshot_source`, `offline_snapshot_source_delta`

**But** : lectures du processus `snapshot-content` (signatures figées, `interfaces.md` § 3).

**Étapes**
- `offline_snapshot_targets()` `STABLE` : un grand livre par événement non `LOCKED` qui a au moins un
  terminal éligible (`ACTIVE`, de l'événement, `effective_offline_policy(...).offline_enabled`, pas
  `personal_phone`, `agreement_public_key` non nulle). Colonnes figées ; `last_*` viennent de
  `offline_snapshot` (0 si aucune).
- `offline_snapshot_source(p_ledger)` : lignes de `offline_snapshot_rows` du grand livre, `entry` = les
  **onze clés exactes** de `interfaces.md` § 3 (`pwd_pack_sha256` à `null` : seul le producteur la
  connaît), plus `pwd_pack_enc`, `pwd_pack_dek_id`, `key_index`, `nfc_uid`, `media_id` ; **plus** les
  jetons présents dans `offline_snapshot_state` et absents de la vue, avec `removed = true` (état
  complet, retirés compris). Jamais la colonne `pwd_pack_enc` d'un autre prestataire.
- `offline_snapshot_source_delta(p_ledger, p_since)` : mêmes lignes, limitées aux bracelets dont un
  historique de bracelet ou de lot, un rattachement, ou un solde (`posting` sur `WALLET_PAID|WALLET_PROMO`)
  a changé depuis `p_since - interval '5 seconds'` (recouvrement, R-30.5), **plus tous les bracelets des
  portefeuilles non `ACTIVE`** (le portefeuille n'a pas d'historique avant WP06 : le producteur écarte
  les entrées inchangées par l'état). `p_since` NULL : refus (CL001).
- Lecture de l'état par le producteur : **aucune fonction ne la prévoit** (`offline_snapshot_state` n'est
  lisible par aucun rôle). Ajoute `offline_snapshot_state_hashes(p_ledger uuid) RETURNS TABLE (token_hash
  bytea, entry_sha256 bytea, removed boolean)` (`STABLE`) et écris-le au rapport comme **ajout à
  `interfaces.md`** (WP08 l'accordera à `cashless_snapcontent`, WP11 l'appellera).

**Cas limites** : un bracelet à deux portefeuilles (deux devises) figure dans le grand livre de chacun.

**Critère** : source = nombre de rattachements ouverts + retirés ; delta ne rend que les changés.

### T011 – Brouillon : `save_`, `append_…_entries`, `seal_`, `discard_`

**But** : inscription courte, par paquets de 5 000 (R-30.6), sans signature.

**Étapes**
- `save_offline_snapshot_draft(p_ledger, p_kind, p_header, p_content_key_wrapped, p_entries)` : verrou
  `pg_advisory_xact_lock(hashtextextended('snapshot-version:' || p_ledger, 0))`, `assert_tenant`,
  version = `max(version publiée)+1`, `base_version` = version publiée précédente pour un `DELTA`
  (un `DELTA` sans version précédente : CL048), `FULL` sans base. **La base pose elle-même les champs
  qu'elle possède** dans `header` : `format`, `operator_id`, `ledger_id`, `event_id`, `currency`,
  `version`, `base_version`, `authority_epoch` (époque courante du grand livre), `key_id` (clé centrale
  `ACTIVE` ; aucune : CL048 avec `DETAIL = 'NO_SIGNING_KEY'`). Le producteur fournit `kind`,
  `generated_at`, `valid_until`, `entries`, `removed`, `content_sha256` (la version n'existe pas avant la
  réservation). Rend l'id du brouillon (`OPEN`). Écris ce choix au rapport.
- `append_offline_snapshot_draft_entries(p_draft, p_entries)` : paquets ≤ 5 000 (au-delà CL001), brouillon
  `OPEN` seulement, `token_hash` unique par brouillon, rend le nombre inscrit.
- `seal_offline_snapshot_draft(p_draft)` : `OPEN` → `READY` si le nombre d'entrées non retirées et de
  retirées égale `header.entries` et `header.removed`, sinon CL048. Plus d'ajout ensuite.
- `discard_offline_snapshot_draft(p_draft, p_reason)` : `OPEN|READY` → `DISCARDED`, supprime les entrées ;
  appelable par les deux rôles (content et signer). Un brouillon `PUBLISHED` : CL048.

**Critère** : deux `save_` successifs sans `discard` : CL048 ; entrées en trop ou en moins : `seal_` refuse.

### T012 – `publish_offline_snapshot`, lectures du signataire, purge

**But** : seule voie d'inscription dans `offline_snapshot` (OP-N57).

**Étapes**
- `offline_snapshot_drafts_ready()` `STABLE` : brouillons `READY` (tous prestataires, ordre de version).
  `offline_snapshot_draft_content(p_draft)` `STABLE` : `(token_hash, entry, removed)` **jamais
  `pwd_pack_enc`**, brouillon `READY` ou `PUBLISHED` seulement.
- `publish_offline_snapshot(p_draft, p_key_id, p_signature)` : même verrou consultatif ; brouillon `READY`
  (sinon CL048) ; `version = max+1` encore vrai (sinon CL048) ; en-tête du brouillon confronté à ses
  colonnes et au contenu (`kind`, `base_version` = version précédente, `entries`/`removed` comptés,
  `authority_epoch` courante, `key_id = p_key_id`, clé `ACTIVE` `CENTRAL`) ; insère `offline_snapshot`
  (`header || signature`, `content_key_wrapped` du brouillon, `generated_at`, `valid_until`,
  `content_sha256` pris de l'en-tête), met à jour `offline_snapshot_state` (`entry_sha256` : voir ci-dessous),
  écrit `offline_snapshot_media_log` (une ligne par entrée, `in_snapshot = NOT removed`), passe le brouillon
  à `PUBLISHED`, et écrit elle-même la ligne d'audit `SNAPSHOT_PUBLISHED` dans `audit_log` (modèle :
  `migrations/0027_enrollment_refusal_audit.sql` l.136 ; acteur = rôle du signataire, objet = version ;
  le signataire n'a aucun droit d'audit, ADR-140). Le déclencheur existant `offline_snapshot_check` rejoue ses contrôles : ne le contourne pas.
- `entry_sha256` : SHA-256 de `entry::text` calculé par la base (détecteur de changement, non signé) ; le
  producteur lit les mêmes valeurs par `offline_snapshot_state_hashes` et doit calculer à l'identique
  (documente la forme dans l'en-tête de la migration).
- `purge_offline_snapshot_content(p_ledger) RETURNS int` : supprime `offline_snapshot_entry` des versions
  antérieures à l'avant-dernier `FULL` publié (rien si moins de deux `FULL`), et les entrées de brouillons
  `DISCARDED`. Garde `offline_snapshot`, `_media_log` et `_state` (R-05).

**Cas limites** : deux publications concurrentes du même grand livre : une seule gagne (verrou).
Signature vide ou `key_id` inconnu : CL048.

### T013 – Suite `tests_offline_snapshots.sql`

**Étapes** (gabarit `tests_cash_sessions.sql`, `no_plan()`, ROLLBACK, données propres)
- Version : `max+1` ; deux publications concurrentes simulées (verrou pris par une autre transaction n'est
  pas faisable en une session : prouve la formule, l'index unique et `NOT (version fournie)`).
- **Version plantée** : insère directement (propriétaire) une version très grande : la publication suivante
  refuse (CL048) au lieu de sauter ; documente que l'écriture directe est fermée à `cashless_app` par WP08.
- `DELTA` : base = version précédente, `DELTA` sans précédente refusé ; `FULL` avec base refusé.
- En-tête faux (compte d'entrées, `key_id`, époque) : CL048 / CL015 ; clé non `ACTIVE` ou `EDGE` : refus.
- Sources : `offline_snapshot_source` (retirés compris), `_delta` (recouvrement de 5 s : changement à `t-3 s`
  repris, à `t-10 s` non), portefeuille bloqué repris, `pwd_pack_sha256` à `null`.
- Purge : trois `FULL`, entrées des versions avant l'avant-dernier supprimées, journal conservé.
- `draft_content` sans `pwd_pack_enc` ; RLS forcée sur les cinq tables ; `search_path` des fonctions.

## Sécurité

- **À faire relire par une personne** : `publish_offline_snapshot`, `save_offline_snapshot_draft`, toute la
  migration 0044 (fonctions de snapshot : règle 4 de `CLAUDE.md`). L'agent qui l'écrit ne vaut pas relecture.
- La base est la dernière barrière de la version (OP-N57) : jamais de version reçue de l'appelant.
- `pwd_pack_enc` ne sort que de `offline_snapshot_source` (rôle content) ; le signataire n'en lit aucun.
- Règle 1 : tout écart qui affaiblit la sécurité (en-tête moins vérifié, droit plus large, `GRANT` ici,
  fonction cross-prestataire de plus) est soumis au porteur AVANT d'être codé.

## Tests

- `reset-db` puis `pg_prove -d cashless_wp03 packages/ledger-sql/tests/tests_offline_snapshots.sql` (base du
  lot, pas `cashless_test`). Relance `tests_definer_search_path.sql` et `tests_execute_grants.sql` : la
  seconde peut échouer sur les fonctions nouvelles (liste figée) ; signale-le, WP08 la met à jour.
- L'orchestrateur relance tout en série.

## Ce que le relecteur doit casser

1. `publish_offline_snapshot` deux fois sur le même brouillon, ou sur un brouillon `OPEN`/`DISCARDED`.
2. Une version plantée à `2^62` par le propriétaire : la publication suivante doit refuser proprement.
3. Un en-tête dont `entries`, `removed`, `key_id` ou `authority_epoch` diffère du brouillon.
4. `draft_content` ou `drafts_ready` qui laisse échapper un `pwd_pack_enc`.
5. Une fonction qui lit ou écrit un grand livre d'un autre prestataire (session sur A, `p_ledger` de B).
6. Un `DELTA` dont la base n'est pas la version précédente, ou un `FULL` avec `base_version`.
7. Un brouillon `READY` modifiable par `append_` ; un second brouillon ouvert pour le même grand livre.
8. `content_key_wrapped` vide accepté ; une entrée sans les onze clés (le test doit les compter).

## Definition of Done

- [ ] `0044_offline_snapshots.sql` appliquée sur base propre ; en-tête (contenu, codes, hypothèse sur le
      propriétaire, forme de `entry_sha256`) ; aucun `GRANT`/`REVOKE` de table.
- [ ] Toutes les fonctions : `SECURITY DEFINER` (sauf mention), `search_path = public, pg_temp`, `REVOKE ALL`.
- [ ] `tests_offline_snapshots.sql` vert ; suites existantes vertes sur `cashless_wp03` (hors listes figées).
- [ ] Rapport : signatures réelles ; **ajouts à `interfaces.md`** (`offline_snapshot_state_hashes`, forme du
      brouillon, `OPEN`) ; écarts et contradictions ; fichiers à relire par une personne ; matrice
      (FR-006 à FR-010, FR-038).

## Branch Strategy

- Branche de planification et de fusion : `feat/hors-ligne-snapshots-lots`.
- Worktree par lane, calculée dans `lanes.json`.
- Commande : `spec-kitty agent action implement WP03 --agent claude --mission
  hors-ligne-snapshots-lots-01M645RN`.

## Activity Log

- 2026-10-30T12:00:00Z – claude – Prompt generated via /spec-kitty.tasks
