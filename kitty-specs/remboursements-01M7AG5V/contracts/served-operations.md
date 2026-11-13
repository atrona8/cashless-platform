# Opérations servies (contrat `packages/contracts/openapi.yaml`, inchangé)

Aucune route, aucun champ ni code d'erreur n'est ajouté (C-002). Les formes de requête et de réponse sont celles du
contrat ; ce document fixe seulement les règles de service qui ne s'y lisent pas directement.

| Opération | Route | Accès | Règles de service |
|---|---|---|---|
| `createMyRefundRequest` | `POST /me/refund-requests` | festivalier (jeton ou en-têtes de test hors production) ; `Idempotency-Key` | portefeuille du festivalier, sinon `404` ; `BANK_TRANSFER` → `422 REFUND_NOT_ALLOWED` (OP-N123) ; fenêtre (`422 REFUND_WINDOW_CLOSED`) ; éligibilité R-04 et solde payé > 0 (`422 REFUND_NOT_ALLOWED`) ; règle de frais absente → `422` ; une ouverte (`409 REFUND_ALREADY_OPEN`) ; autre numéro : `new_number_otp` vérifié contre `msisdn` et consommé (`422 OTP_INVALID` / `REFUND_NOT_ALLOWED`, `429 OTP_RATE_LIMITED`) ; réponse `201 RefundRequest` |
| `listMyRefundRequests` | `GET /me/refund-requests` | festivalier | ses demandes seulement ; pagination `cursor`/`limit` ; échéances promues avant lecture |
| `listRefundRequests` | `GET /refund-requests` | back-office, portée de l'événement | filtres du contrat ; échéances promues avant lecture |
| `decideRefundRequestAsHolder` | `POST /refund-requests/{id}/holder-decision` | public (`security: []`) | prestataire par `refund_request_operator` ; défi `REFUND_HOLDER` lié à cette demande, sinon `422 OTP_INVALID` (même réponse pour une demande inconnue) ; état `AWAITING_HOLDER` et `now < hold_until`, sinon `409 CONFLICT_STATE` ; `CONFIRM` → `REQUESTED`, `BLOCK` → `BLOCKED` |
| `approveRefundRequest` | `POST /refund-requests/{id}/approve` | `OPERATOR_ADMIN` / `ORGANIZER_ADMIN` ; `Idempotency-Key` | demande `REQUESTED` (après promotion), sinon `409 CONFLICT_STATE` ; `extra_check_required` ⇒ `note` obligatoire ; crée l'approbation `WALLET_REFUND`, `202` |
| `approveApprovalRequest` (action `WALLET_REFUND`) | `POST /approval-requests/{id}/approve` | seconde personne, même rôle, ≠ auteur | exécution : éligibilité revue, `WALLET_REFUND` (solde payé à l'instant, frais), `PROCESSING` ; EDGE → refus (approbation `FAILED`, demande `REQUESTED`) |
| `confirmRefundRequest` | `POST /refund-requests/{id}/confirm` | back-office ; `Idempotency-Key` | demande `PROCESSING`, sinon `409 CONFLICT_STATE` ; `PAID` : `external_reference` obligatoire, aucune écriture ; `FAILED` : `failure_reason` obligatoire, `REVERSAL`, garde EDGE (`409 DEBIT_AUTHORITY_EDGE`) |
| `rejectRefundRequest` | `POST /refund-requests/{id}/reject` | back-office ; `Idempotency-Key` | `REQUESTED` seulement (`409 CONFLICT_STATE`) ; `reason` obligatoire ; aucune écriture |
| `releaseMedia` (complétée) | `POST /media/{id}/release` | terminal du guichet, session de caisse ouverte | `settle_balance` / `refund_deposit_by` : enchaînement §7.9 tout ou rien ; jeton `X-Approval-Token` au-delà de `cash_refund_single_max` ; `release.no_chaining` retiré |

## `GET /me/wallets` (complété)

`refund.eligible` et `refund.deadline` (date limite effective : `refund_deadline` sinon `ends_at` + 30 j), `refund.fee`
si le contrat le déclare : calculés par la même fonction d'éligibilité que la création.
