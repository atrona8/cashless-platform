# Decision Moment `01M5HJXZ4QPS4NY8SABQKY95Q2`

- **Mission:** `terminaux-paiement-en-ligne-01M52QB9`
- **Origin flow:** `specify`
- **Slot key:** `specify.vendors.pin-verification`
- **Input key:** `vendor_pin_verification`
- **Status:** `resolved`
- **Created:** `2026-10-22T10:36:26.135604+00:00`
- **Resolved:** `2026-10-22T10:37:23.477485+00:00`
- **Opened by:** `cli`
- **Other answer:** `false`

## Question

Connexion d'un vendeur au terminal : où est vérifié le code PIN, et comment la vente est-elle attribuée ?

## Options

- Vérifié par le serveur, session de vendeur liée au terminal
- Vérifié sur le terminal (empreintes dans la configuration)
- Other

## Final answer

Vérifié par le serveur (argon2id, blocage après échecs), session de vendeur liée au terminal ; attribution par le serveur d'après la session ; aucune empreinte de PIN hors du serveur ; le hors ligne est tranché par la mission 7

## Rationale

_(none)_

## Change log

- `2026-10-22T10:36:26.135604+00:00` — opened
- `2026-10-22T10:37:23.477485+00:00` — resolved (final_answer="Vérifié par le serveur (argon2id, blocage après échecs), session de vendeur liée au terminal ; attribution par le serveur d'après la session ; aucune empreinte de PIN hors du serveur ; le hors ligne est tranché par la mission 7")
