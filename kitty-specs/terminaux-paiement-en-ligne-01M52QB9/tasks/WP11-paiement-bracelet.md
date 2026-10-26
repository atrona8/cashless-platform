---
work_package_id: WP11
title: "Paiement par bracelet"
dependencies:
- WP09
- WP10
requirement_refs:
- FR-006
- FR-009
- FR-010
- FR-011
- FR-012
- FR-013
- FR-014
- FR-015
- FR-019
- FR-020
- FR-025
- NFR-001
- NFR-005
- NFR-006
- NFR-007
- NFR-008
- C-001
- C-003
- C-005
- C-007
planning_base_branch: feat/terminaux-paiement-en-ligne
merge_target_branch: feat/terminaux-paiement-en-ligne
branch_strategy: Planning artifacts for this mission were generated on feat/terminaux-paiement-en-ligne. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/terminaux-paiement-en-ligne unless the human explicitly redirects the landing branch.
subtasks:
- T048
- T049
- T050
- T051
- T052
- T053
- T054
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
- apps/api/src/payments/payments.module.ts
- apps/api/src/payments/payments.controller.ts
- apps/api/src/payments/payments.service.ts
- apps/api/src/payments/payments.dto.ts
- apps/api/src/payments/payment-read.service.ts
- apps/api/src/payments/device-seq-registry.ts
- apps/api/src/payments/operation-time.ts
- apps/api/src/payments/qr-token-hash.ts
- apps/api/test/integration/payments/payments.spec.ts
- apps/api/test/integration/payments/payments-refusals.spec.ts
- apps/api/test/integration/payments/payments-concurrency.spec.ts
- apps/api/test/integration/payments/get-payment.spec.ts
- apps/api/test/unit/payments/payments.dto.spec.ts
- apps/api/test/unit/payments/device-seq-registry.spec.ts
- apps/api/test/unit/payments/operation-time.spec.ts
- apps/api/test/integration/end-to-end/device-auth-cases/payments.cases.ts
execution_mode: code_change
owned_files:
- apps/api/src/payments/**
- apps/api/test/integration/payments/**
- apps/api/test/unit/payments/**
- apps/api/test/integration/end-to-end/device-auth-cases/payments.cases.ts
tags: []
tracker_refs: []
---

# Work Package Prompt: WP11 – Paiement par bracelet

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load node-norris` (Profile : node-norris / Role : implementer / Agent : claude).
Lis ensuite la fiche de contexte d'implémentation fournie par l'orchestrateur, ce prompt, puis, dans
`kitty-specs/terminaux-paiement-en-ligne-01M52QB9/` : `spec.md` (FR-006, FR-009 à FR-015, FR-019, FR-020, FR-025,
NFR-001, NFR-005, NFR-006), `contracts/payments.md` (sections clé et registre, heure, `createPayment`, `getPayment`),
`contracts/qr-payments.md` (« QR client », point 2), `contracts/catalog.md` (contrôle des lignes), `data-model.md`
(`sale_line`, `sale_attribution`, `device_seq_registry`, codes d'erreur), `research.md` R-03, R-06, R-11 (A1, A4,
A11, A13, A14, A17, A18, A27), `plan.md` IC-04 et IC-13. Puis `docs/sync_protocol.md` §3.2 et §3.3 (registre et
`content_sha256`, **prioritaire** sur la SPECIFICATION), SPECIFICATION §7.6 (frontières), §9.5 et §9.6 (heure).
Code : `apps/api/src/media/taps/tap.service.ts` (`registerOrRefuse`, `settleRefusal`, `consume`),
`apps/api/src/ledger/ledger-engine.service.ts` (`execute`, `LedgerCommand`), `apps/api/src/media/lifecycle/
deposit.controller.ts` (modèle d'une route idempotente avec lecture embarquée), le socle WP08 et la garde de session
de WP09 (`apps/api/src/vendors/vendor-session-guard.ts`). Migrations 0033 (WP04) et 0034 (WP05) pour les signatures.

Règle §0.3 : en cas de contradiction entre sources, applique la priorité (tests exécutables > schéma SQL,
`openapi.yaml`, `sync_protocol.md` > SPECIFICATION > PRD) et **signale-la** dans le compte rendu. Ne modifie jamais un
fichier `.sql` généré de `packages/ledger-sql/` ; ce lot ne touche à aucun fichier SQL.

## Objective

Servir `createPayment` (`POST /payments`) avec ses trois moyens — lecture embarquée, `tap_id`, QR client — en une
transaction, tout ou rien, attribuée par le serveur à la session de vendeur ; servir `getPayment` ; tenir le registre
des numéros du terminal (`record_device_seq`) et borner l'heure de l'opération. Fournir aux lots WP12 et WP13 le
registre des numéros et l'empreinte d'un jeton QR.

## Context

- Exigences : voir frontmatter ; carte IC-04 (paiement) et IC-13 (registre, clé, heure). C-005 : en ligne seulement ;
  C-007 : `payment_intent_id` refusé.
- Constats traités au plan, à tenir ici : **A1** (`tap_id` contrôlé par `assert_tap_payable`, jamais par
  `TapService.byId`), **A4** (registre des numéros, refus 4xx compris), **A11** (vendeur retrouvé par la base depuis la
  session : `record_sale_attribution(tx, vendor_session_id, channel)`), **A13** (garde exclusive de `getPayment`),
  **A14** (`<serial>` lié au terminal ; refus non définitifs non enregistrés), **A17** (`assert_wallet_payable` sur les
  trois moyens), **A18** (`consume_tap` remplacée contrôle le terminal de la lecture), **A27** (`X-Authority-Epoch`).
- Fonctions de la base : `record_device_seq(device, seq, content, outcome, channel, tx, reason)` (schéma de
  référence, accordée par WP07), `assert_device_active(device)` (5a), `assert_vendor_session` (WP02, via
  `VendorSessionGuard` de WP09), `register_tap` (via `TapService`), `assert_tap_payable(tap_id, device)`,
  `assert_wallet_payable(wallet)`, `record_sale_lines(tx, device, lines)`, `record_sale_attribution(tx,
  vendor_session_id, channel)`, `consume_tap(tap_id, tx)` (WP03/WP04), `lock_customer_qr_token(nonce_hash, device)`,
  `confirm_payment_request(id, tx)` (WP05). Signatures et retours exacts : migrations 0031 à 0034.
- Socle WP08 : idempotence de terminal (prestataire tiré du terminal, portée `device:<deviceId>:`, `<serial>` contrôlé
  → `422`, clé relâchée sur `409 DEBIT_AUTHORITY_MOVING` et `DEBIT_AUTHORITY_EDGE`), garde exclusive « terminal ou
  personne », `DeviceContext` enrichi (`appMode`, `personalPhone`, participation du point de vente), traduction
  CL032 à CL037, masquage de `customer_qr_token`.
- Ordre global des verrous : **terminal → vendeur → session de vendeur → demande QR → bracelet → portefeuille**.
- Ce qui en dépend : WP12 (annulation) et WP13 (QR commerçant) réutilisent `DeviceSeqRegistry` et `qrTokenHash` ;
  WP14 mesure la latence (NFR-001) et la concurrence transverse.

**Règle de sécurité du projet (`CLAUDE.md`, C-009, C-010)** : si un point de ce lot ne peut être tenu qu'en
affaiblissant la sécurité (droit plus large, contrôle retiré ou reporté, secret plus exposé, faux gardé plus longtemps
que prévu), **arrête-toi sur ce point et soumets-le au porteur avant de coder**, avec le risque et les options ;
continue le reste. Un renforcement se fait, puis se consigne dans le compte rendu du lot.

## Arbitrages de l'orchestrateur (22/10/2026)

Décisions prises à la génération des lots ; tous dans le sens le plus strict ou de pure répartition (aucun
affaiblissement, règle 1 de `CLAUDE.md`). Elles priment sur les « points à trancher » du texte ci-dessus et
ci-dessous. Reporter dans le compte rendu du lot les écarts au plan qui en découlent.

- Pas de `x-process`. Verrou du terminal pris en première instruction (`SELECT … FOR UPDATE` si WP07 laisse un `UPDATE` de colonne sur `device`, sinon fonction de la base demandée à l'orchestrateur), `record_device_seq` en fin de transaction : retenu.
- `X-Authority-Epoch` absent sur une route de paiement : **refusé** (plus strict, conforme au « DOIT » du contrat), consigné.
- `content_sha256` : champs fixés dans le prompt + vecteur de test ; à reporter pour la mission 7 dans le compte rendu.
- `DeviceSeqRegistry` et `qrTokenHash` dans `payments/`, importés sans modification par WP12 et WP13.

## Branch Strategy

Planification et fusion sur `feat/terminaux-paiement-en-ligne`. Dépendances : WP09, WP10 (et, par eux, WP07, WP08).
L'espace de travail (worktree) est attribué par lane calculée dans `lanes.json`. Commande :
`spec-kitty agent action implement WP11 --agent claude --mission terminaux-paiement-en-ligne-01M52QB9`.

Retouches hors carte autorisées, chacune consignée en une ligne : `apps/api/src/app.module.ts` (**une ligne**
d'import de `PaymentsModule`) ; `packages/contracts/openapi.yaml` (lignes `x-process: public` de `createPayment` et
`getPayment`, voir T054). `TapService` et le moteur d'écritures sont réutilisés **sans modification**.

## Subtasks

### T048 — Module des paiements et `createPayment` (lecture embarquée)

- `payments.controller.ts` : `POST /payments`, `@DeviceAuth()` (pas `nfcOnly` sur la route : le QR client est permis
  à un iOS), idempotence de terminal WP08, `IdempotentTx.run`. `payments.dto.ts` : exactement un moyen parmi `tap`,
  `tap_id`, `customer_qr_token`, `payment_intent_id` ; `payment_intent_id` → `422 DEVICE_MODE_NOT_ALLOWED` (C-007) ;
  `vendor_session_id` UUID requis ; `amount` entier > 0 (lu en `bigint`) ; `currency` = devise de l'événement ;
  `lines` : si présentes, `product_id` requis, `quantity` ≥ 1, `amount` = Σ `quantity × unit_price` (sinon
  `422 VALIDATION_FAILED`, revérifié par la base).
- Contrôles du terminal (`DeviceContext`) : `TOPUP_DESK` → `422 DEVICE_MODE_NOT_ALLOWED` ; `CATALOG_POS` sans lignes ou
  `KEYPAD_TPE` avec lignes → `422 VALIDATION_FAILED` ; moyen `tap` ou `tap_id` sur un terminal non Android ou au NFC
  coupé → `422 DEVICE_MODE_NOT_ALLOWED` (FR-015). Un téléphone personnel encaisse (en ligne).
- `payments.service.ts`, dans **une** transaction, dans cet ordre :
  1. prise du terminal en premier (voir T052, point à trancher sur `record_device_seq`) ;
  2. heure et époque (T051) ; 3. `assert_device_active(device)` ;
  4. `VendorSessionGuard.assert(client, device, vendor_session_id)` → vendeur (jamais un vendeur envoyé par le
     terminal, FR-006) ;
  5. lecture embarquée : `TapService.registerOrRefuse(client, device, tap)` → `mediaId`, `tapId` ; portefeuille du
     bracelet ; bracelet sans portefeuille : refus `MEDIA_*` existant (signale le code retenu) ;
  6. `assert_wallet_payable(wallet)` (A17) ;
  7. moteur : `engine.execute(client, {type: 'PURCHASE', source: 'ONLINE', idempotencyKey: <Idempotency-Key>,
     occurredAt, ledgerId, eventId, currency, deviceId, mediaId, payload: {walletId, participationId, amount},
     metadata: {vendor_session_id, channel}})` ; `ledgerId` = grand livre `EVENT` de l'événement du terminal dans sa
     devise ; `participationId` = participation du point de vente du terminal ;
  8. `record_sale_lines(tx, device, lines::jsonb)` si des lignes (`CATALOG_POS`), puis
     `record_sale_attribution(tx, vendor_session_id, 'NFC')` ;
  9. `TapService.consume(client, tapId, tx)` (`consume_tap` remplacée) ; 10. enregistrement du numéro (T052) ;
  11. `201 PaymentResult` : champs du contrat, `vendor` (`vendor_id`, `display_name` lu dans `vendor_public`),
     `lines`, `channel`, `balance_after` (`spendable`, `paid`, `promo` relus après l'écriture, comme
     `TapService.register`). `receipt_number` : le plan ne le définit pas ; ne l'invente pas, signale-le.
- Refus : `try { tx.run(…) } catch (e) { … }` — enregistrement du refus au registre (T052), puis
  `TapService.settleRefusal(e, device, tap)` (effets durables d'une lecture suspecte rejoués seuls), qui relève
  l'erreur. Refus du moteur ou de la base (`INSUFFICIENT_FUNDS` avec le solde, `EVENT_CLOSING`, `MEDIA_BLOCKED`,
  `WALLET_BLOCKED`, `SALE_LINES_INVALID`, `VENDOR_SESSION_INVALID`…) : transaction annulée, passage non enregistré
  (§7.6 point 2), rien d'écrit (NFR-006).
- Latence (NFR-001) : aucune requête par ligne de vente ni par article (lignes passées en un `jsonb`) ; lectures du
  grand livre, de la participation et du portefeuille regroupées ; pas d'aller-retour inutile.

### T049 — Paiement par `tap_id` (A1, A18)

Même transaction ; à l'étape 5, `assert_tap_payable(tap_id, device)` (lecture de ce terminal, non consommée, dans
`tap_replay_window_seconds` à l'heure de la base, bracelet `ACTIVE` relu `FOR SHARE`) → bracelet et portefeuille
(retour exact selon 0033) ; refus `422 MEDIA_BLOCKED` ou `409 TAP_UNUSABLE`. **`TapService.byId` n'est pas utilisé.**
Aucune lecture embarquée à rendre durable (`settleRefusal` reçoit `tap = null`). `consume_tap` en fin.

### T050 — Paiement par QR client

`qr-token-hash.ts` : `qrTokenHash(token: string): Buffer` = SHA-256 des octets UTF-8 du jeton tel que reçu (aucune
normalisation non écrite au contrat ; WP13 réutilise cette fonction pour créer le jeton). Étape 5 : `lock_customer_qr_token
(hash, device)` (demande `FOR UPDATE`, `CUSTOMER_QR`, `PENDING`, non expirée, même événement, portefeuille `ACTIVE`) →
demande et portefeuille ; puis `assert_wallet_payable`, moteur (`mediaId` absent), lignes,
`record_sale_attribution(tx, vendor_session_id, 'CUSTOMER_QR')`, `confirm_payment_request(id, tx)`. Toute issue
refusée → `409 PAYMENT_REQUEST_NOT_PENDING`, même corps (FR-020). Le jeton n'apparaît dans aucune réponse, journal,
audit, métadonnée, ni dans `content_sha256` (NFR-008) ; seule son empreinte passe à la base.

### T051 — Heure de l'opération et époque d'autorité (A5, A27)

`operation-time.ts` : constante nommée `OCCURRED_AT_TOLERANCE_SECONDS = 120` (§9.6). Heure lue dans la base
(`clock_timestamp()`) dans la transaction ; `|occurred_at − heure base| > 120 s` → `occurredAt` = heure de la base,
`metadata.device_occurred_at` = heure reçue, et une anomalie `CLOCK_SKEW` (terminal, grand livre) ouverte dans la même
transaction. Aucune fonction de la base n'est prévue pour cette anomalie : vérifie que `cashless_app` garde `INSERT`
sur `anomaly` après WP07 ; sinon arrête ce point et demande. `X-Authority-Epoch` présent et différent de
`ledger.authority_epoch` → `409 STALE_AUTHORITY_EPOCH` avec l'époque courante. En-tête absent : le contrat le déclare
facultatif mais dit « DOIT être envoyée » — point à soumettre (refuser serait plus strict), ne tranche pas seul.

### T052 — Registre des numéros : réussites, refus, refus non définitifs (A4, A14)

`device-seq-registry.ts` : `DeviceSeqRegistry` exporté par `PaymentsModule` (réutilisé par WP12, WP13).
- `seq` = partie numérique de la clé `<serial>:<seq>` (le `<serial>` est contrôlé par WP08).
- `content_sha256` = SHA-256(JCS(champs chaînés présents)) selon `sync_protocol.md` §3.3 et les noms de
  `OfflineOperation` : `seq`, `type` (`PURCHASE`), `occurred_at` (tel que reçu), `amount`, `currency`, `tap` (lecture
  embarquée), `lines` ; jamais `tap_id`, `customer_qr_token`, `vendor_session_id` ni champ d'état. Test d'un vecteur
  fixe. La forme exacte devra correspondre à celle des lots hors ligne (mission 7) : signale-le.
- Réussite : `record_device_seq(device, seq, content, 'ACCEPTED', 'ONLINE', tx)` dans la transaction de l'écriture.
- Refus définitif 4xx (y compris refus du moteur, de la base, de la session, de la lecture, du mode) : dans une
  transaction **séparée et validée**, après l'annulation, `record_device_seq(device, seq, content, 'REJECTED',
  'ONLINE', NULL, <code du problème>)`. Refus non définitifs (`DEBIT_AUTHORITY_MOVING`, `DEBIT_AUTHORITY_EDGE`) et 5xx :
  rien d'enregistré. Refus levés par `record_device_seq` lui-même (`CL002` même numéro autre contenu, `CL021` hors
  plage) : rien d'enregistré, traduits tels quels.
- **Point à trancher (incohérence du contrat)** : `contracts/payments.md` veut `record_device_seq` « en premier »
  (il prend le terminal `FOR UPDATE`), mais la fonction exige déjà l'issue et `transaction_id`, connus seulement à la
  fin, et le registre est immuable. Proposition : première instruction de la transaction = prise du terminal
  `SELECT 1 FROM device WHERE id = $1 FOR UPDATE` (ordre global tenu ; `assert_device_active` en `FOR SHARE` ensuite
  est compatible), puis `record_device_seq` en fin, verrou déjà tenu. Vérifie que les droits de WP07 le permettent ;
  sinon demande à l'orchestrateur une fonction de la base. Ne change pas l'ordre des verrous sans accord.
- Corps mal formé (aucun contenu calculable) : enregistré ou non ? Non arrêté au plan ; signale ton choix.

### T053 — `getPayment`

`GET /payments/{transaction_id}`, garde exclusive de WP08 (mTLS ou `Signature` présent → trois preuves exigées, sans
repli ; sinon personne seule). Terminal : ses propres ventes (`journal_transaction.device_id` = terminal). Personne :
`OPERATOR_ADMIN` ; `ORGANIZER_ADMIN` de l'organisateur de l'événement ; `SUPERVISOR` de l'événement ;
`MERCHANT_ADMIN` du commerçant de la participation. Hors périmètre, autre prestataire, type autre que `PURCHASE` (ou
`REVERSAL` d'une vente, si WP12 rend un `PaymentResult`) : `404`. `payment-read.service.ts` : vente, lignes
(`sale_line`), attribution (`sale_attribution` + `vendor_public`), canal. Points à signaler : `balance_after` (requis
par le schéma, sans sens pour une consultation) et l'annulation éventuelle (FR-025) — suis le contrat de WP01, ne
complète pas le schéma toi-même.

### T054 — Tests des paiements et cas de la matrice

- Unitaires : `payments.dto.spec.ts` (un seul moyen, `payment_intent_id`, somme des lignes, montants en `bigint`) ;
  `device-seq-registry.spec.ts` (vecteur `content_sha256`, champs exclus) ; `operation-time.spec.ts` (bornes ±120 s).
- `payments.spec.ts` : trois moyens réussis ; `KEYPAD_TPE` sans lignes ; `CATALOG_POS` au prix courant et au prix de la
  dernière version servie ; vente attribuée au vendeur de la session (FR-006) ; lignes copiées ; registre `ACCEPTED`
  lié à la vente ; rejeu de la même clé → même réponse et `Idempotency-Replayed` ; `CLOCK_SKEW` ; époque périmée.
- `payments-refusals.spec.ts` (NFR-006 vérifié sur **chaque** refus : aucune vente, aucune ligne, aucune attribution,
  passage non consommé, registre `REJECTED` avec le code) : solde insuffisant (solde rendu), bracelet bloqué par `tap`
  et par `tap_id` (bloqué après la lecture, A1), portefeuille bloqué, `EVENT_CLOSING`, `TAP_UNUSABLE` (consommé, trop
  ancien, autre terminal), prix d'une version servie remplacée (A2), somme fausse, session invalide, iOS par bracelet,
  `TOPUP_DESK`, `payment_intent_id`, QR inconnu, expiré, utilisé (même corps) ; `DEBIT_AUTHORITY_EDGE` : rien au
  registre, même clé rejouable.
- `payments-concurrency.spec.ts` (NFR-005, en série avec le reste) : 20 paiements simultanés avec la même lecture, le
  même `tap_id`, le même QR client → exactement une vente. Jeton QR amorcé par `create_customer_qr_token` (fonction de
  la base de WP05).
- `get-payment.spec.ts` : terminal (sa vente : `200` ; vente d'un autre terminal : `404`), chaque rôle admis, rôle hors
  périmètre et autre prestataire `404` (NFR-007), preuves mêlées (mTLS + jeton de personne) refusées.
- `device-auth-cases/payments.cases.ts` : `POST /payments` (session ouverte et bracelet du jeu d'essai, lecture neuve à
  chaque appel, clé `<serial>:<seq>` neuve, `ok: 201`) et `GET /payments/{}` (vente du terminal, `ok: 200`). Le test
  « routes de terminal du contrat non servies : 404 » doit rester vert.
- `x-process: public` sur `createPayment` et `getPayment`. **Attention** : `media-isolation.spec.ts` compte toutes les
  opérations marquées `x-process` (39 attendues) ; s'il casse, ne le modifie pas (hors carte) : arrête ce point et
  demande à l'orchestrateur.

## Test Strategy

Ordre : `npm run lint`, `npm run typecheck`, `npm run reset-db -w @cashless/ledger-sql`,
`npm run test:pgtap -w @cashless/ledger-sql`, puis `npm run reset-db -w @cashless/ledger-sql && npm test -w
@cashless/api -- --runInBand`. Jamais pgTAP sur une base où Jest vient de tourner (rejouer `reset-db`). La base
partagée appartient à l'orchestrateur : tests en série seulement, concurrence comprise. Dans un worktree de lane, crée
d'abord les liens `node_modules/@cashless/{api,contracts,ledger-sql,tag-format}`. Horloge de la base Docker qui peut
reculer : aucun test ne compare l'heure de Node à `now()` de la base sans marge (`CLOCK_SKEW` : écart d'au moins 10 min,
heure de référence lue en base). La latence (NFR-001) est mesurée par WP14 ; ici, aucune assertion de durée.

## Definition of Done

- `createPayment` (trois moyens) et `getPayment` servis, conformes au contrat ; registre des numéros tenu.
- Lint, typecheck, pgTAP et Jest verts en série ; matrice des preuves verte ; suites des bracelets et de la 5a vertes.
- Chaque sous-tâche marquée : `spec-kitty agent tasks mark-status T048 --status done --mission
  terminaux-paiement-en-ligne-01M52QB9` (idem T049 à T054).
- Compte rendu ajouté en fin de ce fichier : écarts au plan (sens) ; retouches hors carte (une ligne chacune) ; points
  soumis au porteur (en-tête d'époque absent, ordre de `record_device_seq`, corps mal formé) ; fichiers à faire relire
  par une personne (`payments.service.ts` : ordre des verrous et tout ou rien ; `device-seq-registry.ts` ;
  `qr-token-hash.ts`) ; **critères couverts avec leur preuve** (fichier de test et nom du cas) pour FR-006, FR-009 à
  FR-015, FR-019, FR-020 (part paiement), FR-025, NFR-005 (passage, `tap_id`, QR client), NFR-006, NFR-007 (part
  paiements), NFR-008 (part paiement).

## Risks

- Ordre des verrous rompu (portefeuille avant bracelet, session après lecture) : interblocages sous charge.
- Passage consommé ou numéro « accepté » sur un refus : NFR-006 et §3.2 cassés.
- `TapService.byId` utilisé pour payer : bracelet bloqué payé (A1).
- Vendeur ou canal tiré du corps de la requête : FR-006 cassé.
- Jeton QR client dans un journal, une métadonnée ou le contenu haché : NFR-008 cassé.
- Points à trancher (à signaler, pas à inventer) : `record_device_seq` en premier ou en dernier ; en-tête d'époque
  absent ; `receipt_number` ; `balance_after` et annulation dans `getPayment` ; forme de `content_sha256` face à la
  mission 7 ; anomalie `CLOCK_SKEW` sans fonction de la base ; corps mal formé au registre ; `x-process` et
  `media-isolation.spec.ts`.

## Reviewer Guidance

Le relecteur distinct vérifie, refus par refus : chaque refus listé en T054 n'écrit ni vente, ni ligne, ni
attribution, ne consomme pas le passage, et laisse au registre `REJECTED` avec son code (sauf refus non définitifs et
5xx, sans trace) ; l'ordre terminal → session → demande QR → bracelet → portefeuille dans le code ; `assert_tap_payable`
et `assert_wallet_payable` sur chaque moyen concerné ; vendeur attribué par `record_sale_attribution` seulement ;
`getPayment` sans repli d'un chemin vers l'autre, `404` hors périmètre ; aucun jeton ni empreinte de jeton dans une
réponse, un journal ou `api_idempotency`.

## Reports de l'orchestrateur (23/10/2026, relecture WP08 cycle 1)
- Constat 3 : `<seq>` de la clé `<serial>:<seq>` n'a pas de borne haute (`device-key.ts:24`, motif `[0-9]{4,}`) ;
  au-delà de 2^63−1, `record_device_seq` lève `22003` → `500` au lieu de `422 VALIDATION_FAILED`. Borner
  `seq ≤ 9223372036854775807` dans `parseDeviceKey` (retouche hors carte justifiée) ; test aux deux bornes.

## Reports de l'orchestrateur (26/10/2026, relecture WP10 cycle 1)
- `apps/api/src/devices/heartbeat/heartbeat.controller.ts:37` appelle `build` sans langue : un terminal non
  francophone voit un ETag différent à chaque battement et relit sa configuration. Retouche hors carte autorisée :
  passer `pickLanguage(...)` (comme `device-config.controller.ts`) et un test qui prouve l'ETag stable d'un battement à
  l'autre avec `Accept-Language: en`. Le battement ne doit toujours rien écrire dans `device_catalog_served`.
