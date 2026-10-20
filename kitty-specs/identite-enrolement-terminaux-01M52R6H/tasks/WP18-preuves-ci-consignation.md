---
work_package_id: WP18
title: Preuves de bout en bout, CI, consignation des dettes et décisions
dependencies:
- WP01
- WP02
- WP03
- WP04
- WP05
- WP06
- WP07
- WP08
- WP09
- WP10
- WP11
- WP12
- WP13
- WP14
- WP15
- WP16
- WP17
requirement_refs:
- C-011
- C-012
- NFR-001
- NFR-002
- NFR-005
- NFR-007
- NFR-009
- NFR-010
- NFR-011
planning_base_branch: feat/identite-enrolement-terminaux
merge_target_branch: feat/identite-enrolement-terminaux
branch_strategy: Planning artifacts for this mission were generated on feat/identite-enrolement-terminaux. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/identite-enrolement-terminaux unless the human explicitly redirects the landing branch.
subtasks:
- T083
- T084
- T085
- T086
- T087
phase: Phase 4 - Preuves et consignation
history:
- timestamp: '2026-10-19T13:30:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: node-norris
authoritative_surface: apps/api/test/integration/end-to-end/
create_intent:
- apps/api/test/integration/end-to-end/device-journey.spec.ts
- apps/api/test/integration/end-to-end/device-auth-matrix.spec.ts
- apps/api/test/integration/end-to-end/device-isolation.spec.ts
- apps/api/test/integration/end-to-end/device-secrets.spec.ts
- apps/api/test/integration/end-to-end/device-latency.spec.ts
execution_mode: code_change
owned_files:
- apps/api/test/integration/end-to-end/device-journey.spec.ts
- apps/api/test/integration/end-to-end/device-auth-matrix.spec.ts
- apps/api/test/integration/end-to-end/device-isolation.spec.ts
- apps/api/test/integration/end-to-end/device-secrets.spec.ts
- apps/api/test/integration/end-to-end/device-latency.spec.ts
- .github/workflows/ledger-tests.yml
- docs/POINTS_OUVERTS.md
- docs/DECISIONS_ADR.md
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP18 – Preuves de bout en bout, CI, consignation des dettes et décisions

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load node-norris`. Lis ensuite `README.md` (kit), `docs/SPECIFICATION.md` (sections citées ci-dessous), puis `kitty-specs/identite-enrolement-terminaux-01M52R6H/spec.md`, `plan.md`, `research.md`, `data-model.md` et les contrats cités. En cas de contradiction entre sources, applique la règle de priorité de SPECIFICATION §0.3 et **signale-la** ; ne modifie jamais un fichier `.sql` généré de `packages/ledger-sql/` (passe par les générateurs `gen_tests.py`, `gen_golden.py`).

## Objective

Prouver la mission de bout en bout (SC-001 à SC-008), la faire tourner en CI, et consigner la levée des dettes et les limites restantes.

## Context

Exigences : NFR-001 à NFR-011, SC-001 à SC-008, C-011, C-012 ; `quickstart.md` ; `contracts/*` (sections « Tests imposés ») ; `docs/POINTS_OUVERTS.md` (OP-N42, N44, N50, N54, N59, N62, N63 à clore ; OP-N64, OP-N65 ouverts) ; `docs/DECISIONS_ADR.md` (ADR-88, 96, 99, 101, 102, 105 : « levée par la mission 5a » ; ADR-106 à 109). Modèle : `test/integration/end-to-end/media-*.spec.ts` de la mission 4 et `.github/workflows/ledger-tests.yml`.

**Règle de sécurité du projet (`CLAUDE.md`, C-011, C-012)** : si un point de ce lot ne peut être tenu qu'en affaiblissant la sécurité (droit plus large, contrôle retiré ou reporté, secret plus exposé, faux gardé plus longtemps), **arrête-toi sur ce point et soumets-le au porteur avant de coder**, avec le risque et les options ; continue le reste. Un renforcement se fait, puis se consigne dans le compte rendu du lot.

## Branch Strategy

Planification et merge sur `feat/identite-enrolement-terminaux`. Dépendances : WP01, WP02, WP03, WP04, WP05, WP06, WP07, WP08, WP09, WP10, WP11, WP12, WP13, WP14, WP15, WP16, WP17. L'espace de travail (worktree) est attribué par lane calculée dans `lanes.json`. Commande : `spec-kitty agent action implement WP18 --agent claude --mission identite-enrolement-terminaux-01M52R6H`.

## Subtasks

### T083 — Parcours et matrice

- `device-journey.spec.ts` (SC-001) : émettre un code, enrôler un Android et un iPhone de test, lire la configuration, battement de cœur, lire un bracelet (Android), rafraîchir, suspendre, réactiver, révoquer, ré-enrôler le même `serial` ; tout par l'API, aucune écriture directe en base.
- `device-auth-matrix.spec.ts` (NFR-002, SC-002) : pour chaque route de terminal (liste dérivée du contrat : opérations dont `security` contient `deviceSignature`), une requête par preuve absente, fausse, expirée, d'un autre terminal, rejouée, signée pour une autre autorité → 100 % refusées.

### T084 — Isolation, secrets, latence

`device-isolation.spec.ts` (NFR-007, SC-006) : deux prestataires, chaque route de la mission ; même `serial` des deux côtés. `device-secrets.spec.ts` (NFR-005, SC-005) : après le parcours, recherche des codes, jetons de rafraîchissement et jetons d'appareil de test dans toutes les tables, l'audit, le registre d'idempotence et la sortie des journaux → 0. `device-latency.spec.ts` (NFR-009) : surcoût des trois preuves p95 ≤ 20 ms (comparé au faux sur la même route), enrôlement p95 ≤ 1 s, configuration et battement p95 ≤ 200 ms ; garde de production : un test par faux (NFR-001), reprenant ceux de WP08 et WP09 si besoin.

### T085 — CI

`.github/workflows/ledger-tests.yml` : `npm ci` avec `ignore-scripts=true` ; variables de test (clés HMAC, réglages d'attestation de test) ; les nouvelles suites pgTAP ; les tests HTTPS (certificats générés à l'exécution par `test/support/tls.ts`) ; contrôle `check:generated` et `npm run generate` sans écart.

### T086 — Consignation

`POINTS_OUVERTS.md` : OP-N42, OP-N44, OP-N50, OP-N54, OP-N59, OP-N62, OP-N63 passés en « Points tranchés » avec la mission, le test qui le prouve et la date ; vue d'ensemble mise à jour ; OP-N64 et OP-N65 vérifiés (test de borne cité). `DECISIONS_ADR.md` : ADR-88, ADR-96, ADR-99, ADR-101, ADR-102, ADR-105 complétés (« levée par la mission 5a », référence du test) ; ADR-106 à ADR-109 vérifiés contre le code livré. Tout écart découvert pendant la mission et non encore consigné l'est ici (C-012), ou remonte au porteur.

### T087 — Relecture humaine

Liste au compte rendu les fichiers à faire relire par une personne (règle 4 de `CLAUDE.md`) : `post-roles.sql`, `gen_tests.py`, migrations `0021` à `0025`, `processes/bootstrap.ts`, `device-identity/{real-device-identity,request-signature,device.guard}.ts`, `device-ca/*`, `device-tokens/*`, `attestation/*`, `.npmrc`, `package.json` (`overrides`).

## Test Strategy

Tests demandés par la spec (pgTAP par contrainte et par refus, intégration HTTPS sur vraie base, isolation à deux prestataires, preuves de sécurité). Ordre de vérification : `npm run lint`, `npm run typecheck`, `npm run reset-db -w @cashless/ledger-sql`, `npm run test:pgtap -w @cashless/ledger-sql`, puis `npm run reset-db -w @cashless/ledger-sql && npm test -w @cashless/api -- --runInBand`. Ne jamais lancer pgTAP sur une base où Jest vient de tourner (rejouer `reset-db` entre les deux). Dans un worktree de lane, créer d'abord les liens `node_modules/@cashless/{api,contracts,ledger-sql,tag-format}` (worktrees sans `node_modules`). La base locale est en Docker : son horloge peut reculer ; aucun test ne compare l'heure de Node à `now()` de la base sans marge.

## Definition of Done

CI verte sur la branche ; toutes les suites vertes ; points ouverts et ADR à jour. Chaque sous-tâche est marquée par `spec-kitty agent tasks mark-status Txxx --status done --mission identite-enrolement-terminaux-01M52R6H`. Le compte rendu du lot liste : écarts au plan (avec leur sens : renforcement ou non), retouches hors carte (avec une ligne de justification), points soumis au porteur, fichiers à faire relire par une personne (clés, droits de la base, cryptographie).

## Reports des relectures (20/10/2026)

- `openapi.yaml` : la description de `TAP_UNUSABLE` ne cite pas le nouveau motif de WP05 (lecture liée à une demande de
  rattachement, `CL022`) ; à compléter (WP01 étant approuvé).
- Recette (mission 13) : essayer `@peculiar/asn1-android` 2.10.0 sur de vrais appareils (balise KeyDescription
  inconnue : refus fermé probable, non vérifié).
- Lever OP-N50 dans `docs/POINTS_OUVERTS.md` (migration 0024) et mettre à jour ADR-90 et ADR-101.
- Test Jest à deux connexions sur la course entre une écriture et une demande de rattachement sur la même lecture
  (verrou `media-tap-use:` de 0024, vérifié à la main seulement).
- Lever OP-N62 dans `docs/POINTS_OUVERTS.md` (migration 0025, puis droits de WP07) et mettre à jour ADR-102.
- Mise en production : purger les lignes `api_idempotency` dont l'empreinte a été calculée sans clé (antérieures à WP13),
  ou consigner la consigne de déploiement ; lever OP-N54 et mettre à jour ADR-99.
- Relecture WP13 : `personalizationHash` (`apps/api/src/media/personalization/personalization.dto.ts:76`, portée `perso:`)
  écrit encore un SHA-256 sans clé dans `api_idempotency.request_hash`. Passe-le sous `idempotencyHmacKey` (renforcement)
  avant de déclarer OP-N54 levé ; test qui échoue si une empreinte sans clé est écrite.
- Relecture WP11 : consigner pour la mission 12 que le `keyId` App Attest (credentialId) devra être renvoyé par le port et
  stocké (assertions App Attest, condition de levée d'OP-N64), et que l'app passe `iosClientDataHash` tel quel à
  `attestKey`. Recette (mission 13) : objet App Attest réel enregistré et vraie racine Apple.

## Risks / Reviewer guidance

Le relecteur vérifie qu'aucun écart de sécurité n'est resté hors des points ouverts (constat bloquant sinon) et que chaque dette close cite un test qui échouait avant la mission.
