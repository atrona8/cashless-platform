# Decision Moment `01M5HNJE5BAQJCWH2VPWA6SZJ4`

- **Mission:** `terminaux-paiement-en-ligne-01M52QB9`
- **Origin flow:** `plan`
- **Slot key:** `plan.security.pin-pepper`
- **Input key:** `vendor_pin_pepper`
- **Status:** `resolved`
- **Created:** `2026-10-22T11:22:34.027474+00:00`
- **Resolved:** `2026-10-22T11:27:40.939427+00:00`
- **Opened by:** `cli`
- **Other answer:** `false`

## Question

Empreinte du PIN : argon2id seul, ou argon2id avec un secret hors de la base (VENDOR_PIN_SECRET, comme CLAIM_CODE_HMAC_KEY), exigé en production ?

## Options

- argon2id avec secret hors base, exigé en production
- argon2id seul
- Other

## Final answer

argon2id avec secret hors base VENDOR_PIN_SECRET, exigé en production (secret de test refusé, test) ; rotation = nouveaux PIN

## Rationale

_(none)_

## Change log

- `2026-10-22T11:22:34.027474+00:00` — opened
- `2026-10-22T11:27:40.939427+00:00` — resolved (final_answer="argon2id avec secret hors base VENDOR_PIN_SECRET, exigé en production (secret de test refusé, test) ; rotation = nouveaux PIN")
