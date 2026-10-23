# Compte rendu du lot WP01 — Contrat d'API et types

Lane : `.worktrees/terminaux-paiement-en-ligne-01M52QB9-lane-a`, commit `60b24a43`
(`feat(WP01): …`). T001 à T005 marquées `done`. Aucun `move-task`. Aucune base créée.

## Reprise
L'implémenteur précédent avait écrit l'essentiel (openapi.yaml +1328 lignes, types régénérés). Vérifié
opération par opération contre `contracts/openapi-additions.md` et T001 à T005. Ajouts de cette reprise :
- `messages.fr.json` / `messages.en.json` : il manquait les 4 codes nouveaux (`ENROLLMENT_EVENT_CLOSED`,
  `VENDOR_SESSION_INVALID`, `VENDOR_PIN_INVALID`, `SALE_LINES_INVALID`), qui auraient fait échouer
  `sqlstate-map.spec.ts` (« messages »). Ajoutés. Détail de `VENDOR_PIN_INVALID` : « Le code PIN est refusé. » (ne dit
  ni bloqué ni inconnu, NFR-004). Détail de `PAYMENT_REQUEST_NOT_PENDING` rendu neutre : « La demande de paiement
  n'est plus payable. » (l'ancien texte énumérait payée, annulée, expirée ; FR-020).
- `payPaymentRequest` : description complétée (attribution au vendeur de la session de la demande, terminal `ACTIVE`,
  session encore ouverte ; inconnue, payée, annulée, expirée ou mauvais jeton → `409 PAYMENT_REQUEST_NOT_PENDING`,
  réponse unique), d'après `contracts/qr-payments.md` §2.
- `payPaymentRequest.token` : `writeOnly: true` et description (T005 : « `token` `writeOnly` »). Renforcement.
- Régénération TS et Dart.

## Opérations ajoutées (FR-027, C-004)
Tag `Vendeurs` : listVendors, createVendor, getVendor, setVendorPin, setVendorStatus (humanBearer),
listTerminalVendors, openVendorSession, closeVendorSession (deviceMtls + deviceToken + deviceSignature dans une
seule entrée `security`). Tag `Catalogue` : getCatalog, createCatalogCategory, updateCatalogCategory,
createCatalogItem, updateCatalogItem, getCatalogVersion, setCatalogPolicy (humanBearer).
Compléments : createPayment, getPayment, reversePayment (+ `ApprovalToken`, `202`), createPaymentRequest,
getPaymentRequest, payPaymentRequest, cancelPaymentRequest, createCustomerQrToken, createDeviceEnrollmentCode,
enrollDevice, `IdempotencyKey`, `SaleLine`, `PaymentRequestBody`, `PaymentResult` (+ `SaleVendor`,
`SaleLineResult`), `ReversalRequest`, `DeviceConfig.catalog`, `ProblemCode`, `ApprovalAction` (`SALE_REVERSAL`),
réponses `Unauthorized` et `Conflict`. createKycVerification et revokeKycVerification inchangées.

