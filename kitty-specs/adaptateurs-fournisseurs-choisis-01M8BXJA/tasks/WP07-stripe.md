---
work_package_id: WP07
title: Adaptateur Stripe (Checkout Session, 3-D Secure, `Stripe-Signature`, relevé)
dependencies: [WP01, WP02]
requirement_refs:
- FR-007
- FR-008
- NFR-002
planning_base_branch: feat/adaptateurs-fournisseurs-choisis
merge_target_branch: feat/adaptateurs-fournisseurs-choisis
branch_strategy: >-
  Planning artifacts for this mission were generated on feat/adaptateurs-fournisseurs-choisis. During
  /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must
  merge back into feat/adaptateurs-fournisseurs-choisis unless the human explicitly redirects the landing branch.
subtasks: [T029, T030, T031, T032, T033]
phase: Phase 2 - Réception et adaptateurs
agent: claude
history:
- timestamp: '2026-11-26T15:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: apps/api/src/psp/stripe/
create_intent:
- apps/api/src/psp/stripe/stripe-adapter.ts
- apps/api/test/unit/psp/stripe/stripe-adapter.spec.ts
- apps/api/test/support/fake-servers/stripe.ts
execution_mode: code_change
model: sonnet
owned_files:
- apps/api/src/psp/stripe/**
- apps/api/test/unit/psp/stripe/**
- apps/api/test/support/fake-servers/stripe.ts
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP07 — Adaptateur Stripe (Checkout Session, 3-D Secure, `Stripe-Signature`, relevé)

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role : implementer / Agent :
claude). Lis ensuite la fiche commune `docs/passation-12b-1/fiche-implementation.md` (démarrage, règles, base de
données, fin d'implémentation : ne pas la recopier ici), ce prompt, puis seulement (`<M>` =
`kitty-specs/adaptateurs-fournisseurs-choisis-01M8BXJA`) :

- `<M>/interfaces.md` §3, §4, §6 ; `<M>/contracts/psp-port.md`, `<M>/contracts/psp-fournisseurs.md` ;
- `apps/api/src/psp/psp-adapter.port.ts`, `psp.types.ts`, `hmac-signature.ts`, `http/psp-http.ts` (après fusion de
  WP01 et WP02 dans ta lane : `merge-deps.sh`) ; `src/psp/fake/fake-psp-adapter.ts` (comportements attendus du port) ;
- `test/support/fake-servers/http-fake.ts`.
- `<M>/research.md` **R-03 et R-06** (docs.stripe.com : webhooks, checkout sessions, charges, balance transactions, idempotent requests).
- `src/topups/psp/card-checks.ts` (ce que le processeur exige de la carte).

## Objective

`StripePspAdapter` conforme à la documentation Stripe : seuls la clé secrète et le secret de webhook restent à
poser. Méthode servie : `CARD`. L'éligibilité d'un marchand établi au Sénégal reste à vérifier par le porteur (D4).

Dépendances : WP01, WP02. Implémentation :
`LC_ALL=C LANG=C spec-kitty agent action implement WP07 --agent claude --mission adaptateurs-fournisseurs-choisis-01M8BXJA`.

## Branch Strategy

Planification et fusion sur `feat/adaptateurs-fournisseurs-choisis`. Le worktree d'exécution est celui de la lane calculée dans
`<M>/lanes.json` ; si ta lane dépend d'autres lanes, `bash docs/passation-12b-1/scripts/merge-deps.sh <lettre>`
d'abord.

## Subtasks

### T029 — `initiate`

1. `POST {pspBases.stripe}/v1/checkout/sessions`, `Authorization: Bearer <secretKey>`,
   `Content-Type: application/x-www-form-urlencoded`, `Idempotency-Key: <pspTopupId>`, `idempotent: true`.
2. Champs (encodage formulaire à crochets) : `mode=payment`, `line_items[0][price_data][currency]=xof`,
   `line_items[0][price_data][unit_amount]=<montant entier>`, `line_items[0][price_data][product_data][name]=Recharge`,
   `line_items[0][quantity]=1`, `payment_method_types[0]=card`,
   `payment_method_options[card][request_three_d_secure]=any`, `client_reference_id`, `metadata[psp_topup_id]`,
   `success_url`, `cancel_url` (= `returnUrl` ; absent → refus avant appel), `expires_at` = maintenant + 30 min
   (minimum documenté). XOF seule ; « sans décimale » : constante commentée « à confirmer à l'essai ».
3. Résultat : `providerPaymentRef = id` (`cs_…`), `REDIRECT url`, `expiresAt = expires_at`. Erreur : `error.type` et
   `error.code` seulement.

### T030 — `verifyNotification`

1. `Stripe-Signature`, `STRIPE_SCHEME` (`t.corps`, plusieurs `v1`, `v0` et entrées inconnues ignorées, ±300 s).
   `contentType: 'form'` → `BODY_MALFORMED`.
2. Après signature : `{ id, type, data: { object } }`. `checkout.session.completed` avec `payment_status=paid` et
   `checkout.session.async_payment_succeeded` → `PAYMENT_SUCCEEDED`, **`confirmationRequired: true`** (la carte n'est pas
   dans la notification) ; `…async_payment_failed` → `PAYMENT_FAILED` ; `checkout.session.expired` →
   `PAYMENT_CANCELLED` ; `charge.dispute.created` → `DISPUTE` (`providerDisputeId = object.id`, `amount`,
   `confirmationRequired: false`) ; autres → `UNKNOWN`. `merchantReference = client_reference_id`,
   `providerPaymentRef = object.id` (session) ; `notificationId = id` (`evt_…`).

### T031 — `getStatus`

1. `GET /v1/checkout/sessions/:id` ; si `payment_intent` : `GET /v1/payment_intents/:pi?expand[]=latest_charge`.
2. `status=complete` + `payment_status=paid` → `PAID` ; `status=expired` → `EXPIRED` ; `open` → `PENDING` ;
   PaymentIntent `canceled` → `CANCELLED` ; autre → `UNKNOWN`.
3. Carte : `latest_charge.payment_method_details.card.three_d_secure.result` : `authenticated`,
   `attempt_acknowledged` → `SUCCEEDED` ; `failed`, `processing_error` → `FAILED` ; absent, `not_supported`,
   `exempted`, `data_share_only` → `NOT_PERFORMED` ; `fingerprint = card.fingerprint ?? null`. Montant =
   `amount_total` de la session, devise en majuscules.

### T032 — `cancel` et `readStatement`

1. `cancel` : `POST /v1/checkout/sessions/:id/expire` (avec `Idempotency-Key: cancel-<id>`) ; 200 → `true` ; erreur
   « session non ouverte » (400) → `false`.
2. `readStatement` : `GET /v1/balance_transactions?created[gte]=<s>&created[lte]=<s>&limit=100` puis
   `starting_after=<dernier id>` tant que `has_more` ; borne 100 pages. Lignes : `reference = source ?? id`,
   `providerPaymentRef = source`, `amount`, `fee`, `currency`, `date = created`, `reversal = type === 'refund'`.

### T033 — Faux serveur et tests

1. Faux serveur : sessions, PaymentIntent avec `latest_charge` développé, expiration, balance transactions paginées,
   erreurs `{ error: { type, code, message } }`, et contrôle que chaque POST porte `Idempotency-Key`.
2. Tests : corps formulaire exact de la création ; `Idempotency-Key` ; nouvel essai sur 503 avec **la même** clé ;
   notification : vecteur selon la documentation (`t.` + corps) accepté ; en-tête avec `v0` et `secret=…` accepté ;
   même corps signé sans point (schéma Wave) refusé ; succès → `confirmationRequired: true` ; litige ; correspondances
   3-D Secure (une par valeur documentée) ; relevé paginé.
3. Mutations : `confirmationRequired: false` sur succès ; `attempt_acknowledged` → `NOT_PERFORMED` mal placé (vérifie
   l'effet) ; clé d'idempotence différente au nouvel essai ; entrées inconnues refusées.

## Definition of Done

- Toutes les sous-tâches faites ; fichiers limités aux `owned_files` (+ retouches de compilation nommées) ;
- tests du lot verts sur la base du lot (ou sans base pour les tests unitaires), **aucun appel réseau externe** ;
- chaque contrôle ajouté a sa mutation notée (retiré → test rouge → remis) ;
- `eslint`, `prettier --check`, `tsc --noEmit` propres sur les fichiers du lot ;
- note de lane : retouches hors carte, écarts (renforce/affaiblit), points « à confirmer à l'essai », fichiers à
  faire relire par une personne.

## Ce que le relecteur doit casser

Un succès crédité sans relecture de la carte ; 3-D Secure mal classé ; clé d'idempotence absente ou changeante ;
`v0` utilisé pour vérifier ; montant non entier ; une clé `sk_` dans un journal.

## Retouches hors carte permises

Seulement les retouches de compilation imposées par un changement de signature d'un lot antérieur (`interfaces.md`
§1), nommées dans la note de lane. Tout autre besoin : signale-le, ne le code pas.
