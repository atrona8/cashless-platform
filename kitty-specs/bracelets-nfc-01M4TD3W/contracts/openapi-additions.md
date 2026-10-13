# Contrat — routes ajoutées à `openapi.yaml`

Conventions de la mission 3 : `problem+json`, `Idempotency-Key` sur toute écriture, `X-Request-Id`, `Accept-Language`,
listes paginées par curseur, `202` pour une action à deux. Le prestataire vient du chemin et de l'identité.

## Back-office (API publique, `humanBearer`)

| Opération | Méthode et chemin | Rôle | Note |
|---|---|---|---|
| `listTagKeys` | `GET /operators/{operator_id}/tag-keys` | `OPERATOR_ADMIN` | sans référence KMS complète |
| `requestTagKey` | `POST /operators/{operator_id}/tag-keys` | `OPERATOR_ADMIN` | `202`, action `TAG_KEY_CREATE` |
| `getTagKey` | `GET …/tag-keys/{key_index}` | `OPERATOR_ADMIN` | clé, versions de clé de données, travaux |
| `requestDekRotation` | `POST …/tag-keys/{key_index}/dek-rotations` | `OPERATOR_ADMIN` | `202`, `TAG_DEK_ROTATE` |
| `requestTagKeyRetirement` | `POST …/tag-keys/{key_index}/retirement` | `OPERATOR_ADMIN` | `202`, `TAG_KEY_RETIRE` |
| `listTagKeyJobs` | `GET …/tag-key-jobs` | `OPERATOR_ADMIN` | avancement |
| `listTagKeyCheckRuns` | `GET …/tag-key-check-runs` | `OPERATOR_ADMIN` | comptes rendus du contrôle quotidien |
| `listMediaBatches` | `GET …/media-batches` | `ORGANIZER_ADMIN`, `OPERATOR_ADMIN` | filtres organisateur, événement, statut |
| `createMediaBatch` | `POST …/media-batches` | `ORGANIZER_ADMIN` | |
| `getMediaBatch` | `GET …/media-batches/{batch_id}` | lecteurs de l'organisateur | |
| `updateMediaBatch` | `PATCH …/media-batches/{batch_id}` | `ORGANIZER_ADMIN` | lot `ORDERED` seulement |
| `setMediaBatchStatus` | `POST …/media-batches/{batch_id}/status` | `ORGANIZER_ADMIN` | motif obligatoire pour `SUSPENDED` |
| `getMediaBatchInventory` | `GET …/media-batches/{batch_id}/inventory` | lecteurs de l'organisateur | vue `batch_inventory` |
| `issueClaimCodeOrder` | `POST …/media-batches/{batch_id}/claim-code-order` | `ORGANIZER_ADMIN` | une fois ; `text/csv` |
| `importClaimCodeAssociations` | `POST …/media-batches/{batch_id}/claim-code-associations` | `ORGANIZER_ADMIN` | fichier code ↔ UID |
| `closeMediaBatch` | `POST …/media-batches/{batch_id}/closure` | `ORGANIZER_ADMIN` | par tranches ; rend ce qui reste |
| `catchUpBatchPreload` | `POST …/media-batches/{batch_id}/preload-catchup` | `ORGANIZER_ADMIN` | par tranches |
| `listMedia` | `GET …/media` | lecteurs de l'organisateur | filtres lot, statut |
| `getMediaAdmin` | `GET …/media/{media_id}` | lecteurs de l'organisateur | avec historique des statuts |
| `blacklistMedia` | `POST …/media/{media_id}/blacklist` | `SUPERVISOR` | motif |
| `requestMediaReinstatement` | `POST …/media/{media_id}/reinstatement` | `SUPERVISOR` | `202`, `MEDIA_REINSTATE` |
| `reportMediaLost` | `POST …/media/{media_id}/loss` | `CASHIER`, `SUPERVISOR` | `SUSPENDED` |
| `recoverMedia` | `POST …/media/{media_id}/recovery` | `CASHIER`, `SUPERVISOR` | `recover_media` |

## Poste de personnalisation (processus de personnalisation, `humanBearer`, rôle `PERSONALIZER`)

| Opération | Méthode et chemin | Note |
|---|---|---|
| `registerPersonalizedMedia` | `POST /operators/{operator_id}/media-personalizations` | rend l'identifiant du bracelet et le mot de passe sous enveloppe pour la clé à usage unique du poste |
| `associateClaimCode` | `POST /operators/{operator_id}/media-personalizations/{media_id}/claim-code` | code scanné |

## Autres changements

- Rôle `PERSONALIZER` ajouté à l'énumération des rôles ; `ApprovalAction` étendue de `TAG_KEY_CREATE`,
  `TAG_DEK_ROTATE`, `TAG_KEY_RETIRE`, `MEDIA_REINSTATE`.
- Extension `x-process` sur chaque opération de la mission (`public`, `tag-keys`, `personalization`) : elle documente
  quel processus la sert et alimente le test qui vérifie que chaque opération est servie par le bon processus.
- Aucune route existante n'est modifiée. Une contradiction relevée en cours de route est signalée (§0.3).
