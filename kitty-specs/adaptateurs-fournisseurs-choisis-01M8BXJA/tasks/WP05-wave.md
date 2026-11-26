---
work_package_id: WP05
title: Adaptateur Wave (Checkout API, `Wave-Signature`, relevé)
dependencies: [WP01, WP02]
requirement_refs:
- FR-002
- FR-003
- FR-004
- NFR-002
planning_base_branch: feat/adaptateurs-fournisseurs-choisis
merge_target_branch: feat/adaptateurs-fournisseurs-choisis
branch_strategy: >-
  Planning artifacts for this mission were generated on feat/adaptateurs-fournisseurs-choisis. During
  /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must
  merge back into feat/adaptateurs-fournisseurs-choisis unless the human explicitly redirects the landing branch.
subtasks: [T019, T020, T021, T022, T023]
phase: Phase 2 - Réception et adaptateurs
agent: claude
history:
- timestamp: '2026-11-26T15:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: apps/api/src/psp/wave/
create_intent:
- apps/api/src/psp/wave/wave-adapter.ts
- apps/api/test/unit/psp/wave/wave-adapter.spec.ts
- apps/api/test/support/fake-servers/wave.ts
execution_mode: code_change
model: sonnet
owned_files:
- apps/api/src/psp/wave/**
- apps/api/test/unit/psp/wave/**
- apps/api/test/support/fake-servers/wave.ts
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP05 — Adaptateur Wave (Checkout API, `Wave-Signature`, relevé)

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role : implementer / Agent :
claude). Lis ensuite la fiche commune `docs/passation-12b-1/fiche-implementation.md` (démarrage, règles, base de
données, fin d'implémentation : ne pas la recopier ici), ce prompt, puis seulement (`<M>` =
`kitty-specs/adaptateurs-fournisseurs-choisis-01M8BXJA`) :

- `<M>/interfaces.md` §3, §4, §6 ; `<M>/contracts/psp-port.md`, `<M>/contracts/psp-fournisseurs.md` ;
- `apps/api/src/psp/psp-adapter.port.ts`, `psp.types.ts`, `hmac-signature.ts`, `http/psp-http.ts` (après fusion de
  WP01 et WP02 dans ta lane : `merge-deps.sh`) ; `src/psp/fake/fake-psp-adapter.ts` (comportements attendus du port) ;
- `test/support/fake-servers/http-fake.ts`.
- `<M>/research.md` **R-03 et R-04** (source : docs.wave.com/checkout, /webhook, /balance-api).

## Objective

`WavePspAdapter` conforme à la documentation Wave : seuls la clé d'API, le secret de webhook (et facultativement
le secret de signature des requêtes) restent à poser. Méthode servie : `WAVE`.

Dépendances : WP01, WP02. Implémentation :
`LC_ALL=C LANG=C spec-kitty agent action implement WP05 --agent claude --mission adaptateurs-fournisseurs-choisis-01M8BXJA`.

## Branch Strategy

Planification et fusion sur `feat/adaptateurs-fournisseurs-choisis`. Le worktree d'exécution est celui de la lane calculée dans
`<M>/lanes.json` ; si ta lane dépend d'autres lanes, `bash docs/passation-12b-1/scripts/merge-deps.sh <lettre>`
d'abord.

## Subtasks

### T019 — `initiate` et reprise

1. `POST {pspBases.wave}/v1/checkout/sessions`, `Authorization: Bearer <apiKey>`, JSON
   `{ amount: String(amount), currency, client_reference: pspTopupId, success_url, error_url,
   restrict_payer_mobile? }`. `currency` doit être `XOF` (sinon refus avant appel) ; `amount` entier positif, sans
   décimale ; `restrict_payer_mobile` seulement si `payerMsisdn` est au format E.164 avec `+`.
2. Adresses : `returnUrl` de la demande, sinon `waveDefaultUrls` ; absentes ou non https → refus avant appel (erreur
   claire, sans valeur). `error_url` = même règle.
3. Signature des requêtes si `requestSigningSecret` : en-tête `Wave-Signature: t=<s>,v1=<hex HMAC-SHA256(t + corps)>`
   (corps vide pour un GET).
4. Résultat : `providerPaymentRef = id` (`cos-…`), action `REDIRECT wave_launch_url`, `expiresAt = when_expires`.
5. Création **non idempotente** (aucune clé documentée) : `idempotent: false`. Sur `PspHttpError` (délai, réseau) :
   `GET /v1/checkout/sessions/search?client_reference=<pspTopupId>` ; une session `open` trouvée → la rendre ; aucune →
   erreur (la recharge sera reprise par l'interrogation, jamais de seconde création automatique).
6. Réponse 4xx : erreur portant le `code` Wave (`{code, message}`), jamais le corps entier.

### T020 — `verifyNotification`

1. En-tête `Wave-Signature` (insensible à la casse), `WAVE_SCHEME` (HMAC de `t + corps` sans séparateur, plusieurs `v1`
   acceptés, entrées inconnues refusées, ±300 s). `contentType: 'form'` → `BODY_MALFORMED`.
2. Après la signature seulement : JSON `{ id, type, data }`. `checkout.session.completed` avec
   `data.payment_status = 'succeeded'` → `PAYMENT_SUCCEEDED` ; `checkout.session.payment_failed` → `PAYMENT_FAILED` ;
   autres types → `UNKNOWN`. `merchantReference = data.client_reference`, `providerPaymentRef = data.id`,
   `amount = BigInt(data.amount)` (chaîne entière ; une valeur décimale → `BODY_MALFORMED`), `currency = data.currency`,
   `card: null`. `confirmationRequired: false`. `notificationId = id`.

### T021 — `getStatus` et `cancel`

1. `getStatus` : `GET /v1/checkout/sessions/:id` si `providerPaymentRef`, sinon recherche par `client_reference`
   (plusieurs résultats : la plus récente ; journal du nombre). Correspondance : `complete`+`succeeded` → `PAID` ;
   `expired` → `EXPIRED` ; `payment_status = cancelled` → `FAILED` ; `open`/`processing` → `PENDING` ; autre → `UNKNOWN`.
   `payment` rempli comme T020.
2. `cancel` : `POST /v1/checkout/sessions/:id/expire` ; 200 → `{ cancelled: true }` ; 409 → `{ cancelled: false }` ;
   404 → `{ cancelled: false }` (journal) ; autre → erreur.

### T022 — `readStatement`

Pour chaque jour UTC de la période : `GET /v1/transactions?date=AAAA-MM-JJ` puis `&after=<end_cursor>` tant que
`page_info.has_next_page` ; borne : 100 pages par jour (au-delà, erreur). Lignes : `reference = client_reference ?? ''`,
`providerPaymentRef = checkout_api_session_id ?? transaction_id`, `amount`, `fee` (bigint, signe conservé),
`currency`, `date = timestamp`, `reversal = is_reversal === true`. `{ supported: true, lines }`.

### T023 — Faux serveur et tests

1. `test/support/fake-servers/wave.ts` sur `startFakeServer` : sessions, recherche, expiration, transactions paginées,
   réponses et erreurs avec les **formes publiées** par Wave (`research.md` R-04, exemples des pages lues).
2. `wave-adapter.spec.ts` : requête de création exacte (méthode, chemin, en-têtes, corps JSON champ par champ) ;
   signature des requêtes vérifiée côté faux serveur ; délai à la création → recherche, **une seule** création reçue ;
   notification : vecteur calculé selon la documentation (secret, `t`, corps d'exemple de la page webhook) accepté ;
   même corps signé avec un point (schéma Stripe) → refusé ; deux `v1` (rotation) ; hors délai ; corps modifié d'un octet ;
   statuts (tous les cas de T021) ; relevé sur deux pages et deux jours ; erreur 401 `invalid-auth` sans fuite.
3. Mutations : séparateur `.` ; création rejouée sur délai ; montant décimal accepté ; `succeeded` non exigé.

## Definition of Done

- Toutes les sous-tâches faites ; fichiers limités aux `owned_files` (+ retouches de compilation nommées) ;
- tests du lot verts sur la base du lot (ou sans base pour les tests unitaires), **aucun appel réseau externe** ;
- chaque contrôle ajouté a sa mutation notée (retiré → test rouge → remis) ;
- `eslint`, `prettier --check`, `tsc --noEmit` propres sur les fichiers du lot ;
- note de lane : retouches hors carte, écarts (renforce/affaiblit), points « à confirmer à l'essai », fichiers à
  faire relire par une personne.

## Ce que le relecteur doit casser

Une signature au mauvais schéma acceptée ; une seconde session créée après un délai ; un montant décimal ou une devise
autre que XOF acceptés ; `payment_status` ignoré ; une clé dans un message d'erreur ; un appel hors du faux serveur.

## Retouches hors carte permises

Seulement les retouches de compilation imposées par un changement de signature d'un lot antérieur (`interfaces.md`
§1), nommées dans la note de lane. Tout autre besoin : signale-le, ne le code pas.
