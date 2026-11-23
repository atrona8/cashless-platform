# Tasks — Remboursement partiel en espèces au guichet (mission 9c)

Mission `remboursement-partiel-especes-01M84932`, planification et fusion sur `feat/remboursement-partiel-especes`.
Références : `spec.md`, `plan.md` (IC-01 à IC-04), `interfaces.md` (fait foi sur les noms et signatures),
`data-model.md`, `contracts/partial-cash-refund.md` (ajouts acceptés par le porteur le 23/11/2026), fiche commune
`docs/passation-9c/fiche-implementation.md`.

Les lignes `Txxx` sont des références ; l'avancement s'enregistre par `spec-kitty agent tasks mark-status`.

## Subtask Index

| ID | Description | WP | Parallel |
|---|---|---|---|
| T001 | Migration `0100` : colonne `event.cash_partial_refund_enabled` | WP01 | |
| T002 | pgTAP `tests_cash_partial_refund.sql` (colonne, défaut, aucun droit nouveau) | WP01 | |
| T003 | Plan de lecture du cumul du jour (EXPLAIN, index partiel si nécessaire) | WP01 | |
| T004 | Opération `refundPartialCash` et ses deux schémas dans `openapi.yaml` | WP02 | [P] |
| T005 | Propriété `cash_partial_refund_enabled` d'`Event`/`EventUpdate`, description de la clé de cascade | WP02 | |
| T006 | `contract-baseline.json` et `ADDED_BY_9C` du test de gel | WP02 | |
| T007 | Types générés (TypeScript et Dart) et contrôle de stabilité | WP02 | |
| T008 | Catalogue : colonne `cash_partial_refund_enabled` et clé `cash_partial_refund_allowed` | WP03 | |
| T009 | Règle croisée `operator.cash_partial_refund_allowed` | WP03 | |
| T010 | Lecture et modification de l'événement (DTO, circuit `LIVE` à deux) | WP03 | |
| T011 | Tests des réglages (défauts, règle croisée, retrait, `LIVE`) | WP03 | |
| T012 | `partialRefundDayTotal` | WP04 | [P] |
| T013 | `requireApprovalOverDailyCumul` | WP04 | |
| T014 | Tests du cumul (jour UTC, tous bracelets, autres portefeuilles exclus, guichet de retour exclu) | WP04 | |
| T015 | Contrôleur `refundPartialCash` et inscription au module | WP05 | |
| T016 | Contrôles préalables (réglages, bracelet, portefeuille, session, `EDGE`, montant, frais) | WP05 | |
| T017 | Écriture `WALLET_REFUND`, caisse, seconde personne, réponse, audit | WP05 | |
| T018 | Tests du parcours et des refus (US1, US2) | WP05 | |
| T019 | Tests de la seconde personne et de la caisse (US3, SC-003, SC-004) | WP05 | |
| T020 | Concurrence (20 envois) et latence (p95) | WP05 | |
| T021 | `SPECIFICATION.md` §8.5 et §17 | WP06 | [P] |
| T022 | ADR-233, points ouverts, liste des fichiers à relire | WP06 | |
| T023 | Reports `PROMPTS-A-ENVOYER.md`, `PRD.md`, note aux équipes clientes | WP06 | |
| T024 | `docs/passation-9c/preuves.md` | WP06 | |

## Phase 1 — Fondations

### WP01 — Base : colonne d'activation et lecture du cumul ([WP01-base-colonne-cumul.md](tasks/WP01-base-colonne-cumul.md))

- **Goal**: poser `event.cash_partial_refund_enabled` (défaut `false`) et vérifier que la lecture du cumul du jour est indexée.
- **Priority**: P1. **Independent test**: `pg_prove tests/tests_cash_partial_refund.sql` vert.
- **Subtasks**:
  T001 Migration `0100` : colonne `event.cash_partial_refund_enabled` (WP01)
  T002 pgTAP `tests_cash_partial_refund.sql` (WP01)
  T003 Plan de lecture du cumul du jour (WP01)
- **Dependencies**: none. **Risks**: aucune migration existante ni `.sql` généré touché ; aucun `GRANT`.

### WP02 — Contrat : opération et propriété acceptées ([WP02-contrat.md](tasks/WP02-contrat.md))

- **Goal**: inscrire au contrat exactement les ajouts acceptés, rétrocompatibles, et régénérer les types.
- **Priority**: P1. **Independent test**: `check.mjs` à 0 refus ; `test/unit/contracts` vert.
- **Subtasks**:
  T004 Opération et schémas (WP02)
  T005 Propriété d'événement et description (WP02)
  T006 Base de référence et test de gel (WP02)
  T007 Types générés et contrôle de stabilité (WP02)
- **Dependencies**: none. **Risks**: aucun code d'erreur nouveau ; aucune route existante modifiée.

## Phase 2 — Réglages et seuil

### WP03 — Réglages : le prestataire autorise, l'organisateur active ([WP03-reglages.md](tasks/WP03-reglages.md))

- **Goal**: catalogue, règle croisée et événement exposent les deux réglages, refusés par défaut.
- **Priority**: P1. **Independent test**: suite `partial-refund-settings.spec.ts` verte.
- **Subtasks**:
  T008 Catalogue (WP03)
  T009 Règle croisée (WP03)
  T010 DTO et circuit `LIVE` (WP03)
  T011 Tests des réglages (WP03)
- **Dependencies**: WP01, WP02.

### WP04 — Seuil de la seconde personne au cumul du jour ([WP04-seuil-cumul.md](tasks/WP04-seuil-cumul.md))

- **Goal**: module de lecture du cumul par portefeuille et de décision de la seconde personne.
- **Priority**: P1. **Independent test**: `partial-refund-threshold.spec.ts` vert.
- **Subtasks**:
  T012 `partialRefundDayTotal` (WP04)
  T013 `requireApprovalOverDailyCumul` (WP04)
  T014 Tests du cumul (WP04)
- **Dependencies**: WP01.

## Phase 3 — Opération

### WP05 — Opération de rendu partiel au guichet ([WP05-operation-rendu.md](tasks/WP05-operation-rendu.md))

- **Goal**: la route `refundPartialCash` de bout en bout, refus compris, prouvée sous concurrence.
- **Priority**: P1 (MVP). **Independent test**: suites `partial-cash-refund*.spec.ts` vertes.
- **Subtasks**:
  T015 Contrôleur et module (WP05)
  T016 Contrôles préalables (WP05)
  T017 Écriture, caisse, seconde personne, réponse, audit (WP05)
  T018 Tests du parcours et des refus (WP05)
  T019 Tests de la seconde personne et de la caisse (WP05)
  T020 Concurrence et latence (WP05)
- **Dependencies**: WP02, WP03, WP04.

## Phase 4 — Consignation

### WP06 — Preuves, spécification et consignation ([WP06-consignation.md](tasks/WP06-consignation.md))

- **Goal**: amender la spécification, consigner les décisions et limites, reporter, prouver.
- **Priority**: P2. **Independent test**: `consignation.spec.ts` vert ; chaque limite a un point ouvert et un ADR.
- **Subtasks**:
  T021 SPECIFICATION §8.5 et §17 (WP06)
  T022 ADR-233, points ouverts, fichiers à relire (WP06)
  T023 Reports et note aux équipes (WP06)
  T024 Preuves (WP06)
- **Dependencies**: WP01, WP02, WP03, WP04, WP05.

## Parallélisme

WP01 et WP02 en parallèle ; WP03 et WP04 en parallèle après WP01 (et WP02 pour WP03) ; WP05 seul ; WP06 en dernier.
