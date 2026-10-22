# Contrat : ajouts et compléments à `openapi.yaml`

Conventions existantes : préfixe `/v1`, snake_case, `problem+json`, `Idempotency-Key` sur toute écriture, trois preuves
(`deviceMtls`, `deviceToken`, `deviceSignature`) sur toute route de terminal, `x-process: public` sur les opérations
servies. Types TypeScript et Dart régénérés (`npm run generate`), jamais écrits à la main.

## Opérations ajoutées

| Opération | Méthode et chemin | Appelant |
|---|---|---|
| `listVendors` | GET /merchants/{merchant_id}/vendors | `MERCHANT_ADMIN`, `OPERATOR_ADMIN` |
| `createVendor` | POST /merchants/{merchant_id}/vendors | idem |
| `getVendor` | GET /vendors/{vendor_id} | idem |
| `setVendorPin` | POST /vendors/{vendor_id}/pin | idem (débloque) |
| `setVendorStatus` | POST /vendors/{vendor_id}/status | idem |
| `listTerminalVendors` | GET /vendor-sessions/vendors | terminal (vendeurs `ACTIVE` du commerçant du point de vente : id et nom) |
| `openVendorSession` | POST /vendor-sessions | terminal (`transient`, `401 VENDOR_PIN_INVALID`, `429` si un essai du terminal est en cours) |
| `closeVendorSession` | DELETE /vendor-sessions/current | terminal |
| `getCatalog` | GET /points-of-sale/{pos_id}/catalog | `ORGANIZER_ADMIN`, `OPERATOR_ADMIN`, `MERCHANT_ADMIN` du point de vente |
| `createCatalogCategory` | POST /points-of-sale/{pos_id}/catalog/categories | gestionnaire du catalogue |
| `updateCatalogCategory` | PATCH /catalog-categories/{category_id} | idem |
| `createCatalogItem` | POST /catalog-categories/{category_id}/items | idem |
| `updateCatalogItem` | PATCH /catalog-items/{item_id} | idem |
| `getCatalogVersion` | GET /points-of-sale/{pos_id}/catalog/versions/{version} | idem |
| `setCatalogPolicy` | PUT /points-of-sale/{pos_id}/catalog-policy | `ORGANIZER_ADMIN`, `OPERATOR_ADMIN` |

Schémas : `Vendor` (sans PIN ni empreinte ; `locked` booléen), `VendorCreate` (`display_name`, `pin` en
`writeOnly`), `VendorSession` (`vendor_session_id`, `vendor_id`, `vendor_display_name`, `expires_at`),
`CatalogCategory`, `CatalogItemAdmin`, `CatalogVersion`.

## Compléments

- `PaymentRequestBody`, `ReversalRequest`, corps de `createPaymentRequest` : `vendor_session_id` (uuid, requis depuis
  un terminal).
- `ReversalRequest.supervisor_pin_proof` : refusé (`422`) ; la preuve du `SUPERVISOR` passe par l'en-tête
  `X-Approval-Token` seulement (empreinte de requête non circulaire, A8). Annulation au back-office : action
  d'approbation `SALE_REVERSAL` ajoutée à `ApprovalAction` (et à la liste fermée de la base, migration).
- `IdempotencyKey` : `<serial>` égal au `serial` du terminal authentifié (description complétée) ; `409
  DEBIT_AUTHORITY_MOVING` et `DEBIT_AUTHORITY_EDGE` documentés comme non enregistrés (même clé rejouable).
- `createPaymentRequest`, `createCustomerQrToken`, `openVendorSession` : réponse non rejouée (renvoi de la même clé :
  `409`), pour qu'aucun jeton ne soit gardé (A3).
- `getPaymentRequest`, `cancelPaymentRequest` : côté festivalier, le jeton est exigé (A10, A24).
- `SaleLine` : `product_id` requis depuis une caisse à catalogue ; `label` réservé aux relevés.
- `PaymentResult` : `vendor` (`vendor_id`, `display_name`), `lines`, `channel`.
- `DeviceConfig.catalog.version` : servi (déjà au schéma).
- Problèmes ajoutés à `ProblemCode` : `ENROLLMENT_EVENT_CLOSED`, `VENDOR_SESSION_INVALID`, `VENDOR_PIN_INVALID`,
  `SALE_LINES_INVALID`, `REVERSAL_NOT_ALLOWED` (`ALREADY_REVERSED`, `PAYMENT_REQUEST_NOT_PENDING` existent).
- `createDeviceEnrollmentCode`, `enrollDevice` : `422 ENROLLMENT_EVENT_CLOSED` documenté (OP-N74).
- `x-process: public` sur les 8 opérations de paiement servies et sur les opérations ajoutées.
- `createKycVerification`, `revokeKycVerification` : inchangées, non servies (mission 10).
