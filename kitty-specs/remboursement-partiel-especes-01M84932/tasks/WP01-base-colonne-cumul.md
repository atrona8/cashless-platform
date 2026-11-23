---
work_package_id: WP01
title: 'Base : colonne d''activation et lecture du cumul'
dependencies: []
requirement_refs:
- FR-005
- NFR-002
- NFR-004
planning_base_branch: feat/remboursement-partiel-especes
merge_target_branch: feat/remboursement-partiel-especes
branch_strategy: >-
  Planning artifacts for this mission were generated on feat/remboursement-partiel-especes. During
  /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must
  merge back into feat/remboursement-partiel-especes unless the human explicitly redirects the landing branch.
subtasks: [T001, T002, T003]
phase: Phase 1 - Fondations
agent: claude
history:
- timestamp: '2026-11-23T14:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: packages/ledger-sql/migrations/0100_event_cash_partial_refund.sql
create_intent:
- packages/ledger-sql/migrations/0100_event_cash_partial_refund.sql
- packages/ledger-sql/tests/tests_cash_partial_refund.sql
execution_mode: code_change
model: sonnet
owned_files:
- packages/ledger-sql/migrations/0100_event_cash_partial_refund.sql
- packages/ledger-sql/tests/tests_cash_partial_refund.sql
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP01 : Base — colonne d'activation et lecture du cumul

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role : implementer / Agent :
claude). Lis ensuite la fiche commune `docs/passation-9c/fiche-implementation.md`, ce prompt, puis seulement :

- `kitty-specs/remboursement-partiel-especes-01M84932/interfaces.md` (noms figés, module du seuil) ;
- `packages/ledger-sql/migrations/0099_otp_channel_attempt.sql` (dernière migration : en-tête, style) et une migration
  qui ajoute une colonne d'`event` avec défaut, par exemple celle de `reversal_window_minutes` ou de
  `cash_refund_single_max` (`grep -ln "cash_refund_single_max" packages/ledger-sql/migrations`) ;
- `packages/ledger-sql/schema_grand_livre_cashless.sql` l. 428-476 (`journal_transaction`, `posting`, index existants) ;
- un test pgTAP récent du même genre (`packages/ledger-sql/tests/tests_pending_offline_notice.sql`) pour le style.

## Objective

Poser la colonne d'activation par événement, refusée par défaut, et s'assurer que la lecture du cumul du jour des
rendus partiels d'un portefeuille (faite par WP04) reste rapide sur un grand livre chargé. Aucun droit ne change.

## Context

L'organisateur active le rendu partiel pour son événement (FR-005) ; la valeur par défaut est `false` (spec,
User Story 2). Le cumul du jour (interfaces.md, « Module du seuil ») lit `journal_transaction` (`type =
'WALLET_REFUND'`, `metadata->>'partial_cash_refund' = 'true'`, `recorded_at` depuis 00:00 UTC) jointe à `posting` sur
le compte `WALLET_PAID` du portefeuille. Index existants : `posting (account_id, id)`, `journal_transaction
(ledger_id, occurred_at)`, `journal_transaction (event_id, type)`.

## Subtasks

### T001 — Migration `0100_event_cash_partial_refund.sql`

1. En-tête : mission 9c, décision du porteur du 23/11/2026, renvoi à `interfaces.md`.
2. `ALTER TABLE event ADD COLUMN cash_partial_refund_enabled boolean NOT NULL DEFAULT false;` avec un `COMMENT ON
   COLUMN` (« rendu partiel en espèces au guichet activé par l'organisateur ; permis seulement si le prestataire
   l'autorise, contrôle applicatif »).
3. Aucun `GRANT` ni `REVOKE` : le rôle applicatif lit et écrit `event` comme les autres colonnes réglées (vérifie dans
   `post-roles.sql` comment `cash_refund_single_max` est accordé — droit de table ou de colonne — et signale si un droit
   de colonne serait nécessaire : **ne l'ajoute pas**, c'est un point à soumettre).
4. La migration est rejouable par `reset-db` ; elle ne touche aucune migration existante.

**Validation** : `reset-db` sur `cashless_wp01` passe ; `\d event` montre la colonne.

### T002 — pgTAP `tests/tests_cash_partial_refund.sql`

Assertions minimales :
- la colonne existe, de type `boolean`, `NOT NULL`, défaut `false` (`col_type_is`, `col_not_null`, `col_default_is`) ;
- un événement créé sans la colonne a `false` ;
- `cashless_app` n'a reçu aucun droit nouveau : compare ses privilèges sur `event` avec ceux d'avant (même requête que
  les suites de droits existantes ; ne modifie pas les listes figées) ;
- isolation : un événement d'un autre prestataire n'est pas lisible sous `app.operator_id` d'un premier prestataire
  (RLS existante ; une assertion suffit).

Lance-le seul : `pg_prove -d cashless_wp01 tests/tests_cash_partial_refund.sql`.

### T003 — Plan de lecture du cumul du jour

1. Écris dans la base de test la requête du cumul telle que décrite par `interfaces.md` (montant brut = débit du compte
   `WALLET_PAID` du portefeuille, transactions marquées, jour UTC), avec un portefeuille ayant 2 000 écritures et 5
   rendus partiels.
2. `EXPLAIN (ANALYZE, BUFFERS)` : si le plan parcourt toutes les écritures du grand livre, ajoute dans la migration
   `0100` un **index partiel** justifié, par exemple `CREATE INDEX journal_transaction_partial_refund_idx ON
   journal_transaction (ledger_id, recorded_at) WHERE type = 'WALLET_REFUND' AND metadata->>'partial_cash_refund' =
   'true';`. Sinon, n'ajoute rien et note le plan.
3. Note dans la note de lane : la requête exacte, le plan avant et après, la durée.

## Definition of Done

- [ ] Migration `0100` seule nouvelle ; aucune migration existante ni `.sql` généré modifié.
- [ ] `tests_cash_partial_refund.sql` vert ; suites `tests_execute_grants.sql` et de droits existantes vertes, sans
      modification.
- [ ] Mutations notées : défaut `true` → le test échoue ; colonne nullable → le test échoue.
- [ ] Plan de lecture du cumul noté (index ajouté ou non, avec la raison).

## Risks

- Un droit de colonne manquant pour `cashless_app` : à signaler, jamais ajouté ici (règle 1).
- Un index sur une expression `jsonb` doit correspondre exactement au prédicat de WP04 : écris-le dans la note de lane
  pour que WP04 le reprenne mot pour mot.

## Ce que le relecteur doit casser

- La valeur par défaut et `NOT NULL` (un événement existant doit valoir `false` après migration).
- Un `GRANT` glissé dans la migration, ou une suite de droits figée modifiée pour passer.
- Un index qui ne sert pas la requête réelle du cumul (vérifie l'`EXPLAIN` toi-même).

## Implementation command

`LC_ALL=C LANG=C spec-kitty agent action implement WP01 --agent claude --mission remboursement-partiel-especes-01M84932`
