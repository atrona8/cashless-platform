---
work_package_id: WP09
title: Autorité des terminaux et signataire des jetons d'appareil
dependencies:
- WP08
requirement_refs:
- C-004
- FR-009
- FR-010
- NFR-001
planning_base_branch: feat/identite-enrolement-terminaux
merge_target_branch: feat/identite-enrolement-terminaux
branch_strategy: Planning artifacts for this mission were generated on feat/identite-enrolement-terminaux. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/identite-enrolement-terminaux unless the human explicitly redirects the landing branch.
subtasks:
- T041
- T042
- T043
- T044
- T045
phase: Phase 2 - Socle applicatif
history:
- timestamp: '2026-10-19T13:30:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: node-norris
authoritative_surface: apps/api/src/device-tokens/
create_intent:
- apps/api/src/device-ca/device-ca.port.ts
- apps/api/src/device-ca/fake-device-ca.ts
- apps/api/src/device-ca/device-ca.module.ts
- apps/api/src/device-tokens/token-signer.port.ts
- apps/api/src/device-tokens/fake-token-signer.ts
- apps/api/src/device-tokens/device-token.service.ts
- apps/api/src/device-tokens/device-tokens.module.ts
- apps/api/test/unit/device-ca.spec.ts
- apps/api/test/unit/device-token.spec.ts
execution_mode: code_change
owned_files:
- apps/api/src/device-ca/**
- apps/api/src/device-tokens/**
- apps/api/test/unit/device-ca.spec.ts
- apps/api/test/unit/device-token.spec.ts
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP09 – Autorité des terminaux et signataire des jetons d'appareil

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load node-norris`. Lis ensuite `README.md` (kit), `docs/SPECIFICATION.md` (sections citées ci-dessous), puis `kitty-specs/identite-enrolement-terminaux-01M52R6H/spec.md`, `plan.md`, `research.md`, `data-model.md` et les contrats cités. En cas de contradiction entre sources, applique la règle de priorité de SPECIFICATION §0.3 et **signale-la** ; ne modifie jamais un fichier `.sql` généré de `packages/ledger-sql/` (passe par les générateurs `gen_tests.py`, `gen_golden.py`).

## Objective

Livrer les deux ports qui portent des clés de signature côté serveur — l'autorité qui émet le certificat client d'un terminal et le signataire des jetons d'appareil — avec leurs faux pour les tests, et le service qui fabrique et vérifie un jeton d'appareil.

## Context

Exigences : FR-009, FR-010, NFR-001, C-004 ; `contracts/device-tokens.md` (claims, ports) ; `research.md` R-07, R-09 ; SPECIFICATION §13.2 (clés de signature hors du code et de l'environnement : adaptateur KMS ou AWS Private CA après OP-N11, hors mission). Jetons d'injection `DEVICE_CA`, `TOKEN_SIGNER` dans `security/port-tokens.ts` (WP08). `jose` 6 est déjà une dépendance (ES256, JWK thumbprint `calculateJwkThumbprint`). Le faux de l'autorité charge l'autorité de test depuis `deviceCaFakeKeyFile` et `deviceCaCertFile` (réglages de WP08, fichiers produits par `test/support/tls.ts`) : le serveur HTTPS de test fait ainsi confiance aux certificats émis à l'enrôlement. Sans ces réglages (tests unitaires), il génère une autorité en mémoire.

**Règle de sécurité du projet (`CLAUDE.md`, C-011, C-012)** : si un point de ce lot ne peut être tenu qu'en affaiblissant la sécurité (droit plus large, contrôle retiré ou reporté, secret plus exposé, faux gardé plus longtemps), **arrête-toi sur ce point et soumets-le au porteur avant de coder**, avec le risque et les options ; continue le reste. Un renforcement se fait, puis se consigne dans le compte rendu du lot.

## Branch Strategy

Planification et merge sur `feat/identite-enrolement-terminaux`. Dépendances : WP08. L'espace de travail (worktree) est attribué par lane calculée dans `lanes.json`. Commande : `spec-kitty agent action implement WP09 --agent claude --mission identite-enrolement-terminaux-01M52R6H`.

## Subtasks

### T041 — `DeviceCaPort` et son faux

Interface de `contracts/device-tokens.md`. `issue(csr, subject, notAfter)` : vérifie que le CSR est signé par sa propre clé (`@peculiar/x509`, `Pkcs10CertificateRequest.verify()`) ; ignore le sujet demandé ; émet `CN=<device_id>, O=<operator_id>`, numéro de série aléatoire de 128 bits, `basicConstraints CA:false` (critique), `keyUsage digitalSignature` (critique), `extendedKeyUsage clientAuth`, `notBefore = maintenant − 5 min`, `notAfter` ; rend le PEM, l'empreinte SHA-256 du DER et `notAfter`. `caCertificatesPem()` rend l'autorité (pour `httpsOptions.ca`). Le faux (`isFake = true`) lit l'autorité de test des fichiers réglés (hors production seulement) ou en génère une en mémoire ; aucune clé n'est dans le dépôt.

### T042 — `TokenSignerPort` et son faux

`sign(claims): Promise<string>` (ES256, en-tête `kid`, `typ = device+jwt`), `publicJwk(): JWK`, `kid`. Faux : paire P-256 en mémoire, `isFake = true`.

### T043 — Service des jetons

`DeviceTokenService` : `issue({ deviceId, operatorId, serial, eventId, signingSpki, familyId })` → JWT avec les claims de `contracts/device-tokens.md` (`cnf.jkt` = thumbprint RFC 7638 de la clé de signature, `fid`, `jti` aléatoire, `exp` = durée réglée) ; `verify(token)` → claims ou refus : ES256 seul (`algorithms: ['ES256']`), `typ`, `iss`, `aud = cashless-device`, `exp` avec la tolérance d'horloge. N'utilise jamais `operator_id` ni `event_id` du jeton pour décider (ils sont relus en base par la garde).

### T044 — Modules

`DeviceCaModule`, `DeviceTokensModule` : fournissent les faux hors production ; en production, la fabrique lève `FakeInProductionError` (aucun adaptateur réel dans cette mission, C-004). Exporte les jetons d'injection pour l'API publique et le processus des clés de bracelet (vérification des jetons).

### T045 — Tests unitaires

Certificat émis : extensions, sujet imposé, CSR falsifié refusé, CSR d'une autre clé refusé ; jeton : claims, `cnf.jkt`, expiration, `alg: none` / HS256 / autre `aud` / autre `typ` refusés, jeton signé par une autre clé refusé ; fabriques en production → refus.

## Test Strategy

Tests demandés par la spec (pgTAP par contrainte et par refus, intégration HTTPS sur vraie base, isolation à deux prestataires, preuves de sécurité). Ordre de vérification : `npm run lint`, `npm run typecheck`, `npm run reset-db -w @cashless/ledger-sql`, `npm run test:pgtap -w @cashless/ledger-sql`, puis `npm run reset-db -w @cashless/ledger-sql && npm test -w @cashless/api -- --runInBand`. Ne jamais lancer pgTAP sur une base où Jest vient de tourner (rejouer `reset-db` entre les deux). Dans un worktree de lane, créer d'abord les liens `node_modules/@cashless/{api,contracts,ledger-sql,tag-format}` (worktrees sans `node_modules`). La base locale est en Docker : son horloge peut reculer ; aucun test ne compare l'heure de Node à `now()` de la base sans marge.

## Definition of Done

`npm run typecheck`, `npm run lint` et les tests unitaires verts. Chaque sous-tâche est marquée par `spec-kitty agent tasks mark-status Txxx --status done --mission identite-enrolement-terminaux-01M52R6H`. Le compte rendu du lot liste : écarts au plan (avec leur sens : renforcement ou non), retouches hors carte (avec une ligne de justification), points soumis au porteur, fichiers à faire relire par une personne (clés, droits de la base, cryptographie).

## Risks / Reviewer guidance

Fichiers à faire relire par une personne : `device-ca/*`, `device-tokens/*` (cryptographie). Le relecteur vérifie qu'aucun algorithme autre qu'ES256 n'est accepté et que le sujet du CSR n'est jamais recopié.
