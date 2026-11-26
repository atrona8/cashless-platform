---
work_package_id: WP09
title: AWS KMS (cinq ports) et copie des scellements sur S3 Object Lock
dependencies: [WP01]
requirement_refs:
- FR-010
- FR-011
- C-005
planning_base_branch: feat/adaptateurs-fournisseurs-choisis
merge_target_branch: feat/adaptateurs-fournisseurs-choisis
branch_strategy: >-
  Planning artifacts for this mission were generated on feat/adaptateurs-fournisseurs-choisis. During
  /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must
  merge back into feat/adaptateurs-fournisseurs-choisis unless the human explicitly redirects the landing branch.
subtasks: [T038, T039, T040, T041, T042]
phase: Phase 2 - Réception et adaptateurs
agent: claude
history:
- timestamp: '2026-11-26T15:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: apps/api/src/kms/aws/
create_intent:
- apps/api/src/kms/aws/aws-kms.ts
- apps/api/src/sealing/s3-seal-copy.ts
- apps/api/test/unit/kms/aws/aws-kms.spec.ts
- apps/api/test/unit/sealing/s3-seal-copy.spec.ts
- apps/api/test/support/fake-servers/kms.ts
- apps/api/test/support/fake-servers/s3.ts
execution_mode: code_change
model: sonnet
owned_files:
- apps/api/src/kms/aws/**
- apps/api/src/sealing/s3-seal-copy.ts
- apps/api/test/unit/kms/aws/**
- apps/api/test/unit/sealing/s3-seal-copy.spec.ts
- apps/api/test/support/fake-servers/kms.ts
- apps/api/test/support/fake-servers/s3.ts
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP09 — AWS KMS (cinq ports) et copie des scellements sur S3 Object Lock

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role : implementer / Agent :
claude). Lis ensuite la fiche commune `docs/passation-12b-1/fiche-implementation.md` (démarrage, règles, base de
données, fin d'implémentation : ne pas la recopier ici), ce prompt, puis seulement (`<M>` =
`kitty-specs/adaptateurs-fournisseurs-choisis-01M8BXJA`) :

- `<M>/interfaces.md` §2, §6 ; `<M>/contracts/aws.md` ; `<M>/research.md` R-09, R-10 ;
- `apps/api/src/kms/kms.ports.ts` (contrat de chaque port : format DER, SPKI 91 octets, mise à zéro), `fake-kms.ts`,
  `zeroize.ts`, `kms.module.ts` (répartition des ports par processus) ; `test/unit/kms/*.spec.ts` (ce que les
  appelants vérifient : `sign-port.spec.ts`) ;
- `apps/api/src/sealing/seal-copy.ts`, `fake-seal-copy.ts`, `audit-seal.worker.ts` (usage de `write`/`read`).

## Objective

`AwsKms` sert les cinq ports de clés avec AWS KMS, au même format que le faux ; `S3SealCopy` copie les
scellements en écriture unique (mode conformité, 10 ans, D8). Aucun processus ne reçoit plus de ports qu'aujourd'hui (C-005).

Dépendances : WP01. Implémentation :
`LC_ALL=C LANG=C spec-kitty agent action implement WP09 --agent claude --mission adaptateurs-fournisseurs-choisis-01M8BXJA`.

## Branch Strategy

Planification et fusion sur `feat/adaptateurs-fournisseurs-choisis`. Le worktree d'exécution est celui de la lane calculée dans
`<M>/lanes.json` ; si ta lane dépend d'autres lanes, `bash docs/passation-12b-1/scripts/merge-deps.sh <lettre>`
d'abord.

## Subtasks

### T038 — Les cinq ports

`GenerateMacCommand({ KeyId, Message, MacAlgorithm: 'HMAC_SHA_256' })` → `Buffer.from(Mac)` ;
`GenerateDataKeyCommand({ KeyId, KeySpec: 'AES_256' })` → `{ plaintext, encrypted }` ; `DecryptCommand({ KeyId,
CiphertextBlob })` ; `SignCommand({ KeyId, Message, MessageType: 'RAW', SigningAlgorithm: 'ECDSA_SHA_256' })` → DER ;
`GetPublicKeyCommand` → `PublicKey` (SPKI DER ; vérifie 91 octets et `KeySpec = ECC_NIST_P256`) ; `CreateKeyCommand`
(`HMAC_256` + `GENERATE_VERIFY_MAC`, `SYMMETRIC_DEFAULT` + `ENCRYPT_DECRYPT`, `ECC_NIST_P256` + `SIGN_VERIFY`) →
`KeyMetadata.Arn` ; `DisableKeyCommand`.

### T039 — Bornes et hygiène

Message > 4 096 octets → refus avant appel (`Sign`, `GenerateMac`). Les tampons rendus par le SDK sont copiés dans des
`Buffer` remis à l'appelant, puis les `Uint8Array` du SDK mis à zéro (`zeroize`). Erreurs : classe et code AWS
seulement, jamais l'identifiant de clé ni le message.

### T040 — Un processus, ses seuls ports

`forCapabilities(caps: KmsCapability[])` rend un objet gelé n'exposant que les méthodes des ports demandés (un appel à
une méthode absente n'existe pas au typage, et l'objet n'a pas la propriété). WP10 le branchera dans `kms.module.ts`.
Test : `forCapabilities(['sign'])` n'a ni `generateMac` ni `decrypt`.

### T041 — `S3SealCopy`

1. `write(seal, hash)` : `PutObjectCommand({ Bucket, Key: <kind>/<id>/<sealNo>, Body: hash, ObjectLockMode:
   'COMPLIANCE', ObjectLockRetainUntilDate: now + retentionDays, ChecksumAlgorithm: 'SHA256', IfNoneMatch: '*' })` →
   rend la clé. 412 (objet déjà là) → `GetObject` ; même empreinte → clé ; différente → `Error('copie de scellement
   divergente')`.
2. `read(ref)` : `GetObjectCommand` → `Buffer` ; `NoSuchKey` → `null`.
3. `isFake = false`.

### T042 — Faux serveurs et tests

1. `fake-servers/kms.ts` (protocole JSON `TrentService.*`, champs base64) qui calcule réellement : HMAC-SHA256 avec une
   clé de test, AES-256 enveloppe, signature ECDSA P-256 (`node:crypto`) en DER, clé publique SPKI. `fake-servers/s3.ts`
   (REST : `PUT/GET /<bucket>/<key>`, en-têtes `x-amz-object-lock-mode`, `x-amz-object-lock-retain-until-date`,
   `If-None-Match`, 412).
2. Tests : MAC de 32 octets et déterministe ; clé de données aller-retour ; signature vérifiée par `crypto.verify` avec
   la clé publique servie ; DER (pas r||s) ; 4 097 octets refusés sans requête ; création des trois types (usage
   envoyé exact) ; S3 : en-têtes de verrou exacts, rétention = +3 650 jours, écrasement refusé et contrôlé, relecture.
3. Mutations : `MessageType: 'DIGEST'` ; retrait d'`IfNoneMatch` ; rétention en mode `GOVERNANCE` ; `forCapabilities`
   qui expose tout.

## Definition of Done

- Toutes les sous-tâches faites ; fichiers limités aux `owned_files` (+ retouches de compilation nommées) ;
- tests du lot verts sur la base du lot (ou sans base pour les tests unitaires), **aucun appel réseau externe** ;
- chaque contrôle ajouté a sa mutation notée (retiré → test rouge → remis) ;
- `eslint`, `prettier --check`, `tsc --noEmit` propres sur les fichiers du lot ;
- note de lane : retouches hors carte, écarts (renforce/affaiblit), points « à confirmer à l'essai », fichiers à
  faire relire par une personne.

## Ce que le relecteur doit casser

Signature au format brut ; message tronqué au lieu de refusé ; un port de trop exposé ; tampon non remis à zéro ;
mode `GOVERNANCE` ou écrasement possible ; identifiant de clé dans une erreur.

## Retouches hors carte permises

Seulement les retouches de compilation imposées par un changement de signature d'un lot antérieur (`interfaces.md`
§1), nommées dans la note de lane. Tout autre besoin : signale-le, ne le code pas.
