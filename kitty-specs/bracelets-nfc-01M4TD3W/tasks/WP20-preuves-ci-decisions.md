---
work_package_id: WP20
title: Preuves de bout en bout, secrets, isolation, latence, CI et décisions
dependencies:
- WP17
- WP18
- WP19
- WP02
requirement_refs:
- FR-034
- FR-035
- FR-036
planning_base_branch: feat/bracelets-nfc
merge_target_branch: feat/bracelets-nfc
branch_strategy: Planning artifacts for this mission were generated on feat/bracelets-nfc. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/bracelets-nfc unless the human explicitly redirects the landing branch.
subtasks:
- T082
- T083
- T084
- T085
- T086
- T087
phase: Phase 5 - Exploitation et preuves
history:
- timestamp: '2026-10-13T12:05:28Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: apps/api/test/integration/end-to-end/
create_intent:
- apps/api/test/integration/end-to-end/media-journey.spec.ts
- apps/api/test/integration/end-to-end/media-isolation.spec.ts
- apps/api/test/integration/end-to-end/media-secrets.spec.ts
- apps/api/test/integration/end-to-end/media-latency.spec.ts
- apps/api/test/integration/end-to-end/media-port-swap.spec.ts
execution_mode: code_change
owned_files:
- apps/api/test/integration/end-to-end/media-journey.spec.ts
- apps/api/test/integration/end-to-end/media-isolation.spec.ts
- apps/api/test/integration/end-to-end/media-secrets.spec.ts
- apps/api/test/integration/end-to-end/media-latency.spec.ts
- apps/api/test/integration/end-to-end/media-port-swap.spec.ts
- apps/api/jest.config.cjs
- .github/workflows/ledger-tests.yml
- .github/CI.md
- docs/DECISIONS_ADR.md
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP20 – Preuves de bout en bout, secrets, isolation, latence, CI et décisions

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan`. Lis ensuite `README.md` (kit), `docs/SPECIFICATION.md` (sections citées ci-dessous), puis `kitty-specs/bracelets-nfc-01M4TD3W/spec.md`, `plan.md`, `research.md`, `data-model.md` et les contrats cités. En cas de contradiction entre sources, applique la règle de priorité de SPECIFICATION §0.3 et **signale-la** ; ne modifie jamais un fichier `.sql` généré de `packages/ledger-sql/`.

## Objective

Prouver la mission de bout en bout, l'absence de secret au repos, l'isolation et la latence ; étendre la CI ; consigner les décisions et les dettes.

## Context

Exigences : NFR-001, NFR-002, NFR-004, NFR-006, NFR-009, NFR-010, C-012, SC-002 à SC-009. Guide : `quickstart.md`. Précédent : le WP13 de la mission 3 (`configuration-journey`, `configuration-isolation`, `configuration-latency`, section datée de `.github/CI.md`).

**Règle de sécurité du projet (`CLAUDE.md`, C-011)** : si un point de ce lot ne peut être tenu qu'en affaiblissant la sécurité (droit plus large, contrôle retiré ou reporté, secret plus exposé, faux gardé plus longtemps), **arrête-toi sur ce point et soumets-le au porteur avant de coder** ; continue le reste. Un renforcement se fait, puis se consigne.

## Branch Strategy

Planification et merge sur `feat/bracelets-nfc`. Dépendances : WP17, WP18, WP19, WP02. L'espace de travail (worktree) est attribué par lane calculée dans `lanes.json`. Commande : `spec-kitty agent action implement WP20 --agent claude --mission bracelets-nfc-01M4TD3W`.

## Subtasks

### T082 — Parcours complet

- `media-journey.spec.ts` (SC-002), par HTTP sur les trois processus et les deux commandes, sans aucune écriture directe en base hors amorçage : demander une clé (à deux) → commande d'administration → clé de données → lot `PUBLIC` → fichier de commande → personnalisation de 3 bracelets + association des codes → lot `ACTIVE` → activation avec caution → lecture → remplacement → rendu de la caution → restitution → rattachement par code d'un autre bracelet (solde nul) → demande en attente et confirmation → liste noire et sortie à deux → contrôle quotidien → clôture du lot.
- `media-port-swap.spec.ts` (SC-008) : remplace le faux d'identité du terminal par une autre implémentation du port dans le module de test et rejoue une lecture, sans toucher aux contrôleurs.

### T083 — Aucun secret au repos

- `media-secrets.spec.ts` (NFR-002, SC-004) : après le parcours, recherche dans **toutes** les colonnes texte, jsonb et bytea de la base (requête générée depuis le catalogue), dans `audit_log`, `api_idempotency`, et dans la sortie capturée des journaux : les identités de test (16 o), les `PWD‖PACK`, les clés de données en clair, les codes de rattachement et de confirmation. Zéro occurrence, en hexadécimal, base64 et texte.
- Vérifie aussi qu'aucune réponse d'erreur ne contient ces valeurs.

### T084 — Isolation et droits

- `media-isolation.spec.ts` (NFR-004, SC-005) : chaque opération de la mission lue dans `openapi.yaml` (par `x-process`, jamais une liste écrite à la main) est appelée sur le bon processus par le personnel, le terminal et le festivalier d'un **autre** prestataire → 403 ou 404, jamais de donnée ; et vérifie que chaque opération est servie par le processus annoncé et refusée (404) par les autres.

### T085 — Latence

- `media-latency.spec.ts` (NFR-006) : base de 100 000 bracelets (insertion par `generate_series`, chiffrés factices valides pour un sous-ensemble mesuré) ; demande de mot de passe et lecture : p95 ≤ 200 ms, p99 ≤ 500 ms ; activation : p95 ≤ 500 ms. Lancée seule, sans nouvel essai en CI (`SKIP_LATENCY`, `jest.config.cjs`).
- Consigne les mesures (ligne `LATENCE`).

### T086 — CI

- `.github/workflows/ledger-tests.yml` : mots de passe et URL des quatre nouveaux rôles ; SDK Dart 3.8 (`dart-lang/setup-dart`, version épinglée) ; pas « Bibliothèque de format (TypeScript) », « Bibliothèque de format (Dart) » (`dart pub get --enforce-lockfile`, `dart analyze`, `dart test`), contrôle des types Dart générés ; pas « Latence des bracelets » et « Indistinction des codes » isolés ; `CLAIM_CODE_HMAC_KEY` de test.
- `.github/CI.md` : section datée de la répétition locale (compteurs pgTAP et Jest, tests Dart, mesures de latence).

### T087 — Décisions et dettes

- `docs/DECISIONS_ADR.md` : un ADR par décision du porteur du 13/10/2026 — quatre processus et commande d'administration ; rôles de base distincts ; rôle `PERSONALIZER` ; mot de passe jamais en clair, enveloppe pour le poste ; cache de 5 minutes de la clé de données ; empreinte à clé des codes ; ports et faux avec garde de production (les quatre dettes, leur mission de levée) ; et toute décision prise en cours de mission (dont celle du WP13 sur la clé de données). Numéros à la suite du dernier ADR ; lignes d'index.
- Vérifie que chaque dette de `docs/POINTS_OUVERTS.md` (WP08) cite son ADR et sa mission de levée, et que `PROMPTS-A-ENVOYER.md` porte le report pour les missions 5 et 10 (déjà écrit au plan : complète-le si une dette s'est ajoutée ; retouche hors carte).
- Liste dans le compte rendu les fichiers à faire relire par une personne : `post-roles.sql`, `0013_media_api.sql`, `src/kms/**`, `src/media/personalization/**`, `src/media/auth-keys/**`, `src/media/keys/**`, `packages/tag-format/src/**`.

## Test Strategy

Tests demandés par la spec (pgTAP par contrainte, intégration HTTP sur vraie base, isolation à deux prestataires, preuves de sécurité). Ordre de vérification : `npm run lint`, `npm run typecheck`, `npm run reset-db -w @cashless/ledger-sql`, `npm run test:pgtap -w @cashless/ledger-sql`, puis `npm run reset-db -w @cashless/ledger-sql && npm test`. Ne jamais lancer pgTAP sur une base où Jest vient de tourner. Dans un worktree de lane, créer d'abord les liens `node_modules/@cashless/{api,contracts,ledger-sql,tag-format}`.

## Definition of Done

Toute la chaîne verte en local dans l'ordre de `quickstart.md` ; zéro secret au repos ; zéro fuite entre prestataires ; seuils de latence tenus ; ADR et dettes écrits ; répétition de CI consignée. Chaque sous-tâche est marquée par `spec-kitty agent tasks mark-status Txxx --status done --mission bracelets-nfc-01M4TD3W`. Le compte rendu du lot liste : écarts au plan (avec leur sens : renforcement ou non), retouches hors carte, points soumis au porteur.

## Risks / Reviewer guidance

Ce lot est la preuve de la mission : un test de recherche de secrets qui ne cherche pas les bonnes valeurs ne prouve rien — vérifie qu'il échoue quand on écrit volontairement un secret en clair, puis rétablis. **Règle de sécurité du projet (`CLAUDE.md`, C-011)** : si un point de ce lot ne peut être tenu qu'en affaiblissant la sécurité (droit plus large, contrôle retiré ou reporté, secret plus exposé, faux gardé plus longtemps), **arrête-toi sur ce point et soumets-le au porteur avant de coder** ; continue le reste. Un renforcement se fait, puis se consigne.
