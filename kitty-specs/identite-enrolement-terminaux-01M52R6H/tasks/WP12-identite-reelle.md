---
work_package_id: WP12
title: 'Identité réelle du terminal : trois preuves derrière DeviceIdentityPort (OP-N42)'
dependencies:
- WP04
- WP07
- WP08
- WP09
requirement_refs:
- FR-012
- FR-013
- FR-014
- NFR-002
- NFR-003
- NFR-004
planning_base_branch: feat/identite-enrolement-terminaux
merge_target_branch: feat/identite-enrolement-terminaux
branch_strategy: Planning artifacts for this mission were generated on feat/identite-enrolement-terminaux. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/identite-enrolement-terminaux unless the human explicitly redirects the landing branch.
subtasks:
- T056
- T057
- T058
- T059
- T060
- T061
- T062
phase: Phase 2 - Socle applicatif
history:
- timestamp: '2026-10-19T13:30:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: node-norris
authoritative_surface: apps/api/src/device-identity/
create_intent:
- apps/api/src/device-identity/real-device-identity.ts
- apps/api/src/device-identity/request-signature.ts
- apps/api/src/device-identity/nonce-store.ts
- apps/api/test/support/test-terminal.ts
- apps/api/test/unit/request-signature.spec.ts
- apps/api/test/unit/real-device-identity.spec.ts
execution_mode: code_change
owned_files:
- apps/api/src/device-identity/**
- apps/api/src/media/auth-keys/auth-keys.controller.ts
- apps/api/src/processes/tag-keys.module.ts
- apps/api/src/errors/sqlstate-map.ts
- apps/api/test/support/test-terminal.ts
- apps/api/test/support/fake-device.ts
- apps/api/test/unit/request-signature.spec.ts
- apps/api/test/unit/real-device-identity.spec.ts
- apps/api/test/integration/end-to-end/media-port-swap.spec.ts
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP12 – Identité réelle du terminal : trois preuves derrière DeviceIdentityPort (OP-N42)

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load node-norris`. Lis ensuite `README.md` (kit), `docs/SPECIFICATION.md` (sections citées ci-dessous), puis `kitty-specs/identite-enrolement-terminaux-01M52R6H/spec.md`, `plan.md`, `research.md`, `data-model.md` et les contrats cités. En cas de contradiction entre sources, applique la règle de priorité de SPECIFICATION §0.3 et **signale-la** ; ne modifie jamais un fichier `.sql` généré de `packages/ledger-sql/` (passe par les générateurs `gen_tests.py`, `gen_golden.py`).

## Objective

Remplacer le faux d'identité du terminal (OP-N42, bloque la production) par l'implémentation réelle : chaque requête de terminal porte ensemble certificat client, jeton d'appareil lié et signature de son contenu, liés au même terminal ; le statut et la famille de jetons sont relus en base ; aucune route de la mission 4 ne change (SC-007), hormis la borne iOS d'OP-N64.

## Context

Exigences : FR-012, FR-013, FR-014, NFR-002, NFR-003, NFR-004, SC-007 ; `contracts/device-authentication.md` (ordre des contrôles, base de signature) ; `research.md` R-01, R-03, R-04, R-14 ; décisions `DM-01M52R88ZPZEA0NXVSDY9PBXW5`, `DM-01M59SAEYDXFK29HMMFBTJ96KS`. Code existant : `device-identity/{device-identity.port,device.guard,device-identity.module,fake-device-identity}.ts`, `processes/tag-keys.module.ts` (importe `DeviceIdentityModule`), `media/auth-keys/auth-keys.controller.ts`, `test/support/fake-device.ts` (insère `device` directement : interdit après WP07). Fonctions de base : `consume_device_nonce`, `device_token_family_active`, `assert_device_active` (WP04), `enroll_device` (WP03). Ports : `DeviceTokenService` (WP09). Serveur HTTPS de test et autorité de test : `test/support/{app,tls}.ts` (WP08).

**Règle de sécurité du projet (`CLAUDE.md`, C-011, C-012)** : si un point de ce lot ne peut être tenu qu'en affaiblissant la sécurité (droit plus large, contrôle retiré ou reporté, secret plus exposé, faux gardé plus longtemps), **arrête-toi sur ce point et soumets-le au porteur avant de coder**, avec le risque et les options ; continue le reste. Un renforcement se fait, puis se consigne dans le compte rendu du lot.

## Branch Strategy

Planification et merge sur `feat/identite-enrolement-terminaux`. Dépendances : WP04, WP07, WP08, WP09. L'espace de travail (worktree) est attribué par lane calculée dans `lanes.json`. Commande : `spec-kitty agent action implement WP12 --agent claude --mission identite-enrolement-terminaux-01M52R6H`.

## Subtasks

### T056 — Profil de signature

`request-signature.ts` : analyse `Signature-Input` et `Signature` avec `structured-headers` ; libellé `dev` seul ; composants exactement ceux de R-04 (ordre imposé ; `idempotency-key` exigé si la route est une écriture, c'est-à-dire si la requête porte `Idempotency-Key`) ; `expires` refusé ; construit la base de signature RFC 9421 (`@authority` = en-tête `Host` normalisé ; `@query` = `?` + chaîne brute, `?` seul si vide) ; `Content-Digest` : `sha-256` seul, comparé au SHA-256 de `req.rawBody` (corps vide : empreinte de la chaîne vide) ; vérification `crypto.verify('sha256', base, { key: spki, dsaEncoding: 'ieee-p1363' }, signature)`. Fonction `signRequest(...)` symétrique pour le terminal de test.

### T057 — Magasin de nonces

`nonce-store.ts` : appelle `consume_device_nonce` (heure de la base) dans sa propre transaction de prestataire ; traduit `CLOCK_SKEW` → `400 CLOCK_SKEW_TOO_LARGE` avec en-tête `Date` (heure du serveur), `REPLAY` → `401 DEVICE_SIGNATURE_INVALID`. Appelé seulement après vérification des trois preuves.

### T058 — `RealDeviceIdentity`

Implémente `DeviceIdentityPort.identify(req)` dans l'ordre exact de `contracts/device-authentication.md` (1 à 7) : certificat (`req.socket.getPeerX509Certificate()`, `socket.authorized`, `validTo` revérifié) ; jeton (`DeviceTokenService.verify`) ; terminal lu par l'annuaire avec `public_key`, `cert_sha256`, statut et état de la famille `fid` ; empreinte du certificat = `cert_sha256` ; `cnf.jkt` = thumbprint de `public_key` ; `Content-Digest` ; signature ; nonce. Tout échec → `null` ou exception normalisée **sans** dire quelle preuve a échoué au client ; raison exacte au journal technique (jamais le jeton, la signature ni le certificat complet). Rend `DeviceClaims`.

### T059 — Garde, annuaire, câblage

- `DeviceGuard` : option `@DeviceAuth({ allowSuspended: true })` (défaut : suspendu refusé, comportement actuel). Le décorateur sans argument garde sa signature : les contrôleurs de la mission 4 ne changent pas.
- `DeviceDirectory.find` lit aussi `public_key`, `cert_sha256`, `os`, `nfc_enabled` et l'état de la famille ; `req.device` reçoit `os` et `nfcEnabled`.
- `createDeviceIdentity` : construit `RealDeviceIdentity` ; le faux n'est construit que si `production = false` **et** `DEVICE_IDENTITY_FAKE=1` (tests unitaires qui en ont besoin). Le processus des clés de bracelet (`tag-keys.module.ts`) reçoit la même identité réelle, avec sa propre lecture sous son rôle de base (droits posés par WP07).
- `errors/sqlstate-map.ts` (ce lot en est propriétaire) : traduit tous les `CL` nouveaux des migrations 0022 à 0025 (liste dans les commentaires des migrations et les comptes rendus de WP03, WP04, WP06), dont `assert_device_active` → `DEVICE_SUSPENDED` / `DEVICE_REVOKED`, `PAIRED_TPE` → `DEVICE_MODE_NOT_ALLOWED`, code invalide ou expiré, `serial` actif → `DEVICE_SERIAL_IN_USE`, transition interdite → `CONFLICT_STATE`.

### T060 — Terminal de test

`test/support/test-terminal.ts` : génère les deux paires P-256 ; produit les attestations de test (WP10, WP11) avec les défis de `enrollment-challenge.ts` ; CSR (`@peculiar/x509`) ; méthode `enroll(codeOrFixture)` (par la route `POST /device-enrollments` quand WP14 sera fusionné, ou par `enroll_device` en propriétaire pour les tests de ce lot) ; client HTTPS (`undici` ou `https.Agent` avec `cert`, `key`) qui signe chaque requête (`signRequest`) et pose le jeton ; options pour retirer ou fausser chaque preuve (matrice de NFR-002). `fake-device.ts` : bascule sur `enroll_device` (plus d'`INSERT` direct dans `device`) en gardant son interface pour les tests de la mission 4.

### T061 — Borne iOS (OP-N64)

`POST /media/auth-keys` refuse un terminal `os = IOS` (`403 DEVICE_MODE_NOT_ALLOWED`), par une option du décorateur (`@DeviceAuth({ nfcOnly: true })`) ou un contrôle dans la garde : c'est la seule ligne changée dans un contrôleur de la mission 4 ; consigne-la (renforcement, ADR-106). Test qui échoue si la borne s'élargit.

### T062 — Tests

`request-signature.spec.ts` (base de signature exacte sur un exemple fixe ; chaque composant manquant ou en trop ; `@authority` différent ; corps modifié ; encodage DER refusé ; `expires` refusé). `real-device-identity.spec.ts` (ordre des contrôles, aucune écriture de nonce avant les preuves). `media-port-swap.spec.ts` : les routes `POST /taps` et `POST /media/auth-keys` servies par l'identité réelle avec le terminal de test, contrôleurs inchangés (vérifie par `git diff` qu'aucune ligne des contrôleurs n'a bougé, sauf T061).

## Test Strategy

Tests demandés par la spec (pgTAP par contrainte et par refus, intégration HTTPS sur vraie base, isolation à deux prestataires, preuves de sécurité). Ordre de vérification : `npm run lint`, `npm run typecheck`, `npm run reset-db -w @cashless/ledger-sql`, `npm run test:pgtap -w @cashless/ledger-sql`, puis `npm run reset-db -w @cashless/ledger-sql && npm test -w @cashless/api -- --runInBand`. Ne jamais lancer pgTAP sur une base où Jest vient de tourner (rejouer `reset-db` entre les deux). Dans un worktree de lane, créer d'abord les liens `node_modules/@cashless/{api,contracts,ledger-sql,tag-format}` (worktrees sans `node_modules`). La base locale est en Docker : son horloge peut reculer ; aucun test ne compare l'heure de Node à `now()` de la base sans marge.

## Definition of Done

Tests unitaires et d'intégration verts, dont toute la suite de la mission 4 rejouée avec l'identité réelle (`npm test -w @cashless/api -- --runInBand`). Chaque sous-tâche est marquée par `spec-kitty agent tasks mark-status Txxx --status done --mission identite-enrolement-terminaux-01M52R6H`. Le compte rendu du lot liste : écarts au plan (avec leur sens : renforcement ou non), retouches hors carte (avec une ligne de justification), points soumis au porteur, fichiers à faire relire par une personne (clés, droits de la base, cryptographie).

## Reports des relectures (20/10/2026)

- Branche `purge_device_request_nonces` sur `WorkerRegistry` (aucun lot ne le faisait, relecture WP04 M3) ; rythme
  réglable, rôle de base qui l'exécute consigné pour WP07.
- Pose `app.operator_id` avant `device_token_family_active` (sinon toujours faux).
- `assert_device_active` est obligatoire dans la transaction avant `register_tap` et `post_transaction` (qui ne
  contrôlent pas le statut), APRÈS toute fonction qui prend le terminal en `FOR UPDATE` (`record_device_seq`,
  `waive_seq_gap`, `open_offline_batch`, `record_device_heartbeat`, `set_device_status`), sinon interblocage 40P01 ;
  inutile après `open_offline_batch` ; jamais sur les routes `allowSuspended`. `CL030` → `403 DEVICE_SUSPENDED`.
- Le terminal de test réutilise `apps/api/src/attestation/enrollment-challenge.ts` tel quel ; ordre Android : clé
  d'accord (défi A), puis clé de signature (défi S, qui contient le SPKI de la clé d'accord).
- Relecture WP11 : un terminal de test iOS passe la sortie de `iosClientDataHash` telle quelle comme `clientDataHash`
  (nonce = SHA-256(`authData` ‖ `clientDataHash`)), sans la hacher une seconde fois (R-06 précisé).
- Compte rendu de WP07 : accorde `purge_device_enrollment_attempts` et `purge_device_request_nonces` (accordées à
  personne) au seul rôle du processus qui les planifie, dans `post-roles.sql` ; `cashless_tagkeys` lit désormais
  `device.public_key`, `cert_sha256`, `os` et `nfc_enabled` pour la garde.

## Risks / Reviewer guidance

Fichiers à faire relire par une personne : `real-device-identity.ts`, `request-signature.ts`, `device.guard.ts`. Le relecteur vérifie l'ordre des contrôles, qu'aucune preuve n'est optionnelle, que le faux n'est atteignable que hors production et sous variable explicite, et qu'aucun message d'erreur ne révèle la preuve fautive.
