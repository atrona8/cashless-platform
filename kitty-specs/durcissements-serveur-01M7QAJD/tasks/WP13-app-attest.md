---
work_package_id: WP13
title: "App Attest côté API : clé gardée à l'enrôlement, assertions vérifiées (OP-N64)"
dependencies: [WP03]
requirement_refs: [FR-018, FR-019]
planning_base_branch: feat/durcissements-serveur
merge_target_branch: feat/durcissements-serveur
branch_strategy: Planning artifacts for this mission were generated on feat/durcissements-serveur. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/durcissements-serveur unless the human explicitly redirects the landing branch.
base_branch: kitty/mission-durcissements-serveur-01M7QAJD
base_commit: 3c3cef2296f9f9c971366402b37f6c276a897085
created_at: '2026-11-19T09:45:49.980239+00:00'
subtasks: [T049, T050, T051, T052]
phase: Phase 2 - API et processus
agent: claude
history:
- timestamp: '2026-11-18T16:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: apps/api/src/attestation/
create_intent:
- apps/api/src/attestation/ios-app-attest-assertion.ts
- apps/api/test/unit/attestation/ios-assertion.spec.ts
- apps/api/test/unit/attestation/assertion-architecture.spec.ts
- apps/api/test/integration/attestation/app-attest-enrollment.spec.ts
- apps/api/test/integration/attestation/app-attest-assertion.spec.ts
execution_mode: code_change
model: sonnet
owned_files:
- apps/api/src/attestation/**
- apps/api/src/devices/enrollment/enrollment.service.ts
- apps/api/test/support/attestation/ios.ts
- apps/api/test/unit/attestation/**
- apps/api/test/integration/attestation/**
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP13 : App Attest côté API : clé gardée à l'enrôlement, assertions vérifiées (OP-N64)

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role :
implementer / Agent : claude). Lis ensuite la fiche commune `docs/passation-11a/fiche-implementation.md`, ce
prompt, puis seulement :

- `kitty-specs/durcissements-serveur-01M7QAJD/interfaces.md` (lignes `device_app_attest_key`, `enroll_device` nouvelle
  version, `advance_app_attest_counter`, `AttestationResult.appAttestKey`, `IosAppAttestAssertionVerifier`, code
  `CL059`) ; `plan.md` IC-09 et « Décisions différées » n° 3 ; `spec.md` FR-018, FR-019 ;
- `research/R-N64-N116-app-attest-passerelles.md` **partie A seulement** (A1 à A5). **Attention** : la recherche
  proposait `store_device_app_attest_key` ; la décision retenue (interfaces.md, WP02) passe la clé par une **nouvelle
  version d'`enroll_device`** (deux arguments facultatifs `p_app_attest_key_id`, `p_app_attest_public_key`). Suis
  `interfaces.md`, signale tout écart ;
- les notes de lane de WP02 (migration `0095` telle que fusionnée : **signatures réelles**, ordre des arguments,
  forme exacte de la clé publique stockée, comportement de `advance_app_attest_counter`) et de WP03 (droits) ;
- `apps/api/src/attestation/ios-app-attest.ts` en entier (295 lignes ; surtout `checkChain` l. 225-270,
  `checkAuthData` l. 262-293, `uncompressedPoint` l. 135-147, `verify`), `attestation.port.ts` l. 28-52,
  `fake-attestation.ts`, `attestation.module.ts` l. 40-115 (`AttestationRouter`, `createAttestationVerifier`),
  `enrollment-challenge.ts` (encodage préfixe + longueur) ;
- `apps/api/src/devices/enrollment/enrollment.service.ts` l. 140-230 (étape 9 : `enroll_device`, audit
  `DEVICE_ENROLLED`) et l. 274-292 (`verifyAttestation`) ;
- `apps/api/test/support/attestation/ios.ts` en entier (`keyPair`, `rawPoint`, `spki`, `authData`, `appAttestObject`,
  `createIosTestPki`) ; `test/unit/attestation/ios.spec.ts` (surtout l. 122-128) ;
- `apps/api/test/unit/architecture.spec.ts` l. 100-175 (lecture seule : modèle d'une règle d'import ; le fichier est à
  WP06).

Priorité des sources (SPECIFICATION §0.3). Contradiction : tu la signales. `interfaces.md` fait foi.

## Objective

Rendre le serveur capable de vérifier une assertion App Attest, **sans la brancher sur aucune route** : (1) l'enrôlement
d'un iPhone garde la clé attestée et son identifiant ; (2) un vérificateur interne `IosAppAttestAssertionVerifier`
contrôle clé, signature, `rpIdHash`, lien avec la requête et compteur strictement croissant, et fait avancer le compteur
de façon atomique. La borne iOS (`POST /media/auth-keys` refuse un terminal iOS) reste **intacte** : OP-N64 passe
« côté serveur prêt », il n'est pas levé (la levée dépend de l'app, mission 12).

## Context

- Point ouvert : **OP-N64** (ADR-106), « côté serveur prêt » après ce lot. Décision du porteur du 18/11/2026 : un seul
  `EXECUTE` nouveau pour `cashless_app` hors OP-N60 : `advance_app_attest_counter` ; risque de déni de service (une API
  compromise peut faire avancer un compteur et bloquer les assertions de cet appareil, sans gagner d'accès) consigné
  par WP14, avec un test de borne. Aucun droit de table.
- **Limite à signaler (R1 de la recherche, à reporter dans la note de lane et la fiche de WP14)** : les vecteurs sont
  générés localement ; une erreur de double hachage ECDSA (la signature porte sur `nonce` traité comme un message,
  donc hachée une seconde fois par ECDSA-SHA256) serait invisible, car le signeur et le vérificateur sont écrits par
  nous. **Un vecteur réel d'Apple est exigé avant la mission 12.** Rédige-le comme limite, pas comme acquis.
- Aucune route, aucun champ, aucun code d'erreur exposé nouveau (`openapi.yaml` inchangé). Le choix des champs de la
  requête liée par `clientDataHash` appartient à la mission 12 : ce lot reçoit un `clientDataHash` déjà calculé et
  prouve
  seulement qu'un autre hash est refusé.
- **Aucun faux nouveau.** `FakeAttestation` (déjà refusé en production) ne change pas de statut ; pour iOS il peut ne
  rendre aucune clé (`appAttestKey` absente : `enroll_device` reçoit `NULL`, valeur par défaut). Un test garde que
  l'enrôlement avec le faux reste possible hors production.
- **Interfaces possédées** : `AttestationResult.appAttestKey?: { keyId: Buffer; publicKey: Buffer }` ;
  `IosAppAttestAssertionVerifier.verify({ deviceId, assertion, clientDataHash })` (fichier
  `ios-app-attest-assertion.ts`). **Consommées** : table `device_app_attest_key`, `enroll_device` nouvelle version,
  `advance_app_attest_counter(p_device uuid, p_key_id bytea, p_counter bigint) RETURNS boolean` (vrai si
  `counter < p_counter`, faux sinon ; autre prestataire ou appareil révoqué : `CL059`).
- La signature exacte de `verify` et la façon dont il obtient un client de base **dans la transaction du prestataire**
  (la fonction de base compare le prestataire de session) ne sont pas figées par `interfaces.md` : choisis la plus
  petite (un client tenant passé en argument, ou un `TenantTx` injecté) et **note la signature réelle dans la note de
  lane** pour que l'orchestrateur mette `interfaces.md` à jour.
- Tests d'architecture : la règle « le vérificateur n'est importé par aucun contrôleur ni garde » est dans **un fichier
  à toi**, `test/unit/attestation/assertion-architecture.spec.ts`, pas dans `architecture.spec.ts` (WP06).
- Retouche hors carte probable : une ligne d'import dans `apps/api/src/app.module.ts` **seulement si** le module
  d'attestation doit exporter le vérificateur à un module non encore importé (signalée) ; une ligne dans
  `errors/sqlstate-map.ts` seulement si `CL059` peut s'échapper du vérificateur (préfère le convertir en
  `AttestationError` à l'intérieur).

## Subtasks

### T049 : `ios-app-attest.ts` rend la clé attestée et le keyId ; l'enrôlement les passe à `enroll_device`

- **Étapes** :
  1. `attestation.port.ts` : ajouter le champ facultatif `appAttestKey?: { keyId: Buffer; publicKey: Buffer }` à
     `AttestationResult` (publicKey : SPKI DER, forme attendue par `enroll_device`, lis la note de WP02).
  2. `ios-app-attest.ts` : `checkChain` renvoie la feuille ; la clé de la feuille (`leaf.x509.publicKey`) et le
     `credentialId` vérifié dans `checkAuthData` sont aujourd'hui **jetés** : les garder. `keyId` = `credentialId`
     (SHA-256 du point non compressé, 32 octets) ; `publicKey` = `key.export({ type: 'spki', format: 'der' })`.
     `verify` rend `{ kind: 'IOS_APP_ATTEST', securityLevel: null, appAttestKey }`.
  3. `attestation.module.ts` : `AttestationRouter` transmet le résultat tel quel ; Android : aucun champ.
  4. `enrollment.service.ts` (l. 168-184) : si `verified.appAttestKey`, passer `keyId` et `publicKey` comme 14e et 15e
     arguments d'`enroll_device` (ordre : lis la signature fusionnée) ; sinon `NULL`. Ajouter `app_attest_key_id` (hex
     du
     keyId, **jamais** la clé publique complète ni le compteur) à l'`after` de l'audit `DEVICE_ENROLLED` pour iOS.
     L'enrôlement reste atomique : un échec de l'insertion de la clé annule tout (même transaction).
  5. Adapter `test/unit/attestation/ios.spec.ts` l. 122-128 : le `toEqual({kind, securityLevel: null})` casse,
     remplace-le
     par `toMatchObject` plus un contrôle de `appAttestKey.keyId` = SHA-256 du point de la clé de test et de
     `publicKey`.
- **Fichiers** : `attestation.port.ts`, `ios-app-attest.ts`, `attestation.module.ts` (si besoin),
  `fake-attestation.ts` (inchangé si possible), `enrollment.service.ts`, `test/unit/attestation/ios.spec.ts`.
- **Validation** : `test/unit/attestation/` (aucune base) ; puis intégration `app-attest-enrollment.spec.ts` (nouveau,
  base `cashless_wp13`) : l'enrôlement iOS écrit une ligne `device_app_attest_key` avec `key_id` = SHA-256 du point,
  `counter = 0`, `operator_id` du prestataire ; un enrôlement **Android** n'en écrit aucune ; une même attestation
  rejouée (`key_id` unique) est refusée ; l'audit porte `app_attest_key_id` en hex et pas la clé.
- **Pièges** : `device.public_key` est la clé de **signature** du terminal, pas la clé App Attest ; ne pas les
  confondre. Les chemins de rejet de l'attestation (`AttestationError` → `422 ATTESTATION_FAILED`) ne changent pas.
- **Mutation** : ne pas passer la clé à `enroll_device` ; le test « ligne écrite à l'enrôlement » échoue.

### T050 : `IosAppAttestAssertionVerifier`

- **But** : `apps/api/src/attestation/ios-app-attest-assertion.ts` (fichier nouveau), mêmes helpers que
  `ios-app-attest.ts` (`sha256`, `sameBytes`, `cbor2` aux mêmes options : `preferMap`, `rejectDuplicateKeys`,
  `rejectStreaming`, `ignoreGlobalTags`), mêmes réglages `teamId` / `bundleId` (refusés vides ou de développement en
  production par `config.ts` : ne rien ajouter à la garde de production).
- **Étapes** (ordre d'Apple, à recouper avec la page « Validating apps that connect to your server » avant de coder :
  la recherche est rédigée de mémoire) :
  1. Décoder l'objet CBOR `{ signature, authenticatorData }` : exactement ces deux clés textuelles, taille bornée
     avant décodage, pas de `fmt` ni `attStmt` ; `authenticatorData` de **37 octets** exactement, drapeau AT absent.
  2. `nonce = SHA-256(authenticatorData ‖ clientDataHash)`.
  3. Lire la ligne `device_app_attest_key` de l'appareil (SELECT sous RLS, aucun droit nouveau) : clé publique,
     compteur.
  4. Vérifier `signature` (DER) sur `nonce` **traité comme un message** :
     `crypto.verify('sha256', nonce, { key: createPublicKey(spki), dsaEncoding: 'der' }, signature)`. Ne **jamais**
     passer le condensé comme déjà haché (piège R1).
  5. `rpIdHash == SHA-256(teamId + '.' + bundleId)`.
  6. `signCount` (4 octets grand-boutistes) **strictement supérieur** au compteur lu ; puis appeler
     `advance_app_attest_counter(deviceId, keyId, signCount)` : `false` (rejeu concurrent ou compteur non croissant) =
     refus ; `CL059` converti en `AttestationError('appareil refusé')`.
  7. Tout refus lève `AttestationError` avec une `reason` interne (jamais renvoyée au client). Un appareil sans ligne
     (Android, ancien iOS) : refus.
- **Aucune route** : le vérificateur est fourni par `AttestationModule` mais injecté nulle part d'autre ; il n'est
  importé d'aucun `*.controller.ts` ni d'aucune garde.
- **Fichiers** : `ios-app-attest-assertion.ts` (nouveau), `attestation.module.ts` (fournisseur et export).
- **Pièges** : l'avance du compteur doit être **le dernier effet** et une seule instruction conditionnelle (c'est la
  fonction SQL qui sérialise) ; ne jamais faire « lire puis écrire » en TypeScript ; ne pas journaliser la signature, la
  clé ni l'objet CBOR ; comparaisons d'octets par `sameBytes`/`timingSafeEqual`.
- **Mutation** : retirer le contrôle `signCount > compteur lu` **et** le retour de `advance` ; les tests de compteur
  égal et de concurrence échouent (deux mutations séparées, notées).

### T051 : aide de test `appAssertion` ; unitaires

- **Étapes** :
  1. `test/support/attestation/ios.ts` : ajouter `appAssertion({ privateKey, clientDataHash, counter, rpId?, flags?,
     signatureOverride?, extraKeys? })` : `authenticatorData = rpIdHash | flags | counter(4, grand-boutiste)`,
     `nonce = sha256(authenticatorData ‖ clientDataHash)`, signature DER de `nonce` **comme message**
     (`node:crypto.sign('sha256', nonce, { key, dsaEncoding: 'der' })`, ou WebCrypto `ECDSA/SHA-256` converti en DER),
     CBOR `encode(new Map([['signature', …], ['authenticatorData', …]]))`.
  2. `test/unit/attestation/ios-assertion.spec.ts` (nouveau) : assertion valide ; signature d'une autre clé ;
     `clientDataHash` d'une autre requête ; `rpIdHash` d'une autre application ; compteur égal, inférieur, supérieur ;
     CBOR illisible, clé manquante ou en trop, `authenticatorData` ≠ 37 octets, drapeau AT présent, objet démesuré,
     signature non DER ; cohérence : enrôlement par `appAttestObject` puis assertion par la **même** clé réussit, par
     une
     autre clé échoue. Le vérificateur est testé avec un faux accès au compteur (en mémoire) pour les cas sans base.
  3. **Contrôle positif** : chaque test de refus est précédé d'un cas valide construit par la même aide.
- **Validation** : `SKIP_LATENCY=1 npx jest test/unit/attestation --runInBand --forceExit`.
- **Piège** : le signeur de test et le vérificateur partagent ta compréhension du format : écris le signeur **depuis la
  spécification d'Apple**, pas depuis le vérificateur, et dis dans la note que cela ne remplace pas le vecteur réel.

### T052 : intégration et test d'architecture propre

- **Étapes** :
  1. `test/integration/attestation/app-attest-assertion.spec.ts` (nouveau, base `cashless_wp13`) : enrôlement iOS puis
     assertion valide : compteur avancé en base ; deux assertions **concurrentes** de même compteur
     (`Promise.all`) : une seule réussit ; compteur égal ou inférieur : refus ; appareil d'**un autre prestataire** :
     refus (`CL059` converti) ; appareil `REVOKED` : refus ; `cashless_app` ne peut ni `INSERT`, ni `UPDATE`, ni
     `DELETE`
     directement la table (`42501`) et ne peut exécuter que les fonctions listées (rien d'autre n'est accordé).
  2. `test/unit/attestation/assertion-architecture.spec.ts` (nouveau, fichier à toi) : aucun fichier `*.controller.ts`,
     aucune garde et aucun fichier atteignable depuis une route n'importe `ios-app-attest-assertion.ts` ni ne référence
     `IosAppAttestAssertionVerifier` (lis la méthode de `architecture.spec.ts` pour lister les fichiers, sans la
     modifier). Test de **borne** : `device-auth-matrix.spec.ts` et `media-port-swap.spec.ts` restent verts, inchangés
     (« borne iOS (OP-N64) » : seule `/media/auth-keys` refuse un terminal iOS), preuve que la limite n'est pas levée.
  3. Vérifier à la main que `os = 'IOS'` n'a jamais `nfc_enabled` (test existant, lecture seule).
- **Validation** : `export PGDATABASE=cashless_wp13; source ../../tools/dev-db/env.sh; env | grep DATABASE_URL` puis
  `SKIP_LATENCY=1 npx jest test/integration/attestation test/unit/attestation --runInBand --forceExit`, puis les deux
  suites de borne nommées ci-dessus ; `reset-db` après.
- **Mutation** : faire importer le vérificateur par un contrôleur de test ; le test d'architecture échoue.

## Branch Strategy

Planification et fusion sur `feat/durcissements-serveur`. Le worktree de lane est calculé par `lanes.json`
(`.worktrees/durcissements-serveur-01M7QAJD-lane-x`) ; travaille uniquement dedans. Implémentation :

```
LC_ALL=C LANG=C spec-kitty agent action implement WP13 --agent claude --mission durcissements-serveur-01M7QAJD
```

WP02 (`0095`) et WP03 (droits) doivent être fusionnés dans la lane avant les tests d'intégration
(`docs/passation-11a/scripts/merge-deps.sh`). Base : `cashless_wp13`, jamais `cashless_test`.

## Definition of Done

- [ ] `AttestationResult.appAttestKey` rendu par le vrai vérificateur iOS ; ligne écrite à l'enrôlement, atomique.
- [ ] Audit `DEVICE_ENROLLED` : `app_attest_key_id` en hex, jamais la clé publique ni le compteur.
- [ ] Vérificateur d'assertions : CBOR strict, nonce, signature sur le message, `rpIdHash`, compteur strict, avance
      atomique.
- [ ] Concurrence : deux assertions de même compteur, une seule réussit ; autre prestataire et appareil révoqué refusés.
- [ ] Aucun contrôleur ni garde n'importe le vérificateur ; test dans un fichier propre ; borne iOS verte et inchangée.
- [ ] Un seul `EXECUTE` nouveau pour `cashless_app` (celui de WP02/WP03) ; aucun droit de table ; aucun faux nouveau.
- [ ] Mutations notées : clé non passée à l'enrôlement, `signCount` non contrôlé, retour d'`advance` ignoré, import par
      un contrôleur.
- [ ] La note de lane contient : la signature réelle de `verify`, la limite « vecteur réel d'Apple exigé avant la
      mission 12 », et les fichiers à faire relire par une personne : `ios-app-attest-assertion.ts` et la fonction SQL
      `advance_app_attest_counter`.
- [ ] `openapi.yaml` inchangé ; lignes de 100 caractères au plus ; aucune dépendance (`cbor2` déjà présent).

## Risks

- R1 (crypto) : double hachage invisible avec des vecteurs auto-générés ; relecture humaine et vecteur Apple réels.
- Le compteur d'Apple peut ne pas être strictement monotone (bug d'app, restauration) : la règle du porteur (strict)
  l'impose, un terminal bloqué se ré-enrôle.
- `enroll_device` a changé de signature (WP02) : tout appelant oublié casse ; `grep` de `enroll_device(` dans `apps/` et
  signale tout appel hors `enrollment.service.ts`.
- Un `toEqual` sur `AttestationResult` ailleurs dans les tests : le chercher avant de conclure.

## Ce que le relecteur doit casser

1. Rejouer une assertion (même compteur, compteur inférieur) en séquence et en parallèle ; compteur très grand
   (`4294967295`) ; vérifier qu'aucun chemin n'avance le compteur avant la vérification de la signature.
2. Signer avec la clé d'un autre appareil du même prestataire, d'un autre prestataire, d'un appareil révoqué ; changer
   un octet de `authenticatorData`, du `clientDataHash`, du `rpIdHash` : refus à chaque fois, avec contrôle positif.
3. Chercher le double hachage : lire `crypto.verify` (message, pas condensé) et refaire le calcul à la main avec un
   vecteur
   indépendant du signeur de test.
4. Chercher un accès au vérificateur depuis une route, un garde ou un module importé par un contrôleur ; relancer la
   borne iOS (`/media/auth-keys` refuse toujours iOS).
5. Chercher une fuite : clé publique, signature, objet CBOR ou compteur dans l'audit, le journal ou une erreur.
6. Droits : `cashless_app` n'a que l'`EXECUTE` annoncé et aucun droit de table sur `device_app_attest_key` ; tout droit
   en plus est un constat bloquant.
7. Écart non signalé : fichier hors `owned_files`, `architecture.spec.ts` modifié, un faux conservé en production.
