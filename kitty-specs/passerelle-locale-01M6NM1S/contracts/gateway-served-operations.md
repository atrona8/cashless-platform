# Contrat : les 16 opérations servies par la passerelle

La passerelle sert, sur le réseau du site, exactement les opérations de `openapi.yaml` marquées `x-edge-available: true`
(FR-010), avec les mêmes chemins, les mêmes formats et les mêmes erreurs qu'au central. Aucune route n'est ajoutée. Le compte
de 16 a été refait sur le fichier au commit `d2a7c538` (lignes de la marque : 429, 496, 630, 711, 1184, 1261, 1350, 1486,
1965, 2066, 2124, 2586, 4360, 4505, 4602, 4764).

Les données répliquées citées viennent de l'état copié par le flux : `wallets`, `media` (existants), `edge_seq_applied`, `device_seq_acked`, `pwd_pack_key`
et le bloc `reference` (`replication-page-additions.yaml`, seul schéma du flux). Le nom de chaque donnée est celui de ce fichier.

## Preuves exigées sur toute opération de terminal

Les trois preuves du contrat (`deviceMtls`, `deviceToken`, `deviceSignature`), vérifiées par la passerelle sans le central :

1. **Certificat** (`deviceMtls`) : chaîne vérifiée contre l'autorité des terminaux ; empreinte égale à
   `reference.devices[].cert_sha256`.
2. **Jeton d'appareil** (`deviceToken`) : ES256, `kid` de la clé propre de la passerelle (décision 2 du porteur : jetons valables sur
   elle seule, refusés au central, test) ; seuls ses propres `kid` sont acceptés (les clés du central ne sont pas répliquées : un jeton du
   central reçoit `401` et le terminal rafraîchit) ; `cnf.jkt` égal à `devices[].public_key`.
3. **Signature de requête** (`deviceSignature`, RFC 9421) : clé `devices[].public_key` ; `@authority` égal à l'adresse de la
   passerelle (`edge_base_url`), ce qui empêche le rejeu d'une requête entre central et passerelle ; nonce anti-rejeu dans un
   registre local ; `created` dans la tolérance d'horloge, mesurée sur l'horloge de la passerelle.

Après les preuves : terminal relu dans la copie (`status` ; `SUSPENDED` et `REVOKED` refusent comme au central :
`403 DEVICE_SUSPENDED`, `403 DEVICE_REVOKED`). Échec d'une preuve : `401` sans dire laquelle (`UNAUTHENTICATED` ou
`DEVICE_SIGNATURE_INVALID`).

