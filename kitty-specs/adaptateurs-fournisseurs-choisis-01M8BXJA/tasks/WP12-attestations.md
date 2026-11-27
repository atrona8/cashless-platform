---
work_package_id: WP12
title: 'Attestations Android et Apple App Attest : comparaison aux documentations'
dependencies: []
requirement_refs:
- FR-012
planning_base_branch: feat/adaptateurs-fournisseurs-choisis
merge_target_branch: feat/adaptateurs-fournisseurs-choisis
branch_strategy: >-
  Planning artifacts for this mission were generated on feat/adaptateurs-fournisseurs-choisis. During
  /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must
  merge back into feat/adaptateurs-fournisseurs-choisis unless the human explicitly redirects the landing branch.
subtasks: [T052, T053, T054]
phase: Phase 2 - Réception et adaptateurs
agent: claude
history:
- timestamp: '2026-11-26T15:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: apps/api/src/attestation/
create_intent:
- docs/passation-12b-1/attestations-comparaison.md
execution_mode: code_change
model: sonnet
owned_files:
- apps/api/src/attestation/**
- apps/api/test/unit/attestation/**
- docs/passation-12b-1/attestations-comparaison.md
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP12 — Attestations Android et Apple App Attest : comparaison aux documentations

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role : implementer / Agent :
claude). Lis ensuite la fiche commune `docs/passation-12b-1/fiche-implementation.md` (démarrage, règles, base de
données, fin d'implémentation : ne pas la recopier ici), ce prompt, puis seulement (`<M>` =
`kitty-specs/adaptateurs-fournisseurs-choisis-01M8BXJA`) :

- `<M>/spec.md` FR-012 ; `<M>/research.md` R-14 ;
- `apps/api/src/attestation/*.ts` et `test/unit/attestation/*.spec.ts` ; `docs/SERVICES-EXTERNES.md` §2.16, §2.17 ;
- documentation officielle (à lire, par l'outil de lecture web) : Android Key Attestation
  (`developer.android.com/privacy-and-security/security-key-attestation`), état de révocation
  (`android.googleapis.com/attestation/status`, format) ; Apple App Attest (« Validating apps that connect to your
  server » sur `developer.apple.com`).

## Objective

Vérifier que l'attestation Android et Apple App Attest, déjà branchées, suivent les documentations de Google et
d'Apple, pour qu'il ne reste que la configuration à poser. **Aucun changement sans écart constaté** (no-op permis).

Dépendances : aucune. Implémentation :
`LC_ALL=C LANG=C spec-kitty agent action implement WP12 --agent claude --mission adaptateurs-fournisseurs-choisis-01M8BXJA`.

## Branch Strategy

Planification et fusion sur `feat/adaptateurs-fournisseurs-choisis`. Le worktree d'exécution est celui de la lane calculée dans
`<M>/lanes.json` ; si ta lane dépend d'autres lanes, `bash docs/passation-12b-1/scripts/merge-deps.sh <lettre>`
d'abord.

## Subtasks

### T052 — Android

Compare point par point : chaîne de certificats jusqu'à une racine de `ANDROID_ATTESTATION_ROOTS` ; extension
`1.3.6.1.4.1.11129.2.1.17` ; `attestationSecurityLevel` / `keymasterSecurityLevel` exigés ; défi
(`attestationChallenge`) ; `attestationApplicationId` (paquet, empreintes de signature) ; état de démarrage vérifié ;
liste de révocation (URL, format JSON `entries`, cache). Pour chaque point : documentation (citation courte), code
(fichier:ligne), verdict conforme / écart.

### T053 — Apple App Attest

Même méthode : étapes 1 à 9 de la vérification de l'attestation (chaîne `credCert` jusqu'à la racine Apple App
Attestation, nonce = SHA-256(authData ‖ clientDataHash), extension `1.2.840.113635.100.8.2`, `rpIdHash` =
SHA-256(teamId.bundleId), compteur à 0, `aaguid` `appattestdevelop` / `appattest` selon `IOS_APP_ATTEST_ENVIRONMENT`,
identifiant de clé) ; assertion (signature, compteur croissant, `rpIdHash`).

### T054 — Correctifs et compte rendu

`docs/passation-12b-1/attestations-comparaison.md` : les deux tableaux. **Écart qui renforce** → corrige avec un test et
une mutation, puis consigne. **Écart dont la correction affaiblirait, ou qui demande une décision** → ne code rien,
soumets-le au porteur dans ton compte rendu (règle 1). Aucun écart → aucun code modifié, le compte rendu le dit.
Relance `test/unit/attestation` et les tests d'enrôlement (`test/integration/devices`, échantillon) si tu modifies.

## Definition of Done

- Toutes les sous-tâches faites ; fichiers limités aux `owned_files` (+ retouches de compilation nommées) ;
- tests du lot verts sur la base du lot (ou sans base pour les tests unitaires), **aucun appel réseau externe** ;
- chaque contrôle ajouté a sa mutation notée (retiré → test rouge → remis) ;
- `eslint`, `prettier --check`, `tsc --noEmit` propres sur les fichiers du lot ;
- note de lane : retouches hors carte, écarts (renforce/affaiblit), points « à confirmer à l'essai », fichiers à
  faire relire par une personne.

## Ce que le relecteur doit casser

Un « conforme » sans citation ni ligne de code ; un correctif qui affaiblit une vérification ; un écart d'environnement
(`development`/`production`) ignoré ; une modification sans test.

## Retouches hors carte permises

Seulement les retouches de compilation imposées par un changement de signature d'un lot antérieur (`interfaces.md`
§1), nommées dans la note de lane. Tout autre besoin : signale-le, ne le code pas.
