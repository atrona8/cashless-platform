---
work_package_id: WP10
title: Attestation Android (Key Attestation, deux clés, Android 12+)
dependencies:
- WP08
requirement_refs:
- FR-005
- NFR-001
planning_base_branch: feat/identite-enrolement-terminaux
merge_target_branch: feat/identite-enrolement-terminaux
branch_strategy: Planning artifacts for this mission were generated on feat/identite-enrolement-terminaux. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/identite-enrolement-terminaux unless the human explicitly redirects the landing branch.
subtasks:
- T046
- T047
- T048
- T049
- T050
- T051
phase: Phase 2 - Socle applicatif
history:
- timestamp: '2026-10-19T13:30:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: node-norris
authoritative_surface: apps/api/src/attestation/
create_intent:
- apps/api/src/attestation/attestation.port.ts
- apps/api/src/attestation/enrollment-challenge.ts
- apps/api/src/attestation/android-key-attestation.ts
- apps/api/src/attestation/google-revocation-cache.ts
- apps/api/src/attestation/attestation.module.ts
- apps/api/src/attestation/fake-attestation.ts
- apps/api/test/support/attestation/android.ts
- apps/api/test/unit/attestation/android.spec.ts
- apps/api/test/unit/attestation/challenge.spec.ts
execution_mode: code_change
owned_files:
- apps/api/src/attestation/attestation.port.ts
- apps/api/src/attestation/enrollment-challenge.ts
- apps/api/src/attestation/android-key-attestation.ts
- apps/api/src/attestation/google-revocation-cache.ts
- apps/api/src/attestation/attestation.module.ts
- apps/api/src/attestation/fake-attestation.ts
- apps/api/test/support/attestation/android.ts
- apps/api/test/unit/attestation/android.spec.ts
- apps/api/test/unit/attestation/challenge.spec.ts
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP10 – Attestation Android (Key Attestation, deux clés, Android 12+)

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load node-norris`. Lis ensuite `README.md` (kit), `docs/SPECIFICATION.md` (sections citées ci-dessous), puis `kitty-specs/identite-enrolement-terminaux-01M52R6H/spec.md`, `plan.md`, `research.md`, `data-model.md` et les contrats cités. En cas de contradiction entre sources, applique la règle de priorité de SPECIFICATION §0.3 et **signale-la** ; ne modifie jamais un fichier `.sql` généré de `packages/ledger-sql/` (passe par les générateurs `gen_tests.py`, `gen_golden.py`).

## Objective

Vérifier à l'enrôlement les deux chaînes Android Key Attestation (clé de signature et clé d'accord) jusqu'aux racines Google, avec tous les contrôles de `research.md` R-05, et dériver les défis d'enrôlement de R-08.

## Context

Exigences : FR-005, NFR-001 ; décisions du porteur : attestation Android et iOS (`DM-01M59RR2KCM2NMTGNR62HXJD76`), Android 12 minimum (`DM-01M59WNTT06K1SY81HBK6PT4E8`) ; `research.md` R-05, R-08, R-12, R-15 (constats 1, 2, 10 de la passe contradictoire) ; `contracts/enrollment.md`. Bibliothèques (WP08) : `@peculiar/asn1-android` (schéma `KeyDescription`), `@peculiar/asn1-schema` (`AsnConvert.parse`), `node:crypto` (`X509Certificate`). Jeton d'injection `ATTESTATION_VERIFIER` (WP08). Le port est partagé avec iOS (WP11, qui ajoute sa classe).

**Règle de sécurité du projet (`CLAUDE.md`, C-011, C-012)** : si un point de ce lot ne peut être tenu qu'en affaiblissant la sécurité (droit plus large, contrôle retiré ou reporté, secret plus exposé, faux gardé plus longtemps), **arrête-toi sur ce point et soumets-le au porteur avant de coder**, avec le risque et les options ; continue le reste. Un renforcement se fait, puis se consigne dans le compte rendu du lot.

## Branch Strategy

Planification et merge sur `feat/identite-enrolement-terminaux`. Dépendances : WP08. L'espace de travail (worktree) est attribué par lane calculée dans `lanes.json`. Commande : `spec-kitty agent action implement WP10 --agent claude --mission identite-enrolement-terminaux-01M52R6H`.

## Subtasks

### T046 — Port et défis

- `attestation.port.ts` : `AttestationVerifier.verify(input) → { kind, securityLevel }` ou exception `AttestationError` (raison interne, jamais renvoyée au client) ; entrée : `os`, chaînes, SPKI des deux clés, code normalisé, `serial`.
- `enrollment-challenge.ts` : `androidAgreeChallenge(code, serial)`, `androidSignChallenge(code, serial, agreementSpki)`, `iosClientDataHash(code, serial, signingSpki, agreementSpki)` selon R-08, avec préfixes de domaine et champs préfixés par leur longueur (pas d'ambiguïté de concaténation). Fonctions pures, réutilisées par le terminal de test (WP12).

### T047 — Chaîne

Feuille en premier. Pour chaque certificat : `issuer` = `subject` du suivant, signature vérifiée par la clé du suivant, dates valides, intermédiaires avec `basicConstraints CA:true` ; dernier certificat égal (DER) à une racine de `androidAttestationRoots`. Extension KeyDescription (`1.3.6.1.4.1.11129.2.1.17`) présente dans la feuille **seulement**.

### T048 — KeyDescription

Contrôles de R-05, lus dans `teeEnforced`/`hardwareEnforced` jamais dans `softwareEnforced` : `attestationVersion ≥ 100` ; niveaux `TrustedEnvironment` ou `StrongBox` ; `attestationChallenge` = défi attendu ; `origin = GENERATED` ; `purpose` contient `SIGN` (clé de signature) ou `AGREE_KEY` (clé d'accord) ; `algorithm = EC`, `ecCurve = P_256` ; `rootOfTrust.deviceLocked = true`, `verifiedBootState = Verified` ; `osPatchLevel`, `vendorPatchLevel`, `bootPatchLevel` ≥ réglage ; `attestationApplicationId` : un seul paquet, celui attendu, et toutes ses empreintes de signature dans l'ensemble autorisé. Clé publique de la feuille = SPKI annoncé.

### T049 — Liste de révocation

`GoogleRevocationCache` : charge `https://android.googleapis.com/attestation/status` (URL réglable), rafraîchit toutes les heures, garde la dernière liste valide ; plus de 24 h sans rafraîchissement réussi → toute attestation Android refusée (échec fermé). Statut `REVOKED` ou `SUSPENDED` → refus ; numéros de série comparés en hexadécimal minuscule sans zéros de tête. En test : source injectée (pas d'appel réseau).

