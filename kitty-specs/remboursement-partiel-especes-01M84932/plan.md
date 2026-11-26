# Implementation Plan: Remboursement partiel en espèces au guichet

**Branch**: `feat/remboursement-partiel-especes` | **Date**: 2026-11-23 | **Spec**: [spec.md](spec.md)
**Input**: Mission specification from `kitty-specs/remboursement-partiel-especes-01M84932/spec.md`

## Summary

Une opération de guichet nouvelle rend en espèces un montant choisi du solde payé du portefeuille d'un bracelet lu,
sans le libérer. Elle reprend le chemin éprouvé du guichet de retour (`releaseMedia`, `release.service.ts`) : verrou
du bracelet puis du solde payé, écriture `WALLET_REFUND` par le moteur (frais de `refund_policy`), espèces sorties de la
caisse de la session ouverte (`attach_cash_tx`), seconde personne par jeton sur place (`onsite-approval.ts`). Deux
réglages la gouvernent : l'autorisation du prestataire (réglage de cascade, sans changement du contrat) et l'activation
par événement (colonne d'événement réglée par l'organisateur, sur le modèle de `cash_refund_single_max`).

**Décisions prises par défaut pendant l'absence du porteur (23/11/2026), à lui présenter avant `/spec-kitty.tasks`** :
D1, D4, D5, D6 de `research.md` ; D2 (montant débité, frais retenus sur les espèces) et D3 (cumul par portefeuille)
validés par le porteur le 23/11/2026. Les ajouts au contrat (C-001) sont listés dans `contracts/partial-cash-refund.md` et restent
**acceptés par le porteur le 23/11/2026**.

## Technical Context

**Language/Version**: TypeScript 5 sur Node.js 22 (API NestJS), SQL PostgreSQL 17 (migrations `packages/ledger-sql`)
**Primary Dependencies**: NestJS, `pg`, moteur d'écritures existant (`ledger/`), garde de guichet (`counter-access.ts`), jeton sur place (`approval/onsite/onsite-approval.ts`) ; aucune dépendance nouvelle (`docs/08-pile-logicielle.md`, ADR-78)
**Storage**: PostgreSQL 17 : une colonne d'`event` (migration 0100), une clé de cascade dans `config_version.settings`, écritures du grand livre existantes
**Testing**: Jest (unitaires et intégration sur base par lot `cashless_wpXX`), pgTAP pour la migration et les droits, contrôle de stabilité du contrat (`tools/contract-stability/check.mjs`, `contract-baseline.json`)
**Target Platform**: serveur Linux (AWS, région provisoire `eu-west-3`) ; appelé par l'app terminal en mode `TOPUP_DESK`
**Project Type**: monorepo (API, paquets partagés) ; pas d'interface dans cette mission
**Performance Goals**: p95 < 300 ms côté serveur par rendu (NFR-001)
**Constraints**: contrat stable (ajouts rétrocompatibles seulement, soumis au porteur) ; aucun droit élargi pour `cashless_app` (NFR-004) ; 20 rendus simultanés sur un bracelet sans dépassement (NFR-002) ; refus pendant `EDGE`
**Scale/Scope**: une route, une colonne, une clé de cascade, une règle croisée, une ADR, un amendement de §8.5

## Charter Check

Charte Spec Kitty absente (`.kittify/charter/charter.yaml` introuvable) : section sautée. Les règles du projet qui en
tiennent lieu sont appliquées : `CLAUDE.md` (règles 1 à 4 sur les écarts de sécurité, faux refusés en production,
dette nommée, revue), `docs/SPECIFICATION.md` §0.3 (priorité des sources), contrat stable depuis le 05/11/2026.

## Project Structure

### Documentation (this mission)

```
kitty-specs/remboursement-partiel-especes-01M84932/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/partial-cash-refund.md
└── tasks.md (créé par /spec-kitty.tasks)
```

### Source Code (repository root)

```
packages/ledger-sql/migrations/0100_event_cash_partial_refund.sql   # colonne event + CHECK
packages/contracts/openapi.yaml                                      # route, propriétés Event/EventUpdate (après accord)
tools/contract-stability/contract-baseline.json                      # ajouts déclarés
apps/api/src/configuration/settings-catalog.ts                       # clé de cascade + colonne
apps/api/src/configuration/bounds-validator.ts                       # règle croisée prestataire → événement
apps/api/src/media/lifecycle/partial-refund.controller.ts            # nouvelle route
apps/api/src/media/lifecycle/partial-refund.service.ts               # rendu partiel
apps/api/test/integration/media/partial-cash-refund*.spec.ts         # parcours, refus, concurrence
docs/SPECIFICATION.md §8.5, docs/DECISIONS_ADR.md (ADR-233), docs/POINTS_OUVERTS.md
```

**Structure Decision**: rester dans `media/lifecycle/` à côté de `release.service.ts` et `cash-due.service.ts`, dont la
mission réutilise les verrous, la garde de guichet et le jeton sur place, sans dupliquer le calcul des frais.

## Complexity Tracking

