# Ajouts au contrat — mission 11b (acceptés par le porteur le 24/11/2026)

Tous les ajouts sont rétrocompatibles. Aucun code d'erreur nouveau (research D10). Chaque ajout entre dans
`tools/contract-stability/contract-baseline.json` avec son empreinte et une ligne « Décision du porteur ». Noms
définitifs fixés dans `interfaces.md` aux tâches.

## A1 — Profil du personnel (FR-001, FR-002)

- `GET /staff/me` → `getStaffProfile`, sécurité : jeton du personnel seulement (refus d'un jeton festivalier et d'un
  terminal).
- `StaffProfile` : `user_id`, `display_name`, `operator_id` (nul pour la plateforme), `assignments[]` de
  `StaffAssignment` : `role`, `scope_type` (PLATFORM, OPERATOR, ORGANIZER, EVENT, MERCHANT), `scope_id` (nul pour
  PLATFORM).

## A2 — Rôles autorisés par opération (FR-003, FR-004)

- Extension `x-roles` sur **chaque** opération : liste de valeurs parmi les 7 rôles du personnel (`PLATFORM_ADMIN`,
  `OPERATOR_ADMIN`, `ORGANIZER_ADMIN`, `MERCHANT_ADMIN`, `SUPERVISOR`, `CASHIER`, `PERSONALIZER`) et les appelants
  non personnels (`VENDOR`, `CUSTOMER`, `DEVICE`, `GATEWAY`, `PUBLIC`).
- **Forme retenue par le porteur le 24/11/2026 : (a)** (contrôle de stabilité : une entrée de référence par ajout) :
  - **(a, recommandé)** `x-roles` sur chaque opération : 227 entrées de référence, produites par un script et une seule
    décision du porteur ; forme naturelle pour un générateur de client.
  - (b) une seule extension de premier niveau `x-operation-roles` (table `operationId` → rôles) : 1 entrée de
    référence, mais l'information est séparée de l'opération.

## A3 — Ventes (FR-005 à FR-007)

- `GET /events/{event_id}/sales` → `listEventSales` : filtres `pos_id`, `merchant_id`, `vendor_id`, `from`, `to`
  (UTC), `status` (`VALID`, `REVERSED`), `cursor`, `limit` (≤ 200, défaut 50). Réponse `SalePage` (`data`,
  `next_cursor`, `has_more`).
- `GET /sales/{transaction_id}` → `getSale` : `SaleDetail`.
- `SaleSummary` : `transaction_id`, `event_id`, `occurred_at`, `amount`, `currency`, `pos_id`, `merchant_id`,
  `vendor_id`, `device_id`, `source` (`ONLINE`, `EDGE_SYNC`, `OFFLINE_SYNC`), `channel` (`NFC`, `MERCHANT_QR`,
  `CUSTOMER_QR`), `status`, `reversal_transaction_id` (facultatif).
- `SaleDetail` = `SaleSummary` + `lines[]` (`line_no`, `item_id`, `label_fr`, `label_en`, `quantity`, `unit_price`,
  `vat_rate_bps`, `line_total`). Aucun identifiant de portefeuille ni donnée du festivalier.

## A4 — Anomalies (FR-008 à FR-010)

- `GET /anomalies` → `listAnomalies` : filtres `event_id`, `kind` (liste fermée), `status` (`OPEN`, `RESOLVED`),
  `from`, `to`, `cursor`, `limit`. Réponse `AnomalyPage`.
- `Anomaly` : `anomaly_id`, `kind`, `status`, `event_id`, `created_at`, `amount`, `currency`, `media_id`,
  `device_id`, `transaction_id`, `classifiable` (booléen), `classification` (facultatif : `reason`, `classified_by`,
  `classified_at`).
- `POST /anomalies/{anomaly_id}/classification` → `classifyAnomaly`, corps `{ reason }` (1 à 500 caractères),
  `Idempotency-Key` exigée. Réponses : `200 Anomaly` ; `422 VALIDATION_FAILED` + `reason =
  ANOMALY_KIND_NOT_CLASSIFIABLE` ; `409 CONFLICT_STATE` (déjà traitée) ; `404`.

## A5 — Recherche (FR-011 à FR-014)

- `GET /search/media?nfc_uid=…` ou `?printed_code=…` (un seul des deux) → `searchMedia` : `MediaSearchResult` (liste,
  0 ou 1 élément) : `media_id`, `status`, `event_id`, `wallet_id`, `printed_number`, soldes du portefeuille
  (`paid_balance`, `promo_balance`, `deposit`).
- `GET /search/wallets/{wallet_id}` → `getWalletOverview` : soldes, statut, bracelets (`media_id`, `status`,
  `printed_number`), `customer_ref` masqué.
- `POST /search/customers` → `searchCustomerByPhone`, corps `{ phone }` (E.164 strict) : `CustomerSearchResult` :
  `masked_phone`, `wallets[]` (même forme que `getWalletOverview`). Rôles : `PLATFORM_ADMIN`, `OPERATOR_ADMIN`,
  `ORGANIZER_ADMIN`, `SUPERVISOR`. `429 RATE_LIMITED` avec `Retry-After`.

## A6 — Modèles de téléphone (FR-015, FR-016)

- `GET /phone-models` → `listPhoneModels` (tous les administrateurs).
- `PUT /phone-models/{manufacturer}/{model}` → `upsertPhoneModel` (`PLATFORM_ADMIN`), corps `{ nfc_level:
  RECOMMENDED | TOLERATED, measured_at }` ; `DELETE` même chemin → `deletePhoneModel`.
- **Ajouts à des schémas existants (exception à C-001 accordée le 24/11/2026 pour les requêtes et les réponses)** :
  - `DeviceEnrollmentRequest`, `HeartbeatRequest` : propriété facultative `device_model { manufacturer, model }`
    (accordé).
  - `DeviceAdminDetail` et l'élément de `DevicePage` : propriétés facultatives `device_model` et `nfc_level`
    (`RECOMMENDED`, `TOLERATED`, `UNTESTED`) (accordé le 24/11/2026).

## Hors contrat

Aucune route existante modifiée hormis les ajouts facultatifs de A6. Aucune écriture au grand livre.
