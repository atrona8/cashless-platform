# Decision Moment `01M5HKT8GW5ZCAESAJC6WV5S6H`

- **Mission:** `terminaux-paiement-en-ligne-01M52QB9`
- **Origin flow:** `specify`
- **Slot key:** `specify.vendors.pin-rules`
- **Input key:** `vendor_pin_rules`
- **Status:** `resolved`
- **Created:** `2026-10-22T10:51:53.244324+00:00`
- **Resolved:** `2026-10-22T10:52:40.222029+00:00`
- **Opened by:** `cli`
- **Other answer:** `false`

## Question

Règles du code PIN vendeur : longueur, blocage après échecs, durée d'une session de vendeur

## Options

- PIN 6 chiffres, blocage après 5 échecs jusqu à réinitialisation par le commerçant, session de 12 h au plus
- PIN 4 chiffres, blocage 15 min après 5 échecs, session de 12 h au plus
- Other

## Final answer

PIN de 6 chiffres ; 5 échecs (par vendeur, tous terminaux) bloquent le vendeur jusqu'au déblocage par le commerçant (nouveau PIN) ; session de 12 h au plus, close aussi à la déconnexion, à la suspension ou révocation du terminal et à la désactivation du vendeur ; échecs audités

## Rationale

_(none)_

## Change log

- `2026-10-22T10:51:53.244324+00:00` — opened
- `2026-10-22T10:52:40.222029+00:00` — resolved (final_answer="PIN de 6 chiffres ; 5 échecs (par vendeur, tous terminaux) bloquent le vendeur jusqu'au déblocage par le commerçant (nouveau PIN) ; session de 12 h au plus, close aussi à la déconnexion, à la suspension ou révocation du terminal et à la désactivation du vendeur ; échecs audités")
