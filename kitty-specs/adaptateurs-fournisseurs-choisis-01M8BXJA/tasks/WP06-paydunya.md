---
work_package_id: WP06
title: Adaptateur PayDunya (facture, confirmation, IPN = signal)
dependencies: [WP01, WP02]
requirement_refs:
- FR-005
- FR-006
- C-003
- SC-002
planning_base_branch: feat/adaptateurs-fournisseurs-choisis
merge_target_branch: feat/adaptateurs-fournisseurs-choisis
branch_strategy: >-
  Planning artifacts for this mission were generated on feat/adaptateurs-fournisseurs-choisis. During
  /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must
  merge back into feat/adaptateurs-fournisseurs-choisis unless the human explicitly redirects the landing branch.
subtasks: [T024, T025, T026, T027, T028]
phase: Phase 2 - Réception et adaptateurs
agent: claude
history:
- timestamp: '2026-11-26T15:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: apps/api/src/psp/paydunya/
create_intent:
- apps/api/src/psp/paydunya/paydunya-adapter.ts
- apps/api/test/unit/psp/paydunya/paydunya-adapter.spec.ts
- apps/api/test/support/fake-servers/paydunya.ts
execution_mode: code_change
model: sonnet
owned_files:
- apps/api/src/psp/paydunya/**
- apps/api/test/unit/psp/paydunya/**
- apps/api/test/support/fake-servers/paydunya.ts
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP06 — Adaptateur PayDunya (facture, confirmation, IPN = signal)

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role : implementer / Agent :
claude). Lis ensuite la fiche commune `docs/passation-12b-1/fiche-implementation.md` (démarrage, règles, base de
données, fin d'implémentation : ne pas la recopier ici), ce prompt, puis seulement (`<M>` =
`kitty-specs/adaptateurs-fournisseurs-choisis-01M8BXJA`) :

- `<M>/interfaces.md` §3, §4, §6 ; `<M>/contracts/psp-port.md`, `<M>/contracts/psp-fournisseurs.md` ;
- `apps/api/src/psp/psp-adapter.port.ts`, `psp.types.ts`, `hmac-signature.ts`, `http/psp-http.ts` (après fusion de
  WP01 et WP02 dans ta lane : `merge-deps.sh`) ; `src/psp/fake/fake-psp-adapter.ts` (comportements attendus du port) ;
- `test/support/fake-servers/http-fake.ts`.
- `<M>/research.md` **R-05** : la documentation PayDunya refuse la lecture automatique ; la source est le code des SDK
  officiels `github.com/paydunyadev/paydunya-node-master` (`lib/index.js`, `lib/checkout-invoice.js`) et
  `paydunyadev/paydunya-woocommerce-gateway` (`WC_Paydunya.php`, `callback_handler`). Tu peux les relire (clone en
  lecture seule dans un dossier temporaire, jamais dans le dépôt).

## Objective

`PayDunyaPspAdapter` conforme à ce que publient les SDK officiels de PayDunya. **Écart de sécurité décidé par le
porteur (D2)** : la notification n'est qu'un signal ; rien n'est crédité sans la confirmation authentifiée. Carte sans
preuve 3-D Secure (D7) : non créditée. Méthode servie : `CARD` (correspondance actuelle de `PROVIDER_METHOD`).

Dépendances : WP01, WP02. Implémentation :
`LC_ALL=C LANG=C spec-kitty agent action implement WP06 --agent claude --mission adaptateurs-fournisseurs-choisis-01M8BXJA`.

## Branch Strategy

Planification et fusion sur `feat/adaptateurs-fournisseurs-choisis`. Le worktree d'exécution est celui de la lane calculée dans
`<M>/lanes.json` ; si ta lane dépend d'autres lanes, `bash docs/passation-12b-1/scripts/merge-deps.sh <lettre>`
d'abord.

## Subtasks

### T024 — `initiate`

1. `POST {pspBases.paydunya}/checkout-invoice/create`, en-têtes `PAYDUNYA-MASTER-KEY`, `PAYDUNYA-PRIVATE-KEY`,
   `PAYDUNYA-TOKEN`, `Content-Type: application/json` ; corps `{ invoice: { total_amount: <nombre entier>,
   description: 'Recharge' }, store: { name: 'Cashless' }, actions: { callback_url: notificationUrl, return_url,
   cancel_url }, custom_data: { psp_topup_id } }`. Devise : XOF seule (sinon refus avant appel).
2. Réponse `response_code === '00'` → `providerPaymentRef = token`, `REDIRECT response_text`, `expiresAt` = +30 min
   (aucune échéance documentée : constante « à confirmer à l'essai »). Autre code → erreur portant `response_code`.
3. Création non idempotente : `idempotent: false` ; aucune reprise documentée → sur délai, erreur (l'interrogation par
   `token` est impossible sans réponse : la recharge expirera ; note-le).

### T025 — `verifyNotification` → `SIGNAL`

1. Exige `contentType: 'form'` (sinon `BODY_MALFORMED`). Extrais **uniquement** `data[hash]` du formulaire (parseur
   minimal sur le corps brut, `URLSearchParams`) ; absent → `SIGNATURE_MISSING` ; pas 128 hexadécimaux →
   `SIGNATURE_MALFORMED`.
2. Compare à temps constant à `sha512_hex(notification.current)` (la clé maître est rangée comme secret de notification,
   `data-model.md`) ; différent → `SIGNATURE_INVALID`. `previous` n'est jamais utilisé.
3. Seulement ensuite : `data[invoice][token]` (référence PSP, obligatoire), `data[custom_data][psp_topup_id]`
   (référence marchande, facultative), `data[status]`. Rend `{ kind: 'SIGNAL', notificationId:
   'paydunya:' + token + ':' + status, reference, secretUsed: 'current' }`. Aucun montant lu ni rendu.

### T026 — `getStatus` (confirmation)

1. `GET {base}/checkout-invoice/confirm/{token}` (mêmes en-têtes), `idempotent: true`.
2. `status` : `completed` → `PAID` ; `pending` → `PENDING` ; `cancelled` → `CANCELLED` ; `failed` → `FAILED`
   (les deux derniers « à confirmer à l'essai », constante commentée) ; autre → `UNKNOWN`.
3. `payment` : `amount = BigInt(invoice.total_amount)` (entier exigé), `currency = 'XOF'` (devise de la configuration : la confirmation n'en rend pas, analyse U1 ; « à confirmer à l'essai »), `merchantReference =
   custom_data.psp_topup_id`, `card = { fingerprint: null, threeDs: 'NOT_PERFORMED' }` (D7 : la confirmation ne porte ni
   preuve 3-D Secure ni empreinte ; le processeur rendra la recharge « reçue, non créditée »). Ne journalise jamais
   `customer`.

### T027 — `cancel` et `readStatement`

`cancel` → `{ cancelled: false }` sans appel (aucune annulation documentée) ; `readStatement` → `{ supported: false }`.
Commentaire : rapprochement PayDunya manuel (consigné par WP13).

### T028 — Faux serveur, tests, test de borne D2

1. `test/support/fake-servers/paydunya.ts` : création (code `00` et code d'erreur), confirmation programmable, avec les
   formes des SDK (`response_code`, `response_text`, `token`, `status`, `invoice.total_amount`, `custom_data`).
2. Tests : en-têtes et corps exacts de la création ; IPN formulaire avec bon hash → `SIGNAL` sans montant ; mauvais
   hash, hash absent, hash en majuscules non hexadécimal, JSON au lieu du formulaire → refus ; aucun champ autre que
   `data[hash]` lu avant la comparaison (espion sur le parseur ou corps piégé dont la lecture lèverait) ; statuts ;
   carte `NOT_PERFORMED` ; aucun secret dans les erreurs.
3. **Test de borne D2 (règle 3)** : un `SIGNAL` PayDunya valide ne porte aucun montant (le type l'interdit, le test
   vérifie l'objet rendu) ; si `getStatus` rend `pending`, rien n'est `PAID`. Nomme-le clairement (« borne OP PayDunya »)
   pour WP13.
4. Mutations : comparer avec `===` (non constant : vérifie l'usage de `timingSafeEqual`) ; rendre `NOTIFICATION` ;
   accepter le JSON ; `threeDs: 'SUCCEEDED'`.

## Definition of Done

- Toutes les sous-tâches faites ; fichiers limités aux `owned_files` (+ retouches de compilation nommées) ;
- tests du lot verts sur la base du lot (ou sans base pour les tests unitaires), **aucun appel réseau externe** ;
- chaque contrôle ajouté a sa mutation notée (retiré → test rouge → remis) ;
- `eslint`, `prettier --check`, `tsc --noEmit` propres sur les fichiers du lot ;
- note de lane : retouches hors carte, écarts (renforce/affaiblit), points « à confirmer à l'essai », fichiers à
  faire relire par une personne.

## Ce que le relecteur doit casser

Un montant tiré de l'IPN ; un champ lu avant la preuve ; comparaison non constante ; `previous` accepté ; un statut
inconnu traité comme payé ; la carte déclarée 3-D Secure sans preuve ; une clé dans un journal.

## Retouches hors carte permises

Seulement les retouches de compilation imposées par un changement de signature d'un lot antérieur (`interfaces.md`
§1), nommées dans la note de lane. Tout autre besoin : signale-le, ne le code pas.
