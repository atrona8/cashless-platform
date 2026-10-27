# Decision Moment `01M5HK8RJSX2KVK7Y6Y0C7XSRD`

- **Mission:** `terminaux-paiement-en-ligne-01M52QB9`
- **Origin flow:** `specify`
- **Slot key:** `specify.catalog.price-check`
- **Input key:** `sale_line_price_check`
- **Status:** `resolved`
- **Created:** `2026-10-22T10:42:19.865178+00:00`
- **Resolved:** `2026-10-22T10:44:43.639123+00:00`
- **Opened by:** `cli`
- **Other answer:** `false`

## Question

Lignes d'une vente au catalogue : contre quel prix le serveur vérifie-t-il le prix unitaire envoyé par le terminal ?

## Options

- Prix de la configuration servie au terminal
- Prix actuel du catalogue seulement
- Prix du terminal accepté
- Other

## Final answer

Prix du catalogue de la configuration servie au terminal, ou prix actuel ; sinon refus et resynchronisation du terminal

## Rationale

_(none)_

## Change log

- `2026-10-22T10:42:19.865178+00:00` — opened
- `2026-10-22T10:44:43.639123+00:00` — resolved (final_answer="Prix du catalogue de la configuration servie au terminal, ou prix actuel ; sinon refus et resynchronisation du terminal")
