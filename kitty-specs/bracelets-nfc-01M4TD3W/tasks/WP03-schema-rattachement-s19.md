---
work_package_id: WP03
title: 'Schéma S19 : codes et demandes de rattachement (migration 0010)'
dependencies: []
requirement_refs:
- FR-015
- FR-017
- FR-030
- FR-031
- FR-032
- FR-033
planning_base_branch: feat/bracelets-nfc
merge_target_branch: feat/bracelets-nfc
branch_strategy: Planning artifacts for this mission were generated on feat/bracelets-nfc. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/bracelets-nfc unless the human explicitly redirects the landing branch.
subtasks:
- T010
- T011
- T012
- T013
phase: Phase 1 - Socle
history:
- timestamp: '2026-10-13T12:05:28Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: packages/ledger-sql/migrations/0010_media_claims.sql
create_intent: []
execution_mode: code_change
owned_files:
- packages/ledger-sql/migrations/0010_media_claims.sql
- packages/ledger-sql/tests/tests_media_claims.sql
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP03 – Schéma S19 : codes et demandes de rattachement (migration 0010)

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan`. Lis ensuite `README.md` (kit), `docs/SPECIFICATION.md` (sections citées ci-dessous), puis `kitty-specs/bracelets-nfc-01M4TD3W/spec.md`, `plan.md`, `research.md`, `data-model.md` et les contrats cités. En cas de contradiction entre sources, applique la règle de priorité de SPECIFICATION §0.3 et **signale-la** ; ne modifie jamais un fichier `.sql` généré de `packages/ledger-sql/`.

## Objective

Ajouter à la base les codes de rattachement, les demandes en attente et les essais, avec leurs règles en base.

## Context

Exigences : FR-015, FR-017, FR-030 à FR-033, C-001, C-002. Modèle : `data-model.md` (migration 0010). Contrat : `contracts/claim-codes.md`. SPECIFICATION §7.8 (code imprimé), §14.2 S19, ADR-56, ADR-57. **Ne modifie aucun fichier `.sql` généré du kit.** Modèle de style : `migrations/0007_configuration.sql` et `tests/tests_configuration.sql`.

**Règle de sécurité du projet (`CLAUDE.md`, C-011)** : si un point de ce lot ne peut être tenu qu'en affaiblissant la sécurité (droit plus large, contrôle retiré ou reporté, secret plus exposé, faux gardé plus longtemps), **arrête-toi sur ce point et soumets-le au porteur avant de coder** ; continue le reste. Un renforcement se fait, puis se consigne.

## Branch Strategy

Planification et merge sur `feat/bracelets-nfc`. Dépendances : aucune. L'espace de travail (worktree) est attribué par lane calculée dans `lanes.json`. Commande : `spec-kitty agent action implement WP03 --agent claude --mission bracelets-nfc-01M4TD3W`.

## Subtasks

### T010 — Tables et colonnes

- `claim_code`, `media_claim`, `claim_attempt` selon `data-model.md` ; colonnes `media.claim_code_hash` (32 octets, unique par prestataire), `claim_code_used_at`, `claim_attempts` ; `media_batch.claim_codes_issued_at`.
- RLS activée et forcée sur les trois tables, politiques de prestataire sur le modèle des tables existantes (`app.operator_id`) ; `claim_attempt` en ajout seul (déclencheur `forbid_mutation` existant ou équivalent).
- Contraintes : `media_id` et `associated_at` présents ensemble ; `attempts` entre 0 et 5 ; statuts fermés ; index sur (`media_id`, `status`), (`customer_id`, `attempted_at`), (`device_ref`, `attempted_at`).

### T011 — Fonctions des codes

- `issue_claim_codes(p_batch uuid, p_hashes bytea[])` : lot `PUBLIC` seulement, `claim_codes_issued_at` NULL, `cardinality = quantity` ; pose la date ; `CL020` sinon.
- `associate_claim_code(p_hash bytea, p_media uuid)` : code du **même lot** que le bracelet, ni associé ni invalidé ; pose `media.claim_code_hash`. Refus `CL020` avec un motif distinct par cas (pour l'import).
- `invalidate_unassociated_codes(p_batch uuid) RETURNS int`.
- Toutes INVOKER sauf nécessité démontrée ; chaque fonction commence par `assert_tenant`.

### T012 — Fonctions de rattachement

- `claim_media(p_hash bytea, p_customer uuid, p_device_ref text, p_confirmation_hash bytea) RETURNS TABLE(outcome text, claim_id uuid, media_id uuid)` : applique les limites (5 par compte et par heure, 20 par appareil et par jour → `BLOCKED`), puis : code inconnu, utilisé, invalidé → `REFUSED` (une seule sorte de refus) ; solde disponible nul → rattache (`attach_wallet` ou équivalent du schéma), pose `claim_code_used_at`, `ATTACHED` ; sinon crée une demande `PENDING` (24 h, 3 au plus par bracelet, sinon `REFUSED`), `PENDING`. Écrit toujours une ligne `claim_attempt`.
- `confirm_media_claim(p_claim uuid, p_media uuid, p_confirmation_hash bytea, p_device uuid, p_actor uuid) RETURNS text` : même bracelet, non expirée, moins de 5 essais ; bon code → rattache le portefeuille au compte sans écriture comptable, consomme le code imprimé, annule les autres `PENDING` ; mauvais code → incrémente `attempts`.
- `claim_balance_lookup(p_hash bytea, p_device_ref text)` : solde et 10 derniers mouvements d'un bracelet non rattaché, sans donnée personnelle ; mêmes limites par appareil.
- Lis `attach_wallet`, `media_wallet`, `wallet_spendable` du schéma avant d'écrire : réutilise-les, ne réécris pas leurs règles (C-001).

### T013 — Tests pgTAP

- `tests/tests_media_claims.sql` : chaque contrainte, chaque refus, limites d'essais (avec horodatages posés), 4e demande refusée, expiration, 5 codes faux, confirmation qui annule les autres, lot `POOL` après un premier rattachement, isolation à deux prestataires sur les trois tables.
- Vérifie que les suites de référence restent vertes (`tests_grand_livre_cashless.sql`, `scenario_reference_test.sql`).

## Test Strategy

Tests demandés par la spec (pgTAP par contrainte, intégration HTTP sur vraie base, isolation à deux prestataires, preuves de sécurité). Ordre de vérification : `npm run lint`, `npm run typecheck`, `npm run reset-db -w @cashless/ledger-sql`, `npm run test:pgtap -w @cashless/ledger-sql`, puis `npm run reset-db -w @cashless/ledger-sql && npm test`. Ne jamais lancer pgTAP sur une base où Jest vient de tourner. Dans un worktree de lane, créer d'abord les liens `node_modules/@cashless/{api,contracts,ledger-sql,tag-format}`.

## Definition of Done

`npm run reset-db -w @cashless/ledger-sql && npm run test:pgtap -w @cashless/ledger-sql` vert, suites de référence comprises ; migration rejouable. Chaque sous-tâche est marquée par `spec-kitty agent tasks mark-status Txxx --status done --mission bracelets-nfc-01M4TD3W`. Le compte rendu du lot liste : écarts au plan (avec leur sens : renforcement ou non), retouches hors carte, points soumis au porteur.

## Risks / Reviewer guidance

La base ne doit pas permettre de distinguer un code inconnu d'un code utilisé (`REFUSED` unique). Une fonction DEFINER de trop élargit les droits : justifie chacune.
