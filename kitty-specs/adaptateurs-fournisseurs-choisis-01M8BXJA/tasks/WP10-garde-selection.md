---
work_package_id: WP10
title: Garde de production, sélection faux/réel, liste des services essayés
dependencies: [WP03, WP05, WP06, WP07, WP08, WP09]
requirement_refs:
- FR-013
- FR-016
- C-002
- SC-003
- SC-004
planning_base_branch: feat/adaptateurs-fournisseurs-choisis
merge_target_branch: feat/adaptateurs-fournisseurs-choisis
branch_strategy: >-
  Planning artifacts for this mission were generated on feat/adaptateurs-fournisseurs-choisis. During
  /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must
  merge back into feat/adaptateurs-fournisseurs-choisis unless the human explicitly redirects the landing branch.
subtasks: [T043, T044, T045, T046, T047]
phase: Phase 3 - Garde, essais, consignation
agent: claude
history:
- timestamp: '2026-11-26T15:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: apps/api/src/external-services/
create_intent:
- apps/api/src/external-services/services.ts
- apps/api/src/external-services/production-enabled.ts
- apps/api/test/unit/external-services/production-enabled.spec.ts
- docs/essais/README.md
- apps/api/test/integration/topups/real-adapters-credit.spec.ts
execution_mode: code_change
model: sonnet
owned_files:
- apps/api/src/external-services/services.ts
- apps/api/src/external-services/production-enabled.ts
- apps/api/src/psp/psp.providers.ts
- apps/api/src/psp/psp.module.ts
- apps/api/src/kms/kms.module.ts
- apps/api/src/kms/production-guard.ts
- apps/api/src/sealing/sealing.module.ts
- apps/api/src/processes/bootstrap.ts
- apps/api/test/unit/production-guard.spec.ts
- apps/api/test/unit/external-services/production-enabled.spec.ts
- apps/api/test/unit/psp/psp-providers.spec.ts
- apps/api/test/unit/kms/kms-module.spec.ts
- apps/api/test/unit/architecture.spec.ts
- apps/api/test/integration/topups/real-adapters-credit.spec.ts
- apps/gateway/test/e2e/production-refusals.spec.ts
- docs/essais/README.md
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP10 — Garde de production, sélection faux/réel, liste des services essayés

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role : implementer / Agent :
claude). Lis ensuite la fiche commune `docs/passation-12b-1/fiche-implementation.md` (démarrage, règles, base de
données, fin d'implémentation : ne pas la recopier ici), ce prompt, puis seulement (`<M>` =
`kitty-specs/adaptateurs-fournisseurs-choisis-01M8BXJA`) :

- `<M>/interfaces.md` §2, §6, §7 ; `<M>/contracts/production-guard.md` (fait foi) ; `<M>/data-model.md` § Services externes ;
- `src/kms/production-guard.ts`, `src/kms/kms.module.ts`, `src/psp/psp.providers.ts`, `src/psp/psp.module.ts`,
  `src/sealing/sealing.module.ts`, `src/processes/bootstrap.ts` (l. 30-80 : appel de la garde, libellés) ;
- `test/unit/production-guard.spec.ts`, `test/unit/psp/psp-providers.spec.ts`, `test/unit/kms/kms-module.spec.ts`,
  `test/unit/architecture.spec.ts` (l. 150-180, 430-450), `apps/gateway/test/e2e/production-refusals.spec.ts` (`COVERAGE`) ;
- les classes réelles livrées par WP05 à WP09 (constructeurs, `isFake`, `service`).

## Objective

Brancher les adaptateurs réels dans les fabriques **sans rien ouvrir en production** : `fake` par défaut hors
production, `real` sur demande ; en production, `fake` refusé et `real` refusé tant que le service n'est pas dans
`PRODUCTION_ENABLED_SERVICES` (vide, D6). Garde de borne (règle 3) : un service listé sans compte rendu d'essai réussi
fait échouer un test.

Dépendances : WP03, WP05, WP06, WP07, WP08, WP09. Implémentation :
`LC_ALL=C LANG=C spec-kitty agent action implement WP10 --agent claude --mission adaptateurs-fournisseurs-choisis-01M8BXJA`.

## Branch Strategy

Planification et fusion sur `feat/adaptateurs-fournisseurs-choisis`. Le worktree d'exécution est celui de la lane calculée dans
`<M>/lanes.json` ; si ta lane dépend d'autres lanes, `bash docs/passation-12b-1/scripts/merge-deps.sh <lettre>`
d'abord.

## Subtasks

### T043 — Services et liste (`interfaces.md` §7)

1. `services.ts` : `EXTERNAL_SERVICES`, `ExternalService`, `OUT_OF_SCOPE` exactement. `production-enabled.ts` : liste
   vide + `isEnabledInProduction`, en-tête qui explique la procédure (essai, compte rendu dans
   `docs/essais/<service>.json`, PR relue par une personne, D6).
2. `production-enabled.spec.ts` : (a) chaque entrée est dans `EXTERNAL_SERVICES` ; (b) aucune n'est dans
   `OUT_OF_SCOPE` ; (c) pour chaque entrée, `docs/essais/<service>.json` existe, a la forme du §7, `ok: true`, toutes
   les étapes `ok`, et **ne contient aucune chaîne ressemblant à un secret** (`sk_`, `whsec_`, `wave_sn_`, clé
   PayDunya de 30+ caractères, `AKIA`) ; (d) la liste est aujourd'hui vide (`toEqual([])`, à mettre à jour avec le
   service dans la même PR). Mutations : ajouter `kms` sans fichier → échec ; fichier avec `ok: false` → échec.

