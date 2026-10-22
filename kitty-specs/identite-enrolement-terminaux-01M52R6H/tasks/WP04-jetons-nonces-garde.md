---
work_package_id: WP04
title: Jetons de rafraîchissement, nonces et garde de statut (migration 0023)
dependencies:
- WP03
requirement_refs:
- FR-011
- FR-012
- FR-014
- NFR-003
- NFR-004
- NFR-008
planning_base_branch: feat/identite-enrolement-terminaux
merge_target_branch: feat/identite-enrolement-terminaux
branch_strategy: Planning artifacts for this mission were generated on feat/identite-enrolement-terminaux. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/identite-enrolement-terminaux unless the human explicitly redirects the landing branch.
subtasks:
- T016
- T017
- T018
- T019
- T020
phase: Phase 1 - Contrat et base
history:
- timestamp: '2026-10-19T13:30:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: packages/ledger-sql/migrations/0023_device_tokens_nonces.sql
create_intent:
- packages/ledger-sql/migrations/0023_device_tokens_nonces.sql
- packages/ledger-sql/tests/tests_device_tokens.sql
execution_mode: code_change
owned_files:
- packages/ledger-sql/migrations/0023_device_tokens_nonces.sql
- packages/ledger-sql/tests/tests_device_tokens.sql
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP04 – Jetons de rafraîchissement, nonces et garde de statut (migration 0023)

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan`. Lis ensuite `README.md` (kit), `docs/SPECIFICATION.md` (sections citées ci-dessous), puis `kitty-specs/identite-enrolement-terminaux-01M52R6H/spec.md`, `plan.md`, `research.md`, `data-model.md` et les contrats cités. En cas de contradiction entre sources, applique la règle de priorité de SPECIFICATION §0.3 et **signale-la** ; ne modifie jamais un fichier `.sql` généré de `packages/ledger-sql/` (passe par les générateurs `gen_tests.py`, `gen_golden.py`).

## Objective

Porter en base la rotation des jetons de rafraîchissement (avec la grâce de 60 s décidée par le porteur), la révocation et le contrôle des familles, la consommation des nonces de requête à l'heure de la base, et la revérification du statut d'un terminal dans la transaction métier.

## Context

Exigences : FR-011, FR-012, FR-014, NFR-003, NFR-004, NFR-008 ; `data-model.md` (Jeton de rafraîchissement, Nonce de requête, Fonctions) ; `contracts/device-tokens.md`, `contracts/device-authentication.md` ; `research.md` R-04 (rejeu, horloge), R-07 (grâce, OP-N65, ADR-108), R-14 (écart entre la garde et l'écriture). La table `device_refresh_token` est créée par WP03 (migration 0022).

**Règle de sécurité du projet (`CLAUDE.md`, C-011, C-012)** : si un point de ce lot ne peut être tenu qu'en affaiblissant la sécurité (droit plus large, contrôle retiré ou reporté, secret plus exposé, faux gardé plus longtemps), **arrête-toi sur ce point et soumets-le au porteur avant de coder**, avec le risque et les options ; continue le reste. Un renforcement se fait, puis se consigne dans le compte rendu du lot.

## Branch Strategy

Planification et merge sur `feat/identite-enrolement-terminaux`. Dépendances : WP03. L'espace de travail (worktree) est attribué par lane calculée dans `lanes.json`. Commande : `spec-kitty agent action implement WP04 --agent claude --mission identite-enrolement-terminaux-01M52R6H`.

## Subtasks

### T016 — Rotation avec grâce

`rotate_device_refresh_token(p_token_hash bytea, p_cert_sha256 bytea, p_new_hash bytea, p_new_expires timestamptz) RETURNS TABLE(outcome text, device_id uuid, family_id uuid)` :
- verrou `FOR UPDATE NOWAIT` sur la ligne du jeton : verrou pris → `outcome = 'IN_PROGRESS'` (l'API répond `409`) ;
- inconnu, expiré ou révoqué → `INVALID` ;
- terminal `SUSPENDED` / `REVOKED` → `SUSPENDED` / `REVOKED` ;
- `cert_sha256` différent de celui du terminal → famille révoquée (`REUSE`), `REUSED` ;
- jeton non consommé → consommé, successeur créé (`successor_id`), `ROTATED` ;
- jeton consommé, `grace_used_at` NULL, `consumed_at > now() - interval '60 seconds'`, même certificat → successeur révoqué (`GRACE_REPLACED`), nouveau successeur, `grace_used_at = now()`, `GRACE` ;
- tout autre cas de jeton consommé → famille révoquée (`REUSE`), `REUSED`.
La durée de grâce est une constante nommée dans la migration (60 s, ADR-108), pas un réglage modifiable.

### T017 — Familles

`revoke_device_token_family(p_device uuid, p_family uuid, p_reason text)` et `device_token_family_active(p_device uuid, p_family uuid) RETURNS boolean` (utilisée à chaque requête de terminal pour refuser un jeton d'appareil d'une famille révoquée). Index adapté (`device_id`, `family_id`).

### T018 — `consume_device_nonce` et purge

`consume_device_nonce(p_device uuid, p_nonce bytea, p_created timestamptz, p_tolerance_seconds int) RETURNS text` : `p_tolerance_seconds` borné à 300 (au-delà : refus de la fonction) ; `abs(now() - p_created) > tolérance` → `CLOCK_SKEW` (rien n'est écrit) ; insertion `(device_id, nonce, expires_at = p_created + 2 × tolérance)` ; doublon → `REPLAY` ; sinon `OK`. Une seule source d'heure : `now()` de la base. Fonction de purge par lots (`DELETE … WHERE expires_at < now() - marge LIMIT n` via sous-requête), appelée par le travailleur existant. La table `device_request_nonce` est créée par cette migration (colonnes de `data-model.md`), RLS forcée.

### T019 — `assert_device_active`

`assert_device_active(p_device uuid) RETURNS void` : `SELECT status … FOR SHARE` ; `REVOKED` → erreur traduite `DEVICE_REVOKED` ; `SUSPENDED` → `DEVICE_SUSPENDED`. À appeler dans la transaction de toute écriture faite pour un terminal (R-14). Vérifie dans le schéma de référence ce que font déjà `register_tap` et `post_transaction` pour un terminal révoqué (SQLSTATE `42501`) et note-le dans le compte rendu.

### T020 — Suite `tests_device_tokens.sql`

Rotation simple ; deuxième présentation dans la grâce (même certificat) ; troisième présentation → famille révoquée ; présentation après 61 s (horodatage `consumed_at` posé) → famille révoquée ; autre certificat → famille révoquée ; terminal suspendu ou révoqué ; `device_token_family_active` après révocation ; nonce : `OK`, `REPLAY`, `CLOCK_SKEW`, tolérance > 300 refusée ; purge ; `assert_device_active` sur les trois statuts ; isolation à deux prestataires.

## Test Strategy

Tests demandés par la spec (pgTAP par contrainte et par refus, intégration HTTPS sur vraie base, isolation à deux prestataires, preuves de sécurité). Ordre de vérification : `npm run lint`, `npm run typecheck`, `npm run reset-db -w @cashless/ledger-sql`, `npm run test:pgtap -w @cashless/ledger-sql`, puis `npm run reset-db -w @cashless/ledger-sql && npm test -w @cashless/api -- --runInBand`. Ne jamais lancer pgTAP sur une base où Jest vient de tourner (rejouer `reset-db` entre les deux). Dans un worktree de lane, créer d'abord les liens `node_modules/@cashless/{api,contracts,ledger-sql,tag-format}` (worktrees sans `node_modules`). La base locale est en Docker : son horloge peut reculer ; aucun test ne compare l'heure de Node à `now()` de la base sans marge.

## Definition of Done

`reset-db` puis toutes les suites pgTAP vertes ; migration rejouable. Chaque sous-tâche est marquée par `spec-kitty agent tasks mark-status Txxx --status done --mission identite-enrolement-terminaux-01M52R6H`. Le compte rendu du lot liste : écarts au plan (avec leur sens : renforcement ou non), retouches hors carte (avec une ligne de justification), points soumis au porteur, fichiers à faire relire par une personne (clés, droits de la base, cryptographie).

## Risks / Reviewer guidance

Le relecteur vérifie que la grâce ne s'applique qu'une fois, au même certificat, dans les 60 s ; que rien n'est écrit pour une requête hors tolérance ; qu'aucune comparaison n'utilise une heure fournie par l'API pour la purge.

## Compte rendu du lot WP04 (cycles 1 et 2)

Écarts au plan
- Renforcement (cycle 2, B1) : verrou consultatif de transaction par famille,
  `hashtextextended('device-token-family:' || family_id, 0)`. Pris en essai par `rotate_device_refresh_token` (échec :
  `IN_PROGRESS`, rien n'est écrit) et en attente par `revoke_device_token_family`, après le contrôle d'appartenance :
  une révocation voit le successeur créé par un échange concurrent (FR-011).
- Renforcement (cycle 2) : les deux fonctions exigent READ COMMITTED (`25000` sinon) ; sous REPEATABLE READ le verrou
  ne garantirait plus que le successeur soit vu.
- Renforcement (cycle 2, M5) : certificat contrôlé avant le statut du terminal ; un jeton présenté avec un certificat
  étranger révoque la famille, même terminal suspendu.
- Signature `revoke_device_token_family(p_device, p_family, p_reason)` : suit le prompt ; `data-model.md` corrigé (M6).

Constats du schéma de référence (T019, M2)
- Seul `open_offline_batch` refuse un terminal révoqué (`42501`) ; `register_tap` ne contrôle que le prestataire du
  terminal, `post_transaction` pas le statut. Le prompt supposait le contraire : le schéma fait foi.
- `assert_device_active` est donc obligatoire avant `register_tap` et `post_transaction`, après les fonctions qui
  prennent le terminal en `FOR UPDATE` (M1, ordre documenté dans la migration). Reporté dans WP12 et WP15.

Points soumis au porteur (décidés le 20/10/2026)
- NFR-008 contre FR-011/ADR-108 : NFR-008 précisé (requêtes concurrentes → `409 IN_PROGRESS`), spec.md et WP15.
- Hypothèse « le propriétaire ignore la RLS » étendue à `rotate_device_refresh_token` et
  `purge_device_request_nonces`, bornée par WP07.

Renvois : WP15 (test à deux connexions du verrou), WP12 (branchement de la purge, M3), WP07 (M4).
Limite connue : un attaquant qui fait tourner sans arrêt un jeton volé retarde la détection (le terminal légitime reçoit
`409` tant que le verrou est tenu ; chaque échange dure quelques ms).

Fichiers à faire relire par une personne : `packages/ledger-sql/migrations/0023_device_tokens_nonces.sql`
(SECURITY DEFINER, verrous, révocation de famille).
