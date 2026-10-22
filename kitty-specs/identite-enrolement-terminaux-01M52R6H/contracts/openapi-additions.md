# Contrat — modifications de `packages/contracts/openapi.yaml`

## Sécurité

- Nouveau schéma `deviceSignature` (type `apiKey`, en-tête `Signature`, description du profil R-04).
- Routes de terminal : `security: [{ deviceMtls: [], deviceToken: [], deviceSignature: [] }]` (une seule entrée = les
  trois ensemble), au lieu de deux entrées (« ou »).
- `refreshDeviceToken` : `security: [{ deviceMtls: [] }]` plus la preuve de possession du corps.
- Texte de `info.description` : « Un terminal utilise l'un OU l'autre » remplacé par l'exigence des trois preuves
  (ADR-107).

## En-têtes ajoutés aux routes de terminal

`Signature-Input`, `Signature`, `Content-Digest` (obligatoires), `X-Request-Id` (déjà présent, devient obligatoire).

## Schémas modifiés

- `DeviceEnrollmentRequest` : `csr_pem` requis ; `agreement_attestation_chain` ajouté (obligatoire pour Android) ;
  description des défis (R-08) et de l'ordre (code scanné avant la génération des clés) ; Android 12 minimum.
- `DeviceEnrollmentResponse` : `certificate_pem` requis, non nullable.
- `DeviceEnrollmentCodeRequest` : `personal_phone` ajouté, obligatoire, sans défaut.
- `deviceToken` : claims `fid` et `typ` décrits.
- `refreshDeviceToken` : `409` (échange en cours), grâce de 60 s décrite, preuve de possession avec séparateur de domaine.
- `enrollDevice` : `429` décrit (limites de R-16).

## Routes ajoutées (tag « Terminaux »)

`listDevices`, `getDevice`, `suspendDevice`, `reactivateDevice`, `revokeDevice`, `listDeviceEnrollmentCodes`
(`device-lifecycle.md`) ; schémas `Device`, `DeviceStatusChangeRequest`, `DeviceStatusHistoryEntry`, `DevicePage`,
`DeviceEnrollmentCodeSummary`.

## Erreurs ajoutées

`DEVICE_SIGNATURE_INVALID` (401), `DEVICE_SERIAL_IN_USE` (409). `CLOCK_SKEW_TOO_LARGE` (400, existant) servi par les
routes de terminal avec l'en-tête `Date`.

## Génération

Types TypeScript (`packages/contracts/generated/`) et Dart régénérés ; jamais écrits à la main ; la CI vérifie qu'ils
sont à jour.
