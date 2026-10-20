---
work_package_id: WP15
title: "Route : rafraîchissement des jetons d'appareil"
dependencies:
- WP04
- WP09
- WP12
- WP14
requirement_refs:
- FR-010
- FR-011
- NFR-008
planning_base_branch: feat/identite-enrolement-terminaux
merge_target_branch: feat/identite-enrolement-terminaux
branch_strategy: Planning artifacts for this mission were generated on feat/identite-enrolement-terminaux. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/identite-enrolement-terminaux unless the human explicitly redirects the landing branch.
subtasks:
- T071
- T072
- T073
- T074
phase: Phase 3 - Routes
history:
- timestamp: '2026-10-19T13:30:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: node-norris
authoritative_surface: apps/api/src/devices/tokens/
create_intent:
- apps/api/test/integration/devices/refresh.spec.ts
execution_mode: code_change
owned_files:
- apps/api/src/devices/tokens/**
- apps/api/test/integration/devices/refresh.spec.ts
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP15 – Route : rafraîchissement des jetons d'appareil

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load node-norris`. Lis ensuite `README.md` (kit), `docs/SPECIFICATION.md` (sections citées ci-dessous), puis `kitty-specs/identite-enrolement-terminaux-01M52R6H/spec.md`, `plan.md`, `research.md`, `data-model.md` et les contrats cités. En cas de contradiction entre sources, applique la règle de priorité de SPECIFICATION §0.3 et **signale-la** ; ne modifie jamais un fichier `.sql` généré de `packages/ledger-sql/` (passe par les générateurs `gen_tests.py`, `gen_golden.py`).

## Objective

Servir `refreshDeviceToken` : mTLS et preuve de possession exigés, rotation à usage unique avec la grâce de 60 s décidée par le porteur, refus d'un échange en cours, révocation de la famille en cas de réutilisation.

## Context

Exigences : FR-010, FR-011, NFR-008 ; `contracts/device-tokens.md` ; `research.md` R-07 ; décision `DM-01M59WNZSSTN4YP1W38GPTHMMP` (OP-N65, ADR-108). Fonction `rotate_device_refresh_token` (WP04) ; `DeviceTokenService` (WP09) ; certificat client lu comme dans `RealDeviceIdentity` (WP12 : réutilise sa fonction de lecture du certificat plutôt que de la recopier). Enregistre le module par une ligne dans `devices/devices.module.ts`.

**Règle de sécurité du projet (`CLAUDE.md`, C-011, C-012)** : si un point de ce lot ne peut être tenu qu'en affaiblissant la sécurité (droit plus large, contrôle retiré ou reporté, secret plus exposé, faux gardé plus longtemps), **arrête-toi sur ce point et soumets-le au porteur avant de coder**, avec le risque et les options ; continue le reste. Un renforcement se fait, puis se consigne dans le compte rendu du lot.

## Branch Strategy

Planification et merge sur `feat/identite-enrolement-terminaux`. Dépendances : WP04, WP09, WP12, WP14. L'espace de travail (worktree) est attribué par lane calculée dans `lanes.json`. Commande : `spec-kitty agent action implement WP15 --agent claude --mission identite-enrolement-terminaux-01M52R6H`.

## Subtasks

### T071 — Route

`POST /v1/device-tokens/refresh` : pas de jeton d'appareil exigé (il peut être expiré) ; certificat client exigé (`authorized`, non expiré) ; corps `serial`, `refresh_token`, `nonce`, `signature`.

### T072 — Preuve de possession

Terminal lu par `serial` dans le prestataire du certificat (`O=` du certificat ne sert qu'à l'aiguillage ; relis le terminal par l'empreinte du certificat) ; empreinte du certificat = `cert_sha256` ; signature ECDSA (`ieee-p1363`) de `"cashless-refresh-v1" ‖ 0x00 ‖ nonce ‖ 0x00 ‖ serial ‖ 0x00 ‖ refresh_token` par `public_key` ; `nonce` consommé par `consume_device_nonce` (rejeu refusé).

### T073 — Issues

`rotate_device_refresh_token(empreinte, cert_sha256, nouvelle empreinte, expiration)` : `ROTATED` / `GRACE` → nouvelle paire (jeton d'appareil de la même famille) ; `IN_PROGRESS` → `409 CONFLICT_STATE` ; `REUSED` → `401` et audit `DEVICE_TOKEN_REUSE` (écrit hors de la transaction annulée) ; `INVALID` → `401` ; `SUSPENDED` / `REVOKED` → `403`.

### T074 — Tests d'intégration

Rotation ; réponse perdue puis représentation sous 60 s → nouvelle paire, successeur perdu refusé ; seconde représentation, après 60 s, ou avec un autre certificat → famille révoquée et jeton d'appareil de la famille refusé à la requête suivante (test de borne d'OP-N65) ; 20 rafraîchissements simultanés → 1 succès, autres `409`, famille intacte ; preuve de possession fausse, sans séparateur, ou rejouée → refus ; terminal suspendu ou révoqué.

## Test Strategy

Tests demandés par la spec (pgTAP par contrainte et par refus, intégration HTTPS sur vraie base, isolation à deux prestataires, preuves de sécurité). Ordre de vérification : `npm run lint`, `npm run typecheck`, `npm run reset-db -w @cashless/ledger-sql`, `npm run test:pgtap -w @cashless/ledger-sql`, puis `npm run reset-db -w @cashless/ledger-sql && npm test -w @cashless/api -- --runInBand`. Ne jamais lancer pgTAP sur une base où Jest vient de tourner (rejouer `reset-db` entre les deux). Dans un worktree de lane, créer d'abord les liens `node_modules/@cashless/{api,contracts,ledger-sql,tag-format}` (worktrees sans `node_modules`). La base locale est en Docker : son horloge peut reculer ; aucun test ne compare l'heure de Node à `now()` de la base sans marge.

## Definition of Done

Tests d'intégration verts ; suite complète de l'API verte. Chaque sous-tâche est marquée par `spec-kitty agent tasks mark-status Txxx --status done --mission identite-enrolement-terminaux-01M52R6H`. Le compte rendu du lot liste : écarts au plan (avec leur sens : renforcement ou non), retouches hors carte (avec une ligne de justification), points soumis au porteur, fichiers à faire relire par une personne (clés, droits de la base, cryptographie).

## Reports des relectures (20/10/2026)

- NFR-008 précisé par le porteur (20/10/2026) : les 20 requêtes sont lancées pendant que la rotation du premier tient le
  verrou de famille (test qui contrôle l'ordre, pas une course au hasard) → 1 succès, 19 × `409 IN_PROGRESS`, famille
  intacte. Une représentation après la validation relève de FR-011/ADR-108 (test de borne existant).
- Test à deux connexions du verrou de famille de WP04 (dblink absent, verrou réentrant dans une session) : échange de
  `s` tenu ouvert pendant que l'ancien jeton est réutilisé → `IN_PROGRESS`, puis `REUSED` une fois l'échange validé,
  aucun jeton vivant dans la famille, `device_token_family_active` faux ; même scénario pour
  `revoke_device_token_family`.
- `IN_PROGRESS` → `409` ; `REUSED` → audit `DEVICE_TOKEN_REUSE` puis `401`. Les fonctions exigent READ COMMITTED
  (`25000` sinon) : n'élève pas le niveau d'isolation de la transaction.
- Test de comportement Jest à une connexion : `BEGIN ISOLATION LEVEL REPEATABLE READ` puis `rotate_device_refresh_token`
  → `25000` et rien n'est écrit (pgTAP ne peut pas changer de niveau d'isolation).
- Relecture : un WP15 approuvé sans le test à deux connexions qui TIENT réellement la transaction de rotation ouverte
  (ordre contrôlé, pas course au hasard) est un constat bloquant. Le client réessaie sur `409` : à tester.
- Relecture WP07 : toute fonction de la base qu'appelle ta route s'accorde à son rôle dans la section 4a de
  `post-roles.sql`, et les listes figées de `tests_execute_grants.sql` se mettent à jour dans le même commit (sinon
  42501 ou test rouge). Une migration s'exécute désormais dans la transaction de `migrate.ts` : pas de
  `CREATE INDEX CONCURRENTLY`, pas d'`ALTER TYPE … ADD VALUE` utilisée dans la même série.

## Risks / Reviewer guidance

Le relecteur vérifie que la grâce est bornée exactement comme ADR-108 (une fois, même certificat, 60 s) et que l'audit d'une réutilisation survit au refus.
