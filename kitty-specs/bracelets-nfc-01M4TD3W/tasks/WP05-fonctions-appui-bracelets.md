---
work_package_id: WP05
title: 'Fonctions d''appui de l''API des bracelets (migration 0013)'
dependencies:
- WP04
requirement_refs:
- FR-011
- FR-012
- FR-016
- FR-024
- FR-028
- FR-029
- FR-035
planning_base_branch: feat/bracelets-nfc
merge_target_branch: feat/bracelets-nfc
branch_strategy: Planning artifacts for this mission were generated on feat/bracelets-nfc. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/bracelets-nfc unless the human explicitly redirects the landing branch.
subtasks:
- T018
- T019
- T020
- T021
phase: 'Phase 1 - Socle'
history:
- timestamp: '2026-10-13T12:05:28Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: packages/ledger-sql/migrations/0013_media_api.sql
execution_mode: code_change
owned_files:
- packages/ledger-sql/migrations/0013_media_api.sql
- packages/ledger-sql/tests/tests_media_api.sql
create_intent:
- packages/ledger-sql/migrations/0013_media_api.sql
- packages/ledger-sql/tests/tests_media_api.sql
role: implementer
agent: claude
tags: []
tracker_refs: []
---

# Work Package Prompt: WP05 – Fonctions d'appui de l'API des bracelets (migration 0013)

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan`. Lis ensuite `README.md` (kit), `docs/SPECIFICATION.md` (sections citées ci-dessous), puis `kitty-specs/bracelets-nfc-01M4TD3W/spec.md`, `plan.md`, `research.md`, `data-model.md` et les contrats cités. En cas de contradiction entre sources, applique la règle de priorité de SPECIFICATION §0.3 et **signale-la** ; ne modifie jamais un fichier `.sql` généré de `packages/ledger-sql/`.

## Objective

Regrouper en fonctions de la base les écritures que l'API fera sur les bracelets et les lots, pour que chaque rôle de base n'ait que les droits nécessaires.

## Context

Exigences : FR-011, FR-012, FR-016, FR-024, FR-028, FR-029, FR-035, C-001. Modèle : `data-model.md` (migration 0013). Ces fonctions **n'ajoutent aucune règle métier** : les déclencheurs du schéma (`check_media_transition`, `check_media_batch_key`, `log_media_status`, tables de passages) font déjà les contrôles. Lis-les dans `schema_grand_livre_cashless.sql` avant d'écrire.

**Règle de sécurité du projet (`CLAUDE.md`, C-011)** : si un point de ce lot ne peut être tenu qu'en affaiblissant la sécurité (droit plus large, contrôle retiré ou reporté, secret plus exposé, faux gardé plus longtemps), **arrête-toi sur ce point et soumets-le au porteur avant de coder** ; continue le reste. Un renforcement se fait, puis se consigne.

## Branch Strategy

Planification et merge sur `feat/bracelets-nfc`. Dépendances : WP04. L'espace de travail (worktree) est attribué par lane calculée dans `lanes.json`. Commande : `spec-kitty agent action implement WP05 --agent claude --mission bracelets-nfc-01M4TD3W`.

## Subtasks

### T018 — Enregistrement d'un bracelet personnalisé

- `register_personalized_media(p_batch uuid, p_media_id uuid, p_token_hash bytea, p_uid bytea, p_sig_sha256 bytea, p_signature_ok boolean, p_pwd_pack_enc bytea, p_dek uuid) RETURNS uuid` : l'identifiant du bracelet est fourni par l'appelant (il entre dans l'AAD du chiffré, calculé avant l'insertion).
- Refus `CL020` : signature invalide, lot non `ORDERED`/`PERSONALIZED`, quantité du lot atteinte (compte sous verrou du lot), clé du lot non `ACTIVE`, clé de données qui n'est pas la version active de l'index. UID ou identité déjà connus : violation d'unicité (`23505`) que l'API traduira en 409.
- DEFINER justifiée si le rôle de personnalisation n'a pas l'insertion directe ; `assert_tenant` en tête ; pose `personalized_at`, version du format, `key_index` du lot.

### T019 — Statut d'un lot

- `set_media_batch_status(p_batch uuid, p_to text, p_reason text, p_actor uuid)` : s'appuie sur `media_batch_transition` ; motif obligatoire vers `SUSPENDED` ; trace dans `media_batch_status_history` (vérifie ce que le déclencheur existant écrit déjà, ne double pas la trace).
- Vers `CLOSED` : la fonction **refuse** et renvoie vers `close_batch` (règles de caution et de retrait).

### T020 — Blocage, perte, lecture

- `blacklist_media(p_media, p_reason, p_actor)`, `suspend_media(p_media, p_reason, p_actor)` : passages tracés dans `media_status_history` avec auteur et motif.
- `media_summary(p_media uuid)` : rend le bracelet **sans** `pwd_pack_enc`, `pwd_pack_dek_id`, `token_hash` ; avec lot, état de la caution, portefeuilles (`media_assignment`), solde disponible par devise.
- `media_status_log(p_media uuid)` : historique des statuts.

### T021 — Tests pgTAP

- `tests/tests_media_api.sql` : chaque refus, quantité du lot sous concurrence (deux sessions), passages de lot permis et refusés, `CLOSED` refusé, résumé sans colonne secrète (test sur les noms de colonnes rendus), isolation.

## Test Strategy

Tests demandés par la spec (pgTAP par contrainte, intégration HTTP sur vraie base, isolation à deux prestataires, preuves de sécurité). Ordre de vérification : `npm run lint`, `npm run typecheck`, `npm run reset-db -w @cashless/ledger-sql`, `npm run test:pgtap -w @cashless/ledger-sql`, puis `npm run reset-db -w @cashless/ledger-sql && npm test`. Ne jamais lancer pgTAP sur une base où Jest vient de tourner. Dans un worktree de lane, créer d'abord les liens `node_modules/@cashless/{api,contracts,ledger-sql,tag-format}`.

## Definition of Done

pgTAP vert ; aucune colonne secrète rendue par une fonction de lecture ; suites de référence vertes. Chaque sous-tâche est marquée par `spec-kitty agent tasks mark-status Txxx --status done --mission bracelets-nfc-01M4TD3W`. Le compte rendu du lot liste : écarts au plan (avec leur sens : renforcement ou non), retouches hors carte, points soumis au porteur.

## Risks / Reviewer guidance

Une fonction DEFINER est un droit délégué : chaque DEFINER doit commencer par `assert_tenant` et ne rien rendre d'un autre prestataire.
