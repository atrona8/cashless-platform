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
- Compte rendu de WP07 : lever OP-N44, la fin d'OP-N59 et OP-N63 (droits rôle par rôle, TEMPORARY retiré, colonnes de
  `device` protégées : `tests_execute_grants.sql`, `tests_device_rights.sql`) ; OP-N68 / ADR-111 (droit par défaut des
  fonctions futures) reste ouvert, mission 7 : le lister dans la revue des écarts de sécurité.
- Relecture WP07 : OP-N69 / ADR-112 (colonnes de `device` encore écrites par l'API, mission 7) à lister dans la revue
  des écarts ; aucun test ne couvre le verrou consultatif de `migrate.ts` (deux exécutions simultanées), à ajouter
  (renforcement).
- WP12 (décision du porteur du 20/10, OP-N70, ADR-113) : passe en HTTPS réel, avec le terminal de test, au moins
  une route de chaque contrôleur de terminal de la mission 4 (les suites en clair restent sous
  `DEVICE_IDENTITY_FAKE=1`), et ajoute un test qui échoue si une route de terminal n'est couverte par aucun test en
  identité réelle ; puis lève OP-N70. Consigne aussi `DEVICE_REQUEST_AUTHORITIES` (renforcement de WP12) et prévois
  l'historique git complet en CI pour le test `git diff` de WP12 (SC-007).
- Relecture WP12 : test qui échoue si le refus de `X-Staff-Authorization` hors des routes de guichet est retiré de
  `authentication.guard.ts` (route de personne et route publique non-terminal, M1) ; tests de `config.ts` : en
  production, `DEVICE_REQUEST_AUTHORITIES` obligatoire et joker `:*` refusé (M3). Mineur : contrôle de longueur à 64
  octets de `request-signature.ts:278` redondant avec `ieee-p1363` (M4).
- ADR-114 (décision du porteur du 20/10) : test pgTAP qui échoue si `purge_device_request_nonces` retire un nonce
  encore dans sa fenêtre, ou si `purge_device_enrollment_attempts` retire un essai de moins de 24 h, appelées en
  `cashless_app` ; à citer dans la revue des écarts (droit plus large accepté).

## Reports des relectures (21/10/2026)

- ADR-116 / OP-N71 (décision du porteur du 21/10, relecture de WP16) : correction transverse de l'idempotence.
  `requestHash` prend le chemin concret (paramètres de chemin compris, sans chaîne de requête) au lieu du modèle de
  route, et la clé est liée à l'appelant (personne, terminal ou processus) ; mise à jour de la règle 3 de
  `kitty-specs/fondations-grand-livre-01M4AY8M/contracts/idempotency.md`. Tests : même clé sur deux `:id`
  (`POST /v1/devices/{A,B}/revoke`) → `422 IDEMPOTENCY_KEY_REUSED` et B réellement traité seulement par sa propre clé ;
  même clé par deux personnes du même prestataire → aucune réponse de l'autre ; rejeu légitime inchangé. Consigne de
  déploiement des lignes `api_idempotency` antérieures, avec celle d'OP-N54. Puis lever OP-N71.
- Relecture WP16 : test de ré-enrôlement du `serial` après une révocation faite par le back-office (FR-016) ; FR-025 :
  vérifier l'adresse IP et le `request_id` dans l'audit des transitions ; `deviceScope` (défense en profondeur) :
  vérifier le type et l'identifiant de la portée d'une attribution OPERATOR_ADMIN.
- Revue des écarts de sécurité : lister ADR-115 (contrôle de famille relâché à l'étape 3 pour un terminal `REVOKED`,
  compensé par les étapes 4 à 6). Lignes de plus de 100 caractères laissées par WP16
  (`real-device-identity.ts:129`, `admin.spec.ts:612`, `test/unit/real-device-identity.spec.ts:4,248,258`) : couvertes
  par le reformatage Prettier à la fusion.
- Relecture WP14 (N1) : `enrollment.spec.ts` gère la table `device_enrollment_attempt` et la limite par adresse de
  127.0.0.1. Une suite qui doit seulement disposer d'un terminal l'enrôle par `TestTerminal.enroll` (propriétaire), pas
  par la route ; une suite qui enrôle par la route n'efface que ses propres essais.

## Risks / Reviewer guidance

Le relecteur vérifie qu'aucun écart de sécurité n'est resté hors des points ouverts (constat bloquant sinon) et que chaque dette close cite un test qui échouait avant la mission.
