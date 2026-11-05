# Contrat : ajouts et corrections de `openapi.yaml`

Types TS et Dart régénérés (`npm run check -w @cashless/contracts`). Codes nouveaux ajoutés aux messages fr/en.

## Opérations ajoutées (tag `Hors ligne`, `humanBearer`, `Idempotency-Key` sur `PUT`, `404` neutre hors périmètre)

| Méthode et chemin | `operationId` | Rôles |
|---|---|---|
| `GET /operators/{operator_id}/offline-ceiling` | `getOfflineCeiling` | `OPERATOR_ADMIN` ; lecture `ORGANIZER_ADMIN` du prestataire |
| `PUT /operators/{operator_id}/offline-ceiling` | `setOfflineCeiling` | `OPERATOR_ADMIN` |
| `GET` / `PUT /organizers/{organizer_id}/offline-policy` | `getOrganizerOfflinePolicy` / `setOrganizerOfflinePolicy` | lecture `ORGANIZER_ADMIN`, `OPERATOR_ADMIN` ; écriture `ORGANIZER_ADMIN` |
| `GET` / `PUT /events/{event_id}/offline-policy` | `getEventOfflinePolicy` / `setEventOfflinePolicy` | idem |
| `GET` / `PUT /devices/{device_id}/offline-policy` | `getDeviceOfflinePolicy` / `setDeviceOfflinePolicy` | idem ; `OPERATOR_ADMIN` peut couper un terminal |
| `GET /events/{event_id}/offline-risk` | `getEventOfflineRisk` | `ORGANIZER_ADMIN`, `OPERATOR_ADMIN` |

`PUT` : corps `OfflinePolicyLevel` + `version` attendue (`409 CONFLICT_STATE` si elle diffère) ; corps vide = niveau
effacé ; `cash_topup_offline: true` → `422 VALIDATION_FAILED`. Réponse `OfflinePolicyLevelView` avec `effective`
(terminal) et `risk` (événement).

Schémas : `OfflinePolicyLevel {offline_enabled?, max_per_sale?, max_per_media_per_device?, max_total_per_device?,
max_snapshot_age_seconds?, cash_topup_offline? (false seulement)}` (nul = hérite) ; `OfflinePolicyLevelView {level,
scope_id, policy, version, updated_at, updated_by, effective?, risk?}` ; `OfflineRisk {event_id, currency,
max_total_risk, offline_devices, devices[{device_id, serial, max_total_per_device, capped}], computed_at}`.

## Corrections d'opérations et de schémas existants

| Élément | Correction | Raison |
|---|---|---|
| `OfflineBatch.signature`, `OfflineSnapshot.signature` | ECDSA **DER**, base64 standard | R-07, exemple existant en DER |
| `WrappedKey.alg` | `ECDH-ES+HKDF-SHA256+A256GCM`, champ `iv` ajouté | R-08 |
| `OfflineSnapshot.pwd_pack_key` | requis dès qu'une entrée a un mot de passe | protocole §4.1-4 |
| `removed_token_hashes` | toujours présent (vide pour un `FULL`) | empreinte stable |
| `getOfflineSnapshot` | en-tête `X-Snapshot-Latest` ; `409 CONFLICT_STATE` + `Retry-After` (pas encore prêt) ; description de la chaîne de versions ; plus de `409 SNAPSHOT_VERSION_UNKNOWN` (un `FULL` est servi) | R-05 |
| `ackOfflineSnapshot` | `409 SNAPSHOT_VERSION_UNKNOWN` (version non servie à ce terminal, empreinte différente) ; idempotent | R-09 |
| `submitOfflineBatch` | `409 BATCH_IN_PROGRESS` + `Retry-After` au renvoi pendant le traitement ; `400 VALIDATION_FAILED` (lot vide, série, grand livre, époque d'en-tête) ; `409 DEBIT_AUTHORITY_MOVING` ; `413` pour > 1 Mio | R-10 |
| `getOfflineBatchResult` 202 | `$ref: headers/Retry-After` | R-11 |
| `OfflineOperationResult.retryable` | vrai seulement pour `INSUFFICIENT_FUNDS_RETRY` | §7.1-9 |
| `OfflineOperationResult.effect` | `DUPLICATE` → `LEDGER_WRITTEN` + `transaction_id` | registre |
| `OfflineOperation.type` | `TOPUP_CASH` toujours `REJECTED OFFLINE_NOT_ALLOWED` (porteur) | R-02 |
| Numéros (`seq`, `seq_from`, `seq_to`, `reverses_seq`, `contiguous_acked_seq`, `missing_seqs[]`) | `maximum: 9007199254740991` | R-14 |
| `DeviceConfig.snapshot_keys` | au plus deux ; `algorithm` enum `[ECDSA_P256_SHA256]` | R-07 |
| `OfflinePolicy.cash_topup_offline` | toujours `false` | R-02 |
| `OfflinePolicy.capped` | ne concerne que les trois montants | S:828 |
