# Réponse à « Endpoints manquants à déployer côté backend » (app festivalier)

Date : 13/11/2026. Destinataire : équipe de l'app Xaamga Cashless (Flutter). Environnement vérifié :
`https://removable-thimble-uptight.ngrok-free.dev/v1` (API partagée, données de démo de `DONNEES-DEMO.md`).

## En bref

- **P1 à P3 (9 routes) : déjà servies.** Les 404, 409 et 422 constatés viennent de requêtes ou de formes de réponse
  qui ne suivent pas le contrat. Nous avons rejoué le parcours complet le 13/11 sur l'API partagée : code à usage
  unique, jetons, rafraîchissement, `/me`, portefeuilles, historique, bracelets, recharge PSP. Tout répond.
- **Les formes de réponse attendues dans votre note ne sont pas celles du contrat.** La référence est
  `openapi.yaml` (contrat partagé, stable) : l'API le suit à la lettre. Il faut aligner l'app sur le contrat (tableau
  ci-dessous), pas l'inverse. Pour régénérer les modèles Dart : `packages/contracts` du kit client.
- **P4 (remboursements) : pas encore servis.** Ils arrivent avec la mission 9 (remboursements, versements et
  clôture), la prochaine côté serveur. Les formes sont déjà fixées dans le contrat : vous pouvez coder contre lui
  dès maintenant, avec des réponses simulées.

**Documentation interactive** : `https://removable-thimble-uptight.ngrok-free.dev/docs` (Swagger UI, contrat brut sur
`/docs/openapi.yaml`). Vérifiée le 13/11 : elle affiche le contrat à jour pour toutes les routes festivalier. Elle ne
diffère du dernier contrat que par des ajouts de la passerelle locale (`/edge/*`, schémas `Edge*`) et des champs
facultatifs de `Problem`, sans effet pour l'app.

## 1. Authentification du festivalier

Deux façons de s'authentifier, en développement seulement pour la seconde :

1. **Jeton réel (recommandé)** : `POST /customer-auth/otp`, puis `POST /customer-auth/token`, puis
   `Authorization: Bearer <access_token>`.
2. **En-têtes de test** (refusés en production) : `X-Test-Customer-Id`, `X-Test-Operator-Id` et
   `X-Test-Customer-Device`, sans jeton.

### `POST /customer-auth/otp`

Le corps **doit** porter `operator_code`, le code public du prestataire (`demo-a` ou `demo-b` en démo). C'est lui qui
fixe le tenant ; sans lui, la requête est refusée.

```json
{ "phone": "+221770000001", "operator_code": "demo-a", "channel": "SMS" }
```

Réponse `202` : `{ "otp_request_id": "otp_…", "expires_in": 300 }`. En développement, le code n'est envoyé à
personne (envoyeur simulé) : il est rendu dans l'en-tête de réponse **`X-Test-Otp-Code`**. Lisez-le là, pas dans un
SMS, et n'utilisez pas un code inventé.

### `POST /customer-auth/token`

```json
{ "otp_request_id": "otp_213a774f-…", "code": "234756" }
```

- `otp_request_id` : la valeur exacte rendue par `/customer-auth/otp`, préfixe `otp_` compris.
- `code` : six chiffres, ceux de `X-Test-Otp-Code`.

Réponse `200` : `{ access_token, token_type: "Bearer", expires_in: 900, refresh_token: "crt_…" }`. Un `422` signifie
« code faux ou expiré » ; un `429` signifie « trop d'essais ».

### `POST /customer-auth/refresh`

Corps `{ "refresh_token": "crt_…" }`, réponse identique à `/customer-auth/token`. Le jeton de renouvellement est
**à usage unique** : gardez celui de la réponse. Rejouer un ancien jeton révoque toute la famille, et la session doit
alors repasser par l'OTP. Un `401` ne veut pas dire « route absente » : le jeton envoyé est invalide ou déjà utilisé.

## 2. Formes de réponse : contrat contre note

Toutes les listes sont dans **`data`** (pas `items`), avec `next_cursor` et `has_more` quand elles sont paginées.

