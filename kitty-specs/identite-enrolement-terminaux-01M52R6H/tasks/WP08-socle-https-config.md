---
work_package_id: WP08
title: 'Socle applicatif : dépendances, réglages, HTTPS avec certificat client, garde de production'
dependencies: []
requirement_refs:
- C-004
- FR-009
- FR-012
- NFR-001
- NFR-009
planning_base_branch: feat/identite-enrolement-terminaux
merge_target_branch: feat/identite-enrolement-terminaux
branch_strategy: Planning artifacts for this mission were generated on feat/identite-enrolement-terminaux. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/identite-enrolement-terminaux unless the human explicitly redirects the landing branch.
subtasks:
- T035
- T036
- T037
- T038
- T039
- T040
phase: Phase 2 - Socle applicatif
history:
- timestamp: '2026-10-19T13:30:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: node-norris
authoritative_surface: apps/api/src/processes/bootstrap.ts
create_intent:
- .npmrc
- apps/api/src/security/port-tokens.ts
- apps/api/src/devices/devices.module.ts
- apps/api/test/support/tls.ts
execution_mode: code_change
owned_files:
- package.json
- package-lock.json
- apps/api/package.json
- .npmrc
- apps/api/src/config/config.ts
- apps/api/src/processes/bootstrap.ts
- apps/api/src/kms/production-guard.ts
- apps/api/src/security/port-tokens.ts
- apps/api/src/devices/devices.module.ts
- apps/api/src/app.module.ts
- apps/api/test/support/app.ts
- apps/api/test/support/tls.ts
- apps/api/test/unit/config.spec.ts
- apps/api/test/unit/production-guard.spec.ts
- tools/dev-db/env.sh
- tools/dev-db/env.test.example
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP08 – Socle applicatif : dépendances, réglages, HTTPS avec certificat client, garde de production

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load node-norris`. Lis ensuite `README.md` (kit), `docs/SPECIFICATION.md` (sections citées ci-dessous), puis `kitty-specs/identite-enrolement-terminaux-01M52R6H/spec.md`, `plan.md`, `research.md`, `data-model.md` et les contrats cités. En cas de contradiction entre sources, applique la règle de priorité de SPECIFICATION §0.3 et **signale-la** ; ne modifie jamais un fichier `.sql` généré de `packages/ledger-sql/` (passe par les générateurs `gen_tests.py`, `gen_golden.py`).

## Objective

Préparer le terrain applicatif de la mission : dépendances épinglées et sans scripts d'installation, réglages nouveaux, processus HTTP servis en TLS 1.3 avec certificat client demandé (vérifié par la garde), jetons d'injection des nouveaux ports et garde « aucun faux en production » étendue, module `devices` vide branché dans l'application, serveur HTTPS de test.

## Context

Exigences : NFR-001, NFR-009, C-004 ; `research.md` R-03 (mTLS dans les processus, décision du porteur ; TLS 1.3 ; `TRUST_PROXY_HOPS = 0` exigé avec TLS), R-12 (dépendances), R-13 (clés HMAC), R-07 et R-09 (durées) ; `plan.md` IC-07, IC-08 ; `quickstart.md`. Code existant : `config/config.ts` (lecture de l'environnement sans `@nestjs/config`, valeurs de test hors production, obligatoires en production), `processes/bootstrap.ts` (`serve`, `assertProcessIsSafe`, `applyTrustProxy`), `kms/production-guard.ts`, `test/support/app.ts`. Mémoire du poste : worktrees sans `node_modules` (créer les liens), base Docker dont l'horloge peut reculer.

**Règle de sécurité du projet (`CLAUDE.md`, C-011, C-012)** : si un point de ce lot ne peut être tenu qu'en affaiblissant la sécurité (droit plus large, contrôle retiré ou reporté, secret plus exposé, faux gardé plus longtemps), **arrête-toi sur ce point et soumets-le au porteur avant de coder**, avec le risque et les options ; continue le reste. Un renforcement se fait, puis se consigne dans le compte rendu du lot.

## Branch Strategy

Planification et merge sur `feat/identite-enrolement-terminaux`. Dépendances : aucune. L'espace de travail (worktree) est attribué par lane calculée dans `lanes.json`. Commande : `spec-kitty agent action implement WP08 --agent claude --mission identite-enrolement-terminaux-01M52R6H`.

## Subtasks

### T035 — Dépendances, `overrides`, `.npmrc`

- `apps/api/package.json` : `@peculiar/x509` **2.1.0**, `@peculiar/asn1-android` **2.10.0**, `@peculiar/asn1-schema` 2.10.0, `@peculiar/asn1-x509` 2.10.0, `cbor2` **2.3.0**, `structured-headers` **2.1.0**, versions exactes.
- `package.json` racine, `overrides` : chaque `@peculiar/asn1-*` tiré par `@peculiar/x509` (`asn1-cms`, `asn1-csr`, `asn1-ecc`, `asn1-rsa`, `asn1-x509`, `asn1-pkcs9`, `asn1-schema`, `asn1-x509-post-quantum`, `asn1-x509-attr`, `asn1-pfx`, `asn1-pkcs8`, `asn1-asym-key`, `asn1-android`) à 2.10.0 ; `asn1js` à 3.0.10 ; `@peculiar/utils` et `tsyringe` à une version publiée depuis plus de deux semaines (vérifie par `npm view <paquet> time`). Aucune plage `^`.
- `.npmrc` : `ignore-scripts=true`. Vérifie ensuite que `npm ci`, `npm run lint`, `npm run typecheck`, `npm test` et les outils de build (`esbuild`, `@swc/core`, `unrs-resolver`, `@parcel/watcher`) fonctionnent sans leurs scripts ; si l'un casse, **arrête-toi** et soumets au porteur (retirer la règle serait un affaiblissement).
- Consigne dans le compte rendu : version, date de publication, scripts d'installation (aucun) pour chaque paquet ajouté.

### T036 — Réglages

Ajoute à `AppConfig`, avec valeurs de test hors production et **obligatoires en production** (démarrage refusé sinon), sur le modèle de `claimCodeHmacKey` et d'`oidc` :
- TLS : `tlsCertFile`, `tlsKeyFile` ; autorité des terminaux : `deviceCaCertFile` (certificats acceptés pour le mTLS) ; `deviceCaFakeKeyFile` (clé de l'autorité **de test**, lue seulement par le faux de WP09 ; présente en production → refus de démarrer) ;
- jetons : `deviceTokenIssuer`, durée du jeton (900 s), du jeton de rafraîchissement (30 j), du certificat (365 j, 1 à 730) ;
- attestation : `androidAttestationRoots` (fichier PEM), `androidAppPackage`, `androidAppSigningDigests` (liste), `androidMinPatchLevel`, `iosAppAttestRoot`, `iosTeamId`, `iosBundleId`, `iosAppAttestEnvironment` (`production` exigé en production) ;
- secrets HMAC : `idempotencyHmacKey`, `enrollmentCodeHmacKey` (32 octets au moins, hors base, distincts de `claimCodeHmacKey`) ;
- `clockToleranceSeconds` par défaut (lu de la configuration de l'événement à l'exécution ; borne 300).
Mets à jour `tools/dev-db/env.sh` et `env.test.example` (valeurs de test seulement).

### T037 — HTTPS avec certificat client

Dans `serve()` : `NestFactory.create(rootModule, { bufferLogs: true, rawBody: true, httpsOptions: { key, cert, ca: <autorité des terminaux>, requestCert: true, rejectUnauthorized: false, minVersion: 'TLSv1.3' } })`. Pas d'écoute en clair quand TLS est configuré. Garde : en production avec TLS servi par le processus, `trustProxyHops` doit valoir 0 (sinon refus de démarrer, message qui cite OP-N53 et R-03). Hors production sans certificat configuré, le processus peut écouter en clair (tests existants). `rawBody` est requis par la vérification de `Content-Digest` (WP12) : vérifie qu'il ne casse pas le corps JSON des routes existantes.

### T038 — Jetons de ports et garde

`security/port-tokens.ts` : symboles `DEVICE_CA`, `TOKEN_SIGNER`, `ATTESTATION_VERIFIER` (utilisés par WP09, WP10, WP11). `assertProcessIsSafe` vérifie aussi ces trois fournisseurs (`isFake`), en plus du service de clés et des identités. La garde reste sans réglage pour la désactiver.

### T039 — Module `devices` et serveur HTTPS de test

- `devices/devices.module.ts` : module Nest vide (`imports: []`), importé par `app.module.ts`. Les lots WP14 à WP17 y ajoutent chacun une ligne d'import.
- `test/support/tls.ts` : génère une fois par exécution (avec `@peculiar/x509` et `node:crypto`), dans un répertoire temporaire, une autorité de test des terminaux (certificat et clé) et un certificat serveur pour `localhost` ; rend leurs chemins, posés dans la configuration de test (`TLS_CERT_FILE`, `TLS_KEY_FILE`, `DEVICE_CA_CERT_FILE`, `DEVICE_CA_FAKE_KEY_FILE`). Ainsi le serveur HTTPS de test fait confiance aux certificats que le faux de l'autorité (WP09) émet à l'enrôlement. Aucune clé de test n'est écrite dans le dépôt.
- `test/support/app.ts` : en plus du mode actuel (supertest en clair, inchangé pour les tests existants), une fonction `startHttpsApp()` qui écoute sur un port libre en HTTPS avec ces certificats et rend l'URL de base et un `close()`.

### T040 — Tests unitaires

`config.spec.ts` : chaque réglage nouveau obligatoire en production ; bornes ; clés HMAC trop courtes refusées ; `iosAppAttestEnvironment = development` refusé en production. `production-guard.spec.ts` : chacun des trois nouveaux faux fait refuser le démarrage ; `trustProxyHops > 0` avec TLS refusé en production.

## Test Strategy

Tests demandés par la spec (pgTAP par contrainte et par refus, intégration HTTPS sur vraie base, isolation à deux prestataires, preuves de sécurité). Ordre de vérification : `npm run lint`, `npm run typecheck`, `npm run reset-db -w @cashless/ledger-sql`, `npm run test:pgtap -w @cashless/ledger-sql`, puis `npm run reset-db -w @cashless/ledger-sql && npm test -w @cashless/api -- --runInBand`. Ne jamais lancer pgTAP sur une base où Jest vient de tourner (rejouer `reset-db` entre les deux). Dans un worktree de lane, créer d'abord les liens `node_modules/@cashless/{api,contracts,ledger-sql,tag-format}` (worktrees sans `node_modules`). La base locale est en Docker : son horloge peut reculer ; aucun test ne compare l'heure de Node à `now()` de la base sans marge.

## Definition of Done

`npm ci` (sans scripts), `npm run lint`, `npm run typecheck`, `npm test -w @cashless/api -- --runInBand` verts ; les tests existants passent sans changement de comportement. Chaque sous-tâche est marquée par `spec-kitty agent tasks mark-status Txxx --status done --mission identite-enrolement-terminaux-01M52R6H`. Le compte rendu du lot liste : écarts au plan (avec leur sens : renforcement ou non), retouches hors carte (avec une ligne de justification), points soumis au porteur, fichiers à faire relire par une personne (clés, droits de la base, cryptographie).

## Risks / Reviewer guidance

Fichiers à faire relire par une personne : `processes/bootstrap.ts` (TLS), `.npmrc`, `package.json` (`overrides`). Le relecteur vérifie qu'aucun réglage n'a de valeur par défaut en production, que `rejectUnauthorized: false` est compensé par la garde (WP12) et qu'aucune écoute en clair ne reste en production.
