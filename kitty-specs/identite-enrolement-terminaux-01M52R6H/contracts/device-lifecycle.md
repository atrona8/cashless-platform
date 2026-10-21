# Contrat — cycle de vie, configuration, battement de cœur

## Back-office des terminaux (routes ajoutées au contrat, personnes `OPERATOR_ADMIN` ou `ORGANIZER_ADMIN`)

| Opération | Route | Règle |
|---|---|---|
| `listDevices` | `GET /v1/devices` | filtres `event_id`, `pos_id`, `status`, `app_mode` ; pagination par curseur ; `ORGANIZER_ADMIN` : terminaux de ses événements |
| `getDevice` | `GET /v1/devices/{device_id}` | statut, affectation, système, version, niveau d'attestation, dernière présence, fin du certificat, historique des statuts ; jamais de clé ni d'empreinte |
| `suspendDevice` | `POST /v1/devices/{device_id}/suspend` | `Idempotency-Key`, `reason` obligatoire ; `ACTIVE` seulement |
| `reactivateDevice` | `POST /v1/devices/{device_id}/reactivate` | `Idempotency-Key`, `reason` ; `SUSPENDED` seulement |
| `revokeDevice` | `POST /v1/devices/{device_id}/revoke` | `Idempotency-Key`, `reason` ; `ACTIVE` ou `SUSPENDED` ; familles de jetons révoquées dans la même transaction |
| `listDeviceEnrollmentCodes` | `GET /v1/device-enrollment-codes` | codes non expirés et non utilisés : portée, auteur, expiration ; jamais le code |

Transition interdite → `409 CONFLICT_STATE`. Autre prestataire ou hors périmètre → `404`. Une personne seule suffit
(hypothèse A2 confirmée). Audit de chaque transition.

## `GET /v1/device/config` (`getDeviceConfig`, `allowSuspended`)

Schéma `DeviceConfig` du contrat. Contenu dans cette mission : `research.md` R-10. `config_id` =
`device_config_served.id` (`openapi.yaml`) ; ETag = SHA-256 du contenu canonique (JCS) hors `server_time`, qui change
aussi avec le statut du terminal (ADR-118) ; `If-None-Match` égal → `304`.
Chaque configuration servie est enregistrée par `record_config_served` ; depuis la migration 0029 (WP18, ADR-118),
la fonction refuse un terminal `REVOKED` (`42501`) et une `config_version` inconnue, d'un autre prestataire ou de
niveau `PLATFORM` (`P0002`), sans rien écrire (`tests_config_served_guard.sql`).

## `POST /v1/device/heartbeat` (`postDeviceHeartbeat`, `allowSuspended`)

`record_device_heartbeat` : `last_seen_at`, `app_version`. Aucun numéro de séquence consommé. Réponse : `server_time`,
`config_etag`, `debit_authority` (R-10), `snapshot_version` (NULL).

## Ce que fait chaque statut

| Route | `ACTIVE` | `SUSPENDED` | `REVOKED` |
|---|---|---|---|
| configuration, battement de cœur | oui | oui | `403 DEVICE_REVOKED` |
| lecture de bracelet, mot de passe d'un bracelet, toute opération | oui | `403 DEVICE_SUSPENDED` | `403 DEVICE_REVOKED` |
| rafraîchissement | oui | `403 DEVICE_SUSPENDED` | `403 DEVICE_REVOKED` |

Les lots hors ligne (`allowSuspended`) viennent avec la mission 7.

## Borne iOS (OP-N64)

`POST /media/auth-keys` refuse un terminal `os = IOS` (`422 DEVICE_MODE_NOT_ALLOWED`, statut de `openapi.yaml`,
confirmé par le porteur le 20/10/2026) ; un test le prouve et échoue si la borne s'élargit.