Aucune violation de règle du projet. Point d'attention : la lecture du cumul du jour doit se faire sous le verrou du
solde payé (leçon d'OP-N128, ADR-195), sinon deux rendus simultanés passent chacun sous le seuil.

## Implementation Concern Map

### IC-01 — Réglages : autorisation du prestataire et activation par événement

- **Purpose**: porter la décision « le prestataire autorise, l'organisateur active » (refusée par défaut aux deux niveaux).
- **Relevant requirements**: FR-004, FR-005, FR-006, FR-013, NFR-003
- **Affected surfaces**: migration 0100 (`event.cash_partial_refund_enabled boolean NOT NULL DEFAULT false`), `settings-catalog.ts` (colonne réglée par `ORGANIZER_ADMIN` ; clé de cascade `cash_partial_refund_allowed` au niveau `OPERATOR`, réglée par `OPERATOR_ADMIN`, défaut `false`), `bounds-validator.ts` (règle croisée : activer l'événement est refusé `422 VALIDATION_FAILED`, règle `operator.cash_partial_refund_allowed`, si le prestataire n'autorise pas), `events.service.ts` (lecture), `openapi.yaml` (`Event`, `EventUpdate`), test `cascade.spec.ts` « catalogue et schéma ».
- **Sequencing/depends-on**: none
- **Risks**: un événement `LIVE` change de réglage par l'opération à deux personnes existante (`EVENT_SETTINGS_CHANGE`) : à vérifier, sans nouveau circuit. Retrait de l'autorisation du prestataire après activation : contrôlé à l'exécution (FR-005, scénario 4).

### IC-02 — Opération de rendu partiel au guichet

- **Purpose**: rendre en espèces un montant choisi du solde payé, bracelet gardé actif.
- **Relevant requirements**: FR-001, FR-002, FR-003, FR-008, FR-009, FR-010, FR-011, FR-012, NFR-001, NFR-004, C-002, C-005
- **Affected surfaces**: `partial-refund.controller.ts` (trois preuves du terminal + `X-Staff-Authorization` `CASHIER`/`SUPERVISOR` via `counter-access.ts`, `Idempotency-Key`, `X-Approval-Token`), `partial-refund.service.ts` (lecture du passage `tap_id`, contrôles de statut du bracelet et du portefeuille, session de caisse `OPEN` du terminal, `WALLET_REFUND` avec clé `partial-refund:<media>:<Idempotency-Key>` et `metadata.partial_cash_refund = true`, `attach_cash_tx`), refus `409 DEBIT_AUTHORITY_EDGE`.
- **Sequencing/depends-on**: IC-01 (lit les réglages) ; IC-04 (route au contrat, après accord du porteur)
- **Risks**: les frais de `refund_policy` (`fee_amount`, `minimum_amount`, `channels` contenant `CASH`, `open`) doivent être appliqués par le moteur comme pour `releaseMedia`, pas recalculés ; montant débité brut, espèces rendues nettes (D2).

### IC-03 — Seconde personne au cumul du jour

- **Purpose**: empêcher le fractionnement sous le seuil (ADR-190) en cumulant les rendus partiels du portefeuille sur la journée UTC, tous bracelets confondus (renforcement validé par le porteur).
- **Relevant requirements**: FR-007, FR-013, NFR-002, SC-003
- **Affected surfaces**: `partial-refund.service.ts` (cumul lu APRÈS `lockWalletPaidBalance`, somme des montants bruts des `WALLET_REFUND` marqués rendu partiel du portefeuille depuis 00:00 UTC + montant demandé, comparé `>` à `event.cash_refund_single_max`), `approvedBy` porté par l'écriture (ADR-195), test de concurrence (20 envois).
- **Sequencing/depends-on**: IC-02
- **Risks**: index de lecture du cumul (transactions d'un bracelet par date) à vérifier sur un grand livre chargé ; concurrence entre bracelets d'un même portefeuille couverte par le verrou du portefeuille.

### IC-04 — Contrat, spécification et consignation

- **Purpose**: tenir le contrat stable et la documentation normative juste.
- **Relevant requirements**: C-001, C-003, C-004, FR-013
- **Affected surfaces**: `openapi.yaml` (route `POST /media/{media_id}/partial-cash-refunds`, `refundPartialCash` ; propriété facultative `cash_partial_refund_enabled` sur `Event` et `EventUpdate` ; description de la clé de cascade), `contract-baseline.json`, types générés (`npm run generate`), `SPECIFICATION.md` §8.5 et §17, `DECISIONS_ADR.md` (ADR-233), `POINTS_OUVERTS.md` (limites relevées), `PROMPTS-A-ENVOYER.md` et `PRD.md` (report), note aux équipes clientes (app terminal, back-office).
- **Sequencing/depends-on**: accord du porteur sur `contracts/partial-cash-refund.md` avant tout code d'IC-02 qui touche la route
- **Risks**: le test de gel `contract-additions-9b.spec.ts` liste les ajouts admis (`ADDED_BY_10A`) : y ajouter exactement les ajouts de la 9c, sans tolérance générale.