### T044 — Sélection dans les fabriques

0. **Règle de production (analyse I1, fait foi)** : en production, réglage **absent** = `real` ; `fake` posé explicitement → refus de démarrer ; `real` hors liste → PSP et coffre **indisponibles** (comportement actuel : 503/404, démarrage permis), KMS et copie des scellements **refusent de démarrer** (comportement actuel). Hors production : défaut `fake`.
1. `psp.providers.ts` : `createPspAdapters(config, deps)` : `externalModes.psp = 'fake'` → faux (hors production
   seulement, comme aujourd'hui) ; `'real'` → `WavePspAdapter`, `PayDunyaPspAdapter`, `StripePspAdapter` avec un
   `PspHttpClient` ; en production, seuls les fournisseurs dont le service est dans la liste entrent au registre
   (registre vide sinon : 503/404, comportement actuel). Orange Money : jamais de réel (absent). `createPspSecretStore` :
   `'real'` → `AwsSecretsManagerStore` (client avec `aws.region`, `aws.endpoint` hors production) ; en production sans
   `psp.secrets` dans la liste → coffre indisponible (comme aujourd'hui).
2. `kms.module.ts` : `KMS_BACKEND=real` → `AwsKms(...).forCapabilities(<ports du processus>)` ; la répartition des
   ports par processus ne change pas. `sealing.module.ts` : `SEAL_COPY=real` → `S3SealCopy`.
3. `psp.module.ts` : fournit `PspHttpClient`.
4. **Indisponibilité au démarrage (analyse C2)** : aucun appel au coffre ni à KMS au démarrage ; une panne se voit à
   l'usage, comme avec le faux (coffre : refus neutre ; KMS : erreur de l'opération). Test : démarrage du module avec un
   faux serveur arrêté → démarre ; premier usage → erreur attendue, sans secret.
5. **Crédit unique par PSP réel (analyse C1, NFR-005)** : `test/integration/topups/real-adapters-credit.spec.ts`, sur
   `cashless_wp10`, adaptateurs réels contre les faux serveurs de WP05 à WP07 : 100 notifications Wave identiques en
   parallèle → un crédit ; 100 notifications Stripe identiques → une seule relecture appliquée, un crédit ; 100 signaux
   PayDunya → un crédit au plus (ici aucun : carte sans 3-D Secure, D7 ; vérifier « reçue, non créditée » une fois).

### T045 — Garde

1. `UntriedInProductionError` ; fabriques KMS et copie : en production, `fake` → `FakeInProductionError` (actuel),
   `real` hors liste → `UntriedInProductionError('kms')` etc. Message : « Démarrage refusé : <service> n'a pas été
   essayé contre le vrai service (liste PRODUCTION_ENABLED_SERVICES) ».
2. `assertNoFakeInProduction` / `bootstrap.ts` : un adaptateur réel non listé est refusé comme un faux ; libellés
   ajoutés dans `bootstrap.ts` pour chaque service (même style que les libellés OTP).
3. `production-guard.spec.ts` et `psp-providers.spec.ts` / `kms-module.spec.ts` : chaque combinaison (production ×
   `fake`/`real` × listé/non listé) pour PSP, coffre, KMS, copie. Pour « listé », le test pousse temporairement un
   service par injection (paramètre de la fonction), jamais en modifiant la liste.

### T046 — Architecture

`architecture.spec.ts` : (a) `@aws-sdk/client-kms` importé seulement sous `src/kms/aws/` ; (b) aucun module chargé par
le processus public (`main.ts`) n'importe `src/kms/aws/` (même règle que `kms/fake-kms.ts`, l. 164) ; (c) `src/psp/fake/`
reste importé seulement par `psp.providers.ts` (règle existante, OP-N81) ; (d) `src/psp/{wave,paydunya,stripe}/`
n'importent pas `axios` directement (seulement `psp/http/`). Mutations : import interdit ajouté → échec.

### T047 — `COVERAGE` et dossier des essais

1. `apps/gateway/test/e2e/production-refusals.spec.ts` : ajoute à `COVERAGE` les libellés nouveaux de `bootstrap.ts` ;
   relance la suite (depuis `apps/gateway`, `npx jest -c test/e2e/jest.e2e.config.cjs production-refusals`).
2. `docs/essais/README.md` : rôle du dossier, forme d'un compte rendu, rappel « jamais de secret », procédure D6.

## Definition of Done

- Toutes les sous-tâches faites ; fichiers limités aux `owned_files` (+ retouches de compilation nommées) ;
- tests du lot verts sur la base du lot (ou sans base pour les tests unitaires), **aucun appel réseau externe** ;
- chaque contrôle ajouté a sa mutation notée (retiré → test rouge → remis) ;
- `eslint`, `prettier --check`, `tsc --noEmit` propres sur les fichiers du lot ;
- note de lane : retouches hors carte, écarts (renforce/affaiblit), points « à confirmer à l'essai », fichiers à
  faire relire par une personne.

## Ce que le relecteur doit casser

Un réel actif en production sans être listé ; un faux construit en production ; la liste modifiée par réglage ; un
service hors périmètre listable ; le test de borne contournable (fichier vide, `ok` absent) ; le processus public qui
charge le client KMS.

## Retouches hors carte permises

Seulement les retouches de compilation imposées par un changement de signature d'un lot antérieur (`interfaces.md`
§1), nommées dans la note de lane. Tout autre besoin : signale-le, ne le code pas.
