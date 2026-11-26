---
work_package_id: WP02
title: 'Port PSP révisé : verdicts, identifiants par fournisseur, signature paramétrée'
dependencies: []
requirement_refs:
- FR-001
- NFR-002
planning_base_branch: feat/adaptateurs-fournisseurs-choisis
merge_target_branch: feat/adaptateurs-fournisseurs-choisis
branch_strategy: >-
  Planning artifacts for this mission were generated on feat/adaptateurs-fournisseurs-choisis. During
  /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must
  merge back into feat/adaptateurs-fournisseurs-choisis unless the human explicitly redirects the landing branch.
subtasks: [T006, T007, T008, T009, T010]
phase: Phase 1 - Fondations
agent: claude
history:
- timestamp: '2026-11-26T15:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: apps/api/src/psp/
create_intent:
- apps/api/src/psp/fake/fake-signal-psp-adapter.ts
execution_mode: code_change
model: sonnet
owned_files:
- apps/api/src/psp/psp-adapter.port.ts
- apps/api/src/psp/psp-secret-store.port.ts
- apps/api/src/psp/psp.types.ts
- apps/api/src/psp/hmac-signature.ts
- apps/api/src/psp/fake/**
- apps/api/src/psp/unavailable/**
- apps/api/test/unit/psp/fake-psp-adapter.spec.ts
- apps/api/test/unit/psp/fake-secret-store.spec.ts
- apps/api/test/unit/psp/hmac-signature.spec.ts
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP02 — Port PSP révisé : verdicts, identifiants par fournisseur, signature paramétrée

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role : implementer / Agent :
claude). Lis ensuite la fiche commune `docs/passation-12b-1/fiche-implementation.md` (démarrage, règles, base de
données, fin d'implémentation : ne pas la recopier ici), ce prompt, puis seulement (`<M>` =
`kitty-specs/adaptateurs-fournisseurs-choisis-01M8BXJA`) :

- `<M>/interfaces.md` §4 (fait foi) ; `<M>/contracts/psp-port.md` ; `<M>/research.md` R-02, R-03 ;
- `apps/api/src/psp/*.ts`, `src/psp/fake/*.ts`, `src/psp/unavailable/*.ts` et leurs tests `test/unit/psp/*.spec.ts` ;
- les appelants (pour la compilation) : `src/webhooks/webhook-verifier.ts`, `webhook-intake.service.ts`,
  `src/topups/poller/psp-topup-poller.worker.ts`, `src/psp/psp.providers.ts`.

## Objective

Faire évoluer le port commun pour qu'il suive chaque fournisseur (D2, FR-001) sans affaiblir le faux ni les
garanties actuelles : verdict `NOTIFICATION` ou `SIGNAL`, identifiants typés par fournisseur, signature HMAC
paramétrée. Les appelants (WP03) s'adaptent dans leur lot : ici, seules les retouches de **compilation** strictement
nécessaires sont permises hors carte, nommées dans la note.

Dépendances : aucune. Implémentation :
`LC_ALL=C LANG=C spec-kitty agent action implement WP02 --agent claude --mission adaptateurs-fournisseurs-choisis-01M8BXJA`.

## Branch Strategy

Planification et fusion sur `feat/adaptateurs-fournisseurs-choisis`. Le worktree d'exécution est celui de la lane calculée dans
`<M>/lanes.json` ; si ta lane dépend d'autres lanes, `bash docs/passation-12b-1/scripts/merge-deps.sh <lettre>`
d'abord.

## Subtasks

### T006 — Types (`psp.types.ts`, `psp-adapter.port.ts`)

1. `PspVerification` à trois branches, `VerifyNotificationInput.contentType`, `PspStatement` et la nouvelle
   `PspStatementLine` exactement comme `interfaces.md` §4. `readStatement` rend `Promise<PspStatement>`.
2. Mets à jour l'en-tête de `psp-adapter.port.ts` : règles 1 à 7 de `contracts/psp-port.md` (ordre : preuve d'origine
   avant lecture ; `SIGNAL` sans montant ; `confirmationRequired` ; `getStatus` seule source d'un crédit après relecture).
3. `PspRejectionReason` inchangé.

### T007 — Identifiants (`psp-secret-store.port.ts`)

1. `PspSecretBinding` reçoit `provider: PspProviderName` (`interfaces.md` §4) ; les appelants (réception,
   interrogation) le passent : retouche de compilation permise dans leur lot (WP03).
   `PspCredentials` (union discriminée par `provider`, avec `FAKE`) remplace `adapter: Secret | null` ; `PspSecrets`
   devient `{ credentials, notification }`. `Secret` inchangé.
2. Faux coffre : chaque entrée de démonstration rend `{ provider: 'FAKE', key }` ; la forme stockée par `put()` des tests
   suit (`{ key?, current, previous?, previousValidUntil? }`). L'isolement par détenteur (`psp/<titulaire>/…`) et les
   erreurs restent identiques.
3. Coffre indisponible (`unavailable/`) : inchangé hormis le type.

### T008 — Signature paramétrée (`hmac-signature.ts`)

1. `HmacScheme`, `FAKE_SCHEME`, `WAVE_SCHEME`, `STRIPE_SCHEME` exactement comme §4.
2. `parseSignatureHeader(value, scheme)` : `allowUnknownEntries=false` → toute clé autre que `t`/`v1` refusée (comme
   aujourd'hui) ; `true` → clés inconnues **ignorées** (dont `v0`), `t` toujours unique et obligatoire, au moins un `v1`.
   Une valeur `v1` non hexadécimale reste un refus `SIGNATURE_MALFORMED` dans les deux cas.
3. `computeSignature(secret, t, body, scheme)` : HMAC-SHA256 de `${t}${scheme.separator}` puis le corps brut.
4. `verifyHmacSignature({..., scheme})` : les deux secrets toujours évalués contre toutes les signatures, sans sortie
   anticipée (garde le secret factice aléatoire) ; tolérance `scheme.toleranceSeconds`.

### T009 — Faux

1. `FakePspAdapter` : `FAKE_SCHEME`, rend `{ ok: true, kind: 'NOTIFICATION', ..., confirmationRequired: false }` ;
   `readStatement` → `{ supported: true, lines: [] }` ou ses lignes actuelles converties. Le signataire de
   développement (`fake-notification-signer.ts`) garde son format.
2. `FakeSignalPspAdapter` (`src/psp/fake/fake-signal-psp-adapter.ts`, `isFake = true`) : en-tête
   `X-Fake-Signal: <hex sha512(clé de notification courante)>`, corps JSON `{ id, merchantReference, paymentId }` ;
   rend un `SIGNAL` ; `getStatus` lit un état programmable (méthode `setStatus(merchantReference, PspStatusResult)`),
   pour les tests de WP03. Il n'est construit que par les tests (aucune fabrique ne le crée).

### T010 — Tests et mutations

- `hmac-signature.spec.ts` : vecteurs des trois schémas (calculés dans le test à partir d'un secret, d'un horodatage et
  d'un corps fixes : la signature Wave d'un corps diffère de la signature faux/Stripe du même corps) ; Stripe : en-tête
  `t=…,v1=…,v0=…,secret=x` accepté ; Wave/faux : même en-tête refusé ; rotation : deux `v1`, l'un du secret précédent
  valide avant échéance, refusé après ; hors délai ; `v1` absent.
- Tests existants des faux et du coffre adaptés à la nouvelle forme, sans en retirer un cas.
- Mutations : séparateur Wave mis à `.` ; entrées inconnues acceptées pour Wave ; sortie anticipée sur le premier secret
  (test de temps non exigé : vérifie par espion que les deux calculs ont lieu) ; secret précédent échu accepté.

## Definition of Done

- Toutes les sous-tâches faites ; fichiers limités aux `owned_files` (+ retouches de compilation nommées) ;
- tests du lot verts sur la base du lot (ou sans base pour les tests unitaires), **aucun appel réseau externe** ;
- chaque contrôle ajouté a sa mutation notée (retiré → test rouge → remis) ;
- `eslint`, `prettier --check`, `tsc --noEmit` propres sur les fichiers du lot ;
- note de lane : retouches hors carte, écarts (renforce/affaiblit), points « à confirmer à l'essai », fichiers à
  faire relire par une personne.

## Ce que le relecteur doit casser

Un schéma qui accepte la signature d'un autre (point/sans point) ; une entrée inconnue acceptée là où elle ne doit pas ;
`t` dupliqué accepté ; le faux qui change de format (casse la simulation de développement) ; un cas de test retiré.

## Retouches hors carte permises

Seulement les retouches de compilation imposées par un changement de signature d'un lot antérieur (`interfaces.md`
§1), nommées dans la note de lane. Tout autre besoin : signale-le, ne le code pas.