## Écarts au plan (sens)
1. `x-process` : aucun posé (arbitrage du 22/10) ; `openapi-additions.md` en prévoyait. Sans effet de sécurité.
2. Clé d'idempotence de `openVendorSession` et `closeVendorSession` : UUID (portée `device:<device_id>:`), réponse non
   conservée, renvoi → `409 CONFLICT_STATE` (arbitrage). Plus strict que `vendors.md` (« un renvoi refait l'essai »).
3. Jeton du festivalier pour `getPaymentRequest` / `cancelPaymentRequest` : en-tête `X-Payment-Request-Token`
   (paramètre `PaymentRequestToken`), jamais en chaîne de requête ni dans le chemin (arbitrage). Jeton absent ou faux,
   ou demande inconnue : `404`, réponse identique (choix du contrat, neutre ; `payPaymentRequest` reste en `409`
   `PAYMENT_REQUEST_NOT_PENDING` comme le dit `qr-payments.md`). Renforcement.
4. `payPaymentRequest` : `PAYMENT_REQUEST_EXPIRED` (409, existant) n'est plus nommé pour cette route ; l'expiration
   tombe dans `PAYMENT_REQUEST_NOT_PENDING` (FR-020, réponse unique). Renforcement (moins d'information).
5. Catalogue, événement `CLOSED` : `409 CONFLICT_STATE` (proposition de T002) ; à confirmer par WP03/WP10 s'ils lèvent
   un autre code.

## Contradictions §0.3 (le contrat existant prime ; à corriger côté data-model / fiches)
1. `REVERSAL_NOT_ALLOWED` : contrat 422 ; `data-model.md` et `payments.md` disent `CL036` → 403. Gardé 422, `CL036`
   ajouté à la puce (`generated/problem-statuses.ts` : 422).
2. `REVERSAL_WINDOW_EXPIRED` (409) existe ; le plan fond la fenêtre dépassée dans `REVERSAL_NOT_ALLOWED`. Contrat
   gardé : fenêtre dépassée → `409 REVERSAL_WINDOW_EXPIRED` (description de reversePayment).
3. `QR_TOKEN_INVALID` (422) pour le QR client ; `qr-payments.md` refuse par `409 PAYMENT_REQUEST_NOT_PENDING`. Contrat
   gardé : `422 QR_TOKEN_INVALID`, réponse unique (description de createPayment).
- `MEDIA_BLOCKED` (`CL038`) et `WALLET_BLOCKED` (`CL039`) : présents au contrat et dans les messages ; SQLSTATE
  ajoutés aux puces.

## Points pour l'orchestrateur
- `closeVendorSession` est la première route de terminal en `DELETE`. `device-auth-matrix.spec.ts` (« non servies :
  404 ») et `TerminalClient.request` de `device-e2e.ts` sont typés `'GET' | 'POST'` : à l'exécution le `DELETE` passe
  (cast) et doit répondre 404 tant que la route n'est pas servie ; à vérifier au Jest complet, et WP09 devra élargir
  le type de méthode et la signature (corps vide) du client de test.
- Avertissement préexistant de `generate.mjs` : `LATE_CLAIM_INVALID` sans puce dans `ProblemCode` (statut tiré du
  contrat : 409). Hors lot, non modifié.
- Correspondance SQLSTATE → problème (`CL031`–`CL037`) dans `sqlstate-map` de l'API : hors des fichiers du lot (WP04 ou
  lots de routes).

## Retouches hors carte
Aucune (seuls `packages/contracts/**` et les deux catalogues de messages). Liens `node_modules/@cashless/*` créés dans
la lane, ignorés par git, non commités.

## Fichiers à faire relire par une personne
Aucun attendu (pas de clé, pas de droit de base, pas de cryptographie).

## Critères d'acceptation et preuves
- FR-027 / C-004 : `npm run check -w @cashless/contracts` → « types à jour », « types Dart à jour » (399 modèles,
  `dart analyze` : No issues found). Types produits par `npm run generate` et `generate:dart`, aucun écrit à la main.
- `generated/problem-statuses.ts` : ENROLLMENT_EVENT_CLOSED [422], VENDOR_SESSION_INVALID [409],
  VENDOR_PIN_INVALID [401], SALE_LINES_INVALID [422] ; PROBLEM_CODES 91 → 95.
- C-003 : contrôle par script (yaml) : les 3 routes de terminal ajoutées ont
  `[{deviceMtls, deviceToken, deviceSignature}]` (une seule entrée) ; les 12 autres héritent de `humanBearer`.
- Secrets : parcours des schémas de toutes les réponses : aucun champ `pin`, `pin_hash`, `failed_attempts` lisible ;
  `pin` `writeOnly` + `^[0-9]{6}$` dans VendorCreate, VendorPinChange, VendorSessionOpen ; `token` de
  payPaymentRequest `writeOnly`.
- `operationId` uniques : oui. `x-process` : 39 (inchangé). Aucune opération ajoutée ne porte un tag de
  `MISSION_TAGS` ; tags `Vendeurs` et `Catalogue` déclarés en tête. Aucun chemin ajouté ne correspond à
  `MISSION_PATHS`.
- C-007 : `payment_intent_id` refusé en V1 (`422 DEVICE_MODE_NOT_ALLOWED`, description de PaymentRequestBody,
  inchangée).
- `npm run lint` → 0 ; `npm run typecheck` → 0 ; `prettier --check` (generated, messages) → conforme.
- `npm test -w @cashless/api -- test/unit` (sans base) → 39 suites, 967 tests passés (dont `sqlstate-map.spec.ts`,
  bloc « messages »).
- Non lancés (base partagée, à l'orchestrateur) : Jest complet de l'API, `device-auth-matrix`,
  `configuration-isolation`, `media-isolation`, `isolation-sweep`, `device-isolation`, `settings-catalog`, pgTAP.
