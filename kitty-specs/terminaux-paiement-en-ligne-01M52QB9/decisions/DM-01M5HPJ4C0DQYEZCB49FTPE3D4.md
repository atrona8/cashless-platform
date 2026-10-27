# Decision Moment `01M5HPJ4C0DQYEZCB49FTPE3D4`

- **Mission:** `terminaux-paiement-en-ligne-01M52QB9`
- **Origin flow:** `plan`
- **Slot key:** `plan.scope.customer-qr-side`
- **Input key:** `customer_qr_side`
- **Status:** `resolved`
- **Created:** `2026-10-22T11:39:52.576960+00:00`
- **Resolved:** `2026-10-22T11:52:21.618334+00:00`
- **Opened by:** `cli`
- **Other answer:** `false`

## Question

Côté festivalier du QR (payPaymentRequest, createCustomerQrToken) : sans identité réelle du festivalier avant la mission 10 (OP-N43), servir ces routes derrière le port d'identité du festivalier (faux en test, refusé en production) ou les reporter à la mission 10 ?

## Options

- Servir derrière le port, réel avec la mission 10
- Reporter le côté festivalier à la mission 10
- Other

## Final answer

Servir les deux côtés ; côté festivalier derrière le port d'identité du festivalier (faux en test, refusé en production) ; réel avec la mission 10 ; OP-N43 complété

## Rationale

_(none)_

## Change log

- `2026-10-22T11:39:52.576960+00:00` — opened
- `2026-10-22T11:52:21.618334+00:00` — resolved (final_answer="Servir les deux côtés ; côté festivalier derrière le port d'identité du festivalier (faux en test, refusé en production) ; réel avec la mission 10 ; OP-N43 complété")
