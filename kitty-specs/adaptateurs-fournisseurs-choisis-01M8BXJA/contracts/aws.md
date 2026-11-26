# Contrat — AWS (IC-06, IC-07)

## Secrets Manager → `PspSecretStore`

| Port | Appel | Erreurs |
|---|---|---|
| `get(binding)` | `GetSecretValue {SecretId: secretRef}` (+ `VersionStage: AWSPREVIOUS` si `previous_valid_until` futur) | référence sans `psp/<holderPartyId>/` → `HOLDER_MISMATCH` avant appel ; `ResourceNotFoundException` → `NOT_FOUND` ; JSON invalide ou fournisseur différent → `REF_INVALID` ; autre → `UNAVAILABLE` |

## KMS → ports de clés (droits par processus inchangés)

| Port | Appel KMS | Sortie |
|---|---|---|
| `MacPort.generateMac` | `GenerateMac` `HMAC_SHA_256` | `Mac` (32 octets) |
| `DataKeyPort.generateDataKey` | `GenerateDataKey` `AES_256` | `Plaintext`, `CiphertextBlob` |
| `DecryptPort.decrypt` | `Decrypt` | `Plaintext` |
| `SignPort.sign` | `Sign` `ECDSA_SHA_256`, `RAW` (≤ 4 096 octets) | signature DER |
| `SignPort.publicKey`, `KeyAdminPort.publicKey` | `GetPublicKey` | SPKI DER |
| `KeyAdminPort.createKey` | `CreateKey` (`HMAC_256`/`GENERATE_VERIFY_MAC`, `SYMMETRIC_DEFAULT`/`ENCRYPT_DECRYPT`, `ECC_NIST_P256`/`SIGN_VERIFY`) | `KeyMetadata.Arn` |
| `KeyAdminPort.disableKey` | `DisableKey` | — |

Tout tampon en clair rendu reste à mettre à zéro par l'appelant (`zeroize.ts`). Erreurs KMS → exception sans
identifiant de clé dans le message.

## S3 Object Lock → `SealExternalCopy`

| Port | Appel | Règle |
|---|---|---|
| `write(seal, hash)` | `PutObject` `Key=<kind>/<id>/<sealNo>`, `ObjectLockMode=COMPLIANCE`, `ObjectLockRetainUntilDate=+SEAL_COPY_RETENTION_DAYS`, `ChecksumAlgorithm=SHA256`, `IfNoneMatch='*'` | 412 → relecture : même empreinte → référence ; sinon erreur d'intégrité |
| `read(ref)` | `GetObject` | `NoSuchKey` → `null` |