**Personne au guichet** (`staffBearer`, en-tête `X-Staff-Authorization`) sur `activateMedia`, `takeDeposit`,
`createCashTopup` : jeton OIDC vérifié avec les clés publiques du serveur d'identité (copie tenue par la passerelle), puis
`reference.staff[]` relu (prestataire, `status = ACTIVE`, rôle `CASHIER` ou `SUPERVISOR` de l'événement). Jeton expiré :
toléré sur la passerelle seulement, aux conditions de la décision 3 du porteur (bien signé ; personne qui a ouvert la session de
caisse, `cash_sessions[].opened_by` ; même terminal ; session `OPEN` ; émis avant la bascule ET encore valable à la bascule
(`exp >= activated_at`, A15) ; 12 h au plus après la bascule ; personne encore habilitée dans l'état répliqué), chaque usage audité
et versé au central par `EdgeSyncBatch.staff_token_audit` (décision 18). Toute autre condition : refus comme un jeton expiré au central.

**Exclusion** : la passerelle ne débite (ventes, annulations, recharges, activations, cautions, lots) que si son état est
`ACTIVE`, que l'accusé `200` de la bascule est reçu et, quand la route déclare l'en-tête `X-Authority-Epoch` (voir note 1),
qu'il égale l'époque détenue. Époque supérieure : `409 STALE_AUTHORITY_EPOCH` et arrêt persistant des débits.

## Tableau des opérations

Légende de la colonne « Écrit en file » : type de `OfflineOperationType` de `EdgeSyncOperation` avec `authorized_mode`.
« Aucune » : lecture ou état local sans décision à transmettre. Toute entrée écrite en file reçoit un `edge_seq` continu et
chaîné, dans la transaction locale qui écrit l'effet, avant la réponse (FR-014, NFR-004).

| # | `operationId` | Route | Preuves de plus | Données répliquées lues | Écrit en file | Refus propres à la passerelle |
|---|---|---|---|---|---|---|
| 1 | `refreshDeviceToken` | `POST /device-tokens/refresh` | `deviceMtls` seul ; jeton de rafraîchissement et preuve de possession (signature du terminal) | `devices[]` (statut, clé de signature, empreinte, `token_family.refresh_token_sha256_current`) | Aucune ; audit local ; **sans rotation** (décision 11) | `401 REFRESH_TOKEN_INVALID`, `403 DEVICE_SUSPENDED` / `DEVICE_REVOKED` (note 2) |
| 2 | `getDeviceConfig` | `GET /device/config` | 3 preuves ; `allowSuspended` | `devices[]`, `device_configs[]` (`config_id`, politique), `event`, `catalogs[]`, état d'autorité local | Aucune | `304` sur `If-None-Match` ; sinon aucun |
| 3 | `postDeviceHeartbeat` | `POST /device/heartbeat` | 3 preuves | `devices[]`, `event.terminal_settings`, version de snapshot de la passerelle | Aucune ; met à jour l'état local du terminal | `400` corps invalide |
| 4 | `getDeviceSeqStatus` | `GET /device/seq-status` | 3 preuves ; servie à un terminal `SUSPENDED` | `device_seq_acked` (base, sur la dernière page de chaque passe), puis résultats de `submitEdgeSyncBatch` | Aucune | `403 DEVICE_REVOKED` ; jamais un accusé provisoire (FR-026) |
| 5 | `getMediaAuthKey` | `POST /media/auth-keys` | 3 preuves | `media[].pwd_pack_enc`, `reference.unassigned_media[].pwd_pack_enc`, `pwd_pack_key`, `devices[].agreement_public_key` | Aucune | `404 MEDIA_UNKNOWN` (délai constant), `429` (note 3) |
| 6 | `createTap` | `POST /taps` | 3 preuves | `media`, `media_refs`, `unassigned_media`, `wallets`, `devices[]` | Aucune (le `tap_id` est local) | résultat `BLOCKED`, `NOT_ACTIVATED`, `UNKNOWN`... en `200` ; `409 TAP_UNUSABLE` |
| 7 | `activateMedia` | `POST /media/activations` | 3 preuves + `staffBearer` ; `Idempotency-Key` `<serial>:<seq>` = clé d'origine (A10) | `unassigned_media`, `media_refs`, `event.activation_modes`, `staff`, `cash_sessions` si caution | `ACTIVATION`, `EDGE_ONLINE`, `edge_guichet` (`media_id`, `wallet_id` nouveau si activation anonyme, `event_id`, `channel = DESK`) ; avec caution espèces : `DEPOSIT_CASH` à la suite, clé `<serial>:<seq>#deposit` | `409 DEBIT_AUTHORITY_EDGE` si frais d'activation sur solde ou caution `FROM_BALANCE` ; `422 ACTIVATION_MODE_NOT_ALLOWED` ; `409 CONFLICT_STATE` sans session `OPEN` pour une caution espèces |
| 8 | `takeDeposit` | `POST /media/{media_id}/deposit` | 3 preuves + `staffBearer` ; `Idempotency-Key` `<serial>:<seq>` = clé d'origine | `media_refs`, `cash_sessions`, `staff`, `devices[].cash_desk_account_id` | `DEPOSIT_CASH`, `EDGE_ONLINE`, `edge_guichet` (`media_id`, `deposit_amount`, `cash_desk_account_id` = celui de la session du terminal, vérifié au central) | `409 DEBIT_AUTHORITY_EDGE` si `FROM_BALANCE` ou `payment.method` autre que `CASH` ; `409 CONFLICT_STATE` sans session `OPEN` du terminal ou `cash_session_id` autre ; idempotent si déjà `HELD` |
| 9 | `createPayment` | `POST /payments` | 3 preuves ; `X-Authority-Epoch`, `Idempotency-Key` `<serial>:<seq>` | `wallets` (solde, statut), `media` (statut, lot), `vendor_sessions`, `vendors`, `catalogs`, `event`, `devices[].pos` | `PURCHASE`, `EDGE_ONLINE`, avec `edge_decision` ; un refus final (`INSUFFICIENT_FUNDS`, `MEDIA_BLOCKED`...) consomme son numéro : `VOID` (note 4) | `409 STALE_AUTHORITY_EPOCH` ; `409 DEBIT_AUTHORITY_MOVING` pendant `RELEASING` ; paiement par `customer_qr_token` : `409 DEBIT_AUTHORITY_EDGE` ; `409 VENDOR_SESSION_INVALID` ; `422 SALE_LINES_INVALID` ; `422 MEDIA_BLOCKED` / `WALLET_BLOCKED` ; `INSUFFICIENT_FUNDS` (avec le solde disponible), `409 EVENT_CLOSING` |
| 10 | `getPayment` | `GET /payments/{transaction_id}` | 3 preuves (garde exclusive terminal) | écritures locales du terminal | Aucune | `404` neutre hors de ses propres ventes |
| 11 | `reversePayment` | `POST /payments/{transaction_id}/reversal` | 3 preuves ; `X-Authority-Epoch`, `Idempotency-Key` ; `X-Approval-Token` si superviseur (note 5) | écritures locales (vente d'origine), `vendor_sessions`, `vendors`, `event.terminal_settings.reversal_window_minutes` | `REVERSAL`, `EDGE_ONLINE` (`reverses_transaction_id` ou `reverses_seq`) | `409 ALREADY_REVERSED` ; `422 REVERSAL_NOT_ALLOWED` ; `409 REVERSAL_WINDOW_EXPIRED` ; `409 VENDOR_SESSION_INVALID` ; `409 STALE_AUTHORITY_EPOCH` ; `403 APPROVAL_INVALID` |
| 12 | `createCashTopup` | `POST /topups/cash` | 3 preuves + `staffBearer` ; `X-Authority-Epoch`, `Idempotency-Key` | `cash_sessions`, `staff`, `wallets` (`kyc_verified`, `topup_month_paid`), `event.wallet_limits`, `media_refs` | `TOPUP_CASH`, `EDGE_ONLINE` (note 6) | `409 CONFLICT_STATE` sans session `OPEN` répliquée avant la bascule (rien n'est écrit) ; `422 WALLET_LIMIT_EXCEEDED`, `422 MONTHLY_TOPUP_LIMIT_EXCEEDED` ; `403` terminal non `TOPUP_DESK` ; `409 STALE_AUTHORITY_EPOCH` |
| 13 | `getOfflineSnapshot` | `GET /offline-snapshots/current` | 3 preuves | `media`, `wallets`, `pwd_pack_key`, `devices[].agreement_public_key`, blocages reçus | Aucune ; produit un snapshot signé par la clé propre de la passerelle (`owner = EDGE`, déclarée dans `config.snapshot_keys`) | `304`, `403 OFFLINE_NOT_ALLOWED`, `403 DEVICE_SUSPENDED`, `409 CONFLICT_STATE` + `Retry-After` |
| 14 | `ackOfflineSnapshot` | `POST /offline-snapshots/ack` | 3 preuves | version et empreinte servies à ce terminal (état local) | Aucune ; `last_snapshot_version` local | `409 SNAPSHOT_VERSION_UNKNOWN` ; `204` idempotent |
| 15 | `submitOfflineBatch` | `POST /offline-batches` | 3 preuves ; `X-Authority-Epoch`, `Idempotency-Key` = `batch_id`, `X-Device-Serial` | tout ce que lit la mission 7 : `media`, `wallets`, `device_configs[]` (plafonds de la configuration citée), `devices[]`, `event.status` | une entrée `EdgeSyncOperation` par opération de lot, `authorized_mode = DEVICE_OFFLINE`, `device_batch_id`, avec l'en-tête et la signature d'origine relayés à part | `409 DEBIT_AUTHORITY_MOVING` pendant `RELEASING` ; `409 STALE_AUTHORITY_EPOCH` ; `400 BATCH_SIGNATURE_INVALID` ; `409 CHAIN_BROKEN` ; `413 BATCH_TOO_LARGE` ; `TOPUP_CASH` du lot : `REJECTED OFFLINE_NOT_ALLOWED` (C-006) |
| 16 | `getOfflineBatchResult` | `GET /offline-batches/{batch_id}` | 3 preuves | résultat local du lot | Aucune | `404` lot inconnu ; `202` en cours |

### Notes du tableau

1. **`X-Authority-Epoch`** : le contrat ne déclare l'en-tête que sur `createPayment`, `reversePayment`, `createCashTopup` et
   `submitOfflineBatch`. `activateMedia` et `takeDeposit` ne le portent pas, alors que `sync_protocol.md` §9.3 l'exige « sur
   toute requête de débit ». La passerelle contrôle donc son propre état (`ACTIVE`, accusé reçu) avant d'activer ou de prendre
   une caution, sans en-tête. Ajouter l'en-tête serait un changement de route publique : hors `/edge/*`, non proposé, signalé.
2. **`refreshDeviceToken`** : le contrat dit que le jeton de rafraîchissement est à usage unique et à rotation dans une famille
   du central. Décision 11 du porteur (écart accepté, `OP-N102`, `ADR-157`) : sur la passerelle, **sans rotation** ; elle vérifie le certificat,
   la preuve de possession et l'empreinte courante répliquée (`devices[].token_family`), émet un jeton d'accès court valable sur elle seule, ne
   consomme ni ne fait tourner le jeton de rafraîchissement ; la rotation est forcée au retour au central.
3. **`getMediaAuthKey`** : la passerelle ouvre `pwd_pack_enc` avec la clé de contenu du flux, scellée pour sa clé d'accord, puis
   re-chiffre pour le terminal (ECDH-ES P-256, HKDF-SHA256, AES-256-GCM, AAD du contrat). Elle ne détient aucune clé maître
   (C-009). Le PWD n'est jamais persisté en clair sur la passerelle.
4. **Refus consommant un numéro** : le contrat dit que toute réponse finale 2xx ou 4xx d'un paiement est enregistrée au
   registre de numéros du terminal. Une entrée `VOID` (« numéro consommé sans effet comptable : abandon, refus en ligne ») dans la file
   évite un trou de numéro côté central. La forme exacte (`void_reason`, contenu haché) est fixée par vecteurs au plan.
5. **Approbation sur place** (`X-Approval-Token`) : le contrat la prévoit pour `reversePayment` ; elle exige que la passerelle
   vérifie la personne `SUPERVISOR` (`staff`) et le jeton d'approbation (`act = reversePayment`, usage unique, 300 s au plus).
   Dépend de la vérification OIDC hors central. À confirmer au plan ; sinon `reversePayment` ne sert que le vendeur de la vente.
6. **`TOPUP_CASH` en file** : `OfflineOperationType` dit que le type est toujours rejeté dans un lot de terminal, sans
   exception décrite pour la passerelle. La file de la passerelle l'emploie pourtant avec `EDGE_ONLINE` (spec FR-015, ADR-52).
   Contradiction de texte, pas de schéma : le type existe et `EdgeSyncOperation` hérite de `OfflineOperation`. À consigner.

## Comportements communs de la passerelle (rappel)

- **États sans débit** : `STANDBY`, `ARMED` (autorité au central), accord reçu non accusé, `RELEASING`, `RELEASED`, `STALE`,
  `REVOKED`. Un débit reçu dans l'un de ces états n'écrit rien et ne consomme pas de numéro de file.
  - `RELEASING` : `409 DEBIT_AUTHORITY_MOVING` (US4-1), nouveaux lots refusés de même.
  - `STALE` (époque supérieure vue) : `409 STALE_AUTHORITY_EPOCH`, persistant.
  - Accord reçu non accusé (`GRANTED_PENDING`) : `409 DEBIT_AUTHORITY_MOVING`, `retryable: true` (la bascule est réellement en cours).
  - `ARMED` (autorité au central) et `STANDBY` : le contrat ne nomme pas de code précis ; `DEBIT_AUTHORITY_MOVING` y serait trompeur (le terminal
    doit aller au central). Choix du plan : `409 CONFLICT_STATE`, `retryable: false`, `detail = GATEWAY_NOT_AUTHORITY`, sans écrire ni consommer de numéro.
    Code existant du contrat, aucun ajout ; à confirmer avec l'équipe terminal (C-013), point 14 de `research.md`.
  - `REVOKED` (connu de la passerelle) : tout débit refusé comme en `STALE`, sans retour possible.
- **Lectures** : les lectures (2 à 6, 10, 13, 14, 16) restent servies dans tous ces états sauf `REVOKED`, tant que le
  terminal est valide.
- **Idempotence** : une clé `<serial>:<seq>` déjà vue répond la même réponse, sans nouvelle entrée en file (NFR-003). Le
  registre local est écrit dans la même transaction que l'entrée de file.
- **Horloge** : l'heure servie (`server_time`, `Date`) est celle de la passerelle ; le point est à fixer au plan (R-protocole §3.6).
- **Aucune route ajoutée** : toute route hors de ces 16 est absente de la passerelle (garde « route non marquée », réponse
  `404`), sauf les refus nommés ci-dessous (dont `releaseMedia`, qui répond `409 DEBIT_AUTHORITY_EDGE`).

## Opérations refusées pendant `EDGE`

Ce que le contrat déclare indisponible pendant `EDGE` (`DECISIONS_ADR.md` ADR-52, `sync_protocol.md` §9.6). Une demande de ce genre
qui parvient à la passerelle répond `409 DEBIT_AUTHORITY_EDGE`, sans rien écrire et sans consommer de numéro, avec `retryable: false`
et sans `edge_base_url` (la passerelle est déjà l'adresse indiquée : le terminal ne doit pas boucler sur elle).

| Demande | Où elle arrive | Contrat | Code de la passerelle |
|---|---|---|---|
| Caution prélevée sur le solde (`FROM_BALANCE`) | `activateMedia`, `takeDeposit` | « sinon `409 DEBIT_AUTHORITY_EDGE` » (1350, 1486) | `409 DEBIT_AUTHORITY_EDGE` |
| Frais d'activation prélevés sur le solde | `activateMedia` | idem | `409 DEBIT_AUTHORITY_EDGE` |
| Paiement par QR client (`customer_qr_token`) | `createPayment` | indisponible (ADR-52) | `409 DEBIT_AUTHORITY_EDGE` (note 7) |
| Restitution d'un bracelet | `releaseMedia` (`POST /media/{media_id}/release`) : non `x-edge-available`, donc non servie ; refus nommé, pas une route absente | « Indisponible pendant `EDGE` (`409 DEBIT_AUTHORITY_EDGE`) » | `409 DEBIT_AUTHORITY_EDGE` (un seul comportement, A27.6) si le terminal l'envoie à la passerelle |
| Remboursement du solde (`WALLET_REFUND`) | back-office du central | indisponible | sans objet sur la passerelle (route du central, jamais appelée par un terminal) ; refusée par le central : `409 DEBIT_AUTHORITY_EDGE` (`approveRefundRequest`, `confirmRefundRequest` en échec) |
| Rattachement d'un bracelet à un compte client | `confirmMediaClaim` | « Indisponible pendant `EDGE` » | sans objet sur la passerelle ; le contrat dit seulement « Indisponible pendant `EDGE` », sans code ; le central refuse aussi `postLateClaim` en `409 DEBIT_AUTHORITY_EDGE` |
| Rendu d'espèces dues (`refundCashDue`) | central | « Servie par le central, y compris pendant `EDGE` » | non servie par la passerelle ; le terminal s'adresse au central |
| Capture d'une intention de POS tiers | central | V2, hors périmètre | sans objet |
| Ouverture, relève, fermeture de session de caisse ou de vendeur | routes `/cash-sessions/*`, `/vendor-sessions/*` | non `x-edge-available` | route absente de la passerelle (`404`) ; aucune exemption de garde de caisse (C-005) |

7. **Paiement par QR** : le texte de `createPayment` ne dit pas quel code la passerelle renvoie pour un QR. La consigne de la
   mission (US2-4, FR-011) retient `409 DEBIT_AUTHORITY_EDGE`. Ce code est « pas un refus » au contrat (rejouer vers
   `edge_base_url`) ; renvoyé par la passerelle elle-même, il doit porter `retryable: false` pour ne pas faire boucler le
   terminal. Écart de sémantique à signaler au porteur et à l'équipe du terminal (C-013), sans changer le contrat.

**Au central pendant `EDGE`** (FR-013, hors de ce fichier mais même code) : tout débit répond `409 DEBIT_AUTHORITY_EDGE` avec
`edge_base_url` et `authority_epoch`, sur tous les chemins ; seuls les crédits passent (recharges PSP, espèces en ligne,
contre-passations).

## Preuves attendues (ancrées dans les FR)

| Exigence | Preuve |
|---|---|
| FR-010 | test de contrat : chaque réponse des 16 opérations valide le schéma de `openapi.yaml`, passerelle et central |
| FR-011 | un test par ligne du tableau des refus : rien d'écrit, aucun numéro consommé |
| FR-012 | époque supérieure : `409`, arrêt persistant après redémarrage |
| FR-015 | recharge sans session répliquée, ou sur session ouverte après la bascule : refusée, rien d'écrit |
| FR-026 | `getDeviceSeqStatus` ne rend jamais un numéro non accusé par le central |
| NFR-005 | 1 000 paiements, serveur seul, p95 200 ms et p99 500 ms |
| NFR-010 | canari absent des réponses, de la base locale et des journaux |
