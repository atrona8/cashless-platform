---
work_package_id: WP03
title: 'Réception des notifications : signal, formulaire, relecture asynchrone'
dependencies: [WP02]
requirement_refs:
- FR-001
- FR-006
- NFR-005
- SC-002
planning_base_branch: feat/adaptateurs-fournisseurs-choisis
merge_target_branch: feat/adaptateurs-fournisseurs-choisis
branch_strategy: >-
  Planning artifacts for this mission were generated on feat/adaptateurs-fournisseurs-choisis. During
  /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must
  merge back into feat/adaptateurs-fournisseurs-choisis unless the human explicitly redirects the landing branch.
base_branch: kitty/mission-adaptateurs-fournisseurs-choisis-01M8BXJA
base_commit: 0a2c8a64fb4e7fcd9a7eb3edcbe2fec93b8b5f72
created_at: '2026-11-26T14:15:21.646862+00:00'
subtasks: [T011, T012, T013, T014, T015]
phase: Phase 2 - Réception et adaptateurs
agent: claude
history:
- timestamp: '2026-11-26T15:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: apps/api/src/webhooks/
create_intent:
- apps/api/src/topups/psp/psp-status-confirmer.ts
- apps/api/test/integration/topups/signal-relecture.spec.ts
execution_mode: code_change
model: sonnet
owned_files:
- apps/api/src/webhooks/**
- apps/api/src/topups/psp/psp-status-confirmer.ts
- apps/api/src/topups/poller/**
- apps/api/src/topups/psp/psp-topups.module.ts
- apps/api/test/integration/webhooks/**
- apps/api/test/integration/topups/poller-status.spec.ts
- apps/api/test/integration/topups/signal-relecture.spec.ts
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP03 — Réception des notifications : signal, formulaire, relecture asynchrone

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role : implementer / Agent :
claude). Lis ensuite la fiche commune `docs/passation-12b-1/fiche-implementation.md` (démarrage, règles, base de
données, fin d'implémentation : ne pas la recopier ici), ce prompt, puis seulement (`<M>` =
`kitty-specs/adaptateurs-fournisseurs-choisis-01M8BXJA`) :

- `<M>/interfaces.md` §4, §5 ; `<M>/contracts/psp-port.md` ; `<M>/research.md` R-02, R-05 (PayDunya), R-07 ;
- `src/webhooks/*.ts` (en-têtes : ordre des contrôles, A4) ; `src/topups/poller/psp-topup-poller.worker.ts` (l. 1-180) ;
  `src/topups/psp/psp-topups.module.ts` ; `PspPaymentProcessor` (où il vit, ce qu'il prend) ;
- tests `test/integration/webhooks/*.spec.ts`, `webhook-fixtures.ts`, `poll-fixtures.ts`, `test/integration/topups/poller-status.spec.ts` ;
- la fabrication du corps brut : `main.ts` / bootstrap Nest (`rawBody: true`) et le contrôleur.

## Objective

Brancher le port révisé (WP02) sur la réception et l'interrogation : formulaire accepté pour PayDunya seul,
signal et notification « à relire » conservés **sans effet**, puis relecture asynchrone par un service commun extrait du
travailleur d'interrogation. **Aucun crédit sur un signal ; aucun appel réseau pendant la réception ; le répartiteur
reste sans appel réseau.**

Dépendances : WP02. Implémentation :
`LC_ALL=C LANG=C spec-kitty agent action implement WP03 --agent claude --mission adaptateurs-fournisseurs-choisis-01M8BXJA`.

## Branch Strategy

Planification et fusion sur `feat/adaptateurs-fournisseurs-choisis`. Le worktree d'exécution est celui de la lane calculée dans
`<M>/lanes.json` ; si ta lane dépend d'autres lanes, `bash docs/passation-12b-1/scripts/merge-deps.sh <lettre>`
d'abord.

## Subtasks

### T011 — Vérifieur (`webhook-verifier.ts`)

1. Passe `contentType` à l'adaptateur. Pour `kind: 'NOTIFICATION'` : défense en profondeur inchangée (tolérance,
   secret précédent échu, identifiant borné). Pour `kind: 'SIGNAL'` : identifiant borné (1 à 200) ; `secretUsed`
   doit valoir `current` ; aucun horodatage exigé ; aucun montant n'existe à contrôler.
2. `WebhookVerification` porte le verdict complet (`kind`, `confirmationRequired`, `reference`).
3. Mutations : signal accepté avec `secretUsed: 'previous'` ; tolérance retirée pour une notification.

### T012 — Réception (`webhook-intake.service.ts`, contrôleur)

1. `contentType` : `application/json` (ou absent, comme aujourd'hui) → `json` ;
   `application/x-www-form-urlencoded` → `form`, **permis pour `paydunya` seulement** ; autre fournisseur ou autre type
   → refus `BODY_MALFORMED` (400) après la taille et la configuration, avant le coffre. Vérifie que le corps brut d'un
   formulaire est bien capté (`req.rawBody`) ; sinon règle-le pour la seule route des notifications et note-le.
2. `NOTIFICATION` sans relecture : chemin actuel, inchangé.
3. `SIGNAL` ou `NOTIFICATION` avec `confirmationRequired` : `record_psp_event` avec kind `UNKNOWN`, normalisé minimal
   (`{ kind: 'UNKNOWN', reference }`, **aucun montant**), identifiant de notification = celui du verdict ; l'événement
   est marqué traité sans effet par le répartiteur (vérifie que `UNKNOWN_KIND` → `PROCESSED`, `NO_EFFECT`) ; doublon →
   `duplicate: true` comme aujourd'hui. Puis `confirmer.scheduleConfirmation(reference, configId)` **après** la réponse.
4. Ordre des contrôles du contrat inchangé. Le `PspSecretBinding` passé au coffre porte `provider` (WP02), ici comme
   dans le confirmateur.

### T013 — `PspStatusConfirmer` (`interfaces.md` §5)

1. Extrais du travailleur (`poll`, `secretsOf`) la lecture du statut hors transaction et l'application par
   `PspPaymentProcessor`, sans changer leur comportement ; le travailleur appelle désormais `confirm()`.
2. `confirm()` rend `APPLIED` (PAID ou CANCELLED appliqué), `PENDING`, `FAILED` (adaptateur ou coffre en erreur ;
   l'erreur est journalisée sans secret, la recharge reste `PENDING`).
3. Enregistre le service dans le module des recharges PSP et dans le module du processus `psp-poller` (sans importer
   les gardes de terminal), et rends-le injectable par la réception (module des notifications).

### T014 — Relecture asynchrone bornée

1. `scheduleConfirmation(merchantReference, configurationId)` : retrouve la recharge (`PENDING`, même configuration) ;
   inconnue ou d'une autre configuration → rien (journal `psp.signal.unmatched` sans référence complète).
2. Exécution par `setImmediate` (jamais dans la requête), au plus **une par recharge et par minute** (carte en mémoire
   bornée, 10 000 entrées, éviction des plus anciennes) ; une erreur est attrapée et journalisée.
3. Le travailleur d'interrogation (2 min) reste inchangé comme filet.

### T015 — Tests (`signal-relecture.spec.ts`, et tests existants adaptés)

Avec `FakeSignalPspAdapter` injecté (module de test), sur `cashless_wp03` :
- signal valide, statut programmé `PENDING` → `200`, aucune écriture, recharge `PENDING` ; puis statut `PAID` +
  nouvelle relecture → crédit **une fois** ; 100 signaux identiques en parallèle → un seul crédit (NFR-005) ;
- signal à preuve fausse → `401`, rien conservé, aucun appel à `getStatus` (espion) ;
- signal valide mais `getStatus` rend un montant différent → aucune écriture, anomalie `PSP_MISMATCH` (chemin existant) ;
- formulaire envoyé à `/webhooks/wave/…` → `400` ; JSON à `/webhooks/paydunya/…` → traité par l'adaptateur (qui le refusera) ;
- la réponse est rendue avant la relecture (espion : `getStatus` appelé après l'envoi) ;
- deux signaux de la même recharge à 1 s d'écart → une seule relecture ;
- tests existants de `webhooks/` et de `poller-status.spec.ts` verts sans retrait de cas.
Mutations : créditer sur le verdict `SIGNAL` ; relire dans la requête ; retirer la borne par minute ; permettre le
formulaire pour `wave`.

## Definition of Done

- Toutes les sous-tâches faites ; fichiers limités aux `owned_files` (+ retouches de compilation nommées) ;
- tests du lot verts sur la base du lot (ou sans base pour les tests unitaires), **aucun appel réseau externe** ;
- chaque contrôle ajouté a sa mutation notée (retiré → test rouge → remis) ;
- `eslint`, `prettier --check`, `tsc --noEmit` propres sur les fichiers du lot ;
- note de lane : retouches hors carte, écarts (renforce/affaiblit), points « à confirmer à l'essai », fichiers à
  faire relire par une personne.

## Ce que le relecteur doit casser

Un crédit sans `getStatus` après un signal ; un appel réseau avant la réponse ; un montant tiré d'un signal ; le
formulaire accepté pour un autre PSP ; la borne contournable par références différentes de la même recharge ; le filet de
2 min cassé ; un secret journalisé par le confirmateur.

## Retouches hors carte permises

Seulement les retouches de compilation imposées par un changement de signature d'un lot antérieur (`interfaces.md`
§1), nommées dans la note de lane. Tout autre besoin : signale-le, ne le code pas.