### T050 — Chaînes de test

`test/support/attestation/android.ts` : racine et intermédiaire de test, feuille portant une extension KeyDescription construite avec `@peculiar/asn1-android` (`AsnConvert.serialize`), paramétrable champ par champ (pour fabriquer chaque cas refusé). La racine de test n'est acceptée que si elle est passée explicitement au vérificateur (jamais par défaut).

### T051 — Tests unitaires

Un cas nominal par clé ; un test de refus par contrôle de T047 à T049 (chaîne cassée, racine inconnue, extension dans un intermédiaire, `attestationVersion` 4, niveau `Software`, défi faux, `origin = IMPORTED`, `purpose` absent, courbe autre, appareil déverrouillé, démarrage non vérifié, correctif trop ancien, deux paquets, empreinte de signature inconnue, clé de la feuille ≠ SPKI, numéro révoqué, numéro suspendu, cache périmé) ; défis : stables, et un octet changé donne un autre défi.

## Test Strategy

Tests demandés par la spec (pgTAP par contrainte et par refus, intégration HTTPS sur vraie base, isolation à deux prestataires, preuves de sécurité). Ordre de vérification : `npm run lint`, `npm run typecheck`, `npm run reset-db -w @cashless/ledger-sql`, `npm run test:pgtap -w @cashless/ledger-sql`, puis `npm run reset-db -w @cashless/ledger-sql && npm test -w @cashless/api -- --runInBand`. Ne jamais lancer pgTAP sur une base où Jest vient de tourner (rejouer `reset-db` entre les deux). Dans un worktree de lane, créer d'abord les liens `node_modules/@cashless/{api,contracts,ledger-sql,tag-format}` (worktrees sans `node_modules`). La base locale est en Docker : son horloge peut reculer ; aucun test ne compare l'heure de Node à `now()` de la base sans marge.

## Definition of Done

Tests unitaires verts ; `npm run typecheck` et `npm run lint` verts. Chaque sous-tâche est marquée par `spec-kitty agent tasks mark-status Txxx --status done --mission identite-enrolement-terminaux-01M52R6H`. Le compte rendu du lot liste : écarts au plan (avec leur sens : renforcement ou non), retouches hors carte (avec une ligne de justification), points soumis au porteur, fichiers à faire relire par une personne (clés, droits de la base, cryptographie).

## Risks / Reviewer guidance

Fichiers à faire relire par une personne : `android-key-attestation.ts`, `enrollment-challenge.ts`. Le relecteur vérifie qu'aucun contrôle ne lit `softwareEnforced`, que l'échec du cache est fermé, et que la liste à jour des racines Google a été vérifiée (rotation annoncée) au moment de configurer `androidAttestationRoots`.
