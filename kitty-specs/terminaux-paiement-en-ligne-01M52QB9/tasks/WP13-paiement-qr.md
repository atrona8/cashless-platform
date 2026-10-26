---
work_package_id: WP13
title: "Paiement par QR"
dependencies: [WP11]
requirement_refs: [FR-018, FR-019, FR-020, NFR-005, NFR-008, NFR-009, C-001, C-003]
planning_base_branch: feat/terminaux-paiement-en-ligne
merge_target_branch: feat/terminaux-paiement-en-ligne
branch_strategy: Planning artifacts for this mission were generated on feat/terminaux-paiement-en-ligne. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/terminaux-paiement-en-ligne unless the human explicitly redirects the landing branch.
subtasks: [T061, T062, T063, T064, T065]
phase: "Phase 3 - Routes"
history:
- timestamp: '2026-10-22T14:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks-packages
agent_profile: node-norris
role: implementer
agent: claude
authoritative_surface: apps/api/
create_intent:
- apps/api/src/payment-requests/payment-requests.module.ts
- apps/api/src/payment-requests/terminal-payment-requests.controller.ts
- apps/api/src/payment-requests/customer-payment-requests.controller.ts
- apps/api/src/payment-requests/payment-request.service.ts
- apps/api/src/payment-requests/qr-token.ts
- apps/api/test/integration/payment-requests/merchant-qr.spec.ts
- apps/api/test/integration/payment-requests/customer-qr.spec.ts
- apps/api/test/unit/payment-requests/qr-token.spec.ts
- apps/api/test/integration/end-to-end/device-auth-cases/payment-requests.cases.ts
execution_mode: code_change
owned_files:
- apps/api/src/payment-requests/**
- apps/api/src/customer-identity/**
- apps/api/test/support/fake-customer.ts
- apps/api/test/integration/payment-requests/**
- apps/api/test/unit/payment-requests/**
- apps/api/test/integration/end-to-end/device-auth-cases/payment-requests.cases.ts
tags: []
tracker_refs: []
---

# Work Package Prompt: WP13 – Paiement par QR

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load node-norris` (Profile : node-norris / Role : implementer / Agent : claude).
Lis ensuite la fiche de contexte d'implémentation fournie par l'orchestrateur, ce prompt, puis seulement :
- `spec.md` : User Story 6, Edge Cases (même jeton payé deux fois), FR-018 à FR-020, NFR-005, NFR-008, NFR-009 ;
- `contracts/qr-payments.md` (entier) et, dans `contracts/payments.md`, « Clé et registre des numéros » ;
- `data-model.md` : `payment_request` et `payment_request_detail`, `sale_attribution` (`channel`), CL037 ;
- `research.md` : R-08, R-11 (A3, A10, A17, A24, A25) ;
- la migration `packages/ledger-sql/migrations/0034_payment_requests.sql` telle que livrée par WP05 (signatures réelles
  de `create_merchant_payment_request`, `lock_payment_request_for_pay`, `confirm_payment_request`,
  `cancel_payment_request`, `create_customer_qr_token`) ;
- code existant : `apps/api/src/customer-identity/` (port, garde `CustomerAuth`, faux refusé en production par
  `createCustomerIdentity`), `apps/api/test/support/fake-customer.ts`, `apps/api/test/unit/production-guard.spec.ts`.

Règle §0.3 : en cas de contradiction entre sources, appliquer la priorité (tests exécutables > schéma SQL,
`openapi.yaml`, `sync_protocol.md` > SPECIFICATION > PRD) et **la signaler**. Écart déjà signalé, non tranché ici :
`humanBearer` au contrat contre `CustomerAuth` (comme `claimMedia`, R-08). Ne jamais modifier un fichier `.sql`
généré de `packages/ledger-sql/`.

## Objective

Servir le QR commerçant (création, consultation et annulation par le terminal ; paiement, consultation et annulation
par le festivalier) et la création du QR client par le festivalier, en ne gardant que l'empreinte des jetons et en
confiant usage unique et expiration aux fonctions de la base.

## Context

- Exigences : FR-018, FR-019, FR-020, NFR-005 (20 paiements simultanés du même jeton → 1 vente), NFR-008 (aucun jeton
  en clair), NFR-009 (aucun faux en production) ; IC-06.
- Décision du porteur `DM-01M5HPJ4C0DQYEZCB49FTPE3D4` (R-08) : côté festivalier derrière le port d'identité du
  festivalier ; seul le faux existe, **refusé en production** ; utilisable en production avec la mission 10
  (OP-N43 complété). Aucun nouveau faux n'est ajouté par ce lot.
- Constats : A3 (routes qui rendent un jeton en `transient` : aucune réponse dans `api_idempotency`), A10 (verrouiller
  → moteur → confirmer ; SQL n'appelle pas le moteur), A17 (portefeuille `ACTIVE`, `FOR SHARE`), A24 (consultation
  par le festivalier avec le jeton), A25 (événement d'un QR client = celui du grand livre du portefeuille).
- **Partage avec WP11** : l'encaissement d'un QR client **par le terminal** (`POST /payments` avec
  `customer_qr_token`, `lock_customer_qr_token`) est T050 de WP11. Ce lot ne sert que sa création côté festivalier.
- Fournis : WP05 (fonctions), WP07 (retrait d'`INSERT`/`UPDATE` sur `payment_request`, `SELECT` sans `nonce_hash`,
  accords), WP08 (garde exclusive, idempotence de terminal, masquage des journaux, registre de cas), WP09 (session de
  vendeur), WP10/WP03 (contrôle des lignes), WP11 (registre des numéros, moteur `PURCHASE`, attribution).
- Dépendant : WP14 (parcours, secrets, isolation, concurrence).

**Règle de sécurité du projet (`CLAUDE.md`, C-009, C-010)** : si un point de ce lot ne peut être tenu qu'en affaiblissant
la sécurité (droit plus large, contrôle retiré ou reporté, secret plus exposé — un jeton journalisé ou gardé en clair —,
faux gardé plus longtemps ou atteignable en production), **arrête-toi sur ce point et soumets-le au porteur avant de
coder**, avec le risque et les options ; continue le reste. Un renforcement se fait, puis se consigne dans le compte
rendu du lot.

## Arbitrages de l'orchestrateur (22/10/2026)

Décisions prises à la génération des lots ; tous dans le sens le plus strict ou de pure répartition (aucun
affaiblissement, règle 1 de `CLAUDE.md`). Elles priment sur les « points à trancher » du texte ci-dessus et
ci-dessous. Reporter dans le compte rendu du lot les écarts au plan qui en découlent.

- Jeton du festivalier en **en-tête dédié** pour `GET` et `cancel` (arbitrage WP01) ; lecture par `payment_request_for_token` (WP05).
- L'encaissement du QR client par le terminal est dans WP11 (T050) ; ce lot sert la création côté festivalier.

## Branch Strategy

Planification et merge sur `feat/terminaux-paiement-en-ligne`. Dépendance : WP11. Worktree attribué par lane
(`lanes.json`). Commande : `spec-kitty agent action implement WP13 --agent claude --mission
terminaux-paiement-en-ligne-01M52QB9`. Retouches hors carte autorisées, à consigner : une ligne d'import de
`PaymentRequestsModule` dans `apps/api/src/app.module.ts` ; les lignes `x-process: public` de `createPaymentRequest`,
`getPaymentRequest`, `payPaymentRequest`, `cancelPaymentRequest`, `createCustomerQrToken` dans `openapi.yaml`.

## Subtasks

### T061 — Demande QR commerçant côté terminal

- `qr-token.ts` : jeton commerçant = 16 octets de `randomBytes` en base64url ; QR client = 12 caractères base32
  (60 bits, tirage sans biais) ; `nonceHash(token)` = SHA-256 (octets) ; aucun autre usage du jeton.
- `POST /v1/payment-requests` (`createPaymentRequest`) : trois preuves (C-003) ; `@Idempotent` de terminal avec
  `transient: true` (renvoi de la même clé → `409`, aucune réponse gardée) ; clé `<serial>:<seq>` (`<serial>` ≠
  terminal → `422`), numéro enregistré par `record_device_seq` en premier (refus 4xx enregistré à part) ; corps :
  `amount`, `currency`, `ttl_seconds` (15 à 300, défaut 60), `lines`, `vendor_session_id`.
- Transaction, ordre global des verrous : `record_device_seq` → `assert_device_active` → `assert_vendor_session` →
  `create_merchant_payment_request(device, vendor_session, amount, currency, ttl, nonce_hash, idempotency_key, lines,
  catalog_version)` (lignes contrôlées comme une vente, sans écriture de vente) → `201` avec `payment_request_id`,
  `token` (une seule fois), `qr_payload`, `expires_at`.
- `GET /v1/payment-requests/{id}` côté terminal (garde exclusive) : terminal d'origine seulement, sinon `404` ;
  `?wait` 0 à 25 s : attente **sans transaction ouverte**, relecture périodique bornée ; aucun autre mécanisme
  (`LISTEN/NOTIFY`) sans accord de l'orchestrateur.
- `POST /v1/payment-requests/{id}/cancel` côté terminal : terminal d'origine, clé `<serial>:<seq>` enregistrée,
  `cancel_payment_request` ; demande non `PENDING` → `409 PAYMENT_REQUEST_NOT_PENDING`.

### T062 — Paiement, consultation et annulation côté festivalier

- `customer-payment-requests.controller.ts`, `@CustomerAuth()` (prestataire = celui du compte) :
  - `POST /v1/payment-requests/{id}/pay` `{token, wallet_id}` (`@Idempotent`, la réponse ne contient aucun jeton) :
    une transaction : `lock_payment_request_for_pay(id, nonce_hash, wallet, customer)` (verrous dans l'ordre global,
    portefeuille du festivalier `ACTIVE`, même événement, terminal `ACTIVE`, session encore ouverte) → moteur
    `PURCHASE` (clé de la demande, lignes, `deviceId` et vendeur de la demande) → `confirm_payment_request(id, tx)`
    (attribution `channel MERCHANT_QR`) → `200 PaymentResult`.
  - inconnue, payée, annulée, expirée, mauvais jeton : **même** `409 PAYMENT_REQUEST_NOT_PENDING`, même corps, rien
    d'écrit ; refus du moteur (`INSUFFICIENT_FUNDS`…) : transaction annulée, demande toujours `PENDING`.
  - `GET` et `cancel` côté festivalier : jeton **exigé** (A10, A24) ; montant et commerçant visibles avant
    confirmation. Transport du jeton : celui que WP01 a mis au contrat ; s'il passe en chaîne de requête (journalisée),
    le signaler à l'orchestrateur comme écart de secret avant de coder.
- Garde exclusive (WP08) sur `getPaymentRequest` et `cancelPaymentRequest` : preuves de terminal présentes → chemin
  terminal complet sans repli ; sinon chemin festivalier seul.

### T063 — QR client côté festivalier

- `POST /v1/me/customer-qr-tokens` (`createCustomerQrToken`), `@CustomerAuth()`, `@Idempotent({ transient: true })`,
  corps `{wallet_id}` : `create_customer_qr_token(customer, wallet, nonce_hash)` ; montant nul ; événement = celui du
  grand livre du portefeuille (A25) ; portefeuille d'un autre festivalier ou bloqué : refus de la fonction, traduit
  sans dire lequel des cas. Réponse `201` : `payment_request_id`, `token` (une seule fois), `qr_payload`, `expires_at`.
- `fake-customer.ts` : aide de test pour créer un portefeuille rattaché au festivalier de test (propriétaire,
  amorçage seulement). `apps/api/src/customer-identity/` : aucune modification attendue ; si une retouche s'impose,
  elle ne doit rendre le faux atteignable en production d'aucune façon (sinon : arrêt et porteur).

### T064 — Tests des QR

- `merchant-qr.spec.ts` (HTTPS réel, terminal de test, vraie base, festivalier par le faux) : création (jeton une
  fois, base sans le jeton, `nonce_hash` = SHA-256) ; paiement → `PURCHASE`, demande `CONFIRMED`, `transaction_id`
  posé, vente attribuée au vendeur de la session (SC-002) ; rejeu du jeton → `409` ; expiré (`expires_at` reculé par le
  propriétaire), annulé, inconnu, mauvais jeton → même statut **et même corps** ; terminal suspendu ou session close
  entre création et paiement → refus ; portefeuille bloqué → refus, rien d'écrit ; renvoi de la même clé à la
  création → `409` et `api_idempotency` sans corps de réponse ; consultation et annulation par un autre terminal →
  `404` ; par le festivalier sans jeton → refus ; **20 paiements simultanés du même jeton → exactement 1 vente**
  (NFR-005).
- `customer-qr.spec.ts` : création, `transient`, portefeuille d'autrui refusé ; encaissement par `POST /payments`
  (route de WP11) puis rejeu → `409` ; jeton d'un autre événement refusé.
- Recherche locale : aucun jeton dans `payment_request`, `api_idempotency`, `audit_log` ni les journaux capturés
  (le balayage complet est dans WP14).
- Production : test qui prouve que le graphe de production refuse de démarrer avec le faux du festivalier, et que les
  deux routes du festivalier ne sont servies que derrière `CustomerGuard` (aucune `Public()` seule).
- `qr-token.spec.ts` : longueur, alphabet, entropie nominale, empreinte.

### T065 — Cas de la matrice (QR)

`device-auth-cases/payment-requests.cases.ts` : `createPaymentRequest`, et les chemins terminal de
`getPaymentRequest` et `cancelPaymentRequest`, au registre de WP08 ; réussite servie par la vraie route puis refus pour
chaque preuve absente, fausse ou rejouée. Le test « routes de terminal du contrat non servies : 404 » reste vert.

## Test Strategy

Ordre : `npm run lint`, `npm run typecheck`, `npm run reset-db -w @cashless/ledger-sql`,
`npm run test:pgtap -w @cashless/ledger-sql`, puis `npm run reset-db -w @cashless/ledger-sql && npm test -w
@cashless/api -- --runInBand`. Jamais pgTAP sur une base où Jest vient de tourner (rejouer `reset-db`). Base partagée :
passes complètes par l'orchestrateur, en série. Dans un worktree de lane, créer d'abord les liens
`node_modules/@cashless/{api,contracts,ledger-sql,tag-format}`. Horloge de la base Docker qui peut reculer : expiration
testée en reculant `expires_at` en base, jamais en comparant l'heure de Node à `now()` sans marge.

## Definition of Done

- Les cinq opérations servies, `x-process` posé, suites vertes ; aucun jeton hors de la réponse de création.
- Chaque sous-tâche marquée : `spec-kitty agent tasks mark-status Txxx --status done --mission
  terminaux-paiement-en-ligne-01M52QB9`.
- Compte rendu du lot en fin de ce fichier : écarts au plan (sens), retouches hors carte (une ligne chacune), points
  soumis au porteur, fichiers à faire relire par une personne (`qr-token.ts`, `payment-request.service.ts`),
  **critères couverts avec leur preuve** (FR-018 à FR-020, NFR-005 jeton QR, NFR-008 local, NFR-009 : fichier et nom
  du cas).

## Risks

- Jeton conservé par l'idempotence, l'audit ou un journal d'erreur ; jeton en chaîne de requête.
- Réponses qui distinguent expiré, utilisé, annulé ou inconnu (statut, corps, ou temps visiblement différent).
- Contrôle refait en API à la place de la base (C-001) ; ordre des verrous inversé entre demande et portefeuille.
- Vente écrite sans confirmation de la demande (ou l'inverse) : tout dans une transaction.

## Reviewer Guidance

Vérifier, refus par refus : même `409` et même corps pour les cinq cas d'échec ; 20 paiements simultanés → 1 ;
`transient` sur les deux routes à jeton (aucune ligne de réponse dans `api_idempotency`) ; jeton de 128 bits et de
60 bits tirés par `randomBytes`, seul le SHA-256 part en base ; consultation et annulation par le festivalier sans
jeton refusées ; terminal autre que celui d'origine → `404` ; garde exclusive sans repli ; faux du festivalier refusé
en production (test) ; aucune écriture directe dans `payment_request` (droits retirés par WP07).

## Reports de relecture (orchestrateur, 23/10/2026)

- Relecture WP01 cycle 1, mineur 1 (sécurité, FR-020) : `payPaymentRequest` liste encore une réponse `404` au
  contrat. Une demande inconnue doit rendre le même `409 PAYMENT_REQUEST_NOT_PENDING` que les autres refus (pas
  d'oracle). Ce lot retire le `404` de `openapi.yaml` (retouche hors carte justifiée) et le prouve par un test.
- Relecture WP01 cycle 1, mineur 3 : envisager `vendor_session_id` `required` sur `createPaymentRequest` si la base
  l'exige (WP05) ; sinon le justifier.

## Reports de l'orchestrateur (23/10/2026)
- ADR-123 (décision du porteur, 23/10) : `POST /payments` avec `customer_qr_token` : tout `CL037` de
  `lock_customer_qr_token` → `422 QR_TOKEN_INVALID`, réponse unique (même corps quelle que soit la cause). Les
  demandes de QR commerçant gardent `409 PAYMENT_REQUEST_NOT_PENDING`.

## Reports de l'orchestrateur (23/10/2026, relecture WP05 cycle 1)
- `payment_request_for_token(p_id uuid, p_nonce_hash bytea)` : l'API passe l'identifiant et l'empreinte du jeton.
- `lock_payment_request_for_pay` écrit `wallet_id` dans la demande encore en attente : verrouillage, écriture par le
  moteur et `confirm_payment_request` doivent tenir dans **une seule transaction** de l'API ; un test le prouve (aucune
  demande laissée avec un `wallet_id` posé après un refus ou une erreur).

## Reports de l'orchestrateur (26/10/2026, relecture WP09 cycle 3 : approuvé)
- Garde de session de vendeur : vérifier l'ordre d'appel de `VendorSessionGuard` (dans la transaction de l'écriture,
  après le terminal ; refus `409`), constat ouvert depuis la relecture WP09 cycle 1.
- Toute route qui aurait besoin d'un verrou de requête : `@RequestLock` (`apps/api/src/idempotency/request-lock.ts`)
  posé avant `@Idempotent`, identifiant tiré du terminal authentifié par les gardes, jamais du corps.
- Un PIN dans un corps idempotent passe par `pinFields` (ADR-126) ; un test qui compare l'empreinte stockée au HMAC du
  corps dérivé.
