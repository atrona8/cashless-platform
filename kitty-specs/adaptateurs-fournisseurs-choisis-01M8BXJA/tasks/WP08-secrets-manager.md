---
work_package_id: WP08
title: Coffre AWS Secrets Manager (`PspSecretStore`)
dependencies: [WP01, WP02]
requirement_refs:
- FR-009
- NFR-003
planning_base_branch: feat/adaptateurs-fournisseurs-choisis
merge_target_branch: feat/adaptateurs-fournisseurs-choisis
branch_strategy: >-
  Planning artifacts for this mission were generated on feat/adaptateurs-fournisseurs-choisis. During
  /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must
  merge back into feat/adaptateurs-fournisseurs-choisis unless the human explicitly redirects the landing branch.
subtasks: [T034, T035, T036, T037]
phase: Phase 2 - Réception et adaptateurs
agent: claude
history:
- timestamp: '2026-11-26T15:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: apps/api/src/psp/aws/
create_intent:
- apps/api/src/psp/aws/secrets-manager-store.ts
- apps/api/test/unit/psp/aws/secrets-manager-store.spec.ts
- apps/api/test/support/fake-servers/secrets-manager.ts
execution_mode: code_change
model: sonnet
owned_files:
- apps/api/src/psp/aws/**
- apps/api/test/unit/psp/aws/**
- apps/api/test/support/fake-servers/secrets-manager.ts
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP08 — Coffre AWS Secrets Manager (`PspSecretStore`)

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role : implementer / Agent :
claude). Lis ensuite la fiche commune `docs/passation-12b-1/fiche-implementation.md` (démarrage, règles, base de
données, fin d'implémentation : ne pas la recopier ici), ce prompt, puis seulement (`<M>` =
`kitty-specs/adaptateurs-fournisseurs-choisis-01M8BXJA`) :

- `<M>/interfaces.md` §2, §4, §6 ; `<M>/data-model.md` (valeur JSON du secret) ; `<M>/contracts/aws.md` ;
  `<M>/research.md` R-08 ;
- `apps/api/src/psp/psp-secret-store.port.ts`, `secret.ts`, `fake/fake-psp-secret-store.ts` (règles d'isolement par
  détenteur et messages d'erreur à reproduire).

## Objective

`AwsSecretsManagerStore` : lit les identifiants d'une configuration PSP dans Secrets Manager, liés au détenteur
des fonds, avec rotation du secret de notification. Aucun secret ni référence dans un message.

Dépendances : WP01, WP02. Implémentation :
`LC_ALL=C LANG=C spec-kitty agent action implement WP08 --agent claude --mission adaptateurs-fournisseurs-choisis-01M8BXJA`.

## Branch Strategy

Planification et fusion sur `feat/adaptateurs-fournisseurs-choisis`. Le worktree d'exécution est celui de la lane calculée dans
`<M>/lanes.json` ; si ta lane dépend d'autres lanes, `bash docs/passation-12b-1/scripts/merge-deps.sh <lettre>`
d'abord.

## Subtasks

### T034 — Lecture

1. `get(binding)` : la référence doit commencer par `psp/<holderPartyId>/` (comparaison exacte du segment) ; sinon
   `HOLDER_MISMATCH` **avant tout appel**. Forme invalide (caractères hors `[A-Za-z0-9/_+=.@-]`, > 512) → `REF_INVALID`.
2. `GetSecretValueCommand({ SecretId: secretRef })` ; `SecretString` JSON : `{ provider, credentials, notification,
   previous_valid_until }`. Construis `PspCredentials` selon `provider` (`WAVE` : `api_key`, `request_signing_secret` ;
   `PAYDUNYA` : `master_key`, `private_key`, `token` ; `STRIPE` : `secret_key`) ; champ manquant ou fournisseur inconnu →
   `REF_INVALID`. Le fournisseur du secret doit être `binding.provider` (ajouté par WP02) ; sinon `REF_INVALID`.

### T035 — Rotation

`previous_valid_until` futur → `GetSecretValueCommand({ SecretId, VersionStage: 'AWSPREVIOUS' })`, champ `notification`
seul → `previous` ; passé ou absent → `previous = null`. Une erreur sur `AWSPREVIOUS` → `previous = null` et journal
(sans référence), pas d'échec global.

### T036 — Erreurs et cache

`ResourceNotFoundException` → `NOT_FOUND` ; `AccessDeniedException`, réseau, délai → `UNAVAILABLE` ; JSON invalide →
`REF_INVALID`. Messages : ceux de `PspSecretError` seulement. Cache mémoire 60 s par référence (horloge injectée),
jamais journalisé ; une erreur n'est pas mise en cache.

### T037 — Faux serveur et tests

1. `fake-servers/secrets-manager.ts` : protocole JSON d'AWS (`POST /`, en-tête `X-Amz-Target: secretsmanager.GetSecretValue`,
   corps `{SecretId, VersionStage?}`), réponses `{ SecretString, VersionStages }` et erreurs `{ __type:
   'ResourceNotFoundException' }`. Client : `new SecretsManagerClient({ region, endpoint: fake.url, credentials: {
   accessKeyId: 'test', secretAccessKey: 'test' } })`.
2. Tests : un secret par fournisseur ; détenteur différent → `HOLDER_MISMATCH` sans requête reçue ; rotation avant et
   après échéance ; erreurs ; cache (une seule requête en 60 s, une nouvelle après) ; aucun secret dans les messages ni
   journaux (capture). Mutations : appel avant le contrôle du détenteur ; cache d'une erreur ; `previous` gardé après échéance.

## Definition of Done

- Toutes les sous-tâches faites ; fichiers limités aux `owned_files` (+ retouches de compilation nommées) ;
- tests du lot verts sur la base du lot (ou sans base pour les tests unitaires), **aucun appel réseau externe** ;
- chaque contrôle ajouté a sa mutation notée (retiré → test rouge → remis) ;
- `eslint`, `prettier --check`, `tsc --noEmit` propres sur les fichiers du lot ;
- note de lane : retouches hors carte, écarts (renforce/affaiblit), points « à confirmer à l'essai », fichiers à
  faire relire par une personne.

## Ce que le relecteur doit casser

Lecture d'un secret d'un autre détenteur ; valeur dans un message ; rotation sans échéance ; cache qui masque une
révocation au-delà de 60 s ; identifiants AWS en dur hors des tests.

## Retouches hors carte permises

Seulement les retouches de compilation imposées par un changement de signature d'un lot antérieur (`interfaces.md`
§1), nommées dans la note de lane. Tout autre besoin : signale-le, ne le code pas.