| Route | Votre note | Contrat (servi) |
|---|---|---|
| `GET /me` | `id`, `kyc_status`, `operator_id`, `created_at` | `customer_id`, `phone`, `display_name` (peut être `null`), `kyc_level` (`NONE` ou `VERIFIED`) |
| `GET /me/wallets` | `items[].id`, `state`, `balances`, `event.id` | `data[].wallet_id`, `status`, **`balance`** `{ spendable, paid, promo }`, `balance_as_of`, `event { event_id, name, status }`, `media[]`, `refund { eligible, deadline }` |
| `GET /me/wallets/{wallet_id}/transactions` | `items[].id`, `description`, `balance_after`, `type: TOPUP_PSP` | `data[].transaction_id`, **`label`**, `type` (`TOPUP`, `PURCHASE`, `REVERSAL`, …), `source` (`PSP_WEBHOOK`, `ONLINE`, …), `amount`, `currency`, `occurred_at`, `reverses_id`, `reversed_by_id` ; **pas** de `balance_after` |
| `GET /me/media` | `items[].id`, `claim_code`, `type`, `state`, `linked_at` | `data[].media_id`, `printed_number`, `status`, `deposit_status`, `wallet_id` ; **pas** de code de rattachement (il n'est jamais rendu après coup) |
| `POST /me/media/{media_id}/report-lost` | `{ previous_state, new_state, reported_at }` | l'objet bracelet (`CustomerMedia`) mis à jour, `status: "SUSPENDED"` ; en-tête **`Idempotency-Key`** obligatoire |
| `POST /topups/psp` | — | voir § 3 |

Exemples réels pris sur l'API partagée le 13/11 :

```json
{ "customer_id": "c10e0ac3-f0ca-43fc-9b1a-8fcf53cd07ae", "phone": "+221770000001",
  "display_name": "Awa Diop", "kyc_level": "NONE" }
```

```json
{ "data": [ {
    "wallet_id": "44f1a187-a49c-4152-8f5d-8f4991cdb6c8", "status": "ACTIVE", "kyc_level": "NONE", "currency": "XOF",
    "event": { "event_id": "16f8cb90-4cfd-4052-89e6-e3f155d0b29d", "name": "Festival Démo A", "status": "LIVE" },
    "balance": { "spendable": 25000, "paid": 25000, "promo": 0 },
    "balance_as_of": "2026-11-13T12:25:45.040Z",
    "media": [ { "media_id": "8c8f93a2-3a1b-4d26-85c9-efce5477964e", "status": "ACTIVE",
                 "deposit_status": "NONE", "wallet_id": "44f1a187-…", "printed_number": null } ],
    "refund": { "eligible": false, "deadline": null } } ] }
```

```json
{ "data": [ { "transaction_id": "6047143d-002e-42b1-943e-c1f35232eb27", "type": "TOPUP", "source": "PSP_WEBHOOK",
              "occurred_at": "2026-11-10T10:36:22.355Z", "amount": 5000, "currency": "XOF",
              "label": "Recharge en ligne", "reverses_id": null, "reversed_by_id": null } ],
  "next_cursor": "eyJ0Ijoi…", "has_more": true }
```

Pour l'historique, passez `next_cursor` tel quel dans `?cursor=` ; ne le décodez pas. Le solde après chaque ligne
n'est pas servi : affichez le solde de `GET /me/wallets` (`balance.spendable`).

## 3. Recharge en ligne (PSP)

### `POST /topups/psp`

En-tête **`Idempotency-Key: <UUID>`** obligatoire, le même en cas de nouvel essai.

```json
{ "wallet_id": "44f1a187-a49c-4152-8f5d-8f4991cdb6c8", "amount": 5000, "currency": "XOF", "provider": "WAVE",
  "payer_msisdn": "+221770000001", "return_url": "https://xaamga.example/cashless/topup/callback" }
```

- `provider` : `WAVE`, `ORANGE_MONEY` ou `CARD`.
- Réponse `201` : `PspTopup`, soit `topup_id` (UUID, pas `top_…`), `status: "PENDING"`, `provider`, `amount`,
  `currency`, `wallet_id`, `checkout_url`, `expires_at`.
- Vérifié le 13/11 sur l'API partagée : `201`. Le PSP est simulé jusqu'à la mission 12b, et `checkout_url` pointe vers
  une page de paiement factice.
- Un `409 PSP_NOT_CONFIGURED` signifie que l'événement du portefeuille n'a pas de configuration pour ce prestataire
  de paiement. Les portefeuilles de « Festival Démo A » en ont une. Vérifiez le `wallet_id` et le `provider` envoyés.

### `GET /topups/psp/{topup_id}`

Même objet `PspTopup`. `status` passe à `SUCCEEDED` quand la notification du PSP est reçue, et `transaction_id` est
alors rempli. Un `404` sur un identifiant inventé est normal.

## 4. Remboursements (P4) : mission 9

| Route | Contrat |
|---|---|
| `POST /me/refund-requests` | corps `{ wallet_id, destination { method: WAVE|ORANGE_MONEY|BANK_TRANSFER, msisdn?, iban?, new_number_otp? } }`, `Idempotency-Key` ; réponse `201` `RefundRequest` (`status`, `estimated_amount`, `fee`, `created_at`…) |
| `GET /me/refund-requests` | `{ data: RefundRequest[], next_cursor, has_more }` |
| `POST /refund-requests/{id}/holder-decision` | corps `{ decision: CONFIRM|BLOCK, otp_request_id, code }` : le titulaire confirme ou bloque par un code à usage unique (pas `ACCEPT`) |

Les statuts sont `AWAITING_HOLDER`, `REQUESTED`, `PROCESSING`, `PAID`, `FAILED`, `REJECTED`, `CANCELLED` et `BLOCKED`.
Aujourd'hui ces routes répondent `404`. Nous vous préviendrons quand elles seront servies.

## 5. Pour la suite

- Toute différence entre l'app et `openapi.yaml` se corrige côté app. Toute route ou tout champ **en plus** se demande
  à l'équipe serveur, qui l'ajoute au contrat (seulement de façon rétrocompatible).
- Pour signaler un écart, joignez la requête exacte (méthode, URL, en-têtes sans jeton, corps) et la réponse complète,
  avec son `instance` : nous retrouvons ainsi l'appel dans les journaux.
