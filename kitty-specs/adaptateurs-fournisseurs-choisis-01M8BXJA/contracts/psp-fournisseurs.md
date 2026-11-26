# Contrat — correspondances fournisseur ↔ port (IC-03, IC-04, IC-05)

Source de chaque ligne : `research.md` (R-04 Wave, R-05 PayDunya, R-06 Stripe).

| Méthode du port | Wave | PayDunya | Stripe |
|---|---|---|---|
| `initiate` | `POST /v1/checkout/sessions` (`amount` chaîne, `XOF`, `client_reference`, `success_url`, `error_url`, `restrict_payer_mobile`) → `REDIRECT wave_launch_url` | `POST checkout-invoice/create` (`callback_url` = URL de notification de la configuration) → `REDIRECT response_text` | `POST /v1/checkout/sessions` (form, `Idempotency-Key`, 3-D Secure `any`) → `REDIRECT url` |
| reprise d'une création incertaine | `GET …/search?client_reference=` | non documentée : pas de nouvel essai de création ; recharge laissée à l'interrogation | même `Idempotency-Key` |
| `verifyNotification` | `Wave-Signature`, HMAC(`t`+corps), plusieurs `v1`, 300 s → `NOTIFICATION` | formulaire, `data[hash]` = sha512(clé maître) → `SIGNAL` | `Stripe-Signature`, HMAC(`t.`+corps), `v0`/inconnus ignorés, 300 s → `NOTIFICATION` (`confirmationRequired` sur succès) |
| `getStatus` | `GET /v1/checkout/sessions/:id` | `GET checkout-invoice/confirm/{token}` | session + `payment_intents/:id?expand[]=latest_charge` |
| `cancel` | `POST …/:id/expire` (409 → false) | `{ cancelled: false }` | `POST …/:id/expire` |
| `readStatement` | `GET /v1/transactions?date=` par jour, curseur `after` | `{ supported: false }` | `GET /v1/balance_transactions` `created[gte/lte]`, `starting_after` |
| carte | — | `threeDs: NOT_PERFORMED`, `fingerprint: null` (D7) | `three_d_secure.result`, `card.fingerprint` |

Correspondance des statuts :

| Port | Wave | PayDunya | Stripe |
|---|---|---|---|
| PAID | `complete` + `succeeded` | `completed` | session `complete` + `payment_status=paid` |
| PENDING | `open`, `processing` | `pending` | `open`, `unpaid` |
| FAILED | `cancelled` | `failed` [à confirmer] | PaymentIntent `requires_payment_method` après échec |
| CANCELLED | — | `cancelled` [à confirmer] | — |
| EXPIRED | `expired` | — | session `expired` |
| UNKNOWN | autre valeur | autre valeur | autre valeur |

Écart de sécurité PayDunya (D2) : preuve d'origine fixe, sans corps signé ni horodatage. Compensation : signal seul,
crédit par confirmation authentifiée, au plus une relecture par recharge et par minute. Test de borne : un signal
PayDunya valide suivi d'une confirmation « pending » ou d'un montant différent ne crédite pas.
