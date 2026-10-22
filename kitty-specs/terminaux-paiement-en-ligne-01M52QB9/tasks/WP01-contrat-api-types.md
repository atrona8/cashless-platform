---
work_package_id: WP01
title: "Contrat d'API et types"
dependencies: []
requirement_refs: [FR-027, C-003, C-004, C-007, FR-024, FR-017]
planning_base_branch: feat/terminaux-paiement-en-ligne
merge_target_branch: feat/terminaux-paiement-en-ligne
branch_strategy: Planning artifacts for this mission were generated on feat/terminaux-paiement-en-ligne. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/terminaux-paiement-en-ligne unless the human explicitly redirects the landing branch.
subtasks: [T001, T002, T003, T004, T005]
phase: "Phase 1 - Contrat et base de données"
history:
- timestamp: '2026-10-22T14:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks-packages
agent_profile: node-norris
role: implementer
agent: claude
authoritative_surface: packages/contracts/
create_intent: []
execution_mode: code_change
owned_files:
- packages/contracts/openapi.yaml
- packages/contracts/generated/**
- packages/contracts/dart/**
- packages/contracts/src/**
- apps/api/src/http/messages.fr.json
- apps/api/src/http/messages.en.json
tags: []
tracker_refs: []
---

# Work Package Prompt: WP01 – Contrat d'API et types

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load node-norris` (Profile : node-norris / Role : implementer / Agent : claude).
Lis ensuite la fiche de contexte d'implémentation fournie par l'orchestrateur, ce prompt, puis seulement :
- `contracts/openapi-additions.md` (fiche principale du lot), et pour le détail des corps : `contracts/vendors.md`,
  `contracts/catalog.md`, `contracts/payments.md`, `contracts/qr-payments.md` ;
- `data-model.md` : « Codes d'erreur nouveaux (base → API) », `vendor_public`, `vendor_session`, `catalog_*` ;
- `spec.md` : FR-001 à FR-008, FR-016 à FR-020, FR-024, FR-027, C-003, C-004, C-007 ;
- `research.md` R-11 (A3, A8, A10, A13, A14, A22, A23, A24) ;
- code : `packages/contracts/scripts/generate.mjs` (lecture des puces de `ProblemCode`), `scripts/check.mjs`,
  `scripts/generate-dart.sh`, `apps/api/test/unit/errors/sqlstate-map.spec.ts` (bloc « messages »), et les tests qui
  lisent le contrat : `media-isolation.spec.ts` (champ `x-process`), `configuration-isolation.spec.ts`
  (`MISSION_TAGS`), `isolation-sweep.spec.ts` (`MISSION_PATHS`), `device-auth-matrix.spec.ts` et
  `apps/api/test/support/device-e2e.ts` (`contractDeviceOperations`).

Règle §0.3 : en cas de contradiction entre sources, appliquer la priorité (tests exécutables > schéma SQL,
`openapi.yaml`, `sync_protocol.md` > SPECIFICATION > PRD) et **la signaler**. Jamais de modification d'un `.sql` généré
de `packages/ledger-sql/`.

## Objective

Décrire au contrat, avant qu'elles soient servies, toutes les routes et tous les compléments de la mission (vendeurs,
sessions de vendeur, catalogue, compléments des paiements, de l'annulation et des QR, codes d'erreur, action
`SALE_REVERSAL`, refus OP-N74), puis régénérer les types TypeScript et Dart. Aucune route n'est servie par ce lot.

## Context

- Exigences : FR-027 (contrat et types), C-004 (contrat d'abord, types générés), C-003 (trois preuves sur toute route
  de terminal), C-007 (`payment_intent_id` refusé). IC-10.
- Ce lot ne touche à aucun code de l'API hors des deux catalogues de messages. Les lots WP08 à WP13 s'appuient sur
  les types générés (`ProblemCode`, schémas) : les noms posés ici sont définitifs.
- Tests existants qui lisent le contrat et qui doivent **rester verts sans modification** :
  - `device-auth-matrix.spec.ts`, « routes du contrat non servies : 404 » : toute opération dont la sécurité nomme une
    preuve de terminal et qui n'a pas de cas doit répondre `404`. Les nouvelles routes de terminal sont non servies à
    ce lot : vert tant qu'aucun contrôleur ne les sert.
  - `configuration-isolation.spec.ts` compte **48** opérations des tags `Plateforme`, `Organisation`, `Événements`,
    `Configuration` : les opérations ajoutées ne portent **aucun** de ces tags (nouveaux tags `Vendeurs` et
    `Catalogue`, déclarés dans la liste `tags:` de tête).
  - `media-isolation.spec.ts` compte **39** opérations portant `x-process` et exige un cas pour chacune : **ne pose
    aucun `x-process`** (voir T005).
  - `isolation-sweep.spec.ts` (`MISSION_PATHS`) : aucun chemin ajouté ne doit correspondre à son motif.
  - `sqlstate-map.spec.ts` (bloc « messages ») : chaque code de `PROBLEM_CODES` a un titre et un détail en français et
    en anglais.

**Règle de sécurité du projet (`CLAUDE.md`, C-009)** : si un point de ce lot ne peut être tenu qu'en affaiblissant la
sécurité (route de terminal sans les trois preuves, champ secret renvoyé, réponse à jeton rejouable, refus qui
distingue les cas que la spec veut indistincts), **arrête-toi sur ce point et soumets-le au porteur avant de
l'écrire**, avec le risque et les options ; continue le reste. Un renforcement se fait, puis se consigne dans le compte
rendu du lot.

## Arbitrages de l'orchestrateur (22/10/2026)

Décisions prises à la génération des lots ; tous dans le sens le plus strict ou de pure répartition (aucun
affaiblissement, règle 1 de `CLAUDE.md`). Elles priment sur les « points à trancher » du texte ci-dessus et
ci-dessous. Reporter dans le compte rendu du lot les écarts au plan qui en découlent.

- `x-process` : **aucun** sur les opérations de la 5b (comme la 5a) ; `media-isolation.spec.ts` compte les opérations marquées comme celles des bracelets. Écart à `openapi-additions.md`, sans effet de sécurité, consigné. Vaut pour WP09 à WP13.
- Tags `Vendeurs` et `Catalogue` nouveaux (le décompte de `configuration-isolation.spec.ts` reste juste).
- Contradictions §0.3 (`REVERSAL_NOT_ALLOWED` 422, `REVERSAL_WINDOW_EXPIRED` 409, `QR_TOKEN_INVALID` 422) : le contrat existant prime ; signale-les dans le compte rendu, l'orchestrateur corrige `data-model.md` et les fiches de contrat.
- Jeton du festivalier pour `getPaymentRequest` et `cancelPaymentRequest` : **en-tête dédié**, jamais en chaîne de requête ni dans un chemin (journaux).
- Clé d'idempotence de `openVendorSession` et `closeVendorSession` : **UUID** (option `transient`, renvoi → `409`), pour ne laisser aucun trou dans `contiguous_acked_seq` ; `<serial>:<seq>` reste réservé aux opérations enregistrées par `record_device_seq`. Écart signalé à `vendors.md` (« un renvoi refait l'essai ») : le `409` est plus strict.
- Problèmes `MEDIA_BLOCKED` et `WALLET_BLOCKED` : SQLSTATE `CL038` et `CL039` (posés par WP04) ; vérifie que les codes existent au contrat et dans les messages.

## Branch Strategy

Planification et fusion sur `feat/terminaux-paiement-en-ligne`. Dépendances : aucune (parallèle à WP02, WP03, WP06).
Worktree attribué par lane (`lanes.json`). Commande :
`spec-kitty agent action implement WP01 --agent claude --mission terminaux-paiement-en-ligne-01M52QB9`.

## Subtasks

### T001 — Routes et schémas des vendeurs et des sessions de vendeur

Tag `Vendeurs` (nouveau). Conventions : préfixe implicite `/v1`, snake_case, réponses d'erreur `problem+json`
(`$ref` des réponses communes existantes), `Idempotency-Key` sur toute écriture, `AcceptLanguage`, `RequestId`.
- Back-office (`humanBearer`) : `listVendors` GET `/merchants/{merchant_id}/vendors`, `createVendor` POST même
  chemin, `getVendor` GET `/vendors/{vendor_id}`, `setVendorPin` POST `/vendors/{vendor_id}/pin` (débloque, ferme les
  sessions), `setVendorStatus` POST `/vendors/{vendor_id}/status` (`ACTIVE` | `DISABLED`). Rôles dans la
  description : `MERCHANT_ADMIN` du commerçant, `OPERATOR_ADMIN` du prestataire ; autre périmètre : `404` neutre.
- Terminal (sécurité `deviceMtls` + `deviceToken` + `deviceSignature` dans **une seule** entrée, paramètres
  `SignatureInput`, `Signature`, `ContentDigest`, `DeviceRequestId` comme `createPayment`) :
  `listTerminalVendors` GET `/vendor-sessions/vendors` (`vendor_id`, `display_name` des vendeurs `ACTIVE` du
  commerçant du point de vente, rien d'autre) ; `openVendorSession` POST `/vendor-sessions` `{vendor_id, pin}`
  (`201 VendorSession` ; `401 VENDOR_PIN_INVALID` même corps pour PIN faux, vendeur inconnu, bloqué, désactivé ou
  d'un autre commerçant ; `429 RATE_LIMITED` si un essai du même terminal est en cours ; modes `CATALOG_POS`,
  `KEYPAD_TPE` ; réponse **non rejouée** : renvoi de la même clé → `409`) ; `closeVendorSession` DELETE
  `/vendor-sessions/current` (`204`).
- **Point à trancher (clé des sessions)** : `contracts/payments.md` réserve `record_device_seq` aux routes de vente,
  d'annulation et de demande QR. Si `openVendorSession` et `closeVendorSession` portaient une clé `<serial>:<seq>`,
  ce numéro ne serait jamais enregistré et laisserait un trou dans `contiguous_acked_seq` (sync_protocol §3.2).
  Proposition : clé UUID sur ces deux routes (portée `device:<device_id>:`), dite dans leur description ; à faire
  confirmer par l'orchestrateur avant de l'écrire.
- Schémas : `Vendor` (`vendor_id`, `merchant_id`, `display_name`, `status`, `locked` booléen ; **ni PIN ni empreinte
  ni compteur**), `VendorCreate` (`display_name` 1 à 80 caractères, `pin` `writeOnly`, motif `^[0-9]{6}$`),
  `VendorPinChange` (`pin` `writeOnly`, même motif), `VendorStatusChange`, `VendorSessionOpen` (`vendor_id`, `pin`
  `writeOnly`), `VendorSession` (`vendor_session_id`, `vendor_id`, `vendor_display_name`, `expires_at`),
  `TerminalVendor` (`vendor_id`, `display_name`).
- Description de `pin` : jamais renvoyé, journalisé ni audité ; refus `422 VALIDATION_FAILED` sans écho de la valeur.

### T002 — Routes et schémas du catalogue

Tag `Catalogue` (nouveau ; **pas** `Configuration`). Sécurité `humanBearer`. Opérations (contracts/openapi-additions.md) :
`getCatalog` GET `/points-of-sale/{pos_id}/catalog`, `createCatalogCategory` POST
`/points-of-sale/{pos_id}/catalog/categories`, `updateCatalogCategory` PATCH `/catalog-categories/{category_id}`,
`createCatalogItem` POST `/catalog-categories/{category_id}/items`, `updateCatalogItem` PATCH
`/catalog-items/{item_id}`, `getCatalogVersion` GET `/points-of-sale/{pos_id}/catalog/versions/{version}`,
`setCatalogPolicy` PUT `/points-of-sale/{pos_id}/catalog-policy` (`ORGANIZER_ADMIN`, `OPERATOR_ADMIN` seulement).
Schémas : `CatalogCategory` (`category_id`, `label_fr`, `label_en`, `position`, `active`), `CatalogItemAdmin`
(`item_id`, `category_id`, `label_fr`, `label_en`, `unit_price` `Amount` > 0, `vat_rate_bps` 0 à 10 000, `active`),
`CatalogVersion` (`pos_id`, `version`, `created_at`, `items`), `CatalogPolicy` (`merchant_manages`). Libellés non vides,
120 caractères au plus. Pas de suppression (désactivation). Chaque écriture : `201`/`200` avec la version créée ;
événement `CLOSED` : refus (`409 CONFLICT_STATE`, à confirmer avec WP03/WP10 — point à trancher s'ils lèvent un autre
code). `DeviceConfig.catalog.version` existe déjà : le compléter seulement si sa description ne dit pas « version 0,
`items: []` sans point de vente ou sans catalogue ».

### T003 — Compléments des paiements, de l'annulation et des QR

- `PaymentRequestBody`, `ReversalRequest`, corps de `createPaymentRequest` : `vendor_session_id` (uuid) ; requis depuis
  un terminal (dans la description : un `required` dur casserait l'appel au back-office de `reversePayment`).
- `ReversalRequest.supervisor_pin_proof` : description remplacée — **refusé (`422 VALIDATION_FAILED`)** ; la preuve
  du `SUPERVISOR` passe par l'en-tête `X-Approval-Token` (paramètre `ApprovalToken` ajouté à `reversePayment`) ; A8.
- `IdempotencyKey` (paramètre) : `<serial>` doit être le `serial` du terminal authentifié, sinon `422
  VALIDATION_FAILED` sans écriture ; `409 DEBIT_AUTHORITY_MOVING` et `409 DEBIT_AUTHORITY_EDGE` ne sont pas
  enregistrés (même clé rejouable).
- `createPaymentRequest`, `createCustomerQrToken`, `openVendorSession` : « réponse non conservée ; renvoi de la même
  clé : `409` » (A3, A23).
- `getPaymentRequest`, `cancelPaymentRequest` : côté festivalier, le jeton de la demande est exigé (A10, A24).
  **Point à trancher** (le plan ne dit pas comment le jeton circule sur un GET) : proposer un en-tête dédié (ex.
  `X-Payment-Request-Token`), jamais un paramètre de requête (il finirait dans les journaux d'accès) ; le soumettre
  à l'orchestrateur avant de l'écrire.
- `getPayment`, `reversePayment`, `getPaymentRequest`, `cancelPaymentRequest` : description de la garde exclusive
  (A13) — mTLS ou en-tête `Signature` présent : chemin terminal complet exigé, sans repli.
- `SaleLine` : `product_id` requis depuis une caisse `CATALOG_POS` (description) ; `label` réservé aux relevés.
- `PaymentResult` : `vendor` (`vendor_id`, `display_name`), `lines` (`SaleLineResult` : `product_id`, libellé,
  `quantity`, `unit_price`, `vat_rate_bps`, `line_total`, `catalog_version`), `channel` (`NFC`, `MERCHANT_QR`,
  `CUSTOMER_QR`) ; tous facultatifs (une recharge ou un remboursement les omet).
- `createDeviceEnrollmentCode`, `enrollDevice` : `422 ENROLLMENT_EVENT_CLOSED` documenté (OP-N74, FR-024).
- `createKycVerification`, `revokeKycVerification` : inchangées.

### T004 — Codes d'erreur, action `SALE_REVERSAL`, refus `ENROLLMENT_EVENT_CLOSED`

- `ProblemCode` : ajouter à l'`enum` et en puce de la description, **au format lu par `generate.mjs`**
  (« - `CODE` (statut, `CLxxx`) : sens ») : `ENROLLMENT_EVENT_CLOSED` (422, `CL031`), `VENDOR_SESSION_INVALID` (409,
  `CL032`), `VENDOR_PIN_INVALID` (401, `CL033`), `SALE_LINES_INVALID` (422, `CL034`). Compléter les puces existantes
  `ALREADY_REVERSED` (`CL035`) et `PAYMENT_REQUEST_NOT_PENDING` (`CL037`).
- **Contradictions à signaler** (§0.3, le contrat prime ; ne pas trancher seul) :
  1. `REVERSAL_NOT_ALLOWED` existe déjà au contrat en **422** ; `data-model.md` et `contracts/payments.md` disent
     `CL036` → **403**. Changer le statut d'un code existant est une évolution du contrat : garder 422 par défaut et
     soumettre à l'orchestrateur (sans effet de sécurité, le refus a lieu dans les deux cas).
  2. `REVERSAL_WINDOW_EXPIRED` (409) existe ; le plan fond la fenêtre dépassée dans `REVERSAL_NOT_ALLOWED`.
  3. `QR_TOKEN_INVALID` (422) existe pour le QR client ; `contracts/qr-payments.md` refuse un QR client par
     `409 PAYMENT_REQUEST_NOT_PENDING`.
- `ApprovalAction` : ajouter `SALE_REVERSAL` à l'`enum` et la correspondance « `SALE_REVERSAL` → `reversePayment`
  (back-office, deux personnes, source `BACKOFFICE`) » dans la description.
- `messages.fr.json` et `messages.en.json` : titre et détail pour chaque nouveau code ; détails neutres (le détail de
  `VENDOR_PIN_INVALID` ne dit ni « bloqué » ni « inconnu », NFR-004 ; celui de `PAYMENT_REQUEST_NOT_PENDING` ne dit pas
  lequel des cas, FR-020).

### T005 — `x-process`, génération des types TypeScript et Dart, contrôles du contrat

- **`x-process` : n'en pose aucun.** `tasks.md` prévoit qu'il soit posé par les lots de routes ; or
  `media-isolation.spec.ts` lit toute opération portant `x-process` comme opération de la mission des bracelets
  (`toHaveLength(39)`, un cas exigé par opération). Les routes de terminal de la 5a n'en portent pas : la preuve « route
  servie et gardée » est la matrice des preuves. Point signalé à l'orchestrateur (à trancher avant WP09).
- `npm run generate -w @cashless/contracts` puis `npm run generate:dart -w @cashless/contracts` ; jamais de type écrit
  à la main. `npm run check -w @cashless/contracts` vert. Vérifier `generated/problem-statuses.ts` : chaque nouveau
  code a le statut attendu.
- Contrôles à la main, consignés : chaque nouvelle route de terminal a les trois preuves dans une seule entrée
  `security` ; aucune réponse ne contient `pin`, `pin_hash`, `failed_attempts` ; `pin` et `token` sont `writeOnly` ;
  `operationId` uniques ; `npx @redocly/cli lint` **non** ajouté (aucune dépendance nouvelle) : la validation passe par
  `generate.mjs` et le test `contract-schema.ts`.

## Test Strategy

Ordre : `npm run lint`, `npm run typecheck`, `npm run check -w @cashless/contracts`,
`npm run reset-db -w @cashless/ledger-sql`, `npm run test:pgtap -w @cashless/ledger-sql`, puis
`npm run reset-db -w @cashless/ledger-sql && npm test -w @cashless/api -- --runInBand`. Jamais pgTAP sur une base où
Jest vient de tourner (rejouer `reset-db`). La base partagée appartient à l'orchestrateur : demande-lui la suite Jest
complète, ou lance seulement, en série, `sqlstate-map.spec.ts`, `settings-catalog.spec.ts` et les suites
`end-to-end` qui lisent le contrat (`device-auth-matrix`, `configuration-isolation`, `media-isolation`,
`isolation-sweep`, `device-isolation`). Dans un worktree de lane, créer d'abord les liens
`node_modules/@cashless/{api,contracts,ledger-sql,tag-format}`. Horloge de la base Docker qui peut reculer : aucun
test ne compare l'heure de Node à `now()` sans marge.

## Definition of Done

- Toutes les opérations et tous les compléments de `contracts/openapi-additions.md` sont au contrat ; types TS et Dart
  régénérés ; `npm run check -w @cashless/contracts` vert ; lint, typecheck et tests existants verts.
- Aucun `x-process` ajouté ; aucun tag de `MISSION_TAGS` de `configuration-isolation.spec.ts` sur une opération ajoutée.
- Chaque sous-tâche marquée par `spec-kitty agent tasks mark-status Txxx --status done --mission
  terminaux-paiement-en-ligne-01M52QB9`.
- Compte rendu du lot ajouté en fin de ce fichier : écarts au plan (sens : renforcement ou non), retouches hors carte
  (une ligne de justification chacune), points soumis au porteur ou à l'orchestrateur (les trois contradictions de
  T004, le jeton d'un GET de T003, `x-process`), fichiers à faire relire par une personne (aucun attendu), **critères
  d'acceptation couverts avec leur preuve** (FR-027, C-004 : `npm run check` et noms des opérations ajoutées).

## Risks

- Un tag existant sur une opération ajoutée fait échouer `configuration-isolation` (compte de 48).
- Un `x-process` fait échouer `media-isolation` (compte de 39).
- Une puce de `ProblemCode` mal formée donne un statut vide dans `problem-statuses.ts` : `ProblemException` partirait
  avec un mauvais statut par défaut.
- Un `required` sur `vendor_session_id` dans `ReversalRequest` casserait l'annulation au back-office.

## Reviewer Guidance

Le relecteur distinct vérifie, refus par refus : trois preuves sur `listTerminalVendors`, `openVendorSession`,
`closeVendorSession` ; aucun champ secret en réponse (`Vendor`, `VendorSession`, `PaymentResult`) ; `pin` `writeOnly`
avec motif ; `VENDOR_PIN_INVALID` décrit comme une réponse unique (NFR-004) ; `supervisor_pin_proof` refusé ;
réponses non rejouées de `openVendorSession`, `createPaymentRequest`, `createCustomerQrToken` ; codes et statuts
conformes à `data-model.md` ou contradiction signalée ; types régénérés par le script (diff de `generated/` et
`dart/` cohérent avec le YAML) ; tests du contrat inchangés et verts.
