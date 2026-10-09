---
work_package_id: WP02
title: 'Grand livre d''événement et conditions de passage (migration 0008)'
dependencies:
- WP01
requirement_refs:
- FR-011
- FR-012
- FR-017
planning_base_branch: feat/configuration-parties-evenements
merge_target_branch: feat/configuration-parties-evenements
branch_strategy: Planning artifacts for this mission were generated on feat/configuration-parties-evenements. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/configuration-parties-evenements unless the human explicitly redirects the landing branch.
subtasks:
- T006
- T007
- T008
- T009
phase: 'Phase 1 - Base de données'
history:
- timestamp: '2026-10-09T15:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: packages/ledger-sql/migrations/0008_event_ledger.sql
create_intent:
- packages/ledger-sql/migrations/0008_event_ledger.sql
- packages/ledger-sql/tests/tests_event_ledger.sql
execution_mode: code_change
owned_files:
- packages/ledger-sql/migrations/0008_event_ledger.sql
- packages/ledger-sql/tests/tests_event_ledger.sql
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP02 – Grand livre d'événement et conditions de passage (migration 0008)

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan`. Lis `kitty-specs/configuration-parties-evenements-01M4GCJ9/spec.md`, `plan.md`, `research.md`, `data-model.md`, `contracts/`, puis en particulier : `research.md` R-04, R-08 ; `data-model.md` (Migration 0008) ; SPECIFICATION §5.2 (tableau du plan de comptes) et §12.1 ; le schéma de référence : `ledger`, `account`, `merchant_account_hot`, `set_event_status`, `ledger_unsettled`, `ledger_purpose_balance`, `event_sync_deadline`, `event_device_sync_status`, `tenant_of_event`, `assert_tenant` ; `scenario_reference.json` (`accounts`).

## Objective

Ouvrir en base le grand livre et les comptes d'un événement, le compte d'une participation, et exposer en lecture les conditions que `set_event_status` vérifie.

## Context

Exigences : FR-011, FR-012 (compte commerçant), FR-017 (conditions calculées par la base), NFR-004. `open_event_ledger` et `open_participation_account` sont `SECURITY INVOKER` (RLS conservée) ; `event_transition_conditions` est `SECURITY DEFINER` avec `assert_tenant` (elle lit des fonctions internes).

## Branch Strategy

Planification et merge sur `feat/configuration-parties-evenements`. Dépendances : WP01. L'espace de travail (worktree) est attribué par lane calculée dans `lanes.json`. Commande : `spec-kitty agent action implement WP02 --agent claude`.

## Subtasks

### T006 — `open_event_ledger(p_event uuid) RETURNS uuid`

- Lit l'événement (sous RLS : invisible ⇒ `no_data_found`) ; refuse s'il existe déjà un grand livre `EVENT` pour lui
  (`CL001`).
- Titulaire des fonds : `ORGANIZER` ⇒ organisateur ; `OPERATOR` ⇒ prestataire (`event.operator_id`) ; `THIRD_PARTY`
  ⇒ `funds_holder_party_id`. Émetteur : `event.issuer` (organisateur ou prestataire). Plateforme : la partie
  `PLATFORM` (lisible par tous sous RLS).
- `INSERT INTO ledger` (`scope_type 'EVENT'`, devise de l'événement), puis les comptes fixes de `research.md` R-04
  avec `family`, `purpose`, `owner_party_id`, `normal_side`, `allow_negative`, `hot` du tableau §5.2 :
  `A-TRANSIT`, `A-BANQUE` (titulaire = détenteur des fonds) ; comptes `L-ORG-*` (organisateur), `L-OPE-*`
  (prestataire), `L-PLT-*` (plateforme), `L-ESP-A-RENDRE`, `L-VERS-ENCOURS`, `S-ATTENTE` (sans titulaire) ;
  `L-LEGAL-CASSE` si `jurisdiction_profile.breakage_destination = 'LEGAL_ACCOUNT'`.
- Comptes chauds : `L-ORG-COM`, `L-ORG-TVA`, `L-ORG-FPSP`, `L-OPE-FPSP`. Négatif permis pour les contreparties
  (`D`) de §5.2 ; le déclencheur `account_merchant_hot` règle lui-même la casse.
- Rend l'identifiant du grand livre. Codes et attributs **identiques** à ceux de `scenario_reference.json` pour les
  comptes communs (comparaison faite par le test T009).

### T007 — `open_participation_account(p_participation uuid) RETURNS uuid`

- Grand livre `EVENT` de l'événement de la participation (absent ⇒ `CL001`) ; compte `L-MCH-<participation_id>`
  (`CLAIM`, `MERCHANT`, titulaire = commerçant, `participation_id`, sens `C`) ; idempotente : rend le compte existant
  si déjà créé.

### T008 — `event_transition_conditions(p_event uuid, p_to event_status)`

- `RETURNS TABLE (code text, met boolean, detail text, source text)`, `STABLE`, `SECURITY DEFINER`,
  `SET search_path = public`, `assert_tenant(tenant_of_event(p_event))` en premier ; `REVOKE ALL … FROM PUBLIC`.
- Lignes, dans l'ordre : `TRANSITION_ALLOWED` (passage prévu dans `event_status_transition`) ; puis selon `p_to`,
  exactement les conditions de `set_event_status` (mêmes fonctions, sans verrou ni écriture) :
  `DEVICES_CAUGHT_UP` (vers `SETTLING`, avant la date limite), `DEBIT_AUTHORITY_CENTRAL` (à partir de
  `RECONCILING`), `SUSPENSE_ZERO` (vers `SETTLING` et au-delà), `PARTY_POSITIONS_ZERO` et `PAYOUT_PENDING_ZERO`
  (vers `REFUND_WINDOW` et `CLOSED`), `POSITIONS_SETTLED` (vers `CLOSED`). `source = 'DATABASE'`, `detail` court en
  français (l'API traduit à partir du `code`).
- **Relire `set_event_status` ligne à ligne** pour ne rien oublier ni ajouter ; documenter dans un commentaire la
  correspondance condition ↔ bloc de `set_event_status`.

### T009 — Tests pgTAP `tests/tests_event_ledger.sql`

- `open_event_ledger` : nombre et attributs des comptes (comparaison avec un tableau attendu tiré de §5.2) ; titulaire
  des fonds pour les trois valeurs ; `L-LEGAL-CASSE` présent seulement si `LEGAL_ACCOUNT` ; second appel refusé ;
  invisible d'un autre prestataire ; exécutable par `cashless_app` sous RLS (après `post-roles.sql`, droits posés par
  WP03 — en attendant, tester sous le propriétaire et marquer les assertions de droits comme à compléter par WP03).
- `open_participation_account` : compte créé chaud et négatif permis ; idempotence.
- `event_transition_conditions` : pour chaque statut visé, l'ensemble des codes rendus ; pour au moins trois cas,
  `met = false` **et** `set_event_status` refuse avec `CL019` (cohérence des deux fonctions) ; `met = true` partout
  ⇒ `set_event_status` passe.

## Test Strategy

Tests demandés par la spec (pgTAP par contrainte, isolation à deux prestataires, intégration sur la base locale). Ordre de vérification : `npm run lint`, `npm run typecheck`, `npm run reset-db -w @cashless/ledger-sql`, `npm run test:pgtap -w @cashless/ledger-sql`, `npm run reset-db -w @cashless/ledger-sql && npm test`.

## Definition of Done

`reset-db` applique `0008` ; `test:pgtap` vert ; aucune suite existante modifiée.

## Risks / Reviewer guidance

Une divergence entre `event_transition_conditions` et `set_event_status` tromperait le back-office : les tests croisés de T009 sont l'arbitre. `ledger` : `UPDATE` interdit au rôle applicatif — l'ouverture n'en fait pas.
