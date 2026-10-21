# Contrat — codes d'enrôlement et enrôlement

## `POST /v1/device-enrollment-codes` (`createDeviceEnrollmentCode`)

- Personnes `OPERATOR_ADMIN` (tout le prestataire) ou `ORGANIZER_ADMIN` (ses événements). `Idempotency-Key`
  obligatoire ; route **`transient`** : le code part une fois, le registre ne garde qu'un refus pour un rejeu.
- Entrée : `event_id` (obligatoire : tout terminal est affecté à un événement), `pos_id?`, `app_mode?`, `personal_phone` (obligatoire, sans défaut, R-17), `expires_in_seconds?`
  (300 à 604 800, défaut 86 400).
- Code : 12 caractères de l'alphabet de 32 sans ambiguïté (60 bits), affiché `XXXX-XXXX-XXXX` ; empreinte
  HMAC-SHA256 (`ENROLLMENT_CODE_HMAC_KEY`) du code normalisé.
- Refus : `PAIRED_TPE` → `422 DEVICE_MODE_NOT_ALLOWED` ; `personal_phone` hors `KEYPAD_TPE` →
  `422 DEVICE_MODE_NOT_ALLOWED` ; durée hors bornes → `422 VALIDATION_FAILED` ; objet d'un autre prestataire → `404`.
- Audit : `DEVICE_ENROLLMENT_CODE_CREATED` (sans le code).

## `POST /v1/device-enrollments` (`enrollDevice`)

Sans certificat ni jeton (`security: []`). Le terminal scanne le code **avant** de générer ses clés (défis de R-08).
Limites : 10 essais par code et par heure (tout code bien formé, connu ou non), 30 essais **refusés** par adresse et
par heure → `429` (R-16, ADR-117). Au-delà de la limite, un seul essai et un seul audit `RATE_LIMITED` par fenêtre ;
les `429` suivants n'écrivent rien. Les limites sont lues avant l'étape 1 ; les réussites ne comptent dans aucune
limite. Ordre :

1. Validation du corps (schéma du contrat ; `csr_pem` obligatoire ; Android : `agreement_attestation_chain`
   obligatoire).
2. Clés : `signing_public_key` et `agreement_public_key` sont des SPKI DER P-256 canoniques de 91 octets (point non
   compressé sur la courbe), même forme sur Android et iOS, hachées telles quelles par les défis ; la base garde le
   point de 65 octets extrait de ces octets (`openapi.yaml`).
3. Code : empreinte → ligne non utilisée ; inconnu ou utilisé → `422 ENROLLMENT_CODE_INVALID` (même corps, temps
   comparable) ; expiré → `422 ENROLLMENT_CODE_EXPIRED`. Lecture seule à cette étape.
4. Mode : `PAIRED_TPE`, `TOPUP_DESK` sur iOS, téléphone personnel hors `KEYPAD_TPE` → `422 DEVICE_MODE_NOT_ALLOWED`.
5. Défis de R-08 (Android : un par clé ; iOS : `clientDataHash`).
6. Attestation selon `os` (Android 12+ : les deux chaînes, R-05 ; iOS : R-06) → sinon `422 ATTESTATION_FAILED`.
7. CSR : clé = `signing_public_key`, signature valide → sinon `422 ATTESTATION_FAILED`.
8. Certificat émis par `DeviceCaPort` (R-09) ; jeton de rafraîchissement tiré.
9. `enroll_device(…)` en une transaction : verrouille le code, revérifie usage et expiration, refuse un `serial` actif
   du même prestataire (`409 DEVICE_SERIAL_IN_USE`), crée le terminal, consomme le code, crée la famille de jetons, rend `device_id` et
   `next_seq`.
10. Jeton d'appareil signé ; réponse `201` : `device_id`, `serial`, `certificate_pem`, `access_token`, `token_type`,
    `expires_in`, `refresh_token`, `next_seq`, `server_time`.

Un échec aux étapes 1 à 8 ne consomme pas le code. Un certificat émis pour un enrôlement qui échoue à l'étape 9 n'est
jamais accepté : son empreinte n'est enregistrée nulle part.

Audit : `DEVICE_ENROLLED` (terminal, code, `serial`, système, niveau d'attestation) ; `DEVICE_ENROLLMENT_REFUSED`
(raison, adresse ; sans code ni attestation complète), écrit avec l'essai hors de la transaction annulée, pour **tout**
refus (validation, limite, code inconnu, utilisé, expiré, mode) : dans la chaîne du prestataire du code s'il est connu
en base (même expiré ou utilisé), sinon dans la chaîne de la plateforme (`operator_id` NULL) ; ADR-117.

## Tests imposés

- 20 enrôlements simultanés sur un code : exactement 1 réussite (NFR-008).
- Attestation refusée : code encore utilisable.
- Ré-enrôlement d'un `serial` révoqué de `last_seq = 88` → `next_seq = 89`.
- Même `serial` chez deux prestataires : deux terminaux, `next_seq` de chacun calculé dans son prestataire, aucune
  réponse ne révèle l'autre.
- Android 11 (attestation KeyMint absente) : `422 ATTESTATION_FAILED` ; clé importée (`origin ≠ GENERATED`) : refus.
- 11e essai d'un code dans l'heure : `429`.
- Code inconnu et code utilisé : réponses identiques, écart médian < 20 ms sur 200 essais (NFR-006).
- Aucun code ni jeton en clair dans la base, les journaux, l'audit et le registre d'idempotence (NFR-005).
