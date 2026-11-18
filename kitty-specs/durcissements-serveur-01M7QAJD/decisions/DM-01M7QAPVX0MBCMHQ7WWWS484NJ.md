# Decision Moment `01M7QAPVX0MBCMHQ7WWWS484NJ`

- **Mission:** `durcissements-serveur-01M7QAJD`
- **Origin flow:** `specify`
- **Slot key:** `specify.scope.op-n140-iban-at-rest`
- **Input key:** `op_n140_at_rest`
- **Status:** `resolved`
- **Created:** `2026-11-18T12:39:35.072951+00:00`
- **Resolved:** `2026-11-18T12:42:02.868578+00:00`
- **Opened by:** `cli`
- **Other answer:** `false`

## Question

OP-N140 : IBAN au repos dans refund_request.iban, chiffré dans la 11a ou seulement masqué dans les journaux ?

## Options

- Masque dans redact.ts et chiffrement au repos par le service de clés existant (faux jusqu à la 12b)
- Masque dans redact.ts seulement, chiffrement au repos reporté en 12b
- Other

## Final answer

Masque de l'IBAN dans redact.ts et chiffrement au repos de refund_request.iban par le service de clés existant (faux jusqu'à la 12b, déjà refusé en production par OP-N41) ; déchiffrement seulement pour l'export du lot et l'affichage masqué

## Rationale

_(none)_

## Change log

- `2026-11-18T12:39:35.072951+00:00` — opened
- `2026-11-18T12:42:02.868578+00:00` — resolved (final_answer="Masque de l'IBAN dans redact.ts et chiffrement au repos de refund_request.iban par le service de clés existant (faux jusqu'à la 12b, déjà refusé en production par OP-N41) ; déchiffrement seulement pour l'export du lot et l'affichage masqué")
