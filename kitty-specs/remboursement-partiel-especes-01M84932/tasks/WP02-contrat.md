---
work_package_id: WP02
title: 'Contrat : opération et propriété acceptées'
dependencies: []
requirement_refs:
- FR-001
- FR-005
- FR-006
- C-001
planning_base_branch: feat/remboursement-partiel-especes
merge_target_branch: feat/remboursement-partiel-especes
branch_strategy: >-
  Planning artifacts for this mission were generated on feat/remboursement-partiel-especes. During
  /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must
  merge back into feat/remboursement-partiel-especes unless the human explicitly redirects the landing branch.
base_branch: kitty/mission-remboursement-partiel-especes-01M84932
base_commit: ce09b37ebf924b94adbbe3dafa7da48c4b7c965c
created_at: '2026-11-23T14:15:26.284612+00:00'
subtasks: [T004, T005, T006, T007]
phase: Phase 1 - Fondations
agent: claude
history:
- timestamp: '2026-11-23T14:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: packages/contracts/openapi.yaml
create_intent: []
execution_mode: code_change
model: sonnet
owned_files:
- packages/contracts/openapi.yaml
- packages/contracts/generated/**
- packages/contracts/dart/lib/**
- tools/contract-stability/contract-baseline.json
- apps/api/test/unit/contracts/contract-additions-9b.spec.ts
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP02 : Contrat — opération et propriété acceptées

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role : implementer / Agent :
claude). Lis ensuite la fiche commune `docs/passation-9c/fiche-implementation.md`, ce prompt, puis seulement :

- `kitty-specs/remboursement-partiel-especes-01M84932/contracts/partial-cash-refund.md` (**les ajouts acceptés par le
  porteur, et seulement eux**) et `interfaces.md` (codes de réponse, schéma de la réponse `201`) ;
- dans `packages/contracts/openapi.yaml` : `/media/{media_id}/release` (l. ~1593-1680, modèle de sécurité, paramètres,
  réponses) et `/media/{media_id}/cash-due-refunds` (l. ~1841) ; les schémas `Event` et `EventUpdate` (l. ~17905 et
  ~18140) ; `createOperatorConfigVersion` (l. ~8125) et `getResolvedEventConfig` (l. ~8905) ;
- `tools/contract-stability/contract-baseline.json` (entrées de la 10a, ADR-225, pour le format) et `check.mjs` ;
- `apps/api/test/unit/contracts/contract-additions-9b.spec.ts` (`ADDED_BY_10A` et le test « exactement les trois
  ajouts ») ;
- `packages/contracts/package.json` (scripts `generate`, `generate:dart`, `check`).

## Objective

Inscrire au contrat partagé, stable depuis le 05/11/2026, exactement les ajouts A1 à A3 acceptés, sans rien modifier
d'existant, puis régénérer les types TypeScript et Dart. Aucun code d'erreur nouveau.

## Subtasks

### T004 — Opération `refundPartialCash` et ses schémas

1. Chemin `/media/{media_id}/partial-cash-refunds`, `post`, `operationId: refundPartialCash`, `tags` comme
   `releaseMedia`, `x-process: public` comme lui.
2. Description française (reprends celle de `contracts/partial-cash-refund.md`, phrases courtes) : conditions
   (autorisation et activation), rôles, session de caisse, passage obligatoire (`tap_id` OU `tap`), montant débité
   brut, espèces = montant − frais, crédits offerts et caution intacts, seconde personne au cumul du jour du
   portefeuille, refus pendant `EDGE`.
3. `security` et `parameters` **copiés** de `releaseMedia` (avec `ApprovalToken`), `Idempotency-Key` obligatoire.
4. Schéma `PartialCashRefundCreate` (`additionalProperties: false`, `amount` requis, `tap_id` entier ou `tap`
   `TapInput`), schéma `PartialCashRefund` (champs de `interfaces.md`, montants `integer int64`, `approved_by`
   `nullable`).
5. Réponses : `201` ; `400`, `403`, `409`, `422` par les réponses communes existantes ; liste des codes possibles dans
   la description (aucun code nouveau dans l'énumération).

### T005 — Propriété d'événement et description de la clé de cascade

1. `cash_partial_refund_enabled: { type: boolean }` dans `Event.properties` (**pas** dans `required`) et dans
   `EventUpdate.properties` ; ajoute la clé à la liste « Clés de l'`ORGANIZER_ADMIN` » des descriptions d'`Event` et
   d'`EventUpdate` ; une phrase : refus `422 VALIDATION_FAILED` (règle `operator.cash_partial_refund_allowed`) si le
   prestataire n'autorise pas.
2. Une phrase dans la description de `createOperatorConfigVersion` et de `getResolvedEventConfig` : clé
   `cash_partial_refund_allowed` (niveau prestataire, `OPERATOR_ADMIN`, défaut `false`). La carte `settings` est
   déjà ouverte : aucun schéma ne change.

### T006 — Base de référence et test de gel

1. `contract-baseline.json` : une entrée par ajout (opération, deux schémas, propriété sur `Event`, propriété sur
   `EventUpdate`, descriptions modifiées), raison « mission 9c, porteur 23/11/2026, ADR-233 » (format des entrées 10a).
2. `contract-additions-9b.spec.ts` : ajoute `ADDED_BY_9C` (chemins exacts des descriptions et propriétés modifiées
   d'objets **existants**) et un test « exactement les ajouts de la 9c » sur le modèle de celui de la 10a. Les ajouts
   d'objets nouveaux (chemin, schémas) ne sont pas des modifications et ne doivent pas y figurer.
3. Mutation : ajoute un code au `enum` des problèmes → le test de gel échoue ; remets.

### T007 — Types générés et contrôle de stabilité

1. `npm run generate -w @cashless/contracts` puis `npm run generate:dart -w @cashless/contracts` (si Dart absent du
   poste, signale-le : la CI vérifie `--check`).
2. `node tools/contract-stability/check.mjs` : 0 refus ; `node --test tools/contract-stability/check.test.mjs`.
3. `npm run typecheck` à la racine de la lane ; `SKIP_LATENCY=1 npx jest test/unit/contracts --runInBand` dans
   `apps/api`.

## Definition of Done

- [ ] Seuls les ajouts A1 à A3 ; `git diff` d'`openapi.yaml` ne montre aucune ligne existante retirée hors des
      descriptions nommées.
- [ ] `check.mjs` 0 refus ; `test/unit/contracts` vert ; types régénérés commités.
- [ ] Mutation du test de gel notée.

## Ce que le relecteur doit casser

- Un ajout non accepté (code d'erreur, champ requis, route existante retouchée).
- `cash_partial_refund_enabled` placé dans `required` d'`Event` (casse les clients existants).
- Une tolérance générale dans le test de gel au lieu des chemins exacts.
- Des types générés non à jour (`npm run check -w @cashless/contracts`).

## Implementation command

`LC_ALL=C LANG=C spec-kitty agent action implement WP02 --agent claude --mission remboursement-partiel-especes-01M84932`
